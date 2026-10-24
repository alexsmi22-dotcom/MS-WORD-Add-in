// Extended statistics — non-parametric tests, chi-square, two-way ANOVA, and
// multiple-comparison correction. Complements stats.ts (which holds descriptive
// stats, t-tests, one-way ANOVA, regression). All p-values come from real
// distribution functions (normal via erf, chi-square via the incomplete gamma),
// never a lookup table or approximation shortcut. Pure; no Office.js.

import { mean, fTestP } from "./stats";
import { EXACT_RANK_MAX_N, ExactRankInfo, exactTails, rankSumNull, signedRankNull } from "./exactRank";

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
export function gammp(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 200_000; n++) {
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
  for (let i = 1; i < 200_000; i++) {
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

/**
 * Upper tail Q(a, x) = 1 - P(a, x), computed WITHOUT the round trip.
 *
 * `chiSquareP` used to return `1 - gammp(...)`, and the continued-fraction
 * branch of `gammp` had already formed `1 - q` — so the pair annihilated q
 * below about 1.1e-16 and the p-value came back as exactly 0.
 * chiSquareP(100, 1) gave 0 where the answer is 1.5e-23. Zero is not a
 * p-value, and the function is exported.
 */
export function gammq(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammp(a, x); // series branch is accurate for P
  // Continued fraction: compute Q directly.
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

/** Upper-tail p-value for a chi-square statistic with `df` degrees of freedom. */
export function chiSquareP(chi2: number, df: number): number {
  if (chi2 <= 0) return 1;
  return gammq(df / 2, chi2 / 2);
}

// --- ranking helper ---------------------------------------------------------

/** Average ranks (ties share the mean rank); also returns the tie-correction sum Σ(t³−t). */
/**
 * Ranks with the mid-rank tie correction.
 *
 * REFUSES non-finite input rather than ranking it. A NaN makes the comparator
 * return NaN, which leaves the sort order unspecified — so the ranks came out
 * arbitrary and every statistic built on them was meaningless but entirely
 * plausible: `mannWhitneyU([1,2,NaN,4],[5,6,7,8])` reported p = 0.030,
 * "significant". The pane's list parser filters NaN, so this was a
 * library-level hole, and these functions are exported.
 */
export function rankWithTies(xs: number[]): { ranks: number[]; tieSum: number } {
  if (xs.some((v) => !Number.isFinite(v))) throw new RangeError("ranks need finite values");
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
  /** The test statistic (U = min(U₁, U₂) for Mann–Whitney, W = min(W⁺, W⁻) for Wilcoxon). */
  statistic: number;
  /** Normal-approximation z (continuity-corrected, tie-corrected). */
  z: number;
  /**
   * The REPORTED two-sided p: the exact p when the exact path ran (n ≤ 60),
   * otherwise the normal approximation. Existing callers keep reading `p`.
   */
  p: number;
  /** Exact two-sided p (undefined above the n = 60 cap, or when the test is degenerate/undefined). */
  pExact?: number;
  /** True when the exact p is conditional on observed ties (midranks). */
  exactConditional: boolean;
  /** Normal approximation (tie + continuity corrected), ALWAYS computed — shown beside the exact p. */
  pNormal: number;
  /** Which p `p` is. "degenerate": the statistic cannot vary (all values tied / n = 0) — p = 1, said by `note`. */
  method: "exact" | "normal" | "degenerate";
  /** Exact-path detail: fractions, one-sided tails, attainable minimum, null distribution. */
  exact?: ExactRankInfo;
  /** Mann–Whitney n₁ / Wilcoxon: number of NON-ZERO differences. */
  n1: number;
  /** Mann–Whitney n₂ / Wilcoxon: same as n1. */
  n2: number;
  /** Mann–Whitney: U₁ = R₁ − n₁(n₁+1)/2 (group 1) and U₂ = n₁n₂ − U₁. */
  u1?: number;
  u2?: number;
  /** Wilcoxon: rank sums of the positive and negative differences. */
  wPlus?: number;
  wMinus?: number;
  /** Wilcoxon: zero differences dropped before ranking (Wilcoxon's convention, as R). */
  zerosDropped?: number;
  /** Set when rounding to the data's own decimal precision merged values that differed only by float noise (said in the text). */
  tieNote?: string;
  /** Why the exact path did not run, or the degenerate case by name. */
  note?: string;
}

/** Cap on the decimal precision ties are judged at (beyond this a double carries noise, not data). */
const TIE_DECIMALS_CAP = 12;

/** Decimal places in the shortest round-trip form of x ("1.5e-7" → 8; "1.7e+308" → 0), capped at 12. */
function decimalPlaces(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = String(Math.abs(x));
  const e = s.indexOf("e");
  const mant = e < 0 ? s : s.slice(0, e);
  const exp = e < 0 ? 0 : Number(s.slice(e + 1));
  const dot = mant.indexOf(".");
  const frac = dot < 0 ? 0 : mant.length - dot - 1;
  return Math.min(TIE_DECIMALS_CAP, Math.max(0, frac - exp));
}

/** x rounded to d decimals; values too large for toFixed are already integers at any useful precision. */
function roundTo(x: number, d: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
  const r = Number(x.toFixed(d));
  return r === 0 ? 0 : r; // no −0
}

/**
 * TIES ARE JUDGED AT THE DATA'S OWN DECIMAL PRECISION, never on raw float
 * equality (v2.135.0 review defect). Typed 2.1 − 1.8 and 0.9 − 0.7 are both
 * 0.2 to the user but three different doubles: ranked as distinct they gave
 * an "exact, untied" p = 0.046875 where the truth, conditional on the ties,
 * is 0.0625 — a significance crossing. Values are rounded to the maximum
 * number of decimal places in the inputs (capped at 12) before ranking.
 * Returns the rounded values and how many distinct raw values were merged.
 */
function atDataPrecision(values: number[], inputs: number[]): { values: number[]; decimals: number; merged: boolean } {
  let d = 0;
  for (const x of inputs) d = Math.max(d, decimalPlaces(x));
  const out = values.map((v) => roundTo(v, d));
  const merged = new Set(out).size < new Set(values.map((v) => (v === 0 ? 0 : v))).size;
  return { values: out, decimals: d, merged };
}

function tieNoteText(what: string, d: number): string {
  return `${what} equal to ${d} decimal place${d === 1 ? "" : "s"} (the data's own precision) are treated as tied; floating-point noise beyond that is not a difference.`;
}

function toDoubled(ranks: number[]): number[] {
  // Midranks are k or k + ½, so doubling is exact in floating point.
  return ranks.map((r) => Math.round(2 * r));
}

function mwSwitchNote(N: number): string {
  return `n₁ + n₂ = ${N}, above ${EXACT_RANK_MAX_N}: the normal approximation is accurate here, so it alone is reported.`;
}

/**
 * Mann–Whitney U test (two independent samples).
 *
 * p is EXACT (v2.135.0) when n₁ + n₂ ≤ 60: the permutation distribution of
 * group 1's rank sum over all C(N, n₁) assignments, conditional on the
 * observed midranks when there are ties; two-sided p = min(1, 2·min tail).
 * The normal approximation (tie + continuity corrected) is always computed
 * as `pNormal`. Above the cap only the approximation is reported.
 */
export function mannWhitneyU(a: number[], b: number[]): RankTestResult {
  const n1 = a.length;
  const n2 = b.length;
  const raw = a.concat(b);
  // Ties at the data's own decimal precision (a caller may pass COMPUTED values).
  const prec = atDataPrecision(raw, raw);
  const combined = prec.values;
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
  const pNormal = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const tieNote = prec.merged ? tieNoteText("Values", prec.decimals) : undefined;
  const base = { statistic: u, z, pNormal, n1, n2, u1, u2, tieNote };
  if (n1 === 0 || n2 === 0) {
    return { ...base, p: 1, method: "degenerate", exactConditional: false, note: "One group is empty: there is nothing to compare; p = 1." };
  }
  if (ranks.every((r) => r === ranks[0])) {
    return {
      ...base,
      p: 1,
      pExact: 1,
      method: "degenerate",
      exactConditional: tieSum > 0,
      note: "Every value is tied: the rank sum cannot vary under any assignment, so the test is degenerate: p = 1.",
    };
  }
  if (n > EXACT_RANK_MAX_N) {
    return { ...base, p: pNormal, method: "normal", exactConditional: false, note: mwSwitchNote(n) };
  }
  const doubled = toDoubled(ranks);
  // DP on the SMALLER group (cost and count bound); both tails are taken, so
  // reflecting back to group 1 is exact.
  const useA = n1 <= n2;
  const k = useA ? n1 : n2;
  const totalDoubled = doubled.reduce((s, v) => s + v, 0);
  let r1Doubled = 0;
  for (let i = 0; i < n1; i++) r1Doubled += doubled[i];
  const nul = rankSumNull(doubled, k);
  const t = exactTails(nul, useA ? r1Doubled : totalDoubled - r1Doubled);
  // Express everything on group 1's U₁ scale.
  const support: number[] = [];
  const probs: number[] = [];
  for (let i = 0; i < nul.counts.length; i++) {
    if (nul.counts[i] === 0n) continue;
    const sDoubled = nul.offset + i; // doubled rank sum of the DP group
    const g1Doubled = useA ? sDoubled : totalDoubled - sDoubled;
    support.push(g1Doubled / 2 - (n1 * (n1 + 1)) / 2);
    probs.push(Number(nul.counts[i]) / Number(nul.total));
  }
  if (!useA) {
    support.reverse();
    probs.reverse();
  }
  const exact: ExactRankInfo = {
    test: "mann-whitney",
    conditional: tieSum > 0,
    twoSided: t.twoSided,
    // P(U₁ ≤ u₁): group 1 small ⇔ the other group's sum large.
    lower: useA ? t.lower : t.upper,
    upper: useA ? t.upper : t.lower,
    minTwoSided: t.minTwoSided,
    total: nul.total,
    support,
    probs,
    observed: u1,
  };
  return { ...base, p: t.twoSided.value, pExact: t.twoSided.value, method: "exact", exactConditional: tieSum > 0, exact };
}

/**
 * Wilcoxon signed-rank test (paired samples). Zero differences are DROPPED
 * before ranking (Wilcoxon's convention, as R — not Pratt's).
 *
 * p is EXACT (v2.135.0) when the number of non-zero differences n ≤ 60: the
 * distribution of W⁺ over all 2ⁿ sign vectors, conditional on the observed
 * midranks when |d| has ties; two-sided p = min(1, 2·min tail). The normal
 * approximation (tie + continuity corrected) is always computed as `pNormal`.
 */
export function wilcoxonSignedRank(a: number[], b: number[]): RankTestResult {
  const m = Math.min(a.length, b.length);
  const rawDiffs: number[] = [];
  for (let i = 0; i < m; i++) rawDiffs.push(a[i] - b[i]);
  if (rawDiffs.some((v) => !Number.isFinite(v))) throw new RangeError("ranks need finite values");
  // Ties AND zeros judged at the data's own decimal precision: typed 2.1 − 1.8
  // and 0.9 − 0.7 are one difference, 0.2, not two doubles.
  const prec = atDataPrecision(rawDiffs.map(Math.abs), a.slice(0, m).concat(b.slice(0, m)));
  const diffs: number[] = [];
  for (let i = 0; i < m; i++) {
    const d = rawDiffs[i] < 0 ? -prec.values[i] : prec.values[i];
    if (d !== 0) diffs.push(d);
  }
  const zerosDropped = m - diffs.length;
  const rawZeros = rawDiffs.filter((v) => v === 0).length;
  const tieNote =
    prec.merged || zerosDropped !== rawZeros ? tieNoteText("Differences", prec.decimals) : undefined;
  const n = diffs.length;
  const { ranks, tieSum } = rankWithTies(diffs.map(Math.abs));
  let wPlus = 0;
  let wMinus = 0;
  for (let i = 0; i < n; i++) (diffs[i] > 0 ? (wPlus += ranks[i]) : (wMinus += ranks[i]));
  const w = Math.min(wPlus, wMinus);
  const mu = (n * (n + 1)) / 4;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24 - tieSum / 48;
  const z = varW > 0 ? (w - mu + 0.5) / Math.sqrt(varW) : 0;
  const pNormal = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const base = { statistic: w, z, pNormal, n1: n, n2: n, wPlus, wMinus, zerosDropped, tieNote };
  if (n === 0) {
    return {
      ...base,
      p: 1,
      method: "degenerate",
      exactConditional: false,
      note: "All paired differences are zero: after dropping zeros nothing is left to rank, so the test is undefined.",
    };
  }
  if (n > EXACT_RANK_MAX_N) {
    return {
      ...base,
      p: pNormal,
      method: "normal",
      exactConditional: false,
      note: `n = ${n} non-zero differences, above ${EXACT_RANK_MAX_N}: the normal approximation is accurate here, so it alone is reported.`,
    };
  }
  const doubled = toDoubled(ranks);
  const nul = signedRankNull(doubled);
  let wpDoubled = 0;
  for (let i = 0; i < n; i++) if (diffs[i] > 0) wpDoubled += doubled[i];
  const t = exactTails(nul, wpDoubled);
  const support: number[] = [];
  const probs: number[] = [];
  for (let i = 0; i < nul.counts.length; i++) {
    if (nul.counts[i] === 0n) continue;
    support.push((nul.offset + i) / 2);
    probs.push(Number(nul.counts[i]) / Number(nul.total));
  }
  const exact: ExactRankInfo = {
    test: "wilcoxon",
    conditional: tieSum > 0,
    twoSided: t.twoSided,
    lower: t.lower,
    upper: t.upper,
    minTwoSided: t.minTwoSided,
    total: nul.total,
    support,
    probs,
    observed: wPlus,
  };
  return { ...base, p: t.twoSided.value, pExact: t.twoSided.value, method: "exact", exactConditional: tieSum > 0, exact };
}

// --- chi-square -------------------------------------------------------------

export interface ChiSquareResult {
  chi2: number;
  df: number;
  p: number;
  /**
   * Set when the inputs are not a valid test rather than a valid test with an
   * extreme answer. The statistics are NaN in that case, so a caller that only
   * formats numbers still shows nothing misleading.
   */
  reason?: string;
  /** Smallest expected count in the table; NaN on a refusal path. */
  minExpected: number;
  /** How many expected counts fall below 5 (Cochran's rule of thumb). */
  cellsBelowFive: number;
  /** Total cells the rule was applied over. */
  cellCount: number;
  /**
   * Plain-language warnings about the APPROXIMATION, not about the arithmetic.
   *
   * WHY THIS EXISTS. χ² is a large-sample approximation to a discrete
   * distribution, and it fails in the direction that matters: it is
   * ANTI-CONSERVATIVE when the expected counts are small, so it reports more
   * significance than the data supports. Measured on the 2×2 `[[1,9],[8,2]]`,
   * whose expected counts are all between 4.5 and 5.5: χ² = 9.899, p = 0.00165,
   * while Fisher's exact two-sided on the same table is 0.0055 — off by 3.3×,
   * and widening as the counts fall. That is exactly the small pilot experiment
   * someone types into a pane, and nothing in this module said a word about it
   * (a grep for "expected count", "Cochran", "Yates" or "Fisher" returned
   * nothing at all). Empty on a valid, comfortable table, and empty on a refusal
   * path, where `reason` is the single message.
   */
  warnings: string[];
}

/**
 * Cochran's rule as a warning list: every expected count ≥ 1, and no more than
 * 20% of them below 5. Returned rather than thrown — the number is still the
 * best available approximation, and refusing to compute it would leave the user
 * with nothing.
 */
function expectedCountWarnings(expected: number[]): string[] {
  const out: string[] = [];
  const total = expected.length;
  if (!total) return out;
  const below5 = expected.filter((e) => e < 5).length;
  const below1 = expected.filter((e) => e < 1).length;
  const smallest = fmtCount(minOfArray(expected));
  if (below1 > 0) {
    out.push(
      `⚠ ${below1} of ${total} expected counts are below 1 (smallest ${smallest}). The ` +
        "chi-square approximation is not usable here: it reports more significance than the " +
        "data supports. Use Fisher's exact test, or collect more data.",
    );
  } else if (below5 * 5 > total) {
    // Cochran: at most 20% of cells may have an expected count below 5.
    out.push(
      `⚠ ${below5} of ${total} expected counts are below 5 ` +
        `(${Math.round((below5 / total) * 100)}%, smallest ${smallest}). Cochran's rule allows ` +
        "at most 20%. Chi-square is a large-sample approximation and is anti-conservative here " +
        "— the true p-value is larger than the one shown, so treat a result just under 0.05 as " +
        "undecided.",
    );
  }
  return out;
}

/** Local min without the argument spread — a contingency table can be large. */
function minOfArray(xs: number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
}

function fmtCount(x: number): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(3))) : "n/a";
}

