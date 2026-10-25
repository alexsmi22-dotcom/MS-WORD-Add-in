/**
 * Input–output analysis (Release E5a, calculator io-leontief): the Leontief inverse L = (I − A)⁻¹, output for a final
 * demand, output and employment multipliers, Rasmussen backward / forward linkages, Ghosh forward linkages, key
 * sectors.
 *
 * Exact path: n ≤ IO_EXACT_MAX with every input a finite decimal, Gauss–Jordan in exact fractions (cas.ts Rat). Float
 * path otherwise: Gauss–Jordan with partial pivoting and a 1-norm condition number. n is capped at IO_MAX_N.
 *
 * Productivity: for A ≥ 0, A is productive iff its spectral radius ρ(A) < 1 iff I − A is nonsingular with
 * (I − A)⁻¹ ≥ 0 (Hawkins–Simon; Miller & Blair 2009, Input–Output Analysis, 2nd ed., §2.3 and Appendix 2.1). The test
 * used is that sign test on the inverse (exact on the exact path); a singular I − A means 1 is an eigenvalue of A, so
 * ρ(A) ≥ 1. Column sums ≥ 1 do NOT make A non-productive (all column sums < 1 is only sufficient).
 * ρ(A) itself is printed from a Collatz–Wielandt bracket on A + I (the Perron root of A + I is ρ(A) + 1).
 */
import { ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratSign, ratToNumber, RAT_ZERO, RAT_ONE, type Rat } from "./cas";

export const IO_MAX_N = 60;
export const IO_EXACT_MAX = 8;
/** Largest numerator or denominator (in digits) of an entry of A taken down the exact path. */
export const IO_EXACT_DIGITS = 40;
export const IO_WALL_MS = 6000;
/** Collatz–Wielandt iterations at most. */
export const IO_RHO_MAX_ITER = 20000;

export type Mat = number[][];

/** Exact inverse of M by Gauss–Jordan; null when singular, "time" past the deadline (checked once per row step). */
export function ratInverse(M: Rat[][], deadline = Infinity): Rat[][] | null | "time" {
  const n = M.length;
  const a = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? RAT_ONE : RAT_ZERO))]);
  for (let c = 0; c < n; c++) {
    if (Date.now() > deadline) return "time";
    let p = -1;
    for (let r = c; r < n; r++) if (!ratIsZero(a[r][c])) { p = r; break; }
    if (p < 0) return null;
    if (p !== c) [a[p], a[c]] = [a[c], a[p]];
    const piv = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] = ratDiv(a[c][j], piv);
    for (let r = 0; r < n; r++) {
      if (r === c || ratIsZero(a[r][c])) continue;
      const fct = a[r][c];
      for (let j = 0; j < 2 * n; j++) if (!ratIsZero(a[c][j])) a[r][j] = ratSub(a[r][j], ratMul(fct, a[c][j]));
    }
  }
  return a.map((r) => r.slice(n));
}

/** Float inverse by Gauss–Jordan with partial pivoting; null when a pivot falls below tol·‖M‖∞. */
export function floatInverse(M: Mat, deadline: number): Mat | null | "time" {
  const n = M.length;
  let norm = 0;
  for (const r of M) {
    let s = 0;
    for (const v of r) s += Math.abs(v);
    if (s > norm) norm = s;
  }
  const tol = 1e-13 * Math.max(norm, 1e-300);
  const a = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    if (Date.now() > deadline) return "time";
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) <= tol) return null;
    if (p !== c) [a[p], a[c]] = [a[c], a[p]];
    const piv = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c || a[r][c] === 0) continue;
      const fct = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= fct * a[c][j];
    }
  }
  return a.map((r) => r.slice(n));
}

