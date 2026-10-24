// Pane glue for the circuit transient calculator ("Transient response", group
// Electronics). Kept OUT of taskpane.ts so the exact object the pane registers can
// be tested (nothing can import the pane under jest), the same pattern as
// controlCalcs.ts / titrationCalcs.ts.
//
// The netlist is the SAME language as the DC operating point and AC response tools:
// circuit.ts parses it, so one netlist gives all three answers. What this tool adds
// is time-varying sources (PULSE, SIN, PWL; parsed in circuit.ts too) and the
// engine in circuitTransient.ts. No number is computed here; this file adds the
// wording, the display contract (U+2212 minus, ×10ⁿ never e-notation, µs/ms on
// the axes, no em dash in an ok result) and the figure.

import type { EngUnitContract } from "./engCalc";
import type { AnalyzeOutput, AnalyzeBlock } from "./analyzeBlocks";
import { engReport, plainDashes } from "./engReport";
import { trueMinus } from "./numberList";
import { parseNetlist, parseValue, netlistLines, nodeList, isGround } from "./circuit";
import {
  solveTransient,
  traceAt,
  fmtNum,
  fmtSeconds,
  timeUnit,
  BE_RUN,
  TRANSIENT_MAX_ELEMENTS,
  TRANSIENT_MAX_STEPS,
  type TransientOk,
} from "./circuitTransient";
import { buildPlotSvg, type Series } from "./plot";

