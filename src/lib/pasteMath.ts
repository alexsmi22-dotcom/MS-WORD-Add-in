// Paste tolerance for Solve: equations copied from papers, Word documents and
// web pages arrive full of characters that LOOK like plain maths and are not —
// math-italic letters (𝑥, U+1D465, what a rendered equation copies as), Greek
// variables (θ, λ), the fraction slash ⁄, invisible multiplication characters,
// LaTeX commands. The parser rightly rejects them; this module folds them into
// the Solve grammar FIRST, and reports every transformation it made, so the
// user sees what was read rather than a bare "could not parse".
//
// The honesty rule: fold only what has one faithful reading. π-variants fold
// to pi; θ folds to the variable `theta` (which the engines solve for
// symbolically, and the typesetter draws back as θ). What has NO single
// faithful reading — ±, ∂, number-set symbols — is left in place with a note
// naming it, so the parse error points at the real problem instead of a
// silent guess.

import { latexToDsl } from "./latex";
import { parseExpr } from "./solve";

export interface FoldedMath {
  text: string;
  /** Human-readable notes on what was transformed or needs the user's hand. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF): styled A–Z/a–z runs,
// styled Greek runs, styled digit runs. Folding is codepoint arithmetic, so
// every style (bold, italic, script, fraktur, double-struck, sans, mono) maps
// without a 700-entry table.

const LATIN_RUNS_END = 0x1d6a3; // last styled Latin letter (mono z)
const GREEK_RUNS_START = 0x1d6a8;
// The 5 × 58 Greek runs end at U+1D7C9; U+1D7CA/CB are BOLD DIGAMMA, which the
// run arithmetic would silently misread as Alpha/Beta — exactly the forbidden
// guess (adversarial finding, value-pinned in the tests).
const GREEK_RUNS_END = 0x1d7c9;
const DIGIT_RUNS_START = 0x1d7ce;

// One styled Greek run is 58 codepoints laid out identically in every style.
const GREEK_RUN = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ∇αβγδεζηθικλμνξοπρςστυφχψω∂ϵϑϰϕϱϖ";

/** Letterlike symbols that live OUTSIDE the block (the block leaves holes for them). */
const LETTERLIKE: Record<string, string> = {
  "ℎ": "h",
  "ℏ": "h", // ħ-bar loses its bar — noted below when it appears
  "ℯ": "e",
  "ℊ": "g",
  "ℴ": "o",
  "ℓ": "l",
};

/** Greek character → the identifier name the engines solve for. */
const GREEK_NAMES: Record<string, string> = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "epsilon",
  ϵ: "epsilon",
  ζ: "zeta",
  η: "eta",
  θ: "theta",
  ϑ: "theta",
  ι: "iota",
  κ: "kappa",
  ϰ: "kappa",
  λ: "lambda",
  μ: "mu",
  µ: "mu", // U+00B5 MICRO SIGN
  ν: "nu",
  ξ: "xi",
  ο: "o",
  ρ: "rho",
  ϱ: "rho",
  ς: "sigma",
  σ: "sigma",
  τ: "tau",
  υ: "upsilon",
  φ: "phi",
  ϕ: "phi",
  χ: "chi",
  ψ: "psi",
  ω: "omega",
  ϖ: "pi",
  Γ: "Gamma",
  Δ: "Delta",
  Θ: "Theta",
  Λ: "Lambda",
  Ξ: "Xi",
  Υ: "Upsilon",
  Φ: "Phi",
  Ψ: "Psi",
  Ω: "Omega",
  ϴ: "Theta",
};
// π itself is folded by solve.ts's own normalizer; Π and Σ are big operators
// (product/sum) at least as often as variables, so they are NOTED, not guessed.

/** One styled math-alphanumeric codepoint → its base character, or null. */
function foldMathChar(cp: number): string | null {
  if (cp < 0x1d400 || cp > 0x1d7ff) return null;
  if (cp <= LATIN_RUNS_END) {
    const off = (cp - 0x1d400) % 52;
    return String.fromCharCode(off < 26 ? 65 + off : 97 + (off - 26));
  }
  if (cp >= GREEK_RUNS_START && cp <= GREEK_RUNS_END) {
    const off = (cp - GREEK_RUNS_START) % 58;
    return [...GREEK_RUN][off] ?? null;
  }
  if (cp >= DIGIT_RUNS_START) {
    return String.fromCharCode(48 + ((cp - DIGIT_RUNS_START) % 10));
  }
  return null; // the reserved gap between Latin and Greek runs
}

