// Circuit analysis — DC operating point, AC steady state, and frequency response.
//
// The method is Modified Nodal Analysis. Plain nodal analysis cannot take an
// ideal voltage source (its current is not a function of its own voltage), so
// MNA adds one unknown per voltage source — the current through it — and one
// equation saying what that source fixes. The unknown vector is therefore
//
//     [ node voltages (excluding ground) , current through each voltage source ]
//
// which is also why the branch current through a source comes out of the solve
// for free rather than needing a second pass.
//
// DC IS EXACT, AC IS NOT, AND THAT SPLIT IS PRINCIPLED. A resistive network
// driven by DC sources has a rational answer whenever the component values are
// rational, so the DC path runs on the CAS's exact rationals and a voltage
// divider reports 5/3 V rather than 1.6666666666666667. AC cannot: an impedance
// is jωL with ω = 2πf, and π is not rational. So the AC path is complex
// floating point and says so. Pretending otherwise would be the more dishonest
// choice, and mixing the two silently would be worse.
//
// WHAT IT REFUSES, AND WHY EACH ONE IS A REAL CIRCUIT ERROR RATHER THAN A
// NUMERICAL ONE:
//   - A node with no DC path to ground floats: its voltage is not determined by
//     the circuit, and the MNA matrix is singular. This is the single most
//     common netlist mistake and it must be named, not regularised away.
//   - A loop of ideal voltage sources over-determines the same node, and two
//     sources disagreeing is a contradiction rather than a hard problem.
//   - A shorted voltage source is that same contradiction in its shortest form.
// Every one of these makes the matrix singular; a pseudo-inverse would return a
// confident number for a circuit that cannot exist.

import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratInt, ratIsZero, ratNeg, ratToNumber, ratFromNumber } from "./cas";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ElementKind = "R" | "V" | "I" | "C" | "L";

export interface Element {
  kind: ElementKind;
  name: string;
  /** Node names; "0" (or "gnd") is ground. */
  a: string;
  b: string;
  /** Resistance in ohms, source value in volts or amps, C in farads, L in henries. */
  value: number;
  /** Exact value, when the user typed something exactly representable. */
  exact: Rat | null;
}

export interface DcResult {
  ok: true;
  nodes: { name: string; volts: number; exact: Rat | null }[];
  /** Current through each element, positive flowing from `a` to `b`. */
  currents: { name: string; amps: number; exact: Rat | null }[];
  /** Power in each element; positive means dissipating, negative means delivering. */
  power: { name: string; watts: number }[];
  totalDissipated: number;
  totalDelivered: number;
  exact: boolean;
  notes: string[];
}

export interface AcResult {
  ok: true;
  frequency: number;
  omega: number;
  nodes: { name: string; magnitude: number; phaseDeg: number; re: number; im: number }[];
  notes: string[];
}

export interface SweepPoint {
  f: number;
  magnitude: number;
  phaseDeg: number;
}

export interface Failure {
  ok: false;
  error: string;
}

const MAX_ELEMENTS = 200;
const MAX_NODES = 120;
const MAX_SWEEP_POINTS = 400;

// CASE-INSENSITIVE, because a hardcoded list of spellings is not a predicate.
//
// The set used to be matched exactly, and it happened to contain both "gnd" and
// "GND" — so those two worked and "Gnd" did not. A node called `Gnd` was then an
// ordinary node, and `V1 1 Gnd 5 / R1 1 0 1k` solved to V(1) = 0 V and
// V(Gnd) = -5 V: exact, unique, and completely wrong, from nothing but
// capitalisation. "Ground" and "GROUND" failed the same way while "ground" did
// not, which is the kind of inconsistency nobody would ever think to test.
const GROUND = new Set(["0", "gnd", "gnd!", "ground", "vss", "agnd", "dgnd"]);
const isGround = (n: string): boolean => GROUND.has(n.trim().toLowerCase());

// ---------------------------------------------------------------------------
// Complex arithmetic — small and local; linalg.ts is real-valued.
// ---------------------------------------------------------------------------

