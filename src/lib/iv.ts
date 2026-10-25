/**
 * Instrumental variables, two-stage least squares (Release E4a), with the first stage, the endogeneity and
 * overidentification tests, as linearmodels 7.1 computes them (IV2SLS, iv/model.py, iv/covariance.py, iv/results.py;
 * NCSA licence, Copyright (c) 2017 Kevin Sheppard; the diagnostic constructions are ported, see THIRD_PARTY_LICENSES.md).
 *
 * THE ESTIMATOR. With X = [endogenous, exogenous, constant] and Z = [constant, exogenous, excluded instruments],
 * X̂ = P_Z X (the exogenous columns and the constant are their own fitted values) and β = (X̂ᵀX̂)⁻¹X̂ᵀy. The residuals
 * are e = y − Xβ with the ACTUAL X, never y − X̂β (OLS on X̂ gives the right β and the wrong σ² and SEs).
 *
 * COVARIANCES (linearmodels' classes, A = (X̂ᵀX̂)⁻¹, k = number of coefficients):
 *   classical  σ²·A, σ² = eᵀe/n (large-sample, linearmodels' default, Stata ivregress) or eᵀe/(n − k) (small-sample:
 *              linearmodels debiased=True, Stata ivregress …, small)
 *   HC0        A (Σ eᵢ² x̂ᵢx̂ᵢᵀ) A                (linearmodels cov_type="robust", debiased=False)
 *   HC1        the same times n/(n − k)          (linearmodels cov_type="robust", debiased=True)
 *   clustered  A (Σ_g ξ_g ξ_gᵀ) A, ξ_g = Σ_{i∈g} eᵢx̂ᵢ, with NO finite-sample factor in large-sample mode (linearmodels'
 *              debiased=False applies none) and G/(G − 1)·(n − 1)/(n − k) in small-sample mode (debiased=True)
 * Reference distribution: z (normal) in large-sample mode, t with n − k df in small-sample mode (linearmodels uses
 * n − k even for clustered SEs; Stata's regress uses G − 1). HC0/HC1 fix the robust scale whichever reference is
 * chosen; the reference select also sets the classical σ² and the cluster factor, as debiased does in linearmodels.
 *
 * NUMERICS. Every non-constant column is centred when there is a constant (an exact reparameterisation: the constant
 * is in both X and Z) and scaled to unit norm; y is divided by a power of two. All projections are Householder QR
 * (no normal equations, no explicit inverse of a cross-product of data columns). The intercept and every coefficient
 * in the user's units are linear functionals of the scaled coefficients.
 */
import type { FittedModel, ModelStat, ModelTerm } from "./regModel";
import { tTestP, fTestP, tCritical } from "./stats";
import { chiSquareP } from "./stats2";
import { magnitudeReason } from "./olsInference";
import { intText, numText } from "./regTable";

export type IvSe = "classical" | "hc0" | "hc1" | "cluster";

/** Wall clock for one fit (as arima.ts ARIMA_WALL_MS): checked between the stages, refused by name past it. */
export const IV_WALL_MS = 6000;
/** At most this many columns in all (exogenous + endogenous + instruments). */
export const IV_MAX_COLUMNS = 40;
/**
 * Up-front work bound, in units of rows × (1,500 + (k + k_Z)² + k_endog·k_Z²): the per-row passes, the QR
 * factorisations and covariances, and one first-stage covariance per endogenous regressor. Measured on the build
 * machine at about 2.8–3.5 ns a unit (100,000 rows with 4 coefficients and 6 instruments: 0.41 s; 100,000 rows with
 * 10 + 10 regressors and 20 instruments, clustered: 3.9 s), so the largest admitted input runs in about 2 s.
 */
export const IV_MAX_WORK = 5e8;
/** The work units of a fit (see IV_MAX_WORK). */
export function ivWorkUnits(n: number, P: number, Pz: number, k2: number): number {
  return n * (1500 + (P + Pz) * (P + Pz) + k2 * Pz * Pz);
}
/** The 97.5% point of the standard normal. */
const Z975 = 1.959963984540054;
const EPS = Number.EPSILON;
const q = (s: string): string => `“${s}”`;

export interface IvInput {
  y: ArrayLike<number>;
  depName: string;
  exog: ArrayLike<number>[];
  exogNames: string[];
  endog: ArrayLike<number>[];
  endogNames: string[];
  instr: ArrayLike<number>[];
  instrNames: string[];
  constant: boolean;
  se: IvSe;
  /** Small-sample mode (linearmodels debiased=True): t(n − k), σ² = eᵀe/(n − k), the cluster factor. */
  small: boolean;
  clusters?: ArrayLike<string>;
  clusterName?: string;
  /** Clock (tests). */
  now?: () => number;
}

export interface IvTest {
  name: string;
  stat: number;
  df: number;
  /** Denominator df of an F statistic. */
  df2?: number;
  p: number;
  dist: "chi2" | "F";
  /** What the test assumes, printed beside it. */
  note: string;
}
export type IvDiag = IvTest | { name: string; skipped: string };

