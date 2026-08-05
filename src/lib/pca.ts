// Principal component analysis, and trapezoidal integration of measured data.
//
// Both are thin layers over engines this product already ships and tests — the
// one-sided Jacobi SVD in linalg.ts, and the trapezoid rule that existed only
// inside the pharmacokinetics module as a private AUC helper. Neither needed
// new numerics; both were unreachable for anyone who did not happen to be
// fitting a drug curve.
//
// PCA IS BUILT ON THE SVD OF THE CENTRED DATA, NOT ON AN EIGEN-DECOMPOSITION OF
// THE COVARIANCE MATRIX. Forming XᵀX squares the condition number, which is the
// same trap the regression module avoids by using QR — on data with columns of
// very different scale it destroys the small components, which are exactly the
// ones a reader is looking at the scree plot to judge.

import { svd, Matrix } from "./linalg";
// Math.min(...xs)/Math.max(...xs) throw RangeError past ~125,000 arguments, and a
// 200,000-point measured trace is an ordinary paste into this integrator, not a
// pathological one. See minmax.ts: the failure is a CLIFF, not a curve.
import { minOf, maxOf } from "./minmax";

export interface PcaResult {
  ok: true;
  /** Number of observations and original variables. */
  n: number;
  p: number;
  /** Column means removed before decomposition. */
  means: number[];
  /** Column scale divisors — all 1 when not standardised. */
  scales: number[];
  standardised: boolean;
  /** Variance explained by each component. */
  variance: number[];
  /** Fraction of total variance per component. */
  explained: number[];
  /** Running total of `explained`. */
  cumulative: number[];
  /** Loadings: variables (rows) by components (columns). */
  loadings: Matrix;
  /** Scores: observations (rows) by components (columns). */
  scores: Matrix;
  /** Components needed to reach 95% of the variance. */
  componentsFor95: number;
  notes: string[];
}

export interface PcaError {
  ok: false;
  error: string;
}

/**
 * Principal components of a data matrix (rows = observations).
 *
 * STANDARDISING IS A REAL DECISION, NOT A DEFAULT. On raw covariance, a
 * variable measured in millimetres dominates the same quantity in metres purely
 * through its units, and the first component becomes "whichever column has the
 * largest numbers". On the correlation matrix (standardise = true) every
 * variable contributes equally, which is right for mixed units and wrong when
 * the relative magnitudes are themselves meaningful. The result says which was
 * used rather than leaving the reader to guess.
 */
export function pca(data: Matrix, standardise = true): PcaResult | PcaError {
  if (!Array.isArray(data) || data.length < 2) {
    return { ok: false, error: "PCA needs at least two rows of observations." };
  }
  const p = data[0]?.length ?? 0;
  if (p < 2) return { ok: false, error: "PCA needs at least two variables (columns)." };
  if (data.some((r) => r.length !== p)) {
    return { ok: false, error: "Every row must have the same number of columns." };
  }
  if (data.some((r) => r.some((x) => !Number.isFinite(x)))) {
    return { ok: false, error: "Every value must be a finite number — blanks and text cannot be decomposed." };
  }
  const n = data.length;
  if (n > 5000 || p > 200) {
    return { ok: false, error: "That matrix is larger than this pane can decompose (5000 rows / 200 columns)." };
  }

  const means = Array.from({ length: p }, (_, j) => data.reduce((s, r) => s + r[j], 0) / n);
  // Sample standard deviation (n-1), matching the rest of the stats surface.
  const sds = Array.from({ length: p }, (_, j) => {
    const v = data.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / (n - 1);
    return Math.sqrt(v);
  });

  const constant = sds.map((s, j) => ({ s, j })).filter((x) => x.s <= 0);
  if (standardise && constant.length) {
    return {
      ok: false,
      error:
        `Column${constant.length > 1 ? "s" : ""} ${constant.map((c) => c.j + 1).join(", ")} ` +
        "never vary, so standardising would divide by zero. Remove the constant column, or run " +
        "on covariance instead — a variable with no variance carries no information either way.",
    };
  }

  const scales = standardise ? sds : sds.map(() => 1);
  const X: Matrix = data.map((r) => r.map((x, j) => (x - means[j]) / scales[j]));

  const { S, V } = svd(X);
  // Variance along component k is s_k²/(n-1) — the SVD of the centred matrix
  // gives the covariance eigenvalues directly, without ever forming XᵀX.
  const variance = S.map((s) => (s * s) / (n - 1));
  const total = variance.reduce((a, b) => a + b, 0);
  if (!(total > 0)) {
    return { ok: false, error: "The data have no variance at all — every row is identical." };
  }
  const explained = variance.map((v) => v / total);
  const cumulative: number[] = [];
  explained.reduce((acc, e) => {
    const t = acc + e;
    cumulative.push(t);
    return t;
  }, 0);

  // Scores = X·V. Computed directly rather than from U·diag(S) so the result is
  // right even where the economy SVD trims columns.
  const k = S.length;
  const scores: Matrix = X.map((row) =>
    Array.from({ length: k }, (_, c) => row.reduce((s, x, j) => s + x * V[j][c], 0)),
  );

  const componentsFor95 = Math.max(1, cumulative.findIndex((c) => c >= 0.95) + 1 || k);

  const notes: string[] = [
    standardise
      ? "Standardised (correlation basis): every variable contributes equally, which is the right " +
        "choice for mixed units. On raw covariance a variable in millimetres would dominate the " +
        "same quantity in metres purely through its units."
      : "Covariance basis: variables keep their original scales, so a column with larger numbers " +
        "carries more weight. Correct when the relative magnitudes are meaningful, misleading when " +
        "the units are arbitrary.",
    "A component's SIGN is arbitrary — flipping a loading column and its score column together " +
      "describes the same data. Compare magnitudes and patterns, never signs between runs.",
    "PCA finds directions of maximum VARIANCE, which is not the same as directions that matter. " +
      "A component explaining 2% can still be the one that separates your groups.",
  ];
  if (n < p) {
    notes.push(
      `There are fewer observations (${n}) than variables (${p}), so at most ${n - 1} components ` +
        "carry any information and the rest are exactly zero by construction.",
    );
  }
  if (n < 3 * p) {
    notes.push(
      "Fewer than about three observations per variable makes the loadings unstable — they will " +
        "move noticeably if you add a few more rows.",
    );
  }

  return {
    ok: true,
    n,
    p,
    means,
    scales,
    standardised: standardise,
    variance,
    explained,
    cumulative,
    loadings: V,
    scores,
    componentsFor95,
    notes,
  };
}

