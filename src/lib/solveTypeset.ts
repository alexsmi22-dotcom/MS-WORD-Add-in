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
//
// The result feeds mathToHtml (live preview) and mathToOmml (insertion) — the
// same equation the user typed, drawn with the radical sign, stacked
// fractions and real relation glyphs instead of plain-english spellings.

import { normalizeUnicodeMath } from "./solve";
import { parseLimitRequest, parseSeriesRequest } from "./analysis";

/**
 * True when the line is limit/series PROSE (`limit sin(x)/x as x -> 0`,
 * `taylor exp(x) order 5`) rather than an expression. Prose must not be
 * typeset — bridging it draws the keywords as juxtaposed variables
 * ("limitsin(x)xasx→0" presented as mathematics), and validating it with
 * parseExpr calls valid input unreadable.
 */
export function isProseRequest(line: string): boolean {
  try {
    return parseLimitRequest(line) !== null || parseSeriesRequest(line) !== null;
  } catch {
    return false;
  }
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
  // ^(group) → ^{group} so the grouping brackets stay invisible. Handles one
  // level of nesting inside the exponent ((n+1)/2 etc.); deeper nesting falls
  // back to visible brackets, which is displayed-but-ugly rather than wrong.
  s = s.replace(/\^\(((?:[^()]|\([^()]*\))*)\)/g, "^{$1}");
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
