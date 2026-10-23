// Circuit transient analysis: node voltages against time for a linear R, L, C, V, I
// netlist, written in the SAME netlist language as the DC and AC tools (circuit.ts
// parses it, so one netlist gives all three answers).
//
// THE METHOD, AND WHY EACH PART OF IT.
//
//   Initial state. The DC operating point with every source at its t = 0 value,
//   capacitors open and inductors shorted: SPICE's default, and computed by the
//   SAME solveDc the DC tool uses (with inductorsShorted, which models each L as a
//   0 V source and so also yields its initial current). A circuit whose operating
//   point is undetermined (a floating node, a capacitor in series with a current
//   source, a loop of sources and inductors) is refused with the DC tool's own
//   message, plus what to change.
//
//   Integration. Modified nodal analysis with companion models. Each capacitor is a
//   conductance αC/h with a history current source; each inductor keeps its branch
//   current as an unknown (so a small L never divides by anything) with the row
//   v − (αL/h)·i = history. α = 2 is the trapezoidal rule, second order and
//   A-stable; α = 1 is backward Euler, first order and L-stable.
//
//   Backward-Euler starts. The trapezoidal rule's amplification for a fast mode is
//   (1 − hλ/2)/(1 + hλ/2), which tends to −1 when the step is long against the
//   mode's time constant: whatever error a discontinuity leaves in that mode is
//   flipped in sign every step and barely damped. That is trapezoidal ringing, the
//   saw-tooth a SPICE user sees after a step into a capacitor. Backward Euler's
//   factor 1/(1 + hλ) tends to 0, so BE_RUN backward-Euler steps are taken at t = 0
//   and after every source corner (PULSE and PWL corners, a SIN start): each one
//   divides the fast-mode error by (1 + hλ), and the trapezoidal steps that follow
//   start from a residual far below what any figure or four-figure table can show.
//   The corners themselves are landed on EXACTLY: a step never straddles one.
//
//   Constant step otherwise, so the matrix is factored once per distinct
//   (method, step) pair, not once per step; the number of distinct pairs is counted
//   before integrating and refused if factoring them all would be too slow.
//
// THE ORACLE IT CARRIES. When every source is constant from some time before the
// stop time on, the late-time state must be the DC operating point of the FINAL
// source values, which solveDc computes independently (exactly, when the values
// are exact). The tool reports both numbers side by side, and refuses outright if
// a trace has gone flat at a value that disagrees with it.
//
// CONTROLLED SOURCES AND COUPLED INDUCTORS. E, G, H and F are static stamps (the same
// stampControlled the DC and AC paths use); each E and H adds a branch row after every
// row an existing netlist has. A K couples two inductor rows: the companion row of
// inductor l becomes v_l − (α/h)·Σₘ L_lm·i_m = −(α/h)·Σₘ L_lm·i_m(prev) − (α−1)·v_l(prev),
// i.e. the mutual terms −(α/h)·M off the diagonal and −(α/h)·M·i_other in the history,
// added in a separate pass that runs only when a K exists, so an uncoupled netlist
// performs exactly the arithmetic it always did.
//
// Out of scope here: nonlinear devices, adaptive steps.

import {
  Element,
  DcResult,
  Failure,
  solveDc,
  sourceValueAt,
  isGround,
  nodeList,
  Waveform,
  isControlledVoltage,
  stampControlled,
  unitySingular,
  unityMessage,
  CONTROLLED_NOTE,
  COUPLING_NOTE,
} from "./circuit";
import { Rat, ratFromNumber } from "./cas";
import { fmtSig } from "./axis";

// ---------------------------------------------------------------- display

/**
 * A number for the result text: `sig` significant figures with trailing zeros
 * dropped, U+2212 for a minus, ×10ⁿ beyond 10⁻³–10⁵ (never e-notation).
 */
export function fmtNum(v: number, sig = 4): string {
  if (v === 0 || Object.is(v, -0)) return "0";
  const s = fmtSig(v, sig);
  return s.replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
}

/** An SI time unit chosen so the given span reads between 1 and 1000: s, ms, µs, ns or ps. */
export function timeUnit(span: number): { unit: string; scale: number } {
  const a = Math.abs(span);
  if (a >= 1) return { unit: "s", scale: 1 };
  if (a >= 1e-3) return { unit: "ms", scale: 1e3 };
  if (a >= 1e-6) return { unit: "µs", scale: 1e6 };
  if (a >= 1e-9) return { unit: "ns", scale: 1e9 };
  if (a >= 1e-12) return { unit: "ps", scale: 1e12 };
  return { unit: "fs", scale: 1e15 };
}

/** A duration with its own SI prefix: 1e-5 → "10 µs". */
export function fmtSeconds(t: number): string {
  const u = timeUnit(t);
  return `${fmtNum(t * u.scale)} ${u.unit}`;
}

/** The transient tool's limits. */
export const TRANSIENT_MAX_ELEMENTS = 60;
export const TRANSIENT_MAX_STEPS = 200000;
/** Most source corners in one run (each forces a step boundary). */
export const TRANSIENT_MAX_BREAKPOINTS = 50000;
/** Most recorded traces (node voltages plus branch currents). */
export const TRANSIENT_MAX_PROBES = 12;
/** Backward-Euler steps taken at t = 0 and after every source corner. */
export const BE_RUN = 4;
/** Fewest samples per SIN period accepted (fewer would alias into a different waveform). */
export const MIN_SAMPLES_PER_PERIOD = 8;
/**
 * ONE budget for a run, in two currencies: stepping (inner-loop operations, about
 * 2 ns each) and factorizing (multiply-adds, m³/3 per distinct step, about 0.7 ns
 * each). Each budget alone is about 300 ms, and a run must satisfy
 *     factorWork / FACTOR_BUDGET + stepWork / RUN_BUDGET ≤ 1,
 * so a run near both caps cannot pay both (review round 1: a 58-inductor chain with
 * a 360-corner PWL took 620 ms when the two were checked separately). The
 * 60-element RC ladder at 200 000 steps (case-table row 12) is about 0.85 of it.
 */
