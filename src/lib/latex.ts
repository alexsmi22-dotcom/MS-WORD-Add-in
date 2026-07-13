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

import { Node as MathNode } from "./mathParse";

// LaTeX command → glyph/word emitted into the DSL. Greek is emitted as the literal
// glyph (the DSL tokenizer treats Greek letters as atoms); symbols are emitted as
// their Unicode glyph (the DSL parses these as operators/atoms).
const SIMPLE: Record<string, string> = {
  // Greek (lower)
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "π", rho: "ρ", varrho: "ρ",
  sigma: "σ", varsigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ",
  psi: "ψ", omega: "ω",
  // Greek (upper)
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // Relations / operators
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡",
  cong: "≅", sim: "∼", simeq: "≃", propto: "∝", ll: "≪", gg: "≫",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦",
  Rightarrow: "⇒", implies: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⇔",
  // Set theory / logic
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", setminus: "∖",
  forall: "∀", exists: "∃", nexists: "∄", neg: "¬", lnot: "¬",
  land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  // Calculus / misc
  partial: "∂", nabla: "∇", infty: "∞", prime: "′", circ: "∘", bullet: "•",
  ldots: "…", cdots: "⋯", dots: "…", angle: "∠", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ",
  // Delimiters used bare (not inside \left…\right) — otherwise the fallback
  // would emit the literal command letters ("langle", "rfloor", …).
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  vert: "|", Vert: "‖", backslash: "\\",
  // Blackboard-bold number sets
  mathbbR: "ℝ", mathbbZ: "ℤ", mathbbN: "ℕ", mathbbQ: "ℚ", mathbbC: "ℂ",
  // Spacing → dropped
  quad: "", qquad: "", ",": "", ";": "", ":": "", "!": "", " ": "",
  // Escaped literals
  "%": "%", "&": "&", "$": "$", "#": "#",
};

const NARY: Record<string, string> = { sum: "sum", prod: "prod", int: "int", oint: "oint", iint: "iint", iiint: "iiint" };
const NARY_GLYPH: Record<string, string> = { sum: "∑", prod: "∏", int: "∫", oint: "∮", iint: "∬", iiint: "∭" };
const MATRIX_ENV: Record<string, string> = {
  matrix: "matrix", pmatrix: "pmatrix", bmatrix: "bmatrix", Bmatrix: "bmatrix", vmatrix: "vmatrix", array: "matrix",
};
const DELIM_CMD: Record<string, string> = { "{": "(", "}": ")", "|": "|", ".": "", lbrace: "(", rbrace: ")", langle: "|", rangle: "|" };

interface LTok {
  t: "cmd" | "sup" | "sub" | "lbrace" | "rbrace" | "amp" | "rows" | "char";
  v: string;
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
            toks.push({ t: "cmd", v: name + inner });
            i = j + 1;
            continue;
          }
        }
        toks.push({ t: "cmd", v: name });
        continue;
      }
      // \, \; \{ \| \  etc. — command named by the single following char.
      toks.push({ t: "cmd", v: src[i + 1] ?? "" });
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
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

