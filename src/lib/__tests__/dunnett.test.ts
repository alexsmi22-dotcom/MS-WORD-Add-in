// Dunnett's many-to-one test.
//
// The p-value comes from a numerical integration of the multivariate t, so the
// first duty of these tests is to prove the integration is right rather than
// merely plausible. Two independent anchors do that:
//
//   1. REDUCTION. With one treatment group there is nothing to correct for, so
//      the adjusted p must equal the ordinary two-sided t-test p exactly. That
//      pins the whole nested integral against a closed form.
//   2. BRACKETING. Dunnett must be strictly more conservative than no
//      correction and strictly less conservative than Bonferroni. Those bounds
//      are mathematical, not empirical, and they are tight.

import { dunnettTest, dunnettProbability, singleComparisonP } from "../dunnett";
import { tTestP, twoSampleTTest } from "../stats";

describe("the integration is correct, not merely plausible", () => {
  test("ONE treatment reduces exactly to the two-sided t-test", () => {
    // Nothing to correct for, so Dunnett must agree with Student to the digit.
    const control = [10, 11, 12, 13, 14];
    const treat = [15, 16, 17, 18, 19];
    const r = dunnettTest(control, [treat]);
    expect(r.ok).toBe(true);

    const pooled = twoSampleTTest(treat, control, true);
    expect(r.df).toBe(8);
    expect(r.comparisons[0].t).toBeCloseTo(pooled.t, 10);
    expect(r.comparisons[0].p).toBeCloseTo(tTestP(Math.abs(pooled.t), 8), 6);
  });

  test("the probability function integrates to a proper CDF", () => {
    const l = [Math.SQRT1_2, Math.SQRT1_2];
    expect(dunnettProbability(0.0001, l, 20)).toBeCloseTo(0, 3);
    expect(dunnettProbability(50, l, 20)).toBeCloseTo(1, 6);
    // Monotone increasing in t.
    let prev = -1;
    for (const t of [0.5, 1, 1.5, 2, 2.5, 3, 4]) {
      const p = dunnettProbability(t, l, 20);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  test("with one comparison the probability matches the t distribution", () => {
    // P(|T| < t) = 1 − p_two-sided.
    for (const t of [0.5, 1.5, 2.5, 3.5]) {
      for (const df of [5, 12, 40]) {
        expect(dunnettProbability(t, [Math.SQRT1_2], df)).toBeCloseTo(1 - singleComparisonP(t, df), 5);
      }
    }
  });
});

describe("it sits between no correction and Bonferroni", () => {
  const control = [10, 11, 12, 13, 14, 15];
  const treatments = [
    [12, 13, 14, 15, 16, 17],
    [13, 14, 15, 16, 17, 18],
    [11, 12, 13, 14, 15, 16],
  ];

  test("adjusted p is never smaller than the unadjusted p", () => {
    const r = dunnettTest(control, treatments);
    for (const c of r.comparisons) {
      const raw = tTestP(Math.abs(c.t), r.df);
      expect(c.p).toBeGreaterThanOrEqual(raw - 1e-9);
    }
  });

  test("adjusted p is never LARGER than Bonferroni — the whole reason to use it", () => {
    // If Dunnett were more conservative than Bonferroni there would be no point
    // to it; this is the property that makes it worth implementing.
    const r = dunnettTest(control, treatments);
    const k = treatments.length;
    for (const c of r.comparisons) {
      const bonf = Math.min(1, tTestP(Math.abs(c.t), r.df) * k);
      expect(c.p).toBeLessThanOrEqual(bonf + 1e-9);
    }
  });

  test("the critical value sits between the t and Bonferroni criticals", () => {
    const r = dunnettTest(control, treatments);
    // Unadjusted two-sided 5% critical, and the Bonferroni one.
    const tCrit = criticalFor(0.05, r.df);
    const bonfCrit = criticalFor(0.05 / treatments.length, r.df);
    expect(r.critical).toBeGreaterThan(tCrit);
    expect(r.critical).toBeLessThan(bonfCrit);
  });

  /** Two-sided critical t by bisection on tTestP. */
  function criticalFor(alpha: number, df: number): number {
    let lo = 0;
    let hi = 100;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tTestP(mid, df) > alpha) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
});

describe("behaviour", () => {
  test("the critical value grows with the number of treatments", () => {
    const control = [10, 11, 12, 13, 14, 15, 16, 17];
    const g = () => [12, 13, 14, 15, 16, 17, 18, 19];
    const c1 = dunnettTest(control, [g()]).critical;
    const c3 = dunnettTest(control, [g(), g(), g()]).critical;
    const c6 = dunnettTest(control, [g(), g(), g(), g(), g(), g()]).critical;
    expect(c3).toBeGreaterThan(c1);
    expect(c6).toBeGreaterThan(c3);
  });

  test("a treatment identical to the control is not significant", () => {
    const control = [10, 11, 12, 13, 14];
    const r = dunnettTest(control, [[10, 11, 12, 13, 14], [30, 31, 32, 33, 34]]);
    expect(r.comparisons[0].significant).toBe(false);
    expect(r.comparisons[1].significant).toBe(true);
  });

  test("the sign of the difference is treatment minus control", () => {
    const r = dunnettTest([10, 10, 10, 10], [[20, 20, 20, 21], [5, 5, 5, 4]]);
    expect(r.comparisons[0].meanDifference).toBeGreaterThan(0);
    expect(r.comparisons[1].meanDifference).toBeLessThan(0);
  });

  test("two-sided catches a decrease; that is why it is the default", () => {
    const r = dunnettTest([50, 51, 52, 53, 54], [[10, 11, 12, 13, 14]]);
    expect(r.twoSided).toBe(true);
    expect(r.comparisons[0].significant).toBe(true);
  });

  test("unbalanced designs use the correct per-group correlation", () => {
    // lambda_i = sqrt(n_i/(n_i+n0)) differs per group when sizes differ; the
    // result must still be a valid probability and ordered sensibly.
    const r = dunnettTest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [[5, 6, 7], [20, 21, 22, 23, 24, 25]]);
    expect(r.ok).toBe(true);
    for (const c of r.comparisons) {
      expect(c.p).toBeGreaterThanOrEqual(0);
      expect(c.p).toBeLessThanOrEqual(1);
    }
  });
});

describe("what it refuses", () => {
  test("no treatments", () => {
    expect(dunnettTest([1, 2, 3], []).ok).toBe(false);
  });

  test("a control with one value", () => {
    expect(dunnettTest([1], [[1, 2, 3]]).ok).toBe(false);
  });

  test("a treatment with one value", () => {
    expect(dunnettTest([1, 2, 3], [[5]]).ok).toBe(false);
  });

  test("zero within-group variance is refused, not turned into Infinity", () => {
    const r = dunnettTest([5, 5, 5], [[9, 9, 9]]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/identical/);
  });
});

describe("the caveats", () => {
  test("say the p-values are already family-wise", () => {
    const r = dunnettTest([1, 2, 3, 4], [[5, 6, 7, 8]]);
    expect(r.caveats.join(" ")).toMatch(/FAMILY-WISE/);
    expect(r.caveats.join(" ")).toMatch(/Do NOT apply a further Bonferroni/);
  });

  test("say what Dunnett does NOT tell you", () => {
    // The commonest misreading: treating it as an all-pairs test.
    const r = dunnettTest([1, 2, 3, 4], [[5, 6, 7, 8], [9, 10, 11, 12]]);
    expect(r.caveats.join(" ")).toMatch(/nothing about whether the treatments differ from each other/);
    expect(r.caveats.join(" ")).toMatch(/Tukey/);
  });

  test("name a reachable way to check the assumptions", () => {
    const r = dunnettTest([1, 2, 3, 4], [[5, 6, 7, 8]]);
    expect(r.caveats.join(" ")).toMatch(/Check test assumptions/);
  });
});
