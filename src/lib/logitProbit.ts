/**
 * Logit and probit by maximum likelihood (Release E2): Newton–Raphson on the column-scaled design, classical and
 * HC0-robust standard errors, z statistics, the LR χ² against the constant-only model, McFadden's pseudo R², AIC/BIC,
 * average marginal effects with delta-method standard errors, and the percent correctly predicted.
 *
 * Every convention follows statsmodels 0.15 Logit/Probit (pinned to 1e-6 relative in logitProbit.test.ts on the
 * Spector & Mazzeo data and two seeded datasets):
 *   - classical covariance = inverse of the OBSERVED information (for probit this is not the expected information);
 *   - HC0 = H⁻¹ (Σ sᵢsᵢᵀ) H⁻¹ with sᵢ the per-observation score, no small-sample factor (cov_type="HC0");
 *   - the null model is constant-only even when the model has no constant, the LR df is k − 1, AIC/BIC count k;
 *   - marginal effects are get_margeff(at="overall", method="dydx"): dP/dx averaged over the sample, a dummy treated
 *     as a continuous derivative, delta-method SEs from the chosen covariance;
 *   - "correctly predicted" counts a fitted probability ABOVE 0.5 as a predicted 1 (pred_table's rule).
 *
 * Refusals are thrown as LogitProbitRefusal with a code and, where one exists, the offending variable names:
 * y not 0/1, one class only, perfect and quasi-complete separation, collinearity, non-convergence, n ≤ k.
 *
 * Numerics: log Λ via log1p(exp(−|η|)); Φ, log Φ and the inverse Mills ratio φ/Φ via the scaled complementary error
 * function erfcx (Lentz continued fraction beyond 2.5), so nothing cancels or underflows in the tails.
 */

import type { FittedModel, ModelStat, ModelTerm } from "./regModel";
import { normalQuantile } from "./probdist";
import { chiSquareP } from "./stats2";
import { formatNum } from "./linalg";
import { MINUS, timesTen } from "./axis";

export type LogitProbitSE = "classical" | "hc0";

export interface LogitProbitOptions {
  /** Include a constant (default true). */
  constant?: boolean;
  /** Standard errors (default "classical"). */
  se?: LogitProbitSE;
  /** The response's name (default "y"). */
  depName?: string;
  /** Iteration cap (default 100; exposed so tests can force the non-convergence refusal). */
  maxIter?: number;
}

export type LogitProbitRefusalCode =
  | "bad-input"
  | "not-binary"
  | "one-class"
  | "too-few"
  | "collinear"
  | "perfect-separation"
  | "quasi-separation"
  | "no-convergence";

/** A named refusal: the model cannot be estimated as asked, and the message says why in the user's terms. */
export class LogitProbitRefusal extends Error {
  readonly code: LogitProbitRefusalCode;
  /** The variables the refusal is about (the separating predictor, the collinear columns), when there are any. */
  readonly variables: string[];
  constructor(code: LogitProbitRefusalCode, message: string, variables: string[] = []) {
    super(message);
    this.name = "LogitProbitRefusal";
    this.code = code;
    this.variables = variables;
  }
}

/** Score tolerance (max |∂ℓ/∂γⱼ| on the column-scaled design). */
const SCORE_TOL = 1e-10;
/** A fitted probability this close to 0 or 1 counts as "hitting" the boundary. */
const EXTREME_P = 1e-10;
/** A column whose part orthogonal to the earlier columns is below this fraction of its norm is collinear. */
const COLLINEAR_TOL = 1e-9;

// Math through a module binding: inside a sandboxed context (jest's vm) every bare global lookup in the hot loop goes
// through the global object's interceptor, which made the 50,000-row fit several times slower.
const MATH = Math;
const SQRT2 = MATH.SQRT2;
const TWO_OVER_SQRT_PI = 2 / MATH.sqrt(MATH.PI);

/** erf(x) for 0 ≤ x < 2.5 by its Taylor series (the same series as probdist.erfPrecise, to full double precision). */
function erfSmall(x: number): number {
  let term = x;
  let sum = x;
  const x2 = x * x;
  for (let n = 1; n < 200; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (MATH.abs(add) < 1e-17 * MATH.abs(sum)) break;
  }
  return TWO_OVER_SQRT_PI * sum;
}
const SQRT_PI = MATH.sqrt(MATH.PI);
const INV_SQRT_2PI = 1 / MATH.sqrt(2 * MATH.PI);
const SQRT_2_OVER_PI = MATH.sqrt(2 / MATH.PI);

// ---------------------------------------------------------------------------
// Normal tails without cancellation

