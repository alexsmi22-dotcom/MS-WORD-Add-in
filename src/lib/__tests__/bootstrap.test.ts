/**
 * bootstrap.ts against scripts/econ-boot-qreg-oracle.py: the oracle REPLAYS PCG32 in Python (same resample indices),
 * computes each statistic in the same operation order and the four intervals by scipy 1.18's formulas (pinned 1e−12),
 * and also runs scipy.stats.bootstrap itself on the SAME replicates (bootstrap_result=…, n_resamples=0) with its own
 * numpy jackknife (pinned 1e−9: numpy's pairwise sums differ from sequential sums in the last bits).
 */
import * as fs from "fs";
import * as path from "path";
import { runBootstrap, jackknife, quantileType7, bootWork, bcaInterval, bcaP0, BOOT_MAX_WORK, type BootStat, type BootResult } from "../bootstrap";
import { Pcg32 } from "../prng";
import { budget } from "./timeBudget";

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "econ-boot-qreg-oracle.json"), "utf8"));

interface BootCase {
  name: string;
  stat: BootStat;
  B: number;
  conf: number;
  seed: number;
  y: string[];
  x: string[] | null;
  theta: number;
  se: number;
  bias: number;
  dropped: number;
  nUsed: number;
  first5: number[];
  last: number;
  percentile: [number, number];
  basic: [number, number];
  normal: [number, number];
  bca: [number, number];
  z0: number;
  a: number;
  alpha1: number;
  alpha2: number;
  scipy: Record<"percentile" | "basic" | "BCa", [number, number]>;
  scipySe: number;
  scipyTheta: number;
  tiesAtTheta: number;
}

const close = (got: number, want: number, scale: number, tol: number): void => {
  const err = Math.abs(got - want);
  if (!(err <= tol * Math.max(scale, Number.MIN_VALUE))) throw new Error(`got ${got}, want ${want} (|err| ${err} > ${tol}·${scale})`);
};

function run(c: BootCase): BootResult {
  const r = runBootstrap({
    stat: c.stat,
    y: Float64Array.from(c.y, Number),
    x: c.x ? Float64Array.from(c.x, Number) : undefined,
    B: c.B,
    confidence: c.conf,
    seed: c.seed,
  });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("bootstrap: pinned to the oracle's PCG32 replay and scipy's interval formulas", () => {
  const cases: BootCase[] = FX.boot;
  it("has at least 3 cases per kind of statistic family and an awkward one", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.some((c) => c.dropped > 0)).toBe(true);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = run(c);
      const scale = Math.max(Math.abs(c.theta), c.se);
      expect(r.dropped).toBe(c.dropped);
      expect(r.reps.length).toBe(c.nUsed);
      for (let i = 0; i < 5; i++) close(r.reps[i], c.first5[i], scale, 1e-13);
      close(r.reps[r.reps.length - 1], c.last, scale, 1e-13);
      close(r.thetaHat, c.theta, scale, 1e-13);
      close(r.se, c.se, c.se, 1e-12);
      close(r.bias, c.bias, scale, 1e-12);
      for (const m of ["percentile", "basic", "normal"] as const) {
        close(r[m].lo, c[m][0], scale, 1e-12);
        close(r[m].hi, c[m][1], scale, 1e-12);
      }
      if (!("lo" in r.bca)) throw new Error(`BCa refused: ${r.bca.refused}`);
      close(r.bca.lo, c.bca[0], scale, 1e-12);
      close(r.bca.hi, c.bca[1], scale, 1e-12);
      close(r.bca.z0, c.z0, 1, 1e-12);
      close(r.bca.a, c.a, Math.max(1e-3, Math.abs(c.a)), 1e-10);
      close(r.bca.alpha1, c.alpha1, 1, 1e-12);
      close(r.bca.alpha2, c.alpha2, 1, 1e-12);
      // scipy.stats.bootstrap on the same replicates, its own jackknife.
      close(r.percentile.lo, c.scipy.percentile[0], scale, 1e-12);
      close(r.percentile.hi, c.scipy.percentile[1], scale, 1e-12);
      close(r.basic.lo, c.scipy.basic[0], scale, 1e-12);
      close(r.basic.hi, c.scipy.basic[1], scale, 1e-12);
      if (c.scipyTheta !== c.theta && c.tiesAtTheta > 0) {
        // scipy's θ (numpy pairwise sums) differs from the sequential θ in the last bits, and some replicates equal
        // θ exactly (resamples that permute the data), so scipy counts them on the other side in z₀: a rounding
        // artefact of scipy's θ, not a convention difference. The oracle's replay (above) pins this case at 1e−12.
        expect(Math.abs(c.scipyTheta - c.theta)).toBeLessThan(1e-14 * scale);
      } else {
        close(r.bca.lo, c.scipy.BCa[0], scale, 1e-9);
        close(r.bca.hi, c.scipy.BCa[1], scale, 1e-9);
      }
      close(r.se, c.scipySe, c.se, 1e-12);
    });
  }
});

