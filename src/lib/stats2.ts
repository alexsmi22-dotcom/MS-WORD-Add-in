// Extended statistics — non-parametric tests, chi-square, two-way ANOVA, and
// multiple-comparison correction. Complements stats.ts (which holds descriptive
// stats, t-tests, one-way ANOVA, regression). All p-values come from real
// distribution functions (normal via erf, chi-square via the incomplete gamma),
// never a lookup table or approximation shortcut. Pure; no Office.js.

import { mean, fTestP } from "./stats";

// --- special functions ------------------------------------------------------

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Error function (Numerical Recipes erfcc form; |error| < 1.2e-7). */
export function erf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  const erfc = x >= 0 ? ans : 2 - ans;
  return 1 - erfc;
}

/** Standard-normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Regularized lower incomplete gamma P(a, x) by series/continued fraction. */
function gammp(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 200; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  // continued fraction for Q, then P = 1 - Q
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  return 1 - q;
}

/** Upper-tail p-value for a chi-square statistic with `df` degrees of freedom. */
export function chiSquareP(chi2: number, df: number): number {
  if (chi2 <= 0) return 1;
  return 1 - gammp(df / 2, chi2 / 2);
}

// --- ranking helper ---------------------------------------------------------

/** Average ranks (ties share the mean rank); also returns the tie-correction sum Σ(t³−t). */
function rankWithTies(xs: number[]): { ranks: number[]; tieSum: number } {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length).fill(0);
  let tieSum = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return { ranks, tieSum };
}

// --- non-parametric tests ---------------------------------------------------

export interface RankTestResult {
  /** The test statistic (U for Mann–Whitney, W for Wilcoxon). */
  statistic: number;
  /** Normal-approximation z (continuity-corrected, tie-corrected). */
  z: number;
  /** Two-tailed p-value. */
  p: number;
  n1: number;
  n2: number;
}

/**
 * Mann–Whitney U test (two independent samples). Uses the normal approximation
 * with tie correction and a continuity correction — appropriate for the sample
 * sizes a document author typically has.
 */
export function mannWhitneyU(a: number[], b: number[]): RankTestResult {
  const n1 = a.length;
  const n2 = b.length;
  const combined = a.concat(b);
  const { ranks, tieSum } = rankWithTies(combined);
  let r1 = 0;
  for (let i = 0; i < n1; i++) r1 += ranks[i];
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const varU = ((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1)));
  const z = varU > 0 ? (u - mu + 0.5) / Math.sqrt(varU) : 0; // continuity correction toward the mean
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { statistic: u, z, p: Math.min(1, p), n1, n2 };
}

/**
 * Wilcoxon signed-rank test (paired samples). Zero differences are dropped;
 * the normal approximation with tie and continuity correction gives the p-value.
 */
export function wilcoxonSignedRank(a: number[], b: number[]): RankTestResult {
  const diffs: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i] - b[i];
    if (d !== 0) diffs.push(d);
  }
  const n = diffs.length;
  const { ranks, tieSum } = rankWithTies(diffs.map(Math.abs));
  let wPlus = 0;
  let wMinus = 0;
  for (let i = 0; i < n; i++) (diffs[i] > 0 ? (wPlus += ranks[i]) : (wMinus += ranks[i]));
  const w = Math.min(wPlus, wMinus);
  const mu = (n * (n + 1)) / 4;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24 - tieSum / 48;
  const z = varW > 0 ? (w - mu + 0.5) / Math.sqrt(varW) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { statistic: w, z, p: Math.min(1, p), n1: n, n2: n };
}

// --- chi-square -------------------------------------------------------------

export interface ChiSquareResult {
  chi2: number;
  df: number;
  p: number;
}

/** Chi-square goodness-of-fit test: observed vs expected counts. */
export function chiSquareGoodnessOfFit(observed: number[], expected: number[]): ChiSquareResult {
  const df = observed.length - 1;
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    if (expected[i] <= 0) continue;
    chi2 += (observed[i] - expected[i]) ** 2 / expected[i];
  }
  return { chi2, df, p: chiSquareP(chi2, df) };
}

export interface ChiSquareIndependence extends ChiSquareResult {
  /** Expected counts under independence, same shape as the input table. */
  expected: number[][];
}