/** The pane's AnalyzeField, structurally (taskpane.ts does not export it). */
export interface CircuitField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text";
  rows?: number;
}
/** The pane's EngCalc, structurally; the group is the existing "Electronics" heading. */
export interface CircuitCalc {
  id: string;
  name: string;
  group: "Electronics";
  hint: string;
  fields: CircuitField[];
  /** The unit contract this tool keeps (engCalc.ts EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

/** Most traces drawn in one figure; more is a tangle, not a figure. */
export const MAX_TRACES = 6;
/** Points per drawn trace before min/max decimation (a spike survives it). */
const DRAW_POINTS = 1200;
/** Figure size, shared with the corpus. */
export const TRANSIENT_FIG = { w: 420, h: 270 };

/** The method, stated once, in the words the brief settles on. */
export const METHOD_SENTENCE =
  "Method: trapezoidal with backward-Euler starts at discontinuities " +
  `(${BE_RUN} backward-Euler steps at t = 0 and after every source corner, which keeps the trapezoidal ` +
  "rule from ringing), from the DC operating point with every source at its t = 0 value (capacitors open, " +
  "inductors shorted, as in SPICE).";

/** Device letters SPICE uses that this tool does not model, named for the refusal. */
const DEVICE: Record<string, string> = {
  D: "a diode",
  Q: "a bipolar transistor",
  M: "a MOSFET",
  J: "a JFET",
  Z: "a MESFET",
  X: "a subcircuit call",
  S: "a voltage-controlled switch",
  W: "a current-controlled switch",
  T: "a transmission line",
  O: "a lossy transmission line",
  U: "a distributed RC line",
  B: "a behavioural source",
  A: "a code model",
  N: "a device model",
  P: "a coupled transmission line",
  Y: "a transmission line",
};

/** Everything the transient tool cannot read, refused by name before the parser sees it. */
function unsupportedLine(text: string): string | null {
  for (const line of netlistLines(text)) {
    const first = line.split(/[\s,]+/)[0] ?? "";
    if (first.startsWith("+"))
      return (
        "A line starting with + is a SPICE continuation of the line above, which this tool does not join. Put " +
        "the whole element (for example a long PWL list) on one line."
      );
    if (first.startsWith(".")) {
      return (
        `"${first}" is a SPICE control line; this tool reads element lines only. Put the stop time and time ` +
        "step in their fields and delete the line (and any .model line: transient analysis covers R, L, C, V, I, the " +
        "linear controlled sources E, G, H, F and coupled inductors K)."
      );
    }
    const fields = line.split(/[\s,]+/).filter(Boolean);
    // User text is echoed only inside straight double quotes (the display contract's
    // rule for quoting the user), and a token that is not a name at all is not echoed.
    const notAName = /^(nan|[+-]?inf(inity)?|undefined|null)$/i;
    if (fields.length === 1 && !/^[a-z]\w*$/i.test(first))
      return "A netlist line needs an element name, two nodes and a value (for example R1 1 0 1k); one line has an unrecognised element name.";
    // An E or G line names two more nodes (its controlling pair), checked the same way.
    const named = /^[eg]/i.test(first) ? fields.slice(0, 5) : fields.slice(0, 3);
    for (const f of named)
      if (notAName.test(f))
        return (
          `"${f}" cannot be an element or node name here: the result would print it where a number is expected. ` +
          "Rename it (for example R1, n1)."
        );
    const c = first[0]?.toUpperCase() ?? "";
    if (c && !"RVICLEGHFK".includes(c)) {
      const what = fields.length > 1 && DEVICE[c] ? ` (${DEVICE[c]})` : "";
      return (
        // The first sentence is pinned by the Release C case table (row 9); the second
        // completes the scope that Release E added.
        `Transient analysis covers R, L, C, V and I; "${first}"${what} is not supported. It also covers the linear ` +
        "controlled sources E, G, H, F and coupled inductors K; nonlinear devices, switches and transmission lines " +
        "are outside this tool."
      );
    }
  }
  return null;
}

/**
 * A time field: "5m", "5ms", "5 ms", "10u", "10 µs", "1e-3", "2s". SPICE's own
 * reading of the suffix (m is milli), with an optional trailing "s" for seconds.
 */
export function readTime(text: string): number | null {
  let t = (text ?? "").trim().replace(/[−–]/g, "-").replace(/[µμ]/g, "u").replace(/\s+/g, "");
  if (/^[-+]?[\d.]+(?:e[-+]?\d+)?[a-z]*s$/i.test(t)) t = t.slice(0, -1);
  const v = parseValue(t);
  return v ? v.value : null;
}

/** Reads the nodes field: "2, 3", "2 3", "V(2) V(out)". */
function readNodes(text: string, all: string[]): { nodes: string[]; note: string } | { error: string } {
  const raw = (text ?? "").trim();
  if (!raw) {
    if (all.length <= MAX_TRACES) return { nodes: all, note: "" };
    return {
      nodes: all.slice(0, MAX_TRACES),
      note:
        `This circuit has ${all.length} nodes; the figure shows the first ${MAX_TRACES} (${all.slice(0, MAX_TRACES).join(", ")}). ` +
        "List the nodes to plot to choose others.",
    };
  }
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^v\((.+)\)$/i.exec(tok);
    const name = m ? m[1].trim() : tok;
    if (isGround(name)) return { error: `Node ${name} is ground, which is 0 V at every time. List the other nodes to plot.` };
    const hit = all.find((n) => n === name) ?? all.find((n) => n.toLowerCase() === name.toLowerCase());
    if (!hit) return { error: `There is no node called "${name}". Nodes here are: ${all.join(", ")}.` };
    if (!out.includes(hit)) out.push(hit);
  }
  if (out.length > MAX_TRACES)
    return { error: `At most ${MAX_TRACES} nodes can be plotted at once; ${out.length} were listed.` };
  return { nodes: out, note: "" };
}

/** A voltage unit for the axis, chosen from the largest magnitude drawn. */
function voltUnit(maxAbs0: number): { unit: string; scale: number } {
  // Chosen on the value as it will print at four figures: 0.99999 V is "1 V", not "1000 mV".
  const maxAbs = maxAbs0 * 1.00005;
  if (maxAbs >= 1e3) return { unit: "kV", scale: 1e-3 };
  if (maxAbs >= 1 || maxAbs === 0) return { unit: "V", scale: 1 };
  if (maxAbs >= 1e-3) return { unit: "mV", scale: 1e3 };
  if (maxAbs >= 1e-6) return { unit: "µV", scale: 1e6 };
  if (maxAbs >= 1e-9) return { unit: "nV", scale: 1e9 };
  if (maxAbs >= 1e-12) return { unit: "pV", scale: 1e12 };
  return { unit: "fV", scale: 1e15 };
}

