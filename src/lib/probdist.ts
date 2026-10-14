/**
 * Probability distributions — the kernel behind the probability verbs
 * (probability.ts). One record per distribution: parameter validation,
 * pmf/pdf, cdf, quantile, moments, mode, median, mgf.
 *
 * Numerics are REUSED, not re-derived: erf/normalCdf and the regularised
 * incomplete gamma (stats2.ts), incompleteBeta (stats.ts), tCdf/fCdf and the
 * bisection quantile (power.ts), probit (regression.ts), BigInt binomial
 * coefficients (combinatorics.ts) and the exact rationals of cas.ts. Every
 * discrete distribution with rational parameters has an EXACT path (the
 * answer is a fraction) beside the float path (the cross-check).
 *
 * Honest limits, stated by the callers: numeric CDFs to ~1e-12 absolute;
 * numeric quantiles to 1e-9 (bisection); exact fractions only while they
 * print short; n ≤ CAPS.BINOMIAL_N for the exact binomial.
 */
import { erf, normalCdf, gammp, gammq } from "./stats2";
import { incompleteBeta, gammaln } from "./stats";
import { tCdf, fCdf, quantile as bisect } from "./power";
import { probit } from "./regression";
import { binomial as bigBinomial, CAPS } from "./combinatorics";
import { Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratToNumber, parseRatLiteral, RAT_ONE, RAT_ZERO, ratSign } from "./cas";
import { fmtRat } from "./geometry";

export type DistName =
  | "binomial"
  | "bernoulli"
  | "poisson"
  | "geometric"
  | "negbinomial"
  | "hypergeometric"
  | "duniform"
  | "normal"
  | "t"
  | "chisq"
  | "f"
  | "exponential"
  | "uniform"
  | "gamma"
  | "beta";

export interface Dist {
  name: DistName;
  /** "binomial(n = 10, p = 2/5)" — the parameter line. */
  label: string;
  discrete: boolean;
  /** Support: integers in [lo, hi] for discrete; the real interval for continuous. */
  lo: number;
  hi: number;
  pmf?: (k: number) => number;
  pmfExact?: (k: number) => Rat | null;
  pdf?: (x: number) => number;
  /** P(X ≤ x). */
  cdf: (x: number) => number;
  /** Exact P(X ≤ k) for a discrete distribution with rational parameters. */
  cdfExact?: (k: number) => Rat | null;
  /** The p-quantile (smallest x with P(X ≤ x) ≥ p for discrete). */
  quantile: (p: number) => number;
  /** A closed form for the quantile in Solve grammar, when one exists (uniform, exponential). */
  quantileExact?: (p: Rat) => string | null;
  mean: number;
  meanExact?: Rat | string;
  variance: number;
  varExact?: Rat | string;
  mode?: string;
  median?: number;
  medianExact?: string;
  /** Moment generating function in t (Solve grammar) and where it exists. */
  mgf?: { expr: string; where: string };
  /** Notes the caller must show (conventions). */
  notes: string[];
}

export class DistError extends Error {}

// ---------------------------------------------------------------------------
// Rational helpers
// ---------------------------------------------------------------------------

export function ratPow(a: Rat, k: number): Rat {
  if (!Number.isInteger(k) || k < 0) throw new DistError("integer power expected");
  let r = RAT_ONE;
  let base = a;
  let e = k;
  while (e > 0) {
    if (e & 1) r = ratMul(r, base);
    base = ratMul(base, base);
    e >>= 1;
  }
  return r;
}
export const ratOfBig = (n: bigint): Rat => ratMake(n, 1n);
/** A rational short enough to show as the answer (else the decimal is shown). */
export const ratShort = (r: Rat, max = 40): boolean => fmtRat(r).length <= max;
/** The exact rational a user typed, or null for an irrational/float-only parameter. */
export const ratOf = (s: string): Rat | null => parseRatLiteral(s.trim());

const inUnit = (p: Rat): boolean => ratSign(p) >= 0 && ratSign(ratSub(RAT_ONE, p)) >= 0;

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/** log of the binomial coefficient, for pmfs too large for BigInt. */
function logChoose(n: number, k: number): number {
  return gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
}

/** Bisection for a quantile on an unbounded support (normal, t). */
function quantileReal(cdf: (x: number) => number, p: number): number {
  let lo = -1;
  let hi = 1;
  let guard = 0;
  while (cdf(lo) > p && guard++ < 200) lo *= 2;
  guard = 0;
  while (cdf(hi) < p && guard++ < 200) hi *= 2;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(mid))) break;
  }
  return (lo + hi) / 2;
}

/**
 * erf to full double precision: Taylor series for |x| < 2.5 (converges in
 * ≤ 60 terms), the continued fraction for erfc beyond. stats2.erf is a 1e-7
 * Chebyshev fit — fine for p-values, not for a quantile claimed to 1e-15.
 */
