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
 *  - one-step robust covariance (Arellano–Bond cluster-robust sandwich); two-step weight W₂ = (Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ)⁻¹ and
 *    Windmeijer's (2005) corrected covariance V₂ + DV₂ + V₂Dᵀ + DV₁Dᵀ; when Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ is singular (always with
 *    more instruments than groups) two-step and Hansen J are refused by name: any generalized inverse would make them
 *    depend on the basis of the instruments (xtabond2 and pydynpd answer with a pseudo-inverse there);
 *  - Hansen J from the two-step estimate (also printed after one-step, as xtabond2 does); Sargan = g₁ᵀA₁g₁/σ̂² from the
 *    one-step residuals with σ̂² = Σ Δû₁²/(2·N_obs), N_obs the reported observation count;
 *  - Arellano–Bond AR(m) tests on the differenced residuals (Roodman's section 3.5 formula, with the reported
 *    covariance and residuals of the step shown).
 * Generalized inverses: linearly dependent instrument columns are dropped first (the estimator is invariant to that),
 * symmetric matrices are equilibrated to a unit diagonal (D^−½ A D^−½) and inverted by Cholesky or, when singular
 * (the one-step weight), by the Moore–Penrose inverse of the equilibrated matrix with eigenvalues below L·ε·λ_max
 * discarded. Every rank decision is taken on unit-diagonal matrices, so no answer depends on the units of a column.
 * When a matrix is singular, this generalized inverse differs from the raw Moore–Penrose inverse that xtabond2 and
 * pydynpd take (that one changes with the units); nonsingular matrices get the same exact inverse.
 *
 * Every loop is bounded by the caps below; work beyond them is refused by name before it starts.
 */
import { chiSquareP, normalCdf } from "./stats2";
import { fmtSci, intText } from "./regTable";

export class GmmRefusal extends Error {}
/** XᵀZ A ZᵀX is singular for the weight A (the two-step path names its cause from this). */
class SingularSolve extends GmmRefusal {}

/** At most this many groups (entities) in a dynamic panel. */
export const DPD_MAX_GROUPS = 2000;
/** At most this many periods from the first to the last (gaps included). */
export const DPD_MAX_PERIODS = 40;
/**
 * At most this many instrument columns (counted from the plan, before any row is built; see planDynamic). The work cap
 * (4·L³ alone is 1.08×10⁸ at 300) can refuse a little earlier when the groups or rows are many.
 */
export const DPD_MAX_INSTR = 300;
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
/**
 * Linear GMM work bound on lgmmWork's estimate, about 0.1 s under Node: 20,000 rows ×
 * 29 instruments, or 50,000 rows × 18 (one endogenous regressor and the constant).
 */
export const LGMM_MAX_WORK = 4e7;
/** Linear GMM: at most this many distinct columns (endogenous, exogenous, excluded instruments, constant). */
export const LGMM_MAX_COLUMNS = 60;

const EPS = Number.EPSILON;
const Z975 = 1.959963984540054;

/**
 * Location limit: after the exact recentering (see the file comment), a column's values may be up to this many times
 * the size of its remaining variation. Beyond it a double keeps fewer than about 8 significant digits of that variation
 * (ε × 10⁸ ≈ 2×10⁻⁸ of it per value, so about 8 significant digits remain), and the column is refused by name instead of being answered from rounding.
 */
export const GMM_LOCATION_LIMIT = 1e8;
/**
 * Exact-fit tolerance: residuals no larger than this many rounding units of the raw values they come from
 * (ε × (|y| + Σ|xⱼbⱼ|), row by row, after one refinement step) are rounding, not error variance.
 */
const EXACT_K = 1000;
const EXACT_FIT_DIFF =
  "The model fits the differenced response exactly (its residuals are zero up to rounding), so there is no error variance: standard errors, z statistics and the Sargan, Hansen and AR tests would be meaningless. Check that the response is not an exact function of its lags, the regressors and the time dummies.";
/** A column whose |mean| is at least this many times its spread anchors the recentering when there is no constant. */
const PIVOT_MIN = 10;

/** Mean by two passes (the second corrects the first's rounding). */
function mean2(v: ArrayLike<number>): number {
  const n = v.length;
  if (!n) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) m += v[i];
  m /= n;
  let c = 0;
  for (let i = 0; i < n; i++) c += v[i] - m;
  return m + c / n;
}

/** The refusal for a column whose variation is below double precision relative to its size. */
/**
 * The limit for a level that stays in a system-GMM instrument column in a period with gaps (see buildDynamic): the
 * time dummies absorb its offset there only approximately, and the rounding grows with the square of the ratio, so
 * ε × (3×10⁴)² ≈ 2×10⁻⁷.
 */
export const GMM_SQUARED_LIMIT = 3e4;

export function gapsReason(name: string, largest: number, spread: number): string {
  return (
    `The values of ${name} are too large relative to their variation for this system GMM with time dummies and gaps in the panel (largest ${fmtSci(largest, 2)}, variation within a period about ${fmtSci(spread, 2)}; ` +
    `this calculator allows a ratio up to 3×10⁴ here): its level instruments the differenced equation, and where a gap breaks a period the time dummies absorb its offset only approximately, so the estimates would rest on rounding. ` +
    `Subtract a constant from ${name} (with gaps the estimates then change a little, as they would in any software), or choose difference GMM, which has no such limit.`
  );
}

export function tooLargeReason(name: string, largest: number, spread: number, shiftFree: boolean): string {
  return (
    `The values of ${name} are too large relative to their variation to estimate in double precision (largest ${fmtSci(largest, 2)}, variation about ${fmtSci(spread, 2)}; ` +
    `this calculator allows a ratio up to 10⁸): ` +
    (shiftFree
      ? `subtract a constant from ${name} (the estimates do not change, except a constant's).`
      : `subtract a constant from ${name}, or rescale it (in this model its level matters, so the estimates will change somewhat).`)
  );
}

/**
 * Why a near-collinear column is refused, from its residual share r (the part of the unit-scaled column that the
 * closest combination of the others leaves): r inflates its coefficient's variance by about 1/r² and the condition
 * number of the scaled cross-products by as much, so 16 − log₁₀(1/r²) significant digits remain in them. The column
 * drop takes r² below 10⁻¹⁰ (10⁻¹¹ for econ-gmm instruments) as dependent: a condition number beyond 10¹⁰, about six
 * digits or fewer, too few for a coefficient and its standard error through the GMM normal equations.
 */
export function nearCollinearTail(r: number, instruments = false): string {
  const infl = 1 / (r * r);
  const digits = Math.floor(16 - Math.log10(infl));
  return (
    `a residual share r inflates the variance of the estimate by about 1/r² (here ${fmtSci(infl, 1)}) and leaves the cross-products ` +
    (digits >= 1 ? `about ${digits} of double precision's 16 significant digits` : "no reliable digit") +
    (instruments ? "; shares below about 3×10⁻⁶ are refused (a condition number above 10¹¹)." : "; shares below about 10⁻⁵ are refused (a condition number above 10¹⁰).")
  );
}

/**
 * Index (in from…to−1) of the column that anchors an exact recentering: a constant column if there is one, else the
 * column whose |mean| is the largest multiple of its spread when that multiple is at least PIVOT_MIN; −1 for none.
 */
function pivotColumn(cols: ArrayLike<number>[], from: number, to: number): number {
  let best = -1;
  let bestR = PIVOT_MIN;
  for (let j = from; j < to; j++) {
    const c = cols[j];
    const m = mean2(c);
    let ss = 0;
    for (let i = 0; i < c.length; i++) ss += (c[i] - m) * (c[i] - m);
    const r = ss === 0 ? (m !== 0 ? Infinity : 0) : Math.abs(m) / Math.sqrt(ss / c.length);
    if (r >= bestR && (best < 0 || r > bestR)) {
      best = j;
      bestR = r;
    }
  }
  return best;
}

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

