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
import { bfgs } from "./arima";
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

/** The most observations a GARCH fit takes (each likelihood is one pass; the fit and the SEs take ~5,000 passes). */
export const GARCH_MAX_N = 5000;
export const GARCH_MIN_N = 100;
export const GARCH_MAX_H = 250;
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
  return { spec, y, n, backcast: egarch ? Math.log(bc) : bc, lower, upper, omegaLo, omegaHi, km: spec.mean === "constant" ? 1 : 0 };
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
        v = s.upper[t] + Math.log(v) - Math.log(s.upper[t]);
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
    else if (v > s.upper[t]) v = Number.isFinite(v) ? s.upper[t] + Math.log(v / s.upper[t]) : s.upper[t] + 1000;
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

/** arch's parameter bounds and linear constraints; true when x satisfies them (with a strict stationarity bound). */
function garchFeasible(s: GarchSetup, x: number[]): boolean {
  const p = unpack(s, x);
  if (!x.every(Number.isFinite)) return false;
  if (p.omega < s.omegaLo || p.omega > s.omegaHi) return false;
  if (s.spec.dist === "t" && (p.nu < 2.05 || p.nu > 500)) return false;
  if (s.spec.vol === "egarch") return p.beta >= 0 && p.beta < 1;
  if (p.alpha < 0 || p.alpha > 1 || p.beta < 0 || p.beta > 1) return false;
  if (s.spec.vol === "gjr" && (p.gamma < -1 || p.gamma > 2 || p.alpha + p.gamma < 0)) return false;
  return p.alpha + p.gamma / 2 + p.beta < 1;
}

/** arch's volatility starting grid: the best Gaussian log likelihood over α × γ × (α + γ/2 + β) (or β for EGARCH). */
function garchStart(s: GarchSetup, ybar: number): number[] {
  const n = s.n;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = s.y[i] - (s.km ? ybar : 0);
  let ms = 0;
  for (let i = 0; i < n; i++) ms += r[i] * r[i];
  ms /= n;
  const gauss: GarchSetup = { ...s, spec: { ...s.spec, dist: "normal", mean: "zero" }, y: r, km: 0 };
  const alphas = [0.01, 0.05, 0.1, 0.2];
  let best = -Infinity;
  let bestV: number[] = [];
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
        if (ll > best) {
          best = ll;
          bestV = v;
        }
      }
  const out: number[] = [];
  if (s.km) out.push(ybar);
  out.push(...bestV);
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
  converged: boolean;
  /** Parameters within 10⁻⁴ of a bound or constraint (SEs there are not reliable). */
  atBounds: string[];
  /** α + β (GARCH), α + γ/2 + β (GJR), β (EGARCH). */
  persistence: number;
  /** One-step-ahead σ²_{T+1} and the analytic k-step path (GARCH/GJR; EGARCH has h = 1 only). */
  forecast: number[];
  /** The internal scaling factor applied to the data (1 when none). */
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

