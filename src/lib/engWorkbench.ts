/**
 * The Engineering workbench (Release E, gap analysis items 4 and 13): what can be done with a result beyond reading
 * it — send a named output to another tool's field, sweep one input and plot an output, or propagate input
 * uncertainties to an output by Monte Carlo. Everything here works through a tool's own `compute` and its declared
 * `outputs` (analyzeBlocks.ts EngOutput): nothing is ever scraped from result text, and the swept or sampled values go
 * back in through `read` as text with their unit, so the tool's own unit reading applies unchanged.
 */
import type { AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { fmtSig } from "./axis";
import { engReport } from "./engReport";
import { fillNormals, mcHistogramSvg, type McResult } from "./monteCarlo";
import { trueMinus } from "./numberList";
import { buildPlotSvg } from "./plot";
import { convert, formatUnit, toSuperscript } from "./units";

export type EngCompute = (read: (k: string) => string) => AnalyzeOutput;

// ---------------------------------------------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------------------------------------------

/** One handoff: a source tool's named output to a target tool's field. */
export interface EngHandoff {
  from: string;
  output: string;
  to: string;
  field: string;
  /** The button: "Use M_max in Cross-section". */
  label: string;
  /**
   * The unit the value is written in for the target field (it must be a unit that field reads). Defaults to the
   * output's own unit. A target that reads a bare number in a fixed unit (a non-converting tool) gets `bareIn`.
   */
  unit?: string;
}

/** The handoff table. Grows as tools declare outputs; engWorkbench.test.ts checks every row names real keys. */
export const ENG_HANDOFFS: EngHandoff[] = [
  // The mechanics chain: beam → cross-section (moment and shear) → stress state (peak stresses; it reads plain numbers
  // in one unit, so the value goes in as MPa and the button says so).
  { from: "beam", output: "Mmax", to: "section", field: "M", label: "Use the peak moment in Cross-section" },
  { from: "beam", output: "Vmax", to: "section", field: "V", label: "Use the peak shear in Cross-section" },
  // A column buckles about the weak axis: the minor-axis I, never the bending one (a 50 × 200 rectangle's bending I
  // overstates the critical load sixteenfold). I and A go together (one button), so r = √(I/A) is the section's own.
  { from: "section", output: "Imin", to: "column", field: "I", label: "Use the minor-axis I in Column buckling" },
  { from: "section", output: "A", to: "column", field: "A", label: "Use A in Column buckling" },
  { from: "section", output: "sigma", to: "stress", field: "sx", label: "Use σ as σx in Stress state (MPa)", unit: "" },
  { from: "section", output: "tau", to: "stress", field: "txy", label: "Use τ as τxy in Stress state (MPa)", unit: "" },
  // Thermal: the wall's overall coefficient into both exchanger tools.
  { from: "wall", output: "U", to: "hx", field: "U", label: "Use U in Heat exchanger (LMTD)" },
  { from: "wall", output: "U", to: "hx-ntu", field: "U", label: "Use U in Exchanger rating (ε-NTU)" },
  // Optics: the cavity's waist into the beam tool.
  { from: "optics-resonator", output: "w0", to: "optics-gaussian", field: "w0", label: "Use w₀ in Gaussian beam" },
  // Energy and power.
  { from: "energy-solar", output: "Eyear", to: "energy-lcoe", field: "e", label: "Use the annual energy in LCOE" },
  { from: "energy-three-phase", output: "P", to: "energy-pf-correction", field: "p", label: "Use P in Power factor correction" },
  { from: "energy-three-phase", output: "PF", to: "energy-pf-correction", field: "pf1", label: "Use the power factor in Power factor correction", unit: "" },
  // Release E outputs part: further natural pairs. A target that reads a bare number in a fixed unit gets unit "" and
  // a label naming that unit; every other target converts the output's own unit.
  { from: "energy-wind", output: "Eyear", to: "energy-lcoe", field: "e", label: "Use the annual energy in LCOE" },
  { from: "energy-hydro", output: "Eyear", to: "energy-lcoe", field: "e", label: "Use the annual energy in LCOE" },
  { from: "energy-capacity-factor", output: "CF", to: "energy-wind", field: "cf", label: "Use the capacity factor in Wind turbine power", unit: "" },
  { from: "energy-capacity-factor", output: "CF", to: "energy-hydro", field: "cf", label: "Use the capacity factor in Hydropower", unit: "" },
  { from: "energy-weibull", output: "CF", to: "energy-wind", field: "cf", label: "Use the capacity factor in Wind turbine power", unit: "" },
  { from: "energy-three-phase", output: "Iline", to: "energy-voltage-drop", field: "i", label: "Use the line current in Cable voltage drop" },
  { from: "energy-pf-correction", output: "Iafter", to: "energy-voltage-drop", field: "i", label: "Use the corrected current in Cable voltage drop" },
  { from: "fatigue-endurance", output: "Se", to: "fatigue-safety", field: "se", label: "Use Se in Mean stress & factor of safety (MPa)", unit: "" },
  { from: "fatigue-endurance", output: "Se", to: "fatigue-life", field: "se", label: "Use Se in Finite life & cumulative damage (MPa)", unit: "" },
  { from: "fatigue-endurance", output: "Kf", to: "fatigue-safety", field: "kf", label: "Use Kf in Mean stress & factor of safety", unit: "" },
  { from: "chips-power", output: "Ptotal", to: "chips-thermal", field: "P", label: "Use the total power in Junction temperature" },
  { from: "aero-polar", output: "drag", to: "aero-climb", field: "D", label: "Use the drag in Climb rate & glide" },
  { from: "aero-isa", output: "rhoisa", to: "energy-wind", field: "rho", label: "Use the air density in Wind turbine power" },
  { from: "aero-isa", output: "rhoisa", to: "body-drag", field: "rho", label: "Use the air density in Drag on a body" },
  { from: "pipe", output: "hLoss", to: "pump-npsh", field: "hloss", label: "Use the head loss as the suction-line loss in Pump NPSH" },
  { from: "robotics-ik", output: "theta1a", to: "robotics-jacobian", field: "t1", label: "Use θ1 (first branch) in Jacobian (degrees)", unit: "" },
  { from: "robotics-ik", output: "theta2a", to: "robotics-jacobian", field: "t2", label: "Use θ2 (first branch) in Jacobian (degrees)", unit: "" },
  { from: "video-bitrate", output: "Rcomp", to: "video-stream", field: "rate", label: "Use the bitrate in Streaming bandwidth" },
  { from: "video-bitrate", output: "Rcomp", to: "video-interface", field: "stream", label: "Use the bitrate as the recorded stream rate" },
];

/** The handoffs a result offers: its tool's rows whose output it actually produced. */
export function handoffsFor(calcId: string, out: AnalyzeOutput, table: EngHandoff[] = ENG_HANDOFFS): Array<EngHandoff & { value: EngOutput }> {
  if (out.ok === false || !out.outputs?.length) return [];
  const rows: Array<EngHandoff & { value: EngOutput }> = [];
  for (const h of table) {
    if (h.from !== calcId) continue;
    const v = out.outputs.find((o) => o.key === h.output);
    // A value with no unit is never sent to a field that converts (it would be read in that field's SI unit) unless
    // the row says the target reads a bare number (`unit: ""`, for same-unit tools whose label names the unit).
    if (v && Number.isFinite(v.value) && (v.unit !== "" || h.unit !== undefined)) rows.push({ ...h, value: v });
  }
  return rows;
}

/**
 * The handoffs a result offers, one per target tool: rows into the same tool travel together (beam M and V, section
 * I and A, three-phase P and PF), because every tool switch re-renders the target's fields from its defaults — two
 * separate buttons could never be combined, and one alone would mix a sent I with the column's default A.
 */
export function handoffGroups(calcId: string, out: AnalyzeOutput, table: EngHandoff[] = ENG_HANDOFFS): Array<{ to: string; rows: Array<EngHandoff & { value: EngOutput }> }> {
  const groups: Array<{ to: string; rows: Array<EngHandoff & { value: EngOutput }> }> = [];
  for (const r of handoffsFor(calcId, out, table)) {
    const g = groups.find((q) => q.to === r.to);
    if (g) {
      // One field takes one value: a second source for the same field (none today) keeps the first.
      if (!g.rows.some((q) => q.field === r.field)) g.rows.push(r);
    } else groups.push({ to: r.to, rows: [r] });
  }
  return groups;
}

/** The button for a handoff group: the row's own label alone, or the outputs named together. */
export function handoffGroupLabel(rows: Array<EngHandoff & { value: EngOutput }>, targetName: string): string {
  if (rows.length === 1) return rows[0].label;
  const names = rows.map((r) => {
    const l = r.value.label;
    // "Area" → "area", but a symbol or an acronym ("I", "PF", "θ1") keeps its case.
    return /^[A-Z][a-z]/.test(l) ? l[0].toLowerCase() + l.slice(1) : l;
  });
  return `Use ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} in ${targetName}`;
}

const SUPER_DIGIT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** A value as field text: enough digits to round-trip, plain (the field parser reads e-notation), with its unit. */
export function fieldText(value: number, unit: string): string {
  const s = Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : String(Number(value.toPrecision(12)));
  // Superscript exponents back to carets as a whole run: cm⁻³ → cm^-3 (a digit-by-digit swap gave cm⁻^3, unreadable).
  const u = unit
    .replace(/·/g, "*")
    .replace(/(⁻?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_m, neg: string, ds: string) => `^${neg ? "-" : ""}${[...ds].map((d) => SUPER_DIGIT[d]).join("")}`)
    .replace(/√([A-Za-zµΩ]+)/g, "$1^0.5");
  return u ? `${s} ${u}` : s;
}

/**
 * Whether a field's text is one number with an optional unit, so a sweep or an uncertainty can vary it. Lists
 * ("0.3, 0.6", "50, 200"), typed states ("0.6|0⟩ + 0.8i|1⟩"), timecodes and bit strings start with a number too, but
 * varying only their first number would silently leave the rest fixed.
 */
export function variableField(text: string): boolean {
  const t = text.trim();
  const v = splitValue(t);
  if (!v) return false;
  // A bit string or a zero-padded code ("0101", "007"), not a quantity.
  if (/^0\d/.test(t)) return false;
  const u = v.unit.trim();
  if (!u) return true;
  if (u === "%") return true;
  // A separator or a state symbol after the first number: a list, a timecode, a typed state.
  if (/[,;:|⟩⟨+]/.test(u)) return false;
  // A second number: any digit left once a leading "1/" (0.5 1/m) and caret exponents (cm^-3) are set aside
  // ("2048 2048", "1/125 s"). Units the converter does not know (dBm, TFLOP/s, 100k, 0.5π) stay variable: the tool
  // reads its own field text, so the swept value goes back in exactly as the user wrote the unit.
  return !/\d/.test(u.replace(/^1\s*\//, "/").replace(/\^[-−+]?\d+(?:\.\d+)?/g, ""));
}

/** A field's label as a name in prose and on an axis: no example, no unit tail, balanced brackets, no underscores. */
export function fieldName(label: string): string {
  let s = label.replace(/\s*\((?:e\.g\.|blank|when|typed)[^)]*\)/gi, "");
  // The name ends at the first comma outside brackets: "Span, m" → "Span"; "Fracture toughness K_IC, Pa·√m (MPa·√m,
  // ksi·√in)" → "Fracture toughness KIC"; "Second moment of area (minor axis), m^4" keeps its bracket.
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth = Math.max(0, depth - 1);
    else if (s[i] === "," && depth === 0) {
      s = s.slice(0, i);
      break;
    }
  }
  // An opening bracket left unclosed: cut there.
  const open = s.lastIndexOf("("), close = s.lastIndexOf(")");
  if (open > close) s = s.slice(0, open);
  return typesetName(s.replace(/_\{?([A-Za-z0-9]+)\}?/g, "$1").replace(/—/g, "-").trim());
}

/** Carets and e-notation in a label typeset: "M^2" → M², "1/e^2" → 1/e², "1e-6" → 10⁻⁶, "2.5e3" → 2.5×10³. */
function typesetName(s: string): string {
  return trueMinus(
    s
      .replace(/\b(\d+(?:\.\d+)?)[eE]([-+]?\d+)\b/g, (_m, a: string, e: string) => `${a === "1" ? "" : `${a}×`}10${toSuperscript(String(Number(e)))}`)
      // A bracketed exponent "^(−1)" loses its brackets; a bare one "^-6)" leaves the bracket after it alone.
      .replace(/\^(?:\(([-−+]?\d+(?:\.\d+)?)\)|([-−+]?\d+(?:\.\d+)?))/g, (_m, b: string | undefined, e: string | undefined) => toSuperscript((b ?? e ?? "").replace(/−/g, "-"))),
  );
}

/**
 * Names for a tool's fields, distinct within the tool: the short name where it is unique, the fuller label
 * (example and unit notes still dropped) where short names collide — "A, first angle" and "A, second angle" are not
 * both "A".
 */
export function fieldNames(fields: Array<{ key: string; label: string }>): Record<string, string> {
  const short = fields.map((f) => fieldName(f.label));
  const out: Record<string, string> = {};
  fields.forEach((f, i) => {
    const clash = short.filter((n) => n === short[i]).length > 1;
    out[f.key] = clash ? typesetName(f.label.replace(/\s*\((?:e\.g\.|blank|when|typed)[^)]*\)/gi, "").replace(/_\{?([A-Za-z0-9]+)\}?/g, "$1").trim()) : short[i];
  });
  return out;
}

