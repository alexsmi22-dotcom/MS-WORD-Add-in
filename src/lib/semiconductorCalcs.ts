// Pane glue for the Release E semiconductor calculators (gap #9): the abrupt pn junction (Vbi, depletion width, C–V,
// Shockley diode), the MOSFET square law, and equilibrium carrier statistics. Kept OUT of taskpane.ts; the integrator
// spreads SEMICONDUCTOR_CALCS into ENG_CALCS (group "Chips & semiconductors", which already exists).
//
// No number is computed here: semiconductor.ts owns them, with its ONE cited material block. This file reads the
// fields — dimensional ones through units.ts parseMeasured — words the result under the display contract (U+2212,
// ×10ⁿ, no em dash, NaN or Infinity in an ok result), states the nᵢ used and its source in every result, and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, kvTable, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import {
  carriers,
  degeneracyLimit,
  MATERIALS,
  mosfet,
  pnJunction,
  PRESET_T,
  shockley,
  thermalVoltage,
  type MaterialData,
} from "./semiconductor";
import { cvChartSvg, fermiChartSvg, idVdsFamilySvg, ivChartSvg } from "./semiconductorCharts";

type SemiCalc = EngCalcDef<"Chips & semiconductors">;

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (m⁻³, m²/(V·s), Å, °C, mV, fA) and it " +
  "is converted for you, and a unit of the wrong quantity is refused. A density may be typed in e-notation or as 1×10¹⁶.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Six significant figures, trailing zeros kept (a computed value), ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const n6 = (v: number): string => fmtSig(v, 6);
/** Four significant figures for a density. */
const n4 = (v: number): string => fmtSig(v, 4);
/** Six significant figures with trailing zeros dropped: a value as the user typed it. */
const trimSig = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };

/**
 * A number written the way a textbook writes it, "1×10¹⁶" or "1.5 x 10^10", rewritten as 1e16 / 1.5e10 before the
 * unit layer reads it (parseMeasured takes e-notation only). Only the leading number is touched; the rest is the unit.
 */
export function sciInput(raw: string): string {
  return raw.replace(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[×xX*]\s*10\s*(?:\^\s*\(?\s*([+-]?\d+)\s*\)?|([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))/, (_m, mant: string, caret?: string, sup?: string) => {
    const exp = caret ?? [...(sup ?? "")].map((c) => SUP[c]).join("");
    return `${mant}e${exp}`;
  });
}

/**
 * Unit-aware field reading: errors collected, conversions reported (the titrationCalcs.ts / laserCalcs.ts pattern).
 * Adds the ×10ⁿ input form and the femto/atto-ampere prefixes a diode's saturation current is quoted in (the unit
 * layer has no fA).
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    let raw = sciInput((r(key) ?? "").trim().replace(/[−–]/g, "-"));
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const fa = /^(.*?)\s*(fA|aA)$/.exec(raw);
    if (fa && si === "A" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(fa[1])) raw = `${Number(fa[1]) * (fa[2] === "fA" ? 1e-15 : 1e-18)} A`;
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (m.unit.replace(/\s+/g, "") === si) return m.inTarget;
    if (!m.assumed && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${trimSig(m.value)} ${formatUnit(m.unit)} = ${trimSig(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
  };
}
type Reader = ReturnType<typeof unitReader>;

/** A plain number field (no unit): null when blank, NaN when unreadable. */
function plainOpt(v: string | undefined): number | null {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngReportLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : "math" in l ? { math: l.math, fallback: trueMinus(l.fallback) } : l));
  return { ...engReport(clean, extra), outputs };
}

// ---------------------------------------------------------------------------------------------------------------
// The material: a cited preset (300 K) or the user's own values
// ---------------------------------------------------------------------------------------------------------------

const MATERIAL_OPTIONS = [
  { value: "si", label: "Si (300 K presets, cited)" },
  { value: "gaas", label: "GaAs (300 K presets, cited)" },
  { value: "custom", label: "Other: type every material value" },
];

