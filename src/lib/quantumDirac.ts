// Release Q, parts Q1 + Q3: Dirac linear algebra (states, operators, the Born rule) and entanglement / density matrices.
// Built on quantumCore.ts (complex numbers, states, gates, the Dirac reader, exact display) — nothing here repeats it —
// and on linalg.ts's Jacobi eigen-solver (a complex Hermitian matrix is diagonalised through its real symmetric
// embedding). quantum.ts's closed forms (pureTwoQubit, wernerState) are the cross-checks for two-qubit entanglement.
//
// API
//   Reading:   withDegrees(text) · readState(text, dimText?) · readOperator(text) · readDensity(text)
//   Display:   fmtVec(state, dim, qubits) · levelLabel(k, dim, qubits)
//   Algebra:   inner(φ, ψ) = ⟨φ|ψ⟩ · outer(ψ, φ) = |ψ⟩⟨φ| · commutator · anticommutator · trace · expectation · variance
//              isHermitian · isNormal · isProjector · matAdd · matSub
//   Eigen:     eigHermitian(A) → { values (ascending), vectors, clusters } · eigNormal(A) · eigGeneral2(A)
//   Born rule: measureInBasis(ψ, basis) · measureObservable(ψ, A) · measureQubitInBasis(ψ, n, q, "Z"|"X"|"Y")
//   Density:   densityOf(ψ) · checkDensity(ρ) · vonNeumannBits(eigs) · fidelity(ρ, σ) · traceDistance(ρ, σ) · blochOf(ρ)
//   Bipartite: partialTrace(ρ, dA, dB, keep) · partialTranspose(ρ, dA, dB) · schmidt(ψ, dA, dB) · concurrence(ρ)
//              negativity(ρ, dA, dB) · wernerRho(p) · bellDiagonalRho(λ)
//
// CONVENTIONS (stated in the results that use them): qubits big-endian (quantumCore); ⟨φ|ψ⟩ is conjugate-linear in
// the FIRST slot; eigenvectors are shown with their first non-zero component real and positive; fidelity is the
// squared (Jozsa) fidelity F = (tr √(√ρ σ √ρ))², so F(|0⟩, |+⟩) = ½; entropies are in bits (log₂).
//
// Every input is refused (an { error }) rather than computed on when it is non-finite, the wrong size, or outside the
// caps: operators and density matrices ≤ 16 × 16 (the Jacobi embedding is then 32 × 32, a fixed work bound), states
// ≤ 1024 amplitudes (10 qubits, quantumCore's cap).

import {
  C0,
  C1,
  GATES,
  MAX_QUBITS,
  SWAP4,
  ZERO_TOL,
  applyGate,
  cAbs,
  cAbs2,
  cAdd,
  cConj,
  cDiv,
  cExpI,
  cMul,
  cScale,
  cSub,
  cx,
  fmtState,
  identity,
  kron,
  matDagger,
  matMul,
  matScale,
  matVec,
  measureQubit,
  normalise,
  parseComplex,
  parseKet,
  trimNum,
  type CMat,
  type Cx,
  type State,
} from "./quantumCore";
import { singleGate } from "./quantumCircuits";
import { BELL_STATES } from "./quantum";
import { eigenSymmetric } from "./linalg";
import { readDataBlock } from "./dataBlock";

/** Operators, density matrices and observables: at most 16 × 16. */
export const DIRAC_MAX_DIM = 16;
/** States: at most 1024 amplitudes (10 qubits). */
export const STATE_MAX_DIM = 1 << MAX_QUBITS;

const finite = (z: Cx): boolean => Number.isFinite(z.re) && Number.isFinite(z.im);

// ---------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------

/**
 * Degrees inside a coefficient: "cos(20°)" → "cos((20*pi/180))". Applied to a whole state or operator text before the
 * one coefficient reader (parseComplex) sees it; parseAngle is not involved (it strips its own trailing °).
 */
export const withDegrees = (text: string): string =>
  (text ?? "").replace(/(\d+(?:\.\d+)?|\.\d+)\s*(?:°|\bdeg\b)/g, (_m, n: string, off: number, all: string) =>
    // "e^(i30°)": a product sign after a letter, digit or bracket, so i(…) is never read as a function call.
    `${off > 0 && /[A-Za-z0-9)π]/.test(all[off - 1]) ? "*" : ""}(${n}*pi/180)`);

/** Splits at top-level commas (brackets balanced). */
function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export interface QVec {
  state: State;
  dim: number;
  /** The number of qubits when the state is a qubit register (dim = 2ⁿ, read from 0/1 labels); null for a qudit. */
  qubits: number | null;
  norm2: number;
  notes: string[];
}

const isPow2 = (d: number): boolean => d >= 2 && (d & (d - 1)) === 0;

/**
 * A state: Dirac form over qubits (quantumCore.parseKet: 0/1 labels, |+⟩ |−⟩ |i⟩ |−i⟩, Bell states), or — with a
 * dimension d from 2 to 16 given — over the levels |0⟩ … |d−1⟩ of one d-level system, or an amplitude list
 * "(a, b, c)". A d-level Dirac sum is read by the same reader: each level k is relabelled as a bit string first, so
 * coefficients, signs, normalisation and refusals are parseKet's own.
 */
