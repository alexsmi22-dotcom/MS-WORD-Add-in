// Turing machines — one engine of the Discrete-math Solve kind.
//
// Surface forms (the first non-empty line decides; case-insensitive):
//   tm / turing machine / dtm      a block: states, start, accept, blank, rules, tape (head: n optional)
//   tm binary increment 1011       template: the machine is printed, run, and its result verified in BigInt
//   tm unary add 111+11            template: verified by counting the 1s
//   tm busy beaver 3 / busy beaver 3   the CITED table of known values — nothing is computed
//   does this turing machine halt on every input   refused by name (the halting problem) unless a tape: is given
//
// Rules in three spellings: `q0 1 -> q0 1 R`, `q0, 1 -> q1, 0, L`, `δ(q0, 1) = (q1, 0, L)`
// (parentheses optional everywhere; → accepted; S or N = stay). Tape symbols are single
// characters; `_` is the blank unless `blank:` says otherwise.
//
// The stepper detects a REPEATED CONFIGURATION — same state, same finite tape content, same head
// position relative to that content — which is a PROOF that a deterministic machine never halts.
// The 10,000-step cap is a different thing: it is reported as UNKNOWN, and the two verdicts never
// share a sentence. An independent second stepper (own tape representation, own rule lookup)
// re-runs the trace and must agree on every state and head position and on the tape content
// at its checkpoints — a disagreement is a refusal, not a result.

import { DiscreteError, DiscreteResult } from "./discrete";
import {
  lines, tokens, headOf, setName, stateDiagramSvg, configStripSvg, composeSvgs, stripWindow, DiagramEdge, StripStep,
} from "./automata";

export const TM_CAPS = {
  states: 100,
  rules: 1000,
  /** Characters on the tape: line. */
  tape: 20000,
  /** Steps simulated before the run is reported UNKNOWN. */
  steps: 10000,
  /** Step lines printed in full: the first 25 and the last 10 of a longer run. */
  printFirst: 25,
  printLast: 10,
  /** Tape cells shown per printed line / snapshot before the view is windowed around the head. */
  viewCells: 64,
  /** Cells kept in a windowed snapshot. */
  windowCells: 41,
  /** Full tape content is compared with the second stepper at every step while the content is
   *  ≤ 256 cells wide, every 64th step up to 2,000 cells, every 512th beyond, and at the last
   *  step (state and head are compared at EVERY step). */
  checkpointWidth: 256,
  checkpointEvery: 64,
} as const;

/** Keyword-led like dfa/nfa, plus the two prose forms §D names: "busy beaver n" and the halting question. */
// A bare "machine" counts only on a line that asks about HALTING: "does the
// machine do 500 J of work in 10 s" is physics, and this guard is keyword-led
// (the pane switches kinds on it), so it must not claim ordinary prose.
export const TM_RE = /^\s*(?:tm|turing(?:\s+machine)?|dtm|ntm|busy\s+beaver|(?:does|will|would|can)\s+(?:(?:this|the|that|a|an|my|it)\s+)?(?:turing(?:\s+machine)?|tm|machine(?=[^\n]*\bhalt)))\b/i;

const HALT_QUESTION = /\b(?:does|will|would|can)\b[^\n]*\bhalt|\bhalt(?:s|ing)?\s+on\s+(?:every|all|any|each)\s+input|\bhalting\s+problem\b|\balways\s+halt|\bever\s+halt|\bterminat/i;

export interface TmRule { from: string; read: string; to: string; write: string; dir: "L" | "R" | "S"; line: string }

export interface Tm {
  name: string;
  states: string[];
  /** Tape symbols seen in rules and on the tape, blank first. */
  alphabet: string[];
  blank: string;
  start: string;
  accept: string[];
  reject: string[];
  rules: TmRule[];
  /** The input tape as typed (blank characters allowed), or null when no tape: line was given. */
  tape: string | null;
  head: number;
}

// ---------------------------------------------------------------------------
// Reading a block
// ---------------------------------------------------------------------------

const BLANK_SPELLINGS = new Set(["_", "□", "⊔", "␣", "blank"]);
const stripParens = (s: string): string => s.replace(/[(){}[\]]/g, " ").trim();

function parseDir(t: string, line: string): "L" | "R" | "S" {
  const l = t.toLowerCase();
  if (l === "r" || l === "right" || t === "→" || t === ">") return "R";
  if (l === "l" || l === "left" || t === "←" || t === "<") return "L";
  if (l === "s" || l === "n" || l === "stay" || l === "none" || t === "-" || t === "·") return "S";
  throw new DiscreteError(`Rule "${line}" ends in "${t}" — the last field is the move: L, R (or S to stay).`);
}

/** The rule spellings. null for a line that is not a rule (no arrow / no δ form). */
function parseRuleLine(line: string, blank: string): TmRule | null {
  let left: string, right: string;
  const delta = /^(?:δ|delta)\s*\((.*?)\)\s*=\s*(.*)$/i.exec(line);
  if (delta) { left = delta[1]; right = delta[2]; }
  else {
    const arrow = /^(.*?)\s*(?:->|→)\s*(.*)$/.exec(line);
    if (!arrow) return null;
    left = arrow[1]; right = arrow[2];
  }
  const lt = tokens(stripParens(left));
  const rt = tokens(stripParens(right));
  if (lt.length !== 2) throw new DiscreteError(`Rule "${line}" needs two things before the arrow — state and symbol read — e.g. "q0 1 -> q1 0 L"; found ${lt.length}.`);
  if (rt.length !== 3) throw new DiscreteError(`Rule "${line}" needs three things after the arrow — next state, symbol written, move (L/R) — e.g. "q0 1 -> q1 0 L"; found ${rt.length}.`);
  const sym = (t: string): string => {
    if (BLANK_SPELLINGS.has(t.toLowerCase()) || t === blank) return blank;
    if ([...t].length !== 1) throw new DiscreteError(`Rule "${line}" uses "${t}" as a tape symbol — tape symbols are single characters (the tape: line is read one character per cell); _ is the blank.`);
    return t;
  };
  return { from: lt[0], read: sym(lt[1]), to: rt[0], write: sym(rt[1]), dir: parseDir(rt[2], line), line };
}