export function norm1(M: Mat): number {
  let best = 0;
  for (let j = 0; j < M.length; j++) {
    let s = 0;
    for (let i = 0; i < M.length; i++) s += Math.abs(M[i][j]);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Bracket on the spectral radius of a non-negative matrix A: Collatz–Wielandt min/max ratios of (A + I)x/x along the
 * power iteration from x = 1, minus 1. Returns the bracket reached (lo ≤ ρ ≤ hi) and whether it closed to `rtol`.
 */
export function spectralRadiusBracket(A: Mat, deadline: number, rtol = 1e-10): { lo: number; hi: number; converged: boolean } {
  const n = A.length;
  let x = new Array<number>(n).fill(1);
  let lo = 0;
  let hi = Infinity;
  for (let it = 0; it < IO_RHO_MAX_ITER; it++) {
    if ((it & 63) === 0 && Date.now() > deadline) break;
    const y = new Array<number>(n);
    let mn = Infinity;
    let mx = 0;
    let big = 0;
    for (let i = 0; i < n; i++) {
      let s = x[i];
      for (let j = 0; j < n; j++) s += A[i][j] * x[j];
      y[i] = s;
      const r = s / x[i];
      if (r < mn) mn = r;
      if (r > mx) mx = r;
      if (s > big) big = s;
    }
    if (mn - 1 > lo) lo = mn - 1;
    if (mx - 1 < hi) hi = mx - 1;
    if (hi - lo <= rtol * Math.max(1, hi)) return { lo: Math.max(0, lo), hi, converged: true };
    // Keep x strictly positive and of unit scale; components that underflow are floored (a reducible A).
    for (let i = 0; i < n; i++) x[i] = Math.max(y[i] / big, 1e-300);
    x = x.slice();
  }
  return { lo: Math.max(0, lo), hi, converged: false };
}

export interface IoInput {
  names: string[];
  /** Technical coefficients (floats) and, when every entry was exact, the same as fractions. */
  A: Mat;
  Aexact?: Rat[][];
  /** Ghosh needs Z and x: allocation coefficients B = diag(x)⁻¹Z. */
  Z?: Mat;
  Zexact?: Rat[][];
  x?: number[];
  xExact?: Rat[];
}

export type IoInverse =
  | { ok: true; L: Mat; exact: boolean; Lexact?: Rat[][]; cond?: number; exactTimedOut?: boolean }
  | { ok: false; reason: string };

function identityMinus(A: Mat): Mat {
  return A.map((r, i) => r.map((v, j) => (i === j ? 1 - v : -v)));
}

/**
 * (I − M)⁻¹ with the productivity / singularity refusals. `label` names the matrix in messages ("A", "B").
 */
export function leontiefInverse(M: Mat, Mexact: Rat[][] | undefined, label: string, deadline: number): IoInverse {
  const n = M.length;
  let exactTimedOut = false;
  // Digit budget: an entry like 1.23456789012345×10⁻²⁹⁵ is a 310-digit fraction, and Gauss–Jordan multiplies such
  // sizes together (measured: 4.8 s for 8 × 8). Above IO_EXACT_DIGITS digits the float path answers instead.
  const tooLong = !!Mexact && Mexact.some((r) => r.some((v) => v.d.toString().length > IO_EXACT_DIGITS || (v.n < 0n ? -v.n : v.n).toString().length > IO_EXACT_DIGITS));
  if (tooLong) exactTimedOut = true;
  if (Mexact && n <= IO_EXACT_MAX && !tooLong) {
    const IM = Mexact.map((r, i) => r.map((v, j) => (i === j ? ratSub(RAT_ONE, v) : ratNeg(v))));
    // Exact work gets at most half the budget; past it the float path below answers (and says so).
    const inv = ratInverse(IM, Date.now() + Math.max(0, (deadline - Date.now()) / 2));
    if (inv === "time") exactTimedOut = true;
    else {
      if (!inv) return { ok: false, reason: singular(label) };
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (ratSign(inv[i][j]) < 0) return { ok: false, reason: nonProductive(label) };
      return { ok: true, exact: true, Lexact: inv, L: inv.map((r) => r.map((v) => ratToNumber(v))) };
    }
  }
  const IM = identityMinus(M);
  const inv = floatInverse(IM, deadline);
  if (inv === "time") return { ok: false, reason: `The inverse of I − ${label} took longer than ${IO_WALL_MS / 1000} s and was stopped.` };
  if (!inv) return { ok: false, reason: singular(label) };
  let big = 0;
  for (const r of inv) for (const v of r) if (Math.abs(v) > big) big = Math.abs(v);
  // Rounding leaves true zeros of a reducible A as ±1e−17·‖L‖: only a clearly negative entry means ρ > 1.
  const tol = 1e-9 * Math.max(1, big);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (!Number.isFinite(inv[i][j])) return { ok: false, reason: singular(label) };
    if (inv[i][j] < -tol) return { ok: false, reason: nonProductive(label) };
    if (inv[i][j] < 0) inv[i][j] = 0;
  }
  return { ok: true, exact: false, L: inv, cond: norm1(IM) * norm1(inv), exactTimedOut };
}

function singular(label: string): string {
  return (
    `I − ${label} is singular: 1 is an eigenvalue of ${label}, so its spectral radius is at least 1 and ${label} is not ` +
    "productive (no non-negative output meets every final demand). Check the coefficients."
  );
}
function nonProductive(label: string): string {
  return (
    `${label} is not productive: (I − ${label})⁻¹ has a negative entry, which for a non-negative ${label} happens exactly ` +
    `when its spectral radius exceeds 1 (Hawkins–Simon fails). Some sector needs more than one unit of inputs, ` +
    "directly and indirectly, per unit of its own output."
  );
}

export function matVec(M: Mat, v: number[]): number[] {
  return M.map((r) => r.reduce((s, a, j) => s + a * v[j], 0));
}
export function ratMatVec(M: Rat[][], v: Rat[]): Rat[] {
  return M.map((r) => r.reduce((s: Rat, a, j) => ratAdd(s, ratMul(a, v[j])), RAT_ZERO));
}
export function colSums(M: Mat): number[] {
  return M[0].map((_, j) => M.reduce((s, r) => s + r[j], 0));
}
export function rowSums(M: Mat): number[] {
  return M.map((r) => r.reduce((s, v) => s + v, 0));
}

/** Rasmussen indices: n·sumⱼ / Σ all (column sums for backward, row sums for forward). */
export function rasmussen(sums: number[]): number[] {
  const n = sums.length;
  const total = sums.reduce((s, v) => s + v, 0);
  return sums.map((v) => (n * v) / total);
}
