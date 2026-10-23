// Pane glue for the Release E vibration calculators (gap #12): a random-vibration PSD profile with Miles' equation and
// the exact SDOF response, sine base excitation of mounted equipment, and shaft critical speeds. Kept OUT of
// taskpane.ts; the integrator spreads RANDOM_VIBRATION_CALCS into ENG_CALCS (group "Vibration", which already exists).
//
// No number is computed here: randomVibration.ts owns them (and it takes T and M from vibration.ts and the shaft's
// static deflection from beam.ts). This file reads the fields — dimensional ones through units.ts parseMeasured — words
// the result under the display contract (U+2212, ×10ⁿ, no em dash, NaN or Infinity in an ok result) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { convert, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import {
  STANDARD_GRAVITY,
  ZETA_MIN,
  asdAt,
  baseExcitation,
  dunkerley,
  massShaft,
  miles,
  psdProfile,
  roundSection,
  sdofRandomResponse,
  speedMargin,
  uniformShaftCriticals,
  PSD_MAX_POINTS,
  SHAFT_MAX_MASSES,
  type BaseInput,
} from "./randomVibration";
import { psdChartSvg, shaftCriticalSvg, transmissibilityChartSvg, type ShaftChartRow } from "./randomVibrationCharts";

type VibCalc = EngCalcDef<"Vibration">;

/** The unit contract, worded as the pane's ENG_UNIT_NOTE, with this part's fixed-unit fields named. */
const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (2 kHz, 50 mm, 30 Msi, 6000 rpm) and " +
  "it is converted for you, and a unit of the wrong quantity is refused rather than silently ignored.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Four significant figures (trailing zeros kept: a computed value), ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const n4 = (v: number): string => fmtSig(v, 4);