interface Cx {
  re: number;
  im: number;
}
const cx = (re: number, im = 0): Cx => ({ re, im });
const cAdd = (x: Cx, y: Cx): Cx => ({ re: x.re + y.re, im: x.im + y.im });
const cSub = (x: Cx, y: Cx): Cx => ({ re: x.re - y.re, im: x.im - y.im });
const cMul = (x: Cx, y: Cx): Cx => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
const cDiv = (x: Cx, y: Cx): Cx => {
  const d = y.re * y.re + y.im * y.im;
  return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d };
};
const cAbs = (x: Cx): number => Math.hypot(x.re, x.im);
const cIsZero = (x: Cx): boolean => x.re === 0 && x.im === 0;

// ---------------------------------------------------------------------------
// Netlist
// ---------------------------------------------------------------------------

/** SI suffixes as an engineer writes them: 1k, 4.7u, 10meg. `meg` before `m`. */
const SUFFIX: [string, number][] = [
  ["meg", 1e6],
  ["g", 1e9],
  ["k", 1e3],
  ["m", 1e-3],
  ["u", 1e-6],
  ["n", 1e-9],
  ["p", 1e-12],
  ["f", 1e-15],
];

/**
 * Parses "4.7k" into a number and, where the result is exactly representable,
 * an exact rational. 4.7k is 4700 exactly; 4.7u is 47/10000000 exactly. Keeping
 * both means the DC path stays exact for values a user actually types.
 */
export function parseValue(text: string): { value: number; exact: Rat | null } | null {
  const t = text.trim().toLowerCase();

  // RKM notation puts the multiplier WHERE THE DECIMAL POINT GOES: 2k2 is
  // 2.2 kilo, 4r7 is 4.7 ohms, 1m5 is 1.5 milli. It is how values are printed
  // on schematics and in parts lists precisely because a decimal point survives
  // neither a photocopier nor a small silkscreen. Rewriting it into ordinary
  // form here means the rest of the parser never has to know.
  const rkm = /^([+-]?\d+)(meg|[gkmunpfr])(\d+)$/.exec(t);
  const normalised = rkm ? `${rkm[1]}.${rkm[3]}${rkm[2] === "r" ? "" : rkm[2]}` : t;

  // SCIENTIFIC NOTATION IS HOW SPREADSHEETS AND SPICE DECKS WRITE COMPONENT
  // VALUES. `1u` was accepted and `1e-6` — the same number — was refused, so
  // anything pasted from a spreadsheet or a netlist export failed on a value the
  // user could see was valid. `2.2e3` and `1E-9` likewise.
  //
  // The exponent is folded into the EXACT rational below rather than only into the
  // float, because this module's whole DC path is exact and a value that is exact
  // when written `1u` must not become inexact when written `1e-6`.
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d+))?(meg|[gkmunpf])?$/.exec(normalised);
  if (!m) return null;
  const mantissa = m[1];
  const exponent = m[2] ? parseInt(m[2], 10) : 0;
  const suffix = m[3];
  // A bound on the exponent: 10n ** BigInt(huge) would allocate without limit, and
  // an unbounded allocation in a task pane is a frozen Word rather than an error.
  if (!Number.isFinite(exponent) || Math.abs(exponent) > 400) return null;
  let scale = 1;
  if (suffix) {
    const hit = SUFFIX.find(([s]) => s === suffix);
    if (!hit) return null;
    scale = hit[1];
  }
  const value = parseFloat(mantissa) * Math.pow(10, exponent) * scale;
  if (!Number.isFinite(value)) return null;

  // Exact rational from the decimal string times the (power-of-ten) scale.
  const neg = mantissa.startsWith("-");
  const body = mantissa.replace(/^[+-]/, "");
  const [int, frac = ""] = body.split(".");
  let n = BigInt((int || "0") + frac);
  if (neg) n = -n;
  // The decimal string contributes 10^-frac.length and the exponent 10^exponent,
  // so the two combine into a single power of ten. Kept exact either way.
  const tenPower = exponent - frac.length;
  let exact: Rat = ratInt(n);
  if (tenPower >= 0) exact = ratMul(exact, ratInt(10n ** BigInt(tenPower)));
  else exact = ratDiv(exact, ratInt(10n ** BigInt(-tenPower)));
  if (scale >= 1) exact = ratMul(exact, ratInt(BigInt(Math.round(scale))));
  else exact = ratDiv(exact, ratInt(BigInt(Math.round(1 / scale))));
  return { value, exact };
}

export interface ParsedNetlist {
  elements: Element[];
  errors: string[];
}

