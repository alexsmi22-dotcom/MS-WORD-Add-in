/**
 * Ordinary least squares for publication (Release E2): the fit under every standard-error type an economics
 * referee asks for, the model statistics, and the specification diagnostics, as a FittedModel (regModel.ts) the
 * publication table (regTable.ts) can set beside other models.
 *
 * STANDARD ERRORS (the brief's conventions, checked against statsmodels 0.15 with use_t=True):
 *   classical  s²(XᵀX)⁻¹, s² = SSE/(n − k)
 *   HC0–HC3    White's sandwich with ω = e², e²·n/(n − k) ("HC1 (Stata robust)"), e²/(1 − h), e²/(1 − h)²
 *   clustered  Σ_g u_g u_gᵀ, u_g = Σ_{i∈g} e_i x_i, times Stata's G/(G − 1)·(N − 1)/(N − K); t with G − 1 df
 *   HAC        Newey–West: Bartlett weights 1 − l/(L + 1), lag L given or floor(4(n/100)^(2/9)), times n/(n − k)
 *              (Stata's `newey` and statsmodels cov_type="HAC", use_correction=True agree); t with n − k df
 * HC uses the t(n − k) reference as Stata's `regress, vce(robust)` does.
 *
 * NUMERICS. A thin Householder QR on unit-norm columns: least squares is scale-equivariant, so a predictor in
 * picomolar or in dollars of GDP must change nothing but its own slope, and the rank test on unit-norm columns is
 * dimensionless. lib/linalg.ts qrDecompose forms the full n×n Q (50,000 rows would be 2.5×10⁹ entries) and
 * lib/regression.ts leastSquares answers rank deficiency with a bare null, so neither is reused; every sandwich
 * is assembled in the scaled space and unscaled once at the end. Never the normal equations: Longley's design is
 * exactly the case where forming XᵀX loses the digits.
 */
import type { FittedModel, ModelStat, ModelTerm } from "./regModel";
import { tTestP, fTestP, tCritical } from "./stats";
import { chiSquareP } from "./stats2";

export type SeType = "classical" | "hc0" | "hc1" | "hc2" | "hc3" | "cluster" | "hac";

export const SE_TYPES: { value: SeType; label: string }[] = [
  { value: "classical", label: "Classical" },
  { value: "hc0", label: "HC0" },
  { value: "hc1", label: "HC1 (Stata robust)" },
  { value: "hc2", label: "HC2" },
  { value: "hc3", label: "HC3" },
  { value: "cluster", label: "Clustered" },
  { value: "hac", label: "Newey–West HAC" },
];

export interface OlsInput {
  y: ArrayLike<number>;
  depName: string;
  /** Predictor columns WITHOUT the constant, each of length n. */
  X: ArrayLike<number>[];
  names: string[];
  /** Include a constant (it is placed LAST, the Stata/esttab convention). */
  constant: boolean;
  se: SeType;
  /** The cluster of each row (clustered SEs). */
  clusters?: ArrayLike<string>;
  clusterName?: string;
  /** Newey–West lag; undefined → floor(4(n/100)^(2/9)). */
  hacLag?: number;
}

/** Everything the diagnostics need from a fit, kept so they never refit the main model. */
interface QrFactor {
  n: number;
  p: number;
  /** Householder vectors: v[k] has length n; entries < k are zero. */
  v: Float64Array[];
  vtv: Float64Array;
  /** R (p×p, upper triangular) of the SCALED design. */
  R: number[][];
}

export interface OlsFit {
  ok: true;
  model: FittedModel;
  fitted: Float64Array;
  resid: Float64Array;
  /** Wald F under the chosen SE type, or null when it cannot be formed (with the reason). */
  f: { value: number; df1: number; df2: number; p: number } | null;
  fWhy?: string;
  r2: number;
  adjR2: number;
  sse: number;
  /** Internal state for olsDiagnostics. */
  internal: {
    y: Float64Array;
    /** Scaled design columns (unit norm), constant last when present. */
    xs: Float64Array[];
    colScale: Float64Array;
    hasConst: boolean;
    qr: QrFactor;
    /** (XsᵀXs)⁻¹ in the scaled space. */
    ainv: number[][];
    predNames: string[];
  };
}

export type OlsResult = OlsFit | { ok: false; reason: string };