export interface IvFirstStage {
  endog: string;
  /** Coefficients on the excluded instruments, in the user's units, under the chosen SE type. */
  terms: ModelTerm[];
  /** "t" (small-sample) or "z". */
  statLabel: "t" | "z";
  df: number;
  r2: number;
  partialR2: number;
  /** The textbook non-robust partial F: s² = SSR/(n − k_Z), Wald/q, F(q, n − k_Z). */
  fClassical: { value: number; df1: number; df2: number; p: number };
  /** Under robust or clustered SEs: the robust Wald divided by q, p from χ²_q (linearmodels' f.stat is the Wald). */
  fRobust?: { value: number; df1: number; wald: number; p: number };
  /** Why the robust F is missing under robust or clustered SEs (a singular covariance of the instrument block). */
  fRobustWhy?: string;
}

export interface IvFit {
  ok: true;
  model: FittedModel;
  firstStage: IvFirstStage[];
  diagnostics: IvDiag[];
  r2: number;
  adjR2: number;
  /** σ² as linearmodels reports s2 (eᵀe/n, or eᵀe/(n − k) in small-sample mode), user units. */
  s2: number;
  /** Wald test that every coefficient but the constant is zero: χ²(k) (large-sample) or F = W/k (small-sample). */
  wald: { stat: number; df1: number; df2?: number; p: number; dist: "chi2" | "F" } | null;
  waldWhy?: string;
  /** Residuals y − Xβ in user units (the actual X). */
  resid: Float64Array;
  /** Number of clusters, for clustered SEs. */
  G?: number;
  notes: string[];
}
export type IvResult = IvFit | { ok: false; reason: string };

// ------------------------------------------------------------------------------------------------ linear algebra

interface Qr {
  n: number;
  p: number;
  v: Float64Array[];
  vtv: number[];
  /** R (p×p, upper) of the KEPT columns. */
  R: number[][];
  kept: number[];
}

function reflect(vk: Float64Array, vv: number, k: number, a: Float64Array, n: number): void {
  if (vv === 0) return;
  let dot = 0;
  for (let i = k; i < n; i++) dot += vk[i] * a[i];
  const f = (2 * dot) / vv;
  if (f === 0) return;
  for (let i = k; i < n; i++) a[i] -= f * vk[i];
}

/**
 * ‖a[from:]‖ by a plain sum of squares: every input magnitude is inside 10⁻¹⁰⁰…10¹⁰⁰ (magnitudeReason) and the
 * columns are scaled to unit norm, so no square leaves the double range. (A two-pass scaled norm was measured at
 * 7 s of a 100,000-row fit; this one pass is not.)
 */
function colNorm(a: Float64Array, from: number): number {
  let s = 0;
  const n = a.length;
  for (let i = from; i < n; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function sumOf(a: Float64Array): number {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i];
  return s;
}

function allSame(a: Float64Array): boolean {
  const n = a.length;
  for (let i = 1; i < n; i++) if (a[i] !== a[0]) return false;
  return true;
}

/** a − m, then divided by s (s = 1 for the centring pass). */
function shiftScale(a: Float64Array, m: number, s: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (a[i] - m) / s;
  return out;
}

function firstNonFinite(a: Float64Array): number {
  const n = a.length;
  for (let i = 0; i < n; i++) if (!Number.isFinite(a[i])) return i;
  return -1;
}

function maxAbs(a: Float64Array): number {
  let m = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const t = Math.abs(a[i]);
    if (t > m) m = t;
  }
  return m;
}

/** a − Σ cⱼ colsⱼ. */
function residualOf(a: Float64Array, cols: Float64Array[], c: number[]): Float64Array {
  const e = Float64Array.from(a);
  const n = a.length;
  for (let j = 0; j < cols.length; j++) {
    const xc = cols[j];
    const cj = c[j];
    for (let i = 0; i < n; i++) e[i] -= cj * xc[i];
  }
  return e;
}

function centredSS(a: Float64Array, centre: boolean): number {
  const n = a.length;
  const m = centre ? sumOf(a) / n : 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
  return s;
}

function product(a: Float64Array, b: Float64Array): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
  return out;
}

/**
 * Householder QR. A column is dependent when its part outside the earlier kept columns is at most rel·‖column‖;
 * `skip` drops it (projections), otherwise its index is returned as failAt.
 */
function qrFactor(cols: Float64Array[], n: number, rel: number, skip: boolean): { qr: Qr; failAt: number } {
  const v: Float64Array[] = [];
  const vtv: number[] = [];
  const kept: number[] = [];
  const Rcols: Float64Array[] = [];
  const done = (failAt: number): { qr: Qr; failAt: number } => {
    const p = Rcols.length;
    const R: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let j = 0; j < p; j++) for (let i = 0; i <= j; i++) R[i][j] = Rcols[j][i];
    return { qr: { n, p, v, vtv, R, kept }, failAt };
  };
  for (let j = 0; j < cols.length; j++) {
    const a = Float64Array.from(cols[j]);
    const full = colNorm(a, 0);
    for (let k = 0; k < v.length; k++) reflect(v[k], vtv[k], k, a, n);
    const k = v.length;
    const norm = colNorm(a, k);
    if (!(norm > rel * full) || k >= n) {
      if (skip) continue;
      return done(j);
    }
    const alpha = a[k] > 0 ? -norm : norm;
    const vk = new Float64Array(n);
    vk[k] = a[k] - alpha;
    for (let i = k + 1; i < n; i++) vk[i] = a[i];
    let vv = 0;
    for (let i = k; i < n; i++) vv += vk[i] * vk[i];
    v.push(vk);
    vtv.push(vv);
    const rc = new Float64Array(k + 1);
    for (let i = 0; i < k; i++) rc[i] = a[i];
    rc[k] = alpha;
    Rcols.push(rc);
    kept.push(j);
  }
  return done(-1);
}

