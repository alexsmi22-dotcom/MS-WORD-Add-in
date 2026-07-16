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
  // Large df: s concentrates at 1 and the outer integral is unnecessary.
  if (df > 5000) return rangeCdf(q, k);

  // s is concentrated near 1; integrate generously either side of it.
  const LO = 1e-6;
  const HI = 1 + 10 / Math.sqrt(df);
  const N = 72;
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
      "to unequal variances — with heteroscedastic groups use Games-Howell instead.",
    "Tukey is for ALL pairwise comparisons. If you only ever intended to compare each group " +
      "against one control, Dunnett's test is more powerful; using Tukey there costs you " +
      "sensitivity for comparisons you never wanted.",
  ];
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
