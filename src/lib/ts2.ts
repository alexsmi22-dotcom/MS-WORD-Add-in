/**
 * Release F2 item #10, Time series II — the engines behind ts2StatCalcs.ts:
 *  - GARCH(1,1), GJR-GARCH(1,1,1) and EGARCH(1,1,1) by maximum likelihood, normal or Student-t errors, constant or
 *    zero mean, with arch 8.0's conventions copied exactly (backcast, variance bounds, parameter bounds and
 *    constraints, starting grid) and its robust (Bollerslev–Wooldridge) covariance formula;
 *  - VAR(p) with a constant: statsmodels 0.15 select_order, OLS fit, Granger F tests, orthogonalised impulse responses
 *    with Lütkepohl's asymptotic standard errors (statsmodels IRAnalysis._orth_cov), FEVD;
 *  - Engle–Granger (statsmodels coint) with MacKinnon's N-variable p-values and critical values, and the Johansen
 *    trace / maximum-eigenvalue tests (statsmodels coint_johansen) with the Osterwald-Lenum critical values.
 *
 * Pure numerics, no DOM. scripts/ts2-oracle.py pins every number against arch / statsmodels.
 */
import { eigenSymmetric, eigenvaluesGeneral, inverse } from "./linalg";
import { normalCdfPrecise } from "./probdist";
import { incompleteBeta } from "./stats";
import { adfTest } from "./tsDiag";

export type Refusal = { ok: false; reason: string };
type M = number[][];

// ---------------------------------------------------------------- small dense helpers

const zeros = (r: number, c: number): M => Array.from({ length: r }, () => new Array<number>(c).fill(0));
const eye = (n: number): M => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

function mul(a: M, b: M): M {
  const r = a.length;
  const k = b.length;
  const c = b[0]?.length ?? 0;
  const out = zeros(r, c);
  for (let i = 0; i < r; i++) {
    const ai = a[i];
    const oi = out[i];
    for (let t = 0; t < k; t++) {
      const v = ai[t];
      if (v === 0) continue;
      const bt = b[t];
      for (let j = 0; j < c; j++) oi[j] += v * bt[j];
    }
  }
  return out;
}

const tr = (a: M): M => (a.length ? a[0].map((_, j) => a.map((row) => row[j])) : []);

function kron(a: M, b: M): M {
  const ar = a.length;
  const ac = a[0].length;
  const br = b.length;
  const bc = b[0].length;
  const out = zeros(ar * br, ac * bc);
  for (let i = 0; i < ar; i++)
    for (let j = 0; j < ac; j++) {
      const v = a[i][j];
      if (v === 0) continue;
      for (let k = 0; k < br; k++) for (let l = 0; l < bc; l++) out[i * br + k][j * bc + l] = v * b[k][l];
    }
  return out;
}

/** Lower Cholesky factor, or null when the matrix is not positive definite. */
export function cholesky(a: M): M | null {
  const n = a.length;
  const L = zeros(n, n);
  for (let j = 0; j < n; j++) {
    let s = a[j][j];
    for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
    if (!(s > 1e-14 * Math.abs(a[j][j])) || !Number.isFinite(s)) return null;
    L[j][j] = Math.sqrt(s);
    for (let i = j + 1; i < n; i++) {
      let t = a[i][j];
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
      L[i][j] = t / L[j][j];
    }
  }
  return L;
}

function lowerInverse(L: M): M {
  const n = L.length;
  const X = zeros(n, n);
  for (let c = 0; c < n; c++) {
    for (let i = 0; i < n; i++) {
      let s = i === c ? 1 : 0;
      for (let k = 0; k < i; k++) s -= L[i][k] * X[k][c];
      X[i][c] = s / L[i][i];
    }
  }
  return X;
}

/**
 * Least squares Y ≈ X B by Householder QR on the columns (X: rows × m, Y: rows × K). Returns B (m × K), the residuals
 * and (XᵀX)⁻¹, or null when a column is numerically a combination of the others.
 */
/** Householder reflection of column b by the reflector stored in a (rows j…n−1). */
function reflectInto(a: Float64Array, b: Float64Array, j: number, n: number, beta: number): void {
  let s = 0;
  for (let i = j; i < n; i++) s += a[i] * b[i];
  s *= beta;
  if (s !== 0) for (let i = j; i < n; i++) b[i] -= s * a[i];
}

/**
 * Householder QR of X (column-major copies, one Float64Array per column), applied to Y as well: R above the diagonal
 * of A with rdiag on it, QᵀY in QtY. Null when a column is numerically a combination of the ones before it.
 */
function householderQr(X: M, Y: M): { A: Float64Array[]; rdiag: number[]; QtY: Float64Array[]; n: number; m: number; K: number } | null {
  const n = X.length;
  const m = X[0]?.length ?? 0;
  const K = Y[0].length;
  const A: Float64Array[] = Array.from({ length: m }, (_, j) => Float64Array.from(X, (r) => r[j]));
  const QtY: Float64Array[] = Array.from({ length: K }, (_, k) => Float64Array.from(Y, (r) => r[k]));
  const rdiag = new Array<number>(m);
  for (let j = 0; j < m; j++) {
    const a = A[j];
    let orig = 0;
    let norm = 0;
    for (let i = 0; i < n; i++) orig += a[i] * a[i];
    for (let i = j; i < n; i++) norm += a[i] * a[i];
    norm = Math.sqrt(norm);
    if (!(norm > 1e-10 * Math.sqrt(orig)) || !Number.isFinite(norm)) return null;
    const alpha = a[j] > 0 ? -norm : norm;
    a[j] -= alpha;
    const beta = -1 / (alpha * a[j]);
    for (let k = j + 1; k < m; k++) reflectInto(a, A[k], j, n, beta);
    for (let k = 0; k < K; k++) reflectInto(a, QtY[k], j, n, beta);
    rdiag[j] = alpha;
  }
  return { A, rdiag, QtY, n, m, K };
}

function lstsq(X: M, Y: M): { B: M; resid: M; xtxInv: M } | null {
  const qr = householderQr(X, Y);
  if (!qr) return null;
  const { A, rdiag, QtY, n, m, K } = qr;
  const R = (i: number, j: number): number => (i === j ? rdiag[j] : A[j][i]);
  const B = zeros(m, K);
  for (let k = 0; k < K; k++)
    for (let i = m - 1; i >= 0; i--) {
      let s = QtY[k][i];
      for (let j = i + 1; j < m; j++) s -= R(i, j) * B[j][k];
      B[i][k] = s / rdiag[i];
    }
  // R⁻¹ (upper), then (XᵀX)⁻¹ = R⁻¹R⁻ᵀ.
  const Ri = zeros(m, m);
  for (let c = 0; c < m; c++)
    for (let i = c; i >= 0; i--) {
      let s = i === c ? 1 : 0;
      for (let j = i + 1; j <= c; j++) s -= R(i, j) * Ri[j][c];
      Ri[i][c] = s / rdiag[i];
    }
  const xtxInv = mul(Ri, tr(Ri));
  const resid = zeros(n, K);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    const ri = resid[i];
    for (let k = 0; k < K; k++) {
      let s = Y[i][k];
      for (let j = 0; j < m; j++) s -= xi[j] * B[j][k];
      ri[k] = s;
    }
  }
  if (!B.every((r) => r.every(Number.isFinite))) return null;
  return { B, resid, xtxInv };
}

/** log Γ(x) for x > 0 (Lanczos, g = 7, nine terms; ≈ 1e-15 relative). */
export function lgamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const xx = x - 1;
  let a = c[0];
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Upper tail of F(d1, d2). */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!(f > 0)) return 1;
  return incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

// ================================================================ GARCH family

export type GarchVol = "garch" | "gjr" | "egarch";
export type GarchDist = "normal" | "t";
export type GarchMean = "constant" | "zero";
export interface GarchSpec {
  vol: GarchVol;
  dist: GarchDist;
  mean: GarchMean;
}

/**
 * The most observations a GARCH fit takes. The search's work is capped at GARCH_WORK / (n + 150) likelihood passes
 * (7,547 at n = 2,500), so its worst case takes about the same time at any n (measured 2026-10-27 in Node, review
 * round 3: at most 0.88 s alone over the hostile n = 2,500 series and 0.80 s over the 1,200-case holdout, up to 1.8 s
 * with six other fits running; the one hostile series found that hits the cap, an EGARCH-normal with one 10⁶ return as
 * its last, stops there in 0.62 s). Past 2,500
 * the cap leaves fewer passes (3,883 at n = 5,000), while the slowest converging fits measured needed about 5,600, so
 * they would be refused rather than printed.
 */
export const GARCH_MAX_N = 2500;
export const GARCH_MIN_N = 100;
export const GARCH_MAX_H = 250;
/**
 * The largest share of periods a fit may put at arch's variance floor (σ²ₜ below GARCH_NEAR_FLOOR × max(EWMA
 * variance/10⁶, sample variance/10⁸)). A period there with a near-zero return adds about ½ ln(10⁸/2π) ≈ 8.3 nats over
 * an ordinary one, and the likelihood rises without limit as the floor is lowered, so a fit that leans on such periods
 * is degenerate: its log likelihood and AIC measure the floor, not the data. Measured 2026-10-27: no fit of the 1,200
 * realistic holdout cases (or the review sets' simulated series) has a single period there, the review sets' stale-run
 * series at most 3.2% (38 of 1,200, in runs of zero returns), and the degenerate fits of the hostile series 6.2% to
 * 100% (±1 alternating returns 50%, a run of 2,000 zeros 80%, one 10⁶ return 6.2% to 100%); one hostile fit sits at
 * exactly 5.0% (125 of 2,500) and prints with the caution.
 */
export const GARCH_FLOOR_SHARE = 0.05;
/**
 * "At the floor": σ²ₜ below 100 × arch's lower variance bound, still 10⁶ below the sample variance (no realistic
 * volatility path comes near it), so a variance resting 1% above the bound (a GARCH-t whose ω sits on its own lower
 * bound, 10⁻⁸ mean r²) counts as well as one clamped onto it.
 */
const GARCH_NEAR_FLOOR = 100;
/** BFGS iterations per start. */
export const GARCH_MAX_ITER = 300;

const EPS = 2.220446049250313e-16;
const SQRT2_OV_PI = Math.sqrt(2 / Math.PI);
const LNSIGMA_MAX = Math.log(Number.MAX_VALUE) - 0.1;

export function garchParamNames(spec: GarchSpec): string[] {
  const n: string[] = [];
  if (spec.mean === "constant") n.push("mu");
  n.push("omega", "alpha");
  if (spec.vol !== "garch") n.push("gamma");
  n.push("beta");
  if (spec.dist === "t") n.push("nu");
  return n;
}

interface GarchSetup {
  spec: GarchSpec;
  y: Float64Array;
  n: number;
  backcast: number;
  lower: Float64Array;
  upper: Float64Array;
  /** Bounds on ω (arch's `bounds`). */
  omegaLo: number;
  omegaHi: number;
  km: number;
  /** Units of the over-cap term U + u·ln(v/U) (1 in the setup's own units; c² after an exact rescaling by c). */
  capUnit: number;
}

/** arch's backcast (EWMA weights 0.94ⁱ over the first min(75, n) squared residuals) and variance bounds. */
function garchSetup(y: Float64Array, spec: GarchSpec): GarchSetup {
  const n = y.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i];
  mean /= n;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = spec.mean === "constant" ? y[i] - mean : y[i];
  const tau = Math.min(75, n);
  let wsum = 0;
  for (let i = 0; i < tau; i++) wsum += Math.pow(0.94, i);
  let bc = 0;
  for (let i = 0; i < tau; i++) bc += (Math.pow(0.94, i) / wsum) * r[i] * r[i];
  // variance_bounds: EWMA(0.94) of r² started at the backcast, ×10⁻⁶ and ×10⁶, then floored / capped.
  const vb = new Float64Array(n);
  let s2 = 0;
  for (let t = 0; t < n; t++) {
    s2 = t === 0 ? 0.06 * bc + 0.94 * bc : 0.06 * r[t - 1] * r[t - 1] + 0.94 * s2;
    vb[t] = s2;
  }
  let rm = 0;
  let maxR2 = 0;
  let ms = 0;
  for (let i = 0; i < n; i++) {
    rm += r[i];
    maxR2 = Math.max(maxR2, r[i] * r[i]);
    ms += r[i] * r[i];
  }
  rm /= n;
  ms /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (r[i] - rm) * (r[i] - rm);
  v /= n;
  const lowerBound = v / 1e8;
  const upperBound = 1e7 * (1 + maxR2);
  const minUpper = 1 + maxR2;
  const lower = new Float64Array(n);
  const upper = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    let lo = vb[t] / 1e6;
    let hi = vb[t] * 1e6;
    if (lo < lowerBound) lo = lowerBound;
    if (hi < minUpper) hi = minUpper;
    if (hi > upperBound) hi = upperBound;
    lower[t] = lo;
    upper[t] = hi;
  }
  const egarch = spec.vol === "egarch";
  const omegaLo = egarch ? Math.log(ms) - Math.log(10000) : 1e-8 * ms;
  const omegaHi = egarch ? Math.log(ms) + Math.log(10000) : 10 * ms;
  return { spec, y, n, backcast: egarch ? Math.log(bc) : bc, lower, upper, omegaLo, omegaHi, km: spec.mean === "constant" ? 1 : 0, capUnit: 1 };
}

interface Unpacked {
  mu: number;
  omega: number;
  alpha: number;
  gamma: number;
  beta: number;
  nu: number;
}

