// Statistics checked against PUBLISHED authorities, not against itself.
//
// A wrong p-value is the most dangerous output in this product: it looks
// authoritative, nobody can eyeball it, and it decides whether a result gets
// written up. These engines had never been independently reviewed, and the review
// found two errors that changed significance verdicts.
//
// Every expectation below is anchored to something outside the code — a published
// worked example, a published table, or an exact identity. That is the only kind
// of check worth having here, for the reason this repo has already learned twice:
// an oracle that recomputes the answer the same way cannot detect a consistent
// error.

import { logRankTest, kaplanMeier } from "../survival";
import { studentizedRangeCritical, studentizedRangeCdf } from "../tukey";
import { tCritical, describe as describeStats } from "../stats";
import { chiSquareP, chiSquareGoodnessOfFit, mannWhitneyU, twoWayAnova } from "../stats2";
import { kruskalWallis } from "../nonparametric";
import { multipleRegression } from "../regression";

describe("log-rank: the Freireich 6-MP trial", () => {
  // Klein & Moeschberger, Example 7.2; also the worked example on R's
  // `survival::survdiff` help page. Published: chi-square = 16.79, p = 4.17e-05.
  //
  // The bug: the code used the Pearson form, sum (O-E)^2/E, instead of
  // (O1-E1)^2/V — and V was already being accumulated for the hazard ratio. O and
  // E were right all along; only the denominator was wrong, which made the test
  // conservative by ~10% and moved borderline results across alpha.
  const treatment = {
    times: [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35],
    events: [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
  };
  const placebo = {
    times: [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23],
    events: new Array(21).fill(1),
  };

  test("observed and expected match the literature", () => {
    const r = logRankTest([placebo, treatment]);
    expect(r.ok).toBe(true);
    expect(r.observed).toEqual([21, 9]);
    expect(r.expected[0]).toBeCloseTo(10.7495, 3);
    expect(r.expected[1]).toBeCloseTo(19.2505, 3);
  });

  test("the statistic and p-value match the literature", () => {
    const r = logRankTest([placebo, treatment]);
    expect(r.chi2).toBeCloseTo(16.793, 2);
    expect(r.p).toBeLessThan(5e-5);
    expect(r.p).toBeGreaterThan(3e-5);
  });

  test("more than two groups says its statistic is an approximation", () => {
    const r = logRankTest([
      { times: [1, 2, 3, 4], events: [1, 1, 1, 0] },
      { times: [2, 3, 5, 6], events: [1, 1, 0, 1] },
      { times: [4, 5, 7, 8], events: [1, 0, 1, 1] },
    ]);
    expect(r.ok).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/APPROXIMATION/);
  });
});

describe("log-rank validates its input, like kaplanMeier does", () => {
  const a = { times: [5, 8, 12, 15, 20], events: [1, 2, 2, 1, 2] };
  const b = { times: [6, 9, 13, 16, 21], events: [2, 2, 1, 2, 2] };

  test("1/2 event coding is refused, not silently inverted", () => {
    // The SPSS/SAS convention. Read as-is, every 2 becomes "censored" and the
    // events are inverted: the same data gave p = 0.487 coded 1/2 and p = 0.810
    // coded 0/1, with no warning either way.
    const r = logRankTest([a, b]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/1 \(event\) or 0 \(censored\)/);
    expect(r.reason).toMatch(/recode the 2s/);
  });

  test("negative, infinite and NaN times are refused", () => {
    for (const bad of [-1, Infinity, NaN]) {
      const r = logRankTest([
        { times: [1, 2, bad], events: [1, 1, 1] },
        { times: [1, 2, 3], events: [1, 1, 1] },
      ]);
      expect({ bad, ok: r.ok }).toEqual({ bad, ok: false });
    }
  });

  test("kaplanMeier and logRankTest agree about what is valid", () => {
    // The original defect was the ASYMMETRY: one validated, the other did not.
    const times = [1, 2, 3];
    for (const events of [[1, 2, 0], [1, -1, 0], [1, NaN, 0]]) {
      const km = kaplanMeier(times, events);
      const lr = logRankTest([{ times, events }, { times, events: [1, 1, 0] }]);
      expect({ events, km: km.ok, lr: lr.ok }).toEqual({ events, km: false, lr: false });
    }
  });
});

describe("Tukey: the exact identity q(a, 2, df) = sqrt(2) * t(a, df)", () => {
  // This file's own stated verification anchor — a theorem, not a table. It was
  // apparently never swept past df ~ 500: the outer quadrature pinned its lower
  // limit at 1e-6 while the integrand's peak narrowed like 1/sqrt(2*df), so at
  // large df the whole peak fell between two nodes. The critical value was 9.7%
  // wrong at df = 3000 and hit the bisection ceiling of 30 at df = 4000, after
  // which nothing can ever be significant.
  test.each([2, 5, 10, 30, 60, 120, 500, 1000, 1500, 2500, 4000, 4999, 10000])(
    "df = %s",
    (df) => {
      for (const alpha of [0.05, 0.01]) {
        const q = studentizedRangeCritical(alpha, 2, df);
        const exact = Math.SQRT2 * tCritical(alpha, df);
        expect({ df, alpha, rel: Math.abs(q - exact) / exact < 2e-3 }).toEqual({ df, alpha, rel: true });
      }
    },
  );

  test("the CDF is monotone in df, as it must be", () => {
    // Non-monotonicity was the proof that the quadrature, not the identity, was
    // at fault: it swung 0.914 -> 0.897 -> 0.862 -> 0.998 across df.
    const dfs = [50, 100, 300, 500, 900, 1500, 2000];
    const vals = dfs.map((df) => studentizedRangeCdf(3.0, 3, df));
    for (let i = 1; i < vals.length; i++) {
      expect({ df: dfs[i], rising: vals[i] >= vals[i - 1] - 1e-9 }).toEqual({ df: dfs[i], rising: true });
    }
  });

  test("no critical value pins at the bisection ceiling", () => {
    for (const df of [1000, 2000, 3000, 4000, 5000]) {
      for (const k of [2, 3, 5]) {
        const q = studentizedRangeCritical(0.05, k, df);
        expect({ df, k, sane: q > 2 && q < 6 }).toEqual({ df, k, sane: true });
      }
    }
  });
});

