// THE SHARED QUANTUM CORE (Release Q, 2026-10). Q2 (gates, circuits, protocols) is built on it; Q1 (Dirac notation and
// linear algebra), Q3 (density matrices) and Q4 (linear optics) reuse it, so the app never gives two answers to one
// question about a state.
//
// API — everything is plain double-precision complex arithmetic on plain arrays; nothing here is stateful.
//
//   Complex numbers (the `Cx` type of quantum.ts, re-exported):
//     cx(re, im?) · C0 · C1 · CI · cAdd · cSub · cMul · cDiv · cNeg · cConj · cScale(z, k) · cAbs · cAbs2 · cArg
//     cExpI(θ) = e^{iθ} · cNear(a, b, tol?)
//   Matrices (CMat = Cx[][], square, row-major):
//     identity(d) · matMul(a, b) · matDagger(a) · matScale(a, z) · kron(a, b) · matVec(a, v) · matNear(a, b, tol?)
//     isUnitary(a, tol?) · matMulChain([G1, G2, …]) = G1·G2·…  (left to right as written)
//   Gates (2×2 unless stated; the angle is in radians):
//     GATES.I X Y Z H S Sdg T Tdg SX (√X) · rx(θ) · ry(θ) · rz(θ) · phaseGate(φ) · u3(θ, φ, λ) (Qiskit's U)
//     SWAP4 · ISWAP4 (4×4, first qubit = high bit of the 4×4 index)
//   States (State = Cx[], length 2ⁿ, BIG-ENDIAN: qubit 0 is the MOST significant bit of the index, so |q0 q1 … q(n−1)⟩;
//   bitOf(index, q, n) = (index >> (n − 1 − q)) & 1):
//     MAX_QUBITS (10) · ZERO_TOL (10⁻¹²) · basisState(n, index) · stateNorm2 · normalise(state) · ketLabel(index, n)
//     applyGate(state, n, U, targets, controls?)  — U is 2ᵏ×2ᵏ on `targets` (targets[0] = high bit of U's index), applied
//       only where every control qubit is 1; O(2ⁿ·4ᵏ) by index loops, never a 2ⁿ×2ⁿ matrix
//     probabilities(state) · marginal(state, n, qubits) (big-endian over `qubits` as listed)
//     measureQubit(state, n, q, outcome) → { prob, post } (post renormalised; null when prob = 0)
//     reducedDensity(state, n, keep) → CMat over the kept qubits (big-endian in `keep` order) · purity(rho)
//     blochVector([a, b]) → [x, y, z] · stateFromBloch(θ, φ) · rotationOf(U2) → global phase, angle, axis
//   Parsing (one reader for coefficients and angles: solve.ts parseExpr + complexAlgebra.ts evalComplex):
//     parseComplex(text) · parseAngle(text) (degrees by default; radians when written with π/pi or "rad")
//     parseKet(text) — a sum of coefficient·|label⟩ terms, labels 0/1 strings, +, −, i, −i, Φ⁺ Φ⁻ Ψ⁺ Ψ⁻ (quantum.ts's
//       BELL_STATES); normalises with a note
//   Exact display (scope "Arithmetic": recognised closed forms to 10⁻¹², otherwise 6 significant figures):
//     recogniseReal(x) → ExactForm | null (a·√b/d, b ∈ {1, 2, 3, 6}, d a power of two ≤ 1024, a ≤ 64, or ≤ 4d when b = 1)
//     fmtReal(x) / fmtCx(z) → { text, math } (math = the pane's equation syntax) · phaseForm(θ) · fmtAngle(rad)
//     fmtState(state, n, opts?) → { text, math, globalPhase, terms, shown } — factors a common modulus 1/√k
//       ("(|00⟩ + |11⟩)/√2") and, only when it makes every coefficient real or imaginary, a global phase (stated)
//
// Every function refuses (returns null / an { error }) rather than computing on a non-finite input or past MAX_QUBITS.

import { BELL_STATES, cx, type Cx } from "./quantum";
import { parseExpr } from "./solve";
import { evalComplex } from "./complexAlgebra";
import { fmtSig } from "./axis";

export { cx };
export type { Cx };

// ---------------------------------------------------------------------------------------------------------------
// Complex numbers
// ---------------------------------------------------------------------------------------------------------------

export const C0: Cx = { re: 0, im: 0 };
export const C1: Cx = { re: 1, im: 0 };
export const CI: Cx = { re: 0, im: 1 };
export const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const cMul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cNeg = (a: Cx): Cx => ({ re: -a.re, im: -a.im });
export const cConj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
export const cScale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export const cAbs2 = (a: Cx): number => a.re * a.re + a.im * a.im;
export const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);
export const cArg = (a: Cx): number => Math.atan2(a.im, a.re);
export const cExpI = (t: number): Cx => ({ re: Math.cos(t), im: Math.sin(t) });
export function cDiv(a: Cx, b: Cx): Cx {
  const d = cAbs2(b);
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export const cNear = (a: Cx, b: Cx, tol = 1e-9): boolean => Math.abs(a.re - b.re) <= tol && Math.abs(a.im - b.im) <= tol;
const finiteCx = (z: Cx): boolean => Number.isFinite(z.re) && Number.isFinite(z.im);

// ---------------------------------------------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------------------------------------------

export type CMat = Cx[][];
export type State = Cx[];

export const identity = (d: number): CMat =>
  Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? C1 : C0)));