/** A typed field value for prose: the number typeset (×10ⁿ, true minus) and the unit formatted. */
export function displayValue(text: string): string {
  const v = splitValue(text);
  if (!v) return trueMinus(text.trim());
  const u = v.unit.trim();
  // The digits as typed (68 °F stays 68, not 68.0000); e-notation typeset as ×10ⁿ.
  const raw = (NUM.exec(text.replace(/−/g, "-")) as RegExpExecArray)[1];
  const m = /^([+-]?[\d.]+)[eE]([-+]?\d+)$/.exec(raw);
  const num = m ? `${Number(m[1]) === 1 ? "" : `${m[1]}×`}10${toSuperscript(String(Number(m[2])))}` : raw;
  return trueMinus(num) + (u ? (u === "%" ? " %" : ` ${formatUnit(u)}`) : "");
}

/** Lone temperature units, where a percentage depends on the scale the value was typed in. */
const OFFSET_TEMPERATURE = /^(°C|°F|degC|degF|C°|F°|celsius|fahrenheit)$/i;

/**
 * A typed ± uncertainty for a field holding `fieldValue`: "0.5" (the field's unit), "0.5 mm" (converted into the
 * field's unit, as a difference), or "2 %" / "2 percent" (relative). Refused: a unit of the wrong quantity, or a
 * percentage of a temperature on an offset scale (1 % of 20 °C is not 1 % of 293.15 K).
 */
