// Tokenizer + recursive-descent parser for linear math expressions, producing a
// shared AST that is emitted to OMML (mathOmml.ts, for Word insertion) and to
// HTML (mathHtml.ts, for the live preview).
//
// Supported syntax:
//   a/b              fraction              x^2  a_n  a_n^2   super/subscripts
//   x^{n+1}          braced group          sqrt(x)          square root
//   root(n, x)       n-th root             abs(x) or |x|    absolute value
//   sum(i=1, n, e)   summation (Σ)         int(a, b, e)     integral (∫)
//   prod(i=1, n, e)  product (∏)           lim(x->0, e)     limit
//   sin(x) cos(x)…   named functions       bar(x) hat(x) vec(x)  accents
//   2x  ab  2(x+1)   implicit multiplication
//   matrix(a,b; c,d) matrix (rows by ';', columns by ','); pmatrix/bmatrix/vmatrix
//                    choose ( ), [ ] or | | delimiters
//   cases(x, if x>0; -x, otherwise)        piecewise / cases (brace)
//   + - * / = < >    operators (* → ×, <= >= != -> → ≤ ≥ ≠ →); pi, theta… → symbols
//
// Anything it can't parse throws, so callers can fall back to plain formatting.

import { ambiguousImplicitProduct } from "./ambiguous";

export type Node =
  | { k: "text"; v: string; plain?: boolean; label?: boolean } // leaf run; plain → upright (function names); label → a sign used as a name (|+⟩, Φ⁺), not an operator
  | { k: "row"; items: Node[] }
  | { k: "frac"; num: Node; den: Node }
  | { k: "sup"; base: Node; sup: Node }
  | { k: "sub"; base: Node; sub: Node }
  | { k: "subsup"; base: Node; sub: Node; sup: Node }
  | { k: "rad"; radicand: Node; degree?: Node }
  | { k: "delim"; inner: Node; open: string; close: string }
  | { k: "nary"; chr: string; sub: Node; sup: Node; body: Node; underOver: boolean }
  | { k: "func"; name: string; arg: Node; known: boolean }
  | { k: "lim"; sub: Node; body: Node }
  | { k: "acc"; chr: string; base: Node }
  | { k: "matrix"; rows: Node[][]; open: string; close: string }
  | { k: "cases"; rows: Node[][] }
  | { k: "stack"; rows: Node[] }; // stacked equations (equation array), e.g. align(...)

interface Token {
  t:
    | "num"
    | "id"
    | "op"
    | "lparen"
    | "rparen"
    | "lbrace"
    | "rbrace"
    | "lbrack"
    | "rbrack"
    | "caret"
    | "underscore"
    | "comma"
    | "semi"
    | "bar";
  v: string;
  /** Whitespace was typed before this token (only a script's lone sign reads it: "sigma_+ sigma_-"). */
  sp?: boolean;
}

const MULTI_CHAR_OPS: Record<string, string> = { "<=": "≤", ">=": "≥", "!=": "≠", "->": "→", "+-": "±" };

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  inf: "∞", infty: "∞", infinity: "∞",
};

const KNOWN_FUNCS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh",
  "arcsin", "arccos", "arctan", "log", "ln", "exp", "det", "dim", "max", "min", "gcd", "mod",
  "argmax", "argmin", "lcm", "softmax", "sigmoid", "relu", "re", "im",
  // Reciprocal & inverse trig / hyperbolic
  "sech", "csch", "coth", "arcsec", "arccsc", "arccot",
  "arcsinh", "arccosh", "arctanh", "arsinh", "arcosh", "artanh",
  // Logarithmic, special, statistical, and linear-algebra functions
  "lg", "erf", "erfc", "sgn", "sign", "arg", "tr", "trace", "rank", "adj",
  "var", "cov", "std", "ker", "deg", "lerp", "clamp",
]);

