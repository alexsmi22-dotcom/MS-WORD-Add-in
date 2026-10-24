// Pane glue for Release Q parts Q1 + Q3 (group "Quantum computing"): states and inner products, operators (checks,
// eigen-decomposition, commutators, the Robertson relation), measurement by the Born rule, density matrices, and
// bipartite entanglement. Kept OUT of taskpane.ts; the integrator spreads QUANTUM_DIRAC_CALCS into ENG_CALCS (the
// group "Quantum computing" already exists from Q2).
//
// No number is computed here: quantumDirac.ts (on quantumCore.ts) owns the arithmetic and quantum.ts the two-qubit
// closed forms used as cross-checks. This file reads the fields, words the result under the display contract (U+2212,
// exact closed forms, no caret, no em dash, NaN or Infinity in an ok result) and draws.
//
// UNIT CONTRACT "domain": nothing here is dimensional — amplitudes, matrix entries, weights and probabilities are pure
// numbers, and an angle inside a coefficient is degrees when written with ° (cos(20°)) and radians otherwise.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { pureTwoQubit, wernerState } from "./quantum";
import {
  GATES,
  ZERO_TOL,
  cAbs,
  cAbs2,
  cx,
  fmtCx,
  fmtReal,
  identity,
  isUnitary,
  kron,
  matNear,
  matScale,
  parseComplex,
  purity,
  norm2Text,
  trimNum,
  type CMat,
  type Cx,
  type State,
} from "./quantumCore";
import {
  BELL_BASIS,
  DIRAC_MAX_DIM,
  anticommutator,
  bellDiagonalRho,
  blochOf,
  checkDensity,
  commutator,
  concurrence,
  densityOf,
  eigGeneral2,
  eigNormal,
  expectation,
  fidelity,
  fmtVec,
  inner,
  isHermitian,
  isNormal,
  isProjector,
  levelLabel,
  measureInBasis,
  measureObservable,
  measureQubitInBasis,
  mixtureRho,
  negativity,
  outer,
  partialTrace,
  measureRegister,
  readOperator,
  readState,
  schmidt,
  traceDistance,
  variance,
  vonNeumannBits,
  wernerRho,
  type Outcome,
  type QVec,
} from "./quantumDirac";
import { blochSphereSvg } from "./quantumCharts";
import { amplitudeChartSvg, matrixHeatmapSvg, quantumBarsSvg } from "./quantumDiracCharts";

type QCalc = EngCalcDef<"Quantum computing">;

const ORDER_NOTE = "Convention: qubits are big-endian, |q₀q₁…⟩ with q₀ the leftmost bit; ⟨φ|ψ⟩ is conjugate-linear in φ.";

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

const isPow2 = (d: number): boolean => d >= 2 && (d & (d - 1)) === 0;
const qubitsOf = (d: number): number | null => (isPow2(d) ? Math.log2(d) : null);

/** A complex number numerically (6 s.f.), always; for "exact = numeric" lines. */
function numCx(z: Cx): string {
  const re = Math.abs(z.re) < ZERO_TOL ? 0 : z.re, im = Math.abs(z.im) < ZERO_TOL ? 0 : z.im;
  if (!im) return trimNum(re);
  if (!re) return `${trimNum(im)}i`;
  return `${trimNum(re)} ${im < 0 ? "−" : "+"} ${trimNum(Math.abs(im))}i`;
}

/**
 * A complex number shown exactly: fmtCx's closed forms, or — when fmtCx prints decimals — a short decimal over √2,
 * √3, 2 or √6 when that is what it is ((0.6 + 0.8i)/√2), checked to 10⁻¹²; null when neither applies.
 */
function exactCx(z: Cx): { text: string; math: string } | null {
  const f = fmtCx(z);
  if (f.exact) return { text: f.text, math: f.math };
  const short = (v: number): boolean => Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-8 && Math.abs(v) < 1e4;
  // A value that is already a short decimal is shown as it is.
  if (short(z.re) && short(z.im)) return null;
  for (const [k, t, m] of [[Math.SQRT2, "√2", "sqrt(2)"], [Math.sqrt(3), "√3", "sqrt(3)"], [Math.sqrt(6), "√6", "sqrt(6)"]] as [number, string, string][]) {
    const w = { re: z.re * k, im: z.im * k };
    if (short(w.re) && short(w.im)) {
      const r = { re: Math.round(w.re * 1e4) / 1e4, im: Math.round(w.im * 1e4) / 1e4 };
      const n = numCx(r);
      const both = Math.abs(r.re) > 0 && Math.abs(r.im) > 0;
      return { text: `${both ? `(${n})` : n}/${t}`, math: `${both ? `(${n.replace(/−/g, "-")})` : n.replace(/−/g, "-")}/${m}` };
    }
  }
  return null;
}

/** "exact = numeric" when they differ, otherwise one of them. */
function showCx(z: Cx): string {
  const e = exactCx(z);
  const n = numCx(z);
  return e && e.text !== n ? `${e.text} = ${n}` : n;
}

/** A matrix as equation syntax pmatrix(a, b; c, d) (≤ 4 × 4) and as table rows. */
function matrixShown(M: CMat): { math: string; rows: string[][] } {
  const cells = M.map((row) => row.map((z) => fmtCx(z)));
  return {
    math: M.length <= 4 ? `pmatrix(${cells.map((r) => r.map((c) => c.math).join(", ")).join("; ")})` : "",
    rows: cells.map((r) => r.map((c) => c.text)),
  };
}

/** A matrix table with ⟨i| row and |j⟩ column labels. */
function matrixTable(label: string, M: CMat, labels: string[]): AnalyzeBlock {
  const m = matrixShown(M);
  return table(label, [["", ...labels.map((l) => `|${l}⟩`)], ...m.rows.map((r, i) => [`⟨${labels[i]}|`, ...r])]);
}

const labelsFor = (d: number): string[] => Array.from({ length: d }, (_, k) => levelLabel(k, d, qubitsOf(d)));

/** M as c·P for a Pauli string P (2 × 2: I X Y Z; 4 × 4: P⊗Q), or "0"; null when it is not one. */
function pauliMultiple(M: CMat): { text: string; math: string } | null {
  const d = M.length;
  if (M.every((r) => r.every((z) => cAbs(z) < 1e-12))) return { text: "0", math: "0" };
  const P1: [string, CMat][] = [["I", GATES.I], ["X", GATES.X], ["Y", GATES.Y], ["Z", GATES.Z]];
  const cands: [string, string, CMat][] =
    d === 2 ? P1.map(([n, m]) => [n, n, m]) : d === 4 ? P1.flatMap(([a, A]) => P1.map(([b, B]) => [`${a}⊗${b}`, `${a} ⊗ ${b}`, kron(A, B)] as [string, string, CMat])) : [];
  for (const [name, nameM, P] of cands) {
    // c = tr(P M)/d (P is Hermitian and P² = I).
    let c: Cx = { re: 0, im: 0 };
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      const a = P[j][i], b = M[i][j];
      c = { re: c.re + a.re * b.re - a.im * b.im, im: c.im + a.re * b.im + a.im * b.re };
    }
    c = { re: c.re / d, im: c.im / d };
    if (!matNear(M, matScale(P, c), 1e-10)) continue;
    const f = fmtCx(c);
    if (f.text === "1") return { text: name, math: nameM };
    if (f.text === "−1") return { text: `−${name}`, math: `-${nameM}` };
    const wrap = f.sum || /\//.test(f.text);
    return { text: `${wrap ? `(${f.text})` : f.text}${name}`, math: `${wrap ? `(${f.math})` : f.math} ${nameM}` };
  }
  return null;
}

/** A state for an operator of dimension d: qubit labels when d = 2ⁿ (falling back to level numbers), else levels. */
function readStateFor(text: string, d: number, noun = "the operator"): QVec | { error: string } {
  if (isPow2(d)) {
    const q = readState(text, "");
    if (!("error" in q) && q.dim === d) return q;
    if (d <= DIRAC_MAX_DIM) {
      const l = readState(text, String(d));
      if (!("error" in l)) return { ...l, qubits: qubitsOf(d) };
    }
    if ("error" in q) return q;
    return { error: `The state has dimension ${q.dim} but ${noun} is ${d} × ${d}.` };
  }
  return readState(text, String(d));
}

/**
 * One real number (a weight, a Werner p) through the same reader as every amplitude (quantumCore.parseComplex), so
 * "1/3" and "0.25" read alike; a string is the refusal.
 */
function realNumber(text: string): number | string {
  const z = parseComplex(text ?? "");
  if ("error" in z) return z.error === "empty" ? "is missing." : z.error;
  if (Math.abs(z.im) > 0) return `"${(text ?? "").trim()}" is complex; it must be a real number.`;
  return z.re;
}

/** ρ = I/d to 10⁻¹². */
const isMaxMixed = (m: CMat): boolean => matNear(m, matScale(identity(m.length), cx(1 / m.length)), 1e-12);

