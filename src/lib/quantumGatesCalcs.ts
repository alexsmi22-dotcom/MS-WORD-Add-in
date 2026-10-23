// Pane glue for Release Q part Q2 (group "Quantum computing", NEW): a single-qubit gate tool with the Bloch sphere, a
// typed-circuit simulator (≤ 10 qubits) and seven protocol presets (interference, Bell states, teleportation,
// superdense coding, Deutsch–Jozsa, Grover, QFT). Kept OUT of taskpane.ts; the integrator spreads QUANTUM_GATES_CALCS
// into ENG_CALCS and adds "Quantum computing" to ENG_GROUP_ORDER.
//
// No number is computed here: quantumCore.ts owns the arithmetic and quantumCircuits.ts the circuits. This file reads
// the fields, words the result under the display contract (U+2212, exact closed forms, no caret, no em dash, NaN or
// Infinity in an ok result) and draws.
//
// UNIT CONTRACT "domain": nothing here is dimensional. Angles are read in degrees by default and in radians when
// written with π (or "rad") — the angle field's own stated unit — and amplitudes are pure numbers.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { buildPlotSvg } from "./plot";
import { BELL_STATES, pureTwoQubit } from "./quantum";
import {
  GATES,
  MAX_QUBITS,
  ZERO_TOL,
  basisState,
  blochVector,
  cAbs2,
  cArg,
  cMul,
  cNear,
  cConj,
  cx,
  fmtAngle,
  fmtCx,
  fmtReal,
  fmtState,
  identity,
  ketLabel,
  marginal,
  matMul,
  matDagger,
  matVec,
  normalise,
  parseAngle,
  parseComplex,
  parseKet,
  phaseForm,
  probabilities,
  purity,
  reducedDensity,
  rotationOf,
  stateFromBloch,
  trimNum,
  type CMat,
  type Cx,
  type State,
} from "./quantumCore";
import {
  GROVER_MAX_ITER,
  bellCircuit,
  deutschJozsa,
  dftMatrix,
  grover,
  groverOptimal,
  interferenceCircuit,
  measuredQubits,
  parseCircuit,
  parseGateSequence,
  postMeasurement,
  qftOps,
  simulate,
  superdense,
  teleport,
  type Circuit,
  type GateSpec,
} from "./quantumCircuits";
import { blochSphereSvg, circuitDiagramSvg, probabilityBarsSvg } from "./quantumCharts";

type QCalc = EngCalcDef<"Quantum computing">;

const ORDER_NOTE = "Convention: qubits are big-endian, |q₀q₁…⟩ with q₀ the leftmost bit; gates act in time order, the first written first.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, ";")), ok: false });

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 440);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 290);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngLine[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  const out = engReport(lines.map((l) => (typeof l === "string" ? trueMinus(l.replace(/—/g, ";")) : l)), extra);
  return { ...out, outputs: outputs.map((o) => (Math.abs(o.value) < 1e-13 ? { ...o, value: 0 } : o)) };
}

/** A table block with every cell under the display contract. */
const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((r) => r.map((c) => trueMinus(c))) });

/** A gate label in equation syntax: R_x(60°), S^{-1} for S† (the equation syntax has no dagger), sqrt(X). */
const gateMath = (g: { label: string }): string =>
  g.label.replace(/^R([xyz])/, "R_$1").replace("√X", "sqrt(X)").replace(/([ST])†/, "$1^{-1}").replace(/−/g, "-");

/** A whole number from a field within [lo, hi]; a string is the refusal. */
function intField(raw: string, what: string, lo: number, hi: number): number | string {
  const t = (raw ?? "").trim();
  if (!/^\d+$/.test(t)) return `${what} must be a whole number from ${lo} to ${hi} ("${t}" given).`;
  const v = Number(t);
  if (v < lo || v > hi) return `${what} must be from ${lo} to ${hi}; ${v} is outside${hi === MAX_QUBITS && v > hi ? ` (state vectors are limited to ${MAX_QUBITS} qubits = 1024 amplitudes)` : ""}.`;
  return v;
}

/** A matrix as equation syntax pmatrix(a, b; c, d) and as table rows. */
function matrixShown(U: CMat): { math: string; rows: string[][] } {
  const cells = U.map((row) => row.map((z) => fmtCx(z)));
  return {
    math: `pmatrix(${cells.map((r) => r.map((c) => c.math).join(", ")).join("; ")})`,
    rows: cells.map((r) => r.map((c) => c.text)),
  };
}

/** U compared with the fixed gates: the name when U = e^{iα}G (α stated when not 0). */
function namedEquivalent(U: CMat): { name: string; phase: number } | null {
  const names: [string, CMat][] = [["I", GATES.I], ["X", GATES.X], ["Y", GATES.Y], ["Z", GATES.Z], ["H", GATES.H], ["S", GATES.S], ["S†", GATES.Sdg], ["T", GATES.T], ["T†", GATES.Tdg], ["√X", GATES.SX]];
  for (const [name, G] of names) {
    const M = matMul(U, matDagger(G));
    if (cAbs2(M[0][1]) < 1e-18 && cAbs2(M[1][0]) < 1e-18 && cNear(M[0][0], M[1][1], 1e-9) && Math.abs(cAbs2(M[0][0]) - 1) < 1e-9)
      return { name, phase: cArg(M[0][0]) };
  }
  return null;
}

/** Points on the Bloch sphere along each gate's rotation (the path the state really takes). */
function blochPath(start: State, gates: GateSpec[]): [number, number, number][] {
  const pts: [number, number, number][] = [blochVector(start)];
  let s = start;
  for (const g of gates) {
    const r = rotationOf(g.U);
    if (r.axis) {
      const [nx, ny, nz] = r.axis;
      const steps = Math.max(6, Math.ceil((r.theta / Math.PI) * 48));
      for (let k = 1; k <= steps; k++) {
        const t = (r.theta * k) / steps, c = Math.cos(t / 2), sn = Math.sin(t / 2);
        const M: CMat = [
          [cx(c, -sn * nz), cx(-sn * ny, -sn * nx)],
          [cx(sn * ny, -sn * nx), cx(c, sn * nz)],
        ];
        pts.push(blochVector(matVec(M, s)));
      }
    }
    s = matVec(g.U, s);
  }
  return pts;
}

const vec3 = (v: [number, number, number]): string => `(${v.map((x) => fmtReal(x).text).join(", ")})`;
const vec3n = (v: [number, number, number]): string => `(${v.map((x) => trimNum(x, 3)).join(", ")})`;
const deg = (rad: number): string => `${trimNum((rad * 180) / Math.PI, 6)}°`;

// ---------------------------------------------------------------------------------------------------------------
// 1. Single-qubit gates and the Bloch sphere
// ---------------------------------------------------------------------------------------------------------------

const START_OPTIONS = [
  { value: "0", label: "|0⟩" },
  { value: "1", label: "|1⟩" },
  { value: "+", label: "|+⟩ = (|0⟩ + |1⟩)/√2" },
  { value: "-", label: "|−⟩ = (|0⟩ − |1⟩)/√2" },
  { value: "i", label: "|i⟩ = (|0⟩ + i|1⟩)/√2" },
  { value: "-i", label: "|−i⟩ = (|0⟩ − i|1⟩)/√2" },
  { value: "dirac", label: "Typed state α|0⟩ + β|1⟩" },
  { value: "bloch", label: "Bloch angles θ, φ" },
];

