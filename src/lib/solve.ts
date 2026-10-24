// Offline math solver: equations and basic calculus.
//
// Scope (all deterministic, all on-device — no network, nothing leaves the
// machine, in keeping with the JurisLab mandate):
//   * solveEquation — solve "LHS = RHS" for one unknown. Linear and quadratic
//     are solved EXACTLY (closed form, including complex roots); higher-degree
//     polynomials and transcendental equations fall back to numeric root-finding
//     over a scanned range, which is honest about the roots it may miss.
//   * differentiate — symbolic derivative via a self-contained differentiable
//     AST, then a simplify pass. Exact.
//   * integrate — definite integral by adaptive Simpson quadrature. Numeric.
//
// HONESTY (the project standard): exact results are labelled exact; numeric
// results say so and state their limits (root-finding only reports real roots it
// bracketed in the scanned range; numeric integration is an approximation). A
// solver that silently drops roots or fabricates one is exactly the failure this
// project keeps guarding against, so every path reports its method and caveats.
//
// evalFormula (stats.ts) is reused only for its numeric behaviour where a value
// is genuinely needed; the symbolic work is done on the AST defined here.
//
// The heavy symbolic machinery lives in cas.ts (canonical rational functions
// over atoms, exact rational coefficients — see docs/CAS-DESIGN.md). simplify()
// delegates to it, falling back to the local peephole pass on the rare input
// the canonical form cannot represent; solveEquation() uses it for exact
// symbolic rearrangement (F = m·a solved for a gives a = F/m, with m ≠ 0
// stated), verified by substituting the solution back.

import {
  casSimplify, CasBail, solveRationalInVar,
  Rat, ratMake, ratInt, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratIsZero, ratSign, ratToNumber,
  parseRatLiteral,
} from "./cas";
import { substituteVar as casSubstitute, ratFromNumber, ratToExpr } from "./cas";
import { fmtSqrtRat, sqrtRatToNumber, fmtRat } from "./geometry";
import { symbolicIntegrate } from "./casint";
import { ambiguousImplicitProduct } from "./ambiguous";
import { exactPolyRoots } from "./polyRoots";

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Expr =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; e: Expr }
  | { t: "add"; l: Expr; r: Expr }
  | { t: "sub"; l: Expr; r: Expr }
  | { t: "mul"; l: Expr; r: Expr }
  | { t: "div"; l: Expr; r: Expr }
  | { t: "pow"; l: Expr; r: Expr }
  | { t: "fn"; name: string; arg: Expr };

/** Numeric implementations of the supported functions (must match DERIV_FN). */
const EVAL_FN: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  // The reciprocal trio — long a KNOWN silent-null gap: sec(x) = 2 parsed to
  // nothing. Division at a zero of the base function gives ±Infinity, which
  // the callers already treat as "undefined here" (poles, refused samples).
  sec: (v: number) => 1 / Math.cos(v),
  csc: (v: number) => 1 / Math.sin(v),
  cot: (v: number) => Math.cos(v) / Math.sin(v),
  // Complex-number functions, so conj(3-4i) PARSES; on a real argument they
  // are the identity, zero, and the sign's angle. The complex layer
  // (complexAlgebra.ts) gives them their full meaning when i is present.
  conj: (v: number) => v,
  re: (v: number) => v,
  im: () => 0,
  arg: (v: number) => (v < 0 ? Math.PI : 0),
  // The unit step and the impulse, for the Laplace work (laplace.ts): u(t-2)
  // is a function of t here, and a bare `u` with no brackets stays a VARIABLE
  // (see the parser) because systems name their unknowns u and v.
  u: (v: number) => (v >= 0 ? 1 : 0),
  heaviside: (v: number) => (v >= 0 ? 1 : 0),
  step: (v: number) => (v >= 0 ? 1 : 0),
  // δ has no pointwise value; evaluating it is a mistake the callers avoid
  // (numeric checks skip expressions that contain it). Infinity at 0 keeps a
  // stray evaluation from quietly reading as 0 everywhere.
  delta: (v: number) => (v === 0 ? Infinity : 0),
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Function names that are also legitimate bare variables (see the parser). */
const BARE_OK = new Set(["u", "delta", "step", "heaviside"]);

// Unicode super/subscript glyphs, so a pasted or typed x² / x₁ parses like the
// ASCII forms x^2 / x_1. Superscript runs become an exponent ^(…); subscript runs
// fold into the variable name with an underscore.
const SUP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁽": "(", "⁾": ")", "ⁿ": "n",
};
const SUB: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

/**
 * Unicode operators that mean exactly one ASCII operator.
 *
 * These are what Word's Symbol dialog inserts and what a PDF paste carries, and
 * every one of them used to fail with `Unexpected character "−"` — an error that
 * reads like the expression is wrong when the arithmetic is fine and only the glyph
 * differs. U+2212 MINUS SIGN in particular is emitted by this product's own display
 * layer, so refusing it broke the rule that whatever is shown must parse back if
 * the user retypes it.
 *
 * The dashes are here because a word processor autocorrects a typed hyphen into an
 * en dash between spaces; "5 – 3" is a subtraction the user believes they wrote.
 */
const UNICODE_OPS: Record<string, string> = {
  "−": "-", "–": "-", "—": "-",            // minus sign, en dash, em dash
  "×": "*", "·": "*", "∙": "*", "⋅": "*", // times, middle dot, bullet operator, dot operator
  "÷": "/",
};

/**
 * Rewrites every `√` into `sqrt(…)` with the radicand EXPLICITLY BRACKETED.
 *
 * A regex cannot do this, and the version that tried got three inputs wrong three
 * different ways. Replacing the glyph alone makes `√4` into `sqrt4`, which atom()
 * reads as an identifier and hands back as a VARIABLE — silently. Grabbing the
 * following identifier instead turns `√sin(x)` into `sqrt(sin)(x)`, whose error
 * ("sin is a function, so it needs brackets") names a problem the user does not
 * have. Neither form handles `√√4`.
 *
 * So this is a scanner, and `√` is treated as what it is — a prefix operator over
 * ONE radicand, where a radicand is:
 *   a bracketed group   √(x + 1) → sqrt(x + 1)   (the user's own brackets, reused)
 *   a function call     √sin(x)  → sqrt(sin(x))
 *   one number or name  √4, √x   → sqrt(4), sqrt(x)
 *   another radical     √√4      → sqrt(sqrt(4))
 * and anything else leaves a bare `sqrt`, which atom() rejects with its "needs
 * brackets around its argument" message rather than inventing a variable.
 *
 * Taking ONE atom rather than the rest of the line is the rule this parser already
 * applies to exponents, so `√2x` is sqrt(2)·x — the reading a typeset radical
 * shows, where the bar covers the 2 and nothing more.
 */
/** Sticky, so a radicand can be matched AT an index without copying the tail. */
const ID_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUM_RE = /\d*\.?\d+(?:[eE][+-]?\d+)?/y;

/**
 * More radicals than any expression a person writes. Past this the input is not a
 * formula, and the work of scoping each one is not work worth doing: leaving the
 * glyphs alone hands the string straight to the parser, which rejects the first one
 * by name. A BOUND ON THE SHAPE IS NOT A BOUND ON THE COST — the scan was made
 * linear (a precomputed bracket map, sticky regexes that do not copy the tail) and a
 * 200,000-character paste of "√(" STILL took 13 s synchronously, which in a task
 * pane is a frozen Word. So there is a number here as well.
 */
const MAX_RADICALS = 1000;

function expandRadicals(s: string): string {
  // ∛ and ∜ are INPUT aliases (v2.136.0): the solver prints cbrt(·) and c^(1/4),
  // and a reader who retypes a root from a textbook types the glyph.
  if (!/[√∛∜]/.test(s)) return s; // the overwhelmingly common case, untouched
  const isRad = (c: string | undefined): boolean => c === "√" || c === "∛" || c === "∜";
  /** Wraps an already-bracketed radicand in the operator its glyph names. */
  const wrapRad = (g: string, text: string): string =>
    g === "√" ? `sqrt${text}` : g === "∛" ? `cbrt${text}` : `(${text}^(1/4))`;
  let radicals = 0;
  for (let k = 0; k < s.length; k++) {
    if (isRad(s[k]) && ++radicals > MAX_RADICALS) return s;
  }

  // MATCHING BRACKETS ARE PRECOMPUTED, ONCE, IN ONE PASS.
  //
  // Scanning forward for the closing bracket from inside `radicand` is O(n) per √,
  // and on UNBALANCED input every one of them scans to end-of-string — so the cost
  // is quadratic in a field that accepts a paste. Measured before this, inside
  // normalizeUnicodeMath alone: "√(" ×50,000 took 6.6 s and ×100,000 took 27.3 s,
  // synchronously, before the parser or the ambiguity gate ever ran. 200,000
  // characters is one paste, and 27 seconds in a task pane is a frozen Word.
  const close = new Map<number, number>();
  const stack: number[] = [];
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "(") stack.push(k);
    else if (s[k] === ")") {
      const open = stack.pop();
      if (open !== undefined) close.set(open, k);
    }
  }
  /** A balanced bracket group starting at s[j] === "(", or null. */
  const group = (j: number): { text: string; next: number } | null => {
    const end = close.get(j);
    if (s[j] !== "(" || end === undefined) return null; // unbalanced: the parser says so
    return { text: s.slice(j, end + 1), next: end + 1 };
  };
  /** The radicand starting at j, already bracketed, or null if there is none. */
  const radicand = (j: number): { text: string; next: number } | null => {
    // A RUN OF RADICALS IS COUNTED, NOT RECURSED THROUGH.
    //
    // One recursion per √ overflowed the stack at about 6,000 of them in Node
    // (`RangeError: Maximum call stack size exceeded`), and a Word WebView stack is
    // smaller than Node's, so the real ceiling is lower. A crash is not a parse
    // error: it escapes as an unhandled exception rather than a message the user
    // can act on. The nesting is regular, so it is counted and wrapped afterwards.
    const glyphs: string[] = [];
    while (true) {
      while (s[j] === " ") j++;
      if (!isRad(s[j])) break;
      glyphs.push(s[j]);
      j++;
    }
    const inner = radicandAtom(j);
    if (!inner) return null;
    let text = inner.text;
    for (let d = glyphs.length - 1; d >= 0; d--) text = `(${wrapRad(glyphs[d], text)})`;
    return { text, next: inner.next };
  };
  /** One radicand with no leading √: a group, a call, a name, or a number. */
  const radicandAtom = (j: number): { text: string; next: number } | null => {
    while (s[j] === " ") j++;
    const g = group(j);
    if (g) return g;
    // STICKY, NOT SLICED. `regex.exec(s.slice(j))` copies the rest of the string
    // for every √ in the input, which is the other half of the quadratic — it cost
    // 8.9 s on a 200,000-character paste even after the bracket scan was made
    // linear. A sticky regex matches in place, at an index, and copies nothing.
    ID_RE.lastIndex = j;
    const id = ID_RE.exec(s);
    if (id) {
      const after = j + id[0].length;
      const call = group(after);
      if (call) return { text: `(${id[0]}${call.text})`, next: call.next };
      return { text: `(${id[0]})`, next: after };
    }
    NUM_RE.lastIndex = j;
    const num = NUM_RE.exec(s);
    if (num) return { text: `(${num[0]})`, next: j + num[0].length };
    return null;
  };
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (!isRad(s[i])) {
      out += s[i++];
      continue;
    }
    const glyph = s[i];
    // SEPARATE FROM WHAT PRECEDES IT, exactly as the π fold does, and for the
    // same reason. Without the space, an identifier immediately to the left
    // fused with the substitution: "x√" became the single token "xsqrt", which
    // Solve then treated as an equation in an unknown VARIABLE of that name —
    // silently inventing one, which the docstring promises never happens. And
    // "a√b" became the call "asqrt(b)", an error naming a function the user
    // never typed. A leading space is inert everywhere else in this grammar.
    if (out.length && /[A-Za-z0-9_)\]]$/.test(out)) out += " ";
    const r = radicand(i + 1);
    if (!r) {
      // Nothing usable follows — let atom() say so, by name. (∜ stays a glyph,
      // which the parser rejects by name: there is no bare word for it.)
      out += glyph === "√" ? "sqrt" : glyph === "∛" ? "cbrt" : glyph;
      i++;
      continue;
    }
    out += wrapRad(glyph, r.text);
    i = r.next;
  }
  return out;
}

/**
 * Rewrites Unicode math to the ASCII grammar: x² → x^(2), x₁ → x_1, π → pi,
 * √4 → sqrt(4), 2 × 3 → 2 * 3, 5 − 3 → 5 - 3.
 *
 * `π` cannot be replaced by the bare text "pi", because it is glued to whatever is
 * adjacent: "xπ" would become the single identifier "xpi" — a made-up variable,
 * silently. It is padded with a space instead, and space is already this parser's
 * implicit-multiplication separator, so "2π" → "2 pi" → 2·π. The one place that
 * padding must NOT go is after an underscore, where the letters belong to a
 * subscripted NAME: unconditional padding turned x_π into "x_ pi", a variable
 * called `x_` times π, with no error — the same silent invention the padding
 * prevents everywhere else.
 *
 * `∞` maps to "inf" ON PURPOSE, so the DELIBERATE refusal in atom() ("inf is not a
 * value this can solve for") fires by name. A better error message, not a new
 * capability: infinity is still not a value this solver accepts.
 */
const VULGAR: Record<string, string> = {
  "½": "(1/2)", "⅓": "(1/3)", "⅔": "(2/3)", "¼": "(1/4)", "¾": "(3/4)",
  "⅕": "(1/5)", "⅖": "(2/5)", "⅗": "(3/5)", "⅘": "(4/5)",
  "⅙": "(1/6)", "⅚": "(5/6)", "⅛": "(1/8)", "⅜": "(3/8)", "⅝": "(5/8)", "⅞": "(7/8)",
};

/**
 * |x + 4| → abs(x + 4), with nesting in BOTH orientations: ||x| − 2| and
 * |5 − |x|| both fold correctly. A leftmost-pair regex cannot do this — in
 * |5 − |x|| it pairs the first two bars around "5 − " — so each bar is
 * classified as OPENING or CLOSING the way a lexer would: a bar after an
 * operator, an open paren, or at the start OPENS; a bar after a value CLOSES
 * the most recent open. Unmatched bars are left for the parser to refuse by
 * name — guessing where the other bar "should" be would silently change the
 * expression.
 */
export function foldAbsBars(s: string): string {
  if (!s.includes("|")) return s;
  const chars = [...s];
  const openStack: number[] = [];
  const pairs: [number, number][] = [];
  // A bar directly after another bar INHERITS that bar's role: in ||x| − 2|
  // the second bar opens (its neighbour opened); in |5 − |x|| the last bar
  // closes (its neighbour closed). Without this, adjacent bars mispair.
  let lastRole: "open" | "close" | null = null;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "|") continue;
    // The previous non-space character decides the role.
    let j = i - 1;
    while (j >= 0 && chars[j] === " ") j--;
    const prev = j >= 0 ? chars[j] : "";
    const opens =
      openStack.length === 0 ||
      prev === "" || "(+-*/^,=<>".includes(prev) ||
      (prev === "|" && lastRole === "open");
    if (opens) {
      openStack.push(i);
      lastRole = "open";
    } else {
      pairs.push([openStack.pop()!, i]);
      lastRole = "close";
    }
  }
  if (!pairs.length) return s;
  // Per-character substitution — an opening bar becomes "abs(", a closing bar
  // ")". No index ever shifts, so nesting needs no bookkeeping at all.
  const openAt = new Set<number>();
  const closeAt = new Set<number>();
  for (const [a, b] of pairs) {
    if (b - a < 2) continue; // "||" — empty, left for the parser to refuse
    openAt.add(a);
    closeAt.add(b);
  }
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    if (openAt.has(i)) out += "abs(";
    else if (closeAt.has(i)) out += ")";
    else out += chars[i];
  }
  return out;
}

export function normalizeUnicodeMath(input: string): string {
  const folded = foldAbsBars(input)
    // Vulgar-fraction glyphs first — Word's AutoFormat turns a typed 1/2 into
    // ½, so "sin(x) = ½" is what the product's own display habit produces, and
    // it parsed to NOTHING. Parenthesised so it stays one number.
    .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (c) => VULGAR[c])
    .replace(/[⁰¹²³⁴-⁹⁺⁻⁽⁾ⁿ]+/g, (run) => {
      const decoded = [...run].map((c) => SUP[c] ?? "").join("");
      return decoded ? `^(${decoded})` : "";
    })
    .replace(/[₀-₉]+/g, (run) => {
      const decoded = [...run].map((c) => SUB[c] ?? "").join("");
      return decoded ? `_${decoded}` : "";
    })
    .replace(/[−–—×·∙⋅÷]/g, (c) => UNICODE_OPS[c])
    // A SUBSCRIPT BINDS ON EITHER SIDE. The padding that stops "xπ" becoming the
    // invented variable "xpi" must not run between π and a subscript that belongs
    // to it: subscripts are folded first, so "π₁" arrives here as "π_1" and blanket
    // padding made it " pi _1" — π times a variable called "_1". Worse than a bad
    // message, because solveEquation would then take "_1" as the unknown and solve
    // an equation the user never wrote.
    .replace(/π/g, (_m: string, off: number, str: string) => {
      const lead = str[off - 1] === "_" ? "" : " ";
      const trail = str[off + 1] === "_" ? "" : " ";
      return `${lead}pi${trail}`;
    })
    .replace(/∞/g, " inf ")
    // arcsin/arccos/arctan are INPUT aliases (the solver prints asin/acos/atan,
    // e.g. the trigonometric form of a cubic's roots). Whole words only, so
    // arcsinh and a variable such as "arcsine" are untouched. A captured prefix,
    // not \b: "2arcsin(x)" has no word boundary between the 2 and the a.
    .replace(/(^|[^A-Za-z_])arc(sin|cos|tan)(?![A-Za-z_\d])/g, "$1a$2");
  return expandRadicals(folded);
}

// ---------------------------------------------------------------------------
// Parser — recursive descent over the same grammar evalFormula accepts.
// ---------------------------------------------------------------------------

class Parser {
  private i = 0;
  constructor(private s: string) {
    // WHITESPACE IS A SEPARATOR, NOT NOISE.
    //
    // This used to delete every space before parsing, which silently glued adjacent
    // names into one: `pi r` became a single variable called "pir", `y z` became
    // "yz", and `sin x` became "sinx". So `pi r^2 h` — the volume of a cylinder —
    // parsed as a variable "pir" raised to the power (2*h), and nothing about the
    // result said so.
    //
    // Runs of whitespace collapse to one space, which is kept and treated as an
    // implicit multiplication between factors.
    this.s = normalizeUnicodeMath(s).replace(/\s+/g, " ").trim();
  }
  /** Skips separator spaces. Called before every operator test. */
  private ws(): void {
    while (this.s[this.i] === " ") this.i++;
  }
  parse(): Expr {
    const e = this.additive();
    this.ws();
    if (this.i !== this.s.length) throw new Error(`Unexpected character "${this.s[this.i]}".`);
    return e;
  }
  private additive(): Expr {
    let e = this.term();
    this.ws();
    while (this.s[this.i] === "+" || this.s[this.i] === "-") {
      const op = this.s[this.i++];
      const r = this.term();
      e = op === "+" ? { t: "add", l: e, r } : { t: "sub", l: e, r };
      this.ws();
    }
    return e;
  }
  /**
   * Products, including IMPLICIT ones. This is the only place juxtaposition is
   * turned into multiplication, and that is the point.
   *
   * It used to live in atom()'s number branch, which meant a number followed by a
   * letter formed a product ANYWHERE — including inside an exponent, where it does
   * not belong. `2^2x` therefore parsed as 2^(2*x) and `r^2 h` as r^(2*h), which
   * evaluates to 81 for r = 3, h = 2 where the answer is 18. An exponent extends to
   * the atom immediately after it and no further; that is not a disputed convention,
   * it is what a typeset superscript shows. The other expression parser in this
   * codebase already read it that way, so the same text meant two different things
   * in two parts of the product.
   */
  private term(): Expr {
    let e = this.unary();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === "*" || c === "/") {
        this.i++;
        const r = this.unary();
        e = c === "*" ? { t: "mul", l: e, r } : { t: "div", l: e, r };
        continue;
      }
      // Juxtaposition: "2x", "pi r", "3sin(x)", "2(x+1)", "(x+1)(x+2)".
      if (c !== undefined && /[A-Za-z0-9_(.]/.test(c)) {
        e = { t: "mul", l: e, r: this.unary() };
        continue;
      }
      return e;
    }
  }
  private unary(): Expr {
    this.ws();
    if (this.s[this.i] === "-") { this.i++; return { t: "neg", e: this.unary() }; }
    if (this.s[this.i] === "+") { this.i++; return this.unary(); }
    return this.power();
  }
  private power(): Expr {
    const base = this.atom();
    this.ws();
    if (this.s[this.i] === "^") {
      this.i++;
      return { t: "pow", l: base, r: this.exponent() };
    }
    return base;
  }
  /**
   * The exponent: a sign, ONE atom, and then another `^` if there is one.
   *
   * Deliberately not `unary()` and deliberately not `term()`. Calling term() would
   * swallow the following factors — the bug this replaces — and calling unary() did
   * the same by way of atom()'s old implicit-multiplication branch. Recursing into
   * itself for a trailing `^` keeps `2^3^2` right-associative at 512.
   */
  private exponent(): Expr {
    this.ws();
    if (this.s[this.i] === "-") { this.i++; return { t: "neg", e: this.exponent() }; }
    if (this.s[this.i] === "+") { this.i++; return this.exponent(); }
    const base = this.atom();
    this.ws();
    if (this.s[this.i] === "^") {
      this.i++;
      return { t: "pow", l: base, r: this.exponent() };
    }
    return base;
  }
  private atom(): Expr {
    this.ws();
    if (this.s[this.i] === "(") {
      this.i++;
      const e = this.additive();
      if (this.s[this.i] !== ")") throw new Error("Unbalanced parentheses.");
      this.i++;
      return e;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i));
    if (id) {
      const name = id[0];
      this.i += name.length;
      if (this.s[this.i] === "(") {
        this.i++;
        const arg = this.additive();
        if (this.s[this.i] !== ")") throw new Error("Unbalanced parentheses.");
        this.i++;
        if (!(name in EVAL_FN)) throw new Error(`Unknown function "${name}".`);
        return { t: "fn", name, arg };
      }
      // "NaN" and "Infinity" parse as perfectly ordinary identifiers, so typing
      // either one produced an equation in a variable called NaN and working
      // that read "1·NaN^1 + 0·NaN^0 = 0". Whatever the user meant, they did
      // not mean that. Refuse by name.
      if (/^(nan|infinity|inf|undefined)$/i.test(name)) {
        throw new Error(`"${name}" is not a value this can solve for.`);
      }
      // A FUNCTION NAME WITHOUT ITS BRACKETS IS A MISSING BRACKET, NOT A VARIABLE.
      //
      // `sin x` used to parse as one variable called "sinx" because whitespace was
      // deleted; with whitespace now separating factors it would otherwise become
      // sin*x — a product with a variable named "sin". Both are nonsense, and the
      // second is the kind that produces a plausible-looking answer. Say what is
      // actually wrong instead.
      // …except the step and impulse names: `u` is the unit step when written
      // u(t-2) and an ordinary unknown when written bare (systems in u and v,
      // parametric systems whose unknowns are x, y, z, w, u, v), and `delta`
      // is what a pasted δ becomes — a deflection, a Kronecker symbol, a
      // "δ = 0.5". Only the bracketed form is the function.
      if (name in EVAL_FN && !BARE_OK.has(name)) {
        throw new Error(
          `"${name}" is a function, so it needs brackets around its argument — write ` +
            `${name}(x) rather than ${name} x.`,
        );
      }
      return { t: "var", name };
    }
    const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      const v = parseFloat(num[0]);
      // A literal past the range of a double becomes Infinity silently, and the
      // working then read "Reduced to -Infinity = 0" — an answer about a number
      // the user never wrote. Blocking the IDENTIFIERS "NaN"/"Infinity" above
      // does not cover this: 1e999 is neither.
      if (!Number.isFinite(v)) {
        throw new Error(`"${num[0]}" is too large to represent — the limit is about 1e308.`);
      }
      // NO IMPLICIT MULTIPLICATION HERE. It is term()'s job now — see the comment
      // there. Forming the product at this level is what leaked it into exponents.
      return { t: "num", v };
    }
    throw new Error("Could not parse the expression.");
  }
}

