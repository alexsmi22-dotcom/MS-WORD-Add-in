// Pane glue for Release Q part Q6 (NEW group "Quantum mechanics"): particle in a box (infinite and finite square
// well), the harmonic oscillator, the hydrogen-like atom, rectangular-barrier tunnelling and two-level dynamics (Rabi
// oscillation, Larmor precession, e^{−iHt/ħ} on a typed 2 × 2 Hamiltonian). Kept OUT of taskpane.ts; the integrator
// spreads QUANTUM_MECHANICS_CALCS into ENG_CALCS and adds "Quantum mechanics" to ENG_GROUP_ORDER.
//
// No number is computed here: quantumMechanics.ts owns them (CODATA 2018 constants in its one cited block). This file
// reads the fields — every dimensional one through units.ts parseMeasured (unit contract "converts") — words the
// result under the display contract (U+2212, ×10ⁿ, no caret, em dash, NaN or Infinity in an ok result) and draws.
// A typed state and a typed Hamiltonian go through quantumDirac.ts readState / readOperator (Q1's one reader); the
// Hamiltonian's energy unit is a select, because a matrix of numbers carries no unit of its own.

import type { EngCalcDef, EngField } from "./engCalc";
import { engReport, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { fmtState, type CMat } from "./quantumCore";
import { readOperator, readState } from "./quantumDirac";
import {
  CODATA_2018,
  CODATA_SOURCE,
  C_LIGHT,
  EV,
  HBAR,
  H_PLANCK,
  M_E,
  OSC_MAX_N,
  RADIAL_MAX_N,
  SERIES_NAMES,
  barrierResonances,
  barrierT,
  bloch2,
  evolve2,
  finiteWell,
  finiteWellPsi,
  harmonicOscillator,
  hydrogenLevel,
  hydrogenModel,
  hydrogenTransition,
  infiniteWell,
  isErr,
  larmorOmega,
  oscillatorProbOutside,
  oscillatorPsi,
  rabiP1,
  radialP,
  radialStats,
  type HydrogenModel,
} from "./quantumMechanics";
import { TUNNEL_LOG_FLOOR, curvesSvg, hydrogenLevelSvg, levelFigureSvg, tunnelSvg, type CurveSeries, type LevelCurve } from "./quantumMechanicsCharts";

type QmCalc = EngCalcDef<"Quantum mechanics">;

const UNIT_NOTE =
  "Units: lengths, energies, masses, frequencies, times and fields convert (1 nm, 10 Å, 0.5 eV, 8×10⁻²⁰ J, 1 Da, 1 MHz, " +
  "0.25 µs, 2 mT); a unit of the wrong quantity is refused. meV is not a unit the converter knows: type 0.001 eV.";

const refuse = (t: string): AnalyzeOutput => ({ text: trueMinus(t.replace(/—/g, ";")), ok: false });

/** Six significant figures, trailing zeros dropped, U+2212, ×10ⁿ outside 10⁻³…10⁵. */
export const n6 = (v: number, s = 6): string => (Math.abs(v) < 1e-300 ? "0" : fmtSig(v, s).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, ""));

/** A number known only as log₁₀ (an opaque barrier's T): mantissa × 10ⁿ at s significant figures. */
export function fromLog10(lg: number, s = 6): string {
  if (!Number.isFinite(lg)) return lg < 0 ? "0" : "not finite";
  if (lg > -300) return n6(Math.pow(10, lg), s);
  let e = Math.floor(lg);
  let m = Math.pow(10, lg - e);
  if (Number(m.toPrecision(s)) >= 10) {
    m /= 10;
    e += 1;
  }
  return `${n6(m, s)}×10${String(e).replace("-", "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)])}`;
}