describe("bootstrap internals", () => {
  it("quantileType7 matches the textbook definition, endpoints included", () => {
    const s = [1, 2, 4, 8];
    expect(quantileType7(s, 0)).toBe(1);
    expect(quantileType7(s, 1)).toBe(8);
    expect(quantileType7(s, 0.5)).toBe(3);
    expect(quantileType7(s, 1 / 3)).toBeCloseTo(2, 14);
  });

  it("the downdated jackknife (large n) agrees with the direct one", () => {
    const rng = new Pcg32(9);
    const u = (): number => (rng.nextU32() + 0.5) / 4294967296;
    const n = 300;
    const x = Float64Array.from({ length: n }, () => 10 + 5 * u());
    const y = Float64Array.from(x, (v) => 2 + 0.5 * v + u());
    for (const stat of ["mean", "sd", "var", "trim10", "median", "corr", "ratio", "slope"] as BootStat[]) {
      const direct = jackknife(stat, y, x, Infinity);
      const down = jackknife(stat, y, x, 0);
      for (let i = 0; i < n; i++) expect(Math.abs(down[i] - direct[i])).toBeLessThanOrEqual(1e-11 * Math.max(1, Math.abs(direct[i])));
    }
  });

  it("the same seed gives the same interval; another seed a different one", () => {
    const y = Float64Array.from({ length: 30 }, (_, i) => Math.sin(i) * 10 + i);
    const a = runBootstrap({ stat: "mean", y, B: 500, confidence: 0.95, seed: 3 });
    const b = runBootstrap({ stat: "mean", y, B: 500, confidence: 0.95, seed: 3 });
    const c = runBootstrap({ stat: "mean", y, B: 500, confidence: 0.95, seed: 4 });
    if (!a.ok || !b.ok || !c.ok) throw new Error("refused");
    expect(b.percentile).toEqual(a.percentile);
    expect(c.percentile).not.toEqual(a.percentile);
  });
});

describe("bootstrap refusals by name", () => {
  it("BCa: z₀ infinite when every replicate lies on one side of θ (both sides), by name", () => {
    const jack = Float64Array.from([1, 2, 3, 4, 5]);
    const above = bcaInterval(Float64Array.from([2, 3, 4]), 1, jack, 0.025);
    const below = bcaInterval(Float64Array.from([2, 3, 4]), 5, jack, 0.025);
    expect(above).toEqual({ refused: expect.stringMatching(/every replicate lies above θ.*z₀ is infinite/) });
    expect(below).toEqual({ refused: expect.stringMatching(/every replicate lies below θ.*z₀ is infinite/) });
    // A tie with θ counts one half, so replicates that all EQUAL θ give z₀ = 0, not infinity.
    expect(bcaP0([3, 3, 3], 3)).toBe(0.5);
  });

  it("BCa: refused when every jackknife value is equal (0/0 acceleration), through the calculator path", () => {
    // Median of n = 7 with the middle five values equal: leaving one out never moves the median.
    const y = Float64Array.from([1, 5, 5, 5, 5, 5, 9]);
    const r = runBootstrap({ stat: "median", y, B: 300, confidence: 0.95, seed: 2 });
    if (!r.ok) throw new Error(r.reason);
    if ("lo" in r.bca) throw new Error("expected a refusal");
    expect(r.bca.refused).toMatch(/jackknife values are equal/);
    // The other three intervals are still reported.
    expect(Number.isFinite(r.percentile.lo)).toBe(true);
  });

  it("BCa: an undefined leave-one-out statistic is named by row", () => {
    const sorted = Float64Array.from([1, 2, 3, 4]);
    const r = bcaInterval(sorted, 2.5, Float64Array.from([1, NaN, 2]), 0.025);
    expect(r).toEqual({ refused: expect.stringMatching(/leaving out row 2/) });
  });

  it("n < 5, B outside 100 … 20,000, and mismatched columns are refused", () => {
    const y = Float64Array.from([1, 2, 3, 4]);
    const r = runBootstrap({ stat: "mean", y, B: 1000, confidence: 0.95, seed: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at least 5 rows/);
    const y5 = Float64Array.from([1, 2, 3, 4, 5]);
    for (const B of [99, 20001, 1.5]) {
      const rb = runBootstrap({ stat: "mean", y: y5, B, confidence: 0.95, seed: 1 });
      expect(rb.ok).toBe(false);
    }
    const rc = runBootstrap({ stat: "corr", y: y5, x: Float64Array.from([1, 2, 3]), B: 200, confidence: 0.95, seed: 1 });
    expect(rc.ok).toBe(false);
  });

  it("too many undefined resamples (slope with x constant except one row) is refused, naming the share", () => {
    const x = Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const y = Float64Array.from([1, 2, 1, 2, 1, 2, 1, 2, 1, 5]);
    const r = runBootstrap({ stat: "slope", y, x, B: 1000, confidence: 0.95, seed: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/left the statistic undefined.*more than 10%/);
  });

  it("refuses up front when n·B is beyond the work limit, by name", () => {
    expect(bootWork("median", 100000, 20000)).toBeGreaterThan(BOOT_MAX_WORK);
    const y = new Float64Array(100000).map((_, i) => i % 97);
    const t = Date.now();
    const r = runBootstrap({ stat: "median", y, B: 20000, confidence: 0.95, seed: 1 });
    expect(Date.now() - t).toBeLessThan(budget(500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/more work than the bootstrap allows/);
  });

  it("the wall clock refuses by name when a run outlasts it", () => {
    const y = Float64Array.from({ length: 10000 }, (_, i) => (i * 7919) % 1000);
    const r = runBootstrap({ stat: "median", y, B: 700, confidence: 0.95, seed: 1, wallMs: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/time limit/);
  });
});
