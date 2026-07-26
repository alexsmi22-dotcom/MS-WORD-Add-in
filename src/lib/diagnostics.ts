// Assumption diagnostics: does this data meet the conditions of the test?
//
// WHY THIS EXISTS
// The t-test and ANOVA assume approximately normal data with comparable
// variances. The product happily ran them on anything and reported a p-value
// with no indication that the assumptions had failed — which is the exact
// silent-wrongness its own honesty rule forbids. Worse, tukey.ts's caveat told
// the user to "use Games-Howell instead" for unequal variances, and there was no
// way to discover whether variances WERE unequal, nor any Games-Howell to use.
//
// WHY D'AGOSTINO-PEARSON AND NOT SHAPIRO-WILK
// Shapiro-Wilk is the more powerful test at small n, but Royston's algorithm is
// a long chain of fitted polynomial approximations — easy to implement subtly
// wrong, and a subtly wrong p-value is worse than none. D'Agostino-Pearson K² is
// built from skewness and kurtosis by closed-form transforms, so every step can
// be checked against hand-computed values. Its cost is honest and stated: it
// needs a reasonable sample, and below that threshold this refuses to report
// rather than returning a number that means nothing.

import { chiSquareP, normalCdf } from "./stats2";
import { mean, variance, fTestP } from "./stats";

/** Below this, the K² transforms are not trustworthy and nothing is reported. */
export const MIN_NORMALITY_N = 20;

export interface NormalityResult {
  /** True when a p-value could be computed at all. */
  ok: boolean;
  /** Why not, when ok is false. */
  reason?: string;
  n: number;
  skewness: number;
  kurtosis: number;
  /** D'Agostino-Pearson omnibus statistic, ~chi-square with 2 df. */
  k2: number;
  p: number;
  /** True when normality is NOT rejected at alpha (i.e. the assumption holds). */
  normal: boolean;
}

/** Sample skewness, g1 (the biased/moment form the D'Agostino transform expects). */
export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  return m2 === 0 ? 0 : m3 / Math.pow(m2, 1.5);
}

/** Sample kurtosis, b2 — NOT excess: a normal distribution gives 3. */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m4 /= n;
  return m2 === 0 ? 0 : m4 / (m2 * m2);
}

/**
 * D'Agostino-Pearson K² omnibus test of normality.
 *
 * Transforms skewness and kurtosis each to an approximate standard normal (the
 * D'Agostino 1970 and Anscombe-Glynn 1983 transforms) and sums their squares,
 * which is chi-square with 2 df. A LOW p-value means the data are not normal.
 */
export function normalityTest(xs: number[], alpha = 0.05): NormalityResult {
  const n = xs.length;
  const base = { n, skewness: skewness(xs), kurtosis: kurtosis(xs), k2: NaN, p: NaN, normal: false };

  if (n < MIN_NORMALITY_N) {
    return {
      ...base,
      ok: false,
      reason:
        `A normality test needs at least ${MIN_NORMALITY_N} values to mean anything; this has ${n}. ` +
        "With a sample this small the test has almost no power — it will fail to reject almost any data — " +
        "so no p-value is reported rather than one that would be read as reassurance.",
    };
  }
  if (variance(xs) === 0) {
    return { ...base, ok: false, reason: "Every value is identical, so there is no distribution to test." };
  }

  const g1 = base.skewness;
  const b2 = base.kurtosis;

  // --- skewness -> Z1 (D'Agostino 1970) ---
  const y = g1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 =
    (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const w2 = -1 + Math.sqrt(2 * (beta2 - 1));
  const delta = 1 / Math.sqrt(Math.log(Math.sqrt(w2)));
  const alphaC = Math.sqrt(2 / (w2 - 1));
  const z1 = y === 0 ? 0 : delta * Math.log(y / alphaC + Math.sqrt((y / alphaC) * (y / alphaC) + 1));

  // --- kurtosis -> Z2 (Anscombe & Glynn 1983) ---
  const eb2 = (3 * (n - 1)) / (n + 1);
  const vb2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) * (n + 1) * (n + 3) * (n + 5));
  const x2 = (b2 - eb2) / Math.sqrt(vb2);
  const sqrtBeta1 =
    ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) *
    Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const a = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
  const term = (1 - 2 / a) / (1 + x2 * Math.sqrt(2 / (a - 4)));
  const z2 =
    (Math.sqrt(2 / (9 * a)) === 0 ? 0 : 1) *
    ((1 - 2 / (9 * a) - Math.cbrt(term)) / Math.sqrt(2 / (9 * a)));

  const k2 = z1 * z1 + z2 * z2;
  const p = chiSquareP(k2, 2);
  return { ...base, ok: true, k2, p, normal: p >= alpha };
}

