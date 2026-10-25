/**
 * ARIMA(p, d, q) by exact Gaussian maximum likelihood (Release E3b, calculator ts-arima).
 *
 * CONVENTION (matched to statsmodels 0.15 to 1e−9 in the llf): SIMPLE DIFFERENCING. The series is differenced d times,
 * w = (1 − L)ᵈ y, and w − μ follows a stationary, invertible ARMA(p, q):
 *     (w_t − μ) = φ₁(w_{t−1} − μ) + … + φ_p(w_{t−p} − μ) + ε_t + θ₁ε_{t−1} + … + θ_qε_{t−q},  ε ~ N(0, σ²).
 * μ is the MEAN of w (statsmodels ARIMA's trend 'c' when d = 0 and its drift 't' when d = 1; R's arima prints the same
 * mean form), not the SARIMAX intercept c = μ(1 − Σφ). The likelihood is that of the n − d differenced values, equal to
 * statsmodels SARIMAX(y, (p, d, q), simple_differencing=True). statsmodels' DEFAULT ARIMA instead keeps the d
 * integrated states in the state vector under an approximate-diffuse prior of variance 10⁶, which is not scale-free:
 * its llf differs from the exact one by about 10⁻⁸ relative at unit scale and by a large amount for a series in the
 * millions, so it cannot be matched exactly and is not followed.
 *
 * Likelihood: the Kalman filter on the ARMA state space in statsmodels' (Harvey) form — state dimension
 * r = max(p, q + 1), transition T with φ down the first column and ones on the superdiagonal, selection
 * R = (1, θ₁, …, θ_{r−1})′, observation Z = (1, 0, …, 0) — started from the stationary covariance, the solution of the
 * discrete Lyapunov equation P = TPT′ + RR′ (solved exactly as a linear system in vec P). Once P stops changing the
 * filter runs in steady state (as statsmodels' does).
 *
 * Estimation: σ² is concentrated out (σ̂² = Σv²/f ÷ N); the other parameters are optimised by BFGS in statsmodels'
 * unconstrained space (Monahan 1984 / Jones 1980 maps: AR = constrain(u), MA = −constrain(u), so every iterate is
 * stationary and invertible), from Hannan–Rissanen and zero starting values; the best maximum is kept. The series is
 * centred and scaled first (the likelihood is shifted by −N·log scale, the MLE is unchanged), so 10¹² and 10⁻¹² behave.
 */
import { normalQuantile } from "./probdist";

export type ArimaTrend = "mean" | "drift" | "none";

export interface ArimaSpec {
  p: number;
  d: number;
  q: number;
  /** "mean" needs d = 0, "drift" needs d = 1. */
  trend: ArimaTrend;
}

export interface ArimaParams {
  /** Mean of the differenced series (0 when there is no trend term). */
  mu: number;
  phi: number[];
  theta: number[];
  sigma2: number;
}

export const ARIMA_MAX_P = 5;
export const ARIMA_MAX_Q = 5;
export const ARIMA_MAX_D = 2;
export const ARIMA_MAX_H = 200;
/** BFGS iterations per start before the fit is refused as not converged. */
export const ARIMA_MAX_ITER = 400;
/**
 * Likelihood work allowed per fit, in filter steps × r² (r = max(p, q + 1)): about 3 seconds on the build machine.
 * Optimisation and the Hessian share it; a fit that would exceed it is refused by name.
 */
export const ARIMA_WORK_BUDGET = 3e9;

const LOG2PI = Math.log(2 * Math.PI);

// ---------------------------------------------------------------- transforms (statsmodels tools.py, ported)

/** statsmodels constrain_stationary_univariate: unconstrained reals → coefficients of a stationary AR polynomial. */
export function constrainStationary(u: number[]): number[] {
  const n = u.length;
  if (!n) return [];
  const r = u.map((x) => x / Math.sqrt(1 + x * x));
  let prev: number[] = [];
  for (let k = 0; k < n; k++) {
    const cur = new Array<number>(k + 1);
    for (let i = 0; i < k; i++) cur[i] = prev[i] + r[k] * prev[k - i - 1];
    cur[k] = r[k];
    prev = cur;
  }
  return prev.map((v) => -v);
}

/** The inverse (statsmodels unconstrain_stationary_univariate); null when the coefficients are not stationary. */
export function unconstrainStationary(c: number[]): number[] | null {
  const n = c.length;
  if (!n) return [];
  const y: number[][] = [];
  for (let k = 0; k < n; k++) y.push(new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) y[n - 1][i] = -c[i];
  for (let k = n - 1; k > 0; k--) {
    const ykk = y[k][k];
    const den = 1 - ykk * ykk;
    if (!(den > 0)) return null;
    for (let i = 0; i < k; i++) y[k - 1][i] = (y[k][i] - ykk * y[k][k - i - 1]) / den;
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const r = y[k][k];
    if (!(Math.abs(r) < 1) || !Number.isFinite(r)) return null;
    out.push(r / Math.sqrt(1 - r * r));
  }
  return out;
}

