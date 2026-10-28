// Linear-algebra core — the numerical spine for JurisLab's analytical workbench.
//
// Everything here is pure, dependency-free, and computed from the user's own
// numbers (no invented data). Algorithms are the standard textbook ones chosen
// for numerical stability at the small-to-medium sizes a document author works
// with: Gaussian elimination with partial pivoting for solve/determinant,
// Gauss-Jordan for the inverse, and the cyclic Jacobi rotation method for the
// eigenvalues of a symmetric matrix. Parsing and formatting are separated from
// the math so both can be unit-tested in isolation.

import { MINUS, timesTen, trueMinus, fmtSig } from "./axis";

export type Matrix = number[][];

/** A parsed matrix, or a human-readable reason the text wasn't a valid matrix. */
export type MatrixParse = { ok: true; matrix: Matrix } | { ok: false; error: string };



/**
 * THE SINGULARITY TEST IS RELATIVE (fix2-paf). A pivot was "zero" below an
 * absolute 1e-12, so a perfectly conditioned matrix scaled by 10⁻¹⁵
 * ([[2, 1], [1, 3]]·10⁻¹⁵, condition number 2.6) was refused as singular. A
 * pivot is now zero below max(m, n)·16·ε·(largest |entry| of ITS OWN original
 * row) — rounding level for that row's scale, so an exactly singular matrix's
 * cancelled pivot is caught, a uniformly scaled matrix is not, and neither is a
 * badly row-scaled but exactly invertible one (diag(10¹⁵, 1)). The per-row
 * tolerances travel with their rows through the pivoting swaps.
 */
export function pivotTolerance(m: Matrix): number[] {
  const k = Math.max(rows(m), cols(m)) * 16 * 2.220446049250313e-16;
  return m.map((r) => k * r.reduce((s, v) => Math.max(s, Math.abs(v)), 0));
}

/**
 * The condition-number report for a square matrix result: always the number,
 * and above 10¹² a warning that about log₁₀(κ) of the ~16 digits are lost
 * (Hilbert-10: κ ≈ 1.6×10¹³).
 */
export function conditionLines(m: Matrix): string[] {
  const k = conditionNumber(m);
  if (!Number.isFinite(k)) return [];
  const lines = [`Condition number κ₂ = ${fmtSig(k, 4)}`];
  if (k > 1e12) {
    lines.push(
      `Warning: κ₂ is above 10¹², so about ${Math.round(Math.log10(k))} of the ~16 significant digits can be lost to rounding; ` +
        "the trailing digits of this result are not reliable.",
    );
  }
  return lines;
}

/** 2-norm condition number σ₁/σₙ of a square matrix (Infinity when singular). */
export function conditionNumber(m: Matrix): number {
  if (!isSquare(m) || !m.length) return NaN;
  const s = svd(m).S;
  const lo = s[s.length - 1];
  return lo > 0 ? s[0] / lo : Infinity;
}

/**
 * Parses a matrix from text. Rows are separated by newlines or `;`, and the
 * entries within a row by commas or whitespace. Every row must have the same
 * length. A single row (or a column of one-entry rows) is a valid vector.
 */
