/**
 * Quantile regression (Koenker & Bassett 1978) by an EXACT linear program, and statsmodels' QuantReg standard errors
 * evaluated at that solution (Release E4c).
 *
 * THE LP. β̂(τ) minimises Σ ρ_τ(yᵢ − xᵢᵀβ), ρ_τ(u) = u(τ − 1{u < 0}). A minimiser sits at a vertex: p observations
 * (the basis h) fitted exactly, β = X_h⁻¹y_h. The solver is the simplex method on that formulation (Barrodale &
 * Roberts 1973; Koenker & d'Orey 1987), which keeps β feasible and moves between vertices:
 *   - at basis h, with ψᵢ = τ for a positive residual and τ − 1 for a negative one, ξ = −X_h⁻ᵀ Σ_{i∉h} ψᵢxᵢ; the
 *     vertex is optimal exactly when every ξⱼ lies in [τ − 1, τ] (the subgradient condition);
 *   - otherwise the most violated j leaves: β moves along d (X_h d = ∓eⱼ) so that observation j's residual turns
 *     positive (ξⱼ > τ) or negative (ξⱼ < τ − 1), and the step length is the EXACT line minimum of the convex
 *     piecewise-linear objective along d: the directional derivative starts at −(violation) and rises by |xᵢᵀd| at
 *     each residual sign change, so the step stops at the breakpoint where it turns non-negative (found by a weighted
 *     selection in O(n), not a sort). That observation enters. Several vertices are passed in one step, as in
 *     Barrodale–Roberts.
 *   - DEGENERACY (ties: integer y, repeated rows) is resolved lexicographically: y is perturbed symbolically by
 *     ε·δᵢ (δ fixed, from PCG32 seed 1), a residual within rounding of zero takes the sign of its ε-part, and
 *     breakpoints tie-break on it. The perturbed problem is non-degenerate, so every step strictly decreases its
 *     objective and the method cannot cycle; a basis optimal for every small ε > 0 is optimal for ε = 0.
 *   - Start: the first p rows of a preferred order that give a non-singular X_h (the calculator orders rows by their
 *     distance from the OLS fit shifted to the τ-quantile of its residuals).
 *   - Freeze guarantee: each step charges its real cost (≈ 6·n·p) against QR_MAX_WORK and the wall clock is checked
 *     every step against QR_WALL_MS; either running out refuses by name. Rows above QR_MAX_ROWS are refused up front.
 *   - Numerics: y is divided by a power of two near its largest magnitude and each column by a power of two near its
 *     largest magnitude (exact), so 10⁻¹² and 10¹² scales pivot alike; the residual "zero" test is per row,
 *     64ε·(|yᵢ| + Σ|xᵢₖβₖ|).
 *
 * STANDARD ERRORS: statsmodels 0.15 QuantReg.fit (regression/quantile_regression.py), ported line by line and
 * evaluated at the LP solution (statsmodels itself solves by IRLS, which only approximates the minimiser):
 *   e = y − Xβ̂ (the p basis residuals are exactly 0); iqr = q₀.₇₅(e) − q₀.₂₅(e) (linear interpolation);
 *   h₀ = Hall–Sheather: n^(−1/3)·z₀.₉₇₅^(2/3)·(1.5φ(Φ⁻¹(τ))²/(2Φ⁻¹(τ)² + 1))^(1/3);
 *   h = min(sd(y) [divisor n], iqr/1.34)·(Φ⁻¹(τ + h₀) − Φ⁻¹(τ − h₀));
 *   f̂ = Σ K(eᵢ/h)/(n·h), K the Epanechnikov kernel ¾(1 − u²) on |u| ≤ 1;
 *   robust (statsmodels' default): (XᵀX)⁻¹ XᵀDX (XᵀX)⁻¹, Dᵢ = (τ/f̂)² if eᵢ > 0 else ((1 − τ)/f̂)²;
 *   iid: (1/f̂)²·τ(1 − τ)·(XᵀX)⁻¹.
 *   t statistics on n − p degrees of freedom (statsmodels' use_t and df_resid).
 *   Evaluated without forming XᵀX: with a constant the other columns are centred (exact reparameterisation, mapped
 *   back), columns are scaled by powers of two, and X = QR by Householder, so (XᵀX)⁻¹ = R⁻¹R⁻ᵀ and the sandwich is
 *   R⁻¹(QᵀDQ)R⁻ᵀ. On uncentred polynomial designs (year and year², x and x² on [1000, 1010]) this matches a 60-digit
 *   mpmath evaluation to 1e−9 relative; Gauss–Jordan on XᵀX lost the fifth significant digit there.
 *
 * PSEUDO R¹ (Koenker & Machado 1999): 1 − V̂(τ)/Ṽ(τ), Ṽ the minimised objective of the intercept-only model, whose
 * minimiser is the order statistic y₍⌈nτ⌉₎ (exact; statsmodels' prsquared uses the linearly interpolated percentile
 * instead and can differ in the last digits). Without a constant the comparison is still with the intercept-only
 * model, so R¹ can be negative.
 */