/**
 * Relative distance |r|/|v| of v from the span of the columns (normal equations with one refinement step, so an
 * exact dependence comes out near ε even when the columns are ill-conditioned, and a near one keeps its true size).
 */
export function dependenceResidual(cols: Float64Array[], v: Float64Array): number {
  const m = cols.length;
  const n = v.length;
  let vv = 0;
  for (let i = 0; i < n; i++) vv += v[i] * v[i];
  if (!(vv > 0)) return 0;
  if (!m) return 1;
  const G = new Float64Array(m * m);
  for (let a = 0; a < m; a++) for (let b = a; b < m; b++) G[a * m + b] = G[b * m + a] = dot(cols[a], cols[b]);
  const inv = symInverse(G, m).inv;
  const coef = new Float64Array(m);
  const r = Float64Array.from(v);
  for (let it = 0; it < 2; it++) {
    const g = Float64Array.from(cols, (c) => dot(c, r));
    const d = mv(inv, g, m, m);
    for (let a = 0; a < m; a++) coef[a] += d[a];
    for (let i = 0; i < n; i++) {
      let s = v[i];
      for (let a = 0; a < m; a++) s -= coef[a] * cols[a][i];
      r[i] = s;
    }
  }
  return Math.sqrt(dot(r, r) / vv);
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
  /** Names for refusals: the response and the instrument columns (in Z's order). */
  yName?: string;
  zNames?: string[];
}