/**
 * Reads a SPICE-style netlist, one element per line:
 *   R1 1 0 1k        resistor
 *   V1 1 0 5         voltage source, + at the first node
 *   I1 2 0 10m       current source, flowing from the first node to the second INSIDE it
 *   C1 2 0 4.7u      capacitor (AC only)
 *   L1 1 2 10m       inductor (AC only)
 */
export function parseNetlist(text: string): ParsedNetlist {
  const elements: Element[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\n|;/)) {
    const line = raw.replace(/[*#].*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 4) {
      errors.push(`"${line}" needs exactly four fields: name, node, node, value.`);
      continue;
    }
    const [name, a, b, valueText] = parts;
    const kindChar = name[0].toUpperCase();
    if (!"RVICL".includes(kindChar)) {
      errors.push(`"${name}" must start with R, V, I, C or L.`);
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      errors.push(`Two elements are both called "${name}".`);
      continue;
    }
    seen.add(name.toLowerCase());
    const v = parseValue(valueText);
    if (!v) {
      errors.push(`Could not read the value "${valueText}" in "${line}".`);
      continue;
    }
    if (a === b) {
      errors.push(`"${name}" has both ends on node ${a}, which shorts it out.`);
      continue;
    }
    if (kindChar === "R" && v.value === 0) {
      errors.push(`"${name}" is a zero-ohm resistor, which is a short. Remove it and merge the nodes.`);
      continue;
    }
    // A ZERO-VALUED L OR C IS NOT A COMPONENT EITHER, and it was not caught.
    // Its admittance is infinite (1/(jwL) with L = 0), and the pivot guard only
    // rejects SMALL pivots — an infinite one sailed through, cDiv then produced
    // NaN, and the pane printed "V(1) = not finite at not finite deg" as a
    // successful result that could be inserted into the document. A zero
    // inductor is a short and a zero capacitor is an open; both are structural
    // statements the user should make by editing the netlist, not by a value.
    if ((kindChar === "L" || kindChar === "C") && v.value === 0) {
      errors.push(
        `"${name}" has a value of zero. A zero-henry inductor is a short and a zero-farad ` +
          "capacitor is an open circuit — say that by changing the netlist rather than the value, " +
          "because at zero the element's admittance is infinite and there is no answer to report.",
      );
      continue;
    }
    elements.push({ kind: kindChar as ElementKind, name, a, b, value: v.value, exact: v.exact });
  }
  if (elements.length > MAX_ELEMENTS) errors.push(`At most ${MAX_ELEMENTS} elements.`);

  // PASSIVITY. This module is documented as linear and PASSIVE, and a negative
  // resistance, inductance or capacitance was accepted in silence — producing a
  // mathematically valid solution to a circuit that cannot be built. The equations
  // do not object; only physics does, so the check has to be here.
  //
  // A negative resistance IS a real small-signal model (a tunnel diode, an
  // oscillator), but modelling one properly needs the active-device support this
  // tool explicitly does not have, so accepting the value would imply a capability
  // that is not present.
  for (const e of elements) {
    if ((e.kind === "R" || e.kind === "L" || e.kind === "C") && e.value < 0) {
      const what = e.kind === "R" ? "resistance" : e.kind === "L" ? "inductance" : "capacitance";
      errors.push(
        `${e.name} has a negative ${what} (${e.value}). This tool solves LINEAR PASSIVE ` +
          `circuits, and no physical component has a negative ${what}. A negative resistance is ` +
          `a legitimate small-signal model for an active device, but modelling one needs the ` +
          `active-device support this tool does not have — so the value is refused rather than ` +
          `solved as though it were a component.`,
      );
    }
  }
  return { elements, errors };
}

/** Non-ground node names, in first-seen order. */
function nodeList(elements: Element[]): string[] {
  const out: string[] = [];
  for (const e of elements)
    for (const n of [e.a, e.b]) if (!isGround(n) && !out.includes(n)) out.push(n);
  return out;
}

// ---------------------------------------------------------------------------
// Exact linear solve over rationals
// ---------------------------------------------------------------------------

