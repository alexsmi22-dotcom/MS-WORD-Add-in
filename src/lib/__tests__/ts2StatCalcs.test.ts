/**
 * Release F2 #10, Time series II: the engines (ts2.ts) against arch 8.0 / statsmodels 0.15 (scripts/ts2-oracle.py →
 * fixtures/ts2-oracle.json), and the five Stats calculators (ts2StatCalcs.ts) through the pane's read path.
 *
 * Tolerances (stated): GARCH parameters 3×10⁻⁴ absolute, log likelihood 10⁻⁶, robust and classic SEs 2×10⁻³ relative
 * (both sides use statsmodels' numerical-derivative steps; the residual gap is the optimum's last digits), variance
 * forecasts and conditional volatility 10⁻⁵ relative; at FIXED parameters llf 10⁻⁸ and covariances 10⁻³ of
 * √(Σᵢᵢ Σⱼⱼ). VAR, IRF SEs, FEVD, Granger, Johansen: 10⁻⁹ (closed forms). Engle–Granger τ 10⁻⁹, p 10⁻⁴ relative (the
 * far normal tail of the MacKinnon surface), critical values 10⁻¹².
 */
import * as fs from "fs";
import * as path from "path";
import type { StatOutput } from "../analyzeBlocks";
import { insertableResultText } from "../insertGate";
import type { StatCalcDef } from "../statCalc";
import {
  engleGranger,
  fitGarch,
  fitVarOls,
  garchAtParams,
  garchKktAt,
  johansen,
  JOHANSEN_SJA,
  JOHANSEN_SJT,
  lgamma,
  mackinnonCritN,
  MACKINNON_N,
  mackinnonPN,
  varGranger,
  varIrf,
  varSelectOrder,
  type GarchSpec,
} from "../ts2";
import * as ts2Module from "../ts2";
import type { GarchFit } from "../ts2";
import { TS2_STAT_CALCS } from "../ts2StatCalcs";
import { mackinnonP } from "../tsDiag";
import { fmtFixed, P_BELOW } from "../regTable";
import { Pcg32 } from "../prng";

const F = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ts2-oracle.json"), "utf8"));
const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const specOf = (c: { vol: string; dist: string; mean: string }): GarchSpec => ({
  vol: c.vol as GarchSpec["vol"],
  dist: c.dist as GarchSpec["dist"],
  mean: c.mean === "Constant" ? "constant" : "zero",
});
const colsOf = (rows: number[][]): number[][] => rows[0].map((_, j) => rows.map((r) => r[j]));
/** Mean squared residual of the returns times c (the canonical series a GARCH search runs on has 1). */
const canonMs = (y: number[], c: number, mean: string): number => {
  const ybar = y.reduce((a, b) => a + b, 0) / y.length;
  return y.reduce((a, v) => a + ((mean === "constant" ? v - ybar : v) * c) ** 2, 0) / y.length;
};

/** The pane's read: every field as typed. */
function run(c: StatCalcDef, over: Record<string, string> = {}): StatOutput {
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
}
const calc = (id: string): StatCalcDef => {
  const c = TS2_STAT_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

// ================================================================ GARCH vs arch

describe("GARCH family vs arch 8.0 (default data)", () => {
  test.each(F.garch.map((c: { vol: string; dist: string; mean: string }, i: number) => [`${c.vol} ${c.dist} ${c.mean}`, i]) as [string, number][])("%s", (_l, i) => {
    const c = F.garch[i as number];
    const r = fitGarch(F.data.garch, specOf(c));
    if (!r.ok) throw new Error(r.reason);
    expect(r.names.length).toBe(c.params.length);
    r.params.forEach((v, j) => expect(Math.abs(v - c.params[j])).toBeLessThan(3e-4));
    expect(Math.abs(r.llf - c.llf)).toBeLessThan(1e-6);
    r.seRobust!.forEach((v, j) => expect(relErr(v, c.seRobust[j])).toBeLessThan(2e-3));
    r.seClassic!.forEach((v, j) => expect(relErr(v, c.seClassic[j])).toBeLessThan(2e-3));
    c.varForecast.forEach((v: number, j: number) => expect(relErr(r.forecast[j], v)).toBeLessThan(1e-5));
    const vol = Array.from(r.sigma2, Math.sqrt);
    let worst = 0;
    vol.forEach((v, t) => (worst = Math.max(worst, relErr(v, c.condVol[t]))));
    expect(worst).toBeLessThan(1e-5);
    expect(relErr(r.backcast, c.vol === "egarch" ? Math.log(c.backcast) : c.backcast) < 1e-12 || Math.abs(r.backcast - c.backcast) < 1e-12).toBe(true);
    expect(canonMs(F.data.garch, r.scale, specOf(c).mean)).toBeCloseTo(1, 12);
    expect(r.atBounds).toEqual([]);
  });

  test.each(F.garch.filter((c: { fixedParams?: number[] }) => c.fixedParams).map((c: { vol: string; dist: string; mean: string }) => [`${c.vol} ${c.dist} ${c.mean}`, c]) as [string, unknown][])(
    "likelihood and covariance at fixed parameters: %s",
    (_l, c) => {
      const cc = c as { vol: string; dist: string; mean: string; fixedParams: number[]; fixedLlf: number; fixedCovRobust: number[]; fixedCovClassic: number[] };
      const a = garchAtParams(F.data.garch, specOf(cc), cc.fixedParams)!;
      expect(Math.abs(a.llf - cc.fixedLlf)).toBeLessThan(1e-8);
      const k = cc.fixedParams.length;
      for (const [mine, theirs] of [
        [a.covRobust, cc.fixedCovRobust],
        [a.covClassic, cc.fixedCovClassic],
      ] as const) {
        for (let i = 0; i < k; i++)
          for (let j = 0; j < k; j++) {
            const scale = Math.sqrt(Math.abs(theirs[i * k + i] * theirs[j * k + j]));
            expect(Math.abs(mine[i][j] - theirs[i * k + j]) / scale).toBeLessThan(1e-3);
          }
      }
    },
  );

  test("Student-t log Γ is accurate (the ν term of the likelihood)", () => {
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 13);
    expect(lgamma(10)).toBeCloseTo(Math.log(362880), 12);
    expect(lgamma(4.5)).toBeCloseTo(Math.log(11.631728396567448), 12);
  });
});

describe("GARCH holdout cases (not used while building)", () => {
  test("interior optima match arch", () => {
    for (const c of F.garchHoldout.slice(0, 2)) {
      const r = fitGarch(F.data.garchHold, specOf(c));
      if (!r.ok) throw new Error(r.reason);
      r.params.forEach((v, j) => expect(Math.abs(v - c.params[j])).toBeLessThan(3e-4));
      expect(Math.abs(r.llf - c.llf)).toBeLessThan(1e-6);
      r.seRobust!.forEach((v, j) => expect(relErr(v, c.seRobust[j])).toBeLessThan(2e-3));
    }
  });
  test("near-normal errors: ν drifts up a flat likelihood; ours is never below arch's optimum", () => {
    // arch's SLSQP stops at ν ≈ 169 and ≈ 139 here; the likelihood keeps rising toward ν = 500 (normal errors).
    for (const c of F.garchHoldout.slice(2)) {
      const r = fitGarch(F.data.garchHold, specOf(c));
      if (!r.ok) throw new Error(r.reason);
      expect(r.llf).toBeGreaterThanOrEqual(c.llf - 1e-6);
      const iNu = r.names.indexOf("nu");
      expect(r.params[iNu]).toBeGreaterThan(100);
      // The volatility parameters are pinned regardless of ν.
      r.names.forEach((nm, j) => {
        if (nm !== "nu") expect(Math.abs(r.params[j] - c.params[j])).toBeLessThan(5e-3);
      });
    }
  });
  test("scale equivariance: decimal returns (÷100) give the same model in the new units", () => {
    const y = F.data.garch.map((v: number) => v / 100);
    const c = F.garch[2]; // gjr normal Constant
    const r = fitGarch(y, specOf(c));
    if (!r.ok) throw new Error(r.reason);
    expect(canonMs(y, r.scale, "constant")).toBeCloseTo(1, 12);
    expect(Math.abs(r.params[0] * 100 - c.params[0])).toBeLessThan(3e-4);
    expect(Math.abs(r.params[1] * 1e4 - c.params[1])).toBeLessThan(3e-4);
    for (let j = 2; j < 5; j++) expect(Math.abs(r.params[j] - c.params[j])).toBeLessThan(3e-4);
    expect(Math.abs(r.llf - (c.llf + 500 * Math.log(100)))).toBeLessThan(1e-5);
    expect(relErr(r.seRobust![1] * 1e4, c.seRobust[1])).toBeLessThan(2e-3);
    // EGARCH: ω shifts by −2(1 − β) ln c; its SE by the delta method.
    const e = F.garch[4];
    const re = fitGarch(y, specOf(e));
    if (!re.ok) throw new Error(re.reason);
    expect(Math.abs(re.params[1] - (e.params[1] - 2 * (1 - e.params[4]) * Math.log(100)))).toBeLessThan(1e-3);
    expect(re.seRobust).not.toBeNull();
  });
});

