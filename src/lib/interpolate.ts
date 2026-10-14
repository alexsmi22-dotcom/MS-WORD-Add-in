/**
 * Polynomial interpolation — the `interpolate` verbs of the equation kind.
 *
 * Everything is EXACT over the rationals of cas.ts. The interpolant is built
 * THREE independent ways — the Vandermonde system by systems.rref, the Lagrange
 * basis products by ratPolyMul, and Newton's divided differences — and the three
 * coefficient arrays are compared as Rat; a disagreement is a refusal, never a
 * displayed answer. p(x_i) = y_i is then checked for every point. Neville's
 * tableau at a query point must equal p(v) exactly.
 *
 * What is NOT an interpolant is refused by name: `least squares`, `regression`,
 * `best fit` and `fit` without `through` are FITS (least squares, need not pass
 * through any point) and are pointed at Sketch data → function / Stats
 * regression. `fit a polynomial through …` interpolates and says so.
 *
 * Limits, by name: ≤ 12 points (Runge — an interpolant through 13 equally
 * spaced points oscillates; a spline is the tool); a node whose f-value is not
 * a rational number (pointList refuses); x repeated with two y's.
 *
 * Every math line is Solve grammar (`p(x) = 1/3*x^2 + 5/3` — the right-hand
 * side re-parses); labels live in the text layer.
 */
import {
  Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratEq, ratSign, ratToNumber, ratInt, substituteVar, ratPolyToExpr,
  RAT_ZERO, RAT_ONE, ratPolyMul, ratPolyAdd, ratPolyScale, ratPolyTrim, ratPolyEval, ratPolyRoots, parseRatLiteral,
} from "./cas";
import { fmtRat, fmtSqrtRat, sqrtRatToNumber } from "./geometry";
import { rref } from "./systems";
import { parseExpr, format, derivative, evalAst, freeVars, Expr } from "./solve";
import { exactSimplify, constantRat } from "./exact";
import { buildPlotSvg, Series } from "./plot";
import { polyString } from "./algebraTools";
import type { VerbResult } from "./algebraTools";
import { readPointList, isPointRefusal, asciiMath, NUM_RE_SRC, PointList, ratToExprExact } from "./pointList";
import { SPLINE_VERB_RE } from "./spline";

export type { VerbResult };

/** Claims a line for the interpolation verbs (the pane's prose switches and the solver stand aside). */
export const INTERP_VERB_RE =
  /^(?!\s*(?:interpolat\w*|lagrange|newton|neville|splines?|pchip)\s*=)(?![\s\S]*\bthrough\b[\s\S]*\b(?:slope|gradient|parallel|perpendicular)\b)(?:\s*(?:lagrange(?!\s+multipliers?\b)(?![\s\S]*\b(?:subject\s+to\b|s\.t\.|such\s+that\b|constraint\b))|newton(?:'s)?\s+(?:divided|forward|interpolat)|neville(?:'s)?|divided[-\s]differences?|(?:linear(?:ly)?\s+)?interpolat(?:e|ing|ion)|(?:find\s+)?(?:the\s+)?(?:polynomial|quadratic|cubic|parabola|line)(?:\s+of\s+degree\s+\d+)?\s+through|degree\s+\d+\s+polynomial\s+through|error\s+bound|estimate\s+f\()|[\s\S]*?\binterpolat(?:e|ing|ion)\b|[\s\S]*?\bneville(?:'s)?\s+method\b|\s*fit\b(?=[\s\S]*\bthrough\b))/i;

/** `interpolate = 3`: a variable named after the verb, inside an equation — not this verb's line. */
export const VERB_AS_VARIABLE_RE = /^\s*(?:interpolat\w*|lagrange|newton|neville|splines?|pchip)\s*=/i;
/** `line through (1,2) with slope 3` / `parallel to y = 2x`: the equation kind's line geometry, not an interpolant. */
const LINE_GEOMETRY_RE = /\bthrough\b[\s\S]*\b(?:slope|gradient|parallel|perpendicular)\b/i;

/** The most points the exact Vandermonde/Lagrange/Newton triple will take. */
export const MAX_INTERP_POINTS = 12;

const NUM = NUM_RE_SRC;
const sig6 = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x));
const refuse = (title: string, why: string, extra: string[] = []): VerbResult => ({ title, lines: [], caveats: [why, ...extra] });
const line = (text: string, math = false): { text: string; math?: boolean } => (math ? { text, math: true } : { text });
const ratAbs = (a: Rat): Rat => (ratSign(a) < 0 ? ratNeg(a) : a);
const ratLt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) < 0;
const ratGt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) > 0;
/** "x - 2", "x + 1", "x" — one factor of the node polynomial. */
const factor = (xj: Rat, v = "x"): string => (ratIsZero(xj) ? v : ratSign(xj) > 0 ? `(${v} - ${fmtRat(xj)})` : `(${v} + ${fmtRat(ratNeg(xj))})`);
/** "a - b" with a typed b: "3 - 1", "3 + 1" for b = -1. */
const diffText = (a: string, b: Rat): string => (ratSign(b) < 0 ? `${a} + ${fmtRat(ratNeg(b))}` : `${a} - ${fmtRat(b)}`);
const withApprox = (r: Rat): string => (r.d === 1n ? fmtRat(r) : `${fmtRat(r)} ≈ ${sig6(ratToNumber(r))}`);
const polyToNumber = (coeffs: Rat[]): number[] => coeffs.map(ratToNumber);
const evalNum = (c: number[], x: number): number => {
  let acc = 0;
  for (let i = c.length - 1; i >= 0; i--) acc = acc * x + c[i];
  return acc;
};
function factorial(n: number): Rat {
  let f = 1n;
  for (let i = 2n; i <= BigInt(n); i++) f *= i;
  return ratInt(f);
}

// ---------------------------------------------------------------------------
// The engine: three constructions, compared exactly.
// ---------------------------------------------------------------------------

export interface Interpolant {
  /** Ascending coefficients, trimmed. */
  coeffs: Rat[];
  /** Newton's divided-difference coefficients c_k (the table's top diagonal). */
  newton: Rat[];
  /** The divided-difference table: table[k] = the k-th order differences. */
  table: Rat[][];
  /** The Lagrange basis polynomials, ascending coefficients. */
  basis: Rat[][];
}