/** erfcx(x) = exp(x²)·erfc(x) for x ≥ 0. */
function erfcx(x: number): number {
  if (x < 2.5) return MATH.exp(x * x) * (1 - erfSmall(x));
  // erfc(x) = exp(−x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + …)))), Lentz's method; no cut-off at large x.
  const tiny = 1e-300;
  let fv = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 5000; n++) {
    const an = n / 2;
    D = x + an * D;
    if (MATH.abs(D) < tiny) D = tiny;
    C = x + an / C;
    if (MATH.abs(C) < tiny) C = tiny;
    D = 1 / D;
    const delta = C * D;
    fv *= delta;
    if (MATH.abs(delta - 1) < 1e-16) break;
  }
  return 1 / (SQRT_PI * fv);
}

/** Scratch output of normalTail (one shared object: the likelihood pass calls it n times per iteration). */
const NT = { cdf: 0, logCdf: 0, mills: 0, small: 0 };

/**
 * Φ(t), log Φ(t), the inverse Mills ratio φ(t)/Φ(t) and min(Φ(t), 1 − Φ(t)), each accurate in both tails, written
 * into NT.
 */
function normalTail(t: number): typeof NT {
  if (t < 0) {
    // Φ(t) = ½ erfc(−t/√2) = ½ erfcx(x) e^{−t²/2}, x = −t/√2 > 0.
    const ex = erfcx(-t / SQRT2);
    const half = 0.5 * t * t;
    NT.cdf = 0.5 * ex * MATH.exp(-half);
    NT.logCdf = MATH.log(0.5 * ex) - half;
    NT.mills = SQRT_2_OVER_PI / ex;
    NT.small = NT.cdf;
    return NT;
  }
  // Φ(t) = 1 − ½ erfc(t/√2).
  const x = t / SQRT2;
  const erfcVal = x < 2.5 ? 1 - erfSmall(x) : erfcx(x) * MATH.exp(-x * x);
  const upper = 0.5 * erfcVal;
  const cdf = 1 - upper;
  NT.cdf = cdf;
  NT.logCdf = MATH.log1p(-upper);
  NT.mills = (INV_SQRT_2PI * MATH.exp(-0.5 * t * t)) / cdf;
  NT.small = upper;
  return NT;
}

/** Two-sided normal p-value 2Φ(−|z|) = erfc(|z|/√2), with no 1 − Φ round trip. */
function twoSidedP(z: number): number {
  const x = MATH.abs(z) / SQRT2;
  if (x < 2.5) return 1 - erfSmall(x);
  return erfcx(x) * MATH.exp(-x * x);
}

// ---------------------------------------------------------------------------
// Small dense linear algebra (p ≤ a few dozen)

/** Cholesky factor (lower, row-major p×p) of a symmetric positive-definite matrix, or null. */
function cholesky(A: Float64Array, p: number): Float64Array | null {
  const L = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * p + j];
      for (let k = 0; k < j; k++) s -= L[i * p + k] * L[j * p + k];
      if (i === j) {
        if (!(s > 1e-14 * MATH.max(1e-300, A[i * p + i]))) return null;
        L[i * p + i] = MATH.sqrt(s);
      } else {
        L[i * p + j] = s / L[j * p + j];
      }
    }
  }
  return L;
}

function cholSolve(L: Float64Array, p: number, b: Float64Array): Float64Array {
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * p + k] * z[k];
    z[i] = s / L[i * p + i];
  }
  const x = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < p; k++) s -= L[k * p + i] * x[k];
    x[i] = s / L[i * p + i];
  }
  return x;
}

function cholInverse(L: Float64Array, p: number): Float64Array {
  const inv = new Float64Array(p * p);
  const e = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    e.fill(0);
    e[j] = 1;
    const col = cholSolve(L, p, e);
    for (let i = 0; i < p; i++) inv[i * p + j] = col[i];
  }
  // Symmetrise against round-off.
  for (let i = 0; i < p; i++)
    for (let j = 0; j < i; j++) {
      const v = 0.5 * (inv[i * p + j] + inv[j * p + i]);
      inv[i * p + j] = v;
      inv[j * p + i] = v;
    }
  return inv;
}

function matMul(A: Float64Array, B: Float64Array, p: number): Float64Array {
  const C = new Float64Array(p * p);
  for (let i = 0; i < p; i++)
    for (let k = 0; k < p; k++) {
      const a = A[i * p + k];
      if (a === 0) continue;
      for (let j = 0; j < p; j++) C[i * p + j] += a * B[k * p + j];
    }
  return C;
}

// ---------------------------------------------------------------------------
// The likelihood pass

type Kind = "logit" | "probit";

interface Pass {
  ll: number;
  /** Score on the scaled design. */
  g: Float64Array;
  /** Observed information (−Hessian), row-major p×p. */
  A: Float64Array;
  /** Observations whose fitted probability is within EXTREME_P of 0 or 1. */
  extreme: number;
}

/**
 * One observation's contributions: log-likelihood, score residual r (so sᵢ = r·xᵢ) and information weight w
 * (so −H = Σ w·xᵢxᵢᵀ).
 */
