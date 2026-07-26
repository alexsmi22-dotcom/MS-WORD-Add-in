// Effect sizes and confidence intervals on the difference.
//
// Checked against values computed independently rather than against whatever
// the code happens to produce — an effect size that merely "looks plausible" is
// the kind of number a reviewer catches and the author cannot defend.

import { twoSampleTTest, pairedTTest, reportT, tCritical } from "../stats";

describe("Cohen's d on two independent samples", () => {
  // Textbook case: means 5 and 7, both SD 1.5811 (n=5 each).
  const a = [3, 4, 5, 6, 7];
  const b = [5, 6, 7, 8, 9];

  test("d is the mean difference over the pooled SD", () => {
    const r = twoSampleTTest(a, b);
    // pooled sd = 1.58114; diff = -2  =>  d = -1.2649
    expect(r.d).toBeCloseTo(-1.2649, 3);
    expect(r.dKind).toBe("cohen");
  });

  test("d does NOT depend on which t-test was chosen", () => {
    // d describes the data, not the test. Using Welch's denominator would make
    // the same samples report two different effect sizes.
    expect(twoSampleTTest(a, b, false).d).toBeCloseTo(twoSampleTTest(a, b, true).d, 12);
  });

  test("the t statistic still differs between Welch and pooled where it should", () => {
    // Guards the above from being true for the boring reason that nothing changed.
    const u1 = [1, 2, 3, 4, 5];
    const u2 = [10, 40, 12, 80, 33, 51, 7];
    expect(twoSampleTTest(u1, u2, false).df).not.toBeCloseTo(twoSampleTTest(u1, u2, true).df, 6);
  });

  test("equal groups give d = 0", () => {
    const r = twoSampleTTest([1, 2, 3], [1, 2, 3]);
    expect(r.d).toBeCloseTo(0, 12);
  });

  test("zero variance does not yield Infinity", () => {
    const r = twoSampleTTest([5, 5, 5], [5, 5, 5]);
    expect(Number.isFinite(r.d)).toBe(false); // NaN, not Infinity
    expect(r.d).toBeNaN();
  });
});

describe("the 95% CI on the mean difference", () => {
  const a = [3, 4, 5, 6, 7];
  const b = [5, 6, 7, 8, 9];

  test("is centred on the mean difference", () => {
    const r = twoSampleTTest(a, b);
    expect((r.ci95[0] + r.ci95[1]) / 2).toBeCloseTo(r.meanDifference, 10);
  });

  test("is diff +/- t_crit * SE, computed independently", () => {
    const r = twoSampleTTest(a, b, true); // pooled, so SE is easy to verify
    // sp2 = 2.5; SE = sqrt(2.5 * (1/5 + 1/5)) = 1.0
    const se = 1.0;
    const tc = tCritical(0.05, 8);
    expect(r.ci95[0]).toBeCloseTo(-2 - tc * se, 6);
    expect(r.ci95[1]).toBeCloseTo(-2 + tc * se, 6);
  });

  test("excludes zero exactly when p < .05", () => {
    // The interval and the test must agree; if they disagree one of them is wrong.
    const r = twoSampleTTest(a, b, true);
    const excludesZero = r.ci95[0] > 0 || r.ci95[1] < 0;
    expect(excludesZero).toBe(r.p < 0.05);
  });

  test("a null result's interval contains zero", () => {
    const r = twoSampleTTest([1, 2, 3, 4], [1, 2, 3, 5]);
    expect(r.p).toBeGreaterThan(0.05);
    expect(r.ci95[0]).toBeLessThan(0);
    expect(r.ci95[1]).toBeGreaterThan(0);
  });
});

describe("the paired test reports d_z, not Cohen's d", () => {
  const before = [10, 12, 14, 16, 18];
  const after = [12, 15, 16, 19, 21];

  test("d_z is the mean difference over the SD of the differences", () => {
    const r = pairedTTest(after, before);
    // diffs = 2,3,2,3,3 -> mean 2.6, sd 0.5477 -> d_z = 4.7469
    expect(r.d).toBeCloseTo(4.7469, 3);
    expect(r.dKind).toBe("dz");
  });

  test("it is labelled d_z in the report, because it is not comparable to d", () => {
    // d_z is typically much larger for the same data; printing it as "d" would
    // overstate the effect to anyone reading it as a two-sample d.
    expect(reportT(pairedTTest(after, before))).toContain("d_z =");
    expect(reportT(twoSampleTTest(after, before))).toMatch(/, d = /);
  });

  test("its CI is centred on the mean difference", () => {
    const r = pairedTTest(after, before);
    expect((r.ci95[0] + r.ci95[1]) / 2).toBeCloseTo(r.meanDifference, 10);
  });
});

describe("the report line", () => {
  test("carries t, p, the effect size and the interval", () => {
    // Welch on these samples: SE = sqrt(2.5/5 + 2.5/5) = 1.0, so t = -2/1 = -2.00
    // on df = 8. (An earlier version of this test asserted -2.83, which was my
    // arithmetic being wrong, not the code.)
    const line = reportT(twoSampleTTest([3, 4, 5, 6, 7], [5, 6, 7, 8, 9]));
    expect(line).toMatch(/^t\(8\) = -2\.00, p = \.081, d = -1\.26, 95% CI \[-?\d+\.\d+, -?\d+\.\d+\]$/);
  });

  test("says what went wrong instead of printing NaN", () => {
    // Two identical constant columns are an easy paste away, and the line used
    // to read "t(NaN) = NaN, p = n/a".
    const line = reportT(twoSampleTTest([5, 5, 5], [5, 5, 5]));
    expect(line).not.toContain("NaN");
    expect(line).toContain("no variance");
  });
});