function unpack(s: GarchSetup, x: ArrayLike<number>): Unpacked {
  let i = 0;
  const mu = s.km ? x[i++] : 0;
  const omega = x[i++];
  const alpha = x[i++];
  const gamma = s.spec.vol !== "garch" ? x[i++] : 0;
  const beta = x[i++];
  const nu = s.spec.dist === "t" ? x[i++] : Infinity;
  return { mu, omega, alpha, gamma, beta, nu };
}

/** σ²ₜ by arch's recursions (garch_recursion with bounds_check; egarch_recursion with its clamp). */
function garchVariance(s: GarchSetup, p: Unpacked, resid: Float64Array, sigma2: Float64Array): void {
  const n = s.n;
  const bc = s.backcast;
  if (s.spec.vol === "egarch") {
    let lnPrev = 0;
    let zPrev = 0;
    for (let t = 0; t < n; t++) {
      let ln = p.omega;
      if (t > 0) ln += p.alpha * (Math.abs(zPrev) - SQRT2_OV_PI) + p.gamma * zPrev + p.beta * lnPrev;
      else ln += p.beta * bc;
      ln = Math.min(ln, LNSIGMA_MAX);
      let v = Math.exp(ln);
      if (v < s.lower[t]) {
        v = s.lower[t];
        ln = Math.log(v);
      } else if (v > s.upper[t]) {
        v = s.upper[t] + s.capUnit * (Math.log(v) - Math.log(s.upper[t]));
        ln = Math.log(v);
      }
      sigma2[t] = v;
      lnPrev = ln;
      zPrev = resid[t] / Math.sqrt(v);
    }
    return;
  }
  for (let t = 0; t < n; t++) {
    let v = p.omega;
    if (t === 0) v += p.alpha * bc + p.gamma * 0.5 * bc + p.beta * bc;
    else {
      const e = resid[t - 1];
      v += p.alpha * e * e + (e < 0 ? p.gamma * e * e : 0) + p.beta * sigma2[t - 1];
    }
    if (v < s.lower[t]) v = s.lower[t];
    else if (v > s.upper[t]) v = Number.isFinite(v) ? s.upper[t] + s.capUnit * Math.log(v / s.upper[t]) : s.upper[t] + 1000 * s.capUnit;
    sigma2[t] = v;
  }
}

/** Per-observation log likelihoods into `out` (arch's Normal / StudentsT loglikelihood); returns the sum. */
function garchLls(s: GarchSetup, x: ArrayLike<number>, out?: Float64Array, keep?: { resid: Float64Array; sigma2: Float64Array }): number {
  const p = unpack(s, x);
  const n = s.n;
  const resid = keep?.resid ?? new Float64Array(n);
  const sigma2 = keep?.sigma2 ?? new Float64Array(n);
  for (let i = 0; i < n; i++) resid[i] = s.y[i] - p.mu;
  garchVariance(s, p, resid, sigma2);
  let sum = 0;
  if (s.spec.dist === "normal") {
    const c = Math.log(2 * Math.PI);
    for (let t = 0; t < n; t++) {
      const l = -0.5 * (c + Math.log(sigma2[t]) + (resid[t] * resid[t]) / sigma2[t]);
      if (out) out[t] = l;
      sum += l;
    }
  } else {
    const nu = p.nu;
    const c = lgamma((nu + 1) / 2) - lgamma(nu / 2) - Math.log(Math.PI * (nu - 2)) / 2;
    for (let t = 0; t < n; t++) {
      const l = c - 0.5 * Math.log(sigma2[t]) - ((nu + 1) / 2) * Math.log(1 + (resid[t] * resid[t]) / (sigma2[t] * (nu - 2)));
      if (out) out[t] = l;
      sum += l;
    }
  }
  return sum;
}

/** One linear inequality a·x ≥ b of the parameter space (arch's bounds and constraints, written as rows). */
interface LinCon {
  a: number[];
  b: number;
  label: string;
}

const slackOf = (c: LinCon, x: ArrayLike<number>): number => {
  let s = -c.b;
  for (let i = 0; i < c.a.length; i++) if (c.a[i] !== 0) s += c.a[i] * x[i];
  return s;
};

/**
 * arch 8.0's parameter bounds and linear constraints as rows a·x ≥ b: GARCH.bounds/constraints (ω in
 * [10⁻⁸·mean r², 10·mean r²], α, β in [0, 1], γ in [−1, 2], α + γ ≥ 0, α + γ/2 + β ≤ 1), EGARCH (ω in
 * ln(mean r²) ± ln 10⁴, 0 ≤ β ≤ 1), StudentsT (2.05 ≤ ν ≤ 500). The mean μ and EGARCH's α, γ are free.
 */
function garchConstraints(s: GarchSetup, k: number): LinCon[] {
  const km = s.km;
  const vol = s.spec.vol;
  const iO = km;
  const iA = km + 1;
  const iG = vol !== "garch" ? km + 2 : -1;
  const iB = vol !== "garch" ? km + 3 : km + 2;
  const iNu = s.spec.dist === "t" ? iB + 1 : -1;
  const row = (pairs: [number, number][], b: number, label: string): LinCon => {
    const a = new Array<number>(k).fill(0);
    for (const [i, v] of pairs) a[i] = v;
    return { a, b, label };
  };
  const c: LinCon[] = [row([[iO, 1]], s.omegaLo, "ω at its lower bound"), row([[iO, -1]], -s.omegaHi, "ω at its upper bound")];
  if (vol === "egarch") c.push(row([[iB, 1]], 0, "β = 0"), row([[iB, -1]], -1, "β = 1"));
  else {
    c.push(row([[iA, 1]], 0, "α = 0"), row([[iA, -1]], -1, "α = 1"), row([[iB, 1]], 0, "β = 0"), row([[iB, -1]], -1, "β = 1"));
    if (vol === "gjr") {
      c.push(row([[iG, 1]], -1, "γ = −1"), row([[iG, -1]], -2, "γ = 2"), row([[iA, 1], [iG, 1]], 0, "α + γ = 0"));
      c.push(row([[iA, -1], [iG, -0.5], [iB, -1]], -1, "α + γ/2 + β = 1"));
    } else c.push(row([[iA, -1], [iB, -1]], -1, "α + β = 1"));
  }
  if (iNu >= 0) c.push(row([[iNu, 1]], 2.05, "ν = 2.05"), row([[iNu, -1]], -500, "ν = 500 (the errors look normal)"));
  return c;
}

/** Rows with a slack below this are on their constraint (in the canonical units the search runs in: mean r² ≈ 1). */
const ACTIVE_TOL = 1e-7;
const actTol = (c: LinCon): number => ACTIVE_TOL * Math.max(1, Math.abs(c.b));

/** True when x is finite and satisfies every row (to rounding: a projection onto a row can leave 10⁻¹⁶ of it). */
function garchFeasible(cons: LinCon[], x: number[]): boolean {
  if (!x.every(Number.isFinite)) return false;
  return cons.every((c) => slackOf(c, x) >= -1e-12 * Math.max(1, Math.abs(c.b)));
}

/** ψ(x), the digamma function (recurrence up to x ≥ 6, then the asymptotic series), for x > 0. */
function digamma(x: number): number {
  let acc = 0;
  while (x < 6) {
    acc -= 1 / x;
    x += 1;
  }
  const r = 1 / (x * x);
  return acc + Math.log(x) - 0.5 / x - r * (1 / 12 - r * (1 / 120 - r * (1 / 252 - r * (1 / 240 - r / 132))));
}

/**
 * −log L/n and its exact gradient in one pass: the variance recursion differentiated forward alongside it. A period on
 * arch's lower variance bound has derivative 0 there; one over the cap (U + u·ln(v/U)) has u/v times the uncapped one;
 * EGARCH's |zₜ| takes the derivative of the side zₜ is on. f is Infinity when the likelihood is not finite.
 */
function garchNllGrad(s: GarchSetup, x: ArrayLike<number>): { f: number; g: number[] } {
  const p = unpack(s, x);
  const n = s.n;
  const y = s.y;
  const km = s.km;
  const vol = s.spec.vol;
  const tdist = s.spec.dist === "t";
  const k = x.length;
  const { mu, omega, alpha, gamma, beta, nu } = p;
  const lower = s.lower;
  const upper = s.upper;
  const cap = s.capUnit;
  const bc = s.backcast;
  let cT = 0;
  let dcT = 0;
  if (tdist) {
    cT = lgamma((nu + 1) / 2) - lgamma(nu / 2) - Math.log(Math.PI * (nu - 2)) / 2;
    dcT = 0.5 * digamma((nu + 1) / 2) - 0.5 * digamma(nu / 2) - 0.5 / (nu - 2);
  }
  const lc = Math.log(2 * Math.PI);
  const np1h = (nu + 1) / 2;
  const nm2 = nu - 2;
  let ll = 0;
  let gM = 0;
  let gO = 0;
  let gA = 0;
  let gG = 0;
  let gB = 0;
  let gN = 0;
  // Derivatives of the previous period's σ² (GARCH/GJR) or ln σ² and z (EGARCH) in μ, ω, α, γ, β.
  let pM = 0;
  let pO = 0;
  let pA = 0;
  let pG = 0;
  let pB = 0;
  let zM = 0;
  let zO = 0;
  let zA = 0;
  let zG = 0;
  let zB = 0;
  let prev = 0;
  let zPrev = 0;
  const egarch = vol === "egarch";
  for (let t = 0; t < n; t++) {
    let v: number;
    let vM: number;
    let vO: number;
    let vA: number;
    let vG: number;
    let vB: number;
    const e = y[t] - mu;
    if (egarch) {
      let ln: number;
      let lM: number;
      let lO: number;
      let lA: number;
      let lG: number;
      let lB: number;
      if (t === 0) {
        ln = omega + beta * bc;
        lM = 0;
        lO = 1;
        lA = 0;
        lG = 0;
        lB = bc;
      } else {
        const az = Math.abs(zPrev);
        const w = alpha * (zPrev > 0 ? 1 : zPrev < 0 ? -1 : 0) + gamma;
        ln = omega + alpha * (az - SQRT2_OV_PI) + gamma * zPrev + beta * prev;
        lM = w * zM + beta * pM;
        lO = 1 + w * zO + beta * pO;
        lA = az - SQRT2_OV_PI + w * zA + beta * pA;
        lG = zPrev + w * zG + beta * pG;
        lB = prev + w * zB + beta * pB;
      }
      if (ln > LNSIGMA_MAX) {
        ln = LNSIGMA_MAX;
        lM = lO = lA = lG = lB = 0;
      }
      v = Math.exp(ln);
      if (v < lower[t]) {
        v = lower[t];
        ln = Math.log(v);
        lM = lO = lA = lG = lB = 0;
      } else if (v > upper[t]) {
        v = upper[t] + cap * (ln - Math.log(upper[t]));
        ln = Math.log(v);
        const f = cap / v;
        lM *= f;
        lO *= f;
        lA *= f;
        lG *= f;
        lB *= f;
      }
      const sd = Math.sqrt(v);
      const z = e / sd;
      zM = -0.5 * z * lM - 1 / sd;
      zO = -0.5 * z * lO;
      zA = -0.5 * z * lA;
      zG = -0.5 * z * lG;
      zB = -0.5 * z * lB;
      prev = ln;
      pM = lM;
      pO = lO;
      pA = lA;
      pG = lG;
      pB = lB;
      zPrev = z;
      vM = v * lM;
      vO = v * lO;
      vA = v * lA;
      vG = v * lG;
      vB = v * lB;
    } else {
      if (t === 0) {
        v = omega + (alpha + gamma * 0.5 + beta) * bc;
        vM = 0;
        vO = 1;
        vA = bc;
        vG = 0.5 * bc;
        vB = bc;
      } else {
        const e1 = y[t - 1] - mu;
        const e2 = e1 * e1;
        const neg = e1 < 0;
        const ag = neg ? alpha + gamma : alpha;
        v = omega + ag * e2 + beta * prev;
        vM = -2 * e1 * ag + beta * pM;
        vO = 1 + beta * pO;
        vA = e2 + beta * pA;
        vG = (neg ? e2 : 0) + beta * pG;
        vB = prev + beta * pB;
      }
      if (v < lower[t]) {
        v = lower[t];
        vM = vO = vA = vG = vB = 0;
      } else if (v > upper[t]) {
        if (Number.isFinite(v)) {
          const f = cap / v;
          v = upper[t] + cap * Math.log(v / upper[t]);
          vM *= f;
          vO *= f;
          vA *= f;
          vG *= f;
          vB *= f;
        } else {
          v = upper[t] + 1000 * cap;
          vM = vO = vA = vG = vB = 0;
        }
      }
      prev = v;
      pM = vM;
      pO = vO;
      pA = vA;
      pG = vG;
      pB = vB;
    }
    // ∂lₜ/∂σ²ₜ and the direct ∂lₜ/∂μ (through eₜ = yₜ − μ).
    let dv: number;
    let dmu: number;
    if (tdist) {
      const q = (e * e) / (v * nm2);
      const r = q / (1 + q);
      ll += cT - 0.5 * Math.log(v) - np1h * Math.log1p(q);
      dv = (-0.5 + np1h * r) / v;
      dmu = (2 * np1h * e) / ((1 + q) * v * nm2);
      gN += dcT - 0.5 * Math.log1p(q) + (np1h * r) / nm2;
    } else {
      ll += -0.5 * (lc + Math.log(v) + (e * e) / v);
      dv = (-0.5 * (v - e * e)) / (v * v);
      dmu = e / v;
    }
    gM += dv * vM + dmu;
    gO += dv * vO;
    gA += dv * vA;
    gG += dv * vG;
    gB += dv * vB;
  }
  const g = new Array<number>(k).fill(0);
  if (!Number.isFinite(ll)) return { f: Infinity, g };
  let i = 0;
  if (km) g[i++] = -gM / n;
  g[i++] = -gO / n;
  g[i++] = -gA / n;
  if (vol !== "garch") g[i++] = -gG / n;
  g[i++] = -gB / n;
  if (tdist) g[i++] = -gN / n;
  return { f: -ll / n, g };
}