import { Pcg32 } from "./prng";
import { normalQuantile } from "./probdist";

// Bound once (see prng.ts: a `Math.x` lookup is ~20× slower under jest than a local alias).
const mAbs = Math.abs;
const mMax = Math.max;

export const QR_WALL_MS = 6000;
/**
 * Rows accepted by one quantile fit. Measured on the build machine (3 regressors + constant, OLS start, τ = 0.5 and
 * 0.1, continuous and integer y): n = 10,000 in 12–48 ms (10–19 steps), n = 100,000 in 82–176 ms (7–25 steps).
 * The wall clock and the work budget still bound any input shape that needs far more steps.
 */
export const QR_MAX_ROWS = 100000;
/**
 * Rows × quantiles accepted in one run. Was 600,000 (100,000 rows × 6 quantiles), which the 2026-10-28 bug test
 * timed at 3.3 s (R5 MAJOR 10); 150,000 keeps a run to about 1 s at the cap (100,000 rows at one quantile, 50,000 at
 * the default three).
 */
export const QR_MAX_ROW_QUANTILES = 150000;
/** Work units (multiply-adds) allowed for one quantile's LP. */
export const QR_MAX_WORK = 4e9;

export interface QrLpInput {
  y: Float64Array;
  /** Design columns INCLUDING the constant column if any, each length n. */
  cols: Float64Array[];
  tau: number;
  /** A starting order of rows (most preferred first), e.g. by |OLS residual|. */
  startOrder?: Int32Array;
  wallMs?: number;
  maxWork?: number;
  /** Shared deadline across several quantiles (epoch ms). */
  deadline?: number;
  /** Internal: row cap override (measurements). */
  maxRows?: number;
}

export interface QrLpFit {
  ok: true;
  beta: Float64Array;
  /** Residuals in the original units; exactly 0 on the basis rows. */
  resid: Float64Array;
  basis: Int32Array;
  objective: number;
  pivots: number;
  /** True when the minimiser may not be unique (a tie at the optimum). */
  maybeNonUnique: boolean;
}

export type QrLpResult = QrLpFit | { ok: false; reason: string };

const EPS = 2.220446049250313e-16;

function pow2Near(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  return Math.pow(2, Math.round(Math.log2(v)));
}

/** Inverse of a p×p matrix (row-major array of rows) by Gauss–Jordan with partial pivoting; null when singular. */
export function invert(A: number[][]): number[][] | null {
  const p = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  let scale = 0;
  for (const r of A) for (const v of r) scale = mMax(scale, mAbs(v));
  if (!(scale > 0)) return null;
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (mAbs(M[r][c]) > mAbs(M[piv][c])) piv = r;
    if (mAbs(M[piv][c]) <= 1e-13 * scale) return null;
    if (piv !== c) [M[piv], M[c]] = [M[c], M[piv]];
    const d = M[c][c];
    for (let j = 0; j < 2 * p; j++) M[c][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * p; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(p));
}