/** True when 1 − φ₁z − … − φ_p z^p has every root outside the unit circle (the partial autocorrelations are inside ±1). */
export function isStationary(phi: number[]): boolean {
  return unconstrainStationary(phi) !== null;
}

/** True when 1 + θ₁z + … + θ_q z^q has every root outside the unit circle. */
export function isInvertible(theta: number[]): boolean {
  return unconstrainStationary(theta.map((t) => -t)) !== null;
}

// ---------------------------------------------------------------- small dense linear algebra

/** Solves A x = b by Gaussian elimination with partial pivoting (A is copied); null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    if (piv !== c) [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Inverse of a symmetric positive-definite matrix by Cholesky; null if it is not positive definite. */
export function invertSpd(A: number[][]): number[][] | null {
  const n = A.length;
  const L: number[][] = A.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  const inv: number[][] = A.map(() => new Array<number>(n).fill(0));
  for (let c = 0; c < n; c++) {
    const y = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = i === c ? 1 : 0;
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * inv[k][c];
      inv[i][c] = s / L[i][i];
    }
  }
  return inv;
}

// ---------------------------------------------------------------- the ARMA state space and Kalman filter

interface StateSpace {
  r: number;
  /** First column of T (φ padded with zeros to r). */
  t0: Float64Array;
  /** R = (1, θ₁, …, θ_{r−1}). */
  R: Float64Array;
}

function stateSpace(phi: number[], theta: number[]): StateSpace {
  const r = Math.max(phi.length, theta.length + 1);
  const t0 = new Float64Array(r);
  for (let i = 0; i < phi.length; i++) t0[i] = phi[i];
  const R = new Float64Array(r);
  R[0] = 1;
  for (let j = 0; j < theta.length; j++) R[j + 1] = theta[j];
  return { r, t0, R };
}

/** T·M for the companion T (row i: φ_i·M[0] + M[i+1]). */
function tTimes(ss: StateSpace, M: Float64Array[]): Float64Array[] {
  const { r, t0 } = ss;
  const out: Float64Array[] = [];
  for (let i = 0; i < r; i++) {
    const row = new Float64Array(r);
    for (let j = 0; j < r; j++) row[j] = t0[i] * M[0][j] + (i + 1 < r ? M[i + 1][j] : 0);
    out.push(row);
  }
  return out;
}

/** T·P·T′ + RR′. */
function predictCov(ss: StateSpace, P: Float64Array[]): Float64Array[] {
  const A = tTimes(ss, P); // T P
  const { r, t0, R } = ss;
  const out: Float64Array[] = [];
  for (let i = 0; i < r; i++) out.push(new Float64Array(r));
  // (T P) T′: column j of T′ is row j of T.
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < r; j++) out[i][j] = A[i][0] * t0[j] + (j + 1 < r ? A[i][j + 1] : 0) + R[i] * R[j];
  }
  return out;
}

/** The stationary covariance: P = TPT′ + RR′, solved as (I − T⊗T) vec P = vec RR′. Null if not solvable. */
export function stationaryCov(phi: number[], theta: number[]): Float64Array[] | null {
  const ss = stateSpace(phi, theta);
  const { r, t0, R } = ss;
  const T: number[][] = [];
  for (let i = 0; i < r; i++) {
    const row = new Array<number>(r).fill(0);
    row[0] = t0[i];
    if (i + 1 < r) row[i + 1] = 1;
    T.push(row);
  }
  const n2 = r * r;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < r; j++) {
      const row = new Array<number>(n2).fill(0);
      row[i * r + j] += 1;
      for (let k = 0; k < r; k++) {
        if (T[i][k] === 0) continue;
        for (let l = 0; l < r; l++) if (T[j][l] !== 0) row[k * r + l] -= T[i][k] * T[j][l];
      }
      A.push(row);
      b.push(R[i] * R[j]);
    }
  }
  const x = solveLinear(A, b);
  if (!x) return null;
  const P: Float64Array[] = [];
  for (let i = 0; i < r; i++) {
    const row = new Float64Array(r);
    for (let j = 0; j < r; j++) row[j] = 0.5 * (x[i * r + j] + x[j * r + i]);
    P.push(row);
  }
  if (!(P[0][0] >= 1 - 1e-9)) return null;
  return P;
}

export interface FilterResult {
  /** Σ log f_t and Σ v_t²/f_t with σ² = 1 (f_t ≥ 1). */
  sumLogF: number;
  sumV2F: number;
  N: number;
  /** v_t/√f_t (when asked for). */
  std?: Float64Array;
  /** Predicted state and covariance for period N + 1 (σ² = 1 units). */
  aNext: Float64Array;
  PNext: Float64Array[];
}

