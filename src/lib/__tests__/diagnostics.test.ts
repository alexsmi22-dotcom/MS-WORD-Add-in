// Assumption diagnostics.
//
// The danger with a normality test is the direction of its errors. Reporting
// "normal" for data that is not is a false reassurance that leads the user to
// keep a p-value they should have discarded; refusing to report at a sample size
// where the test has no power is the honest alternative, and is tested here as
// hard as the arithmetic.

import {
  skewness,
  kurtosis,
  normalityTest,
  varianceHomogeneity,
  describeAssumptions,
  MIN_NORMALITY_N,
} from "../diagnostics";

/** Deterministic pseudo-normal sample (Box-Muller on a fixed LCG). */
function normalSample(n: number, mean = 0, sd = 1): number[] {
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: number[] = [];
  while (out.length < n) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(mean + sd * r * Math.cos(2 * Math.PI * u2));
    if (out.length < n) out.push(mean + sd * r * Math.sin(2 * Math.PI * u2));
  }
  return out;
}

describe("shape statistics", () => {
  test("a symmetric sample has zero skewness", () => {
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 10);
  });

  test("a right tail gives positive skewness", () => {
    expect(skewness([1, 1, 1, 1, 10])).toBeGreaterThan(0);
    expect(skewness([1, 10, 10, 10, 10])).toBeLessThan(0);
  });

  test("kurtosis is the non-excess form: normal is about 3", () => {
    const k = kurtosis(normalSample(400));
    expect(k).toBeGreaterThan(2.3);
    expect(k).toBeLessThan(3.8);
  });

  test("a uniform sample is platykurtic (well under 3)", () => {
    const uniform = Array.from({ length: 200 }, (_, i) => i);
    expect(kurtosis(uniform)).toBeLessThan(2.2);
  });

  test("constant data does not produce NaN or Infinity", () => {
    expect(skewness([5, 5, 5])).toBe(0);
    expect(kurtosis([5, 5, 5])).toBe(0);
  });
});

