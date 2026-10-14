// Pushdown automata — one engine of the Discrete-math Solve kind.
//
// Surface forms (the first non-empty line decides; case-insensitive):
//   pda / npda / dpda / pushdown automaton   a block: states, alphabet, stack, start, accept, moves, test
//   cfg to pda GRAMMAR                       the standard one-state construction (accept by empty stack)
//   pda for a^n b^n                          the ONE template; every other prose language is refused by name
//
// The block grammar is automata.ts's (heads, tokens, ε spellings, test: lines) with a `stack:`
// head whose FIRST symbol is the bottom marker, and moves in four spellings:
//   q0 a Z -> q0 AZ · q0, a, Z -> q0, AZ · (q0, a, Z) -> (q0, AZ) · q0 a Z / AZ -> q0 · δ(q0, a, Z) = (q0, AZ)
// A push string is written TOP-first (AZ = A on top of Z); ε pushes nothing (a pop); an ε input
// reads nothing. Acceptance is by final state, by empty stack, or by both — ALWAYS said, because
// the same machine accepts different languages under the two conventions.
//
// Nondeterminism is a breadth-first search over configurations (state, unread input, stack):
// every cap (configurations, stack depth) is checked before the work it bounds and a cap hit is
// an UNKNOWN verdict by name, never a rejection. The accepting run found is a shortest one
// (BFS), and it is re-simulated deterministically before it is reported.

import { DiscreteError, DiscreteResult } from "./discrete";
import {
  AUTOMATA_CAPS, EPS, lines, tokens, normSymbol, parseTests, checkTests, headOf, setName, showStr,
  stateDiagramSvg, configStripSvg, composeSvgs, stripWindow, DiagramEdge, StripStep,
} from "./automata";
import { Grammar, parseGrammar, printGrammar, cykMember, bruteMember } from "./grammar";

export const PDA_CAPS = {
  /** States in a typed block. */
  states: 40,
  /** Input symbols. */
  alphabet: 10,
  /** Stack symbols. */
  stackAlphabet: 20,
  /** Moves (transitions) in a block. */
  moves: 200,
  /** Configurations the breadth-first search may visit per test string. */
  configurations: 20000,
  /** Symbols on the stack; a move that would exceed it cuts that branch (UNKNOWN, not rejected). */
  stackDepth: 200,
  /** Strings enumerated for the grammar cross-check (≤ 100 strings) … */
  sampleLength: 4,
  /** … each searched with this smaller configuration budget (undecided strings are counted, not guessed). */
  sampleConfigurations: 2000,
  /** Longest string checked against the aⁿbⁿ template language (2⁹ − 1 = 511 strings). */
  languageCheckLength: 8,
} as const;

/** Keyword-led, like dfa/nfa; also claims "cfg to pda …" / "… to pda" as the construction verb. */
export const PDA_RE = /^\s*(?:(?:cfg|grammar|context[-\s]free(?:\s+grammar)?)?\s*(?:to|→|->)\s+pda\b|(?:pda|pushdown(?:\s+automaton)?|npda|dpda)\b)/i;
const TO_PDA_LINE = /^(?:cfg|grammar|context[-\s]free(?:\s+grammar)?)?\s*(?:to|→|->)\s+pda\b\s*[:\-—]?\s*(.*)$/i;
const TEMPLATE_LINE = /^(?:pda|pushdown(?:\s+automaton)?|npda|dpda)\s+(?:for|of|recogni[sz]ing|accepting|that\s+accepts)\s+(.+)$/i;
const ANBN = /^\{?\s*a\s*(?:\^|\*\*)?\s*\{?(?:n|ⁿ)\}?\s*b\s*(?:\^|\*\*)?\s*\{?(?:n|ⁿ)\}?\s*(?:[|:,]?\s*n\s*(?:>=|≥|>|=)\s*[01])?\s*\}?\s*$/i;

export interface PdaMove {
  from: string;
  /** An input symbol, or EPS for a move that reads nothing. */
  input: string;
  /** The stack symbol read (and popped). */
  top: string;
  to: string;
  /** Pushed in place of `top`, TOP-first; empty = a pop. */
  push: string[];
  line: string;
}

export interface Pda {
  name: string;
  states: string[];
  alphabet: string[];
  /** Stack alphabet in declared order; `bottom` is on the stack initially. */
  stack: string[];
  bottom: string;
  start: string;
  acceptStates: string[];
  mode: "final" | "empty" | "both";
  moves: PdaMove[];
  tests: string[];
  /** The block said dpda / deterministic. */
  deterministic: boolean;
  /** Set for a PDA built from a grammar (its input symbols may be multi-character terminals). */
  fromGrammar?: { text: string; terminals: string[] };
}

// ---------------------------------------------------------------------------
// Reading a block
// ---------------------------------------------------------------------------

const stripParens = (s: string): string => s.replace(/[(){}[\]]/g, " ").trim();

/** Splits a push string into stack symbols by longest match against the stack alphabet; the
 *  leftover (an undeclared symbol) is returned so the caller can refuse by name. */
function splitPush(raw: string, stackSyms: string[]): { syms: string[]; leftover: string | null } {
  const s = raw.replace(/\s+/g, "");
  if (!s) return { syms: [], leftover: null };
  const sorted = stackSyms.slice().sort((a, b) => b.length - a.length);
  const syms: string[] = [];
  let i = 0;
  while (i < s.length) {
    const hit = sorted.find((sym) => s.startsWith(sym, i));
    if (!hit) return { syms, leftover: s.slice(i) };
    syms.push(hit);
    i += hit.length;
  }
  return { syms, leftover: null };
}

/** `push` holds the push string as typed, one entry per whitespace-separated token ("AZ" or "A Z"). */
interface RawMove { from: string; input: string; top: string; to: string; push: string[]; line: string }