export function parseExpr(s: string): Expr {
  // REFUSED RATHER THAN GUESSED AT. `1/2x` has no agreed reading, and this file and
  // mathParse.ts had picked opposite ones — so the same text meant two different
  // functions in two parts of the product. See lib/ambiguous.ts.
  //
  // THE GATE MUST SEE WHAT THE PARSER WILL SEE, NOT WHAT THE USER TYPED.
  //
  // The Unicode fold used to run inside the Parser constructor, i.e. AFTER this
  // check, so a fold could carry an expression around the refusal. Measured:
  // `1/2pi` was refused while `1/2π` returned 1.5707963267948966 — the same
  // expression in two notations, one a refusal and one an answer, and the answer
  // silently picked the (1/2)·π reading that ambiguous.ts exists to say is not
  // settled. π is exactly the character a student takes from Word's Symbol dialog,
  // so the notation that defeats the gate is the one the gate was written for.
  //
  // Folding first also means `√` and the operator glyphs are gated on equal terms.
  // normalizeUnicodeMath is idempotent — nothing it emits is a Unicode operator —
  // so the Parser re-folding this string is a no-op.
  const folded = normalizeUnicodeMath(s);
  const ambiguous = ambiguousImplicitProduct(folded);
  if (ambiguous) throw new Error(ambiguous);
  return new Parser(folded).parse();
}

// ---------------------------------------------------------------------------
// Numeric evaluation of the AST.
// ---------------------------------------------------------------------------

export function evalAst(e: Expr, vars: Record<string, number>): number {
  switch (e.t) {
    case "num": return e.v;
    case "var":
      if (e.name in vars) return vars[e.name];
      if (e.name in CONSTANTS) return CONSTANTS[e.name];
      throw new Error(`Unknown variable "${e.name}".`);
    case "neg": return -evalAst(e.e, vars);
    case "add": return evalAst(e.l, vars) + evalAst(e.r, vars);
    case "sub": return evalAst(e.l, vars) - evalAst(e.r, vars);
    case "mul": return evalAst(e.l, vars) * evalAst(e.r, vars);
    case "div": return evalAst(e.l, vars) / evalAst(e.r, vars);
    case "pow": {
      const base = evalAst(e.l, vars);
      const exp = evalAst(e.r, vars);
      // A negative base to a p/q power with ODD q has a real value —
      // (−8)^(1/3) = −2 — but Math.pow answers NaN, which cost x^(1/3) = −2
      // its solution while cbrt(x) = −2 worked one notation over. Recover the
      // real odd-root value when the exponent is (numerically) such a fraction.
      if (base < 0 && !Number.isInteger(exp) && Number.isFinite(exp)) {
        for (let q = 3; q <= 15; q += 2) {
          const pNum = exp * q;
          const pRound = Math.round(pNum);
          if (pRound !== 0 && Math.abs(pNum - pRound) < 1e-9) {
            const mag = Math.pow(-base, exp);
            return pRound % 2 === 0 ? mag : -mag;
          }
        }
      }
      return Math.pow(base, exp);
    }
    case "fn": return EVAL_FN[e.name](evalAst(e.arg, vars));
  }
}

/**
 * Evaluates `e` AND reports the largest magnitude it passed through on the way.
 *
 * Why this exists. A tolerance derived from the SIZE OF THE ANSWER cannot see
 * catastrophic cancellation, because cancellation is precisely the case where the
 * answer is tiny and the intermediates are enormous. `cosh(x)^2 - sinh(x)^2` is
 * identically 1, but at x = 18 both squares are about 1.1e15, so the computed
 * difference carries roughly 0.25 of rounding dust — two hundred million times the
 * true answer's own last bit. Judged against |1| it looks like a wild disagreement;
 * judged against 1.1e15 it is exactly what double arithmetic can be expected to
 * deliver.
 *
 * The alternative was measuring the dust empirically by perturbing x, which was
 * tried in v2.40.1 and reverted: the estimate is itself a random quantity, and the
 * version that finally passed the cosh case also reported `tan(x) = 2` and
 * `exp(x) = 2` as identities. Reading the intermediate magnitudes is deterministic
 * and needs no threshold to be tuned — the answer is simply "this expression cannot
 * be evaluated to better than eps times THIS".
 *
 * Kept as a separate function rather than an option on evalAst on purpose: evalAst
 * runs inside adaptive quadrature and root-scan loops, and paying for a tracker on
 * every one of those evaluations to serve a check that runs 123 times would be the
 * wrong trade.
 */
export function evalAstScaled(e: Expr, vars: Record<string, number>): { value: number; scale: number } {
  let scale = 0;
  const note = (v: number): number => {
    const a = Math.abs(v);
    if (a > scale && Number.isFinite(a)) scale = a;
    return v;
  };
  const walk = (n: Expr): number => {
    switch (n.t) {
      case "num": return note(n.v);
      case "var":
        if (n.name in vars) return note(vars[n.name]);
        if (n.name in CONSTANTS) return note(CONSTANTS[n.name]);
        throw new Error(`Unknown variable "${n.name}".`);
      case "neg": return note(-walk(n.e));
      case "add": return note(walk(n.l) + walk(n.r));
      case "sub": return note(walk(n.l) - walk(n.r));
      case "mul": return note(walk(n.l) * walk(n.r));
      case "div": return note(walk(n.l) / walk(n.r));
      case "pow": return note(Math.pow(walk(n.l), walk(n.r)));
      case "fn": return note(EVAL_FN[n.name](walk(n.arg)));
    }
  };
  const value = walk(e);
  return { value, scale };
}

/** Free variable names in `e` (excludes the constants pi and e). */
export function freeVars(e: Expr): string[] {
  const out = new Set<string>();
  (function walk(n: Expr): void {
    switch (n.t) {
      case "var": if (!(n.name in CONSTANTS)) out.add(n.name); break;
      case "num": break;
      case "neg": walk(n.e); break;
      case "fn": walk(n.arg); break;
      default: walk(n.l); walk(n.r);
    }
  })(e);
  return [...out];
}

function containsVar(e: Expr, name: string): boolean {
  return freeVars(e).includes(name);
}

// ---------------------------------------------------------------------------
// Symbolic differentiation.
// ---------------------------------------------------------------------------

const N = (v: number): Expr => ({ t: "num", v });

/** Derivative of function `name` applied to `u` (before the chain-rule factor). */
function derivFn(name: string, u: Expr): Expr {
  switch (name) {
    case "sin": return { t: "fn", name: "cos", arg: u };
    case "cos": return { t: "neg", e: { t: "fn", name: "sin", arg: u } };
    case "tan": return { t: "div", l: N(1), r: { t: "pow", l: { t: "fn", name: "cos", arg: u }, r: N(2) } };
    case "exp": return { t: "fn", name: "exp", arg: u };
    case "ln": return { t: "div", l: N(1), r: u };
    // log and log10 are the same function here -- EVAL_FN and the parser both
        // accept log10, but derivFn had no case for it, so differentiate("log10(x)")
        // threw "No derivative rule" straight out of the pane (derivative() is not
        // inside solve.ts's try), and integrate("log10(x)", 1, 2) threw the same
        // from casint's by-parts branch. It was the only such gap.
    // ln(10) and ln(2) stay symbolic, so the exact derivative reads 1/(x·ln(10)) rather than 0.434294…/x; numeric
    // simplification still folds them.
    case "log":
    case "log10": return { t: "div", l: N(1), r: { t: "mul", l: u, r: { t: "fn", name: "ln", arg: N(10) } } };
    case "log2": return { t: "div", l: N(1), r: { t: "mul", l: u, r: { t: "fn", name: "ln", arg: N(2) } } };
    case "sqrt": return { t: "div", l: N(1), r: { t: "mul", l: N(2), r: { t: "fn", name: "sqrt", arg: u } } };
    case "cbrt": return { t: "div", l: N(1), r: { t: "mul", l: N(3), r: { t: "pow", l: { t: "fn", name: "cbrt", arg: u }, r: N(2) } } };
    case "asin": return { t: "div", l: N(1), r: { t: "fn", name: "sqrt", arg: { t: "sub", l: N(1), r: { t: "pow", l: u, r: N(2) } } } };
    case "acos": return { t: "neg", e: { t: "div", l: N(1), r: { t: "fn", name: "sqrt", arg: { t: "sub", l: N(1), r: { t: "pow", l: u, r: N(2) } } } } };
    case "atan": return { t: "div", l: N(1), r: { t: "add", l: N(1), r: { t: "pow", l: u, r: N(2) } } };
    case "sinh": return { t: "fn", name: "cosh", arg: u };
    case "cosh": return { t: "fn", name: "sinh", arg: u };
    case "tanh": return { t: "div", l: N(1), r: { t: "pow", l: { t: "fn", name: "cosh", arg: u }, r: N(2) } };
    case "abs": return { t: "div", l: u, r: { t: "fn", name: "abs", arg: u } }; // sign(u); undefined at 0
    // The reciprocal trio, added with their EVAL_FN entries — the tables stay
    // in step or differentiate() throws from the pane.
    case "sec": return { t: "mul", l: { t: "fn", name: "sec", arg: u }, r: { t: "fn", name: "tan", arg: u } };
    case "csc": return { t: "neg", e: { t: "mul", l: { t: "fn", name: "csc", arg: u }, r: { t: "fn", name: "cot", arg: u } } };
    case "cot": return { t: "neg", e: { t: "div", l: N(1), r: { t: "pow", l: { t: "fn", name: "sin", arg: u }, r: N(2) } } };
    // The step's derivative is the impulse (in the distributional sense the
    // Laplace work needs); the impulse itself has no derivative rule here.
    case "u":
    case "heaviside":
    case "step": return { t: "fn", name: "delta", arg: u };
    default: throw new Error(`No derivative rule for "${name}".`);
  }
}

/** Symbolic derivative of `e` with respect to `x` (unsimplified). */
export function derivative(e: Expr, x: string): Expr {
  switch (e.t) {
    case "num": return N(0);
    case "var": return N(e.name === x ? 1 : 0);
    case "neg": return { t: "neg", e: derivative(e.e, x) };
    case "add": return { t: "add", l: derivative(e.l, x), r: derivative(e.r, x) };
    case "sub": return { t: "sub", l: derivative(e.l, x), r: derivative(e.r, x) };
    case "mul": // (uv)' = u'v + uv'
      return { t: "add", l: { t: "mul", l: derivative(e.l, x), r: e.r }, r: { t: "mul", l: e.l, r: derivative(e.r, x) } };
    case "div": // (u/v)' = (u'v - uv')/v^2
      return {
        t: "div",
        l: { t: "sub", l: { t: "mul", l: derivative(e.l, x), r: e.r }, r: { t: "mul", l: e.l, r: derivative(e.r, x) } },
        r: { t: "pow", l: e.r, r: N(2) },
      };
    case "pow": {
      const uConst = !containsVar(e.l, x);
      const vConst = !containsVar(e.r, x);
      if (vConst) {
        // u^c: c*u^(c-1)*u'  (c a constant expression)
        return {
          t: "mul",
          l: { t: "mul", l: e.r, r: { t: "pow", l: e.l, r: { t: "sub", l: e.r, r: N(1) } } },
          r: derivative(e.l, x),
        };
      }
      if (uConst) {
        // e^v: e^v*v' (ln(e) = 1 — it used to print as a literal *ln(e) factor).
        if (e.l.t === "var" && e.l.name === "e") return { t: "mul", l: e, r: derivative(e.r, x) };
        // a^v: a^v*ln(a)*v'
        return {
          t: "mul",
          l: { t: "mul", l: e, r: { t: "fn", name: "ln", arg: e.l } },
          r: derivative(e.r, x),
        };
      }
      // general u^v = exp(v ln u): u^v (v' ln u + v u'/u)
      return {
        t: "mul",
        l: e,
        r: {
          t: "add",
          l: { t: "mul", l: derivative(e.r, x), r: { t: "fn", name: "ln", arg: e.l } },
          r: { t: "div", l: { t: "mul", l: e.r, r: derivative(e.l, x) }, r: e.l },
        },
      };
    }
    case "fn": // chain rule
      // A function of something that does not involve x is a constant: 0,
      // without asking derivFn — which has no rule for delta, and used to
      // throw on an impulse forcing term while the ODE's coefficients were
      // being read off by differentiating with respect to y, y', y''.
      if (!containsVar(e.arg, x)) return N(0);
      return { t: "mul", l: derivFn(e.name, e.arg), r: derivative(e.arg, x) };
  }
}

// ---------------------------------------------------------------------------
// Simplification — enough to make output readable, never changing the value.
// ---------------------------------------------------------------------------

const isNum = (e: Expr, v?: number): boolean => e.t === "num" && (v === undefined || e.v === v);

/** Flattens a left/right-nested product into its factor list. */
function flattenMul(e: Expr): Expr[] {
  return e.t === "mul" ? [...flattenMul(e.l), ...flattenMul(e.r)] : [e];
}

/**
 * Display order for a factor within a product: numbers, then variables/powers,
 * then everything else, with functions last. This is what turns the chain-rule
 * result cos(x^2)·2·x into the conventional 2·x·cos(x^2).
 */
function factorRank(e: Expr): number {
  switch (e.t) {
    case "num": return 0;
    case "neg": return 1;
    case "var": return 1;
    case "pow": return 2;
    case "div": return 3;
    case "fn": return 5;
    default: return 4;
  }
}

/**
 * Canonical simplification via the CAS core: collects like terms, cancels,
 * expands, and orders factors readably (2*x + 3*x → 5*x, x/x → 1). The
 * peephole pass below remains as the fallback for anything the canonical
 * form cannot represent (e.g. a literal division by zero), so simplify()
 * stays total.
 */
export function simplify(e: Expr): Expr {
  try {
    return casSimplify(e);
  } catch (err) {
    if (err instanceof CasBail) return peepholeSimplify(e);
    throw err;
  }
}

function peepholeSimplify(e: Expr): Expr {
  switch (e.t) {
    case "num":
    case "var":
      return e;
    case "neg": {
      const x = peepholeSimplify(e.e);
      if (x.t === "num") return N(-x.v);
      if (x.t === "neg") return x.e;
      return { t: "neg", e: x };
    }
    case "fn": {
      const a = peepholeSimplify(e.arg);
      if (a.t === "num") return N(EVAL_FN[e.name](a.v));
      return { t: "fn", name: e.name, arg: a };
    }
    case "add": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num") return N(l.v + r.v);
      if (isNum(l, 0)) return r;
      if (isNum(r, 0)) return l;
      return { t: "add", l, r };
    }
    case "sub": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num") return N(l.v - r.v);
      if (isNum(r, 0)) return l;
      if (isNum(l, 0)) return peepholeSimplify({ t: "neg", e: r });
      return { t: "sub", l, r };
    }
    case "mul": {
      // Flatten the whole product, fold the numeric constants into one coefficient,
      // then order the remaining factors so the printed form reads conventionally
      // (coefficient first, functions last).
      const factors = [...flattenMul(peepholeSimplify(e.l)), ...flattenMul(peepholeSimplify(e.r))];
      let coeff = 1;
      const rest: Expr[] = [];
      for (const f of factors) {
        if (f.t === "num") coeff *= f.v;
        else rest.push(f);
      }
      if (coeff === 0) return N(0);
      // Stable sort (V8's is stable) keeps same-rank factors in their original order.
      rest.sort((a, b) => factorRank(a) - factorRank(b));
      const ordered: Expr[] = coeff !== 1 || rest.length === 0 ? [N(coeff), ...rest] : rest;
      return ordered.reduce((acc, f) => ({ t: "mul", l: acc, r: f }));
    }
    case "div": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num" && r.v !== 0) return N(l.v / r.v);
      // 0/r is 0 only when r is DEMONSTRABLY non-zero. casSimplify correctly
      // bails on a zero denominator, which handed 0/0 to this peephole, and the
      // unconditional fold answered "0" -- so differentiate("x/0"),
      // differentiate("0/0") and differentiate("(x+1)/0") all reported the
      // derivative as 0. A symbolic denominator is not known to be non-zero
      // either, so it is left alone rather than folded.
      if (isNum(l, 0) && r.t === "num" && r.v !== 0) return N(0);
      if (isNum(r, 1)) return l;
      return { t: "div", l, r };
    }
    case "pow": {
      const l = peepholeSimplify(e.l), r = peepholeSimplify(e.r);
      if (l.t === "num" && r.t === "num") return N(Math.pow(l.v, r.v));
      if (isNum(r, 1)) return l;
      if (isNum(r, 0)) return N(1);
      if (isNum(l, 1)) return N(1);
      return { t: "pow", l, r };
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting AST -> string, with minimal parentheses.
// ---------------------------------------------------------------------------

const PREC: Record<Expr["t"], number> = { add: 1, sub: 1, mul: 2, div: 2, neg: 2, pow: 3, fn: 4, num: 5, var: 5 };

/**
 * SIGNIFICANT FIGURES, NOT DECIMAL PLACES.
 *
 * This rounded to 6 decimal places, which silently destroys any quantity smaller
 * than 1e-6 and any coefficient that needs more precision than that:
 *
 *   - `x^2 - 1e-20 = 0` has roots ±1e-10, and both printed as "0" — so the answer
 *     read "[0, 0]", two identical roots, for an equation with two distinct ones.
 *   - `integrate("1/(x^2+x+1)", 0, 1).antiderivative` printed
 *     `1.154701*atan(1.154701*x + 0.57735)` where the coefficient is
 *     2/sqrt(3) = 1.1547005383792515. The `value` was exact; the closed form
 *     shown was not, and did not re-parse. Anyone copying that expression out of
 *     their document got a different function from the one integrated.
 *   - The working for a quadratic with tiny coefficients read
 *     `Polynomial form: 0·x^2 + 0·x^1 + 0·x^0 = 0` beside a claimed exact root.
 *
 * 12 significant figures keeps every digit a double can be trusted for while
 * still suppressing the 0.30000000000000004 noise that made a fixed rounding
 * attractive in the first place. Integers are unchanged.
 */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  return String(Number(v.toPrecision(12)));
}

export function format(e: Expr): string {
  const wrap = (child: Expr, parentPrec: number): string => {
    const s = format(child);
    return PREC[child.t] < parentPrec ? `(${s})` : s;
  };
  switch (e.t) {
    case "num": return fmtNum(e.v);
    case "var": return e.name;
    case "neg": return `-${wrap(e.e, PREC.neg)}`;
    case "add": return `${wrap(e.l, PREC.add)} + ${wrap(e.r, PREC.add)}`;
    case "sub": return `${wrap(e.l, PREC.sub)} - ${wrap(e.r, PREC.sub)}`;
    case "mul": return `${wrap(e.l, PREC.mul)}*${wrap(e.r, PREC.mul)}`;
    case "div": return `${wrap(e.l, PREC.div)}/${wrap(e.r, PREC.div + 1)}`;
    case "pow": return `${wrap(e.l, PREC.pow + 1)}^${wrap(e.r, PREC.pow)}`;
    case "fn": return `${e.name}(${format(e.arg)})`;
  }
}

// ---------------------------------------------------------------------------
// Polynomial extraction (for exact linear/quadratic solving).
// ---------------------------------------------------------------------------

