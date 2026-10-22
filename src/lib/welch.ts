// Welch's one-way ANOVA and the Games–Howell post-hoc test — the pairing for
// groups whose variances differ.
//
// WHY THIS EXISTS. "Check test assumptions" tests whether the groups have equal
// variances (Brown–Forsythe), and when they do not it said "Welch's ANOVA with
// Games-Howell is the right pairing for unequal variances and this product does
// not provide it". One-way ANOVA and Tukey HSD both pool the variances; when one
// group is far noisier than another, the pooled estimate is too small for the
// noisy group and too large for the quiet one, and the false-positive rate is
// no longer alpha. Welch (1951) and Games & Howell (1976) keep every group's
// own variance.
//
// THE FORMULAS (Welch 1951; Games & Howell 1976), with nᵢ, x̄ᵢ, sᵢ² per group:
//
//   wᵢ = nᵢ / sᵢ²,  W = Σwᵢ,  x̄* = Σwᵢx̄ᵢ / W
//   A  = Σwᵢ(x̄ᵢ − x̄*)² / (k − 1)
//   λ  = 3·Σ[(1 − wᵢ/W)² / (nᵢ − 1)] / (k² − 1)
//   F  = A / (1 + 2λ(k − 2)/3),  df₁ = k − 1,  df₂ = 1/λ
//
//   Games–Howell, each pair i, j:
//   SE  = √(sᵢ²/nᵢ + sⱼ²/nⱼ)            (standard error of the difference)
//   df  = SE⁴ / [(sᵢ²/nᵢ)²/(nᵢ − 1) + (sⱼ²/nⱼ)²/(nⱼ − 1)]   (Welch–Satterthwaite)
//   q   = √2·|x̄ᵢ − x̄ⱼ| / SE,  p = P(Q_{k, df} > q)
//   CI  = (x̄ᵢ − x̄ⱼ) ± q_crit(α; k, df)/√2 · SE
//
// That is the convention of pingouin.pairwise_gameshowell and of SPSS, and the
// tests check it against pingouin 0.7.0 and scipy 1.18. Every pair has its own
// fractional df, which is why the studentized range here is the fractional-df
// path in tukey.ts (studentizedRangeSf / studentizedRangeQuantile), not the
// Tukey one.
//
// EXACT ANCHORS the tests use, beside the oracle: with two groups, Welch's F is
// exactly the square of Welch's t (and df₂ is the Welch t df), and the
// Games–Howell p is exactly the Welch t-test p, because the studentized range of
// two means is √2·|t|.
//
// Pure numerics; no Office.js. Refuses by name rather than return NaN.

import { mean, fTestP } from "./stats";
import { studentizedRangeSf, studentizedRangeQuantile } from "./tukey";
import { timesTen } from "./axis";

/**
 * A number to `sig` significant figures: plain digits between 1e-4 and 1e6,
 * otherwise a mantissa ×10ⁿ (never "1e+21"), with a true minus (U+2212).
 * Used for every number this test prints, refusals included.
 */
export function welchNum(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "not computable";
  if (x === 0) return "0";
  const minus = (s: string): string => s.replace(/^-/, "−");
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-4) {
    const e = Math.floor(Math.log10(a));
    let m = Number((x / Math.pow(10, e)).toPrecision(sig));
    let ee = e;
    if (Math.abs(m) >= 10) {
      m /= 10;
      ee += 1;
    }
    return minus(`${m}${timesTen(ee)}`);
  }
  return minus(String(Number(x.toPrecision(sig))));
}

export interface WelchGroupStats {
  n: number;
  mean: number;
  variance: number;
  sd: number;
}

export type WelchRefusal = { ok: false; reason: string };

export interface WelchAnovaResult {
  ok: true;
  k: number;
  f: number;
  df1: number;
  df2: number;
  p: number;
  groups: WelchGroupStats[];
  /** The variance-weighted grand mean x̄*. */
  weightedMean: number;
  caveats: string[];
}

export interface GamesHowellPair {
  /** 0-based group indices, i < j. */
  i: number;
  j: number;
  meanI: number;
  meanJ: number;
  /** meanI − meanJ. */
  difference: number;
  /** Standard error of the difference, √(sᵢ²/nᵢ + sⱼ²/nⱼ). */
  se: number;
  /** Welch–Satterthwaite df for this pair (fractional). */
  df: number;
  /** Welch t = difference / se. */
  t: number;
  /** Studentized range statistic √2·|t|. */
  q: number;
  /** Family-wise p, P(Q_{k, df} > q). */
  p: number;
  /** q_crit(α; k, df) for this pair's df. */
  qCritical: number;
  /** Simultaneous (family-wise) confidence interval on the difference. */
  ciLow: number;
  ciHigh: number;
  /** p < α. */
  significant: boolean;
}

