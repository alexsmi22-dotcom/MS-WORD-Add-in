// LaTeX import/export for the math pipeline. Rather than a second renderer, this
// translates LaTeX into the project's existing math DSL (see mathParse.ts), so an
// imported equation flows through the same AST → OMML (Word) and AST → HTML
// (preview) path as everything else. `astToLatex` does the reverse for a
// "copy as LaTeX" export.
//
// Pure string logic — no Office.js — fully unit-testable. The translation covers
// the common constructs (fractions, scripts, roots, Greek, big operators with
// limits, matrices, cases, common symbols); anything unrecognized degrades
// gracefully (the math pipeline falls back to plain formatting on a parse error).

import { Node as MathNode, KNOWN_FUNCS, isEmptyNode } from "./mathParse";

// LaTeX command → glyph/word emitted into the DSL. Greek is emitted as the literal
// glyph (the DSL tokenizer treats Greek letters as atoms); symbols are emitted as
// their Unicode glyph (the DSL parses these as operators/atoms).
const GREEK_CMDS: Record<string, string> = {
  // Greek (lower)
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "π", rho: "ρ", varrho: "ρ",
  sigma: "σ", varsigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ",
  psi: "ψ", omega: "ω",
  // Greek (upper)
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // Letter-like symbols that behave as letters in an argument (\sin\ell, \ln\hbar)
  ell: "ℓ", hbar: "ℏ",
};

const SIMPLE: Record<string, string> = {
  ...GREEK_CMDS,
  // Relations / operators
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡",
  cong: "≅", sim: "∼", simeq: "≃", propto: "∝", ll: "≪", gg: "≫", parallel: "∥", perp: "⊥",
  lt: "<", gt: ">",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦",
  Rightarrow: "⇒", implies: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⇔",
  // Set theory / logic
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", setminus: "∖",
  forall: "∀", exists: "∃", nexists: "∄", neg: "¬", lnot: "¬",
  land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  // Calculus / misc
  partial: "∂", nabla: "∇", infty: "∞", prime: "′", circ: "∘", bullet: "•",
  ldots: "…", cdots: "⋯", dots: "…", vdots: "⋮", ddots: "⋱", angle: "∠", Re: "ℜ", Im: "ℑ", dagger: "†",
  // Delimiters used bare (not inside \left…\right) — otherwise the fallback
  // would emit the literal command letters ("langle", "rfloor", …).
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  vert: "|", lvert: "|", rvert: "|", Vert: "‖", lVert: "‖", rVert: "‖", "|": "‖", backslash: "\\",
  // \mid (set-builder, conditional probability) is the divides-sign glyph, an operator: a bare "|" would open |…|.
  mid: "∣",
  // Modular arithmetic: a \bmod n is the upright word.
  bmod: "mod", mod: "mod",
  // Spacing → dropped
  quad: "", qquad: "", ",": "", ";": "", ":": "", "!": "", " ": "", ">": "",
  // Sizing and style switches carry no content: \Bigl( is "(", \displaystyle\frac is \frac.
  big: "", Big: "", bigg: "", Bigg: "", bigl: "", bigr: "", Bigl: "", Bigr: "", biggl: "", biggr: "", Biggl: "",
  Biggr: "", bigm: "", Bigm: "", displaystyle: "", textstyle: "", scriptstyle: "", scriptscriptstyle: "",
  limits: "", nolimits: "", nonumber: "", notag: "", middle: "",
  // Escaped literals
  "%": "%", "&": "&", "$": "$", "#": "#",
};

/** Operator names the DSL would otherwise misread (\inf as ∞, \sup as the letters s·u·p): set upright by opname(…). */
const UPRIGHT_OPS = new Set(["inf", "sup", "liminf", "limsup", "max", "min", "arg", "ker", "Pr", "det", "dim", "gcd", "hom", "lg", "coth"]);

const NARY: Record<string, string> = { sum: "sum", prod: "prod", int: "int", oint: "oint", iint: "iint", iiint: "iiint" };