/**
 * The Kalman filter for z (already centred: z_t = w_t − μ) under ARMA(φ, θ) with σ² = 1. Null when the start
 * covariance cannot be formed (a non-stationary φ).
 */
export function kalmanArma(z: ArrayLike<number>, phi: number[], theta: number[], keepStd = false): FilterResult | null {
  const ss = stateSpace(phi, theta);
  const r = ss.r;
  const P0 = stationaryCov(phi, theta);
  if (!P0) return null;
  let P: Float64Array[] = P0.map((row) => Float64Array.from(row));
  const mk = (): Float64Array[] => Array.from({ length: r }, () => new Float64Array(r));
  const Pf = mk();
  const Abuf = mk();
  let Pnext = mk();
  const R = ss.R;
  const a = new Float64Array(r);
  const af = new Float64Array(r);
  const t0 = ss.t0;
  const N = z.length;
  const std = keepStd ? new Float64Array(N) : undefined;
  let sumLogF = 0;
  let sumV2F = 0;
  let steady = false;
  const K = new Float64Array(r); // P[:,0]/F, frozen in steady state
  let F = 1;
  let logF = 0;
  let sqrtF = 1;
  for (let t = 0; t < N; t++) {
    if (!steady) {
      F = P[0][0];
      logF = Math.log(F);
      sqrtF = Math.sqrt(F);
      for (let i = 0; i < r; i++) K[i] = P[i][0] / F;
    }
    const v = z[t] - a[0];
    sumLogF += logF;
    sumV2F += (v * v) / F;
    if (std) std[t] = v / sqrtF;
    // filtered state, then predicted: a ← T(a + K v), in place (row i of T: φ_i in column 0, 1 in column i + 1)
    for (let i = 0; i < r; i++) af[i] = a[i] + K[i] * v;
    const f0 = af[0];
    for (let i = 0; i < r - 1; i++) a[i] = t0[i] * f0 + af[i + 1];
    a[r - 1] = t0[r - 1] * f0;
    if (!steady) {
      // Pf = P − P[:,0]P[0,:]/F; A = T·Pf; Pn = A·T′ + RR′ — in preallocated buffers.
      for (let i = 0; i < r; i++) {
        const Pi = P[i];
        const Pfi = Pf[i];
        const c = Pi[0] / F;
        for (let j = 0; j < r; j++) Pfi[j] = Pi[j] - c * P[0][j];
      }
      for (let i = 0; i < r; i++) {
        const Ai = Abuf[i];
        const ti = t0[i];
        const next = i + 1 < r ? Pf[i + 1] : null;
        for (let j = 0; j < r; j++) Ai[j] = ti * Pf[0][j] + (next ? next[j] : 0);
      }
      let change = 0;
      for (let i = 0; i < r; i++) {
        const Ai = Abuf[i];
        const Pni = Pnext[i];
        for (let j = 0; j < r; j++) {
          const val = Ai[0] * t0[j] + (j + 1 < r ? Ai[j + 1] : 0) + R[i] * R[j];
          Pni[j] = val;
          const dlt = Math.abs(val - P[i][j]);
          if (dlt > change) change = dlt;
        }
      }
      const tmp = P;
      P = Pnext;
      Pnext = tmp;
      if (change < 1e-14 * P[0][0]) {
        steady = true;
        F = P[0][0];
        logF = Math.log(F);
        sqrtF = Math.sqrt(F);
        for (let i = 0; i < r; i++) K[i] = P[i][0] / F;
      }
    }
  }
  return { sumLogF, sumV2F, N, std, aNext: a, PNext: P };
}

/** Full log likelihood for given σ² (in the units of z). */
function llfFromFilter(f: FilterResult, sigma2: number): number {
  return -0.5 * f.N * LOG2PI - 0.5 * f.sumLogF - 0.5 * f.N * Math.log(sigma2) - f.sumV2F / (2 * sigma2);
}

/** Concentrated log likelihood (σ² at its MLE). */
function llfConcentrated(f: FilterResult): number {
  const s2 = f.sumV2F / f.N;
  return -0.5 * f.N * (LOG2PI + 1) - 0.5 * f.sumLogF - 0.5 * f.N * Math.log(s2);
}

// ---------------------------------------------------------------- data preparation

/** (1 − L)ᵈ y. */
export function difference(y: ArrayLike<number>, d: number): Float64Array {
  let w = Float64Array.from(y as ArrayLike<number>);
  for (let k = 0; k < d; k++) {
    const nw = new Float64Array(Math.max(0, w.length - 1));
    for (let i = 1; i < w.length; i++) nw[i - 1] = w[i] - w[i - 1];
    w = nw;
  }
  return w;
}

interface Scaled {
  z: Float64Array;
  center: number;
  scale: number;
}