/** Newey–West's rule-of-thumb lag, floor(4(n/100)^(2/9)) (Stata's and statsmodels' common default). */
export function hacDefaultLag(n: number): number {
  return Math.max(0, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
}

/** Rank tolerance on unit-norm columns: a column whose part outside the earlier columns is this small is collinear. */
const RANK_TOL = 1e-10;

const q = (s: string): string => `“${s}”`;

/**
 * Householder QR of unit-norm columns, in place. `skip` (auxiliary regressions) drops a collinear column instead of
 * stopping; otherwise the first collinear column's index is returned.
 */
function householder(
  cols: Float64Array[],
  n: number,
  skip: boolean,
): { qr: QrFactor; kept: number[]; failAt: number } {
  const v: Float64Array[] = [];
  const vtvArr: number[] = [];
  const kept: number[] = [];
  const Rcols: Float64Array[] = []; // R column j (length = kept so far + 1)
  for (let j = 0; j < cols.length; j++) {
    const a = Float64Array.from(cols[j]);
    // Apply the reflectors so far.
    for (let k = 0; k < v.length; k++) applyReflector(v[k], vtvArr[k], k, a, n);
    const k = v.length;
    let norm = 0;
    for (let i = k; i < n; i++) norm += a[i] * a[i];
    norm = Math.sqrt(norm);
    if (!(norm > RANK_TOL) || k >= n) {
      if (skip) continue;
      return { qr: { n, p: k, v, vtv: Float64Array.from(vtvArr), R: upperFrom(Rcols) }, kept, failAt: j };
    }
    const alpha = a[k] > 0 ? -norm : norm;
    const vk = new Float64Array(n);
    vk[k] = a[k] - alpha;
    for (let i = k + 1; i < n; i++) vk[i] = a[i];
    let vv = 0;
    for (let i = k; i < n; i++) vv += vk[i] * vk[i];
    v.push(vk);
    vtvArr.push(vv);
    const rc = new Float64Array(k + 1);
    for (let i = 0; i < k; i++) rc[i] = a[i];
    rc[k] = alpha;
    Rcols.push(rc);
    kept.push(j);
  }
  return { qr: { n, p: v.length, v, vtv: Float64Array.from(vtvArr), R: upperFrom(Rcols) }, kept, failAt: -1 };
}

/** The p×p upper-triangular R from its columns. */
function upperFrom(Rcols: Float64Array[]): number[][] {
  const p = Rcols.length;
  const R: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let j = 0; j < p; j++) for (let i = 0; i <= j; i++) R[i][j] = Rcols[j][i];
  return R;
}

function applyReflector(vk: Float64Array, vv: number, k: number, a: Float64Array, n: number): void {
  if (vv === 0) return;
  let dot = 0;
  for (let i = k; i < n; i++) dot += vk[i] * a[i];
  const f = (2 * dot) / vv;
  if (f === 0) return;
  for (let i = k; i < n; i++) a[i] -= f * vk[i];
}

/** Qᵀb for the factor (a copy). */
function qtApply(qr: QrFactor, b: ArrayLike<number>): Float64Array {
  const a = Float64Array.from(b as ArrayLike<number>);
  for (let k = 0; k < qr.p; k++) applyReflector(qr.v[k], qr.vtv[k], k, a, qr.n);
  return a;
}

/** Inverse of an upper-triangular matrix. */
function invUpper(R: number[][]): number[][] {
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

/** Back-substitution R b = z (first p entries of z). */
function backSolve(R: number[][], z: ArrayLike<number>): number[] {
  const p = R.length;
  const b = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = z[i];
    for (let j = i + 1; j < p; j++) s -= R[i][j] * b[j];
    b[i] = s / R[i][i];
  }
  return b;
}

/** A·M·A for symmetric p×p A and M. */
function sandwich(A: number[][], M: number[][]): number[][] {
  const p = A.length;
  const AM: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let k = 0; k < p; k++) {
      const a = A[i][k];
      if (a === 0) continue;
      for (let j = 0; j < p; j++) AM[i][j] += a * M[k][j];
    }
  const out: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += AM[i][k] * A[k][j];
      out[i][j] = s;
    }
  return out;
}

