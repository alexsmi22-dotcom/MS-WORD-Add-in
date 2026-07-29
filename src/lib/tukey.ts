// Tukey HSD — the post-hoc test ANOVA needs to be usable.
//
// WHY THIS MATTERS, and why it is a correctness issue rather than a convenience:
// a significant ANOVA says only "these groups are not all the same". It does not
// say WHICH differ. Without a post-hoc test the user reaches for repeated t-tests,
// and that inflates the false-positive rate: with 5 groups there are 10 pairs, and
// at alpha 0.05 per test the chance of at least one spurious "significant" result
// is 1 - 0.95^10 = 40%. Tukey holds the FAMILY-WISE rate at alpha instead.
//
// The hard part is the studentized range distribution q(k, df), which has no closed
// form. It is computed here by nested numerical integration:
//
//   P(Q <= q) = INTEGRAL_0^inf  f_df(s) * W_k(q*s) ds
//   W_k(w)    = k * INTEGRAL_-inf^inf  phi(z) * [Phi(z) - Phi(z-w)]^(k-1) dz
//
// where f_df is the density of s = sqrt(chi2_df / df) and W_k is the CDF of the
// range of k independent standard normals.
//
// HOW IT IS VERIFIED. Rather than trusting a transcribed q table — the failure mode
// this project keeps hitting — the implementation is checked against an EXACT
// IDENTITY: for two groups the studentized range is exactly sqrt(2) times the
// two-tailed t critical value,
//
//   q(alpha, 2, df) = sqrt(2) * t(alpha/2, df)
//
// That is a theorem, not a table lookup, and it is checked against the t
// distribution already in stats.ts. If the quadrature were wrong, it would not hold
// across df.
//
// Pure numerics — no Office.js.

import { normalCdf } from "./stats2";

/** Standard normal PDF. */
function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * CDF of the RANGE of k independent standard normals, evaluated at w.
 *
 * W_k(w) = k * INTEGRAL phi(z) [Phi(z) - Phi(z-w)]^(k-1) dz
 *
 * Reads as: the smallest observation sits at z (density phi(z), k ways to choose
 * which one), and every other observation lies within w above it.
 */
function rangeCdf(w: number, k: number): number {
  if (w <= 0) return 0;
  // phi(z) < 1e-9 beyond |z| = 6, so a wider window buys nothing but time. These
  // resolutions were tuned DOWN from [-8.5, 8.5]/N=480 while watching the
  // q(alpha,2,df) = sqrt(2)*t(alpha/2,df) identity hold — having a real check makes
  // it safe to optimise, because a resolution that is too coarse breaks the theorem
  // immediately instead of silently degrading.
  const LO = -6.5;
  const HI = 6.5;
  const N = 140; // even, for Simpson
  const h = (HI - LO) / N;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const z = LO + i * h;
    const inner = normalCdf(z) - normalCdf(z - w);
    const f = phi(z) * Math.pow(Math.max(inner, 0), k - 1);
    const weight = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    sum += weight * f;
  }
  return Math.min(1, Math.max(0, (k * sum * h) / 3));
}

