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
import { formatUnit } from "./units";

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
  { from: "section", output: "I", to: "column", field: "I", label: "Use I in Column buckling" },
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

/** A value as field text: enough digits to round-trip, plain (the field parser reads e-notation), with its unit. */
export function fieldText(value: number, unit: string): string {
  const s = Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : String(Number(value.toPrecision(12)));
  const u = unit.replace(/·/g, "*").replace(/²/g, "^2").replace(/³/g, "^3").replace(/⁴/g, "^4").replace(/⁻¹/g, "^-1").replace(/√([A-Za-zµΩ]+)/g, "$1^0.5");
  return u ? `${s} ${u}` : s;
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
    if (o && Number.isFinite(o.value)) {
      if (output && o.unit !== output.unit) return { ok: false, reason: `The output changed unit during the sweep (${output.unit} to ${o.unit}).` };
      output = output ?? o;
      ys.push(o.value);
    } else {
      ys.push(NaN);
      if (refused.length < 3) refused.push({ x, reason: firstLine(out.text) });
    }
  }
  if (!output) return { ok: false, reason: `The tool gave no ${req.output} anywhere in the range${refused.length ? `: ${refused[0].reason}` : "."}` };
  return { ok: true, xs, ys, unit: a.unit, output, refused };
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
  gum: { u: number; shares: Array<{ field: string; share: number }> };
  /** Draws the tool refused (an input pushed outside its validity); counted, not used. */
  refused: number;
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
  const at = (vals: number[]): EngOutput | null => {
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
    return o && Number.isFinite(o.value) ? o : null;
  };
  const centre = at(base.map((b) => b.value));
  if (!centre) return { ok: false, reason: `The tool gives no ${outputKey} at the values as typed.` };
  // First-order sensitivities by central differences (step: 10⁻⁴ of the uncertainty, or of the value when u = 0).
  const shares: Array<{ field: string; share: number }> = [];
  let var1 = 0;
  const contrib: number[] = [];
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    if (b.u === 0) {
      contrib.push(0);
      continue;
    }
    const h = b.u * 1e-4;
    const up = at(base.map((q, j) => (j === i ? q.value + h : q.value)));
    const dn = at(base.map((q, j) => (j === i ? q.value - h : q.value)));
    const c = up && dn ? ((up.value - dn.value) / (2 * h)) * b.u : NaN;
    contrib.push(c);
    var1 += c * c;
  }
  for (let i = 0; i < base.length; i++) shares.push({ field: base[i].field, share: var1 > 0 && Number.isFinite(contrib[i]) ? (contrib[i] * contrib[i]) / var1 : 0 });
  // The draws.
  const state = new Int32Array([seed | 0]);
  const z = new Float64Array(base.length + (base.length % 2));
  const vals: number[] = [];
  let refused = 0;
  for (let d = 0; d < n; d++) {
    fillNormals(state, z);
    const o = at(base.map((b, i) => b.value + b.u * z[i]));
    if (o) vals.push(o.value);
    else refused++;
  }
  if (vals.length < Math.min(20, n)) return { ok: false, reason: `Most draws were refused by the tool (${refused} of ${n}): the uncertainties take the inputs outside its range.` };
  const sorted = Float64Array.from(vals).sort();
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, vals.length - 1));
  const q = (p: number): number => {
    const k = p * (sorted.length - 1), i = Math.floor(k), f = k - i;
    return i + 1 < sorted.length ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
  };
  return { ok: true, output: centre, draws: vals.length, mean: m, sd, lo: q(0.025), hi: q(0.975), gum: { u: Math.sqrt(var1), shares }, refused, sorted };
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
    xlabel: axisLabel(fieldLabel, r.unit),
    ylabel: axisLabel(r.output.label, r.output.unit),
    xScale: log ? "log" : "linear",
  });
  return engReport(lines.map(trueMinus), [
    { kind: "plot", svg, caption: `${r.output.label} against ${fieldLabel}`, alt: `Line plot of ${r.output.label} against ${fieldLabel}`, w: 440, h: 300 },
  ]);
}

/** An uncertainty run as a result: mean, standard uncertainty, 95 % interval, first-order comparison, histogram. */
export function uncertaintyReport(r: UncertaintyResult, inputs: Array<{ label: string; text: string }>, toolName: string): AnalyzeOutput {
  const u = (v: number): string => fmtSig(v, 3) + unitTail(r.output.unit);
  const lines: string[] = [
    `${toolName}: uncertainty of ${r.output.label} from ${inputs.map((i) => `${i.label} ${i.text}`).join(", ")} (normal, independent, 1σ).`,
    `${r.output.label} = ${fmtSig(r.output.value, 4)}${unitTail(r.output.unit)} as typed; Monte Carlo mean ${fmtSig(r.mean, 4)}${unitTail(r.output.unit)}, standard uncertainty ${u(r.sd)}.`,
    `95 % coverage interval: ${fmtSig(r.lo, 4)} to ${fmtSig(r.hi, 4)}${unitTail(r.output.unit)} (${r.draws} draws${r.refused ? `; ${r.refused} refused by the tool and not used` : ""}).`,
    `First-order (GUM) standard uncertainty: ${u(r.gum.u)}; shares: ${r.gum.shares.map((s) => `${s.field} ${Math.round(s.share * 100)} %`).join(", ")}.`,
  ];
  if (r.gum.u > 0 && Math.abs(r.sd - r.gum.u) > 0.1 * r.gum.u) lines.push("The draws and the first-order estimate differ by more than 10 %: the output is not linear in its inputs over this spread, so quote the interval from the draws.");
  if (r.draws < 1000) lines.push(`With ${r.draws} draws the interval ends are good to a few per cent of the spread; each draw runs the whole tool, so the count is kept to what stays responsive.`);
  const hist = mcHistogramSvg(
    { sorted: r.sorted, mean: r.mean, lo: r.lo, hi: r.hi, gum: { value: r.output.value, u: r.gum.u } } as unknown as McResult,
    axisLabel(r.output.label, r.output.unit),
  );
  return engReport(lines.map(trueMinus), [
    { kind: "plot", svg: hist, caption: `Distribution of ${r.output.label}`, alt: `Histogram of ${r.output.label} draws with the first-order normal curve`, w: 440, h: 300 },
  ]);
}
