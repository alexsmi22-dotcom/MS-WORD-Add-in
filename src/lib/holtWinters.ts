/**
 * Exponential smoothing — simple, Holt (additive trend, optionally damped) and Holt–Winters (additive or
 * multiplicative seasonality) — with statsmodels 0.15's ExponentialSmoothing conventions (Release E3b, ts-ets).
 *
 * Recursions (statsmodels holtwinters/_smoothers.py, the error-correction form of Hyndman et al. 2008), with
 * base_t = l_{t−1} + φ·b_{t−1} (just l_{t−1} without a trend) and s_{t−m} the seasonal one cycle back:
 *   fitted  ŷ_t = base_t + s_{t−m}   (additive)      ŷ_t = base_t · s_{t−m}   (multiplicative)
 *   level   l_t = α(y_t − s_{t−m}) + (1 − α)base_t  |  α·y_t / s_{t−m} + (1 − α)base_t
 *   trend   b_t = β(l_t − l_{t−1}) + (1 − β)φ·b_{t−1}
 *   season  s_t = γ(y_t − base_t) + (1 − γ)s_{t−m}  |  γ·y_t / base_t + (1 − γ)s_{t−m}
 * Parameter space (statsmodels' bounds): α ∈ [√ε, 1 − √ε], 0 ≤ β ≤ α, 0 ≤ γ ≤ 1 − α, φ ∈ [0.8, 0.995]; the initial
 * level, trend and m seasonals are estimated with them by least squares (initialization_method="estimated").
 * Forecasts: ŷ_{n+h} = l_n + φ_h·b_n (+ or ×) s_{n+h−m(⌊(h−1)/m⌋+1)}, φ_h = φ + … + φ^h (h without damping) — the
 * textbook formula, which statsmodels' ETSModel follows. (statsmodels 0.15's ExponentialSmoothing.forecast uses the
 * seasonal from one cycle too early at h = m, 2m, …; this module does not copy that.)
 *
 * Estimation: a coarse grid over (α, β, γ, φ) with heuristic initial states (statsmodels' "simple" initialisation),
 * then a box-constrained Levenberg–Marquardt on every parameter from the best grid points; the lowest SSE is kept.
 */
import { normalQuantile } from "./probdist";

export type HwTrend = "none" | "add";
export type HwSeasonal = "none" | "add" | "mul";

export interface HwSpec {
  trend: HwTrend;
  damped: boolean;
  seasonal: HwSeasonal;
  /** Seasonal period (ignored without seasonality). */
  m: number;
}

export interface HwParams {
  alpha: number;
  beta: number;
  gamma: number;
  phi: number;
  l0: number;
  b0: number;
  s0: number[];
}

export const HW_MAX_H = 200;
export const HW_MAX_M = 52;
export const HW_MAX_ITER = 2000;
/**
 * Work allowed per fit, in recursion steps (rows × recursions): about 3 seconds on the build machine. The grid and
 * the Levenberg–Marquardt iterations share it; a fit that would exceed it is refused by name.
 */
export const HW_WORK_BUDGET = 5e8;
const SQRT_EPS = Math.sqrt(2.220446049250313e-16);
export const PHI_LO = 0.8;
export const PHI_HI = 0.995;
/**
 * Starting grid for the smoothing coordinates u ∈ [0, 1] (both bounds included). The interior levels are the
 * pre-2026-10-28 engine's grid, whose three best points (at the heuristic initial trend) stay candidates, so the fit
 * is never worse than that engine's (round 2 MAJOR 2).
 */
const HW_GRID_LEVELS: Record<"a" | "b" | "g" | "p", number[]> = {
  a: [0, 0.02, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1],
  b: [0, 0.02, 0.2, 0.5, 0.9, 1],
  g: [0, 0.02, 0.2, 0.5, 0.9, 1],
  p: [0, 0.3, 0.9, 1],
};
const HW_OLD_LEVELS: Record<"a" | "b" | "g" | "p", number[]> = {
  a: [0.02, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95],
  b: [0.02, 0.2, 0.5, 0.9],
  g: [0.02, 0.2, 0.5, 0.9],
  p: [0.3, 0.9],
};
/** The best grid points scouted besides the best point of each face class. */
const HW_STARTS = 6;
/** Levenberg–Marquardt iterations of a scouting run. */
const HW_SCOUT_ITER = 4;
/**
 * The scouts fitted to convergence on the subsample (with the old engine's three grid starts): the best of up to
 * HW_SUB_POLISH distinct face classes, then HW_SUB_TOP more of the best overall.
 */
