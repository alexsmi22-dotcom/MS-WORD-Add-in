/**
 * Release E3a engines (lib/tsDiag.ts) against statsmodels 0.15 itself: scripts/ts-diag-oracle.py wrote the fixture
 * from fixed-seed synthetic series (and the shipped default table), so every number here is statsmodels' own.
 */
import * as fs from "fs";
import * as path from "path";
import {
  acfBiased,
  acfBands,
  pacfYwAdjusted,
  ljungBox,
  pacfDefaultLags,
  ljungBoxDefaultLags,
  adfTest,
  adfDefaultMaxLag,
  mackinnonP,
  mackinnonCrit,
  mackinnonCoefs,
  MACKINNON_RAW,
  kpssTest,
  hpFilter,
  Z975,
  type AdfRegression,
  type KpssRegression,
} from "../tsDiag";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FX: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ts-diag-oracle.json"), "utf8"));

/** |a − b| ≤ tol·max(1, |b|) elementwise, reporting the worst index. */
function expectClose(a: ArrayLike<number>, b: number[], tol: number, what: string): void {
  expect(a.length).toBe(b.length);
  let worst = 0;
  let at = -1;
  for (let i = 0; i < b.length; i++) {
    const e = Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i]));
    if (!(e <= worst)) {
      worst = e;
      at = i;
    }
  }
  if (!(worst <= tol)) throw new Error(`${what}: worst relative error ${worst} at ${at} (${a[at]} vs ${b[at]})`);
}

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

test("fixture is statsmodels 0.15", () => {
  expect(FX.statsmodels).toMatch(/^0\.15/);
});

test("z for 95% bands is scipy's norm.ppf(0.975)", () => {
  expect(Math.abs(Z975 - 1.959963984540054)).toBeLessThan(1e-14);
});

describe("default lag rules (exact at the powers of ten)", () => {
  for (const r of FX.defaultLags) {
    test(`n = ${r.n}`, () => {
      expect(pacfDefaultLags(r.n)).toBe(r.pacf);
      expect(ljungBoxDefaultLags(r.n)).toBe(r.lb);
    });
  }
});

describe("ACF, Bartlett bands, PACF (ywadjusted), Ljung–Box vs statsmodels", () => {
  for (const c of FX.acf) {
    test(c.name, () => {
      const r = acfBiased(c.x, c.K);
      expect(r).not.toBeNull();
      expectClose(r as Float64Array, c.acf, 1e-10, "acf");
      expectClose(acfBands(r as Float64Array, c.x.length), c.band, 1e-10, "band");
      const p = pacfYwAdjusted(c.x, c.K);
      if (!p.ok) throw new Error(p.reason);
      expectClose(p.pacf, c.pacf, 1e-9, "pacf");
      expect(rel(Z975 / Math.sqrt(c.x.length), c.pacfBand)).toBeLessThan(1e-12);
      const lb = ljungBox(c.x, c.K, c.modelDf);
      if (!lb.ok) throw new Error(lb.reason);
      expectClose(
        lb.rows.map((x) => x.q),
        c.q,
        1e-10,
        "Q",
      );
      lb.rows.forEach((row, i) => {
        if (c.p[i] === null) expect(row.p).toBeNull();
        else expect(rel(row.p as number, c.p[i])).toBeLessThan(1e-9);
      });
    });
  }
});

describe("ADF vs adfuller", () => {
  test("Schwert maxlag rule at its boundaries", () => {
    for (const r of FX.adfMaxlag) for (const reg of ["n", "c", "ct"] as AdfRegression[]) expect(adfDefaultMaxLag(r.nobs, reg)).toBe(r[reg]);
  });
  for (const c of FX.adf) {
    test(c.name, () => {
      const r = adfTest(c.x, { regression: c.regression, maxLag: c.maxlag ?? undefined, autolag: c.autolag });
      if (!r.ok) throw new Error(r.reason);
      expect(r.usedLag).toBe(c.usedLag);
      expect(r.nobs).toBe(c.nobs);
      expect(rel(r.stat, c.stat)).toBeLessThan(1e-9);
      expect(Math.abs(r.p - c.p)).toBeLessThan(1e-10);
      expectClose(r.crit, c.crit, 1e-13, "crit");
      if (c.icbest !== null) expect(rel(r.icBest as number, c.icbest)).toBeLessThan(1e-9);
    });
  }
});