function standardize(w: Float64Array, withMean: boolean): Scaled | null {
  const N = w.length;
  let c = 0;
  for (let i = 0; i < N; i++) c += w[i] / N;
  let ss = 0;
  for (let i = 0; i < N; i++) {
    const e = w[i] - c;
    ss += e * e;
  }
  const s = Math.sqrt(ss / N);
  if (!(s > 0) || !Number.isFinite(s) || !Number.isFinite(c)) return null;
  // Below ~1e-13 of the level the differences are rounding noise, not a series.
  if (s < 1e-13 * Math.abs(c)) return null;
  // Without a mean term the model has no centre: scale only (by the root mean square).
  const center = withMean ? c : 0;
  const scale = withMean ? s : Math.sqrt(s * s + c * c);
  const z = new Float64Array(N);
  for (let i = 0; i < N; i++) z[i] = (w[i] - center) / scale;
  return { z, center, scale };
}

// ---------------------------------------------------------------- the likelihood at given parameters

/**
 * The exact log likelihood of the differenced series at the given parameters (original units). This is the function
 * pinned to statsmodels' llf at statsmodels' parameters. Null when φ is not stationary.
 */
export function arimaLoglike(y: ArrayLike<number>, spec: ArimaSpec, prm: ArimaParams): number | null {
  const w = difference(y, spec.d);
  const N = w.length;
  const z = new Float64Array(N);
  const mu = spec.trend === "none" ? 0 : prm.mu;
  for (let i = 0; i < N; i++) z[i] = w[i] - mu;
  // Filter in scaled units for range safety: f and v scale together, so only σ² and the Jacobian term change.
  let s = 0;
  for (let i = 0; i < N; i++) s = Math.max(s, Math.abs(z[i]));
  if (!(s > 0) || !Number.isFinite(s)) return null;
  for (let i = 0; i < N; i++) z[i] /= s;
  const f = kalmanArma(z, prm.phi, prm.theta);
  if (!f) return null;
  return llfFromFilter(f, prm.sigma2 / (s * s)) - N * Math.log(s);
}

// ---------------------------------------------------------------- estimation

export interface ArimaFit {
  ok: true;
  spec: ArimaSpec;
  params: ArimaParams;
  llf: number;
  /** n − d. */
  nobs: number;
  /** Number of estimated parameters, σ² included. */
  k: number;
  aic: number;
  /** null when N − k − 1 ≤ 0 (statsmodels returns infinity). */
  aicc: number | null;
  bic: number;
  /** SEs in the order mu?, phi…, theta…, sigma2; null with a reason when the Hessian is unusable. */
  se: number[] | null;
  seWhy?: string;
  /** Standardized one-step errors v_t/√(σ²f_t), N of them. */
  stdResid: Float64Array;
  iterations: number;
  notes: string[];
  /** For forecasting. */
  _w: Float64Array;
  _y: Float64Array;
}

export type ArimaFitResult = ArimaFit | { ok: false; reason: string };

interface Packed {
  p: number;
  q: number;
  hasMu: boolean;
}

function unpack(x: number[], pk: Packed): { phi: number[]; theta: number[]; muZ: number } {
  const phi = constrainStationary(x.slice(0, pk.p));
  const theta = constrainStationary(x.slice(pk.p, pk.p + pk.q)).map((v) => -v);
  const muZ = pk.hasMu ? x[pk.p + pk.q] : 0;
  return { phi, theta, muZ };
}

function negMeanLlf(z: Float64Array, x: number[], pk: Packed): number {
  const { phi, theta, muZ } = unpack(x, pk);
  const zz = muZ === 0 ? z : z.map((v) => v - muZ);
  const f = kalmanArma(zz, phi, theta);
  if (!f) return Infinity;
  const v = -llfConcentrated(f) / f.N;
  return Number.isFinite(v) ? v : Infinity;
}

