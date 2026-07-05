// Parses a chemical formula string into formatted segments.
//
// Supported input conventions:
//   H2O          -> H, ₂, O            (digits after elements/parens are subscripts)
//   Ca(OH)2      -> Ca(OH)₂
//   H2SO4        -> H₂SO₄
//   2H2O         -> 2 H₂O              (a leading number is a coefficient: normal size)
//   SO4^2-       -> SO₄ then ²⁻        (^ introduces a superscript charge)
//   Fe^3+        -> Fe then ³⁺
//   Na+ / Cl-    -> Na⁺ / Cl⁻          (a trailing +/- is a superscript charge)
//   Ca2+         -> Ca then ²⁺          (a digit run before a sign is a charge)
//   [Fe(CN)6]3-  -> [Fe(CN)₆] then ³⁻   (subscript count, then a charge)
//
// This module only decides what renders normal / subscript / superscript. To
// check that a formula is chemically well-formed — real element symbols,
// balanced brackets, atom counts, charge, and molecular weight — use
// validateFormula() in ./chemValidate.

import { Segment, pushSegment } from "./segments";

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

export function parseChemical(input: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  const n = input.length;
  // A monatomic ion ("Ca2+", "Fe3+") renders the digit as the charge; polyatomic
  // ions ("NH4+", "NO3-") keep the digit as a subscript with a separate ± charge.
  const isMonatomic = /^[A-Z][a-z]?\d+[+-]$/.test(input);

  while (i < n) {
    const ch = input[i];

    // Explicit charge marker: ^ followed by optional digits and an optional sign.
    if (ch === "^") {
      i++;
      let charge = "";
      while (i < n && isDigit(input[i])) charge += input[i++];
      if (i < n && (input[i] === "+" || input[i] === "-")) charge += input[i++];
      pushSegment(segments, charge, "sup");
      continue;
    }

    // A run of digits. At the very start of the string (or right after a space)
    // it is a stoichiometric coefficient and stays normal size; otherwise it is
    // a subscript count belonging to the preceding element or group.
    if (isDigit(ch)) {
      const startIdx = i;
      let num = "";
      while (i < n && isDigit(input[i])) num += input[i++];
      const nextIsSign = i < n && (input[i] === "+" || input[i] === "-");
      const prevChar = input[startIdx - 1] ?? "";
      const afterGroup = prevChar === ")" || prevChar === "]" || prevChar === "}";
      // A digit run before a sign is the ion charge only for a group charge
      // ([Fe(CN)6]3-) or a monatomic ion (Ca2+); otherwise the digit is a
      // subscript and the following sign is a separate ± charge (NH4+ → NH₄⁺).
      if (nextIsSign && (afterGroup || isMonatomic)) {
        pushSegment(segments, num + input[i++], "sup");
        continue;
      }
      const prev = segments[segments.length - 1];
      const isCoefficient = !prev || prev.text.endsWith(" ");
      pushSegment(segments, num, isCoefficient ? "normal" : "sub");
      continue;
    }

    // A standalone trailing sign (e.g. Na+, Cl-) is a charge -> superscript.
    if (ch === "+" || ch === "-") {
      pushSegment(segments, ch, "sup");
      i++;
      continue;
    }

    // Everything else (element letters, parentheses, brackets, spaces, hydrate
    // dots) is rendered at normal size.
    pushSegment(segments, ch, "normal");
    i++;
  }

  return segments;
}
