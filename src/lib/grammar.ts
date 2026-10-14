// Context-free grammars — the "grammar" engine of the Discrete-math kind
// (v2.133.0, SCOPE-COMPUTATION-THEORY §B/§C.2).
//
// Reader: one production per line or comma-separated, `->` / `→` / `::=`,
// `|` alternation at depth 0, UPPERCASE = nonterminal, everything else a
// terminal, `<expr>` and quoted `"id"` multi-character symbols, the ε
// spellings of automata.ts (ε eps epsilon λ lambda "" '') via its exported
// normSymbol, start = first left-hand side. Question lines (test: … · member
// · cnf · cyk · derivation of · parse tree for · ambiguous? · first and
// follow · nullable · useless symbols · remove left recursion · equivalent).
//
// Every verdict that can be cross-checked is: membership by CYK over the
// Chomsky normal form, by a direct parse table over the ORIGINAL grammar
// (which also yields the leftmost derivation and the parse tree), and by a
// brute-force enumeration of leftmost sentential forms — a disagreement is
// refused, never reported. Ambiguity is a bounded witness search and says
// so (undecidable); equivalence is refused by name with the sample
// comparison reported. Every cap is named in GRAMMAR_CAPS and checked
// BEFORE the work. The reader is iterative (no recursive descent).

import { DiscreteError, DiscreteResult } from "./discrete";
import { normSymbol, EPS } from "./automata";
import { treeSvg, TreeNode, TreeEdge } from "./treeSvg";

export const GRAMMAR_CAPS = {
  nonterminals: 30,
  productions: 100,
  testCount: 50,
  testLength: 40,
  crossCheckLength: 12,
  enumBudget: 20000,
  ambiguityLength: 8,
  sampleLength: 5,
  sampleStrings: 5000,
  expansion: 2000,
  inputChars: 20000,
  rhsLength: 50,
  /** Readings of one test string into multi-character terminals that are tried. */
  segmentations: 32,
  /** Brute-force forms across ALL test strings of one request (5 full budgets). */
  crossCheckTotal: 100000,
  /** Estimated CYK + direct-parse steps (Σ n³/6 × (binary CNF rules + items)) for one request. */
  parseWork: 250_000_000,
};

export interface Production { lhs: string; rhs: string[] }

export interface Grammar {
  start: string;
  /** Left-hand sides in order of first appearance, then nonterminals that only occur on a right-hand side. */
  nonterminals: string[];
  /** Terminal symbols in order of first appearance. Disjoint from `nonterminals`. */
  terminals: string[];
  productions: Production[];
  /** The source separated symbols with spaces (so `id` was one terminal); the printer keeps that style. */
  spaced: boolean;
  /** Reader notes said in the result (e.g. a duplicated alternative counted once). */
  notes?: string[];
}

/** §B guard: an uppercase (or <angle>) left-hand side followed by a production
 *  arrow, optionally after a `cfg`/`grammar` head or a verb such as `nullable`.
 *  The engine also needs a terminal (or `|`) on a production line — see solveGrammar. */