/** Fits a GARCH-family model to y (already in the units the user typed; rescaled internally when far from 1). */
export function fitGarch(yIn: ArrayLike<number>, spec: GarchSpec): GarchFit | Refusal {
  const n = yIn.length;
  if (n < GARCH_MIN_N) return { ok: false, reason: `A GARCH fit needs at least ${GARCH_MIN_N} returns; the series has ${n}.` };
  if (n > GARCH_MAX_N) return { ok: false, reason: `The series has ${n.toLocaleString("en-US")} returns; a GARCH fit here takes at most ${GARCH_MAX_N.toLocaleString("en-US")} (the most recent ${GARCH_MAX_N.toLocaleString("en-US")} would do).` };
  let rms = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(yIn[i])) return { ok: false, reason: `Return ${i + 1} is not a finite number.` };
    rms += yIn[i] * yIn[i];
  }
  rms = Math.sqrt(rms / n);
  if (!(rms > 0)) return { ok: false, reason: "Every return is zero, so there is no volatility to model." };
  // Equivariance: fit c·y with c a power of 10 bringing the RMS into [1, 10) when it is outside [0.1, 1000) (decimal returns, say).
  const scale = rms >= 0.1 && rms < 1000 ? 1 : Math.pow(10, -Math.floor(Math.log10(rms)));
  if (!Number.isFinite(scale) || scale <= 0) return { ok: false, reason: "The returns are too large or too small to scale." };
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = yIn[i] * scale;
  let ybar = 0;
  for (let i = 0; i < n; i++) ybar += y[i];
  ybar /= n;
  let vy = 0;
  for (let i = 0; i < n; i++) vy += (y[i] - ybar) * (y[i] - ybar);
  if (!(vy > 0) && spec.mean === "constant") return { ok: false, reason: "The returns are constant, so there is no volatility to model." };

  const s = garchSetup(y, spec);
  const names = garchParamNames(spec);
  const k = names.length;
  const nll = (x: number[]): number => {
    if (!garchFeasible(s, x)) return Infinity;
    const v = -garchLls(s, x) / n;
    return Number.isFinite(v) ? v : Infinity;
  };
  const x0 = garchStart(s, ybar);
  if (!garchFeasible(s, x0)) return { ok: false, reason: "No feasible starting point was found for this series." };
  const budget = { left: 40000 };
  const counted = (x: number[]): number => {
    budget.left--;
    return nll(x);
  };
  let best = bfgs(counted, x0, GARCH_MAX_ITER, budget);
  // A second pass from the optimum restarts the inverse-Hessian approximation (polishes a long valley).
  if (budget.left > 0 && Number.isFinite(best.f)) {
    const again = bfgs(counted, best.x, GARCH_MAX_ITER, budget);
    if (again.f <= best.f) best = { ...again, converged: again.converged || best.converged };
  }
  if (!Number.isFinite(best.f)) return { ok: false, reason: "The likelihood could not be evaluated at any feasible parameters for this series." };
  const x = best.x;
  const pr = unpack(s, x);

  // Boundaries (arch's bounds and constraints).
  const atBounds: string[] = [];
  const near = (v: number, b: number): boolean => Math.abs(v - b) < 1e-4 * Math.max(1, Math.abs(b));
  if (spec.vol !== "egarch") {
    if (near(pr.alpha, 0)) atBounds.push("α = 0");
    if (near(pr.beta, 0)) atBounds.push("β = 0");
    if (spec.vol === "gjr" && near(pr.alpha + pr.gamma, 0)) atBounds.push("α + γ = 0");
    if (near(pr.alpha + pr.gamma / 2 + pr.beta, 1)) atBounds.push("α + γ/2 + β = 1");
  } else {
    if (near(pr.beta, 1)) atBounds.push("β = 1");
    if (near(pr.beta, 0)) atBounds.push("β = 0");
  }
  if (near(pr.omega, s.omegaLo)) atBounds.push("ω at its lower bound");
  if (spec.dist === "t" && near(pr.nu, 500)) atBounds.push("ν = 500 (the errors look normal)");
  if (spec.dist === "t" && near(pr.nu, 2.05)) atBounds.push("ν = 2.05");

  // Covariance as arch computes it: Hessian of −Σ log L / n, scores by forward differences, np.cov (ddof 1).
  const negSum = (v: number[]): number => -garchLls(s, v);
  let covRobust: M | null = null;
  let covClassic: M | null = null;
  let seWhy: string | undefined;
  const Hs = approxHess3(negSum, x).map((r) => r.map((v) => v / n));
  const Hinv = Hs.every((r) => r.every(Number.isFinite)) ? inverse(Hs) : null;
  if (!Hinv) seWhy = "the numerical Hessian of the log likelihood is singular at the estimate";
  else {
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
      covClassic = Hinv.map((r) => r.map((v) => v / n));
      covRobust = rob.map((r) => r.map((v) => v / n));
    } else seWhy = "the estimated covariance matrix is not positive definite at the estimate (often a parameter on a boundary)";
  }

  const resid = new Float64Array(n);
  const sigma2 = new Float64Array(n);
  const llfScaled = garchLls(s, x, undefined, { resid, sigma2 });
  const persistence = spec.vol === "garch" ? pr.alpha + pr.beta : spec.vol === "gjr" ? pr.alpha + pr.gamma / 2 + pr.beta : pr.beta;
  // One step past the sample with no bound (arch's _one_step_forecast appends bounds [0, ∞)).
  const eT = resid[n - 1];
  let f1: number;
  if (spec.vol === "egarch") {
    const z = eT / Math.sqrt(sigma2[n - 1]);
    f1 = Math.exp(Math.min(pr.omega + pr.alpha * (Math.abs(z) - SQRT2_OV_PI) + pr.gamma * z + pr.beta * Math.log(sigma2[n - 1]), LNSIGMA_MAX));
  } else f1 = Math.max(0, pr.omega + pr.alpha * eT * eT + (eT < 0 ? pr.gamma * eT * eT : 0) + pr.beta * sigma2[n - 1]);
  const forecastScaled = [f1];
  if (spec.vol !== "egarch") for (let h = 1; h < GARCH_MAX_H; h++) forecastScaled.push(pr.omega + persistence * forecastScaled[h - 1]);

  // Back to the user's units: μ/c, ω/c² (EGARCH: ω − 2(1 − β) ln c), llf − n ln c, variances /c².
  const c = scale;
  const back = (v: number[]): number[] => {
    const out = v.slice();
    let i = 0;
    if (s.km) out[i++] /= c;
    if (spec.vol === "egarch") out[i] = out[i] - 2 * (1 - unpack(s, v).beta) * Math.log(c);
    else out[i] /= c * c;
    return out;
  };
  const params = back(x);
  // The back-transform is linear, so the covariances map exactly by its Jacobian J (Σ' = J Σ Jᵀ).
  const J = eye(k);
  {
    let i = 0;
    if (s.km) J[i][i++] = 1 / c;
    if (spec.vol === "egarch") J[i][s.km + 3] = 2 * Math.log(c);
    else J[i][i] = 1 / (c * c);
  }
  const seScale = (cov: M | null): number[] | null => {
    if (!cov) return null;
    const out = mul(mul(J, cov), tr(J)).map((r, i) => Math.sqrt(r[i]));
    return out.every((v) => Number.isFinite(v) && v > 0) ? out : null;
  };
  const seR = seScale(covRobust);
  const seC = seScale(covClassic);
  if ((covRobust && !seR) || (covClassic && !seC)) seWhy = "the estimated covariance matrix is not positive definite at the estimate";
  for (let i = 0; i < n; i++) {
    sigma2[i] /= c * c;
    resid[i] /= c;
  }
  return {
    ok: true,
    spec,
    names,
    params,
    llf: llfScaled + n * Math.log(c),
    seRobust: seR,
    seClassic: seC,
    seWhy,
    sigma2,
    resid,
    backcast: spec.vol === "egarch" ? s.backcast - 2 * Math.log(c) : s.backcast / (c * c),
    n,
    converged: best.converged,
    atBounds,
    persistence,
    forecast: forecastScaled.map((v) => v / (c * c)),
    scale: c,
  };
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