/** Solves S x = b for symmetric positive-definite S (Cholesky); null when S is not positive definite. */
function cholSolve(S: number[][], b: number[]): number[] | null {
  const m = S.length;
  const L: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  let maxDiag = 0;
  for (let i = 0; i < m; i++) maxDiag = Math.max(maxDiag, Math.abs(S[i][i]));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let s = S[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 1e-13 * maxDiag)) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  const yv = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * yv[k];
    yv[i] = s / L[i][i];
  }
  const x = new Array<number>(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let s = yv[i];
    for (let k = i + 1; k < m; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** Names a perfect-collinearity refusal: the failing column, and the earlier columns it is a combination of. */
function collinearityReason(
  qr: QrFactor,
  xs: Float64Array[],
  failAt: number,
  names: string[],
  hasConst: boolean,
  rawCol: ArrayLike<number>,
): string {
  const name = names[failAt];
  const p = qr.p; // the columns before failAt, all kept
  // A constant column (all values equal) beside the constant.
  let allSame = true;
  for (let i = 1; i < rawCol.length; i++)
    if (rawCol[i] !== rawCol[0]) {
      allSame = false;
      break;
    }
  if (allSame && hasConst) {
    return (
      `${q(name)} is constant (every value is ${String(rawCol[0]).replace(/^-/, "−")}), so it is perfectly collinear ` +
      'with the constant. Remove it, or choose "no constant".'
    );
  }
  if (allSame && rawCol[0] === 0) return `${q(name)} is zero in every row, so it carries no information. Remove it.`;
  if (p === 0) return `${q(name)} carries no information. Remove it.`;
  // Weights of the earlier columns: R[0:p,0:p] w = (Qᵀ a)[0:p].
  const qa = qtApply(qr, xs[failAt]);
  const w = backSolve(qr.R, qa);
  const partners: string[] = [];
  for (let j = 0; j < p; j++) if (Math.abs(w[j]) > 1e-7) partners.push(names[j]);
  if (!partners.length) return `${q(name)} carries no information. Remove it.`;
  const list = partners.map(q);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  if (partners.length === 1 && partners[0] === "Constant") {
    return `${q(name)} is perfectly collinear with the constant. Remove it, or choose "no constant".`;
  }
  return (
    `Perfect collinearity: ${q(name)} is an exact linear combination of ${joined}, so their separate effects ` +
    `cannot be estimated. Drop ${q(name)} or one of the others.`
  );
}

/** Fits OLS under the chosen standard-error type. */
export function fitOls(input: OlsInput): OlsResult {
  const n = input.y.length;
  const k0 = input.X.length;
  const hasConst = input.constant;
  const p = k0 + (hasConst ? 1 : 0);
  if (input.names.length !== k0) return { ok: false, reason: "Each predictor needs a name." };
  if (p === 0) return { ok: false, reason: 'The model has no regressors: add a predictor, or include the constant.' };
  for (const c of input.X) if (c.length !== n) return { ok: false, reason: "Every column needs the same number of rows." };
  if (n <= p) {
    return {
      ok: false,
      reason:
        `n = ${n} observation${n === 1 ? "" : "s"} for ${p} coefficient${p === 1 ? "" : "s"}: OLS needs more ` +
        "observations than coefficients (n > k), or the residual variance has no degrees of freedom.",
    };
  }
  const y = Float64Array.from(input.y);
  for (let i = 0; i < n; i++) if (!Number.isFinite(y[i])) return { ok: false, reason: `${q(input.depName)}, row ${i + 1}: not a finite number.` };
  const names = [...input.names, ...(hasConst ? ["Constant"] : [])];
  // HOT LOOPS LIVE IN SMALL HELPERS (columnSums, scaleColumn, fitResiduals, hacMeat, clusterMeat): V8 optimises a
  // small function quickly, while a loop inside this long one ran interpreted (measured: 200 ms of a 300 ms fit at
  // 50,000 × 20 before the move).
  const raw: Float64Array[] = [...input.X.map((c) => Float64Array.from(c)), ...(hasConst ? [new Float64Array(n).fill(1)] : [])];
  for (let j = 0; j < k0; j++) {
    const bad = firstNonFinite(raw[j]);
    if (bad >= 0) return { ok: false, reason: `${q(names[j])}, row ${bad + 1}: not a finite number.` };
  }

  // CENTRED, unit-norm columns. With a constant the predictors are centred first: the same column space, so the
  // fitted values, residuals, slopes and every slope covariance are unchanged (each SE type is equivariant under the
  // reparametrisation), but the design loses the near-collinearity of a level with the constant (Longley's YEAR,
  // 1947–1962, is 99.6% constant). Without it the robust Wald F on Longley drifted 6×10⁻⁶ from the exact value.
  // The intercept and its covariances are mapped back at the end.
  const means = new Float64Array(k0);
  if (hasConst) for (let j = 0; j < k0; j++) means[j] = columnSum(raw[j]) / n;
  // The constant goes FIRST into the QR (so "x is collinear with the constant" names it), but is reported last.
  const order = hasConst ? [p - 1, ...Array.from({ length: k0 }, (_, j) => j)] : Array.from({ length: k0 }, (_, j) => j);
  const colScale = new Float64Array(p);
  const xs: Float64Array[] = new Array(p);
  for (let j = 0; j < p; j++) {
    const s = scaleColumn(raw[j], j < k0 && hasConst ? means[j] : 0);
    colScale[j] = s.scale;
    xs[j] = s.col;
  }
  const ordCols = order.map((j) => xs[j]);
  const { qr, failAt } = householder(ordCols, n, false);
  if (failAt >= 0) {
    const ordNames = order.map((j) => names[j]);
    return { ok: false, reason: collinearityReason(qr, ordCols, failAt, ordNames, hasConst, raw[order[failAt]]) };
  }
  // Coefficients in QR order → report order.
  const qty = qtApply(qr, y);
  const bOrd = backSolve(qr.R, qty);
  const RinvOrd = invUpper(qr.R);
  // (XsᵀXs)⁻¹ = R⁻¹R⁻ᵀ in QR order, then permuted to report order.
  const ainvOrd: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let l = Math.max(i, j); l < p; l++) s += RinvOrd[i][l] * RinvOrd[j][l];
      ainvOrd[i][j] = s;
      ainvOrd[j][i] = s;
    }
  const pos = new Array<number>(p); // report index → QR index
  order.forEach((rep, qi) => (pos[rep] = qi));
  const bs = Array.from({ length: p }, (_, j) => bOrd[pos[j]]);
  const A: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => ainvOrd[pos[i]][pos[j]]));
  const beta = bs.map((b, j) => b / colScale[j]);

  // Fitted values and residuals.
  const fitted = new Float64Array(n);
  for (let j = 0; j < p; j++) axpy(bs[j], xs[j], fitted);
  const resid = new Float64Array(n);
  const { sse, sst, yScale, maxRes } = residualStats(y, fitted, resid, hasConst);
  // EXACT FIT: residuals at rounding level of the data's scale. SE = 0, t and F are then rounding noise.
  if (maxRes <= 1e-10 * Math.max(yScale, Number.MIN_VALUE) || sse === 0) {
    return {
      ok: false,
      reason:
        `The data lie exactly on the fitted surface (every residual is rounding noise), so the standard errors are ` +
        `zero and t, F and their p-values are undefined. ${hasConst && sst === 0 ? `${q(input.depName)} is constant.` : "Check for a predictor that is a copy of the response."}`,
    };
  }
  const dfResid = n - p;
  const s2 = sse / dfResid;

  // Covariance in the SCALED space.
  let Vs: number[][];
  let df = dfResid;
  let seLabel = "";
  const notes: string[] = [];
  const se = input.se;
  if (se === "classical") {
    Vs = A.map((r) => r.map((v) => v * s2));
    seLabel = "Classical";
  } else if (se === "hc0" || se === "hc1" || se === "hc2" || se === "hc3") {
    const omega = new Float64Array(n);
    let lev: Float64Array | null = null;
    if (se === "hc2" || se === "hc3") {
      lev = leverages(xs, A, n, p);
      for (let i = 0; i < n; i++) {
        if (lev[i] > 1 - 1e-10) {
          return {
            ok: false,
            reason:
              `Row ${i + 1} has leverage 1 (the model fits it exactly whatever its value), so ${se.toUpperCase()} ` +
              "divides by 1 − h = 0. Use HC1, or drop that row.",
          };
        }
      }
    }
    hcWeights(resid, lev, se === "hc0" ? 0 : se === "hc1" ? 1 : se === "hc2" ? 2 : 3, n / dfResid, omega);
    const M = weightedCross(xs, omega, n, p);
    Vs = sandwich(A, M);
    seLabel = se === "hc1" ? "HC1 (Stata robust)" : se.toUpperCase();
    notes.push(
      se === "hc1"
        ? "Standard errors: HC1 (Stata robust), White's sandwich scaled by n/(n − k); t reference with n − k df."
        : `Standard errors: ${se.toUpperCase()} (White's sandwich${se === "hc0" ? "" : se === "hc2" ? ", e²/(1 − h)" : ", e²/(1 − h)²"}); t reference with n − k df, as Stata.`,
    );
  } else if (se === "cluster") {
    const cl = input.clusters;
    const cname = input.clusterName ?? "cluster";
    if (!cl || cl.length !== n) return { ok: false, reason: "Clustered standard errors need a cluster column." };
    const { gOf, G } = clusterIds(cl);
    if (G < 2) {
      return {
        ok: false,
        reason: `Clustered standard errors need at least two clusters; ${q(cname)} has one value in every row used.`,
      };
    }
    const M = clusterMeat(xs, resid, gOf, G);
    const c = (G / (G - 1)) * ((n - 1) / (n - p));
    Vs = sandwich(A, M).map((r) => r.map((v) => v * c));
    df = G - 1;
    seLabel = `Clustered by ${cname}, ${G} clusters`;
    notes.push(
      `Standard errors: clustered by ${cname} (${G} clusters), with Stata's finite-sample factor G/(G − 1)·(N − 1)/(N − K); ` +
        `t reference with G − 1 = ${G - 1} df.`,
    );
    if (G === n) notes.push("Every cluster holds one row, so this is the HC sandwich with the cluster factor.");
    if (G < 30) notes.push(`Only ${G} clusters: cluster-robust inference is unreliable with few clusters.`);
  } else {
    const L = input.hacLag === undefined ? hacDefaultLag(n) : input.hacLag;
    if (!Number.isInteger(L) || L < 0) return { ok: false, reason: "The Newey–West lag must be a whole number, 0 or more." };
    if (L >= n) return { ok: false, reason: `The Newey–West lag (${L}) must be less than the number of rows (${n}).` };
    const M = hacMeat(xs, resid, L);
    const c = n / dfResid;
    Vs = sandwich(A, M).map((r) => r.map((v) => v * c));
    seLabel = `Newey–West HAC, lag ${L}`;
    notes.push(
      `Standard errors: Newey–West HAC, Bartlett kernel, lag ${L}${input.hacLag === undefined ? " (the default: 4(n/100) to the power 2/9, rounded down)" : ""}, ` +
        "with the n/(n − k) correction and a t reference with n − k df, as Stata's newey; rows are taken in the order given as the time order.",
    );
  }

  // Back to the user's parametrisation: unscale, then map the centred intercept c₀ to b₀ = c₀ − Σ x̄ⱼbⱼ,
  // Var(b₀) = Var(c₀) − 2Σ x̄ⱼCov(c₀, bⱼ) + ΣΣ x̄ⱼx̄ₖCov(bⱼ, bₖ). Slopes are untouched.
  const V: number[][] = Vs.map((r, i) => r.map((v, j) => v / (colScale[i] * colScale[j])));
  if (hasConst) {
    const c0 = p - 1;
    let shift = 0;
    for (let j = 0; j < k0; j++) shift += means[j] * beta[j];
    beta[c0] -= shift;
    // Cov(b₀, bⱼ) = Cov(c₀, bⱼ) − Σₖ x̄ₖ Cov(bₖ, bⱼ)
    const covB0 = new Array<number>(k0).fill(0);
    for (let j = 0; j < k0; j++) {
      let s = V[c0][j];
      for (let kk = 0; kk < k0; kk++) s -= means[kk] * V[kk][j];
      covB0[j] = s;
    }
    let var0 = V[c0][c0];
    for (let j = 0; j < k0; j++) var0 -= 2 * means[j] * V[c0][j];
    for (let j = 0; j < k0; j++) for (let kk = 0; kk < k0; kk++) var0 += means[j] * means[kk] * V[j][kk];
    for (let j = 0; j < k0; j++) {
      V[c0][j] = covB0[j];
      V[j][c0] = covB0[j];
    }
    V[c0][c0] = var0;
  }

  // Terms.
  const tcrit = tCritical(0.05, df);
  const terms: ModelTerm[] = [];
  for (let j = 0; j < p; j++) {
    const seJ = Math.sqrt(Math.max(V[j][j], 0));
    const t = beta[j] / seJ;
    if (!(seJ > 0) || !Number.isFinite(t)) {
      return {
        ok: false,
        reason: `The standard error of ${q(names[j])} is zero under ${seLabel}, so its t statistic is undefined.`,
      };
    }
    const pv = tTestP(t, df);
    terms.push({ name: names[j], coef: beta[j], se: seJ, stat: t, p: pv, ciLo: beta[j] - tcrit * seJ, ciHi: beta[j] + tcrit * seJ });
  }

  // Wald F that every slope (every coefficient, without a constant) is zero, under the chosen covariance.
  const testIdx = Array.from({ length: hasConst ? k0 : p }, (_, j) => j);
  let f: OlsFit["f"] = null;
  let fWhy: string | undefined;
  const q1 = testIdx.length;
  if (q1 === 0) fWhy = "F is not reported: the model has only the constant.";
  else if (se === "cluster" && q1 > df) fWhy = `F is not reported: ${q1} restrictions exceed G − 1 = ${df} (as Stata).`;
  else {
    const Vsub = testIdx.map((a) => testIdx.map((b) => Vs[a][b]));
    const bsub = testIdx.map((a) => bs[a]);
    const x = cholSolve(Vsub, bsub);
    if (!x) fWhy = "F is not reported: the covariance of the slopes is singular.";
    else {
      let w = 0;
      for (let a = 0; a < q1; a++) w += bsub[a] * x[a];
      const fv = w / q1;
      f = { value: fv, df1: q1, df2: df, p: fTestP(fv, q1, df) };
    }
  }

  const r2 = 1 - sse / sst;
  const adjR2 = 1 - ((n - (hasConst ? 1 : 0)) / dfResid) * (1 - r2);
  const llf = (-n / 2) * (Math.log(2 * Math.PI) + Math.log(sse / n) + 1);
  const aic = -2 * llf + 2 * p;
  const bic = -2 * llf + p * Math.log(n);
  const stats: ModelStat[] = [
    { label: "R²", value: r2 },
    { label: "Adjusted R²", value: adjR2 },
  ];
  if (f) {
    stats.push({ label: "F", value: f.value });
    stats.push({ label: "Prob > F", value: f.p });
  }
  stats.push({ label: "Root MSE", value: Math.sqrt(s2) });
  stats.push({ label: "Log likelihood", value: llf });
  stats.push({ label: "AIC", value: aic });
  stats.push({ label: "BIC", value: bic });
  if (se === "classical") notes.unshift("Standard errors: classical (homoskedastic), t reference with n − k df.");
  if (!hasConst) notes.push("No constant: R² is uncentered (1 − SSE/Σy²), as statsmodels and Stata's noconstant report it.");
  notes.push("F is the Wald test that every slope is zero, under the chosen standard errors.");

  const model: FittedModel = {
    kind: "ols",
    depName: input.depName,
    n,
    terms,
    statLabel: "t",
    df,
    seLabel,
    stats,
    notes,
  };
  return {
    ok: true,
    model,
    fitted,
    resid,
    f,
    fWhy,
    r2,
    adjR2,
    sse,
    internal: { y, xs, colScale, hasConst, qr, ainv: A, predNames: input.names },
  };
}

