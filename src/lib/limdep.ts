/**
 * Limited dependent and count models (Release F2 item #11), pure engines for src/lib/limdepStatCalcs.ts:
 *   - Poisson and negative binomial (NB2) regression with an exposure or offset, incidence-rate ratios, the
 *     Cameron–Trivedi overdispersion test, the LR test of α = 0, classical or HC0-robust standard errors;
 *   - tobit (censored at a lower and/or upper limit) with three average marginal effects;
 *   - Heckman selection by the two-step method (probit, inverse Mills ratio, corrected covariance);
 *   - ordered logit / probit (cut points) and multinomial logit (base category, RRRs, average marginal effects).
 *
 * Conventions follow statsmodels 0.15 where it has the model (Poisson, NegativeBinomial nb2, OrderedModel, MNLogit),
 * pinned in src/lib/__tests__/limdep.test.ts against scripts/limdep-oracle.py:
 *   - classical covariance = inverse of the observed information; HC0 = H⁻¹(Σ sᵢsᵢᵀ)H⁻¹, no small-sample factor;
 *   - NB2 variance μ + αμ², α estimated by maximum likelihood (fitted in ln α, reported as α: at the maximum the
 *     covariance is invariant to that reparameterisation); the null model of a pseudo R² is constant-only (with the
 *     offset), as statsmodels' llnull;
 *   - ordered models have no constant (the cut points carry the level), reported as cut points κ₁ < … < κ_{J−1}
 *     with P(y ≤ j) = F(κⱼ − xβ);
 *   - multinomial logit average marginal effects are get_margeff(at="overall", method="dydx").
 * Tobit and Heckman have no statsmodels estimator: tobit is checked against an independent scipy MLE, and Heckman
 * against a numpy re-implementation following Wooldridge, Econometric Analysis of Cross Section and Panel Data (2nd ed.,
 * 2010), §19.6, with the Heckman (1979) corrected covariance.
 *
 * Every fit is Newton–Raphson with step halving on a centred, column-scaled design, capped iterations, and REFUSES
 * (LimdepRefusal, by name) on non-convergence, separation (a coefficient running off to infinity), collinearity, no
 * variation, and inputs beyond the caps. An unconverged estimate is never returned.
 */
import type { FittedModel, ModelStat, ModelTerm } from "./regModel";
import { normalQuantile } from "./probdist";
import { chiSquareP } from "./stats2";
import { tTestP } from "./stats";
import { fitProbit, LogitProbitRefusal } from "./logitProbit";
import { fitOls } from "./olsInference";
import { numText } from "./regTable";

// ---------------------------------------------------------------------------------------------------- caps

/** Rows accepted by the count, tobit, Heckman and ordered models. */
export const LIMDEP_MAX_N = 10000;
/** Predictors (besides the constant) accepted by those models. */
export const LIMDEP_MAX_K = 15;
/** Rows accepted by multinomial logit (its Newton matrix grows with categories × predictors). */
export const MNL_MAX_N = 5000;
/** Predictors accepted by multinomial logit. */
export const MNL_MAX_K = 10;
/** Outcome categories of an ordered model. */
export const ORDERED_MAX_J = 10;
/** Outcome categories of a multinomial logit. */
export const MNL_MAX_J = 6;
/** Largest count accepted per observation. */
export const COUNT_MAX_Y = 10_000_000;
/** Newton–Raphson iteration cap (each fit can override it, so tests can force the refusal). */
export const LIMDEP_MAX_ITER = 100;

// ---------------------------------------------------------------------------------------------------- types

export type LimdepKind = "poisson" | "negbin" | "tobit" | "heckman" | "ologit" | "oprobit" | "mlogit";

/**
 * A fitted model in the publication table's shape (regModel.FittedModel) with a kind the table does not know yet
 * (the integrator widens FittedModel["kind"]; see the F2 #11 report). Auxiliary parameters are named "/alpha",
 * "/sigma", "cut1"… so they never collide with a predictor.
 */
export type LimdepModel = Omit<FittedModel, "kind"> & { kind: LimdepKind };

export type LimdepRefusalCode =
  | "bad-input"
  | "too-many"
  | "too-few"
  | "no-variation"
  | "collinear"
  | "separation"
  | "no-convergence"
  | "boundary"
  | "not-count"
  | "selection";

/** A named refusal: the model cannot be estimated as asked; the message says why in the user's terms. */
export class LimdepRefusal extends Error {
  readonly code: LimdepRefusalCode;
  constructor(code: LimdepRefusalCode, message: string) {
    super(message);
    this.name = "LimdepRefusal";
    this.code = code;
  }
}

const q = (s: string): string => `“${s}”`;
function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------------------------------- special functions

const MATH = Math;
const SQRT2 = MATH.SQRT2;
const SQRT_PI = MATH.sqrt(MATH.PI);
const INV_SQRT_2PI = 1 / MATH.sqrt(2 * MATH.PI);
const SQRT_2_OVER_PI = MATH.sqrt(2 / MATH.PI);
const LOG_SQRT_2PI = 0.5 * MATH.log(2 * MATH.PI);
const TWO_OVER_SQRT_PI = 2 / SQRT_PI;

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

/** erfcx(x) = exp(x²)·erfc(x), x ≥ 0 (Lentz continued fraction beyond 2.5: no underflow at any x). */
function erfcx(x: number): number {
  if (x < 2.5) return MATH.exp(x * x) * (1 - erfSmall(x));
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

/** Standard normal density. */
export function normPdf(t: number): number {
  return INV_SQRT_2PI * MATH.exp(-0.5 * t * t);
}
/** Φ(t), accurate in both tails. */
export function normCdf(t: number): number {
  if (t === Infinity) return 1;
  if (t === -Infinity) return 0;
  if (t < 0) return 0.5 * erfcx(-t / SQRT2) * MATH.exp(-0.5 * t * t);
  const x = t / SQRT2;
  const erfcVal = x < 2.5 ? 1 - erfSmall(x) : erfcx(x) * MATH.exp(-x * x);
  return 1 - 0.5 * erfcVal;
}
/** log Φ(t) with no underflow in the lower tail. */
export function normLogCdf(t: number): number {
  if (t === Infinity) return 0;
  if (t === -Infinity) return -Infinity;
  if (t < 0) return MATH.log(0.5 * erfcx(-t / SQRT2)) - 0.5 * t * t;
  const x = t / SQRT2;
  const erfcVal = x < 2.5 ? 1 - erfSmall(x) : erfcx(x) * MATH.exp(-x * x);
  return MATH.log1p(-0.5 * erfcVal);
}
/** The inverse Mills ratio φ(t)/Φ(t), accurate in both tails. */
export function millsRatio(t: number): number {
  if (t < 0) return SQRT_2_OVER_PI / erfcx(-t / SQRT2);
  return normPdf(t) / normCdf(t);
}

/** Two-sided normal p-value 2Φ(−|z|). */
function twoSidedP(z: number): number {
  const x = MATH.abs(z) / SQRT2;
  if (x < 2.5) return 1 - erfSmall(x);
  return erfcx(x) * MATH.exp(-x * x);
}

/** ln Γ(x), x > 0: upward recurrence to x ≥ 10, then the Stirling series (relative error near 10⁻¹⁵). */
export function lgamma(x: number): number {
  let shift = 0;
  let prod = 1;
  while (x < 10) {
    prod *= x;
    x += 1;
    if (prod < 1e-280 || prod > 1e280) {
      shift += MATH.log(prod);
      prod = 1;
    }
  }
  const x2 = 1 / (x * x);
  const series = (1 / x) * (1 / 12 - x2 * (1 / 360 - x2 * (1 / 1260 - x2 * (1 / 1680 - x2 * (1 / 1188)))));
  return (x - 0.5) * MATH.log(x) - x + LOG_SQRT_2PI + series - shift - MATH.log(prod);
}
/** ψ(x), x > 0. */
export function digamma(x: number): number {
  let acc = 0;
  while (x < 10) {
    acc -= 1 / x;
    x += 1;
  }
  const x2 = 1 / (x * x);
  return acc + MATH.log(x) - 0.5 / x - x2 * (1 / 12 - x2 * (1 / 120 - x2 * (1 / 252 - x2 * (1 / 240 - x2 * (1 / 132)))));
}
/** ψ′(x), x > 0. */
export function trigamma(x: number): number {
  let acc = 0;
  while (x < 10) {
    acc += 1 / (x * x);
    x += 1;
  }
  const ix = 1 / x;
  const x2 = ix * ix;
  return acc + ix + 0.5 * x2 + ix * x2 * (1 / 6 - x2 * (1 / 30 - x2 * (1 / 42 - x2 * (1 / 30 - x2 * (5 / 66)))));
}

// ---------------------------------------------------------------------------------------------------- linear algebra

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
  for (let i = 0; i < p; i++)
    for (let j = 0; j < i; j++) {
      const v = 0.5 * (inv[i * p + j] + inv[j * p + i]);
      inv[i * p + j] = v;
      inv[j * p + i] = v;
    }
  return inv;
}

/** C = A·B for row-major A (r×m) and B (m×c). */
function mul(A: Float64Array, B: Float64Array, r: number, m: number, c: number): Float64Array {
  const C = new Float64Array(r * c);
  for (let i = 0; i < r; i++)
    for (let k = 0; k < m; k++) {
      const a = A[i * m + k];
      if (a === 0) continue;
      for (let j = 0; j < c; j++) C[i * c + j] += a * B[k * c + j];
    }
  return C;
}
/** Aᵀ for row-major A (r×c). */
function transpose(A: Float64Array, r: number, c: number): Float64Array {
  const T = new Float64Array(r * c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j * r + i] = A[i * c + j];
  return T;
}
/** M·V·Mᵀ for M (r×p) and V (p×p). */
function sandwich(M: Float64Array, V: Float64Array, r: number, p: number): Float64Array {
  return mul(mul(M, V, r, p, p), transpose(M, r, p), r, p, r);
}
function symmetrize(A: Float64Array, p: number): void {
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) A[b * p + a] = A[a * p + b];
}

// ---------------------------------------------------------------------------------------------------- input checks

function checkNumbers(y: number[], X: number[][], names: string[], depName: string): void {
  const n = y.length;
  if (!Array.isArray(X) || X.length !== n) throw new LimdepRefusal("bad-input", `${depName} has ${plural(n, "row")} but the predictors have ${Array.isArray(X) ? X.length : 0}.`);
  const k = names.length;
  const seen = new Set<string>();
  for (const nm of names) {
    if (nm.trim().toLowerCase() === "constant") throw new LimdepRefusal("bad-input", `A predictor is named ${q(nm)}, the name of the constant term. Rename the column.`);
    if (seen.has(nm)) throw new LimdepRefusal("bad-input", `Two predictors are named ${q(nm)}. Give each column its own name.`);
    seen.add(nm);
  }
  for (let i = 0; i < n; i++) {
    if (typeof y[i] !== "number" || !Number.isFinite(y[i])) throw new LimdepRefusal("bad-input", `${depName}, row ${i + 1} is not a number.`);
    const r = X[i];
    if (!Array.isArray(r) || r.length !== k) throw new LimdepRefusal("bad-input", `Row ${i + 1} has ${Array.isArray(r) ? r.length : 0} predictor values; ${k} are named.`);
    for (let j = 0; j < k; j++) {
      const v = r[j];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new LimdepRefusal("bad-input", `${q(names[j])}, row ${i + 1} is not a number.`);
      const a = MATH.abs(v);
      if (a !== 0 && (a < 1e-100 || a > 1e100)) {
        throw new LimdepRefusal("bad-input", `${q(names[j])}, row ${i + 1}: ${numText(v)} is outside the magnitudes these models accept (10⁻¹⁰⁰ to 10¹⁰⁰, or 0). Rescale the column.`);
      }
    }
  }
}

