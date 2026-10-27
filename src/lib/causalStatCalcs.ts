/**
 * Release F2 (v2.203.0), gap item #12, causal inference II: three Stats calculators, pure functions of the field reader.
 *  - causal-rdd     regression discontinuity, sharp and fuzzy: local linear (or quadratic) fits either side of the
 *                   cutoff with a triangular, Epanechnikov or uniform kernel; bandwidth by the Imbens–Kalyanaraman rule
 *                   (local linear only) or the user's own; conventional heteroskedasticity-robust (HC1) standard errors;
 *                   a bandwidth-sensitivity table and the binned-scatter figure with the fitted lines.
 *  - causal-synth   synthetic control (Abadie, Diamond & Hainmueller 2010): donor weights ≥ 0 summing to 1 that best
 *                   reproduce the treated unit's pre-period outcomes (a dedicated simplex active-set solver: the F1
 *                   qpActiveSet.ts cycled on near-collinear donor pools), the treated-vs-synthetic and
 *                   gap figure, pre/post RMSPE, and in-space placebos (post/pre RMSPE ratio rank → permutation p-value).
 *  - causal-pscore  propensity score: a logit score (logitProbit.ts), nearest-neighbor matching (with or without
 *                   replacement, caliper) or inverse-probability weighting (ATE or ATT, normalised or Horvitz–Thompson),
 *                   the standardised-mean-difference balance table before and after, common support and trimming.
 *
 * Oracles: scripts/causal-oracle.py (statsmodels WLS / linearmodels IV2SLS for the RD fits, an independent numpy
 * re-implementation of the bandwidth rule, cvxpy for the synthetic-control QP, statsmodels Logit + numpy matching/IPW
 * with a numerical-Jacobian sandwich). rdrobust and pysyncon are not installed: the bandwidth and the placebo loop are
 * re-implementations, not library outputs.
 *
 * The worked defaults are synthetic (a 32-bit LCG, normal draws as a sum of 12 uniforms, values rounded in integers,
 * reproduced bit for bit by the oracle script), so nothing copyrighted ships.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { StatCalcDef } from "./statCalc";
import { parseRegData, findColumn, selectColumns, readRegCell, type RegDataset } from "./regData";
import { readIntField } from "./eventStudy";
import { fmtFixed, fmtP, intText, numText, P_BELOW } from "./regTable";
import { buildPlotSvg, combineSvgs, type Series } from "./plot";
import { normalCdfPrecise } from "./probdist";
import { solveDense } from "./qpActiveSet";
import { fitLogit, LogitProbitRefusal } from "./logitProbit";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;
const MINUS = "−";

/** The pasted table's size limit, checked before parsing (a 50 MB paste must not freeze Word in the reader). */
export const CAUSAL_TEXT_MAX = 4_000_000;
/** Regression discontinuity: at most this many observations. */
export const RD_MAX_ROWS = 20_000;
/** Synthetic control: at most this many donors and periods. */
export const SC_MAX_DONORS = 40;
export const SC_MAX_PERIODS = 200;
/** Propensity score: at most this many observations and covariates. */
export const PS_MAX_ROWS = 5_000;
export const PS_MAX_COVARIATES = 10;

function getter(read: Read): (k: string) => string {
  return (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
}

/** One number typed in a field, by the regression reader's cell rule ("3,5" is 3.5, "1,000" is 1000, "−2" is −2). */
function readNumber(raw: string, label: string): number | { error: string } {
  const t = raw.trim();
  if (!t) return { error: `${label}: enter a number.` };
  const v = readRegCell(t, false).value;
  if (!Number.isFinite(v)) return { error: `${label}: ${q(t)} is not a number.` };
  if (Math.abs(v) > 1e15) return { error: `${label}: ${q(t)} is too large (the limit is 10¹⁵ in magnitude).` };
  return v === 0 ? 0 : v;
}

function pText(p: number): string {
  return p < 0.001 ? P_BELOW : `= ${fmtP(p)}`;
}

/** Two-sided normal p-value. */
function zP(z: number): number {
  return 2 * normalCdfPrecise(-Math.abs(z));
}

function ci(est: number, se: number, d: number): string {
  return `[${fmtFixed(est - 1.959963984540054 * se, d)}; ${fmtFixed(est + 1.959963984540054 * se, d)}]`;
}

/** A 32-bit LCG (Numerical Recipes constants) and a normal draw as the sum of 12 uniforms minus 6 (as ivDefaultTable). */
function lcg(seed: number): { u: () => number; g: () => number } {
  let state = seed >>> 0;
  const u = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  const g = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += u();
    return s - 6;
  };
  return { u, g };
}