/** Ordinary least squares by the normal equations; null when singular. */
function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0]?.length ?? 0;
  if (!k) return [];
  const A: number[][] = [];
  for (let i = 0; i < k; i++) A.push(new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let t = 0; t < X.length; t++) {
    const row = X[t];
    for (let i = 0; i < k; i++) {
      b[i] += row[i] * y[t];
      for (let j = 0; j <= i; j++) A[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) A[i][j] = A[j][i];
  return solveLinear(A, b);
}

/** Hannan–Rissanen starting values on the centred, scaled series (null when a stage fails). */
export function hannanRissanen(z: Float64Array, p: number, q: number): { phi: number[]; theta: number[] } | null {
  const N = z.length;
  if (p === 0 && q === 0) return { phi: [], theta: [] };
  let resid: Float64Array | null = null;
  let m = 0;
  if (q > 0) {
    m = Math.min(Math.max(p + q + 1, Math.round(12 * Math.pow(N / 100, 0.25))), 20, Math.floor(N / 4));
    if (m < 1) return null;
    const X: number[][] = [];
    const yy: number[] = [];
    for (let t = m; t < N; t++) {
      const row: number[] = [];
      for (let i = 1; i <= m; i++) row.push(z[t - i]);
      X.push(row);
      yy.push(z[t]);
    }
    const a = ols(X, yy);
    if (!a) return null;
    resid = new Float64Array(N);
    for (let t = m; t < N; t++) {
      let e = z[t];
      for (let i = 1; i <= m; i++) e -= a[i - 1] * z[t - i];
      resid[t] = e;
    }
  }
  const start = m + q + p;
  if (N - start < p + q + 2) return null;
  const X: number[][] = [];
  const yy: number[] = [];
  for (let t = Math.max(start, p); t < N; t++) {
    const row: number[] = [];
    for (let i = 1; i <= p; i++) row.push(z[t - i]);
    for (let j = 1; j <= q; j++) row.push(resid ? resid[t - j] : 0);
    X.push(row);
    yy.push(z[t]);
  }
  const b = ols(X, yy);
  if (!b) return null;
  return { phi: b.slice(0, p), theta: b.slice(p) };
}

interface BfgsResult {
  x: number[];
  f: number;
  converged: boolean;
  iterations: number;
  /** Stopped because the shared evaluation budget ran out. */
  exhausted?: boolean;
}

/**
 * BFGS with central-difference gradients and a backtracking line search, bounded by `maxIter` and by a shared
 * evaluation budget (`budget.left`, decremented by the caller's objective).
 */
function bfgs(fn: (x: number[]) => number, x0: number[], maxIter: number, budget: { left: number }): BfgsResult {
  const k = x0.length;
  let x = x0.slice();
  let f = fn(x);
  if (!Number.isFinite(f)) return { x, f, converged: false, iterations: 0 };
  if (k === 0) return { x, f, converged: true, iterations: 0 };
  const grad = (xx: number[], fx: number): number[] => {
    const g = new Array<number>(k);
    for (let i = 0; i < k; i++) {
      const h = 1e-6 * Math.max(1, Math.abs(xx[i]));
      const xp = xx.slice();
      const xm = xx.slice();
      xp[i] += h;
      xm[i] -= h;
      const fp = fn(xp);
      const fm = fn(xm);
      if (Number.isFinite(fp) && Number.isFinite(fm)) g[i] = (fp - fm) / (2 * h);
      else if (Number.isFinite(fp)) g[i] = (fp - fx) / h;
      else if (Number.isFinite(fm)) g[i] = (fx - fm) / h;
      else g[i] = 0;
    }
    return g;
  };
  let g = grad(x, f);
  let Hinv: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row = new Array<number>(k).fill(0);
    row[i] = 1;
    Hinv.push(row);
  }
  let small = 0;
  const hist: number[] = [f];
  for (let it = 1; it <= maxIter; it++) {
    if (budget.left <= 0) return { x, f, converged: false, iterations: it - 1, exhausted: true };
    const gnorm = Math.max(...g.map(Math.abs));
    if (gnorm < 1e-9) return { x, f, converged: true, iterations: it - 1 };
    let dir = Hinv.map((row) => -row.reduce((s, v, j) => s + v * g[j], 0));
    let slope = dir.reduce((s, v, i) => s + v * g[i], 0);
    if (!(slope < 0)) {
      // Not a descent direction: restart from steepest descent.
      Hinv = Hinv.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
      dir = g.map((v) => -v);
      slope = -g.reduce((s, v) => s + v * v, 0);
    }
    // Cap the step in the unconstrained space.
    const dmax = Math.max(...dir.map(Math.abs));
    let step = dmax > 5 ? 5 / dmax : 1;
    let xn = x;
    let fn1 = f;
    let accepted = false;
    for (let ls = 0; ls < 60; ls++) {
      xn = x.map((v, i) => v + step * dir[i]);
      fn1 = fn(xn);
      if (Number.isFinite(fn1) && fn1 <= f + 1e-4 * step * slope) {
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) {
      // No decrease along the direction: at a minimum to working precision when the gradient is small.
      return { x, f, converged: gnorm < 1e-6, iterations: it };
    }
    const gn = grad(xn, fn1);
    const s = xn.map((v, i) => v - x[i]);
    const yv = gn.map((v, i) => v - g[i]);
    const sy = s.reduce((acc, v, i) => acc + v * yv[i], 0);
    if (sy > 1e-18) {
      const Hy = Hinv.map((row) => row.reduce((acc, v, j) => acc + v * yv[j], 0));
      const yHy = yv.reduce((acc, v, i) => acc + v * Hy[i], 0);
      const rho = 1 / sy;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          Hinv[i][j] += rho * rho * (sy + yHy) * s[i] * s[j] - rho * (Hy[i] * s[j] + s[i] * Hy[j]);
        }
      }
    }
    const df = f - fn1;
    x = xn;
    f = fn1;
    g = gn;
    if (df <= 1e-15 * Math.max(1, Math.abs(f))) small++;
    else small = 0;
    if (small >= 4) return { x, f, converged: Math.max(...g.map(Math.abs)) < 1e-5, iterations: it };
    // A ridge (an over-parametrised ARMA with near-cancelling roots): 30 iterations that gain almost nothing.
    hist.push(f);
    if (hist.length > 30 && hist[hist.length - 31] - f < 1e-12 * Math.max(1, Math.abs(f))) {
      return { x, f, converged: Math.max(...g.map(Math.abs)) < 1e-4, iterations: it };
    }
  }
  return { x, f, converged: false, iterations: maxIter };
}

