// Parses a simple math expression into formatted segments.
//
// This handles inline "linear" math notation and renders it with real
// subscripts/superscripts plus a few common symbol substitutions:
//   x^2          -> x²
//   a_n          -> aₙ
//   e^{i*pi}     -> e^(i·π) as a superscript group  (braces group multi-char)
//   x^{n+1}      -> x raised to the whole group n+1
//   sqrt(x)      -> √(x)
//   a*b          -> a·b      ( * becomes a middle dot )
//   <=, >=, !=   -> ≤, ≥, ≠
//   pi, ->       -> π, →
//
// Note: this produces inline formatting (sub/superscript runs), not a native
// Word equation object. Stacked fractions, radicals over content, matrices,
// etc. need OOXML/OMML insertion, which is a planned enhancement (see README).

import { Segment, pushSegment } from "./segments";

/** Symbol replacements applied before parsing. Order matters: multi-char first. */
function normalizeSymbols(input: string): string {
  return input
    .replace(/sqrt\s*\(/g, "√(")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/->/g, "→")
    .replace(/\bpi\b/g, "π")
    .replace(/\binf(inity)?\b/g, "∞")
    .replace(/\*/g, "·")
    .replace(/\+-/g, "±");
}

export function parseMath(input: string): Segment[] {
  const s = normalizeSymbols(input);
  const segments: Segment[] = [];
  let i = 0;
  const n = s.length;

  while (i < n) {
    const ch = s[i];

    if (ch === "^" || ch === "_") {
      const type = ch === "^" ? "sup" : "sub";
      i++;
      let value = "";
      if (s[i] === "{") {
        // Braced group: everything up to the matching close brace.
        i++;
        while (i < n && s[i] !== "}") value += s[i++];
        i++; // consume the closing brace
      } else if (i < n) {
        // Single following character.
        value += s[i++];
      }
      pushSegment(segments, value, type);
      continue;
    }

    pushSegment(segments, ch, "normal");
    i++;
  }

  return segments;
}