describe("chi-square tails and totals", () => {
  test("a tiny p-value is a number, not zero", () => {
    // 1 - gammp(...) annihilated q below ~1e-16 because the CF branch had already
    // formed 1 - q. Zero is not a p-value.
    expect(chiSquareP(100, 1)).toBeGreaterThan(0);
    expect(chiSquareP(100, 1)).toBeLessThan(1e-20);
    expect(chiSquareP(200, 10)).toBeGreaterThan(0);
  });

  test("known quantiles still hold", () => {
    // chi2(0.95, 1) = 3.841459
    expect(chiSquareP(3.841459, 1)).toBeCloseTo(0.05, 6);
    expect(chiSquareP(18.307, 10)).toBeCloseTo(0.05, 3);
  });

  test("goodness of fit refuses mismatched totals instead of inventing a statistic", () => {
    // Proportions entered in a counts field: observed sums to 60, expected to 6.
    const r = chiSquareGoodnessOfFit([10, 20, 30], [1, 2, 3]);
    expect(r.reason).toBeTruthy();
    expect(Number.isNaN(r.chi2)).toBe(true);
    // and a legitimate test still works
    const ok = chiSquareGoodnessOfFit([10, 20, 30], [20, 20, 20]);
    expect(ok.reason).toBeUndefined();
    expect(ok.chi2).toBeCloseTo(10, 6);
  });
});

describe("the rank tests refuse non-finite input rather than ranking it", () => {
  test("a NaN does not become a significant p-value", () => {
    // The comparator returns NaN for NaN, leaving the sort order unspecified —
    // so the ranks were arbitrary and p = 0.030 "significant" came out of noise.
    expect(() => mannWhitneyU([1, 2, NaN, 4], [5, 6, 7, 8])).toThrow(/finite/i);
    expect(() => kruskalWallis([[1, 2, NaN], [4, 5, 6], [7, 8, 9]])).toThrow(/finite/i);
  });

  test("ordinary input is unaffected", () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
    expect(r.p).toBeLessThan(0.05);
  });
});

describe("scale invariance and large inputs", () => {
  test("least squares is scale-equivariant, so a tiny predictor is not 'collinear'", () => {
    const y = [1, 2, 3, 4, 5, 6, 7, 8];
    const base = [1, 2, 3, 4, 5, 6, 7, 9];
    for (const s of [1, 1e-6, 1e-12, 1e-13, 1e-18]) {
      const r = multipleRegression(y, [base.map((v) => v * s)]);
      expect({ s, ok: r.ok }).toEqual({ s, ok: true });
      // R^2 is invariant under scaling a predictor.
      expect(r.rSquared).toBeCloseTo(multipleRegression(y, [base]).rSquared, 9);
    }
  });

  test("describe() does not blow the stack on a large paste", () => {
    // Math.min(...xs) threw RangeError past ~130,000 values. n = 100,000 worked,
    // so it looked fine.
    const xs = Array.from({ length: 200000 }, (_, i) => (i % 977) + 1);
    const d = describeStats(xs);
    expect(d.min).toBe(1);
    expect(d.max).toBe(977);
  });
});

describe("two-way ANOVA enforces what its docstring promises", () => {
  test("a ragged design is refused, not returned as NaN", () => {
    const ragged = [
      [[1, 2], [3, 4], [5, 6]],
      [[7, 8], [9, 10]],
    ];
    expect(() => twoWayAnova(ragged)).toThrow(/rectangular/i);
  });

  test("a rectangular design still works", () => {
    const ok = [
      [[1, 2], [3, 4]],
      [[5, 6], [7, 8]],
    ];
    const r = twoWayAnova(ok);
    expect(Number.isFinite(r.factorA.F)).toBe(true);
  });
});

describe("Kaplan-Meier with no events", () => {
  test("S = 1 is still reported, but the zero-width interval is qualified", () => {
    // S(t) = 1 IS correct for all-censored data and Greenwood is legitimately
    // zero. What needed saying is that [1, 1] is an artefact of the formula
    // rather than certainty bought by three censored subjects.
    const r = kaplanMeier([1, 2, 3], [0, 0, 0]);
    expect(r.ok).toBe(true);
    for (const p of r.points) expect(p.survival).toBeCloseTo(1, 12);
    expect(r.caveats.join(" ")).toMatch(/NO EVENTS OCCURRED/);
    expect(r.caveats.join(" ")).toMatch(/artefact of the formula/);
  });
});