/** Vandermonde (rref) ∧ Lagrange ∧ Newton. Null when any two disagree. */
export function interpolatingPolynomial(xs: Rat[], ys: Rat[]): Interpolant | null {
  const n = xs.length;
  if (n === 0 || n !== ys.length) return null;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (ratEq(xs[i], xs[j])) return null;
  // 1. Vandermonde.
  const rows: Rat[][] = xs.map((x, i) => {
    const r: Rat[] = [];
    let p = RAT_ONE;
    for (let k = 0; k < n; k++) { r.push(p); p = ratMul(p, x); }
    r.push(ys[i]);
    return r;
  });
  const { rows: R, pivots } = rref(rows);
  if (pivots.length !== n || pivots.some((p, i) => p !== i)) return null;
  const vand = ratPolyTrim(R.map((r) => r[n]));
  // 2. Lagrange basis products.
  const basis: Rat[][] = [];
  let lag: Rat[] = [];
  for (let i = 0; i < n; i++) {
    let b: Rat[] = [RAT_ONE];
    let den = RAT_ONE;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      b = ratPolyMul(b, [ratNeg(xs[j]), RAT_ONE]);
      den = ratMul(den, ratSub(xs[i], xs[j]));
    }
    b = b.map((c) => ratDiv(c, den));
    basis.push(b);
    lag = ratPolyAdd(lag, ratPolyScale(b, ys[i]));
  }
  // 3. Newton divided differences.
  const table: Rat[][] = [ys.slice()];
  for (let k = 1; k < n; k++) {
    const prev = table[k - 1];
    const cur: Rat[] = [];
    for (let i = 0; i + k < n; i++) cur.push(ratDiv(ratSub(prev[i + 1], prev[i]), ratSub(xs[i + k], xs[i])));
    table.push(cur);
  }
  const newton = table.map((t) => t[0]);
  let newt: Rat[] = [];
  let prod: Rat[] = [RAT_ONE];
  for (let k = 0; k < n; k++) {
    newt = ratPolyAdd(newt, ratPolyScale(prod, newton[k]));
    prod = ratPolyMul(prod, [ratNeg(xs[k]), RAT_ONE]);
  }
  const same = (a: Rat[], b: Rat[]): boolean => {
    const L = Math.max(a.length, b.length);
    for (let i = 0; i < L; i++) if (!ratEq(a[i] ?? RAT_ZERO, b[i] ?? RAT_ZERO)) return false;
    return true;
  };
  if (!same(vand, lag) || !same(vand, newt)) return null;
  for (let i = 0; i < n; i++) if (!ratEq(ratPolyEval(vand, xs[i]), ys[i])) return null;
  return { coeffs: vand, newton, table, basis };
}

/** Neville's tableau at v: Q[i][j] from nodes i−j … i. */
export function nevilleTableau(xs: Rat[], ys: Rat[], v: Rat): Rat[][] {
  const n = xs.length;
  const Q: Rat[][] = xs.map((_, i) => [ys[i]]);
  for (let j = 1; j < n; j++) {
    for (let i = j; i < n; i++) {
      const a = ratMul(ratSub(v, xs[i - j]), Q[i][j - 1]);
      const b = ratMul(ratSub(v, xs[i]), Q[i - 1][j - 1]);
      Q[i].push(ratDiv(ratSub(a, b), ratSub(xs[i], xs[i - j])));
    }
  }
  return Q;
}

/** Newton form `2 + 1*(x - 1) + 1/3*(x - 1)*(x - 2)` — coefficients always written, zero terms dropped. */
export function newtonFormString(newton: Rat[], xs: Rat[], v = "x"): string {
  const parts: string[] = [];
  for (let k = 0; k < newton.length; k++) {
    const c = newton[k];
    if (ratIsZero(c)) continue;
    const mag = fmtRat(ratAbs(c));
    const factors = xs.slice(0, k).map((xj) => factor(xj, v)).join("*");
    // The unit coefficient is dropped (`2 + (x - 1) + 1/3*(x - 1)*(x - 2)`), the same
    // convention polyString uses everywhere else in the product.
    const body = k === 0 ? mag : mag === "1" ? factors : `${mag}*${factors}`;
    const neg = ratSign(c) < 0;
    parts.push(parts.length === 0 ? (neg ? `-${body}` : body) : `${neg ? "- " : "+ "}${body}`);
  }
  return parts.length ? parts.join(" ") : "0";
}

/** Lagrange basis L_i(x) as a product over a denominator: `(x - 2)*(x - 4)/3`. */
export function lagrangeBasisString(xs: Rat[], i: number, v = "x"): string {
  const factors = xs.filter((_, j) => j !== i).map((xj) => factor(xj, v)).join("*");
  let den = RAT_ONE;
  xs.forEach((xj, j) => { if (j !== i) den = ratMul(den, ratSub(xs[i], xj)); });
  if (ratEq(den, RAT_ONE)) return factors;
  if (ratEq(den, ratInt(-1))) return `-${factors}`;
  if (den.d === 1n && ratSign(den) > 0) return `${factors}/${fmtRat(den)}`;
  return `${factors}/(${fmtRat(den)})`;
}

// ---------------------------------------------------------------------------
// The figure: the curve on a padded window, the points, the query point.
// ---------------------------------------------------------------------------

/** buildPlotSvg's default plot width and title face: the title is centred on the
 *  plot frame, so a title wider than the frame runs off the LEFT edge of the canvas. */
export const PLOT_W = 380;
export const TITLE_FONT = 13;
export const TITLE_ADVANCE = 0.58;
/** Estimated pixel width of a title string in the plotter's bold 13 px face. */
export const titleWidth = (s: string): number => s.length * TITLE_FONT * TITLE_ADVANCE;
/**
 * The first candidate that fits the plot width, by the character-count estimate
 * the figure gate uses. The polynomial never goes into the title when it would
 * not fit — it lives in the result lines.
 */
export function fitTitle(candidates: string[], width = PLOT_W): string {
  for (const c of candidates) if (titleWidth(c) <= width - 4) return c;
  return candidates[candidates.length - 1];
}

/** A marked query point on the figure (numeric position, exact label). */
export interface Mark {
  x: number;
  y: number;
  label: string;
}

export function interpolantSvg(coeffs: Rat[], xs: Rat[], ys: Rat[], marks: Mark[] | { x: Rat; y: Rat } | null, titles: string | string[]): string {
  const title = fitTitle(Array.isArray(titles) ? titles : [titles]);
  const c = polyToNumber(coeffs);
  const X = xs.map(ratToNumber);
  const Y = ys.map(ratToNumber);
  const query: Mark[] = Array.isArray(marks) ? marks : marks ? [{ x: ratToNumber(marks.x), y: ratToNumber(marks.y), label: `p(${fmtRat(marks.x)}) = ${fmtRat(marks.y)}` }] : [];
  let lo = Math.min(...X, ...query.map((m) => m.x));
  let hi = Math.max(...X, ...query.map((m) => m.x));
  const pad = hi > lo ? 0.15 * (hi - lo) : 1;
  lo -= pad;
  hi += pad;
  const curve: { x: number; y: number }[] = [];
  for (let k = 0; k < 200; k++) {
    const x = lo + ((hi - lo) * k) / 199;
    curve.push({ x, y: evalNum(c, x) });
  }
  const series: Series[] = [
    { points: curve, type: "line", label: "p(x)", color: "#1f77b4" },
    { points: X.map((x, i) => ({ x, y: Y[i] })), type: "scatter", label: `${X.length} points`, color: "#d62728" },
  ];
  for (const m of query) series.push({ points: [{ x: m.x, y: m.y }], type: "scatter", label: m.label, color: "#2ca02c" });
  return buildPlotSvg(series, { title, xlabel: "x", ylabel: "p(x)" });
}

