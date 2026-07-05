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

// Greek letters by name → Unicode. Matched on word boundaries so a variable
// like "beta1" is untouched. "pi" is handled below (kept for back-compat).
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
  rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
const GREEK_RE = new RegExp("\\b(" + Object.keys(GREEK).join("|") + ")\\b", "g");

/** Symbol replacements applied before parsing. Order matters: multi-char first. */
function normalizeSymbols(input: string): string {
  let s = input
    .replace(/sqrt\s*\(/g, "√(")
    // Arrows & double relations — longer combos before their prefixes.
    .replace(/<=>/g, "⇔")
    .replace(/<->/g, "↔")
    .replace(/=>/g, "⇒")
    .replace(/<-/g, "←")
    .replace(/->/g, "→")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/~=/g, "≈")
    .replace(/\+-/g, "±")
    .replace(/-\+/g, "∓");
  // Named operators & symbols.
  s = s
    .replace(/\bsum\b/g, "∑")
    .replace(/\bint\b/g, "∫")
    .replace(/\bprod\b/g, "∏")
    .replace(/\bpartial\b/g, "∂")
    .replace(/\b(?:nabla|grad)\b/g, "∇")
    .replace(/\bapprox\b/g, "≈")
    .replace(/\bpropto\b/g, "∝")
    .replace(/\btimes\b/g, "×")
    .replace(/\bcdot\b/g, "·")
    .replace(/\bforall\b/g, "∀")
    .replace(/\bexists\b/g, "∃")
    .replace(/\bpi\b/g, "π")
    .replace(/\binf(?:inity)?\b/g, "∞");
  // Greek letters, then the remaining multiplication star.
  s = s.replace(GREEK_RE, (_m, name: string) => GREEK[name]);
  return s.replace(/\*/g, "·");
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