/** The check-function objective Σ ρ_τ(r). */
export function checkObjective(resid: ArrayLike<number>, tau: number): number {
  let s = 0;
  for (let i = 0; i < resid.length; i++) {
    const r = resid[i];
    s += r < 0 ? (tau - 1) * r : tau * r;
  }
  return s;
}

/** Solves one quantile's LP exactly. */
export function fitQuantileLp(inp: QrLpInput): QrLpResult {
  const { tau } = inp;
  const n = inp.y.length;
  const p = inp.cols.length;
  if (p === 0) return { ok: false, reason: "The model has no terms." };
  if (n <= p) return { ok: false, reason: `Quantile regression needs more rows than terms (${n} rows, ${p} terms).` };
  if (n > (inp.maxRows ?? QR_MAX_ROWS)) {
    return { ok: false, reason: `Quantile regression accepts at most ${QR_MAX_ROWS.toLocaleString("en-US")} rows per fit (this table has ${n.toLocaleString("en-US")}); the exact LP would not finish in reasonable time. Fit a random sample of the rows.` };
  }
  const started = Date.now();
  const deadline = inp.deadline ?? started + (inp.wallMs ?? QR_WALL_MS);
  const maxWork = inp.maxWork ?? QR_MAX_WORK;

  // Scaling by powers of two (exact).
  let ymax = 0;
  for (let i = 0; i < n; i++) ymax = mMax(ymax, mAbs(inp.y[i]));
  const ys = pow2Near(ymax);
  const y = Float64Array.from(inp.y, (v) => v / ys);
  const cs = inp.cols.map((c) => {
    let m = 0;
    for (let i = 0; i < n; i++) m = mMax(m, mAbs(c[i]));
    return pow2Near(m);
  });
  const X = inp.cols.map((c, k) => Float64Array.from(c, (v) => v / cs[k]));

  // Perturbation δ (fixed, generic).
  const prng = new Pcg32(1);
  const delta = new Float64Array(n);
  for (let i = 0; i < n; i++) delta[i] = (prng.nextU32() + 0.5) / 4294967296;

  // Starting basis: greedy over the preferred order, Gram–Schmidt rank test.
  const order = inp.startOrder ?? Int32Array.from({ length: n }, (_, i) => i);
  const basis = new Int32Array(p);
  const ortho: Float64Array[] = [];
  let found = 0;
  for (let t = 0; t < order.length && found < p; t++) {
    const i = order[t];
    const v = new Float64Array(p);
    for (let k = 0; k < p; k++) v[k] = X[k][i];
    let nrm0 = 0;
    for (let k = 0; k < p; k++) nrm0 += v[k] * v[k];
    nrm0 = Math.sqrt(nrm0);
    if (!(nrm0 > 0)) continue;
    for (const u of ortho) {
      let dot = 0;
      for (let k = 0; k < p; k++) dot += u[k] * v[k];
      for (let k = 0; k < p; k++) v[k] -= dot * u[k];
    }
    let nrm = 0;
    for (let k = 0; k < p; k++) nrm += v[k] * v[k];
    nrm = Math.sqrt(nrm);
    if (nrm <= 1e-9 * nrm0) continue;
    for (let k = 0; k < p; k++) v[k] /= nrm;
    ortho.push(v);
    basis[found++] = i;
  }
  if (found < p) return { ok: false, reason: "The design matrix does not have full rank (collinear columns), so the quantile regression has no unique vertex." };

  const inBasis = new Int32Array(n).fill(-1);
  basis.forEach((i, j) => (inBasis[i] = j));
  const r = new Float64Array(n);
  const q = new Float64Array(n);
  const tol = new Float64Array(n);
  const c = new Float64Array(n);
  const sgn = new Int8Array(n);
  // Candidate buffers for the line search.
  const kT = new Float64Array(n);
  const kQ = new Float64Array(n);
  const kW = new Float64Array(n);
  const kI = new Int32Array(n);
  let beta = new Float64Array(p);
  let Ainv: number[][] = [];
  let work = 0;
  let pivots = 0;
  const stepCost = 6 * n * p + p * p * p;
  const maxPivots = 50 * n + 1000;
  let maybeNonUnique = false;

  for (;;) {
    // Solve the basis.
    const Xh: number[][] = [];
    for (let j = 0; j < p; j++) {
      const row: number[] = [];
      for (let k = 0; k < p; k++) row.push(X[k][basis[j]]);
      Xh.push(row);
    }
    const inv = invert(Xh);
    if (!inv) return { ok: false, reason: "The simplex reached a numerically singular basis (nearly collinear columns); the quantile regression cannot be solved reliably." };
    Ainv = inv;
    beta = new Float64Array(p);
    const qd = new Float64Array(p);
    for (let k = 0; k < p; k++) {
      let s1 = 0;
      let s2 = 0;
      for (let j = 0; j < p; j++) {
        s1 += Ainv[k][j] * y[basis[j]];
        s2 += Ainv[k][j] * delta[basis[j]];
      }
      beta[k] = s1;
      qd[k] = s2;
    }
    // Residuals, ε-parts and zero tolerances.
    for (let i = 0; i < n; i++) {
      r[i] = y[i];
      q[i] = delta[i];
      tol[i] = mAbs(y[i]);
    }
    for (let k = 0; k < p; k++) {
      const col = X[k];
      const bk = beta[k];
      const qk = qd[k];
      for (let i = 0; i < n; i++) {
        const xv = col[i];
        r[i] -= xv * bk;
        q[i] -= xv * qk;
        tol[i] += mAbs(xv * bk);
      }
    }
    let ties = false;
    for (let i = 0; i < n; i++) {
      if (inBasis[i] >= 0) {
        r[i] = 0;
        q[i] = 0;
        sgn[i] = 0;
        continue;
      }
      if (mAbs(r[i]) <= 64 * EPS * tol[i]) {
        r[i] = 0;
        ties = true;
        sgn[i] = q[i] > 0 ? 1 : q[i] < 0 ? -1 : 1;
      } else sgn[i] = r[i] > 0 ? 1 : -1;
    }
    // g = Σ ψᵢ xᵢ over non-basic rows; ξ = −Ainvᵀ g.
    const g = new Float64Array(p);
    let gmag = 0;
    for (let k = 0; k < p; k++) {
      const col = X[k];
      let s = 0;
      let sa = 0;
      for (let i = 0; i < n; i++) {
        if (sgn[i] === 0) continue;
        const psi = sgn[i] > 0 ? tau : tau - 1;
        s += psi * col[i];
        sa += mAbs(col[i]);
      }
      g[k] = s;
      gmag = mMax(gmag, sa);
    }
    let ainvMax = 0;
    for (const row of Ainv) for (const v of row) ainvMax = mMax(ainvMax, mAbs(v));
    const xiTol = mMax(1e-11, 1e3 * EPS * gmag * ainvMax * p);
    let bestJ = -1;
    let bestV = 0;
    let bestS = 0;
    let nearBound = false;
    for (let j = 0; j < p; j++) {
      let xi = 0;
      for (let k = 0; k < p; k++) xi -= Ainv[k][j] * g[k];
      const vUp = xi - tau;
      const vDn = tau - 1 - xi;
      if (mAbs(vUp) <= xiTol || mAbs(vDn) <= xiTol) nearBound = true;
      if (vUp > xiTol && vUp > bestV) {
        bestV = vUp;
        bestJ = j;
        bestS = 1;
      } else if (vDn > xiTol && vDn > bestV) {
        bestV = vDn;
        bestJ = j;
        bestS = -1;
      }
    }
    work += stepCost;
    if (bestJ < 0) {
      maybeNonUnique = ties || nearBound;
      break;
    }
    if (pivots >= maxPivots || work > maxWork) {
      return { ok: false, reason: `The quantile-regression simplex did not converge within its step limit (${pivots.toLocaleString("en-US")} steps) for τ = ${tau}; the result is not reported.` };
    }
    if (Date.now() > deadline) {
      return { ok: false, reason: `The quantile-regression simplex ran past its ${(inp.wallMs ?? QR_WALL_MS) / 1000} s time limit (τ = ${tau}, ${pivots.toLocaleString("en-US")} steps); use fewer rows or fewer quantiles.` };
    }
    // Direction d = −s · Ainv[:, j]; cᵢ = xᵢᵀd.
    const d = new Float64Array(p);
    for (let k = 0; k < p; k++) d[k] = -bestS * Ainv[k][bestJ];
    c.fill(0);
    for (let k = 0; k < p; k++) {
      const col = X[k];
      const dk = d[k];
      if (dk === 0) continue;
      for (let i = 0; i < n; i++) c[i] += col[i] * dk;
    }
    // Breakpoints tᵢ = rᵢ/cᵢ > 0 (lexicographically with the ε-part).
    let m = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (inBasis[i] >= 0) continue;
      const ci = c[i];
      if (ci === 0) continue;
      const t = r[i] / ci;
      const tq = q[i] / ci;
      if (t > 0 || (t === 0 && tq > 0)) {
        kT[m] = t;
        kQ[m] = tq;
        kW[m] = mAbs(ci);
        kI[m] = i;
        total += kW[m];
        m++;
      }
    }
    const need = bestV;
    if (!(total >= need)) {
      return { ok: false, reason: "The quantile-regression LP is unbounded along a direction, which means the design is rank deficient." };
    }
    const enter = weightedSelect(kT, kQ, kW, kI, m, need);
    const leave = basis[bestJ];
    inBasis[leave] = -1;
    basis[bestJ] = enter;
    inBasis[enter] = bestJ;
    pivots++;
  }

  // Unscale. β_orig[k] = β_scaled[k]·ys/cs[k]; residuals recomputed in original units, exact zeros on the basis.
  const bOut = new Float64Array(p);
  for (let k = 0; k < p; k++) bOut[k] = (beta[k] * ys) / cs[k];
  const resid = new Float64Array(n);
  for (let i = 0; i < n; i++) resid[i] = r[i] * ys;
  for (const i of basis) resid[i] = 0;
  const objective = checkObjective(resid, tau);
  return { ok: true, beta: bOut, resid, basis: Int32Array.from(basis), objective, pivots, maybeNonUnique };
}