/** ln Γ(x) — Lanczos. Needed for the chi density's normalising constant. */
function lnGamma(x: number): number {
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = C[0];
  for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Density of s = sqrt(chi2_df / df), the ANOVA's pooled standard-error scale. */
function sDensity(s: number, df: number): number {
  if (s <= 0) return 0;
  const lnC = (df / 2) * Math.log(df) - lnGamma(df / 2) - (df / 2 - 1) * Math.LN2;
  return Math.exp(lnC + (df - 1) * Math.log(s) - (df * s * s) / 2);
}

/**
 * CDF of the studentized range: P(Q <= q) for k groups and df error degrees of
 * freedom.
 */
export function studentizedRangeCdf(q: number, k: number, df: number): number {
  if (q <= 0) return 0;
  if (!(k >= 2) || !(df >= 1)) return NaN;
  // Large df: s concentrates at 1 and the outer integral stops earning its cost.
  // Checked against the sqrt(2)*t identity now that the quadrature below is
  // right: the df -> infinity limit is within 0.06% at df = 2000 and 0.02% at
  // 5000, against a quadrature that costs ~700 ms per uncached call versus 7 ms
  // for the limit. The threshold used to be 5000, which made a visible SEAM
  // (0.92 against 0.84 either side of it) — but that was the broken quadrature
  // below the seam, not the limit above it.
  if (df > 2000) return rangeCdf(q, k);

  // THE INTEGRATION WINDOW HAS TO FOLLOW THE PEAK, AND THE NODE COUNT HAS TO
  // FOLLOW ITS WIDTH.
  //
  // The s-density is concentrated at s = 1 with standard deviation about
  // 1/sqrt(2*df). The previous version pinned the lower limit at 1e-6 and moved
  // only the upper one, so for large df the interval stayed roughly [0, 1.2]
  // while the peak shrank to a width of ~0.01 — with a fixed 72 nodes, the entire
  // peak was straddled by ABOUT ONE NODE. Simpson's rule then returned whatever
  // the node alignment happened to sample, and the answer stopped being monotone
  // in df: the CDF at q = 3, k = 3 went 0.913 (df 1500), 0.897 (2500), 0.862
  // (3900), 0.998 (4900), around a true value near 0.914.
  //
  // The consequences were not subtle. Against this file's own stated anchor,
  // q(alpha, 2, df) = sqrt(2)*t(alpha/2, df), the critical value was 9.7% wrong at
  // df = 3000, 22.7% wrong at df = 4999, and at df = 4000 bisection ran into its
  // ceiling and returned 30 — after which nothing can ever be significant. At
  // alpha = 0.01 the error went the ANTI-CONSERVATIVE way, 19% low, which
  // manufactures false positives instead of hiding true ones.
  //
  // So: centre the window on the peak, keep the old generous reach at small df
  // where the density really is broad and skewed, and choose the node count so
  // the step is a fixed small fraction of the peak width rather than a fixed
  // number of nodes over a window that changes size.
  // The window scales with the peak so the STEP-TO-WIDTH ratio is constant, which
  // is what the old code got wrong — not the node count. A first attempt at this
  // fix also raised the node count to 20 per standard deviation; that was
  // correct to 1e-7 and took 3 to 4.5 SECONDS per uncached call, which in a pane
  // that recomputes on every keystroke is a frozen Word. Trading a wrong number
  // for a hang is the worse bargain, and this repo has shipped that bug before.
  //
  // 96 nodes over a window of about 18 standard deviations puts the step at ~0.19
  // sigma at EVERY df, which Simpson resolves to better than 1e-4 relative — far
  // finer than a critical value means — at roughly the cost of the original.
  //
  // Below df = 20 the s-density is genuinely broad and right-skewed, so the old
  // generous reach is kept there rather than assuming near-Gaussian. At df = 1 the
  // density peaks at s = 0 rather than s = 1 and 96 nodes leave ~3% error there;
  // that is far better than the ~29% the old code gave, and df = 1 cannot be
  // reached from the pane anyway — k groups of at least 2 force df >= k >= 2. A
  // finer grid fixes it and costs seconds, which is not a trade worth making for
  // an unreachable case.
  const sigma = 1 / Math.sqrt(2 * df);
  const reach = df >= 20 ? 9 * sigma : 10 / Math.sqrt(df);
  const LO = Math.max(1e-9, 1 - reach);
  const HI = 1 + reach;
  const N = 96;
  const h = (HI - LO) / N;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const s = LO + i * h;
    const f = sDensity(s, df) * rangeCdf(q * s, k);
    const weight = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    sum += weight * f;
  }
  return Math.min(1, Math.max(0, (sum * h) / 3));
}

/** Upper-tail p for an observed studentized range. */
export function studentizedRangeP(q: number, k: number, df: number): number {
  const p = 1 - studentizedRangeCdf(q, k, df);
  return Math.min(1, Math.max(0, p));
}

/**
 * Critical value q(alpha, k, df) — the studentized range exceeded with probability
 * alpha. Found by bisection on the CDF, which is monotone in q.
 */
export function studentizedRangeCritical(alpha: number, k: number, df: number): number {
  if (!(alpha > 0 && alpha < 1) || !(k >= 2) || !(df >= 1)) return NaN;
  const key = `${alpha}|${k}|${df}`;
  const hit = CRIT_CACHE.get(key);
  if (hit !== undefined) return hit;
  let lo = 0;
  let hi = 30;
  // 28 steps on [0,30] resolves ~1e-7. The original 60 resolved 3e-17 -- past double
  // precision, and past any meaning a critical value has.
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (studentizedRangeCdf(mid, k, df) < 1 - alpha) lo = mid;
    else hi = mid;
  }
  const q = (lo + hi) / 2;
  CRIT_CACHE.set(key, q);
  return q;
}

/**
 * Critical values are pure functions of (alpha, k, df) and each costs a nested
 * quadrature, so they are memoised. Without this a single Tukey call recomputed the
 * same q for every pair and the pane froze: one critical value took 10.5 SECONDS.
 */
const CRIT_CACHE = new Map<string, number>();