export const RUN_BUDGET = 1.5e8;
export const FACTOR_BUDGET = 4e8;

export interface TransientRequest {
  stop: number;
  /** Default stop / 1000. */
  step?: number;
  /** Node names to record; default every non-ground node (at most TRANSIENT_MAX_PROBES). */
  probes?: string[];
  /** Inductor or voltage-source names whose branch current is recorded. */
  currents?: string[];
}

export interface Trace {
  name: string;
  values: Float64Array;
}

export interface TransientOk {
  ok: true;
  /** The base time step. */
  h: number;
  stop: number;
  /** Every time point, from 0 to stop inclusive. */
  times: Float64Array;
  probes: Trace[];
  currents: Trace[];
  /** The DC operating point the run starts from (sources at t = 0, L shorted). */
  initial: DcResult;
  /** Source corners inside (0, stop) that a step landed on. */
  breakpoints: number;
  /** Steps taken by backward Euler, and in all. */
  beSteps: number;
  steps: number;
  factorizations: number;
  /**
   * The time from which every source holds a constant value up to the stop time,
   * or null when one is still changing there (a SIN, a repeating PULSE, a ramp in
   * progress); `unsteady` then says which, in words. finalDc is the DC operating
   * point of the source values at the stop time, solved independently, when
   * steadyFrom is not null: the value every trace must approach.
   */
  steadyFrom: number | null;
  unsteady: string[];
  finalDc: DcResult | null;
  /** Every node's voltage at the stop time. */
  finalNodes: { name: string; volts: number }[];
  notes: string[];
}

const fail = (error: string): Failure => ({ ok: false, error });

/**
 * The time from which a source holds one value through the stop time (0 for a
 * plain value), or a sentence saying why it does not.
 */
function steadyFrom(e: Element, h: number, stop: number): number | string {
  const w = e.wave;
  if (!w) return 0;
  if (w.kind === "SIN") return w.va === 0 || stop <= w.td ? 0 : `${e.name} is a sine, which never settles`;
  if (w.kind === "PWL") {
    const n = w.t.length;
    if (stop <= w.t[0] || w.v.every((v) => v === w.v[0])) return 0;
    if (stop >= w.t[n - 1]) return w.t[n - 1];
    let i = 0;
    while (i < n - 2 && w.t[i + 1] <= stop) i++;
    if (w.v[i] !== w.v[i + 1]) return `${e.name} is still ramping at the stop time`;
    while (i > 0 && w.v[i - 1] === w.v[i]) i--;
    return w.t[i];
  }
  if (w.v1 === w.v2 || stop <= w.td) return 0;
  const tr = w.tr ?? h;
  const tf = w.tf ?? h;
  // Within the pulse (the current period, for a repeating one) that the stop time falls in.
  const k = w.per === null ? 0 : Math.floor((stop - w.td) / w.per + 1e-12);
  const t0 = w.td + k * (w.per ?? 0);
  const tt = stop - t0;
  if (tt < tr) return `${e.name} is still rising at the stop time`;
  if (w.pw === null || tt <= tr + w.pw) return t0 + tr;
  if (tt < tr + w.pw + tf) return `${e.name} is still falling at the stop time`;
  return t0 + tr + w.pw + tf;
}

/** How many corners a source has inside (0, stop), counted without generating them. */
function cornerCount(w: Waveform, stop: number): number {
  if (w.kind === "SIN") return w.td > 0 && w.td < stop ? 1 : 0;
  if (w.kind === "PWL") return w.t.length;
  if (w.v1 === w.v2) return 0;
  if (w.per === null) return 4;
  return 4 * Math.max(1, Math.ceil((stop - w.td) / w.per) + 1);
}

/** The corners of a source inside (0, stop), in any order. Bounded by cornerCount. */
function corners(w: Waveform, stop: number, h: number, out: number[]): void {
  const push = (t: number): void => {
    if (t > 0 && t < stop) out.push(t);
  };
  if (w.kind === "SIN") {
    push(w.td);
    return;
  }
  if (w.kind === "PWL") {
    for (const t of w.t) push(t);
    return;
  }
  if (w.v1 === w.v2) return;
  const tr = w.tr ?? h;
  const tf = w.tf ?? h;
  const periods = w.per === null ? 1 : Math.max(1, Math.ceil((stop - w.td) / w.per) + 1);
  for (let k = 0; k < periods; k++) {
    const t0 = w.td + (w.per ?? 0) * k;
    if (t0 >= stop) break;
    push(t0);
    push(t0 + tr);
    if (w.pw !== null) {
      push(t0 + tr + w.pw);
      push(t0 + tr + w.pw + tf);
    }
  }
}

/** A dense LU with scaled partial pivoting, stored sparsely for the per-step solves. */
interface Lu {
  m: number;
  perm: Int32Array;
  lPtr: Int32Array;
  lCol: Int32Array;
  lVal: Float64Array;
  uPtr: Int32Array;
  uCol: Int32Array;
  uVal: Float64Array;
  diag: Float64Array;
}