/** h_i = xs_iᵀ A xs_i. */
function leverages(xs: Float64Array[], A: number[][], n: number, p: number): Float64Array {
  const h = new Float64Array(n);
  const row = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) row[j] = xs[j][i];
    let s = 0;
    for (let a = 0; a < p; a++) {
      let t = 0;
      const Ar = A[a];
      for (let b = 0; b < p; b++) t += Ar[b] * row[b];
      s += row[a] * t;
    }
    h[i] = s;
  }
  return h;
}

function firstNonFinite(c: Float64Array): number {
  for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) return i;
  return -1;
}

function columnSum(c: Float64Array): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s += c[i];
  return s;
}

/** (c − centre) / ‖c − centre‖, guarding the sum of squares against overflow (values near 10¹⁵⁴). */
function scaleColumn(c: Float64Array, centre: number): { col: Float64Array; scale: number } {
  const n = c.length;
  const col = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const v = c[i] - centre;
    col[i] = v;
    s += v * v;
  }
  s = Math.sqrt(s);
  if (!Number.isFinite(s)) {
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(col[i]));
    let t = 0;
    for (let i = 0; i < n; i++) t += (col[i] / m) * (col[i] / m);
    s = m * Math.sqrt(t);
  }
  const scale = s > 0 && Number.isFinite(s) ? s : 1;
  for (let i = 0; i < n; i++) col[i] /= scale;
  return { col, scale };
}

