/**
 * Release F3 gap #19, GMM and dynamic panels — the engines behind econ-gmm and panel-dyn-gmm (gmmStatCalcs.ts).
 *
 * LINEAR GMM (fitLinearGmm), as linearmodels 7.1 IVGMM computes it: y = Xβ + u with instruments Z (the exogenous
 * regressors and the constant instrument themselves). Step 1 is 2SLS, W₀ = (ZᵀZ/n)⁻¹; step 2 re-weights with
 * W = S⁻¹, S = (1/n) Σ zᵢzᵢᵀûᵢ² from the 2SLS residuals (heteroskedasticity-robust) or (1/n) Σ_g (Σ_{i∈g} zᵢûᵢ)(…)ᵀ
 * (clustered). The covariance is the sandwich (GᵀWG)⁻¹GᵀWŜWG(GᵀWG)⁻¹/n with G = ZᵀX/n and Ŝ re-estimated at the
 * final residuals (linearmodels' IVGMMCovariance, debiased=False); Hansen's J = n·ḡᵀWḡ with W from the 2SLS residuals
 * and ḡ at the two-step estimate (uncentered), χ² with L − k df.
 *
 * DYNAMIC PANELS (buildDynamic + fitDynamic), as Roodman's xtabond2 defines them (Roodman 2009, "How to do
 * xtabond2", Stata Journal 9(1): 86–136), checked against its published abdata tables, pydynpd 0.2.2 and an
 * independent numpy implementation (scripts/gmm_np.py):
 *  - difference GMM (Arellano and Bond 1991): first differences; GMM-style instruments, levels lagged a…b of y and of
 *    each endogenous regressor, one column per period and lag ("missing = 0"), or one per lag when collapsed;
 *    exogenous regressors instrument themselves in differences (one IV-style column each); time dummies enter
 *    differenced, as regressors and as instruments;
 *  - system GMM (Blundell and Bond 1998): the differenced rows stacked with the level rows; level instruments are the
 *    difference dated a − 1 (per period, or collapsed); an exogenous regressor is ONE column holding its difference in
 *    the differenced rows and its level in the level rows (Roodman's (24)); time dummies and the constant instrument
 *    the level equation only (Roodman's ivstyle(yr*, equation(level)) example);
 *  - one-step weight A₁ = (Σ ZᵢᵀHᵢZᵢ)⁺ with xtabond2's default H: 2 on the diagonal and −1 between consecutive
 *    periods for differences (Roodman's (22)); for system GMM H = M⁺M⁺ᵀ with M⁺ = [M; I] (Roodman's (26), h(3));
 *  - one-step robust covariance (Arellano–Bond cluster-robust sandwich); two-step weight W₂ = (Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ)⁺ and
 *    Windmeijer's (2005) corrected covariance V₂ + DV₂ + V₂Dᵀ + DV₁Dᵀ;
 *  - Hansen J from the two-step estimate (also printed after one-step, as xtabond2 does); Sargan = g₁ᵀA₁g₁/σ̂² from the
 *    one-step residuals with σ̂² = Σ Δû₁²/(2·N_obs), N_obs the reported observation count;
 *  - Arellano–Bond AR(m) tests on the differenced residuals (Roodman's section 3.5 formula, with the reported
 *    covariance and residuals of the step shown).
 * Generalized inverses: linearly dependent instrument columns are dropped first (the estimator is invariant to that),
 * symmetric matrices are inverted by Cholesky and, when singular (e.g. more instruments than groups), by the
 * Moore–Penrose inverse with eigenvalues below L·ε·λ_max discarded.
 *
 * Every loop is bounded by the caps below; work beyond them is refused by name before it starts.
 */
import { chiSquareP, normalCdf } from "./stats2";
import { intText } from "./regTable";

export class GmmRefusal extends Error {}

/** At most this many groups (entities) in a dynamic panel. */
export const DPD_MAX_GROUPS = 2000;
/** At most this many periods from the first to the last (gaps included). */
export const DPD_MAX_PERIODS = 40;
/** At most this many instrument columns after the dependent ones are dropped. */
export const DPD_MAX_INSTR = 400;
/** At most this many raw instrument columns before reduction (the bound on the ZᵀZ pass). */
export const DPD_MAX_RAW_INSTR = 1200;
/** At most this many regressors (lags, exogenous terms and kept time dummies). */
export const DPD_MAX_REGRESSORS = 40;
/** Work bound N·L² (the moment-covariance and Windmeijer passes): 500 groups × 222 instruments ran in 0.32 s under Node. */
export const DPD_MAX_WORK = 2.5e7;
/** Linear GMM: at most this many rows and this many columns in X and Z together. */
export const LGMM_MAX_ROWS = 100_000;
export const LGMM_MAX_COLUMNS = 60;

const EPS = Number.EPSILON;
const Z975 = 1.959963984540054;

// ------------------------------------------------------------------------------------------------ dense helpers

/** Row-major n×m product A(n×p)·B(p×m). */
function mul(A: Float64Array, B: Float64Array, n: number, p: number, m: number): Float64Array {
  const C = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      const a = A[i * p + k];
      if (a === 0) continue;
      const bo = k * m;
      const co = i * m;
      for (let j = 0; j < m; j++) C[co + j] += a * B[bo + j];
    }
  }
  return C;
}
/** Aᵀ (n×m → m×n). */
function tr(A: Float64Array, n: number, m: number): Float64Array {
  const B = new Float64Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) B[j * n + i] = A[i * m + j];
  return B;
}
/** A·v. */
function mv(A: Float64Array, v: Float64Array, n: number, m: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * m;
    for (let j = 0; j < m; j++) s += A[o + j] * v[j];
    out[i] = s;
  }
  return out;
}
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
/** vᵀAv. */
function quad(A: Float64Array, v: Float64Array, n: number): number {
  return dot(v, mv(A, v, n, n));
}
function symmetrize(A: Float64Array, n: number): void {
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const s = 0.5 * (A[i * n + j] + A[j * n + i]);
      A[i * n + j] = s;
      A[j * n + i] = s;
    }
}

/**
 * Symmetric eigendecomposition (Householder tridiagonalisation and the implicit QL method, after the public-domain
 * JAMA EigenvalueDecomposition tred2/tql2). Returns eigenvalues d and eigenvectors as the columns of V (row-major).
 */