export function erfPrecise(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : x < 0 ? -1 : NaN;
  const ax = Math.abs(x);
  if (ax < 2.5) {
    // erf(x) = (2/√π) Σ (−1)^n x^(2n+1) / (n! (2n+1))
    let term = ax;
    let sum = ax;
    const x2 = ax * ax;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    const v = (2 / Math.sqrt(Math.PI)) * sum;
    return x < 0 ? -v : v;
  }
  return x < 0 ? -(1 - erfcPrecise(ax)) : 1 - erfcPrecise(ax);
}
/** erfc(x) for x ≥ 2.5 by Lentz's continued fraction (relative error ~1e-16). */
function erfcPrecise(x: number): number {
  if (x > 27) return 0;
  // erfc(x) = exp(−x²)/√π · 1/(x + 1/2/(x + 1/(x + 3/2/(x + …))))
  const tiny = 1e-300;
  let fv = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 20000; n++) {
    const an = n / 2;
    D = x + an * D;
    D = Math.abs(D) < tiny ? tiny : D;
    C = x + an / C;
    C = Math.abs(C) < tiny ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    fv *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * fv);
}
/** Φ(z) to ~1e-16. */
export function normalCdfPrecise(z: number): number {
  if (z < -8) return 0.5 * erfcPrecise(-z / Math.SQRT2);
  if (z > 8) return 1 - 0.5 * erfcPrecise(z / Math.SQRT2);
  return 0.5 * (1 + erfPrecise(z / Math.SQRT2));
}

/** Normal quantile: Acklam's probit polished by Newton steps on the precise cdf (≈1e-15). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  let z = probit(p);
  for (let i = 0; i < 3; i++) {
    const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    if (pdf < 1e-300) break;
    const step = (normalCdfPrecise(z) - p) / pdf;
    z -= step;
    if (Math.abs(step) < 1e-16 * Math.max(1, Math.abs(z))) break;
  }
  return z;
}

/** Smallest integer k in [lo, hi] with cdf(k) ≥ p. */
function discreteQuantile(cdf: (k: number) => number, p: number, lo: number, hi: number): number {
  let a = lo;
  let b = Number.isFinite(hi) ? hi : lo + 1;
  if (!Number.isFinite(hi)) {
    let guard = 0;
    while (cdf(b) < p && guard++ < 60) b = lo + (b - lo) * 2 + 1;
  }
  while (a < b) {
    const mid = Math.floor((a + b) / 2);
    if (cdf(mid) < p) a = mid + 1;
    else b = mid;
  }
  return a;
}

/**
 * Tanh-sinh (double-exponential) quadrature on [a, b]: the nodes crowd
 * toward the endpoints exponentially, so an integrable endpoint singularity
 * (x^(−1/2) at 0 for the χ²(1) pdf) is integrated to ~1e-12 where Simpson's
 * rule misses by 1e-2. The independent cross-check for every continuous cdf.
 */
export function tanhSinh(f: (x: number) => number, a: number, b: number): number {
  if (!(b > a)) return 0;
  const c = (a + b) / 2;
  const hw = (b - a) / 2;
  let h = 1;
  let prev = NaN;
  let sum = 0;
  const g = (t: number): number => {
    const u = (Math.PI / 2) * Math.sinh(t);
    if (Math.abs(u) > 350) return 0; // weight underflows
    const e2 = Math.exp(2 * Math.abs(u));
    // distance from the NEAR endpoint, computed without cancellation
    const dist = (2 * hw) / (1 + e2);
    const xa = u >= 0 ? b - dist : a + dist;
    if (dist <= 0 || xa <= a || xa >= b) return 0;
    const sech2 = 4 / (e2 + 2 + 1 / e2);
    const w = (Math.PI / 2) * Math.cosh(t) * sech2;
    const v = f(xa);
    return Number.isFinite(v) ? v * w : 0;
  };
  for (let level = 0; level < 10; level++) {
    if (level === 0) {
      sum = g(0);
      for (let k = 1; k <= 6; k++) sum += g(k * h) + g(-k * h);
    } else {
      // halve h: the old nodes stay (their weight halves through h), the odd new ones are added
      h /= 2;
      let add = 0;
      for (let k = 1; k * h <= 6; k += 2) add += g(k * h) + g(-k * h);
      sum += add;
    }
    const est = sum * h * hw;
    if (level >= 3 && Math.abs(est - prev) <= 1e-13 * Math.max(1, Math.abs(est))) return est;
    prev = est;
  }
  return prev;
}

/** Simpson's rule, the independent cross-check for a continuous cdf. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  if (!(b > a)) return 0;
  const m = n % 2 ? n + 1 : n;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

const num = (r: Rat | null | undefined, fallback: number): number => (r ? ratToNumber(r) : fallback);

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export interface ParamSpec {
  /** The parameter as typed (so 0.4 can be 2/5 exactly). */
  text?: string;
  value: number;
}

const rat = (p: ParamSpec | undefined): Rat | null => (p && p.text !== undefined ? ratOf(p.text) : p ? parseRatLiteral(String(p.value)) : null);
const need = (p: ParamSpec | undefined, name: string): number => {
  if (!p || !Number.isFinite(p.value)) throw new DistError(`${name} is required (a finite number).`);
  return p.value;
};
const integer = (v: number, name: string, min = 0): number => {
  if (!Number.isInteger(v) || v < min) throw new DistError(`${name} must be an integer ≥ ${min} (got ${v}).`);
  return v;
};
const prob = (v: number, name: string): number => {
  if (!(v >= 0 && v <= 1)) throw new DistError(`${name} must be a probability in [0, 1] (got ${v}).`);
  return v;
};
const positive = (v: number, name: string): number => {
  if (!(v > 0)) throw new DistError(`${name} must be > 0 (got ${v}).`);
  return v;
};

const fmtP = (r: Rat | null, v: number): string => (r ? fmtRat(r) : String(v));

