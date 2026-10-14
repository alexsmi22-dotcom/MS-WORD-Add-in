/**
 * Splines — the `spline` verbs of the equation kind.
 *
 * Cubic splines in M-form (the second derivatives at the knots), the
 * tridiagonal system solved EXACTLY over the rationals of cas.ts by
 * systems.rref: natural (S'' = 0 at both ends — the default, and SAID to be a
 * choice), clamped (S' given at both ends), not-a-knot (S''' continuous across
 * the first and last interior knots; with 4 knots that IS the interpolating
 * cubic, cross-checked against interpolate.ts), the linear spline (the broken
 * line), and PCHIP (Fritsch–Carlson monotone slopes with MATLAB's end formula,
 * the convention stated by name).
 *
 * Verification is built in and symbolic: at every interior knot S, S' and S''
 * (S, S' for PCHIP — it is C¹ by design) agree from both sides EXACTLY as
 * rationals; the end conditions hold exactly; S(x_i) = y_i. A failure is a
 * refusal, never a displayed spline.
 *
 * Refused by name: quadratic splines (the extra condition is not standard),
 * periodic splines, parametric / 2-D / 3-D splines, repeated x, more than
 * MAX_KNOTS knots, a "smooth curve" through one point. Two knots → the chord.
 *
 * Every piece is one math line in Solve grammar (`S(x) = 1 - 3/2*(x - 1)^2 +
 * 1/2*(x - 1)^3`); its interval lives in the text layer. The figure is the
 * verb's own: every piece is sampled on ITS interval only, the knots are
 * marked, clamped end tangents are drawn as short segments, and the query
 * point is marked.
 */
import {
  Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratEq, ratSign, ratToNumber, ratInt, parseRatLiteral,
  RAT_ZERO, RAT_ONE, ratPolyMul, ratPolyAdd, ratPolyTrim, ratPolyEval,
} from "./cas";
import { fmtRat } from "./geometry";
import { rref } from "./systems";
import { buildPlotSvg, Series } from "./plot";
import { polyString } from "./algebraTools";
import type { VerbResult } from "./algebraTools";
import { readPointList, isPointRefusal, asciiMath, NUM_RE_SRC } from "./pointList";
import { interpolatingPolynomial, extractQueries, evalPolyQuery, fitTitle, VERB_AS_VARIABLE_RE, Mark } from "./interpolate";

export type { VerbResult };

/** Claims a line for the spline verbs. */
export const SPLINE_VERB_RE = /^(?!\s*(?:b-?splines?|splines?|interpolat\w*|pchip)\s*=)(?:[\s\S]*?\b(?:natural|clamped|not-a-knot|cubic|linear|quadratic|monotone|complete)?\s*splines?\b|\s*(?:smooth\s+curve\s+through|pchip|monotone\s+cubic))/i;

export const MAX_KNOTS = 50;

export type SplineKind = "natural" | "clamped" | "not-a-knot" | "linear" | "pchip";

export interface SplinePiece {
  /** The interval [x0, x1]. */
  x0: Rat;
  x1: Rat;
  /** Ascending coefficients in (x − x0) when `local`, else in x. */
  c: Rat[];
  local: boolean;
}

export interface Spline {
  kind: SplineKind;
  xs: Rat[];
  ys: Rat[];
  pieces: SplinePiece[];
  /** Second derivatives at the knots (cubic kinds). */
  M?: Rat[];
  /** First derivatives at the knots (PCHIP). */
  slopes?: Rat[];
  /** The clamped end slopes. */
  clamp?: { m0: Rat; m1: Rat };
}

const NUM = NUM_RE_SRC;
const sig6 = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x));
const refuse = (title: string, why: string, extra: string[] = []): VerbResult => ({ title, lines: [], caveats: [why, ...extra] });
const line = (text: string, math = false): { text: string; math?: boolean } => (math ? { text, math: true } : { text });
const ratLt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) < 0;
const ratGt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) > 0;
const ratAbs = (a: Rat): Rat => (ratSign(a) < 0 ? ratNeg(a) : a);
const R = (n: number): Rat => ratInt(n);

/** "x", "(x - 1)", "(x + 2)" — the local variable of a piece. */
export const localVar = (x0: Rat): string => (ratIsZero(x0) ? "x" : ratSign(x0) > 0 ? `(x - ${fmtRat(x0)})` : `(x + ${fmtRat(ratNeg(x0))})`);

