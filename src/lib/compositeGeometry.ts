// Composite plane figures: a base shape with shapes removed from it (holes)
// or added to it, solved exactly with units carried through.
//
//   rectangle 10in x 5in minus triangle b=4in h=3in
//   circle r=6 minus square s=2 minus square s=2
//   rectangle 8 x 3 plus semicircle r=1.5
//
// Tolerant of sentence phrasing — `take a rectangle that is 10" x 5" with a
// triangle inside, base 4" height 3"` reads the same as the DSL — because the
// request arrives as prose at least as often as as keywords.
//
// The numbers depend only on the areas, NOT on where the inner shapes sit, so
// the result states that assumption instead of hiding it: removed shapes are
// taken to lie fully inside the base without overlapping each other. What can
// be checked is checked (a cutout wider or taller than the base's bounding box
// is called out; a removed area exceeding the base is refused as impossible).
//
// Exactness: every area is a rational + a rational multiple of π + rational
// multiples of square roots (Heron triangles), so `circle r=5 minus square s=2`
// reports exactly `25*pi - 4`, not 74.53981… Exact strings are written in the
// Solve grammar (`*pi`, `sqrt(...)`) so the displayed form re-parses — the
// display contract every Solve branch honours.

import {
  Rat,
  ratAdd,
  ratSub,
  ratMake,
  ratMul,
  ratDiv,
  ratInt,
  ratIsZero,
  ratSign,
  ratToNumber,
  parseRatLiteral,
  RAT_ZERO,
} from "./cas";
import { fmtRat, fmtSqrtRat, GeoValue } from "./geometry";

/** rat + pi·π + Σ coef·√radicand — closed under the sums this module needs. */
export interface ExactQty {
  rat: Rat;
  pi: Rat;
  roots: Array<{ coef: Rat; radicand: Rat }>;
}

const QTY_ZERO = (): ExactQty => ({ rat: RAT_ZERO, pi: RAT_ZERO, roots: [] });

function qtyAdd(a: ExactQty, b: ExactQty, sign: 1 | -1 = 1): ExactQty {
  const s = sign === 1 ? ratAdd : ratSub;
  const roots = a.roots.map((r) => ({ ...r }));
  for (const r of b.roots) {
    const signed = sign === 1 ? r.coef : ratMul(r.coef, ratInt(-1));
    const same = roots.find((x) => x.radicand.n === r.radicand.n && x.radicand.d === r.radicand.d);
    if (same) same.coef = ratAdd(same.coef, signed);
    else roots.push({ coef: signed, radicand: r.radicand });
  }
  return { rat: s(a.rat, b.rat), pi: s(a.pi, b.pi), roots: roots.filter((r) => !ratIsZero(r.coef)) };
}

export function qtyToNumber(q: ExactQty): number {
  return (
    ratToNumber(q.rat) +
    Math.PI * ratToNumber(q.pi) +
    q.roots.reduce((acc, r) => acc + ratToNumber(r.coef) * Math.sqrt(ratToNumber(r.radicand)), 0)
  );
}

/** Exact string in Solve grammar: "44", "25*pi - 4", "50 - sqrt(131.25)"… */
export function qtyExact(q: ExactQty): string {
  // Roots whose radicand is a perfect square resolve to rationals — fold them
  // into the rational part FIRST, so a 3-4-5 triangle removed from a 10 × 5
  // rectangle prints 44, never "50 - 6".
  let rat = q.rat;
  const roots: ExactQty["roots"] = [];
  for (const r of q.roots) {
    const rad = fmtSqrtRat(r.radicand);
    if (rad && !rad.includes("sqrt")) {
      const folded = parseRatLiteral(rad);
      if (folded) {
        rat = ratAdd(rat, ratMul(r.coef, folded));
        continue;
      }
    }
    roots.push(r);
  }
  const parts: string[] = [];
  if (!ratIsZero(rat)) parts.push(fmtRat(rat));
  if (!ratIsZero(q.pi)) {
    const c = fmtRat(q.pi);
    parts.push(c === "1" ? "pi" : c === "-1" ? "-pi" : `${c}*pi`);
  }
  for (const r of roots) {
    const root = fmtSqrtRat(r.radicand) ?? `sqrt(${fmtRat(r.radicand)})`;
    const c = fmtRat(r.coef);
    parts.push(c === "1" ? root : c === "-1" ? `-${root}` : `${c}*${root}`);
  }
  if (!parts.length) return "0";
  return parts.reduce((acc, p) => (acc ? (p.startsWith("-") ? `${acc} - ${p.slice(1)}` : `${acc} + ${p}`) : p));
}