export function readState(text: string, dimText = ""): QVec | { error: string } {
  const src = withDegrees((text ?? "").trim());
  const dt = (dimText ?? "").trim().toLowerCase();
  let dim: number | null = null;
  if (dt && dt !== "auto" && dt !== "qubits") {
    if (!/^\d+$/.test(dt)) return { error: `The dimension must be "auto" (qubits) or a whole number from 2 to ${DIRAC_MAX_DIM} ("${dimText.trim()}" given).` };
    dim = Number(dt);
    if (dim < 2 || dim > DIRAC_MAX_DIM) return { error: `The dimension must be from 2 to ${DIRAC_MAX_DIM}; ${dim} is outside.` };
  }
  if (!src) return { error: "No state was typed. Write it in Dirac form, e.g. 0.6|0⟩ + 0.8i|1⟩." };
  // An amplitude list: (a, b, …) or [a, b, …] with no ket in it.
  if (!/[|⟩〉]/.test(src) && /^[([].*[)\]]$/s.test(src)) {
    const cells = splitTop(src.slice(1, -1));
    if (cells.length < 2) return { error: "An amplitude list needs at least two entries, e.g. (0.6, 0.8i)." };
    if (cells.length > STATE_MAX_DIM) return { error: `At most ${STATE_MAX_DIM} amplitudes can be read.` };
    if (dim && cells.length !== dim) return { error: `The amplitude list has ${cells.length} entries but the dimension is ${dim}.` };
    const amps: Cx[] = [];
    for (let k = 0; k < cells.length; k++) {
      const z = parseComplex(cells[k]);
      if ("error" in z) return { error: `Amplitude ${k + 1}: ${z.error === "empty" ? "it is empty" : z.error}` };
      amps.push(z);
    }
    const nz = normalise(amps);
    if (!nz) return { error: "The state is zero (or not finite): it cannot be normalised." };
    const notes: string[] = [];
    if (Math.abs(nz.norm2 - 1) > 1e-9) notes.push(`The state as typed has ‖ψ‖² = ${fmtNum(nz.norm2)}, not 1; it was normalised.`);
    const d = cells.length;
    return { state: nz.state, dim: d, qubits: isPow2(d) && !dim ? Math.log2(d) : null, norm2: nz.norm2, notes };
  }
  if (dim === null) {
    const k = parseKet(src);
    if ("error" in k) return k;
    return { state: k.state, dim: 1 << k.n, qubits: k.n, norm2: k.norm2, notes: k.notes };
  }
  // A d-level system: integer labels 0 … d−1 (|+⟩, |−⟩, |i⟩, |−i⟩ only when d = 2).
  const bits = Math.max(1, Math.ceil(Math.log2(dim)));
  let bad: string | null = null;
  const relabelled = src.replace(/\|([^|⟩〉>]*)([⟩〉>])/g, (m, lab: string, close: string) => {
    const l = lab.replace(/\s+/g, "");
    if (/^\d+$/.test(l)) {
      const v = Number(l);
      // A level is its number as written: |00⟩ is a two-qubit label, never level 0.
      if (l !== String(v)) {
        bad ??= `|${l}⟩ is not a level number of a ${dim}-level system (write |${v}⟩, or leave the dimension on auto for qubits).`;
        return m;
      }
      if (v >= dim!) bad ??= `|${l}⟩ is not a level of a ${dim}-level system (levels 0 to ${dim! - 1}).`;
      return `|${v.toString(2).padStart(bits, "0")}${close}`;
    }
    if (dim === 2) return m;
    bad ??= `|${lab.trim()}⟩: a ${dim}-level state is written with the level numbers |0⟩ … |${dim! - 1}⟩.`;
    return m;
  });
  if (bad) return { error: bad };
  const k = parseKet(relabelled);
  if ("error" in k) return { error: k.error.replace(/\|([01]+)⟩/g, (_m, b: string) => `|${parseInt(b, 2)}⟩`) };
  return { state: k.state.slice(0, dim), dim, qubits: dim === 2 ? 1 : null, norm2: k.norm2, notes: k.notes };
}

/** Six significant figures, U+2212, ×10ⁿ outside 10⁻³…10⁵ (quantumCore.trimNum). */
const fmtNum = (v: number): string => trimNum(v);

// --- operators ---------------------------------------------------------------------------------------------------

type Val = { s: Cx } | { m: CMat };

interface Tok {
  t: "num" | "name" | "ketbra" | "op" | "(" | ")" | "[" | "]" | "{" | "}" | "," | "dag";
  v: string;
  args?: string | null;
  bra?: string;
}

const NAMED_OPS: Record<string, CMat> = {
  "σx": GATES.X, "σy": GATES.Y, "σz": GATES.Z, "σ_x": GATES.X, "σ_y": GATES.Y, "σ_z": GATES.Z,
  "σ₁": GATES.X, "σ₂": GATES.Y, "σ₃": GATES.Z,
  CNOT: [[C1, C0, C0, C0], [C0, C1, C0, C0], [C0, C0, C0, C1], [C0, C0, C1, C0]],
  CX: [[C1, C0, C0, C0], [C0, C1, C0, C0], [C0, C0, C0, C1], [C0, C0, C1, C0]],
  CZ: [[C1, C0, C0, C0], [C0, C1, C0, C0], [C0, C0, C1, C0], [C0, C0, C0, cx(-1)]],
  SWAP: SWAP4,
};
/** Names singleGate reads (case-sensitive here, so "s" or "x" is not silently the S or X gate). */
const GATE_WORDS = /^(I|X|Y|Z|H|S|T|SX|Sdg|Tdg|S†|T†|√X|Rx|Ry|Rz|P|U|U3)$/;
const SCALAR_FUNCS: Record<string, (z: Cx) => Cx> = {
  sqrt: (z) => {
    const r = Math.sqrt(cAbs(z)), t = Math.atan2(z.im, z.re) / 2;
    return { re: r * Math.cos(t), im: r * Math.sin(t) };
  },
  exp: (z) => cScale(cExpI(z.im), Math.exp(z.re)),
  cos: (z) => ({ re: Math.cos(z.re) * Math.cosh(z.im), im: -Math.sin(z.re) * Math.sinh(z.im) }),
  sin: (z) => ({ re: Math.sin(z.re) * Math.cosh(z.im), im: Math.cos(z.re) * Math.sinh(z.im) }),
};

/** The most tokens an operator expression may hold (the work bound). */
const OP_MAX_TOKENS = 400;

function tokenizeOp(src: string): Tok[] | { error: string } {
  const s = src.replace(/[−–]/g, "-").replace(/\s*\(x\)\s*/g, "⊗").replace(/\botimes\b/g, "⊗");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    if (out.length > OP_MAX_TOKENS) return { error: `The expression is too long (more than ${OP_MAX_TOKENS} symbols).` };
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = s.slice(i);
    // A ket-bra |a⟩⟨b| (closing ⟩ 〉 >, opening ⟨ 〈 <).
    const kb = /^\|([^|⟩〉>]*)[⟩〉>]\s*[⟨〈<]([^|⟨〈<]*)\|/.exec(rest);
    if (kb) { out.push({ t: "ketbra", v: kb[1].trim(), bra: kb[2].trim() }); i += kb[0].length; continue; }
    if (ch === "|" || ch === "⟨" || ch === "〈") {
      return { error: "A ket or a bra on its own is a state, not an operator: write an outer product as |a⟩⟨b| (e.g. |0⟩⟨0|), or use the state tool." };
    }
    const num = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) { out.push({ t: "num", v: num[0] }); i += num[0].length; continue; }
    // "2iZ" is 2·i·Z: a lone i before anything but a lower-case letter is the imaginary unit.
    const nm = /^i(?![a-z])/.test(rest) ? ["i"] : /^(σ(?:_?[xyz]|[₁₂₃])|√X|[A-Za-zπ][A-Za-z0-9]*(?:†)?)/.exec(rest);
    if (nm) {
      let j = i + nm[0].length;
      let args: string | null = null;
      if (s[j] === "(" && /^(Rx|Ry|Rz|P|U|U3)$/.test(nm[0])) {
        let depth = 0, k = j;
        for (; k < s.length; k++) {
          if (s[k] === "(") depth++;
          else if (s[k] === ")" && --depth === 0) break;
        }
        if (k >= s.length) return { error: `"${s.slice(i)}" has an unclosed bracket.` };
        args = s.slice(j + 1, k);
        j = k + 1;
      }
      out.push({ t: "name", v: nm[0], args });
      i = j;
      continue;
    }
    if (ch === "†" || ch === "'") { out.push({ t: "dag", v: "†" }); i++; continue; }
    if ("()[]{},".includes(ch)) { out.push({ t: ch as Tok["t"], v: ch }); i++; continue; }
    if ("+-*·/⊗^×".includes(ch)) { out.push({ t: "op", v: ch === "×" || ch === "·" ? "*" : ch }); i++; continue; }
    return { error: `Unexpected "${ch}" in the operator expression (position ${i + 1}).` };
  }
  return out;
}

const dimOf = (v: Val): number => ("m" in v ? v.m.length : 0);

