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
 * symmetric matrices are equilibrated to a unit diagonal (D^−½ A D^−½) and inverted by Cholesky or, when singular
 * (e.g. more instruments than groups), by the Moore–Penrose inverse of the equilibrated matrix with eigenvalues below
 * L·ε·λ_max discarded. Every rank decision is taken on unit-diagonal matrices, so no answer depends on the units of a
 * column. When a matrix is singular, this generalized inverse differs from the raw Moore–Penrose inverse that
 * xtabond2 and pydynpd take (that one changes with the units); nonsingular matrices get the same exact inverse.
 *
 * Every loop is bounded by the caps below; work beyond them is refused by name before it starts.
 */
import { chiSquareP, normalCdf } from "./stats2";
import { intText } from "./regTable";

export class GmmRefusal extends Error {}
/** XᵀZ A ZᵀX is singular for the weight A (the two-step path names its cause from this). */
class SingularSolve extends GmmRefusal {}

/** At most this many groups (entities) in a dynamic panel. */
export const DPD_MAX_GROUPS = 2000;
/** At most this many periods from the first to the last (gaps included). */
export const DPD_MAX_PERIODS = 40;
/** At most this many instrument columns (counted from the plan, before any row is built; see planDynamic). */
export const DPD_MAX_INSTR = 400;
/** At most this many regressors (lags, exogenous terms and kept time dummies). */
export const DPD_MAX_REGRESSORS = 50;
/**
 * Fixed cost of one stacked row (allocation, residuals, scores, AR sums) in multiply-add units: a least-squares fit of
 * 72 timed designs (N 40 to 2,000, T 10 to 40, every option) gave 0.8 ms per 10⁶ units and 2.6 µs per row under Node.
 */
export const DPD_ROW_COST = 3300;
/** Work bound on one fit as planDynamic estimates it: 1.5×10⁸ units, about 0.12 s under Node once warm. */
export const DPD_MAX_WORK = 1.5e8;
/** Cost of reading one cell of the pasted table and of the pooled OLS and fixed-effects fits, per cell (0.7 µs). */
export const DPD_READ_COST = 900;
/**
 * Bound on the whole calculation: reading, the reported fit and the other estimator that the ρ comparison fits
 * (2.4×10⁸, about 0.19 s once warm). Beyond it the comparison row says it was not computed, rather than the whole
 * calculation being refused.
 */
export const DPD_MAX_PAIR_WORK = 2.4e8;
/** At most this many data rows (entity-periods) in a dynamic panel (counted before parsing). */
export const DPD_MAX_ROWS = 20_000;
/** At most this many cells (rows × columns of the pasted table) in a dynamic panel: reading costs about 0.2 µs a cell. */
export const DPD_MAX_CELLS = 200_000;
/** Linear GMM: at most this many rows (counted before parsing). */
export const LGMM_MAX_ROWS = 50_000;
/** Linear GMM: at most this many cells (rows × columns of the pasted table), about 0.1 s to read under Node. */
export const LGMM_MAX_CELLS = 500_000;
/** Linear GMM work bound, lgmmWork's estimate. */
export const LGMM_MAX_WORK = 4e7;
/** Linear GMM: at most this many distinct columns (endogenous, exogenous, excluded instruments, constant). */
export const LGMM_MAX_COLUMNS = 60;

const EPS = Number.EPSILON;
const Z975 = 1.959963984540054;

/**
 * Fewest groups (clusters) admitted. Every standard error and test here is cluster-robust, a large-sample approximation
 * in the number of groups; with very few groups it over-rejects badly (Cameron and Miller 2015, "A practitioner's guide
 * to cluster-robust inference", J. Human Resources 50(2)), and the two-step weight and the Hansen test, whose rank is
 * bounded by the groups, are not usable at all.
 */
export const GMM_MIN_GROUPS = 10;

/**
 * Why G groups (clusters) cannot support k coefficients, or null: fewer than GMM_MIN_GROUPS, or G ≤ k (the scores of
 * the groups sum to zero at the estimate, so the cluster-robust covariance has rank at most G − 1 < k and some
 * combination of the coefficients would get a zero standard error).
 */
export function fewGroupsReason(G: number, k: number, word: string): string | null {
  if (G < GMM_MIN_GROUPS) {
    return `${intText(G)} ${plural(G, word)}; this calculator needs at least ${GMM_MIN_GROUPS}. Its standard errors and tests are cluster-robust, which is an approximation in the number of ${word}s and over-rejects badly with very few (Cameron and Miller 2015).`;
  }
  if (G <= k) {
    return `${intText(G)} ${plural(G, word)} for ${k} coefficients: the ${word} scores sum to zero at the estimate, so the cluster-robust covariance has rank at most ${intText(G - 1)} and some combination of the coefficients would get a zero standard error. The ${word}s must outnumber the coefficients (drop the time dummies, or regressors).`;
  }
  return null;
}