const OT = { ll: 0, r: 0, w: 0, extreme: false };
function obsTerms(kind: Kind, y: number, eta: number): typeof OT {
  if (kind === "logit") {
    const e = MATH.exp(-MATH.abs(eta));
    const l1p = MATH.log1p(e);
    // log Λ(η) and log(1 − Λ(η)) without overflow.
    const logP = eta >= 0 ? -l1p : eta - l1p;
    const logQ = eta >= 0 ? -eta - l1p : -l1p;
    const p = eta >= 0 ? 1 / (1 + e) : e / (1 + e);
    const small = e / (1 + e); // min(p, 1 − p)
    OT.ll = y === 1 ? logP : logQ;
    OT.r = y - p;
    OT.w = e / ((1 + e) * (1 + e));
    OT.extreme = small < EXTREME_P;
    return OT;
  }
  const q = 2 * y - 1;
  const t = q * eta;
  const nt = normalTail(t);
  OT.ll = nt.logCdf;
  OT.r = q * nt.mills;
  OT.w = nt.mills * (nt.mills + t);
  OT.extreme = nt.small < EXTREME_P;
  return OT;
}

class Design {
  /** Row-major n×p, scaled columns. */
  readonly X: Float64Array;
  constructor(
    readonly n: number,
    readonly p: number,
    X: Float64Array,
    readonly y: Float64Array,
    readonly kind: Kind,
  ) {
    this.X = X;
  }

