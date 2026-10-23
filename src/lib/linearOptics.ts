// LINEAR OPTICAL QUANTUM COMPUTING (Release Q, part Q4): beam splitters and phase shifters as unitaries on optical
// modes, the Mach–Zehnder interferometer, Hong–Ou–Mandel interference (with partial distinguishability and the dip
// against delay), multiphoton output probabilities through an m-mode linear network by matrix permanents (Ryser's
// formula — the boson-sampling probabilities), the dual-rail / polarisation qubit, and the cited success
// probabilities of the probabilistic linear-optics CZ gates with photon-loss and detector-efficiency scaling.
//
// Pure functions, no state. Complex arithmetic, matrices and the unitarity check come from the shared quantum core
// (quantumCore.ts, Q2) so the app has one complex type and one isUnitary; wave plates come from jones.ts.
//
// CONVENTIONS (printed by the pane tools):
//   - A beam splitter of reflectivity R (T = 1 − R) acting on modes (a, b) is U = [[√T, i√R], [i√R, √T]]: the
//     symmetric convention, a reflected photon picks up the phase i. Output amplitudes are U·(input amplitudes), so
//     U[out][in] is the amplitude for a photon entering mode `in` to leave in mode `out`.
//   - A phase shifter φ on mode 1: diag(1, e^{iφ}).
//   - Mach–Zehnder: U = BS₂ · P(φ) · BS₁ (the first splitter acts first). Port 0 of the output is the same-index
//     mode as input port 0: the path transmitted at both splitters.
//   - The m-mode discrete Fourier transform (balanced multiport; m = 3 is the "tritter"): F_jk = ω^{jk}/√m,
//     ω = e^{2πi/m}, j, k = 0 … m − 1.
//   - A chain of beam splitters on m modes: BS(R₁) on modes (0, 1) first, then BS(R₂) on (1, 2), …, BS(R_{m−1}) on
//     (m − 2, m − 1); U = B_{m−2,m−1} ⋯ B₁₂ · B₀₁.
//   - Multiphoton: input occupations s (sᵢ photons in mode i), output t. The transition matrix U_{s,t} takes row i of
//     U (output mode i) tᵢ times and column j (input mode j) sⱼ times; P(t|s) = |Perm U_{s,t}|² / (Πsⱼ! Πtᵢ!). For
//     the same photons made fully distinguishable, P = Perm(|U_{s,t}|²) / Πtᵢ! (the classical comparison).

import { cAbs2, cExpI, cSub, cx, identity, matDagger, matMul, matMulChain, parseComplex, type CMat, type Cx } from "./quantumCore";
import { propagate, type JonesElement, type JonesVec } from "./jones";

// ---------------------------------------------------------------------------------------------------------------
// Beam splitters, phase shifters, the Mach–Zehnder interferometer
// ---------------------------------------------------------------------------------------------------------------

/** The beam splitter U = [[√T, i√R], [i√R, √T]] (R the reflectivity, 0 ≤ R ≤ 1). */
export function beamSplitter(R: number): CMat {
  const t = Math.sqrt(1 - R), r = Math.sqrt(R);
  return [
    [cx(t), cx(0, r)],
    [cx(0, r), cx(t)],
  ];
}

/** The phase shifter diag(1, e^{iφ}) (φ on mode 1). */
export const phaseShifter = (phi: number): CMat => [
  [cx(1), cx(0)],
  [cx(0), cExpI(phi)],
];

export interface MachZehnder {
  U: CMat;
  /** Output amplitudes for the photon entering `input`. */
  amps: [Cx, Cx];
  /** Probabilities at output ports 0 and 1 (equal to the classical intensity fractions). */
  p: [number, number];
  /** Fringe visibility at each output port over a full turn of φ: (Pmax − Pmin)/(Pmax + Pmin). */
  vis: [number, number];
  /** P(port 0) = A₀ − B cos φ for input 0 (A₀ + B cos φ for input 1): the fringe's mean and amplitude. */
  mean: [number, number];
  amp: number;
}