/** Coefficients [c0, c1, ...] if `e` is a polynomial in `x`, else null. */
export function polyCoeffs(e: Expr, x: string): number[] | null {
  if (!containsVar(e, x)) {
    // A subtree with no x is a constant — evaluate it (functions of constants,
    // pi, e, arithmetic all collapse to a number).
    try { return [evalAst(e, {})]; } catch { return null; }
  }
  switch (e.t) {
    case "var": return e.name === x ? [0, 1] : null;
    case "neg": {
      const c = polyCoeffs(e.e, x);
      return c ? c.map((v) => -v) : null;
    }
    case "add": case "sub": {
      const a = polyCoeffs(e.l, x), b = polyCoeffs(e.r, x);
      if (!a || !b) return null;
      const out = new Array(Math.max(a.length, b.length)).fill(0);
      a.forEach((v, k) => (out[k] += v));
      b.forEach((v, k) => (out[k] += e.t === "add" ? v : -v));
      return out;
    }
    case "mul": {
      const a = polyCoeffs(e.l, x), b = polyCoeffs(e.r, x);
      if (!a || !b) return null;
      const out = new Array(a.length + b.length - 1).fill(0);
      a.forEach((av, i) => b.forEach((bv, j) => (out[i + j] += av * bv)));
      return out;
    }
    case "div": {
      // Only division by a constant keeps it polynomial.
      const denom = polyCoeffs(e.r, x);
      if (!denom || denom.length !== 1) return null;
      // Division by a zero constant is not a polynomial. Without this guard
      // "x/0 = 1" produced coefficients [NaN, Infinity], sailed through the
      // linear branch, and was reported as roots ["NaN"] with the method
      // "exact (linear)". The parser deliberately refuses the identifiers NaN
      // and Infinity and the literal 1e999 to prevent exactly this outcome;
      // arithmetic division by zero walked past both of those defences.
      if (!Number.isFinite(denom[0]) || denom[0] === 0) return null;
      const num = polyCoeffs(e.l, x);
      return num ? num.map((v) => v / denom[0]) : null;
    }
    case "pow": {
      // x-containing base to a non-negative integer constant power.
      if (containsVar(e.r, x)) return null;
      let p: number;
      try { p = evalAst(e.r, {}); } catch { return null; }
      if (!Number.isInteger(p) || p < 0 || p > 64) return null;
      const base = polyCoeffs(e.l, x);
      if (!base) return null;
      let acc = [1];
      for (let k = 0; k < p; k++) {
        const out = new Array(acc.length + base.length - 1).fill(0);
        acc.forEach((av, i) => base.forEach((bv, j) => (out[i + j] += av * bv)));
        acc = out;
      }
      return acc;
    }
    default:
      return null; // fn(x): not polynomial
  }
}

// ---------------------------------------------------------------------------
// EXACT (rational) coefficient extraction — the twin of polyCoeffs.
// ---------------------------------------------------------------------------

/**
 * A constant subtree as an EXACT rational, or null if anything irrational
 * (pi, e, a function value) appears. Number literals go through their
 * shortest-round-trip decimal string, so the 0.1 a user typed becomes 1/10 —
 * not the 3602879701896397/36028797018963968 its double faithfully is.
 */
function constRat(e: Expr): Rat | null {
  switch (e.t) {
    case "num": {
      if (!Number.isFinite(e.v)) return null;
      const s = String(e.v);
      // Shortest-round-trip decimal, INCLUDING exponent notation — String(1e-10)
      // is "1e-10", and rejecting it cost 0.0000000001·x² its exact reading.
      const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(s);
      if (!m) return null;
      const sign = m[1] === "-" ? -1n : 1n;
      const whole = BigInt(m[2]);
      const fracDigits = m[3] ?? "";
      const exp = m[4] ? Number(m[4]) : 0;
      if (Math.abs(exp) > 400) return null;
      let n = sign * (whole * 10n ** BigInt(fracDigits.length) + BigInt(fracDigits || "0"));
      let d = 10n ** BigInt(fracDigits.length);
      if (exp > 0) n *= 10n ** BigInt(exp);
      else if (exp < 0) d *= 10n ** BigInt(-exp);
      return ratMake(n, d);
    }
    case "neg": {
      const v = constRat(e.e);
      return v ? ratNeg(v) : null;
    }
    case "add": case "sub": case "mul": case "div": {
      const l = constRat(e.l), r = constRat(e.r);
      if (!l || !r) return null;
      if (e.t === "add") return ratAdd(l, r);
      if (e.t === "sub") return ratSub(l, r);
      if (e.t === "mul") return ratMul(l, r);
      return ratIsZero(r) ? null : ratDiv(l, r);
    }
    case "pow": {
      const base = constRat(e.l), p = constRat(e.r);
      if (!base || !p || p.d !== 1n) return null;
      const k = Number(p.n);
      // 512, not 64: x² + 2^94 = 0 is a pinned display-contract case, and a
      // constant power is one bigint multiply per step.
      if (!Number.isInteger(k) || Math.abs(k) > 512) return null;
      let acc = ratInt(1);
      for (let i = 0; i < Math.abs(k); i++) acc = ratMul(acc, base);
      if (k < 0) {
        if (ratIsZero(acc)) return null;
        return ratDiv(ratInt(1), acc);
      }
      return acc;
    }
    default:
      return null; // var (pi, e, …) or fn — not rational
  }
}

/**
 * Numeric literals in `input` whose double does not round-trip to the typed
 * decimal (more digits than a double holds). Bounded: at most 200 literals.
 */
function lossyLiterals(input: string): string[] {
  const out: string[] = [];
  // No lookbehind: this module ships in the pane, and a regex SyntaxError at load
  // blanks it on WebViews older than Safari 16.4 (§E.8).
  const re = /(^|[^A-Za-z_\d.])((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(input)) && n++ < 200) {
    const lit = m[2];
    const typed = parseRatLiteral(lit);
    const read = parseRatLiteral(String(Number(lit)));
    if (typed && read && !ratEqual(typed, read)) out.push(lit);
  }
  return out;
}
const ratEqual = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;

/**
 * Exact rational coefficients [c0, c1, …] when the polynomial's constants are
 * all rational; null otherwise (the float path then handles it). This is what
 * lets x² = 2 answer sqrt(2), and x/3 = 5 answer 15, instead of decimals
 * wearing an [exact] tag they had not earned.
 */
function polyCoeffsRat(e: Expr, x: string): Rat[] | null {
  if (!containsVar(e, x)) {
    const v = constRat(e);
    return v ? [v] : null;
  }
  switch (e.t) {
    case "var": return e.name === x ? [ratInt(0), ratInt(1)] : null;
    case "neg": {
      const c = polyCoeffsRat(e.e, x);
      return c ? c.map(ratNeg) : null;
    }
    case "add": case "sub": {
      const a = polyCoeffsRat(e.l, x), b = polyCoeffsRat(e.r, x);
      if (!a || !b) return null;
      const out: Rat[] = new Array(Math.max(a.length, b.length)).fill(ratInt(0));
      a.forEach((v, k) => (out[k] = ratAdd(out[k], v)));
      b.forEach((v, k) => (out[k] = e.t === "add" ? ratAdd(out[k], v) : ratSub(out[k], v)));
      return out;
    }
    case "mul": {
      const a = polyCoeffsRat(e.l, x), b = polyCoeffsRat(e.r, x);
      if (!a || !b) return null;
      const out: Rat[] = new Array(a.length + b.length - 1).fill(ratInt(0));
      a.forEach((av, i) => b.forEach((bv, j) => (out[i + j] = ratAdd(out[i + j], ratMul(av, bv)))));
      return out;
    }
    case "div": {
      const denom = polyCoeffsRat(e.r, x);
      if (!denom || denom.length !== 1 || ratIsZero(denom[0])) return null;
      const num = polyCoeffsRat(e.l, x);
      return num ? num.map((v) => ratDiv(v, denom[0])) : null;
    }
    case "pow": {
      if (containsVar(e.r, x)) return null;
      const p = constRat(e.r);
      if (!p || p.d !== 1n) return null;
      const k = Number(p.n);
      if (!Number.isInteger(k) || k < 0 || k > 64) return null;
      const base = polyCoeffsRat(e.l, x);
      if (!base) return null;
      let acc: Rat[] = [ratInt(1)];
      for (let i = 0; i < k; i++) {
        const out: Rat[] = new Array(acc.length + base.length - 1).fill(ratInt(0));
        acc.forEach((av, ii) => base.forEach((bv, jj) => (out[ii + jj] = ratAdd(out[ii + jj], ratMul(av, bv)))));
        acc = out;
      }
      return acc;
    }
    default:
      return null;
  }
}

/**
 * Points where the expression is UNDEFINED because a denominator vanishes —
 * including denominators the canonicaliser would cancel away. (x²−1)/(x−1)
 * has a hole at x = 1 whether or not the algebra later removes the factor,
 * and an answer set that includes the hole is wrong, not merely unpolished.
 */
export function domainHoles(e: Expr, x: string): number[] {
  const out: number[] = [];
  const walk = (n: Expr): void => {
    switch (n.t) {
      case "num": case "var": return;
      case "neg": return walk(n.e);
      case "fn": return walk(n.arg);
      case "add": case "sub": case "mul": case "pow":
        walk(n.l); walk(n.r); return;
      case "div": {
        walk(n.l); walk(n.r);
        if (!containsVar(n.r, x)) return;
        const den = polyCoeffs(n.r, x);
        if (!den) return; // transcendental denominator — the scan handles its poles
        const trimmed = trimPoly(den);
        if (trimmed.length - 1 < 1) return;
        const roots = trimmed.length - 1 <= 2 ? solvePolyExactFloat(trimmed) : allPolyRoots(trimmed);
        for (const r of roots ?? []) {
          if (Math.abs(r.im) < 1e-9 && Number.isFinite(r.re)) out.push(r.re);
        }
        return;
      }
    }
  };
  walk(e);
  const uniq: number[] = [];
  for (const v of out.sort((a, b) => a - b)) {
    if (!uniq.length || Math.abs(v - uniq[uniq.length - 1]) > 1e-9) uniq.push(v);
  }
  return uniq.slice(0, 8);
}

/**
 * "No real solution EXISTS" when one side is a function whose range provably
 * excludes the other side's constant value: |·| is never negative, sin never
 * leaves [−1, 1], exp never reaches 0. Blaming "the range searched" for these
 * was a wrong excuse — the search range has nothing to do with it.
 */
function impossibleByRange(fnSide: Expr, constSide: Expr, x: string): string | null {
  if (containsVar(constSide, x) || !containsVar(fnSide, x)) return null;
  let c: number;
  try { c = evalAst(constSide, {}); } catch { return null; }
  if (!Number.isFinite(c)) return null;
  if (fnSide.t === "fn") {
    const name = fnSide.name;
    if (name === "abs" && c < 0) {
      return `No real solution exists: |·| is never negative, and the other side is ${fmtNum(c)}.`;
    }
    if (name === "sqrt" && c < 0) {
      return `No real solution exists: √ never returns a negative value, and the other side is ${fmtNum(c)}.`;
    }
    if (name === "exp" && c <= 0) {
      return `No real solution exists: exp(·) is always strictly positive, and the other side is ${fmtNum(c)}.`;
    }
    if ((name === "sin" || name === "cos") && Math.abs(c) > 1) {
      return `No real solution exists: ${name}(·) never leaves [−1, 1], and the other side is ${fmtNum(c)}.`;
    }
    if (name === "cosh" && c < 1) {
      return `No real solution exists: cosh(·) is never below 1, and the other side is ${fmtNum(c)}.`;
    }
  }
  // An even power of a real expression is never negative.
  if (fnSide.t === "pow" && !containsVar(fnSide.r, x) && c < 0) {
    try {
      const p = evalAst(fnSide.r, {});
      if (Number.isInteger(p) && p > 0 && p % 2 === 0) {
        return `No real solution exists: an even power is never negative, and the other side is ${fmtNum(c)}.`;
      }
    } catch { /* not constant */ }
  }
  return null;
}

/** Trailing-zero trim for exact coefficients; null when everything vanishes. */
function trimRat(c: Rat[]): Rat[] | null {
  let end = c.length;
  while (end > 0 && ratIsZero(c[end - 1])) end--;
  return end === 0 ? null : c.slice(0, end);
}

// ---------------------------------------------------------------------------
// Root finding.
// ---------------------------------------------------------------------------

export interface Root {
  display: string;
  re: number;
  im: number;
  exact: boolean;
  /** True for a symbolic (rearranged) solution like a = F/m; re/im are NaN then. */
  symbolic?: boolean;
  /** Multiplicity when > 1 (also shown in `display` as " (×m)"). */
  mult?: number;
}

/**
 * Trims leading coefficients that are zero RELATIVE TO THE REST of the polynomial.
 *
 * The threshold was absolute — `< 1e-12` — which is not a question about the
 * polynomial, it is a question about the units someone happened to type in.
 * `0.0000000000001*x^2 - 1 = 0` had its x² term deleted, became `-1 = 0`, and was
 * reported as **"no-solution"** with the caveat "No value of the variable
 * satisfies this equation." The true roots are ±3162277.66.
 *
 * It was a BAND, which is why no test found it: a 1e-8 coefficient works and a
 * 1e-12 one works, so sampling either side of 1e-13 certifies the bug. Scaling by
 * the largest coefficient asks the right question — is this term negligible in
 * THIS polynomial? — and is invariant under multiplying the whole equation by a
 * constant, which cannot change its roots.
 */
function trimPoly(c: number[]): number[] {
  const out = c.slice();
  // ONLY EXACT ZEROS. A non-zero leading coefficient, however small, means the
  // polynomial genuinely has that degree and genuinely has that many roots —
  // `1e-13*x^2 - 1 = 0` really does have roots at ±3162277.66, and deleting the
  // x² term reported "no solution" for an equation any student can solve.
  //
  // A relative threshold does not fix this, and my first attempt at one made it
  // worse in the opposite direction: scaling by the LARGEST coefficient meant
  // `x - 1e300 = 0` compared its x coefficient of 1 against 1e285 and deleted it,
  // so an equation with the root 1e300 came back "no solution". A big constant
  // term does not make the x term negligible. There is no threshold that is right
  // here, because the question "is this coefficient zero" is not a question about
  // magnitude at all.
  //
  // Cancellation produces EXACT zeros in floating point — subtracting two equal
  // doubles gives exactly 0 — so this still collapses `x^2 + x = x^2 + 1` to
  // degree 1, which is what the trim is for. The residual risk is a coefficient
  // left as rounding dust by something like 0.1*10 - 1, which would show up as a
  // spurious enormous root; solveEquation caveats that case rather than trimming
  // it away silently.
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

/**
 * A complex root, in the ONE convention this product uses.
 *
 * This used to build the string itself, and got it wrong twice in the same line.
 *
 * 1. IT MIXED TWO MINUS CHARACTERS. The sign between the parts was U+2212 while
 *    fmtNum emits an ASCII hyphen, so `x^3 - 2 = 0` displayed
 *    `-0.629960525 − 1.091123636i` — both glyphs in one string. Feeding that back
 *    into this file's own parseExpr threw `Unexpected character "−"`, breaking the
 *    rule that whatever is displayed must parse back if the user retypes it.
 *    (normalizeUnicodeMath now accepts U+2212 as well, so both halves of that are
 *    closed; this half makes the emitted string self-consistent.)
 *
 * 2. IT WROTE THE IMAGINARY UNIT AS `0 + 1i`. linalg.formatComplex — which renders
 *    eigenvalues in the SAME pane, one tab away — already special-cases a zero real
 *    part and a unit magnitude and gives `i` / `-i`. Two formatters, two
 *    conventions, one product. So this delegates rather than reimplementing.
 *
 * The 12 significant figures are fmtNum's own precision, passed through, so the
 * digits are unchanged. formatNum and fmtNum agree at 12 figures over the range
 * roots actually land in; they diverge only for integers of 13+ digits, where
 * fmtNum prints every digit and formatNum rounds to 12 (1234567890123 →
 * 1234567890120). No quadratic or Durand–Kerner root reaches that, and a root with
 * a non-zero imaginary part reaches it even less, but a non-finite value is kept on
 * fmtNum's wording regardless — formatNum renders those as "—", which is not
 * something a solver should offer as a root.
 */
function fmtRoot(re: number, im: number): string {
  const r = Math.abs(re) < 1e-10 ? 0 : re;
  const i = Math.abs(im) < 1e-10 ? 0 : im;
  if (i === 0) return fmtNum(r);
  // THE CONVENTIONS ARE BORROWED. THE DIGITS ARE NOT.
  //
  // Calling formatComplex outright looked like the tidier reuse and quietly
  // truncated exact roots: formatNum rounds to a significant-figure count, so
  // `x^2 + 2^94 = 0` displayed 140737488355000i for an imaginary part of
  // 140737488355328 — and did it on an object carrying `exact: true`. A rounded
  // number under an exactness flag is worse than either mistake alone, because the
  // flag is what tells the reader not to check.
  //
  // fmtNum prints an integer in full, so the digits below are the file's own and
  // unchanged. What is copied from formatComplex is only its SHAPE: a zero real
  // part gives a bare `i`/`-i`, a unit magnitude drops the redundant 1, and the
  // sign is an ASCII hyphen so the string re-parses. Kept in step by test, not by
  // a call that also decides precision.
  const mag = fmtNum(Math.abs(i));
  const imPart = mag === "1" ? "i" : `${mag}i`;
  if (r === 0) return i < 0 ? `-${imPart}` : imPart;
  return `${fmtNum(r)} ${i < 0 ? "-" : "+"} ${imPart}`;
}

/**
 * TRUE exact displays for rational-coefficient linear/quadratics: 1/3 stays
 * 1/3, x² = 2 answers sqrt(2), x² − x − 1 answers 1/2 + sqrt(5)/2. The float
 * value rides alongside for the ≈ readout. Returns null when the exact string
 * would be unreadable (a 60-digit fraction is faithful noise, not an answer) —
 * the caller then falls back to the decimal display WITHOUT the exact flag.
 */
const EXACT_DISPLAY_MAX = 48;

/** "n" or "n/d" (fmtSqrtRat's rational output) back into a Rat. */
function parseRatString(s: string): Rat | null {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s);
  if (!m) return null;
  return ratMake(BigInt(m[1]), BigInt(m[2] ?? "1"));
}

function exactRootsFromRat(rc: Rat[]): Root[] | null {
  const deg = rc.length - 1;
  const ok = (s: string): boolean => s.length <= EXACT_DISPLAY_MAX;
  if (deg === 1) {
    const root = ratDiv(ratNeg(rc[0]), rc[1]);
    const disp = fmtRat(root);
    return ok(disp) ? [{ display: disp, re: ratToNumber(root), im: 0, exact: true }] : null;
  }
  if (deg !== 2) return null;
  const [cc, b, a] = rc;
  const twoA = ratMul(ratInt(2), a);
  const p = ratDiv(ratNeg(b), twoA); // −b/2a
  const disc = ratSub(ratMul(b, b), ratMul(ratInt(4), ratMul(a, cc)));
  // The surd folds the /2a in: √disc/(2a) = √(disc/4a²) — one clean radical.
  const q2 = ratDiv(disc, ratMul(twoA, twoA));
  const pv = ratToNumber(p);
  if (ratIsZero(disc)) {
    const disp = fmtRat(p);
    return ok(disp) ? [{ display: disp, re: pv, im: 0, exact: true }] : null;
  }
  if (ratSign(disc) > 0) {
    const s = fmtSqrtRat(q2);
    if (!s) return null;
    const sv = sqrtRatToNumber(q2);
    // A PERFECT-SQUARE discriminant means the surd is a plain rational — the
    // roots must be ADDED into single fractions, not displayed as the
    // unsimplified sum ("-1/2 + 5/2" for the root 2 — the baseline caught it).
    const rationalS = !s.includes("sqrt") ? parseRatString(s) : null;
    if (rationalS) {
      const r1 = ratAdd(p, rationalS), r2 = ratSub(p, rationalS);
      const d1 = fmtRat(r1), d2 = fmtRat(r2);
      if (!ok(d1) || !ok(d2)) return null;
      return [
        { display: d1, re: ratToNumber(r1), im: 0, exact: true },
        { display: d2, re: ratToNumber(r2), im: 0, exact: true },
      ];
    }
    const zeroP = ratIsZero(p);
    const d1 = zeroP ? s : `${fmtRat(p)} + ${s}`;
    const d2 = zeroP ? `-${s}` : `${fmtRat(p)} - ${s}`;
    if (!ok(d1) || !ok(d2)) return null;
    return [
      { display: d1, re: pv + sv, im: 0, exact: true },
      { display: d2, re: pv - sv, im: 0, exact: true },
    ];
  }
  // Complex pair: −b/2a ± √(−disc/4a²)·i, in the product's complex conventions
  // (bare i for a unit part, no "0 +", ASCII hyphen).
  const s = fmtSqrtRat(ratNeg(q2));
  if (!s) return null;
  const sv = sqrtRatToNumber(ratNeg(q2));
  // "2/3i" re-parses as 2/(3·i) — worse, it trips the deliberate 1/2x
  // ambiguity refusal. Only a bare integer may juxtapose the i; a fraction or
  // surd multiplies it explicitly.
  const imPart = s === "1" ? "i" : /^\d+$/.test(s) ? `${s}i` : `${s}*i`;
  const zeroP = ratIsZero(p);
  const d1 = zeroP ? imPart : `${fmtRat(p)} + ${imPart}`;
  const d2 = zeroP ? `-${imPart}` : `${fmtRat(p)} - ${imPart}`;
  if (!ok(d1) || !ok(d2)) return null;
  return [
    { display: d1, re: pv, im: sv, exact: true },
    { display: d2, re: pv, im: -sv, exact: true },
  ];
}