/** A voltage in the run's unit (the axis unit). Values below 10⁻¹² of the largest are 0. */
function fmtVolts(v: number, ref: number): string {
  const u = voltUnit(ref);
  if (Math.abs(v) <= 1e-12 * ref) return `0 ${u.unit}`;
  return `${fmtNum(v * u.scale)} ${u.unit}`;
}

/** Decimates a trace to about DRAW_POINTS points, keeping each bucket's min and max in time order. */
function drawPoints(times: Float64Array, values: Float64Array, tScale: number, vScale: number): { x: number; y: number }[] {
  const n = times.length;
  if (n <= DRAW_POINTS) return Array.from(times, (t, i) => ({ x: t * tScale, y: values[i] * vScale }));
  const buckets = DRAW_POINTS >> 1;
  const out: { x: number; y: number }[] = [{ x: times[0] * tScale, y: values[0] * vScale }];
  for (let b = 0; b < buckets; b++) {
    const i0 = 1 + Math.floor(((n - 2) * b) / buckets);
    const i1 = 1 + Math.floor(((n - 2) * (b + 1)) / buckets);
    let iMin = i0;
    let iMax = i0;
    for (let i = i0; i < i1; i++) {
      if (values[i] < values[iMin]) iMin = i;
      if (values[i] > values[iMax]) iMax = i;
    }
    const [a, c] = iMin <= iMax ? [iMin, iMax] : [iMax, iMin];
    out.push({ x: times[a] * tScale, y: values[a] * vScale });
    if (c !== a) out.push({ x: times[c] * tScale, y: values[c] * vScale });
  }
  out.push({ x: times[n - 1] * tScale, y: values[n - 1] * vScale });
  return out;
}

/** The figure: v(t) for each plotted node, time and voltage in engineering units. */
export function transientFigure(res: TransientOk): { svg: string; unitT: string; unitV: string; w: number; h: number } {
  const tu = timeUnit(res.stop);
  let maxAbs = 0;
  for (const p of res.probes) for (const v of p.values) if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  const vu = voltUnit(maxAbs);
  const series: Series[] = res.probes.map((p) => ({
    points: drawPoints(res.times, p.values, tu.scale, vu.scale),
    type: "line" as const,
    label: `V(${p.name})`,
  }));
  const svg = buildPlotSvg(series, {
    width: TRANSIENT_FIG.w,
    height: TRANSIENT_FIG.h,
    title: "Transient response",
    xlabel: `Time (${tu.unit})`,
    ylabel: `Voltage (${vu.unit})`,
  });
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? TRANSIENT_FIG.w);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? TRANSIENT_FIG.h);
  return { svg, unitT: tu.unit, unitV: vu.unit, w, h };
}

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text), ok: false });