/**
 * The fit runs on the series rescaled by kc = 1/√(mean squared residual), so the canonical series has mean squared
 * residual 1 and is the same series (to rounding, 10⁻¹⁶ relative) whatever units the returns were typed in: ×10ᵏ, %
 * or decimal. arch's setup (backcast, variance bounds, parameter bounds) is computed on that series, and so are the
 * starts, the search, every tolerance (the KKT gate, the active rows, the stopping rules) and arch's two bounds that are
 * not scale-equivariant (EGARCH's ω in ln(mean r²) ± ln 10⁴, while ω itself shifts by 2(1 − β) ln c under r → c·r; the
 * variance cap's 1 + max r²): the estimates are arch's on kc·r, mapped back. The likelihood maps exactly: σ²ₜ →
 * σ²ₜ/kc², log L → log L + n ln kc. Parameters map affinely, x = M x′ + d: μ = μ′/kc, ω = ω′/kc² (GARCH, GJR); EGARCH
 * ω = ω′ − 2(1 − β) ln kc.
 */
interface Canon {
  /** arch's setup on kc·y (the search's units). */
  s: GarchSetup;
  /** The same setup in y's units, for garchKktAt's log likelihood in those units. */
  sR: GarchSetup;
  cons: LinCon[];
  kc: number;
  /** ln kc (computed without forming kc², which can overflow). */
  lnkc: number;
  /** The Jacobian M of toR (constant: the map is affine). */
  M: M;
  /** Canonical → y's units. */
  toR: (x: number[]) => number[];
  /** y's units → canonical. */
  toK: (x: number[]) => number[];
}

function garchCanon(yR: Float64Array, spec: GarchSpec, k: number): Canon | null {
  const n = yR.length;
  // kc = 1/√(mean squared residual), computed on y/max|y| so that neither the sum nor the squares overflow or
  // underflow (returns of 10⁻²⁰⁰ or 10²⁰⁰ rescale as well as percent returns).
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(yR[i]));
  if (!(m > 0) || !Number.isFinite(m)) return null;
  let ubar = 0;
  for (let i = 0; i < n; i++) ubar += yR[i] / m;
  ubar /= n;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const r = spec.mean === "constant" ? yR[i] / m - ubar : yR[i] / m;
    q += r * r;
  }
  q /= n;
  const invSq = 1 / Math.sqrt(q);
  const kc = invSq / m;
  const lnkc = -Math.log(m) - 0.5 * Math.log(q);
  if (!(q > 0) || !Number.isFinite(invSq) || !(kc > 0) || !Number.isFinite(kc) || !Number.isFinite(lnkc)) return null;
  const lnk2 = 2 * lnkc;
  const egarch = spec.vol === "egarch";
  const yK = new Float64Array(n);
  for (let i = 0; i < n; i++) yK[i] = (yR[i] / m) * invSq;
  const s = garchSetup(yK, spec);
  // Division by kc twice (not by kc², which can overflow for returns of 10⁻¹⁶⁰).
  const d2 = (v: number): number => v / kc / kc;
  const sR: GarchSetup = {
    ...s,
    y: yR,
    backcast: egarch ? s.backcast - lnk2 : d2(s.backcast),
    lower: s.lower.map(d2),
    upper: s.upper.map(d2),
    omegaLo: egarch ? s.omegaLo - lnk2 : d2(s.omegaLo),
    omegaHi: egarch ? s.omegaHi - lnk2 : d2(s.omegaHi),
    capUnit: d2(s.capUnit),
  };
  const iO = s.km;
  const iB = spec.vol !== "garch" ? s.km + 3 : s.km + 2;
  const Mx = eye(k);
  if (s.km) Mx[0][0] = 1 / kc;
  if (egarch) Mx[iO][iB] = lnk2;
  else Mx[iO][iO] = 1 / kc / kc;
  const toR = (x: number[]): number[] => {
    const out = x.slice();
    if (s.km) out[0] = x[0] / kc;
    out[iO] = egarch ? x[iO] - lnk2 * (1 - x[iB]) : d2(x[iO]);
    return out;
  };
  const toK = (x: number[]): number[] => {
    const out = x.slice();
    if (s.km) out[0] = x[0] * kc;
    out[iO] = egarch ? x[iO] + lnk2 * (1 - x[iB]) : x[iO] * kc * kc;
    return out;
  };
  return { s, sR, cons: garchConstraints(s, k), kc, lnkc, M: Mx, toR, toK };
}

/** Small dense solve by Gaussian elimination with partial pivoting; null when singular. */
function solveSmall(A: M, b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (!(Math.abs(m[p][c]) > 1e-14)) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let j = r + 1; j < n; j++) s -= m[r][j] * x[j];
    x[r] = s / m[r][r];
  }
  return x;
}

/**
 * Lagrange multipliers for g = Σ λᵢ aᵢ over the rows W with every λᵢ ≥ 0, by exact non-negative least squares: every
 * subset of W (at most 2⁶ here) is solved and the smallest residual with non-negative multipliers kept, fewest rows on
 * ties. Exact enumeration matters because the active rows can be dependent (α = 0 and β = 1 imply α + β = 1), where
 * eliminating one row at a time from a singular system decides nothing. Returns the supporting rows, their λ and the
 * residual g − Aᵀλ (the projected gradient).
 */
function kktMultipliers(cons: LinCon[], W: number[], g: number[]): { kept: number[]; lambda: number[]; resid: number[] } {
  let best = { kept: [] as number[], lambda: [] as number[], resid: g.slice(), norm: g.reduce((s, v) => s + v * v, 0) };
  const m = Math.min(W.length, 10);
  for (let mask = 1; mask < 1 << m; mask++) {
    const rows = W.filter((_, j) => j < m && mask & (1 << j));
    const A = rows.map((i) => cons[i].a);
    const AAt = A.map((ri) => A.map((rj) => ri.reduce((s, v, t) => s + v * rj[t], 0)));
    const Ag = A.map((ri) => ri.reduce((s, v, t) => s + v * g[t], 0));
    const lambda = solveSmall(AAt, Ag);
    if (!lambda || lambda.some((l) => !(l >= 0))) continue;
    const resid = g.slice();
    rows.forEach((ci, j) => cons[ci].a.forEach((v, t) => (resid[t] -= lambda[j] * v)));
    const norm = resid.reduce((s, v) => s + v * v, 0);
    if (norm < best.norm * (1 - 1e-12) - 1e-300 || (norm <= best.norm * (1 + 1e-12) && rows.length < best.kept.length)) best = { kept: rows, lambda, resid, norm };
  }
  return { kept: best.kept, lambda: best.lambda, resid: best.resid };
}

/** Gradient tolerance of the KKT check, on the per-observation negative log likelihood in the canonical units. */
const KKT_GTOL = 1e-5;

/**
 * The first-order (KKT) conditions at x (canonical units): the exact gradient of −log L/n is a non-negative
 * combination of the active rows' normals to within KKT_GTOL (on the free directions the gradient vanishes; on a bound
 * it points out of the region).
 */
function garchKkt(s: GarchSetup, cons: LinCon[], x: number[], kinkAt0: boolean, budget?: { left: number }): { ok: boolean; worst: number; active: number[] } {
  if (budget) budget.left -= GRAD_COST;
  const { f: fx, g } = garchNllGrad(s, x);
  const active = cons.map((c, i) => (slackOf(c, x) <= actTol(c) ? i : -1)).filter((i) => i >= 0);
  if (!Number.isFinite(fx) || !g.every(Number.isFinite)) return { ok: false, worst: Infinity, active };
  if (kinkAt0 && Math.abs(g[0]) > KKT_GTOL) {
    // EGARCH's |zₜ| = |rₜ − μ|/σₜ has a kink in μ at every observation, and the optimum often sits on one (μ equal to a
    // return as typed). There the condition is on the one-sided slopes: falling to the left, rising to the right
    // (0 in the subgradient), checked over a step of 10⁻⁴·max(1, |μ|), so μ is within that of the kink.
    const h = 1e-4 * Math.max(1, Math.abs(x[0]));
    if (budget) budget.left -= 2;
    const fl = -garchLls(s, [x[0] - h, ...x.slice(1)]) / s.n;
    const fr = -garchLls(s, [x[0] + h, ...x.slice(1)]) / s.n;
    if ((fx - fl) / h <= KKT_GTOL && (fr - fx) / h >= -KKT_GTOL) g[0] = 0;
  }
  const { resid } = kktMultipliers(cons, active, g);
  const worst = Math.max(...resid.map(Math.abs));
  return { ok: worst <= KKT_GTOL, worst, active };
}

/** An orthonormal basis of the null space of the rows (k − rank vectors), by Gram–Schmidt. */
function nullBasis(rows: number[][], k: number): number[][] {
  const q: number[][] = [];
  const orth = (v: number[], against: number[][]): number[] => {
    const w = v.slice();
    for (let pass = 0; pass < 2; pass++)
      for (const u of against) {
        const d = u.reduce((s, ui, t) => s + ui * w[t], 0);
        for (let t = 0; t < k; t++) w[t] -= d * u[t];
      }
    return w;
  };
  const unit = (w: number[]): number[] | null => {
    const nrm = Math.sqrt(w.reduce((s, v) => s + v * v, 0));
    return nrm > 1e-8 ? w.map((v) => v / nrm) : null;
  };
  for (const r of rows) {
    const u = unit(orth(r, q));
    if (u) q.push(u);
  }
  const Z: number[][] = [];
  for (let j = 0; j < k && q.length + Z.length < k; j++) {
    const e = new Array<number>(k).fill(0);
    e[j] = 1;
    const u = unit(orth(e, [...q, ...Z]));
    if (u) Z.push(u);
  }
  return Z;
}

/** x moved onto the rows W (a·x = b) by the least change (x − Aᵀ(AAᵀ)⁻¹(Ax − b)); x itself when singular. */
function projectOnto(cons: LinCon[], W0: number[], x: number[]): number[] {
  // Dependent rows (α = 0, β = 1 and α + β = 1) make AAᵀ singular: project onto an independent subset, which satisfies
  // the rest when they are consistent at the point.
  const q: number[][] = [];
  const W = W0.filter((i) => {
    const w = cons[i].a.slice();
    for (const u of q) {
      const d = u.reduce((s, ui, t) => s + ui * w[t], 0);
      for (let t = 0; t < w.length; t++) w[t] -= d * u[t];
    }
    const nrm = Math.sqrt(w.reduce((s, v) => s + v * v, 0));
    if (!(nrm > 1e-8)) return false;
    q.push(w.map((v) => v / nrm));
    return true;
  });
  if (!W.length) return x;
  const A = W.map((i) => cons[i].a);
  const AAt = A.map((ri) => A.map((rj) => ri.reduce((s, v, t) => s + v * rj[t], 0)));
  const r = W.map((i) => slackOf(cons[i], x));
  const mu = solveSmall(AAt, r);
  if (!mu) return x;
  const out = x.slice();
  W.forEach((_, j) => A[j].forEach((v, t) => (out[t] -= mu[j] * v)));
  return out;
}

/** Work units: one pass over the series, with or without the exact gradient (garchNllGrad measured 0.6 to 0.85 of garchLls's time), costs 1. */
const GRAD_COST = 1;
/**
 * The likelihood search's total work in observation-passes: the budget is GARCH_WORK / (n + GARCH_PASS_OVERHEAD)
 * passes, so the longest search takes about the same time at every n (measured 2026-10-27, Node on the development
 * laptop, review round 3: at most 0.88 s alone for the slowest n = 2,500 series found, ±1 alternating returns into
 * EGARCH-t, refused as degenerate). EGARCH searches its main starts within 70% of it and keeps 30% for its rescue
 * starts.
 */
const GARCH_WORK = 2e7;
/**
 * A search step's fixed cost (the subspace map, feasibility checks, quasi-Newton update) in observations: measured
 * about 5 µs per evaluation against 0.044 µs per observation, so short series do not get 10⁵ cheap passes that the
 * fixed cost makes slow (at n = 100 the cap is 80,000 passes).
 */
const GARCH_PASS_OVERHEAD = 150;

type FG = (x: number[]) => { f: number; g: number[] };

/**
 * BFGS with exact gradients and a backtracking (Armijo) line search; `maxStep(x, d)` caps the step at the nearest
 * row the direction runs into, so a search that meets a bound lands on it instead of halving toward it.
 */