/** The Mach–Zehnder U = BS(R₂)·P(φ)·BS(R₁) and its output for one photon in port `input`. */
export function machZehnder(R1: number, R2: number, phi: number, input: 0 | 1): MachZehnder {
  const U = matMulChain([beamSplitter(R2), phaseShifter(phi), beamSplitter(R1)]);
  const amps: [Cx, Cx] = [U[0][input], U[1][input]];
  const p0 = Math.min(1, Math.max(0, cAbs2(amps[0])));
  const p: [number, number] = [p0, 1 - p0];
  const T1 = 1 - R1, T2 = 1 - R2;
  const B = 2 * Math.sqrt(T1 * T2 * R1 * R2);
  // For input 0: P0 = T₁T₂ + R₁R₂ − B cos φ, P1 = T₁R₂ + R₁T₂ + B cos φ; input 1 swaps the means.
  const m0 = input === 0 ? T1 * T2 + R1 * R2 : T1 * R2 + R1 * T2;
  const m1 = 1 - m0;
  const vis: [number, number] = [m0 > 0 ? B / m0 : 0, m1 > 0 ? B / m1 : 0];
  return { U, amps, p, vis, mean: [m0, m1], amp: B };
}

// ---------------------------------------------------------------------------------------------------------------
// Hong–Ou–Mandel
// ---------------------------------------------------------------------------------------------------------------

export interface Hom {
  p11: number;
  p20: number;
  p02: number;
  /** HOM visibility (C_max − C_min)/C_max of the coincidence dip: 2RT·M₀ / (T² + R²). */
  visibility: number;
}

/**
 * Two photons, one in each input of a beam splitter of reflectivity R, with mode overlap M = |⟨ψ₁|ψ₂⟩|² (1 identical,
 * 0 fully distinguishable): P(1,1) = T² + R² − 2RT·M, P(2,0) = P(0,2) = RT(1 + M).
 */
export function hom(R: number, overlap: number): Hom {
  const T = 1 - R;
  const p11 = T * T + R * R - 2 * R * T * overlap;
  const p2 = R * T * (1 + overlap);
  const base = T * T + R * R;
  return { p11: Math.max(0, p11), p20: p2, p02: p2, visibility: base > 0 ? (2 * R * T * overlap) / base : 0 };
}

/** σ of |ψ(t)|² from its full width at half maximum. */
export const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));

/**
 * The overlap |⟨ψ₁|ψ₂(τ)⟩|² of two identical transform-limited Gaussian photons delayed by τ, each of intensity
 * |ψ(t)|² ∝ exp(−t²/(2σ²)) (σ from the intensity FWHM w, σ = w/(2√(2 ln 2))): amplitude ψ ∝ exp(−t²/(4σ²)), so
 * ∫ψ(t)ψ(t − τ)dt = exp(−τ²/(8σ²)) and the overlap is exp(−τ²/(4σ²)), scaled by the zero-delay overlap M₀.
 * Its FWHM in τ is √2·w.
 */
export function gaussianOverlap(tau: number, fwhm: number, m0: number): number {
  const s = fwhm * FWHM_TO_SIGMA;
  return m0 * Math.exp(-(tau * tau) / (4 * s * s));
}

/** P(1,1) at delay τ (the dip). */
export const homDip = (R: number, m0: number, fwhm: number, tau: number): number => hom(R, gaussianOverlap(tau, fwhm, m0)).p11;

// ---------------------------------------------------------------------------------------------------------------
// Permanents and multiphoton interference
// ---------------------------------------------------------------------------------------------------------------

/** The most photons a multiphoton run takes (scope: boson sampling ≤ 8 photons). */
export const MAX_PHOTONS = 8;
/** The most modes. */
export const MAX_MODES = 12;
/**
 * The work bound: Σ over the evaluated patterns of n·2ⁿ Gray-code steps, twice (the quantum permanent and the
 * distinguishable one). 8 photons in 8 modes (6435 patterns) is 2.64×10⁷ and runs; 8 photons in 9 modes (12 870
 * patterns, 5.3×10⁷) is refused by name. Nothing a user types can make a run longer than this bound.
 */
export const WORK_CAP = 3e7;
/** The most patterns listed explicitly. */
export const MAX_LISTED_PATTERNS = 200;