export function symEigen(A: Float64Array, n: number): { d: Float64Array; V: Float64Array } {
  const V = Float64Array.from(A);
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  const at = (i: number, j: number): number => V[i * n + j];
  const set = (i: number, j: number, v: number): void => {
    V[i * n + j] = v;
  };
  for (let j = 0; j < n; j++) d[j] = at(n - 1, j);
  // tred2
  for (let i = n - 1; i > 0; i--) {
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) {
        d[j] = at(i - 1, j);
        set(i, j, 0);
        set(j, i, 0);
      }
    } else {
      for (let k = 0; k < i; k++) {
        d[k] /= scale;
        h += d[k] * d[k];
      }
      let f = d[i - 1];
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j];
        set(j, i, f);
        g = e[j] + at(j, j) * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += at(k, j) * d[k];
          e[k] += at(k, j) * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] /= h;
        f += e[j] * d[j];
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j];
        g = e[j];
        for (let k = j; k <= i - 1; k++) set(k, j, at(k, j) - (f * e[k] + g * d[k]));
        d[j] = at(i - 1, j);
        set(i, j, 0);
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    set(n - 1, i, at(i, i));
    set(i, i, 1);
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = at(k, i + 1) / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += at(k, i + 1) * at(k, j);
        for (let k = 0; k <= i; k++) set(k, j, at(k, j) - g * d[k]);
      }
    }
    for (let k = 0; k <= i; k++) set(k, i + 1, 0);
  }
  for (let j = 0; j < n; j++) {
    d[j] = at(n - 1, j);
    set(n - 1, j, 0);
  }
  set(n - 1, n - 1, 1);
  e[0] = 0;
  // tql2
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0;
  let tst1 = 0;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n) {
      if (Math.abs(e[m]) <= EPS * tst1) break;
      m++;
    }
    if (m > l) {
      // At most 60 sweeps per eigenvalue (convergence is cubic; the bound keeps a pathological input from hanging).
      for (let iter = 0; iter < 60; iter++) {
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1;
        let c2 = c;
        let c3 = c;
        const el1 = e[l + 1];
        let s = 0;
        let s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            h = at(k, i + 1);
            set(k, i + 1, s * at(k, i) + c * h);
            set(k, i, c * at(k, i) - s * h);
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        d[l] = c * p;
        if (!(Math.abs(e[l]) > EPS * tst1)) break;
      }
    }
    d[l] = d[l] + f;
    e[l] = 0;
  }
  return { d, V };
}

/**
 * Inverse of a symmetric positive semi-definite matrix: Cholesky when it is clearly non-singular, else the
 * Moore–Penrose inverse (eigenvalues ≤ n·ε·λ_max discarded). `generalized` says which was used.
 */
export function symInverse(A0: Float64Array, n: number): { inv: Float64Array; generalized: boolean; rank: number } {
  const A = Float64Array.from(A0);
  symmetrize(A, n);
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, Math.abs(A[i * n + i]));
  const L = new Float64Array(n * n);
  let ok = maxDiag > 0;
  for (let j = 0; j < n && ok; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= L[j * n + k] * L[j * n + k];
    if (!(s > 1e-11 * Math.max(Math.abs(A[j * n + j]), 1e-300)) || !(s > n * EPS * maxDiag)) {
      ok = false;
      break;
    }
    const ljj = Math.sqrt(s);
    L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let t = A[i * n + j];
      for (let k = 0; k < j; k++) t -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = t / ljj;
    }
  }
  if (ok) {
    // inv = L⁻ᵀ L⁻¹: invert L (lower) then multiply.
    const Li = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      Li[i * n + i] = 1 / L[i * n + i];
      for (let j = 0; j < i; j++) {
        let s = 0;
        for (let k = j; k < i; k++) s -= L[i * n + k] * Li[k * n + j];
        Li[i * n + j] = s / L[i * n + i];
      }
    }
    const inv = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) {
        let s = 0;
        for (let k = i; k < n; k++) s += Li[k * n + i] * Li[k * n + j];
        inv[i * n + j] = s;
        inv[j * n + i] = s;
      }
    return { inv, generalized: false, rank: n };
  }
  const { d, V } = symEigen(A, n);
  let lmax = 0;
  for (let i = 0; i < n; i++) lmax = Math.max(lmax, Math.abs(d[i]));
  const tol = n * EPS * lmax;
  const inv = new Float64Array(n * n);
  let rank = 0;
  for (let k = 0; k < n; k++) {
    if (!(Math.abs(d[k]) > tol) || lmax === 0) continue;
    rank++;
    const w = 1 / d[k];
    for (let i = 0; i < n; i++) {
      const vik = V[i * n + k] * w;
      if (vik === 0) continue;
      for (let j = 0; j < n; j++) inv[i * n + j] += vik * V[j * n + k];
    }
  }
  symmetrize(inv, n);
  return { inv, generalized: true, rank };
}

/**
 * Greedy column selection on a Gram matrix G (n×n): column j is kept when its squared distance from the span of the
 * kept columns exceeds tol × its own squared norm (pivoted Cholesky in the given order). Returns the kept indices.
 */
export function independentColumns(G: Float64Array, n: number, tol = 1e-10, order?: number[]): number[] {
  const ord = order ?? Array.from({ length: n }, (_, i) => i);
  const kept: number[] = [];
  // Rows of the partial Cholesky factor for the kept columns: R[kept_k][*] over all n columns.
  const R: Float64Array[] = [];
  for (const j of ord) {
    const gjj = G[j * n + j];
    if (!(gjj > 0)) continue;
    let s = gjj;
    for (let k = 0; k < kept.length; k++) s -= R[k][j] * R[k][j];
    if (!(s > tol * gjj)) continue;
    const rjj = Math.sqrt(s);
    const row = new Float64Array(n);
    for (let c = 0; c < n; c++) {
      let t = G[j * n + c];
      for (let k = 0; k < kept.length; k++) t -= R[k][j] * R[k][c];
      row[c] = t / rjj;
    }
    R.push(row);
    kept.push(j);
  }
  return kept;
}

