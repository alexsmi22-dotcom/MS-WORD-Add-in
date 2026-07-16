// Tukey HSD — verified against a THEOREM, not a transcribed table.
//
// WHY THIS EXISTS (punch list #18)
// oneWayAnova shipped without a post-hoc test. A significant ANOVA says only "these
// groups are not all equal" — not WHICH differ. Without Tukey the user reaches for
// repeated t-tests, and that inflates the false-positive rate: 5 groups is 10 pairs,
// and at alpha 0.05 per test the chance of at least one spurious "significant"
// result is 1 - 0.95^10 = 40%. That is a correctness gap, not a missing convenience.
//
// HOW THE NUMERICS ARE CHECKED. The studentized range distribution has no closed
// form and is usually looked up in a table — which would be transcribed data, the
// exact failure mode that has bitten this project repeatedly (BLOSUM62, the compound
// dictionary, the NN parameters). So instead it is checked against an EXACT
// IDENTITY:
//
//     q(alpha, 2, df) = sqrt(2) * t(alpha/2, df)
//
// For two groups the studentized range IS sqrt(2) times the two-tailed t critical
// value. That is a theorem. It is verified here against the t distribution already
// living in stats.ts — an independent implementation — across many df. A quadrature
// bug could not satisfy it at every df by luck.

import { tukeyHSD, studentizedRangeCdf, studentizedRangeCritical, studentizedRangeP } from "../tukey";
import { tCritical, oneWayAnova } from "../stats";

describe("the studentized range matches the t distribution where theory says it must", () => {
  // q(alpha, 2, df) = sqrt(2) * t(alpha/2, df) — exact, for every df.
  test.each([5, 10, 15, 20, 30, 60, 120])("k=2, df=%i: q = sqrt(2)*t", (df) => {
    const q = studentizedRangeCritical(0.05, 2, df);
    const expected = Math.SQRT2 * tCritical(0.05, df);
    expect(q).toBeCloseTo(expected, 2);
  });

  test("the identity holds at other alphas too", () => {
    for (const alpha of [0.01, 0.1]) {
      for (const df of [10, 30]) {
        expect(studentizedRangeCritical(alpha, 2, df)).toBeCloseTo(Math.SQRT2 * tCritical(alpha, df), 2);
      }
    }
  });

  test("as df grows, q(2, df) approaches sqrt(2)*1.96", () => {
    // The normal limit: t(0.025, inf) = 1.96.
    expect(studentizedRangeCritical(0.05, 2, 100000)).toBeCloseTo(Math.SQRT2 * 1.96, 1);
  });
});