/** First-stage strength of the excluded instruments for one endogenous regressor. */
export interface FirstStage {
  name: string;
  partialR2: number;
  /**
   * Shea's (1997) partial R²: [(XᵀX)⁻¹]ⱼⱼ / [(X̂ᵀX̂)⁻¹]ⱼⱼ with X̂ the projection of X on the instruments (linearmodels'
   * "shea.rsquared"). It measures what the instruments explain of this regressor beyond what they explain of the other
   * endogenous regressors; with one endogenous regressor it equals partialR2.
   */
  shea: number;
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
  /** True when the moment covariance S is singular (rank below L): two-step is then refused and J not computed. */
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
  // Exact recentering before any cross-product (GMM is invariant to X → XQ and Z → ZP for nonsingular Q, P): with a
  // constant, every other column and y lose their means (Q, P subtract multiples of the constant); without one, the
  // most offset-dominated exogenous column plays the constant's part when its |mean| is at least PIVOT_MIN times its
  // spread. The regressor anchor is never an endogenous column (the first stage needs the anchor among the
  // instruments). The coefficient of the anchor is mapped back exactly at the end (b_p = b̃_p + a_y − Σ aⱼb̃ⱼ).
  const xPiv = pivotColumn(inp.X, k1, k);
  const zPiv = pivotColumn(inp.Z, q < L ? q : 0, L);
  const aX = new Float64Array(k);
  let aY = 0;
  const aZ = new Float64Array(L);
  if (xPiv >= 0) {
    const mp = mean2(inp.X[xPiv]);
    for (let j = 0; j < k; j++) if (j !== xPiv) aX[j] = mean2(inp.X[j]) / mp;
    aY = mean2(inp.y) / mp;
  }
  if (zPiv >= 0) {
    const mp = mean2(inp.Z[zPiv]);
    for (let j = 0; j < L; j++) if (j !== zPiv) aZ[j] = mean2(inp.Z[j]) / mp;
  }
  let xConst = xPiv >= 0;
  if (xConst) for (let i = 1; i < n && xConst; i++) if (inp.X[xPiv][i] !== inp.X[xPiv][0]) xConst = false;
  const yName = inp.yName ?? "the response";
  const precision = (raw: ArrayLike<number>, piv: ArrayLike<number>, a: number, name: string, out: (i: number, v: number) => void): void => {
    let mx = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const sh = a * piv[i];
      const v = raw[i] - sh;
      out(i, v);
      // The largest value itself, as reported (the shift is about the column's mean, no larger).
      const m = Math.abs(raw[i]);
      if (m > mx) mx = m;
      ss += v * v;
    }
    const rms = Math.sqrt(ss / n);
    if (ss > 0 && mx > GMM_LOCATION_LIMIT * rms) throw new GmmRefusal(tooLargeReason(name, mx, rms, xConst));
  };
  const y = new Float64Array(n);
  const X = new Float64Array(n * k);
  const Z = new Float64Array(n * L);
  if (xPiv >= 0) {
    precision(inp.y, inp.X[xPiv], aY, yName, (i, v) => (y[i] = v));
    for (let j = 0; j < k; j++) {
      if (j === xPiv) for (let i = 0; i < n; i++) X[i * k + j] = inp.X[j][i];
      else precision(inp.X[j], inp.X[xPiv], aX[j], `“${inp.names[j]}”`, (i, v) => (X[i * k + j] = v));
    }
  } else {
    for (let i = 0; i < n; i++) {
      y[i] = inp.y[i];
      for (let j = 0; j < k; j++) X[i * k + j] = inp.X[j][i];
    }
  }
  const zName = (j: number): string => (inp.zNames?.[j] ? `“${inp.zNames[j]}”` : `instrument ${j + 1}`);
  for (let j = 0; j < L; j++) {
    if (zPiv >= 0 && j !== zPiv) precision(inp.Z[j], inp.Z[zPiv], aZ[j], zName(j), (i, v) => (Z[i * L + j] = v));
    else for (let i = 0; i < n; i++) Z[i * L + j] = inp.Z[j][i];
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
    if (kept.length < L) {
      const j = Array.from({ length: L }, (_, i) => i).find((i) => !kept.includes(i))!;
      const colOf = (c: number): Float64Array => Float64Array.from({ length: n }, (_, i) => Z[i * L + c]);
      const rel = dependenceResidual(kept.map(colOf), colOf(j));
      if (rel > 1e-9) {
        throw new GmmRefusal(
          `The instrument ${zName(j)} is so close to a combination of the others (the closest combination leaves only ${fmtSci(rel, 2)} of it) that the estimates would be unstable: ${nearCollinearTail(rel, true)} Drop one of them, or check the column for a common offset or scale.`,
        );
      }
      throw new GmmRefusal(`The instruments are perfectly collinear (ZᵀZ is singular): ${zName(j)} is a combination of the others${zPiv >= 0 && xConst ? " (or constant, alongside the constant)" : ""}.`);
    }
  }
  const XZ = tr(ZX, L, k);
  const W0 = symInverse(ZZ, L).inv;
  /** β for a weight W and the operator B = (XᵀZWZᵀX)⁻¹XᵀZW (β = B Zᵀy). */
  const estB = (W: Float64Array): { b: Float64Array; B: Float64Array } => {
    const XZW = mul(XZ, W, k, L, L);
    const Mi = mul(XZW, ZX, k, L, k);
    const inv = symInverse(Mi, k);
    if (inv.generalized) throw new GmmRefusal("XᵀZ W ZᵀX is singular: the regressors are perfectly collinear given the instruments, or too nearly so to separate in double precision (or an endogenous regressor is not predicted by the instruments at all).");
    const B = mul(inv.inv, XZW, k, k, L);
    return { b: mv(B, Zy, k, L), B };
  };
  const est = (W: Float64Array): Float64Array => estB(W).b;
  /** The anchor's coefficient mapped back to the raw columns, and its variance from the full covariance C. */
  const backMap = (b: Float64Array, C: Float64Array): CoefSet => {
    const se = Float64Array.from({ length: k }, (_, j) => Math.sqrt(Math.max(C[j * k + j], 0)));
    if (xPiv < 0) return { b, se };
    const p = xPiv;
    const bb = Float64Array.from(b);
    let s = aY;
    for (let j = 0; j < k; j++) if (j !== p) s -= aX[j] * b[j];
    bb[p] = b[p] + s;
    // Var(qᵀb̃), q = e_p − Σ_{j≠p} aⱼeⱼ.
    let v = 0;
    for (let i = 0; i < k; i++) {
      const qi = i === p ? 1 : -aX[i];
      if (qi === 0) continue;
      for (let j = 0; j < k; j++) {
        const qj = j === p ? 1 : -aX[j];
        if (qj !== 0) v += qi * qj * C[i * k + j];
      }
    }
    se[p] = Math.sqrt(Math.max(v, 0));
    return { b: bb, se };
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
  const s1 = estB(W0);
  const b1 = s1.b;
  const e1 = resid(b1);
  // An exact fit leaves no error variance: every standard error, z and J would be rounding noise. After one
  // refinement step (β += B Zᵀe), residuals within EXACT_K rounding units of the raw values are rounding: the test
  // scales with the raw magnitudes, so an exact fit is refused at any offset and real noise is not.
  {
    const ze = new Float64Array(L);
    for (let i = 0; i < n; i++) for (let a = 0; a < L; a++) ze[a] += Z[i * L + a] * e1[i];
    const d = mv(s1.B, ze, k, L);
    const bR = Float64Array.from(b1, (v, j) => v + d[j]);
    const eR = resid(bR);
    const raw = backMap(bR, new Float64Array(k * k)).b;
    let ssr = 0;
    let floor = 0;
    for (let i = 0; i < n; i++) {
      ssr += eR[i] * eR[i];
      let m = Math.abs(inp.y[i]);
      for (let j = 0; j < k; j++) m += Math.abs(inp.X[j][i] * raw[j]);
      floor += m * m;
    }
    if (!(ssr > EXACT_K * EXACT_K * EPS * EPS * floor)) {
      throw new GmmRefusal("The model fits the response exactly (the 2SLS residuals are zero up to rounding), so there is no error variance: standard errors, z statistics and the J test would be meaningless. Check that the response is not a combination of the regressors.");
    }
  }
  const S1 = Smat(e1);
  const C1 = cov(W0n, S1);
  const tsls = backMap(b1, C1);
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
    // A singular S (rank below L) has no inverse; a generalized one would make the two-step estimate and J depend on
    // the basis of the instruments, so they are refused by name (as with too few clusters above).
    singularS = Wi.rank < L;
    if (singularS) {
      const why = `the moment covariance S is singular (rank ${intText(Wi.rank)} for ${L} instruments: some combination of the instruments is (nearly) uncorrelated with the 2SLS residuals in every ${inp.clusters ? "cluster" : "row"}), so the efficient weight S⁻¹ is not defined`;
      if (inp.steps === 2) throw new GmmRefusal(`Two-step GMM: ${why}; a generalized inverse would make the estimate depend on how the instruments are written. Use one-step, or fewer instruments.`);
      jWhy = `${why}, and the J test needs it`;
    } else {
      const W = Wi.inv;
      const b2 = est(W);
      const e2 = resid(b2);
      const gbar = new Float64Array(L);
      for (let i = 0; i < n; i++) for (let a = 0; a < L; a++) gbar[a] += (Z[i * L + a] * e2[i]) / n;
      j = n * quad(W, gbar, L);
      if (inp.steps === 2) gmm = backMap(b2, cov(W, Smat(e2)));
    }
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
    // Shea: diag (XᵀX)⁻¹ over diag (X̂ᵀX̂)⁻¹, X̂ᵀX̂ = XᵀZ(ZᵀZ)⁻¹ZᵀX. The recentering above only adds multiples of the anchor
    // (a column of X that the instruments contain) to other columns, which leaves both diagonals of an endogenous
    // regressor unchanged; symInverse's scaling cancels in the ratio.
    const XX = new Float64Array(k * k);
    for (let i = 0; i < n; i++) {
      const xo = i * k;
      for (let a = 0; a < k; a++) {
        const xa = X[xo + a];
        if (xa === 0) continue;
        for (let b = a; b < k; b++) XX[a * k + b] += xa * X[xo + b];
      }
    }
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) XX[b * k + a] = XX[a * k + b];
    const XXi = symInverse(XX, k);
    const XhXi = symInverse(mul(mul(XZ, W0, k, L, L), ZX, k, L, k), k);
    const sheaOf = (c: number): number => (XXi.generalized || XhXi.generalized || !(XhXi.inv[c * k + c] > 0) ? NaN : XXi.inv[c * k + c] / XhXi.inv[c * k + c]);
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
      firstStage.push({ name: inp.names[c], partialR2, shea: sheaOf(c), wald, df: q, p: Number.isFinite(wald) && !Vi.generalized ? chiSquareP(Math.max(wald, 0), q) : NaN });
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
  /** Entity labels (for refusals), when known. */
  entityNames?: string[];
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
  /** Level-row means taken out of the response and of each kept regressor (system GMM; 0 otherwise), and the constant's index (−1: none). */
  mY: number;
  mX: Float64Array;
  constIdx: number;
  /** √Σ over the differenced rows of the raw sizes |y_t| + |y_t−1| and, per kept regressor, of its raw entries (the exact-fit tolerance). */
  magY: number;
  magX: Float64Array;
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
  // Data recorded every other period (2000, 2002, …): the response is never seen in two adjacent periods, although some
  // entity has it in two periods or more. Named in the refusals below (the periods are not renumbered silently: a lag
  // is one period of the time column).
  const spacedHint = (): string => {
    const ys = data.series.get(spec.y);
    if (!ys) return "";
    let twice = false;
    for (let g = 0; g < N; g++) {
      let seen = 0;
      for (let t = 0; t < T; t++) {
        if (Number.isNaN(ys[g][t])) continue;
        if (t > 0 && !Number.isNaN(ys[g][t - 1])) return "";
        seen++;
      }
      if (seen >= 2) twice = true;
    }
    return twice
      ? ` The response is never recorded in two adjacent periods of ${data.timeName ? `“${data.timeName}”` : "the time column"}: if the data come every other period (for example 2000, 2002, 2004, …), renumber the periods 1, 2, 3, … in a new column and use it as the time column, so that a lag is one recorded period.`
      : "";
  };
  if (T > DPD_MAX_PERIODS) throw new GmmRefusal(`The panel spans ${T} periods (gaps included); this calculator allows ${DPD_MAX_PERIODS}.${spacedHint()}`);
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
  if (!dPer.length) throw new GmmRefusal(`No entity has two consecutive periods with every value the model needs, so no first difference can be formed. Check the lags against the length of each entity's series.${spacedHint()}`);
  // A response that never changes within an entity is a pure entity effect: every first difference is zero, so there
  // are no dynamics to estimate (difference GMM has nothing to fit; system GMM would fit ρ = 1 to the levels exactly).
  {
    const ys = data.series.get(spec.y)!;
    let movers = 0;
    let lastG = -1;
    let cells = 0;
    let lastT = -1;
    for (let g = 0; g < N && movers < 2; g++) {
      let mv0 = false;
      for (const t of dRows[g])
        if (ys[g][t] !== ys[g][t - 1]) {
          mv0 = true;
          cells++;
          lastT = t;
        }
      if (mv0) {
        movers++;
        lastG = g;
      }
    }
    if (!movers) throw new GmmRefusal(`The response “${spec.y}” never changes within an entity in the estimation rows (every first difference is zero): it is a pure entity effect, so there are no dynamics to estimate.`);
    // All its changes in one entity: every estimate rests on that entity, and a cluster-robust standard error (one
    // score per entity) cannot measure their uncertainty, however small it prints.
    // (With fewer than GMM_MIN_GROUPS groups in all, the group-count refusal names the larger problem.)
    let withRows = 0;
    for (let g = 0; g < N; g++) if (dRows[g].length || lRows[g].length) withRows++;
    if (movers === 1 && withRows >= GMM_MIN_GROUPS) {
      const ent = data.entityNames?.[lastG] !== undefined ? `“${data.entityNames[lastG]}”` : `number ${intText(lastG + 1)}`;
      const where = cells === 1 ? `one entity-period (entity ${ent}, period ${data.periodLabels[lastT]})` : `one entity (${ent})`;
      throw new GmmRefusal(`The response “${spec.y}” changes within only ${where} in the estimation rows: every estimate would rest on that entity alone, and cluster-robust standard errors, one score per entity, cannot measure their uncertainty.`);
    }
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
  // covariance) and 4·L³ (the column reduction and two inverses; the weight 4 is measured: an L³ step costs about four
  // multiply-add units of the row passes).
  const nExog = ivCol.reduce((s, c) => s + (c >= 0 ? 1 : 0), 0);
  const nzx = kt + 3;
  let rowWork = 0;
  let rows = 0;
  let groups = 0;
  for (let g = 0; g < N; g++) {
    if (dRows[g].length || lRows[g].length) groups++;
    for (const t of dRows[g]) {
      let nnz = nExog + (spec.timeDummies && !spec.system ? 2 : 0);
      // The lags present, plus (collapsed, successive differences: not difference GMM with time dummies) the one boundary
      // entry of the first lag not yet present.
      const edge = spec.collapse && (spec.system || !spec.timeDummies) && t >= a1 && t < bMax ? 1 : 0;
      for (let gi = 0; gi < nG; gi++) nnz += Math.max(0, Math.min(bMax, t) - a1 + 1) + edge;
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
  const work = rowWork + DPD_ROW_COST * rows + 3 * groups * kEst * instr + groups * instr * instr + 4 * instr * instr * instr;
  return { dRows, lRows, dPer, lPer, L0, A, bMax, dCol, lCol, ivCol, tdCol, consCol, instr, groups, rows, work };
}

/** Refuses a plan over the caps, by name (DPD_MAX_INSTR on the instrument count, DPD_MAX_WORK on one fit). */
export function checkPlan(p: DynPlan, collapsed = false): void {
  // The advice names only what is left to change: "collapse" when the instruments are not collapsed yet (R5 minor).
  const fix = collapsed ? "Set a last lag for the GMM-style instruments" : "Choose “collapse”, or a last lag for the GMM-style instruments";
  if (p.instr > DPD_MAX_INSTR) {
    throw new GmmRefusal(
      `The instrument set would have about ${intText(p.instr)} columns; this calculator allows ${intText(DPD_MAX_INSTR)} (far more than is wise anyway). ${fix}.`,
    );
  }
  if (p.work > DPD_MAX_WORK) {
    throw new GmmRefusal(
      `${intText(p.groups)} ${plural(p.groups, "group")} and ${intText(p.rows)} stacked rows with about ${intText(p.instr)} instruments is beyond the work this calculator allows in the task pane. ${collapsed ? "Set a last lag for the GMM-style instruments, or use fewer time dummies" : "Choose “collapse”, a last lag for the GMM-style instruments, or fewer time dummies"}.`,
    );
  }
}

/**
 * Builds the stacked design (see the file comment for every convention), from its plan, in two phases: the response
 * and regressor rows first (with the collinear-regressor refusal and an exact-fit precheck by least squares on the
 * differenced rows, so those refusals never build an instrument), then the instrument rows.
 *
 * Location: every column is recentered by an exact reparametrization before any cross-product is formed (the
 * estimator, its covariance and every test are invariant to X → XQ and Z → ZP for nonsingular Q, P):
 *  - system GMM: the level rows of the response, of each regressor term and of each IV-style instrument lose their
 *    level-row means (multiples of the constant, which is a regressor and an instrument there); the constant's
 *    coefficient is mapped back exactly in fitDynamic;
 *  - difference GMM with time dummies: each GMM-style column loses, in the differenced rows of each period t, the mean
 *    of its present values there (the differenced dummy instruments span every period indicator of the differenced
 *    rows, row by row, gaps included: Σ_{s ≥ t} of them is the indicator of period t);
 *  - otherwise (system GMM, or no time dummies) no instrument is a period indicator of the differenced rows, so each
 *    later lag a > a₁ of a GMM-style column becomes its difference from lag a − 1 (a triangular combination of
 *    instrument columns, exact again, and as sparse as the raw columns but for one boundary entry) and the lag-a₁
 *    column keeps its level. Its offset then mostly acts as an indicator of the rows where
 *    the lag exists, which is well conditioned; in a balanced system-GMM panel with time dummies the estimates do not
 *    depend on that offset at all (the level dummies of t and t − 1 carry the same moments), so there its precision is
 *    judged on its per-period deviations.
 * After the recentering, a variable whose values exceed GMM_LOCATION_LIMIT times the size of their remaining variation
 * (differences, centered levels, recentered instruments) is refused by name.
 */
export function buildDynamic(data: DynData, spec: DynSpec, plan?: DynPlan): DynDesign {
  const p = plan ?? planDynamic(data, spec);
  if (!plan) checkPlan(p, spec.collapse);
  // Too few groups is the first thing to say (before an exact fit that few rows can produce).
  if (p.groups < GMM_MIN_GROUPS) throw new GmmRefusal(`The panel has ${fewGroupsReason(p.groups, 0, "group")}`);
  const { N, T } = data;
  const terms = spec.terms;
  const kt = terms.length;
  const { dRows, lRows, L0, A, bMax, dCol, lCol, ivCol, tdCol, consCol } = p;
  const a1 = spec.lagFirst;
  const nG = spec.gmmVars.length;
  const sys = spec.system;
  const td = spec.timeDummies;
  const ser = (v: string): Float64Array[] => data.series.get(v)!;
  const ySer = ser(spec.y);
  const tSer = terms.map((tm) => ser(tm.v));
  const gSer = spec.gmmVars.map(ser);
  const at = (s: Float64Array[], g: number, t: number): number => (t < 0 || t >= T ? NaN : s[g][t]);
  // Regressor columns: terms, then a dummy per period, then the constant (system).
  const kFull = kt + (td ? T : 0) + (sys ? 1 : 0);
  // Level-row means (system GMM), by two passes.
  let mY = 0;
  const mTerm = new Float64Array(kt);
  if (sys) {
    let n = 0;
    for (let g = 0; g < N; g++)
      for (const t of lRows[g]) {
        n++;
        mY += ySer[g][t];
        for (let j = 0; j < kt; j++) mTerm[j] += tSer[j][g][t - terms[j].lag];
      }
    if (n) {
      mY /= n;
      for (let j = 0; j < kt; j++) mTerm[j] /= n;
      let cy = 0;
      const cx = new Float64Array(kt);
      for (let g = 0; g < N; g++)
        for (const t of lRows[g]) {
          cy += ySer[g][t] - mY;
          for (let j = 0; j < kt; j++) cx[j] += tSer[j][g][t - terms[j].lag] - mTerm[j];
        }
      mY += cy / n;
      for (let j = 0; j < kt; j++) mTerm[j] += cx[j] / n;
    }
  }
  // Precision record per variable: largest |value| used, then (sum of squares, count) of its differences (D), of its
  // centered levels (C), of its recentered instrument values (I) and of the per-period deviations of a level kept
  // as a system-GMM instrument in a period whose gaps prevent the exact recentering (Q, judged on GMM_SQUARED_LIMIT:
  // there the offset is almost, not exactly, absorbed by the dummies, and the cancellation runs through the squares).
  const prec = new Map<string, Float64Array>();
  // One record per variable, looked up once (not per value).
  const recOf = (v: string): Float64Array => {
    let r = prec.get(v);
    if (!r) prec.set(v, (r = new Float64Array(9)));
    return r;
  };
  const yRec = recOf(spec.y);
  const tRec = terms.map((tm) => recOf(tm.v));
  const gRec = spec.gmmVars.map(recOf);
  const rec = (r: Float64Array, raw: number, fam: number, val: number): void => {
    const a = Math.abs(raw);
    if (a > r[0]) r[0] = a;
    r[1 + 2 * fam] += val * val;
    r[2 + 2 * fam]++;
  };
  const checkPrec = (): void => {
    for (const [v, r] of prec)
      for (let f = 0; f < 4; f++) {
        const n = r[2 + 2 * f];
        const ss = r[1 + 2 * f];
        if (!(n > 0 && ss > 0)) continue;
        const rms = Math.sqrt(ss / n);
        if (f === 3 && r[0] > GMM_SQUARED_LIMIT * rms) throw new GmmRefusal(gapsReason(`“${v}”`, r[0], rms));
        if (f < 3 && r[0] > GMM_LOCATION_LIMIT * rms) throw new GmmRefusal(tooLargeReason(`“${v}”`, r[0], rms, td || !spec.gmmVars.includes(v)));
      }
  };
  // Raw magnitudes of the differenced rows for the exact-fit tolerance: √Σ(|y_t| + |y_t−1|)² and, per regressor
  // column, √Σ(raw size of its entries)².
  let magY = 0;
  const magX = new Float64Array(kFull);
  // ---------------------------------------------------------------- phase 1: response and regressor rows
  // First without allocating a row: the recentered regressor values of one row go to xScratch (its nonzero columns to
  // nzI), so the Gram matrices, the precision record, the collinearity refusal and the exact-fit precheck cost one or
  // two passes over the series and nothing else.
  const xScratch = new Float64Array(kFull);
  const nzI = new Int32Array(kFull);
  let nz = 0;
  const set = (c: number, v: number): void => {
    if (v === 0) return;
    if (xScratch[c] === 0) nzI[nz++] = c;
    xScratch[c] += v;
  };
  const fillRow = (g: number, t: number, diff: boolean, track: boolean): number => {
    for (let p2 = 0; p2 < nz; p2++) xScratch[nzI[p2]] = 0;
    nz = 0;
    let y: number;
    if (diff) {
      const y1 = ySer[g][t];
      const y0 = ySer[g][t - 1];
      y = y1 - y0;
      if (track) {
        rec(yRec, Math.max(Math.abs(y1), Math.abs(y0)), 0, y);
        const my = Math.abs(y1) + Math.abs(y0);
        magY += my * my;
      }
      for (let j = 0; j < kt; j++) {
        const v1 = tSer[j][g][t - terms[j].lag];
        const v0 = tSer[j][g][t - 1 - terms[j].lag];
        set(j, v1 - v0);
        if (track) {
          rec(tRec[j], Math.max(Math.abs(v1), Math.abs(v0)), 0, v1 - v0);
          const m = Math.abs(v1) + Math.abs(v0);
          magX[j] += m * m;
        }
      }
      if (td) {
        set(kt + t, 1);
        set(kt + t - 1, -1);
        if (track) {
          magX[kt + t]++;
          magX[kt + t - 1]++;
        }
      }
    } else {
      const yr = ySer[g][t];
      y = yr - mY;
      if (track) rec(yRec, yr, 1, y);
      for (let j = 0; j < kt; j++) {
        const v = tSer[j][g][t - terms[j].lag];
        set(j, v - mTerm[j]);
        if (track) rec(tRec[j], v, 1, v - mTerm[j]);
      }
      if (td) set(kt + t, 1);
      set(kFull - 1, 1);
    }
    // A sum can cancel to zero (never for these columns, but keep the list exact); then increasing column order
    // (insertion sort: the dummies arrive as t, t − 1).
    let w = 0;
    for (let p2 = 0; p2 < nz; p2++) if (xScratch[nzI[p2]] !== 0) nzI[w++] = nzI[p2];
    nz = w;
    for (let i = 1; i < nz; i++) {
      const c = nzI[i];
      let j = i;
      while (j > 0 && nzI[j - 1] > c) {
        nzI[j] = nzI[j - 1];
        j--;
      }
      nzI[j] = c;
    }
    return y;
  };
  // Regressors: Gram matrices XᵀX (all rows) and of the differenced rows (with Xᵀy there), of the recentered rows.
  const XtX = new Float64Array(kFull * kFull);
  const XtXd = new Float64Array(kFull * kFull);
  const Xyd = new Float64Array(kFull);
  let emptyGroups = 0;
  for (let g = 0; g < N; g++) {
    if (!dRows[g].length && !lRows[g].length) {
      emptyGroups++;
      continue;
    }
    for (const t of dRows[g]) {
      const y = fillRow(g, t, true, true);
      for (let p2 = 0; p2 < nz; p2++) {
        const a = nzI[p2];
        const xa = xScratch[a];
        Xyd[a] += xa * y;
        for (let q2 = 0; q2 < nz; q2++) {
          const v = xa * xScratch[nzI[q2]];
          XtX[a * kFull + nzI[q2]] += v;
          XtXd[a * kFull + nzI[q2]] += v;
        }
      }
    }
    for (const t of lRows[g]) {
      fillRow(g, t, false, true);
      for (let p2 = 0; p2 < nz; p2++) {
        const a = nzI[p2];
        const xa = xScratch[a];
        for (let q2 = 0; q2 < nz; q2++) XtX[a * kFull + nzI[q2]] += xa * xScratch[nzI[q2]];
      }
    }
  }
  magY = Math.sqrt(magY);
  for (let c = 0; c < kFull; c++) magX[c] = Math.sqrt(magX[c]);
  checkPrec();
  // Drop generated columns (zero first, then collinear, in order; the constant and the user's terms first), and refuse
  // a collinear user term by name (checked in the data, so a near dependence is not called exact).
  const termOrder = Array.from({ length: kt }, (_, j) => j);
  const keptTerms = independentColumns(XtX, kFull, 1e-10, termOrder);
  if (keptTerms.length < kt) {
    const bad = termOrder.find((j) => !keptTerms.includes(j))!;
    if (!(XtX[bad * kFull + bad] > 0)) throw new GmmRefusal(`The regressor ${terms[bad].label} does not vary (it is zero or constant in every row used, so its difference is zero) in the estimation rows; remove it.`);
    const want = [...keptTerms.filter((j) => j < bad), bad];
    const fc = want.map(() => new Float64Array(p.rows));
    let ri = 0;
    for (let g = 0; g < N; g++)
      for (const [list, diff] of [[dRows[g], true], [lRows[g], false]] as [number[], boolean][])
        for (const t of list) {
          fillRow(g, t, diff, false);
          want.forEach((c, i) => (fc[i][ri] = xScratch[c]));
          ri++;
        }
    const rel = dependenceResidual(fc.slice(0, -1), fc[fc.length - 1]);
    if (rel > 1e-9) {
      throw new GmmRefusal(`The regressor ${terms[bad].label} is so close to a combination of the other regressors in the estimation rows (the closest combination leaves only ${fmtSci(rel, 2)} of it) that its estimate would be unstable: ${nearCollinearTail(rel)} Remove it or one of the others.`);
    }
    throw new GmmRefusal(`The regressor ${terms[bad].label} is perfectly collinear with the other regressors in the estimation rows; remove it.`);
  }
  const genOrder = [...(sys ? [kFull - 1] : []), ...(td ? Array.from({ length: T }, (_, s) => kt + s) : [])];
  const kept = independentColumns(XtX, kFull, 1e-10, [...termOrder, ...genOrder]).sort((a, b) => a - b);
  const droppedDummies: string[] = [];
  if (td) for (let s = 0; s < T; s++) if (!kept.includes(kt + s)) droppedDummies.push(data.periodLabels[s]);
  if (sys && !kept.includes(kFull - 1)) throw new GmmRefusal("The constant is collinear with the regressors in the level equation; remove a regressor that is constant.");
  const names: string[] = [];
  const kinds: string[] = [];
  for (const c of kept) {
    if (c < kt) {
      names.push(terms[c].label);
      kinds.push(terms[c].kind);
    } else if (sys && c === kFull - 1) {
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
  const magK = Float64Array.from(kept, (c) => magX[c]);
  const mX = Float64Array.from(kept, (c) => (c < kt && sys ? mTerm[c] : 0));
  const constIdx = sys ? colMap[kFull - 1] : -1;
  // Exact-fit precheck: least squares of the differenced response on the differenced regressors (two refinement
  // passes). Least squares minimizes the sum of squares, so if it leaves more than rounding, no GMM estimate fits
  // exactly; if it leaves only rounding, the differenced equation has no error at all.
  {
    const kd = kept.length;
    const G = new Float64Array(kd * kd);
    for (let a = 0; a < kd; a++) for (let c = 0; c < kd; c++) G[a * kd + c] = XtXd[kept[a] * kFull + kept[c]];
    const K = independentColumns(G, kd, 1e-10).map((a) => kept[a]);
    const m = K.length;
    const GK = new Float64Array(m * m);
    for (let a = 0; a < m; a++) for (let c = 0; c < m; c++) GK[a * m + c] = XtXd[K[a] * kFull + K[c]];
    const inv = symInverse(GK, m).inv;
    const bK = mv(inv, Float64Array.from(K, (c) => Xyd[c]), m, m);
    const bFull = new Float64Array(kFull);
    const pass = (upd: boolean): number => {
      bFull.fill(0);
      K.forEach((c, a) => (bFull[c] = bK[a]));
      const ge = new Float64Array(kFull);
      let s2 = 0;
      for (let g = 0; g < N; g++)
        for (const t of dRows[g]) {
          let e = fillRow(g, t, true, false);
          for (let p2 = 0; p2 < nz; p2++) e -= xScratch[nzI[p2]] * bFull[nzI[p2]];
          s2 += e * e;
          if (upd) for (let p2 = 0; p2 < nz; p2++) ge[nzI[p2]] += xScratch[nzI[p2]] * e;
        }
      if (upd) {
        const dlt = mv(inv, Float64Array.from(K, (c) => ge[c]), m, m);
        for (let a = 0; a < m; a++) bK[a] += dlt[a];
      }
      return s2;
    };
    const floorOf = (): number => {
      let f = magY;
      K.forEach((c, a) => (f += Math.abs(bK[a]) * magX[c]));
      return f * EXACT_K * EPS;
    };
    // The first pass's sum of squares bounds the minimum from above; far above the floor (10⁴ times: more than the
    // normal equations' own rounding on these recentered columns can explain) it is no exact fit, and the
    // refinement pass is skipped.
    const s1 = m > 0 ? pass(true) : pass(false);
    const f1 = floorOf();
    if (!(s1 > 1e8 * f1 * f1)) {
      const s2 = pass(false);
      const f2 = floorOf();
      if (!(s2 > f2 * f2)) throw new GmmRefusal(EXACT_FIT_DIFF);
    }
  }
  // The rows themselves, regressors on the kept columns.
  const blocks: Block[] = [];
  const NOI = new Int32Array(0);
  const NOV = new Float64Array(0);
  const mkRow = (g: number, t: number, diff: boolean): Row => {
    const y = fillRow(g, t, diff, false);
    let m = 0;
    for (let p2 = 0; p2 < nz; p2++) if (colMap[nzI[p2]] >= 0) m++;
    const xi = new Int32Array(m);
    const xv = new Float64Array(m);
    m = 0;
    for (let p2 = 0; p2 < nz; p2++) {
      const c = nzI[p2];
      if (colMap[c] >= 0) {
        xi[m] = colMap[c];
        xv[m++] = xScratch[c];
      }
    }
    return { zi: NOI, zv: NOV, xi, xv, y, t };
  };
  for (let g = 0; g < N; g++) {
    const d = dRows[g];
    const l = lRows[g];
    if (!d.length && !l.length) continue;
    const rows: Row[] = [];
    for (const t of d) rows.push(mkRow(g, t, true));
    for (const t of l) rows.push(mkRow(g, t, false));
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
  // ---------------------------------------------------------------- phase 2: instrument rows
  // Per-period means of the GMM-style differenced-equation columns (time dummies on), by two passes.
  const dMu = td ? new Float64Array(nG * A * T) : null;
  if (dMu) {
    const cnt = new Int32Array(nG * A * T);
    const corr = new Float64Array(nG * A * T);
    for (let pass = 0; pass < 2; pass++) {
      for (let g = 0; g < N; g++)
        for (const t of dRows[g])
          for (let gi = 0; gi < nG; gi++) {
            const s = gSer[gi][g];
            // Lags beyond t have no value (t − a < 0).
            for (let a = a1, aEnd = Math.min(bMax, t); a <= aEnd; a++) {
              if (dCol[(gi * A + a) * T + (spec.collapse ? 0 : t)] < 0) continue;
              const v = s[t - a];
              if (Number.isNaN(v)) continue;
              const ix = (gi * A + a) * T + t;
              if (pass === 0) {
                dMu[ix] += v;
                cnt[ix]++;
              } else corr[ix] += v - dMu[ix];
            }
          }
      for (let ix = 0; ix < dMu.length; ix++) if (cnt[ix]) dMu[ix] = pass === 0 ? dMu[ix] / cnt[ix] : dMu[ix] + corr[ix] / cnt[ix];
    }
  }
  // A row fills at most every GMM-style lag of every GMM variable, one IV-style column per term, two dummies, the constant.
  const zScrI = new Int32Array(nG * (A + 1) + kt + 3);
  const zScrV = new Float64Array(zScrI.length);
  // System GMM with time dummies: a period t is "exact" when the groups with a differenced row at t are exactly those
  // with level rows at t and at t − 1 (no gap touches it); there the differenced row of t carries the moments of the
  // level dummies of t minus t − 1, so subtracting a per-period mean from the lag-a₁ level is an exact reparametrization.
  const exactT = new Uint8Array(T);
  if (sys && td) {
    const dc = new Int32Array(T);
    const lc = new Int32Array(T);
    for (let g = 0; g < N; g++) {
      for (const t of dRows[g]) dc[t]++;
      for (const t of lRows[g]) lc[t]++;
    }
    for (let t = 1; t < T; t++) exactT[t] = dc[t] > 0 && dc[t] === lc[t] && dc[t] === lc[t - 1] ? 1 : 0;
  }
  // The entries of the row being built go to zScrI/zScrV (m of them), skipping absent columns, zeros and NaN.
  let m = 0;
  const put = (c: number, v: number): void => {
    if (c < 0 || v === 0 || Number.isNaN(v)) return;
    zScrI[m] = c;
    zScrV[m++] = v;
  };
  for (const b of blocks) {
    const g = b.g;
    for (let ri = 0; ri < b.rows.length; ri++) {
      const row = b.rows[ri];
      const diff = ri < b.nd;
      const t = row.t;
      m = 0;
      if (diff) {
        for (let gi = 0; gi < nG; gi++) {
          const gr = gRec[gi];
          // The series of this variable for this group; t − a < t < T, so only t − a < 0 is out of range.
          const s = gSer[gi][g];
          let vPrev = NaN;
          for (let a = a1; a <= bMax; a++) {
            const c = dCol[(gi * A + a) * T + (spec.collapse ? 0 : t)];
            if (a > a1) vPrev = t - a + 1 >= 0 ? s[t - a + 1] : NaN;
            if (c < 0) continue;
            const v = t - a >= 0 ? s[t - a] : NaN;
            const has = !Number.isNaN(v);
            // The value, and the precision record (rec, written out: this loop runs for every instrument value, and
            // a call per value boxed its numbers) of family fam (−1: none) with its raw size and recentered value.
            let val: number;
            let fam = -1;
            let raw = 0;
            let rv = 0;
            if (dMu && !sys) {
              val = (has ? v : 0) - dMu[(gi * A + a) * T + t];
              if (has) {
                fam = 2;
                raw = v;
                rv = val;
              }
            } else {
              // Lag a₁ keeps its level, each later lag becomes its difference from the lag before (successive
              // differences keep a row sparse: a lag that does not exist yet adds one boundary entry, not one per
              // missing lag); in an exact period of system GMM with time dummies they also lose their per-period
              // means (a later lag the difference of the two means).
              const ex = dMu !== null && exactT[t] === 1;
              const mu = ex ? dMu![(gi * A + a) * T + t] : 0;
              if (a === a1) {
                val = (has ? v : 0) - mu;
                // Without time dummies its offset is a genuine part of the instrument (no precision limit applies).
                if (has && dMu) {
                  fam = ex ? 2 : 3;
                  raw = v;
                  rv = v - dMu[(gi * A + a) * T + t];
                }
              } else {
                const hp = !Number.isNaN(vPrev);
                const muP = ex ? dMu![(gi * A + a - 1) * T + t] : 0;
                val = (has ? v : 0) - (hp ? vPrev : 0) - (mu - muP);
                if (has && hp) {
                  fam = 2;
                  raw = Math.max(Math.abs(v), Math.abs(vPrev));
                  rv = val;
                }
              }
            }
            if (fam >= 0) {
              const ar = Math.abs(raw);
              if (ar > gr[0]) gr[0] = ar;
              gr[1 + 2 * fam] += rv * rv;
              gr[2 + 2 * fam]++;
            }
            if (val !== 0 && !Number.isNaN(val)) {
              zScrI[m] = c;
              zScrV[m++] = val;
            }
          }
        }
        for (let j = 0; j < kt; j++) if (ivCol[j] >= 0) put(ivCol[j], at(tSer[j], g, t - terms[j].lag) - at(tSer[j], g, t - 1 - terms[j].lag));
        if (td && !sys) {
          put(tdCol[t], 1);
          put(tdCol[t - 1], -1);
        }
      } else {
        const lag = a1 - 1;
        for (let gi = 0; gi < nG; gi++) put(lCol[gi * T + (spec.collapse ? 0 : t)], at(gSer[gi], g, t - lag) - at(gSer[gi], g, t - lag - 1));
        for (let j = 0; j < kt; j++) if (ivCol[j] >= 0) put(ivCol[j], at(tSer[j], g, t - terms[j].lag) - mTerm[j]);
        if (td) put(tdCol[t], 1);
        put(consCol, 1);
      }
      // Sparse indices in increasing order (insertion sort: a row holds a few dozen entries at most, nearly in order).
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
      row.zi = zI;
      row.zv = zV;
    }
  }
  checkPrec();
  // Instruments: drop zero columns, then dependent ones (pivoted Cholesky on ZᵀZ, scaled).
  const nnz = new Int32Array(L0);
  for (const b of blocks) for (const r of b.rows) for (const c of r.zi) nnz[c]++;
  const nzCols: number[] = [];
  for (let c = 0; c < L0; c++) if (nnz[c] > 0) nzCols.push(c);
  const pos = new Int32Array(L0).fill(-1);
  nzCols.forEach((c, i) => (pos[c] = i));
  const L1 = nzCols.length;
  // Upper triangle only (a row's indices are increasing and pos keeps their order), mirrored after.
  const ZZ = new Float64Array(L1 * L1);
  for (const b of blocks)
    for (const r of b.rows) {
      const zi = r.zi;
      const zv = r.zv;
      for (let p = 0; p < zi.length; p++) {
        const o = pos[zi[p]] * L1;
        const va = zv[p];
        for (let q2 = p; q2 < zi.length; q2++) ZZ[o + pos[zi[q2]]] += va * zv[q2];
      }
    }
  for (let a = 0; a < L1; a++) for (let c = a + 1; c < L1; c++) ZZ[c * L1 + a] = ZZ[a * L1 + c];
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
  return { blocks, names, kinds, L, rawL: L0, droppedDummies, nDiff, nLevel, perGroup, emptyGroups, system: spec.system, mY, mX, constIdx, magY, magX: magK };
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
  /**
   * Null when the two-step estimator is refused (a singular two-step weight) or not identified: twoWhy says why, in
   * a sentence, and twoShort in a few words (a table cell); Hansen J is then NaN.
   */
  two: DynStep | null;
  twoWhy?: string;
  twoShort?: string;
  hansen: number;
  hansenP: number;
  sargan: number;
  sarganP: number;
  /** A generalized inverse was needed for the one-step weight; the two-step moment covariance is singular (two-step refused). */
  singularA1: boolean;
  singularS: boolean;
  /**
   * Ranks of the one-step weight's matrix Σ ZᵢᵀHᵢZᵢ and of the two-step moment covariance (L when nonsingular; −1 when
   * not computed because there are fewer groups than instruments, so it is singular).
   */
  rankA1: number;
  rankS: number;
}

/** Fits the one-step and, when its weight is nonsingular, the two-step estimator on a design (Hansen J needs the second). */
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
  // After one refinement step, differenced residuals within EXACT_K rounding units of the raw values are rounding.
  let ssr1 = 0;
  blocks.forEach((bl, i) => {
    for (let r = 0; r < bl.nd; r++) ssr1 += e1[i][r] * e1[i][r];
  });
  let floor1 = des.magY;
  for (let j = 0; j < k; j++) floor1 += Math.abs(s1.b[j]) * des.magX[j];
  floor1 *= EXACT_K * EPS;
  // Far above the floor (10⁴ times) the unrefined residuals already rule an exact fit out.
  if (!(ssr1 > 1e8 * floor1 * floor1)) {
    const g = new Float64Array(L);
    for (const z of zuOf(e1)) for (let a = 0; a < L; a++) g[a] += z[a];
    const dlt = mv(s1.B, g, k, L);
    const bR = Float64Array.from(s1.b, (v, j) => v + dlt[j]);
    const eR = residuals(bR);
    let ssr = 0;
    blocks.forEach((bl, i) => {
      for (let r = 0; r < bl.nd; r++) ssr += eR[i][r] * eR[i][r];
    });
    let floor = des.magY;
    for (let j = 0; j < k; j++) floor += Math.abs(bR[j]) * des.magX[j];
    floor *= EXACT_K * EPS;
    if (!(ssr > floor * floor)) throw new GmmRefusal(EXACT_FIT_DIFF);
  }
  const zu1 = zuOf(e1);
  const S1 = outerSum(zu1);
  const V1 = sandwich(s1.B, S1);
  // The two-step weight is S⁻¹ for the moment covariance S = Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ. When S is singular (rank below the
  // instrument count: always with fewer groups than instruments, as S is a sum of one outer product per group), any
  // generalized inverse is an arbitrary choice and the two-step estimate and Hansen J change with the basis of the
  // instruments (a reparametrization that leaves one-step GMM and Sargan unchanged), so two-step is refused by name.
  const W2i = N < L ? null : symInverse(S1, L);
  const rankS = W2i ? W2i.rank : -1;
  // The one-step estimate stays valid (and is reported), so the remedy is for two-step only.
  const remedy = "for a two-step estimate, collapse the instruments or set a lower last lag";
  let twoWhy: string | undefined;
  let twoShort: string | undefined;
  if (!W2i) {
    twoWhy =
      `the two-step weight matrix would be singular: Σ Zᵢᵀû₁ᵢû₁ᵢᵀZᵢ, one outer product per group, has rank at most the ${intText(N)} ${plural(N, "group")}, fewer than the ${intText(L)} instruments, ` +
      `so the two-step estimate and Hansen J would depend on an arbitrary choice of generalized inverse (the instruments' basis); ${remedy}`;
    twoShort = `two-step weight singular: ${intText(L)} instruments, ${intText(N)} ${plural(N, "group")}`;
  } else if (W2i.rank < L) {
    twoWhy =
      `the two-step weight matrix is singular (rank ${intText(W2i.rank)} for ${intText(L)} instruments, although the ${intText(N)} groups outnumber the instruments: some combination of the instruments is (nearly) uncorrelated with the one-step residuals in every group, for example a column that is zero in almost every row), ` +
      `so the two-step estimate and Hansen J would depend on an arbitrary choice of generalized inverse (the instruments' basis); ${remedy}`;
    twoShort = `two-step weight singular: rank ${intText(W2i.rank)} for ${intText(L)} instruments`;
  }
  const W2 = W2i && !twoWhy ? W2i.inv : new Float64Array(0);
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
    const a = new Float64Array(k * L);
    blocks.forEach((bl, i) => {
      const zc = dot(zu1[i], c);
      a.fill(0);
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
  if (!twoWhy) {
    try {
      twoRes = computeTwo();
    } catch (e) {
      if (!(e instanceof GmmRefusal)) throw e;
      // Name the actual cause: a singular weighted cross-product despite a full-rank weight, or whatever else refused
      // (passed through).
      if (e instanceof SingularSolve) {
        twoWhy =
          "XᵀZ W₂ ZᵀX is singular: weighted by the one-step residuals, the instruments do not identify every coefficient; " +
          "use one-step, collapse the instruments, or drop a regressor";
        twoShort = "two-step not identified";
      } else {
        twoWhy = e.message.replace(/\.$/, "").replace(/^./, (ch) => ch.toLowerCase());
        twoShort = "two-step not computed";
      }
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
  const lastPeriod = blocks.reduce((mx, b) => Math.max(mx, b.dPeriods.length ? b.dPeriods[b.dPeriods.length - 1] : 0), 0);
  const arTests = (res: Float64Array[], zu: Float64Array[], B: Float64Array, V: Float64Array): ArTest[] => {
    const out: ArTest[] = [];
    for (let m = 1; m <= 2; m++) {
      let d0 = 0;
      let d1 = 0;
      let pairs = 0;
      const EX = new Float64Array(k);
      const t3 = new Float64Array(L);
      // Row of each differenced period in the block (−1: none), reused across blocks.
      const posOf = new Int32Array(lastPeriod + 1).fill(-1);
      const wx = new Float64Array(k);
      blocks.forEach((bl, i) => {
        const e = res[i];
        bl.dPeriods.forEach((t, r) => (posOf[t] = r));
        let wu = 0;
        wx.fill(0);
        bl.dPeriods.forEach((t, r) => {
          const pr = t - m >= 0 ? posOf[t - m] : -1;
          if (pr < 0) return;
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
        bl.dPeriods.forEach((t) => (posOf[t] = -1));
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
  // The constant (system GMM) back on the raw columns: b_c = b̃_c + m_y − Σ mⱼb̃ⱼ, Var = qᵀṼq with q = e_c − Σ mⱼeⱼ.
  const cI = des.constIdx;
  const mapB = (b: Float64Array): Float64Array => {
    if (cI < 0) return b;
    const out = Float64Array.from(b);
    let s = des.mY;
    for (let j = 0; j < k; j++) s -= des.mX[j] * b[j];
    out[cI] += s;
    return out;
  };
  const mapSe = (V: Float64Array): Float64Array => {
    const s = se(V);
    if (cI < 0) return s;
    let v = 0;
    for (let i = 0; i < k; i++) {
      const qi = i === cI ? 1 : -des.mX[i];
      if (qi === 0) continue;
      for (let j = 0; j < k; j++) {
        const qj = j === cI ? 1 : -des.mX[j];
        if (qj !== 0) v += qi * qj * V[i * k + j];
      }
    }
    s[cI] = Math.sqrt(Math.max(v, 0));
    return s;
  };
  const one: DynStep = { b: mapB(s1.b), se: mapSe(V1), ar: arTests(e1, zu1, s1.B, V1) };
  const two: DynStep | null = twoRes
    ? { b: mapB(twoRes.s2.b), se: mapSe(twoRes.Vc), seUncorrected: mapSe(twoRes.V2), ar: arTests(twoRes.e2, twoRes.zu2, twoRes.s2.B, twoRes.Vc) }
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
    twoShort,
    hansen,
    hansenP: df > 0 && Number.isFinite(hansen) ? chiSquareP(Math.max(hansen, 0), df) : NaN,
    sargan,
    sarganP: df > 0 && Number.isFinite(sargan) ? chiSquareP(Math.max(sargan, 0), df) : NaN,
    singularA1: A1i.generalized,
    singularS: !W2i || W2i.rank < L,
    rankA1: A1i.rank,
    rankS,
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
  // The usable rows once (entity, period, raw response and terms), so the later passes only read typed arrays.
  const cap = N * T;
  const rg = new Int32Array(cap);
  const rt = new Int32Array(cap);
  const ry = new Float64Array(cap);
  const rx = new Float64Array(cap * kt);
  let n = 0;
  for (let g = 0; g < N; g++)
    for (let t = 0; t < T; t++) {
      const yv = ySer[g][t];
      if (Number.isNaN(yv)) continue;
      let ok = true;
      for (let j = 0; j < kt && ok; j++) {
        const tt = t - spec.terms[j].lag;
        const v = tt < 0 ? NaN : tSer[j][g][tt];
        if (Number.isNaN(v)) ok = false;
        else rx[n * kt + j] = v;
      }
      if (!ok) continue;
      rg[n] = g;
      rt[n] = t;
      ry[n] = yv;
      n++;
    }
  // Recentering first (exact: the constant, or each entity's effect, absorbs it): the response and the terms lose
  // their global means (OLS) or their entity means (FE), so large levels do not cancel inside the cross-products.
  const shY = new Float64Array(N);
  const shX = new Float64Array(N * kt);
  {
    const cn = new Int32Array(N);
    for (let i = 0; i < n; i++) {
      const g = within ? rg[i] : 0;
      cn[g]++;
      shY[g] += ry[i];
      for (let j = 0; j < kt; j++) shX[g * kt + j] += rx[i * kt + j];
    }
    for (let g = 0; g < (within ? N : 1); g++)
      if (cn[g]) {
        shY[g] /= cn[g];
        for (let j = 0; j < kt; j++) shX[g * kt + j] /= cn[g];
      }
    if (!within)
      for (let g = 1; g < N; g++) {
        shY[g] = shY[0];
        for (let j = 0; j < kt; j++) shX[g * kt + j] = shX[j];
      }
  }
  // Row i's columns: the kt terms (recentered), its dummy, the constant (OLS).
  const x = new Float64Array(p0);
  const idx = new Int32Array(kt + 2);
  let ni = 0;
  const rowOf = (i: number): number => {
    const g = rg[i];
    ni = 0;
    for (let j = 0; j < kt; j++) {
      x[j] = rx[i * kt + j] - shX[g * kt + j];
      idx[ni++] = j;
    }
    if (td) {
      x[kt + rt[i]] = 1;
      idx[ni++] = kt + rt[i];
    }
    if (!within) {
      x[p0 - 1] = 1;
      idx[ni++] = p0 - 1;
    }
    return ry[i] - shY[g];
  };
  for (let i = 0; i < n; i++) {
    const g = rg[i];
    const yv = rowOf(i);
    cnt[g]++;
    sy[g] += yv;
    for (let q = 0; q < ni; q++) {
      const a = idx[q];
      Xy[a] += x[a] * yv;
      sx[g * p0 + a] += x[a];
      for (let r = 0; r < ni; r++) G0[a * p0 + idx[r]] += x[a] * x[idx[r]];
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
  // Residuals and cluster scores (FE residuals are within-entity deviations).
  const sums = new Float64Array(N * p);
  const posOf = new Int32Array(p0).fill(-1);
  kept.forEach((c, a) => (posOf[c] = a));
  const meanFit = new Float64Array(N);
  if (within)
    for (let g = 0; g < N; g++) {
      if (!cnt[g]) continue;
      let mf = 0;
      for (let a = 0; a < p0; a++) mf += (sx[g * p0 + a] / cnt[g]) * bFull[a];
      meanFit[g] = sy[g] / cnt[g] - mf;
    }
  for (let i = 0; i < n; i++) {
    const g = rg[i];
    const yv = rowOf(i);
    let fit = 0;
    for (let q = 0; q < ni; q++) fit += x[idx[q]] * bFull[idx[q]];
    const e = yv - fit - meanFit[g];
    for (let q = 0; q < ni; q++) {
      const a = idx[q];
      if (posOf[a] >= 0) sums[g * p + posOf[a]] += x[a] * e;
    }
    if (td) x[kt + rt[i]] = 0;
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