const EXTRA_HEADS = ["blank", "head", "position", "tape(?:\\s+alphabet)?", "gamma", "input", "reject(?:ing)?", "halt(?:ing)?", "tapes", "tape\\s*\\d+"];

export function parseTmBlock(body: string[], name: string): Tm {
  let states: string[] | null = null;
  let alphabet: string[] | null = null;
  let blank = "_";
  let start: string | null = null;
  let accept: string[] = [];
  let reject: string[] = [];
  let tape: string | null = null;
  let head = 0;
  let tmName = name;
  const rawLines: string[] = [];
  const questions: string[] = [];

  // blank: is read first, so a rule on a line above it still knows the blank.
  for (const line of body) {
    const h = line && headOf(line, EXTRA_HEADS);
    if (h && h.key === "blank") {
      const t = tokens(h.value);
      if (t.length !== 1 || [...t[0]].length !== 1) throw new DiscreteError(`blank: must name one character (got "${h.value}").`);
      blank = t[0];
    }
  }
  for (const line of body) {
    if (!line) continue;
    const h = headOf(line, EXTRA_HEADS);
    if (h) {
      const k = h.key.replace(/\s+/g, " ");
      const v = h.value;
      if (k === "blank") continue;
      if (k === "tapes" || /^tape \d+$/.test(k)) throw new DiscreteError(`"${line}" declares a second tape — multi-tape Turing machines are not simulated here (they are equivalent in power, not in step count); write the one-tape machine.`);
      if (k === "state" || k === "states") states = tokens(v);
      else if (k === "alphabet" || k === "sigma" || k === "symbol" || k === "symbols" || k === "tape alphabet" || k === "gamma") alphabet = tokens(v).map((t) => (BLANK_SPELLINGS.has(t.toLowerCase()) ? blank : t));
      else if (k === "start" || k === "initial") {
        const t = tokens(v);
        if (t.length !== 1) throw new DiscreteError(`start: must name exactly one state (got "${v}").`);
        start = t[0];
      } else if (k === "accept" || k === "accepting" || k === "final" || k === "halt" || k === "halting") accept = [...accept, ...tokens(v)];
      else if (k === "reject" || k === "rejecting") reject = [...reject, ...tokens(v)];
      else if (k === "head" || k === "position") {
        if (!/^-?\d+$/.test(v)) throw new DiscreteError(`head: must be a cell index (0 = the first tape character), got "${v}".`);
        head = Number(v);
        if (Math.abs(head) > TM_CAPS.tape) throw new DiscreteError(`head: ${v} is beyond the tape cap of ${TM_CAPS.tape} cells.`);
      } else if (k === "tape" || k === "input") {
        if (tape !== null) throw new DiscreteError("Two tape: lines — a Turing machine here runs on ONE tape per request (multi-tape machines are not simulated); keep one tape: line.");
        const raw = v.replace(/\s+/g, "");
        tape = raw === '""' || raw === "''" || raw === "ε" || raw.toLowerCase() === "eps" || raw.toLowerCase() === "epsilon" ? "" : raw;
        if (tape.length > TM_CAPS.tape) throw new DiscreteError(`The tape is ${tape.length} characters; the cap is ${TM_CAPS.tape}.`);
      } else if (k === "test" || k === "tests" || k === "run") throw new DiscreteError('A Turing machine runs on a "tape: …" line, not test: strings — write tape: 1011.');
      else if (k === "name" || k === "title") tmName = v;
      continue;
    }
    rawLines.push(line);
  }

  const rules: TmRule[] = [];
  for (const line of rawLines) {
    const r = parseRuleLine(line, blank);
    if (!r) {
      if (HALT_QUESTION.test(line)) { questions.push(line); continue; }
      throw new DiscreteError(`Line "${line}" is not a rule — write "state read -> state write move" (e.g. "q0 1 -> q1 0 L", "(q0, 1) -> (q1, 0, L)" or "δ(q0, 1) = (q1, 0, L)"), or a head line such as tape:, start:, accept:, blank:.`);
    }
    rules.push(r);
  }
  if (questions.length && tape === null) {
    throw haltingProblem(questions[0]);
  }
  if (start === null) {
    if (rules.length && !states) start = rules[0].from;
    else if (states && states.length) start = states[0];
    else throw new DiscreteError('The TM block needs a "start: <state>" line (or at least one rule — the first rule\'s state is then the start).');
  }
  if (rules.length > TM_CAPS.rules) throw new DiscreteError(`${rules.length} rules exceed the cap of ${TM_CAPS.rules}.`);
  if (states === null) {
    states = [start];
    for (const r of rules) for (const s of [r.from, r.to]) if (!states.includes(s)) states.push(s);
    for (const s of [...accept, ...reject]) if (!states.includes(s)) states.push(s);
  }
  if (states.length > TM_CAPS.states) throw new DiscreteError(`${states.length} states exceed the cap of ${TM_CAPS.states}.`);
  const dup = states.find((s, i) => states!.indexOf(s) !== i);
  if (dup !== undefined) throw new DiscreteError(`State "${dup}" is listed twice.`);
  const stateSet = new Set(states);
  if (!stateSet.has(start)) throw new DiscreteError(`Start state "${start}" is not one of the declared states ${setName(states)}.`);
  for (const s of accept) if (!stateSet.has(s)) throw new DiscreteError(`Accept state "${s}" is not one of the declared states ${setName(states)}.`);
  for (const s of reject) if (!stateSet.has(s)) throw new DiscreteError(`Reject state "${s}" is not one of the declared states ${setName(states)}.`);
  const seen = new Map<string, TmRule>();
  for (const r of rules) {
    if (!stateSet.has(r.from)) throw new DiscreteError(`Rule "${r.line}" names unknown state "${r.from}" — declared states are ${setName(states)}.`);
    if (!stateSet.has(r.to)) throw new DiscreteError(`Rule "${r.line}" names unknown state "${r.to}" — declared states are ${setName(states)}.`);
    const k = r.from + "\u0001" + r.read;
    const prev = seen.get(k);
    if (prev) throw new DiscreteError(`Two rules for (${r.from}, ${r.read}): "${prev.line}" and "${r.line}" — that is a nondeterministic choice; nondeterministic Turing machines are not simulated here, and a deterministic machine has one rule per (state, symbol).`);
    seen.set(k, r);
  }
  if (alphabet === null) {
    alphabet = [blank];
    for (const r of rules) for (const s of [r.read, r.write]) if (!alphabet.includes(s)) alphabet.push(s);
    if (tape !== null) for (const c of tape) if (!alphabet.includes(c)) alphabet.push(c);
  } else {
    if (!alphabet.includes(blank)) alphabet.unshift(blank);
    for (const r of rules) for (const s of [r.read, r.write]) if (!alphabet.includes(s)) throw new DiscreteError(`Rule "${r.line}" uses "${s}", which is not in the tape alphabet ${setName(alphabet)}.`);
    if (tape !== null) for (const c of tape) if (!alphabet.includes(c)) throw new DiscreteError(`The tape contains "${c}", which is not in the tape alphabet ${setName(alphabet)}.`);
  }
  return { name: tmName, states, alphabet, blank, start, accept: accept.filter((s, i) => accept.indexOf(s) === i), reject: reject.filter((s, i) => reject.indexOf(s) === i), rules, tape, head };
}

