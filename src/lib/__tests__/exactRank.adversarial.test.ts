// HOSTILE tests for the exact rank p-values (house rule: a separate adversarial
// suite). The centre-piece is an INDEPENDENT route: brute-force enumeration of
// every group assignment / sign vector, with its own midrank function (not the
// exported rankWithTies), on 200 random tied instances per test — the §D2 DP
// self-check the brief asks to keep.

import { EXACT_RANK_MAX_N, binomialBig, rankSumNull, rankTestLines, signedRankNull } from "../exactRank";
import { mannWhitneyU, wilcoxonSignedRank } from "../stats2";

/** mulberry32 — deterministic, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent doubled midranks: rank of v = 2·(#less) + (#equal) + 1, doubled → 2·#less + #equal + 1. */
function doubledMidranks(xs: number[]): number[] {
  return xs.map((v) => {
    let less = 0;
    let eq = 0;
    for (const w of xs) {
      if (w < v) less++;
      else if (w === v) eq++;
    }
    return 2 * less + eq + 1;
  });
}

function popcount(m: number): number {
  let c = 0;
  while (m) {
    c += m & 1;
    m >>>= 1;
  }
  return c;
}

/** Brute force: [lowerCount, upperCount, total] for group a's doubled rank sum. */
function bruteMW(a: number[], b: number[]): [number, number, number] {
  const all = a.concat(b);
  const d = doubledMidranks(all);
  const N = all.length;
  let obs = 0;
  for (let i = 0; i < a.length; i++) obs += d[i];
  let lo = 0;
  let hi = 0;
  let total = 0;
  for (let m = 0; m < 1 << N; m++) {
    if (popcount(m) !== a.length) continue;
    let s = 0;
    for (let i = 0; i < N; i++) if (m & (1 << i)) s += d[i];
    total++;
    if (s <= obs) lo++;
    if (s >= obs) hi++;
  }
  return [lo, hi, total];
}

/** Brute force: [lowerCount, upperCount, total] for doubled W⁺, zeros dropped. */
function bruteWSR(a: number[], b: number[]): [number, number, number, number] {
  const diffs = a.map((v, i) => v - b[i]).filter((x) => x !== 0);
  const n = diffs.length;
  const d = doubledMidranks(diffs.map(Math.abs));
  let obs = 0;
  for (let i = 0; i < n; i++) if (diffs[i] > 0) obs += d[i];
  let lo = 0;
  let hi = 0;
  for (let m = 0; m < 1 << n; m++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) s += d[i];
    if (s <= obs) lo++;
    if (s >= obs) hi++;
  }
  return [lo, hi, 1 << n, n];
}

/** p_num/p_den === count/total, by cross-multiplication (no floats). */
function sameRatio(num: bigint, den: bigint, count: number, total: number): boolean {
  return num * BigInt(total) === BigInt(count) * den;
}

describe("independent cross-check: brute-force enumeration, 200 random tied instances each", () => {
  test("Mann–Whitney, n₁ + n₂ ≤ 12: two-sided AND both one-sided tails equal brute force exactly", () => {
    const r = rng(20261014);
    let tiedCases = 0;
    for (let k = 0; k < 200; k++) {
      const N = 2 + Math.floor(r() * 11); // 2..12
      const n1 = 1 + Math.floor(r() * (N - 1));
      const levels = 1 + Math.floor(r() * 6); // few levels → heavy ties
      const draw = () => Math.floor(r() * levels) * 0.5;
      const a = Array.from({ length: n1 }, draw);
      const b = Array.from({ length: N - n1 }, draw);
      const res = mannWhitneyU(a, b);
      const [lo, hi, total] = bruteMW(a, b);
      expect(total).toBe(Number(binomialBig(N, n1)));
      const twoCount = Math.min(total, 2 * Math.min(lo, hi));
      if (res.method === "degenerate") {
        // every value tied: brute force must agree that nothing can vary
        expect(lo).toBe(total);
        expect(hi).toBe(total);
        expect(res.p).toBe(1);
        continue;
      }
      expect(res.method).toBe("exact");
      const e = res.exact!;
      if (e.conditional) tiedCases++;
      expect({ k, a, b, ok: sameRatio(e.twoSided.num, e.twoSided.den, twoCount, total) }).toEqual({ k, a, b, ok: true });
      expect(sameRatio(e.lower.num, e.lower.den, lo, total)).toBe(true);
      expect(sameRatio(e.upper.num, e.upper.den, hi, total)).toBe(true);
      expect(e.total).toBe(BigInt(total));
    }
    expect(tiedCases).toBeGreaterThan(50); // the generator really did exercise ties
  });

  test("Wilcoxon, n ≤ 12 pairs (zeros included and dropped): equals brute force exactly", () => {
    const r = rng(777);
    let zeroCases = 0;
    for (let k = 0; k < 200; k++) {
      const n = 1 + Math.floor(r() * 12);
      const a = Array.from({ length: n }, () => Math.floor(r() * 5));
      const b = Array.from({ length: n }, () => Math.floor(r() * 5));
      const res = wilcoxonSignedRank(a, b);
      const [lo, hi, total, nz] = bruteWSR(a, b);
      if (nz < n) zeroCases++;
      expect(res.n1).toBe(nz);
      expect(res.zerosDropped).toBe(n - nz);
      if (nz === 0) {
        expect(res.method).toBe("degenerate");
        expect(res.pExact).toBeUndefined();
        continue;
      }
      const e = res.exact!;
      const twoCount = Math.min(total, 2 * Math.min(lo, hi));
      expect({ k, a, b, ok: sameRatio(e.twoSided.num, e.twoSided.den, twoCount, total) }).toEqual({ k, a, b, ok: true });
      expect(sameRatio(e.lower.num, e.lower.den, lo, total)).toBe(true);
      expect(sameRatio(e.upper.num, e.upper.den, hi, total)).toBe(true);
    }
    expect(zeroCases).toBeGreaterThan(50);
  });
});