function checkCaps(n: number, k: number, maxN: number, maxK: number, what: string): void {
  if (n > maxN) throw new LimdepRefusal("too-many", `${what} accepts at most ${plural(maxN, "row")}; the data have ${n.toLocaleString("en-US")}.`);
  if (k > maxK) throw new LimdepRefusal("too-many", `${what} accepts at most ${plural(maxK, "predictor")}; the model has ${k}.`);
}

// ---------------------------------------------------------------------------------------------------- the design

/**
 * The centred, column-scaled design (row-major n×p). With a constant it is column 0 and every predictor is centred on
 * its mean; `center` alone (the ordered models) centres without a constant column. Every predictor is then divided
 * by its largest absolute value, so a fit is invariant to units and offsets.
 */
interface Design {
  n: number;
  p: number;
  Xs: Float64Array;
  labels: string[];
  scale: Float64Array;
  centre: Float64Array;
  constant: boolean;
}

function buildDesign(X: number[][], names: string[], constant: boolean, center: boolean): Design {
  const n = X.length;
  const k = names.length;
  const p = k + (constant ? 1 : 0);
  const off = constant ? 1 : 0;
  const scale = new Float64Array(p).fill(1);
  const centre = new Float64Array(p);
  const cols: Float64Array[] = [];
  if (constant) cols.push(new Float64Array(n).fill(1));
  for (let j = 0; j < k; j++) {
    const c = new Float64Array(n);
    let mean = 0;
    if (constant || center) {
      for (let i = 0; i < n; i++) mean += X[i][j];
      mean /= n;
    }
    let m = 0;
    for (let i = 0; i < n; i++) {
      c[i] = X[i][j] - mean;
      m = MATH.max(m, MATH.abs(c[i]));
    }
    centre[j + off] = mean;
    scale[j + off] = m > 0 ? m : 1;
    for (let i = 0; i < n; i++) c[i] /= scale[j + off];
    cols.push(c);
  }
  const labels = constant ? ["Constant", ...names] : [...names];
  checkCollinear(cols, labels, constant);
  const Xs = new Float64Array(n * p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xs[i * p + j] = cols[j][i];
  return { n, p, Xs, labels, scale, centre, constant };
}

/** Collinearity by modified Gram–Schmidt (twice), naming the first dependent column. */
function checkCollinear(cols: Float64Array[], labels: string[], hasConstant: boolean): void {
  const n = cols.length ? cols[0].length : 0;
  const Q: Float64Array[] = [];
  const kept: number[] = [];
  for (let j = 0; j < cols.length; j++) {
    const c = cols[j];
    let norm0 = 0;
    for (let i = 0; i < n; i++) norm0 += c[i] * c[i];
    norm0 = MATH.sqrt(norm0);
    if (norm0 === 0) {
      throw new LimdepRefusal(
        hasConstant ? "collinear" : "no-variation",
        hasConstant
          ? `The predictor ${q(labels[j])} has the same value in every row, so it duplicates the constant. Remove it.`
          : `The predictor ${q(labels[j])} is zero in every row, so it carries no information. Remove it.`,
      );
    }
    const v = Float64Array.from(c);
    const coef = new Array<number>(Q.length).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < Q.length; a++) {
        let d = 0;
        for (let i = 0; i < n; i++) d += Q[a][i] * v[i];
        coef[a] += d;
        for (let i = 0; i < n; i++) v[i] -= d * Q[a][i];
      }
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += v[i] * v[i];
    norm = MATH.sqrt(norm);
    if (norm <= 1e-9 * norm0) {
      const partners = kept.filter((_, a) => MATH.abs(coef[a]) > 1e-6 * norm0).map((idx) => labels[idx]);
      const named = partners.filter((x) => x !== "Constant");
      if (!named.length) throw new LimdepRefusal("collinear", `The predictor ${q(labels[j])} has the same value in every row, so it duplicates the constant. Remove it.`);
      throw new LimdepRefusal(
        "collinear",
        `The predictors are perfectly collinear: ${q(labels[j])} is an exact linear combination of ${named.map(q).join(", ")}${partners.includes("Constant") ? " and the constant" : ""}, so the coefficients are not identified. Remove one of them.`,
      );
    }
    for (let i = 0; i < n; i++) v[i] /= norm;
    Q.push(v);
    kept.push(j);
  }
}

/** β = Tβ̃ (original units from the scaled design): βⱼ = β̃ⱼ/sⱼ and, with a constant, β₀ = β̃₀ − Σ β̃ⱼmⱼ/sⱼ. */
function designTransform(d: Design): Float64Array {
  const p = d.p;
  const T = new Float64Array(p * p);
  for (let a = 0; a < p; a++) T[a * p + a] = 1 / d.scale[a];
  if (d.constant) for (let j = 1; j < p; j++) T[j] = -d.centre[j] / d.scale[j];
  return T;
}

// ---------------------------------------------------------------------------------------------------- Newton–Raphson

interface Eval {
  ll: number;
  g: Float64Array;
  /** Observed information (−Hessian), row-major p×p. */
  A: Float64Array;
}
interface Problem {
  p: number;
  full(theta: Float64Array): Eval | null;
  llOnly(theta: Float64Array): number;
}
interface NewtonResult {
  theta: Float64Array;
  at: Eval;
  iterations: number;
}

/** Solves A d = g, damping A towards its diagonal when it is not positive definite (away from the maximum). */
function newtonDirection(A: Float64Array, g: Float64Array, p: number): Float64Array | null {
  let L = cholesky(A, p);
  if (L) return cholSolve(L, p, g);
  for (let lam = 1e-8; lam <= 1e8; lam *= 10) {
    const B = Float64Array.from(A);
    for (let j = 0; j < p; j++) B[j * p + j] += lam * (MATH.abs(A[j * p + j]) + 1e-12);
    L = cholesky(B, p);
    if (L) return cholSolve(L, p, g);
  }
  return null;
}

function decrement(A: Float64Array, g: Float64Array, p: number): number {
  const L = cholesky(A, p);
  if (!L) return Infinity;
  const d = cholSolve(L, p, g);
  let s = 0;
  for (let j = 0; j < p; j++) s += g[j] * d[j];
  return s;
}

/**
 * Maximises the log likelihood from theta0: Newton steps with halving, converged when the Newton decrement gᵀA⁻¹g
 * falls below 10⁻¹⁸·(1 + |ℓ|) (the predicted gain in ℓ; the coefficient error is then near 10⁻⁹ standard errors) or
 * the step stops moving any parameter. Refuses non-convergence by name.
 */
function newton(prob: Problem, theta0: Float64Array, maxIter: number, what: string): NewtonResult {
  const p = prob.p;
  if (!Number.isFinite(maxIter) || maxIter < 1 || maxIter > 10000) throw new LimdepRefusal("bad-input", "The iteration cap must be a whole number from 1 to 10,000.");
  let theta: Float64Array = Float64Array.from(theta0);
  let at = prob.full(theta);
  if (!at || !Number.isFinite(at.ll)) throw new LimdepRefusal("no-convergence", `${what}: the starting values give a log likelihood that is not a number, so the model cannot be fitted to these data.`);
  let iterations = 0;
  for (;;) {
    const dec = decrement(at.A, at.g, p);
    if (dec <= 1e-18 * (1 + MATH.abs(at.ll))) return { theta, at, iterations };
    if (iterations >= maxIter) break;
    const d = newtonDirection(at.A, at.g, p);
    if (!d) break;
    let t = 1;
    let moved: Float64Array | null = null;
    for (let h = 0; h < 60; h++) {
      const nb = new Float64Array(p);
      for (let j = 0; j < p; j++) nb[j] = theta[j] + t * d[j];
      const llNew = prob.llOnly(nb);
      if (Number.isFinite(llNew) && llNew >= at.ll - 1e-12 * (1 + MATH.abs(at.ll))) {
        moved = nb;
        break;
      }
      t /= 2;
    }
    if (!moved) {
      // No step increases ℓ: at round-off level of a maximum that is convergence; otherwise a stall.
      if (dec <= 1e-10 * (1 + MATH.abs(at.ll))) return { theta, at, iterations };
      break;
    }
    iterations++;
    let tiny = true;
    for (let j = 0; j < p; j++) if (MATH.abs(moved[j] - theta[j]) > 1e-13 * (1 + MATH.abs(moved[j]))) tiny = false;
    theta = moved;
    const next = prob.full(theta);
    if (!next || !Number.isFinite(next.ll)) break;
    at = next;
    if (tiny && decrement(at.A, at.g, p) <= 1e-10 * (1 + MATH.abs(at.ll))) return { theta, at, iterations };
  }
  throw new LimdepRefusal(
    "no-convergence",
    `${what}: Newton–Raphson did not converge in ${plural(maxIter, "iteration")}, so no estimate is reported. ` +
      "A predictor that (almost) perfectly predicts the outcome, a category with very few observations, or nearly collinear predictors are the usual causes.",
  );
}

/** The covariance (inverse information) at the maximum, or a named refusal when the information is singular. */
function invertInformation(A: Float64Array, p: number, what: string): Float64Array {
  const L = cholesky(A, p);
  if (!L) throw new LimdepRefusal("collinear", `${what}: the information matrix is singular at the estimate (nearly collinear predictors or a parameter that is not identified), so standard errors do not exist.`);
  return cholInverse(L, p);
}

/**
 * After convergence, one more full Newton step: at a true maximum it moves no linear predictor; when a coefficient
 * runs off to ±∞ (separation, or zero counts that a predictor sets apart) the step keeps moving the index by about 1.
 */