export function binomialDist(nS: ParamSpec, pS: ParamSpec): Dist {
  const n = integer(need(nS, "n"), "n");
  const p = prob(need(pS, "p"), "p");
  const pr = rat(pS);
  const q = pr ? ratSub(RAT_ONE, pr) : null;
  if (n > CAPS.BINOMIAL_N) throw new DistError(`n ≤ ${CAPS.BINOMIAL_N} for the exact binomial.`);
  const exactOk = !!pr && inUnit(pr);
  const pmf = (k: number): number => {
    if (!Number.isInteger(k) || k < 0 || k > n) return 0;
    if (p === 0) return k === 0 ? 1 : 0;
    if (p === 1) return k === n ? 1 : 0;
    return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  };
  const pmfExact = (k: number): Rat | null => {
    if (!exactOk || !Number.isInteger(k) || k < 0 || k > n) return exactOk && Number.isInteger(k) ? RAT_ZERO : null;
    return ratMul(ratOfBig(bigBinomial(n, k)), ratMul(ratPow(pr!, k), ratPow(q!, n - k)));
  };
  const cdf = (x: number): number => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    if (k >= n) return 1;
    // regularised incomplete beta: P(X ≤ k) = I_{1−p}(n−k, k+1)
    return incompleteBeta(1 - p, n - k, k + 1);
  };
  const cdfExact = (k: number): Rat | null => {
    if (!exactOk) return null;
    if (k < 0) return RAT_ZERO;
    if (k >= n) return RAT_ONE;
    let s = RAT_ZERO;
    for (let i = 0; i <= k; i++) s = ratAdd(s, pmfExact(i)!);
    return s;
  };
  const mean = n * p;
  const variance = n * p * (1 - p);
  // The tie pmf(m−1) = pmf(m) happens exactly when (n+1)p is an integer m —
  // tested on the RATIONAL (the float test missed 100·0.07 = 7.000000000000001).
  const np1 = pr ? ratMul(ratInt(n + 1), pr) : null;
  const tie = np1 ? np1.d === 1n : Number.isInteger((n + 1) * p);
  const modeK = tie ? (np1 ? Number(np1.n) : (n + 1) * p) : Math.floor((n + 1) * p);
  return {
    name: "binomial",
    label: `binomial(n = ${n}, p = ${fmtP(pr, p)})`,
    discrete: true,
    lo: 0,
    hi: n,
    pmf,
    pmfExact,
    cdf,
    cdfExact,
    quantile: (pq) => discreteQuantile(cdf, pq, 0, n),
    mean,
    meanExact: pr ? ratMul(ratInt(n), pr) : undefined,
    variance,
    varExact: pr ? ratMul(ratInt(n), ratMul(pr, q!)) : undefined,
    mode: tie && modeK >= 1 && modeK <= n ? `${modeK - 1} and ${modeK}` : String(Math.min(n, Math.max(0, modeK))),
    mgf: { expr: `(${fmtP(q, 1 - p)} + ${fmtP(pr, p)}*exp(t))^${n}`, where: "all t" },
    notes: [],
  };
}

export function poissonDist(lS: ParamSpec): Dist {
  const lam = positive(need(lS, "λ"), "λ");
  const lr = rat(lS);
  const pmf = (k: number): number => (Number.isInteger(k) && k >= 0 ? Math.exp(-lam + k * Math.log(lam) - gammaln(k + 1)) : 0);
  const cdf = (x: number): number => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    return gammq(k + 1, lam);
  };
  return {
    name: "poisson",
    label: `Poisson(λ = ${fmtP(lr, lam)})`,
    discrete: true,
    lo: 0,
    hi: Infinity,
    pmf,
    cdf,
    quantile: (p) => discreteQuantile(cdf, p, 0, Infinity),
    mean: lam,
    meanExact: lr ?? undefined,
    variance: lam,
    varExact: lr ?? undefined,
    mode: Number.isInteger(lam) ? `${lam - 1} and ${lam}` : String(Math.floor(lam)),
    mgf: { expr: `exp(${fmtP(lr, lam)}*(exp(t) - 1))`, where: "all t" },
    notes: [],
  };
}

/** Geometric: number of TRIALS to the first success by default (support 1, 2, …); `failures` → support 0, 1, …. */
export function geometricDist(pS: ParamSpec, failures = false): Dist {
  const p = prob(need(pS, "p"), "p");
  if (p === 0) throw new DistError("p must be > 0 for a geometric distribution (no success ever).");
  const pr = rat(pS);
  const q = pr ? ratSub(RAT_ONE, pr) : null;
  const shift = failures ? 0 : 1;
  const pmf = (k: number): number => (Number.isInteger(k) && k >= shift ? Math.pow(1 - p, k - shift) * p : 0);
  const pmfExact = (k: number): Rat | null => (!pr ? null : Number.isInteger(k) && k >= shift ? ratMul(ratPow(q!, k - shift), pr) : RAT_ZERO);
  const cdf = (x: number): number => {
    const k = Math.floor(x);
    if (k < shift) return 0;
    return 1 - Math.pow(1 - p, k - shift + 1);
  };
  const cdfExact = (k: number): Rat | null => (!pr ? null : k < shift ? RAT_ZERO : ratSub(RAT_ONE, ratPow(q!, k - shift + 1)));
  return {
    name: "geometric",
    label: `geometric(p = ${fmtP(pr, p)})`,
    discrete: true,
    lo: shift,
    hi: Infinity,
    pmf,
    pmfExact,
    cdf,
    cdfExact,
    quantile: (pq) => discreteQuantile(cdf, pq, shift, Infinity),
    mean: failures ? (1 - p) / p : 1 / p,
    meanExact: pr ? (failures ? ratDiv(q!, pr) : ratDiv(RAT_ONE, pr)) : undefined,
    variance: (1 - p) / (p * p),
    varExact: pr ? ratDiv(q!, ratMul(pr, pr)) : undefined,
    mode: String(shift),
    mgf: failures
      ? { expr: `${fmtP(pr, p)}/(1 - ${fmtP(q, 1 - p)}*exp(t))`, where: `t < ${pr ? `-ln(${fmtRat(q!)})` : (-Math.log(1 - p)).toPrecision(6)}` }
      : { expr: `${fmtP(pr, p)}*exp(t)/(1 - ${fmtP(q, 1 - p)}*exp(t))`, where: `t < ${pr ? `-ln(${fmtRat(q!)})` : (-Math.log(1 - p)).toPrecision(6)}` },
    notes: [
      failures
        ? "X = number of FAILURES before the first success (support 0, 1, 2, …)."
        : "X = number of TRIALS up to and including the first success (support 1, 2, 3, …). Write \"failures\" for the other convention.",
    ],
  };
}