export const GRAMMAR_RE = /^\s*(?:(?:nullable(?:\s+symbols)?(?:\s+of)?|useless(?:\s+symbols)?(?:\s+(?:of|in))?|(?:to\s+)?cnf(?:\s+of)?|chomsky(?:\s+normal\s+form)?(?:\s+of)?|first\s+and\s+follow(?:\s+(?:of|for))?|(?:remove|eliminate)\s+left[-\s]recursion(?:\s+(?:from|in))?|is\s+(?:the\s+)?(?:grammar|cfg))\b[\s:]*)?(?:(?:cfg|grammar|context[-\s]free(?:\s+grammar)?)\b[\s:]*)?(?:<[^>\n]+>|[A-Z][A-Za-z0-9_'′₀-₉]*)\s*(?:->|→|::=)/m;

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number): string => String(n).split("").map((d) => SUB[Number(d)]).join("");
const NT_TOKEN = /^(?:<[^<>\n]+>|[A-Z][A-Za-z0-9_'′₀-₉]*)$/;
const PROD_HEAD = /^(<[^<>\n]+>|[A-Z][A-Za-z0-9_'′₀-₉]*)\s*(->|→|::=)\s*/;
/** Mirrors pda.ts PDA_RE (construction half) and its last-line form — keep in step. */
const TO_PDA_FIRST = /^\s*(?:cfg|grammar|context[-\s]free(?:\s+grammar)?)?\s*(?:to|→|->)\s+pda\b/i;
const TO_PDA_LAST = /^(?:cfg|grammar)?\s*(?:to|→|->)\s+pda\s*$/i;
const MACHINE_KEYWORD =/^\s*(?:dfa|nfa|regex|to\s+dfa|minimi[sz]e|pda|pushdown|npda|dpda|tm|turing|dtm)\b/i;
const HEAD_LINE = /^\s*(?:cfg|grammar|context[-\s]free)\b/im;
const HEAD_WORD = /^(?:cfg|grammar|context[-\s]free(?:\s+grammar)?)\b\s*:?\s*/i;
const isEpsWord = (t: string): boolean => normSymbol(t) === EPS;
const isUpper = (c: string): boolean => c >= "A" && c <= "Z";
const isNtTail = (c: string): boolean => c === "'" || c === "′" || SUB.includes(c);

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

type QKind = "test" | "cnf" | "ambiguous" | "firstfollow" | "nullable" | "useless" | "leftrec" | "equivalent" | "topda";
interface Question { kind: QKind; args: string[]; line: string }

const Q_PATTERNS: { re: RegExp; kind: QKind; arg?: number }[] = [
  { re: /^(?:tests?|run|strings?|words?|inputs?|cyk|member(?:ship)?|accepts?|derive|(?:leftmost\s+)?derivations?|parse(?:\s+trees?)?)\b\s*(?:of|for)?\s*:?\s*(.*)$/i, kind: "test", arg: 1 },
  { re: /^does\s+(?:it|the\s+grammar|this\s+grammar|g)\s+(?:accept|generate|derive|produce)\s+(.+?)\s*\??$/i, kind: "test", arg: 1 },
  { re: /^(?:is|does)\s+(.+?)\s+(?:in|belong\s+to|a\s+member\s+of|accepted|generated|derivable|a\s+string\s+of)\b.*$/i, kind: "test", arg: 1 },
  { re: /^(?:(?:convert\s+)?to\s+|chomsky\s+)?(?:cnf|chomsky(?:\s+normal\s+form)?)\s*\??$/i, kind: "cnf" },
  { re: /^(?:is\s+(?:it|this|the\s+grammar|the\s+cfg|g)\s+)?ambigu(?:ous|ity)\s*\??$/i, kind: "ambiguous" },
  { re: /^(?:compute\s+|find\s+)?(?:first(?:\s*(?:and|&|\/|,)\s*follow)?|follow|first\s+sets?|first\s+and\s+follow\s+sets?|first\/follow\s+sets?)\s*\??$/i, kind: "firstfollow" },
  { re: /^nullable(?:\s+(?:symbols|set|nonterminals))?\s*\??$/i, kind: "nullable" },
  { re: /^(?:(?:remove|eliminate|find)\s+)?useless(?:\s+symbols)?\s*\??$/i, kind: "useless" },
  { re: /^reduced?(?:\s+grammar)?$/i, kind: "useless" },
  { re: /^(?:(?:remove|eliminate)\s+)?(?:immediate\s+|indirect\s+)?left[-\s]recursion\s*\??$/i, kind: "leftrec" },
  { re: /^(?:equivalent|equivalence|is\s+(?:it|this|the\s+grammar)\s+equivalent)\s*(?:to)?\s*\??$/i, kind: "equivalent" },
  { re: /^(?:cfg|grammar)?\s*(?:to|→|->)\s+pda\s*$/i, kind: "topda" },
];

/** A verb glued to the first production on the same line: `nullable S -> AB, …`. */
const VERB_PREFIX = /^((?:(?:cfg\s+)?to\s+pda|nullable(?:\s+symbols)?(?:\s+of)?|useless(?:\s+symbols)?(?:\s+(?:of|in))?|(?:to\s+)?cnf(?:\s+of)?|chomsky(?:\s+normal\s+form)?(?:\s+of)?|first\s+and\s+follow(?:\s+(?:of|for))?|(?:remove|eliminate)\s+left[-\s]recursion(?:\s+(?:from|in))?|ambiguous\??|is\s+ambiguous)\s*:?)\s+(?=<[^>\n]+>\s*(?:->|→|::=)|[A-Z][A-Za-z0-9_'′₀-₉]*\s*(?:->|→|::=))/i;
const EQUIV_LINE = /^is\s+(?:the\s+)?(?:grammar|cfg)\s+(.+?)\s+equivalent\s+to\s+(?:the\s+(?:grammar|cfg)\s+|(?:grammar|cfg)\s+)?(.+?)\s*\??$/i;
/** A propositional-logic connective outside quotes: the line is logic, not a grammar. */
const LOGIC_MARK = /\|=|⊨|⊢|∴|<->|↔|==|[&∧∨¬~!]/;

function classifyQuestion(line: string): Question | null {
  for (const p of Q_PATTERNS) {
    const m = p.re.exec(line);
    if (!m) continue;
    const args = p.arg === undefined ? [] : splitTests(m[p.arg]);
    return { kind: p.kind, args, line };
  }
  return null;
}

/** Quote-aware split of a test list: `aabb ab "" ε "id + id"` → ["aabb", "ab", "", "", "id + id"]. */
function splitTests(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s|,/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const j = s.indexOf(c, i + 1);
      if (j < 0) throw new DiscreteError(`Unclosed quote in the test list: ${s}`);
      out.push(s.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && !/\s|,/.test(s[j])) j++;
    const tok = s.slice(i, j);
    out.push(isEpsWord(tok) ? "" : tok);
    i = j;
  }
  return out;
}

/** Split outside `<…>` and `"…"` at every occurrence of `sep`. */
function splitDepth0(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "<") {
      const j = s.indexOf(">", i + 1);
      if (j > 0) { cur += s.slice(i, j + 1); i = j + 1; continue; }
    }
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      if (j > 0) { cur += s.slice(i, j + 1); i = j + 1; continue; }
    }
    if (c === sep) { parts.push(cur); cur = ""; i++; continue; }
    cur += c;
    i++;
  }
  parts.push(cur);
  return parts;
}

/** Comma-separated productions on one line; a comma that does not start a new
 *  `LHS ->` piece belongs to the previous alternative (a `,` terminal). */
function splitProductions(line: string): string[] {
  const pieces = splitDepth0(line, ",");
  const out: string[] = [];
  for (const p of pieces) {
    if (out.length && !PROD_HEAD.test(p.trim())) out[out.length - 1] += "," + p;
    else out.push(p);
  }
  return out.map((p) => p.trim()).filter((p) => p);
}

interface Chunk { text: string; kind: "angle" | "quoted" | "plain" }

function chunksOf(alt: string): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  while (i < alt.length) {
    const c = alt[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "<") {
      const j = alt.indexOf(">", i + 1);
      if (j < 0) throw new DiscreteError(`Unclosed < in "${alt}" — a multi-character nonterminal is written <name>.`);
      out.push({ text: alt.slice(i, j + 1), kind: "angle" });
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const j = alt.indexOf('"', i + 1);
      if (j < 0) throw new DiscreteError(`Unclosed quote in "${alt}" — a multi-character terminal is written "name".`);
      out.push({ text: alt.slice(i + 1, j), kind: "quoted" });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < alt.length && !/\s|<|"/.test(alt[j])) j++;
    out.push({ text: alt.slice(i, j), kind: "plain" });
    i = j;
  }
  return out;
}

interface Sym { text: string; nt: boolean }

function charSplit(chunk: string, names: string[], out: Sym[]): void {
  let i = 0;
  while (i < chunk.length) {
    let matched = false;
    for (const n of names) {
      if (n.length > 1 && chunk.startsWith(n, i)) { out.push({ text: n, nt: true }); i += n.length; matched = true; break; }
    }
    if (matched) continue;
    const c = chunk[i];
    if (isUpper(c)) {
      let j = i + 1;
      while (j < chunk.length && isNtTail(chunk[j])) j++;
      out.push({ text: chunk.slice(i, j), nt: true });
      i = j;
      continue;
    }
    if (c === EPS || c === "λ") { i++; continue; }
    out.push({ text: c, nt: false });
    i++;
  }
}

function tokeniseAlt(alt: string, names: string[], spaced: boolean): Sym[] {
  const out: Sym[] = [];
  for (const ch of chunksOf(alt)) {
    if (ch.kind === "angle") { out.push({ text: ch.text, nt: true }); continue; }
    if (ch.kind === "quoted") { if (ch.text !== "") out.push({ text: ch.text, nt: false }); continue; }
    const t = ch.text;
    if (isEpsWord(t)) continue;
    if (spaced) {
      if (NT_TOKEN.test(t)) { out.push({ text: t, nt: true }); continue; }
      if (/^[a-z][a-z0-9_]*$/.test(t) || t.length === 1) { out.push({ text: t, nt: false }); continue; }
    }
    charSplit(t, names, out);
  }
  return out;
}

interface RawProduction { lhs: string; alts: string[] }

interface Request {
  grammar: Grammar;
  questions: Question[];
  /** The second grammar of an `equivalent` request. */
  other?: Grammar;
}

/** Lines → raw productions + questions. Returns null when no line is a production. */
function readLines(text: string): { raws: RawProduction[]; questions: Question[]; unknown: string[]; logic: boolean; equivParts?: [string, string] } | null {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter((l) => l);
  const raws: RawProduction[] = [];
  const questions: Question[] = [];
  const unknown: string[] = [];
  let logic = false;
  let equivParts: [string, string] | undefined;
  // One-line equivalence: "is the grammar G1 equivalent to G2".
  if (lines.length === 1) {
    const eq = EQUIV_LINE.exec(lines[0]);
    if (eq && PROD_HEAD.test(eq[1].replace(HEAD_WORD, "")) && PROD_HEAD.test(eq[2].replace(HEAD_WORD, ""))) {
      return { raws, questions: [{ kind: "equivalent", args: [], line: lines[0] }], unknown, logic, equivParts: [eq[1], eq[2]] };
    }
  }
  // Block equivalence: "equivalent" line + two parts separated by --- or a blank line,
  // or two grammars separated by an "equivalent" line.
  const eqIdx = lines.findIndex((l) => /^(?:equivalent|equivalence|is\s+(?:it|this|the\s+grammar)\s+equivalent)\s*(?:to)?\s*\??$/i.test(l));
  if (eqIdx >= 0 && lines.length > 1) {
    const rest = lines.filter((_, i) => i !== eqIdx);
    const raw = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
    let parts: string[][];
    if (eqIdx > 0 && eqIdx < lines.length - 1) {
      parts = [lines.slice(0, eqIdx), lines.slice(eqIdx + 1)];
    } else {
      parts = [[]];
      let seenNonEmpty = false;
      for (const l of raw) {
        if (/^(?:equivalent|equivalence|is\s+(?:it|this|the\s+grammar)\s+equivalent)\s*(?:to)?\s*\??$/i.test(l)) continue;
        if (!l || /^(-{3,}|={3,})$/.test(l)) { if (seenNonEmpty && parts[parts.length - 1].length) parts.push([]); continue; }
        seenNonEmpty = true;
        parts[parts.length - 1].push(l);
      }
      parts = parts.filter((p) => p.length);
    }
    if (parts.length === 2 && parts[0].some((l) => PROD_HEAD.test(l.replace(HEAD_WORD, ""))) && parts[1].some((l) => PROD_HEAD.test(l.replace(HEAD_WORD, "")))) {
      return { raws, questions: [{ kind: "equivalent", args: [], line: lines[eqIdx] }], unknown, logic, equivParts: [parts[0].join("\n"), parts[1].join("\n")] };
    }
    void rest;
  }
  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx];
    // A verb glued to the first production: "nullable S -> AB, A -> a | ε".
    const vp = VERB_PREFIX.exec(line);
    if (vp) {
      const q = classifyQuestion(vp[1].replace(/:$/, "").trim());
      if (q) questions.push(q);
      line = line.slice(vp[0].length);
    }
    // A cfg/grammar head, alone or glued to the first production.
    if (HEAD_WORD.test(line) && !PROD_HEAD.test(line)) {
      line = line.replace(HEAD_WORD, "");
      if (!line) continue;
    }
    const head = PROD_HEAD.exec(line);
    if (head) {
      const bareLine = line.replace(/"[^"\n]*"/g, " ").replace(/<[^<>\n]+>/g, " ");
      if (LOGIC_MARK.test(bareLine)) logic = true;
      // "A -> b, A therefore b": premises and an English turnstile — an entailment.
      if (bareLine.includes(",") && /\b(?:therefore|entails|hence|so|thus|implies)\b/i.test(bareLine)) logic = true;
      for (const piece of splitProductions(line)) {
        const h = PROD_HEAD.exec(piece);
        if (!h) throw new DiscreteError(`"${piece}" is not a production — write LHS -> alternatives.`);
        const rhs = piece.slice(h[0].length);
        const alts = splitDepth0(rhs, "|").map((a) => a.trim());
        raws.push({ lhs: h[1], alts });
      }
      continue;
    }
    const q = classifyQuestion(line);
    if (q) questions.push(q);
    else unknown.push(line);
  }
  if (!raws.length && !equivParts) return null;
  return { raws, questions, unknown, logic };
}

function buildGrammar(raws: RawProduction[]): Grammar {
  if (!raws.length) throw new DiscreteError("The grammar has no productions.");
  const names: string[] = [];
  for (const r of raws) if (!names.includes(r.lhs)) names.push(r.lhs);
  if (names.length > GRAMMAR_CAPS.nonterminals) throw new DiscreteError(`${names.length} nonterminals exceed the cap of ${GRAMMAR_CAPS.nonterminals}.`);
  const count = raws.reduce((s, r) => s + r.alts.length, 0);
  if (count > GRAMMAR_CAPS.productions) throw new DiscreteError(`${count} productions exceed the cap of ${GRAMMAR_CAPS.productions}.`);
  const spaced = raws.some((r) => r.alts.some((a) => chunksOf(a).length > 1));
  const sortedNames = [...names].sort((a, b) => b.length - a.length);
  const productions: Production[] = [];
  const notes: string[] = [];
  const nonterminals = [...names];
  const terminals: string[] = [];
  const ntSet = new Set(names);
  for (const r of raws) {
    for (const alt of r.alts) {
      const syms = tokeniseAlt(alt, sortedNames, spaced);
      for (const s of syms) {
        if (s.nt) { if (!ntSet.has(s.text)) { ntSet.add(s.text); nonterminals.push(s.text); } }
        else if (!terminals.includes(s.text)) terminals.push(s.text);
      }
      if (syms.length > GRAMMAR_CAPS.rhsLength) throw new DiscreteError(`The production ${r.lhs} → … has ${syms.length} symbols on its right-hand side; the cap is ${GRAMMAR_CAPS.rhsLength}.`);
      const prod = { lhs: r.lhs, rhs: syms.map((s) => s.text) };
      // An alternative written twice is ONE production (else it would be "two"
      // derivations of the same string — a fake ambiguity witness).
      if (productions.some((p) => p.lhs === prod.lhs && p.rhs.length === prod.rhs.length && p.rhs.every((s, i) => s === prod.rhs[i]))) {
        const shown = prod.rhs.length ? prod.rhs.join(" ") : EPS;
        const note = `the alternative ${prod.lhs} → ${shown} appears more than once — counted once`;
        if (!notes.includes(note)) notes.push(note);
        continue;
      }
      productions.push(prod);
    }
  }
  if (nonterminals.length > GRAMMAR_CAPS.nonterminals) throw new DiscreteError(`${nonterminals.length} nonterminals exceed the cap of ${GRAMMAR_CAPS.nonterminals}.`);
  for (const t of terminals) {
    if (ntSet.has(t)) throw new DiscreteError(`"${t}" is used both as a quoted terminal and as the nonterminal ${t} — rename one of them.`);
  }
  // Dedupe identical productions (A -> a | a) silently? No: keep them, but a
  // repeated production is reported once in the printer anyway.
  const g: Grammar = { start: names[0], nonterminals, terminals, productions, spaced };
  if (notes.length) g.notes = notes;
  return g;
}

/** Reads a grammar block (question lines are ignored). Throws DiscreteError on a bad grammar. */
export function parseGrammar(text: string): Grammar {
  const read = readLines(text);
  if (!read || read.equivParts) throw new DiscreteError("That is not a context-free grammar — write productions such as S -> aSb | ε, one per line.");
  if (read.unknown.length) throw new DiscreteError(`Line "${read.unknown[0]}" is neither a production (LHS -> alternatives) nor a question (test: … · cnf · ambiguous? · first and follow · nullable · useless symbols · remove left recursion).`);
  return buildGrammar(read.raws);
}

// ---------------------------------------------------------------------------
// Printer — output re-parses through the reader above (display contract)
// ---------------------------------------------------------------------------

const CHAR_SAFE_NT = /^[A-Z][′'₀-₉]*$/;
const BARE_CHAR = /^[^A-Z\s|"<>,'′ελ]$/;

function charSafe(g: Grammar): boolean {
  return g.nonterminals.every((n) => CHAR_SAFE_NT.test(n)) && g.terminals.every((t) => BARE_CHAR.test(t));
}

function printMode(g: Grammar): boolean {
  return g.spaced || !charSafe(g);
}

function showSym(g: Grammar, s: string, spaced: boolean): string {
  if (g.nonterminals.includes(s)) return s;
  if (!spaced) return s;
  if (/^[a-z][a-z0-9_]*$/.test(s) && !isEpsWord(s)) return s;
  if (BARE_CHAR.test(s)) return s;
  return `"${s}"`;
}

function showSeq(g: Grammar, syms: string[], spaced: boolean): string {
  if (!syms.length) return EPS;
  return syms.map((s) => showSym(g, s, spaced)).join(spaced ? " " : "");
}

/** One line per nonterminal with productions: `S → aSb | ε`. */
export function printGrammar(g: Grammar, spaced: boolean = printMode(g)): string[] {
  const lines: string[] = [];
  for (const nt of g.nonterminals) {
    const alts = g.productions.filter((p) => p.lhs === nt).map((p) => showSeq(g, p.rhs, spaced));
    if (!alts.length) continue;
    const seen = new Set<string>();
    const uniq = alts.filter((a) => (seen.has(a) ? false : (seen.add(a), true)));
    lines.push(`${nt} → ${uniq.join(" | ")}`);
  }
  return lines;
}

const showSet = (xs: string[]): string => (xs.length ? `{${xs.join(", ")}}` : "∅");
const showTerminalSet = (g: Grammar, xs: string[]): string => showSet(xs.map((t) => (t === "$" || t === EPS ? t : showSym(g, t, true))));

/** Splits a test string into the grammar's terminals by longest match; null
 *  with the offending text when some part is not a terminal. */
export function splitWord(g: Grammar, s: string): { word: string[] } | { bad: string } {
  const terms = [...g.terminals].sort((a, b) => b.length - a.length);
  const word: string[] = [];
  for (const piece of s.split(/\s+/).filter((p) => p)) {
    let i = 0;
    while (i < piece.length) {
      const t = terms.find((x) => piece.startsWith(x, i));
      if (!t) return { bad: piece[i] };
      word.push(t);
      i += t.length;
    }
  }
  return { word };
}

/** EVERY way to split a test string into the grammar's terminals (whitespace is a
 *  hard boundary), up to `cap` of them. With multi-character terminals one string
 *  can have several readings (abc = a·bc = ab·c), and membership asks whether ANY
 *  reading is in the language — longest match alone would miss a·bc. `bad` names
 *  the first character no reading can get past. */
export function segmentWord(g: Grammar, s: string, cap: number = GRAMMAR_CAPS.segmentations): { segs: string[][]; capped: boolean } | { bad: string } {
  const pieces = s.split(/\s+/).filter((p) => p);
  const terms = [...g.terminals].sort((a, b) => b.length - a.length);
  const perPiece: string[][][] = [];
  let capped = false;
  for (const piece of pieces) {
    const n = piece.length;
    // ok[i]: the suffix from i can be split into terminals.
    const ok = new Array<boolean>(n + 1).fill(false);
    ok[n] = true;
    for (let i = n - 1; i >= 0; i--) ok[i] = terms.some((t) => piece.startsWith(t, i) && ok[i + t.length]);
    if (!ok[0]) {
      // the furthest position a split can reach from the start
      const reach = new Array<boolean>(n + 1).fill(false);
      reach[0] = true;
      let far = 0;
      for (let i = 0; i < n; i++) if (reach[i]) { far = Math.max(far, i); for (const t of terms) if (piece.startsWith(t, i)) reach[i + t.length] = true; }
      for (let i = n; i >= 0; i--) if (reach[i]) { far = i; break; }
      return { bad: piece[Math.min(far, n - 1)] };
    }
    const out: string[][] = [];
    const stack: { i: number; acc: string[] }[] = [{ i: 0, acc: [] }];
    while (stack.length) {
      const { i, acc } = stack.pop()!;
      if (i === n) { if (out.length >= cap) { capped = true; break; } out.push(acc); continue; }
      for (let t = terms.length - 1; t >= 0; t--) { // pushed short-first, so longest-match pops first
        const term = terms[t];
        if (piece.startsWith(term, i) && ok[i + term.length]) stack.push({ i: i + term.length, acc: [...acc, term] });
      }
    }
    perPiece.push(out);
  }
  let segs: string[][] = [[]];
  for (const options of perPiece) {
    const next: string[][] = [];
    for (const a of segs) for (const b of options) { if (next.length >= cap) { capped = true; break; } next.push([...a, ...b]); }
    segs = next;
  }
  return { segs, capped };
}

/** A terminal string as typed: compact (aaa, id+id) when longest-match
 *  splitting reads it back as the same symbols, else quoted and spaced. */
function showWord(g: Grammar, w: string[]): string {
  if (!w.length) return '""';
  const compact = w.join("");
  const back = splitWord(g, compact);
  if (!/\s|"/.test(compact) && "word" in back && back.word.length === w.length && back.word.every((s, i) => s === w[i])) return compact;
  return `"${w.join(" ")}"`;
}

/** Terminals that are concatenations of other terminals (so a test string can be split two ways). */
function overlappingTerminals(g: Grammar): string[] {
  const out: string[] = [];
  for (const t of g.terminals) {
    if (t.length < 2) continue;
    const others = g.terminals.filter((x) => x !== t);
    const ok = new Array<boolean>(t.length + 1).fill(false);
    ok[0] = true;
    for (let i = 0; i < t.length; i++) if (ok[i]) for (const o of others) if (t.startsWith(o, i)) ok[i + o.length] = true;
    if (ok[t.length]) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nullable, FIRST, FOLLOW
// ---------------------------------------------------------------------------

const isNt = (g: Grammar, s: string): boolean => g.nonterminals.includes(s);

/** Nonterminals that derive ε, in the order the fixpoint discovers them. */
export function nullableSet(g: Grammar): string[] {
  const out: string[] = [];
  const set = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      if (set.has(p.lhs)) continue;
      if (p.rhs.every((s) => set.has(s))) { set.add(p.lhs); out.push(p.lhs); changed = true; }
    }
  }
  return out;
}

function orderTerminals(g: Grammar, xs: Set<string>): string[] {
  const out = g.terminals.filter((t) => xs.has(t));
  if (xs.has("$")) out.push("$");
  if (xs.has(EPS)) out.push(EPS);
  return out;
}

export function firstFollow(g: Grammar): { nullable: string[]; first: Map<string, string[]>; follow: Map<string, string[]> } {
  const nullable = nullableSet(g);
  const nul = new Set(nullable);
  const first = new Map<string, Set<string>>();
  for (const nt of g.nonterminals) first.set(nt, new Set());
  const firstOf = (s: string): Set<string> => (isNt(g, s) ? first.get(s)! : new Set([s]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      const F = first.get(p.lhs)!;
      const before = F.size;
      for (const s of p.rhs) {
        for (const t of firstOf(s)) F.add(t);
        if (!nul.has(s)) break;
      }
      if (F.size !== before) changed = true;
    }
  }
  const follow = new Map<string, Set<string>>();
  for (const nt of g.nonterminals) follow.set(nt, new Set());
  follow.get(g.start)!.add("$");
  changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      for (let i = 0; i < p.rhs.length; i++) {
        const B = p.rhs[i];
        if (!isNt(g, B)) continue;
        const FB = follow.get(B)!;
        const before = FB.size;
        let allNullable = true;
        for (let j = i + 1; j < p.rhs.length; j++) {
          for (const t of firstOf(p.rhs[j])) FB.add(t);
          if (!nul.has(p.rhs[j])) { allNullable = false; break; }
        }
        if (allNullable) for (const t of follow.get(p.lhs)!) FB.add(t);
        if (FB.size !== before) changed = true;
      }
    }
  }
  const firstOut = new Map<string, string[]>();
  const followOut = new Map<string, string[]>();
  for (const nt of g.nonterminals) {
    const F = new Set(first.get(nt)!);
    if (nul.has(nt)) F.add(EPS);
    firstOut.set(nt, orderTerminals(g, F));
    followOut.set(nt, orderTerminals(g, follow.get(nt)!));
  }
  return { nullable, first: firstOut, follow: followOut };
}

// ---------------------------------------------------------------------------
// Useless symbols
// ---------------------------------------------------------------------------

export function uselessSymbols(g: Grammar): { nonGenerating: string[]; unreachable: string[]; unusedTerminals: string[]; reduced: Grammar; empty: boolean } {
  const gen = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      if (gen.has(p.lhs)) continue;
      if (p.rhs.every((s) => !isNt(g, s) || gen.has(s))) { gen.add(p.lhs); changed = true; }
    }
  }
  const nonGenerating = g.nonterminals.filter((n) => !gen.has(n));
  const empty = !gen.has(g.start);
  const prods1 = g.productions.filter((p) => gen.has(p.lhs) && p.rhs.every((s) => !isNt(g, s) || gen.has(s)));
  const reach = new Set<string>([g.start]);
  const queue = [g.start];
  while (queue.length) {
    const a = queue.shift()!;
    for (const p of prods1) if (p.lhs === a) for (const s of p.rhs) if (!reach.has(s)) { reach.add(s); if (isNt(g, s)) queue.push(s); }
  }
  const unreachable = g.nonterminals.filter((n) => gen.has(n) && !reach.has(n));
  const unusedTerminals = g.terminals.filter((t) => !reach.has(t));
  const prods2 = prods1.filter((p) => reach.has(p.lhs));
  const reduced: Grammar = {
    start: g.start,
    nonterminals: g.nonterminals.filter((n) => reach.has(n) && gen.has(n)),
    terminals: g.terminals.filter((t) => reach.has(t)),
    productions: prods2,
    spaced: g.spaced,
  };
  if (empty) { reduced.nonterminals = [g.start]; reduced.terminals = []; reduced.productions = []; }
  return { nonGenerating, unreachable, unusedTerminals, reduced, empty };
}