/** \sin-family commands: the following token run is their ARGUMENT, not a factor. */
const FUNC_CMDS = new Set([
  "sin", "cos", "tan", "csc", "sec", "cot",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "ln", "log", "exp", "deg",
]);
const MATRIX_ENV: Record<string, string> = {
  matrix: "matrix", pmatrix: "pmatrix", bmatrix: "bmatrix", Bmatrix: "bmatrix", vmatrix: "vmatrix", array: "matrix",
};
// \left / \right delimiters. \left\{ … \right\} keeps visible braces: the DSL's braces(…) (a bare { } in the DSL is an
// invisible group). Angle, floor, ceiling and norm delimiters are emitted as their glyphs, which the DSL reads as
// expectation values, bras, kets, inner products, floors, ceilings and norms.
const DELIM_CMD: Record<string, string> = {
  "{": "braces(", "}": ")", lbrace: "braces(", rbrace: ")", "|": "‖", Vert: "‖", lVert: "‖", rVert: "‖", vert: "|",
  lvert: "|", rvert: "|", ".": "", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
};
/** Relations and signs that end a big operator's body at the top level (\sum_i a_i + b is (Σ a_i) + b). */
const BODY_END_CHARS = new Set(["=", "<", ">", "+", "-", ",", ";"]);
const BODY_END_CMDS = new Set([
  "le", "leq", "ge", "geq", "ne", "neq", "approx", "equiv", "cong", "sim", "simeq", "propto", "ll", "gg", "lt", "gt",
  "pm", "mp", "quad", "qquad",
]);
/** \text-like commands whose braced content is prose, kept verbatim (spaces included). */
const TEXT_CMDS = new Set(["text", "textrm", "textit", "textbf", "textnormal", "mbox", "textup"]);
/** Upright-name commands whose braced content is one word: \mathrm{d}, \operatorname{erf}. */
const NAME_CMDS = new Set(["mathrm", "operatorname", "mathup"]);
/** Typeface commands that keep their content as is (Word math has no bold/sans run in this DSL). */
const FACE_CMDS = new Set(["mathbf", "mathit", "boldsymbol", "bm", "mathsf", "mathtt", "mathnormal"]);

/** Deepest LaTeX group nesting read (a deterministic cap, never a stack overflow). */
const MAX_LATEX_DEPTH = 150;

// Double-struck and script capitals: the Letterlike Symbols block holds some, the rest are in the Mathematical
// Alphanumeric Symbols block (astral), which the DSL tokenizer reads by code point.
const DOUBLE_STRUCK_LETTERLIKE: Record<string, string> = { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" };
const SCRIPT_LETTERLIKE: Record<string, string> = { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" };

function styledLetters(style: "mathbb" | "mathcal", inner: string): string {
  let out = "";
  for (const c of inner) {
    const upper = c >= "A" && c <= "Z";
    const lower = c >= "a" && c <= "z";
    if (style === "mathbb") {
      if (DOUBLE_STRUCK_LETTERLIKE[c]) out += DOUBLE_STRUCK_LETTERLIKE[c];
      else if (upper) out += String.fromCodePoint(0x1d538 + c.charCodeAt(0) - 65);
      else if (lower) out += String.fromCodePoint(0x1d552 + c.charCodeAt(0) - 97);
      else if (c >= "0" && c <= "9") out += String.fromCodePoint(0x1d7d8 + c.charCodeAt(0) - 48);
      else out += c;
    } else {
      if (SCRIPT_LETTERLIKE[c]) out += SCRIPT_LETTERLIKE[c];
      else if (upper) out += String.fromCodePoint(0x1d49c + c.charCodeAt(0) - 65);
      else if (lower) out += String.fromCodePoint(0x1d4b6 + c.charCodeAt(0) - 97);
      else out += c;
    }
  }
  return out;
}

interface LTok {
  t: "cmd" | "sup" | "sub" | "lbrace" | "rbrace" | "amp" | "rows" | "char" | "raw";
  v: string;
  /** For a "raw" token: the braced content, verbatim. */
  raw?: string;
}

/** The braced group starting at src[i] === "{", verbatim, if it is flat (no nested braces); null otherwise. */
function flatBraced(src: string, i: number): { inner: string; end: number } | null {
  if (src[i] !== "{") return null;
  const close = src.indexOf("}", i + 1);
  if (close < 0) return null;
  const inner = src.slice(i + 1, close);
  if (inner.includes("{")) return null;
  return { inner, end: close + 1 };
}

function lexLatex(src: string): LTok[] {
  const toks: LTok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      if (src[i + 1] === "\\") {
        toks.push({ t: "rows", v: "\\\\" });
        i += 2;
        continue;
      }
      if (/[A-Za-z]/.test(src[i + 1] || "")) {
        let name = "";
        i++;
        while (i < src.length && /[A-Za-z]/.test(src[i])) name += src[i++];
        // \mathbb{R} etc. fold into a single key so SIMPLE can map them.
        if ((name === "mathbb" || name === "mathcal") && src[i] === "{") {
          let j = i + 1;
          let inner = "";
          while (j < src.length && src[j] !== "}") inner += src[j++];
          if (src[j] === "}" && inner.length) {
            toks.push({ t: "cmd", v: name + inner.trim() });
            i = j + 1;
            continue;
          }
        }
        // \text{if } keeps its words and spaces; \mathrm{d} and \operatorname{erf} keep a one-word name intact.
        const braced = flatBraced(src, i);
        if (braced && ((TEXT_CMDS.has(name) && !/[\\$]/.test(braced.inner)) || (NAME_CMDS.has(name) && /^\s*[A-Za-z]+\s*$/.test(braced.inner)))) {
          toks.push({ t: "raw", v: name, raw: braced.inner });
          i = braced.end;
          continue;
        }
        toks.push({ t: "cmd", v: name });
        continue;
      }
      // \, \; \{ \| \  etc. — command named by the single following char.
      toks.push({ t: "cmd", v: src[i + 1] ?? "" });
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "{") toks.push({ t: "lbrace", v: ch });
    else if (ch === "}") toks.push({ t: "rbrace", v: ch });
    else if (ch === "^") toks.push({ t: "sup", v: ch });
    else if (ch === "_") toks.push({ t: "sub", v: ch });
    else if (ch === "&") toks.push({ t: "amp", v: ch });
    else toks.push({ t: "char", v: ch });
    i++;
  }
  return toks;
}