/**
 * Above this many unknowns the exact solve is abandoned in favour of doubles.
 *
 * Exact Gaussian elimination over the rationals has no rounding error, and it pays
 * for that with COEFFICIENT GROWTH: the numerators and denominators roughly double
 * in bit length at every elimination step, so a dense system costs far more than
 * its O(n^3) arithmetic-operation count suggests. Measured on a 120-node
 * interconnected mesh at the parser's own legal limit — 1362 ms for the DC solve
 * and 1102 ms for a 120-point sweep, about 2.5 seconds in total, on a pane that
 * recomputes on EVERY KEYSTROKE. That is not a slow answer, it is a Word that
 * stops accepting typing.
 *
 * 48 is chosen from the measurements rather than by taste: at that size the exact
 * solve is still a few milliseconds, and every netlist a person types by hand is
 * far below it. Past it the answer comes back in doubles and SAYS SO, because a
 * result that is silently no longer exact in a module that advertises exactness
 * would be a false claim rather than a slow one.
 */
const MAX_EXACT_UNKNOWNS = 48;

/**
 * The same elimination in DOUBLES, for systems too large to do exactly.
 *
 * Returned as Rats so the caller's arithmetic is unchanged — they are exactly the
 * doubles that came out, which is honest: each is an exact rational equal to the
 * double, not an exact solution of the circuit. The caller clears its exactness
 * flag, so the result is never presented as exact.
 *
 * Partial pivoting on the largest remaining magnitude, and a RELATIVE singularity
 * test: an absolute one would call a correctly-scaled small pivot singular and a
 * badly-scaled large one fine.
 */
function solveFloat(A: Rat[][], b: Rat[]): Rat[] | null {
  const n = b.length;
  const m: number[][] = A.map((row, i) => [...row.map(ratToNumber), ratToNumber(b[i])]);
  let scale = 0;
  for (const row of m) for (const v of row) if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v));
  if (scale === 0) return null;
  for (let col = 0; col < n; col++) {
    let p = -1;
    let best = 0;
    for (let r = col; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (p < 0 || best <= scale * 1e-14) return null;
    if (p !== col) {
      const t = m[p];
      m[p] = m[col];
      m[col] = t;
    }
    const piv = m[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col || m[r][col] === 0) continue;
      const f = m[r][col] / piv;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const out: Rat[] = [];
  for (let i = 0; i < n; i++) {
    const v = m[i][n] / m[i][i];
    if (!Number.isFinite(v)) return null;
    out.push(ratFromNumber(v));
  }
  return out;
}

function solveRat(A: Rat[][], b: Rat[]): Rat[] | null {
  const n = b.length;
  if (n > MAX_EXACT_UNKNOWNS) return null;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let p = -1;
    for (let r = col; r < n; r++)
      if (!ratIsZero(m[r][col])) {
        p = r;
        break;
      }
    if (p < 0) return null;
    if (p !== col) {
      const t = m[p];
      m[p] = m[col];
      m[col] = t;
    }
    const pv = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] = ratDiv(m[col][j], pv);
    for (let r = 0; r < n; r++) {
      if (r === col || ratIsZero(m[r][col])) continue;
      const f = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] = ratSub(m[r][j], ratMul(f, m[col][j]));
    }
  }
  return m.map((r) => r[n]);
}

function solveCx(A: Cx[][], b: Cx[]): Cx[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let p = -1;
    let best = 0;
    for (let r = col; r < n; r++) {
      const mag = cAbs(m[r][col]);
      if (mag > best) {
        best = mag;
        p = r;
      }
    }
    // A pivot this small means the matrix is singular to working precision —
    // the same floating circuit that the exact path refuses outright.
    if (p < 0 || best < 1e-14) return null;
    if (p !== col) {
      const t = m[p];
      m[p] = m[col];
      m[col] = t;
    }
    const pv = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] = cDiv(m[col][j], pv);
    for (let r = 0; r < n; r++) {
      if (r === col || cIsZero(m[r][col])) continue;
      const f = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] = cSub(m[r][j], cMul(f, m[col][j]));
    }
  }
  return m.map((r) => r[n]);
}

// ---------------------------------------------------------------------------
// DC
// ---------------------------------------------------------------------------

const R0 = ratInt(0);