// ---------------------------------------------------------------------------
// Printing (the display contract: this block re-parses through parseTmBlock)
// ---------------------------------------------------------------------------

export function ruleStr(r: TmRule): string {
  return `${r.from} ${r.read} → ${r.to} ${r.write} ${r.dir}`;
}

export function tmBlockLines(m: Tm): string[] {
  const out = ["tm", `states: ${m.states.join(" ")}`, `start: ${m.start}`];
  if (m.accept.length) out.push(`accept: ${m.accept.join(" ")}`);
  if (m.reject.length) out.push(`reject: ${m.reject.join(" ")}`);
  out.push(`blank: ${m.blank}`, ...m.rules.map(ruleStr));
  if (m.tape !== null) out.push(`tape: ${m.tape === "" ? '""' : m.tape}`);
  if (m.head !== 0) out.push(`head: ${m.head}`);
  return out;
}

// ---------------------------------------------------------------------------
// Stepper A: sparse tape + rolling hashes for configuration-repeat detection
// ---------------------------------------------------------------------------

/** 2-adic inverse of an odd 32-bit number (Newton: x ← x(2 − bx) doubles the correct bits). */
function inv32(b: number): number {
  let x = b;
  for (let i = 0; i < 6; i++) x = Math.imul(x, 2 - Math.imul(b, x));
  return x;
}
const B1 = 0x9e3779b1 | 0, B2 = 0x85ebca6b | 0;
const IB1 = inv32(B1), IB2 = inv32(B2);

/** Powers of an odd base and of its inverse modulo 2³², memoised by exponent (negative allowed). */
class Pow {
  private pos = [1];
  private neg = [1];
  constructor(private b: number, private ib: number) {}
  at(p: number): number {
    if (p >= 0) {
      while (this.pos.length <= p) this.pos.push(Math.imul(this.pos[this.pos.length - 1], this.b));
      return this.pos[p];
    }
    const q = -p;
    while (this.neg.length <= q) this.neg.push(Math.imul(this.neg[this.neg.length - 1], this.ib));
    return this.neg[q];
  }
}

const code = (sym: string): number => (sym.codePointAt(0) as number) + 1;

/** A tape view: `cells` from absolute cell `offset`; `moreLeft`/`moreRight` = non-blank content outside the view. */
export interface Snapshot { cells: string[]; headIdx: number; offset: number; moreLeft: boolean; moreRight: boolean }
export interface TmStepRec { state: string; head: number; snap: Snapshot; rule?: TmRule }

export type TmVerdict =
  | { kind: "accept"; state: string }
  | { kind: "reject"; state: string }
  | { kind: "no-rule"; state: string; read: string }
  | { kind: "loop"; state: string; head: number; content: string; firstStep: number }
  | { kind: "cap" };

export interface TmRun {
  verdict: TmVerdict;
  steps: number;
  trace: TmStepRec[];
  final: { state: string; head: number; content: string; lo: number };
  /** Full tape content at the checkpoint steps (step → trimmed content + its left edge). */
  checkpoints: Map<number, { content: string; lo: number }>;
}

/** Trimmed content and the left edge; an all-blank tape is "" at the head. */
function trimmed(cells: Map<number, string>, lo: number, hi: number, blank: string, head: number): { content: string; lo: number } {
  if (lo > hi) return { content: "", lo: head };
  let s = "";
  for (let p = lo; p <= hi; p++) s += cells.get(p) ?? blank;
  return { content: s, lo };
}

