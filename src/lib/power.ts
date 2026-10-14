/**
 * Power analysis and sample size — the question a reviewer asks first.
 *
 * WHY THIS EXISTS. The product computed t-tests, ANOVA and proportions and
 * said nothing about whether a study could have found the effect it was
 * looking for. "How many per group?" is the first question a supervisor or a
 * reviewer asks, and the answer needs the NON-CENTRAL t and F distributions,
 * which did not exist here. They do now.
 *
 * Verified against published oracles (G*Power 3.1, which every methods
 * section cites): two-sample t, d = 0.5, α = .05 two-sided, n = 64 per group
 * → power 0.80; one-sample/paired, d = 0.5, n = 34 → 0.81; one-way ANOVA,
 * k = 3, f = 0.25, n = 53 per group → 0.80; two proportions 0.50 vs 0.60 →
 * n = 388 per group for 0.80. The tests pin those.
 *
 * Honest limits, stated in the output: effect sizes are Cohen's conventions,
 * groups are assumed equal in size and (for t and F) normal with equal
 * variance; the proportions test is the large-sample z approximation without
 * continuity correction, so small expected counts call for Fisher's exact
 * instead. Nothing here is a substitute for a pilot study's own estimate of
 * the effect.
 */
import { incompleteBeta, gammaln } from "./stats";
import { normalCdf } from "./stats2";
import { probit } from "./regression";

/** Central t CDF, P(T ≤ t). */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Central F CDF, P(F ≤ f). */
export function fCdf(f: number, df1: number, df2: number): number {
  if (f <= 0) return 0;
  const x = (df1 * f) / (df1 * f + df2);
  return incompleteBeta(x, df1 / 2, df2 / 2);
}

/** Smallest x with cdf(x) ≥ p, by bisection over a monotone CDF on [0, hi). */
export function quantile(cdf: (x: number) => number, p: number, lo = 0, hi = 1): number {
  while (cdf(hi) < p && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

/** Upper-tail critical value: P(T > t) = alpha. */
export function tUpper(alpha: number, df: number): number {
  return quantile((x) => tCdf(x, df), 1 - alpha);
}
/** Upper-tail critical value: P(F > f) = alpha. */
export function fUpper(alpha: number, df1: number, df2: number): number {
  return quantile((x) => fCdf(x, df1, df2), 1 - alpha);
}

/**
 * Non-central t CDF, P(T ≤ t | df, δ) — Lenth (1989), AS 243, the algorithm R
 * uses for pt(ncp=). A Poisson-weighted series of incomplete-beta terms with
 * an explicit error bound, so it stops when the remainder is below 1e-12
 * rather than after a fixed count.
 */
export function nctCdf(t: number, df: number, delta: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (delta === 0) return tCdf(t, df);
  // Past |δ| ≈ 37.6 the leading Poisson weight exp(−δ²/2) underflows and the
  // whole series is 0 for every t. R switches to Abramowitz & Stegun 26.7.10
  // there (the same threshold, δ² > 2·ln2·1021); so does this.
  if (delta * delta > 2 * Math.LN2 * 1021) {
    const s = 1 + (t * t) / (2 * df);
    return normalCdf((t * (1 - 1 / (4 * df)) - delta) / Math.sqrt(s));
  }
  let tt = t;
  let del = delta;
  let negdel = false;
  if (t < 0) {
    tt = -t;
    del = -delta;
    negdel = true;
  }
  let x = (tt * tt) / (tt * tt + df);
  let tnc = 0;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda);
    let q = Math.sqrt(2 / Math.PI) * p * del;
    let s = 0.5 - p;
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda);
    let a = 0.5;
    const b = 0.5 * df;
    const rxb = Math.pow(1 - x, b);
    const albeta = Math.log(Math.sqrt(Math.PI)) + gammaln(b) - gammaln(0.5 + b);
    let xodd = incompleteBeta(x, a, b);
    let godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta);
    tnc = b * x;
    let xeven = tnc < Number.EPSILON ? tnc : 1 - rxb;
    let geven = tnc * rxb;
    tnc = p * xodd + q * xeven;
    for (let it = 1; it <= 1000; it++) {
      a += 1;
      xodd -= godd;
      xeven -= geven;
      godd *= (x * (a + b - 1)) / a;
      geven *= (x * (a + b - 0.5)) / (a + 0.5);
      p *= lambda / (2 * it);
      q *= lambda / (2 * it + 1);
      tnc += p * xodd + q * xeven;
      s -= p;
      if (s <= 0 && it > 1) break;
      const errbd = 2 * s * (xodd - godd);
      if (Math.abs(errbd) < 1e-12) break;
    }
  }
  tnc += normalCdf(-del);
  tnc = Math.min(Math.max(tnc, 0), 1);
  return negdel ? 1 - tnc : tnc;
}

/**
 * Non-central F CDF, P(F ≤ f | df1, df2, λ): the Poisson(λ/2) mixture of
 * central beta terms, summed until the weights are exhausted.
 */