/** The piece as a Solve-grammar string, ascending powers. */
export const pieceString = (p: SplinePiece): string => polyString(p.c, p.local ? localVar(p.x0) : "x", true);

const polyDeriv = (c: Rat[]): Rat[] => ratPolyTrim(c.map((v, k) => ratMul(v, R(k))).slice(1));
export const pieceEval = (p: SplinePiece, x: Rat, order = 0): Rat => {
  let c = p.c;
  for (let k = 0; k < order; k++) c = polyDeriv(c);
  return ratPolyEval(c, p.local ? ratSub(x, p.x0) : x);
};
/** The piece expanded to global ascending coefficients in x. */
export function pieceGlobal(p: SplinePiece): Rat[] {
  if (!p.local) return ratPolyTrim(p.c);
  let out: Rat[] = [];
  let pw: Rat[] = [RAT_ONE];
  for (let k = 0; k < p.c.length; k++) {
    out = ratPolyAdd(out, pw.map((v) => ratMul(v, p.c[k])));
    pw = ratPolyMul(pw, [ratNeg(p.x0), RAT_ONE]);
  }
  return ratPolyTrim(out);
}

// ---------------------------------------------------------------------------
// Construction.
// ---------------------------------------------------------------------------

/**
 * Builds the spline exactly. Returns a string (a refusal by name) when the kind
 * cannot be built on these knots. Knots must be sorted and distinct.
 */
export function buildSpline(xs: Rat[], ys: Rat[], kind: SplineKind, clamp?: { m0: Rat; m1: Rat }): Spline | string {
  const n = xs.length;
  if (n < 2) return "A spline needs at least two knots.";
  const h: Rat[] = [];
  const delta: Rat[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(ratSub(xs[i + 1], xs[i]));
    if (ratSign(h[i]) <= 0) return "Knots must be strictly increasing in x.";
    delta.push(ratDiv(ratSub(ys[i + 1], ys[i]), h[i]));
  }
  if (kind === "linear" || (n === 2 && kind !== "clamped")) {
    const pieces: SplinePiece[] = [];
    for (let i = 0; i < n - 1; i++) pieces.push({ x0: xs[i], x1: xs[i + 1], c: ratPolyTrim([ratSub(ys[i], ratMul(delta[i], xs[i])), delta[i]]), local: false });
    return { kind: kind === "linear" ? "linear" : kind, xs, ys, pieces };
  }
  if (kind === "pchip") {
    const d: Rat[] = new Array(n).fill(RAT_ZERO);
    for (let i = 1; i < n - 1; i++) {
      if (ratSign(ratMul(delta[i - 1], delta[i])) <= 0) { d[i] = RAT_ZERO; continue; }
      const w1 = ratAdd(ratMul(R(2), h[i]), h[i - 1]);
      const w2 = ratAdd(h[i], ratMul(R(2), h[i - 1]));
      d[i] = ratDiv(ratAdd(w1, w2), ratAdd(ratDiv(w1, delta[i - 1]), ratDiv(w2, delta[i])));
    }
    const endSlope = (h0: Rat, h1: Rat, d0: Rat, d1: Rat): Rat => {
      let s = ratDiv(ratSub(ratMul(ratAdd(ratMul(R(2), h0), h1), d0), ratMul(h0, d1)), ratAdd(h0, h1));
      if (ratSign(s) !== ratSign(d0)) s = RAT_ZERO;
      else if (ratSign(d0) !== ratSign(d1) && ratGt(ratAbs(s), ratMul(R(3), ratAbs(d0)))) s = ratMul(R(3), d0);
      return s;
    };
    d[0] = endSlope(h[0], h[1], delta[0], delta[1]);
    d[n - 1] = endSlope(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);
    const pieces: SplinePiece[] = [];
    for (let i = 0; i < n - 1; i++) {
      const c2 = ratDiv(ratSub(ratSub(ratMul(R(3), delta[i]), ratMul(R(2), d[i])), d[i + 1]), h[i]);
      const c3 = ratDiv(ratSub(ratAdd(d[i], d[i + 1]), ratMul(R(2), delta[i])), ratMul(h[i], h[i]));
      pieces.push({ x0: xs[i], x1: xs[i + 1], c: ratPolyTrim([ys[i], d[i], c2, c3]), local: true });
    }
    return { kind, xs, ys, pieces, slopes: d };
  }
  // Cubic M-form: unknowns M_0 … M_{n−1}.
  if (kind === "not-a-knot" && n < 4) return "Not-a-knot needs at least 4 knots (with 3 the two conditions coincide and the system is singular; the parabola through 3 points is `interpolate …`).";
  if (kind === "clamped" && !clamp) return "A clamped spline needs both end slopes: `with S'(x0) = m0, S'(xn) = m1` or `with end slopes m0 and m1`.";
  const rows: Rat[][] = [];
  const zeroRow = (): Rat[] => new Array(n + 1).fill(RAT_ZERO);
  // First row.
  {
    const r = zeroRow();
    if (kind === "natural") { r[0] = RAT_ONE; }
    else if (kind === "clamped") { r[0] = ratMul(R(2), h[0]); r[1] = h[0]; r[n] = ratMul(R(6), ratSub(delta[0], clamp!.m0)); }
    else { r[0] = h[1]; r[1] = ratNeg(ratAdd(h[0], h[1])); r[2] = h[0]; }
    rows.push(r);
  }
  for (let i = 1; i < n - 1; i++) {
    const r = zeroRow();
    r[i - 1] = h[i - 1];
    r[i] = ratMul(R(2), ratAdd(h[i - 1], h[i]));
    r[i + 1] = h[i];
    r[n] = ratMul(R(6), ratSub(delta[i], delta[i - 1]));
    rows.push(r);
  }
  {
    const r = zeroRow();
    if (kind === "natural") { r[n - 1] = RAT_ONE; }
    else if (kind === "clamped") { r[n - 2] = h[n - 2]; r[n - 1] = ratMul(R(2), h[n - 2]); r[n] = ratMul(R(6), ratSub(clamp!.m1, delta[n - 2])); }
    else { r[n - 3] = h[n - 2]; r[n - 2] = ratNeg(ratAdd(h[n - 3], h[n - 2])); r[n - 1] = h[n - 3]; }
    rows.push(r);
  }
  const sol = rref(rows);
  if (sol.pivots.length !== n || sol.pivots.some((p, i) => p !== i)) return "The spline system was singular — withheld (please report the knots).";
  const M = sol.rows.map((r) => r[n]);
  const pieces: SplinePiece[] = [];
  for (let i = 0; i < n - 1; i++) {
    const b = ratSub(delta[i], ratDiv(ratMul(h[i], ratAdd(ratMul(R(2), M[i]), M[i + 1])), R(6)));
    const c = ratDiv(M[i], R(2));
    const d = ratDiv(ratSub(M[i + 1], M[i]), ratMul(R(6), h[i]));
    pieces.push({ x0: xs[i], x1: xs[i + 1], c: ratPolyTrim([ys[i], b, c, d]), local: true });
  }
  return { kind, xs, ys, pieces, M, clamp };
}