/**
 * Joins translated pieces. LaTeX math ignores whitespace, so pieces join tight — keeping "100" and "3.14" one number —
 * EXCEPT between two letters from separate atoms or commands: in LaTeX `mc` is the product m·c and `\sigma\sqrt{2\pi}`
 * is σ·√(2π); a tight join would invent the identifier "mc" or "σsqrt" (which the Solve grammar then solves for, or
 * the DSL reads as one name). Letters include Greek and the letter-like glyphs (Unicode letters). And "!" before "="
 * gets a space, so n! = … never forms the operator != (≠).
 */
function joinPieces(parts: string[]): string {
  let out = "";
  for (const p of parts) {
    if (p === "") continue;
    if (out && ((/[\p{L}}]$/u.test(out) && /^\p{L}/u.test(p)) || (/!$/.test(out) && /^=/.test(p)))) out += " ";
    out += p;
  }
  return out;
}

interface SeqOpts {
  /** A big operator's body: ends at a top-level relation, sign, comma, closing bracket or \right. */
  body?: boolean;
  /** Ends at the ")" that closes the bracket just opened (the caller eats it). */
  closeParen?: boolean;
}

/** Translates a LaTeX math string into the project math DSL. Throws (a named Error) only on pathological nesting. */
export function latexToDsl(src: string): string {
  // Strip surrounding math delimiters: $…$, $$…$$, \(…\), \[…\].
  let s = src.trim();
  s = s.replace(/^\$\$?|\$\$?$/g, "").trim();
  s = s.replace(/^\\\(|\\\)$/g, "").replace(/^\\\[|\\\]$/g, "").trim();

  const toks = lexLatex(s);
  let pos = 0;
  let depth = 0;
  const peek = (): LTok | undefined => toks[pos];
  const eat = (): LTok | undefined => toks[pos++];
  const isChar = (t: LTok | undefined, v: string): boolean => !!t && t.t === "char" && t.v === v;
  const isCmd = (t: LTok | undefined, v: string): boolean => !!t && t.t === "cmd" && t.v === v;
  /** What each open \left emitted, so its \right can close it. */
  const leftStack: string[] = [];
  /** The \right matching the \left whose delimiter ends just before index `from` names "." (a one-sided delimiter). */
  const rightIsDot = (from: number): boolean => {
    let d = 1;
    for (let j = from; j < toks.length; j++) {
      const t = toks[j];
      if (t.t !== "cmd") continue;
      if (t.v === "left") d++;
      else if (t.v === "right" && --d === 0) return toks[j + 1]?.t === "char" && toks[j + 1].v === ".";
    }
    return false;
  };

  function enter(): void {
    if (++depth > MAX_LATEX_DEPTH) {
      throw new Error(`This LaTeX is nested more than ${MAX_LATEX_DEPTH} levels deep, so it was not converted; split it into smaller equations.`);
    }
  }

  function group(): string {
    const t = peek();
    if (t && t.t === "lbrace") {
      eat();
      const inner = seq();
      if (peek()?.t === "rbrace") eat();
      return inner;
    }
    return atom();
  }

  /** Reads ^ and _ scripts after a piece, attaching them to it. */
  function scripts(base: string): string {
    let out = base;
    while (peek()?.t === "sup" || peek()?.t === "sub") {
      const op = eat()!.t;
      out += (op === "sup" ? "^" : "_") + "{" + group() + "}";
    }
    return out;
  }

  function atBodyEnd(t: LTok, parts: string[]): boolean {
    if (t.t === "char") {
      if (t.v === ")" || t.v === "]") return true;
      // A leading sign is the body's own (\sum_i -a_i); after something, a sign or relation ends the body.
      return BODY_END_CHARS.has(t.v) && (parts.some((p) => p !== "") || !(t.v === "+" || t.v === "-"));
    }
    if (t.t === "cmd") return BODY_END_CMDS.has(t.v) || t.v === "right";
    return false;
  }

  function seq(opts: SeqOpts = {}): string {
    enter();
    try {
      const parts: string[] = [];
      /** ( [ and \left nesting opened inside this sequence: a body only ends at its own top level. */
      let open = 0;
      for (;;) {
        const t = peek();
        if (!t || t.t === "rbrace" || t.t === "amp" || t.t === "rows") break;
        if (t.t === "cmd" && t.v === "end") break;
        if (open === 0 && opts.closeParen && isChar(t, ")")) break;
        if (open === 0 && opts.body && atBodyEnd(t, parts)) break;
        // {a \over b} is the fraction a/b: everything before \over over everything after it.
        if (t.t === "cmd" && (t.v === "over" || t.v === "choose")) {
          eat();
          const num = joinPieces(parts);
          const den = seq();
          return t.v === "over" ? `{{${num}}/{${den}}}` : `binom(${num}, ${den})`;
        }
        if (t.t === "sup" || t.t === "sub") {
          const prev = parts.pop() ?? "";
          parts.push(scripts(prev));
          continue;
        }
        if (t.t === "char" && (t.v === "(" || t.v === "[")) open++;
        else if (t.t === "char" && (t.v === ")" || t.v === "]")) open--;
        else if (isCmd(t, "left")) open++;
        else if (isCmd(t, "right")) open--;
        parts.push(atom());
      }
      return joinPieces(parts);
    } finally {
      depth--;
    }
  }

  function atom(): string {
    const t = eat();
    if (!t) return "";
    if (t.t === "lbrace") {
      const inner = seq();
      if (peek()?.t === "rbrace") eat();
      return "{" + inner + "}";
    }
    if (t.t === "char") return t.v;
    if (t.t === "raw") return rawCommand(t.v, t.raw ?? "");
    if (t.t === "cmd") return command(t.v);
    return "";
  }

  /** \text{…} is upright prose (a quoted DSL string); \mathrm{d} and \operatorname{foo} are upright names. */
  function rawCommand(name: string, raw: string): string {
    if (TEXT_CMDS.has(name)) {
      const words = raw.replace(/"/g, "");
      return words.trim() ? `"${words}"` : "";
    }
    const word = raw.trim();
    // \operatorname{erf} is ONE name, and a known function keeps its function reading: erf(x).
    if (name === "operatorname" && KNOWN_FUNCS.has(word.toLowerCase())) return word;
    return `opname(${word})`;
  }

  /** A function command's argument run: digits, letters and Greek, with their scripts (\sin 2\theta, \log 10x). */
  function funcArgument(): string | null {
    const parts: string[] = [];
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === "char" && /^[A-Za-z0-9]$/.test(t.v)) {
        eat();
        // A number keeps its decimal point (\log 10.5x): "." only between digits.
        let piece = t.v;
        if (/[0-9]/.test(t.v)) {
          while (peek()?.t === "char" && /^[0-9]$/.test(peek()!.v)) piece += eat()!.v;
          if (isChar(peek(), ".") && toks[pos + 1]?.t === "char" && /^[0-9]$/.test(toks[pos + 1].v)) {
            piece += eat()!.v;
            while (peek()?.t === "char" && /^[0-9]$/.test(peek()!.v)) piece += eat()!.v;
          }
        }
        parts.push(scripts(piece));
        continue;
      }
      if (t.t === "cmd" && GREEK_CMDS[t.v]) {
        eat();
        parts.push(scripts(GREEK_CMDS[t.v]));
        continue;
      }
      break;
    }
    if (!parts.length) return null;
    // One letter followed by its own bracket is a function call inside the argument: \ln\Gamma(x) is ln(Γ(x)).
    if (parts.length === 1 && /^\p{L}/u.test(parts[0]) && isChar(peek(), "(")) {
      eat();
      const inner = seq({ closeParen: true });
      if (isChar(peek(), ")")) eat();
      parts[0] += `(${inner})`;
    }
    return joinPieces(parts);
  }

  /** The limits of a big operator or \lim: its ^ and _ scripts, skipping \limits / \nolimits. */
  function limits(): { lo: string; hi: string } {
    let lo = "";
    let hi = "";
    for (;;) {
      const t = peek();
      if (isCmd(t, "limits") || isCmd(t, "nolimits")) {
        eat();
        continue;
      }
      if (t?.t !== "sup" && t?.t !== "sub") break;
      eat();
      const g = group();
      if (t.t === "sub") lo = g;
      else hi = g;
    }
    return { lo, hi };
  }

  function command(name: string): string {
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
      // Braces group invisibly in the DSL (parens would render visible parens).
      const a = group();
      const b = group();
      // Degrade gracefully if an argument is missing (don't emit an empty group,
      // which the DSL can't parse).
      if (!a && !b) return "";
      if (!b) return a;
      if (!a) return b;
      // Wrap the whole fraction in an (invisible) group so a following script
      // binds to it: "\frac{a}{b}^2" → (a/b)², not a/(b²).
      return "{{" + a + "}/{" + b + "}}";
    }
    if (name === "binom" || name === "dbinom" || name === "tbinom") return "binom(" + group() + ", " + group() + ")";
    if (name === "sqrt") {
      if (peek()?.t === "char" && peek()?.v === "[") {
        eat();
        let deg = "";
        while (peek() && !(peek()!.t === "char" && peek()!.v === "]")) deg += atom();
        if (peek()) eat();
        return "root(" + deg + ", " + group() + ")";
      }
      return "sqrt(" + group() + ")";
    }
    if (NARY[name]) {
      // The body ends at a top-level relation or sign (LaTeX's convention: \sum_i a_i + b is (Σ a_i) + b). A missing
      // limit stays empty (∫ f dx, ∮_C), which the DSL draws with no limit there.
      const { lo, hi } = limits();
      const body = seq({ body: true });
      return `${NARY[name]}(${lo}, ${hi}, ${body})`;
    }
    if (name === "lim") {
      const { lo } = limits();
      const body = seq({ body: true });
      return `lim(${lo}, ${body})`;
    }
    if (name === "hat" || name === "bar" || name === "vec" || name === "overline" || name === "overrightarrow") {
      return `${name === "overline" ? "bar" : name === "overrightarrow" ? "vec" : name}(${group()})`;
    }
    if (name === "tilde" || name === "widetilde" || name === "dot" || name === "ddot" || name === "widehat") {
      return `${name === "widetilde" ? "tilde" : name === "widehat" ? "hat" : name}(${group()})`;
    }
    // Dirac notation (physics / braket packages): \ket{ψ}, \bra{ψ}, \braket{φ}{ψ} or \braket{φ|ψ}.
    if (name === "ket" || name === "bra") return `${name}(${group()})`;
    if (name === "braket") {
      const a = group();
      if (peek()?.t === "lbrace") return `braket(${a}, ${group()})`;
      return a.includes("|") ? `⟨${a}⟩` : `expval(${a})`;
    }
    if (name === "pmod") return `(mod ${group()})`;
    // \operatorname{…} with something other than one word: its translated content, as one name.
    if (name === "operatorname" || name === "mathrm" || name === "mathup") return group().replace(/\s+/g, "");
    if (TEXT_CMDS.has(name) || FACE_CMDS.has(name)) return group();
    if (name === "{") return "braces(";
    if (name === "}") return ")";
    if (name === "left" || name === "right") {
      const d = peek();
      if (!d) return "";
      // The \right that closes a \left\{ closes the braces(…) it opened, whatever delimiter it names.
      if (name === "right" && leftStack.length) {
        const opened = leftStack.pop();
        if (opened === "braces(") {
          eat();
          return ")";
        }
      }
      // A one-sided brace, \left\{ \begin{array}…\end{array} \right., is a piecewise definition: cases(…). Any
      // other content under a one-sided brace is left unbalanced (the parse fails and falls back), never closed with a
      // brace it does not have.
      if (name === "left" && d.t === "cmd" && (d.v === "{" || d.v === "lbrace") && rightIsDot(pos + 1)) {
        eat();
        if (peek()?.t === "cmd" && peek()!.v === "begin") {
          eat();
          // env name: array / matrix / aligned — the rows are what matter; array's column spec {ll} is not content
          if (group().replace(/\s+/g, "") === "array" && peek()?.t === "lbrace") group();
          const rows = readRows();
          if (peek()?.t === "cmd" && peek()!.v === "right") {
            eat();
            if (peek()?.t === "char" && peek()!.v === ".") eat();
          }
          return rows.length ? `cases(${rows.map((r) => r.join(", ")).join("; ")})` : "";
        }
        leftStack.push("(");
        return "(";
      }
      let out = "";
      if (d.t === "char") {
        eat();
        out = d.v === "." ? "" : d.v;
      } else if (d.t === "cmd") {
        eat();
        out = DELIM_CMD[d.v] ?? SIMPLE[d.v] ?? "";
      }
      if (name === "left") leftStack.push(out);
      return out;
    }
    // The env name is lexed as individual chars; collapse the spaces seq() adds.
    if (name === "begin") return environment(group().replace(/\s+/g, ""));
    if (name === "end") {
      group();
      return "";
    }
    if (name.startsWith("mathbb") && name.length > 6) return styledLetters("mathbb", name.slice(6));
    if (name.startsWith("mathcal") && name.length > 7) return styledLetters("mathcal", name.slice(7));
    if (SIMPLE[name] !== undefined) return SIMPLE[name];
    // \inf is the infimum, not the DSL's word for ∞; \sup, \liminf, \limsup are upright operator names.
    if (UPRIGHT_OPS.has(name)) return KNOWN_FUNCS.has(name.toLowerCase()) || name === "Pr" ? name : `opname(${name})`;
    // Function commands take their argument run: \sin x → sin(x), \sin 2x → sin(2x), \cos 2\theta → cos(2θ) (LaTeX's
    // own convention) — bare "sin x" would read as the product sin·x downstream. A braced or parenthesised argument
    // already carries its own brackets and needs no wrapping.
    if (FUNC_CMDS.has(name)) {
      if (peek()?.t === "lbrace") return `${name}(${group()})`;
      const arg = funcArgument();
      if (arg !== null) return `${name}(${arg})`;
      // \sin(x+1): the "(" atom follows and joins tight. A bare \deg is braced so the DSL never reads it as the degree
      // sign after a number ("2\deg" → 2{deg}, not 2°): LaTeX's \deg is always the function.
      return name === "deg" ? "{deg}" : name;
    }
    // Unknown command: strip the backslash.
    return name;
  }

  function environment(env: string): string {
    const e = env.replace(/\*$/, ""); // align* / gather* → align / gather
    const rows = readRows();
    if (!rows.length) return ""; // empty environment → degrade to nothing, not "align()"
    if (MATRIX_ENV[e]) return `${MATRIX_ENV[e]}(${rows.map((r) => r.join(", ")).join("; ")})`;
    if (e === "cases") return `cases(${rows.map((r) => r.join(", ")).join("; ")})`;
    // Aligned multi-line equations → stacked equations (& alignment marks dropped).
    if (e === "align" || e === "aligned" || e === "gather" || e === "split" || e === "alignat") {
      return `align(${rows.map((r) => r.join(" ")).join("; ")})`;
    }
    return rows.map((r) => r.join(" ")).join(" "); // unknown env: inline its content
  }

  function readRows(): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    for (;;) {
      row.push(seq());
      const t = peek();
      if (t?.t === "amp") {
        eat();
        continue;
      }
      if (t?.t === "rows") {
        eat();
        rows.push(row);
        row = [];
        continue;
      }
      if (t?.t === "cmd" && t.v === "end") {
        eat();
        group(); // env name
        rows.push(row);
        break;
      }
      rows.push(row);
      break;
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  return seq().trim();
}