function qtApply(qr: Qr, b: Float64Array): Float64Array {
  const a = Float64Array.from(b);
  for (let k = 0; k < qr.p; k++) reflect(qr.v[k], qr.vtv[k], k, a, qr.n);
  return a;
}

/** b − P b: the part of b outside the factor's column space. */
function annihilate(qr: Qr, b: Float64Array): Float64Array {
  const a = qtApply(qr, b);
  for (let k = 0; k < qr.p; k++) a[k] = 0;
  for (let k = qr.p - 1; k >= 0; k--) reflect(qr.v[k], qr.vtv[k], k, a, qr.n);
  return a;
}

function project(qr: Qr, b: Float64Array): Float64Array {
  const r = annihilate(qr, b);
  const n = b.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = b[i] - r[i];
  return out;
}

function dotF(a: Float64Array, b: Float64Array): number {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function squares(a: Float64Array): Float64Array {
  return product(a, a);
}

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

/** S x = b for symmetric positive-definite S; null when S is not positive definite. */
function cholSolve(S: number[][], b: ArrayLike<number>): number[] | null {
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

/** Small arrays only (the k-vectors of a Wald test). */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** A·B·Aᵀ for symmetric A, B (p×p). */
function sandwich(A: number[][], B: number[][]): number[][] {
  const p = A.length;
  const AB: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => {
    let s = 0;
    for (let k = 0; k < p; k++) s += A[i][k] * B[k][j];
    return s;
  }));
  return Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => {
    let s = 0;
    for (let k = 0; k < p; k++) s += AB[i][k] * A[j][k];
    return s;
  }));
}

/** Σ wᵢ cᵢcᵢᵀ over rows (cols are p columns of length n). */
function weightedCross(cols: Float64Array[], w: Float64Array): number[][] {
  const p = cols.length;
  const n = w.length;
  const M: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a++) {
    const ca = cols[a];
    for (let b = a; b < p; b++) {
      const cb = cols[b];
      let s = 0;
      for (let i = 0; i < n; i++) s += w[i] * ca[i] * cb[i];
      M[a][b] = s;
      M[b][a] = s;
    }
  }
  return M;
}

/** Σ_g ξ_g ξ_gᵀ, ξ_g = Σ_{i∈g} eᵢcᵢ. */
function clusterCross(cols: Float64Array[], e: Float64Array, gOf: Int32Array, G: number): number[][] {
  const p = cols.length;
  const n = e.length;
  const xi: Float64Array[] = Array.from({ length: G }, () => new Float64Array(p));
  for (let a = 0; a < p; a++) {
    const ca = cols[a];
    for (let i = 0; i < n; i++) xi[gOf[i]][a] += e[i] * ca[i];
  }
  const M: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let g = 0; g < G; g++) {
    const u = xi[g];
    for (let a = 0; a < p; a++) for (let b = a; b < p; b++) M[a][b] += u[a] * u[b];
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) M[a][b] = M[b][a];
  return M;
}

/** Cluster ids: compared as numbers when every id reads as a plain number ("01" and "1" are one cluster). */
export function ivClusterIds(cl: ArrayLike<string>): { gOf: Int32Array; G: number; numeric: boolean } {
  const n = cl.length;
  const texts = Array.from({ length: n }, (_, i) => String(cl[i]).trim());
  const numeric = n > 0 && texts.every((t) => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) && t.replace(/[^\d]/g, "").replace(/^0+/, "").length <= 15);
  const ids = new Map<string, number>();
  const gOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = numeric ? String(Number(texts[i]) === 0 ? 0 : Number(texts[i])) : texts[i];
    let g = ids.get(key);
    if (g === undefined) {
      g = ids.size;
      ids.set(key, g);
    }
    gOf[i] = g;
  }
  return { gOf, G: ids.size, numeric };
}

function joinNames(list: string[]): string {
  const qs = list.map(q);
  return qs.length === 1 ? qs[0] : `${qs.slice(0, -1).join(", ")} and ${qs[qs.length - 1]}`;
}

/** The earlier columns a dependent column is a combination of (weights above 10⁻⁷ of the largest). */
function partnersOf(qr: Qr, col: Float64Array, names: string[]): string[] {
  if (!qr.p) return [];
  const w = backSolve(qr.R, qtApply(qr, col));
  let mx = 0;
  for (const x of w) mx = Math.max(mx, Math.abs(x));
  return qr.kept.filter((_, i) => Math.abs(w[i]) > 1e-7 * mx).map((j) => names[j]);
}

// ------------------------------------------------------------------------------------------------ the fit

interface Col {
  name: string;
  /** Scaled column: (raw − m)/s. */
  col: Float64Array;
  m: number;
  s: number;
  role: "const" | "exog" | "endog" | "instr";
}