export interface GamesHowellResult {
  ok: true;
  k: number;
  alpha: number;
  pairs: GamesHowellPair[];
  groups: WelchGroupStats[];
  caveats: string[];
}

/** The largest number of groups accepted: 20 groups is 190 pairs, each with its own df. */
export const WELCH_MAX_GROUPS = 20;

/**
 * Per-group summaries, or a refusal that names the group and the reason.
 * `test` is the test's name, used in the sentence.
 */
export function welchGroupStats(groups: number[][], test: string): WelchGroupStats[] | WelchRefusal {
  if (!Array.isArray(groups) || groups.length < 2) {
    const found = Array.isArray(groups) ? groups.length : 0;
    return {
      ok: false,
      reason:
        `${test} needs at least two groups; ${found === 1 ? "only one was found" : "none were found"}. ` +
        "Separate the groups with a blank line or a semicolon.",
    };
  }
  if (groups.length > WELCH_MAX_GROUPS) {
    return {
      ok: false,
      reason:
        `${test} is limited to ${WELCH_MAX_GROUPS} groups here (${groups.length} were entered). ` +
        `Each of the ${(groups.length * (groups.length - 1)) / 2} pairs has its own degrees of freedom and its own critical value, ` +
        "and beyond this the pane would stall while you type.",
    };
  }
  const out: WelchGroupStats[] = [];
  for (let g = 0; g < groups.length; g++) {
    const xs = groups[g];
    const label = `Group ${g + 1}`;
    if (!Array.isArray(xs) || xs.length === 0) {
      return { ok: false, reason: `${label} is empty. Every group needs at least two values.` };
    }
    if (xs.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      return { ok: false, reason: `${label} contains a value that is not a finite number.` };
    }
    if (xs.length < 2) {
      return {
        ok: false,
        reason:
          `${label} has only one value. ${test} uses each group's own variance, ` +
          "and a variance needs at least two values.",
      };
    }
    const m = mean(xs);
    let ss = 0;
    for (const v of xs) ss += (v - m) * (v - m);
    const variance = ss / (xs.length - 1);
    if (!Number.isFinite(m) || !Number.isFinite(variance)) {
      return {
        ok: false,
        reason:
          `${label}'s values are too large to square in double precision, so its variance cannot be computed. ` +
          "Rescale the data (for example, change the unit) and run it again.",
      };
    }
    if (variance === 0 && xs.some((v) => v !== xs[0])) {
      // The values differ, but their spread squared is below the smallest
      // double (about 5×10⁻³²⁴): [1×10⁻²⁰⁰, 2×10⁻²⁰⁰] has s² = 5×10⁻⁴⁰¹. Saying
      // "every value is 1×10⁻²⁰⁰" there was false. Rescaling cannot always help
      // (the weight n/s² of such a group is itself beyond double range), so this
      // is refused by name.
      return {
        ok: false,
        reason:
          `${label}'s values differ, but by so little that their variance is below the precision double ` +
          `arithmetic can represent, so ${test} cannot weight the group by n/s². Rescale the data ` +
          "(for example, change the unit) and run it again.",
      };
    }
    if (variance === 0) {
      return {
        ok: false,
        reason:
          `${label} has zero variance: every value is ${welchNum(xs[0], 6)}. ${test} weights each group by n/s², ` +
          "a division by zero when s² = 0. Real measurements vary; identical replicates usually mean " +
          "rounded, duplicated or synthetic data.",
      };
    }
    if (!Number.isFinite(xs.length / variance)) {
      return {
        ok: false,
        reason: `${label}'s variance is too small to weight in double precision. Rescale the data and run it again.`,
      };
    }
    out.push({ n: xs.length, mean: m, variance, sd: Math.sqrt(variance) });
  }
  return out;
}

/** Welch's one-way ANOVA (Welch 1951). */
export function welchAnova(groups: number[][]): WelchAnovaResult | WelchRefusal {
  const st = welchGroupStats(groups, "Welch's ANOVA");
  if (!Array.isArray(st)) return st;
  const k = st.length;
  const w = st.map((g) => g.n / g.variance);
  const W = w.reduce((a, b) => a + b, 0);
  // Weighted grand mean, accumulated as offsets from the first mean so that
  // data with a large common offset (1e9 + small differences) keeps its digits.
  const ref = st[0].mean;
  let acc = 0;
  for (let i = 0; i < k; i++) acc += w[i] * (st[i].mean - ref);
  const weightedMean = ref + acc / W;
  let ssB = 0;
  for (let i = 0; i < k; i++) {
    const d = st[i].mean - ref - acc / W;
    ssB += w[i] * d * d;
  }
  const A = ssB / (k - 1);
  let lamSum = 0;
  for (let i = 0; i < k; i++) {
    const r = 1 - w[i] / W;
    lamSum += (r * r) / (st[i].n - 1);
  }
  const lambda = (3 * lamSum) / (k * k - 1);
  const df1 = k - 1;
  const df2 = 1 / lambda;
  const f = A / (1 + (2 * lambda * (k - 2)) / 3);
  const p = fTestP(f, df1, df2);
  if (![W, weightedMean, f, df2, p].every(Number.isFinite)) {
    return {
      ok: false,
      reason: "Welch's ANOVA is not computable at this magnitude. Rescale the data (for example, change the unit) and run it again.",
    };
  }

  const caveats: string[] = [
    "Welch's F does not assume equal variances: each group is weighted by its own n/s². It still assumes " +
      "independent observations and roughly normal data within each group.",
    "A significant F says only that the group means are not all equal. Games–Howell (Stats) says which pairs differ, " +
      "without assuming equal variances either.",
  ];
  const small = st.filter((g) => g.n < 3).length;
  if (small) {
    caveats.push(
      `${small} group${small === 1 ? " has" : "s have"} fewer than 3 values. Each group's variance, and so its weight, ` +
        "rests on very little data.",
    );
  }
  return { ok: true, k, f, df1, df2, p, groups: st, weightedMean, caveats };
}