/** Characters with no single faithful reading — named, never guessed. */
const NAMED_UNREADABLE: Record<string, string> = {
  "±": "± means two expressions (+ and −) — solve each sign separately",
  "∓": "∓ means two expressions — solve each sign separately",
  "∂": "∂ (partial derivative) isn't solvable notation here — use the Differentiate kind",
  "∇": "∇ has no reading here",
  "∑": "Σ-sum notation isn't solvable here",
  "∏": "Π-product notation isn't solvable here",
  "∫": "∫ belongs to the Integral kind — put the integrand there with its limits",
  "ℝ": "ℝ is a number set, not a variable",
  "ℤ": "ℤ is a number set, not a variable",
  "ℕ": "ℕ is a number set, not a variable",
  "ℚ": "ℚ is a number set, not a variable",
  "ℂ": "ℂ is a number set, not a variable",
  "°": "° (degrees) — write the angle in radians (e.g. pi/6) instead",
  "′": "′ (prime) has no reading here",
  "″": "″ in an equation has no reading here",
};

/** Does the text look like LaTeX rather than plain notation? Backslash
 *  commands, $-delimiters, or brace-scripts (x^{2} — Word's linear format and
 *  LaTeX both write them; the Solve grammar never does). */
export function looksLikeLatex(s: string): boolean {
  return /\\[a-zA-Z]+/.test(s) || /\\[{}[\]]/.test(s) || /[\^_]\{/.test(s) || /^\s*\$/.test(s);
}

/**
 * mathParse-DSL output of latexToDsl → Solve grammar: braces are invisible
 * grouping there but nothing in the Solve grammar, so ^{…} and _{…} become
 * ^(…) and plain subscripts, innermost-first for nesting.
 */
function dslToSolveGrammar(s: string): string {
  let out = s;
  for (let i = 0; i < 10; i++) {
    const next = out
      .replace(/\^\{([^{}]*)\}/g, "^($1)")
      .replace(/_\{([^{}]*)\}/g, "_$1")
      .replace(/\{([^{}]*)\}/g, "($1)");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** mathParse-only constructs the Solve engines cannot solve, named honestly. */
const DSL_ONLY = /\b(sum|prod|int|lim|matrix|pmatrix|bmatrix|vmatrix|cases|bar|hat|vec)\s*\(/;

export interface FoldOptions {
  /** Geometry inputs READ ′/″ as feet/inches and angles as degrees — the
   *  equation-kind advice about those characters would be actively wrong. */
  geometry?: boolean;
  /** Reassemble a rendered stacked fraction copied as separate lines
   *  ("3 ⏎ x+3 ⏎ =8" → (3)/(x+3) = 8). Equation-shaped kinds only — a
   *  topology point cloud or simplex list is ALSO multi-line, and must
   *  never be folded into a fraction. */
  stackedFractions?: boolean;
  /** Extract equation lines out of a pasted problem statement, dropping the
   *  prose around them. Equation kind only. */
  extractFromProse?: boolean;
}

/** Textbook framing that glues onto an equation line and would otherwise
 *  parse as variables ("Let y" is the implicit product Let·y). */
const FRAMING =
  /^(?:let|if|then|where|given(?:\s+that)?|and(?:\s+also)?|so|thus|hence|therefore|suppose|assume|note\s+that|we\s+have)\b[,:]?\s*/i;

/**
 * Classifies a line for extraction, returning the line to KEEP (framing
 * words stripped) or null for prose.
 *
 * A comparison-shaped line whose side REFUSES to parse is kept, not dropped:
 * the refusal may be a deliberate, named one (the 1/2x ambiguity gate), and
 * deleting the line would silently convert a helpful error into a confident
 * solve of the leftover equations — the exact dishonesty this module bans.
 */
function equationLine(raw: string): string | null {
  let line = raw;
  for (let i = 0; i < 3; i++) {
    const stripped = line.replace(FRAMING, "");
    if (stripped === line) break;
    line = stripped;
  }
  const parts = line.split(/=|≤|≥|≠|<=|>=|!=|<|>/).map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => !p)) return null;
  // Bare < / > appear inside ordinary prose ("x < 3 means x is small"), and
  // an implicit-product parser will happily read the prose tail as math. A
  // STRICT-inequality side longer than a few tokens is prose, not algebra.
  if (!/[=≤≥≠]|<=|>=|!=/.test(line) && parts.some((p) => p.split(/\s+/).length > 4)) return null;
  try {
    for (const p of parts) parseExpr(p);
    return line;
  } catch {
    return line; // comparison-shaped but refused — keep it and let the refusal speak
  }
}

/**
 * A whole PROBLEM STATEMENT pasted into the equation kind — "C=(5/9)(F−32)
 * ⏎ The equation above shows how temperature…" plus answer choices — used to
 * die on the first prose word. The equation is in there; find it. Lines that
 * parse as equations are kept, prose lines are dropped, and the note says
 * exactly what was kept and what was ignored. Runs ONLY when there is prose
 * to drop — a pure system of equations passes through untouched.
 */
export function extractEquationsFromProse(text: string): { text: string; note: string | null } {
  if (!text.includes("\n")) return { text, note: null };
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { text, note: null };
  const equations = lines.map(equationLine).filter((l): l is string => l !== null);
  const dropped = lines.length - equations.length;
  // Nothing to extract, or nothing dropped (a genuine system): leave it alone.
  if (!equations.length || !dropped) return { text, note: null };
  return {
    text: equations.join("\n"),
    note:
      equations.length === 1
        ? `Found the equation ${equations[0]} in the pasted text; ${dropped} line${dropped === 1 ? "" : "s"} of prose around it ignored.`
        : `Found ${equations.length} equations in the pasted text; ${dropped} prose line${dropped === 1 ? "" : "s"} ignored.`,
  };
}

/**
 * A fraction rendered by MathJax/KaTeX/Word copies to the clipboard as its
 * LAYOUT: numerator line, denominator line, then "= rhs" — with zero-width
 * struts in between. Solve reads multiple lines as a system of equations, so
 * the paste dead-ends. Exactly ONE shape is reassembled, because it is
 * unambiguous: a genuine system has "=" in EVERY line, so two =-free lines
 * followed by a bare "= rhs" line can only be a stacked fraction.
 */
function reassembleStacked(s: string, notes: string[]): string {
  if (!s.includes("\n")) return s;
  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // ONLY the three-line "num / den / = rhs" shape is reassembled. Two bare
  // lines are ambiguous with the graphing calculator's one-curve-per-line
  // idiom (sin(x) ⏎ cos(x) means two curves, not their quotient) — an
  // ambiguous paste is left alone rather than guessed.
  if (lines.length === 3 && /^=/.test(lines[2]) && !lines[0].includes("=") && !lines[1].includes("=")) {
    const rebuilt = `(${lines[0]})/(${lines[1]}) ${lines[2]}`;
    notes.push(`Read the pasted stacked fraction as ${rebuilt}.`);
    return rebuilt;
  }
  return s;
}

/** Characters whose "no reading here" advice applies to EQUATIONS only. */
const EQUATION_ONLY_NOTES = new Set(["°", "′", "″"]);

/**
 * Folds pasted mathematics into the Solve grammar. Never throws; the returned
 * text may still fail to parse, but the notes then name the characters that
 * were the problem instead of leaving a bare error.
 */
export function foldPastedMath(input: string, opts: FoldOptions = {}): FoldedMath {
  const notes: string[] = [];
  let s = input;

  // LaTeX first — a \frac must become a fraction before glyph folding.
  if (looksLikeLatex(s)) {
    try {
      const dsl = latexToDsl(s);
      s = dslToSolveGrammar(dsl);
      notes.push("Read as LaTeX.");
      if (DSL_ONLY.test(s)) {
        notes.push("It contains sum/∫/matrix-style notation, which Solve cannot solve directly — integrals go in the Integral kind.");
      }
    } catch (error) {
      notes.push(`LaTeX-like input could not be converted: ${(error as Error).message}`);
    }
  }

  // Invisible characters and typographic spaces — silently gone is CORRECT
  // here, because they carry no meaning a user could see.
  s = s
    .replace(/[\u2061-\u2064]/g, " ") // invisible function-application / times / separator / plus
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ") // typographic spaces
    // The fraction slash MEANS a vulgar fraction \u2014 1\u20442 is the single number
    // one-half \u2014 so digit\u2044digit folds PARENTHESIZED. A bare "/" would hand
    // "1/2 x" to the parser's ambiguity refusal, failing the very paste this
    // exists to read. A whole number directly before it is a MIXED number:
    // "10 1\u20442" is ten-and-a-half, and folding it to 10\u00b7(1/2) = 5 would be a
    // silently wrong answer.
    .replace(/(\d+)[ \t]+(\d+)\s*[\u2044]\s*(\d+)/g, "($1+$2/$3)")
    .replace(/(\d+)\s*[\u2044]\s*(\d+)/g, "($1/$2)")
    .replace(/[\u2044\u2215]/g, "/"); // any remaining fraction/division slash

  // Precomposed vulgar fractions (\u00bd \u00be \u2153 \u2026 \u2014 what Word's autoformat actually
  // produces) fold the same way, mixed numbers included.
  const VULGAR: Record<string, string> = {
    "\u00bd": "1/2", "\u2153": "1/3", "\u2154": "2/3", "\u00bc": "1/4", "\u00be": "3/4",
    "\u2155": "1/5", "\u2156": "2/5", "\u2157": "3/5", "\u2158": "4/5", "\u2159": "1/6", "\u215a": "5/6",
    "\u2150": "1/7", "\u215b": "1/8", "\u215c": "3/8", "\u215d": "5/8", "\u215e": "7/8", "\u2151": "1/9", "\u2152": "1/10",
  };
  s = s
    .replace(/(\d+)[ \t]*([\u00bd\u2153\u2154\u00bc\u00be\u2155\u2156\u2157\u2158\u2159\u215a\u2150\u215b\u215c\u215d\u215e\u2151\u2152])/g, (_m, whole: string, f: string) => `(${whole}+${VULGAR[f]})`)
    .replace(/[\u00bd\u2153\u2154\u00bc\u00be\u2155\u2156\u2157\u2158\u2159\u215a\u2150\u215b\u215c\u215d\u215e\u2151\u2152]/g, (f) => `(${VULGAR[f]})`);
  s = s
    .replace(/[\u201C\u201D\u201E]/g, String.fromCharCode(34))
    .replace(/[\u2018\u2019]/g, String.fromCharCode(39));

  // Styled math alphanumerics → base characters.
  let styled = 0;
  s = s.replace(/[\u{1D400}-\u{1D7FF}]/gu, (ch) => {
    const folded = foldMathChar(ch.codePointAt(0)!);
    if (folded === null) return ch;
    styled++;
    return folded;
  });
  for (const [ch, base] of Object.entries(LETTERLIKE)) {
    if (s.includes(ch)) {
      styled++;
      if (ch === "ℏ") notes.push("ℏ was read as plain h — divide by 2π yourself if ħ was meant.");
      s = s.split(ch).join(base);
    }
  }
  if (styled) notes.push(`${styled} styled letter${styled === 1 ? "" : "s"} (math italic/bold) read as plain letters.`);

  // Greek → engine-solvable names, padded so they never glue onto neighbours
  // (the same rule solve.ts applies to π). A following subscript keeps its
  // binding: θ₁ has already become θ_1 upstream? No — subscript folding
  // happens in solve.ts AFTER this, so θ₁ is still "θ₁" here and pads safely.
  const greekSeen = new Set<string>();
  s = s.replace(/[Ͱ-Ͽµ]/g, (ch, off: number, str: string) => {
    const name = GREEK_NAMES[ch];
    if (!name) return ch;
    greekSeen.add(`${ch} → ${name}`);
    // A leading "_" means the Greek letter IS a subscript (x_θ) — padding
    // there would mint the variable "x_". Greek neighbours count as letters,
    // or θλ glues into one identifier "thetalambda".
    const lead = off > 0 && /[A-Za-z0-9)Ͱ-Ͽ]/.test(str[off - 1]) ? " " : "";
    const trail = off + 1 < str.length && /[A-Za-z0-9(Ͱ-Ͽ]/.test(str[off + 1]) ? " " : "";
    return `${lead}${name}${trail}`;
  });
  if (greekSeen.size) notes.push(`Greek letters read as variables: ${[...greekSeen].join(", ")}.`);

  // Characters that stay AND get named — the parse error will point at them,
  // and the note says why no automatic reading is offered. Geometry reads
  // ′/″/° natively (feet, inches, degrees), so those notes stay equation-side.
  for (const [ch, why] of Object.entries(NAMED_UNREADABLE)) {
    if (opts.geometry && EQUATION_ONLY_NOTES.has(ch)) continue;
    if (s.includes(ch)) notes.push(why + ".");
  }

  // Structure recovery LAST, over the cleaned lines (the zero-width strut
  // line a renderer emits has become whitespace by now and drops out):
  // prose stripping first, then stacked-fraction reassembly.
  if (opts.extractFromProse) {
    const extracted = extractEquationsFromProse(s);
    if (extracted.note) {
      s = extracted.text;
      notes.push(extracted.note);
    }
  }
  if (opts.stackedFractions) s = reassembleStacked(s, notes);

  return { text: s, notes };
}
