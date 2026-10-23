// Quantum circuits (Release Q, part Q2): the gate-name reader, the typed-circuit parser, the state-vector simulator and
// the protocol presets (interference, Bell states, teleportation, superdense coding, Deutsch–Jozsa, Grover, QFT). All
// arithmetic is quantumCore.ts's; this file only says WHICH gates are applied, in which order, to which qubits.
//
// CONVENTIONS (stated in every result that uses them):
//   - Qubit order is BIG-ENDIAN: |q0 q1 … q(n−1)⟩, q0 the leftmost (most significant) bit.
//   - A gate sequence and a circuit run in TIME ORDER, first line (or leftmost gate) first; the overall unitary of a
//     sequence g1 g2 … gk is U = gk ⋯ g2·g1.
//   - MEASURE is deferred to the end (the deferred-measurement principle): the final state is the state just before
//     measurement and the probabilities are those of measuring. A measured qubit may afterwards be used as a CONTROL
//     (that is a classically controlled gate, equivalent under the principle) but never as a target — refused by name.

import {
  GATES,
  ISWAP4,
  MAX_QUBITS,
  applyGate,
  basisState,
  bitOf,
  cAbs2,
  cx,
  matMul,
  matVec,
  measureQubit,
  marginal,
  normalise,
  parseAngle,
  phaseGate,
  rx,
  ry,
  rz,
  u3,
  type CMat,
  type Cx,
  type State,
} from "./quantumCore";

export interface GateSpec {
  /** Canonical name: I X Y Z H S Sdg T Tdg SX Rx Ry Rz P U. */
  name: string;
  /** As drawn and printed: "S†", "√X", "Rz(π/4)", "Ry(30°)". */
  label: string;
  U: CMat;
  /** For Rx/Ry/Rz/P: the Bloch rotation as typed (axis, signed angle in radians), so a 270° turn draws 270°. */
  rot?: { axis: [number, number, number]; angle: number };
}

const FIXED: Record<string, { name: keyof typeof GATES; label: string }> = {
  I: { name: "I", label: "I" }, ID: { name: "I", label: "I" },
  X: { name: "X", label: "X" }, NOT: { name: "X", label: "X" },
  Y: { name: "Y", label: "Y" },
  Z: { name: "Z", label: "Z" },
  H: { name: "H", label: "H" },
  S: { name: "S", label: "S" },
  SDG: { name: "Sdg", label: "S†" }, SDAG: { name: "Sdg", label: "S†" }, "S†": { name: "Sdg", label: "S†" }, SDAGGER: { name: "Sdg", label: "S†" },
  T: { name: "T", label: "T" },
  TDG: { name: "Tdg", label: "T†" }, TDAG: { name: "Tdg", label: "T†" }, "T†": { name: "Tdg", label: "T†" }, TDAGGER: { name: "Tdg", label: "T†" },
  SX: { name: "SX", label: "√X" }, "√X": { name: "SX", label: "√X" }, SQRTX: { name: "SX", label: "√X" },
};

/** The single-qubit gate names, for messages. */
export const GATE_NAMES = "I, X, Y, Z, H, S, S†, T, T†, √X, Rx(θ), Ry(θ), Rz(θ), P(φ), U(θ, φ, λ)";

