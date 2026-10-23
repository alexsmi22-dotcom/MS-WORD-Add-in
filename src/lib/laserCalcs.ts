// Pane glue for the Release E laser calculators (gap #5): Fabry–Pérot cavity, laser threshold and slope efficiency,
// coherence from a linewidth (with the Schawlow–Townes limit), and second-harmonic phase matching / QPM. Kept OUT of
// taskpane.ts; the integrator spreads LASER_CALCS into ENG_CALCS (group "Optics & photonics", which already exists).
//
// No number is computed here: laserPhysics.ts owns them (with optics.ts's c and h). This file reads the fields —
// dimensional ones through units.ts parseMeasured — words the result under the display contract (U+2212, ×10ⁿ, no em
// dash, NaN or Infinity in an ok result) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { C_LIGHT } from "./optics";
import { refuseNonFinite } from "./finiteResult";
import {
  coherence,
  fabryPerot,
  laserThreshold,
  linewidthFromWavelength,
  schawlowTownes,
  shg,
  SINC2_HALF_X,
  type LineShape,
  type PhaseMatching,
} from "./laserPhysics";
import { coherenceChartSvg, fpAiryChartSvg, fpPeakChartSvg, shgGrowthChartSvg, shgSincChartSvg, thresholdChartSvg, withPrefix } from "./laserCharts";

type OptCalc = EngCalcDef<"Optics & photonics">;

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (25 cm, 1.064 µm, 500 mW, 5 cm⁻¹, 2 GHz) " +
  "and it is converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Six significant figures, trailing zeros kept (a computed value), ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const n6 = (v: number): string => fmtSig(v, 6);
/** Six significant figures with trailing zeros dropped: a value as the user typed it. */
const trimSig = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
/** A computed value with its SI prefix, six significant figures: "1.49896 GHz". */
const pre = (v: number, unit: string): string => withPrefix(v, unit, 6);

/**
 * Unit-aware field reading: errors collected, conversions reported (the titrationCalcs.ts / randomVibrationCalcs.ts
 * pattern). A spaced reciprocal ("0.5 /m", as a datasheet writes a loss) is read as 1/m: units.ts documents that form
 * but its number pattern swallows the space, so it is rewritten to "0.5 1/m" here before the unit layer reads it.
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    let raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    raw = raw.replace(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s+\/\s*(?=[A-Za-zµ])/, "$1 1/");
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (m.unit.replace(/\s+/g, "") === si) return m.value;
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
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

/** A plain number field (no unit): NaN when blank or unreadable. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  return t !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}

/**
 * A fraction field (reflectivity, efficiency): "0.99" or "99 %". A bare number above 1 is refused by name rather than
 * read as a percentage — 99 could be a typo for 0.99 or for 99 %, and the two are not the same cavity.
 */
function fraction(v: string | undefined, label: string): number | string {
  const t = (v ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return `${label}: this field is required.`;
  const pc = /^(.*?)\s*%$/.exec(t);
  const x = plain(pc ? pc[1] : t);
  if (!Number.isFinite(x)) return `${label}: "${t}" is not a number (write 0.99, or 99 %).`;
  if (!pc && x > 1) return `${label}: ${trimSig(x)} is above 1. A reflectivity or efficiency is a fraction from 0 to 1: write ${trimSig(x / 100)} or ${trimSig(x)} % if a percentage was meant.`;
  return pc ? x / 100 : x;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};

const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((row) => row.map((c) => trueMinus(c))) });

function finish(lines: EngLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return refuseNonFinite({ ...engReport(clean, extra), outputs });
}

const pct = (x: number, s = 4): string => `${fmtSig(x * 100, s)} %`;

// ---------------------------------------------------------------------------------------------------------------
// 1. Fabry–Pérot cavity
// ---------------------------------------------------------------------------------------------------------------