/** Games–Howell pairwise comparisons (Games & Howell 1976). */
export function gamesHowell(groups: number[][], alpha = 0.05): GamesHowellResult | WelchRefusal {
  if (!(alpha > 0 && alpha < 1)) return { ok: false, reason: "The family-wise level must be between 0 and 1." };
  const st = welchGroupStats(groups, "Games–Howell");
  if (!Array.isArray(st)) return st;
  const k = st.length;
  const pairs: GamesHowellPair[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const a = st[i];
      const b = st[j];
      const vi = a.variance / a.n;
      const vj = b.variance / b.n;
      const se2 = vi + vj;
      const se = Math.sqrt(se2);
      // Welch–Satterthwaite, kept inside its mathematical bounds
      // [min(nᵢ−1, nⱼ−1), nᵢ+nⱼ−2] so rounding can never push it below 1.
      // Written in the shares rᵢ = vᵢ/SE² (each in [0, 1]) rather than as
      // SE⁴ / (vᵢ²/… + vⱼ²/…): for data near 1×10¹⁵⁰, SE² is ~10²⁹⁹ and SE⁴ overflows.
      const ri = vi / se2;
      const rj = vj / se2;
      const rawDf = 1 / ((ri * ri) / (a.n - 1) + (rj * rj) / (b.n - 1));
      const df = Math.min(a.n + b.n - 2, Math.max(Math.min(a.n - 1, b.n - 1), rawDf));
      const difference = a.mean - b.mean;
      const t = difference / se;
      const q = Math.SQRT2 * Math.abs(t);
      const p = studentizedRangeSf(q, k, df);
      const qCritical = studentizedRangeQuantile(alpha, k, df);
      const margin = (qCritical / Math.SQRT2) * se;
      const pair: GamesHowellPair = {
        i,
        j,
        meanI: a.mean,
        meanJ: b.mean,
        difference,
        se,
        df,
        t,
        q,
        p,
        qCritical,
        ciLow: difference - margin,
        ciHigh: difference + margin,
        significant: p < alpha,
      };
      if (![se, df, t, q, p, qCritical, pair.ciLow, pair.ciHigh].every(Number.isFinite)) {
        return {
          ok: false,
          reason:
            `Games–Howell is not computable at this magnitude (Group ${i + 1} vs ${j + 1}). ` +
            "Rescale the data (for example, change the unit) and run it again.",
        };
      }
      pairs.push(pair);
    }
  }

  const caveats: string[] = [
    `p values are FAMILY-WISE across all ${pairs.length} pairwise comparison${pairs.length === 1 ? "" : "s"}: ` +
      "each is the studentized range at that pair's own Welch df, so they already account for multiplicity. " +
      "Do NOT apply a Bonferroni correction on top.",
    "Games–Howell does not assume equal variances: every pair uses its own two variances and its own " +
      "Welch–Satterthwaite df. It still assumes independent observations and roughly normal data within each group.",
  ];
  const small = st.filter((g) => g.n < 6).length;
  if (small) {
    caveats.push(
      `${small} group${small === 1 ? " has" : "s have"} fewer than 6 values. With very small groups Games–Howell ` +
        "can run somewhat liberal (its family-wise error rate can exceed α), so treat borderline p values with caution.",
    );
  }
  if (st.every((g, _, arr) => g.n === arr[0].n) && maxVarianceRatio(st) < 1.5) {
    caveats.push(
      "These groups have similar sizes and similar variances. Tukey HSD is the more powerful test when " +
        "variances really are equal; Games–Howell is for when they are not.",
    );
  }
  return { ok: true, k, alpha, pairs, groups: st, caveats };
}

function maxVarianceRatio(st: WelchGroupStats[]): number {
  const v = st.map((g) => g.variance);
  return Math.max(...v) / Math.min(...v);
}