// Named operators/symbols typed as words → glyphs (logic, set theory, calculus,
// blackboard-bold number sets). Checked after Greek; the tokenizer also routes the
// glyphs themselves to atoms so palette-inserted symbols parse too.
const SYMBOLS: Record<string, string> = {
  forall: "∀", exists: "∃", in: "∈", notin: "∉",
  subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  union: "∪", cup: "∪", cap: "∩", intersect: "∩", emptyset: "∅",
  and: "∧", land: "∧", or: "∨", lor: "∨", not: "¬", lnot: "¬",
  xor: "⊕", oplus: "⊕", otimes: "⊗", times: "×", cdot: "·",
  iff: "⇔", implies: "⇒", to: "→", mapsto: "↦",
  equiv: "≡", approx: "≈", cong: "≅", propto: "∝", parallel: "∥", neq: "≠",
  partial: "∂", nabla: "∇", grad: "∇", degree: "°", deg: "°",
  ZZ: "ℤ", RR: "ℝ", NN: "ℕ", QQ: "ℚ", CC: "ℂ", PP: "ℙ", EE: "𝔼", FF: "𝔽",
  // Electrical engineering & physics
  angle: "∠", laplace: "ℒ", fourier: "ℱ", ohm: "Ω", hbar: "ℏ",
  // Quantum (Release Q): the adjoint, U^dagger → U†.
  dagger: "†",
};

// Words that should render upright even when used without parentheses (e.g.
// "a mod n", "argmax_x f(x)", "Pr[A]").
const UPRIGHT_WORDS = new Set(["mod", "argmax", "argmin", "lcm", "gcd", "Pr"]);

// Single-char glyphs that act as operands / prefixes (not infix operators), so a
// pasted "∀ x", "¬ p", "∂", "ℤ" or "90°" parses. Binary glyphs (∈ ∪ ⊕ ≡ …) are
// left as operators by the tokenizer's default case.
const ATOM_GLYPHS = new Set([
  "∀", "∃", "¬", "∂", "∇", "∅", "°", "∞", "ℤ", "ℝ", "ℕ", "ℚ", "ℂ", "ℙ", "ℏ", "ℒ", "ℱ",
  // The dagger: postfix A† is the superscript adjoint (parseFactor), and ^† / ^dagger read as the same.
  "†",
]);

const ACCENTS: Record<string, string> = { bar: "̄", hat: "̂", vec: "⃗" };

// N-ary operator keywords → big-operator glyph (sum/prod sit limits under/over).
const NARY_CHR: Record<string, string> = {
  sum: "∑", prod: "∏", int: "∫", oint: "∮", iint: "∬", iiint: "∭",
};