function factor(a: Float64Array, m: number): Lu | null {
  const scale = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    // Plain comparisons, not Math.abs/Math.max: the pivot search runs m² times per
    // factorization, and under jest's vm context those builtins are not inlined
    // (measured 90× slower), which made a near-budget run look 25× slower there.
    for (let j = 0; j < m; j++) {
      const v = a[i * m + j];
      const av = v < 0 ? -v : v;
      if (av > s) s = av;
    }
    if (!(s > 0) || !Number.isFinite(s)) return null;
    scale[i] = s;
  }
  const perm = new Int32Array(m);
  const cols = new Int32Array(m);
  for (let i = 0; i < m; i++) perm[i] = i;
  for (let k = 0; k < m; k++) {
    let p = -1;
    let best = 0;
    for (let i = k; i < m; i++) {
      const v = a[i * m + k];
      const r = (v < 0 ? -v : v) / scale[i];
      if (r > best) {
        best = r;
        p = i;
      }
    }
    // Relative to the row's own size, so a 1 GΩ bias resistor beside a large C/h
    // is not mistaken for a singular matrix; a true structural zero still is.
    if (p < 0 || best < 1e-13) return null;
    if (p !== k) {
      for (let j = 0; j < m; j++) {
        const t = a[k * m + j];
        a[k * m + j] = a[p * m + j];
        a[p * m + j] = t;
      }
      const ts = scale[k];
      scale[k] = scale[p];
      scale[p] = ts;
      const tp = perm[k];
      perm[k] = perm[p];
      perm[p] = tp;
    }
    const piv = a[k * m + k];
    // The pivot row's non-zeros, gathered once: a circuit matrix is sparse, so the
    // row updates below touch only these columns rather than all m.
    let nz = 0;
    for (let j = k + 1; j < m; j++) if (a[k * m + j] !== 0) cols[nz++] = j;
    for (let i = k + 1; i < m; i++) {
      const f = a[i * m + k];
      if (f === 0) continue;
      const l = f / piv;
      a[i * m + k] = l;
      const row = i * m;
      const prow = k * m;
      for (let q = 0; q < nz; q++) {
        const j = cols[q];
        a[row + j] -= l * a[prow + j];
      }
    }
  }
  // Compress: the circuits here are sparse (a ladder is banded), so the per-step
  // solve costs the number of non-zeros, not m².
  let nl = 0;
  let nu = 0;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < m; j++) {
      const v = a[i * m + j];
      if (v === 0) continue;
      if (j < i) nl++;
      else if (j > i) nu++;
    }
  const lPtr = new Int32Array(m + 1);
  const lCol = new Int32Array(nl);
  const lVal = new Float64Array(nl);
  const uPtr = new Int32Array(m + 1);
  const uCol = new Int32Array(nu);
  const uVal = new Float64Array(nu);
  const diag = new Float64Array(m);
  let il = 0;
  let iu = 0;
  for (let i = 0; i < m; i++) {
    lPtr[i] = il;
    uPtr[i] = iu;
    for (let j = 0; j < m; j++) {
      const v = a[i * m + j];
      if (v === 0) continue;
      if (j < i) {
        lCol[il] = j;
        lVal[il++] = v;
      } else if (j > i) {
        uCol[iu] = j;
        uVal[iu++] = v;
      } else diag[i] = v;
    }
  }
  lPtr[m] = il;
  uPtr[m] = iu;
  for (let i = 0; i < m; i++) if (diag[i] === 0 || !Number.isFinite(diag[i])) return null;
  return { m, perm, lPtr, lCol, lVal, uPtr, uCol, uVal, diag };
}

function luSolve(lu: Lu, b: Float64Array, x: Float64Array): void {
  const { m, perm, lPtr, lCol, lVal, uPtr, uCol, uVal, diag } = lu;
  for (let i = 0; i < m; i++) {
    let s = b[perm[i]];
    for (let k = lPtr[i]; k < lPtr[i + 1]; k++) s -= lVal[k] * x[lCol[k]];
    x[i] = s;
  }
  for (let i = m - 1; i >= 0; i--) {
    let s = x[i];
    for (let k = uPtr[i]; k < uPtr[i + 1]; k++) s -= uVal[k] * x[uCol[k]];
    x[i] = s / diag[i];
  }
}

/**
 * What to change when the starting operating point does not exist. Appended to the
 * DC tool's own message, which names the fault.
 */
const START_HINT =
  "A transient run starts from the DC operating point (capacitors open, inductors shorted, every source at its " +
  "t = 0 value), as in SPICE, so that point has to exist. A large resistor (for example 1G) from the node to " +
  "ground fixes a missing DC path without visibly changing the response.";

/** Names a capacitor in series with a current source, the textbook case of a missing operating point. */
function currentIntoCapacitor(elements: Element[]): string {
  const reach = new Set<string>(["0"]);
  const norm = (n: string): string => (isGround(n) ? "0" : n);
  for (let pass = 0, grew = true; grew && pass <= elements.length + 1; pass++) {
    grew = false;
    for (const e of elements) {
      if (e.kind === "I" || e.kind === "C") continue;
      const a = norm(e.a);
      const b = norm(e.b);
      if (reach.has(a) !== reach.has(b)) {
        reach.add(a);
        reach.add(b);
        grew = true;
      }
    }
  }
  for (const n of nodeList(elements)) {
    if (reach.has(n)) continue;
    const at = elements.filter((e) => norm(e.a) === n || norm(e.b) === n);
    const src = at.find((e) => e.kind === "I");
    const cap = at.find((e) => e.kind === "C");
    if (src && cap && at.every((e) => e.kind === "I" || e.kind === "C"))
      return (
        ` Capacitor ${cap.name} is in series with current source ${src.name} at node ${n}: with the capacitor ` +
        "open at DC the source's current has nowhere to go, so there is no operating point to start from (the " +
        `capacitor voltage would ramp without limit). Put a resistor across ${cap.name}, or from node ${n} to ground.`
      );
  }
  return "";
}

/** A copy of the elements with every source at its value at time t (exact where the level is a typed one). */
function sourcesAt(elements: Element[], t: number, h: number): Element[] {
  return elements.map((e) => {
    if (!e.wave) return e;
    const value = sourceValueAt(e, t, h);
    const w = e.wave;
    let exact: Rat | null = null;
    if (w.kind === "PULSE") exact = value === w.v1 ? w.v1x : value === w.v2 ? w.v2x : null;
    else if (w.kind === "SIN") exact = value === w.vo ? w.vox : null;
    else {
      const i = w.v.indexOf(value);
      exact = i >= 0 ? w.vx[i] : null;
    }
    // solveDc reads an I source's exact value (null would read as 0), so a level
    // that is not one the user typed is carried as the exact rational of its double.
    return { kind: e.kind, name: e.name, a: e.a, b: e.b, value, exact: exact ?? ratFromNumber(value) };
  });
}