/**
 * The permanent of a square complex matrix by Ryser's formula with Gray-code ordering,
 * Perm A = (−1)ⁿ Σ_{S ⊆ {1…n}} (−1)^{|S|} Πᵢ Σ_{j ∈ S} a_ij — O(2ⁿ·n). Perm of the 0×0 matrix is 1.
 */
export function permanent(A: CMat): Cx {
  const n = A.length;
  if (n === 0) return cx(1);
  if (n > MAX_PHOTONS + 4) throw new Error("permanent: matrix too large");
  const rr = new Float64Array(n), ri = new Float64Array(n);
  let tr = 0, ti = 0, gray = 0, pop = 0;
  const N = 1 << n;
  for (let k = 1; k < N; k++) {
    const j = 31 - Math.clz32(k & -k);
    const bit = 1 << j;
    gray ^= bit;
    const add = gray & bit ? 1 : -1;
    pop += add;
    for (let i = 0; i < n; i++) {
      rr[i] += add * A[i][j].re;
      ri[i] += add * A[i][j].im;
    }
    let pr = rr[0], pi = ri[0];
    for (let i = 1; i < n; i++) {
      const a = pr * rr[i] - pi * ri[i];
      pi = pr * ri[i] + pi * rr[i];
      pr = a;
    }
    if (pop & 1) {
      tr -= pr;
      ti -= pi;
    } else {
      tr += pr;
      ti += pi;
    }
  }
  return n & 1 ? cx(-tr, -ti) : cx(tr, ti);
}

