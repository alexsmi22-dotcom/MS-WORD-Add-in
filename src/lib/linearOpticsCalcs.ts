// Pane glue for Release Q part Q4 (group "Quantum optics", existing): linear optical quantum computing — the beam
// splitter and Mach–Zehnder interferometer, Hong–Ou–Mandel interference and its dip, multiphoton interference through
// an m-mode network by permanents, and dual-rail qubits with the cited probabilistic CZ gates. Kept OUT of
// taskpane.ts; the integrator spreads LINEAR_OPTICS_CALCS into ENG_CALCS.
//
// No physics is computed here: linearOptics.ts owns it (on quantumCore.ts and jones.ts). This file reads the fields,
// words the result under the display contract (U+2212, exact closed forms where recognised, no caret, no e-notation,
// no em dash, NaN or Infinity in an ok result) and draws.
//
// UNIT CONTRACTS: the Mach–Zehnder tool ("converts": the optional input power through units.ts) and the HOM tool
// ("converts": photon width and delay are times) read dimensional fields through the unit layer. The multiphoton and
// dual-rail tools are "domain": reflectivities and efficiencies are fractions (or %), angles are degrees (radians
// with π or "rad"), photon numbers are counts; a unit typed after any of them is refused.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured, toSuperscript } from "./units";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { buildPlotSvg } from "./plot";
import { readElements } from "./jones";
import { cx, fmtCx, parseAngle, parseKet, type CMat, type Cx } from "./quantumCore";
import { fmtSig } from "./axis";
import {
  LO_GATES,
  MAX_MODES,
  MAX_PHOTONS,
  UNITARY_TOL,
  beamSplitter,
  beamSplitterChain,
  dftUnitary,
  dualRail,
  fockLabel,
  gateRate,
  gaussianOverlap,
  hom,
  homDip,
  machZehnder,
  multiphoton,
  readComplexMatrix,
  unitarityDeviation,
} from "./linearOptics";
import { fockBarsSvg } from "./linearOpticsCharts";

type QoCalc = EngCalcDef<"Quantum optics">;

const BS_CONVENTION =
  "Convention: a beam splitter of reflectivity R (T = 1 − R) is U = [[√T, i√R], [i√R, √T]] (the symmetric splitter: a reflection adds the phase i); output amplitudes = U × input amplitudes.";

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (500 fs, 0.2 ps, 2 mW) and it is converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, ";")), ok: false });

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 420);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 270);
  return { kind: "plot", svg, caption, alt, w, h };
};

const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((r) => r.map((c) => trueMinus(c))) });

function finish(lines: EngLine[], extra: AnalyzeBlock[], outputs: EngOutput[], conversions?: string[]): AnalyzeOutput {
  if (conversions) {
    if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
    lines.push(UNIT_NOTE);
  }
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l.replace(/—/g, ";")) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return { ...engReport(clean, extra), outputs: outputs.map((o) => (Math.abs(o.value) < 1e-13 ? { ...o, value: 0 } : o)) };
}

/**
 * Six significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁵, U+2212. Not the core's trimNum, which snaps
 * |v| < 10⁻¹² to 0 (right for amplitudes, wrong for a 500 fs duration in seconds).
 */
const t6 = (v: number): string => (v === 0 ? "0" : fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, ""));

/** P(at least one) from P(none): never rounded up to a certainty — 1 − (1 − p)ᴺ is written 1 − q when q is tiny. */
const t6p = (none: number): string => (none === 0 ? "1" : none < 5e-7 ? `1 − ${t6(none)}` : t6(1 - none));

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * A probability as an exact fraction when it is one (denominator ≤ 81, to 10⁻¹²: 1/3, 2/9, 1/16), else six significant
 * figures. The shared core's recogniseReal knows only power-of-two denominators, so thirds and ninths — the tritter's
 * 1/3, the post-selected CZ's 1/9 — are recognised here (flagged to the integrator to fold into quantumCore.ts).
 */
export function probShow(x: number): string {
  if (Math.abs(x) < 1e-12) return "0";
  if (Math.abs(x - 1) < 1e-12) return "1";
  for (let d = 2; d <= 81; d++) {
    const a = Math.round(x * d);
    if (a >= 1 && a < d && Math.abs(x - a / d) < 1e-12 && gcd(a, d) === 1) {
      let r = d;
      while (r % 2 === 0) r /= 2;
      while (r % 5 === 0) r /= 5;
      return `${a}/${d} ${r === 1 ? "=" : "≈"} ${t6(a / d)}`;
    }
  }
  return t6(x);
}

/** A whole number from a field within [lo, hi]; a string is the refusal. */
function intField(raw: string, what: string, lo: number, hi: number): number | string {
  const t = (raw ?? "").trim();
  if (!/^\d+$/.test(t)) return `${what} must be a whole number from ${lo} to ${hi} ("${t}" given).`;
  const v = Number(t);
  if (v < lo || v > hi) return `${what} must be from ${lo} to ${hi}; ${v} is outside.`;
  return v;
}

/** A plain number (no unit): NaN when blank or unreadable. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  return t !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

/**
 * A fraction field (reflectivity, overlap, efficiency): "0.3" or "30 %". A bare number above 1 is refused by name
 * (30 could be 0.30 or a typo), as is any other unit.
 */
function fraction(v: string | undefined, label: string): number | string {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return `${label}: this field is required.`;
  const pc = /^(.*?)\s*%$/.exec(t);
  const x = plain(pc ? pc[1] : t);
  if (!Number.isFinite(x)) return `${label}: "${t}" is not a number (write a fraction such as 0.3, or 30 %).`;
  const y = pc ? x / 100 : x;
  if (y < 0) return `${label}: ${t6(y)} is negative; it is a fraction from 0 to 1.`;
  if (y > 1) return `${label}: ${t6(x)} is above 1. It is a fraction from 0 to 1: write ${t6(x / 100)} or ${t6(x)} % if a percentage was meant.`;
  return y;
}