export function parseMatrix(text: string): MatrixParse {
  const rowTexts = text
    .split(/[\n;]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (!rowTexts.length) return { ok: false, error: "Enter a matrix (one row per line)." };

  const matrix: Matrix = [];
  for (const rt of rowTexts) {
    const cells = rt.split(/[,\s]+/).filter((c) => c.length > 0);
    const row: number[] = [];
    for (const c of cells) {
      // A true minus (U+2212) or en dash as the sign reads as minus (fix2-paf:
      // "−1", as the product itself prints it, was refused as not a number).
      const t = c.replace(/^[−–]/, "-").replace(/(?<=[eE])[−–]/, "-");
      // Number() reads "0x10" as 16: a hex literal is not a matrix entry anyone typed on purpose.
      const v = /^[-+]?0[xXbBoO]/.test(t) ? NaN : Number(t);
      if (!Number.isFinite(v)) return { ok: false, error: `"${c}" is not a number.` };
      row.push(v);
    }
    if (!row.length) return { ok: false, error: "A row has no numbers." };
    matrix.push(row);
  }
  const cols = matrix[0].length;
  if (matrix.some((r) => r.length !== cols))
    return { ok: false, error: "Every row must have the same number of columns." };
  return { ok: true, matrix };
}

export function rows(m: Matrix): number {
  return m.length;
}
export function cols(m: Matrix): number {
  return m.length ? m[0].length : 0;
}
export function isSquare(m: Matrix): boolean {
  return rows(m) > 0 && rows(m) === cols(m);
}

/** Deep copy so in-place elimination never mutates the caller's matrix. */
function clone(m: Matrix): Matrix {
  return m.map((r) => r.slice());
}

/** Formats a matrix as aligned text (fixed significant figures per entry). */
export function formatMatrix(m: Matrix, sig = 4): string {
  const strs = formatMatrixCells(m, sig);
  let width = 0;
  for (const r of strs) for (const s of r) width = Math.max(width, s.length);
  return strs.map((r) => r.map((s) => s.padStart(width)).join("  ")).join("\n");
}

/** Rounds to `sig` significant figures and trims trailing zeros; -0 → 0. */
export function formatNum(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const rounded = Number(x.toPrecision(sig));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  // The display contract (v2.193.0): a true minus and ×10ⁿ, never "-5.551e-17" — String() writes e-notation below
  // 10⁻⁶ and from 10²¹. The digits are String()'s (shortest, trailing zeros dropped), as they always were. "—" stays
  // the non-finite sentinel the insert gate refuses (insertGate.ts).
  const m = /^(-?)(\d+(?:\.\d+)?)e([+-]\d+)$/.exec(String(normalized));
  if (m) return `${m[1] ? MINUS : ""}${m[2]}${timesTen(Number(m[3]))}`;
  return trueMinus(String(normalized));
}

/**
 * A matrix's entries for display, each through formatNum (true minus, ×10ⁿ). NO snapping to 0: a scale-relative
 * threshold turned honest entries of badly scaled matrices into confident zeros (inverse of diag(10¹⁵, 1) showed 0
 * for 10⁻¹⁵; [[2×10¹¹, 0.001], [0.001, 1]] lost its 0.001s). Round-off residue left visible is merely untidy; a
 * wrong 0 is a wrong answer. Non-finite entries stay "—" so the insert gate still refuses the result.
 */
export function formatMatrixCells(m: number[][], sig = 6): string[][] {
  return m.map((row) => row.map((v) => formatNum(v, sig)));
}

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

export function transpose(m: Matrix): Matrix {
  const r = rows(m);
  const c = cols(m);
  return Array.from({ length: c }, (_, j) => Array.from({ length: r }, (_, i) => m[i][j]));
}

export function trace(m: Matrix): number {
  let t = 0;
  for (let i = 0; i < Math.min(rows(m), cols(m)); i++) t += m[i][i];
  return t;
}

/** Matrix product A·B, or null when the inner dimensions don't match. */
export function multiply(a: Matrix, b: Matrix): Matrix | null {
  if (cols(a) !== rows(b)) return null;
  const n = rows(a);
  const m = cols(b);
  const k = cols(a);
  const out: Matrix = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}

/**
 * Determinant via LU decomposition with partial pivoting. Null for a
 * non-square matrix. Exactly 0 (not a rounding artifact) is returned when a
 * pivot collapses, so callers can report singularity.
 */
export function determinant(m: Matrix): number | null {
  if (!isSquare(m)) return null;
  const n = rows(m);
  const a = clone(m);
  const tol = pivotTolerance(m);
  let det = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) <= tol[pivot]) return 0;
    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      [tol[pivot], tol[col]] = [tol[col], tol[pivot]];
      det = -det;
    }
    det *= a[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c < n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return det;
}

/** Inverse by Gauss-Jordan elimination; null if non-square or singular. */
export function inverse(m: Matrix): Matrix | null {
  if (!isSquare(m)) return null;
  const n = rows(m);
  const a = clone(m);
  const inv = identity(n);
  const tol = pivotTolerance(m);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) <= tol[pivot]) return null;
    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      [tol[pivot], tol[col]] = [tol[col], tol[pivot]];
      [inv[pivot], inv[col]] = [inv[col], inv[pivot]];
    }
    const p = a[col][col];
    for (let c = 0; c < n; c++) {
      a[col][c] /= p;
      inv[col][c] /= p;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < n; c++) {
        a[r][c] -= factor * a[col][c];
        inv[r][c] -= factor * inv[col][c];
      }
    }
  }
  return inv;
}

