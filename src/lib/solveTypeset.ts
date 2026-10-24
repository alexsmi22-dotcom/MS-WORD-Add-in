// Draws a Solve-grammar expression as real mathematics.
//
// Solve's parser (solve.ts parseExpr) and the typesetting grammar
// (mathParse.ts) are DIFFERENT languages that happen to share most of their
// surface. The two places they disagree are exactly the forms the Solve
// composer produces:
//
//   ^(n+1)  — Solve's normalizer brackets every superscript; mathParse would
//             faithfully typeset the brackets INTO the exponent. Braces are
//             mathParse's invisible grouping, so ^(…) becomes ^{…}.
//   √(x+1)  — Solve folds √ itself (expandRadicals); mathParse has no √ glyph
//             in its grammar. Routing through normalizeUnicodeMath first
//             turns every Solve-only glyph (√ ² π ∞ × ÷ −) into a spelling
//             both grammars read.
//   cbrt(u) — Solve's cube root (the exact cubic roots of v2.136.0 print it);
//             mathParse knows only root(n, x), so cbrt(u) becomes root(3, u)
//             and a fourth root c^(1/4) becomes root(4, c).
//
// The result feeds mathToHtml (live preview) and mathToOmml (insertion) — the
// same equation the user typed, drawn with the radical sign, stacked
// fractions and real relation glyphs instead of plain-english spellings.

import { normalizeUnicodeMath } from "./solve";
import { parseLimitRequest, parseSeriesRequest } from "./analysis";
import { parseRadiusRequest, radiusOfFunction } from "./radius";

/**
 * True when the line is limit/series PROSE (`limit sin(x)/x as x -> 0`,
 * `taylor exp(x) order 5`, `radius of convergence of 1/(1-x)`) rather than an
 * expression. Prose must not be typeset — bridging it draws the keywords as
 * juxtaposed variables ("limitsin(x)xasx→0" presented as mathematics), and
 * validating it with parseExpr calls valid input unreadable.
 */
export function isProseRequest(line: string): boolean {
  try {
    return parseLimitRequest(line) !== null || parseSeriesRequest(line) !== null || parseRadiusRequest(line) !== null;
  } catch {
    return false;
  }
}

/**
 * The equation kind's SERIES / RADIUS switch (v2.136.0): "taylor 1/(1-x)",
 * "taylor series of f", "radius of convergence of f", "interval of
 * convergence of sum a_n". `text` is the task-normalised input. A series
 * request whose expression carries "=" ("series = 5") is an equation in a
 * variable named series, and stays where it is.
 */
export function isSeriesOrRadiusRequest(text: string): boolean {
  try {
    if (parseRadiusRequest(text)) return true;
    const ser = parseSeriesRequest(text);
    return !!ser && !/[=<>≤≥≠]/.test(ser.expr);
  } catch {
    return false;
  }
}

/**
 * What the pane says when taylorSeries returns null (v2.136.0). `taylor abs(x)`
 * printed a generic "Couldn't expand" — the radius engine knows WHY (abs is not
 * analytic; the centre of ln(x) at 0 is a branch point; 1/x has a pole there),
 * so the reason is given by name. A table miss ("outside the singularity
 * table") is about the radius, not the expansion, and keeps the generic line.
 */
export function seriesFailureMessage(expr: string, variable: string, centre: number): string {
  const generic = "Couldn't expand that as a series — check it is differentiable at the centre. Try: taylor exp(x) order 5";
  try {
    const r = radiusOfFunction(expr, variable, centre);
    if (r.kind === "refused" && r.reason && !/outside the singularity table|did not parse|longer than|nests deeper/.test(r.reason)) {
      return `Couldn't expand ${expr} as a Taylor series about ${variable} = ${centre}: ${r.reason}`;
    }
  } catch {
    /* fall through to the generic line */
  }
  return generic;
}

