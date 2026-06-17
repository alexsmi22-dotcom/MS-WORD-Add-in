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

export type Node =
  | { k: "text"; v: string; plain?: boolean } // leaf run; plain → upright (function names)
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
  | { k: "cases"; rows: Node[][] };

interface Token {
  t:
    | "num"
    | "id"
    | "op"
    | "lparen"
    | "rparen"
    | "lbrace"
    | "rbrace"
    | "caret"
    | "underscore"
    | "comma"
    | "semi"
    | "bar";
  v: string;
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
]);

const ACCENTS: Record<string, string> = { bar: "̄", hat: "̂", vec: "⃗" };

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
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
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

    switch (ch) {
      case "(": tokens.push({ t: "lparen", v: ch }); break;
      case ")": tokens.push({ t: "rparen", v: ch }); break;
      case "{": tokens.push({ t: "lbrace", v: ch }); break;
      case "}": tokens.push({ t: "rbrace", v: ch }); break;
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
  private expect(type: Token["t"]): Token {
    const t = this.next();
    if (!t || t.t !== type) throw new Error(`Expected ${type} in math expression.`);
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

  private startsBase(t: Token | undefined): boolean {
    // `bar` (|) is intentionally excluded: a "|" is ambiguous between opening and
    // closing an absolute value, so allowing it as an implicit-multiplication
    // start would let a closing "|" be misread as a new |…| group.
    return !!t && (t.t === "num" || t.t === "id" || t.t === "lparen" || t.t === "lbrace");
  }

  // factor := base ( ^base | _base )* '!'*
  private parseFactor(): Node {
    const base = this.parseBase();
    let sub: Node | null = null;
    let sup: Node | null = null;
    while (this.peek()?.t === "caret" || this.peek()?.t === "underscore") {
      const tok = this.next();
      if (tok.t === "caret") sup = this.parseBase();
      else sub = this.parseBase();
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

    if (t.t === "op" && (t.v === "+" || t.v === "-")) {
      this.next();
      return { k: "row", items: [{ k: "text", v: t.v, plain: true }, this.parseBase()] };
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
    if (lower === "sum" || lower === "prod" || lower === "int") {
      const [sub, sup, body] = this.parseArgs(3);
      const chr = lower === "sum" ? "∑" : lower === "prod" ? "∏" : "∫";
      return { k: "nary", chr, sub, sup, body, underOver: lower !== "int" };
    }
    if (lower === "lim") {
      const [sub, body] = this.parseArgs(2);
      return { k: "lim", sub, body };
    }
    if (lower === "abs") {
      const [inner] = this.parseArgs(1);
      return { k: "delim", inner, open: "|", close: "|" };
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

    // Function application: an identifier immediately followed by "(".
    if (this.peek()?.t === "lparen") {
      const arg = this.parseParenGroup();
      return { k: "func", name: id, arg, known: KNOWN_FUNCS.has(lower) };
    }

    if (GREEK[id]) return { k: "text", v: GREEK[id] };
    if (GREEK[lower]) return { k: "text", v: GREEK[lower] };
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
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Empty math expression.");
  return new Parser(tokens).parse();
}