/** A number in a refusal, with a true minus. */
const signed = (v: number): string => String(v).replace(/^-/, "−");

/** Chi-square goodness-of-fit test: observed vs expected counts. */
export function chiSquareGoodnessOfFit(observed: number[], expected: number[]): ChiSquareResult {
  const refuse = (reason: string): ChiSquareResult => ({
    chi2: NaN,
    df: NaN,
    p: NaN,
    minExpected: NaN,
    cellsBelowFive: 0,
    cellCount: 0,
    warnings: [],
    reason,
  });
  // COUNTS ARE NON-NEGATIVE, and a category the model calls impossible (expected
  // ≤ 0) that was nevertheless OBSERVED rejects the model outright — χ² is
  // infinite there. The loop below used to SKIP such a cell while still counting
  // it in df, so "observed 5 5, expected 10 0" came back as an ordinary p.
  {
    const bad = observed.findIndex((o) => !Number.isFinite(o) || o < 0);
    if (bad >= 0) return refuse(`Observed counts cannot be negative (category ${bad + 1} is ${signed(observed[bad])}).`);
    const badE = expected.findIndex((e) => !Number.isFinite(e) || e < 0);
    if (badE >= 0) return refuse(`Expected counts cannot be negative (category ${badE + 1} is ${signed(expected[badE])}).`);
    const imp = observed.findIndex((o, k) => o > 0 && !(expected[k] > 0));
    if (imp >= 0) {
      return refuse(
        `Category ${imp + 1} has an expected count of 0 but ${observed[imp]} observed: the model says it cannot ` +
          "happen and it did, so the fit is rejected outright (χ² is infinite). Give every category a positive " +
          "expected count, or remove a category that is truly impossible and was never observed.",
      );
    }
  }
  // THE TOTALS MUST AGREE. chi-square goodness of fit compares counts against
  // EXPECTED COUNTS, not proportions: with observed summing to 60 and expected
  // to 6 it happily returned chi2 = 486, p = 0, and the number means nothing.
  // Entering proportions in a counts field is the obvious user error, and the
  // pane's expected-counts field is free text.
  {
    const so = observed.reduce((a, b) => a + b, 0);
    const se = expected.reduce((a, b) => a + b, 0);
    if (se > 0 && Math.abs(so - se) > 1e-6 * Math.max(so, se)) {
      return {
        chi2: NaN,
        df: NaN,
        p: NaN,
        minExpected: NaN,
        cellsBelowFive: 0,
        cellCount: 0,
        // The refusal is the single message; a second warning beside it would
        // read as though the test had run and merely had a caveat.
        warnings: [],
        reason:
          `The expected counts sum to ${se} but the observed counts sum to ${so}. ` +
          "Goodness of fit compares counts with counts — if you have proportions, " +
          `multiply them by ${so} first.`,
      };
    }
  }
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    if (expected[i] <= 0) continue;
    chi2 += (observed[i] - expected[i]) ** 2 / expected[i];
  }
  // A category with expected 0 (and, after the refusal above, observed 0) is not
  // part of the test: it adds nothing to χ² and it is NOT counted in df either —
  // counting it gave an extra degree of freedom and a p that was too large.
  const used = expected.filter((e) => e > 0);
  if (used.length < 2) return refuse("Need at least two categories with a positive expected count.");
  const df = used.length - 1;
  return {
    chi2,
    df,
    p: chiSquareP(chi2, df),
    minExpected: used.length ? minOfArray(used) : NaN,
    cellsBelowFive: used.filter((e) => e < 5).length,
    cellCount: used.length,
    warnings: expectedCountWarnings(used),
  };
}

