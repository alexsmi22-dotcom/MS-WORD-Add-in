import {
  tCdf,
  fCdf,
  nctCdf,
  ncfCdf,
  tUpper,
  fUpper,
  powerT,
  powerAnova,
  powerProportions,
  sampleSizeFor,
  effectLabel,
} from "../power";
import { tTestP, fTestP, gammaln } from "../stats";
import { normalCdf, chiSquareP } from "../stats2";

/**
 * INDEPENDENT cross-checks, by numerical integration over the chi-square
 * denominator, so they share no series with the engine:
 *   P(T ≤ t | ν, δ) = ∫ Φ(t·√(v/ν) − δ) · χ²_ν(v) dv
 *   P(F ≤ f | ν1, ν2, λ) = ∫ P[χ²_ν1(λ) ≤ f·ν1·v/ν2] · χ²_ν2(v) dv,
 * with the non-central χ² as a Poisson mixture of CENTRAL χ² CDFs (the gamma
 * route, where the engine takes the beta route). Composite Simpson.
 */
function chiSqPdf(v: number, k: number): number {
  if (v <= 0) return 0;
  return Math.exp((k / 2 - 1) * Math.log(v) - v / 2 - (k / 2) * Math.LN2 - gammaln(k / 2));
}
function simpson(f: (v: number) => number, a: number, b: number, n = 20000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
function nctByIntegral(t: number, df: number, delta: number): number {
  const hi = df + 40 * Math.sqrt(2 * df) + 40;
  return simpson((v) => normalCdf(t * Math.sqrt(v / df) - delta) * chiSqPdf(v, df), 0, hi);
}
function ncChiSqCdf(x: number, k: number, lambda: number): number {
  let total = 0;
  for (let j = 0; j < 200; j++) {
    const w = Math.exp(-lambda / 2 + j * Math.log(lambda / 2) - gammaln(j + 1));
    total += w * (1 - chiSquareP(x, k + 2 * j));
    if (j > lambda && w < 1e-14) break;
  }
  return total;
}
function ncfByIntegral(f: number, df1: number, df2: number, lambda: number): number {
  const hi = df2 + 40 * Math.sqrt(2 * df2) + 40;
  return simpson((v) => ncChiSqCdf((f * df1 * v) / df2, df1, lambda) * chiSqPdf(v, df2), 0, hi, 4000);
}

describe("central distributions agree with the engine's existing p-values", () => {
  it("tCdf is the complement of the two-sided tTestP, halved", () => {
    for (const [t, df] of [
      [2.0, 10],
      [0.5, 3],
      [3.3, 40],
    ]) {
      expect(1 - tCdf(t, df)).toBeCloseTo(tTestP(t, df) / 2, 10);
      expect(tCdf(-t, df)).toBeCloseTo(tTestP(t, df) / 2, 10);
    }
    expect(tCdf(0, 7)).toBeCloseTo(0.5, 12);
  });
  it("fCdf is the complement of fTestP", () => {
    expect(1 - fCdf(3.5, 2, 20)).toBeCloseTo(fTestP(3.5, 2, 20), 10);
    expect(fCdf(0, 2, 20)).toBe(0);
  });
  it("critical values round-trip", () => {
    expect(tUpper(0.025, 10)).toBeCloseTo(2.228, 3); // table value
    expect(tUpper(0.05, 1e3)).toBeCloseTo(1.646, 3);
    expect(fUpper(0.05, 2, 27)).toBeCloseTo(3.354, 3); // table value
  });
});

describe("non-central t (AS 243)", () => {
  it("reduces to the central t at δ = 0", () => {
    for (const t of [-2, -0.3, 0, 0.7, 2.5]) {
      expect(nctCdf(t, 12, 0)).toBeCloseTo(tCdf(t, 12), 12);
    }
  });
  it("is a CDF: monotone in t, within [0,1], symmetric under (t, δ) → (−t, −δ)", () => {
    let prev = 0;
    for (let t = -6; t <= 6; t += 0.25) {
      const v = nctCdf(t, 9, 1.5);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
      expect(nctCdf(-t, 9, -1.5)).toBeCloseTo(1 - v, 10);
    }
  });
  it("agrees with direct numerical integration of its definition (an independent route)", () => {
    for (const [t, df, d] of [
      [2, 10, 1],
      [1, 5, 2],
      [3, 20, 2.5],
      [-1.5, 8, 0.7],
      [0.4, 3, -1.2],
      [4, 60, 3],
    ]) {
      // 5e-5: the limit of the Simpson integration, not of the series —
      // the G*Power oracles below hold the engine to four decimals of power.
      expect(nctCdf(t, df, d)).toBeCloseTo(nctByIntegral(t, df, d), 4);
    }
  });
  it("large df approaches the shifted normal", () => {
    // T ~ N(δ, 1) as df → ∞: P(T ≤ δ) → 0.5
    expect(nctCdf(2, 5000, 2)).toBeCloseTo(0.5, 2);
  });
});

describe("non-central F", () => {
  it("reduces to the central F at λ = 0 and is a CDF", () => {
    expect(ncfCdf(2.5, 3, 30, 0)).toBeCloseTo(fCdf(2.5, 3, 30), 12);
    let prev = 0;
    for (let f = 0; f <= 10; f += 0.5) {
      const v = ncfCdf(f, 3, 30, 4);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    expect(ncfCdf(1e6, 3, 30, 4)).toBeCloseTo(1, 6);
  });
  it("agrees with direct numerical integration via the non-central χ² (an independent route)", () => {
    for (const [f, df1, df2, l] of [
      [3, 2, 20, 5],
      [1.5, 4, 40, 10],
      [2.2, 3, 30, 4],
      [0.8, 5, 12, 2],
    ]) {
      expect(ncfCdf(f, df1, df2, l)).toBeCloseTo(ncfByIntegral(f, df1, df2, l), 5);
    }
  });
});

describe("power against G*Power 3.1 oracles", () => {
  it("two-sample t, d = 0.5, α = .05 two-sided, n = 64 per group → 0.80", () => {
    expect(powerT({ design: "two-sample", d: 0.5, n: 64, alpha: 0.05, tails: 2 })).toBeCloseTo(0.8015, 3);
  });
  it("one-sample / paired, d = 0.5, n = 34 → 0.81", () => {
    expect(powerT({ design: "one-sample", d: 0.5, n: 34, alpha: 0.05, tails: 2 })).toBeCloseTo(0.8077, 3);
    expect(powerT({ design: "paired", d: 0.5, n: 34, alpha: 0.05, tails: 2 })).toBeCloseTo(0.8077, 3);
  });
  it("one-tailed is more powerful than two-tailed at the same n, and the sign of d does not matter", () => {
    const two = powerT({ design: "two-sample", d: 0.5, n: 30, alpha: 0.05, tails: 2 });
    const one = powerT({ design: "two-sample", d: 0.5, n: 30, alpha: 0.05, tails: 1 });
    expect(one).toBeGreaterThan(two);
    expect(powerT({ design: "two-sample", d: -0.5, n: 30, alpha: 0.05, tails: 2 })).toBeCloseTo(two, 12);
  });
  it("power at d = 0 is exactly α (the false-positive rate)", () => {
    expect(powerT({ design: "two-sample", d: 0, n: 20, alpha: 0.05, tails: 2 })).toBeCloseTo(0.05, 6);
    expect(powerAnova({ k: 3, f: 0, n: 20, alpha: 0.05 })).toBeCloseTo(0.05, 6);
  });
  it("one-way ANOVA, k = 3, f = 0.25, n = 53 per group → 0.80", () => {
    expect(powerAnova({ k: 3, f: 0.25, n: 53, alpha: 0.05 })).toBeCloseTo(0.8049, 2);
  });
  it("two proportions 0.50 vs 0.60 → n = 388 per group for 0.80", () => {
    const n = sampleSizeFor((n) => powerProportions({ p1: 0.5, p2: 0.6, n, alpha: 0.05, tails: 2 }), 0.8);
    expect(n).toBeGreaterThanOrEqual(385);
    expect(n).toBeLessThanOrEqual(389);
  });
  it("sample size for the t-test reproduces the oracle n", () => {
    expect(sampleSizeFor((n) => powerT({ design: "two-sample", d: 0.5, n, alpha: 0.05, tails: 2 }), 0.8)).toBe(64);
    expect(sampleSizeFor((n) => powerT({ design: "paired", d: 0.5, n, alpha: 0.05, tails: 2 }), 0.8)).toBe(34);
    expect(sampleSizeFor((n) => powerAnova({ k: 3, f: 0.25, n, alpha: 0.05 }), 0.8)).toBe(53);
  });
});

describe("refusals and edges", () => {
  it("a zero effect cannot reach 80% power: null, not a huge number", () => {
    expect(sampleSizeFor((n) => powerT({ design: "two-sample", d: 0, n, alpha: 0.05, tails: 2 }), 0.8)).toBeNull();
  });
  it("invalid inputs return NaN rather than a number", () => {
    expect(powerT({ design: "two-sample", d: 0.5, n: 1, alpha: 0.05, tails: 2 })).toBeNaN();
    expect(powerT({ design: "two-sample", d: 0.5, n: 20, alpha: 0, tails: 2 })).toBeNaN();
    expect(powerProportions({ p1: 0, p2: 0.5, n: 20, alpha: 0.05, tails: 2 })).toBeNaN();
    expect(powerAnova({ k: 1, f: 0.3, n: 20, alpha: 0.05 })).toBeNaN();
  });
  it("sampleSizeFor returns the SMALLEST n, and the previous n is below target", () => {
    const pw = (n: number) => powerT({ design: "two-sample", d: 0.8, n, alpha: 0.05, tails: 2 });
    const n = sampleSizeFor(pw, 0.9)!;
    expect(pw(n)).toBeGreaterThanOrEqual(0.9);
    expect(pw(n - 1)).toBeLessThan(0.9);
  });
  it("an absurd target is refused by the cap, quickly", () => {
    const t0 = Date.now();
    expect(sampleSizeFor((n) => powerT({ design: "two-sample", d: 0.001, n, alpha: 0.05, tails: 2 }), 0.999)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("effect labels follow Cohen's cut-offs", () => {
    expect(effectLabel("d", 0.2)).toBe("small");
    expect(effectLabel("d", 0.5)).toBe("medium");
    expect(effectLabel("d", 0.8)).toBe("large");
    expect(effectLabel("d", 0.1)).toMatch(/below/);
    expect(effectLabel("f", 0.25)).toBe("medium");
  });
});