/** out += a·x */
function axpy(a: number, x: Float64Array, out: Float64Array): void {
  for (let i = 0; i < x.length; i++) out[i] += a * x[i];
}

/** Fills resid = y − fitted; returns SSE, SST (centred with a constant), the data's scale and the largest |residual|. */
function residualStats(
  y: Float64Array,
  fitted: Float64Array,
  resid: Float64Array,
  hasConst: boolean,
): { sse: number; sst: number; yScale: number; maxRes: number } {
  const n = y.length;
  let sse = 0;
  let ySum = 0;
  let maxRes = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - fitted[i];
    resid[i] = e;
    sse += e * e;
    ySum += y[i];
    const a = Math.abs(e);
    if (a > maxRes) maxRes = a;
  }
  const yBar = ySum / n;
  let sst = 0;
  let yScale = 0;
  for (let i = 0; i < n; i++) {
    const d = hasConst ? y[i] - yBar : y[i];
    sst += d * d;
    yScale = Math.max(yScale, Math.abs(y[i] - yBar), Math.abs(y[i]) * 1e-6);
  }
  return { sse, sst, yScale, maxRes };
}

/** White's ω: e² (HC0), e²·n/(n − k) (HC1), e²/(1 − h) (HC2), e²/(1 − h)² (HC3). */
function hcWeights(resid: Float64Array, lev: Float64Array | null, kind: 0 | 1 | 2 | 3, hc1: number, out: Float64Array): void {
  for (let i = 0; i < resid.length; i++) {
    const e2 = resid[i] * resid[i];
    if (kind === 0) out[i] = e2;
    else if (kind === 1) out[i] = e2 * hc1;
    else {
      const m = 1 - lev![i];
      out[i] = kind === 2 ? e2 / m : e2 / (m * m);
    }
  }
}

