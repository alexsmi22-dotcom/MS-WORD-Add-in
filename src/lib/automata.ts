// Finite automata — one engine of the Discrete-math Solve kind.
//
// Surface forms (first non-empty line decides; case-insensitive):
//   dfa / nfa          a block: states, alphabet, start, accept, transitions, test
//   regex (a|b)*abb    Thompson NFA → subset DFA → minimal DFA, optional test: lines
//   to dfa             + an nfa block (or a regex line) → subset construction
//   minimize/minimise  + a dfa block → Moore partition refinement
//   equivalent         + two machines separated by a blank line or "---"
//
// Every cap is named in AUTOMATA_CAPS and stated in the result's caveats; every
// refusal names the offending state, symbol or line. Derived machines are
// cross-checked against the machine they came from on an exhaustive set of
// short strings, and the result says how many. The pane calls tryAutomata on
// every keystroke, so everything here is bounded: no construction can exceed
// 256 DFA states, no enumeration 5,000 strings, no product search 65,536 pairs.

import { DiscreteError, DiscreteResult } from "./discrete";

export const AUTOMATA_CAPS = {
  /** States in a typed dfa/nfa block. */
  states: 40,
  /** Symbols in an alphabet (ε is not a symbol). */
  alphabet: 10,
  /** DFA states a subset construction may produce. */
  subsetStates: 256,
  /** Characters in a regex. */
  regexLength: 200,
  /** Characters in one test string. */
  testLength: 200,
  /** Test strings per request. */
  testCount: 50,
  /** Strings enumerated for the exhaustive cross-check … */
  crossCheckStrings: 5000,
  /** … and their maximum length. */
  crossCheckLength: 6,
  /** State pairs the equivalence search may visit (256 × 256). */
  productPairs: 65536,
} as const;

/** The empty-string symbol, as stored and displayed. */
export const EPS = "ε";

export interface Machine {
  kind: "dfa" | "nfa";
  /** Short description for captions: a typed name, or the regex. */
  name: string;
  /** Declared order — it drives every listing and the figure layout. */
  states: string[];
  alphabet: string[];
  start: string;
  accept: string[];
  /** from → symbol (or ε) → targets in declared order. A DFA has exactly one target per (state, symbol). */
  trans: Map<string, Map<string, string[]>>;
  /** Strings to run, from test: lines ("" is the empty string). */
  tests: string[];
  /** The sink state of a subset-construction DFA, when one was reached. */
  dead?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const setName = (members: string[]): string => (members.length ? `{${members.join(",")}}` : "∅");
const showStr = (s: string): string => (s === "" ? EPS : `"${s}"`);
const alphaName = (a: string[]): string => (a.length ? `{${a.join(",")}}` : "the empty alphabet");

function targets(m: Machine, from: string, sym: string): string[] {
  return m.trans.get(from)?.get(sym) ?? [];
}

function addTransition(m: Machine, from: string, sym: string, to: string): void {
  let row = m.trans.get(from);
  if (!row) { row = new Map(); m.trans.set(from, row); }
  let list = row.get(sym);
  if (!list) { list = []; row.set(sym, list); }
  if (!list.includes(to)) list.push(to);
}

function emptyMachine(kind: "dfa" | "nfa", name: string): Machine {
  return { kind, name, states: [], alphabet: [], start: "", accept: [], trans: new Map(), tests: [] };
}

/** Members of a set in the machine's declared order. */
function ordered(m: Machine, set: Set<string>): string[] {
  return m.states.filter((s) => set.has(s));
}

// ---------------------------------------------------------------------------
// Core automata algorithms
// ---------------------------------------------------------------------------

/** ε-closure of a set of states. */
export function epsClosure(m: Machine, set: Iterable<string>): Set<string> {
  const out = new Set<string>(set);
  const stack = [...out];
  while (stack.length) {
    const s = stack.pop() as string;
    for (const t of targets(m, s, EPS)) if (!out.has(t)) { out.add(t); stack.push(t); }
  }
  return out;
}

/** The states reached from `set` on one symbol, BEFORE closure. */
function move(m: Machine, set: Set<string>, sym: string): Set<string> {
  const out = new Set<string>();
  for (const s of set) for (const t of targets(m, s, sym)) out.add(t);
  return out;
}

/** Per-machine memo of each state's ε-closure — the simulations below run thousands of strings
 *  over Thompson NFAs with hundreds of states, and recomputing closures dominated the cost. */
const closureMemo = new WeakMap<Machine, Map<string, string[]>>();
function closureOf(m: Machine, s: string): string[] {
  let memo = closureMemo.get(m);
  if (!memo) { memo = new Map(); closureMemo.set(m, memo); }
  let c = memo.get(s);
  if (!c) { c = [...epsClosure(m, [s])]; memo.set(s, c); }
  return c;
}

/** One ε-closed step: move on `sym`, then close. */
function stepClosed(m: Machine, set: Set<string>, sym: string): Set<string> {
  const out = new Set<string>();
  for (const s of set) for (const t of targets(m, s, sym)) for (const c of closureOf(m, t)) out.add(c);
  return out;
}

const acceptsSet = (m: Machine, set: Set<string>): boolean => m.accept.some((a) => set.has(a));

/** Runs a string on any machine (DFA or NFA) by subset simulation. */
export function accepts(m: Machine, input: string): boolean {
  let cur = new Set(closureOf(m, m.start));
  for (const c of input) {
    cur = stepClosed(m, cur, c);
    if (!cur.size) return false;
  }
  return acceptsSet(m, cur);
}

function reachable(m: Machine): Set<string> {
  const seen = new Set<string>([m.start]);
  const queue = [m.start];
  while (queue.length) {
    const s = queue.shift() as string;
    const row = m.trans.get(s);
    if (!row) continue;
    for (const list of row.values()) for (const t of list) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  }
  return seen;
}

/** Lazily interns the ε-closed state sets a machine visits, so that simulating thousands of
 *  strings does the set arithmetic once per distinct (set, symbol). Ids are issued in order of
 *  first visit; `members(id)` lists the set in the machine's declared order. */
function lazyRunner(m: Machine, cap = Infinity) {
  const idx = new Map(m.states.map((s, i) => [s, i] as [string, number]));
  const acc = new Set(m.accept);
  const sets: Set<string>[] = [];
  const sorted: string[][] = [];
  const accepting: boolean[] = [];
  const ids = new Map<string, number>();
  const steps: Map<string, number>[] = [];
  const intern = (set: Set<string>): number => {
    const mem = [...set].sort((a, b) => (idx.get(a) as number) - (idx.get(b) as number));
    const k = mem.join("\u0001");
    const have = ids.get(k);
    if (have !== undefined) return have;
    if (sets.length >= cap) {
      throw new DiscreteError(
        `Subset construction would need more than ${AUTOMATA_CAPS.subsetStates} DFA states (the cap) — this NFA has too many reachable state sets to list.`,
      );
    }
    const id = sets.length;
    ids.set(k, id);
    sets.push(set);
    sorted.push(mem);
    accepting.push(mem.some((s) => acc.has(s)));
    steps.push(new Map());
    return id;
  };
  const start = intern(new Set(closureOf(m, m.start)));
  const step = (id: number, sym: string): number => {
    const cached = steps[id].get(sym);
    if (cached !== undefined) return cached;
    const to = intern(stepClosed(m, sets[id], sym));
    steps[id].set(sym, to);
    return to;
  };
  return { start, step, accepts: (id: number) => accepting[id], members: (id: number) => sorted[id], size: () => sets.length };
}

export interface SubsetResult {
  dfa: Machine;
  /** DFA state name → NFA members (declared order). */
  members: Map<string, string[]>;
}

/** Subset construction over `alphabet` (which may be wider than the machine's own). Total: the
 *  empty set becomes the dead state ∅ when it is reached. Capped at AUTOMATA_CAPS.subsetStates. */
export function determinise(m: Machine, alphabet: string[]): SubsetResult {
  const dfa = emptyMachine("dfa", m.name);
  dfa.alphabet = alphabet.slice();
  const members = new Map<string, string[]>();
  const run = lazyRunner(m, AUTOMATA_CAPS.subsetStates);
  const names: string[] = [];
  const nameOf = (id: number): string => {
    while (names.length <= id) {
      const mem = run.members(names.length);
      const name = setName(mem);
      names.push(name);
      members.set(name, mem);
      dfa.states.push(name);
      if (!mem.length) dfa.dead = name;
      if (run.accepts(names.length - 1)) dfa.accept.push(name);
    }
    return names[id];
  };
  dfa.start = nameOf(run.start);
  // Ids are issued breadth-first here because each state's symbols are expanded in order.
  for (let id = 0; id < run.size(); id++) {
    const from = nameOf(id);
    for (const a of alphabet) addTransition(dfa, from, a, nameOf(run.step(id, a)));
  }
  return { dfa, members };
}

export interface MinimiseResult {
  dfa: Machine;
  /** Partition after each round, each class in declared order. */
  rounds: string[][][];
  unreachable: string[];
  classes: string[][];
  alreadyMinimal: boolean;
}

/** Moore partition refinement on a total DFA: split accept / non-accept, then refine by where
 *  each symbol leads until no class splits. Unreachable states are dropped first and named. */
export function minimise(d: Machine): MinimiseResult {
  const reach = reachable(d);
  const unreachable = d.states.filter((s) => !reach.has(s));
  const live = d.states.filter((s) => reach.has(s));
  const acc = new Set(d.accept);

  let classOf = new Map<string, number>();
  const normalise = (sig: Map<string, string>): Map<string, number> => {
    const ids = new Map<string, number>();
    const out = new Map<string, number>();
    for (const s of live) {
      const k = sig.get(s) as string;
      let id = ids.get(k);
      if (id === undefined) { id = ids.size; ids.set(k, id); }
      out.set(s, id);
    }
    return out;
  };
  const groups = (c: Map<string, number>): string[][] => {
    const out: string[][] = [];
    for (const s of live) {
      const id = c.get(s) as number;
      (out[id] = out[id] || []).push(s);
    }
    return out;
  };

  classOf = normalise(new Map(live.map((s) => [s, acc.has(s) ? "A" : "N"])));
  const rounds: string[][][] = [groups(classOf)];
  // Each round either splits a class or stops, so there are at most |live| rounds.
  for (let guard = 0; guard <= live.length + 1; guard++) {
    const sig = new Map<string, string>();
    for (const s of live) {
      const parts = [String(classOf.get(s))];
      for (const a of d.alphabet) parts.push(String(classOf.get(targets(d, s, a)[0])));
      sig.set(s, parts.join("|"));
    }
    const next = normalise(sig);
    const before = groups(classOf).length;
    const after = groups(next).length;
    classOf = next;
    rounds.push(groups(classOf));
    if (after === before) break;
  }

  const classes = groups(classOf);
  const nameOf = new Map<string, string>();
  const min = emptyMachine("dfa", d.name);
  min.alphabet = d.alphabet.slice();
  for (const cls of classes) {
    const name = cls.length === 1 ? cls[0] : setName(cls);
    for (const s of cls) nameOf.set(s, name);
    min.states.push(name);
    if (cls.some((s) => acc.has(s))) min.accept.push(name);
  }
  min.start = nameOf.get(d.start) as string;
  for (const cls of classes) {
    const rep = cls[0];
    for (const a of d.alphabet) addTransition(min, nameOf.get(rep) as string, a, nameOf.get(targets(d, rep, a)[0]) as string);
  }
  if (d.dead !== undefined) min.dead = nameOf.get(d.dead);
  min.tests = d.tests.slice();
  return { dfa: min, rounds, unreachable, classes, alreadyMinimal: unreachable.length === 0 && classes.length === live.length };
}

/** Renames states q0, q1, … in breadth-first order from the start (alphabet order). */
function renameBfs(d: Machine): Machine {
  const order: string[] = [d.start];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    for (const a of d.alphabet) for (const t of targets(d, order[i], a)) if (!seen.has(t)) { seen.add(t); order.push(t); }
  }
  for (const s of d.states) if (!seen.has(s)) { seen.add(s); order.push(s); }
  const nameOf = new Map(order.map((s, i) => [s, `q${i}`]));
  const out = emptyMachine("dfa", d.name);
  out.alphabet = d.alphabet.slice();
  out.states = order.map((s) => nameOf.get(s) as string);
  out.start = nameOf.get(d.start) as string;
  out.accept = out.states.filter((_, i) => d.accept.includes(order[i]));
  for (const s of order) for (const a of d.alphabet) for (const t of targets(d, s, a)) addTransition(out, nameOf.get(s) as string, a, nameOf.get(t) as string);
  if (d.dead !== undefined) out.dead = nameOf.get(d.dead);
  out.tests = d.tests.slice();
  return out;
}