/**
 * Symbolic verification: interpolation, continuity of S, S' (and S'' for the
 * cubic kinds) at every interior knot, the end conditions. Returns the list of
 * failures (empty = verified) and a sentence describing what was checked.
 */
export function verifySpline(s: Spline): { failures: string[]; checked: string } {
  const f: string[] = [];
  const n = s.xs.length;
  const cubic = s.kind === "natural" || s.kind === "clamped" || s.kind === "not-a-knot";
  for (let i = 0; i < n; i++) {
    const p = s.pieces[Math.min(i, n - 2)];
    if (!ratEq(pieceEval(p, s.xs[i]), s.ys[i])) f.push(`S(${fmtRat(s.xs[i])}) ≠ ${fmtRat(s.ys[i])}`);
  }
  const orders = s.kind === "linear" ? [0] : cubic ? [0, 1, 2] : [0, 1];
  for (let i = 1; i < n - 1; i++) {
    for (const k of orders) {
      const l = pieceEval(s.pieces[i - 1], s.xs[i], k);
      const r = pieceEval(s.pieces[i], s.xs[i], k);
      if (!ratEq(l, r)) f.push(`S${"'".repeat(k)} jumps at x = ${fmtRat(s.xs[i])} (${fmtRat(l)} vs ${fmtRat(r)})`);
    }
  }
  let ends = "";
  if (s.kind === "natural" && n > 2) {
    if (!ratIsZero(pieceEval(s.pieces[0], s.xs[0], 2)) || !ratIsZero(pieceEval(s.pieces[n - 2], s.xs[n - 1], 2))) f.push("S'' ≠ 0 at an end");
    ends = "S'' = 0 at both ends";
  } else if (s.kind === "clamped" && s.clamp) {
    if (!ratEq(pieceEval(s.pieces[0], s.xs[0], 1), s.clamp.m0)) f.push(`S'(${fmtRat(s.xs[0])}) ≠ ${fmtRat(s.clamp.m0)}`);
    if (!ratEq(pieceEval(s.pieces[n - 2], s.xs[n - 1], 1), s.clamp.m1)) f.push(`S'(${fmtRat(s.xs[n - 1])}) ≠ ${fmtRat(s.clamp.m1)}`);
    ends = `S'(${fmtRat(s.xs[0])}) = ${fmtRat(s.clamp.m0)} and S'(${fmtRat(s.xs[n - 1])}) = ${fmtRat(s.clamp.m1)}`;
  } else if (s.kind === "not-a-knot" && n >= 4) {
    const third = (p: SplinePiece): Rat => (p.c[3] ? ratMul(R(6), p.c[3]) : RAT_ZERO);
    if (!ratEq(third(s.pieces[0]), third(s.pieces[1])) || !ratEq(third(s.pieces[n - 3]), third(s.pieces[n - 2]))) f.push("S''' jumps at the first or last interior knot");
    ends = `S''' continuous across x = ${fmtRat(s.xs[1])} and x = ${fmtRat(s.xs[n - 2])}`;
  }
  const cont = s.kind === "linear" ? "S is continuous" : cubic ? "S, S' and S'' agree from both sides" : "S and S' agree from both sides (C¹: PCHIP does not make S'' continuous)";
  const checked = n === 2
    ? "Verified exactly (rational arithmetic): S(x_i) = y_i at both knots (no interior knot, nothing to join)."
    : `Verified exactly (rational arithmetic): S(x_i) = y_i at every knot; ${cont} at every interior knot${ends ? `; ${ends}` : ""}.`;
  return { failures: f, checked };
}