/** Dense cluster ids in order of first appearance. */
function clusterIds(cl: ArrayLike<string>): { gOf: Int32Array; G: number } {
  const ids = new Map<string, number>();
  const gOf = new Int32Array(cl.length);
  for (let i = 0; i < cl.length; i++) {
    const key = String(cl[i]);
    let g = ids.get(key);
    if (g === undefined) {
      g = ids.size;
      ids.set(key, g);
    }
    gOf[i] = g;
  }
  return { gOf, G: ids.size };
}

/** Σ_g u_g u_gᵀ, u_g = Σ_{i∈g} e_i x_i (scaled columns). */
function clusterMeat(xs: Float64Array[], resid: Float64Array, gOf: Int32Array, G: number): number[][] {
  const p = xs.length;
  const n = resid.length;
  const U = new Float64Array(G * p);
  for (let j = 0; j < p; j++) {
    const c = xs[j];
    for (let i = 0; i < n; i++) U[gOf[i] * p + j] += resid[i] * c[i];
  }
  const M: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let g = 0; g < G; g++) {
    const o = g * p;
    for (let a = 0; a < p; a++) {
      const ua = U[o + a];
      const row = M[a];
      for (let b = 0; b < p; b++) row[b] += ua * U[o + b];
    }
  }
  return M;
}