export interface VarianceHomogeneityResult {
  ok: boolean;
  reason?: string;
  /** Brown-Forsythe / Levene F statistic. */
  f: number;
  df1: number;
  df2: number;
  p: number;
  /** True when equal variances are NOT rejected (the assumption holds). */
  equal: boolean;
  /** Largest group variance divided by smallest — the practical rule of thumb. */
  varianceRatio: number;
}

/**
 * Levene's test for equal variances, centred on the MEDIAN (Brown-Forsythe).
 *
 * The median-centred form is the default deliberately: the mean-centred original
 * is badly non-robust for skewed data, and skewed data is precisely when a user
 * needs to know their variances differ.
 *
 * It is an ordinary one-way ANOVA on each value's absolute deviation from its
 * group's centre, which is why the arithmetic below is verifiable by hand.
 */
export function varianceHomogeneity(groups: number[][], alpha = 0.05): VarianceHomogeneityResult {
  const usable = groups.filter((g) => g.length >= 2);
  const base = { f: NaN, df1: NaN, df2: NaN, p: NaN, equal: false, varianceRatio: NaN };
  if (usable.length < 2) {
    return { ...base, ok: false, reason: "Needs at least two groups with two or more values each." };
  }

  const median = (xs: number[]): number => {
    const s = [...xs].sort((p, q) => p - q);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const z = usable.map((g) => {
    const c = median(g);
    return g.map((v) => Math.abs(v - c));
  });

  const k = z.length;
  const nTotal = z.reduce((acc, g) => acc + g.length, 0);
  const flatZ = z.reduce<number[]>((acc, g) => acc.concat(g), []);
  const grand = mean(flatZ);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of z) {
    const gm = mean(g);
    ssBetween += g.length * (gm - grand) * (gm - grand);
    for (const v of g) ssWithin += (v - gm) * (v - gm);
  }
  const df1 = k - 1;
  const df2 = nTotal - k;
  if (df2 <= 0 || ssWithin === 0) {
    return {
      ...base,
      ok: false,
      reason: "The deviations have no spread, so an F statistic cannot be formed.",
    };
  }
  const f = ssBetween / df1 / (ssWithin / df2);

  // fCdf via the incomplete beta already used for ANOVA.
  const p = fTestP(f, df1, df2);

  const vars = usable.map((g) => variance(g)).filter((v) => Number.isFinite(v));
  const ratio = Math.max(...vars) / Math.min(...vars);

  return { ok: true, f, df1, df2, p, equal: p >= alpha, varianceRatio: ratio };
}

/**
 * APA-ish p for prose: "p < .001" or "p = .023".
 *
 * Written as one helper because building it inline produced "p = < .001" — the
 * prefix doubled, which is a mistake this codebase has made before in
 * formatP()'s callers.
 */
function pPhrase(p: number): string {
  if (!Number.isFinite(p)) return "p = n/a";
  return p < 0.001 ? "p < .001" : `p = ${p.toFixed(3)}`;
}

/**
 * A plain-language verdict on whether the parametric test was appropriate, and
 * what to use instead when it was not.
 *
 * Naming the alternative is the point. A warning that a assumption failed, with
 * no next step, just leaves the user stuck with a number they now distrust.
 */
export function describeAssumptions(
  groups: number[][],
  opts: { paired?: boolean } = {},
): string[] {
  const notes: string[] = [];
  const pooled = groups.reduce<number[]>((acc, g) => acc.concat(g), []);

  const norm = normalityTest(pooled);
  if (!norm.ok) {
    notes.push(`Normality not tested: ${norm.reason}`);
  } else if (!norm.normal) {
    notes.push(
      `⚠ The data are not normally distributed (D'Agostino-Pearson K² = ${norm.k2.toFixed(2)}, ` +
        `${pPhrase(norm.p)}; skewness ${norm.skewness.toFixed(2)}, ` +
        `kurtosis ${norm.kurtosis.toFixed(2)}). ` +
        (opts.paired
          ? "Consider the Wilcoxon signed-rank test instead."
          : groups.length > 2
            ? "Consider the Kruskal-Wallis test instead of ANOVA."
            : "Consider the Mann-Whitney U test instead."),
    );
  }

  if (groups.length >= 2) {
    const vh = varianceHomogeneity(groups);
    if (vh.ok && !vh.equal) {
      notes.push(
        `⚠ The groups do not have equal variances (Brown-Forsythe F(${vh.df1}, ${vh.df2}) = ` +
          `${vh.f.toFixed(2)}, ${pPhrase(vh.p)}; largest/smallest ` +
          `variance = ${vh.varianceRatio.toFixed(1)}). ` +
          (groups.length > 2
            ? "One-way ANOVA and Tukey HSD both assume equal variances; treat this result with caution."
            : "Use Welch's t-test rather than Student's pooled test — Welch does not assume equal variances."),
      );
    }
  }

  return notes;
}