export function matAdd(a: CMat, b: CMat): CMat {
  return a.map((row, i) => row.map((z, j) => cAdd(z, b[i][j])));
}
export function matSub(a: CMat, b: CMat): CMat {
  return a.map((row, i) => row.map((z, j) => cSub(z, b[i][j])));
}

/** A small recursive-descent reader for operator expressions; every refusal is thrown as an Error and caught once. */
class OpParser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.p]; }
  parse(): Val {
    const v = this.sum();
    if (this.p < this.toks.length) throw new Error(`Unexpected "${this.toks[this.p].v}" (symbol ${this.p + 1}).`);
    return v;
  }
  // sum := tensor (± tensor)*
  private sum(): Val {
    let v = this.tensor();
    for (let t = this.peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = this.peek()) {
      this.p++;
      const w = this.tensor();
      v = addVals(v, w, t.v === "-");
    }
    return v;
  }
  // tensor := product (⊗ product)*
  private tensor(): Val {
    let v = this.product();
    while (this.peek()?.t === "op" && this.peek()!.v === "⊗") {
      this.p++;
      const w = this.product();
      if ("s" in v || "s" in w) v = mulVals(v, w);
      else {
        const d = v.m.length * w.m.length;
        if (d > DIRAC_MAX_DIM) throw new Error(`The tensor product would be ${d} × ${d}; operators are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}.`);
        v = { m: kron(v.m, w.m) };
      }
    }
    return v;
  }
  // product := unary ((* | / | juxtaposition) unary)*
  private product(): Val {
    let v = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && t.v === "*") { this.p++; v = mulVals(v, this.unary()); continue; }
      if (t?.t === "op" && t.v === "/") {
        this.p++;
        const w = this.unary();
        if (!("s" in w)) throw new Error("Division is by a number only (an operator has no quotient here): write (I + Z)/2.");
        if (cAbs(w.s) === 0) throw new Error("Division by zero.");
        v = "s" in v ? { s: cDiv(v.s, w.s) } : { m: v.m.map((r) => r.map((z) => cDiv(z, w.s))) };
        continue;
      }
      if (t && (t.t === "num" || t.t === "name" || t.t === "ketbra" || t.t === "(" || t.t === "[" || t.t === "{")) { v = mulVals(v, this.unary()); continue; }
      return v;
    }
  }
  private unary(): Val {
    const t = this.peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      this.p++;
      const v = this.unary();
      return t.v === "-" ? negVal(v) : v;
    }
    return this.power();
  }
  // power := atom († | ^ exponent)*
  private power(): Val {
    let v = this.atom();
    for (;;) {
      const t = this.peek();
      if (t?.t === "dag") { this.p++; v = daggerVal(v); continue; }
      if (t?.t === "op" && t.v === "^") {
        this.p++;
        const n = this.peek();
        if (n?.t === "dag") { this.p++; v = daggerVal(v); continue; }
        if (n?.t === "name" && /^(dagger|dag)$/.test(n.v)) { this.p++; v = daggerVal(v); continue; }
        const e = this.unaryExponent();
        if ("m" in e) throw new Error("An exponent must be a number.");
        if ("m" in v) {
          const k = e.s.re;
          if (Math.abs(e.s.im) > 0 || !Number.isInteger(k) || k < 0 || k > 64)
            throw new Error("An operator power must be a whole number from 0 to 64 (A^2); use the scalar functions for anything else.");
          let r = identity(v.m.length);
          for (let q = 0; q < k; q++) r = matMul(r, v.m);
          v = { m: r };
        } else v = { s: cpow(v.s, e.s) };
        continue;
      }
      return v;
    }
  }
  private unaryExponent(): Val {
    const t = this.peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      this.p++;
      const v = this.unaryExponent();
      return t.v === "-" ? negVal(v) : v;
    }
    return this.atom();
  }
  private atom(): Val {
    const t = this.peek();
    if (!t) throw new Error("The expression ends too early.");
    this.p++;
    if (t.t === "num") {
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new Error(`"${t.v}" is not a finite number.`);
      return { s: cx(v) };
    }
    if (t.t === "(") {
      const v = this.sum();
      this.expectTok(")");
      return v;
    }
    if (t.t === "[" || t.t === "{") {
      // [A, B] = AB − BA, {A, B} = AB + BA.
      const a = this.sum();
      this.expectTok(",");
      const b = this.sum();
      this.expectTok(t.t === "[" ? "]" : "}");
      if (!("m" in a) || !("m" in b)) throw new Error(`${t.t === "[" ? "[A, B]" : "{A, B}"} takes two operators.`);
      if (a.m.length !== b.m.length) throw new Error(`The two operators are ${a.m.length} × ${a.m.length} and ${b.m.length} × ${b.m.length}: they must be the same size.`);
      const ab = matMul(a.m, b.m), ba = matMul(b.m, a.m);
      return { m: t.t === "[" ? matSub(ab, ba) : matAdd(ab, ba) };
    }
    if (t.t === "ketbra") return { m: ketBra(t.v, t.bra ?? "") };
    if (t.t === "name") return this.name(t);
    throw new Error(`Unexpected "${t.v}".`);
  }
  private name(t: Tok): Val {
    const v = t.v;
    if (v === "i") return { s: cx(0, 1) };
    if (v === "pi" || v === "π") return { s: cx(Math.PI) };
    if (v === "e") return { s: cx(Math.E) };
    if (SCALAR_FUNCS[v]) {
      this.expectTok("(");
      const a = this.sum();
      this.expectTok(")");
      if (!("s" in a)) throw new Error(`${v}( ) takes a number, not an operator.`);
      const r = SCALAR_FUNCS[v](a.s);
      if (!finite(r)) throw new Error(`${v}( ) of that value is not finite.`);
      return { s: r };
    }
    if (NAMED_OPS[v]) return { m: NAMED_OPS[v] };
    const base = v.replace(/†$/, "");
    if (GATE_WORDS.test(base) || GATE_WORDS.test(v)) {
      const g = singleGate(GATE_WORDS.test(v) ? v : base, t.args ?? null);
      if ("error" in g) throw new Error(g.error);
      return v.endsWith("†") && !GATE_WORDS.test(v) ? { m: matDagger(g.U) } : { m: g.U };
    }
    throw new Error(
      `"${v}" is not an operator this reader knows. Use I X Y Z H S T S† T† √X Rx(θ) Ry(θ) Rz(θ) P(φ), σx σy σz, CNOT CZ SWAP, ` +
        `outer products |a⟩⟨b|, numbers (0.5, i, sqrt(2), pi), + − * / ⊗ † and brackets; write products with a space or * (X*Z, not XZ).`,
    );
  }
  private expectTok(type: Tok["t"]): void {
    const t = this.peek();
    if (!t || t.t !== type) throw new Error(`Expected "${type}" ${t ? `but found "${t.v}"` : "before the end"}.`);
    this.p++;
  }
}