/** Chi-square test of independence for an r×c contingency table of counts. */
export function chiSquareIndependence(table: number[][]): ChiSquareIndependence {
  const r = table.length;
  const c = table[0].length;
  const rowSums = table.map((row) => row.reduce((s, v) => s + v, 0));
  const colSums = Array.from({ length: c }, (_, j) => table.reduce((s, row) => s + row[j], 0));
  const total = rowSums.reduce((s, v) => s + v, 0);
  const expected: number[][] = table.map((_, i) => colSums.map((cs) => (rowSums[i] * cs) / total));
  let chi2 = 0;
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) if (expected[i][j] > 0) chi2 += (table[i][j] - expected[i][j]) ** 2 / expected[i][j];
  const df = (r - 1) * (c - 1);
  return { chi2, df, p: chiSquareP(chi2, df), expected };
}

// --- two-way ANOVA (balanced, with replication) -----------------------------

export interface TwoWayEffect {
  ss: number;
  df: number;
  ms: number;
  F: number;
  p: number;
}
export interface TwoWayAnovaResult {
  factorA: TwoWayEffect;
  factorB: TwoWayEffect;
  interaction: TwoWayEffect;
  error: { ss: number; df: number; ms: number };
  total: { ss: number; df: number };
}

/**
 * Balanced two-way ANOVA with replication. `cells[i][j]` is the array of
 * replicate values at level i of factor A and level j of factor B; every cell
 * must have the same number of replicates. Throws for an unbalanced design.
 */
export function twoWayAnova(cells: number[][][]): TwoWayAnovaResult {
  const a = cells.length;
  const b = cells[0].length;
  const n = cells[0][0].length;
  for (const row of cells) for (const cell of row) if (cell.length !== n) throw new Error("Every cell must have the same number of replicates (balanced design).");
  if (n < 2) throw new Error("Two-way ANOVA with interaction needs ≥ 2 replicates per cell.");

  const all: number[] = [];
  for (const row of cells) for (const cell of row) for (const v of cell) all.push(v);
  const grand = mean(all);

  const flatten = (arrs: number[][]): number[] => ([] as number[]).concat(...arrs);
  const cellMean = cells.map((row) => row.map((cell) => mean(cell)));
  const meanA = cells.map((row) => mean(flatten(row)));
  const meanB = Array.from({ length: b }, (_, j) => mean(flatten(cells.map((row) => row[j]))));

  let ssA = 0;
  for (let i = 0; i < a; i++) ssA += (meanA[i] - grand) ** 2;
  ssA *= b * n;
  let ssB = 0;
  for (let j = 0; j < b; j++) ssB += (meanB[j] - grand) ** 2;
  ssB *= a * n;
  let ssCells = 0;
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) ssCells += (cellMean[i][j] - grand) ** 2;
  ssCells *= n;
  const ssAB = ssCells - ssA - ssB;
  let ssTotal = 0;
  for (const v of all) ssTotal += (v - grand) ** 2;
  const ssError = ssTotal - ssCells;

  const dfA = a - 1;
  const dfB = b - 1;
  const dfAB = (a - 1) * (b - 1);
  const dfError = a * b * (n - 1);
  const msError = ssError / dfError;
  const effect = (ss: number, df: number): TwoWayEffect => {
    const ms = ss / df;
    const F = ms / msError;
    return { ss, df, ms, F, p: fTestP(F, df, dfError) };
  };
  return {
    factorA: effect(ssA, dfA),
    factorB: effect(ssB, dfB),
    interaction: effect(ssAB, dfAB),
    error: { ss: ssError, df: dfError, ms: msError },
    total: { ss: ssTotal, df: a * b * n - 1 },
  };
}

// --- multiple-comparison correction -----------------------------------------

export type CorrectionMethod = "bonferroni" | "holm" | "bh";

/**
 * Adjusts a set of p-values for multiple comparisons. Returns adjusted p-values
 * in the SAME order as the input. Bonferroni and Holm control the family-wise
 * error rate; Benjamini–Hochberg ("bh") controls the false-discovery rate.
 */
export function adjustPValues(pvals: number[], method: CorrectionMethod): number[] {
  const m = pvals.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((i, j) => pvals[i] - pvals[j]);
  const adj = new Array(m).fill(0);

  if (method === "bonferroni") {
    for (let i = 0; i < m; i++) adj[i] = Math.min(1, pvals[i] * m);
    return adj;
  }
  if (method === "holm") {
    let running = 0;
    for (let k = 0; k < m; k++) {
      const i = order[k];
      running = Math.max(running, Math.min(1, (m - k) * pvals[i]));
      adj[i] = running;
    }
    return adj;
  }
  // Benjamini–Hochberg: step-up, enforce monotonicity from the largest down
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    const i = order[k];
    running = Math.min(running, Math.min(1, (m / (k + 1)) * pvals[i]));
    adj[i] = running;
  }
  return adj;
}