// ---------------------------------------------------------------------------
// The figure: each piece on its own interval, knots, tangents, the query point.
// ---------------------------------------------------------------------------

export function splineSvg(s: Spline, marks: Mark[] | { x: Rat; y: Rat } | null, title: string): string {
  const query: Mark[] = Array.isArray(marks) ? marks : marks ? [{ x: ratToNumber(marks.x), y: ratToNumber(marks.y), label: `S(${fmtRat(marks.x)}) = ${fmtRat(marks.y)}` }] : [];
  const series: Series[] = [];
  const colours = ["#1f77b4", "#ff7f0e"];
  s.pieces.forEach((p, i) => {
    const lo = ratToNumber(p.x0), hi = ratToNumber(p.x1);
    const c = p.c.map(ratToNumber);
    const x0 = p.local ? lo : 0;
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k <= 40; k++) {
      const x = lo + ((hi - lo) * k) / 40;
      const u = x - x0;
      let acc = 0;
      for (let j = c.length - 1; j >= 0; j--) acc = acc * u + c[j];
      pts.push({ x, y: acc });
    }
    series.push({ points: pts, type: "line", color: colours[i % 2], label: i === 0 ? `S(x), ${s.pieces.length} piece${s.pieces.length > 1 ? "s" : ""}` : undefined });
  });
  series.push({ points: s.xs.map((x, i) => ({ x, y: s.ys[i] })).map((p) => ({ x: ratToNumber(p.x), y: ratToNumber(p.y) })), type: "scatter", color: "#d62728", label: `${s.xs.length} knots` });
  if (s.kind === "clamped" && s.clamp) {
    const span = ratToNumber(s.xs[s.xs.length - 1]) - ratToNumber(s.xs[0]);
    const L = 0.12 * (span || 1);
    const x0 = ratToNumber(s.xs[0]), y0 = ratToNumber(s.ys[0]), m0 = ratToNumber(s.clamp.m0);
    const xn = ratToNumber(s.xs[s.xs.length - 1]), yn = ratToNumber(s.ys[s.ys.length - 1]), m1 = ratToNumber(s.clamp.m1);
    series.push({ points: [{ x: x0, y: y0 }, { x: x0 + L, y: y0 + m0 * L }], type: "line", color: "#7f7f7f", label: "end tangents" });
    series.push({ points: [{ x: xn - L, y: yn - m1 * L }, { x: xn, y: yn }], type: "line", color: "#7f7f7f" });
  }
  for (const m of query) series.push({ points: [{ x: m.x, y: m.y }], type: "scatter", color: "#2ca02c", label: m.label });
  // The title is centred on the plot frame: one wider than the frame runs off the canvas.
  const short = `${s.kind === "pchip" ? "PCHIP" : s.kind === "not-a-knot" ? "Not-a-knot spline" : s.kind === "linear" ? "Linear spline" : s.kind === "clamped" ? "Clamped spline" : "Natural spline"}, ${s.xs.length} knots`;
  return buildPlotSvg(series, { title: fitTitle([title, short, `${s.xs.length}-knot spline`]), xlabel: "x", ylabel: "S(x)" });
}