// ---------------------------------------------------------------------------
// The query clause: `at x = v`, `at v`, `evaluate at`, `find p(v)`, `estimate f(v)`, `S(v) = ?`.
// ---------------------------------------------------------------------------

/** One query point: an exact rational, or a constant expression (pi, sqrt(2), 2*pi, e^2). */
export interface Query {
  typed: string;
  v: Rat | null;
  expr: Expr | null;
  /** Its value as a double (for ordering, extrapolation and the figure). */
  num: number;
}
export interface QueryClause {
  rest: string;
  queries: Query[];
}

/** A symbolic query token: pi · e · sqrt(2) · 2*pi · pi/2 · e^2 · 3/2. */
const SYM = `(?:[A-Za-z_]\\w*(?:\\(\\s*[^()]*\\s*\\))?|${NUM})(?:\\s*[*/^]\\s*(?:[A-Za-z_]\\w*(?:\\(\\s*[^()]*\\s*\\))?|${NUM}))*`;

function readQueryToken(s: string): Query | null {
  const typed = s.trim();
  const v = parseRatLiteral(typed);
  if (v) return { typed, v, expr: null, num: ratToNumber(v) };
  try {
    const e = parseExpr(typed);
    if (freeVars(e).length) return null;
    const num = evalAst(e, { pi: Math.PI, e: Math.E });
    if (!Number.isFinite(num)) return null;
    return { typed, v: null, expr: e, num };
  } catch {
    return null;
  }
}

/**
 * Pulls EVERY query point out of the text — `at x = 1.5`, `at 1.5 and x = 2.5`,
 * `at x = pi`, `evaluate at`, `find p(v)`, `estimate f(v)`, `S(v) = ?` — never a
 * list (`at x = 1, 2, 4` is a node list). Nothing asked for is dropped silently:
 * each point found is returned, rational or symbolic.
 */
export function extractQueries(text: string): QueryClause {
  const t = asciiMath(text);
  const ranges: [number, number][] = [];
  const queries: Query[] = [];
  const add = (q: Query | null, a: number, b: number): boolean => {
    if (!q) return false;
    if (!queries.some((o) => o.typed === q.typed)) queries.push(q);
    ranges.push([a, b]);
    return true;
  };
  // A number followed by ", 2" is a NODE LIST (`f(x) = 1/x at x = 1, 2, 4`), never a query.
  const notList = `(?!\\s*,?\\s*[+-]?\\d)(?![\\d./])`;
  const first = new RegExp(`\\b(?:and\\s+)?(?:then\\s+)?(?:evaluate|evaluated|estimate|find|compute|value)?\\s*(?:it\\s+|the\\s+value\\s+)?(?:at|when)\\s+(?:(?:x\\s*=\\s*)?(${NUM})${notList}|x\\s*=\\s*(${SYM})${notList})`, "ig");
  const cont = new RegExp(`\\s*(?:,|;|\\band\\b)\\s*(?:(?:at|when)\\s+)?x\\s*=\\s*(?:(${NUM})${notList}|(${SYM})${notList})`, "iy");
  let m: RegExpExecArray | null;
  while ((m = first.exec(t))) {
    const q = readQueryToken(m[1] ?? m[2]);
    if (!add(q, m.index, m.index + m[0].length)) continue;
    let at = first.lastIndex;
    for (;;) {
      cont.lastIndex = at;
      const c = cont.exec(t);
      if (!c) break;
      if (!add(readQueryToken(c[1] ?? c[2]), c.index, c.index + c[0].length)) break;
      at = cont.lastIndex;
    }
    first.lastIndex = at;
  }
  const fn = new RegExp(`(?:\\b(?:find|evaluate|compute|estimate|what\\s+is)\\s+)?(?<![A-Za-z0-9_])[pfSsgy]\\s*\\(\\s*(${NUM}|${SYM})\\s*\\)(?!\\s*=\\s*[+-]?[\\d.])(?:\\s*=\\s*\\?)?\\s*\\??`, "ig");
  while ((m = fn.exec(t))) {
    if (/^[A-Za-z_]\w*$/.test(m[1].trim()) && !/^(?:pi|e)$/i.test(m[1].trim())) continue; // f(x), S(t): a definition, not a query
    add(readQueryToken(m[1]), m.index, m.index + m[0].length);
  }
  ranges.sort((a, b) => b[0] - a[0]);
  let rest = t;
  for (const [a, b] of ranges) rest = rest.slice(0, a) + " " + rest.slice(b);
  return { rest, queries };
}

/** Back-compatible single-query view (the first point, rational only). */
export function extractQuery(text: string): { rest: string; v: Rat | null; typed: string | null } {
  const c = extractQueries(text);
  const q = c.queries.find((x) => x.v);
  return { rest: c.rest, v: q ? q.v : null, typed: q ? q.typed : null };
}

/** How a symbolic query point may be built so the CAS gives an exact closed form. */
function exactlyEvaluable(e: Expr): boolean {
  switch (e.t) {
    case "num": return true;
    case "var": return e.name === "pi" || e.name === "e";
    case "neg": return exactlyEvaluable(e.e);
    case "fn": return e.name === "sqrt" && exactlyEvaluable(e.arg);
    default: return exactlyEvaluable(e.l) && exactlyEvaluable(e.r);
  }
}

export type QueryValue =
  | { ok: true; label: string; exact: string; num: number; rat: Rat | null }
  | { ok: false; label: string; why: string };

/**
 * p(v) for a query point: exact rational arithmetic for a rational v; for a
 * symbolic v the polynomial is evaluated through the CAS and kept symbolic
 * (p(pi) is a polynomial in pi). `shift` evaluates in (v − shift) (spline pieces).
 * Anything without an exact closed form is refused BY NAME, never dropped.
 */