/** Negative binomial: number of TRIALS to the r-th success (support r, r+1, …) by default; `failures` → failures before it (support 0, 1, …). */
export function negBinomialDist(rS: ParamSpec, pS: ParamSpec, failures = false): Dist {
  const r = integer(need(rS, "r"), "r", 1);
  const p = prob(need(pS, "p"), "p");
  if (p === 0) throw new DistError("p must be > 0.");
  const pr = rat(pS);
  const q = pr ? ratSub(RAT_ONE, pr) : null;
  const shift = failures ? 0 : r; // trials k ↔ failures k − r
  const pmf = (k: number): number => (Number.isInteger(k) && k >= shift ? Math.exp(logChoose(k - shift + r - 1, r - 1) + r * Math.log(p) + (k - shift) * Math.log(1 - p)) : 0);
  const pmfExact = (k: number): Rat | null => (!pr ? null : Number.isInteger(k) && k >= shift ? ratMul(ratOfBig(bigBinomial(k - shift + r - 1, r - 1)), ratMul(ratPow(pr, r), ratPow(q!, k - shift))) : RAT_ZERO);
  const cdf = (x: number): number => {
    const k = Math.floor(x);
    if (k < shift) return 0;
    // trials t = k − shift + r: P(T ≤ t) = P(at least r successes in t trials) = I_p(r, t − r + 1)
    return incompleteBeta(p, r, k - shift + 1);
  };
  const cdfExact = (k: number): Rat | null => {
    if (!pr) return null;
    if (k < shift) return RAT_ZERO;
    let s = RAT_ZERO;
    for (let i = shift; i <= k; i++) s = ratAdd(s, pmfExact(i)!);
    return s;
  };
  return {
    name: "negbinomial",
    label: `negative binomial(r = ${r}, p = ${fmtP(pr, p)})`,
    discrete: true,
    lo: shift,
    hi: Infinity,
    pmf,
    pmfExact,
    cdf,
    cdfExact,
    quantile: (pq) => discreteQuantile(cdf, pq, shift, Infinity),
    mean: failures ? (r * (1 - p)) / p : r / p,
    meanExact: pr ? (failures ? ratDiv(ratMul(ratInt(r), q!), pr) : ratDiv(ratInt(r), pr)) : undefined,
    variance: (r * (1 - p)) / (p * p),
    varExact: pr ? ratDiv(ratMul(ratInt(r), q!), ratMul(pr, pr)) : undefined,
    notes: [failures ? `X = number of FAILURES before the ${r}-th success (support 0, 1, 2, …).` : `X = number of TRIALS up to and including the ${r}-th success (support ${r}, ${r + 1}, …). Write "failures" for the other convention.`],
  };
}

export function hypergeometricDist(NS: ParamSpec, KS: ParamSpec, nS: ParamSpec): Dist {
  const N = integer(need(NS, "N"), "N", 1);
  const K = integer(need(KS, "K"), "K");
  const n = integer(need(nS, "n"), "n");
  if (K > N) throw new DistError(`K (successes in the population) cannot exceed N (got K = ${K}, N = ${N}).`);
  if (n > N) throw new DistError(`n (the draw) cannot exceed N (got n = ${n}, N = ${N}).`);
  if (N > CAPS.BINOMIAL_N) throw new DistError(`N ≤ ${CAPS.BINOMIAL_N} here.`);
  const lo = Math.max(0, n - (N - K));
  const hi = Math.min(n, K);
  const total = bigBinomial(N, n);
  const pmfExact = (k: number): Rat | null => (Number.isInteger(k) && k >= lo && k <= hi ? ratMake(bigBinomial(K, k) * bigBinomial(N - K, n - k), total) : RAT_ZERO);
  const pmf = (k: number): number => ratToNumber(pmfExact(k)!);
  const cdfExact = (k: number): Rat | null => {
    if (k < lo) return RAT_ZERO;
    if (k >= hi) return RAT_ONE;
    let s = RAT_ZERO;
    for (let i = lo; i <= k; i++) s = ratAdd(s, pmfExact(i)!);
    return s;
  };
  const cdf = (x: number): number => ratToNumber(cdfExact(Math.floor(x))!);
  const meanExact = ratMake(BigInt(n * K), BigInt(N));
  const varExact = N > 1 ? ratDiv(ratMake(BigInt(n * K * (N - K) * (N - n)), BigInt(N * N)), ratInt(N - 1)) : RAT_ZERO;
  return {
    name: "hypergeometric",
    label: `hypergeometric(N = ${N}, K = ${K}, n = ${n})`,
    discrete: true,
    lo,
    hi,
    pmf,
    pmfExact,
    cdf,
    cdfExact,
    quantile: (p) => discreteQuantile(cdf, p, lo, hi),
    mean: ratToNumber(meanExact),
    meanExact,
    variance: ratToNumber(varExact),
    varExact,
    notes: [`N = population, K = successes in it, n = draws without replacement; X = successes drawn (support ${lo}..${hi}).`],
  };
}