/** Exact roots of a linear or quadratic; null if degree is not 1 or 2. */
function solvePolyExact(coeffs: number[], rat?: Rat[] | null): Root[] | null {
  const c = trimPoly(coeffs);
  const deg = c.length - 1;
  // The exact-rational route first: same degree required, so float-noise
  // trimming disagreements fall back to the numeric display honestly.
  if (rat) {
    const rc = trimRat(rat);
    if (rc && rc.length - 1 === deg && deg >= 1 && deg <= 2) {
      const exact = exactRootsFromRat(rc);
      if (exact) return exact;
      // Exact form too unwieldy: decimal display, and NO exact flag — a
      // rounded decimal of an irrational value is not an exact answer.
      const numeric = solvePolyExactFloat(c);
      return numeric ? numeric.map((r) => ({ ...r, exact: false })) : null;
    }
  }
  const viaFloat = solvePolyExactFloat(c);
  if (!viaFloat) return null;
  // No rational reading of the coefficients (π, e, function values …): the
  // roots are genuine but the DISPLAY is a rounded decimal — labelling that
  // [exact] was the mislabel the audit caught (2πr = 10 → “1.59… exact”).
  return rat === undefined ? viaFloat : viaFloat.map((r) => ({ ...r, exact: false }));
}

function solvePolyExactFloat(c: number[]): Root[] | null {
  const deg = c.length - 1;
  if (deg === 1) {
    const root = -c[0] / c[1];
    return [{ display: fmtNum(root), re: root, im: 0, exact: true }];
  }
  if (deg === 2) {
    const [cc, b, a] = c;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const r1 = (-b + s) / (2 * a);
      const r2 = (-b - s) / (2 * a);
      // "IS THE DISCRIMINANT ZERO" IS A RELATIVE QUESTION.
      //
      // The test was `|disc| < 1e-12`, an absolute threshold on a quantity whose
      // size is set by the coefficients. `0.0000000001*x^2 - 0.0001 = 0` has
      // disc = 4e-14, so the two roots ±1000 were collapsed into the single root
      // **1000** and labelled `exact (quadratic)`. Half the answer, presented as
      // certain. Another band — 1e-7 coefficients fail the same way, 1e-6 ones do
      // not.
      //
      // The discriminant scales as coefficient², so the yardstick must too.
      // Comparing against b² and 4ac keeps this invariant under multiplying the
      // whole equation through by a constant, which cannot change its roots.
      const discScale = Math.max(Math.abs(b * b), Math.abs(4 * a * cc));
      const discIsZero = discScale > 0
        ? Math.abs(disc) <= discScale * Number.EPSILON * 8
        : Math.abs(disc) < 1e-12;
      if (discIsZero) return [{ display: fmtNum(r1), re: r1, im: 0, exact: true }];
      return [
        { display: fmtNum(r1), re: r1, im: 0, exact: true },
        { display: fmtNum(r2), re: r2, im: 0, exact: true },
      ].sort((x, y) => y.re - x.re);
    }
    const re = -b / (2 * a);
    const im = Math.sqrt(-disc) / (2 * a);
    return [
      { display: fmtRoot(re, im), re, im, exact: true },
      { display: fmtRoot(re, -im), re, im: -im, exact: true },
    ];
  }
  return null;
}

// ---------------------------------------------------------------------------
// All roots of a polynomial (real AND complex) via Durand–Kerner. This is what
// makes degree-≥3 solving COMPLETE — a scan for real roots in a range could only
// ever find some of them. Self-contained complex arithmetic; no external deps.
// ---------------------------------------------------------------------------

interface Cx { re: number; im: number }
const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cDiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);

/** Evaluates a polynomial (ascending coeffs) at a complex point via Horner. */
function polyEvalCx(coeffs: number[], z: Cx): Cx {
  let acc: Cx = { re: 0, im: 0 };
  for (let i = coeffs.length - 1; i >= 0; i--) acc = cAdd(cMul(acc, z), { re: coeffs[i], im: 0 });
  return acc;
}

/**
 * Snaps a value to the nearest NON-ZERO integer when it is within a RELATIVE
 * tolerance; otherwise leaves it at full precision.
 *
 * It used to round to 1e-9 ABSOLUTE (and snap to an integer within 1e-7
 * absolute), which is a statement about the units, not the root:
 * x³ − 1234567x + 1 = 0 printed its small root 8.10000591300e-7 as "8.1e-7"
 * (§A finding 9). Rational-coefficient polynomials no longer come here at all
 * (polyRoots.ts); this is the π/e-coefficient path.
 */
function snap(v: number): number {
  const r = Math.round(v);
  if (r !== 0 && Math.abs(v - r) <= 1e-9 * Math.abs(v)) return r;
  return v;
}

/**
 * All roots of a polynomial of degree ≥ 1 (ascending coeffs), real and complex,
 * by Durand–Kerner iteration. Equal roots are collapsed and their multiplicity
 * reported. Roots are numerical but complete — every one is returned.
 */
function allPolyRoots(coeffs: number[]): Root[] {
  const c = trimPoly(coeffs);
  const n = c.length - 1;
  const lead = c[n];
  const monic = c.map((v) => v / lead);

  // Seed with distinct points off the real axis to avoid symmetric stalls.
  const seed: Cx = { re: 0.4, im: 0.9 };
  const roots: Cx[] = [];
  let p: Cx = { re: 1, im: 0 };
  for (let k = 0; k < n; k++) {
    roots.push({ ...p });
    p = cMul(p, seed);
  }

  for (let iter = 0; iter < 1000; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < n; k++) {
      let denom: Cx = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) if (j !== k) denom = cMul(denom, cSub(roots[k], roots[j]));
      if (cAbs(denom) < 1e-300) continue; // coincident guesses; nudge next round
      const delta = cDiv(polyEvalCx(monic, roots[k]), denom);
      roots[k] = cSub(roots[k], delta);
      maxDelta = Math.max(maxDelta, cAbs(delta));
    }
    if (maxDelta < 1e-14) break;
  }

  // Snap, split real/complex, collapse equal roots into multiplicities.
  // RELATIVE throughout (§E.2): an imaginary or real part is dust only next to
  // the root's own size, and two roots are "equal" only relative to theirs.
  const cleaned = roots.map((z) => {
    const mag = cAbs(z);
    const im = Math.abs(z.im) <= 1e-7 * mag ? 0 : snap(z.im);
    const re = im !== 0 && Math.abs(z.re) <= 1e-12 * mag ? 0 : snap(z.re);
    return { re, im };
  });
  const groups: { re: number; im: number; mult: number }[] = [];
  for (const z of cleaned) {
    const g = groups.find((h) => cAbs(cSub(h, z)) <= 1e-6 * Math.max(cAbs(h), cAbs(z)));
    if (g) g.mult++;
    else groups.push({ ...z, mult: 1 });
  }
  const show = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(10)));
  return groups
    .sort((a, b) => b.re - a.re || a.im - b.im)
    .map((g) => ({
      display: fmtRoot(show(g.re), show(g.im)) + (g.mult > 1 ? ` (×${g.mult})` : ""),
      re: g.re,
      im: g.im,
      exact: false,
      ...(g.mult > 1 ? { mult: g.mult } : {}),
    }));
}

/** Real roots of f in [lo, hi] by scanning for sign changes, then bisecting. */
function numericRealRoots(f: (x: number) => number, lo: number, hi: number, steps = 4000): Root[] {
  const roots: Root[] = [];

  // A SIGN CHANGE IS NOT A ROOT. IT IS A SIGN CHANGE.
  //
  // Bisection used to stop on `|f(m)| < 1e-13` OR on the interval getting narrow,
  // and accept the midpoint either way. Across a POLE the function also changes
  // sign — from -infinity to +infinity — so the interval duly narrowed onto the
  // pole and the pole was reported as a root:
  //
  //   solveEquation("1/(x-2.25) = 0")     -> root 2.25, where f = -1.1e12
  //   solveEquation("x/(x-2.25) = 1")     -> root 2.25, residual -2.5e12
  //   solveEquation("tan(x) = 2")         -> 1176 "roots" ALTERNATING real
  //                                          solutions and asymptotes
  //
  // `1/(x-2) = 0` looked correct only by accident: the scan grid lands exactly on
  // 2, so evalAst gives Infinity and the sign test is skipped. Move the pole off
  // the grid and it reappears — the hallmark of a sampling artefact, not a fix.
  //
  // So a candidate is now accepted only if the residual is actually small, judged
  // against the size of f nearby rather than against an absolute constant: a
  // legitimately steep function can have a real root whose residual is not tiny,
  // and demanding |f| < 1e-13 outright would silently discard real answers. The
  // local scale comes from f a little to each side of the candidate, so a pole —
  // where those values are astronomically large — cannot pass, while a steep but
  // finite crossing can.
  const residualIsSmall = (m: number, fm: number): boolean => {
    if (!Number.isFinite(fm)) return false;
    if (fm === 0) return true;
    const step = Math.max(Math.abs(m), 1) * 1e-6;
    let near = 0;
    for (const d of [-step, step]) {
      const v = f(m + d);
      if (Number.isFinite(v)) near = Math.max(near, Math.abs(v));
    }
    // At a genuine root, |f| just off the root is of order |f'|*step, and |f(m)|
    // is far smaller still. At a pole, |f(m)| is comparable to or larger than the
    // neighbourhood and both are enormous. The 1e-6 factor is the margin.
    if (near > 0 && Math.abs(fm) > near * 1e-6) return false;
    // CANCELLATION NOISE IS NOT A ROOT EITHER.
    //
    // `cosh(x)^2 - sinh(x)^2 = 1` is an identity, but the two squares are ~1e86 at
    // x = 100, so the computed difference is rounding dust of order 1e70 — the true
    // answer of 1 is far below the noise. Wherever that dust happens to land on
    // zero, the scan called it a root: 33 of them. A genuine root of a typed
    // equation has |f| just off the root of order |f'|*h, which is modest; a
    // function that swings by 1e15 within a hair's breadth of its "root" is not
    // being evaluated accurately enough for the answer to mean anything.
    if (near > 1e15) return false;
    return Math.abs(fm) < 1e-6 * Math.max(1, near);
  };

  const push = (x: number, fx: number) => {
    if (!Number.isFinite(x)) return;
    if (!residualIsSmall(x, fx)) return;
    if (roots.some((r) => Math.abs(r.re - x) < 1e-6)) return;
    roots.push({ display: fmtNum(x), re: x, im: 0, exact: false });
  };

  const h = (hi - lo) / steps;
  let prevX = lo;
  let prevY = f(lo);
  if (Math.abs(prevY) < 1e-10) push(lo, prevY);
  for (let k = 1; k <= steps; k++) {
    const cx = lo + k * h;
    const cy = f(cx);
    if (Number.isFinite(prevY) && Number.isFinite(cy) && prevY * cy < 0) {
      // Bisection on [prevX, cx].
      let a = prevX, b = cx, fa = prevY;
      let done = false;
      for (let it = 0; it < 80; it++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (Math.abs(fm) < 1e-13 || (b - a) / 2 < 1e-12) { push(m, fm); done = true; break; }
        if (fa * fm < 0) b = m;
        else { a = m; fa = fm; }
      }
      if (!done) {
        const m = (a + b) / 2;
        push(m, f(m));
      }
    } else if (Math.abs(cy) < 1e-10) {
      push(cx, cy);
    }
    prevX = cx; prevY = cy;
  }
  return roots.sort((x, y) => y.re - x.re);
}

// ---------------------------------------------------------------------------
// Trigonometric equations — GENERAL solutions, not a wall of numeric roots.
//
// sin(x) = 1/2 has infinitely many solutions, and the numeric scan reported
// 637 of them — one line each, into the pane and into Word. The mathematics
// is two FAMILIES: x = π/6 + 2πn and x = 5π/6 + 2πn. This section detects
// trig(a·x + b) = c (and quadratics in one trig atom), answers with the exact
// families — special angles exact, others as asin/acos/atan values — and
// reports the principal solutions as the roots.
// ---------------------------------------------------------------------------

/** "n·π/d" rendered cleanly: 0, pi, -pi/6, 5*pi/6, 2*pi. Always re-parseable. */
function piStr(n: number, d: number): string {
  if (n === 0) return "0";
  // Reduce.
  const g = ((): number => { let a = Math.abs(n), b = d; while (b) { const t = a % b; a = b; b = t; } return a || 1; })();
  const nn = n / g, dd = d / g;
  const core = Math.abs(nn) === 1 ? "pi" : `${Math.abs(nn)}*pi`;
  const frac = dd === 1 ? core : `${core}/${dd}`;
  return nn < 0 ? `-${frac}` : frac;
}

/**
 * u₀ for trig(u) = t: an exact rational multiple of π when t is a special
 * value (pi = [n, d] meaning u₀ = n·π/d), else the numeric principal value.
 */
function principalAngle(
  fn: "sin" | "cos" | "tan", t: number
): { disp: string; val: number; exact: boolean; pi?: [number, number] } | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-12;
  const withPi = (n: number, d: number): { disp: string; val: number; exact: true; pi: [number, number] } =>
    ({ disp: piStr(n, d), val: (n * Math.PI) / d, exact: true, pi: [n, d] });
  if (fn === "tan") {
    const TAN_PI: [number, [number, number]][] = [[0, [0, 1]], [Math.sqrt(3) / 3, [1, 6]], [1, [1, 4]], [Math.sqrt(3), [1, 3]]];
    for (const [tv, [n, d]] of TAN_PI) {
      if (near(Math.abs(t), tv)) return withPi(t < 0 ? -n : n, d);
    }
    const v = Math.atan(t);
    return { disp: fmtNum(v), val: v, exact: false };
  }
  if (Math.abs(t) > 1) return null;
  if (fn === "sin") {
    const SIN_PI: [number, [number, number]][] = [[0, [0, 1]], [0.5, [1, 6]], [Math.SQRT2 / 2, [1, 4]], [Math.sqrt(3) / 2, [1, 3]], [1, [1, 2]]];
    for (const [tv, [n, d]] of SIN_PI) {
      if (near(Math.abs(t), tv)) return withPi(t < 0 ? -n : n, d);
    }
    const v = Math.asin(t);
    return { disp: fmtNum(v), val: v, exact: false };
  }
  const COS_PI: [number, [number, number]][] = [
    [1, [0, 1]], [Math.sqrt(3) / 2, [1, 6]], [Math.SQRT2 / 2, [1, 4]], [0.5, [1, 3]], [0, [1, 2]],
    [-0.5, [2, 3]], [-Math.SQRT2 / 2, [3, 4]], [-Math.sqrt(3) / 2, [5, 6]], [-1, [1, 1]],
  ];
  for (const [tv, [n, d]] of COS_PI) {
    if (near(t, tv)) return withPi(n, d);
  }
  const v = Math.acos(t);
  return { disp: fmtNum(v), val: v, exact: false };
}

/** Finds the single trig atom trig(a·x+b) the expression is a polynomial in. */
function trigAtomOf(e: Expr, x: string): { fn: "sin" | "cos" | "tan"; arg: Expr; key: string } | null {
  let found: { fn: "sin" | "cos" | "tan"; arg: Expr; key: string } | null = null;
  let bad = false;
  const walk = (n: Expr): void => {
    if (bad) return;
    switch (n.t) {
      case "num": case "var": return;
      case "neg": return walk(n.e);
      case "fn": {
        if ((n.name === "sin" || n.name === "cos" || n.name === "tan") && containsVar(n.arg, x)) {
          const key = `${n.name}(${format(n.arg)})`;
          if (found && found.key !== key) { bad = true; return; }
          if (!found) found = { fn: n.name, arg: n.arg, key };
          return; // do not walk inside — the atom is opaque
        }
        if (containsVar(n.arg, x)) { bad = true; return; }
        return;
      }
      default: walk(n.l); walk(n.r);
    }
  };
  walk(e);
  return bad ? null : found;
}

/** Replaces every occurrence of the atom with a fresh variable. */
function substAtom(e: Expr, key: string, x: string, t: string): Expr {
  switch (e.t) {
    case "num": case "var": return e;
    case "neg": return { t: "neg", e: substAtom(e.e, key, x, t) };
    case "fn":
      if (`${e.name}(${format(e.arg)})` === key) return { t: "var", name: t };
      return { t: "fn", name: e.name, arg: substAtom(e.arg, key, x, t) };
    default:
      return { t: e.t, l: substAtom(e.l, key, x, t), r: substAtom(e.r, key, x, t) } as Expr;
  }
}

/**
 * General solutions for equations that are a (≤ quadratic) polynomial in ONE
 * trig atom with a LINEAR argument. Returns null when the shape does not
 * match, so the numeric scan keeps its jurisdiction.
 */
function tryTrigGeneral(f: Expr, x: string, vars: string[]): EquationResult | null {
  const atom = trigAtomOf(f, x);
  if (!atom) return null;
  const argC = polyCoeffs(atom.arg, x);
  if (!argC) return null;
  const argT = trimPoly(argC);
  if (argT.length !== 2) return null; // linear argument only
  const [b, a] = argT;
  if (!Number.isFinite(a) || a === 0) return null;

  const T = "__trig_t";
  const inT = substAtom(f, atom.key, x, T);
  if (containsVar(inT, x)) return null; // x survives outside the atom
  const poly = polyCoeffs(inT, T);
  if (!poly) return null;
  const pt = trimPoly(poly);
  const deg = pt.length - 1;
  if (deg < 1 || deg > 2) return null;

  // Solve the polynomial for t = trig(u), exactly where possible.
  const tRoots = solvePolyExact(pt, polyCoeffsRat(inT, T)) ?? [];
  const steps: string[] = [];
  const caveats: string[] = [];
  if (deg === 2) {
    steps.push(`Substituting t = ${atom.key}: the equation is quadratic in t.`);
  }
  const period = (2 * Math.PI) / Math.abs(a);
  const periodTxt = atom.fn === "tan"
    ? (a === 1 ? "pi" : `pi/${fmtNum(Math.abs(a))}`)
    : (a === 1 ? "2*pi" : `2*pi/${fmtNum(Math.abs(a))}`);

  const roots: Root[] = [];
  const families: string[] = [];
  let anyReal = false;

  for (const tr of tRoots) {
    if (Math.abs(tr.im) > 1e-10) {
      steps.push(`t = ${tr.display} is complex — no real ${atom.fn} value reaches it.`);
      continue;
    }
    let t = tr.re;
    let clampedNoise = false;
    if (atom.fn !== "tan" && Math.abs(t) > 1) {
      // EXACT t outside [−1, 1] is a refusal, full stop — an exactly-computed
      // 1 + 1e-13 means the equation has NO solution, and clamping it to 1
      // answered ±π/2 [exact] for an unsolvable equation. Only a FLOAT-path t
      // within double-precision noise of ±1 is treated as ±1, and it says so.
      if (tr.exact || Math.abs(t) - 1 > 1e-12) {
        steps.push(`t = ${tr.display} lies outside [−1, 1] — ${atom.fn}(·) never reaches it.`);
        continue;
      }
      caveats.push(
        `t = ${tr.display} exceeds ${t > 0 ? "1" : "−1"} by less than double-precision noise and was treated as ` +
        `${t > 0 ? "1" : "−1"}. If your coefficients are exact, this branch has NO solution.`
      );
      t = Math.sign(t);
      clampedNoise = true;
    }
    // No clamp for tan — clamping turned every |t| > 1 into tan = 1 and
    // answered π/4 for tan(x) = 2.
    const p0 = principalAngle(atom.fn, t);
    if (!p0) continue;
    if (clampedNoise) p0.exact = false;
    anyReal = true;

    // u families, then x = (u − b)/a.
    const uFamilies: { disp: string; val: number; pi?: [number, number] }[] = [];
    uFamilies.push({ disp: p0.disp, val: p0.val, pi: p0.pi });
    if (atom.fn === "sin" && Math.abs(t) < 1 - 1e-12) {
      // The reflection family: π − u₀, folded into one clean π fraction
      // (π − π/6 is 5π/6, not the unsimplified difference).
      const alt = Math.PI - p0.val;
      uFamilies.push(
        p0.pi
          ? { disp: piStr(p0.pi[1] - p0.pi[0], p0.pi[1]), val: alt, pi: [p0.pi[1] - p0.pi[0], p0.pi[1]] }
          : { disp: fmtNum(alt), val: alt }
      );
    } else if (atom.fn === "cos" && Math.abs(t) < 1 - 1e-12) {
      uFamilies.push(
        p0.pi
          ? { disp: piStr(-p0.pi[0], p0.pi[1]), val: -p0.val, pi: [-p0.pi[0], p0.pi[1]] }
          : { disp: fmtNum(-p0.val), val: -p0.val }
      );
    }

    for (const u of uFamilies) {
      // x = (u − b)/a, period 2π/|a| (π/|a| for tan).
      const xv = (u.val - b) / a;
      const simple = a === 1 && b === 0;
      let baseDisp: string;
      let isExact = p0.exact && simple;
      if (simple) {
        baseDisp = u.disp;
      } else if (b === 0 && u.pi && Number.isInteger(a)) {
        // An exact π fraction divides through: (π/2)/2 is π/4, not a nest.
        baseDisp = piStr(a > 0 ? u.pi[0] : -u.pi[0], u.pi[1] * Math.abs(a));
        isExact = p0.exact;
      } else if (b === 0) {
        baseDisp = `(${u.disp})/${fmtNum(a)}`;
      } else if (a === 1) {
        baseDisp = `${u.disp} ${b < 0 ? "+" : "-"} ${fmtNum(Math.abs(b))}`;
      } else {
        baseDisp = `(${u.disp} ${b < 0 ? "+" : "-"} ${fmtNum(Math.abs(b))})/${fmtNum(a)}`;
      }
      families.push(`${x} = ${baseDisp} + ${periodTxt}*n`);
      roots.push({
        display: baseDisp,
        re: xv,
        im: 0,
        exact: isExact,
      });
    }
  }

  if (!tRoots.length || (!anyReal && tRoots.length)) {
    if (!anyReal && tRoots.length) {
      return {
        variable: x, roots: [], method: "no-solution", steps,
        caveats: [`No real solution exists: every value ${atom.key} would need is outside its range.`],
        unknowns: vars,
      };
    }
    return null;
  }

  steps.push(`General solution famil${families.length === 1 ? "y" : "ies"} (n any integer): ${families.join(" ; ")}.`);
  caveats.push(
    `A trigonometric equation has infinitely many solutions. The root${roots.length === 1 ? "" : "s"} shown ` +
    `${roots.length === 1 ? "is" : "are"} the principal one${roots.length === 1 ? "" : "s"} (n = 0); ` +
    `add ${periodTxt}·n for every integer n.`
  );
  return {
    variable: x,
    roots: roots.sort((p, q) => p.re - q.re),
    method: "trig (general solution)",
    steps,
    caveats,
    unknowns: vars,
  };
}

