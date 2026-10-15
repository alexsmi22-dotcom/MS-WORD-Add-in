// LaTeX → Unicode for BibTeX field values (docs/SCOPE-CITATIONS-2026-10.md §C2).
//
// Two renderings of the same parse:
//   latexToRich(raw)  → CSL rich text: the only markup is <i> <b> <sub> <sup> and
//                       <span class="nocase">. Used for title and container-title.
//   latexToPlain(raw) → the same text with no markup. Used for every other field.
//
// BibTeX semantics that matter here:
//   - A brace group at depth 1 that does NOT start with a control sequence protects
//     its case: {DNA} → <span class="nocase">DNA</span>.
//   - A depth-1 group that starts with a control sequence is a "special character"
//     ({\"o}, {\ss}, {\em x}) and is NOT case-protected, exactly as in BibTeX.
//   - The argument of a formatting command at depth 0 (\emph{DNA}) is a depth-1
//     group and is protected, also as in BibTeX.
//   - Math: $H_2O$ and H$_2$O → H₂O. Sub/superscripts become Unicode when every
//     character has a Unicode form; otherwise <sub>/<sup> (rich) or the bare
//     characters (plain). Never "_" or "^" (the display contract).
//
// The scan is a single loop over an explicit stack (no recursion), so a field with
// 100,000 nested braces cannot overflow the call stack. Unknown commands are kept
// verbatim ("\foo"), never silently dropped.

// Invisible characters (combining marks, NBSP, thin space) are built from char codes,
// never typed literally: an invisible character in source is the shell-eaten-backslash
// failure class in another form (bibImport.adversarial.test.ts guards it).
const cc = (code: number): string => String.fromCharCode(code);
/** No-break space, LaTeX's ~. */
export const NBSP = cc(0xa0);
const THIN_SPACE = cc(0x2009);

/** Accent command → combining mark (diaeresis, acute, grave, circumflex, tilde, macron, …). */
const ACCENTS: Record<string, string> = {
  '"': cc(0x308), "'": cc(0x301), "`": cc(0x300), "^": cc(0x302), "~": cc(0x303), "=": cc(0x304),
  ".": cc(0x307), u: cc(0x306), v: cc(0x30c), H: cc(0x30b), c: cc(0x327), k: cc(0x328),
  r: cc(0x30a), d: cc(0x323), b: cc(0x331), t: cc(0x361),
};

/** Spacing forms for an accent given an empty argument (\'{}). */
const ACCENT_ALONE: Record<string, string> = {
  '"': "¨", "'": "´", "`": "`", "^": "^", "~": "˜", "=": "¯",
};

