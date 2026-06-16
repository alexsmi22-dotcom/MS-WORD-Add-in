// Converts a linear math expression into OMML (Office Math Markup Language),
// wrapped in a minimal flat-OPC WordprocessingML package suitable for
// Word.Range.insertOoxml(). Unlike the inline formatter (mathFormat.ts), this
// produces a real Word equation object: true stacked fractions, radicals, and
// combined sub/superscripts.
//
// Supported syntax:
//   a/b            stacked fraction
//   x^2  a_n       super/subscript (also combined: a_n^2)
//   x^{n+1}        braces group multiple characters
//   sqrt(x)        radical
//   (a+b)          parentheses preserved as math delimiters
//   + - * / = < >  operators ( * renders as ×, <= >= != -> map to ≤ ≥ ≠ → )
//   pi, theta, …   common Greek names map to symbols
//
// Anything it cannot parse cleanly throws, so callers can fall back to the
// inline formatter.

// ----------------------------------------------------------------------------
// AST
// ----------------------------------------------------------------------------

type Node =
  | { k: "text"; v: string } // a leaf run (number, identifier, symbol, operator)
  | { k: "row"; items: Node[] } // a sequence of sibling elements
  | { k: "frac"; num: Node; den: Node }
  | { k: "sup"; base: Node; sup: Node }
  | { k: "sub"; base: Node; sub: Node }
  | { k: "subsup"; base: Node; sub: Node; sup: Node }
  | { k: "rad"; radicand: Node }
  | { k: "delim"; inner: Node };

// ----------------------------------------------------------------------------
// Tokenizer
// ----------------------------------------------------------------------------

interface Token {
  t: "num" | "id" | "op" | "lparen" | "rparen" | "lbrace" | "rbrace" | "caret" | "underscore";
  v: string;
}

const MULTI_CHAR_OPS: Record<string, string> = {
  "<=": "≤",
  ">=": "≥",
  "!=": "≠",
  "->": "→",
};

const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  inf: "∞",
  infty: "∞",
  infinity: "∞",
};

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

    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (i < n && ((input[i] >= "0" && input[i] <= "9") || input[i] === ".")) num += input[i++];
      tokens.push({ t: "num", v: num });
      continue;
    }

    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      let id = "";
      while (i < n && ((input[i] >= "a" && input[i] <= "z") || (input[i] >= "A" && input[i] <= "Z"))) {
        id += input[i++];
      }
      tokens.push({ t: "id", v: id });
      continue;
    }

    switch (ch) {
      case "(":
        tokens.push({ t: "lparen", v: ch });
        break;
      case ")":
        tokens.push({ t: "rparen", v: ch });
        break;
      case "{":
        tokens.push({ t: "lbrace", v: ch });
        break;
      case "}":
        tokens.push({ t: "rbrace", v: ch });
        break;
      case "^":
        tokens.push({ t: "caret", v: ch });
        break;
      case "_":
        tokens.push({ t: "underscore", v: ch });
        break;
      case "*":
        tokens.push({ t: "op", v: "×" });
        break;
      case "+":
      case "-":
      case "=":
      case "<":
      case ">":
        tokens.push({ t: "op", v: ch });
        break;
      default:
        // Pass through any other single character as a text operator.
        tokens.push({ t: "op", v: ch });
    }
    i++;
  }

  return tokens;
}