function singularMessage(elements: Element[], nodes: string[]): string {
  // Which of the three real circuit errors is it? Naming the right one is the
  // difference between a useful message and "matrix is singular".
  const vLoop = elements.filter((e) => e.kind === "V");
  for (const e of vLoop)
    if (elements.some((o) => o !== e && o.kind === "V" && ((o.a === e.a && o.b === e.b) || (o.a === e.b && o.b === e.a))))
      return `${e.name} is in parallel with another voltage source across the same two nodes. Two ideal sources cannot both set that voltage.`;

  // A node with no resistive/source path to ground floats.
  const reach = new Set<string>(["0"]);
  let grew = true;
  let guard = 0;
  while (grew && guard++ < MAX_NODES + 2) {
    grew = false;
    for (const e of elements) {
      // A CURRENT SOURCE AND A CAPACITOR ARE BOTH OPEN CIRCUITS TO DC BIAS.
      // Only the current source was skipped, so a node reachable solely through
      // a capacitor counted as grounded — which defeated the single refusal this
      // module's header leads with ("a node with no DC path to ground floats"),
      // for the single commonest netlist mistake it exists to catch: the
      // coupling-capacitor input with no bias resistor.
      if (e.kind === "I" || e.kind === "C") continue;
      const a = isGround(e.a) ? "0" : e.a;
      const b = isGround(e.b) ? "0" : e.b;
      if (reach.has(a) && !reach.has(b)) {
        reach.add(b);
        grew = true;
      } else if (reach.has(b) && !reach.has(a)) {
        reach.add(a);
        grew = true;
      }
    }
  }
  const floating = nodes.filter((n) => !reach.has(n));
  if (floating.length)
    return (
      `Node ${floating.join(", ")} has no DC path to ground, so its voltage is not determined by this circuit. ` +
      "Add a resistor to ground, or check for a typo in a node name."
    );
  // A LOOP OF IDEAL SOURCES, which the parallel-pair test above cannot see.
  //
  // Three sources round a loop — V1 across 1-0, V2 across 2-1, V3 across 2-0 —
  // over-determine the node voltages without any two of them being in parallel.
  // An inductor is a short at DC, so a source shorted through one is the same
  // fault. Both reach here, and neither is "a shorted or duplicated source" in any
  // sense the reader can act on.
  const zeroImpedance = elements.filter((e) => e.kind === "V" || e.kind === "L");
  if (zeroImpedance.length >= 2) {
    // Union-find over the zero-impedance subgraph: a cycle means an over-determined
    // loop. Bounded by the element count, so it cannot spin.
    const parent = new Map<string, string>();
    const find = (n: string): string => {
      let r = n;
      let guard = 0;
      while (parent.get(r) !== undefined && parent.get(r) !== r && guard++ < MAX_NODES + 2) {
        r = parent.get(r) as string;
      }
      return r;
    };
    let cycle: Element | null = null;
    for (const e of zeroImpedance) {
      const a = isGround(e.a) ? "0" : e.a;
      const b = isGround(e.b) ? "0" : e.b;
      if (parent.get(a) === undefined) parent.set(a, a);
      if (parent.get(b) === undefined) parent.set(b, b);
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) {
        cycle = e;
        break;
      }
      parent.set(ra, rb);
    }
    if (cycle) {
      const kinds = zeroImpedance.some((e) => e.kind === "L")
        ? "voltage sources and inductors (an inductor is a short circuit at DC)"
        : "voltage sources";
      return (
        `${cycle.name} completes a loop of ${kinds}, which over-determines the node ` +
        "voltages: going round the loop gives two different answers for the same voltage. " +
        "Break the loop by putting a resistance in series with one of them, or remove the " +
        "redundant source."
      );
    }
  }

  // NAME ONLY WHAT HAS NOT BEEN RULED OUT. The old text here read "check for a
  // shorted or duplicated source" — but a duplicated source is caught by the
  // parallel-pair test above and a source loop by the test just above this, so it
  // sent the reader looking for two faults that had already been excluded. A
  // message that is false is a defect in its own right.
  return (
    "The nodal equations for this circuit have no unique solution, and it is not one of the " +
    "faults this tool can name: it is not a pair of voltage sources in parallel, not a node " +
    "without a DC path to ground, and not a loop of sources or inductors — each of those was " +
    "checked. What remains is usually a redundant constraint somewhere in the topology. Try " +
    "removing elements until it solves; the last one removed is the one to look at."
  );
}

