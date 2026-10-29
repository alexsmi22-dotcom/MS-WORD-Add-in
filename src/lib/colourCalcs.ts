// Pane glue for the Colour & appearance calculators: colour difference with a claim-ready tolerance check, colour
// conversion, chromatic adaptation, spectral reflectance to colour, the metamerism index, batch colour QC, whiteness
// and yellowness, and WCAG contrast. Kept OUT of taskpane.ts; the integrator spreads COLOUR_CALCS into ENG_CALCS
// (group "Colour & appearance", placed after "Light & camera" in ENG_GROUP_ORDER).
//
// No number is computed here: colourScience.ts owns them (tested against colour-science 0.4.7). This file reads the
// fields, refuses bad input by name, words the result under the display contract (U+2212, no em dash, no NaN or
// Infinity in an ok result), opens every result with a plain-language reading built from the computed numbers, and
// draws.
//
// WHY THE RECORD FIELDS. "ΔE < 2" is not a limitation anyone can test: the same pair of colours can be 1.2 on
// CIEDE2000 and 2.6 on CIE76, and both move with the illuminant, the observer and the measuring geometry. So the
// difference tools ask for all three, print a claim-ready line naming them, and say so when one is missing.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import {
  adaptXYZ,
  CAT_LABELS,
  ciede2000,
  deltaE,
  DE_FORMULA_LABELS,
  DE_SYMBOL,
  diffComponents,
  dominantWavelength,
  ILLUMINANT_LABELS,
  ILLUMINANTS,
  isIlluminant,
  labToLch,
  labToXYZ,
  lchToLab,
  luvToXYZ,
  metamerismIndex,
  OBSERVER_LABELS,
  parseHex,
  SPECTRAL_METHOD_LABELS,
  spectrumToXYZ,
  srgbToXYZ,
  wcagContrast,
  wcagLuminance,
  whitePoint,
  cieWhiteness,
  XYZToLab,
  XYZToLuv,
  XYZToSrgb,
  XYZToUpVp,
  XYZToxy,
  xyToXYZ,
  yellownessD1925,
  yellownessE313,
  type CatMethod,
  type DeFormula,
  type IlluminantId,
  type Lab,
  type MetamerismCorrection,
  type Observer,
  type ParametricK,
  type SpectralMethod,
  type SpectralXYZ,
  type Spectrum,
  type Vec3,
} from "./colourScience";
import { abPlaneSvg, abZoomSvg, barsSvg, chromaticitySvg, contrastSwatchSvg, deltaLBarsSvg, lightnessBarsSvg, spectrumSvg, swatchSvg } from "./colourCharts";

type ColourCalc = EngCalcDef<"Colour & appearance">;

const GROUP = "Colour & appearance" as const;

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Fixed decimals, true minus, never "−0.00". */
export function fx(v: number, d = 2): string {
  const t = Math.abs(v).toFixed(d);
  return v < 0 && Number(t) !== 0 ? `−${t}` : t;
}
/** Signed fixed decimals: "+1.20", "−0.35", "0.00". */
export function sg(v: number, d = 2): string {
  const t = Math.abs(v).toFixed(d);
  if (Number(t) === 0) return t;
  return v < 0 ? `−${t}` : `+${t}`;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngReportLine[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  return refuseNonFinite({ ...engReport(lines, extra), outputs });
}

/** Numbers in a field: commas, spaces, semicolons or tabs between them; U+2212 and en dashes read as minus. */
function numbersIn(raw: string): number[] | null {
  const t = (raw ?? "").replace(/[−–]/g, "-").trim();
  if (!t) return [];
  const parts = t.split(/[\s,;]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(p)) return null;
    out.push(Number(p));
  }
  return out;
}

/** Exactly three finite numbers, or the refusal text. */
function three(raw: string, label: string, names: string): Vec3 | string {
  const n = numbersIn(raw);
  if (n === null) return `${label}: "${(raw ?? "").trim()}" is not a list of numbers. Give ${names}, separated by commas or spaces.`;
  if (n.length !== 3) return `${label}: give exactly three numbers (${names}); got ${n.length}.`;
  if (!n.every(Number.isFinite)) return `${label}: every value must be a finite number.`;
  return [n[0], n[1], n[2]];
}

/** L*a*b* bounds a surface colour can have; outside them a value is a typing slip, not a colour. */
function checkLab(lab: Lab, label: string): string | null {
  if (lab.L < 0) return `${label}: L* = ${fx(lab.L)} is below 0. L* runs from 0 (black) to 100 (the reference white).`;
  if (lab.L > 110) return `${label}: L* = ${fx(lab.L)} is above 110. L* runs from 0 to 100 (the reference white; a fluorescent or glossy sample can read slightly above 100).`;
  if (Math.abs(lab.a) > 200 || Math.abs(lab.b) > 200) return `${label}: a* = ${fx(lab.a)}, b* = ${fx(lab.b)} is outside ±200, beyond any real surface colour. Check the order (L*, a*, b*) and the decimal point.`;
  return null;
}

/** A colour typed as L*a*b* or L*C*h (mode "lab" | "lch"), checked. */
function readLab(raw: string, mode: string, label: string): Lab | string {
  if (mode === "lch") {
    const v = three(raw, label, "L*, C*ab and hab in degrees");
    if (typeof v === "string") return v;
    if (v[1] < 0) return `${label}: chroma C*ab = ${fx(v[1])} is negative. Chroma is a distance from the neutral axis, 0 or more.`;
    const lab = lchToLab({ L: v[0], C: v[1], h: ((v[2] % 360) + 360) % 360 });
    return checkLab(lab, label) ?? lab;
  }
  const v = three(raw, label, "L*, a* and b*");
  if (typeof v === "string") return v;
  const lab = { L: v[0], a: v[1], b: v[2] };
  return checkLab(lab, label) ?? lab;
}

const ILL_OPTIONS = ILLUMINANTS.map((id) => ({ value: id, label: ILLUMINANT_LABELS[id] }));
const OBS_OPTIONS = [
  { value: "10", label: OBSERVER_LABELS["10"] },
  { value: "2", label: OBSERVER_LABELS["2"] },
];
const GEOM_OPTIONS = [
  { value: "d8i", label: "d/8° specular included (SCI)" },
  { value: "d8e", label: "d/8° specular excluded (SCE)" },
  { value: "45-0", label: "45°/0° (or 0°/45°)" },
  { value: "none", label: "Not stated" },
];
const GEOM_SHORT: Record<string, string> = { d8i: "d/8° SCI", d8e: "d/8° SCE", "45-0": "45°/0°", none: "geometry not stated" };
const FORMULA_OPTIONS = (Object.keys(DE_FORMULA_LABELS) as DeFormula[]).map((f) => ({ value: f, label: DE_FORMULA_LABELS[f] }));
const OP_OPTIONS = [
  { value: "<", label: "less than (<)" },
  { value: "≤", label: "at most (≤)" },
];
const MODE_OPTIONS = [
  { value: "lab", label: "L*, a*, b*" },
  { value: "lch", label: "L*, C*ab, hab (degrees)" },
];

/** The governing equation of each tolerance formula, as a typeset line. */
const FORMULA_EQ: Record<DeFormula, { math: string; fallback: string }> = {
  de76: { math: 'Delta E_ab^"*" = sqrt((Delta L^"*")^2 + (Delta a^"*")^2 + (Delta b^"*")^2)', fallback: "ΔE*ab = √(ΔL*² + Δa*² + Δb*²)" },
  de94g: { math: "Delta E_94 = sqrt((Delta L/k_L)^2 + (Delta C/(1 + K_1 C_1))^2 + (Delta H/(1 + K_2 C_1))^2)", fallback: "ΔE*94 = √((ΔL*/kL)² + (ΔC*ab/(1 + K₁C*₁))² + (ΔH*ab/(1 + K₂C*₁))²), C*₁ the standard's chroma" },
  de94t: { math: "Delta E_94 = sqrt((Delta L/k_L)^2 + (Delta C/(1 + K_1 C_1))^2 + (Delta H/(1 + K_2 C_1))^2)", fallback: "ΔE*94 = √((ΔL*/kL)² + (ΔC*ab/(1 + K₁C*₁))² + (ΔH*ab/(1 + K₂C*₁))²), kL = 2, K₁ = 0.048, K₂ = 0.014" },
  cmc21: { math: "Delta E_CMC = sqrt((Delta L/(l S_L))^2 + (Delta C/(c S_C))^2 + (Delta H/S_H)^2)", fallback: "ΔE CMC = √((ΔL*/(l·SL))² + (ΔC*ab/(c·SC))² + (ΔH*ab/SH)²), l:c = 2:1, S from the standard" },
  cmc11: { math: "Delta E_CMC = sqrt((Delta L/(l S_L))^2 + (Delta C/(c S_C))^2 + (Delta H/S_H)^2)", fallback: "ΔE CMC = √((ΔL*/(l·SL))² + (ΔC*ab/(c·SC))² + (ΔH*ab/SH)²), l:c = 1:1, S from the standard" },
  de00: {
    math: "Delta E_00 = sqrt((Delta L'/(k_L S_L))^2 + (Delta C'/(k_C S_C))^2 + (Delta H'/(k_H S_H))^2 + R_T (Delta C'/(k_C S_C)) (Delta H'/(k_H S_H)))",
    fallback: "ΔE₀₀ = √((ΔL′/kL·SL)² + (ΔC′/kC·SC)² + (ΔH′/kH·SH)² + RT·(ΔC′/kC·SC)·(ΔH′/kH·SH))",
  },
};

const readIll = (v: string): IlluminantId => (isIlluminant(v) ? v : "D65");
const readObs = (v: string): Observer => (v === "2" ? "2" : "10");
const readFormula = (v: string): DeFormula => (v in DE_FORMULA_LABELS ? (v as DeFormula) : "de00");
const condition = (ill: IlluminantId, obs: Observer): string => `${ill}/${obs}°`;

/** "1:1:1", "2:1:1" or "2, 1, 1": the CIEDE2000 parametric factors. */
function readK(raw: string): ParametricK | string {
  const t = (raw ?? "").trim();
  if (!t) return { kL: 1, kC: 1, kH: 1 };
  const parts = t.split(/[:\s,]+/).filter(Boolean);
  const n = parts.map(Number);
  if (parts.length !== 3 || !n.every((x) => Number.isFinite(x) && x > 0)) return `Parametric factors kL:kC:kH: "${t}" is not three positive numbers. Write 1:1:1 (the default) or 2:1:1 (textiles).`;
  return { kL: n[0], kC: n[1], kH: n[2] };
}
const kText = (k: ParametricK): string => `${trimNum(k.kL)}:${trimNum(k.kC)}:${trimNum(k.kH)}`;
function trimNum(v: number): string {
  return String(Number(v.toPrecision(6)));
}

/** A tolerance field: blank (none) or a positive number. */
function readTol(raw: string, required: boolean): number | null | string {
  const t = (raw ?? "").trim();
  if (!t) return required ? "Tolerance: give the ΔE limit the samples must meet (for example 2)." : null;
  const n = numbersIn(t);
  if (!n || n.length !== 1 || !(n[0] > 0)) return `Tolerance: "${t}" is not a positive number.`;
  if (n[0] > 100) return `Tolerance: ${t} is larger than any colour difference between surface colours (ΔE above 100 spans black to white).`;
  return n[0];
}