function normalP2(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

// ------------------------------------------------------------------------------------------------ linear GMM

export interface LinearGmmInput {
  y: ArrayLike<number>;
  /** Regressor columns (endogenous, exogenous, constant as a column of ones if wanted). */
  X: ArrayLike<number>[];
  names: string[];
  /** Instrument columns (excluded instruments, exogenous regressors, constant). */
  Z: ArrayLike<number>[];
  /** Cluster codes 0…G−1 for a clustered weight and covariance, or undefined (heteroskedastic). */
  clusters?: Int32Array;
  G?: number;
  steps: 1 | 2;
}

export interface CoefSet {
  b: Float64Array;
  se: Float64Array;
}

export interface LinearGmmResult {
  n: number;
  k: number;
  L: number;
  tsls: CoefSet;
  gmm: CoefSet;
  /** Hansen J of the two-step estimate (computed whichever step is reported). */
  j: number;
  jdf: number;
  jp: number;
  /** True when the two-step moment covariance had to be inverted by a generalized inverse. */
  singularS: boolean;
}

export function fitLinearGmm(inp: LinearGmmInput): LinearGmmResult {
  const n = inp.y.length;
  const k = inp.X.length;
  const L = inp.Z.length;
  if (n > LGMM_MAX_ROWS) throw new GmmRefusal(`The data have ${intText(n)} rows; GMM here is limited to ${intText(LGMM_MAX_ROWS)} rows.`);
  if (k + L > LGMM_MAX_COLUMNS) throw new GmmRefusal(`${k} regressors and ${L} instruments is more than the ${LGMM_MAX_COLUMNS} columns this calculator allows.`);
  if (L < k) throw new GmmRefusal(`Under-identified: ${L} instruments for ${k} coefficients. Each endogenous regressor needs at least one excluded instrument.`);
  if (n <= L) throw new GmmRefusal(`${intText(n)} rows is too few for ${L} instruments (GMM needs more rows than instruments).`);
  const y = Float64Array.from(inp.y);
  const X = new Float64Array(n * k);
  const Z = new Float64Array(n * L);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) X[i * k + j] = inp.X[j][i];
    for (let j = 0; j < L; j++) Z[i * L + j] = inp.Z[j][i];
  }
  const Zt = tr(Z, n, L);
  const ZZ = mul(Zt, Z, L, n, L);
  {
    const kept = independentColumns(ZZ, L, 1e-11);
    if (kept.length < L) throw new GmmRefusal("The instruments are perfectly collinear (ZᵀZ is singular): one instrument is a combination of the others, or a column is constant alongside the constant.");
  }
  const ZX = mul(Zt, X, L, n, k); // L×k
  const Zy = mv(Zt, y, L, n);
  const XZ = tr(ZX, L, k);
  const W0 = symInverse(ZZ, L).inv;
  const est = (W: Float64Array): Float64Array => {
    const XZW = mul(XZ, W, k, L, L);
    const Mi = mul(XZW, ZX, k, L, k);
    const inv = symInverse(Mi, k);
    if (inv.generalized) throw new GmmRefusal("XᵀZ W ZᵀX is singular: the regressors are perfectly collinear given the instruments (or an endogenous regressor is not predicted by the instruments at all).");
    return mv(inv.inv, mv(XZW, Zy, k, L), k, k);
  };
  const resid = (b: Float64Array): Float64Array => {
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = y[i];
      for (let j = 0; j < k; j++) s -= X[i * k + j] * b[j];
      e[i] = s;
    }
    return e;
  };
  // S/n·n: the sum, divided by n below.
  const Smat = (e: Float64Array): Float64Array => {
    const S = new Float64Array(L * L);
    if (inp.clusters) {
      const G = inp.G ?? 0;
      const sums = new Float64Array(G * L);
      for (let i = 0; i < n; i++) {
        const g = inp.clusters[i];
        for (let j = 0; j < L; j++) sums[g * L + j] += Z[i * L + j] * e[i];
      }
      for (let g = 0; g < G; g++)
        for (let a = 0; a < L; a++) {
          const va = sums[g * L + a];
          if (va === 0) continue;
          for (let b = a; b < L; b++) S[a * L + b] += va * sums[g * L + b];
        }
    } else {
      for (let i = 0; i < n; i++) {
        const e2 = e[i] * e[i];
        for (let a = 0; a < L; a++) {
          const va = Z[i * L + a] * e2;
          if (va === 0) continue;
          for (let b = a; b < L; b++) S[a * L + b] += va * Z[i * L + b];
        }
      }
    }
    for (let a = 0; a < L; a++) for (let b = a; b < L; b++) S[b * L + a] = S[a * L + b] /= n;
    return S;
  };
  // Sandwich with W in "per-row" scale: G = ZᵀX/n, W as given (for (ZᵀZ/n)⁻¹ = n·(ZᵀZ)⁻¹ etc.).
  const cov = (Wn: Float64Array, e: Float64Array): Float64Array => {
    const Gm = new Float64Array(L * k);
    for (let i = 0; i < L * k; i++) Gm[i] = ZX[i] / n;
    const GtW = mul(tr(Gm, L, k), Wn, k, L, L);
    const Ainv = symInverse(mul(GtW, Gm, k, L, k), k).inv;
    const mid = mul(mul(GtW, Smat(e), k, L, L), tr(GtW, k, L), k, L, k);
    const C = mul(mul(Ainv, mid, k, k, k), Ainv, k, k, k);
    for (let i = 0; i < k * k; i++) C[i] /= n;
    symmetrize(C, k);
    return C;
  };
  const W0n = new Float64Array(L * L);
  for (let i = 0; i < L * L; i++) W0n[i] = W0[i] * n;
  const b1 = est(W0);
  const e1 = resid(b1);
  const C1 = cov(W0n, e1);
  const seOf = (C: Float64Array): Float64Array => Float64Array.from({ length: k }, (_, j) => Math.sqrt(Math.max(C[j * k + j], 0)));
  const tsls = { b: b1, se: seOf(C1) };
  const S1 = Smat(e1);
  const Wi = symInverse(S1, L);
  const W = Wi.inv;
  const b2 = est(W);
  const e2 = resid(b2);
  const gbar = new Float64Array(L);
  for (let i = 0; i < n; i++) for (let a = 0; a < L; a++) gbar[a] += (Z[i * L + a] * e2[i]) / n;
  const j = n * quad(W, gbar, L);
  const jdf = L - k;
  const gmm = inp.steps === 2 ? { b: b2, se: seOf(cov(W, e2)) } : tsls;
  for (const set of [tsls, gmm]) for (let q = 0; q < k; q++) if (!Number.isFinite(set.b[q]) || !Number.isFinite(set.se[q])) throw new GmmRefusal("The estimates are not finite numbers for these data (check for extreme values).");
  return { n, k, L, tsls, gmm, j, jdf, jp: jdf > 0 ? chiSquareP(Math.max(j, 0), jdf) : NaN, singularS: Wi.generalized };
}