export function discreteUniformDist(aS: ParamSpec, bS: ParamSpec): Dist {
  const a = integer(need(aS, "a"), "a", -1e9);
  const b = integer(need(bS, "b"), "b", -1e9);
  if (b < a) throw new DistError("b must be ≥ a.");
  const m = b - a + 1;
  const pmfExact = (k: number): Rat | null => (Number.isInteger(k) && k >= a && k <= b ? ratMake(1n, BigInt(m)) : RAT_ZERO);
  const cdfExact = (k: number): Rat | null => (k < a ? RAT_ZERO : k >= b ? RAT_ONE : ratMake(BigInt(k - a + 1), BigInt(m)));
  const meanExact = ratMake(BigInt(a + b), 2n);
  const varExact = ratMake(BigInt(m * m - 1), 12n);
  return {
    name: "duniform",
    label: `discrete uniform on {${a}, …, ${b}}`,
    discrete: true,
    lo: a,
    hi: b,
    pmf: (k) => ratToNumber(pmfExact(k)!),
    pmfExact,
    cdf: (x) => ratToNumber(cdfExact(Math.floor(x))!),
    cdfExact,
    quantile: (p) => discreteQuantile((k) => ratToNumber(cdfExact(k)!), p, a, b),
    mean: ratToNumber(meanExact),
    meanExact,
    variance: ratToNumber(varExact),
    varExact,
    notes: [],
  };
}

export function normalDist(muS: ParamSpec, sdS: ParamSpec): Dist {
  const mu = need(muS, "mean");
  const sd = positive(need(sdS, "sd"), "sd");
  const mur = rat(muS);
  const sdr = rat(sdS);
  const pdf = (x: number): number => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  const cdf = (x: number): number => normalCdfPrecise((x - mu) / sd);
  return {
    name: "normal",
    label: `normal(mean = ${fmtP(mur, mu)}, sd = ${fmtP(sdr, sd)})`,
    discrete: false,
    lo: -Infinity,
    hi: Infinity,
    pdf,
    cdf,
    quantile: (p) => mu + sd * normalQuantile(p),
    mean: mu,
    meanExact: mur ?? undefined,
    variance: sd * sd,
    varExact: sdr ? ratMul(sdr, sdr) : undefined,
    mode: fmtP(mur, mu),
    median: mu,
    medianExact: fmtP(mur, mu),
    mgf: { expr: `exp(${fmtP(mur, mu)}*t + ${fmtP(sdr ? ratMul(sdr, sdr) : null, sd * sd)}*t^2/2)`, where: "all t" },
    notes: [],
  };
}

export function tDist(dfS: ParamSpec): Dist {
  const df = positive(need(dfS, "df"), "df");
  const c = Math.exp(gammaln((df + 1) / 2) - gammaln(df / 2)) / Math.sqrt(df * Math.PI);
  const pdf = (x: number): number => c * Math.pow(1 + (x * x) / df, -(df + 1) / 2);
  const cdf = (x: number): number => tCdf(x, df);
  return {
    name: "t",
    label: `Student t(df = ${df})`,
    discrete: false,
    lo: -Infinity,
    hi: Infinity,
    pdf,
    cdf,
    quantile: (p) => (p === 0.5 ? 0 : quantileReal(cdf, p)),
    mean: df > 1 ? 0 : NaN,
    meanExact: df > 1 ? RAT_ZERO : "undefined (df ≤ 1)",
    variance: df > 2 ? df / (df - 2) : df > 1 ? Infinity : NaN,
    varExact: df > 2 ? (Number.isInteger(df) ? ratMake(BigInt(df), BigInt(df - 2)) : undefined) : df > 1 ? "infinite (1 < df ≤ 2)" : "undefined (df ≤ 1)",
    mode: "0",
    median: 0,
    medianExact: "0",
    notes: ["The t distribution has no moment generating function."],
  };
}

export function chiSquareDist(dfS: ParamSpec): Dist {
  const df = positive(need(dfS, "df"), "df");
  const pdf = (x: number): number => (x <= 0 ? 0 : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - gammaln(df / 2)));
  const cdf = (x: number): number => (x <= 0 ? 0 : gammp(df / 2, x / 2));
  return {
    name: "chisq",
    label: `chi-square(df = ${df})`,
    discrete: false,
    lo: 0,
    hi: Infinity,
    pdf,
    cdf,
    quantile: (p) => bisect(cdf, p, 0, Math.max(1, df)),
    mean: df,
    meanExact: Number.isInteger(df) ? ratInt(df) : undefined,
    variance: 2 * df,
    varExact: Number.isInteger(df) ? ratInt(2 * df) : undefined,
    mode: String(Math.max(df - 2, 0)),
    mgf: { expr: `(1 - 2*t)^(-${Number.isInteger(df) ? `${df}/2` : df / 2})`, where: "t < 1/2" },
    notes: [],
  };
}