/** Lexicographic less-than on (t, tq, index). */
function lexLess(t1: number, q1: number, i1: number, t2: number, q2: number, i2: number): boolean {
  if (t1 !== t2) return t1 < t2;
  if (q1 !== q2) return q1 < q2;
  return i1 < i2;
}

/**
 * The first breakpoint (in (t, tq, index) order) at which the cumulative weight reaches `need`: a weighted
 * quickselect, expected O(m). Reorders the buffers.
 */
function weightedSelect(T: Float64Array, Q: Float64Array, W: Float64Array, I: Int32Array, m: number, need: number): number {
  let lo = 0;
  let hi = m - 1;
  let rest = need;
  const swap = (a: number, b: number): void => {
    let t = T[a];
    T[a] = T[b];
    T[b] = t;
    t = Q[a];
    Q[a] = Q[b];
    Q[b] = t;
    t = W[a];
    W[a] = W[b];
    W[b] = t;
    const u = I[a];
    I[a] = I[b];
    I[b] = u;
  };
  // Every round removes at least the pivot from [lo, hi], so at most m rounds.
  for (let guard = 0; guard <= m; guard++) {
    if (lo >= hi) return I[lo];
    // Median of three as the pivot.
    const mid = (lo + hi) >> 1;
    const less = (a: number, b: number): boolean => lexLess(T[a], Q[a], I[a], T[b], Q[b], I[b]);
    if (less(mid, lo)) swap(mid, lo);
    if (less(hi, lo)) swap(hi, lo);
    if (less(hi, mid)) swap(hi, mid);
    swap(mid, hi);
    const pt = T[hi];
    const pq = Q[hi];
    const pi = I[hi];
    let store = lo;
    let wl = 0;
    for (let k = lo; k < hi; k++) {
      if (lexLess(T[k], Q[k], I[k], pt, pq, pi)) {
        wl += W[k];
        swap(k, store);
        store++;
      }
    }
    swap(store, hi);
    // [lo, store) < pivot at store < (store, hi]
    if (wl >= rest) hi = store - 1;
    else if (wl + W[store] >= rest) return I[store];
    else {
      rest -= wl + W[store];
      lo = store + 1;
    }
  }
  return I[Math.min(lo, m - 1)];
}