/** "1 group", "2 groups" (the count itself is printed by the caller). */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return n === 1 ? word : pluralWord;
}
/** The nonzero entries of x as (indices, values). */
function sparse(x: Float64Array): { xi: Int32Array; xv: Float64Array } {
  let m = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== 0) m++;
  const xi = new Int32Array(m);
  const xv = new Float64Array(m);
  m = 0;
  for (let i = 0; i < x.length; i++)
    if (x[i] !== 0) {
      xi[m] = i;
      xv[m++] = x[i];
    }
  return { xi, xv };
}

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
 * Inverse of a symmetric positive semi-definite matrix, equilibrated first: with D = diag(A)^½, B = D⁻¹AD⁻¹ has a unit
 * diagonal and A⁻¹ = D⁻¹B⁻¹D⁻¹. B is inverted by Cholesky when it is clearly non-singular (every pivot above 10⁻¹¹),
 * else by its Moore–Penrose inverse (eigenvalues ≤ n·ε·λ_max(B) discarded). Every decision is taken on B, so the
 * result is invariant to rescaling any variable (A → EAE gives E⁻¹A⁻¹E⁻¹ exactly, the generalized inverse included).
 * A zero diagonal entry gives a zero row and column. `generalized` says which path was used.
 */
export function symInverse(A0: Float64Array, n: number): { inv: Float64Array; generalized: boolean; rank: number } {
  const A = Float64Array.from(A0);
  symmetrize(A, n);
  const sc = new Float64Array(n);
  let zeroDiag = false;
  for (let i = 0; i < n; i++) {
    const d = A[i * n + i];
    if (d > 0 && Number.isFinite(d)) sc[i] = 1 / Math.sqrt(d);
    else zeroDiag = true;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] *= sc[i] * sc[j];
  const unscale = (M: Float64Array): Float64Array => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i * n + j] *= sc[i] * sc[j];
    return M;
  };
  const L = new Float64Array(n * n);
  let ok = n > 0 && !zeroDiag;
  for (let j = 0; j < n && ok; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= L[j * n + k] * L[j * n + k];
    if (!(s > 1e-11) || !(s > n * EPS)) {
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
    return { inv: unscale(inv), generalized: false, rank: n };
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
  return { inv: unscale(inv), generalized: true, rank };
}

/**
 * symInverse of S = Σ_g u_g u_gᵀ (n×n) when there are fewer vectors than n (S is then singular, rank ≤ m): the same
 * equilibrated Moore–Penrose inverse, through the m×m Gram matrix of the scaled vectors (its nonzero eigenvalues are
 * those of the scaled S, so the cutoff n·ε·λ_max is the same), in O(m²n + n²·rank) instead of an n×n eigensolve.
 */
export function pinvOuter(us: Float64Array[], n: number): { inv: Float64Array; generalized: boolean; rank: number } {
  const m = us.length;
  const sc = new Float64Array(n);
  for (const u of us) for (let a = 0; a < n; a++) sc[a] += u[a] * u[a];
  for (let a = 0; a < n; a++) sc[a] = sc[a] > 0 && Number.isFinite(sc[a]) ? 1 / Math.sqrt(sc[a]) : 0;
  const V = us.map((u) => Float64Array.from(u, (v, a) => v * sc[a]));
  const Gm = new Float64Array(m * m);
  for (let g = 0; g < m; g++)
    for (let h = g; h < m; h++) {
      const s = dot(V[g], V[h]);
      Gm[g * m + h] = s;
      Gm[h * m + g] = s;
    }
  const { d, V: Q } = symEigen(Gm, m);
  let lmax = 0;
  for (let i = 0; i < m; i++) lmax = Math.max(lmax, Math.abs(d[i]));
  const tol = n * EPS * lmax;
  const inv = new Float64Array(n * n);
  let rank = 0;
  const w = new Float64Array(n);
  for (let kq = 0; kq < m; kq++) {
    if (!(d[kq] > tol) || lmax === 0) continue;
    rank++;
    // Eigenvector of the scaled S: Ṽq/√λ; its contribution to the inverse is (Ṽq)(Ṽq)ᵀ/λ².
    w.fill(0);
    for (let g = 0; g < m; g++) {
      const qg = Q[g * m + kq];
      if (qg === 0) continue;
      const vg = V[g];
      for (let a = 0; a < n; a++) w[a] += qg * vg[a];
    }
    const f = 1 / (d[kq] * d[kq]);
    for (let a = 0; a < n; a++) {
      const wa = w[a] * f;
      if (wa === 0) continue;
      const o = a * n;
      for (let b = a; b < n; b++) inv[o + b] += wa * w[b];
    }
  }
  for (let a = 0; a < n; a++)
    for (let b = a; b < n; b++) {
      const v = inv[a * n + b] * sc[a] * sc[b];
      inv[a * n + b] = v;
      inv[b * n + a] = v;
    }
  return { inv, generalized: true, rank };
}

/**
 * Greedy column selection on a Gram matrix G (n×n): column j is kept when its squared distance from the span of the
 * kept columns exceeds tol × its own squared norm (pivoted Cholesky in the given order, on G normalized to a unit
 * diagonal so the decision does not depend on the columns' units). Returns the kept indices.
 */
export function independentColumns(G0: Float64Array, n: number, tol = 1e-10, order?: number[]): number[] {
  const G = Float64Array.from(G0);
  {
    const sc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = G[i * n + i];
      sc[i] = d > 0 && Number.isFinite(d) ? 1 / Math.sqrt(d) : 0;
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G[i * n + j] *= sc[i] * sc[j];
  }
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
  /** The first nEndog columns of X are endogenous and the first nExcluded columns of Z are the excluded instruments
   * (for the first-stage diagnostics). */
  nEndog?: number;
  nExcluded?: number;
}

/** First-stage strength of the excluded instruments for one endogenous regressor. */
export interface FirstStage {
  name: string;
  partialR2: number;
  /** Wald statistic of the excluded instruments' coefficients, robust or clustered as the fit, χ²(df). */
  wald: number;
  df: number;
  p: number;
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
  /** Hansen J of the two-step estimate (computed whichever step is reported); NaN when not defined (jWhy says why). */
  j: number;
  jdf: number;
  jp: number;
  jWhy?: string;
  /** True when the two-step moment covariance had to be inverted by a generalized inverse. */
  singularS: boolean;
  firstStage: FirstStage[];
}

export function fitLinearGmm(inp: LinearGmmInput): LinearGmmResult {
  const n = inp.y.length;
  const k = inp.X.length;
  const L = inp.Z.length;
  const k1 = inp.nEndog ?? 0;
  const q = inp.nExcluded ?? 0;
  if (n > LGMM_MAX_ROWS) throw new GmmRefusal(`The data have ${intText(n)} rows; GMM here is limited to ${intText(LGMM_MAX_ROWS)} rows.`);
  const work = lgmmWork(n, k, L, k1);
  if (work > LGMM_MAX_WORK) throw new GmmRefusal(`${intText(n)} rows with ${k} ${plural(k, "regressor")} and ${L} ${plural(L, "instrument")} is beyond the work this calculator allows in the task pane (about ${intText(Math.floor((n * LGMM_MAX_WORK) / work))} rows for this model).`);
  if (L < k) throw new GmmRefusal(`Under-identified: ${L} ${plural(L, "instrument")} for ${k} ${plural(k, "coefficient")}. Each endogenous regressor needs at least one excluded instrument.`);
  if (n <= L) throw new GmmRefusal(`${intText(n)} rows is too few for ${L} ${plural(L, "instrument")} (GMM needs more rows than instruments).`);
  const y = Float64Array.from(inp.y);
  const X = new Float64Array(n * k);
  const Z = new Float64Array(n * L);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) X[i * k + j] = inp.X[j][i];
    for (let j = 0; j < L; j++) Z[i * L + j] = inp.Z[j][i];
  }
  // ZᵀZ (upper triangle, mirrored), ZᵀX and Zᵀy in one pass over the rows.
  const ZZ = new Float64Array(L * L);
  const ZX = new Float64Array(L * k);
  const Zy = new Float64Array(L);
  for (let i = 0; i < n; i++) {
    const zo = i * L;
    const xo = i * k;
    for (let a = 0; a < L; a++) {
      const za = Z[zo + a];
      if (za === 0) continue;
      const o = a * L;
      for (let b = a; b < L; b++) ZZ[o + b] += za * Z[zo + b];
      for (let j = 0; j < k; j++) ZX[a * k + j] += za * X[xo + j];
      Zy[a] += za * y[i];
    }
  }
  for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) ZZ[b * L + a] = ZZ[a * L + b];
  {
    const kept = independentColumns(ZZ, L, 1e-11);
    if (kept.length < L) throw new GmmRefusal("The instruments are perfectly collinear (ZᵀZ is singular): one instrument is a combination of the others, or a column is constant alongside the constant.");
  }
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
  // (1/n) Σ zᵢzᵢᵀûᵢ² or the clustered form, for a residual vector (or any column, as the first stage uses it).
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
  const cov = (Wn: Float64Array, S: Float64Array): Float64Array => {
    const Gm = new Float64Array(L * k);
    for (let i = 0; i < L * k; i++) Gm[i] = ZX[i] / n;
    const GtW = mul(tr(Gm, L, k), Wn, k, L, L);
    const Ainv = symInverse(mul(GtW, Gm, k, L, k), k).inv;
    const mid = mul(mul(GtW, S, k, L, L), tr(GtW, k, L), k, L, k);
    const C = mul(mul(Ainv, mid, k, k, k), Ainv, k, k, k);
    for (let i = 0; i < k * k; i++) C[i] /= n;
    symmetrize(C, k);
    return C;
  };
  const W0n = new Float64Array(L * L);
  for (let i = 0; i < L * L; i++) W0n[i] = W0[i] * n;
  const b1 = est(W0);
  const e1 = resid(b1);
  // An exact fit leaves no error variance: every standard error, z and J would be rounding noise.
  {
    let ym = 0;
    for (let i = 0; i < n; i++) ym += y[i] / n;
    let tss = 0;
    let ssr = 0;
    for (let i = 0; i < n; i++) {
      tss += (y[i] - ym) * (y[i] - ym);
      ssr += e1[i] * e1[i];
    }
    if (!(ssr > 1e-20 * tss)) {
      throw new GmmRefusal("The model fits the response exactly (the 2SLS residuals are zero up to rounding), so there is no error variance: standard errors, z statistics and the J test would be meaningless. Check that the response is not a combination of the regressors.");
    }
  }
  const S1 = Smat(e1);
  const C1 = cov(W0n, S1);
  const seOf = (C: Float64Array): Float64Array => Float64Array.from({ length: k }, (_, j) => Math.sqrt(Math.max(C[j * k + j], 0)));
  const tsls = { b: b1, se: seOf(C1) };
  const jdf = L - k;
  let gmm: CoefSet = tsls;
  let j = NaN;
  let jWhy: string | undefined;
  let singularS = false;
  if (jdf === 0) {
    // Exactly identified: GMM is 2SLS whatever the weight, with the same sandwich; S⁻¹ is never needed.
    jWhy = "exactly identified";
  } else if (inp.clusters && (inp.G ?? 0) <= L) {
    // The clustered S has rank at most G: the efficient weight S⁻¹ is not defined.
    if (inp.steps === 2) {
      throw new GmmRefusal(`${intText(inp.G ?? 0)} clusters for ${L} instruments: the clustered moment covariance has rank at most ${intText(inp.G ?? 0)}, so the efficient (two-step) weight matrix is not defined. Use one-step, more clusters, fewer instruments, or the robust weight.`);
    }
    jWhy = `the clustered moment covariance has rank at most the ${intText(inp.G ?? 0)} clusters, fewer than the ${L} instruments, so the J test (which needs its inverse) is not defined`;
  } else {
    const Wi = symInverse(S1, L);
    singularS = Wi.generalized;
    const W = Wi.inv;
    const b2 = est(W);
    const e2 = resid(b2);
    const gbar = new Float64Array(L);
    for (let i = 0; i < n; i++) for (let a = 0; a < L; a++) gbar[a] += (Z[i * L + a] * e2[i]) / n;
    j = n * quad(W, gbar, L);
    if (inp.steps === 2) gmm = { b: b2, se: seOf(cov(W, Smat(e2))) };
  }
  for (const set of [tsls, gmm]) for (let c = 0; c < k; c++) if (!Number.isFinite(set.b[c]) || !Number.isFinite(set.se[c])) throw new GmmRefusal("The estimates are not finite numbers for these data (check for extreme values).");
  // First stage of each endogenous regressor on every instrument (linearmodels' first_stage.diagnostics): partial R² of
  // the q excluded instruments (FWL: 1 − SSR(all instruments)/SSR(exogenous only)) and the Wald statistic of their
  // coefficients with the fit's robust or clustered covariance (HC0 / no small-sample factor), χ²(q).
  const firstStage: FirstStage[] = [];
  if (k1 > 0 && q > 0) {
    const nx = L - q;
    let Wx: Float64Array | null = null;
    if (nx > 0) {
      const Gx = new Float64Array(nx * nx);
      for (let a = 0; a < nx; a++) for (let b = 0; b < nx; b++) Gx[a * nx + b] = ZZ[(q + a) * L + q + b];
      Wx = symInverse(Gx, nx).inv;
    }
    for (let c = 0; c < k1; c++) {
      const d = Float64Array.from({ length: n }, (_, i) => X[i * k + c]);
      const Zd = Float64Array.from({ length: L }, (_, a) => ZX[a * k + c]);
      const pi = mv(W0, Zd, L, L);
      const u = new Float64Array(n);
      let ssrFull = 0;
      for (let i = 0; i < n; i++) {
        let s = d[i];
        for (let a = 0; a < L; a++) s -= Z[i * L + a] * pi[a];
        u[i] = s;
        ssrFull += s * s;
      }
      let ssrX = 0;
      if (Wx) {
        const Zxd = Zd.subarray(q);
        const px = mv(Wx, Zxd, nx, nx);
        for (let i = 0; i < n; i++) {
          let s = d[i];
          for (let a = 0; a < nx; a++) s -= Z[i * L + q + a] * px[a];
          ssrX += s * s;
        }
      } else for (let i = 0; i < n; i++) ssrX += d[i] * d[i];
      // V = (ZᵀZ)⁻¹ (n·S(u)) (ZᵀZ)⁻¹.
      const Su = Smat(u);
      const V = mul(mul(W0, Su, L, L, L), W0, L, L, L);
      const Vq = new Float64Array(q * q);
      for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) Vq[a * q + b] = V[a * L + b] * n;
      const Vi = symInverse(Vq, q);
      const wald = quad(Vi.inv, pi.subarray(0, q), q);
      const partialR2 = ssrX > 0 ? 1 - ssrFull / ssrX : NaN;
      firstStage.push({ name: inp.names[c], partialR2, wald, df: q, p: Number.isFinite(wald) && !Vi.generalized ? chiSquareP(Math.max(wald, 0), q) : NaN });
    }
  }
  return { n, k, L, tsls, gmm, j, jdf, jp: Number.isFinite(j) && jdf > 0 ? chiSquareP(Math.max(j, 0), jdf) : NaN, jWhy, singularS, firstStage };
}