// Matrix keywords → [open, close] delimiter pair.
const MATRIX_DELIMS: Record<string, [string, string]> = {
  matrix: ["[", "]"],
  bmatrix: ["[", "]"],
  pmatrix: ["(", ")"],
  vmatrix: ["|", "|"],
};

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}
function isAlpha(ch: string): boolean {
  if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) return true;
  // Greek letters (Α–Ω, α–ω) so literal glyphs from the palette parse as atoms.
  const c = ch.charCodeAt(0);
  return c >= 0x0391 && c <= 0x03c9;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  /** Indices of tokens typed after whitespace. */
  const gapBefore = new Set<number>();
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
      gapBefore.add(tokens.length);
      i++;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (MULTI_CHAR_OPS[two]) {
      tokens.push({ t: "op", v: MULTI_CHAR_OPS[two] });
      i += 2;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(input[i + 1]))) {
      let num = "";
      while (i < n && (isDigit(input[i]) || input[i] === ".")) num += input[i++];
      tokens.push({ t: "num", v: num });
      continue;
    }

    if (isAlpha(ch)) {
      let id = "";
      while (i < n && isAlpha(input[i])) id += input[i++];
      tokens.push({ t: "id", v: id });
      continue;
    }

    // Operand/prefix glyphs (∀, ¬, ∂, ℤ, °, …) parse as atoms, not operators.
    if (ATOM_GLYPHS.has(ch)) {
      tokens.push({ t: "id", v: ch });
      i++;
      continue;
    }

    switch (ch) {
      case "(": tokens.push({ t: "lparen", v: ch }); break;
      case ")": tokens.push({ t: "rparen", v: ch }); break;
      case "{": tokens.push({ t: "lbrace", v: ch }); break;
      case "}": tokens.push({ t: "rbrace", v: ch }); break;
      case "[": tokens.push({ t: "lbrack", v: ch }); break;
      case "]": tokens.push({ t: "rbrack", v: ch }); break;
      case "^": tokens.push({ t: "caret", v: ch }); break;
      case "_": tokens.push({ t: "underscore", v: ch }); break;
      case ",": tokens.push({ t: "comma", v: ch }); break;
      case ";": tokens.push({ t: "semi", v: ch }); break;
      case "|": tokens.push({ t: "bar", v: ch }); break;
      case "*": tokens.push({ t: "op", v: "×" }); break;
      case "+": case "-": case "=": case "<": case ">":
        tokens.push({ t: "op", v: ch });
        break;
      default:
        tokens.push({ t: "op", v: ch });
    }
    i++;
  }
  for (const k of gapBefore) if (tokens[k]) tokens[k].sp = true;
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  /**
   * What the user should be told is MISSING, in the notation they typed.
   *
   * The message used to interpolate the internal token type: `abs x` produced
   * "Expected lparen in math expression.", `|x` produced "Expected bar...", and
   * `{x` produced "Expected rbrace...". The reader did not write an lparen and has
   * no reason to know what one is. Naming the character makes the message
   * actionable, which is the only thing an error message is for.
   */
  private static describe(type: Token["t"]): string {
    switch (type) {
      case "lparen": return 'an opening bracket "("';
      case "rparen": return 'a closing bracket ")"';
      case "lbrace": return 'an opening brace "{"';
      case "rbrace": return 'a closing brace "}"';
      case "lbrack": return 'an opening bracket "["';
      case "rbrack": return 'a closing bracket "]"';
      case "bar": return 'a vertical bar "|"';
      case "comma": return 'a comma ","';
      case "semi": return 'a semicolon ";"';
      case "caret": return 'a caret "^"';
      case "underscore": return 'an underscore "_"';
      case "num": return "a number";
      case "id": return "a name";
      case "op": return "an operator";
      default: return `a ${type}`;
    }
  }

  private expect(type: Token["t"]): Token {
    const t = this.next();
    if (!t || t.t !== type) {
      const want = Parser.describe(type);
      const got = t ? `"${t.v ?? t.t}"` : "the end of the expression";
      throw new Error(`Expected ${want} here, but found ${got}.`);
    }
    return t;
  }

  parse(): Node {
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) {
      throw new Error(`Unexpected "${this.peek()?.v}" in math expression.`);
    }
    return node;
  }

  // expr := term ( (+ - = < > and relations) term )*
  private parseExpr(): Node {
    const items: Node[] = [this.parseTerm()];
    while (this.peek()?.t === "op") {
      // Inside a ket/bra argument, a trailing sign is a superscript label: ket(Phi+) is |Φ⁺⟩, bra(Psi-) is ⟨Ψ⁻|.
      if (this.diracDepth > 0 && Parser.isSign(this.peek()) && this.closesArg(this.tokens[this.pos + 1])) {
        const sign = Parser.signText(this.next().v);
        const last = items.pop() as Node;
        items.push({ k: "sup", base: last, sup: { k: "text", v: sign, plain: true, label: true } });
        continue;
      }
      const op = this.next().v;
      items.push({ k: "text", v: op, plain: true });
      items.push(this.parseTerm());
    }
    return items.length === 1 ? items[0] : { k: "row", items };
  }

  // term := factor ( '*'×concat | '/'fraction | implicit-mult factor )*
  private parseTerm(): Node {
    let node = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && t.v === "×") {
        this.next();
        node = { k: "row", items: [node, { k: "text", v: "×", plain: true }, this.parseFactor()] };
      } else if (t?.t === "op" && t.v === "/") {
        this.next();
        node = { k: "frac", num: node, den: this.parseFactor() };
      } else if (this.startsBase(t)) {
        // implicit multiplication: juxtaposition, no visible operator
        node = { k: "row", items: [node, this.parseFactor()] };
      } else {
        break;
      }
    }
    return node;
  }

  /** > 0 while reading a ket/bra/braket argument (where a trailing or lone sign is a state label). */
  private diracDepth = 0;

  private static isSign(t: Token | undefined): boolean {
    return !!t && t.t === "op" && (t.v === "+" || t.v === "-" || t.v === "−");
  }
  private static signText(v: string): string {
    return v === "+" ? "+" : "−";
  }
  private static isSupSign(t: Token | undefined): boolean {
    return !!t && t.t === "op" && (t.v === "⁺" || t.v === "⁻");
  }
  /** The token after a sign ends a Dirac argument: the sign is the label (ket(+), ket(Phi+)). */
  private closesArg(t: Token | undefined): boolean {
    return !!t && (t.t === "rparen" || t.t === "comma");
  }
  /**
   * The token after a script's sign leaves it nothing to apply to: the sign is the script itself (Phi^+). A lone sign
   * is the whole script when followed by the end, whitespace, a closing bracket or separator, or any operator:
   * "Phi^+ + Psi^-" is Φ⁺ + Ψ⁻, "sigma_+ sigma_-" is σ₊σ₋, "a_+ + a_-" is a₊ + a₋. Glued to an operand it still
   * signs that operand (x^-1, x^-n). After a caret, a spaced NUMBER is still the exponent's operand: "x^- 1" is x⁻¹
   * (a stray space must not turn it into x⁻·1), while "Phi^+ Psi" keeps the label reading.
   */
  private closesScript(t: Token | undefined, caret = false): boolean {
    if (!t) return true;
    if (t.sp) return !(caret && t.t === "num");
    if (t.t === "op") return true;
    return t.t === "rparen" || t.t === "rbrace" || t.t === "rbrack" || t.t === "comma" || t.t === "semi" || t.t === "bar";
  }

  /** ket/bra/braket arguments: a lone sign is the state label (ket(+) is |+⟩, bra(-) is ⟨−|). */
  private parseDiracArgs(count: number): Node[] {
    this.expect("lparen");
    this.diracDepth++;
    try {
      const one = (): Node => {
        if (Parser.isSign(this.peek()) && this.closesArg(this.tokens[this.pos + 1]))
          return { k: "text", v: Parser.signText(this.next().v), plain: true, label: true };
        return this.parseExpr();
      };
      const args: Node[] = [one()];
      while (this.peek()?.t === "comma") {
        this.next();
        args.push(one());
      }
      this.expect("rparen");
      if (args.length !== count) throw new Error(`Expected ${count} argument(s) but got ${args.length}.`);
      return args;
    } finally {
      this.diracDepth--;
    }
  }

  private startsBase(t: Token | undefined): boolean {
    // `bar` (|) is intentionally excluded: a "|" is ambiguous between opening and
    // closing an absolute value, so allowing it as an implicit-multiplication
    // start would let a closing "|" be misread as a new |…| group.
    return !!t && (t.t === "num" || t.t === "id" || t.t === "lparen" || t.t === "lbrace" || t.t === "lbrack");
  }

  // factor := base ( ^base | _base )* '!'*
  private parseFactor(): Node {
    const base = this.parseBase();
    let sub: Node | null = null;
    let sup: Node | null = null;
    while (
      this.peek()?.t === "caret" ||
      this.peek()?.t === "underscore" ||
      Parser.isSupSign(this.peek()) ||
      (this.peek()?.t === "id" && this.peek()?.v === "†")
    ) {
      const tok = this.next();
      let s: Node;
      if (tok.t === "op" || tok.t === "id") {
        // A superscript typed as a glyph: the adjoint U† (postfix), or a sign Φ⁺, Ψ⁻. It joins any superscript
        // already there (U²† is U^{2†}), never nests under it.
        s = tok.t === "id" ? { k: "text", v: "†" } : { k: "text", v: tok.v === "⁺" ? "+" : "−", plain: true, label: true };
        sup = sup ? { k: "row", items: [sup, s] } : s;
        continue;
      }
      // A lone sign as the script (Phi^+, x_-), i.e. a sign with nothing after it to apply to, is the sign itself.
      if (Parser.isSign(this.peek()) && this.closesScript(this.tokens[this.pos + 1], tok.t === "caret")) {
        s = { k: "text", v: Parser.signText(this.next().v), plain: true, label: true };
      } else s = this.parseBase();
      // A repeated script nests right-associatively (x^2^3 → x^(2^3)) instead of
      // silently overwriting the earlier one.
      if (tok.t === "caret") sup = sup ? { k: "sup", base: sup, sup: s } : s;
      else sub = sub ? { k: "sub", base: sub, sub: s } : s;
    }

    let node: Node;
    if (sub && sup) node = { k: "subsup", base, sub, sup };
    else if (sup) node = { k: "sup", base, sup };
    else if (sub) node = { k: "sub", base, sub };
    else node = base;

    // Factorial postfix.
    while (this.peek()?.t === "op" && this.peek()?.v === "!") {
      this.next();
      node = { k: "row", items: [node, { k: "text", v: "!", plain: true }] };
    }
    return node;
  }

  private parseBase(): Node {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of math expression.");

    if (t.t === "num") {
      this.next();
      return { k: "text", v: t.v };
    }

    if (t.t === "id") {
      this.next();
      return this.parseIdentifier(t.v);
    }

    if (t.t === "lbrack") {
      this.next();
      const items: Node[] = [this.parseExpr()];
      while (this.peek()?.t === "comma") {
        this.next();
        items.push({ k: "text", v: ", ", plain: true });
        items.push(this.parseExpr());
      }
      this.expect("rbrack");
      const inner = items.length === 1 ? items[0] : { k: "row" as const, items };
      return { k: "delim", inner, open: "[", close: "]" };
    }

    if (t.t === "lparen") {
      this.next();
      const inner = this.parseExpr();
      this.expect("rparen");
      return { k: "delim", inner, open: "(", close: ")" };
    }

    if (t.t === "lbrace") {
      this.next();
      const inner = this.parseExpr();
      this.expect("rbrace");
      return inner; // grouping only
    }

    if (t.t === "bar") {
      this.next();
      const inner = this.parseExpr();
      this.expect("bar");
      return { k: "delim", inner, open: "|", close: "|" };
    }

    if (t.t === "op" && (t.v === "+" || t.v === "-" || (t.v === "−" && this.diracDepth > 0))) {
      this.next();
      // Inside a ket or bra the sign is typeset as a true minus: |−i⟩.
      return { k: "row", items: [{ k: "text", v: this.diracDepth > 0 && t.v === "-" ? "−" : t.v, plain: true }, this.parseBase()] };
    }

    throw new Error(`Unexpected "${t.v}" in math expression.`);
  }

  private parseIdentifier(id: string): Node {
    const lower = id.toLowerCase();

    if (lower === "sqrt") return { k: "rad", radicand: this.parseSingleGroup() };
    if (lower === "root") {
      const [degree, radicand] = this.parseArgs(2);
      return { k: "rad", radicand, degree };
    }
    if (NARY_CHR[lower]) {
      const [sub, sup, body] = this.parseArgs(3);
      return { k: "nary", chr: NARY_CHR[lower], sub, sup, body, underOver: lower === "sum" || lower === "prod" };
    }
    if (lower === "lim") {
      const [sub, body] = this.parseArgs(2);
      return { k: "lim", sub, body };
    }
    if (lower === "abs") {
      const [inner] = this.parseArgs(1);
      return { k: "delim", inner, open: "|", close: "|" };
    }
    if (lower === "floor") {
      const [inner] = this.parseArgs(1);
      return { k: "delim", inner, open: "⌊", close: "⌋" };
    }
    if (lower === "ceil") {
      const [inner] = this.parseArgs(1);
      return { k: "delim", inner, open: "⌈", close: "⌉" };
    }
    if (lower === "norm") {
      const [inner] = this.parseArgs(1);
      return { k: "delim", inner, open: "‖", close: "‖" };
    }
    // Dirac notation: bra ⟨ψ|, ket |ψ⟩, inner product ⟨φ|ψ⟩, expectation ⟨A⟩.
    if (lower === "bra") {
      const [inner] = this.parseDiracArgs(1);
      return { k: "delim", inner, open: "⟨", close: "|" };
    }
    if (lower === "ket") {
      const [inner] = this.parseDiracArgs(1);
      return { k: "delim", inner, open: "|", close: "⟩" };
    }
    if (lower === "braket" || lower === "ip") {
      const [a, b] = this.parseDiracArgs(2);
      const inner: Node = { k: "row", items: [a, { k: "text", v: "|", plain: true }, b] };
      return { k: "delim", inner, open: "⟨", close: "⟩" };
    }
    if (lower === "expval" || lower === "avg") {
      const [inner] = this.parseArgs(1);
      return { k: "delim", inner, open: "⟨", close: "⟩" };
    }
    if (ACCENTS[lower]) {
      const [base] = this.parseArgs(1);
      return { k: "acc", chr: ACCENTS[lower], base };
    }
    if (MATRIX_DELIMS[lower]) {
      const rows = this.parseRows();
      const cols = rows[0].length;
      if (rows.some((r) => r.length !== cols)) {
        throw new Error("Matrix rows must all have the same number of entries.");
      }
      const [open, close] = MATRIX_DELIMS[lower];
      return { k: "matrix", rows, open, close };
    }
    if (lower === "cases" || lower === "piecewise") {
      const rows = this.parseRows();
      if (rows.some((r) => r.length > 2)) {
        throw new Error("Each case takes a value and an optional condition.");
      }
      return { k: "cases", rows };
    }
    if (lower === "align" || lower === "aligned" || lower === "stack") {
      return { k: "stack", rows: this.parseStackRows() };
    }

    // Function application: an identifier immediately followed by "(".
    if (this.peek()?.t === "lparen") {
      const arg = this.parseParenGroup();
      return { k: "func", name: id, arg, known: KNOWN_FUNCS.has(lower) };
    }

    // Words that stay upright without parentheses (e.g. "a mod n", "Pr[A]").
    if (UPRIGHT_WORDS.has(id) || UPRIGHT_WORDS.has(lower)) return { k: "text", v: id, plain: true };

    if (GREEK[id]) return { k: "text", v: GREEK[id] };
    if (GREEK[lower]) return { k: "text", v: GREEK[lower] };
    if (SYMBOLS[id]) return { k: "text", v: SYMBOLS[id] };
    if (SYMBOLS[lower]) return { k: "text", v: SYMBOLS[lower] };
    return { k: "text", v: id };
  }

  /** Parses exactly `count` comma-separated arguments wrapped in parentheses. */
  private parseArgs(count: number): Node[] {
    this.expect("lparen");
    const args: Node[] = [this.parseExpr()];
    while (this.peek()?.t === "comma") {
      this.next();
      args.push(this.parseExpr());
    }
    this.expect("rparen");
    if (args.length !== count) {
      throw new Error(`Expected ${count} argument(s) but got ${args.length}.`);
    }
    return args;
  }

  /** Parses parenthesized rows for matrices/cases: comma-separated cells per row,
   *  rows separated by ';'. e.g. "(a, b; c, d)" → [[a,b],[c,d]]. */
  private parseRows(): Node[][] {
    this.expect("lparen");
    const rows: Node[][] = [];
    let row: Node[] = [this.parseExpr()];
    for (;;) {
      const t = this.peek();
      if (t?.t === "comma") {
        this.next();
        row.push(this.parseExpr());
      } else if (t?.t === "semi") {
        this.next();
        rows.push(row);
        row = [this.parseExpr()];
      } else {
        break;
      }
    }
    rows.push(row);
    this.expect("rparen");
    return rows;
  }

  /** Parses parenthesized rows for stacked equations: one expression per row,
   *  rows separated by ';'. e.g. "(a = b; c = d)" → [a=b, c=d]. */
  private parseStackRows(): Node[] {
    this.expect("lparen");
    const rows: Node[] = [this.parseExpr()];
    while (this.peek()?.t === "semi") {
      this.next();
      rows.push(this.parseExpr());
    }
    this.expect("rparen");
    return rows;
  }

  /** Parses a parenthesized group, preserving commas as visible separators. */
  private parseParenGroup(): Node {
    this.expect("lparen");
    const items: Node[] = [this.parseExpr()];
    while (this.peek()?.t === "comma") {
      this.next();
      items.push({ k: "text", v: ", ", plain: true });
      items.push(this.parseExpr());
    }
    this.expect("rparen");
    const inner = items.length === 1 ? items[0] : { k: "row" as const, items };
    return { k: "delim", inner, open: "(", close: ")" };
  }

  /** Parses a (…), {…} or single base — used for the radicand of sqrt. */
  private parseSingleGroup(): Node {
    const t = this.peek();
    if (t?.t === "lparen") {
      this.next();
      const inner = this.parseExpr();
      this.expect("rparen");
      return inner;
    }
    if (t?.t === "lbrace") {
      this.next();
      const inner = this.parseExpr();
      this.expect("rbrace");
      return inner;
    }
    return this.parseBase();
  }
}

/** Parses a linear math expression into the shared AST. Throws on parse errors. */
export function parseMathAst(input: string): Node {
  // Same refusal as solve.ts's parseExpr, and it has to be the SAME refusal: the
  // whole defect was that these two files read `1/2x` differently. See
  // lib/ambiguous.ts for why neither reading was chosen.
  const ambiguous = ambiguousImplicitProduct(input);
  if (ambiguous) throw new Error(ambiguous);
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Empty math expression.");
  return new Parser(tokens).parse();
}