/** Six significant figures with trailing zeros dropped: a value as the user typed it (200 GPa, not 200.000 GPa). */
const trimSig = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** Unit-aware field reading: errors collected, conversions reported (the titrationCalcs.ts pattern). */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
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
    if (!m.assumed && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${trimSig(m.value)} ${m.unit} = ${n4(m.inTarget)} ${shown}`);
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

const DAMP_OPTIONS = [
  { value: "q", label: "Q (amplification at resonance)" },
  { value: "zeta", label: "Damping ratio ζ" },
];

/** ζ from the Q/ζ select and its value field; a string is a refusal. */
function readDamping(r: (k: string) => string, kindKey: string, valueKey: string): number | string {
  const kind = r(kindKey) === "zeta" ? "zeta" : "q";
  const v = plain(r(valueKey));
  if (kind === "q") {
    if (!(v > 0.5)) return "Q must be a number greater than 0.5 (Q = 1/(2ζ); Q ≤ 0.5 is critically damped or more).";
    const z = 1 / (2 * v);
    if (z < ZETA_MIN) return `Q must be at most ${1 / (2 * ZETA_MIN)} (ζ ≥ ${ZETA_MIN}).`;
    return z;
  }
  if (!(v >= ZETA_MIN && v < 1)) return `ζ must be a number from ${ZETA_MIN} up to (not including) 1.`;
  return v;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 440);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 290);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const out = engReport(lines.map((l) => trueMinus(l)), extra);
  return { ...out, outputs };
}

/** Rows of exactly `need` numbers from a pasted block (RULE N reader); a string is a refusal. */
function readRows(text: string, what: string, need: number, cap: number, columns: string): { rows: number[][]; notes: string[] } | string {
  if (!(text ?? "").trim()) return `${what}: nothing to read. Paste ${columns}, one row per line.`;
  const b = readDataBlock(text, what, { maxRows: cap });
  if (!b.ok) return b.error;
  const rows: number[][] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    if (row.length !== need || row.some((v) => v === null))
      return `${what}: line ${b.lines[i]} must hold exactly ${need} numbers (${columns}).`;
    rows.push(row as number[]);
  }
  return { rows, notes: b.notes };
}

const pct = (x: number): string => `${fmtSig(Math.abs(x) * 100, 2)} %`;

// ---------------------------------------------------------------------------------------------------------------
// 1. Random vibration
// ---------------------------------------------------------------------------------------------------------------

const randomCalc: VibCalc = {
  id: "vib-random-psd",
  name: "Random vibration: PSD profile, Grms and Miles' equation",
  group: "Vibration",
  unitContract: "converts",
  hint:
    "Paste the acceleration spectral density profile as breakpoints, frequency (Hz) and ASD (g²/Hz), one per line " +
    "(MIL-STD-810, DO-160 and NAVMAT P-9492 profiles are written this way; turn a dB/octave slope into its end " +
    "breakpoint first). The overall Grms is the exact area under the straight-on-log-log profile. Give a natural " +
    "frequency and Q (or ζ) for the response of a mounted item: Miles' equation and the exact SDOF response over the profile.",
  fields: [
    { key: "psd", label: "Breakpoints: frequency (Hz), ASD (g²/Hz)", default: "20 0.01\n80 0.04\n350 0.04\n2000 0.007", kind: "block", rows: 6 },
    { key: "fn", label: "Natural frequency fn (Hz; blank for the profile only)", default: "100", kind: "text" },
    { key: "dkind", label: "Damping given as", default: "q", kind: "select", options: DAMP_OPTIONS },
    { key: "damp", label: "Q or ζ", default: "10", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const fn = u.opt("fn", "Hz", "Hz", "Natural frequency");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const t = readRows(r("psd"), "PSD breakpoints", 2, PSD_MAX_POINTS, "frequency in Hz, ASD in g²/Hz");
    if (typeof t === "string") return refuse(t);
    const prof = psdProfile(t.rows.map((row) => [row[0], row[1]]));
    if (!prof.ok) return refuse(prof.error);
    const lines: EngLine[] = [...t.notes];
    const outputs: EngOutput[] = [
      { key: "area", label: "Mean square acceleration", value: prof.area, unit: "g²" },
      { key: "grms", label: "Overall Grms", value: prof.grms, unit: "g" },
    ];
    lines.push(`Overall level: ${n4(prof.grms)} g rms (area ${n4(prof.area)} g², ${prof.segments.length} segment${prof.segments.length > 1 ? "s" : ""}, ${n4(prof.points[0][0])}–${n4(prof.points[prof.points.length - 1][0])} Hz).`);
    lines.push({ math: "G_rms = sqrt(sum(i=1, N, A_i))", fallback: "Grms = √(Σ Aᵢ), the square root of the area under the profile" });
    lines.push({ math: "A_i = a_1 f_1 {(f_2/f_1)^{n+1} - 1}/{n+1}", fallback: "Aᵢ = a₁f₁·((f₂/f₁)ⁿ⁺¹ − 1)/(n + 1)" });
    lines.push({ math: "n = {log(a_2/a_1)}/{log(f_2/f_1)}", fallback: "n = log(a₂/a₁)/log(f₂/f₁)" });
    lines.push("Each segment is a straight line on log-log axes (ASD ∝ fⁿ); n = −1 (−3.01 dB/oct) is the limit a₁f₁·ln(f₂/f₁), taken by the same formula.");
    const table: string[][] = [["Segment", "f₁ (Hz)", "f₂ (Hz)", "ASD₁ (g²/Hz)", "ASD₂ (g²/Hz)", "Slope (dB/oct)", "Area (g²)"]];
    prof.segments.forEach((s, i) => {
      const slope = Math.abs(s.dbPerOct) < 5e-3 ? "0 (flat)" : (s.dbPerOct > 0 ? "+" : "") + fmtSig(s.dbPerOct, 3);
      table.push([String(i + 1), n4(s.f1), n4(s.f2), n4(s.a1), n4(s.a2), slope, n4(s.area)]);
    });
    const extra: AnalyzeBlock[] = [{ kind: "table", label: "PSD profile segments", rows: table.map((row) => row.map((c) => trueMinus(c))) }];
    let sdofFig: { fn: number; zeta: number; grms: number } | undefined;
    if (fn !== null) {
      const zeta = readDamping(r, "dkind", "damp");
      if (typeof zeta === "string") return refuse(zeta);
      if (!(fn > 0)) return refuse("Natural frequency: it must be greater than zero.");
      const asd = asdAt(prof, fn);
      if (asd === null)
        return refuse(`Natural frequency ${n4(fn)} Hz is outside the profile (${n4(prof.points[0][0])}–${n4(prof.points[prof.points.length - 1][0])} Hz): Miles' equation needs the input ASD at fn. Extend the profile or leave fn blank.`);
      const Q = 1 / (2 * zeta);
      const mi = miles(fn, Q, asd);
      const ex = sdofRandomResponse(prof, fn, zeta);
      if ("error" in ex) return refuse(ex.error);
      const exact = ex;
      lines.push(`SDOF response at fn = ${n4(fn)} Hz, Q = ${fmtSig(Q, 3)} (ζ = ${fmtSig(zeta, 3)}); input ASD at fn ${n4(asd)} g²/Hz (log-log interpolation):`);
      lines.push({ math: "G_rms = sqrt(π/2 f_n Q ASD(f_n))", fallback: "Grms = √(π/2 · fn · Q · ASD(fn)) (Miles)" });
      lines.push({ math: "x_rms = {G_rms g}/{(2 π f_n)^2}", fallback: "x_rms = Grms·g/(2π·fn)²" });
      lines.push(`  Miles: ${n4(mi.grms)} g rms; relative displacement ${n4(mi.xRms * 1000)} mm rms, 3σ ${n4(mi.x3Sigma * 1000)} mm (g = ${STANDARD_GRAVITY} m/s²).`);
      lines.push(`  Exact over the profile (∫T²·ASD df, zero outside the band): ${n4(exact.grms)} g rms; relative displacement ${n4(exact.xRms * 1000)} mm rms, 3σ ${n4(3 * exact.xRms * 1000)} mm.`);
      const d = mi.grms / exact.grms - 1;
      lines.push(
        Math.abs(d) < 0.02
          ? `  Miles agrees with the exact response to ${pct(d)}: the profile is close to white around fn.`
          : `  Miles is ${pct(d)} ${d > 0 ? "above" : "below"} the exact response: the profile is not white around fn (or the band cuts off part of the response), so use the exact figure.`,
      );
      if (zeta > 0.1) lines.push(`  ζ = ${fmtSig(zeta, 3)} is more than light damping (Q below 5): Miles' derivation assumes a lightly damped system, so read it as an estimate.`);
      lines.push("Miles' equation assumes a single-degree-of-freedom, lightly damped item on a rigid base, excited by a PSD that is flat (white) around fn; 3σ is the usual Gaussian design value (exceeded about 0.27 % of the time).");
      outputs.push(
        { key: "asdFn", label: "Input ASD at fn", value: asd, unit: "g²/Hz" },
        { key: "milesGrms", label: "Response Grms (Miles)", value: mi.grms, unit: "g" },
        { key: "xRms", label: "RMS relative displacement (Miles)", value: mi.xRms * 1000, unit: "mm" },
        { key: "x3Sigma", label: "3σ relative displacement (Miles)", value: mi.x3Sigma * 1000, unit: "mm" },
        { key: "exactGrms", label: "Response Grms (exact)", value: exact.grms, unit: "g" },
        { key: "exactXRms", label: "RMS relative displacement (exact)", value: exact.xRms * 1000, unit: "mm" },
      );
      sdofFig = { fn, zeta, grms: exact.grms };
    } else lines.push("Give a natural frequency and Q for the response of a mounted item (Miles' equation and the exact SDOF response).");
    extra.push(plot(psdChartSvg(prof, sdofFig), sdofFig ? "Input PSD and SDOF response PSD" : "Input PSD profile", "Acceleration spectral density against frequency on log-log axes, breakpoints marked" + (sdofFig ? ", with the response PSD of the SDOF item and fn marked" : "")));
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Base excitation (sine)
// ---------------------------------------------------------------------------------------------------------------

