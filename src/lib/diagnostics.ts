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
import { mean, variance, fTestP, incompleteBeta } from "./stats";
import { probit } from "./regression";

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
 * Each value minus ITS OWN GROUP'S mean — the residuals a t-test or ANOVA
 * actually assumes are normal.
 *
 * WHY POOLING THE RAW VALUES IS NOT A SHORTCUT FOR THIS. `describeAssumptions`
 * used to be one `concat`: every group poured into one vector and handed to
 * `normalityTest`. But two normal groups with different means are BIMODAL when
 * concatenated, so the check fired *because there was an effect* — and fired
 * harder the larger the effect got. Measured on two textbook-normal groups
 * separated by 4 SD: each group on its own passed, and the pooled vector came
 * back p = 2.1e-5 at n = 25 and p = 3.3e-10 at n = 40.
 *
 * Centring alone is NOT enough either — see `normalityCheckSample`, which is
 * what callers should use.
 */
export function withinGroupResiduals(groups: number[][]): number[] {
  const out: number[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    const m = mean(g);
    for (const v of g) out.push(v - m);
  }
  return out;
}

/**
 * One group's residuals re-expressed as EXACT standard normal scores.
 *
 * WHY THIS MACHINERY EXISTS — it is not gold plating, it is the second half of a
 * defect. Centring each group removes the effect that made the pooled marginal
 * bimodal, but it leaves the SCALE differences, and pooling residuals from
 * groups with different variances is a scale mixture, which is leptokurtic. The
 * omnibus test then rejects on kurtosis for data that is perfectly normal inside
 * every group. Measured over 400 trials of normal data (n = 30 per group), with
 * plain centred residuals:
 *
 *     2 groups, sd 1:5     62% false warnings
 *     2 groups, sd 1:10    73%
 *     3 groups, sd 1/1/10  100%
 *     4 groups, sd 1/2/5/10 99%
 *
 * The obvious repair — divide each group's residuals by its own sd — fixes that
 * completely (all four fall to ~5%) and introduces a NEW failure at the other
 * end, because dividing by a scale estimated from the same few values bounds the
 * result at ±(n−1)/√n and makes the pooled vector platykurtic. Measured, again
 * on normal data: 8 groups of 4 gave 53% false warnings, 20 groups of 5 gave
 * 96%, and any design with 3 per group gave 100%. Small groups are the NORM on
 * this surface, so that trade is not available.
 *
 * So the residuals are transformed instead of merely scaled. For a normal sample
 * of size n, the studentized residual τ = (x − x̄)/s has an exact distribution
 * (Thompson 1935): n·τ²/(n−1)² is Beta(½, (n−2)/2). Pushing τ through that
 * Beta CDF gives a uniform, and the signed normal quantile of it is EXACTLY
 * standard normal — whatever the group's variance, and for any n ≥ 3. Both
 * pieces are existing, separately tested code (`incompleteBeta`, `probit`),
 * which is the reason this is acceptable where a hand-rolled Shapiro-Wilk was
 * not: nothing new is approximated here.
 *
 * Verified rather than argued — `statsDefects.test.ts` holds both guards: the
 * transform of a large normal sample has mean 0.000 and sd 1.000, and the false-
 * warning rate stays in single figures across every design above.
 *
 * ITS OWN COST, MEASURED. The scores within one group are not independent (they
 * are built from that group's own mean and sd), so the omnibus test's null —
 * which assumes N independent values — is slightly too tight, and the check
 * over-rejects a little. Measured against a single plain normal sample put
 * straight into `normalityTest`, 2000 trials:
 *
 *     N          plain sample     two groups, sd 1:10, through this transform
 *     20             5.0%                        8.9%
 *     60             5.3%                        7.3%
 *     240            5.3%                        6.0%
 *
 * So roughly 1 to 4 points above nominal, worst at small N and shrinking as N
 * grows. That is the honest price, and it is paid UNIFORMLY: it does not depend
 * on the variance ratio, which is the property that was broken. The alternatives
 * cost 25-100% on exactly the designs a user is most likely to bring.
 */
function normalScores(g: number[]): number[] {
  const n = g.length;
  // n < 3 carries no shape information at all: with two values τ is ±1 by
  // construction, and Beta(½, 0) is degenerate.
  if (n < 3) return [];
  const m = mean(g);
  const s = Math.sqrt(variance(g));
  // A constant group has no distribution; zeros keep it visible to the
  // constant-data refusal instead of silently dropping it.
  if (!(s > 0)) return new Array(n).fill(0);
  const out: number[] = [];
  for (const v of g) {
    const tau = (v - m) / s;
    const w = Math.min(1, (n * tau * tau) / ((n - 1) * (n - 1)));
    const u = incompleteBeta(w, 0.5, (n - 2) / 2);
    // probit is ±Infinity at 0 and 1, and one Infinity makes every downstream
    // moment NaN — which reads as "not normal" and would be a new false warning.
    const half = Math.min(1 - 1e-12, Math.max(1e-12, (1 + u) / 2));
    out.push((tau < 0 ? -1 : 1) * probit(half));
  }
  return out;
}

/**
 * The sample whose normality actually has to be tested for this design — the one
 * thing every caller should hand to `normalityTest`.
 *
 * Three designs, three answers, because the assumption is a different one in
 * each: a paired test assumes the DIFFERENCES are normal, a single sample
 * assumes ITSELF normal, and a multi-group test assumes the WITHIN-GROUP
 * residuals are normal (see `normalScores` for why those are transformed rather
 * than merely centred).
 */