export interface TrapzResult {
  ok: true;
  /** The integral over the whole range. */
  area: number;
  /** Running integral at each x. */
  cumulative: number[];
  /** Mean value of y over the range (area / span). */
  meanValue: number;
  xStart: number;
  xEnd: number;
  notes: string[];
}

/**
 * Trapezoidal integration of MEASURED data — the numbers you have, not a
 * function you can evaluate anywhere.
 *
 * This is the counterpart to the Solve tool's adaptive Simpson, which needs an
 * expression. The trapezoid rule was already written inside the
 * pharmacokinetics module for AUC and could not be reached by anyone
 * integrating a chromatogram, a power trace or a stress-strain curve.
 *
 * X NEED NOT BE EVENLY SPACED, and it is not required to be increasing: a
 * decreasing sweep integrates to the negative of the same area, which is the
 * mathematically correct answer and worth reporting rather than silently
 * flipping. Duplicated x values contribute zero width rather than an error.
 */
export function trapz(xs: number[], ys: number[]): TrapzResult | PcaError {
  if (xs.length !== ys.length) return { ok: false, error: "x and y must have the same number of values." };
  if (xs.length < 2) return { ok: false, error: "Integration needs at least two points." };
  if ([...xs, ...ys].some((v) => !Number.isFinite(v))) {
    return { ok: false, error: "Every x and y must be a finite number." };
  }

  const cumulative: number[] = [0];
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    area += ((xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1])) / 2;
    cumulative.push(area);
  }
  const span = xs[xs.length - 1] - xs[0];

  const notes: string[] = [
    "The trapezoid rule assumes the signal is STRAIGHT between your samples. It is exact for a " +
      "straight line, and it under-estimates a curve that is concave down while over-estimating " +
      "one that is concave up — sample more finely where the curvature is.",
  ];
  const decreasing = xs.every((x, i) => i === 0 || x <= xs[i - 1]);
  if (decreasing) {
    notes.push(
      "x decreases across the data, so the area comes out NEGATIVE. That is the correct signed " +
        "integral; reverse the order if you wanted the unsigned area.",
    );
  } else if (!xs.every((x, i) => i === 0 || x >= xs[i - 1])) {
    notes.push(
      "x is not monotonic — it goes both up and down. The signed area still computes, but unless " +
        "this is a genuine hysteresis loop the points are probably out of order.",
    );
  }
  const gaps = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
  const maxGap = maxOf(gaps);
  const minGap = minOf(
    gaps.filter((g) => g > 0),
    maxGap,
  );
  if (maxGap > 5 * minGap) {
    notes.push(
      "The spacing is very uneven (widest gap is more than five times the narrowest), so most of " +
        "the error lives in the sparse stretch.",
    );
  }

  return {
    ok: true,
    area,
    cumulative,
    meanValue: span !== 0 ? area / span : 0,
    xStart: xs[0],
    xEnd: xs[xs.length - 1],
    notes,
  };
}