/** Index of the ")" closing the "(" at `open`, or -1. */
function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === "(") depth++;
    else if (s[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

/** cbrt(u) → root(3, u), balanced-paren aware (cbrt(5/2 + sqrt(1929)/18)). */
function cbrtToRoot(s: string): string {
  let out = "";
  let i = 0;
  const re = /\bcbrt\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(s, open);
    if (close < 0) break;
    out += s.slice(i, m.index) + `root(3, ${cbrtToRoot(s.slice(open + 1, close))})`;
    i = close + 1;
    re.lastIndex = i;
  }
  return out + s.slice(i);
}

/**
 * One Solve-grammar line → a mathParse-DSL line ready to typeset.
 * Never throws — the caller decides what to do with an untypesettable line
 * (mathToHtml itself throws on genuine nonsense, which callers catch).
 */
export function solveToTypesetDsl(line: string): string {
  let s = normalizeUnicodeMath(line);
  // Relation glyphs → the ASCII spellings mathParse folds back into glyphs
  // itself; feeding the raw characters would depend on its tokenizer treating
  // them as text, which is not a contract either grammar makes.
  s = s.replace(/≤/g, " <= ").replace(/≥/g, " >= ").replace(/≠/g, " != ");
  // Radicals BEFORE the exponent rewrite below, which would otherwise turn
  // 2^(1/4) into the exponent 2^{1/4}: cbrt(u) → root(3, u) and a number or
  // name to the 1/4 → root(4, c). Only the positive-base forms the exact root
  // engine prints (it never writes (neg)^(1/4)).
  s = cbrtToRoot(s);
  s = s.replace(/(^|[^A-Za-z0-9_.)])(\d+(?:\.\d+)?|[A-Za-z]\w*)\s*\^\s*\(\s*1\s*\/\s*4\s*\)/g, "$1root(4, $2)");
  // ^(group) → ^{group} so the grouping brackets stay invisible. Handles one
  // level of nesting inside the exponent ((n+1)/2 etc.); deeper nesting falls
  // back to visible brackets, which is displayed-but-ugly rather than wrong.
  s = s.replace(/\^\(((?:[^()]|\([^()]*\))*)\)/g, "^{$1}");
  // E-notation never reaches a typeset line: 1.70463116806e-11 → 1.70463116806×10^{-11}.
  s = s.replace(/(^|[^A-Za-z0-9_.])(\d+(?:\.\d+)?)[eE]([+-]?)(\d+)(?!\d|\.\d|[A-Za-z_])/g, (_w, pre: string, m: string, sg: string, ex: string) =>
    `${pre}${m}×10^{${sg === "-" ? "-" : ""}${Number(ex)}}`);
  // Solve's normalizer writes subscripts as _1; mathParse reads those as-is.
  // Whitespace implicit multiplication is shared by both grammars.
  return s.replace(/\s+/g, " ").trim();
}

/**
 * A whole Solve input (possibly a multi-line system) → one typeset DSL line
 * per input line, blank lines dropped.
 */
export function solveInputToTypesetLines(input: string): string[] {
  return input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(solveToTypesetDsl);
}

const SCI_SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

/**
 * A number as the pane prints it: up to `sig` significant digits, no trailing zeros, and NEVER e-notation — a
 * magnitude past what plain digits carry is written m×10ⁿ (5.22×10⁻⁷, 2.1408763×10²⁹⁸; review 2026-10-24).
 * Non-finite values are the caller's to refuse; NaN comes back as an em dash (the insert gate blocks it), never "NaN".
 */
/**
 * sciDisplay for a TYPESET line: the same digits, with the exponent in mathParse grammar (m×10^{n}). Superscript
 * glyphs are display text — mathToOmml rejects "×10²⁹⁸" and the insert fell back to raw text.
 */
export function sciMath(v: number, sig = 8): string {
  const s = sciDisplay(v, sig);
  return s.replace(/×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/, (_w, sup: string) => {
    const back: Record<string, string> = Object.fromEntries(Object.entries(SCI_SUP).map(([k, g]) => [g, k]));
    return `×10^{${[...sup].map((c) => back[c]).join("")}}`;
  });
}

/** Every e-notation number in a display line written m×10ⁿ (a root "7.50194007667e+64" → "7.50194007667×10⁶⁴"). */
export function eNotationToText(s: string): string {
  const sup = (sg: string, ex: string): string => [...((sg === "-" ? "-" : "") + String(Number(ex)))].map((c) => SCI_SUP[c]).join("");
  return s
    .replace(/(^|[^A-Za-z0-9_.])(-?\d+(?:\.\d+)?)[eE]([+-]?)(\d+)(?!\d|\.\d|[A-Za-z_])/g, (_w, pre: string, m: string, sg: string, ex: string) =>
      Number(ex) === 0 ? `${pre}${m}` : `${pre}${m}×10${sup(sg, ex)}`)
    // The work lines' re-parseable m*10^(n) form, shown as prose.
    .replace(/(\d)\*10\^\((-?)(\d+)\)/g, (_w, d: string, sg: string, ex: string) => `${d}×10${sup(sg, ex)}`);
}

export function sciDisplay(v: number, sig = 8): string {
  if (Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  const s = String(Number(v.toPrecision(sig)));
  const m = /^(-?\d+(?:\.\d+)?)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  return `${m[1]}×10${[...((m[2] === "-" ? "-" : "") + m[3])].map((c) => SCI_SUP[c]).join("")}`;
}