/** Lightness, chroma and hue words for a difference, from the computed components. */
function directionWords(d: ReturnType<typeof diffComponents>): { lightness: string; chroma: string; hue: string; axes: string[] } {
  const deg = (v: number, small: string, mid: string, big: string): string => (Math.abs(v) < 1.5 ? small : Math.abs(v) < 3 ? mid : big);
  const lightness = Math.abs(d.dL) < 0.5 ? "" : d.dL > 0 ? deg(d.dL, "slightly lighter", "lighter", "much lighter") : deg(d.dL, "slightly darker", "darker", "much darker");
  const chroma = Math.abs(d.dC) < 0.5 ? "" : d.dC > 0 ? deg(d.dC, "a little more saturated", "more saturated", "much more saturated") : deg(d.dC, "a little duller", "duller", "much duller");
  let hue = "";
  if (d.hueDefined && Math.abs(d.dH) >= 0.5) {
    const names = ["red", "yellow", "green", "blue"];
    const q = d.h1 / 90;
    const toward = d.dh > 0 ? names[(Math.floor(q + 1e-9) + 1) % 4] : names[((Math.ceil(q - 1e-9) - 1) % 4 + 4) % 4];
    hue = `shifted toward ${toward}`;
  }
  const axes: string[] = [];
  if (Math.abs(d.dL) >= 0.005) axes.push(`${d.dL > 0 ? "lighter" : "darker"} (ΔL* ${sg(d.dL)})`);
  if (Math.abs(d.da) >= 0.005) axes.push(`${d.da > 0 ? "redder" : "greener"} (Δa* ${sg(d.da)})`);
  if (Math.abs(d.db) >= 0.005) axes.push(`${d.db > 0 ? "yellower" : "bluer"} (Δb* ${sg(d.db)})`);
  if (Math.abs(d.dC) >= 0.005) axes.push(`${d.dC > 0 ? "more saturated" : "less saturated"} (ΔC*ab ${sg(d.dC)})`);
  if (d.hueDefined && Math.abs(d.dH) >= 0.005) axes.push(`a hue shift (ΔH*ab ${sg(d.dH)}, Δhab ${sg(d.dh, 1)}°)`);
  return { lightness, chroma, hue, axes };
}

/** How visible a CIEDE2000 difference is: a rule of thumb for surface colours side by side in good light. */
function visibility(de00: number): string {
  if (de00 < 0.5) return "too small for most observers to see";
  if (de00 < 1) return "at the threshold a trained eye sees in close comparison";
  if (de00 < 2) return "small but perceptible on close inspection";
  if (de00 < 3.5) return "clearly visible side by side";
  if (de00 < 5) return "obvious";
  return "large: the two read as different colours";
}

function joinWords(parts: string[]): string {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] ?? "";
  return p.slice(0, -1).join(", ") + " and " + p[p.length - 1];
}

/** A broad hue name for an L*C*h colour (bands between the CIELAB hue angles of the sRGB primaries and secondaries). */
function hueName(C: number, h: number): string {
  if (C < 5) return "near-neutral grey";
  const bands: Array<[number, string]> = [[4, "magenta-purple"], [55, "red"], [80, "orange"], [115, "yellow"], [166, "green"], [251, "cyan / blue-green"], [317, "blue"], [361, "magenta-purple"]];
  const name = bands.find(([lim]) => h < lim)![1];
  const sat = C < 20 ? "muted" : C < 50 ? "moderately saturated" : "strongly saturated";
  return `${sat} ${name}`;
}
const lightName = (L: number): string => (L < 30 ? "dark" : L < 45 ? "medium-dark" : L < 60 ? "medium" : L < 75 ? "light" : "very light");

/** A verdict against a tolerance, decided on the unrounded value; flagged when the printed value ties the limit. */
function verdict(v: number, tol: number, op: string, d = 2): { pass: boolean; text: string; borderline: boolean; shown: string } {
  const pass = op === "≤" ? v <= tol : v < tol;
  const printed = Number(v.toFixed(d));
  const borderline = Math.abs(printed - tol) < 1e-12 || (printed < tol) !== (v < tol);
  // A borderline value prints to four decimals, rounded TOWARD its verdict (down for a pass, up for a fail), so the
  // printed number never contradicts the PASS or FAIL beside it (1.99996 < 2 prints 1.9999, not 2.0000).
  const shown = borderline ? (pass ? Math.floor(v * 1e4) : Math.ceil(v * 1e4)) / 1e4 : v;
  return { pass, borderline, text: pass ? "PASS" : "FAIL", shown: fx(shown, borderline ? 4 : d) };
}

// ---------------------------------------------------------------------------------------------------------------
// Spectral input
// ---------------------------------------------------------------------------------------------------------------

/** A wavelength/value block: rows "380 0.054" (or comma/tab separated); one header line of text is skipped. */
function readSpectrum(raw: string, units: string, label: string): { spec: Spectrum; notes: string[] } | string {
  const lines = (raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const notes: string[] = [];
  if (!lines.length) return `${label}: the block is empty. Give one row per wavelength: wavelength in nm, then the value (380 0.054).`;
  if (/[A-Za-z]/.test(lines[0]) && numbersIn(lines[0]) === null) {
    lines.shift();
    notes.push(`${label}: the first line was read as a header and skipped.`);
  }
  const wl: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const n = numbersIn(lines[i]);
    if (n === null || n.length !== 2) return `${label}, row ${i + 1} ("${lines[i]}"): give exactly two numbers, the wavelength in nm and the value.`;
    wl.push(n[0]);
    v.push(n[1]);
  }
  if (v.some((x) => !Number.isFinite(x)) || wl.some((x) => !Number.isFinite(x))) return `${label}: every wavelength and value must be a finite number.`;
  const max = Math.max(...v);
  const min = Math.min(...v);
  const pct = units === "percent";
  if (!pct && max > 1.5) return `${label}: values reach ${trimNum(max)}, which reads as a PERCENTAGE (a reflectance factor is 0–1 with 1 the perfect white). Choose "percent (0–100)" for the values, or divide them by 100.`;
  if (pct && max > 150) return `${label}: values reach ${trimNum(max)} %, beyond any reflectance or transmittance (100 % is the perfect white). Check the column order: wavelength first, then the value.`;
  const scale = pct ? 0.01 : 1;
  if (min * scale < -0.02) return `${label}: a value of ${trimNum(min)} is negative beyond instrument noise. A reflectance or transmittance factor is 0 or more.`;
  if (pct && max <= 1.5) notes.push(`${label}: "percent" is selected but no value exceeds ${trimNum(max)} %; if these are fractions (0–1), choose "fraction" or every value is 100 times too small.`);
  if (max * scale > 1) notes.push(`${label}: some values exceed 1 (the perfect white): normal for a fluorescent (optically brightened) or glossy sample measured SCI, otherwise check the calibration.`);
  if (min * scale < 0) notes.push(`${label}: small negative values (to ${trimNum(min)}) are kept as instrument noise.`);
  return { spec: { wl, v: v.map((x) => x * scale) }, notes };
}

const UNITS_OPTIONS = [
  { value: "fraction", label: "Fraction (0–1; 1 = perfect white)" },
  { value: "percent", label: "Percent (0–100)" },
];
const METHOD_OPTIONS = (Object.keys(SPECTRAL_METHOD_LABELS) as SpectralMethod[]).map((m) => ({ value: m, label: SPECTRAL_METHOD_LABELS[m] }));
const readMethod = (v: string): SpectralMethod => (v === "integration" ? "integration" : "astm-e308");

const toBlock = (rows: Array<[number, number]>): string => rows.map(([w, v]) => `${w} ${v.toFixed(4)}`).join("\n");
const WL_380_730 = Array.from({ length: 36 }, (_, i) => 380 + 10 * i);
/** BabelColor ColorChecker average "orange" (colour.SDS_COLOURCHECKERS["BabelColor Average"], 10 nm, 380–730 nm). */
const ORANGE = [0.054, 0.054, 0.053, 0.054, 0.054, 0.055, 0.055, 0.055, 0.056, 0.057, 0.058, 0.061, 0.068, 0.089, 0.125, 0.154, 0.174, 0.199, 0.248, 0.335, 0.444, 0.538, 0.587, 0.595, 0.591, 0.587, 0.584, 0.584, 0.59, 0.603, 0.62, 0.639, 0.655, 0.663, 0.663, 0.667];
/** BabelColor ColorChecker average "neutral 5 (.70 D)". */
const NEUTRAL5 = [0.105, 0.131, 0.163, 0.18, 0.186, 0.19, 0.193, 0.194, 0.194, 0.192, 0.191, 0.191, 0.191, 0.192, 0.192, 0.192, 0.192, 0.192, 0.192, 0.193, 0.192, 0.192, 0.191, 0.189, 0.188, 0.186, 0.184, 0.182, 0.181, 0.179, 0.178, 0.176, 0.174, 0.173, 0.172, 0.171];
/** A synthetic metamer of NEUTRAL5 under D65/10° (scripts/colour-oracle.py adds a metameric black), 4 decimals. */
const METAMER = [0.1045, 0.0941, 0.1202, 0.1453, 0.1518, 0.144, 0.1383, 0.1584, 0.2117, 0.2749, 0.3113, 0.2912, 0.2193, 0.1349, 0.0836, 0.093, 0.1517, 0.2209, 0.2612, 0.2596, 0.2291, 0.2014, 0.1898, 0.1878, 0.1771, 0.1441, 0.1019, 0.0816, 0.1096, 0.1806, 0.2616, 0.3043, 0.2829, 0.21, 0.1264, 0.0764];
const block = (v: number[]): string => toBlock(WL_380_730.map((w, i) => [w, v[i]] as [number, number]));

/** Tristimulus values of a spectrum, or the refusal. */
function spectralXYZ(spec: Spectrum, ill: IlluminantId, obs: Observer, method: SpectralMethod, label: string): SpectralXYZ | string {
  const r = spectrumToXYZ(spec, ill, obs, method);
  if (!r.ok) return `${label}: ${r.error}`;
  if (!(r.XYZ[1] > 0)) return `${label}: the luminance factor Y is ${fx(r.XYZ[1], 4)}, so the sample is black (or the values are all zero); it has no chromaticity.`;
  return r;
}

const SPECTRAL_ASSUMES =
  "the values are reflectance (or transmittance) factors relative to the perfect white, measured over at least 400–700 nm, " +
  "and that the illuminant named is the one the colour is to be judged under; a fluorescent sample's colour depends on the " +
  "instrument's light source, which this does not model. The white for L*a*b* is the perfect diffuser computed by the same " +
  "method (ASTM E308 practice), not the rounded tabulated white.";

// ---------------------------------------------------------------------------------------------------------------
// 1. Colour difference
// ---------------------------------------------------------------------------------------------------------------