const HW_SUB_POLISH = 8;
const HW_SUB_TOP = 2;
/** On a long series, the distinct subsample optima refitted on every row. */
const HW_FULL_POLISH = 3;
/** The grid, the scouts and the first fits read the first HW_SUB_ROWS rows; only the last refits read them all. */
const HW_SUB_ROWS = 400;
/**
 * The race between the fits from several starts: [iterations so far, how far behind the best SSE (relative) a fit
 * may be to carry on]. The last round runs the fits left to convergence.
 */
const HW_RACE_ROUNDS: [number, number][] = [
  [30, 0.05],
  [150, 0.005],
  [HW_MAX_ITER, 0],
];

export interface HwFiltered {
  fitted: Float64Array;
  sse: number;
  /** Final level, trend and the last m seasonals (oldest first). */
  level: number;
  trend: number;
  season: number[];
}

/** Runs the recursions; `y` and the states share units. */
export function hwFilter(y: ArrayLike<number>, spec: HwSpec, prm: HwParams): HwFiltered {
  const n = y.length;
  const { alpha, beta, gamma } = prm;
  const hasT = spec.trend === "add";
  const phi = hasT && spec.damped ? prm.phi : 1;
  const seas = spec.seasonal;
  const m = seas === "none" ? 0 : spec.m;
  const s = new Float64Array(n + m);
  for (let i = 0; i < m; i++) s[i] = prm.s0[i];
  let l = prm.l0;
  let b = hasT ? prm.b0 : 0;
  const fitted = new Float64Array(n);
  let sse = 0;
  for (let t = 0; t < n; t++) {
    const base = hasT ? l + phi * b : l;
    const yt = y[t];
    let f: number;
    let ln: number;
    if (seas === "add") {
      const st = s[t];
      f = base + st;
      ln = alpha * (yt - st) + (1 - alpha) * base;
      s[t + m] = gamma * (yt - base) + (1 - gamma) * st;
    } else if (seas === "mul") {
      const st = s[t];
      f = base * st;
      ln = (alpha * yt) / st + (1 - alpha) * base;
      s[t + m] = (gamma * yt) / base + (1 - gamma) * st;
    } else {
      f = base;
      ln = alpha * yt + (1 - alpha) * base;
    }
    if (hasT) b = beta * (ln - l) + (1 - beta) * phi * b;
    l = ln;
    fitted[t] = f;
    const e = yt - f;
    sse += e * e;
  }
  const season: number[] = [];
  for (let i = 0; i < m; i++) season.push(s[n + i]);
  return { fitted, sse, level: l, trend: b, season };
}

/**
 * hwFilter's SSE with the residuals y − ŷ written into `out` (when given), without allocating: the estimation calls it
 * hundreds of times per fit. `sbuf` holds the seasonals (length ≥ n + m). Same recursions as hwFilter.
 */
function hwSseInto(y: Float64Array, n: number, L: Layout, prm: HwParams, out: Float64Array | null, sbuf: Float64Array): number {
  const { alpha, beta, gamma } = prm;
  const hasT = L.hasT;
  const phi = hasT ? prm.phi : 1;
  const m = L.m;
  for (let i = 0; i < m; i++) sbuf[i] = prm.s0[i];
  let l = prm.l0;
  let b = hasT ? prm.b0 : 0;
  let sse = 0;
  const a1 = 1 - alpha;
  const b1 = 1 - beta;
  const g1 = 1 - gamma;
  for (let t = 0; t < n; t++) {
    const base = hasT ? l + phi * b : l;
    const yt = y[t];
    let f: number;
    let ln: number;
    if (m === 0) {
      f = base;
      ln = alpha * yt + a1 * base;
    } else if (L.mul) {
      const st = sbuf[t];
      f = base * st;
      ln = (alpha * yt) / st + a1 * base;
      sbuf[t + m] = (gamma * yt) / base + g1 * st;
    } else {
      const st = sbuf[t];
      f = base + st;
      ln = alpha * (yt - st) + a1 * base;
      sbuf[t + m] = gamma * (yt - base) + g1 * st;
    }
    if (hasT) b = beta * (ln - l) + b1 * phi * b;
    l = ln;
    const e = yt - f;
    if (out) out[t] = e;
    sse += e * e;
  }
  return sse;
}

