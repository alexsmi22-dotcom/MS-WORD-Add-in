// Exact null distributions for the two rank tests (v2.135.0, brief
// docs/SCOPE-STATS-BATCH.md §B2/§D2).
//
// WHY THIS EXISTS. The pane printed the normal approximation only, and at small
// n that number can be IMPOSSIBLE: Mann–Whitney 3 v 3 showed p = 0.081 when the
// smallest p any 3 v 3 arrangement can produce is 0.1, and 6 v 7 showed 0.0053
// against an exact 0.0023.
//
// METHOD. The exact CONDITIONAL permutation distribution given the observed
// ranks (midranks when there are ties — the coin/StatXact method):
//   • Mann–Whitney: the rank sum of one group over all C(N, n₁) equally likely
//     ways of choosing which observations belong to it;
//   • Wilcoxon signed-rank: W⁺ over all 2ⁿ equally likely sign vectors of the
//     non-zero differences (zeros are dropped first — Wilcoxon's convention, as R).
// Both are subset-sum dynamic programmes on DOUBLED midranks, which are always
// integers, so every tail is an integer-indexed sum — no float comparison of
// statistics anywhere. The DP carries BigInt COUNTS, not probabilities:
// C(60, 30) ≈ 1.18e17 > 2⁵³, so float counts would stop being exact, and a
// probability DP can only promise Σ ≈ 1. With counts, p = count / total is an
// exact rational and the self-check is Σ counts === C(N, n₁) (or 2ⁿ) exactly.
//
// TWO-SIDED RULE: p = min(1, 2·min(P(T ≤ t), P(T ≥ t))) on the FULL statistic
// (R's convention; SciPy's permutation_test). With ties the conditional
// distribution can be asymmetric and this differs from coin's
// P(|T − μ| ≥ |t − μ|) — §D2: 0.0432900 vs 0.0281385. Never "fix" it silently.
//
// CAPS BEFORE WORK: N = n₁ + n₂ ≤ 60 (Mann–Whitney) or n ≤ 60 non-zero
// differences (Wilcoxon). The callers check lengths before ranking anything.
//
// Pure; no Office.js; deliberately imports NOTHING from stats2.ts (stats2
// imports this file — a cycle would be a load-order trap).

/** Exact path only when the sample size (N for Mann–Whitney, non-zero n for Wilcoxon) is at most this. */
export const EXACT_RANK_MAX_N = 60;

/** A null distribution of a doubled rank statistic: counts[i] arrangements give doubled statistic offset + i. */
export interface ExactNull {
  offset: number;
  counts: bigint[];
  total: bigint;
}

/** C(n, k) exactly. */
export function binomialBig(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  const kk = Math.min(k, n - k);
  let r = 1n;
  for (let i = 1; i <= kk; i++) r = (r * BigInt(n - kk + i)) / BigInt(i);
  return r;
}

function checkDoubled(doubledRanks: number[]): void {
  for (const r of doubledRanks) {
    if (!Number.isInteger(r) || r < 0) throw new RangeError("doubled ranks must be non-negative integers");
  }
}

function trim(arr: bigint[]): ExactNull {
  let lo = 0;
  while (lo < arr.length - 1 && arr[lo] === 0n) lo++;
  let hi = arr.length - 1;
  while (hi > lo && arr[hi] === 0n) hi--;
  const counts = arr.slice(lo, hi + 1);
  let total = 0n;
  for (const c of counts) total += c;
  return { offset: lo, counts, total };
}

/**
 * Distribution of the sum of `k` of the given doubled ranks, over all C(N, k)
 * subsets (the Mann–Whitney rank-sum null). The caller should pass the SMALLER
 * group's size as k: the work is then O(N · k · Σ), every intermediate count is
 * at most C(N, k), and the Σ range is smallest.
 */
export function rankSumNull(doubledRanks: number[], k: number): ExactNull {
  const N = doubledRanks.length;
  if (N > EXACT_RANK_MAX_N) throw new RangeError(`exact rank-sum distribution capped at N = ${EXACT_RANK_MAX_N}`);
  if (!Number.isInteger(k) || k < 0 || k > N) throw new RangeError("subset size out of range");
  checkDoubled(doubledRanks);
  const sorted = doubledRanks.slice().sort((x, y) => y - x); // largest first
  let maxS = 0;
  for (let i = 0; i < k; i++) maxS += sorted[i];
  // dp[j][s] = number of j-subsets of the items seen so far with doubled sum s.
  const dp: bigint[][] = [];
  const reach: number[] = []; // highest s with a non-zero entry in dp[j]
  for (let j = 0; j <= k; j++) {
    dp.push(new Array<bigint>(maxS + 1).fill(0n));
    reach.push(-1);
  }
  dp[0][0] = 1n;
  reach[0] = 0;
  for (let i = 0; i < N; i++) {
    const r = doubledRanks[i];
    // After this item, a j-subset is still completable only if j ≥ k − (N − i − 1).
    const jMin = Math.max(1, k - (N - i - 1));
    const jMax = Math.min(i + 1, k);
    for (let j = jMax; j >= jMin; j--) {
      const from = dp[j - 1];
      const to = dp[j];
      const top = Math.min(reach[j - 1], maxS - r);
      if (top < 0) continue;
      for (let s = top; s >= 0; s--) {
        const c = from[s];
        if (c !== 0n) to[s + r] += c;
      }
      if (top + r > reach[j]) reach[j] = top + r;
    }
  }
  const out = trim(dp[k]);
  // Independent check, at run time: the DP must count every one of the
  // C(N, k) group assignments exactly once. A mismatch is a defect in this
  // tool, and an exact p computed over the wrong total would be wrong.
  if (out.total !== binomialBig(N, k)) {
    throw new RangeError(`exact rank-sum distribution failed its own count check (${out.total} ≠ C(${N}, ${k})) — withheld`);
  }
  return out;
}