export function solveDc(elements: Element[]): DcResult | Failure {
  if (!elements.length) return { ok: false, error: "The netlist is empty." };
  const nodes = nodeList(elements);
  if (!nodes.length) return { ok: false, error: "Every node is ground — there is nothing to solve." };
  if (nodes.length > MAX_NODES) return { ok: false, error: `At most ${MAX_NODES} nodes.` };
  if (!elements.some((e) => e.kind === "V" || e.kind === "I"))
    return { ok: false, error: "There is no source in this circuit, so every voltage is zero. Add a V or I element." };

  const idx = new Map(nodes.map((n, i) => [n, i]));
  const vs = elements.filter((e) => e.kind === "V");
  const n = nodes.length;
  const size = n + vs.length;

  const A: Rat[][] = Array.from({ length: size }, () => new Array<Rat>(size).fill(R0));
  const rhs: Rat[] = new Array<Rat>(size).fill(R0);
  let exactOk = true;

  const at = (name: string): number | null => (isGround(name) ? null : (idx.get(name) as number));

  for (const e of elements) {
    const ia = at(e.a);
    const ib = at(e.b);
    if (e.kind === "R") {
      if (!e.exact) exactOk = false;
      const g = e.exact ? ratDiv(ratInt(1), e.exact) : null;
      if (!g) return { ok: false, error: `${e.name} has a value this tool cannot represent exactly.` };
      if (ia !== null) A[ia][ia] = ratAdd(A[ia][ia], g);
      if (ib !== null) A[ib][ib] = ratAdd(A[ib][ib], g);
      if (ia !== null && ib !== null) {
        A[ia][ib] = ratSub(A[ia][ib], g);
        A[ib][ia] = ratSub(A[ib][ia], g);
      }
    } else if (e.kind === "I") {
      if (!e.exact) exactOk = false;
      const cur = e.exact ?? R0;
      // Current flows from a to b INSIDE the source, so it leaves node a.
      if (ia !== null) rhs[ia] = ratSub(rhs[ia], cur);
      if (ib !== null) rhs[ib] = ratAdd(rhs[ib], cur);
    } else if (e.kind === "C" || e.kind === "L") {
      // At DC a capacitor is an open circuit and an inductor a short. A short
      // between two nodes needs them merged, which this simple formulation does
      // not do, so say so rather than analyse a different circuit.
      if (e.kind === "L")
        return {
          ok: false,
          error: `${e.name} is an inductor, which is a short circuit at DC. Remove it (and merge its two nodes) for a DC analysis, or run the AC analysis instead.`,
        };
    }
  }

  vs.forEach((e, k) => {
    const row = n + k;
    const ia = at(e.a);
    const ib = at(e.b);
    if (!e.exact) exactOk = false;
    const val = e.exact ?? R0;
    if (ia !== null) {
      A[row][ia] = ratAdd(A[row][ia], ratInt(1));
      A[ia][row] = ratAdd(A[ia][row], ratInt(1));
    }
    if (ib !== null) {
      A[row][ib] = ratSub(A[row][ib], ratInt(1));
      A[ib][row] = ratSub(A[ib][row], ratInt(1));
    }
    rhs[row] = val;
  });

  // Exact when it is affordable, doubles when it is not — never a refusal purely
  // for being large, because a slow correct answer traded for no answer is a worse
  // deal than an approximate one that says so.
  let sol = solveRat(A, rhs);
  let solvedInDoubles = false;
  if (!sol && rhs.length > MAX_EXACT_UNKNOWNS) {
    sol = solveFloat(A, rhs);
    solvedInDoubles = sol !== null;
    if (solvedInDoubles) exactOk = false;
  }
  if (!sol) return { ok: false, error: singularMessage(elements, nodes) };

  const nodeVolt = (name: string): Rat => (isGround(name) ? R0 : sol[idx.get(name) as number]);

  const currents: DcResult["currents"] = [];
  const power: DcResult["power"] = [];
  let dissipated = 0;
  let delivered = 0;

  for (const e of elements) {
    let iExact: Rat | null = null;
    if (e.kind === "R" && e.exact) {
      iExact = ratDiv(ratSub(nodeVolt(e.a), nodeVolt(e.b)), e.exact);
    } else if (e.kind === "I") {
      iExact = e.exact;
    } else if (e.kind === "V") {
      const k = vs.indexOf(e);
      // MNA's extra unknown appears in node a's KCL with a +1 coefficient, and
      // that equation sums currents LEAVING the node — so the unknown already IS
      // the current from a to b through the source. Negating it here made a
      // source that delivers power look like one that dissipates it, and the
      // power balance came out 0.995 W dissipated against 0 W delivered instead
      // of splitting evenly. It matches SPICE's I(Vx), which is likewise
      // negative for a source driving the circuit.
      //
      // The parallel-resistor test could not catch this: it asserts on
      // Math.abs of the source current, so both signs pass.
      iExact = sol[n + k];
    }
    if (iExact === null) continue;
    const amps = ratToNumber(iExact);
    currents.push({ name: e.name, amps, exact: iExact });
    const vDrop = ratToNumber(ratSub(nodeVolt(e.a), nodeVolt(e.b)));
    const watts = vDrop * amps;
    power.push({ name: e.name, watts });
    if (watts >= 0) dissipated += watts;
    else delivered += -watts;
  }

  const notes: string[] = [];
  if (solvedInDoubles) {
    notes.push(
      `This circuit has ${rhs.length} unknowns, more than the ${MAX_EXACT_UNKNOWNS} the exact ` +
        "rational solver handles in reasonable time, so the node voltages below were computed in " +
        "double precision instead of exactly. Exact elimination over the rationals has no " +
        "rounding error but its coefficients grow at every step, and on a mesh this size it took " +
        "well over a second — in a pane that recomputes as you type, that is a frozen Word rather " +
        "than a slow answer. The numbers are accurate to about twelve significant figures; they " +
        "are simply not exact, and nothing here will claim they are.",
    );
  }
  if (elements.some((e) => e.kind === "C"))
    notes.push("Capacitors are open circuits at DC, so they carry no current here and set no voltage of their own.");
  if (!exactOk) notes.push("Some values could not be held exactly, so these results are floating point.");

  return {
    ok: true,
    nodes: nodes.map((name) => ({ name, volts: ratToNumber(nodeVolt(name)), exact: nodeVolt(name) })),
    currents,
    power,
    totalDissipated: dissipated,
    totalDelivered: delivered,
    exact: exactOk,
    notes,
  };
}

