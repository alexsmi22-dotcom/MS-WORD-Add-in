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
//
// Pure: no Office.js, no DOM.

/** Letters, digits (incl. ₀–₉ and ⁰–⁹, which are \p{N}) and underscore: what may not touch a number token. */
const NUMBER_TOKEN = /(?<![\p{L}\p{N}_])(?:NaN|Infinity)(?![\p{L}\p{N}_])/u;
const UNDEFINED_VALUE = /(?:^|[=:±≈<>≤≥])[ \t]*undefined(?:(?=[ \t]*(?:$|[,;)\]]))|(?=[ \t]*(?:[-+−]?\d|[µμ°%‰ΩÅ℃]))|(?=[ \t]+(?:[^\s,;)\]]*[\/·^²³¹⁰⁴-⁹⁻]|(?!(?:at|in|as|if|for|on|by|to|of|or|and|the|is|so|but|yet|due|per|was|are|has|its|it|be|we|not|no|an|a)(?![A-Za-z]))[A-Za-z]{1,3}(?![\p{L}\p{N}_])|[A-Za-z]+[A-Z][A-Za-z]*(?![\p{L}\p{N}_]))))/mu;

/** True when the text prints NaN, Infinity or undefined as a value (see the rule above). */
export function hasBrokenNumber(text: string): boolean {
  const stripped = String(text ?? "").replace(/"[^"\n]*"/g, '""');
  return NUMBER_TOKEN.test(stripped) || UNDEFINED_VALUE.test(stripped);
}

/**
 * May this result text be inserted? Not when empty, not when it carries an em dash (the pane's "not computable"
 * sentinel: formatNum renders a non-finite value as "—"), and not when it prints a broken number.
 */
export function insertableResultText(text: string): boolean {
  return !!text && !text.includes("—") && !hasBrokenNumber(text);
}