/**
 * Solves the linear system A·x = b by Gaussian elimination with partial
 * pivoting. `b` may be given as a column ([[b1],[b2]]) or a single row
 * ([[b1,b2]]); the result is a column vector. Null if A is non-square,
 * dimensions disagree, or A is singular.
 */
export function solve(A: Matrix, b: Matrix): Matrix | null {
  if (!isSquare(A)) return null;
  const n = rows(A);
  const rhs = cols(b) === 1 ? b.map((r) => r[0]) : rows(b) === 1 ? b[0].slice() : null;
  if (!rhs || rhs.length !== n) return null;
  const a = clone(A);
  const x = rhs.slice();
  const tol = pivotTolerance(A);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) <= tol[pivot]) return null;
    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      [tol[pivot], tol[col]] = [tol[col], tol[pivot]];
      [x[pivot], x[col]] = [x[col], x[pivot]];
    }
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c < n; c++) a[r][c] -= factor * a[col][c];
      x[r] -= factor * x[col];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= a[i][j] * out[j];
    out[i] = s / a[i][i];
  }
  return out.map((v) => [v]);
}

/** Matrix rank via row reduction with a relative tolerance. */
export function rank(m: Matrix): number {
  const a = clone(m);
  // Relative to the matrix's own scale (was an absolute 1e-9, so any matrix of
  // entries below 10⁻⁹ had rank 0), the same rule as the singularity test.
  const rankTol = pivotTolerance(m);
  const nr = rows(a);
  const nc = cols(a);
  let r = 0;
  for (let col = 0; col < nc && r < nr; col++) {
    let pivot = r;
    for (let i = r + 1; i < nr; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    if (Math.abs(a[pivot][col]) <= rankTol[pivot]) continue;
    [a[pivot], a[r]] = [a[r], a[pivot]];
    [rankTol[pivot], rankTol[r]] = [rankTol[r], rankTol[pivot]];
    for (let i = 0; i < nr; i++) {
      if (i === r) continue;
      const factor = a[i][col] / a[r][col];
      for (let c = col; c < nc; c++) a[i][c] -= factor * a[r][c];
    }
    r++;
  }
  return r;
}

export interface Eigen {
  values: number[];
  /** Eigenvectors as columns, aligned to `values`. */
  vectors: Matrix;
}

export function isSymmetric(m: Matrix, tol = 1e-9): boolean {
  if (!isSquare(m)) return false;
  const n = rows(m);

  // RELATIVE TO THE MATRIX, NOT TO EACH ENTRY PLUS ONE.
  //
  // The test was `|a_ij - a_ji| > tol * (1 + |a_ij|)`. That `1 +` is an absolute
  // floor, and it made the answer depend on the units the matrix happened to be
  // written in — wrong in BOTH directions:
  //
  //   [[1e-20, 1e-20], [2e-20, 1e-20]]      -> reported SYMMETRIC
  //        Its off-diagonals differ by 100%. Every entry is below the floor, so
  //        every difference passed. This one matters: eigenSymmetric is handed
  //        matrices on this basis, and the Jacobi method it uses is only valid for
  //        a symmetric matrix.
  //
  //   [[1e20, 1], [1.0000001, 1e20]]        -> reported NOT symmetric
  //        Its off-diagonals differ by 1e-7 against a matrix norm of 1e20 — that is
  //        symmetric to fourteen orders of magnitude better than double precision
  //        can even represent the diagonal.
  //
  // Scaling by the largest magnitude in the matrix asks the question that actually
  // matters — is this difference significant AT THIS MATRIX'S SCALE — and is
  // invariant under multiplying the whole matrix by a constant, which cannot change
  // whether it is symmetric.
  let scale = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Math.abs(m[i][j]);
      if (Number.isFinite(v) && v > scale) scale = v;
    }
  }
  // An all-zero matrix is symmetric, and there is nothing to scale against.
  if (scale === 0) return true;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.abs(m[i][j] - m[j][i]);
      if (!Number.isFinite(d)) return false;
      if (d > tol * scale) return false;
    }
  }
  return true;
}