/** A value scaled to the SI prefix that puts it in [1, 1000): "1.5 nm", "250 µs". */
function prefixed(v: number, base: string, prefixes: Array<[number, string]>, s = 6): string {
  const a = Math.abs(v);
  if (a === 0) return `0 ${base}`;
  for (const [k, p] of prefixes) if (a >= k * 0.9999995) return `${n6(v / k, s)} ${p}${base}`;
  const [k, p] = prefixes[prefixes.length - 1];
  return `${n6(v / k, s)} ${p}${base}`;
}
const LEN_P: Array<[number, string]> = [[1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];
const TIME_P: Array<[number, string]> = [[1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];
const FREQ_P: Array<[number, string]> = [[1e15, "P"], [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""]];
const lenText = (m: number, s = 6): string => (Math.abs(m) >= 1 ? `${n6(m, s)} m` : prefixed(m, "m", LEN_P, s));
const timeText = (t: number, s = 6): string => (Math.abs(t) >= 1 ? `${n6(t, s)} s` : prefixed(t, "s", TIME_P, s));
const freqText = (hz: number, s = 6): string => (Math.abs(hz) < 1 ? `${n6(hz, s)} Hz` : prefixed(hz, "Hz", FREQ_P, s));
const eVText = (J: number, s = 6): string => `${n6(J / EV, s)} eV`;

/** The display scale for an energy axis: eV, meV, µeV, keV or MeV by the largest value. */
function energyScale(maxEv: number): { k: number; unit: string } {
  const a = Math.abs(maxEv);
  if (a >= 1e6) return { k: 1e-6, unit: "MeV" };
  if (a >= 1e3) return { k: 1e-3, unit: "keV" };
  if (a >= 1) return { k: 1, unit: "eV" };
  if (a >= 1e-3) return { k: 1e3, unit: "meV" };
  return { k: 1e6, unit: "µeV" };
}

/** Unit-aware field reading (the titration / transmission-line pattern): errors collected, conversions reported. */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    if (/^[+-]?[\d.]+(?:[eE][+-]?\d+)?\s*u$/.test(raw)) {
      errors.push(`${label}: write the unified atomic mass unit as Da ("${raw.replace(/u$/, "Da")}").`);
      return NaN;
    }
    if (/meV$/.test(raw)) {
      errors.push(`${label}: meV is not a unit the converter knows; type the energy in eV (1 meV = 0.001 eV).`);
      return NaN;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(si === "" ? `${label}: "${raw}" must be a plain number (no unit).` : `${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12) {
      conversions.push(`${label}: ${n6(m.value)} ${formatUnit(m.unit)} = ${n6(m.inTarget)} ${shown}`);
    }
    return m.inTarget;
  };
  /** The first of several target units the text converts to (an angular frequency typed as rad/s, Hz, N/m or cm⁻¹). */
  const readAny = (key: string, targets: Array<[string, string]>, label: string): { v: number; si: string } | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      errors.push(`${label}: this field is required.`);
      return null;
    }
    for (const [si] of targets) {
      const m = parseMeasured(raw, si);
      if (!("error" in m) && Number.isFinite(m.inTarget)) {
        if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12) {
          conversions.push(`${label}: ${n6(m.value)} ${formatUnit(m.unit)} = ${n6(m.inTarget)} ${formatUnit(si)}`);
        }
        return { v: m.inTarget, si };
      }
    }
    errors.push(`${label}: "${raw}" is not ${targets.map(([, d]) => d).join(", ")}.`);
    return null;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    readAny,
  };
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 320);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngReportLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(CODATA_SOURCE);
  lines.push(UNIT_NOTE);
  const out = engReport(lines.map((l) => (typeof l === "string" ? trueMinus(l.replace(/—/g, ";")) : l)), extra);
  return { ...out, outputs };
}

const tableLine = (label: string, rows: string[][]): EngReportLine => ({ table: rows.map((r) => r.map((c) => trueMinus(c))), label });

// ---------------------------------------------------------------------------------------------------------------
// The particle
// ---------------------------------------------------------------------------------------------------------------

const PARTICLE_FIELDS: EngField[] = [
  {
    key: "particle",
    label: "Particle",
    default: "electron",
    kind: "select",
    options: [
      { value: "electron", label: "Electron (mₑ, CODATA 2018)" },
      { value: "proton", label: "Proton (mₚ, CODATA 2018)" },
      { value: "neutron", label: "Neutron (mₙ, CODATA 2018)" },
      { value: "effective", label: "Electron with an effective mass m*/mₑ (semiconductor)" },
      { value: "typed", label: "Typed mass" },
    ],
  },
  { key: "mstar", label: "Effective mass ratio m*/mₑ (effective-mass option; GaAs 0.067)", default: "0.067", kind: "text" },
  { key: "mass", label: "Typed mass (typed option; kg or Da)", default: "1 Da", kind: "text" },
];

function readMass(r: (k: string) => string, u: ReturnType<typeof unitReader>): { m: number; text: string } {
  const p = r("particle") || "electron";
  if (p === "proton") return { m: CODATA_2018.mp, text: `proton, mₚ = ${n6(CODATA_2018.mp, 12)} kg` };
  if (p === "neutron") return { m: CODATA_2018.mn, text: `neutron, mₙ = ${n6(CODATA_2018.mn, 12)} kg` };
  if (p === "effective") {
    const k = u.req("mstar", "", "", "Effective mass ratio m*/mₑ");
    if (Number.isFinite(k) && k <= 0) u.errors.push("Effective mass ratio m*/mₑ: it must be positive.");
    return { m: k * M_E, text: `electron with m* = ${n6(k)} mₑ = ${n6(k * M_E)} kg` };
  }
  if (p === "typed") {
    const m = u.req("mass", "kg", "kg", "Typed mass");
    if (Number.isFinite(m) && m <= 0) u.errors.push("Typed mass: the mass must be positive.");
    return { m, text: `typed mass ${n6(m)} kg` };
  }
  return { m: M_E, text: `electron, mₑ = ${n6(M_E, 11)} kg` };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Particle in a box
// ---------------------------------------------------------------------------------------------------------------

const boxCalc: QmCalc = {
  id: "qm-particle-box",
  name: "Particle in a box (infinite and finite square well)",
  group: "Quantum mechanics",
  unitContract: "converts",
  hint:
    "A particle confined to a square well. Infinite well: the levels Eₙ = n²π²ħ²/(2mL²), the wavefunction, ⟨x⟩, Δx and " +
    "Δp. Finite well of depth V₀: the bound states found by bracketed root finding of the even and odd matching " +
    "conditions, their number and energies (measured from the well floor). Drawn: the potential with the levels and |ψ|² " +
    "on each.",
  fields: [
    {
      key: "well",
      label: "Well",
      default: "infinite",
      kind: "select",
      options: [
        { value: "infinite", label: "Infinite square well (0 ≤ x ≤ L)" },
        { value: "finite", label: "Finite square well (depth V₀)" },
      ],
    },
    ...PARTICLE_FIELDS,
    { key: "width", label: "Well width L (full width)", default: "1 nm", kind: "text" },
    { key: "depth", label: "Well depth V₀ (finite well)", default: "1 eV", kind: "text" },
    { key: "n", label: "State n for ⟨x⟩, Δx, Δp (infinite well)", default: "1", kind: "text" },
    { key: "levels", label: "Levels listed and drawn (1 to 8)", default: "4", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const finite = (r("well") || "infinite") === "finite";
    const mass = readMass(r, u);
    const L = u.req("width", "m", "m", "Well width L");
    const V0 = finite ? u.req("depth", "J", "J", "Well depth V₀") : NaN;
    const nState = Number((r("n") ?? "1").trim() || "1");
    const nLev = Number((r("levels") ?? "4").trim() || "4");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!Number.isInteger(nLev) || nLev < 1 || nLev > 8) return refuse("Levels listed and drawn: a whole number from 1 to 8.");
    if (finite) return finiteBox(mass, L, V0, nLev, u.conversions);
    const w = infiniteWell(mass.m, L, nState);
    if (isErr(w)) return refuse(w.error);
    const lines: EngReportLine[] = [];
    lines.push(`Infinite square well of width L = ${lenText(L)}; ${mass.text}.`);
    lines.push({ math: "E_n = (n^2 π^2 hbar^2)/(2 m L^2)", fallback: "Eₙ = n²π²ħ²/(2mL²)" });
    lines.push({ math: "ψ_{n}(x) = sqrt(2/L) sin((n π x)/L)", fallback: "ψₙ(x) = √(2/L)·sin(nπx/L), 0 ≤ x ≤ L" });
    lines.push(`Ground state E₁ = ${eVText(w.E1)} = ${n6(w.E1)} J; Eₙ = n²E₁.`);
    const rows: string[][] = [["n", "Eₙ (eV)", "Eₙ (J)", "Eₙ/E₁"]];
    for (let n = 1; n <= nLev; n++) rows.push([String(n), n6((n * n * w.E1) / EV), n6(n * n * w.E1), String(n * n)]);
    lines.push(tableLine("Energy levels", rows));
    lines.push({ math: "Δx = L sqrt(1/12 - 1/(2 n^2 π^2))", fallback: "Δx = L·√(1/12 − 1/(2n²π²))" });
    lines.push({ math: "Δp = (n π hbar)/L", fallback: "Δp = nπħ/L (⟨p⟩ = 0)" });
    lines.push(
      `State n = ${w.n}: Eₙ = ${eVText(w.En)}; ⟨x⟩ = L/2 = ${lenText(w.xMean)}; Δx = ${lenText(w.dx)}; Δp = ${n6(w.dp)} kg·m/s; ` +
        `ΔxΔp = ${n6((w.dx * w.dp) / HBAR, 5)} ħ (≥ ½ħ).`,
    );
    const dE21 = 3 * w.E1;
    const lam21 = (H_PLANCK * C_LIGHT) / dE21;
    lines.push(`Photon for the 2 → 1 transition: ΔE = ${eVText(dE21)}, λ = ${lenText(lam21)} (vacuum).`);
    lines.push("Model: one particle, non-relativistic, V = 0 inside and infinite walls (ψ = 0 at x = 0 and x = L).");
    // Figure.
    const sc = energyScale((nLev * nLev * w.E1) / EV);
    const Ed = (J: number): number => (J / EV) * sc.k;
    // Each curve is scaled to 0.72 of the gap to the next level ((2n + 1)E₁), so none reaches the level above.
    const ampOf = (n: number): number => 0.72 * Ed((2 * n + 1) * w.E1);
    const amp = ampOf(nLev);
    const top = Ed(nLev * nLev * w.E1) + amp + 0.08 * Ed(nLev * nLev * w.E1);
    const levels: LevelCurve[] = [];
    for (let n = 1; n <= nLev; n++) {
      const curve: Array<[number, number]> = Array.from({ length: 401 }, (_, i) => [i / 400, Math.pow(Math.sin((n * Math.PI * i) / 400), 2)]);
      levels.push({ E: Ed(n * n * w.E1), x1: 0, x2: 1, label: `n = ${n}`, value: `${n6(Ed(n * n * w.E1), 4)} ${sc.unit}`, curve, amp: ampOf(n) });
    }
    const svg = levelFigureSvg({
      xRange: [-0.14, 1.14],
      potential: [[0, top], [0, 0], [1, 0], [1, top]],
      walls: [[-0.14, 0], [1, 1.14]],
      levels,
      amp,
      eRange: [0, top],
      xTicks: [{ v: 0, label: "0" }, { v: 0.5, label: "L/2" }, { v: 1, label: "L" }],
      xTitle: `Position x (L = ${lenText(L, 4)})`,
      yTitle: `Energy (${sc.unit})`,
    });
    const outputs: EngOutput[] = [
      { key: "E1", label: "E₁", value: w.E1 / EV, unit: "eV" },
      { key: "E2", label: "E₂", value: (4 * w.E1) / EV, unit: "eV" },
      { key: "E3", label: "E₃", value: (9 * w.E1) / EV, unit: "eV" },
      { key: "En", label: `E${w.n} (state n)`, value: w.En / EV, unit: "eV" },
      { key: "dx", label: "Δx", value: w.dx * 1e9, unit: "nm" },
      { key: "dp", label: "Δp", value: w.dp, unit: "kg·m/s" },
      { key: "lambda21", label: "λ (2 → 1)", value: lam21 * 1e9, unit: "nm" },
    ];
    return finish(lines, u.conversions, [plot(svg, `Infinite square well: the first ${nLev} level${nLev > 1 ? "s" : ""} with |ψₙ|² drawn on each (each scaled to fit below the next level).`, "Square well with energy levels and probability densities")], outputs);
  },
};

function finiteBox(mass: { m: number; text: string }, w: number, V0: number, nLev: number, conversions: string[]): AnalyzeOutput {
  const fw = finiteWell(mass.m, V0, w);
  if (isErr(fw)) return refuse(fw.error);
  const st = fw.states;
  const lines: EngReportLine[] = [];
  lines.push(`Finite square well: width w = ${lenText(w)} (half-width a = ${lenText(fw.a)}), depth V₀ = ${eVText(V0)}; ${mass.text}.`);
  lines.push({ math: "z_0 = (a sqrt(2 m V_0))/hbar", fallback: "z₀ = a√(2mV₀)/ħ" });
  lines.push({ math: "tan(z) = sqrt((z_0/z)^2 - 1)", fallback: "even states: tan z = √((z₀/z)² − 1)" });
  lines.push({ math: "-cot(z) = sqrt((z_0/z)^2 - 1)", fallback: "odd states: −cot z = √((z₀/z)² − 1)" });
  lines.push({ math: "E = (hbar^2 z^2)/(2 m a^2)", fallback: "E = ħ²z²/(2ma²), z = ka, measured from the well floor" });
  lines.push(`z₀ = ${n6(fw.z0)}: ${st.length} bound state${st.length === 1 ? "" : "s"} (N = ⌈2z₀/π⌉; there is always at least one).`);
  if (fw.threshold) lines.push("A further state sits at the rim (z₀ is a multiple of π/2 to 10⁻⁶): it is not counted as bound.");
  const rows: string[][] = [["n", "Parity", "E above floor (eV)", "E − V₀ (eV)", "z = ka"]];
  const shown = st.slice(0, 50);
  for (const s of shown) rows.push([String(s.n), s.parity, n6(s.E / EV), n6((s.E - V0) / EV), n6(s.z)]);
  lines.push(tableLine(st.length > 50 ? `Bound states (the lowest 50 of ${st.length})` : "Bound states", rows));
  const inf1 = (Math.PI * Math.PI * HBAR * HBAR) / (2 * mass.m * w * w);
  lines.push(`Ground state E₁ = ${eVText(st[0].E)} above the floor (${eVText(st[0].E - V0)} relative to the rim); the infinite well of the same width gives ${eVText(inf1)}.`);
  lines.push("Model: one particle, non-relativistic, V = 0 for |x| < a and V₀ outside; energies are measured from the well floor.");
  // Figure: the lowest bound states (at most nLev).
  const draw = st.slice(0, nLev);
  const sc = energyScale(V0 / EV);
  const Ed = (J: number): number => (J / EV) * sc.k;
  // Each curve fits below the next bound level (0.72 of the gap). The top drawn state, when no bound state follows,
  // stays under the rim if that leaves a readable height (0.35 of its own gap below, or of V₀ when it is alone).
  const topState = draw[draw.length - 1];
  const ampOf = (k: number): number => {
    const next = st[k + 1];
    if (next) return 0.72 * Ed(next.E - st[k].E);
    const below = k > 0 ? Ed(st[k].E - st[k - 1].E) : Ed(V0);
    return Math.min(0.72 * below, Math.max(0.85 * Ed(V0 - st[k].E), 0.35 * below));
  };
  const amp = ampOf(draw.length - 1);
  const kapTop = Math.sqrt(Math.max(0, fw.z0 * fw.z0 - topState.z * topState.z)) / fw.a;
  const half = Math.min(2.5, Math.max(1.0, 0.5 + 3 / (Math.max(kapTop, 1e-300) * w))); // in units of w
  const eTop = Math.max(Ed(V0) * 1.15, Ed(topState.E) + amp * 1.08);
  const levels: LevelCurve[] = draw.map((s, k) => {
    const pts: Array<[number, number]> = [];
    let mx = 0;
    for (let i = 0; i <= 600; i++) {
      const xw = -half + (2 * half * i) / 600;
      const v = Math.pow(finiteWellPsi(s, fw.z0, fw.a, xw * w), 2);
      mx = Math.max(mx, v);
      pts.push([xw, v]);
    }
    return { E: Ed(s.E), x1: -0.5, x2: 0.5, label: `n = ${s.n}`, value: `${n6(Ed(s.E), 4)} ${sc.unit}`, curve: pts.map(([x, v]) => [x, mx > 0 ? v / mx : 0]), amp: ampOf(k) };
  });
  levels.unshift({ E: Ed(V0), x1: -half, x2: -half, label: "V₀", value: `${n6(Ed(V0), 4)} ${sc.unit}`, curve: [] });
  const ticks = [{ v: -0.5, label: "−w/2" }, { v: 0, label: "0" }, { v: 0.5, label: "w/2" }];
  if (half >= 1) ticks.push({ v: -1, label: "−w" }, { v: 1, label: "w" });
  const svg = levelFigureSvg({
    xRange: [-half, half],
    potential: [[-half, Ed(V0)], [-0.5, Ed(V0)], [-0.5, 0], [0.5, 0], [0.5, Ed(V0)], [half, Ed(V0)]],
    levels,
    amp,
    eRange: [0, eTop],
    xTicks: ticks,
    xTitle: `Position x (w = ${lenText(w, 4)})`,
    yTitle: `Energy (${sc.unit})`,
  });
  const outputs: EngOutput[] = [
    { key: "count", label: "Bound states", value: st.length, unit: "" },
    { key: "z0", label: "z₀", value: fw.z0, unit: "" },
    ...st.slice(0, 8).map((s): EngOutput => ({ key: `E${s.n}`, label: `E${s.n} above the floor`, value: s.E / EV, unit: "eV" })),
    { key: "bind1", label: "E₁ − V₀", value: (st[0].E - V0) / EV, unit: "eV" },
  ];
  const cap = `Finite square well: ${draw.length} of ${st.length} bound state${st.length === 1 ? "" : "s"} with |ψₙ|² (each scaled to fit below the next level); the tails reach into the barriers.`;
  return finish(lines, conversions, [plot(svg, cap, "Finite square well with bound levels and probability densities")], outputs);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Harmonic oscillator
// ---------------------------------------------------------------------------------------------------------------

const oscCalc: QmCalc = {
  id: "qm-harmonic-oscillator",
  name: "Quantum harmonic oscillator",
  group: "Quantum mechanics",
  unitContract: "converts",
  hint:
    "The one-dimensional harmonic oscillator: Eₙ = ħω(n + ½), the Hermite-polynomial wavefunctions (n ≤ 20), the " +
    "classical turning points and the probability of finding the particle outside them. ω may be typed as an angular " +
    "frequency (rad/s), a frequency (Hz, ω = 2πf), a spring constant (N/m, ω = √(k/m)) or a wavenumber (cm⁻¹, ω = 2πcν̃). " +
    "Drawn: the parabola with the levels and |ψₙ|².",
  fields: [
    ...PARTICLE_FIELDS,
    { key: "omega", label: "ω (rad/s), f (Hz), spring constant (N/m) or wavenumber (cm⁻¹)", default: "1e15 rad/s", kind: "text" },
    { key: "n", label: `State n (0 to ${OSC_MAX_N})`, default: "0", kind: "text" },
    { key: "levels", label: "Levels listed and drawn (1 to 8)", default: "5", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const mass = readMass(r, u);
    const om = u.readAny("omega", [["rad/s", "an angular frequency (rad/s)"], ["Hz", "a frequency (Hz)"], ["N/m", "a spring constant (N/m)"], ["1/m", "a wavenumber (cm⁻¹)"]], "ω");
    const n = Number((r("n") ?? "0").trim() || "0");
    const nLev = Number((r("levels") ?? "5").trim() || "5");
    if (u.errors.length || !om) return refuse(u.errors.join("\n"));
    if (!Number.isInteger(nLev) || nLev < 1 || nLev > 8) return refuse("Levels listed and drawn: a whole number from 1 to 8.");
    let omega = om.v;
    let how = "";
    if (om.si === "Hz") {
      omega = 2 * Math.PI * om.v;
      how = `f = ${freqText(om.v)}, ω = 2πf`;
    } else if (om.si === "N/m") {
      if (!(om.v > 0)) return refuse("The spring constant must be positive.");
      omega = Math.sqrt(om.v / mass.m);
      how = `k = ${n6(om.v)} N/m, ω = √(k/m)`;
    } else if (om.si === "1/m") {
      omega = 2 * Math.PI * C_LIGHT * om.v;
      how = `ν̃ = ${n6(om.v / 100)} cm⁻¹, ω = 2πcν̃`;
    }
    const o = harmonicOscillator(mass.m, omega, n);
    if (isErr(o)) return refuse(o.error);
    const lines: EngReportLine[] = [];
    lines.push(`Harmonic oscillator, ω = ${n6(omega)} rad/s${how ? ` (${how})` : ""}; ${mass.text}.`);
    lines.push({ math: "E_n = hbar ω (n + 1/2)", fallback: "Eₙ = ħω(n + ½)" });
    lines.push({ math: "ψ_{n}(x) = 1/sqrt(2^n n!) ((m ω)/(π hbar))^(1/4) H_{n}(ξ) e^(-ξ^2/2)", fallback: "ψₙ(x) = ∜(mω/πħ)·Hₙ(ξ)·exp(−ξ²/2)/√(2ⁿn!)" });
    lines.push({ math: "ξ = x/x_0", fallback: "ξ = x/x₀" });
    lines.push({ math: "x_0 = sqrt(hbar/(m ω))", fallback: "x₀ = √(ħ/(mω))" });
    lines.push({ math: "x_t = sqrt(((2 n + 1) hbar)/(m ω))", fallback: "turning points x = ±√((2n + 1)ħ/(mω))" });
    lines.push(`ħω = ${eVText(o.quantum)} (the level spacing); zero-point energy E₀ = ½ħω = ${eVText(o.quantum / 2)}; x₀ = ${lenText(o.x0)}.`);
    lines.push(
      `State n = ${n}: Eₙ = ${eVText(o.En)}; turning points ±${lenText(o.turning)}; probability outside them ${n6(o.pOutside, 6)}; ` +
        `Δx = ${lenText(o.dx)}, Δp = ${n6(o.dp)} kg·m/s, ΔxΔp = ${n6(n + 0.5, 4)} ħ.`,
    );
    const rows: string[][] = [["n", "Eₙ (eV)", "Turning point ±x (nm)", "P outside"]];
    for (let k = 0; k < nLev; k++) rows.push([String(k), n6((o.quantum * (k + 0.5)) / EV), n6(o.x0 * Math.sqrt(2 * k + 1) * 1e9), n6(oscillatorProbOutside(k), 5)]);
    lines.push(tableLine("Levels", rows));
    lines.push("Model: V = ½mω²x², one particle, non-relativistic; the probability outside the turning points is 1 − ∫|ψₙ|² between them (Simpson, 4000 panels).");
    // Figure in ξ = x/x₀, energies in the display unit.
    const sc = energyScale((o.quantum * nLev) / EV);
    const q = (o.quantum / EV) * sc.k;
    const amp = 0.72 * q;
    const nTop = nLev - 1;
    const eTop = q * (nTop + 0.5) + amp + 0.12 * q;
    const xr = Math.sqrt(2 * nTop + 1) + 2.2;
    const xEdge = Math.min(xr, Math.sqrt((2 * eTop) / q));
    const pot: Array<[number, number]> = Array.from({ length: 241 }, (_, i) => {
      const x = -xEdge + (2 * xEdge * i) / 240;
      return [x, 0.5 * q * x * x];
    });
    const levels: LevelCurve[] = [];
    for (let k = 0; k <= nTop; k++) {
      const pts: Array<[number, number]> = [];
      let mx = 0;
      for (let i = 0; i <= 600; i++) {
        const x = -xr + (2 * xr * i) / 600;
        const v = Math.pow(oscillatorPsi(k, x), 2);
        mx = Math.max(mx, v);
        pts.push([x, v]);
      }
      const t = Math.sqrt(2 * k + 1);
      levels.push({ E: q * (k + 0.5), x1: -t, x2: t, label: `n = ${k}`, value: `${n6(q * (k + 0.5), 4)} ${sc.unit}`, curve: pts.map(([x, v]) => [x, v / mx]) });
    }
    const tk = Math.floor(xr);
    const step = tk >= 6 ? 2 : 1;
    const xTicks = [];
    for (let v = -Math.floor(tk / step) * step; v <= tk; v += step) xTicks.push({ v, label: v < 0 ? `−${-v}` : String(v) });
    const svg = levelFigureSvg({
      xRange: [-xr, xr],
      potential: pot,
      levels,
      amp,
      eRange: [0, eTop],
      xTicks,
      xTitle: `Position x/x₀ (x₀ = ${lenText(o.x0, 4)})`,
      yTitle: `Energy (${sc.unit})`,
    });
    const outputs: EngOutput[] = [
      { key: "E0", label: "E₀ (zero-point)", value: o.quantum / 2 / EV, unit: "eV" },
      { key: "spacing", label: "ħω", value: o.quantum / EV, unit: "eV" },
      { key: "En", label: `E${n}`, value: o.En / EV, unit: "eV" },
      { key: "omega", label: "ω", value: omega, unit: "rad/s" },
      { key: "x0", label: "x₀", value: o.x0 * 1e9, unit: "nm" },
      { key: "turning", label: "Turning point", value: o.turning * 1e9, unit: "nm" },
      { key: "pOutside", label: "P outside the turning points", value: o.pOutside, unit: "" },
    ];
    return finish(lines, u.conversions, [plot(svg, `Harmonic oscillator: V = ½mω²x² with the first ${nLev} levels (drawn between the turning points) and |ψₙ|² on each (scaled to a common height).`, "Parabolic potential with equally spaced levels and probability densities")], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Hydrogen-like atom
// ---------------------------------------------------------------------------------------------------------------

const L_LETTERS = ["s", "p", "d", "f"];

const hydrogenCalc: QmCalc = {
  id: "qm-hydrogen",
  name: "Hydrogen-like atom (levels, transitions, radial probability)",
  group: "Quantum mechanics",
  unitContract: "converts",
  hint:
    "One electron bound to a nucleus of charge Z: the Bohr levels Eₙ = −Z²R∞hc/n² (optionally with the reduced-mass " +
    "correction), the vacuum wavelength of any transition and its series, ionisation energies, and the radial probability " +
    "P(r) = r²|Rₙₗ|² for n ≤ 4. Fine structure, the Lamb shift and hyperfine structure are not included. Drawn: the level " +
    "diagram with the transition, and P(r).",
  fields: [
    { key: "Z", label: "Nuclear charge Z (1 = H, 2 = He⁺, 3 = Li²⁺ …)", default: "1", kind: "text" },
    {
      key: "nucleus",
      label: "Nuclear mass (reduced-mass correction)",
      default: "infinite",
      kind: "select",
      options: [
        { value: "infinite", label: "Infinitely heavy (R∞, no correction)" },
        { value: "proton", label: "Proton, ¹H (CODATA 2018)" },
        { value: "deuteron", label: "Deuteron, ²H (CODATA 2018)" },
        { value: "alpha", label: "Alpha particle, ⁴He nucleus (CODATA 2018)" },
        { value: "typed", label: "Typed nuclear mass" },
      ],
    },
    { key: "nucMass", label: "Typed nuclear mass (typed option; Da or kg; the bare nucleus)", default: "7.014 Da", kind: "text" },
    { key: "upper", label: "Transition: upper level n", default: "3", kind: "text" },
    { key: "lower", label: "Transition: lower level n", default: "2", kind: "text" },
    { key: "orbital", label: "Orbital for P(r) (1s to 4f)", default: "2p", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const Z = Number((r("Z") ?? "1").trim());
    const nuc = r("nucleus") || "infinite";
    let M: number | null = null;
    let nucText = "infinitely heavy nucleus";
    if (nuc === "proton") [M, nucText] = [CODATA_2018.mp, "proton mass"];
    else if (nuc === "deuteron") [M, nucText] = [CODATA_2018.md, "deuteron mass"];
    else if (nuc === "alpha") [M, nucText] = [CODATA_2018.malpha, "alpha-particle mass"];
    else if (nuc === "typed") {
      M = u.req("nucMass", "kg", "kg", "Typed nuclear mass");
      nucText = `nuclear mass ${n6(M ?? NaN)} kg`;
    }
    const nu = Number((r("upper") ?? "").trim());
    const nl = Number((r("lower") ?? "").trim());
    const orb = /^\s*([1-9])\s*([spdfSPDF])\s*$/.exec(r("orbital") ?? "");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!orb) return refuse(`Orbital for P(r): write it as n and a letter, 1s to ${RADIAL_MAX_N}f (e.g. 2p).`);
    const on = Number(orb[1]);
    const ol = L_LETTERS.indexOf(orb[2].toLowerCase());
    if (on > RADIAL_MAX_N) return refuse(`Orbital for P(r): radial probabilities are given for n ≤ ${RADIAL_MAX_N}.`);
    if (ol >= on) return refuse(`Orbital for P(r): l must be below n (${orb[1]}${orb[2]} does not exist).`);
    const h = hydrogenModel(Z, M);
    if (isErr(h)) return refuse(h.error);
    const tr = hydrogenTransition(h, nu, nl);
    if (isErr(tr)) return refuse(tr.error);
    const lines: EngReportLine[] = [];
    const ion = Z === 1 ? "hydrogen" : `hydrogen-like ion, Z = ${Z}`;
    lines.push(`${ion[0].toUpperCase()}${ion.slice(1)}; ${nucText}${M !== null ? `: μ/mₑ = ${n6(h.muRatio, 10)}, R_M = ${n6(h.RM, 12)} m⁻¹` : `: R_M = R∞ = ${n6(CODATA_2018.Rinf, 14)} m⁻¹`}.`);
    lines.push({ math: "E_n = -(Z^2 R_{M} h c)/(n^2)", fallback: "Eₙ = −Z²R_M·hc/n²" });
    if (M !== null) {
      lines.push({ math: "R_{M} = R_{∞} μ/m_e", fallback: "R_M = R∞·μ/mₑ" });
      lines.push({ math: "μ = (m_e M)/(m_e + M)", fallback: "μ = mₑM/(mₑ + M)" });
    }
    lines.push({ math: "1/λ = Z^2 R_{M} (1/(n_l^2) - 1/(n_u^2))", fallback: "1/λ = Z²R_M(1/n_l² − 1/n_u²)" });
    const Eu = hydrogenLevel(h, nu), El = hydrogenLevel(h, nl);
    const series = Z === 1 && SERIES_NAMES[nl] ? `${SERIES_NAMES[nl]} series` : `series ending on n = ${nl}`;
    lines.push(`Levels: E${toSub(nu)} = ${eVText(Eu)}, E${toSub(nl)} = ${eVText(El)}.`);
    lines.push(
      `Transition ${nu} → ${nl} (${series}): photon energy ${eVText(tr.energy)}, wavelength λ = ${lenText(tr.lambda)} in vacuum, ` +
        `frequency ${freqText(tr.freq)}, wavenumber ${n6(tr.wavenumber / 100)} cm⁻¹. Series limit (n → ∞): ${lenText(tr.limit)}.`,
    );
    const E1 = hydrogenLevel(h, 1);
    lines.push(`Ionisation energy from the ground state ${eVText(-E1)}; from n = ${nl}, ${eVText(-El)}.`);
    // Radial probability.
    const st = radialStats(on, ol, Z);
    const aRatio = 1 / h.muRatio; // a_μ / a₀
    lines.push({ math: "P(r) = r^2 abs(R_{nl}(r))^2", fallback: "P(r) = r²|Rₙₗ(r)|²" });
    lines.push(`Orbital ${on}${L_LETTERS[ol]}: ⟨r⟩ = ${n6(st.mean * aRatio, 6)} a₀ = ${lenText(st.mean * h.aMu)}; most probable radius ${n6(st.peak * aRatio, 5)} a₀ = ${lenText(st.peak * h.aMu, 5)}.`);
    const nTab = Math.min(10, Math.max(6, nu));
    const rows: string[][] = [["n", "Eₙ (eV)", "Ionisation from n (eV)"]];
    for (let k = 1; k <= nTab; k++) rows.push([String(k), n6(hydrogenLevel(h, k) / EV), n6(-hydrogenLevel(h, k) / EV)]);
    lines.push(tableLine("Energy levels", rows));
    const za2 = Math.pow(Z * CODATA_2018.alpha, 2);
    lines.push(
      `Model: non-relativistic Bohr–Schrödinger levels; fine structure, the Lamb shift and hyperfine splitting are omitted ` +
        `(relative size of order (Zα)² = ${n6(za2, 3)}); wavelengths are in vacuum, not air.`,
    );
    // Figures.
    const nDraw = Math.min(Math.max(6, nu), 10);
    const lv = Array.from({ length: nDraw }, (_, i) => ({ n: i + 1, E: hydrogenLevel(h, i + 1) / EV }));
    if (nu > nDraw) lv.push({ n: nu, E: Eu / EV });
    const lvSvg = hydrogenLevelSvg({ levels: lv, upper: nu, lower: nl, arrowLabel: lenText(tr.lambda, 5), unit: "eV" });
    const colors = ["#1f5fa8", "#d07a00", "#2e8b57", "#8e44ad"];
    const rMaxA = (2.6 * (3 * on * on)) / (2 * Z) + 4 / Z; // in a_μ
    const series2: CurveSeries[] = [];
    let yMax = 0;
    for (let l = 0; l < on; l++) {
      const pts: Array<[number, number]> = Array.from({ length: 501 }, (_, i) => {
        const ra = (rMaxA * i) / 500;
        return [ra * aRatio, radialP(on, l, Z, ra) / aRatio];
      });
      yMax = Math.max(yMax, ...pts.map((p) => p[1]));
      series2.push({ name: `${on}${L_LETTERS[l]}`, pts, color: colors[l], width: l === ol ? 2.6 : 1.4, dash: l === ol ? "" : "" });
    }
    const rSvg = curvesSvg({ series: series2, xTitle: "Radius r/a₀", yTitle: "P(r) (per a₀)", xRange: [0, rMaxA * aRatio], yRange: [0, yMax * 1.1] });
    const outputs: EngOutput[] = [
      { key: "lambda", label: "λ (vacuum)", value: tr.lambda * 1e9, unit: "nm" },
      { key: "photonE", label: "Photon energy", value: tr.energy / EV, unit: "eV" },
      { key: "freq", label: "Frequency", value: tr.freq, unit: "Hz" },
      { key: "wavenumber", label: "Wavenumber", value: tr.wavenumber / 100, unit: "cm⁻¹" },
      { key: "Eupper", label: "E (upper)", value: Eu / EV, unit: "eV" },
      { key: "Elower", label: "E (lower)", value: El / EV, unit: "eV" },
      { key: "E1", label: "E₁", value: E1 / EV, unit: "eV" },
      { key: "ionisation", label: "Ionisation energy (ground)", value: -E1 / EV, unit: "eV" },
      { key: "rMean", label: "⟨r⟩", value: st.mean * aRatio, unit: "a₀" },
      { key: "rPeak", label: "Most probable r", value: st.peak * aRatio, unit: "a₀" },
    ];
    return finish(lines, u.conversions, [
      plot(lvSvg, `Energy levels (n = 1 to ${nDraw}${nu > nDraw ? ` and ${nu}` : ""}) with the ${nu} → ${nl} transition, λ = ${lenText(tr.lambda, 5)} in vacuum.`, "Hydrogen-like energy level diagram with a transition arrow"),
      plot(rSvg, `Radial probability P(r) = r²|Rₙₗ|² for n = ${on}${on > 1 ? `, l = 0 to ${on - 1}` : ""} (${on}${L_LETTERS[ol]} drawn heavier).`, "Radial probability densities against radius"),
    ], outputs);
  },
};

const toSub = (n: number): string => String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]);

// ---------------------------------------------------------------------------------------------------------------
// 4. Tunnelling
// ---------------------------------------------------------------------------------------------------------------

const tunnelCalc: QmCalc = {
  id: "qm-tunnelling",
  name: "Tunnelling through a rectangular barrier",
  group: "Quantum mechanics",
  unitContract: "converts",
  hint:
    "A particle of energy E meeting a rectangular barrier of height V₀ and width a: the exact transmission T below the " +
    "barrier (tunnelling), at it and above it (with the resonances where T = 1), the reflection R = 1 − T, and the WKB " +
    "estimate exp(−2κa) beside it. Drawn: T against E/V₀, a log axis below the barrier.",
  fields: [
    ...PARTICLE_FIELDS,
    { key: "V0", label: "Barrier height V₀", default: "1 eV", kind: "text" },
    { key: "width", label: "Barrier width a", default: "1 nm", kind: "text" },
    { key: "E", label: "Particle energy E", default: "0.5 eV", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const mass = readMass(r, u);
    const V0 = u.req("V0", "J", "J", "Barrier height V₀");
    const a = u.req("width", "m", "m", "Barrier width a");
    const E = u.req("E", "J", "J", "Particle energy E");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const b = barrierT(mass.m, V0, a, E);
    if (isErr(b)) return refuse(b.error);
    const m = mass.m;
    const lines: EngReportLine[] = [];
    lines.push(`Rectangular barrier V₀ = ${eVText(V0)}, width a = ${lenText(a)}; particle energy E = ${eVText(E)} (E/V₀ = ${n6(E / V0)}); ${mass.text}.`);
    const outputs: EngOutput[] = [{ key: "log10T", label: "log₁₀ T", value: b.log10T, unit: "" }];
    if (b.T > 0) outputs.unshift({ key: "T", label: "Transmission T", value: b.T, unit: "" });
    const Rr = b.T > 0 ? 1 - b.T : 1;
    if (b.regime === "below") {
      lines.push({ math: "T = 1/(1 + (V_0^2 sinh^2(κ a))/(4 E (V_0 - E)))", fallback: "T = [1 + V₀²sinh²(κa)/(4E(V₀ − E))]⁻¹" });
      lines.push({ math: "κ = sqrt(2 (V_0 - E) m)/hbar", fallback: "κ = √(2m(V₀ − E))/ħ" });
      lines.push({ math: "T_WKB ≈ e^(-2 κ a)", fallback: "T_WKB ≈ exp(−2κa)" });
      const kap = b.phase / a;
      lines.push(`Tunnelling (E < V₀): κ = ${n6(kap)} m⁻¹, κa = ${n6(b.phase)}, decay length 1/κ = ${lenText(1 / kap)}.`);
      lines.push(`Transmission T = ${fromLog10(b.log10T)}; reflection R = 1 − T = ${b.T > 1e-6 ? n6(Rr, 8) : "1 (to display precision)"}.`);
      const wk = b.wkbLog10 as number;
      const thickLg = Math.log10(16 * (E / V0) * (1 - E / V0)) + wk;
      lines.push(
        `WKB estimate exp(−2κa) = ${fromLog10(wk)} (exact/WKB = ${fromLog10(b.log10T - wk, 4)}); the thick-barrier limit of the exact ` +
          `result, 16(E/V₀)(1 − E/V₀)exp(−2κa) = ${fromLog10(thickLg)}. WKB drops the prefactor, so it is good to an order of magnitude when κa ≫ 1.`,
      );
      outputs.push({ key: "Twkb_log10", label: "log₁₀ T (WKB)", value: wk, unit: "" });
      outputs.push({ key: "kappa", label: "κ", value: kap, unit: "1/m" });
    } else if (b.regime === "at") {
      lines.push({ math: "T = 1/(1 + (m V_0 a^2)/(2 hbar^2))", fallback: "T = [1 + mV₀a²/(2ħ²)]⁻¹ (E = V₀)" });
      lines.push(`At the barrier top (E = V₀): T = ${n6(b.T)}, R = ${n6(Rr)}. WKB does not apply at or above the barrier.`);
    } else {
      lines.push({ math: "T = 1/(1 + (V_0^2 sin^2(k a))/(4 E (E - V_0)))", fallback: "T = [1 + V₀²sin²(k₂a)/(4E(E − V₀))]⁻¹" });
      lines.push({ math: "k = sqrt(2 (E - V_0) m)/hbar", fallback: "k₂ = √(2m(E − V₀))/ħ" });
      lines.push(`Above the barrier (E > V₀): k₂a = ${n6(b.phase)}; T = ${n6(b.T)}, R = ${n6(Rr)} (classically T = 1). WKB does not apply above the barrier.`);
      const res = barrierResonances(m, V0, a, 3);
      lines.push(`Resonances (T = 1, k₂a = nπ): E = ${res.map((e) => eVText(e, 5)).join(", ")} …`);
    }
    // Table at fixed E/V₀.
    const rows: string[][] = [["E/V₀", "E (eV)", "T (exact)", "T (WKB)"]];
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9, 1, 1.5, 2]) {
      const bb = barrierT(m, V0, a, x * V0);
      if (isErr(bb)) continue;
      rows.push([n6(x), n6((x * V0) / EV), fromLog10(bb.log10T, 4), bb.wkbLog10 === null ? "n/a" : fromLog10(bb.wkbLog10, 4)]);
    }
    lines.push(tableLine("Transmission at a few energies", rows));
    lines.push("Model: one particle, non-relativistic, a sharp-edged barrier with the same potential on both sides; T is computed in the log domain, so an opaque barrier gives a number, not 0.");
    // Figure.
    const xE = E / V0;
    const bx0 = Math.min(0.02, xE / 2);
    const below: Array<{ x: number; lt: number; wkb: number }> = [];
    for (let i = 0; i <= 300; i++) {
      const x = bx0 + ((0.999 - bx0) * i) / 300;
      const bb = barrierT(m, V0, a, x * V0);
      if (!isErr(bb)) below.push({ x, lt: bb.log10T, wkb: bb.wkbLog10 ?? NaN });
    }
    const xMax = Math.min(20, Math.max(3, xE > 1 ? 1.25 * xE : 3));
    const clipped = xE > xMax;
    const e1 = (Math.PI * Math.PI * HBAR * HBAR) / (2 * m * a * a);
    // Resonances k₂a = nπ in the window: up to 20 are drawn as the curve; a denser comb would print as a solid block,
    // so the panel shades the band between the lower envelope [1 + V₀²/(4E(E − V₀))]⁻¹ and T = 1 instead.
    const nOsc = Math.sqrt(((xMax - 1) * V0) / e1);
    const band = nOsc > 20;
    const nS = band ? 400 : Math.min(4000, Math.max(400, Math.ceil(nOsc * 40)));
    const above: Array<{ x: number; t: number }> = [];
    for (let i = 0; i <= nS; i++) {
      const x = 1 + ((xMax - 1) * i) / nS;
      if (band) {
        above.push({ x, t: x === 1 ? 0 : 1 / (1 + 1 / (4 * x * (x - 1))) });
        continue;
      }
      const bb = barrierT(m, V0, a, x * V0);
      if (!isErr(bb)) above.push({ x, t: bb.T });
    }
    const svg = tunnelSvg({ below, above, band, xMax, mark: { x: xE, lt: b.log10T, t: b.T } });
    const offAxis = below.some((p) => p.lt < TUNNEL_LOG_FLOOR);
    const markOff = (xE < 1 && b.log10T < TUNNEL_LOG_FLOOR) || clipped;
    const cap =
      `Transmission through a ${lenText(a, 4)}, ${eVText(V0, 4)} barrier: log scale below the barrier with the WKB estimate dashed, linear above it ` +
      (band
        ? `(the resonances, ${Math.round(nOsc)} in this window, are too dense to draw: T oscillates in the shaded band between the envelope [1 + V₀²/(4E(E − V₀))]⁻¹ and 1)`
        : "(T = 1 at the resonances)") +
      `${markOff ? "" : "; the dot marks E"}.${offAxis ? " T below 10⁻³⁰⁰ runs off the bottom of the axis." : ""}${clipped ? " E lies beyond the drawn window." : ""}`;
    return finish(lines, u.conversions, [plot(svg, cap, "Transmission probability against energy over barrier height")], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Two-level dynamics
// ---------------------------------------------------------------------------------------------------------------

const MAG = {
  electron: { g: CODATA_2018.ge, mu: CODATA_2018.muB, name: "electron", gName: "gₑ", muName: "μ_B" },
  proton: { g: CODATA_2018.gp, mu: CODATA_2018.muN, name: "proton", gName: "gₚ", muName: "μ_N" },
  neutron: { g: CODATA_2018.gn, mu: CODATA_2018.muN, name: "neutron", gName: "gₙ", muName: "μ_N" },
} as const;

const H_UNITS: Record<string, { k: number; label: string; short: string }> = {
  eV: { k: EV, label: "eV", short: "eV" },
  J: { k: 1, label: "J", short: "J" },
  hHz: { k: H_PLANCK, label: "h·Hz (entries are E/h)", short: "h·Hz" },
  hMHz: { k: H_PLANCK * 1e6, label: "h·MHz (entries are E/h)", short: "h·MHz" },
  hbarRad: { k: HBAR, label: "ħ·rad/s (entries are E/ħ)", short: "ħ·rad/s" },
};

/** The time window for a two-level plot: two periods, or the typed time when it is within four. */
function window(period: number, t: number): { t1: number; beyond: boolean } {
  if (!(period > 0) || !Number.isFinite(period)) return { t1: Math.max(t, 1e-300) * 1.2, beyond: false };
  if (t <= 4 * period) return { t1: Math.max(2 * period, 1.1 * t), beyond: false };
  return { t1: 2 * period, beyond: true };
}

/** Seconds to a display scale for a time axis. */
function timeScale(t1: number): { k: number; unit: string } {
  for (const [k, p] of TIME_P) if (t1 >= k * 0.9999995) return { k: 1 / k, unit: `${p}s` };
  return { k: 1e15, unit: "fs" };
}

const twoLevelCalc: QmCalc = {
  id: "qm-two-level",
  name: "Two-level dynamics (Rabi oscillation, spin precession, exp(−iHt/ħ))",
  group: "Quantum mechanics",
  unitContract: "converts",
  hint:
    "A two-level system in time. Rabi: a drive of Rabi frequency Ω and detuning Δ, P₁(t) = Ω²/(Ω² + Δ²)·sin²(√(Ω² + Δ²)t/2) " +
    "from |0⟩. Spin precession: a spin-½ electron, proton or neutron in a field B along z (Larmor frequency from g and the " +
    "magneton). Hamiltonian: any Hermitian 2 × 2 H applied to a typed state, |ψ(t)⟩ = exp(−iHt/ħ)|ψ(0)⟩. Drawn against time.",
  fields: [
    {
      key: "mode",
      label: "Mode",
      default: "rabi",
      kind: "select",
      options: [
        { value: "rabi", label: "Rabi oscillation (drive Ω, detuning Δ)" },
        { value: "spin", label: "Spin-½ precession in a field B" },
        { value: "hamiltonian", label: "Typed 2 × 2 Hamiltonian on a typed state" },
      ],
    },
    { key: "rabi", label: "Rabi frequency Ω/2π (Rabi mode; Hz, MHz …)", default: "1 MHz", kind: "text" },
    { key: "detuning", label: "Detuning Δ/2π (Rabi mode; Hz, MHz …)", default: "0 Hz", kind: "text" },
    {
      key: "spin",
      label: "Spin (spin mode)",
      default: "electron",
      kind: "select",
      options: [
        { value: "electron", label: "Electron (gₑ, μ_B)" },
        { value: "proton", label: "Proton (gₚ, μ_N)" },
        { value: "neutron", label: "Neutron (gₙ, μ_N)" },
      ],
    },
    { key: "B", label: "Field B along z (spin mode; T, mT, G)", default: "0.1 mT", kind: "text" },
    { key: "H", label: "Hamiltonian H (Hamiltonian mode; a 2 × 2 matrix or Pauli expression)", default: "[[0.2, 0.5], [0.5, -0.2]]", kind: "text" },
    {
      key: "hUnit",
      label: "Unit of the entries of H",
      default: "hMHz",
      kind: "select",
      options: Object.entries(H_UNITS).map(([value, v]) => ({ value, label: v.label })),
    },
    { key: "state", label: "Initial state |ψ(0)⟩ (spin and Hamiltonian modes)", default: "|0⟩", kind: "text" },
    { key: "t", label: "Time t", default: "0.25 µs", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const mode = r("mode") || "rabi";
    const t = u.req("t", "s", "s", "Time t");
    if (mode === "rabi") {
      const fR = u.req("rabi", "Hz", "Hz", "Rabi frequency Ω/2π");
      const fD = u.req("detuning", "Hz", "Hz", "Detuning Δ/2π");
      if (u.errors.length) return refuse(u.errors.join("\n"));
      if (!(fR > 0)) return refuse("The Rabi frequency Ω/2π must be positive (Ω = 0 is no drive: P₁ stays 0).");
      if (t < 0) return refuse("The time must be zero or positive.");
      const Om = 2 * Math.PI * fR, De = 2 * Math.PI * fD;
      const W = Math.hypot(Om, De);
      if ((W * t) / 2 > 1e6) return refuse("√(Ω² + Δ²)t/2 is past 10⁶ rad (more than 150 000 cycles): rounding would own sin², use a shorter time.");
      const P1 = rabiP1(Om, De, t);
      // The same answer by e^{−iHt/ħ} with H = (ħ/2)(Ω σx + Δ σz): a cross-check, refused on disagreement.
      const Hr: CMat = [
        [{ re: (HBAR * De) / 2, im: 0 }, { re: (HBAR * Om) / 2, im: 0 }],
        [{ re: (HBAR * Om) / 2, im: 0 }, { re: (-HBAR * De) / 2, im: 0 }],
      ];
      const ev = evolve2(Hr, [{ re: 1, im: 0 }, { re: 0, im: 0 }], t);
      if (isErr(ev)) return refuse(ev.error);
      const P1e = ev.psi[1].re ** 2 + ev.psi[1].im ** 2;
      if (Math.abs(P1e - P1) > 1e-9) return refuse("The closed form and the time evolution disagree; no result is printed (a defect to report).");
      const amp = (Om * Om) / (W * W);
      const period = (2 * Math.PI) / W;
      const lines: EngReportLine[] = [];
      lines.push(`Rabi oscillation: Ω/2π = ${freqText(fR)}, Δ/2π = ${freqText(fD)}, t = ${timeText(t)}; the system starts in |0⟩.`);
      lines.push({ math: "P_1(t) = Ω^2/(Ω^2 + Δ^2) sin^2((sqrt(Ω^2 + Δ^2) t)/2)", fallback: "P₁(t) = Ω²/(Ω² + Δ²)·sin²(√(Ω² + Δ²)t/2)" });
      lines.push({ math: "H = (hbar/2)(Ω σ_x + Δ σ_z)", fallback: "H = (ħ/2)(Ωσₓ + Δσ_z) (rotating frame)" });
      lines.push(
        `P₁(t) = ${n6(P1, 6)}, P₀ = ${n6(1 - P1, 6)}. Generalised Rabi frequency √(Ω² + Δ²)/2π = ${freqText(W / (2 * Math.PI))}; ` +
          `oscillation period ${timeText(period)}; maximum transfer Ω²/(Ω² + Δ²) = ${n6(amp, 6)}; π-pulse time (Δ = 0) π/Ω = ${timeText(Math.PI / Om)}.`,
      );
      lines.push(
        tableLine("Rabi oscillation", [
          ["Quantity", "Value"],
          ["Rabi frequency Ω/2π", freqText(fR)],
          ["Detuning Δ/2π", freqText(fD)],
          ["Generalised Rabi frequency √(Ω² + Δ²)/2π", freqText(W / (2 * Math.PI))],
          ["Oscillation period", timeText(period)],
          ["Maximum transfer Ω²/(Ω² + Δ²)", n6(amp)],
          [`P₁ at t = ${timeText(t)}`, n6(P1)],
        ]),
      );
      lines.push("Model: rotating-wave approximation, no decay or dephasing; P₁ depends on Δ², so the sign convention of the detuning does not change it.");
      const win = window(period, t);
      const ts = timeScale(win.t1);
      const pts: Array<[number, number]> = Array.from({ length: 801 }, (_, i) => {
        const tt = (win.t1 * i) / 800;
        return [tt * ts.k, rabiP1(Om, De, tt)];
      });
      const svg = curvesSvg({
        series: [{ name: "", pts, color: "#1f5fa8" }],
        xTitle: `Time t (${ts.unit})`,
        yTitle: "Excited-state probability P₁",
        xRange: [0, win.t1 * ts.k],
        yRange: [0, 1],
        hLines: amp < 0.999 ? [{ y: amp, label: "Ω²/(Ω² + Δ²)" }] : [],
        marker: win.beyond ? undefined : { x: t * ts.k, y: P1, label: `t = ${timeText(t, 4)}` },
      });
      const outputs: EngOutput[] = [
        { key: "P1", label: "P₁(t)", value: P1, unit: "" },
        { key: "P0", label: "P₀(t)", value: 1 - P1, unit: "" },
        { key: "rabiGen", label: "√(Ω² + Δ²)/2π", value: W / (2 * Math.PI), unit: "Hz" },
        { key: "period", label: "Period", value: period, unit: "s" },
        { key: "maxP1", label: "Ω²/(Ω² + Δ²)", value: amp, unit: "" },
      ];
      return finish(lines, u.conversions, [plot(svg, `Rabi oscillation P₁(t) from |0⟩${win.beyond ? `; t = ${timeText(t, 4)} is beyond the drawn two periods` : ""}.`, "Excited-state probability against time")], outputs);
    }
    // Spin and Hamiltonian modes share the evolution.
    let H: CMat;
    const lines: EngReportLine[] = [];
    const outputs: EngOutput[] = [];
    const st = readState(r("state") ?? "", "");
    let gyroLine = "";
    if (mode === "spin") {
      const B = u.req("B", "T", "T", "Field B");
      if (u.errors.length) return refuse(u.errors.join("\n"));
      const sp = MAG[(r("spin") as keyof typeof MAG) || "electron"] ?? MAG.electron;
      const wL = larmorOmega(sp.g, sp.mu, B);
      // H = −μ·B = −(g μ B/ħ) S_z = (ħω_L/2) σ_z with ω_L = −gμB/ħ.
      H = [
        [{ re: (HBAR * wL) / 2, im: 0 }, { re: 0, im: 0 }],
        [{ re: 0, im: 0 }, { re: (-HBAR * wL) / 2, im: 0 }],
      ];
      lines.push(`Spin-½ ${sp.name} in B = ${n6(B)} T along +z (${sp.gName} = ${n6(sp.g, 12)}, ${sp.muName} = ${n6(sp.mu, 11)} J/T).`);
      lines.push({ math: "H = -(g μ B)/hbar S_z = (hbar ω_L)/2 σ_z", fallback: "H = −(gμB/ħ)S_z = (ħω_L/2)σ_z" });
      lines.push({ math: "ω_L = -(g μ B)/hbar", fallback: "ω_L = −gμB/ħ" });
      gyroLine =
        `Larmor angular frequency |ω_L| = ${n6(Math.abs(wL))} rad/s, f_L = ${freqText(Math.abs(wL) / (2 * Math.PI))} ` +
        `(${n6(Math.abs(sp.g * sp.mu) / H_PLANCK / 1e6, 10)} MHz/T); precession period ${Math.abs(wL) > 0 ? timeText((2 * Math.PI) / Math.abs(wL)) : "none (B = 0)"}; ` +
        `${wL > 0 ? "anticlockwise" : wL < 0 ? "clockwise" : "no precession"} seen from +z.`;
      outputs.push({ key: "omegaL", label: "|ω_L|", value: Math.abs(wL), unit: "rad/s" }, { key: "fL", label: "f_L", value: Math.abs(wL) / (2 * Math.PI), unit: "Hz" });
    } else {
      if (u.errors.length) return refuse(u.errors.join("\n"));
      const op = readOperator(r("H") ?? "");
      if ("error" in op) return refuse(`Hamiltonian H: ${op.error}`);
      if (op.dim !== 2) return refuse(`Hamiltonian H: this tool evolves a two-level system; the operator is ${op.dim} × ${op.dim}.`);
      const hu = H_UNITS[r("hUnit") || "hMHz"] ?? H_UNITS.hMHz;
      H = op.M.map((row) => row.map((z) => ({ re: z.re * hu.k, im: z.im * hu.k })));
      lines.push(`Hamiltonian (entries in ${hu.short}): H = [[${op.M.map((row) => row.map((z) => cxShort(z)).join(", ")).join("], [")}]].`);
    }
    if ("error" in st) return refuse(`Initial state: ${st.error}`);
    if (st.dim !== 2) return refuse(`Initial state: a two-level state has two amplitudes; this one has ${st.dim}.`);
    if (t < 0) return refuse("The time must be zero or positive.");
    const ev = evolve2(H, st.state, t);
    if (isErr(ev)) return refuse(ev.error);
    const n0 = Math.sqrt(st.state.reduce((s, z) => s + z.re * z.re + z.im * z.im, 0));
    const psi0 = st.state.map((z) => ({ re: z.re / n0, im: z.im / n0 }));
    const s0 = fmtState(psi0, 1);
    const s1 = fmtState(ev.psi, 1);
    lines.push({ math: "ket(ψ(t)) = e^(-i H t/hbar) ket(ψ(0))", fallback: "|ψ(t)⟩ = exp(−iHt/ħ)|ψ(0)⟩" });
    const bm = Math.hypot(...ev.b);
    lines.push({ math: "H = bar(E) I + b·σ", fallback: "H = ĒI + b·σ (the Pauli decomposition)" });
    lines.push({ math: "e^(-i H t/hbar) = e^(-i bar(E) t/hbar)(cos(θ) I - i sin(θ) n·σ)", fallback: "exp(−iHt/ħ) = exp(−iĒt/ħ)(cos θ·I − i sin θ·n̂·σ), n̂ = b/|b|" });
    lines.push({ math: "θ = (abs(b) t)/hbar", fallback: "θ = |b|t/ħ" });
    if (gyroLine) lines.push(gyroLine);
    else {
      const Ep = ev.mean + bm, Em = ev.mean - bm;
      lines.push(
        `Eigenenergies E± = Ē ± |b| = ${eVText(Ep)}, ${eVText(Em)} (splitting ${freqText((2 * bm) / H_PLANCK)} × h); ` +
          `population period πħ/|b| = ${bm > 0 ? timeText((Math.PI * HBAR) / bm) : "none (H ∝ I)"}.`,
      );
      outputs.push({ key: "Eplus", label: "E₊", value: Ep / EV, unit: "eV" }, { key: "Eminus", label: "E₋", value: Em / EV, unit: "eV" });
    }
    const P0 = ev.psi[0].re ** 2 + ev.psi[0].im ** 2;
    const P1 = 1 - P0;
    const [bx, by, bz] = bloch2(ev.psi);
    lines.push(`|ψ(0)⟩ = ${s0.text}${st.notes.length ? ` (${st.notes.join("; ")})` : ""}.`);
    lines.push(`At t = ${timeText(t)}: |ψ(t)⟩ = ${s1.text}${s1.globalPhase ? ` (global phase ${s1.globalPhase.text} factored out)` : ""}, up to the global phase exp(−iĒt/ħ), Ē = (H₀₀ + H₁₁)/2.`);
    lines.push(`P(|0⟩) = ${n6(P0, 6)}, P(|1⟩) = ${n6(P1, 6)}; Bloch vector (⟨σx⟩, ⟨σy⟩, ⟨σz⟩) = (${n6(bx, 5)}, ${n6(by, 5)}, ${n6(bz, 5)}). Closed form and matrix exponential agree to ${fromLog10(Math.log10(Math.max(ev.check, 1e-17)), 2)}.`);
    {
      // The state over one period (precession or population), and at t.
      // πħ/|b| is both the precession period 2π/|ω_L| (|b| = ħ|ω_L|/2) and the population period sin²(|b|t/ħ).
      const per = bm > 0 ? (Math.PI * HBAR) / bm : NaN;
      const times = Number.isFinite(per) ? [0, per / 4, per / 2, (3 * per) / 4, per, t] : [0, t];
      const rows: string[][] = [["t", "P(|0⟩)", "P(|1⟩)", "⟨σx⟩", "⟨σy⟩", "⟨σz⟩"]];
      for (const tt of times) {
        const e2 = evolve2(H, psi0, tt);
        if (isErr(e2)) continue;
        const p0 = e2.psi[0].re ** 2 + e2.psi[0].im ** 2;
        const bl = bloch2(e2.psi);
        rows.push([timeText(tt, 5), n6(p0, 5), n6(1 - p0, 5), ...bl.map((v) => n6(Math.abs(v) < 1e-12 ? 0 : v, 5))]);
      }
      lines.push(tableLine(mode === "spin" ? "Over one precession period, and at t" : "Over one population period, and at t", rows));
    }
    lines.push("Model: a closed two-level system (no decay or dephasing); H is time-independent.");
    outputs.push({ key: "P0", label: "P(|0⟩)", value: P0, unit: "" }, { key: "P1", label: "P(|1⟩)", value: P1, unit: "" }, { key: "blochX", label: "⟨σx⟩", value: bx, unit: "" }, { key: "blochY", label: "⟨σy⟩", value: by, unit: "" }, { key: "blochZ", label: "⟨σz⟩", value: bz, unit: "" });
    // Figure.
    const period = bm > 0 ? (Math.PI * HBAR) / bm : NaN;
    const win = window(period, t);
    const ts = timeScale(win.t1);
    const N = 801;
    const samp: Array<{ tt: number; P1: number; b: [number, number, number] }> = [];
    for (let i = 0; i < N; i++) {
      const tt = (win.t1 * i) / (N - 1);
      const e2 = evolve2(H, psi0, tt);
      if (isErr(e2)) continue;
      samp.push({ tt: tt * ts.k, P1: e2.psi[1].re ** 2 + e2.psi[1].im ** 2, b: bloch2(e2.psi) });
    }
    let svg: string;
    if (mode === "spin") {
      svg = curvesSvg({
        series: [
          { name: "⟨σx⟩", pts: samp.map((s) => [s.tt, s.b[0]]), color: "#1f5fa8" },
          { name: "⟨σy⟩", pts: samp.map((s) => [s.tt, s.b[1]]), color: "#d07a00", dash: "6 4" },
          { name: "⟨σz⟩", pts: samp.map((s) => [s.tt, s.b[2]]), color: "#2e8b57", width: 2.2 },
        ],
        xTitle: `Time t (${ts.unit})`,
        yTitle: "Bloch component",
        xRange: [0, win.t1 * ts.k],
        yRange: [-1, 1],
        marker: win.beyond ? undefined : { x: t * ts.k, y: bx, label: `t = ${timeText(t, 4)}` },
      });
    } else {
      svg = curvesSvg({
        series: [
          { name: "P(|0⟩)", pts: samp.map((s) => [s.tt, 1 - s.P1]), color: "#d07a00", dash: "6 4" },
          { name: "P(|1⟩)", pts: samp.map((s) => [s.tt, s.P1]), color: "#1f5fa8" },
        ],
        xTitle: `Time t (${ts.unit})`,
        yTitle: "Probability",
        xRange: [0, win.t1 * ts.k],
        yRange: [0, 1],
        marker: win.beyond ? undefined : { x: t * ts.k, y: P1, label: `t = ${timeText(t, 4)}` },
      });
    }
    const cap =
      mode === "spin"
        ? `Larmor precession: the Bloch components against time (B along z, so ⟨σz⟩ is constant)${win.beyond ? `; t = ${timeText(t, 4)} is beyond the drawn window` : ""}.`
        : `Populations under exp(−iHt/ħ)${win.beyond ? `; t = ${timeText(t, 4)} is beyond the drawn window` : ""}.`;
    return finish(lines, u.conversions, [plot(svg, cap, "Two-level populations or Bloch components against time")], outputs);
  },
};

/** A complex matrix entry, short (6 s.f.). */
function cxShort(z: { re: number; im: number }): string {
  const re = Math.abs(z.re) < 1e-15 ? 0 : z.re, im = Math.abs(z.im) < 1e-15 ? 0 : z.im;
  if (!im) return n6(re);
  if (!re) return `${n6(im)}i`;
  return `${n6(re)} ${im < 0 ? "−" : "+"} ${n6(Math.abs(im))}i`;
}

export const QUANTUM_MECHANICS_CALCS: QmCalc[] = [boxCalc, oscCalc, hydrogenCalc, tunnelCalc, twoLevelCalc];

/** Exposed for tests: the model used by the hydrogen tool. */
export type { HydrogenModel };