const materialFields = (withEps: boolean) => [
  { key: "mat", label: "Material", default: "si", kind: "select" as const, options: MATERIAL_OPTIONS },
  { key: "T", label: "Temperature T (K; presets are 300 K values)", default: "300 K", kind: "text" as const },
  { key: "ni", label: "Intrinsic density nᵢ (cm⁻³; blank = the preset)", default: "", kind: "text" as const },
  ...(withEps ? [{ key: "eps", label: "Relative permittivity εᵣ (blank = the preset)", default: "", kind: "text" as const }] : []),
  { key: "nc", label: "Conduction-band Nc (cm⁻³; blank = the preset; for the degeneracy check)", default: "", kind: "text" as const },
  { key: "nv", label: "Valence-band Nv (cm⁻³; blank = the preset; for the degeneracy check)", default: "", kind: "text" as const },
];

interface MaterialUse {
  tK: number;
  ni: number;
  niText: string;
  epsR: number;
  epsText: string;
  nc: number | null;
  nv: number | null;
  /** One line naming the material values used and where each came from. */
  line: string;
  preset: MaterialData | null;
}

function readMaterial(r: (k: string) => string, u: Reader, withEps: boolean): MaterialUse | string {
  const id = r("mat");
  const preset = id === "si" || id === "gaas" ? MATERIALS[id] : null;
  if (!preset && id !== "custom") return `Material: "${id}" is not one of the choices.`;
  const tK = u.req("T", "K", "K", "Temperature");
  const niTyped = u.opt("ni", "cm^-3", "cm⁻³", "nᵢ");
  const ncTyped = u.opt("nc", "cm^-3", "cm⁻³", "Nc");
  const nvTyped = u.opt("nv", "cm^-3", "cm⁻³", "Nv");
  if (u.errors.length) return u.errors.join("\n");
  const at300 = Math.abs(tK - PRESET_T) <= 0.5;
  let ni: number, niText: string;
  if (niTyped !== null) {
    ni = niTyped;
    niText = `nᵢ = ${n4(ni)} cm⁻³ (your value)`;
  } else if (!preset) return "nᵢ is required for a material other than the presets.";
  else if (!at300)
    return `The ${preset.label} preset nᵢ is the 300 K value; at T = ${trimSig(tK)} K type nᵢ yourself (it changes by orders of magnitude with temperature, and this tool does not extrapolate it).`;
  else {
    ni = preset.ni;
    niText = `nᵢ = ${n4(ni)} cm⁻³ (${preset.niSource})`;
  }
  let epsR = NaN, epsText = "";
  if (withEps) {
    const e = plainOpt(r("eps"));
    if (e !== null && !Number.isFinite(e)) return `εᵣ: "${(r("eps") ?? "").trim()}" is not a number.`;
    if (e !== null) {
      epsR = e;
      epsText = `εᵣ = ${trimSig(e)} (your value)`;
    } else if (!preset) return "εᵣ is required for a material other than the presets.";
    else {
      epsR = preset.epsR;
      epsText = `εᵣ = ${trimSig(epsR)} (${preset.source}${at300 ? "" : "; its 300 K value"})`;
    }
  }
  const nc = ncTyped ?? (preset && at300 ? preset.nc : null);
  const nv = nvTyped ?? (preset && at300 ? preset.nv : null);
  const parts = [niText];
  if (withEps) parts.push(epsText);
  if (nc !== null || nv !== null) {
    const src = ncTyped !== null || nvTyped !== null ? "" : ` (${preset?.source})`;
    parts.push(`${nc !== null ? `Nc = ${n4(nc)} cm⁻³` : "Nc not given"}, ${nv !== null ? `Nv = ${n4(nv)} cm⁻³` : "Nv not given"}${src}`);
  }
  if (preset) parts.push(`Eg = ${trimSig(preset.eg)} eV (${preset.source})`);
  const line = `Material: ${preset ? preset.label : "your values"} at T = ${trimSig(tK)} K (kT/q = ${n6(thermalVoltage(tK))} V). ${parts.join("; ")}.`;
  return { tK, ni, niText, epsR, epsText, nc, nv, line, preset };
}