describe("GARCH optima ON a bound (F2 review round 1) vs arch 8.0", () => {
  // The reviewer's series (scripts/ts2-oracle.py regenerates them: garchBound). Before the fix every one printed a
  // stalled starting point (GJR-t on iid data: ν = 12.000) with a lower likelihood than arch's.
  // Tolerances (stated): log likelihood ≥ arch's − 10⁻⁶ (ours may exceed it where arch's SLSQP stops early); identified
  // parameters 3×10⁻⁴; where α → 0 leaves ω and β weakly identified, ω and β 5×10⁻⁴ and the identified unconditional
  // variance ω/(1 − persistence) 10⁻⁴ relative; ν within 0.5% where the likelihood is flat in ν; parameters on a bound
  // within 10⁻⁹ of it.
  type B = { id: string; vol: string; dist: string; mean: string; y: number[]; params: number[]; llf: number; names: string[] };
  const B = (id: string): B => (F.garchBound as B[]).find((c) => c.id === id)!;
  const fitB = (c: B) => {
    const r = fitGarch(c.y, specOf(c));
    if (!r.ok) throw new Error(r.reason);
    expect(r.converged).toBe(true);
    expect(r.llf).toBeGreaterThanOrEqual(c.llf - 1e-6);
    // Never outside the parameter space, not even by 10⁻¹² (the estimate is projected onto its active bounds).
    const P = Object.fromEntries(r.names.map((nm, i) => [nm, r.params[i]]));
    if (c.vol !== "egarch") {
      expect(P.alpha).toBeGreaterThanOrEqual(0);
      expect(P.beta).toBeGreaterThanOrEqual(0);
      if (c.vol === "gjr") expect(P.alpha + P.gamma).toBeGreaterThanOrEqual(0);
    } else expect(P.beta).toBeGreaterThanOrEqual(0);
    return r;
  };
  test("EGARCH, zero mean: β on 0 matches arch", () => {
    const c = B("egarch-n160-zero");
    const r = fitB(c);
    r.params.forEach((v, j) => expect(Math.abs(v - c.params[j])).toBeLessThan(3e-4));
    expect(r.params[3]).toBeLessThan(1e-9);
    expect(r.atBounds).toEqual(["β = 0"]);
  });
  test("GARCH on iid returns: α on 0, and a higher optimum than arch's (β ≈ 0.996, the backcast transient)", () => {
    // With α on 0 the variance path is deterministic, σ²ₜ = ω + βσ²ₜ₋₁ from the backcast; arch stops at the local
    // optimum β ≈ 0.356 (it passes our KKT check too), while the multi-start search (F2 review round 2) finds a slow
    // drift from the backcast, β ≈ 0.996, with log L higher by 0.0886.
    const c = B("garch-iid");
    const r = fitB(c);
    expect(r.llf - c.llf).toBeGreaterThan(0.088);
    expect(r.params[2]).toBeLessThan(1e-9);
    expect(Math.abs(r.params[3] - 0.99584)).toBeLessThan(1e-4);
    expect(garchKktAt(c.y, specOf(c), c.params).ok).toBe(true);
    expect(r.atBounds).toEqual(["α = 0"]);
  });
  test("GJR-t on iid returns: α and α + γ on 0, ν ≈ 42.3 (not the starting 12), above arch's optimum", () => {
    // Round 2's high-persistence start finds the same backcast-drift basin as GARCH on this series (β ≈ 0.997, log L
    // higher by 0.097 than arch's β ≈ 0.431, which also satisfies the KKT conditions); ν is pinned either way.
    const c = B("gjr-iid-t");
    const r = fitB(c);
    expect(r.llf - c.llf).toBeGreaterThan(0.097);
    expect(Math.abs(r.params[2])).toBeLessThan(1e-9);
    expect(Math.abs(r.params[3])).toBeLessThan(1e-9);
    expect(Math.abs(r.params[4] - 0.99658)).toBeLessThan(1e-4);
    expect(relErr(r.params[5], c.params[5])).toBeLessThan(5e-3);
    expect(garchKktAt(c.y, specOf(c), c.params).ok).toBe(true);
    expect(r.atBounds).toEqual(["α = 0", "α + γ = 0"]);
  });
  test("decimal returns into GJR: α on 0, rescaled fit, likelihood above arch's", () => {
    // arch's SLSQP stops 10⁻⁵ below the optimum here (the β/γ ridge is flat), so β and γ differ from arch's by ~10⁻³;
    // the unconditional variance (identified) agrees to 10⁻³ relative and the likelihood is higher.
    const c = B("garch-decimal");
    const r = fitB(c);
    expect(canonMs(c.y, r.scale, specOf(c).mean)).toBeCloseTo(1, 12);
    expect(r.params[2]).toBeLessThan(1e-9);
    expect(Math.abs(r.params[3] - c.params[3])).toBeLessThan(2e-3);
    expect(Math.abs(r.params[4] - c.params[4])).toBeLessThan(2e-3);
    const uv = (p: number[]) => p[1] / (1 - p[2] - p[3] / 2 - p[4]);
    expect(relErr(uv(r.params), uv(c.params))).toBeLessThan(1e-3);
    expect(r.atBounds).toEqual(["α = 0"]);
  });
  test("EGARCH-t with leverage: ν climbs to its bound 500 with a higher likelihood than arch's stop at ν ≈ 290; μ on a kink", () => {
    const c = B("egarch-t-lev");
    const r = fitB(c);
    expect(r.llf).toBeGreaterThan(c.llf + 5e-3);
    expect(r.params[5]).toBe(500);
    for (let j = 0; j < 5; j++) expect(Math.abs(r.params[j] - c.params[j])).toBeLessThan(3e-3);
    // μ sits exactly on a return (the kink of |rₜ − μ|): arch finds the same one.
    expect(c.y).toContain(r.params[0]);
    expect(Math.abs(r.params[0] - c.params[0])).toBeLessThan(1e-6);
  });
  test("the hard rule: the old stalled estimates fail the KKT check, the new ones pass", () => {
    const c = B("gjr-iid-t");
    // What v2.203.0-pre printed (reviewer's garch.txt): ν stuck at its start.
    const stalled = [0.000708275, 0.876672, 1.31817e-18, 0.00526765, 0.491799, 12.0002];
    expect(garchKktAt(c.y, specOf(c), stalled).ok).toBe(false);
    const r = fitGarch(c.y, specOf(c));
    if (!r.ok) throw new Error(r.reason);
    expect(garchKktAt(c.y, specOf(c), r.params).ok).toBe(true);
    // And through the calculator: printed, flagged on the bound, ν ≈ 42.3.
    const o = run(calc("ts-garch"), { data: ["r", ...c.y.map((v) => v.toFixed(3))].join("\n"), model: "gjr", dist: "t", mean: "constant" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/On the boundary of the parameter space: α = 0; α \+ γ = 0/);
    // Returns cannot move the variance there: it drifts deterministically from the backcast toward ω/(1 − β₁) at rate
    // β₁ (F2 review round 3: β₁ ≈ 0.997 is not "constant"), so the half-life printed is that drift's, ln 0.5 / ln β₁,
    // not a volatility shock's, and no leverage is quoted.
    const hlOf = (y: number[], dec: number, spec: GarchSpec): string => {
      const f = fitGarch(y.map((v) => Number(v.toFixed(dec))), spec);
      if (!f.ok) throw new Error(f.reason);
      return (Math.log(0.5) / Math.log(f.params[f.names.indexOf("beta")])).toFixed(1);
    };
    expect(o.text).toMatch(
      /α₁ and α₁ \+ γ₁ are on 0 \(within 10⁻⁴\), so returns do not move the variance: it follows a deterministic path from the starting \(backcast\) variance toward ω\/\(1 − β₁\), the gap shrinking by the factor β₁ each period, with half-life ln 0\.5 \/ ln β₁ = [\d.]+ periods \(the half-life of that drift, not of a response to shocks\)/,
    );
    expect(o.text).toContain(`ln β₁ = ${hlOf(c.y, 3, specOf(c))} periods`);
    expect(o.text).not.toMatch(/half-life of a volatility shock/);
    expect(o.text).toContain("Leverage: none to report, since α₁ and α₁ + γ₁ are on 0");
    expect(o.text).not.toContain("0.0000ε²");
    const g = B("garch-iid");
    const og = run(calc("ts-garch"), { data: ["r", ...g.y.map((v) => v.toFixed(6))].join("\n"), model: "garch", dist: "normal", mean: "constant" });
    expect(og.text).toMatch(/α₁ is on 0 \(within 10⁻⁴\), so returns do not move the variance: it follows a deterministic path from the starting \(backcast\) variance/);
    expect(og.text).toContain(`ln β₁ = ${hlOf(g.y, 6, { vol: "garch", dist: "normal", mean: "constant" })} periods`);
    // …and the forecast decays from σ²(T + 1) by β₁ a period, as arch's analytic forecast does.
    const fc = og.tables![1].rows.slice(1).map((row) => Number(row[1]));
    expect(fc[1]).toBeLessThan(fc[0]);
    expect(o.tables![0].rows.find((row) => row[0].startsWith("ν"))![1]).toMatch(/^42\.3/);
  });
  const nearIid = (seed: number): number[] => {
    // 150 near-iid returns (σ²ₜ = 0.1 + 0.5σ²ₜ₋₁), the round-1 adversarial pass's generator.
    const rng = new Pcg32(seed);
    const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
    const nrm = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    const y: number[] = [];
    let s2 = 1;
    for (let i = 0; i < 150; i++) {
      s2 = 0.1 + 0.5 * s2;
      y.push(Math.round(Math.sqrt(s2) * nrm() * 1000) / 1000);
    }
    return y;
  };
  test("a non-invertible EGARCH (rugged likelihood, no smooth maximum) is refused by name, not printed", () => {
    // Seed 4: every start ends where the recursion expands (mean ln|β₁ − (α₁|zₜ| + γ₁zₜ)/2| > 0) and the likelihood is
    // jagged; arch stops at its iteration limit (flag 9) at a point that fails the KKT check by 13.
    const y = nearIid(4);
    const o = run(calc("ts-garch"), { data: ["r", ...y.map((v) => v.toFixed(3))].join("\n"), model: "egarch", dist: "normal", mean: "zero" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^The likelihood maximization did not converge for this series: at the best EGARCH parameters found the recursion is not invertible/);
    // GARCH on the same series is fine.
    expect(run(calc("ts-garch"), { data: ["r", ...y.map((v) => v.toFixed(3))].join("\n"), model: "garch", dist: "normal", mean: "zero" }).ok).not.toBe(false);
  });
  test("an invertible EGARCH optimum prints even where the non-invertible region reaches a higher likelihood, with a caution", () => {
    // Seed 99 (round 1 refused it): the first start drifts into the non-invertible region (log L −75.78, no smooth
    // maximum); the other starts find arch's Zero-mean answer, β on 0 at log L −86.315, which satisfies the KKT check.
    const y = nearIid(99);
    const r = fitGarch(y, { vol: "egarch", dist: "normal", mean: "zero" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.converged).toBe(true);
    expect(r.egarchLyapunov).toBeLessThan(0);
    expect(Math.abs(r.llf - -86.315)).toBeLessThan(1e-3);
    expect(r.higherNonKkt!.noninvertible).toBe(true);
    const o = run(calc("ts-garch"), { data: ["r", ...y.map((v) => v.toFixed(3))].join("\n"), model: "egarch", dist: "normal", mean: "zero" });
    expect(o.text).toContain("Log likelihood = −86.315");
    expect(o.text).toMatch(/Caution: the search also reached a higher log likelihood at parameters where the first-order conditions do not hold \(an EGARCH recursion that is not invertible/);
  });
  test("a half-life under one period is not printed as a fraction of a period", () => {
    // A GARCH(1,1) with α = 0.35, β = 0.05 (n = 400, Pcg32 seed 3): fitted persistence ≈ 0.428, ln 0.5 / ln 0.428 ≈ 0.82.
    const rng = new Pcg32(3);
    const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
    const nrm = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    const y: number[] = [];
    let s2 = 1;
    let e = 0;
    for (let i = 0; i < 400; i++) {
      s2 = 0.5 + 0.35 * e * e + 0.05 * s2;
      e = Math.sqrt(s2) * nrm();
      y.push(Math.round(e * 1000) / 1000);
    }
    const o = run(calc("ts-garch"), { data: ["r", ...y.map((v) => v.toFixed(3))].join("\n"), model: "garch", dist: "normal" });
    expect(o.text).toContain("is under 1 period");
    expect(o.text).not.toMatch(/= 0\.\d+ periods/);
  });
});

describe("GARCH units, multi-start and degenerate corners (F2 review round 2)", () => {
  // Tolerances (stated): as the default-data block (parameters 3×10⁻⁴ in the fixture's units, log likelihood 10⁻⁶ after
  // the exact shift n ln c, SEs 2×10⁻³ relative); reviewer series: log L ≥ arch's − 10⁻⁶, printed (KKT holds).
  const n = F.data.garch.length;
  // Back to the fixture's units from data × c: μ/c, ω/c² (EGARCH ω − 2(1 − β) ln c), log L + n ln c.
  const back = (c: number, vol: string, names: string[], p: number[]): number[] =>
    p.map((v, j) => {
      if (names[j] === "mu") return v / c;
      if (names[j] === "omega") return vol === "egarch" ? v - 2 * (1 - p[names.findIndex((nm) => nm.startsWith("beta"))]) * Math.log(c) : v / (c * c);
      return v;
    });
  const cases: [number, number][] = [];
  for (const c of [0.14, 600, 1300]) for (let i = 0; i < F.garch.length; i++) cases.push([c, i]);
  test.each(cases)("default data × %s, spec %s: arch's optimum, exactly rescaled", (c, i) => {
    const fx = F.garch[i];
    const r = fitGarch(
      F.data.garch.map((v: number) => v * c),
      specOf(fx),
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.converged).toBe(true);
    expect(r.atBounds).toEqual([]);
    back(c, fx.vol, r.names, r.params).forEach((v, j) => expect(Math.abs(v - fx.params[j])).toBeLessThan(3e-4));
    expect(Math.abs(r.llf + n * Math.log(c) - fx.llf)).toBeLessThan(1e-6);
    r.names.forEach((nm, j) => {
      if (nm === "omega" && fx.vol === "egarch") return; // its SE mixes in cov(ω, β): the delta method, checked below
      const f = nm === "mu" ? c : nm === "omega" ? c * c : 1;
      expect(relErr(r.seRobust![j] / f, fx.seRobust[j])).toBeLessThan(2e-3);
    });
  });

  type R2 = { series: string; vol: string; dist: string; mean: string; params: number[]; llf: number };
  const R2: R2[] = F.garchRev2;
  test.each(R2.map((c, i) => [`${c.series} ${c.vol} ${c.dist} ${c.mean}`, i]) as [string, number][])("reviewer series %s: printed, log L ≥ arch's", (_l, i) => {
    // Low-volatility percent series (RMS 0.12, where round 1's raw-unit KKT gate refused), a zero segment, a β just
    // below 1 (round 1 crossed the bound with a central difference), and the two multi-start cases (114, 120).
    const c = R2[i];
    const y = F.garchRev2Y[c.series];
    const r = fitGarch(y, { vol: c.vol as GarchSpec["vol"], dist: c.dist as GarchSpec["dist"], mean: c.mean as GarchSpec["mean"] });
    if (!r.ok) throw new Error(r.reason);
    expect(r.converged).toBe(true);
    expect(r.llf).toBeGreaterThanOrEqual(c.llf - 1e-6);
    const o = run(calc("ts-garch"), { data: ["r", ...y.map((v: number) => String(v))].join("\n"), model: c.vol, dist: c.dist, mean: c.mean });
    expect(o.ok).not.toBe(false);
  });
  test("low-volatility series: ω is not flagged at its lower bound (the bound is 10⁻⁸ × mean r², judged relative to itself)", () => {
    const c = R2[0];
    const r = fitGarch(F.garchRev2Y[c.series], { vol: "garch", dist: "normal", mean: "constant" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.atBounds).toEqual([]);
  });
  test("multi-start: GARCH on iid n = 2,000 is not left at the first start's local optimum (round 1: log L −3,388.3975)", () => {
    // Three local optima: round 1's (β ≈ 0.377, −3,388.3975), arch's (β on 0, −3,388.3912) and the highest, β ≈ 0.956
    // with α ≈ 0.0044 (−3,388.1619), all satisfying the KKT conditions; the search keeps the highest.
    const c = R2.find((x) => x.series === "iid2000")!;
    const y = F.garchRev2Y.iid2000;
    const r = fitGarch(y, { vol: "garch", dist: "normal", mean: "constant" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.llf).toBeGreaterThan(c.llf + 0.2);
    expect(Math.abs(r.llf - -3388.1619)).toBeLessThan(1e-4);
    expect(garchKktAt(y, { vol: "garch", dist: "normal", mean: "constant" }, c.params).ok).toBe(true);
    expect(garchKktAt(y, { vol: "garch", dist: "normal", mean: "constant" }, r.params).ok).toBe(true);
  });
  test("the exact gradient agrees with central differences, all 12 specs", () => {
    const specs: GarchSpec[] = [];
    for (const vol of ["garch", "gjr", "egarch"] as const) for (const dist of ["normal", "t"] as const) for (const mean of ["constant", "zero"] as const) specs.push({ vol, dist, mean });
    for (const sp of specs) {
      const fx = F.garch.find((c: { vol: string; dist: string; mean: string }) => c.vol === sp.vol && c.dist === sp.dist && specOf(c).mean === sp.mean);
      // An interior point: the fixture's optimum when there is one, else a typical one, nudged off the optimum.
      const names = sp.mean === "constant" ? ["mu"] : [];
      names.push("omega", "alpha");
      if (sp.vol !== "garch") names.push("gamma");
      names.push("beta");
      if (sp.dist === "t") names.push("nu");
      const typical: Record<string, number> = { mu: 0.05, omega: sp.vol === "egarch" ? 0.02 : 0.04, alpha: 0.06, gamma: sp.vol === "egarch" ? -0.05 : 0.07, beta: 0.85, nu: 7 };
      const x = fx ? fx.params.map((v: number, j: number) => v * (1 + 0.03 * (j % 2 ? 1 : -1))) : names.map((nm) => typical[nm]);
      const q = garchKktAt(F.data.garch, sp, x);
      q.grad.forEach((g, j) => expect(Math.abs(g - q.numGrad[j]) / Math.max(1e-3, Math.abs(q.numGrad[j]))).toBeLessThan(1e-5));
    }
  });
  test("the canonical rescaling maps exactly: log L′ = log L − n ln kc, also with periods on the variance bounds", () => {
    for (const c of [0.14, 1, 600]) {
      const y = F.data.garch.map((v: number) => v * c);
      for (const fx of F.garch) {
        const x = back(1 / c, fx.vol, fx.names, fx.params);
        const q = garchKktAt(y, specOf(fx), x);
        expect(Math.abs(q.llfCanon - (q.llf - n * Math.log(q.kc)))).toBeLessThan(1e-9 * Math.abs(q.llf));
        // …and it is arch's own objective on the data as typed (setup computed in y's units).
        expect(Math.abs(q.llf - garchAtParams(y, specOf(fx), x)!.llf)).toBeLessThan(1e-9 * Math.abs(q.llf));
        // kc = 1/√(mean squared residual): the canonical series has mean squared residual 1.
        expect(canonMs(y, q.kc, specOf(fx).mean)).toBeCloseTo(1, 12);
      }
    }
    // The zero segment with ω = 10⁻⁹: the variance decays onto arch's floor through the 100 zero returns.
    const z = F.garchRev2Y.zeroseg;
    for (const [sp, x] of [
      [{ vol: "garch", dist: "normal", mean: "constant" }, [0.01, 1e-9, 0.4, 0.6]],
      [{ vol: "egarch", dist: "t", mean: "constant" }, [0.01, -30, 0.2, -0.1, 0.5, 5]],
    ] as [GarchSpec, number[]][]) {
      const q = garchKktAt(z, sp, x);
      expect(Number.isFinite(q.llf)).toBe(true);
      expect(Math.abs(q.llfCanon - (q.llf - z.length * Math.log(q.kc)))).toBeLessThan(1e-9 * Math.abs(q.llf));
    }
  });
  test("the KKT verdict and the printed model do not depend on the units", () => {
    const fx = F.garch[1];
    const texts = [1e-3, 1, 1e4].map((c) => {
      const r = fitGarch(
        F.data.garch.map((v: number) => v * c),
        specOf(fx),
      );
      if (!r.ok) throw new Error(r.reason);
      expect(r.converged).toBe(true);
      return [r.persistence.toFixed(6), (r.llf + n * Math.log(c)).toFixed(6)].join(" ");
    });
    expect(new Set(texts).size).toBe(1);
  });
  test("a run of 100 zero returns into GARCH-t: refused by name as degenerate, with no advice it already follows", () => {
    // Round 2 refused it as not converged ("Try GJR-GARCH or EGARCH, normal errors, or a longer series."); the search
    // was chasing the variance floor: 84 of the 800 periods sit there at the best point, so that is now named.
    const y = F.garchRev2Y.zeroseg.map((v: number) => String(v));
    const t = run(calc("ts-garch"), { data: ["r", ...y].join("\n"), model: "garch", dist: "t", mean: "constant" });
    expect(t.ok).toBe(false);
    expect(t.text).toMatch(/^The likelihood is unbounded here: at the best parameters found \d+ of the 800 periods sit at the variance floor/);
    expect(t.text).not.toContain("Try the normal distribution");
  });
  test("a fit with half its periods on the variance floor is refused by name (round 3: it printed with a caution)", () => {
    // ±1 alternating returns into EGARCH-t: μ goes to −1, so every other period's variance falls onto arch's floor,
    // where the likelihood keeps rising as the floor is lowered: degenerate, not a fit.
    const y = Array.from({ length: 100 }, (_, i) => (i % 2 ? "1" : "-1"));
    const o = run(calc("ts-garch"), { data: ["r", ...y].join("\n"), model: "egarch", dist: "t", mean: "constant" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^The likelihood is unbounded here: at the best parameters found \d+ of the 100 periods sit at the variance floor .* so the fit and its AIC are not meaningful and no estimates are reported\./);
    // The default fit has no period on a bound.
    const d = run(calc("ts-garch")).text!;
    expect(d).not.toContain("variance bounds (its floor");
    expect(d).not.toMatch(/Caution: \d+ of the 500 periods/);
  });
});

describe("GARCH calculator wording on given fits (F2 review round 3: advice, the α₁ = 0 tolerance, overflow)", () => {
  // fitGarch stubbed so the wording is pinned on fits no natural series reaches cheaply: a work-limit refusal at
  // n = 2,500, a GJR whose α₁ + γ₁ is 1.6×10⁻⁶ (inside the 10⁻⁴ boundary list, outside a 10⁻¹² test), a forecast that
  // overflows.
  const stub = (over: Partial<GarchFit>): GarchFit => ({
    ok: true,
    spec: { vol: "gjr", dist: "t", mean: "constant" },
    names: ["mu", "omega", "alpha", "gamma", "beta", "nu"],
    params: [0.05, 0.002, 0, 1.61e-6, 0.99, 8],
    llf: -700,
    seRobust: null,
    seClassic: null,
    seWhy: "the estimated covariance matrix is not positive definite at the estimate",
    sigma2: new Float64Array(500).fill(0.2),
    resid: new Float64Array(500).fill(0.1),
    backcast: 0.25,
    n: 500,
    converged: true,
    kktGradient: 1e-9,
    workLimitHit: false,
    higherNonKkt: null,
    clamped: 0,
    floored: 0,
    egarchLyapunov: NaN,
    atBounds: ["α = 0", "α + γ = 0"],
    persistence: 0.99 + 1.61e-6 / 2,
    forecast: Array.from({ length: 250 }, () => 0.2),
    scale: 1,
    ...over,
  });
  const runWith = (fit: GarchFit, model = "gjr", dist = "t") => {
    const spy = jest.spyOn(ts2Module, "fitGarch").mockReturnValue(fit);
    try {
      return run(calc("ts-garch"), { model, dist, mean: "constant" });
    } finally {
      spy.mockRestore();
    }
  };
  test("advice offers a longer series only below the most a fit takes (round 3 offered it at n = 2,500)", () => {
    const at = (n: number) => runWith(stub({ n, converged: false, workLimitHit: true, kktGradient: 0.3 }));
    const full = at(2500);
    expect(full.ok).toBe(false);
    expect(full.text).toMatch(/hit its work limit/);
    expect(full.text).toContain("Try GARCH or EGARCH, or normal errors.");
    expect(full.text).not.toContain("longer series");
    expect(at(500).text).toContain("Try GARCH or EGARCH, normal errors, or a longer series.");
    // Normal errors are not suggested to a normal fit (round 1).
    const nrm = runWith(stub({ n: 500, converged: false, workLimitHit: false, spec: { vol: "garch", dist: "normal", mean: "constant" } }), "garch", "normal");
    expect(nrm.text).toContain("Try GJR-GARCH or EGARCH, Student-t errors, or a longer series.");
  });
  test("α₁ + γ₁ = 1.6×10⁻⁶ on the boundary list gets the drift line, not a shock half-life or 0.0000ε² leverage", () => {
    const o = runWith(stub({}));
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("On the boundary of the parameter space: α = 0; α + γ = 0.");
    expect(o.text).toContain("α₁ and α₁ + γ₁ are on 0 (within 10⁻⁴), so returns do not move the variance: it follows a deterministic path");
    expect(o.text).toContain(`ln β₁ = ${(Math.log(0.5) / Math.log(0.99)).toFixed(1)} periods (the half-life of that drift, not of a response to shocks)`);
    expect(o.text).not.toMatch(/half-life of a volatility shock/);
    expect(o.text).not.toContain("0.0000ε²");
    // β₁ = 0: constant at ω; β₁ at 1: grows by ω a period.
    expect(runWith(stub({ params: [0.05, 0.2, 0, 0, 0, 8], persistence: 0 })).text).toContain("and with β₁ = 0 it is constant at ω");
    expect(runWith(stub({ params: [0.05, 0.002, 0, 0, 1, 8], persistence: 1 })).text).toContain("and with β₁ at 1 it follows a deterministic path from the starting (backcast) variance, growing by ω each period");
  });
  test("a forecast that overflows a double is named (round 3: “A fitted quantity is not a finite number”)", () => {
    // The round-3 case: EGARCH-t with β₁ = 1 and α₁ ≈ 3.5 ahead of a last return of 10⁶ (z ≈ 5×10⁵) puts ln σ²(T + 1)
    // past ln(max double); that series is now refused earlier, as degenerate (every period at the floor).
    const o = runWith(stub({ spec: { vol: "egarch", dist: "t", mean: "constant" }, atBounds: ["β = 1"], forecast: [Infinity], params: [0.05, 3.5, 3.5, 0, 1, 2.4], persistence: 1 }), "egarch");
    expect(o.ok).toBe(false);
    expect(o.text).toBe("At the estimates, the variance forecast is not a finite double-precision number for this series (it overflows), so the result is not reported.");
  });
});

describe("GARCH units, the EGARCH β = 1 face and degenerate fits (F2 review round 3)", () => {
  // Tolerances (stated): across units ×10ᵏ, estimates 10⁻⁶ relative (ω of EGARCH after its shift 2(1 − β) ln c,
  // 10⁻⁶ absolute) and log L 10⁻⁶ after n ln c; against arch (garchRev3: fitted as typed and on the canonical series),
  // log L ≥ arch's − 10⁻⁶ wherever arch's point satisfies our KKT check.
  type R3 = { series: string; vol: string; dist: string; mean: string; typed: { params: number[]; llf: number }; canon: { params: number[]; llf: number }; half?: { params: number[]; llf: number } };
  const R3 = (id: string): R3 => (F.garchRev3 as R3[]).find((c) => c.series === id)!;
  const specR = (c: R3): GarchSpec => ({ vol: c.vol as GarchSpec["vol"], dist: c.dist as GarchSpec["dist"], mean: c.mean as GarchSpec["mean"] });
  const toUnits1 = (sp: GarchSpec, p: number[], c: number): number[] => {
    const q = p.slice();
    const km = sp.mean === "constant" ? 1 : 0;
    if (km) q[0] /= c;
    const iB = sp.vol === "garch" ? km + 2 : km + 3;
    q[km] = sp.vol === "egarch" ? q[km] - 2 * (1 - q[iB]) * Math.log(c) : q[km] / (c * c);
    return q;
  };
  const sameAcrossUnits = (y: number[], sp: GarchSpec) => {
    const base = fitGarch(y, sp);
    if (!base.ok) throw new Error(base.reason);
    expect(base.converged).toBe(true);
    for (const c of [0.01, 0.1, 10, 100]) {
      const r = fitGarch(
        y.map((v) => v * c),
        sp,
      );
      if (!r.ok) throw new Error(r.reason);
      expect(r.converged).toBe(true);
      expect(r.atBounds).toEqual(base.atBounds);
      expect(r.floored).toBe(base.floored);
      expect(Math.abs(r.llf + y.length * Math.log(c) - base.llf)).toBeLessThan(1e-6);
      toUnits1(sp, r.params, c).forEach((v, j) =>
        expect(Math.abs(v - base.params[j])).toBeLessThan(base.names[j] === "omega" && sp.vol === "egarch" ? 1e-6 : 1e-6 * Math.max(1e-3, Math.abs(base.params[j]))),
      );
    }
    return base;
  };
  test("EGARCH-normal on a stale-run series: the same answer at ×0.01 … ×100, arch's on the canonical series (round 3: −2,478.713 at ×1, −2,477.088 at ×10)", () => {
    const c = R3("stale2-1200-2");
    const r = sameAcrossUnits(F.garchRev3Y[c.series], specR(c));
    expect(Math.abs(r.llf - c.canon.llf)).toBeLessThan(1e-6);
    r.params.forEach((v, j) => expect(Math.abs(v - c.canon.params[j])).toBeLessThan(3e-4));
    expect(r.llf).toBeGreaterThan(-2478.7126 + 1.6);
  });
  test("EGARCH-t on a stale-run series: the β = 1, ν = 2.05 optimum (round 3 printed −2,070.409), at every scale", () => {
    const c = R3("stale1200");
    const y = F.garchRev3Y[c.series];
    const r = sameAcrossUnits(y, specR(c));
    expect(r.atBounds).toEqual(["β = 1", "ν = 2.05"]);
    expect(r.llf).toBeGreaterThanOrEqual(c.canon.llf - 1e-6);
    // arch as typed stops at nearly the same point; scored by our objective (arch's bounds on the canonical series) it
    // is not above ours. (arch's own −2,047.593 differs by 0.02: one period above arch's variance cap, 1 + max r²,
    // which is not scale-equivariant, so it moves with the units.)
    // Ours satisfies the KKT conditions to 10⁻¹⁶; arch's typed point fails them (projected gradient 3×10⁻⁵) and sits
    // 5×10⁻⁵ higher across a kink of the clamped periods (the likelihood is not smooth there: the floor caution).
    const q = garchKktAt(y, specR(c), c.typed.params);
    expect(q.ok).toBe(false);
    expect(r.llf).toBeGreaterThanOrEqual(q.llf - 1e-4);
    expect(r.llf - -2070.409).toBeGreaterThan(22);
    // Periods at the floor below the refusal threshold get a caution with their count.
    expect(r.floored).toBeGreaterThan(0);
    expect(r.floored).toBeLessThan(0.05 * y.length);
    const o = run(calc("ts-garch"), { data: ["r", ...y.map((v: number) => String(v))].join("\n"), model: "egarch", dist: "t", mean: "zero" });
    expect(o.text).toContain(`Caution: ${r.floored} of the 1,200 periods`);
  });
  test("EGARCH-normal refused as non-invertible in round 3 now prints an invertible optimum above arch's (−798.62)", () => {
    const c = R3("stale2-300-3");
    const y = F.garchRev3Y[c.series];
    const sp = specR(c);
    // The reviewer's arch point (arch on the series × 0.5) satisfies our KKT check: an invertible β = 1 optimum.
    expect(garchKktAt(y, sp, c.half!.params).ok).toBe(true);
    const r = fitGarch(y, sp);
    if (!r.ok) throw new Error(r.reason);
    expect(r.converged).toBe(true);
    expect(r.egarchLyapunov).toBeLessThan(0);
    expect(r.llf).toBeGreaterThanOrEqual(c.half!.llf - 1e-6);
    expect(r.llf).toBeGreaterThanOrEqual(c.canon.llf - 1e-6);
    // The non-invertible region reaches higher (rugged, no smooth maximum): said beside the estimates.
    expect(r.higherNonKkt!.noninvertible).toBe(true);
    const o = run(calc("ts-garch"), { data: ["r", ...y.map((v: number) => String(v))].join("\n"), model: "egarch", dist: "normal", mean: "constant" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain(`Log likelihood = ${fmtFixed(r.llf, 3)}`);
  });
  test("tiny but nonzero returns are fitted; all zeros and subnormal returns are refused by name", () => {
    const base = F.data.garch.slice(0, 200) as number[];
    const sp: GarchSpec = { vol: "garch", dist: "normal", mean: "constant" };
    const r1 = fitGarch(base, sp);
    const r2 = fitGarch(
      base.map((v) => v * 1e-200),
      sp,
    );
    if (!r1.ok || !r2.ok) throw new Error("refused");
    expect(Math.abs(r2.llf + 200 * Math.log(1e-200) - r1.llf)).toBeLessThan(1e-5);
    expect(fitGarch(new Array(200).fill(0), sp)).toEqual({ ok: false, reason: "Every return is zero, so there is no volatility to model." });
    const sub = fitGarch(
      base.map((v) => v * 1e-320),
      sp,
    );
    expect(sub.ok).toBe(false);
    if (!sub.ok) expect(sub.reason).toMatch(/too small or too large to rescale in double precision/);
  });
});

// ================================================================ VAR vs statsmodels

describe("VAR vs statsmodels", () => {
  const cases = [
    ["default (p by AIC)", F.var, F.data.var],
    ["holdout K = 2", F.varHoldout[0], F.data.varHold2],
    ["holdout K = 4", F.varHoldout[1], F.data.varHold4],
    ["p = 2", F.varHoldout[2], F.data.var],
    ["p = 4", F.varHoldout[3], F.data.var],
  ];
  test.each(cases)("%s", (_l, c, rows) => {
    const cols = colsOf(rows);
    const K = c.names.length;
    const so = varSelectOrder(cols, c.maxlags);
    if ("ok" in so) throw new Error(so.reason);
    so.rows.forEach((r, i) => {
      expect(Math.abs(r.aic - c.ics.aic[i])).toBeLessThan(1e-9);
      expect(Math.abs(r.bic - c.ics.bic[i])).toBeLessThan(1e-9);
      expect(Math.abs(r.hqic - c.ics.hqic[i])).toBeLessThan(1e-9);
      expect(relErr(r.fpe, c.ics.fpe[i])).toBeLessThan(1e-9);
    });
    expect(so.selected).toEqual(c.selected);
    const f = fitVarOls(cols, c.p)!;
    expect(f.nobs).toBe(c.nobs);
    f.B.flat().forEach((v, i) => expect(Math.abs(v - c.params[i])).toBeLessThan(1e-9));
    f.B.forEach((row, r) => row.forEach((_, e) => expect(Math.abs(Math.sqrt(f.xtxInv[r][r] * f.sigmaU[e][e]) - c.stderr[r * K + e])).toBeLessThan(1e-9)));
    f.sigmaU.flat().forEach((v, i) => expect(Math.abs(v - c.sigmaU[i])).toBeLessThan(1e-9));
    let gi = 0;
    for (let i = 0; i < K; i++)
      for (let j = 0; j < K; j++) {
        if (i === j) continue;
        const g = varGranger(f, i, j);
        const o = c.causality[gi++];
        expect(relErr(g.F, o.F)).toBeLessThan(1e-9);
        expect([g.df1, g.df2]).toEqual([o.df1, o.df2]);
        expect(Math.abs(g.p - o.p)).toBeLessThan(1e-9);
      }
    const ir = varIrf(f, c.periods);
    if ("ok" in ir) throw new Error(ir.reason);
    ir.orth.flatMap((m) => m.flat()).forEach((v, i) => expect(Math.abs(v - c.orthIrf[i])).toBeLessThan(1e-9));
    ir.se.flatMap((m) => m.flat()).forEach((v, i) => expect(Math.abs(v - c.orthIrfSe[i])).toBeLessThan(1e-9));
    ir.fevd.flatMap((m) => m.flat()).forEach((v, i) => expect(Math.abs(v - c.fevd[i])).toBeLessThan(1e-9));
  });
});

// ================================================================ cointegration

describe("Engle–Granger vs statsmodels coint", () => {
  const sets: [string, { trend: "c" | "ct"; stat: number; p: number; crit: number[] }[], number[][]][] = [
    ["default", F.eg, F.data.coint],
    ["holdout 2 series", F.egHoldout.slice(0, 2), F.data.cointHold2],
    ["holdout 4 series", F.egHoldout.slice(2), F.data.cointHold4],
  ];
  test.each(sets)("%s", (_l, cs, rows) => {
    const cols = colsOf(rows);
    for (const c of cs) {
      const r = engleGranger(cols[0], cols.slice(1), c.trend);
      if (!r.ok) throw new Error(r.reason);
      expect(Math.abs(r.stat - c.stat)).toBeLessThan(1e-9);
      expect(relErr(r.p, c.p)).toBeLessThan(1e-4);
      r.crit.forEach((v, i) => expect(Math.abs(v - c.crit[i])).toBeLessThan(1e-12));
    }
  });
  test("the MacKinnon N-variable tables are statsmodels' entry for entry", () => {
    for (const reg of ["c", "ct"] as const) {
      const mine = MACKINNON_N[reg];
      const theirs = F.tables.mackinnon[reg];
      for (const key of ["tauStar", "tauMin", "tauMax", "smallp", "largep", "crit2010"] as const) {
        const a = (mine[key] as unknown[]).flat(2) as number[];
        const b = (theirs[key] as unknown[]).flat(2) as number[];
        expect(a.length).toBe(b.length);
        a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-14 * Math.max(1, Math.abs(b[i]))));
      }
    }
    // One-series surface agrees with tsDiag's (N = 1).
    for (const tau of [-4.2, -2.5, -1, 0.5]) for (const reg of ["c", "ct"] as const) expect(mackinnonPN(tau, reg, 1)).toBeCloseTo(mackinnonP(tau, reg), 14);
    expect(mackinnonCritN("c", 1, Infinity)[1]).toBeCloseTo(-2.86154, 5);
  });
});

describe("Johansen vs statsmodels coint_johansen", () => {
  const sets: [string, { det: -1 | 0 | 1; kdiff: number; eig: number[]; trace: number[]; maxEig: number[]; cvt: number[]; cvm: number[] }[], number[][]][] = [
    ["default (det −1, 0, 1 × k 1, 2)", F.johansen, F.data.coint],
    ["holdout 2 series", F.johansenHoldout.slice(0, 1), F.data.cointHold2],
    ["holdout 4 series (k = 3, k = 0)", F.johansenHoldout.slice(1), F.data.cointHold4],
  ];
  test.each(sets)("%s", (_l, cs, rows) => {
    const cols = colsOf(rows);
    for (const c of cs) {
      const r = johansen(cols, c.det, c.kdiff);
      if (!r.ok) throw new Error(r.reason);
      r.eig.forEach((v, i) => expect(Math.abs(v - c.eig[i])).toBeLessThan(1e-9));
      r.trace.forEach((v, i) => expect(Math.abs(v - c.trace[i])).toBeLessThan(1e-8));
      r.maxEig.forEach((v, i) => expect(Math.abs(v - c.maxEig[i])).toBeLessThan(1e-8));
      expect(r.cvt.flat()).toEqual(c.cvt);
      expect(r.cvm.flat()).toEqual(c.cvm);
    }
  });
  test("the Osterwald-Lenum tables are statsmodels' (n − r = 1…6)", () => {
    for (const d of ["-1", "0", "1"] as const) {
      expect(JOHANSEN_SJT[d]).toEqual(F.tables.sjt[d].slice(0, 6));
      expect(JOHANSEN_SJA[d]).toEqual(F.tables.sja[d].slice(0, 6));
    }
  });
});

// ================================================================ the calculators

describe("TS2_STAT_CALCS: the pane's contract", () => {
  test("ids are lowercase kebab and unique", () => {
    const ids = TS2_STAT_CALCS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/));
  });
  test.each(TS2_STAT_CALCS.map((c) => [c.id, c] as [string, StatCalcDef]))("%s: defaults compute, tables ≤ 6 columns, insertable, figure", (_id, c) => {
    const cc = c as StatCalcDef;
    for (const f of cc.fields) if (f.kind === "select") expect((f.options ?? []).map((o) => o.value)).toContain(f.default);
    const o = run(cc);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).not.toContain("—");
    expect(o.text).toMatch(/Conventions/);
    expect(o.svg).toMatch(/^<svg/);
    for (const t of o.tables ?? []) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) {
        expect(row.length).toBe(t.rows[0].length);
        for (const cell of row) if (cell !== "") expect(insertableResultText(cell)).toBe(true);
      }
      if (t.align) expect(t.align.length).toBe(t.rows[0].length);
    }
    // No ASCII minus before a digit, no e-notation in the printed result.
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/);
    expect(o.text).not.toMatch(/\de[+-]?\d/);
  });
  test("the registry module draws no Math.random", () => {
    for (const f of ["ts2StatCalcs.ts", "ts2.ts"]) expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toMatch(/Math\.random\s*\(/);
  });
});

describe("printed defaults (TEST-SCRIPT values)", () => {
  test("ts-garch", () => {
    const o = run(calc("ts-garch"));
    expect(o.text).toContain("GJR-GARCH(1,1,1) with Student-t errors and a constant mean for Return (n = 500)");
    expect(o.text).toContain("Log likelihood = −547.305 · AIC = 1,106.610 · BIC = 1,131.898 (k = 6 parameters)");
    expect(o.text).toContain("Persistence α₁ + γ₁/2 + β₁ = 0.8453; half-life of a volatility shock = ln 0.5 / ln(persistence) = 4.12 periods");
    expect(o.text).toContain("σ²(T + 1) = 0.48510");
    expect(o.text).not.toContain("The returns' root mean square is outside");
    const t = o.tables![0].rows;
    expect(t[5]).toEqual(["β₁", "0.7654", "0.0729", "10.502", P_BELOW, "0.1086"]);
    expect(t[6][0]).toBe("ν (degrees of freedom)");
    expect(t[6][1]).toBe("8.732");
  });
  test("ts-var", () => {
    const o = run(calc("ts-var"));
    expect(o.text).toContain("Lag order selected: AIC 1, BIC 1, HQ 1, FPE 1; p = 1 (chosen by AIC from p = 0…8).");
    expect(o.text).toContain("Granger causality at 5%: Rate → Inflation (p = 0.011); Growth → Rate (p = 0.002).");
    expect(o.tables![0].rows[2]).toEqual(["1", "−4.1399*", "−3.8486*", "−4.0217*", "0.01593*"]);
  });
  test("ts-var-irf", () => {
    const o = run(calc("ts-var-irf"));
    expect(o.text).toContain("FEVD of Rate at h = 10: Growth 35.4%, Inflation 20.7%, Rate 43.9%");
    expect(o.tables![0].rows[1]).toEqual(["0", "0.827 (0.054)", "0.206 (0.044)", "0.112 (0.034)"]);
  });
  test("ts-engle-granger", () => {
    const o = run(calc("ts-engle-granger"));
    expect(o.text).toContain(`Residual ADF τ = −6.8215, MacKinnon p ${P_BELOW}; critical values 1% −4.375, 5% −3.789, 10% −3.487.`);
  });
  test("ts-johansen", () => {
    const o = run(calc("ts-johansen"));
    expect(o.text).toContain("Cointegrating rank at 5%: 1 by the trace test, 1 by the maximum-eigenvalue test.");
    expect(o.tables![0].rows[1]).toEqual(["r = 0", "0.1508", "40.406*", "27.067", "29.796", "35.463"]);
    expect(o.tables![1].rows[0][0]).toBe("H₀: rank = r");
  });
  test("the calculators reproduce the oracle through the pane read path", () => {
    // ts-var at p = 2 → the oracle's p = 2 Granger F; ts-johansen det 1, k 2 → its trace.
    const v = run(calc("ts-var"), { p: "2" });
    const g = F.varHoldout[2].causality[4];
    expect(v.tables!.find((t) => t.label.startsWith("Granger"))!.rows[5][2]).toBe(g.F.toFixed(3));
    const j = run(calc("ts-johansen"), { det: "1", kdiff: "2" });
    expect(j.tables![0].rows[1][2].replace("*", "")).toBe(F.johansen[5].trace[0].toFixed(3));
    for (const [model, idx] of [["garch", 1], ["egarch", 5]] as const) {
      const o = run(calc("ts-garch"), { model });
      expect(o.ok).not.toBe(false);
      expect(o.text).toContain(`Log likelihood = ${F.garch[idx].llf.toFixed(3).replace("-", "−")}`);
    }
  });
});

describe("hostile inputs: every refusal names its field", () => {
  const G = calc("ts-garch");
  const V = calc("ts-var");
  const I = calc("ts-var-irf");
  const E = calc("ts-engle-granger");
  const J = calc("ts-johansen");
  const refused = (o: StatOutput, re: RegExp): void => {
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).not.toContain("—");
  };
  test("blank, too short, too long", () => {
    refused(run(G, { data: "" }), /./);
    refused(run(G, { data: "Return\n0.1\n0.2\n0.3\n0.4" }), /at least 100/);
    const big = ["Return", ...Array.from({ length: 5001 }, (_, i) => String(((i * 7919) % 200) / 100 - 1))].join("\n");
    refused(run(G, { data: big }), /at most 2,500/);
    refused(run(V, { data: "A B\n1 2\n2 3\n3 1" }), /at least 12/);
    refused(run(J, { data: "Y X\n1 2\n2 3\n3 1\n4 4" }), /at least 20/);
  });
  test("numbers: NaN, 1e400, decimal commas, thousands, true minus", () => {
    const rows = F.data.garch.slice(0, 200).map((v: number) => v.toFixed(3));
    const base = ["Return", ...rows].join("\n");
    refused(run(G, { data: base.replace(rows[10], "NaN") }), /Row 11|NaN|not a number/i);
    refused(run(G, { data: base.replace(rows[10], "1e400") }), /Row 11|finite|1e400|large/i);
    const dot = run(G, { data: base, model: "garch", dist: "normal" });
    expect(dot.ok).not.toBe(false);
    const trueMinus = run(G, { data: base.split("-").join("−"), model: "garch", dist: "normal" });
    expect(trueMinus.text.split("\n")[1]).toBe(dot.text.split("\n")[1]);
    // Decimal commas in a comma-free table where "2,073" could equally be two thousand: refused as ambiguous, by row.
    refused(run(G, { data: ["Return", ...rows.map((s: string) => s.replace(".", ","))].join("\n"), model: "garch", dist: "normal" }), /mixes a decimal comma .* thousands separator/);
    // …and read as decimals once the table is semicolon-separated (every comma is then a decimal comma).
    const semi = run(G, { data: ["Date;Return", ...rows.map((s: string, i: number) => `${2000 + i};${s.replace(".", ",")}`)].join("\n"), model: "garch", dist: "normal" });
    expect(semi.ok).not.toBe(false);
    expect(semi.text.split("\n")[1]).toBe(dot.text.split("\n")[1]);
    // "1,000" among point decimals is one thousand (the shared reader's thousands rule), so the fit changes.
    const thousands = run(G, { data: ["Return", ...rows.map((s: string, i: number) => (i === 3 ? "1,000" : s))].join("\n"), model: "garch", dist: "normal" });
    const thousandsDot = run(G, { data: ["Return", ...rows.map((s: string, i: number) => (i === 3 ? "1000" : s))].join("\n"), model: "garch", dist: "normal" });
    expect(thousands.ok).not.toBe(false);
    expect(thousands.text.split("\n")[1]).toBe(thousandsDot.text.split("\n")[1]);
  });
  test("whole-number fields", () => {
    for (const bad of ["0", "-1", "−1", "2.5", "1e400", "NaN", "5%", "abc", "251"]) refused(run(G, { h: bad }), /Forecast horizon/);
    for (const bad of ["0", "25", "x"]) refused(run(I, { h: bad }), /Impulse-response horizon/);
    for (const bad of ["0", "13", "x"]) refused(run(V, { maxlags: bad }), /Largest lag/);
    refused(run(V, { p: "13" }), /Lag order p/);
    refused(run(J, { kdiff: "13" }), /Lagged differences/);
    // Whole numbers go through the shared cell reader: "1,0" is the decimal-comma 1.0, "1,000" is 1000 (too large).
    expect(run(G, { h: "1,0" }).tables![1].rows.length).toBe(2);
    refused(run(G, { h: "1,000" }), /Forecast horizon: “1,000” is not a whole number from 1 to 250/);
    expect(run(G, { h: "20" }).tables![1].rows.length).toBe(21);
  });
  test("selects", () => {
    refused(run(G, { model: "arch" }), /volatility model/);
    refused(run(G, { dist: "ged" }), /error distribution/);
    refused(run(G, { mean: "ar" }), /mean model/);
    refused(run(E, { trend: "n" }), /deterministic option/);
    refused(run(J, { det: "2" }), /deterministic option/);
  });
  test("columns", () => {
    refused(run(V, { columns: "Growth" }), /at least 2/);
    refused(run(V, { columns: "Growth, Nope" }), /No column is named “Nope”/);
    refused(run(V, { columns: "Growth, Growth" }), /listed twice/);
    const wide = ["T A B C D E F", ...Array.from({ length: 40 }, (_, i) => `${i + 1} ${[1, 2, 3, 4, 5, 6].map((k) => Math.sin(i * k) + k).join(" ")}`)].join("\n");
    refused(run(V, { data: wide }), /at most 5 series/);
    refused(run(E, { data: wide.replace("T A B C D E F", "T A B C D E F G").split("\n").map((l, i) => (i ? `${l} ${Math.cos(i)}` : l)).join("\n") }), /at most 6 series/);
    const constant = ["A B", ...Array.from({ length: 30 }, (_, i) => `${Math.sin(i)} 5`)].join("\n");
    refused(run(V, { data: constant }), /“B” is constant/);
    // Columns named with spaces only: whitespace-separated names.
    expect(run(V, { columns: "Rate Growth" }).ok).not.toBe(false);
  });
  test("gaps in dates are refused, not skipped", () => {
    const lines = (V.fields[0].default as string).split("\n");
    lines.splice(10, 1);
    refused(run(V, { data: lines.join("\n") }), /not evenly spaced/);
  });
  test("collinear and singular data", () => {
    const n = 60;
    const rows = Array.from({ length: n }, (_, i) => {
      const x = 10 + Math.sin(i) + i * 0.1;
      return `${2 * x + 1} ${x}`;
    });
    refused(run(E, { data: ["Y X", ...rows].join("\n") }), /exact linear combination/);
    refused(run(V, { data: ["Y X", ...rows].join("\n") }), /singular|exactly/);
    refused(run(J, { data: ["Y X", ...rows].join("\n") }), /singular|exact/);
  });
  test("Johansen with too many lags for the sample", () => {
    const short = (J.fields[0].default as string).split("\n").slice(0, 25).join("\n");
    refused(run(J, { data: short, kdiff: "12" }), /Lagged|fewer lags|usable rows/);
  });
  test("maxlags beyond what the sample estimates", () => {
    const short = (V.fields[0].default as string).split("\n").slice(0, 31).join("\n");
    refused(run(V, { data: short, maxlags: "12" }), /largest lag for the lag-order criteria can be at most 6/);
    // ts-var-irf with p entered ignores the largest lag (it is used only to choose p).
    const irf = run(I, { data: short, maxlags: "12", p: "1" });
    expect(irf.ok).not.toBe(false);
    refused(run(I, { data: short, maxlags: "12", p: "aic" }), /can be at most 6/);
  });
});

describe("adversarial findings (fixed)", () => {
  // A deterministic LCG + Box–Muller (test data only; the calculators draw nothing random).
  const gen = (): (() => number) => {
    let s = 12345;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  };
  test("integrated GARCH (α + β → 1): no 10¹⁵-period half-life or 10¹³ unconditional variance", () => {
    const nrm = gen();
    for (let i = 0; i < 1000; i++) nrm();
    const y: string[] = [];
    let v = 1;
    let e = 0;
    for (let i = 0; i < 2000; i++) {
      v = 0.001 + 0.1 * e * e + 0.9 * v;
      e = Math.sqrt(v) * nrm();
      y.push(e.toFixed(4));
    }
    const o = run(calc("ts-garch"), { data: ["R", ...y].join("\n"), model: "garch", dist: "normal" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("at 1 (integrated volatility)");
    expect(o.text).not.toMatch(/half-life of a volatility shock = /);
    expect(o.text).not.toContain("Unconditional variance");
    expect(o.text).toContain("growing by ω each period");
    expect(o.text).toContain("On the boundary of the parameter space: α + β = 1");
  });
  test("white noise into GJR: α on its bound prints 0.0000, not 7×10⁻¹⁵, and is flagged", () => {
    const nrm = gen();
    const y = ["Return", ...Array.from({ length: 1000 }, () => nrm().toFixed(3))].join("\n");
    const o = run(calc("ts-garch"), { data: y, model: "gjr", dist: "t" });
    expect(o.ok).not.toBe(false);
    // R6 #10: with a constant mean the asymmetric term reads rₜ₋₁ − μ, so "a return above its mean", not "a positive one".
    expect(o.text).toContain("one above it by α₁ε² = 0.0000ε²");
    expect(o.text).toMatch(/On the boundary of the parameter space: α = 0/);
  });
});

describe("sweep: every select option and the numeric edges keep the display contract and the figure layout", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const audit = require(path.join(__dirname, "..", "..", "..", "scripts", "figure-layout-audit.js")) as {
    auditSvg: (name: string, svg: string) => { found: unknown[] };
  };
  const longNames = (() => {
    const lines = ["Quarter RealGrowthRateAnnualised CoreInflation PolicyRate UnemploymentGap CreditSpread"];
    (F.data.varHold4 as number[][]).slice(0, 120).forEach((r, i) => lines.push(`${1996 + Math.floor(i / 4)}-Q${(i % 4) + 1} ${r.join(" ")} ${(r[0] * 0.3 + r[2] * 0.2).toFixed(3)}`));
    return lines.join("\n");
  })();
  const cases: [string, Record<string, string>][] = [];
  for (const c of TS2_STAT_CALCS)
    for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) if (o.value !== f.default) cases.push([c.id, { [f.key]: o.value }]);
  cases.push(
    ["ts-garch", { h: "1" }],
    ["ts-garch", { h: "250", model: "garch" }],
    ["ts-garch", { mean: "zero", dist: "normal", model: "egarch" }],
    ["ts-var", { maxlags: "1" }],
    ["ts-var", { data: longNames }],
    ["ts-var-irf", { h: "24" }],
    ["ts-var-irf", { h: "1" }],
    ["ts-var-irf", { data: longNames, p: "1", h: "24" }],
    ["ts-johansen", { kdiff: "0", det: "-1" }],
    ["ts-johansen", { data: longNames, det: "1" }],
    ["ts-engle-granger", { data: longNames, trend: "ct" }],
  );
  test.each(cases.map(([id, over]) => [`${id} ${JSON.stringify(over).slice(0, 60)}`, id, over] as [string, string, Record<string, string>]))("%s", (_l, id, over) => {
    const o = run(calc(id), over);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/);
    expect(o.text).not.toMatch(/\de[+-]?\d/);
    for (const t of o.tables ?? []) {
      expect(t.rows[0].length).toBeLessThanOrEqual(6);
      for (const row of t.rows) for (const cell of row) if (cell !== "") {
        expect(insertableResultText(cell)).toBe(true);
        expect(cell).not.toMatch(/^-\d/);
      }
    }
    expect(audit.auditSvg(id, o.svg!).found).toEqual([]);
  });
});