// ---------------------------------------------------------------------------
// AC steady state
// ---------------------------------------------------------------------------

/** Admittance of one element at angular frequency w. Sources contribute none. */
function admittance(e: Element, w: number): Cx | null {
  if (e.kind === "R") return cx(1 / e.value, 0);
  if (e.kind === "C") return cx(0, w * e.value);
  if (e.kind === "L") {
    if (w === 0) return null; // a short at DC; handled by the caller
    return cx(0, -1 / (w * e.value));
  }
  return null;
}

function buildAc(elements: Element[], nodes: string[], w: number): { A: Cx[][]; b: Cx[]; vs: Element[] } {
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const vs = elements.filter((e) => e.kind === "V");
  const n = nodes.length;
  const size = n + vs.length;
  const A: Cx[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => cx(0)));
  const b: Cx[] = Array.from({ length: size }, () => cx(0));
  const at = (name: string): number | null => (isGround(name) ? null : (idx.get(name) as number));

  for (const e of elements) {
    const y = admittance(e, w);
    const ia = at(e.a);
    const ib = at(e.b);
    if (y) {
      if (ia !== null) A[ia][ia] = cAdd(A[ia][ia], y);
      if (ib !== null) A[ib][ib] = cAdd(A[ib][ib], y);
      if (ia !== null && ib !== null) {
        A[ia][ib] = cSub(A[ia][ib], y);
        A[ib][ia] = cSub(A[ib][ia], y);
      }
    } else if (e.kind === "I") {
      if (ia !== null) b[ia] = cSub(b[ia], cx(e.value));
      if (ib !== null) b[ib] = cAdd(b[ib], cx(e.value));
    }
  }
  vs.forEach((e, k) => {
    const row = n + k;
    const ia = at(e.a);
    const ib = at(e.b);
    if (ia !== null) {
      A[row][ia] = cAdd(A[row][ia], cx(1));
      A[ia][row] = cAdd(A[ia][row], cx(1));
    }
    if (ib !== null) {
      A[row][ib] = cSub(A[row][ib], cx(1));
      A[ib][row] = cSub(A[ib][row], cx(1));
    }
    b[row] = cx(e.value);
  });
  return { A, b, vs };
}