/** The permanent of a real matrix (the distinguishable-photon comparison), same algorithm. */
export function permanentReal(A: number[][]): number {
  const n = A.length;
  if (n === 0) return 1;
  const r = new Float64Array(n);
  let t = 0, gray = 0, pop = 0;
  const N = 1 << n;
  for (let k = 1; k < N; k++) {
    const j = 31 - Math.clz32(k & -k);
    const bit = 1 << j;
    gray ^= bit;
    const add = gray & bit ? 1 : -1;
    pop += add;
    let p = 1;
    for (let i = 0; i < n; i++) {
      r[i] += add * A[i][j];
      p *= r[i];
    }
    t += pop & 1 ? -p : p;
  }
  return n & 1 ? -t : t;
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
const factProd = (occ: number[]): number => occ.reduce((s, k) => s * FACT[k], 1);

/** The number of ways to place n photons in m modes: C(n + m − 1, n). */
export function patternCount(n: number, m: number): number {
  let c = 1;
  for (let k = 1; k <= n; k++) c = (c * (m - 1 + k)) / k;
  return Math.round(c);
}

/** Every occupation pattern of n photons in m modes, in descending lexicographic order ((n,0,…,0) first). */
export function fockPatterns(n: number, m: number): number[][] {
  const out: number[][] = [];
  const cur = new Array<number>(m).fill(0);
  const rec = (mode: number, left: number): void => {
    if (mode === m - 1) {
      cur[mode] = left;
      out.push(cur.slice());
      return;
    }
    for (let k = left; k >= 0; k--) {
      cur[mode] = k;
      rec(mode + 1, left - k);
    }
  };
  if (m >= 1) rec(0, n);
  return out;
}

/** |a,b,c⟩ for an occupation pattern. */
export const fockLabel = (occ: number[]): string => `|${occ.join(",")}⟩`;

export interface PatternResult {
  t: number[];
  /** Probability for indistinguishable photons. */
  p: number;
  /** Probability for the same photons made fully distinguishable. */
  pDist: number;
}

/** The transition submatrix U_{s,t}: rows of U repeated by t (outputs), columns by s (inputs). */
export function transitionMatrix(U: CMat, s: number[], t: number[]): CMat {
  const cols: number[] = [], rows: number[] = [];
  s.forEach((k, j) => {
    for (let q = 0; q < k; q++) cols.push(j);
  });
  t.forEach((k, i) => {
    for (let q = 0; q < k; q++) rows.push(i);
  });
  return rows.map((i) => cols.map((j) => U[i][j]));
}

/** P(t|s) for indistinguishable photons, and for distinguishable ones. */
export function patternProbability(U: CMat, s: number[], t: number[]): PatternResult {
  const M = transitionMatrix(U, s, t);
  const p = cAbs2(permanent(M)) / (factProd(s) * factProd(t));
  const pDist = permanentReal(M.map((row) => row.map(cAbs2))) / factProd(t);
  return { t: t.slice(), p, pDist: Math.max(0, pDist) };
}

/** The work a run over `patterns` patterns of n photons costs (in Gray-code row updates; see WORK_CAP). */
export const runWork = (n: number, patterns: number): number => 2 * patterns * n * 2 ** n;

export type MultiphotonRun =
  | { ok: true; results: PatternResult[]; total: number; totalDist: number; all: boolean; n: number; m: number }
  | { ok: false; error: string };

/**
 * Output probabilities for input s through U: every pattern (when the work bound allows) or the listed ones.
 * `U` must already be checked unitary and s checked (n ≤ MAX_PHOTONS, length m ≤ MAX_MODES).
 */
export function multiphoton(U: CMat, s: number[], listed?: number[][]): MultiphotonRun {
  const m = U.length;
  const n = s.reduce((a, b) => a + b, 0);
  if (n < 1) return { ok: false, error: "No photons: the input pattern must hold at least one photon." };
  if (n > MAX_PHOTONS) return { ok: false, error: `${n} photons: the multiphoton calculation is limited to ${MAX_PHOTONS} photons (exact permanents; boson-sampling sizes beyond that are outside this tool).` };
  if (m > MAX_MODES) return { ok: false, error: `${m} modes: at most ${MAX_MODES} modes.` };
  if (s.length !== m) return { ok: false, error: `The input pattern has ${s.length} modes but the network has ${m}.` };
  let pats: number[][];
  let all: boolean;
  if (listed && listed.length) {
    if (listed.length > MAX_LISTED_PATTERNS) return { ok: false, error: `At most ${MAX_LISTED_PATTERNS} output patterns can be listed.` };
    for (const t of listed) {
      if (t.length !== m) return { ok: false, error: `The output pattern ${fockLabel(t)} has ${t.length} modes but the network has ${m}.` };
      const tn = t.reduce((a, b) => a + b, 0);
      if (tn !== n) return { ok: false, error: `The output pattern ${fockLabel(t)} holds ${tn} photon${tn === 1 ? "" : "s"}, but ${n} went in: linear optics conserves the photon number.` };
    }
    pats = listed;
    all = false;
  } else {
    const count = patternCount(n, m);
    if (runWork(n, count) > WORK_CAP)
      return {
        ok: false,
        error:
          `Too many output patterns: ${n} photons in ${m} modes have ${count.toLocaleString("en-US")} patterns, beyond this tool's work bound ` +
          `(${n} photons: at most ${Math.floor(WORK_CAP / runWork(n, 1)).toLocaleString("en-US")} patterns). List the output patterns you want (one per line) instead.`,
      };
    pats = fockPatterns(n, m);
    all = true;
  }
  if (runWork(n, pats.length) > WORK_CAP) return { ok: false, error: "The listed patterns exceed the work bound." };
  const results = pats.map((t) => patternProbability(U, s, t));
  const total = results.reduce((a, r) => a + r.p, 0);
  const totalDist = results.reduce((a, r) => a + r.pDist, 0);
  return { ok: true, results, total, totalDist, all, n, m };
}

// ---------------------------------------------------------------------------------------------------------------
// Network presets and the typed-unitary reader
// ---------------------------------------------------------------------------------------------------------------

/** The m-mode DFT F_jk = ω^{jk}/√m, ω = e^{2πi/m}. */
export function dftUnitary(m: number): CMat {
  const k = 1 / Math.sqrt(m);
  return Array.from({ length: m }, (_, j) => Array.from({ length: m }, (_, l) => {
    const z = cExpI((2 * Math.PI * ((j * l) % m)) / m);
    return cx(z.re * k, z.im * k);
  }));
}

/** A 2×2 block on modes (k, k + 1) of an m-mode identity. */
function embed2(B: CMat, m: number, k: number): CMat {
  const U = identity(m).map((row) => row.slice());
  U[k][k] = B[0][0];
  U[k][k + 1] = B[0][1];
  U[k + 1][k] = B[1][0];
  U[k + 1][k + 1] = B[1][1];
  return U;
}

/** The chain BS(R₁) on (0, 1), then BS(R₂) on (1, 2), …: U = B_{m−2} ⋯ B₀ over m = Rs.length + 1 modes. */
export function beamSplitterChain(Rs: number[]): CMat {
  const m = Rs.length + 1;
  let U = identity(m);
  Rs.forEach((R, k) => {
    U = matMul(embed2(beamSplitter(R), m, k), U);
  });
  return U;
}

/** The largest |(U†U − I)_ij| and where it is (0-based). */
export function unitarityDeviation(U: CMat): { dev: number; i: number; j: number } {
  const G = matMul(matDagger(U), U);
  let dev = 0, bi = 0, bj = 0;
  for (let i = 0; i < G.length; i++)
    for (let j = 0; j < G.length; j++) {
      const d = Math.sqrt(cAbs2(cSub(G[i][j], i === j ? cx(1) : cx(0))));
      if (d > dev) {
        dev = d;
        bi = i;
        bj = j;
      }
    }
  return { dev, i: bi, j: bj };
}

/** The unitarity tolerance on |U†U − I|: a matrix typed to four decimals (0.7071) fails it; 1/sqrt(2) passes. */
export const UNITARY_TOL = 1e-6;

/**
 * A square complex matrix typed one row per line (or rows separated by ";"), entries separated by commas (or tabs,
 * or — when a row has neither — whitespace). Each entry is read by the quantum core's one complex reader
 * (parseComplex: 0.5, 0.5i, 1/sqrt(2), i/sqrt(3), e^(2πi/3)). Plain-number readers (dataBlock.ts) cannot read these
 * entries, which is why this is not readDataBlock.
 */
export function readComplexMatrix(text: string, maxDim = MAX_MODES): { U: CMat } | { error: string } {
  const src = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!src) return { error: "No matrix was typed. Write one row per line, entries separated by commas: 1/sqrt(2), i/sqrt(2)." };
  const rowsText = src.split(/\n|;/).map((r) => r.trim()).filter((r) => r);
  if (rowsText.length > maxDim) return { error: `${rowsText.length} rows: at most ${maxDim} modes.` };
  const anyTab = rowsText.some((r) => r.includes("\t"));
  const anyComma = rowsText.some((r) => r.includes(","));
  const U: CMat = [];
  for (let i = 0; i < rowsText.length; i++) {
    const cells = (anyTab ? rowsText[i].split("\t") : anyComma ? rowsText[i].split(",") : rowsText[i].split(/\s+/)).map((c) => c.trim());
    if (cells.length > maxDim) return { error: `Row ${i + 1} has ${cells.length} entries: at most ${maxDim} modes.` };
    const row: Cx[] = [];
    for (let j = 0; j < cells.length; j++) {
      if (!cells[j]) return { error: `Row ${i + 1}, entry ${j + 1} is empty.` };
      const z = parseComplex(cells[j]);
      if ("error" in z) return { error: `Row ${i + 1}, entry ${j + 1}: ${z.error === "empty" ? "empty" : z.error}` };
      row.push(z);
    }
    U.push(row);
  }
  const m = U.length;
  const bad = U.findIndex((r) => r.length !== m);
  if (bad >= 0) return { error: `The matrix must be square: ${m} rows, but row ${bad + 1} has ${U[bad].length} entries.` };
  if (m < 2) return { error: "A linear network needs at least 2 modes." };
  return { U };
}