/** Newey–West meat: Γ₀ + Σ_{l=1..L} (1 − l/(L+1))(Γ_l + Γ_lᵀ), Γ_l = Σ_t s_t s_{t−l}ᵀ, s_t = e_t x_t. */
function hacMeat(xs: Float64Array[], resid: Float64Array, L: number): number[][] {
  const p = xs.length;
  const n = resid.length;
  const S = new Float64Array(n * p);
  for (let j = 0; j < p; j++) {
    const c = xs[j];
    for (let i = 0; i < n; i++) S[i * p + j] = resid[i] * c[i];
  }
  // M = A + Aᵀ with A = Σ_t s_t z_tᵀ, z_t = ½s_t + Σ_l w_l s_{t−l}: the same sum in n(pL + p²) operations instead of
  // n·p²·(L + 1) (50,000 × 21 at lag 15: about 60 million, not 350 million).
  const A = new Float64Array(p * p);
  const z = new Float64Array(p);
  const w = new Float64Array(L + 1);
  for (let l = 1; l <= L; l++) w[l] = 1 - l / (L + 1);
  for (let t = 0; t < n; t++) {
    const o = t * p;
    for (let b = 0; b < p; b++) z[b] = 0.5 * S[o + b];
    const top = Math.min(L, t);
    for (let l = 1; l <= top; l++) {
      const wl = w[l];
      const ol = (t - l) * p;
      for (let b = 0; b < p; b++) z[b] += wl * S[ol + b];
    }
    for (let a = 0; a < p; a++) {
      const sa = S[o + a];
      if (sa === 0) continue;
      const ra = a * p;
      for (let b = 0; b < p; b++) A[ra + b] += sa * z[b];
    }
  }
  return Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => A[a * p + b] + A[b * p + a]));
}

/** Σ ω_i x_i x_iᵀ over the scaled columns. */
function weightedCross(xs: Float64Array[], omega: Float64Array, n: number, p: number): number[][] {
  const M: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a++) {
    const ca = xs[a];
    for (let b = a; b < p; b++) {
      const cb = xs[b];
      let s = 0;
      for (let i = 0; i < n; i++) s += omega[i] * ca[i] * cb[i];
      M[a][b] = s;
      M[b][a] = s;
    }
  }
  return M;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------------------------

export type DiagTest = { stat: number; df: number; p: number } | { skipped: string };
export type DiagF = { f: number; df1: number; df2: number; p: number } | { skipped: string };

export interface OlsDiagnostics {
  durbinWatson: number;
  /** Breusch–Pagan, Koenker's studentized LM (statsmodels het_breuschpagan robust=True). */
  breuschPagan: DiagTest;
  /** White's test (statsmodels het_white): LM = n·R² of e² on the levels, squares and cross products. */
  white: DiagTest;
  /** VIF per predictor (the constant's is not shown). */
  vif: { name: string; vif: number }[];
  /** Ramsey RESET with ŷ² and ŷ³, F form. */
  reset: DiagF;
  jarqueBera: { jb: number; p: number; skew: number; kurtosis: number };
  notes: string[];
}

/** White's test is computed for at most this many predictors (its auxiliary regression has (k+1)(k+2)/2 columns). */
export const WHITE_MAX_PREDICTORS = 10;

/** SSE of b regressed on the factor's columns (its residual sum of squares). */
function residualSS(qr: QrFactor, b: ArrayLike<number>): { tail: Float64Array; sse: number } {
  const a = qtApply(qr, b);
  let s = 0;
  for (let i = qr.p; i < qr.n; i++) s += a[i] * a[i];
  return { tail: a, sse: s };
}

function centeredSS(b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < b.length; i++) m += b[i];
  m /= b.length;
  let s = 0;
  for (let i = 0; i < b.length; i++) s += (b[i] - m) * (b[i] - m);
  return s;
}

