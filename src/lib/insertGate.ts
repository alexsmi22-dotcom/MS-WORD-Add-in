// THE INSERT GATE: the one rule for "this result text carries a broken number and must not reach the document".
//
// Release D moved it here from taskpane.ts (insertableResultText), where it was `text.includes("NaN")` and
// `text.includes("Infinity")`. A substring test cannot tell a JavaScript NaN from sodium azide: an assay result
// naming its NaN₃ standard (or NaNO₃, NaNH₂, a sample called "NaN3") was uninsertable. The QC drivers
// (scripts/engineering-audit-driver.js, scripts/pane-audit-driver.js badNumbers) carry a JavaScript copy of
// hasBrokenNumber with the IDENTICAL rule; src/lib/__tests__/insertGateD.test.ts runs one table against all three.
//
// THE RULE (hasBrokenNumber), applied after every straight-double-quoted span ON ONE LINE is blanked (a tool that
// QUOTES an input back, `rejected "NaN" as a width`, is naming the input, not printing a value; a stray quote on one
// line never hides a NaN on another):
//   NaN, Infinity  are broken numbers only as a NUMBER TOKEN: not preceded by a letter, digit or underscore, and not
//                  followed by a letter, digit or underscore. Digits include subscript and superscript digits, so
//                  "NaN₃", "NaN3", "2NaN₃", "NaNO₃" and "NaNs" are words; "x = NaN", "mean NaN µM", "−Infinity",
//                  "Infinity" are numbers.
//   undefined      is an English word as well as a JavaScript value, and ok results use it as one ("the friction
//                  factor is undefined at zero flow", "Huynh–Feldt: undefined at this sample size"). It is a broken
//                  value only in a VALUE position (at a line start, or right after =, :, ±, ≈, <, >, ≤ or ≥) AND only
//                  when it ENDS the value: followed by the end of the line, by , ; ) or ], or by a number or a
//                  unit-symbol token ("x = undefined", "mean: undefined µM", "Result: undefined m"). Followed by
//                  ordinary words or by an explanation in parentheses it is a sentence ("λ = undefined (∇g = 0 …)",
//                  "mean = undefined (df ≤ 1)", "Huynh–Feldt: undefined at this sample size").
//                  A unit-symbol token: a number; a token starting with µ μ ° % ‰ Ω Å ℃; one carrying / · ^, a
//                  superscript or ⁻; an ASCII-letter token of 1–3 letters that is not a common short English word
//                  (m, mL, kPa, mol); or a letter token with an inner capital (mmHg). Not caught: "mean undefined µM"
//                  (no value position) and long lower-case units ("undefined kcal").
//   not finite     the formatters' word for a non-finite value: broken wherever it stands as a phrase (any case;
//                  not inside a longer word). See NOT_FINITE_WORDS.
//
// Pure: no Office.js, no DOM.

/** Letters, digits (incl. ₀–₉ and ⁰–⁹, which are \p{N}) and underscore: what may not touch a number token. */
const NUMBER_TOKEN = /(?<![\p{L}\p{N}_])(?:NaN|Infinity)(?![\p{L}\p{N}_])/u;
const UNDEFINED_VALUE = /(?:^|[=:±≈<>≤≥])[ \t]*undefined(?:(?=[ \t]*(?:$|[,;)\]]))|(?=[ \t]*(?:[-+−]?\d|[µμ°%‰ΩÅ℃]))|(?=[ \t]+(?:[^\s,;)\]]*[\/·^²³¹⁰⁴-⁹⁻]|(?!(?:at|in|as|if|for|on|by|to|of|or|and|the|is|so|but|yet|due|per|was|are|has|its|it|be|we|not|no|an|a)(?![A-Za-z]))[A-Za-z]{1,3}(?![\p{L}\p{N}_])|[A-Za-z]+[A-Z][A-Za-z]*(?![\p{L}\p{N}_]))))/mu;

/**
 * "not finite" is what the number formatters (the pane's engNum, gasDynamicsCalcs num, vesselsCalcs num, ...) print
 * for a non-finite value: blocked ANYWHERE in an ok result (fix round eng-9). It has no value-position test because
 * engNum's callers print it bare ("Range at that angle not finite m") and inside copulas ("the range is not finite m");
 * an ok result that merely says something is not finite is refused insertion, which errs on the safe side.
 */
const NOT_FINITE_WORDS = /(?<![\p{L}\p{N}_])not finite(?![\p{L}\p{N}_])/iu;

/** True when the text prints NaN, Infinity, undefined or "not finite" as a value (see the rule above). */
export function hasBrokenNumber(text: string): boolean {
  const stripped = String(text ?? "").replace(/"[^"\n]*"/g, '""');
  return NUMBER_TOKEN.test(stripped) || UNDEFINED_VALUE.test(stripped) || NOT_FINITE_WORDS.test(stripped);
}

/**
 * May this result text be inserted? Not when empty, not when it carries an em dash (the pane's "not computable"
 * sentinel: formatNum renders a non-finite value as "—"), and not when it prints a broken number.
 */
export function insertableResultText(text: string): boolean {
  return !!text && !text.includes("—") && !hasBrokenNumber(text);
}

/**
 * Every matrix block's entries are finite (v2.193.0). A matrix block is inserted as a Word table from its NUMBERS, not
 * from the result text, so the text gate above never sees a non-finite entry when the text does not print the matrix:
 * the table would go in with "—" cells. Blocks of other kinds pass.
 */
export function matrixBlocksFinite(blocks: ReadonlyArray<{ kind: string; m?: ReadonlyArray<ReadonlyArray<number>> }> | null | undefined): boolean {
  if (!blocks) return true;
  return blocks.every((b) => b.kind !== "matrix" || !b.m || b.m.every((r) => r.every((v) => Number.isFinite(v))));
}