// --- Export: AST → LaTeX -----------------------------------------------------

const GLYPH_TO_LATEX: Record<string, string> = {
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\epsilon", "ζ": "\\zeta",
  "η": "\\eta", "θ": "\\theta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu",
  "ν": "\\nu", "ξ": "\\xi", "π": "\\pi", "ρ": "\\rho", "σ": "\\sigma", "τ": "\\tau",
  "φ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega", "υ": "\\upsilon", "ο": "o",
  "ϕ": "\\phi", "ϑ": "\\vartheta", "ϵ": "\\epsilon", "ς": "\\varsigma",
  "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi",
  "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega", "Υ": "\\Upsilon",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P",
  "Τ": "T", "Χ": "X",
  "·": "\\cdot", "⋅": "\\cdot", "×": "\\times", "÷": "\\div", "±": "\\pm", "∓": "\\mp", "∗": "\\ast", "⋆": "\\star",
  "•": "\\bullet",
  "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv", "≅": "\\cong", "∝": "\\propto",
  "∼": "\\sim", "≃": "\\simeq", "≪": "\\ll", "≫": "\\gg", "≲": "\\lesssim", "≳": "\\gtrsim", "∥": "\\parallel",
  "⊥": "\\perp", "∤": "\\nmid",
  "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow",
  "⇐": "\\Leftarrow", "↦": "\\mapsto",
  "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq", "⊃": "\\supset", "⊇": "\\supseteq",
  "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "∄": "\\nexists",
  "∖": "\\setminus",
  "¬": "\\neg", "∧": "\\wedge", "∨": "\\vee", "⊕": "\\oplus", "⊗": "\\otimes",
  "∂": "\\partial", "∇": "\\nabla", "∞": "\\infty", "∘": "\\circ", "…": "\\ldots", "⋯": "\\cdots",
  "⋮": "\\vdots", "⋱": "\\ddots",
  "ℝ": "\\mathbb{R}", "ℤ": "\\mathbb{Z}", "ℕ": "\\mathbb{N}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}",
  "ℙ": "\\mathbb{P}", "ℍ": "\\mathbb{H}",
  "ℒ": "\\mathcal{L}", "ℱ": "\\mathcal{F}", "ℬ": "\\mathcal{B}", "ℰ": "\\mathcal{E}", "ℋ": "\\mathcal{H}",
  "ℐ": "\\mathcal{I}", "ℳ": "\\mathcal{M}", "ℛ": "\\mathcal{R}",
  "ℜ": "\\Re", "ℑ": "\\Im",
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint", "∬": "\\iint", "∭": "\\iiint",
  "∠": "\\angle", "ℏ": "\\hbar", "ℓ": "\\ell",
  "⟨": "\\langle", "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "‖": "\\|",
  // Degrees, primes and the micro sign as LaTeX writes them.
  "°": "^{\\circ}", "′": "'", "″": "''", "‴": "'''", "µ": "\\mu", "Å": "\\text{\\AA}",
  // The true minus the parser prints inside kets (|−1⟩) and the adjoint dagger (A†): LaTeX writes them - and \dagger.
  "−": "-", "†": "\\dagger", "∣": "\\mid",
  // Characters LaTeX reads as syntax: % would comment out the rest of the line.
  "%": "\\%", "&": "\\&", "#": "\\#", "$": "\\$",
};