/** Work of one linear GMM fit (multiply-adds): ZᵀZ and the moment covariances (n·L² each), one per first stage. */
export function lgmmWork(n: number, k: number, L: number, k1: number): number {
  return n * (L * L * (1.5 + 0.5 * k1) + L * (2 * k + 4));
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
  /** The regressors, sparse: column indices and values (a row fills its terms, at most two time dummies, the constant). */
  xi: Int32Array;
  xv: Float64Array;
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

/**
 * Everything about a design that is known before a row is built: the rows of each group, the instrument columns, the
 * instrument count (columns some row can fill, before dependent ones are dropped: an upper bound on the final count,
 * usually above it by the one or two collinear time dummies) and an estimate of the arithmetic of one fit. The caps
 * are checked on this plan, so a refusal never builds anything.
 */
export interface DynPlan {
  dRows: number[][];
  lRows: number[][];
  dPer: number[];
  lPer: number[];
  /** Raw column numbering (zero columns included) and its lookup tables (see buildDynamic). */
  L0: number;
  A: number;
  bMax: number;
  dCol: Int32Array;
  lCol: Int32Array;
  ivCol: Int32Array;
  tdCol: Int32Array;
  consCol: number;
  /** Instrument columns some row fills. */
  instr: number;
  /** Groups with at least one row. */
  groups: number;
  rows: number;
  /** Estimated work of one fit (multiply-adds): the row passes, N·L² for the moment covariance, L³ for the inverses. */
  work: number;
}

export function planDynamic(data: DynData, spec: DynSpec): DynPlan {
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
  // A response that never changes within an entity is a pure entity effect: every first difference is zero, so there
  // are no dynamics to estimate (difference GMM has nothing to fit; system GMM would fit ρ = 1 to the levels exactly).
  {
    const ys = data.series.get(spec.y)!;
    let moves = false;
    for (let g = 0; g < N && !moves; g++) for (const t of dRows[g]) if (ys[g][t] !== ys[g][t - 1]) {
      moves = true;
      break;
    }
    if (!moves) throw new GmmRefusal(`The response “${spec.y}” never changes within an entity in the estimation rows (every first difference is zero): it is a pure entity effect, so there are no dynamics to estimate.`);
  }
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
  // The count of columns some row fills: GMM-style and IV-style columns as numbered (each has a row by construction),
  // time dummies of periods that occur (level rows in system GMM; t and t − 1 of the differenced rows otherwise).
  let tdUsed = 0;
  if (spec.timeDummies) {
    const used = new Set<number>(spec.system ? lPer : [...dPer, ...dPer.map((t) => t - 1)]);
    tdUsed = used.size;
  }
  const instr = L0 - (spec.timeDummies ? T : 0) + tdUsed;
  // Work of one fit: per row the instrument products (ZᵀZ, ZᵀHZ: about 5·nnz² over the H entries) and the regressor
  // products (nnz times the regressors a row fills), a fixed cost per row, the Windmeijer pass (3·N·k·L), N·L² (moment
  // covariance, plus N²·L + 5·N³ for the low-rank inverse and its N×N eigensolve when L > N) and 4·L³ (the column reduction and two inverses; the
  // weight 4 is measured: an L³ step costs about four multiply-add units of the row passes).
  const nExog = ivCol.reduce((s, c) => s + (c >= 0 ? 1 : 0), 0);
  const nzx = kt + 3;
  let rowWork = 0;
  let rows = 0;
  let groups = 0;
  for (let g = 0; g < N; g++) {
    if (dRows[g].length || lRows[g].length) groups++;
    for (const t of dRows[g]) {
      let nnz = nExog + (spec.timeDummies && !spec.system ? 2 : 0);
      for (let gi = 0; gi < nG; gi++) nnz += Math.max(0, Math.min(bMax, t) - a1 + 1);
      rowWork += 5 * nnz * nnz + 4 * nnz * nzx + nzx * nzx;
      rows++;
    }
    for (let s = 0; s < lRows[g].length; s++) {
      const nnz = nG + nExog + (spec.timeDummies ? 1 : 0) + 1;
      rowWork += 5 * nnz * nnz + 4 * nnz * nzx + nzx * nzx;
      rows++;
    }
  }
  const kEst = kt + tdUsed + (spec.system ? 1 : 0);
  const work = rowWork + DPD_ROW_COST * rows + 3 * groups * kEst * instr + groups * instr * instr + (instr > groups ? groups * groups * instr + 5 * groups * groups * groups : 0) + 4 * instr * instr * instr;
  return { dRows, lRows, dPer, lPer, L0, A, bMax, dCol, lCol, ivCol, tdCol, consCol, instr, groups, rows, work };
}

/** Refuses a plan over the caps, by name (DPD_MAX_INSTR on the instrument count, DPD_MAX_WORK on one fit). */
export function checkPlan(p: DynPlan): void {
  if (p.instr > DPD_MAX_INSTR) {
    throw new GmmRefusal(
      `The instrument set would have about ${intText(p.instr)} columns; this calculator allows ${intText(DPD_MAX_INSTR)} (far more than is wise anyway). Choose “collapse”, or a last lag for the GMM-style instruments.`,
    );
  }
  if (p.work > DPD_MAX_WORK) {
    throw new GmmRefusal(
      `${intText(p.groups)} ${plural(p.groups, "group")} and ${intText(p.rows)} stacked rows with about ${intText(p.instr)} instruments is beyond the work this calculator allows in the task pane. Choose “collapse”, a last lag for the GMM-style instruments, or fewer time dummies.`,
    );
  }
}

/** Builds the stacked design (see the file comment for every convention), from its plan. */
export function buildDynamic(data: DynData, spec: DynSpec, plan?: DynPlan): DynDesign {
  const p = plan ?? planDynamic(data, spec);
  if (!plan) checkPlan(p);
  const { N, T } = data;
  const terms = spec.terms;
  const kt = terms.length;
  const { dRows, lRows, L0, A, bMax, dCol, lCol, ivCol, tdCol, consCol } = p;
  const a1 = spec.lagFirst;
  const nG = spec.gmmVars.length;
  const ser = (v: string): Float64Array[] => data.series.get(v)!;
  const ySer = ser(spec.y);
  const tSer = terms.map((tm) => ser(tm.v));
  const gSer = spec.gmmVars.map(ser);
  const at = (s: Float64Array[], g: number, t: number): number => (t < 0 || t >= T ? NaN : s[g][t]);
  // Regressor columns: terms, then a dummy per period, then the constant (system).
  const kFull = kt + (spec.timeDummies ? T : 0) + (spec.system ? 1 : 0);
  const blocks: Block[] = [];
  const xScratch = new Float64Array(kFull);
  // A row fills at most every GMM-style lag of every GMM variable, one IV-style column per term, two dummies, the constant.
  const zScrI = new Int32Array(nG * (A + 1) + kt + 3);
  const zScrV = new Float64Array(zScrI.length);
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
      let m = 0;
      const put = (c: number, v: number): void => {
        if (c < 0 || v === 0 || Number.isNaN(v)) return;
        zScrI[m] = c;
        zScrV[m++] = v;
      };
      const x = xScratch.fill(0);
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
      // (Insertion sort: a row holds a few dozen entries at most, nearly in order already.)
      const zI = new Int32Array(m);
      const zV = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        let j = i;
        while (j > 0 && zI[j - 1] > zScrI[i]) {
          zI[j] = zI[j - 1];
          zV[j] = zV[j - 1];
          j--;
        }
        zI[j] = zScrI[i];
        zV[j] = zScrV[i];
      }
      return { zi: zI, zv: zV, ...sparse(x), y, t };
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
      for (let p = 0; p < r.xi.length; p++) {
        const o = r.xi[p] * kFull;
        const xa = r.xv[p];
        for (let q2 = 0; q2 < r.xi.length; q2++) XtX[o + r.xi[q2]] += xa * r.xv[q2];
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
  const colMap = new Int32Array(kFull).fill(-1);
  kept.forEach((c, a) => (colMap[c] = a));
  for (const b of blocks)
    for (const r of b.rows) {
      let m = 0;
      for (const c of r.xi) if (colMap[c] >= 0) m++;
      if (m === r.xi.length) {
        for (let p = 0; p < m; p++) r.xi[p] = colMap[r.xi[p]];
        continue;
      }
      const xi = new Int32Array(m);
      const xv = new Float64Array(m);
      m = 0;
      for (let p = 0; p < r.xi.length; p++)
        if (colMap[r.xi[p]] >= 0) {
          xi[m] = colMap[r.xi[p]];
          xv[m++] = r.xv[p];
        }
      r.xi = xi;
      r.xv = xv;
    }
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
  const finalPos = new Int32Array(L0).fill(-1);
  keptZ.forEach((i, j) => (finalPos[nzCols[i]] = j));
  for (const b of blocks)
    for (const r of b.rows) {
      let m = 0;
      for (const c of r.zi) if (finalPos[c] >= 0) m++;
      if (m === r.zi.length) {
        for (let p = 0; p < m; p++) r.zi[p] = finalPos[r.zi[p]];
        continue;
      }
      const zi = new Int32Array(m);
      const zv = new Float64Array(m);
      m = 0;
      for (let p = 0; p < r.zi.length; p++) {
        const c = finalPos[r.zi[p]];
        if (c >= 0) {
          zi[m] = c;
          zv[m++] = r.zv[p];
        }
      }
      r.zi = zi;
      r.zv = zv;
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
  /** Ranks of the one-step weight's matrix Σ ZᵢᵀHᵢZᵢ and of the two-step moment covariance (L when nonsingular). */
  rankA1: number;
  rankS: number;
}

/** Fits the one-step and two-step estimators on a design (both are always computed: Hansen J needs the second). */
export function fitDynamic(des: DynDesign): DynFit {
  const { blocks, L } = des;
  const k = des.names.length;
  const N = blocks.length;
  {
    const few = fewGroupsReason(N, k, "group");
    if (few) throw new GmmRefusal(`The panel has ${few}`);
  }
  if (L < k) {
    throw new GmmRefusal(`Under-identified: ${L} ${plural(L, "instrument")} for ${k} ${plural(k, "coefficient")}. Use more lags for the GMM-style instruments (a later last lag), or fewer regressors.`);
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
        for (let q2 = 0; q2 < r.xi.length; q2++) ZX[c * k + r.xi[q2]] += v * r.xv[q2];
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
    if (Mi.generalized) throw new SingularSolve("XᵀZ A ZᵀX is singular: the regressors are not identified by these instruments (a regressor may have no instrument that predicts it).");
    const B = mul(Mi.inv, XZA, k, k, L);
    return { b: mv(B, Zy, k, L), M: Mi.inv, B };
  };
  const residuals = (b: Float64Array): Float64Array[] =>
    blocks.map((bl) => Float64Array.from(bl.rows, (r) => {
      let s = r.y;
      for (let q2 = 0; q2 < r.xi.length; q2++) s -= r.xv[q2] * b[r.xi[q2]];
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
  // An exact fit in differences leaves no error variance: every standard error, z and test would be rounding noise.
  {
    let ssr = 0;
    let tss = 0;
    blocks.forEach((bl, i) => {
      for (let r = 0; r < bl.nd; r++) {
        ssr += e1[i][r] * e1[i][r];
        tss += bl.rows[r].y * bl.rows[r].y;
      }
    });
    if (!(ssr > 1e-20 * tss)) {
      throw new GmmRefusal("The model fits the differenced response exactly (the one-step residuals are zero up to rounding), so there is no error variance: standard errors, z statistics and the Sargan, Hansen and AR tests would be meaningless. Check that the response is not an exact function of its lags and the regressors.");
    }
  }
  const zu1 = zuOf(e1);
  const S1 = outerSum(zu1);
  const V1 = sandwich(s1.B, S1);
  const W2i = N < L ? pinvOuter(zu1, L) : symInverse(S1, L);
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
          for (let q3 = 0; q3 < r.xi.length; q3++) a[r.xi[q3] * L + col] += v * r.xv[q3];
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
    // Name the actual cause: a weight of too low a rank, a singular weighted cross-product despite enough rank, or
    // whatever else refused (passed through).
    if (e instanceof SingularSolve && W2i.rank < k) {
      twoWhy =
        `the two-step weight matrix has rank ${intText(W2i.rank)} (at most the ${intText(N)} ${plural(N, "group")}), fewer than the ${k} ${plural(k, "coefficient")}, so the two-step estimator is not identified; ` +
        "use one-step, collapse the instruments, drop the time dummies, or add groups";
    } else if (e instanceof SingularSolve) {
      twoWhy =
        `the two-step weight matrix has rank ${intText(W2i.rank)}, at least the ${k} ${plural(k, "coefficient")}, but XᵀZ W₂ ZᵀX is singular: weighted by the one-step residuals, the instruments do not identify every coefficient; ` +
        "use one-step, collapse the instruments, or drop a regressor";
    } else {
      twoWhy = e.message.replace(/\.$/, "").replace(/^./, (ch) => ch.toLowerCase());
    }
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
          const R = bl.rows[r];
          for (let q2 = 0; q2 < R.xi.length; q2++) wx[R.xi[q2]] += w * R.xv[q2];
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
    rankA1: A1i.rank,
    rankS: W2i.rank,
  };
}

/**
 * Pooled OLS (with a constant) or within (fixed-effects) estimates on the level rows, cluster-robust by entity.
 * Accumulated row by row with the time dummy as an index (no dense dummy columns): FE uses XᵀX − Σ_g n_g x̄_g x̄_gᵀ, and
 * its cluster scores Σ_i x_i e_i need no demeaning because the within residuals sum to zero in each entity.
 */
export function olsFeOnLevels(
  data: DynData,
  spec: DynSpec,
  within: boolean,
): { b: number; se: number; n: number } | null {
  const { N, T } = data;
  const kt = spec.terms.length;
  const ySer = data.series.get(spec.y)!;
  const tSer = spec.terms.map((tm) => data.series.get(tm.v)!);
  const td = spec.timeDummies;
  // Columns: terms, then a dummy per period (if asked), then the constant (OLS only).
  const p0 = kt + (td ? T : 0) + (within ? 0 : 1);
  const G0 = new Float64Array(p0 * p0);
  const Xy = new Float64Array(p0);
  const sx = new Float64Array(N * p0);
  const sy = new Float64Array(N);
  const cnt = new Int32Array(N);
  const x = new Float64Array(p0);
  const idx: number[] = [];
  let n = 0;
  // Row list for the second (residual) pass.
  const rg: number[] = [];
  const rt: number[] = [];
  const rowOf = (g: number, t: number): boolean => {
    const yv = ySer[g][t];
    if (Number.isNaN(yv)) return false;
    idx.length = 0;
    for (let j = 0; j < kt; j++) {
      const tt = t - spec.terms[j].lag;
      const v = tt < 0 ? NaN : tSer[j][g][tt];
      if (Number.isNaN(v)) return false;
      x[j] = v;
      idx.push(j);
    }
    if (td) {
      x[kt + t] = 1;
      idx.push(kt + t);
    }
    if (!within) {
      x[p0 - 1] = 1;
      idx.push(p0 - 1);
    }
    return true;
  };
  for (let g = 0; g < N; g++)
    for (let t = 0; t < T; t++) {
      if (!rowOf(g, t)) continue;
      const yv = ySer[g][t];
      n++;
      rg.push(g);
      rt.push(t);
      cnt[g]++;
      sy[g] += yv;
      for (const a of idx) {
        Xy[a] += x[a] * yv;
        sx[g * p0 + a] += x[a];
        for (const c of idx) G0[a * p0 + c] += x[a] * x[c];
      }
    }
  if (n < kt + 3) return null;
  if (within) {
    for (let g = 0; g < N; g++) {
      if (!cnt[g]) continue;
      const o = g * p0;
      for (let a = 0; a < p0; a++) {
        const ma = sx[o + a] / cnt[g];
        if (ma === 0) continue;
        Xy[a] -= ma * sy[g];
        for (let c = 0; c < p0; c++) G0[a * p0 + c] -= ma * sx[o + c];
      }
    }
  }
  const order = [...(within ? [] : [p0 - 1]), ...Array.from({ length: p0 - (within ? 0 : 1) }, (_, j) => j)];
  const kept = independentColumns(G0, p0, 1e-10, order).sort((a, b) => a - b);
  if (!kept.includes(0)) return null;
  const p = kept.length;
  const XtX = new Float64Array(p * p);
  for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) XtX[a * p + c] = G0[kept[a] * p0 + kept[c]];
  const inv = symInverse(XtX, p);
  if (inv.generalized) return null;
  const b = mv(inv.inv, Float64Array.from(kept, (c) => Xy[c]), p, p);
  const bFull = new Float64Array(p0);
  kept.forEach((c, a) => (bFull[c] = b[a]));
  // Residuals and cluster scores (raw x; FE residuals are within-entity deviations).
  const sums = new Float64Array(N * p);
  const posOf = new Int32Array(p0).fill(-1);
  kept.forEach((c, a) => (posOf[c] = a));
  for (let i = 0; i < n; i++) {
    const g = rg[i];
    rowOf(g, rt[i]);
    let fit = 0;
    for (const a of idx) fit += x[a] * bFull[a];
    let e = ySer[g][rt[i]] - fit;
    if (within) {
      let meanFit = 0;
      for (let a = 0; a < p0; a++) meanFit += (sx[g * p0 + a] / cnt[g]) * bFull[a];
      e -= sy[g] / cnt[g] - meanFit;
    }
    for (const a of idx) if (posOf[a] >= 0) sums[g * p + posOf[a]] += x[a] * e;
  }
  const S = new Float64Array(p * p);
  let G = 0;
  for (let g = 0; g < N; g++) {
    if (!cnt[g]) continue;
    G++;
    const o = g * p;
    for (let a = 0; a < p; a++) {
      const va = sums[o + a];
      if (va === 0) continue;
      for (let c = 0; c < p; c++) S[a * p + c] += va * sums[o + c];
    }
  }
  // Stata's cluster factor G/(G − 1)·(n − 1)/(n − p), p the kept columns (the OLS constant included; FE's absorbed).
  const fac = G > 1 && n > p ? (G / (G - 1)) * ((n - 1) / (n - p)) : 1;
  const V = mul(mul(inv.inv, S, p, p, p), inv.inv, p, p, p);
  const se = Math.sqrt(Math.max(V[0] * fac, 0));
  if (!Number.isFinite(b[0]) || !Number.isFinite(se)) return null;
  return { b: b[0], se, n };
}

/** The 97.5% normal point, for the intervals. */
export const GMM_Z975 = Z975;