// ---------------------------------------------------------------------------
// ε-removal, unit removal, Chomsky normal form
// ---------------------------------------------------------------------------

const key = (p: Production): string => p.lhs + "\u0001" + p.rhs.join("\u0001");

function dedupe(ps: Production[]): Production[] {
  const seen = new Set<string>();
  return ps.filter((p) => (seen.has(key(p)) ? false : (seen.add(key(p)), true)));
}

/** Removes A → ε for every A except (when the start is nullable) the start
 *  symbol itself, which keeps S → ε. The caller adds a fresh start first if
 *  the start occurs on a right-hand side. */
export function removeEpsilon(g: Grammar): { g: Grammar; nullable: string[] } {
  const nullable = nullableSet(g);
  const nul = new Set(nullable);
  const out: Production[] = [];
  for (const p of g.productions) {
    const idx = p.rhs.map((s, i) => (nul.has(s) ? i : -1)).filter((i) => i >= 0);
    if (idx.length > 10) throw new DiscreteError(`The production ${p.lhs} → ${showSeq(g, p.rhs, true)} has ${idx.length} nullable symbols; ε-removal would create 2^${idx.length} variants (the cap is 2^10).`);
    for (let mask = 0; mask < 1 << idx.length; mask++) {
      const rhs = p.rhs.filter((_, i) => { const k = idx.indexOf(i); return k < 0 || !(mask & (1 << k)); });
      if (!rhs.length && !(p.lhs === g.start)) continue;
      out.push({ lhs: p.lhs, rhs });
    }
    if (out.length > GRAMMAR_CAPS.expansion) throw new DiscreteError(`ε-removal produced more than ${GRAMMAR_CAPS.expansion} productions (the cap).`);
  }
  // S → ε survives only when S is nullable (then exactly once).
  const prods = dedupe(out).filter((p) => p.rhs.length || nul.has(p.lhs));
  return { g: { ...g, productions: prods }, nullable };
}