export function matMul(a: CMat, b: CMat): CMat {
  const n = a.length, m = b[0].length, k = b.length;
  const out: CMat = [];
  for (let i = 0; i < n; i++) {
    const row: Cx[] = [];
    for (let j = 0; j < m; j++) {
      let re = 0, im = 0;
      for (let t = 0; t < k; t++) {
        const x = a[i][t], y = b[t][j];
        re += x.re * y.re - x.im * y.im;
        im += x.re * y.im + x.im * y.re;
      }
      row.push({ re, im });
    }
    out.push(row);
  }
  return out;
}

/** G1·G2·…·Gk, as written (so a time-ordered sequence g1 then g2 is matMulChain([g2, g1])). */
export const matMulChain = (ms: CMat[]): CMat => ms.slice(1).reduce((acc, m) => matMul(acc, m), ms[0]);

export const matDagger = (a: CMat): CMat => a[0].map((_, j) => a.map((row) => cConj(row[j])));
export const matScale = (a: CMat, z: Cx): CMat => a.map((row) => row.map((v) => cMul(v, z)));
export const matVec = (a: CMat, v: Cx[]): Cx[] =>
  a.map((row) => row.reduce((s, x, j) => cAdd(s, cMul(x, v[j])), C0));

export function kron(a: CMat, b: CMat): CMat {
  const out: CMat = [];
  for (let i = 0; i < a.length; i++)
    for (let k = 0; k < b.length; k++) {
      const row: Cx[] = [];
      for (let j = 0; j < a[0].length; j++) for (let l = 0; l < b[0].length; l++) row.push(cMul(a[i][j], b[k][l]));
      out.push(row);
    }
  return out;
}

export const matNear = (a: CMat, b: CMat, tol = 1e-9): boolean =>
  a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((v, j) => cNear(v, b[i][j], tol)));

export const isUnitary = (a: CMat, tol = 1e-9): boolean => matNear(matMul(matDagger(a), a), identity(a.length), tol);

// ---------------------------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------------------------

const R = Math.SQRT1_2;
const m2 = (a: Cx, b: Cx, c: Cx, d: Cx): CMat => [[a, b], [c, d]];

export const GATES = {
  I: m2(C1, C0, C0, C1),
  X: m2(C0, C1, C1, C0),
  Y: m2(C0, cx(0, -1), CI, C0),
  Z: m2(C1, C0, C0, cx(-1)),
  H: m2(cx(R), cx(R), cx(R), cx(-R)),
  S: m2(C1, C0, C0, CI),
  Sdg: m2(C1, C0, C0, cx(0, -1)),
  T: m2(C1, C0, C0, cx(R, R)),
  Tdg: m2(C1, C0, C0, cx(R, -R)),
  /** √X = ½[[1+i, 1−i], [1−i, 1+i]] (Qiskit's SX). */
  SX: m2(cx(0.5, 0.5), cx(0.5, -0.5), cx(0.5, -0.5), cx(0.5, 0.5)),
} as const;

/** Rx(θ) = exp(−iθX/2). */
export const rx = (t: number): CMat => m2(cx(Math.cos(t / 2)), cx(0, -Math.sin(t / 2)), cx(0, -Math.sin(t / 2)), cx(Math.cos(t / 2)));
/** Ry(θ) = exp(−iθY/2). */
export const ry = (t: number): CMat => m2(cx(Math.cos(t / 2)), cx(-Math.sin(t / 2)), cx(Math.sin(t / 2)), cx(Math.cos(t / 2)));
/** Rz(θ) = exp(−iθZ/2) = diag(e^{−iθ/2}, e^{iθ/2}) — NOT the phase gate P(θ), which differs by the global phase e^{iθ/2}. */
export const rz = (t: number): CMat => m2(cExpI(-t / 2), C0, C0, cExpI(t / 2));
/** P(φ) = diag(1, e^{iφ}). */
export const phaseGate = (p: number): CMat => m2(C1, C0, C0, cExpI(p));
/** Qiskit's U(θ, φ, λ) = [[cos(θ/2), −e^{iλ} sin(θ/2)], [e^{iφ} sin(θ/2), e^{i(φ+λ)} cos(θ/2)]]. */
export const u3 = (t: number, p: number, l: number): CMat =>
  m2(cx(Math.cos(t / 2)), cScale(cExpI(l), -Math.sin(t / 2)), cScale(cExpI(p), Math.sin(t / 2)), cScale(cExpI(p + l), Math.cos(t / 2)));

const P4 = (perm: number[], ph: Cx[] = [C1, C1, C1, C1]): CMat =>
  Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => (perm[j] === i ? ph[j] : C0)));
/** SWAP on two qubits (4×4). */
export const SWAP4: CMat = P4([0, 2, 1, 3]);
/** iSWAP: |01⟩ → i|10⟩, |10⟩ → i|01⟩. */
export const ISWAP4: CMat = P4([0, 2, 1, 3], [C1, CI, CI, C1]);

// ---------------------------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------------------------

export const MAX_QUBITS = 10;
/** An amplitude (or a probability) below this is zero for display and for decisions. */
export const ZERO_TOL = 1e-12;