/** h-step point forecasts (textbook form). */
export function hwForecast(y: ArrayLike<number>, spec: HwSpec, prm: HwParams, h: number): number[] {
  const f = hwFilter(y, spec, prm);
  const H = Math.max(1, Math.min(HW_MAX_H, Math.floor(h)));
  const hasT = spec.trend === "add";
  const phi = hasT && spec.damped ? prm.phi : 1;
  const m = spec.seasonal === "none" ? 0 : spec.m;
  const out: number[] = [];
  let phiH = 0;
  let pw = 1;
  for (let k = 1; k <= H; k++) {
    pw *= phi;
    phiH += hasT && spec.damped ? pw : 1;
    const base = f.level + (hasT ? phiH * f.trend : 0);
    if (!m) out.push(base);
    else {
      const si = f.season[(k - 1) % m];
      out.push(spec.seasonal === "mul" ? base * si : base + si);
    }
  }
  return out;
}

/**
 * Forecast-error variances for the additive-error models with a closed form (Hyndman et al. 2008, class 1; the
 * formulas statsmodels' ETSModel implements): σ²[1 + Σ_{j=1}^{h−1} c_j²], c_j = α + αβ·φ_j + γ·1{j mod m = 0}, with
 * σ² = SSE/n. Null for multiplicative seasonality (no closed form).
 */
export function hwForecastVariance(spec: HwSpec, prm: HwParams, sse: number, n: number, h: number): number[] | null {
  if (spec.seasonal === "mul") return null;
  const H = Math.max(1, Math.min(HW_MAX_H, Math.floor(h)));
  const hasT = spec.trend === "add";
  const phi = hasT && spec.damped ? prm.phi : 1;
  const m = spec.seasonal === "add" ? spec.m : 0;
  const sigma2 = sse / n;
  const betaEts = prm.alpha * prm.beta;
  const out: number[] = [];
  let acc = 1;
  let phiJ = 0;
  let pw = 1;
  for (let k = 1; k <= H; k++) {
    out.push(sigma2 * acc);
    // add c_k² for the next horizon
    pw *= phi;
    phiJ += hasT && spec.damped ? pw : 1;
    let c = prm.alpha;
    if (hasT) c += betaEts * phiJ;
    if (m && k % m === 0) c += prm.gamma;
    acc += c * c;
  }
  return out;
}

// ---------------------------------------------------------------- estimation

export interface HwFit {
  ok: true;
  spec: HwSpec;
  params: HwParams;
  sse: number;
  fitted: Float64Array;
  /** statsmodels' HoltWinters information criteria: n·log(SSE/n) + 2k etc. */
  k: number;
  aic: number;
  aicc: number | null;
  bic: number;
  iterations: number;
  /** Parameters sitting on a bound of statsmodels' box, by name. */
  atBounds: string[];
}

export type HwFitResult = HwFit | { ok: false; reason: string };

interface Layout {
  nSmooth: number;
  /** Which of α, β, γ, φ are free, in that order. */
  smooth: ("a" | "b" | "g" | "p")[];
  hasT: boolean;
  m: number;
  mul: boolean;
}

function layoutOf(spec: HwSpec): Layout {
  const hasT = spec.trend === "add";
  const m = spec.seasonal === "none" ? 0 : spec.m;
  const smooth: ("a" | "b" | "g" | "p")[] = ["a"];
  if (hasT) smooth.push("b");
  if (m) smooth.push("g");
  if (hasT && spec.damped) smooth.push("p");
  return { nSmooth: smooth.length, smooth, hasT, m, mul: spec.seasonal === "mul" };
}

/** x = [u (box [0, 1]) …, l0, b0?, s0…] → parameters (states in scaled units). */
function decode(x: Float64Array | number[], L: Layout): HwParams {
  let alpha = 0.5;
  let beta = 0;
  let gamma = 0;
  let phi = 1;
  let i = 0;
  for (const name of L.smooth) {
    const u = x[i++];
    if (name === "a") alpha = SQRT_EPS + u * (1 - 2 * SQRT_EPS);
    else if (name === "b") beta = u * alpha;
    else if (name === "g") gamma = u * (1 - alpha);
    else phi = PHI_LO + u * (PHI_HI - PHI_LO);
  }
  const l0 = x[i++];
  const b0 = L.hasT ? x[i++] : 0;
  const s0: number[] = [];
  // m − 1 free seasonals; the last is fixed by the normalisation (sum 0 additive, mean 1 multiplicative), which removes
  // the exact flat direction of the SSE (see fitHoltWinters) without restricting the fit.
  let acc = 0;
  for (let j = 0; j < L.m - 1; j++) {
    s0.push(x[i]);
    acc += x[i++];
  }
  if (L.m) s0.push(L.mul ? L.m - acc : -acc);
  return { alpha, beta, gamma, phi, l0, b0, s0 };
}