export interface ChiSquareIndependence extends ChiSquareResult {
  /** Expected counts under independence, same shape as the input table. */
  expected: number[][];
  /**
   * Yates' continuity-corrected statistic — 2×2 tables only, undefined otherwise.
   *
   * χ² is a continuous approximation to a discrete distribution, and on a 2×2
   * the discreteness is at its worst. Subtracting ½ from each |observed −
   * expected| before squaring pulls the statistic back toward the exact answer.
   * On `[[1,9],[8,2]]`: Pearson 9.899 (p = 0.00165), Yates 7.273 (p = 0.0070),
   * Fisher exact 0.0055 — the corrected value brackets the exact one from the
   * conservative side, and the uncorrected one is wrong in the dangerous
   * direction.
   */
  chi2Yates?: number;
  /** p for `chi2Yates`. */
  pYates?: number;
  /**
   * Fisher's exact two-sided p — 2×2 tables of whole, non-negative counts with a
   * grand total small enough to enumerate (≤ 100,000).
   *
   * Exact rather than approximate: it sums the hypergeometric probability of
   * every table with the same margins that is no more likely than the observed
   * one. When it is present it is the answer to report for a small 2×2; the
   * chi-square values stay beside it so a reader can see the size of the
   * approximation error rather than being asked to take it on trust.
   */
  pFisher?: number;
}