/**
 * Eigenvalues and eigenvectors of a SYMMETRIC matrix by the cyclic Jacobi
 * rotation method (always real, always convergent for symmetric input).
 * Returns null for a non-symmetric matrix — not because that case is out of
 * scope (it is not: `eigenvaluesGeneral` below solves it by Francis double-shift
 * QR and ships as the "eigen-general" tool), but because THIS routine's
 * guarantees only hold for symmetric input. Jacobi rotation returns real
 * eigenvalues and orthogonal eigenvectors; handing it a non-symmetric matrix
 * would silently forfeit both. Refusing sends the caller to the right engine.
 * Values are returned in descending order with their eigenvectors as the
 * columns of `vectors`.
 */
export function eigenSymmetric(m: Matrix): Eigen | null {
  if (!isSymmetric(m)) return null;
  const n = rows(m);
  const a = clone(m);
  const v = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < n; i++) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = c * api - s * aqi;
          a[q][i] = s * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = c * vip - s * viq;
          v[i][q] = s * vip + c * viq;
        }
      }
    }
  }
  const pairs = Array.from({ length: n }, (_, i) => ({ value: a[i][i], vec: v.map((r) => r[i]) }));
  pairs.sort((x, y) => y.value - x.value);
  return {
    values: pairs.map((p) => p.value),
    vectors: Array.from({ length: n }, (_, i) => pairs.map((p) => p.vec[i])),
  };
}

// --- QR decomposition (Householder) -----------------------------------------

export interface QRDecomposition {
  /** Orthogonal factor (Qᵀ·Q = I). */
  Q: Matrix;
  /** Upper-triangular factor, so Q·R = A. */
  R: Matrix;
}

/** QR factorization by Householder reflections. Works for any m×n (m ≥ n typical). */
export function qrDecompose(A: Matrix): QRDecomposition {
  const m = rows(A);
  const n = cols(A);
  const R = clone(A);
  const Q = identity(m);
  const kmax = Math.min(m - 1, n);
  for (let k = 0; k < kmax; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += R[i][k] * R[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) continue;
    const alpha = R[k][k] > 0 ? -norm : norm;
    const v = new Array(m).fill(0);
    v[k] = R[k][k] - alpha;
    for (let i = k + 1; i < m; i++) v[i] = R[i][k];
    let vv = 0;
    for (let i = k; i < m; i++) vv += v[i] * v[i];
    if (vv < 1e-300) continue;
    for (let j = 0; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i] * R[i][j];
      const f = (2 * dot) / vv;
      for (let i = k; i < m; i++) R[i][j] -= f * v[i];
    }
    for (let i = 0; i < m; i++) {
      let dot = 0;
      for (let t = k; t < m; t++) dot += Q[i][t] * v[t];
      const f = (2 * dot) / vv;
      for (let t = k; t < m; t++) Q[i][t] -= f * v[t];
    }
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < Math.min(i, n); j++) R[i][j] = 0;
  return { Q, R };
}

/**
 * THIN Householder QR for least squares: the same reflections as qrDecompose, applied to `y` as they are formed
 * instead of being accumulated into an m×m Q. Returns the top n×n block of R and the first n entries of Qᵀy, which
 * is all a least-squares solve needs (R·b = Qᵀy).
 *
 * WHY. qrDecompose builds identity(m): at 4,000 rows that is 16 million doubles (about 700 MB in arrays of arrays)
 * and an O(m²n) update, so multiple and polynomial regression took 2 s at 4,000 rows and 8 s and 2.6 GB at 8,000
 * (bug test 2026-10-28, R4 #2). This is O(mn²) time and O(mn) memory. qrDecompose keeps its contract (the Matrix
 * QR calculator shows Q).
 */