/** Commands with no argument, valid in text and math mode. */
const SYMBOLS: Record<string, string> = {
  ss: "ß", SS: "SS", o: "ø", O: "Ø", aa: "å", AA: "Å", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ",
  l: "ł", L: "Ł", i: "ı", j: "ȷ", dh: "ð", DH: "Ð", th: "þ", TH: "Þ", ng: "ŋ", NG: "Ŋ",
  dj: "đ", DJ: "Đ",
  textendash: "–", textemdash: "—", textquoteleft: "‘", textquoteright: "’",
  textquotedblleft: "“", textquotedblright: "”", quotedblbase: "„", textquotesingle: "'",
  guillemotleft: "«", guillemotright: "»", guillemetleft: "«", guillemetright: "»",
  ldots: "…", dots: "…", textellipsis: "…", cdots: "⋯",
  textregistered: "®", texttrademark: "™", copyright: "©", textcopyright: "©",
  textdegree: "°", degree: "°", textless: "<", textgreater: ">", textbackslash: "\\",
  textbar: "|", textasciitilde: "~", textasciicircum: "^", textunderscore: "_",
  S: "§", P: "¶", textsection: "§", textparagraph: "¶", dag: "†", ddag: "‡",
  textdagger: "†", textdaggerdbl: "‡", textbullet: "•", pounds: "£", textsterling: "£",
  texteuro: "€", euro: "€", textyen: "¥", textmu: "µ", micro: "µ", textohm: "Ω", ohm: "Ω",
  textperthousand: "‰", textonehalf: "½", textperiodcentered: "·", textexclamdown: "¡",
  textquestiondown: "¿", LaTeX: "LaTeX", TeX: "TeX", BibTeX: "BibTeX", LaTeXe: "LaTeX2ε",
  // Greek (unicode-math conventions: \phi = ϕ, \varphi = φ)
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ",
  upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // math symbols
  times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷", to: "→", rightarrow: "→",
  leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
  rightleftharpoons: "⇌", longrightarrow: "⟶", uparrow: "↑", downarrow: "↓",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", sim: "∼",
  simeq: "≃", cong: "≅", equiv: "≡", propto: "∝", infty: "∞", partial: "∂", nabla: "∇",
  circ: "∘", bullet: "•", ell: "ℓ", hbar: "ℏ", prime: "′", langle: "⟨", rangle: "⟩",
  sum: "∑", prod: "∏", int: "∫", oint: "∮", in: "∈", notin: "∉", subset: "⊂", supset: "⊃",
  subseteq: "⊆", supseteq: "⊇", cap: "∩", cup: "∪", emptyset: "∅", varnothing: "∅",
  forall: "∀", exists: "∃", neg: "¬", lnot: "¬", wedge: "∧", land: "∧", vee: "∨", lor: "∨",
  perp: "⊥", parallel: "∥", angle: "∠", star: "⋆", ast: "∗", oplus: "⊕", otimes: "⊗",
  backslash: "\\", setminus: "∖", ll: "≪", gg: "≫", lesssim: "≲", gtrsim: "≳", Re: "ℜ", Im: "ℑ", aleph: "ℵ",
  // spacing and no-ops
  quad: " ", qquad: " ", par: " ", newline: " ", left: "", right: "", big: "", Big: "",
  bigl: "", bigr: "", Bigl: "", Bigr: "", displaystyle: "", textstyle: "", relax: "",
  protect: "", noindent: "", nobreak: "", xspace: "", unskip: "",
};

/** Single non-letter control symbols. */
const CONTROL_SYMBOLS: Record<string, string> = {
  "&": "&", "%": "%", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}", " ": " ",
  ",": THIN_SPACE, ";": " ", ":": " ", "!": "", "-": "", "/": "", "\\": " ", "@": "",
  "\n": " ", "\r": " ", "\t": " ", "|": "‖",
};

type OneArg = "i" | "b" | "sub" | "sup" | "plain" | "nocase" | "quote" | "drop" | "ce" | "sqrt";
/** One-argument commands. */
const ONE_ARG: Record<string, OneArg> = {
  emph: "i", textit: "i", textsl: "i", mkbibemph: "i", mkbibitalic: "i",
  textbf: "b", mkbibbold: "b",
  textsubscript: "sub", textsuperscript: "sup", mkbibsuperscript: "sup",
  textsc: "plain", textrm: "plain", textup: "plain", textnormal: "plain", texttt: "plain",
  textsf: "plain", textmd: "plain", mbox: "plain", hbox: "plain", text: "plain",
  mathrm: "plain", mathbf: "plain", mathsf: "plain", mathtt: "plain", mathcal: "plain",
  mathbb: "plain", mathit: "plain", mathnormal: "plain", operatorname: "plain",
  boldsymbol: "plain", bm: "plain", url: "plain", nolinkurl: "plain", ensuremath: "plain",
  textnumero: "plain", uppercase: "plain", lowercase: "plain", MakeUppercase: "plain",
  NoCaseChange: "nocase", enquote: "quote", mkbibquote: "quote",
  hspace: "drop", vspace: "drop", label: "drop", cite: "drop", ref: "drop",
  ce: "ce", sqrt: "sqrt",
};

/** Formatting commands whose depth-1 argument is case-protected (BibTeX semantics). */
const PROTECTING = new Set<OneArg>(["i", "b", "plain", "nocase"]);

/** Old-style declarations: {\em x}, {\bf x}. */
const DECLARATIONS: Record<string, "i" | "b" | ""> = {
  em: "i", it: "i", itshape: "i", sl: "i", slshape: "i",
  bf: "b", bfseries: "b",
  rm: "", sc: "", scshape: "", normalfont: "", upshape: "", tt: "", sf: "", mdseries: "",
  rmfamily: "", sffamily: "", ttfamily: "", small: "", footnotesize: "", large: "", Large: "",
  tiny: "", scriptsize: "", normalsize: "", huge: "", Huge: "",
};

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ",
  t: "ₜ", i: "ᵢ", j: "ⱼ", r: "ᵣ", u: "ᵤ", v: "ᵥ",
};
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
  "∘": "°", "°": "°", "′": "′", "″": "″", "∗": "*", "*": "*",
};