export function fDist(d1S: ParamSpec, d2S: ParamSpec): Dist {
  const d1 = positive(need(d1S, "df1"), "df1");
  const d2 = positive(need(d2S, "df2"), "df2");
  const logB = gammaln(d1 / 2) + gammaln(d2 / 2) - gammaln((d1 + d2) / 2);
  const pdf = (x: number): number => (x <= 0 ? 0 : Math.exp((d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(x) - ((d1 + d2) / 2) * Math.log(1 + (d1 * x) / d2) - logB));
  const cdf = (x: number): number => (x <= 0 ? 0 : fCdf(x, d1, d2));
  return {
    name: "f",
    label: `F(df1 = ${d1}, df2 = ${d2})`,
    discrete: false,
    lo: 0,
    hi: Infinity,
    pdf,
    cdf,
    quantile: (p) => bisect(cdf, p, 0, 2),
    mean: d2 > 2 ? d2 / (d2 - 2) : NaN,
    meanExact: d2 > 2 ? (Number.isInteger(d2) ? ratMake(BigInt(d2), BigInt(d2 - 2)) : undefined) : "undefined (df2 ≤ 2)",
    variance: d2 > 4 ? (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) ** 2 * (d2 - 4)) : NaN,
    varExact: d2 > 4 ? undefined : "undefined (df2 ≤ 4)",
    mode: d1 > 2 ? `≈ ${sig6(((d1 - 2) / d1) * (d2 / (d2 + 2)))}` : "0 (df1 ≤ 2)",
    notes: ["The F distribution has no moment generating function."],
  };
}

export function exponentialDist(lS: ParamSpec): Dist {
  const lam = positive(need(lS, "rate"), "rate λ");
  const lr = rat(lS);
  const pdf = (x: number): number => (x < 0 ? 0 : lam * Math.exp(-lam * x));
  const cdf = (x: number): number => (x <= 0 ? 0 : 1 - Math.exp(-lam * x));
  const L0 = fmtP(lr, lam);
  const L = /[/]/.test(L0) ? `(${L0})` : L0;
  return {
    name: "exponential",
    label: `exponential(rate λ = ${L0})`,
    discrete: false,
    lo: 0,
    hi: Infinity,
    pdf,
    cdf,
    quantile: (p) => (p >= 1 ? Infinity : -Math.log(1 - p) / lam),
    quantileExact: (p) => `-ln(${fmtRat(ratSub(RAT_ONE, p))})/${L}`,
    mean: 1 / lam,
    meanExact: lr ? ratDiv(RAT_ONE, lr) : undefined,
    variance: 1 / (lam * lam),
    varExact: lr ? ratDiv(RAT_ONE, ratMul(lr, lr)) : undefined,
    mode: "0",
    median: Math.LN2 / lam,
    medianExact: `ln(2)/${L}`,
    mgf: { expr: `${L}/(${L} - t)`, where: `t < ${L}` },
    notes: ["Parametrised by the RATE λ (mean 1/λ). Write \"mean 2\" for the scale form."],
  };
}

export function uniformDist(aS: ParamSpec, bS: ParamSpec): Dist {
  const a = need(aS, "a");
  const b = need(bS, "b");
  if (!(b > a)) throw new DistError("b must be > a for a uniform distribution.");
  const ar = rat(aS);
  const br = rat(bS);
  const w = b - a;
  const wr = ar && br ? ratSub(br, ar) : null;
  const pdf = (x: number): number => (x < a || x > b ? 0 : 1 / w);
  const cdf = (x: number): number => (x <= a ? 0 : x >= b ? 1 : (x - a) / w);
  const A = fmtP(ar, a);
  const B = fmtP(br, b);
  return {
    name: "uniform",
    label: `uniform(${A}, ${B})`,
    discrete: false,
    lo: a,
    hi: b,
    pdf,
    cdf,
    quantile: (p) => a + p * w,
    quantileExact: (p) => (ar && wr ? fmtRat(ratAdd(ar, ratMul(p, wr))) : null),
    mean: (a + b) / 2,
    meanExact: ar && br ? ratDiv(ratAdd(ar, br), ratInt(2)) : undefined,
    variance: (w * w) / 12,
    varExact: wr ? ratDiv(ratMul(wr, wr), ratInt(12)) : undefined,
    mode: `every point of [${A}, ${B}] equally`,
    median: (a + b) / 2,
    medianExact: ar && br ? fmtRat(ratDiv(ratAdd(ar, br), ratInt(2))) : undefined,
    mgf: { expr: `(exp(${B}*t) - ${a === 0 ? "1" : `exp(${A}*t)`})/(${fmtP(wr, w)}*t)`, where: "t ≠ 0 (and 1 at t = 0)" },
    notes: [],
  };
}

/** Gamma with SHAPE k and RATE β (mean k/β); `scale` θ = 1/β accepted by the caller. */
export function gammaDist(kS: ParamSpec, rateS: ParamSpec): Dist {
  const k = positive(need(kS, "shape"), "shape");
  const beta = positive(need(rateS, "rate"), "rate");
  const kr = rat(kS);
  const br = rat(rateS);
  const pdf = (x: number): number => (x <= 0 ? 0 : Math.exp(k * Math.log(beta) + (k - 1) * Math.log(x) - beta * x - gammaln(k)));
  const cdf = (x: number): number => (x <= 0 ? 0 : gammp(k, beta * x));
  const K = fmtP(kr, k);
  const Bt = fmtP(br, beta);
  return {
    name: "gamma",
    label: `gamma(shape = ${K}, rate = ${Bt})`,
    discrete: false,
    lo: 0,
    hi: Infinity,
    pdf,
    cdf,
    quantile: (p) => bisect(cdf, p, 0, Math.max(1, k / beta)),
    mean: k / beta,
    meanExact: kr && br ? ratDiv(kr, br) : undefined,
    variance: k / (beta * beta),
    varExact: kr && br ? ratDiv(kr, ratMul(br, br)) : undefined,
    mode: k >= 1 ? (kr && br ? fmtRat(ratDiv(ratSub(kr, RAT_ONE), br)) : String((k - 1) / beta)) : "0 (shape < 1)",
    mgf: { expr: `(1 - t/${Bt})^(-${K})`, where: `t < ${Bt}` },
    notes: ["Parametrised by shape k and RATE β (mean k/β). Write \"scale\" for θ = 1/β."],
  };
}