/** statsmodels' "simple" initial states (_initialization_simple). */
function heuristicStates(y: Float64Array, spec: HwSpec, L: Layout): { l0: number; b0: number; s0: number[] } {
  const m = L.m;
  if (!m) {
    return { l0: y[0], b0: L.hasT ? y[1] - y[0] : 0, s0: [] };
  }
  let a = 0;
  let b = 0;
  for (let i = 0; i < m; i++) {
    a += y[i] / m;
    b += y[m + i] / m;
  }
  const s0: number[] = [];
  for (let i = 0; i < m; i++) s0.push(spec.seasonal === "mul" ? y[i] / a : y[i] - a);
  return { l0: a, b0: L.hasT ? (b - a) / m : 0, s0 };
}

interface LmResult {
  x: Float64Array;
  sse: number;
  converged: boolean;
  iterations: number;
  exhausted?: boolean;
  /** Not converged, but the SSE moved by less than 10⁻⁷ (relative) over the last LM_FLAT_SPAN iterations. */
  flat?: boolean;
  /** The resumable state (lmContinue). */
  lambda: number;
  small: number;
  r: Float64Array;
  markSse: number;
  done: boolean;
}

/** Iterations over which an unconverged run whose SSE has stopped moving (10⁻⁷ relative) counts as settled. */
const LM_FLAT_SPAN = 200;

function lmStart(resid: (x: Float64Array, out: Float64Array) => number, x0: Float64Array, n: number): LmResult {
  const x = Float64Array.from(x0);
  const r = new Float64Array(n);
  const sse = resid(x, r);
  const ok = Number.isFinite(sse);
  return { x, sse, converged: false, iterations: 0, lambda: 1e-3, small: 0, r, markSse: sse, done: !ok };
}

/**
 * Levenberg–Marquardt for min Σ r², with the first `nBox` coordinates kept in [0, 1] (projection, and a coordinate on a
 * bound whose gradient points outward is held there for the step). Resumable: runs `run` on until it has done
 * `untilIter` iterations in all, converges, or the budget runs out.
 */