describe("typed decimals: ties are judged at the data's precision, not on raw doubles (review defect)", () => {
  // The brute force here runs on SCALED INTEGERS (×10), where float equality is
  // exact — an independent route around the defect, not through it.
  test("the significance-crossing case: 0.0625 conditional on the ties, never 0.046875 'untied'", () => {
    const a = [2.1, 1.6, 2.7, 2.9, 1, 2.8, 0.9];
    const b = [1.8, 0.4, 0.5, 2.7, 1.2, 0.5, 0.7];
    const [lo, hi, total] = bruteWSR(a.map((x) => Math.round(x * 10)), b.map((x) => Math.round(x * 10)));
    const truth = Math.min(total, 2 * Math.min(lo, hi)) / total;
    expect(truth).toBe(0.0625);
    const r = wilcoxonSignedRank(a, b);
    expect(r.p).toBeCloseTo(truth, 14);
    expect(r.exactConditional).toBe(true);
    expect(rankTestLines(r, "wilcoxon").join("\n")).toContain(
      "Differences equal to 1 decimal place (the data's own precision) are treated as tied",
    );
  });

  test("Wilcoxon: 300 random one/two-decimal datasets equal the scaled-integer brute force", () => {
    const r = rng(31337);
    for (let k = 0; k < 300; k++) {
      const dp = k % 2 === 0 ? 1 : 2;
      const s = 10 ** dp;
      const n = 1 + Math.floor(r() * 11);
      const a = Array.from({ length: n }, () => Math.round(r() * 3 * s) / s);
      const b = Array.from({ length: n }, () => Math.round(r() * 3 * s) / s);
      const [lo, hi, total, nz] = bruteWSR(a.map((x) => Math.round(x * s)), b.map((x) => Math.round(x * s)));
      const res = wilcoxonSignedRank(a, b);
      expect(res.n1).toBe(nz);
      if (nz === 0) continue;
      const truth = Math.min(total, 2 * Math.min(lo, hi)) / total;
      expect({ k, a, b, p: res.p }).toEqual({ k, a, b, p: truth });
    }
  });

  test("Mann–Whitney on COMPUTED values (0.1 + 0.2 vs 0.3): equal to the scaled-integer brute force, and said", () => {
    const r = rng(4242);
    for (let k = 0; k < 200; k++) {
      const n1 = 1 + Math.floor(r() * 5);
      const n2 = 1 + Math.floor(r() * 6);
      // computed sums of one-decimal values: float noise in the last bits
      const draw = () => Math.round(r() * 10) / 10 + Math.round(r() * 10) / 10;
      const a = Array.from({ length: n1 }, draw);
      const b = Array.from({ length: n2 }, draw);
      const [lo, hi, total] = bruteMW(a.map((x) => Math.round(x * 10)), b.map((x) => Math.round(x * 10)));
      const res = mannWhitneyU(a, b);
      const truth = Math.min(total, 2 * Math.min(lo, hi)) / total;
      expect({ k, a, b, p: res.p }).toEqual({ k, a, b, p: truth });
    }
    const res = mannWhitneyU([0.1 + 0.2, 1], [0.3, 2]);
    expect(res.exactConditional).toBe(true);
    expect(res.tieNote).toMatch(/Values equal to 12 decimal places/);
  });

  test("no note when nothing was merged; integers untouched", () => {
    expect(wilcoxonSignedRank([10, 12, 14, 16, 18], [9, 10, 11, 12, 13]).tieNote).toBeUndefined();
    expect(mannWhitneyU([1, 2, 3], [4, 5, 6]).tieNote).toBeUndefined();
  });

  test("a difference that is float noise only becomes a dropped zero, and is said", () => {
    const res = wilcoxonSignedRank([0.1 + 0.2, 5, 7], [0.3, 1, 2]);
    expect(res.zerosDropped).toBe(1);
    expect(res.tieNote).toMatch(/treated as tied/);
  });
});