/** Splits "a, b, c" at top-level commas (brackets balanced). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** One single-qubit gate from its name and (optional) bracketed arguments. */
export function singleGate(rawName: string, args: string | null): GateSpec | { error: string } {
  const key = rawName.toUpperCase().replace(/\^/g, "").replace(/'$/, "†");
  const f = FIXED[key];
  if (f) {
    if (args !== null) return { error: `${f.label} takes no angle ("${rawName}(${args})").` };
    return { name: f.name, label: f.label, U: GATES[f.name] };
  }
  const X3: [number, number, number] = [1, 0, 0], Y3: [number, number, number] = [0, 1, 0], Z3: [number, number, number] = [0, 0, 1];
  const rot: Record<string, { name: string; fn: (t: number) => CMat; axis: [number, number, number] }> = {
    RX: { name: "Rx", fn: rx, axis: X3 },
    RY: { name: "Ry", fn: ry, axis: Y3 },
    RZ: { name: "Rz", fn: rz, axis: Z3 },
    P: { name: "P", fn: phaseGate, axis: Z3 },
    PHASE: { name: "P", fn: phaseGate, axis: Z3 },
    U1: { name: "P", fn: phaseGate, axis: Z3 },
  };
  if (rot[key]) {
    const g = rot[key];
    if (args === null || !args.trim()) return { error: `${g.name} needs an angle: ${g.name}(30) in degrees or ${g.name}(pi/4) in radians.` };
    const a = parseAngle(args);
    if ("error" in a) return { error: `${g.name}(${args}): ${a.error}` };
    return { name: g.name, label: `${g.name}(${a.label})`, U: g.fn(a.rad), rot: { axis: g.axis, angle: a.rad } };
  }
  if (key === "U" || key === "U3") {
    const parts = args === null ? [] : splitArgs(args);
    if (parts.length !== 3) return { error: `U takes three angles, U(θ, φ, λ), e.g. U(90, 0, 180) (Qiskit's convention).` };
    const angs = parts.map(parseAngle);
    const bad = angs.find((x) => "error" in x) as { error: string } | undefined;
    if (bad) return { error: `U(${args}): ${bad.error}` };
    const [t, p, l] = angs as { rad: number; label: string }[];
    return { name: "U", label: `U(${t.label}, ${p.label}, ${l.label})`, U: u3(t.rad, p.rad, l.rad) };
  }
  return { error: `"${rawName}" is not a gate this tool knows. Single-qubit gates: ${GATE_NAMES}.` };
}

/** The most gates one sequence or circuit may hold (the work bound). */
export const MAX_GATES = 200;

/** Reads `NAME` or `NAME(args)` tokens from a string, in order; an { error } names the first bad one. */
function tokens(text: string): { name: string; args: string | null; raw: string }[] | { error: string } {
  const out: { name: string; args: string | null; raw: string }[] = [];
  const s = text.replace(/[−–]/g, "-");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[\s,;·→]/.test(ch)) {
      i++;
      continue;
    }
    const m = /^[A-Za-z√][A-Za-z0-9]*(?:\^?†|')?/.exec(s.slice(i));
    if (!m) return { error: `Unexpected "${ch}" in the gate list (position ${i + 1}).` };
    let j = i + m[0].length;
    let args: string | null = null;
    if (s[j] === "(") {
      let depth = 0, k = j;
      for (; k < s.length; k++) {
        if (s[k] === "(") depth++;
        else if (s[k] === ")" && --depth === 0) break;
      }
      if (k >= s.length) return { error: `"${s.slice(i)}" has an unclosed bracket.` };
      args = s.slice(j + 1, k);
      j = k + 1;
    }
    out.push({ name: m[0], args, raw: s.slice(i, j) });
    if (out.length > MAX_GATES) return { error: `At most ${MAX_GATES} gates can be applied in one sequence.` };
    i = j;
  }
  return out;
}