function separationProbe(prob: Problem, res: NewtonResult, etaMove: (step: Float64Array) => number, what: string, advice: string): void {
  const d = newtonDirection(res.at.A, res.at.g, prob.p);
  if (!d) return;
  if (etaMove(d) > 1e-4) {
    throw new LimdepRefusal(
      "separation",
      `${what}: the maximum-likelihood estimate does not exist: the log likelihood keeps rising as a coefficient runs off to infinity (separation). ${advice}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------------- terms

const Z975 = normalQuantile(0.975);

function makeTerm(name: string, est: number, se: number): ModelTerm {
  const z = est / se;
  return { name, coef: est, se, stat: z, p: twoSidedP(z), ciLo: est - Z975 * se, ciHi: est + Z975 * se };
}
/** exp(b) with the delta-method SE exp(b)·se and the interval from the exponentiated bounds (z and p of b). */
function expTerm(t: ModelTerm): ModelTerm {
  const e = MATH.exp(t.coef);
  return { name: t.name, coef: e, se: e * t.se, stat: t.stat, p: t.p, ciLo: MATH.exp(t.ciLo), ciHi: MATH.exp(t.ciHi) };
}
/**
 * exp(b) is printable only while b and its interval stay inside ±600 (beyond, exp under- or overflows the double
 * range: a constant of −16,667 when a predictor sits near 10⁶). Such terms are left out of the ratio table, by name.
 */
const EXP_LIMIT = 600;
function expTerms(ts: ModelTerm[]): { kept: ModelTerm[]; omitted: string[] } {
  const kept: ModelTerm[] = [];
  const omitted: string[] = [];
  for (const t of ts) {
    if (MATH.abs(t.ciLo) <= EXP_LIMIT && MATH.abs(t.ciHi) <= EXP_LIMIT && t.se * MATH.exp(t.coef) > 0) kept.push(expTerm(t));
    else omitted.push(t.name);
  }
  return { kept, omitted };
}

function assertFinite(terms: ModelTerm[], stats: ModelStat[], what: string): void {
  for (const t of terms) {
    for (const v of [t.coef, t.se, t.stat, t.p, t.ciLo, t.ciHi]) {
      if (!Number.isFinite(v)) throw new LimdepRefusal("bad-input", `${what}: the estimate for ${q(t.name)} is not a finite number at this scale. Rescale the column and fit again.`);
    }
    if (!(t.se > 0)) throw new LimdepRefusal("collinear", `${what}: the standard error of ${q(t.name)} is zero, so the parameter is not identified.`);
  }
  for (const s of stats) if (!Number.isFinite(s.value)) throw new LimdepRefusal("bad-input", `${what}: ${s.label} is not a finite number for these data.`);
}

/** Moves the constant from index 0 (the fit's algebra) to last (the tables' order). */
function constantLast<T>(xs: T[], constant: boolean): T[] {
  return constant ? [...xs.slice(1), xs[0]] : xs;
}

// ---------------------------------------------------------------------------------------------------- count models

export type CountModelKind = "poisson" | "nb2";
export type CountSe = "classical" | "hc0";

export interface CountOptions {
  model: CountModelKind;
  constant?: boolean;
  se?: CountSe;
  depName?: string;
  /** The offset of each row (ln exposure, or a user offset), or null. */
  offset?: number[] | null;
  maxIter?: number;
}

export interface CountResult {
  model: LimdepModel;
  /** Incidence-rate ratios exp(b) (constant last: the baseline rate per unit exposure). */
  irr: ModelTerm[];
  /** Terms whose exp(b) is outside the double range (left out of `irr`). */
  irrOmitted: string[];
  /** NB2 dispersion α with its SE and the interval exp(ln α ± 1.96·se(ln α)). */
  alpha?: { est: number; se: number; lo: number; hi: number };
  /** LR test of α = 0 (NB2 against Poisson), boundary p = ½·P(χ²₁ > LR). */
  lrAlpha?: { stat: number; p: number };
  /** Cameron–Trivedi auxiliary-regression test of the Poisson fit (NB2 alternative). */
  ct: { alpha: number; se: number; t: number; p: number };
  /** Pearson χ² of the Poisson fit and its residual degrees of freedom. */
  pearson: number;
  dfResid: number;
  /** Poisson deviance. */
  deviance: number;
  ll: number;
  llNull: number;
  llPoisson: number;
  iterations: number;
  nZero: number;
}

/** ln Γ(y + r) − ln Γ(r), ψ(y + r) − ψ(r) and ψ′(y + r) − ψ′(r) for an integer count y (exact sums for small y). */
const NBD = { lg: 0, psi: 0, tri: 0 };
function nbDiffs(y: number, r: number): typeof NBD {
  if (y <= 64) {
    let lg = 0;
    let psi = 0;
    let tri = 0;
    for (let k = 0; k < y; k++) {
      const v = r + k;
      lg += MATH.log(v);
      psi += 1 / v;
      tri -= 1 / (v * v);
    }
    NBD.lg = lg;
    NBD.psi = psi;
    NBD.tri = tri;
    return NBD;
  }
  NBD.lg = lgamma(y + r) - lgamma(r);
  NBD.psi = digamma(y + r) - digamma(r);
  NBD.tri = trigamma(y + r) - trigamma(r);
  return NBD;
}

class CountProblem implements Problem {
  readonly p: number;
  private readonly lgy: Float64Array;
  constructor(
    private readonly d: Design,
    private readonly y: Float64Array,
    private readonly off: Float64Array,
    private readonly nb: boolean,
  ) {
    this.p = d.p + (nb ? 1 : 0);
    this.lgy = new Float64Array(y.length);
    for (let i = 0; i < y.length; i++) this.lgy[i] = lgamma(y[i] + 1);
  }
  private eta(theta: Float64Array, i: number): number {
    const p = this.d.p;
    let s = this.off[i];
    const o = i * p;
    for (let j = 0; j < p; j++) s += this.d.Xs[o + j] * theta[j];
    return s;
  }
  llOnly(theta: Float64Array): number {
    return this.pass(theta, false)?.ll ?? -Infinity;
  }
  full(theta: Float64Array): Eval | null {
    return this.pass(theta, true);
  }
  /** Per-observation scores (for HC0), row-major n×p. */
  scores(theta: Float64Array): Float64Array {
    const n = this.y.length;
    const S = new Float64Array(n * this.p);
    this.pass(theta, false, S);
    return S;
  }
  linearMove(step: Float64Array): number {
    const p = this.d.p;
    let mx = 0;
    for (let i = 0; i < this.y.length; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += this.d.Xs[i * p + j] * step[j];
      mx = MATH.max(mx, MATH.abs(s));
    }
    return mx;
  }
  private pass(theta: Float64Array, wantA: boolean, S?: Float64Array): Eval | null {
    const { Xs } = this.d;
    const pb = this.d.p;
    const P = this.p;
    const n = this.y.length;
    const g = new Float64Array(P);
    const A = wantA ? new Float64Array(P * P) : new Float64Array(0);
    let ll = 0;
    const a = this.nb ? theta[pb] : 0;
    if (this.nb && (a > 30 || a < -40)) return null;
    const alpha = MATH.exp(a);
    const r = 1 / alpha;
    for (let i = 0; i < n; i++) {
      const eta = this.eta(theta, i);
      if (eta > 700) return null;
      const mu = MATH.exp(eta);
      const yi = this.y[i];
      const o = i * pb;
      let de: number; // ∂ℓ/∂η
      let dee: number; // −∂²ℓ/∂η²
      let da = 0;
      let dea = 0; // −∂²ℓ/∂η∂a
      let daa = 0; // −∂²ℓ/∂a²
      if (!this.nb) {
        ll += yi * eta - mu - this.lgy[i];
        de = yi - mu;
        dee = mu;
      } else {
        const u = alpha * mu;
        const l1u = MATH.log1p(u);
        const nd = nbDiffs(yi, r);
        ll += nd.lg - this.lgy[i] - (r + yi) * l1u + (yi > 0 ? yi * (a + eta) : 0);
        const opu = 1 + u;
        de = (yi - mu) / opu;
        dee = (mu * (1 + alpha * yi)) / (opu * opu);
        const brk = l1u - nd.psi;
        const dAlpha = r * r * brk + (r * (yi - mu)) / opu;
        da = alpha * dAlpha;
        dea = (alpha * (yi - mu) * mu) / (opu * opu);
        const d2Alpha = -2 * r * r * r * brk + r * r * (mu / opu + r * r * nd.tri) - (r * r * (yi - mu)) / opu - (r * (yi - mu) * mu) / (opu * opu);
        daa = -(alpha * alpha * d2Alpha + alpha * dAlpha);
      }
      if (!Number.isFinite(ll)) return null;
      for (let j = 0; j < pb; j++) g[j] += de * Xs[o + j];
      if (this.nb) g[pb] += da;
      if (S) {
        for (let j = 0; j < pb; j++) S[i * P + j] = de * Xs[o + j];
        if (this.nb) S[i * P + pb] = da;
      }
      if (wantA) {
        for (let j = 0; j < pb; j++) {
          const w = dee * Xs[o + j];
          for (let l = 0; l <= j; l++) A[j * P + l] += w * Xs[o + l];
        }
        if (this.nb) {
          for (let j = 0; j < pb; j++) A[pb * P + j] += dea * Xs[o + j];
          A[pb * P + pb] += daa;
        }
      }
    }
    if (wantA) symmetrize(A, P);
    return { ll, g, A };
  }
}

/** Poisson or NB2 regression by maximum likelihood. y are counts; X rows WITHOUT the constant. */
export function fitCount(y: number[], X: number[][], names: string[], opts: CountOptions): CountResult {
  const constant = opts.constant !== false;
  const depName = opts.depName ?? "y";
  const se: CountSe = opts.se ?? "classical";
  const maxIter = opts.maxIter ?? LIMDEP_MAX_ITER;
  const nb = opts.model === "nb2";
  const label = nb ? "Negative binomial (NB2)" : "Poisson";
  const n = y.length;
  checkCaps(n, names.length, LIMDEP_MAX_N, LIMDEP_MAX_K, `${label} regression`);
  checkNumbers(y, X, names, depName);
  for (let i = 0; i < n; i++) {
    if (y[i] < 0 || MATH.floor(y[i]) !== y[i]) throw new LimdepRefusal("not-count", `${label} needs ${q(depName)} to be a count (0, 1, 2, …); row ${i + 1} has ${numText(y[i])}.`);
    if (y[i] > COUNT_MAX_Y) throw new LimdepRefusal("too-many", `${q(depName)}, row ${i + 1}: counts above ${COUNT_MAX_Y.toLocaleString("en-US")} are outside this calculator's range.`);
  }
  const off = new Float64Array(n);
  if (opts.offset) {
    if (opts.offset.length !== n) throw new LimdepRefusal("bad-input", "The offset has a different number of rows from the data.");
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(opts.offset[i]) || MATH.abs(opts.offset[i]) > 700) throw new LimdepRefusal("bad-input", `The offset in row ${i + 1} is outside ±700 (or not a number).`);
      off[i] = opts.offset[i];
    }
  }
  let sumY = 0;
  let nZero = 0;
  for (let i = 0; i < n; i++) {
    sumY += y[i];
    if (y[i] === 0) nZero++;
  }
  if (sumY === 0) throw new LimdepRefusal("no-variation", `Every ${q(depName)} is 0, so there is nothing to explain: the rate's maximum-likelihood estimate is 0 and its log is −∞.`);
  const p = names.length + (constant ? 1 : 0);
  if (p === 0) throw new LimdepRefusal("bad-input", "There are no predictors and no constant: nothing to estimate.");
  if (n <= p + (nb ? 1 : 0)) throw new LimdepRefusal("too-few", `${plural(n, "observation")} cannot estimate ${plural(p + (nb ? 1 : 0), "parameter")}: the model needs more observations than parameters.`);
  const d = buildDesign(X, names, constant, false);
  const yv = Float64Array.from(y);

  // --- Poisson (always: the NB2 start, the overdispersion tests and the LR test of α = 0)
  const pois = new CountProblem(d, yv, off, false);
  const start = new Float64Array(p);
  let sumE = 0;
  for (let i = 0; i < n; i++) sumE += MATH.exp(off[i]);
  if (constant) start[0] = MATH.log(sumY / sumE);
  const pr = newton(pois, start, maxIter, "Poisson");
  separationProbe(pois, pr, (s) => pois.linearMove(s), "Poisson", "Observations with a zero count that a predictor sets apart from the rest drive the rate towards 0 (Santos Silva and Tenreyro); drop that predictor or those observations.");
  const mu = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = off[i];
    for (let j = 0; j < p; j++) s += d.Xs[i * p + j] * pr.theta[j];
    mu[i] = MATH.exp(s);
  }
  // Cameron–Trivedi (1990): OLS through the origin of ((y − μ)² − y)/μ on μ.
  let szm = 0;
  let smm = 0;
  let pearson = 0;
  let deviance = 0;
  let score0 = 0;
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const e = y[i] - mu[i];
    zs[i] = (e * e - y[i]) / mu[i];
    szm += zs[i] * mu[i];
    smm += mu[i] * mu[i];
    pearson += (e * e) / mu[i];
    deviance += 2 * ((y[i] > 0 ? y[i] * MATH.log(y[i] / mu[i]) : 0) - e);
    score0 += e * e - y[i];
  }
  const aCt = szm / smm;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = zs[i] - aCt * mu[i];
    sse += e * e;
  }
  const seCt = MATH.sqrt(sse / (n - 1) / smm);
  const tCt = aCt / seCt;
  const pTwo = tTestP(tCt, n - 1);
  const ct = { alpha: aCt, se: seCt, t: tCt, p: tCt > 0 ? pTwo / 2 : 1 - pTwo / 2 };
  // Null model: constant only, with the offset (closed form).
  const c0 = MATH.log(sumY / sumE);
  let llNullPois = 0;
  for (let i = 0; i < n; i++) llNullPois += y[i] * (c0 + off[i]) - MATH.exp(c0 + off[i]) - lgamma(y[i] + 1);

  let res = pr;
  let prob: CountProblem = pois;
  let llNull = llNullPois;
  let alpha: CountResult["alpha"];
  let lrAlpha: CountResult["lrAlpha"];
  if (nb) {
    if (!(score0 > 0)) {
      throw new LimdepRefusal(
        "boundary",
        `The NB2 dispersion α has its maximum at the boundary α = 0: the score for α at the Poisson fit, ½Σ[(y − μ̂)² − y] = ${numText(Number((score0 / 2).toPrecision(6)))}, is not positive, so the data are not overdispersed and NB2 reduces to Poisson. Use the Poisson model.`,
      );
    }
    prob = new CountProblem(d, yv, off, true);
    const st = new Float64Array(p + 1);
    st.set(pr.theta);
    st[p] = MATH.log(MATH.max(aCt, 0.1));
    res = newton(prob, st, maxIter, "Negative binomial (NB2)");
    if (res.theta[p] < -15) {
      throw new LimdepRefusal("boundary", "The NB2 dispersion α converged towards 0 (below 3×10⁻⁷): the data show no overdispersion, so NB2 reduces to Poisson. Use the Poisson model.");
    }
    // Null NB2: constant and α only, with the offset.
    const d0 = buildDesign(X.map(() => []), [], true, false);
    const p0 = new CountProblem(d0, yv, off, true);
    const r0 = newton(p0, Float64Array.from([c0, res.theta[p]]), maxIter, "Negative binomial (NB2), constant-only model");
    llNull = r0.at.ll;
  }
  const P = prob.p;
  const Ainv = invertInformation(res.at.A, P, label);
  let covS = Ainv;
  if (se === "hc0") {
    const S = prob.scores(res.theta);
    const M = new Float64Array(P * P);
    for (let i = 0; i < n; i++) for (let a = 0; a < P; a++) for (let b = 0; b <= a; b++) M[a * P + b] += S[i * P + a] * S[i * P + b];
    symmetrize(M, P);
    covS = mul(mul(Ainv, M, P, P, P), Ainv, P, P, P);
  }
  // Back to the user's units: β = Tβ̃; ln α is unscaled.
  const Tb = designTransform(d);
  const T = new Float64Array(P * P);
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) T[a * P + b] = Tb[a * p + b];
  if (nb) T[p * P + p] = 1;
  const V = sandwich(T, covS, P, P);
  const coef = mul(T, res.theta, P, P, 1);
  const terms = d.labels.map((nm, j) => makeTerm(nm, coef[j], MATH.sqrt(V[j * P + j])));
  if (nb) {
    const la = coef[p];
    const sla = MATH.sqrt(V[p * P + p]);
    alpha = { est: MATH.exp(la), se: MATH.exp(la) * sla, lo: MATH.exp(la - Z975 * sla), hi: MATH.exp(la + Z975 * sla) };
    const lr = MATH.max(0, 2 * (res.at.ll - pr.at.ll));
    lrAlpha = { stat: lr, p: lr > 0 ? 0.5 * chiSquareP(lr, 1) : 0.5 };
  }
  const ll = res.at.ll;
  const k = names.length;
  const nPar = p + (nb ? 1 : 0);
  const stats: ModelStat[] = [{ label: "N", value: n, decimals: 0 }, { label: "Log likelihood", value: ll }];
  const dfLr = constant ? k : MATH.max(0, p - 1);
  if (dfLr > 0) {
    const lr = 2 * (ll - llNull);
    stats.push({ label: `LR χ²(${dfLr})`, value: lr }, { label: "Prob > χ²", value: chiSquareP(MATH.max(0, lr), dfLr) });
  }
  stats.push({ label: "Pseudo R²", value: 1 - ll / llNull }, { label: "AIC", value: -2 * ll + 2 * nPar }, { label: "BIC", value: -2 * ll + MATH.log(n) * nPar });
  if (alpha) stats.push({ label: "/alpha", value: alpha.est });
  const ordered = constantLast(terms, constant);
  const { kept: irr, omitted: irrOmitted } = expTerms(ordered);
  assertFinite([...ordered, ...irr], stats, label);
  const notes: string[] = [
    `Maximum likelihood by Newton–Raphson on the centred, column-scaled design (at most ${plural(maxIter, "iteration")}): converged in ${plural(res.iterations, "iteration")}.`,
    se === "hc0"
      ? "Standard errors: robust HC0 sandwich H⁻¹(Σ sᵢsᵢᵀ)H⁻¹, no small-sample factor (statsmodels cov_type=\"HC0\")."
      : "Standard errors: classical, the inverse of the observed information.",
  ];
  return {
    model: {
      kind: nb ? "negbin" : "poisson",
      depName,
      n,
      terms: ordered,
      statLabel: "z",
      seLabel: se === "hc0" ? "Robust (HC0)" : "Classical (inverse information)",
      stats,
      notes,
    },
    irr,
    irrOmitted,
    alpha,
    lrAlpha,
    ct,
    pearson,
    dfResid: n - p,
    deviance,
    ll,
    llNull,
    llPoisson: pr.at.ll,
    iterations: res.iterations,
    nZero,
  };
}