export const bitOf = (index: number, q: number, n: number): number => (index >> (n - 1 - q)) & 1;
export const ketLabel = (index: number, n: number): string => index.toString(2).padStart(n, "0");

export function basisState(n: number, index: number): State {
  const s: State = Array.from({ length: 1 << n }, () => C0);
  s[index] = C1;
  return s;
}

export const stateNorm2 = (s: State): number => s.reduce((t, z) => t + cAbs2(z), 0);

/** The state divided by its norm; null for a zero or non-finite vector. */
export function normalise(s: State): { state: State; norm2: number; norm: number } | null {
  if (!s.every(finiteCx)) return null;
  // Scaled by the largest modulus first, so 10⁻²⁰⁰|0⟩ + 10⁻²⁰⁰|1⟩ neither underflows to zero nor 10²⁰⁰ overflows.
  const big = Math.max(...s.map(cAbs));
  if (!(big > 0) || !Number.isFinite(big)) return null;
  const t = s.map((z) => cScale(z, 1 / big));
  const n2t = stateNorm2(t);
  const k = 1 / Math.sqrt(n2t);
  // norm2 itself can under- or overflow (10⁻²⁰⁰ amplitudes give 2×10⁻⁴⁰⁰ = 0 in a double); `norm` = √n2t·big cannot
  // while the amplitudes are finite, and is what a caller should print or divide by.
  return { state: t.map((z) => cScale(z, k)), norm2: n2t * big * big, norm: Math.sqrt(n2t) * big };
}

/**
 * Applies a 2ᵏ×2ᵏ unitary on `targets` (targets[0] is the high bit of U's index), where every control qubit is 1.
 * Returns a NEW state. Throws on an index out of range or a repeated qubit (callers check first and word a refusal).
 */
export function applyGate(state: State, n: number, U: CMat, targets: number[], controls: number[] = []): State {
  const k = targets.length;
  const all = [...targets, ...controls];
  if (U.length !== 1 << k || all.some((q) => !Number.isInteger(q) || q < 0 || q >= n) || new Set(all).size !== all.length)
    throw new Error("applyGate: bad qubit list");
  const tMask = targets.map((q) => 1 << (n - 1 - q));
  const cMask = controls.reduce((m, q) => m | (1 << (n - 1 - q)), 0);
  const anyT = tMask.reduce((m, b) => m | b, 0);
  const out = state.slice();
  const dim = 1 << k;
  const idx = new Array<number>(dim);
  const amp = new Array<Cx>(dim);
  for (let base = 0; base < state.length; base++) {
    if (base & anyT || (base & cMask) !== cMask) continue;
    for (let j = 0; j < dim; j++) {
      let b = base;
      for (let t = 0; t < k; t++) if ((j >> (k - 1 - t)) & 1) b |= tMask[t];
      idx[j] = b;
      amp[j] = state[b];
    }
    for (let i = 0; i < dim; i++) {
      let re = 0, im = 0;
      const row = U[i];
      for (let j = 0; j < dim; j++) {
        const u = row[j], a = amp[j];
        re += u.re * a.re - u.im * a.im;
        im += u.re * a.im + u.im * a.re;
      }
      out[idx[i]] = { re, im };
    }
  }
  return out;
}

export const probabilities = (s: State): number[] => s.map(cAbs2);

/** The probability of each outcome of measuring `qubits` (big-endian in the order listed). */
export function marginal(s: State, n: number, qubits: number[]): number[] {
  const m = qubits.length;
  const out = new Array<number>(1 << m).fill(0);
  for (let b = 0; b < s.length; b++) {
    let k = 0;
    for (let t = 0; t < m; t++) k = (k << 1) | bitOf(b, qubits[t], n);
    out[k] += cAbs2(s[b]);
  }
  return out;
}

/** Measuring qubit q with result `outcome`: its probability and the renormalised post-measurement state. */
export function measureQubit(s: State, n: number, q: number, outcome: 0 | 1): { prob: number; post: State | null } {
  const kept = s.map((z, b) => (bitOf(b, q, n) === outcome ? z : C0));
  const prob = stateNorm2(kept);
  if (prob <= ZERO_TOL) return { prob: 0, post: null };
  const k = 1 / Math.sqrt(prob);
  return { prob, post: kept.map((z) => cScale(z, k)) };
}

/** ρ over the kept qubits (big-endian in `keep` order), the others traced out. */
export function reducedDensity(s: State, n: number, keep: number[]): CMat {
  const m = keep.length;
  const rest = Array.from({ length: n }, (_, q) => q).filter((q) => !keep.includes(q));
  const dim = 1 << m;
  const rho: CMat = Array.from({ length: dim }, () => Array.from({ length: dim }, () => C0));
  const place = (a: number, e: number): number => {
    let b = 0;
    for (let t = 0; t < m; t++) if ((a >> (m - 1 - t)) & 1) b |= 1 << (n - 1 - keep[t]);
    for (let t = 0; t < rest.length; t++) if ((e >> (rest.length - 1 - t)) & 1) b |= 1 << (n - 1 - rest[t]);
    return b;
  };
  for (let e = 0; e < 1 << rest.length; e++)
    for (let a = 0; a < dim; a++) {
      const x = s[place(a, e)];
      if (cAbs2(x) === 0) continue;
      for (let c = 0; c < dim; c++) rho[a][c] = cAdd(rho[a][c], cMul(x, cConj(s[place(c, e)])));
    }
  return rho;
}