// ------------------------------------------------------------------------------------------------ dynamic panels

/** A regressor term: variable v lagged `lag` periods; ylag = a lag of the response. */
export interface DynTerm {
  v: string;
  lag: number;
  kind: "ylag" | "endog" | "exog";
  label: string;
}

export interface DynSpec {
  y: string;
  terms: DynTerm[];
  /** Variables with GMM-style instruments (the response first, then the endogenous regressors). */
  gmmVars: string[];
  /** Instrument lags a…b of the levels (b = null: all available). */
  lagFirst: number;
  lagLast: number | null;
  system: boolean;
  timeDummies: boolean;
  collapse: boolean;
}

export interface DynData {
  /** Per variable, per entity, a series over the periods 0…T−1 (NaN = missing). */
  series: Map<string, Float64Array[]>;
  N: number;
  T: number;
  /** Label of each period (for the time-dummy names). */
  periodLabels: string[];
  timeName: string;
}

interface Row {
  /** Sparse instrument row. */
  zi: Int32Array;
  zv: Float64Array;
  x: Float64Array;
  y: number;
  t: number;
}
interface Block {
  g: number;
  nd: number;
  rows: Row[];
  /** Nonzero H entries (r, s, value), r ≤ s (the matrix is symmetric). */
  H: [number, number, number][];
  dPeriods: number[];
}

export interface DynDesign {
  blocks: Block[];
  names: string[];
  /** Term kinds of the kept columns ("dummy" and "constant" for generated columns). */
  kinds: string[];
  L: number;
  rawL: number;
  droppedDummies: string[];
  nDiff: number;
  nLevel: number;
  /** Rows per group used (difference rows for difference GMM, level rows for system GMM). */
  perGroup: { min: number; max: number; avg: number };
  /** Groups with no usable row (dropped). */
  emptyGroups: number;
  system: boolean;
}