describe("brute force on the FIXED inputs pinned in the older stats2/statsAuthorities/chartOverflow files", () => {
  // Those files cite "brute force" as the oracle for these values; this is
  // where that brute force actually runs, so the comments are true.
  test.each([
    { a: [1, 2, 3, 4, 5], b: [1, 2, 3, 4, 5], p: 1 },
    { a: [1, 2, 2, 3], b: [2, 3, 3, 4], p: 2 / 7 },
    { a: [1.7e308, -1.7e308, 1, 2, 3], b: [4, 5, 6, 7, 8], p: 19 / 126 },
    { a: [1, 2, 3, 4], b: [5, 6, 7, 8], p: 1 / 35 },
    { a: [1, 2, 3, 4, 5], b: [6, 7, 8, 9, 10], p: 2 / 252 },
  ])("Mann–Whitney $a vs $b → $p", ({ a, b, p }) => {
    const [lo, hi, total] = bruteMW(a, b);
    expect(Math.min(total, 2 * Math.min(lo, hi)) / total).toBeCloseTo(p, 14);
    expect(mannWhitneyU(a, b).p).toBeCloseTo(p, 14);
  });
  test.each([
    { a: [1, 2, 3, 4], b: [1, 5, 3, 1], p: 1 },
    { a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10], p: 0.0625 },
  ])("Wilcoxon $a vs $b → $p", ({ a, b, p }) => {
    const [lo, hi, total] = bruteWSR(a, b);
    expect(Math.min(total, 2 * Math.min(lo, hi)) / total).toBeCloseTo(p, 14);
    expect(wilcoxonSignedRank(a, b).p).toBeCloseTo(p, 14);
  });
});

describe("result text is insertable: no em dash (the pane's insertability sentinel), no 'p = 0', no NaN", () => {
  const cases: Array<[string, ReturnType<typeof mannWhitneyU>, "mann-whitney" | "wilcoxon"]> = [
    ["MW exact", mannWhitneyU([1, 2, 3], [4, 5, 6]), "mann-whitney"],
    ["MW tied", mannWhitneyU([1, 2, 2, 3], [2, 3, 4, 5]), "mann-whitney"],
    ["MW all tied", mannWhitneyU([5, 5], [5, 5]), "mann-whitney"],
    ["WSR default", wilcoxonSignedRank([125, 115, 130, 140, 140, 115, 140, 125], [110, 122, 125, 120, 140, 124, 123, 137]), "wilcoxon"],
    ["WSR all zero", wilcoxonSignedRank([1, 2], [1, 2]), "wilcoxon"],
    [
      "MW 5,000 v 5,000 separated (normal p underflows)",
      mannWhitneyU(Array.from({ length: 5000 }, (_, i) => i), Array.from({ length: 5000 }, (_, i) => i + 10000)),
      "mann-whitney",
    ],
  ];
  test.each(cases)("%s", (_name, res, kind) => {
    const text = rankTestLines(res, kind).join("\n");
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/NaN|Infinity|= undefined/); // the WORD "undefined" in a stated refusal is fine
    expect(text).not.toMatch(/p = 0(?![.\d])/);
    expect(text).not.toMatch(/z = -/); // a true minus sign, U+2212
  });
  test("the underflowed normal p prints as a stated bound", () => {
    const res = cases[5][1];
    expect(res.pNormal).toBe(0);
    expect(rankTestLines(res, "mann-whitney").join("\n")).toContain("p < 1 × 10⁻¹⁵");
  });
});