// ---------------------------------------------------------------------------------------------------- tobit

export interface TobitOptions {
  /** Lower censoring limit (null = none). */
  lower: number | null;
  /** Upper censoring limit (null = none). */
  upper: number | null;
  constant?: boolean;
  depName?: string;
  maxIter?: number;
}

export interface TobitAme {
  name: string;
  /** ∂E[y]/∂x (the observed, censored outcome). */
  unconditional: ModelTerm;
  /** ∂E[y | L < y < U]/∂x. */
  conditional: ModelTerm;
  /** ∂P(L < y < U)/∂x. */
  probability: ModelTerm;
}

export interface TobitResult {
  model: LimdepModel;
  sigma: { est: number; se: number; lo: number; hi: number };
  ame: TobitAme[];
  nLeft: number;
  nUncensored: number;
  nRight: number;
  ll: number;
  llNull: number;
  iterations: number;
}

/**
 * Olsen's (1978) parameterisation γ = β/σ, θ = 1/σ, in which the tobit log likelihood is globally concave. y, L, U are
 * divided by a scale sy before the fit.
 */
class TobitProblem implements Problem {
  readonly p: number;
  constructor(
    private readonly d: Design,
    private readonly y: Float64Array,
    private readonly cls: Int8Array,
    private readonly lo: number,
    private readonly hi: number,
  ) {
    this.p = d.p + 1;
  }
  llOnly(theta: Float64Array): number {
    return this.pass(theta, false)?.ll ?? -Infinity;
  }
  full(theta: Float64Array): Eval | null {
    return this.pass(theta, true);
  }
  private pass(theta: Float64Array, wantA: boolean): Eval | null {
    const pb = this.d.p;
    const P = this.p;
    const th = theta[pb];
    if (!(th > 0)) return null;
    const { Xs } = this.d;
    const g = new Float64Array(P);
    const A = wantA ? new Float64Array(P * P) : new Float64Array(0);
    let ll = 0;
    const logTh = MATH.log(th);
    for (let i = 0; i < this.y.length; i++) {
      const o = i * pb;
      let xg = 0;
      for (let j = 0; j < pb; j++) xg += Xs[o + j] * theta[j];
      const c = this.cls[i];
      if (c === 0) {
        const yi = this.y[i];
        const e = th * yi - xg;
        ll += logTh - LOG_SQRT_2PI - 0.5 * e * e;
        for (let j = 0; j < pb; j++) g[j] += e * Xs[o + j];
        g[pb] += 1 / th - e * yi;
        if (wantA) {
          for (let j = 0; j < pb; j++) {
            for (let l = 0; l <= j; l++) A[j * P + l] += Xs[o + j] * Xs[o + l];
            A[pb * P + j] -= yi * Xs[o + j];
          }
          A[pb * P + pb] += 1 / (th * th) + yi * yi;
        }
      } else {
        // left: t = θL − xγ, ∇t = (−x, L); right: t = xγ − θU, ∇t = (x, −U).
        const sgn = c < 0 ? -1 : 1;
        const lim = c < 0 ? this.lo : this.hi;
        const t = c < 0 ? th * lim - xg : xg - th * lim;
        ll += normLogCdf(t);
        const lam = millsRatio(t);
        const w = lam * (t + lam);
        const gt = -sgn * lim; // ∂t/∂θ
        for (let j = 0; j < pb; j++) g[j] += lam * sgn * Xs[o + j];
        g[pb] += lam * gt;
        if (wantA) {
          for (let j = 0; j < pb; j++) {
            const xj = sgn * Xs[o + j];
            for (let l = 0; l <= j; l++) A[j * P + l] += w * xj * sgn * Xs[o + l];
            A[pb * P + j] += w * gt * xj;
          }
          A[pb * P + pb] += w * gt * gt;
        }
      }
      if (!Number.isFinite(ll)) return null;
    }
    if (wantA) symmetrize(A, P);
    return { ll, g, A };
  }
}

function tobitFitCore(d: Design, ys: Float64Array, cls: Int8Array, lo: number, hi: number, maxIter: number, what: string): NewtonResult {
  const n = ys.length;
  const pb = d.p;
  // Start: OLS of y on the design over every row.
  const XtX = new Float64Array(pb * pb);
  const Xty = new Float64Array(pb);
  for (let i = 0; i < n; i++) {
    const o = i * pb;
    for (let j = 0; j < pb; j++) {
      Xty[j] += d.Xs[o + j] * ys[i];
      for (let l = 0; l < pb; l++) XtX[j * pb + l] += d.Xs[o + j] * d.Xs[o + l];
    }
  }
  const L = cholesky(XtX, pb);
  if (!L) throw new LimdepRefusal("collinear", `${what}: the predictors are (nearly) collinear, so the coefficients are not identified.`);
  const b = cholSolve(L, pb, Xty);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = 0; j < pb; j++) f += d.Xs[i * pb + j] * b[j];
    ss += (ys[i] - f) * (ys[i] - f);
  }
  const s0 = MATH.max(MATH.sqrt(ss / n), 1e-3);
  const st = new Float64Array(pb + 1);
  for (let j = 0; j < pb; j++) st[j] = b[j] / s0;
  st[pb] = 1 / s0;
  const prob = new TobitProblem(d, ys, cls, lo, hi);
  return newton(prob, st, maxIter, what);
}