export function householderLeastSquaresParts(A: Matrix, y: number[]): { R: Matrix; qty: number[] } {
  const m = rows(A);
  const n = cols(A);
  const R = clone(A);
  const z = y.slice();
  const kmax = Math.min(m - 1, n);
  const v = new Array<number>(m).fill(0);
  for (let k = 0; k < kmax; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += R[i][k] * R[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) continue;
    const alpha = R[k][k] > 0 ? -norm : norm;
    v[k] = R[k][k] - alpha;
    for (let i = k + 1; i < m; i++) v[i] = R[i][k];
    let vv = 0;
    for (let i = k; i < m; i++) vv += v[i] * v[i];
    if (vv < 1e-300) continue;
    for (let j = 0; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i] * R[i][j];
      const f = (2 * dot) / vv;
      for (let i = k; i < m; i++) R[i][j] -= f * v[i];
    }
    let dot = 0;
    for (let i = k; i < m; i++) dot += v[i] * z[i];
    const f = (2 * dot) / vv;
    for (let i = k; i < m; i++) z[i] -= f * v[i];
  }
  const top: Matrix = [];
  for (let i = 0; i < Math.min(m, n); i++) {
    const row = R[i].slice(0, n);
    for (let j = 0; j < i; j++) row[j] = 0;
    top.push(row);
  }
  return { R: top, qty: z.slice(0, n) };
}

// --- Singular value decomposition (one-sided Jacobi) ------------------------

export interface SVDResult {
  /** Left singular vectors as columns. */
  U: Matrix;
  /** Singular values, descending, ≥ 0. */
  S: number[];
  /** Right singular vectors as columns, so A = U·diag(S)·Vᵀ. */
  V: Matrix;
}

/**
 * Singular value decomposition by the one-sided Jacobi method — numerically
 * robust for the small-to-medium matrices a document author works with, and it
 * needs no eigen-solver. Returns the economy form (k = min(m, n) columns).
 */
export function svd(A: Matrix): SVDResult {
  const transposed = rows(A) < cols(A);
  const M = transposed ? transpose(A) : clone(A);
  const m = rows(M);
  const n = cols(M); // m ≥ n
  const U = M;
  const V = identity(n);
  for (let sweep = 0; sweep < 60; sweep++) {
    let changed = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let k = 0; k < m; k++) {
          alpha += U[k][i] * U[k][i];
          beta += U[k][j] * U[k][j];
          gamma += U[k][i] * U[k][j];
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || alpha === 0 || beta === 0) continue;
        changed = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let k = 0; k < m; k++) {
          const uki = U[k][i];
          const ukj = U[k][j];
          U[k][i] = c * uki - s * ukj;
          U[k][j] = s * uki + c * ukj;
        }
        for (let k = 0; k < n; k++) {
          const vki = V[k][i];
          const vkj = V[k][j];
          V[k][i] = c * vki - s * vkj;
          V[k][j] = s * vki + c * vkj;
        }
      }
    }
    if (!changed) break;
  }
  const sv = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let norm = 0;
    for (let k = 0; k < m; k++) norm += U[k][j] * U[k][j];
    sv[j] = Math.sqrt(norm);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a2, b2) => sv[b2] - sv[a2]);
  // A singular value at rounding level (≤ max(m, n)·ε·σ₁) is zero: the matrix is
  // rank-deficient and that column of U carries no information.
  const zeroTol = Math.max(m, n) * 2.220446049250313e-16 * (sv[order[0]] || 0);
  const isZero = (i: number): boolean => !(sv[i] > zeroTol) || !(sv[i] > 1e-300);
  const S = order.map((i) => (isZero(i) ? 0 : sv[i]));
  const Uout = Array.from({ length: m }, (_, r) => order.map((i) => (isZero(i) ? 0 : U[r][i] / sv[i])));
  // RANK-DEFICIENT U IS COMPLETED TO AN ORTHONORMAL BASIS (fix2-paf). The
  // columns for zero singular values were left as zero vectors, so for
  // [[1, 1], [1, 1]] U = [[0.707, 0], [0.707, 0]] — not orthogonal, and
  // UᵀU ≠ I. Gram–Schmidt (twice, for stability) against the columns already
  // set, trying the standard basis vectors in turn.
  for (let c = 0; c < n; c++) {
    if (!isZero(order[c])) continue;
    let best: number[] | null = null;
    let bestNorm = 0;
    for (let e = 0; e < m; e++) {
      const v: number[] = Array.from({ length: m }, (_, r) => (r === e ? 1 : 0));
      for (let pass = 0; pass < 2; pass++) {
        for (let o = 0; o < n; o++) {
          if (o === c) continue;
          let dot = 0;
          for (let r = 0; r < m; r++) dot += Uout[r][o] * v[r];
          for (let r = 0; r < m; r++) v[r] -= dot * Uout[r][o];
        }
      }
      const norm = Math.sqrt(v.reduce((s2, x) => s2 + x * x, 0));
      if (norm > bestNorm) {
        bestNorm = norm;
        best = v;
      }
    }
    if (best && bestNorm > 1e-8) for (let r = 0; r < m; r++) Uout[r][c] = best[r] / bestNorm;
  }
  const Vout = Array.from({ length: n }, (_, r) => order.map((i) => V[r][i]));
  return transposed ? { U: Vout, S, V: Uout } : { U: Uout, S, V: Vout };
}