  eta(beta: Float64Array, out: Float64Array): Float64Array {
    const { n, p, X } = this;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * p;
      for (let j = 0; j < p; j++) s += X[o + j] * beta[j];
      out[i] = s;
    }
    return out;
  }

  private rBuf = new Float64Array(0);
  private wBuf = new Float64Array(0);
  /** The β whose per-observation terms are in rBuf/wBuf (identity), with its ℓ and extreme count. */
  private lastBeta: Float64Array | null = null;
  private lastLl = 0;
  private lastExtreme = 0;

  /** ℓ(β), filling the per-observation score residuals and information weights for a following pass(). */
  llOnly(beta: Float64Array, etaBuf: Float64Array): number {
    const { n, kind, y } = this;
    if (this.rBuf.length !== n) {
      this.rBuf = new Float64Array(n);
      this.wBuf = new Float64Array(n);
    }
    this.eta(beta, etaBuf);
    let ll = 0;
    let extreme = 0;
    const rB = this.rBuf;
    const wB = this.wBuf;
    for (let i = 0; i < n; i++) {
      const o = obsTerms(kind, y[i], etaBuf[i]);
      ll += o.ll;
      rB[i] = o.r;
      wB[i] = o.w;
      if (o.extreme) extreme++;
    }
    this.lastBeta = beta;
    this.lastLl = ll;
    this.lastExtreme = extreme;
    return ll;
  }

  /** Extreme-probability count at the last β evaluated. */
  extremeCount(): number {
    return this.lastExtreme;
  }

  /** Per-observation score residuals at the last β evaluated. */
  residuals(): Float64Array {
    return this.rBuf;
  }

  pass(beta: Float64Array, etaBuf: Float64Array): Pass {
    const { n, p, X } = this;
    if (this.lastBeta !== beta) this.llOnly(beta, etaBuf);
    const rB = this.rBuf;
    const wB = this.wBuf;
    const g = new Float64Array(p);
    const A = new Float64Array(p * p);
    for (let i = 0; i < n; i++) {
      const r = rB[i];
      const w = wB[i];
      const off = i * p;
      for (let a = 0; a < p; a++) {
        const xa = X[off + a];
        g[a] += r * xa;
        const wxa = w * xa;
        if (wxa === 0) continue;
        const row = a * p;
        for (let b = 0; b <= a; b++) A[row + b] += wxa * X[off + b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) A[b * p + a] = A[a * p + b];
    return { ll: this.lastLl, g, A, extreme: this.lastExtreme };
  }
}

// ---------------------------------------------------------------------------
// Input checks

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function listNames(names: string[]): string {
  const q = names.map((s) => `“${s}”`);
  if (q.length <= 1) return q.join("");
  return `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

/**
 * Collinearity by modified Gram–Schmidt with re-orthogonalisation, column by column in the order given: a column
 * whose orthogonal remainder is below COLLINEAR_TOL of its norm is named, with the earlier columns it depends on.
 */
function checkCollinear(cols: Float64Array[], labels: string[], hasConstant: boolean): void {
  const p = cols.length;
  const n = cols[0].length;
  const Q: Float64Array[] = [];
  const acceptedIdx: number[] = [];
  const R: number[][] = []; // R[q][j]: coefficient of Q[q] in column j
  for (let j = 0; j < p; j++) {
    const c = cols[j];
    let norm0 = 0;
    for (let i = 0; i < n; i++) norm0 += c[i] * c[i];
    norm0 = MATH.sqrt(norm0);
    if (norm0 === 0) {
      throw new LogitProbitRefusal("collinear", `The predictor “${labels[j]}” is zero in every row, so it carries no information. Remove it.`, [labels[j]]);
    }
    const v = Float64Array.from(c);
    const r = new Array<number>(Q.length).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < Q.length; q++) {
        const qq = Q[q];
        let d = 0;
        for (let i = 0; i < n; i++) d += qq[i] * v[i];
        r[q] += d;
        for (let i = 0; i < n; i++) v[i] -= d * qq[i];
      }
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += v[i] * v[i];
    norm = MATH.sqrt(norm);
    if (norm <= COLLINEAR_TOL * norm0) {
      // Express column j in the accepted original columns: solve the upper-triangular R c = r.
      const m = Q.length;
      const coef = new Array<number>(m).fill(0);
      for (let a = m - 1; a >= 0; a--) {
        let s = r[a];
        for (let b = a + 1; b < m; b++) s -= R[a][acceptedIdx[b]] * coef[b];
        coef[a] = s / R[a][acceptedIdx[a]];
      }
      const deps: string[] = [];
      for (let a = 0; a < m; a++) {
        const idx = acceptedIdx[a];
        let nrm = 0;
        for (let i = 0; i < n; i++) nrm += cols[idx][i] * cols[idx][i];
        if (MATH.abs(coef[a]) * MATH.sqrt(nrm) > 1e-6 * norm0) deps.push(labels[idx]);
      }
      if (hasConstant && deps.length === 1 && deps[0] === "Constant") {
        throw new LogitProbitRefusal(
          "collinear",
          `The predictor “${labels[j]}” has the same value in every row, so it duplicates the constant. Remove it.`,
          [labels[j]],
        );
      }
      const named = deps.filter((d) => d !== "Constant");
      const withConst = deps.includes("Constant") ? " and the constant" : "";
      throw new LogitProbitRefusal(
        "collinear",
        `The predictors are perfectly collinear: “${labels[j]}” is an exact linear combination of ${named.length ? listNames(named) : "the constant"}${named.length ? withConst : ""}, ` +
          "so the coefficients are not identified. Remove one of them.",
        [labels[j], ...named],
      );
    }
    for (let i = 0; i < n; i++) v[i] /= norm;
    Q.push(v);
    acceptedIdx.push(j);
    const row = new Array<number>(p).fill(0);
    R.push(row);
    for (let q = 0; q < r.length; q++) R[q][j] = r[q];
    R[Q.length - 1][j] = norm;
  }
}

/** One predictor alone separating the outcome (valid with a constant: β₀ + βⱼx is in the model). */
function checkSingleSeparation(y: Float64Array, cols: Float64Array[], labels: string[], depName: string): void {
  const n = y.length;
  for (let j = 0; j < cols.length; j++) {
    if (labels[j] === "Constant") continue;
    const c = cols[j];
    let min0 = Infinity;
    let max0 = -Infinity;
    let min1 = Infinity;
    let max1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = c[i];
      if (y[i] === 1) {
        if (v < min1) min1 = v;
        if (v > max1) max1 = v;
      } else {
        if (v < min0) min0 = v;
        if (v > max0) max0 = v;
      }
    }
    const lab = labels[j];
    if (max0 < min1 || max1 < min0) {
      throw new LogitProbitRefusal(
        "perfect-separation",
        `Perfect separation: “${lab}” alone predicts ${depName} exactly (every ${depName} = 1 has ${lab} ${max0 < min1 ? "above" : "below"} every ${depName} = 0), ` +
          "so the maximum-likelihood coefficient is infinite and no estimate exists. Remove it, or use a penalised (Firth) or exact logistic method.",
        [lab],
      );
    }
    if (max0 === min1 || max1 === min0) {
      const boundary = max0 === min1 ? max0 : min0;
      throw new LogitProbitRefusal(
        "quasi-separation",
        `Quasi-complete separation: “${lab}” separates ${depName} except at ${lab} = ${fmtPlain(boundary)} (on one side of that value every ${depName} is the same), ` +
          "so its maximum-likelihood coefficient is infinite and no estimate exists. Remove it, merge categories, or use a penalised (Firth) method.",
        [lab],
      );
    }
  }
}

function fmtPlain(x: number): string {
  return formatNum(x, 6);
}

// ---------------------------------------------------------------------------
// The fit

function fit(kind: Kind, y: number[], X: number[][], names: string[], opts: LogitProbitOptions = {}): FittedModel {
  const constant = opts.constant !== false;
  const seType: LogitProbitSE = opts.se ?? "classical";
  const depName = opts.depName ?? "y";
  const maxIter = opts.maxIter ?? 100;
  const label = kind === "logit" ? "Logit" : "Probit";

  // --- shape and values
  const n = y.length;
  if (!Array.isArray(X) || X.length !== n) {
    throw new LogitProbitRefusal("bad-input", `The response has ${plural(n, "row")} but the predictors have ${Array.isArray(X) ? X.length : 0}.`);
  }
  const k = names.length;
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(X[i]) || X[i].length !== k) {
      throw new LogitProbitRefusal("bad-input", `Row ${i + 1} has ${Array.isArray(X[i]) ? X[i].length : 0} predictor values; ${k} are named.`);
    }
    for (let j = 0; j < k; j++) {
      if (typeof X[i][j] !== "number" || !Number.isFinite(X[i][j])) {
        throw new LogitProbitRefusal("bad-input", `Row ${i + 1}, “${names[j]}” is not a number.`, [names[j]]);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (y[i] !== 0 && y[i] !== 1) {
      const shown = typeof y[i] === "number" && Number.isFinite(y[i]) ? fmtPlain(y[i]) : "not a number";
      throw new LogitProbitRefusal(
        "not-binary",
        `${label} needs ${depName} coded 0 or 1; row ${i + 1} has ${shown}. Recode the outcome as 0/1 (1 = the event).`,
        [depName],
      );
    }
  }
  let n1 = 0;
  for (let i = 0; i < n; i++) n1 += y[i];
  const n0 = n - n1;
  if (n1 === 0 || n0 === 0) {
    throw new LogitProbitRefusal(
      "one-class",
      `Every observation has ${depName} = ${n1 === 0 ? 0 : 1}, so there is nothing to explain: ${label.toLowerCase()} needs both 0s and 1s.`,
      [depName],
    );
  }
  const p = k + (constant ? 1 : 0);
  if (p === 0) throw new LogitProbitRefusal("bad-input", "There are no predictors and no constant: nothing to estimate.");
  if (n <= p) {
    throw new LogitProbitRefusal(
      "too-few",
      `${plural(n, "observation")} cannot estimate ${plural(p, "parameter")}: ${label.toLowerCase()} needs more observations than parameters (n > k).`,
    );
  }

  // --- the design, columns scaled by their largest absolute value
  const labels = constant ? ["Constant", ...names] : [...names];
  const scale = new Float64Array(p);
  const cols: Float64Array[] = [];
  for (let j = 0; j < p; j++) {
    const c = new Float64Array(n);
    if (constant && j === 0) {
      c.fill(1);
      scale[j] = 1;
    } else {
      const src = j - (constant ? 1 : 0);
      let m = 0;
      for (let i = 0; i < n; i++) {
        c[i] = X[i][src];
        m = MATH.max(m, MATH.abs(c[i]));
      }
      scale[j] = m > 0 ? m : 1;
      for (let i = 0; i < n; i++) c[i] /= scale[j];
    }
    cols.push(c);
  }
  checkCollinear(cols, labels, constant);
  const yv = Float64Array.from(y);
  if (constant) checkSingleSeparation(yv, cols, labels, depName);

  const Xs = new Float64Array(n * p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xs[i * p + j] = cols[j][i];
  const design = new Design(n, p, Xs, yv, kind);
  const etaBuf = new Float64Array(n);

  // --- Newton–Raphson with step halving
  const ybar = n1 / n;
  let beta: Float64Array = new Float64Array(p);
  if (constant) beta[0] = kind === "logit" ? MATH.log(ybar / (1 - ybar)) : normalQuantile(ybar);
  let converged = false;
  let iterations = 0;
  let cur = design.pass(beta, etaBuf);
  let lastStep: Float64Array = new Float64Array(p);
  let singular = false;

  const separationNames = (step: Float64Array): string[] => {
    let mx = 0;
    for (let j = 0; j < p; j++) if (labels[j] !== "Constant") mx = MATH.max(mx, MATH.abs(step[j]));
    if (!(mx > 0)) return [];
    return labels.filter((l, j) => l !== "Constant" && MATH.abs(step[j]) >= 0.1 * mx);
  };
  const perfect = (step: Float64Array): never => {
    const vs = separationNames(step);
    throw new LogitProbitRefusal(
      "perfect-separation",
      `Perfect separation: a combination of the predictors${vs.length ? ` (${listNames(vs)})` : ""} predicts every ${depName} exactly ` +
        "(every fitted probability reaches 0 or 1), so the maximum-likelihood coefficients are infinite and no estimate exists. " +
        "Remove a predictor, or use a penalised (Firth) or exact logistic method.",
      vs,
    );
  };

  /** One Newton step with halving; null when the information is singular or no step increases ℓ. */
  const newtonStep = (from: Float64Array, at: Pass): { beta: Float64Array; step: Float64Array } | null => {
    const L = cholesky(at.A, p);
    if (!L) return null;
    const d = cholSolve(L, p, at.g);
    let t = 1;
    for (let h = 0; h < 60; h++) {
      const nb = new Float64Array(p);
      for (let j = 0; j < p; j++) nb[j] = from[j] + t * d[j];
      const llNew = design.llOnly(nb, etaBuf);
      if (llNew >= at.ll - 1e-12 * (1 + MATH.abs(at.ll))) {
        const step = new Float64Array(p);
        for (let j = 0; j < p; j++) step[j] = nb[j] - from[j];
        return { beta: nb, step };
      }
      t /= 2;
    }
    return null;
  };

  for (;;) {
    if (cur.extreme === n) perfect(lastStep);
    let gmax = 0;
    for (let j = 0; j < p; j++) gmax = MATH.max(gmax, MATH.abs(cur.g[j]));
    if (gmax <= SCORE_TOL) {
      converged = true;
      break;
    }
    if (iterations >= maxIter) break;
    const st = newtonStep(beta, cur);
    if (!st) {
      singular = true;
      break;
    }
    iterations++;
    beta = st.beta;
    lastStep = st.step;
    cur = design.pass(beta, etaBuf);
    // Round-off floor: a step that moves no coefficient beyond 1e-14 of its size has converged.
    let tinyStep = true;
    for (let j = 0; j < p; j++) if (MATH.abs(st.step[j]) > 1e-14 * (1 + MATH.abs(beta[j]))) tinyStep = false;
    if (tinyStep) {
      converged = true;
      break;
    }
  }

  // --- divergence probe: at a true maximum further Newton steps move nothing; under separation the linear predictor
  // keeps running off towards ±∞ along the separating direction.
  const quasi = (step: Float64Array, extreme: number): never => {
    const vs = separationNames(step);
    throw new LogitProbitRefusal(
      "quasi-separation",
      `Quasi-complete separation: ${plural(extreme, "observation")} ${extreme === 1 ? "is" : "are"} fitted with probability within 10⁻¹⁰ of 0 or 1 ` +
        `while the coefficient${vs.length === 1 ? "" : "s"}${vs.length ? ` on ${listNames(vs)}` : ""} keep${vs.length === 1 ? "s" : ""} growing, ` +
        "so the maximum-likelihood estimate does not exist. Remove or merge the predictor, or use a penalised (Firth) method.",
      vs,
    );
  };
  if (converged) {
    // One more full Newton step: |Δη| ≈ 1 (logit) or 1/η (probit) on separated observations, ~0 at a true maximum.
    const st = newtonStep(beta, cur);
    if (st) {
      let dEta = 0;
      for (let i = 0; i < n; i++) {
        let d = 0;
        const off = i * p;
        for (let j = 0; j < p; j++) d += Xs[off + j] * st.step[j];
        dEta = MATH.max(dEta, MATH.abs(d));
      }
      const ext = design.extremeCount();
      if (ext === n) perfect(st.step);
      if (dEta > 1e-4) quasi(st.step, MATH.max(cur.extreme, ext));
    } else if (cur.extreme > 0) {
      quasi(lastStep, cur.extreme);
    }
  } else if (cur.extreme > 0) {
    quasi(lastStep, cur.extreme);
  } else if (singular) {
    throw new LogitProbitRefusal(
      "collinear",
      "The information matrix is numerically singular at the current estimate (the predictors are nearly collinear), so the coefficients are not identified. Remove a near-duplicate predictor or rescale.",
    );
  } else {
    throw new LogitProbitRefusal(
      "no-convergence",
      `Newton–Raphson did not converge in ${plural(maxIter, "iteration")} (score tolerance 10⁻¹⁰), so no estimate is reported.`,
    );
  }

  // --- covariance on the scaled design, then back to the user's units
  const L = cholesky(cur.A, p);
  if (!L) {
    throw new LogitProbitRefusal("collinear", "The information matrix is numerically singular at the estimate, so standard errors do not exist. Remove a near-duplicate predictor.");
  }
  const Ainv = cholInverse(L, p);
  let covS = Ainv;
  if (seType === "hc0") {
    const M = new Float64Array(p * p);
    design.llOnly(beta, etaBuf);
    const res = design.residuals();
    for (let i = 0; i < n; i++) {
      const r = res[i];
      const off = i * p;
      for (let a = 0; a < p; a++) {
        const ra = r * r * Xs[off + a];
        for (let b = 0; b <= a; b++) M[a * p + b] += ra * Xs[off + b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) M[b * p + a] = M[a * p + b];
    covS = matMul(matMul(Ainv, M, p), Ainv, p);
  }
  const coef = new Float64Array(p);
  const V = new Float64Array(p * p);
  for (let a = 0; a < p; a++) {
    coef[a] = beta[a] / scale[a];
    for (let b = 0; b < p; b++) V[a * p + b] = covS[a * p + b] / (scale[a] * scale[b]);
  }

  const zCrit = normalQuantile(0.975);
  const makeTerm = (name: string, est: number, se: number): ModelTerm => {
    const z = est / se;
    return { name, coef: est, se, stat: z, p: twoSidedP(z), ciLo: est - zCrit * se, ciHi: est + zCrit * se };
  };
  const terms: ModelTerm[] = labels.map((nm, j) => makeTerm(nm, coef[j], MATH.sqrt(V[j * p + j])));

  // --- fitted probabilities, marginal effects (original units)
  design.eta(beta, etaBuf);
  let correct = 0;
  const fBar = { v: 0 };
  const a = new Float64Array(p); // mean of f′(ηᵢ)·xᵢₗ in original units
  for (let i = 0; i < n; i++) {
    const eta = etaBuf[i];
    let prob: number;
    let f: number;
    let fp: number;
    if (kind === "logit") {
      const e = MATH.exp(-MATH.abs(eta));
      prob = eta >= 0 ? 1 / (1 + e) : e / (1 + e);
      f = e / ((1 + e) * (1 + e));
      fp = f * (1 - 2 * prob);
    } else {
      prob = normalTail(eta).cdf;
      f = INV_SQRT_2PI * MATH.exp(-0.5 * eta * eta);
      fp = -eta * f;
    }
    if ((prob > 0.5 ? 1 : 0) === yv[i]) correct++;
    fBar.v += f;
    const off = i * p;
    for (let l = 0; l < p; l++) a[l] += fp * Xs[off + l] * scale[l];
  }
  const meanF = fBar.v / n;
  for (let l = 0; l < p; l++) a[l] /= n;
  const marginalEffects: ModelTerm[] = [];
  for (let j = constant ? 1 : 0; j < p; j++) {
    // ∂AMEⱼ/∂βₗ = mean f · δⱼₗ + βⱼ · mean(f′ xₗ)
    const J = new Float64Array(p);
    for (let l = 0; l < p; l++) J[l] = coef[j] * a[l] + (l === j ? meanF : 0);
    let v = 0;
    for (let r = 0; r < p; r++) {
      let s = 0;
      for (let c = 0; c < p; c++) s += V[r * p + c] * J[c];
      v += J[r] * s;
    }
    marginalEffects.push(makeTerm(labels[j], meanF * coef[j], MATH.sqrt(MATH.max(0, v))));
  }

  // --- model statistics
  const ll = cur.ll;
  const llNull = n1 * MATH.log(n1 / n) + n0 * MATH.log(n0 / n);
  const dfModel = p - 1;
  const lr = 2 * (ll - llNull);
  const stats: ModelStat[] = [{ label: "N", value: n, decimals: 0 }, { label: "Log likelihood", value: ll }];
  if (dfModel > 0) {
    stats.push({ label: `LR χ²(${dfModel})`, value: lr }, { label: "Prob > χ²", value: chiSquareP(MATH.max(0, lr), dfModel) });
  }
  stats.push(
    { label: "Pseudo R²", value: 1 - ll / llNull },
    { label: "AIC", value: -2 * ll + 2 * p },
    { label: "BIC", value: -2 * ll + MATH.log(n) * p },
    { label: "Correctly predicted (%)", value: (100 * correct) / n, decimals: 1 },
  );

  const seLabel = seType === "hc0" ? "Robust (HC0)" : "Classical (inverse information)";
  const notes: string[] = [
    `Maximum likelihood by Newton–Raphson on the column-scaled design (score tolerance 10⁻¹⁰, at most ${maxIter} iterations): converged in ${plural(iterations, "iteration")}.`,
    seType === "hc0"
      ? "Standard errors: robust HC0 sandwich H⁻¹(Σ sᵢsᵢᵀ)H⁻¹ with no small-sample factor (statsmodels cov_type=\"HC0\")."
      : `Standard errors: classical, from the inverse of the observed information${kind === "probit" ? " (the observed, not the expected, Hessian)" : ""}.`,
    "z statistics and 95% intervals use the standard normal.",
    dfModel > 0
      ? `LR χ² tests the model against the constant-only model with ${plural(dfModel, "degree")} of freedom (k − 1)${constant ? "" : "; with no constant in the model the null is still constant-only, as statsmodels reports it"}.`
      : "With a single parameter there is no LR test.",
    "Pseudo R² is McFadden's, 1 − ℓ/ℓ₀; AIC = −2ℓ + 2k and BIC = −2ℓ + k ln N.",
    "Average marginal effects: dP/dx averaged over the sample (statsmodels get_margeff at=\"overall\", method=\"dydx\"), a 0/1 predictor treated as a continuous derivative; delta-method standard errors from the chosen covariance.",
    "Correctly predicted: a fitted probability above 0.5 counts as a predicted 1.",
  ];
  if (cur.extreme > 0) {
    notes.push(`${plural(cur.extreme, "observation")} ${cur.extreme === 1 ? "has" : "have"} a fitted probability within 10⁻¹⁰ of 0 or 1 (the estimates still converged).`);
  }
  if (!constant) notes.push("No constant: the model is forced through η = 0 (P = 0.5) at x = 0.");

  return {
    kind,
    depName,
    n,
    terms,
    statLabel: "z",
    seLabel,
    stats,
    notes,
    marginalEffects,
  };
}

/** Binary logit by maximum likelihood. y is 0/1; X is rows of predictor values WITHOUT the constant. */
export function fitLogit(y: number[], X: number[][], names: string[], opts: LogitProbitOptions = {}): FittedModel {
  return fit("logit", y, X, names, opts);
}

/** Binary probit by maximum likelihood. y is 0/1; X is rows of predictor values WITHOUT the constant. */
export function fitProbit(y: number[], X: number[][], names: string[], opts: LogitProbitOptions = {}): FittedModel {
  return fit("probit", y, X, names, opts);
}

// ---------------------------------------------------------------------------
// The report (display contract: true minus, ×10ⁿ, no NaN, p < 0.001 as "< 0.001")

/** A number to `d` decimals with a true minus; very small or very large magnitudes in ×10ⁿ form. */
export function fmtFixed(x: number, d = 3): string {
  if (!Number.isFinite(x)) throw new RangeError("non-finite value reached the logit/probit report");
  if (x === 0) return (0).toFixed(d);
  const ax = MATH.abs(x);
  if (ax < 0.5 * MATH.pow(10, -d) || ax >= 1e9) {
    // Four significant figures as m×10ⁿ (formatNum would write 2500000000000 or 0.00001799).
    let e = MATH.floor(MATH.log10(ax));
    let m = Number((x / MATH.pow(10, e)).toPrecision(4));
    if (MATH.abs(m) >= 10) {
      m /= 10;
      e += 1;
    }
    return `${formatNum(m, 4)}${timesTen(e)}`;
  }
  const s = x.toFixed(d);
  if (/^-0\.?0*$/.test(s)) return s.slice(1);
  return s.replace(/^-/, MINUS);
}

/** A p-value: "< 0.001" below 0.001, else three decimals. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) throw new RangeError("non-finite p-value reached the logit/probit report");
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

export function logitProbitReport(model: FittedModel): { text: string; tables: { label: string; rows: string[][] }[] } {
  const title = model.kind === "logit" ? "Logit" : model.kind === "probit" ? "Probit" : "Model";
  const head = ["Term", "Coefficient", "SE", "z", "p", "95% CI low", "95% CI high"];
  const termRow = (t: ModelTerm): string[] => [t.name, fmtFixed(t.coef, 4), fmtFixed(t.se, 4), fmtFixed(t.stat, 2), fmtP(t.p), fmtFixed(t.ciLo, 4), fmtFixed(t.ciHi, 4)];
  const tables: { label: string; rows: string[][] }[] = [
    { label: `${title} coefficients (dependent variable: ${model.depName}; standard errors: ${model.seLabel})`, rows: [head, ...model.terms.map(termRow)] },
  ];
  if (model.marginalEffects && model.marginalEffects.length) {
    tables.push({
      label: `Average marginal effects on P(${model.depName} = 1) (delta-method standard errors)`,
      rows: [["Term", "dP/dx", "SE", "z", "p", "95% CI low", "95% CI high"], ...model.marginalEffects.map(termRow)],
    });
  }
  const parts: string[] = [];
  let pLR: number | undefined;
  for (const s of model.stats) if (s.label === "Prob > χ²") pLR = s.value;
  for (const s of model.stats) {
    if (s.label === "Prob > χ²") continue;
    if (s.label === "N") parts.push(`N = ${s.value}`);
    else if (s.label.startsWith("LR χ²")) parts.push(`${s.label} = ${fmtFixed(s.value, 3)}${pLR !== undefined ? `, p ${pLR < 0.001 ? "< 0.001" : `= ${pLR.toFixed(3)}`}` : ""}`);
    else if (s.label === "Pseudo R²") parts.push(`McFadden pseudo R² = ${fmtFixed(s.value, s.decimals ?? 3)}`);
    else if (s.label === "Correctly predicted (%)") parts.push(`correctly predicted ${fmtFixed(s.value, 1)}%`);
    else parts.push(`${s.label} = ${fmtFixed(s.value, s.decimals ?? 3)}`);
  }
  const predictors = model.terms.filter((t) => t.name !== "Constant").map((t) => t.name);
  const lines = [
    `${title} regression of ${model.depName} on ${predictors.length ? predictors.join(", ") : "a constant"}`,
    `${parts.join("; ")}.`,
    `Standard errors: ${model.seLabel}.`,
    ...model.notes,
  ];
  return { text: lines.join("\n"), tables };
}