export function simulateTm(m: Tm, maxSteps: number = TM_CAPS.steps): TmRun {
  const blank = m.blank;
  const cells = new Map<number, string>();
  const tape = m.tape ?? "";
  let lo = Infinity, hi = -Infinity;
  const pow1 = new Pow(B1, IB1), pow2 = new Pow(B2, IB2);
  let h1 = 0, h2 = 0;
  const write = (p: number, sym: string): void => {
    const old = cells.get(p);
    const c0 = old === undefined ? 0 : code(old);
    const c1 = sym === blank ? 0 : code(sym);
    if (c0 === c1) return;
    h1 = (h1 + Math.imul(c1 - c0, pow1.at(p))) | 0;
    h2 = (h2 + Math.imul(c1 - c0, pow2.at(p))) | 0;
    if (sym === blank) {
      cells.delete(p);
      if (p === lo) { while (lo <= hi && !cells.has(lo)) lo++; }
      if (p === hi) { while (hi >= lo && !cells.has(hi)) hi--; }
      if (lo > hi) { lo = Infinity; hi = -Infinity; }
    } else {
      cells.set(p, sym);
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
  };
  [...tape].forEach((c, i) => { if (c !== blank) write(i, c); });

  const byKey = new Map<string, TmRule>();
  for (const r of m.rules) byKey.set(r.from + "\u0001" + r.read, r);
  const accept = new Set(m.accept), reject = new Set(m.reject);

  const snapshot = (head: number): Snapshot => {
    const a = lo > hi ? head : Math.min(lo, head), b = lo > hi ? head : Math.max(hi, head);
    if (b - a + 1 <= TM_CAPS.viewCells) {
      const out: string[] = [];
      for (let p = a; p <= b; p++) out.push(cells.get(p) ?? blank);
      return { cells: out, headIdx: head - a, offset: a, moreLeft: false, moreRight: false };
    }
    const half = Math.floor(TM_CAPS.windowCells / 2);
    let s = head - half;
    if (s < a) s = a;
    if (s + TM_CAPS.windowCells - 1 > b) s = b - TM_CAPS.windowCells + 1;
    const out: string[] = [];
    for (let p = s; p < s + TM_CAPS.windowCells; p++) out.push(cells.get(p) ?? blank);
    return { cells: out, headIdx: head - s, offset: s, moreLeft: s > a, moreRight: s + TM_CAPS.windowCells - 1 < b };
  };
  // ABSOLUTE configuration: state, head cell, and the tape content at its absolute cells (two
  // 32-bit position-weighted hashes plus the content's extent). A hash hit is confirmed exactly.
  const configKey = (state: string, head: number): string =>
    lo > hi ? `${state}\u0001${head}\u0001·` : `${state}\u0001${head}\u0001${lo}\u0001${hi}\u0001${h1 >>> 0}\u0001${h2 >>> 0}`;

  const seen = new Map<string, number>();
  const trace: TmStepRec[] = [];
  const checkpoints = new Map<number, { content: string; lo: number }>();
  let state = m.start, head = m.head, step = 0;
  let verdict: TmVerdict | null = null;
  while (verdict === null) {
    // Checkpoint cost is O(width), so the interval grows with the tape: every step while the
    // content is narrow, sparser on wide tapes (≈ a million cells compared in all, at most).
    const width = lo > hi ? 0 : hi - lo + 1;
    const every = width <= TM_CAPS.checkpointWidth ? 1 : width <= 2000 ? TM_CAPS.checkpointEvery : 512;
    if (step % every === 0) checkpoints.set(step, trimmed(cells, lo, hi, blank, head));
    if (accept.has(state)) { trace.push({ state, head, snap: snapshot(head) }); verdict = { kind: "accept", state }; break; }
    if (reject.has(state)) { trace.push({ state, head, snap: snapshot(head) }); verdict = { kind: "reject", state }; break; }
    const key = configKey(state, head);
    const first = seen.get(key);
    if (first !== undefined && confirmRepeat(m, first, state, head, trimmed(cells, lo, hi, blank, head))) {
      trace.push({ state, head, snap: snapshot(head) });
      const t = trimmed(cells, lo, hi, blank, head);
      verdict = { kind: "loop", state, head, content: t.content, firstStep: first };
      break;
    }
    if (first === undefined) seen.set(key, step);
    const read = cells.get(head) ?? blank;
    const rule = byKey.get(state + "\u0001" + read);
    trace.push({ state, head, snap: snapshot(head), rule });
    if (!rule) { verdict = { kind: "no-rule", state, read }; break; }
    if (step >= maxSteps) { verdict = { kind: "cap" }; break; }
    write(head, rule.write);
    head += rule.dir === "R" ? 1 : rule.dir === "L" ? -1 : 0;
    state = rule.to;
    step++;
  }
  if (!checkpoints.has(step)) checkpoints.set(step, trimmed(cells, lo, hi, blank, head));
  const fin = trimmed(cells, lo, hi, blank, head);
  return { verdict, steps: step, trace, final: { state, head, content: fin.content, lo: fin.lo }, checkpoints };
}

/** A hash hit is confirmed exactly: re-run the machine to `firstStep` with a fresh stepper and
 *  compare state, head cell and the tape content cell by cell (absolute positions). */
function confirmRepeat(m: Tm, firstStep: number, state: string, head: number, now: { content: string; lo: number }): boolean {
  const r = simulateTm({ ...m, accept: [], reject: [] }, firstStep);
  // r stopped by the cap at exactly firstStep steps (no verdict can come earlier: the first run got that far).
  if (r.steps !== firstStep) return false;
  const then = { content: r.final.content, lo: r.final.lo };
  if (r.final.state !== state || r.final.head !== head || then.content !== now.content) return false;
  return now.content === "" || then.lo === now.lo;
}

// ---------------------------------------------------------------------------
// Stepper B: an independent zipper tape with a linear rule scan (the cross-check)
// ---------------------------------------------------------------------------

export interface TmRunB { states: string[]; heads: number[]; contents: Map<number, { content: string; lo: number }>; steps: number }

export function simulateTmB(m: Tm, nSteps: number, checkpointSteps: Iterable<number>): TmRunB {
  const blank = m.blank;
  const tape = [...(m.tape ?? "")];
  // A zipper: `left` = cells left of the head, nearest LAST; `right` = cells right of the head,
  // nearest LAST (stored reversed); `cur` = the head cell. Every move is O(1).
  const cellAt = (p: number): string => (p >= 0 && p < tape.length ? tape[p] : blank);
  let head = m.head;
  const lowest = Math.min(0, head), highest = Math.max(tape.length - 1, head);
  const left: string[] = [];
  for (let p = lowest; p < head; p++) left.push(cellAt(p));
  const right: string[] = [];
  for (let p = highest; p > head; p--) right.push(cellAt(p));
  let cur = cellAt(head);
  let state = m.start;
  const states: string[] = [], heads: number[] = [];
  const contents = new Map<number, { content: string; lo: number }>();
  const want = new Set(checkpointSteps);
  const content = (): { content: string; lo: number } => {
    const all = [...left, cur, ...right.slice().reverse()];
    let a = 0, b = all.length - 1;
    while (a <= b && all[a] === blank) a++;
    while (b >= a && all[b] === blank) b--;
    if (a > b) return { content: "", lo: head };
    return { content: all.slice(a, b + 1).join(""), lo: head - left.length + a };
  };
  for (let step = 0; ; step++) {
    states.push(state); heads.push(head);
    if (want.has(step)) contents.set(step, content());
    if (step >= nSteps) return { states, heads, contents, steps: step };
    let rule: TmRule | undefined;
    for (const r of m.rules) if (r.from === state && r.read === cur) { rule = r; break; }
    if (!rule) return { states, heads, contents, steps: step };
    if (rule.dir === "R") { left.push(rule.write); cur = right.length ? (right.pop() as string) : blank; head++; }
    else if (rule.dir === "L") { right.push(rule.write); cur = left.length ? (left.pop() as string) : blank; head--; }
    else cur = rule.write;
    state = rule.to;
  }
}

/** Runs stepper B over the same number of steps and compares; throws on any disagreement. */
function crossCheck(m: Tm, run: TmRun): string {
  const b = simulateTmB(m, run.steps, run.checkpoints.keys());
  if (b.steps !== run.steps) throw new DiscreteError(`Internal cross-check failed: the second stepper stopped after ${b.steps} steps, the first after ${run.steps}. Nothing was returned rather than a wrong trace.`);
  for (let i = 0; i < run.trace.length && i < b.states.length; i++) {
    const a = run.trace[i];
    if (a.state !== b.states[i] || a.head !== b.heads[i]) {
      throw new DiscreteError(`Internal cross-check failed: at step ${i} the two steppers disagree (${a.state} at ${a.head} vs ${b.states[i]} at ${b.heads[i]}). Nothing was returned rather than a wrong trace.`);
    }
  }
  if (run.final.state !== b.states[b.states.length - 1] || run.final.head !== b.heads[b.heads.length - 1]) {
    throw new DiscreteError("Internal cross-check failed: the two steppers end in different configurations. Nothing was returned rather than a wrong trace.");
  }
  let compared = 0;
  for (const [step, c] of run.checkpoints) {
    const d = b.contents.get(step);
    if (!d) continue;
    if (c.content !== d.content || (c.content !== "" && c.lo !== d.lo)) {
      throw new DiscreteError(`Internal cross-check failed: the tape content differs between the two steppers at step ${step}. Nothing was returned rather than a wrong trace.`);
    }
    compared++;
  }
  return `verified: an independent second stepper (own tape representation and rule lookup) agrees on the state and head position at every one of the ${run.steps + 1} configurations and on the full tape content at ${compared} checkpoint${compared === 1 ? "" : "s"}${compared === run.trace.length ? " (every step)" : ""}.`;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function tapeStr(s: Snapshot): string {
  const parts = s.cells.map((c, i) => (i === s.headIdx ? `[${c}]` : c));
  return (s.moreLeft ? "…" : "") + parts.join("") + (s.moreRight ? "…" : "");
}

/** Reads back one printed step line "3. (q0) 101[1] → write 1, R" (the move part optional): the
 *  step number, the state, the shown cells and the head's index among them. A line with "…" is a
 *  VIEW windowed around the head, not the full configuration — `windowed` says so. null when the
 *  line is not a step line. */
export function parseStepLine(line: string): { step: number; state: string; cells: string[]; headIdx: number; windowed: boolean } | null {
  const m = /^\s*(\d+)\.\s+\(([^()\s]+)\)\s+(\S+)(?:\s+→\s+write\s+.+)?\s*$/.exec(line);
  if (!m) return null;
  let tape = [...m[3]];
  const windowed = tape[0] === "…" || tape[tape.length - 1] === "…";
  if (tape[0] === "…") tape = tape.slice(1);
  if (tape[tape.length - 1] === "…") tape = tape.slice(0, -1);
  const open = tape.indexOf("["), close = tape.indexOf("]");
  if (open < 0 || close !== open + 2 || tape.lastIndexOf("[") !== open || tape.lastIndexOf("]") !== close) return null;
  const cells = [...tape.slice(0, open), tape[open + 1], ...tape.slice(close + 1)];
  return { step: Number(m[1]), state: m[2], cells, headIdx: open, windowed };
}

function stepLine(i: number, rec: TmStepRec): string {
  const head = `${i}. (${rec.state}) ${tapeStr(rec.snap)}`;
  return rec.rule ? `${head} → write ${rec.rule.write}, ${rec.rule.dir === "S" ? "stay" : rec.rule.dir}${rec.rule.to !== rec.state ? `, → ${rec.rule.to}` : ""}` : head;
}

const n = (x: number): string => x.toLocaleString("en-US");

/** A final tape for a display line: in full up to 80 cells, else its ends and its length. */
function longTape(s: string): string {
  return s.length <= 80 ? s : `${s.slice(0, 40)}…${s.slice(-20)} (${n(s.length)} cells)`;
}

function verdictLines(m: Tm, run: TmRun): { headline: string; reason: string } {
  const v = run.verdict;
  const steps = `${n(run.steps)} step${run.steps === 1 ? "" : "s"}`;
  switch (v.kind) {
    case "accept": return { headline: `Verdict: halted in ${v.state} after ${steps} — accepted (${v.state} is the accept state)`, reason: `entering ${v.state} halts the machine (it is an accept state).` };
    case "reject": return { headline: `Verdict: halted in ${v.state} after ${steps} — rejected (${v.state} is a reject state)`, reason: `entering ${v.state} halts the machine (it is a reject state).` };
    case "no-rule": {
      const tail = m.accept.length ? `not accepting (${v.state} is not an accept state; accept ${setName(m.accept)})` : "not accepting (no accept state declared)";
      return { headline: `Verdict: halted: no rule for (${v.state}, ${v.read}) after ${steps} — ${tail}`, reason: `no rule reads ${v.read} in ${v.state}, so the machine stops.` };
    }
    case "loop": {
      const content = v.content === "" ? `${m.blank} (all blank)` : v.content;
      return {
        headline: `Verdict: LOOPS: configuration (${v.state}, head ${v.head}, tape ${content}) recurred at step ${run.steps} — proven non-termination (first seen at step ${v.firstStep})`,
        reason: `a deterministic machine back in the same state, at the same head cell, over the same finite tape content repeats the same ${run.steps - v.firstStep}-step cycle forever; this is a proof, not a cap.`,
      };
    }
    case "cap": return {
      headline: `Verdict: step cap ${n(TM_CAPS.steps)} reached — UNKNOWN; a cap is not a proof of looping`,
      reason: `no configuration repeated within the cap, so the machine may halt later or may run forever — nothing here decides that.`,
    };
  }
}

function figure(m: Tm, run: TmRun, caption: string): { svg: string; alt: string } {
  const edges: DiagramEdge[] = m.rules.map((r) => ({ from: r.from, to: r.to, label: `${r.read}/${r.write}, ${r.dir}` }));
  const diagram = stateDiagramSvg({ states: m.states, start: m.start, accept: m.accept, edges, caption: `${caption} — state diagram (read/write, move)`, labels: "stack" });
  const steps: StripStep[] = run.trace.map((rec, i) => ({ label: String(i), state: rec.state, cells: rec.snap.cells, head: rec.snap.headIdx }));
  const win = stripWindow(steps.length);
  const strip = configStripSvg({ kind: "tape", steps, caption: `${win.omitted ? `first ${win.first} and last ${win.last} of ${steps.length} configurations` : `${steps.length} configuration${steps.length === 1 ? "" : "s"}`} — head cell boxed, state above` });
  const alt = `Turing machine ${caption}: state diagram with ${m.rules.length} rule${m.rules.length === 1 ? "" : "s"} (labels read/write, move), and a tape strip of ${steps.length} configurations${win.omitted ? ` (first ${win.first} and last ${win.last} drawn, ${win.omitted} omitted)` : ""}, the head cell boxed with the state above it. Final tape ${run.final.content || m.blank}, head ${run.final.head}.`;
  return { svg: composeSvgs([diagram, strip]), alt };
}

const CAP_CAVEAT = `Caps: ≤ ${TM_CAPS.states} states, ≤ ${n(TM_CAPS.rules)} rules, tape ≤ ${n(TM_CAPS.tape)} characters, ≤ ${n(TM_CAPS.steps)} steps (the step cap); the first ${TM_CAPS.printFirst} and last ${TM_CAPS.printLast} steps of a longer run are printed, the first 12 and last 3 drawn; a tape wider than ${TM_CAPS.viewCells} cells is shown windowed around the head (…).`;

function answerTm(m: Tm, extraDisplay: string[], extraSteps: string[], verify?: (run: TmRun) => string): DiscreteResult {
  if (m.tape === null) throw new DiscreteError('This Turing machine needs a tape: line to run on (e.g. tape: 1011; tape: "" for an all-blank tape; head: n to start elsewhere than cell 0).');
  const run = simulateTm(m);
  const check = crossCheck(m, run);
  const v = verdictLines(m, run);
  const display = [
    `Turing machine, ${m.states.length} state${m.states.length === 1 ? "" : "s"} over tape alphabet ${setName(m.alphabet)} (blank ${m.blank})${m.accept.length ? `, accept ${setName(m.accept)}` : ", no accept state"}`,
    ...extraDisplay,
    v.headline,
    `Final tape: ${run.final.content === "" ? `${m.blank} (all blank)` : longTape(run.final.content)}${run.final.content !== "" && run.final.lo !== 0 ? ` (starting at cell ${run.final.lo})` : ""}; head at cell ${run.final.head}; ${n(run.steps)} step${run.steps === 1 ? "" : "s"}.`,
  ];
  const steps = [...extraSteps, "Rules (state, read → state, write, move):", ...m.rules.map((r) => "  " + ruleStr(r))];
  steps.push(`Run from tape ${m.tape === "" ? '"" (all blank)' : m.tape}, head at cell ${m.head}, state ${m.start} (k. = the configuration after k steps; [x] = the head cell):`);
  const lines_ = run.trace.map((rec, i) => "  " + stepLine(i, rec));
  // Display contract at run time: every printed step line re-reads.
  for (const l of lines_) {
    if (parseStepLine(l) === null) throw new DiscreteError(`Display contract: the step line "${l.trim()}" does not re-read — withheld rather than printed.`);
  }
  if (lines_.length > TM_CAPS.printFirst + TM_CAPS.printLast + 1) {
    steps.push(...lines_.slice(0, TM_CAPS.printFirst), `  … ${n(lines_.length - TM_CAPS.printFirst - TM_CAPS.printLast)} steps not printed …`, ...lines_.slice(lines_.length - TM_CAPS.printLast));
  } else steps.push(...lines_);
  steps.push(`Why: ${v.reason}`);
  if (verify) steps.push(verify(run));
  steps.push(check);
  steps.push("As a block you can paste back:", ...tmBlockLines(m).map((l) => "  " + l));
  // The loop proof and the cap are never explained in the same result: each verdict carries its own note.
  const verdictNote = run.verdict.kind === "loop"
    ? "LOOPS is a proof: the configuration (state, head cell, finite tape content) that recurred is exactly the same, so the deterministic machine repeats the same cycle forever."
    : run.verdict.kind === "cap"
      ? `The cap is not a proof: the machine was stopped after ${n(TM_CAPS.steps)} steps without any configuration repeating, so whether it halts is UNKNOWN.`
      : "Entering an accept (or reject) state halts the machine at once; otherwise it halts when no rule matches (state, symbol).";
  const caveats = [verdictNote, CAP_CAVEAT];
  if (run.trace.some((r) => r.head < 0)) caveats.push("The head moved left of cell 0: the tape is unbounded in both directions, so it grew to the left (negative cell numbers).");
  const caption = m.name ? `${m.states.length} states — ${m.name}` : `${m.states.length} states, ${m.rules.length} rules`;
  const fig = figure(m, run, caption);
  return { title: "Turing machine", display, steps, caveats, svg: fig.svg, alt: fig.alt };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const INCREMENT_TEMPLATE = [
  "tm",
  "states: q0 q1 halt",
  "start: q0",
  "accept: halt",
  "blank: _",
  "q0 0 -> q0 0 R",
  "q0 1 -> q0 1 R",
  "q0 _ -> q1 _ L",
  "q1 1 -> q1 0 L",
  "q1 0 -> halt 1 R",
  "q1 _ -> halt 1 R",
];

export const UNARY_ADD_TEMPLATE = [
  "tm",
  "states: q0 q1 q2 halt",
  "start: q0",
  "accept: halt",
  "blank: _",
  "q0 1 -> q0 1 R",
  "q0 + -> q1 1 R",
  "q1 1 -> q1 1 R",
  "q1 _ -> q2 _ L",
  "q2 1 -> halt _ L",
];

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (s: string): string => [...s].map((c) => SUB[Number(c)] ?? c).join("");

/** Σ(n) and S(n): cited values. 1–3 Lin & Radó 1965; 4 Brady 1983; 5 proven by the bbchallenge collaboration, 2024 (Coq-verified). */
export const BUSY_BEAVER: { n: number; sigma: string; s: string; source: string }[] = [
  { n: 1, sigma: "1", s: "1", source: "Radó 1962" },
  { n: 2, sigma: "4", s: "6", source: "Radó 1962" },
  { n: 3, sigma: "6", s: "21", source: "Lin & Radó 1965" },
  { n: 4, sigma: "13", s: "107", source: "Brady 1983" },
  { n: 5, sigma: "4,098", s: "47,176,870", source: "bbchallenge, proven 2024" },
];

function answerBusyBeaver(arg: string): DiscreteResult {
  const m = /^(\d+)/.exec(arg.trim());
  if (!m) throw new DiscreteError(`busy beaver needs the number of states, e.g. "busy beaver 3" (got "${arg.trim() || "nothing"}").`);
  const k = Number(m[1]);
  if (k < 1) throw new DiscreteError("busy beaver n needs n ≥ 1.");
  const row = BUSY_BEAVER.find((r) => r.n === k);
  const display = row
    ? [`Σ(${k}) = ${row.sigma}, S(${k}) = ${row.s} — ${row.source}; CITED values, nothing computed here.`, `Σ(n) = the most 1s a halting n-state, 2-symbol machine leaves on an initially blank tape; S(n) = the most steps it can take before halting.`]
    : [`Σ(${k}) and S(${k}) are NOT KNOWN for ${k} ≥ 6 — only lower bounds are proven (S(6) > 10↑↑15, mxdys 2024, from a known 6-state machine); nothing is computed here.`];
  const steps = [
    "Known values of the busy-beaver functions for n-state, 2-symbol machines on an all-blank tape (a table of cited results):",
    ...BUSY_BEAVER.map((r) => `  n = ${r.n}: Σ(${r.n}) = ${r.sigma}, S(${r.n}) = ${r.s} — ${r.source}`),
    "  n ≥ 6: unknown; Σ and S are not computable (they grow faster than any computable function), so no procedure here can extend the table.",
  ];
  return {
    title: "Busy beaver (cited values)",
    display,
    steps,
    caveats: ["These are cited, not computed: Σ(5) = 4,098 and S(5) = 47,176,870 were proven by the bbchallenge collaboration in 2024 (Coq-verified); Σ(1..4) and S(1..4) by Radó, Lin & Radó (1965) and Brady (1983). To run a specific machine, type it as a tm block with a tape: line."],
  };
}

/** A template's machine through the same printer as the paste-back block (one glyph per result), without its tape. */
const templateLines = (m: Tm): string[] => tmBlockLines({ ...m, tape: null, head: 0 }).map((l) => "  " + l);

function answerIncrement(bits: string): DiscreteResult {
  const m = parseTmBlock([...INCREMENT_TEMPLATE.slice(1), `tape: ${bits}`], "binary increment");
  const input = BigInt("0b" + bits);
  return answerTm(
    m,
    [`Template: binary increment — move right to the end, then carry leftwards (1 → 0) until a 0 or the blank, which becomes 1.`],
    ["The machine used (a template, printed in full):", ...templateLines(m)],
    (run) => {
      const out = run.final.content;
      if (!/^[01]+$/.test(out)) throw new DiscreteError(`Internal cross-check failed: the increment left "${out}" on the tape, which is not a binary numeral.`);
      const got = BigInt("0b" + out);
      if (got !== input + 1n) throw new DiscreteError(`Internal cross-check failed: ${bits}₂ + 1 should be ${(input + 1n).toString(2)}₂ but the tape reads ${out}. Nothing was returned rather than a wrong result.`);
      return `${bits}${sub("2")} + 1 = ${out}${sub("2")} = ${(input + 1n).toLocaleString("en-US")}, verified (computed independently in BigInt from the input bits).`;
    },
  );
}

function answerUnaryAdd(a: string, b: string): DiscreteResult {
  const m = parseTmBlock([...UNARY_ADD_TEMPLATE.slice(1), `tape: ${a}+${b}`], "unary addition");
  return answerTm(
    m,
    [`Template: unary addition — overwrite + with 1, run to the right end, erase the last 1 (${a.length} + ${b.length} ones → ${a.length + b.length}).`],
    ["The machine used (a template, printed in full):", ...templateLines(m)],
    (run) => {
      const out = run.final.content;
      if (!/^1*$/.test(out)) throw new DiscreteError(`Internal cross-check failed: unary addition left "${out}" on the tape, which is not a run of 1s.`);
      if (out.length !== a.length + b.length) throw new DiscreteError(`Internal cross-check failed: ${a.length} + ${b.length} = ${a.length + b.length} ones expected, ${out.length} on the tape. Nothing was returned rather than a wrong result.`);
      return `${a.length} + ${b.length} = ${out.length}, verified (the 1s on the final tape counted independently).`;
    },
  );
}

// ---------------------------------------------------------------------------
// Front door
// ---------------------------------------------------------------------------

const MULTI_TAPE = /\b(?:multi|two|three|2|3|k|n)[-\s]?tapes?\b|\btapes\s*[:=]|\btape\s*[2-9]\s*[:=]/i;
const TWO_D = /\b2[-\s]?d\b|\btwo[-\s]dimensional\b|\b2[-\s]dimensional\b|\bgrid\s+tape\b|\bplane\b/i;
const PROBABILISTIC = /\bprobabilistic\b|\brandomi[sz]ed\b|\bquantum\b|\bcoin[-\s]flip/i;

/** null when the text is not a Turing-machine request; DiscreteError when it is one that cannot be answered. */
export function solveTuring(input: string): DiscreteResult | null {
  const all = lines(input);
  const nonEmpty = all.filter((l) => l);
  if (!nonEmpty.length) return null;
  const first = nonEmpty[0];
  if (!TM_RE.test(first)) return null;
  const firstIdx = all.indexOf(first);
  try {
    const bb = /^busy\s+beaver\b\s*[:=]?\s*(.*)$/i.exec(first) || /^(?:tm|turing(?:\s+machine)?)\s+busy\s+beaver\b\s*[:=]?\s*(.*)$/i.exec(first);
    if (bb) return answerBusyBeaver(bb[1]);
    const whole = nonEmpty.join("\n");
    if (MULTI_TAPE.test(whole)) throw new DiscreteError("Multi-tape Turing machines are not simulated here — they compute the same functions as one-tape machines (with a quadratic slowdown), but the rule format differs; write the one-tape machine with one tape: line.");
    if (TWO_D.test(whole)) throw new DiscreteError("Two-dimensional-tape Turing machines are not simulated here — only the one-dimensional, one-tape model (moves L/R) is read.");
    if (PROBABILISTIC.test(whole)) throw new DiscreteError("Probabilistic (randomised) Turing machines are not simulated here — only deterministic machines with one rule per (state, symbol) are read.");
    const kw = /^(tm|turing(?:\s+machine)?|dtm|ntm)\b\s*[:\-—]?\s*(.*)$/i.exec(first);
    if (kw && kw[1].toLowerCase() === "ntm") throw new DiscreteError("Nondeterministic Turing machines (ntm) are not simulated here — write a deterministic machine (tm) with one rule per (state, symbol).");
    const body = all.slice(firstIdx + 1);
    const rest = kw ? kw[2].trim() : "";
    if (kw && rest) {
      const inc = /^(?:binary\s+)?incre?ment(?:\s+of)?\s*[:=]?\s*([01]+)$/i.exec(rest);
      if (inc) { if (bodyHasContent(body)) throw new DiscreteError(`After "tm binary increment ${inc[1]}" nothing else is read — the template supplies the machine and the tape.`); return answerIncrement(inc[1]); }
      const add = /^(?:unary\s+)?add(?:ition)?(?:\s+of)?\s*[:=]?\s*(1*)\s*\+\s*(1*)$/i.exec(rest);
      if (add) { if (bodyHasContent(body)) throw new DiscreteError(`After "tm unary add ${add[1]}+${add[2]}" nothing else is read — the template supplies the machine and the tape.`); return answerUnaryAdd(add[1], add[2]); }
      if (/^(?:binary\s+)?incre?ment\b/i.test(rest)) throw new DiscreteError(`"tm binary increment" needs the binary numeral to increment, e.g. tm binary increment 1011.`);
      if (/^(?:unary\s+)?add\b/i.test(rest)) throw new DiscreteError(`"tm unary add" needs two unary numbers joined by +, e.g. tm unary add 111+11.`);
      if (HALT_QUESTION.test(rest) && !body.some((l) => /^(?:tape|input)\s*[:=]/i.test(l))) throw haltingProblem(first);
      if (!bodyHasContent(body)) {
        throw new DiscreteError(`A Turing machine for "${rest}" is not designed here — design is not computed; type the machine (rules such as q0 1 -> q0 1 R, a tape: line, optional states:/start:/accept:/blank:). Templates: tm binary increment 1011 · tm unary add 111+11 · tm busy beaver 3.`);
      }
    }
    if (!kw) {
      // "does this turing machine halt …" — a question line first, the machine below.
      if (!body.some((l) => /^(?:tape|input)\s*[:=]/i.test(l))) throw haltingProblem(first);
      const m = parseTmBlock(body, "");
      return answerTm(m, [`The question "${first}" is answered for the tape given only — whether the machine halts on EVERY input is the halting problem (undecidable).`], []);
    }
    if (!bodyHasContent(body)) throw new DiscreteError("A TM block needs lines after the keyword: rules such as q0 1 -> q0 1 R, a tape: line (head: n optional), and optionally states:, start:, accept:, blank:.");
    const m = parseTmBlock(body, rest);
    return answerTm(m, [], []);
  } catch (e) {
    if (e instanceof DiscreteError) throw e;
    throw new DiscreteError(`Could not read that Turing-machine request: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const bodyHasContent = (body: string[]): boolean => body.some((l) => l);

function haltingProblem(question: string): DiscreteError {
  return new DiscreteError(`"${question}" asks whether the machine halts without giving it a tape — that is the halting problem, which no procedure decides for every input (undecidable, Turing 1936). I can run it on a tape you give me and report what happened within the ${n(TM_CAPS.steps)}-step cap — give me a tape: and I will run it (add a line such as tape: 1011) — a repeated configuration is a proof of looping; reaching the cap is not.`);
}