/** Map every character, or return null if one has no Unicode script form. */
function scriptMap(text: string, table: Record<string, string>): string | null {
  let out = "";
  for (const ch of text) {
    const m = table[ch];
    if (m === undefined) return null;
    out += m;
  }
  return out;
}

const TAG_RE = /<\/?(?:i|b|sub|sup|span(?: class="nocase")?)>/g;
function stripTags(s: string): string {
  return s.replace(TAG_RE, () => "");
}
function hasLetter(s: string): boolean {
  return /\p{L}/u.test(stripTags(s));
}

/** Put a combining mark after the first visible character of `content`. */
function applyAccent(mark: string, cmd: string, content: string): string {
  // Find the first character not inside a tag.
  let i = 0;
  while (i < content.length && content[i] === "<") {
    const close = content.indexOf(">", i);
    if (close < 0) break;
    i = close + 1;
  }
  if (i >= content.length) return ACCENT_ALONE[cmd] ?? mark;
  const cp = content.codePointAt(i)!;
  let base = String.fromCodePoint(cp);
  if (base === "ı") base = "i";
  if (base === "ȷ") base = "j";
  const after = i + (cp > 0xffff ? 2 : 1);
  return (content.slice(0, i) + base + mark).normalize("NFC") + content.slice(after);
}