export function removeUnits(g: Grammar): { g: Grammar; cycles: string[][] } {
  const closure = new Map<string, string[]>();
  const cycles: string[][] = [];
  for (const A of g.nonterminals) {
    const seen = [A];
    const stack = [A];
    while (stack.length) {
      const B = stack.pop()!;
      for (const p of g.productions) {
        if (p.lhs !== B || p.rhs.length !== 1 || !isNt(g, p.rhs[0])) continue;
        const C = p.rhs[0];
        if (C === A && !cycles.some((c) => c.includes(A))) cycles.push([...seen, A]);
        if (!seen.includes(C)) { seen.push(C); stack.push(C); }
      }
    }
    closure.set(A, seen);
  }
  const out: Production[] = [];
  for (const A of g.nonterminals) {
    for (const B of closure.get(A)!) {
      for (const p of g.productions) {
        if (p.lhs !== B) continue;
        if (p.rhs.length === 1 && isNt(g, p.rhs[0])) continue;
        out.push({ lhs: A, rhs: p.rhs });
      }
    }
  }
  return { g: { ...g, productions: dedupe(out) }, cycles };
}

function freshName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) { taken.add(base); return base; }
  for (let i = 1; ; i++) {
    const n = base + sub(i);
    if (!taken.has(n)) { taken.add(n); return n; }
  }
}

export interface Cnf {
  g: Grammar;
  notes: string[];
  startNullable: boolean;
}

export function toCnf(src: Grammar): Cnf {
  const notes: string[] = [];
  const taken = new Set<string>([...src.nonterminals, ...src.terminals]);
  let g: Grammar = { ...src, productions: [...src.productions], nonterminals: [...src.nonterminals], terminals: [...src.terminals] };
  const nullable0 = new Set(nullableSet(src));
  // START
  const startOnRhs = src.productions.some((p) => p.rhs.includes(src.start));
  if (startOnRhs || nullable0.has(src.start)) {
    const s0 = freshName(src.start.startsWith("<") ? "<start>" : src.start.replace(/[′'₀-₉]+$/, "") + sub(0), taken);
    g = { ...g, start: s0, nonterminals: [s0, ...g.nonterminals], productions: [{ lhs: s0, rhs: [src.start] }, ...g.productions] };
    notes.push(`${s0} is the new start symbol (${s0} → ${src.start}), because ${src.start} ${startOnRhs ? "occurs on a right-hand side" : "is nullable"}`);
  }
  // TERM
  const termName = new Map<string, string>();
  const termProds: Production[] = [];
  const prods: Production[] = [];
  for (const p of g.productions) {
    if (p.rhs.length < 2) { prods.push(p); continue; }
    const rhs = p.rhs.map((s) => {
      if (isNt(g, s)) return s;
      let n = termName.get(s);
      if (!n) {
        n = /^[a-z]$/.test(s) && !taken.has(s.toUpperCase()) ? freshName(s.toUpperCase(), taken) : freshName("T" + sub(termName.size + 1), taken);
        termName.set(s, n);
        termProds.push({ lhs: n, rhs: [s] });
      }
      return n;
    });
    prods.push({ lhs: p.lhs, rhs });
  }
  g = { ...g, productions: [...prods, ...termProds], nonterminals: [...g.nonterminals, ...termProds.map((p) => p.lhs)] };
  const termNts = termProds.map((p) => p.lhs);
  if (termProds.length) notes.push("terminals in long productions get their own nonterminals: " + termProds.map((p) => `${p.lhs} → ${showSym(src, p.rhs[0], true)}`).join(", "));
  // DEL
  const del = removeEpsilon(g);
  const startNullable = del.nullable.includes(g.start);
  g = del.g;
  if (del.nullable.length) notes.push(`ε-productions removed (nullable: ${del.nullable.join(", ")})`);
  // UNIT
  const units = removeUnits(g);
  if (units.g.productions.length !== g.productions.length || g.productions.some((p) => p.rhs.length === 1 && isNt(g, p.rhs[0]))) notes.push("unit productions replaced by what they derive");
  g = units.g;
  // BIN (memoised by tail, so A S B and S₀'s copy share one X)
  const tailName = new Map<string, string>();
  const binProds: Production[] = [];
  const binned: Production[] = [];
  const newOrder: string[] = [];
  const cands = ["X", "Y", "Z", "W", "V", "U"];
  let candIdx = 0;
  const nameTail = (tail: string[]): string => {
    const k = tail.join("\u0001");
    let n = tailName.get(k);
    if (n) return n;
    while (candIdx < cands.length && taken.has(cands[candIdx])) candIdx++;
    n = candIdx < cands.length ? freshName(cands[candIdx], taken) : freshName("X" + sub(tailName.size + 1), taken);
    tailName.set(k, n);
    newOrder.push(n);
    return n;
  };
  for (const p of g.productions) {
    if (p.rhs.length <= 2) { binned.push(p); continue; }
    let lhs = p.lhs;
    const rhs = [...p.rhs];
    while (rhs.length > 2) {
      const head = rhs.shift()!;
      const n = nameTail(rhs);
      const prod = { lhs, rhs: [head, n] };
      if (lhs === p.lhs) binned.push(prod); else binProds.push(prod);
      lhs = n;
    }
    binProds.push({ lhs, rhs });
  }
  g = { ...g, productions: dedupe([...binned, ...binProds]), nonterminals: [...g.nonterminals.filter((n) => !termNts.includes(n)), ...newOrder, ...termNts] };
  if (newOrder.length) notes.push("long right-hand sides split with new nonterminals: " + newOrder.map((n) => `${n} → ${g.productions.filter((p) => p.lhs === n).map((p) => showSeq(g, p.rhs, true)).join(" | ")}`).join(", "));
  // ε first for the start symbol; drop nonterminals without productions.
  const ordered = [...g.productions.filter((p) => p.lhs === g.start && !p.rhs.length), ...g.productions.filter((p) => !(p.lhs === g.start && !p.rhs.length))];
  // Drop productions that use a non-generating nonterminal (one left with no way to
  // derive a terminal string, e.g. B → B B) — they derive nothing, so the language is
  // unchanged — and keep the start symbol even when the language is empty.
  const gen = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const p of ordered) if (!gen.has(p.lhs) && p.rhs.every((s) => !g.nonterminals.includes(s) || gen.has(s))) { gen.add(p.lhs); changed = true; }
  }
  const live = ordered.filter((p) => gen.has(p.lhs) && p.rhs.every((s) => !g.nonterminals.includes(s) || gen.has(s)));
  if (live.length !== ordered.length) notes.push(`productions using non-generating nonterminals dropped (${g.nonterminals.filter((n) => !gen.has(n) && ordered.some((p) => p.lhs === n || p.rhs.includes(n))).join(", ")} derive no terminal string)`);
  const used = new Set<string>([g.start, ...live.map((p) => p.lhs)]);
  g = { ...g, productions: live, nonterminals: g.nonterminals.filter((n) => used.has(n)), spaced: true };
  return { g, notes, startNullable };
}

// ---------------------------------------------------------------------------
// CYK over the CNF
// ---------------------------------------------------------------------------

export interface CykResult { accepted: boolean; table: string[][][] }

/** table[len-1][i] = the nonterminals deriving word[i .. i+len). */
export function cyk(cnf: Cnf, word: string[]): CykResult {
  const g = cnf.g;
  const n = word.length;
  if (n === 0) return { accepted: cnf.startNullable, table: [] };
  // Nonterminals by index; a cell is a membership byte array plus its member list.
  const m = g.nonterminals.length;
  const idx = new Map(g.nonterminals.map((nt, i) => [nt, i] as [string, number]));
  const unit = new Map<string, number[]>();
  const byLeft: number[][] = g.nonterminals.map(() => []); // flat (C, A) pairs per B
  const binLhs = new Set<number>();
  for (const p of g.productions) {
    if (p.rhs.length === 1) (unit.get(p.rhs[0]) ?? unit.set(p.rhs[0], []).get(p.rhs[0])!).push(idx.get(p.lhs)!);
    else if (p.rhs.length === 2) { byLeft[idx.get(p.rhs[0])!].push(idx.get(p.rhs[1])!, idx.get(p.lhs)!); binLhs.add(idx.get(p.lhs)!); }
  }
  interface Cell { has: Uint8Array; list: number[] }
  const T: Cell[][] = [];
  for (let len = 1; len <= n; len++) {
    T.push([]);
    for (let i = 0; i + len <= n; i++) {
      const cell: Cell = { has: new Uint8Array(m), list: [] };
      const add = (a: number): void => { if (!cell.has[a]) { cell.has[a] = 1; cell.list.push(a); } };
      if (len === 1) for (const a of unit.get(word[i]) ?? []) add(a);
      else {
        // Stop splitting once every binary left-hand side is in the cell.
        for (let k = 1; k < len && cell.list.length < binLhs.size; k++) {
          const L = T[k - 1][i];
          const R = T[len - k - 1][i + k];
          if (!L.list.length || !R.list.length) continue;
          for (const B of L.list) {
            const pairs = byLeft[B];
            for (let q = 0; q < pairs.length; q += 2) if (R.has[pairs[q]] && !cell.has[pairs[q + 1]]) add(pairs[q + 1]);
          }
        }
      }
      T[len - 1].push(cell);
    }
  }
  const table = T.map((row) => row.map((cell) => [...cell.list].sort((a, b) => a - b).map((a) => g.nonterminals[a])));
  return { accepted: T[n - 1][0].has[idx.get(g.start)!] === 1, table };
}

const cnfCache = new WeakMap<Grammar, Cnf>();
function cnfOf(g: Grammar): Cnf {
  let c = cnfCache.get(g);
  if (!c) { c = toCnf(g); cnfCache.set(g, c); }
  return c;
}

/** Membership by CYK over the (cached) Chomsky normal form. `word` is a list of terminal symbols. */
export function cykMember(g: Grammar, word: string[]): boolean {
  if (word.some((t) => !g.terminals.includes(t))) return false;
  return cyk(cnfOf(g), word).accepted;
}

// ---------------------------------------------------------------------------
// Direct parse of the ORIGINAL grammar: table + parse tree + leftmost derivation
// ---------------------------------------------------------------------------

export interface PNode { sym: string; kids?: PNode[] }

/** A parse tree of `word` in the original grammar, or null. Spans are
 *  decided by a monotone fixpoint over span length (dotted-rule items), so
 *  ε-rules, unit rules, cycles and left recursion all work; back-pointers
 *  always point at entries set earlier, so the tree is finite. */
export function parseAny(g: Grammar, word: string[]): PNode | null {
  const n = word.length;
  const W = n + 1;
  const ntIdx = new Map(g.nonterminals.map((nt, i) => [nt, i] as [string, number]));
  const tab = g.nonterminals.map(() => new Int32Array(W * W));
  const items = g.productions.map((p) => p.rhs.map(() => new Int32Array(W * W)));
  // Symbols as integers: a nonterminal is its index ≥ 0; a terminal is −1 − (its
  // index in the terminal list), compared against the word pre-mapped the same way.
  const tIdx = new Map(g.terminals.map((t, i) => [t, i] as [string, number]));
  const code = (X: string): number => { const a = ntIdx.get(X); return a !== undefined ? a : -1 - (tIdx.get(X) ?? 1e6); };
  const wordCode = word.map((t) => -1 - (tIdx.get(t) ?? 2e6));
  const rhsCode = g.productions.map((p) => p.rhs.map(code));
  const lhsCode = g.productions.map((p) => ntIdx.get(p.lhs)!);
  const prodsWith: number[][] = g.nonterminals.map(() => []);
  rhsCode.forEach((rc, pi) => { for (const X of new Set(rc)) if (X >= 0) prodsWith[X].push(pi); });
  // ends[pi][q][i] = the j for which item (pi, q) spans (i, j), in the order set.
  const ends = g.productions.map((p) => p.rhs.map(() => Array.from({ length: W }, () => [] as number[])));
  const P = g.productions.length;
  const queue: number[] = [];
  for (let len = 0; len <= n; len++) {
    for (let i = 0; i + len <= n; i++) {
      const j = i + len;
      const cell = i * W + j;
      // Worklist. The first sweep tries every production at every split point.
      // Afterwards the only thing that can change inside this cell is a
      // nonterminal newly spanning (i, j), so only the productions mentioning it
      // are revisited, and only at m = i and m = j (every other split reads
      // strictly shorter, finished cells). Items of one production depend on
      // each other in q order, which one ascending sweep covers.
      // queue holds production indices: first every production (full = true),
      // then those mentioning a nonterminal newly set in this cell.
      queue.length = 0;
      for (let pi = 0; pi < P; pi++) queue.push(pi);
      for (let qi = 0; qi < queue.length; qi++) {
        const pi = queue[qi];
        const full = qi < P;
        const A = lhsCode[pi];
        const rc = rhsCode[pi];
        const k = rc.length;
        let set = false;
        if (k === 0) {
          if (len === 0 && !tab[A][cell]) { tab[A][cell] = pi + 1; set = true; }
        } else {
          const its = items[pi];
          const rows = ends[pi];
          for (let q = 0; q < k; q++) {
            const it = its[q];
            if (it[cell]) continue;
            if (q === 0) {
              const X0 = rc[0];
              if (X0 >= 0 ? tab[X0][cell] !== 0 : len === 1 && wordCode[i] === X0) { it[cell] = 1; rows[0][i].push(j); }
              continue;
            }
            const prevRow = rows[q - 1][i];
            if (!prevRow.length) break; // the prefix never holds from i: nothing later can
            const prev = its[q - 1];
            const X = rc[q];
            if (X < 0) { // a terminal spans exactly (j − 1, j)
              if (j > i && prev[i * W + j - 1] && wordCode[j - 1] === X) { it[cell] = j; rows[q][i].push(j); }
              continue;
            }
            const tX = tab[X];
            if (full) {
              // Only the ends m where the prefix item holds (all ≤ j: longer cells come later).
              for (let r = 0; r < prevRow.length; r++) { const m = prevRow[r]; if (tX[m * W + j]) { it[cell] = m + 1; rows[q][i].push(j); break; } }
            } else if (prev[i * W + i] && tX[cell]) { it[cell] = i + 1; rows[q][i].push(j); }
            else if (prev[cell] && tX[j * W + j]) { it[cell] = j + 1; rows[q][i].push(j); }
          }
          if (its[k - 1][cell] && !tab[A][cell]) { tab[A][cell] = pi + 1; set = true; }
        }
        if (set) for (const pj of prodsWith[A]) queue.push(pj);
      }
    }
  }
  const S = ntIdx.get(g.start)!;
  if (!tab[S][0 * W + n]) return null;
  const build = (A: number, i: number, j: number): PNode => {
    const pi = tab[A][i * W + j] - 1;
    const p = g.productions[pi];
    const k = p.rhs.length;
    const node: PNode = { sym: p.lhs, kids: [] };
    if (k === 0) { node.kids!.push({ sym: EPS }); return node; }
    const pos = new Array<number>(k + 1);
    pos[k] = j;
    pos[0] = i;
    for (let q = k - 1; q >= 1; q--) pos[q] = items[pi][q][i * W + pos[q + 1]] - 1;
    for (let q = 0; q < k; q++) {
      const X = p.rhs[q];
      const a = ntIdx.get(X);
      node.kids!.push(a === undefined ? { sym: X } : build(a, pos[q], pos[q + 1]));
    }
    return node;
  };
  return build(S, 0, n);
}

/** Leftmost derivation as a list of sentential forms, read off the tree in preorder. */
export function derivationOf(g: Grammar, tree: PNode): string[][] {
  const forms: string[][] = [[tree.sym]];
  let form = [tree.sym];
  const stack: PNode[] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (!node.kids) continue;
    const at = form.findIndex((s) => isNt(g, s));
    const children = node.kids.filter((k) => k.sym !== EPS || k.kids).map((k) => k.sym);
    form = [...form.slice(0, at), ...children, ...form.slice(at + 1)];
    forms.push(form);
    for (let i = node.kids.length - 1; i >= 0; i--) stack.push(node.kids[i]);
  }
  return forms;
}

