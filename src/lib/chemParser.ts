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
//
// This is intentionally a pragmatic parser, not a full chemistry validator. It
// does not check that element symbols are real — it only decides what should be
// rendered normal, as a subscript, or as a superscript.

import { Segment, pushSegment } from "./segments";

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

export function parseChemical(input: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  const n = input.length;

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
      let num = "";
      while (i < n && isDigit(input[i])) num += input[i++];
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