export function ncfCdf(f: number, df1: number, df2: number, lambda: number): number {
  if (f <= 0) return 0;
  if (lambda === 0) return fCdf(f, df1, df2);
  const x = (df1 * f) / (df1 * f + df2);
  const half = lambda / 2;
  // Start the series at the mode of the Poisson weights for numerical range,
  // walking outward in both directions.
  const j0 = Math.floor(half);
  const logw = (j: number) => -half + j * Math.log(half) - gammaln(j + 1);
  let total = 0;
  for (let dir = 0; dir < 2; dir++) {
    for (let k = 0; k < 10000; k++) {
      const j = dir === 0 ? j0 + k : j0 - 1 - k;
      if (j < 0) break;
      const w = Math.exp(logw(j));
      const term = w * incompleteBeta(x, df1 / 2 + j, df2 / 2);
      total += term;
      if (w < 1e-16 && k > 0) break;
    }
  }
  return Math.min(Math.max(total, 0), 1);
}

export type TTestDesign = "two-sample" | "paired" | "one-sample";

export interface TPowerInput {
  design: TTestDesign;
  /** Cohen's d (paired: d_z on the differences). */
  d: number;
  /** Per group (two-sample) or number of pairs / subjects. */
  n: number;
  alpha: number;
  tails: 1 | 2;
}

/** Power of a t-test at the given n. */
export function powerT(inp: TPowerInput): number {
  const { design, d, n, alpha, tails } = inp;
  if (!(n >= 2) || !(alpha > 0 && alpha < 1) || !Number.isFinite(d)) return NaN;
  const df = design === "two-sample" ? 2 * n - 2 : n - 1;
  if (df < 1) return NaN;
  const ncp = design === "two-sample" ? Math.abs(d) * Math.sqrt(n / 2) : Math.abs(d) * Math.sqrt(n);
  if (tails === 1) {
    const crit = tUpper(alpha, df);
    return 1 - nctCdf(crit, df, ncp);
  }
  const crit = tUpper(alpha / 2, df);
  return 1 - nctCdf(crit, df, ncp) + nctCdf(-crit, df, ncp);
}

export interface AnovaPowerInput {
  /** Number of groups. */
  k: number;
  /** Cohen's f (0.10 small, 0.25 medium, 0.40 large). */
  f: number;
  /** Per group. */
  n: number;
  alpha: number;
}

/** Power of a one-way ANOVA with k equal groups of n. */
export function powerAnova(inp: AnovaPowerInput): number {
  const { k, f, n, alpha } = inp;
  if (!(k >= 2) || !(n >= 2) || !(alpha > 0 && alpha < 1) || !Number.isFinite(f)) return NaN;
  const df1 = k - 1;
  const df2 = k * (n - 1);
  const lambda = f * f * k * n;
  const crit = fUpper(alpha, df1, df2);
  return 1 - ncfCdf(crit, df1, df2, lambda);
}

export interface ProportionsPowerInput {
  p1: number;
  p2: number;
  /** Per group. */
  n: number;
  alpha: number;
  tails: 1 | 2;
}

/**
 * Power of the two-sample z-test for proportions (pooled variance under the
 * null, unpooled under the alternative, no continuity correction — the
 * textbook formula and G*Power's "z test, two independent proportions").
 */
export function powerProportions(inp: ProportionsPowerInput): number {
  const { p1, p2, n, alpha, tails } = inp;
  if (!(n >= 2) || !(alpha > 0 && alpha < 1)) return NaN;
  if (!(p1 > 0 && p1 < 1 && p2 > 0 && p2 < 1)) return NaN;
  const pbar = (p1 + p2) / 2;
  const se0 = Math.sqrt((2 * pbar * (1 - pbar)) / n);
  const se1 = Math.sqrt((p1 * (1 - p1)) / n + (p2 * (1 - p2)) / n);
  const diff = Math.abs(p1 - p2);
  const z = probit(1 - alpha / tails);
  const upper = normalCdf((diff - z * se0) / se1);
  if (tails === 1) return upper;
  const lower = normalCdf((-diff - z * se0) / se1);
  return upper + lower;
}

/**
 * The smallest n (per group) reaching `target` power. Power is monotone in n
 * for every design here, so bracket geometrically then bisect. Returns null
 * if even the cap cannot reach it (an effect of zero, or a target above
 * what the test can deliver).
 */
export function sampleSizeFor(power: (n: number) => number, target: number, cap = 1_000_000): number | null {
  if (!(target > 0 && target < 1)) return null;
  let lo = 2;
  const p2 = power(lo);
  if (!Number.isFinite(p2)) return null; // a power function that cannot answer never "finds" n = 4
  if (p2 >= target) return lo;
  // The cap itself is the last candidate, not the first excluded one: the
  // first version returned null the moment the bracket would pass the cap,
  // so nothing above 2^19 was ever found although the cap said 10^6.
  if (power(cap) < target) return null;
  let hi = 4;
  while (hi < cap) {
    const p = power(hi);
    if (!Number.isFinite(p)) return null; // a NaN inside the bracket is not "found"
    if (p >= target) break;
    lo = hi;
    hi = Math.min(hi * 2, cap);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const p = power(mid);
    if (!Number.isFinite(p)) return null;
    if (p >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Cohen's conventional labels, for the output's own words. */
export function effectLabel(kind: "d" | "f", v: number): string {
  const a = Math.abs(v);
  const cut = kind === "d" ? [0.2, 0.5, 0.8] : [0.1, 0.25, 0.4];
  if (a < cut[0]) return "below Cohen's 'small'";
  if (a < cut[1]) return "small";
  if (a < cut[2]) return "medium";
  return "large";
}