// --- General (non-symmetric) eigenvalues ------------------------------------

export interface Complex {
  re: number;
  im: number;
}

/** Reduces a square matrix to upper-Hessenberg form by Householder similarity. */
function hessenberg(A: Matrix): Matrix {
  const n = rows(A);
  const H = clone(A);
  for (let k = 1; k < n - 1; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += H[i][k - 1] * H[i][k - 1];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) continue;
    const alpha = H[k][k - 1] > 0 ? -norm : norm;
    const v = new Array(n).fill(0);
    v[k] = H[k][k - 1] - alpha;
    for (let i = k + 1; i < n; i++) v[i] = H[i][k - 1];
    let vv = 0;
    for (let i = k; i < n; i++) vv += v[i] * v[i];
    if (vv < 1e-300) continue;
    for (let j = 0; j < n; j++) {
      let dot = 0;
      for (let i = k; i < n; i++) dot += v[i] * H[i][j];
      const f = (2 * dot) / vv;
      for (let i = k; i < n; i++) H[i][j] -= f * v[i];
    }
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = k; j < n; j++) dot += H[i][j] * v[j];
      const f = (2 * dot) / vv;
      for (let j = k; j < n; j++) H[i][j] -= f * v[j];
    }
  }
  return H;
}

/**
 * Eigenvalues of a general real square matrix by the Francis double-shift QR
 * algorithm on the upper-Hessenberg form (the classic EISPACK/`hqr` method).
 * Handles complex-conjugate pairs, returned with non-zero imaginary parts.
 * Null for a non-square matrix; throws only if iteration fails to converge.
 */