// ---------------------------------------------------------------------------
// Exponential and logarithmic equations — EXACT closed forms.
//
// 5^x = 3 is x = ln(3)/ln(5), not 0.682606194486; 2^x = 8 is exactly 3.
// The shapes handled: exp(u) = c, a^u = c, ln(u) = c, log10(u) = c,
// log2(u) = c with u LINEAR in x and the other side constant. Everything
// else keeps its numeric path.
// ---------------------------------------------------------------------------

function tryExpLogExact(fnSide: Expr, constSide: Expr, x: string, vars: string[], f: Expr): EquationResult | null {
  if (containsVar(constSide, x) || !containsVar(fnSide, x)) return null;
  let c: number;
  try { c = evalAst(constSide, {}); } catch { return null; }
  if (!Number.isFinite(c)) return null;
  const cRat = constRat(constSide);

  /** Solves linear u(x) = value and packages the result. */
  const finish = (
    u: Expr, uDisp: string, uVal: number, uExact: boolean, method: string, steps: string[]
  ): EquationResult | null => {
    const uc = polyCoeffs(u, x);
    if (!uc) return null;
    const ut = trimPoly(uc);
    if (ut.length !== 2 || ut[1] === 0) return null;
    const [b, a] = ut;
    const xv = (uVal - b) / a;
    const simple = a === 1 && b === 0;
    let disp: string;
    // A plain-rational u folds all the way through: 3^(x+1) = 81 answers 3,
    // not ((4) - 1)/1.
    const uRatStr = /^-?\d+(?:\/\d+)?$/.test(uDisp) ? parseRatString(uDisp) : null;
    const bRat = constRat({ t: "num", v: b } as Expr);
    const aRat2 = constRat({ t: "num", v: a } as Expr);
    if (uRatStr && bRat && aRat2 && !ratIsZero(aRat2)) {
      disp = fmtRat(ratDiv(ratSub(uRatStr, bRat), aRat2));
    } else if (simple) {
      disp = uDisp;
    } else if (b === 0) {
      disp = `${uDisp.includes(" ") ? `(${uDisp})` : uDisp}/${fmtNum(a)}`;
    } else if (a === 1) {
      disp = `${uDisp} ${b < 0 ? "+" : "-"} ${fmtNum(Math.abs(b))}`;
    } else {
      disp = `(${uDisp} ${b < 0 ? "+" : "-"} ${fmtNum(Math.abs(b))})/${fmtNum(a)}`;
    }
    // Verify by substitution — an exact-looking answer that does not satisfy
    // the equation is worse than a numeric one.
    try {
      const resid = evalAst(f, { [x]: xv });
      if (!Number.isFinite(resid) || Math.abs(resid) > 1e-6 * Math.max(1, Math.abs(c))) return null;
    } catch { return null; }
    // The SAME display cap the quadratic exact path honours: 2^x = 1e300 has
    // the exact answer ln(10^300)/ln(2), whose 301-digit literal is faithful
    // noise, not an answer — decimal display, no exact flag.
    let exactFlag = uExact;
    if (disp.length > EXACT_DISPLAY_MAX) {
      disp = fmtNum(xv);
      exactFlag = false;
    }
    return {
      variable: x,
      roots: [{ display: disp, re: xv, im: 0, exact: exactFlag }],
      method,
      steps,
      caveats: [],
      unknowns: vars,
    };
  };

  if (fnSide.t === "fn" && containsVar(fnSide.arg, x)) {
    if (fnSide.name === "exp") {
      if (c <= 0) return null; // impossibleByRange already names this
      const uDisp = c === 1 ? "0" : cRat ? `ln(${fmtRat(cRat)})` : fmtNum(Math.log(c));
      return finish(fnSide.arg, uDisp, Math.log(c), !!cRat || c === 1,
        "exact (exponential)", [`exp(u) = ${fmtNum(c)} ⇒ u = ln(${fmtNum(c)}).`]);
    }
    if (fnSide.name === "ln") {
      const uDisp = c === 0 ? "1" : cRat ? `exp(${fmtRat(cRat)})` : fmtNum(Math.exp(c));
      return finish(fnSide.arg, uDisp, Math.exp(c), !!cRat,
        "exact (logarithmic)", [`ln(u) = ${fmtNum(c)} ⇒ u = e^${fmtNum(c)}.`]);
    }
    if (fnSide.name === "log10" || fnSide.name === "log2") {
      const base = fnSide.name === "log10" ? 10 : 2;
      const uVal = Math.pow(base, c);
      const uDisp = Number.isInteger(c) && Math.abs(c) <= 30
        ? fmtNum(uVal)
        : cRat ? `${base}^(${fmtRat(cRat)})` : fmtNum(uVal);
      return finish(fnSide.arg, uDisp, uVal, Number.isInteger(c),
        "exact (logarithmic)", [`${fnSide.name}(u) = ${fmtNum(c)} ⇒ u = ${base}^${fmtNum(c)}.`]);
    }
    return null;
  }

  // a^u = c with a positive rational constant base.
  if (fnSide.t === "pow" && !containsVar(fnSide.l, x) && containsVar(fnSide.r, x)) {
    const aRat = constRat(fnSide.l);
    let aVal: number;
    try { aVal = evalAst(fnSide.l, {}); } catch { return null; }
    if (!Number.isFinite(aVal) || aVal <= 0 || aVal === 1) return null;
    if (c <= 0) {
      return {
        variable: x, roots: [], method: "no-solution", steps: [],
        caveats: [`No real solution exists: ${fmtNum(aVal)}^u is always strictly positive, and the other side is ${fmtNum(c)}.`],
        unknowns: vars,
      };
    }
    // Clean integer power first: 2^x = 8 is exactly 3, not ln(8)/ln(2).
    // ±128, so 2^x = 2^94 folds to 94 instead of a 29-digit ln fraction.
    if (aRat && cRat) {
      for (let k = -128; k <= 128; k++) {
        let acc = ratInt(1);
        const steps = Math.abs(k);
        for (let i = 0; i < steps; i++) acc = ratMul(acc, aRat);
        const powK = k >= 0 ? acc : ratDiv(ratInt(1), acc);
        if (ratIsZero(ratSub(powK, cRat))) {
          return finish(fnSide.r, String(k), k, true,
            "exact (exponential)", [`${fmtRat(aRat)}^u = ${fmtRat(cRat)} ⇒ u = ${k} exactly.`]);
        }
      }
    }
    const uVal = Math.log(c) / Math.log(aVal);
    const uDisp = aRat && cRat ? `ln(${fmtRat(cRat)})/ln(${fmtRat(aRat)})` : fmtNum(uVal);
    return finish(fnSide.r, uDisp, uVal, !!(aRat && cRat),
      "exact (exponential)", [`${fmtNum(aVal)}^u = ${fmtNum(c)} ⇒ u = ln(${fmtNum(c)})/ln(${fmtNum(aVal)}).`]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: equation solving
// ---------------------------------------------------------------------------

export interface EquationResult {
  variable: string;
  roots: Root[];
  method: string;
  steps: string[];
  caveats: string[];
  /** Every unknown in the equation — lets a caller offer "solve for …" choices. */
  unknowns?: string[];
}

/**
 * Numeric back-substitution check for symbolic solutions whose exact
 * verification is blocked by an opaque sqrt atom (the quadratic branches):
 * assign fixed sample values to the other symbols, evaluate the root, and
 * require f(root) ≈ 0 at every sample where the root is real and finite.
 * Deterministic — a fixed sample table, no RNG.
 */
const VERIFY_SAMPLES = [1, 2, 0.7, -1.3, 3.1, -0.6, 1.9, -2.4];

function verifySymbolicRoots(f: Expr, x: string, roots: Expr[], others: string[]): boolean {
  let checked = 0;
  for (let s = 0; s < VERIFY_SAMPLES.length; s++) {
    const vars: Record<string, number> = {};
    others.forEach((v, i) => {
      vars[v] = VERIFY_SAMPLES[(s + i * 3) % VERIFY_SAMPLES.length] + s * 0.17;
    });
    for (const root of roots) {
      let rv: number;
      let resid: number;
      try {
        rv = evalAst(root, vars);
        if (!Number.isFinite(rv)) continue; // complex branch at this sample
        resid = evalAst(f, { ...vars, [x]: rv });
      } catch {
        continue;
      }
      if (!Number.isFinite(resid)) continue; // sample hit a pole
      checked++;
      if (Math.abs(resid) > 1e-6 * (1 + Math.abs(rv))) return false;
    }
  }
  return checked > 0;
}

/**
 * Solves an equation for one unknown. Accepts "LHS = RHS" (an expression alone
 * is treated as "= 0"). Linear/quadratic are exact; anything else is solved
 * numerically over a real interval. Returns null if the input cannot be parsed.
 */
/**
 * "f(x) = body" is a FUNCTION DEFINITION, the textbook's own notation — and
 * it parsed to NOTHING ('Unknown function "f"'). When the name is a single
 * unknown function of one bare variable, the definition is read as
 * y = body (or the function's own name if y is taken), with a step saying so.
 */
function readFnDefinition(input: string): { rewritten: string; arg: string; body: string; note: string } | null {
  const m = /^\s*([a-zA-Z]\w*)\s*\(\s*([a-zA-Z]\w*)\s*\)\s*=\s*([^=]+)$/.exec(input);
  if (!m) return null;
  const [, name, arg, body] = m;
  // CASE-INSENSITIVE: Word's sentence-start AutoCorrect makes "Sin(x) = 1/2"
  // routine, and reading it as a definition answered y = 1/2 with confidence.
  const lower = name.toLowerCase();
  // sin(x) = 1/2 is an EQUATION; u(x) = x^2 is a definition (u is a bare-ok name).
  if ((lower in EVAL_FN && !BARE_OK.has(lower)) || lower === "pi" || lower === "e") return null;
  if (!body.trim()) return null;
  const out = body.includes("y") || arg === "y" ? name : "y";
  return {
    rewritten: `${out} = ${body}`,
    arg,
    body,
    note: `Read “${name}(${arg}) = …” as a function DEFINITION: ${out} stands for the output ${name}(${arg}).`,
  };
}

export function solveEquation(input: string, variable?: string, range = 1000): EquationResult | null {
  const fnDef = readFnDefinition(input);
  if (fnDef) {
    // Default to the DEFINITION'S variable: f(x) = 2x + 1 solves for x
    // straight away (the solve-for chips still offer y).
    const inner = solveEquation(fnDef.rewritten, variable ?? fnDef.arg, range);
    if (!inner) return null;
    return { ...inner, steps: [fnDef.note, ...inner.steps] };
  }
  let lhs: Expr, rhs: Expr;
  try {
    const parts = input.split("=");
    if (parts.length > 2) return null;
    lhs = parseExpr(parts[0]);
    rhs = parts.length === 2 ? parseExpr(parts[1]) : N(0);
  } catch {
    return null;
  }
  // f = LHS - RHS, solve f = 0.
  const f: Expr = { t: "sub", l: lhs, r: rhs };
  const vars = freeVars(f);
  const x = variable ?? (vars.length === 1 ? vars[0] : vars.includes("x") ? "x" : vars[0]);
  if (!x) return null; // no unknown at all
  if (!variable && vars.length > 1) {
    return {
      variable: x,
      roots: [],
      method: "unsolved",
      steps: [],
      caveats: [`This equation has more than one unknown (${vars.join(", ")}). Solve for one variable at a time.`],
      unknowns: vars,
    };
  }

  const caveats: string[] = [];
  const steps: string[] = [];

  const coeffs = polyCoeffs(f, x);
  if (coeffs) {
    const trimmed = trimPoly(coeffs);
    const deg = trimmed.length - 1;
    if (deg <= 0) {
      // 0 = 0 (identity) or c = 0 (no solution).
      const identity = Math.abs(trimmed[0]) < 1e-12;
      return {
        variable: x,
        roots: [],
        method: identity ? "identity" : "no-solution",
        steps: [`Reduced to ${fmtNum(trimmed[0])} = 0.`],
        caveats: [identity ? "Every value of the variable satisfies this equation (an identity)." : "No value of the variable satisfies this equation."],
      };
    }
    const exact = solvePolyExact(trimmed, polyCoeffsRat(f, x));
    if (exact) {
      const terms = trimmed.map((c, k) => `${fmtNum(c)}·${x}^${k}`).reverse().join(" + ");
      steps.push(`Polynomial form: ${terms} = 0.`);
      // A leading coefficient dwarfed by the next one produces a genuine but
      // enormous root — and if that coefficient is rounding dust from cancellation
      // rather than something the user typed, the root is an artefact. Since
      // trimPoly can no longer tell the two apart (and should not guess), say so.
      const lead = Math.abs(trimmed[trimmed.length - 1]);
      const next = Math.abs(trimmed[trimmed.length - 2] ?? 0);
      // BOTH conditions, deliberately. The ratio alone fires on `x - 1e15 = 0`,
      // an entirely ordinary equation whose x coefficient is exactly 1 — and a
      // warning that appears on normal input is a false message that teaches
      // people to ignore the real ones. Rounding dust from cancellation is tiny in
      // ABSOLUTE terms as well (0.1*10 - 1 leaves 2.2e-16), so requiring both
      // separates it from a legitimately large constant term.
      if (lead > 0 && next > 0 && lead < 1e-8 && next / lead > 1e14) {
        caveats.push(
          `The ${x}^${trimmed.length - 1} coefficient (${fmtNum(trimmed[trimmed.length - 1])}) is more than ` +
            `1e14 times smaller than the next one, which makes one root correspondingly enormous. ` +
            `That root is mathematically correct for the coefficients as given, but if the small ` +
            `coefficient came from subtracting two nearly equal quantities it is rounding noise and ` +
            `the root is an artefact. Check it against the equation you meant to write.`,
        );
      }
      if (deg === 2) {
        const [cc, b, a] = trimmed;
        const disc = b * b - 4 * a * cc;
        steps.push(`Quadratic a=${fmtNum(a)}, b=${fmtNum(b)}, c=${fmtNum(cc)}; discriminant b²−4ac = ${fmtNum(disc)}.`);
        if (disc < 0) caveats.push("The discriminant is negative, so the two roots are a complex-conjugate pair.");
      }
      return { variable: x, roots: exact, method: `exact (${deg === 1 ? "linear" : "quadratic"})`, steps, caveats };
    }
    // Degree >= 3 with RATIONAL coefficients: the exact engine (polyRoots.ts) —
    // square-free factorisation first, so a repeated root is ONE exact root with
    // its multiplicity (never four complex values near 1), then rational roots,
    // the quadratic/cubic/quartic closed forms, each certified, and numerical
    // roots only for what is left. `re`/`im` stay at full double precision.
    const ratC = polyCoeffsRat(f, x);
    const rc = ratC ? trimRat(ratC) : null;
    if (rc && rc.length - 1 === deg) {
      const pr = exactPolyRoots(rc, x);
      if (pr) {
        // A LITERAL THE PARSER COULD NOT HOLD EXACTLY. Numbers are read as
        // doubles, so `x - 123456789012345678901234567890` arrives as
        // x − 123456789012345680000000000000; an "exact" root of THAT is not a
        // root of what was typed. Multiplicities stay (they are structural), but
        // every value is shown as a decimal, and the reason is said.
        const lossy = lossyLiterals(input);
        const roots: Root[] = pr.roots.map((r) => {
          const decimal = lossy.length > 0 && r.exact;
          return {
            display: (decimal ? fmtRoot(r.re, r.im) : r.display) + (r.mult > 1 ? ` (×${r.mult})` : ""),
            re: r.re,
            im: r.im,
            exact: r.exact && !decimal,
            ...(r.mult > 1 ? { mult: r.mult } : {}),
          };
        });
        steps.push(`Polynomial of degree ${deg} with rational coefficients; all ${deg} roots counting multiplicity.`, ...pr.steps);
        if (lossy.length) {
          return {
            variable: x, roots, method: "complete (all roots)", steps,
            caveats: [
              ...caveats,
              `Complete: every root is shown, real and complex, with exact multiplicities. ${lossy.join(", ")} has more than the ~16 significant digits a double holds, ` +
                `so it was read as ${lossy.map((l) => String(Number(l))).join(", ")} and the roots are shown as decimals rather than as exact values of that rounded number.`,
            ],
          };
        }
        return { variable: x, roots, method: pr.method, steps, caveats: [...caveats, ...pr.caveats] };
      }
    }
    // Otherwise (π, e or a function value among the coefficients, or a cap):
    // ALL roots (real and complex) via Durand–Kerner, numerically.
    const roots = allPolyRoots(trimmed);
    // NEVER PRINT NaN. A widely spread polynomial can overflow the iteration;
    // a refusal by name is an answer, "NaN" twenty times is not.
    if (roots.some((r) => !Number.isFinite(r.re) || !Number.isFinite(r.im))) {
      return {
        variable: x, roots: [], method: "unsolved", steps,
        caveats: [`The numerical root finder did not converge for this degree-${deg} polynomial (its coefficients span too many orders of magnitude for double precision), so no roots are shown rather than invalid ones.`],
      };
    }
    steps.push(`Degree-${deg} polynomial; all ${deg} root${deg === 1 ? "" : "s"} found (Durand–Kerner), counting multiplicity.`);
    caveats.push(
      rc && rc.length - 1 === deg
        ? `Complete: every root is shown, real and complex. Values are numerical (refined to ~1e-10): the polynomial is past the exact engine's size caps (degree 64, coefficient size, or its time budget), so no closed form or exact multiplicity is attempted.`
        : `Complete: every root is shown, real and complex. Values are numerical (refined to ~1e-10): the coefficients are not all rational (π, e or a function value), so no exact closed form is attempted.`
    );
    return { variable: x, roots, method: "complete (all roots)", steps, caveats };
  }

  // Not numerically polynomial in x — try EXACT symbolic rearrangement before
  // any numeric scan: it covers every rational equation whose numerator is
  // linear or quadratic in x, with other symbols carried through (F = m·a
  // solved for a → a = F/m; PV = nRT solved for T → T = P·V/(n·R)).
  const others = vars.filter((v) => v !== x);
  const sym = solveRationalInVar(f, x);
  if (sym) {
    const verified = sym.verified || verifySymbolicRoots(f, x, sym.roots, others);
    if (verified) {
      const roots: Root[] = sym.roots.map((r) => ({
        display: format(r),
        re: NaN,
        im: NaN,
        exact: true,
        symbolic: true,
      }));
      steps.push(
        sym.kind === "power"
          ? `Isolated ${x}^${sym.power} and took the ${sym.power! % 2 ? "odd" : "even"} root` +
            (others.length ? `, with ${others.join(", ")} carried through symbolically.` : ".")
          : `${sym.kind === "linear" ? "Linear" : "Quadratic"} in ${x} once rearranged; solved in closed form` +
            (others.length ? ` with ${others.join(", ")} carried through symbolically.` : ".")
      );
      steps.push(
        sym.verified
          ? "Verified: substituting the solution back reduces the equation to exactly 0."
          : "Verified by substituting back at sample values of the other symbols."
      );
      for (const c of sym.nonzeroConditions) {
        // A condition that EVALUATES to a nonzero constant (4π/3) is trivially
        // true — stating it as a requirement is noise that trains people to
        // skip the real ones.
        try {
          const v = evalAst(c, {});
          if (Number.isFinite(v) && v !== 0) continue;
        } catch { /* has symbols — a genuine condition */ }
        caveats.push(`Requires ${format(c)} ≠ 0 — the rearrangement divides by it.`);
      }
      if (sym.discriminant) {
        caveats.push(`The two roots are the ± branches of the quadratic formula; they are real when ${format(sym.discriminant)} ≥ 0.`);
      }
      if (sym.realityCondition) {
        caveats.push(`An even power is never negative, so the ± pair is real only when ${format(sym.realityCondition)} ≥ 0.`);
      } else if (sym.kind === "power") {
        caveats.push(`An odd power has exactly ONE real root, for any sign of the right-hand side.`);
      }
      return { variable: x, roots, method: "exact (symbolic rearrangement)", steps, caveats, unknowns: vars };
    }
  }
  if (others.length) {
    // Other unknowns present and no closed form found — scanning a numeric
    // range with unbound symbols would be meaningless, so say what is missing
    // rather than reporting an empty scan as if it had searched something.
    return {
      variable: x,
      roots: [],
      method: "unsolved",
      steps,
      caveats: [
        `Could not isolate ${x} in closed form — this needs more than a linear/quadratic rearrangement, so the other symbol${others.length > 1 ? "s" : ""} (${others.join(", ")}) would need values first.`,
      ],
      unknowns: vars,
    };
  }

  const fNum = (xv: number): number => {
    try { return evalAst(f, { [x]: xv }); } catch { return NaN; }
  };

  // IS IT AN IDENTITY? ASK BEFORE SCANNING, AND ASK RELATIVE TO THE TWO SIDES.
  //
  // `(x-1)/(x-1) = 1` was reported as method "numeric (transcendental)" with FOUR
  // THOUSAND roots — "1000, 999.5, 999, …" — taking about 2.9 seconds. polyCoeffs
  // returns null for a non-constant denominator, the rational solver bails because
  // the numerator normalises to zero, so f is identically 0 when it reaches the
  // scanner, every grid point passes |f| < 1e-10, and the 1e-6 dedupe never fires
  // against 0.5 spacing.
  //
  // THE FIRST VERSION OF THIS CHECK TESTED f === 0 EXACTLY, and that was a fix
  // spelled to the three examples in the bug report. Those three cancel exactly in
  // binary. The identities a person actually types do not:
  //
  //   sin(x)^2 + cos(x)^2 = 1        evaluates to ±1.1e-16, not 0  -> 3620 "roots"
  //   cosh(x)^2 - sinh(x)^2 = 1      likewise                      ->   33 "roots"
  //   exp(ln(x)) = x                 likewise                      ->  852 "roots"
  //
  // So the question has to be asked relative to the SIZE OF THE TWO SIDES, not
  // against zero. |lhs − rhs| below a few epsilon of |lhs| + |rhs| is as equal as
  // double arithmetic can report, and exact equality is merely the special case
  // where the cancellation happened to be lucky. Evaluating the sides separately
  // is what makes that possible, and both are already to hand.
  //
  // NESTED SCALES, because a wide sweep alone cannot see these functions at all.
  // `cosh(x)^2 - sinh(x)^2 = 1` is an identity, but cosh(x)^2 overflows to
  // Infinity beyond x ~ 355, so only about 14 of 41 samples over [-1000, 1000] are
  // even computable — below any sensible quorum, so the check abstained and 33
  // fabricated roots came back. Sampling [-1, 1] and [-10, 10] as well puts plenty
  // of points where the functions are finite, without narrowing the wide sweep that
  // catches identities only true over a large range.
  const sideAt = (t: number): { diff: number; scale: number } | null => {
    let l: { value: number; scale: number };
    let r: { value: number; scale: number };
    try {
      // The magnitudes the evaluation PASSED THROUGH, not just the results. See
      // evalAstScaled: an identity whose two sides cancel internally can only be
      // recognised against the size of what cancelled.
      l = evalAstScaled(lhs, { [x]: t });
      r = evalAstScaled(rhs, { [x]: t });
    } catch {
      return null;
    }
    if (!Number.isFinite(l.value) || !Number.isFinite(r.value)) return null;
    return {
      diff: Math.abs(l.value - r.value),
      scale: Math.max(Math.abs(l.value) + Math.abs(r.value), l.scale, r.scale),
    };
  };
  /**
   * True when the two sides agree to within double precision at `t`, relative to
   * their own magnitudes.
   *
   * Relative to the SIDES, not to zero — that is the whole point. Testing
   * `f === 0` exactly only worked for the three examples in the original bug
   * report, because those cancel exactly in binary; the identities a person
   * actually types do not. `sin(x)^2 + cos(x)^2 - 1` evaluates to +/-1.1e-16 at
   * most doubles, and that produced 3620 "roots".
   *
   * CANCELLATION IS HANDLED BY READING THE INTERMEDIATE MAGNITUDES. The scale comes
   * from evalAstScaled, which reports the largest value the evaluation passed
   * through — so `cosh(x)^2 - sinh(x)^2 = 1` is judged against the ~1.1e15 that
   * actually cancelled rather than against the answer of 1, and is recognised.
   *
   * This replaces an attempt to MEASURE the rounding dust by perturbing x, which was
   * reverted in v2.40.1: that estimate is a random quantity, and the version of it
   * that finally passed the cosh case also reported `tan(x) = 2` and `exp(x) = 2` as
   * identities — every equation in the product made vacuous. Reading the magnitudes
   * is deterministic and needs no threshold tuned to a particular example.
   */
  const sidesAgreeAt = (t: number): boolean | null => {
    const p = sideAt(t);
    if (p === null) return null;
    return p.diff <= Math.max(p.scale, 1) * Number.EPSILON * 64;
  };
  const sideProbe: Array<{ agrees: boolean }> = [];
  for (const span of [range, 10, 1]) {
    for (let i = 0; i < 41; i++) {
      // Irrational offsets, so a function that merely has zeros ON the grid — like
      // sin(x) = 0 — is never mistaken for one that is zero everywhere.
      const t = -span + ((2 * span) * (i + 0.381966011250105)) / 41;
      const v = sidesAgreeAt(t);
      if (v !== null) sideProbe.push({ agrees: v });
    }
  }
  const agreesEverywhere =
    sideProbe.length >= 30 &&
    sideProbe.every((p) => p.agrees);
  if (agreesEverywhere) {
    // An identity CAN still have holes: (x−1)/(x−1) = 1 agrees at every sample
    // because no irrational-offset sample lands on x = 1 — but at x = 1 the
    // left side is 0/0. "Every value" with the holes unnamed is a wrong answer.
    const holes = domainHoles(f, x);
    const holeTxt = holes.length
      ? ` EXCEPT ${holes.map((h) => `${x} = ${fmtNum(h)}`).join(", ")}, where a denominator vanishes and the expression is undefined,`
      : "";
    return {
      variable: x,
      roots: [],
      method: "identity",
      steps: [
        `Both sides agree to within double precision at ${sideProbe.length} sample points ` +
          `across [−${range}, ${range}].`,
      ],
      caveats: [
        `Every value of ${x}${holeTxt} satisfies this equation (an identity), so there is no ` +
          `particular root to report.` +
          (sideProbe.length < 41 && !holes.length
            ? ` The expression is undefined at some points — where a denominator vanishes, ` +
              `for example — and those are excluded.`
            : ""),
      ],
      unknowns: vars,
    };
  }

  // PROVABLY IMPOSSIBLE before any search: a range argument beats a range excuse.
  const impossible = impossibleByRange(lhs, rhs, x) ?? impossibleByRange(rhs, lhs, x);
  if (impossible) {
    return { variable: x, roots: [], method: "no-solution", steps, caveats: [impossible], unknowns: vars };
  }

  // Reciprocal trig folds into the primary function first: sec(u) = c is
  // cos(u) = 1/c, so sec(x) = 2 earns the exact π/3 families and sec(x) = 0.5
  // earns the range refusal — both instead of a numeric scan.
  let trigF: Expr = f;
  {
    const recip = (side: Expr, other: Expr): Expr | null => {
      if (side.t !== "fn" || !containsVar(side.arg, x) || containsVar(other, x)) return null;
      let c: number;
      try { c = evalAst(other, {}); } catch { return null; }
      if (!Number.isFinite(c)) return null;
      const inv: Expr = { t: "div", l: N(1), r: other };
      if (side.name === "sec") return { t: "sub", l: { t: "fn", name: "cos", arg: side.arg }, r: c === 0 ? N(2) : inv };
      if (side.name === "csc") return { t: "sub", l: { t: "fn", name: "sin", arg: side.arg }, r: c === 0 ? N(2) : inv };
      if (side.name === "cot") {
        // cot(u) = 0 is cos(u) = 0; otherwise tan(u) = 1/c.
        return c === 0
          ? { t: "sub", l: { t: "fn", name: "cos", arg: side.arg }, r: N(0) }
          : { t: "sub", l: { t: "fn", name: "tan", arg: side.arg }, r: inv };
      }
      return null;
    };
    trigF = recip(lhs, rhs) ?? recip(rhs, lhs) ?? f;
  }

  // Trig equations answer with their GENERAL solution families, not a wall of
  // numeric roots; exp/log shapes answer in exact closed form.
  const trig = tryTrigGeneral(trigF, x, vars);
  if (trig) return trig;
  const expLog = tryExpLogExact(lhs, rhs, x, vars, f) ?? tryExpLogExact(rhs, lhs, x, vars, f);
  if (expLog) return expLog;

  // Transcendental: numeric root-finding.
  steps.push(`Not a polynomial in ${x}; solving numerically for real roots in [−${range}, ${range}].`);
  const roots = numericRealRoots(fNum, -range, range);
  caveats.push(`Numeric solution: only real roots this method could bracket in [−${range}, ${range}] are reported; it can miss roots that are complex, tangential, or outside the range.`);
  // A RUN of grid points that are all numerically zero is not a set of isolated
  // roots, and it must be WITHHELD rather than warned about.
  //
  // `exp(x) = 0` has no solution at all, but exp underflows to zero below about
  // x = -745, so the scan came back with 510 "roots" spaced 0.5 apart out in the
  // underflow region. The first attempt at this attached a warning and returned
  // the list anyway — but v2.39.0 already settled that argument in the other
  // direction, when `sqrt(x)^2` over [-1, 1] was upgraded from a caveated number
  // to a refusal on the grounds that a caveated number is still a number in the
  // document. 510 of them is the same mistake at scale.
  //
  // The signature is unmistakable: candidates arriving at the scan's own grid
  // spacing means the expression is numerically zero across an interval, not at
  // isolated points. No real equation has roots at exactly the resolution of the
  // instrument looking for them.
  if (roots.length > 20) {
    const spread = Math.abs(roots[0].re - roots[roots.length - 1].re);
    const gap = spread / Math.max(1, roots.length - 1);
    if (gap < ((2 * range) / 4000) * 1.5) {
      // A dense run has two possible causes and they deserve different answers.
      // `ln(exp(x)) = x` IS an identity; it failed the probe above only because
      // exp(x) goes denormal near x = -740, where ln loses enough precision that
      // one sample disagrees. Checking agreement across the span where the run was
      // actually found separates that from `exp(x) = 0`, where the two sides do not
      // agree anywhere except in the underflow region itself.
      const lo2 = Math.min(roots[0].re, roots[roots.length - 1].re);
      const hi2 = Math.max(roots[0].re, roots[roots.length - 1].re);
      let agree = 0;
      let disagree = 0;
      for (let i = 0; i < 25; i++) {
        const t = lo2 + ((hi2 - lo2) * (i + 0.381966011250105)) / 25;
        const v = sidesAgreeAt(t);
        if (v === true) agree++;
        else if (v === false) disagree++;
      }
      // Also ask away from the run: an identity holds everywhere, underflow does not.
      let outsideAgree = 0;
      for (const t of [0.5, 1.5, -1.5, 3.25, -3.25, 7.5, -7.5]) {
        if (sidesAgreeAt(t) === true) outsideAgree++;
      }
      if (disagree === 0 && agree >= 10 && outsideAgree >= 5) {
        return {
          variable: x,
          roots: [],
          method: "identity",
          steps,
          caveats: [
            `Every value of ${x} satisfies this equation (an identity), so there is no ` +
              `particular root to report. The two sides agree to within double precision ` +
              `everywhere they can both be evaluated, though at the extremes of the range ` +
              `one of them overflows or falls below the smallest representable number.`,
          ],
          unknowns: vars,
        };
      }
      return {
        variable: x,
        roots: [],
        method: "no reliable root found",
        steps,
        caveats: [
          `${roots.length} candidate roots came back at essentially the scan's own grid ` +
            `spacing, which means this expression is numerically zero across a whole ` +
            `interval rather than at isolated points — underflow is the usual cause, as in ` +
            `exp(x) = 0, where exp falls below the smallest representable double near ` +
            `${x} ≈ −745 without ever actually reaching zero. None of those values is ` +
            `reported, because they are artefacts of double precision rather than ` +
            `solutions. If you expected a root here, the equation may have no real ` +
            `solution at all.`,
        ],
        unknowns: vars,
      };
    }
  }
  return { variable: x, roots, method: "numeric (transcendental)", steps, caveats };
}

// ---------------------------------------------------------------------------
// Public: differentiation
// ---------------------------------------------------------------------------

export interface DerivativeResult {
  variable: string;
  expression: string;
  derivative: string;
  caveats: string[];
}

/** Symbolic derivative of `input` with respect to `variable` (default: the sole free variable, else x). */
/**
 * The derivative as the user is shown it (the result and the show-work lines alike): exact constants where the CAS
 * can keep them (ln(2)·2^x, 1/(x·ln(10)), not 0.693147…·2^x), the numeric simplifier otherwise.
 */
export function simplifiedDerivative(e: Expr, x: string): Expr {
  try {
    return casSimplify(casSimplify(derivative(e, x), { exactRadicals: true }), { exactRadicals: true });
  } catch (err) {
    if (!(err instanceof CasBail)) throw err;
    return simplify(simplify(derivative(e, x)));
  }
}

export function differentiate(input: string, variable?: string): DerivativeResult | null {
  // "f(x) = |x + 4|" pasted whole into the derivative box: differentiate the
  // BODY of the definition (with respect to its stated variable).
  const fnDef = readFnDefinition(input);
  if (fnDef) return differentiate(fnDef.body, variable ?? fnDef.arg);
  let e: Expr;
  try { e = parseExpr(input); } catch { return null; }
  const vars = freeVars(e);
  const x = variable ?? (vars.length === 1 ? vars[0] : "x");
  const d = simplifiedDerivative(e, x);
  const caveats: string[] = [];
  if (freeVars(e).length > 1) caveats.push(`Differentiated with respect to ${x}; other symbols were treated as constants.`);
  if (/\babs\b/.test(input)) caveats.push("The derivative of abs() is the sign function, undefined where its argument is zero.");
  // A division by literal zero anywhere in the expression means there is nothing
  // to differentiate. The peephole simplifier used to fold 0/0 to 0, so
  // differentiate("x/0") reported the derivative as "0" — a confident wrong
  // answer. That fold is gone, but the result is now a formatted "0/0", which is
  // still a non-answer and must not be presented as one without saying so.
  const out = format(d);
  if (/\/\s*0(?![.\d])/.test(out) || /\/\s*0(?![.\d])/.test(format(simplify(e)))) {
    caveats.push(
      "This expression divides by zero, so it has no value and no derivative. " +
        "Check the denominator — the result shown is not a number.",
    );
  }
  return { variable: x, expression: format(simplify(e)), derivative: out, caveats };
}

// ---------------------------------------------------------------------------
// Public: definite integration (numeric)
// ---------------------------------------------------------------------------

export interface IntegralResult {
  variable: string;
  value: number;
  method: string;
  /** The symbolic antiderivative F(x), when one was found (exact path). */
  antiderivative?: string;
  caveats: string[];
}

export interface AntiderivativeResult {
  variable: string;
  /** F(x), without the constant — the caller adds "+ C". */
  antiderivative: string;
  /** d/dx of the answer, re-derived and simplified: the proof it is right. */
  checkDerivative: string;
  /**
   * How the answer was checked.
   *
   * `symbolic` — the CAS proved d/dx F − f ≡ 0 and discarded any candidate that
   * failed, so this is a proof rather than evidence.
   * `numeric` — the rule table produced F and differentiating it back agrees
   * with the integrand at every sampled point. Strong evidence, not a proof.
   * `unverified` — neither check could be completed. Treat with suspicion.
   *
   * The distinction is reported rather than flattened because the printed
   * derivative often does not LOOK like the integrand even when it equals it:
   * d/dx ln|x| simplifies to x/|x|², which is 1/x for every real x ≠ 0 and does
   * not resemble it on the page.
   */
  verified: "symbolic" | "numeric" | "unverified";
  method: string;
  caveats: string[];
}

/**
 * The INDEFINITE integral — an antiderivative, with no limits.
 *
 * The definite version has shipped since the beginning, and the engine behind
 * it already computes F(x) and throws it away after subtracting. This is the
 * entry point that hands F(x) back.
 *
 * IT IS SELF-VERIFYING, and the verification is shown rather than claimed: the
 * answer is differentiated again and the derivative reported beside it, so the
 * reader can confirm it returns the integrand instead of trusting the table.
 * Symbolic integration is the one operation where a wrong answer is trivially
 * checkable, so there is no excuse for asserting one unchecked.
 *
 * Returns null when no closed form is FOUND. Two quite different things hide
 * behind that, and conflating them would be a lie about mathematics: some
 * integrands (exp(-x²), sin(x)/x) provably have no elementary antiderivative,
 * while others simply exceed what this integrator can do — sin(x)², sec(x) and
 * exp(x)·cos(x) all have standard answers a first-year student produces by
 * hand. This function cannot tell the two apart, so it claims neither.
 */
export function antiderivative(input: string, variable?: string): AntiderivativeResult | null {
  // The same courtesy differentiate() extends: a pasted definition
  // f(x) = body integrates its body.
  const fnDef = readFnDefinition(input);
  if (fnDef) return antiderivative(fnDef.body, variable ?? fnDef.arg);
  let e: Expr;
  try { e = parseExpr(input); } catch { return null; }
  const vars = freeVars(e);
  const x = variable ?? (vars.length === 1 ? vars[0] : "x");

  const simplified = simplify(e);

  // IS THE INTEGRAND A FUNCTION AT ALL? sqrt(-1), ln(-1), asin(2) and 1/0 are
  // constants that evaluate to NaN or Infinity, and the constant rule
  // (∫ c dx = c·x) accepts them happily — producing "NaN*x + C", which the pane
  // would then INSERT INTO THE DOCUMENT, because NaN is not the em-dash the
  // insert guard scans for. The definite branch of this same module already
  // refuses these by name; the indefinite one must not be more permissive than
  // its own sibling.
  const SAMPLE = [0.37, 0.83, 1.29, 2.11, -0.61, -1.73];
  // A NARROW OR SHIFTED DOMAIN (v2.136.0). 1/sqrt(1 - 100x^2) lives on
  // |x| < 1/10 and 1/sqrt(4 - (x+3)^2) on (−5, −1): none of the six fixed
  // points is inside, so a perfectly good integrand was refused before the
  // integrator ever ran. When the fixed points all miss, scan a grid over
  // [−10, 10] (step 1/16, exact in binary) for points INSIDE the domain. No
  // tolerance changes — this only finds where to look.
  const GRID: number[] = [];
  for (let k = -160; k <= 160; k++) GRID.push(k / 16);
  const finitePoints = (expr: Expr, want: number, pts: number[]): number[] => {
    const others = freeVars(expr).filter((v) => v !== x);
    const found: number[] = [];
    for (const p of pts) {
      const env: Record<string, number> = { [x]: p };
      others.forEach((v, i) => { env[v] = 1.7 + i * 0.9; });
      try {
        if (Number.isFinite(evalAst(expr, env))) found.push(p);
      } catch {
        /* try the next point */
      }
      if (found.length >= want) break;
    }
    return found;
  };
  const finiteSomewhere = (expr: Expr): boolean =>
    finitePoints(expr, 1, SAMPLE).length > 0 || finitePoints(expr, 1, GRID).length > 0;
  // Not "finite everywhere" — 1/x is a perfectly good integrand that blows up
  // at one point. The test is whether it is finite ANYWHERE.
  if (!finiteSomewhere(simplified)) return null;

  const cas = symbolicIntegrate(simplified, x, derivative);
  const F = cas?.F ?? symbolicAntideriv(simplified, x);
  if (!F) return null;

  const Fs = simplify(F);
  if (!finiteSomewhere(Fs)) return null;
  // EXACT SCALES STAY EXACT (v2.136.0). The CAS hands back
  // sqrt(2)/2*asin(sqrt(2)*x) for 1/sqrt(1 - 2x^2) (and the atan twin for
  // 1/(x^2 + 2)), and simplify() folded every function of a constant to a
  // double: "0.707106781187*asin(1.41421356237*x)", labelled exact. When the
  // simplified form carries decimals the CAS form does not, print the CAS form
  // (its value is checked equal at sample points first).
  const hasDecimals = (s: string): boolean => /\d\.\d{4,}/.test(s);
  let fs = format(Fs);
  if (cas?.F && hasDecimals(fs) && !hasDecimals(input)) {
    const raw = format(cas.F);
    const pts = finitePoints(Fs, 4, SAMPLE.concat(GRID));
    const same =
      !hasDecimals(raw) &&
      pts.length > 0 &&
      pts.every((p) => {
        try {
          const a = evalAst(cas.F, { [x]: p });
          const b = evalAst(Fs, { [x]: p });
          return Number.isFinite(a) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
        } catch {
          return false;
        }
      });
    if (same) fs = raw;
  }
  // A belt-and-braces guard on the rendered text: whatever route produced it,
  // a printed NaN or Infinity must never leave this function.
  if (/\bNaN\b|\bInfinity\b/.test(fs)) return null;
  // Differentiate the answer back. The CAS path has already done this
  // internally and discarded any candidate that failed; doing it again here is
  // what lets the check be DISPLAYED, and it also covers the older rule table,
  // which does not self-verify.
  let backText = "";
  let back: Expr | null = null;
  try {
    back = simplify(derivative(Fs, x));
    backText = format(back);
  } catch {
    backText = "";
  }

  // Does the re-derived derivative actually agree with the integrand? Fixed
  // sample points, not random ones — a check that varies run to run cannot be
  // reproduced from a bug report. Points that make either side undefined are
  // skipped rather than counted as failures, and a run where nothing could be
  // evaluated is reported as unverified rather than as a pass.
  // "symbolic" ONLY when the CAS actually proved it. `symbolicIntegrate` also
  // accepts a candidate on eight float samples when canonical comparison is
  // inconclusive, and treating that as a proof was an overclaim on every answer
  // the simplifier could not settle — tan(x) and sqrt(x) among them.
  let verified: "symbolic" | "numeric" | "unverified" = cas?.verified ? "symbolic" : "unverified";
  if (!cas?.verified && back) {
    const others0 = vars.filter((v) => v !== x);
    let agreed = 0;
    let compared = 0;
    // The fixed points first; when fewer than 3 of them lie inside a narrow or
    // shifted domain (1/sqrt(4 - (x+3)^2) lives on (−5, −1)), add grid points
    // where the integrand IS defined, so the answer can be checked rather than
    // reported unverified for want of a place to look.
    const FIXED = [0.37, 0.83, 1.29, 2.11, 3.57, -0.61, -1.73, -2.89];
    const verifyAt = finitePoints(simplified, 3, FIXED).length >= 3
      ? FIXED
      : FIXED.concat(finitePoints(simplified, 8, GRID));
    for (const p of verifyAt) {
      const env: Record<string, number> = { [x]: p };
      // Any other symbols are constants; pin them at distinct fixed values so a
      // coincidence at 1 cannot pass for an identity.
      others0.forEach((v, i) => { env[v] = 1.7 + i * 0.9; });
      let lhs: number;
      let rhs: number;
      try {
        lhs = evalAst(back, env);
        rhs = evalAst(simplified, env);
      } catch {
        continue;
      }
      if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) continue;
      compared++;
      if (Math.abs(lhs - rhs) <= 1e-8 * Math.max(1, Math.abs(rhs))) agreed++;
    }
    if (compared >= 3 && agreed === compared) verified = "numeric";
  }

  const caveats: string[] = [
    "An antiderivative is only defined up to an additive constant, which is what the + C is. " +
      "Any two antiderivatives of the same function differ by a constant, so a different-looking " +
      "answer is not necessarily a different one.",
  ];
  const others = vars.filter((v) => v !== x);
  if (others.length) {
    caveats.push(
      `${others.join(", ")} ${others.length === 1 ? "was" : "were"} treated as a constant, since ` +
        `the integration is with respect to ${x}.`,
    );
  }
  // WHAT THE RULE KNOWS (v2.136.0): a domain of validity ("|x| < 2" for an
  // arcsine) or an equivalent form (acos beside −asin) — casint's notes.
  for (const n of cas?.notes ?? []) if (!caveats.includes(n)) caveats.push(n);
  // Decimals the user did not type are rounded IRRATIONAL constants; the
  // antiderivative is exact, its printed constants are not — say ≈.
  if (hasDecimals(fs) && !hasDecimals(input)) {
    caveats.push(
      "The decimal coefficients shown are irrational constants (such as sqrt(2)/2) rounded to 12 significant " +
        "figures — the antiderivative is exact, but those printed constants are ≈.",
    );
  }
  // THE CONSTANT IS NOT ALWAYS ONE CONSTANT. Across a pole the antiderivative
  // has separate branches and the constants are independent, which is the
  // standard omission in every table.
  if (/\bln\b|\blog\b|\/\s*[a-z(]|tan|sec|cot|csc/.test(fs)) {
    caveats.push(
      "If F has a pole or a branch cut inside the interval you care about, the constant is NOT " +
        "shared across it: the antiderivative is a different branch on each side, each with its " +
        "own constant. That is why the definite integral needs continuity, not just an F.",
    );
  }

  if (verified === "unverified") {
    caveats.push(
      "This answer could NOT be checked by differentiating it back. Verify it yourself before " +
        "relying on it — symbolic integration is the one operation where a wrong answer is " +
        "trivially checkable, so an unchecked one should not be trusted.",
    );
  }

  return {
    variable: x,
    antiderivative: fs,
    checkDerivative: backText,
    verified,
    method:
      verified === "symbolic"
        ? "exact (symbolic; d/dx F − f proved identically zero)"
        : verified === "numeric"
          ? "exact (rule table; derivative checked back numerically)"
          : "rule table, UNVERIFIED",
    caveats,
  };
}

const V = (name: string): Expr => ({ t: "var", name });
const near = (v: number, t: number): boolean => Math.abs(v - t) < 1e-12;
const lnAbs = (u: Expr): Expr => ({ t: "fn", name: "ln", arg: { t: "fn", name: "abs", arg: u } });
function safeConst(e: Expr): number | null {
  try { return evalAst(e, {}); } catch { return null; }
}

/** {a,b} if `e` is a·x + b (degree ≤ 1 in x), else null. */
function linearInX(e: Expr, x: string): { a: number; b: number } | null {
  const cf = polyCoeffs(e, x);
  if (!cf) return null;
  const t = trimPoly(cf);
  if (t.length > 2) return null;
  return { a: t[1] ?? 0, b: t[0] ?? 0 };
}

// Elementary antiderivatives for f(u); combined with the linear-argument rule
// ∫ f(a·x+b) dx = F(a·x+b)/a.
const FN_INTEGRAL: Record<string, (u: Expr) => Expr> = {
  sin: (u) => ({ t: "neg", e: { t: "fn", name: "cos", arg: u } }),
  cos: (u) => ({ t: "fn", name: "sin", arg: u }),
  exp: (u) => ({ t: "fn", name: "exp", arg: u }),
  sinh: (u) => ({ t: "fn", name: "cosh", arg: u }),
  cosh: (u) => ({ t: "fn", name: "sinh", arg: u }),
};

/**
 * Symbolic antiderivative of `e` with respect to `x`, or null when no rule
 * applies (then the caller falls back to numeric quadrature). Covers linearity,
 * the power rule (incl. 1/x → ln|x|), 1/(x²+1) → atan, e^x, sin/cos/sinh/cosh,
 * and linear arguments a·x+b for all of the above.
 */
function symbolicAntideriv(e: Expr, x: string): Expr | null {
  if (!containsVar(e, x)) return { t: "mul", l: e, r: V(x) }; // ∫ c dx = c·x
  switch (e.t) {
    case "var":
      return { t: "div", l: { t: "pow", l: V(x), r: N(2) }, r: N(2) }; // ∫ x dx = x²/2
    case "neg": {
      const a = symbolicAntideriv(e.e, x);
      return a ? { t: "neg", e: a } : null;
    }
    case "add": {
      const l = symbolicAntideriv(e.l, x), r = symbolicAntideriv(e.r, x);
      return l && r ? { t: "add", l, r } : null;
    }
    case "sub": {
      const l = symbolicAntideriv(e.l, x), r = symbolicAntideriv(e.r, x);
      return l && r ? { t: "sub", l, r } : null;
    }
    case "mul": {
      // A constant factor pulls out; a genuine product of two x-terms has no simple rule.
      if (!containsVar(e.l, x)) { const r = symbolicAntideriv(e.r, x); return r ? { t: "mul", l: e.l, r } : null; }
      if (!containsVar(e.r, x)) { const l = symbolicAntideriv(e.l, x); return l ? { t: "mul", l: e.r, r: l } : null; }
      return null;
    }
    case "div": {
      if (!containsVar(e.r, x)) { const u = symbolicAntideriv(e.l, x); return u ? { t: "div", l: u, r: e.r } : null; } // f/c
      if (!containsVar(e.l, x)) {
        if (e.r.t === "var") return { t: "mul", l: e.l, r: lnAbs(V(x)) }; // c/x → c·ln|x|
        const dc = trimPoly(polyCoeffs(e.r, x) ?? [0]);
        if (dc.length === 3 && near(dc[0], 1) && near(dc[1], 0) && near(dc[2], 1))
          return { t: "mul", l: e.l, r: { t: "fn", name: "atan", arg: V(x) } }; // c/(x²+1) → c·atan(x)
        return null;
      }
      return null;
    }
    case "pow": {
      if (!containsVar(e.r, x)) {
        const n = safeConst(e.r);
        if (n === null) return null;
        if (e.l.t === "var") {
          return near(n, -1) ? lnAbs(V(x)) : { t: "div", l: { t: "pow", l: V(x), r: N(n + 1) }, r: N(n + 1) };
        }
        const lin = linearInX(e.l, x);
        if (lin && lin.a !== 0) {
          return near(n, -1)
            ? { t: "div", l: lnAbs(e.l), r: N(lin.a) }
            : { t: "div", l: { t: "pow", l: e.l, r: N(n + 1) }, r: N(lin.a * (n + 1)) };
        }
      }
      return null;
    }
    case "fn": {
      const F = FN_INTEGRAL[e.name];
      if (!F) return null;
      const lin = linearInX(e.arg, x);
      if (!lin || lin.a === 0) return null;
      return { t: "div", l: F(e.arg), r: N(lin.a) };
    }
    default:
      return null;
  }
}

/**
 * First sampled point in [a, b] where `e` is undefined (non-finite or throwing),
 * or null if it is finite everywhere sampled.
 *
 * This exists because SIMPLIFICATION CAN WIDEN A DOMAIN: the canonical form of
 * sqrt(x)^2 is x, which is perfectly finite at x = −4 where the original is
 * not. Reporting a value for an integral that does not exist — and calling it
 * exact — is precisely the confidently-wrong output this product keeps
 * designing out, so the ORIGINAL integrand is what gets checked.
 *
 * Sampling is a heuristic: it cannot prove a function is defined everywhere,
 * only find a witness that it is not. A missed narrow gap therefore leaves the
 * old behaviour, never a new false warning.
 */
/**
 * Does `e` actually blow up at `t`, or is the singularity removable?
 *
 * A ZERO OF A DENOMINATOR IS NOT NECESSARILY A POLE. The first version of the
 * structural detector reported every real root of a denominator inside the
 * interval without asking whether the numerator vanished there too, and it
 * refused five correct integrals: `(x^2-1)/(x-1)` over [0, 2] is **4**, not a
 * divergence — the integrand IS x + 1. Likewise `x/x`, `(x-2)/(x-2)` and
 * `(x^2-4)/(x-2)`. Trading a wrong number for a refused correct one is a smaller
 * harm, not an acceptable one.
 *
 * The test is cheap precisely because the caller has already established WHERE to
 * look — which is the thing a blind grid scan never knew. At a genuine pole of
 * order n >= 1, |f| grows like h^-n as h shrinks, so shrinking h by 1e6
 * multiplies |f| by at least 1e6. At a removable singularity |f| converges to its
 * limit and the ratio is about 1. The threshold is 1e3: three orders of magnitude
 * of daylight between the two cases, so this is a predicate with margin, not a
 * tolerance standing in for one.
 *
 * Both sides are probed. A pole of even order blows up alike on each, an odd one
 * changes sign, and a one-sided domain edge — sqrt or ln of the wrong sign —
 * misbehaves on only one, which must still count.
 */
function isGenuinePole(e: Expr, x: string, t: number): boolean {
  const scale = Math.max(1, Math.abs(t));
  const worstAt = (h: number): number => {
    let worst = 0;
    for (const s of [1, -1]) {
      let v: number;
      try {
        v = evalAst(e, { [x]: t + s * h });
      } catch {
        return Infinity;
      }
      if (Number.isNaN(v)) return Infinity;
      worst = Math.max(worst, Math.abs(v));
    }
    return worst;
  };
  const wide = worstAt(scale * 1e-5);
  const narrow = worstAt(scale * 1e-11);
  if (!Number.isFinite(wide) || !Number.isFinite(narrow)) return true;
  return narrow > 1e3 * (wide + 1e-300);
}

type Singularity = { at: number; kind: "pole" | "domain" };

function undefinedPointIn(e: Expr, x: string, a: number, b: number, steps = 129): Singularity | null {
  // SYMBOLIC FIRST. A sampled scan cannot find a pole reliably, and this one had
  // two independent blind spots that both produced a confident wrong number:
  //
  //   (a) GRID ALIGNMENT. The samples were a + (b-a)*i/129, so the pole at x = 1
  //       in [0, 2] needs i = 64.5 and was never visited. Proof by control:
  //       [0, 2.58] puts the same pole on i = 50 and WAS caught, [0, 2] was not.
  //       integrate("1/((x-1)^2)", 0, 2) therefore returned -2, method
  //       "exact (symbolic)", caveats [] -- a NEGATIVE value for an integrand
  //       that is strictly positive everywhere, for an integral that diverges to
  //       +infinity.
  //   (b) STRUCTURAL INVISIBILITY. tan has a pole at pi/2, but tan is FINITE at
  //       every representable double near pi/2, so Number.isFinite is true at
  //       every sample no matter how the grid is spaced. No amount of extra
  //       sampling fixes that. integrate("tan(x)", 0, 3) returned 0.01005... as
  //       "exact (symbolic)" with no caveat.
  //
  // So the poles are located by structure, and sampling is kept only as a
  // backstop for the cases structure does not cover (sqrt and ln of the wrong
  // sign, which the scan does find because those really are non-finite or NaN).
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const inside = (t: number): boolean => t > lo + 0 && t < hi - 0;

  const sym = symbolicSingularityIn(e, x, lo, hi);
  if (sym !== null) return { at: sym, kind: "pole" };

  // The sampled candidate has to pass the SAME two rules as a structural one.
  // Without the interior test, `x/x` over [0, 2] was refused because 0/0 is NaN at
  // the endpoint x = 0 — but the integral is 2, and an endpoint the integrand
  // misses is not a reason to refuse. Without the removable test,
  // `(x^2-4)/(x-2)` over [0, 3] was refused because 129 evenly spaced samples
  // land exactly on x = 2, where 0/0 is NaN; the integral is 10.5.
  const fatal = (t: number): boolean => t > lo && t < hi && isGenuinePole(e, x, t);
  for (let i = 0; i <= steps; i++) {
    const t = lo + ((hi - lo) * i) / steps;
    let v: number;
    try {
      v = evalAst(e, { [x]: t });
    } catch {
      if (fatal(t)) return { at: t, kind: "domain" };
      continue;
    }
    if (!Number.isFinite(v) && fatal(t)) return { at: t, kind: "domain" };
  }
  // Offset backstop: the same count of samples, shifted by an irrational
  // fraction of a step, so a pole cannot hide in the gaps of BOTH grids. This is
  // cheap insurance, not the mechanism -- the mechanism is symbolic.
  const OFFSET = 0.381966011250105; // (3 - sqrt(5)) / 2
  for (let i = 0; i < steps; i++) {
    const t = lo + ((hi - lo) * (i + OFFSET)) / steps;
    if (!inside(t)) continue;
    try {
      if (!Number.isFinite(evalAst(e, { [x]: t })) && fatal(t)) return { at: t, kind: "domain" };
    } catch {
      if (fatal(t)) return { at: t, kind: "domain" };
    }
  }
  return null;
}

/**
 * A point strictly inside (lo, hi) where `e` has a pole, found from the
 * STRUCTURE of the expression rather than by sampling. Returns null when no such
 * point is found -- which is not a proof that none exists, only that this
 * covers the two classes that reach users: a polynomial denominator, and the
 * trigonometric functions with known pole sets.
 */
function symbolicSingularityIn(e: Expr, x: string, lo: number, hi: number): number | null {
  let found: number | null = null;

  const report = (t: number): void => {
    if (found !== null) return;
    // Strictly inside, and actually a pole rather than a removable point.
    if (t > lo && t < hi && isGenuinePole(e, x, t)) found = t;
  };

  /** Real roots in (lo, hi) of a polynomial denominator, verified by residual. */
  const rootsOfDenominator = (d: Expr): void => {
    const c = polyCoeffs(d, x);
    if (!c) return;
    const deg = c.length - 1;
    if (deg < 1) return;
    if (!c.every((v) => Number.isFinite(v))) return;
    const at = (t: number): number => {
      let acc = 0;
      for (let k = deg; k >= 0; k--) acc = acc * t + c[k];
      return acc;
    };
    // Bisect on a fine grid, then REQUIRE the residual to be small relative to
    // the coefficient scale. A sign change alone is not a root -- that mistake
    // is what let this module report a pole as a root elsewhere.
    const scale = Math.max(...c.map(Math.abs), 1);
    const N = 2048;
    for (let i = 0; i < N; i++) {
      let p = lo + ((hi - lo) * i) / N;
      let q = lo + ((hi - lo) * (i + 1)) / N;
      let fp = at(p), fq = at(q);
      if (fp === 0) { report(p); continue; }
      if (fq === 0) { report(q); continue; }
      if (fp > 0 === fq > 0) continue;
      for (let k = 0; k < 80; k++) {
        const m = (p + q) / 2;
        const fm = at(m);
        if (fm === 0) { p = q = m; break; }
        if (fm > 0 === fp > 0) { p = m; fp = fm; } else { q = m; fq = fm; }
      }
      const m = (p + q) / 2;
      if (Math.abs(at(m)) <= 1e-9 * scale) report(m);
    }
  };

  /** Poles of tan/sec at cos(arg) = 0, and of cot/csc at sin(arg) = 0. */
  const trigPoles = (arg: Expr, offsetIsHalfPi: boolean): void => {
    const lin = linearInX(arg, x);
    if (!lin || lin.a === 0) return;
    // arg = lin.a*x + lin.b; poles where arg = base + k*pi.
    const base = offsetIsHalfPi ? Math.PI / 2 : 0;
    // Solve lin.a*t + lin.b = base + k*pi for t in (lo, hi).
    const kLo = (lin.a * lo + lin.b - base) / Math.PI;
    const kHi = (lin.a * hi + lin.b - base) / Math.PI;
    const from = Math.floor(Math.min(kLo, kHi)) - 1;
    const to = Math.ceil(Math.max(kLo, kHi)) + 1;
    // A bounded loop. An enormous linear coefficient could otherwise ask for
    // billions of iterations inside a task pane, which is a frozen Word.
    if (to - from > 100000) return;
    for (let k = from; k <= to; k++) {
      report((base + k * Math.PI - lin.b) / lin.a);
    }
  };

  const walk = (n: Expr): void => {
    if (found !== null) return;
    switch (n.t) {
      case "num":
      case "var":
        return;
      case "neg":
        return walk(n.e);
      case "add":
      case "sub":
      case "mul":
        walk(n.l); walk(n.r); return;
      case "div":
        walk(n.l);
        walk(n.r);
        if (containsVar(n.r, x)) rootsOfDenominator(n.r);
        return;
      case "pow": {
        walk(n.l); walk(n.r);
        // A negative constant exponent puts the base in a denominator.
        const p = safeConst(n.r);
        if (p !== null && p < 0 && containsVar(n.l, x)) rootsOfDenominator(n.l);
        return;
      }
      case "fn":
        walk(n.arg);
        if (n.name === "tan" || n.name === "sec") trigPoles(n.arg, true);
        if (n.name === "cot" || n.name === "csc") trigPoles(n.arg, false);
        return;
      default:
        return;
    }
  };

  walk(e);
  return found;
}

/**
 * 10-point Gauss-Legendre nodes and weights on [-1, 1].
 *
 * Standard values, to full double precision. A 10-point rule integrates any
 * polynomial up to degree 19 exactly, which is far more than Simpson gets for the
 * same number of evaluations — but that is not why it is here.
 */
const GL10_NODES = [
  -0.9739065285171717, -0.8650633666889845, -0.6794095682990244,
  -0.4333953941292472, -0.14887433898163122, 0.14887433898163122,
  0.4333953941292472, 0.6794095682990244, 0.8650633666889845, 0.9739065285171717,
];
const GL10_WEIGHTS = [
  0.06667134430868814, 0.14945134915058059, 0.219086362515982,
  0.2692667193099963, 0.29552422471475287, 0.29552422471475287,
  0.2692667193099963, 0.219086362515982, 0.14945134915058059, 0.06667134430868814,
];

/**
 * Composite Gauss-Legendre quadrature, WHICH NEVER SAMPLES A PANEL BOUNDARY.
 *
 * That property is the entire point, and it is what makes a removable singularity
 * integrable. Every Gauss-Legendre node lies strictly inside its panel, so neither
 * endpoint of the interval nor any panel boundary is ever evaluated — where adaptive
 * Simpson's very first act is to evaluate the midpoint, which for `sin(x)/x` over
 * [-1, 1] is exactly 0, where sin(0)/0 is NaN, and one undefined sample aborted the
 * whole integral.
 *
 * The second property matters as much and is less obvious: the nodes stay AWAY from
 * the singular point. On [0, 1] the smallest node of this rule is about 0.0034, and
 * with panels it scales with the panel width — so an integrand that is numerically
 * unreliable very close to zero is never asked about that region. `(1-cos(x))/x^2`
 * loses all its precision below x = 1e-8, where the nearest double to cos(x) is
 * exactly 1 and the quotient evaluates to 0 instead of 0.5; at 0.0034 it is perfectly
 * well conditioned. That is why this works where averaging two neighbours across the
 * singularity did not — see the C0 note below, which measured that attempt at a 1.7%
 * error and removed it.
 */
function compositeGaussLegendre(f: (x: number) => number, a: number, b: number, panels: number): number {
  const h = (b - a) / panels;
  let total = 0;
  for (let k = 0; k < panels; k++) {
    const lo = a + k * h;
    const mid = lo + h / 2;
    const half = h / 2;
    let panel = 0;
    for (let i = 0; i < GL10_NODES.length; i++) {
      const v = f(mid + half * GL10_NODES[i]);
      if (!Number.isFinite(v)) return NaN;
      panel += GL10_WEIGHTS[i] * v;
    }
    total += panel * half;
  }
  return total * 1; // weights already sum to 2 over [-1,1]; half accounts for it
}

/**
 * The same, refined until two panel counts agree — so the answer carries evidence
 * rather than a promise.
 *
 * Returns null rather than a number it cannot corroborate. Bounded iterations,
 * because this runs in a task pane.
 */
function gaussLegendreConverged(f: (x: number) => number, a: number, b: number): number | null {
  let previous = compositeGaussLegendre(f, a, b, 8);
  if (!Number.isFinite(previous)) return null;
  for (const panels of [16, 32, 64, 128, 256]) {
    const next = compositeGaussLegendre(f, a, b, panels);
    if (!Number.isFinite(next)) return null;
    const scale = Math.max(Math.abs(next), Math.abs(previous), 1e-300);
    if (Math.abs(next - previous) <= 1e-11 * scale) return next;
    previous = next;
  }
  return previous;
}

/** Adaptive Simpson quadrature of f over [a, b]. */
function adaptiveSimpson(f: (x: number) => number, a: number, b: number, tol = 1e-10, depth = 50): number {
  const simpson = (lo: number, hi: number, flo: number, fmid: number, fhi: number) =>
    ((hi - lo) / 6) * (flo + 4 * fmid + fhi);
  function rec(lo: number, hi: number, flo: number, fmid: number, fhi: number, whole: number, d: number): number {
    const mid = (lo + hi) / 2;
    const lmid = (lo + mid) / 2, rmid = (mid + hi) / 2;
    const flm = f(lmid), frm = f(rmid);
    // NON-FINITE SAMPLES MUST ABORT, NOT SUBDIVIDE.
    //
    // The convergence test below is `|left + right − whole| < 15·tol`, and any
    // comparison against NaN is FALSE — so a single NaN sample defeated the
    // short-circuit and drove the full binary recursion to depth 50, roughly
    // 2^51 evaluations. `integrate("ln(x)", -1, 2)` reached this by way of the
    // symbolic path returning NaN at an endpoint and falling through, and it
    // froze the pane unrecoverably: a synchronous loop cannot be interrupted,
    // so even the test runner's own timeout could not stop it.
    if (!Number.isFinite(flm) || !Number.isFinite(frm)) return NaN;
    const left = simpson(lo, mid, flo, flm, fmid);
    const right = simpson(mid, hi, fmid, frm, fhi);
    if (d <= 0 || Math.abs(left + right - whole) < 15 * tol) return left + right + (left + right - whole) / 15;
    return rec(lo, mid, flo, flm, fmid, left, d - 1) + rec(mid, hi, fmid, frm, fhi, right, d - 1);
  }
  const mid = (a + b) / 2;
  const fa = f(a), fm = f(mid), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fm) || !Number.isFinite(fb)) return NaN;
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), depth);
}