// ----------------------------------------------------------------------------
// Parser (recursive descent)
// ----------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  parse(): Node {
    const node = this.parseExpr();
    if (this.pos !== this.tokens.length) {
      throw new Error(`Unexpected token "${this.peek()?.v}" in math expression.`);
    }
    return node;
  }

  // expr := term ( (+ - = < > and mapped relations) term )*
  private parseExpr(): Node {
    const items: Node[] = [this.parseTerm()];
    while (this.peek()?.t === "op") {
      const op = this.next().v;
      items.push({ k: "text", v: op });
      items.push(this.parseTerm());
    }
    return items.length === 1 ? items[0] : { k: "row", items };
  }

  // term := factor ( ('*' -> concat) | ('/' -> fraction) factor )*
  private parseTerm(): Node {
    let node = this.parseFactor();
    while (true) {
      const t = this.peek();
      if (t?.t === "op" && t.v === "×") {
        this.next();
        node = { k: "row", items: [node, { k: "text", v: "×" }, this.parseFactor()] };
      } else if (t?.t === "op" && t.v === "/") {
        this.next();
        node = { k: "frac", num: node, den: this.parseFactor() };
      } else {
        break;
      }
    }
    return node;
  }

  // factor := base ( ^base | _base )*   (combining into sub/sup/subsup)
  private parseFactor(): Node {
    const base = this.parseBase();
    let sub: Node | null = null;
    let sup: Node | null = null;

    while (this.peek()?.t === "caret" || this.peek()?.t === "underscore") {
      const tok = this.next();
      if (tok.t === "caret") {
        sup = this.parseBase();
      } else {
        sub = this.parseBase();
      }
    }

    if (sub && sup) return { k: "subsup", base, sub, sup };
    if (sup) return { k: "sup", base, sup };
    if (sub) return { k: "sub", base, sub };
    return base;
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
      const lower = t.v.toLowerCase();
      if (lower === "sqrt") {
        return { k: "rad", radicand: this.parseDelimitedGroup() };
      }
      if (GREEK[lower]) {
        return { k: "text", v: GREEK[lower] };
      }
      return { k: "text", v: t.v };
    }

    if (t.t === "lparen") {
      this.next();
      const inner = this.parseExpr();
      this.expect("rparen");
      return { k: "delim", inner };
    }

    if (t.t === "lbrace") {
      this.next();
      const inner = this.parseExpr();
      this.expect("rbrace");
      return inner; // grouping only — no visible braces
    }

    // Unary +/- (e.g. -x): emit the sign then the operand.
    if (t.t === "op" && (t.v === "+" || t.v === "-")) {
      this.next();
      return { k: "row", items: [{ k: "text", v: t.v }, this.parseBase()] };
    }

    throw new Error(`Unexpected token "${t.v}" in math expression.`);
  }

  /** Parses the argument of a function: either (...) or {...} or a single base. */
  private parseDelimitedGroup(): Node {
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

  private expect(type: Token["t"]): void {
    const t = this.next();
    if (!t || t.t !== type) {
      throw new Error(`Expected ${type} in math expression.`);
    }
  }
}

// ----------------------------------------------------------------------------
// OMML emitter
// ----------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function run(text: string): string {
  return `<m:r><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

function emit(node: Node): string {
  switch (node.k) {
    case "text":
      return run(node.v);
    case "row":
      return node.items.map(emit).join("");
    case "frac":
      return `<m:f><m:num>${emit(node.num)}</m:num><m:den>${emit(node.den)}</m:den></m:f>`;
    case "sup":
      return `<m:sSup><m:e>${emit(node.base)}</m:e><m:sup>${emit(node.sup)}</m:sup></m:sSup>`;
    case "sub":
      return `<m:sSub><m:e>${emit(node.base)}</m:e><m:sub>${emit(node.sub)}</m:sub></m:sSub>`;
    case "subsup":
      return (
        `<m:sSubSup><m:e>${emit(node.base)}</m:e>` +
        `<m:sub>${emit(node.sub)}</m:sub><m:sup>${emit(node.sup)}</m:sup></m:sSubSup>`
      );
    case "rad":
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${emit(node.radicand)}</m:e></m:rad>`;
    case "delim":
      return `<m:d><m:e>${emit(node.inner)}</m:e></m:d>`;
  }
}

/** Parses `input` and returns the `<m:oMath>…</m:oMath>` body. Throws on parse errors. */
export function mathToOmml(input: string): string {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Empty math expression.");
  const ast = new Parser(tokens).parse();
  return `<m:oMath>${emit(ast)}</m:oMath>`;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const PKG_NS = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/**
 * Wraps an `<m:oMath>` body in a minimal flat-OPC package that
 * Word.Range.insertOoxml() accepts. The equation is placed inline in a single
 * paragraph.
 */
export function buildMathOoxml(ommlBody: string): string {
  const documentXml =
    `<w:document xmlns:w="${W_NS}" xmlns:m="${M_NS}">` +
    `<w:body><w:p>${ommlBody}</w:p></w:body></w:document>`;

  const relsXml =
    `<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/>` +
    `</Relationships>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<?mso-application progid="Word.Document"?>` +
    `<pkg:package xmlns:pkg="${PKG_NS}">` +
    `<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">` +
    `<pkg:xmlData>${relsXml}</pkg:xmlData></pkg:part>` +
    `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
    `<pkg:xmlData>${documentXml}</pkg:xmlData></pkg:part>` +
    `</pkg:package>`
  );
}

/** Convenience: parse linear math and return the full insertable OOXML package. */
export function mathToOoxml(input: string): string {
  return buildMathOoxml(mathToOmml(input));
}
