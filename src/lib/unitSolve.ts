// Units-aware equation solving: a formula plus knowns that CARRY UNITS.
//
//   F = m a
//   m = 3 kg
//   a = 2 m/s^2        →  F = 6 N  (6 kg·m/s²)
//
// The formula is rearranged symbolically for the one unknown (the same CAS
// path as plain Solve, conditions and all), the knowns are converted to SI
// exactly once — and REPORTED when that changed anything (3 km → 3000 m) —
// and the result's unit is DERIVED by dimensional arithmetic, never assumed.
//
// The honesty core is the dimension checker: adding or comparing quantities
// of different dimensions is refused BY SYMBOL AND UNIT ("u carries m where
// u + a·t needs m/s"), a function of a dimensioned quantity (sin of metres)
// is refused, and a result whose dimensions match no named unit is shown in
// base form rather than force-named.

import { Expr, parseExpr, evalAst, freeVars, format, solveEquation } from "./solve";
import { parseCompoundUnit } from "./units";

type Dims = Record<string, number>;

export interface UnitKnown {
  symbol: string;
  /** As the user wrote it, e.g. "3 km". */
  shown: string;
  /** SI value after conversion. */
  si: number;
  dims: Dims;
  /** Set when SI conversion changed the number (3 km → 3000 m). */
  converted?: string;
}

export interface UnitSolveResult {
  unknown: string;
  /** Numeric value in SI base units. */
  value: number;
  /** Derived unit, base form: "kg·m/s²" ("" for dimensionless). */
  unit: string;
  /** Named unit when the signature matches one (N, J, W, Pa, Hz, C, V, Ω). */
  namedUnit: string | null;
  knowns: UnitKnown[];
  steps: Array<{ text?: string; math?: string }>;
  caveats: string[];
  /** Set instead of a value when the dimensions genuinely do not work. */
  refusal?: string;
}

// Every ATOMIC dim key units.ts can produce (the compound dims all decompose
// via its BASE table before they reach here). The engine's key is `temp`, not
// `temperature` — a mismatch here silently DROPPED kelvins from displayed
// units (adversarial finding, value-pinned).
const SI_SYMBOL: Record<string, string> = {
  mass: "kg",
  length: "m",
  time: "s",
  current: "A",
  temp: "K",
  amount: "mol",
  angle: "rad",
  luminousintensity: "cd",
  luminousflux: "lm",
  information: "bit",
  fraction: "frac",
};

/** Signature → SI named unit. Kept to the unambiguous classics — Hz is NOT
 *  here: bare s⁻¹ is exactly the ambiguous signature (Hz / rad·s⁻¹ / Bq). */
const NAMED: Array<{ dims: Dims; name: string }> = [
  { dims: { mass: 1, length: 1, time: -2 }, name: "N" },
  { dims: { mass: 1, length: -1, time: -2 }, name: "Pa" },
  { dims: { mass: 1, length: 2, time: -2 }, name: "J" },
  { dims: { mass: 1, length: 2, time: -3 }, name: "W" },
  { dims: { current: 1, time: 1 }, name: "C" },
  { dims: { mass: 1, length: 2, time: -3, current: -1 }, name: "V" },
  { dims: { mass: 1, length: 2, time: -3, current: -2 }, name: "Ω" },
];

function dimsEqual(a: Dims, b: Dims): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

function dimsEmpty(d: Dims): boolean {
  return Object.values(d).every((v) => v === 0);
}

const SUP: Record<string, string> = { "1": "¹", "2": "²", "3": "³", "4": "⁴", "-": "⁻", "0": "⁰", "5": "⁵" };

function supExp(n: number): string {
  if (n === 1) return "";
  // Fractional exponents stay ASCII (^0.5) — a mixed superscript-and-period
  // form neither reads nor parses back.
  if (!Number.isInteger(n)) return `^${n}`;
  return [...String(n)].map((c) => SUP[c] ?? c).join("");
}

/** "kg·m/s²" — positive powers first, then a single "/" for the negatives.
 *  A dim key outside the map is RENDERED under its own name, never dropped. */
export function dimsToUnit(d: Dims): string {
  const known = Object.keys(SI_SYMBOL);
  const order = [...known.filter((k) => k in d), ...Object.keys(d).filter((k) => !known.includes(k)).sort()];
  const sym = (k: string): string => SI_SYMBOL[k] ?? k;
  const pos = order.filter((k) => (d[k] ?? 0) > 0).map((k) => `${sym(k)}${supExp(d[k])}`);
  const neg = order.filter((k) => (d[k] ?? 0) < 0).map((k) => `${sym(k)}${supExp(-d[k])}`);
  if (!pos.length && !neg.length) return "";
  if (!neg.length) return pos.join("·");
  if (!pos.length) return `1/${neg.join("·")}`;
  return `${pos.join("·")}/${neg.join("·")}`;
}

class DimError extends Error {}

interface Q {
  v: number;
  dims: Dims;
}