/** Grammar-symbol nodes of a parse tree; the ε leaves (drawn, labelled ε) are counted separately. */
export function countNodes(tree: PNode): { symbols: number; epsLeaves: number } {
  let symbols = 0, epsLeaves = 0;
  const stack = [tree];
  while (stack.length) {
    const t = stack.pop()!;
    if (t.sym === EPS && !t.kids) epsLeaves++; else symbols++;
    for (const k of t.kids ?? []) stack.push(k);
  }
  return { symbols, epsLeaves };
}

const nodesText = (c: { symbols: number; epsLeaves: number }): string => `${c.symbols} node${c.symbols === 1 ? "" : "s"}${c.epsLeaves ? ` + ${c.epsLeaves} ε-leaf${c.epsLeaves === 1 ? "" : "s"}` : ""}`;

function treeSpec(g: Grammar, tree: PNode, prefix: string, nodes: TreeNode[], edges: TreeEdge[]): void {
  let id = 0;
  const stack: { node: PNode; parent: string | null }[] = [{ node: tree, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    const my = prefix + id++;
    nodes.push({ id: my, label: node.sym === EPS ? EPS : showSym(g, node.sym, true).replace(/^"(.*)"$/, "$1") });
    if (parent) edges.push({ from: parent, to: my });
    const kids = node.kids ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], parent: my });
  }
}

// ---------------------------------------------------------------------------
// Brute force: leftmost sentential forms, breadth first (the cross-check)
// ---------------------------------------------------------------------------

interface Form { syms: string[]; parent: number; prod: number }

/** Builds the parse tree of a leftmost derivation given as production indices. */
function treeFromDerivation(g: Grammar, prods: number[]): PNode {
  const root: PNode = { sym: g.start, kids: [] };
  const pending: PNode[] = [root];
  for (const pi of prods) {
    const node = pending.shift()!;
    const p = g.productions[pi];
    node.kids = p.rhs.length ? p.rhs.map((s) => (isNt(g, s) ? { sym: s, kids: [] } : { sym: s })) : [{ sym: EPS }];
    const ntKids = node.kids.filter((k) => k.kids);
    pending.unshift(...ntKids);
  }
  return root;
}

function derivationIndices(forms: Form[], end: number): number[] {
  const out: number[] = [];
  for (let i = end; forms[i].parent >= 0; i = forms[i].parent) out.push(forms[i].prod);
  return out.reverse();
}

export interface BruteResult { verdict: boolean | null; forms: number; prods?: number[] }

/** Membership by enumeration of leftmost sentential forms with terminal-prefix
 *  pruning and the form budget. verdict null = budget exhausted (inconclusive). */
export function bruteMember(g: Grammar, word: string[], budget: number = GRAMMAR_CAPS.enumBudget): BruteResult {
  const nul = new Set(nullableSet(g));
  const forms: Form[] = [{ syms: [g.start], parent: -1, prod: -1 }];
  const seen = new Set<string>([g.start]);
  let head = 0;
  while (head < forms.length) {
    const f = forms[head];
    const at = f.syms.findIndex((s) => isNt(g, s));
    if (at < 0) {
      if (f.syms.length === word.length && f.syms.every((s, i) => s === word[i])) return { verdict: true, forms: forms.length, prods: derivationIndices(forms, head) };
      head++;
      continue;
    }
    const A = f.syms[at];
    for (let pi = 0; pi < g.productions.length; pi++) {
      const p = g.productions[pi];
      if (p.lhs !== A) continue;
      const syms = [...f.syms.slice(0, at), ...p.rhs, ...f.syms.slice(at + 1)];
      // Prune: terminal prefix must match; terminals + non-nullable nonterminals ≤ |word|.
      let ok = true;
      let minLen = 0;
      for (let i = 0; i < syms.length && ok; i++) {
        const s = syms[i];
        if (isNt(g, s)) { if (!nul.has(s)) minLen++; }
        else { minLen++; if (i === 0 || !syms.slice(0, i).some((x) => isNt(g, x))) { if (word[i] !== s) ok = false; } }
      }
      if (!ok || minLen > word.length) continue;
      const k = syms.join("\u0001");
      if (seen.has(k)) continue;
      seen.add(k);
      forms.push({ syms, parent: head, prod: pi });
      if (forms.length >= budget) return { verdict: null, forms: forms.length };
    }
    head++;
  }
  return { verdict: false, forms: forms.length };
}

export interface AmbiguityResult {
  complete: boolean;
  forms: number;
  witness?: { word: string[]; count: number; trees: PNode[] };
  others: { word: string[]; count: number }[];
}

/** Searches for a string with two distinct leftmost derivations (= two parse
 *  trees) of length ≤ maxLen within the form budget. Derivations are NOT
 *  deduplicated, so each parse tree is reached exactly once. */