export type CompositeOp = "base" | "minus" | "plus";

export interface CompositeShape {
  kind: "rectangle" | "square" | "circle" | "semicircle" | "triangle" | "trapezoid";
  op: CompositeOp;
  /** Human label, e.g. "rectangle 10 × 5 in". */
  label: string;
  /** Dimensions in the problem's common unit (numeric, for drawing). */
  dims: Record<string, number>;
  area: ExactQty;
  /** Outer boundary length; null when it has no exact closed form kept here. */
  perimeter: ExactQty | null;
  /** Bounding box (w × h) in the common unit, for fit checks and drawing. */
  bbox: { w: number; h: number };
}

export interface CompositeResult {
  title: string;
  /** The common length unit every dimension was converted to (null = unitless). */
  unit: string | null;
  shapes: CompositeShape[];
  /** Base area alone — the "with the cutouts still counted" number. */
  baseArea: ExactQty;
  removedArea: ExactQty;
  addedArea: ExactQty;
  /** base − removed + added. */
  netArea: ExactQty;
  values: GeoValue[];
  steps: string[];
  caveats: string[];
  /** Set when the input names shapes but a needed dimension is missing. */
  incomplete?: string;
}

// ---------------------------------------------------------------------------
// Units. Exact factors to metres keep mixed-unit inputs exact (1 in = 127/5000 m).

const UNIT_TO_M: Record<string, Rat> = {
  mm: ratMake(1n, 1000n),
  cm: ratMake(1n, 100n),
  m: ratMake(1n, 1n),
  in: ratMake(127n, 5000n),
  ft: ratMake(1524n, 5000n),
  yd: ratMake(4572n, 5000n),
};

const UNIT_ALIASES: Record<string, string> = {
  '"': "in",
  "”": "in",
  "″": "in",
  inch: "in",
  inches: "in",
  "'": "ft",
  "’": "ft",
  "′": "ft",
  foot: "ft",
  feet: "ft",
  yard: "yd",
  yards: "yd",
  millimeter: "mm",
  millimeters: "mm",
  millimetre: "mm",
  millimetres: "mm",
  centimeter: "cm",
  centimeters: "cm",
  centimetre: "cm",
  centimetres: "cm",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
};

interface Dim {
  value: Rat;
  unit: string | null;
}