/** Builds the stacked design (see the file comment for every convention). */
export function buildDynamic(data: DynData, spec: DynSpec): DynDesign {
  const { N, T } = data;
  if (N > DPD_MAX_GROUPS) throw new GmmRefusal(`${intText(N)} groups is more than the ${intText(DPD_MAX_GROUPS)} this calculator allows.`);
  if (T > DPD_MAX_PERIODS) throw new GmmRefusal(`The panel spans ${T} periods (gaps included); this calculator allows ${DPD_MAX_PERIODS}.`);
  if (T < 3) throw new GmmRefusal(`The panel has ${T} period${T === 1 ? "" : "s"}; a dynamic panel needs at least 3 (one lag for the regressor, one more for the difference and an instrument).`);
  const val = (v: string, g: number, t: number): number => (t < 0 || t >= T ? NaN : data.series.get(v)![g][t]);
  const terms = spec.terms;
  const kt = terms.length;
  const levelOk = (g: number, t: number): boolean => {
    if (Number.isNaN(val(spec.y, g, t))) return false;
    for (const tm of terms) if (Number.isNaN(val(tm.v, g, t - tm.lag))) return false;
    return true;
  };
  // Rows of each group.
  const dRows: number[][] = [];
  const lRows: number[][] = [];
  const dSet = new Set<number>();
  const lSet = new Set<number>();
  for (let g = 0; g < N; g++) {
    const d: number[] = [];
    const l: number[] = [];
    for (let t = 0; t < T; t++) {
      if (!levelOk(g, t)) continue;
      l.push(t);
      if (levelOk(g, t - 1)) d.push(t);
    }
    dRows.push(d);
    lRows.push(spec.system ? l : []);
    d.forEach((t) => dSet.add(t));
    if (spec.system) l.forEach((t) => lSet.add(t));
  }
  const dPer = [...dSet].sort((a, b) => a - b);
  const lPer = [...lSet].sort((a, b) => a - b);
  if (!dPer.length) throw new GmmRefusal("No entity has two consecutive periods with every value the model needs, so no first difference can be formed. Check the lags against the length of each entity's series.");
  // Instrument columns, numbered in a fixed order through lookup tables (−1 = no such column):
  //   dCol[(gi·A + a)·T + t]  GMM-style, differenced equation (collapsed: t = 0 for every period)
  //   lCol[gi·T + t]          GMM-style, level equation (collapsed: t = 0)
  //   ivCol[j], tdCol[s], consCol.
  let L0 = 0;
  const a1 = spec.lagFirst;
  const bMax = Math.min(spec.lagLast ?? T, T);
  const A = bMax + 1;
  const nG = spec.gmmVars.length;
  const dCol = new Int32Array(nG * A * T).fill(-1);
  const lCol = new Int32Array(nG * T).fill(-1);
  for (let gi = 0; gi < nG; gi++) {
    for (let a = a1; a <= bMax; a++) {
      if (spec.collapse) dCol[(gi * A + a) * T] = L0++;
      else for (const t of dPer) if (t - a >= 0) dCol[(gi * A + a) * T + t] = L0++;
    }
    if (spec.system) {
      if (spec.collapse) lCol[gi * T] = L0++;
      else for (const t of lPer) lCol[gi * T + t] = L0++;
    }
  }
  const ivCol = new Int32Array(kt).fill(-1);
  terms.forEach((tm, j) => {
    if (tm.kind === "exog") ivCol[j] = L0++;
  });
  const tdCol = new Int32Array(T).fill(-1);
  if (spec.timeDummies) for (let s = 0; s < T; s++) tdCol[s] = L0++;
  const consCol = spec.system ? L0++ : -1;
  const ser = (v: string): Float64Array[] => data.series.get(v)!;
  const ySer = ser(spec.y);
  const tSer = terms.map((tm) => ser(tm.v));
  const gSer = spec.gmmVars.map(ser);
  const at = (s: Float64Array[], g: number, t: number): number => (t < 0 || t >= T ? NaN : s[g][t]);
  if (L0 > DPD_MAX_RAW_INSTR) {
    throw new GmmRefusal(
      `The instrument set would have ${intText(L0)} columns before reduction (the limit is ${intText(DPD_MAX_RAW_INSTR)}). Choose “collapse”, or a last lag for the GMM-style instruments.`,
    );
  }
  // Regressor columns: terms, then a dummy per period, then the constant (system).
  const kFull = kt + (spec.timeDummies ? T : 0) + (spec.system ? 1 : 0);
  const blocks: Block[] = [];
  let emptyGroups = 0;
  for (let g = 0; g < N; g++) {
    const d = dRows[g];
    const l = lRows[g];
    if (!d.length && !l.length) {
      emptyGroups++;
      continue;
    }
    const rows: Row[] = [];
    const mkRow = (diff: boolean, t: number): Row => {
      const zi: number[] = [];
      const zv: number[] = [];
      const put = (c: number, v: number): void => {
        if (c < 0 || v === 0 || Number.isNaN(v)) return;
        zi.push(c);
        zv.push(v);
      };
      const x = new Float64Array(kFull);
      let y: number;
      if (diff) {
        y = at(ySer, g, t) - at(ySer, g, t - 1);
        for (let j = 0; j < kt; j++) x[j] = at(tSer[j], g, t - terms[j].lag) - at(tSer[j], g, t - 1 - terms[j].lag);
        if (spec.timeDummies) {
          x[kt + t] += 1;
          x[kt + t - 1] -= 1;
        }
        for (let gi = 0; gi < nG; gi++) for (let a = a1; a <= bMax; a++) put(dCol[(gi * A + a) * T + (spec.collapse ? 0 : t)], at(gSer[gi], g, t - a));
        for (let j = 0; j < kt; j++) if (ivCol[j] >= 0) put(ivCol[j], at(tSer[j], g, t - terms[j].lag) - at(tSer[j], g, t - 1 - terms[j].lag));
        if (spec.timeDummies && !spec.system) {
          put(tdCol[t], 1);
          put(tdCol[t - 1], -1);
        }
      } else {
        y = at(ySer, g, t);
        for (let j = 0; j < kt; j++) x[j] = at(tSer[j], g, t - terms[j].lag);
        if (spec.timeDummies) x[kt + t] = 1;
        x[kFull - 1] = 1;
        const lag = a1 - 1;
        for (let gi = 0; gi < nG; gi++) put(lCol[gi * T + (spec.collapse ? 0 : t)], at(gSer[gi], g, t - lag) - at(gSer[gi], g, t - lag - 1));
        for (let j = 0; j < kt; j++) if (ivCol[j] >= 0) put(ivCol[j], at(tSer[j], g, t - terms[j].lag));
        if (spec.timeDummies) put(tdCol[t], 1);
        put(consCol, 1);
      }
      // Sparse indices in increasing order (a column appears once per row).
      const ord = zi.map((_, i) => i).sort((p, q2) => zi[p] - zi[q2]);
      return { zi: Int32Array.from(ord.map((i) => zi[i])), zv: Float64Array.from(ord.map((i) => zv[i])), x, y, t };
    };
    for (const t of d) rows.push(mkRow(true, t));
    for (const t of l) rows.push(mkRow(false, t));
    const H: [number, number, number][] = [];
    const nd = d.length;
    for (let r = 0; r < nd; r++) {
      H.push([r, r, 2]);
      for (let r2 = r + 1; r2 < nd; r2++) if (d[r2] - d[r] === 1) H.push([r, r2, -1]);
      for (let s = 0; s < l.length; s++) {
        const v = (l[s] === d[r] ? 1 : 0) - (l[s] === d[r] - 1 ? 1 : 0);
        if (v) H.push([r, nd + s, v]);
      }
    }
    for (let s = 0; s < l.length; s++) H.push([nd + s, nd + s, 1]);
    blocks.push({ g, nd, rows, H, dPeriods: d });
  }
  // Regressors: Gram matrix XᵀX, then drop generated columns (zero first, then collinear, in order; the constant and
  // the user's terms first), and refuse a collinear user term by name.
  const XtX = new Float64Array(kFull * kFull);
  for (const b of blocks)
    for (const r of b.rows)
      for (let a = 0; a < kFull; a++) {
        const xa = r.x[a];
        if (xa === 0) continue;
        for (let c = 0; c < kFull; c++) XtX[a * kFull + c] += xa * r.x[c];
      }
  const termOrder = Array.from({ length: kt }, (_, j) => j);
  const keptTerms = independentColumns(XtX, kFull, 1e-10, termOrder);
  if (keptTerms.length < kt) {
    const bad = termOrder.find((j) => !keptTerms.includes(j))!;
    const what = XtX[bad * kFull + bad] > 0 ? "is perfectly collinear with the other regressors" : "does not vary (it is zero or constant in every row used, so its difference is zero)";
    throw new GmmRefusal(`The regressor ${terms[bad].label} ${what} in the estimation rows; remove it.`);
  }
  const genOrder = [...(spec.system ? [kFull - 1] : []), ...(spec.timeDummies ? Array.from({ length: T }, (_, s) => kt + s) : [])];
  const kept = independentColumns(XtX, kFull, 1e-10, [...termOrder, ...genOrder]).sort((a, b) => a - b);
  const droppedDummies: string[] = [];
  if (spec.timeDummies) for (let s = 0; s < T; s++) if (!kept.includes(kt + s)) droppedDummies.push(data.periodLabels[s]);
  if (spec.system && !kept.includes(kFull - 1)) throw new GmmRefusal("The constant is collinear with the regressors in the level equation; remove a regressor that is constant.");
  const names: string[] = [];
  const kinds: string[] = [];
  for (const c of kept) {
    if (c < kt) {
      names.push(terms[c].label);
      kinds.push(terms[c].kind);
    } else if (spec.system && c === kFull - 1) {
      names.push("Constant");
      kinds.push("constant");
    } else {
      names.push(`${data.timeName} ${data.periodLabels[c - kt]}`);
      kinds.push("dummy");
    }
  }
  const k = kept.length;
  if (k > DPD_MAX_REGRESSORS) throw new GmmRefusal(`${k} regressors (time dummies included) is more than the ${DPD_MAX_REGRESSORS} this calculator allows.`);
  for (const b of blocks) for (const r of b.rows) r.x = Float64Array.from(kept, (c) => r.x[c]);
  // Instruments: drop zero columns, then dependent ones (pivoted Cholesky on ZᵀZ, scaled).
  const nnz = new Int32Array(L0);
  for (const b of blocks) for (const r of b.rows) for (const c of r.zi) nnz[c]++;
  const nzCols: number[] = [];
  for (let c = 0; c < L0; c++) if (nnz[c] > 0) nzCols.push(c);
  const pos = new Int32Array(L0).fill(-1);
  nzCols.forEach((c, i) => (pos[c] = i));
  const L1 = nzCols.length;
  const ZZ = new Float64Array(L1 * L1);
  for (const b of blocks)
    for (const r of b.rows)
      for (let p = 0; p < r.zi.length; p++) {
        const a = pos[r.zi[p]];
        const va = r.zv[p];
        for (let q2 = 0; q2 < r.zi.length; q2++) ZZ[a * L1 + pos[r.zi[q2]]] += va * r.zv[q2];
      }
  const keptZ = independentColumns(ZZ, L1, 1e-10).sort((a, b) => a - b);
  const L = keptZ.length;
  if (L > DPD_MAX_INSTR) {
    throw new GmmRefusal(
      `${intText(L)} instruments is more than the ${DPD_MAX_INSTR} this calculator allows (and far more than is wise). Choose “collapse”, or a last lag for the GMM-style instruments.`,
    );
  }
  const Nused = blocks.length;
  if (Nused * L * L > DPD_MAX_WORK) {
    throw new GmmRefusal(
      `${intText(Nused)} groups × ${intText(L)}² instruments is beyond the work this calculator allows in the task pane. Choose “collapse”, or a last lag for the GMM-style instruments.`,
    );
  }
  const finalPos = new Int32Array(L0).fill(-1);
  keptZ.forEach((i, j) => (finalPos[nzCols[i]] = j));
  for (const b of blocks)
    for (const r of b.rows) {
      const zi: number[] = [];
      const zv: number[] = [];
      for (let p = 0; p < r.zi.length; p++) {
        const c = finalPos[r.zi[p]];
        if (c >= 0) {
          zi.push(c);
          zv.push(r.zv[p]);
        }
      }
      r.zi = Int32Array.from(zi);
      r.zv = Float64Array.from(zv);
    }
  const nDiff = blocks.reduce((s, b) => s + b.nd, 0);
  const nLevel = blocks.reduce((s, b) => s + b.rows.length - b.nd, 0);
  const counts = blocks.map((b) => (spec.system ? b.rows.length - b.nd : b.nd)).filter((c) => c > 0);
  const perGroup = counts.length
    ? { min: Math.min(...counts), max: Math.max(...counts), avg: counts.reduce((s, c) => s + c, 0) / counts.length }
    : { min: 0, max: 0, avg: 0 };
  return { blocks, names, kinds, L, rawL: L0, droppedDummies, nDiff, nLevel, perGroup, emptyGroups, system: spec.system };
}