/** A single-qubit gate sequence, "H S Rx(30) T" (time order, leftmost first). */
export function parseGateSequence(text: string): GateSpec[] | { error: string } {
  const t = tokens(text ?? "");
  if ("error" in t) return t;
  const out: GateSpec[] = [];
  for (const tok of t) {
    const g = singleGate(tok.name, tok.args);
    if ("error" in g) return g;
    out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------------------------------------------

export type Op =
  /** A single-qubit gate on `target`, applied where every control is 1. draw: CNOT's ⊕, CZ's symmetric dots, a box. */
  | { kind: "gate"; label: string; U: CMat; target: number; controls: number[]; draw: "box" | "oplus" | "dot" }
  | { kind: "swap"; a: number; b: number; controls: number[] }
  | { kind: "two"; label: string; U: CMat; a: number; b: number }
  | { kind: "measure"; qubit: number }
  /** A named group of operations drawn as one box spanning `qubits` (an oracle, a diffuser). */
  | { kind: "block"; label: string; qubits: number[]; ops: Op[] };

export interface Circuit {
  n: number;
  ops: Op[];
  /** The label written at the left of each wire ("|0⟩", "|ψ⟩"); defaults to the initial basis bits. */
  inputs?: string[];
}

const opQubits = (op: Op): number[] => {
  switch (op.kind) {
    case "gate": return [...op.controls, op.target];
    case "swap": return [...op.controls, op.a, op.b];
    case "two": return [op.a, op.b];
    case "measure": return [op.qubit];
    case "block": return op.qubits;
  }
};
/** The qubits an op changes (a control is read, not changed). */
const opTargets = (op: Op): number[] => {
  switch (op.kind) {
    case "gate": return [op.target];
    case "swap": return [op.a, op.b];
    case "two": return [op.a, op.b];
    case "measure": return [];
    case "block": return op.qubits;
  }
};
export { opQubits };

/** Counts primitive gates (blocks expanded): the work bound. */
const opCount = (ops: Op[]): number => ops.reduce((s, o) => s + (o.kind === "block" ? opCount(o.ops) : 1), 0);

/** Checks every op against n and the measured-qubit rule; a string names the first violation. */
export function validateOps(ops: Op[], n: number, where: (i: number) => string = (i) => `operation ${i + 1}`): string | null {
  if (opCount(ops) > MAX_GATES * 4) return `The circuit is too long (more than ${MAX_GATES * 4} primitive gates).`;
  const measured = new Set<number>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const qs = opQubits(op);
    const bad = qs.find((q) => !Number.isInteger(q) || q < 0 || q >= n);
    if (bad !== undefined) return `${where(i)}: qubit ${bad} does not exist: the register has ${n} qubit${n > 1 ? "s" : ""}, numbered 0 to ${n - 1}.`;
    if (new Set(qs).size !== qs.length) {
      if (op.kind === "gate" && op.controls.includes(op.target)) return `${where(i)}: the control and the target are the same qubit (${op.target}); a controlled gate needs two different qubits.`;
      return `${where(i)}: a qubit is named twice (${qs.join(", ")}); each qubit of one gate must be different.`;
    }
    const hit = opTargets(op).find((q) => measured.has(q));
    if (hit !== undefined)
      return `${where(i)}: qubit ${hit} has already been measured. Measurement is deferred to the end of the circuit, so a gate acting on a measured qubit cannot be simulated faithfully; a measured qubit may only be used as a control afterwards. Move the MEASURE after this gate.`;
    if (op.kind === "measure") measured.add(op.qubit);
  }
  return null;
}

/** Runs the ops on a state (no collapse: measurement is deferred). */
export function runOps(state: State, n: number, ops: Op[]): State {
  let s = state;
  for (const op of ops) {
    switch (op.kind) {
      case "gate":
        s = applyGate(s, n, op.U, [op.target], op.controls);
        break;
      case "swap":
        s = applyGate(s, n, SWAP_U, [op.a, op.b], op.controls);
        break;
      case "two":
        s = applyGate(s, n, op.U, [op.a, op.b]);
        break;
      case "measure":
        break;
      case "block":
        s = runOps(s, n, op.ops);
        break;
    }
  }
  return s;
}
const SWAP_U: CMat = [
  [cx(1), cx(0), cx(0), cx(0)],
  [cx(0), cx(0), cx(1), cx(0)],
  [cx(0), cx(1), cx(0), cx(0)],
  [cx(0), cx(0), cx(0), cx(1)],
];

/** The qubits measured in a circuit, in the order first measured. */
export const measuredQubits = (ops: Op[]): number[] => {
  const out: number[] = [];
  for (const op of ops) if (op.kind === "measure" && !out.includes(op.qubit)) out.push(op.qubit);
  return out;
};

const g1 = (label: string, U: CMat, target: number, controls: number[] = [], draw: "box" | "oplus" | "dot" = "box"): Op => ({
  kind: "gate", label, U, target, controls, draw,
});

/**
 * A typed circuit, one gate per line: "H 0", "CNOT 0 1", "CZ 1 2", "SWAP 0 2", "CCX 0 1 2", "CU(Rz(pi/4)) 0 1",
 * "RY(30) 2", "MEASURE 0". A single-qubit gate may list several qubits ("H 0 1 2"). Blank lines and # comments are
 * skipped. Every refusal names its line.
 */
export function parseCircuit(text: string, n: number): { ops: Op[] } | { error: string } {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  if (lines.length > MAX_GATES * 2) return { error: `At most ${MAX_GATES} gate lines can be read.` };
  const ops: Op[] = [];
  const lineOf: number[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].replace(/(#|\/\/).*$/, "").replace(/[−–]/g, "-").trim();
    if (!line) continue;
    const at = `Line ${li + 1} ("${line}")`;
    const t = tokens(line.replace(/\s\d[\d\s,]*$/, ""));
    if ("error" in t) return { error: `${at}: ${t.error}` };
    if (t.length !== 1) return { error: `${at}: write one gate per line, its name then its qubit numbers (CNOT 0 1).` };
    const tok = t[0];
    const qtext = line.slice(line.indexOf(tok.raw) + tok.raw.length).trim();
    if (qtext && !/^\d+([\s,]+\d+)*$/.test(qtext)) return { error: `${at}: the qubits must be whole numbers 0 to ${n - 1}, separated by spaces.` };
    const qs = qtext ? qtext.split(/[\s,]+/).map(Number) : [];
    const name = tok.name.toUpperCase();
    const need = (k: number, what: string): string | null =>
      qs.length === k ? null : `${at}: ${tok.name} acts on ${k} qubit${k > 1 ? "s" : ""} (${what}); ${qs.length} given.`;
    const push = (op: Op): void => {
      ops.push(op);
      lineOf.push(li + 1);
    };
    if (name === "BARRIER") continue;
    if (name === "MEASURE" || name === "M" || name === "MEASUREMENT") {
      if (!qs.length) return { error: `${at}: name the qubit(s) to measure (MEASURE 0).` };
      qs.forEach((q) => push({ kind: "measure", qubit: q }));
      continue;
    }
    if (name === "CNOT" || name === "CX") {
      const e = need(2, "control, target");
      if (e) return { error: e };
      push(g1("X", GATES.X, qs[1], [qs[0]], "oplus"));
      continue;
    }
    if (name === "CCX" || name === "TOFFOLI" || name === "CCNOT") {
      const e = need(3, "control, control, target");
      if (e) return { error: e };
      push(g1("X", GATES.X, qs[2], [qs[0], qs[1]], "oplus"));
      continue;
    }
    if (name === "CZ" || name === "CCZ") {
      const k = name === "CZ" ? 2 : 3;
      const e = need(k, k === 2 ? "control, target" : "control, control, target");
      if (e) return { error: e };
      push(g1("Z", GATES.Z, qs[k - 1], qs.slice(0, k - 1), "dot"));
      continue;
    }
    if (name === "SWAP") {
      const e = need(2, "the two qubits");
      if (e) return { error: e };
      push({ kind: "swap", a: qs[0], b: qs[1], controls: [] });
      continue;
    }
    if (name === "CSWAP" || name === "FREDKIN") {
      const e = need(3, "control, then the two swapped qubits");
      if (e) return { error: e };
      push({ kind: "swap", a: qs[1], b: qs[2], controls: [qs[0]] });
      continue;
    }
    if (name === "ISWAP") {
      const e = need(2, "the two qubits");
      if (e) return { error: e };
      push({ kind: "two", label: "iSWAP", U: ISWAP4, a: qs[0], b: qs[1] });
      continue;
    }
    // Controlled single-qubit gates: CU(gate), CY, CH, CS, CT, CRX(θ), CRY(θ), CRZ(θ), CP(φ).
    let inner: GateSpec | { error: string } | null = null;
    if (name === "CU") {
      if (!tok.args) return { error: `${at}: CU needs the gate it controls, e.g. CU(Rz(pi/4)) 0 1.` };
      const it = tokens(tok.args);
      if ("error" in it || it.length !== 1)
        return { error: `${at}: CU(…) takes ONE single-qubit gate, e.g. CU(Rz(pi/4)) or CU(U(90, 0, 180)).` };
      inner = singleGate(it[0].name, it[0].args);
    } else if (/^C(Y|H|S|T|SDG|TDG|SX|RX|RY|RZ|P|PHASE|U3?)$/.test(name)) {
      inner = singleGate(tok.name.slice(1), tok.args);
    }
    if (inner) {
      if ("error" in inner) return { error: `${at}: ${inner.error}` };
      const e = need(2, "control, target");
      if (e) return { error: e };
      push(g1(inner.label, inner.U, qs[1], [qs[0]], "box"));
      continue;
    }
    const g = singleGate(tok.name, tok.args);
    if ("error" in g)
      return { error: `${at}: ${g.error} Multi-qubit: CNOT (CX), CZ, CY, CH, CS, CRX/CRY/CRZ(θ), CP(φ), CU(gate), SWAP, iSWAP, CCX (Toffoli), CCZ, CSWAP (Fredkin), MEASURE.` };
    if (!qs.length) return { error: `${at}: name the qubit (${tok.name} 0).` };
    if (new Set(qs).size !== qs.length) return { error: `${at}: a qubit is listed twice.` };
    qs.forEach((q) => push(g1(g.label, g.U, q)));
    if (ops.length > MAX_GATES) return { error: `At most ${MAX_GATES} gates can be applied in one circuit.` };
  }
  if (!ops.length) return { error: "The circuit is empty: type one gate per line (H 0, CNOT 0 1 …)." };
  if (ops.length > MAX_GATES) return { error: `At most ${MAX_GATES} gates can be applied in one circuit.` };
  const v = validateOps(ops, n, (i) => `Line ${lineOf[i]}`);
  if (v) return { error: v };
  return { ops };
}

// ---------------------------------------------------------------------------------------------------------------
// Protocol presets
// ---------------------------------------------------------------------------------------------------------------

const H = (q: number): Op => g1("H", GATES.H, q);
const X = (q: number): Op => g1("X", GATES.X, q);
const Z = (q: number): Op => g1("Z", GATES.Z, q);
const CX = (c: number, t: number): Op => g1("X", GATES.X, t, [c], "oplus");

/** Interference: H·H, H·Z·H, or the Mach–Zehnder H·P(φ)·H, on |0⟩ (one qubit). */
export function interferenceCircuit(setup: "hh" | "hzh" | "mz", phi = 0, phiLabel = ""): Circuit {
  const ops: Op[] =
    setup === "hh" ? [H(0), H(0)] : setup === "hzh" ? [H(0), Z(0), H(0)] : [H(0), g1(`P(${phiLabel})`, phaseGate(phi), 0), H(0)];
  return { n: 1, ops: [...ops, { kind: "measure", qubit: 0 }] };
}

/** Bell-state preparation from |b1 b2⟩: H on q0, CNOT q0 → q1. |00⟩→Φ⁺, |01⟩→Ψ⁺, |10⟩→Φ⁻, |11⟩→Ψ⁻. */
export const bellCircuit = (inputs?: string[]): Circuit => ({ n: 2, ops: [H(0), CX(0, 1)], inputs });

export interface TeleportBranch {
  m0: 0 | 1;
  m1: 0 | 1;
  prob: number;
  /** Bob's qubit after Alice's result, before the correction. */
  bob: [Cx, Cx];
  /** "I", "X", "Z", "ZX": the correction Z^{m0}·X^{m1} (X first). */
  correction: string;
  corrected: [Cx, Cx];
}

/**
 * Teleportation of |ψ⟩ = α|0⟩ + β|1⟩ (q0) using the pair q1–q2 in Φ⁺: CNOT q0→q1, H q0, measure q0 (m0) and q1 (m1);
 * Bob applies X^{m1} then Z^{m0} to q2. The circuit returned draws the corrections as gates controlled by the measured
 * qubits (the deferred-measurement form); `branches` are computed by actual partial measurement with renormalisation.
 */
export function teleport(psi: [Cx, Cx]): { circuit: Circuit; before: State; branches: TeleportBranch[]; after: State } {
  const prep: Op[] = [H(1), CX(1, 2), CX(0, 1), H(0)];
  const n = 3;
  let s: State = [psi[0], cx(0), cx(0), cx(0), psi[1], cx(0), cx(0), cx(0)];
  s = runOps(s, n, prep);
  const branches: TeleportBranch[] = [];
  for (const m0 of [0, 1] as const)
    for (const m1 of [0, 1] as const) {
      const a = measureQubit(s, n, 0, m0);
      const b = a.post ? measureQubit(a.post, n, 1, m1) : { prob: 0, post: null };
      const prob = a.prob * b.prob;
      const post = b.post;
      const idx0 = (m0 << 2) | (m1 << 1);
      const bob: [Cx, Cx] = post ? [post[idx0], post[idx0 | 1]] : [cx(0), cx(0)];
      let corr: CMat = GATES.I;
      if (m1) corr = matMul(GATES.X, corr);
      if (m0) corr = matMul(GATES.Z, corr);
      const v = matVec(corr, bob);
      const corrected: [Cx, Cx] = [v[0], v[1]];
      branches.push({ m0, m1, prob, bob, correction: m0 && m1 ? "ZX" : m0 ? "Z" : m1 ? "X" : "I", corrected });
    }
  const fullOps: Op[] = [...prep, { kind: "measure", qubit: 0 }, { kind: "measure", qubit: 1 }, g1("X", GATES.X, 2, [1]), g1("Z", GATES.Z, 2, [0])];
  const after = runOps(s, n, fullOps.slice(prep.length));
  return { circuit: { n, ops: fullOps, inputs: ["|ψ⟩", "|0⟩", "|0⟩"] }, before: s, branches, after };
}

/** Superdense coding of bits b1 b2: share Φ⁺, Alice applies X^{b2} then Z^{b1} to q0, Bob decodes with CNOT, H. */
export function superdense(b1: 0 | 1, b2: 0 | 1): { circuit: Circuit; shared: State; final: State } {
  const share: Op[] = [H(0), CX(0, 1)];
  const enc: Op[] = [...(b2 ? [X(0)] : []), ...(b1 ? [Z(0)] : [])];
  const dec: Op[] = [CX(0, 1), H(0), { kind: "measure", qubit: 0 }, { kind: "measure", qubit: 1 }];
  const s0 = basisState(2, 0);
  const shared = runOps(s0, 2, [...share, ...enc]);
  const final = runOps(shared, 2, dec);
  return { circuit: { n: 2, ops: [...share, ...enc, ...dec] }, shared, final };
}

/** Uₓ: |x⟩|y⟩ → |x⟩|y ⊕ f(x)⟩ as X-conjugated multi-controlled NOTs (one per x with f(x) = 1). */
function oracleOps(n: number, f: number[]): Op[] {
  const ops: Op[] = [];
  const inputs = Array.from({ length: n }, (_, q) => q);
  for (let x = 0; x < f.length; x++) {
    if (!f[x]) continue;
    const zeros = inputs.filter((q) => !bitOf(x, q, n));
    ops.push(...zeros.map(X), CXn(inputs, n), ...zeros.map(X));
  }
  return ops;
}
const CXn = (controls: number[], target: number): Op => g1("X", GATES.X, target, controls, "oplus");

/**
 * Deutsch–Jozsa on n = 1–3 input qubits plus an ancilla in |1⟩, for an oracle given by its truth table f (2ⁿ bits,
 * constant or balanced — the promise; anything else is refused by the caller). Returns P(inputs all 0): 1 for a
 * constant f, 0 for a balanced one.
 */
export function deutschJozsa(n: number, f: number[]): { circuit: Circuit; final: State; pZero: number } {
  const N = n + 1;
  const inputs = Array.from({ length: n }, (_, q) => q);
  const ops: Op[] = [
    ...inputs.map(H),
    H(n),
    { kind: "block", label: "U_f", qubits: [...inputs, n], ops: oracleOps(n, f) },
    ...inputs.map(H),
    ...inputs.map((q): Op => ({ kind: "measure", qubit: q })),
  ];
  const s0 = basisState(N, 1);
  const final = runOps(s0, N, ops);
  const pZero = marginal(final, N, inputs)[0];
  return { circuit: { n: N, ops, inputs: [...inputs.map(() => "|0⟩"), "|1⟩"] }, final, pZero };
}

/** Phase flip on |m⟩: X on its 0 bits, multi-controlled Z, X again. */
function phaseFlipOps(n: number, m: number): Op[] {
  const all = Array.from({ length: n }, (_, q) => q);
  const zeros = all.filter((q) => !bitOf(m, q, n));
  return [...zeros.map(X), g1("Z", GATES.Z, n - 1, all.slice(0, n - 1), "dot"), ...zeros.map(X)];
}

export const GROVER_MAX_ITER = 20;

/** The optimal Grover iteration count for N items and one marked item: round(π/(4θ) − ½), θ = asin(1/√N). */
export const groverOptimal = (N: number): number => Math.max(0, Math.round(Math.PI / (4 * Math.asin(1 / Math.sqrt(N))) - 0.5));

/** Grover search on n = 2–3 qubits for one marked item; per-iteration success probabilities (simulated). */
export function grover(n: number, marked: number, iterations: number): { circuit: Circuit; final: State; pPerIter: number[] } {
  const all = Array.from({ length: n }, (_, q) => q);
  const oracle: Op = { kind: "block", label: "Oracle", qubits: all, ops: phaseFlipOps(n, marked) };
  const diffuser: Op = { kind: "block", label: "Diffuser", qubits: all, ops: [...all.map(H), ...phaseFlipOps(n, 0), ...all.map(H)] };
  const ops: Op[] = [...all.map(H)];
  let s = runOps(basisState(n, 0), n, ops);
  const pPerIter = [cAbs2(s[marked])];
  for (let k = 0; k < iterations; k++) {
    ops.push(oracle, diffuser);
    s = runOps(s, n, [oracle, diffuser]);
    pPerIter.push(cAbs2(s[marked]));
  }
  ops.push(...all.map((q): Op => ({ kind: "measure", qubit: q })));
  return { circuit: { n, ops }, final: s, pPerIter };
}

const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const sub = (k: number): string => String(k).split("").map((d) => SUBS[Number(d)]).join("");

/**
 * The QFT circuit on n qubits (big-endian, q0 the most significant): H and controlled-R_k = P(2π/2ᵏ) on each qubit,
 * then the swaps that put the output back in the input's order. Equals the DFT matrix F_jk = ω^{jk}/√N, ω = e^{2πi/N}.
 */
export function qftOps(n: number): Op[] {
  const ops: Op[] = [];
  for (let j = 0; j < n; j++) {
    ops.push(H(j));
    for (let k = j + 1; k < n; k++) {
      const r = k - j + 1;
      ops.push(g1(`R${sub(r)}`, phaseGate((2 * Math.PI) / (1 << r)), j, [k], "box"));
    }
  }
  for (let j = 0; j < Math.floor(n / 2); j++) ops.push({ kind: "swap", a: j, b: n - 1 - j, controls: [] });
  return ops;
}

/** The DFT matrix ω^{jk}/√N (the reference the QFT circuit is checked against). */
export function dftMatrix(n: number): CMat {
  const N = 1 << n;
  return Array.from({ length: N }, (_, j) =>
    Array.from({ length: N }, (_, k) => {
      const t = (2 * Math.PI * ((j * k) % N)) / N;
      return { re: Math.cos(t) / Math.sqrt(N), im: Math.sin(t) / Math.sqrt(N) };
    }),
  );
}

/** Runs a circuit from a basis state (bit string) or a given state. */
export function simulate(c: Circuit, init: State | number = 0): State {
  const s = typeof init === "number" ? basisState(c.n, init) : init;
  return runOps(s, c.n, c.ops);
}

/** Post-measurement states of the measured qubits: each outcome's probability and the renormalised register. */
export function postMeasurement(s: State, n: number, qubits: number[]): { outcome: number; prob: number; post: State }[] {
  const probs = marginal(s, n, qubits);
  const out: { outcome: number; prob: number; post: State }[] = [];
  probs.forEach((p, k) => {
    if (p <= 1e-12) return;
    const kept = s.map((z, b) => {
      for (let t = 0; t < qubits.length; t++) if (bitOf(b, qubits[t], n) !== ((k >> (qubits.length - 1 - t)) & 1)) return cx(0);
      return z;
    });
    const nz = normalise(kept);
    if (nz) out.push({ outcome: k, prob: p, post: nz.state });
  });
  return out;
}

export { MAX_QUBITS };