/** Tobit by maximum likelihood, censored at `lower` and/or `upper`. X rows WITHOUT the constant. */
export function fitTobit(y: number[], X: number[][], names: string[], opts: TobitOptions): TobitResult {
  const constant = opts.constant !== false;
  const depName = opts.depName ?? "y";
  const maxIter = opts.maxIter ?? LIMDEP_MAX_ITER;
  const { lower, upper } = opts;
  const n = y.length;
  checkCaps(n, names.length, LIMDEP_MAX_N, LIMDEP_MAX_K, "Tobit");
  checkNumbers(y, X, names, depName);
  if (lower === null && upper === null) throw new LimdepRefusal("bad-input", "Give a lower limit, an upper limit or both: tobit needs a censoring point.");
  if (lower !== null && !Number.isFinite(lower)) throw new LimdepRefusal("bad-input", "The lower limit is not a number.");
  if (upper !== null && !Number.isFinite(upper)) throw new LimdepRefusal("bad-input", "The upper limit is not a number.");
  if (lower !== null && upper !== null && !(lower < upper)) throw new LimdepRefusal("bad-input", `The lower limit (${numText(lower)}) must be below the upper limit (${numText(upper)}).`);
  const cls = new Int8Array(n);
  let nl = 0;
  let nr = 0;
  for (let i = 0; i < n; i++) {
    if (lower !== null && y[i] <= lower) {
      cls[i] = -1;
      nl++;
    } else if (upper !== null && y[i] >= upper) {
      cls[i] = 1;
      nr++;
    }
  }
  const nu = n - nl - nr;
  if (nl + nr === 0) {
    throw new LimdepRefusal("no-variation", `No value of ${q(depName)} is at or beyond the censoring limit${lower !== null && upper !== null ? "s" : ""}, so nothing is censored and tobit is ordinary least squares. Check the limit, or use OLS.`);
  }
  if (nu === 0) throw new LimdepRefusal("no-variation", `Every value of ${q(depName)} is censored, so σ and the coefficients are not identified.`);
  const p = names.length + (constant ? 1 : 0);
  if (p === 0) throw new LimdepRefusal("bad-input", "There are no predictors and no constant: nothing to estimate.");
  if (nu < 2 || n <= p + 1) throw new LimdepRefusal("too-few", `${plural(n, "observation")} (${nu} uncensored) cannot estimate ${plural(p + 1, "parameter")}.`);
  // Scale y by its standard deviation (σ and β scale with it; ℓ shifts by −n_u ln s_y).
  let my = 0;
  for (let i = 0; i < n; i++) my += y[i];
  my /= n;
  let vy = 0;
  for (let i = 0; i < n; i++) vy += (y[i] - my) * (y[i] - my);
  const sy = MATH.sqrt(vy / n);
  if (!(sy > 0)) throw new LimdepRefusal("no-variation", `${q(depName)} has the same value in every row: nothing to explain.`);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) ys[i] = y[i] / sy;
  const lo = lower !== null ? lower / sy : 0;
  const hi = upper !== null ? upper / sy : 0;
  const d = buildDesign(X, names, constant, false);
  const res = tobitFitCore(d, ys, cls, lo, hi, maxIter, "Tobit");
  const P = p + 1;
  const Ainv = invertInformation(res.at.A, P, "Tobit");
  // (γ, θ) → (β̃, σ̃) = (γ/θ, 1/θ) → original units (sy·Tβ̃, sy·σ̃).
  const th = res.theta[p];
  const G = new Float64Array(P * P);
  for (let j = 0; j < p; j++) {
    G[j * P + j] = 1 / th;
    G[j * P + p] = -res.theta[j] / (th * th);
  }
  G[p * P + p] = -1 / (th * th);
  const Tb = designTransform(d);
  const M = new Float64Array(P * P);
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a * P + b] = sy * Tb[a * p + b];
  M[p * P + p] = sy;
  const J = mul(M, G, P, P, P);
  const V = sandwich(J, Ainv, P, P);
  const phi = new Float64Array(P);
  for (let j = 0; j < p; j++) phi[j] = res.theta[j] / th;
  phi[p] = 1 / th;
  const est = mul(M, phi, P, P, 1);
  const terms = d.labels.map((nm, j) => makeTerm(nm, est[j], MATH.sqrt(V[j * P + j])));
  const sig = est[p];
  const sigSe = MATH.sqrt(V[p * P + p]);
  const sigma = { est: sig, se: sigSe, lo: sig - Z975 * sigSe, hi: sig + Z975 * sigSe };
  const ll = res.at.ll - nu * MATH.log(sy);
  // Null model: constant only.
  const d0 = buildDesign(X.map(() => []), [], true, false);
  const r0 = tobitFitCore(d0, ys, cls, lo, hi, maxIter, "Tobit, constant-only model");
  const llNull = r0.at.ll - nu * MATH.log(sy);

  // Average marginal effects in original units with delta-method SEs from the ANALYTIC Jacobian in (β, σ).
  // Per observation (zL = (L − xβ)/σ, zU = (U − xβ)/σ, absent limits at ∓∞; ρL = φ(zL)/P, ρU = φ(zU)/P):
  //   P = Φ(zU) − Φ(zL) = P(uncensored); C = 1 + A − r² with r = ρL − ρU, A = zLρL − zUρU (so ∂E[y | unc]/∂x = βC);
  //   G = φ(zL) − φ(zU) (so ∂P(unc)/∂x = βG/σ). Their z-derivatives:
  //   ∂P/∂zL = −φL, ∂P/∂zU = φU; ∂G/∂zL = −zLφL, ∂G/∂zU = zUφU;
  //   ∂C/∂zL = ρL[(1 − zL²) + A + 2r·zL − 2r²], ∂C/∂zU = −ρU[(1 − zU²) + A + 2r·zU − 2r²];
  // and ∂z/∂βₗ = −xₗ/σ, ∂z/∂σ = −z/σ.
  const k = names.length;
  const off = constant ? 1 : 0;
  const s = sig;
  let SP = 0;
  let SC = 0;
  let SG = 0;
  let SPz = 0;
  let SCz = 0;
  let SGz = 0;
  const SPx = new Float64Array(p);
  const SCx = new Float64Array(p);
  const SGx = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    let xb = constant ? est[0] : 0;
    for (let j = 0; j < k; j++) xb += X[i][j] * est[j + off];
    const hasL = lower !== null;
    const hasU = upper !== null;
    const zl = hasL ? (lower - xb) / s : 0;
    const zu = hasU ? (upper - xb) / s : 0;
    const fl = hasL ? normPdf(zl) : 0;
    const fu = hasU ? normPdf(zu) : 0;
    let Pin: number;
    let rl: number;
    let ru: number;
    if (hasL && hasU) {
      // Without cancellation when both CDFs are near 1.
      Pin = zl > 0 ? normCdf(-zl) - normCdf(-zu) : normCdf(zu) - normCdf(zl);
      rl = fl / Pin;
      ru = fu / Pin;
    } else if (hasL) {
      Pin = normCdf(-zl);
      rl = millsRatio(-zl);
      ru = 0;
    } else {
      Pin = normCdf(zu);
      rl = 0;
      ru = millsRatio(zu);
    }
    const r = rl - ru;
    const A = zl * rl - zu * ru;
    const C = 1 + A - r * r;
    const dPl = -fl;
    const dPu = fu;
    const dGl = -zl * fl;
    const dGu = zu * fu;
    const dCl = hasL ? rl * (1 - zl * zl + A + 2 * r * zl - 2 * r * r) : 0;
    const dCu = hasU ? -ru * (1 - zu * zu + A + 2 * r * zu - 2 * r * r) : 0;
    SP += Pin;
    SC += C;
    SG += fl - fu;
    SPz += dPl * zl + dPu * zu;
    SCz += dCl * zl + dCu * zu;
    SGz += dGl * zl + dGu * zu;
    const dP = dPl + dPu;
    const dC = dCl + dCu;
    const dG = dGl + dGu;
    for (let l = 0; l < p; l++) {
      const xl = constant ? (l === 0 ? 1 : X[i][l - 1]) : X[i][l];
      SPx[l] += dP * xl;
      SCx[l] += dC * xl;
      SGx[l] += dG * xl;
    }
  }
  const mP = SP / n;
  const mC = SC / n;
  const mG = SG / n;
  const base = new Float64Array(3 * k);
  const Jac = new Float64Array(3 * k * P);
  for (let j = 0; j < k; j++) {
    const bj = est[j + off];
    base[3 * j] = bj * mP;
    base[3 * j + 1] = bj * mC;
    base[3 * j + 2] = (bj / s) * mG;
    for (let l = 0; l < p; l++) {
      const own = l === j + off ? 1 : 0;
      Jac[3 * j * P + l] = own * mP - (bj * SPx[l]) / (n * s);
      Jac[(3 * j + 1) * P + l] = own * mC - (bj * SCx[l]) / (n * s);
      Jac[(3 * j + 2) * P + l] = (own * mG) / s - (bj * SGx[l]) / (n * s * s);
    }
    Jac[3 * j * P + p] = -(bj * SPz) / (n * s);
    Jac[(3 * j + 1) * P + p] = -(bj * SCz) / (n * s);
    Jac[(3 * j + 2) * P + p] = -(bj * mG) / (s * s) - (bj * SGz) / (n * s * s);
  }
  const Vame = sandwich(Jac, V, 3 * k, P);
  const ame: TobitAme[] = names.map((nm, j) => ({
    name: nm,
    unconditional: makeTerm(nm, base[3 * j], MATH.sqrt(MATH.max(0, Vame[3 * j * 3 * k + 3 * j]))),
    conditional: makeTerm(nm, base[3 * j + 1], MATH.sqrt(MATH.max(0, Vame[(3 * j + 1) * 3 * k + 3 * j + 1]))),
    probability: makeTerm(nm, base[3 * j + 2], MATH.sqrt(MATH.max(0, Vame[(3 * j + 2) * 3 * k + 3 * j + 2]))),
  }));
  const stats: ModelStat[] = [{ label: "N", value: n, decimals: 0 }, { label: "Log likelihood", value: ll }];
  const dfLr = constant ? k : MATH.max(0, p - 1);
  if (dfLr > 0) {
    const lr = 2 * (ll - llNull);
    stats.push({ label: `LR χ²(${dfLr})`, value: lr }, { label: "Prob > χ²", value: chiSquareP(MATH.max(0, lr), dfLr) });
  }
  stats.push({ label: "Pseudo R²", value: 1 - ll / llNull }, { label: "AIC", value: -2 * ll + 2 * P }, { label: "BIC", value: -2 * ll + MATH.log(n) * P }, { label: "/sigma", value: sig });
  const ordered = constantLast(terms, constant);
  assertFinite([...ordered, ...ame.flatMap((a) => [a.unconditional, a.conditional, a.probability])], stats, "Tobit");
  if (!(sigSe > 0) || !Number.isFinite(sigSe)) throw new LimdepRefusal("collinear", "Tobit: the standard error of σ is not a positive finite number for these data.");
  return {
    model: {
      kind: "tobit",
      depName,
      n,
      terms: ordered,
      statLabel: "z",
      seLabel: "Classical (inverse information)",
      stats,
      notes: [`Maximum likelihood by Newton–Raphson in Olsen's parameterisation γ = β/σ, θ = 1/σ (globally concave; at most ${plural(maxIter, "iteration")}): converged in ${plural(res.iterations, "iteration")}.`],
    },
    sigma,
    ame,
    nLeft: nl,
    nUncensored: nu,
    nRight: nr,
    ll,
    llNull,
    iterations: res.iterations,
  };
}