// ---------------------------------------------------------------------------
// Grammar.
// ---------------------------------------------------------------------------

interface ClampClause {
  rest: string;
  clamp: { m0: Rat; m1: Rat; at0: Rat | null; at1: Rat | null } | null;
  error?: string;
}

function readClamp(text: string): ClampClause {
  let rest = text;
  // S'(0) = 1, S'(2) = -1  (any single-letter function name)
  const re = new RegExp(`(?<![A-Za-z0-9_])[A-Za-z]'\\s*\\(\\s*(${NUM})\\s*\\)\\s*=\\s*(${NUM})`, "g");
  const found: { at: Rat; m: Rat }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = parseRatLiteral(m[1]);
    const mv = parseRatLiteral(m[2]);
    if (at && mv) found.push({ at, m: mv });
  }
  if (found.length) {
    rest = text.replace(re, " ");
    if (found.length !== 2) return { rest, clamp: null, error: `A clamped spline needs exactly two end slopes; ${found.length} given.` };
    return { rest, clamp: { m0: found[0].m, m1: found[1].m, at0: found[0].at, at1: found[1].at } };
  }
  const pairRes = [
    new RegExp(`\\b(?:with\\s+)?end\\s+slopes?\\s+(?:of\\s+)?(${NUM})\\s*(?:and|,|&)\\s*(${NUM})`, "i"),
    new RegExp(`\\bslopes?\\s+(?:of\\s+)?(${NUM})\\s*(?:and|,|&)\\s*(${NUM})\\s+at\\s+the\\s+ends`, "i"),
    new RegExp(`\\b(?:with\\s+)?(?:end\\s+)?(?:derivatives?|S')\\s*(?:=|of)?\\s*(${NUM})\\s*(?:and|,|&)\\s*(${NUM})(?:\\s+at\\s+the\\s+ends)?`, "i"),
    new RegExp(`\\bclamped\\s+(?:with\\s+|at\\s+)?(${NUM})\\s*(?:and|,|&)\\s*(${NUM})`, "i"),
  ];
  for (const pr of pairRes) {
    const pm = pr.exec(text);
    if (!pm) continue;
    const m0 = parseRatLiteral(pm[1]);
    const m1 = parseRatLiteral(pm[2]);
    if (!m0 || !m1) continue;
    return { rest: text.replace(pm[0], " "), clamp: { m0, m1, at0: null, at1: null } };
  }
  return { rest, clamp: null };
}

/**
 * The spline verbs. Null when the line is not one; a NAMED refusal when it is
 * one that cannot be answered.
 */