function bfgsG(fg: FG, x0: number[], maxIter: number, budget: { left: number }, maxStep?: (x: number[], d: number[]) => number): { x: number[]; f: number; g: number[] } {
  const k = x0.length;
  let x = x0.slice();
  let { f, g } = fg(x);
  if (!Number.isFinite(f) || k === 0) return { x, f, g };
  let H = eye(k);
  let scaled = false;
  let small = 0;
  for (let it = 0; it < maxIter && budget.left > 0; it++) {
    if (Math.max(...g.map(Math.abs)) < 1e-10) break;
    let dir = H.map((row) => -row.reduce((s, v, j) => s + v * g[j], 0));
    let slope = dir.reduce((s, v, i) => s + v * g[i], 0);
    if (!(slope < 0)) {
      H = eye(k);
      scaled = false;
      dir = g.map((v) => -v);
      slope = -g.reduce((s, v) => s + v * v, 0);
    }
    let step = 1;
    for (let i = 0; i < k; i++) {
      const lim = 5 * Math.max(1, Math.abs(x[i]));
      if (Math.abs(dir[i]) * step > lim) step = lim / Math.abs(dir[i]);
    }
    if (maxStep) {
      const t = maxStep(x, dir);
      if (t < step) step = t;
    }
    if (!(step > 0)) break;
    let accepted: { x: number[]; f: number; g: number[] } | null = null;
    for (let ls = 0; ls < 50 && budget.left > 0; ls++) {
      const xn = x.map((v, i) => v + step * dir[i]);
      const r = fg(xn);
      if (Number.isFinite(r.f) && r.f <= f + 1e-4 * step * slope) {
        accepted = { x: xn, f: r.f, g: r.g };
        break;
      }
      step *= 0.5;
    }
    if (!accepted) break;
    const sv = accepted.x.map((v, i) => v - x[i]);
    const yv = accepted.g.map((v, i) => v - g[i]);
    const sy = sv.reduce((acc, v, i) => acc + v * yv[i], 0);
    const yy = yv.reduce((acc, v) => acc + v * v, 0);
    if (sy > 1e-300 && yy > 0) {
      if (!scaled) {
        // Shanno–Phua: start the inverse Hessian at the scale the first step measured.
        H = H.map((row) => row.map((v) => (v * sy) / yy));
        scaled = true;
      }
      const Hy = H.map((row) => row.reduce((acc, v, j) => acc + v * yv[j], 0));
      const yHy = yv.reduce((acc, v, i) => acc + v * Hy[i], 0);
      const rho = 1 / sy;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) H[i][j] += rho * rho * (sy + yHy) * sv[i] * sv[j] - rho * (Hy[i] * sv[j] + sv[i] * Hy[j]);
    }
    const df = f - accepted.f;
    x = accepted.x;
    f = accepted.f;
    g = accepted.g;
    if (df <= 1e-15 * Math.max(1, Math.abs(f))) {
      if (++small >= 4) break;
    } else small = 0;
  }
  return { x, f, g };
}

/**
 * Active-set quasi-Newton for f over the polytope: BFGS in the null space of the working rows W (x = x_W + Z z), then
 * drop a row whose multiplier is negative (the likelihood rises into the interior) or add a row the search ran into
 * while the gradient points out through it; repeat until neither happens. This reaches an optimum on a bound (α = 0,
 * β = 0), where a BFGS whose steps outside the region are rejected stalls with every other parameter where it was.
 */
function activeSetMin(fg: FG, cons: LinCon[], x0: number[], budget: { left: number }): { x: number[]; f: number } {
  const k = x0.length;
  let x = x0.slice();
  let W = cons.map((c, i) => (slackOf(c, x) <= 1e-6 * Math.max(1, Math.abs(c.b)) ? i : -1)).filter((i) => i >= 0);
  let cur = fg(x);
  let restarts = 0;
  for (let round = 0; round < 30 && budget.left > 0; round++) {
    const xp = projectOnto(cons, W, x);
    if (xp !== x) {
      const r = fg(xp);
      if (Number.isFinite(r.f)) {
        x = xp;
        cur = r;
      }
    }
    if (!Number.isFinite(cur.f)) break;
    const fStart = cur.f;
    const Z = nullBasis(
      W.map((i) => cons[i].a),
      k,
    );
    if (Z.length) {
      const base = x.slice();
      const at = (z: number[]): number[] => base.map((v, t) => v + Z.reduce((s, zi, j) => s + zi[t] * z[j], 0));
      const sub: FG = (z) => {
        const r = fg(at(z));
        return { f: r.f, g: Z.map((zi) => zi.reduce((s, v, t) => s + v * (r.g[t] ?? 0), 0)) };
      };
      const free = cons.map((_, i) => i).filter((i) => !W.includes(i));
      const maxStep = (z: number[], dz: number[]): number => {
        const xx = at(z);
        const dx = base.map((_, t) => Z.reduce((s, zi, j) => s + zi[t] * dz[j], 0));
        let tMax = Infinity;
        for (const i of free) {
          const ad = cons[i].a.reduce((s, v, t) => s + v * dx[t], 0);
          if (ad < 0) tMax = Math.min(tMax, Math.max(0, slackOf(cons[i], xx)) / -ad);
        }
        return tMax;
      };
      const r = bfgsG(sub, new Array<number>(Z.length).fill(0), GARCH_MAX_ITER, budget, maxStep);
      if (Number.isFinite(r.f) && r.f <= cur.f) {
        x = at(r.x);
        cur = fg(x);
      }
    }
    const g = cur.g;
    if (!Number.isFinite(cur.f) || !g.every(Number.isFinite)) break;
    // The steepest feasible direction: −g projected onto the cone of directions that keep every row the point is on
    // (the working rows and any row the search ran into: maxStep lands on it exactly), d = −(g − Aᵀλ) with λ ≥ 0 by
    // the exact NNLS. The next working set is the rows d does not leave. Projecting onto the cone, not dropping and
    // adding rows one at a time, settles degenerate corners (α = 0, γ = 2, β = 0 and α + γ/2 + β = 1 all at once).
    const on = cons.map((c, i) => (W.includes(i) || slackOf(c, x) <= 1e-10 * Math.max(1, Math.abs(c.b)) ? i : -1)).filter((i) => i >= 0);
    const m = kktMultipliers(cons, on, g);
    const dn = Math.max(0, ...m.resid.map(Math.abs));
    const tiny = 1e-9 * Math.max(...g.map(Math.abs), 1e-300);
    const nextW = on.filter((i) => -cons[i].a.reduce((s, v, t) => s + v * m.resid[t], 0) <= tiny);
    if (dn <= KKT_GTOL / 100) break;
    // On a row that d leaves (α + γ = 0 with the likelihood rising into the interior), the quasi-Newton direction can
    // keep running back into it; a projected steepest-descent step along d (feasible for every row the point is on, by
    // the cone projection) makes progress there.
    if (on.some((i) => !nextW.includes(i))) {
      const d = m.resid.map((v) => -v);
      let tMax = Infinity;
      for (let i = 0; i < cons.length; i++) {
        if (on.includes(i)) continue;
        const ad = cons[i].a.reduce((acc, v, t) => acc + v * d[t], 0);
        if (ad < 0) tMax = Math.min(tMax, Math.max(0, slackOf(cons[i], x)) / -ad);
      }
      const slope = -m.resid.reduce((acc, v) => acc + v * v, 0);
      let t = Math.min(tMax, 1);
      for (let ls = 0; ls < 40 && t > 0 && budget.left > 0; ls++) {
        const xn = x.map((v, j) => v + t * d[j]);
        const r = fg(xn);
        if (Number.isFinite(r.f) && r.f <= cur.f + 1e-4 * t * slope) {
          x = xn;
          cur = r;
          break;
        }
        t *= 0.5;
      }
    }
    const same = nextW.length === W.length && nextW.every((i) => W.includes(i));
    if (same) {
      // Same working set: done when the round gained nothing; otherwise BFGS stopped early on a flat, badly scaled
      // valley, and a fresh start (identity Hessian) from here goes on.
      if (!(cur.f < fStart - 1e-13 * Math.max(1, Math.abs(cur.f))) || ++restarts > 3) break;
    } else restarts = 0;
    W = nextW;
  }
  return { x, f: cur.f };
}

/** Mean ln|β − (α|zₜ| + γzₜ)/2| along the fitted path (EGARCH's invertibility measure, Wintenberger 2013). */
function egarchLyap(s: GarchSetup, x: number[]): number {
  const n = s.n;
  const resid = new Float64Array(n);
  const sigma2 = new Float64Array(n);
  garchLls(s, x, undefined, { resid, sigma2 });
  const p = unpack(s, x);
  let acc = 0;
  for (let t = 0; t < n; t++) {
    const z = resid[t] / Math.sqrt(sigma2[t]);
    acc += Math.log(Math.max(1e-300, Math.abs(p.beta - (p.alpha * Math.abs(z) + p.gamma * z) / 2)));
  }
  return acc / n;
}