/** Packs a start (φ, θ, μ_z) into the unconstrained vector; null when φ or θ is outside the region. */
function packStart(phi: number[], theta: number[], muZ: number, pk: Packed): number[] | null {
  const u = unconstrainStationary(phi);
  const v = unconstrainStationary(theta.map((t) => -t));
  if (!u || !v) return null;
  const x = [...u, ...v];
  if (pk.hasMu) x.push(muZ);
  return x.every(Number.isFinite) ? x : null;
}

/** A start pulled inside the region by shrinking toward zero (up to 20 times). */
function packShrunk(phi: number[], theta: number[], pk: Packed): number[] | null {
  let f = 1;
  for (let i = 0; i < 20; i++) {
    const x = packStart(
      phi.map((v) => v * f),
      theta.map((v) => v * f),
      0,
      pk,
    );
    if (x && x.every((v) => Math.abs(v) < 50)) return x;
    f *= 0.8;
  }
  return null;
}

/** Fits ARIMA(p, d, q) by exact maximum likelihood. */
export function fitArima(y: ArrayLike<number>, spec: ArimaSpec): ArimaFitResult {
  const { p, d, q, trend } = spec;
  const yy = Float64Array.from(y as ArrayLike<number>);
  const w = difference(yy, d);
  const N = w.length;
  const hasMu = trend !== "none";
  const k = p + q + (hasMu ? 1 : 0) + 1;
  const sc = standardize(w, hasMu);
  if (!sc) {
    return {
      ok: false,
      reason:
        d === 0
          ? "The series is constant, so an ARMA model has nothing to fit."
          : `The series differenced ${d === 1 ? "once" : "twice"} is constant (the data lie on a ${d === 1 ? "straight line" : "quadratic"}), so there is nothing left for the ARMA part to fit.`,
    };
  }
  const { z, center, scale } = sc;
  const pk: Packed = { p, q, hasMu };
  // Work budget, in filter steps × r² (deterministic, so a refusal does not depend on the machine).
  const r = Math.max(p, q + 1);
  const unit = N * r * r;
  const hessEvals = 2 * k * k + 1;
  const minEvals = hessEvals + 60 * (2 * (k - 1) + 4);
  if (minEvals * unit > ARIMA_WORK_BUDGET) {
    const maxN = Math.floor(ARIMA_WORK_BUDGET / (minEvals * r * r));
    return {
      ok: false,
      reason: `ARIMA(${p}, ${d}, ${q}) on ${N.toLocaleString("en-US")} observations needs more computation than the pane allows; use at most ${maxN.toLocaleString("en-US")} rows for these orders, or smaller p and q.`,
    };
  }
  const budget = { left: Math.floor(ARIMA_WORK_BUDGET / unit) - hessEvals };
  const fn = (x: number[]): number => {
    budget.left--;
    return negMeanLlf(z, x, pk);
  };

  const starts: number[][] = [];
  const hr = hannanRissanen(z, p, q);
  if (hr) {
    const x = packStart(hr.phi, hr.theta, 0, pk) ?? packShrunk(hr.phi, hr.theta, pk);
    if (x) starts.push(x);
    if (q > 0 && p > 0) {
      const xa = packShrunk(hr.phi, new Array<number>(q).fill(0), pk);
      if (xa) starts.push(xa);
    }
  }
  starts.push(new Array<number>(p + q + (hasMu ? 1 : 0)).fill(0));

  const runs: BfgsResult[] = [];
  let iterations = 0;
  let exhausted = false;
  for (const x0 of starts) {
    if (budget.left <= 0) {
      exhausted = true;
      break;
    }
    const res = bfgs(fn, x0, ARIMA_MAX_ITER, budget);
    iterations += res.iterations;
    if (res.exhausted) exhausted = true;
    if (Number.isFinite(res.f)) runs.push(res);
  }
  if (!runs.length) return { ok: false, reason: "The likelihood could not be evaluated at any starting value (an extreme or degenerate series)." };
  runs.sort((a, b) => a.f - b.f);
  // The best converged maximum, provided no unconverged run found a clearly higher likelihood.
  const best = runs.find((x) => x.converged);
  if (!best || best.f > runs[0].f + 1e-10) {
    return {
      ok: false,
      reason: exhausted
        ? `The likelihood maximisation did not converge within the pane's computation limit for ${N.toLocaleString("en-US")} observations, so no estimate is reported. Use fewer rows or smaller p and q.`
        : `The likelihood maximisation did not converge within ${ARIMA_MAX_ITER} iterations from any start, so no estimate is reported. Try a smaller p or q.`,
    };
  }

  const { phi, theta, muZ } = unpack(best.x, pk);
  const zc = muZ === 0 ? z : z.map((v) => v - muZ);
  const filt = kalmanArma(zc, phi, theta, true);
  if (!filt) return { ok: false, reason: "The fitted AR polynomial is not stationary (the optimiser left the region), so no estimate is reported." };
  const s2z = filt.sumV2F / N;
  const llf = llfConcentrated(filt) - N * Math.log(scale);
  const params: ArimaParams = { mu: hasMu ? center + scale * muZ : 0, phi, theta, sigma2: s2z * scale * scale };
  const std = filt.std as Float64Array;
  const sq = Math.sqrt(s2z);
  for (let i = 0; i < N; i++) std[i] /= sq;

  // SEs: the numerical Hessian of the full llf (σ² included) in the constrained parameters, central differences.
  const theta0 = [...(hasMu ? [muZ] : []), ...phi, ...theta, s2z];
  const llfAt = (v: number[]): number => {
    let o = 0;
    const m = hasMu ? v[o++] : 0;
    const ph = v.slice(o, o + p);
    o += p;
    const th = v.slice(o, o + q);
    o += q;
    const s2 = v[o];
    if (!(s2 > 0) || !isStationary(ph) || !isInvertible(th)) return NaN;
    const zz = m === 0 ? z : z.map((x) => x - m);
    const f = kalmanArma(zz, ph, th);
    return f ? llfFromFilter(f, s2) : NaN;
  };
  const hess = numericalHessian(llfAt, theta0);
  let se: number[] | null = null;
  let seWhy: string | undefined;
  if (!hess) seWhy = "a coefficient is at the edge of the stationary or invertible region, where the Hessian cannot be formed";
  else {
    const neg = hess.map((row) => row.map((v) => -v));
    const cov = invertSpd(neg);
    if (!cov) seWhy = "the Hessian of the log likelihood is not negative definite at the maximum (a flat or boundary likelihood)";
    else {
      const jac = [...(hasMu ? [scale] : []), ...new Array<number>(p + q).fill(1), scale * scale];
      se = cov.map((row, i) => Math.sqrt(row[i]) * jac[i]);
      if (!se.every((v) => Number.isFinite(v) && v > 0)) {
        se = null;
        seWhy = "a variance from the inverse Hessian is not positive";
      }
    }
  }

  const aic = -2 * llf + 2 * k;
  const aicc = N - k - 1 > 0 ? -2 * llf + (2 * k * N) / (N - k - 1) : null;
  const bic = -2 * llf + k * Math.log(N);
  const notes: string[] = [];
  const nearUnit = (c: number[]): boolean => {
    const u = unconstrainStationary(c);
    return !u || u.some((v) => Math.abs(v) > 20);
  };
  if (p && nearUnit(phi)) notes.push("The AR part is at the edge of stationarity (a partial autocorrelation within 0.2% of ±1): the series may need one more difference.");
  if (q && nearUnit(theta.map((t) => -t))) notes.push("The MA part is at the edge of invertibility (a partial autocorrelation within 0.2% of ±1): the series may be over-differenced.");
  return { ok: true, spec, params, llf, nobs: N, k, aic, aicc, bic, se, seWhy, stdResid: std, iterations, notes, _w: w, _y: yy };
}