/** An integer k as a decimal with d places ("-1234", 2 → "-12.34"). */
function fmtInt(k: number, d: number): string {
  const sign = k < 0 ? "-" : "";
  const a = Math.abs(k);
  if (d === 0) return sign + String(a);
  const p = Math.pow(10, d);
  return `${sign}${Math.floor(a / p)}.${String(a % p).padStart(d, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Small dense least squares (k ≤ 6 columns): column-scaled normal equations, solved by partial pivoting.

interface Lsq {
  coef: number[];
  /** (X′WX)⁻¹ in the original column units. */
  bread: number[][];
  resid: number[];
}

/** Weighted least squares of y on the rows of X (weights w, or 1); null when X′WX is singular. */
export function wls(X: number[][], y: ArrayLike<number>, w?: ArrayLike<number>): Lsq | null {
  const n = X.length;
  const k = X[0]?.length ?? 0;
  if (n < k || k === 0) return null;
  const sc = new Array<number>(k).fill(0);
  for (const row of X) for (let j = 0; j < k; j++) sc[j] = Math.max(sc[j], Math.abs(row[j]));
  if (sc.some((s) => !(s > 0) || !Number.isFinite(s))) return null;
  const M: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const r = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    const xi = X[i];
    for (let a = 0; a < k; a++) {
      const xa = (xi[a] / sc[a]) * wi;
      r[a] += xa * y[i];
      for (let b = 0; b <= a; b++) M[a][b] += xa * (xi[b] / sc[b]);
    }
  }
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) M[a][b] = M[b][a];
  // Collinearity: the scaled matrix's smallest pivot relative to its largest diagonal (a rank test the solver lacks).
  if (!choleskyOk(M)) return null;
  const inv: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let j = 0; j < k; j++) {
    const e = new Array<number>(k).fill(0);
    e[j] = 1;
    const col = solveDense(M, e);
    if (!col) return null;
    for (let i = 0; i < k; i++) inv[i][j] = col[i] / (sc[i] * sc[j]);
  }
  const coefS = solveDense(M, r);
  if (!coefS) return null;
  const coef = coefS.map((v, j) => v / sc[j]);
  const resid = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = 0; j < k; j++) f += X[i][j] * coef[j];
    resid[i] = y[i] - f;
  }
  return { coef, bread: inv, resid };
}

function choleskyOk(M: number[][]): boolean {
  const k = M.length;
  const L: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  let dmax = 0;
  for (let i = 0; i < k; i++) dmax = Math.max(dmax, M[i][i]);
  for (let j = 0; j < k; j++) {
    let s = M[j][j];
    for (let p = 0; p < j; p++) s -= L[j][p] * L[j][p];
    if (!(s > 1e-11 * dmax)) return false;
    L[j][j] = Math.sqrt(s);
    for (let i = j + 1; i < k; i++) {
      let t = M[i][j];
      for (let p = 0; p < j; p++) t -= L[i][p] * L[j][p];
      L[i][j] = t / L[j][j];
    }
  }
  return true;
}

/** HC1 sandwich n/(n − k)·B (Σ w²e²xx′) B for one or two residual vectors (the cross term when two). */
function hc1(X: number[][], w: ArrayLike<number>, bread: number[][], e1: number[], e2: number[] = e1): number[][] {
  const n = X.length;
  const k = bread.length;
  const meat: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < n; i++) {
    const s = w[i] * w[i] * e1[i] * e2[i];
    if (s === 0) continue;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += s * X[i][a] * X[i][b];
  }
  const f = n / (n - k);
  const BM = bread.map((row) => meat[0].map((_, j) => row.reduce((acc, v, p) => acc + v * meat[p][j], 0)));
  return BM.map((row) => bread[0].map((_, j) => f * row.reduce((acc, v, p) => acc + v * bread[p][j], 0)));
}

function median(sorted: number[]): number {
  const m = sorted.length;
  return m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
}

// ---------------------------------------------------------------------------------------------------------------
// Regression discontinuity

export type RdKernel = "triangular" | "epanechnikov" | "uniform";

/**
 * C_K of the Imbens–Kalyanaraman rule for local linear regression at a boundary (IK Lemma 3.1:
 * C_K = (C₂/(4C₁²))^{1/5} from the one-sided kernel moments νⱼ = ∫₀¹uʲK(u)du and πⱼ = ∫₀¹uʲK(u)²du), evaluated by
 * quadrature for kernels on [−1, 1] (bandwidth = half-width of the window). Triangular 3.4375 and Epanechnikov
 * 3.1999 match the published constants; the uniform value is the same formula (rdd's 5.40384 is a different scaling).
 */
export const IK_CK: Record<RdKernel, number> = { triangular: 3.437543855, epanechnikov: 3.199896319, uniform: 2.701920077 };

export function kernelWeight(kernel: RdKernel, v: number): number {
  const a = Math.abs(v);
  if (kernel === "uniform") return a <= 1 ? 0.5 : 0;
  if (a >= 1) return 0;
  return kernel === "triangular" ? 1 - a : 0.75 * (1 - a * a);
}

export interface IkSteps {
  h: number;
  h1: number;
  f: number;
  sigma2: number;
  m3: number;
  h2p: number;
  h2m: number;
  m2p: number;
  m2m: number;
  rp: number;
  rm: number;
  n2p: number;
  n2m: number;
  /** ĥ without the regularisation terms. */
  hNoReg: number;
}

/** Step 2's pilot bandwidths, h₂,± = 3.56·(σ̂²/(f̂·max(m̂⁽³⁾², 0.01)))^{1/7}·N±^{−1/7} (IK eq. 4.11). */
export function ikPilot(sigma2: number, f: number, m3: number, nSide: number): number {
  return 3.56 * Math.pow(sigma2 / (f * Math.max(m3 * m3, 0.01)), 1 / 7) * Math.pow(nSide, -1 / 7);
}

/** Step 3: ĥ = C_K·(2σ̂²/(f̂·((m̂⁽²⁾₊ − m̂⁽²⁾₋)² + r̂₊ + r̂₋)))^{1/5}·N^{−1/5} (IK eq. 4.13). */
export function ikFinal(ck: number, sigma2: number, f: number, m2p: number, m2m: number, rp: number, rm: number, n: number): number {
  const d = m2p - m2m;
  return ck * Math.pow((2 * sigma2) / (f * (d * d + rp + rm)), 1 / 5) * Math.pow(n, -1 / 5);
}

/**
 * The Imbens–Kalyanaraman bandwidth for the sharp RD, local linear, as written in NBER Working Paper 14726 (2009),
 * Section 4.2, eqs. 4.8–4.13 (the algorithm of the 2012 Review of Economic Studies article). Treated side X ≥ c
 * everywhere; pilot windows [c − h₁, c) and [c, c + h₁]; f̂(c) = (N₋ + N₊)/(2Nh₁) (the paper's worked example; eq. 4.8 as
 * printed omits the 2); σ̂²(c) pooled over both windows with divisor N₋ + N₊; the global cubic with a jump is fitted on
 * median(X | X < c) ≤ X ≤ median(X | X ≥ c); quadratics on [c − h₂,₋, c) and [c, c + h₂,₊]; r̂± = 720σ̂²/(N₂,±h₂,±⁴).
 */
export function ikBandwidth(x: ArrayLike<number>, y: ArrayLike<number>, c: number, kernel: RdKernel): IkSteps | { error: string } {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (x[i] - mean) * (x[i] - mean);
  const sx = Math.sqrt(ss / (n - 1));
  const h1 = 1.84 * sx * Math.pow(n, -1 / 5);
  if (!(h1 > 0)) return { error: "The running variable does not vary, so no bandwidth can be chosen." };
  let nl = 0;
  let nr = 0;
  let syl = 0;
  let syr = 0;
  for (let i = 0; i < n; i++) {
    if (x[i] >= c - h1 && x[i] < c) {
      nl++;
      syl += y[i];
    } else if (x[i] >= c && x[i] <= c + h1) {
      nr++;
      syr += y[i];
    }
  }
  if (nl < 1 || nr < 1) return { error: `The IK bandwidth rule needs observations on both sides within its pilot window c ± ${fmtFixed(h1, 4)} (step 1); enter a bandwidth instead.` };
  const ybl = syl / nl;
  const ybr = syr / nr;
  let ssy = 0;
  for (let i = 0; i < n; i++) {
    if (x[i] >= c - h1 && x[i] < c) ssy += (y[i] - ybl) * (y[i] - ybl);
    else if (x[i] >= c && x[i] <= c + h1) ssy += (y[i] - ybr) * (y[i] - ybr);
  }
  const f = (nl + nr) / (2 * n * h1);
  const sigma2 = ssy / (nl + nr);
  // Step 2.
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) (x[i] < c ? left : right).push(x[i]);
  left.sort((a, b) => a - b);
  right.sort((a, b) => a - b);
  const medL = median(left);
  const medR = median(right);
  const Xc: number[][] = [];
  const yc: number[] = [];
  for (let i = 0; i < n; i++) {
    if (x[i] >= medL && x[i] <= medR) {
      const u = x[i] - c;
      Xc.push([1, x[i] >= c ? 1 : 0, u, u * u, u * u * u]);
      yc.push(y[i]);
    }
  }
  const cub = Xc.length >= 6 ? wls(Xc, yc) : null;
  if (!cub) return { error: "The IK bandwidth rule's global cubic (step 2, between the two side medians) cannot be fitted: too few distinct values of the running variable near the cutoff. Enter a bandwidth instead." };
  const m3 = 6 * cub.coef[4];
  const nPlus = right.length;
  const nMinus = left.length;
  const h2p = ikPilot(sigma2, f, m3, nPlus);
  const h2m = ikPilot(sigma2, f, m3, nMinus);
  const quad = (side: 1 | -1, h2: number): { m2: number; n2: number } | null => {
    const Xq: number[][] = [];
    const yq: number[] = [];
    for (let i = 0; i < n; i++) {
      const inside = side > 0 ? x[i] >= c && x[i] <= c + h2 : x[i] >= c - h2 && x[i] < c;
      if (inside) {
        const u = x[i] - c;
        Xq.push([1, u, u * u]);
        yq.push(y[i]);
      }
    }
    const fit = Xq.length >= 3 ? wls(Xq, yq) : null;
    return fit ? { m2: 2 * fit.coef[2], n2: Xq.length } : null;
  };
  const qp = quad(1, h2p);
  const qm = quad(-1, h2m);
  if (!qp || !qm) return { error: "The IK bandwidth rule's local quadratics (step 2) cannot be fitted: fewer than three distinct running-variable values within the pilot bandwidth on one side. Enter a bandwidth instead." };
  if (!(sigma2 > 0)) return { error: "The outcome does not vary near the cutoff (σ̂² = 0 in the IK pilot window), so the IK rule is undefined. Enter a bandwidth instead." };
  const rp = (720 * sigma2) / (qp.n2 * Math.pow(h2p, 4));
  const rm = (720 * sigma2) / (qm.n2 * Math.pow(h2m, 4));
  const h = ikFinal(IK_CK[kernel], sigma2, f, qp.m2, qm.m2, rp, rm, n);
  const hNoReg = ikFinal(IK_CK[kernel], sigma2, f, qp.m2, qm.m2, 0, 0, n);
  if (!Number.isFinite(h) || !(h > 0)) return { error: "The IK bandwidth is not a finite positive number for these data. Enter a bandwidth instead." };
  return { h, h1, f, sigma2, m3, h2p, h2m, m2p: qp.m2, m2m: qm.m2, rp, rm, n2p: qp.n2, n2m: qm.n2, hNoReg };
}

export interface RdFit {
  h: number;
  nL: number;
  nR: number;
  /** Sharp: the jump in the outcome; fuzzy: the Wald ratio. */
  tau: number;
  se: number;
  /** Fuzzy only: the reduced-form jump in the outcome and the first-stage jump in the treatment. */
  rfY?: { est: number; se: number };
  fs?: { est: number; se: number };
  /** The fitted outcome polynomial either side (coefficients in u = x − c, ascending powers). */
  polyL: number[];
  polyR: number[];
}

/**
 * The local polynomial RD fit at bandwidth h: the observations with K((x − c)/h) > 0, one weighted regression of the
 * outcome on [1, D, u, D·u (, u², D·u²)], u = x − c, D = 1{x ≥ c}, weights K. Sharp: τ is the coefficient on D.
 * Fuzzy: τ = (jump in y)/(jump in the treatment), both from the same design (the just-identified 2SLS estimate with
 * D instrumenting the treatment); its HC1 variance uses the 2SLS residual eʸ − τeᵗ.
 */
export function rdFit(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  t: ArrayLike<number> | null,
  c: number,
  h: number,
  kernel: RdKernel,
  order: 1 | 2,
): RdFit | { error: string } {
  const X: number[][] = [];
  const yy: number[] = [];
  const tt: number[] = [];
  const w: number[] = [];
  let nL = 0;
  let nR = 0;
  const distinctL = new Set<number>();
  const distinctR = new Set<number>();
  for (let i = 0; i < x.length; i++) {
    const k = kernelWeight(kernel, (x[i] - c) / h);
    if (!(k > 0)) continue;
    const u = x[i] - c;
    const d = x[i] >= c ? 1 : 0;
    X.push(order === 1 ? [1, d, u, d * u] : [1, d, u, d * u, u * u, d * u * u]);
    yy.push(y[i]);
    if (t) tt.push(t[i]);
    w.push(k);
    if (d) {
      nR++;
      distinctR.add(x[i]);
    } else {
      nL++;
      distinctL.add(x[i]);
    }
  }
  const need = order + 1;
  if (distinctL.size < need || distinctR.size < need) {
    return {
      error:
        `Within the bandwidth ${fmtFixed(h, 4)} the left side has ${intText(distinctL.size)} and the right side ${intText(distinctR.size)} distinct running-variable value${distinctR.size === 1 ? "" : "s"}; ` +
        `a local ${order === 1 ? "linear" : "quadratic"} fit needs at least ${need} on each side (and more for a standard error). Widen the bandwidth.`,
    };
  }
  const k = X[0].length;
  if (X.length <= k) return { error: `Only ${intText(X.length)} observations fall within the bandwidth ${fmtFixed(h, 4)}; the fit has ${k} coefficients. Widen the bandwidth.` };
  const fy = wls(X, yy, w);
  if (!fy) return { error: `The local ${order === 1 ? "linear" : "quadratic"} design within the bandwidth ${fmtFixed(h, 4)} is singular. Widen the bandwidth.` };
  const polyOf = (coef: number[]): { L: number[]; R: number[] } =>
    order === 1 ? { L: [coef[0], coef[2]], R: [coef[0] + coef[1], coef[2] + coef[3]] } : { L: [coef[0], coef[2], coef[4]], R: [coef[0] + coef[1], coef[2] + coef[3], coef[4] + coef[5]] };
  const poly = polyOf(fy.coef);
  const Vy = hc1(X, w, fy.bread, fy.resid);
  if (!t) {
    const se = Math.sqrt(Vy[1][1]);
    if (!Number.isFinite(fy.coef[1]) || !Number.isFinite(se)) return { error: "The RD estimate is not finite for these data (an extreme scale)." };
    return { h, nL, nR, tau: fy.coef[1], se, polyL: poly.L, polyR: poly.R };
  }
  const ft = wls(X, tt, w);
  if (!ft) return { error: "The first-stage design is singular." };
  const g = ft.coef[1];
  const Vt = hc1(X, w, ft.bread, ft.resid);
  const seT = Math.sqrt(Vt[1][1]);
  if (!(Math.abs(g) > 1e-10) || !(seT > 0 ? Math.abs(g / seT) > 1e-6 : Math.abs(g) > 1e-10)) {
    return { error: "The treatment does not jump at the cutoff within this bandwidth (first-stage jump 0), so the fuzzy RD ratio is undefined. Check the treatment column, or use the sharp design." };
  }
  const tau = fy.coef[1] / g;
  const u = fy.resid.map((e, i) => e - tau * ft.resid[i]);
  const Vu = hc1(X, w, fy.bread, u);
  const se = Math.sqrt(Vu[1][1]) / Math.abs(g);
  if (!Number.isFinite(tau) || !Number.isFinite(se)) return { error: "The fuzzy RD estimate is not finite for these data (a near-zero first stage)." };
  return { h, nL, nR, tau, se, rfY: { est: fy.coef[1], se: Math.sqrt(Vy[1][1]) }, fs: { est: g, se: seT }, polyL: poly.L, polyR: poly.R };
}

/** The worked default: 500 synthetic test scores, a scholarship at 50, imperfect take-up. */
export function rdDefaultTable(): string {
  const { u, g } = lcg(20261027);
  const lines = ["score\toutcome\ttreated"];
  for (let i = 0; i < 1000; i++) {
    const k = Math.floor(u() * 1000);
    const d = k >= 500;
    const treated = u() < (d ? 0.95 : 0.05) ? 1 : 0;
    const xc = (k - 500) / 10;
    const yv = 40 + 0.25 * xc - 0.002 * xc * xc + 6 * treated + 2 * g();
    const yk = Math.floor(yv * 100 + 0.5);
    lines.push([fmtInt(k, 1), fmtInt(yk, 2), String(treated)].join("\t"));
  }
  return lines.join("\n");
}

const KERNEL_OPTIONS = [
  { value: "triangular", label: "Triangular (edge)" },
  { value: "epanechnikov", label: "Epanechnikov" },
  { value: "uniform", label: "Uniform (rectangular)" },
];
const KERNEL_NAME: Record<RdKernel, string> = { triangular: "triangular", epanechnikov: "Epanechnikov", uniform: "uniform" };

/** causal-rdd: regression discontinuity. */
export function rdCalc(read: Read): StatOutput {
  const get = getter(read);
  const design = get("design").trim() || "sharp";
  if (design !== "sharp" && design !== "fuzzy") return refuse(`Design: ${q(design)} is not sharp or fuzzy.`);
  const kernel = (get("kernel").trim() || "triangular") as RdKernel;
  if (!(kernel in IK_CK)) return refuse(`Kernel: ${q(kernel)} is not triangular, epanechnikov or uniform.`);
  const ordRaw = get("order").trim() || "1";
  if (ordRaw !== "1" && ordRaw !== "2") return refuse(`Polynomial order: ${q(ordRaw)} is not 1 or 2.`);
  const order = Number(ordRaw) as 1 | 2;
  const binsRaw = get("bins").trim() || "20";
  const bins = readIntField(binsRaw, "Bins per side", 2, 100);
  if (typeof bins !== "number") return refuse(bins.error);
  const cRes = readNumber(get("cutoff"), "Cutoff");
  if (typeof cRes !== "number") return refuse(cRes.error);
  const c = cRes;
  const outcome = get("outcome").trim();
  const running = get("running").trim();
  if (!outcome) return refuse("Outcome column: name the outcome column.");
  if (!running) return refuse("Running variable column: name the running (forcing) variable's column.");
  const treat = get("treatment").trim();
  if (design === "fuzzy" && !treat) return refuse("Treatment column: a fuzzy design needs the column of treatment received (0/1 or a take-up share).");
  const text = get("data");
  if (text.length > CAUSAL_TEXT_MAX) return refuse(`The data table is longer than ${intText(CAUSAL_TEXT_MAX)} characters; paste at most ${intText(RD_MAX_ROWS)} rows.`);
  const parsed = parseRegData(text);
  if (!parsed.ok) return refuse(parsed.reason);
  const preds = design === "fuzzy" ? [running, treat] : [running];
  const sel = selectColumns(parsed.data, { dep: outcome, preds, text: "" });
  if (!sel.ok) return refuse(sel.reason);
  const cols = sel.cols;
  const n = cols.y.length;
  if (n > RD_MAX_ROWS) return refuse(`The table has ${intText(n)} usable rows; the regression discontinuity calculator takes at most ${intText(RD_MAX_ROWS)}.`);
  if (n < 10) return refuse(`Only ${intText(n)} usable rows; a regression discontinuity needs at least 10.`);
  const x = cols.X[0];
  const y = cols.y;
  const t = design === "fuzzy" ? cols.X[1] : null;
  let nLeft = 0;
  let xmin = Infinity;
  let xmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < c) nLeft++;
    xmin = Math.min(xmin, x[i]);
    xmax = Math.max(xmax, x[i]);
  }
  if (nLeft === 0 || nLeft === n) return refuse(`Every value of ${q(cols.names[0])} is on one side of the cutoff ${numText(c)} (from ${numText(xmin)} to ${numText(xmax)}).`);
  // Bandwidth.
  const bwRaw = get("bandwidth").trim();
  let h: number;
  let ik: IkSteps | null = null;
  if (bwRaw) {
    const b = readNumber(bwRaw, "Bandwidth");
    if (typeof b !== "number") return refuse(b.error);
    if (!(b > 0)) return refuse(`Bandwidth: ${fmtFixed(b, 4)} must be greater than zero.`);
    h = b;
  } else {
    if (order === 2) return refuse("Bandwidth: the Imbens–Kalyanaraman rule is derived for local linear fits only. Choose order 1, or enter a bandwidth for the local quadratic.");
    const r = ikBandwidth(x, y, c, kernel);
    if ("error" in r) return refuse(r.error);
    ik = r;
    h = r.h;
  }
  const fit = rdFit(x, y, t, c, h, kernel, order);
  if ("error" in fit) return refuse(fit.error);
  if (!(fit.se > 0)) return refuse(`The local fit is exact within the bandwidth (zero residuals): the jump is ${fmtFixed(fit.tau, 3)}, but no standard error exists. Real data with noise, or a wider bandwidth, gives one.`);
  const d = 3;
  const yName = cols.depName;
  const xName = cols.names[0];
  const lines: string[] = [];
  const z = fit.tau / fit.se;
  const pz = zP(z);
  const kind = design === "sharp" ? "Sharp" : "Fuzzy";
  lines.push(`${kind} regression discontinuity: ${q(yName)} at ${q(xName)} = ${numText(c)} (treated side: ${xName} ≥ cutoff)`);
  lines.push(
    `${design === "sharp" ? "Jump" : "Effect (Wald ratio)"} τ = ${fmtFixed(fit.tau, d)} (SE ${fmtFixed(fit.se, d)}), z = ${fmtFixed(z, 3)}, p ${pText(pz)}, 95% CI ${ci(fit.tau, fit.se, d)}`,
  );
  lines.push(
    `Local ${order === 1 ? "linear" : "quadratic"}, ${KERNEL_NAME[kernel]} kernel, bandwidth h = ${fmtFixed(h, 4)} (${ik ? "Imbens–Kalyanaraman" : "entered"}); ${intText(fit.nL)} observations left and ${intText(fit.nR)} right of the cutoff within h (of ${intText(n)}).`,
  );
  if (fit.fs && fit.rfY) {
    const F = (fit.fs.est / fit.fs.se) ** 2;
    if (!(fit.fs.se > 1e-9 * Math.abs(fit.fs.est)) || !Number.isFinite(F)) {
      lines.push(`First stage: the treatment jumps by ${fmtFixed(fit.fs.est, d)} and is fitted without error within the bandwidth (it follows the cutoff rule exactly), so the design is in effect sharp.`);
    } else {
      lines.push(`First stage: the treatment jumps by ${fmtFixed(fit.fs.est, d)} (SE ${fmtFixed(fit.fs.se, d)}), F = ${fmtFixed(F, 2)}${F < 10 ? " (below 10: a weak first stage, so the ratio and its normal-approximation interval are unreliable)" : ""}.`);
    }
  }
  let yScale = 0;
  for (let i = 0; i < n; i++) yScale = Math.max(yScale, Math.abs(y[i]));
  if (fit.se <= 1e-9 * Math.max(yScale, 1e-300)) lines.push("The local fit is exact (the residuals are zero to rounding), so the standard error, z and interval are not meaningful.");
  lines.push("");
  lines.push(
    `Conventions: one weighted least-squares fit of ${q(yName)} on [1, D, u, D·u${order === 2 ? ", u², D·u²" : ""}] with u = ${xName} − c and D = 1{${xName} ≥ c}, ` +
      `weights K(u/h) (${kernel === "triangular" ? "K(v) = 1 − |v|" : kernel === "epanechnikov" ? "K(v) = 0.75(1 − v²)" : "K(v) = ½"} on ${kernel === "uniform" ? "|v| ≤ 1" : "|v| < 1"}); only observations with positive weight are used. ` +
      (design === "sharp"
        ? "τ is the coefficient on D: the jump of the fitted outcome at the cutoff."
        : `τ = (jump in ${yName})/(jump in ${q(cols.names[1])}) from the same design, the just-identified 2SLS estimate with D instrumenting the treatment (the treatment effect for compliers at the cutoff).`),
  );
  lines.push(
    "Standard errors: conventional heteroskedasticity-robust HC1, n/(n − k)·(X′WX)⁻¹(Σwᵢ²eᵢ²xᵢxᵢ′)(X′WX)⁻¹ (statsmodels WLS with its HC1 covariance" +
      (design === "fuzzy" ? "; for the ratio the residual is eʸ − τeᵗ, as linearmodels IV2SLS with weights, debiased" : "") +
      "), normal reference. These are NOT the Calonico–Cattaneo–Titiunik robust bias-corrected intervals (rdrobust): no bias correction is made, so the interval assumes the bandwidth is small enough for the smoothing bias to be negligible.",
  );
  if (ik) {
    lines.push(
      `Bandwidth: the Imbens–Kalyanaraman MSE-optimal rule for local linear fits as written in NBER Working Paper 14726 (2009), §4.2, eqs. 4.8–4.13 (the algorithm of Rev. Econ. Stud. 79(3), 2012): ` +
        "pilot h₁ = 1.84·Sₓ·N to the power −1/5 (Sₓ the standard deviation of the running variable); f̂(c) = (N₋ + N₊)/(2Nh₁); σ̂²(c) pooled over [c − h₁, c) and [c, c + h₁]; m̂⁽³⁾ = 6γ̂₃ from a global cubic with a jump fitted between the two side medians; " +
        "h₂,± = 3.56·(σ̂²/(f̂·max(m̂⁽³⁾², 0.01))) to the power 1/7 × N± to the power −1/7; m̂⁽²⁾± from quadratics on [c, c + h₂,₊] and [c − h₂,₋, c); r̂± = 720σ̂²/(N₂,±h₂,±⁴); " +
        `ĥ = Cₖ·(2σ̂²/(f̂((m̂⁽²⁾₊ − m̂⁽²⁾₋)² + r̂₊ + r̂₋))) to the power 1/5 × N to the power −1/5 with Cₖ = ${fmtFixed(IK_CK[kernel], 4)} for the ${KERNEL_NAME[kernel]} kernel (IK Lemma 3.1).` +
        (design === "fuzzy" ? " For the fuzzy design the bandwidth is the sharp rule applied to the outcome (as R's rdd package does), not IK's separate fuzzy formula." : ""),
    );
  }
  lines.push("No McCrary density (manipulation) test is run.");
  lines.push(...cols.notes);
  // Estimate table.
  const head = ["Quantity", "Estimate", "SE", "z", "p", "95% CI"];
  const est = (label: string, e: number, s: number): string[] => [label, fmtFixed(e, d), fmtFixed(s, d), fmtFixed(e / s, 3), fmtP(zP(e / s)), ci(e, s, d)];
  const estRows: string[][] = [head];
  if (fit.fs && fit.rfY) {
    estRows.push(est(`Jump in ${yName} (reduced form)`, fit.rfY.est, fit.rfY.se));
    estRows.push(est(`Jump in ${cols.names[1]} (first stage)`, fit.fs.est, fit.fs.se));
    estRows.push(est("Fuzzy RD effect τ (ratio)", fit.tau, fit.se));
  } else estRows.push(est(`Jump in ${yName} at the cutoff (τ)`, fit.tau, fit.se));
  const tables: StatTable[] = [
    { label: `${kind} regression discontinuity (local ${order === 1 ? "linear" : "quadratic"}, ${KERNEL_NAME[kernel]} kernel, h = ${fmtFixed(h, 4)}; HC1 standard errors)`, rows: estRows, align: ["left", "right", "right", "right", "right", "right"] },
  ];
  // Sensitivity to the bandwidth.
  const sens: string[][] = [["Bandwidth", "n left", "n right", "τ", "SE", "95% CI"]];
  for (const m of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const r = rdFit(x, y, t, c, h * m, kernel, order);
    if ("error" in r) sens.push([`${fmtFixed(h * m, 4)} (${m}h)`, "", "", "too few observations", "", ""]);
    else sens.push([`${fmtFixed(h * m, 4)} (${m === 1 ? "h" : `${m}h`})`, intText(r.nL), intText(r.nR), fmtFixed(r.tau, d), fmtFixed(r.se, d), ci(r.tau, r.se, d)]);
  }
  tables.push({ label: "Sensitivity of τ to the bandwidth", rows: sens, align: ["left", "right", "right", "right", "right", "right"], note: "Same kernel, order and standard errors at multiples of h." });
  if (ik) {
    const s = ik;
    tables.push({
      label: "Imbens–Kalyanaraman bandwidth, step by step",
      rows: [
        ["Quantity", "Value"],
        ["Pilot bandwidth h₁", fmtFixed(s.h1, 4)],
        ["Density f̂(c)", fmtFixed(s.f, 4)],
        ["Conditional variance σ̂²(c)", fmtFixed(s.sigma2, 4)],
        ["Third derivative m̂⁽³⁾(c)", fmtFixed(s.m3, 4) + (s.m3 * s.m3 < 0.01 ? " (m̂⁽³⁾² < 0.01: floor 0.01 used in h₂)" : "")],
        ["Pilot h₂,₊ / h₂,₋", `${fmtFixed(s.h2p, 4)} / ${fmtFixed(s.h2m, 4)}`],
        ["Curvature m̂⁽²⁾₊ / m̂⁽²⁾₋", `${fmtFixed(s.m2p, 4)} / ${fmtFixed(s.m2m, 4)}`],
        ["Regularisation r̂₊ / r̂₋", `${fmtFixed(s.rp, 4)} / ${fmtFixed(s.rm, 4)}`],
        ["ĥ without regularisation", fmtFixed(s.hNoReg, 4)],
        ["ĥ (used)", fmtFixed(s.h, 4)],
      ],
      align: ["left", "right"],
    });
  }
  // Binned scatter with the fitted lines.
  const binPts = (lo: number, hi: number, right: boolean): { x: number; y: number }[] => {
    const sx = new Array<number>(bins).fill(0);
    const sy = new Array<number>(bins).fill(0);
    const cnt = new Array<number>(bins).fill(0);
    const width = (hi - lo) / bins;
    for (let i = 0; i < n; i++) {
      if (right ? x[i] < c : x[i] >= c) continue;
      let b = width > 0 ? Math.floor((x[i] - lo) / width) : 0;
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      sx[b] += x[i];
      sy[b] += y[i];
      cnt[b]++;
    }
    const out: { x: number; y: number }[] = [];
    for (let b = 0; b < bins; b++) if (cnt[b]) out.push({ x: sx[b] / cnt[b], y: sy[b] / cnt[b] });
    return out;
  };
  const leftPts = binPts(xmin, c, false);
  const rightPts = binPts(c, xmax, true);
  const evalPoly = (p: number[], u: number): number => p.reduce((acc, v, j) => acc + v * Math.pow(u, j), 0);
  // The fitted outcome line: in the fuzzy design the reduced form is drawn (the outcome's own jump).
  const fy = t ? rdFit(x, y, null, c, h, kernel, order) : fit;
  const curve = (lo: number, hi: number, p: number[]): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    if (!(hi > lo)) return pts;
    for (let j = 0; j <= 40; j++) {
      const xv = lo + ((hi - lo) * j) / 40;
      pts.push({ x: xv, y: evalPoly(p, xv - c) });
    }
    return pts;
  };
  const series: Series[] = [
    { type: "scatter", points: leftPts, color: "#64748b", label: "Bin means" },
    { type: "scatter", points: rightPts, color: "#64748b" },
  ];
  if (!("error" in fy)) {
    series.push({ type: "line", points: curve(Math.max(xmin, c - h), c, fy.polyL), color: "#0369a1", label: `Local ${order === 1 ? "linear" : "quadratic"} fit` });
    series.push({ type: "line", points: curve(c, Math.min(xmax, c + h), fy.polyR), color: "#0369a1" });
  }
  let ylo = Infinity;
  let yhi = -Infinity;
  for (const s of series) for (const p of s.points) {
    ylo = Math.min(ylo, p.y);
    yhi = Math.max(yhi, p.y);
  }
  series.push({ type: "line", points: [{ x: c, y: ylo }, { x: c, y: yhi }], color: "#cbd5e1" });
  const svg = buildPlotSvg(series, {
    width: 420,
    height: 270,
    title: "Regression discontinuity",
    xlabel: xName,
    ylabel: yName,
    notes: [`${bins} equal-width bins per side; fitted lines within c ± h${t ? " (reduced form of the outcome)" : ""}; vertical line at the cutoff.`],
  });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic control

export interface ScWeights {
  w: number[];
  /** Root mean squared prediction error over the pre-period. */
  preRmspe: number;
}

/** Relative ridge added to Z′Z so the QP is strictly convex when donors ≥ pre-periods (the weights are then not unique). */
export const SC_RIDGE = 1e-8;

/** Solves M·x = r for each right-hand side by Cholesky; null when M is not numerically positive definite. */
function cholSolve(M: number[][], rhs: number[][]): number[][] | null {
  const m = M.length;
  const L: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  let dmax = 0;
  for (let i = 0; i < m; i++) dmax = Math.max(dmax, M[i][i]);
  for (let j = 0; j < m; j++) {
    let s = M[j][j];
    for (let p = 0; p < j; p++) s -= L[j][p] * L[j][p];
    if (!(s > 1e-14 * dmax)) return null;
    const d = Math.sqrt(s);
    L[j][j] = d;
    for (let i = j + 1; i < m; i++) {
      let t = M[i][j];
      for (let p = 0; p < j; p++) t -= L[i][p] * L[j][p];
      L[i][j] = t / d;
    }
  }
  return rhs.map((r) => {
    const y = new Array<number>(m);
    for (let i = 0; i < m; i++) {
      let s = r[i];
      for (let p = 0; p < i; p++) s -= L[i][p] * y[p];
      y[i] = s / L[i][i];
    }
    for (let i = m - 1; i >= 0; i--) {
      let s = y[i];
      for (let p = i + 1; p < m; p++) s -= L[p][i] * y[p];
      y[i] = s / L[i][i];
    }
    return y;
  });
}

/**
 * min ½w′Gw − c′w subject to w ≥ 0, Σw = 1 (G positive definite), by a primal active-set method in the style of
 * Lawson & Hanson's NNLS (Solving Least Squares Problems, 1974, ch. 23) with the equality kept exactly: the free set's
 * subproblem min ½z′G_FFz − c_F′z s.t. Σz = 1 is solved in closed form from two Cholesky solves; a donor enters when its
 * reduced gradient exceeds the free set's (its bound multiplier is negative) and leaves when the step to the subproblem
 * solution would make it negative. A donor that leaves at a zero step right after entering is not re-admitted until the
 * iterate moves (degeneracy). Bounded: at most 20J + 20 subproblem solves, then a refusal.
 *
 * (The F1 qpActiveSet.ts solver was tried first and cycled on near-collinear donor pools, the common case in synthetic
 * control, so this dedicated simplex solver is used.)
 */
export function simplexLs(G: number[][], c: number[], start: number): { ok: true; w: number[]; iterations: number } | { ok: false; reason: string } {
  const J = c.length;
  let scale = 0;
  for (let i = 0; i < J; i++) scale = Math.max(scale, Math.abs(G[i][i]), Math.abs(c[i]));
  if (!(scale > 0) || !Number.isFinite(scale)) return { ok: false, reason: "the pre-period outcomes are all zero or not finite." };
  const tol = 1e-11 * scale;
  const w = new Array<number>(J).fill(0);
  w[start] = 1;
  let F = [start];
  const maxIter = 20 * J + 20;
  let it = 0;
  const rejected = new Set<number>();
  const solveSub = (free: number[]): number[] | null => {
    if (free.length === 1) return [1];
    const M = free.map((a) => free.map((b) => G[a][b]));
    const sol = cholSolve(M, [free.map((a) => c[a]), free.map(() => 1)]);
    if (!sol) return null;
    const [y1, y2] = sol;
    const s1 = y1.reduce((a, v) => a + v, 0);
    const s2 = y2.reduce((a, v) => a + v, 0);
    const mu = (1 - s1) / s2;
    return y1.map((v, k) => v + mu * y2[k]);
  };
  for (;;) {
    const g = new Array<number>(J);
    for (let j = 0; j < J; j++) {
      let s = c[j];
      for (let k = 0; k < J; k++) if (w[k] !== 0) s -= G[j][k] * w[k];
      g[j] = s;
    }
    const gbar = F.reduce((a, j) => a + g[j], 0) / F.length;
    const inF = new Set(F);
    let enter = -1;
    let best = tol;
    for (let j = 0; j < J; j++) {
      if (inF.has(j) || rejected.has(j)) continue;
      if (g[j] - gbar > best) {
        best = g[j] - gbar;
        enter = j;
      }
    }
    if (enter < 0) return { ok: true, w, iterations: it };
    F = [...F, enter];
    let firstInner = true;
    for (;;) {
      if (++it > maxIter) return { ok: false, reason: `the donor-weight solver did not settle within ${maxIter} steps.` };
      const z = solveSub(F);
      if (!z) return { ok: false, reason: "the donor-weight subproblem is singular." };
      if (z.every((v) => v > 0)) {
        F.forEach((j, k) => (w[j] = z[k]));
        rejected.clear();
        break;
      }
      let alpha = 1;
      F.forEach((j, k) => {
        if (z[k] <= 0) {
          const a = w[j] / (w[j] - z[k]);
          if (a < alpha) alpha = a;
        }
      });
      F.forEach((j, k) => (w[j] += alpha * (z[k] - w[j])));
      const leaving = F.filter((j, k) => w[j] <= 1e-15 || (z[k] <= 0 && w[j] <= 1e-12));
      for (const j of leaving) w[j] = 0;
      F = F.filter((j) => w[j] > 0);
      if (firstInner && alpha === 0 && leaving.length === 1 && leaving[0] === enter) {
        rejected.add(enter);
        break;
      }
      if (alpha > 0) rejected.clear();
      firstInner = false;
      if (!F.length) return { ok: false, reason: "the donor-weight solver lost every donor (a numerical failure)." };
    }
  }
}

/**
 * Donor weights minimising Σₜ₍pre₎ (z₁ₜ − Σⱼ wⱼzⱼₜ)² + λ‖w‖² subject to w ≥ 0, Σw = 1, λ = 10⁻⁸·tr(Z′Z)/J, by
 * simplexLs started from the best single donor. z: the pre-period outcomes, column j = donor j.
 */
export function scWeights(z1: ArrayLike<number>, Z: number[][]): ScWeights | { error: string } {
  const T0 = z1.length;
  const J = Z[0].length;
  const G: number[][] = Array.from({ length: J }, () => new Array<number>(J).fill(0));
  const cvec = new Array<number>(J).fill(0);
  for (let t = 0; t < T0; t++) {
    const row = Z[t];
    for (let a = 0; a < J; a++) {
      cvec[a] += row[a] * z1[t];
      for (let b = 0; b <= a; b++) G[a][b] += row[a] * row[b];
    }
  }
  let tr = 0;
  for (let a = 0; a < J; a++) {
    for (let b = a + 1; b < J; b++) G[a][b] = G[b][a];
    tr += G[a][a];
  }
  const lam = (SC_RIDGE * tr) / J;
  for (let a = 0; a < J; a++) G[a][a] += lam;
  // Start at the donor with the smallest pre-period error.
  let best = 0;
  let bestErr = Infinity;
  for (let j = 0; j < J; j++) {
    let e = 0;
    for (let t = 0; t < T0; t++) e += (z1[t] - Z[t][j]) ** 2;
    if (e < bestErr) {
      bestErr = e;
      best = j;
    }
  }
  const r = simplexLs(G, cvec, best);
  if (!r.ok) return { error: `The donor-weight optimization failed: ${r.reason}` };
  const s = r.w.reduce((a, v) => a + v, 0);
  const w = r.w.map((v) => (v > 0 ? v / s : 0));
  let e2 = 0;
  for (let t = 0; t < T0; t++) {
    let f = 0;
    for (let j = 0; j < J; j++) f += Z[t][j] * w[j];
    e2 += (z1[t] - f) ** 2;
  }
  return { w, preRmspe: Math.sqrt(e2 / T0) };
}

export interface ScPlacebo {
  unit: string;
  pre: number;
  post: number;
  ratio: number;
  gaps: number[];
}

export interface ScResult {
  periods: number[];
  T0: number;
  treatedName: string;
  donorNames: string[];
  w: number[];
  treated: number[];
  synth: number[];
  gap: number[];
  pre: number;
  post: number;
  ratio: number;
  placebos: ScPlacebo[] | null;
  /** Units (treated first) ranked by ratio: p = (# ratio ≥ treated's)/(J + 1). */
  rank: number;
  p: number;
}

function rmspe(g: number[], from: number, to: number): number {
  let s = 0;
  for (let t = from; t < to; t++) s += g[t] * g[t];
  return Math.sqrt(s / (to - from));
}

/** Weights, path and RMSPEs for unit `ti` against donors `dj` (column indices into Y, a periods × units matrix). */
function scRun(Y: number[][], ti: number, dj: number[], T0: number): { w: number[]; synth: number[]; gap: number[]; pre: number; post: number } | { error: string } {
  const T = Y.length;
  const z1 = Y.slice(0, T0).map((row) => row[ti]);
  const Z = Y.slice(0, T0).map((row) => dj.map((j) => row[j]));
  const r = scWeights(z1, Z);
  if ("error" in r) return r;
  const synth = Y.map((row) => dj.reduce((acc, j, k) => acc + r.w[k] * row[j], 0));
  const gap = Y.map((row, t) => row[ti] - synth[t]);
  return { w: r.w, synth, gap, pre: rmspe(gap, 0, T0), post: rmspe(gap, T0, T) };
}

/** Synthetic control on a periods × units matrix: unit 0 treated, units 1…J donors. */
export function synthControl(periods: number[], Y: number[][], names: string[], T0: number, placebo: boolean): ScResult | { error: string } {
  const U = names.length;
  const donors = Array.from({ length: U - 1 }, (_, k) => k + 1);
  const main = scRun(Y, 0, donors, T0);
  if ("error" in main) return main;
  // RMSPEs below 10⁻¹⁰ of the data's scale are rounding: they are 0, and a zero pre-period RMSPE makes the ratio
  // unbounded (or 0 when the post-period gap is zero too).
  let scale = 0;
  for (const row of Y) for (const v of row) scale = Math.max(scale, Math.abs(v));
  const tiny = 1e-10 * Math.max(scale, 1e-300);
  const snap = (v: number): number => (v <= tiny ? 0 : v);
  const ratioOf = (post: number, pre: number): number => {
    const a = snap(post);
    const b = snap(pre);
    return b > 0 ? a / b : a > 0 ? Infinity : 0;
  };
  main.pre = snap(main.pre);
  main.post = snap(main.post);
  if (main.pre === 0 && main.post === 0) return { error: `The synthetic control reproduces ${q(names[0])} exactly in every period (no gap before or after treatment), so there is no effect to measure.` };
  const ratio = ratioOf(main.post, main.pre);
  let placebos: ScPlacebo[] | null = null;
  let rank = 1;
  let p = 1;
  if (placebo && U - 1 >= 2) {
    placebos = [];
    for (const j of donors) {
      const others = donors.filter((k) => k !== j);
      const r = scRun(Y, j, others, T0);
      if ("error" in r) return { error: `Placebo for ${q(names[j])}: ${r.error}` };
      placebos.push({ unit: names[j], pre: snap(r.pre), post: snap(r.post), ratio: ratioOf(r.post, r.pre), gaps: r.gap });
    }
    // Ties count against the treated unit (≥), so the p-value is conservative.
    rank = 1 + placebos.filter((pl) => pl.ratio >= ratio * (1 - 1e-12)).length;
    p = rank / U;
  }
  return {
    periods,
    T0,
    treatedName: names[0],
    donorNames: names.slice(1),
    w: main.w,
    treated: Y.map((row) => row[0]),
    synth: main.synth,
    gap: main.gap,
    pre: main.pre,
    post: main.post,
    ratio,
    placebos,
    rank,
    p,
  };
}

/** The worked default: 30 years (1990–2019) of an outcome for 13 regions; Region A is treated from 2010. */
export function scDefaultTable(): string {
  const { u, g } = lcg(20261026);
  const J = 12;
  const T = 30;
  const a: number[] = [];
  const b1: number[] = [];
  const b2: number[] = [];
  for (let j = 0; j < J; j++) {
    a.push(50 + Math.floor(u() * 40));
    b1.push(0.5 + u());
    b2.push(u() * 2);
  }
  const f2: number[] = [];
  let walk = 0;
  for (let t = 0; t < T; t++) {
    walk += g();
    f2.push(walk);
  }
  const names = "ABCDEFGHIJKLM".split("").map((ch) => `Region ${ch}`);
  const lines = [["Year", ...names].join("\t")];
  for (let t = 0; t < T; t++) {
    const sys: number[] = [];
    for (let j = 0; j < J; j++) sys.push(a[j] + b1[j] * t + b2[j] * f2[t]);
    const treated = 0.4 * sys[0] + 0.35 * sys[1] + 0.25 * sys[2] + 0.5 * g() - (t >= 20 ? 0.8 * (t - 19) : 0);
    const row = [String(1990 + t), fmtInt(Math.floor(treated * 10 + 0.5), 1)];
    for (let j = 0; j < J; j++) row.push(fmtInt(Math.floor((sys[j] + g()) * 10 + 0.5), 1));
    lines.push(row.join("\t"));
  }
  return lines.join("\n");
}

function ratioText(v: number): string {
  return Number.isFinite(v) ? fmtFixed(v, 3) : "unbounded (exact pre-period fit)";
}

/** causal-synth: synthetic control. */
export function synthCalc(read: Read): StatOutput {
  const get = getter(read);
  const text = get("data");
  if (text.length > CAUSAL_TEXT_MAX) return refuse(`The data table is longer than ${intText(CAUSAL_TEXT_MAX)} characters.`);
  const parsed = parseRegData(text);
  if (!parsed.ok) return refuse(parsed.reason);
  const data: RegDataset = parsed.data;
  if (!data.named) return refuse("The table needs a header row: the period column's name, then one name per unit.");
  const placeboRaw = get("placebo").trim() || "yes";
  if (placeboRaw !== "yes" && placeboRaw !== "no") return refuse(`Placebo inference: ${q(placeboRaw)} is not yes or no.`);
  const periodRaw = get("period").trim();
  let pIdx = 0;
  if (periodRaw) {
    const r = findColumn(data.names, periodRaw);
    if (typeof r !== "number") return refuse(`Period column: ${r.error}`);
    pIdx = r;
  }
  const treatedRaw = get("treated").trim();
  if (!treatedRaw) return refuse("Treated unit: name the treated unit's column.");
  const tIdx = findColumn(data.names, treatedRaw);
  if (typeof tIdx !== "number") return refuse(`Treated unit: ${tIdx.error}`);
  if (tIdx === pIdx) return refuse(`${q(data.names[tIdx])} is the period column; it cannot also be the treated unit.`);
  const donorRaw = get("donors").trim();
  let dIdx: number[];
  if (donorRaw) {
    const parts = donorRaw.split(/[+,]/).map((s) => s.trim());
    if (parts.some((s) => !s)) return refuse("Donor units: an empty name (two separators in a row?).");
    dIdx = [];
    for (const nm of parts) {
      const j = findColumn(data.names, nm);
      if (typeof j !== "number") return refuse(`Donor units: ${j.error}`);
      if (j === pIdx) return refuse(`${q(data.names[j])} is the period column; it cannot be a donor.`);
      if (j === tIdx) return refuse(`${q(data.names[j])} is the treated unit; it cannot also be a donor.`);
      if (dIdx.includes(j)) return refuse(`Donor units: ${q(data.names[j])} is listed twice.`);
      dIdx.push(j);
    }
  } else dIdx = data.names.map((_, j) => j).filter((j) => j !== pIdx && j !== tIdx);
  if (dIdx.length < 2) return refuse(`The donor pool has ${dIdx.length} unit${dIdx.length === 1 ? "" : "s"}; a synthetic control needs at least 2.`);
  if (dIdx.length > SC_MAX_DONORS) return refuse(`The donor pool has ${intText(dIdx.length)} units; the synthetic-control calculator takes at most ${SC_MAX_DONORS} (name a smaller pool in Donor units).`);
  const sel = selectColumns(data, { dep: data.names[pIdx], preds: [data.names[tIdx], ...dIdx.map((j) => data.names[j])], text: "" });
  if (!sel.ok) return refuse(`${sel.reason} The period column must hold numbers (years such as 1990, 1991, … or period numbers), and each unit column its outcome.`);
  const cols = sel.cols;
  const T = cols.y.length;
  if (T > SC_MAX_PERIODS) return refuse(`The table has ${intText(T)} periods; the synthetic-control calculator takes at most ${SC_MAX_PERIODS}.`);
  const periods = Array.from(cols.y);
  for (let t = 1; t < T; t++) {
    if (!(periods[t] > periods[t - 1])) return refuse(`Period column ${q(cols.depName)}: the periods must increase down the table (${fmtFixed(periods[t - 1], 0)} is followed by ${fmtFixed(periods[t], 0)}); sort the rows by period.`);
  }
  const startRes = readNumber(get("start"), "First treated period");
  if (typeof startRes !== "number") return refuse(startRes.error);
  const T0 = periods.filter((v) => v < startRes).length;
  if (T0 < 2) return refuse(`First treated period: only ${T0} period${T0 === 1 ? " is" : "s are"} before ${numText(startRes)}; the weights need at least 2 pre-treatment periods.`);
  if (T0 === T) return refuse(`First treated period: no period is at or after ${numText(startRes)}, so there is no post-treatment period.`);
  const Y = periods.map((_, t) => cols.X.map((col) => col[t]));
  for (const row of Y) for (const v of row) if (Math.abs(v) > 1e12) return refuse("An outcome value exceeds 10¹² in magnitude; rescale the outcome (for example to thousands).");
  const names = cols.names;
  const r = synthControl(periods, Y, names, T0, placeboRaw === "yes");
  if ("error" in r) return refuse(r.error);
  const J = names.length - 1;
  const lab = (v: number): string => (Number.isInteger(v) ? String(v).replace("-", MINUS) : fmtFixed(v, 2));
  const att = r.gap.slice(T0).reduce((a, v) => a + v, 0) / (T - T0);
  const lines: string[] = [];
  lines.push(`Synthetic control: ${q(r.treatedName)} against ${J} donors; pre-period ${lab(periods[0])}–${lab(periods[T0 - 1])} (${T0} periods), post-period ${lab(periods[T0])}–${lab(periods[T - 1])} (${T - T0})`);
  // The data's printed precision: the most decimals any outcome value needs (to 10). A pre-period RMSPE below half a
  // unit in that last place is an exact fit to the data as given: the post/pre ratio is then rounding over rounding
  // (or unbounded), and its rank is not evidence of anything.
  let decimals = 0;
  for (const row of Y)
    for (const v of row) {
      for (; decimals < 10; decimals++) {
        const s = v * Math.pow(10, decimals);
        if (Math.abs(s - Math.round(s)) <= 1e-9 * Math.max(1, Math.abs(s))) break;
      }
    }
  const halfUlp = 0.5 * Math.pow(10, -decimals);
  const exactPre = r.pre < halfUlp;
  const precText = `half a unit in the data's last decimal place, ${fmtFixed(halfUlp, Math.min(6, decimals + 1))}`;
  lines.push(
    `Average post-period gap (treated − synthetic) = ${fmtFixed(att, 3)}; pre-period RMSPE = ${fmtFixed(r.pre, 3)}, post-period RMSPE = ${fmtFixed(r.post, 3)}, post/pre ratio = ${exactPre ? `not informative (the pre-period fit is exact to the data's precision: RMSPE below ${precText})` : ratioText(r.ratio)}`,
  );
  if (r.placebos && exactPre) {
    lines.push(
      `In-space placebo inference is not informative here: the treated unit's pre-period RMSPE is below ${precText}, so its post/pre ratio divides by rounding and its permutation rank and p-value are not evidence of an effect (they are not reported). The placebo table shows the units' RMSPEs.`,
    );
  } else if (r.placebos) lines.push(`In-space placebo inference: the treated unit's post/pre RMSPE ratio ranks ${r.rank} of ${J + 1}, permutation p = ${r.rank}/${J + 1} = ${fmtFixed(r.p, 3)}`);
  else lines.push(placeboRaw === "no" ? "Placebo inference not run (switched off)." : "Placebo inference needs at least 2 donors.");
  lines.push("");
  lines.push(
    "Conventions: weights w ≥ 0 with Σw = 1 minimize the pre-period squared gap Σₜ(Y₁ₜ − ΣⱼwⱼYⱼₜ)² (Abadie, Diamond & Hainmueller 2010, J. Am. Stat. Assoc. 105(490), with the pre-period outcomes as the only predictors and V = I), " +
      `plus a ridge λ‖w‖², λ = 10⁻⁸·tr(Z′Z)/J, that makes the problem strictly convex when donors outnumber pre-periods (it moves the fit by a negligible amount); solved by a primal active-set quadratic program. ` +
      "Covariate predictors and ADH's data-driven V (the nested optimization) are NOT implemented. RMSPE = √(mean squared gap) over the period.",
  );
  if (r.placebos) {
    lines.push(
      "Placebos: each donor in turn is treated as if it had been treated, with the other donors (never the real treated unit) as its pool; " +
        "p = (number of units whose post/pre RMSPE ratio is at least the treated unit's, the treated unit included)/(J + 1), ties counted against the treated unit. " +
        "With few donors the smallest attainable p is 1/(J + 1).",
    );
  }
  if (T0 < 5) lines.push(`Only ${T0} pre-treatment periods: almost any donor mix can match so short a history, so a close pre-period fit is weak evidence that the synthetic control tracks the counterfactual.`);
  if (r.placebos && r.placebos.some((pl) => !Number.isFinite(pl.ratio))) lines.push("A placebo whose synthetic control fits its pre-period exactly (RMSPE 0) has an unbounded ratio and ranks above the treated unit.");
  if (J >= T0) lines.push(`There are ${J} donors and only ${T0} pre-periods, so many weight vectors fit nearly equally well; the weights are one solution (the ridge picks it), and the synthetic path is better determined than the individual weights.`);
  {
    let outside = 0;
    for (let t = 0; t < T0; t++) {
      const col = Y[t].slice(1);
      if (r.treated[t] > Math.max(...col) || r.treated[t] < Math.min(...col)) outside++;
    }
    if (outside > 0) lines.push(`In ${outside} of ${T0} pre-periods the treated unit lies outside the donors' range, where no convex combination can match it; read the fit with care.`);
  }
  lines.push(...cols.notes);
  // Tables.
  const order = r.w.map((v, j) => [v, j] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const wRows: string[][] = [["Donor", "Weight"]];
  let small = 0;
  for (const [v, j] of order) {
    if (v >= 0.0005) wRows.push([r.donorNames[j], fmtFixed(v, 3)]);
    else small++;
  }
  const tables: StatTable[] = [
    { label: `Synthetic ${r.treatedName}: donor weights`, rows: wRows, align: ["left", "right"], note: small ? `${small} donor${small === 1 ? " has" : "s have"} weight below 0.0005 (shown as none).` : undefined },
  ];
  const pRows: string[][] = [["Period", r.treatedName, `Synthetic ${r.treatedName}`, "Gap"]];
  for (let t = 0; t < T; t++) pRows.push([lab(periods[t]) + (t === T0 ? " (treated from)" : ""), fmtFixed(r.treated[t], 3), fmtFixed(r.synth[t], 3), fmtFixed(r.gap[t], 3)]);
  tables.push({ label: "Treated and synthetic paths", rows: pRows, align: ["left", "right", "right", "right"] });
  if (r.placebos) {
    const all = [{ unit: `${r.treatedName} (treated)`, pre: r.pre, post: r.post, ratio: r.ratio, treated: true }, ...r.placebos.map((pl) => ({ ...pl, treated: false }))].sort((a, b) => (b.ratio > a.ratio ? 1 : b.ratio < a.ratio ? -1 : 0));
    const plRows: string[][] = [["Unit", "Pre RMSPE", "Post RMSPE", "Post/pre ratio", "Rank"]];
    all.forEach((u, k) => plRows.push([u.unit, fmtFixed(u.pre, 3), fmtFixed(u.post, 3), u.treated && exactPre ? "not informative" : ratioText(u.ratio), u.treated && exactPre ? "not ranked" : String(k + 1)]));
    tables.push({ label: "In-space placebos (ranked by post/pre RMSPE ratio)", rows: plRows, align: ["left", "right", "right", "right", "right"] });
  }
  // Figure: (a) treated vs synthetic; (b) the gap with the placebo gaps.
  const pts = (v: number[]): { x: number; y: number }[] => v.map((y, t) => ({ x: periods[t], y }));
  const xMark = (periods[T0 - 1] + periods[T0]) / 2;
  const span = (vals: number[]): [number, number] => [Math.min(...vals), Math.max(...vals)];
  const [a1, b1] = span([...r.treated, ...r.synth]);
  const top = buildPlotSvg(
    [
      { type: "line", points: pts(r.treated), color: "#0f172a", label: r.treatedName },
      { type: "line", points: pts(r.synth), color: "#0369a1", label: `Synthetic ${r.treatedName}` },
      { type: "line", points: [{ x: xMark, y: a1 }, { x: xMark, y: b1 }], color: "#cbd5e1" },
    ],
    { width: 420, height: 250, title: "Treated and synthetic control", xlabel: "Period", ylabel: "Outcome", xTickLabel: (v) => lab(Math.round(v * 100) / 100) },
  );
  const gapSeries: Series[] = [];
  let omitted = 0;
  const gapVals = [...r.gap];
  if (r.placebos) {
    for (const pl of r.placebos) {
      // ADH's display rule: a placebo fitting the pre-period far worse (MSPE more than 5× the treated unit's) is left out of the figure.
      if (pl.pre * pl.pre > 5 * r.pre * r.pre && r.pre > 0) {
        omitted++;
        continue;
      }
      gapSeries.push({ type: "line", points: pts(pl.gaps), color: "#cbd5e1", ...(gapSeries.length === 0 ? { label: "Placebo gaps" } : {}) });
      gapVals.push(...pl.gaps);
    }
  }
  gapSeries.push({ type: "line", points: pts(r.gap), color: "#0369a1", label: `${r.treatedName} gap` });
  const [a2, b2] = span(gapVals);
  gapSeries.push({ type: "line", points: [{ x: periods[0], y: 0 }, { x: periods[T - 1], y: 0 }], color: "#94a3b8" });
  gapSeries.push({ type: "line", points: [{ x: xMark, y: Math.min(a2, 0) }, { x: xMark, y: Math.max(b2, 0) }], color: "#94a3b8" });
  const bottom = buildPlotSvg(gapSeries, {
    width: 420,
    height: 250,
    title: "Gap: treated − synthetic",
    xlabel: "Period",
    ylabel: "Gap",
    xTickLabel: (v) => lab(Math.round(v * 100) / 100),
    notes: omitted ? [`${omitted} placebo${omitted === 1 ? "" : "s"} with pre-period MSPE above 5× the treated unit's not drawn (all are in the p-value).`] : undefined,
  });
  const svg = combineSvgs([top, bottom]).svg;
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------------------------------------------------------
// Propensity score

export type PsEstimand = "att" | "ate";
export type PsWeights = "hajek" | "ht";

export interface PsMatch {
  est: number;
  /** Per-unit weights (0 = unused): treated and control weights for the balance table. */
  w: number[];
  nMatchedT: number;
  nMatchedC: number;
  /** Units with no match within the caliper (dropped). */
  dropped: number;
  controlsUsed: number;
}

/**
 * Nearest-neighbour matching on the linear predictor η = logit p̂. ATT: each treated unit takes its k nearest controls
 * (ties broken by the earlier row); without replacement (k = 1) greedily, treated units in order of decreasing p̂ (MatchIt's
 * m.order = "largest"), each taking the nearest unused control. ATE (with replacement): controls are also matched to
 * their k nearest treated. A caliper (in η units) discards matches farther away; a unit with none is dropped.
 */
export function psMatch(eta: number[], T: number[], Y: number[], estimand: PsEstimand, k: number, replace: boolean, caliper: number): PsMatch | { error: string } {
  const n = eta.length;
  const idxT = [] as number[];
  const idxC = [] as number[];
  for (let i = 0; i < n; i++) (T[i] === 1 ? idxT : idxC).push(i);
  const w = new Array<number>(n).fill(0);
  const sortedBy = (ids: number[]): number[] => [...ids].sort((a, b) => eta[a] - eta[b] || a - b);
  /** k nearest of `pool` (sorted by η) to value v; ties to the earlier row. */
  const nearest = (pool: number[], v: number): number[] => {
    let lo = 0;
    let hi = pool.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (eta[pool[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    // Expand outward; a block of equal η is wholly considered so the earlier-row tie-break is exact.
    let L = lo - 1;
    let R = lo;
    const cand: number[] = [];
    while (L >= 0 || R < pool.length) {
      const dl = L >= 0 ? v - eta[pool[L]] : Infinity;
      const dr = R < pool.length ? eta[pool[R]] - v : Infinity;
      if (dl <= dr) cand.push(pool[L--]);
      else cand.push(pool[R++]);
      if (cand.length >= k) {
        const kth = Math.abs(eta[cand[k - 1]] - v);
        const nextL = L >= 0 ? v - eta[pool[L]] : Infinity;
        const nextR = R < pool.length ? eta[pool[R]] - v : Infinity;
        if (nextL > kth && nextR > kth) break;
      }
    }
    cand.sort((a, b) => Math.abs(eta[a] - v) - Math.abs(eta[b] - v) || a - b);
    return cand.slice(0, k).filter((j) => Math.abs(eta[j] - v) <= caliper);
  };
  let sumDiff = 0;
  let nUsedUnits = 0;
  let dropped = 0;
  if (estimand === "att" && !replace) {
    // Controls sorted by η; used ones are skipped with two path-compressed "nearest free position" maps (O(log n) a query).
    const pool = sortedBy(idxC);
    const m0 = pool.length;
    const rightOf = Array.from({ length: m0 + 1 }, (_, p) => p);
    const leftOf = Array.from({ length: m0 + 1 }, (_, p) => p); // position p stored at p + 1 (0 = the −1 sentinel)
    const findR = (p: number): number => {
      let r = p;
      while (rightOf[r] !== r) r = rightOf[r];
      while (rightOf[p] !== r) {
        const nx = rightOf[p];
        rightOf[p] = r;
        p = nx;
      }
      return r;
    };
    const findL = (p: number): number => {
      let r = p + 1;
      while (leftOf[r] !== r) r = leftOf[r];
      let q = p + 1;
      while (leftOf[q] !== r) {
        const nx = leftOf[q];
        leftOf[q] = r;
        q = nx;
      }
      return r - 1;
    };
    const orderT = [...idxT].sort((a, b) => eta[b] - eta[a] || a - b);
    for (const i of orderT) {
      const v = eta[i];
      let lo = 0;
      let hi = m0;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (eta[pool[mid]] < v) lo = mid + 1;
        else hi = mid;
      }
      const R = lo < m0 ? findR(lo) : m0;
      const L = lo - 1 >= 0 ? findL(lo - 1) : -1;
      const dr = R < m0 ? eta[pool[R]] - v : Infinity;
      const dl = L >= 0 ? v - eta[pool[L]] : Infinity;
      const bd = Math.min(dl, dr);
      if (!Number.isFinite(bd) || bd > caliper) {
        dropped++;
        continue;
      }
      // Every free control at exactly the minimum distance (a block of equal η), the earliest row wins.
      let bestPos = -1;
      for (let p = R; p < m0 && eta[pool[p]] - v === bd; p = p + 1 < m0 ? findR(p + 1) : m0) if (bestPos < 0 || pool[p] < pool[bestPos]) bestPos = p;
      for (let p = L; p >= 0 && v - eta[pool[p]] === bd; p = p - 1 >= 0 ? findL(p - 1) : -1) if (bestPos < 0 || pool[p] < pool[bestPos]) bestPos = p;
      const best = pool[bestPos];
      rightOf[bestPos] = bestPos + 1;
      leftOf[bestPos + 1] = bestPos;
      w[i] = 1;
      w[best] += 1;
      sumDiff += Y[i] - Y[best];
      nUsedUnits++;
    }
  } else {
    const poolC = sortedBy(idxC);
    const poolT = sortedBy(idxT);
    const own = new Array<number>(n).fill(0);
    const doSide = (from: number[], pool: number[], sign: 1 | -1): void => {
      for (const i of from) {
        const m = nearest(pool, eta[i]);
        if (!m.length) {
          dropped++;
          continue;
        }
        own[i] = 1;
        let my = 0;
        for (const j of m) {
          my += Y[j];
          w[j] += 1 / m.length;
        }
        my /= m.length;
        sumDiff += sign * (Y[i] - my);
        nUsedUnits++;
      }
    };
    doSide(idxT, poolC, 1);
    if (estimand === "ate") doSide(idxC, poolT, -1);
    for (let i = 0; i < n; i++) w[i] += own[i];
  }
  if (nUsedUnits === 0) return { error: "No unit has a match within the caliper; widen the caliper or leave it blank." };
  let nMatchedT = 0;
  let nMatchedC = 0;
  let controlsUsed = 0;
  for (let i = 0; i < n; i++) {
    if (w[i] > 0) {
      if (T[i] === 1) nMatchedT++;
      else {
        nMatchedC++;
        controlsUsed++;
      }
    }
  }
  return { est: sumDiff / nUsedUnits, w, nMatchedT, nMatchedC, dropped, controlsUsed };
}

export interface PsIpw {
  est: number;
  se: number;
  mu1: number;
  mu0: number;
  w: number[];
}

/**
 * IPW with the score's estimation accounted for: the stacked M-estimator (logit score equations, then the two weighted
 * means) and its sandwich A⁻¹BA⁻ᵀ/n (Lunceford & Davidian 2004 for the ATE). Weights: ATE 1/p̂ (treated), 1/(1 − p̂)
 * (controls); ATT 1 and p̂/(1 − p̂). "hajek" normalises the weights within each group (the stabilised-weight estimator);
 * "ht" is Horvitz–Thompson (ATE: means divided by n; ATT: control sum divided by n₁).
 * Xc: rows WITH the constant first, in the logit's column order; e: fitted p̂.
 */
export function psIpw(Xc: number[][], T: number[], Y: number[], e: number[], estimand: PsEstimand, kind: PsWeights): PsIpw | { error: string } {
  const n = T.length;
  const p = Xc[0].length;
  const w1 = (i: number): number => (estimand === "ate" ? 1 / e[i] : 1);
  const w0 = (i: number): number => (estimand === "ate" ? 1 / (1 - e[i]) : e[i] / (1 - e[i]));
  // dw/dβ = g·x.
  const g1 = (i: number): number => (estimand === "ate" ? -(1 - e[i]) / e[i] : 0);
  const g0 = (i: number): number => e[i] / (1 - e[i]);
  let mu1: number;
  let mu0: number;
  let n1 = 0;
  for (let i = 0; i < n; i++) n1 += T[i];
  if (kind === "hajek") {
    let a = 0;
    let b = 0;
    let c2 = 0;
    let d = 0;
    for (let i = 0; i < n; i++) {
      if (T[i] === 1) {
        a += w1(i) * Y[i];
        b += w1(i);
      } else {
        c2 += w0(i) * Y[i];
        d += w0(i);
      }
    }
    mu1 = a / b;
    mu0 = c2 / d;
  } else {
    let a = 0;
    let c2 = 0;
    for (let i = 0; i < n; i++) {
      if (T[i] === 1) a += w1(i) * Y[i];
      else c2 += w0(i) * Y[i];
    }
    const den = estimand === "ate" ? n : n1;
    mu1 = a / den;
    mu0 = c2 / den;
  }
  const dim = p + 2;
  const A: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const B: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const psi = new Array<number>(dim);
  for (let i = 0; i < n; i++) {
    const x = Xc[i];
    const ti = T[i];
    const ei = e[i];
    for (let a = 0; a < p; a++) psi[a] = (ti - ei) * x[a];
    // −∂ψ_β/∂β = e(1 − e)xx′.
    const v = ei * (1 - ei);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) A[a][b] += v * x[a] * x[b];
    let psi1: number;
    let psi0: number;
    let d1b: number; // ∂ψ₁/∂β = d1b·x
    let d0b: number;
    let d11: number; // ∂ψ₁/∂μ₁
    let d00: number;
    if (kind === "hajek" || estimand === "att") {
      // Treated part: Hájek form for both kinds when ATT (w₁ = 1: n₁-normalised mean either way).
      psi1 = ti * w1(i) * (Y[i] - mu1);
      d1b = ti * g1(i) * (Y[i] - mu1);
      d11 = -ti * w1(i);
    } else {
      psi1 = ti * w1(i) * Y[i] - mu1;
      d1b = ti * g1(i) * Y[i];
      d11 = -1;
    }
    if (kind === "hajek") {
      psi0 = (1 - ti) * w0(i) * (Y[i] - mu0);
      d0b = (1 - ti) * g0(i) * (Y[i] - mu0);
      d00 = -(1 - ti) * w0(i);
    } else if (estimand === "ate") {
      psi0 = (1 - ti) * w0(i) * Y[i] - mu0;
      d0b = (1 - ti) * g0(i) * Y[i];
      d00 = -1;
    } else {
      psi0 = (1 - ti) * w0(i) * Y[i] - ti * mu0;
      d0b = (1 - ti) * g0(i) * Y[i];
      d00 = -ti;
    }
    psi[p] = psi1;
    psi[p + 1] = psi0;
    for (let a = 0; a < p; a++) {
      A[p][a] -= d1b * x[a];
      A[p + 1][a] -= d0b * x[a];
    }
    A[p][p] -= d11;
    A[p + 1][p + 1] -= d00;
    for (let a = 0; a < dim; a++) for (let b = 0; b < dim; b++) B[a][b] += psi[a] * psi[b];
  }
  // V = A⁻¹BA⁻ᵀ/n with the sums (A and B both n× their means): Var(τ) = c′A⁻¹BA⁻ᵀc for the summed forms.
  const cvec = new Array<number>(dim).fill(0);
  cvec[p] = 1;
  cvec[p + 1] = -1;
  // Solve A′z = c, then Var = z′Bz (A summed, B summed: (ΣA)⁻¹(ΣB)(ΣA)⁻ᵀ = V).
  const At = A[0].map((_, j) => A.map((row) => row[j]));
  const z = solveDense(At, cvec);
  if (!z) return { error: "The IPW sandwich is singular (a degenerate score); no standard error can be computed." };
  let varT = 0;
  for (let a = 0; a < dim; a++) for (let b = 0; b < dim; b++) varT += z[a] * B[a][b] * z[b];
  const wts = new Array<number>(n);
  for (let i = 0; i < n; i++) wts[i] = T[i] === 1 ? w1(i) : w0(i);
  const se = Math.sqrt(varT);
  if (!Number.isFinite(mu1) || !Number.isFinite(mu0) || !Number.isFinite(se)) return { error: "The IPW estimate is not finite (propensity scores at 0 or 1)." };
  return { est: mu1 - mu0, se, mu1, mu0, w: wts };
}

/** Weighted mean and variance (divisor Σw) of x over units with T = g and w > 0. */
function wStats(x: number[], T: number[], w: number[], g: number): { m: number; v: number } {
  let sw = 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) if (T[i] === g && w[i] > 0) {
    sw += w[i];
    s += w[i] * x[i];
  }
  const m = s / sw;
  let v = 0;
  for (let i = 0; i < x.length; i++) if (T[i] === g && w[i] > 0) v += w[i] * (x[i] - m) ** 2;
  return { m, v: v / sw };
}

/** Sample mean and variance (divisor n − 1) of x over units with T = g. */
function gStats(x: number[], T: number[], g: number): { m: number; v: number; n: number } {
  let s = 0;
  let k = 0;
  for (let i = 0; i < x.length; i++) if (T[i] === g) {
    s += x[i];
    k++;
  }
  const m = s / k;
  let v = 0;
  for (let i = 0; i < x.length; i++) if (T[i] === g) v += (x[i] - m) ** 2;
  return { m, v: k > 1 ? v / (k - 1) : 0, n: k };
}

/** Logit fit → p̂ and η for the rows (X without the constant). */
export function logitScore(T: number[], X: number[][], names: string[]): { e: number[]; eta: number[] } | { error: string } {
  try {
    const m = fitLogit(T, X, names, { constant: true, depName: "treatment" });
    const p = names.length;
    const beta = m.terms.slice(0, p).map((t) => t.coef);
    const b0 = m.terms[p].coef;
    const eta = X.map((row) => row.reduce((a, v, j) => a + v * beta[j], b0));
    const e = eta.map((v) => (v >= 0 ? 1 / (1 + Math.exp(-v)) : Math.exp(v) / (1 + Math.exp(v))));
    return { e, eta };
  } catch (err) {
    if (err instanceof LogitProbitRefusal) return { error: `The propensity-score logit cannot be estimated: ${err.message}` };
    return { error: `The propensity-score logit failed (${(err as Error).message}).` };
  }
}

/** The worked default: 400 synthetic workers, a training programme taken up more by the better educated. */
export function psDefaultTable(): string {
  const { u, g } = lcg(20261028);
  const lines = ["earnings\ttraining\tage\teduc\tincome"];
  for (let i = 0; i < 400; i++) {
    const age = 20 + Math.floor(u() * 41);
    const educ = 8 + Math.floor(u() * 11);
    const inc = 10 + Math.floor(u() * 81);
    const s = (0.5 * (educ - 13)) / 5 + (0.3 * (age - 40)) / 20 - (0.4 * (inc - 50)) / 40;
    const p = Math.min(0.95, Math.max(0.05, 0.35 + 0.35 * s));
    const tr = u() < p ? 1 : 0;
    const yv = 10 + 0.8 * educ + 0.05 * age + 0.1 * inc + 2.5 * tr + 3 * g();
    lines.push([fmtInt(Math.floor(yv * 100 + 0.5), 2), String(tr), String(age), String(educ), String(inc)].join("\t"));
  }
  return lines.join("\n");
}

/** causal-pscore: propensity-score matching and weighting. */
export function pscoreCalc(read: Read): StatOutput {
  const get = getter(read);
  const method = get("method").trim() || "match";
  if (method !== "match" && method !== "ipw") return refuse(`Method: ${q(method)} is not match or ipw.`);
  const estimand = (get("estimand").trim() || "att") as PsEstimand;
  if (estimand !== "att" && estimand !== "ate") return refuse(`Estimand: ${q(estimand)} is not att or ate.`);
  const replRaw = get("replace").trim() || "yes";
  if (replRaw !== "yes" && replRaw !== "no") return refuse(`With replacement: ${q(replRaw)} is not yes or no.`);
  const replace = replRaw === "yes";
  const kRaw = get("neighbors").trim() || "1";
  const k = readIntField(kRaw, "Neighbors per unit", 1, 5);
  if (typeof k !== "number") return refuse(k.error);
  const wKind = (get("weights").trim() || "hajek") as PsWeights;
  if (wKind !== "hajek" && wKind !== "ht") return refuse(`IPW weights: ${q(wKind)} is not hajek or ht.`);
  const trim = get("trim").trim() || "none";
  if (!["none", "overlap", "crump"].includes(trim)) return refuse(`Trimming: ${q(trim)} is not none, overlap or crump.`);
  const calRaw = get("caliper").trim();
  let calSd = Infinity;
  if (calRaw) {
    const cv = readNumber(calRaw, "Caliper");
    if (typeof cv !== "number") return refuse(cv.error);
    if (!(cv > 0)) return refuse(`Caliper: ${fmtFixed(cv, 3)} must be greater than zero (blank = no caliper).`);
    calSd = cv;
  }
  if (method === "match" && !replace && estimand === "ate") return refuse("Matching without replacement estimates the ATT only (controls are used once); choose ATT, or matching with replacement for the ATE.");
  if (method === "match" && !replace && k > 1) return refuse("Neighbors per unit: matching without replacement takes 1 neighbor; choose 1, or matching with replacement.");
  const outcome = get("outcome").trim();
  const treatName = get("treatment").trim();
  if (!outcome) return refuse("Outcome column: name the outcome column.");
  if (!treatName) return refuse("Treatment column: name the 0/1 treatment column.");
  const covText = get("covariates").trim();
  if (!covText) return refuse("Covariates: name the covariates for the score, separated by +.");
  const covs = covText.split(/[+,]/).map((s) => s.trim());
  if (covs.some((s) => !s)) return refuse("Covariates: an empty name (two separators in a row?).");
  if (covs.length > PS_MAX_COVARIATES) return refuse(`Covariates: ${covs.length} named; the calculator takes at most ${PS_MAX_COVARIATES}.`);
  const low = (s: string): string => s.toLowerCase();
  if (covs.some((s) => low(s) === low(treatName))) return refuse(`Covariates: ${q(treatName)} is the treatment column; it cannot also be a covariate.`);
  if (covs.some((s) => low(s) === low(outcome))) return refuse(`Covariates: ${q(outcome)} is the outcome column; it cannot also be a covariate.`);
  if (low(outcome) === low(treatName)) return refuse(`Treatment column: ${q(treatName)} is the outcome column.`);
  const text = get("data");
  if (text.length > CAUSAL_TEXT_MAX) return refuse(`The data table is longer than ${intText(CAUSAL_TEXT_MAX)} characters; paste at most ${intText(PS_MAX_ROWS)} rows.`);
  const parsed = parseRegData(text);
  if (!parsed.ok) return refuse(parsed.reason);
  const sel = selectColumns(parsed.data, { dep: outcome, preds: [treatName, ...covs], text: "" });
  if (!sel.ok) return refuse(sel.reason);
  const cols = sel.cols;
  const n0 = cols.y.length;
  if (n0 > PS_MAX_ROWS) return refuse(`The table has ${intText(n0)} usable rows; the propensity-score calculator takes at most ${intText(PS_MAX_ROWS)}.`);
  const tName = cols.names[0];
  const covNames = cols.names.slice(1);
  let Tall = Array.from(cols.X[0]);
  for (let i = 0; i < n0; i++) if (Tall[i] !== 0 && Tall[i] !== 1) return refuse(`Treatment column ${q(tName)}: data row ${cols.rowNumbers[i]} holds ${fmtFixed(Tall[i], 3)}; the treatment must be 0 or 1.`);
  let Yall = Array.from(cols.y);
  let Xall = Tall.map((_, i) => cols.X.slice(1).map((c) => c[i]));
  const n1a = Tall.filter((v) => v === 1).length;
  if (n1a < 2 || n0 - n1a < 2) return refuse(`The treatment column ${q(tName)} has ${n1a} treated and ${n0 - n1a} control rows; each group needs at least 2.`);
  const fit0 = logitScore(Tall, Xall, covNames);
  if ("error" in fit0) return refuse(fit0.error);
  // Common support.
  const range = (e: number[], T: number[], g: number): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    e.forEach((v, i) => {
      if (T[i] === g) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    });
    return [lo, hi];
  };
  const [t0lo, t0hi] = range(fit0.e, Tall, 1);
  const [c0lo, c0hi] = range(fit0.e, Tall, 0);
  const notes: string[] = [];
  let e = fit0.e;
  let eta = fit0.eta;
  let trimmed = 0;
  if (trim !== "none") {
    const lo = trim === "crump" ? 0.1 : Math.max(t0lo, c0lo);
    const hi = trim === "crump" ? 0.9 : Math.min(t0hi, c0hi);
    const keep = fit0.e.map((v) => v >= lo && v <= hi);
    trimmed = keep.filter((v) => !v).length;
    Tall = Tall.filter((_, i) => keep[i]);
    Yall = Yall.filter((_, i) => keep[i]);
    Xall = Xall.filter((_, i) => keep[i]);
    const n1 = Tall.filter((v) => v === 1).length;
    if (n1 < 2 || Tall.length - n1 < 2) return refuse(`After trimming to p̂ in [${fmtFixed(lo, 3)}, ${fmtFixed(hi, 3)}] only ${n1} treated and ${Tall.length - n1} control rows remain; each group needs at least 2.`);
    const fit1 = logitScore(Tall, Xall, covNames);
    if ("error" in fit1) return refuse(`After trimming: ${fit1.error}`);
    e = fit1.e;
    eta = fit1.eta;
    notes.push(
      `Trimming: ${intText(trimmed)} row${trimmed === 1 ? "" : "s"} with p̂ outside [${fmtFixed(lo, 3)}, ${fmtFixed(hi, 3)}] ${trimmed === 1 ? "was" : "were"} dropped ` +
        `(${trim === "crump" ? "Crump, Hotz, Imbens & Mitnik 2009 rule of thumb 0.1 ≤ p̂ ≤ 0.9" : "the overlap of the two groups' p̂ ranges"}), then the logit was re-estimated on the rows kept (one pass).`,
    );
  }
  const n = Tall.length;
  const T = Tall;
  const Y = Yall;
  if (e.some((v) => !(v > 1e-10 && v < 1 - 1e-10))) return refuse("Some propensity scores are 0 or 1 to within 10⁻¹⁰ (no overlap); trim the sample or drop the covariate that separates the groups.");
  let lines: string[] = [];
  const estName = estimand === "att" ? "ATT (effect on the treated)" : "ATE (average effect)";
  const header = `Propensity score ${method === "match" ? "matching" : "weighting (IPW)"}: effect of ${q(tName)} on ${q(cols.depName)}, ${estName}`;
  const tables: StatTable[] = [];
  let wBal: number[];
  let summary: string;
  if (method === "match") {
    let sdEta = 0;
    const mEta = eta.reduce((a, v) => a + v, 0) / n;
    for (const v of eta) sdEta += (v - mEta) ** 2;
    sdEta = Math.sqrt(sdEta / (n - 1));
    const cal = Number.isFinite(calSd) ? calSd * sdEta : Infinity;
    const m = psMatch(eta, T, Y, estimand, k, replace, cal);
    if ("error" in m) return refuse(m.error);
    wBal = m.w;
    summary =
      `${estimand.toUpperCase()} = ${fmtFixed(m.est, 3)} (matched: ${intText(m.nMatchedT)} treated, ${intText(m.nMatchedC)} controls${m.dropped ? `; ${intText(m.dropped)} unit${m.dropped === 1 ? "" : "s"} without a match within the caliper dropped` : ""}). ` +
      "No standard error is reported (see below).";
    lines = [header, summary];
    lines.push(
      `Matching: ${k} nearest neighbor${k === 1 ? "" : "s"} ${replace ? "with" : "without"} replacement on η = logit p̂ (the linear predictor), ` +
        (Number.isFinite(calSd) ? `caliper ${fmtFixed(calSd, 3)} SD of η = ${fmtFixed(cal, 4)} (SD over the ${intText(n)} rows, divisor n − 1)` : "no caliper") +
        (replace ? "" : "; greedy, treated units in order of decreasing p̂, each taking the nearest unused control") +
        "; ties go to the earlier row.",
    );
    lines.push(
      "No standard error: the bootstrap is invalid for nearest-neighbor matching (Abadie & Imbens 2008, Econometrica 76(6)), and the Abadie–Imbens (2016) variance for matching on an ESTIMATED score is not implemented. " +
        "For an interval use IPW here, or a dedicated matching package.",
    );
    tables.push({
      label: `Matching estimate (${estimand.toUpperCase()})`,
      rows: [
        ["Quantity", "Value"],
        [`${estimand.toUpperCase()} (matched difference in ${cols.depName})`, fmtFixed(m.est, 3)],
        ["Treated units matched", intText(m.nMatchedT)],
        ["Control units used", intText(m.nMatchedC)],
        ["Units dropped (no match within caliper)", intText(m.dropped)],
      ],
      align: ["left", "right"],
    });
  } else {
    const Xc = Tall.map((_, i) => [1, ...Xall[i]]);
    const r = psIpw(Xc, T, Y, e, estimand, wKind);
    if ("error" in r) return refuse(r.error);
    wBal = r.w;
    const z = r.est / r.se;
    summary = `${estimand.toUpperCase()} = ${fmtFixed(r.est, 3)} (SE ${fmtFixed(r.se, 3)}), z = ${fmtFixed(z, 3)}, p ${pText(zP(z))}, 95% CI ${ci(r.est, r.se, 3)}`;
    lines = [header, summary];
    lines.push(
      `Weights: ${estimand === "ate" ? "1/p̂ for treated, 1/(1 − p̂) for controls" : "1 for treated, p̂/(1 − p̂) for controls"}; ` +
        (wKind === "hajek"
          ? "normalized to sum to 1 within each group (Hájek; the same estimate as stabilized weights)."
          : `Horvitz–Thompson, unnormalized (means divided by ${estimand === "ate" ? "n" : "n₁"}).`),
    );
    lines.push(
      "Standard error: the stacked M-estimation sandwich A⁻¹BA⁻ᵀ/n over the logit score equations and the weighted means, so the estimation of p̂ is accounted for (Lunceford & Davidian 2004, Stat. Med. 23(19)); normal reference.",
    );
    let wmax = 0;
    let wsum = 0;
    for (const v of r.w) {
      wmax = Math.max(wmax, v);
      wsum += v;
    }
    if (wmax > 0.1 * wsum) lines.push(`One weight is more than 10% of the total (largest ${fmtFixed(wmax, 2)}): the estimate leans on a few units with p̂ near 0 or 1; consider trimming.`);
    tables.push({
      label: `IPW estimate (${estimand.toUpperCase()}, ${wKind === "hajek" ? "normalized weights" : "Horvitz–Thompson"})`,
      rows: [
        ["Quantity", "Estimate", "SE", "z", "p", "95% CI"],
        [`${estimand.toUpperCase()}`, fmtFixed(r.est, 3), fmtFixed(r.se, 3), fmtFixed(z, 3), fmtP(zP(z)), ci(r.est, r.se, 3)],
        [`Weighted mean of ${cols.depName}, treated`, fmtFixed(r.mu1, 3), "", "", "", ""],
        [`Weighted mean of ${cols.depName}, controls`, fmtFixed(r.mu0, 3), "", "", "", ""],
      ],
      align: ["left", "right", "right", "right", "right", "right"],
    });
  }
  // Balance.
  const balRows: string[][] = [["Covariate", "Treated mean", "Control mean", "SMD before", "SMD after", "Variance ratio after"]];
  const smd: { name: string; before: number; after: number }[] = [];
  const balVars: { name: string; x: number[] }[] = [...covNames.map((nm, j) => ({ name: nm, x: Xall.map((row) => row[j]) })), { name: "Propensity score (η)", x: eta }];
  let worstAfter = 0;
  for (const bv of balVars) {
    const t1 = gStats(bv.x, T, 1);
    const c1 = gStats(bv.x, T, 0);
    const sp = Math.sqrt((t1.v + c1.v) / 2);
    const wt = wStats(bv.x, T, wBal, 1);
    const wc = wStats(bv.x, T, wBal, 0);
    const before = sp > 0 ? (t1.m - c1.m) / sp : 0;
    const after = sp > 0 ? (wt.m - wc.m) / sp : 0;
    const vr = wc.v > 0 ? wt.v / wc.v : NaN;
    smd.push({ name: bv.name, before, after });
    if (bv.name !== "Propensity score (η)") worstAfter = Math.max(worstAfter, Math.abs(after));
    balRows.push([bv.name, fmtFixed(t1.m, 3), fmtFixed(c1.m, 3), fmtFixed(before, 3), fmtFixed(after, 3), Number.isFinite(vr) ? fmtFixed(vr, 3) : "not defined"]);
  }
  tables.push({
    label: "Covariate balance (standardized mean differences)",
    rows: balRows,
    align: ["left", "right", "right", "right", "right", "right"],
    note: "Means before adjustment. SMD = (treated mean − control mean)/√((s²_treated + s²_control)/2), the denominator from the sample before adjustment for both columns; after = with the matching or IPW weights.",
  });
  lines.push(
    `Balance: the largest |SMD| after adjustment is ${fmtFixed(worstAfter, 3)} (${worstAfter <= 0.1 ? "within" : "above"} the common 0.1 threshold, Austin 2009). ` +
      "SMD = difference in means over the pooled before-adjustment SD √((s²₁ + s²₀)/2), divisor n − 1; after-adjustment means and variances are weighted (divisor Σw).",
  );
  lines.push(
    `Common support: p̂ ranges ${fmtFixed(t0lo, 3)}–${fmtFixed(t0hi, 3)} for the treated and ${fmtFixed(c0lo, 3)}–${fmtFixed(c0hi, 3)} for the controls` +
      (trim === "none" ? "; no rows trimmed." : "."),
  );
  lines.push("");
  lines.push(
    `Conventions: p̂ from a logit of ${q(tName)} on a constant and ${covNames.map(q).join(", ")} by maximum likelihood (statsmodels Logit conventions). ` +
      "The effect is causal only under unconfoundedness given these covariates and overlap; the score model's fit is not tested here.",
  );
  lines.push(...notes, ...cols.notes);
  // Figure: p̂ distributions and the Love plot.
  const B = 20;
  const histLine = (g: number): { x: number; y: number }[] => {
    const cnt = new Array<number>(B).fill(0);
    let tot = 0;
    e.forEach((v, i) => {
      if (T[i] !== g) return;
      cnt[Math.min(B - 1, Math.floor(v * B))]++;
      tot++;
    });
    return cnt.map((c2, b) => ({ x: (b + 0.5) / B, y: c2 / tot }));
  };
  const top = buildPlotSvg(
    [
      { type: "line", points: histLine(1), color: "#b45309", label: "Treated" },
      { type: "line", points: histLine(0), color: "#0369a1", label: "Control" },
    ],
    { width: 420, height: 230, title: "Propensity score overlap", xlabel: "p̂ (20 bins)", ylabel: "Share of group", xLimits: { min: 0, max: 1 } },
  );
  const nv = smd.length;
  const love = buildPlotSvg(
    [
      { type: "scatter", points: smd.map((s, j) => ({ x: Math.abs(s.before), y: nv - j })), color: "#94a3b8", label: "Before" },
      { type: "scatter", points: smd.map((s, j) => ({ x: Math.abs(s.after), y: nv - j })), color: "#0369a1", label: "After" },
      { type: "line", points: [{ x: 0.1, y: 0.5 }, { x: 0.1, y: nv + 0.5 }], color: "#cbd5e1" },
    ],
    {
      width: 420,
      height: Math.max(200, 60 + 22 * nv),
      title: "Covariate balance (Love plot)",
      xlabel: "|Standardised mean difference|",
      ylabel: "",
      yTickLabel: (v) => {
        const j = Math.round(v);
        if (!(Math.abs(v - j) < 1e-9 && j >= 1 && j <= nv)) return "";
        // a long column name ran off the left edge as a y-axis label (F2 figure check); the table carries it in full
        const nm = smd[nv - j].name;
        return nm.length > 16 ? nm.slice(0, 15) + "…" : nm;
      },
      yLimits: { min: 0.5, max: nv + 0.5 },
      notes: ["Vertical line at |SMD| = 0.1."],
    },
  );
  const svg = combineSvgs([top, love]).svg;
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------------------------------------------------------
// The registry (spread into the pane's STAT_CALCS).

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const CAUSAL_STAT_CALCS: StatCalcDef[] = [
  {
    id: "causal-rdd",
    name: "Regression discontinuity (sharp or fuzzy)",
    fields: [
      { key: "data", label: "Data table: a header row of column names, then one row per observation", default: rdDefaultTable(), kind: "block" },
      { key: "outcome", label: "Outcome column", default: "outcome", kind: "text" },
      { key: "running", label: "Running (forcing) variable column", default: "score", kind: "text" },
      { key: "cutoff", label: "Cutoff c (treated at running variable ≥ c)", default: "50", kind: "text" },
      {
        key: "design",
        label: "Design",
        default: "sharp",
        kind: "select",
        options: [
          { value: "sharp", label: "Sharp (treatment = 1 at and above the cutoff)" },
          { value: "fuzzy", label: "Fuzzy (the treatment column jumps at the cutoff)" },
        ],
      },
      { key: "treatment", label: "Treatment received column (fuzzy design)", default: "treated", kind: "text" },
      { key: "kernel", label: "Kernel", default: "triangular", kind: "select", options: KERNEL_OPTIONS },
      {
        key: "order",
        label: "Local polynomial",
        default: "1",
        kind: "select",
        options: [
          { value: "1", label: "Linear" },
          { value: "2", label: "Quadratic (enter a bandwidth)" },
        ],
      },
      { key: "bandwidth", label: "Bandwidth h (blank = Imbens–Kalyanaraman)", default: "", kind: "text" },
      { key: "bins", label: "Figure: bins per side (2–100)", default: "20", kind: "text" },
    ],
    compute: (r) => {
      // Local linear/quadratic RD with kernel weights, IK bandwidth, HC1 SEs, bandwidth sensitivity and the binned-scatter figure.
      return rdCalc(r);
    },
  },
  {
    id: "causal-synth",
    name: "Synthetic control (with placebo inference)",
    fields: [
      { key: "data", label: "Wide table: a period column, then one column per unit (treated and donors)", default: scDefaultTable(), kind: "block" },
      { key: "period", label: "Period column (blank = the first column)", default: "Year", kind: "text" },
      { key: "treated", label: "Treated unit (column name)", default: "Region A", kind: "text" },
      { key: "donors", label: "Donor units (names separated by +; blank = every other column)", default: "", kind: "text" },
      { key: "start", label: "First treated period", default: "2010", kind: "text" },
      { key: "placebo", label: "In-space placebo inference", default: "yes", kind: "select", options: YES_NO },
    ],
    compute: (r) => {
      // Simplex-constrained donor weights by active-set QP, treated-vs-synthetic and gap figure, RMSPE-ratio placebo p-value.
      return synthCalc(r);
    },
  },
  {
    id: "causal-pscore",
    name: "Propensity score matching and weighting",
    fields: [
      { key: "data", label: "Data table: a header row of column names, then one row per observation", default: psDefaultTable(), kind: "block" },
      { key: "outcome", label: "Outcome column", default: "earnings", kind: "text" },
      { key: "treatment", label: "Treatment column (0 or 1)", default: "training", kind: "text" },
      { key: "covariates", label: "Covariates for the score (names separated by +)", default: "age + educ + income", kind: "text" },
      {
        key: "method",
        label: "Method",
        default: "match",
        kind: "select",
        options: [
          { value: "match", label: "Nearest-neighbor matching" },
          { value: "ipw", label: "Inverse probability weighting (IPW)" },
        ],
      },
      {
        key: "estimand",
        label: "Estimand",
        default: "att",
        kind: "select",
        options: [
          { value: "att", label: "ATT (effect on the treated)" },
          { value: "ate", label: "ATE (average effect)" },
        ],
      },
      { key: "replace", label: "Matching with replacement", default: "yes", kind: "select", options: YES_NO },
      { key: "neighbors", label: "Matching: neighbors per unit (1–5)", default: "1", kind: "text" },
      { key: "caliper", label: "Matching caliper in SDs of logit p̂ (blank = none; 0.2 is common)", default: "", kind: "text" },
      {
        key: "weights",
        label: "IPW weights",
        default: "hajek",
        kind: "select",
        options: [
          { value: "hajek", label: "Stabilized / normalized (Hájek)" },
          { value: "ht", label: "Unnormalized (Horvitz–Thompson)" },
        ],
      },
      {
        key: "trim",
        label: "Common-support trimming",
        default: "none",
        kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "overlap", label: "Drop rows outside the overlap of the two p̂ ranges" },
          { value: "crump", label: "Keep 0.1 ≤ p̂ ≤ 0.9 (Crump et al. 2009)" },
        ],
      },
    ],
    compute: (r) => {
      // Logit propensity score, NN matching or IPW (ATE/ATT) with M-estimation SEs, SMD balance table, overlap and Love plot.
      return pscoreCalc(r);
    },
  },
];