/** Distribution of W⁺ (doubled) over all 2ⁿ sign vectors of the given doubled ranks. */
export function signedRankNull(doubledRanks: number[]): ExactNull {
  const n = doubledRanks.length;
  if (n > EXACT_RANK_MAX_N) throw new RangeError(`exact signed-rank distribution capped at n = ${EXACT_RANK_MAX_N}`);
  checkDoubled(doubledRanks);
  let maxS = 0;
  for (const r of doubledRanks) maxS += r;
  const dp = new Array<bigint>(maxS + 1).fill(0n);
  dp[0] = 1n;
  let reach = 0;
  for (const r of doubledRanks) {
    for (let s = reach; s >= 0; s--) {
      const c = dp[s];
      if (c !== 0n) dp[s + r] += c;
    }
    reach += r;
  }
  const out = trim(dp);
  // trim() drops a leading zero run; with all-positive ranks s = 0 always has count 1.
  return out;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** An exact probability num/den (reduced) and its double. */
export interface ExactP {
  num: bigint;
  den: bigint;
  value: number;
}

export function exactP(num: bigint, den: bigint): ExactP {
  if (den <= 0n) throw new RangeError("denominator must be positive");
  const g = gcd(num, den) || 1n;
  const n = num / g;
  const d = den / g;
  // Each BigInt→Number conversion is correctly rounded (rel. error ≤ 2⁻⁵³), so
  // the quotient is good to ~3e-16 relative — far beyond the 6 s.f. printed.
  return { num: n, den: d, value: Number(n) / Number(d) };
}

export interface ExactTails {
  /** P(T ≤ t). */
  lower: ExactP;
  /** P(T ≥ t). */
  upper: ExactP;
  /** min(1, 2·min(lower, upper)) — R's two-sided convention. */
  twoSided: ExactP;
  /** The smallest two-sided p ANY arrangement can give: min(1, 2·min(P(T = min), P(T = max))). */
  minTwoSided: ExactP;
}

/** Tails of a null distribution at the observed doubled statistic (an integer). */
export function exactTails(nul: ExactNull, observedDoubled: number): ExactTails {
  if (!Number.isInteger(observedDoubled)) throw new RangeError("observed doubled statistic must be an integer");
  const idx = observedDoubled - nul.offset;
  let lo = 0n;
  let hi = 0n;
  for (let i = 0; i < nul.counts.length; i++) {
    if (i <= idx) lo += nul.counts[i];
    if (i >= idx) hi += nul.counts[i];
  }
  const T = nul.total;
  const two = 2n * (lo < hi ? lo : hi);
  const first = nul.counts[0];
  const last = nul.counts[nul.counts.length - 1];
  const twoMin = 2n * (first < last ? first : last);
  return {
    lower: exactP(lo, T),
    upper: exactP(hi, T),
    twoSided: exactP(two > T ? T : two, T),
    minTwoSided: exactP(twoMin > T ? T : twoMin, T),
  };
}

// --- display ----------------------------------------------------------------

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};

/** 6 significant figures, scientific typeset (× 10⁻⁷) below 1e-4 — never "1e-7". */
export function sig6(v: number): string {
  if (v === 0) return "0";
  if (v === 1) return "1";
  if (Math.abs(v) < 1e-4) {
    const [m, e] = v.toExponential(5).split("e");
    const exp = String(Number(e)).replace(/./g, (c) => SUP[c] ?? c);
    return `${m} × 10${exp.replace("-", "⁻")}`;
  }
  return v.toPrecision(6);
}

/** "1/10 = 0.100000" when the reduced fraction is short (≤ 6-digit denominator), else "0.00233100 (6 s.f.)". */
export function formatExactP(p: ExactP): string {
  if (p.num === p.den) return "1";
  if (p.num === 0n) return "0";
  if (p.den <= 999999n) return `${p.num}/${p.den} = ${sig6(p.value)}`;
  return `${sig6(p.value)} (6 s.f.)`;
}