export function trySpline(input: string): VerbResult | null {
  const text = asciiMath(input).trim();
  if (!text) return null;
  // `spline = 2` is an equation in a variable called spline — not this verb's.
  if (VERB_AS_VARIABLE_RE.test(text)) return null;
  if (!SPLINE_VERB_RE.test(text)) return null;
  const title0 = text.length > 72 ? text.slice(0, 69).trimEnd() + "…" : text;
  if (/\bb[-\s]?splines?\b|\bbasis\s+functions?\b|\bnurbs\b|\bbezier\b|\bbézier\b/i.test(text)) {
    return refuse(title0, "B-spline basis functions (and NURBS / Bézier curves) are not built here — natural, clamped, not-a-knot, linear and PCHIP INTERPOLATING splines through (x, y) knots are: `natural cubic spline through (0, 0), (1, 1), (2, 0)`.");
  }

  if (/\bquadratic\s+splines?\b/i.test(text)) {
    return refuse(title0, "Quadratic splines are not built here: with one fewer coefficient per piece they need an extra condition that nobody states the same way (a starting slope, a zero second derivative, a knot shift), so two textbooks give two different curves. Ask for `natural cubic spline through …`, `clamped … with S'(a) = m0, S'(b) = m1`, `not-a-knot spline`, `linear spline`, or `pchip`.");
  }
  if (/\bperiodic\s+splines?\b/i.test(text)) return refuse(title0, "Periodic splines (S' and S'' matched at the two ends) are not built here — natural, clamped, not-a-knot, linear and PCHIP are.");
  if (/\b(?:parametric|2-?d|3-?d|two[-\s]dimensional|three[-\s]dimensional|closed\s+curve)\b/i.test(text) || new RegExp(`\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)`).test(text)) {
    return refuse(title0, "Parametric / 2-D / 3-D splines (a curve x(t), y(t) through points in the plane, or points with three coordinates) are not built here — these verbs give S(x) through (x, y) knots with distinct x.");
  }

  const kindWords = {
    pchip: /\bpchip\b|\bmonotone\b|\bshape[-\s]preserving\b/i.test(text),
    linear: /\blinear\s+splines?\b|\bpiecewise[-\s]linear\b/i.test(text),
    notAKnot: /\bnot[-\s]a[-\s]knot\b/i.test(text),
    clampedWord: /\bclamped\b|\bcomplete\s+(?:cubic\s+)?splines?\b/i.test(text),
    naturalWord: /\bnatural\b|\bsecond\s+derivatives?\s+(?:is\s+|are\s+|of\s+)?(?:zero|0)\s+at\s+(?:the\s+|both\s+)?ends?|\bS''\s*=\s*0\b|\bfree\s+ends?\b/i.test(text),
  };
  const cl = readClamp(text);
  if (cl.error) return refuse(title0, cl.error);
  let rest = cl.rest;
  // The natural "second derivative zero at the ends" clause carries numbers (0): strip it.
  rest = rest.replace(/\bsecond\s+derivatives?\s+(?:is\s+|are\s+|of\s+)?(?:zero|0)\s+at\s+(?:the\s+|both\s+)?ends?/gi, " ").replace(/\bS''\s*=\s*0\b/g, " ");
  const q = extractQueries(rest);
  rest = q.rest;

  const pl = readPointList(rest);
  if (isPointRefusal(pl)) return refuse(title0, pl.refusal);
  if (!pl) {
    return refuse(title0, "Give the knots: `natural cubic spline through (0, 0), (1, 1), (2, 0)` (add `at x = 0.5` for a value); end conditions: `clamped … with S'(0) = 1, S'(2) = -1` or `with end slopes m0 and m1`, `not-a-knot spline through …`; also `linear spline through …` and `pchip …` (monotone). Bare `spline` = natural cubic.");
  }
  const n = pl.xs.length;
  const caveats: string[] = [...pl.notes];
  if (n === 1) return refuse(title0, `One point (${fmtRat(pl.xs[0])}, ${fmtRat(pl.ys[0])}): a curve through a single point is anything at all — give at least two knots.`);
  if (n > MAX_KNOTS) return refuse(title0, `${n} knots: up to ${MAX_KNOTS} here (the exact tridiagonal solve keeps every coefficient printable).`);

  let kind: SplineKind;
  let assumed = false;
  if (kindWords.pchip) kind = "pchip";
  else if (kindWords.linear) kind = "linear";
  else if (kindWords.notAKnot) kind = "not-a-knot";
  else if (kindWords.naturalWord && !kindWords.clampedWord) kind = "natural";
  else if (cl.clamp || kindWords.clampedWord) kind = "clamped";
  else { kind = "natural"; assumed = true; }
  if (kind !== "clamped" && cl.clamp) return refuse(title0, `End slopes were given (${fmtRat(cl.clamp.m0)} and ${fmtRat(cl.clamp.m1)}) but the spline was named ${kind} — a spline with prescribed end slopes is CLAMPED; say which.`);
  if (kind === "clamped" && cl.clamp && cl.clamp.at0 !== null && cl.clamp.at1 !== null) {
    const x0 = pl.xs[0], xn = pl.xs[n - 1];
    let at0: Rat = cl.clamp.at0, at1: Rat = cl.clamp.at1;
    if (ratEq(at0, xn) && ratEq(at1, x0)) { cl.clamp = { m0: cl.clamp.m1, m1: cl.clamp.m0, at0: x0, at1: xn }; at0 = x0; at1 = xn; }
    if (!ratEq(at0, x0) || !ratEq(at1, xn)) return refuse(title0, `Clamped end slopes must be given at the two END knots x = ${fmtRat(x0)} and x = ${fmtRat(xn)}; they were given at x = ${fmtRat(at0)} and x = ${fmtRat(at1)}.`);
  }

  const built = buildSpline(pl.xs, pl.ys, kind, cl.clamp ? { m0: cl.clamp.m0, m1: cl.clamp.m1 } : undefined);
  if (typeof built === "string") return refuse(title0, built);
  const s = built;
  const ver = verifySpline(s);
  if (ver.failures.length) return refuse(title0, `Cross-check FAILED: ${ver.failures.join("; ")} — withheld (please report the knots).`);

  const kindName: Record<SplineKind, string> = { natural: "Natural cubic spline", clamped: "Clamped cubic spline", "not-a-knot": "Not-a-knot cubic spline", linear: "Linear spline", pchip: "PCHIP (monotone piecewise cubic)" };
  const pieces = s.pieces.length;
  const lines: VerbResult["lines"] = [];
  let title: string;

  if (n === 2 && kind !== "clamped") {
    title = `${kindName[kind]} through 2 knots — the chord`;
    const p = s.pieces[0];
    lines.push(line(`A spline through two knots is the chord y = ${pieceString(p)} (whatever the end condition):`));
    lines.push(line(`S(x) = ${pieceString(p)}`, true));
    lines.push(line(`on [${fmtRat(p.x0)}, ${fmtRat(p.x1)}].`));
  } else {
    title = `${kindName[kind]}, ${n} knots, ${pieces} piece${pieces > 1 ? "s" : ""}`;
    if (kind === "natural") {
      lines.push(line(assumed ? "End condition: natural (S'' = 0 at both ends) — say `clamped … with S'(a) = m0, S'(b) = m1` or `not-a-knot` to change it." : "End condition: natural (S'' = 0 at both ends)."));
    } else if (kind === "clamped") {
      lines.push(line(`End condition: clamped — S'(${fmtRat(s.xs[0])}) = ${fmtRat(s.clamp!.m0)}, S'(${fmtRat(s.xs[n - 1])}) = ${fmtRat(s.clamp!.m1)}.`));
    } else if (kind === "not-a-knot") {
      lines.push(line(`End condition: not-a-knot — S''' continuous across x = ${fmtRat(s.xs[1])} and x = ${fmtRat(s.xs[n - 2])}, so the first two and the last two pieces are each one cubic.`));
    } else if (kind === "pchip") {
      lines.push(line("Fritsch–Carlson monotone slopes at the interior knots (zero where the data turn, the weighted harmonic mean of the neighbouring secant slopes otherwise) with MATLAB's pchip end formula (the three-point one-sided estimate, clipped to keep the end monotone) — PCHIP has no single textbook convention, so this is the one used."));
    } else {
      lines.push(line("The broken line through the knots (continuous, with a corner at each interior knot)."));
    }
    if (s.M) lines.push(line(`Second derivatives at the knots: M = (${s.M.map(fmtRat).join(", ")})`));
    if (s.slopes) lines.push(line(`Slopes at the knots: d = (${s.slopes.map(fmtRat).join(", ")})`));
    s.pieces.forEach((p, i) => {
      lines.push(line(`Piece ${i + 1}, on [${fmtRat(p.x0)}, ${fmtRat(p.x1)}]:`));
      lines.push(line(`S(x) = ${pieceString(p)}`, true));
    });
  }

  // Not-a-knot through 4 knots IS the interpolating cubic: cross-check.
  if (kind === "not-a-knot" && n === 4) {
    const ip = interpolatingPolynomial(pl.xs, pl.ys);
    const g = s.pieces.map(pieceGlobal);
    const same = (a: Rat[], b: Rat[]): boolean => Math.max(a.length, b.length) === 0 || [...Array(Math.max(a.length, b.length)).keys()].every((i) => ratEq(a[i] ?? RAT_ZERO, b[i] ?? RAT_ZERO));
    if (!ip || !g.every((c) => same(c, ip.coeffs))) return refuse(title0, "Cross-check FAILED: the not-a-knot spline through 4 knots did not equal the interpolating cubic — withheld.");
    lines.push(line("Not-a-knot with 4 knots IS the interpolating cubic — every piece is the same polynomial:"));
    lines.push(line(`S(x) = ${polyString(ip.coeffs, "x")}`, true));
    caveats.push("Verified: the three pieces expand to the same cubic, and it equals the interpolation engine's polynomial through the 4 points (Vandermonde, Lagrange and Newton agreeing).");
  }

  const query: Mark[] = [];
  for (const qq of q.queries) {
    // The piece is chosen by the point's value; a symbolic point (pi) is then
    // evaluated through the CAS in that piece, kept exact.
    const X = s.pieces.map((p) => ratToNumber(p.x1));
    let idx = 0;
    while (idx < s.pieces.length - 1 && qq.num > X[idx]) idx++;
    const p = s.pieces[idx];
    const sv = evalPolyQuery(p.c, qq, p.local ? p.x0 : null);
    if (!sv.ok) { caveats.push(sv.why); continue; }
    if (qq.v && !ratEq(sv.rat!, pieceEval(p, qq.v))) return refuse(title0, "Cross-check FAILED: the query evaluation disagreed with the piece — withheld.");
    lines.push(line(`S(${sv.label}) = ${sv.exact}`, true));
    lines.push(line(`${!sv.rat || sv.rat.d !== 1n ? `≈ ${sig6(sv.num)} — ` : ""}from piece ${idx + 1} (on [${fmtRat(p.x0)}, ${fmtRat(p.x1)}]).`));
    query.push({ x: qq.num, y: sv.num, label: `S(${sv.label}) = ${sv.exact}` });
    if (qq.num < ratToNumber(s.xs[0]) || qq.num > ratToNumber(s.xs[n - 1])) caveats.push(`x = ${sv.label} is OUTSIDE the knots [${fmtRat(s.xs[0])}, ${fmtRat(s.xs[n - 1])}]: this is EXTRAPOLATION along the end piece — a spline is defined between its knots only; the value is the end cubic continued.`);
  }

  if (kind === "pchip" && s.slopes) {
    // Monotonicity: the Fritsch–Carlson condition per piece, and S' sampled.
    let mono = true;
    const notes: string[] = [];
    s.pieces.forEach((p, i) => {
      const delta = ratDiv(ratSub(s.ys[i + 1], s.ys[i]), ratSub(p.x1, p.x0));
      const d0 = s.slopes![i], d1 = s.slopes![i + 1];
      if (ratIsZero(delta)) {
        if (!ratIsZero(d0) || !ratIsZero(d1)) mono = false;
      } else {
        const al = ratDiv(d0, delta), be = ratDiv(d1, delta);
        if (ratSign(al) < 0 || ratSign(be) < 0 || ratGt(ratAdd(ratMul(al, al), ratMul(be, be)), R(9))) mono = false;
      }
      const lo = ratToNumber(p.x0), hi = ratToNumber(p.x1);
      const sg = ratSign(delta);
      for (let k = 0; k <= 50; k++) {
        const x = lo + ((hi - lo) * k) / 50;
        const u = x - lo;
        const c = p.c.map(ratToNumber);
        let dv = 0;
        for (let j = c.length - 1; j >= 1; j--) dv = dv * u + j * c[j];
        if (sg * dv < -1e-12 || (sg === 0 && Math.abs(dv) > 1e-12)) mono = false;
      }
    });
    if (!mono) notes.push("Monotonicity check did NOT pass on every piece — the slopes above are the stated convention's, but the pieces are not all monotone; please report the knots.");
    else caveats.push("Verified: every piece is monotone in the direction of its data (the Fritsch–Carlson condition α² + β² ≤ 9 holds, and S' keeps the secant's sign at 51 samples per piece).");
    caveats.push(...notes);
  }
  if (kind === "natural" && n > 2) caveats.push("\"Natural\" is a choice, not a property of the data: S'' = 0 at the ends flattens the curve there. If the end slopes are known, a clamped spline is more accurate near the ends.");
  caveats.push(ver.checked);
  return { title, lines, caveats, svg: splineSvg(s, query, title), alt: `${title}: each piece drawn on its own interval, knots marked${kind === "clamped" ? ", end tangents drawn" : ""}${query.length ? `, ${query.map((m) => m.label).join(", ")} marked` : ""}.` };
}