function lmContinue(
  run: LmResult,
  resid: (x: Float64Array, out: Float64Array) => number,
  n: number,
  nBox: number,
  untilIter: number,
  budget: { left: number },
  fixed?: boolean[],
): LmResult {
  if (run.done) return run;
  const k = run.x.length;
  let x = run.x;
  const r = run.r;
  let sse = run.sse;
  let lambda = run.lambda;
  let small = run.small;
  const J: Float64Array[] = [];
  for (let j = 0; j < k; j++) J.push(new Float64Array(n));
  const rt = new Float64Array(n);
  const rn = new Float64Array(n);
  const finish = (it: number, converged: boolean, extra: Partial<LmResult> = {}): LmResult => {
    Object.assign(run, { x, sse, lambda, small, iterations: it, converged, done: converged || !!extra.exhausted }, extra);
    return run;
  };
  for (let it = run.iterations + 1; it <= untilIter; it++) {
    // Each iteration costs k + 1 recursions and the k × k normal matrix (about k²/4 recursions' worth).
    budget.left -= n * (k + 2 + (k * k) / 4);
    if (budget.left < 0) return finish(it - 1, false, { exhausted: true });
    // Forward-difference Jacobian of r (step inward at an upper bound).
    for (let j = 0; j < k; j++) {
      let h = 1e-7 * Math.max(1, Math.abs(x[j]));
      if (j < nBox && x[j] + h > 1) h = -h;
      const xj = x[j];
      x[j] = xj + h;
      const sj = resid(x, rt);
      x[j] = xj;
      const col = J[j];
      if (!Number.isFinite(sj)) col.fill(0);
      else for (let t = 0; t < n; t++) col[t] = (rt[t] - r[t]) / h;
    }
    const g = new Float64Array(k);
    const A: number[][] = [];
    for (let i = 0; i < k; i++) A.push(new Array<number>(k).fill(0));
    for (let i = 0; i < k; i++) {
      const ci = J[i];
      let gi = 0;
      for (let t = 0; t < n; t++) gi += ci[t] * r[t];
      g[i] = gi;
      for (let j = 0; j <= i; j++) {
        const cj = J[j];
        let s = 0;
        for (let t = 0; t < n; t++) s += ci[t] * cj[t];
        A[i][j] = A[j][i] = s;
      }
    }
    // Free set: drop box coordinates on a bound whose descent direction (−g) points out of the box.
    const free: number[] = [];
    for (let i = 0; i < k; i++) {
      if (fixed?.[i]) continue;
      if (i < nBox && ((x[i] <= 0 && g[i] > 0) || (x[i] >= 1 && g[i] < 0))) continue;
      free.push(i);
    }
    const pg = Math.max(0, ...free.map((i) => Math.abs(g[i])));
    if (pg <= 1e-13 * Math.max(sse, 1e-300) || free.length === 0) return finish(it, true);
    let improved = false;
    for (let tries = 0; tries < 40; tries++) {
      const M = free.map((i) => free.map((j) => A[i][j] + (i === j ? lambda * Math.max(A[i][i], 1e-12) : 0)));
      const step = solveSym(M, free.map((i) => -g[i]));
      if (!step) {
        lambda *= 10;
        continue;
      }
      const xn = Float64Array.from(x);
      free.forEach((i, idx) => {
        xn[i] += step[idx];
        if (i < nBox) xn[i] = Math.min(1, Math.max(0, xn[i]));
      });
      const sn = resid(xn, rn);
      if (Number.isFinite(sn) && sn < sse) {
        const rel = (sse - sn) / Math.max(sse, 1e-300);
        x = xn;
        r.set(rn);
        sse = sn;
        lambda = Math.max(lambda / 3, 1e-12);
        improved = true;
        small = rel < 1e-11 ? small + 1 : 0;
        break;
      }
      lambda *= 4;
      if (lambda > 1e16) break;
    }
    if (!improved || small >= 3) return finish(it, true);
    if (it % LM_FLAT_SPAN === 0) {
      run.flat = run.markSse - sse <= 1e-7 * Math.max(sse, 1e-300);
      run.markSse = sse;
    }
  }
  return finish(Math.max(run.iterations, untilIter), false);
}

function lmBox(
  resid: (x: Float64Array, out: Float64Array) => number,
  x0: Float64Array,
  n: number,
  nBox: number,
  maxIter: number,
  budget: { left: number },
  fixed?: boolean[],
): LmResult {
  return lmContinue(lmStart(resid, x0, n), resid, n, nBox, maxIter, budget, fixed);
}