export function ambiguitySearch(g: Grammar, maxLen: number = GRAMMAR_CAPS.ambiguityLength, budget: number = GRAMMAR_CAPS.enumBudget): AmbiguityResult {
  const nul = new Set(nullableSet(g));
  const forms: Form[] = [{ syms: [g.start], parent: -1, prod: -1 }];
  const words = new Map<string, { word: string[]; count: number; ends: number[] }>();
  let head = 0;
  let complete = true;
  outer: while (head < forms.length) {
    const f = forms[head];
    const at = f.syms.findIndex((s) => isNt(g, s));
    if (at < 0) {
      const k = f.syms.join("\u0001");
      const w = words.get(k) ?? words.set(k, { word: f.syms, count: 0, ends: [] }).get(k)!;
      // Two DISTINCT leftmost derivations (as production sequences) — never the same one twice.
      const seq = derivationIndices(forms, head).join(",");
      if (!w.ends.some((e) => derivationIndices(forms, e).join(",") === seq)) {
        w.count++;
        if (w.ends.length < 2) w.ends.push(head);
      }
      head++;
      continue;
    }
    const A = f.syms[at];
    for (let pi = 0; pi < g.productions.length; pi++) {
      const p = g.productions[pi];
      if (p.lhs !== A) continue;
      const syms = [...f.syms.slice(0, at), ...p.rhs, ...f.syms.slice(at + 1)];
      let minLen = 0;
      for (const s of syms) if (!isNt(g, s) || !nul.has(s)) minLen++;
      if (minLen > maxLen) continue;
      forms.push({ syms, parent: head, prod: pi });
      if (forms.length >= budget) { complete = false; break outer; }
    }
    head++;
  }
  const amb = [...words.values()].filter((w) => w.count >= 2).sort((a, b) => a.word.length - b.word.length || a.ends[0] - b.ends[0]);
  const result: AmbiguityResult = { complete, forms: forms.length, others: amb.slice(1).map((w) => ({ word: w.word, count: w.count })) };
  if (amb.length) {
    const w = amb[0];
    result.witness = { word: w.word, count: w.count, trees: w.ends.map((e) => treeFromDerivation(g, derivationIndices(forms, e))) };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Left recursion (Paull's algorithm, Aho–Ullman 4.3.3)
// ---------------------------------------------------------------------------

export function leftRecursion(g0: Grammar): { g: Grammar; notes: string[]; recursive: string[]; changed: boolean } {
  const notes: string[] = [];
  // Detect: A ⇒+ A… through leading (nullable-skipping) nonterminals.
  const nul = new Set(nullableSet(g0));
  const leads = new Map<string, Set<string>>();
  for (const A of g0.nonterminals) leads.set(A, new Set());
  for (const p of g0.productions) {
    for (const s of p.rhs) {
      if (!isNt(g0, s)) break;
      leads.get(p.lhs)!.add(s);
      if (!nul.has(s)) break;
    }
  }
  const reach = new Map<string, Set<string>>();
  for (const A of g0.nonterminals) {
    const seen = new Set<string>();
    const stack = [...leads.get(A)!];
    while (stack.length) { const B = stack.pop()!; if (seen.has(B)) continue; seen.add(B); for (const C of leads.get(B)!) stack.push(C); }
    reach.set(A, seen);
  }
  const recursive = g0.nonterminals.filter((A) => reach.get(A)!.has(A));
  if (!recursive.length) return { g: g0, notes: ["no left recursion: no nonterminal A derives A… as a leftmost symbol"], recursive, changed: false };
  for (const A of recursive) {
    const direct = g0.productions.some((p) => p.lhs === A && p.rhs[0] === A);
    notes.push(`${A} is ${direct ? "immediately" : "indirectly"} left-recursive${direct ? ` (${A} → ${showSeq(g0, g0.productions.find((p) => p.lhs === A && p.rhs[0] === A)!.rhs, printMode(g0))})` : ""}`);
  }
  // Preconditions: no ε-productions (removed first, said), no unit cycles (refused).
  let g = g0;
  if (g.productions.some((p) => !p.rhs.length)) {
    const startOnRhs = g.productions.some((p) => p.rhs.includes(g.start));
    if (startOnRhs && nul.has(g.start)) {
      const taken = new Set([...g.nonterminals, ...g.terminals]);
      const s0 = freshName(g.start.replace(/[′'₀-₉]+$/, "") + sub(0), taken);
      g = { ...g, start: s0, nonterminals: [s0, ...g.nonterminals], productions: [{ lhs: s0, rhs: [g.start] }, ...g.productions] };
    }
    g = removeEpsilon(g).g;
    notes.push("ε-productions removed first (Paull's algorithm assumes none): " + printGrammar(g).join(", "));
  }
  const units = removeUnits(g);
  if (units.cycles.length) throw new DiscreteError(`The grammar has a cycle ${units.cycles[0].join(" ⇒ ")}; left-recursion removal (Paull's algorithm) assumes no cycles — remove unit productions first (cnf shows the unit-free form).`);
  const order = g.nonterminals.filter((n) => g.productions.some((p) => p.lhs === n));
  const taken = new Set([...g.nonterminals, ...g.terminals]);
  let prods = [...g.productions];
  const newNts: string[] = [];
  const insertAfter = new Map<string, string>();
  for (let i = 0; i < order.length; i++) {
    const Ai = order[i];
    for (let j = 0; j < i; j++) {
      const Aj = order[j];
      const next: Production[] = [];
      let substituted = false;
      for (const p of prods) {
        if (p.lhs === Ai && p.rhs[0] === Aj) {
          substituted = true;
          for (const q of prods) if (q.lhs === Aj) next.push({ lhs: Ai, rhs: [...q.rhs, ...p.rhs.slice(1)] });
        } else next.push(p);
      }
      if (substituted) {
        prods = dedupe(next);
        notes.push(`${Ai} → ${Aj}… replaced by ${Aj}'s alternatives: ${Ai} → ${prods.filter((p) => p.lhs === Ai).map((p) => showSeq(g, p.rhs, printMode(g))).join(" | ")}`);
      }
      if (prods.length > GRAMMAR_CAPS.expansion) throw new DiscreteError(`Left-recursion removal produced more than ${GRAMMAR_CAPS.expansion} productions (the cap).`);
    }
    const mine = prods.filter((p) => p.lhs === Ai);
    const alphas = mine.filter((p) => p.rhs[0] === Ai).map((p) => p.rhs.slice(1));
    if (!alphas.length) continue;
    const betas = mine.filter((p) => p.rhs[0] !== Ai).map((p) => p.rhs);
    const Ap = freshName(Ai.replace(/>$/, "'>").replace(/^([^<].*)$/, "$1'"), taken);
    newNts.push(Ap);
    insertAfter.set(Ai, Ap);
    const rest = prods.filter((p) => p.lhs !== Ai);
    const fresh: Production[] = betas.map((b) => ({ lhs: Ai, rhs: [...b, Ap] }));
    for (const a of alphas) fresh.push({ lhs: Ap, rhs: [...a, Ap] });
    fresh.push({ lhs: Ap, rhs: [] });
    prods = [...rest, ...fresh];
    if (!betas.length) notes.push(`${Ai} has only left-recursive alternatives — it derives no terminal string; ${Ai} now has no productions`);
    const view: Grammar = { ...g, nonterminals: [...g.nonterminals, ...newNts] };
    const pm = printMode(view);
    const sq = (xs: string[]): string => showSeq(view, xs, pm);
    notes.push(`${Ai}: ${Ai} → ${[...alphas.map((a) => sq([Ai, ...a])), ...betas.map(sq)].join(" | ")} becomes ${Ai} → ${betas.map((b) => sq([...b, Ap])).join(" | ") || "(nothing)"}, ${Ap} → ${alphas.map((a) => sq([...a, Ap])).join(" | ")} | ε (new name ${Ap})`);
  }
  // Order: each A' right after its A; a nonterminal left without productions is dropped.
  const nts: string[] = [];
  for (const n of g.nonterminals) { nts.push(n); const ap = insertAfter.get(n); if (ap) nts.push(ap); }
  const ordered: Production[] = [];
  for (const n of nts) for (const p of prods) if (p.lhs === n) ordered.push(p);
  const out: Grammar = { ...g, nonterminals: nts, productions: ordered, spaced: g.spaced };
  return { g: out, notes, recursive, changed: true };
}

// ---------------------------------------------------------------------------
// Equivalence sample (refused by name — undecidable)
// ---------------------------------------------------------------------------

function sampleEquivalence(a: Grammar, b: Grammar): { alphabet: string[]; maxLen: number; count: number; witness?: { word: string[]; first: boolean } } {
  const alphabet = [...a.terminals];
  for (const t of b.terminals) if (!alphabet.includes(t)) alphabet.push(t);
  let maxLen = GRAMMAR_CAPS.sampleLength;
  const total = (L: number): number => { let s = 0, p = 1; for (let l = 0; l <= L; l++) { s += p; p *= Math.max(1, alphabet.length); } return s; };
  while (maxLen > 0 && total(maxLen) > GRAMMAR_CAPS.sampleStrings) maxLen--;
  let count = 0;
  let queue: string[][] = [[]];
  for (let len = 0; len <= maxLen; len++) {
    for (const w of queue) {
      count++;
      const x = cykMember(a, w), y = cykMember(b, w);
      if (x !== y) return { alphabet, maxLen, count, witness: { word: w, first: x } };
    }
    if (len === maxLen) break;
    const next: string[][] = [];
    for (const w of queue) for (const t of alphabet) next.push([...w, t]);
    queue = next;
  }
  return { alphabet, maxLen, count };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const CAP_CAVEAT = `Caps: ≤ ${GRAMMAR_CAPS.nonterminals} nonterminals, ≤ ${GRAMMAR_CAPS.productions} productions of ≤ ${GRAMMAR_CAPS.rhsLength} symbols each, ≤ ${GRAMMAR_CAPS.testCount} test strings of ≤ ${GRAMMAR_CAPS.testLength} symbols; the brute-force cross-check runs on strings of ≤ ${GRAMMAR_CAPS.crossCheckLength} symbols within ${GRAMMAR_CAPS.enumBudget.toLocaleString("en-US")} sentential forms each and ${GRAMMAR_CAPS.crossCheckTotal.toLocaleString("en-US")} in all; ≤ ${GRAMMAR_CAPS.parseWork.toLocaleString("en-US")} estimated parse steps per request (strings beyond it are listed as not checked); the ambiguity search tries strings of length ≤ ${GRAMMAR_CAPS.ambiguityLength} within ${GRAMMAR_CAPS.enumBudget.toLocaleString("en-US")} forms; equivalence samples strings of length ≤ ${GRAMMAR_CAPS.sampleLength}.`;

/** Has the block a terminal, an ε, or a `|` on a production line? (A pure
 *  `A -> B` list is a graph; `A -> B 5` is a weighted edge.) */
function terminalEvidence(raws: RawProduction[]): boolean {
  for (const r of raws) {
    for (const alt of r.alts) {
      if (/^[A-Za-z_][A-Za-z0-9_']*\s+-?\d+(?:\.\d+)?$/.test(alt)) continue; // NAME weight
      if (alt === "") return true;
      for (const ch of chunksOf(alt)) {
        if (ch.kind === "quoted") return true;
        if (ch.kind === "angle") continue;
        if (isEpsWord(ch.text)) return true;
        for (const c of ch.text) if (!isUpper(c) && !isNtTail(c)) return true;
      }
    }
  }
  return false;
}

function formulaShaped(rhs: string): boolean {
  const bare = rhs.replace(/"[^"\n]*"/g, " ").replace(/<[^<>\n]+>/g, " ");
  if (/->|→|=>/.test(bare)) return true;
  if (/^>/.test(rhs)) return true; // "A ->> B": a malformed arrow, not a production with terminal >

  let depth = 0;
  for (const c of bare) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "|" && depth > 0) return true;
  }
  return false;
}

function plural(n: number, word: string): string { return `${n} ${word}${n === 1 ? "" : "s"}`; }

export function solveGrammar(text: string): DiscreteResult | null {
  const src = text.replace(/\r/g, "");
  if (!GRAMMAR_RE.test(src)) return null;
  // A block led by a machine keyword belongs to that engine (NFA → DFA …, tm …, pda …).
  if (MACHINE_KEYWORD.test(src)) return null;
  if (src.length > GRAMMAR_CAPS.inputChars) throw new DiscreteError(`The grammar request is ${src.length.toLocaleString("en-US")} characters; the cap is ${GRAMMAR_CAPS.inputChars.toLocaleString("en-US")}.`);
  let read: ReturnType<typeof readLines>;
  try {
    read = readLines(src);
  } catch (e) {
    if (e instanceof DiscreteError) throw e;
    throw new DiscreteError(`Could not read that grammar: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!read) return null;
  if (read.logic) return null; // a logic connective outside quotes: proplogic's line
  // "cfg to pda" belongs to the pushdown engine (which calls parseGrammar itself) —
  // exactly where pda.ts claims it: a first line "(cfg) to pda …" or a last line
  // "(cfg) to pda". Anywhere else the question is refused by name in answer().
  {
    const nonEmpty = src.split("\n").map((l) => l.trim()).filter((l) => l);
    if (TO_PDA_FIRST.test(nonEmpty[0]) || (nonEmpty.length > 1 && TO_PDA_LAST.test(nonEmpty[nonEmpty.length - 1]))) return null;
  }
  if (!read.equivParts) {
    // Tie-break (SCOPE §E.1): grammar vs edge list (graph) vs formula (logic).
    const cue = HEAD_LINE.test(src) || read.questions.length > 0 || src.includes("::=") || read.raws.some((r) => r.lhs.startsWith("<"));
    const bar = read.raws.some((r) => r.alts.length > 1);
    const terminal = terminalEvidence(read.raws);
    // No terminal and no ε anywhere: A -> B ⏎ B -> C is an edge list, P -> Q | R a formula.
    // A grammar without a single terminal derives nothing; only an explicit head claims one.
    if (!terminal && !(HEAD_LINE.test(src) || src.includes("::=") || read.raws.some((r) => r.lhs.startsWith("<")))) return null;
    // Uppercase formulas: a second arrow (P -> Q -> R, P -> (Q -> R)) or a | inside
    // parentheses (P -> (Q | R)) is implication/disjunction, not a production.
    if (!cue && read.raws.some((r) => formulaShaped(r.alts.join("|")))) return null;
    const strong = cue || bar || read.raws.some((r) => r.alts.some((a) => a === "" || a.includes('"') || a.split(/\s+/).some(isEpsWord)));
    // A line that is neither a production nor a question: an edge list (A -> b ⏎ b -> C)
    // unless the block is unmistakably a grammar, which then refuses the line by name.
    if (read.unknown.length && !strong) return null;
    // Without a strong cue, multi-letter left-hand sides (Alice -> bob) are vertex names.
    if (!strong && read.raws.some((r) => /[a-z]/.test(r.lhs))) return null;
    // X1 -> X2 ⏎ X2 -> X3, S1 -> S2: every side one identifier with a digit suffix —
    // vertex names (graph) or propositional variables (logic), not "X followed by 3".
    const ident = /^[A-Za-z][A-Za-z0-9_]*$/;
    const digitName = /^[A-Z][A-Za-z]*\d+$/;
    if (!strong && read.raws.every((r) => ident.test(r.lhs) && r.alts.every((a) => ident.test(a)))
      && read.raws.some((r) => digitName.test(r.lhs) || r.alts.some((a) => digitName.test(a)))) return null;
  }
  try {
    return answer(read);
  } catch (e) {
    if (e instanceof DiscreteError) throw e;
    if (e instanceof RangeError) throw new DiscreteError("That grammar request nests too deeply to process.");
    throw new DiscreteError(`Could not answer that grammar request: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function answer(read: NonNullable<ReturnType<typeof readLines>>): DiscreteResult {
  if (read.equivParts) return answerEquivalent(read.equivParts[0], read.equivParts[1]);
  if (read.unknown.length) {
    throw new DiscreteError(`Line "${read.unknown[0]}" is neither a production (LHS -> alternatives) nor a question — questions: test: aabb ab · member aabb · cnf · cyk aabb · derivation of aabb · parse tree for aabb · ambiguous? · first and follow · nullable · useless symbols · remove left recursion · equivalent.`);
  }
  const g = buildGrammar(read.raws);
  const questions = read.questions;
  const spaced = printMode(g);
  const title = `Context-free grammar — ${plural(g.nonterminals.length, "nonterminal")}, ${plural(g.productions.length, "production")} over ${showTerminalSet(g, g.terminals)}`;
  const display: string[] = [...printGrammar(g)];
  for (const n of g.notes ?? []) display.push(`Note: ${n}.`);
  const steps: string[] = [];
  const caveats: string[] = [];
  let svg: string | undefined;
  let alt: string | undefined;
  const setFigure = (s: string, a: string): void => { if (!svg) { svg = s; alt = a; } };

  // Tests.
  const tests: string[] = [];
  for (const q of questions) if (q.kind === "test") tests.push(...q.args);
  const wantsTests = questions.some((q) => q.kind === "test");
  if (wantsTests && !tests.length) throw new DiscreteError("The test line names no string — write test: aabb ab (use \"\" or ε for the empty string).");
  if (tests.length > GRAMMAR_CAPS.testCount) throw new DiscreteError(`${tests.length} test strings exceed the cap of ${GRAMMAR_CAPS.testCount}.`);
  const words: { text: string; segs?: string[][]; capped?: boolean; bad?: string }[] = tests.map((t) => {
    if (t.length > GRAMMAR_CAPS.testLength * 20) throw new DiscreteError(`Test string "${t.slice(0, 20)}…" is ${t.length} characters; the cap is ${GRAMMAR_CAPS.testLength} symbols.`);
    const sw = segmentWord(g, t);
    if ("bad" in sw) return { text: t, bad: sw.bad };
    const longest = Math.max(...sw.segs.map((s) => s.length));
    if (longest > GRAMMAR_CAPS.testLength) throw new DiscreteError(`Test string "${t.slice(0, 20)}…" is ${longest} symbols; the cap is ${GRAMMAR_CAPS.testLength}.`);
    return { text: t, segs: sw.segs, capped: sw.capped };
  });

  const wantsCnf = questions.some((q) => q.kind === "cnf");
  let cnf: Cnf | null = null;
  if (wantsCnf || tests.length) {
    cnf = cnfOf(g);
    const lines = printGrammar(cnf.g, true);
    const target = wantsCnf ? display : steps;
    target.push(`Chomsky normal form (${plural(cnf.g.productions.length, "production")}):`);
    for (const l of lines) target.push("  " + l);
    if (cnf.notes.length) target.push("  New names: " + cnf.notes.join("; "));
    if (cnf.startNullable) target.push(`  ${cnf.g.start} → ε is kept: the start symbol is nullable (ε is in the language).`);
  }

  if (tests.length) {
    const done = new Map<string, string>();
    let bruteLeft = GRAMMAR_CAPS.crossCheckTotal;
    // Deterministic work estimate per string, checked BEFORE parsing it:
    // CYK is n³/6 × binary rules, the direct parse at most n³/6 × items.
    const binRules = cnf!.g.productions.filter((p) => p.rhs.length === 2).length;
    const itemCount = g.productions.reduce((s, p) => s + p.rhs.length, 0);
    let workUsed = 0;
    const unchecked: string[] = [];
    for (const w of words) {
      if (unchecked.length) { unchecked.push(w.text === "" ? '""' : w.text); continue; }
      if (w.segs) {
        let est = 0;
        for (const s of w.segs) { const n = s.length; est += Math.ceil(((n * n * n) / 6) * (binRules + itemCount)); }
        if (!done.has(w.segs[0].join("\u0001")) && workUsed + est > GRAMMAR_CAPS.parseWork) { unchecked.push(w.text === "" ? '""' : w.text); continue; }
        workUsed += est;
      }
      if (w.bad !== undefined) {
        display.push(`${w.text === "" ? '""' : w.text} — rejected: not a string over the terminals ("${w.bad}" cannot be read as part of any terminal of this grammar)`);
        continue;
      }
      // Several readings into terminals: the string is in the language when ANY is.
      const segs = w.segs!;
      let word = segs[0];
      if (segs.length > 1) {
        const hit = segs.find((s) => cyk(cnf!, s).accepted);
        const readings = segs.map((s) => s.join("·")).join(", ");
        if (hit) word = hit;
        else {
          // every reading rejected: confirm each with the direct parse too
          for (const s of segs) if (parseAny(g, s) !== null) throw new DiscreteError(`Internal cross-check failed on the reading ${s.join("·")}: CYK rejects it, the direct parse accepts it — refusing to report either.`);
          if (w.capped) {
            display.push(`${w.text} — UNKNOWN: it has more than ${GRAMMAR_CAPS.segmentations} readings into terminals and none of the first ${GRAMMAR_CAPS.segmentations} is in the language (the rest were not tried)`);
            continue;
          }
        }
        steps.push(`${w.text} reads into terminals ${segs.length} ways${w.capped ? ` (first ${GRAMMAR_CAPS.segmentations} tried)` : ""}: ${readings} — ${hit ? `accepted as ${hit.join("·")}` : "every reading is rejected"}.`);
      }
      // Shown as typed when the typed text reads back to this word (every reading is tried on input).
      const shown = word.length && word.join("") === w.text ? w.text : showWord(g, word);
      const memo = done.get(word.join("\u0001"));
      if (memo) { display.push(`${memo} (repeated test string)`); continue; }
      const c = cyk(cnf!, word);
      const tree = parseAny(g, word);
      const direct = tree !== null;
      if (c.accepted !== direct) throw new DiscreteError(`Internal cross-check failed on ${shown}: CYK over the CNF says ${c.accepted ? "accepted" : "rejected"}, the direct parse of the original grammar says ${direct ? "accepted" : "rejected"} — refusing to report either.`);
      let brute = "";
      done.set(word.join("\u0001"), `${shown} — ${c.accepted ? "accepted" : "rejected"}`);
      if (word.length <= GRAMMAR_CAPS.crossCheckLength && bruteLeft < 1) {
        brute = `brute-force cross-check skipped: the total budget of ${GRAMMAR_CAPS.crossCheckTotal.toLocaleString("en-US")} sentential forms across all test strings is used up (CYK and the direct parse still agree)`;
      } else if (word.length <= GRAMMAR_CAPS.crossCheckLength) {
        const budget = Math.min(GRAMMAR_CAPS.enumBudget, bruteLeft);
        const b = bruteMember(g, word, budget);
        bruteLeft -= b.forms;
        if (b.verdict === null) brute = `brute-force derivation search exhausted its ${budget.toLocaleString("en-US")}-form budget — inconclusive, no disagreement`;
        else if (b.verdict !== c.accepted) throw new DiscreteError(`Internal cross-check failed on ${shown}: CYK says ${c.accepted ? "accepted" : "rejected"} but the brute-force derivation search says ${b.verdict ? "accepted" : "rejected"} — refusing to report either.`);
        else brute = `brute-force derivation search agrees (${b.forms.toLocaleString("en-US")} sentential forms)`;
      } else brute = `brute-force cross-check skipped (longer than ${GRAMMAR_CAPS.crossCheckLength} symbols)`;
      // Verdict + derivation.
      if (tree) {
        const forms = derivationOf(g, tree);
        const nodes = countNodes(tree);
        display.push(`${shown} — accepted${word.length === 0 ? " (the start symbol is nullable)" : ""}`);
        const shownForms = forms.map((f) => showSeq(g, f, spaced));
        const MAX_STEPS = 60;
        display.push("  " + (shownForms.length > MAX_STEPS + 1 ? [...shownForms.slice(0, MAX_STEPS), `… (${forms.length - 1} steps in all)`, shownForms[shownForms.length - 1]] : shownForms).join(" ⇒ "));
        steps.push(`${shown}: leftmost derivation in ${plural(forms.length - 1, "step")}; parse tree with ${nodesText(nodes)}.`);
        const nodesSpec: TreeNode[] = [];
        const edgesSpec: TreeEdge[] = [];
        treeSpec(g, tree, "n", nodesSpec, edgesSpec);
        setFigure(treeSvg({ nodes: nodesSpec, edges: edgesSpec, caption: `parse tree of ${shown} (${nodesText(nodes)})` }), `Parse tree of ${shown} in the grammar ${printGrammar(g).join("; ")}: ${nodesText(nodes)}, leftmost derivation ${shownForms.join(" ⇒ ")}.`);
      } else {
        display.push(`${shown} — rejected`);
      }
      // CYK grid.
      if (word.length > GRAMMAR_CAPS.crossCheckLength) {
        steps.push(`CYK for ${shown}: ${cnf!.g.start} ${c.accepted ? "∈" : "∉"} the top cell → ${c.accepted ? "accepted" : "rejected"} (the ${word.length}-row table is not printed; tables are printed for strings of ≤ ${GRAMMAR_CAPS.crossCheckLength} symbols)`);
      } else if (word.length) {
        steps.push(`CYK table for ${shown} (row = span length, column = start position):`);
        c.table.forEach((row, i) => steps.push(`  len ${i + 1}: ${row.map((cell) => (cell.length ? `{${cell.join(",")}}` : "∅")).join(" ")}`));
        steps.push(`  ${cnf!.g.start} ${c.accepted ? "∈" : "∉"} the top cell → ${c.accepted ? "accepted" : "rejected"}`);
      } else steps.push(`CYK for the empty string: ${cnf!.g.start} ${c.accepted ? "→ ε is a production — accepted" : "→ ε is not a production — rejected"}`);
      steps.push(`  cross-check ${shown}: ${brute}.`);
    }
    if (unchecked.length) {
      display.push(`Not checked (work cap of ${GRAMMAR_CAPS.parseWork.toLocaleString("en-US")} parse steps for one request reached): ${unchecked.join(" ")} — no verdict is given for ${unchecked.length === 1 ? "it" : "them"}; test fewer or shorter strings at once.`);
    }
  }

  // Ambiguity.
  if (questions.some((q) => q.kind === "ambiguous")) {
    const r = ambiguitySearch(g);
    const budgetNote = r.complete ? "" : ` (the ${GRAMMAR_CAPS.enumBudget.toLocaleString("en-US")}-form search budget was exhausted, so counts are lower bounds)`;
    if (r.witness) {
      const w = showWord(g, r.witness.word);
      display.push(`AMBIGUOUS: ${w} has ${r.complete ? "" : "at least "}${plural(r.witness.count, "parse tree")}${budgetNote}`);
      r.witness.trees.forEach((t, i) => display.push(`  ${i + 1}. ${derivationOf(g, t).map((f) => showSeq(g, f, spaced)).join(" ⇒ ")}`));
      if (r.others.length) steps.push(`Also ambiguous (length ≤ ${GRAMMAR_CAPS.ambiguityLength}): ${r.others.slice(0, 6).map((o) => `${showWord(g, o.word)} (${r.complete ? "" : "≥ "}${plural(o.count, "tree")})`).join(", ")}${r.others.length > 6 ? ", …" : ""}`);
      steps.push(`Searched ${r.forms.toLocaleString("en-US")} leftmost sentential forms${r.complete ? " — every derivation of a string of length ≤ " + GRAMMAR_CAPS.ambiguityLength + " was enumerated" : ""}. Two distinct leftmost derivations of one string = two parse trees = ambiguity (a proof).`);
      const nodes: TreeNode[] = [];
      const edges: TreeEdge[] = [];
      r.witness.trees.forEach((t, i) => treeSpec(g, t, `t${i}-`, nodes, edges));
      setFigure(treeSvg({ nodes, edges, caption: `two parse trees of ${w}` }), `Two parse trees of ${w}: ${r.witness.trees.map((t) => derivationOf(g, t).map((f) => showSeq(g, f, spaced)).join(" ⇒ ")).join(" and ")}.`);
    } else {
      display.push(`No ambiguous string of length ≤ ${GRAMMAR_CAPS.ambiguityLength} found${r.complete ? "" : " within the " + GRAMMAR_CAPS.enumBudget.toLocaleString("en-US") + "-form budget"} — ambiguity is UNDECIDABLE in general, so this is evidence, not a proof.`);
      steps.push(`Searched ${r.forms.toLocaleString("en-US")} leftmost sentential forms${r.complete ? "; every string of length ≤ " + GRAMMAR_CAPS.ambiguityLength + " has exactly one leftmost derivation" : "; the budget ran out before every string of length ≤ " + GRAMMAR_CAPS.ambiguityLength + " was covered"}.`);
    }
    caveats.push("Ambiguity of a context-free grammar is undecidable: a witness string with two parse trees is a proof of ambiguity; not finding one within the bounds proves nothing.");
  }

  // FIRST / FOLLOW.
  if (questions.some((q) => q.kind === "firstfollow")) {
    const ff = firstFollow(g);
    display.push(`Nullable: ${ff.nullable.length ? ff.nullable.join(", ") : "none"}`);
    for (const nt of g.nonterminals) display.push(`FIRST(${nt}) = ${showTerminalSet(g, ff.first.get(nt)!)}`);
    for (const nt of g.nonterminals) display.push(`FOLLOW(${nt}) = ${showTerminalSet(g, ff.follow.get(nt)!)}`);
    steps.push("FIRST and FOLLOW by fixpoint iteration: FIRST(A) collects the first terminals of each alternative, passing over nullable symbols; FOLLOW(S) starts with $ (end of input); A → αBβ puts FIRST(β)∖{ε} into FOLLOW(B), and FOLLOW(A) too when β is nullable.");
  }

  // Nullable.
  if (questions.some((q) => q.kind === "nullable")) {
    const nl = nullableSet(g);
    display.push(nl.length ? `nullable = {${nl.join(", ")}}` : "nullable = ∅ (no nonterminal derives ε)");
    steps.push("Nullable by fixpoint: a nonterminal is nullable when some alternative is ε or consists only of nullable nonterminals; listed in the order the iteration finds them.");
  }

  // Useless symbols.
  if (questions.some((q) => q.kind === "useless")) {
    const u = uselessSymbols(g);
    if (u.empty) display.push(`${g.start} is non-generating: the language is EMPTY (no terminal string is derivable).`);
    const parts: string[] = [];
    if (u.nonGenerating.length) parts.push(`${u.nonGenerating.join(", ")} ${u.nonGenerating.length === 1 ? "is" : "are"} non-generating`);
    if (u.unreachable.length) parts.push(`${u.unreachable.join(", ")} ${u.unreachable.length === 1 ? "is" : "are"} unreachable`);
    if (u.unusedTerminals.length) steps.push(`Terminals no longer used after the reduction: ${u.unusedTerminals.map((s) => showSym(g, s, true)).join(", ")}.`);
    if (!parts.length) display.push("No useless symbols — every symbol is reachable from the start and generates a terminal string.");
    else display.push(`${parts.join("; ")}; reduced: ${u.empty ? "(no productions)" : printGrammar(u.reduced).join(", ")}`);
    steps.push("Generating symbols by fixpoint (a nonterminal is generating when some alternative uses only terminals and generating nonterminals), non-generating ones removed first; then reachable symbols from the start symbol over the remaining productions; the order matters — removing unreachable symbols first can leave non-generating ones behind.");
  }

  // Left recursion.
  if (questions.some((q) => q.kind === "leftrec")) {
    const lr = leftRecursion(g);
    if (!lr.changed) display.push("No left recursion — the grammar is unchanged.");
    else {
      display.push(`Left recursion removed (${lr.recursive.join(", ")}):`);
      for (const l of printGrammar(lr.g)) display.push("  " + l);
    }
    for (const n of lr.notes) steps.push(n);
    if (lr.changed) steps.push("Paull's algorithm: nonterminals in the order written; A_i → A_j γ (j < i) replaced by A_j's alternatives, then immediate left recursion A → Aα | β rewritten as A → βA', A' → αA' | ε.");
  }

  if (questions.some((q) => q.kind === "topda")) {
    throw new DiscreteError('For the PDA construction put "cfg to pda" on the FIRST line (or alone on the last line), with the grammar on the others —the pushdown engine builds the one-state PDA and checks it against this grammar.');
  }
  if (questions.some((q) => q.kind === "equivalent")) {
    throw new DiscreteError('"equivalent" needs two grammars: write "is the grammar S -> … equivalent to S -> …" on one line, or two grammar blocks separated by a line "---".');
  }

  if (!questions.length) {
    display.push("No test string — add test: aabb ab (or a question line: cnf · cyk aabb · derivation of aabb · parse tree for aabb · ambiguous? · first and follow · nullable · useless symbols · remove left recursion).");
  }

  caveats.push(g.spaced
    ? "Symbols were read separated by spaces (so id is one terminal; a chunk such as aSb is still split at its uppercase letters). Quote a terminal that starts with a capital or contains a space: \"Id\"."
    : "Symbols were read character by character (aSb = a S b; an uppercase letter with primes or subscript digits is one nonterminal). Separate symbols with spaces or quote them (\"id\") for multi-character terminals.");
  caveats.push(`ε is written ε, eps, epsilon, λ or lambda (so eps as a terminal must be quoted). The grammar as printed re-parses. With multi-character terminals a test string is tried in every reading into terminals (up to ${GRAMMAR_CAPS.segmentations}, whitespace a hard boundary).`);
  const overlap = overlappingTerminals(g);
  if (overlap.length && tests.length) caveats.push(`The terminal${overlap.length === 1 ? "" : "s"} ${overlap.map((t) => `"${t}"`).join(", ")} can also be read as a sequence of shorter terminals; a test string is tried in EVERY reading into terminals (up to ${GRAMMAR_CAPS.segmentations}) and is accepted when any reading is in the language.`);
  caveats.push(CAP_CAVEAT);
  const result: DiscreteResult = { title, display, steps, caveats };
  if (svg) { result.svg = svg; result.alt = alt; }
  return result;
}

function answerEquivalent(aText: string, bText: string): DiscreteResult {
  const a = buildGrammar(readLines(aText)?.raws ?? []);
  const b = buildGrammar(readLines(bText)?.raws ?? []);
  const s = sampleEquivalence(a, b);
  const alpha = showSet(s.alphabet.map((t) => showSym(a, t, true)));
  const head = `CFG equivalence is undecidable — no verdict is computed.`;
  if (s.witness) {
    const w = s.witness.word.length ? showSeq(a, s.witness.word, printMode(a)) : '""';
    throw new DiscreteError(`${head} Sample comparison of the strings over ${alpha} in length order (up to length ${s.maxLen}): they differ on ${w} (length ${s.witness.word.length}): the ${s.witness.first ? "first accepts it, the second does not" : "second accepts it, the first does not"} — a difference IS a proof that the grammars are NOT equivalent.`);
  }
  throw new DiscreteError(`${head} The two grammars agree on all ${s.count} strings of length ≤ ${s.maxLen} over ${alpha} — evidence of equivalence, not a proof.`);
}