/** arch's volatility starting grid, best Gaussian log likelihood first, over α × γ × (α + γ/2 + β) (or β for EGARCH): its three best, then a near-iid and a high-persistence start. */
function garchStarts(s: GarchSetup, ybar: number): number[][] {
  const n = s.n;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = s.y[i] - (s.km ? ybar : 0);
  let ms = 0;
  for (let i = 0; i < n; i++) ms += r[i] * r[i];
  ms /= n;
  const gauss: GarchSetup = { ...s, spec: { ...s.spec, dist: "normal", mean: "zero" }, y: r, km: 0 };
  const alphas = [0.01, 0.05, 0.1, 0.2];
  const grid: { ll: number; v: number[] }[] = [];
  const egarch = s.spec.vol === "egarch";
  const gammas = egarch ? [-0.1, 0, 0.1] : s.spec.vol === "gjr" ? alphas : [0.01, 0.05, 0.1, 0.2];
  const abgs = [0.5, 0.7, 0.9, 0.98];
  for (const a of alphas)
    for (const g of gammas)
      for (const b0 of abgs) {
        let v: number[];
        if (egarch) {
          const target = Math.log(ms);
          v = [(1 - b0) * target, a, g, b0];
        } else {
          let agb = b0;
          const om = (1 - agb) * ms;
          agb -= a;
          if (s.spec.vol === "gjr") {
            agb -= g / 2;
            v = [om, a, g, agb];
          } else v = [om, a, agb];
        }
        const ll = garchLls(gauss, v);
        grid.push({ ll: Number.isFinite(ll) ? ll : -Infinity, v });
      }
  // Stable sort, best first: ties keep arch's grid order (it takes the first maximum, as this does).
  grid.sort((p, q) => q.ll - p.ll);
  // GARCH's grid repeats each point once per γ (unused there): keep the first of each.
  const seen = new Set<string>();
  const uniq = grid.filter((gp) => {
    const key = gp.v.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Two more: a near-iid start (β = 0) and a high-persistence one (α + β = 0.98, γ = 0), for the basins the three best
  // grid points can all miss when the likelihood is multimodal (on iid returns: β on 0, or a slow drift from the
  // backcast with β ≈ 0.996, beside an interior optimum).
  const iid = egarch ? [Math.log(ms), 0.05, 0, 0] : s.spec.vol === "gjr" ? [0.95 * ms, 0.05, 0, 0] : [0.95 * ms, 0.05, 0];
  const pers = egarch ? [0.02 * Math.log(ms), 0.1, 0, 0.98] : s.spec.vol === "gjr" ? [0.02 * ms, 0.05, 0, 0.93] : [0.02 * ms, 0.05, 0.93];
  return [...uniq.slice(0, 3).map((gp) => gp.v), iid, pers].map((v) => withNu(s, ybar, v));
}

/** A full start vector (μ, the volatility start, then ν by StudentsT.starting_values for t errors). */
function withNu(s: GarchSetup, ybar: number, vol: number[]): number[] {
  const n = s.n;
  const out: number[] = [];
  if (s.km) out.push(ybar);
  out.push(...vol);
  if (s.spec.dist === "t") {
    // StudentsT.starting_values: a moment estimator from the kurtosis of the standardised residuals.
    const sig = new Float64Array(n);
    const res = new Float64Array(n);
    garchLls({ ...s, spec: { ...s.spec, dist: "normal" } }, out, undefined, { resid: res, sigma2: sig });
    let m2 = 0;
    let m4 = 0;
    const z = new Float64Array(n);
    let zm = 0;
    for (let i = 0; i < n; i++) {
      z[i] = res[i] / Math.sqrt(sig[i]);
      zm += z[i];
    }
    zm /= n;
    for (let i = 0; i < n; i++) {
      const d = z[i] - zm;
      m2 += d * d;
      m4 += d * d * d * d;
    }
    m2 /= n;
    m4 /= n;
    const k = m4 / (m2 * m2);
    let nu = k > 3.75 ? (4 * k - 6) / (k - 3) : 12;
    nu = Math.max(nu, 4);
    out.push(Math.min(nu, 100));
  }
  return out;
}

export interface GarchFit {
  ok: true;
  spec: GarchSpec;
  names: string[];
  params: number[];
  llf: number;
  seRobust: number[] | null;
  seClassic: number[] | null;
  seWhy?: string;
  sigma2: Float64Array;
  resid: Float64Array;
  backcast: number;
  n: number;
  /**
   * The first-order (KKT) conditions hold at the estimate: the projected gradient of the per-observation negative log
   * likelihood on the free directions is ≤ 10⁻⁵ and on each active bound it points out of the parameter space.
   * The calculator prints estimates only when this is true.
   */
  converged: boolean;
  /** The largest projected-gradient component in that check. */
  kktGradient: number;
  /** No point passing the KKT check was found before the search's work cap (GARCH_WORK) ran out. */
  workLimitHit: boolean;
  /**
   * When the estimate passes the KKT check but the search also reached a higher log likelihood (in the user's units) at
   * a point that fails it: that value, and whether it is a non-invertible EGARCH recursion. Null otherwise.
   */
  higherNonKkt: { llf: number; noninvertible: boolean } | null;
  /** Periods whose σ² sits on arch's lower (or beyond its upper) variance bound at the estimate. */
  clamped: number;
  /** Periods whose σ² is at the variance floor (below 100 × arch's lower bound; GARCH_FLOOR_SHARE). */
  floored: number;
  /** EGARCH: mean ln|β − (α|zₜ| + γzₜ)/2| at the estimate (≥ 0: the recursion is not invertible); NaN otherwise. */
  egarchLyapunov: number;
  /** Parameters within 10⁻⁴ of a bound or constraint (SEs there are not reliable). */
  atBounds: string[];
  /** α + β (GARCH), α + γ/2 + β (GJR), β (EGARCH). */
  persistence: number;
  /** One-step-ahead σ²_{T+1} and the analytic k-step path (GARCH/GJR; EGARCH has h = 1 only). */
  forecast: number[];
  /** The factor kc the search's canonical series is the returns times (1/√(mean squared residual)). */
  scale: number;
}

/** arch's numerical Hessian (statsmodels approx_hess3, h = ε^¼·max(|x|, 0.1)) of f. */
function approxHess3(f: (x: number[]) => number, x: number[]): M {
  const k = x.length;
  const h = x.map((v) => Math.pow(EPS, 1 / 4) * Math.max(Math.abs(v), 0.1));
  const H = zeros(k, k);
  const at = (i: number, si: number, j: number, sj: number): number => {
    const v = x.slice();
    v[i] += si * h[i];
    v[j] += sj * h[j];
    return f(v);
  };
  for (let i = 0; i < k; i++)
    for (let j = i; j < k; j++) {
      H[i][j] = (at(i, 1, j, 1) - at(i, 1, j, -1) - (at(i, -1, j, 1) - at(i, -1, j, -1))) / (4 * h[i] * h[j]);
      H[j][i] = H[i][j];
    }
  return H;
}

/** Fits a GARCH-family model to y (in the units the user typed; the search runs on the canonical rescaling, garchCanon). */
export function fitGarch(yIn: ArrayLike<number>, spec: GarchSpec): GarchFit | Refusal {
  const n = yIn.length;
  if (n < GARCH_MIN_N) return { ok: false, reason: `A GARCH fit needs at least ${GARCH_MIN_N} returns; the series has ${n}.` };
  if (n > GARCH_MAX_N) return { ok: false, reason: `The series has ${n.toLocaleString("en-US")} returns; a GARCH fit here takes at most ${GARCH_MAX_N.toLocaleString("en-US")} (the most recent ${GARCH_MAX_N.toLocaleString("en-US")} would do).` };
  let nonzero = false;
  let varies = false;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(yIn[i])) return { ok: false, reason: `Return ${i + 1} is not a finite number.` };
    if (yIn[i] !== 0) nonzero = true;
    if (yIn[i] !== yIn[0]) varies = true;
  }
  if (!nonzero) return { ok: false, reason: "Every return is zero, so there is no volatility to model." };
  if (!varies && spec.mean === "constant") return { ok: false, reason: "The returns are constant, so there is no volatility to model." };
  const y = Float64Array.from(yIn);

  const names = garchParamNames(spec);
  const k = names.length;
  // The fit runs in canonical units (garchCanon): the same series, so the same answer and the same KKT verdict,
  // whatever the units.
  const C = garchCanon(y, spec, k);
  if (!C) return { ok: false, reason: "The returns are too small or too large to rescale in double precision (their mean square is not a representable number)." };
  const sc = C.s;
  const cons = C.cons;
  let ybarK = 0;
  for (let i = 0; i < n; i++) ybarK += sc.y[i];
  ybarK /= n;
  const budget = { left: Math.max(400, Math.floor(GARCH_WORK / (n + GARCH_PASS_OVERHEAD))) };
  let exhausted = false;
  const fg: FG = (v) => {
    if (!garchFeasible(cons, v)) return { f: Infinity, g: [] };
    budget.left -= GRAD_COST;
    return garchNllGrad(sc, v);
  };
  const kinkAt0 = spec.vol === "egarch" && sc.km === 1;
  const starts = garchStarts(sc, ybarK).filter((x0) => garchFeasible(cons, x0));
  if (!starts.length) return { ok: false, reason: "No feasible starting point was found for this series." };
  // Every start is searched (arch's three best grid points, a near-iid start, and for t errors the ν starts below) and
  // the highest likelihood that satisfies the KKT conditions is kept: a local optimum that passes the check need not be
  // the best one. The work is capped (GARCH_WORK), so a series that never settles is refused in bounded time.
  const tries: number[][] = [...starts];
  // For t errors also ν = 5, 30, 100 at the best grid point and ν = 30, 100 at the next two: the likelihood is flat in ν
  // and a search from ν = 12 can settle in a different (β, ν) basin (GJR-t on iid n = 300: β ≈ 0.29 against 0.89).
  if (spec.dist === "t") {
    for (const nu0 of [5, 30, 100]) tries.push([...starts[0].slice(0, k - 1), nu0]);
    for (const st of starts.slice(1, 3)) for (const nu0 of [30, 100]) tries.push([...st.slice(0, k - 1), nu0]);
  }
  // EGARCH: two large-α starts (ω = 0, the canonical mean log variance), α = 0.5 on the β = 1 face and α = 1 at
  // β = 0.9; arch's grid has α ≤ 0.2. Without them an EGARCH-t whose best optimum is β = 1, ν = 2.05, α ≈ 3 (F2 review
  // round 3) and a short EGARCH whose best optimum has α ≈ 1.1 (log L 1.56 above the grid's) were missed.
  if (spec.vol === "egarch") {
    for (const [a, b] of [
      [0.5, 1],
      [1, 0.9],
    ]) {
      const v = withNu(sc, ybarK, [0, a, 0, b]);
      if (garchFeasible(cons, v)) tries.push(v);
    }
  }
  type Cand = { x: number[]; f: number; kkt: { ok: boolean; worst: number; active: number[] }; floored: number };
  // (Typed by assertion so that TypeScript does not narrow them to null: runStart assigns them.)
  let bestOk = null as Cand | null;
  let bestAny = null as Cand | null;
  let degenerate = null as Cand | null;
  const fResid = new Float64Array(n);
  const fSig2 = new Float64Array(n);
  const flooredAt = (x: number[]): number => {
    budget.left -= 1;
    garchLls(sc, x, undefined, { resid: fResid, sigma2: fSig2 });
    let c = 0;
    for (let t = 0; t < n; t++) if (fSig2[t] < GARCH_NEAR_FLOOR * sc.lower[t]) c++;
    return c;
  };
  const runStart = (x0: number[], share: number): void => {
    const reserve = budget.left - share;
    budget.left = share;
    let r = activeSetMin(fg, cons, x0, budget);
    if (budget.left <= 0) exhausted = true;
    if (!Number.isFinite(r.f)) {
      budget.left = Math.max(0, budget.left) + reserve;
      return;
    }
    let kkt = garchKkt(sc, cons, r.x, kinkAt0, budget);
    if (!kkt.ok && kinkAt0) {
      // EGARCH with a mean: BFGS cannot settle on the kink of |rₜ − μ|; pin μ to the nearest return and refit the rest.
      let mu = r.x[0];
      let dBest = Infinity;
      for (let i = 0; i < n; i++) {
        const dd = Math.abs(sc.y[i] - r.x[0]);
        if (dd < dBest) {
          dBest = dd;
          mu = sc.y[i];
        }
      }
      if (dBest <= 1e-3 * Math.max(1, Math.abs(mu))) {
        const sub = cons.map((c) => ({ ...c, a: c.a.slice(1) }));
        const fg2: FG = (v) => {
          const q = fg([mu, ...v]);
          return { f: q.f, g: q.g.slice(1) };
        };
        const r2 = activeSetMin(fg2, sub, r.x.slice(1), budget);
        if (Number.isFinite(r2.f) && r2.f <= r.f) {
          r = { x: [mu, ...r2.x], f: r2.f };
          kkt = garchKkt(sc, cons, r.x, kinkAt0, budget);
        }
      }
    }
    if (budget.left <= 0) exhausted = true;
    const cand: Cand = { x: r.x, f: r.f, kkt, floored: flooredAt(r.x) };
    budget.left = Math.max(0, budget.left) + reserve;
    // A candidate with more than GARCH_FLOOR_SHARE of its periods at the variance floor is degenerate (its likelihood
    // grows without bound as the floor is lowered): never chosen, only remembered for the refusal.
    if (cand.floored > GARCH_FLOOR_SHARE * n) {
      if (!degenerate || r.f < degenerate.f) degenerate = cand;
      return;
    }
    if (kkt.ok && (!bestOk || r.f < bestOk.f)) bestOk = cand;
    if (!bestAny || r.f < bestAny.f) bestAny = cand;
  };
  // EGARCH keeps 30% of the cap back for the rescue starts below.
  const held = spec.vol === "egarch" ? Math.floor(0.3 * budget.left) : 0;
  budget.left -= held;
  for (let ti = 0; ti < tries.length && budget.left > 0; ti++) {
    // arch's own start may use 40% of the cap, each later one a fair share of what is left (unused shares roll over),
    // so one start on a rugged surface (a non-invertible EGARCH) cannot starve the others of the search that finds the
    // smooth optimum.
    runStart(tries[ti], ti === 0 ? Math.floor(0.4 * budget.left) : Math.floor(budget.left / (tries.length - ti)));
  }
  budget.left = Math.max(0, budget.left) + held;
  // EGARCH rescue: when no start found a point satisfying the KKT conditions, or the best one found lies below a higher
  // point that fails them (a non-invertible recursion, where the likelihood is rugged), eight more starts at or next to
  // the β = 1 face with strong asymmetry of either sign (γ = ±0.6; arch's grid has |γ| ≤ 0.1). From arch's grid every
  // search can slide into the non-invertible region while invertible optima with β ≈ 1 and large |γ| exist (F2 review
  // round 3: a stale-run series refused while such a point satisfies the KKT conditions). Run only then, so smooth
  // fits pay nothing for it.
  const higherAny = (): boolean => !!bestOk && !!bestAny && bestAny !== bestOk && (bestOk.f - bestAny.f) * n > 1e-6;
  if (spec.vol === "egarch" && (!bestOk || higherAny())) {
    const rescue: number[][] = [];
    for (const [a, g, b] of [
      [0.1, -0.6, 0.95],
      [0.1, 0.6, 0.95],
      [0.3, -0.6, 0.95],
      [0.3, 0.6, 0.95],
      [0.5, -0.6, 0.95],
      [0.5, 0.6, 0.95],
      [0.1, -0.6, 1],
      [0.1, 0.6, 1],
    ]) {
      const v = withNu(sc, ybarK, [0, a, g, b]);
      if (garchFeasible(cons, v)) rescue.push(v);
    }
    for (let ri = 0; ri < rescue.length && budget.left > 0; ri++) runStart(rescue[ri], Math.floor(budget.left / (rescue.length - ri)));
  }
  if (!bestOk && degenerate) {
    const d = degenerate;
    return {
      ok: false,
      reason: `The likelihood is unbounded here: at the best parameters found ${d.floored.toLocaleString("en-US")} of the ${n.toLocaleString("en-US")} periods sit at the variance floor (on or within a factor of 100 of arch's lower bound on σ²ₜ), where each period's likelihood grows without limit as the floor is lowered, so the fit and its AIC are not meaningful and no estimates are reported. This happens with long runs of zero or repeated returns (remove them, or fit a stretch without them), or when one huge return lifts arch's floor (sample variance/10⁸) above the typical variance.`,
    };
  }
  const chosen = bestOk ?? bestAny;
  if (!chosen) return { ok: false, reason: "The likelihood could not be evaluated at any feasible parameters for this series." };
  // Named when nothing passed the KKT check and some start's search was cut off by its share of the cap.
  let workLimitHit = !bestOk && exhausted;
  let kkt = chosen.kkt;
  let xk = chosen.x;
  // EGARCH with a mean: an optimum on the kink of |rₜ − μ| reached without the pin can sit 10⁻¹⁴ off the return; put
  // it on the return when that does not lower the likelihood.
  if (kinkAt0) {
    let mu = xk[0];
    let dBest = Infinity;
    for (let i = 0; i < n; i++) {
      const dd = Math.abs(sc.y[i] - xk[0]);
      if (dd < dBest) {
        dBest = dd;
        mu = sc.y[i];
      }
    }
    const snapped = [mu, ...xk.slice(1)];
    const f0 = -garchLls(sc, xk) / n;
    if (dBest > 0 && dBest <= 1e-9 * Math.max(1, Math.abs(mu)) && -garchLls(sc, snapped) / n <= f0 + 1e-13 * Math.max(1, Math.abs(f0))) xk = snapped;
  }
  // A higher likelihood the search reached at a point that fails the first-order conditions (an EGARCH recursion that
  // is not invertible, say): reported beside the estimates, which are the best point that satisfies them.
  const higher = bestOk && bestAny && bestAny !== bestOk && (bestOk.f - bestAny.f) * n > 1e-6 ? bestAny : null;
  // On a bound, BFGS can stop 10⁻¹² outside it (α = −1×10⁻¹², inside the rounding tolerance): move the estimate exactly
  // onto its active rows so no parameter is reported outside the parameter space.
  if (kkt.active.length) {
    const xp = projectOnto(cons, kkt.active, xk);
    const fRaw = (v: number[]): number => -garchLls(sc, v) / n;
    if (xp.every(Number.isFinite) && fRaw(xp) <= fRaw(xk) + 1e-12 * Math.max(1, Math.abs(fRaw(xk)))) xk = xp;
  }
  // Newton polish on the free directions (the null space of the active rows; μ held on its kink for EGARCH with a
  // mean), with the Hessian from central differences of the exact gradient: where the quasi-Newton search stops on a
  // flat ridge (ν between 60 and 100, say), its stopping point depends on rounding, so the same returns typed in other
  // units would stop 10⁻⁶ to 10⁻² away. A step is kept only when it stays feasible, does not lower the likelihood and
  // (from a point that satisfies the KKT conditions) still satisfies them. It also runs from a best point that just misses them (projected gradient under
  // 10⁻²), which the search left on a steep, narrow valley (μ beside a run of 2,000 equal returns) where a Newton step
  // settles it.
  if (Number.isFinite(kkt.worst) && kkt.worst < 1e-2) {
    const W = kkt.active.map((i) => cons[i].a);
    if (kinkAt0) W.push(cons[0].a.map((_, j) => (j === 0 ? 1 : 0)));
    const Z = nullBasis(W, k);
    for (let it = 0; it < 4 && Z.length; it++) {
      const g0 = garchNllGrad(sc, xk);
      if (!Number.isFinite(g0.f)) break;
      const H = zeros(k, k);
      for (let j = 0; j < k; j++) {
        const h = 1e-5 * Math.max(1, Math.abs(xk[j]));
        const xp = xk.slice();
        const xm = xk.slice();
        xp[j] += h;
        xm[j] -= h;
        const gp = garchNllGrad(sc, xp).g;
        const gm = garchNllGrad(sc, xm).g;
        for (let i = 0; i < k; i++) H[i][j] = (gp[i] - gm[i]) / (2 * h);
      }
      const Hz = Z.map((zi) => Z.map((zj) => {
        let acc = 0;
        for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) acc += zi[a] * 0.5 * (H[a][b] + H[b][a]) * zj[b];
        return acc;
      }));
      const gz = Z.map((zi) => zi.reduce((acc, v, t) => acc + v * g0.g[t], 0));
      const dz = solveSmall(Hz, gz.map((v) => -v));
      if (!dz || !dz.every(Number.isFinite)) break;
      const xn = xk.map((v, t) => v + Z.reduce((acc, zi, j) => acc + zi[t] * dz[j], 0));
      if (!garchFeasible(cons, xn)) break;
      // Kept when it raises the likelihood beyond rounding; near the optimum, where −log L/n changes by less than its
      // rounding (10⁻¹⁶ relative), when it shrinks the exact projected gradient without lowering the likelihood beyond it.
      const fn = garchNllGrad(sc, xn).f;
      const tol = 1e-13 * Math.abs(g0.f);
      if (!(fn <= g0.f + tol)) break;
      const kn = garchKkt(sc, cons, xn, kinkAt0);
      if ((kkt.ok && !kn.ok) || !(fn < g0.f - tol || kn.worst < kkt.worst)) break;
      const step = Math.max(...xn.map((v, t) => Math.abs(v - xk[t]) / Math.max(1, Math.abs(xk[t]))));
      xk = xn;
      kkt = kn;
      if (step < 1e-12) break;
    }
  }
  // A polish that settles a point the capped search left just short of the KKT conditions undoes the work-limit flag.
  if (kkt.ok) workLimitHit = false;
  // Boundaries (arch's bounds and constraints) the estimate is on, judged in the canonical units. ω's lower bound is
  // 10⁻⁸·mean r², so for it "near" is relative to the bound itself, not 10⁻⁴ absolute.
  const atBounds: string[] = [];
  const near = (c: LinCon): boolean => {
    const omegaLow = c.label === "ω at its lower bound" && spec.vol !== "egarch";
    return slackOf(c, xk) < (omegaLow ? 1e-4 * Math.abs(c.b) : 1e-4 * Math.max(1, Math.abs(c.b)));
  };
  for (const c of cons) if (near(c) && !atBounds.includes(c.label)) atBounds.push(c.label);
  const params = C.toR(xk);
  const pk = unpack(sc, xk);

  // Covariance as arch computes it (Hessian of −Σ log L / n with statsmodels' steps, scores by forward differences,
  // np.cov with ddof 1), in the canonical units, so the steps are the same relative size whatever the units; then
  // carried to y's units by the Jacobian of the affine map (Σ = M Σ′ Mᵀ).
  const negSum = (v: number[]): number => -garchLls(sc, v);
  let covRobust: M | null = null;
  let covClassic: M | null = null;
  let seWhy: string | undefined;
  const Hs = approxHess3(negSum, xk).map((r) => r.map((v) => v / n));
  const Hinv = Hs.every((r) => r.every(Number.isFinite)) ? inverse(Hs) : null;
  if (!Hinv) seWhy = "the numerical Hessian of the log likelihood is singular at the estimate";
  else {
    const f0 = new Float64Array(n);
    garchLls(sc, xk, f0);
    const scores: Float64Array[] = [];
    for (let j = 0; j < k; j++) {
      const hj = Math.pow(EPS, 1 / 2) * Math.max(Math.abs(xk[j]), 0.1);
      const xp = xk.slice();
      xp[j] += hj;
      const f1 = new Float64Array(n);
      garchLls(sc, xp, f1);
      const g = new Float64Array(n);
      for (let t = 0; t < n; t++) g[t] = -(f1[t] - f0[t]) / hj;
      scores.push(g);
    }
    const S = zeros(k, k);
    const means = scores.map((g) => g.reduce((a, b) => a + b, 0) / n);
    for (let a = 0; a < k; a++)
      for (let b = a; b < k; b++) {
        let acc = 0;
        for (let t = 0; t < n; t++) acc += (scores[a][t] - means[a]) * (scores[b][t] - means[b]);
        S[a][b] = S[b][a] = acc / (n - 1);
      }
    const rob = mul(mul(Hinv, S), Hinv);
    const ok = (d: number): boolean => Number.isFinite(d) && d > 0;
    if (Hinv.every((r, i) => ok(r[i] / n)) && rob.every((r, i) => ok(r[i] / n))) {
      const toUnits = (cov: M): M => mul(mul(C.M, cov), tr(C.M));
      covClassic = toUnits(Hinv.map((r) => r.map((v) => v / n)));
      covRobust = toUnits(rob.map((r) => r.map((v) => v / n)));
    } else seWhy = "the estimated covariance matrix is not positive definite at the estimate (often a parameter on a boundary)";
  }

  // Everything below in the canonical units, then mapped to y's: residuals /kc, variances /kc², log L + n ln kc.
  const residK = new Float64Array(n);
  const sigma2K = new Float64Array(n);
  const llfK = garchLls(sc, xk, undefined, { resid: residK, sigma2: sigma2K });
  // Periods where the recursion sits on arch's variance bounds: there the likelihood has kinks (not smooth).
  let clamped = 0;
  let floored = 0;
  for (let t = 0; t < n; t++) {
    if (sigma2K[t] < GARCH_NEAR_FLOOR * sc.lower[t]) floored++;
    if (sigma2K[t] <= sc.lower[t] || sigma2K[t] > sc.upper[t]) clamped++;
  }
  // EGARCH invertibility (Wintenberger 2013): the sample mean of ln|∂ln σ²ₜ₊₁/∂ln σ²ₜ| = ln|β − (α|zₜ| + γzₜ)/2|. At 0 or
  // above the recursion does not contract: the fitted variances depend explosively on the parameters and the likelihood
  // is rugged (no smooth maximum to find).
  const lyap = spec.vol === "egarch" ? egarchLyap(sc, xk) : NaN;
  const persistence = spec.vol === "garch" ? pk.alpha + pk.beta : spec.vol === "gjr" ? pk.alpha + pk.gamma / 2 + pk.beta : pk.beta;
  // One step past the sample with no bound (arch's _one_step_forecast appends bounds [0, ∞)).
  const eT = residK[n - 1];
  let f1: number;
  if (spec.vol === "egarch") {
    const z = eT / Math.sqrt(sigma2K[n - 1]);
    f1 = Math.exp(Math.min(pk.omega + pk.alpha * (Math.abs(z) - SQRT2_OV_PI) + pk.gamma * z + pk.beta * Math.log(sigma2K[n - 1]), LNSIGMA_MAX));
  } else f1 = Math.max(0, pk.omega + pk.alpha * eT * eT + (eT < 0 ? pk.gamma * eT * eT : 0) + pk.beta * sigma2K[n - 1]);
  const forecastK = [f1];
  if (spec.vol !== "egarch") for (let h = 1; h < GARCH_MAX_H; h++) forecastK.push(pk.omega + persistence * forecastK[h - 1]);

  const seOf = (cov: M | null): number[] | null => {
    if (!cov) return null;
    const out = cov.map((r, i) => Math.sqrt(r[i]));
    return out.every((v) => Number.isFinite(v) && v > 0) ? out : null;
  };
  const seR = seOf(covRobust);
  const seC = seOf(covClassic);
  if ((covRobust && !seR) || (covClassic && !seC)) seWhy = "the estimated covariance matrix is not positive definite at the estimate";
  const kc = C.kc;
  const toVar = (v: number): number => v / kc / kc;
  const sigma2 = sigma2K.map(toVar);
  const resid = residK.map((v) => v / kc);
  return {
    ok: true,
    spec,
    names,
    params,
    llf: llfK + n * C.lnkc,
    seRobust: seR,
    seClassic: seC,
    seWhy,
    sigma2,
    resid,
    backcast: spec.vol === "egarch" ? sc.backcast - 2 * C.lnkc : toVar(sc.backcast),
    n,
    converged: kkt.ok,
    kktGradient: kkt.worst,
    workLimitHit,
    higherNonKkt: higher ? { llf: -higher.f * n + n * C.lnkc, noninvertible: spec.vol === "egarch" && egarchLyap(sc, higher.x) >= 0 } : null,
    clamped,
    floored,
    egarchLyapunov: lyap,
    atBounds,
    persistence,
    forecast: forecastK.map(toVar),
    scale: kc,
  };
}