/** Central-difference Hessian; null when any evaluation is not finite. */
function numericalHessian(f: (x: number[]) => number, x: number[]): number[][] | null {
  const k = x.length;
  const h = x.map((v) => 1e-4 * Math.max(Math.abs(v), 0.1));
  const f0 = f(x);
  if (!Number.isFinite(f0)) return null;
  const H: number[][] = [];
  for (let i = 0; i < k; i++) H.push(new Array<number>(k).fill(0));
  const at = (di: number, si: number, dj: number, sj: number): number => {
    const v = x.slice();
    v[di] += si * h[di];
    v[dj] += sj * h[dj];
    return f(v);
  };
  for (let i = 0; i < k; i++) {
    const fp = at(i, 1, i, 0);
    const fm = at(i, -1, i, 0);
    if (!Number.isFinite(fp) || !Number.isFinite(fm)) return null;
    H[i][i] = (fp - 2 * f0 + fm) / (h[i] * h[i]);
    for (let j = 0; j < i; j++) {
      const a = at(i, 1, j, 1);
      const b = at(i, 1, j, -1);
      const c = at(i, -1, j, 1);
      const e = at(i, -1, j, -1);
      if (![a, b, c, e].every(Number.isFinite)) return null;
      H[i][j] = H[j][i] = (a - b - c + e) / (4 * h[i] * h[j]);
    }
  }
  return H;
}

