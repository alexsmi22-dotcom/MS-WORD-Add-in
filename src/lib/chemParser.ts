// Parses a chemical formula string into formatted segments.
//
// Supported input conventions:
//   H2O          -> H, ₂, O            (digits after elements/parens are subscripts)
//   Ca(OH)2      -> Ca(OH)₂
//   H2SO4        -> H₂SO₄
//   2H2O         -> 2 H₂O              (a leading number is a coefficient: normal size)
//   CuSO4·5H2O   -> CuSO₄·5H₂O         (so is a number after a hydrate dot · • . *,
//   CaSO4·0.5H2O -> CaSO₄·0.5H₂O        including a decimal or a/b coefficient)
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

// REACTION SEPARATORS. A whitespace-delimited "+" separates species, and an
// arrow separates the sides; neither is a charge. Typing "Fe + O2 -> Fe2O3" in
// Chemical mode used to insert "Fe ⁺ O₂ ⁻>" into the document. Arrows print as
// → / ⇌ (the forms Reaction mode and the balancer read back); "=" and the other
// arrow glyphs print as typed.
const SEPARATORS: Record<string, string> = {
  "+": "+", "->": "→", "-->": "→", "→": "→", "⟶": "→", "<-": "←", "←": "←",
  "<->": "⇌", "<=>": "⇌", "⇌": "⇌", "⇋": "⇋", "=": "=",
};

export function parseChemical(input: string): Segment[] {
  const segments: Segment[] = [];
  // Each whitespace-delimited token is a species (parsed on its own, so the
  // monatomic-ion rule applies per species: Mn2+ inside a reaction is Mn²⁺) or a
  // separator (normal size). Whitespace itself is normal text, so a digit run at
  // the start of a species still follows a space and stays a full-size
  // coefficient.
  for (const piece of input.split(/(\s+)/)) {
    if (!piece) continue;
    if (/^\s+$/.test(piece)) pushSegment(segments, piece, "normal");
    else if (Object.prototype.hasOwnProperty.call(SEPARATORS, piece)) pushSegment(segments, SEPARATORS[piece], "normal");
    else parseSpeciesInto(segments, piece);
  }
  return segments;
}

/**
 * A charge sign as typeset: the TRUE MINUS (U+2212) for a negative charge, never the ASCII hyphen (display contract:
 * Cl⁻ is "Cl" + superscript "−"). Input accepts either.
 */
const MINUS = "−";
const signOf = (ch: string): string => (ch === "-" || ch === MINUS ? MINUS : ch);
const isSign = (ch: string | undefined): boolean => ch === "+" || ch === "-" || ch === MINUS;

function parseSpeciesInto(segments: Segment[], input: string): void {
  let i = 0;
  const n = input.length;
  // A monatomic ion ("Ca2+", "Fe3+") renders the digit as the charge; polyatomic
  // ions ("NH4+", "NO3-") keep the digit as a subscript with a separate ± charge.
  // A leading coefficient does not change that (2Cr3+ in a reaction is 2 Cr³⁺).
  // A monatomic charge is ONE digit: "Hg22+" is the dimercury(I) ion Hg₂²⁺ and "O22-" peroxide O₂²⁻ — the count
  // and then a one-digit charge — never a +22 charge. A trailing 0 is never a charge (C60- is C₆₀⁻).
  const isMonatomic = /^\d*[A-Z][a-z]?[1-9][+\-−]$/.test(input);
  const homonuclear = /^\d*[A-Z][a-z]?\d+[1-9][+\-−]$/.test(input);

  while (i < n) {
    const ch = input[i];

    // An arrow inside an unspaced token ("Fe2O3->2Fe") is still an arrow: a "-"
    // followed by ">" is never a charge.
    const arrow = /^(<->|<=>|-->|->|<-)/.exec(input.slice(i));
    if (arrow) {
      pushSegment(segments, SEPARATORS[arrow[1]], "normal");
      i += arrow[1].length;
      continue;
    }

    // Explicit charge marker: ^ followed by optional digits and an optional sign.
    if (ch === "^") {
      i++;
      let charge = "";
      while (i < n && isDigit(input[i])) charge += input[i++];
      if (i < n && isSign(input[i])) charge += signOf(input[i++]);
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
      const nextIsSign = i < n && isSign(input[i]);
      const prevChar = input[startIdx - 1] ?? "";
      const afterGroup = prevChar === ")" || prevChar === "]" || prevChar === "}";
      // A digit run before a sign is the ion charge only for a group charge
      // ([Fe(CN)6]3-) or a monatomic ion (Ca2+); otherwise the digit is a
      // subscript and the following sign is a separate ± charge (NH4+ → NH₄⁺).
      if (nextIsSign && (afterGroup || isMonatomic)) {
        pushSegment(segments, num + signOf(input[i++]), "sup");
        continue;
      }
      // One element, a count and a one-digit charge: Hg22+ → Hg₂²⁺, O22- → O₂²⁻.
      if (nextIsSign && homonuclear && startIdx > 0 && /[A-Za-z]/.test(prevChar) && num.length >= 2 && Number(num.slice(0, -1)) >= 2) {
        pushSegment(segments, num.slice(0, -1), "sub");
        pushSegment(segments, num.slice(-1) + signOf(input[i++]), "sup");
        continue;
      }
      const prev = segments[segments.length - 1];
      // A digit run right after a hydrate dot (·, •, ., *) is the hydrate's
      // COEFFICIENT and is full size: CuSO₄·5H₂O, never CuSO₄·₅H₂O. So is the
      // rest of a decimal or fractional coefficient — the 5 in "·0.5H2O" follows
      // a ".", and the 2 in "·1/2H2O" follows a "/". The typeset form must
      // re-parse (display contract), and validateFormula reads it this way.
      // A digit right after an arrow (unspaced "->2Fe") is a coefficient too.
      const isCoefficient = !prev || /[\s·•.*/→⇌←]$/.test(prev.text);
      // A decimal SUBSCRIPT (Cu1.8S → Cu₁.₈S): a count of 0 or 1 right after an
      // element or group, then "." and digits — the same reading as
      // validateFormula, where "CuSO4.5H2O" (count 4) stays a hydrate dot.
      if (!isCoefficient && (num === "0" || num === "1") && /[A-Za-z)\]}]/.test(prevChar) &&
          input[i] === "." && isDigit(input[i + 1] ?? "")) {
        num += input[i++];
        while (i < n && isDigit(input[i])) num += input[i++];
      }
      pushSegment(segments, num, isCoefficient ? "normal" : "sub");
      continue;
    }

    // A standalone trailing sign (e.g. Na+, Cl-, Cl−) is a charge -> superscript (a true minus).
    if (isSign(ch)) {
      pushSegment(segments, signOf(ch), "sup");
      i++;
      continue;
    }

    // Everything else (element letters, parentheses, brackets, spaces, hydrate
    // dots) is rendered at normal size.
    pushSegment(segments, ch, "normal");
    i++;
  }
}