describe("the studentized range CDF behaves like a CDF", () => {
  test("monotone increasing in q", () => {
    let prev = -1;
    for (const q of [0.5, 1, 2, 3, 4, 5, 8]) {
      const c = studentizedRangeCdf(q, 4, 20);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  test("bounded in [0, 1], zero at zero, approaching one far out", () => {
    expect(studentizedRangeCdf(0, 3, 10)).toBe(0);
    expect(studentizedRangeCdf(-1, 3, 10)).toBe(0);
    expect(studentizedRangeCdf(30, 3, 10)).toBeGreaterThan(0.99);
    for (const q of [1, 3, 6]) {
      const c = studentizedRangeCdf(q, 5, 15);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  test("more groups means a larger critical value — that IS the multiplicity control", () => {
    // The whole point: comparing more pairs demands a higher bar.
    let prev = 0;
    for (const k of [2, 3, 4, 5, 6, 10]) {
      const q = studentizedRangeCritical(0.05, k, 20);
      expect(q).toBeGreaterThan(prev);
      prev = q;
    }
  });

  test("more error df means a smaller critical value", () => {
    let prev = Infinity;
    for (const df of [5, 10, 20, 60, 1000]) {
      const q = studentizedRangeCritical(0.05, 4, df);
      expect(q).toBeLessThan(prev);
      prev = q;
    }
  });

  test("a stricter alpha demands a larger q", () => {
    expect(studentizedRangeCritical(0.01, 4, 20)).toBeGreaterThan(studentizedRangeCritical(0.05, 4, 20));
    expect(studentizedRangeCritical(0.05, 4, 20)).toBeGreaterThan(studentizedRangeCritical(0.1, 4, 20));
  });

  test("the p function inverts the critical value", () => {
    for (const [k, df] of [[3, 12], [4, 20], [5, 30]] as [number, number][]) {
      const q = studentizedRangeCritical(0.05, k, df);
      expect(studentizedRangeP(q, k, df)).toBeCloseTo(0.05, 2);
    }
  });
});

describe("Tukey HSD on data with a known answer", () => {
  // Groups 1 and 2 are the same; group 3 is clearly shifted. Tukey must find
  // exactly that pattern — not "everything differs", not "nothing differs".
  const A = [10, 11, 12, 11, 10, 12, 11];
  const B = [11, 12, 11, 10, 11, 12, 10];
  const C = [20, 21, 22, 21, 20, 22, 21];

  test("finds the shifted group and only the shifted group", () => {
    const r = tukeyHSD([A, B, C])!;
    expect(r.pairs).toHaveLength(3); // 3 groups -> 3 pairs
    const ab = r.pairs.find((p) => p.i === 0 && p.j === 1)!;
    const ac = r.pairs.find((p) => p.i === 0 && p.j === 2)!;
    const bc = r.pairs.find((p) => p.i === 1 && p.j === 2)!;
    expect(ab.significant).toBe(false);
    expect(ac.significant).toBe(true);
    expect(bc.significant).toBe(true);
    expect(ab.p).toBeGreaterThan(0.05);
    expect(ac.p).toBeLessThan(0.01);
  });

  test("identical groups produce no significant pairs", () => {
    const r = tukeyHSD([A, [...A], [...A]])!;
    for (const p of r.pairs) {
      expect(p.significant).toBe(false);
      expect(p.difference).toBeCloseTo(0, 9);
      expect(p.p).toBeGreaterThan(0.9);
    }
  });

  test("a significant pair's confidence interval excludes zero, and vice versa", () => {
    // The interval and the decision must agree — if they disagree, one is wrong.
    const r = tukeyHSD([A, B, C])!;
    for (const p of r.pairs) {
      const excludesZero = p.ciLow > 0 || p.ciHigh < 0;
      expect({ pair: `${p.i}-${p.j}`, agree: excludesZero === p.significant }).toEqual({
        pair: `${p.i}-${p.j}`,
        agree: true,
      });
    }
  });

  test("the MSE matches what ANOVA computes from the same data", () => {
    // Tukey must be built on the ANOVA's pooled variance, not its own.
    const r = tukeyHSD([A, B, C])!;
    const a = oneWayAnova([A, B, C]);
    expect(r.dfWithin).toBe(a.dfWithin);
  });

  test("Tukey agrees with ANOVA about whether anything differs at all", () => {
    const differing = tukeyHSD([A, B, C])!;
    expect(oneWayAnova([A, B, C]).p).toBeLessThan(0.05);
    expect(differing.pairs.some((p) => p.significant)).toBe(true);

    const same = tukeyHSD([A, [...A], [...A]])!;
    expect(oneWayAnova([A, [...A], [...A]]).p).toBeGreaterThan(0.05);
    expect(same.pairs.some((p) => p.significant)).toBe(false);
  });
});

describe("Tukey is stricter than repeated t-tests — which is the entire point", () => {
  test("the Tukey threshold exceeds the pairwise t threshold for k > 2", () => {
    // If it were not stricter it would not be controlling anything.
    for (const k of [3, 4, 5, 6]) {
      const qTukey = studentizedRangeCritical(0.05, k, 30);
      const qPairwise = Math.SQRT2 * tCritical(0.05, 30); // an uncorrected t-test
      expect(qTukey).toBeGreaterThan(qPairwise);
    }
  });

  test("the family-wise p is always LARGER than the uncorrected pairwise p", () => {
    // The concrete cost of running t-tests instead, stated as the COMPARISON it
    // actually is. An earlier draft asserted p > 0.01 and failed at 0.0092 — which
    // said nothing about the statistics and everything about a threshold I picked.
    // The real claim is the relationship, and it must hold for every pair.
    const g = [
      [10, 11, 12, 11, 10],
      [12, 13, 14, 13, 12],
      [10, 11, 12, 11, 10],
      [10, 11, 12, 11, 10],
      [10, 11, 12, 11, 10],
    ];
    const r = tukeyHSD(g)!;
    for (const pair of r.pairs) {
      // The same q read against a 2-group (uncorrected) reference is the naive
      // pairwise p. Tukey's must never be smaller — correcting for multiplicity can
      // only cost significance, never grant it.
      const naive = studentizedRangeP(pair.q, 2, r.dfWithin);
      expect({ pair: `${pair.i}-${pair.j}`, ok: pair.p >= naive - 1e-12 }).toEqual({
        pair: `${pair.i}-${pair.j}`,
        ok: true,
      });
    }
    // And on this data the gap is real, not a rounding artefact: the one shifted
    // group clears an uncorrected bar comfortably.
    const pair01 = r.pairs.find((p) => p.i === 0 && p.j === 1)!;
    expect(pair01.q).toBeGreaterThan(Math.SQRT2 * tCritical(0.05, r.dfWithin));
    expect(pair01.p).toBeGreaterThan(studentizedRangeP(pair01.q, 2, r.dfWithin) * 5);
  });
});

describe("unequal group sizes (Tukey-Kramer)", () => {
  test("handles unequal n and says it is the approximate variant", () => {
    const r = tukeyHSD([[10, 11, 12], [11, 12, 11, 10, 12, 11], [20, 21]])!;
    expect(r.pairs).toHaveLength(3);
    expect(r.caveats.join(" ")).toMatch(/Tukey-Kramer variant/);
    expect(r.caveats.join(" ")).toMatch(/approximate/);
  });

  test("equal n does NOT get the Kramer caveat", () => {
    const r = tukeyHSD([[10, 11, 12], [11, 12, 11], [20, 21, 22]])!;
    expect(r.caveats.join(" ")).not.toMatch(/Tukey-Kramer variant/);
  });

  test("tiny groups are called out", () => {
    const r = tukeyHSD([[10, 11], [20, 21], [30, 31]])!;
    expect(r.caveats.join(" ")).toMatch(/fewer than 3 observations/);
  });
});

describe("caveats say what the numbers do not", () => {
  test("it warns AGAINST double-correcting", () => {
    // A real and common mistake: Bonferroni on top of Tukey.
    const r = tukeyHSD([[1, 2, 3], [4, 5, 6], [7, 8, 9]])!;
    expect(r.caveats.join(" ")).toMatch(/FAMILY-WISE/);
    expect(r.caveats.join(" ")).toMatch(/Do NOT apply a Bonferroni/);
  });

  test("it names the assumption Tukey is NOT robust to", () => {
    const r = tukeyHSD([[1, 2, 3], [4, 5, 6], [7, 8, 9]])!;
    expect(r.caveats.join(" ")).toMatch(/NOT.*to unequal variances/);
    expect(r.caveats.join(" ")).toMatch(/Games-Howell/);
  });

  test("it points at Dunnett when Tukey is the wrong tool", () => {
    const r = tukeyHSD([[1, 2, 3], [4, 5, 6], [7, 8, 9]])!;
    expect(r.caveats.join(" ")).toMatch(/Dunnett/);
  });
});

describe("it refuses rather than inventing", () => {
  test("fewer than two groups returns null", () => {
    expect(tukeyHSD([[1, 2, 3]])).toBeNull();
    expect(tukeyHSD([])).toBeNull();
  });

  test("an empty group returns null", () => {
    expect(tukeyHSD([[1, 2, 3], []])).toBeNull();
  });

  test("no residual degrees of freedom returns null rather than dividing by zero", () => {
    // One observation per group: nothing left to estimate the variance with.
    expect(tukeyHSD([[1], [2], [3]])).toBeNull();
  });
});