function combine(a: Dims, b: Dims, sign: 1 | -1): Dims {
  const out: Dims = { ...a };
  for (const [k, e] of Object.entries(b)) out[k] = (out[k] ?? 0) + sign * e;
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

function scale(a: Dims, n: number): Dims {
  const out: Dims = {};
  for (const [k, e] of Object.entries(a)) {
    const s = e * n;
    if (s !== 0) out[k] = s;
  }
  return out;
}

/** Dimension-aware evaluation. Throws DimError with a NAMED explanation. */
function evalDim(e: Expr, env: Record<string, Q>, describe: (x: Expr) => string): Q {
  switch (e.t) {
    case "num":
      return { v: e.v, dims: {} };
    case "var": {
      if (e.name in env) return { v: env[e.name].v, dims: env[e.name].dims };
      if (e.name === "pi") return { v: Math.PI, dims: {} };
      if (e.name === "e") return { v: Math.E, dims: {} };
      throw new DimError(`No value with a unit was given for ${e.name}.`);
    }
    case "neg": {
      const q = evalDim(e.e, env, describe);
      return { v: -q.v, dims: q.dims };
    }
    case "add":
    case "sub": {
      const l = evalDim(e.l, env, describe);
      const r = evalDim(e.r, env, describe);
      if (!dimsEqual(l.dims, r.dims)) {
        throw new DimError(
          `${describe(e.l)} carries ${dimsToUnit(l.dims) || "no unit"} but ${describe(e.r)} carries ` +
            `${dimsToUnit(r.dims) || "no unit"} — quantities of different dimensions cannot be ${e.t === "add" ? "added" : "subtracted"}. Check the units of the knowns.`,
        );
      }
      return { v: e.t === "add" ? l.v + r.v : l.v - r.v, dims: l.dims };
    }
    case "mul": {
      const l = evalDim(e.l, env, describe);
      const r = evalDim(e.r, env, describe);
      return { v: l.v * r.v, dims: combine(l.dims, r.dims, 1) };
    }
    case "div": {
      const l = evalDim(e.l, env, describe);
      const r = evalDim(e.r, env, describe);
      return { v: l.v / r.v, dims: combine(l.dims, r.dims, -1) };
    }
    case "pow": {
      const b = evalDim(e.l, env, describe);
      const x = evalDim(e.r, env, describe);
      if (!dimsEmpty(x.dims)) {
        throw new DimError(`An exponent must be a pure number — ${describe(e.r)} carries ${dimsToUnit(x.dims)}.`);
      }
      return { v: Math.pow(b.v, x.v), dims: scale(b.dims, x.v) };
    }
    case "fn": {
      const a = evalDim(e.arg, env, describe);
      if (e.name === "sqrt") return { v: Math.sqrt(a.v), dims: scale(a.dims, 0.5) };
      if (e.name === "abs") return { v: Math.abs(a.v), dims: a.dims };
      // An ANGLE is trig's natural argument — the knowns were converted to
      // radians already, so sin(30 deg) works instead of refusing the single
      // most common trig input.
      if (["sin", "cos", "tan"].includes(e.name) && dimsEqual(a.dims, { angle: 1 })) {
        const f = { sin: Math.sin, cos: Math.cos, tan: Math.tan }[e.name as "sin" | "cos" | "tan"];
        return { v: f(a.v), dims: {} };
      }
      if (!dimsEmpty(a.dims)) {
        throw new DimError(
          `${e.name}(…) needs a pure number — its argument ${describe(e.arg)} carries ${dimsToUnit(a.dims)}. ` +
            `Divide by a reference quantity first if a ratio was meant.`,
        );
      }
      const fns: Record<string, (x: number) => number> = {
        sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp,
        ln: Math.log, log: Math.log10, asin: Math.asin, acos: Math.acos, atan: Math.atan,
      };
      const f = fns[e.name];
      if (!f) throw new DimError(`The function ${e.name} is not supported with units.`);
      return { v: f(a.v), dims: {} };
    }
  }
}

// Fraction alternative FIRST — with the integer branch first, "1/2 kg" matched
// as value 1 with unit "/2 kg", failed, and silently fell to the system path.
const ASSIGN_RE = /^([A-Za-z]\w*)\s*=\s*([+-]?(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;

/**
 * Units-aware solve. Returns null when the input is not shaped as
 * formula-plus-known-assignments with at least one real unit — plain
 * equations and systems keep their existing behavior.
 */
export function solveWithUnits(input: string): UnitSolveResult | null {
  const lines = input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const formula = lines[0];
  if (!formula.includes("=")) return null;

  // Every subsequent line must be `sym = number [unit]`; at least one must
  // carry a unit, or this is an ordinary system.
  const knowns: UnitKnown[] = [];
  let sawUnit = false;
  for (const line of lines.slice(1)) {
    const m = ASSIGN_RE.exec(line);
    if (!m) return null;
    const [, symbol, num, unitText] = m;
    let value: number;
    try {
      value = evalAst(parseExpr(num), {});
    } catch {
      return null;
    }
    if (!Number.isFinite(value)) return null;
    if (unitText.trim()) {
      const cu = parseCompoundUnit(unitText.trim());
      if (!cu) return null; // an unreadable unit word — not this path's input
      sawUnit = true;
      const si = value * cu.factor;
      knowns.push({
        symbol,
        shown: `${num} ${unitText.trim()}`,
        si,
        dims: { ...cu.dims },
        converted: cu.factor !== 1 ? `${num} ${unitText.trim()} → ${trim(si)} ${dimsToUnit(cu.dims) || ""}`.trim() : undefined,
      });
    } else {
      knowns.push({ symbol, shown: num, si: value, dims: {} });
    }
  }
  if (!sawUnit) return null;

  // Exactly one unknown.
  let fVars: string[];
  try {
    const sides = formula.split("=");
    if (sides.length !== 2) return null;
    fVars = freeVars(parseExpr(`(${sides[0]}) - (${sides[1]})`));
  } catch {
    return null;
  }
  const knownSet = new Set(knowns.map((k) => k.symbol));
  const unknowns = fVars.filter((v) => !knownSet.has(v));
  const extraKnowns = knowns.filter((k) => !fVars.includes(k.symbol));
  if (unknowns.length !== 1) {
    return {
      unknown: unknowns.join(", ") || "—",
      value: NaN,
      unit: "",
      namedUnit: null,
      knowns,
      steps: [],
      caveats: [],
      refusal:
        unknowns.length === 0
          ? "Every symbol already has a value — nothing is left to solve for."
          : `The formula still has ${unknowns.length} unknowns (${unknowns.join(", ")}) — give values for all but one.`,
    };
  }
  const unknown = unknowns[0];

  // Symbolic rearrangement by the same engine as plain Solve.
  const rearranged = solveEquation(formula, unknown);
  if (!rearranged || !rearranged.roots.length) {
    return {
      unknown,
      value: NaN,
      unit: "",
      namedUnit: null,
      knowns,
      steps: [],
      caveats: [],
      refusal: `Could not isolate ${unknown} in the formula symbolically.`,
    };
  }

  const steps: UnitSolveResult["steps"] = [];
  // Dedupe: the rearranger itself sometimes states a ≠ 0 condition twice.
  const caveats: string[] = [...new Set(rearranged.caveats)];

  const conversions = knowns.filter((k) => k.converted).map((k) => k.converted as string);
  if (conversions.length) {
    steps.push({ text: `Converted to SI first: ${conversions.join("; ")}.` });
  }

  // Evaluate EVERY branch dimensionally, then present the physically usual
  // one (first positive value) — solveEquation orders the −√ branch first,
  // and "v = −3 m/s" as THE speed is a bad first answer. The other branches
  // are DISCLOSED with their actual values, never a claim about their signs.
  const env: Record<string, Q> = {};
  for (const k of knowns) env[k.symbol] = { v: k.si, dims: k.dims };
  const describe = (x: Expr): string => format(x);
  const branches: Array<{ display: string; q: Q }> = [];
  let firstError: string | null = null;
  for (const root of rearranged.roots) {
    try {
      const q0 = evalDim(parseExpr(root.display), env, describe);
      if (Number.isFinite(q0.v)) branches.push({ display: root.display, q: q0 });
    } catch (error) {
      if (error instanceof DimError && !firstError) firstError = error.message;
    }
  }
  if (!branches.length) {
    return {
      unknown,
      value: NaN,
      unit: "",
      namedUnit: null,
      knowns,
      steps,
      caveats,
      refusal:
        firstError ?? "The value is not finite — check for a division by zero among the knowns.",
    };
  }
  const chosen = branches.find((b) => b.q.v > 0) ?? branches[0];
  const rootExpr = chosen.display;
  steps.push({ text: `Rearranged for ${unknown} (${rearranged.method}):` });
  steps.push({ math: `${unknown} = ${rootExpr}` });
  steps.push({
    text: `Substituting ${knowns.map((k) => `${k.symbol} = ${k.shown}`).join(", ")}:`,
  });
  const q: Q = chosen.q;
  const others = branches.filter((b) => b !== chosen);
  if (others.length) {
    caveats.push(
      `The formula has ${branches.length} solutions for ${unknown}; also possible: ${others
        .map((b) => `${unknown} = ${trim(b.q.v)}`)
        .join(", ")} (same unit).`,
    );
  }
  if (extraKnowns.length) {
    caveats.push(`Unused known${extraKnowns.length === 1 ? "" : "s"}: ${extraKnowns.map((k) => k.symbol).join(", ")} (not in the formula).`);
  }

  const unit = dimsToUnit(q.dims);
  const named = NAMED.find((n) => dimsEqual(n.dims, q.dims))?.name ?? null;
  steps.push({
    text: `${unknown} = ${trim(q.v)}${named ? ` ${named}` : unit ? ` ${unit}` : ""}${named && unit ? ` (= ${trim(q.v)} ${unit})` : ""}`,
  });

  return { unknown, value: q.v, unit, namedUnit: named, knowns, steps, caveats };
}

function trim(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return v.toPrecision(6).replace(/\.?0+($|e)/, "$1");
}