const DELIM_TO_LATEX: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "‖": "\\|", "{": "\\{", "}": "\\}",
  "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "⟨": "\\langle", "⟩": "\\rangle",
};

const ACC_TO_LATEX: Record<string, string> = {
  "̄": "\\bar", "̂": "\\hat", "⃗": "\\vec", "̃": "\\tilde", "̈": "\\ddot", "̅": "\\overline", "̇": "\\dot",
};

/** Function names LaTeX has a command for (\sin, \log, …). Any other function name exports as \operatorname{…}. */
const LATEX_FUNCS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "coth",
  "arcsin", "arccos", "arctan", "log", "ln", "lg", "exp", "det", "dim", "max", "min", "gcd",
  "ker", "deg", "arg", "Pr", "sup", "inf", "hom", "liminf", "limsup", "lim",
]);

/** An upright function name or word as LaTeX: \sin, \operatorname{erf}, or \mathrm{…} for an upright non-function word. */
function uprightName(name: string): string {
  if (LATEX_FUNCS.has(name)) return "\\" + name;
  return KNOWN_FUNCS.has(name.toLowerCase()) ? `\\operatorname{${name}}` : `\\mathrm{${name}}`;
}

const SUPERSCRIPT_TO_ASCII: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
};
const SUBSCRIPT_TO_ASCII: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
};