/**
 * A reason the reported value contradicts the sign of the integrand, or null.
 *
 * If f > 0 everywhere on the interval then the integral is > 0. That is a
 * theorem, with no tolerance in it, and it is the cheapest possible check on an
 * "exact" answer. It exists because the grid-aligned singularity scan let
 * integrate("1/((x-1)^2)", 0, 2) report -2 for a strictly positive integrand:
 * the number was not merely imprecise, its SIGN was impossible, and nothing
 * noticed. A structural fix for the pole is in undefinedPointIn; this is the
 * independent second line, on the principle that the two should not share a
 * failure mode.
 */
function signContradiction(e: Expr, x: string, a: number, b: number, value: number): string | null {
  if (!Number.isFinite(value) || value === 0) return null;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (!(hi > lo)) return null;
  // Sampled on two offset grids for the same reason as the scan above: one grid
  // can align with a zero of the integrand and miss the sign change.
  const N = 200;
  let sawPositive = false, sawNegative = false;
  for (const off of [0.5, 0.881966011250105]) {
    for (let i = 0; i < N; i++) {
      const t = lo + ((hi - lo) * (i + off)) / N;
      let v: number;
      try { v = evalAst(e, { [x]: t }); } catch { return null; }
      if (!Number.isFinite(v)) return null;
      if (v > 0) sawPositive = true;
      else if (v < 0) sawNegative = true;
      if (sawPositive && sawNegative) return null; // the integrand changes sign
    }
  }
  // `value` here is the antiderivative difference in the order the caller asked
  // for, so flip the expected sign when b < a.
  const orientation = b >= a ? 1 : -1;
  const signed = value * orientation;
  if (sawPositive && !sawNegative && signed < 0) {
    return (
      `Refused. The integrand is positive at every one of ${2 * N} sample points across ` +
      `[${fmtNum(lo)}, ${fmtNum(hi)}], so its integral cannot be negative — but the ` +
      `antiderivative's endpoint difference is ${fmtNum(value)}. That means the ` +
      `antiderivative is discontinuous inside the interval, which is a singularity of the ` +
      `integrand, and the integral is improper. No value is reported, because the one ` +
      `available is impossible.`
    );
  }
  if (sawNegative && !sawPositive && signed > 0) {
    return (
      `Refused. The integrand is negative at every one of ${2 * N} sample points across ` +
      `[${fmtNum(lo)}, ${fmtNum(hi)}], so its integral cannot be positive — but the ` +
      `antiderivative's endpoint difference is ${fmtNum(value)}. That means the ` +
      `antiderivative is discontinuous inside the interval, which is a singularity of the ` +
      `integrand, and the integral is improper. No value is reported, because the one ` +
      `available is impossible.`
    );
  }
  return null;
}