// ---------------------------------------------------------------------------------------------------------------
// statsmodels' standard errors.

/** Hyndman–Fan type 7 percentile of an unsorted array (scipy scoreatpercentile / numpy "linear"). */
export function percentileLinear(v: ArrayLike<number>, pct: number): number {
  const s = Float64Array.from(v).sort();
  const n = s.length;
  const h = (n - 1) * (pct / 100);
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

export function hallSheather(n: number, q: number, alpha = 0.05): number {
  const z = normalQuantile(q);
  const num = 1.5 * Math.pow(normalPdf(z), 2.0);
  const den = 2.0 * Math.pow(z, 2.0) + 1.0;
  return Math.pow(n, -1.0 / 3) * Math.pow(normalQuantile(1.0 - alpha / 2.0), 2.0 / 3) * Math.pow(num / den, 1.0 / 3);
}

export type QrVcov = "robust" | "iid";

export interface QrCov {
  ok: true;
  cov: number[][];
  bandwidth: number;
  sparsity: number;
}

/** The factored design behind qrCovariance (the same for every τ, so a run factors it once). */
export interface QrDesign {
  ok: true;
  /** Thin Q of the centred, scaled design (p columns of length n). */
  Q: Float64Array[];
  /** R⁻¹ (upper triangular). */
  Rinv: number[][];
  /** Column scales (powers of two) and means (0 for uncentred columns). */
  cs: number[];
  means: number[];
  /** Index of the constant column (−1 if none) and its value. */
  ci: number;
  cval: number;
}

/**
 * The design, reparameterised exactly: with a constant column (every value the same nonzero k), every other column is
 * centred (the intercept then absorbs the means); each column is divided by a power of two near its largest magnitude.
 * Householder QR of that design, X = QR, gives (XᵀX)⁻¹ = R⁻¹R⁻ᵀ and XᵀDX = Rᵀ(QᵀDQ)R, so the sandwich is
 * R⁻¹(QᵀDQ)R⁻ᵀ: the rounding follows the condition number of X, never that of XᵀX (its square).
 */
export function qrDesign(cols: Float64Array[]): QrDesign | { ok: false; reason: string } {
  const p = cols.length;
  const n = p ? cols[0].length : 0;
  const isConst = cols.map((col) => col[0] !== 0 && col.every((v) => v === col[0]));
  const ci = isConst.indexOf(true);
  const means = cols.map((col, k) => {
    if (ci < 0 || isConst[k]) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) s += col[i];
    return s / n;
  });
  const Xc = cols.map((col, k) => (means[k] === 0 ? Float64Array.from(col) : Float64Array.from(col, (v) => v - means[k])));
  const cs = Xc.map((col) => {
    let m = 0;
    for (let i = 0; i < n; i++) m = mMax(m, mAbs(col[i]));
    return m > 0 ? pow2Near(m) : 1;
  });
  for (let k = 0; k < p; k++) {
    const col = Xc[k];
    for (let i = 0; i < n; i++) col[i] /= cs[k];
  }
  const qr = householderThin(Xc, n);
  if (!qr) return { ok: false, reason: "The design is numerically rank-deficient (a column is a combination of the others), so the standard errors cannot be formed." };
  return { ok: true, Q: qr.Q, Rinv: invUpperTri(qr.R), cs, means, ci, cval: ci >= 0 ? cols[ci][0] : 1 };
}