/** tr(ρ²). */
export function purity(rho: CMat): number {
  let t = 0;
  for (let i = 0; i < rho.length; i++) for (let j = 0; j < rho.length; j++) t += cMul(rho[i][j], rho[j][i]).re;
  return t;
}

/** The Bloch vector of a single-qubit pure state a|0⟩ + b|1⟩ (normalised first). */
export function blochVector(v: [Cx, Cx] | Cx[]): [number, number, number] {
  const n = Math.sqrt(cAbs2(v[0]) + cAbs2(v[1]));
  const a = cScale(v[0], 1 / n), b = cScale(v[1], 1 / n);
  const ab = cMul(cConj(a), b);
  return [2 * ab.re, 2 * ab.im, cAbs2(a) - cAbs2(b)];
}

/** cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩. */
export const stateFromBloch = (t: number, p: number): State => [cx(Math.cos(t / 2)), cScale(cExpI(p), Math.sin(t / 2))];

/**
 * A 2×2 unitary as e^{iα}·Rₙ(θ): the global phase α ∈ (−π, π], the Bloch rotation angle θ ∈ [0, π] and the unit axis
 * n (null when θ = 0: the identity up to phase has no axis). Rₙ(θ) = cos(θ/2) I − i sin(θ/2) n·σ.
 */