// ---------------------------------------------------------------------------------------------------------------
// Dual-rail qubits and the probabilistic two-qubit gates
// ---------------------------------------------------------------------------------------------------------------

export interface DualRail {
  /** The polarisation state after the elements, normalised: α|H⟩ + β|V⟩. */
  out: [Cx, Cx];
  /** The fraction that passed the elements (1 unless a polariser is in the train). */
  transmitted: number;
  /** After a polarising beam splitter (H transmitted to rail 0, V reflected to rail 1): P(rail 0), P(rail 1). */
  rail: [number, number];
}

/**
 * A polarisation qubit (|H⟩ = |0⟩, |V⟩ = |1⟩) through wave plates (jones.ts, its exp(−iωt) and fast-axis
 * conventions), then a polarising beam splitter that maps it onto the dual-rail qubit α|1,0⟩ + β|0,1⟩.
 * Null when the input is zero or everything is blocked.
 */
export function dualRail(input: [Cx, Cx], elements: JonesElement[]): DualRail | null {
  const res = propagate(input as unknown as JonesVec, elements);
  if (!res) return null;
  const t = res.transmitted;
  if (!(t > 1e-24)) return null;
  const k = 1 / Math.sqrt(t);
  const out: [Cx, Cx] = [cx(res.output[0].re * k, res.output[0].im * k), cx(res.output[1].re * k, res.output[1].im * k)];
  const p0 = cAbs2(out[0]);
  return { out, transmitted: t, rail: [p0, 1 - p0] };
}