/** An output key from an outcome label: |+−⟩ → pm, λ = −1 → lambda_m1, |Φ⁺⟩ → Phi_p. */
const keyOf = (s: string): string =>
  s
    .replace(/λ\s*=\s*/, "lambda_")
    .replace(/Φ/g, "Phi").replace(/Ψ/g, "Psi")
    .replace(/[−-]|⁻/g, "m").replace(/[+]|⁺/g, "p").replace(/\./g, "_")
    .replace(/[^A-Za-z0-9_]+/g, "")
    .replace(/^_|_$/g, "") || "x";

// ---------------------------------------------------------------------------------------------------------------
// 1. States and inner products
// ---------------------------------------------------------------------------------------------------------------

const DIM_FIELD = { key: "dim", label: "Dimension (auto = qubits from the labels; or 2–16 for one d-level system)", default: "auto", kind: "text" as const };

const statesCalc: QCalc = {
  id: "qc-dirac-states",
  name: "States and inner products (Dirac notation)",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Type two states in Dirac form, e.g. 0.6|0⟩ + 0.8i|1⟩ and |+⟩ (labels: 0/1 strings for qubits, |+⟩ |−⟩ |i⟩ |−i⟩, " +
    "Bell states |Φ⁺⟩ |Φ⁻⟩ |Ψ⁺⟩ |Ψ⁻⟩), or an amplitude list (0.6, 0.8i). Coefficients: 1/sqrt(2), e^(i pi/4), cos(20°) " +
    "(a bare cos(20) is radians). For a d-level system give the dimension and write |0⟩ … |d−1⟩. Gives the norms, " +
    "⟨φ|ψ⟩ (exact when recognised), |⟨φ|ψ⟩|², orthogonality, the outer product |ψ⟩⟨φ| and the projector |ψ⟩⟨ψ|.",
  fields: [
    { key: "psi", label: "State |ψ⟩", default: "0.6|0⟩ + 0.8i|1⟩", kind: "text" },
    { key: "phi", label: "State |φ⟩", default: "|+⟩", kind: "text" },
    DIM_FIELD,
  ],
  compute: (r) => {
    const ps = readState(r("psi"), r("dim"));
    if ("error" in ps) return refuse(`|ψ⟩: ${ps.error}`);
    const ph = readState(r("phi"), r("dim"));
    if ("error" in ph) return refuse(`|φ⟩: ${ph.error}`);
    if (ps.dim !== ph.dim)
      return refuse(`⟨φ|ψ⟩ needs both states in the same space: |φ⟩ has dimension ${ph.dim}${ph.qubits !== null ? ` (${ph.qubits} qubit${ph.qubits > 1 ? "s" : ""})` : ""} and |ψ⟩ has ${ps.dim}${ps.qubits !== null ? ` (${ps.qubits} qubit${ps.qubits > 1 ? "s" : ""})` : ""}.`);
    const d = ps.dim;
    const qb = ps.qubits ?? ph.qubits;
    const psi = ps.state, phi = ph.state;
    const ip = inner(phi, psi);
    const ov = cAbs2(ip);
    const sP = fmtVec(psi, d, qb), sF = fmtVec(phi, d, qb);
    const lines: EngLine[] = [];
    if (qb !== null && qb > 1) lines.push(ORDER_NOTE);
    else lines.push("Convention: ⟨φ|ψ⟩ = Σₖ φₖ* ψₖ, conjugate-linear in φ.");
    for (const n of ps.notes) lines.push(`|ψ⟩: ${n}`);
    for (const n of ph.notes) lines.push(`|φ⟩: ${n}`);
    lines.push(`|ψ⟩ = ${sP.text}${sP.globalPhase ? ` (global phase ${sP.globalPhase.text} factored out)` : ""}; ‖ψ‖² as typed = ${norm2Text(ps.norm)}.`);
    if (sP.math) lines.push({ math: `ket(ψ) = ${sP.math}`, fallback: `|ψ⟩ = ${sP.text}` });
    lines.push(`|φ⟩ = ${sF.text}${sF.globalPhase ? ` (global phase ${sF.globalPhase.text} factored out)` : ""}; ‖φ‖² as typed = ${norm2Text(ph.norm)}.`);
    if (sF.math) lines.push({ math: `ket(φ) = ${sF.math}`, fallback: `|φ⟩ = ${sF.text}` });
    lines.push("Both states are used normalised (‖ψ‖ = ‖φ‖ = 1).");
    const ex = exactCx(ip);
    lines.push(`Inner product ⟨φ|ψ⟩ = ${showCx(ip)}.`);
    lines.push({ math: `braket(φ, ψ) = sum(k=0, d-1, bar(φ_k) ψ_k) = ${ex ? ex.math : fmtCx(ip).math}`, fallback: `⟨φ|ψ⟩ = Σ φₖ* ψₖ = ${ex ? ex.text : numCx(ip)}` });
    lines.push(`Overlap |⟨φ|ψ⟩|² = ${fmtReal(ov).text}${fmtReal(ov).exact && fmtReal(ov).text !== trimNum(ov) ? ` = ${trimNum(ov)}` : ""}: the probability that |ψ⟩, measured in a basis containing |φ⟩, is found in |φ⟩.`);
    lines.push({ math: "P = abs(braket(φ, ψ))^2", fallback: "P = |⟨φ|ψ⟩|²" });
    if (ov < 1e-12) lines.push("The states are ORTHOGONAL (⟨φ|ψ⟩ = 0): perfectly distinguishable by one measurement.");
    else if (Math.abs(ov - 1) < 1e-12) lines.push("|⟨φ|ψ⟩|² = 1: the states are the SAME physical state (equal up to a global phase).");
    else lines.push("The states are neither orthogonal nor equal: no measurement distinguishes them with certainty.");
    const outputs: EngOutput[] = [
      { key: "ipRe", label: "Re ⟨φ|ψ⟩", value: ip.re, unit: "" },
      { key: "ipIm", label: "Im ⟨φ|ψ⟩", value: ip.im, unit: "" },
      { key: "overlap", label: "|⟨φ|ψ⟩|²", value: ov, unit: "" },
      { key: "normPsi2", label: "‖ψ‖² as typed", value: ps.norm2, unit: "" },
      { key: "normPhi2", label: "‖φ‖² as typed", value: ph.norm2, unit: "" },
      { key: "dim", label: "Dimension", value: d, unit: "" },
    ];
    const labels = labelsFor(d).map((l, k) => (qb !== null ? l : String(k)));
    const extra: AnalyzeBlock[] = [];
    const ampRows = labels.map((l, k) => [`|${l}⟩`, fmtCx(psi[k]).text, fmtCx(phi[k]).text]).filter((_, k) => d <= 16 || cAbs(psi[k]) > ZERO_TOL || cAbs(phi[k]) > ZERO_TOL);
    if (ampRows.length > 64 || ampRows.length < d) lines.push(`The amplitude table lists ${Math.min(64, ampRows.length)} of the ${ampRows.length} basis states where |ψ⟩ or |φ⟩ is non-zero${ampRows.length < d ? ` (both are zero on the other ${d - ampRows.length})` : ""}.`);
    extra.push(table("Amplitudes", [["Basis state", "ψₖ", "φₖ"], ...ampRows.slice(0, 64)]));
    if (d <= DIRAC_MAX_DIM) {
      lines.push({ math: "(ket(ψ) bra(φ))_{jk} = ψ_j bar(φ_k)", fallback: "(|ψ⟩⟨φ|)ⱼₖ = ψⱼ φₖ*" });
      extra.push(matrixTable("Outer product |ψ⟩⟨φ|", outer(psi, phi), labels));
      extra.push(matrixTable("Projector |ψ⟩⟨ψ| (onto |ψ⟩)", outer(psi, psi), labels));
    } else lines.push(`The outer product and the projector are ${d} × ${d}; they are tabulated only up to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}.`);
    extra.push(
      plot(
        amplitudeChartSvg(labels.map((l) => `|${l}⟩`), [{ name: "|ψ⟩", amps: psi }, { name: "|φ⟩", amps: phi }]),
        "Amplitudes of |ψ⟩ (blue) and |φ⟩ (orange): modulus |cₖ| above, phase arg cₖ below (no phase is drawn for a zero amplitude).",
        `Bar chart of the moduli and stem chart of the phases of the amplitudes of two ${d}-dimensional states.`,
      ),
    );
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Operators
// ---------------------------------------------------------------------------------------------------------------

const operatorsCalc: QCalc = {
  id: "qc-operators",
  name: "Operators: Hermitian, unitary, eigen-decomposition, commutators",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Type an operator as a matrix ([[2, 1-i], [1+i, 3]], or rows separated by ; or by lines) or as an expression in " +
    "I X Y Z H S T S† T† √X Rx(θ) Ry(θ) Rz(θ), σx σy σz, CNOT CZ SWAP and outer products |a⟩⟨b|, with + − * / ⊗ † and " +
    "brackets: X⊗Z, 0.5*(I + Z), H S H†, [X, Y] (commutator), {X, Y} (anticommutator). Up to 16 × 16. Gives the Hermitian, " +
    "unitary, normal and projector checks, the eigenvalues and eigenvectors in Dirac form, the spectral decomposition; with " +
    "a second operator B the commutator and anticommutator; with a state ⟨A⟩, Var A and the Robertson bound σA σB ≥ ½|⟨[A, B]⟩|.",
  fields: [
    { key: "A", label: "Operator A", default: "[[2, 1-i], [1+i, 3]]", kind: "text" },
    { key: "B", label: "Second operator B (optional)", default: "", kind: "text" },
    { key: "state", label: "State |ψ⟩ for ⟨A⟩ and the uncertainty relation (optional)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const a = readOperator(r("A"));
    if ("error" in a) return refuse(`Operator A: ${a.error}`);
    const A = a.M, d = a.dim;
    const labels = labelsFor(d);
    const qb = qubitsOf(d);
    let B: CMat | null = null;
    if ((r("B") ?? "").trim()) {
      const b = readOperator(r("B"));
      if ("error" in b) return refuse(`Operator B: ${b.error}`);
      if (b.dim !== d) return refuse(`A is ${d} × ${d} and B is ${b.dim} × ${b.dim}: the commutator needs two operators on the same space.`);
      B = b.M;
    }
    let psi: State | null = null;
    let psiNotes: string[] = [];
    if ((r("state") ?? "").trim()) {
      const s = readStateFor(r("state"), d);
      if ("error" in s) return refuse(`State: ${s.error}`);
      if (s.dim !== d) return refuse(`The state has dimension ${s.dim} but A is ${d} × ${d}.`);
      psi = s.state;
      psiNotes = s.notes;
    }
    const lines: EngLine[] = [];
    if (qb !== null && qb > 1) lines.push("Convention: qubits are big-endian, |q₀q₁…⟩ with q₀ the leftmost bit; A ⊗ B acts with A on q₀.");
    const herm = isHermitian(A), unit = isUnitary(A), norm = isNormal(A), proj = isProjector(A);
    const am = matrixShown(A);
    const named = pauliMultiple(A);
    lines.push(`A is ${d} × ${d}${named && named.text !== "0" && a.form === "matrix" ? ` (= ${named.text})` : ""}.`);
    if (am.math) lines.push({ math: `A = ${am.math}`, fallback: `A = [${am.rows.map((x) => x.join(", ")).join("; ")}]` });
    lines.push(
      `Checks: Hermitian (A† = A) ${herm ? "yes" : "no"}; unitary (A†A = I) ${unit ? "yes" : "no"}; normal (AA† = A†A) ${norm ? "yes" : "no"}; projector (A² = A = A†) ${proj ? "yes" : "no"} (each to 10⁻⁹ of the matrix scale).`,
    );
    const outputs: EngOutput[] = [
      { key: "hermitian", label: "Hermitian (1 = yes)", value: herm ? 1 : 0, unit: "" },
      { key: "unitary", label: "Unitary (1 = yes)", value: unit ? 1 : 0, unit: "" },
      { key: "normal", label: "Normal (1 = yes)", value: norm ? 1 : 0, unit: "" },
      { key: "projector", label: "Projector (1 = yes)", value: proj ? 1 : 0, unit: "" },
    ];
    const extra: AnalyzeBlock[] = [matrixTable("Operator A", A, labels)];
    // Eigen-decomposition.
    const eigRows: string[][] = [["k", "Eigenvalue λₖ", "Eigenvector |vₖ⟩"]];
    if (norm) {
      const e = eigNormal(A);
      if (!e) return refuse("The eigen-decomposition did not converge for this matrix.");
      lines.push(`Eigenvalues (${herm ? "real, A is Hermitian" : unit ? "on the unit circle, A is unitary" : "A is normal"}): ${e.values.map((l) => fmtCx(l).text).join(", ")}.`);
      lines.push({ math: "A ket(v_k) = λ_k ket(v_k)", fallback: "A|vₖ⟩ = λₖ|vₖ⟩" });
      e.values.forEach((l, k) => {
        const v = fmtVec(e.vectors[k], d, qb);
        eigRows.push([String(k + 1), fmtCx(l).text, v.text]);
        if (k < 16) {
          outputs.push({ key: `eig${k + 1}Re`, label: `Re λ${k + 1}`, value: l.re, unit: "" });
          if (!herm) outputs.push({ key: `eig${k + 1}Im`, label: `Im λ${k + 1}`, value: l.im, unit: "" });
        }
      });
      lines.push("Eigenvectors are orthonormal, each shown with its first non-zero component real and positive (an eigenvector is defined only up to a phase).");
      const degen = e.clusters.filter((c) => c.length > 1);
      if (degen.length)
        lines.push(`Degenerate: ${degen.map((c) => `λ = ${fmtCx(e.values[c[0]]).text} (${c.length}-fold)`).join("; ")}; inside a degenerate eigenspace any orthonormal basis is equally valid, so those eigenvectors are one choice; the projector onto the eigenspace is unique.`);
      lines.push("Spectral decomposition (A is normal, so it is diagonal in an orthonormal eigenbasis):");
      lines.push({ math: "A = sum(k=1, d, λ_k ket(v_k) bra(v_k))", fallback: "A = Σₖ λₖ |vₖ⟩⟨vₖ|" });
      if (d <= 4) {
        let sum = "";
        e.values.forEach((l, k) => {
          const lt = fmtCx(l);
          if (lt.text === "0") return;
          const neg = !lt.sum && lt.text.startsWith("−");
          const body = lt.sum ? `(${lt.text})` : lt.text.replace(/^−/, "");
          const term = `${body === "1" ? "" : body}|v${k + 1}⟩⟨v${k + 1}|`;
          sum += sum ? ` ${neg ? "−" : "+"} ${term}` : `${neg ? "−" : ""}${term}`;
        });
        if (sum) lines.push(`  A = ${sum}, with the |vₖ⟩ in the table.`);
      }
      extra.push(table("Eigen-decomposition", eigRows));
    } else if (d === 2) {
      const [l1, l2] = eigGeneral2(A);
      lines.push(`Eigenvalues: ${fmtCx(l1).text}, ${fmtCx(l2).text} (from λ² − tr(A) λ + det A = 0).`);
      lines.push("A is NOT normal, so its eigenvectors are not orthogonal and it has no spectral decomposition A = Σ λ|v⟩⟨v|.");
      outputs.push({ key: "eig1Re", label: "Re λ1", value: l1.re, unit: "" }, { key: "eig1Im", label: "Im λ1", value: l1.im, unit: "" });
      outputs.push({ key: "eig2Re", label: "Re λ2", value: l2.re, unit: "" }, { key: "eig2Im", label: "Im λ2", value: l2.im, unit: "" });
    } else {
      lines.push(`A is NOT normal (AA† ≠ A†A): it has no orthonormal eigenbasis and no spectral decomposition. Eigenvalues of a non-normal matrix larger than 2 × 2 are not computed here (they are ill-conditioned and not observables).`);
    }
    // Commutator and anticommutator.
    if (B) {
      const C = commutator(A, B), K = anticommutator(A, B);
      const cn = pauliMultiple(C), kn = pauliMultiple(K);
      const commute = C.every((row) => row.every((z) => cAbs(z) < 1e-12));
      lines.push(`Commutator [A, B] = AB − BA${cn ? ` = ${cn.text}` : ""}${commute ? ": A and B COMMUTE (they share an eigenbasis when both are normal)" : ""}.`);
      lines.push({ math: `[A, B] = A B - B A${cn ? ` = ${cn.math}` : ""}`, fallback: `[A, B] = AB − BA${cn ? ` = ${cn.text}` : ""}` });
      lines.push(`Anticommutator {A, B} = AB + BA${kn ? ` = ${kn.text}` : ""}.`);
      lines.push({ math: `[A, B]_+ = A B + B A${kn ? ` = ${kn.math}` : ""}`, fallback: `{A, B} = AB + BA${kn ? ` = ${kn.text}` : ""}` });
      extra.push(matrixTable("Commutator [A, B]", C, labels));
      extra.push(matrixTable("Anticommutator {A, B}", K, labels));
      outputs.push({ key: "commutes", label: "A and B commute (1 = yes)", value: commute ? 1 : 0, unit: "" });
    }
    // Expectation values and the Robertson relation.
    if (psi) {
      for (const n of psiNotes) lines.push(`State: ${n}`);
      const sv = fmtVec(psi, d, qb);
      lines.push(`State |ψ⟩ = ${sv.text}.`);
      const eA = expectation(A, psi);
      lines.push({ math: "expval(A) = braket(ψ, A ψ)", fallback: "⟨A⟩ = ⟨ψ|A|ψ⟩" });
      if (herm) {
        const vA = variance(A, psi);
        lines.push(`⟨A⟩ = ${showCx(cx(eA.re))}; Var A = ⟨A²⟩ − ⟨A⟩² = ${trimNum(vA)}; σA = ${trimNum(Math.sqrt(vA))}.`);
        outputs.push({ key: "expA", label: "⟨A⟩", value: eA.re, unit: "" }, { key: "varA", label: "Var A", value: vA, unit: "" });
        if (B) {
          if (!isHermitian(B)) lines.push("B is not Hermitian, so σB and the Robertson relation (which is about two observables) are not given.");
          else {
            const eB = expectation(B, psi);
            const vB = variance(B, psi);
            const eC = expectation(commutator(A, B), psi);
            const lhs = Math.sqrt(vA) * Math.sqrt(vB);
            const bound = 0.5 * cAbs(eC);
            lines.push(`⟨B⟩ = ${showCx(cx(eB.re))}; Var B = ${trimNum(vB)}; σB = ${trimNum(Math.sqrt(vB))}.`);
            lines.push(`Robertson uncertainty relation: σA σB = ${trimNum(lhs)} ≥ ½|⟨[A, B]⟩| = ${trimNum(bound)}${Math.abs(lhs - bound) < 1e-9 ? " (saturated: equality holds in this state)" : ""}.`);
            lines.push({ math: "σ_A σ_B >= (1/2) abs(expval([A, B]))", fallback: "σA σB ≥ ½|⟨[A, B]⟩|" });
            if (lhs + 1e-9 < bound) lines.push("The product is BELOW the bound, which cannot happen for Hermitian A and B; check the inputs.");
            outputs.push(
              { key: "expB", label: "⟨B⟩", value: eB.re, unit: "" },
              { key: "varB", label: "Var B", value: vB, unit: "" },
              { key: "sigmaProduct", label: "σA σB", value: lhs, unit: "" },
              { key: "robertsonBound", label: "½|⟨[A, B]⟩|", value: bound, unit: "" },
            );
          }
        }
      } else {
        lines.push(`⟨ψ|A|ψ⟩ = ${showCx(eA)}; A is not Hermitian, so this is not the mean of a measurement and no variance is given.`);
        outputs.push({ key: "expARe", label: "Re ⟨ψ|A|ψ⟩", value: eA.re, unit: "" }, { key: "expAIm", label: "Im ⟨ψ|A|ψ⟩", value: eA.im, unit: "" });
      }
    }
    extra.push(
      plot(
        matrixHeatmapSvg(A, labels, (z) => fmtCx(z).text, "|Aᵢⱼ|"),
        `Operator A as a heat map of |Aᵢⱼ| (row ⟨i|, column |j⟩)${d <= 4 ? ", each entry printed" : ""}.`,
        `Heat map of the moduli of the entries of a ${d} × ${d} operator.`,
      ),
    );
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Measurement (Born rule)
// ---------------------------------------------------------------------------------------------------------------

const measurementCalc: QCalc = {
  id: "qc-measurement",
  name: "Measurement (Born rule)",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Type a state and choose the measurement: the computational basis, the X basis (|+⟩, |−⟩), the Y basis (|+i⟩, |−i⟩), " +
    "the Bell basis (two qubits), a typed orthonormal set (one ket per line) or an observable (Hermitian operator, e.g. " +
    "X⊗Z or [[1, 0], [0, −1]]). Give a qubit number to measure only that qubit of a register (computational, X or Y). " +
    "Gives each outcome's probability P = |⟨b|ψ⟩|², the renormalised post-measurement state and the expectation value.",
  fields: [
    { key: "state", label: "State |ψ⟩", default: "0.6|0⟩ + 0.8i|1⟩", kind: "text" },
    DIM_FIELD,
    {
      key: "basis",
      label: "Measurement",
      default: "Z",
      kind: "select",
      options: [
        { value: "Z", label: "Computational basis (Z)" },
        { value: "X", label: "X basis |+⟩, |−⟩" },
        { value: "Y", label: "Y basis |+i⟩, |−i⟩" },
        { value: "bell", label: "Bell basis (two qubits)" },
        { value: "typed", label: "Typed orthonormal set" },
        { value: "observable", label: "Observable (Hermitian operator)" },
      ],
    },
    { key: "qubit", label: "Measure only qubit (blank = the whole register)", default: "", kind: "text" },
    { key: "set", label: "Typed basis, one ket per line (when chosen)", default: "|+⟩\n|−⟩", kind: "block", rows: 4 },
    { key: "obs", label: "Observable (when chosen)", default: "X", kind: "text" },
  ],
  compute: (r) => {
    const s = readState(r("state"), r("dim"));
    if ("error" in s) return refuse(`State: ${s.error}`);
    const psi = s.state, d = s.dim, qb = s.qubits;
    const basis = (r("basis") || "Z") as "Z" | "X" | "Y" | "bell" | "typed" | "observable";
    const qRaw = (r("qubit") ?? "").trim();
    const lines: EngLine[] = [];
    if (qb !== null && qb > 1) lines.push("Convention: qubits are big-endian, |q₀q₁…⟩ with q₀ the leftmost bit.");
    for (const n of s.notes) lines.push(`State: ${n}`);
    const sv = fmtVec(psi, d, qb);
    lines.push(`State |ψ⟩ = ${sv.text}${sv.globalPhase ? ` (global phase ${sv.globalPhase.text} factored out)` : ""}.`);
    let outcomes: Outcome[];
    let what: string;
    let mean: number | null = null;
    let meanName = "";
    let partial = false;
    if (qRaw) {
      if (basis !== "Z" && basis !== "X" && basis !== "Y") return refuse("A single qubit is measured in the computational, X or Y basis; clear the qubit field for the Bell basis, a typed set or an observable.");
      if (qb === null) return refuse("A qubit can be picked out only of a qubit register (labels written as 0/1 strings).");
      if (!/^\d+$/.test(qRaw) || Number(qRaw) >= qb) return refuse(`The qubit to measure must be a whole number from 0 to ${qb - 1} ("${qRaw}" given).`);
      const q = Number(qRaw);
      outcomes = measureQubitInBasis(psi, qb, q, basis);
      partial = qb > 1;
      what = `qubit q${q} in the ${basis === "Z" ? "computational" : basis} basis`;
      mean = outcomes[0].prob - outcomes[1].prob;
      meanName = `⟨${basis}${qb > 1 ? `_${q}` : ""}⟩`;
      lines.push(`Measuring ${what}; the other qubits are not measured, so each post-measurement state is the whole register renormalised.`);
      lines.push({ math: `P(m) = norm(Π_m ket(ψ))^2`, fallback: "P(m) = ‖Πₘ|ψ⟩‖²" });
      lines.push({ math: `ket(ψ_m) = {Π_m ket(ψ)}/sqrt(P(m))`, fallback: "|ψₘ⟩ = Πₘ|ψ⟩/√P(m)" });
    } else if (basis === "observable") {
      const o = readOperator(r("obs"));
      if ("error" in o) return refuse(`Observable: ${o.error}`);
      const m = measureObservable(psi, o.M);
      if ("error" in m) return refuse(m.error);
      outcomes = m.outcomes;
      what = "the observable";
      mean = outcomes.reduce((t, x) => t + (x.value ?? 0) * x.prob, 0);
      meanName = "⟨A⟩";
      const degen = m.eig.clusters.some((c) => c.length > 1);
      lines.push(`Measuring the observable A: the outcomes are its eigenvalues ${outcomes.map((x) => trimNum(x.value ?? 0)).join(", ")}.`);
      if (degen) lines.push("A has a degenerate eigenvalue: its outcome projects onto the WHOLE eigenspace (Lüders rule), so the post-measurement state keeps every component in it.");
      lines.push({ math: "P(λ) = braket(ψ, P_λ ψ)", fallback: "P(λ) = ⟨ψ|P_λ|ψ⟩, P_λ the projector onto the λ eigenspace" });
      lines.push({ math: "ket(ψ_λ) = {P_λ ket(ψ)}/sqrt(P(λ))", fallback: "|ψ_λ⟩ = P_λ|ψ⟩/√P(λ)" });
    } else if (basis === "Z" || basis === "X" || basis === "Y") {
      if (qb === null) return refuse(`The ${basis === "Z" ? "computational" : basis} basis of a register needs qubit labels; for a d-level system choose a typed set or an observable (the computational basis |0⟩ … |d−1⟩ is the typed set of those kets).`);
      // Rotated into the computational frame and read off: O(n·2ⁿ), never 2ⁿ basis vectors compared.
      outcomes = measureRegister(psi, qb, basis);
      what = `the ${basis === "Z" ? "computational" : basis} basis`;
      if (qb === 1) {
        // One qubit in a Pauli basis: the outcomes are the ±1 eigenvalues of that Pauli operator.
        mean = outcomes[0].prob - outcomes[1].prob;
        meanName = `⟨${basis}⟩`;
      }
      lines.push(`Measuring in ${what}: P(b) = |⟨b|ψ⟩|², and the state after outcome b is |b⟩.`);
      lines.push({ math: "P(b) = abs(braket(b, ψ))^2", fallback: "P(b) = |⟨b|ψ⟩|²" });
    } else {
      let set: { label: string; v: State }[];
      if (basis === "bell") {
        if (d !== 4 || qb !== 2) return refuse(`The Bell basis is a basis of TWO qubits; the state has ${qb !== null ? `${qb} qubit${qb > 1 ? "s" : ""}` : `dimension ${d}`}.`);
        set = BELL_BASIS;
        what = "the Bell basis";
      } else if (basis === "typed") {
        const rows = (r("set") ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (!rows.length) return refuse("Typed basis: type one ket per line, e.g. |+⟩ and |−⟩.");
        if (rows.length > DIRAC_MAX_DIM) return refuse(`Typed basis: at most ${DIRAC_MAX_DIM} vectors (${rows.length} given); for a larger register use the computational, X or Y basis.`);
        if (rows.length > d) return refuse(`Typed basis: ${rows.length} vectors were given for a ${d}-dimensional space; at most ${d} can be orthonormal.`);
        set = [];
        for (let k = 0; k < rows.length; k++) {
          const b = readState(rows[k], qb === null ? String(d) : "");
          if ("error" in b) return refuse(`Typed basis, line ${k + 1}: ${b.error}`);
          if (b.dim !== d) return refuse(`Typed basis, line ${k + 1}: the vector has dimension ${b.dim} but the state has ${d}.`);
          for (const n of b.notes) lines.push(`Basis vector ${k + 1}: ${n}`);
          // Labelled as typed when it is one ket (|+⟩), else b₁, b₂, ….
          const one = /^\|([^|⟩]{1,12})⟩$/.exec(rows[k]);
          set.push({ label: one ? one[1].replace(/-/g, "−") : `b${"₀₁₂₃₄₅₆₇₈₉"[(k + 1) % 10]}`, v: b.state });
        }
        what = "the typed set";
      } else return refuse("Unknown measurement.");
      const m = measureInBasis(psi, set);
      if ("error" in m) return refuse(m.error);
      outcomes = m;
      lines.push(`Measuring in ${what}: P(b) = |⟨b|ψ⟩|², and the state after outcome b is |b⟩.`);
      lines.push({ math: "P(b) = abs(braket(b, ψ))^2", fallback: "P(b) = |⟨b|ψ⟩|²" });
      if (basis === "typed" && set.length < d) lines.push(`The typed set has ${set.length} vectors in a ${d}-dimensional space: the rest of the probability is the outcome "none of the listed".`);
    }
    const disp = (o: Outcome): string => (/^[|λ]/.test(o.label) || o.label === "none of the listed" ? o.label : `|${o.label}⟩`);
    const total = outcomes.reduce((t, o) => t + o.prob, 0);
    const rows: string[][] = [["Outcome", "Probability", "Post-measurement state"]];
    const outputs: EngOutput[] = [];
    // Up to 16 outcomes all listed; beyond that the possible ones only, at most 64 rows (said in the result).
    const listed = outcomes.length <= 16 ? outcomes : outcomes.filter((o) => o.prob > ZERO_TOL);
    const postText = (o: Outcome): string => (o.post ? fmtVec(o.post, d, qb).text : o.prob > ZERO_TOL ? `that basis state, ${disp(o)}` : "(outcome impossible)");
    listed.slice(0, 64).forEach((o) => rows.push([disp(o), fmtReal(o.prob).text, postText(o)]));
    if (listed.length < outcomes.length || listed.length > 64)
      lines.push(`The table lists ${Math.min(64, listed.length)} of the ${listed.length} possible outcomes${listed.length < outcomes.length ? ` (${outcomes.length - listed.length} outcomes have probability 0)` : ""}.`);
    outcomes.slice(0, 32).forEach((o) => outputs.push({ key: `p_${keyOf(o.label)}`, label: `P(${disp(o)})`, value: o.prob, unit: "" }));
    if (outcomes.length <= 8) {
      lines.push("Outcomes:");
      for (const o of outcomes) lines.push(`  ${disp(o)}: P = ${fmtReal(o.prob).text}${fmtReal(o.prob).exact && fmtReal(o.prob).text !== trimNum(o.prob) ? ` = ${trimNum(o.prob)}` : ""}${o.prob > ZERO_TOL ? `; afterwards ${postText(o)}` : "; impossible"}.`);
    } else lines.push(`${outcomes.filter((o) => o.prob > ZERO_TOL).length} of the ${outcomes.length} outcomes have non-zero probability (table below).`);
    lines.push(`The probabilities sum to ${trimNum(total)}.`);
    if (mean !== null) {
      lines.push(`Expectation value ${meanName} = ${trimNum(mean)}${basis === "observable" && !qRaw ? " (Σ λ P(λ))" : " (outcome values +1 and −1)"}.`);
      outputs.push({ key: "expectation", label: `Expectation ${meanName}`, value: mean, unit: "" });
    }
    if (partial) lines.push("A partial measurement leaves the unmeasured qubits in a superposition; the post-measurement states above are the whole register.");
    const extra: AnalyzeBlock[] = [table(`Measurement in ${what}`, rows)];
    // The 32 most probable, drawn in their own order.
    const top = new Set(outcomes.length > 32 ? [...outcomes].sort((x, y) => y.prob - x.prob).slice(0, 32) : outcomes);
    const shown = outcomes.filter((o) => top.has(o));
    // Long X / Y register labels are drawn rotated, where a turned minus reads as a bar: they are drawn as bits instead.
    const asBits = !qRaw && (basis === "X" || basis === "Y") && qb !== null && qb > 3;
    const bitLabel = (o: Outcome): string => `|${o.label.replace(/[+−]i?/g, (m) => (m.startsWith("+") ? "0" : "1"))}⟩`;
    extra.push(
      plot(
        quantumBarsSvg({
          values: shown.map((o) => o.prob),
          labels: shown.map(asBits ? bitLabel : disp),
          yTitle: "Probability",
          xTitle: asBits ? `Outcome, ${basis} basis (bit 0 = ${basis === "X" ? "+" : "+i"}, 1 = ${basis === "X" ? "−" : "−i"})` : `Outcome (${what})`,
          note: outcomes.length > 32 ? `the 32 most probable of ${outcomes.length} outcomes` : undefined,
        }),
        `Outcome probabilities, measuring ${what}.`,
        "Bar chart of measurement outcome probabilities.",
      ),
    );
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Density matrix
// ---------------------------------------------------------------------------------------------------------------

/** ρ from the mode fields; an error names the field. */
function readRho(mode: string, r: (k: string) => string, keyState: string, keyMix: string, keyMatrix: string, dimText: string): { rho: CMat; notes: string[]; how: string } | { error: string } {
  if (mode === "pure") {
    const s = readState(r(keyState), dimText);
    if ("error" in s) return { error: `State: ${s.error}` };
    if (s.dim > DIRAC_MAX_DIM) return { error: `Density matrices are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM} (4 qubits); the state has dimension ${s.dim}.` };
    return { rho: densityOf(s.state), notes: s.notes, how: `ρ = |ψ⟩⟨ψ| with |ψ⟩ = ${fmtVec(s.state, s.dim, s.qubits).text}` };
  }
  if (mode === "mixture") {
    const lines = (r(keyMix) ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return { error: "Mixture: type one 'weight: state' per line, e.g. 0.7: |0⟩." };
    if (lines.length > 32) return { error: "Mixture: at most 32 states." };
    const items: { w: number; psi: State }[] = [];
    const notes: string[] = [];
    let dim = 0;
    for (let k = 0; k < lines.length; k++) {
      const m = /^([^:|]+):\s*(.+)$/.exec(lines[k]);
      if (!m) return { error: `Mixture, line ${k + 1}: write it as 'weight: state' (0.7: |0⟩).` };
      const w = realNumber(m[1]);
      if (typeof w === "string") return { error: `Mixture, line ${k + 1}: the weight ${w}` };
      if (w < 0) return { error: `Mixture, line ${k + 1}: the weight ${trimNum(w)} is negative; weights are probabilities.` };
      const s = readState(m[2], dimText);
      if ("error" in s) return { error: `Mixture, line ${k + 1}: ${s.error}` };
      if (dim && s.dim !== dim) return { error: `Mixture, line ${k + 1}: the state has dimension ${s.dim} but an earlier one has ${dim}.` };
      if (s.dim > DIRAC_MAX_DIM) return { error: `Density matrices are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}; line ${k + 1} has dimension ${s.dim}.` };
      dim = s.dim;
      for (const n of s.notes) notes.push(`Mixture line ${k + 1}: ${n}`);
      items.push({ w, psi: s.state });
    }
    const sum = items.reduce((t, x) => t + x.w, 0);
    if (Math.abs(sum - 1) > 1e-9) return { error: `Not a density matrix: the weights sum to ${trimNum(sum)}, not 1 (to within 1×10⁻⁹), so tr ρ would not be 1.` };
    const q = qubitsOf(dim);
    return { rho: mixtureRho(items), notes, how: `ρ = ${items.map((x) => `${trimNum(x.w)}·|ψ⟩⟨ψ| for ${fmtVec(x.psi, dim, q).text}`).join(" + ")}` };
  }
  const o = readOperator(r(keyMatrix));
  if ("error" in o) return { error: `ρ: ${o.error}` };
  return { rho: o.M, notes: [], how: "ρ as typed" };
}

/** A second state or density matrix for fidelity and trace distance. */
function readCompare(text: string, d: number): CMat | { error: string } {
  const t = text.trim();
  if (/[|⟩]/.test(t) && !/[⟨〈]|\|\s*[⟨〈<]/.test(t) && !/[[\]]/.test(t)) {
    const s = readStateFor(t, d, "ρ");
    if ("error" in s) return { error: `Comparison state: ${s.error}` };
    if (s.dim !== d) return { error: `The comparison state has dimension ${s.dim} but ρ is ${d} × ${d}.` };
    return densityOf(s.state);
  }
  const o = readOperator(t);
  if ("error" in o) return { error: `Comparison σ: ${o.error}` };
  if (o.dim !== d) return { error: `σ is ${o.dim} × ${o.dim} but ρ is ${d} × ${d}.` };
  const c = checkDensity(o.M);
  if ("error" in c) return { error: `Comparison σ: ${c.error}` };
  return o.M;
}

const RHO_MODES = [
  { value: "pure", label: "Pure state |ψ⟩" },
  { value: "mixture", label: "Mixture (weight: state per line)" },
  { value: "matrix", label: "Matrix or expression for ρ" },
];

const densityCalc: QCalc = {
  id: "qc-density",
  name: "Density matrix: purity, entropy, Bloch vector, fidelity",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "Build ρ from a pure state, from a mixture (one 'weight: state' per line, weights summing to 1), or type it as a " +
    "matrix or an expression (0.7|0⟩⟨0| + 0.3|+⟩⟨+|, (I + 0.5*Z)/2). Up to 16 × 16. Gives ρ, the trace, the purity tr ρ², the " +
    "von Neumann entropy in bits, the eigenvalues, the Bloch vector of a qubit, and — against a second state or ρ — the " +
    "fidelity F = (tr √(√ρ σ √ρ))² and the trace distance ½ tr|ρ − σ|. A matrix that is not Hermitian, not of trace 1 " +
    "(to 10⁻⁹) or has a negative eigenvalue is refused by name.",
  fields: [
    { key: "mode", label: "ρ from", default: "mixture", kind: "select", options: RHO_MODES },
    { key: "state", label: "Pure state (when chosen)", default: "|+⟩", kind: "text" },
    { key: "mixture", label: "Mixture, 'weight: state' per line (when chosen)", default: "0.7: |0⟩\n0.3: |+⟩", kind: "block", rows: 4 },
    { key: "matrix", label: "ρ as a matrix or expression (when chosen)", default: "[[0.5, 0.5], [0.5, 0.5]]", kind: "block", rows: 3 },
    DIM_FIELD,
    { key: "compare", label: "Compare with a state or ρ (optional, for fidelity and trace distance)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const mode = r("mode") || "mixture";
    const got = readRho(mode, r, "state", "mixture", "matrix", r("dim"));
    if ("error" in got) return refuse(got.error);
    const rho = got.rho, d = rho.length;
    if (d > DIRAC_MAX_DIM) return refuse(`Density matrices are limited to ${DIRAC_MAX_DIM} × ${DIRAC_MAX_DIM}.`);
    const chk = checkDensity(rho);
    if ("error" in chk) return refuse(chk.error);
    const labels = labelsFor(d);
    const qb = qubitsOf(d);
    const P = purity(rho);
    const S = vonNeumannBits(chk.probs);
    const desc = [...chk.probs].sort((x, y) => y - x);
    const lines: EngLine[] = [...got.notes];
    if (qb !== null && qb > 1) lines.push("Convention: qubits are big-endian, |q₀q₁…⟩ with q₀ the leftmost bit.");
    lines.push(`${got.how}.`);
    if (mode === "mixture") lines.push({ math: "ρ = sum(k=1, n, p_k ket(ψ_k) bra(ψ_k))", fallback: "ρ = Σ pₖ |ψₖ⟩⟨ψₖ|" });
    const m = matrixShown(rho);
    if (m.math) lines.push({ math: `ρ = ${m.math}`, fallback: `ρ = [${m.rows.map((x) => x.join(", ")).join("; ")}]` });
    if (isMaxMixed(rho)) lines.push(`ρ = I/${d}: the maximally mixed state.`);
    lines.push(`Valid density matrix: Hermitian, tr ρ = ${trimNum(chk.trace)}, all eigenvalues ≥ 0.`);
    lines.push(`Purity tr ρ² = ${fmtReal(P).text}${fmtReal(P).exact && fmtReal(P).text !== trimNum(P) ? ` = ${trimNum(P)}` : ""} (1 for a pure state, 1/${d} for the maximally mixed one): ${Math.abs(P - 1) < 1e-9 ? "PURE" : "MIXED"}.`);
    lines.push({ math: "γ = tr(ρ^2)", fallback: "γ = tr ρ²" });
    lines.push(`Von Neumann entropy S(ρ) = ${trimNum(S)} bits (0 for a pure state, at most log₂ ${d} = ${trimNum(Math.log2(d))} bit${Math.log2(d) === 1 ? "" : "s"}).`);
    lines.push({ math: "S(ρ) = -tr(ρ log_2 ρ) = -sum(k=1, d, λ_k log_2 λ_k)", fallback: "S(ρ) = −tr(ρ log₂ ρ) = −Σ λₖ log₂ λₖ" });
    lines.push(`Eigenvalues of ρ, largest first (the probabilities of its eigenstates): ${desc.map((v) => fmtReal(v).text).join(", ")}.`);
    const outputs: EngOutput[] = [
      { key: "trace", label: "tr ρ", value: chk.trace, unit: "" },
      { key: "purity", label: "Purity tr ρ²", value: P, unit: "" },
      { key: "entropy", label: "Von Neumann entropy", value: S, unit: "bit" },
    ];
    desc.forEach((v, k) => outputs.push({ key: `eig${k + 1}`, label: `λ${k + 1}`, value: v, unit: "" }));
    const extra: AnalyzeBlock[] = [matrixTable("Density matrix ρ", rho, labels)];
    let bloch: [number, number, number] | null = null;
    if (d === 2) {
      bloch = blochOf(rho);
      const rr = Math.hypot(...bloch);
      lines.push(`Bloch vector r = (tr ρX, tr ρY, tr ρZ) = (${bloch.map((x) => fmtReal(x).text).join(", ")}), |r| = ${fmtReal(rr).text}${Math.abs(rr - 1) < 1e-9 ? " (on the sphere: pure)" : " (inside the sphere: mixed)"}.`);
      lines.push({ math: "ρ = (1/2)(I + r · σ)", fallback: "ρ = ½(I + r·σ)" });
      outputs.push(
        { key: "blochX", label: "Bloch x", value: bloch[0], unit: "" },
        { key: "blochY", label: "Bloch y", value: bloch[1], unit: "" },
        { key: "blochZ", label: "Bloch z", value: bloch[2], unit: "" },
        { key: "blochR", label: "|r|", value: rr, unit: "" },
      );
    }
    const cmpText = (r("compare") ?? "").trim();
    if (cmpText) {
      const sigma = readCompare(cmpText, d);
      if ("error" in sigma) return refuse(sigma.error);
      const F = fidelity(rho, sigma), T = traceDistance(rho, sigma);
      if (F === null || T === null) return refuse("The fidelity could not be computed (eigen-decomposition did not converge).");
      lines.push(`Against σ (${cmpText}): fidelity F = ${fmtReal(F).text}${fmtReal(F).exact && fmtReal(F).text !== trimNum(F) ? ` = ${trimNum(F)}` : ""}; trace distance T = ${fmtReal(T).text}${fmtReal(T).exact && fmtReal(T).text !== trimNum(T) ? ` = ${trimNum(T)}` : ""}.`);
      lines.push({ math: "F(ρ, σ) = (tr sqrt(sqrt(ρ) σ sqrt(ρ)))^2", fallback: "F(ρ, σ) = (tr √(√ρ σ √ρ))²" });
      lines.push({ math: "T(ρ, σ) = (1/2) tr abs(ρ - σ)", fallback: "T(ρ, σ) = ½ tr|ρ − σ|" });
      lines.push("Convention: F is the SQUARED (Jozsa) fidelity, so for pure states F = |⟨φ|ψ⟩|² (some texts use its square root). Bounds: 1 − √F ≤ T ≤ √(1 − F).");
      outputs.push({ key: "fidelity", label: "Fidelity F", value: F, unit: "" }, { key: "traceDistance", label: "Trace distance T", value: T, unit: "" });
    }
    if (bloch) {
      const bl = `(${bloch.map((x) => trimNum(x, 3)).join(", ")})`;
      extra.push(
        plot(
          blochSphereSvg({ start: bloch, end: bloch, path: [], startLabel: "", endLabel: `Bloch vector r = ${bl}`, single: true }),
          `Bloch vector of ρ: r = ${bl}, |r| = ${trimNum(Math.hypot(...bloch), 4)}${Math.abs(Math.hypot(...bloch) - 1) < 1e-9 ? " (on the sphere: a pure state)" : " (inside the sphere: a mixed state)"}.`,
          `Bloch sphere with the Bloch vector ${bl}.`,
        ),
      );
    }
    extra.push(
      plot(
        quantumBarsSvg({
          values: desc,
          labels: desc.map((_, k) => `λ${k + 1}`),
          yTitle: "Eigenvalue",
          xTitle: "Eigenvalues of ρ (largest first)",
          ref: { value: 1 / d, label: `1/${d}` },
        }),
        `Eigenvalues of ρ, largest first; the dashed line is 1/${d}, where every eigenvalue of the maximally mixed state sits.`,
        "Bar chart of the eigenvalues of the density matrix.",
      ),
    );
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Bipartite entanglement
// ---------------------------------------------------------------------------------------------------------------

/** dA × dB from the split field: "1" (qubits in party A of an n-qubit register) or "2x3" / "2×3". */
function readSplit(text: string, D: number, qubits: number | null): { dA: number; dB: number } | { error: string } {
  const t = (text ?? "").trim().replace(/\s+/g, "");
  if (!t) {
    if (D === 4) return { dA: 2, dB: 2 };
    return { error: `Give the split: the number of qubits in party A, or the dimensions as dA×dB (the state has dimension ${D}).` };
  }
  const m = /^(\d+)[x×*](\d+)$/i.exec(t);
  if (m) {
    const dA = Number(m[1]), dB = Number(m[2]);
    if (dA < 2 || dB < 2) return { error: "Each party needs dimension at least 2." };
    if (dA * dB !== D) return { error: `${dA} × ${dB} = ${dA * dB}, but the state has dimension ${D}.` };
    return { dA, dB };
  }
  if (/^\d+$/.test(t)) {
    if (qubits === null) return { error: `The split "${t}" counts qubits; this state is not a qubit register, so give dA×dB.` };
    const k = Number(t);
    if (k < 1 || k >= qubits) return { error: `Party A must hold from 1 to ${qubits - 1} of the ${qubits} qubits ("${t}" given).` };
    return { dA: 1 << k, dB: 1 << (qubits - k) };
  }
  return { error: `The split must be a number of qubits (1) or dimensions dA×dB (2x3); "${text.trim()}" is neither.` };
}

const BIP_MODES = [
  { value: "pure", label: "Pure state (Schmidt decomposition)" },
  { value: "mixed", label: "Mixed state ρ (matrix or expression)" },
  { value: "werner", label: "Werner state p|Φ⁺⟩⟨Φ⁺| + (1 − p) I/4" },
  { value: "belldiag", label: "Bell-diagonal state (weights of Φ⁺, Φ⁻, Ψ⁺, Ψ⁻)" },
];

const bipartiteCalc: QCalc = {
  id: "qc-bipartite",
  name: "Bipartite entanglement: Schmidt, concurrence, negativity",
  group: "Quantum computing",
  unitContract: "domain",
  hint:
    "A two-party state A ⊗ B. Pure: type it (cos(pi/8)|00⟩ + sin(pi/8)|11⟩, |Φ⁺⟩) and the split (qubits in party A, or " +
    "dA×dB with an amplitude list in |i⟩|j⟩ order) for the Schmidt decomposition, coefficients and entanglement entropy. " +
    "Mixed: type ρ (up to 16 × 16; 2 × 2 qubits by default) for the reduced states, the partial transpose, the negativity " +
    "and log-negativity, the PPT test and, for two qubits, the Wootters concurrence. Presets: the Werner state and " +
    "Bell-diagonal states.",
  fields: [
    { key: "mode", label: "State", default: "pure", kind: "select", options: BIP_MODES },
    { key: "state", label: "Pure state (when chosen)", default: "cos(pi/8)|00⟩ + sin(pi/8)|11⟩", kind: "text" },
    { key: "split", label: "Split: qubits in party A, or dA×dB (blank = 2×2)", default: "1", kind: "text" },
    { key: "matrix", label: "ρ as a matrix or expression (mixed)", default: "0.6|Φ⁺⟩⟨Φ⁺| + 0.1*(I⊗I)", kind: "block", rows: 3 },
    { key: "p", label: "Werner p (0 to 1)", default: "0.6", kind: "text" },
    { key: "weights", label: "Bell-diagonal weights of Φ⁺, Φ⁻, Ψ⁺, Ψ⁻", default: "0.7, 0.1, 0.1, 0.1", kind: "text" },
  ],
  compute: (r) => {
    const mode = r("mode") || "pure";
    const lines: EngLine[] = ["Convention: party A is the left factor of A ⊗ B, so |i⟩|j⟩ has index i·d_B + j; qubits big-endian."];
    const outputs: EngOutput[] = [];
    const extra: AnalyzeBlock[] = [];
    if (mode === "pure") {
      const st = readState(r("state"), "");
      if ("error" in st) return refuse(`State: ${st.error}`);
      if (st.dim > DIRAC_MAX_DIM) return refuse(`Bipartite states are limited to dimension ${DIRAC_MAX_DIM} (4 qubits); this one has ${st.dim}.`);
      const sp = readSplit(r("split"), st.dim, st.qubits);
      if ("error" in sp) return refuse(sp.error);
      const { dA, dB } = sp;
      for (const n of st.notes) lines.push(`State: ${n}`);
      const sv = fmtVec(st.state, st.dim, st.qubits);
      lines.push(`|ψ⟩ = ${sv.text}, split as d_A × d_B = ${dA} × ${dB}.`);
      const sc = schmidt(st.state, dA, dB);
      if (!sc) return refuse("The Schmidt decomposition did not converge.");
      const qA = qubitsOf(dA), qB = qubitsOf(dB);
      lines.push({ math: "ket(ψ) = sum(k=1, r, s_k ket(a_k) ⊗ ket(b_k))", fallback: "|ψ⟩ = Σₖ sₖ |aₖ⟩ ⊗ |bₖ⟩" });
      lines.push(`Schmidt coefficients sₖ: ${sc.coeffs.map((x) => showCx(cx(x))).join(", ")} (Schmidt rank ${sc.coeffs.length}; Σ sₖ² = ${trimNum(sc.coeffs.reduce((t, x) => t + x * x, 0))}).`);
      const rows: string[][] = [["k", "sₖ", "sₖ²", "|aₖ⟩ (party A)", "|bₖ⟩ (party B)"]];
      sc.coeffs.forEach((x, k) => {
        rows.push([String(k + 1), fmtReal(x).text, fmtReal(x * x).text, fmtVec(sc.a[k], dA, qA).text, fmtVec(sc.b[k], dB, qB).text]);
        outputs.push({ key: `schmidt${k + 1}`, label: `s${k + 1}`, value: x, unit: "" });
      });
      extra.push(table("Schmidt decomposition", rows));
      const E = vonNeumannBits(sc.coeffs.map((x) => x * x));
      lines.push(`Entanglement entropy E = S(ρ_A) = −Σ sₖ² log₂ sₖ² = ${trimNum(E)} ebit${sc.coeffs.length === 1 ? " (a PRODUCT state: not entangled)" : Math.abs(E - Math.log2(Math.min(dA, dB))) < 1e-9 ? " (MAXIMALLY entangled for this split)" : ""}.`);
      lines.push({ math: "E = S(ρ_A) = -sum(k=1, r, s_k^2 log_2 s_k^2)", fallback: "E = S(ρ_A) = −Σ sₖ² log₂ sₖ²" });
      outputs.push({ key: "entropy", label: "Entanglement entropy", value: E, unit: "ebit" }, { key: "schmidtRank", label: "Schmidt rank", value: sc.coeffs.length, unit: "" });
      const rho = densityOf(st.state);
      const rA = partialTrace(rho, dA, dB, "A"), rB = partialTrace(rho, dA, dB, "B");
      const nameRed = (m: CMat, dd: number): string => (isMaxMixed(m) ? ` = I/${dd} (maximally mixed)` : "");
      lines.push(`Reduced states: ρ_A = tr_B |ψ⟩⟨ψ|${nameRed(rA, dA)}, purity ${fmtReal(purity(rA)).text}; ρ_B = tr_A |ψ⟩⟨ψ|${nameRed(rB, dB)}, purity ${fmtReal(purity(rB)).text}.`);
      lines.push({ math: "ρ_A = tr_B(ket(ψ) bra(ψ))", fallback: "ρ_A = tr_B |ψ⟩⟨ψ|" });
      extra.push(matrixTable("Reduced state ρ_A = tr_B |ψ⟩⟨ψ|", rA, labelsFor(dA)));
      extra.push(matrixTable("Reduced state ρ_B = tr_A |ψ⟩⟨ψ|", rB, labelsFor(dB)));
      outputs.push({ key: "purityA", label: "Purity of ρ_A", value: purity(rA), unit: "" });
      if (dA === 2 && dB === 2) {
        const c = pureTwoQubit(st.state[0], st.state[1], st.state[2], st.state[3]);
        if (c) {
          lines.push(`Concurrence C = 2|ad − bc| = 2 s₁ s₂ = ${showCx(cx(c.concurrence))}.`);
          outputs.push({ key: "concurrence", label: "Concurrence", value: c.concurrence, unit: "" });
        }
      }
      const ng = negativity(rho, dA, dB);
      if (ng) {
        lines.push(`Negativity N = ${trimNum(ng.N)}, log-negativity E_N = ${trimNum(ng.logN)} (for a pure state N = ((Σ sₖ)² − 1)/2).`);
        outputs.push({ key: "negativity", label: "Negativity", value: ng.N, unit: "" }, { key: "logNegativity", label: "Log-negativity", value: ng.logN, unit: "" });
      }
      extra.push(
        plot(
          quantumBarsSvg({ values: sc.coeffs, labels: sc.coeffs.map((_, k) => `s${k + 1}`), yTitle: "Schmidt coefficient", xTitle: "Schmidt coefficients (largest first)" }),
          `Schmidt coefficients of |ψ⟩ for the ${dA} × ${dB} split (one bar: a product state).`,
          "Bar chart of the Schmidt coefficients.",
        ),
      );
      return finish(lines, extra, outputs);
    }
    // Mixed states and the presets.
    let rho: CMat;
    let dA = 2, dB = 2;
    let werner: ReturnType<typeof wernerState> = null;
    if (mode === "werner") {
      const p = realNumber(r("p"));
      if (typeof p === "string") return refuse(`Werner p: ${p}`);
      werner = wernerState(p);
      if (!werner) return refuse(`Werner p must be from 0 to 1 (${trimNum(p)} given): it is the weight of |Φ⁺⟩ in the mixture.`);
      rho = wernerRho(p);
      lines.push(`Werner state ρ = p|Φ⁺⟩⟨Φ⁺| + (1 − p) I/4 with p = ${trimNum(p)}.`);
      lines.push({ math: "ρ_W = p ket(Φ^+) bra(Φ^+) + (1 - p) I/4", fallback: "ρ_W = p|Φ⁺⟩⟨Φ⁺| + (1 − p) I/4" });
    } else if (mode === "belldiag") {
      const wv = readDataBlock(r("weights"), "Bell-diagonal weights");
      if (!wv.ok) return refuse(`Bell-diagonal weights: ${wv.error}`);
      const ws = wv.rows.flat();
      if (ws.length !== 4 || ws.some((x) => x === null || !Number.isFinite(x))) return refuse("Bell-diagonal weights: give exactly four numbers, the weights of Φ⁺, Φ⁻, Ψ⁺ and Ψ⁻.");
      const l = ws as number[];
      if (l.some((x) => x < 0)) return refuse("Bell-diagonal weights are probabilities: none may be negative.");
      const sum = l.reduce((t, x) => t + x, 0);
      if (Math.abs(sum - 1) > 1e-9) return refuse(`Not a density matrix: the Bell-diagonal weights sum to ${trimNum(sum)}, not 1 (to within 1×10⁻⁹).`);
      rho = bellDiagonalRho([l[0], l[1], l[2], l[3]]);
      lines.push(`Bell-diagonal state ρ = ${l.map((x, k) => `${trimNum(x)}|${BELL_BASIS[k].label}⟩⟨${BELL_BASIS[k].label}|`).join(" + ")}.`);
      lines.push("A Bell-diagonal state is entangled exactly when its largest weight exceeds ½.");
    } else {
      const o = readOperator(r("matrix"));
      if ("error" in o) return refuse(`ρ: ${o.error}`);
      rho = o.M;
      const sp = readSplit(r("split"), o.dim, qubitsOf(o.dim));
      if ("error" in sp) return refuse(sp.error);
      dA = sp.dA;
      dB = sp.dB;
      lines.push(`ρ as typed, split as d_A × d_B = ${dA} × ${dB}.`);
    }
    const chk = checkDensity(rho);
    if ("error" in chk) return refuse(chk.error);
    const D = rho.length;
    lines.push(`Valid density matrix: Hermitian, tr ρ = ${trimNum(chk.trace)}, eigenvalues ≥ 0; purity tr ρ² = ${trimNum(purity(rho))}, entropy S(ρ) = ${trimNum(vonNeumannBits(chk.probs))} bits.`);
    extra.push(matrixTable("Density matrix ρ", rho, labelsFor(D)));
    const rA = partialTrace(rho, dA, dB, "A"), rB = partialTrace(rho, dA, dB, "B");
    lines.push(`Reduced states: ρ_A = tr_B ρ (purity ${fmtReal(purity(rA)).text}), ρ_B = tr_A ρ (purity ${fmtReal(purity(rB)).text}).`);
    extra.push(matrixTable("Reduced state ρ_A = tr_B ρ", rA, labelsFor(dA)));
    extra.push(matrixTable("Reduced state ρ_B = tr_A ρ", rB, labelsFor(dB)));
    const ng = negativity(rho, dA, dB);
    if (!ng) return refuse("The partial-transpose spectrum did not converge.");
    const npt = ng.ptEig.some((v) => v < -1e-12);
    lines.push({ math: "N(ρ) = {norm(ρ^{T_B})_1 - 1}/2", fallback: "N(ρ) = (‖ρᵀᴮ‖₁ − 1)/2 = Σ |negative eigenvalues of ρᵀᴮ|" });
    lines.push(`Partial transpose over B: eigenvalues ${ng.ptEig.map((v) => trimNum(v)).join(", ")}.`);
    lines.push(`Negativity N = ${fmtReal(ng.N).text}${fmtReal(ng.N).exact && fmtReal(ng.N).text !== trimNum(ng.N) ? ` = ${trimNum(ng.N)}` : ""}; log-negativity E_N = log₂(2N + 1) = ${trimNum(ng.logN)}.`);
    lines.push({ math: "E_N = log_2(2 N + 1)", fallback: "E_N = log₂(2N + 1)" });
    const exactPPT = dA * dB <= 6;
    if (npt) lines.push("PPT test: ρᵀᴮ has a NEGATIVE eigenvalue, so ρ is ENTANGLED (Peres criterion).");
    else if (exactPPT) lines.push(`PPT test: ρᵀᴮ is positive, and for ${dA} × ${dB} that means ρ is SEPARABLE (Horodecki: PPT ⇔ separable for 2 × 2 and 2 × 3).`);
    else lines.push(`PPT test: ρᵀᴮ is positive. For ${dA} × ${dB} that is NECESSARY for separability but not sufficient: bound-entangled states are PPT, so separability is not decided here.`);
    outputs.push(
      { key: "negativity", label: "Negativity", value: ng.N, unit: "" },
      { key: "logNegativity", label: "Log-negativity", value: ng.logN, unit: "" },
      { key: "npt", label: "Negative partial transpose (1 = yes)", value: npt ? 1 : 0, unit: "" },
    );
    if (D === 4 && dA === 2) {
      const c = concurrence(rho);
      if (!c) return refuse("The concurrence could not be computed.");
      lines.push(`Wootters concurrence C = max(0, λ₁ − λ₂ − λ₃ − λ₄) = ${fmtReal(c.c).text}${fmtReal(c.c).exact && fmtReal(c.c).text !== trimNum(c.c) ? ` = ${trimNum(c.c)}` : ""}, the λₖ = ${c.lambdas.map((x) => trimNum(x)).join(", ")} the square roots of the eigenvalues of ρ ρ̃ (ρ̃ = (Y⊗Y) ρ* (Y⊗Y)).`);
      lines.push({ math: "C(ρ) = max(0, λ_1 - λ_2 - λ_3 - λ_4)", fallback: "C(ρ) = max(0, λ₁ − λ₂ − λ₃ − λ₄)" });
      outputs.push({ key: "concurrence", label: "Concurrence", value: c.c, unit: "" });
      if (werner) {
        lines.push(`Check against the closed form (quantum.ts): C = max(0, (3p − 1)/2) = ${trimNum(werner.concurrence)}.`);
        for (const n of werner.notes) lines.push(n.replace(/sqrt\(2\)/g, "√2").replace(/\*/g, "·"));
      }
    }
    extra.push(
      plot(
        quantumBarsSvg({
          values: ng.ptEig.slice().sort((x, y) => y - x),
          labels: ng.ptEig.map((_, k) => `μ${k + 1}`),
          yTitle: "Eigenvalue",
          xTitle: "Eigenvalues of the partial transpose ρᵀᴮ",
          note: npt ? "red: negative eigenvalues (entanglement)" : "no negative eigenvalue (PPT)",
        }),
        `Spectrum of the partial transpose over B, largest first; ${npt ? "the negative eigenvalues (red) show entanglement" : "no eigenvalue is negative (PPT)"}.`,
        "Bar chart of the eigenvalues of the partial transpose, negative ones in red.",
      ),
    );
    return finish(lines, extra, outputs);
  },
};

export const QUANTUM_DIRAC_CALCS: QCalc[] = [statesCalc, operatorsCalc, measurementCalc, densityCalc, bipartiteCalc];