const singleQubitCalc: QCalc = {
  id: "qc-single-qubit",
  name: "Single-qubit gates and the Bloch sphere",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Choose a starting state (or type α|0⟩ + β|1⟩, or give Bloch angles θ, φ) and a gate sequence applied left to right: " +
    "I X Y Z H S S† T T† √X Rx(θ) Ry(θ) Rz(θ) P(φ) U(θ, φ, λ). Angles in degrees, or in radians written with pi " +
    "(Rz(pi/4)). Gives the final state in Dirac form (closed forms exact), the probabilities, the Bloch vector, the " +
    "overall unitary and the rotation it makes on the Bloch sphere.",
  fields: [
    { key: "start", label: "Starting state", default: "0", kind: "select", options: START_OPTIONS },
    { key: "state", label: "Typed state (when chosen above)", default: "0.6|0⟩ + 0.8i|1⟩", kind: "text" },
    { key: "theta", label: "Bloch θ (when chosen above)", default: "60", kind: "text" },
    { key: "phi", label: "Bloch φ (when chosen above)", default: "0", kind: "text" },
    { key: "gates", label: "Gate sequence (first gate first)", default: "H T", kind: "text" },
    { key: "path", label: "Draw the path on the sphere", default: "yes", kind: "select", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
  ],
  compute: (r) => {
    const startKey = r("start") || "0";
    const typed = r("state");
    const thetaRaw = r("theta");
    const phiRaw = r("phi");
    const notes: string[] = [];
    let start: State;
    let startName: string;
    if (startKey === "dirac") {
      const k = parseKet(typed);
      if ("error" in k) return refuse(`Typed state: ${k.error}`);
      if (k.n !== 1) return refuse(`Typed state: this tool takes ONE qubit (α|0⟩ + β|1⟩); the state typed has ${k.n}. Use the circuit tool for more qubits.`);
      start = k.state;
      notes.push(...k.notes);
      startName = "the typed state";
    } else if (startKey === "bloch") {
      const t = parseAngle(thetaRaw), p = parseAngle(phiRaw);
      if ("error" in t) return refuse(`Bloch θ: ${t.error}`);
      if ("error" in p) return refuse(`Bloch φ: ${p.error}`);
      if (t.rad < -1e-12 || t.rad > Math.PI + 1e-12) return refuse("Bloch θ must be from 0° to 180° (0 to π): it is the polar angle from |0⟩.");
      start = stateFromBloch(t.rad, p.rad);
      startName = `Bloch θ = ${t.label}, φ = ${p.label}`;
    } else {
      const k = parseKet(`|${startKey}⟩`);
      if ("error" in k) return refuse(k.error);
      start = k.state;
      startName = `|${startKey.replace("-", "−")}⟩`;
    }
    const seq = parseGateSequence(r("gates"));
    if ("error" in seq) return refuse(`Gate sequence: ${seq.error}`);
    let U: CMat = identity(2);
    for (const g of seq) U = matMul(g.U, U);
    const fin = matVec(U, start);
    const s0 = fmtState(start, 1), s1 = fmtState(fin, 1);
    const b0 = blochVector(start), b1 = blochVector(fin);
    const p0 = cAbs2(fin[0]), p1 = cAbs2(fin[1]);
    const lines: EngLine[] = [...notes];
    const seqText = seq.length ? seq.map((g) => g.label).join(" ") : "(no gates)";
    lines.push(`Start ${startName}: |ψ₀⟩ = ${s0.text}${s0.globalPhase ? ` (global phase ${s0.globalPhase.text} factored out)` : ""}.`);
    if (s0.math) lines.push({ math: `ket(ψ_0) = ${s0.math}`, fallback: `|ψ₀⟩ = ${s0.text}` });
    lines.push(`Gates, in time order: ${seqText}. The overall unitary is their product taken right to left, U = Gₖ⋯G₂G₁.`);
    if (seq.length) lines.push({ math: `U = ${[...seq].reverse().map(gateMath).join(" ")}`, fallback: `U = ${[...seq].reverse().map((g) => g.label).join("·")}` });
    lines.push(`Final state: |ψ⟩ = U|ψ₀⟩ = ${s1.text}.`);
    if (s1.math) lines.push({ math: `ket(ψ) = ${s1.math}`, fallback: `|ψ⟩ = ${s1.text}` });
    if (s1.globalPhase) lines.push(`The global phase ${s1.globalPhase.text} was factored out of the display; it has no observable effect. The amplitudes as computed are below.`);
    const a = fmtCx(fin[0]), b = fmtCx(fin[1]);
    const num = (z: Cx): string => {
      const re = Math.abs(z.re) < ZERO_TOL ? 0 : z.re, im = Math.abs(z.im) < ZERO_TOL ? 0 : z.im;
      if (!im) return trimNum(re);
      if (!re) return `${trimNum(im)}i`;
      return `${trimNum(re)} ${im < 0 ? "−" : "+"} ${trimNum(Math.abs(im))}i`;
    };
    const both = (sh: { text: string }, z: Cx): string => (num(z) === sh.text ? sh.text : `${sh.text} = ${num(z)}`);
    lines.push(`Amplitudes: α = ${both(a, fin[0])}, β = ${both(b, fin[1])}.`);
    lines.push(`Probabilities (Born rule): P(0) = |α|² = ${fmtReal(p0).text}, P(1) = |β|² = ${fmtReal(p1).text}.`);
    lines.push({ math: "P(0) = abs(braket(0, ψ))^2", fallback: "P(0) = |⟨0|ψ⟩|²" });
    lines.push(`Bloch vector: start ${vec3(b0)}, final ${vec3(b1)} (x = 2 Re(α*β), y = 2 Im(α*β), z = |α|² − |β|²).`);
    const m = matrixShown(U);
    lines.push({ math: `U = ${m.math}`, fallback: `U = [${m.rows.map((r2) => r2.join(", ")).join("; ")}]` });
    const eq = namedEquivalent(U);
    if (seq.length > 1 && eq) {
      const ph = phaseForm(eq.phase);
      if (ph.text === "1") {
        lines.push(`Unitary identity: ${seq.map((g) => g.label).join(" ")} (in time order) = ${eq.name} exactly.`);
        lines.push({ math: `${[...seq].reverse().map(gateMath).join(" ")} = ${gateMath({ label: eq.name })}`, fallback: `${[...seq].reverse().map((g) => g.label).join("·")} = ${eq.name}` });
      } else lines.push(`Unitary identity: the sequence equals ${eq.name} up to the global phase ${ph.text} (U = ${ph.text}·${eq.name}).`);
    }
    const rot = rotationOf(U);
    if (!rot.axis) lines.push(`Bloch-sphere rotation: none; U is the identity${Math.abs(rot.alpha) > 1e-12 ? ` up to the global phase ${phaseForm(rot.alpha).text}` : ""}, so no axis is defined.`);
    else {
      lines.push(
        `Bloch-sphere rotation: θ = ${deg(rot.theta)} (${fmtAngle(rot.theta)}) about n = ${vec3(rot.axis)}${Math.abs(rot.alpha) > 1e-12 ? `, with global phase α = ${deg(rot.alpha)}` : ""}.`,
      );
      lines.push({ math: "U = e^{i α} (cos(θ/2) I - i sin(θ/2) n · σ)", fallback: "U = exp(iα)·(cos(θ/2) I − i sin(θ/2) n·σ)" });
    }
    lines.push("Gate conventions: Rx/Ry/Rz(θ) = exp(−iθσ/2) (so Rz(θ) differs from P(θ) = diag(1, exp(iθ)) by the global phase exp(−iθ/2)); U(θ, φ, λ) as in Qiskit.");
    const outputs: EngOutput[] = [
      { key: "alphaRe", label: "Re α", value: fin[0].re, unit: "" },
      { key: "alphaIm", label: "Im α", value: fin[0].im, unit: "" },
      { key: "betaRe", label: "Re β", value: fin[1].re, unit: "" },
      { key: "betaIm", label: "Im β", value: fin[1].im, unit: "" },
      { key: "p0", label: "P(0)", value: p0, unit: "" },
      { key: "p1", label: "P(1)", value: p1, unit: "" },
      { key: "blochX", label: "Bloch x", value: b1[0], unit: "" },
      { key: "blochY", label: "Bloch y", value: b1[1], unit: "" },
      { key: "blochZ", label: "Bloch z", value: b1[2], unit: "" },
      { key: "rotDeg", label: "Rotation angle", value: (rot.theta * 180) / Math.PI, unit: "°" },
    ];
    const extra: AnalyzeBlock[] = [
      table("Overall unitary U (rows ⟨0|, ⟨1|)", [["", "|0⟩", "|1⟩"], ["⟨0|", ...m.rows[0]], ["⟨1|", ...m.rows[1]]]),
      table("Final state", [["Basis state", "Amplitude", "Probability"], ["|0⟩", a.text, fmtReal(p0).text], ["|1⟩", b.text, fmtReal(p1).text]]),
    ];
    const path = r("path") === "no" ? [] : blochPath(start, seq);
    extra.push(
      plot(
        blochSphereSvg({ start: b0, end: b1, path, startLabel: `start: ${vec3n(b0)}`, endLabel: `final: ${vec3n(b1)}` }),
        `Bloch sphere: the start state (blue) and the final state (red) after ${seqText}${path.length > 1 ? ", with the path each gate rotates the state along" : ""}.`,
        `Bloch sphere with x, y, z axes; start vector ${vec3n(b0)}, final vector ${vec3n(b1)}.`,
      ),
    );
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Circuit simulator
// ---------------------------------------------------------------------------------------------------------------

/** The rows of a probability table: the non-zero outcomes (≤ 32, largest first, in index order). */
function outcomeRows(s: State, n: number, max = 32): { rows: string[][]; rest: number; restCount: number } {
  const nz = s.map((z, k) => ({ k, z, p: cAbs2(z) })).filter((t) => t.p > ZERO_TOL);
  let keep = nz;
  let rest = 0;
  if (nz.length > max) {
    const top = new Set([...nz].sort((x, y) => y.p - x.p || x.k - y.k).slice(0, max).map((t) => t.k));
    keep = nz.filter((t) => top.has(t.k));
    rest = nz.filter((t) => !top.has(t.k)).reduce((a, t) => a + t.p, 0);
  }
  return {
    rows: [["Outcome", "Amplitude", "Probability"], ...keep.map((t) => [`|${ketLabel(t.k, n)}⟩`, fmtCx(t.z).text, fmtReal(t.p).text])],
    rest,
    restCount: nz.length - keep.length,
  };
}

/** Per-qubit reduced purity (qubit vs the rest of a pure state): < 1 means entangled with the rest. */
function entanglementRows(s: State, n: number): { rows: string[][]; entangled: number[]; purities: number[] } {
  const rows: string[][] = [["Qubit", "Purity tr(ρ²) of its reduced state", "Entangled with the rest?"]];
  const entangled: number[] = [];
  const purities: number[] = [];
  for (let q = 0; q < n; q++) {
    const p = purity(reducedDensity(s, n, [q]));
    purities.push(p);
    const e = p < 1 - 1e-10;
    if (e) entangled.push(q);
    rows.push([`q${q}`, fmtReal(Math.min(1, p)).text, e ? "yes" : "no"]);
  }
  return { rows, entangled, purities };
}

const DEFAULT_CIRCUIT = "H 0\nCNOT 0 1\nCNOT 1 2\nMEASURE 0\nMEASURE 1\nMEASURE 2";

const circuitCalc: QCalc = {
  id: "qc-circuit",
  name: "Quantum circuit simulator (up to 10 qubits)",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Type a circuit one gate per line: H 0, X 1, RY(30) 2, CNOT 0 1, CZ 1 2, SWAP 0 2, iSWAP 0 1, CCX 0 1 2, CSWAP 0 1 2, " +
    "CU(Rz(pi/4)) 0 1, CP(90) 0 1, MEASURE 0. Qubits are numbered from 0; angles in degrees or with pi. Gives the final " +
    "state in Dirac form, the measurement probabilities, the outcomes and post-measurement states of the measured " +
    "qubits, and which qubits are entangled. Measurement is deferred to the end (a measured qubit may still be a control).",
  fields: [
    { key: "n", label: "Number of qubits (1–10)", default: "3", kind: "text" },
    { key: "init", label: "Initial basis state (bits q₀q₁…; blank = all 0)", default: "", kind: "text" },
    { key: "circuit", label: "Circuit, one gate per line", default: DEFAULT_CIRCUIT, kind: "block", rows: 8 },
  ],
  compute: (r) => {
    const nn = intField(r("n"), "Number of qubits", 1, MAX_QUBITS);
    if (typeof nn === "string") return refuse(nn);
    const n = nn;
    const initRaw = (r("init") ?? "").trim().replace(/[|⟩>\s]/g, "");
    if (initRaw && !/^[01]+$/.test(initRaw)) return refuse(`Initial basis state: write it as bits, one per qubit (e.g. ${"0".repeat(n)}).`);
    if (initRaw && initRaw.length !== n) return refuse(`Initial basis state: ${initRaw.length} bits given for ${n} qubits; give exactly ${n}.`);
    const init = initRaw ? parseInt(initRaw, 2) : 0;
    const pc = parseCircuit(r("circuit"), n);
    if ("error" in pc) return refuse(pc.error);
    const circ: Circuit = { n, ops: pc.ops };
    const fin = simulate(circ, init);
    const shown = fmtState(fin, n);
    const lines: EngLine[] = [ORDER_NOTE];
    lines.push(`Initial state |${ketLabel(init, n)}⟩; ${pc.ops.length} operation${pc.ops.length > 1 ? "s" : ""}.`);
    lines.push(`Final state (before measurement): |ψ⟩ = ${shown.text}${shown.globalPhase ? ` (global phase ${shown.globalPhase.text} factored out)` : ""}.`);
    if (shown.math) lines.push({ math: `ket(ψ) = ${shown.math}`, fallback: `|ψ⟩ = ${shown.text}` });
    lines.push({ math: "P(x) = abs(braket(x, ψ))^2", fallback: "P(x) = |⟨x|ψ⟩|²" });
    const outputs: EngOutput[] = [{ key: "terms", label: "Non-zero amplitudes", value: shown.terms, unit: "" }];
    const probs = probabilities(fin);
    if (n <= 5) probs.forEach((p, k) => outputs.push({ key: `p_${ketLabel(k, n)}`, label: `P(|${ketLabel(k, n)}⟩)`, value: p, unit: "" }));
    const ot = outcomeRows(fin, n);
    const extra: AnalyzeBlock[] = [table("Measurement probabilities (all qubits)", ot.rows)];
    if (ot.restCount) lines.push(`The table shows the 32 most probable outcomes; ${ot.restCount} more carry total probability ${trimNum(ot.rest, 4)}.`);
    const meas = measuredQubits(pc.ops);
    if (meas.length) {
      const mp = marginal(fin, n, meas);
      const names = meas.map((q) => `q${q}`).join("");
      lines.push(`Measured qubits ${meas.map((q) => `q${q}`).join(", ")}: outcome probabilities of |${names}⟩ below.`);
      extra.push(table(`Measured qubits ${meas.map((q) => `q${q}`).join(", ")}`, [[`Outcome |${names}⟩`, "Probability"], ...mp.map((p, k) => [`|${ketLabel(k, meas.length)}⟩`, fmtReal(p).text]).filter((row, k) => mp[k] > ZERO_TOL)]));
      mp.forEach((p, k) => outputs.push({ key: `m_${ketLabel(k, meas.length)}`, label: `P(measured = ${ketLabel(k, meas.length)})`, value: p, unit: "" }));
      const post = postMeasurement(fin, n, meas);
      if (post.length <= 8) {
        lines.push("Post-measurement state of the register for each outcome (renormalised):");
        for (const pm of post) lines.push(`  ${names} = ${ketLabel(pm.outcome, meas.length)} (probability ${fmtReal(pm.prob).text}): ${fmtState(pm.post, n).text}`);
      } else lines.push(`${post.length} outcomes have non-zero probability; post-measurement states are listed for at most 8.`);
    }
    if (n >= 2) {
      const ent = entanglementRows(fin, n);
      extra.push(table("Entanglement across each one-qubit cut (pure state)", ent.rows));
      ent.purities.forEach((p, q) => outputs.push({ key: `purity_q${q}`, label: `Purity of q${q}`, value: p, unit: "" }));
      lines.push(
        ent.entangled.length
          ? `Entangled: ${ent.entangled.map((q) => `q${q}`).join(", ")} ${ent.entangled.length > 1 ? "are each" : "is"} entangled with the rest of the register (reduced-state purity below 1).`
          : "No qubit is entangled with the rest: the final state is a product state (every reduced purity is 1).",
      );
      lines.push({ math: "ρ_q = tr_{rest}(ket(ψ) bra(ψ))", fallback: "ρ_q = tr_rest(|ψ⟩⟨ψ|), purity tr(ρ_q²)" });
      if (n === 2) {
        const c = pureTwoQubit(fin[0], fin[1], fin[2], fin[3]);
        if (c) {
          lines.push(`Concurrence C = 2|ad − bc| = ${fmtReal(c.concurrence).text}; entanglement entropy ${trimNum(c.entropyEbits, 4)} ebit.`);
          outputs.push({ key: "concurrence", label: "Concurrence", value: c.concurrence, unit: "" });
        }
      }
    }
    extra.push(plot(circuitDiagramSvg(circ, { initial: init }), `Circuit diagram (${n} qubit${n > 1 ? "s" : ""}, time left to right).`, `Quantum circuit on ${n} qubits with ${pc.ops.length} operations.`));
    extra.push(plot(probabilityBarsSvg(probs, n), "Measurement probabilities of the final state, all qubits (big-endian outcomes).", "Bar chart of outcome probabilities."));
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Protocols
// ---------------------------------------------------------------------------------------------------------------

const interferenceCalc: QCalc = {
  id: "qc-interference",
  name: "Protocol: superposition and interference (H–H, H–Z–H, Mach–Zehnder)",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "One qubit starting in |0⟩. H–H shows that two Hadamards undo each other (H·H = I); H–Z–H shows that a phase flip " +
    "between them becomes a bit flip (H·Z·H = X); the Mach–Zehnder interferometer puts a phase φ between two beam " +
    "splitters (H) and gives P(0) = cos²(φ/2).",
  fields: [
    {
      key: "setup",
      label: "Setup",
      default: "mz",
      kind: "select",
      options: [
        { value: "hh", label: "H then H" },
        { value: "hzh", label: "H, Z, H" },
        { value: "mz", label: "Mach–Zehnder: H, phase P(φ), H" },
      ],
    },
    { key: "phi", label: "Phase φ (Mach–Zehnder)", default: "60", kind: "text" },
  ],
  compute: (r) => {
    const setup = (r("setup") || "mz") as "hh" | "hzh" | "mz";
    const phiRaw = r("phi");
    let phi = 0, phiLabel = "";
    if (setup === "mz") {
      const a = parseAngle(phiRaw);
      if ("error" in a) return refuse(`Phase φ: ${a.error}`);
      phi = a.rad;
      phiLabel = a.label;
    }
    const circ = interferenceCircuit(setup, phi, phiLabel);
    const fin = simulate(circ);
    const st = fmtState(fin, 1);
    const p0 = cAbs2(fin[0]);
    const lines: EngLine[] = [];
    const outputs: EngOutput[] = [{ key: "p0", label: "P(0)", value: p0, unit: "" }, { key: "p1", label: "P(1)", value: 1 - p0, unit: "" }];
    const extra: AnalyzeBlock[] = [];
    if (setup === "hh") {
      lines.push("H puts |0⟩ into the equal superposition (|0⟩ + |1⟩)/√2; a second H makes the two paths to |1⟩ cancel (destructive interference) and the paths to |0⟩ add.");
      lines.push({ math: "H ket(0) = {ket(0) + ket(1)}/sqrt(2)", fallback: "H|0⟩ = (|0⟩ + |1⟩)/√2" });
      lines.push({ math: "H H = (1/2) pmatrix(1, 1; 1, -1) pmatrix(1, 1; 1, -1) = pmatrix(1, 0; 0, 1) = I", fallback: "H·H = I" });
    } else if (setup === "hzh") {
      lines.push("Z flips the sign of the |1⟩ path; after the second H the interference now favours |1⟩: the phase flip has become a bit flip.");
      lines.push({ math: "H Z H = (1/2) pmatrix(1, 1; 1, -1) pmatrix(1, 0; 0, -1) pmatrix(1, 1; 1, -1) = pmatrix(0, 1; 1, 0) = X", fallback: "H·Z·H = X" });
    } else {
      lines.push(`Mach–Zehnder with phase φ = ${phiLabel}: the two arms pick up a relative phase φ and recombine.`);
      lines.push({ math: "H P(φ) H ket(0) = e^{i φ/2} (cos(φ/2) ket(0) - i sin(φ/2) ket(1))", fallback: "H·P(φ)·H|0⟩ = exp(iφ/2)·(cos(φ/2)|0⟩ − i sin(φ/2)|1⟩)" });
      lines.push({ math: "P(0) = cos^2(φ/2)", fallback: "P(0) = cos²(φ/2)" });
      lines.push(`P(0) = cos²(${fmtAngle(phi / 2)}) = ${fmtReal(p0).text}${fmtReal(p0).exact ? ` = ${trimNum(p0)}` : ""}; P(1) = ${fmtReal(1 - p0).text}.`);
      lines.push("The beam splitters are written as H, the convention of P(0) = cos²(φ/2). A symmetric splitter [[1, i], [i, 1]]/√2 exchanges the two output ports, giving P(0) = sin²(φ/2): name the port before comparing with a lab.");
      const pts = Array.from({ length: 181 }, (_, k) => ({ x: 2 * k, y: Math.cos(((2 * k * Math.PI) / 180) / 2) ** 2 }));
      const phDeg = ((((phi * 180) / Math.PI) % 360) + 360) % 360;
      extra.push(
        plot(
          buildPlotSvg(
            [
              { points: pts, type: "line", color: "#1f5fa8", label: "P(0) = cos²(φ/2)" },
              { points: [{ x: phDeg, y: p0 }], type: "scatter", color: "#c00000", label: `φ = ${trimNum(phDeg, 4)}°` },
            ],
            { xlabel: "Phase φ (°)", ylabel: "P(0)", width: 420, height: 270, xLimits: { min: 0, max: 360, step: 90 }, yLimits: { min: 0, max: 1, step: 0.25 } },
          ),
          "Mach–Zehnder fringe: P(0) against the phase φ, with the chosen phase marked.",
          "Interference fringe cos² of half the phase, from 0 to 360 degrees.",
        ),
      );
    }
    lines.push(`Final state: ${st.text}${st.globalPhase ? ` (global phase ${st.globalPhase.text} factored out)` : ""}; P(0) = ${fmtReal(p0).text}, P(1) = ${fmtReal(1 - p0).text}.`);
    if (st.math) lines.push({ math: `ket(ψ) = ${st.math}`, fallback: `|ψ⟩ = ${st.text}` });
    extra.unshift(table("Outcome", [["Outcome", "Probability"], ["|0⟩", fmtReal(p0).text], ["|1⟩", fmtReal(1 - p0).text]]));
    extra.push(plot(circuitDiagramSvg(circ), "The circuit (one qubit from |0⟩).", "One-qubit interference circuit."));
    return finish(lines, extra, outputs);
  },
};

const BELL_NAMES = ["Φ⁺", "Ψ⁺", "Φ⁻", "Ψ⁻"];
const BELL_KEYS = ["Phi+", "Psi+", "Phi-", "Psi-"];

const bellCalc: QCalc = {
  id: "qc-bell",
  name: "Protocol: Bell-state preparation",
  group: "Quantum computing",
  unitContract: "domain",
  hint: "H on q₀ then CNOT q₀ → q₁ turns each basis state |xy⟩ into one of the four maximally entangled Bell states |β_xy⟩.",
  fields: [
    {
      key: "which",
      label: "Input",
      default: "all",
      kind: "select",
      options: [
        { value: "all", label: "All four inputs" },
        { value: "00", label: "|00⟩" },
        { value: "01", label: "|01⟩" },
        { value: "10", label: "|10⟩" },
        { value: "11", label: "|11⟩" },
      ],
    },
  ],
  compute: (r) => {
    const which = r("which") || "all";
    const inputs = which === "all" ? [0, 1, 2, 3] : [parseInt(which, 2)];
    if (inputs.some((k) => !(k >= 0 && k <= 3))) return refuse("Input must be all, 00, 01, 10 or 11.");
    const lines: EngLine[] = [ORDER_NOTE, "Circuit: H on q₀, then CNOT with control q₀ and target q₁."];
    lines.push({ math: "ket(β_{xy}) = CNOT (H otimes I) ket(x y) = {ket(0 y) + (-1)^x ket(1 overline(y))}/sqrt(2)", fallback: "|β_xy⟩ = CNOT·(H ⊗ I)|xy⟩ = (|0y⟩ + (−1)ˣ|1ȳ⟩)/√2" });
    const rows: string[][] = [["Input", "Output state", "Bell state", "Concurrence"]];
    const outputs: EngOutput[] = [];
    let last: State = [];
    for (const k of inputs) {
      const fin = simulate(bellCircuit(), k);
      last = fin;
      const ref = BELL_STATES[BELL_KEYS[k]];
      const same = fin.every((z, i) => cNear(z, ref[i], 1e-12));
      const c = pureTwoQubit(fin[0], fin[1], fin[2], fin[3]);
      const conc = c ? c.concurrence : NaN;
      rows.push([`|${ketLabel(k, 2)}⟩`, fmtState(fin, 2).text, same ? `|${BELL_NAMES[k]}⟩` : "(differs from the reference)", fmtReal(conc).text]);
      outputs.push({ key: `conc_${ketLabel(k, 2)}`, label: `Concurrence from |${ketLabel(k, 2)}⟩`, value: conc, unit: "" });
      lines.push(`|${ketLabel(k, 2)}⟩ → |${BELL_NAMES[k]}⟩ = ${fmtState(fin, 2).text}`);
    }
    lines.push("Every output is maximally entangled (concurrence 1; each qubit alone is maximally mixed, purity ½).");
    const extra: AnalyzeBlock[] = [table("Bell states", rows)];
    const ins = which === "all" ? ["|x⟩", "|y⟩"] : [`|${which[0]}⟩`, `|${which[1]}⟩`];
    extra.push(plot(circuitDiagramSvg(bellCircuit(ins)), "Bell-state preparation: H then CNOT.", "Two-qubit circuit: Hadamard on q0, CNOT from q0 to q1."));
    if (which !== "all") extra.push(plot(probabilityBarsSvg(probabilities(last), 2), `Measurement probabilities of |${BELL_NAMES[inputs[0]]}⟩.`, "Bar chart of outcome probabilities."));
    return finish(lines, extra, outputs);
  },
};

const teleportCalc: QCalc = {
  id: "qc-teleport",
  name: "Protocol: quantum teleportation",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Alice holds |ψ⟩ = α|0⟩ + β|1⟩ (q₀) and shares the Bell pair |Φ⁺⟩ with Bob (q₁, q₂). She applies CNOT and H and " +
    "measures her two qubits; Bob applies X if m₁ = 1 and then Z if m₀ = 1. Gives the four outcomes, their " +
    "probabilities, Bob's qubit before and after the correction, and checks that every branch recovers |ψ⟩.",
  fields: [
    { key: "alpha", label: "α (amplitude of |0⟩)", default: "0.6", kind: "text" },
    { key: "beta", label: "β (amplitude of |1⟩)", default: "0.8i", kind: "text" },
  ],
  compute: (r) => {
    const a = parseComplex(r("alpha")), b = parseComplex(r("beta"));
    if ("error" in a) return refuse(`α: ${a.error === "empty" ? "this field is required" : a.error}`);
    if ("error" in b) return refuse(`β: ${b.error === "empty" ? "this field is required" : b.error}`);
    const nz = normalise([a, b]);
    if (!nz) return refuse("α and β are both zero: there is no state to teleport.");
    const lines: EngLine[] = [ORDER_NOTE];
    if (Math.abs(nz.norm2 - 1) > 1e-9) lines.push(`|α|² + |β|² = ${trimNum(nz.norm2, 6)}, not 1: the state was normalised (divided by ${fmtReal(Math.sqrt(nz.norm2)).text}).`);
    const psi: [Cx, Cx] = [nz.state[0], nz.state[1]];
    const t = teleport(psi);
    const ps = fmtState(psi, 1);
    lines.push(`State to teleport: |ψ⟩ = ${ps.text}.`);
    if (ps.math) lines.push({ math: `ket(ψ) = ${ps.math}`, fallback: `|ψ⟩ = ${ps.text}` });
    lines.push("After Alice's CNOT (q₀ → q₁) and H (q₀), the three-qubit state regroups by her two bits:");
    lines.push({
      math: "(1/2)(ket(00)(α ket(0) + β ket(1)) + ket(01)(α ket(1) + β ket(0)) + ket(10)(α ket(0) - β ket(1)) + ket(11)(α ket(1) - β ket(0)))",
      fallback: "½[|00⟩(α|0⟩ + β|1⟩) + |01⟩(α|1⟩ + β|0⟩) + |10⟩(α|0⟩ − β|1⟩) + |11⟩(α|1⟩ − β|0⟩)]",
    });
    lines.push({ math: "ket(ψ_{Bob}) = Z^{m_0} X^{m_1} ket(φ_{m_0 m_1})", fallback: "|ψ_Bob⟩ = Zᵐ⁰Xᵐ¹|φ⟩: X if m₁ = 1, then Z if m₀ = 1" });
    const rows: string[][] = [["m₀m₁", "Probability", "Bob's qubit before", "Correction", "Bob's qubit after"]];
    const outputs: EngOutput[] = [];
    let allExact = true;
    for (const br of t.branches) {
      const ok = cNear(br.corrected[0], psi[0], 1e-12) && cNear(br.corrected[1], psi[1], 1e-12);
      if (!ok) allExact = false;
      const corr = br.correction === "I" ? "none (I)" : br.correction === "ZX" ? "X then Z" : br.correction;
      rows.push([`${br.m0}${br.m1}`, fmtReal(br.prob).text, fmtState(br.bob, 1).text, corr, fmtState(br.corrected, 1).text]);
      outputs.push({ key: `p${br.m0}${br.m1}`, label: `P(m₀m₁ = ${br.m0}${br.m1})`, value: br.prob, unit: "" });
    }
    // Fidelity of Bob's qubit (deferred-measurement circuit) with |ψ⟩.
    const rhoB = reducedDensity(t.after, 3, [2]);
    const fid = cMul(cMul(cConj(psi[0]), rhoB[0][0]), psi[0]).re + cMul(cMul(cConj(psi[0]), rhoB[0][1]), psi[1]).re + cMul(cMul(cConj(psi[1]), rhoB[1][0]), psi[0]).re + cMul(cMul(cConj(psi[1]), rhoB[1][1]), psi[1]).re;
    outputs.push({ key: "fidelity", label: "Fidelity ⟨ψ|ρ_Bob|ψ⟩", value: fid, unit: "" });
    lines.push(
      allExact
        ? `Every one of the four outcomes (each with probability ${fmtReal(t.branches[0].prob).text} here) leaves Bob, after his correction, with exactly ${ps.text}: not merely up to a phase. Fidelity ⟨ψ|ρ_Bob|ψ⟩ = ${fmtReal(Math.min(1, fid)).text}.`
        : "A branch did not recover |ψ⟩: this is a fault, not physics.",
    );
    lines.push("Nothing travels faster than light: until Bob receives Alice's two classical bits his qubit is maximally mixed (ρ = I/2) whatever |ψ⟩ is.");
    const extra: AnalyzeBlock[] = [table("The four outcomes", rows)];
    extra.push(plot(circuitDiagramSvg(t.circuit), "Teleportation circuit: Bell pair, Alice's CNOT and H, her measurements, and Bob's corrections controlled by her classical bits (double lines).", "Three-qubit teleportation circuit."));
    return finish(lines, extra, outputs);
  },
};

const ENCODE = ["I", "X", "Z", "Z·X (X first)"];

const superdenseCalc: QCalc = {
  id: "qc-superdense",
  name: "Protocol: superdense coding",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Alice and Bob share |Φ⁺⟩. To send two classical bits b₁b₂ Alice applies X if b₂ = 1, then Z if b₁ = 1, to her qubit and sends it; " +
    "Bob's CNOT and H turn the four resulting Bell states back into |b₁b₂⟩ with certainty.",
  fields: [
    {
      key: "bits",
      label: "Bits to send",
      default: "all",
      kind: "select",
      options: [
        { value: "all", label: "All four" },
        { value: "00", label: "00" },
        { value: "01", label: "01" },
        { value: "10", label: "10" },
        { value: "11", label: "11" },
      ],
    },
  ],
  compute: (r) => {
    const bits = r("bits") || "all";
    const list = bits === "all" ? [0, 1, 2, 3] : [parseInt(bits, 2)];
    if (list.some((k) => !(k >= 0 && k <= 3))) return refuse("Bits must be all, 00, 01, 10 or 11.");
    const lines: EngLine[] = [ORDER_NOTE];
    lines.push({ math: "ket(φ) = (Z^{b_1} X^{b_2} otimes I) {ket(00) + ket(11)}/sqrt(2)", fallback: "|φ⟩ = (Zᵇ¹Xᵇ² ⊗ I)(|00⟩ + |11⟩)/√2" });
    lines.push({ math: "(H otimes I) CNOT ket(φ) = ket(b_1 b_2)", fallback: "(H ⊗ I)·CNOT|φ⟩ = |b₁b₂⟩" });
    const rows: string[][] = [["Bits b₁b₂", "Alice applies", "Shared state sent", "Bob decodes", "P(correct)"]];
    const outputs: EngOutput[] = [];
    for (const k of list) {
      const b1 = (k >> 1) as 0 | 1, b2 = (k & 1) as 0 | 1;
      const sd = superdense(b1, b2);
      const pOk = cAbs2(sd.final[k]);
      rows.push([ketLabel(k, 2), ENCODE[k === 0 ? 0 : k === 1 ? 1 : k === 2 ? 2 : 3], fmtState(sd.shared, 2).text, fmtState(sd.final, 2).text, fmtReal(pOk).text]);
      outputs.push({ key: `p_${ketLabel(k, 2)}`, label: `P(Bob reads ${ketLabel(k, 2)})`, value: pOk, unit: "" });
    }
    lines.push("Two classical bits travel in one qubit: the four encodings give the four orthogonal Bell states, so Bob distinguishes them perfectly.");
    const extra: AnalyzeBlock[] = [table("Superdense coding", rows)];
    let circ: Circuit;
    if (bits === "all") {
      const sd = superdense(0, 0);
      circ = { n: 2, ops: [sd.circuit.ops[0], sd.circuit.ops[1], { kind: "block", label: "Encode", qubits: [0], ops: [] }, ...sd.circuit.ops.slice(2)] };
    } else circ = superdense((list[0] >> 1) as 0 | 1, (list[0] & 1) as 0 | 1).circuit;
    extra.push(plot(circuitDiagramSvg(circ), bits === "all" ? "Superdense coding: share Φ⁺, Alice encodes (X if b₂ = 1, then Z if b₁ = 1), Bob decodes with CNOT and H." : `Superdense coding of the bits ${bits}.`, "Two-qubit superdense coding circuit."));
    return finish(lines, extra, outputs);
  },
};

const DJ_ORACLES = [
  { value: "c0", label: "Constant: f(x) = 0" },
  { value: "c1", label: "Constant: f(x) = 1" },
  { value: "first", label: "Balanced: f(x) = x₀" },
  { value: "parity", label: "Balanced: f(x) = x₀ ⊕ x₁ ⊕ …" },
  { value: "table", label: "Truth table (typed below)" },
];

const djCalc: QCalc = {
  id: "qc-deutsch-jozsa",
  name: "Algorithm: Deutsch–Jozsa",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Decides with ONE oracle query whether f: {0,1}ⁿ → {0,1} is constant or balanced (the promise). n = 1 is Deutsch's " +
    "problem. A typed truth table lists f(x) for x = 0…2ⁿ − 1 (x as bits q₀q₁…).",
  fields: [
    { key: "n", label: "Input qubits n", default: "2", kind: "select", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }] },
    { key: "oracle", label: "Oracle f", default: "parity", kind: "select", options: DJ_ORACLES },
    { key: "table", label: "Truth table f(0) … f(2ⁿ − 1) (when chosen above)", default: "0 1 1 0", kind: "text" },
  ],
  compute: (r) => {
    const nn = intField(r("n"), "Input qubits", 1, 3);
    if (typeof nn === "string") return refuse(nn);
    const n = nn, N = 1 << n;
    const kind = r("oracle") || "parity";
    const tableRaw = r("table");
    let f: number[];
    if (kind === "c0") f = new Array(N).fill(0);
    else if (kind === "c1") f = new Array(N).fill(1);
    else if (kind === "first") f = Array.from({ length: N }, (_, x) => (x >> (n - 1)) & 1);
    else if (kind === "parity") f = Array.from({ length: N }, (_, x) => x.toString(2).split("").filter((c) => c === "1").length % 2);
    else {
      const blk = readDataBlock(tableRaw, "Truth table", { maxRows: 16 });
      if (!blk.ok) return refuse(blk.error);
      const vals = blk.rows.flat();
      if (vals.some((v) => v !== 0 && v !== 1)) return refuse("Truth table: every value must be 0 or 1.");
      if (vals.length !== N) return refuse(`Truth table: n = ${n} needs ${N} values f(0) … f(${N - 1}); ${vals.length} given.`);
      f = vals as number[];
    }
    const ones = f.filter((v) => v === 1).length;
    if (ones !== 0 && ones !== N && ones !== N / 2)
      return refuse(`This f is neither constant nor balanced (${ones} of ${N} values are 1). Deutsch–Jozsa answers only under that promise; for other functions its output means nothing.`);
    const dj = deutschJozsa(n, f);
    const constant = ones === 0 || ones === N;
    const amp0 = f.reduce((s, v) => s + (v ? -1 : 1), 0) / N;
    const lines: EngLine[] = [ORDER_NOTE];
    lines.push(`n = ${n} input qubits in |0⟩ and an ancilla q${n} in |1⟩; H on all, one oracle call U_f|x⟩|y⟩ = |x⟩|y ⊕ f(x)⟩, H on the inputs, measure the inputs.`);
    lines.push({ math: "amplitude(ket(0)^{otimes n}) = 1/{2^n} sum(x=0, 2^n - 1, (-1)^{f(x)})", fallback: "amplitude of |0…0⟩ = (1/2ⁿ) Σₓ (−1)ᶠ⁽ˣ⁾" });
    lines.push(`Here Σ(−1)ᶠ⁽ˣ⁾/${N} = ${fmtReal(amp0).text}, so P(inputs all 0) = ${fmtReal(dj.pZero).text} (simulated).`);
    lines.push(constant ? "Result: CONSTANT (the inputs are measured as all zeros with certainty)." : "Result: BALANCED (the all-zeros outcome never occurs).");
    const outputs: EngOutput[] = [{ key: "pZero", label: "P(inputs all 0)", value: dj.pZero, unit: "" }, { key: "constant", label: "Constant (1) or balanced (0)", value: constant ? 1 : 0, unit: "" }];
    const rows = [["x", "f(x)"], ...f.map((v, x) => [ketLabel(x, n), String(v)])];
    const extra: AnalyzeBlock[] = [table("Oracle truth table", rows)];
    extra.push(plot(circuitDiagramSvg(dj.circuit), `Deutsch–Jozsa circuit, n = ${n}: one query to the oracle U_f.`, "Deutsch–Jozsa circuit with an oracle block."));
    const inputs = Array.from({ length: n }, (_, q) => q);
    extra.push(plot(probabilityBarsSvg(marginal(dj.final, n + 1, inputs), n, { qubits: inputs }), "Measurement probabilities of the input register.", "Bar chart of the input-register outcomes."));
    return finish(lines, extra, outputs);
  },
};

const groverCalc: QCalc = {
  id: "qc-grover",
  name: "Algorithm: Grover search (2–3 qubits)",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Searches N = 2ⁿ items for one marked item: H on all qubits, then repeated oracle (phase flip of the marked item) " +
    "and diffuser (inversion about the mean). Leave iterations blank for the optimal count. Gives the success " +
    "probability after each iteration, simulated and by sin²((2k + 1)θ).",
  fields: [
    { key: "n", label: "Qubits n", default: "2", kind: "select", options: [{ value: "2", label: "2 (N = 4)" }, { value: "3", label: "3 (N = 8)" }] },
    { key: "marked", label: "Marked item (bits q₀q₁…)", default: "11", kind: "text" },
    { key: "iters", label: `Iterations (blank = optimal; at most ${GROVER_MAX_ITER})`, default: "", kind: "text" },
  ],
  compute: (r) => {
    const nn = intField(r("n"), "Qubits", 2, 3);
    if (typeof nn === "string") return refuse(nn);
    const n = nn, N = 1 << n;
    const mk = (r("marked") ?? "").trim().replace(/[|⟩>\s]/g, "");
    if (!/^[01]+$/.test(mk) || mk.length !== n) return refuse(`Marked item: write it as ${n} bits (e.g. ${"1".repeat(n)}).`);
    const marked = parseInt(mk, 2);
    const itRaw = (r("iters") ?? "").trim();
    const opt = groverOptimal(N);
    let k = opt;
    if (itRaw) {
      const v = intField(itRaw, "Iterations", 0, GROVER_MAX_ITER);
      if (typeof v === "string") return refuse(v);
      k = v;
    }
    const g = grover(n, marked, k);
    const th = Math.asin(1 / Math.sqrt(N));
    const lines: EngLine[] = [ORDER_NOTE];
    lines.push(`N = ${N} items, marked |${mk}⟩, ${k} iteration${k === 1 ? "" : "s"}${itRaw ? (k === opt ? " (the optimal number)" : ` (the optimal number is ${opt})`) : " (the optimal number)"}.`);
    lines.push({ math: "P_k = sin^2((2k + 1) θ)", fallback: "P_k = sin²((2k + 1)θ)" });
    lines.push({ math: "θ = arcsin(1/sqrt(N))", fallback: "θ = arcsin(1/√N)" });
    lines.push(`θ = ${deg(th)}; optimal k = round(π/(4θ) − ½) = ${opt}.`);
    const rows: string[][] = [["Iteration k", "P(marked), simulated", "sin²((2k + 1)θ)"]];
    g.pPerIter.forEach((p, i) => rows.push([String(i), fmtReal(p).text, fmtReal(Math.sin((2 * i + 1) * th) ** 2).text]));
    const pk = g.pPerIter[g.pPerIter.length - 1];
    const fs = fmtState(g.final, n);
    lines.push(`Final state: ${fs.text}.${fs.text.startsWith("−") ? " (The overall sign −1 is a global phase and is not observable.)" : ""}`);
    lines.push(`Success probability after ${k} iteration${k === 1 ? "" : "s"}: P(|${mk}⟩) = ${fmtReal(pk).text}.`);
    if (k > opt) lines.push("More iterations than optimal rotate past the marked state: the success probability falls again.");
    const outputs: EngOutput[] = [{ key: "pMarked", label: "P(marked)", value: pk, unit: "" }, { key: "iterations", label: "Iterations", value: k, unit: "" }, { key: "optimal", label: "Optimal iterations", value: opt, unit: "" }];
    const extra: AnalyzeBlock[] = [table("Success probability per iteration", rows)];
    extra.push(plot(circuitDiagramSvg(g.circuit), `Grover circuit, n = ${n}, ${k} iteration${k === 1 ? "" : "s"} (oracle then diffuser).`, "Grover search circuit."));
    extra.push(plot(probabilityBarsSvg(probabilities(g.final), n), `Measurement probabilities after ${k} iteration${k === 1 ? "" : "s"}.`, "Bar chart of outcome probabilities."));
    return finish(lines, extra, outputs);
  },
};

const qftCalc: QCalc = {
  id: "qc-qft",
  name: "Algorithm: quantum Fourier transform (2–3 qubits)",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "The QFT circuit (H, controlled phase rotations R_k = P(2π/2ᵏ), final swaps) on a basis state (bits, e.g. 01) or a " +
    "typed state (Dirac form). Checks the circuit against the DFT matrix ωʲᵏ/√N, ω = exp(2πi/N).",
  fields: [
    { key: "n", label: "Qubits n", default: "2", kind: "select", options: [{ value: "2", label: "2 (N = 4)" }, { value: "3", label: "3 (N = 8)" }] },
    { key: "input", label: "Input: bits (01) or a state (0.6|00⟩ + 0.8|11⟩)", default: "01", kind: "text" },
  ],
  compute: (r) => {
    const nn = intField(r("n"), "Qubits", 2, 3);
    if (typeof nn === "string") return refuse(nn);
    const n = nn, N = 1 << n;
    const raw = (r("input") ?? "").trim();
    let init: State;
    const notes: string[] = [];
    let inText: string;
    const bits = raw.replace(/[|⟩>\s]/g, "");
    if (/^[01]+$/.test(bits) && !/\|.*\|/.test(raw) && !/[+−-]/.test(raw)) {
      if (bits.length !== n) return refuse(`Input: ${bits.length} bits given for ${n} qubits.`);
      init = basisState(n, parseInt(bits, 2));
      inText = `|${bits}⟩ (x = ${parseInt(bits, 2)})`;
    } else {
      const k = parseKet(raw);
      if ("error" in k) return refuse(`Input: ${k.error}`);
      if (k.n !== n) return refuse(`Input: the state has ${k.n} qubit${k.n > 1 ? "s" : ""}; n = ${n}.`);
      init = k.state;
      notes.push(...k.notes);
      inText = fmtState(init, n).text;
    }
    const ops = qftOps(n);
    const circ: Circuit = { n, ops };
    const fin = simulate(circ, init);
    // The circuit against the DFT matrix, column by column.
    const F = dftMatrix(n);
    let maxDev = 0;
    for (let x = 0; x < N; x++) {
      const col = simulate(circ, x);
      for (let y = 0; y < N; y++) maxDev = Math.max(maxDev, Math.hypot(col[y].re - F[y][x].re, col[y].im - F[y][x].im));
    }
    const ref = matVec(F, init);
    const fs = fmtState(fin, n);
    const lines: EngLine[] = [ORDER_NOTE, ...notes];
    lines.push({ math: "QFT ket(x) = 1/sqrt(N) sum(k=0, N-1, e^{2 π i x k/N} ket(k))", fallback: "QFT|x⟩ = (1/√N) Σₖ exp(2πixk/N)|k⟩" });
    lines.push(`Input ${inText}; N = ${N}.`);
    lines.push(`Output: ${fs.text}${fs.globalPhase ? ` (global phase ${fs.globalPhase.text} factored out)` : ""}.`);
    if (fs.math) lines.push({ math: `QFT ket(ψ) = ${fs.math}`, fallback: `QFT|ψ⟩ = ${fs.text}` });
    const okDft = maxDev < 1e-12 && fin.every((z, i) => cNear(z, ref[i], 1e-12));
    lines.push(okDft ? "Check: the gate circuit equals the DFT matrix ωʲᵏ/√N entry by entry (to 10⁻¹²)." : "Check FAILED: the circuit does not match the DFT matrix (a fault, not physics).");
    lines.push("Without the final swaps the circuit gives the bit-reversed output; the swaps are part of the transform here.");
    const ot = outcomeRows(fin, n);
    const outputs: EngOutput[] = [{ key: "dftDeviation", label: "Largest |circuit − DFT| entry", value: maxDev, unit: "" }];
    fin.forEach((z, k) => {
      outputs.push({ key: `re_${ketLabel(k, n)}`, label: `Re ⟨${ketLabel(k, n)}|ψ⟩`, value: z.re, unit: "" });
      outputs.push({ key: `im_${ketLabel(k, n)}`, label: `Im ⟨${ketLabel(k, n)}|ψ⟩`, value: z.im, unit: "" });
    });
    const extra: AnalyzeBlock[] = [table("QFT output", ot.rows)];
    extra.push(plot(circuitDiagramSvg(circ, { initial: /^[01]+$/.test(bits) && bits.length === n ? parseInt(bits, 2) : 0 }), `QFT circuit on ${n} qubits: H, controlled R_k = P(2π/2ᵏ), then swaps.`.replace("R_k", "Rₖ"), "Quantum Fourier transform circuit."));
    extra.push(plot(probabilityBarsSvg(probabilities(fin), n), "Measurement probabilities of the QFT output.", "Bar chart of outcome probabilities."));
    return finish(lines, extra, outputs);
  },
};

export const QUANTUM_GATES_CALCS: QCalc[] = [
  singleQubitCalc,
  circuitCalc,
  interferenceCalc,
  bellCalc,
  teleportCalc,
  superdenseCalc,
  djCalc,
  groverCalc,
  qftCalc,
];

export { blochPath };