export function betaDist(aS: ParamSpec, bS: ParamSpec): Dist {
  const a = positive(need(aS, "α"), "α");
  const b = positive(need(bS, "β"), "β");
  const ar = rat(aS);
  const br = rat(bS);
  const logB = gammaln(a) + gammaln(b) - gammaln(a + b);
  const pdf = (x: number): number => (x <= 0 || x >= 1 ? (x === 0 && a === 1 ? b : x === 1 && b === 1 ? a : 0) : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logB));
  const cdf = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : incompleteBeta(x, a, b));
  const sum = ar && br ? ratAdd(ar, br) : null;
  return {
    name: "beta",
    label: `beta(α = ${fmtP(ar, a)}, β = ${fmtP(br, b)})`,
    discrete: false,
    lo: 0,
    hi: 1,
    pdf,
    cdf,
    quantile: (p) => bisect(cdf, p, 0, 1),
    mean: a / (a + b),
    meanExact: ar && sum ? ratDiv(ar, sum) : undefined,
    variance: (a * b) / ((a + b) ** 2 * (a + b + 1)),
    varExact: ar && br && sum ? ratDiv(ratMul(ar, br), ratMul(ratMul(sum, sum), ratAdd(sum, RAT_ONE))) : undefined,
    mode:
      a > 1 && b > 1
        ? ar && br
          ? fmtRat(ratDiv(ratSub(ar, RAT_ONE), ratSub(ratAdd(ar, br), ratInt(2))))
          : String((a - 1) / (a + b - 2))
        : a <= 1 && b <= 1 && a === 1 && b === 1
        ? "every point of [0, 1] equally"
        : a < 1 && b < 1
        ? "0 and 1 (U-shaped)"
        : a <= 1
        ? "0"
        : "1",
    notes: [],
  };
}

/** Standard normal shorthand. */
export const standardNormal = (): Dist => normalDist({ value: 0, text: "0" }, { value: 1, text: "1" });

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type Op = "=" | "<" | "<=" | ">" | ">=" | "between" | "betweenIncl";

export interface QueryResult {
  value: number;
  exact: Rat | null;
  /** A one-line formula in Solve grammar (re-parses), or null. */
  formula: string | null;
  /** Prose description of how it was computed. */
  how: string;
  /** The independent cross-check (complement / Simpson / exact-vs-float). */
  check: string;
  /** For drawing: the k's or interval covered. */
  region: { lo: number; hi: number };
}

export function query(d: Dist, op: Op, a: number, b?: number): QueryResult {
  if (d.discrete) return discreteQuery(d, op, a, b);
  return continuousQuery(d, op, a, b);
}

const clip = (d: Dist, k: number): number => Math.min(Math.max(k, d.lo), d.hi);