/**
 * Fisher's exact test for a 2×2 table, two-sided by the "sum of probabilities no
 * greater than the observed" convention.
 *
 * The tolerance on that comparison is not decoration: the tables that mirror the
 * observed one have mathematically equal probability and reach it by a different
 * chain of floating-point operations, so a bare `<=` drops them and returns
 * roughly half the correct p. Validated against the tea-tasting table
 * `[[3,1],[1,3]]` → 0.4857, the published value.
 */
export function fisherExact2x2(table: number[][]): number | undefined {
  if (table.length !== 2 || table[0].length !== 2 || table[1].length !== 2) return undefined;
  const flat = [table[0][0], table[0][1], table[1][0], table[1][1]];
  if (flat.some((v) => !Number.isInteger(v) || v < 0)) return undefined;
  const [a, b, c, d] = flat;
  const total = a + b + c + d;
  if (total === 0 || total > 100000) return undefined;
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  // A zero margin admits exactly one table, so p = 1 by construction: no test.
  if (r1 === 0 || r2 === 0 || c1 === 0 || b + d === 0) return undefined;

  // log P(a) for the hypergeometric with these margins, up to a constant that
  // cancels in the ratio — kept in logs so a table of a few hundred counts does
  // not overflow the factorials.
  const lnChoose = (n: number, k: number): number =>
    gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
  const lnConst = lnChoose(total, c1);
  const lp = (x: number): number => lnChoose(r1, x) + lnChoose(r2, c1 - x) - lnConst;

  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  const pObs = Math.exp(lp(a));
  let sum = 0;
  for (let x = lo; x <= hi; x++) {
    const px = Math.exp(lp(x));
    if (px <= pObs * (1 + 1e-9)) sum += px;
  }
  return Math.min(1, sum);
}