/** Fits 2SLS with the first stage and the diagnostics. */
export function fitIv(input: IvInput): IvResult {
  const now = input.now ?? Date.now;
  const started = now();
  const clock = (stage: string): string | null =>
    now() - started > IV_WALL_MS
      ? `The instrumental-variables fit stopped at the ${stage}: it ran past its ${IV_WALL_MS / 1000} s limit, so the ` +
        "task pane is not frozen. Use fewer rows or fewer columns."
      : null;
  const n = input.y.length;
  const k1 = input.exog.length;
  const k2 = input.endog.length;
  const nq = input.instr.length;
  const hasConst = input.constant;
  const nexog = k1 + (hasConst ? 1 : 0);
  const P = nexog + k2;
  const Pz = nexog + nq;
  if (input.exogNames.length !== k1 || input.endogNames.length !== k2 || input.instrNames.length !== nq) {
    return { ok: false, reason: "Each column needs a name." };
  }
  if (k2 === 0) return { ok: false, reason: "Name at least one endogenous regressor (without one, this is OLS: use the OLS calculator)." };
  if (nq === 0) return { ok: false, reason: "Name at least one excluded instrument." };
  if (nq < k2) {
    return {
      ok: false,
      reason:
        `Under-identified: ${nq} excluded instrument${nq === 1 ? "" : "s"} for ${k2} endogenous regressors. 2SLS needs at ` +
        "least as many excluded instruments as endogenous regressors (the order condition).",
    };
  }
  const all = [...input.exogNames, ...input.endogNames, ...input.instrNames, input.depName];
  for (const nm of all) {
    if (nm.trim().toLowerCase() === "constant") {
      return { ok: false, reason: `A column is named ${q(nm)}, the name the tables give the constant term. Rename the column.` };
    }
  }
  if (k1 + k2 + nq > IV_MAX_COLUMNS) {
    return { ok: false, reason: `At most ${IV_MAX_COLUMNS} columns in all (exogenous regressors, endogenous regressors and instruments); this model has ${k1 + k2 + nq}.` };
  }
  if (ivWorkUnits(n, P, Pz, k2) > IV_MAX_WORK) {
    return {
      ok: false,
      reason:
        `${intText(n)} rows with ${P} coefficients and ${Pz} instruments is beyond the work this calculator allows in the task pane ` +
        `(about ${intText(Math.floor(IV_MAX_WORK / ivWorkUnits(1, P, Pz, k2)))} rows for this model). Use fewer rows, or fewer regressors and instruments.`,
    };
  }
  // The diagnostics need residual degrees of freedom beyond every regression they run.
  if (n <= Math.max(P, Pz) + 1) {
    return {
      ok: false,
      reason:
        `n = ${intText(n)} observation${n === 1 ? "" : "s"} for ${P} coefficients and ${Pz} instruments (constant and exogenous regressors included): ` +
        `2SLS needs more observations than instruments and coefficients (at least ${Math.max(P, Pz) + 2}).`,
    };
  }
  const yRaw = Float64Array.from(input.y);
  const rawCols: [string, Float64Array, Col["role"]][] = [
    ...input.exog.map((c, j): [string, Float64Array, Col["role"]] => [input.exogNames[j], Float64Array.from(c), "exog"]),
    ...input.endog.map((c, j): [string, Float64Array, Col["role"]] => [input.endogNames[j], Float64Array.from(c), "endog"]),
    ...input.instr.map((c, j): [string, Float64Array, Col["role"]] => [input.instrNames[j], Float64Array.from(c), "instr"]),
  ];
  for (const [nm, c] of [[input.depName, yRaw] as [string, Float64Array], ...rawCols.map(([a, b]): [string, Float64Array] => [a, b])]) {
    if (c.length !== n) return { ok: false, reason: "Every column needs the same number of rows." };
    const bad = firstNonFinite(c);
    if (bad >= 0) return { ok: false, reason: `${q(nm)}, row ${bad + 1}: not a finite number.` };
    const m = magnitudeReason(c, nm);
    if (m) return { ok: false, reason: m };
  }
  const tol = Math.max(n, P + Pz) * EPS * Math.sqrt(P + Pz);

  // y in units of a power of two near its largest magnitude.
  const ymax = maxAbs(yRaw);
  const ys = ymax > 0 ? Math.pow(2, Math.round(Math.log2(ymax))) : 1;
  const y = shiftScale(yRaw, 0, ys);

  // Scaled columns.
  const cols: Col[] = [];
  if (hasConst) cols.push({ name: "Constant", col: new Float64Array(n).fill(1 / Math.sqrt(n)), m: 0, s: Math.sqrt(n), role: "const" });
  for (const [nm, raw, role] of rawCols) {
    const m = hasConst ? sumOf(raw) / n : 0;
    const rawNorm = colNorm(raw, 0);
    const cen = shiftScale(raw, m, 1);
    const s = colNorm(cen, 0);
    const same = allSame(raw);
    if (same || !(s > tol * rawNorm)) {
      const what = role === "instr" ? "instrument" : role === "endog" ? "endogenous regressor" : "regressor";
      if (same && raw[0] === 0) return { ok: false, reason: `The ${what} ${q(nm)} is zero in every row, so it carries no information. Remove it.` };
      if (hasConst) {
        return {
          ok: false,
          reason: same
            ? `The ${what} ${q(nm)} is constant (every value is ${numText(raw[0])}), so it is perfectly collinear with the constant. Remove it.`
            : `The ${what} ${q(nm)} is perfectly collinear with the constant (it varies only at the level of rounding). Remove it.`,
        };
      }
    }
    cols.push({ name: nm, col: shiftScale(cen, 0, s), m, s, role });
  }
  const C = cols.filter((c) => c.role === "const");
  const X1 = cols.filter((c) => c.role === "exog");
  const X2 = cols.filter((c) => c.role === "endog");
  const Z2 = cols.filter((c) => c.role === "instr");
  const exogSet = [...C, ...X1];
  const Zs = [...exogSet, ...Z2];
  const Xs = [...exogSet, ...X2]; // internal coefficient order

  // Z: full column rank, or name the dependent instrument / exogenous regressor.
  const zf = qrFactor(Zs.map((c) => c.col), n, tol, false);
  if (zf.failAt >= 0) {
    const bad = Zs[zf.failAt];
    const partners = partnersOf(zf.qr, bad.col, Zs.map((c) => c.name));
    const with_ = partners.length ? ` (${joinNames(partners)})` : "";
    if (bad.role === "instr") {
      return {
        ok: false,
        reason:
          `The instrument ${q(bad.name)} is an exact linear combination of the exogenous regressors and the other instruments${with_}, ` +
          "so it adds no excluded variation and the instruments are collinear. Drop it.",
      };
    }
    return { ok: false, reason: `Perfect collinearity among the exogenous regressors: ${q(bad.name)} is an exact linear combination of${with_ || " the others"}. Drop one of them.` };
  }
  const qrZ = zf.qr;
  // X: full column rank.
  const xf = qrFactor(Xs.map((c) => c.col), n, tol, false);
  if (xf.failAt >= 0) {
    const bad = Xs[xf.failAt];
    const partners = partnersOf(xf.qr, bad.col, Xs.map((c) => c.name));
    return {
      ok: false,
      reason: `Perfect collinearity among the regressors: ${q(bad.name)} is an exact linear combination of ${partners.length ? joinNames(partners) : "the others"}. Drop one of them.`,
    };
  }
  const qrX = xf.qr;
  // X̂ = P_Z X: the exogenous columns are their own fitted values.
  const xhat2 = X2.map((c) => project(qrZ, c.col));
  for (let j = 0; j < k2; j++) {
    const r = annihilate(qrZ, X2[j].col);
    if (!(colNorm(r, 0) > tol * colNorm(X2[j].col, 0))) {
      return {
        ok: false,
        reason:
          `The endogenous regressor ${q(X2[j].name)} is an exact linear combination of the instruments and exogenous regressors ` +
          "(its first stage fits exactly), so it is not endogenous in this sample: move it to the model's exogenous regressors.",
      };
    }
  }
  const XhatCols = [...exogSet.map((c) => c.col), ...xhat2];
  const hf = qrFactor(XhatCols, n, Math.max(tol, 1e-10), false);
  if (hf.failAt >= 0) {
    const j = hf.failAt - nexog;
    const which = j >= 0 && j < k2 ? q(X2[j].name) : "an endogenous regressor";
    return {
      ok: false,
      reason:
        `Under-identified (the rank condition fails): after the exogenous regressors, the instruments' fitted values for ${which} ` +
        "are a linear combination of those for the other endogenous regressors, so the instruments cannot separate their effects. " +
        "Add an instrument that moves it independently.",
    };
  }
  const qrH = hf.qr;
  const late = clock("second stage");
  if (late) return { ok: false, reason: late };

  // β from the QR of X̂; residuals with the ACTUAL X.
  const c = backSolve(qrH.R, qtApply(qrH, y));
  const e = residualOf(y, Xs.map((x) => x.col), c);
  const rss = dotF(e, e);
  const maxRes = maxAbs(e);
  const yScale = maxAbs(y);
  if (maxRes <= 1e-10 * Math.max(yScale, Number.MIN_VALUE) || rss === 0) {
    return {
      ok: false,
      reason: "The data lie exactly on the fitted surface (every residual is rounding noise), so the standard errors are zero and every test is undefined.",
    };
  }
  const tss = centredSS(y, hasConst);
  if (!(tss > 0) || tss <= 1e-24 * n * yScale * yScale) {
    return { ok: false, reason: hasConst ? `${q(input.depName)} is constant, so there is nothing to explain.` : `${q(input.depName)} is zero in every row.` };
  }

  // Clusters.
  let gOf: Int32Array | null = null;
  let G = 0;
  const notes: string[] = [];
  if (input.se === "cluster") {
    const cl = input.clusters;
    const cname = input.clusterName ?? "cluster";
    if (!cl || cl.length !== n) return { ok: false, reason: "Clustered standard errors need a cluster column." };
    const ids = ivClusterIds(cl);
    gOf = ids.gOf;
    G = ids.G;
    if (G < 2) return { ok: false, reason: `Clustered standard errors need at least two clusters; ${q(cname)} has one value in every row used.` };
    if (ids.numeric) notes.push(`Every cluster id in ${q(cname)} reads as a number, so the ids are compared as numbers (“01” and “1” are one cluster).`);
    if (G < 30) notes.push(`Only ${G} clusters: cluster-robust inference is unreliable with few clusters.`);
  }

  const small = input.small;
  const df = n - P;
  /** The covariance (internal scaled coordinates) of an OLS-type fit with regressors `reg` (the X̂ or Z columns). */
  const covOf = (qr: Qr, reg: Float64Array[], resid: Float64Array, k: number, classicalSmall: boolean): number[][] => {
    const Rinv = invUpper(qr.R);
    const p = reg.length;
    const A: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => {
      let s = 0;
      for (let l = Math.max(i, j); l < p; l++) s += Rinv[i][l] * Rinv[j][l];
      return s;
    }));
    const ee = dotF(resid, resid);
    if (input.se === "classical") {
      const s2 = ee / (classicalSmall ? n - k : n);
      return A.map((r) => r.map((v) => v * s2));
    }
    let M: number[][];
    let f = 1;
    if (input.se === "cluster") {
      M = clusterCross(reg, resid, gOf!, G);
      if (small) f = (G / (G - 1)) * ((n - 1) / (n - k));
    } else {
      M = weightedCross(reg, squares(resid));
      if (input.se === "hc1") f = n / (n - k);
    }
    const V = sandwich(A, M);
    return V.map((r) => r.map((v) => v * f));
  };
  const V = covOf(qrH, XhatCols, e, P, small);

  // Reference distribution.
  const pOf = (stat: number, dfr: number): number => (small ? tTestP(stat, dfr) : chiSquareP(stat * stat, 1));
  const critOf = (dfr: number): number => (small ? tCritical(0.05, dfr) : Z975);
  const statLabel: "t" | "z" = small ? "t" : "z";

  // Terms in the user's units: endogenous, exogenous, constant (Stata's order: instrumented first, constant last).
  const reportIdx = [...X2.map((_, j) => nexog + j), ...X1.map((_, j) => (hasConst ? 1 : 0) + j), ...(hasConst ? [0] : [])];
  const crit = critOf(df);
  const terms: ModelTerm[] = [];
  for (const j of reportIdx) {
    const g = new Float64Array(P);
    if (Xs[j].role === "const") {
      g[j] = 1 / Xs[j].s;
      for (let t = 0; t < P; t++) if (t !== j) g[t] = -Xs[t].m / Xs[t].s;
    } else g[j] = 1 / Xs[j].s;
    let est = 0;
    for (let t = 0; t < P; t++) est += g[t] * c[t];
    let v = 0;
    for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) v += g[a] * V[a][b] * g[b];
    const coef = est * ys;
    const se = Math.sqrt(Math.max(v, 0)) * ys;
    const stat = coef / se;
    if (!(se > 0) || !Number.isFinite(stat)) {
      return { ok: false, reason: `The standard error of ${q(Xs[j].name)} is zero or not a finite number for these data, so its test statistic is undefined.` };
    }
    terms.push({ name: Xs[j].name, coef, se, stat, p: pOf(stat, df), ciLo: coef - crit * se, ciHi: coef + crit * se });
  }

  // Wald test of every coefficient but the constant (linearmodels' "Model F-statistic").
  const S = Array.from({ length: P }, (_, j) => j).filter((j) => Xs[j].role !== "const");
  let wald: IvFit["wald"] = null;
  let waldWhy: string | undefined;
  {
    const cS = S.map((j) => c[j]);
    const x = cholSolve(S.map((a) => S.map((b) => V[a][b])), cS);
    if (!x) waldWhy = "The Wald test is not reported: the covariance of the coefficients is singular.";
    else {
      const W = dot(cS, x);
      const kq = S.length;
      wald = small ? { stat: W / kq, df1: kq, df2: df, p: fTestP(W / kq, kq, df), dist: "F" } : { stat: W, df1: kq, p: chiSquareP(W, kq), dist: "chi2" };
    }
  }
  const r2 = 1 - rss / tss;
  const adjR2 = 1 - ((n - (hasConst ? 1 : 0)) / (n - P)) * (1 - r2);
  const s2 = (rss / (small ? n - P : n)) * ys * ys;

  const late2 = clock("first stage");
  if (late2) return { ok: false, reason: late2 };

  // First stage: each endogenous regressor on Z, under the same covariance and reference.
  const firstStage: IvFirstStage[] = [];
  const qrExog = qrFactor(exogSet.map((c0) => c0.col), n, tol, true).qr;
  const Zcols = Zs.map((c0) => c0.col);
  const dfz = n - Pz;
  const critZ = critOf(dfz);
  const instIdx = Z2.map((_, l) => nexog + l);
  for (let j = 0; j < k2; j++) {
    const lateJ = clock("first stage");
    if (lateJ) return { ok: false, reason: lateJ };
    const x = X2[j].col;
    const cz = backSolve(qrZ.R, qtApply(qrZ, x));
    const r = annihilate(qrZ, x);
    const ssr = dotF(r, r);
    const tssx = centredSS(x, hasConst);
    const rr = annihilate(qrExog, x);
    const ssrR = dotF(rr, rr);
    const Vz = covOf(qrZ, Zcols, r, Pz, small);
    const fsTerms: ModelTerm[] = [];
    for (const l of instIdx) {
      const unit = X2[j].s / Zs[l].s;
      const coef = cz[l] * unit;
      const se = Math.sqrt(Math.max(Vz[l][l], 0)) * unit;
      const stat = coef / se;
      if (!(se > 0) || !Number.isFinite(stat)) {
        return { ok: false, reason: `First stage of ${q(X2[j].name)}: the standard error of ${q(Zs[l].name)} is zero or not finite, so its test is undefined.` };
      }
      fsTerms.push({ name: Zs[l].name, coef, se, stat, p: pOf(stat, dfz), ciLo: coef - critZ * se, ciHi: coef + critZ * se });
    }
    const cI = instIdx.map((l) => cz[l]);
    // Textbook non-robust F: s² = SSR/(n − k_Z).
    const s2tb = ssr / dfz;
    const RinvZ = invUpper(qrZ.R);
    const AII = instIdx.map((a) => instIdx.map((b) => {
      let s = 0;
      for (let l = Math.max(a, b); l < Pz; l++) s += RinvZ[a][l] * RinvZ[b][l];
      return s * s2tb;
    }));
    const xtb = cholSolve(AII, cI);
    if (!xtb) return { ok: false, reason: `First stage of ${q(X2[j].name)}: the covariance of the instrument coefficients is singular.` };
    const Ftb = dot(cI, xtb) / nq;
    const fs: IvFirstStage = {
      endog: X2[j].name,
      terms: fsTerms,
      statLabel,
      df: dfz,
      r2: 1 - ssr / tssx,
      partialR2: 1 - ssr / ssrR,
      fClassical: { value: Ftb, df1: nq, df2: dfz, p: fTestP(Ftb, nq, dfz) },
    };
    if (input.se !== "classical") {
      const xr = cholSolve(instIdx.map((a) => instIdx.map((b) => Vz[a][b])), cI);
      if (!xr) {
        // Not a reason to lose the 2SLS estimate: the robust F alone is omitted, by name (as the OLS calculator omits
        // its clustered F when the restrictions exceed G − 1).
        fs.fRobustWhy =
          input.se === "cluster" && nq > G - 1
            ? `not computed: the clustered covariance of the ${nq} instrument coefficients is singular with only ${intText(G)} clusters (G − 1 < ${nq})`
            : `not computed: the ${input.se === "cluster" ? "clustered" : "robust"} covariance of the instrument coefficients is singular`;
      } else {
        const W = dot(cI, xr);
        fs.fRobust = { value: W / nq, df1: nq, wald: W, p: chiSquareP(W, nq) };
      }
    }
    firstStage.push(fs);
  }

  const late3 = clock("diagnostics");
  if (late3) return { ok: false, reason: late3 };

  // Diagnostics (linearmodels IVResults).
  const diagnostics: IvDiag[] = [];
  const e0 = annihilate(qrX, y); // OLS residuals, endogenous treated as exogenous
  const e0e0 = dotF(e0, e0);
  const qrZX = qrFactor([...Zcols, ...X2.map((c0) => c0.col)], n, tol, true).qr;
  const e1 = project(qrZX, e0);
  const e2 = project(qrZ, e);
  const delta = dotF(e1, e1) - dotF(e2, e2);
  const homNote = "assumes homoskedastic errors; the same whatever the SE type";
  diagnostics.push({
    name: "Durbin (endogeneity)",
    stat: delta / (e0e0 / n),
    df: k2,
    p: chiSquareP(delta / (e0e0 / n), k2),
    dist: "chi2",
    note: homNote,
  });
  const whDf2 = n - nexog - k2 - k2;
  if (whDf2 <= 0) diagnostics.push({ name: "Wu–Hausman (endogeneity)", skipped: `no denominator degrees of freedom (n − exogenous − 2 × endogenous = ${intText(whDf2)})` });
  else {
    const fwh = delta / k2 / ((e0e0 - delta) / whDf2);
    diagnostics.push({ name: "Wu–Hausman (endogeneity)", stat: fwh, df: k2, df2: whDf2, p: fTestP(fwh, k2, whDf2), dist: "F", note: homNote });
  }
  const lateW = clock("diagnostics");
  if (lateW) return { ok: false, reason: lateW };
  if (input.se !== "classical") {
    // Wooldridge's score test (heteroskedasticity-robust): n − SSR of 1 on rⱼ·e₀.
    const tf = X2.map((c0) => {
      return product(annihilate(qrX, annihilate(qrZ, c0.col)), e0);
    });
    const ones = new Float64Array(n).fill(1);
    const res = annihilate(qrFactor(tf, n, tol, true).qr, ones);
    const st = n - dotF(res, res);
    diagnostics.push({ name: "Wooldridge score (endogeneity)", stat: st, df: k2, p: chiSquareP(st, k2), dist: "chi2", note: "robust to heteroskedasticity (not to clustering)" });
  }
  const lateO = clock("diagnostics");
  if (lateO) return { ok: false, reason: lateO };
  const over = nq - k2;
  if (over === 0) {
    diagnostics.push({ name: "Sargan (overidentification)", skipped: "exactly identified" });
    diagnostics.push({ name: "Basmann (overidentification)", skipped: "exactly identified" });
    if (input.se !== "classical") diagnostics.push({ name: "Wooldridge score (overidentification)", skipped: "exactly identified" });
  } else {
    const u = annihilate(qrZ, e);
    const sg = n * (1 - dotF(u, u) / rss);
    diagnostics.push({ name: "Sargan (overidentification)", stat: sg, df: over, p: chiSquareP(sg, over), dist: "chi2", note: homNote });
    if (n - sg <= 0) diagnostics.push({ name: "Basmann (overidentification)", skipped: "the Sargan statistic is not below n" });
    else {
      const bs = (sg * (n - Pz)) / (n - sg);
      diagnostics.push({ name: "Basmann (overidentification)", stat: bs, df: over, p: chiSquareP(bs, over), dist: "chi2", note: homNote });
    }
    if (input.se !== "classical") {
      const tf = Z2.slice(0, over).map((c0) => {
        return product(annihilate(qrH, c0.col), e);
      });
      const ones = new Float64Array(n).fill(1);
      const res = annihilate(qrFactor(tf, n, tol, true).qr, ones);
      const st = n - dotF(res, res);
      diagnostics.push({ name: "Wooldridge score (overidentification)", stat: st, df: over, p: chiSquareP(st, over), dist: "chi2", note: "robust to heteroskedasticity (not to clustering)" });
    }
  }
  const late4 = clock("diagnostics");
  if (late4) return { ok: false, reason: late4 };

  // Labels and conventions.
  const cname = input.clusterName ?? "cluster";
  const seLabel =
    input.se === "classical"
      ? "Classical"
      : input.se === "hc0"
        ? "Robust (HC0)"
        : input.se === "hc1"
          ? "Robust (HC1)"
          : `Clustered by ${cname}, ${intText(G)} clusters`;
  notes.unshift(
    small
      ? `Small-sample mode (linearmodels debiased=True): t with n − k = ${intText(df)} df` +
          (input.se === "classical" ? ", σ² = eᵀe/(n − k), the formula of Stata's ivregress …, small" : input.se === "cluster" ? ", cluster factor G/(G − 1)·(n − 1)/(n − k)" : "") +
          (input.se === "cluster" ? " (linearmodels uses n − k df for clustered SEs; Stata's regress uses G − 1)." : ".")
      : "Large-sample mode (linearmodels' default, debiased=False): z statistics and normal intervals" +
          (input.se === "classical" ? ", σ² = eᵀe/n, the formula of Stata's ivregress default." : input.se === "cluster" ? ", and no finite-sample factor on the clustered covariance (as linearmodels)." : "."),
  );
  if (input.se !== "classical") notes.push("The robust and clustered forms are pinned to linearmodels 7.1; they have not been checked against Stata's ivregress.");
  if (input.se === "hc0") notes.push("Robust SEs: HC0, White's sandwich with the 2SLS fitted regressors X̂ and the residuals e = y − Xβ, no n/(n − k) factor (linearmodels cov_type=\"robust\", debiased=False).");
  if (input.se === "hc1") notes.push("Robust SEs: HC1, White's sandwich with X̂ and e = y − Xβ times n/(n − k) (linearmodels cov_type=\"robust\", debiased=True).");
  if (input.se === "cluster") notes.push(`Clustered SEs by ${cname}: Σ_g ξ_g ξ_gᵀ with ξ_g = Σ eᵢx̂ᵢ (linearmodels cov_type="clustered").`);
  notes.push("Residuals are y − Xβ with the actual endogenous regressors, not the first-stage fitted values.");
  notes.push(
    hasConst
      ? "R² = 1 − RSS/TSS with the 2SLS residuals; it can be negative and is not a measure of fit for IV."
      : "No constant: R² is uncentered (1 − RSS/Σy²) and can be negative.",
  );

  const stats: ModelStat[] = [
    { label: "R²", value: r2 },
    { label: "Adjusted R²", value: adjR2 },
  ];
  if (wald) {
    stats.push({ label: wald.dist === "F" ? "F" : "Wald χ²", value: wald.stat });
    stats.push({ label: wald.dist === "F" ? "Prob > F" : "Prob > χ²", value: wald.p });
  }
  stats.push({ label: "Root MSE", value: Math.sqrt(s2) });
  for (const s of stats) if (!Number.isFinite(s.value)) return { ok: false, reason: `${s.label} is not a finite number at this scale; rescale the data.` };
  for (const t of terms) {
    for (const v of [t.coef, t.se, t.stat, t.p, t.ciLo, t.ciHi]) {
      if (!Number.isFinite(v)) return { ok: false, reason: `The estimate for ${q(t.name)} is not a finite number at this scale; rescale the data.` };
    }
  }
  for (const fs of firstStage) {
    const vals = [fs.r2, fs.partialR2, fs.fClassical.value, fs.fClassical.p, ...(fs.fRobust ? [fs.fRobust.value, fs.fRobust.p] : [])];
    for (const t of fs.terms) vals.push(t.coef, t.se, t.stat, t.p, t.ciLo, t.ciHi);
    if (vals.some((v) => !Number.isFinite(v))) return { ok: false, reason: `The first stage of ${q(fs.endog)} is not finite at this scale; rescale the data.` };
  }
  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    if (!("skipped" in d) && !(Number.isFinite(d.stat) && Number.isFinite(d.p))) diagnostics[i] = { name: d.name, skipped: "not a finite number for these data" };
  }

  const model: FittedModel = {
    kind: "iv",
    depName: input.depName,
    n,
    terms,
    statLabel,
    ...(small ? { df } : {}),
    seLabel,
    stats,
    notes: [...notes],
  };
  return {
    ok: true,
    model,
    firstStage,
    diagnostics,
    r2,
    adjR2,
    s2,
    wald,
    waldWhy,
    resid: shiftScale(e, 0, 1 / ys),
    G: input.se === "cluster" ? G : undefined,
    notes,
  };
}