export function solveAc(elements: Element[], frequency: number): AcResult | Failure {
  if (!elements.length) return { ok: false, error: "The netlist is empty." };
  if (!Number.isFinite(frequency) || frequency <= 0)
    return { ok: false, error: "Frequency must be a positive number of hertz." };
  const nodes = nodeList(elements);
  if (!nodes.length) return { ok: false, error: "Every node is ground — there is nothing to solve." };
  if (nodes.length > MAX_NODES) return { ok: false, error: `At most ${MAX_NODES} nodes.` };
  if (!elements.some((e) => e.kind === "V" || e.kind === "I"))
    return { ok: false, error: "There is no source in this circuit. Add a V or I element." };

  const w = 2 * Math.PI * frequency;
  const { A, b } = buildAc(elements, nodes, w);
  const sol = solveCx(A, b);
  if (!sol) return { ok: false, error: singularMessage(elements, nodes) };

  const notes = [
    "AC results are steady-state phasors at this one frequency, and are floating point: an impedance " +
      "carries 2*pi*f, which is not rational. Phase is in degrees, relative to the source.",
  ];
  return {
    ok: true,
    frequency,
    omega: w,
    nodes: nodes.map((name, i) => {
      const v = sol[i];
      return {
        name,
        magnitude: cAbs(v),
        phaseDeg: (Math.atan2(v.im, v.re) * 180) / Math.PI,
        re: v.re,
        im: v.im,
      };
    }),
    notes,
  };
}

/**
 * Magnitude and phase at `outNode` across a logarithmic frequency sweep — the
 * data a Bode plot is drawn from. Decades are swept geometrically because that
 * is how the plot is read; a linear sweep wastes almost every point above the
 * first decade.
 */
export function frequencySweep(
  elements: Element[],
  outNode: string,
  fMin: number,
  fMax: number,
  points = 120,
): { points: SweepPoint[]; error?: string } | Failure {
  if (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMin <= 0 || fMax <= fMin)
    return { ok: false, error: "The sweep needs 0 < start frequency < stop frequency." };
  const nodes = nodeList(elements);
  if (!nodes.includes(outNode))
    return { ok: false, error: `There is no node called "${outNode}". Nodes here are: ${nodes.join(", ")}.` };
  // THE POINT COUNT MUST SCALE WITH THE CIRCUIT, because each point is a whole
  // complex solve. At 120 nodes a 120-point sweep took 1201 ms — and this runs
  // behind a Bode chart in a pane that recomputes as the user types, so it is a
  // second of dropped keystrokes rather than a slow chart.
  //
  // A complex Gaussian elimination is O(nodes^3) per point, so the budget is set on
  // points * nodes^3 and the resolution is spent where it is affordable. Small
  // circuits — every hand-typed netlist — are untouched at the full 120 points; only
  // a large mesh is thinned, and the sweep is still log-spaced across the same
  // range, so the shape of the response is preserved rather than truncated.
  const requested = Math.max(2, Math.min(Math.floor(points) || 120, MAX_SWEEP_POINTS));
  const SWEEP_BUDGET = 120 * 30 * 30 * 30; // 120 points at 30 nodes, the reference cost
  const affordable = Math.max(12, Math.floor(SWEEP_BUDGET / Math.max(1, nodes.length ** 3)));
  const n = Math.min(requested, Math.max(12, affordable));
  const thinned = n < requested;
  const out: SweepPoint[] = [];
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);
  for (let i = 0; i < n; i++) {
    const f = Math.pow(10, logMin + ((logMax - logMin) * i) / (n - 1));
    const r = solveAc(elements, f);
    if (!r.ok) return { ok: false, error: r.error };
    const node = r.nodes.find((x) => x.name === outNode);
    if (!node) return { ok: false, error: `Lost node ${outNode} during the sweep.` };
    out.push({ f, magnitude: node.magnitude, phaseDeg: node.phaseDeg });
  }
  return {
    points: out,
    // Disclosed, not silent: a chart drawn from 12 points where 120 were asked for
    // looks like a coarse chart, and the reader deserves to know which it is.
    error: thinned
      ? `This circuit has ${nodes.length} nodes, and every sweep point is a full complex solve, ` +
        `so the sweep was thinned from ${requested} points to ${n} to keep the pane responsive. ` +
        `The frequency range is unchanged and still log-spaced; the curve is simply coarser. ` +
        `Sweep a smaller sub-circuit for more resolution.`
      : undefined,
  };
}

/** Decibels relative to a reference, for the magnitude axis of a Bode plot. */
export const dB = (magnitude: number, reference = 1): number =>
  magnitude > 0 && reference > 0 ? 20 * Math.log10(magnitude / reference) : -Infinity;
