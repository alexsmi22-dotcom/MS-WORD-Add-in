// Exact p-values for Mann–Whitney U and Wilcoxon signed-rank (v2.135.0).
// Every value below is §D2 of docs/SCOPE-STATS-BATCH.md. Oracles: SciPy 1.18.1
// mannwhitneyu(method="exact") / wilcoxon(method="exact") without ties;
// permutation_test(n_resamples=inf) (exhaustive) with ties; both confirmed by a
// brute-force enumeration in Fractions. The "normal+CC" column is the value the
// brief records for the tie- and continuity-corrected approximation.

import {
  EXACT_RANK_MAX_N,
  binomialBig,
  exactP,
  exactTails,
  formatExactP,
  rankSumNull,
  rankTestLines,
  signedRankNull,
  sig6,
} from "../exactRank";
import { mannWhitneyU, wilcoxonSignedRank, rankWithTies } from "../stats2";

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

describe("§D2 Mann–Whitney — exact p (SciPy method='exact' / permutation_test oracle)", () => {
  const rows: Array<{ a: number[]; b: number[]; U: number; num: bigint; den: bigint; p: number; normal: number; cond: boolean }> = [
    // 3 v 3: the smallest p attainable; the normal 0.0809 was impossible.
    { a: [1, 2, 3], b: [4, 5, 6], U: 0, num: 1n, den: 10n, p: 0.1, normal: 0.0808556, cond: false },
    // the shipped pane default
    { a: [1, 2, 3, 4, 5], b: [6, 7, 8, 9, 10], U: 0, num: 1n, den: 126n, p: 0.00793651, normal: 0.0121858, cond: false },
    { a: [0.8, 1.1, 1.3, 1.9], b: [2.1, 2.4, 2.6, 3.0], U: 0, num: 1n, den: 35n, p: 0.0285714, normal: 0.0303828, cond: false },
    { a: [12, 15, 11, 18, 14, 13], b: [22, 19, 25, 17, 21, 24, 20], U: 1, num: 1n, den: 429n, p: 0.002331, normal: 0.00534099, cond: false },
    { a: [1, 2, 2, 3], b: [2, 3, 4, 5], U: 2.5, num: 1n, den: 5n, p: 0.2, normal: 0.136658, cond: true },
    // asymmetric tied distribution: 2·min tail (R's rule) = 20/462; coin's |T−μ| form would give 0.0281385
    { a: [1, 1, 2, 2, 3], b: [2, 3, 3, 4, 4, 5], U: 3, num: 10n, den: 231n, p: 0.04329, normal: 0.0316334, cond: true },
  ];
  test.each(rows)("$a vs $b → U = $U, p = $num/$den", ({ a, b, U, num, den, p, normal, cond }) => {
    const r = mannWhitneyU(a, b);
    expect(r.statistic).toBe(U);
    expect(r.method).toBe("exact");
    expect(r.exact!.twoSided.num).toBe(num);
    expect(r.exact!.twoSided.den).toBe(den);
    expect(rel(r.p, p)).toBeLessThan(1e-5);
    expect(r.pExact).toBe(r.p);
    expect(rel(r.pNormal, normal)).toBeLessThan(1e-5);
    expect(r.exactConditional).toBe(cond);
    // swapping the groups changes nothing two-sided
    const s = mannWhitneyU(b, a);
    expect(s.exact!.twoSided).toEqual(r.exact!.twoSided);
    expect(s.exact!.lower).toEqual(r.exact!.upper);
  });

  test("the asymmetric tied row is NOT coin's |T − μ| value (the rule is stated, not drifted)", () => {
    const r = mannWhitneyU([1, 1, 2, 2, 3], [2, 3, 3, 4, 4, 5]);
    expect(Math.abs(r.p - 0.0281385)).toBeGreaterThan(0.01);
    expect(r.exact!.total).toBe(462n);
  });

  test("U₁ and U₂ are reported and the null distribution is on the U₁ scale", () => {
    const r = mannWhitneyU([4, 5, 6], [1, 2, 3]);
    expect(r.u1).toBe(9);
    expect(r.u2).toBe(0);
    expect(r.exact!.observed).toBe(9);
    expect(r.exact!.support[0]).toBe(0);
    expect(r.exact!.support[r.exact!.support.length - 1]).toBe(9);
    expect(r.exact!.probs.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(r.exact!.minTwoSided.value).toBeCloseTo(0.1, 12);
  });

  test("31 v 30 (N = 61) → the normal approximation only, with the switch line", () => {
    const a = Array.from({ length: 31 }, (_, i) => i * 1.7);
    const b = Array.from({ length: 30 }, (_, i) => i * 1.9 + 3);
    const r = mannWhitneyU(a, b);
    expect(r.method).toBe("normal");
    expect(r.pExact).toBeUndefined();
    expect(r.p).toBe(r.pNormal);
    const lines = rankTestLines(r, "mann-whitney").join("\n");
    expect(lines).toMatch(/above 60: the normal approximation is accurate here/);
    expect(lines).toMatch(/Exact when n ≤ 60/);
  });

  test("N = 60 exactly is still exact", () => {
    const a = Array.from({ length: 30 }, (_, i) => i);
    const b = Array.from({ length: 30 }, (_, i) => i + 0.5);
    expect(mannWhitneyU(a, b).method).toBe("exact");
    expect(EXACT_RANK_MAX_N).toBe(60);
  });
});

describe("§D2 Wilcoxon signed-rank — exact p (zeros dropped, Wilcoxon's convention)", () => {
  const rows: Array<{ a: number[]; b: number[]; n: number; wp: number; num: bigint; den: bigint; p: number; normal: number; zeros: number }> = [
    // the shipped pane default: 1 zero dropped
    {
      a: [125, 115, 130, 140, 140, 115, 140, 125],
      b: [110, 122, 125, 120, 140, 124, 123, 137],
      n: 7, wp: 19, num: 15n, den: 32n, p: 0.46875, normal: 0.446873, zeros: 1,
    },
    { a: [10, 12, 14, 16, 18], b: [9, 10, 11, 12, 13], n: 5, wp: 15, num: 1n, den: 16n, p: 0.0625, normal: 0.0590582, zeros: 0 },
    { a: [8.2, 7.1, 6.5, 9.0, 5.4, 7.7], b: [7.0, 7.3, 5.1, 8.2, 5.0, 6.1], n: 6, wp: 20, num: 1n, den: 16n, p: 0.0625, normal: 0.0591721, zeros: 0 },
    {
      a: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], b: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      n: 10, wp: 55, num: 1n, den: 512n, p: 0.00195313, normal: 0.0019042, zeros: 0,
    },
    { a: [1.5, 2.5, 3.5], b: [1.0, 2.0, 3.0], n: 3, wp: 6, num: 1n, den: 4n, p: 0.25, normal: 0.148915, zeros: 0 },
    { a: [1, 2, 3, 4, 5, 6], b: [0, 0, 1, 2, 4, 5], n: 6, wp: 21, num: 1n, den: 32n, p: 0.03125, normal: 0.0320149, zeros: 0 },
  ];
  test.each(rows)("n = $n, W⁺ = $wp → p = $num/$den", ({ a, b, n, wp, num, den, p, normal, zeros }) => {
    const r = wilcoxonSignedRank(a, b);
    expect(r.n1).toBe(n);
    expect(r.wPlus).toBeCloseTo(wp, 9);
    expect(r.zerosDropped).toBe(zeros);
    expect(r.method).toBe("exact");
    expect(r.exact!.twoSided.num).toBe(num);
    expect(r.exact!.twoSided.den).toBe(den);
    expect(rel(r.p, p)).toBeLessThan(1e-5);
    expect(rel(r.pNormal, normal)).toBeLessThan(1e-5);
  });

  test("the default reports W⁺ = 19, W⁻ = 9 and says the zero was dropped", () => {
    const r = wilcoxonSignedRank([125, 115, 130, 140, 140, 115, 140, 125], [110, 122, 125, 120, 140, 124, 123, 137]);
    expect(r.wPlus).toBe(19);
    expect(r.wMinus).toBe(9);
    const text = rankTestLines(r, "wilcoxon").join("\n");
    expect(text).toContain("W⁺ = 19, W⁻ = 9");
    expect(text).toMatch(/1 zero difference dropped before ranking \(Wilcoxon's convention, as R\)/);
    expect(text).toContain("p = 15/32 = 0.468750");
    expect(text).toMatch(/Two-sided p = min\(1, 2 × the smaller one-sided exact tail\)/);
    expect(text).toMatch(/Normal approximation \(tie- and continuity-corrected\).*p = 0\.446873/);
  });

  test("n = 61 non-zero differences → normal only", () => {
    const a = Array.from({ length: 61 }, (_, i) => i + 1);
    const b = a.map((v, i) => v - (i % 3 === 0 ? -(i + 1) : i + 1));
    const r = wilcoxonSignedRank(a, b);
    expect(r.method).toBe("normal");
    expect(r.p).toBe(r.pNormal);
  });
});

describe("text helper — the stated conventions, display-contract clean", () => {
  test("3 v 3 says no p below 0.1 is possible, and labels the normal value beside", () => {
    const r = mannWhitneyU([1, 2, 3], [4, 5, 6]);
    const text = rankTestLines(r, "mann-whitney").join("\n");
    expect(text).toContain("U₁ = 0, U₂ = 9 (U = 0)");
    expect(text).toContain("p = 1/10 = 0.100000, two-sided, exact");
    expect(text).toMatch(/With 3 v 3, no two-sided p below 0\.100000 is possible/);
    expect(text).toMatch(/shown beside; the exact p is the one reported/);
    expect(text).not.toMatch(/\^|chi2|NaN|Infinity|e-\d/);
  });
  test("ties are named as conditional", () => {
    const text = rankTestLines(mannWhitneyU([1, 2, 2, 3], [2, 3, 3, 4]), "mann-whitney").join("\n");
    expect(text).toMatch(/exact \(conditional on the ties\)/);
  });
  test("long denominators print 6 s.f., labelled", () => {
    expect(formatExactP(exactP(1n, 1352078n))).toMatch(/× 10⁻⁷ \(6 s\.f\.\)$/);
    expect(formatExactP(exactP(1n, 429n))).toBe("1/429 = 0.00233100");
    expect(sig6(2.5e-9)).toBe("2.50000 × 10⁻⁹");
  });
});

describe("DP self-checks (§D2): totals exact, probabilities sum to 1", () => {
  test("rank-sum null totals C(N, k) exactly, even past 2⁵³", () => {
    const d = Array.from({ length: 60 }, (_, i) => 2 * (i + 1));
    const nul = rankSumNull(d, 30);
    expect(nul.total).toBe(binomialBig(60, 30));
    expect(nul.total > 2n ** 53n).toBe(true);
    const s = nul.counts.reduce((acc, c) => acc + Number(c) / Number(nul.total), 0);
    expect(Math.abs(s - 1)).toBeLessThan(1e-12);
  });
  test("signed-rank null totals 2ⁿ exactly", () => {
    const { ranks } = rankWithTies([1, 2, 2, 3, 5, 5, 5, 8]);
    const nul = signedRankNull(ranks.map((r) => 2 * r));
    expect(nul.total).toBe(256n);
    const t = exactTails(nul, 0);
    expect(t.lower).toEqual(exactP(1n, 256n));
  });
});
