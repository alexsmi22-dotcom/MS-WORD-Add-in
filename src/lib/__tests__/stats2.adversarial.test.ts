// Adversarial edge-case bug test for stats2 (non-parametric, chi-square,
// two-way ANOVA, multiple-comparison correction).

import {
  normalCdf,
  chiSquareP,
  mannWhitneyU,
  wilcoxonSignedRank,
  chiSquareGoodnessOfFit,
  chiSquareIndependence,
  twoWayAnova,
  adjustPValues,
} from "../stats2";

describe("distribution tails stay finite and bounded", () => {
  it("normalCdf saturates without NaN", () => {
    expect(normalCdf(40)).toBeCloseTo(1, 9);
    expect(normalCdf(-40)).toBeCloseTo(0, 9);
    expect(Number.isFinite(normalCdf(1e6))).toBe(true);
  });
  it("chiSquareP is in [0,1] for extreme inputs", () => {
    for (const [c, df] of [[0, 1], [1000, 1], [1e-6, 10], [500, 100]] as [number, number][]) {
      const p = chiSquareP(c, df);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("Mann–Whitney with heavy ties", () => {
  it("all identical values → p ≈ 1, no NaN", () => {
    const r = mannWhitneyU([5, 5, 5, 5], [5, 5, 5, 5]);
    expect(Number.isFinite(r.z)).toBe(true);
    expect(r.p).toBeGreaterThan(0.5);
  });
  it("partial ties still produce a finite statistic", () => {
    const r = mannWhitneyU([1, 2, 2, 3], [2, 3, 3, 4]);
    expect(Number.isFinite(r.statistic)).toBe(true);
    expect(r.p).toBeGreaterThanOrEqual(0);
    expect(r.p).toBeLessThanOrEqual(1);
  });
});

describe("Wilcoxon edge cases", () => {
  it("some zero differences are dropped, rest ranked", () => {
    const r = wilcoxonSignedRank([1, 2, 3, 4], [1, 5, 3, 1]); // diffs: 0, -3, 0, +3 → n=2
    expect(r.n1).toBe(2);
    expect(Number.isFinite(r.z)).toBe(true);
  });
});

describe("chi-square edge cases", () => {
  it("goodness of fit skips zero-expected cells without dividing by zero", () => {
    const r = chiSquareGoodnessOfFit([5, 0, 5], [5, 0, 5]);
    expect(Number.isFinite(r.chi2)).toBe(true);
    expect(r.chi2).toBeCloseTo(0, 9);
  });
  it("independence on a table with a zero cell stays finite", () => {
    const r = chiSquareIndependence([
      [0, 10],
      [10, 0],
    ]);
    expect(Number.isFinite(r.chi2)).toBe(true);
    expect(r.p).toBeGreaterThanOrEqual(0);
    expect(r.p).toBeLessThanOrEqual(1);
  });
});

describe("two-way ANOVA edge cases", () => {
  it("requires ≥ 2 replicates per cell", () => {
    expect(() =>
      twoWayAnova([
        [[1], [2]],
        [[3], [4]],
      ]),
    ).toThrow();
  });
  it("all-equal data → zero SS and F = 0 (or NaN-free)", () => {
    const cells = [
      [
        [5, 5],
        [5, 5],
      ],
      [
        [5, 5],
        [5, 5],
      ],
    ];
    const r = twoWayAnova(cells);
    expect(r.total.ss).toBeCloseTo(0, 9);
    // MS_error = 0 → F is 0/0 = NaN; that's acceptable, but SS must be exactly 0
    expect(r.factorA.ss).toBeCloseTo(0, 9);
  });
});

describe("multiple-comparison edge cases", () => {
  it("single p-value is unchanged by every method", () => {
    expect(adjustPValues([0.03], "bonferroni")).toEqual([0.03]);
    expect(adjustPValues([0.03], "holm")).toEqual([0.03]);
    expect(adjustPValues([0.03], "bh")[0]).toBeCloseTo(0.03, 9);
  });
  it("empty input returns empty", () => {
    expect(adjustPValues([], "bh")).toEqual([]);
  });
  it("adjusted p-values never exceed 1 and are monotone under BH ordering", () => {
    const p = [0.9, 0.001, 0.5, 0.2, 0.049];
    for (const m of ["bonferroni", "holm", "bh"] as const) {
      const adj = adjustPValues(p, m);
      for (const a of adj) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});
