// Rich-text helpers and case conversion for the citation styles
// (docs/SCOPE-CITATIONS-2026-10.md §C5, §E "Sentence case vs title case").
//
// Rich text in a BibRecord title is a small HTML subset: <i> <b> <sub> <sup> and
// <span class="nocase">. Unicode (H₂O, ¹³C, µ, Å, Greek) is carried verbatim.
//
// THE CASE RULES
// - Content inside <span class="nocase">, <i>, <sub> and <sup> is never re-cased.
//   (Italic carries species, gene names and locants such as <i>trans</i>.)
// - Sentence case lowercases ONLY words whose casing is Title ("Xxxx"). It leaves alone:
//   all-caps acronyms (DNA, NMR, CRISPR), mixed case (pH, mRNA, MoS₂, GaN, iPhone), words
//   with digits or sub/superscripts (CO₂, ¹³C, Cas9), single capitals other than "A"
//   (the C in C–H, the N of N-methyl, (R), (S), (E), (Z)), and two-letter element symbols
//   (Fe, Au, Pd …) except the ones that are also English words (In, As, At, Be, He, No, Am).
// - Sentence case is applied only to a title that LOOKS title-cased. A title that already
//   has a lowercase content word ("Values and practices in Denmark") is returned as given,
//   because lowercasing it would destroy the proper nouns the source capitalised.
// - Locant prefixes (trans-, cis-, tert-, sec-, o-, m-, p-, n-, N-) keep their case, and
//   the word after a locant at the start of a title keeps its capital (ACS: *trans*-Stilbene).
// - Title (headline) case only RAISES lowercase words; it never lowercases anything.

// ---------------------------------------------------------------- rich-text tokens

export type Tok =
  | { kind: "text"; text: string } // decoded text (no entities)
  | { kind: "open"; tag: "i" | "b" | "sub" | "sup" | "nocase" }
  | { kind: "close"; tag: "i" | "b" | "sub" | "sup" | "nocase" };

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    const v = ENTITY[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Only exact bare tags are markup: <i> </i> <b> <sub> … and <span> / <span class="…"> / </span>.
// Anything else ("0 < b and c > 0", "x <span of control>") is literal text.
const TAG_RE = /<(\/?)(i|b|em|strong|sub|sup|span)((?:\s+class="[^"<>]*")?)>/gi;

/** Tokenise a rich-text field. Unknown or malformed tags are kept as literal text. */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const spanStack: boolean[] = []; // true = a nocase span
  let last = 0;
  const pushText = (t: string): void => {
    if (!t) return;
    const text = decodeEntities(t);
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text") prev.text += text;
    else out.push({ kind: "text", text });
  };
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(src)) !== null) {
    const closing = m[1] === "/";
    let name = m[2].toLowerCase();
    if (m[3] && (name !== "span" || closing)) continue; // attributes only on an opening span
    if (name === "span" && closing && spanStack.length === 0) continue; // stray </span> is text
    pushText(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (name === "em") name = "i";
    if (name === "strong") name = "b";
    if (name === "span") {
      if (closing) {
        const wasNocase = spanStack.pop();
        if (wasNocase) out.push({ kind: "close", tag: "nocase" });
      } else {
        const nocase = /\bnocase\b/i.test(m[3]);
        spanStack.push(nocase);
        if (nocase) out.push({ kind: "open", tag: "nocase" });
      }
      continue;
    }
    out.push({ kind: closing ? "close" : "open", tag: name as "i" | "b" | "sub" | "sup" });
  }
  pushText(src.slice(last));
  return out;
}

const MINUS = String.fromCharCode(0x2212); // U+2212 MINUS SIGN (built, not typed: invisible-lookalike hazard)

// Unicode sub/superscript forms. Digits and the signs always exist; letters only where
// Unicode has them. Anything else stays as a <sub>/<sup> tag in the html.
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", [MINUS]: "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ",
};
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", [MINUS]: "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};

function toScript(text: string, map: Record<string, string>): string | null {
  let out = "";
  for (const ch of text) {
    const v = map[ch];
    if (v === undefined) return null;
    out += v;
  }
  return out;
}

/**
 * Normalise a rich-text field to safe html: entities decoded then re-escaped, <em>/<strong>
 * mapped to <i>/<b>, nocase spans dropped (they are an instruction to the case converter,
 * not display), and <sub>/<sup> runs that have Unicode forms turned into Unicode — so
 * "H<sub>2</sub>O" becomes "H₂O" in BOTH the html and the plain text.
 */