/**
 * The covariance of β̂ by statsmodels QuantReg's formula at the given residuals (exact zeros on the basis).
 * `cols` include the constant column if any; `design` is qrDesign(cols), computed here when not given.
 */
export function qrCovariance(
  y: Float64Array,
  cols: Float64Array[],
  resid: Float64Array,
  q: number,
  vcov: QrVcov,
  design?: QrDesign | { ok: false; reason: string },
): QrCov | { ok: false; reason: string } {
  const n = y.length;
  const p = cols.length;
  const iqre = percentileLinear(resid, 75) - percentileLinear(resid, 25);
  const h0 = hallSheather(n, q);
  if (!(q - h0 > 0 && q + h0 < 1)) {
    return {
      ok: false,
      reason: `The Hall–Sheather bandwidth (${h0.toFixed(4)}) reaches past τ = ${q} to the edge of (0, 1) with ${n} rows, so the sparsity (and every standard error) is undefined; statsmodels would return NaN. Use a quantile nearer the middle, or more rows.`,
    };
  }
  let my = 0;
  for (let i = 0; i < n; i++) my += y[i];
  my /= n;
  let vy = 0;
  for (let i = 0; i < n; i++) vy += (y[i] - my) * (y[i] - my);
  const sdy = Math.sqrt(vy / n);
  const h = Math.min(sdy, iqre / 1.34) * (normalQuantile(q + h0) - normalQuantile(q - h0));
  if (!(h > 0)) {
    return { ok: false, reason: "The residuals' interquartile range is 0 (at least half the rows are fitted exactly), so the kernel bandwidth is 0 and the standard errors are undefined." };
  }
  let ks = 0;
  for (let i = 0; i < n; i++) {
    const u = resid[i] / h;
    if (mAbs(u) <= 1) ks += 0.75 * (1 - u * u);
  }
  const fhat0 = (1.0 / (n * h)) * ks;
  if (!(fhat0 > 0)) {
    return { ok: false, reason: "No residual lies within the kernel bandwidth of zero, so the density estimate f̂(0) is 0 and the standard errors are undefined." };
  }
  const des = design ?? qrDesign(cols);
  if (!des.ok) return des;
  const { Q, Rinv, cs, means, ci, cval } = des;
  let S: number[][];
  let f = 1;
  if (vcov === "robust") {
    const dPos = Math.pow(q / fhat0, 2);
    const dNeg = Math.pow((1 - q) / fhat0, 2);
    // QᵀDQ with D taking two values: QᵀQ = I, so QᵀDQ = d_rest·I + (d_set − d_rest)·Σ_{i∈set} qᵢqᵢᵀ over the SMALLER of
    // the positive-residual and the other rows (min(τ, 1 − τ)·n rows instead of n).
    let nPos = 0;
    for (let i = 0; i < n; i++) if (resid[i] > 0) nPos++;
    const usePos = nPos <= n - nPos;
    const idx = new Int32Array(usePos ? nPos : n - nPos);
    let m = 0;
    for (let i = 0; i < n; i++) if (resid[i] > 0 === usePos) idx[m++] = i;
    const dSet = usePos ? dPos : dNeg;
    const dRest = usePos ? dNeg : dPos;
    const rows = Q.map((col) => Float64Array.from(idx, (i) => col[i]));
    S = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let a = 0; a < p; a++) {
      const qa = rows[a];
      for (let b = a; b < p; b++) {
        const qb = rows[b];
        let s = 0;
        for (let r = 0; r < m; r++) s += qa[r] * qb[r];
        const v = (dSet - dRest) * s + (a === b ? dRest : 0);
        S[a][b] = v;
        S[b][a] = v;
      }
    }
  } else {
    S = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : 0)));
    f = Math.pow(1.0 / fhat0, 2) * q * (1 - q);
  }
  // Vc = R⁻¹ S R⁻ᵀ (R⁻¹ upper triangular).
  const RS = Rinv.map((ra) => Array.from({ length: p }, (_, j) => {
    let s = 0;
    for (let k = 0; k < p; k++) s += ra[k] * S[k][j];
    return s;
  }));
  const Vc = Rinv.map((_, a) => Array.from({ length: p }, (_, b) => {
    let s = 0;
    for (let k = 0; k < p; k++) s += RS[a][k] * Rinv[b][k];
    return (f * s) / (cs[a] * cs[b]);
  }));
  // Back to the user's parameters: with the constant column equal to k in every row, β_const = c_const − Σ (mⱼ/k)·cⱼ
  // and every other βⱼ = cⱼ; V = G·Vc·Gᵀ.
  const G = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? 1 : a === ci ? -means[b] / cval : 0)));
  const GV = G.map((ga) => Array.from({ length: p }, (_, j) => {
    let s = 0;
    for (let k = 0; k < p; k++) if (ga[k] !== 0) s += ga[k] * Vc[k][j];
    return s;
  }));
  const cov = GV.map((ra) => Array.from({ length: p }, (_, b) => {
    let s = 0;
    for (let k = 0; k < p; k++) if (G[b][k] !== 0) s += ra[k] * G[b][k];
    return s;
  }));
  return { ok: true, cov, bandwidth: h, sparsity: 1.0 / fhat0 };
}