// ---------------------------------------------------------------------------------------------------- Heckman two-step

export interface HeckmanInput {
  /** Selection indicator (0/1) for every row of the selection sample. */
  s: number[];
  /** Selection-equation regressors for every row (WITHOUT the constant). */
  Z: number[][];
  zNames: string[];
  selName: string;
  /** Outcome and its regressors for the selected rows, in the order they appear among the rows with s = 1. */
  y: number[];
  X: number[][];
  xNames: string[];
  depName: string;
  maxIter?: number;
}

export interface HeckmanResult {
  /** The outcome equation: predictors, "λ (inverse Mills ratio)", Constant; corrected two-step SEs. */
  model: LimdepModel;
  /** The probit selection equation (classical SEs, constant last), from logitProbit.fitProbit. */
  selection: ModelTerm[];
  probitLl: number;
  rho: number;
  sigma: number;
  /** True when the two-step ρ fell outside [−1, 1] and was truncated to ±1 (σ then = |b_λ|). */
  truncated: boolean;
  lambda: ModelTerm;
  n: number;
  nSelected: number;
  /** Wald χ² that every outcome predictor's coefficient (not λ, not the constant) is zero. */
  wald: { stat: number; df: number; p: number };
  /** Selection regressors that are excluded from the outcome equation (the exclusion restrictions). */
  excluded: string[];
}

export const MILLS_NAME = "λ (inverse Mills ratio)";

/** Heckman's two-step estimator (Wooldridge 2010, §19.6; covariance of Heckman 1979). MLE is not offered. */
export function fitHeckman(inp: HeckmanInput): HeckmanResult {
  const { s, Z, zNames, y, X, xNames, depName, selName } = inp;
  const maxIter = inp.maxIter ?? LIMDEP_MAX_ITER;
  const n = s.length;
  checkCaps(n, MATH.max(zNames.length, xNames.length), LIMDEP_MAX_N, LIMDEP_MAX_K, "Heckman selection");
  checkNumbers(s, Z, zNames, selName);
  checkNumbers(y, X, xNames, depName);
  let n1 = 0;
  for (let i = 0; i < n; i++) {
    if (s[i] !== 0 && s[i] !== 1) throw new LimdepRefusal("selection", `The selection indicator ${q(selName)} must be 0 or 1; row ${i + 1} has ${numText(s[i])}.`);
    n1 += s[i];
  }
  if (n1 === 0 || n1 === n) throw new LimdepRefusal("selection", `Every row has ${q(selName)} = ${n1 === 0 ? 0 : 1}, so there is no selection to model: the probit needs both 0s and 1s.`);
  if (y.length !== n1) throw new LimdepRefusal("bad-input", `The outcome has ${plural(y.length, "row")} but ${plural(n1, "row")} are selected.`);
  for (const nm of xNames) if (nm === MILLS_NAME) throw new LimdepRefusal("bad-input", `A column is named ${q(nm)}, the name of the inverse Mills ratio term. Rename it.`);
  const kx = xNames.length;
  if (n1 <= kx + 2) throw new LimdepRefusal("too-few", `${plural(n1, "selected observation")} cannot estimate the outcome equation's ${kx + 2} parameters (predictors, λ and the constant).`);

  // Stage 1: probit (logitProbit.fitProbit: its separation and collinearity refusals).
  let probit: FittedModel;
  try {
    probit = fitProbit(s, Z, zNames, { constant: true, se: "classical", depName: selName, maxIter });
  } catch (e) {
    if (e instanceof LogitProbitRefusal) throw new LimdepRefusal("selection", `Selection equation (probit of ${q(selName)}): ${e.message}`);
    throw e;
  }
  const kz = zNames.length;
  const pz = kz + 1;
  // γ in the order [z…, constant] (fitProbit lists the constant last).
  const gamma = new Float64Array(pz);
  for (let j = 0; j < kz; j++) gamma[j] = probit.terms[j].coef;
  gamma[kz] = probit.terms[kz].coef;
  // V_γ: inverse observed information on column-scaled z (the same quantity fitProbit's classical SEs come from).
  const zsc = new Float64Array(pz).fill(1);
  for (let j = 0; j < kz; j++) {
    let m = 0;
    for (let i = 0; i < n; i++) m = MATH.max(m, MATH.abs(Z[i][j]));
    zsc[j] = m > 0 ? m : 1;
  }
  const zrow = (i: number, j: number): number => (j < kz ? Z[i][j] : 1);
  const Ainfo = new Float64Array(pz * pz);
  const zg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = 0; j < pz; j++) e += zrow(i, j) * gamma[j];
    zg[i] = e;
    const qq = 2 * s[i] - 1;
    const t = qq * e;
    const lam = millsRatio(t);
    const w = lam * (lam + t);
    for (let a = 0; a < pz; a++) for (let b = 0; b <= a; b++) Ainfo[a * pz + b] += (w * zrow(i, a) * zrow(i, b)) / (zsc[a] * zsc[b]);
  }
  symmetrize(Ainfo, pz);
  const VgS = invertInformation(Ainfo, pz, "Selection equation");
  const Vg = new Float64Array(pz * pz);
  for (let a = 0; a < pz; a++) for (let b = 0; b < pz; b++) Vg[a * pz + b] = VgS[a * pz + b] / (zsc[a] * zsc[b]);

  // λ and δ for the selected rows.
  const selRows: number[] = [];
  for (let i = 0; i < n; i++) if (s[i] === 1) selRows.push(i);
  const lam = new Float64Array(n1);
  const del = new Float64Array(n1);
  for (let r = 0; r < n1; r++) {
    const t = zg[selRows[r]];
    lam[r] = millsRatio(t);
    del[r] = lam[r] * (lam[r] + t);
  }

  // Stage 2: OLS of y on x and λ (olsInference.fitOls: its collinearity refusals; constant last).
  const cols: number[][] = xNames.map((_, j) => X.map((row) => row[j]));
  const ols = fitOls({ y, depName, X: [...cols, Array.from(lam)], names: [...xNames, MILLS_NAME], constant: true, se: "classical" });
  if (!ols.ok) throw new LimdepRefusal("collinear", `Outcome equation (OLS of ${q(depName)} on its predictors and λ): ${ols.reason}`);
  const pw = kx + 2;
  const b = new Float64Array(pw);
  for (let j = 0; j < pw; j++) b[j] = ols.model.terms[j].coef;
  const bl = b[kx];
  const wrow = (r: number, j: number): number => (j < kx ? X[r][j] : j === kx ? lam[r] : 1);
  let ee = 0;
  for (let r = 0; r < n1; r++) {
    let f = 0;
    for (let j = 0; j < pw; j++) f += wrow(r, j) * b[j];
    ee += (y[r] - f) * (y[r] - f);
  }
  let mdel = 0;
  for (let r = 0; r < n1; r++) mdel += del[r];
  mdel /= n1;
  let sig2 = ee / n1 + bl * bl * mdel;
  let sig = MATH.sqrt(sig2);
  let rho = bl / sig;
  let truncated = false;
  if (MATH.abs(rho) > 1) {
    truncated = true;
    rho = rho > 0 ? 1 : -1;
    sig = MATH.abs(bl);
    sig2 = sig * sig;
  }
  // Column scales for the W'W inversion.
  const wsc = new Float64Array(pw).fill(1);
  for (let j = 0; j < pw; j++) {
    let m = 0;
    for (let r = 0; r < n1; r++) m = MATH.max(m, MATH.abs(wrow(r, j)));
    wsc[j] = m > 0 ? m : 1;
  }
  const WtW = new Float64Array(pw * pw);
  const WtDW = new Float64Array(pw * pw);
  const WtDZ = new Float64Array(pw * pz);
  const rho2 = rho * rho;
  for (let r = 0; r < n1; r++) {
    const i = selRows[r];
    for (let a = 0; a < pw; a++) {
      const wa = wrow(r, a) / wsc[a];
      for (let c = 0; c <= a; c++) {
        const wc = wrow(r, c) / wsc[c];
        WtW[a * pw + c] += wa * wc;
        WtDW[a * pw + c] += (1 - rho2 * del[r]) * wa * wc;
      }
      for (let c = 0; c < pz; c++) WtDZ[a * pz + c] += del[r] * wa * zrow(i, c);
    }
  }
  symmetrize(WtW, pw);
  symmetrize(WtDW, pw);
  const Lw = cholesky(WtW, pw);
  if (!Lw) throw new LimdepRefusal("collinear", "Outcome equation: the predictors and λ are (nearly) collinear, so the corrected covariance does not exist. Add an exclusion restriction (a selection variable not in the outcome equation).");
  const Minv = cholInverse(Lw, pw);
  const Qm = mul(mul(WtDZ, Vg, pw, pz, pz), transpose(WtDZ, pw, pz), pw, pz, pw);
  const mid = new Float64Array(pw * pw);
  for (let a = 0; a < pw * pw; a++) mid[a] = WtDW[a] + rho2 * Qm[a];
  const Vs = mul(mul(Minv, mid, pw, pw, pw), Minv, pw, pw, pw);
  const V = new Float64Array(pw * pw);
  for (let a = 0; a < pw; a++) for (let c = 0; c < pw; c++) V[a * pw + c] = (sig2 * Vs[a * pw + c]) / (wsc[a] * wsc[c]);
  const terms = [...xNames, MILLS_NAME, "Constant"].map((nm, j) => makeTerm(nm, b[j], MATH.sqrt(MATH.max(0, V[j * pw + j]))));
  // Wald χ² on the outcome predictors.
  let wald = { stat: 0, df: 0, p: 1 };
  if (kx > 0) {
    const Vx = new Float64Array(kx * kx);
    for (let a = 0; a < kx; a++) for (let c = 0; c < kx; c++) Vx[a * kx + c] = V[a * pw + c];
    const Lx = cholesky(Vx, kx);
    if (Lx) {
      const bx = b.slice(0, kx);
      const sol = cholSolve(Lx, kx, bx);
      let w = 0;
      for (let j = 0; j < kx; j++) w += bx[j] * sol[j];
      wald = { stat: w, df: kx, p: chiSquareP(w, kx) };
    }
  }
  const xl = new Set(xNames.map((x) => x.toLowerCase()));
  const excluded = zNames.filter((z) => !xl.has(z.toLowerCase()));
  const stats: ModelStat[] = [
    { label: "N", value: n, decimals: 0 },
    { label: "Selected", value: n1, decimals: 0 },
    { label: "ρ", value: rho },
    { label: "σ", value: sig },
  ];
  if (kx > 0) stats.push({ label: `Wald χ²(${kx})`, value: wald.stat }, { label: "Prob > χ²", value: wald.p });
  assertFinite([...terms, ...probit.terms], stats, "Heckman two-step");
  const lambda = terms[kx];
  let probitLl = NaN;
  for (const st of probit.stats) if (st.label === "Log likelihood") probitLl = st.value;
  return {
    model: {
      kind: "heckman",
      depName,
      n,
      terms,
      statLabel: "z",
      seLabel: "Heckman two-step (corrected)",
      stats,
      notes: [],
    },
    selection: probit.terms,
    probitLl,
    rho,
    sigma: sig,
    truncated,
    lambda,
    n,
    nSelected: n1,
    wald,
    excluded,
  };
}

// ---------------------------------------------------------------------------------------------------- ordered logit / probit

export type OrderedLink = "logit" | "probit";