/**
 * A cheap estimate of the circuit's fastest time constant: for each capacitor,
 * the capacitance at a free end over the resistor conductance at that node; for
 * each inductor, L over the resistance at its free ends. Ground and nodes a voltage
 * source holds are not free. Returns null when no estimate exists (no resistors
 * near any reactive element, as in a lossless tank).
 */
export function fastestTimeConstant(elements: Element[]): { tau: number; name: string } | null {
  const g = new Map<string, number>();
  const cap = new Map<string, number>();
  const held = new Set<string>();
  const key = (n: string): string => (isGround(n) ? "0" : n);
  for (const e of elements) {
    const a = key(e.a);
    const b = key(e.b);
    if (e.kind === "R") {
      g.set(a, (g.get(a) ?? 0) + 1 / e.value);
      g.set(b, (g.get(b) ?? 0) + 1 / e.value);
    } else if (e.kind === "C") {
      cap.set(a, (cap.get(a) ?? 0) + e.value);
      cap.set(b, (cap.get(b) ?? 0) + e.value);
    } else if (e.kind === "V" || isControlledVoltage(e)) {
      held.add(a);
      held.add(b);
    }
  }
  const free = (n: string): boolean => n !== "0" && !held.has(n);
  let best: { tau: number; name: string } | null = null;
  const offer = (tau: number, name: string): void => {
    if (tau > 0 && Number.isFinite(tau) && (!best || tau < best.tau)) best = { tau, name };
  };
  for (const e of elements) {
    const a = key(e.a);
    const b = key(e.b);
    if (e.kind === "C") {
      for (const n of [a, b]) if (free(n) && (g.get(n) ?? 0) > 0) offer((cap.get(n) ?? 0) / (g.get(n) as number), e.name);
    } else if (e.kind === "L") {
      let r = 0;
      for (const n of [a, b]) if (free(n) && (g.get(n) ?? 0) > 0) r += 1 / (g.get(n) as number);
      if (r > 0) offer(e.value / r, e.name);
    }
  }
  return best;
}

/**
 * The shortest ringing period any inductor–capacitor pair could have, 2π√(LC),
 * over every pair (at most 60 elements, so at most 30 × 30 pairs). Conservative:
 * a pair that is not actually in one loop still counts. Null without both kinds.
 */
export function fastestLcPeriod(elements: Element[]): { period: number; l: string; c: string } | null {
  const ls = elements.filter((e) => e.kind === "L");
  const cs = elements.filter((e) => e.kind === "C");
  let best: { period: number; l: string; c: string } | null = null;
  for (const l of ls)
    for (const c of cs) {
      const period = 2 * Math.PI * Math.sqrt(l.value * c.value);
      if (period > 0 && Number.isFinite(period) && (!best || period < best.period)) best = { period, l: l.name, c: c.name };
    }
  return best;
}

/**
 * Runs the transient analysis. Every input is checked before any work: the caps
 * (elements, steps, corners, factorization cost) are refusals, never truncations.
 */