/**
 * Householder QR of p columns (each length n): R (p×p upper triangular) and the thin Q's p columns, formed by applying
 * the reflectors to e₁…e_p. Null when a column's part outside the earlier ones is at rounding level.
 */
function householderThin(cols: Float64Array[], n: number): { Q: Float64Array[]; R: number[][] } | null {
  const p = cols.length;
  if (p > n) return null;
  const A = cols.map((c) => Float64Array.from(c));
  const V: Float64Array[] = [];
  const vtv: number[] = [];
  const R: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const reflect = (k: number, a: Float64Array): void => {
    const v = V[k];
    let dot = 0;
    for (let i = k; i < n; i++) dot += v[i] * a[i];
    const fct = (2 * dot) / vtv[k];
    if (fct !== 0) for (let i = k; i < n; i++) a[i] -= fct * v[i];
  };
  for (let j = 0; j < p; j++) {
    const a = A[j];
    let full = 0;
    for (let i = 0; i < n; i++) full += a[i] * a[i];
    for (let k = 0; k < j; k++) reflect(k, a);
    let nrm = 0;
    for (let i = j; i < n; i++) nrm += a[i] * a[i];
    nrm = Math.sqrt(nrm);
    if (!(nrm > 1e-13 * Math.sqrt(full))) return null;
    const alpha = a[j] > 0 ? -nrm : nrm;
    const v = new Float64Array(n);
    v[j] = a[j] - alpha;
    for (let i = j + 1; i < n; i++) v[i] = a[i];
    let vv = 0;
    for (let i = j; i < n; i++) vv += v[i] * v[i];
    V.push(v);
    vtv.push(vv);
    for (let i = 0; i < j; i++) R[i][j] = a[i];
    R[j][j] = alpha;
  }
  const Q: Float64Array[] = [];
  for (let j = 0; j < p; j++) {
    const e = new Float64Array(n);
    e[j] = 1;
    for (let k = p - 1; k >= 0; k--) reflect(k, e);
    Q.push(e);
  }
  return { Q, R };
}

/** The inverse of an upper-triangular matrix by back substitution. */
function invUpperTri(R: number[][]): number[][] {
  const p = R.length;
  const X: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let col = 0; col < p; col++) {
    for (let i = col; i >= 0; i--) {
      let s = i === col ? 1 : 0;
      for (let j = i + 1; j <= col; j++) s -= R[i][j] * X[j][col];
      X[i][col] = s / R[i][i];
    }
  }
  return X;
}

/** Koenker–Machado's restricted objective: Σ ρ_τ(y − y₍⌈nτ⌉₎), the intercept-only minimum. */
export function interceptOnlyObjective(y: Float64Array, tau: number): number {
  const s = Float64Array.from(y).sort();
  const n = s.length;
  const k = Math.min(n, mMax(1, Math.ceil(n * tau - 1e-12)));
  const qv = s[k - 1];
  let v = 0;
  for (let i = 0; i < n; i++) {
    const r = y[i] - qv;
    v += r < 0 ? (tau - 1) * r : tau * r;
  }
  return v;
}