export interface ArTest {
  order: number;
  z: number;
  p: number;
  /** Why the statistic is not computed (no lagged pairs, or a non-positive variance). */
  why?: string;
}

export interface DynStep {
  b: Float64Array;
  se: Float64Array;
  /** Two-step only: the uncorrected (textbook) SEs. */
  seUncorrected?: Float64Array;
  ar: ArTest[];
}

export interface DynFit {
  N: number;
  k: number;
  L: number;
  df: number;
  nObs: number;
  one: DynStep;
  /** Null when the two-step estimator is not identified (twoWhy says why); Hansen J is then NaN. */
  two: DynStep | null;
  twoWhy?: string;
  hansen: number;
  hansenP: number;
  sargan: number;
  sarganP: number;
  /** A generalized inverse was needed for the one-step or two-step weight. */
  singularA1: boolean;
  singularS: boolean;
}

/** Fits the one-step and two-step estimators on a design (both are always computed: Hansen J needs the second). */
export function fitDynamic(des: DynDesign): DynFit {
  const { blocks, L } = des;
  const k = des.names.length;
  const N = blocks.length;
  if (L < k) {
    throw new GmmRefusal(`Under-identified: ${L} instruments for ${k} coefficients. Use more lags for the GMM-style instruments (a later last lag), or fewer regressors.`);
  }
  // ZᵀX, Zᵀy, ZᵀHZ.
  const ZX = new Float64Array(L * k);
  const Zy = new Float64Array(L);
  const ZHZ = new Float64Array(L * L);
  for (const b of blocks) {
    for (const r of b.rows)
      for (let p = 0; p < r.zi.length; p++) {
        const c = r.zi[p];
        const v = r.zv[p];
        Zy[c] += v * r.y;
        for (let j = 0; j < k; j++) ZX[c * k + j] += v * r.x[j];
      }
    for (const [ra, sa, h] of b.H) {
      const R1 = b.rows[ra];
      const R2 = b.rows[sa];
      for (let p = 0; p < R1.zi.length; p++) {
        const a = R1.zi[p];
        const va = R1.zv[p] * h;
        for (let q2 = 0; q2 < R2.zi.length; q2++) {
          const c = R2.zi[q2];
          const w = va * R2.zv[q2];
          ZHZ[a * L + c] += w;
          if (ra !== sa) ZHZ[c * L + a] += w;
        }
      }
    }
  }
  const XZ = tr(ZX, L, k);
  /** β, M = (XᵀZ A ZᵀX)⁻¹ and B = M XᵀZ A for a weight A. */
  const solve = (A: Float64Array): { b: Float64Array; M: Float64Array; B: Float64Array } => {
    const XZA = mul(XZ, A, k, L, L);
    const Mi = symInverse(mul(XZA, ZX, k, L, k), k);
    if (Mi.generalized) throw new GmmRefusal("XᵀZ A ZᵀX is singular: the regressors are not identified by these instruments (a regressor may have no instrument that predicts it).");
    const B = mul(Mi.inv, XZA, k, k, L);
    return { b: mv(B, Zy, k, L), M: Mi.inv, B };
  };
  const residuals = (b: Float64Array): Float64Array[] =>
    blocks.map((bl) => Float64Array.from(bl.rows, (r) => {
      let s = r.y;
      for (let j = 0; j < k; j++) s -= r.x[j] * b[j];
      return s;
    }));
  const zuOf = (res: Float64Array[]): Float64Array[] =>
    blocks.map((bl, i) => {
      const z = new Float64Array(L);
      bl.rows.forEach((r, ri) => {
        const e = res[i][ri];
        for (let p = 0; p < r.zi.length; p++) z[r.zi[p]] += r.zv[p] * e;
      });
      return z;
    });
  const outerSum = (zs: Float64Array[]): Float64Array => {
    const S = new Float64Array(L * L);
    for (const z of zs)
      for (let a = 0; a < L; a++) {
        const za = z[a];
        if (za === 0) continue;
        const o = a * L;
        for (let c = a; c < L; c++) S[o + c] += za * z[c];
      }
    for (let a = 0; a < L; a++) for (let c = a + 1; c < L; c++) S[c * L + a] = S[a * L + c];
    return S;
  };
  const sandwich = (B: Float64Array, S: Float64Array): Float64Array => {
    const V = mul(mul(B, S, k, L, L), tr(B, k, L), k, L, k);
    symmetrize(V, k);
    return V;
  };
  const A1i = symInverse(ZHZ, L);
  const A1 = A1i.inv;
  const s1 = solve(A1);
  const e1 = residuals(s1.b);
  const zu1 = zuOf(e1);
  const S1 = outerSum(zu1);
  const V1 = sandwich(s1.B, S1);
  const W2i = symInverse(S1, L);
  const W2 = W2i.inv;
  // The two-step estimator needs XᵀZ W₂ ZᵀX non-singular; W₂ has rank at most the number of groups, so with fewer
  // groups than coefficients it is not identified (the one-step estimate still is).
  const computeTwo = (): { s2: { b: Float64Array; M: Float64Array; B: Float64Array }; e2: Float64Array[]; zu2: Float64Array[]; g2: Float64Array; Vc: Float64Array; V2: Float64Array } => {
  const s2 = solve(W2);
  const e2 = residuals(s2.b);
  const zu2 = zuOf(e2);
  const g2 = new Float64Array(L);
  for (const z of zu2) for (let a = 0; a < L; a++) g2[a] += z[a];
  const V2 = s2.M;
  // Windmeijer: D_j = B₂ Σᵢ [aᵢⱼ (zu1ᵢ·c) + zu1ᵢ (aᵢⱼ·c)], c = W₂ g₂, aᵢⱼ = Zᵢᵀ X_{·j}.
  const c = mv(W2, g2, L, L);
  const D = new Float64Array(k * k);
  {
    const acc = new Float64Array(k * L);
    blocks.forEach((bl, i) => {
      const zc = dot(zu1[i], c);
      const a = new Float64Array(k * L);
      for (const r of bl.rows)
        for (let p = 0; p < r.zi.length; p++) {
          const col = r.zi[p];
          const v = r.zv[p];
          for (let j = 0; j < k; j++) a[j * L + col] += v * r.x[j];
        }
      for (let j = 0; j < k; j++) {
        let ac = 0;
        for (let q2 = 0; q2 < L; q2++) ac += a[j * L + q2] * c[q2];
        const o = j * L;
        const z = zu1[i];
        for (let q2 = 0; q2 < L; q2++) acc[o + q2] += a[o + q2] * zc + z[q2] * ac;
      }
    });
    for (let j = 0; j < k; j++) {
      const col = mv(s2.B, acc.subarray(j * L, (j + 1) * L), k, L);
      for (let r = 0; r < k; r++) D[r * k + j] = col[r];
    }
  }
  const DV2 = mul(D, V2, k, k, k);
  const Vc = new Float64Array(k * k);
  const DV1Dt = mul(mul(D, V1, k, k, k), tr(D, k, k), k, k, k);
  for (let r = 0; r < k; r++) for (let q2 = 0; q2 < k; q2++) Vc[r * k + q2] = V2[r * k + q2] + DV2[r * k + q2] + DV2[q2 * k + r] + DV1Dt[r * k + q2];
  symmetrize(Vc, k);
  return { s2, e2, zu2, g2, Vc, V2 };
  };
  let twoRes: ReturnType<typeof computeTwo> | null = null;
  let twoWhy: string | undefined;
  try {
    twoRes = computeTwo();
  } catch (e) {
    if (!(e instanceof GmmRefusal)) throw e;
    twoWhy =
      `the two-step weight matrix has rank ${W2i.rank} (at most the ${intText(N)} groups), fewer than the ${k} coefficients, so the two-step estimator is not identified; ` +
      "use one-step, collapse the instruments, drop the time dummies, or add groups";
  }
  const se = (V: Float64Array): Float64Array => Float64Array.from({ length: k }, (_, j) => Math.sqrt(Math.max(V[j * k + j], 0)));
  // Tests.
  const df = L - k;
  const hansen = twoRes ? quad(W2, twoRes.g2, L) : NaN;
  const g1 = new Float64Array(L);
  for (const z of zu1) for (let a = 0; a < L; a++) g1[a] += z[a];
  const nObs = des.system ? des.nLevel : des.nDiff;
  let ssd = 0;
  blocks.forEach((bl, i) => {
    for (let r = 0; r < bl.nd; r++) ssd += e1[i][r] * e1[i][r];
  });
  const sigma2 = ssd / (2 * nObs);
  const sargan = sigma2 > 0 ? quad(A1, g1, L) / sigma2 : NaN;
  const arTests = (res: Float64Array[], zu: Float64Array[], B: Float64Array, V: Float64Array): ArTest[] => {
    const out: ArTest[] = [];
    for (let m = 1; m <= 2; m++) {
      let d0 = 0;
      let d1 = 0;
      let pairs = 0;
      const EX = new Float64Array(k);
      const t3 = new Float64Array(L);
      blocks.forEach((bl, i) => {
        const e = res[i];
        const posOf = new Map<number, number>();
        bl.dPeriods.forEach((t, r) => posOf.set(t, r));
        let wu = 0;
        const wx = new Float64Array(k);
        bl.dPeriods.forEach((t, r) => {
          const pr = posOf.get(t - m);
          if (pr === undefined) return;
          const w = e[pr];
          pairs++;
          wu += w * e[r];
          const x = bl.rows[r].x;
          for (let j = 0; j < k; j++) wx[j] += w * x[j];
        });
        d0 += wu;
        d1 += wu * wu;
        for (let j = 0; j < k; j++) EX[j] += wx[j];
        if (wu !== 0) for (let a = 0; a < L; a++) t3[a] += zu[i][a] * wu;
      });
      if (!pairs) {
        out.push({ order: m, z: NaN, p: NaN, why: `no entity has differenced residuals ${m} period${m === 1 ? "" : "s"} apart` });
        continue;
      }
      const d2 = -2 * dot(EX, mv(B, t3, k, L));
      const d3 = quad(V, EX, k);
      const v = d1 + d2 + d3;
      if (!(v > 0) || !Number.isFinite(v)) {
        out.push({ order: m, z: NaN, p: NaN, why: "its estimated variance is not positive" });
        continue;
      }
      const z = d0 / Math.sqrt(v);
      out.push({ order: m, z, p: normalP2(z) });
    }
    return out;
  };
  const one: DynStep = { b: s1.b, se: se(V1), ar: arTests(e1, zu1, s1.B, V1) };
  const two: DynStep | null = twoRes
    ? { b: twoRes.s2.b, se: se(twoRes.Vc), seUncorrected: se(twoRes.V2), ar: arTests(twoRes.e2, twoRes.zu2, twoRes.s2.B, twoRes.Vc) }
    : null;
  for (const st of two ? [one, two] : [one]) for (let j = 0; j < k; j++) if (!Number.isFinite(st.b[j]) || !Number.isFinite(st.se[j])) throw new GmmRefusal("The estimates are not finite numbers for these data (check for extreme values).");
  return {
    N,
    k,
    L,
    df,
    nObs,
    one,
    two,
    twoWhy,
    hansen,
    hansenP: df > 0 && Number.isFinite(hansen) ? chiSquareP(Math.max(hansen, 0), df) : NaN,
    sargan,
    sarganP: df > 0 && Number.isFinite(sargan) ? chiSquareP(Math.max(sargan, 0), df) : NaN,
    singularA1: A1i.generalized,
    singularS: W2i.generalized,
  };
}