/** `10`, `2.5`, `1/2`, `10in`, `10 in`, `10"` → exact value + unit. */
function parseDim(raw: string): Dim | null {
  const m = /^\s*([+-]?(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+))\s*([a-z"”″'’′]+)?\s*$/i.exec(raw);
  if (!m) return null;
  const value = parseRatLiteral(m[1].replace(/\s+/g, ""));
  if (!value || ratSign(value) <= 0) return null;
  let unit: string | null = null;
  if (m[2]) {
    const u = m[2].toLowerCase();
    unit = UNIT_TO_M[u] ? u : (UNIT_ALIASES[u] ?? null);
    if (!unit) return null; // an unknown unit word is not silently a number
  }
  return { value, unit };
}

/** Converts `d` to `unit` exactly (both must be known units). */
function convertDim(d: Dim, unit: string): Rat {
  if (!d.unit || d.unit === unit) return d.value;
  return ratDiv(ratMul(d.value, UNIT_TO_M[d.unit]), UNIT_TO_M[unit]);
}

// ---------------------------------------------------------------------------
// Clause parsing.

interface Clause {
  op: CompositeOp;
  text: string;
}

/**
 * Splits the input into a base clause and minus/plus clauses. Connectives:
 * remove → `minus`, `less`, `without`, `subtract`, `remove`, `cut out`,
 * `hole`, `with … inside` (the prose form — a shape drawn inside a base is a
 * candidate cutout, and BOTH numbers are reported); add → `plus`, `add`,
 * `attach`, `added`, `with … attached/on top/added`.
 */
function splitClauses(input: string): Clause[] | null {
  // Coordinate point lists and angle-named triangles (A=30) belong to
  // solveGeometry's grammar — this parser would misread the vertices as side
  // lengths and the lowercased A as the side a. Not ours; decline outright.
  if (/\(\s*[+-]?[\d.]+\s*,\s*[+-]?[\d.]+\s*\)/.test(input)) return null;
  if (/\b[ABC]\s*=\s*[\d.]/.test(input)) return null;

  let s = input
    .toLowerCase()
    .replace(/[×✕]/g, " x ")
    .replace(/(\d)\s*x\s*(?=[\d.])/g, "$1 x ") // 10x5 → 10 x 5
    .replace(/[−–—]/g, "-");

  // Directive phrasing carries no dimensions. A LEADING directive is just
  // stripped ("find the area of a rectangle …"); a LATER one starts the
  // question tail and everything after it goes — otherwise "find the area
  // without the triangle and with the triangle" would mint two extra
  // dimension-less triangle clauses out of the question itself.
  s = s.replace(/^\s*(?:please\s+)?(?:find|calculate|compute|determine|give(?:\s+me)?|what(?:'s|\s+is)?)\b\s*/, "");
  const qi = s.search(/\b(?:find|calculate|compute|determine|what(?:'s|\s+is)?|how\s+(?:much|big|many))\b/);
  if (qi >= 0) s = s.slice(0, qi);

  s = s
    // Sentence filler that would otherwise glue onto shape keywords. The
    // lookahead spares dimension names that merely LOOK like articles —
    // "trapezoid a=3" must keep its `a`.
    .replace(/\b(take|the|area|perimeter|of|a|an|that|which|is|are|it|its|and|then|please)\b(?!\s*=)/g, " ")
    // Sentence punctuation goes — but a period FOLLOWED BY A DIGIT is a
    // decimal point, and stripping it would silently turn 10.5 into 10 5
    // (which the pair regex then reads as a 5-wide rectangle).
    .replace(/[?!,;]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  // Normalise connective phrases to single tokens before splitting.
  s = s
    // "with X attached / added / on top" is an ADDITION even though it starts
    // with "with" — rewrite the whole phrase first, or the generic
    // with→minus below turns the advertised prose into a sign error.
    .replace(/\bwith\b([^]*?)\b(?:attach(?:ing|ed)?|add(?:ing|ed)?|on top)\b/g, " plus $1 ")
    .replace(/\bcut\s*(?:-\s*)?outs?\b/g, " minus ")
    .replace(/\bwith\s+holes?\b/g, " minus ")
    .replace(/\bholes?\b/g, " minus ")
    .replace(/\bwithout\b/g, " minus ")
    .replace(/\bsubtract(?:ing|ed)?\b/g, " minus ")
    .replace(/\bremov(?:e|ing|ed)\b/g, " minus ")
    .replace(/\bless\b/g, " minus ")
    .replace(/\battach(?:ing|ed)?\b/g, " plus ")
    .replace(/\badd(?:ing|ed)?\b/g, " plus ")
    // "with a triangle inside" — the inner shape is the removal candidate.
    .replace(/\bwith\b/g, " minus ")
    .replace(/\binside\b/g, " ")
    .replace(/\bon top\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = s.split(/\b(minus|plus)\b/);
  const clauses: Clause[] = [{ op: "base", text: parts[0].trim() }];
  for (let i = 1; i < parts.length; i += 2) {
    const text = (parts[i + 1] ?? "").trim();
    if (!text) continue;
    // "square with side 4" splits into a clause that names no shape — that is
    // a CONTINUATION of the previous shape's dimensions, not a new shape.
    if (!SHAPE_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(text))) {
      clauses[clauses.length - 1].text += ` ${text}`;
      continue;
    }
    clauses.push({ op: parts[i] === "minus" ? "minus" : "plus", text });
  }
  if (!clauses[0].text) return null;
  return clauses;
}

// ---------------------------------------------------------------------------
// Shape parsing. Each parser returns dims as EXACT Dims; area/perimeter are
// computed exactly afterwards.

const SHAPE_WORDS = ["rectangle", "square", "circle", "semicircle", "semi-circle", "triangle", "trapezoid", "trapezium"];

// The fraction alternative comes FIRST: alternation is ordered, so with the
// integer branch first `1/2` matches as `1` and leaves `/2` behind.
const DIM_TOKEN = String.raw`[+-]?(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)\s*(?:[a-z"”″'’′]+)?`;

/** Named dims: `b=4in`, `base 4"`, `height 3`, `r = 2 cm`, `side 4`. */
function namedDims(text: string): Record<string, Dim> {
  const out: Record<string, Dim> = {};
  const NAME: Record<string, string> = {
    w: "w",
    width: "w",
    l: "w",
    length: "w",
    h: "h",
    height: "h",
    b: "b",
    base: "b",
    r: "r",
    radius: "r",
    d: "d",
    diameter: "d",
    s: "s",
    side: "s",
    a: "a",
    c: "c",
  };
  const re = new RegExp(String.raw`\b([a-z]+)\s*[= ]\s*(${DIM_TOKEN})(?=\s|$)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = NAME[m[1].toLowerCase()];
    if (!key) continue;
    const dim = parseDim(m[2]);
    if (dim) out[key] = dim;
  }
  return out;
}

/** Bare dims in order, excluding ones already consumed by name=value pairs. */
function bareDims(text: string): Dim[] {
  const cleaned = text.replace(new RegExp(String.raw`\b[a-z]+\s*=\s*${DIM_TOKEN}`, "gi"), " ");
  const out: Dim[] = [];
  const re = new RegExp(String.raw`(?<![a-z0-9])(${DIM_TOKEN})(?=\s|$|x\b)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const dim = parseDim(m[1]);
    if (dim) out.push(dim);
  }
  return out;
}

interface ParsedShape {
  kind: CompositeShape["kind"];
  dims: Record<string, Dim>;
  /** Which dimensions were found as an ordered `10 x 5` pair. */
  pair?: [Dim, Dim];
  sides?: Dim[];
}

function parseShapeClause(text: string): ParsedShape | { missing: string } | null {
  const word = SHAPE_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(text));
  if (!word) return null;
  const kind: CompositeShape["kind"] =
    word === "semi-circle" ? "semicircle" : word === "trapezium" ? "trapezoid" : (word as CompositeShape["kind"]);

  const named = namedDims(text);
  const bare = bareDims(text);

  if (kind === "rectangle") {
    // `10 x 5` pair, or w/h named, or two bare numbers.
    const pairMatch = new RegExp(String.raw`(${DIM_TOKEN})\s*(?:x|by)\s*(${DIM_TOKEN})`, "i").exec(text);
    if (pairMatch) {
      const a = parseDim(pairMatch[1]);
      const b = parseDim(pairMatch[2]);
      if (a && b) return { kind, dims: { w: a, h: b }, pair: [a, b] };
    }
    if (named.w && named.h) return { kind, dims: { w: named.w, h: named.h } };
    if (bare.length >= 2) return { kind, dims: { w: bare[0], h: bare[1] } };
    return { missing: "a rectangle needs two dimensions — `10 x 5`, or w=10 h=5" };
  }

  if (kind === "square") {
    const s = named.s ?? named.w ?? bare[0];
    if (s) return { kind, dims: { s } };
    return { missing: "a square needs its side — `square s=4` (or `square 4`)" };
  }

  if (kind === "circle" || kind === "semicircle") {
    if (named.r) return { kind, dims: { r: named.r } };
    if (named.d) return { kind, dims: { r: { value: ratDiv(named.d.value, ratInt(2)), unit: named.d.unit } } };
    if (bare.length === 1) return { kind, dims: { r: bare[0] } };
    return { missing: `a ${kind} needs its radius or diameter — \`r=3\` or \`d=6\`` };
  }

  if (kind === "triangle") {
    if (named.b && named.h) return { kind, dims: { b: named.b, h: named.h } };
    if (bare.length >= 3) return { kind, dims: {}, sides: bare.slice(0, 3) };
    if (bare.length === 2) return { kind, dims: { b: bare[0], h: bare[1] } };
    return {
      missing: "the triangle needs dimensions — base and height (`b=4 h=3`) or three sides (`triangle 3 4 5`)",
    };
  }

  // trapezoid: parallel sides a, b and height h.
  if (named.a && named.b && named.h) return { kind, dims: { a: named.a, b: named.b, h: named.h } };
  if (bare.length >= 3) return { kind, dims: { a: bare[0], b: bare[1], h: bare[2] } };
  return { missing: "a trapezoid needs its parallel sides and height — `a=3 b=5 h=2`" };
}

// ---------------------------------------------------------------------------
// Exact metrics per shape.

const HALF: Rat = { n: 1n, d: 2n } as Rat;

function buildShape(p: ParsedShape, op: CompositeOp, unit: string | null): CompositeShape | { error: string } {
  const cv = (d: Dim): Rat => (unit ? convertDim(d, unit) : d.value);
  const num = (r: Rat): number => ratToNumber(r);
  const rq = (rat: Rat): ExactQty => ({ rat, pi: RAT_ZERO, roots: [] });
  const piq = (pi: Rat): ExactQty => ({ rat: RAT_ZERO, pi, roots: [] });
  const u = unit ? ` ${unit}` : "";

  if (p.kind === "rectangle") {
    const w = cv(p.dims.w);
    const h = cv(p.dims.h);
    return {
      kind: p.kind,
      op,
      label: `rectangle ${fmtRat(w)} × ${fmtRat(h)}${u}`,
      dims: { w: num(w), h: num(h) },
      area: rq(ratMul(w, h)),
      perimeter: rq(ratMul(ratInt(2), ratAdd(w, h))),
      bbox: { w: num(w), h: num(h) },
    };
  }
  if (p.kind === "square") {
    const s = cv(p.dims.s);
    return {
      kind: p.kind,
      op,
      label: `square ${fmtRat(s)}${u}`,
      dims: { s: num(s) },
      area: rq(ratMul(s, s)),
      perimeter: rq(ratMul(ratInt(4), s)),
      bbox: { w: num(s), h: num(s) },
    };
  }
  if (p.kind === "circle" || p.kind === "semicircle") {
    const r = cv(p.dims.r);
    const r2 = ratMul(r, r);
    const half = p.kind === "semicircle";
    return {
      kind: p.kind,
      op,
      label: `${p.kind} r = ${fmtRat(r)}${u}`,
      dims: { r: num(r) },
      area: piq(half ? ratMul(r2, HALF) : r2),
      // Semicircle boundary = arc + diameter: πr + 2r.
      perimeter: half
        ? { rat: ratMul(ratInt(2), r), pi: r, roots: [] }
        : piq(ratMul(ratInt(2), r)),
      bbox: { w: num(r) * 2, h: half ? num(r) : num(r) * 2 },
    };
  }
  if (p.kind === "triangle") {
    if (p.sides) {
      const [a, b, c] = p.sides.map(cv);
      const [an, bn, cn] = [a, b, c].map(num);
      const [s1, s2, s3] = [an, bn, cn].sort((x, y) => x - y);
      if (s1 + s2 <= s3) {
        return { error: `sides ${s1}, ${s2}, ${s3} violate the triangle inequality — no such triangle exists` };
      }
      // Heron, exactly: A = √(s(s−a)(s−b)(s−c)) with s rational.
      const s = ratMul(HALF, ratAdd(ratAdd(a, b), c));
      const radicand = ratMul(ratMul(s, ratSub(s, a)), ratMul(ratSub(s, b), ratSub(s, c)));
      const base = Math.max(an, bn, cn);
      const height = (2 * Math.sqrt(ratToNumber(radicand))) / base;
      return {
        kind: p.kind,
        op,
        label: `triangle ${fmtRat(a)}, ${fmtRat(b)}, ${fmtRat(c)}${u}`,
        dims: { a: an, b: bn, c: cn },
        area: { rat: RAT_ZERO, pi: RAT_ZERO, roots: [{ coef: ratInt(1), radicand }] },
        perimeter: rq(ratAdd(ratAdd(a, b), c)),
        bbox: { w: base, h: height },
      };
    }
    const b = cv(p.dims.b);
    const h = cv(p.dims.h);
    return {
      kind: p.kind,
      op,
      label: `triangle b = ${fmtRat(b)}, h = ${fmtRat(h)}${u}`,
      dims: { b: num(b), h: num(h) },
      area: rq(ratMul(HALF, ratMul(b, h))),
      // The base and height alone do not fix the slant sides.
      perimeter: null,
      bbox: { w: num(b), h: num(h) },
    };
  }
  // trapezoid
  const a = cv(p.dims.a);
  const b = cv(p.dims.b);
  const h = cv(p.dims.h);
  return {
    kind: p.kind,
    op,
    label: `trapezoid a = ${fmtRat(a)}, b = ${fmtRat(b)}, h = ${fmtRat(h)}${u}`,
    dims: { a: ratToNumber(a), b: ratToNumber(b), h: ratToNumber(h) },
    area: rq(ratMul(HALF, ratMul(ratAdd(a, b), h))),
    perimeter: null, // legs not determined by a, b, h
    bbox: { w: Math.max(ratToNumber(a), ratToNumber(b)), h: ratToNumber(h) },
  };
}

// ---------------------------------------------------------------------------

function fmtQty(q: ExactQty, unit: string | null, power: 1 | 2): string {
  const n = qtyToNumber(q);
  const rounded = Math.round(n * 1e6) / 1e6;
  const suffix = unit ? ` ${unit}${power === 2 ? "²" : ""}` : "";
  return `${rounded}${suffix}`;
}

/**
 * Parses and solves a composite-figure request. Returns null when the input
 * does not read as one (so plain solveGeometry gets its turn) — but a clause
 * that names a shape with missing dimensions returns an `incomplete` result,
 * because "say what is missing" beats a generic could-not-read error.
 */
export function solveComposite(input: string): CompositeResult | null {
  const clauses = splitClauses(input);
  if (!clauses || clauses.length < 2) return null; // one shape alone is solveGeometry's job

  // Every clause must name a shape for this to be a composite request.
  const parsed: Array<{ op: CompositeOp; shape: ParsedShape | { missing: string } }> = [];
  for (const c of clauses) {
    const shape = parseShapeClause(c.text);
    if (!shape) return null;
    parsed.push({ op: c.op, shape });
  }

  // The common unit is the first unit seen anywhere; everything converts to it.
  let unit: string | null = null;
  for (const p of parsed) {
    if ("missing" in p.shape) continue;
    for (const d of [...Object.values(p.shape.dims), ...(p.shape.sides ?? []), ...(p.shape.pair ?? [])]) {
      if (d.unit) {
        unit = d.unit;
        break;
      }
    }
    if (unit) break;
  }

  const missing = parsed.filter((p) => "missing" in p.shape);
  if (missing.length) {
    return {
      title: "Composite figure — dimensions needed",
      unit,
      shapes: [],
      baseArea: QTY_ZERO(),
      removedArea: QTY_ZERO(),
      addedArea: QTY_ZERO(),
      netArea: QTY_ZERO(),
      values: [],
      steps: [],
      caveats: [],
      incomplete: missing.map((p) => (p.shape as { missing: string }).missing).join("; "),
    };
  }

  const shapes: CompositeShape[] = [];
  for (const p of parsed) {
    const s = buildShape(p.shape as ParsedShape, p.op, unit);
    if ("error" in s) {
      return {
        title: "Composite figure",
        unit,
        shapes: [],
        baseArea: QTY_ZERO(),
        removedArea: QTY_ZERO(),
        addedArea: QTY_ZERO(),
        netArea: QTY_ZERO(),
        values: [],
        steps: [],
        caveats: [],
        incomplete: s.error,
      };
    }
    shapes.push(s);
  }

  const base = shapes[0];
  const removed = shapes.filter((s) => s.op === "minus");
  const added = shapes.filter((s) => s.op === "plus");

  const removedArea = removed.reduce((acc, s) => qtyAdd(acc, s.area), QTY_ZERO());
  const addedArea = added.reduce((acc, s) => qtyAdd(acc, s.area), QTY_ZERO());
  const netArea = qtyAdd(qtyAdd(base.area, removedArea, -1), addedArea);

  const values: GeoValue[] = [];
  const steps: string[] = [];
  const caveats: string[] = [];
  const u2 = unit ? `${unit}²` : undefined;
  const pushArea = (label: string, q: ExactQty): void => {
    values.push({ label, value: qtyToNumber(q), exact: qtyExact(q), unit: u2 });
  };

  pushArea(`${base.kind} area (cutouts still counted)`, base.area);
  steps.push(`Base: ${base.label} → area ${qtyExact(base.area)}${u2 ? ` ${u2}` : ""}.`);
  for (const s of removed) {
    pushArea(`− ${s.label}`, s.area);
    steps.push(`Removed: ${s.label} → area ${qtyExact(s.area)}${u2 ? ` ${u2}` : ""}.`);
  }
  for (const s of added) {
    pushArea(`+ ${s.label}`, s.area);
    steps.push(`Added: ${s.label} → area ${qtyExact(s.area)}${u2 ? ` ${u2}` : ""}.`);
  }
  if (removed.length || added.length) {
    pushArea(removed.length && !added.length ? "area without the cutouts" : "net area", netArea);
    const terms = [qtyExact(base.area), ...removed.map((s) => `(${qtyExact(s.area)})`)].join(" - ");
    const plus = added.length ? ` + ${added.map((s) => `(${qtyExact(s.area)})`).join(" + ")}` : "";
    steps.push(`Net = ${terms}${plus} = ${qtyExact(netArea)}${u2 ? ` ${u2}` : ""}.`);
  }
  if (base.perimeter) {
    values.push({
      label: `${base.kind} outer perimeter`,
      value: qtyToNumber(base.perimeter),
      exact: qtyExact(base.perimeter),
      unit: unit ?? undefined,
    });
  }

  // Honesty about what the numbers do and do not depend on.
  if (removed.length) {
    caveats.push(
      "The removed shapes are taken to lie fully inside the base without overlapping each other — the areas above do not depend on where they sit, but the figure drawn is one illustrative placement.",
    );
    // Check what CAN be checked: bounding-box fit and total area.
    for (const s of removed) {
      if (s.bbox.w > base.bbox.w + 1e-12 || s.bbox.h > base.bbox.h + 1e-12) {
        caveats.push(
          `${s.label} is larger than the base's ${fmtN(base.bbox.w)} × ${fmtN(base.bbox.h)}${unit ? ` ${unit}` : ""} extent in at least one direction — check that it actually fits inside.`,
        );
      }
    }
    if (qtyToNumber(netArea) < -1e-12) {
      return {
        title: compositeTitle(base, removed, added),
        unit,
        shapes,
        baseArea: base.area,
        removedArea,
        addedArea,
        netArea,
        values: [],
        steps: [],
        caveats: [],
        incomplete: `the removed area (${fmtQty(removedArea, unit, 2)}) exceeds the base area (${fmtQty(base.area, unit, 2)}) — those shapes cannot all fit inside.`,
      };
    }
  }
  if (added.length) {
    caveats.push(
      "Added shapes are taken to attach without overlapping the base or each other; the combined outline (and so the total perimeter) depends on how they attach, which the dimensions alone do not fix.",
    );
  }
  if (unit) {
    const mixed = parsed.some((p) => {
      const sh = p.shape as ParsedShape;
      return [...Object.values(sh.dims), ...(sh.sides ?? [])].some((d) => d.unit && d.unit !== unit);
    });
    if (mixed) steps.push(`Mixed units were converted exactly to ${unit} before computing.`);
  }

  return {
    title: compositeTitle(base, removed, added),
    unit,
    shapes,
    baseArea: base.area,
    removedArea,
    addedArea,
    netArea,
    values,
    steps,
    caveats,
  };
}

function fmtN(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

function compositeTitle(base: CompositeShape, removed: CompositeShape[], added: CompositeShape[]): string {
  const bits = [base.label];
  if (removed.length) bits.push(`minus ${removed.map((s) => s.kind).join(", ")}`);
  if (added.length) bits.push(`plus ${added.map((s) => s.kind).join(", ")}`);
  return `Composite figure: ${bits.join(" ")}`;
}