export function solveTransient(elements: Element[], req: TransientRequest): TransientOk | Failure {
  const stop = req.stop;
  if (!Number.isFinite(stop) || stop <= 0) return fail("The stop time must be a positive number of seconds.");
  const h = req.step === undefined ? stop / 1000 : req.step;
  if (!Number.isFinite(h) || h <= 0) return fail("The time step must be a positive number of seconds.");
  if (h > stop) return fail("The time step is longer than the stop time. Make the step shorter than the stop time.");
  if (!elements.length) return fail("The netlist is empty.");
  if (elements.length > TRANSIENT_MAX_ELEMENTS)
    return fail(`This netlist has ${elements.length} elements; the transient tool takes at most ${TRANSIENT_MAX_ELEMENTS}.`);
  // stop / h is rarely an exact integer in doubles (0.2 / 1e-6 = 200000.00000000003),
  // so a ratio within 1e-6 of an integer IS that integer, not one step more.
  const ratio = stop / h;
  const gridSteps = Math.abs(ratio - Math.round(ratio)) < 1e-6 ? Math.round(ratio) : Math.ceil(ratio);
  if (gridSteps > TRANSIENT_MAX_STEPS)
    return fail(
      `That is ${gridSteps} time steps; the most is ${TRANSIENT_MAX_STEPS}. Lengthen the time step or shorten the stop time.`,
    );

  const notes: string[] = [];
  // A sine sampled too coarsely aliases into a different waveform: refuse rather than draw it.
  for (const e of elements) {
    const w = e.wave;
    if (w?.kind === "SIN" && w.va !== 0) {
      const perPeriod = 1 / (w.freq * h);
      if (perPeriod < MIN_SAMPLES_PER_PERIOD)
        return fail(
          `${e.name} is a ${fmtNum(w.freq)} Hz sine, and a time step of ${fmtSeconds(h)} gives only ${fmtNum(perPeriod, 2)} samples ` +
            `per period, too few to follow it (at least ${MIN_SAMPLES_PER_PERIOD}; 20 or more draws a smooth curve). ` +
            `Use a time step of at most ${fmtSeconds(1 / (20 * w.freq))}, or a shorter stop time.`,
        );
      if (perPeriod < 20)
        notes.push(`${e.name}: the time step gives only ${Math.floor(perPeriod)} samples per period of the sine; a shorter step draws it more smoothly.`);
    }
    if (w?.kind === "PULSE" && w.per !== null && w.per < (w.tr ?? h) + (w.pw ?? 0) + (w.tf ?? h))
      return fail(
        `${e.name}: with the rise and fall times taken as one time step (TR and TF were not given, or 0, as SPICE ` +
          "does), the period PER is shorter than TR + PW + TF. Lengthen PER, or give TR and TF explicitly.",
      );
    if (w?.kind === "PULSE" && (w.tr === null || w.tf === null) && w.v1 !== w.v2)
      notes.push(`${e.name}: a PULSE rise or fall time that is not given (or 0) is one time step, as in SPICE.`);
  }

  // ------------------------------------------------------------ time points
  let cornerTotal = 0;
  for (const e of elements) if (e.wave) cornerTotal += cornerCount(e.wave, stop);
  if (cornerTotal > TRANSIENT_MAX_BREAKPOINTS)
    return fail(
      `The sources have about ${cornerTotal} corners before the stop time, more than the ${TRANSIENT_MAX_BREAKPOINTS} ` +
        "this tool lands on. Shorten the stop time or lengthen the pulse period.",
    );
  const raw: number[] = [];
  for (const e of elements) if (e.wave) corners(e.wave, stop, h, raw);
  raw.sort((x, y) => x - y);

  // Merge the grid k·h (never accumulated, so 1 ms stays exactly on it) with the
  // corners. A corner within SNAP of a point replaces that point, so no step is a
  // sliver; a corner is never moved by more than SNAP.
  const SNAP = 1e-6 * h;
  const times: number[] = [0];
  const isBreak: boolean[] = [true];
  const take = (t: number, brk: boolean, isStop: boolean): void => {
    const last = times.length - 1;
    if (t - times[last] > SNAP) {
      times.push(t);
      isBreak.push(brk);
      return;
    }
    // Within SNAP of the previous point: one point, at the corner's (or the stop's) time.
    if (last === 0) return;
    if (brk || isStop) {
      times[last] = t;
      isBreak[last] = isBreak[last] || brk;
    }
  };
  let ci = 0;
  for (let k = 1; k <= gridSteps; k++) {
    const g = k === gridSteps ? stop : k * h;
    while (ci < raw.length && raw[ci] < g) take(raw[ci++], true, false);
    take(g, false, k === gridSteps);
  }
  // A corner at the stop time itself (within SNAP) adds nothing: the run ends there.
  times[times.length - 1] = stop;
  const nT = times.length;
  const steps = nT - 1;
  // Counted after merging: a corner that falls on a grid point costs no extra step.
  if (steps > TRANSIENT_MAX_STEPS)
    return fail(
      `With the source corners added that is ${steps} time steps; the most is ${TRANSIENT_MAX_STEPS}. ` +
        "Lengthen the time step or shorten the stop time.",
    );
  const breakpoints = isBreak.slice(1, nT - 1).filter(Boolean).length;

  // ------------------------------------------------------------ operating point at t = 0
  const dc0 = solveDc(elements, { inductorsShorted: true });
  if (!dc0.ok) {
    // The 1G advice fits a missing DC path only; a loop of sources and inductors has
    // its own remedy, already in the DC tool's message.
    const floating = /has no DC path to ground/.test(dc0.error);
    return fail(floating ? `${dc0.error} ${START_HINT}${currentIntoCapacitor(elements)}` : dc0.error);
  }

  // ------------------------------------------------------------ MNA layout
  const nodes = nodeList(elements);
  const nodeIdx = new Map(nodes.map((n, i) => [n, i]));
  const at = (name: string): number => (isGround(name) ? -1 : (nodeIdx.get(name) as number));
  const vsrc = elements.filter((e) => e.kind === "V");
  const inds = elements.filter((e) => e.kind === "L");
  const caps = elements.filter((e) => e.kind === "C");
  const isrc = elements.filter((e) => e.kind === "I");
  const ctl = elements.filter(isControlledVoltage);
  const n = nodes.length;
  const m = n + vsrc.length + inds.length + ctl.length;

  const probeNames = req.probes ?? nodes.slice(0, TRANSIENT_MAX_PROBES);
  const currentNames = req.currents ?? [];
  if (probeNames.length + currentNames.length > TRANSIENT_MAX_PROBES)
    return fail(`At most ${TRANSIENT_MAX_PROBES} traces can be recorded at once.`);
  for (const p of probeNames)
    if (!nodeIdx.has(p))
      return fail(`There is no node called "${p}". Nodes here are: ${nodes.join(", ")}.`);
  const currentRows: number[] = [];
  for (const c of currentNames) {
    const vi = vsrc.findIndex((e) => e.name.toLowerCase() === c.toLowerCase());
    const li = inds.findIndex((e) => e.name.toLowerCase() === c.toLowerCase());
    if (vi < 0 && li < 0) return fail(`"${c}" is not an inductor or voltage source in this netlist.`);
    currentRows.push(vi >= 0 ? n + vi : n + vsrc.length + li);
  }

  // Static stamps: resistors, source and inductor incidence.
  const base = new Float64Array(m * m);
  const add = (i: number, j: number, v: number): void => {
    if (i >= 0 && j >= 0) base[i * m + j] += v;
  };
  for (const e of elements) {
    if (e.kind !== "R") continue;
    const g = 1 / e.value;
    const ia = at(e.a);
    const ib = at(e.b);
    add(ia, ia, g);
    add(ib, ib, g);
    add(ia, ib, -g);
    add(ib, ia, -g);
  }
  const branch = (row: number, e: Element): void => {
    const ia = at(e.a);
    const ib = at(e.b);
    add(row, ia, 1);
    add(ia, row, 1);
    add(row, ib, -1);
    add(ib, row, -1);
  };
  vsrc.forEach((e, k) => branch(n + k, e));
  inds.forEach((e, k) => branch(n + vsrc.length + k, e));
  if (ctl.length || elements.some((e) => e.kind === "G" || e.kind === "F")) {
    const vsIdx = new Map(vsrc.map((e, k) => [e.name, n + k]));
    const ctlIdx = new Map(ctl.map((e, k) => [e, n + vsrc.length + inds.length + k]));
    stampControlled(
      elements,
      at,
      (name) => vsIdx.get(name) as number,
      (e) => ctlIdx.get(e) as number,
      (i, j, sign, e) => add(i, j, sign * (e ? e.value : 1)),
    );
  }
  // Mutual inductances: [row of l1, row of l2, M]. Empty without a K.
  const lIdxOf = new Map(inds.map((e, k) => [e.name, k]));
  const mutual = elements
    .filter((e) => e.kind === "K")
    .map((e) => {
      const p = lIdxOf.get(e.l1 as string) as number;
      const q = lIdxOf.get(e.l2 as string) as number;
      return { p, q, M: e.value * Math.sqrt(inds[p].value * inds[q].value), unity: e.value === 1, k: e.value };
    });

  // Index arrays for the step loop (no Map lookups or allocation inside it).
  const vRow = vsrc.map((_, k) => n + k);
  const cA = Int32Array.from(caps.map((e) => at(e.a)));
  const cB = Int32Array.from(caps.map((e) => at(e.b)));
  const cVal = Float64Array.from(caps.map((e) => e.value));
  const lRow = Int32Array.from(inds.map((_, k) => n + vsrc.length + k));
  const lA = Int32Array.from(inds.map((e) => at(e.a)));
  const lB = Int32Array.from(inds.map((e) => at(e.b)));
  const lVal = Float64Array.from(inds.map((e) => e.value));
  const iA = Int32Array.from(isrc.map((e) => at(e.a)));
  const iB = Int32Array.from(isrc.map((e) => at(e.b)));
  const probeIdx = probeNames.map((p) => nodeIdx.get(p) as number);

  // Which steps are backward Euler: BE_RUN of them from t = 0 and from every corner.
  const be = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    if (!isBreak[i]) continue;
    for (let j = i; j < Math.min(steps, i + BE_RUN); j++) be[j] = 1;
  }
  // Distinct (method, step) pairs, keyed on the step relative to h to 1e-9.
  const keyOf = (i: number): number => (be[i] ? 0 : 4e9) + Math.round(((times[i + 1] - times[i]) / h) * 1e9);
  const keyStep = new Map<number, number>();
  for (let i = 0; i < steps; i++) {
    const k = keyOf(i);
    if (!keyStep.has(k)) keyStep.set(k, times[i + 1] - times[i]);
  }
  const lus = new Map<number, Lu>();
  const luIndex = new Map<number, number>();
  const luList: Lu[] = [];
  const factorFor = (k: number, hk: number): Lu | null => {
    const alpha = k < 4e9 ? 1 : 2;
    const a = new Float64Array(base);
    for (let c = 0; c < caps.length; c++) {
      const g = (alpha * cVal[c]) / hk;
      const ia = cA[c];
      const ib = cB[c];
      if (ia >= 0) a[ia * m + ia] += g;
      if (ib >= 0) a[ib * m + ib] += g;
      if (ia >= 0 && ib >= 0) {
        a[ia * m + ib] -= g;
        a[ib * m + ia] -= g;
      }
    }
    for (let l = 0; l < inds.length; l++) a[lRow[l] * m + lRow[l]] -= (alpha * lVal[l]) / hk;
    for (const mu of mutual) {
      const g = (alpha * mu.M) / hk;
      a[lRow[mu.p] * m + lRow[mu.q]] -= g;
      a[lRow[mu.q] * m + lRow[mu.p]] -= g;
    }
    return factor(a, m);
  };
  const NO_SOLUTION =
    "The transient equations for this circuit have no unique solution at this time step, although its DC " +
    "operating point exists. Check for a loop of capacitors and voltage sources, or a cut of inductors " +
    "and current sources, and add a small resistance to break it.";
  // THE RUN'S COST, checked before the run against ONE combined budget (see
  // RUN_BUDGET): every distinct step needs a factorization (m³/3 each), and every
  // step a sparse solve over the factors' non-zeros plus a pass over the elements.
  // The fill is measured on the first factorization; the others share its pattern.
  const keys = [...keyStep.keys()];
  // A k = 1 coupling: decided structurally before any factor is trusted (circuit.ts
  // unitySingular), on the matrix of the first step with each unity M scaled.
  if (mutual.some((mu) => mu.unity)) {
    const k0 = keys[0];
    const h0 = keyStep.get(k0) as number;
    const logDet = (els: Element[]): number | null => {
      const saved = mutual.map((mu) => mu.M);
      const scaled = els.filter((e) => e.kind === "K");
      mutual.forEach((mu, i) => {
        mu.M = scaled[i].value * Math.sqrt(inds[mu.p].value * inds[mu.q].value);
      });
      const lu = factorFor(k0, h0);
      mutual.forEach((mu, i) => {
        mu.M = saved[i];
      });
      if (!lu) return null;
      let acc = 0;
      for (let i = 0; i < m; i++) acc += Math.log(Math.abs(lu.diag[i]));
      return acc;
    };
    if (unitySingular(elements, logDet)) return fail(unityMessage(elements));
  }
  const first = factorFor(keys[0], keyStep.get(keys[0]) as number);
  if (!first) return fail(NO_SOLUTION);
  const factorWork = (keys.length * m * m * m) / 3;
  const stepWork = steps * (first.lVal.length + first.uVal.length + 2 * m + 8 * elements.length);
  const load = factorWork / FACTOR_BUDGET + stepWork / RUN_BUDGET;
  if (load > 1)
    return fail(
      factorWork / FACTOR_BUDGET > stepWork / RUN_BUDGET
        ? `The source corners fall between time steps in ${keys.length} different ways, and each needs its own ` +
            "matrix factorization, which is too slow for a circuit this size at this many steps. Choose a time " +
            "step that divides the pulse period, delay, rise, width and fall times (or the PWL times), or use " +
            "fewer steps."
        : `This circuit at ${steps} time steps is more work than the transient tool allows in one run (it would keep ` +
            `Word busy for about ${fmtNum(load * 0.3, 2)} s). Use fewer steps: a longer time step or a ` +
            "shorter stop time.",
    );
  for (let q = 0; q < keys.length; q++) {
    const k = keys[q];
    const lu = q === 0 ? first : factorFor(k, keyStep.get(k) as number);
    if (!lu) return fail(NO_SOLUTION);
    lus.set(k, lu);
    luIndex.set(k, luList.length);
    luList.push(lu);
  }
  // Per step: which factorization and which step length (no Map lookup in the loop).
  const stepLu = new Int32Array(steps);
  const stepH = new Float64Array(steps);
  for (let i = 0; i < steps; i++) {
    const k = keyOf(i);
    stepLu[i] = luIndex.get(k) as number;
    stepH[i] = keyStep.get(k) as number;
  }

  // ------------------------------------------------------------ initial state
  const x = new Float64Array(m + 1);
  for (const nd of dc0.nodes) x[nodeIdx.get(nd.name) as number] = nd.volts;
  const vC = new Float64Array(caps.length);
  const iC = new Float64Array(caps.length);
  for (let c = 0; c < caps.length; c++) vC[c] = (cA[c] >= 0 ? x[cA[c]] : 0) - (cB[c] >= 0 ? x[cB[c]] : 0);
  const iL = new Float64Array(inds.length);
  const vL = new Float64Array(inds.length);
  inds.forEach((e, l) => {
    iL[l] = dc0.currents.find((c) => c.name === e.name)?.amps ?? 0;
    x[lRow[l]] = iL[l];
  });
  vsrc.forEach((e, k) => {
    x[n + k] = dc0.currents.find((c) => c.name === e.name)?.amps ?? 0;
  });

  const timesArr = Float64Array.from(times);
  const probes: Trace[] = probeNames.map((name) => ({ name, values: new Float64Array(nT) }));
  const currents: Trace[] = currentNames.map((name) => ({ name, values: new Float64Array(nT) }));
  const record = (i: number): void => {
    for (let p = 0; p < probeIdx.length; p++) probes[p].values[i] = x[probeIdx[p]];
    for (let c = 0; c < currentRows.length; c++) currents[c].values[i] = x[currentRows[c]];
  };
  record(0);

  // ------------------------------------------------------------ integrate
  // Ground is slot m of rhs and x (x[m] stays 0, rhs[m] is never read), so the
  // loop below has no "is this end grounded?" branches.
  const G = m;
  const gi = (k: number): number => (k < 0 ? G : k);
  const cAi = Int32Array.from(cA, gi);
  const cBi = Int32Array.from(cB, gi);
  const lAi = Int32Array.from(lA, gi);
  const lBi = Int32Array.from(lB, gi);
  const iAi = Int32Array.from(iA, gi);
  const iBi = Int32Array.from(iB, gi);
  const rhs = new Float64Array(m + 1);
  const geq = new Float64Array(caps.length);
  const ieq = new Float64Array(caps.length);
  const nP = probeIdx.length;
  const pIdx = Int32Array.from(probeIdx);
  const pVals = probes.map((p) => p.values);
  const nCur = currentRows.length;
  const cRows = Int32Array.from(currentRows);
  const cVals = currents.map((c) => c.values);
  const nC = caps.length;
  const nL = inds.length;
  const nV = vsrc.length;
  const nI = isrc.length;
  const nMu = mutual.length;
  let beSteps = 0;
  for (let i = 0; i < steps; i++) {
    const lu = luList[stepLu[i]];
    const isBe = be[i] === 1;
    const aoh = (isBe ? 1 : 2) / stepH[i];
    if (isBe) beSteps++;
    const t1 = times[i + 1];
    rhs.fill(0);
    for (let v = 0; v < nV; v++) rhs[vRow[v]] = sourceValueAt(vsrc[v], t1, h);
    for (let s2 = 0; s2 < nI; s2++) {
      const cur = sourceValueAt(isrc[s2], t1, h);
      rhs[iAi[s2]] -= cur;
      rhs[iBi[s2]] += cur;
    }
    for (let c = 0; c < nC; c++) {
      const g = cVal[c] * aoh;
      const q = isBe ? g * vC[c] : g * vC[c] + iC[c];
      geq[c] = g;
      ieq[c] = q;
      rhs[cAi[c]] += q;
      rhs[cBi[c]] -= q;
    }
    for (let l = 0; l < nL; l++) {
      const r = lVal[l] * aoh;
      rhs[lRow[l]] = isBe ? -r * iL[l] : -r * iL[l] - vL[l];
    }
    for (let u = 0; u < nMu; u++) {
      const mu = mutual[u];
      const g = mu.M * aoh;
      rhs[lRow[mu.p]] -= g * iL[mu.q];
      rhs[lRow[mu.q]] -= g * iL[mu.p];
    }
    luSolve(lu, rhs, x);
    for (let c = 0; c < nC; c++) {
      const v = x[cAi[c]] - x[cBi[c]];
      iC[c] = geq[c] * v - ieq[c];
      vC[c] = v;
    }
    for (let l = 0; l < nL; l++) {
      iL[l] = x[lRow[l]];
      vL[l] = x[lAi[l]] - x[lBi[l]];
    }
    const j = i + 1;
    for (let p = 0; p < nP; p++) pVals[p][j] = x[pIdx[p]];
    for (let c = 0; c < nCur; c++) cVals[c][j] = x[cRows[c]];
    if ((i & 1023) === 0 && !Number.isFinite(x[0]))
      return fail("The solution stopped being finite during the run, so there is no response to report.");
  }
  for (let j = 0; j < m; j++)
    if (!Number.isFinite(x[j])) return fail("The solution stopped being finite during the run, so there is no response to report.");

  // ------------------------------------------------------------ final-value oracle
  // A STEP THAT IS COARSE AGAINST THE CIRCUIT. The fastest time constant is
  // estimated cheaply from each reactive element and the resistance at its nodes
  // (C over the conductance at its node; L over the resistance at its ends); nodes
  // held by a voltage source or ground add none. It is an estimate, so it is a note
  // and never a refusal.
  // An L–C pair rings with period 2π√(LC) whatever the resistances are (review
  // round 2: R 1 Ω, L 1 mH, C 1 µF has L/R = 1 ms but rings every 199 µs), so the
  // fastest L–C period over every pair is a second time scale. Over-warning is
  // acceptable here; a missed warning is not.
  const tau = fastestTimeConstant(elements);
  const lc = fastestLcPeriod(elements);
  const tauCoarse = tau !== null && h > tau.tau / 10;
  const lcCoarse = lc !== null && h > lc.period / 20;
  // PHASE DRIFT. The trapezoidal rule rings at slightly the wrong frequency, so a
  // lightly damped L–C loop drifts in phase by about (ωh)²/12 per radian, i.e.
  // (ωh)²/12 · ω · t_stop over the run (review round 3: 0.1 Ω, 1 mH, 1 µF over
  // 20 ms at 9.9 µs was 1.08 V off with no note). Warn above 0.1 rad; size the
  // advice for 0.05 rad: h ≤ √(0.6 / (ω³ t_stop)).
  const omega = lc ? (2 * Math.PI) / lc.period : 0;
  const drift = lc ? ((omega * h) ** 2 / 12) * omega * stop : 0;
  const lcDrift = lc !== null && drift > 0.1;
  if (tauCoarse || lcCoarse || lcDrift) {
    const why: string[] = [];
    if (tauCoarse && tau)
      why.push(`more than a tenth of the shortest time constant this circuit appears to have (about ${fmtSeconds(tau.tau)}, at ${tau.name})`);
    if (lcCoarse && lc)
      why.push(
        `more than a twentieth of the period at which ${lc.l} and ${lc.c} appear to ring (about ${fmtSeconds(lc.period)})`,
      );
    if (lcDrift && !lcCoarse && lc)
      why.push(
        `long enough that ringing between ${lc.l} and ${lc.c} (period about ${fmtSeconds(lc.period)}) appears to drift ` +
          `in phase by about ${fmtNum(drift, 2)} rad over the run`,
      );
    const rec = Math.min(
      tau ? tau.tau / 20 : Infinity,
      lc ? lc.period / 50 : Infinity,
      lc ? Math.sqrt(0.6 / (omega ** 3 * stop)) : Infinity,
    );
    notes.push(
      `The time step (${fmtSeconds(h)}) is ${why.join(", and ")}, so fast detail may be smoothed or distorted. A step ` +
        `of ${fmtSeconds(rec)} or less resolves it (with a shorter stop time if that is too many steps).`,
    );
  }

  // A step-to-step sign flip that persists is the trapezoidal rule meeting a time
  // constant much shorter than the step (BE_RUN damps what a corner leaves, not a
  // mode the step cannot resolve at all). Said, not hidden: the cure is a shorter step.
  // Only a circuit with a capacitor or inductor has a time constant for the rule to
  // mis-step, and an alternation the SOURCE itself has (a fast triangle sampled at
  // its own corners) is the input, not ringing: both are excluded (review round 1).
  const reactive = caps.length + inds.length > 0;
  const sources = [...vsrc, ...isrc].filter((e) => e.wave);
  const sourceFlips = (i: number): boolean =>
    sources.some((e) => {
      const a = sourceValueAt(e, times[i], h);
      const b = sourceValueAt(e, times[i + 1], h);
      const c = sourceValueAt(e, times[i + 2], h);
      return (b - a) * (c - b) < 0;
    });
  for (const p of reactive ? probes : []) {
    const v = p.values;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < nT; i++) {
      if (v[i] < lo) lo = v[i];
      if (v[i] > hi) hi = v[i];
    }
    const floor = 1e-4 * (hi - lo);
    if (!(floor > 0)) continue;
    let run = 0;
    for (let i = 0; i + 2 < nT; i++) {
      const d1 = v[i + 1] - v[i];
      const d2 = v[i + 2] - v[i + 1];
      run = d1 * d2 < 0 && (d1 < 0 ? -d1 : d1) > floor && (d2 < 0 ? -d2 : d2) > floor && !sourceFlips(i) ? run + 1 : 0;
      if (run >= 6) {
        notes.push(
          `V(${p.name}) flips up and down from one step to the next near t = ${fmtSeconds(times[i])}. That is ` +
            "the trapezoidal rule meeting a time constant shorter than the time step; a shorter step removes it.",
        );
        break;
      }
    }
  }

  if (elements.some((e) => e.kind === "E" || e.kind === "G" || e.kind === "H" || e.kind === "F"))
    notes.push(
      `${CONTROLLED_NOTE} The time-step checks here estimate the circuit's speed from the passive elements alone; a ` +
        "controlled source can make it faster or slower than they suggest, so confirm with a shorter step.",
    );
  if (mutual.length) notes.push(COUPLING_NOTE);

  let steady: number | null = 0;
  const unsteady: string[] = [];
  for (const e of elements) {
    const s = steadyFrom(e, h, stop);
    if (typeof s === "string") unsteady.push(s);
    else if (steady !== null) steady = Math.max(steady, s);
  }
  if (unsteady.length) steady = null;
  let finalDc: DcResult | null = null;
  if (steady !== null) {
    const r = solveDc(sourcesAt(elements, stop, h), { inductorsShorted: true });
    if (r.ok) finalDc = r;
  }

  return {
    ok: true,
    h,
    stop,
    times: timesArr,
    probes,
    currents,
    initial: dc0,
    breakpoints,
    beSteps,
    steps,
    factorizations: lus.size,
    steadyFrom: steady,
    unsteady,
    finalDc,
    finalNodes: nodes.map((name, i) => ({ name, volts: x[i] })),
    notes,
  };
}

/** Linear interpolation of a trace at time t (times ascending). */
export function traceAt(times: Float64Array, values: Float64Array, t: number): number {
  const nT = times.length;
  if (t <= times[0]) return values[0];
  if (t >= times[nT - 1]) return values[nT - 1];
  let lo = 0;
  let hi = nT - 1;
  for (let guard = 0; hi - lo > 1 && guard < 64; guard++) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return span > 0 ? values[lo] + ((values[hi] - values[lo]) * (t - times[lo])) / span : values[hi];
}