/** Chi-square test of independence for an r×c contingency table of counts. */
export function chiSquareIndependence(table: number[][]): ChiSquareIndependence {
  const r = table.length;
  const c = table[0]?.length ?? 0;
  const refuse = (reason: string): ChiSquareIndependence => ({
    chi2: NaN,
    df: NaN,
    p: NaN,
    expected: [],
    minExpected: NaN,
    cellsBelowFive: 0,
    cellCount: 0,
    warnings: [],
    reason,
  });
  if (r < 2 || c < 2 || table.some((row) => row.length !== c)) {
    return refuse("Enter a rectangular table with at least 2 rows and 2 columns.");
  }
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      const v = table[i][j];
      if (!Number.isFinite(v) || v < 0) return refuse(`Counts cannot be negative (row ${i + 1}, column ${j + 1} is ${signed(v)}).`);
    }
  }
  const rowSums = table.map((row) => row.reduce((s, v) => s + v, 0));
  const colSums = Array.from({ length: c }, (_, j) => table.reduce((s, row) => s + row[j], 0));
  // A ZERO MARGIN is a row or column with no observations: its expected counts
  // are all 0, the loop below skipped them, and df still counted the row — a
  // p for a table that is really smaller than the one tested. Fisher's exact
  // test on such a table is p = 1 by construction, which is no test either.
  const zr = rowSums.findIndex((s) => s === 0);
  const zc = colSums.findIndex((s) => s === 0);
  if (zr >= 0 || zc >= 0) {
    return refuse(
      `${zr >= 0 ? `Row ${zr + 1}` : `Column ${zc + 1}`} has no observations (every count is 0), so it carries no ` +
        "information about association and the degrees of freedom would be wrong. Remove that row or column.",
    );
  }
  const total = rowSums.reduce((s, v) => s + v, 0);
  const expected: number[][] = table.map((_, i) => colSums.map((cs) => (rowSums[i] * cs) / total));
  let chi2 = 0;
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) if (expected[i][j] > 0) chi2 += (table[i][j] - expected[i][j]) ** 2 / expected[i][j];
  const df = (r - 1) * (c - 1);

  const usedExpected: number[] = [];
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (expected[i][j] > 0) usedExpected.push(expected[i][j]);
  const warnings = expectedCountWarnings(usedExpected);

  const is2x2 = r === 2 && c === 2;
  let chi2Yates: number | undefined;
  let pYates: number | undefined;
  let pFisher: number | undefined;
  if (is2x2) {
    let y = 0;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++)
        if (expected[i][j] > 0) {
          const dev = Math.max(0, Math.abs(table[i][j] - expected[i][j]) - 0.5);
          y += (dev * dev) / expected[i][j];
        }
    chi2Yates = y;
    pYates = chiSquareP(y, df);
    pFisher = fisherExact2x2(table);
    if (warnings.length) {
      warnings.push(
        pFisher !== undefined
          ? `For this 2×2, Fisher's exact test is not an approximation at all and is the value to ` +
            `report: p = ${pFisher < 0.0001 ? pFisher.toExponential(2) : Number(pFisher.toPrecision(3))}. ` +
            `Yates' continuity-corrected chi-square gives p = ${Number(pYates.toPrecision(3))}, against ` +
            `the uncorrected ${Number(chiSquareP(chi2, df).toPrecision(3))}.`
          : `Yates' continuity correction is reported alongside for this 2×2 and is the more ` +
            `conservative of the two.`,
      );
    }
  }

  return {
    chi2,
    df,
    p: chiSquareP(chi2, df),
    expected,
    minExpected: usedExpected.length ? minOfArray(usedExpected) : NaN,
    cellsBelowFive: usedExpected.filter((e) => e < 5).length,
    cellCount: usedExpected.length,
    warnings,
    ...(chi2Yates !== undefined ? { chi2Yates, pYates } : {}),
    ...(pFisher !== undefined ? { pFisher } : {}),
  };
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
 * must have the same number of replicates.
 *
 * REFUSES an unbalanced design. The docstring used to claim it threw for one
 * while the loop only checked that each CELL had n replicates, never that each
 * row had the same number of cells — so a ragged design returned F = NaN and
 * p = NaN with a wrong total df and no complaint.
 */
export function twoWayAnova(cells: number[][][]): TwoWayAnovaResult {
  if (cells.length > 0) {
    const b = cells[0].length;
    if (cells.some((row) => row.length !== b)) {
      throw new RangeError(
        "Two-way ANOVA needs a rectangular design: every level of factor A must have the " +
          "same number of factor-B cells.",
      );
    }
  }
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