export function parseUncertainty(text: string, fieldValue: string): { u: number; relative: boolean } | { error: string } {
  const t = text.trim().replace(/−/g, "-");
  const v = splitValue(t);
  const fv = splitValue(fieldValue);
  if (!v || v.value < 0 || !fv) return { error: `"${text}" is not an uncertainty: write a number in the field's unit, or a percentage such as 2 %.` };
  const unit = v.unit.trim();
  if (unit === "%" || /^per\s*cent$|^percent$/i.test(unit)) {
    if (fv.unit.trim() === "%")
      return { error: `The field is itself a percentage, so "${text}" could mean percentage points or a relative per cent: write the uncertainty in percentage points as a plain number (for example 2 for ${displayValue(fieldValue)} ± 2 points).` };
    if (OFFSET_TEMPERATURE.test(fv.unit.trim()))
      return { error: `A percentage of ${displayValue(fieldValue)} depends on the temperature scale: give the uncertainty in degrees instead (for example 0.5 K).` };
    return { u: v.value, relative: true };
  }
  if (!unit) return { u: v.value, relative: false };
  const target = fv.unit.trim();
  if (!target) return { error: `The field holds a bare number, so its ± cannot be "${text}": write the uncertainty as a plain number in the same unit.` };
  // A temperature difference unit (Δ°C, Δ°F, ΔK) on a °C or °F field: by the degree size alone.
  if (OFFSET_TEMPERATURE.test(target)) {
    const k = convert(v.value, unit, "ΔK");
    if (k !== null && Number.isFinite(k)) return { u: Math.abs(/F/i.test(target) ? (k * 9) / 5 : k), relative: false };
  }
  // A difference: both ends converted, so an offset scale (°F into °C) contributes only its factor.
  const a = convert(v.value, unit, target), b = convert(0, unit, target);
  if (a === null || b === null || !Number.isFinite(a - b)) return { error: `"${unit}" is not a unit of the same quantity as ${formatUnit(target)}.` };
  return { u: Math.abs(a - b), relative: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared fields (a transfer function typed once, used by every control tool)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Tools whose fields of the same key hold the same thing: switching between them carries the typed values over
 * instead of resetting to defaults. The eight control tools share the plant's transfer function.
 */
export const SHARED_FIELD_SETS: Array<{ tools: string[]; keys: string[] }> = [
  {
    tools: ["control-tf", "control-step", "control-bode", "control-pid", "control-rlocus", "control-nyquist", "control-leadlag", "control-c2d"],
    keys: ["num", "den"],
  },
];

/** The values to carry from one tool to another: shared keys the user changed from the old tool's default. */
export function carryOver(
  fromId: string,
  toId: string,
  values: Record<string, string>,
  defaults: Record<string, string>,
  sets: Array<{ tools: string[]; keys: string[] }> = SHARED_FIELD_SETS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sets) {
    if (!s.tools.includes(fromId) || !s.tools.includes(toId) || fromId === toId) continue;
    for (const k of s.keys) if (k in values && values[k] !== defaults[k]) out[k] = values[k];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Typed values: "12 kN" → 12 and "kN"
// ---------------------------------------------------------------------------------------------------------------

const NUM = /^\s*([+-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/;

/** A field value split into its number and the unit text after it; null when it does not start with a number. */
export function splitValue(text: string): { value: number; unit: string } | null {
  const m = NUM.exec(text.replace(/−/g, "-"));
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: m[2] } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Parameter sweep
// ---------------------------------------------------------------------------------------------------------------

export const SWEEP_MAX_POINTS = 41;

export interface SweepRequest {
  field: string;
  from: string;
  to: string;
  points: number;
  log: boolean;
  output: string;
}

export interface SweepResult {
  ok: true;
  /** The swept values (in the unit typed) and the output at each; NaN where the tool refused that input. */
  xs: number[];
  ys: number[];
  unit: string;
  output: EngOutput;
  /** Inputs the tool refused, with its reason (the first few). */
  refused: Array<{ x: number; reason: string }>;
}

/** Runs the tool once per swept value of one field, reading one named output. */
export function runSweep(compute: EngCompute, read: (k: string) => string, req: SweepRequest): SweepResult | { ok: false; reason: string } {
  const a = splitValue(req.from), b = splitValue(req.to);
  if (!a || !b) return { ok: false, reason: "Give the sweep's From and To as numbers (with the field's unit if it takes one)." };
  if (a.unit !== b.unit) return { ok: false, reason: `From is in "${a.unit || "no unit"}" and To in "${b.unit || "no unit"}": write both in the same unit.` };
  const n = Math.round(req.points);
  if (!(n >= 2 && n <= SWEEP_MAX_POINTS)) return { ok: false, reason: `Use 2 to ${SWEEP_MAX_POINTS} points.` };
  if (a.value === b.value) return { ok: false, reason: "From and To are the same value: there is nothing to sweep." };
  if (req.log && !(a.value > 0 && b.value > 0)) return { ok: false, reason: "A logarithmic sweep needs From and To both greater than zero." };
  const xs: number[] = [], ys: number[] = [], refused: SweepResult["refused"] = [];
  let output: EngOutput | null = null;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = req.log ? a.value * Math.pow(b.value / a.value, t) : a.value + t * (b.value - a.value);
    const text = fieldText(x, a.unit);
    let out: AnalyzeOutput;
    try {
      out = compute((k) => (k === req.field ? text : read(k)));
    } catch (e) {
      out = { text: (e as Error).message, ok: false };
    }
    const o = out.ok === false ? undefined : out.outputs?.find((q) => q.key === req.output);
    xs.push(x);
    const y = o && Number.isFinite(o.value) ? (output ? inUnit(o, output.unit) : o.value) : null;
    if (o && y === null && output) return { ok: false, reason: `The output changed to a unit that cannot be compared during the sweep (${output.unit} to ${o.unit}).` };
    if (o && y !== null) {
      output = output ?? o;
      ys.push(y);
    } else {
      ys.push(NaN);
      if (refused.length < 3) refused.push({ x, reason: firstLine(out.text) });
    }
  }
  if (!output) return { ok: false, reason: `The tool gave no ${req.output} anywhere in the range${refused.length ? `: ${refused[0].reason}` : "."}` };
  return { ok: true, xs, ys, unit: a.unit, output, refused };
}

/**
 * An output's value in `unit`. Tools pick a readable unit per result (990 fs, then 1.01 ps), so values from different
 * runs are converted before they are compared or averaged; null when the units cannot be converted.
 */
function inUnit(o: EngOutput, unit: string): number | null {
  if (o.unit === unit) return o.value;
  const v = convert(o.value, o.unit, unit);
  return v !== null && Number.isFinite(v) ? v : null;
}

const firstLine = (s: string): string => (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 160);

// ---------------------------------------------------------------------------------------------------------------
// Uncertainty (Monte Carlo through the tool's own compute)
// ---------------------------------------------------------------------------------------------------------------

export interface UncertainInput {
  field: string;
  /** Standard uncertainty (1σ), in the unit the field's value is typed in; or a percentage of it when `relative`. */
  u: number;
  relative: boolean;
}

export interface UncertaintyResult {
  ok: true;
  output: EngOutput;
  draws: number;
  mean: number;
  sd: number;
  /** The 95 % coverage interval (2.5 and 97.5 percentiles of the draws). */
  lo: number;
  hi: number;
  /** First-order (GUM) standard uncertainty from central-difference sensitivities, with each input's share. */
  gum: { u: number; shares: Array<{ field: string; share: number }>; unavailable: string[] };
  /** Draws the tool refused (an input pushed outside its validity); counted, not used. */
  refused: number;
  /** Draws run (the time budget can stop the run before the requested count). */
  attempted: number;
  sorted: Float64Array;
}

/**
 * Propagates normal input uncertainties to one output. The draws use the Monte Carlo engine's seeded normal
 * generator (monteCarlo.ts fillNormals), so a run is reproducible. `draws` is the caller's budget: each draw runs the
 * whole tool (figures included), so the pane sizes it to stay responsive and says how many it used.
 */
export function runUncertainty(
  compute: EngCompute,
  read: (k: string) => string,
  inputs: UncertainInput[],
  outputKey: string,
  draws: number,
  seed = 20261023,
  /** Wall-clock budget for the draws, ms: each draw runs the whole tool synchronously, and a busy pane is a frozen Word. */
  budgetMs = 4000,
  now: () => number = () => Date.now(),
): UncertaintyResult | { ok: false; reason: string } {
  if (!inputs.length) return { ok: false, reason: "Give at least one input a ± uncertainty." };
  const n = Math.max(20, Math.min(4000, Math.round(draws)));
  const base: Array<{ field: string; value: number; unit: string; u: number }> = [];
  for (const inp of inputs) {
    const v = splitValue(read(inp.field));
    if (!v) return { ok: false, reason: `"${inp.field}" does not hold a number to vary.` };
    const u = inp.relative ? (Math.abs(v.value) * inp.u) / 100 : inp.u;
    if (!(u >= 0) || !Number.isFinite(u)) return { ok: false, reason: `The uncertainty of "${inp.field}" is not a non-negative number.` };
    base.push({ field: inp.field, value: v.value, unit: v.unit, u });
  }
  let centreUnit: string | null = null;
  // The output in the centre's unit (a tool may switch fs to ps between draws); null when refused or not comparable.
  const at = (vals: number[]): number | null => {
    let out: AnalyzeOutput;
    try {
      out = compute((k) => {
        const i = base.findIndex((b) => b.field === k);
        return i < 0 ? read(k) : fieldText(vals[i], base[i].unit);
      });
    } catch {
      return null;
    }
    const o = out.ok === false ? undefined : out.outputs?.find((q) => q.key === outputKey);
    if (!o || !Number.isFinite(o.value)) return null;
    return centreUnit === null ? o.value : inUnit(o, centreUnit);
  };
  let centreOut: EngOutput | null = null;
  {
    let out: AnalyzeOutput | null = null;
    try {
      out = compute((k) => {
        const i = base.findIndex((b) => b.field === k);
        return i < 0 ? read(k) : fieldText(base[i].value, base[i].unit);
      });
    } catch {
      out = null;
    }
    const o = out && out.ok !== false ? out.outputs?.find((q) => q.key === outputKey) : undefined;
    if (o && Number.isFinite(o.value)) centreOut = o;
  }
  if (!centreOut) return { ok: false, reason: `The tool gives no ${outputKey} at the values as typed.` };
  const centre: EngOutput = centreOut;
  centreUnit = centre.unit;
  // First-order sensitivities by central differences (step: 10⁻⁴ of the uncertainty); a step the tool refuses on one
  // side falls back to a one-sided difference, and an input refused on both sides makes the estimate unavailable
  // rather than NaN.
  const contrib: number[] = [];
  const noSlope: string[] = [];
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    if (b.u === 0) {
      contrib.push(0);
      continue;
    }
    const h = b.u * 1e-4;
    const up = at(base.map((q, j) => (j === i ? q.value + h : q.value)));
    const dn = at(base.map((q, j) => (j === i ? q.value - h : q.value)));
    const slope = up !== null && dn !== null ? (up - dn) / (2 * h) : up !== null ? (up - centre.value) / h : dn !== null ? (centre.value - dn) / h : NaN;
    if (!Number.isFinite(slope)) noSlope.push(b.field);
    contrib.push(slope * b.u);
  }
  const var1 = noSlope.length ? NaN : contrib.reduce((s, c) => s + c * c, 0);
  const shares = base.map((b, i) => ({ field: b.field, share: var1 > 0 ? (contrib[i] * contrib[i]) / var1 : 0 }));
  // The draws, within the time budget.
  const state = new Int32Array([seed | 0]);
  const z = new Float64Array(base.length + (base.length % 2));
  const vals: number[] = [];
  let refused = 0, attempted = 0;
  const t0 = now();
  for (let d = 0; d < n; d++) {
    if (d >= 20 && now() - t0 > budgetMs) break;
    fillNormals(state, z);
    attempted++;
    const o = at(base.map((b, i) => b.value + b.u * z[i]));
    if (o !== null) vals.push(o);
    else refused++;
  }
  if (vals.length < 20) return { ok: false, reason: `Too few draws were usable (${vals.length} of ${attempted}; ${refused} refused by the tool): the uncertainties take the inputs outside its range, or the tool is too slow to sample.` };
  // Refused draws are not a random loss: they cut one tail off the distribution, so the mean and interval of the rest
  // are biased. Beyond a fifth of the draws, there is no honest summary to give.
  if (refused > 0.2 * attempted) return { ok: false, reason: `The tool refused ${refused} of ${attempted} draws: the uncertainties take the inputs well outside its range, so the remaining draws would describe a cut-off distribution. Narrow the uncertainties.` };
  const sorted = Float64Array.from(vals).sort();
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, vals.length - 1));
  const q = (p: number): number => {
    const k = p * (sorted.length - 1), i = Math.floor(k), f = k - i;
    return i + 1 < sorted.length ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
  };
  return { ok: true, output: centre, draws: vals.length, mean: m, sd, lo: q(0.025), hi: q(0.975), gum: { u: Math.sqrt(var1), shares, unavailable: noSlope }, refused, attempted, sorted };
}

// ---------------------------------------------------------------------------------------------------------------
// Reports (typeset text + a figure, insertable like any Engineering result)
// ---------------------------------------------------------------------------------------------------------------

const unitTail = (u: string): string => (u ? ` ${formatUnit(u)}` : "");
const axisLabel = (label: string, unit: string): string => (unit ? `${label} (${formatUnit(unit)})` : label);

/** A sweep as a result: the swept range, the output's extremes, refusals named, and the output-against-input plot. */
export function sweepReport(r: SweepResult, fieldLabel: string, toolName: string, log: boolean): AnalyzeOutput {
  const pts = r.xs.map((x, i) => ({ x, y: r.ys[i] })).filter((p) => Number.isFinite(p.y));
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const at = (v: number): string => fmtSig(r.xs[r.ys.indexOf(v)], 4) + unitTail(r.unit);
  const lines: string[] = [
    `${toolName}: ${r.output.label} as ${fieldLabel} varies from ${fmtSig(r.xs[0], 4)}${unitTail(r.unit)} to ${fmtSig(r.xs[r.xs.length - 1], 4)}${unitTail(r.unit)} (${r.xs.length} points${log ? ", logarithmic spacing" : ""}).`,
    `Smallest ${r.output.label}: ${fmtSig(lo, 4)}${unitTail(r.output.unit)} at ${at(lo)}; largest: ${fmtSig(hi, 4)}${unitTail(r.output.unit)} at ${at(hi)}.`,
  ];
  const nRef = r.ys.filter((v) => !Number.isFinite(v)).length;
  if (nRef) lines.push(`${nRef} of ${r.xs.length} points were refused by the tool (left out of the plot): ${r.refused.map((q) => `at ${fmtSig(q.x, 4)}${unitTail(r.unit)}, ${q.reason}`).join("; ")}.`);
  lines.push("Each point is the tool's own calculation with only this input changed.");
  const svg = buildPlotSvg([{ points: pts, type: "line", color: "#2563eb", label: r.output.label }], {
    width: 440,
    height: 300,
    xlabel: trueMinus(axisLabel(fieldLabel, r.unit)),
    ylabel: trueMinus(axisLabel(r.output.label, r.output.unit)),
    xScale: log ? "log" : "linear",
  });
  return engReport(lines.map(trueMinus), [
    { kind: "plot", svg, caption: trueMinus(`${r.output.label} against ${fieldLabel}`), alt: `Line plot of ${r.output.label} against ${fieldLabel}`, w: 440, h: 300 },
  ]);
}

/** An uncertainty run as a result: mean, standard uncertainty, 95 % interval, first-order comparison, histogram. */
export function uncertaintyReport(
  r: UncertaintyResult,
  inputs: Array<{ label: string; text: string }>,
  toolName: string,
  /** Field names by key, for the shares (never the internal key). */
  names: Record<string, string> = {},
): AnalyzeOutput {
  const u = (v: number): string => fmtSig(v, 3) + unitTail(r.output.unit);
  const name = (k: string): string => names[k] ?? k;
  const gumOk = Number.isFinite(r.gum.u);
  const lines: string[] = [
    `${toolName}: uncertainty of ${r.output.label} from ${inputs.map((i) => `${i.label} ${i.text}`).join(", ")} (normal, independent, 1σ).`,
    `${r.output.label} = ${fmtSig(r.output.value, 4)}${unitTail(r.output.unit)} as typed; Monte Carlo mean ${fmtSig(r.mean, 4)}${unitTail(r.output.unit)}, standard uncertainty ${u(r.sd)}.`,
    `95 % coverage interval: ${fmtSig(r.lo, 4)} to ${fmtSig(r.hi, 4)}${unitTail(r.output.unit)} (${r.draws} draws).`,
    gumOk
      ? `First-order (GUM) standard uncertainty: ${u(r.gum.u)}; shares: ${r.gum.shares.map((s) => `${name(s.field)} ${Math.round(s.share * 100)} %`).join(", ")}.`
      : `No first-order (GUM) estimate: the tool refuses a small step either side of ${r.gum.unavailable.map(name).join(", ")} as typed, so its sensitivity there is not defined.`,
  ];
  if (r.refused)
    lines.push(`${r.refused} of ${r.attempted} draws were refused by the tool (inputs pushed outside its range) and left out: the distribution above is cut off on that side, so its mean and interval are biased by up to that fraction.`);
  if (gumOk && r.gum.u > 0 && Math.abs(r.sd - r.gum.u) > 0.1 * r.gum.u) lines.push("The draws and the first-order estimate differ by more than 10 %: the output is not linear in its inputs over this spread, so quote the interval from the draws.");
  if (r.draws < 1000) lines.push(`With ${r.draws} draws the interval ends are good to a few per cent of the spread; each draw runs the whole tool, so the count is kept to what stays responsive.`);
  const hist = mcHistogramSvg(
    { sorted: r.sorted, mean: r.mean, lo: r.lo, hi: r.hi, gum: { value: r.output.value, u: gumOk ? r.gum.u : 0 } } as unknown as McResult,
    axisLabel(r.output.label, r.output.unit),
  );
  return engReport(lines.map(trueMinus), [
    { kind: "plot", svg: hist, caption: `Distribution of ${r.output.label}`, alt: `Histogram of ${r.output.label} draws${gumOk ? " with the first-order normal curve" : ""}`, w: 440, h: 300 },
  ]);
}