/**
 * The KKT check fitGarch applies, at given parameters in the units of y (checked in the canonical units, garchCanon):
 * whether it passes and the largest projected-gradient component of −log L/n. For tests: also the exact gradient there
 * (canonical units) with a central-difference one beside it, and the log likelihood in y's units and in the canonical
 * units with the factor kc (log L′ = log L − n ln kc).
 */
export function garchKktAt(
  y: ArrayLike<number>,
  spec: GarchSpec,
  x: number[],
): { ok: boolean; worst: number; grad: number[]; numGrad: number[]; llf: number; llfCanon: number; kc: number } {
  const C = garchCanon(Float64Array.from(y), spec, x.length);
  if (!C) throw new Error("garchKktAt: the series cannot be rescaled");
  const s = C.sR;
  const xk = C.toK(x);
  const r = garchKkt(C.s, C.cons, xk, spec.vol === "egarch" && s.km === 1);
  const grad = garchNllGrad(C.s, xk).g;
  const numGrad = xk.map((v, i) => {
    const h = 1e-6 * Math.max(1, Math.abs(v));
    const xp = xk.slice();
    const xm = xk.slice();
    xp[i] += h;
    xm[i] -= h;
    return (-garchLls(C.s, xp) + garchLls(C.s, xm)) / C.s.n / (2 * h);
  });
  return { ok: r.ok && garchFeasible(C.cons, xk), worst: r.worst, grad, numGrad, llf: garchLls(s, x), llfCanon: garchLls(C.s, xk), kc: C.kc };
}

/** Log likelihood and arch's covariances at FIXED parameters (the oracle's am.fix / compute_param_cov check). */
export function garchAtParams(y: ArrayLike<number>, spec: GarchSpec, x: number[]): { llf: number; covRobust: M; covClassic: M } | null {
  const s = garchSetup(Float64Array.from(y), spec);
  const n = s.n;
  const llf = garchLls(s, x);
  const H = approxHess3((v) => -garchLls(s, v), x).map((r) => r.map((v) => v / n));
  const Hinv = inverse(H);
  if (!Hinv) return null;
  const k = x.length;
  const f0 = new Float64Array(n);
  garchLls(s, x, f0);
  const scores: Float64Array[] = [];
  for (let j = 0; j < k; j++) {
    const hj = Math.pow(EPS, 1 / 2) * Math.max(Math.abs(x[j]), 0.1);
    const xp = x.slice();
    xp[j] += hj;
    const f1 = new Float64Array(n);
    garchLls(s, xp, f1);
    const g = new Float64Array(n);
    for (let t = 0; t < n; t++) g[t] = -(f1[t] - f0[t]) / hj;
    scores.push(g);
  }
  const means = scores.map((g) => g.reduce((a, b) => a + b, 0) / n);
  const S = zeros(k, k);
  for (let a = 0; a < k; a++)
    for (let b = 0; b < k; b++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += (scores[a][t] - means[a]) * (scores[b][t] - means[b]);
      S[a][b] = acc / (n - 1);
    }
  return {
    llf,
    covRobust: mul(mul(Hinv, S), Hinv).map((r) => r.map((v) => v / n)),
    covClassic: Hinv.map((r) => r.map((v) => v / n)),
  };
}

// ================================================================ VAR

export const VAR_MAX_K = 5;
export const VAR_MAX_P = 12;
export const VAR_MAX_N = 5000;
export const VAR_MAX_H = 24;

export interface VarFit {
  K: number;
  p: number;
  /** Observations used (rows after the lags and any offset). */
  nobs: number;
  /** (1 + Kp) × K: row 0 the constants, then lag 1 of every variable, lag 2, … */
  B: M;
  /** Σᵤ with the degrees-of-freedom correction (T − Kp − 1), statsmodels sigma_u. */
  sigmaU: M;
  sigmaMle: M;
  dfResid: number;
  xtxInv: M;
  resid: M;
}

/** OLS VAR(p) with a constant on cols (K series of equal length), dropping `offset` leading rows first. */
export function fitVarOls(cols: ArrayLike<number>[], p: number, offset = 0): VarFit | null {
  const K = cols.length;
  const N = cols[0].length;
  const T = N - p - offset;
  const m = 1 + K * p;
  if (T <= 0) return null;
  const X: M = [];
  const Y: M = [];
  for (let t = offset + p; t < N; t++) {
    const row = [1];
    for (let l = 1; l <= p; l++) for (let j = 0; j < K; j++) row.push(cols[j][t - l]);
    X.push(row);
    Y.push(cols.map((c) => c[t]));
  }
  const ls = lstsq(X, Y);
  if (!ls) return null;
  const dfResid = T - m;
  const sse = mul(tr(ls.resid), ls.resid);
  const sigmaU = sse.map((r) => r.map((v) => (dfResid > 0 ? v / dfResid : NaN)));
  const sigmaMle = sse.map((r) => r.map((v) => v / T));
  return { K, p, nobs: T, B: ls.B, sigmaU, sigmaMle, dfResid, xtxInv: ls.xtxInv, resid: ls.resid };
}

