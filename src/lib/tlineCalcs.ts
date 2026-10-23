// Pane glue for the Release E3-e transmission-line calculators (gap #15): a line and its termination (Γ, VSWR, return
// and mismatch loss, Z_in at a length, Z₀ typed or from coax / microstrip geometry) drawn on a Smith chart; impedance
// matching (quarter-wave transformer and single shunt stub, both solutions each) with the match's |Γ| against
// frequency; and a two-port's S-parameters (return / insertion loss, VSWR, reciprocity, losslessness, stability,
// unilateral transducer gain). Kept OUT of taskpane.ts; the integrator spreads TLINE_CALCS into ENG_CALCS (group
// "Electronics", which already exists).
//
// No number is computed here: transmissionLine.ts owns them. This file reads the fields — impedances, lengths,
// frequencies and angles through units.ts parseMeasured; S-parameters as a pasted block through dataBlock.ts — words
// the result under the display contract (U+2212, ×10ⁿ, no em dash, NaN or Infinity in an ok result) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { refuseNonFinite } from "./finiteResult";
import {
  C_LIGHT,
  RECIP_TOL,
  LOSSLESS_TOL,
  bandEdges,
  cAbs,
  cArgDeg,
  cPolar,
  coaxZ0,
  cx,
  inputImpedance,
  microstripZ0,
  quarterWave,
  quarterWaveGammaAt,
  reflection,
  singleStub,
  stubGammaAt,
  twoPort,
  zOfGamma,
  type Cx,
  type Load,
  type StubKind,
} from "./transmissionLine";
import { cxText, sig, matchBandSvg, sParamBarsSvg, smithChartSvg, type MatchCurve, type SBar } from "./tlineCharts";

type ElecCalc = EngCalcDef<"Electronics">;

/** A thin space (U+2009): the math parser takes no comma in a subscript, so G_TU,max is typeset G_{TU max}. */
const THIN = String.fromCharCode(0x2009);

const UNIT_NOTE =
  "Units: impedances, lengths, frequencies and angles convert (75 ohm, 1 kΩ, 50 mil, 1.6 mm, 2.4 GHz, 0.5 rad), and a " +
  "unit of the wrong quantity is refused; εᵣ, ℓ/λ and the velocity factor are plain numbers (the velocity factor may be a percentage).";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Six significant figures, trailing zeros dropped, U+2212, ×10ⁿ outside 10⁻³…10⁵ (a computed value). */
const n6 = (v: number): string => (Math.abs(v) < 1e-12 ? "0" : fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, ""));
/** dB to four decimals, U+2212, no "−0.0000". */
const db4 = (v: number): string => (Math.abs(v) < 0.00005 ? "0.0000" : v.toFixed(4)).replace(/^-/, "−");
/** A complex impedance in ohms to six figures. */
const zText = (z: Cx): string => `${cxText(z, 6)} Ω`;
/** Γ as a + jb, |Γ|∠θ. */
const gText = (g: Cx): string => `${cxText(g, 6)} = ${n6(cAbs(g))}∠${n6(cAbs(g) < 1e-12 ? 0 : cArgDeg(g))}°`;

/** Unit-aware field reading: errors collected, conversions reported (the titration/link-budget reader's pattern). */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    let raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    let pct = false;
    if (si === "" && /%$/.test(raw)) {
      pct = true;
      raw = raw.replace(/\s*%$/, "");
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(si === "" ? `${label}: "${raw}" must be a plain number (no unit).` : `${label}: ${m.error}`);
      return NaN;
    }
    if (pct) return m.value / 100;
    if (m.unit.replace(/\s+/g, "") === si) return m.value;
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${n6(m.value)} ${formatUnit(m.unit)} = ${n6(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
  };
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 300);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngReportLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const out = engReport(lines.map((l) => (typeof l === "string" ? trueMinus(l) : l)), extra);
  return refuseNonFinite({ ...out, outputs });
}

/** The load: a termination select plus R and X fields read in ohms. */
function readLoad(r: (k: string) => string, u: ReturnType<typeof unitReader>): Load | null {
  const term = r("term") || "z";
  if (term === "open") return { kind: "open" };
  if (term === "short") return { kind: "short" };
  const rl = u.req("rl", "Ω", "Ω", "Load resistance R");
  const xl = u.req("xl", "Ω", "Ω", "Load reactance X");
  if (!Number.isFinite(rl) || !Number.isFinite(xl)) return null;
  return { kind: "z", z: cx(rl, xl) };
}

const loadText = (load: Load): string => (load.kind === "open" ? "open circuit" : load.kind === "short" ? "short circuit (0 Ω)" : zText(load.z));

const Z0_FIELDS = [
  {
    key: "z0mode",
    label: "Characteristic impedance Z₀",
    default: "typed",
    kind: "select" as const,
    options: [
      { value: "typed", label: "Typed in" },
      { value: "coax", label: "From coaxial geometry" },
      { value: "microstrip", label: "From microstrip geometry (quasi-static)" },
    ],
  },
  { key: "z0", label: "Z₀ (Ω; when typed)", default: "50 Ω", kind: "text" as const },
  { key: "er", label: "Dielectric εᵣ (geometry only)", default: "2.1", kind: "text" as const },
  { key: "dIn", label: "Coax: inner conductor diameter d", default: "0.91 mm", kind: "text" as const },
  { key: "dOut", label: "Coax: outer (shield inner) diameter D", default: "2.95 mm", kind: "text" as const },
  { key: "w", label: "Microstrip: strip width w", default: "3 mm", kind: "text" as const },
  { key: "h", label: "Microstrip: substrate height h", default: "1.6 mm", kind: "text" as const },
];