function cpow(a: Cx, b: Cx): Cx {
  if (cAbs(a) === 0) return cAbs(b) === 0 ? C1 : C0;
  const lr = Math.log(cAbs(a)), th = Math.atan2(a.im, a.re);
  const re = b.re * lr - b.im * th, im = b.re * th + b.im * lr;
  const r = cScale(cExpI(im), Math.exp(re));
  if (!finite(r)) throw new Error("A power is not finite.");
  return r;
}
const negVal = (v: Val): Val => ("s" in v ? { s: cScale(v.s, -1) } : { m: matScale(v.m, cx(-1)) });
const daggerVal = (v: Val): Val => ("s" in v ? { s: cConj(v.s) } : { m: matDagger(v.m) });
function addVals(a: Val, b: Val, minus: boolean): Val {
  const bb = minus ? negVal(b) : b;
  if ("s" in a && "s" in bb) return { s: cAdd(a.s, bb.s) };
  if ("m" in a && "m" in bb) {
    if (a.m.length !== bb.m.length) throw new Error(`Cannot add a ${a.m.length} × ${a.m.length} operator and a ${bb.m.length} × ${bb.m.length} one: the sizes differ.`);
    return { m: matAdd(a.m, bb.m) };
  }
  throw new Error("A number and an operator cannot be added: write the number times the identity (0.5*I + Z, not 0.5 + Z).");
}
function mulVals(a: Val, b: Val): Val {
  if ("s" in a && "s" in b) return { s: cMul(a.s, b.s) };
  if ("s" in a && "m" in b) return { m: matScale(b.m, a.s) };
  if ("m" in a && "s" in b) return { m: matScale(a.m, b.s) };
  const A = (a as { m: CMat }).m, B = (b as { m: CMat }).m;
  if (A.length !== B.length) throw new Error(`Cannot multiply a ${A.length} × ${A.length} operator by a ${B.length} × ${B.length} one: the sizes differ (did you mean ⊗?).`);
  return { m: matMul(A, B) };
}

/** |a⟩⟨b| from two labels the Dirac reader knows. */
function ketBra(a: string, b: string): CMat {
  const ka = parseKet(`|${a}⟩`), kb = parseKet(`|${b}⟩`);
  if ("error" in ka) throw new Error(ka.error);
  if ("error" in kb) throw new Error(kb.error.replace(/\|([^⟩]*)⟩ is/, "⟨$1| is"));
  if (ka.n !== kb.n) throw new Error(`|${a}⟩⟨${b}| joins a ${ka.n}-qubit ket to a ${kb.n}-qubit bra.`);
  if (1 << ka.n > DIRAC_MAX_DIM) throw new Error(`|${a}⟩⟨${b}| is ${1 << ka.n} × ${1 << ka.n}; operators are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}.`);
  return outer(ka.state, kb.state);
}

