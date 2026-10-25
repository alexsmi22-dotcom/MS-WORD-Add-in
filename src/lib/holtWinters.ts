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
}

/**
 * Levenberg–Marquardt for min Σ r², with the first `nBox` coordinates kept in [0, 1] (projection, and a coordinate on a
 * bound whose gradient points outward is held there for the step).
 */
function lmBox(
  resid: (x: Float64Array, out: Float64Array) => number,
  x0: Float64Array,
  n: number,
  nBox: number,
  maxIter: number,
  budget: { left: number },
): LmResult {
  const k = x0.length;
  let x = Float64Array.from(x0);
  const r = new Float64Array(n);
  let sse = resid(x, r);
  if (!Number.isFinite(sse)) return { x, sse, converged: false, iterations: 0 };
  let lambda = 1e-3;
  const J: Float64Array[] = [];
  for (let j = 0; j < k; j++) J.push(new Float64Array(n));
  const rt = new Float64Array(n);
  const rn = new Float64Array(n);
  let small = 0;
  for (let it = 1; it <= maxIter; it++) {
    // Each iteration costs k + 1 recursions and the k × k normal matrix (about k²/4 recursions' worth).
    budget.left -= n * (k + 2 + (k * k) / 4);
    if (budget.left < 0) return { x, sse, converged: false, iterations: it - 1, exhausted: true };
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
      if (i < nBox && ((x[i] <= 0 && g[i] > 0) || (x[i] >= 1 && g[i] < 0))) continue;
      free.push(i);
    }
    const pg = Math.max(0, ...free.map((i) => Math.abs(g[i])));
    if (pg <= 1e-13 * Math.max(sse, 1e-300) || free.length === 0) return { x, sse, converged: true, iterations: it };
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
    if (!improved || small >= 3) return { x, sse, converged: true, iterations: it };
  }
  return { x, sse, converged: false, iterations: maxIter };
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
  const gridSize = 8 * (L.hasT ? 4 : 1) * (L.m ? 4 : 1) * (L.hasT && spec.damped ? 2 : 1);
  const perRow = gridSize + 3 * 25 * (kx + 2 + (kx * kx) / 4);
  if (n * perRow > HW_WORK_BUDGET) {
    return {
      ok: false,
      reason: `This model on ${n.toLocaleString("en-US")} rows needs more computation than the pane allows; use at most ${Math.floor(HW_WORK_BUDGET / perRow).toLocaleString("en-US")} rows, or a simpler model.`,
    };
  }
  const resid =(x: Float64Array | number[], out: Float64Array): number => {
    const prm = decode(x, L);
    const f = hwFilter(y, spec, prm);
    for (let t = 0; t < n; t++) out[t] = y[t] - f.fitted[t];
    return Number.isFinite(f.sse) ? f.sse : Infinity;
  };
  const sseOnly = (x: number[]): number => {
    const f = hwFilter(y, spec, decode(x, L));
    return Number.isFinite(f.sse) ? f.sse : Infinity;
  };

  // Grid over the smoothing coordinates (u ∈ [0, 1]) with the heuristic states.
  const levels: Record<"a" | "b" | "g" | "p", number[]> = {
    a: [0.02, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95],
    b: [0.02, 0.2, 0.5, 0.9],
    g: [0.02, 0.2, 0.5, 0.9],
    p: [0.3, 0.9],
  };
  const stateVec = [st.l0, ...(L.hasT ? [st.b0] : []), ...st.s0.slice(0, Math.max(0, L.m - 1))];
  const grid: { x: number[]; sse: number }[] = [];
  const rec = (i: number, acc: number[]): void => {
    if (i === L.nSmooth) {
      const x = [...acc, ...stateVec];
      grid.push({ x, sse: sseOnly(x) });
      return;
    }
    for (const v of levels[L.smooth[i]]) rec(i + 1, [...acc, v]);
  };
  rec(0, []);
  grid.sort((p, q) => p.sse - q.sse);
  const starts = grid.filter((g) => Number.isFinite(g.sse)).slice(0, 3);
  if (!starts.length) return { ok: false, reason: "The smoothing recursions overflow for every starting value (an extreme series)." };

  const runs: LmResult[] = [];
  let iterations = 0;
  let exhausted = false;
  const budget = { left: HW_WORK_BUDGET - n * grid.length };
  for (const s of starts) {
    const r = lmBox(resid, Float64Array.from(s.x), n, L.nSmooth, HW_MAX_ITER, budget);
    iterations += r.iterations;
    if (r.exhausted) exhausted = true;
    if (Number.isFinite(r.sse)) runs.push(r);
    if (budget.left <= 0) break;
  }
  if (!runs.length) return { ok: false, reason: "The least-squares fit failed from every start." };
  runs.sort((a, b) => a.sse - b.sse);
  const best = runs.find((r) => r.converged);
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