/** Turns an engine result into the report lines (exported for the tests). */
export function transientLines(res: TransientOk, plotted: string[]): string[] {
  const lines: string[] = [];
  const tu = timeUnit(res.stop);
  const tStr = (t: number): string => `${fmtNum(t * tu.scale)} ${tu.unit}`;
  let ref = 0;
  for (const p of res.probes) for (const v of p.values) ref = Math.max(ref, Math.abs(v));

  lines.push(`Transient response, 0 to ${tStr(res.stop)}`);
  lines.push(
    `Time step ${fmtSeconds(res.h)}: ${res.steps} steps` +
      (res.breakpoints ? `, landing exactly on ${res.breakpoints} source corner${res.breakpoints === 1 ? "" : "s"}` : ""),
  );
  lines.push(METHOD_SENTENCE);
  lines.push("");
  const start = res.initial.nodes.filter((n) => plotted.includes(n.name));
  lines.push(`Starting point (DC operating point at t = 0): ${start.map((n) => `V(${n.name}) = ${fmtVolts(n.volts, ref)}`).join(", ")}`);
  lines.push("");
  lines.push("Values at 11 evenly spaced times");
  for (let k = 0; k <= 10; k++) {
    const t = (res.stop * k) / 10;
    const vals = res.probes.map((p) => `V(${p.name}) = ${fmtVolts(traceAt(res.times, p.values, t), ref)}`);
    lines.push(`  t = ${tStr(t)}: ${vals.join(", ")}`);
  }
  lines.push("");
  lines.push("Range over the run");
  for (const p of res.probes) {
    // The FIRST time the extreme is reached: on a plateau, float noise in the last
    // digit must not move it to some later sample.
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of p.values) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    const tol = 1e-9 * Math.max(Math.abs(lo), Math.abs(hi), 1e-300);
    let iMin = 0;
    let iMax = 0;
    while (iMin < p.values.length - 1 && p.values[iMin] > lo + tol) iMin++;
    while (iMax < p.values.length - 1 && p.values[iMax] < hi - tol) iMax++;
    const when = (t: number): string => (t === 0 ? "t = 0" : `t = ${fmtSeconds(t)}`);
    lines.push(
      `  V(${p.name}): min ${fmtVolts(p.values[iMin], ref)} at ${when(res.times[iMin])}, ` +
        `max ${fmtVolts(p.values[iMax], ref)} at ${when(res.times[iMax])}`,
    );
  }
  lines.push("");

  // The final-value oracle.
  if (!res.finalDc) {
    lines.push(
      res.unsteady.length
        ? `Final-value check: not applicable; ${res.unsteady.join(", and ")}.`
        : "Final-value check: not available; the DC operating point of the final source values could not be solved.",
    );
  } else {
    const fin = res.finalDc;
    for (const p of res.probes) {
      const dcNode = fin.nodes.find((n) => n.name === p.name);
      if (!dcNode) continue;
      const dcV = dcNode.volts;
      const v = p.values;
      const nT = v.length;
      const last = v[nT - 1];
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of v) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      const scale = Math.max(Math.abs(dcV), Math.abs(lo), Math.abs(hi), 1e-300);
      if (Math.abs(last - dcV) <= 1e-3 * scale) {
        lines.push(`Final-value check: V(${p.name}) settles to ${fmtVolts(last, ref)}; DC operating point ${fmtVolts(dcV, ref)}.`);
        continue;
      }
      // Not settled. A trace that LOOKS flat may still be a slow mode (a coupling
      // capacitor into a 1 GΩ bias resistor has τ = 1000 s), so no flatness test can
      // tell an unfinished approach from an engine fault without the time constants:
      // the two numbers are printed side by side and the reader sees the gap.
      const pct = (100 * Math.abs(last - dcV)) / scale;
      lines.push(
        `Final-value check: V(${p.name}) has not settled by the stop time: ${fmtVolts(last, ref)} against a DC operating ` +
          `point of ${fmtVolts(dcV, ref)} (${fmtNum(pct, 2)} % of full scale away).`,
      );
    }
  }
  return lines;
}

