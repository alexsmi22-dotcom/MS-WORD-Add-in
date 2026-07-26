// Multiple, polynomial and weighted least squares — and the diagnostics that
// tell you whether to believe the fit.
//
// WHY THIS EXISTS
// Regression stopped at one predictor. Anyone with two — dose AND time, or
// concentration AND temperature — had no route at all, and `linalg.ts` had QR
// but no least-squares built on it, so they could not assemble one either.
//
// The diagnostics matter as much as the coefficients. R² always rises when a
// predictor is added, even a column of noise, so a model can look better while
// being worse; adjusted R² is reported beside it for exactly that reason. And a
// residual plot shows curvature that no summary number reveals — a quadratic
// relationship fitted with a straight line can post a respectable R² while
// being systematically wrong at both ends.
//
// Solved by QR rather than the normal equations (XᵀX)⁻¹Xᵀy: forming XᵀX squares
// the condition number, and a polynomial design matrix is exactly where that
// bites — a cubic fit on x in the hundreds is already badly conditioned.

import { qrDecompose, transpose, multiply, type Matrix } from "./linalg";
import { tTestP, fTestP, mean } from "./stats";

export interface RegressionCoefficient {
  /** "Intercept", a predictor name, or "x^2" for a polynomial term. */
  name: string;
  estimate: number;
  standardError: number;
  t: number;
  p: number;
}

export interface MultipleRegressionResult {
  ok: boolean;
  reason?: string;
  coefficients: RegressionCoefficient[];
  /** Fitted values, in input order. */
  fitted: number[];
  residuals: number[];
  /** Residuals divided by the residual standard error. */
  standardizedResiduals: number[];
  rSquared: number;
  adjustedRSquared: number;
  /** Residual standard error (sigma-hat). */
  residualStandardError: number;
  /** Overall F test that all slopes are zero. */
  f: number;
  dfModel: number;
  dfResidual: number;
  pOverall: number;
  n: number;
  caveats: string[];
}

/** Back-substitution for an upper-triangular system Rb = z. */
function backSolve(R: Matrix, z: number[], n: number): number[] | null {
  const b = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i];
    for (let j = i + 1; j < n; j++) sum -= R[i][j] * b[j];
    if (Math.abs(R[i][i]) < 1e-12) return null; // rank-deficient
    b[i] = sum / R[i][i];
  }
  return b;
}

/**
 * Ordinary least squares on a design matrix that already contains its intercept
 * column.
 *
 * Returns null when the design is rank-deficient — two identical predictors, or
 * more parameters than observations. Returning a "solution" there would be
 * fitting noise and reporting it as signal.
 */
export function leastSquares(X: Matrix, y: number[]): { beta: number[]; xtxInv: Matrix } | null {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (!n || !p || n < p) return null;

  const { Q, R } = qrDecompose(X);
  // z = Qᵀy, using only the first p columns of Q.
  const z = new Array<number>(p).fill(0);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Q[i][j] * y[i];
    z[j] = s;
  }
  const beta = backSolve(R, z, p);
  if (!beta) return null;

  // (XᵀX)⁻¹ = R⁻¹R⁻ᵀ, needed for the standard errors. R is small (p×p).
  const Rinv: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let col = 0; col < p; col++) {
    const e = new Array<number>(p).fill(0);
    e[col] = 1;
    const c = backSolve(R, e, p);
    if (!c) return null;
    for (let i = 0; i < p; i++) Rinv[i][col] = c[i];
  }
  const xtxInv = multiply(Rinv, transpose(Rinv));
  if (!xtxInv) return null;
  return { beta, xtxInv };
}

/**
 * Multiple linear regression of `y` on one or more predictors.
 *
 * `predictors` is column-wise: predictors[j] is the j-th variable, each the same
 * length as y.
 */