/** Pooled OLS (with a constant) or within (fixed-effects) estimates on the level rows, cluster-robust by entity. */
export function olsFeOnLevels(
  data: DynData,
  spec: DynSpec,
  within: boolean,
): { b: number; se: number; n: number } | null {
  const { N, T } = data;
  const val = (v: string, g: number, t: number): number => (t < 0 || t >= T ? NaN : data.series.get(v)![g][t]);
  const kt = spec.terms.length;
  const rowsX: number[][] = [];
  const rowsY: number[] = [];
  const grp: number[] = [];
  const tim: number[] = [];
  for (let g = 0; g < N; g++)
    for (let t = 0; t < T; t++) {
      const yv = val(spec.y, g, t);
      if (Number.isNaN(yv)) continue;
      const x = spec.terms.map((tm) => val(tm.v, g, t - tm.lag));
      if (x.some(Number.isNaN)) continue;
      rowsX.push(x);
      rowsY.push(yv);
      grp.push(g);
      tim.push(t);
    }
  const n = rowsY.length;
  if (n < kt + 3) return null;
  // Design: terms, dummies (if asked), constant (OLS).
  const cols: Float64Array[] = [];
  for (let j = 0; j < kt; j++) cols.push(Float64Array.from(rowsX, (r) => r[j]));
  if (spec.timeDummies) for (let s = 0; s < T; s++) cols.push(Float64Array.from(tim, (t) => (t === s ? 1 : 0)));
  if (!within) cols.push(new Float64Array(n).fill(1));
  let y: Float64Array = Float64Array.from(rowsY);
  if (within) {
    const demean = (v: Float64Array): Float64Array => {
      const s = new Float64Array(N);
      const c = new Float64Array(N);
      for (let i = 0; i < n; i++) {
        s[grp[i]] += v[i];
        c[grp[i]]++;
      }
      return Float64Array.from(v, (x, i) => x - s[grp[i]] / c[grp[i]]);
    };
    for (let j = 0; j < cols.length; j++) cols[j] = demean(cols[j]);
    y = demean(y);
  }
  const p0 = cols.length;
  const G0 = new Float64Array(p0 * p0);
  for (let a = 0; a < p0; a++) for (let b = 0; b < p0; b++) G0[a * p0 + b] = dot(cols[a], cols[b]);
  const order = [...(within ? [] : [p0 - 1]), ...Array.from({ length: p0 - (within ? 0 : 1) }, (_, j) => j)];
  const kept = independentColumns(G0, p0, 1e-10, order).sort((a, b) => a - b);
  if (!kept.includes(0)) return null;
  const p = kept.length;
  const XtX = new Float64Array(p * p);
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) XtX[a * p + b] = G0[kept[a] * p0 + kept[b]];
  const inv = symInverse(XtX, p);
  if (inv.generalized) return null;
  const Xty = Float64Array.from(kept, (c) => dot(cols[c], y));
  const b = mv(inv.inv, Xty, p, p);
  const e = Float64Array.from(y, (yv, i) => {
    let s = yv;
    for (let a = 0; a < p; a++) s -= cols[kept[a]][i] * b[a];
    return s;
  });
  const sums = new Float64Array(N * p);
  const used = new Uint8Array(N);
  for (let i = 0; i < n; i++) {
    used[grp[i]] = 1;
    for (let a = 0; a < p; a++) sums[grp[i] * p + a] += cols[kept[a]][i] * e[i];
  }
  const S = new Float64Array(p * p);
  for (let g = 0; g < N; g++) for (let a = 0; a < p; a++) for (let c2 = 0; c2 < p; c2++) S[a * p + c2] += sums[g * p + a] * sums[g * p + c2];
  const G = used.reduce((s, u) => s + u, 0);
  // Stata's cluster factor G/(G − 1)·(n − 1)/(n − p), p the kept columns (the OLS constant included; FE's absorbed).
  const fac = G > 1 && n > p ? (G / (G - 1)) * ((n - 1) / (n - p)) : 1;
  const V = mul(mul(inv.inv, S, p, p, p), inv.inv, p, p, p);
  const se = Math.sqrt(Math.max(V[0] * fac, 0));
  if (!Number.isFinite(b[0]) || !Number.isFinite(se)) return null;
  return { b: b[0], se, n };
}

/** The 97.5% normal point, for the intervals. */
export const GMM_Z975 = Z975;