export interface OrderedResult {
  model: LimdepModel;
  /** Cut points κ₁ < … < κ_{J−1} ("cut1"…), with SEs (z and p are of κ = 0, rarely of interest). */
  cuts: ModelTerm[];
  categories: number[];
  counts: number[];
  /** Average fitted probability of each category (compare with the observed shares). */
  meanProb: number[];
  ll: number;
  llNull: number;
  iterations: number;
}

interface Link {
  cdf(t: number): number;
  logCdf(t: number): number;
  pdf(t: number): number;
  /** f′(t)/f(t) (no 0/0 where f underflows). */
  dlogPdf(t: number): number;
  inv(p: number): number;
}
const LOGIT: Link = {
  cdf: (t) => (t >= 0 ? 1 / (1 + MATH.exp(-t)) : MATH.exp(t) / (1 + MATH.exp(t))),
  logCdf: (t) => (t >= 0 ? -MATH.log1p(MATH.exp(-t)) : t - MATH.log1p(MATH.exp(t))),
  pdf: (t) => {
    const e = MATH.exp(-MATH.abs(t));
    return e / ((1 + e) * (1 + e));
  },
  dlogPdf: (t) => {
    const e = MATH.exp(-MATH.abs(t));
    // 1 − 2F(t) = (1 − e^t)/(1 + e^t), written without cancellation on either side.
    return t >= 0 ? -(1 - e) / (1 + e) : (1 - e) / (1 + e);
  },
  inv: (p) => MATH.log(p / (1 - p)),
};
const PROBIT: Link = { cdf: normCdf, logCdf: normLogCdf, pdf: normPdf, dlogPdf: (t) => -t, inv: normalQuantile };

class OrderedProblem implements Problem {
  readonly p: number;
  private readonly k: number;
  constructor(
    private readonly d: Design,
    private readonly cat: Int32Array,
    private readonly J: number,
    private readonly F: Link,
  ) {
    this.k = d.p;
    this.p = d.p + J - 1;
  }
  llOnly(theta: Float64Array): number {
    return this.pass(theta, false)?.ll ?? -Infinity;
  }
  full(theta: Float64Array): Eval | null {
    return this.pass(theta, true);
  }
  linearMove(step: Float64Array): number {
    let mx = 0;
    for (let c = this.k; c < this.p; c++) mx = MATH.max(mx, MATH.abs(step[c]));
    for (let i = 0; i < this.cat.length; i++) {
      let s = 0;
      for (let j = 0; j < this.k; j++) s += this.d.Xs[i * this.k + j] * step[j];
      mx = MATH.max(mx, MATH.abs(s));
    }
    return mx;
  }
  /** P(y = c) at the parameters, for one row. */
  prob(theta: Float64Array, i: number, c: number): number {
    const eta = this.eta(theta, i);
    const { J, F, k } = this;
    const a = c < J - 1 ? theta[k + c] - eta : Infinity;
    const b = c > 0 ? theta[k + c - 1] - eta : -Infinity;
    return this.between(a, b);
  }
  private eta(theta: Float64Array, i: number): number {
    let s = 0;
    for (let j = 0; j < this.k; j++) s += this.d.Xs[i * this.k + j] * theta[j];
    return s;
  }
  /** F(a) − F(b), computed on the side of zero that does not cancel (both links are symmetric). */
  private between(a: number, b: number): number {
    const F = this.F;
    if (a === Infinity) return F.cdf(-b);
    if (b === -Infinity) return F.cdf(a);
    if (b >= 0) return F.cdf(-b) - F.cdf(-a);
    if (a <= 0) return F.cdf(a) - F.cdf(b);
    return 1 - F.cdf(-a) - F.cdf(b);
  }
  private pass(theta: Float64Array, wantA: boolean): Eval | null {
    const { k, J, F } = this;
    const P = this.p;
    for (let c = 1; c < J - 1; c++) if (!(theta[k + c] > theta[k + c - 1])) return null;
    const { Xs } = this.d;
    const g = new Float64Array(P);
    const A = wantA ? new Float64Array(P * P) : new Float64Array(0);
    let ll = 0;
    for (let i = 0; i < this.cat.length; i++) {
      const c = this.cat[i];
      const eta = this.eta(theta, i);
      const hasA = c < J - 1;
      const hasB = c > 0;
      const a = hasA ? theta[k + c] - eta : Infinity;
      const b = hasB ? theta[k + c - 1] - eta : -Infinity;
      let logP: number;
      let Pr: number;
      if (!hasA) {
        logP = F.logCdf(-b);
        Pr = MATH.exp(logP);
      } else if (!hasB) {
        logP = F.logCdf(a);
        Pr = MATH.exp(logP);
      } else {
        Pr = this.between(a, b);
        if (!(Pr > 0)) return null;
        logP = MATH.log(Pr);
      }
      if (!Number.isFinite(logP)) return null;
      ll += logP;
      // Ratios f/P: for an end category use the stable hazard form.
      const ra = hasA ? (hasB ? F.pdf(a) / Pr : F === PROBIT ? millsRatio(a) : 1 - F.cdf(a)) : 0;
      const rb = hasB ? (hasA ? F.pdf(b) / Pr : F === PROBIT ? millsRatio(-b) : F.cdf(b)) : 0;
      const da = hasA ? F.dlogPdf(a) : 0; // f′/f
      const db = hasB ? F.dlogPdf(b) : 0;
      // ∂ℓ/∂a = ra, ∂ℓ/∂b = −rb; second derivatives (f′/P = (f′/f)·(f/P)).
      const Haa = hasA ? da * ra - ra * ra : 0;
      const Hbb = hasB ? -db * rb - rb * rb : 0;
      const Hab = hasA && hasB ? ra * rb : 0;
      const o = i * k;
      const gb = -(ra - rb); // ∂ℓ/∂η
      for (let j = 0; j < k; j++) g[j] += gb * Xs[o + j];
      if (hasA) g[k + c] += ra;
      if (hasB) g[k + c - 1] -= rb;
      if (wantA) {
        const wbb = -(Haa + Hbb + 2 * Hab);
        for (let j = 0; j < k; j++) {
          const xj = Xs[o + j];
          for (let l = 0; l <= j; l++) A[j * P + l] += wbb * xj * Xs[o + l];
          if (hasA) A[(k + c) * P + j] += (Haa + Hab) * xj;
          if (hasB) A[(k + c - 1) * P + j] += (Hbb + Hab) * xj;
        }
        if (hasA) A[(k + c) * P + k + c] -= Haa;
        if (hasB) A[(k + c - 1) * P + k + c - 1] -= Hbb;
        if (hasA && hasB) A[(k + c) * P + k + c - 1] -= Hab;
      }
    }
    if (wantA) symmetrize(A, P);
    return { ll, g, A };
  }
}

/** Distinct sorted values of a categorical outcome, with counts and each row's category index. */
function categoriesOf(y: number[], maxJ: number, what: string, depName: string): { cats: number[]; counts: number[]; idx: Int32Array } {
  const set = new Map<number, number>();
  for (const v of y) set.set(v, (set.get(v) ?? 0) + 1);
  const cats = [...set.keys()].sort((a, b) => a - b);
  if (cats.length < 2) throw new LimdepRefusal("no-variation", `Every observation has ${q(depName)} = ${numText(cats[0])}, so there is nothing to explain.`);
  if (cats.length > maxJ) {
    throw new LimdepRefusal("too-many", `${what} accepts at most ${maxJ} outcome categories; ${q(depName)} has ${cats.length} distinct values. Is it really a categorical outcome? Recode it into at most ${maxJ} categories.`);
  }
  const pos = new Map(cats.map((c, i) => [c, i]));
  const idx = new Int32Array(y.length);
  for (let i = 0; i < y.length; i++) idx[i] = pos.get(y[i])!;
  return { cats, counts: cats.map((c) => set.get(c)!), idx };
}

/** Ordered logit or probit. X rows have no constant (the cut points carry the level). */
export function fitOrdered(y: number[], X: number[][], names: string[], link: OrderedLink, opts: { depName?: string; maxIter?: number } = {}): OrderedResult {
  const depName = opts.depName ?? "y";
  const maxIter = opts.maxIter ?? LIMDEP_MAX_ITER;
  const what = link === "logit" ? "Ordered logit" : "Ordered probit";
  const n = y.length;
  checkCaps(n, names.length, LIMDEP_MAX_N, LIMDEP_MAX_K, what);
  checkNumbers(y, X, names, depName);
  const k = names.length;
  if (k === 0) throw new LimdepRefusal("bad-input", `${what} needs at least one predictor (the cut points alone just reproduce the category shares).`);
  const { cats, counts, idx } = categoriesOf(y, ORDERED_MAX_J, what, depName);
  const J = cats.length;
  const P = k + J - 1;
  if (n <= P) throw new LimdepRefusal("too-few", `${plural(n, "observation")} cannot estimate ${plural(P, "parameter")} (${k} coefficients and ${J - 1} cut points).`);
  const d = buildDesign(X, names, false, true);
  const F = link === "logit" ? LOGIT : PROBIT;
  const prob = new OrderedProblem(d, idx, J, F);
  const st = new Float64Array(P);
  let cum = 0;
  for (let c = 0; c < J - 1; c++) {
    cum += counts[c];
    st[k + c] = F.inv(cum / n);
  }
  const res = newton(prob, st, maxIter, what);
  separationProbe(prob, res, (s) => prob.linearMove(s), what, "A predictor (or combination) orders the categories perfectly; remove it or merge sparse categories.");
  const Vs = invertInformation(res.at.A, P, what);
  // β = β̃/s, κ = κ̃ + Σ β̃ⱼ mⱼ/sⱼ.
  const T = new Float64Array(P * P);
  for (let j = 0; j < k; j++) T[j * P + j] = 1 / d.scale[j];
  for (let c = 0; c < J - 1; c++) {
    T[(k + c) * P + k + c] = 1;
    for (let j = 0; j < k; j++) T[(k + c) * P + j] = d.centre[j] / d.scale[j];
  }
  const V = sandwich(T, Vs, P, P);
  const est = mul(T, res.theta, P, P, 1);
  const terms = names.map((nm, j) => makeTerm(nm, est[j], MATH.sqrt(V[j * P + j])));
  const cuts = cats.slice(0, -1).map((_, c) => makeTerm(`cut${c + 1}`, est[k + c], MATH.sqrt(V[(k + c) * P + k + c])));
  const meanProb = cats.map((_, c) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += prob.prob(res.theta, i, c);
    return s / n;
  });
  const ll = res.at.ll;
  let llNull = 0;
  for (const c of counts) llNull += c * MATH.log(c / n);
  const lr = 2 * (ll - llNull);
  const stats: ModelStat[] = [
    { label: "N", value: n, decimals: 0 },
    { label: "Log likelihood", value: ll },
    { label: `LR χ²(${k})`, value: lr },
    { label: "Prob > χ²", value: chiSquareP(MATH.max(0, lr), k) },
    { label: "Pseudo R²", value: 1 - ll / llNull },
    { label: "AIC", value: -2 * ll + 2 * P },
    { label: "BIC", value: -2 * ll + MATH.log(n) * P },
  ];
  assertFinite([...terms, ...cuts], stats, what);
  return {
    model: {
      kind: link === "logit" ? "ologit" : "oprobit",
      depName,
      n,
      terms,
      statLabel: "z",
      seLabel: "Classical (inverse information)",
      stats,
      notes: [`Maximum likelihood by Newton–Raphson in (β, κ) (the log likelihood is concave; at most ${plural(maxIter, "iteration")}): converged in ${plural(res.iterations, "iteration")}.`],
    },
    cuts,
    categories: cats,
    counts,
    meanProb,
    ll,
    llNull,
    iterations: res.iterations,
  };
}