export function normalizeRich(src: string | undefined): string {
  if (!src) return "";
  const toks = tokenize(src);
  let html = "";
  const open: string[] = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "text") { html += escapeHtml(t.text); continue; }
    if (t.tag === "nocase") continue;
    if ((t.tag === "sub" || t.tag === "sup") && t.kind === "open") {
      const body = toks[k + 1];
      const close = toks[k + 2];
      if (body && body.kind === "text" && close && close.kind === "close" && close.tag === t.tag) {
        const u = toScript(body.text, t.tag === "sub" ? SUB : SUP);
        if (u !== null) { html += escapeHtml(u); k += 2; continue; }
      }
    }
    if (t.kind === "open") { open.push(t.tag); html += `<${t.tag}>`; continue; }
    const at = open.lastIndexOf(t.tag);
    if (at < 0) continue; // a close with no open: dropped
    // Close anything opened inside it first, so the html stays well formed.
    while (open.length > at) html += `</${open.pop()}>`;
  }
  while (open.length) html += `</${open.pop()}>`; // unclosed tags are closed at the end
  return html;
}

/** The plain form of an html string: tags stripped, entities decoded. */
export function plainOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

/** Plain text of a rich field (after the same normalisation the html gets). */
export function richPlain(src: string | undefined): string {
  return plainOf(normalizeRich(src));
}

/**
 * Wrap a normalised html fragment in italics. Italic text nested inside an italic field
 * (a species name inside a book title) is set roman, which is the typographic convention.
 */
export function italicize(html: string): string {
  if (!html) return "";
  const inner = html.replace(/<i>/g, '<span style="font-style:normal">').replace(/<\/i>/g, "</span>");
  return `<i>${inner}</i>`;
}

// ---------------------------------------------------------------- word classes

/** Chicago (CMOS 8.159) lowercase words in headline style: articles, the coordinating
 * conjunctions and/but/for/or/nor, "to", "as", and prepositions regardless of length. */
export const CHICAGO_SMALL_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "but", "for", "or", "nor", "to", "as",
  "about", "above", "across", "after", "against", "along", "amid", "among", "around", "at",
  "before", "behind", "below", "beneath", "beside", "besides", "between", "beyond", "by",
  "despite", "down", "during", "except", "from", "in", "inside", "into", "like", "near",
  "of", "off", "on", "onto", "out", "outside", "over", "past", "per", "since", "than",
  "through", "throughout", "till", "toward", "towards", "under", "underneath", "until",
  "up", "upon", "via", "versus", "vs", "with", "within", "without",
]);

/** Locant and stereo prefixes that keep their case (only when followed by a hyphen). */
const LOCANTS: ReadonlySet<string> = new Set([
  "trans", "cis", "tert", "sec", "o", "m", "p", "n", "N", "O", "S", "C", "P",
  "endo", "exo", "meso", "rac", "iso", "neo", "d", "l", "D", "L",
]);

const ELEMENTS_2 = new Set(
  ("He Li Be Ne Na Mg Al Si Cl Ar Ca Sc Ti Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Zr Nb Mo Tc Ru Rh Pd Ag Cd "
    + "In Sn Sb Te Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn "
    + "Fr Ra Ac Th Pa Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og").split(" "),
);
// Element symbols that are also ordinary English words in a title; these ARE re-cased.
const ELEMENT_WORDS = new Set(["In", "As", "At", "Be", "He", "No", "Am", "Es"]);

/** Units that follow a number and must stay lowercase ("5 nm Particles"). */
const UNITS = new Set([
  "nm", "mm", "cm", "km", "pm", "fm", "mg", "kg", "g", "ml", "l", "s", "ms", "ns", "ps", "fs", "min", "h",
  "mol", "mmol", "eV", "keV", "kDa", "bp", "kb", "rpm", "ppm", "ppb",
]);