/** Every string over `alphabet` up to the longest length that keeps the total within the cap
 *  (and ≤ crossCheckLength). Includes the empty string. */
export function enumerateStrings(alphabet: string[]): { strings: string[]; maxLen: number } {
  const { maxLen } = enumerationDepth(alphabet.length);
  const strings: string[] = [""];
  let layer = [""];
  for (let len = 1; len <= maxLen; len++) {
    const nextLayer: string[] = [];
    for (const s of layer) for (const a of alphabet) nextLayer.push(s + a);
    strings.push(...nextLayer);
    layer = nextLayer;
  }
  return { strings, maxLen };
}

/** How deep the exhaustive enumeration goes for an alphabet of k symbols, and how many strings that is. */
function enumerationDepth(k: number): { maxLen: number; total: number } {
  let maxLen = 0;
  let total = 1;
  while (maxLen < AUTOMATA_CAPS.crossCheckLength && k > 0) {
    const next = total + Math.pow(k, maxLen + 1);
    if (next > AUTOMATA_CAPS.crossCheckStrings) break;
    total = next;
    maxLen++;
  }
  return { maxLen, total };
}

export interface CrossCheck { ok: boolean; count: number; maxLen: number; witness?: string }

/** Do two machines agree on every string up to the enumeration depth? Walks the string trie
 *  breadth-first, carrying both machines' state sets, so each prefix is simulated once and the
 *  first disagreement found is a shortest one. */
export function crossCheck(a: Machine, b: Machine, alphabet: string[]): CrossCheck {
  const { maxLen, total } = enumerationDepth(alphabet.length);
  const ra = lazyRunner(a), rb = lazyRunner(b);
  type Node = { ia: number; ib: number; w: string };
  let layer: Node[] = [{ ia: ra.start, ib: rb.start, w: "" }];
  for (let len = 0; len <= maxLen; len++) {
    const next: Node[] = [];
    for (const n of layer) {
      if (ra.accepts(n.ia) !== rb.accepts(n.ib)) return { ok: false, count: total, maxLen, witness: n.w };
      if (len === maxLen) continue;
      for (const c of alphabet) next.push({ ia: ra.step(n.ia, c), ib: rb.step(n.ib, c), w: n.w + c });
    }
    layer = next;
  }
  return { ok: true, count: total, maxLen };
}

/** Shortest string on which two TOTAL DFAs over the same alphabet disagree (BFS over the product;
 *  symbols are tried in alphabet order, so ties go to the alphabetically first string), or null. */