export const CIRCUIT_CALCS: CircuitCalc[] = [
  {
    id: "circuit-transient",
    name: "Transient response",
    group: "Electronics",
    unitContract: "spice",
    hint:
      'The same netlist as the DC and AC tools, with time-varying sources: "V1 1 0 PULSE(0 5 0 1n 1n 1m 2m)", ' +
      '"V1 1 0 SIN(0 1 1k)", "I1 0 2 PWL(0 0 1m 10m)". Times take SI suffixes (5m is 5 ms). Covers R, L, C, V ' +
      'and I, the linear controlled sources E, G, H, F ("E1 out 0 inp inn 100k", "F1 out 0 Vsense 100") and coupled ' +
      'inductors K ("K1 L1 L2 0.99", dot at each first node). Starts from the DC operating point at t = 0 and checks ' +
      "the end against the DC answer.",
    fields: [
      {
        key: "net",
        label: "Netlist",
        default: "V1 1 0 PULSE(0 5 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 1u",
        kind: "block",
        rows: 6,
      },
      { key: "stop", label: "Stop time (s; 10m is 10 ms)", default: "10m", kind: "text" },
      { key: "step", label: "Time step (s), blank for stop/1000", default: "", kind: "text" },
      { key: "nodes", label: "Nodes to plot, blank for all (at most 6)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const net = r("net") ?? "";
      const bad = unsupportedLine(net);
      if (bad) return refuse(bad);
      const parsed = parseNetlist(net);
      if (parsed.errors.length) return refuse(parsed.errors.join("\n"));
      if (!parsed.elements.length) return refuse("The netlist is empty.");
      if (parsed.elements.length > TRANSIENT_MAX_ELEMENTS)
        return refuse(`This netlist has ${parsed.elements.length} elements; the transient tool takes at most ${TRANSIENT_MAX_ELEMENTS}.`);

      const stopText = (r("stop") ?? "").trim();
      const stop = readTime(stopText);
      if (stop === null)
        return refuse(`The stop time "${stopText}" is not a time. Write it in seconds with an SI suffix: 10m or 10ms is 10 ms.`);
      if (!(stop > 0)) return refuse("The stop time must be greater than 0.");
      const stepText = (r("step") ?? "").trim();
      let step: number | undefined;
      if (stepText) {
        const s = readTime(stepText);
        if (s === null)
          return refuse(`The time step "${stepText}" is not a time. Write it in seconds with an SI suffix (10u is 10 µs), or leave it blank.`);
        if (!(s > 0)) return refuse("The time step must be greater than 0, or blank for stop/1000.");
        if (s > stop)
          return refuse(`The time step (${fmtSeconds(s)}) is longer than the stop time (${fmtSeconds(stop)}). Make it shorter than the stop time.`);
        if (stop / s > TRANSIENT_MAX_STEPS + 1e-6)
          return refuse(
            `${fmtSeconds(stop)} in steps of ${fmtSeconds(s)} is ${fmtNum(Math.ceil(stop / s - 1e-6), 6)} steps; the most is ` +
              `${TRANSIENT_MAX_STEPS}. Lengthen the step or shorten the stop time.`,
          );
        step = s;
      }

      const all = nodeList(parsed.elements);
      const pick = readNodes(r("nodes") ?? "", all);
      if ("error" in pick) return refuse(pick.error);

      const res = solveTransient(parsed.elements, { stop, step, probes: pick.nodes });
      if (!res.ok) return refuse(res.error);

      const lines = transientLines(res, pick.nodes);
      if (pick.note) lines.push(`Note: ${pick.note}`);
      for (const n of res.notes) lines.push(`Note: ${n}`);
      for (const n of parsed.notes) lines.push(`Note: ${n}`);
      lines.push("Units: SI throughout (seconds, volts, ohms, farads, henries); values are not converted.");

      const fig = transientFigure(res);
      const clean = lines.map((l) => trueMinus(plainDashes(l)));
      const blocks: AnalyzeBlock[] = [
        {
          kind: "plot",
          svg: fig.svg,
          caption: `Node voltages against time, ${pick.nodes.map((n) => `V(${n})`).join(", ")}`,
          alt: `Line plot of node voltage in ${fig.unitV} against time in ${fig.unitT} for ${pick.nodes.length} node${pick.nodes.length === 1 ? "" : "s"}`,
          // The legend gutter widens the canvas past the asked-for width, so the
          // insert size is read from the SVG itself, never from TRANSIENT_FIG.
          w: fig.w,
          h: fig.h,
        },
      ];
      return engReport(clean, blocks);
    },
  },
];