/** A Mathematical Alphanumeric Symbol (𝔽, 𝒜, 𝐱 …) as LaTeX, or null outside the ranges handled. */
function mathAlnumToLatex(cp: number): string | null {
  const span = (start: number, cmd: string): string | null => {
    if (cp >= start && cp < start + 26) return `${cmd}{${String.fromCharCode(65 + cp - start)}}`;
    if (cp >= start + 26 && cp < start + 52) return `${cmd}{${String.fromCharCode(97 + cp - start - 26)}}`;
    return null;
  };
  return (
    span(0x1d538, "\\mathbb") ?? span(0x1d49c, "\\mathcal") ?? span(0x1d400, "\\mathbf") ?? span(0x1d504, "\\mathfrak") ??
    // Mathematical italic letters are plain LaTeX letters (math is italic already).
    (cp >= 0x1d434 && cp < 0x1d434 + 52 ? String.fromCharCode(cp - 0x1d434 < 26 ? 65 + cp - 0x1d434 : 97 + cp - 0x1d434 - 26) : null) ??
    (cp >= 0x1d7d8 && cp <= 0x1d7e1 ? `\\mathbb{${cp - 0x1d7d8}}` : null)
  );
}

/**
 * Glyphs as LaTeX that pdflatex compiles: every character comes out ASCII. A control word needs a space after it
 * (\alpha x); a plain character ("-" for −) does not. Superscript and subscript digit runs (m/s², x₁) become ^{…} and
 * _{…}; a thin space is \, ; anything else outside ASCII is wrapped in \text{…}.
 */