// ---------------------------------------------------------------- forecasting

export interface ArimaForecast {
  mean: number[];
  se: number[];
  lower: number[];
  upper: number[];
  /** z for the interval (1.959963984540054 at 95%). */
  z: number;
}

/**
 * h-step forecasts of the LEVEL y with their standard errors at the given parameters. The ARMA part is forecast from
 * the filter's last predicted state and covariance; the d integrations are applied to the means and, through the full
 * h × h covariance of the differenced forecast errors, to the variances (the past levels are known exactly, which is
 * what an exact-diffuse filter on the undifferenced series gives).
 */
export function arimaForecast(y: ArrayLike<number>, spec: ArimaSpec, prm: ArimaParams, h: number, level = 0.95): ArimaForecast | null {
  const H = Math.max(1, Math.min(ARIMA_MAX_H, Math.floor(h)));
  const yy = Float64Array.from(y as ArrayLike<number>);
  const w = difference(yy, spec.d);
  const N = w.length;
  const mu = spec.trend === "none" ? 0 : prm.mu;
  let s = 0;
  for (let i = 0; i < N; i++) s = Math.max(s, Math.abs(w[i] - mu));
  if (!(s > 0) || !Number.isFinite(s)) return null;
  const z = new Float64Array(N);
  for (let i = 0; i < N; i++) z[i] = (w[i] - mu) / s;
  const f = kalmanArma(z, prm.phi, prm.theta);
  if (!f) return null;
  const ss = stateSpace(prm.phi, prm.theta);
  const r = ss.r;
  const sigma2z = prm.sigma2 / (s * s);
  // Means of the differenced series.
  const wHat: number[] = [];
  let a = f.aNext;
  const V: Float64Array[][] = []; // V[j] = Var(state error at n+1+j)
  let P = f.PNext;
  for (let j = 0; j < H; j++) {
    wHat.push(mu + s * a[0]);
    V.push(P);
    const an = new Float64Array(r);
    for (let i = 0; i < r; i++) an[i] = ss.t0[i] * a[0] + (i + 1 < r ? a[i + 1] : 0);
    a = an;
    P = predictCov(ss, P);
  }
  // C[i][j] = Cov(e_i, e_j) = Z V_i (T′)^{j−i} Z′ for i ≤ j: propagate row 0 of V_i forward.
  const C: number[][] = [];
  for (let i = 0; i < H; i++) C.push(new Array<number>(H).fill(0));
  for (let i = 0; i < H; i++) {
    // u = V_i Z′ (column 0), then u ← T u gives T^{j−i} V_i Z′, whose first entry is C[j][i].
    let u = new Float64Array(r);
    for (let k = 0; k < r; k++) u[k] = V[i][k][0];
    for (let j = i; j < H; j++) {
      C[i][j] = C[j][i] = u[0] * sigma2z * s * s;
      const un = new Float64Array(r);
      for (let k = 0; k < r; k++) un[k] = ss.t0[k] * u[0] + (k + 1 < r ? u[k + 1] : 0);
      u = un;
    }
  }
  // Integrate: y_{n+h} error = Σ_j c_{h,j} e_j with c = C(h − j + d − 1, d − 1).
  const mean: number[] = [];
  const se: number[] = [];
  const n = yy.length;
  if (spec.d === 0) {
    for (let j = 0; j < H; j++) {
      mean.push(wHat[j]);
      se.push(Math.sqrt(C[j][j]));
    }
  } else {
    // Means by repeated cumulative sums from the last observed levels.
    let lev = wHat.slice();
    for (let k = spec.d; k >= 1; k--) {
      const last = difference(yy, k - 1)[n - k];
      const out: number[] = [];
      let acc = last;
      for (let j = 0; j < H; j++) {
        acc += lev[j];
        out.push(acc);
      }
      lev = out;
    }
    for (let j = 0; j < H; j++) mean.push(lev[j]);
    for (let hh = 1; hh <= H; hh++) {
      const c: number[] = [];
      for (let j = 1; j <= hh; j++) c.push(spec.d === 1 ? 1 : hh - j + 1);
      let v = 0;
      for (let i = 0; i < hh; i++) for (let j = 0; j < hh; j++) v += c[i] * c[j] * C[i][j];
      se.push(Math.sqrt(Math.max(0, v)));
    }
  }
  const zq = normalQuantile(0.5 + level / 2);
  return { mean, se, lower: mean.map((m, i) => m - zq * se[i]), upper: mean.map((m, i) => m + zq * se[i]), z: zq };
}