const INPUT_OPTIONS = [
  { value: "g", label: "Acceleration in g" },
  { value: "acc", label: "Acceleration (m/s²; other units convert)" },
  { value: "disp", label: "Displacement (mm; other units convert)" },
];

const baseCalc: VibCalc = {
  id: "vib-base-excitation",
  name: "Base excitation: isolator transmissibility (sine)",
  group: "Vibration",
  unitContract: "converts",
  hint:
    "A box on isolators (or any mounted item) shaken by its base with a sine: the isolated natural frequency, the damping " +
    "(Q or ζ), the excitation frequency and the base amplitude (0-to-peak). Gives the transmissibility T = output/input, " +
    "the mass's acceleration and the isolator's deflection. Isolation starts only above r = f/fn = √2; below it the mount " +
    "amplifies. Sine input only: for a random input use Random vibration (Miles and the exact response).",
  fields: [
    { key: "fn", label: "Isolated natural frequency fn (Hz)", default: "25", kind: "text" },
    { key: "dkind", label: "Damping given as", default: "zeta", kind: "select", options: DAMP_OPTIONS },
    { key: "damp", label: "Q or ζ", default: "0.05", kind: "text" },
    { key: "f", label: "Excitation frequency f (Hz)", default: "100", kind: "text" },
    { key: "ikind", label: "Base input is", default: "g", kind: "select", options: INPUT_OPTIONS },
    { key: "amp", label: "Base amplitude (0-to-peak)", default: "2", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const fn = u.req("fn", "Hz", "Hz", "Natural frequency");
    const f = u.req("f", "Hz", "Hz", "Excitation frequency");
    const kind = r("ikind") === "acc" ? "acc" : r("ikind") === "disp" ? "disp" : "g";
    let input: BaseInput;
    if (kind === "g") {
      // The unit layer has no standard-gravity unit ("g" is the gram), so a g level is a plain number; a trailing "g" is allowed.
      const raw = (r("amp") ?? "").trim().replace(/[−–]/g, "-").replace(/\s*g$/i, "");
      const v = plain(raw);
      if (!Number.isFinite(v)) return refuse(`Base amplitude: "${(r("amp") ?? "").trim()}" is not a number of g. Choose "Acceleration (m/s²)" to type another unit.`);
      input = { kind: "acc", amplitude: v * STANDARD_GRAVITY };
    } else if (kind === "acc") {
      input = { kind: "acc", amplitude: u.req("amp", "m/s^2", "m/s²", "Base acceleration") };
    } else {
      input = { kind: "disp", amplitude: (u.req("amp", "mm", "mm", "Base displacement") ?? NaN) / 1000 };
    }
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const zeta = readDamping(r, "dkind", "damp");
    if (typeof zeta === "string") return refuse(zeta);
    const res = baseExcitation(fn, zeta, f, input);
    if (!res.ok) return refuse(res.error);
    const g = STANDARD_GRAVITY;
    const lines: EngLine[] = [];
    lines.push(`r = f/fn = ${n4(res.r)} (f = ${n4(f)} Hz, fn = ${n4(fn)} Hz), ζ = ${fmtSig(zeta, 3)} (Q = ${fmtSig(1 / (2 * zeta), 3)}).`);
    lines.push({ math: "T = sqrt({1 + (2 ζ r)^2}/{(1 - r^2)^2 + (2 ζ r)^2})", fallback: "T = √((1 + (2ζr)²)/((1 − r²)² + (2ζr)²))" });
    lines.push({ math: "Z = A/{ω_n^2} 1/sqrt((1 - r^2)^2 + (2 ζ r)^2)", fallback: "Z = (A/ωn²)/√((1 − r²)² + (2ζr)²), the isolator deflection for a base acceleration amplitude A" });
    lines.push(`Transmissibility T = ${n4(res.T)}: ${res.isolating ? `the mount ISOLATES (r > √2), passing ${pct(res.T)} of the input; isolation ${pct(1 - res.T)}.` : res.r > 1 / Math.SQRT2 ? "the mount AMPLIFIES: it is near resonance (r below √2, isolation only begins at r = √2)." : "the mount AMPLIFIES slightly (r below √2): the item follows its base."}`);
    lines.push(`Mass acceleration ${n4(res.absAcc / g)} g (${n4(res.absAcc)} m/s²) for a base input of ${n4(res.baseAcc / g)} g (${n4(res.baseAcc)} m/s²), 0-to-peak.`);
    lines.push(`Isolator deflection (relative displacement) ${n4(res.relDisp * 1000)} mm; base displacement ${n4(res.baseDisp * 1000)} mm, mass displacement ${n4(res.absDisp * 1000)} mm (0-to-peak).`);
    lines.push(`Resonance: T peaks at ${n4(res.peak.T)} at r = ${n4(res.peak.r)} (${n4(res.peak.r * fn)} Hz); the item passes through it on every sweep or run-up through ${n4(res.peak.r * fn)} Hz.`);
    lines.push("Model: linear SDOF on a rigid base with viscous damping, steady-state sine (no start-up transient); T is vibration.ts's transmissibility, the same as Vibration › Forced response & isolation. Above √2 more damping RAISES T.");
    const table: string[][] = [
      ["Quantity", "Value"],
      ["Frequency ratio r", n4(res.r)],
      ["Transmissibility T", n4(res.T)],
      ["Mass acceleration (g, 0-pk)", n4(res.absAcc / g)],
      ["Isolator deflection (mm, 0-pk)", n4(res.relDisp * 1000)],
      ["Peak T (at r)", `${n4(res.peak.T)} (r = ${n4(res.peak.r)})`],
    ];
    const outputs: EngOutput[] = [
      { key: "r", label: "Frequency ratio", value: res.r, unit: "" },
      { key: "T", label: "Transmissibility", value: res.T, unit: "" },
      { key: "absAccG", label: "Mass acceleration", value: res.absAcc / g, unit: "g" },
      { key: "relDispMm", label: "Isolator deflection", value: res.relDisp * 1000, unit: "mm" },
      { key: "absDispMm", label: "Mass displacement", value: res.absDisp * 1000, unit: "mm" },
      { key: "peakT", label: "Peak transmissibility", value: res.peak.T, unit: "" },
    ];
    return finish(lines, u.conversions, [
      { kind: "table", label: "Base excitation", rows: table.map((row) => row.map((c) => trueMinus(c))) },
      plot(transmissibilityChartSvg(zeta, res.r), "Transmissibility against frequency ratio", "Absolute transmissibility T against r = f/fn on log-log axes, with T = 1, the isolation crossover r = √2 and the operating point"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Shaft critical speed
// ---------------------------------------------------------------------------------------------------------------

const MASS_UNITS = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
];
const POS_UNITS = [
  { value: "m", label: "m" },
  { value: "mm", label: "mm" },
  { value: "in", label: "in" },
];

/** rad/s → rpm through the unit layer. */
const rpm = (w: number): number => convert(w, "rad/s", "rpm") ?? (w * 60) / (2 * Math.PI);

const shaftCalc: VibCalc = {
  id: "vib-shaft-critical",
  name: "Shaft critical speed (uniform shaft, point masses, Dunkerley)",
  group: "Vibration",
  unitContract: "converts",
  hint:
    "A round shaft on two bearings (simply supported). Give the material density for the shaft's own first criticals " +
    "(π/L)²√(EI/ρA), and/or paste point masses (discs, rotors, gears) as mass and distance from the left bearing, one per " +
    "line: Rayleigh's method from the static deflection (exact for one mass), and Dunkerley's combination of the shaft " +
    "and every mass. Results in rad/s and rpm; an operating speed within ±20 % of a critical is flagged.",
  fields: [
    { key: "E", label: "Young's modulus E (GPa)", default: "200 GPa", kind: "text" },
    { key: "d", label: "Shaft diameter (mm)", default: "50 mm", kind: "text" },
    { key: "di", label: "Bore diameter (mm; blank for solid)", default: "", kind: "text" },
    { key: "L", label: "Bearing span L (m)", default: "1 m", kind: "text" },
    { key: "rho", label: "Density ρ (kg/m³; blank for a massless shaft)", default: "7850 kg/m^3", kind: "text" },
    { key: "masses", label: "Point masses: mass, position from the left bearing", default: "20 0.5", kind: "block", rows: 4 },
    { key: "munit", label: "Mass unit", default: "kg", kind: "select", options: MASS_UNITS },
    { key: "xunit", label: "Position unit", default: "m", kind: "select", options: POS_UNITS },
    { key: "op", label: "Operating speed (rpm; blank for none)", default: "3000 rpm", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const E = u.req("E", "Pa", "Pa", "Young's modulus");
    const d = u.req("d", "m", "m", "Shaft diameter");
    const di = u.opt("di", "m", "m", "Bore diameter") ?? 0;
    const L = u.req("L", "m", "m", "Bearing span");
    const rho = u.opt("rho", "kg/m^3", "kg/m³", "Density");
    const op = u.opt("op", "rpm", "rpm", "Operating speed");
    // The pasted block's units come from the two selects, each factor through the unit layer.
    const mUnit = r("munit") === "lb" ? "lb" : "kg";
    const xUnit = r("xunit") === "mm" ? "mm" : r("xunit") === "in" ? "in" : "m";
    const mFactor = parseMeasured(`1 ${mUnit}`, "kg");
    const xFactor = parseMeasured(`1 ${xUnit}`, "m");
    if ("error" in mFactor || "error" in xFactor) return refuse("The mass or position unit could not be read.");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (!(E > 0)) return refuse("Young's modulus must be greater than zero.");
    if (!(L > 0)) return refuse("The bearing span must be greater than zero.");
    if (op !== null && !(op > 0)) return refuse("The operating speed must be greater than zero (or blank).");
    if (rho !== null && !(rho > 0)) return refuse("The density must be greater than zero (or blank for a massless shaft).");
    const sec = roundSection(d, di);
    if ("error" in sec) return refuse(sec.error);
    const s = sec;
    const hasMasses = (r("masses") ?? "").trim() !== "";
    if (rho === null && !hasMasses) return refuse("Give the shaft's density (for its own critical speeds), point masses, or both.");
    const lines: EngLine[] = [];
    const outputs: EngOutput[] = [];
    const table: string[][] = [["Critical speed", "ω (rad/s)", "rpm", "Hz"]];
    const rows: ShaftChartRow[] = [];
    const add = (label: string, w: number, key: string): void => {
      table.push([label, n4(w), n4(rpm(w)), n4(w / (2 * Math.PI))]);
      rows.push({ label, rpm: rpm(w) });
      outputs.push({ key: `${key}RadS`, label: `${label} (rad/s)`, value: w, unit: "rad/s" }, { key: `${key}Rpm`, label: `${label} (rpm)`, value: rpm(w), unit: "rpm" });
    };
    lines.push(`Shaft: ${di > 0 ? `hollow, ${n4(d * 1000)} mm outside, ${n4(di * 1000)} mm bore` : `solid, ${n4(d * 1000)} mm`}; I = ${n4(s.I)} m⁴, A = ${n4(s.A)} m², E = ${n4(E / 1e9)} GPa, bearing span ${n4(L)} m.`);
    let shaftW: number[] = [];
    if (rho !== null) {
      const ws = uniformShaftCriticals(E, s, rho, L, 3);
      if (!Array.isArray(ws)) return refuse(ws.error);
      shaftW = ws;
      lines.push({ math: "ω_n = ({n π}/L)^2 sqrt({E I}/{ρ A})", fallback: "ωₙ = (nπ/L)²·√(EI/(ρA))" });
      lines.push(`Shaft alone (ρ = ${n4(rho)} kg/m³, mass ${n4(rho * s.A * L)} kg): first critical ${n4(ws[0])} rad/s = ${n4(rpm(ws[0]))} rpm.`);
    }
    let masses: Array<{ m: number; x: number }> = [];
    let first: { w: number; how: string } | null = null;
    let shape: Array<[number, number]> = [];
    if (hasMasses) {
      const t = readRows(r("masses"), "Point masses", 2, SHAFT_MAX_MASSES, `mass in ${mUnit}, position in ${xUnit}`);
      if (typeof t === "string") return refuse(t);
      lines.push(...t.notes);
      masses = t.rows.map(([m, x]) => ({ m: m * mFactor.inTarget, x: x * xFactor.inTarget }));
      const ms = massShaft(E, s.I, L, masses);
      if (!ms.ok) return refuse(ms.error);
      shape = ms.shape;
      lines.push({ math: "ω^2 = {sum(i=1, N, m_i δ_i)}/{sum(i=1, N, m_i δ_i^2)}", fallback: "ω² = Σmᵢδᵢ / Σmᵢδᵢ² (Rayleigh; δᵢ = static deflection at mass i under the weights, per unit g)" });
      lines.push({ math: "1/{ω^2} = 1/{ω_s^2} + sum(i=1, N, 1/{ω_i^2})", fallback: "1/ω² = 1/ωs² + Σ 1/ωᵢ² (Dunkerley)" });
      masses.forEach((q, i) => lines.push(`  Mass ${i + 1}: ${n4(q.m)} kg at ${n4(q.x)} m; alone on the massless shaft ${n4(ms.alone[i])} rad/s = ${n4(rpm(ms.alone[i]))} rpm (static deflection under its weight ${n4(ms.selfInfluence[i] * q.m * STANDARD_GRAVITY * 1000)} mm).`));
      lines.push(`Rayleigh (all masses, shaft mass neglected): ${n4(ms.rayleigh)} rad/s = ${n4(rpm(ms.rayleigh))} rpm${masses.length === 1 ? " (exact for one mass)" : " (an upper bound on the masses' first critical)"}.`);
      add(masses.length === 1 ? "Mass on massless shaft" : "Masses (Rayleigh)", ms.rayleigh, "rayleigh");
      if (rho !== null || masses.length > 1) {
        const comps = [...(rho !== null ? [shaftW[0]] : []), ...ms.alone];
        const wd = dunkerley(comps);
        lines.push(`Dunkerley (${rho !== null ? "shaft + " : ""}${masses.length > 1 ? "every mass" : "the mass"}): ${n4(wd)} rad/s = ${n4(rpm(wd))} rpm (a lower bound on the first critical).`);
        add(rho !== null ? `Dunkerley (shaft + mass${masses.length > 1 ? "es" : ""})` : "Dunkerley (masses)", wd, "dunkerley");
        first = { w: wd, how: "Dunkerley" };
      } else first = { w: ms.rayleigh, how: "Rayleigh, exact for one mass" };
      if (rho !== null) {
        // The shaft's own mode row first: its rows lead the chart.
        table.splice(1, 0, ["Shaft alone, mode 1", n4(shaftW[0]), n4(rpm(shaftW[0])), n4(shaftW[0] / (2 * Math.PI))]);
        rows.unshift({ label: "Shaft alone, mode 1", rpm: rpm(shaftW[0]) });
        outputs.unshift({ key: "shaft1RadS", label: "Shaft alone, mode 1 (rad/s)", value: shaftW[0], unit: "rad/s" }, { key: "shaft1Rpm", label: "Shaft alone, mode 1 (rpm)", value: rpm(shaftW[0]), unit: "rpm" });
      }
    } else {
      shaftW.forEach((w, i) => add(`Shaft, mode ${i + 1}`, w, `shaft${i + 1}`));
      first = { w: shaftW[0], how: "uniform shaft" };
      const NS = 60;
      shape = Array.from({ length: NS + 1 }, (_, k) => [(L * k) / NS, Math.sin((Math.PI * k) / NS)] as [number, number]);
    }
    // Speed check: every critical that is a real mode of THIS model (with masses, only the first is computed).
    const checks: Array<{ w: number; name: string }> = hasMasses ? [{ w: first.w, name: `the first critical (${first.how})` }] : shaftW.map((w, i) => ({ w, name: `critical ${i + 1}` }));
    if (op !== null) {
      const opW = op * (2 * Math.PI) / 60;
      const near = checks.filter((c) => Math.abs(speedMargin(opW, c.w)) <= 0.2);
      if (near.length)
        for (const c of near) {
          const m = speedMargin(opW, c.w);
          lines.push(`WARNING: the operating speed ${n4(op)} rpm is within ±20 % of ${c.name}, ${n4(rpm(c.w))} rpm (${pct(m)} ${m >= 0 ? "above" : "below"} it). Move the critical (stiffer or shorter shaft, lighter or relocated masses) or the speed.`);
        }
      else if (opW > 1.2 * first.w)
        lines.push(`The operating speed ${n4(op)} rpm is more than 20 % above the first critical (${n4(rpm(first.w))} rpm): the shaft runs SUPERCRITICAL and passes through the critical on every run-up and coast-down.`);
      else lines.push(`The operating speed ${n4(op)} rpm is clear of the computed critical${checks.length > 1 ? "s" : ""} by more than 20 % (${pct(speedMargin(opW, first.w))} ${opW >= first.w ? "above" : "below"} the first).`);
      lines.push("The ±20 % separation margin is a common design convention, not a code requirement.");
      if (hasMasses) lines.push("With point masses only the FIRST critical is estimated; higher criticals are not computed.");
      outputs.push({ key: "marginPct", label: "Margin to the first critical", value: speedMargin(opW, first.w) * 100, unit: "%" });
    }
    lines.push("Model: Euler–Bernoulli shaft on rigid, simply supporting bearings; no gyroscopic stiffening, rotary inertia or shear deformation, no bearing or foundation flexibility (all of which lower or split real criticals). Rayleigh is an upper bound and Dunkerley a lower bound on the first critical.");
    const chartMasses = masses.map((q, i) => ({ x: q.x, label: masses.length > 1 ? `m${String(i + 1).replace(/\d/g, (c) => String.fromCharCode(0x2080 + Number(c)))}` : `${n4(q.m)} kg` }));
    const fig = shaftCriticalSvg(L, shape, chartMasses, rows, op, hasMasses ? undefined : "First mode shape of the uniform shaft, sin(πx/L)");
    return finish(lines, u.conversions, [
      { kind: "table", label: "Critical speeds", rows: table.map((row) => row.map((c) => trueMinus(c))) },
      plot(fig, "Shaft first mode shape and critical speeds", "The shaft between its bearings with its first mode shape and the masses, over a ladder of critical speeds in rpm with ±20 % bands and the operating speed"),
    ], outputs);
  },
};

/** The Release E vibration calculators, in dropdown order (group "Vibration", already in ENG_GROUP_ORDER). */
export const RANDOM_VIBRATION_CALCS: VibCalc[] = [randomCalc, baseCalc, shaftCalc];