/** True when the text is a matrix written out (rows), not an expression. */
const looksLikeMatrix = (s: string): boolean =>
  /^\[\s*\[/.test(s) || /;/.test(s) || (/\n/.test(s.trim()) && (/,|\t/.test(s) || /^[\s\d.eE+\-−]+$/.test(s)));

/** A matrix typed as [[a, b], [c, d]], "a, b; c, d" or one row per line; each cell through parseComplex. */
function readMatrixLiteral(src: string): CMat | { error: string } {
  let body = src.trim();
  let rows: string[];
  if (/^\[\s*\[/.test(body)) {
    if (!/\]\s*\]$/.test(body)) return { error: "The matrix [[…], […]] is not closed with ]]." };
    body = body.replace(/^\[\s*\[/, "").replace(/\]\s*\]$/, "");
    rows = body.split(/\]\s*[,;]?\s*\[/);
  } else {
    body = body.replace(/^\[/, "").replace(/\]$/, "");
    rows = body.split(/;|\r?\n/).filter((r) => r.trim());
  }
  // A real matrix pasted as plain numbers (tabs, spaces) is read by the ONE number reader.
  if (!/[A-Za-zπ√()]/.test(body)) {
    const db = readDataBlock(rows.join("\n"), "matrix", { maxRows: DIRAC_MAX_DIM });
    if (!db.ok) return { error: db.error };
    if (db.header) return { error: "The matrix has a header row; type numbers only." };
    if (db.rows.some((r) => r.some((x) => x === null))) return { error: "The matrix has an empty or missing entry." };
    return db.rows.map((r) => (r as number[]).map((x) => cx(x)));
  }
  if (rows.length > DIRAC_MAX_DIM) return { error: `Operators are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}; ${rows.length} rows were typed.` };
  const M: CMat = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = splitTop(rows[i]).filter((c, k, all) => c !== "" || k < all.length - 1);
    const row: Cx[] = [];
    for (let j = 0; j < cells.length; j++) {
      const z = parseComplex(cells[j]);
      if ("error" in z) return { error: `Row ${i + 1}, column ${j + 1}: ${z.error === "empty" ? "the entry is empty" : z.error}` };
      row.push(z);
    }
    M.push(row);
  }
  return M;
}

export interface OpRead {
  M: CMat;
  dim: number;
  /** How the operator was read: "matrix" or "expression". */
  form: "matrix" | "expression";
}

/**
 * An operator: a matrix written out ([[2, 1−i], [1+i, 3]], rows by ; or by line) or an expression in named operators
 * (X⊗Z, 0.5*(I + Z), [X, Y], H S H†, 0.7|0⟩⟨0| + 0.3|+⟩⟨+|). Square, 2 × 2 to 16 × 16, finite.
 */
export function readOperator(text: string): OpRead | { error: string } {
  const src = withDegrees((text ?? "").trim());
  if (!src) return { error: "No operator was typed. Type a matrix ([[0, 1], [1, 0]]) or an expression (X⊗Z, 0.5*(I + Z))." };
  let M: CMat;
  let form: OpRead["form"];
  if (looksLikeMatrix(src)) {
    const r = readMatrixLiteral(src);
    if ("error" in r) return r;
    M = r;
    form = "matrix";
  } else {
    const toks = tokenizeOp(src);
    if ("error" in toks) return toks;
    if (!toks.length) return { error: "No operator was typed." };
    try {
      const v = new OpParser(toks).parse();
      if ("s" in v) return { error: "That is a number, not an operator: multiply it by an operator (e.g. 2*I)." };
      M = v.m;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    form = "expression";
  }
  const d = M.length;
  if (d < 2) return { error: "An operator must be at least 2 × 2." };
  if (d > DIRAC_MAX_DIM) return { error: `Operators are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}; this one is ${d} × ${d}.` };
  const bad = M.findIndex((r) => r.length !== d);
  if (bad >= 0) return { error: `The matrix is not square: row ${bad + 1} has ${M[bad].length} entries and there are ${d} rows.` };
  if (!M.every((r) => r.every(finite))) return { error: "An entry is not a finite number." };
  return { M: M.map((r) => r.map((z) => ({ re: z.re === 0 ? 0 : z.re, im: z.im === 0 ? 0 : z.im }))), dim: d, form };
}

// ---------------------------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------------------------

/** The basis label of level k: a bit string for a qubit register, the level number for a d-level system. */
export const levelLabel = (k: number, dim: number, qubits: number | null): string =>
  qubits !== null ? k.toString(2).padStart(qubits, "0") : String(k);

/**
 * A state in Dirac form through quantumCore.fmtState (exact closed forms, common modulus, global phase stated). A
 * d-level state is padded to the next power of two and its bit-string labels written back as level numbers.
 */
export function fmtVec(state: State, dim: number, qubits: number | null): ReturnType<typeof fmtState> {
  if (qubits !== null) return fmtState(state, qubits);
  const n = Math.max(1, Math.ceil(Math.log2(dim)));
  const padded = Array.from({ length: 1 << n }, (_, k) => (k < dim ? state[k] : C0));
  const s = fmtState(padded, n);
  const re = new RegExp(`\\|([01]{${n}})⟩`, "g");
  const rm = new RegExp(`ket\\(([01]{${n}})\\)`, "g");
  return {
    ...s,
    text: s.text.replace(re, (_m, b: string) => `|${parseInt(b, 2)}⟩`),
    math: s.math.replace(rm, (_m, b: string) => `ket(${parseInt(b, 2)})`),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Algebra
// ---------------------------------------------------------------------------------------------------------------

/** ⟨φ|ψ⟩ = Σ φₖ* ψₖ (conjugate-linear in the first slot). */
export function inner(phi: State, psi: State): Cx {
  let re = 0, im = 0;
  for (let k = 0; k < phi.length; k++) {
    const a = phi[k], b = psi[k];
    re += a.re * b.re + a.im * b.im;
    im += a.re * b.im - a.im * b.re;
  }
  return { re, im };
}

/** |ψ⟩⟨φ|: the matrix ψᵢ φⱼ*. */
export function outer(psi: State, phi: State): CMat {
  // An outer product is a matrix: at most 16 × 16 here (a 10⁴-amplitude list would be 10⁸ entries).
  if (!Array.isArray(psi) || !Array.isArray(phi) || psi.length > DIRAC_MAX_DIM || phi.length > DIRAC_MAX_DIM) throw new Error(`outer: at most ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}`);
  return psi.map((a) => phi.map((b) => cMul(a, cConj(b))));
}

export const commutator = (a: CMat, b: CMat): CMat => matSub(matMul(a, b), matMul(b, a));
export const anticommutator = (a: CMat, b: CMat): CMat => matAdd(matMul(a, b), matMul(b, a));

export function trace(a: CMat): Cx {
  let t = C0;
  for (let i = 0; i < a.length; i++) t = cAdd(t, a[i][i]);
  return t;
}

/** ⟨ψ|A|ψ⟩ (ψ normalised). */
export const expectation = (A: CMat, psi: State): Cx => inner(psi, matVec(A, psi));

/** Var A = ⟨A²⟩ − ⟨A⟩² for a Hermitian A (real), clamped at 0 against rounding. */
export function variance(A: CMat, psi: State): number {
  const Ap = matVec(A, psi);
  const a2 = inner(Ap, Ap).re; // ⟨ψ|A†A|ψ⟩ = ⟨A²⟩ for Hermitian A
  const a = expectation(A, psi).re;
  return Math.max(0, a2 - a * a);
}

const scaleOf = (A: CMat): number => Math.max(0, ...A.flat().map(cAbs));

/** Every matrix routine takes a square matrix of at most 16 × 16 (the work bound); anything else is thrown out. */
function checkSquare(A: CMat): void {
  if (!Array.isArray(A) || A.length < 1 || A.length > DIRAC_MAX_DIM || !A.every((r) => Array.isArray(r) && r.length === A.length))
    throw new Error(`matrix: square, at most ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}`);
}

export function isHermitian(A: CMat, tol = 1e-9): boolean {
  checkSquare(A);
  const s = Math.max(1, scaleOf(A));
  for (let i = 0; i < A.length; i++) for (let j = i; j < A.length; j++) if (cAbs(cSub(A[i][j], cConj(A[j][i]))) > tol * s) return false;
  return true;
}
export function isNormal(A: CMat, tol = 1e-9): boolean {
  checkSquare(A);
  const s = Math.max(1, scaleOf(A));
  const d = matSub(matMul(A, matDagger(A)), matMul(matDagger(A), A));
  return scaleOf(d) <= tol * s * s;
}
/** P² = P and P† = P. */
export const isProjector = (A: CMat, tol = 1e-9): boolean => isHermitian(A, tol) && scaleOf(matSub(matMul(A, A), A)) <= tol * Math.max(1, scaleOf(A));

// ---------------------------------------------------------------------------------------------------------------
// Eigen-decomposition
// ---------------------------------------------------------------------------------------------------------------

export interface HermEigen {
  /** Ascending. */
  values: number[];
  /** Orthonormal, aligned with values; first non-zero component real and positive. */
  vectors: State[];
  /** Index groups of equal eigenvalues (to 10⁻⁹ of the matrix scale), ascending. */
  clusters: number[][];
}

/** Rotates v so its first non-negligible component is real and positive. */
function fixPhase(v: State): State {
  const k = v.findIndex((z) => cAbs(z) > 1e-9);
  if (k < 0) return v;
  const ph = cScale(cConj(v[k]), 1 / cAbs(v[k]));
  return v.map((z) => cMul(z, ph));
}

/** Complex Gram–Schmidt: the next unit vector orthogonal to `basis`, or null when v lies in its span. */
function orthoNext(v: State, basis: State[]): State | null {
  let w = v.slice();
  for (let pass = 0; pass < 2; pass++)
    for (const b of basis) {
      const c = inner(b, w);
      w = w.map((z, k) => cSub(z, cMul(c, b[k])));
    }
  const n = Math.sqrt(w.reduce((s, z) => s + cAbs2(z), 0));
  if (n < 1e-6) return null;
  return w.map((z) => cScale(z, 1 / n));
}

/**
 * A complex Hermitian matrix diagonalised through its real symmetric embedding [[A, −B], [B, A]] (A + iB, linalg.ts
 * eigenSymmetric). Each eigenvalue appears twice there; every embedded eigenvector (x; y) maps to x + iy and the
 * complex eigenspace is rebuilt by Gram–Schmidt inside each cluster, so degenerate eigenspaces come out whole.
 * The matrix is scaled to unit size first (Jacobi's stopping test is absolute). null when it is not Hermitian.
 */
export function eigHermitian(A0: CMat): HermEigen | null {
  if (!isHermitian(A0)) return null;
  const n = A0.length;
  const s = scaleOf(A0);
  if (s === 0) {
    return { values: Array(n).fill(0), vectors: Array.from({ length: n }, (_, k) => Array.from({ length: n }, (_, j) => (j === k ? C1 : C0))), clusters: [Array.from({ length: n }, (_, k) => k)] };
  }
  const A = A0.map((r, i) => r.map((_, j) => cScale(cAdd(A0[i][j], cConj(A0[j][i])), 0.5 / s)));
  const R: number[][] = Array.from({ length: 2 * n }, () => Array(2 * n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      R[i][j] = A[i][j].re;
      R[i + n][j + n] = A[i][j].re;
      R[i][j + n] = -A[i][j].im;
      R[i + n][j] = A[i][j].im;
    }
  const e = eigenSymmetric(R);
  if (!e) return null;
  // Ascending order of the 2n embedded pairs.
  const idx = e.values.map((_, k) => k).sort((a, b) => e.values[a] - e.values[b]);
  const groups: number[][] = [];
  for (const k of idx) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(e.values[k] - e.values[g[g.length - 1]]) <= 1e-9) g.push(k);
    else groups.push([k]);
  }
  const values: number[] = [], vectors: State[] = [], clusters: number[][] = [];
  for (const g of groups) {
    const want = Math.round(g.length / 2);
    const got: State[] = [];
    for (const k of g) {
      if (got.length >= want) break;
      const z: State = Array.from({ length: n }, (_, i) => ({ re: e.vectors[i][k], im: e.vectors[i + n][k] }));
      const w = orthoNext(z, got);
      if (w) got.push(w);
    }
    if (got.length !== want) return null;
    const cl: number[] = [];
    for (const v of got) {
      const fv = fixPhase(v);
      cl.push(values.length);
      values.push(expectation(A0, fv).re);
      vectors.push(fv);
    }
    clusters.push(cl);
  }
  if (values.length !== n) return null;
  return { values, vectors, clusters };
}

export interface NormalEigen {
  values: Cx[];
  vectors: State[];
  clusters: number[][];
}

/**
 * A NORMAL matrix (A A† = A† A: Hermitian, unitary, …) has an orthonormal eigenbasis: the Hermitian part (A + A†)/2
 * is diagonalised, then the anti-Hermitian part (A − A†)/2i inside each of its eigenspaces. null when A is not normal.
 */
export function eigNormal(A: CMat): NormalEigen | null {
  if (!isNormal(A)) return null;
  const n = A.length;
  const Ad = matDagger(A);
  const H1 = A.map((r, i) => r.map((z, j) => cScale(cAdd(z, Ad[i][j]), 0.5)));
  const H2 = A.map((r, i) => r.map((z, j) => cMul(cSub(z, Ad[i][j]), cx(0, -0.5))));
  const e1 = eigHermitian(H1);
  if (!e1) return null;
  const vectors: State[] = [];
  for (const cl of e1.clusters) {
    const V = cl.map((k) => e1.vectors[k]);
    if (V.length === 1) {
      vectors.push(V[0]);
      continue;
    }
    const K: CMat = V.map((va) => V.map((vb) => inner(va, matVec(H2, vb))));
    const e2 = eigHermitian(K);
    if (!e2) return null;
    for (const w of e2.vectors) {
      const v: State = Array.from({ length: n }, (_, i) => w.reduce((s, c, b) => cAdd(s, cMul(c, V[b][i])), C0));
      vectors.push(fixPhase(v));
    }
  }
  const pairs = vectors.map((v) => ({ v, l: expectation(A, v) }));
  pairs.sort((a, b) => (Math.abs(a.l.re - b.l.re) > 1e-9 ? a.l.re - b.l.re : a.l.im - b.l.im));
  const values = pairs.map((p) => p.l);
  const clusters: number[][] = [];
  values.forEach((l, k) => {
    const g = clusters[clusters.length - 1];
    if (g && cAbs(cSub(l, values[g[0]])) <= 1e-9 * Math.max(1, scaleOf(A))) g.push(k);
    else clusters.push([k]);
  });
  return { values, vectors: pairs.map((p) => p.v), clusters };
}

/** The two eigenvalues of any 2 × 2 matrix, by the quadratic formula. */
export function eigGeneral2(A: CMat): [Cx, Cx] {
  const tr = cAdd(A[0][0], A[1][1]);
  const det = cSub(cMul(A[0][0], A[1][1]), cMul(A[0][1], A[1][0]));
  const disc = cSub(cMul(tr, tr), cScale(det, 4));
  const sq = SCALAR_FUNCS.sqrt(disc);
  const a = cScale(cSub(tr, sq), 0.5), b = cScale(cAdd(tr, sq), 0.5);
  return a.re < b.re || (a.re === b.re && a.im <= b.im) ? [a, b] : [b, a];
}

/** f(A) for a Hermitian A through its eigen-decomposition (√ρ, for fidelity and concurrence). */
function hermFunc(A: CMat, f: (x: number) => number): CMat | null {
  const e = eigHermitian(A);
  if (!e) return null;
  const n = A.length;
  const out: CMat = Array.from({ length: n }, () => Array.from({ length: n }, () => C0));
  e.vectors.forEach((v, k) => {
    const fl = f(e.values[k]);
    if (fl === 0) return;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i][j] = cAdd(out[i][j], cScale(cMul(v[i], cConj(v[j])), fl));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The Born rule
// ---------------------------------------------------------------------------------------------------------------

export interface Outcome {
  label: string;
  prob: number;
  /** The renormalised post-measurement state; null when the probability is 0. */
  post: State | null;
  /** The eigenvalue for an observable outcome. */
  value?: number;
}

/**
 * A measurement in an orthonormal set (checked): P(k) = |⟨bₖ|ψ⟩|², post-state |bₖ⟩. When the set is not complete the
 * remaining probability is its own outcome ("none of the listed"), with the renormalised residual as post-state.
 */
export function measureInBasis(psi: State, basis: { label: string; v: State }[]): Outcome[] | { error: string } {
  for (let a = 0; a < basis.length; a++) {
    if (basis[a].v.length !== psi.length) return { error: `Basis vector ${basis[a].label} has dimension ${basis[a].v.length}; the state has ${psi.length}.` };
    for (let b = a; b < basis.length; b++) {
      const ip = inner(basis[a].v, basis[b].v);
      const want = a === b ? 1 : 0;
      if (cAbs(cSub(ip, cx(want))) > 1e-9)
        return { error: `The basis is not orthonormal: ⟨${basis[a].label}|${basis[b].label}⟩ = ${fmtNum(ip.re)}${Math.abs(ip.im) > 1e-12 ? ` ${ip.im < 0 ? "−" : "+"} ${fmtNum(Math.abs(ip.im))}i` : ""}, not ${want}.` };
    }
  }
  if (basis.length > psi.length) return { error: `${basis.length} vectors were given for a ${psi.length}-dimensional space; at most ${psi.length} can be orthonormal.` };
  const out: Outcome[] = basis.map((b) => {
    const p = cAbs2(inner(b.v, psi));
    return { label: b.label, prob: p, post: p > ZERO_TOL ? b.v : null };
  });
  if (basis.length < psi.length) {
    let r = psi.slice();
    for (const b of basis) {
      const c = inner(b.v, r);
      r = r.map((z, k) => cSub(z, cMul(c, b.v[k])));
    }
    const p = r.reduce((s, z) => s + cAbs2(z), 0);
    out.push({ label: "none of the listed", prob: p, post: p > ZERO_TOL ? r.map((z) => cScale(z, 1 / Math.sqrt(p))) : null });
  }
  return out;
}

/**
 * Measuring a Hermitian observable: one outcome per DISTINCT eigenvalue λ, with the projector P_λ onto its whole
 * eigenspace (Lüders rule): P(λ) = ‖P_λ ψ‖², post-state P_λ ψ / √P(λ). A degenerate eigenspace is never split
 * between arbitrary eigenvectors.
 */
export function measureObservable(psi: State, A: CMat): { outcomes: Outcome[]; eig: HermEigen } | { error: string } {
  if (A.length !== psi.length) return { error: `The observable is ${A.length} × ${A.length} but the state has dimension ${psi.length}.` };
  const e = eigHermitian(A);
  if (!e) return { error: "An observable must be Hermitian (A† = A); this operator is not, so its eigenvalues are not measurement outcomes." };
  const outcomes: Outcome[] = e.clusters.map((cl) => {
    let proj: State = psi.map(() => C0);
    for (const k of cl) {
      const c = inner(e.vectors[k], psi);
      proj = proj.map((z, i) => cAdd(z, cMul(c, e.vectors[k][i])));
    }
    const p = proj.reduce((s, z) => s + cAbs2(z), 0);
    const lam = cl.reduce((s, k) => s + e.values[k], 0) / cl.length;
    return { label: `λ = ${fmtNum(lam)}`, value: lam, prob: p, post: p > ZERO_TOL ? proj.map((z) => cScale(z, 1 / Math.sqrt(p))) : null };
  });
  return { outcomes, eig: e };
}

/** The one-qubit rotation that takes the chosen basis to the computational one (applied before, undone after). */
const BASIS_ROT: Record<"Z" | "X" | "Y", { to: CMat; back: CMat; labels: [string, string] }> = {
  Z: { to: GATES.I, back: GATES.I, labels: ["0", "1"] },
  X: { to: GATES.H, back: GATES.H, labels: ["+", "−"] },
  // S† then H maps |+i⟩ → |0⟩, |−i⟩ → |1⟩; undone by S·H.
  Y: { to: matMul(GATES.H, GATES.Sdg), back: matMul(GATES.S, GATES.H), labels: ["+i", "−i"] },
};

/** Measuring qubit q of an n-qubit register in the Z, X or Y basis: both outcomes, post-states in the original frame. */
export function measureQubitInBasis(psi: State, n: number, q: number, basis: "Z" | "X" | "Y"): Outcome[] {
  const r = BASIS_ROT[basis];
  const rotated = basis === "Z" ? psi : applyGate(psi, n, r.to, [q]);
  return ([0, 1] as const).map((o) => {
    const m = measureQubit(rotated, n, q, o);
    const post = m.post ? (basis === "Z" ? m.post : applyGate(m.post, n, r.back, [q])) : null;
    return { label: r.labels[o], prob: m.prob, post };
  });
}

/** Every qubit of a register in the X or Y basis: the product basis |±…⟩ / |±i…⟩, as labelled basis vectors. */
export function productBasis(n: number, basis: "Z" | "X" | "Y"): { label: string; v: State }[] {
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUBITS) throw new Error(`productBasis: 1 to ${MAX_QUBITS} qubits`);
  const r = BASIS_ROT[basis];
  const out: { label: string; v: State }[] = [];
  for (let k = 0; k < 1 << n; k++) {
    let v: State = Array.from({ length: 1 << n }, (_, j) => (j === k ? C1 : C0));
    if (basis !== "Z") for (let q = 0; q < n; q++) v = applyGate(v, n, r.back, [q]);
    const label = Array.from({ length: n }, (_, q) => r.labels[(k >> (n - 1 - q)) & 1]).join(basis === "Z" ? "" : "");
    out.push({ label, v });
  }
  return out;
}

export const BELL_BASIS: { label: string; v: State }[] = [
  { label: "Φ⁺", v: BELL_STATES["Phi+"].slice() },
  { label: "Φ⁻", v: BELL_STATES["Phi-"].slice() },
  { label: "Ψ⁺", v: BELL_STATES["Psi+"].slice() },
  { label: "Ψ⁻", v: BELL_STATES["Psi-"].slice() },
];

// ---------------------------------------------------------------------------------------------------------------
// Density matrices
// ---------------------------------------------------------------------------------------------------------------

export const densityOf = (psi: State): CMat => outer(psi, psi);

export interface DensityCheck {
  eig: HermEigen;
  /** Eigenvalues with rounding noise below 10⁻¹² clamped to 0. */
  probs: number[];
  trace: number;
}

/**
 * A valid density matrix: Hermitian (to 10⁻⁹), trace 1 (to 10⁻⁹) and positive semidefinite (no eigenvalue below
 * −10⁻⁹). Each failure is a named refusal; a matrix that fails is never given an entropy or a purity.
 */
export function checkDensity(rho: CMat): DensityCheck | { error: string } {
  if (!isHermitian(rho)) {
    let worst = { i: 0, j: 0, d: 0 };
    for (let i = 0; i < rho.length; i++) for (let j = 0; j < rho.length; j++) {
      const d = cAbs(cSub(rho[i][j], cConj(rho[j][i])));
      if (d > worst.d) worst = { i, j, d };
    }
    return { error: `Not a density matrix: ρ is not Hermitian (ρ${worst.i + 1}${worst.j + 1} is not the complex conjugate of ρ${worst.j + 1}${worst.i + 1}). A density matrix satisfies ρ† = ρ.` };
  }
  const tr = trace(rho).re;
  if (Math.abs(tr - 1) > 1e-9) return { error: `Not a density matrix: tr ρ = ${fmtNum(tr)}, not 1 (to within 1×10⁻⁹). Normalise it (divide by its trace) if that is what you meant.` };
  const eig = eigHermitian(rho);
  if (!eig) return { error: "The eigen-decomposition did not converge." };
  const minE = Math.min(...eig.values);
  if (minE < -1e-9) return { error: `Not a density matrix: it has a negative eigenvalue (${fmtNum(minE)}), so it would give a negative probability. A density matrix is positive semidefinite.` };
  return { eig, probs: eig.values.map((v) => (Math.abs(v) < 1e-12 ? 0 : Math.max(0, v))), trace: tr };
}

/** S(ρ) = −Σ λ log₂ λ over the eigenvalues (0 log 0 = 0). */
export const vonNeumannBits = (eigs: number[]): number => {
  const s = eigs.reduce((t, l) => (l > 1e-15 ? t - l * Math.log2(l) : t), 0);
  return Math.abs(s) < 1e-13 ? 0 : s;
};

/** Squared (Jozsa) fidelity F(ρ, σ) = (tr √(√ρ σ √ρ))², in [0, 1]. */
export function fidelity(rho: CMat, sigma: CMat): number | null {
  const sr = hermFunc(rho, (x) => Math.sqrt(Math.max(0, x)));
  if (!sr) return null;
  const M = matMul(matMul(sr, sigma), sr);
  const e = eigHermitian(M.map((r, i) => r.map((_, j) => cScale(cAdd(M[i][j], cConj(M[j][i])), 0.5))));
  if (!e) return null;
  const t = e.values.reduce((s, v) => s + Math.sqrt(Math.max(0, v)), 0);
  return Math.min(1, t * t);
}

/** T(ρ, σ) = ½ ‖ρ − σ‖₁ = ½ Σ |eigenvalues of ρ − σ|. */
export function traceDistance(rho: CMat, sigma: CMat): number | null {
  const e = eigHermitian(matSub(rho, sigma));
  if (!e) return null;
  return Math.min(1, 0.5 * e.values.reduce((s, v) => s + Math.abs(v), 0));
}

/** The Bloch vector (tr ρX, tr ρY, tr ρZ) of a one-qubit density matrix. */
export const blochOf = (rho: CMat): [number, number, number] => [
  trace(matMul(rho, GATES.X)).re,
  trace(matMul(rho, GATES.Y)).re,
  trace(matMul(rho, GATES.Z)).re,
];

// ---------------------------------------------------------------------------------------------------------------
// Bipartite systems (A ⊗ B, the index of |i⟩|j⟩ is i·d_B + j)
// ---------------------------------------------------------------------------------------------------------------

/** Every bipartite routine first checks d_A, d_B (whole numbers ≥ 1, d_A·d_B ≤ 16) against the size it is given. */
function checkDims(m: { length: number } | null | undefined, dA: number, dB: number): void {
  if (!Number.isInteger(dA) || !Number.isInteger(dB) || dA < 1 || dB < 1 || dA * dB > DIRAC_MAX_DIM || !m || m.length !== dA * dB)
    throw new Error("bipartite: d_A × d_B must match the size (at most 16)");
}

/** ρ_A = tr_B ρ (keep "A") or ρ_B = tr_A ρ (keep "B"). */
export function partialTrace(rho: CMat, dA: number, dB: number, keep: "A" | "B"): CMat {
  checkDims(rho, dA, dB);
  const d = keep === "A" ? dA : dB;
  const out: CMat = Array.from({ length: d }, () => Array.from({ length: d }, () => C0));
  for (let a = 0; a < d; a++)
    for (let c = 0; c < d; c++) {
      let s = C0;
      const other = keep === "A" ? dB : dA;
      for (let e = 0; e < other; e++) {
        const r = keep === "A" ? a * dB + e : e * dB + a;
        const col = keep === "A" ? c * dB + e : e * dB + c;
        s = cAdd(s, rho[r][col]);
      }
      out[a][c] = s;
    }
  return out;
}

/** ρ^{T_B}: ⟨i j|ρ^{T_B}|k l⟩ = ⟨i l|ρ|k j⟩. */
export function partialTranspose(rho: CMat, dA: number, dB: number): CMat {
  checkDims(rho, dA, dB);
  const D = dA * dB;
  const out: CMat = Array.from({ length: D }, () => Array.from({ length: D }, () => C0));
  for (let i = 0; i < dA; i++) for (let j = 0; j < dB; j++) for (let k = 0; k < dA; k++) for (let l = 0; l < dB; l++)
    out[i * dB + j][k * dB + l] = rho[i * dB + l][k * dB + j];
  return out;
}

export interface Schmidt {
  /** Schmidt coefficients sₖ (descending, the non-zero ones), Σ sₖ² = 1. */
  coeffs: number[];
  a: State[];
  b: State[];
}

/**
 * |ψ⟩ = Σ sₖ |aₖ⟩|bₖ⟩: sₖ² are the eigenvalues of M M† (M the d_A × d_B coefficient matrix), aₖ its eigenvectors,
 * bₖ[j] = Σᵢ aₖ[i]* M[i][j] / sₖ.
 */
export function schmidt(psi: State, dA: number, dB: number): Schmidt | null {
  checkDims(psi, dA, dB);
  const M: CMat = Array.from({ length: dA }, (_, i) => psi.slice(i * dB, i * dB + dB));
  const MMd = matMul(M, matDagger(M));
  const e = eigHermitian(MMd);
  if (!e) return null;
  const order = e.values.map((_, k) => k).sort((x, y) => e.values[y] - e.values[x]);
  const coeffs: number[] = [], a: State[] = [], b: State[] = [];
  for (const k of order) {
    if (e.values[k] <= 1e-24) continue;
    const s = Math.sqrt(e.values[k]);
    if (s < 1e-12) continue;
    const ak = e.vectors[k];
    const bk: State = Array.from({ length: dB }, (_, j) => {
      let z = C0;
      for (let i = 0; i < dA; i++) z = cAdd(z, cMul(cConj(ak[i]), M[i][j]));
      return cScale(z, 1 / s);
    });
    coeffs.push(s);
    a.push(ak);
    b.push(bk);
  }
  return { coeffs, a, b };
}

/**
 * Wootters concurrence of a two-qubit ρ: C = max(0, λ₁ − λ₂ − λ₃ − λ₄), the λ the square roots of the eigenvalues
 * of the HERMITIAN √ρ ρ̃ √ρ (ρ̃ = (Y⊗Y) ρ* (Y⊗Y)), descending — the same spectrum as ρρ̃ without its non-Hermitian
 * eigenproblem.
 */
export function concurrence(rho: CMat): { c: number; lambdas: number[] } | null {
  if (rho.length !== 4) return null;
  const YY = kron(GATES.Y, GATES.Y);
  const rt = matMul(matMul(YY, rho.map((r) => r.map(cConj))), YY);
  const sr = hermFunc(rho, (x) => Math.sqrt(Math.max(0, x)));
  if (!sr) return null;
  const M = matMul(matMul(sr, rt), sr);
  const e = eigHermitian(M.map((r, i) => r.map((_, j) => cScale(cAdd(M[i][j], cConj(M[j][i])), 0.5))));
  if (!e) return null;
  const l = e.values.map((v) => Math.sqrt(Math.max(0, v))).sort((x, y) => y - x);
  const c = Math.max(0, l[0] - l[1] - l[2] - l[3]);
  return { c: c < 1e-12 ? 0 : Math.min(1, c), lambdas: l };
}

/** Negativity N = Σ |negative eigenvalues of ρ^{T_B}| = (‖ρ^{T_B}‖₁ − 1)/2 and E_N = log₂(2N + 1). */
export function negativity(rho: CMat, dA: number, dB: number): { N: number; logN: number; ptEig: number[] } | null {
  const e = eigHermitian(partialTranspose(rho, dA, dB));
  if (!e) return null;
  const vals = e.values.map((v) => (Math.abs(v) < 1e-13 ? 0 : v));
  const N = vals.reduce((s, v) => (v < 0 ? s - v : s), 0);
  return { N, logN: Math.log2(2 * N + 1), ptEig: vals };
}

/** The Werner state p|Φ⁺⟩⟨Φ⁺| + (1 − p) I/4 (quantum.ts's convention for wernerState). */
export function wernerRho(p: number): CMat {
  if (typeof p !== "number" || !(p >= 0 && p <= 1)) throw new Error("wernerRho: p from 0 to 1");
  const phi = BELL_STATES["Phi+"];
  return outer(phi, phi).map((r, i) => r.map((z, j) => cAdd(cScale(z, p), i === j ? cx((1 - p) / 4) : C0)));
}

/** Σ λₖ |Bₖ⟩⟨Bₖ| over Φ⁺, Φ⁻, Ψ⁺, Ψ⁻. */
export function bellDiagonalRho(l: [number, number, number, number]): CMat {
  if (!Array.isArray(l) || l.length !== 4 || !l.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("bellDiagonalRho: four finite weights");
  let rho: CMat = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => C0));
  BELL_BASIS.forEach((b, k) => {
    rho = matAdd(rho, matScale(outer(b.v, b.v), cx(l[k])));
  });
  return rho;
}

/** ρ from a mixture Σ pₖ |ψₖ⟩⟨ψₖ| (states already normalised and of one dimension). */
export function mixtureRho(items: { w: number; psi: State }[]): CMat {
  const d = items[0].psi.length;
  let rho: CMat = Array.from({ length: d }, () => Array.from({ length: d }, () => C0));
  for (const it of items) rho = matAdd(rho, matScale(outer(it.psi, it.psi), cx(it.w)));
  return rho;
}

export { fmtNum };