export function rotationOf(U: CMat): { alpha: number; theta: number; axis: [number, number, number] | null } {
  const det = cSub(cMul(U[0][0], U[1][1]), cMul(U[0][1], U[1][0]));
  let alpha = cArg(det) / 2;
  let V = matScale(U, cExpI(-alpha));
  let c = (V[0][0].re + V[1][1].re) / 2;
  if (c < 0) {
    // −V is the same rotation with θ → 2π − θ; take θ ≤ π and move the sign into the phase.
    alpha += Math.PI;
    V = matScale(V, cx(-1));
    c = -c;
  }
  if (alpha > Math.PI) alpha -= 2 * Math.PI;
  if (alpha <= -Math.PI) alpha += 2 * Math.PI;
  c = Math.min(1, c);
  const theta = 2 * Math.acos(c);
  const s = Math.sin(theta / 2);
  if (s < 1e-9) return { alpha, theta: 0, axis: null };
  const nx = -(V[0][1].im + V[1][0].im) / (2 * s);
  const ny = (V[1][0].re - V[0][1].re) / (2 * s);
  const nz = -(V[0][0].im - V[1][1].im) / (2 * s);
  const l = Math.hypot(nx, ny, nz);
  return { alpha, theta, axis: [nx / l, ny / l, nz / l] };
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing: one reader for coefficients and angles
// ---------------------------------------------------------------------------------------------------------------

/** A complex number in the pane's expression syntax (0.8i, 1/sqrt(2), e^(iπ/4), (1+i)/2); an { error } otherwise. */
export function parseComplex(text: string): Cx | { error: string } {
  const t = text.trim().replace(/[−–]/g, "-").replace(/·/g, "*");
  if (!t) return { error: "empty" };
  if (/inf|nan|∞/i.test(t)) return { error: "the value typed is not a finite number." };
  try {
    const z = evalComplex(parseExpr(t));
    if (!finiteCx(z)) return { error: `"${text.trim()}" is not a finite number.` };
    return { re: z.re === 0 ? 0 : z.re, im: z.im === 0 ? 0 : z.im };
  } catch (e) {
    return { error: `"${text.trim()}" could not be read as a number (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** The angle cap: one full million degrees is already a typo. */
const ANGLE_MAX_RAD = 1e4;

/**
 * An angle: degrees by default ("30", "30°", "30 deg"), radians when written with π / pi ("pi/4", "3π/2") or with
 * "rad" ("0.5 rad"). Returns radians and how the value was written (for labels: "30°" or "π/4").
 */
export function parseAngle(text: string): { rad: number; label: string } | { error: string } {
  let t = text.trim().replace(/[−–]/g, "-");
  if (!t) return { error: "an angle is required" };
  let unit: "deg" | "rad" = /pi|π/i.test(t) ? "rad" : "deg";
  if (/(°|\bdeg(rees?)?)$/i.test(t)) {
    unit = "deg";
    t = t.replace(/\s*(°|deg(rees?)?)$/i, "");
  } else if (/\brad(ians?)?$/i.test(t)) {
    unit = "rad";
    t = t.replace(/\s*rad(ians?)?$/i, "");
  }
  const z = parseComplex(t.replace(/π/g, "pi"));
  if ("error" in z) return { error: `angle ${z.error === "empty" ? "is missing" : z.error}` };
  if (Math.abs(z.im) > 1e-12) return { error: `the angle "${text.trim()}" is complex; an angle is a real number.` };
  const rad = unit === "deg" ? (z.re * Math.PI) / 180 : z.re;
  if (Math.abs(rad) > ANGLE_MAX_RAD) return { error: `the angle "${text.trim()}" is out of range (at most 10⁴ rad).` };
  return { rad, label: unit === "deg" ? `${trimNum(z.re, 6)}°` : fmtAngle(rad) };
}

export interface KetParse {
  state: State;
  n: number;
  /** ‖ψ‖² as typed (1 when it was already normalised). */
  norm2: number;
  notes: string[];
}

const NAMED_1Q: Record<string, [Cx, Cx]> = {
  "+": [cx(R), cx(R)],
  "-": [cx(R), cx(-R)],
  i: [cx(R), cx(0, R)],
  "+i": [cx(R), cx(0, R)],
  "-i": [cx(R), cx(0, -R)],
};
const BELL_ALIASES: Record<string, string> = {
  "Φ+": "Phi+", "Φ⁺": "Phi+", "phi+": "Phi+", "Φ-": "Phi-", "Φ⁻": "Phi-", "phi-": "Phi-",
  "Ψ+": "Psi+", "Ψ⁺": "Psi+", "psi+": "Psi+", "Ψ-": "Psi-", "Ψ⁻": "Psi-", "psi-": "Psi-",
};

/** Nothing typed may make the reader loop or allocate without bound. */
const KET_MAX_TERMS = 1024;

/**
 * A state typed in Dirac form: coefficient·|label⟩ terms joined by + and −. Labels: strings of 0/1 (all the same
 * length, ≤ MAX_QUBITS), and the named one-qubit states +, −, i, −i and two-qubit Bell states Φ⁺ Φ⁻ Ψ⁺ Ψ⁻. The
 * closing bracket may be ⟩, 〉 or >. Coefficients use the pane's expression syntax (0.6, 0.8i, 1/sqrt(2), e^(iπ/4)).
 * A state that is not normalised is normalised, with a note; a zero state is refused.
 */
export function parseKet(text: string): KetParse | { error: string } {
  const src = (text ?? "").replace(/[−–]/g, "-").trim();
  if (!src) return { error: "No state was typed. Write it in Dirac form, e.g. 0.6|0⟩ + 0.8i|1⟩." };
  const re = /\|([^|⟩〉>]*)[⟩〉>]/g;
  const kets: { label: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && kets.length <= KET_MAX_TERMS) kets.push({ label: m[1].trim(), start: m.index, end: m.index + m[0].length });
  if (!kets.length) return { error: `No ket was found in "${src}". Write each term as coefficient|label⟩, e.g. 0.6|0⟩ + 0.8i|1⟩.` };
  if (kets.length > KET_MAX_TERMS) return { error: `At most ${KET_MAX_TERMS} terms can be read.` };
  if (src.slice(kets[kets.length - 1].end).trim())
    return { error: `Text after the last ket ("${src.slice(kets[kets.length - 1].end).trim()}") is not part of a term. Put each coefficient BEFORE its ket: 1/sqrt(2)|0⟩ + 1/sqrt(2)|1⟩.` };
  let n = 0;
  const terms: { coef: Cx; vec: State }[] = [];
  let prevEnd = 0;
  for (const k of kets) {
    let c = src.slice(prevEnd, k.start).trim();
    prevEnd = k.end;
    if (terms.length) {
      if (!/^[+-]/.test(c)) return { error: `Terms must be joined by + or − (before |${k.label}⟩).` };
    }
    let sign = 1;
    if (/^[+-]/.test(c)) {
      sign = c[0] === "-" ? -1 : 1;
      c = c.slice(1).trim();
    }
    c = c.replace(/[*·]\s*$/, "").trim();
    if (/\(\s*$/.test(c) || /\|/.test(c)) return { error: "Brackets around several kets are not read: write each term as coefficient|label⟩ (1/sqrt(2)|0⟩ + 1/sqrt(2)|1⟩)." };
    let coef: Cx = C1;
    if (c) {
      const z = parseComplex(c);
      if ("error" in z) return { error: `The coefficient of |${k.label}⟩: ${z.error}` };
      coef = z;
    }
    coef = cScale(coef, sign);
    // The label: a bit string, a named one-qubit state, or a Bell state.
    let vec: State;
    let kn: number;
    const lab = k.label.replace(/\s+/g, "");
    if (/^[01]+$/.test(lab)) {
      kn = lab.length;
      if (kn > MAX_QUBITS) return { error: `|${lab}⟩ has ${kn} qubits; states are limited to ${MAX_QUBITS} qubits (1024 amplitudes).` };
      vec = basisState(kn, parseInt(lab, 2));
    } else if (NAMED_1Q[lab]) {
      kn = 1;
      vec = NAMED_1Q[lab].slice();
    } else if (BELL_ALIASES[lab] || BELL_ALIASES[lab.toLowerCase()]) {
      kn = 2;
      vec = BELL_STATES[BELL_ALIASES[lab] ?? BELL_ALIASES[lab.toLowerCase()]].slice();
    } else {
      return { error: `|${k.label}⟩ is not a label this reader knows: use 0/1 strings (|0⟩, |01⟩), |+⟩, |−⟩, |i⟩, |−i⟩ or a Bell state |Φ⁺⟩ |Φ⁻⟩ |Ψ⁺⟩ |Ψ⁻⟩.` };
    }
    if (n && kn !== n) return { error: `|${k.label}⟩ has ${kn} qubit${kn > 1 ? "s" : ""} but an earlier ket has ${n}: every term must have the same number of qubits.` };
    n = kn;
    terms.push({ coef, vec });
  }
  const sum: State = Array.from({ length: 1 << n }, () => C0);
  for (const t of terms) for (let b = 0; b < sum.length; b++) sum[b] = cAdd(sum[b], cMul(t.coef, t.vec[b]));
  const nz = normalise(sum);
  if (!nz) return { error: "The state is zero (or not finite): it cannot be normalised." };
  const notes: string[] = [];
  if (Math.abs(nz.norm2 - 1) > 1e-9)
    notes.push(`The state as typed has ‖ψ‖² = ${trimNum(nz.norm2, 6)}, not 1; it was normalised (divided by ${fmtReal(Math.sqrt(nz.norm2)).text}).`);
  return { state: nz.state, n, norm2: nz.norm2, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// Exact display
// ---------------------------------------------------------------------------------------------------------------

/** Six significant figures with trailing zeros dropped, U+2212, ×10ⁿ outside 10⁻³…10⁵ (fmtSig). */
export function trimNum(v: number, sig = 6): string {
  if (Math.abs(v) < ZERO_TOL) return "0";
  return fmtSig(v, sig).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
}

/** a·√b/d with a, d > 0 coprime-reduced; `neg` the sign. a = 0 is zero. */
export interface ExactForm {
  neg: boolean;
  a: number;
  b: number;
  d: number;
}

const RADICANDS = [1, 2, 3, 6];
const DENOMS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);

/** The closed form a·√b/d of x (to 10⁻¹²), or null when x is not one of them. */
export function recogniseReal(x: number): ExactForm | null {
  if (!Number.isFinite(x)) return null;
  if (Math.abs(x) < ZERO_TOL) return { neg: false, a: 0, b: 1, d: 1 };
  const ax = Math.abs(x);
  for (const b of RADICANDS) {
    const rb = Math.sqrt(b);
    for (const d of DENOMS) {
      const a = (ax * d) / rb;
      const r = Math.round(a);
      // a ≤ 64, or up to 4d for plain fractions (121/128, a Grover probability).
      if (r >= 1 && r <= (b === 1 ? Math.max(64, 4 * d) : 64) && (Math.abs(a - r) * rb) / d < ZERO_TOL) {
        const g = gcd(r, d);
        return { neg: x < 0, a: r / g, b, d: d / g };
      }
    }
  }
  return null;
}

const FRAC_GLYPH: Record<string, string> = { "1/2": "½", "1/4": "¼", "3/4": "¾", "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞" };

/** Numerator and denominator of a form, as text and as equation syntax ("" = absent). */
function formParts(f: ExactForm): { N: string; D: string; Nm: string; Dm: string } {
  if (f.b === 1) return { N: String(f.a), D: f.d > 1 ? String(f.d) : "", Nm: String(f.a), Dm: f.d > 1 ? String(f.d) : "" };
  if (f.b === 2 && f.a === 1 && f.d >= 2)
    // √2/(2k) = 1/(k√2): the form every quantum text writes (1/√2, 1/(2√2)).
    return { N: "1", D: f.d === 2 ? "√2" : `${f.d / 2}√2`, Nm: "1", Dm: f.d === 2 ? "sqrt(2)" : `${f.d / 2} sqrt(2)` };
  return {
    N: `${f.a === 1 ? "" : f.a}√${f.b}`,
    D: f.d > 1 ? String(f.d) : "",
    Nm: `${f.a === 1 ? "" : `${f.a} `}sqrt(${f.b})`,
    Dm: f.d > 1 ? String(f.d) : "",
  };
}
const wrapT = (s: string): string => (/^\d+$/.test(s) || /^√\d+$/.test(s) ? s : `(${s})`);
const wrapM = (s: string): string => (/\s/.test(s) ? `{${s}}` : s);

export interface Shown {
  text: string;
  math: string;
  /** True when the value was recognised as a closed form (or is zero). */
  exact: boolean;
}

/** |x| as text/math when it is a closed form; null otherwise. */
function absForm(x: number): { text: string; math: string; N: string; D: string; Nm: string; Dm: string } | null {
  const f = recogniseReal(x);
  if (!f) return null;
  if (f.a === 0) return { text: "0", math: "0", N: "0", D: "", Nm: "0", Dm: "" };
  const p = formParts(f);
  const plain = p.D ? `${p.N}/${wrapT(p.D)}` : p.N;
  return { ...p, text: FRAC_GLYPH[plain] ?? plain, math: p.Dm ? `${wrapM(p.Nm)}/${wrapM(p.Dm)}` : p.Nm };
}

/** A real number: its closed form when recognised, otherwise 6 significant figures. */
export function fmtReal(x: number): Shown {
  const a = absForm(x);
  if (a) {
    if (a.text === "0") return { text: "0", math: "0", exact: true };
    return { text: (x < 0 ? "−" : "") + a.text, math: (x < 0 ? "-" : "") + a.math, exact: true };
  }
  const t = trimNum(x);
  return { text: t, math: t.replace(/−/g, "-").replace(/×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (_, e: string) => ` times 10^{${supToPlain(e)}}`), exact: false };
}
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const supToPlain = (e: string): string => [...e].map((c) => (c === "⁻" ? "-" : String(SUP.indexOf(c)))).join("");

/** |y|·i as text/math (i, i/√2, (√3/2)i, 0.8i). */
function imagAbs(y: number): { text: string; math: string; exact: boolean } {
  const a = absForm(y);
  if (a) {
    if (a.N === "1") return { text: a.D ? `i/${wrapT(a.D)}` : "i", math: a.Dm ? `i/${wrapM(a.Dm)}` : "i", exact: true };
    if (a.D) return { text: `(${a.text})i`, math: `(${a.math}) i`, exact: true };
    return { text: `${a.text}i`, math: `${a.math} i`, exact: true };
  }
  const t = trimNum(Math.abs(y));
  const m = fmtReal(Math.abs(y)).math;
  return { text: `${t}i`, math: /times/.test(m) ? `(${m}) i` : `${m} i`, exact: false };
}

/** A complex number: "a + bi" with each part exact when recognised. `sum` is true when both parts are non-zero. */
export function fmtCx(z: Cx): Shown & { sum: boolean } {
  const re = Math.abs(z.re) < ZERO_TOL ? 0 : z.re;
  const im = Math.abs(z.im) < ZERO_TOL ? 0 : z.im;
  if (im === 0) return { ...fmtReal(re), sum: false };
  const ia = imagAbs(im);
  if (re === 0) return { text: (im < 0 ? "−" : "") + ia.text, math: (im < 0 ? "-" : "") + ia.math, exact: ia.exact, sum: false };
  const r = fmtReal(re);
  return {
    text: `${r.text} ${im < 0 ? "−" : "+"} ${ia.text}`,
    math: `${r.math} ${im < 0 ? "-" : "+"} ${ia.math}`,
    exact: r.exact && ia.exact,
    sum: true,
  };
}

/** θ wrapped into (−π, π]. */
const wrapPi = (t: number): number => {
  let x = t % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

/** k·π/den for an angle that is a multiple of π/24 (to 10⁻¹⁰), else null. */
function piMultiple(t: number): { num: number; den: number } | null {
  const k = (t / Math.PI) * 24;
  const r = Math.round(k);
  if (Math.abs(k - r) > 1e-10) return null;
  const g = gcd(Math.abs(r), 24) || 24;
  return { num: r / g, den: 24 / g };
}

/** An angle in radians as text: "π/4", "−3π/4", "0" when a multiple of π/24, else degrees "37.5°"→ numeric rad. */
export function fmtAngle(t: number): string {
  if (Math.abs(t) < ZERO_TOL) return "0";
  const p = piMultiple(t);
  if (!p) return `${trimNum(t, 6)} rad`;
  const a = Math.abs(p.num);
  return `${p.num < 0 ? "−" : ""}${a === 1 ? "" : a}π${p.den > 1 ? `/${p.den}` : ""}`;
}

/**
 * A phase factor e^{iθ}: text "exp(iπ/4)" (no caret in result text), math "e^{i π/4}"; 1, −1, i, −i as themselves.
 * `exact` is false when θ is not a multiple of π/24.
 */
export function phaseForm(t: number): Shown {
  const x = wrapPi(t);
  const p = piMultiple(x);
  if (p) {
    if (p.num === 0) return { text: "1", math: "1", exact: true };
    if (p.num === p.den) return { text: "−1", math: "-1", exact: true };
    if (p.num * 2 === p.den) return { text: "i", math: "i", exact: true };
    if (p.num * 2 === -p.den) return { text: "−i", math: "-i", exact: true };
    const a = Math.abs(p.num), neg = p.num < 0;
    return {
      text: `exp(${neg ? "−" : ""}${a === 1 ? "" : a}iπ${p.den > 1 ? `/${p.den}` : ""})`,
      math: `e^{${neg ? "-" : ""}${a === 1 ? "" : `${a} `}i π${p.den > 1 ? `/${p.den}` : ""}}`,
      exact: true,
    };
  }
  return { text: `exp(${trimNum(x, 6)}i)`, math: `e^{${trimNum(x, 6).replace(/−/g, "-")} i}`, exact: false };
}

/** √k simplified: 2 → √2, 4 → 2, 8 → 2√2; text and math. */
function sqrtInt(k: number): { text: string; math: string } {
  let s = 1, t = k;
  for (let f = 2; f * f <= t; f++) while (t % (f * f) === 0) { t /= f * f; s *= f; }
  if (t === 1) return { text: String(s), math: String(s) };
  return { text: s === 1 ? `√${t}` : `${s}√${t}`, math: s === 1 ? `sqrt(${t})` : `${s} sqrt(${t})` };
}

export interface StateShown {
  text: string;
  /** Equation syntax (ket(01) …); "" when the state is too long for one equation (more than 16 terms). */
  math: string;
  /** The global phase factored out (its text), or null. */
  globalPhase: Shown | null;
  /** Non-zero terms in the state, and how many the display shows. */
  terms: number;
  shown: number;
}

const ketT = (b: number, n: number): string => `|${ketLabel(b, n)}⟩`;
const ketM = (b: number, n: number): string => `ket(${ketLabel(b, n)})`;

/**
 * A state in Dirac form. Steps: (1) a global phase e^{iθ} is factored out — and STATED — only when that turns every
 * coefficient real or imaginary and θ is a closed form; (2) when every non-zero amplitude has the same modulus 1/√k
 * and phases at multiples of π/4, it is written (Σ phase·|b⟩)/√k; (3) otherwise term by term. At most `maxTerms`
 * terms (largest first, written in index order); the rest are summarised with their total probability.
 */
export function fmtState(state: State, n: number, opts: { maxTerms?: number } = {}): StateShown {
  const maxTerms = opts.maxTerms ?? 32;
  const idx = state.map((_, b) => b).filter((b) => cAbs(state[b]) > ZERO_TOL);
  if (!idx.length) return { text: "0", math: "0", globalPhase: null, terms: 0, shown: 0 };
  const mixed = (z: Cx): boolean => Math.abs(z.re) > ZERO_TOL && Math.abs(z.im) > ZERO_TOL;
  let coefs = idx.map((b) => state[b]);
  let globalPhase: Shown | null = null;
  const th = cArg(coefs[0]);
  const pf = phaseForm(th);
  if (coefs.some(mixed) && pf.exact && pf.text !== "1") {
    const rot = coefs.map((z) => cMul(z, cExpI(-th)));
    if (!rot.some(mixed)) {
      coefs = rot;
      globalPhase = pf;
    }
  }
  const total = idx.length;
  let keep = idx.map((b, i) => ({ b, c: coefs[i] }));
  let restProb = 0;
  if (keep.length > maxTerms) {
    const sorted = [...keep].sort((x, y) => cAbs2(y.c) - cAbs2(x.c) || x.b - y.b);
    const top = new Set(sorted.slice(0, maxTerms).map((t) => t.b));
    restProb = sorted.slice(maxTerms).reduce((s, t) => s + cAbs2(t.c), 0);
    keep = keep.filter((t) => top.has(t.b));
  }
  const wrapG = (text: string, math: string): { text: string; math: string } =>
    globalPhase ? { text: `${globalPhase.text}·(${text})`, math: `${globalPhase.math}(${math})` } : { text, math };

  // (2) A common modulus 1/√k with simple phases.
  const r0 = cAbs(keep[0].c);
  if (!restProb && keep.length >= 2 && keep.every((t) => Math.abs(cAbs(t.c) - r0) < 1e-12)) {
    const k = 1 / (r0 * r0);
    const kk = Math.round(k);
    if (kk >= 2 && kk <= 1 << MAX_QUBITS && Math.abs(k - kk) < 1e-9 * kk) {
      const phases = keep.map((t) => phaseForm(cArg(t.c)));
      const simple = keep.every((t) => piMultiple(wrapPi(cArg(t.c))) && (piMultiple(wrapPi(cArg(t.c)))!.den <= 4));
      if (simple) {
        let text = "", math = "";
        keep.forEach((t, i) => {
          const ph = phases[i];
          const neg = ph.text === "−1" || ph.text.startsWith("−");
          const body = ph.text === "1" || ph.text === "−1" ? "" : ph.text.replace(/^−/, "");
          const bodyM = ph.math === "1" || ph.math === "-1" ? "" : ph.math.replace(/^-/, "");
          if (i === 0) {
            text += `${neg ? "−" : ""}${body}${ketT(t.b, n)}`;
            math += `${neg ? "-" : ""}${bodyM}${bodyM ? " " : ""}${ketM(t.b, n)}`;
          } else {
            text += ` ${neg ? "−" : "+"} ${body}${ketT(t.b, n)}`;
            math += ` ${neg ? "-" : "+"} ${bodyM}${bodyM ? " " : ""}${ketM(t.b, n)}`;
          }
        });
        const sq = sqrtInt(kk);
        const w = wrapG(`(${text})/${wrapT(sq.text)}`, `{${math}}/${wrapM(sq.math)}`);
        return { ...w, math: keep.length <= 16 ? w.math : "", globalPhase, terms: total, shown: keep.length };
      }
    }
  }

  // (3) Term by term.
  let text = "", math = "";
  keep.forEach((t, i) => {
    const f = fmtCx(t.c);
    let neg = false, bodyT: string, bodyM: string;
    if (f.sum) {
      bodyT = `(${f.text})`;
      bodyM = `(${f.math})`;
    } else {
      neg = f.text.startsWith("−");
      bodyT = f.text.replace(/^−/, "");
      bodyM = f.math.replace(/^-/, "");
      if (bodyT === "1") {
        bodyT = "";
        bodyM = "";
      } else if (/\//.test(bodyT)) bodyT = `(${bodyT})`;
    }
    const sepT = i === 0 ? (neg ? "−" : "") : ` ${neg ? "−" : "+"} `;
    const sepM = i === 0 ? (neg ? "-" : "") : ` ${neg ? "-" : "+"} `;
    text += `${sepT}${bodyT}${ketT(t.b, n)}`;
    // A fraction coefficient is bracketed so the equation reads (√3/2)|0⟩, never √3/(2|0⟩).
    math += `${sepM}${bodyM && /\//.test(bodyM) && !/^\(/.test(bodyM) ? `(${bodyM})` : bodyM}${bodyM ? " " : ""}${ketM(t.b, n)}`;
  });
  if (restProb) text += ` + … (${total - keep.length} more terms, total probability ${trimNum(restProb, 4)})`;
  const w = wrapG(text, math);
  return { text: w.text, math: restProb || keep.length > 16 ? "" : w.math, globalPhase, terms: total, shown: keep.length };
}