export function normalityCheckSample(groups: number[][], opts: { paired?: boolean } = {}): number[] {
  const usable = groups.filter((g) => g.length > 0);
  if (opts.paired && usable.length === 2) return pairedDifferences(usable[0], usable[1]);
  // One group is its own residual vector: skewness and kurtosis are unchanged by
  // subtracting a constant, so this is the raw sample, tested directly.
  if (usable.length === 1) return withinGroupResiduals(usable);
  const out: number[] = [];
  // Appended one at a time, NOT with `out.push(...scores)`: the spread passes
  // every element as a separate argument and throws RangeError past ~125,000 of
  // them, which is an ordinary paste here. See minmax.ts.
  for (const g of usable) for (const z of normalScores(g)) out.push(z);
  return out;
}

/**
 * The paired differences a_i − b_i, over the rows where both conditions have a
 * value.
 *
 * The paired t-test's normality assumption is about the DIFFERENCES, not about
 * either condition's raw scores: two strongly skewed conditions can have
 * perfectly normal differences, and the old pooled check warned on exactly that
 * design. Ragged input is truncated rather than subtracted through, because
 * `x - undefined` is NaN, a NaN skewness reads as "not normal", and that would
 * be a new spurious-warning path replacing the one being closed.
 */
export function pairedDifferences(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a[i] - b[i]);
  return out;
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
  const paired = opts.paired === true;
  const subject = normalityCheckSample(groups, opts);
  const subjectName = paired && groups.length === 2 ? "The paired differences" : "The within-group residuals";

  // THE VARIANCE VERDICT IS COMPUTED FIRST, BECAUSE IT CHOOSES THE REMEDY.
  // These two checks used to run independently and could print, four lines
  // apart, "Consider the Mann-Whitney U test instead" and "Use Welch's t-test
  // rather than Student's pooled test" — two different fixes for one diagnosis,
  // and the more prominent one is the wrong one: a rank test does not repair
  // unequal variances (Mann-Whitney assumes the two distributions have the same
  // shape), Welch does.
  //
  // Not run for a paired design at all. The paired t-test works on one column of
  // differences and has NO equal-variance assumption, so recommending Welch
  // there was advice against a problem the test does not have.
  const vh = !paired && groups.length >= 2 ? varianceHomogeneity(groups) : null;
  const unequalVariance = vh !== null && vh.ok && !vh.equal;
  const varianceFinding = vh
    ? `Brown-Forsythe F(${vh.df1}, ${vh.df2}) = ${vh.f.toFixed(2)}, ${pPhrase(vh.p)}; ` +
      `largest/smallest variance = ${vh.varianceRatio.toFixed(1)}`
    : "";

  /** What to do about unequal variances — the same sentence wherever it appears. */
  const varianceRemedy =
    groups.length > 2
      ? "One-way ANOVA and Tukey HSD both assume equal variances; treat this result with caution. " +
        "Welch's ANOVA with Games-Howell is the right pairing for unequal variances and this " +
        "product does not provide it."
      : "Use Welch's t-test rather than Student's pooled test — Welch does not assume equal variances.";

  const norm = normalityTest(subject);
  const nonNormal = norm.ok && !norm.normal;

  if (!norm.ok) {
    notes.push(
      `Normality not tested: ${
        subject.length === 0
          ? "every group has fewer than three values, which says nothing about shape."
          : norm.reason
      }`,
    );
  } else if (nonNormal && unequalVariance) {
    // ONE note, ONE remedy. Reporting these separately is what produced the
    // contradiction; reporting the variance problem as the headline is
    // deliberate, because it is the one with a fix available here.
    notes.push(
      `⚠ Two assumptions fail at once. ${subjectName} are not normally distributed ` +
        `(D'Agostino-Pearson K² = ${norm.k2.toFixed(2)}, ${pPhrase(norm.p)}; skewness ` +
        `${norm.skewness.toFixed(2)}, kurtosis ${norm.kurtosis.toFixed(2)}), AND the groups do ` +
        `not have equal variances (${varianceFinding}). ${varianceRemedy} A rank test is NOT the ` +
        `fix for the variance half: ${
          groups.length > 2 ? "Kruskal-Wallis" : "Mann-Whitney"
        } assumes the groups have the same shape and differ only by a shift, which is exactly ` +
        `what unequal spread violates.`,
    );
  } else if (nonNormal) {
    notes.push(
      `⚠ ${subjectName} are not normally distributed ` +
        `(D'Agostino-Pearson K² = ${norm.k2.toFixed(2)}, ` +
        `${pPhrase(norm.p)}; skewness ${norm.skewness.toFixed(2)}, ` +
        `kurtosis ${norm.kurtosis.toFixed(2)}). ` +
        (paired
          ? "Consider the Wilcoxon signed-rank test instead."
          : groups.length > 2
            ? "Consider the Kruskal-Wallis test instead of ANOVA."
            : "Consider the Mann-Whitney U test instead."),
    );
  }

  if (unequalVariance && !nonNormal) {
    notes.push(`⚠ The groups do not have equal variances (${varianceFinding}). ${varianceRemedy}`);
  }

  return notes;
}