const LOAD_FIELDS = [
  {
    key: "term",
    label: "Termination",
    default: "z",
    kind: "select" as const,
    options: [
      { value: "z", label: "Load impedance R + jX" },
      { value: "open", label: "Open circuit" },
      { value: "short", label: "Short circuit" },
    ],
  },
  { key: "rl", label: "Load resistance R (Ω)", default: "100 Ω", kind: "text" as const },
  { key: "xl", label: "Load reactance X (Ω; negative = capacitive)", default: "50 Ω", kind: "text" as const },
];

// ---------------------------------------------------------------------------------------------------------------
// 1. Line and termination
// ---------------------------------------------------------------------------------------------------------------

const lineCalc: ElecCalc = {
  id: "tl-line-termination",
  name: "Transmission line & termination (Γ, VSWR, Zin, Smith chart)",
  group: "Electronics",
  unitContract: "converts",
  hint:
    "A lossless line of characteristic impedance Z₀ ending in a load: the reflection coefficient Γ, |Γ|, VSWR, return " +
    "loss and mismatch loss, and the input impedance at a line length given in wavelengths, electrical degrees or as a " +
    "physical length with frequency and velocity factor. Z₀ is typed, or computed from coaxial or microstrip geometry. " +
    "Drawn on a Smith chart.",
  fields: [
    ...Z0_FIELDS,
    ...LOAD_FIELDS,
    {
      key: "lenMode",
      label: "Line length given as",
      default: "lambda",
      kind: "select",
      options: [
        { value: "lambda", label: "Wavelengths (ℓ/λ)" },
        { value: "deg", label: "Electrical length βℓ (degrees)" },
        { value: "phys", label: "Physical length, frequency and velocity factor" },
      ],
    },
    { key: "len", label: "Line length (ℓ/λ, degrees or metres, per the mode above)", default: "0.125", kind: "text" },
    { key: "freq", label: "Frequency (physical length only)", default: "1 GHz", kind: "text" },
    { key: "vf", label: "Velocity factor (physical length only; blank = from the geometry's εᵣ, required for a typed Z₀)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    // Z₀
    const mode = r("z0mode") || "typed";
    let z0 = NaN;
    let geo: { epsEff: number; vf: number; text: string; math: EngReportLine } | null = null;
    if (mode === "typed") z0 = u.req("z0", "Ω", "Ω", "Z₀");
    else {
      const er = u.req("er", "", "", "Dielectric εᵣ");
      if (mode === "coax") {
        const d = u.req("dIn", "m", "m", "Coax inner diameter d");
        const D = u.req("dOut", "m", "m", "Coax outer diameter D");
        if (!u.errors.length) {
          const g = coaxZ0(d, D, er);
          if (!g.ok) return refuse(g.error);
          z0 = g.z0;
          geo = {
            epsEff: g.epsEff,
            vf: g.vf,
            text: `Z₀ from coaxial geometry: d = ${n6(d * 1e3)} mm, D = ${n6(D * 1e3)} mm, εᵣ = ${n6(er)}: Z₀ = ${n6(z0)} Ω (lossless TEM, μᵣ = 1); velocity factor 1/√εᵣ = ${n6(g.vf)}.`,
            math: { math: "Z_0 = η_0/(2 π sqrt(ε_r)) ln(D/d)", fallback: "Z₀ = (η₀/(2π√εᵣ)) ln(D/d), η₀ = √(μ₀/ε₀)" },
          };
        }
      } else if (mode === "microstrip") {
        const w = u.req("w", "m", "m", "Microstrip width w");
        const h = u.req("h", "m", "m", "Microstrip substrate height h");
        if (!u.errors.length) {
          const g = microstripZ0(w, h, er);
          if (!g.ok) return refuse(g.error);
          z0 = g.z0;
          geo = {
            epsEff: g.epsEff,
            vf: g.vf,
            text:
              `Z₀ from microstrip geometry: w = ${n6(w * 1e3)} mm, h = ${n6(h * 1e3)} mm (w/h = ${n6(w / h)}), εᵣ = ${n6(er)}: effective permittivity ${n6(g.epsEff)}, ` +
              `Z₀ = ${n6(z0)} Ω; velocity factor ${n6(g.vf)}. Hammerstad–Jensen (1980) quasi-static equations, as scikit-rf implements them: ` +
              "zero strip thickness and no frequency dispersion (the effective permittivity rises with frequency, so this is the low-frequency value).",
            math: { math: "Z_0 = η_0/(2 π sqrt(ε_eff)) ln(f(u)/u + sqrt(1 + (2/u)^2))", fallback: "Z₀ = (η₀/(2π√ε(eff))) ln(f(u)/u + √(1 + (2/u)²)), u = w/h" },
          };
        }
      } else return refuse("Characteristic impedance: choose typed, coaxial or microstrip.");
    }
    const load = readLoad(r, u);
    // Length
    const lenMode = r("lenMode") || "lambda";
    let turns = NaN;
    let lenText = "";
    let vfNote = "";
    if (lenMode === "lambda") {
      turns = u.req("len", "", "", "Line length ℓ/λ");
      lenText = `ℓ = ${n6(turns)}λ`;
    } else if (lenMode === "deg") {
      const deg = u.req("len", "°", "°", "Electrical length βℓ");
      turns = deg / 360;
      lenText = `βℓ = ${n6(deg)}° (ℓ = ${n6(turns)}λ)`;
    } else if (lenMode === "phys") {
      const ell = u.req("len", "m", "m", "Physical line length");
      const fHz = u.req("freq", "Hz", "Hz", "Frequency");
      let vf = u.opt("vf", "", "", "Velocity factor");
      if (vf === null) {
        if (!geo) u.errors.push("Velocity factor: required for a physical length when Z₀ is typed (blank takes it from the geometry's εᵣ).");
        else vf = geo.vf;
      } else if (geo && Math.abs(vf / geo.vf - 1) > 0.01) {
        vfNote = `The typed velocity factor ${n6(vf)} differs from the geometry's ${n6(geo.vf)} (1/√εᵣ); the wavelength uses the typed value, Z₀ the geometry.`;
      }
      if (!u.errors.length) {
        if (!(fHz > 0)) return refuse("Frequency: must be greater than zero.");
        if (!(vf !== null && vf > 0 && vf <= 1)) return refuse("Velocity factor: must be greater than 0 and at most 1 (a fraction of c, or a percentage).");
        if (!(ell >= 0)) return refuse("Physical line length: must be zero or more.");
        const lam = ((vf as number) * C_LIGHT) / fHz;
        turns = ell / lam;
        lenText = `ℓ = ${n6(ell)} m at ${n6(fHz)} Hz with velocity factor ${n6(vf as number)}: λ = v/f = ${n6(lam)} m, so ℓ = ${n6(turns)}λ`;
      }
    } else return refuse("Line length: choose wavelengths, degrees or a physical length.");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!load) return refuse("Load: enter R and X in ohms.");
    if (!Number.isFinite(turns) || turns < 0) return refuse("Line length: must be zero or more.");
    const rf = reflection(load, z0);
    if (!rf.ok) return refuse(rf.error);
    const zi = inputImpedance(rf.gamma, z0, turns);
    if (!zi.ok) return refuse(zi.error);

    const lines: EngReportLine[] = [];
    if (geo) lines.push(geo.text);
    lines.push(`Load ${loadText(load)} on Z₀ = ${n6(z0)} Ω: Γ = ${gText(rf.gamma)}.`);
    const parts: string[] = [`|Γ| = ${n6(rf.mag)}`];
    parts.push(rf.vswr === null ? "VSWR unbounded (total reflection)" : `VSWR = ${n6(rf.vswr)}`);
    parts.push(rf.rlDb === null ? "return loss unbounded (no reflection)" : `return loss ${db4(rf.rlDb)} dB`);
    parts.push(rf.mlDb === null ? "mismatch loss unbounded (no power reaches the load)" : `mismatch loss ${db4(rf.mlDb)} dB (${n6(100 * rf.delivered)} % of the incident power delivered)`);
    lines.push(parts.join("; ") + ".");
    const inLine =
      zi.zin === null
        ? `At ${lenText}: Γᵢₙ = ${gText(zi.gammaIn)}, so the input is an open circuit (|Zᵢₙ| unbounded).`
        : `At ${lenText}: input impedance Zᵢₙ = ${zText(zi.zin)} (Γᵢₙ = ${gText(zi.gammaIn)}).`;
    lines.push(inLine);
    if (vfNote) lines.push(vfNote);
    if (zi.halfWaves > 0) lines.push(`The input impedance repeats every half wavelength: ${zi.halfWaves} × λ/2 removed, ${n6(zi.reduced)}λ remains.`);
    if (geo) lines.push(geo.math);
    lines.push({ math: "Γ = (Z_L - Z_0)/(Z_L + Z_0)", fallback: "Γ = (Zₗ − Z₀)/(Zₗ + Z₀)" });
    lines.push({ math: "VSWR = (1 + abs(Γ))/(1 - abs(Γ))", fallback: "VSWR = (1 + |Γ|)/(1 − |Γ|)" });
    lines.push({ math: "RL = -20 log_10 abs(Γ)", fallback: "RL = −20 log₁₀|Γ| dB" });
    lines.push({ math: "ML = -10 log_10 (1 - abs(Γ)^2)", fallback: "ML = −10 log₁₀(1 − |Γ|²) dB" });
    lines.push({ math: "Z_in = Z_0 (Z_L + j Z_0 tan(β l))/(Z_0 + j Z_L tan(β l))", fallback: "Zᵢₙ = Z₀ (Zₗ + jZ₀ tan βℓ)/(Z₀ + jZₗ tan βℓ), β = 2π/λ" });
    lines.push("Assumes a lossless line with a real Z₀ (TEM, one mode); positions are measured from the load toward the generator, and the input impedance is computed by rotating Γ clockwise by 4πℓ/λ.");
    const rows: Array<[string, string, string]> = [
      ["Z₀", n6(z0), "Ω"],
      ["Γ (real, imaginary)", `${n6(rf.gamma.re)}, ${n6(rf.gamma.im)}`, ""],
      ["|Γ|", n6(rf.mag), ""],
      ["∠Γ", n6(rf.angleDeg), "°"],
      ["VSWR", rf.vswr === null ? "unbounded" : n6(rf.vswr), ""],
      ["Return loss", rf.rlDb === null ? "unbounded" : db4(rf.rlDb), "dB"],
      ["Mismatch loss", rf.mlDb === null ? "unbounded" : db4(rf.mlDb), "dB"],
      ["Line length ℓ/λ", n6(turns), ""],
      ["Zin", zi.zin === null ? "open circuit" : cxText(zi.zin, 6), zi.zin === null ? "" : "Ω"],
    ];
    const table: string[][] = [["Quantity", "Value", "Unit"], ...rows];
    const outputs: EngOutput[] = [
      { key: "z0", label: "Characteristic impedance Z₀", value: z0, unit: "Ω" },
      { key: "gammaRe", label: "Γ, real part", value: rf.gamma.re, unit: "" },
      { key: "gammaIm", label: "Γ, imaginary part", value: rf.gamma.im, unit: "" },
      { key: "gammaMag", label: "|Γ|", value: rf.mag, unit: "" },
      { key: "gammaAng", label: "∠Γ", value: rf.angleDeg, unit: "°" },
      { key: "turns", label: "Line length", value: turns, unit: "λ" },
    ];
    if (rf.vswr !== null) outputs.push({ key: "vswr", label: "VSWR", value: rf.vswr, unit: "" });
    if (rf.rlDb !== null) outputs.push({ key: "rl", label: "Return loss", value: rf.rlDb, unit: "dB" });
    if (rf.mlDb !== null) outputs.push({ key: "ml", label: "Mismatch loss", value: rf.mlDb, unit: "dB" });
    if (zi.zin !== null) {
      outputs.push({ key: "zinRe", label: "Zin, resistance", value: zi.zin.re, unit: "Ω" });
      outputs.push({ key: "zinIm", label: "Zin, reactance", value: zi.zin.im, unit: "Ω" });
    }
    if (geo) outputs.push({ key: "epsEff", label: "Effective permittivity", value: geo.epsEff, unit: "" });
    const svg = smithChartSvg({
      gammaL: rf.gamma,
      gammaIn: turns > 0 ? zi.gammaIn : null,
      turns: zi.reduced,
      halfWaves: zi.halfWaves,
      z0,
      zlText: load.kind === "open" ? "open circuit" : load.kind === "short" ? "0 Ω, short circuit" : `${cxText(load.z, 4)} Ω`,
      zinText: zi.zin === null ? "open circuit" : `${cxText(zi.zin, 4)} Ω`,
      vswr: rf.vswr,
    });
    const extra: AnalyzeBlock[] = [
      { kind: "table", label: "Line and termination", rows: table },
      plot(
        svg,
        "Smith chart: the load, the rotation toward the generator to the input impedance, and the VSWR circle",
        "Impedance Smith chart with constant-resistance circles and constant-reactance arcs, the load point, a clockwise arc along the constant-VSWR circle for the line length, and the input impedance point",
      ),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Matching: quarter-wave transformer and single shunt stub
// ---------------------------------------------------------------------------------------------------------------

const matchCalc: ElecCalc = {
  id: "tl-match",
  name: "Impedance match: quarter-wave transformer & single stub",
  group: "Electronics",
  unitContract: "converts",
  hint:
    "Matches a load to a lossless line of real Z₀ two ways, giving both solutions of each: a quarter-wave transformer " +
    "placed where the line impedance is real (at the load for a resistive load), and a single shunt stub (open or " +
    "shorted) at a distance from the load. Lengths in wavelengths of the Z₀ line. The figure shows each match's |Γ| " +
    "from 0.5 f₀ to 1.5 f₀ with the load held constant, and the result gives the bandwidth within a VSWR limit.",
  fields: [
    { key: "z0", label: "Line Z₀ (Ω)", default: "50 Ω", kind: "text" },
    { key: "rl", label: "Load resistance R (Ω)", default: "100 Ω", kind: "text" },
    { key: "xl", label: "Load reactance X (Ω; negative = capacitive)", default: "0 Ω", kind: "text" },
    {
      key: "stub",
      label: "Stub",
      default: "short",
      kind: "select",
      options: [
        { value: "short", label: "Short-circuited stub" },
        { value: "open", label: "Open-circuited stub" },
      ],
    },
    { key: "vswrMax", label: "VSWR limit for the bandwidth", default: "1.5", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const z0 = u.req("z0", "Ω", "Ω", "Z₀");
    const rl = u.req("rl", "Ω", "Ω", "Load resistance R");
    const xl = u.req("xl", "Ω", "Ω", "Load reactance X");
    const vmax = u.req("vswrMax", "", "", "VSWR limit");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const kind: StubKind = r("stub") === "open" ? "open" : "short";
    if (!(vmax > 1) || vmax > 100) return refuse("VSWR limit: must be greater than 1 and at most 100.");
    const load: Load = { kind: "z", z: cx(rl, xl) };
    const rf = reflection(load, z0);
    if (!rf.ok) return refuse(rf.error);
    const qw = quarterWave(rf, z0);
    if (!qw.ok) return refuse(qw.error);
    const st = singleStub(rf, z0, kind);
    if (!st.ok) return refuse(st.error);
    const gLim = (vmax - 1) / (vmax + 1);
    // The unmatched load already within the limit: the match never leaves the band, so no edge exists.
    const bwMeaningful = (rf.vswr as number) > vmax;
    const noEdges = { lo: null, hi: null };
    const lines: EngReportLine[] = [];
    lines.push(`Load ${zText(load.z)} on Z₀ = ${n6(z0)} Ω: Γ = ${gText(rf.gamma)}, VSWR ${n6(rf.vswr as number)}.`);
    const curves: MatchCurve[] = [];
    const bwText = (lo: number | null, hi: number | null): string =>
      !bwMeaningful ? "not reported (see below)" :
      lo !== null && hi !== null ? `${n6(lo)} f₀ to ${n6(hi)} f₀ (${n6(100 * (hi - lo))} %)` : `beyond the 0.02 f₀ to 1.98 f₀ scan on ${lo === null && hi === null ? "both sides" : lo === null ? "the low side" : "the high side"}${lo !== null ? ` (from ${n6(lo)} f₀)` : hi !== null ? ` (to ${n6(hi)} f₀)` : ""}`;
    const table: string[][] = [["Match", "Position from load (λ)", "Element", `Bandwidth, VSWR ≤ ${n6(vmax)}`]];
    const outputs: EngOutput[] = [];
    const QW_COL = ["#1f5fa8", "#5b9bd5"], ST_COL = ["#c00000", "#e69f00"];
    qw.solutions.forEach((s, i) => {
      const g = (F: number): Cx => quarterWaveGammaAt(rf.gamma, z0, s, F);
      const e = bwMeaningful ? bandEdges(g, gLim) : noEdges;
      const where = s.dLambda === 0 ? "at the load" : `${n6(s.dLambda)}λ from the load, at a voltage ${s.at === "max" ? "maximum" : "minimum"}`;
      lines.push(
        `Quarter-wave transformer ${i + 1}: ${where}, where the line impedance is ${n6(s.rAt)} Ω; section impedance Zₜ = √(${n6(z0)} × ${n6(s.rAt)}) = ${n6(s.zt)} Ω, λ/4 long. Bandwidth (VSWR ≤ ${n6(vmax)}): ${bwText(e.lo, e.hi)}.`,
      );
      table.push([`Quarter-wave ${i + 1}`, n6(s.dLambda), `Zₜ = ${n6(s.zt)} Ω, λ/4 section`, e.lo !== null && e.hi !== null ? `${n6(100 * (e.hi - e.lo))} %` : bwMeaningful ? "beyond scan" : "n/a"]);
      outputs.push({ key: `qw${i + 1}Zt`, label: `Quarter-wave ${i + 1}: section impedance`, value: s.zt, unit: "Ω" });
      outputs.push({ key: `qw${i + 1}D`, label: `Quarter-wave ${i + 1}: distance from load`, value: s.dLambda, unit: "λ" });
      if (e.lo !== null && e.hi !== null) outputs.push({ key: `qw${i + 1}Bw`, label: `Quarter-wave ${i + 1}: fractional bandwidth`, value: 100 * (e.hi - e.lo), unit: "%" });
      curves.push({ label: `λ/4 ${i + 1}: Zₜ = ${sig(s.zt, 4)} Ω`, colour: QW_COL[i], g: (F) => cAbs(g(F)) });
    });
    st.solutions.forEach((s, i) => {
      const g = (F: number): Cx => stubGammaAt(rf.gamma, kind, s, F);
      const e = bwMeaningful ? bandEdges(g, gLim) : noEdges;
      lines.push(
        `Stub ${i + 1}: ${kind === "short" ? "short-circuited" : "open-circuited"} shunt stub ${n6(s.lLambda)}λ long, ${n6(s.dLambda)}λ from the load (there y = 1 ${s.b < 0 ? "−" : "+"} j${n6(Math.abs(s.b))}, the stub adds ${s.b < 0 ? "+" : "−"}j${n6(Math.abs(s.b))}). Bandwidth (VSWR ≤ ${n6(vmax)}): ${bwText(e.lo, e.hi)}.`,
      );
      table.push([`Stub ${i + 1}`, n6(s.dLambda), `${kind} stub, ${n6(s.lLambda)}λ`, e.lo !== null && e.hi !== null ? `${n6(100 * (e.hi - e.lo))} %` : bwMeaningful ? "beyond scan" : "n/a"]);
      outputs.push({ key: `stub${i + 1}D`, label: `Stub ${i + 1}: distance from load`, value: s.dLambda, unit: "λ" });
      outputs.push({ key: `stub${i + 1}L`, label: `Stub ${i + 1}: stub length`, value: s.lLambda, unit: "λ" });
      if (e.lo !== null && e.hi !== null) outputs.push({ key: `stub${i + 1}Bw`, label: `Stub ${i + 1}: fractional bandwidth`, value: 100 * (e.hi - e.lo), unit: "%" });
      curves.push({ label: `Stub ${i + 1}: d = ${sig(s.dLambda, 3)}λ`, colour: ST_COL[i], g: (F) => cAbs(g(F)) });
    });
    if (!bwMeaningful) lines.push(`The load's own VSWR (${n6(rf.vswr as number)}) is already within the limit (${n6(vmax)}), so no band edge exists and bandwidths are not reported: lower the limit.`);
    lines.push({ math: "Z_T = sqrt(Z_0 R)", fallback: "Zₜ = √(Z₀R), R = Z₀·VSWR at a voltage maximum or Z₀/VSWR at a minimum" });
    lines.push({ math: "Γ(d) = Γ_L e^(-j 4 π d/λ)", fallback: "Γ(d) = Γₗ·exp(−j4πd/λ)" });
    lines.push({ math: "y(d) = (1 - Γ(d))/(1 + Γ(d)) = 1 + j b", fallback: "y(d) = (1 − Γ(d))/(1 + Γ(d)) = 1 + jb at the stub" });
    lines.push(
      kind === "short"
        ? { math: "-j cot(2 π l/λ) = -j b", fallback: "shorted stub: −j cot(2πℓ/λ) = −jb" }
        : { math: "j tan(2 π l/λ) = -j b", fallback: "open stub: j tan(2πℓ/λ) = −jb" },
    );
    lines.push("Assumes lossless lines; the stub and the transformer are lines of the same phase velocity, the stub has the line's Z₀, and in the bandwidth the load impedance is held at its f₀ value (a real load's own frequency dependence is not modelled). Junction and end effects are ignored.");
    const svg = matchBandSvg(curves, gLim, vmax);
    const extra: AnalyzeBlock[] = [
      { kind: "table", label: "Matching solutions", rows: table },
      plot(svg, "Input reflection of each matching solution against frequency", "Magnitude of the input reflection coefficient against normalised frequency for both quarter-wave transformers and both stub solutions, each zero at f₀, with the VSWR limit as a horizontal line"),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Two-port S-parameters
// ---------------------------------------------------------------------------------------------------------------

const S_ORDER = ["S11", "S21", "S12", "S22"] as const;
const S_PRETTY: Record<string, string> = { S11: "S₁₁", S21: "S₂₁", S12: "S₁₂", S22: "S₂₂" };

/** The four S-parameters from a pasted block: four rows of two numbers, Touchstone order, an optional name first. */
export function readSBlock(text: string, fmt: "ma" | "db" | "ri"): { s: Record<string, Cx>; notes: string[] } | string {
  if (!(text ?? "").trim()) return "S-parameters: nothing to read. Paste four rows (S11, S21, S12, S22), two numbers each.";
  const names: (string | null)[] = [];
  const b = readDataBlock(text, "S-parameters", {
    maxRows: 4,
    noHeader: true,
    mapRow: (fields) => {
      const first = (fields[0] ?? "").replace(/[₁]/g, "1").replace(/[₂]/g, "2").toUpperCase();
      if (/^S[12]{2}:?$/.test(first)) {
        names.push(first.replace(":", ""));
        return fields.slice(1);
      }
      names.push(null);
      return fields;
    },
  });
  if (!b.ok) return b.error;
  if (b.rows.length !== 4) return `S-parameters: ${b.rows.length} row${b.rows.length === 1 ? "" : "s"} read; a two-port needs exactly four (S11, S21, S12, S22).`;
  const labelled = names.filter((n) => n !== null);
  if (labelled.length !== 0 && labelled.length !== 4) return "S-parameters: name all four rows (S11, S21, S12, S22) or none (then they are read in Touchstone order S11, S21, S12, S22).";
  if (labelled.length === 4 && new Set(labelled).size !== 4) return "S-parameters: a name is repeated; give each of S11, S21, S12 and S22 once.";
  const s: Record<string, Cx> = {};
  for (let i = 0; i < 4; i++) {
    const row = b.rows[i];
    if (row.length !== 2 || row.some((v) => v === null))
      return `S-parameters: line ${b.lines[i]} must hold exactly two numbers (${fmt === "ri" ? "real, imaginary" : fmt === "db" ? "magnitude in dB, angle in degrees" : "linear magnitude, angle in degrees"}).`;
    const [a, c] = row as number[];
    const name = labelled.length === 4 ? (names[i] as string) : S_ORDER[i];
    let v: Cx;
    if (fmt === "ri") v = cx(a, c);
    else if (fmt === "db") {
      if (a > 120) return `${S_PRETTY[name]}: ${a} dB is more than 120 dB; this tool refuses it.`;
      v = cPolar(Math.pow(10, a / 20), c);
    } else {
      if (a < 0) return `${S_PRETTY[name]}: a linear magnitude cannot be negative (write the sign into the angle: add 180°).`;
      v = cPolar(a, c);
    }
    if (fmt !== "ri" && Math.abs(c) > 3600) return `${S_PRETTY[name]}: the angle ${c}° is outside ±3600°; reduce it.`;
    s[name] = v;
  }
  return { s, notes: b.notes };
}

const twoPortCalc: ElecCalc = {
  id: "tl-two-port",
  name: "Two-port S-parameters (return/insertion loss, VSWR, stability, GTU)",
  group: "Electronics",
  unitContract: "converts",
  hint:
    "A two-port's S-parameters at one frequency, all referred to the same Z₀: input and output return loss and VSWR, " +
    "insertion loss (or gain) and reverse isolation, the reciprocity (S₁₂ = S₂₁) and losslessness (SᴴS = I) checks, " +
    "Rollett stability K and |Δ|, and the maximum unilateral transducer gain with the error bounds of the " +
    "unilateral assumption. One row per parameter in Touchstone order (S11, S21, S12, S22), optionally named.",
  fields: [
    {
      key: "fmt",
      label: "Format",
      default: "ma",
      kind: "select",
      options: [
        { value: "ma", label: "Linear magnitude, angle (°)" },
        { value: "db", label: "Magnitude (dB), angle (°)" },
        { value: "ri", label: "Real, imaginary" },
      ],
    },
    { key: "s", label: "S-parameters: S11, S21, S12, S22 (one per line)", default: "S11 0.61 -170\nS21 2.24 32\nS12 0.05 16\nS22 0.72 -83", kind: "block", rows: 4 },
    { key: "z0", label: "Reference impedance Z₀ (Ω)", default: "50 Ω", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const z0 = u.req("z0", "Ω", "Ω", "Reference impedance Z₀");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!(z0 > 0)) return refuse("Reference impedance Z₀: must be greater than zero.");
    const fmtRaw = r("fmt") || "ma";
    const fmt = fmtRaw === "db" ? "db" : fmtRaw === "ri" ? "ri" : "ma";
    const blk = readSBlock(r("s"), fmt);
    if (typeof blk === "string") return refuse(blk);
    const { S11, S21, S12, S22 } = blk.s;
    const t = twoPort(S11, S21, S12, S22);
    if (!t.ok) return refuse(t.error);
    const lines: EngReportLine[] = [...blk.notes];
    const ang = (z: Cx): string => n6(cAbs(z) < 1e-15 ? 0 : cArgDeg(z));
    const vs = (v: number | null, m: number): string => (v === null ? `VSWR not defined (|S| = ${n6(m)} ≥ 1: the port reflects at least what is incident)` : `VSWR ${n6(v)}`);
    lines.push(
      `Input: return loss ${t.rlIn === null ? "unbounded (S₁₁ = 0)" : `${db4(t.rlIn)} dB`}, ${vs(t.vswrIn, cAbs(S11))}. Output: return loss ${t.rlOut === null ? "unbounded (S₂₂ = 0)" : `${db4(t.rlOut)} dB`}, ${vs(t.vswrOut, cAbs(S22))}.`,
    );
    lines.push(
      `Forward: 20 log₁₀|S₂₁| = ${t.dB.s21 === null ? "no transmission (S₂₁ = 0)" : `${db4(t.dB.s21)} dB (${(t.il as number) >= 0 ? `insertion loss ${db4(t.il as number)} dB` : `gain ${db4(-(t.il as number))} dB`})`}. ` +
        `Reverse isolation ${t.iso === null ? "unbounded (S₁₂ = 0: unilateral)" : `${db4(t.iso)} dB`}.`,
    );
    lines.push(
      t.reciprocal
        ? `Reciprocal: S₁₂ = S₂₁ within ${RECIP_TOL * 100} % (|S₁₂ − S₂₁| is ${n6(100 * t.recipDev)} % of the larger).`
        : `Not reciprocal: |S₁₂ − S₂₁| is ${n6(100 * t.recipDev)} % of the larger (tolerance ${RECIP_TOL * 100} %), as for an active or non-reciprocal (ferrite, amplifier) network.`,
    );
    lines.push(
      t.lossless
        ? `Lossless: SᴴS = I within ${LOSSLESS_TOL} (largest deviation ${n6(t.losslessDev)}).`
        : `Not lossless (SᴴS departs from I by ${n6(t.losslessDev)}, tolerance ${LOSSLESS_TOL}): of the power into port 1, ${n6(100 * t.dissipated1)} % is ${t.dissipated1 >= 0 ? "dissipated" : "added (gain)"}; into port 2, ${n6(100 * t.dissipated2)} % is ${t.dissipated2 >= 0 ? "dissipated" : "added (gain)"} (1 − |S₁₁|² − |S₂₁|², 1 − |S₁₂|² − |S₂₂|²).`,
    );
    const kText = t.K === null ? "K unbounded (S₁₂S₂₁ = 0)" : `K = ${n6(t.K)}`;
    lines.push(
      t.stability === "passive"
        ? `Passive network (largest eigenvalue of SᴴS ${n6(t.maxGain)} ≤ 1): stable with any passive terminations; ${kText}, |Δ| = ${n6(t.deltaMag)}.`
        : t.stability === "unconditional"
          ? `Unconditionally stable: ${kText}${t.K === null ? ", |S₁₁| < 1 and |S₂₂| < 1" : ` > 1 and |Δ| = ${n6(t.deltaMag)} < 1`} (Rollett).`
          : `Potentially unstable: ${kText}, |Δ| = ${n6(t.deltaMag)} (unconditional stability needs K > 1 and |Δ| < 1); some passive source or load terminations make it oscillate.`,
    );
    if (t.gtu) {
      const g = t.gtu;
      lines.push(
        g.total > 0
          ? `Maximum unilateral transducer gain (S₁₂ taken as 0, both ports conjugate-matched): ${db4(10 * Math.log10(g.total))} dB = source match ${db4(10 * Math.log10(g.gs))} dB + |S₂₁|² ${g.g0 > 0 ? db4(10 * Math.log10(g.g0)) + " dB" : "(zero)"} + load match ${db4(10 * Math.log10(g.gl))} dB.`
          : "Maximum unilateral transducer gain: none, no transmission (S₂₁ = 0): no power reaches the load at any matching, so the gain is zero and has no value in dB.",
      );
      if (t.unilateral)
        lines.push(
          t.unilateral.U === 0
            ? "Unilateral figure of merit U = 0: S₁₂ = 0, so the transducer gain equals the unilateral one exactly."
            : `Unilateral figure of merit U = ${n6(t.unilateral.U)}: at those terminations the true transducer gain is between ${db4(t.unilateral.loDb)} dB and +${db4(t.unilateral.hiDb)} dB of the unilateral value.`,
        );
      else lines.push("Unilateral figure of merit U ≥ 1: the unilateral approximation is not usable for this device.");
    } else lines.push("The maximum unilateral transducer gain is not defined: |S₁₁| ≥ 1 or |S₂₂| ≥ 1 (a port with negative resistance).");
    const zin1 = zOfGamma(S11, z0);
    if (zin1) lines.push(`Input impedance with port 2 terminated in Z₀: ${zText(zin1)}.`);
    lines.push({ math: "RL_in = -20 log_10 abs(S_11)", fallback: "RLᵢₙ = −20 log₁₀|S₁₁| dB" });
    lines.push({ math: "IL = -20 log_10 abs(S_21)", fallback: "IL = −20 log₁₀|S₂₁| dB" });
    lines.push({ math: "K = (1 - abs(S_11)^2 - abs(S_22)^2 + abs(Δ)^2)/(2 abs(S_12 S_21))", fallback: "K = (1 − |S₁₁|² − |S₂₂|² + |Δ|²)/(2|S₁₂S₂₁|), Δ = S₁₁S₂₂ − S₁₂S₂₁" });
    lines.push({ math: "G_{TU" + THIN + "max} = 1/(1 - abs(S_11)^2) abs(S_21)^2 1/(1 - abs(S_22)^2)", fallback: "Gₜᵤ,ₘₐₓ = |S₂₁|²/((1 − |S₁₁|²)(1 − |S₂₂|²))" });
    lines.push({ math: "U = (abs(S_12) abs(S_21) abs(S_11) abs(S_22))/((1 - abs(S_11)^2)(1 - abs(S_22)^2))", fallback: "U = |S₁₂||S₂₁||S₁₁||S₂₂|/((1 − |S₁₁|²)(1 − |S₂₂|²)), 1/(1 + U)² < Gₜ/Gₜᵤ < 1/(1 − U)²" });
    lines.push("Assumes all four parameters at one frequency, referred to the same real Z₀ at both ports; angles in degrees.");
    const table: string[][] = [["Parameter", "Magnitude", "Magnitude (dB)", "Angle (°)", "Real", "Imaginary"]];
    for (const name of S_ORDER) {
      const v = blk.s[name];
      const m = cAbs(v);
      table.push([S_PRETTY[name], n6(m), m > 0 ? db4(20 * Math.log10(m)) : "no value (zero)", ang(v), n6(v.re), n6(v.im)]);
    }
    const outputs: EngOutput[] = [];
    const push = (key: string, label: string, v: number | null, unit: string): void => {
      if (v !== null && Number.isFinite(v)) outputs.push({ key, label, value: v, unit });
    };
    push("rlIn", "Input return loss", t.rlIn, "dB");
    push("rlOut", "Output return loss", t.rlOut, "dB");
    push("s21db", "Forward transmission 20 log₁₀|S₂₁|", t.dB.s21, "dB");
    push("il", "Insertion loss", t.il, "dB");
    push("iso", "Reverse isolation", t.iso, "dB");
    push("vswrIn", "Input VSWR", t.vswrIn, "");
    push("vswrOut", "Output VSWR", t.vswrOut, "");
    push("K", "Rollett stability factor K", t.K, "");
    push("deltaMag", "|Δ|", t.deltaMag, "");
    push("gtuMax", "Maximum unilateral transducer gain", t.gtu && t.gtu.total > 0 ? 10 * Math.log10(t.gtu.total) : null, "dB");
    push("U", "Unilateral figure of merit", t.unilateral ? t.unilateral.U : null, "");
    push("recipDev", "Reciprocity deviation", 100 * t.recipDev, "%");
    push("losslessDev", "Losslessness deviation", t.losslessDev, "");
    if (zin1) {
      push("zinRe", "Input resistance (port 2 in Z₀)", zin1.re, "Ω");
      push("zinIm", "Input reactance (port 2 in Z₀)", zin1.im, "Ω");
    }
    const bars: SBar[] = S_ORDER.map((name) => {
      const v = blk.s[name];
      const m = cAbs(v);
      return { sub: name.slice(1), db: m > 0 ? 20 * Math.log10(m) : null, angleDeg: m > 0 ? cArgDeg(v) : 0, kind: name === "S11" || name === "S22" ? "reflection" : "transmission" };
    });
    const extra: AnalyzeBlock[] = [
      { kind: "table", label: "S-parameters", rows: table },
      plot(sParamBarsSvg(bars), "S-parameter magnitudes in dB, each labelled with its angle", "Bar chart of 20 log10 of the magnitude of S11, S21, S12 and S22, reflection bars in blue and transmission bars in red, each labelled with its dB value and angle"),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

export const TLINE_CALCS: ElecCalc[] = [lineCalc, matchCalc, twoPortCalc];