export function evalPolyQuery(coeffs: Rat[], q: Query, shift: Rat | null = null): QueryValue {
  if (q.v) {
    const at = shift ? ratSub(q.v, shift) : q.v;
    const r = ratPolyEval(coeffs, at);
    return { ok: true, label: fmtRat(q.v), exact: fmtRat(r), num: ratToNumber(r), rat: r };
  }
  const label = format(q.expr!);
  if (!exactlyEvaluable(q.expr!)) {
    return { ok: false, label, why: `The query point ${label} is not a rational number and has no exact closed form here — give it as a decimal or fraction (read exactly as typed), or as pi, e or sqrt(n), which are kept symbolic.` };
  }
  const arg: Expr = shift ? { t: "sub", l: q.expr!, r: ratToExprExact(shift) } : q.expr!;
  let s: Expr;
  try {
    s = exactSimplify(substituteVar(ratPolyToExpr(coeffs, "x"), "x", arg));
  } catch (err) {
    return { ok: false, label, why: `Could not evaluate at ${label} exactly: ${(err as Error).message}` };
  }
  return { ok: true, label, exact: format(s), num: evalAst(s, { pi: Math.PI, e: Math.E }), rat: null };
}

// ---------------------------------------------------------------------------
// The verb.
// ---------------------------------------------------------------------------

const FIT_RE = /\b(?:least[-\s]squares|regression|best[-\s]fit)\b/i;
const FIT_POINTER = "A FIT is least squares and need not pass through any point — Sketch data → function on the canvas, or Stats mode regression. An INTERPOLANT passes through every point: write `interpolate …` or `polynomial through …`.";

const DEGREE_WORDS: Record<string, number> = { line: 1, linear: 1, straight: 1, quadratic: 2, parabola: 2, cubic: 3, quartic: 4, quintic: 5 };

function requestedDegree(t: string): number | null {
  const d = /\bdegree[-\s]+(\d+)\b/i.exec(t) ?? /\b(\d+)(?:st|nd|rd|th)[-\s]+(?:degree|order)\b/i.exec(t);
  if (d) return parseInt(d[1], 10);
  const w = /\b(?:with\s+|using\s+|by\s+)?(?:a|an|the)\s+(line|linear|straight|quadratic|parabola|cubic|quartic|quintic)\b/i.exec(t) ?? /^\s*(?:find\s+)?(?:the\s+)?(quadratic|cubic|parabola|line|quartic|quintic)\s+through\b/i.exec(t);
  if (w) return DEGREE_WORDS[w[1].toLowerCase()] ?? null;
  return null;
}

/**
 * Polynomial interpolation verbs. Null when the line is not one (the chain
 * moves on); a NAMED refusal when it is one that cannot be answered.
 */