const LETTER = /[\p{L}\p{M}]/u;
const TITLE_SHAPED = /^\p{Lu}[\p{Ll}\p{M}’']*$/u;
const ALL_LOWER = /^[\p{Ll}\p{M}’']+$/u;
const SCRIPT_CHARS = /[\d₀-₉¹²³⁰-⁹ₐ-ₜⁱⁿ₊₋₌₍₎⁺⁻⁼⁽⁾]/u;

/** Is this (unprotected) Title-shaped word one that sentence case must keep capitalised? */
/**
 * Nouns that take a letter designation: "Vitamin A", "Protein Kinase A", "Hepatitis A",
 * "Type A", "Figure A". After one of these, a lone "A" is the designation, not the article.
 */
const DESIGNATED = new Set([
  "vitamin", "vitamins", "kinase", "kinases", "protein", "proteins", "hepatitis", "influenza", "type", "types",
  "class", "group", "groups", "phase", "factor", "complex", "site", "chain", "form", "ring", "subunit",
  "domain", "receptor", "receptors", "isoform", "coenzyme", "figure", "fig", "table", "appendix", "part",
  "section", "series", "grade", "lamin", "cyclin", "toxin", "antigen", "immunoglobulin", "strain", "serotype",
  "subtype", "clade", "zone", "region", "model", "scheme", "plan", "option", "case", "point", "panel",
]);

function previousWord(before: string): string {
  const m = /([\p{L}\p{M}]+)\s*$/u.exec(before);
  return m ? m[1].toLowerCase() : "";
}

function keepCapital(word: string, after = "", before = ""): boolean {
  if (SCRIPT_CHARS.test(word)) return true;
  // "E-Commerce" → "e-commerce" (APA's own example); X-ray, T-cell, N-methyl keep the capital.
  if (word === "E" && after.startsWith("-")) return false;
  if (word === "A") return DESIGNATED.has(previousWord(before)); // "Vitamin A", but "Through a"
  if (word.length === 1) return true;
  if (word.length === 2 && ELEMENTS_2.has(word) && !ELEMENT_WORDS.has(word)) return true;
  return false;
}

// A word unit inside unprotected text: letters, digits, marks, apostrophes, sub/superscripts.
const WORD_RE = /[\p{L}\p{M}\p{N}’'₀-₉¹²³⁰-⁹ₐ-ₜ₊₋⁺⁻]+/gu;

interface Piece { text: string; prot: boolean } // prot = inside nocase/i/sub/sup

function pieces(src: string): { toks: Tok[]; list: Array<Piece & { tok: number }> } {
  const toks = tokenize(src);
  const list: Array<Piece & { tok: number }> = [];
  let depth = 0;
  toks.forEach((t, idx) => {
    if (t.kind === "open" && t.tag !== "b") depth++;
    else if (t.kind === "close" && t.tag !== "b") depth = Math.max(0, depth - 1);
    else if (t.kind === "text") list.push({ text: t.text, prot: depth > 0, tok: idx });
  });
  return { toks, list };
}

function rebuild(toks: Tok[]): string {
  let s = "";
  for (const t of toks) {
    if (t.kind === "text") s += escapeHtml(t.text);
    else if (t.tag === "nocase") s += t.kind === "open" ? '<span class="nocase">' : "</span>";
    else s += t.kind === "open" ? `<${t.tag}>` : `</${t.tag}>`;
  }
  return s;
}

interface WordRef { piece: number; start: number; end: number; text: string; before: string; after: string; prot: boolean }

/** Every word with the raw characters around it, across tag boundaries. */
function words(list: Piece[]): WordRef[] {
  const out: WordRef[] = [];
  const flat = list.map((p) => p.text).join("");
  let offset = 0;
  list.forEach((p, pi) => {
    if (p.prot) {
      if (p.text.trim()) {
        out.push({ piece: pi, start: 0, end: p.text.length, text: p.text, prot: true,
          before: flat.slice(0, offset), after: flat.slice(offset + p.text.length) });
      }
    } else {
      WORD_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WORD_RE.exec(p.text)) !== null) {
        out.push({ piece: pi, start: m.index, end: m.index + m[0].length, text: m[0], prot: false,
          before: flat.slice(0, offset + m.index), after: flat.slice(offset + m.index + m[0].length) });
      }
    }
    offset += p.text.length;
  });
  return out;
}

// Stereodescriptors are locants only in parentheses: "(E)-stilbene", but "E-commerce" is a word.
const STEREO = new Set(["E", "Z", "R", "S"]);
const isLocantBefore = (w: WordRef): boolean => {
  if (STEREO.has(w.text) && /\($/.test(w.before) && /^\)-/.test(w.after)) return true;
  return /^-/.test(w.after) && LOCANTS.has(w.text);
};

/** Where a new sentence or subtitle starts, judged from the text before a word. */
function boundaryBefore(before: string): "start" | "sentence" | "subtitle" | null {
  const t = before.replace(/[\s"“‘'(\[]+$/u, "");
  if (!t) return "start";
  // The period of an abbreviation is not a sentence end: a genus ("E. coli"), an initial,
  // or a common abbreviation ("vs.", "Dr.", "Fig.", "e.g.", "i.e.", "et al.").
  if (/(?:^|[\s(])\p{Lu}\.$/u.test(t)) return null;
  if (/(?:^|[\s(])(?:vs|Dr|Mr|Mrs|Ms|St|Fig|No|Vol|e\.g|i\.e|al|ca|approx)\.$/u.test(t)) return null;
  if (/[.?!]$/.test(t)) return "sentence";
  if (/[:—]$/.test(t)) return "subtitle";
  return null;
}

/**
 * True when a title is set in title (headline) case, so sentence-casing it is safe.
 * Any unprotected all-lowercase content word means the source already chose its casing.
 */
export function looksTitleCased(src: string): boolean {
  const ws = words(pieces(src).list).filter((w) => !w.prot);
  let titled = 0;
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k];
    if (!LETTER.test(w.text)) continue;
    if (ALL_LOWER.test(w.text)) {
      if (CHICAGO_SMALL_WORDS.has(w.text)) continue;
      if (isLocantBefore(w)) continue;
      if (UNITS.has(w.text) && /\d\s*$/.test(w.before)) continue;
      return false;
    }
    if (TITLE_SHAPED.test(w.text)) titled++;
  }
  return titled > 0;
}

export interface SentenceCaseOptions {
  /** Keep the first word after ":" or "—" capitalised (APA: yes; NLM: no). */
  capitalizeSubtitle: boolean;
}

/** Sentence case for a rich-text title. Returns normalised html-safe rich text. */
export function sentenceCase(src: string | undefined, opts: SentenceCaseOptions): string {
  if (!src) return "";
  if (!looksTitleCased(src)) return rebuild(tokenize(src));
  const { toks, list } = pieces(src);
  const ws = words(list);
  const edits = new Map<number, Array<{ start: number; end: number; text: string }>>();
  let pendingStart = true; // the next content word starts the title / a sentence
  let pendingSub = false; // the next content word starts a subtitle
  for (const w of ws) {
    const b = boundaryBefore(w.before);
    if (b === "start" || b === "sentence") { pendingStart = true; pendingSub = false; }
    else if (b === "subtitle") { pendingSub = true; }
    const atStart = pendingStart || (pendingSub && opts.capitalizeSubtitle);
    // A locant ("trans-", "N-", "(R)-") does not consume the start-of-title capital.
    if (isLocantBefore(w) || (w.prot && w.after.startsWith("-") && w.text.length <= 6)) continue;
    pendingStart = false;
    pendingSub = false;
    if (w.prot || atStart) continue;
    // A word joined to the previous one by a hyphen is part of a compound; it follows
    // the same rule (Single-Step → single-step) unless it is protected.
    if (!TITLE_SHAPED.test(w.text) || keepCapital(w.text, w.after, w.before)) continue;
    const lower = w.text.toLowerCase();
    const arr = edits.get(w.piece) ?? [];
    arr.push({ start: w.start, end: w.end, text: lower });
    edits.set(w.piece, arr);
  }
  applyEdits(toks, list, edits);
  return rebuild(toks);
}

function applyEdits(toks: Tok[], list: Array<Piece & { tok: number }>,
  edits: Map<number, Array<{ start: number; end: number; text: string }>>): void {
  edits.forEach((arr, pi) => {
    const p = list[pi];
    let s = p.text;
    for (const e of arr.sort((x, y) => y.start - x.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end);
    const tok = toks[p.tok];
    if (tok.kind === "text") tok.text = s;
  });
}

export interface TitleCaseOptions { smallWords: ReadonlySet<string> }

/** Surname particles (BibTeX "von" part). Lowercase only when a capitalised name follows. */
const PARTICLES = new Set(["van", "der", "den", "von", "de", "la", "le", "du", "di", "da", "del", "della", "ter", "ten", "zu", "dos", "das"]);

/** Headline case for a rich-text title: raises lowercase content words, never lowers. */
export function titleCase(src: string | undefined, opts: TitleCaseOptions): string {
  if (!src) return "";
  const { toks, list } = pieces(src);
  const ws = words(list);
  const content = ws.filter((w) => LETTER.test(w.text));
  const lastIdx = content.length ? content[content.length - 1] : null;
  const edits = new Map<number, Array<{ start: number; end: number; text: string }>>();
  for (let ci = 0; ci < content.length; ci++) {
    const w = content[ci];
    if (w.prot) continue;
    if (!ALL_LOWER.test(w.text)) continue;
    if (isLocantBefore(w)) continue;
    // Name particles stay lowercase before the name they belong to: "van der Waals", "de Broglie".
    if (PARTICLES.has(w.text)) {
      let k = ci + 1;
      while (k < content.length && PARTICLES.has(content[k].text)) k++;
      if (k < content.length && /^\p{Lu}/u.test(content[k].text)) continue;
    }
    if (UNITS.has(w.text) && /\d\s*$/.test(w.before)) continue;
    const b = boundaryBefore(w.before);
    const forced = b !== null || w === lastIdx;
    if (!forced && opts.smallWords.has(w.text)) continue;
    // The word after a locant is a main word: "p-Xylene", "tert-Butyl" (the locant stays lowercase).
    const up = w.text.charAt(0).toUpperCase() + w.text.slice(1);
    const arr = edits.get(w.piece) ?? [];
    arr.push({ start: w.start, end: w.end, text: up });
    edits.set(w.piece, arr);
  }
  applyEdits(toks, list, edits);
  return rebuild(toks);
}
