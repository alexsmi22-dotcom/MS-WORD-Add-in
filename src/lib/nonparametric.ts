// Non-parametric tests beyond two groups.
//
// WHY THIS EXISTS
// Coverage stopped at Mann-Whitney and Wilcoxon — two groups. The moment a user
// had three, their only option was ANOVA, which assumes normality. Now that
// diagnostics.ts will TELL them their data are not normal, refusing to provide
// the alternative would be worse than not having warned: the honest thing is to
// name the right test and then have it.
//
// Kruskal-Wallis is the rank-based one-way ANOVA; Dunn is its post-hoc (the
// pairwise comparison you must not do with repeated Mann-Whitneys, because the
// error rate compounds); Friedman is the repeated-measures form, which is the
// commonest life-science design and was entirely absent.

import { chiSquareP, normalCdf, adjustPValues, type CorrectionMethod } from "./stats2";

/** Average ranks, ties sharing the mean rank; also Σ(t³−t) for the tie correction. */
export function rankWithTies(xs: number[]): { ranks: number[]; tieSum: number } {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length).fill(0);
  let tieSum = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return { ranks, tieSum };
}

export interface KruskalWallisResult {
  ok: boolean;
  reason?: string;
  /** H, corrected for ties. */
  h: number;
  df: number;
  p: number;
  /** Mean rank per group, in input order — what the comparison is actually about. */
  meanRanks: number[];
  groupSizes: number[];
  n: number;
  /** True when ties were present and the correction was applied. */
  tiesCorrected: boolean;
}

/**
 * Kruskal-Wallis one-way analysis of variance on ranks.
 *
 * The tie correction is not optional in practice: real measurement data is full
 * of repeated values, and without dividing by (1 − Σ(t³−t)/(N³−N)) the statistic
 * is biased DOWNWARD — i.e. it under-reports significance, quietly.
 */
export function kruskalWallis(groups: number[][]): KruskalWallisResult {
  const usable = groups.filter((g) => g.length > 0);
  const base = { h: NaN, df: NaN, p: NaN, meanRanks: [] as number[], groupSizes: [] as number[], n: 0, tiesCorrected: false };
  if (usable.length < 2) {
    return { ...base, ok: false, reason: "Kruskal-Wallis needs at least two non-empty groups." };
  }

  const all: number[] = [];
  for (const g of usable) for (const v of g) all.push(v);
  const n = all.length;
  if (n < 3) return { ...base, ok: false, reason: "Not enough values to rank." };

  const { ranks, tieSum } = rankWithTies(all);

  let offset = 0;
  let sum = 0;
  const meanRanks: number[] = [];
  const sizes: number[] = [];
  for (const g of usable) {
    let rs = 0;
    for (let i = 0; i < g.length; i++) rs += ranks[offset + i];
    sum += (rs * rs) / g.length;
    meanRanks.push(rs / g.length);
    sizes.push(g.length);
    offset += g.length;
  }

  let h = (12 / (n * (n + 1))) * sum - 3 * (n + 1);
  const tieDenom = 1 - tieSum / (n * n * n - n);
  const tiesCorrected = tieSum > 0 && tieDenom > 0;
  if (tiesCorrected) h /= tieDenom;

  const df = usable.length - 1;
  return {
    ok: true,
    h,
    df,
    p: chiSquareP(h, df),
    meanRanks,
    groupSizes: sizes,
    n,
    tiesCorrected,
  };
}

export interface DunnComparison {
  a: number;
  b: number;
  /** Difference in mean ranks, a − b. */
  meanRankDiff: number;
  z: number;
  /** Unadjusted two-tailed p. */
  p: number;
  /** p after the multiplicity correction. */
  pAdjusted: number;
  significant: boolean;
}

/**
 * Dunn's post-hoc test after Kruskal-Wallis.
 *
 * Uses the ranks from the OVERALL Kruskal-Wallis ranking, not fresh pairwise
 * rankings — that is the whole difference between Dunn and simply running
 * Mann-Whitney on every pair, and re-ranking each pair would both lose
 * information and inflate the error rate.
 */