function logdetSpd(a: M): number {
  const L = cholesky(a);
  if (!L) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += 2 * Math.log(L[i][i]);
  return s;
}

export interface LagOrderRow {
  p: number;
  aic: number;
  bic: number;
  hqic: number;
  fpe: number;
}

/** statsmodels' largest estimable maxlags: (n − K − 1) // (1 + K). */
export function varMaxEstimable(n: number, K: number): number {
  return Math.floor((n - K - 1) / (1 + K));
}

/** statsmodels VAR.select_order(maxlags, trend="c"): every p on the common sample n − maxlags. */
export function varSelectOrder(cols: ArrayLike<number>[], maxlags: number): { rows: LagOrderRow[]; selected: { aic: number; bic: number; hqic: number; fpe: number } } | Refusal {
  const K = cols.length;
  const N = cols[0].length;
  // Every p uses the same rows (t = maxlags…n − 1) and the first 1 + Kp columns of the VAR(maxlags) design, so ONE QR
  // gives every residual cross-product: ε̂ᵀε̂ for the first c columns = Σ_{i ≥ c} (QᵀY)ᵢ(QᵀY)ᵢᵀ.
  const X: M = [];
  const Y: M = [];
  for (let t = maxlags; t < N; t++) {
    const row = [1];
    for (let l = 1; l <= maxlags; l++) for (let j = 0; j < K; j++) row.push(cols[j][t - l]);
    X.push(row);
    Y.push(cols.map((c) => c[t]));
  }
  const qr = householderQr(X, Y);
  if (!qr) return { ok: false, reason: `The VAR(${maxlags}) regression is singular (a series is constant or an exact combination of the others).` };
  const nobs = N - maxlags;
  const m = 1 + K * maxlags;
  const tail = zeros(K, K);
  for (let i = nobs - 1; i >= m; i--) for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) tail[a][b] += qr.QtY[a][i] * qr.QtY[b][i];
  const sse: M[] = new Array(m + 1);
  sse[m] = tail.map((r) => r.slice());
  for (let c = m - 1; c >= 0; c--) {
    const prev = sse[c + 1];
    sse[c] = prev.map((r, a) => r.map((v, b) => v + qr.QtY[a][c] * qr.QtY[b][c]));
  }
  const rows: LagOrderRow[] = [];
  for (let p = 0; p <= maxlags; p++) {
    const c = 1 + K * p;
    const dfResid = nobs - c;
    const sigmaMle = sse[c].map((r) => r.map((v) => v / nobs));
    const f = { dfResid, sigmaMle };
    const free = p * K * K + K;
    const ld = f.dfResid ? logdetSpd(f.sigmaMle) : -Infinity;
    if (Number.isNaN(ld)) return { ok: false, reason: `The residual covariance of VAR(${p}) is singular (two series move exactly together).` };
    const dfModel = K * p + 1;
    rows.push({
      p,
      aic: ld + (2 / nobs) * free,
      bic: ld + (Math.log(nobs) / nobs) * free,
      hqic: ld + ((2 * Math.log(Math.log(nobs))) / nobs) * free,
      fpe: f.dfResid ? Math.pow((nobs + dfModel) / f.dfResid, K) * Math.exp(ld) : Infinity,
    });
  }
  const arg = (key: keyof LagOrderRow): number => {
    let b = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i][key] < rows[b][key]) b = i;
    return rows[b].p;
  };
  return { rows, selected: { aic: arg("aic"), bic: arg("bic"), hqic: arg("hqic"), fpe: arg("fpe") } };
}

/** The lag matrices A₁…A_p (K × K each) from B. */
export function varCoefs(f: VarFit): M[] {
  const A: M[] = [];
  for (let l = 0; l < f.p; l++) {
    const a = zeros(f.K, f.K);
    for (let i = 0; i < f.K; i++) for (let j = 0; j < f.K; j++) a[i][j] = f.B[1 + l * f.K + j][i];
    A.push(a);
  }
  return A;
}

/** Largest modulus of the companion matrix's eigenvalues (< 1: stable). */
export function varMaxRoot(f: VarFit): number | null {
  const K = f.K;
  const p = f.p;
  if (p === 0) return 0;
  const A = varCoefs(f);
  const C = zeros(K * p, K * p);
  for (let i = 0; i < K; i++) for (let l = 0; l < p; l++) for (let j = 0; j < K; j++) C[i][l * K + j] = A[l][i][j];
  for (let i = K; i < K * p; i++) C[i][i - K] = 1;
  try {
    const ev = eigenvaluesGeneral(C);
    if (!ev) return null;
    return Math.max(...ev.map((z) => Math.hypot(z.re, z.im)));
  } catch {
    return null;
  }
}

export interface GrangerRow {
  caused: number;
  causing: number;
  F: number;
  df1: number;
  df2: number;
  p: number;
}

/** statsmodels test_causality(caused, [causing], kind="f"): Wald / p with df (p, K·df_resid). */
export function varGranger(f: VarFit, caused: number, causing: number): GrangerRow {
  const { K, p } = f;
  const idx: number[] = [];
  for (let l = 0; l < p; l++) idx.push(1 + l * K + causing);
  const b = idx.map((r) => f.B[r][caused]);
  const V = idx.map((r1) => idx.map((r2) => f.xtxInv[r1][r2] * f.sigmaU[caused][caused]));
  const Vi = inverse(V);
  let w = NaN;
  if (Vi) {
    w = 0;
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) w += b[i] * Vi[i][j] * b[j];
  }
  const F = w / p;
  const df2 = K * f.dfResid;
  return { caused, causing, F, df1: p, df2, p: fSurvival(F, p, df2) };
}

/** MA(∞) matrices Φ₀ … Φ_H. */
export function varMaRep(f: VarFit, H: number): M[] {
  const A = varCoefs(f);
  const phis: M[] = [eye(f.K)];
  for (let i = 1; i <= H; i++) {
    let acc = zeros(f.K, f.K);
    for (let j = 1; j <= Math.min(i, f.p); j++) {
      const t = mul(phis[i - j], A[j - 1]);
      acc = acc.map((r, a) => r.map((v, c) => v + t[a][c]));
    }
    phis.push(acc);
  }
  return phis;
}

export interface VarIrf {
  /** Θ_h = Φ_h P (h = 0…H), [h][response][impulse]. */
  orth: M[];
  /** Asymptotic SEs of Θ_h, same layout (Lütkepohl 2005, Prop. 3.6 / eq. 3.7.8, as statsmodels codes it). */
  se: M[];
  /** FEVD [response][h−1][impulse] for h = 1…H (h = 1 is the impact period). */
  fevd: M[];
  P: M;
}

/** Orthogonalised impulse responses (Cholesky of Σᵤ in the column order), asymptotic SEs and the FEVD. */
export function varIrf(f: VarFit, H: number): VarIrf | Refusal {
  const { K, p } = f;
  const P = cholesky(f.sigmaU);
  if (!P) return { ok: false, reason: "The residual covariance matrix is not positive definite, so it has no Cholesky factor (two series move exactly together)." };
  const phis = varMaRep(f, H);
  const orth = phis.map((ph) => mul(ph, P));
  // Companion matrix A (Kp × Kp) and its transpose powers.
  const A = varCoefs(f);
  const Ac = zeros(K * p, K * p);
  for (let i = 0; i < K; i++) for (let l = 0; l < p; l++) for (let j = 0; j < K; j++) Ac[i][l * K + j] = A[l][i][j];
  for (let i = K; i < K * p; i++) Ac[i][i - K] = 1;
  const AcT = tr(Ac);
  const apow: M[] = [eye(K * p)];
  for (let i = 1; i < H; i++) apow.push(mul(apow[i - 1], AcT));
  const apowK = apow.map((m) => m.slice(0, K));
  // cov_a = kron((ZᵀZ)⁻¹ without the constant, Σᵤ); cov_sig = 2 D⁺ (Σ ⊗ Σ) D⁺ᵀ; H = Lᵀ (L (kron(I,P)K + kron(P,I)) Lᵀ)⁻¹.
  const zz = f.xtxInv.slice(1).map((r) => r.slice(1));
  const covA = kron(zz, f.sigmaU);
  const nv = (K * (K + 1)) / 2;
  const Lk = zeros(nv, K * K);
  const D = zeros(K * K, nv);
  {
    let r = 0;
    for (let c = 0; c < K; c++)
      for (let i = c; i < K; i++) {
        Lk[r][c * K + i] = 1;
        D[c * K + i][r] = 1;
        D[i * K + c][r] = 1;
        r++;
      }
  }
  const Kkk = zeros(K * K, K * K);
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) Kkk[i * K + j][j * K + i] = 1;
  const Ik = eye(K);
  const inner = kron(Ik, P);
  const tmp = mul(inner, Kkk);
  const kp = kron(P, Ik);
  const sum = tmp.map((r, i) => r.map((v, j) => v + kp[i][j]));
  const Bm = mul(mul(Lk, sum), tr(Lk));
  const BmInv = inverse(Bm);
  const DtDinv = inverse(mul(tr(D), D));
  if (!BmInv || !DtDinv) return { ok: false, reason: "The impulse-response covariance could not be formed (a singular matrix)." };
  const Hm = mul(tr(Lk), BmInv);
  const Dplus = mul(DtDinv, tr(D));
  const covSig = mul(mul(Dplus, kron(f.sigmaU, f.sigmaU)), tr(Dplus)).map((r) => r.map((v) => 2 * v));
  const PIk = kron(tr(P), Ik);
  const se: M[] = [];
  for (let i = 0; i <= H; i++) {
    let cov = zeros(K * K, K * K);
    if (i > 0) {
      let G = zeros(K * K, K * K * p);
      for (let m = 0; m < i; m++) {
        const piece = kron(apowK[i - 1 - m], phis[m]);
        G = G.map((r, a) => r.map((v, b) => v + piece[a][b]));
      }
      const Ci = mul(PIk, G);
      cov = mul(mul(Ci, covA), tr(Ci));
    }
    const Cbar = mul(kron(Ik, phis[i]), Hm);
    const bp = mul(mul(Cbar, covSig), tr(Cbar));
    const s = zeros(K, K);
    for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
      const d = c * K + r;
      s[r][c] = Math.sqrt(Math.max(0, cov[d][d] + bp[d][d] / f.nobs));
    }
    se.push(s);
  }
  // FEVD: cumulative squared orthogonalised responses over the forecast-error variance (Σ_s Φ_s Σᵤ Φ_sᵀ).
  const fevd: M[] = Array.from({ length: K }, () => zeros(H, K));
  const cum = zeros(K, K);
  const mse = new Array<number>(K).fill(0);
  for (let h = 0; h < H; h++) {
    const th = orth[h];
    const v = mul(mul(phis[h], f.sigmaU), tr(phis[h]));
    for (let r = 0; r < K; r++) {
      mse[r] += v[r][r];
      for (let c = 0; c < K; c++) cum[r][c] += th[r][c] * th[r][c];
      for (let c = 0; c < K; c++) fevd[r][h][c] = cum[r][c] / mse[r];
    }
  }
  return { orth, se, fevd, P };
}

/** Two-sided normal p-value (statsmodels VARResults.pvalues). */
export const normalP = (z: number): number => 2 * normalCdfPrecise(-Math.abs(z));

// ================================================================ cointegration

export type CointTrend = "c" | "ct";

/*
 * MacKinnon (1994) p-value surfaces and MacKinnon (2010) critical values for N = 1…6 I(1) variables, copied from
 * statsmodels/tsa/adfvalues.py (BSD-3, Copyright (c) 2009-2018 statsmodels Developers): tau_star/min/max, the smallp
 * and largep rows AFTER statsmodels' import scaling (small × [1, 1, 10⁻²], large × [1, 10⁻¹, 10⁻¹, 10⁻²]), and the
 * tau_2010 rows [1%, 5%, 10%] × [β∞, β₁, β₂, β₃]. Sources: MacKinnon, J.G. (1994), "Approximate asymptotic
 * distribution functions for unit-root and cointegration tests", JBES 12(2): 167–176; MacKinnon, J.G. (2010),
 * "Critical values for cointegration tests", Queen's Economics Working Paper 1227. Jest checks every entry against the
 * values scripts/ts2-oracle.py extracts from statsmodels.
 */
export const MACKINNON_N: Record<
  CointTrend,
  { tauStar: number[]; tauMin: number[]; tauMax: number[]; smallp: number[][]; largep: number[][]; crit2010: number[][][] }