function discreteQuery(d: Dist, op: Op, a: number, b?: number): QueryResult {
  const cdfE = d.cdfExact;
  const pmfE = d.pmfExact;
  const exactRange = (lo: number, hi: number): Rat | null => {
    if (!cdfE) return null;
    const upper = cdfE(hi);
    const lower = lo - 1 < d.lo ? RAT_ZERO : cdfE(lo - 1);
    return upper && lower ? ratSub(upper, lower) : null;
  };
  const floatRange = (lo: number, hi: number): number => d.cdf(hi) - (lo - 1 < d.lo ? 0 : d.cdf(lo - 1));
  let lo: number;
  let hi: number;
  switch (op) {
    case "=":
      if (!Number.isInteger(a)) return { value: 0, exact: RAT_ZERO, formula: "0", how: `${a} is not in the support (integers), so P(X = ${a}) = 0.`, check: "—", region: { lo: a, hi: a } };
      lo = hi = a;
      break;
    case "<":
      lo = d.lo;
      hi = Math.ceil(a) - 1;
      break;
    case "<=":
      lo = d.lo;
      hi = Math.floor(a);
      break;
    case ">":
      lo = Math.floor(a) + 1;
      hi = d.hi;
      break;
    case ">=":
      lo = Math.ceil(a);
      hi = d.hi;
      break;
    case "between":
      lo = Math.floor(a) + 1;
      hi = Math.ceil(b!) - 1;
      break;
    case "betweenIncl":
      lo = Math.ceil(a);
      hi = Math.floor(b!);
      break;
  }
  if (hi < lo || hi < d.lo || lo > d.hi) {
    return { value: 0, exact: RAT_ZERO, formula: "0", how: "the event contains no point of the support.", check: "—", region: { lo, hi } };
  }
  lo = clip(d, lo);
  hi = clip(d, hi);
  let exact: Rat | null = null;
  let value: number;
  let how: string;
  let formula: string | null = null;
  // Exact BigInt sums are quadratic in the size of the numbers: a 2001-term
  // sum over 5^10000 once ran for 90 s. Exact sums are kept for short ranges
  // of small distributions; one pmf value is always exact.
  const exactSumOk = cdfE && Number.isFinite(hi) && hi - lo <= 1000 && (Number.isFinite(d.hi) ? d.hi - d.lo <= 600 : true);
  const finiteHi = Number.isFinite(hi);
  if (op === "=") {
    exact = pmfE ? pmfE(lo) : null;
    value = exact ? ratToNumber(exact) : d.pmf!(lo);
    how = `the pmf at ${lo}.`;
  } else if (finiteHi) {
    exact = exactSumOk ? exactRange(lo, hi) : null;
    value = exact ? ratToNumber(exact) : floatRange(lo, hi);
    how = lo === d.lo ? `the cdf F(${hi}) = Σ pmf(k) for k = ${lo}..${hi}.` : hi === d.hi ? `1 − F(${lo - 1}) (complement of P(X ≤ ${lo - 1})).` : `F(${hi}) − F(${lo - 1}).`;
  } else {
    // infinite upper tail
    const lower = lo - 1 < d.lo ? RAT_ZERO : cdfE && lo - d.lo <= 600 ? cdfE(lo - 1) : null;
    exact = lower ? ratSub(RAT_ONE, lower) : null;
    value = exact ? ratToNumber(exact) : 1 - (lo - 1 < d.lo ? 0 : d.cdf(lo - 1));
    how = `1 − F(${lo - 1}) (complement of P(X ≤ ${lo - 1})).`;
  }
  // Independent cross-check: a floating-point sum of the pmf over the region
  // (or over its complement, whichever is shorter), capped at MAX_SUM terms —
  // an uncapped loop over a user-chosen k once ran for two minutes.
  const MAX_SUM = 2_000_000;
  let check: string;
  const regionLen = finiteHi ? hi - lo + 1 : Infinity;
  const belowLen = lo - d.lo;
  const aboveLen = !finiteHi ? 0 : Number.isFinite(d.hi) ? d.hi - hi : Infinity;
  if (!d.pmf) check = "—";
  else if (regionLen <= MAX_SUM) {
    let s = 0;
    for (let k = lo; k <= hi; k++) s += d.pmf(k);
    const diff = Math.abs(s - value);
    if (diff > 1e-9 * Math.max(1, value) + 1e-12) throw new DistError(`cross-check FAILED: Σ pmf over ${lo}..${hi} = ${s} but the cdf route gave ${value}.`);
    check = `Σ pmf(k) over k = ${lo}..${hi} in floating point agrees to ${diff < 1e-15 ? "machine precision" : diff.toExponential(1)}.`;
  } else if (belowLen + Math.min(aboveLen, MAX_SUM) <= MAX_SUM) {
    let s = 0;
    for (let k = d.lo; k < lo; k++) s += d.pmf(k);
    if (aboveLen > 0 && Number.isFinite(aboveLen)) for (let k = hi + 1; k <= d.hi; k++) s += d.pmf(k);
    const diff = Math.abs(1 - s - value);
    if (diff > 1e-9 * Math.max(1, value) + 1e-12) throw new DistError(`cross-check FAILED: 1 − Σ pmf outside ${lo}..${hi} = ${1 - s} but the cdf route gave ${value}.`);
    check = `1 − Σ pmf(k) outside k = ${lo}..${hi} in floating point agrees to ${diff < 1e-15 ? "machine precision" : diff.toExponential(1)}.`;
  } else {
    throw new DistError(`the range ${lo}..${finiteHi ? hi : "∞"} is too wide for the independent cross-check (a pmf sum of more than ${MAX_SUM.toLocaleString()} terms) — withheld rather than shown unverified. Ask about a narrower range, or use the normal approximation verb.`);
  }
  if (op === "=" && exact && d.name === "binomial") formula = null; // the caller writes C(n,k) p^k q^(n−k) itself
  return { value, exact, formula, how, check, region: { lo, hi } };
}

function continuousQuery(d: Dist, op: Op, a: number, b?: number): QueryResult {
  if (op === "=") throw new DistError(`P(X = ${a}) is 0 for a continuous distribution — did you mean P(X ≤ ${a}) or P(X ≥ ${a})?`);
  let lo: number;
  let hi: number;
  switch (op) {
    case "<":
    case "<=":
      lo = -Infinity;
      hi = a;
      break;
    case ">":
    case ">=":
      lo = a;
      hi = Infinity;
      break;
    default:
      lo = Math.min(a, b!);
      hi = Math.max(a, b!);
  }
  const F = (x: number): number => (x === -Infinity ? 0 : x === Infinity ? 1 : d.cdf(x));
  const value = F(hi) - F(lo);
  const how = lo === -Infinity ? `the cdf F(${a}).` : hi === Infinity ? `1 − F(${a}).` : `F(${hi}) − F(${lo}).`;
  // Simpson over the pdf on the (clipped) interval — shares no code with the cdf.
  const A = Math.max(lo, Number.isFinite(d.lo) ? d.lo : Number.isFinite(lo) ? lo : d.quantile(1e-12));
  const B = Math.min(hi, Number.isFinite(d.hi) ? d.hi : Number.isFinite(hi) ? hi : d.quantile(1 - 1e-12));
  const s = tanhSinh(d.pdf!, A, B);
  const diff = Math.abs(s - value);
  if (diff > 1e-7 * Math.max(1, value) + 1e-10) throw new DistError(`cross-check FAILED: tanh-sinh quadrature over the pdf gave ${s} but the cdf gave ${value}.`);
  return { value, exact: null, formula: null, how, check: `tanh-sinh quadrature over the pdf on [${A.toPrecision(6)}, ${B.toPrecision(6)}] agrees to ${diff.toExponential(1)}.`, region: { lo, hi } };
}

/** Six-significant-figure text. */
export const sig6 = (x: number): string => {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const s = Number(x.toPrecision(6));
  return String(s);
};

/** Φ(z) text for the normal query. */

export { erf, normalCdf };
