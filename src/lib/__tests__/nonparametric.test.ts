// Kruskal-Wallis, Dunn and Friedman.
//
// Checked against hand-computable cases rather than against whatever the code
// emits. The tie corrections get particular attention: without them the
// statistic is biased DOWNWARD, so the failure mode is under-reporting
// significance, which nothing on screen would reveal.

import { kruskalWallis, dunnTest, friedman, rankWithTies } from "../nonparametric";

describe("ranking", () => {
  test("ties share the mean rank", () => {
    // 1, 2, 2, 3 -> ranks 1, 2.5, 2.5, 4
    const { ranks, tieSum } = rankWithTies([1, 2, 2, 3]);
    expect(ranks).toEqual([1, 2.5, 2.5, 4]);
    expect(tieSum).toBe(6); // one tie of 2: 2³−2
  });

  test("no ties means no correction term", () => {
    expect(rankWithTies([5, 1, 3]).tieSum).toBe(0);
    expect(rankWithTies([5, 1, 3]).ranks).toEqual([3, 1, 2]);
  });
});

describe("Kruskal-Wallis", () => {
  test("H is computed from rank sums, verified by hand", () => {
    // Groups of 3 with no ties and no overlap: ranks 1-3, 4-6, 7-9.
    // R = 6, 15, 24; sum R²/n = (36+225+576)/3 = 279
    // H = 12/(9*10) * 279 − 3*10 = 0.13333*279 − 30 = 37.2 − 30 = 7.2
    const r = kruskalWallis([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(r.ok).toBe(true);
    expect(r.h).toBeCloseTo(7.2, 10);
    expect(r.df).toBe(2);
    expect(r.tiesCorrected).toBe(false);
  });

  test("identical groups give H = 0", () => {
    const r = kruskalWallis([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
    expect(r.h).toBeCloseTo(0, 10);
    expect(r.p).toBeCloseTo(1, 6);
  });

  test("the tie correction INCREASES H, never decreases it", () => {
    // Without it the statistic is biased downward and significance is
    // under-reported — silently.
    const tied = kruskalWallis([[1, 1, 2], [2, 3, 3], [4, 4, 5]]);
    expect(tied.tiesCorrected).toBe(true);
    // Recompute the uncorrected value from the same data to compare.
    const n = 9;
    const { ranks, tieSum } = rankWithTies([1, 1, 2, 2, 3, 3, 4, 4, 5]);
    let sum = 0;
    for (let g = 0; g < 3; g++) {
      let rs = 0;
      for (let i = 0; i < 3; i++) rs += ranks[g * 3 + i];
      sum += (rs * rs) / 3;
    }
    const uncorrected = (12 / (n * (n + 1))) * sum - 3 * (n + 1);
    expect(tied.h).toBeGreaterThan(uncorrected);
    expect(tieSum).toBeGreaterThan(0);
  });

  test("mean ranks are reported in input order", () => {
    const r = kruskalWallis([[7, 8, 9], [1, 2, 3]]);
    expect(r.meanRanks[0]).toBeGreaterThan(r.meanRanks[1]);
    expect(r.groupSizes).toEqual([3, 3]);
  });

  test("well-separated groups are significant; overlapping ones are not", () => {
    const sep = kruskalWallis([[1, 2, 3, 4, 5], [11, 12, 13, 14, 15], [21, 22, 23, 24, 25]]);
    expect(sep.p).toBeLessThan(0.05);
    const overlap = kruskalWallis([[1, 5, 9], [2, 6, 10], [3, 7, 11]]);
    expect(overlap.p).toBeGreaterThan(0.05);
  });

  test("refuses fewer than two groups rather than returning a number", () => {
    expect(kruskalWallis([[1, 2, 3]]).ok).toBe(false);
    expect(kruskalWallis([]).ok).toBe(false);
  });
});

describe("Dunn's post-hoc", () => {
  const groups = [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15],
  ];

  test("compares every pair once", () => {
    const d = dunnTest(groups);
    expect(d.ok).toBe(true);
    expect(d.comparisons).toHaveLength(3); // 3 choose 2
    expect(d.comparisons.map((c) => [c.a, c.b])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  test("the widest-separated pair has the largest |z|", () => {
    const d = dunnTest(groups);
    const zs = d.comparisons.map((c) => Math.abs(c.z));
    // 0 vs 2 are furthest apart.
    expect(zs[1]).toBeGreaterThan(zs[0]);
    expect(zs[1]).toBeGreaterThan(zs[2]);
  });

  test("adjusted p is never smaller than raw p", () => {
    // The entire point of the correction; a smaller adjusted p would mean the
    // multiplicity correction was making claims stronger.
    for (const c of dunnTest(groups, "holm").comparisons) {
      expect(c.pAdjusted).toBeGreaterThanOrEqual(c.p - 1e-12);
    }
  });

  test("Bonferroni is at least as conservative as Holm", () => {
    const holm = dunnTest(groups, "holm").comparisons.map((c) => c.pAdjusted);
    const bonf = dunnTest(groups, "bonferroni").comparisons.map((c) => c.pAdjusted);
    for (let i = 0; i < holm.length; i++) {
      expect(bonf[i]).toBeGreaterThanOrEqual(holm[i] - 1e-12);
    }
  });

  test("identical groups produce no significant pair", () => {
    const d = dunnTest([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
    expect(d.comparisons.every((c) => !c.significant)).toBe(true);
  });
});

describe("Friedman", () => {
  test("chi-square from rank sums, verified by hand", () => {
    // Three blocks, three treatments, treatment 1 < 2 < 3 in every block.
    // Every row ranks 1,2,3 -> R = 3, 6, 9; ΣR² = 9+36+81 = 126
    // chi2 = 12/(3*3*4) * 126 − 3*3*4 = (12/36)*126 − 36 = 42 − 36 = 6
    const r = friedman([
      [1, 2, 3],
      [10, 20, 30],
      [5, 6, 7],
    ]);
    expect(r.ok).toBe(true);
    expect(r.chi2).toBeCloseTo(6, 10);
    expect(r.df).toBe(2);
    expect(r.blocks).toBe(3);
    expect(r.treatments).toBe(3);
    expect(r.meanRanks).toEqual([1, 2, 3]);
  });

  test("no difference between treatments gives chi-square 0", () => {
    const r = friedman([
      [5, 5, 5],
      [9, 9, 9],
    ]);
    expect(r.chi2).toBeCloseTo(0, 10);
  });

  test("a ragged design is refused, not padded", () => {
    // Padding would invent measurements that were never taken.
    const r = friedman([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/same number/);
  });

  test("refuses a design too small to test", () => {
    expect(friedman([[1, 2, 3]]).ok).toBe(false);
    expect(friedman([[1], [2]]).ok).toBe(false);
  });

  test("a consistent treatment effect is detected across many blocks", () => {
    const blocks: number[][] = [];
    for (let i = 0; i < 10; i++) blocks.push([i, i + 5, i + 10]);
    const r = friedman(blocks);
    expect(r.p).toBeLessThan(0.01);
  });
});