describe("the smallest-possible-p property", () => {
  test("Mann–Whitney: no exact two-sided p below 2/C(N, n₁) — 200 random untied and tied cases up to 30 v 30", () => {
    const r = rng(42);
    for (let k = 0; k < 200; k++) {
      const n1 = 1 + Math.floor(r() * 30);
      const n2 = 1 + Math.floor(r() * 30);
      const tied = k % 2 === 0;
      const draw = () => (tied ? Math.floor(r() * 8) : r());
      const a = Array.from({ length: n1 }, draw);
      // push b up so that small p-values actually occur
      const b = Array.from({ length: n2 }, () => draw() + (k % 3 === 0 ? 100 : 0));
      const res = mannWhitneyU(a, b);
      if (res.method !== "exact") continue;
      const floor = 2 / Number(binomialBig(n1 + n2, n1));
      expect(res.p).toBeGreaterThanOrEqual(Math.min(1, floor) * (1 - 1e-12));
      expect(res.p).toBeGreaterThanOrEqual(res.exact!.minTwoSided.value);
      expect(res.p).toBeLessThanOrEqual(1);
    }
  });

  test("complete separation hits the floor exactly", () => {
    const res = mannWhitneyU([1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13]);
    expect(res.exact!.twoSided.num).toBe(1n);
    expect(res.exact!.twoSided.den).toBe(binomialBig(13, 6) / 2n);
    expect(res.p).toBe(res.exact!.minTwoSided.value);
  });

  test("Wilcoxon: all one sign hits 2/2ⁿ, and nothing goes below it", () => {
    for (let n = 1; n <= 20; n++) {
      const a = Array.from({ length: n }, (_, i) => i + 10);
      const b = a.map((v, i) => v - (i + 1));
      const res = wilcoxonSignedRank(a, b);
      expect(res.p).toBeCloseTo(Math.min(1, 2 / 2 ** n), 15);
    }
  });
});

describe("symmetry of the null distribution", () => {
  test("untied: rank-sum and signed-rank nulls are palindromes", () => {
    for (const [N, k] of [[7, 3], [12, 5], [20, 10], [33, 11]]) {
      const nul = rankSumNull(Array.from({ length: N }, (_, i) => 2 * (i + 1)), k);
      const c = nul.counts;
      for (let i = 0; i < c.length; i++) expect(c[i]).toBe(c[c.length - 1 - i]);
    }
    for (const n of [1, 5, 13, 40]) {
      const c = signedRankNull(Array.from({ length: n }, (_, i) => 2 * (i + 1))).counts;
      for (let i = 0; i < c.length; i++) expect(c[i]).toBe(c[c.length - 1 - i]);
    }
  });

  test("tied and asymmetric: the distribution is NOT a palindrome — why the two-sided rule must be stated", () => {
    const res = mannWhitneyU([1, 1, 2, 2, 3], [2, 3, 3, 4, 4, 5]);
    const p = res.exact!.probs;
    expect(p.some((v, i) => Math.abs(v - p[p.length - 1 - i]) > 1e-12)).toBe(true);
  });
});

describe("DP totals are exact: C(N, n₁) and 2ⁿ", () => {
  test.each([
    [10, 1], [10, 5], [40, 20], [60, 30], [60, 1], [60, 59],
  ])("rank-sum N = %i, k = %i", (N, k) => {
    // heavy ties: values on 4 levels
    const vals = Array.from({ length: N }, (_, i) => i % 4);
    const d = doubledMidranks(vals);
    expect(rankSumNull(d, k).total).toBe(binomialBig(N, k));
  });
  test.each([1, 2, 17, 53, 60])("signed-rank n = %i", (n) => {
    const d = doubledMidranks(Array.from({ length: n }, (_, i) => 1 + (i % 3)));
    expect(signedRankNull(d).total).toBe(2n ** BigInt(n));
  });
});