// ---------------------------------------------------------------------------------------------------- multinomial logit

export interface MnlResult {
  categories: number[];
  counts: number[];
  base: number;
  /** One equation per non-base category (sorted), terms constant last. */
  equations: { category: number; terms: ModelTerm[] }[];
  /** Relative-risk ratios exp(b) per equation. */
  rrr: { category: number; terms: ModelTerm[] }[];
  /** Terms ("2: Constant") whose exp(b) is outside the double range (left out of `rrr`). */
  rrrOmitted: string[];
  /** Average marginal effects dP(y = c)/dx for every category (sorted), predictors only. */
  ame: { category: number; terms: ModelTerm[] }[];
  ll: number;
  llNull: number;
  stats: ModelStat[];
  iterations: number;
  n: number;
}

class MnlProblem implements Problem {
  readonly p: number;
  private readonly m: number;
  constructor(
    private readonly d: Design,
    /** Each row's equation index: −1 for the base, else 0…m−1. */
    private readonly eq: Int32Array,
    m: number,
  ) {
    this.m = m;
    this.p = m * d.p;
  }
  llOnly(theta: Float64Array): number {
    return this.pass(theta, false)?.ll ?? -Infinity;
  }
  full(theta: Float64Array): Eval | null {
    return this.pass(theta, true);
  }
  linearMove(step: Float64Array): number {
    const pd = this.d.p;
    let mx = 0;
    for (let i = 0; i < this.eq.length; i++)
      for (let e = 0; e < this.m; e++) {
        let s = 0;
        for (let j = 0; j < pd; j++) s += this.d.Xs[i * pd + j] * step[e * pd + j];
        mx = MATH.max(mx, MATH.abs(s));
      }
    return mx;
  }
  private pass(theta: Float64Array, wantA: boolean): Eval | null {
    const pd = this.d.p;
    const m = this.m;
    const P = this.p;
    const { Xs } = this.d;
    const g = new Float64Array(P);
    const A = wantA ? new Float64Array(P * P) : new Float64Array(0);
    const eta = new Float64Array(m);
    const pr = new Float64Array(m);
    let ll = 0;
    for (let i = 0; i < this.eq.length; i++) {
      const o = i * pd;
      let mx = 0;
      for (let e = 0; e < m; e++) {
        let s = 0;
        for (let j = 0; j < pd; j++) s += Xs[o + j] * theta[e * pd + j];
        eta[e] = s;
        if (s > mx) mx = s;
      }
      let den = MATH.exp(-mx);
      for (let e = 0; e < m; e++) {
        pr[e] = MATH.exp(eta[e] - mx);
        den += pr[e];
      }
      for (let e = 0; e < m; e++) pr[e] /= den;
      const yi = this.eq[i];
      ll += (yi >= 0 ? eta[yi] : 0) - mx - MATH.log(den);
      for (let e = 0; e < m; e++) {
        const r = (yi === e ? 1 : 0) - pr[e];
        for (let j = 0; j < pd; j++) g[e * pd + j] += r * Xs[o + j];
      }
      if (wantA) {
        for (let e = 0; e < m; e++)
          for (let f = 0; f <= e; f++) {
            const w = pr[e] * ((e === f ? 1 : 0) - pr[f]);
            for (let j = 0; j < pd; j++) {
              const wx = w * Xs[o + j];
              const row = (e * pd + j) * P + f * pd;
              const lim = e === f ? j : pd - 1;
              for (let l = 0; l <= lim; l++) A[row + l] += wx * Xs[o + l];
            }
          }
      }
    }
    if (!Number.isFinite(ll)) return null;
    if (wantA) {
      // Within a diagonal block only l ≤ j was filled; mirror it, then the whole matrix.
      for (let e = 0; e < m; e++)
        for (let j = 0; j < pd; j++)
          for (let l = 0; l < j; l++) A[(e * pd + l) * P + e * pd + j] = A[(e * pd + j) * P + e * pd + l];
      for (let a = 0; a < P; a++) for (let b = 0; b < a; b++) A[b * P + a] = A[a * P + b];
    }
    return { ll, g, A };
  }
}

/** Multinomial logit with a constant. `base` is the base category's value (default: the lowest). */
export function fitMnl(y: number[], X: number[][], names: string[], opts: { base?: number | null; depName?: string; maxIter?: number } = {}): MnlResult {
  const depName = opts.depName ?? "y";
  const maxIter = opts.maxIter ?? LIMDEP_MAX_ITER;
  const what = "Multinomial logit";
  const n = y.length;
  checkCaps(n, names.length, MNL_MAX_N, MNL_MAX_K, what);
  checkNumbers(y, X, names, depName);
  const { cats, counts, idx } = categoriesOf(y, MNL_MAX_J, what, depName);
  const J = cats.length;
  if (J < 3) throw new LimdepRefusal("too-few", `${q(depName)} has only two categories: that is a binary outcome. Use the logit / probit calculator.`);
  const base = opts.base ?? cats[0];
  const bi = cats.indexOf(base);
  if (bi < 0) throw new LimdepRefusal("bad-input", `The base category ${numText(base)} is not a value of ${q(depName)}; its categories are ${cats.map(numText).join(", ")}.`);
  const others = cats.filter((_, c) => c !== bi);
  const m = J - 1;
  const k = names.length;
  const pd = k + 1;
  const P = m * pd;
  if (n <= P) throw new LimdepRefusal("too-few", `${plural(n, "observation")} cannot estimate ${plural(P, "parameter")} (${m} equations of ${pd}).`);
  const d = buildDesign(X, names, true, false);
  const eq = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = idx[i];
    eq[i] = c === bi ? -1 : c < bi ? c : c - 1;
  }
  const prob = new MnlProblem(d, eq, m);
  const st = new Float64Array(P);
  for (let e = 0; e < m; e++) st[e * pd] = MATH.log(counts[cats.indexOf(others[e])] / counts[bi]);
  const res = newton(prob, st, maxIter, what);
  separationProbe(prob, res, (s) => prob.linearMove(s), what, "A predictor separates one category from another; remove it or merge sparse categories.");
  const Vs = invertInformation(res.at.A, P, what);
  const Tb = designTransform(d);
  const T = new Float64Array(P * P);
  for (let e = 0; e < m; e++) for (let a = 0; a < pd; a++) for (let b = 0; b < pd; b++) T[(e * pd + a) * P + e * pd + b] = Tb[a * pd + b];
  const V = sandwich(T, Vs, P, P);
  const est = mul(T, res.theta, P, P, 1);
  const labels = d.labels;
  const equations = others.map((cat, e) => ({
    category: cat,
    terms: constantLast(labels.map((nm, j) => makeTerm(nm, est[e * pd + j], MATH.sqrt(V[(e * pd + j) * P + e * pd + j]))), true),
  }));
  const rrrSplit = equations.map((q2) => ({ category: q2.category, ...expTerms(q2.terms) }));
  const rrr = rrrSplit.map((x) => ({ category: x.category, terms: x.kept }));
  const rrrOmitted = rrrSplit.flatMap((x) => x.omitted.map((nm) => `${numText(x.category)}: ${nm}`));

  // Average marginal effects (statsmodels get_margeff at="overall", dydx), analytic Jacobian, in original units.
  // Parameters est: equation e, index 0 = constant, j + 1 = predictor j.
  const ame = new Float64Array(J * k);
  const Jac = new Float64Array(J * k * P);
  const pr = new Float64Array(J); // by category index (sorted); base gets index bi
  const bbar = new Float64Array(k);
  const beta = (c: number, j: number): number => (c === bi ? 0 : est[(c < bi ? c : c - 1) * pd + j + 1]);
  const btab = new Float64Array(J * k);
  for (let c = 0; c < J; c++) for (let j = 0; j < k; j++) btab[c * k + j] = beta(c, j);
  const xr = new Float64Array(pd);
  for (let i = 0; i < n; i++) {
    let mx = 0;
    const etas = new Float64Array(J);
    for (let c = 0; c < J; c++) {
      if (c === bi) continue;
      const e = c < bi ? c : c - 1;
      let s = est[e * pd];
      for (let j = 0; j < k; j++) s += X[i][j] * est[e * pd + j + 1];
      etas[c] = s;
      if (s > mx) mx = s;
    }
    let den = 0;
    for (let c = 0; c < J; c++) {
      pr[c] = MATH.exp(etas[c] - mx);
      den += pr[c];
    }
    for (let c = 0; c < J; c++) pr[c] /= den;
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let c = 0; c < J; c++) s += pr[c] * beta(c, j);
      bbar[j] = s;
    }
    xr[0] = 1;
    for (let j = 0; j < k; j++) xr[j + 1] = X[i][j];
    for (let c = 0; c < J; c++)
      for (let j = 0; j < k; j++) {
        const dev = btab[c * k + j] - bbar[j];
        const pc = pr[c];
        ame[c * k + j] += pc * dev;
        const row = (c * k + j) * P;
        for (let e = 0; e < m; e++) {
          const mc = e < bi ? e : e + 1; // category index of equation e
          const pm = pr[mc];
          const dcm = c === mc ? 1 : 0;
          const devm = btab[mc * k + j] - bbar[j];
          // ∂[P_c(β_cj − β̄_j)]/∂β_{e,l} = x_l·P_c[(δ_ce − P_e)(β_cj − β̄_j) − P_e(β_ej − β̄_j)] + [l = j]·P_c(δ_ce − P_e).
          const w = pc * ((dcm - pm) * dev - pm * devm);
          const o = row + e * pd;
          for (let l = 0; l < pd; l++) Jac[o + l] += w * xr[l];
          Jac[o + j + 1] += pc * (dcm - pm);
        }
      }
  }
  for (let a = 0; a < J * k; a++) ame[a] /= n;
  for (let a = 0; a < J * k * P; a++) Jac[a] /= n;
  const Vame = sandwich(Jac, V, J * k, P);
  const ameOut = cats.map((cat, c) => ({
    category: cat,
    terms: names.map((nm, j) => makeTerm(nm, ame[c * k + j], MATH.sqrt(MATH.max(0, Vame[(c * k + j) * J * k + c * k + j])))),
  }));
  const ll = res.at.ll;
  let llNull = 0;
  for (const c of counts) llNull += c * MATH.log(c / n);
  const lr = 2 * (ll - llNull);
  const df = m * k;
  const stats: ModelStat[] = [{ label: "N", value: n, decimals: 0 }, { label: "Log likelihood", value: ll }];
  if (df > 0) stats.push({ label: `LR χ²(${df})`, value: lr }, { label: "Prob > χ²", value: chiSquareP(MATH.max(0, lr), df) });
  stats.push({ label: "Pseudo R²", value: 1 - ll / llNull }, { label: "AIC", value: -2 * ll + 2 * P }, { label: "BIC", value: -2 * ll + MATH.log(n) * P });
  assertFinite([...equations.flatMap((e) => e.terms), ...rrr.flatMap((e) => e.terms), ...ameOut.flatMap((e) => e.terms)], stats, what);
  return { categories: cats, counts, base, equations, rrr, rrrOmitted, ame: ameOut, ll, llNull, stats, iterations: res.iterations, n };
}