export function multipleRegression(
  y: number[],
  predictors: number[][],
  names?: string[],
): MultipleRegressionResult {
  const empty: MultipleRegressionResult = {
    ok: false,
    coefficients: [],
    fitted: [],
    residuals: [],
    standardizedResiduals: [],
    rSquared: NaN,
    adjustedRSquared: NaN,
    residualStandardError: NaN,
    f: NaN,
    dfModel: NaN,
    dfResidual: NaN,
    pOverall: NaN,
    n: y.length,
    caveats: [],
  };

  const n = y.length;
  const k = predictors.length;
  if (n < 3) return { ...empty, reason: "Regression needs at least three observations." };
  if (!k) return { ...empty, reason: "Enter at least one predictor." };
  if (predictors.some((c) => c.length !== n)) {
    return { ...empty, reason: "Every predictor must have the same number of values as the response." };
  }
  const p = k + 1; // + intercept
  if (n <= p) {
    return {
      ...empty,
      reason:
        `With ${n} observations and ${k} predictor${k === 1 ? "" : "s"} there are no degrees of freedom ` +
        "left to estimate the error. A model with as many parameters as data points fits perfectly and " +
        "means nothing.",
    };
  }

  const X: Matrix = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < k; j++) row.push(predictors[j][i]);
    X.push(row);
  }

  const ls = leastSquares(X, y);
  if (!ls) {
    return {
      ...empty,
      reason:
        "The predictors are collinear (one is an exact combination of the others, or is constant), " +
        "so the coefficients are not uniquely determined. Remove the duplicated predictor.",
    };
  }

  const { beta, xtxInv } = ls;
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  const residuals = y.map((v, i) => v - fitted[i]);

  const ybar = mean(y);
  let ssTotal = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTotal += (y[i] - ybar) * (y[i] - ybar);
    ssRes += residuals[i] * residuals[i];
  }
  const dfResidual = n - p;
  const dfModel = k;
  const mse = ssRes / dfResidual;
  const rse = Math.sqrt(mse);

  const rSquared = ssTotal > 0 ? 1 - ssRes / ssTotal : NaN;
  // Adjusted R² penalises parameters; plain R² can only ever rise when one is
  // added, which is why both are reported.
  const adjustedRSquared = ssTotal > 0 ? 1 - (1 - rSquared) * ((n - 1) / dfResidual) : NaN;

  const labels = ["Intercept", ...(names ?? predictors.map((_, j) => `x${j + 1}`))];
  const coefficients: RegressionCoefficient[] = beta.map((b, j) => {
    const se = Math.sqrt(Math.max(0, mse * xtxInv[j][j]));
    const t = se > 0 ? b / se : NaN;
    return {
      name: labels[j] ?? `b${j}`,
      estimate: b,
      standardError: se,
      t,
      p: Number.isFinite(t) ? tTestP(Math.abs(t), dfResidual) : NaN,
    };
  });

  const ssModel = ssTotal - ssRes;
  const f = dfModel > 0 && mse > 0 ? ssModel / dfModel / mse : NaN;
  const pOverall = Number.isFinite(f) ? fTestP(f, dfModel, dfResidual) : NaN;

  const caveats = [
    "R² always rises when a predictor is added — even a column of random numbers. Compare models " +
      "on ADJUSTED R², which charges for each parameter.",
    "A p-value here tests one coefficient with the others held fixed. Correlated predictors can " +
      "both look non-significant while together explaining the response.",
    "Check the residual plot before believing any of this: a curved pattern means the model shape " +
      "is wrong, and no summary statistic will tell you.",
  ];
  if (k > 1) {
    caveats.push(
      "This is a fit, not a causal claim. Adding predictors that correlate with each other changes " +
        "every coefficient in the model.",
    );
  }

  return {
    ok: true,
    coefficients,
    fitted,
    residuals,
    standardizedResiduals: residuals.map((r) => (rse > 0 ? r / rse : NaN)),
    rSquared,
    adjustedRSquared,
    residualStandardError: rse,
    f,
    dfModel,
    dfResidual,
    pOverall,
    n,
    caveats,
  };
}

/**
 * Polynomial regression of degree `degree`.
 *
 * x is CENTRED before the powers are formed. Without it, a cubic on x around
 * 1000 produces a design matrix with columns spanning 10⁰ to 10⁹, and the fit
 * degrades into numerical noise; the coefficients are reported on the centred
 * scale and the centre is stated so the model can be used.
 */
export function polynomialRegression(
  x: number[],
  y: number[],
  degree: number,
): MultipleRegressionResult & { centre: number; degree: number } {
  const deg = Math.max(1, Math.min(6, Math.floor(degree)));
  const centre = x.length ? mean(x) : 0;
  const cols: number[][] = [];
  const names: string[] = [];
  for (let d = 1; d <= deg; d++) {
    cols.push(x.map((v) => Math.pow(v - centre, d)));
    names.push(d === 1 ? "(x − x̄)" : `(x − x̄)^${d}`);
  }
  const res = multipleRegression(y, cols, names);
  if (res.ok) {
    res.caveats.unshift(
      `x was centred on x̄ = ${centre} before taking powers, so the coefficients apply to ` +
        "(x − x̄). Uncentred powers of a large x are numerically unstable.",
    );
    res.caveats.push(
      "A higher degree always fits the sample better and usually predicts worse. Degree 6 is the " +
        "maximum offered, and even that is rarely justified by data.",
    );
  }
  return { ...res, centre, degree: deg };
}

/**
 * Inverse standard normal CDF (probit), Acklam's rational approximation with one
 * Halley refinement — accurate to about 1e-15.
 *
 * Needed for the Q-Q plot: the theoretical quantile of each order statistic.
 */
export function probit(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let q: number;
  let r: number;
  let x: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

export interface QQPoint {
  /** Theoretical normal quantile. */
  theoretical: number;
  /** Observed standardized residual. */
  sample: number;
}

/**
 * Points for a normal Q-Q plot of the residuals.
 *
 * Uses the Blom plotting position (i − 3/8)/(n + 1/4), which is the standard
 * choice for normal probability plots; the naive i/n puts the largest point at
 * probability 1, whose quantile is infinite.
 */
export function qqPoints(residuals: number[]): QQPoint[] {
  const n = residuals.length;
  if (n < 2) return [];
  const sorted = [...residuals].sort((a, b) => a - b);
  return sorted.map((v, i) => ({
    theoretical: probit((i + 1 - 0.375) / (n + 0.25)),
    sample: v,
  }));
}