export function distinguish(d1: Machine, d2: Machine, alphabet: string[]): string | null {
  const a1 = new Set(d1.accept), a2 = new Set(d2.accept);
  const key = (s: string, t: string) => s + "\u0001" + t;
  const seen = new Set<string>([key(d1.start, d2.start)]);
  const queue: [string, string, string][] = [[d1.start, d2.start, ""]];
  while (queue.length) {
    const [s, t, w] = queue.shift() as [string, string, string];
    if (a1.has(s) !== a2.has(t)) return w;
    for (const a of alphabet) {
      const ns = targets(d1, s, a)[0], nt = targets(d2, t, a)[0];
      if (ns === undefined || nt === undefined) continue;
      const k = key(ns, nt);
      if (seen.has(k)) continue;
      if (seen.size >= AUTOMATA_CAPS.productPairs) {
        throw new DiscreteError(`The equivalence search visited ${AUTOMATA_CAPS.productPairs} state pairs (the cap) without finishing.`);
      }
      seen.add(k);
      queue.push([ns, nt, w + a]);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regular expressions → Thompson NFA
// ---------------------------------------------------------------------------

type Node =
  | { t: "lit"; c: string }
  | { t: "eps" }
  | { t: "empty" }
  | { t: "cat"; a: Node; b: Node }
  | { t: "alt"; a: Node; b: Node }
  | { t: "star" | "plus" | "opt"; a: Node };

type Tok = { k: "lit"; c: string } | { k: "(" | ")" | "|" | "*" | "+" | "?" | "eps" | "empty" };

function tokenise(src: string): Tok[] {
  const toks: Tok[] = [];
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const word = (w: string) => src.startsWith(w, i) && (i === 0 || !isWord(src[i - 1])) && (i + w.length >= src.length || !isWord(src[i + w.length]));
    if (c === EPS || c === "λ") { toks.push({ k: "eps" }); i++; continue; }
    if (word("epsilon")) { toks.push({ k: "eps" }); i += 7; continue; }
    if (word("eps")) { toks.push({ k: "eps" }); i += 3; continue; }
    if (word("lambda")) { toks.push({ k: "eps" }); i += 6; continue; }
    if (c === "∅") { toks.push({ k: "empty" }); i++; continue; }
    if (word("empty")) { toks.push({ k: "empty" }); i += 5; continue; }
    if (c === "(" || c === ")" || c === "|" || c === "*" || c === "+" || c === "?") { toks.push({ k: c }); i++; continue; }
    if (c === "∪") { toks.push({ k: "|" }); i++; continue; }
    if (isWord(c)) { toks.push({ k: "lit", c }); i++; continue; }
    throw new DiscreteError(`Regex character "${c}" is not allowed — use letters, digits, ( ) | * + ?, ε/eps and ∅.`);
  }
  return toks;
}

function parseRegex(src: string): Node {
  const toks = tokenise(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const atomStart = (t: Tok | undefined) => !!t && (t.k === "lit" || t.k === "(" || t.k === "eps" || t.k === "empty");

  function alt(): Node {
    let n = cat();
    while (peek()?.k === "|") { p++; n = { t: "alt", a: n, b: cat() }; }
    return n;
  }
  function cat(): Node {
    let n: Node | null = null;
    while (atomStart(peek())) {
      const r = rep();
      n = n ? { t: "cat", a: n, b: r } : r;
    }
    return n ?? { t: "eps" };
  }
  function rep(): Node {
    let n = atom();
    for (;;) {
      const t = peek();
      if (t?.k === "*") { p++; n = { t: "star", a: n }; }
      else if (t?.k === "+") { p++; n = { t: "plus", a: n }; }
      else if (t?.k === "?") { p++; n = { t: "opt", a: n }; }
      else return n;
    }
  }
  function atom(): Node {
    const t = toks[p++];
    if (t.k === "lit") return { t: "lit", c: t.c };
    if (t.k === "eps") return { t: "eps" };
    if (t.k === "empty") return { t: "empty" };
    if (t.k === "(") {
      const n = alt();
      if (peek()?.k !== ")") throw new DiscreteError("Regex has an unclosed parenthesis.");
      p++;
      return n;
    }
    throw new DiscreteError(`Regex has a misplaced "${t.k}".`);
  }

  if (!toks.length) throw new DiscreteError("Regex is empty — write ε (or eps) for the empty string, ∅ for the empty language.");
  const first = peek();
  if (first && (first.k === "*" || first.k === "+" || first.k === "?")) throw new DiscreteError(`Regex starts with "${first.k}", which needs something before it.`);
  const n = alt();
  if (p < toks.length) {
    const t = toks[p];
    throw new DiscreteError(t.k === ")" ? "Regex has a closing parenthesis with no opening one." : `Regex has an unexpected "${t.k === "lit" ? t.c : t.k}".`);
  }
  return n;
}

function literalsOf(n: Node, out: string[]): void {
  switch (n.t) {
    case "lit": if (!out.includes(n.c)) out.push(n.c); break;
    case "cat": case "alt": literalsOf(n.a, out); literalsOf(n.b, out); break;
    case "star": case "plus": case "opt": literalsOf(n.a, out); break;
    default: break;
  }
}

/** Thompson construction. States are numbered in creation order; every fragment has one start and one end. */
export function thompson(src: string): { nfa: Machine; transitions: number; epsMoves: number } {
  const ast = parseRegex(src);
  const nfa = emptyMachine("nfa", src);
  literalsOf(ast, nfa.alphabet);
  const counters = { transitions: 0, epsMoves: 0 };
  const fresh = (): string => { const s = String(nfa.states.length); nfa.states.push(s); return s; };
  const edge = (a: string, sym: string, b: string) => { addTransition(nfa, a, sym, b); counters.transitions++; if (sym === EPS) counters.epsMoves++; };

  function build(n: Node): { s: string; e: string } {
    switch (n.t) {
      case "lit": { const s = fresh(), e = fresh(); edge(s, n.c, e); return { s, e }; }
      case "eps": { const s = fresh(), e = fresh(); edge(s, EPS, e); return { s, e }; }
      case "empty": { const s = fresh(), e = fresh(); return { s, e }; }
      case "cat": { const a = build(n.a), b = build(n.b); edge(a.e, EPS, b.s); return { s: a.s, e: b.e }; }
      case "alt": {
        const s = fresh(); const a = build(n.a), b = build(n.b); const e = fresh();
        edge(s, EPS, a.s); edge(s, EPS, b.s); edge(a.e, EPS, e); edge(b.e, EPS, e);
        return { s, e };
      }
      case "star": {
        const s = fresh(); const a = build(n.a); const e = fresh();
        edge(s, EPS, a.s); edge(s, EPS, e); edge(a.e, EPS, a.s); edge(a.e, EPS, e);
        return { s, e };
      }
      case "plus": {
        const s = fresh(); const a = build(n.a); const e = fresh();
        edge(s, EPS, a.s); edge(a.e, EPS, a.s); edge(a.e, EPS, e);
        return { s, e };
      }
      case "opt": {
        const s = fresh(); const a = build(n.a); const e = fresh();
        edge(s, EPS, a.s); edge(s, EPS, e); edge(a.e, EPS, e);
        return { s, e };
      }
    }
  }
  const f = build(ast);
  nfa.start = f.s;
  nfa.accept = [f.e];
  return { nfa, transitions: counters.transitions, epsMoves: counters.epsMoves };
}

// ---------------------------------------------------------------------------
// Parsing the typed forms
// ---------------------------------------------------------------------------

const KEYWORD = /^(dfa|nfa|regex|to\s+dfa|minimi[sz]e|equivalent)\b/i;

function lines(src: string): string[] {
  return src.replace(/\r/g, "").split("\n").map((l) => l.trim());
}

/** Whitespace-separated tokens; a token without braces splits further at commas, so both
 *  "q0 q1 q2" and "q0, q1, q2" work while a set-name like {q0,q1} stays whole. */
function tokens(s: string): string[] {
  const out: string[] = [];
  for (const t of s.split(/\s+/)) {
    if (!t) continue;
    if (t.includes("{") || t.includes("}")) out.push(t.replace(/,$/, ""));
    else for (const u of t.split(",")) if (u) out.push(u);
  }
  return out;
}

function normSymbol(t: string): string {
  const l = t.toLowerCase();
  return l === "eps" || l === "epsilon" || l === "lambda" || t === "λ" || t === "ε" || t === '""' || t === "''" ? EPS : t;
}

function normTest(t: string): string {
  if (t === '""' || t === "''") return "";
  const l = t.toLowerCase();
  if (l === "eps" || l === "epsilon" || t === "ε" || t === "λ") return "";
  const q = /^"(.*)"$/.exec(t) || /^'(.*)'$/.exec(t);
  return q ? q[1] : t;
}

interface RawTransition { from: string; syms: string[]; to: string; line: string }

/** `from symbol to`, `from --symbol--> to`, `from, symbol -> to`, `from symbol -> to`. */
function parseTransition(line: string): RawTransition | null {
  let m = /^(\S+)\s*--\s*(\S+?)\s*--\s*>\s*(\S+)$/.exec(line);
  if (!m) {
    const arrow = /^(.*?)\s*(?:->|→|=>)\s*(\S+)$/.exec(line);
    if (arrow) {
      const left = arrow[1].trim();
      let lm = /^(\S+?),?\s+(\S+)$/.exec(left);
      if (!lm) {
        const cut = left.lastIndexOf(",");
        if (cut > 0 && cut < left.length - 1) lm = [left, left.slice(0, cut), left.slice(cut + 1)] as unknown as RegExpExecArray;
      }
      if (lm) m = [line, lm[1], lm[2], arrow[2]] as unknown as RegExpExecArray;
    }
  }
  if (!m) m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(line);
  if (!m) return null;
  const sym = m[2];
  if (/^(->|→|=>|--+>?)$/.test(sym)) throw new DiscreteError(`Transition "${line}" has no symbol between the two states — write "from symbol to".`);
  const syms = sym.includes(",") && sym.length > 1 ? sym.split(",").filter((s) => s) : [sym];
  return { from: m[1], syms: syms.map(normSymbol), to: m[3], line };
}

function parseTests(value: string, into: string[]): void {
  for (const t of value.split(/\s+/)) if (t) into.push(normTest(t));
}

/** A dfa/nfa block. `body` is the lines after the keyword line. */
function parseBlock(kind: "dfa" | "nfa", name: string, body: string[]): Machine {
  let states: string[] | null = null;
  let alphabet: string[] | null = null;
  let start: string | null = null;
  let accept: string[] | null = null;
  const tests: string[] = [];
  const raw: RawTransition[] = [];
  const m = emptyMachine(kind, name);

  for (const line of body) {
    if (!line) continue;
    const head = /^(states?|alphabet|sigma|symbols?|start|initial|accept(?:ing)?|final|tests?|run|name|title)\s*[:=]\s*(.*)$/i.exec(line);
    if (head) {
      const k = head[1].toLowerCase();
      const v = head[2].trim();
      if (k === "state" || k === "states") states = tokens(v);
      else if (k === "alphabet" || k === "sigma" || k === "symbol" || k === "symbols") alphabet = tokens(v).map(normSymbol);
      else if (k === "start" || k === "initial") {
        const t = tokens(v);
        if (t.length !== 1) throw new DiscreteError(`start: must name exactly one state (got "${v}").`);
        start = t[0];
      } else if (k === "accept" || k === "accepting" || k === "final") accept = tokens(v);
      else if (k === "name" || k === "title") m.name = v;
      else parseTests(v, tests);
      continue;
    }
    const t = parseTransition(line);
    if (!t) throw new DiscreteError(`Line "${line}" is not a transition — write "from symbol to" (or "from --symbol--> to").`);
    raw.push(t);
  }

  if (start === null) throw new DiscreteError(`The ${kind.toUpperCase()} block needs a "start: <state>" line.`);
  if (accept === null) throw new DiscreteError(`The ${kind.toUpperCase()} block needs an "accept: <states>" line (leave it empty for a machine that accepts nothing).`);

  // Infer what was not declared, in order of first appearance.
  if (states === null) {
    states = [start];
    for (const t of raw) for (const s of [t.from, t.to]) if (!states.includes(s)) states.push(s);
    for (const s of accept) if (!states.includes(s)) states.push(s);
  }
  if (alphabet === null) {
    alphabet = [];
    for (const t of raw) for (const s of t.syms) if (s !== EPS && !alphabet.includes(s)) alphabet.push(s);
  }

  if (states.length > AUTOMATA_CAPS.states) throw new DiscreteError(`${states.length} states exceed the cap of ${AUTOMATA_CAPS.states} states.`);
  if (!states.length) throw new DiscreteError("The machine has no states.");
  const dupState = states.find((s, i) => states!.indexOf(s) !== i);
  if (dupState !== undefined) throw new DiscreteError(`State "${dupState}" is listed twice.`);
  if (alphabet.length > AUTOMATA_CAPS.alphabet) throw new DiscreteError(`${alphabet.length} symbols exceed the cap of ${AUTOMATA_CAPS.alphabet} alphabet symbols.`);
  for (const a of alphabet) {
    if (a === EPS) throw new DiscreteError("ε is the empty string, not an alphabet symbol — leave it out of alphabet:.");
    if ([...a].length !== 1) throw new DiscreteError(`Alphabet symbol "${a}" must be a single character, so that test strings read unambiguously.`);
  }
  const dupSym = alphabet.find((s, i) => alphabet!.indexOf(s) !== i);
  if (dupSym !== undefined) throw new DiscreteError(`Symbol "${dupSym}" is listed twice in the alphabet.`);
  const stateSet = new Set(states);
  if (!stateSet.has(start)) throw new DiscreteError(`Start state "${start}" is not one of the declared states ${setName(states)}.`);
  for (const a of accept) if (!stateSet.has(a)) throw new DiscreteError(`Accept state "${a}" is not one of the declared states ${setName(states)}.`);
  const dupAcc = accept.find((s, i) => accept!.indexOf(s) !== i);
  if (dupAcc !== undefined) accept = accept.filter((s, i) => accept!.indexOf(s) === i);

  m.states = states; m.alphabet = alphabet; m.start = start; m.accept = accept;
  const symSet = new Set(alphabet);
  for (const t of raw) {
    if (!stateSet.has(t.from)) throw new DiscreteError(`Transition "${t.line}" names unknown state "${t.from}" — declared states are ${setName(states)}.`);
    if (!stateSet.has(t.to)) throw new DiscreteError(`Transition "${t.line}" names unknown state "${t.to}" — declared states are ${setName(states)}.`);
    for (const s of t.syms) {
      if (s === EPS) {
        if (kind === "dfa") throw new DiscreteError(`A DFA cannot have an ε-move (transition "${t.line}") — use nfa for a machine with ε-moves.`);
      } else if (!symSet.has(s)) {
        throw new DiscreteError(`Transition "${t.line}" uses symbol "${s}", which is not in the alphabet ${alphaName(alphabet)}.`);
      }
      if (kind === "dfa") {
        const prev = targets(m, t.from, s);
        if (prev.length && prev[0] !== t.to) {
          throw new DiscreteError(`State ${t.from} has two transitions on symbol ${s} (to ${prev[0]} and ${t.to}) — a DFA needs exactly one. Use nfa for a nondeterministic machine.`);
        }
      }
      addTransition(m, t.from, s, t.to);
    }
  }
  if (kind === "dfa") {
    for (const s of states) for (const a of alphabet) {
      if (!targets(m, s, a).length) throw new DiscreteError(`DFA is not total: state ${s} has no transition on symbol ${a} — add a line "${s} ${a} <state>" (a DFA needs one transition for every state and symbol).`);
    }
  }
  checkTests(tests);
  m.tests = tests;
  return m;
}

function checkTests(tests: string[]): void {
  if (tests.length > AUTOMATA_CAPS.testCount) throw new DiscreteError(`${tests.length} test strings exceed the cap of ${AUTOMATA_CAPS.testCount}.`);
  for (const t of tests) if (t.length > AUTOMATA_CAPS.testLength) throw new DiscreteError(`Test string "${t.slice(0, 20)}…" is ${t.length} characters; the cap is ${AUTOMATA_CAPS.testLength}.`);
}

interface RegexSpec { kind: "regex"; src: string; tests: string[] }
type Spec = { kind: "machine"; m: Machine } | RegexSpec;

/** One thing: a dfa/nfa block or a regex line (with optional test: lines). */
function parseSpec(part: string[]): Spec {
  const nonEmpty = part.filter((l) => l);
  if (!nonEmpty.length) throw new DiscreteError("Expected a dfa block, an nfa block or a regex line here, but found nothing.");
  const first = nonEmpty[0];
  const rest = part.slice(part.indexOf(first) + 1);
  const blk = /^(dfa|nfa)\b\s*[:\-—]?\s*(.*)$/i.exec(first);
  if (blk) return { kind: "machine", m: parseBlock(blk[1].toLowerCase() as "dfa" | "nfa", blk[2].trim(), rest) };
  const rx = /^regex\b\s*[:=]?\s*(.*)$/i.exec(first);
  if (rx) {
    const src = rx[1].trim();
    if (!src) throw new DiscreteError("regex needs a pattern on the same line, e.g. regex (a|b)*abb");
    if (src.length > AUTOMATA_CAPS.regexLength) throw new DiscreteError(`The regex is ${src.length} characters; the cap is ${AUTOMATA_CAPS.regexLength}.`);
    const tests: string[] = [];
    for (const line of rest) {
      if (!line) continue;
      const t = /^(?:tests?|run)\s*[:=]\s*(.*)$/i.exec(line);
      if (!t) throw new DiscreteError(`After a regex line only "test: …" lines are read, but found "${line}".`);
      parseTests(t[1], tests);
    }
    checkTests(tests);
    return { kind: "regex", src, tests };
  }
  throw new DiscreteError(`Expected "dfa", "nfa" or "regex …" here, but found "${first}".`);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function summary(m: Machine): string {
  const kind = m.kind.toUpperCase();
  return `${kind}, ${m.states.length} state${m.states.length === 1 ? "" : "s"} over ${alphaName(m.alphabet)} — start ${m.start}, accept ${m.accept.length ? setName(m.accept) : "nothing (no accept states)"}`;
}

function caption(m: Machine, lead?: string): string {
  const n = `${m.states.length} state${m.states.length === 1 ? "" : "s"} over ${alphaName(m.alphabet)}`;
  const head = lead ?? m.kind.toUpperCase();
  return m.name ? `${head}, ${n} — ${m.name}` : `${head}, ${n} — start ${m.start}, accept ${m.accept.length ? setName(m.accept) : "nothing"}`;
}

function tableLines(m: Machine): string[] {
  const out: string[] = [];
  const symbols = m.kind === "nfa" ? [EPS, ...m.alphabet] : m.alphabet;
  for (const s of m.states) {
    const marks = (s === m.start ? "→" : "") + (m.accept.includes(s) ? "*" : "");
    const cells: string[] = [];
    for (const a of symbols) {
      const t = targets(m, s, a);
      if (!t.length && m.kind === "nfa") continue;
      cells.push(`${a} → ${m.kind === "dfa" ? t[0] : setName(t)}`);
    }
    const dead = m.dead === s ? " (dead state)" : "";
    out.push(`${marks ? marks + " " : ""}${s}${dead}: ${cells.length ? cells.join(", ") : "no transitions"}`);
  }
  return out;
}

/** The machine as a block that parses back through tryAutomata. */
function blockLines(m: Machine): string[] {
  const out = [m.kind, `states: ${m.states.join(" ")}`, `alphabet: ${m.alphabet.join(" ")}`, `start: ${m.start}`, `accept: ${m.accept.join(" ")}`];
  const symbols = m.kind === "nfa" ? [EPS, ...m.alphabet] : m.alphabet;
  for (const s of m.states) for (const a of symbols) for (const t of targets(m, s, a)) out.push(`${s} ${a} ${t}`);
  return out;
}

function runLine(m: Machine, input: string): { line: string; accepted: boolean | null } {
  const bad = [...input].find((c) => !m.alphabet.includes(c));
  if (bad !== undefined) return { line: `${showStr(input)} — not run: symbol "${bad}" is not in the alphabet ${alphaName(m.alphabet)}`, accepted: null };
  if (m.kind === "dfa") {
    let cur = m.start;
    const parts = [cur];
    for (const c of input) { cur = targets(m, cur, c)[0]; parts.push(`─${c}→ ${cur}`); }
    const ok = m.accept.includes(cur);
    return { line: `${showStr(input)}: ${parts.join(" ")} — ${ok ? "ACCEPT" : "reject"} (ends in ${cur}, ${ok ? "an accept state" : "not an accept state"})`, accepted: ok };
  }
  const start = new Set([m.start]);
  let cur = epsClosure(m, start);
  const parts = [setName(ordered(m, start))];
  if (cur.size !== start.size) parts.push(`─ε→ ${setName(ordered(m, cur))}`);
  for (const c of input) {
    const moved = move(m, cur, c);
    cur = epsClosure(m, moved);
    parts.push(`─${c}→ ${setName(ordered(m, moved))}`);
    if (cur.size !== moved.size) parts.push(`─ε→ ${setName(ordered(m, cur))}`);
    if (!cur.size) break;
  }
  const hits = m.accept.filter((a) => cur.has(a));
  const ok = hits.length > 0;
  return { line: `${showStr(input)}: ${parts.join(" ")} — ${ok ? `ACCEPT (contains ${hits.join(", ")})` : cur.size ? "reject (no accept state in the final set)" : "reject (no live states)"}`, accepted: ok };
}

function runAll(m: Machine, tests: string[], display: string[], steps: string[]): void {
  if (!tests.length) return;
  steps.push("Test runs:");
  for (const t of tests) {
    const r = runLine(m, t);
    steps.push("  " + r.line);
    display.push(`${showStr(t)} → ${r.accepted === null ? "not run" : r.accepted ? "accept" : "reject"}`);
  }
}

function unreachableLine(m: Machine): string | null {
  const reach = reachable(m);
  const un = m.states.filter((s) => !reach.has(s));
  return un.length ? `Unreachable from ${m.start}: ${un.join(", ")} (never visited on any input)` : null;
}

function crossCheckLine(what: string, a: Machine, b: Machine, alphabet: string[]): string {
  const cc = crossCheck(a, b, alphabet);
  if (!cc.ok) throw new DiscreteError(`Internal cross-check failed: ${what} disagree on ${showStr(cc.witness as string)}. Nothing was returned rather than a wrong machine.`);
  return `verified: ${what} agree on all ${cc.count} strings up to length ${cc.maxLen} over ${alphaName(alphabet)} (exhaustive, including the empty string)`;
}

const CAP_CAVEAT = `Caps: ≤ ${AUTOMATA_CAPS.states} states and ≤ ${AUTOMATA_CAPS.alphabet} symbols per typed machine, ≤ ${AUTOMATA_CAPS.subsetStates} states from a subset construction, regex ≤ ${AUTOMATA_CAPS.regexLength} characters, ≤ ${AUTOMATA_CAPS.testCount} test strings of ≤ ${AUTOMATA_CAPS.testLength} characters, cross-checks enumerate ≤ ${AUTOMATA_CAPS.crossCheckStrings} strings of length ≤ ${AUTOMATA_CAPS.crossCheckLength}.`;

// ---------------------------------------------------------------------------
// The state diagram
// ---------------------------------------------------------------------------

const W = 460, H = 320;

/** Deterministic circular state diagram: declared order around the circle, rotated so the
 *  start state sits at the left where its incoming arrow comes from. */

/** Does the segment (x1,y1)-(x2,y2) touch the axis-aligned box? */
function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, bx1: number, by1: number, bx2: number, by2: number): boolean {
  const inside = (x: number, y: number): boolean => x >= bx1 && x <= bx2 && y >= by1 && y <= by2;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  // Liang–Barsky clip.
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const checks: [number, number][] = [[-dx, x1 - bx1], [dx, bx2 - x1], [-dy, y1 - by1], [dy, by2 - y1]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

interface LabelSeg { x1: number; y1: number; x2: number; y2: number; owner: string }

/** Picks, among candidate centres, the one whose box crosses the fewest
 *  segments of OTHER edges (ties → the earlier candidate, i.e. the preferred
 *  side). A label laid across a stroke reads as struck through. */
function pickLabelSpot(cands: { x: number; y: number }[], w: number, h: number, segs: LabelSeg[], owner: string): { x: number; y: number } {
  let best = cands[0];
  let bestHits = Infinity;
  for (const c of cands) {
    let hits = 0;
    for (const s of segs) {
      if (s.owner === owner) continue;
      if (segmentHitsBox(s.x1, s.y1, s.x2, s.y2, c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2)) hits++;
    }
    if (hits < bestHits) { bestHits = hits; best = c; if (hits === 0) break; }
  }
  return best;
}

export function machineSvg(m: Machine, cap: string): string {
  const INK = "#1A1A1A", ACCENT = "#0C4A6E", LABEL = "#7B8C99", FILL = "#9DB3C4";
  const n = m.states.length;
  const longest = Math.max(0, ...m.states.map((s) => [...s].length));
  const r = longest > 4 ? 22 : 18;
  const cx = W / 2, cy = 160, R = n <= 2 ? 90 : 96;
  const startIdx = Math.max(0, m.states.indexOf(m.start));
  const pos = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < n; i++) {
    const s = m.states[(startIdx + i) % n];
    if (n === 1) { pos.set(s, { x: cx, y: cy }); continue; }
    const th = Math.PI + (2 * Math.PI * i) / n;
    pos.set(s, { x: cx + R * Math.cos(th), y: cy + R * Math.sin(th) });
  }
  const f = (v: number) => v.toFixed(1);
  const font = (s: string) => { const l = [...s].length; return l <= 3 ? 12 : l <= 6 ? 10 : l <= 10 ? 8 : 7; };
  const short = (s: string) => { const c = [...s]; return c.length > 14 ? c.slice(0, 12).join("") + "…" : s; };

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Georgia,serif">`;
  out += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  out += `<defs><marker id="aut-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${INK}"/></marker></defs>`;

  // Edges, merged per (from, to) with comma-joined labels; ε first, then alphabet order.
  const symbols = m.kind === "nfa" ? [EPS, ...m.alphabet] : m.alphabet;
  const edges = new Map<string, { from: string; to: string; labels: string[] }>();
  for (const s of m.states) for (const a of symbols) for (const t of targets(m, s, a)) {
    const k = s + "\u0001" + t;
    let e = edges.get(k);
    if (!e) { e = { from: s, to: t, labels: [] }; edges.set(k, e); }
    e.labels.push(a);
  }
  const label = (x: number, y: number, text: string) => {
    const w = [...text].length * 6 + 4;
    return `<rect x="${f(x - w / 2)}" y="${f(y - 9)}" width="${f(w)}" height="12" fill="#fff" fill-opacity="0.85"/>` +
      `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" font-size="10" fill="${LABEL}">${escapeXml(text)}</text>`;
  };
  let edgeSvg = "";
  const segs: LabelSeg[] = [];
  const pending: { owner: string; cands: { x: number; y: number }[]; text: string }[] = [];
  // The start arrow is a segment too: it comes in from the left.
  const S0 = pos.get(m.start);
  if (S0) segs.push({ x1: S0.x - r - 40, y1: S0.y, x2: S0.x - r - 2, y2: S0.y, owner: "start" });
  for (const e of edges.values()) {
    const A = pos.get(e.from) as { x: number; y: number };
    const B = pos.get(e.to) as { x: number; y: number };
    const text = e.labels.join(",");
    const owner = e.from + "\u0001" + e.to;
    if (e.from === e.to) {
      // Radially outward from the layout centre, so the loop and its label
      // sit outside the ring rather than across an incoming edge — except on
      // the START state, whose loop points along the tangent (upward) so the
      // start arrow coming in from the left cannot cross it.
      const dl = Math.hypot(A.x - cx, A.y - cy);
      let ox = dl > 1 ? (A.x - cx) / dl : 0, oy = dl > 1 ? (A.y - cy) / dl : -1;
      if (e.from === m.start) { const tx0 = -oy, ty0 = ox; const up = ty0 <= 0 ? 1 : -1; ox = tx0 * up; oy = ty0 * up; }
      const tx = -oy, ty = ox;
      const ca = Math.cos(0.42), sa = Math.sin(0.42);
      const sx = A.x + r * (ox * ca - tx * sa), sy = A.y + r * (oy * ca - ty * sa);
      const ex = A.x + r * (ox * ca + tx * sa), ey = A.y + r * (oy * ca + ty * sa);
      const c1x = A.x + (r + 30) * ox - 30 * tx, c1y = A.y + (r + 30) * oy - 30 * ty;
      const c2x = A.x + (r + 30) * ox + 30 * tx, c2y = A.y + (r + 30) * oy + 30 * ty;
      edgeSvg += `<path d="M${f(sx)} ${f(sy)} C${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(ex)} ${f(ey)}" fill="none" stroke="${INK}" stroke-width="1.2" marker-end="url(#aut-arrow)"/>`;
      pending.push({ owner, text, cands: [{ x: A.x + (r + 34) * ox, y: A.y + (r + 34) * oy + 3 }, { x: A.x + (r + 42) * ox, y: A.y + (r + 42) * oy + 3 }] });
      continue;
    }
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = uy, py = -ux; // the right-hand side of the direction of travel
    const twoWay = edges.has(e.to + "\u0001" + e.from);
    if (twoWay) {
      const C = { x: (A.x + B.x) / 2 + px * 26, y: (A.y + B.y) / 2 + py * 26 };
      const a1 = Math.atan2(C.y - A.y, C.x - A.x), a2 = Math.atan2(C.y - B.y, C.x - B.x);
      const sx = A.x + r * Math.cos(a1), sy = A.y + r * Math.sin(a1);
      const ex = B.x + (r + 2) * Math.cos(a2), ey = B.y + (r + 2) * Math.sin(a2);
      edgeSvg += `<path d="M${f(sx)} ${f(sy)} Q${f(C.x)} ${f(C.y)} ${f(ex)} ${f(ey)}" fill="none" stroke="${INK}" stroke-width="1.2" marker-end="url(#aut-arrow)"/>`;
      const mx = 0.25 * sx + 0.5 * C.x + 0.25 * ex, my = 0.25 * sy + 0.5 * C.y + 0.25 * ey;
      segs.push({ x1: sx, y1: sy, x2: C.x, y2: C.y, owner }); segs.push({ x1: C.x, y1: C.y, x2: ex, y2: ey, owner });
      pending.push({ owner, text, cands: [{ x: mx + px * 14, y: my + py * 14 + 3 }, { x: mx + px * 22, y: my + py * 22 + 3 }] });
    } else {
      const sx = A.x + ux * r, sy = A.y + uy * r;
      const ex = B.x - ux * (r + 2), ey = B.y - uy * (r + 2);
      edgeSvg += `<path d="M${f(sx)} ${f(sy)} L${f(ex)} ${f(ey)}" stroke="${INK}" stroke-width="1.2" marker-end="url(#aut-arrow)"/>`;
      // Preferred: the side facing away from the layout centre; then along
      // the edge; then the other side — the first candidate no edge crosses wins.
      const side = ((sx + ex) / 2 - cx) * px + ((sy + ey) / 2 - cy) * py >= 0 ? 1 : -1;
      segs.push({ x1: sx, y1: sy, x2: ex, y2: ey, owner });
      const at = (frac: number, dist: number, sg: number): { x: number; y: number } => ({ x: sx + (ex - sx) * frac + px * dist * sg, y: sy + (ey - sy) * frac + py * dist * sg + 3 });
      pending.push({ owner, text, cands: [at(0.5, 14, side), at(0.35, 14, side), at(0.65, 14, side), at(0.5, 22, side), at(0.5, 14, -side), at(0.35, 14, -side), at(0.65, 14, -side)] });
    }
  }
  for (const q of pending) {
    const w = [...q.text].length * 6 + 4;
    // label() draws the box from y−9 to y+3 around the baseline y: centre y−3.
    const spot = pickLabelSpot(q.cands.map((c) => ({ x: c.x, y: c.y - 3 })), w, 12, segs, q.owner);
    edgeSvg += label(spot.x, spot.y + 3, q.text);
  }
  out += edgeSvg;

  // Start arrow from the left.
  const S = pos.get(m.start);
  if (S) out += `<path d="M${f(S.x - r - 40)} ${f(S.y)} L${f(S.x - r - 2)} ${f(S.y)}" stroke="${INK}" stroke-width="1.2" marker-end="url(#aut-arrow)"/>`;

  // Nodes last so they sit on top of the arrows.
  for (const s of m.states) {
    const P = pos.get(s) as { x: number; y: number };
    const acc = m.accept.includes(s);
    if (acc) {
      out += `<circle cx="${f(P.x)}" cy="${f(P.y)}" r="${r}" fill="${FILL}" fill-opacity="0.35" stroke="${ACCENT}" stroke-width="1.4"/>`;
      out += `<circle cx="${f(P.x)}" cy="${f(P.y)}" r="${r - 4}" fill="none" stroke="${ACCENT}" stroke-width="1.4"/>`;
    } else {
      out += `<circle cx="${f(P.x)}" cy="${f(P.y)}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="1.2"/>`;
    }
    const title = [...s].length > 14 ? `<title>${escapeXml(s)}</title>` : "";
    out += `<text x="${f(P.x)}" y="${f(P.y + font(s) * 0.36)}" text-anchor="middle" font-size="${font(s)}" fill="${INK}">${title}${escapeXml(short(s))}</text>`;
  }
  out += `<text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${INK}">${escapeXml(cap)}</text>`;
  out += `</svg>`;
  return out;
}

function altText(m: Machine, cap: string): string {
  const symbols = m.kind === "nfa" ? [EPS, ...m.alphabet] : m.alphabet;
  const arcs: string[] = [];
  for (const s of m.states) for (const a of symbols) for (const t of targets(m, s, a)) arcs.push(`${s} -${a}-> ${t}`);
  let list = arcs.join("; ");
  if (list.length > 600) list = list.slice(0, 597) + "…";
  return `State diagram: ${cap}. Start state ${m.start}; accept ${m.accept.length ? setName(m.accept) : "none"}. Transitions: ${list || "none"}.`;
}

function withFigure(res: DiscreteResult, m: Machine, cap: string): DiscreteResult {
  return { ...res, svg: machineSvg(m, cap), alt: altText(m, cap) };
}

// ---------------------------------------------------------------------------
// The modes
// ---------------------------------------------------------------------------

function answerMachine(m: Machine): DiscreteResult {
  const display = [summary(m)];
  const steps = ["Transition table (→ start, * accept):", ...tableLines(m).map((l) => "  " + l)];
  const un = unreachableLine(m);
  if (un) { display.push(un); steps.push(un); }
  runAll(m, m.tests, display, steps);
  if (!m.tests.length) steps.push(`Add a line "test: 0110 1 \"\"" to run strings (\"\" or ε is the empty string).`);
  const caveats = [CAP_CAVEAT];
  if (m.kind === "nfa") caveats.push("Each set shown after a symbol is ε-closed; a ─ε→ step appears only where the closure added states.");
  else caveats.push("A DFA block must be total and deterministic — one transition for every state and symbol.");
  return withFigure({ title: `Finite automaton — ${m.kind.toUpperCase()}`, display, steps, caveats }, m, caption(m));
}

function answerRegex(spec: RegexSpec): DiscreteResult {
  const { nfa, transitions, epsMoves } = thompson(spec.src);
  const sub = determinise(nfa, nfa.alphabet);
  const min = minimise(sub.dfa);
  const dfa = renameBfs(min.dfa);
  dfa.name = `regex ${spec.src}`;
  const display = [`Minimal DFA for ${spec.src}: ${dfa.states.length} state${dfa.states.length === 1 ? "" : "s"} over ${alphaName(dfa.alphabet)} — start ${dfa.start}, accept ${dfa.accept.length ? setName(dfa.accept) : "nothing"}`];
  const steps = [
    `Thompson NFA: ${nfa.states.length} states, ${transitions} transitions (${epsMoves} ε-moves), alphabet ${alphaName(nfa.alphabet)}.`,
    `Subset construction: ${sub.dfa.states.length} reachable DFA state${sub.dfa.states.length === 1 ? "" : "s"}${sub.dfa.dead !== undefined ? " including the dead state ∅" : ""}.`,
    `Minimisation: ${min.rounds.length - 1} refinement round${min.rounds.length === 2 ? "" : "s"} → ${dfa.states.length} states (renamed q0… in breadth-first order from the start).`,
    "Minimal DFA (→ start, * accept):",
    ...tableLines(dfa).map((l) => "  " + l),
  ];
  runAll(dfa, spec.tests, display, steps);
  steps.push(crossCheckLine("the minimal DFA and the Thompson NFA", dfa, nfa, dfa.alphabet));
  steps.push("As a block you can paste back:", ...blockLines(dfa).map((l) => "  " + l));
  const caveats = [
    "Regex syntax: letters and digits are literals, | alternation, * + ? repetition, parentheses, ε/eps the empty string, ∅ the empty language; concatenation is implicit.",
    CAP_CAVEAT,
  ];
  return withFigure({ title: "Regular expression → DFA", display, steps, caveats }, dfa, `DFA for ${spec.src} — ${dfa.states.length} states over ${alphaName(dfa.alphabet)}`);
}

function answerToDfa(spec: Spec): DiscreteResult {
  let src: Machine;
  let origin: string;
  const steps: string[] = [];
  if (spec.kind === "regex") {
    const t = thompson(spec.src);
    src = t.nfa;
    src.tests = spec.tests;
    origin = `the Thompson NFA of ${spec.src} (${src.states.length} states, ${t.transitions} transitions, ${t.epsMoves} ε-moves)`;
  } else {
    src = spec.m;
    origin = `the ${src.kind.toUpperCase()} (${src.states.length} states)`;
    if (src.kind === "dfa") steps.push("The input is already deterministic; the construction only renames each state q as {q}.");
  }
  const sub = determinise(src, src.alphabet);
  const dfa = sub.dfa;
  dfa.tests = src.tests;
  const display = [`Subset-construction DFA from ${origin}: ${dfa.states.length} reachable state${dfa.states.length === 1 ? "" : "s"} over ${alphaName(dfa.alphabet)} — start ${dfa.start}, accept ${dfa.accept.length ? setName(dfa.accept) : "nothing"}`];
  if (dfa.dead !== undefined) display.push("∅ is the dead state: once entered, no continuation can be accepted.");
  const startClosure = epsClosure(src, [src.start]);
  if (startClosure.size > 1) steps.push(`Start: ε-closure({${src.start}}) = ${setName(ordered(src, startClosure))}.`);
  steps.push("Each DFA state is a set of NFA states; for each symbol, move then ε-close (→ start, * accept):", ...tableLines(dfa).map((l) => "  " + l));
  runAll(dfa, dfa.tests, display, steps);
  steps.push(crossCheckLine("the DFA and the original NFA", dfa, src, src.alphabet));
  steps.push("As a block you can paste back (also try: minimize + this block):", ...blockLines(dfa).map((l) => "  " + l));
  const caveats = ["Only state sets reachable from the start are listed; the full power set is not built.", CAP_CAVEAT];
  const cap = `Subset-construction DFA, ${dfa.states.length} states over ${alphaName(dfa.alphabet)} (from a ${src.states.length}-state NFA)`;
  return withFigure({ title: "NFA → DFA (subset construction)", display, steps, caveats }, dfa, cap);
}

function answerMinimise(spec: Spec): DiscreteResult {
  let d: Machine;
  const steps: string[] = [];
  let origin: Machine;
  if (spec.kind === "regex") {
    const t = thompson(spec.src);
    origin = t.nfa;
    d = determinise(t.nfa, t.nfa.alphabet).dfa;
    d.tests = spec.tests;
    d.name = `regex ${spec.src}`;
    steps.push(`The regex was first turned into a DFA by subset construction (${d.states.length} states); minimising that.`);
  } else if (spec.m.kind === "nfa") {
    origin = spec.m;
    d = determinise(spec.m, spec.m.alphabet).dfa;
    d.tests = spec.m.tests;
    d.name = spec.m.name;
    steps.push(`The NFA was first made deterministic by subset construction (${d.states.length} states); minimising that.`);
  } else {
    origin = spec.m;
    d = spec.m;
  }
  const res = minimise(d);
  const min = res.dfa;
  const display: string[] = [];
  if (res.alreadyMinimal) display.push(`The DFA is already minimal: ${min.states.length} states, no two equivalent.`);
  else display.push(`Minimal DFA: ${min.states.length} state${min.states.length === 1 ? "" : "s"} (from ${d.states.length}) over ${alphaName(min.alphabet)} — start ${min.start}, accept ${min.accept.length ? setName(min.accept) : "nothing"}`);
  if (res.unreachable.length) {
    display.push(`Removed unreachable: ${res.unreachable.join(", ")}`);
    steps.push(`Unreachable from ${d.start}, removed first: ${res.unreachable.join(", ")}.`);
  }
  steps.push("Partition refinement (Moore):");
  const roundLine = (round: string[][], i: number): string => {
    const text = round.map((cls) => setName(cls)).join("  ");
    const why = i === 0 ? "accept vs non-accept" : i === res.rounds.length - 1 ? "no change — stable" : "split by where each symbol leads";
    return `  round ${i} (${why}): ${text}`;
  };
  // A typed DFA (≤ 40 states) is shown round by round; a determinised one can need hundreds.
  const SHOW = 12;
  if (res.rounds.length <= SHOW) res.rounds.forEach((round, i) => steps.push(roundLine(round, i)));
  else {
    res.rounds.slice(0, 3).forEach((round, i) => steps.push(roundLine(round, i)));
    steps.push(`  … ${res.rounds.length - 4} more rounds, each splitting at least one class …`);
    steps.push(roundLine(res.rounds[res.rounds.length - 1], res.rounds.length - 1));
  }
  const merged = res.classes.filter((c) => c.length > 1);
  steps.push(merged.length ? `Merged (indistinguishable) classes: ${merged.map((c) => setName(c)).join(", ")}.` : "No class has more than one state — nothing merges.");
  steps.push("Minimal DFA (→ start, * accept):", ...tableLines(min).map((l) => "  " + l));
  runAll(min, min.tests, display, steps);
  steps.push(crossCheckLine("both machines", min, origin, min.alphabet));
  steps.push("As a block you can paste back:", ...blockLines(min).map((l) => "  " + l));
  const caveats = ["Minimality is up to renaming: the Myhill–Nerode minimal DFA is unique, so any other correct minimisation has the same number of states.", CAP_CAVEAT];
  const cap = res.alreadyMinimal
    ? `Minimal DFA (already minimal), ${min.states.length} states over ${alphaName(min.alphabet)}`
    : `Minimal DFA, ${min.states.length} states over ${alphaName(min.alphabet)} (from ${d.states.length})`;
  return withFigure({ title: "DFA minimisation", display, steps, caveats }, min, min.name ? `${cap} — ${min.name}` : cap);
}

function describeSpec(spec: Spec): string {
  return spec.kind === "regex" ? `regex ${spec.src}` : summary(spec.m);
}

function machineOf(spec: Spec): Machine {
  if (spec.kind === "machine") return spec.m;
  const n = thompson(spec.src).nfa;
  n.tests = spec.tests;
  n.name = `regex ${spec.src}`;
  return n;
}

function answerEquivalent(partA: string[], partB: string[]): DiscreteResult {
  const specA = parseSpec(partA), specB = parseSpec(partB);
  const mA = machineOf(specA), mB = machineOf(specB);
  const alphabet = mA.alphabet.slice();
  for (const a of mB.alphabet) if (!alphabet.includes(a)) alphabet.push(a);
  if (alphabet.length > AUTOMATA_CAPS.alphabet) throw new DiscreteError(`The combined alphabet has ${alphabet.length} symbols; the cap is ${AUTOMATA_CAPS.alphabet}.`);
  const dA = determinise(mA, alphabet).dfa, dB = determinise(mB, alphabet).dfa;
  const w = distinguish(dA, dB, alphabet);
  const steps = [
    `Machine 1: ${describeSpec(specA)}`,
    `Machine 2: ${describeSpec(specB)}`,
    `Both made deterministic over the combined alphabet ${alphaName(alphabet)}: ${dA.states.length} and ${dB.states.length} states.`,
    "Breadth-first search over the product automaton for a pair of states where exactly one machine accepts:",
  ];
  const display: string[] = [];
  const caveats = [
    "A symbol that one machine's alphabet lacks is treated as leading that machine to a dead state (it rejects every string containing it).",
    CAP_CAVEAT,
  ];
  if (w === null) {
    display.push("Equivalent: YES — the two machines accept exactly the same strings.");
    steps.push("  no such pair is reachable, so no string is accepted by one and rejected by the other.");
    steps.push(crossCheckLine("machine 1 and machine 2", mA, mB, alphabet));
  } else {
    const accA = accepts(mA, w), accB = accepts(mB, w);
    if (accA === accB) throw new DiscreteError(`Internal cross-check failed: the product search found ${showStr(w)} but both machines ${accA ? "accept" : "reject"} it.`);
    display.push(`Equivalent: NO — shortest distinguishing string ${showStr(w)}: ${accA ? "accepted" : "rejected"} by machine 1, ${accB ? "accepted" : "rejected"} by machine 2.`);
    steps.push(`  found at depth ${w.length}: ${showStr(w)} (shortest; ties broken in alphabet order).`);
    steps.push(`verified: machine 1 ${accA ? "accepts" : "rejects"} ${showStr(w)} and machine 2 ${accB ? "accepts" : "rejects"} it, run on the original machines.`);
  }
  const tests = [...mA.tests, ...mB.tests].filter((t, i, arr) => arr.indexOf(t) === i);
  if (tests.length) {
    steps.push("Test runs on both:");
    for (const t of tests) {
      const bad = [...t].find((c) => !alphabet.includes(c));
      if (bad !== undefined) { steps.push(`  ${showStr(t)} — not run: symbol "${bad}" is not in ${alphaName(alphabet)}`); continue; }
      const a = accepts(mA, t), b = accepts(mB, t);
      steps.push(`  ${showStr(t)}: machine 1 ${a ? "accepts" : "rejects"}, machine 2 ${b ? "accepts" : "rejects"}${a === b ? "" : " — DIFFER"}`);
    }
  }
  // Figure: machine 1 as typed (a regex becomes its minimal DFA).
  const fig = specA.kind === "regex" ? (() => { const r = renameBfs(minimise(dA).dfa); r.name = `regex ${specA.src}`; return r; })() : mA;
  const verdict = w === null ? "equivalent to machine 2" : `differs from machine 2 on ${showStr(w)}`;
  const cap = `Machine 1 (${fig.kind.toUpperCase()}, ${fig.states.length} states over ${alphaName(fig.alphabet)}) — ${verdict}`;
  return withFigure({ title: "Equivalence of automata", display, steps, caveats }, fig, cap);
}

// ---------------------------------------------------------------------------
// Front door
// ---------------------------------------------------------------------------

/** null when the text is not an automata request; DiscreteError when it is one that cannot be answered. */
export function tryAutomata(input: string): DiscreteResult | null {
  const all = lines(input);
  const firstIdx = all.findIndex((l) => l);
  if (firstIdx < 0) return null;
  const first = all[firstIdx];
  const kw = KEYWORD.exec(first);
  if (!kw) return null;
  const word = kw[1].toLowerCase().replace(/\s+/g, " ");
  const body = all.slice(firstIdx + 1);
  try {
    if (word === "dfa" || word === "nfa") return answerMachine(machineOf(parseSpec(all.slice(firstIdx))));
    if (word === "regex") {
      const spec = parseSpec(all.slice(firstIdx));
      return spec.kind === "regex" ? answerRegex(spec) : answerMachine(spec.m);
    }
    if (word === "to dfa") {
      if (!body.some((l) => l)) throw new DiscreteError('"to dfa" needs an nfa block (or a "regex …" line) on the following lines.');
      return answerToDfa(parseSpec(body));
    }
    if (word === "minimize" || word === "minimise") {
      if (!body.some((l) => l)) throw new DiscreteError(`"${word}" needs a dfa block on the following lines.`);
      return answerMinimise(parseSpec(body));
    }
    // equivalent: two parts separated by a blank line or a --- line.
    const parts: string[][] = [[]];
    for (const l of body) {
      if (!l || /^(-{3,}|={3,})$/.test(l)) { if (parts[parts.length - 1].length) parts.push([]); continue; }
      parts[parts.length - 1].push(l);
    }
    const nonEmpty = parts.filter((p) => p.length);
    if (nonEmpty.length !== 2) {
      throw new DiscreteError(`"equivalent" needs exactly two machines (dfa/nfa blocks or regex lines) separated by a blank line or a line "---"; found ${nonEmpty.length}.`);
    }
    return answerEquivalent(nonEmpty[0], nonEmpty[1]);
  } catch (e) {
    if (e instanceof DiscreteError) throw e;
    throw new DiscreteError(`Could not read that automata request: ${e instanceof Error ? e.message : String(e)}`);
  }
}
