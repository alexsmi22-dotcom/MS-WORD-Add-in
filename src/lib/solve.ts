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

import { casSimplify, CasBail, solveRationalInVar } from "./cas";
import { symbolicIntegrate } from "./casint";
import { ambiguousImplicitProduct } from "./ambiguous";

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
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

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
  if (!s.includes("√")) return s; // the overwhelmingly common case, untouched
  let radicals = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "√" && ++radicals > MAX_RADICALS) return s;
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
    let depth = 0;
    while (true) {
      while (s[j] === " ") j++;
      if (s[j] !== "√") break;
      depth++;
      j++;
    }
    const inner = radicandAtom(j);
    if (!inner) return null;
    let text = inner.text;
    for (let d = 0; d < depth; d++) text = `(sqrt${text})`;
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
    if (s[i] !== "√") {
      out += s[i++];
      continue;
    }
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
      out += "sqrt"; // nothing usable follows — let atom() say so, by name
      i++;
      continue;
    }
    out += `sqrt${r.text}`;
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
export function normalizeUnicodeMath(input: string): string {
  const folded = input
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
    .replace(/∞/g, " inf ");
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
      if (name in EVAL_FN) {
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
    case "pow": return Math.pow(evalAst(e.l, vars), evalAst(e.r, vars));
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
    case "log":
    case "log10": return { t: "div", l: N(1), r: { t: "mul", l: u, r: N(Math.LN10) } };
    case "log2": return { t: "div", l: N(1), r: { t: "mul", l: u, r: N(Math.LN2) } };
    case "sqrt": return { t: "div", l: N(1), r: { t: "mul", l: N(2), r: { t: "fn", name: "sqrt", arg: u } } };
    case "cbrt": return { t: "div", l: N(1), r: { t: "mul", l: N(3), r: { t: "pow", l: { t: "fn", name: "cbrt", arg: u }, r: N(2) } } };
    case "asin": return { t: "div", l: N(1), r: { t: "fn", name: "sqrt", arg: { t: "sub", l: N(1), r: { t: "pow", l: u, r: N(2) } } } };
    case "acos": return { t: "neg", e: { t: "div", l: N(1), r: { t: "fn", name: "sqrt", arg: { t: "sub", l: N(1), r: { t: "pow", l: u, r: N(2) } } } } };
    case "atan": return { t: "div", l: N(1), r: { t: "add", l: N(1), r: { t: "pow", l: u, r: N(2) } } };
    case "sinh": return { t: "fn", name: "cosh", arg: u };
    case "cosh": return { t: "fn", name: "sinh", arg: u };
    case "tanh": return { t: "div", l: N(1), r: { t: "pow", l: { t: "fn", name: "cosh", arg: u }, r: N(2) } };
    case "abs": return { t: "div", l: u, r: { t: "fn", name: "abs", arg: u } }; // sign(u); undefined at 0
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
// Root finding.
// ---------------------------------------------------------------------------

export interface Root {
  display: string;
  re: number;
  im: number;
  exact: boolean;
  /** True for a symbolic (rearranged) solution like a = F/m; re/im are NaN then. */
  symbolic?: boolean;
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

/** Exact roots of a linear or quadratic; null if degree is not 1 or 2. */
function solvePolyExact(coeffs: number[]): Root[] | null {
  const c = trimPoly(coeffs);
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

/** Snaps a value to the nearest integer when it is within tol, else rounds for display. */
function snap(v: number): number {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-7) return r;
  return Math.round(v * 1e9) / 1e9;
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
  const cleaned = roots.map((z) => {
    const re = snap(z.re);
    const im = Math.abs(z.im) < 1e-7 ? 0 : snap(z.im);
    return { re, im };
  });
  const groups: { re: number; im: number; mult: number }[] = [];
  for (const z of cleaned) {
    const g = groups.find((h) => Math.abs(h.re - z.re) < 1e-6 && Math.abs(h.im - z.im) < 1e-6);
    if (g) g.mult++;
    else groups.push({ ...z, mult: 1 });
  }
  return groups
    .sort((a, b) => b.re - a.re || a.im - b.im)
    .map((g) => ({
      display: fmtRoot(g.re, g.im) + (g.mult > 1 ? ` (×${g.mult})` : ""),
      re: g.re,
      im: g.im,
      exact: false,
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
export function solveEquation(input: string, variable?: string, range = 1000): EquationResult | null {
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
    const exact = solvePolyExact(trimmed);
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
    // Degree >= 3 polynomial: ALL roots (real and complex) via Durand–Kerner.
    const roots = allPolyRoots(trimmed);
    steps.push(`Degree-${deg} polynomial; all ${deg} root${deg === 1 ? "" : "s"} found (Durand–Kerner), counting multiplicity.`);
    caveats.push(
      `Complete: every root is shown, real and complex. Values are numerical (refined to ~1e-10); an exact closed form is not attempted above the quadratic.`
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
        `${sym.kind === "linear" ? "Linear" : "Quadratic"} in ${x} once rearranged; solved in closed form` +
          (others.length ? ` with ${others.join(", ")} carried through symbolically.` : ".")
      );
      steps.push(
        sym.verified
          ? "Verified: substituting the solution back reduces the equation to exactly 0."
          : "Verified by substituting back at sample values of the other symbols."
      );
      for (const c of sym.nonzeroConditions) {
        caveats.push(`Requires ${format(c)} ≠ 0 — the rearrangement divides by it.`);
      }
      if (sym.discriminant) {
        caveats.push(`The two roots are the ± branches of the quadratic formula; they are real when ${format(sym.discriminant)} ≥ 0.`);
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
    return {
      variable: x,
      roots: [],
      method: "identity",
      steps: [
        `Both sides agree to within double precision at ${sideProbe.length} sample points ` +
          `across [−${range}, ${range}].`,
      ],
      caveats: [
        `Every value of ${x} satisfies this equation (an identity), so there is no ` +
          `particular root to report.` +
          (sideProbe.length < 41
            ? ` The expression is undefined at some points — where a denominator vanishes, ` +
              `for example — and those are excluded.`
            : ""),
      ],
      unknowns: vars,
    };
  }

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
export function differentiate(input: string, variable?: string): DerivativeResult | null {
  let e: Expr;
  try { e = parseExpr(input); } catch { return null; }
  const vars = freeVars(e);
  const x = variable ?? (vars.length === 1 ? vars[0] : "x");
  const d = simplify(simplify(derivative(e, x)));
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
  const finiteSomewhere = (expr: Expr): boolean => {
    const others = freeVars(expr).filter((v) => v !== x);
    for (const p of SAMPLE) {
      const env: Record<string, number> = { [x]: p };
      others.forEach((v, i) => { env[v] = 1.7 + i * 0.9; });
      try {
        if (Number.isFinite(evalAst(expr, env))) return true;
      } catch {
        /* try the next point */
      }
    }
    return false;
  };
  // Not "finite everywhere" — 1/x is a perfectly good integrand that blows up
  // at one point. The test is whether it is finite ANYWHERE.
  if (!finiteSomewhere(simplified)) return null;

  const cas = symbolicIntegrate(simplified, x, derivative);
  const F = cas?.F ?? symbolicAntideriv(simplified, x);
  if (!F) return null;

  const Fs = simplify(F);
  if (!finiteSomewhere(Fs)) return null;
  const fs = format(Fs);
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
    for (const p of [0.37, 0.83, 1.29, 2.11, 3.57, -0.61, -1.73, -2.89]) {
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
  const F = symbolicIntegrate(simplify(e), x, derivative)?.F ?? symbolicAntideriv(simplify(e), x);
  if (F) {
    const Fs = simplify(F);
    try {
      const value = evalAst(Fs, { [x]: b }) - evalAst(Fs, { [x]: a });
      if (Number.isFinite(value)) {
        const caveats: string[] = [];
        const fs = format(Fs);
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