/** Everything the exact path learned, for the result text and the optional null-distribution figure. */
export interface ExactRankInfo {
  test: "mann-whitney" | "wilcoxon";
  /** True when the ranks include midranks: the p is exact CONDITIONAL on the observed ties. */
  conditional: boolean;
  /** Two-sided p, exact rational. */
  twoSided: ExactP;
  /** One-sided: P(statistic ≤ observed) — group 1 tends LOWER (Mann–Whitney, on U₁) / W⁺ small (Wilcoxon). */
  lower: ExactP;
  /** One-sided: P(statistic ≥ observed). */
  upper: ExactP;
  /** Smallest two-sided p attainable at these sample sizes (and ties). */
  minTwoSided: ExactP;
  /** Number of equally likely arrangements: C(N, n₁) or 2ⁿ. */
  total: bigint;
  /** Support of the null distribution on the reported scale (U₁ for Mann–Whitney, W⁺ for Wilcoxon). */
  support: number[];
  /** Null probabilities at each support point (sum to 1). */
  probs: number[];
  /** The observed statistic on the same scale (U₁ or W⁺). */
  observed: number;
}

/** The stated rules, one sentence each, shared by both tests' text. */
export const TWO_SIDED_RULE = "Two-sided p = min(1, 2 × the smaller one-sided exact tail), as R's wilcox.test.";
export const SWITCH_RULE =
  `Exact when n ≤ ${EXACT_RANK_MAX_N} (n₁ + n₂ for Mann–Whitney, non-zero differences for Wilcoxon); above that only the normal approximation (tie- and continuity-corrected) is given.`;

/** Fields of a rank-test result that the text helper needs (stats2.RankTestResult satisfies this). */
export interface RankTextInput {
  statistic: number;
  z: number;
  p: number;
  pNormal: number;
  pExact?: number;
  exactConditional: boolean;
  n1: number;
  n2: number;
  method: "exact" | "normal" | "degenerate";
  exact?: ExactRankInfo;
  u1?: number;
  u2?: number;
  wPlus?: number;
  wMinus?: number;
  zerosDropped?: number;
  tieNote?: string;
  note?: string;
}

function num(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)));
}

/**
 * The result lines for the pane, display-contract clean (U₁, W⁺, ×, no "chi2"/"^").
 * The integrator puts these UNDER the heading line in place of the old fixed
 * "(normal approximation, tie- and continuity-corrected)" line, which would
 * now mislabel an exact p.
 */
export function rankTestLines(res: RankTextInput, test: "mann-whitney" | "wilcoxon"): string[] {
  const lines: string[] = [];
  if (test === "mann-whitney") {
    lines.push(`U₁ = ${num(res.u1 ?? res.statistic)}, U₂ = ${num(res.u2 ?? NaN)} (U = ${num(res.statistic)}), n₁ = ${res.n1}, n₂ = ${res.n2}`);
  } else {
    const z = res.zerosDropped ?? 0;
    lines.push(`W⁺ = ${num(res.wPlus ?? NaN)}, W⁻ = ${num(res.wMinus ?? NaN)} (W = ${num(res.statistic)}), n = ${res.n1} non-zero differences`);
    lines.push(
      z > 0
        ? `${z} zero difference${z === 1 ? "" : "s"} dropped before ranking (Wilcoxon's convention, as R).`
        : "No zero differences (zeros would be dropped before ranking: Wilcoxon's convention, as R).",
    );
  }
  if (res.tieNote) lines.push(res.tieNote);
  if (res.method === "degenerate") {
    lines.push(res.note ?? "The rank statistic cannot vary: p = 1.");
    return lines;
  }
  // z with a true minus sign; a normal p that underflowed to 0 is printed as a
  // stated bound, never "p = 0" (an impossible value, the class this release removes).
  const zText = res.z.toPrecision(3).replace("-", "−");
  const pnText = res.pNormal < 1e-15 ? "p < 1 × 10⁻¹⁵" : `p = ${sig6(res.pNormal)}`;
  const normalLine = `Normal approximation (tie- and continuity-corrected): z = ${zText}, ${pnText}`;
  if (res.method === "exact" && res.exact) {
    const e = res.exact;
    const how = e.conditional ? "exact (conditional on the ties)" : "exact";
    lines.push(`p = ${formatExactP(e.twoSided)}, two-sided, ${how}, over ${e.total} equally likely ${test === "mann-whitney" ? "group assignments" : "sign patterns"}`);
    lines.push(`One-sided: P(${test === "mann-whitney" ? "U₁" : "W⁺"} ≤ observed) = ${sig6(e.lower.value)}, P(≥ observed) = ${sig6(e.upper.value)}`);
    lines.push(`${normalLine} (shown beside; the exact p is the one reported).`);
    lines.push(TWO_SIDED_RULE);
    const sizes = test === "mann-whitney" ? `${res.n1} v ${res.n2}` : `n = ${res.n1}`;
    lines.push(`With ${sizes}${e.conditional ? " and these ties" : ""}, no two-sided p below ${sig6(e.minTwoSided.value)} is possible.`);
    if (e.conditional) lines.push("Ties: midranks; the exact distribution is the permutation distribution of these midranks (R refuses exactness with ties; this is the coin/StatXact conditional method).");
  } else {
    lines.push(`${normalLine}, two-sided.`);
    if (res.note) lines.push(res.note);
  }
  lines.push(SWITCH_RULE);
  return lines;
}