describe("degenerate inputs, each by name", () => {
  test("all values tied (Mann–Whitney) → degenerate, p = 1, said", () => {
    const res = mannWhitneyU([5, 5, 5, 5], [5, 5, 5, 5]);
    expect(res.method).toBe("degenerate");
    expect(res.p).toBe(1);
    expect(res.note).toMatch(/Every value is tied/);
    expect(Number.isFinite(res.z)).toBe(true);
  });
  test("n₁ = 1: 1 v 5 with the lone value smallest → p = 2/6", () => {
    const res = mannWhitneyU([0], [1, 2, 3, 4, 5]);
    expect(res.exact!.twoSided.num).toBe(1n);
    expect(res.exact!.twoSided.den).toBe(3n);
  });
  test("1 v 1 → p = 1, never above 1", () => {
    const res = mannWhitneyU([1], [2]);
    expect(res.p).toBe(1);
    expect(res.method).toBe("exact");
  });
  test("an empty group → degenerate, not a crash", () => {
    expect(mannWhitneyU([], [1, 2]).method).toBe("degenerate");
  });
  test("Wilcoxon n = 1 → p = 1", () => {
    const res = wilcoxonSignedRank([2, 3], [2, 1]);
    expect(res.n1).toBe(1);
    expect(res.p).toBe(1);
    expect(res.zerosDropped).toBe(1);
  });
  test("Wilcoxon all zeros → undefined by name, no exact p", () => {
    const res = wilcoxonSignedRank([5, 6, 7], [5, 6, 7]);
    expect(res.method).toBe("degenerate");
    expect(res.pExact).toBeUndefined();
    expect(res.n1).toBe(0);
    expect(res.note).toMatch(/All paired differences are zero/);
  });
  test("Wilcoxon all |d| tied, mixed signs → still exact (signs vary), conditional", () => {
    const res = wilcoxonSignedRank([2, 2, 2, 0], [1, 1, 1, 1]);
    expect(res.method).toBe("exact");
    expect(res.exactConditional).toBe(true);
    // W⁺ = 3 midranks of 2.5 = 7.5 of 10; P(W⁺ ≥ 7.5) = P(≥3 positive) = 5/16 → two-sided 10/16
    expect(res.exact!.twoSided.num).toBe(5n);
    expect(res.exact!.twoSided.den).toBe(8n);
  });
  test("non-finite input still refuses (the NaN → significant-p trap)", () => {
    expect(() => mannWhitneyU([1, NaN], [2, 3])).toThrow(/finite/);
    expect(() => wilcoxonSignedRank([1, Infinity], [2, 3])).toThrow(/finite/);
  });
});

describe("caps BEFORE work", () => {
  test("the DP refuses N = 61 / n = 61 before allocating", () => {
    const d = Array.from({ length: EXACT_RANK_MAX_N + 1 }, (_, i) => 2 * (i + 1));
    expect(() => rankSumNull(d, 30)).toThrow(/capped at N = 60/);
    expect(() => signedRankNull(d)).toThrow(/capped at n = 60/);
  });
  test("non-integer doubled ranks are refused, never rounded silently", () => {
    expect(() => rankSumNull([2, 3.5, 6], 1)).toThrow(/integers/);
    expect(() => signedRankNull([2, -4])).toThrow(/integers/);
  });
  test("a huge sample goes straight to the normal path (no DP): 5,000 v 5,000 quickly", () => {
    const r = rng(9);
    const a = Array.from({ length: 5000 }, r);
    const b = Array.from({ length: 5000 }, () => r() + 0.01);
    const t0 = Date.now();
    const res = mannWhitneyU(a, b);
    expect(res.method).toBe("normal");
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe("timing: 25 v 25 under 1 s; the cap's worst cases under the 4 s gross-freeze bound", () => {
  function time(f: () => void): number {
    const t0 = Date.now();
    f();
    return Date.now() - t0;
  }
  test("25 v 25 with ties", () => {
    const r = rng(5);
    const a = Array.from({ length: 25 }, () => Math.floor(r() * 10));
    const b = Array.from({ length: 25 }, () => Math.floor(r() * 10) + 1);
    let res: ReturnType<typeof mannWhitneyU> | undefined;
    const ms = time(() => (res = mannWhitneyU(a, b)));
    expect(res!.method).toBe("exact");
    expect(ms).toBeLessThan(1000);
  });
  test("30 v 30 untied and 30 v 30 heavy ties (the N = 60 cap)", () => {
    const r = rng(6);
    const a = Array.from({ length: 30 }, r);
    const b = Array.from({ length: 30 }, r);
    expect(time(() => mannWhitneyU(a, b))).toBeLessThan(4000);
    const c = Array.from({ length: 30 }, () => Math.floor(r() * 3));
    const d = Array.from({ length: 30 }, () => Math.floor(r() * 3));
    expect(time(() => mannWhitneyU(c, d))).toBeLessThan(4000);
  });
  test("Wilcoxon n = 60", () => {
    const r = rng(7);
    const a = Array.from({ length: 60 }, r);
    const b = Array.from({ length: 60 }, r);
    let res: ReturnType<typeof wilcoxonSignedRank> | undefined;
    expect(time(() => (res = wilcoxonSignedRank(a, b)))).toBeLessThan(4000);
    expect(res!.exact!.total).toBe(2n ** 60n);
  });
});