export function tryInterpolate(input: string): VerbResult | null {
  const text = asciiMath(input).trim();
  if (!text) return null;
  // Splines own their lines (tryInterpolate runs before trySpline in the chain).
  if (SPLINE_VERB_RE.test(text)) return null;
  // "lagrange x y subject to x^2 + y^2 = 1" is Lagrange MULTIPLIERS (multivar.ts),
  // not Lagrange interpolation — the bare prefix stole it (caught by the
  // palette test on first wiring). A constraint word means multipliers.
  if (/^\s*lagrange\b/i.test(text) && /\b(?:multipliers?\b|subject\s+to\b|s\.t\.|such\s+that\b|constraint\b)/i.test(text)) return null;
  const hasThrough = /\bthrough\b/i.test(text);
  const fitWord = /\bfit(?:s|ted|ting)?\b/i.test(text);
  if (FIT_RE.test(text) || (fitWord && !hasThrough)) {
    if (readPointList(text) || hasThrough || INTERP_VERB_RE.test(text)) return refuse(`${/^[^\n]{0,60}/.exec(text)![0].trim()}`, FIT_POINTER);
    return null;
  }
  // `interpolate = 3` is an equation in a variable called interpolate; `line
  // through (1,2) with slope 3` is the equation kind's line geometry.
  if (VERB_AS_VARIABLE_RE.test(text) || LINE_GEOMETRY_RE.test(text)) return null;
  if (!INTERP_VERB_RE.test(text)) return null;
  const title0 = text.length > 72 ? text.slice(0, 69).trimEnd() + "…" : text;

  if (/\berror\s+bound\b/i.test(text)) return errorBound(text, title0);

  const q = extractQueries(text);
  const method = (/\b(?:using|by|via|with)\s+(?:the\s+)?(lagrange|newton|neville)/i.exec(text)?.[1] ?? /^\s*(lagrange|newton|neville)/i.exec(text)?.[1] ?? (/\bdivided[-\s]differences?\b|\bforward[-\s]differences?\b/i.test(text) ? "newton" : /\bneville/i.test(text) ? "neville" : null))?.toLowerCase() ?? null;
  const linear = /\blinear(?:ly)?\s+interpolat|\binterpolat\w*\s+linearly\b|\bby\s+linear\b/i.test(text);
  const wantDegree = requestedDegree(text);

  const pl = readPointList(q.rest);
  if (isPointRefusal(pl)) return refuse(title0, pl.refusal);
  if (!pl) {
    return refuse(title0, "Give the points to interpolate: `interpolate (1, 2), (2, 3), (4, 7)` (add `at x = 3` for a value), `x: 0, 1, 2; y: 1, 3, 2`, `f(2) = 4, f(3) = 9`, or `f(x) = 1/x at x = 1, 2, 4`.");
  }
  const caveats: string[] = [...pl.notes];
  if (fitWord && hasThrough) caveats.push("Read as an INTERPOLANT: the polynomial passes through every point exactly. A least-squares FIT is a different thing (Sketch data → function on the canvas, or Stats mode regression).");
  const n = pl.xs.length;
  if (n === 1) return refuse(title0, `One point (${fmtRat(pl.xs[0])}, ${fmtRat(pl.ys[0])}): every constant through it interpolates it — give at least two points.`);
  if (n > MAX_INTERP_POINTS) {
    return refuse(title0, `${n} points: Runge — an interpolant through ${n} equally spaced points oscillates between the nodes, and the exact coefficients stop being printable. Up to ${MAX_INTERP_POINTS} points here; for more, use a spline (\`natural cubic spline through …\`).`);
  }

  if (linear) return linearInterpolation(pl, q, title0, caveats);

  const ip = interpolatingPolynomial(pl.xs, pl.ys);
  if (!ip) return refuse(title0, "Cross-check FAILED: the Vandermonde solve, the Lagrange basis products and Newton's divided differences did not agree exactly — withheld (please report the points).");
  const deg = ip.coeffs.length ? ip.coeffs.length - 1 : 0;
  const maxDeg = n - 1;
  if (wantDegree !== null) {
    if (wantDegree > maxDeg) return refuse(title0, `${n} points fix a polynomial of degree ≤ ${maxDeg}; a degree-${wantDegree} polynomial through them is not unique (it needs ${wantDegree + 1} points). The interpolant is p(x) = ${polyString(ip.coeffs, "x")}.`);
    if (wantDegree < deg) return refuse(title0, `No polynomial of degree ${wantDegree} passes through these ${n} points — the interpolant has degree ${deg}: p(x) = ${polyString(ip.coeffs, "x")}. A degree-${wantDegree} FIT is least squares (Sketch data → function, or Stats regression).`);
  }
  const shapeName: Record<number, string> = { 0: "a constant", 1: "a line", 2: "a parabola", 3: "a cubic" };
  const kindTitle = method === "lagrange" ? "Lagrange interpolation" : method === "newton" ? "Newton divided differences" : method === "neville" ? "Neville's method" : "Interpolating polynomial";
  const title = `${kindTitle} through ${n} points`;
  const lines: VerbResult["lines"] = [];
  lines.push(line(`p(x) = ${polyString(ip.coeffs, "x")}`, true));
  if (deg < maxDeg) lines.push(line(`Degree ${deg}, not ${maxDeg}: the ${n} points lie on ${shapeName[deg] ?? `a degree-${deg} curve`}${wantDegree !== null && wantDegree > deg ? ` (the degree-${wantDegree} request is satisfied with a zero leading coefficient)` : ""}.`));
  else lines.push(line(`Degree ${deg} through ${n} points — the unique polynomial of degree ≤ ${maxDeg}.`));

  if (method === "lagrange") {
    lines.push(line("Lagrange basis (each L_i is 1 at x_i and 0 at the other nodes):"));
    pl.xs.forEach((_, i) => lines.push(line(`L${i}(x) = ${lagrangeBasisString(pl.xs, i)}`, true)));
    lines.push(line(`p(x) = ${pl.ys.map((y, i) => (ratEq(y, RAT_ONE) ? `L${i}(x)` : `${fmtRat(y)}*L${i}(x)`)).join(" + ").replace(/\+ -/g, "- ")}`));
  }
  lines.push(line(`Divided differences: ${ip.table.map((row, k) => `order ${k}: ${row.map(fmtRat).join(", ")}`).join("; ")}.`));
  lines.push(line("Newton form:"));
  lines.push(line(`p(x) = ${newtonFormString(ip.newton, pl.xs)}`, true));

  const marks: Mark[] = [];
  const lo = pl.xs[0];
  const hi = pl.xs[n - 1];
  for (const qq of q.queries) {
    const pv = evalPolyQuery(ip.coeffs, qq);
    if (!pv.ok) { caveats.push(pv.why); continue; }
    if (method === "neville") {
      if (qq.v) {
        const Q = nevilleTableau(pl.xs, pl.ys, qq.v);
        lines.push(line(`Neville tableau at x = ${fmtRat(qq.v)} (row i uses nodes x_0…x_i going right; column j uses j + 1 consecutive nodes):`));
        Q.forEach((row, i) => lines.push(line(`x_${i} = ${fmtRat(pl.xs[i])}: ${row.map(fmtRat).join(" · ")}`)));
        const last = Q[n - 1][n - 1];
        if (!ratEq(last, pv.rat!)) return refuse(title, "Cross-check FAILED: Neville's tableau did not reproduce p(v) exactly — withheld.");
        caveats.push("Verified: the Neville tableau's final entry equals p(v) from the explicit polynomial, exactly.");
      } else caveats.push(`The Neville tableau is shown for rational query points; p(${pv.label}) came from the explicit polynomial through the CAS.`);
    }
    lines.push(line(`p(${pv.label}) = ${pv.exact}`, true));
    if (!pv.rat || pv.rat.d !== 1n) lines.push(line(`≈ ${sig6(pv.num)}`));
    marks.push({ x: qq.num, y: pv.num, label: `p(${pv.label}) = ${pv.exact}` });
    if (qq.num < ratToNumber(lo) || qq.num > ratToNumber(hi)) caveats.push(`x = ${pv.label} is OUTSIDE the nodes [${fmtRat(lo)}, ${fmtRat(hi)}]: this is extrapolation — the polynomial is defined there, but the data say nothing about it.`);
  }
  if (!q.queries.length && method === "neville") {
    caveats.push("Neville's method evaluates at a point — add `at x = v` for the tableau; the polynomial above is the same one it would produce.");
  }
  caveats.push("Verified: the Vandermonde solve (rref), the Lagrange basis products and Newton's divided differences gave identical coefficients as exact rationals, and p(x_i) = y_i for every point.");
  return { title, lines, caveats, svg: interpolantSvg(ip.coeffs, pl.xs, pl.ys, marks, [`${title}: p(x) = ${polyString(ip.coeffs, "x")}`, title, `${kindTitle}, ${n} points`, `${n}-point interpolant`]), alt: `The interpolating polynomial p(x) = ${polyString(ip.coeffs, "x")} through ${n} points${marks.length ? `, with ${marks.map((m) => m.label).join(", ")} marked` : ""}.` };
}

// ---------------------------------------------------------------------------
// Linear interpolation: two neighbouring points, the proportion line.
// ---------------------------------------------------------------------------