function glyphsToLatex(s: string): string {
  let out = "";
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (SUPERSCRIPT_TO_ASCII[ch] || SUBSCRIPT_TO_ASCII[ch]) {
      const table = SUPERSCRIPT_TO_ASCII[ch] ? SUPERSCRIPT_TO_ASCII : SUBSCRIPT_TO_ASCII;
      let run = "";
      while (i < chars.length && table[chars[i]]) run += table[chars[i++]];
      i--;
      out += (table === SUPERSCRIPT_TO_ASCII ? "^" : "_") + `{${run}}`;
      continue;
    }
    const g = GLYPH_TO_LATEX[ch];
    if (g) {
      out += /^\\[A-Za-z]+$/.test(g) ? g + " " : g;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out += ch;
      continue;
    }
    if (cp === 0x2009 || cp === 0x2006 || cp === 0x202f) {
      out += "\\,";
      continue;
    }
    if (cp === 0x00a0) {
      out += "~";
      continue;
    }
    if (cp === 0x2126) {
      out += "\\Omega ";
      continue;
    }
    const alnum = mathAlnumToLatex(cp);
    out += alnum ?? `\\text{${ch}}`;
  }
  return out.trim();
}

/** Renders the shared math AST back to a LaTeX string (for copy-as-LaTeX). */
export function astToLatex(node: MathNode): string {
  switch (node.k) {
    case "text":
      // A unit after a number: a thin space, then the unit upright (25\,^{\circ}C → \,\mathrm{…}).
      if (node.unit) return `\\,\\mathrm{${glyphsToLatex(node.v)}}`;
      // Prose in a cases condition ("if ", "otherwise") is text, spaces kept.
      if (node.word) {
        const TEXT_ESC: Record<string, string> = { "_": "\\_", "^": "\\^{}", "~": "\\~{}", "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}" };
        return `\\text{${[...node.v].map((c) => (c === " " ? " " : TEXT_ESC[c] ?? glyphsToLatex(c))).join("")}}`;
      }
      // An upright word (sin in sin^2 x, log in log_2 x, mod) exports upright, never as the italic letters s i n.
      if (node.plain && /^[A-Za-z]{2,}$/.test(node.v)) return uprightName(node.v);
      // An operator name with the thin space opname() gives it before an operand (inf S): \inf already spaces itself.
      if (node.plain && new RegExp(`^[A-Za-z]{2,}${String.fromCharCode(0x2009)}$`).test(node.v)) return uprightName(node.v.slice(0, -1));
      return glyphsToLatex(node.v);
    case "row":
      return node.items.map(astToLatex).join(" ");
    case "frac":
      return `\\frac{${astToLatex(node.num)}}{${astToLatex(node.den)}}`;
    case "binom":
      return `\\binom{${astToLatex(node.top)}}{${astToLatex(node.bottom)}}`;
    case "sup":
      // Primes are written as LaTeX writes them, f'' — never f^{''} (a prime is already a superscript).
      if (node.sup.k === "text" && /^[′″‴]+$/.test(node.sup.v)) return `${astToLatex(node.base)}${glyphsToLatex(node.sup.v)}`;
      return `${astToLatex(node.base)}^{${astToLatex(node.sup)}}`;
    case "sub":
      return `${astToLatex(node.base)}_{${astToLatex(node.sub)}}`;
    case "subsup":
      return `${astToLatex(node.base)}_{${astToLatex(node.sub)}}^{${astToLatex(node.sup)}}`;
    case "rad":
      return node.degree
        ? `\\sqrt[${astToLatex(node.degree)}]{${astToLatex(node.radicand)}}`
        : `\\sqrt{${astToLatex(node.radicand)}}`;
    case "delim":
      return `\\left${DELIM_TO_LATEX[node.open] ?? "."} ${astToLatex(node.inner)} \\right${DELIM_TO_LATEX[node.close] ?? "."}`;
    case "nary": {
      const op = GLYPH_TO_LATEX[node.chr] ?? "\\sum";
      const sub = astToLatex(node.sub);
      const sup = astToLatex(node.sup);
      const limits = (sub ? `_{${sub}}` : "") + (sup ? `^{${sup}}` : "");
      return `${op}${limits} ${astToLatex(node.body)}`;
    }
    case "func":
      return `${node.known ? uprightName(node.name) : glyphsToLatex(node.name)}${astToLatex(node.arg)}`;
    case "lim":
      return isEmptyNode(node.sub) ? `\\lim ${astToLatex(node.body)}` : `\\lim_{${astToLatex(node.sub)}} ${astToLatex(node.body)}`;
    case "acc":
      return `${ACC_TO_LATEX[node.chr] ?? "\\hat"}{${astToLatex(node.base)}}`;
    case "matrix": {
      const env = node.open === "(" ? "pmatrix" : node.open === "|" ? "vmatrix" : "bmatrix";
      const body = node.rows.map((r) => r.map(astToLatex).join(" & ")).join(" \\\\ ");
      return `\\begin{${env}} ${body} \\end{${env}}`;
    }
    case "cases": {
      const body = node.rows.map((r) => r.map(astToLatex).join(" & ")).join(" \\\\ ");
      return `\\begin{cases} ${body} \\end{cases}`;
    }
    case "stack":
      return `\\begin{aligned} ${node.rows.map(astToLatex).join(" \\\\ ")} \\end{aligned}`;
  }
}