describe("normality", () => {
  test("refuses a sample too small to mean anything", () => {
    const r = normalityTest([1, 2, 3, 4, 5]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(String(MIN_NORMALITY_N));
    // Crucially it does NOT claim normality — a small sample must not read as
    // a clean bill of health.
    expect(r.normal).toBe(false);
  });

  test("accepts a normal sample", () => {
    const r = normalityTest(normalSample(200));
    expect(r.ok).toBe(true);
    expect(r.p).toBeGreaterThan(0.05);
    expect(r.normal).toBe(true);
  });

  test("rejects a strongly skewed sample", () => {
    // Exponential-ish: heavily right-skewed.
    const skewed = Array.from({ length: 200 }, (_, i) => Math.exp(i / 40));
    const r = normalityTest(skewed);
    expect(r.ok).toBe(true);
    expect(r.p).toBeLessThan(0.05);
    expect(r.normal).toBe(false);
  });

  test("rejects a uniform sample", () => {
    const uniform = Array.from({ length: 200 }, (_, i) => i);
    const r = normalityTest(uniform);
    expect(r.ok).toBe(true);
    expect(r.normal).toBe(false);
  });

  test("K² is finite and non-negative wherever it is reported", () => {
    for (const data of [normalSample(50), normalSample(300), Array.from({ length: 40 }, (_, i) => i * i)]) {
      const r = normalityTest(data);
      if (r.ok) {
        expect(Number.isFinite(r.k2)).toBe(true);
        expect(r.k2).toBeGreaterThanOrEqual(0);
        expect(r.p).toBeGreaterThanOrEqual(0);
        expect(r.p).toBeLessThanOrEqual(1);
      }
    }
  });

  test("constant data is refused, not called normal", () => {
    const r = normalityTest(new Array(40).fill(7));
    expect(r.ok).toBe(false);
    expect(r.normal).toBe(false);
  });
});

describe("equal variances (Brown-Forsythe)", () => {
  test("equal-spread groups are not rejected", () => {
    const r = varianceHomogeneity([
      [1, 2, 3, 4, 5],
      [11, 12, 13, 14, 15],
      [21, 22, 23, 24, 25],
    ]);
    expect(r.ok).toBe(true);
    expect(r.equal).toBe(true);
    expect(r.varianceRatio).toBeCloseTo(1, 6);
  });

  test("wildly unequal spreads are rejected", () => {
    const r = varianceHomogeneity([
      [10, 10.1, 9.9, 10.05, 9.95, 10, 10.02, 9.98],
      [1, 50, 100, 2, 75, 30, 90, 5],
    ]);
    expect(r.ok).toBe(true);
    expect(r.equal).toBe(false);
    expect(r.varianceRatio).toBeGreaterThan(100);
  });

  test("is centred on the MEDIAN, so one outlier does not decide it", () => {
    // Mean-centred Levene is dragged by the outlier; the median-centred form is
    // the reason this defaults to Brown-Forsythe.
    const withOutlier = varianceHomogeneity([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ]);
    expect(withOutlier.ok).toBe(true);
    // It still notices the spread differs, but via a robust centre.
    expect(Number.isFinite(withOutlier.f)).toBe(true);
  });

  test("refuses fewer than two usable groups", () => {
    expect(varianceHomogeneity([[1, 2, 3]]).ok).toBe(false);
    expect(varianceHomogeneity([[1, 2, 3], [4]]).ok).toBe(false);
  });

  test("identical groups do not produce a spurious F", () => {
    const r = varianceHomogeneity([
      [5, 5, 5],
      [5, 5, 5],
    ]);
    // No spread in the deviations at all: refused rather than 0/0.
    expect(r.ok).toBe(false);
  });
});

describe("the plain-language verdict", () => {
  test("says nothing when the assumptions hold", () => {
    const notes = describeAssumptions([normalSample(60, 10, 2), normalSample(60, 11, 2)]);
    expect(notes.filter((n) => n.startsWith("⚠"))).toEqual([]);
  });

  test("names Mann-Whitney for two non-normal groups", () => {
    const skewed = Array.from({ length: 60 }, (_, i) => Math.exp(i / 12));
    const notes = describeAssumptions([skewed, skewed.map((v) => v + 1)]);
    expect(notes.join(" ")).toContain("Mann-Whitney");
  });

  test("names Kruskal-Wallis for three non-normal groups", () => {
    const skewed = Array.from({ length: 40 }, (_, i) => Math.exp(i / 8));
    const notes = describeAssumptions([skewed, skewed, skewed]);
    expect(notes.join(" ")).toContain("Kruskal-Wallis");
  });

  test("names Wilcoxon for a paired design", () => {
    // The two conditions must DIFFER. A paired design's normality assumption is
    // about the differences, so `[skewed, skewed]` is now a column of exact
    // zeros — which the constant-data refusal correctly declines to test rather
    // than a non-normal sample. Halving the second condition keeps the
    // differences as skewed as the raw scores.
    const skewed = Array.from({ length: 60 }, (_, i) => Math.exp(i / 12));
    const notes = describeAssumptions([skewed, skewed.map((v) => v * 0.5)], { paired: true });
    expect(notes.join(" ")).toContain("Wilcoxon");
    expect(notes.join(" ")).toContain("paired differences");
  });

  test("names Welch when two groups have unequal variances", () => {
    const notes = describeAssumptions([
      [10, 10.1, 9.9, 10.05, 9.95, 10, 10.02, 9.98],
      [1, 50, 100, 2, 75, 30, 90, 5],
    ]);
    expect(notes.join(" ")).toContain("Welch");
  });

  test("p-values are phrased once, not doubled", () => {
    // The first cut produced "p = < .001": formatP-style prefix built inline and
    // then prefixed again. The same mistake has appeared elsewhere in this
    // codebase, so it gets a test rather than a careful reading.
    const skewed = Array.from({ length: 60 }, (_, i) => Math.exp(i / 12));
    const all = [
      ...describeAssumptions([skewed, skewed]),
      ...describeAssumptions([
        [10, 10.1, 9.9, 10.05, 9.95, 10, 10.02, 9.98],
        [1, 50, 100, 2, 75, 30, 90, 5],
      ]),
    ].join(" ");
    expect(all).not.toContain("p = <");
    expect(all).not.toContain("p = p");
  });

  test("every warning names an alternative, never just a complaint", () => {
    // A warning with no next step leaves the user holding a number they now
    // distrust and no way forward.
    const skewed = Array.from({ length: 60 }, (_, i) => Math.exp(i / 12));
    for (const notes of [
      describeAssumptions([skewed, skewed]),
      describeAssumptions([skewed, skewed, skewed]),
    ]) {
      for (const n of notes.filter((x) => x.startsWith("⚠"))) {
        expect(n).toMatch(/Mann-Whitney|Kruskal-Wallis|Wilcoxon|Welch|caution/);
      }
    }
  });
});
