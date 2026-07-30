// Notation that means two different things, refused rather than guessed at.
//
// `1/2x` has no agreed reading. This product had two, in two parsers:
//
//     solve.ts     1/2x  ->  1/(2*x)      2/2x -> 1/x      2^2x -> 2^(2*x)
//     mathParse.ts 1/2x  ->  (1/2)*x      2/2x -> x        2^2x -> (2^2)*x
//
// Both are defensible. Most computer algebra systems give implicit multiplication
// the same precedence as explicit `*`, which makes `1/2x` equal to `(1/2)x`; a great
// deal of handwritten mathematics and physics reads it as `1/(2x)`; and ISO 80000-1
// recommends never writing it at all. So there is no reading to standardise ON.
//
// Choosing one would have made the other silently wrong for anyone who meant it —
// and "silently wrong" is the thing this codebase spends its time eliminating. The
// two readings of `2/2x` differ by a factor of x squared, which is not a rounding
// difference; it is a different function. So the expression is refused, with both
// readings offered back so the fix is one keystroke.
//
// Usage was checked before deciding: zero occurrences in the shipped examples and
// zero in the manual. Nobody is relying on either reading.

/**
 * The ambiguous shape: a division or power whose right operand is a bare number
 * immediately followed by an implicit multiplication.
 *
 * Matches `1/2x`, `2/2x`, `1/2(x+1)`, `x/2y`, and the spaced forms — a
 * space does not disambiguate anything, and treating `1/2 x` as unambiguous while
 * refusing `1/2x` would just move the trap.
 *
 * Does NOT match anything already explicit or bracketed: `1/(2x)`, `(1/2)x`,
 * `1/2*x`, `1/2`, `x/2`, `1/2 + x`, `sin(x)/2`.
 */
// The left operand may be a number, a name, or a closed bracket — `x/2y` is exactly
// as ambiguous as `1/2x`, and the first version of this only matched digits and
// brackets, so `x/2y` slipped through and kept the two parsers disagreeing about it.
// DIVISION ONLY. The first version also matched `^`, and that was simply wrong:
// an exponent extends to the atom immediately after it and no further, which is not
// a disputed convention — typeset superscripts make it visual. So `r^2 h` is
// unambiguously (r^2)*h, and refusing it broke four SHIPPED formula-library entries
// (volume of a cylinder and cone, power dissipated, two-asset portfolio variance).
//
// Worth recording how that was found: before deciding to refuse, usage was checked in
// examples.ts and the manual and came back zero — but formulaLibrary.ts, which is the
// actual shipped content a user inserts, was not checked. The full test suite caught
// it. A usage survey that misses where the usage lives is not a usage survey.
const AMBIGUOUS = /([A-Za-z0-9).\]])\s*(\/)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z(])/;

/** Reserved words that are not implicit multiplication — `1/2e5` is one number. */
function isExponentForm(numberText: string, next: string, rest: string): boolean {
  // `1/2e5` and `1/2e-5`: the letter belongs to the number, not to a factor.
  if (next !== "e" && next !== "E") return false;
  return /^[eE][+-]?\d/.test(rest);
}

/**
 * A message naming both readings, or null when the text is unambiguous.
 *
 * Returned rather than thrown so each caller can decide how to surface it — the
 * equation parser throws, the pane shows it beside the field.
 */
export function ambiguousImplicitProduct(text: string): string | null {
  const m = AMBIGUOUS.exec(text);
  if (!m) return null;
  const [whole, left, op, num, letter] = m;
  const at = m.index + whole.length - 1;
  if (isExponentForm(num, letter, text.slice(at))) return null;

  const tail = text.slice(at);
  // Take the following factor as far as it plainly runs, for the suggestion.
  const factor = /^[a-zA-Z][a-zA-Z0-9_]*|^\(/.exec(tail)?.[0] ?? letter;
  const shown = `${left}${op}${num}${factor}`;
  const grouped = op === "/" ? `${left}/(${num}${factor})` : `${left}^(${num}${factor})`;
  const separate = op === "/" ? `(${left}/${num})${factor}` : `(${left}^${num})${factor}`;

  return (
    `"${shown}" is ambiguous and this tool will not guess at it. It can be read as ` +
    `${grouped} or as ${separate}, and those are different expressions — for a division the two ` +
    `differ by a factor of ${num}${factor} squared. Most computer algebra systems take the second ` +
    `reading and much handwritten mathematics takes the first, so there is no convention to fall ` +
    `back on. Add brackets: write ${grouped} or ${separate}, whichever you meant.`
  );
}