const differenceCalc: ColourCalc = {
  id: "colour-difference",
  name: "Colour difference ΔE: CIE76, CIE94, CMC and CIEDE2000, with a tolerance check",
  group: GROUP,
  unitContract: "domain",
  hint:
    "A standard (the reference) and a sample, each as L*a*b* or L*C*h. Gives ΔL*, Δa*, Δb*, ΔC*ab, the signed ΔH*ab and Δhab, then " +
    "ΔE*ab (CIE76), ΔE*94 (graphic arts and textiles), ΔE CMC (2:1 and 1:1) and ΔE₀₀ (CIEDE2000, kL:kC:kH) side by side, the " +
    "direction in words, and a pass/fail against a tolerance on the formula you choose. A limitation such as ΔE < 2 means " +
    "nothing until it names the formula, the illuminant and observer, and the geometry, so all three are recorded in the " +
    "claim-ready line.",
  fields: [
    { key: "mode", label: "Colours entered as", default: "lab", kind: "select", options: MODE_OPTIONS },
    { key: "std", label: "Standard (reference): L*, a*, b*", default: "45.00, 52.00, 28.00", kind: "text" },
    { key: "smp", label: "Sample: L*, a*, b*", default: "46.20, 49.50, 30.10", kind: "text" },
    { key: "ill", label: "Illuminant the values were computed for", default: "D65", kind: "select", options: ILL_OPTIONS },
    { key: "obs", label: "Observer", default: "10", kind: "select", options: OBS_OPTIONS },
    { key: "geom", label: "Measuring geometry", default: "d8i", kind: "select", options: GEOM_OPTIONS },
    { key: "k", label: "CIEDE2000 parametric factors kL:kC:kH", default: "1:1:1", kind: "text" },
    { key: "tolf", label: "Tolerance formula", default: "de00", kind: "select", options: FORMULA_OPTIONS },
    { key: "op", label: "Tolerance test", default: "<", kind: "select", options: OP_OPTIONS },
    { key: "tol", label: "Tolerance ΔE (blank for none)", default: "2", kind: "text" },
  ],
  compute: (r) => {
    const mode = r("mode") === "lch" ? "lch" : "lab";
    const std = readLab(r("std"), mode, "Standard");
    if (typeof std === "string") return refuse(std);
    const smp = readLab(r("smp"), mode, "Sample");
    if (typeof smp === "string") return refuse(smp);
    const k = readK(r("k"));
    if (typeof k === "string") return refuse(k);
    const tol = readTol(r("tol"), false);
    if (typeof tol === "string") return refuse(tol);
    const ill = readIll(r("ill"));
    const obs = readObs(r("obs"));
    const geom = GEOM_SHORT[r("geom")] ? r("geom") : "none";
    const f = readFormula(r("tolf"));
    const op = r("op") === "≤" ? "≤" : "<";

    const d = diffComponents(std, smp);
    const e00 = ciede2000(std, smp, k.kL, k.kC, k.kH);
    const all: Record<DeFormula, number> = {
      de00: e00.dE,
      de76: deltaE("de76", std, smp),
      de94g: deltaE("de94g", std, smp),
      de94t: deltaE("de94t", std, smp),
      cmc21: deltaE("cmc21", std, smp),
      cmc11: deltaE("cmc11", std, smp),
    };
    const W = whitePoint(ill, obs);
    const uvStd = XYZToLuv(labToXYZ(std, W), W);
    const uvSmp = XYZToLuv(labToXYZ(smp, W), W);
    const deUv = Math.hypot(uvSmp.L - uvStd.L, uvSmp.u - uvStd.u, uvSmp.v - uvStd.v);
    const words = directionWords(d);
    const kStr = kText(k);
    const k111 = k.kL === 1 && k.kC === 1 && k.kH === 1;

    const lines: EngReportLine[] = [];
    const desc = joinWords([words.lightness, words.chroma, words.hue]);
    const head = d.dL === 0 && d.da === 0 && d.db === 0 ? "The standard and the sample are identical" : desc ? `The sample is ${desc}` : "The sample differs from the standard only slightly";
    lines.push(`${head}; the difference is ${visibility(e00.dE)} (ΔE₀₀ ${fx(e00.dE)}).`);
    const cond = `${condition(ill, obs)}; ${GEOM_SHORT[geom]}; standard → sample`;
    const sym = DE_SYMBOL[f];
    const fParen = f === "de00" ? `CIEDE2000, kL:kC:kH = ${kStr}` : DE_FORMULA_LABELS[f].replace(/^.*\((.*)\)$/, "$1");
    lines.push(`As a claim limitation: ${sym} = ${fx(all[f])} (${fParen}; ${cond}).`);
    let pass: boolean | null = null;
    if (tol !== null) {
      const v = verdict(all[f], tol, op);
      pass = v.pass;
      const shown = v.shown;
      lines.push(`Tolerance ${sym} ${op} ${trimNum(tol)}: ${v.text} (${sym} = ${shown}).${v.borderline ? ` Borderline: at two decimals this prints as ${fx(all[f])}, so a reader who rounds before comparing could decide it the other way; state the rounding in the specification.` : ""}`);
      const verdicts = (Object.keys(all) as DeFormula[]).map((g) => ({ g, ok: op === "≤" ? all[g] <= tol : all[g] < tol }));
      const differ = verdicts.filter((x) => x.ok !== pass);
      if (differ.length) {
        lines.push(`The same tolerance gives the OPPOSITE verdict on ${joinWords(differ.map((x) => `${DE_FORMULA_LABELS[x.g]} (${fx(all[x.g])})`))}: a limitation "ΔE ${op} ${trimNum(tol)}" that does not name its formula is ambiguous for this pair.`);
      }
    }
    if (geom === "none") lines.push("The measuring geometry is not stated. ΔE depends on it (d/8° with the specular component included or excluded, 45°/0°), so a ΔE without it cannot support a claim limitation; record it.");
    lines.push(`Direction (sample − standard): ${words.axes.length ? joinWords(words.axes) : "no difference"}.${d.hueDefined ? "" : " One colour is neutral (C*ab = 0), so it has no hue and no hue difference is reported."}`);
    lines.push({
      table: [
        ["Formula", "ΔE", "Weights"],
        ["ΔE*ab (CIE76)", fx(all.de76), "Euclidean in L*a*b*"],
        ["ΔE*94 graphic arts", fx(all.de94g), "kL = 1, K₁ = 0.045, K₂ = 0.015"],
        ["ΔE*94 textiles", fx(all.de94t), "kL = 2, K₁ = 0.048, K₂ = 0.014"],
        ["ΔE CMC(2:1)", fx(all.cmc21), "acceptability, l = 2, c = 1"],
        ["ΔE CMC(1:1)", fx(all.cmc11), "perceptibility, l = 1, c = 1"],
        [`ΔE₀₀ (CIEDE2000)`, fx(all.de00), `kL:kC:kH = ${kStr}`],
        ["ΔE*uv (CIE 1976 L*u*v*)", fx(deUv), `white ${condition(ill, obs)}`],
      ],
      label: "Colour difference by formula",
    });
    const lc1 = labToLch(std);
    const lc2 = labToLch(smp);
    lines.push({
      table: [
        ["Quantity", "Standard", "Sample", "Δ (sample − standard)"],
        ["L*", fx(std.L), fx(smp.L), sg(d.dL)],
        ["a*", fx(std.a), fx(smp.a), sg(d.da)],
        ["b*", fx(std.b), fx(smp.b), sg(d.db)],
        ["C*ab", fx(lc1.C), fx(lc2.C), sg(d.dC)],
        ["hab (°)", d.C1 > 0 ? fx(lc1.h, 1) : "none (neutral)", d.C2 > 0 ? fx(lc2.h, 1) : "none (neutral)", d.hueDefined ? sg(d.dh, 1) : "none (neutral)"],
        ["ΔH*ab (metric hue difference)", "", "", d.hueDefined ? sg(d.dH) : "0.00"],
      ],
      label: "Components",
    });
    lines.push({ math: 'Delta E_ab^"*" = sqrt((Delta L^"*")^2 + (Delta a^"*")^2 + (Delta b^"*")^2)', fallback: "ΔE*ab = √(ΔL*² + Δa*² + Δb*²)" });
    lines.push({ math: 'Delta H_ab^"*" = 2 sqrt(C_1^"*" C_2^"*") sin(Delta h_ab/2)', fallback: "ΔH*ab = 2√(C*₁C*₂)·sin(Δhab/2), signed: + when the sample's hue angle is larger" });
    lines.push({
      math: "Delta E_00 = sqrt((Delta L'/(k_L S_L))^2 + (Delta C'/(k_C S_C))^2 + (Delta H'/(k_H S_H))^2 + R_T (Delta C'/(k_C S_C)) (Delta H'/(k_H S_H)))",
      fallback: "ΔE₀₀ = √((ΔL′/kL·SL)² + (ΔC′/kC·SC)² + (ΔH′/kH·SH)² + RT·(ΔC′/kC·SC)·(ΔH′/kH·SH))",
    });
    lines.push(`CIEDE2000 terms: SL = ${fx(e00.SL, 4)}, SC = ${fx(e00.SC, 4)}, SH = ${fx(e00.SH, 4)}, RT = ${fx(e00.RT, 4)}, G = ${fx(e00.G, 4)}, mean hue h̄′ = ${fx(e00.hBar, 2)}°.${k111 ? "" : ` Parametric factors ${kStr} (1:1:1 is the reference condition; 2:1:1 is common for textiles).`}`);
    lines.push(
      "The formulas give different numbers for the same pair, by design: ΔE*ab treats L*a*b* as uniform, and CIE94, CMC and CIEDE2000 shrink the chroma and hue terms for saturated colours. A specification or claim must name ONE formula (with its parameters). " +
        "ΔE*94 and ΔE CMC weight by the STANDARD's chroma and hue, so swapping standard and sample changes them; ΔE*ab and ΔE₀₀ are symmetric. Name which colour is the reference.",
    );
    lines.push(
      `Assumes: both colours were measured on the same instrument, geometry and illuminant/observer (here ${condition(ill, obs)}, ${GEOM_SHORT[geom]}), as surface colours. ` +
        "CIE94, CMC and CIEDE2000 were fitted to small differences (roughly ΔE*ab below 5); for larger ones they are no longer perceptual scales. The visibility words are a rule of thumb for side-by-side viewing in good light, not a measurement.",
    );
    const contourLevel = tol ?? all[f];
    const extra: AnalyzeBlock[] = [
      plot(abPlaneSvg([{ label: "standard", lab: std }, { label: "sample", lab: smp }]), "Standard and sample in the a*b* plane (equal scales)", "The a* b* plane with the standard and the sample as points, each joined to the neutral axis at the origin by its chroma ray; the ray length is C*ab and its angle the hue angle"),
      plot(
        abZoomSvg(std, [{ label: "sample", lab: smp, pass: pass ?? undefined }], f, contourLevel, k),
        tol !== null ? `${sym} = ${trimNum(tol)} tolerance region around the standard, with ΔE*ab for comparison` : `${sym} contour through the sample's difference, with ΔE*ab for comparison`,
        "A close-up of the a* b* plane around the standard: the contour on which the chosen formula reaches the tolerance at the standard's lightness, the CIE76 circle of the same value in grey, and the sample",
      ),
      plot(lightnessBarsSvg(["Standard", "Sample"], [std.L, smp.L]), "Lightness L* of the standard and the sample", "Two bars giving the L* lightness of the standard and of the sample on the 0 to 100 scale"),
    ];
    const outputs: EngOutput[] = [
      { key: "de00", label: "ΔE₀₀ (CIEDE2000)", value: all.de00, unit: "" },
      { key: "de76", label: "ΔE*ab (CIE76)", value: all.de76, unit: "" },
      { key: "de94g", label: "ΔE*94 (graphic arts)", value: all.de94g, unit: "" },
      { key: "cmc21", label: "ΔE CMC(2:1)", value: all.cmc21, unit: "" },
      { key: "deUv", label: "ΔE*uv", value: deUv, unit: "" },
      { key: "dL", label: "ΔL*", value: d.dL, unit: "" },
      { key: "da", label: "Δa*", value: d.da, unit: "" },
      { key: "db", label: "Δb*", value: d.db, unit: "" },
      { key: "dC", label: "ΔC*ab", value: d.dC, unit: "" },
      { key: "dH", label: "ΔH*ab", value: d.dH, unit: "" },
    ];
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Colour conversion
// ---------------------------------------------------------------------------------------------------------------

const FROM_OPTIONS = [
  { value: "lab", label: "CIE L*a*b*" },
  { value: "lch", label: "CIE L*C*h (ab)" },
  { value: "xyz", label: "CIE XYZ (Y = 0–100)" },
  { value: "xyy", label: "CIE xyY (Y = 0–100)" },
  { value: "luv", label: "CIE L*u*v*" },
  { value: "srgb", label: "sRGB, 0–255" },
  { value: "hex", label: "sRGB hex (#RRGGBB)" },
];

const convertCalc: ColourCalc = {
  id: "colour-convert",
  name: "Colour conversion: XYZ, xyY, L*a*b*, L*C*h, L*u*v*, u′v′ and sRGB/hex",
  group: GROUP,
  unitContract: "domain",
  hint:
    "One colour in any of XYZ, xyY, L*a*b*, L*C*h, L*u*v*, sRGB (0–255) or hex, under a chosen illuminant (D65, D50, A, C, F2, " +
    "F7, F11, D55, D75) and observer (2° or 10°), converted to all the others. sRGB is defined for D65 and the 2° observer: for " +
    "another white the colour is adapted to it by Bradford (as ICC profiles do), and a colour outside the sRGB gamut is " +
    "flagged with the clipped value shown.",
  fields: [
    { key: "from", label: "Input space", default: "lab", kind: "select", options: FROM_OPTIONS },
    { key: "val", label: "Values (three numbers, or a hex code)", default: "52.0, 42.5, 20.1", kind: "text" },
    { key: "ill", label: "Illuminant (reference white)", default: "D65", kind: "select", options: ILL_OPTIONS },
    { key: "obs", label: "Observer", default: "2", kind: "select", options: OBS_OPTIONS },
  ],
  compute: (r) => {
    const from = r("from");
    const ill = readIll(r("ill"));
    const obs = readObs(r("obs"));
    const W = whitePoint(ill, obs);
    const raw = r("val") ?? "";
    const notes: string[] = [];
    let XYZ: Vec3;
    if (from === "hex") {
      const h = parseHex(raw);
      if (!h) return refuse(`"${raw.trim()}" is not a hex colour. Write six hex digits, #RRGGBB (for example #B8573F), or three (#F80).`);
      XYZ = srgbToXYZ(h.map((c) => c / 255) as Vec3, W);
    } else {
      const names: Record<string, string> = { lab: "L*, a*, b*", lch: "L*, C*ab, hab", xyz: "X, Y, Z", xyy: "x, y, Y", luv: "L*, u*, v*", srgb: "R, G, B (0–255)" };
      if (!(from in names)) return refuse("Choose an input space.");
      const v = three(raw, "Values", names[from]);
      if (typeof v === "string") return refuse(v);
      if (from === "lab" || from === "lch") {
        const lab = readLab(raw, from, "Values");
        if (typeof lab === "string") return refuse(lab);
        XYZ = labToXYZ(lab, W);
      } else if (from === "xyz") {
        if (v.some((x) => x < 0)) return refuse(`XYZ: ${v.map((x) => fx(x, 4)).join(", ")} has a negative value. Tristimulus values are 0 or more.`);
        if (v[1] > 200) return refuse(`XYZ: Y = ${fx(v[1])} is above 200. Give XYZ on the 0–100 scale (the perfect white has Y = 100).`);
        if (v[0] + v[1] + v[2] === 0) return refuse("XYZ: 0, 0, 0 is black, which has no chromaticity.");
        if (v[1] <= 1 && v[0] <= 1.2 && v[2] <= 1.2) notes.push("All three values are 1 or less: if they are on the 0–1 scale, multiply by 100 (this tool reads Y = 100 as the white).");
        XYZ = v;
      } else if (from === "xyy") {
        if (!(v[0] > 0 && v[1] > 0 && v[0] + v[1] < 1)) return refuse(`xyY: (x, y) = (${fx(v[0], 4)}, ${fx(v[1], 4)}) is not a chromaticity: x and y must be positive with x + y < 1.`);
        if (v[2] < 0 || v[2] > 200) return refuse(`xyY: Y = ${fx(v[2])} must be between 0 and 200 (the perfect white has Y = 100).`);
        XYZ = xyToXYZ(v[0], v[1], v[2]);
      } else if (from === "luv") {
        if (v[0] < 0 || v[0] > 110) return refuse(`L*u*v*: L* = ${fx(v[0])} is outside 0–110.`);
        if (Math.abs(v[1]) > 300 || Math.abs(v[2]) > 300) return refuse(`L*u*v*: u* = ${fx(v[1])}, v* = ${fx(v[2])} is outside ±300, beyond any real colour.`);
        if (v[0] === 0 && (v[1] !== 0 || v[2] !== 0)) return refuse("L*u*v*: at L* = 0 (black) u* and v* must be 0.");
        XYZ = luvToXYZ({ L: v[0], u: v[1], v: v[2] }, W);
        if (XYZ.some((x) => x < 0)) return refuse("L*u*v*: these values give a negative tristimulus value: they are outside the colours that exist (the spectral locus).");
      } else {
        if (v.some((x) => x < 0 || x > 255)) return refuse(`sRGB: each channel must be 0–255 (got ${v.map((x) => trimNum(x)).join(", ")}).`);
        XYZ = srgbToXYZ(v.map((c) => c / 255) as Vec3, W);
      }
    }
    const lab = XYZToLab(XYZ, W);
    const lch = labToLch(lab);
    const luv = XYZToLuv(XYZ, W);
    const xy = XYZToxy(XYZ);
    const uv = XYZToUpVp(XYZ);
    const rgb = XYZToSrgb(XYZ, W);
    const lines: EngReportLine[] = [];
    const gam = rgb.inGamut ? "inside the sRGB gamut" : "OUTSIDE the sRGB gamut, so a screen shows only its clipped approximation";
    lines.push(`This is a ${lightName(lab.L)}, ${hueName(lch.C, lch.h)} (L* ${fx(lab.L)}, C*ab ${fx(lch.C)}, hab ${fx(lch.h, 1)}°); in sRGB it is ${rgb.hex}, ${gam}.`);
    const wxy = XYZToxy(W) as [number, number];
    lines.push(`Reference white: ${ILLUMINANT_LABELS[ill]}, ${OBSERVER_LABELS[obs]} observer: xy (${fx(wxy[0], 5)}, ${fx(wxy[1], 5)}), XYZ (${fx(W[0], 3)}, 100, ${fx(W[2], 3)}).`);
    const rows: string[][] = [["Space", "Values"]];
    rows.push(["XYZ", `${fx(XYZ[0], 4)}, ${fx(XYZ[1], 4)}, ${fx(XYZ[2], 4)}`]);
    if (xy) rows.push(["xyY", `${fx(xy[0], 5)}, ${fx(xy[1], 5)}, ${fx(XYZ[1], 4)}`]);
    rows.push(["L*a*b*", `${fx(lab.L)}, ${fx(lab.a)}, ${fx(lab.b)}`]);
    rows.push(["L*C*h (ab)", `${fx(lch.L)}, ${fx(lch.C)}, ${fx(lch.h, 2)}°`]);
    rows.push(["L*u*v*", `${fx(luv.L)}, ${fx(luv.u)}, ${fx(luv.v)}`]);
    if (uv) rows.push(["u′v′ (CIE 1976 UCS)", `${fx(uv[0], 5)}, ${fx(uv[1], 5)}`]);
    rows.push(["sRGB (0–255, clipped)", `${rgb.rgb255.join(", ")}`]);
    rows.push(["sRGB hex", rgb.hex]);
    rows.push(["sRGB R′G′B′ unclipped (0–1)", rgb.encoded.map((v) => fx(v, 4)).join(", ")]);
    lines.push({ table: rows, label: "The colour in each space" });
    if (!rgb.inGamut) {
      lines.push(`Out of gamut: the unclipped sRGB values are ${rgb.encoded.map((v) => fx(v * 255, 1)).join(", ")} on the 0–255 scale; ${rgb.hex} is the nearest colour by clipping each channel, which is not the perceptually nearest and shifts the hue.`);
    }
    if (rgb.adapted) lines.push(`sRGB is defined for D65 and the 2° observer, so the colour was adapted from ${condition(ill, obs)} to it by the Bradford transform before encoding (ICC practice); the adaptation is a prediction, not a measurement.`);
    if (xy) {
      const dom = dominantWavelength(xy, wxy, obs);
      if (dom.ok) lines.push(`${dom.purple ? `Complementary wavelength ${Math.abs(dom.wavelength)} nm (a purple: written −${Math.abs(dom.wavelength)} nm)` : `Dominant wavelength ${dom.wavelength} nm`}, excitation purity ${fx(dom.purity * 100, 1)} % (relative to the ${ill} white, ${obs}° locus).`);
    }
    lines.push({ math: 'L^"*" = 116 f(Y/Y_n) - 16', fallback: "L* = 116·f(Y/Yn) − 16, a* = 500·(f(X/Xn) − f(Y/Yn)), b* = 200·(f(Y/Yn) − f(Z/Zn))" });
    lines.push("f(t) = ∛t above ε = 216/24389, and (κt + 16)/116 below it with κ = 24389/27 (the exact CIE constants).");
    lines.push(...notes);
    lines.push(
      `Assumes: the values are relative to the ${ill} white for the ${obs}° observer (white XYZ from the tabulated chromaticity, Y = 100). sRGB uses IEC 61966-2-1's 4-decimal matrices and transfer curve. ` +
        "A conversion changes the coordinates, never the colour; converting between illuminants is chromatic adaptation, a separate calculator.",
    );
    const extra: AnalyzeBlock[] = [];
    if (xy) extra.push(plot(chromaticitySvg(obs, [{ label: "this colour", x: xy[0], y: xy[1] }], { white: { label: `${ill} white`, x: wxy[0], y: wxy[1] } }), `CIE 1931 xy chromaticity diagram (${obs}° locus) with the colour and the ${ill} white`, "The horseshoe-shaped spectral locus with the purple line, the sRGB triangle, the white point and this colour's chromaticity marked"));
    extra.push(plot(abPlaneSvg([{ label: "this colour", lab }]), "The colour in the a*b* plane", "The a* b* plane with the colour's point and its chroma ray from the neutral axis"));
    extra.push(plot(swatchSvg([{ hex: rgb.hex, caption: rgb.inGamut ? "sRGB" : "sRGB (clipped)" }]), `sRGB swatch ${rgb.hex}${rgb.inGamut ? "" : " (clipped: out of gamut)"}`, "A colour patch filled with the sRGB value of the colour, its hex code beneath"));
    const outputs: EngOutput[] = [
      { key: "X", label: "X", value: XYZ[0], unit: "" },
      { key: "Y", label: "Y", value: XYZ[1], unit: "" },
      { key: "Z", label: "Z", value: XYZ[2], unit: "" },
      { key: "L", label: "L*", value: lab.L, unit: "" },
      { key: "a", label: "a*", value: lab.a, unit: "" },
      { key: "b", label: "b*", value: lab.b, unit: "" },
      { key: "C", label: "C*ab", value: lch.C, unit: "" },
      { key: "h", label: "hab", value: lch.h, unit: "°" },
    ];
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Chromatic adaptation
// ---------------------------------------------------------------------------------------------------------------

const CAT_OPTIONS = (Object.keys(CAT_LABELS) as CatMethod[]).map((m) => ({ value: m, label: CAT_LABELS[m] }));

const adaptCalc: ColourCalc = {
  id: "colour-adapt",
  name: "Chromatic adaptation between illuminants: Bradford, von Kries, CAT02, CAT16",
  group: GROUP,
  unitContract: "domain",
  hint:
    "A colour as XYZ or L*a*b* under one illuminant, and the corresponding colour under another: what it must be under the " +
    "new white to look the same to an observer adapted to it (complete adaptation, D = 1). All four transforms are computed " +
    "so their spread is visible; the one chosen is the headline. Typical use: D50 print data (ICC) to D65 display data.",
  fields: [
    { key: "space", label: "Colour entered as", default: "lab", kind: "select", options: [{ value: "lab", label: "L*, a*, b*" }, { value: "xyz", label: "X, Y, Z (Y = 0–100)" }] },
    { key: "val", label: "Values", default: "50.0, 20.0, −30.0", kind: "text" },
    { key: "src", label: "From illuminant", default: "D50", kind: "select", options: ILL_OPTIONS },
    { key: "dst", label: "To illuminant", default: "D65", kind: "select", options: ILL_OPTIONS },
    { key: "obs", label: "Observer", default: "2", kind: "select", options: OBS_OPTIONS },
    { key: "cat", label: "Transform", default: "bradford", kind: "select", options: CAT_OPTIONS },
  ],
  compute: (r) => {
    const space = r("space") === "xyz" ? "xyz" : "lab";
    const src = readIll(r("src"));
    const dst = readIll(r("dst"));
    const obs = readObs(r("obs"));
    const cat = (r("cat") in CAT_LABELS ? r("cat") : "bradford") as CatMethod;
    const Ws = whitePoint(src, obs);
    const Wd = whitePoint(dst, obs);
    let XYZ: Vec3;
    if (space === "lab") {
      const lab = readLab(r("val"), "lab", "Values");
      if (typeof lab === "string") return refuse(lab);
      XYZ = labToXYZ(lab, Ws);
    } else {
      const v = three(r("val"), "Values", "X, Y, Z");
      if (typeof v === "string") return refuse(v);
      if (v.some((x) => x < 0)) return refuse("XYZ: tristimulus values are 0 or more.");
      if (v[1] > 200) return refuse(`XYZ: Y = ${fx(v[1])} is above 200. Give XYZ on the 0–100 scale (the perfect white has Y = 100).`);
      XYZ = v;
    }
    const labIn = XYZToLab(XYZ, Ws);
    const methods = Object.keys(CAT_LABELS) as CatMethod[];
    const res = methods.map((m) => {
      const X = adaptXYZ(XYZ, Ws, Wd, m);
      return { m, X, lab: XYZToLab(X, Wd) };
    });
    const chosen = res.find((x) => x.m === cat)!;
    const spread = Math.max(...res.map((x) => deltaE("de00", chosen.lab, x.lab)));
    const lines: EngReportLine[] = [];
    if (src === dst) {
      lines.push(`The two illuminants are the same (${src}), so the colour is unchanged: L* ${fx(labIn.L)}, a* ${fx(labIn.a)}, b* ${fx(labIn.b)}.`);
    } else {
      lines.push(`Under ${dst} this colour corresponds to L* ${fx(chosen.lab.L)}, a* ${fx(chosen.lab.a)}, b* ${fx(chosen.lab.b)} by ${CAT_LABELS[cat]}; the four transforms agree to within ΔE₀₀ ${fx(spread)}.`);
    }
    lines.push(`Adapting from ${ILLUMINANT_LABELS[src]} to ${ILLUMINANT_LABELS[dst]}, ${OBSERVER_LABELS[obs]} observer; input L*a*b* (${src}) ${fx(labIn.L)}, ${fx(labIn.a)}, ${fx(labIn.b)}, XYZ ${XYZ.map((v) => fx(v, 4)).join(", ")}.`);
    lines.push({
      table: [
        ["Transform", "X, Y, Z", `L*, a*, b* (${dst})`, "ΔE₀₀ from the chosen"],
        ...res.map((x) => [CAT_LABELS[x.m] + (x.m === cat ? " (chosen)" : ""), x.X.map((v) => fx(v, 4)).join(", "), `${fx(x.lab.L)}, ${fx(x.lab.a)}, ${fx(x.lab.b)}`, fx(deltaE("de00", chosen.lab, x.lab))]),
      ],
      label: `Corresponding colour under ${dst}`,
    });
    lines.push({ math: "XYZ_d = M^(-1) D M XYZ_s", fallback: "XYZd = M⁻¹·D·M·XYZs, D = diag(ρd/ρs, γd/γs, βd/βs) from the two whites' cone responses" });
    lines.push(
      "Assumes complete adaptation (D = 1) and the von Kries form: each cone-like channel is scaled by the ratio of the two whites. This predicts the corresponding colour, i.e. how the eye discounts the light; " +
        "it is NOT what the sample measures under the other illuminant. For that, measure its spectrum and compute under the new illuminant (Spectral reflectance to colour): two samples that match under one light can stop matching under another (metamerism), and no adaptation transform shows it.",
    );
    const sxy = XYZToxy(XYZ);
    const dxy = XYZToxy(chosen.X);
    const ws = XYZToxy(Ws)!;
    const wd = XYZToxy(Wd)!;
    const extra: AnalyzeBlock[] = [];
    if (sxy && dxy) {
      extra.push(
        plot(
          chromaticitySvg(obs, [
            { label: `${src} white`, x: ws[0], y: ws[1], colour: "#888888" },
            { label: `${dst} white`, x: wd[0], y: wd[1], colour: "#000000" },
            { label: `under ${src}`, x: sxy[0], y: sxy[1], colour: "#1f5fa8" },
            { label: `under ${dst}`, x: dxy[0], y: dxy[1], colour: "#c00000" },
          ]),
          `The two whites and the colour before and after adaptation (${CAT_LABELS[cat]})`,
          "The CIE 1931 chromaticity diagram with both white points, the colour under the source illuminant and its corresponding colour under the destination illuminant",
        ),
      );
    }
    extra.push(plot(abPlaneSvg(res.map((x) => ({ label: CAT_LABELS[x.m].split(" (")[0], lab: x.lab }))), `The corresponding colour under ${dst} by each transform, in the a*b* plane`, "The a* b* plane with the adapted colour by each of the four transforms, showing how far they disagree"));
    const outputs: EngOutput[] = [
      { key: "L", label: `L* under ${dst}`, value: chosen.lab.L, unit: "" },
      { key: "a", label: `a* under ${dst}`, value: chosen.lab.a, unit: "" },
      { key: "b", label: `b* under ${dst}`, value: chosen.lab.b, unit: "" },
      { key: "X", label: "X", value: chosen.X[0], unit: "" },
      { key: "Y", label: "Y", value: chosen.X[1], unit: "" },
      { key: "Z", label: "Z", value: chosen.X[2], unit: "" },
      { key: "spread", label: "Spread between transforms (ΔE₀₀)", value: spread, unit: "" },
    ];
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Spectral reflectance to colour
// ---------------------------------------------------------------------------------------------------------------

const spectralCalc: ColourCalc = {
  id: "colour-spectral",
  name: "Spectral reflectance or transmittance to colour: XYZ, L*a*b*, dominant wavelength",
  group: GROUP,
  unitContract: "domain",
  hint:
    "A measured spectrum, one row per wavelength (nm) and value, at a uniform 1, 5, 10 or 20 nm step covering at least 400–700 nm. " +
    "Computed by ASTM E308 (10 and 20 nm data with E2022 weighting factors built from the 1 nm CIE tables; 1 and 5 nm data by " +
    "summation) or by CIE 15 integration at 1 nm. Gives XYZ, xyY, L*a*b*, L*C*h, u′v′, an sRGB swatch, the dominant wavelength " +
    "and the excitation purity. Default: the ColorChecker orange patch (BabelColor average).",
  fields: [
    { key: "data", label: "Spectrum: wavelength (nm) and value, one row each", default: block(ORANGE), kind: "block", rows: 8 },
    { key: "units", label: "Values are", default: "fraction", kind: "select", options: UNITS_OPTIONS },
    { key: "kind", label: "Quantity", default: "reflectance", kind: "select", options: [{ value: "reflectance", label: "Reflectance" }, { value: "transmittance", label: "Transmittance" }] },
    { key: "ill", label: "Illuminant", default: "D65", kind: "select", options: ILL_OPTIONS },
    { key: "obs", label: "Observer", default: "10", kind: "select", options: OBS_OPTIONS },
    { key: "method", label: "Method", default: "astm-e308", kind: "select", options: METHOD_OPTIONS },
  ],
  compute: (r) => {
    const sp = readSpectrum(r("data"), r("units"), "Spectrum");
    if (typeof sp === "string") return refuse(sp);
    const ill = readIll(r("ill"));
    const obs = readObs(r("obs"));
    const method = readMethod(r("method"));
    const kind = r("kind") === "transmittance" ? "transmittance" : "reflectance";
    const res = spectralXYZ(sp.spec, ill, obs, method, "Spectrum");
    if (typeof res === "string") return refuse(res);
    const lab = XYZToLab(res.XYZ, res.white);
    const lch = labToLch(lab);
    const xy = XYZToxy(res.XYZ)!;
    const wxy = XYZToxy(res.white)!;
    const uv = XYZToUpVp(res.XYZ)!;
    const rgb = XYZToSrgb(res.XYZ, res.white);
    const dom = dominantWavelength(xy, wxy, obs);
    const lines: EngReportLine[] = [];
    const domText = dom.ok ? (dom.purple ? `, a purple (complementary wavelength ${Math.abs(dom.wavelength)} nm) at ${fx(dom.purity * 100, 0)} % purity` : `, dominant wavelength ${dom.wavelength} nm at ${fx(dom.purity * 100, 0)} % purity`) : ", achromatic";
    lines.push(`Under ${condition(ill, obs)} this ${kind === "reflectance" ? "sample" : "filter"} is a ${lightName(lab.L)}, ${hueName(lch.C, lch.h)}: L* ${fx(lab.L)}, C*ab ${fx(lch.C)}, hab ${fx(lch.h, 1)}°${domText}.`);
    lines.push(`Method: ${res.path}`);
    lines.push({
      table: [
        ["Quantity", "Value"],
        ["X, Y, Z", res.XYZ.map((v) => fx(v, 4)).join(", ")],
        [`White (perfect ${kind === "reflectance" ? "diffuser" : "transmitter"}) Xn, Yn, Zn`, res.white.map((v) => fx(v, 4)).join(", ")],
        ["x, y", `${fx(xy[0], 5)}, ${fx(xy[1], 5)}`],
        ["u′, v′", `${fx(uv[0], 5)}, ${fx(uv[1], 5)}`],
        ["L*, a*, b*", `${fx(lab.L)}, ${fx(lab.a)}, ${fx(lab.b)}`],
        ["L*, C*ab, hab", `${fx(lch.L)}, ${fx(lch.C)}, ${fx(lch.h, 2)}°`],
        [dom.ok && dom.purple ? "Complementary wavelength" : "Dominant wavelength", dom.ok ? `${dom.purple ? "−" : ""}${Math.abs(dom.wavelength)} nm` : "none (achromatic)"],
        ["Excitation purity", dom.ok ? `${fx(dom.purity * 100, 1)} %` : "0 %"],
        ["sRGB (Bradford-adapted to D65 2°)", `${rgb.hex}${rgb.inGamut ? "" : " (out of gamut, clipped)"}`],
      ],
      label: `Colour of the spectrum under ${condition(ill, obs)}`,
    });
    lines.push({ math: "X = k sum(S(λ) R(λ) x̄(λ) Delta λ)", fallback: "X = k·Σ S(λ)·R(λ)·x̄(λ)·Δλ (and Y, Z with ȳ, z̄), k = 100/Σ S(λ)·ȳ(λ)·Δλ" });
    if (Math.abs(lab.L - 100) < 0.005 && Math.abs(lab.a) < 0.005 && Math.abs(lab.b) < 0.005) lines.push("This is the perfect white for the method: Y = 100 and L*a*b* = (100, 0, 0) by construction.");
    if (dom.ok) lines.push(`Dominant wavelength: the line from the white (${fx(wxy[0], 4)}, ${fx(wxy[1], 4)}) through the colour meets ${dom.purple ? "the purple line, so the colour has no dominant wavelength; the complementary wavelength (the opposite side of the locus) is given, written negative by CIE convention" : "the spectral locus"}; reported as the nearest whole nanometre of the 360–780 nm locus.`);
    lines.push(...res.notes, ...sp.notes);
    lines.push(`Assumes: ${SPECTRAL_ASSUMES}`);
    const extra: AnalyzeBlock[] = [
      plot(spectrumSvg([{ label: kind === "reflectance" ? "R(λ)" : "T(λ)", wl: sp.spec.wl, v: sp.spec.v }], kind === "reflectance" ? "Reflectance factor" : "Transmittance factor"), `The measured ${kind} spectrum`, `The ${kind} factor against wavelength in nanometres`),
      plot(chromaticitySvg(obs, [{ label: "sample", x: xy[0], y: xy[1] }], { white: { label: `${ill} white`, x: wxy[0], y: wxy[1] }, dominant: dom.ok ? { to: dom.xyBoundary } : undefined }), `Chromaticity on the CIE 1931 diagram (${obs}° locus), with the dominant-wavelength line`, "The spectral locus with the white point, the sample's chromaticity and the line from the white through the sample to the locus"),
      plot(swatchSvg([{ hex: rgb.hex, caption: rgb.inGamut ? `sRGB, ${condition(ill, obs)}` : "sRGB (clipped)" }]), `sRGB swatch ${rgb.hex}`, "A patch filled with the sample's sRGB colour, its hex code beneath"),
    ];
    const outputs: EngOutput[] = [
      { key: "X", label: "X", value: res.XYZ[0], unit: "" },
      { key: "Y", label: "Y", value: res.XYZ[1], unit: "" },
      { key: "Z", label: "Z", value: res.XYZ[2], unit: "" },
      { key: "L", label: "L*", value: lab.L, unit: "" },
      { key: "a", label: "a*", value: lab.a, unit: "" },
      { key: "b", label: "b*", value: lab.b, unit: "" },
      { key: "x", label: "x", value: xy[0], unit: "" },
      { key: "y", label: "y", value: xy[1], unit: "" },
    ];
    if (dom.ok) outputs.push({ key: "purity", label: "Excitation purity", value: dom.purity, unit: "" }, { key: "domwl", label: dom.purple ? "Complementary wavelength (negative)" : "Dominant wavelength", value: dom.wavelength, unit: "nm" });
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Metamerism index
// ---------------------------------------------------------------------------------------------------------------

const metamerismCalc: ColourCalc = {
  id: "colour-metamerism",
  name: "Metamerism index: a match under one illuminant, tested under others",
  group: GROUP,
  unitContract: "domain",
  hint:
    "Two spectra (standard and sample) that match, or nearly match, under a reference illuminant. Gives ΔE under the reference " +
    "and, for each test illuminant, the CIE special metamerism index for a change of illuminant (CIE 15, ISO 18314-4): ΔE under " +
    "the test illuminant after correcting for the residual mismatch under the reference (additive in L*a*b* by default). " +
    "Default: a ColorChecker grey and a synthetic metamer of it that matches under D65/10°.",
  fields: [
    { key: "std", label: "Standard spectrum: nm and value per row", default: block(NEUTRAL5), kind: "block", rows: 6 },
    { key: "smp", label: "Sample spectrum: nm and value per row", default: block(METAMER), kind: "block", rows: 6 },
    { key: "units", label: "Values are", default: "fraction", kind: "select", options: UNITS_OPTIONS },
    { key: "ref", label: "Reference illuminant (the match)", default: "D65", kind: "select", options: ILL_OPTIONS },
    { key: "tests", label: "Test illuminants (comma-separated)", default: "A, F11, F2", kind: "text" },
    { key: "obs", label: "Observer", default: "10", kind: "select", options: OBS_OPTIONS },
    { key: "tolf", label: "ΔE formula", default: "de00", kind: "select", options: FORMULA_OPTIONS },
    { key: "corr", label: "Correction for an inexact match", default: "additive", kind: "select", options: [{ value: "additive", label: "Additive, in L*a*b* (CIE / ISO 18314-4)" }, { value: "multiplicative", label: "Multiplicative, in XYZ" }, { value: "none", label: "None (raw ΔE under each test illuminant)" }] },
  ],
  compute: (r) => {
    const a = readSpectrum(r("std"), r("units"), "Standard spectrum");
    if (typeof a === "string") return refuse(a);
    const b = readSpectrum(r("smp"), r("units"), "Sample spectrum");
    if (typeof b === "string") return refuse(b);
    const ref = readIll(r("ref"));
    const obs = readObs(r("obs"));
    const f = readFormula(r("tolf"));
    const corr = (["additive", "multiplicative", "none"].includes(r("corr")) ? r("corr") : "additive") as MetamerismCorrection;
    const testRaw = (r("tests") ?? "").split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!testRaw.length) return refuse("Test illuminants: name at least one (for example A, F11).");
    const tests: IlluminantId[] = [];
    for (const t of testRaw) {
      const id = t === "FL2" ? "F2" : t === "FL7" ? "F7" : t === "FL11" ? "F11" : t;
      if (!isIlluminant(id)) return refuse(`Test illuminants: "${t}" is not one of ${ILLUMINANTS.join(", ")}.`);
      if (id === ref) return refuse(`Test illuminants: ${id} is the reference illuminant; a test illuminant must differ from it.`);
      if (!tests.includes(id)) tests.push(id);
    }
    const method: SpectralMethod = "astm-e308";
    const sr = spectralXYZ(a.spec, ref, obs, method, "Standard spectrum");
    if (typeof sr === "string") return refuse(sr);
    const pr = spectralXYZ(b.spec, ref, obs, method, "Sample spectrum");
    if (typeof pr === "string") return refuse(pr);
    if (corr === "multiplicative" && pr.XYZ.some((v) => !(v > 0))) return refuse("The multiplicative correction divides by the sample's XYZ under the reference, and one of them is 0.");
    const labSr = XYZToLab(sr.XYZ, sr.white);
    const labPr = XYZToLab(pr.XYZ, pr.white);
    const refDE = deltaE(f, labSr, labPr);
    const rows = tests.map((t) => {
      const st = spectralXYZ(a.spec, t, obs, method, "Standard spectrum") as SpectralXYZ;
      const pt = spectralXYZ(b.spec, t, obs, method, "Sample spectrum") as SpectralXYZ;
      return { t, raw: metamerismIndex(f, "none", sr, pr, st, pt), mi: metamerismIndex(f, corr, sr, pr, st, pt) };
    });
    const worst = rows.reduce((m, x) => (x.mi > m.mi ? x : m));
    const sym = DE_SYMBOL[f];
    const lines: EngReportLine[] = [];
    const matchWord = refDE < 0.5 ? "match" : refDE < 1 ? "nearly match" : "do not match well";
    const mWord = worst.mi < 0.5 ? "the match holds under every test illuminant" : `the match breaks down, worst under ${worst.t} (index ${fx(worst.mi)}), so the pair is metameric`;
    lines.push(`The two ${matchWord} under ${ref} (${sym} ${fx(refDE)}), and ${mWord}.`);
    if (refDE >= 1) lines.push(`Under the reference the pair already differs by ${sym} ${fx(refDE)}: a metamerism index is meaningful for a match or near match (CIE 15 suggests correcting only small residuals); treat these numbers with care.`);
    lines.push({
      table: [
        ["Illuminant", `${sym} raw`, `Metamerism index (${corr === "none" ? "uncorrected" : corr})`],
        [`${ref} (reference)`, fx(refDE), "the match"],
        ...rows.map((x) => [x.t, fx(x.raw), fx(x.mi)]),
      ],
      label: `${sym} under each illuminant, ${obs}° observer`,
    });
    lines.push(
      corr === "additive"
        ? "Index: ΔE under the test illuminant between the standard and the sample corrected by the reference mismatch, L*a*b*(sample, test) − (L*a*b*(sample, ref) − L*a*b*(standard, ref)) (CIE 15; ISO 18314-4)."
        : corr === "multiplicative"
          ? "Index: ΔE under the test illuminant after scaling the sample's XYZ by XYZ(standard, ref)/XYZ(sample, ref) (ISO 18314-4's multiplicative correction)."
          : "Index: the raw ΔE under each test illuminant, with no correction for the residual mismatch under the reference.",
    );
    if (corr === "additive") lines.push({ math: "M = Delta E(S_t, P_t - (P_r - S_r))", fallback: "M = ΔE(St, Pt − (Pr − Sr)): S the standard's and P the sample's L*a*b*, t under the test and r under the reference illuminant" });
    lines.push(FORMULA_EQ[f]);
    lines.push(`Computed by ASTM E308 (as the Spectral reflectance calculator does) under each illuminant, ${OBSERVER_LABELS[obs]} observer, ${DE_FORMULA_LABELS[f]}. ${a.spec.wl.length !== b.spec.wl.length || a.spec.wl[0] !== b.spec.wl[0] ? "The two spectra are on different wavelength grids; each was computed on its own." : ""}`.trim());
    lines.push(...a.notes, ...b.notes);
    lines.push(
      "Assumes both spectra were measured on the same instrument and geometry. The index measures sensitivity to a change of illuminant only; a change of observer (observer metamerism) is not computed. " +
        "CIE 15 recommends reporting the test illuminants used: A for incandescent light and F2/F11 for fluorescent are the usual set.",
    );
    const extra: AnalyzeBlock[] = [
      plot(spectrumSvg([{ label: "standard", wl: a.spec.wl, v: a.spec.v }, { label: "sample", wl: b.spec.wl, v: b.spec.v }]), "The two reflectance spectra", "Reflectance against wavelength for the standard and the sample; metameric spectra cross each other several times"),
      plot(barsSvg([`${ref} (ref.)`, ...rows.map((x) => x.t)], [refDE, ...rows.map((x) => x.mi)], `${sym} / metamerism index`, sym), `${sym} under the reference and the metamerism index under each test illuminant`, "Bars giving the colour difference under the reference illuminant and the metamerism index under each test illuminant"),
    ];
    const outputs: EngOutput[] = [{ key: "ref", label: `${sym} under ${ref}`, value: refDE, unit: "" }, ...rows.map((x) => ({ key: `mi${x.t}`, label: `Metamerism index, ${x.t}`, value: x.mi, unit: "" }))];
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Batch colour QC
// ---------------------------------------------------------------------------------------------------------------

const BATCH_DEFAULT = ["B1 45.30, 51.60, 28.40", "B2 44.80, 52.40, 27.70", "B3 45.90, 50.10, 29.30", "B4 44.20, 53.30, 26.90", "B5 46.70, 48.90, 30.80", "B6 45.10, 51.90, 28.10", "B7 43.40, 49.20, 25.60", "B8 45.60, 52.80, 28.90"].join("\n");

const batchCalc: ColourCalc = {
  id: "colour-batch",
  name: "Batch colour QC: samples against a standard and a ΔE tolerance",
  group: GROUP,
  unitContract: "domain",
  hint:
    "A standard and a block of samples, one per row as L*, a*, b* with an optional name first (B1 45.3, 51.6, 28.4). Gives a " +
    "pass/fail table on the chosen formula and tolerance, the worst sample, the mean and maximum ΔE, and the direction of each " +
    "miss. Figures: the samples in the a*b* plane inside the tolerance region, and ΔL* per sample.",
  fields: [
    { key: "std", label: "Standard: L*, a*, b*", default: "45.00, 52.00, 28.00", kind: "text" },
    { key: "data", label: "Samples: optional name, then L*, a*, b* (one per row)", default: BATCH_DEFAULT, kind: "block", rows: 8 },
    { key: "tolf", label: "Tolerance formula", default: "de00", kind: "select", options: FORMULA_OPTIONS },
    { key: "op", label: "Tolerance test", default: "<", kind: "select", options: OP_OPTIONS },
    { key: "tol", label: "Tolerance ΔE", default: "2", kind: "text" },
    { key: "k", label: "CIEDE2000 parametric factors kL:kC:kH", default: "1:1:1", kind: "text" },
    { key: "ill", label: "Illuminant", default: "D65", kind: "select", options: ILL_OPTIONS },
    { key: "obs", label: "Observer", default: "10", kind: "select", options: OBS_OPTIONS },
    { key: "geom", label: "Measuring geometry", default: "d8i", kind: "select", options: GEOM_OPTIONS },
  ],
  compute: (r) => {
    const std = readLab(r("std"), "lab", "Standard");
    if (typeof std === "string") return refuse(std);
    const tol = readTol(r("tol"), true);
    if (typeof tol === "string") return refuse(tol);
    const T = tol as number;
    const k = readK(r("k"));
    if (typeof k === "string") return refuse(k);
    const f = readFormula(r("tolf"));
    const op = r("op") === "≤" ? "≤" : "<";
    const ill = readIll(r("ill"));
    const obs = readObs(r("obs"));
    const geom = GEOM_SHORT[r("geom")] ? r("geom") : "none";
    const rowsIn = (r("data") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!rowsIn.length) return refuse("Samples: the block is empty. Give one sample per row: an optional name, then L*, a*, b*.");
    if (rowsIn.length > 500) return refuse(`Samples: ${rowsIn.length} rows; at most 500 are checked at once.`);
    const samples: Array<{ name: string; lab: Lab }> = [];
    for (let i = 0; i < rowsIn.length; i++) {
      const m = /^(?:(.*?\S)[\s,;:]+)?([-+−–]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[\s,;]+[-+−–]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[\s,;]+[-+−–]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$/.exec(rowsIn[i]);
      if (!m) return refuse(`Samples, row ${i + 1} ("${rowsIn[i]}"): end the row with three numbers, L*, a*, b* (a name may come first).`);
      const nameRaw = m[1] ?? "";
      const name = nameRaw.replace(/[,;:]+$/, "").trim() || `#${i + 1}`;
      if (numbersIn(nameRaw) !== null && nameRaw.trim() !== "") return refuse(`Samples, row ${i + 1} ("${rowsIn[i]}"): more than three numbers. Give an optional name, then L*, a*, b*.`);
      const lab = readLab(m[2], "lab", `Samples, row ${i + 1} (${name})`);
      if (typeof lab === "string") return refuse(lab);
      samples.push({ name, lab });
    }
    const sym = DE_SYMBOL[f];
    const res = samples.map((s) => {
      const de = deltaE(f, std, s.lab, k);
      const v = verdict(de, T, op);
      return { ...s, d: diffComponents(std, s.lab), de, pass: v.pass, borderline: v.borderline, shown: v.shown };
    });
    const nPass = res.filter((x) => x.pass).length;
    const worst = res.reduce((m, x) => (x.de > m.de ? x : m));
    const mean = res.reduce((s, x) => s + x.de, 0) / res.length;
    const lines: EngReportLine[] = [];
    const ww = directionWords(worst.d);
    const worstDir = joinWords([ww.lightness, ww.chroma, ww.hue]);
    lines.push(`${nPass} of ${res.length} samples pass ${sym} ${op} ${trimNum(T)}; the worst is ${worst.name} (${sym} ${fx(worst.de)}${worstDir ? `, ${worstDir}` : ""}), and the mean is ${fx(mean)}.`);
    lines.push(`Tolerance: ${sym} ${op} ${trimNum(T)} (${f === "de00" ? `CIEDE2000, kL:kC:kH = ${kText(k)}` : DE_FORMULA_LABELS[f]}; ${condition(ill, obs)}; ${GEOM_SHORT[geom]}).`);
    lines.push(FORMULA_EQ[f]);
    if (geom === "none") lines.push("The measuring geometry is not stated; a tolerance without it cannot be checked by anyone else. Record it.");
    lines.push({
      table: [
        ["Sample", "ΔL*", "Δa*", "Δb*", "ΔC*ab", "ΔH*ab", sym, "Result"],
        ...res.map((x) => [x.name, sg(x.d.dL), sg(x.d.da), sg(x.d.db), sg(x.d.dC), x.d.hueDefined ? sg(x.d.dH) : "0.00", x.shown, x.pass ? "pass" : "FAIL"]),
      ],
      label: `Samples against the standard (${fx(std.L)}, ${fx(std.a)}, ${fx(std.b)})`,
    });
    const fails = res.filter((x) => !x.pass);
    if (fails.length) lines.push(`Failing: ${fails.map((x) => `${x.name} (${joinWords(directionWords(x.d).axes.slice(0, 3)) || "no single direction"})`).join("; ")}.`);
    const bl = res.filter((x) => x.borderline);
    if (bl.length) lines.push(`Borderline (the two-decimal value ties the tolerance; shown to four decimals): ${bl.map((x) => x.name).join(", ")}. The verdict is on the unrounded value.`);
    lines.push(`Mean ${sym} ${fx(mean)}, maximum ${fx(worst.de)}, minimum ${fx(Math.min(...res.map((x) => x.de)))}; mean ΔL* ${sg(res.reduce((s, x) => s + x.d.dL, 0) / res.length)} (a consistent sign means a systematic lightness offset in the process).`);
    lines.push("Assumes every sample and the standard were measured on one instrument, geometry and illuminant/observer. The formulas weigh chroma and hue differently, so a batch can pass on one and fail on another; the specification must name its formula.");
    const extra: AnalyzeBlock[] = [
      plot(abZoomSvg(std, res.map((x) => ({ label: x.name, lab: x.lab, pass: x.pass })), f, T, k), `Samples in the a*b* plane inside the ${sym} = ${trimNum(T)} region (at the standard's L*), ΔE*ab circle for comparison`, "A close-up of the a* b* plane: the standard, the tolerance contour of the chosen formula, the CIE76 circle in grey, passing samples in blue and failing samples in red"),
      plot(deltaLBarsSvg(res.map((x) => x.name), res.map((x) => x.d.dL)), "ΔL* of each sample (lightness offset from the standard)", "Bars giving each sample's lightness difference from the standard, above zero lighter and below darker"),
    ];
    const outputs: EngOutput[] = [
      { key: "pass", label: "Samples passing", value: nPass, unit: "" },
      { key: "n", label: "Samples", value: res.length, unit: "" },
      { key: "mean", label: `Mean ${sym}`, value: mean, unit: "" },
      { key: "max", label: `Maximum ${sym}`, value: worst.de, unit: "" },
    ];
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 7. Whiteness, tint and yellowness
// ---------------------------------------------------------------------------------------------------------------

const whitenessCalc: ColourCalc = {
  id: "colour-whiteness",
  name: "Whiteness, tint and yellowness: CIE W and T, ASTM E313 and D1925 YI",
  group: GROUP,
  unitContract: "domain",
  hint:
    "A near-white sample as XYZ, L*a*b* or a reflectance spectrum. Gives CIE whiteness W and tint T (D65, either observer, with " +
    "CIE 15's validity limits checked), the ASTM E313 yellowness index (illuminant C or D65, 2° or 10°, E313's coefficients) and " +
    "the withdrawn ASTM D1925 index (C/2° only). A spectrum is computed under both C and D65, so every index is available.",
  fields: [
    { key: "input", label: "Input", default: "xyz", kind: "select", options: [{ value: "xyz", label: "X, Y, Z (Y = 0–100)" }, { value: "lab", label: "L*, a*, b*" }, { value: "spectrum", label: "Reflectance spectrum (below)" }] },
    { key: "val", label: "X, Y, Z or L*, a*, b*", default: "93.0, 98.0, 115.0", kind: "text" },
    { key: "ill", label: "Illuminant of the XYZ or L*a*b*", default: "D65", kind: "select", options: [{ value: "D65", label: ILLUMINANT_LABELS.D65 }, { value: "C", label: ILLUMINANT_LABELS.C }] },
    { key: "obs", label: "Observer", default: "10", kind: "select", options: OBS_OPTIONS },
    { key: "data", label: "Spectrum (when the input is a spectrum): nm and value per row", default: "", kind: "block", rows: 4 },
    { key: "units", label: "Spectrum values are", default: "fraction", kind: "select", options: UNITS_OPTIONS },
  ],
  compute: (r) => {
    const input = r("input");
    const obs = readObs(r("obs"));
    const byIll: Partial<Record<"C" | "D65", { XYZ: Vec3; white: Vec3 }>> = {};
    const notes: string[] = [];
    let spec: Spectrum | null = null;
    if (input === "spectrum") {
      const sp = readSpectrum(r("data"), r("units"), "Spectrum");
      if (typeof sp === "string") return refuse(sp);
      spec = sp.spec;
      notes.push(...sp.notes);
      for (const il of ["D65", "C"] as const) {
        const x = spectralXYZ(sp.spec, il, obs, "astm-e308", "Spectrum");
        if (typeof x === "string") return refuse(x);
        byIll[il] = { XYZ: x.XYZ, white: x.white };
      }
    } else {
      const ill = r("ill") === "C" ? "C" : "D65";
      const W = whitePoint(ill, obs);
      if (input === "lab") {
        const lab = readLab(r("val"), "lab", "L*a*b*");
        if (typeof lab === "string") return refuse(lab);
        byIll[ill] = { XYZ: labToXYZ(lab, W), white: W };
      } else {
        const v = three(r("val"), "XYZ", "X, Y, Z");
        if (typeof v === "string") return refuse(v);
        if (v.some((x) => x < 0)) return refuse("XYZ: tristimulus values are 0 or more.");
        if (!(v[1] > 0)) return refuse("XYZ: Y must be above 0 (the indices divide by it).");
        if (v[1] > 200) return refuse(`XYZ: Y = ${fx(v[1])} is above 200. Give XYZ on the 0–100 scale.`);
        if (v[1] <= 1.5) notes.push("Y is 1.5 or less: if the values are on the 0–1 scale, multiply them by 100 (the indices assume Y = 100 for the perfect white).");
        byIll[ill] = { XYZ: v, white: W };
      }
    }
    const d65 = byIll.D65;
    const c = byIll.C;
    const wt = d65 ? cieWhiteness(d65.XYZ, XYZToxy(d65.white) as [number, number], obs) : null;
    const yiD65 = d65 ? yellownessE313(d65.XYZ, "D65", obs) : null;
    const yiC = c ? yellownessE313(c.XYZ, "C", obs) : null;
    const yi1925 = c && obs === "2" ? yellownessD1925(c.XYZ) : null;
    const lines: EngReportLine[] = [];
    const yi = yiD65 ?? yiC ?? 0;
    const yiWord = yi < -1 ? "bluish (negative yellowness)" : yi < 2 ? "neutral" : yi < 8 ? "slightly yellowish" : "distinctly yellow";
    if (wt) {
      const tintWord = Math.abs(wt.T) < 0.5 ? "no visible tint" : wt.T > 0 ? "a greenish tint" : "a reddish tint";
      const level = wt.W > 130 ? "a very white, optically brightened" : wt.W > 100 ? "a bright" : wt.W > 70 ? "an ordinary" : "a dull";
      lines.push(`CIE whiteness W ${fx(wt.W, 1)} with ${tintWord} (T ${sg(wt.T, 2)}): ${level} white${wt.inRange ? "" : ", but OUTSIDE the range where the formula is valid"}; yellowness YI ${fx(yi, 2)} reads ${yiWord}.`);
    } else {
      lines.push(`Yellowness YI E313 (C/${obs}°) ${fx(yi, 2)} reads ${yiWord}; CIE whiteness needs D65 data and is not computed from illuminant C values.`);
    }
    const rows: string[][] = [["Index", "Value", "Conditions"]];
    if (wt) {
      rows.push(["CIE whiteness W", fx(wt.W, 2), `D65/${obs}°`]);
      rows.push([`CIE tint T${obs === "10" ? "₁₀" : ""}`, sg(wt.T, 2), `D65/${obs}° (+ greenish, − reddish)`]);
    }
    if (yiD65 !== null) rows.push(["Yellowness YI (ASTM E313)", fx(yiD65, 2), `D65/${obs}°`]);
    if (yiC !== null) rows.push(["Yellowness YI (ASTM E313)", fx(yiC, 2), `C/${obs}°`]);
    if (yi1925 !== null) rows.push(["Yellowness YI (ASTM D1925, withdrawn)", fx(yi1925, 2), "C/2°"]);
    lines.push({ table: rows, label: "Whiteness and yellowness" });
    lines.push({ math: "W = Y + 800 (x_n - x) + 1700 (y_n - y)", fallback: "W = Y + 800(xn − x) + 1700(yn − y)" });
    lines.push({ math: `T = ${obs === "2" ? "1000" : "900"} (x_n - x) - 650 (y_n - y)`, fallback: `T = ${obs === "2" ? "1000" : "900"}(xn − x) − 650(yn − y) (1000 for 2°, 900 for 10°)` });
    lines.push({ math: "YI = 100 (C_X X - C_Z Z)/Y", fallback: "YI = 100(CX·X − CZ·Z)/Y (ASTM E313; D1925: CX = 1.28, CZ = 1.06)" });
    if (wt && !wt.inRange) lines.push(`Outside CIE 15's limits for the whiteness formula (40 < W < 5Y − 280, −4 < T < +2): ${wt.outOfRange.join("; ")}. The formula is defined for samples that look white; for this one, quote L*a*b* or YI instead.`);
    if (!d65) lines.push("CIE whiteness and tint are defined for D65 only; give D65 data (or a spectrum) to get them.");
    if (yi1925 === null && c) lines.push("ASTM D1925 is defined for C/2° only and is not computed for the 10° observer.");
    if (!c) lines.push("Illuminant C indices (E313 C, D1925) need C data or a spectrum.");
    lines.push(...notes);
    lines.push(
      "Assumes the values describe a near-white, opaque, non-fluorescent sample, or, for a fluorescent one, that it was measured with a UV content matching D65 (the whiteness of optically brightened paper depends on the instrument's UV). " +
        "Whiteness and yellowness indices are for comparing similar samples on one instrument, not absolute colour measures; the E313 coefficients assume the white is the perfect diffuser.",
    );
    const extra: AnalyzeBlock[] = [];
    const base = d65 ?? c!;
    const sxy = XYZToxy(base.XYZ);
    const wxy = XYZToxy(base.white)!;
    if (sxy) {
      extra.push(plot(
        chromaticitySvg(obs, [{ label: "sample", x: sxy[0], y: sxy[1] }], { white: { label: `${d65 ? "D65" : "C"} white`, x: wxy[0], y: wxy[1] }, zoom: true }),
        "The sample's chromaticity beside the white point (close-up of the xy diagram)",
        "A close-up of the CIE 1931 xy diagram around the white point, with the sample's chromaticity: a point toward the blue (lower left) is a bluer, whiter-looking white, toward the upper right a yellower one",
      ));
    }
    if (spec) extra.push(plot(spectrumSvg([{ label: "R(λ)", wl: spec.wl, v: spec.v }]), "The reflectance spectrum", "Reflectance factor against wavelength"));
    const idx: Array<[string, number]> = [];
    if (wt) idx.push(["W", wt.W], ["T", wt.T]);
    if (yiD65 !== null) idx.push(["YI D65", yiD65]);
    if (yiC !== null) idx.push(["YI C", yiC]);
    if (yi1925 !== null) idx.push(["YI D1925", yi1925]);
    if (!sxy) extra.push(plot(barsSvg(idx.map((x) => x[0]), idx.map((x) => x[1]), "Index value", "index"), "The indices", "Bars giving each whiteness and yellowness index"));
    const outputs: EngOutput[] = [];
    if (wt) outputs.push({ key: "W", label: "CIE whiteness W", value: wt.W, unit: "" }, { key: "T", label: "CIE tint T", value: wt.T, unit: "" });
    if (yiD65 !== null) outputs.push({ key: "yiD65", label: "YI E313 (D65)", value: yiD65, unit: "" });
    if (yiC !== null) outputs.push({ key: "yiC", label: "YI E313 (C)", value: yiC, unit: "" });
    if (yi1925 !== null) outputs.push({ key: "yi1925", label: "YI D1925", value: yi1925, unit: "" });
    return finish(lines, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 8. WCAG contrast
// ---------------------------------------------------------------------------------------------------------------

/** "#777777", "777", "119, 119, 119" (0–255) to 8-bit sRGB. */
function readRgb(raw: string, label: string): Vec3 | string {
  const t = (raw ?? "").trim();
  if (!t) return `${label}: this field is required (a hex code such as #777777, or R, G, B from 0 to 255).`;
  const h = parseHex(t);
  if (h) return h;
  const n = numbersIn(t);
  if (n && n.length === 3) {
    if (n.some((x) => x < 0 || x > 255 || x !== Math.round(x))) return `${label}: R, G, B must be whole numbers from 0 to 255 (got ${n.map(trimNum).join(", ")}).`;
    return [n[0], n[1], n[2]];
  }
  return `${label}: "${t}" is neither a hex colour (#RRGGBB) nor three numbers R, G, B (0–255).`;
}

const contrastCalc: ColourCalc = {
  id: "colour-contrast",
  name: "Contrast ratio (WCAG 2.x) for text and interface colours",
  group: GROUP,
  unitContract: "domain",
  hint:
    "A text (foreground) and a background colour, each as a hex code or R, G, B. Gives both relative luminances, the WCAG 2.x " +
    "contrast ratio and the AA/AAA verdicts for normal and large text and for interface parts, decided on the unrounded ratio " +
    "(4.49 fails 4.5), plus the CIEDE2000 difference between the two, which is not the same thing.",
  fields: [
    { key: "fg", label: "Text (foreground) colour", default: "#777777", kind: "text" },
    { key: "bg", label: "Background colour", default: "#FFFFFF", kind: "text" },
  ],
  compute: (r) => {
    const fg = readRgb(r("fg"), "Text colour");
    if (typeof fg === "string") return refuse(fg);
    const bg = readRgb(r("bg"), "Background colour");
    if (typeof bg === "string") return refuse(bg);
    const Lf = wcagLuminance(fg);
    const Lb = wcagLuminance(bg);
    const ratio = wcagContrast(fg, bg);
    const hf = "#" + fg.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
    const hb = "#" + bg.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
    const W = whitePoint("D65", "2");
    const labF = XYZToLab(srgbToXYZ(fg.map((c) => c / 255) as Vec3, W), W);
    const labB = XYZToLab(srgbToXYZ(bg.map((c) => c / 255) as Vec3, W), W);
    const de00 = deltaE("de00", labB, labF);
    const near = (t: number): boolean => Math.abs(ratio - t) < 0.01;
    // Near a threshold the ratio is TRUNCATED to three decimals, so a printed 4.500 always passes and 4.4999 reads 4.499.
    const rs = [3, 4.5, 7].some(near) ? (Math.floor(ratio * 1000) / 1000).toFixed(3) : ratio.toFixed(2);
    const checks: Array<[string, number]> = [
      ["AA, normal text (SC 1.4.3)", 4.5],
      ["AA, large text (18 pt, or 14 pt bold)", 3],
      ["AAA, normal text (SC 1.4.6)", 7],
      ["AAA, large text", 4.5],
      ["Interface parts and graphics (SC 1.4.11)", 3],
    ];
    const res = checks.map(([n, t]) => ({ n, t, ok: ratio >= t }));
    const lines: EngReportLine[] = [];
    const aaN = ratio >= 4.5;
    const aaL = ratio >= 3;
    const aaa = ratio >= 7;
    const verdictText = aaa
      ? "it passes every WCAG level, AAA included"
      : aaN
        ? "it passes WCAG AA for all text but not AAA for normal text (needs 7:1)"
        : aaL
          ? "it fails WCAG AA for normal text (needs 4.5:1) but passes for large text and interface parts (3:1)"
          : "it fails WCAG for text of any size and for interface parts (at least 3:1 is needed)";
    lines.push(`${hf} on ${hb} has a contrast ratio of ${rs}:1: ${verdictText}.`);
    lines.push({
      table: [["Criterion", "Needs", "Result"], ...res.map((x) => [x.n, `${trimNum(x.t)}:1`, x.ok ? "pass" : "FAIL"])],
      label: `Contrast ${rs}:1`,
    });
    lines.push(`Relative luminance: text ${fx(Lf, 4)}, background ${fx(Lb, 4)}. Contrast ratio (lighter + 0.05)/(darker + 0.05) = ${ratio.toFixed(4)}:1, the same whichever colour is the text.`);
    if ([3, 4.5, 7].some(near)) lines.push(`The ratio lies within 0.01 of a threshold, so it is shown to three decimals (truncated, never rounded up); WCAG compares the unrounded ratio, so ${ratio.toFixed(4)} ${res[0].ok ? "passes" : "fails"} 4.5:1 regardless of how it would round.`);
    lines.push({ math: "L = 0.2126 R + 0.7152 G + 0.0722 B", fallback: "L = 0.2126R + 0.7152G + 0.0722B on linearised sRGB channels" });
    lines.push({ math: "CR = (L_1 + 0.05)/(L_2 + 0.05)", fallback: "CR = (L₁ + 0.05)/(L₂ + 0.05), L₁ the lighter" });
    lines.push(`Colour difference between them: ΔE₀₀ ${fx(de00)} (D65/2°, background as the standard). Colour difference is not contrast: two colours can differ strongly in hue at equal luminance (contrast near 1:1), which is unreadable for many people with colour-vision deficiency.`);
    lines.push(
      "Assumes sRGB colours shown on an sRGB display; the linearisation threshold is 0.04045 (WCAG 2.2; WCAG 2.0 and 2.1 printed 0.03928, which gives the same luminance for every 8-bit value). " +
        "WCAG 2.x contrast is a luminance ratio; it ignores font weight beyond the large-text rule and spatial frequency. The proposed WCAG 3 method (APCA) gives different numbers and is not computed.",
    );
    const extra: AnalyzeBlock[] = [
      plot(contrastSwatchSvg(hf, hb, `${rs}:1`), `Text sample: ${hf} on ${hb} and the reverse, at 16 px and 24 px bold`, `Two panels: text in ${hf} on a ${hb} background and the reverse, at normal and large sizes, with the contrast ratio beneath`),
    ];
    const outputs: EngOutput[] = [
      { key: "ratio", label: "Contrast ratio", value: ratio, unit: "" },
      { key: "Lf", label: "Relative luminance (text)", value: Lf, unit: "" },
      { key: "Lb", label: "Relative luminance (background)", value: Lb, unit: "" },
      { key: "de00", label: "ΔE₀₀ between them", value: de00, unit: "" },
    ];
    return finish(lines, extra, outputs);
  },
};

/** The Colour & appearance calculators, in dropdown order. */
export const COLOUR_CALCS: ColourCalc[] = [differenceCalc, batchCalc, convertCalc, spectralCalc, metamerismCalc, adaptCalc, whitenessCalc, contrastCalc];