/** The move spellings. Returns [] for a line that is not a move at all (no arrow). */
function parseMoveLine(line: string): RawMove[] {
  let left: string, rights: string[];
  const delta = /^(?:δ|delta)\s*\((.*?)\)\s*=\s*(.*)$/i.exec(line);
  if (delta) {
    left = delta[1];
    const groups = [...delta[2].matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
    rights = groups.length ? groups : [stripParens(delta[2])];
  } else {
    const arrow = /^(.*?)\s*(?:->|→)\s*(.*)$/.exec(line);
    if (!arrow) return [];
    left = arrow[1];
    const groups = [...arrow[2].matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
    rights = groups.length ? groups : [stripParens(arrow[2])];
  }
  let pushOnLeft: string[] | null = null;
  const slash = left.indexOf("/");
  if (slash >= 0) { pushOnLeft = tokens(stripParens(left.slice(slash + 1))); left = left.slice(0, slash); }
  const lt = tokens(stripParens(left));
  if (lt.length !== 3) {
    throw new DiscreteError(`Move "${line}" needs three things on the left — state, input symbol, stack top — e.g. "q0 a Z -> q0 AZ" (ε for an empty input); found ${lt.length}.`);
  }
  const out: RawMove[] = [];
  for (const r of rights) {
    const rt = tokens(r);
    if (pushOnLeft !== null) {
      if (rt.length !== 1) throw new DiscreteError(`Move "${line}" writes the push string before the arrow (top / push), so only the target state may follow it; found "${r.trim()}".`);
      out.push({ from: lt[0], input: normSymbol(lt[1]), top: lt[2], to: rt[0], push: pushOnLeft, line });
    } else {
      if (rt.length < 1) throw new DiscreteError(`Move "${line}" has nothing after the arrow — write the target state and the push string, e.g. "-> q0 AZ" (ε to pop).`);
      out.push({ from: lt[0], input: normSymbol(lt[1]), top: lt[2], to: rt[0], push: rt.slice(1), line });
    }
  }
  return out;
}

function parseAccept(v: string): { states: string[]; empty: boolean } {
  const l = v.toLowerCase();
  const empty = /\bempty\b|ε-?stack/.test(l);
  const cleaned = v.replace(/empty-?stack|\bempty\b|\bstack\b|\bby\b|\band\b|\bor\b|\bfinal\b|\bstates?\b|\bacceptance\b|[&+]/gi, " ");
  return { states: tokens(cleaned), empty };
}

const EXTRA_HEADS = ["stack(?:\\s+alphabet|\\s+symbols)?", "gamma", "input(?:\\s+alphabet)?", "bottom", "initial\\s+stack", "start\\s+stack", "acceptance", "mode"];

/** Reads the lines after the keyword line. */
export function parsePdaBlock(body: string[], name: string, deterministic: boolean): Pda {
  let states: string[] | null = null;
  let alphabet: string[] | null = null;
  let stack: string[] | null = null;
  let bottom: string | null = null;
  let start: string | null = null;
  let acceptStates: string[] | null = null;
  let emptyMode = false;
  let sawAccept = false;
  const tests: string[] = [];
  const raw: RawMove[] = [];
  let pdaName = name;

  for (const line of body) {
    if (!line) continue;
    const head = headOf(line, EXTRA_HEADS);
    if (head) {
      const k = head.key.replace(/\s+/g, " ");
      const v = head.value;
      if (k === "state" || k === "states") states = tokens(v);
      else if (k === "alphabet" || k === "sigma" || k === "symbol" || k === "symbols" || k === "input" || k === "input alphabet") alphabet = tokens(v).map(normSymbol);
      else if (k.startsWith("stack") || k === "gamma") stack = tokens(v);
      else if (k === "bottom" || k === "initial stack" || k === "start stack") {
        const t = tokens(v);
        if (t.length !== 1) throw new DiscreteError(`${head.key}: must name exactly one stack symbol (got "${v}").`);
        bottom = t[0];
      } else if (k === "start" || k === "initial") {
        const t = tokens(v);
        if (t.length !== 1) throw new DiscreteError(`start: must name exactly one state (got "${v}").`);
        start = t[0];
      } else if (k === "accept" || k === "accepting" || k === "final" || k === "acceptance" || k === "mode") {
        const a = parseAccept(v);
        sawAccept = true;
        acceptStates = [...(acceptStates ?? []), ...a.states];
        emptyMode = emptyMode || a.empty;
      } else if (k === "name" || k === "title") pdaName = v;
      else parseTests(v, tests);
      continue;
    }
    const moves = parseMoveLine(line);
    if (!moves.length) {
      throw new DiscreteError(`Line "${line}" is not a move — write "state input top -> state push" (e.g. "q0 a Z -> q0 AZ", "(q0, a, Z) -> (q0, AZ)", "q0 a Z / AZ -> q0" or "δ(q0, a, Z) = (q0, AZ)"), or a head line such as stack: or test:.`);
    }
    raw.push(...moves);
  }

  if (start === null) throw new DiscreteError('The PDA block needs a "start: <state>" line.');
  if (!sawAccept) throw new DiscreteError('The PDA block needs an "accept:" line — accept: q2 (by final state), accept: empty stack, or accept: q2 and empty stack.');
  if (stack === null && bottom === null) throw new DiscreteError('The PDA block needs a "stack: Z A …" line naming the stack symbols, the FIRST being the bottom marker (or a "bottom: Z" line).');
  if (raw.length > PDA_CAPS.moves) throw new DiscreteError(`${raw.length} moves exceed the cap of ${PDA_CAPS.moves}.`);

  const accept = acceptStates ?? [];
  if (states === null) {
    states = [start];
    for (const m of raw) for (const s of [m.from, m.to]) if (!states.includes(s)) states.push(s);
    for (const s of accept) if (!states.includes(s)) states.push(s);
  }
  if (alphabet === null) {
    alphabet = [];
    for (const m of raw) if (m.input !== EPS && !alphabet.includes(m.input)) alphabet.push(m.input);
  }
  if (stack === null) {
    stack = [bottom as string];
    for (const m of raw) if (!stack.includes(m.top)) stack.push(m.top);
  }
  if (bottom === null) bottom = stack[0];

  if (!states.length) throw new DiscreteError("The machine has no states.");
  if (states.length > PDA_CAPS.states) throw new DiscreteError(`${states.length} states exceed the cap of ${PDA_CAPS.states}.`);
  const dupState = states.find((s, i) => states!.indexOf(s) !== i);
  if (dupState !== undefined) throw new DiscreteError(`State "${dupState}" is listed twice.`);
  if (alphabet.length > PDA_CAPS.alphabet) throw new DiscreteError(`${alphabet.length} input symbols exceed the cap of ${PDA_CAPS.alphabet}.`);
  for (const a of alphabet) {
    if (a === EPS) throw new DiscreteError("ε is the empty input, not an alphabet symbol — leave it out of alphabet:.");
    if ([...a].length !== 1) throw new DiscreteError(`Input symbol "${a}" must be a single character, so that test strings read unambiguously.`);
  }
  if (!stack.length) throw new DiscreteError("The stack alphabet is empty.");
  if (stack.length > PDA_CAPS.stackAlphabet) throw new DiscreteError(`${stack.length} stack symbols exceed the cap of ${PDA_CAPS.stackAlphabet}.`);
  for (const z of stack) {
    if (z === EPS || normSymbol(z) === EPS) throw new DiscreteError("ε is the empty push, not a stack symbol — leave it out of stack:.");
    if (/[/,()]/.test(z)) throw new DiscreteError(`Stack symbol "${z}" may not contain / , ( or ).`);
  }
  const dupStack = stack.find((s, i) => stack!.indexOf(s) !== i);
  if (dupStack !== undefined) throw new DiscreteError(`Stack symbol "${dupStack}" is listed twice.`);
  if (!stack.includes(bottom)) throw new DiscreteError(`Bottom marker "${bottom}" is not one of the stack symbols ${setName(stack)}.`);
  const stateSet = new Set(states);
  if (!stateSet.has(start)) throw new DiscreteError(`Start state "${start}" is not one of the declared states ${setName(states)}.`);
  for (const a of accept) if (!stateSet.has(a)) throw new DiscreteError(`Accept state "${a}" is not one of the declared states ${setName(states)}.`);
  const symSet = new Set(alphabet);
  const moves: PdaMove[] = [];
  for (const m of raw) {
    if (!stateSet.has(m.from)) throw new DiscreteError(`Move "${m.line}" names unknown state "${m.from}" — declared states are ${setName(states)}.`);
    if (!stateSet.has(m.to)) throw new DiscreteError(`Move "${m.line}" names unknown state "${m.to}" — declared states are ${setName(states)}.`);
    if (m.input !== EPS && !symSet.has(m.input)) throw new DiscreteError(`Move "${m.line}" reads input symbol "${m.input}", which is not in the alphabet ${setName(alphabet)}.`);
    if (normSymbol(m.top) === EPS) throw new DiscreteError(`Move "${m.line}" must name the stack symbol it reads — a PDA move always looks at the top of the stack.`);
    if (!stack.includes(m.top)) throw new DiscreteError(`Move "${m.line}" reads stack symbol "${m.top}", which is not in the stack alphabet ${setName(stack)}.`);
    const pushSyms: string[] = [];
    const rawPush = m.push.filter((t) => normSymbol(t) !== EPS);
    for (const tok of rawPush) {
      const part = splitPush(tok, stack);
      if (part.leftover !== null) {
        const bad = stack.every((z) => [...z].length === 1) ? [...part.leftover][0] : part.leftover;
        throw new DiscreteError(`Move "${m.line}" pushes "${m.push.join(" ")}", but "${bad}" is not a declared stack symbol — the stack alphabet is ${setName(stack)}; add it to the stack: line if it was meant.`);
      }
      pushSyms.push(...part.syms);
    }
    moves.push({ from: m.from, input: m.input, top: m.top, to: m.to, push: pushSyms, line: m.line });
  }
  const uniqAccept = accept.filter((s, i) => accept.indexOf(s) === i);
  const mode: Pda["mode"] = emptyMode && uniqAccept.length ? "both" : emptyMode ? "empty" : "final";
  checkTests(tests);
  const p: Pda = { name: pdaName, states, alphabet, stack, bottom, start, acceptStates: uniqAccept, mode, moves, tests, deterministic };
  if (deterministic) checkDeterministic(p);
  return p;
}

/** A DPDA claim: at most one move per (state, input, top), and no ε-move beside an input move on the same (state, top). */
function checkDeterministic(p: Pda): void {
  const seen = new Map<string, PdaMove>();
  for (const m of p.moves) {
    const k = `${m.from}\u0001${m.input}\u0001${m.top}`;
    const prev = seen.get(k);
    if (prev) {
      throw new DiscreteError(`Claimed deterministic (dpda), but ${m.from} has two moves on (${m.from}, ${m.input}, ${m.top}): "${prev.line}" and "${m.line}". Write pda (or npda) for a nondeterministic machine.`);
    }
    seen.set(k, m);
  }
  for (const m of p.moves) {
    if (m.input !== EPS) continue;
    const clash = p.moves.find((o) => o.from === m.from && o.top === m.top && o.input !== EPS);
    if (clash) throw new DiscreteError(`Claimed deterministic (dpda), but ${m.from} has both an ε-move and a move on "${clash.input}" with ${m.top} on top: "${m.line}" and "${clash.line}" — that is a choice, so the machine is not a DPDA.`);
  }
}

// ---------------------------------------------------------------------------
// Printing (the display contract: this block re-parses through parsePdaBlock)
// ---------------------------------------------------------------------------

const singleCharStack = (p: Pda): boolean => p.stack.every((z) => [...z].length === 1);
const singleCharInput = (p: Pda): boolean => p.alphabet.every((a) => [...a].length === 1);

export function pushStr(p: Pda, push: string[]): string {
  return push.length ? push.join(singleCharStack(p) ? "" : " ") : EPS;
}
export function stackStr(p: Pda, stack: string[]): string {
  return stack.length ? stack.join(singleCharStack(p) ? "" : " ") : EPS;
}
export function inputStr(p: Pda, syms: string[]): string {
  return syms.length ? syms.join(singleCharInput(p) ? "" : " ") : EPS;
}
export function moveStr(p: Pda, m: PdaMove): string {
  return `${m.from} ${m.input} ${m.top} → ${m.to} ${pushStr(p, m.push)}`;
}
export function acceptLine(p: Pda): string {
  if (p.mode === "empty") return "accept: empty stack";
  if (p.mode === "both") return `accept: ${p.acceptStates.join(" ")} and empty stack`;
  return `accept: ${p.acceptStates.join(" ")}`;
}
export function modeName(p: Pda): string {
  return p.mode === "empty" ? "empty stack" : p.mode === "both" ? `final state AND empty stack (accept ${setName(p.acceptStates)})` : `final state (accept ${p.acceptStates.length ? setName(p.acceptStates) : "none declared — accepts nothing"})`;
}

/** The machine as a block that parses back. */
export function pdaBlockLines(p: Pda, withTests = true): string[] {
  const out = [
    p.deterministic ? "dpda" : "pda",
    `states: ${p.states.join(" ")}`,
    `alphabet: ${p.alphabet.join(" ")}`,
    `stack: ${[p.bottom, ...p.stack.filter((z) => z !== p.bottom)].join(" ")}`,
    `start: ${p.start}`,
    acceptLine(p),
    ...p.moves.map((m) => moveStr(p, m)),
  ];
  if (withTests && p.tests.length) out.push(`test: ${p.tests.map((t) => (t === "" ? '""' : t)).join(" ")}`);
  return out;
}

// ---------------------------------------------------------------------------
// Simulation: breadth-first over configurations
// ---------------------------------------------------------------------------

export interface PdaConfig { state: string; pos: number; stack: string[] }

export interface PdaRun {
  verdict: "accepted" | "rejected" | "unknown";
  /** The accepting run (verdict accepted) or the deepest dead branch (rejected / unknown). */
  path: { config: PdaConfig; move?: PdaMove }[];
  /** Branch ends explored (dead ends, cut branches, the accepting one). */
  branches: number;
  configurations: number;
  /** Which cap stopped the search, when one did. */
  cap: "configurations" | "stack depth" | null;
  /** For a rejection: the dead configuration that read the most input (absent when every branch
   *  only returned to configurations already visited — an ε-cycle). */
  stuck?: PdaConfig;
  /** Some successor was cut because its configuration had been visited already. */
  cycled: boolean;
}

/** Splits a test string into input symbols (single characters, or longest-match terminals for a grammar PDA). */
export function splitInput(p: Pda, s: string): string[] | null {
  if (singleCharInput(p)) {
    const out = [...s];
    return out.every((c) => p.alphabet.includes(c)) ? out : null;
  }
  const r = splitPush(s, p.alphabet);
  return r.leftover === null ? r.syms : null;
}

function isAccepting(p: Pda, c: PdaConfig, n: number): boolean {
  if (c.pos !== n) return false;
  const fin = p.acceptStates.includes(c.state), emp = c.stack.length === 0;
  return p.mode === "final" ? fin : p.mode === "empty" ? emp : fin && emp;
}

/** Breadth-first over configurations; the whole reachable space is explored (within the caps) so
 *  the branch count is complete, and the FIRST accepting configuration dequeued gives a shortest
 *  accepting run. `maxConfigs` lets a sampling caller use a smaller budget. */
export function runPda(p: Pda, input: string[], maxConfigs: number = PDA_CAPS.configurations): PdaRun {
  const n = input.length;
  // Moves indexed by (state, top) so a configuration's successors are a short list.
  const byKey = new Map<string, PdaMove[]>();
  for (const m of p.moves) {
    const k = m.from + "\u0001" + m.top;
    const list = byKey.get(k);
    if (list) list.push(m); else byKey.set(k, [m]);
  }
  type Node = { config: PdaConfig; parent: number; move?: PdaMove };
  const nodes: Node[] = [{ config: { state: p.start, pos: 0, stack: [p.bottom] }, parent: -1 }];
  const key = (c: PdaConfig) => `${c.state}\u0001${c.pos}\u0001${c.stack.join("\u0002")}`;
  const visited = new Set<string>([key(nodes[0].config)]);
  let branches = 0;
  let cap: PdaRun["cap"] = null;
  let stuck: { idx: number } | null = null;
  const pathTo = (idx: number): PdaRun["path"] => {
    const out: PdaRun["path"] = [];
    for (let i = idx; i >= 0; i = nodes[i].parent) out.push({ config: nodes[i].config, move: nodes[i].move });
    out.reverse();
    // The move stored on a node is the one that PRODUCED it; shift it onto the configuration it was taken from.
    return out.map((e, i) => ({ config: e.config, move: out[i + 1]?.move }));
  };
  let accepted: number | null = null;
  let cycled = false;
  for (let head = 0; head < nodes.length; head++) {
    const c = nodes[head].config;
    if (isAccepting(p, c, n)) {
      branches++;
      if (accepted === null) accepted = head;
      continue;
    }
    let succ = 0;
    if (c.stack.length) {
      const list = byKey.get(c.state + "\u0001" + c.stack[0]) ?? [];
      for (const m of list) {
        if (m.input !== EPS && (c.pos >= n || input[c.pos] !== m.input)) continue;
        const stack = [...m.push, ...c.stack.slice(1)];
        if (stack.length > PDA_CAPS.stackDepth) { cap = cap ?? "stack depth"; branches++; succ++; continue; }
        const next: PdaConfig = { state: m.to, pos: c.pos + (m.input === EPS ? 0 : 1), stack };
        const k = key(next);
        if (visited.has(k)) { succ++; cycled = true; continue; }
        if (nodes.length >= maxConfigs) { cap = cap ?? "configurations"; branches++; succ++; continue; }
        visited.add(k);
        nodes.push({ config: next, parent: head, move: m });
        succ++;
      }
    }
    if (!succ) {
      branches++;
      if (!stuck || c.pos > nodes[stuck.idx].config.pos) stuck = { idx: head };
    }
  }
  if (accepted !== null) return { verdict: "accepted", path: pathTo(accepted), branches, configurations: nodes.length, cap, cycled };
  const deepest = stuck ? stuck.idx : nodes.length - 1;
  return { verdict: cap ? "unknown" : "rejected", path: pathTo(deepest), branches, configurations: nodes.length, cap, stuck: stuck ? nodes[stuck.idx].config : undefined, cycled };
}

/** Replays a run's moves one by one from the start configuration — the cross-check on the
 *  BFS result. Returns the final configuration, or throws naming the move that does not apply. */
export function replay(p: Pda, input: string[], moves: PdaMove[]): PdaConfig {
  let c: PdaConfig = { state: p.start, pos: 0, stack: [p.bottom] };
  for (const m of moves) {
    if (m.from !== c.state) throw new Error(`move "${m.line}" starts in ${m.from} but the machine is in ${c.state}`);
    if (!c.stack.length || c.stack[0] !== m.top) throw new Error(`move "${m.line}" reads ${m.top} but the stack top is ${c.stack[0] ?? "empty"}`);
    if (m.input !== EPS) {
      if (c.pos >= input.length || input[c.pos] !== m.input) throw new Error(`move "${m.line}" reads ${m.input} but the next input is ${c.pos < input.length ? input[c.pos] : "nothing"}`);
    }
    c = { state: m.to, pos: c.pos + (m.input === EPS ? 0 : 1), stack: [...m.push, ...c.stack.slice(1)] };
  }
  return c;
}

const sameConfig = (a: PdaConfig, b: PdaConfig): boolean => a.state === b.state && a.pos === b.pos && a.stack.length === b.stack.length && a.stack.every((z, i) => z === b.stack[i]);

/** Accept/reject/unknown for a string, with the BFS run verified by replay. */
export function pdaAccepts(p: Pda, s: string, maxConfigs: number = PDA_CAPS.configurations): "accepted" | "rejected" | "unknown" | "not run" {
  const input = splitInput(p, s);
  if (input === null) return "not run";
  const r = runPda(p, input, maxConfigs);
  if (r.verdict === "accepted") {
    const fin = replay(p, input, r.path.map((e) => e.move).filter((m): m is PdaMove => !!m));
    if (!sameConfig(fin, r.path[r.path.length - 1].config) || !isAccepting(p, fin, input.length)) {
      throw new DiscreteError(`Internal cross-check failed: the accepting run found for ${showStr(s)} does not replay to an accepting configuration. Nothing was returned rather than a wrong verdict.`);
    }
  }
  return r.verdict;
}

// ---------------------------------------------------------------------------
// Grammar → PDA (the one-state construction), on grammar.ts's reader
// ---------------------------------------------------------------------------

const joinSyms = (syms: string[]): string => (syms.length ? syms.join(syms.every((s) => [...s].length === 1) ? "" : " ") : EPS);

/** The standard construction: one state q, stack alphabet = N ∪ Σ, start with S on the stack,
 *  `ε, A → α` for every production, `a, a → ε` for every terminal; accept by empty stack. */
export function grammarToPda(g: Grammar, tests: string[], text: string): Pda {
  const clash = g.terminals.find((t) => g.nonterminals.includes(t));
  if (clash) throw new DiscreteError(`"${clash}" is both a terminal and a nonterminal — the construction needs them disjoint.`);
  const stack = [g.start, ...g.nonterminals.filter((n) => n !== g.start), ...g.terminals];
  const moves: PdaMove[] = [];
  for (const r of g.productions) moves.push({ from: "q", input: EPS, top: r.lhs, to: "q", push: r.rhs.slice(), line: `q ε ${r.lhs} → q ${joinSyms(r.rhs)}` });
  for (const t of g.terminals) moves.push({ from: "q", input: t, top: t, to: "q", push: [], line: `q ${t} ${t} → q ${EPS}` });
  if (g.terminals.length > PDA_CAPS.alphabet) throw new DiscreteError(`${g.terminals.length} terminals exceed the cap of ${PDA_CAPS.alphabet} input symbols.`);
  if (stack.length > PDA_CAPS.stackAlphabet) throw new DiscreteError(`${stack.length} grammar symbols exceed the cap of ${PDA_CAPS.stackAlphabet} stack symbols.`);
  return {
    name: "from a grammar",
    states: ["q"], alphabet: g.terminals.slice(), stack, bottom: g.start, start: "q", acceptStates: [], mode: "empty",
    moves, tests, deterministic: false, fromGrammar: { text, terminals: g.terminals },
  };
}
// ---------------------------------------------------------------------------
// The template language check (aⁿbⁿ, the one template)
// ---------------------------------------------------------------------------

/** Does the machine agree with aⁿbⁿ (n ≥ 0) on every string of length ≤ 8 over {a, b}?
 *  "all" / "all-but-empty" (it rejects only the empty string) / null (something else, or not over {a,b}). */
export function anbnCheck(p: Pda): "all" | "all-but-empty" | null {
  if (p.alphabet.length !== 2 || !p.alphabet.includes("a") || !p.alphabet.includes("b")) return null;
  let emptyOnly = false;
  let layer = [""];
  for (let len = 0; len <= PDA_CAPS.languageCheckLength; len++) {
    for (const s of layer) {
      const want = /^a*$/.test(s.slice(0, s.length / 2)) && /^b*$/.test(s.slice(s.length / 2)) && s.length % 2 === 0;
      const got = pdaAccepts(p, s, 400);
      if (got === "unknown" || got === "not run") return null;
      if ((got === "accepted") !== want) { if (s === "" && want) emptyOnly = true; else return null; }
    }
    const next: string[] = [];
    for (const s of layer) for (const c of ["a", "b"]) next.push(s + c);
    layer = next;
  }
  return emptyOnly ? "all-but-empty" : "all";
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Reads back one printed configuration "(q0, abb, AZ)" against a machine: the state, the unread
 *  input as symbols and the stack top-first (ε = empty). null when it is not one. */
export function parseConfig(p: Pda, text: string): { state: string; input: string[]; stack: string[] } | null {
  const m = /^\(\s*([^,()\s]+)\s*,\s*([^,()]*?)\s*,\s*([^,()]*?)\s*\)$/.exec(text.trim());
  if (!m || !p.states.includes(m[1])) return null;
  const input = m[2] === EPS || m[2] === "" ? [] : splitInput(p, m[2].replace(/\s+/g, ""));
  if (input === null) return null;
  let stack: string[] = [];
  if (m[3] !== EPS && m[3] !== "") {
    for (const tok of m[3].split(/\s+/)) {
      const part = splitPush(tok, p.stack);
      if (part.leftover !== null) return null;
      stack = [...stack, ...part.syms];
    }
  }
  return { state: m[1], input, stack };
}

export function configStr(p: Pda, input: string[], c: PdaConfig): string {
  return `(${c.state}, ${inputStr(p, input.slice(c.pos))}, ${stackStr(p, c.stack)})`;
}

// A FUNCTION, not a constant: discrete.ts imports this module, and automata.ts
// imports discrete.ts for DiscreteError — so when automata is loaded first,
// AUTOMATA_CAPS is still undefined while this module initialises (the
// import-cycle trap of v2.124.0). Reading it at call time is safe.
const capCaveat = (): string => `Caps: ≤ ${PDA_CAPS.states} states, ≤ ${PDA_CAPS.alphabet} input symbols, ≤ ${PDA_CAPS.stackAlphabet} stack symbols, ≤ ${PDA_CAPS.moves} moves, ≤ ${AUTOMATA_CAPS.testCount} test strings of ≤ ${AUTOMATA_CAPS.testLength} characters; the search visits ≤ ${PDA_CAPS.configurations.toLocaleString("en-US")} configurations per string and cuts any branch whose stack would exceed ${PDA_CAPS.stackDepth} symbols — a cap hit is reported as UNKNOWN, never as a rejection.`;

function summary(p: Pda): string {
  return `PDA, ${p.states.length} state${p.states.length === 1 ? "" : "s"}, input alphabet ${setName(p.alphabet)}, stack alphabet ${setName(p.stack)} (bottom ${p.bottom}) — acceptance by ${modeName(p)}`;
}

function figure(p: Pda, strip: { input: string[]; run: PdaRun; label: string } | null, caption: string): { svg: string; alt: string } {
  const edges: DiagramEdge[] = p.moves.map((m) => ({ from: m.from, to: m.to, label: `${m.input}, ${m.top}/${pushStr(p, m.push)}` }));
  const parts = [stateDiagramSvg({ states: p.states, start: p.start, accept: p.acceptStates, edges, caption, labels: "stack" })];
  let altStrip = "";
  if (strip) {
    const steps: StripStep[] = strip.run.path.map((e, i) => ({ label: String(i), state: e.config.state, cells: e.config.stack, input: inputStr(p, strip.input.slice(e.config.pos)) }));
    const win = stripWindow(steps.length);
    parts.push(configStripSvg({ kind: "stack", steps, caption: strip.label }));
    altStrip = ` Configuration strip for ${strip.label}: ${steps.length} configurations${win.omitted ? ` (first ${win.first} and last ${win.last} drawn)` : ""}, stacks drawn top-first with the top boxed.`;
  }
  const arcs = p.moves.map((m) => `${m.from} -${m.input}, ${m.top}/${pushStr(p, m.push)}-> ${m.to}`).join("; ");
  const alt = `State diagram: ${caption}. Start ${p.start}; accept ${p.acceptStates.length ? setName(p.acceptStates) : "none"}; ${p.mode === "empty" ? "acceptance by empty stack" : p.mode === "both" ? "acceptance by final state and empty stack" : "acceptance by final state"}. Moves: ${arcs.length > 600 ? arcs.slice(0, 597) + "…" : arcs}.${altStrip}`;
  return { svg: composeSvgs(parts), alt };
}

function runAll(p: Pda, display: string[], steps: string[], caveats: string[]): { input: string[]; run: PdaRun; label: string } | null {
  if (!p.tests.length) {
    steps.push(`Add a line "test: aabb ab \"\"" to run strings (\"\" or ε is the empty string).`);
    return null;
  }
  steps.push("Runs (configurations (state, unread input, stack top-first), ⊢ = one move):");
  let strip: { input: string[]; run: PdaRun; label: string } | null = null;
  let capNoted = false;
  for (const t of p.tests) {
    const input = splitInput(p, t);
    if (input === null) {
      steps.push(`  ${showStr(t)} — not run: not every symbol is in the input alphabet ${setName(p.alphabet)}`);
      display.push(`${showStr(t)} → not run (symbol outside the alphabet)`);
      continue;
    }
    const r = runPda(p, input);
    const chain = r.path.map((e) => configStr(p, input, e.config));
    // Display contract at run time: every printed configuration re-reads.
    for (const c of chain) {
      if (parseConfig(p, c) === null) throw new DiscreteError(`Display contract: the configuration ${c} does not re-read — withheld rather than printed.`);
    }
    const win = stripWindow(chain.length);
    const shown = win.omitted ? [...chain.slice(0, win.first), `… ${win.omitted} more …`, ...chain.slice(chain.length - win.last)] : chain;
    steps.push(`  ${showStr(t)}: ${shown.join(" ⊢ ")}`);
    const moves = r.path.map((e) => e.move).filter((m): m is PdaMove => !!m);
    if (r.verdict === "accepted") {
      const fin = replay(p, input, moves);
      const last = r.path[r.path.length - 1].config;
      if (!sameConfig(fin, last) || !isAccepting(p, last, input.length)) {
        throw new DiscreteError(`Internal cross-check failed: the accepting run found for ${showStr(t)} does not replay to the same accepting configuration. Nothing was returned rather than a wrong verdict.`);
      }
      const why = p.mode === "empty" ? "the stack is empty" : p.mode === "both" ? `${last.state} is an accept state and the stack is empty` : `${last.state} is an accept state`;
      const branch = r.branches === 1 ? "the only branch" : `one of ${r.branches} branches`;
      steps.push(`    accepted in ${moves.length} move${moves.length === 1 ? "" : "s"} (${branch}): input consumed and ${why}; verified by replaying the ${moves.length} move${moves.length === 1 ? "" : "s"} deterministically — same final configuration.`);
      display.push(`${showStr(t)} → accepted in ${moves.length} move${moves.length === 1 ? "" : "s"} (${branch})`);
    } else if (r.verdict === "rejected") {
      const s = r.stuck;
      const reason = !s
        ? `every branch returns to a configuration already visited (an ε-cycle) and none accepts — all ${r.configurations} reachable configurations were explored`
        : s.pos < input.length
          ? `stuck at ${configStr(p, input, s)}: no move`
          : s.stack.length === 0 && p.mode !== "empty"
            ? `stuck at ${configStr(p, input, s)}: the stack is empty in ${s.state}, which is not an accept state`
            : `stuck at ${configStr(p, input, s)}: no move, and ${p.mode === "empty" ? "the stack is not empty" : p.mode === "both" ? `${s.state} is not an accept state or the stack is not empty` : `${s.state} is not an accept state`}`;
      const nb = Math.max(1, r.branches);
      steps.push(`    rejected: every branch died (${nb} branch${nb === 1 ? "" : "es"}, ${r.configurations} configuration${r.configurations === 1 ? "" : "s"}) — ${reason}.`);
      display.push(`${showStr(t)} → rejected: every branch died — ${reason}`);
      if (t === "") {
        const startEps = p.moves.some((m) => m.from === p.start && m.input === EPS && m.top === p.bottom);
        if (!startEps) {
          const lang = anbnCheck(p);
          const note = lang === "all-but-empty"
            ? `${p.start} has no ε-move: this machine does not accept the empty string although aⁿbⁿ includes it (it agrees with aⁿbⁿ on every other string of length ≤ ${PDA_CAPS.languageCheckLength} over {a,b}; add ${p.start} ε ${p.bottom} → <an accept state> ${p.bottom} to accept it).`
            : `${p.start} has no ε-move on ${p.bottom}: the empty string is rejected without a move.`;
          steps.push(`    ${note}`);
          display.push(note);
        }
      }
    } else {
      const which = r.cap === "stack depth" ? `a branch's stack would exceed ${PDA_CAPS.stackDepth} symbols` : `${PDA_CAPS.configurations.toLocaleString("en-US")} configurations were visited`;
      steps.push(`    search cap reached: UNKNOWN — ${which} before any branch accepted; the remaining branches were not explored, so this is not a rejection.`);
      display.push(`${showStr(t)} → UNKNOWN: search cap reached (${which})`);
      capNoted = true;
    }
    if (!strip) strip = { input, run: r, label: `${showStr(t)} — ${r.verdict === "accepted" ? "accepting run" : r.verdict === "rejected" ? "the longest dead branch" : "the branch explored last"}` };
  }
  if (capNoted) caveats.push("UNKNOWN is a cap, not a verdict: a pushdown automaton with ε-moves that push can run forever, and the search stops where the caps say.");
  return strip;
}

function answerPda(p: Pda, extraDisplay: string[], extraSteps: string[], extraCaveats: string[]): DiscreteResult {
  const display = [summary(p), ...extraDisplay];
  const steps = [...extraSteps, "Moves (state, input, stack top → state, push string written top-first; ε = pop):", ...p.moves.map((m) => "  " + moveStr(p, m))];
  const caveats: string[] = [];
  const strip = runAll(p, display, steps, caveats);
  if (p.fromGrammar) {
    const checks = grammarCrossCheck(p, parseGrammar(p.fromGrammar.text));
    steps.push(...checks);
    if (checks[0].startsWith("verified: agrees with CYK")) display.push(checks[0].replace(/^verified: /, "Verified: "));
  }
  if (singleCharInput(p)) steps.push("As a block you can paste back:", ...pdaBlockLines(p).map((l) => "  " + l));
  else steps.push("(No paste-back block: the grammar has multi-character terminals, which a typed PDA block does not read — re-run it as cfg to pda.)");
  caveats.push(`Acceptance is by ${modeName(p).toLowerCase()} — the same machine accepts a different language under the other convention; write accept: empty stack, accept: q2, or accept: q2 and empty stack.`);
  caveats.push("A push string is written top-first (AZ puts A above Z); ε pushes nothing, so it pops the symbol read. Nondeterministic choices are searched breadth-first, so the run shown is a shortest accepting one.");
  caveats.push(capCaveat(), ...extraCaveats);
  const caption = `PDA, ${p.states.length} state${p.states.length === 1 ? "" : "s"}, stack ${setName(p.stack)} — ${p.mode === "empty" ? "accept by empty stack" : p.mode === "both" ? "accept by final state + empty stack" : `accept ${setName(p.acceptStates)}`}${p.name && !p.fromGrammar ? ` — ${p.name}` : ""}`;
  const fig = figure(p, strip, caption);
  return { title: p.fromGrammar ? "Context-free grammar → pushdown automaton" : "Pushdown automaton", display, steps, caveats, svg: fig.svg, alt: fig.alt };
}

/** Every string of length ≤ sampleLength over the alphabet (bounded to 100 strings). */
function sampleStrings(alphabet: string[]): string[] {
  const out: string[] = [""];
  let layer = [""];
  for (let len = 1; len <= PDA_CAPS.sampleLength; len++) {
    const next: string[] = [];
    for (const s of layer) for (const a of alphabet) next.push(s + a);
    if (out.length + next.length > 100) break;
    out.push(...next);
    layer = next;
  }
  return out;
}

/** The grammar cross-checks (grammar.ts, independent algorithms): CYK membership on the test
 *  strings, and the leftmost-derivation enumerator on every short sample string. Any
 *  disagreement with the constructed PDA is a refusal. */
function grammarCrossCheck(p: Pda, g: Grammar): string[] {
  const disagree = (s: string, got: string, how: string, want: boolean): DiscreteError =>
    new DiscreteError(`Internal cross-check failed: the constructed PDA ${got === "accepted" ? "accepts" : "rejects"} ${showStr(s)} but ${how} says ${want ? "it is in the language" : "it is not"}. Nothing was returned rather than a wrong machine.`);
  let cykAgreed = 0, cykRun = 0;
  for (const s of p.tests) {
    const input = splitInput(p, s);
    if (input === null) continue;
    cykRun++;
    const got = runPda(p, input).verdict;
    if (got === "unknown") continue;
    const want = cykMember(g, input);
    if ((got === "accepted") !== want) throw disagree(s, got, "CYK on the grammar", want);
    cykAgreed++;
  }
  let brute = 0, undecided = 0;
  const sample = sampleStrings(p.alphabet);
  for (const s of sample) {
    const input = splitInput(p, s) as string[];
    const got = runPda(p, input, PDA_CAPS.sampleConfigurations).verdict;
    const want = bruteMember(g, input).verdict;
    if (got === "unknown" || want === null) { undecided++; continue; }
    if ((got === "accepted") !== want) throw disagree(s, got, "derivation search on the grammar", want);
    brute++;
  }
  const out: string[] = [];
  if (cykRun) out.push(`verified: agrees with CYK on ${cykAgreed} of ${cykRun} test string${cykRun === 1 ? "" : "s"}${cykAgreed < cykRun ? ` (${cykRun - cykAgreed} undecided by the PDA search within its caps)` : ""}.`);
  out.push(`verified: agrees with a leftmost-derivation search on ${brute} of ${sample.length} strings of length ≤ ${PDA_CAPS.sampleLength} over ${setName(p.alphabet)}${undecided ? ` (${undecided} undecided within the caps)` : ""}.`);
  return out;
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

/** aⁿbⁿ, n ≥ 0, by final state: push A per a, pop per b, accept on the bottom marker. */
export const ANBN_TEMPLATE = [
  "pda",
  "states: q0 q1 q2",
  "alphabet: a b",
  "stack: Z A",
  "start: q0",
  "accept: q2",
  "q0 a Z -> q0 AZ",
  "q0 a A -> q0 AA",
  "q0 b A -> q1 ε",
  "q1 b A -> q1 ε",
  "q1 ε Z -> q2 Z",
  "q0 ε Z -> q2 Z",
];

// ---------------------------------------------------------------------------
// Front door
// ---------------------------------------------------------------------------

/** null when the text is not a pushdown-automaton request; DiscreteError when it is one that cannot be answered. */
export function solvePda(input: string): DiscreteResult | null {
  const all = lines(input);
  const nonEmpty = all.filter((l) => l);
  if (!nonEmpty.length) return null;
  const first = nonEmpty[0];
  const last = nonEmpty[nonEmpty.length - 1];
  const firstIdx = all.indexOf(first);
  const toPdaFirst = TO_PDA_LINE.exec(first);
  const toPdaLast = nonEmpty.length > 1 && /^(?:cfg|grammar)?\s*(?:to|→|->)\s+pda\s*$/i.test(last);
  if (!PDA_RE.test(first) && !toPdaLast) return null;
  try {
    if (toPdaFirst || toPdaLast) {
      const bodyLines = toPdaFirst ? [toPdaFirst[1], ...all.slice(firstIdx + 1)] : nonEmpty.slice(0, -1);
      return answerFromGrammar(bodyLines);
    }
    const tpl = TEMPLATE_LINE.exec(first);
    if (tpl) {
      const lang = tpl[1].trim();
      if (!ANBN.test(lang)) {
        throw new DiscreteError(`A PDA for "${lang}" is not designed here — design is not computed; type the machine (states:, alphabet:, stack:, start:, accept:, and moves such as q0 a Z -> q0 AZ) and it will be run. The one template is "pda for a^n b^n".`);
      }
      const tests: string[] = [];
      for (const l of all.slice(firstIdx + 1)) {
        if (!l) continue;
        const h = headOf(l);
        if (h && (h.key === "test" || h.key === "tests" || h.key === "run")) { parseTests(h.value, tests); continue; }
        throw new DiscreteError(`After "pda for a^n b^n" only test: lines are read, but found "${l}".`);
      }
      const p = parsePdaBlock(ANBN_TEMPLATE.slice(1), "aⁿbⁿ, n ≥ 0", false);
      p.tests = tests;
      checkTests(tests);
      return answerPda(
        p,
        ["Template: aⁿbⁿ, n ≥ 0, by final state — push an A for each a, pop one for each b, accept on the bottom marker; q0 ε Z → q2 Z accepts the empty string (delete it for n ≥ 1)."],
        ["The machine used (a template, not a design computed from the language):", ...pdaBlockLines(p, false).map((l) => "  " + l)],
        ["Only aⁿbⁿ has a template; any other language must be typed as a machine — PDA design is not computed."],
      );
    }
    const kw = /^(pda|npda|dpda|pushdown(?:\s+automaton)?)\b\s*[:\-—]?\s*(.*)$/i.exec(first) as RegExpExecArray;
    const deterministic = kw[1].toLowerCase() === "dpda" || /\bdeterministic\b/i.test(kw[2]);
    const name = kw[2].replace(/\bdeterministic\b/i, "").trim();
    const body = all.slice(firstIdx + 1);
    if (!body.some((l) => l) && name) throw new DiscreteError(`A PDA for "${name}" is not designed here — design is not computed; type the machine (states:, alphabet:, stack:, start:, accept:, and moves such as q0 a Z -> q0 AZ) and it will be run. The one template is "pda for a^n b^n".`);
    if (!body.some((l) => l)) throw new DiscreteError("A PDA block needs lines after the keyword: states:, alphabet:, stack: (first = bottom marker), start:, accept: (a state, or empty stack), moves such as q0 a Z -> q0 AZ, and test: strings.");
    const p = parsePdaBlock(body, name, deterministic);
    return answerPda(p, [], [], []);
  } catch (e) {
    if (e instanceof DiscreteError) throw e;
    throw new DiscreteError(`Could not read that pushdown-automaton request: ${e instanceof Error ? e.message : String(e)}`);
  }
}


function answerFromGrammar(bodyLines: string[]): DiscreteResult {
  const grammarLines: string[] = [];
  const tests: string[] = [];
  for (const l of bodyLines) {
    if (!l) continue;
    const h = headOf(l);
    if (h && (h.key === "test" || h.key === "tests" || h.key === "run")) { parseTests(h.value, tests); continue; }
    grammarLines.push(l);
  }
  checkTests(tests);
  if (!grammarLines.length) throw new DiscreteError("cfg to pda needs a grammar — productions like S -> aSb | ε, on the same line or the lines after.");
  const text = grammarLines.join("\n");
  const g = parseGrammar(text);
  const p = grammarToPda(g, tests, text);
  const extra = [
    `One-state PDA from the grammar (start symbol ${g.start}, ${g.productions.length} production${g.productions.length === 1 ? "" : "s"}, terminals ${setName(g.terminals)}): the stack holds the sentential form; ε, A → α expands a nonterminal, a, a → ε matches a terminal; acceptance by empty stack.`,
  ];
  const steps = ["Grammar read as:", ...printGrammar(g).map((l) => "  " + l)];
  return answerPda(p, extra, steps, ["The construction accepts by empty stack; a top-down (leftmost) derivation is simulated, so a left-recursive grammar makes the search push without bound — the stack-depth cap then reports UNKNOWN."]);
}