describe("MacKinnon tables and surfaces", () => {
  test("tables are statsmodels' literals, scaled the same way", () => {
    for (const reg of ["n", "c", "ct"] as AdfRegression[]) {
      const t = FX.mackinnonTables[reg];
      const mine = MACKINNON_RAW[reg];
      expect(mine.tauStar).toBe(t.tauStar);
      expect(mine.tauMin).toBe(t.tauMin);
      expect(mine.tauMax).toBe(t.tauMax === null ? Infinity : t.tauMax);
      expect(mine.smallp).toEqual(t.smallp);
      expect(mine.largep).toEqual(t.largep);
      expect(mine.crit2010).toEqual(t.crit2010);
      const sc = mackinnonCoefs(reg);
      expect(sc.smallp).toEqual(t.smallpScaled);
      expect(sc.largep).toEqual(t.largepScaled);
    }
  });
  test("p-values on a grid of τ", () => {
    for (const r of FX.mackinnonP) expect(Math.abs(mackinnonP(r.tau, r.reg) - r.p)).toBeLessThan(1e-14);
  });
  test("critical values by sample size", () => {
    for (const r of FX.mackinnonCrit) expectClose(mackinnonCrit(r.reg, r.nobs), r.crit, 1e-14, `${r.reg} ${r.nobs}`);
  });
});

describe("KPSS vs kpss", () => {
  for (const c of FX.kpss) {
    test(c.name, () => {
      const r = kpssTest(c.x, { regression: c.regression as KpssRegression, lags: c.nlags === "auto" ? undefined : c.nlags });
      if (!r.ok) throw new Error(r.reason);
      expect(r.lags).toBe(c.lags);
      expect(rel(r.stat, c.stat)).toBeLessThan(1e-9);
      expect(Math.abs(r.p - c.p)).toBeLessThan(1e-9);
      if (c.p === 0.1) expect(["above", undefined]).toContain(r.pBound);
      if (c.p === 0.01) expect(r.pBound).toBe("below");
    });
  }
});

describe("HP filter vs hpfilter", () => {
  for (const c of FX.hp) {
    test(c.name, () => {
      const r = hpFilter(c.x, c.lambda);
      if (!r.ok) throw new Error(r.reason);
      const scale = Math.max(...c.x.map(Math.abs));
      for (let i = 0; i < c.x.length; i++) {
        expect(Math.abs(r.trend[i] - c.trend[i])).toBeLessThanOrEqual(1e-9 * scale);
        expect(Math.abs(r.cycle[i] - c.cycle[i])).toBeLessThanOrEqual(1e-9 * scale);
      }
    });
  }
  test("O(n): 100,000 values well inside a second", () => {
    const n = 100000;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(i / 50) + i * 1e-3;
    const t0 = Date.now();
    const r = hpFilter(x, 129600);
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("refusals", () => {
  test("constant series", () => {
    expect(acfBiased([2, 2, 2, 2], 2)).toBeNull();
    expect(pacfYwAdjusted([2, 2, 2, 2], 1).ok).toBe(false);
    expect(ljungBox([2, 2, 2, 2], 2).ok).toBe(false);
    expect(adfTest([5, 5, 5, 5, 5, 5, 5, 5, 5, 5], { regression: "c", autolag: true }).ok).toBe(false);
    expect(kpssTest([5, 5, 5, 5, 5, 5], { regression: "c" }).ok).toBe(false);
  });
  test("bad Ljung–Box arguments", () => {
    const x = [1, 3, 2, 5, 4, 6, 5, 8];
    expect(ljungBox(x, 0).ok).toBe(false);
    expect(ljungBox(x, 8).ok).toBe(false);
    expect(ljungBox(x, 2.5).ok).toBe(false);
    expect(ljungBox(x, 3, -1).ok).toBe(false);
  });
  test("ADF lag above statsmodels' limit, and an exactly linear series", () => {
    const x = Array.from({ length: 30 }, (_, i) => Math.sin(i) + i);
    const r = adfTest(x, { regression: "ct", maxLag: 13, autolag: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("at most 12");
    const lin = Array.from({ length: 40 }, (_, i) => 2 + 3 * i);
    expect(adfTest(lin, { regression: "ct", autolag: true }).ok).toBe(false);
  });
  test("HP λ must be finite and non-negative", () => {
    expect(hpFilter([1, 2, 3, 4], -1).ok).toBe(false);
    expect(hpFilter([1, 2, 3, 4], Infinity).ok).toBe(false);
    expect(hpFilter([1, 2], 1600).ok).toBe(false);
  });
});