export interface GateSpec {
  key: "post" | "klm";
  name: string;
  /** Ideal success probability. */
  p0: number;
  p0Text: string;
  /** Photons that must be detected for the gate to succeed (each at efficiency η = T·η_d). */
  k: number;
  what: string;
  cite: string;
}

/**
 * The two cited probabilistic CZ gates. Each value was checked against the paper's own text (arXiv TeX source, read
 * 2026-10-23):
 *   - 1/9, post-selected: H. F. Hofmann & S. Takeuchi, Phys. Rev. A 66, 024308 (2002), arXiv:quant-ph/0111092 —
 *     "the attenuation factor of 1/3 indicates an efficiency of 1/9 for the post-selected gate operation" (a CZ with
 *     beam splitters of reflectivity 1/3); and T. C. Ralph, N. K. Langford, T. B. Bell & A. G. White, Phys. Rev. A
 *     65, 062324 (2002), arXiv:quant-ph/0112088 — the coincidence-basis CNOT (a CZ between Hadamards on the target)
 *     "occurring with probability one ninth". Both destroy the photons: success is a two-fold coincidence (k = 2).
 *   - 1/16, heralded: E. Knill, R. Laflamme & G. J. Milburn, Nature 409, 46 (2001), arXiv:quant-ph/0006088, section
 *     "Non-deterministic quantum computation" — the conditional sign flip from two NS₁ gates, each "with probability
 *     1/4", "has the desired effect with probability 1/16". Each NS₁ uses one ancilla photon and is heralded by
 *     detecting one photon in its ancilla modes (k = 2). Hofmann & Takeuchi also quote "the efficiency of 1/16
 *     obtained in previous proposals".
 */
export const LO_GATES: GateSpec[] = [
  {
    key: "post",
    name: "Post-selected linear-optics CZ",
    p0: 1 / 9,
    p0Text: "1/9",
    k: 2,
    what: "post-selected on one photon in each qubit's rails (a two-fold coincidence); destructive: the photons are detected",
    cite: "Hofmann & Takeuchi, Phys. Rev. A 66, 024308 (2002); Ralph, Langford, Bell & White, Phys. Rev. A 65, 062324 (2002) (as a coincidence-basis CNOT)",
  },
  {
    key: "klm",
    name: "KLM heralded CZ (two NS₁ gates)",
    p0: 1 / 16,
    p0Text: "1/16",
    k: 2,
    what: "heralded by one ancilla detection per NS₁ gate (two ancilla photons, photon-number-resolving detectors); the qubit photons pass on",
    cite: "Knill, Laflamme & Milburn, Nature 409, 46 (2001) (arXiv:quant-ph/0006088)",
  },
];

export interface GateRate {
  /** Per-attempt success probability p₀·η^k. */
  p: number;
  /** Expected successes in N attempts. */
  expected: number;
  /** P(at least one success in N). */
  atLeastOne: number;
  /** P(no success in N) = (1 − p)ᴺ, kept separately: 1 − 10⁻⁴¹ is 1 in double precision. */
  none: number;
  /** Mean attempts per success, 1/p. */
  meanAttempts: number;
}

/** Success for N attempts at per-photon efficiency η (each of the gate's k detected photons). */
export function gateRate(g: GateSpec, eta: number, N: number): GateRate {
  const p = g.p0 * eta ** g.k;
  const lnNone = p >= 1 ? -Infinity : p <= 0 ? 0 : N * Math.log1p(-p);
  return { p, expected: N * p, atLeastOne: -Math.expm1(lnNone), none: Math.exp(lnNone), meanAttempts: p > 0 ? 1 / p : Infinity };
}