/** Translates a LaTeX math string into the project math DSL. */
export function latexToDsl(src: string): string {
  // Strip surrounding math delimiters: $…$, $$…$$, \(…\), \[…\].
  let s = src.trim();
  s = s.replace(/^\$\$?|\$\$?$/g, "").trim();
  s = s.replace(/^\\\(|\\\)$/g, "").replace(/^\\\[|\\\]$/g, "").trim();

  const toks = lexLatex(s);
  let pos = 0;
  const peek = (): LTok | undefined => toks[pos];
  const eat = (): LTok | undefined => toks[pos++];

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

  function seq(): string {
    const parts: string[] = [];
    for (;;) {
      const t = peek();
      if (!t || t.t === "rbrace" || t.t === "amp" || t.t === "rows") break;
      if (t.t === "cmd" && t.v === "end") break;
      if (t.t === "sup" || t.t === "sub") {
        const op = eat()!.t;
        const g = group();
        const prev = parts.pop() ?? "";
        parts.push(prev + (op === "sup" ? "^" : "_") + "{" + g + "}");
        continue;
      }
      parts.push(atom());
    }
    // LaTeX math ignores whitespace, so concatenate with no separator — this also
    // keeps multi-digit numbers ("100") and decimals ("3.14") intact instead of
    // splitting them into separate DSL tokens.
    return parts.filter((p) => p !== "").join("");
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
    if (t.t === "cmd") return command(t.v);
    return "";
  }

  function command(name: string): string {
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
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
    if (name === "binom") return "binom(" + group() + ", " + group() + ")";
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
      let lo = "";
      let hi = "";
      while (peek() && (peek()!.t === "sup" || peek()!.t === "sub")) {
        const op = eat()!.t;
        const g = group();
        if (op === "sub") lo = g;
        else hi = g;
      }
      const body = seq();
      if (lo !== "" && hi !== "") return `${NARY[name]}(${lo}, ${hi}, ${body})`;
      return `${NARY_GLYPH[name]} ${body}`.trim();
    }
    if (name === "lim") {
      let sub = "";
      while (peek() && peek()!.t === "sub") {
        eat();
        sub = group();
      }
      const body = seq();
      return `lim(${sub}, ${body})`;
    }
    if (name === "hat" || name === "bar" || name === "vec" || name === "overline") {
      return `${name === "overline" ? "bar" : name}(${group()})`;
    }
    if (name === "text" || name === "mathrm" || name === "mathbf" || name === "mathit" || name === "operatorname") {
      return group();
    }
    if (name === "left" || name === "right") {
      const d = peek();
      if (!d) return "";
      if (d.t === "char") {
        eat();
        return d.v === "." ? "" : d.v;
      }
      if (d.t === "cmd") {
        eat();
        return DELIM_CMD[d.v] ?? "";
      }
      return "";
    }
    // The env name is lexed as individual chars; collapse the spaces seq() adds.
    if (name === "begin") return environment(group().replace(/\s+/g, ""));
    if (name === "end") {
      group();
      return "";
    }
    if (SIMPLE[name] !== undefined) return SIMPLE[name];
    // Unknown command (e.g. a function like \sin): strip the backslash.
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
  "φ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega",
  "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi",
  "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
  "·": "\\cdot", "×": "\\times", "÷": "\\div", "±": "\\pm", "∓": "\\mp",
  "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv", "≅": "\\cong", "∝": "\\propto",
  "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow",
  "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq", "⊃": "\\supset", "⊇": "\\supseteq",
  "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists",
  "¬": "\\neg", "∧": "\\wedge", "∨": "\\vee", "⊕": "\\oplus", "⊗": "\\otimes",
  "∂": "\\partial", "∇": "\\nabla", "∞": "\\infty", "∘": "\\circ", "…": "\\ldots", "⋯": "\\cdots",
  "ℝ": "\\mathbb{R}", "ℤ": "\\mathbb{Z}", "ℕ": "\\mathbb{N}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}",
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint", "∬": "\\iint", "∭": "\\iiint",
  "∠": "\\angle", "ℏ": "\\hbar", "ℓ": "\\ell",
};

const DELIM_TO_LATEX: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "‖": "\\|",
  "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "⟨": "\\langle", "⟩": "\\rangle",
};

const ACC_TO_LATEX: Record<string, string> = { "̄": "\\bar", "̂": "\\hat", "⃗": "\\vec" };

function glyphsToLatex(s: string): string {
  let out = "";
  for (const ch of s) out += GLYPH_TO_LATEX[ch] ? GLYPH_TO_LATEX[ch] + " " : ch;
  return out.trim();
}

/** Renders the shared math AST back to a LaTeX string (for copy-as-LaTeX). */
export function astToLatex(node: MathNode): string {
  switch (node.k) {
    case "text":
      return glyphsToLatex(node.v);
    case "row":
      return node.items.map(astToLatex).join(" ");
    case "frac":
      return `\\frac{${astToLatex(node.num)}}{${astToLatex(node.den)}}`;
    case "sup":
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
      return `${node.known ? "\\" : ""}${node.name}${astToLatex(node.arg)}`;
    case "lim":
      return `\\lim_{${astToLatex(node.sub)}} ${astToLatex(node.body)}`;
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