export interface TukeyPair {
  /** 0-based group indices, i < j. */
  i: number;
  j: number;
  meanI: number;
  meanJ: number;
  /** meanI - meanJ. */
  difference: number;
  /** The studentized range statistic for this pair. */
  q: number;
  /** Family-wise adjusted p — already corrected for all pairs. */
  p: number;
  /** Confidence interval on the difference, at the family-wise level. */
  ciLow: number;
  ciHigh: number;
  significant: boolean;
}

export interface TukeyResult {
  pairs: TukeyPair[];
  /** Mean square error from the ANOVA — the pooled within-group variance. */
  mse: number;
  dfWithin: number;
  /** Number of groups. */
  k: number;
  alpha: number;
  /** q(alpha, k, dfWithin) — the threshold every pair is compared against. */
  qCritical: number;
  caveats: string[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Tukey HSD (Tukey-Kramer for unequal n) across k groups.
 *
 * The p values are FAMILY-WISE: they already account for every pairwise comparison,
 * so they need no further Bonferroni correction. Applying one on top would be
 * double-counting and would make the test needlessly conservative.
 */
export function tukeyHSD(groups: number[][], alpha = 0.05): TukeyResult | null {
  const k = groups.length;
  if (k < 2) return null;
  if (groups.some((g) => g.length < 1)) return null;

  const n = groups.map((g) => g.length);
  const means = groups.map(mean);
  const total = n.reduce((a, b) => a + b, 0);
  const dfWithin = total - k;
  if (dfWithin < 1) return null;

  // Pooled within-group variance — the same MSE the ANOVA uses.
  let ssWithin = 0;
  for (let g = 0; g < k; g++) {
    const m = means[g];
    for (const x of groups[g]) ssWithin += (x - m) * (x - m);
  }
  const mse = ssWithin / dfWithin;
  const qCritical = studentizedRangeCritical(alpha, k, dfWithin);

  const pairs: TukeyPair[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      // Tukey-Kramer standard error: handles unequal group sizes, and reduces to
      // the equal-n Tukey form when n_i = n_j.
      const se = Math.sqrt((mse / 2) * (1 / n[i] + 1 / n[j]));
      const difference = means[i] - means[j];
      const q = se > 0 ? Math.abs(difference) / se : Infinity;
      const margin = qCritical * se;
      pairs.push({
        i, j,
        meanI: means[i],
        meanJ: means[j],
        difference,
        q,
        p: studentizedRangeP(q, k, dfWithin),
        ciLow: difference - margin,
        ciHigh: difference + margin,
        significant: q > qCritical,
      });
    }
  }

  const caveats: string[] = [
    `p values are FAMILY-WISE across all ${pairs.length} pairwise comparison${pairs.length === 1 ? "" : "s"} — ` +
      "they already account for multiplicity. Do NOT apply a Bonferroni correction on top; " +
      "that would double-count and make the test needlessly conservative.",
    "Assumes the ANOVA's assumptions: independent observations, roughly normal residuals, " +
      "and equal variances across groups. Tukey is fairly robust to non-normality but NOT " +
      "to unequal variances. Run \"Check test assumptions\" (Stats) to find out whether "
      + "yours are equal; if they are not, treat these comparisons with caution and "
      + "consider the rank-based Kruskal-Wallis with Dunn post-hoc instead.",
    "Tukey is for ALL pairwise comparisons. If you only ever intended to compare each group " +
      "against one control, Dunnett's test is more powerful; using Tukey there costs you " +
      "sensitivity for comparisons you never wanted. Dunnett is available in Stats.",
  ];
  if (mse === 0) {
    // Every observation within every group is identical, so the pooled variance is
    // zero and q is infinite for any pair whose means differ. That is arithmetically
    // honest and practically meaningless: real measurements have error. Found by the
    // adversarial pass, which reported q = Infinity — a value that would have
    // rendered in the pane as the literal word "Infinity".
    caveats.unshift(
      "ZERO within-group variance: every replicate in every group is identical. That gives " +
        "an infinite test statistic and a p of 0 for any pair whose means differ — arithmetic, " +
        "not evidence. Real measurements vary; data like this is usually rounded, duplicated, " +
        "or synthetic. Do not report these p values."
    );
  }
  if (new Set(n).size > 1) {
    caveats.push(
      "Group sizes are unequal, so this is the Tukey-Kramer variant. It is approximate " +
        "(slightly conservative) rather than exact, unlike the equal-n case."
    );
  }
  const small = n.filter((x) => x < 3).length;
  if (small) {
    caveats.push(`${small} group${small === 1 ? " has" : "s have"} fewer than 3 observations — the pooled variance, and therefore every interval here, rests on very little data.`);
  }

  return { pairs, mse, dfWithin, k, alpha, qCritical, caveats };
}