/**
 * Definite integral of `input` over [a, b] with respect to `variable`, by
 * adaptive Simpson quadrature. Numeric — reports an approximation, not a
 * closed-form antiderivative. Returns null if the input cannot be parsed.
 */
export function integrate(input: string, a: number, b: number, variable?: string): IntegralResult | null {
  const fnDef = readFnDefinition(input);
  if (fnDef) return integrate(fnDef.body, a, b, variable ?? fnDef.arg);
  let e: Expr;
  try { e = parseExpr(input); } catch { return null; }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const vars = freeVars(e);
  const x = variable ?? (vars.length === 1 ? vars[0] : "x");
  const others = vars.filter((v) => v !== x);
  if (others.length) return null; // cannot integrate with unresolved parameters

  // Prefer an EXACT symbolic antiderivative. The CAS integrator (Release 2:
  // substitution, by parts, partial fractions) is tried first and is
  // self-verifying — it differentiates every candidate back and discards any
  // that does not match, so a miss costs nothing but a fallback. The older
  // rule table below still runs when the CAS finds nothing.
  const casResult = symbolicIntegrate(simplify(e), x, derivative);
  const casNotes = casResult?.notes ?? [];
  const F = casResult?.F ?? symbolicAntideriv(simplify(e), x);
  if (F) {
    const Fs = simplify(F);
    try {
      // F AT AN ENDPOINT, EXACTLY WHEN FLOATS FAIL (v2.136.0). asin(4x/3 − 7/3)
      // at x = 1 evaluates its argument to −1.0000000000000002 and returns NaN,
      // and ∫₁^2.5 1/√((x − 1)(5/2 − x)) = π came back "does not exist". The
      // endpoint is substituted as an exact rational instead (the argument is
      // then exactly −1), and the value is accepted only if F is CONTINUOUS
      // there: F just inside the interval must approach it.
      const inward = (t: number): number => (t === a ? Math.sign(b - a) : Math.sign(a - b));
      const endpointValue = (t: number): number => {
        let v = NaN;
        try { v = evalAst(Fs, { [x]: t }); } catch { v = NaN; }
        if (Number.isFinite(v)) return v;
        let exactV = NaN;
        try {
          const s = casSimplify(casSubstitute(F, x, ratToExpr(ratFromNumber(t))));
          exactV = evalAst(s, {});
        } catch {
          return NaN;
        }
        if (!Number.isFinite(exactV)) return NaN;
        let near = NaN;
        try { near = evalAst(Fs, { [x]: t + inward(t) * 1e-12 * Math.max(1, Math.abs(t)) }); } catch { near = NaN; }
        return Number.isFinite(near) && Math.abs(near - exactV) < 1e-4 * Math.max(1, Math.abs(exactV)) ? exactV : NaN;
      };
      const value = endpointValue(b) - endpointValue(a);
      if (Number.isFinite(value)) {
        const caveats: string[] = [];
        let fs = format(Fs);
        // EXACT SCALES STAY EXACT in the definite path too: simplify() folds
        // sqrt(2)/2 to 0.707106781187, which then sat beside "exact (symbolic)".
        // The CAS form is printed when it has no decimals the input lacked and
        // agrees with the simplified form at sample points.
        const decimals = (s: string): boolean => /\d\.\d{4,}/.test(s);
        if (casResult?.F && decimals(fs) && !decimals(input)) {
          const raw = format(casResult.F);
          const pts = [a + (b - a) * 0.31, a + (b - a) * 0.57, a + (b - a) * 0.83];
          const agree = !decimals(raw) && pts.every((p) => {
            try {
              const u = evalAst(casResult.F, { [x]: p });
              const w = evalAst(Fs, { [x]: p });
              return Number.isFinite(u) && Math.abs(u - w) <= 1e-9 * Math.max(1, Math.abs(w));
            } catch {
              return false;
            }
          });
          if (agree) fs = raw;
        }
        // CANONICALISATION CAN WIDEN A DOMAIN. sqrt(x)^2 normalises to x, which
        // is defined for negative x where the original is not — so ∫sqrt(x)² over
        // [−1,1] would otherwise come back as a confident "exact 0" for an
        // integral that does not exist. Scan the ORIGINAL integrand across the
        // interval before calling any of this exact. Catches ln and division
        // poles for free, so it subsumes the old ln-only special case.
        const gap = undefinedPointIn(e, x, a, b);
        if (gap !== null) {
          // The integral does not exist over this interval. Saying so is not a
          // caveat on a number -- there is no number. Reporting one anyway is
          // how integrate("1/((x-1)^2)", 0, 2) came to return -2 as "exact
          // (symbolic)" with an empty caveat list, for a strictly positive
          // integrand whose integral diverges to +infinity. The formal
          // endpoint difference of the antiderivative is not the integral when
          // the antiderivative is discontinuous in between; the fundamental
          // theorem of calculus requires continuity, and this is exactly the
          // hypothesis that fails.
          const cause =
            gap.kind === "pole"
              ? `has a POLE — a division by zero, or a pole of tan/cot/sec/csc — at ${x} ≈ ${fmtNum(gap.at)}`
              : `is UNDEFINED at ${x} ≈ ${fmtNum(gap.at)} — for example a square root of a negative ` +
                `number, or a log of a non-positive number`;
          return {
            variable: x,
            value: NaN,
            method: "does not exist on this interval",
            antiderivative: fs,
            caveats: [
              `The integrand ${cause}, strictly inside [${fmtNum(a)}, ${fmtNum(b)}], so it is ` +
                `UNDEFINED somewhere the integral needs it. The fundamental theorem of calculus ` +
                `requires the integrand to be continuous across the whole interval, so the ` +
                `difference of the antiderivative at the endpoints is NOT the integral here. No ` +
                `value is reported, because there is none. Split the interval at that point and ` +
                `take limits if you want a principal value.`,
              `For reference, the antiderivative found was F(${x}) = ${fs}, and its formal endpoint ` +
                `difference is ${fmtNum(value)} — a number that does not answer the question asked.`,
            ],
          };
        }
        // An exact theorem as a backstop: an integrand that never changes sign
        // cannot integrate to the opposite sign. If a pole is ever missed again,
        // this catches the specific failure that reaches a document -- a
        // NEGATIVE area under a strictly positive curve.
        const signProblem = signContradiction(e, x, a, b, value);
        if (signProblem !== null) {
          return {
            variable: x,
            value: NaN,
            method: "does not exist on this interval",
            antiderivative: fs,
            caveats: [signProblem],
          };
        }
        if (/\bln\b/.test(fs) && a * b < 0) {
          caveats.push("The antiderivative has a singularity at 0, which lies inside the interval — this is the formal value; the integral may be improper.");
        }
        // AN INTEGRABLE ENDPOINT SINGULARITY IS SAID (v2.136.0). ∫₋₁¹ 1/√(1 − x²)
        // returned π with no caveat, though the integrand is unbounded at both
        // ends: the value is the limit of an IMPROPER integral, and it is the
        // continuity of F up to the endpoint that makes F(b) − F(a) that limit
        // (the same test as the double-integral twin in multivar.ts).
        const improperAt: number[] = [];
        for (const [at, dir] of [[a, Math.sign(b - a)], [b, Math.sign(a - b)]] as [number, number][]) {
          let fAt: number;
          let fNear: number;
          try { fAt = evalAst(e, { [x]: at }); } catch { fAt = NaN; }
          try { fNear = evalAst(e, { [x]: at + dir * 1e-12 * Math.max(1, Math.abs(at)) }); } catch { fNear = NaN; }
          if (Number.isFinite(fAt) || dir === 0) continue;
          // UNBOUNDED, not merely undefined: x/x at 0 is a removable point (its
          // neighbours are 1), and calling that integral improper would be noise.
          if (Math.abs(fAt) !== Infinity && !(Math.abs(fNear) > 1e5)) continue;
          let Fat: number, Fnear: number;
          try {
            Fat = endpointValue(at);
            Fnear = evalAst(Fs, { [x]: at + dir * 1e-10 * Math.max(1, Math.abs(at)) });
          } catch {
            continue;
          }
          if (Number.isFinite(Fat) && Number.isFinite(Fnear) && Math.abs(Fat - Fnear) < 1e-4 * Math.max(1, Math.abs(Fat))) improperAt.push(at);
        }
        if (improperAt.length) {
          caveats.push(
            `Improper at ${improperAt.length > 1 ? "both endpoints" : "an endpoint"} (${x} = ${improperAt.map(fmtNum).join(" and ")}): the integrand is ` +
              `unbounded there, but the antiderivative ${fs} is continuous up to ` +
              `${improperAt.length > 1 ? "both endpoints" : "that endpoint"}, so the integral converges to the value shown.`,
          );
        }
        // What the rule knows about its answer (casint's notes: the arcsine's
        // domain of validity, an equivalent acos form).
        for (const n of casNotes) if (!caveats.includes(n)) caveats.push(n);
        return { variable: x, value, method: "exact (symbolic)", antiderivative: fs, caveats };
      }
    } catch {
      /* fall through to numeric */
    }
  }

  // THE SAME CHECK BEFORE THE NUMERIC PATH, NOT ONLY BEFORE THE EXACT ONE.
  //
  // Guarding just the symbolic branch left the same wrong number reachable by
  // another road. `integrate("1/(x-0.5)", 0, 3)` finds no antiderivative rule,
  // falls through to adaptive Simpson, and Simpson happily straddles the pole at
  // 0.5 without ever sampling it: it returned **5.0355** as a confident
  // "adaptive Simpson" result for an integral that diverges. Its stock caveat —
  // "a singularity inside the interval can make the result unreliable" — is a
  // hedge, not a refusal, and it appears on every numeric integral so it carries
  // no information about this one.
  //
  // Two paths sharing one wrong answer is the shape of this bug, so they now
  // share the guard.
  const numericGap = undefinedPointIn(e, x, a, b);
  if (numericGap !== null) {
    const cause =
      numericGap.kind === "pole"
        ? `has a POLE — a division by zero, or a pole of tan/cot/sec/csc — at ${x} ≈ ${fmtNum(numericGap.at)}`
        : `is UNDEFINED at ${x} ≈ ${fmtNum(numericGap.at)}`;
    return {
      variable: x,
      value: NaN,
      method: "does not exist on this interval",
      caveats: [
        `The integrand ${cause}, strictly inside [${fmtNum(a)}, ${fmtNum(b)}]. Quadrature can step ` +
          `straight over a pole without sampling it and return a plausible finite number, so no ` +
          `value is reported here. This integral is improper: split the interval at that point and ` +
          `take limits if you want a principal value.`,
      ],
    };
  }

  // C0 — A REMOVABLE SINGULARITY STILL DEFEATS THE QUADRATURE, ON PURPOSE.
  //
  // `sin(x)/x` over [-1, 1] is 1.8922 and is refused, because adaptive Simpson's
  // first midpoint is exactly 0 where sin(0)/0 is NaN. The obvious repair — when a
  // sample is non-finite, take the average of two neighbours a hair either side —
  // was built, measured, and REMOVED. It produced wrong numbers:
  //
  //     integral of (1-cos(x))/x^2 over [-1, 1]   0.9728 against a true 0.9896
  //     integral of tan(x)/x over [-1, 1]         2.2983, likewise low
  //
  // The reason is instructive and defeats the whole approach. Cancellation corrupts
  // these integrands over a NEIGHBOURHOOD of the singular point, not just at it: for
  // x below about 1e-8 the nearest double to cos(x) is exactly 1, so (1-cos(x))/x^2
  // evaluates to 0 rather than 0.5 — and BOTH neighbours agree on that wrong value,
  // so an agreement test cannot tell it from a genuine limit. Repairing the single
  // undefined point leaves the quadrature integrating a function that dips to zero
  // near the origin.
  //
  // A multi-scale consistency check (compare the estimate at h and at 1e4*h) does
  // separate sin(x)/x from (1-cos(x))/x^2, and would let the first through while
  // still refusing the second. It was not shipped because it converts a refusal into
  // a number for one case at a time, and getting it wrong makes a plausible 2% error
  // where there is currently an honest refusal. Refusing a correct answer is a
  // smaller harm than reporting an incorrect one — the same trade already made for
  // the cancellation-hidden identity in v2.40.1.
  //
  // The real fix is a quadrature rule that never samples the endpoint it is told to
  // avoid — Gauss-Legendre on each side of the known point — which is a change of
  // method rather than a patch. Recorded in docs/KNOWN-DEFECTS.md as C0.
  const f = (xv: number) => evalAst(e, { [x]: xv });
  let value = adaptiveSimpson(f, a, b);
  let usedGaussLegendre = false;

  // C0 — A REMOVABLE SINGULARITY NO LONGER DEFEATS THE QUADRATURE.
  //
  // Reached only when adaptive Simpson has already failed AND the structural pole
  // search above found nothing genuine inside the interval — so what remains is an
  // isolated point where the integrand is undefined but its limit exists.
  // `sin(x)/x` over [-1, 1] is the standard case: the answer is 1.8922, x = 0 is
  // removable, and Simpson's first midpoint is exactly 0.
  //
  // Composite Gauss-Legendre never evaluates a panel boundary or an endpoint, so the
  // undefined point is simply never visited.
  //
  // A CORRECTION TO THE RECORD, because the previous attempt was rejected on bad
  // evidence. An earlier fix averaged two neighbours across the singularity, and was
  // reverted on the grounds that it gave 0.9728 for the integral of (1-cos(x))/x^2
  // over [-1, 1] "against a true 0.9896". That 0.9896 was wrong — a hand figure that
  // was never checked. The true value is 0.97277, from the series
  // (1-cos x)/x^2 = 1/2 - x^2/24 + x^4/720 - ..., giving
  // 2*(1/2 - 1/72 + 1/3600 - ...) = 0.9727708, and confirmed here against an
  // independent high-resolution midpoint rule. So the averaging repair had been
  // producing CORRECT answers and was thrown away for nothing. Using an unverified
  // figure as the oracle to judge a fix is the mistake, and it cost a working one.
  //
  // Gauss-Legendre is still the better rule and is what ships: it never visits the
  // singular point at all rather than reconstructing a value there, its nodes stay
  // clear of the region where an integrand like (1-cos(x))/x^2 loses precision to
  // cancellation, and it carries its own convergence evidence by agreeing across two
  // panel counts. But it was chosen on its merits, not because the alternative was
  // wrong.
  //
  // Confined to the previously-refused path on purpose. Every integral that already
  // had an answer keeps the same one, computed the same way.
  // AN ENDPOINT POLE MUST NOT BE RESCUED BY A RULE THAT SKIPS ENDPOINTS.
  //
  // This is the trap in the whole approach, and it was caught by an existing test
  // rather than by foresight. The structural pole search above only reports poles
  // STRICTLY inside the interval, because a pole at an endpoint used to be caught by
  // Simpson evaluating that endpoint and returning NaN. Gauss-Legendre deliberately
  // never evaluates an endpoint — so `1/x` over [0, 1], which diverges, would come
  // back as a confident finite number. A wrong value for a divergent integral is the
  // worst thing this file can produce.
  //
  // The discriminator already exists: isGenuinePole asks whether the function blows
  // up at a point or merely has a hole there. So an endpoint where the integrand is
  // undefined is allowed through only if the singularity is REMOVABLE — sin(x)/x at
  // 0 — and never if it is a pole.
  const endpointBlocks = (t: number): boolean => {
    let v: number;
    try {
      v = evalAst(e, { [x]: t });
    } catch {
      return isGenuinePole(e, x, t);
    }
    if (Number.isFinite(v)) return false;
    return isGenuinePole(e, x, t);
  };

  if (!Number.isFinite(value) && !endpointBlocks(a) && !endpointBlocks(b)) {
    const gl = gaussLegendreConverged(f, a, b);
    if (gl !== null && Number.isFinite(gl)) {
      value = gl;
      usedGaussLegendre = true;
    }
  }

  if (!Number.isFinite(value)) {
    // The integrand is undefined somewhere in the interval. Say so, rather than
    // handing back a NaN dressed as a result.
    const gap = undefinedPointIn(e, x, a, b);
    return {
      variable: x,
      value: NaN,
      method: "does not exist on this interval",
      caveats: [
        `The integrand is undefined${gap === null ? "" : ` at ${x} ≈ ${fmtNum(gap.at)}`} inside [${fmtNum(a)}, ${fmtNum(b)}] ` +
        `— for example a square root of a negative number, a log of a non-positive number, or a division by zero. ` +
        `No value is reported, because there is none to report over this interval.`,
      ],
    };
  }
  const caveats = usedGaussLegendre
    ? [
        "Numeric definite integral by composite Gauss-Legendre quadrature — an approximation, " +
          "because no closed-form antiderivative rule applied here. The value was refined until " +
          "two different panel counts agreed to eleven significant figures.",
        "The integrand is UNDEFINED at an isolated point inside this interval, but its limit " +
          "there exists — a removable singularity, as in sin(x)/x at x = 0. Gauss-Legendre was " +
          "used because its sample points never fall on an interval or panel boundary, so that " +
          "point is never evaluated. The area is unaffected by a single missing point; if you " +
          "need the value of the function AT it, take the limit instead.",
      ]
    : [
        "Numeric definite integral (adaptive Simpson) — an approximation, because no closed-form antiderivative rule applied here.",
        "A singularity or discontinuity of the integrand inside the interval can make the result unreliable.",
      ];
  return {
    variable: x,
    value,
    method: usedGaussLegendre ? "Gauss-Legendre (removable singularity)" : "adaptive Simpson",
    caveats,
  };
}

/** Parses a bound expression like "0", "pi", or "pi/2" to a number, or NaN. */
export function parseBound(s: string): number {
  try {
    return evalAst(parseExpr(s), {});
  } catch {
    return NaN;
  }
}