/**
 * Unit-aware reading for the converting tools (the laserCalcs.ts / titrationCalcs.ts pattern): errors collected,
 * conversions reported.
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12)
      conversions.push(`${label}: ${t6(m.value)} ${formatUnit(m.unit)} = ${t6(m.inTarget)} ${si}`);
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, label: string): number => read(key, si, label, true) as number,
    opt: (key: string, si: string, label: string): number | null => read(key, si, label, false),
  };
}

/** A matrix as equation syntax pmatrix(a, b; c, d). */
const matrixMath = (U: CMat): string => `pmatrix(${U.map((row) => row.map((z) => fmtCx(z).math).join(", ")).join("; ")})`;

/** Two-mode Fock states in equation syntax: |1⟩₀|0⟩₁ (the equation syntax has no comma inside a ket). */
const FOCK10 = "ket(1)_0 ket(0)_1";
const FOCK01 = "ket(0)_0 ket(1)_1";

/** a|1,0⟩ + b|0,1⟩ from two amplitudes (Dirac text and math). */
function twoModeState(a: Cx, b: Cx, l0: string, l1: string, m0: string, m1: string): { text: string; math: string } {
  const terms: { t: string; m: string }[] = [];
  const term = (z: Cx, lt: string, lm: string, first: boolean): void => {
    if (Math.hypot(z.re, z.im) < 1e-12) return;
    const s = fmtCx(z);
    const neg = !s.sum && s.text.startsWith("−");
    const body = s.sum ? `(${s.text})` : neg ? s.text.slice(1) : s.text;
    const bodyM = s.sum ? `(${s.math})` : neg ? s.math.slice(1) : s.math;
    const coefT = body === "1" ? "" : body;
    const coefM = bodyM === "1" ? "" : `${bodyM} `;
    const sign = first ? (neg ? "−" : "") : neg ? " − " : " + ";
    const signM = first ? (neg ? "-" : "") : neg ? " - " : " + ";
    terms.push({ t: `${sign}${coefT}${lt}`, m: `${signM}${coefM}${lm}` });
  };
  term(a, l0, m0, true);
  term(b, l1, m1, terms.length === 0);
  return { text: terms.map((x) => x.t).join(""), math: terms.map((x) => x.m).join("") };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Beam splitter and Mach–Zehnder interferometer
// ---------------------------------------------------------------------------------------------------------------

const mzCalc: QoCalc = {
  id: "lo-mach-zehnder",
  name: "Beam splitter and Mach–Zehnder interferometer",
  group: "Quantum optics",
  unitContract: "converts",
  hint:
    "Two beam splitters (reflectivities R₁, R₂) with a phase φ in the lower arm (mode 1). One photon (or a classical beam) " +
    "enters port 0 or 1. Gives the output amplitudes and port probabilities, the fringe visibility at each port and, " +
    "with an input power, the classical output powers. U_BS = [[√T, i√R], [i√R, √T]]. Phase in degrees (radians with pi).",
  fields: [
    { key: "R1", label: "First splitter reflectivity R₁ (0–1 or %)", default: "0.5", kind: "text" },
    { key: "R2", label: "Second splitter reflectivity R₂ (0–1 or %)", default: "0.5", kind: "text" },
    { key: "phi", label: "Phase φ in arm 1 (degrees)", default: "60", kind: "text" },
    {
      key: "input",
      label: "Photon enters",
      default: "0",
      kind: "select",
      options: [
        { value: "0", label: "Port 0" },
        { value: "1", label: "Port 1" },
      ],
    },
    { key: "power", label: "Classical input power (optional, mW)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const R1 = fraction(r("R1"), "Reflectivity R₁");
    if (typeof R1 === "string") return refuse(R1);
    const R2 = fraction(r("R2"), "Reflectivity R₂");
    if (typeof R2 === "string") return refuse(R2);
    const ph = parseAngle(r("phi") ?? "");
    if ("error" in ph) return refuse(`Phase φ: ${ph.error}`);
    const input = (r("input") || "0") === "1" ? 1 : 0;
    const u = unitReader(r);
    const PmW = u.opt("power", "mW", "Input power");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (PmW !== null && PmW < 0) return refuse("Input power: a power cannot be negative.");
    const mz = machZehnder(R1, R2, ph.rad, input);
    const lines: EngLine[] = [];
    const outputs: EngOutput[] = [
      { key: "p0", label: "P(port 0)", value: mz.p[0], unit: "" },
      { key: "p1", label: "P(port 1)", value: mz.p[1], unit: "" },
      { key: "vis0", label: "Visibility, port 0", value: mz.vis[0], unit: "" },
      { key: "vis1", label: "Visibility, port 1", value: mz.vis[1], unit: "" },
    ];
    lines.push(BS_CONVENTION);
    lines.push(`Mach–Zehnder: BS(R₁ = ${t6(R1)}), the phase φ = ${ph.label} on arm 1, then BS(R₂ = ${t6(R2)}); one photon enters port ${input}. Port 0 is the output path transmitted at both splitters.`);
    lines.push({ math: "U_BS = pmatrix(sqrt(T), i sqrt(R); i sqrt(R), sqrt(T))", fallback: "U_BS = [[√T, i√R], [i√R, √T]]" });
    lines.push({ math: "U_MZ = U_BS2 pmatrix(1, 0; 0, e^{i φ}) U_BS1", fallback: "U_MZ = U_BS2 · diag(1, exp(iφ)) · U_BS1" });
    if (input === 0) lines.push({ math: "P_0 = T_1 T_2 + R_1 R_2 - 2 sqrt(T_1 T_2 R_1 R_2) cos φ", fallback: "P₀ = T₁T₂ + R₁R₂ − 2√(T₁T₂R₁R₂) cos φ" });
    else lines.push({ math: "P_0 = T_1 R_2 + R_1 T_2 + 2 sqrt(T_1 T_2 R_1 R_2) cos φ", fallback: "P₀ = T₁R₂ + R₁T₂ + 2√(T₁T₂R₁R₂) cos φ" });
    if (Math.abs(R1 - 0.5) < 1e-12 && Math.abs(R2 - 0.5) < 1e-12)
      lines.push(
        { math: input === 0 ? "P_0 = sin^2(φ/2)" : "P_0 = cos^2(φ/2)", fallback: input === 0 ? "P₀ = sin²(φ/2)" : "P₀ = cos²(φ/2)" },
        { math: input === 0 ? "P_1 = cos^2(φ/2)" : "P_1 = sin^2(φ/2)", fallback: input === 0 ? "P₁ = cos²(φ/2)" : "P₁ = sin²(φ/2)" },
      );
    const st = twoModeState(mz.amps[0], mz.amps[1], "|1,0⟩", "|0,1⟩", FOCK10, FOCK01);
    lines.push(`Output state (photons in ports 0, 1): ${st.text}.`);
    lines.push({ math: `ket(ψ_out) = ${st.math}`, fallback: `|ψ_out⟩ = ${st.text}` });
    lines.push(`P(port 0) = ${probShow(mz.p[0])}; P(port 1) = ${probShow(mz.p[1])}. One-photon interference follows the classical intensity fringe exactly: these are also the fractions of a classical beam's power.`);
    lines.push({ math: "V = {P_max - P_min}/{P_max + P_min}", fallback: "V = (P_max − P_min)/(P_max + P_min)" });
    lines.push(`Fringe visibility over a full turn of φ: port 0 ${t6(mz.vis[0])}, port 1 ${t6(mz.vis[1])}${Math.abs(R1 - R2) < 1e-12 && Math.abs(R1 - 0.5) > 1e-12 ? " (unbalanced splitters: full visibility only at the port where the two paths carry equal amplitude)" : ""}.`);
    const rows: string[][] = [["Output port", "Amplitude", "Probability", ...(PmW !== null ? ["Power (mW)"] : [])]];
    for (const k of [0, 1] as const) rows.push([String(k), fmtCx(mz.amps[k]).text, probShow(mz.p[k]), ...(PmW !== null ? [t6(PmW * mz.p[k])] : [])]);
    if (PmW !== null) {
      outputs.push({ key: "P0out", label: "Power out, port 0", value: PmW * mz.p[0], unit: "mW" }, { key: "P1out", label: "Power out, port 1", value: PmW * mz.p[1], unit: "mW" });
      lines.push(`Classical beam of ${t6(PmW)} mW: port 0 ${t6(PmW * mz.p[0])} mW, port 1 ${t6(PmW * mz.p[1])} mW (lossless splitters).`);
    }
    lines.push(
      "The Quantum computing tool “Protocol: superposition and interference” writes both splitters as Hadamards, giving P(0) = cos²(φ/2); with 50:50 splitters its port 0 is this tool's port 1 (the symmetric splitter exchanges the ports). Name the port before comparing with a lab.",
    );
    const phDeg = ((((ph.rad * 180) / Math.PI) % 360) + 360) % 360;
    const curve = (k: 0 | 1) =>
      Array.from({ length: 181 }, (_, i) => ({ x: 2 * i, y: machZehnder(R1, R2, (2 * i * Math.PI) / 180, input).p[k] }));
    const svg = buildPlotSvg(
      [
        { points: curve(0), type: "line", color: "#1f5fa8", label: "Port 0" },
        { points: curve(1), type: "line", color: "#d07a00", label: "Port 1" },
        { points: [{ x: phDeg, y: mz.p[0] }, { x: phDeg, y: mz.p[1] }], type: "scatter", color: "#c00000", label: Math.abs((ph.rad * 180) / Math.PI - phDeg) < 1e-9 ? `φ = ${t6(phDeg)}°` : `φ = ${ph.label} (${t6(phDeg)}° on the axis)` },
      ],
      { xlabel: "Phase φ (°)", ylabel: "Output probability", width: 440, height: 290, xLimits: { min: 0, max: 360, step: 90 }, yLimits: { min: 0, max: 1, step: 0.25 } },
    );
    return finish(
      lines,
      [
        table("Mach–Zehnder output", rows),
        plot(svg, "Mach–Zehnder fringes: the probability at each output port against the phase φ, with the chosen phase marked.", "Two complementary interference fringes against phase from 0 to 360 degrees."),
      ],
      outputs,
      u.conversions,
    );
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Hong–Ou–Mandel interference and the dip
// ---------------------------------------------------------------------------------------------------------------

/** A time axis unit for |t| up to `span` seconds. */
function timeUnit(span: number): { f: number; u: string } {
  if (span < 1e-12) return { f: 1e-15, u: "fs" };
  if (span < 1e-9) return { f: 1e-12, u: "ps" };
  if (span < 1e-6) return { f: 1e-9, u: "ns" };
  if (span < 1e-3) return { f: 1e-6, u: "µs" };
  return { f: 1e-3, u: "ms" };
}

const homCalc: QoCalc = {
  id: "lo-hom",
  name: "Hong–Ou–Mandel interference and the dip",
  group: "Quantum optics",
  unitContract: "converts",
  hint:
    "One photon in each input of a beam splitter (reflectivity R). With mode overlap M = |⟨ψ₁|ψ₂⟩|²: P(1,1) = T² + R² − 2RT·M, " +
    "P(2,0) = P(0,2) = RT(1 + M). The dip: two identical Gaussian, transform-limited photons of intensity FWHM w, one " +
    "delayed by τ; the overlap falls as M₀·exp(−τ²/(4σ²)), σ = w/(2√(2 ln 2)), so the dip's FWHM is √2·w.",
  fields: [
    { key: "R", label: "Beam splitter reflectivity R (0–1 or %)", default: "0.5", kind: "text" },
    { key: "M0", label: "Mode overlap at zero delay |⟨ψ₁|ψ₂⟩|² (1 = identical, 0 = distinguishable)", default: "1", kind: "text" },
    { key: "width", label: "Photon duration: intensity FWHM w (fs)", default: "500 fs", kind: "text" },
    { key: "delay", label: "Delay τ between the photons (fs)", default: "0", kind: "text" },
  ],
  compute: (r) => {
    const R = fraction(r("R"), "Reflectivity R");
    if (typeof R === "string") return refuse(R);
    const M0 = fraction(r("M0"), "Mode overlap");
    if (typeof M0 === "string") return refuse(M0);
    const u = unitReader(r);
    const w = u.req("width", "s", "Photon duration");
    const tau = u.req("delay", "s", "Delay");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!(w > 0)) return refuse("Photon duration: the intensity FWHM must be greater than zero.");
    if (w > 1) return refuse("Photon duration: above 1 s is outside this tool's range (a single-photon wavepacket is fs–µs long).");
    if (Math.abs(tau) > 1e6 * w) return refuse("Delay: more than 10⁶ photon durations; the photons do not overlap at all (P(1,1) = T² + R²). Give a delay closer to the dip.");
    const T = 1 - R;
    const wu = timeUnit(w);
    const ts = (x: number): string => `${t6(x / wu.f)} ${wu.u}`;
    const M = gaussianOverlap(tau, w, M0);
    const h = hom(R, M);
    const h0 = hom(R, M0);
    const dist = hom(R, 0);
    const dipFwhm = Math.SQRT2 * w;
    const lines: EngLine[] = [];
    const outputs: EngOutput[] = [
      { key: "p11", label: "P(1,1) at τ", value: h.p11, unit: "" },
      { key: "p20", label: "P(2,0) at τ", value: h.p20, unit: "" },
      { key: "p02", label: "P(0,2) at τ", value: h.p02, unit: "" },
      { key: "overlap", label: "Overlap at τ", value: M, unit: "" },
      { key: "visibility", label: "HOM visibility", value: h0.visibility, unit: "" },
      { key: "dipFwhm", label: "Dip FWHM", value: dipFwhm / 1e-15, unit: "fs" },
    ];
    lines.push(BS_CONVENTION);
    lines.push(`Input |1,1⟩: one photon in each port of a splitter with R = ${t6(R)}, T = ${t6(T)}; zero-delay overlap M₀ = ${t6(M0)}; photon intensity FWHM w = ${ts(w)}; delay τ = ${ts(tau)}.`);
    lines.push({ math: "P_{11} = T^2 + R^2 - 2 R T abs(braket(ψ_1, ψ_2))^2", fallback: "P(1,1) = T² + R² − 2RT·|⟨ψ₁|ψ₂⟩|²" });
    lines.push({ math: "P_{20} = P_{02} = R T (1 + abs(braket(ψ_1, ψ_2))^2)", fallback: "P(2,0) = P(0,2) = RT(1 + |⟨ψ₁|ψ₂⟩|²)" });
    lines.push(
      { math: "abs(braket(ψ_1, ψ_2(τ)))^2 = M_0 e^{-τ^2/(4 σ^2)}", fallback: "|⟨ψ₁|ψ₂(τ)⟩|² = M₀·exp(−τ²/(4σ²))" },
      { math: "σ = w/(2 sqrt(2 ln 2))", fallback: "σ = w/(2√(2 ln 2))" },
    );
    lines.push(`At τ = ${ts(tau)} the overlap is ${t6(M)}: P(1,1) = ${probShow(h.p11)}, P(2,0) = P(0,2) = ${probShow(h.p20)}.`);
    if (M0 === 1 && Math.abs(R - 0.5) < 1e-12 && Math.abs(tau) < 1e-30) lines.push("Identical photons on a 50:50 splitter never leave by different ports: the two paths to |1,1⟩ (both transmitted, both reflected) cancel, and the photons bunch into |2,0⟩ or |0,2⟩.");
    lines.push({ math: "V_HOM = {C_max - C_min}/C_max = {2 R T M_0}/{T^2 + R^2}", fallback: "V_HOM = (C_max − C_min)/C_max = 2RT·M₀/(T² + R²)" });
    lines.push(`HOM visibility ${t6(h0.visibility)} (coincidences fall from ${probShow(dist.p11)} far from the dip to ${probShow(h0.p11)} at τ = 0). Dip FWHM in delay = √2·w = ${ts(dipFwhm)}.`);
    lines.push("Model: pure single photons with real (transform-limited) Gaussian amplitudes of equal width; M₀ < 1 lumps any other distinguishability (polarisation, frequency) into one overlap factor; lossless splitter, ideal detectors.");
    const rows = [
      ["Output", "P at this delay", "P at τ = 0", "P distinguishable"],
      ["|1,1⟩ (coincidence)", probShow(h.p11), probShow(h0.p11), probShow(dist.p11)],
      ["|2,0⟩", probShow(h.p20), probShow(h0.p20), probShow(dist.p20)],
      ["|0,2⟩", probShow(h.p02), probShow(h0.p02), probShow(dist.p02)],
    ];
    // The dip, ±3 dip widths (wider when the chosen delay lies further out, up to 20 widths).
    let span = 3 * dipFwhm;
    const offPlot = Math.abs(tau) > 20 * dipFwhm;
    if (!offPlot && Math.abs(tau) * 1.15 > span) span = Math.abs(tau) * 1.15;
    const tu = timeUnit(span);
    const pts = Array.from({ length: 241 }, (_, i) => {
      const x = -span + (2 * span * i) / 240;
      return { x: x / tu.f, y: homDip(R, M0, w, x) };
    });
    // The distinguishable level first, so the dip's tails are drawn over it.
    const series: Parameters<typeof buildPlotSvg>[0] = [
      { points: [{ x: -span / tu.f, y: dist.p11 }, { x: span / tu.f, y: dist.p11 }], type: "line", color: "#9a9a9a", label: "Distinguishable" },
      { points: pts, type: "line", color: "#1f5fa8", label: "P(1,1)" },
    ];
    if (!offPlot) series.push({ points: [{ x: tau / tu.f, y: h.p11 }], type: "scatter", color: "#c00000", label: `τ = ${t6(tau / tu.f)} ${tu.u}` });
    else lines.push(`The chosen delay (${t6(tau / tu.f)} ${tu.u}) is beyond 20 dip widths and is not marked on the figure.`);
    const svg = buildPlotSvg(series, { xlabel: `Delay τ (${tu.u})`, ylabel: "Coincidence probability P(1,1)", width: 440, height: 290, yLimits: { min: 0, max: Math.max(0.6, Math.ceil((dist.p11 + 0.05) * 10) / 10), step: 0.1 } });
    return finish(
      lines,
      [
        table("Two-photon output", rows),
        plot(svg, "Hong–Ou–Mandel dip: the coincidence probability P(1,1) against the delay τ, with the distinguishable level and the chosen delay marked.", "A Gaussian dip in coincidence probability centred at zero delay."),
      ],
      outputs,
      u.conversions,
    );
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Multiphoton interference (permanents)
// ---------------------------------------------------------------------------------------------------------------

/** One occupation pattern from a row of numbers: non-negative whole numbers. */
function occupationRow(row: (number | null)[], what: string): number[] | string {
  const out: number[] = [];
  for (const v of row) {
    if (v === null || !Number.isFinite(v)) return `${what}: a mode's photon number is missing.`;
    if (v < 0 || !Number.isInteger(v)) return `${what}: photon numbers are whole numbers 0, 1, 2, … (${t6(v)} given).`;
    out.push(v);
  }
  return out;
}

const mpCalc: QoCalc = {
  id: "lo-multiphoton",
  name: "Multiphoton interference (permanents, boson sampling)",
  group: "Quantum optics",
  unitContract: "domain",
  hint:
    "Photons into an m-mode linear network: a beam splitter, the balanced m-mode Fourier multiport (m = 3: the tritter), a " +
    "chain of beam splitters, or a typed unitary (one row per line, entries separated by commas: i/sqrt(2), e^(2πi/3)/sqrt(3)). " +
    "Input: the photon number in each mode (1, 1, 1). Gives every output pattern's probability |Perm U_st|²/(Πs!Πt!) " +
    `(exact Ryser permanents; at most ${MAX_PHOTONS} photons and ${MAX_MODES} modes) beside the distinguishable-photon value.`,
  fields: [
    {
      key: "net",
      label: "Network",
      default: "dft",
      kind: "select",
      options: [
        { value: "bs", label: "Beam splitter (2 modes)" },
        { value: "dft", label: "Balanced m-mode Fourier multiport (tritter for m = 3)" },
        { value: "chain", label: "Chain of beam splitters (0–1, then 1–2, …)" },
        { value: "typed", label: "Typed unitary matrix" },
      ],
    },
    { key: "R", label: "Beam splitter reflectivity R (for the beam splitter)", default: "0.5", kind: "text" },
    { key: "m", label: "Modes m (for the Fourier multiport)", default: "3", kind: "text" },
    { key: "chain", label: "Chain reflectivities R₁, R₂, … (m − 1 values)", default: "0.5, 0.5", kind: "text" },
    { key: "U", label: "Typed unitary U[out][in] (one row per line)", default: "1/sqrt(2), i/sqrt(2)\ni/sqrt(2), 1/sqrt(2)", kind: "block", rows: 4 },
    { key: "input", label: "Input photons per mode", default: "1, 1, 1", kind: "text" },
    { key: "outputs", label: "Output patterns to evaluate (optional, one per line; blank = all)", default: "", kind: "block", rows: 3 },
  ],
  compute: (r) => {
    const net = r("net") || "dft";
    let U: CMat;
    let netText: string;
    const notes: string[] = [];
    if (net === "bs") {
      const R = fraction(r("R"), "Reflectivity R");
      if (typeof R === "string") return refuse(R);
      U = beamSplitter(R);
      netText = `a beam splitter with R = ${t6(R)}`;
    } else if (net === "dft") {
      const m = intField(r("m"), "Modes m", 2, MAX_MODES);
      if (typeof m === "string") return refuse(m);
      U = dftUnitary(m);
      netText = m === 3 ? "the balanced tritter (3-mode Fourier multiport)" : `the balanced ${m}-mode Fourier multiport`;
    } else if (net === "chain") {
      const db = readDataBlock(r("chain") ?? "", "Chain reflectivities", { maxRows: MAX_MODES });
      if (!db.ok) return refuse(db.error);
      const vals = db.rows.flat();
      if (vals.length < 1 || vals.length > MAX_MODES - 1) return refuse(`Chain reflectivities: give 1 to ${MAX_MODES - 1} values (m − 1 for m modes).`);
      const Rs: number[] = [];
      for (const v of vals) {
        if (v === null || !Number.isFinite(v) || v < 0 || v > 1) return refuse("Chain reflectivities: each is a fraction from 0 to 1.");
        Rs.push(v);
      }
      U = beamSplitterChain(Rs);
      netText = `a chain of ${Rs.length} beam splitter${Rs.length > 1 ? "s" : ""} on ${Rs.length + 1} modes (R = ${Rs.map(t6).join(", ")}; modes 0–1 first)`;
      notes.push(...db.notes);
    } else if (net === "typed") {
      const mr = readComplexMatrix(r("U") ?? "");
      if ("error" in mr) return refuse(`Typed unitary: ${mr.error}`);
      U = mr.U;
      netText = `the typed ${U.length}×${U.length} matrix`;
    } else return refuse(`Unknown network "${net}".`);
    const m = U.length;
    const dev = unitarityDeviation(U);
    if (!(dev.dev <= UNITARY_TOL))
      return refuse(
        `The network matrix is not unitary: the largest entry of U†U − I is ${t6(dev.dev)} (row ${dev.i + 1}, column ${dev.j + 1}). ` +
          "A lossless linear network is unitary to 10⁻⁶; write exact entries (1/sqrt(2), not 0.7071). Lossy networks are outside this tool.",
      );
    // Input pattern.
    const inDb = readDataBlock(r("input") ?? "", "Input photons", { maxRows: 1 });
    if (!inDb.ok) return refuse(inDb.error);
    if (inDb.rows.length !== 1) return refuse("Input photons: give one row, the photon number in each mode (1, 1, 1).");
    const s0 = occupationRow(inDb.rows[0], "Input photons");
    if (typeof s0 === "string") return refuse(s0);
    if (s0.length > m) return refuse(`Input photons: ${s0.length} modes given but the network has ${m}.`);
    const s = [...s0, ...new Array<number>(m - s0.length).fill(0)];
    if (s0.length < m) notes.push(`The input pattern was given for ${s0.length} modes; the remaining ${m - s0.length} are empty: ${fockLabel(s)}.`);
    const n = s.reduce((a, b) => a + b, 0);
    if (n > MAX_PHOTONS) return refuse(`${n} photons: the multiphoton calculation is limited to ${MAX_PHOTONS} photons (exact permanents; boson-sampling sizes beyond that are outside this tool).`);
    // Listed output patterns.
    let listed: number[][] | undefined;
    if ((r("outputs") ?? "").trim()) {
      const oDb = readDataBlock(r("outputs") ?? "", "Output patterns", { maxRows: 200 });
      if (!oDb.ok) return refuse(oDb.error);
      listed = [];
      for (const row of oDb.rows) {
        const t = occupationRow(row, "Output patterns");
        if (typeof t === "string") return refuse(t);
        listed.push(t);
      }
    }
    const run = multiphoton(U, s, listed);
    if (!run.ok) return refuse(run.error);
    const lines: EngLine[] = [...notes];
    lines.push(BS_CONVENTION);
    lines.push(`Input ${fockLabel(s)} (${n} photon${n > 1 ? "s" : ""} in ${m} modes) through ${netText}. U[out][in] is the amplitude for a photon entering mode “in” to leave in mode “out”.`);
    if (m <= 4) lines.push({ math: `U = ${matrixMath(U)}`, fallback: `U = ${U.map((row) => `[${row.map((z) => fmtCx(z).text).join(", ")}]`).join(", ")}` });
    lines.push(`Unitarity checked: the largest entry of U†U − I is ${dev.dev < 1e-15 ? "below 10⁻¹⁵" : t6(dev.dev)}.`);
    lines.push({ math: "P_{s → t} = {abs(Perm(U_{st}))^2}/{prod(j=1, m, s_j!) prod(i=1, m, t_i!)}", fallback: "P(s → t) = |Perm(U_st)|²/(Πⱼ sⱼ! Πᵢ tᵢ!)" });
    lines.push({ math: "Perm(A) = (-1)^n sum(k=1, 2^n - 1, (-1)^{abs(S_k)} prod(i=1, n, r_i(S_k)))", fallback: "Perm(A) = Σₖ (−1)ⁿ⁻ˢ Πᵢ rᵢ(Sₖ), s = |Sₖ| (Ryser)" });
    lines.push("Ryser's formula: Sₖ runs over the 2ⁿ − 1 non-empty subsets of the columns and rᵢ(S) is the sum of row i's entries a_ij over the columns j in S; the subsets are taken in Gray-code order (one column changes per step), O(2ⁿ·n).");
    lines.push("U_st repeats row i of U tᵢ times and column j sⱼ times. Distinguishable photons (the classical comparison): P = Perm(|U_st|²)/Πtᵢ!.");
    const res = run.results;
    if (run.all) lines.push(`${res.length} output pattern${res.length > 1 ? "s" : ""}; the probabilities sum to ${t6(run.total)} (distinguishable: ${t6(run.totalDist)}).`);
    else lines.push(`${res.length} listed output pattern${res.length > 1 ? "s" : ""}; together they carry ${t6(run.total)} of the probability.`);
    const sorted = [...res].sort((a, b) => b.p - a.p);
    const best = sorted[0];
    lines.push(`Most likely: ${fockLabel(best.t)} with ${probShow(best.p)} (distinguishable ${probShow(best.pDist)}).`);
    const suppressed = res.filter((x) => x.p < 1e-12 && x.pDist > 1e-9);
    if (suppressed.length) lines.push(`${suppressed.length} pattern${suppressed.length > 1 ? "s are" : " is"} forbidden by interference (probability 0, but possible for distinguishable photons)${suppressed.length <= 6 ? `: ${suppressed.map((x) => fockLabel(x.t)).join(", ")}` : ""}.`);
    const shownRows = run.all && res.length <= 20 ? res : sorted.slice(0, 12);
    const rows: string[][] = [["Output pattern", "P (indistinguishable)", "P (distinguishable)"]];
    for (const x of shownRows) rows.push([fockLabel(x.t), probShow(x.p), probShow(x.pDist)]);
    const outputs: EngOutput[] = [
      { key: "pmax", label: "Largest pattern probability", value: best.p, unit: "" },
      { key: "total", label: "Total probability of the evaluated patterns", value: run.total, unit: "" },
    ];
    if (res.length <= 20) for (const x of res) outputs.push({ key: `p_${x.t.join("")}`, label: `P${fockLabel(x.t)}`, value: x.p, unit: "" });
    const svg = fockBarsSvg(res.map((x) => ({ t: x.t, p: x.p, pDist: x.pDist })), { title: `Input ${fockLabel(s)}` });
    return finish(
      lines,
      [
        table(shownRows.length === res.length ? "Output patterns" : `The ${shownRows.length} most likely output patterns`, rows),
        plot(svg, `Output-pattern probabilities for ${fockLabel(s)}: indistinguishable photons (blue) beside distinguishable ones (grey).`, "Bar chart of photon output-pattern probabilities."),
      ],
      outputs,
    );
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Dual-rail qubits and linear-optics gates
// ---------------------------------------------------------------------------------------------------------------

const POL_PRESETS: Record<string, { label: string; v: [Cx, Cx] }> = {
  H: { label: "|H⟩", v: [cx(1), cx(0)] },
  V: { label: "|V⟩", v: [cx(0), cx(1)] },
  D: { label: "|D⟩ = (|H⟩ + |V⟩)/√2", v: [cx(Math.SQRT1_2), cx(Math.SQRT1_2)] },
  A: { label: "|A⟩ = (|H⟩ − |V⟩)/√2", v: [cx(Math.SQRT1_2), cx(-Math.SQRT1_2)] },
  R: { label: "|R⟩ = (|H⟩ + i|V⟩)/√2", v: [cx(Math.SQRT1_2), cx(0, Math.SQRT1_2)] },
  L: { label: "|L⟩ = (|H⟩ − i|V⟩)/√2", v: [cx(Math.SQRT1_2), cx(0, -Math.SQRT1_2)] },
};

/** α|H⟩ + β|V⟩ (also |D⟩ |A⟩ |R⟩ |L⟩, or |0⟩ |1⟩) through the core's one ket reader. */
function readPolState(text: string): { v: [Cx, Cx]; notes: string[] } | string {
  const mapped = (text ?? "")
    .replace(/\|\s*H\s*[⟩〉>]/g, "|0⟩")
    .replace(/\|\s*V\s*[⟩〉>]/g, "|1⟩")
    .replace(/\|\s*D\s*[⟩〉>]/g, "|+⟩")
    .replace(/\|\s*A\s*[⟩〉>]/g, "|-⟩")
    .replace(/\|\s*R\s*[⟩〉>]/g, "|i⟩")
    .replace(/\|\s*L\s*[⟩〉>]/g, "|-i⟩");
  const k = parseKet(mapped);
  if ("error" in k) return `Polarisation state: ${k.error.replace(/\|0⟩/g, "|H⟩").replace(/\|1⟩/g, "|V⟩")}`;
  if (k.n !== 1) return "Polarisation state: one photon carries one qubit; write α|H⟩ + β|V⟩.";
  return { v: [k.state[0], k.state[1]], notes: k.notes.map((s) => s.replace(/ψ/g, "ψ")) };
}

const gatesCalc: QoCalc = {
  id: "lo-dual-rail-gates",
  name: "Dual-rail qubits and linear-optics CZ gates",
  group: "Quantum optics",
  unitContract: "domain",
  hint:
    "A polarisation qubit (|H⟩ = |0⟩, |V⟩ = |1⟩) through wave plates (one per line: hwp 22.5, qwp 45, retarder 30 60, rotator 15; " +
    "angles in degrees), then a polarising beam splitter onto two rails: the dual-rail qubit α|1,0⟩ + β|0,1⟩. Then the " +
    "probabilistic two-qubit gates: post-selected CZ (1/9) and KLM heralded CZ (1/16), with the per-photon efficiency " +
    "η = T·η_d, the expected successes in N attempts and the chance of at least one.",
  fields: [
    {
      key: "pol",
      label: "Input polarisation qubit",
      default: "H",
      kind: "select",
      options: [...Object.entries(POL_PRESETS).map(([value, p]) => ({ value, label: p.label })), { value: "typed", label: "Typed state α|H⟩ + β|V⟩" }],
    },
    { key: "state", label: "Typed state (when chosen above)", default: "0.6|H⟩ + 0.8i|V⟩", kind: "text" },
    { key: "plates", label: "Wave plates in order (blank = none)", default: "hwp 22.5", kind: "block", rows: 3 },
    {
      key: "gate",
      label: "Two-qubit gate",
      default: "both",
      kind: "select",
      options: [
        { value: "both", label: "Both CZ gates" },
        { value: "post", label: "Post-selected CZ (1/9)" },
        { value: "klm", label: "KLM heralded CZ (1/16)" },
      ],
    },
    { key: "etad", label: "Detector efficiency η_d (0–1 or %)", default: "0.9", kind: "text" },
    { key: "trans", label: "Transmission per photon T, source to detector (0–1 or %)", default: "1", kind: "text" },
    { key: "N", label: "Gate attempts N", default: "1000", kind: "text" },
  ],
  compute: (r) => {
    const polKey = r("pol") || "H";
    let vin: [Cx, Cx];
    let inLabel: string;
    const lines: EngLine[] = [];
    if (polKey === "typed") {
      const p = readPolState(r("state") ?? "");
      if (typeof p === "string") return refuse(p);
      vin = p.v;
      inLabel = (r("state") ?? "").trim();
      lines.push(...p.notes);
    } else if (POL_PRESETS[polKey]) {
      vin = POL_PRESETS[polKey].v;
      inLabel = POL_PRESETS[polKey].label;
    } else return refuse(`Unknown input polarisation "${polKey}".`);
    const el = readElements(r("plates") ?? "");
    if (!el.ok) return refuse(`Wave plates: ${el.reason}`);
    const etad = fraction(r("etad"), "Detector efficiency η_d");
    if (typeof etad === "string") return refuse(etad);
    const Tr = fraction(r("trans"), "Transmission per photon T");
    if (typeof Tr === "string") return refuse(Tr);
    const N = intField((r("N") ?? "").replace(/[,\s]/g, ""), "Gate attempts N", 1, 1e9);
    if (typeof N === "string") return refuse(N);
    const gateKey = r("gate") || "both";
    const gates = LO_GATES.filter((g) => gateKey === "both" || g.key === gateKey);
    if (!gates.length) return refuse(`Unknown gate "${gateKey}".`);
    const dr = dualRail(vin, el.elements);
    if (!dr) return refuse("No light passes the elements (a polariser blocks the whole state): there is no qubit after them.");
    const eta = Tr * etad;
    // 1. The single qubit.
    lines.push(
      "Dual-rail encoding: one photon in two modes, |0⟩_L = |1,0⟩ (photon in rail 0), |1⟩_L = |0,1⟩. A polarising beam splitter (H transmitted to rail 0, V reflected to rail 1) maps α|H⟩ + β|V⟩ onto α|1,0⟩ + β|0,1⟩.",
    );
    lines.push({ math: `α ket(H) + β ket(V) → α ${FOCK10} + β ${FOCK01}`, fallback: "α|H⟩ + β|V⟩ → α|1,0⟩ + β|0,1⟩" });
    lines.push(`Input: ${inLabel}. Elements: ${el.elements.length ? el.elements.length : "none"} (jones.ts conventions: exp(−iωt), fast axis at the angle given, the slow axis gains the phase δ; a global phase is dropped).`);
    const pol = twoModeState(dr.out[0], dr.out[1], "|H⟩", "|V⟩", "ket(H)", "ket(V)");
    const rail = twoModeState(dr.out[0], dr.out[1], "|1,0⟩", "|0,1⟩", FOCK10, FOCK01);
    lines.push(`After the wave plates: ${pol.text}; on the rails: ${rail.text}.`);
    lines.push({ math: `ket(ψ) = ${rail.math}`, fallback: `|ψ⟩ = ${rail.text}` });
    if (dr.transmitted < 1 - 1e-12) lines.push(`A polariser passes ${probShow(dr.transmitted)} of the light: the state shown is the one that passed (renormalised); a polariser is a filter, not a unitary gate.`);
    lines.push(`P(rail 0) = P(|0⟩_L) = ${probShow(dr.rail[0])}; P(rail 1) = P(|1⟩_L) = ${probShow(dr.rail[1])}.`);
    // 2. The two-qubit gates.
    lines.push("CZ on two dual-rail qubits: |x, y⟩ → (−1)ˣʸ|x, y⟩. With linear optics alone it succeeds only with some probability:");
    lines.push({ math: "CZ ket(x y) = (-1)^{x y} ket(x y)", fallback: "CZ|x, y⟩ = (−1)ˣʸ|x, y⟩" });
    lines.push({ math: "P_succ = p_0 η^k", fallback: "P_succ = p₀·ηᵏ" }, { math: "η = T η_d", fallback: "η = T·η_d" });
    lines.push({ math: "P_N = 1 - (1 - P_succ)^N", fallback: "P_N = 1 − (1 − P_succ)ᴺ" });
    lines.push("P_N is the chance of at least one success in N attempts.");
    lines.push(`Per-photon efficiency η = T·η_d = ${t6(Tr)} × ${t6(etad)} = ${t6(eta)}.`);
    const outputs: EngOutput[] = [
      { key: "p_rail0", label: "P(rail 0)", value: dr.rail[0], unit: "" },
      { key: "p_rail1", label: "P(rail 1)", value: dr.rail[1], unit: "" },
      { key: "eta", label: "Per-photon efficiency η", value: eta, unit: "" },
    ];
    const rows: string[][] = [["Gate", "Ideal p₀", "Detected photons k", "P_succ per attempt", "Expected successes in N", "P(at least one)", "Mean attempts per success"]];
    for (const g of gates) {
      const gr = gateRate(g, eta, N);
      lines.push(`${g.name}: p₀ = ${g.p0Text} (${g.cite}); ${g.what}. P_succ = ${g.p0Text} × ${t6(eta)}${toSuperscript(String(g.k))} = ${t6(gr.p)}${gr.p > 0 ? `; in N = ${N} attempts: ${t6(gr.expected)} expected successes, P(at least one) = ${t6p(gr.none)}, ${t6(gr.meanAttempts)} attempts per success on average` : "; with η = 0 the gate never succeeds"}.`);
      rows.push([g.name, g.p0Text, String(g.k), t6(gr.p), t6(gr.expected), t6p(gr.none), gr.p > 0 ? t6(gr.meanAttempts) : "never"]);
      outputs.push(
        { key: `p_${g.key}`, label: `${g.name}: P_succ`, value: gr.p, unit: "" },
        { key: `n_${g.key}`, label: `${g.name}: expected successes`, value: gr.expected, unit: "" },
        { key: `any_${g.key}`, label: `${g.name}: P(at least one)`, value: gr.atLeastOne, unit: "" },
      );
    }
    lines.push(
      "Model: only the success RATE is modelled; k counts the photons that must be detected for the gate to succeed (two for both gates), each at efficiency η. No dark counts. With η_d < 1 a heralded (KLM) gate can also give a FALSE herald (a lost photon making a wrong pattern look right), which lowers the output fidelity and is not modelled. KLM's near-deterministic teleported gates are outside this tool.",
    );
    const curve = (g: (typeof LO_GATES)[number]) => Array.from({ length: 101 }, (_, i) => ({ x: i / 100, y: gateRate(g, (Tr * i) / 100, 1).p }));
    const colors: Record<string, string> = { post: "#1f5fa8", klm: "#d07a00" };
    const series: Parameters<typeof buildPlotSvg>[0] = [];
    for (const g of gates) series.push({ points: curve(g), type: "line", color: colors[g.key], label: g.key === "post" ? "Post-selected CZ, 1/9" : "KLM heralded CZ, 1/16" });
    series.push({ points: gates.map((g) => ({ x: etad, y: gateRate(g, eta, 1).p })), type: "scatter", color: "#c00000", label: `Chosen: ${t6(etad)}` });
    const yTop = Math.max(...gates.map((g) => g.p0)) * Tr * Tr;
    const yStep = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02].find((st) => yTop / st <= 6) ?? 0.02;
    const svg = buildPlotSvg(series, {
      xlabel: "Detector efficiency",
      ylabel: "Success probability per attempt",
      width: 440,
      height: 290,
      xLimits: { min: 0, max: 1, step: 0.2 },
      yLimits: { min: 0, max: yTop > 0 ? Math.ceil((yTop * 1.04) / yStep) * yStep : 0.12, step: yTop > 0 ? yStep : 0.02 },
      ...(Tr < 1 ? { notes: [`Transmission per photon T = ${t6(Tr)}`] } : {}),
    });
    return finish(
      lines,
      [
        table("Dual-rail qubit", [["Rail", "Amplitude", "Probability"], ["0 (|H⟩, |0⟩_L)", fmtCx(dr.out[0]).text, probShow(dr.rail[0])], ["1 (|V⟩, |1⟩_L)", fmtCx(dr.out[1]).text, probShow(dr.rail[1])]]),
        table(`Linear-optics CZ gates, N = ${N} attempts`, rows),
        plot(svg, "Success probability per attempt of the linear-optics CZ gates against detector efficiency (two detected photons each), with the chosen efficiency marked.", "Two rising parabolas of gate success probability against detector efficiency."),
      ],
      outputs,
    );
  },
};

export const LINEAR_OPTICS_CALCS: QoCalc[] = [mzCalc, homCalc, mpCalc, gatesCalc];