export function dunnTest(
  groups: number[][],
  adjust: CorrectionMethod = "holm",
  alpha = 0.05,
): { ok: boolean; reason?: string; comparisons: DunnComparison[] } {
  const usable = groups.filter((g) => g.length > 0);
  if (usable.length < 2) return { ok: false, reason: "Needs at least two non-empty groups.", comparisons: [] };

  const all: number[] = [];
  for (const g of usable) for (const v of g) all.push(v);
  const n = all.length;
  const { ranks, tieSum } = rankWithTies(all);

  let offset = 0;
  const meanRanks: number[] = [];
  const sizes: number[] = [];
  for (const g of usable) {
    let rs = 0;
    for (let i = 0; i < g.length; i++) rs += ranks[offset + i];
    meanRanks.push(rs / g.length);
    sizes.push(g.length);
    offset += g.length;
  }

  // Pooled variance of the rank sums, with the same tie correction.
  const sigma = (n * (n + 1)) / 12 - tieSum / (12 * (n - 1));

  const raw: DunnComparison[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const diff = meanRanks[i] - meanRanks[j];
      const se = Math.sqrt(sigma * (1 / sizes[i] + 1 / sizes[j]));
      const z = se > 0 ? diff / se : 0;
      const p = 2 * (1 - normalCdf(Math.abs(z)));
      raw.push({ a: i, b: j, meanRankDiff: diff, z, p: Math.min(1, p), pAdjusted: NaN, significant: false });
    }
  }

  const adjusted = adjustPValues(raw.map((c) => c.p), adjust);
  raw.forEach((c, i) => {
    c.pAdjusted = adjusted[i];
    c.significant = adjusted[i] < alpha;
  });

  return { ok: true, comparisons: raw };
}

export interface FriedmanResult {
  ok: boolean;
  reason?: string;
  /** Friedman chi-square, tie-corrected. */
  chi2: number;
  df: number;
  p: number;
  /** Mean rank per treatment. */
  meanRanks: number[];
  blocks: number;
  treatments: number;
}

/**
 * Friedman test — repeated measures on ranks.
 *
 * `blocks` is one row per subject, with one value per treatment in the SAME
 * order in every row. This is the design where the same subjects are measured
 * under each condition, which is most of life science, and the reason a
 * between-groups test would be wrong is that it ignores the pairing entirely.
 */
export function friedman(blocks: number[][]): FriedmanResult {
  const base = { chi2: NaN, df: NaN, p: NaN, meanRanks: [] as number[], blocks: 0, treatments: 0 };
  if (blocks.length < 2) return { ...base, ok: false, reason: "Friedman needs at least two blocks (rows)." };
  const k = blocks[0].length;
  if (k < 2) return { ...base, ok: false, reason: "Friedman needs at least two treatments (columns)." };
  if (!blocks.every((b) => b.length === k)) {
    // A ragged design is not a repeated-measures design; guessing how to pad it
    // would silently invent measurements.
    return { ...base, ok: false, reason: "Every row must have the same number of values, one per treatment." };
  }

  const n = blocks.length;
  const rankSums = new Array<number>(k).fill(0);
  let tieTerm = 0;
  for (const row of blocks) {
    const { ranks, tieSum } = rankWithTies(row);
    for (let j = 0; j < k; j++) rankSums[j] += ranks[j];
    tieTerm += tieSum;
  }

  let sum = 0;
  for (const rs of rankSums) sum += rs * rs;
  let chi2 = (12 / (n * k * (k + 1))) * sum - 3 * n * (k + 1);

  // Tie correction (Conover): divides by 1 − Σ(t³−t) / (n·k·(k²−1)).
  const denom = 1 - tieTerm / (n * k * (k * k - 1));
  if (tieTerm > 0 && denom > 0) chi2 /= denom;

  const df = k - 1;
  return {
    ok: true,
    chi2,
    df,
    p: chiSquareP(chi2, df),
    meanRanks: rankSums.map((r) => r / n),
    blocks: n,
    treatments: k,
  };
}