const fpCalc: OptCalc = {
  id: "laser-fabry-perot",
  name: "Fabry–Pérot cavity: FSR, finesse, linewidth, photon lifetime, Q",
  group: "Optics & photonics",
  unitContract: "converts",
  hint:
    "Two plane mirrors (an etalon, or a laser cavity's longitudinal modes): the spacing, the index between them and the two " +
    "power reflectivities. Gives the free spectral range c/(2nL), the finesse π√R/(1 − R) with R = √(R₁R₂), the " +
    "transmission linewidth FSR/F, the photon lifetime, Q at the wavelength, and the Airy transmission against frequency. " +
    "Mirrors are lossless; for a cavity with a gain medium use Laser threshold & slope efficiency.",
  fields: [
    { key: "L", label: "Mirror spacing L (m)", default: "0.1 m", kind: "text" },
    { key: "n", label: "Refractive (group) index n between the mirrors", default: "1", kind: "text" },
    { key: "R1", label: "Mirror 1 reflectivity R₁ (fraction, or %)", default: "0.99", kind: "text" },
    { key: "R2", label: "Mirror 2 reflectivity R₂ (fraction, or %)", default: "0.99", kind: "text" },
    { key: "lam", label: "Wavelength λ (nm; for ν and Q, blank for none)", default: "1064 nm", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const L = u.req("L", "m", "m", "Mirror spacing");
    const lamNm = u.opt("lam", "nm", "nm", "Wavelength");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const n = plain(r("n"));
    if (!Number.isFinite(n)) return refuse(`Refractive index: "${(r("n") ?? "").trim()}" is not a number.`);
    const R1 = fraction(r("R1"), "R₁");
    if (typeof R1 === "string") return refuse(R1);
    const R2 = fraction(r("R2"), "R₂");
    if (typeof R2 === "string") return refuse(R2);
    const res = fabryPerot({ L, n, R1, R2, lambda: lamNm === null ? null : lamNm * 1e-9 });
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    lines.push(`Cavity: L = ${trimSig(L)} m, n = ${trimSig(n)}, R₁ = ${trimSig(R1)}, R₂ = ${trimSig(R2)} (R = √(R₁R₂) = ${trimSig(res.R)}).`);
    lines.push({ math: "Δν_FSR = c/(2 n L)", fallback: "Δν(FSR) = c/(2nL)" });
    lines.push({ math: "F = (π sqrt(R))/(1 - R)", fallback: "F = π√R/(1 − R)" });
    lines.push({ math: "R = sqrt(R_1 R_2)", fallback: "R = √(R₁R₂)" });
    lines.push({ math: "Δν = Δν_FSR/F", fallback: "Δν = Δν(FSR)/F (FWHM of each transmission peak)" });
    lines.push({ math: "1/τ_p = (-ln(R_1 R_2))/t_RT", fallback: "1/τₚ = −ln(R₁R₂)/t(RT), with t(RT) = 1/Δν(FSR) the round-trip time" });
    lines.push({ math: "T = ((1 - R_1)(1 - R_2))/((1 - sqrt(R_1 R_2))^2 + 4 sqrt(R_1 R_2) sin^2 φ)", fallback: "T = (1 − R₁)(1 − R₂)/((1 − √(R₁R₂))² + 4√(R₁R₂)·sin²φ) (Airy transmission)" });
    lines.push({ math: "φ = (π ν)/Δν_FSR", fallback: "φ = πν/Δν(FSR), ν measured from a resonance" });
    lines.push(`Free spectral range ${pre(res.fsr, "Hz")}; round trip ${pre(res.tRT, "s")}.`);
    lines.push(`Finesse ${n6(res.finesse)}; transmission linewidth (FWHM) ${pre(res.linewidth, "Hz")}.`);
    if (res.finesseExact !== null) {
      const d = res.finesse / res.finesseExact - 1;
      lines.push(`Exact Airy finesse ${n6(res.finesseExact)}${Math.abs(d) > 0.01 ? `: the π√R/(1 − R) form is ${pct(Math.abs(d), 2)} ${d > 0 ? "high" : "low"} at this reflectivity, so use the exact value and the exact FWHM FSR/F(Airy) = ${pre(res.fsr / res.finesseExact, "Hz")} (the width drawn in the resonance figure)` :" (the π√R/(1 − R) form agrees to better than 1 %)"}.`);
    } else lines.push("R₁R₂ is at or below 0.0294: the Airy peaks overlap so much that they have no half maximum. The finesse and linewidth above are the low-reflectivity extrapolation of π√R/(1 − R) and do not describe a resolvable peak.");
    lines.push(`Photon lifetime τₚ = ${pre(res.tauC, "s")} (mirror loss only; the decaying mode's Lorentzian linewidth 1/(2πτₚ) = ${pre(res.dnuC, "Hz")}, Lorentzian finesse ${n6(res.finesseLorentz)}).`);
    if (res.Q !== null && res.nu !== null) lines.push(`At λ = ${trimSig((lamNm as number))} nm (ν = ${pre(res.nu, "Hz")}): Q = ν/Δν = ${n6(res.Q)}.`);
    lines.push(`Peak transmission ${n6(res.peakT)}${res.peakT < 0.999999 ? " (unequal mirrors: a lossless etalon transmits fully only when R₁ = R₂)" : ""}.`);
    lines.push("Model: plane-parallel lossless mirrors and a plane wave at normal incidence; n is the group index when the medium is dispersive (it sets the FSR). The photon lifetime counts mirror loss only.");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Free spectral range", pre(res.fsr, "Hz")],
      ["Finesse F = π√R/(1 − R)", n6(res.finesse)],
      ["Exact Airy finesse", res.finesseExact === null ? "no half maximum" : n6(res.finesseExact)],
      ["Linewidth (FWHM) FSR/F", pre(res.linewidth, "Hz")],
      ["Photon lifetime τₚ", pre(res.tauC, "s")],
      ["Q = ν/Δν", res.Q === null ? "(give λ)" : n6(res.Q)],
      ["Peak transmission", n6(res.peakT)],
    ];
    const outputs: EngOutput[] = [
      { key: "fsr", label: "Free spectral range", value: res.fsr, unit: "Hz" },
      { key: "finesse", label: "Finesse", value: res.finesse, unit: "" },
      { key: "linewidth", label: "Linewidth (FWHM)", value: res.linewidth, unit: "Hz" },
      { key: "tauC", label: "Photon lifetime", value: res.tauC, unit: "s" },
      { key: "peakT", label: "Peak transmission", value: res.peakT, unit: "" },
    ];
    if (res.finesseExact !== null) outputs.push({ key: "finesseExact", label: "Exact Airy finesse", value: res.finesseExact, unit: "" });
    if (res.Q !== null) outputs.push({ key: "Q", label: "Q factor", value: res.Q, unit: "" });
    return finish(lines, u.conversions, [
      table("Fabry–Pérot cavity", rows),
      plot(fpAiryChartSvg(R1, R2, res), "Airy transmission over three orders", "Transmission against detuning from a resonance on a logarithmic axis, peaks one free spectral range apart"),
      plot(fpPeakChartSvg(R1, R2, res), "One resonance and its FWHM", "Transmission against detuning across one resonance on linear axes, the half-maximum width marked"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Laser threshold and slope efficiency
// ---------------------------------------------------------------------------------------------------------------

const thresholdCalc: OptCalc = {
  id: "laser-threshold",
  name: "Laser threshold, slope efficiency & output power",
  group: "Optics & photonics",
  unitContract: "converts",
  hint:
    "A laser cavity filled by its gain medium: the length, the internal loss αᵢ and the two mirror reflectivities give the " +
    "mirror loss αₘ and the threshold gain gₜₕ = αᵢ + αₘ. With the pump and laser wavelengths and the internal " +
    "efficiency ηᵢ, the slope efficiency ηₛ = ηᵢ·αₘ/(αₘ + αᵢ)·λₚ/λ (the quantum-defect form); with a threshold " +
    "pump power (measured or quoted), the output P = ηₛ(Pₚ − Pₜₕ) above threshold.",
  fields: [
    { key: "L", label: "Cavity (gain medium) length L (m)", default: "0.1 m", kind: "text" },
    { key: "ai", label: "Internal loss αᵢ (1/m; cm⁻¹ converts)", default: "0.5 1/m", kind: "text" },
    { key: "R1", label: "Mirror 1 reflectivity R₁ (fraction, or %)", default: "0.99", kind: "text" },
    { key: "R2", label: "Mirror 2 (output coupler) reflectivity R₂", default: "0.95", kind: "text" },
    { key: "lp", label: "Pump wavelength λₚ (nm)", default: "808 nm", kind: "text" },
    { key: "lam", label: "Laser wavelength λ (nm)", default: "1064 nm", kind: "text" },
    { key: "etai", label: "Internal efficiency ηᵢ (fraction, or %)", default: "1", kind: "text" },
    { key: "n", label: "Refractive index n (for the photon lifetime)", default: "1", kind: "text" },
    { key: "pth", label: "Threshold pump power Pₜₕ (W; measured or quoted)", default: "2 W", kind: "text" },
    { key: "pp", label: "Pump power Pₚ (W; blank for none)", default: "10 W", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const L = u.req("L", "m", "m", "Cavity length");
    const ai = u.req("ai", "1/m", "m⁻¹", "Internal loss");
    const lp = u.req("lp", "nm", "nm", "Pump wavelength");
    const lam = u.req("lam", "nm", "nm", "Laser wavelength");
    const Pth = u.req("pth", "W", "W", "Threshold pump power");
    const Pp = u.opt("pp", "W", "W", "Pump power");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const R1 = fraction(r("R1"), "R₁");
    if (typeof R1 === "string") return refuse(R1);
    const R2 = fraction(r("R2"), "R₂");
    if (typeof R2 === "string") return refuse(R2);
    const etaI = fraction(r("etai"), "Internal efficiency ηᵢ");
    if (typeof etaI === "string") return refuse(etaI);
    const n = plain(r("n"));
    if (!Number.isFinite(n)) return refuse(`Refractive index: "${(r("n") ?? "").trim()}" is not a number.`);
    const res = laserThreshold({ L, alphaI: ai, R1, R2, lambdaP: lp * 1e-9, lambda: lam * 1e-9, etaI, n, Pth, Pp });
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    lines.push(`Cavity L = ${trimSig(L)} m, αᵢ = ${trimSig(ai)} m⁻¹, R₁ = ${trimSig(R1)}, R₂ = ${trimSig(R2)}; pump ${trimSig(lp)} nm, laser ${trimSig(lam)} nm, ηᵢ = ${trimSig(etaI)}.`);
    lines.push({ math: "α_m = 1/(2 L) ln(1/(R_1 R_2))", fallback: "αₘ = (1/2L)·ln(1/(R₁R₂))" });
    lines.push({ math: "g_th = α_i + α_m", fallback: "gₜₕ = αᵢ + αₘ (round-trip gain equals round-trip loss)" });
    lines.push({ math: "η_s = η_i (α_m)/(α_m + α_i) (λ_p)/λ", fallback: "ηₛ = ηᵢ·αₘ/(αₘ + αᵢ)·λₚ/λ" });
    lines.push({ math: "P_out = η_s (P_p - P_th)", fallback: "Pₒᵤₜ = ηₛ(Pₚ − Pₜₕ) above threshold, 0 below it" });
    lines.push(`Mirror loss αₘ = ${n6(res.alphaM)} m⁻¹ (${n6(res.alphaM / 100)} cm⁻¹); threshold gain gₜₕ = ${n6(res.gth)} m⁻¹ (${n6(res.gth / 100)} cm⁻¹).`);
    lines.push(`Slope efficiency ηₛ = ${n6(res.etaS)} (${pct(res.etaS)}): ηᵢ = ${trimSig(etaI)} × extraction αₘ/(αₘ + αᵢ) = ${n6(res.extraction)} × quantum-defect factor λₚ/λ = ${n6(res.quantum)}.`);
    lines.push("ηₛ counts the light leaving through BOTH mirrors (αₘ is their combined loss); how it divides between them is not computed here, so the output coupler alone delivers less.");
    lines.push(`Photon lifetime n/(c(αᵢ + αₘ)) = ${pre(res.tauP, "s")}.`);
    if (res.Pout !== null && Pp !== null) {
      lines.push(Pp > Pth
        ? `At ${trimSig(Pp)} W of pump (${trimSig(Pp / Pth)} × threshold): output ${n6(res.Pout)} W through both mirrors.`
        : `At ${trimSig(Pp)} W the pump is at or below the ${trimSig(Pth)} W threshold: no laser output (spontaneous emission only).`);
    }
    lines.push("Model: the gain medium fills the cavity (no confinement factor), losses and gain are uniform, and the output rises linearly above threshold. Pₜₕ is your measured or quoted value; it is not computed (that needs cross-sections, lifetimes and mode overlap). The extraction form is the diode-laser ηₑₓₜ = ηᵢ·αₘ/(αₘ + αᵢ); λₚ/λ is the quantum-defect limit of an optically pumped laser.");
    const rows: string[][] = [
      ["Quantity", "Value"],
      ["Mirror loss αₘ (m⁻¹)", n6(res.alphaM)],
      ["Threshold gain gₜₕ (m⁻¹)", n6(res.gth)],
      ["Extraction αₘ/(αₘ + αᵢ)", n6(res.extraction)],
      ["Quantum-defect factor λₚ/λ", n6(res.quantum)],
      ["Slope efficiency ηₛ", n6(res.etaS)],
      ["Photon lifetime", pre(res.tauP, "s")],
    ];
    if (res.Pout !== null) rows.push(["Output power (W)", n6(res.Pout)]);
    const outputs: EngOutput[] = [
      { key: "alphaM", label: "Mirror loss", value: res.alphaM, unit: "m⁻¹" },
      { key: "gth", label: "Threshold gain", value: res.gth, unit: "m⁻¹" },
      { key: "extraction", label: "Extraction efficiency", value: res.extraction, unit: "" },
      { key: "etaS", label: "Slope efficiency", value: res.etaS, unit: "" },
      { key: "tauP", label: "Photon lifetime", value: res.tauP, unit: "s" },
    ];
    if (res.Pout !== null) outputs.push({ key: "Pout", label: "Output power", value: res.Pout, unit: "W" });
    return finish(lines, u.conversions, [
      table("Threshold and slope efficiency", rows),
      plot(thresholdChartSvg(res.etaS, Pth, Pp), "Output power against pump power", "Laser output power against pump power: zero up to the threshold, then a straight line of slope equal to the slope efficiency, with the operating point marked"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Coherence and Schawlow–Townes
// ---------------------------------------------------------------------------------------------------------------

const SHAPES = [
  { value: "lorentzian", label: "Lorentzian (a single-mode laser line)" },
  { value: "gaussian", label: "Gaussian (an inhomogeneous or broadband source)" },
];

const coherenceCalc: OptCalc = {
  id: "laser-coherence",
  name: "Coherence length & time from a linewidth; Schawlow–Townes limit",
  group: "Optics & photonics",
  unitContract: "converts",
  hint:
    "The FWHM linewidth as a frequency (1 MHz) or a wavelength (0.01 nm, with the centre wavelength) and the line shape. " +
    "A Lorentzian's coherence length is quoted at |γ| = 1/e, cτ = c/(πΔν); a Gaussian's at 50 % fringe visibility, " +
    "(2 ln 2/π)·c/Δν (the OCT convention). Both conventions are tabulated for the chosen shape. Give a passive cavity " +
    "linewidth and the output power for the Schawlow–Townes quantum limit.",
  fields: [
    { key: "shape", label: "Line shape", default: "lorentzian", kind: "select", options: SHAPES },
    { key: "dnu", label: "Linewidth, FWHM (Hz; or a wavelength such as 0.01 nm)", default: "1 MHz", kind: "text" },
    { key: "lam", label: "Centre wavelength λ (nm; for a wavelength linewidth and Schawlow–Townes)", default: "1064 nm", kind: "text" },
    { key: "dnuc", label: "Passive cavity linewidth Δν(c), FWHM (Hz; blank to skip Schawlow–Townes)", default: "", kind: "text" },
    { key: "pout", label: "Laser output power (W; for Schawlow–Townes)", default: "1 mW", kind: "text" },
  ],
  compute: (r) => {
    const shape: LineShape = r("shape") === "gaussian" ? "gaussian" : "lorentzian";
    const u = unitReader(r);
    const lamNm = u.opt("lam", "nm", "nm", "Centre wavelength");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    // The linewidth may be a frequency or a wavelength: a bare number is Hz; a length unit is a wavelength width.
    const rawDnu = (r("dnu") ?? "").trim();
    if (!rawDnu) return refuse("Linewidth: this field is required.");
    let dnu: number;
    const lines: EngLine[] = [];
    const asHz = parseMeasured(rawDnu.replace(/[−–]/g, "-"), "Hz");
    if (!("error" in asHz)) {
      dnu = asHz.inTarget;
      if (!asHz.assumed && asHz.unit !== "Hz") u.conversions.push(`Linewidth: ${trimSig(asHz.value)} ${formatUnit(asHz.unit)} = ${trimSig(dnu)} Hz`);
    } else {
      const asLen = parseMeasured(rawDnu.replace(/[−–]/g, "-"), "m");
      if ("error" in asLen) return refuse(`Linewidth: give a frequency (1 MHz) or a wavelength width (0.01 nm). ${asHz.error}`);
      if (lamNm === null) return refuse("A wavelength linewidth needs the centre wavelength to become a frequency (Δν = cΔλ/λ²).");
      const f = linewidthFromWavelength(asLen.inTarget, lamNm * 1e-9);
      if (typeof f !== "number") return refuse(f.error);
      dnu = f;
      lines.push(`Linewidth ${trimSig(asLen.value)} ${formatUnit(asLen.unit)} at λ = ${trimSig(lamNm)} nm is Δν = cΔλ/λ² = ${pre(dnu, "Hz")}.`);
      lines.push({ math: "Δν = (c Δλ)/λ^2", fallback: "Δν = cΔλ/λ² (first order in Δλ/λ)" });
    }
    const res = coherence(shape, dnu);
    if (!res.ok) return refuse(res.error);
    const name = shape === "lorentzian" ? "Lorentzian" : "Gaussian";
    if (shape === "lorentzian") {
      lines.push({ math: "abs(γ(τ)) = e^(-π Δν abs(τ))", fallback: "|γ(τ)| = exp(−πΔν|τ|), the degree of coherence of a Lorentzian line" });
      lines.push({ math: "τ_coh = 1/(π Δν)", fallback: "τ(coh) = 1/(πΔν) (|γ| = 1/e)" });
      lines.push({ math: "L_coh = c τ_coh", fallback: "L(coh) = cτ(coh)" });
    } else {
      lines.push({ math: "abs(γ(τ)) = e^(-(π Δν τ)^2/(4 ln 2))", fallback: "|γ(τ)| = exp(−(πΔντ)²/(4 ln 2)), the degree of coherence of a Gaussian line" });
      lines.push({ math: "L_coh = (2 ln 2)/π c/Δν = (2 ln 2)/π λ^2/Δλ", fallback: "L(coh) = (2 ln 2/π)·c/Δν = (2 ln 2/π)·λ²/Δλ (|γ| = 1/2)" });
    }
    lines.push(`${name} line, FWHM ${pre(dnu, "Hz")}: coherence time ${pre(res.tauCoh, "s")}, coherence length ${pre(res.Lcoh, "m")} (quoted at |γ| = ${res.convention}${shape === "lorentzian" ? ", the decay constant of the field correlation" : ", where fringe visibility falls to 50 %"}).`);
    lines.push(`The other convention for the same line: |γ| = ${shape === "lorentzian" ? "1/2" : "1/e"} at ${pre(shape === "lorentzian" ? res.LHalf : res.L1e, "m")}. A Lorentzian and a Gaussian of the same FWHM quoted at the same level differ by ${shape === "lorentzian" ? "a factor 2√(ln 2) = 1.665 at 1/e" : "a factor 2 at 1/2"}, so say which shape and level a coherence length uses.`);
    lines.push("Lengths are optical path differences in vacuum: divide by the group index for a length inside a medium. A Michelson's arm-length offset is half the path difference.");
    const rows: string[][] = [
      ["Level of |γ|", "Coherence time", "Coherence length"],
      [`1/e${shape === "lorentzian" ? " (quoted)" : ""}`, pre(res.tau1e, "s"), pre(res.L1e, "m")],
      [`1/2${shape === "gaussian" ? " (quoted)" : ""}`, pre(res.tauHalf, "s"), pre(res.LHalf, "m")],
    ];
    const outputs: EngOutput[] = [
      { key: "dnu", label: "Linewidth (FWHM)", value: dnu, unit: "Hz" },
      { key: "tauCoh", label: "Coherence time", value: res.tauCoh, unit: "s" },
      { key: "Lcoh", label: "Coherence length", value: res.Lcoh, unit: "m" },
      { key: "L1e", label: "Path difference at |γ| = 1/e", value: res.L1e, unit: "m" },
      { key: "LHalf", label: "Path difference at |γ| = 1/2", value: res.LHalf, unit: "m" },
    ];
    // Schawlow–Townes.
    const dnuC = u.opt("dnuc", "Hz", "Hz", "Passive cavity linewidth");
    let Pout: number | null = null;
    if (dnuC !== null) Pout = u.req("pout", "W", "W", "Laser output power");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (dnuC !== null) {
      if (lamNm === null) return refuse("Schawlow–Townes needs the laser wavelength (its photon energy hν).");
      const st = schawlowTownes(lamNm * 1e-9, dnuC, Pout as number);
      if (typeof st !== "number") return refuse(st.error);
      lines.push({ math: "Δν_ST = (2 π h ν (Δν_c)^2)/P_out", fallback: "Δν(ST) = 2πhν(Δν(c))²/Pₒᵤₜ (FWHM)" });
      lines.push(`Schawlow–Townes limit: Δν(c) = ${pre(dnuC, "Hz")}, Pₒᵤₜ = ${pre(Pout as number, "W")}, ν = ${pre(C_LIGHT / (lamNm * 1e-9), "Hz")}: Δν(ST) = ${pre(st, "Hz")} (FWHM, Lorentzian), a coherence length c/(πΔν(ST)) = ${pre(C_LIGHT / (Math.PI * st), "m")}.`);
      lines.push("Schawlow–Townes is the quantum (spontaneous-emission) limit of an ideal laser well above threshold with no intrinsic cavity loss; real lines are wider (technical noise, vibration, and in semiconductor lasers the Henry α-factor, none of which is included). Δν(c) is the passive cavity's Lorentzian FWHM: the Fabry–Pérot tool's 1/(2πτₚ).");
      rows.push(["Schawlow–Townes (1/e)", pre(1 / (Math.PI * st), "s"), pre(C_LIGHT / (Math.PI * st), "m")]);
      outputs.push({ key: "dnuST", label: "Schawlow–Townes linewidth", value: st, unit: "Hz" });
    }
    return finish(lines, u.conversions, [
      table("Coherence", rows),
      plot(coherenceChartSvg(shape, dnu), "Degree of coherence against path difference", `The degree of coherence of a ${name} line against optical path difference, the same-FWHM ${shape === "lorentzian" ? "Gaussian" : "Lorentzian"} in grey, with the 1/e and 1/2 levels and the crossings marked`),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Second-harmonic generation
// ---------------------------------------------------------------------------------------------------------------

const PM_OPTIONS = [
  { value: "qpm", label: "First-order quasi-phase-matching (periodic poling)" },
  { value: "none", label: "None (bulk crystal, the material Δk)" },
  { value: "perfect", label: "Perfect (birefringent or ideal, Δk = 0)" },
];

const shgCalc: OptCalc = {
  id: "laser-shg",
  name: "Second-harmonic generation: phase mismatch, coherence length, QPM period",
  group: "Optics & photonics",
  unitContract: "converts",
  hint:
    "The fundamental wavelength and the crystal's refractive indices at ω and 2ω (your values: dispersion data are not built " +
    "in) give Δk = (4π/λ)(n(2ω) − n(ω)), the coherence length π/Δk and the first-order QPM period 2π/Δk. With a crystal length " +
    "the sinc² phase-matching factor; with d(eff) and the fundamental intensity, the plane-wave low-conversion efficiency.",
  fields: [
    { key: "lam", label: "Fundamental wavelength λ (nm)", default: "1064 nm", kind: "text" },
    { key: "nw", label: "Refractive index at the fundamental, n(ω)", default: "2.1560", kind: "text" },
    { key: "n2w", label: "Refractive index at the second harmonic, n(2ω)", default: "2.2340", kind: "text" },
    { key: "mode", label: "Phase matching", default: "qpm", kind: "select", options: PM_OPTIONS },
    { key: "per", label: "QPM period Λ (µm; blank = the computed period)", default: "", kind: "text" },
    { key: "L", label: "Crystal length L (mm; blank for none)", default: "10 mm", kind: "text" },
    { key: "deff", label: "d(eff) (pm/V; blank to skip the efficiency)", default: "", kind: "text" },
    { key: "I", label: "Fundamental intensity (W/m²; MW/cm² converts)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const mode: PhaseMatching = r("mode") === "none" ? "none" : r("mode") === "perfect" ? "perfect" : "qpm";
    const u = unitReader(r);
    const lamNm = u.req("lam", "nm", "nm", "Fundamental wavelength");
    const perUm = mode === "qpm" ? u.opt("per", "um", "µm", "QPM period") : null;
    const Lmm = u.opt("L", "mm", "mm", "Crystal length");
    const deffPm = u.opt("deff", "pm/V", "pm/V", "d(eff)");
    const I = u.opt("I", "W/m^2", "W/m²", "Fundamental intensity");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const nW = plain(r("nw"));
    const n2W = plain(r("n2w"));
    if (!Number.isFinite(nW)) return refuse(`n(ω): "${(r("nw") ?? "").trim()}" is not a number.`);
    if (!Number.isFinite(n2W)) return refuse(`n(2ω): "${(r("n2w") ?? "").trim()}" is not a number.`);
    if ((deffPm !== null || I !== null) && (deffPm === null || I === null || Lmm === null))
      return refuse("The efficiency needs all three of d(eff), the fundamental intensity and the crystal length (or clear d(eff) and the intensity).");
    const res = shg({ lambda: lamNm * 1e-9, nW, n2W, L: Lmm === null ? null : Lmm / 1000, mode, period: perUm === null ? null : perUm * 1e-6, deff: deffPm === null ? null : deffPm * 1e-12, I });
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    const adk = Math.abs(res.dk);
    lines.push(`Fundamental λ = ${trimSig(lamNm)} nm, n(ω) = ${trimSig(nW)}, n(2ω) = ${trimSig(n2W)}.`);
    lines.push({ math: "Δk = k_2ω - 2 k_ω = (4 π)/λ (n_2ω - n_ω)", fallback: "Δk = k(2ω) − 2k(ω) = (4π/λ)(n(2ω) − n(ω))" });
    lines.push({ math: "l_c = π/Δk", fallback: "ℓ(c) = π/Δk (coherence length)" });
    lines.push({ math: "Λ = (2 π)/Δk = 2 l_c", fallback: "Λ = 2π/Δk = 2ℓ(c) (first-order QPM period)" });
    if (adk === 0) lines.push("n(2ω) = n(ω): Δk = 0, the interaction is phase-matched as it stands; the coherence length is unbounded and no QPM grating is needed.");
    else {
      lines.push(`Phase mismatch Δk = ${n6(res.dk)} m⁻¹ (${n6(res.dk / 100)} cm⁻¹)${res.dk < 0 ? "; negative because n(2ω) < n(ω) (magnitudes are used below)" : ""}.`);
      lines.push(`Coherence length ℓ(c) = π/|Δk| = ${pre(res.lc as number, "m")}; first-order QPM period Λ = 2π/|Δk| = ${pre(res.period as number, "m")} (m-th order: m·Λ, with d(eff) reduced by 1/m).`);
    }
    const outputs: EngOutput[] = [{ key: "dk", label: "Phase mismatch Δk", value: res.dk, unit: "m⁻¹" }];
    if (res.lc !== null && res.period !== null) outputs.push({ key: "lc", label: "Coherence length", value: res.lc, unit: "m" }, { key: "period", label: "First-order QPM period", value: res.period, unit: "m" });
    const rows: string[][] = [["Quantity", "Value"], ["Δk (m⁻¹)", n6(res.dk)], ["Coherence length π/|Δk|", res.lc === null ? "unbounded (Δk = 0)" : pre(res.lc, "m")], ["QPM period 2π/|Δk|", res.period === null ? "none needed" : pre(res.period, "m")]];
    if (mode === "qpm" && res.periodUsed !== null) {
      lines.push(`QPM with Λ = ${pre(res.periodUsed, "m")}: residual mismatch |Δk| − 2π/Λ = ${n6(res.dkRes)} m⁻¹; the driving coefficient is the first Fourier component of the 50 % duty-cycle grating, d(Q) = (2/π)·d(eff).`);
      lines.push({ math: "d_Q = 2/π d_eff", fallback: "d(Q) = (2/π)·d(eff) (first order, 50 % duty cycle)" });
    } else if (mode === "perfect") lines.push("Phase matching taken as perfect (Δk = 0): the crystal is assumed birefringently matched, or ideally matched.");
    if (Lmm !== null && res.sinc2 !== null && res.dkFwhm !== null) {
      lines.push({ math: "η ∝ (sin(Δk L/2)/(Δk L/2))^2", fallback: "η ∝ sinc²(ΔkL/2), sinc x = sin x/x" });
      lines.push(`Crystal L = ${trimSig(Lmm)} mm: ΔkL/2 = ${n6((res.dkRes * Lmm) / 2000)} rad, phase-matching factor sinc² = ${n6(res.sinc2)}. Acceptance: the sinc² peak falls to half at ΔkL/2 = ±${fmtSig(SINC2_HALF_X, 5)}, a full width in Δk of ${n6(res.dkFwhm)} m⁻¹.`);
      if (mode === "none" && adk > 0) lines.push(`Without phase matching the harmonic only grows over one coherence length (${pre(res.lc as number, "m")}) and then flows back: ${n6((Lmm / 1000) / (res.lc as number))} coherence lengths fit in this crystal.`);
      rows.push(["sinc²(ΔkL/2)", n6(res.sinc2)], ["Acceptance FWHM in Δk (m⁻¹)", n6(res.dkFwhm)]);
      outputs.push({ key: "sinc2", label: "Phase-matching factor sinc²", value: res.sinc2, unit: "" }, { key: "dkFwhm", label: "Acceptance FWHM in Δk", value: res.dkFwhm, unit: "m⁻¹" });
    }
    if (res.eta !== null && deffPm !== null && I !== null && Lmm !== null) {
      lines.push({ math: "η = I_2ω/I_ω = (2 ω^2 d^2 L^2)/(n_2ω n_ω^2 c^3 ε_0) I_ω (sin(Δk L/2)/(Δk L/2))^2", fallback: "η = I(2ω)/I(ω) = 2ω²d²L²I(ω)/(n(2ω) n(ω)² c³ ε₀)·sinc²(ΔkL/2), ω the fundamental angular frequency" });
      if (res.eta > 0.1)
        lines.push(`Efficiency NOT reported: the low-conversion formula gives ${fmtSig(res.eta * 100, 3)} %, above 10 %, where the undepleted-pump assumption fails (the formula would overstate it and can pass 100 %). Lower the intensity or the length, or use a pump-depletion (tanh²) model.`);
      else {
        lines.push(`Low-conversion efficiency η = ${n6(res.eta)} (${pct(res.eta, 4)}) with d = ${trimSig(deffPm)} pm/V${mode === "qpm" ? ` × 2/π = ${n6(deffPm * 2 / Math.PI)} pm/V` : ""}, I(ω) = ${trimSig(I)} W/m², L = ${trimSig(Lmm)} mm.`);
        rows.push(["Efficiency I(2ω)/I(ω)", n6(res.eta)]);
        outputs.push({ key: "eta", label: "SHG efficiency (low conversion)", value: res.eta, unit: "" });
      }
      lines.push("The efficiency is the plane-wave, undepleted-pump, continuous-wave result with no absorption or walk-off; a focused Gaussian beam (Boyd–Kleinman focusing) is not computed.");
    }
    lines.push("Refractive indices are your inputs (no Sellmeier data is built in); d(eff) is the effective coefficient for your crystal cut and polarisations.");
    const extra: AnalyzeBlock[] = [table("Second-harmonic phase matching", rows)];
    if (adk > 0 && res.lc !== null) extra.push(plot(shgGrowthChartSvg(adk, res.lc), `Second-harmonic growth along the crystal, in units of the phase-matched intensity at one coherence length (${pre(res.lc, "m")})`, "Second-harmonic intensity against distance into the crystal over six coherence lengths: quadratic growth when phase-matched, steady growth under first-order quasi-phase-matching, and oscillation when not phase-matched"));
    if (Lmm !== null || adk === 0) extra.push(plot(shgSincChartSvg(res.dkRes, Lmm === null ? 1 : Lmm / 1000), "Phase-matching curve sinc²(ΔkL/2)", "Relative second-harmonic efficiency sinc squared against the phase mismatch times half the crystal length, with the half-maximum width and this crystal marked"));
    return finish(lines, u.conversions, extra, outputs);
  },
};

/** The Release E laser calculators, in dropdown order (group "Optics & photonics", already in ENG_GROUP_ORDER). */
export const LASER_CALCS: OptCalc[] = [fpCalc, thresholdCalc, coherenceCalc, shgCalc];