const degeneracyNote = (m: MaterialUse): string | null =>
  m.nc === null || m.nv === null
    ? "Degeneracy NOT checked: give Nc and Nv (above about Nc·e⁻³ or Nv·e⁻³ the Fermi level is within 3kT of a band edge and these formulas are only approximate; at Nc or Nv they fail)."
    : null;

// ---------------------------------------------------------------------------------------------------------------
// 1. pn junction
// ---------------------------------------------------------------------------------------------------------------

const pnCalc: SemiCalc = {
  id: "semi-pn-junction",
  name: "pn junction: built-in potential, depletion width, C–V, diode current",
  group: "Chips & semiconductors",
  unitContract: "converts",
  hint:
    "An abrupt (step) pn junction: the acceptor density on the p side and the donor density on the n side give the " +
    "built-in potential Vbi = (kT/q)·ln(NA·ND/nᵢ²), the depletion width (two-sided, plus the one-sided form when one " +
    "side is ten times heavier), its split across the junction, the peak field and the capacitance per area at a " +
    "reverse bias, with the C–V curve. Give a saturation current Iₛ for the Shockley diode current at a bias. Si and " +
    "GaAs presets (nᵢ, εᵣ, Nc, Nv) are cited 300 K values, and each field overrides its preset.",
  fields: [
    { key: "na", label: "Acceptors on the p side NA (cm⁻³)", default: "1e16", kind: "text" },
    { key: "nd", label: "Donors on the n side ND (cm⁻³)", default: "1e17", kind: "text" },
    ...materialFields(true),
    { key: "vr", label: "Reverse bias VR (V; 0 for equilibrium)", default: "0 V", kind: "text" },
    { key: "is", label: "Saturation current Iₛ (A; blank for no diode current)", default: "1e-14 A", kind: "text" },
    { key: "nid", label: "Ideality factor n (1–2)", default: "1", kind: "text" },
    { key: "vd", label: "Diode bias V for the current (V; forward positive)", default: "0.6 V", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const na = u.req("na", "cm^-3", "cm⁻³", "NA");
    const nd = u.req("nd", "cm^-3", "cm⁻³", "ND");
    const vr = u.req("vr", "V", "V", "Reverse bias");
    const is = u.opt("is", "A", "A", "Saturation current");
    const vd = u.opt("vd", "V", "V", "Diode bias");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const mat = readMaterial(r, u, true);
    if (typeof mat === "string") return refuse(mat);
    const res = pnJunction({ na, nd, ni: mat.ni, epsR: mat.epsR, tK: mat.tK, vr, nc: mat.nc, nv: mat.nv });
    if (!res.ok) return refuse(res.error);
    let diode: { v: number; i: number; perDecade: number; n: number; is: number } | null = null;
    if (is !== null) {
      const nId = plainOpt(r("nid")) ?? 1;
      if (!Number.isFinite(nId)) return refuse(`Ideality factor: "${(r("nid") ?? "").trim()}" is not a number.`);
      if (vd === null) return refuse("Diode bias: give the bias at which to evaluate the current (or clear Iₛ).");
      const d = shockley(is, nId, vd, mat.tK);
      if (!d.ok) return refuse(d.error);
      diode = { v: vd, i: d.current, perDecade: d.perDecade, n: nId, is };
    }
    const um = (m: number): string => `${n6(m * 1e6)} µm`;
    const lines: EngReportLine[] = [];
    lines.push(mat.line);
    lines.push(`Doping: NA = ${n4(na)} cm⁻³ (p side), ND = ${n4(nd)} cm⁻³ (n side); reverse bias VR = ${trimSig(vr)} V.`);
    lines.push({ math: "V_bi = (k T)/q ln((N_A N_D)/(n_i^2))", fallback: "Vbi = (kT/q)·ln(NA·ND/nᵢ²)" });
    lines.push({ math: "W = sqrt((2 ε_s (V_bi + V_R))/q (1/N_A + 1/N_D))", fallback: "W = √(2εₛ(Vbi + VR)/q · (1/NA + 1/ND))" });
    lines.push({ math: "x_n = (W N_A)/(N_A + N_D)", fallback: "xₙ = W·NA/(NA + ND)" });
    lines.push({ math: "x_p = (W N_D)/(N_A + N_D)", fallback: "xₚ = W·ND/(NA + ND)" });
    lines.push({ math: "E_max = (q N_D x_n)/ε_s", fallback: "Eₘₐₓ = q·ND·xₙ/εₛ" });
    lines.push({ math: "C_j = ε_s/W", fallback: "C′ⱼ = εₛ/W (per unit area)" });
    if (diode) lines.push({ math: "I = I_s (e^{V/(n V_t)} - 1)", fallback: "I = Iₛ(exp(V/(nVₜ)) − 1), Vₜ = kT/q" });
    lines.push(`Built-in potential Vbi = ${n6(res.vbi)} V.`);
    lines.push(`Depletion width W = ${um(res.w)} (n side xₙ = ${um(res.xn)}, p side xₚ = ${um(res.xp)}); peak field ${n6(res.emax / 1e5)} kV/cm.`);
    if (res.w1 !== null)
      lines.push(`One-sided (${res.lightSide === "n" ? "p⁺n" : "n⁺p"}) approximation W ≈ √(2εₛ(Vbi + VR)/(q·Nₗ)) = ${um(res.w1)} (Nₗ the lighter doping), ${n6(Math.abs(res.w1 / res.w - 1) * 100)} % from the two-sided value.`);
    else lines.push("The dopings are within a factor of 10 of each other, so the one-sided approximation is not used: the depletion region spreads into both sides.");
    lines.push(`Junction capacitance per area C′ = ${n6(res.cj)} F/m² (${n6(res.cj * 1e5)} nF/cm²) at VR = ${trimSig(vr)} V; at zero bias ${n6(res.cj0 * 1e5)} nF/cm².`);
    if (diode)
      lines.push(
        `Diode current at V = ${trimSig(diode.v)} V: I = ${n6(diode.i)} A (Iₛ = ${trimSig(diode.is)} A, n = ${trimSig(diode.n)}; ${n6(diode.perDecade * 1000)} mV per decade forward). Iₛ is your input; it is not derived from the doping.`,
      );
    lines.push(...res.cautions);
    const deg = degeneracyNote(mat);
    if (deg) lines.push(deg);
    lines.push(
      "Model: abrupt junction, depletion approximation, complete ionisation, non-degenerate doping; W uses Vbi + VR without the 2kT/q majority-carrier-tail correction; reverse breakdown is not modelled. The diode is ideal (no series resistance, high injection or generation current).",
    );
    const rows: Array<[string, string, string]> = [
      ["Built-in potential Vbi", n6(res.vbi), "V"],
      ["Depletion width W", n6(res.w * 1e6), "µm"],
      ["n-side width xₙ", n6(res.xn * 1e6), "µm"],
      ["p-side width xₚ", n6(res.xp * 1e6), "µm"],
      ["Peak field Eₘₐₓ", n6(res.emax / 1e5), "kV/cm"],
      ["Capacitance per area C′", n6(res.cj * 1e5), "nF/cm²"],
    ];
    if (res.w1 !== null) rows.splice(2, 0, ["One-sided W", n6(res.w1 * 1e6), "µm"]);
    if (diode) rows.push(["Diode current I", n6(diode.i), "A"]);
    const outputs: EngOutput[] = [
      { key: "vbi", label: "Built-in potential", value: res.vbi, unit: "V" },
      { key: "w", label: "Depletion width", value: res.w * 1e6, unit: "µm" },
      { key: "xn", label: "n-side depletion width", value: res.xn * 1e6, unit: "µm" },
      { key: "xp", label: "p-side depletion width", value: res.xp * 1e6, unit: "µm" },
      { key: "emax", label: "Peak field", value: res.emax / 1e5, unit: "kV/cm" },
      { key: "cj", label: "Junction capacitance per area", value: res.cj, unit: "F/m²" },
      { key: "cj0", label: "Zero-bias capacitance per area", value: res.cj0, unit: "F/m²" },
    ];
    if (res.w1 !== null) outputs.push({ key: "w1", label: "One-sided depletion width", value: res.w1 * 1e6, unit: "µm" });
    if (diode) outputs.push({ key: "i", label: "Diode current", value: diode.i, unit: "A" });
    lines.push(kvTable(rows, "pn junction"));
    const extra: AnalyzeBlock[] = [
      plot(cvChartSvg({ na, nd, epsR: mat.epsR }, res.vbi, vr), "Junction capacitance against reverse bias", "Capacitance per unit area of the abrupt junction falling with reverse bias, the operating bias marked"),
    ];
    if (diode)
      extra.push(
        plot(ivChartSvg(diode.is, diode.n, res.vt, diode.v), "Forward diode current (Shockley)", "Forward current of the ideal diode on a logarithmic current axis against bias, a straight line above a few kT/q, the operating point marked"),
      );
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. MOSFET square law
// ---------------------------------------------------------------------------------------------------------------

const mosCalc: SemiCalc = {
  id: "semi-mosfet-square-law",
  name: "MOSFET square law: Cox, drain current, gm, output conductance",
  group: "Chips & semiconductors",
  unitContract: "converts",
  hint:
    "A long-channel MOSFET: the channel mobility, the oxide thickness and its permittivity give Cox = εₒₓ/tₒₓ; with " +
    "W/L, the threshold and the bias, the region (cutoff, triode, saturation), the drain current, gm and the output " +
    "conductance (channel-length modulation λ), drawn as the ID–VDS family. nMOS signs; enter a pMOS by magnitudes.",
  fields: [
    { key: "mu", label: "Channel mobility µ (cm²/(V·s); your value)", default: "400", kind: "text" },
    { key: "tox", label: "Oxide thickness tₒₓ (nm)", default: "10 nm", kind: "text" },
    { key: "epsox", label: "Oxide relative permittivity εᵣ,ₒₓ (your value; SiO₂ is quoted 3.7–3.9)", default: "3.9", kind: "text" },
    { key: "wl", label: "Aspect ratio W/L", default: "10", kind: "text" },
    { key: "vth", label: "Threshold voltage Vₜₕ (V)", default: "0.5 V", kind: "text" },
    { key: "vgs", label: "Gate–source voltage VGS (V)", default: "1.5 V", kind: "text" },
    { key: "vds", label: "Drain–source voltage VDS (V)", default: "1.5 V", kind: "text" },
    { key: "lambda", label: "Channel-length modulation λ (1/V; 0 for none)", default: "0", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const mu = u.req("mu", "cm^2/(V*s)", "cm²/(V·s)", "Mobility");
    const tox = u.req("tox", "nm", "nm", "Oxide thickness");
    const vth = u.req("vth", "V", "V", "Threshold voltage");
    const vgs = u.req("vgs", "V", "V", "VGS");
    const vds = u.req("vds", "V", "V", "VDS");
    const lam = u.req("lambda", "1/V", "V⁻¹", "λ");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const epsOx = plainOpt(r("epsox"));
    if (epsOx === null) return refuse("Oxide relative permittivity: this field is required (it is your process's value).");
    if (!Number.isFinite(epsOx)) return refuse(`Oxide relative permittivity: "${(r("epsox") ?? "").trim()}" is not a number.`);
    const wl = plainOpt(r("wl"));
    if (wl === null || !Number.isFinite(wl)) return refuse(`W/L: "${(r("wl") ?? "").trim()}" is not a number.`);
    const res = mosfet({ mu, tox: tox * 1e-9, epsOx, wl, vth, vgs, vds, lambda: lam });
    if (!res.ok) return refuse(res.error);
    const lines: EngReportLine[] = [];
    lines.push(`Device: µ = ${trimSig(mu)} cm²/(V·s), tₒₓ = ${trimSig(tox)} nm, εᵣ,ₒₓ = ${trimSig(epsOx)} (your values), W/L = ${trimSig(wl)}, Vₜₕ = ${trimSig(vth)} V; bias VGS = ${trimSig(vgs)} V, VDS = ${trimSig(vds)} V, λ = ${trimSig(lam)} V⁻¹.`);
    lines.push({ math: "C_ox = ε_ox/t_ox", fallback: "Cₒₓ = εₒₓ/tₒₓ, with εₒₓ = εᵣ,ₒₓ·ε₀" });
    lines.push({ math: "I_D = (μ C_ox W)/(2 L) V_ov^2 (1 + λ V_DS)", fallback: "ID = ½µCₒₓ(W/L)Vₒᵥ²(1 + λVDS) in saturation (VDS ≥ Vₒᵥ)" });
    lines.push({ math: "I_D = (μ C_ox W)/L (V_ov V_DS - (V_DS^2)/2)(1 + λ V_DS)", fallback: "ID = µCₒₓ(W/L)(Vₒᵥ·VDS − ½VDS²)(1 + λVDS) in triode (VDS < Vₒᵥ)" });
    lines.push({ math: "g_m = (∂I_D)/(∂V_GS)", fallback: "gₘ = ∂ID/∂VGS" });
    lines.push({ math: "g_ds = (∂I_D)/(∂V_DS)", fallback: "gds = ∂ID/∂VDS" });
    lines.push(`Oxide capacitance Cₒₓ = ${n6(res.cox)} F/m² (${n6(res.cox * 1000)} fF/µm²); µCₒₓ·W/L = ${n6(res.beta * 1000)} mA/V².`);
    const outputs: EngOutput[] = [
      { key: "cox", label: "Oxide capacitance", value: res.cox, unit: "F/m²" },
      { key: "beta", label: "µCox·W/L", value: res.beta * 1000, unit: "mA/V²" },
      { key: "vov", label: "Overdrive voltage", value: res.vov, unit: "V" },
      { key: "id", label: "Drain current", value: res.id * 1000, unit: "mA" },
      { key: "gm", label: "Transconductance", value: res.gm * 1000, unit: "mS" },
      { key: "gds", label: "Output conductance", value: res.gds * 1e6, unit: "µS" },
    ];
    const rows: Array<[string, string, string]> = [
      ["Oxide capacitance Cₒₓ", n6(res.cox), "F/m²"],
      ["Overdrive Vₒᵥ = VGS − Vₜₕ", n6(res.vov), "V"],
      ["Region", res.region, ""],
      ["Drain current ID", n6(res.id * 1000), "mA"],
      ["Transconductance gₘ", n6(res.gm * 1000), "mS"],
      ["Output conductance gds", n6(res.gds * 1e6), "µS"],
    ];
    if (res.region === "cutoff") {
      lines.push(`Overdrive Vₒᵥ = ${n6(res.vov)} V ≤ 0: CUTOFF. The square law gives ID = 0, gm = 0 (subthreshold conduction is not modelled).`);
    } else {
      lines.push(`Overdrive Vₒᵥ = ${n6(res.vov)} V; VDS,sat = Vₒᵥ = ${n6(res.vdsat)} V, so the device is in ${res.region.toUpperCase()}${res.region === "saturation" ? " (VDS ≥ Vₒᵥ)" : " (VDS < Vₒᵥ)"}.`);
      lines.push(`Drain current ID = ${n6(res.id * 1000)} mA; transconductance gm = ${n6(res.gm * 1000)} mS${res.region === "saturation" ? ` (= 2ID/Vₒᵥ)` : ""}; output conductance gds = ${n6(res.gds * 1e6)} µS.`);
      if (res.gds > 0) {
        const ro = 1 / res.gds;
        lines.push(`Output resistance rₒ = 1/gds = ${n6(ro / 1000)} kΩ; intrinsic gain gm·rₒ = ${n6(res.gm * ro)}.`);
        outputs.push({ key: "ro", label: "Output resistance", value: ro / 1000, unit: "kΩ" }, { key: "gain", label: "Intrinsic gain", value: res.gm * ro, unit: "" });
        rows.push(["Output resistance rₒ", n6(ro / 1000), "kΩ"]);
      } else lines.push("λ = 0 in saturation: the output conductance is zero and rₒ is unbounded (an ideal current source).");
    }
    lines.push(
      "Model: long-channel square law in the SPICE level-1 form (the (1 + λVDS) factor in both regions keeps ID continuous). Not included: subthreshold conduction, velocity saturation and mobility degradation (both matter below about 0.25 µm), body effect. µ is the effective channel mobility, your input.",
    );
    lines.push(kvTable(rows, "MOSFET operating point"));
    return finish(lines, u.conversions, [
      plot(idVdsFamilySvg(res.beta, vth, vgs, vds, lam), "Output characteristics (ID against VDS)", "Drain current against drain-source voltage for four gate voltages, rising through the triode region to the grey saturation-edge parabola and then flat (or sloped by lambda), the operating point marked"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Carrier statistics
// ---------------------------------------------------------------------------------------------------------------

const carrierCalc: SemiCalc = {
  id: "semi-carriers",
  name: "Carrier statistics: n, p, Fermi level, conductivity",
  group: "Chips & semiconductors",
  unitContract: "converts",
  hint:
    "Donor and acceptor densities (either may be 0; compensation is handled) and nᵢ give the equilibrium electron and " +
    "hole densities (complete ionisation, np = nᵢ²), the Fermi level relative to the intrinsic level, and — with your " +
    "electron and hole mobilities — the conductivity and resistivity. Mobilities depend on doping and temperature and " +
    "are your inputs (tables are not built in).",
  fields: [
    { key: "nd", label: "Donors ND (cm⁻³)", default: "1e16", kind: "text" },
    { key: "na", label: "Acceptors NA (cm⁻³)", default: "0", kind: "text" },
    ...materialFields(false),
    // The defaults are the pure-Si lattice limits the Ioffe NSM archive lists (Si/electric.html, "Mobility electrons
    // ≤1400, holes ≤450 cm² V⁻¹ s⁻¹", read 2026-10-23); doped silicon and other materials are lower or different, so
    // the field says it is the user's value and the result calls it that.
    { key: "mun", label: "Electron mobility µₙ (cm²/(V·s); your value; 1400 is the pure-Si limit)", default: "1400", kind: "text" },
    { key: "mup", label: "Hole mobility µₚ (cm²/(V·s); your value; 450 is the pure-Si limit)", default: "450", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const nd = u.req("nd", "cm^-3", "cm⁻³", "ND");
    const na = u.req("na", "cm^-3", "cm⁻³", "NA");
    const mun = u.req("mun", "cm^2/(V*s)", "cm²/(V·s)", "Electron mobility");
    const mup = u.req("mup", "cm^2/(V*s)", "cm²/(V·s)", "Hole mobility");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const mat = readMaterial(r, u, false);
    if (typeof mat === "string") return refuse(mat);
    const res = carriers({ nd, na, ni: mat.ni, tK: mat.tK, mun, mup, nc: mat.nc, nv: mat.nv });
    if (!res.ok) return refuse(res.error);
    const lines: EngReportLine[] = [];
    lines.push(mat.line);
    lines.push(`Doping: ND = ${n4(nd)} cm⁻³, NA = ${n4(na)} cm⁻³ (net ND − NA = ${n4(res.net)} cm⁻³); mobilities µₙ = ${trimSig(mun)}, µₚ = ${trimSig(mup)} cm²/(V·s) (your values).`);
    lines.push({ math: "n = (N_D - N_A)/2 + sqrt(((N_D - N_A)/2)^2 + n_i^2)", fallback: "n = (ND − NA)/2 + √(((ND − NA)/2)² + nᵢ²) (n-type; the mirror form gives p for p-type)" });
    lines.push({ math: "p = (n_i^2)/n", fallback: "p = nᵢ²/n (the minority carrier from the mass-action law)" });
    lines.push({ math: "E_F - E_i = k T ln(n/n_i)", fallback: "EF − Eᵢ = kT·ln(n/nᵢ)" });
    lines.push({ math: "σ = q (n μ_n + p μ_p)", fallback: "σ = q(nµₙ + pµₚ)" });
    lines.push({ math: "ρ = 1/σ", fallback: "ρ = 1/σ" });
    const kind = res.type === "intrinsic" ? "intrinsic (net doping zero)" : `${res.type}-type`;
    lines.push(`The sample is ${kind}: n = ${n4(res.n)} cm⁻³, p = ${n4(res.p)} cm⁻³.`);
    lines.push(`Fermi level EF − Eᵢ = ${n6(res.efEi)} eV (${res.efEi > 0 ? "above" : res.efEi < 0 ? "below" : "at"} the intrinsic level; from nᵢ).`);
    if (res.edge !== null)
      lines.push(
        `${res.type === "n" ? `Ec − EF = kT·ln(Nc/n) = ${n6(res.edge)} eV` : `EF − Ev = kT·ln(Nv/p) = ${n6(res.edge)} eV`}; from ${res.type === "n" ? "Nc" : "Nv"}, a different data set from nᵢ (the presets are not exactly self-consistent, so the two band-referenced positions are not forced to match Eg).`,
      );
    lines.push(`Conductivity σ = ${n6(res.sigma)} S/cm (${n6(res.sigma * 100)} S/m); resistivity ρ = ${n6(res.rho)} Ω·cm.`);
    const deg = degeneracyNote(mat);
    if (deg) lines.push(deg);
    else if (!res.cautions.length) lines.push(`Non-degenerate range checked: n ≤ Nc·e⁻³ = ${n4(degeneracyLimit(mat.nc as number))} and p ≤ Nv·e⁻³ = ${n4(degeneracyLimit(mat.nv as number))} cm⁻³ (EF at least 3kT from both band edges).`);
    lines.push(...res.cautions);
    lines.push("Model: thermal equilibrium, complete ionisation of every dopant (fails at low temperature, freeze-out), Boltzmann statistics (non-degenerate), uniform doping.");
    const rows: Array<[string, string, string]> = [
      ["Electron density n", n4(res.n), "cm⁻³"],
      ["Hole density p", n4(res.p), "cm⁻³"],
      ["EF − Eᵢ", n6(res.efEi), "eV"],
    ];
    if (res.edge !== null) rows.push([res.type === "n" ? "Ec − EF" : "EF − Ev", n6(res.edge), "eV"]);
    rows.push(["Conductivity σ", n6(res.sigma), "S/cm"], ["Resistivity ρ", n6(res.rho), "Ω·cm"]);
    lines.push(kvTable(rows, "Carrier statistics"));
    const outputs: EngOutput[] = [
      { key: "n", label: "Electron density", value: res.n, unit: "cm⁻³" },
      { key: "p", label: "Hole density", value: res.p, unit: "cm⁻³" },
      { key: "efEi", label: "Fermi level above intrinsic", value: res.efEi, unit: "eV" },
      { key: "sigma", label: "Conductivity", value: res.sigma, unit: "S/cm" },
      { key: "rho", label: "Resistivity", value: res.rho, unit: "Ω·cm" },
    ];
    if (res.edge !== null) outputs.push({ key: "edge", label: res.type === "n" ? "Conduction band edge above EF" : "EF above valence band edge", value: res.edge, unit: "eV" });
    return finish(lines, u.conversions, [
      plot(fermiChartSvg(mat.ni, res.vt, res.net, mat.nc, mat.nv), "Fermi level against doping", "Fermi level relative to the intrinsic level against net dopant density on a logarithmic axis, rising for donors and falling for acceptors, the sample marked"),
    ], outputs);
  },
};

export const SEMICONDUCTOR_CALCS: SemiCalc[] = [pnCalc, mosCalc, carrierCalc];