> = {
  c: {
    tauStar: [-1.61, -2.62, -3.13, -3.47, -3.78, -3.93],
    tauMin: [-18.83, -18.86, -23.48, -28.07, -25.96, -23.27],
    tauMax: [2.74, 0.92, 0.55, 0.61, 0.79, 1],
    smallp: [
      [2.1659, 1.4412, 0.038269],
      [2.92, 1.5012, 0.039796],
      [3.4699, 1.4856, 0.03164],
      [3.9673, 1.4777, 0.026315],
      [4.5509, 1.5338, 0.029545],
      [5.1399, 1.6036, 0.034445],
    ],
    largep: [
      [1.7339, 0.93202, -0.12745, -0.010368],
      [2.1945, 0.64695, -0.29198, -0.042377],
      [2.5893, 0.45168, -0.36529, -0.050074],
      [3.0387, 0.45452, -0.33666, -0.041921],
      [3.5049, 0.52098, -0.29158, -0.033468],
      [3.9489, 0.58933, -0.25359, -0.02721],
    ],
    crit2010: [
      [[-3.43035, -6.5393, -16.786, -79.433], [-2.86154, -2.8903, -4.234, -40.04], [-2.56677, -1.5384, -2.809, 0]],
      [[-3.89644, -10.9519, -33.527, 0], [-3.33613, -6.1101, -6.823, 0], [-3.04445, -4.2412, -2.72, 0]],
      [[-4.29374, -14.4354, -33.195, 47.433], [-3.74066, -8.5632, -10.852, 27.982], [-3.45218, -6.2143, -3.718, 0]],
      [[-4.64332, -18.1031, -37.972, 0], [-4.096, -11.2349, -11.175, 0], [-3.8102, -8.3931, -4.137, 0]],
      [[-4.95756, -21.8883, -45.142, 0], [-4.41519, -14.0405, -12.575, 0], [-4.13157, -10.7417, -3.784, 0]],
      [[-5.24568, -25.6688, -57.737, 88.639], [-4.70693, -16.9178, -17.492, 60.007], [-4.42501, -13.1875, -5.104, 27.877]],
    ],
  },
  ct: {
    tauStar: [-2.89, -3.19, -3.5, -3.65, -3.8, -4.36],
    tauMin: [-16.18, -21.15, -25.37, -26.63, -26.53, -26.18],
    tauMax: [0.7, 0.63, 0.71, 0.93, 1.19, 1.42],
    smallp: [
      [3.2512, 1.6047, 0.049588],
      [3.6646, 1.5419, 0.036448],
      [4.0983, 1.5173, 0.029898],
      [4.5844, 1.5338, 0.028796],
      [5.0722, 1.5634, 0.029472],
      [5.53, 1.5914, 0.030392],
    ],
    largep: [
      [2.5261, 0.61654, -0.37956, -0.060285],
      [2.85, 0.5272, -0.36622, -0.051695],
      [3.221, 0.5255, -0.32685, -0.041501],
      [3.652, 0.59758, -0.27483, -0.032081],
      [4.0712, 0.66428, -0.23464, -0.02546],
      [4.4735, 0.71757, -0.20681, -0.021196],
    ],
    crit2010: [
      [[-3.95877, -9.0531, -28.428, -134.155], [-3.41049, -4.3904, -9.036, -45.374], [-3.12705, -2.5856, -3.925, -22.38]],
      [[-4.32762, -15.4387, -35.679, 0], [-3.78057, -9.5106, -12.074, 0], [-3.49631, -7.0815, -7.538, 21.892]],
      [[-4.66305, -18.7688, -49.793, 104.244], [-4.1189, -11.8922, -19.031, 77.332], [-3.83511, -9.0723, -8.504, 35.403]],
      [[-4.9694, -22.4694, -52.599, 51.314], [-4.42871, -14.5876, -18.228, 39.647], [-4.14633, -11.25, -9.873, 54.109]],
      [[-5.25276, -26.2183, -59.631, 50.646], [-4.71537, -17.3569, -22.66, 91.359], [-4.43422, -13.6078, -10.238, 76.781]],
      [[-5.51727, -29.976, -75.222, 202.253], [-4.98228, -20.305, -25.224, 132.03], [-4.70233, -16.1253, -9.836, 94.272]],
    ],
  },
};

const polyLow = (c: number[], x: number): number => {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i];
  return s;
};

/** statsmodels mackinnonp(tau, regression, N). */
export function mackinnonPN(tau: number, reg: CointTrend, N: number): number {
  const t = MACKINNON_N[reg];
  if (tau > t.tauMax[N - 1]) return 1;
  if (tau < t.tauMin[N - 1]) return 0;
  return normalCdfPrecise(polyLow(tau <= t.tauStar[N - 1] ? t.smallp[N - 1] : t.largep[N - 1], tau));
}

/** statsmodels mackinnoncrit(N, regression, nobs): [1%, 5%, 10%]. */
export function mackinnonCritN(reg: CointTrend, N: number, nobs: number): [number, number, number] {
  const rows = MACKINNON_N[reg].crit2010[N - 1];
  const v = rows.map((r) => polyLow(r, 1 / nobs));
  return [v[0], v[1], v[2]];
}

export const COINT_MAX_K = 6;
export const COINT_MAX_N = 5000;

export interface EngleGrangerResult {
  ok: true;
  /** Cointegrating regression: constant, [trend], then the slopes on the other series. */
  coef: number[];
  r2: number;
  resid: Float64Array;
  stat: number;
  p: number;
  crit: [number, number, number];
  usedLag: number;
  maxLag: number;
  adfNobs: number;
}

/** statsmodels coint(y0, y1, trend, autolag="aic"): OLS of y0 on [y1, trend terms], ADF ("n") on the residuals. */
export function engleGranger(y0: ArrayLike<number>, others: ArrayLike<number>[], trend: CointTrend): EngleGrangerResult | Refusal {
  const n = y0.length;
  const k = 1 + others.length;
  const X: M = [];
  const Y: M = [];
  for (let t = 0; t < n; t++) {
    const row = [1];
    if (trend === "ct") row.push(t + 1);
    for (const o of others) row.push(o[t]);
    X.push(row);
    Y.push([y0[t]]);
  }
  const ls = lstsq(X, Y);
  if (!ls) return { ok: false, reason: "The cointegrating regression is singular (a series is constant or an exact combination of the others)." };
  const resid = Float64Array.from(ls.resid.map((r) => r[0]));
  let ym = 0;
  for (let t = 0; t < n; t++) ym += y0[t];
  ym /= n;
  let tss = 0;
  let ssr = 0;
  for (let t = 0; t < n; t++) {
    tss += (y0[t] - ym) * (y0[t] - ym);
    ssr += resid[t] * resid[t];
  }
  const r2 = 1 - ssr / tss;
  if (!(r2 < 1 - 100 * Math.sqrt(EPS))) {
    return { ok: false, reason: "The first series is (almost) an exact linear combination of the others (R² within 10⁻⁶ of 1), so the residual test is not reliable (statsmodels reports τ = −∞ here)." };
  }
  const adf = adfTest(resid, { regression: "n", autolag: true });
  if (!adf.ok) return { ok: false, reason: `The residual ADF test failed: ${adf.reason}` };
  return {
    ok: true,
    coef: ls.B.map((r) => r[0]),
    r2,
    resid,
    stat: adf.stat,
    p: mackinnonPN(adf.stat, trend, k),
    crit: mackinnonCritN(trend, k, n - 1),
    usedLag: adf.usedLag,
    maxLag: adf.maxLag,
    adfNobs: adf.nobs,
  };
}

/*
 * Osterwald-Lenum (1992) critical values for the Johansen trace (SJT) and maximum-eigenvalue (SJA) statistics,
 * columns 90%, 95%, 99%, rows n − r = 1…6, for det_order −1 (no deterministic terms), 0 (constant) and 1 (linear
 * trend): copied from statsmodels/tsa/coint_tables.py (c_sjt, c_sja; BSD-3, Copyright (c) 2009-2018 statsmodels
 * Developers). Osterwald-Lenum, M. (1992), "A note with quantiles of the asymptotic distribution of the maximum
 * likelihood cointegration rank test statistics", Oxford Bulletin of Economics and Statistics 54(3): 461–472.
 */
export const JOHANSEN_SJT: Record<"-1" | "0" | "1", number[][]> = {
  "-1": [[2.9762, 4.1296, 6.9406], [10.4741, 12.3212, 16.364], [21.7781, 24.2761, 29.5147], [37.0339, 40.1749, 46.5716], [56.2839, 60.0627, 67.6367], [79.5329, 83.9383, 92.7136]],
  "0": [[2.7055, 3.8415, 6.6349], [13.4294, 15.4943, 19.9349], [27.0669, 29.7961, 35.4628], [44.4929, 47.8545, 54.6815], [65.8202, 69.8189, 77.8202], [91.109, 95.7542, 104.9637]],
  "1": [[2.7055, 3.8415, 6.6349], [16.1619, 18.3985, 23.1485], [32.0645, 35.0116, 41.0815], [51.6492, 55.2459, 62.5202], [75.1027, 79.3422, 87.7748], [102.4674, 107.3429, 116.9829]],
};
export const JOHANSEN_SJA: Record<"-1" | "0" | "1", number[][]> = {
  "-1": [[2.9762, 4.1296, 6.9406], [9.4748, 11.2246, 15.0923], [15.7175, 17.7961, 22.2519], [21.837, 24.1592, 29.0609], [27.916, 30.4428, 35.7359], [33.9271, 36.6301, 42.2333]],
  "0": [[2.7055, 3.8415, 6.6349], [12.2971, 14.2639, 18.52], [18.8928, 21.1314, 25.865], [25.1236, 27.5858, 32.7172], [31.2379, 33.8777, 39.3693], [37.2786, 40.0763, 45.8662]],
  "1": [[2.7055, 3.8415, 6.6349], [15.0006, 17.1481, 21.7465], [21.8731, 24.2522, 29.2631], [28.2398, 30.8151, 36.193], [34.4202, 37.1646, 42.8612], [40.5244, 43.4183, 49.4095]],
};

export type JohansenDet = -1 | 0 | 1;
export const JOHANSEN_MAX_KDIFF = 12;

export interface JohansenResult {
  ok: true;
  eig: number[];
  trace: number[];
  maxEig: number[];
  /** Per rank r = 0…K−1: [90%, 95%, 99%]. */
  cvt: number[][];
  cvm: number[][];
  T: number;
}

/** Residuals of each column of Y on the columns of X (X may have no columns). */
function residOn(Y: M, X: M): M | null {
  if (!X.length || !X[0].length) return Y.map((r) => r.slice());
  const ls = lstsq(X, Y);
  return ls ? ls.resid : null;
}

/** statsmodels' detrend(y, order): residuals on vander(linspace(−1, 1, T), order + 1); order −1 leaves y. */
function detrendCols(Y: M, order: number): M | null {
  if (order < 0 || !Y.length || !Y[0].length) return Y.map((r) => r.slice());
  const T = Y.length;
  const X = Y.map((_, i) => {
    const x = T === 1 ? -1 : -1 + (2 * i) / (T - 1);
    return order === 0 ? [1] : [x, 1];
  });
  return residOn(Y, X);
}

/** statsmodels coint_johansen(endog, det_order, k_ar_diff), copied step by step (see the Conventions it prints). */
export function johansen(cols: ArrayLike<number>[], det: JohansenDet, kdiff: number): JohansenResult | Refusal {
  const K = cols.length;
  const n = cols[0].length;
  let Yl: M = [];
  for (let t = 0; t < n; t++) Yl.push(cols.map((c) => c[t]));
  const f = det > -1 ? 0 : det;
  const d0 = detrendCols(Yl, det);
  if (!d0) return { ok: false, reason: "Detrending the levels failed (a singular regression)." };
  Yl = d0;
  const dx: M = [];
  for (let t = 1; t < n; t++) dx.push(Yl[t].map((v, j) => v - Yl[t - 1][j]));
  // lagmat(dx, k)[k:]: row t (t ≥ k) holds dx[t−1], …, dx[t−k].
  const z: M = [];
  for (let t = kdiff; t < dx.length; t++) {
    const row: number[] = [];
    for (let l = 1; l <= kdiff; l++) row.push(...dx[t - l]);
    z.push(row);
  }
  const zD = kdiff > 0 ? detrendCols(z, f) : z;
  const dxD = detrendCols(dx.slice(kdiff), f);
  if (!zD || !dxD) return { ok: false, reason: "Detrending the differences failed (a singular regression)." };
  const lx = Yl.slice(0, n - kdiff).slice(1);
  const lxD = detrendCols(lx, f);
  if (!lxD) return { ok: false, reason: "Detrending the lagged levels failed (a singular regression)." };
  // One QR of the lagged differences serves both regressions: [ΔXₜ | Xₜ₋ₖ] on ΔXₜ₋₁…ΔXₜ₋ₖ.
  const both = residOn(dxD.map((r, i) => [...r, ...lxD[i]]), zD);
  if (!both) return { ok: false, reason: "The auxiliary regressions on the lagged differences are singular (too many lags for the sample, or a constant series)." };
  const r0t = both.map((r) => r.slice(0, K));
  const rkt = both.map((r) => r.slice(K));
  const T = rkt.length;
  const cross = (a: M, b: M): M => mul(tr(a), b).map((r) => r.map((v) => v / T));
  const skk = cross(rkt, rkt);
  const sk0 = cross(rkt, r0t);
  const s00 = cross(r0t, r0t);
  const s00i = inverse(s00);
  const L = cholesky(skk);
  if (!s00i || !L) return { ok: false, reason: "A moment matrix of the Johansen regressions is singular (two series move exactly together, or a series is constant)." };
  const Li = lowerInverse(L);
  let Mx = mul(mul(mul(mul(Li, sk0), s00i), tr(sk0)), tr(Li));
  Mx = Mx.map((r, i) => r.map((v, j) => (v + Mx[j][i]) / 2));
  const es = eigenSymmetric(Mx);
  if (!es) return { ok: false, reason: "The Johansen eigenvalue problem could not be solved." };
  const eig = es.values.slice().sort((a, b) => b - a);
  if (!eig.every((v) => Number.isFinite(v) && v > -1e-12 && v < 1)) return { ok: false, reason: "A Johansen eigenvalue is outside [0, 1) (a series is an exact combination of the others)." };
  const trace: number[] = [];
  const maxEig: number[] = [];
  const cvt: number[][] = [];
  const cvm: number[][] = [];
  const key = String(det) as "-1" | "0" | "1";
  for (let i = 0; i < K; i++) {
    let s = 0;
    for (let j = i; j < K; j++) s += Math.log(1 - eig[j]);
    trace.push(-T * s);
    maxEig.push(-T * Math.log(1 - eig[i]));
    cvt.push(JOHANSEN_SJT[key][K - i - 1]);
    cvm.push(JOHANSEN_SJA[key][K - i - 1]);
  }
  return { ok: true, eig, trace, maxEig, cvt, cvm, T };
}