/** The specification diagnostics of a fit (all computed on the classical OLS residuals, whatever the SE type). */
export function olsDiagnostics(fit: OlsFit): OlsDiagnostics {
  const { y, xs, hasConst, qr, ainv, predNames } = fit.internal;
  const e = fit.resid;
  const n = e.length;
  const p = xs.length;
  const k0 = predNames.length;
  const notes: string[] = [];

  // Durbin–Watson, rows in the order given.
  let num = 0;
  for (let i = 1; i < n; i++) num += (e[i] - e[i - 1]) * (e[i] - e[i - 1]);
  const durbinWatson = num / fit.sse;

  // Breusch–Pagan (Koenker): n·R² of e² on X, chi-square with k − 1 df.
  const e2 = new Float64Array(n);
  for (let i = 0; i < n; i++) e2[i] = e[i] * e[i];
  let breuschPagan: DiagTest;
  const sstE2 = centeredSS(e2);
  if (!hasConst) breuschPagan = { skipped: "needs a model with a constant" };
  else if (k0 === 0) breuschPagan = { skipped: "the model has no predictors" };
  else if (!(sstE2 > 0)) breuschPagan = { skipped: "the squared residuals do not vary" };
  else {
    const { sse } = residualSS(qr, e2);
    const lm = n * (1 - sse / sstE2);
    breuschPagan = { stat: lm, df: k0, p: chiSquareP(lm, k0) };
  }

  // White: levels, squares and cross products (the constant times itself is the constant).
  let white: DiagTest;
  const auxCount = ((k0 + 1) * (k0 + 2)) / 2;
  if (!hasConst) white = { skipped: "needs a model with a constant" };
  else if (k0 === 0) white = { skipped: "the model has no predictors" };
  else if (k0 > WHITE_MAX_PREDICTORS) white = { skipped: `computed for up to ${WHITE_MAX_PREDICTORS} predictors (its auxiliary regression would have ${auxCount} columns)` };
  else if (auxCount >= n) white = { skipped: `needs more rows than its ${auxCount} auxiliary regressors (n = ${n})` };
  else if (!(sstE2 > 0)) white = { skipped: "the squared residuals do not vary" };
  else {
    // xs has the constant last; aux = the triu products of [x1..xk, 1].
    const cols: Float64Array[] = [];
    for (let a = 0; a < p; a++)
      for (let b = a; b < p; b++) {
        const c = new Float64Array(n);
        const ca = xs[a];
        const cb = xs[b];
        let s = 0;
        for (let i = 0; i < n; i++) {
          c[i] = ca[i] * cb[i];
          s += c[i] * c[i];
        }
        s = Math.sqrt(s);
        if (s > 0) for (let i = 0; i < n; i++) c[i] /= s;
        cols.push(c);
      }
    // The constant column first so the dependent duplicates (x² of a 0/1 dummy) are the ones dropped.
    const constIdx = cols.length - 1;
    const ordered = [cols[constIdx], ...cols.slice(0, constIdx)];
    const { qr: wq } = householder(ordered, n, true);
    const { sse } = residualSS(wq, e2);
    const lm = n * (1 - sse / sstE2);
    const df = wq.p - 1;
    white = { stat: lm, df, p: chiSquareP(lm, df) };
    if (wq.p < cols.length) notes.push(`White's test: ${cols.length - wq.p} auxiliary column(s) duplicated others and were dropped (df = ${df}).`);
  }

  // VIF_j = (XᵀX)⁻¹_jj · Σ(x_j − x̄)² (with a constant; Σx_j² without), the auxiliary R² identity.
  const vif = predNames.map((name, j) => ({ name, vif: ainv[j][j] * (hasConst ? centeredSS(xs[j]) : 1) }));
  if (!hasConst) notes.push("VIF without a constant uses the uncentered R², as statsmodels does on a design without one.");

  // RESET: add standardised ŷ² and ŷ³ (same column space as ŷ², ŷ³ when there is a constant).
  let reset: DiagF;
  const f = fit.fitted;
  let fm = 0;
  for (let i = 0; i < n; i++) fm += f[i];
  fm /= n;
  let fsd = 0;
  for (let i = 0; i < n; i++) fsd += (f[i] - (hasConst ? fm : 0)) ** 2;
  fsd = Math.sqrt(fsd / n);
  const df2 = n - p - 2;
  if (df2 < 1) reset = { skipped: "needs at least three more rows than coefficients" };
  else if (!(fsd > 0)) reset = { skipped: "the fitted values do not vary" };
  else {
    const z2 = new Float64Array(n);
    const z3 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const z = (f[i] - (hasConst ? fm : 0)) / fsd;
      z2[i] = z * z;
      z3[i] = z * z * z;
    }
    // Project the two new columns and y off X, then onto what is left of the new columns.
    const t2 = qtApply(qr, z2);
    const t3 = qtApply(qr, z3);
    const ty = qtApply(qr, y);
    const m = n - p;
    const u = new Float64Array(m);
    const w = new Float64Array(m);
    const r = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      u[i] = t2[p + i];
      w[i] = t3[p + i];
      r[i] = ty[p + i];
    }
    const norm2 = (a: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * a[i];
      return s;
    };
    const dotp = (a: Float64Array, b: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * b[i];
      return s;
    };
    const nu = Math.sqrt(norm2(u));
    // Original norms for the rank test of the new columns.
    const n2 = Math.sqrt(norm2(z2));
    if (!(nu > RANK_TOL * n2)) reset = { skipped: "ŷ² is collinear with the regressors" };
    else {
      for (let i = 0; i < m; i++) u[i] /= nu;
      const c = dotp(u, w);
      for (let i = 0; i < m; i++) w[i] -= c * u[i];
      const nw = Math.sqrt(norm2(w));
      if (!(nw > RANK_TOL * Math.sqrt(norm2(z3)))) reset = { skipped: "ŷ³ is collinear with the regressors" };
      else {
        for (let i = 0; i < m; i++) w[i] /= nw;
        const a1 = dotp(u, r);
        const a2 = dotp(w, r);
        const sseR = norm2(r);
        const sseU = sseR - a1 * a1 - a2 * a2;
        const fv = ((sseR - sseU) / 2) / (sseU / df2);
        reset = { f: fv, df1: 2, df2, p: fTestP(fv, 2, df2) };
      }
    }
  }

  // Jarque–Bera with the biased moments (statsmodels jarque_bera).
  let em = 0;
  for (let i = 0; i < n; i++) em += e[i];
  em /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = e[i] - em;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const skew = m3 / Math.pow(m2, 1.5);
  const kurtosis = m4 / (m2 * m2);
  const jb = (n / 6) * (skew * skew + ((kurtosis - 3) * (kurtosis - 3)) / 4);
  return {
    durbinWatson,
    breuschPagan,
    white,
    vif,
    reset,
    jarqueBera: { jb, p: chiSquareP(jb, 2), skew, kurtosis },
    notes,
  };
}