function linearInterpolation(pl: PointList, q: QueryClause, title0: string, caveats: string[]): VerbResult {
  const n = pl.xs.length;
  let i0 = 0;
  if (n > 2) {
    const first = q.queries[0];
    if (!first) return refuse(title0, `Linear interpolation is between two neighbouring points at a query x — add \`at x = v\`. (The broken line through all ${n} points is \`linear spline through …\`; the single polynomial through them is \`interpolate …\`.)`);
    if (q.queries.length > 1) return refuse(title0, `Linear interpolation with several points uses the two nodes that bracket ONE query x — ${q.queries.length} query points were given (${q.queries.map((x) => x.typed).join(", ")}); ask for them one at a time, or use \`linear spline through …\` for the whole broken line.`);
    const vn = first.num;
    const X = pl.xs.map(ratToNumber);
    if (vn < X[0]) i0 = 0;
    else if (vn > X[n - 1]) i0 = n - 2;
    else { i0 = 0; while (i0 < n - 2 && vn > X[i0 + 1]) i0++; }
    caveats.push(`Used the two nodes bracketing x = ${first.v ? fmtRat(first.v) : first.typed}: (${fmtRat(pl.xs[i0])}, ${fmtRat(pl.ys[i0])}) and (${fmtRat(pl.xs[i0 + 1])}, ${fmtRat(pl.ys[i0 + 1])}).`);
  }
  const x0 = pl.xs[i0], y0 = pl.ys[i0], x1 = pl.xs[i0 + 1], y1 = pl.ys[i0 + 1];
  const m = ratDiv(ratSub(y1, y0), ratSub(x1, x0));
  const coeffs = ratPolyTrim([ratSub(y0, ratMul(m, x0)), m]);
  const title = `Linear interpolation between (${fmtRat(x0)}, ${fmtRat(y0)}) and (${fmtRat(x1)}, ${fmtRat(y1)})`;
  const lines: VerbResult["lines"] = [];
  if (ratIsZero(ratSub(y1, y0))) {
    lines.push(line(`Both points have y = ${fmtRat(y0)}, so the line is horizontal (the proportion form would divide by y1 - y0 = 0).`));
  } else {
    lines.push(line("Proportion (equal ratios along the chord):"));
    lines.push(line(`(${diffText("x", x0)})/(${diffText(fmtRat(x1), x0)}) = (${diffText("y", y0)})/(${diffText(fmtRat(y1), y0)})`, true));
  }
  lines.push(line(`p(x) = ${polyString(coeffs, "x")}`, true));
  lines.push(line(`Slope ${fmtRat(m)} per unit x; the chord through the two points.`));
  const marks: Mark[] = [];
  let checkedProportion = false;
  for (const qq of q.queries) {
    const pv = evalPolyQuery(coeffs, qq);
    if (!pv.ok) { caveats.push(pv.why); continue; }
    lines.push(line(`p(${pv.label}) = ${pv.exact}`, true));
    if (!pv.rat || pv.rat.d !== 1n) lines.push(line(`≈ ${sig6(pv.num)}`));
    marks.push({ x: qq.num, y: pv.num, label: `p(${pv.label}) = ${pv.exact}` });
    if (qq.num < ratToNumber(x0) || qq.num > ratToNumber(x1)) caveats.push(`x = ${pv.label} is OUTSIDE [${fmtRat(x0)}, ${fmtRat(x1)}]: this is linear EXTRAPOLATION along the chord.`);
    if (qq.v) {
      // Independent check: the proportion itself.
      const lhs = ratDiv(ratSub(qq.v, x0), ratSub(x1, x0));
      const rhs = ratIsZero(ratSub(y1, y0)) ? lhs : ratDiv(ratSub(pv.rat!, y0), ratSub(y1, y0));
      if (!ratEq(lhs, rhs)) return refuse(title, "Cross-check FAILED: the proportion and the line disagreed — withheld.");
      checkedProportion = true;
    }
  }
  caveats.push(checkedProportion ? "Verified: (x − x0)/(x1 − x0) = (p(x) − y0)/(y1 − y0) exactly at the query point, and the line passes through both points." : "Verified: the line passes through both points exactly.");
  return { title, lines, caveats, svg: interpolantSvg(coeffs, [x0, x1], [y0, y1], marks, [title, "Linear interpolation (the chord)", "Linear interpolation"]), alt: `The chord through (${fmtRat(x0)}, ${fmtRat(y0)}) and (${fmtRat(x1)}, ${fmtRat(y1)})${marks.length ? ` with ${marks.map((m) => m.label).join(", ")} marked` : ""}.` };
}

// ---------------------------------------------------------------------------
// Error bound: |f(x) − p(x)| ≤ M/(n+1)! · max|Π(x − x_i)| on the node interval.
// ---------------------------------------------------------------------------

/** p + q·√Δ, exact arithmetic in ℚ(√Δ). */
type QS = { p: Rat; q: Rat };
const qsMul = (a: QS, b: QS, D: Rat): QS => ({ p: ratAdd(ratMul(a.p, b.p), ratMul(ratMul(a.q, b.q), D)), q: ratAdd(ratMul(a.p, b.q), ratMul(a.q, b.p)) });
const qsAdd = (a: QS, b: QS): QS => ({ p: ratAdd(a.p, b.p), q: ratAdd(a.q, b.q) });
const qsNum = (a: QS, D: Rat): number => ratToNumber(a.p) + ratToNumber(a.q) * sqrtRatToNumber(D);
/** `P + Q*sqrt(D)` in Solve grammar with the square factors pulled out. */
function qsString(a: QS, D: Rat): string {
  if (ratIsZero(a.q)) return fmtRat(a.p);
  const sq = fmtSqrtRat(ratMul(ratMul(a.q, a.q), D)) ?? "0";
  if (ratIsZero(a.p)) return ratSign(a.q) < 0 ? `-${sq}` : sq;
  return `${fmtRat(a.p)} ${ratSign(a.q) < 0 ? "-" : "+"} ${sq}`;
}