/** Symmetric solve by Gaussian elimination with partial pivoting; null if singular. */
function solveSym(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 0)) return null;
    if (piv !== c) [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
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

/** Number of HoltWinters parameters as statsmodels counts them for the information criteria. */
export function hwParamCount(spec: HwSpec): number {
  const hasT = spec.trend === "add";
  const m = spec.seasonal === "none" ? 0 : spec.m;
  return m + 2 * (hasT ? 1 : 0) + 2 + (hasT && spec.damped ? 1 : 0);
}

/** Fits the model by least squares. `y` must already be checked (finite; positive for multiplicative seasonality). */
export function fitHoltWinters(yIn: ArrayLike<number>, spec: HwSpec): HwFitResult {
  const n = yIn.length;
  const L = layoutOf(spec);
  // Scale only (a multiplicative model cannot be shifted): the SSE scales by scale², the smoothing parameters not at all.
  let M = 0;
  for (let i = 0; i < n; i++) M = Math.max(M, Math.abs(yIn[i]));
  if (!Number.isFinite(M)) return { ok: false, reason: "A value is not a finite number." };
  if (!(M > 0)) return { ok: false, reason: "The series is zero throughout, so there is nothing to smooth." };
  let ms = 0;
  for (let i = 0; i < n; i++) ms += (yIn[i] / M) * (yIn[i] / M);
  const scale = M * Math.sqrt(ms / n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = yIn[i] / scale;
  const st = heuristicStates(y, spec, L);
  // Up-front refusal when even the grid and a short optimisation cannot fit in the work budget.
  const kx = L.nSmooth + 1 + (L.hasT ? 1 : 0) + Math.max(0, L.m - 1);
  // Grid points (× the initial-trend candidates), scouts (the best points plus one per face class, 3 per smoothing
  // coordinate), the subsample fits (about 25 iterations each), and the refits on every row.
  const gridSize = L.smooth.reduce((a, s) => a * HW_GRID_LEVELS[s].length, 1) * (L.hasT ? 3 : 1);
  const nScouts = HW_STARTS + 3 ** L.nSmooth;
  const perIter = kx + 2 + (kx * kx) / 4;
  // The grid, the scouts and the first fits only choose where the last fit starts, so on a long series they read its
  // first HW_SUB_ROWS rows; the refits read every row.
  const nPre = Math.min(n, HW_SUB_ROWS);
  // A long series also scores the old engine's grid on every row and refits its three starts and the subsample optima.
  const oldGridSize = L.smooth.reduce((a, s) => a * HW_OLD_LEVELS[s].length, 1);
  const perRow = n > nPre ? oldGridSize + (3 + HW_FULL_POLISH) * 25 * perIter : 0;
  const fixedWork = nPre * (gridSize + nScouts * HW_SCOUT_ITER * perIter + (HW_SUB_POLISH + HW_SUB_TOP + 3) * 25 * perIter);
  if (fixedWork + n * perRow > HW_WORK_BUDGET) {
    return {
      ok: false,
      reason: `This model on ${n.toLocaleString("en-US")} rows needs more computation than the pane allows; use at most ${Math.floor(Math.max(0, HW_WORK_BUDGET - fixedWork) / perRow).toLocaleString("en-US")} rows, or a simpler model.`,
    };
  }
  const sbuf = new Float64Array(n + L.m);
  const fin = (v: number): number => (Number.isFinite(v) ? v : Infinity);
  const resid = (x: Float64Array | number[], out: Float64Array): number => fin(hwSseInto(y, n, L, decode(x, L), out, sbuf));
  const residPre = (x: Float64Array | number[], out: Float64Array): number => fin(hwSseInto(y, nPre, L, decode(x, L), out, sbuf));
  const sseOnly = (x: number[]): number => fin(hwSseInto(y, nPre, L, decode(x, L), null, sbuf));

  // Grid over the smoothing coordinates (u ∈ [0, 1]) with the heuristic states. The bounds themselves are on it:
  // the global least-squares fit is often a corner (α = 1 with β = 0 or β = α, γ = 0, φ at either end), and a local
  // search started inside the box can settle on an interior local minimum instead (R6 review: SSE 4,287.7 against
  // the corner's 4,271.4; a multiplicative fit at 13.27 against 4.26).
  const levels = HW_GRID_LEVELS;
  // The heuristic initial trend (y₂ − y₁, or one cycle's change) is noisy, and with β near 0 it steers the whole fit,
  // so each grid point is also scored with no initial trend and with the series' average slope.
  const b0s = L.hasT ? [st.b0, 0, (y[n - 1] - y[0]) / (n - 1)] : [0];
  const grid: { x: number[]; sse: number; corner: string; old: boolean }[] = [];
  const isOld = (acc: number[]): boolean => acc.every((u, i) => HW_OLD_LEVELS[L.smooth[i]].includes(u));
  const rec = (i: number, acc: number[]): void => {
    if (i === L.nSmooth) {
      const corner = acc.map((u) => (u === 0 ? "0" : u === 1 ? "1" : "i")).join("");
      b0s.forEach((b0, bi) => {
        const x = [...acc, st.l0, ...(L.hasT ? [b0] : []), ...st.s0.slice(0, Math.max(0, L.m - 1))];
        grid.push({ x, sse: sseOnly(x), corner, old: bi === 0 && isOld(acc) });
      });
      return;
    }
    for (const v of levels[L.smooth[i]]) rec(i + 1, [...acc, v]);
  };
  rec(0, []);
  grid.sort((p, q) => p.sse - q.sse);
  const finite = grid.filter((g) => Number.isFinite(g.sse));
  // The best grid points, and the best point of every face class of the smoothing box (each coordinate at 0, at 1 or
  // inside) whatever its rank: scored at the heuristic states, a class can rank low and still hold the global fit
  // (the R6 cases: α = β = 1; β = α with α inside; α = 1 with β = 0).
  const starts = finite.slice(0, HW_STARTS);
  const seenCorner = new Set<string>();
  for (const g of finite) {
    const key = g.corner;
    if (seenCorner.has(key)) continue;
    seenCorner.add(key);
    if (!starts.includes(g)) starts.push(g);
  }
  if (!starts.length) return { ok: false, reason: "The smoothing recursions overflow for every starting value (an extreme series)." };

  let iterations = 0;
  let exhausted = false;
  const budget = { left: HW_WORK_BUDGET - nPre * grid.length };
  // Runs several fits side by side to convergence, dropping after each round those clearly behind the best (or
  // converging on the same point as a better one): most starts settle in a few dozen iterations, so the long fits
  // left are the ones that can still win.
  const race = (cands: LmResult[], rf: typeof resid, rows: number): LmResult[] => {
    let alive = cands.filter((c) => !c.done);
    HW_RACE_ROUNDS.forEach(([until, tol], ri) => {
      for (const c of alive) {
        const before = c.iterations;
        lmContinue(c, rf, rows, L.nSmooth, until, budget);
        iterations += c.iterations - before;
        if (c.exhausted) exhausted = true;
      }
      if (ri === HW_RACE_ROUNDS.length - 1) return;
      const bestSse = Math.min(...cands.map((c) => c.sse));
      const keep: LmResult[] = [];
      for (const c of alive.filter((a) => !a.done && a.sse <= bestSse * (1 + tol)).sort((a, b) => a.sse - b.sse)) {
        const near = (d: LmResult): boolean => d.x.every((v, i) => Math.abs(v - c.x[i]) <= 1e-4 * Math.max(1, Math.abs(v)));
        if (!keep.some(near) && !cands.some((d) => d.done && d.sse <= c.sse && near(d))) keep.push(c);
      }
      alive = keep;
    });
    return cands.filter((c) => Number.isFinite(c.sse));
  };
  // Three stages (round 2 MAJOR 2: two polished scouts lost optima on fresh series): a short scouting run from each
  // start, since the basin a start falls in only shows after a few steps; fits to convergence from the best scouts
  // (and, on a short series, the pre-2026-10-28 engine's three grid starts); on a long series, the old engine's
  // starts and the best distinct subsample optima refitted on every row.
  const scouts: LmResult[] = [];
  for (const s of starts) {
    // A start on a face of the box (a smoothing coordinate at 0 or 1) is scouted ON that face, the coordinate held:
    // a boundary optimum (α = 0 with a deterministic damped trend, round 2: SSE 28,388.5 against 28,552.4) only
    // holds once the states fit it, and from the heuristic states the first steps would leave the face.
    const fixed = s.x.map((u, i) => i < L.nSmooth && (u === 0 || u === 1));
    const r = lmBox(residPre, Float64Array.from(s.x), nPre, L.nSmooth, HW_SCOUT_ITER, budget, fixed);
    iterations += r.iterations;
    if (r.exhausted) exhausted = true;
    if (Number.isFinite(r.sse)) scouts.push(r);
    if (budget.left <= 0) break;
  }
  scouts.sort((a, b) => a.sse - b.sse);
  // The pre-2026-10-28 engine's three starts: its interior grid at the heuristic initial trend, scored on every row.
  const oldStarts = (rf: typeof resid, rows: number): LmResult[] => {
    let pts: { x: number[]; sse: number }[];
    if (rows === nPre) pts = finite.filter((g) => g.old);
    else {
      pts = [];
      const sseAll = (x: number[]): number => fin(hwSseInto(y, n, L, decode(x, L), null, sbuf));
      const recOld = (i: number, acc: number[]): void => {
        if (i === L.nSmooth) {
          const x = [...acc, st.l0, ...(L.hasT ? [st.b0] : []), ...st.s0.slice(0, Math.max(0, L.m - 1))];
          pts.push({ x, sse: sseAll(x) });
          return;
        }
        for (const v of HW_OLD_LEVELS[L.smooth[i]]) recOld(i + 1, [...acc, v]);
      };
      recOld(0, []);
      budget.left -= rows * pts.length;
      pts = pts.filter((g) => Number.isFinite(g.sse)).sort((p, q) => p.sse - q.sse);
    }
    return pts.slice(0, 3).map((g) => lmStart(rf, Float64Array.from(g.x), rows));
  };
  // The scouts to fit on: the best of each face class they have reached (diverse basins first: a boundary optimum such
  // as α = 0 ranks low after a few steps), then the best overall, HW_SUB_POLISH in all.
  const faceOf = (x: Float64Array): string =>
    Array.from(x.subarray(0, L.nSmooth), (u) => (u <= 1e-9 ? "0" : u >= 1 - 1e-9 ? "1" : "i")).join("");
  const picked: LmResult[] = [];
  const faces = new Set<string>();
  for (const sc of scouts) {
    if (picked.length >= HW_SUB_POLISH) break;
    const f = faceOf(sc.x);
    if (!faces.has(f)) {
      faces.add(f);
      picked.push(sc);
    }
  }
  for (const sc of scouts) if (picked.length < HW_SUB_POLISH + HW_SUB_TOP && !picked.includes(sc)) picked.push(sc);
  const subRuns = race(
    [...(n === nPre ? oldStarts(residPre, nPre) : []), ...picked.map((s) => lmStart(residPre, s.x, nPre))],
    residPre,
    nPre,
  ).sort((a, b) => a.sse - b.sse);
  let runs: LmResult[] = subRuns;
  if (n > nPre) {
    // Distinct optima only: two runs that met at the same point need one refit.
    const distinct: LmResult[] = [];
    for (const r of subRuns) {
      if (distinct.length >= HW_FULL_POLISH) break;
      if (!distinct.some((d) => d.x.every((v, i) => Math.abs(v - r.x[i]) <= 1e-6 * Math.max(1, Math.abs(v))))) distinct.push(r);
    }
    runs = race([...oldStarts(resid, n), ...distinct.map((d) => lmStart(resid, d.x, n))], resid, n);
  }
  if (!runs.length) return { ok: false, reason: "The least-squares fit failed from every start." };
  runs.sort((a, b) => a.sse - b.sse);
  // A run counts as settled when it converged, or when its SSE has not moved by 10⁻⁷ (relative) over its last 200
  // iterations: a flat valley where the parameters can still drift but the fit cannot improve at printed precision.
  const best = runs.find((r) => r.converged || r.flat);
  if (!best || best.sse > runs[0].sse * (1 + 1e-10)) {
    return {
      ok: false,
      reason: exhausted
        ? `The least-squares fit did not converge within the pane's computation limit for ${n.toLocaleString("en-US")} rows, so no estimate is reported. Use fewer rows or a simpler model.`
        : `The least-squares fit did not converge within ${HW_MAX_ITER} iterations, so no estimate is reported.`,
    };
  }
  const ps = decode(best.x, L);
  // The initial states are identified only up to an exact symmetry (fitted values and SSE unchanged): additive
  // seasonals can trade a constant with the level, multiplicative ones a factor with level and trend. Report the
  // usual normalisation — additive seasonals summing to 0, multiplicative averaging 1.
  if (L.m) {
    const avg = ps.s0.reduce((a, v) => a + v, 0) / L.m;
    if (spec.seasonal === "add") {
      ps.l0 += avg;
      ps.s0 = ps.s0.map((v) => v - avg);
    } else if (avg > 0) {
      ps.l0 *= avg;
      ps.b0 *= avg;
      ps.s0 = ps.s0.map((v) => v / avg);
    }
  }
  const params: HwParams = { ...ps, l0: ps.l0 * scale, b0: ps.b0 * scale, s0: spec.seasonal === "add" ? ps.s0.map((v) => v * scale) : ps.s0 };
  if (!(L.hasT && spec.damped)) params.phi = 1;
  const filt = hwFilter(yIn, spec, params);
  const sse = filt.sse;
  const k = hwParamCount(spec);
  const ll = n * Math.log(sse / n);
  const aic = ll + 2 * k;
  const dofEff = n - k - 3;
  const aicc = dofEff > 0 ? aic + (2 * (k + 2) * (k + 3)) / dofEff : null;
  const bic = ll + k * Math.log(n);
  const atBounds: string[] = [];
  L.smooth.forEach((name, i) => {
    const u = best!.x[i];
    if (u <= 0 || u >= 1) {
      const label = { a: "α", b: "β", g: "γ", p: "φ" }[name];
      atBounds.push(`${label} ${u <= 0 ? "at its lower" : "at its upper"} bound`);
    }
  });
  return { ok: true, spec, params, sse, fitted: filt.fitted, k, aic, aicc, bic, iterations, atBounds };
}

/** 95% (or other) prediction bounds from forecasts and variances. */
export function hwIntervals(mean: number[], variance: number[], level = 0.95): { lower: number[]; upper: number[]; z: number } {
  const z = normalQuantile(0.5 + level / 2);
  return {
    lower: mean.map((m, i) => m - z * Math.sqrt(variance[i])),
    upper: mean.map((m, i) => m + z * Math.sqrt(variance[i])),
    z,
  };
}