/** mhchem's \ce, the common subset: H2O → H₂O, SO4^2- → SO₄²⁻, Ca^{2+} → Ca²⁺. */
function mhchem(content: string, rich: boolean): string {
  const text = stripTags(content);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "^") {
      let j = i + 1;
      let body = "";
      if (text[j] === "{") {
        const end = text.indexOf("}", j);
        body = end < 0 ? text.slice(j + 1) : text.slice(j + 1, end);
        j = end < 0 ? text.length : end + 1;
      } else {
        while (j < text.length && /[0-9+\-]/.test(text[j])) body += text[j++];
      }
      out += script(body, "sup", rich);
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) && i > 0 && /[\p{L})\]]/u.test(text[i - 1])) {
      let j = i;
      let body = "";
      while (j < text.length && /[0-9]/.test(text[j])) body += text[j++];
      out += script(body, "sub", rich);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function script(content: string, kind: "sub" | "sup", rich: boolean): string {
  const bare = stripTags(content);
  const mapped = scriptMap(bare, kind === "sub" ? SUB : SUP);
  if (mapped !== null) return mapped;
  if (!rich) return bare;
  return `<${kind}>${content}</${kind}>`;
}

interface Pending {
  name: string;
  need: number;
  args: string[];
  /** Arguments of this command are case-protected when they sit at depth 1. */
  protects: boolean;
}

interface Frame {
  kind: "root" | "group" | "arg" | "math";
  out: string;
  depth: number;
  math: boolean;
  special: boolean;
  seenToken: boolean;
  /** Arg frames only: protect the content (formatting-command argument at depth 1). */
  protectArg: boolean;
  decls: Array<{ at: number; tag: "i" | "b" }>;
  pendings: Pending[];
}

function newFrame(kind: Frame["kind"], depth: number, math: boolean, protectArg = false): Frame {
  return { kind, out: "", depth, math, special: false, seenToken: false, protectArg, decls: [], pendings: [] };
}

function applyCommand(p: Pending, rich: boolean, math: boolean): string {
  const a = p.args;
  if (p.name in ACCENTS) return applyAccent(ACCENTS[p.name], p.name, a[0] ?? "");
  if (p.name === "_sub") return script(a[0] ?? "", "sub", rich);
  if (p.name === "_sup") return script(a[0] ?? "", "sup", rich);
  if (p.name === "href") return a[1] ?? "";
  if (p.name === "frac" || p.name === "dfrac" || p.name === "tfrac") {
    const wrap = (x: string): string => (stripTags(x).length > 1 && /[^\p{L}\p{N}.]/u.test(stripTags(x)) ? `(${x})` : x);
    return `${wrap(a[0] ?? "")}/${wrap(a[1] ?? "")}`;
  }
  const kind = ONE_ARG[p.name];
  const c = a[0] ?? "";
  switch (kind) {
    case "i":
    case "b":
      return rich && c !== "" ? `<${kind}>${c}</${kind}>` : c;
    case "sub":
    case "sup":
      return script(c, kind, rich);
    case "plain":
      return c;
    case "nocase":
      return rich && hasLetter(c) && !c.startsWith('<span class="nocase">') ? `<span class="nocase">${c}</span>` : c;
    case "quote":
      return `“${c}”`;
    case "drop":
      return "";
    case "ce":
      return mhchem(c, rich);
    case "sqrt":
      return `√${c}`;
    default:
      return `\\${p.name}{${c}}`;
  }
}

function finishFrame(f: Frame, rich: boolean): string {
  let out = f.out;
  // Flush commands still waiting for an argument (input ended): apply with what they have.
  while (f.pendings.length) {
    const p = f.pendings.pop()!;
    const r = applyCommand(p, rich, f.math);
    if (f.pendings.length) f.pendings[f.pendings.length - 1].args.push(r);
    else out += r;
  }
  if (rich) {
    for (let k = f.decls.length - 1; k >= 0; k--) {
      const { at, tag } = f.decls[k];
      if (out.slice(at).trim() === "") continue;
      out = `${out.slice(0, at)}<${tag}>${out.slice(at)}</${tag}>`;
    }
  }
  return out;
}

function convert(raw: string, rich: boolean): string {
  const s = raw;
  const n = s.length;
  const stack: Frame[] = [newFrame("root", 0, false)];
  const top = (): Frame => stack[stack.length - 1];

  /** Hand a finished atom to the frame: to a waiting command, or to the output. */
  const produce = (f: Frame, atom: string): void => {
    let value = atom;
    while (f.pendings.length) {
      const p = f.pendings[f.pendings.length - 1];
      p.args.push(value);
      if (p.args.length < p.need) return;
      f.pendings.pop();
      value = applyCommand(p, rich, f.math);
    }
    f.out += value;
  };

  const closeFrame = (): void => {
    const f = stack.pop()!;
    let content = finishFrame(f, rich);
    const parent = top();
    if (f.kind === "group") {
      if (rich && f.depth === 1 && !f.special && !f.math && hasLetter(content)) {
        content = `<span class="nocase">${content}</span>`;
      }
    } else if (f.kind === "arg") {
      if (rich && f.protectArg && f.depth === 1 && !f.math && hasLetter(content)) {
        content = `<span class="nocase">${content}</span>`;
      }
    }
    produce(parent, content);
  };

  let i = 0;
  while (i < n) {
    const ch = s[i];
    const f = top();
    const waiting = f.pendings.length > 0;

    if (waiting && (ch === " " || ch === "\t" || ch === "\n" || ch === "\r")) {
      i++;
      continue;
    }

    if (ch === "\\") {
      // Control sequence.
      let name: string;
      let j = i + 1;
      if (j < n && /[A-Za-z]/.test(s[j])) {
        while (j < n && /[A-Za-z]/.test(s[j])) j++;
        name = s.slice(i + 1, j);
        // TeX swallows the spaces after a control word.
        while (j < n && (s[j] === " " || s[j] === "\t" || s[j] === "\n" || s[j] === "\r")) j++;
      } else if (j < n) {
        name = s[j];
        j++;
      } else {
        name = "";
      }
      i = j;
      if (!f.seenToken && f.kind === "group") f.special = true;
      f.seenToken = true;

      if (name === "") {
        produce(f, "\\");
      } else if (name in ACCENTS && !(name.length === 1 && /[A-Za-z]/.test(name) && f.math)) {
        f.pendings.push({ name, need: 1, args: [], protects: false });
      } else if (name === "href" || name === "frac" || name === "dfrac" || name === "tfrac") {
        f.pendings.push({ name, need: 2, args: [], protects: false });
      } else if (name in ONE_ARG) {
        // \sqrt[n]{x}: skip an optional argument.
        if (name === "sqrt" && s[i] === "[") {
          const end = s.indexOf("]", i);
          if (end > 0) i = end + 1;
        }
        f.pendings.push({ name, need: 1, args: [], protects: PROTECTING.has(ONE_ARG[name]) });
      } else if (name in DECLARATIONS) {
        const tag = DECLARATIONS[name];
        if (tag) f.decls.push({ at: f.out.length, tag });
      } else if (name in SYMBOLS) {
        produce(f, SYMBOLS[name]);
      } else if (name in CONTROL_SYMBOLS) {
        produce(f, CONTROL_SYMBOLS[name]);
      } else if (/^[A-Za-z]+$/.test(name) && s[i] === "{") {
        // Unknown command with a braced argument: kept verbatim, \name{argument}.
        f.pendings.push({ name, need: 1, args: [], protects: false });
      } else {
        // Unknown: kept verbatim so nothing disappears.
        produce(f, `\\${name}`);
      }
      continue;
    }

    if (ch === "{") {
      f.seenToken = true;
      if (waiting) {
        const p = f.pendings[f.pendings.length - 1];
        stack.push(newFrame("arg", f.depth + 1, f.math, p.protects));
      } else {
        stack.push(newFrame("group", f.depth + 1, f.math));
      }
      i++;
      continue;
    }

    if (ch === "}") {
      i++;
      if (stack.length > 1 && f.kind !== "math") closeFrame();
      // A stray "}" at the root (or inside math) is ignored.
      continue;
    }

    if (ch === "$") {
      const dbl = s[i + 1] === "$";
      i += dbl ? 2 : 1;
      if (f.kind === "math") {
        closeFrame();
      } else {
        f.seenToken = true;
        stack.push(newFrame("math", f.depth, true));
      }
      continue;
    }

    f.seenToken = true;

    if (f.math) {
      if (ch === "_" || ch === "^") {
        f.pendings.push({ name: ch === "_" ? "_sub" : "_sup", need: 1, args: [], protects: false });
        i++;
        continue;
      }
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        i++;
        continue;
      }
      if (ch === "-") {
        produce(f, "−");
        i++;
        continue;
      }
      if (ch === "'") {
        produce(f, "′");
        i++;
        continue;
      }
      const cp = s.codePointAt(i)!;
      const c = String.fromCodePoint(cp);
      produce(f, c);
      i += c.length;
      continue;
    }

    // Text mode ligatures.
    if (ch === "-") {
      let j = i;
      while (j < n && s[j] === "-") j++;
      const run = j - i;
      if (waiting) {
        produce(f, "-");
        i++;
        continue;
      }
      produce(f, run >= 3 ? "—" + "-".repeat(run - 3) : run === 2 ? "–" : "-");
      i = j;
      continue;
    }
    if (ch === "`" && !waiting) {
      if (s[i + 1] === "`") {
        produce(f, "“");
        i += 2;
      } else {
        produce(f, "‘");
        i++;
      }
      continue;
    }
    if (ch === "'" && s[i + 1] === "'" && !waiting) {
      // '' → ”. A single ' stays a straight apostrophe, so O'Brien from BibTeX equals
      // O'Brien from RIS and CSL-JSON (every real export keeps it straight).
      produce(f, "”");
      i += 2;
      continue;
    }
    if (ch === "~") {
      produce(f, NBSP);
      i++;
      continue;
    }
    if (ch === "\t" || ch === "\n" || ch === "\r") {
      produce(f, " ");
      i++;
      continue;
    }
    const cp = s.codePointAt(i)!;
    const c = String.fromCodePoint(cp);
    produce(f, c);
    i += c.length;
  }

  // Close whatever is still open (callers pass balanced values; this is a safety net).
  while (stack.length > 1) closeFrame();
  const out = finishFrame(stack[0], rich);
  return out.replace(/[ \t\r\n]+/g, () => " ").trim().normalize("NFC");
}

/** CSL rich text from a BibTeX field value (delimiters already removed). */
export function latexToRich(raw: string): string {
  return convert(raw, true);
}

/** Plain Unicode text from a BibTeX field value: no markup at all. */
export function latexToPlain(raw: string): string {
  return convert(raw, false);
}