function errorBound(text: string, title0: string): VerbResult {
  const m = new RegExp(
    `error\\s+bound\\s+(?:for|of|on|when)?\\s*(?:interpolating|interpolation\\s+of|the\\s+interpolation\\s+of|approximating|the\\s+interpolant\\s+of)?\\s*(?:[A-Za-z]\\s*\\(\\s*[A-Za-z]\\s*\\)\\s*=\\s*)?(.+?)\\s+(?:interpolated\\s+)?(?:at|on|with|using|through)\\s+(?:(?:the\\s+)?(?:nodes?|points?)\\s+)?(?:(?:at\\s+)?[A-Za-z]\\s*[=:]\\s*)?\\{?\\s*(${NUM}(?:\\s*,\\s*${NUM}|\\s+${NUM})+)\\s*\\}?(.*)$`,
    "is",
  ).exec(text);
  if (!m) return refuse(title0, "Give the function and its nodes: `error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic`.");
  const exprText = m[1].trim();
  const nodes = m[2].trim().split(/\s*,\s*|\s+/).map((s) => parseRatLiteral(s));
  if (!nodes.every((r): r is Rat => !!r)) return refuse(title0, "Every node must be a number (decimals and fractions are read exactly).");
  const tail = m[3] ?? "";
  let expr: Expr;
  try { expr = parseExpr(exprText); } catch (err) { return refuse(title0, `Couldn't read the function ${exprText}: ${(err as Error).message}`); }
  const fv = freeVars(expr);
  if (fv.length > 1) return refuse(title0, `${exprText} has more than one variable (${fv.join(", ")}) — the bound is for a function of one variable.`);
  const v = fv[0] ?? "x";
  // Nodes: distinct, sorted (said).
  const sorted = nodes.slice().sort((a, b) => ratSign(ratSub(a, b)));
  for (let i = 1; i < sorted.length; i++) if (ratEq(sorted[i], sorted[i - 1])) return refuse(title0, `The node ${fmtRat(sorted[i])} is repeated — interpolation nodes must be distinct.`);
  const caveats: string[] = [];
  if (sorted.some((x, i) => !ratEq(x, nodes[i]))) caveats.push(`Nodes sorted: ${sorted.map(fmtRat).join(", ")}.`);
  const n = sorted.length - 1;
  if (n < 1) return refuse(title0, "At least two nodes are needed.");
  if (sorted.length > MAX_INTERP_POINTS) return refuse(title0, `${sorted.length} nodes: up to ${MAX_INTERP_POINTS} here (Runge).`);
  const want = requestedDegree(tail) ?? requestedDegree(text.replace(m[2], " "));
  if (want !== null && want !== n) return refuse(title0, `${sorted.length} nodes give a degree-${n} interpolant, not degree ${want} — give ${want + 1} nodes for a degree-${want} polynomial.`);
  const a = sorted[0];
  const b = sorted[n];
  // The (n+1)-th derivative, simplified at every step.
  let d = expr;
  for (let k = 0; k <= n; k++) {
    try { d = exactSimplify(foldLnE(exactSimplify(derivative(d, v)))); } catch (err) { return refuse(title0, `Could not differentiate ${exprText} ${n + 1} times: ${(err as Error).message}`); }
  }
  const dText = format(d);
  // M = max |f^(n+1)| on [a, b]: exact where provable (|sin|, |cos| ≤ 1; a
  // constant; a monotone exponential, largest at an endpoint), else sampled and SAID.
  let M: Rat | null = null;
  let Mexpr: Expr | null = null;
  let Mnum: number;
  let Mhow: string;
  const trigUnit = new RegExp(`^-?(?:sin|cos)\\(${v}\\)$`);
  const monoExp = new RegExp(`^-?(?:${NUM}\\*)?(?:exp\\(${v}\\)|e\\^${v})$`);
  if (trigUnit.test(dText)) {
    M = RAT_ONE; Mnum = 1;
    Mhow = `M = 1: |${dText.replace(/^-/, "")}| ≤ 1 everywhere — provable, not sampled.`;
  } else if (freeVars(d).length === 0) {
    const c = constantRat(d);
    if (c) { M = ratAbs(c); Mnum = ratToNumber(M); Mhow = `M = ${fmtRat(M)}: the derivative is constant.`; }
    else { Mexpr = d.t === "neg" ? d.e : d; Mnum = Math.abs(evalAst(d, { pi: Math.PI, e: Math.E })); Mhow = `M = ${format(Mexpr)} ≈ ${sig6(Mnum)}: the derivative is constant.`; }
  } else if (monoExp.test(dText)) {
    // exp is increasing, so |c·e^x| is largest at the right endpoint — exact, not sampled.
    const atB = exactSimplify(substituteVarLocal(d, v, b));
    const cr = constantRat(atB);
    if (cr) { M = ratAbs(cr); Mnum = ratToNumber(M); }
    else { Mexpr = atB.t === "neg" ? atB.e : atB; Mnum = Math.abs(evalAst(atB, { pi: Math.PI, e: Math.E })); }
    Mhow = `M = ${M ? fmtRat(M) : format(Mexpr!)}${M && M.d === 1n ? "" : ` ≈ ${sig6(Mnum)}`}: ${dText} is monotone (the exponential is increasing), so |f^(${n + 1})(${v})| is largest at the right endpoint ${v} = ${fmtRat(b)} — exact, not sampled.`;
  } else {
    const lo = ratToNumber(a), hi = ratToNumber(b);
    let best = -Infinity;
    let bestX = lo;
    const N = 2000;
    for (let k = 0; k <= N; k++) {
      const x = lo + ((hi - lo) * k) / N;
      let y: number;
      try { y = Math.abs(evalAst(d, { [v]: x })); } catch { y = NaN; }
      if (!Number.isFinite(y)) return refuse(title0, `f^(${n + 1})(${v}) = ${dText} is not finite at ${v} ≈ ${sig6(x)} inside [${fmtRat(a)}, ${fmtRat(b)}] — the derivative is unbounded there, so there is no finite error bound of this form.`);
      if (y > best) { best = y; bestX = x; }
    }
    // An endpoint value that is exact and at least the sampled interior max is stated exactly.
    const endVals = [a, b].map((e) => constantRat(exactSimplify(substituteVarLocal(d, v, e))));
    const endMax = endVals.reduce<Rat | null>((acc, r) => (r && (!acc || ratGt(ratAbs(r), acc)) ? ratAbs(r) : acc), null);
    if (endMax && ratToNumber(endMax) >= best * (1 - 1e-12)) {
      M = endMax; Mnum = ratToNumber(M);
      Mhow = `M = ${fmtRat(M)}: |${dText}| is largest at an endpoint of [${fmtRat(a)}, ${fmtRat(b)}] (2001 interior samples never exceed it — the endpoint value is exact; the interior claim is by sampling).`;
    } else {
      Mnum = best;
      Mhow = `M ≈ ${sig6(best)} at ${v} ≈ ${sig6(bestX)} — by dense sampling of |${dText}| on [${fmtRat(a)}, ${fmtRat(b)}] (2001 points), NOT a proof; the bound below is numeric.`;
    }
  }
  // w(x) = Π (x − x_i) and its maximum modulus on [a, b].
  let w: Rat[] = [RAT_ONE];
  for (const x of sorted) w = ratPolyMul(w, [ratNeg(x), RAT_ONE]);
  const wp = ratPolyTrim(w.map((c, k) => ratMul(c, ratInt(k))).slice(1));
  const wNum = polyToNumber(w);
  const inside = (x: Rat): boolean => ratGt(x, a) && ratLt(x, b);
  let maxExact: Rat | null = null;
  let maxQS: { val: QS; D: Rat } | null = null;
  let maxNum = 0;
  let where = "";
  const rr = ratPolyRoots(wp);
  if (!rr.incomplete && ratPolyTrim(rr.rest).length <= 1) {
    const cands = rr.roots.map((r) => r.root).filter(inside);
    let bestR: Rat | null = null;
    let bestV: Rat = RAT_ZERO;
    for (const c of cands) {
      const val = ratAbs(ratPolyEval(w, c));
      if (!bestR || ratGt(val, bestV)) { bestR = c; bestV = val; }
    }
    if (bestR) { maxExact = bestV; maxNum = ratToNumber(bestV); where = `at ${v} = ${fmtRat(bestR)} (a rational critical point of w)`; }
  } else if (wp.length === 3) {
    // Quadratic w' with irrational roots: exact in ℚ(√Δ).
    const [c0, c1, c2] = wp;
    const D = ratSub(ratMul(c1, c1), ratMul(ratInt(4), ratMul(c2, c0)));
    const twoA = ratMul(ratInt(2), c2);
    const p = ratDiv(ratNeg(c1), twoA);
    const qmag = ratDiv(RAT_ONE, twoA);
    for (const sgn of [1, -1]) {
      const root: QS = { p, q: sgn > 0 ? qmag : ratNeg(qmag) };
      const rootNum = qsNum(root, D);
      if (!(rootNum > ratToNumber(a) && rootNum < ratToNumber(b))) continue;
      // Horner in ℚ(√Δ).
      let acc: QS = { p: RAT_ZERO, q: RAT_ZERO };
      for (let i = w.length - 1; i >= 0; i--) acc = qsAdd(qsMul(acc, root, D), { p: w[i], q: RAT_ZERO });
      let val = qsNum(acc, D);
      if (val < 0) { acc = { p: ratNeg(acc.p), q: ratNeg(acc.q) }; val = -val; }
      if (!maxQS || val > maxNum) { maxQS = { val: acc, D }; maxNum = val; }
    }
    const rootsText = `${v} = ${qsString({ p, q: qmag }, D).replace(/ \+ /, " ± ")}`;
    where = `at the critical points of w, ${rootsText}`;
  }
  if (!maxExact && !maxQS) {
    const lo = ratToNumber(a), hi = ratToNumber(b);
    let best = 0, bestX = lo;
    const N = 4000;
    for (let k = 0; k <= N; k++) {
      const x = lo + ((hi - lo) * k) / N;
      const y = Math.abs(evalNum(wNum, x));
      if (y > best) { best = y; bestX = x; }
    }
    // Refine by ternary search on |w| in the bracketing cell.
    let l = Math.max(lo, bestX - (hi - lo) / N), r = Math.min(hi, bestX + (hi - lo) / N);
    for (let it = 0; it < 100; it++) {
      const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3;
      if (Math.abs(evalNum(wNum, m1)) < Math.abs(evalNum(wNum, m2))) l = m1; else r = m2;
    }
    const xm = (l + r) / 2;
    maxNum = Math.abs(evalNum(wNum, xm));
    where = `at ${v} ≈ ${sig6(xm)} (numeric: the critical points of w are not rational here)`;
  }
  const fact = factorial(n + 1);
  const scale = M ? ratDiv(M, fact) : null;
  const lines: VerbResult["lines"] = [];
  let boundMath: string | null = null;
  let boundText: string;
  let boundNum = (Mnum / ratToNumber(fact)) * maxNum;
  /** A sum or difference gets parentheses when it is multiplied in the text. */
  const paren = (s: string): string => (/\s[+-]\s/.test(s) ? `(${s})` : s);
  const maxStr = maxExact ? fmtRat(maxExact) : maxQS ? qsString(maxQS.val, maxQS.D) : null;
  const Mstr = M ? fmtRat(M) : Mexpr ? format(Mexpr) : `≈ ${sig6(Mnum)}`;
  if (scale && maxExact) {
    const bnd = ratMul(scale, maxExact);
    boundMath = fmtRat(bnd);
    boundText = `|f(${v}) - p(${v})| ≤ ${Mstr}/${fmtRat(fact)} · ${maxStr} = ${withApprox(bnd)}`;
  } else if (scale && maxQS) {
    const bnd: QS = { p: ratMul(maxQS.val.p, scale), q: ratMul(maxQS.val.q, scale) };
    boundMath = qsString(bnd, maxQS.D);
    boundText = `|f(${v}) - p(${v})| ≤ ${Mstr}/${fmtRat(fact)} · ${paren(maxStr!)} = ${boundMath} ≈ ${sig6(boundNum)}`;
  } else if (Mexpr && maxStr) {
    // A symbolic M (e^2) times an exact max: the product through the CAS, kept exact.
    const bnd = exactSimplify({ t: "mul", l: { t: "div", l: Mexpr, r: ratToExprExact(fact) }, r: parseExpr(maxStr) });
    boundMath = format(bnd);
    boundNum = evalAst(bnd, { pi: Math.PI, e: Math.E });
    boundText = `|f(${v}) - p(${v})| ≤ ${paren(Mstr)}/${fmtRat(fact)} · ${paren(maxStr)} = ${boundMath} ≈ ${sig6(boundNum)}`;
  } else {
    boundText = `|f(${v}) - p(${v})| ≤ ${Mstr}/${fmtRat(fact)} · ${maxStr ? paren(maxStr) : `≈ ${sig6(maxNum)}`} ≈ ${sig6(boundNum)} (numeric)`;
  }
  const title = `Error bound for interpolating ${exprText} at ${n + 1} nodes`;
  // The exact bound is the math line; a numeric bound is never shown as a bare
  // decimal under an exactness heading — it is labelled ≈ on the same line.
  if (boundMath !== null) lines.push(line(boundMath, true));
  else lines.push(line(`≈ ${sig6(boundNum)} (numeric bound — see how M and max|w| were found below)`));
  lines.push(line(`${boundText} on [${fmtRat(a)}, ${fmtRat(b)}]`));
  lines.push(line(`|f(${v}) − p(${v})| ≤ M/(n+1)! · max|w(${v})| with n = ${n} (${n + 1} nodes → degree ≤ ${n}), (n+1)! = ${fmtRat(fact)}, M = max|f^(${n + 1})(${v})| on the node interval.`));
  lines.push(line(`f^(${n + 1})(${v}):`));
  lines.push(line(dText, true));
  lines.push(line(Mhow));
  lines.push(line(`Node polynomial w(${v}) = ${sorted.map((x) => factor(x, v)).join("*")}:`));
  lines.push(line(`w(${v}) = ${polyString(w, v)}`, true));
  lines.push(line(`max|w(${v})| on [${fmtRat(a)}, ${fmtRat(b)}] = ${maxExact ? withApprox(maxExact) : maxQS ? `${qsString(maxQS.val, maxQS.D)} ≈ ${sig6(maxNum)}` : `≈ ${sig6(maxNum)}`} ${where}.`));
  if (!M && !Mexpr) caveats.push("M came from sampling, so the bound is numeric, not a theorem.");
  if (!maxExact && !maxQS) caveats.push("max|w| came from a numeric search (the critical points of w are not rational), so the bound is reported to 6 significant figures.");
  caveats.push("The bound assumes f has n + 1 continuous derivatives on the node interval and holds for x INSIDE that interval only.");
  return { title, lines, caveats };
}

/** substituteVar with an exact Rat value (1/2 as a quotient, never the double). */
const substituteVarLocal = (e: Expr, v: string, r: Rat): Expr => substituteVar(e, v, ratToExprExact(r));

/** ln(e) → 1 (e^x differentiates to ln(e)·e^x and the simplifier leaves ln(e) alone — the multivar S wrapper's fold). */
function foldLnE(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg":
      return { t: "neg", e: foldLnE(e.e) };
    case "fn":
      if (e.name === "ln" && e.arg.t === "var" && e.arg.name === "e") return { t: "num", v: 1 };
      return { t: "fn", name: e.name, arg: foldLnE(e.arg) };
    default:
      return { t: e.t, l: foldLnE(e.l), r: foldLnE(e.r) } as Expr;
  }
}