export function eigenvaluesGeneral(A: Matrix): Complex[] | null {
  if (!isSquare(A)) return null;
  const n = rows(A);
  if (n === 0) return [];

  // SCALE THE MATRIX BEFORE ITERATING, AND SCALE THE ANSWER BACK.
  //
  // The QR sweep forms products of matrix entries directly — `w = a[nn][nn-1] *
  // a[nn-1][nn]` and `q = p*p + w` — which overflow once entries pass ~1.3e154.
  // The overflow does not fail loudly: it becomes NaN, the iteration then never
  // converges, and the function throws "Eigenvalue iteration did not converge"
  // sixty sweeps later. A matrix of 1e160 entries has eigenvalues near 1e160,
  // which a double holds perfectly well, and it could not be solved at all.
  //
  // Eigenvalues are homogeneous — eig(cA) = c·eig(A) — so normalising the matrix
  // and multiplying the results back is exact in principle. The factor is a
  // POWER OF TWO so it is also exact in floating point: scaling by 2^k changes
  // only the exponent and cannot perturb a single mantissa bit.
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Math.abs(A[i][j]);
      if (Number.isFinite(v) && v > maxAbs) maxAbs = v;
    }
  }
  let scale = 1;
  if (maxAbs > 0 && (maxAbs > 1e100 || maxAbs < 1e-100)) {
    // 2^-round(log2(maxAbs)) brings the largest entry to about 1.
    scale = Math.pow(2, -Math.round(Math.log2(maxAbs)));
    if (!Number.isFinite(scale) || scale === 0) scale = 1;
  }
  const scaled = scale === 1 ? A : A.map((row) => row.map((v) => v * scale));

  // BALANCE (Parlett–Reinsch, as LAPACK's geev does by default): a diagonal similarity
  // D⁻¹AD by powers of two, so it is exact in floating point and leaves the eigenvalues
  // unchanged. Without it a badly scaled matrix (entries from 10⁻²¹ to 10¹¹, the step
  // matrix of a stiff order-12 plant) came back with spectral radius 8.59 where the true
  // value is 0.98507: the QR iteration's backward error is relative to the matrix NORM,
  // which the unbalanced entries inflate by many orders of magnitude.
  const src = scaled.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let c = 0;
      let r = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        c += Math.abs(src[j][i]);
        r += Math.abs(src[i][j]);
      }
      if (c === 0 || r === 0 || !Number.isFinite(c) || !Number.isFinite(r)) continue;
      const s0 = c + r;
      let f = 1;
      let cc = c;
      let rr = r;
      for (let k = 0; k < 2100 && cc < rr / 2; k++) {
        cc *= 2;
        rr /= 2;
        f *= 2;
      }
      for (let k = 0; k < 2100 && cc >= rr * 2; k++) {
        cc /= 2;
        rr *= 2;
        f /= 2;
      }
      if (cc + rr < 0.95 * s0 && Number.isFinite(f) && f > 0) {
        changed = true;
        for (let j = 0; j < n; j++) src[i][j] /= f;
        for (let j = 0; j < n; j++) src[j][i] *= f;
      }
    }
    if (!changed) break;
  }

  const a = hessenberg(src);
  const wr = new Array(n).fill(0);
  const wi = new Array(n).fill(0);
  let anorm = 0;
  for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
  let nn = n - 1;
  let t = 0;
  let z = 0;
  let s = 0;
  let r = 0;
  let q = 0;
  let p = 0;
  let x = 0;
  let y = 0;
  let w = 0;
  while (nn >= 0) {
    let its = 0;
    let l = nn;
    do {
      for (l = nn; l >= 1; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) <= 1e-15 * s) {
          a[l][l - 1] = 0;
          break;
        }
      }
      x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn] = 0;
        nn--;
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = x + z;
            if (z !== 0) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn] = z;
            wi[nn - 1] = -z;
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error("Eigenvalue iteration did not converge.");
          if (its === 10 || its === 20) {
            t += x;
            for (let i = 0; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          its++;
          let m = nn - 2;
          for (; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const vv2 = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u <= 1e-15 * vv2) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              x = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (x !== 0) {
                p /= x;
                q /= x;
                r /= x;
              }
            }
            // Math.hypot, not sqrt of a sum of squares: squaring first overflows
            // once any of p, q, r passes ~1.3e154, and the resulting NaN does not
            // fail loudly — the iteration simply never converges and throws
            // "Eigenvalue iteration did not converge" 60 sweeps later. A matrix of
            // 1e160 entries has eigenvalues near 1e160, which a double represents
            // perfectly well, and it could not be solved at all.
            s = Math.hypot(p, q, r);
            if (p < 0) s = -s;
            if (s !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else {
                a[k][k - 1] = -s * x;
              }
              p += s;
              x = p / s;
              y = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) {
                  p += r * a[k + 2][j];
                  a[k + 2][j] -= p * z;
                }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) {
                  p += z * a[i][k + 2];
                  a[i][k + 2] -= p * r;
                }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  // Undo the normalisation. Dividing by an exact power of two is exact.
  return wr.map((re, i) => ({ re: re / scale, im: wi[i] / scale }));
}

/** Formats a complex eigenvalue as "a", "bi", or "a + bi" with sig figs. */
export function formatComplex(c: Complex, sig = 4): string {
  const reZero = Math.abs(c.re) < 1e-12;
  const imZero = Math.abs(c.im) < 1e-12;
  if (imZero) return formatNum(c.re, sig);
  const imAbs = formatNum(Math.abs(c.im), sig);
  const imPart = `${imAbs === "1" ? "" : imAbs}i`;
  // True minus throughout (v2.193.0), as formatNum now writes the real part.
  if (reZero) return `${c.im < 0 ? MINUS : ""}${imPart}`;
  return `${formatNum(c.re, sig)} ${c.im < 0 ? MINUS : "+"} ${imPart}`;
}
