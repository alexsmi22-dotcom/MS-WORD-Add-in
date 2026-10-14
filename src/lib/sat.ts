// SAT — DPLL, 2-SAT, Horn and DIMACS for the Solve kind "Discrete math"
// (v2.133.0, SCOPE-COMPUTATION-THEORY §B SAT row, §C.6).
//
// What a student types: dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q) ·
// 2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) · horn a, a -> b, b -> c, ~c · unsat core … ·
// resolution proof … · p cnf 3 2 ⏎ 1 -2 0 ⏎ 2 3 0 · a bare CNF with more
// than proplogic's 10 variables.
//
// Division of labour with proplogic.ts: `sat`, `satisfiable`, `cnf` and bare
// CNFs of ≤ 10 variables stay with the truth table there (exact, unchanged);
// this engine claims only its keywords and the > 10-variable CNFs. Both
// directions are pinned in the tests so neither engine steals the other's.
//
// House rules honoured here:
//   · the CNF reader is a flat token scan — nothing recurses, so 2,000 nested
//     parentheses are refused by name ("not in CNF") instead of overflowing;
//   · every cap is named (SAT_CAPS) and checked BEFORE the work; the DPLL
//     decision budget ends in "UNKNOWN: search budget", never a guess;
//   · SAT answers carry the model with EVERY clause re-evaluated as a
//     checklist; UNSAT answers carry a resolution refutation extracted from
//     the conflict analysis, each resolvent re-verified, plus the unsat core;
//     both are cross-checked against brute force when ≤ 20 variables;
//   · 2-SAT is exact and polynomial (implication graph + Tarjan SCC from
//     graphs.ts — built with buildGraph, never printed and re-parsed, because
//     a vertex named ¬a would not survive the edge-list grammar);
//   · what is displayed parses back: (x₁ ∨ ¬x₂) ∧ (x₂ ∨ x₃), □ for the empty
//     clause.

import { DiscreteError } from "./discrete";
import type { DiscreteResult } from "./discrete";
import { treeSvg } from "./treeSvg";
import type { TreeNode, TreeEdge } from "./treeSvg";
import { buildGraph, strongComponents, graphSvg } from "./graphs";
import { MAX_VARS as PROP_MAX_VARS } from "./proplogic";

export const SAT_CAPS = {
  /** DPLL: variables and clauses. */
  vars: 60,
  clauses: 400,
  /** DPLL decisions (branch points) before "UNKNOWN: search budget". A count,
   *  not a clock: measured ≈ 0.065 ms per decision at 72 variables in Node
   *  (pigeonhole 9→8: 5,000 decisions in ~320 ms), so the worst case stays
   *  under ~400 ms; random 3-SAT at 60 variables / 256 clauses (the phase
   *  transition) needed at most 1,903 over 50 instances. The brief's 200,000
   *  would have meant ~13 s — a frozen task pane. */
  decisions: 5_000,
  /** 2-SAT and Horn: clauses and variables (both are linear-time). */
  twoSatClauses: 2_000,
  hornClauses: 2_000,
  linearVars: 1_000,
  /** Brute-force model counting / cross-check: variables and clause evaluations. */
  countVars: 20,
  countBudget: 2_000_000,
  /** Decision-tree nodes drawn/recorded. */
  treeNodes: 400,
  /** Implication-graph vertices drawn (2 per variable). */
  drawVertices: 60,
  /** DPLL trace lines listed (the rest are counted). */
  stepLines: 300,
};

/** The guard discrete.ts uses to route to this engine (before propositional
 *  logic). A bare CNF with > 10 variables is claimed inside solveSat. */
export const SAT_RE = /^\s*(?:dpll|2[-\s]?sat|horn(?:[-\s]sat)?|unsat\s+core|resolution\s+proof|p\s+cnf\b|dimacs|pigeonhole|php)\b/i;

export interface SatLit { v: number; neg: boolean }
export interface Cnf { vars: string[]; clauses: SatLit[][] }

const SUB = (n: number): string => String(n).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");

// ---------------------------------------------------------------------------
// Reading

type TokKind = "id" | "num" | "lp" | "rp" | "and" | "or" | "not" | "imp" | "comma" | "nl" | "box" | "top" | "bot" | "iff" | "other";
interface Tok { t: TokKind; s: string; pos: number }

const WORDS: Record<string, TokKind> = { and: "and", or: "or", not: "not", implies: "imp", true: "top", false: "bot", iff: "iff" };

function tokenizeCnf(src: string): Tok[] {
  const toks: Tok[] = [];
  const chars = Array.from(src);
  let i = 0;
  const push = (t: TokKind, s: string, pos: number): void => { toks.push({ t, s, pos }); };
  while (i < chars.length) {
    const c = chars[i];
    const two = c + (chars[i + 1] ?? "");
    const three = two + (chars[i + 2] ?? "");
    if (c === "\n") { push("nl", c, i); i++; continue; }
    if (/\s/u.test(c)) { i++; continue; }
    if (three === "<->" || three === "<=>") { push("iff", three, i); i += 3; continue; }
    if (two === "->" || two === "=>") { push("imp", two, i); i += 2; continue; }
    if (two === "&&") { push("and", two, i); i += 2; continue; }
    if (two === "||") { push("or", two, i); i += 2; continue; }
    if (two === "/\\") { push("and", two, i); i += 2; continue; }
    if (two === "\\/") { push("or", two, i); i += 2; continue; }
    const one: Record<string, TokKind> = {
      "(": "lp", ")": "rp", "[": "lp", "]": "rp", "{": "lp", "}": "rp", "∧": "and", "&": "and", "·": "and", "∙": "and", "*": "and",
      "∨": "or", "|": "or", "+": "or", "¬": "not", "~": "not", "!": "not", "→": "imp", "⊃": "imp", "↔": "iff", "≡": "iff",
      ",": "comma", ";": "comma", "□": "box", "⊤": "top", "⊥": "bot",
    };
    if (one[c]) { push(one[c], c, i); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < chars.length && /[A-Za-z0-9_'′₀-₉]/u.test(chars[j])) j++;
      const word = chars.slice(i, j).join("");
      const lw = word.toLowerCase();
      push(WORDS[lw] ?? "id", word, i);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < chars.length && /[0-9]/.test(chars[j])) j++;
      push("num", chars.slice(i, j).join(""), i);
      i = j;
      continue;
    }
    push("other", c, i);
    i++;
  }
  return toks;
}

export interface CnfReadOptions {
  /** Implications `a ∧ b → c` as clauses (keyword modes only — a bare `A->B` list is the graph engine's). */
  allowImplications: boolean;
  /** Newlines and commas as clause separators (keyword modes only). */
  multiline: boolean;
}

class Vars {
  names: string[] = [];
  index = new Map<string, number>();
  get(name: string): number {
    let i = this.index.get(name);
    if (i === undefined) { i = this.names.length; this.names.push(name); this.index.set(name, i); }
    return i;
  }
}

function litsOfRun(toks: Tok[], vars: Vars, sep: "or" | "and", where: string): SatLit[] {
  // literal (sep literal)*, no parentheses. "true"/"⊤" alone = no constraint; "false"/"⊥"/□ = empty.
  const out: SatLit[] = [];
  let i = 0;
  let expectLit = true;
  while (i < toks.length) {
    const t = toks[i];
    if (expectLit) {
      let neg = false;
      while (toks[i] && toks[i].t === "not") { neg = !neg; i++; }
      const a = toks[i];
      if (!a) throw new DiscreteError(`${where}: "¬" with nothing after it.`);
      if (a.t === "id") { out.push({ v: vars.get(a.s), neg }); i++; expectLit = false; continue; }
      if (a.t === "num") throw new DiscreteError(`${where}: "${a.s}" is a number, not a variable — numbered literals need a DIMACS header (p cnf n m) with 0 ending each clause.`);
      if (a.t === "top" || a.t === "bot" || a.t === "box") {
        if (neg) throw new DiscreteError(`${where}: write ⊥ for ¬⊤ and ⊤ for ¬⊥.`);
        out.push({ v: -1, neg: a.t !== "top" }); // v = -1: a constant; neg=false → ⊤, neg=true → ⊥
        i++; expectLit = false; continue;
      }
      if (a.t === "lp") throw new DiscreteError(`${where}: nested parentheses — not in CNF (a clause is a flat disjunction of literals).`);
      throw new DiscreteError(`${where}: unexpected "${a.s}" where a literal was expected.`);
    }
    if (t.t === sep) { i++; expectLit = true; continue; }
    if (t.t === "and" || t.t === "or") throw new DiscreteError(`${where}: "${t.s}" inside a clause — not in CNF (clauses hold ∨ only; ∧ separates clauses).`);
    if (t.t === "iff") throw new DiscreteError(`${where}: "↔" is not a CNF connective — convert first: write cnf … in the logic engine.`);
    if (t.t === "imp") throw new DiscreteError(`${where}: "→" inside a clause — write the implication as its own clause (a ∧ b → c).`);
    if (t.t === "lp") throw new DiscreteError(`${where}: nested parentheses — not in CNF.`);
    throw new DiscreteError(`${where}: unexpected "${t.s}".`);
  }
  if (expectLit && out.length) throw new DiscreteError(`${where}: ends with "${sep === "or" ? "∨" : "∧"}".`);
  return out;
}

/** Folds the ⊤/⊥ pseudo-literals of a clause: null = the clause is satisfied (drop it). */
function foldConsts(lits: SatLit[]): SatLit[] | null {
  const out: SatLit[] = [];
  for (const l of lits) {
    if (l.v === -1) { if (!l.neg) return null; continue; }
    out.push(l);
  }
  return out;
}

/** Flat CNF reader. Throws DiscreteError naming what is not CNF. */
export function parseCnf(text: string, opts: CnfReadOptions): Cnf {
  const toks = tokenizeCnf(text);
  const bad = toks.find((t) => t.t === "other");
  if (bad) throw new DiscreteError(`Unexpected character "${bad.s}" at position ${bad.pos + 1}.`);
  if (!toks.length) throw new DiscreteError("No clauses found.");
  const vars = new Vars();
  const clauses: SatLit[][] = [];
  // 1. Items: split at depth-0 commas/newlines (keyword modes), checking depth.
  const items: Tok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.t === "lp") { depth++; if (depth > 1) throw new DiscreteError(`Nested parentheses at position ${t.pos + 1} — not in CNF (convert first: write cnf … in the logic engine).`); }
    if (t.t === "rp") { depth--; if (depth < 0) throw new DiscreteError(`")" at position ${t.pos + 1} has no matching "(".`); }
    if ((t.t === "comma" || t.t === "nl") && depth === 0) {
      if (!opts.multiline && t.t === "comma") throw new DiscreteError("Commas are read as clause separators only under a keyword (dpll, horn, …).");
      items.push([]);
      continue;
    }
    if (t.t === "nl") continue;
    items[items.length - 1].push(t);
  }
  if (depth !== 0) throw new DiscreteError('Missing ")".');
  const addClause = (lits: SatLit[]): void => {
    const f = foldConsts(lits);
    if (f === null) return;
    // Dedupe literals; a tautological clause (p ∨ ¬p) is dropped.
    const seen = new Map<string, SatLit>();
    for (const l of f) seen.set(`${l.neg ? "-" : ""}${l.v}`, l);
    const out = [...seen.values()];
    if (out.some((l) => seen.has(`${l.neg ? "" : "-"}${l.v}`))) return;
    clauses.push(out);
  };
  let itemNo = 0;
  for (const item of items) {
    if (!item.length) continue;
    itemNo++;
    const where = `Clause ${itemNo}`;
    const impIdx = item.findIndex((t) => t.t === "imp");
    if (impIdx >= 0) {
      if (!opts.allowImplications) throw new DiscreteError(`${where}: "→" is read as a clause only under a keyword (dpll, horn).`);
      // Strip one pair of enclosing parentheses: "(a ∧ b → c)".
      let body = item;
      if (body[0].t === "lp" && body[body.length - 1].t === "rp" && !body.slice(1, -1).some((t) => t.t === "lp" || t.t === "rp")) body = body.slice(1, -1);
      const k = body.findIndex((t) => t.t === "imp");
      if (body.some((t, q) => q !== k && t.t === "imp")) throw new DiscreteError(`${where}: two "→" in one clause — write one implication per clause.`);
      if (body.some((t) => t.t === "lp" || t.t === "rp")) throw new DiscreteError(`${where}: parentheses inside an implication clause — write a ∧ b → c ∨ d with literals only.`);
      const ante = body.slice(0, k);
      const cons = body.slice(k + 1);
      const a = ante.length ? litsOfRun(ante, vars, "and", `${where} (antecedent)`) : [];
      const c = cons.length ? litsOfRun(cons, vars, "or", `${where} (consequent)`) : [];
      // a₁ ∧ … ∧ aₙ → c₁ ∨ … ∨ cₘ  ≡  ¬a₁ ∨ … ∨ ¬aₙ ∨ c₁ ∨ … ∨ cₘ
      addClause([...a.map((l) => ({ v: l.v, neg: !l.neg })), ...c]);
      continue;
    }
    // 2. Depth-0 elements: a parenthesised group or a (negated) literal,
    //    joined by ∧ (next clause), ∨ (same clause), or juxtaposition between
    //    groups — (x ∨ y)(¬x ∨ y) — which is read as ∧.
    interface Elem { toks: Tok[]; paren: boolean; pos: number }
    const segments: { elems: Elem[]; ors: number }[] = [{ elems: [], ors: 0 }];
    let q = 0;
    let lastWasElem = false;
    while (q < item.length) {
      const t = item[q];
      const seg = segments[segments.length - 1];
      if (t.t === "and") {
        if (!lastWasElem) throw new DiscreteError(`${where}: "${t.s}" at position ${t.pos + 1} has nothing on its left.`);
        segments.push({ elems: [], ors: 0 }); lastWasElem = false; q++; continue;
      }
      if (t.t === "or") {
        if (!lastWasElem) throw new DiscreteError(`${where}: "${t.s}" at position ${t.pos + 1} has nothing on its left.`);
        seg.ors++; lastWasElem = false; q++; continue;
      }
      if (t.t === "iff") throw new DiscreteError(`${where}: "↔" is not a CNF connective — convert first: write cnf … in the logic engine.`);
      if (t.t === "rp") throw new DiscreteError(`")" at position ${t.pos + 1} has no matching "(".`);
      let negs = 0;
      let r = q;
      while (item[r] && item[r].t === "not") { negs++; r++; }
      const head = item[r];
      if (!head) throw new DiscreteError(`${where}: "¬" with nothing after it.`);
      let elem: Elem;
      if (head.t === "lp") {
        if (negs) throw new DiscreteError(`${where}: "¬(" at position ${item[q].pos + 1} negates a group — not in CNF (convert first: write cnf … in the logic engine).`);
        let s = r + 1;
        while (s < item.length && item[s].t !== "rp") s++;
        if (s >= item.length) throw new DiscreteError(`Missing ")" for the "(" at position ${head.pos + 1}.`);
        elem = { toks: item.slice(r + 1, s), paren: true, pos: head.pos };
        if (!elem.toks.length) throw new DiscreteError(`${where}: "()" is empty — write □ for the empty clause.`);
        r = s + 1;
      } else {
        elem = { toks: item.slice(q, r + 1), paren: false, pos: head.pos };
        r = r + 1;
      }
      if (lastWasElem) {
        // Juxtaposition: allowed between parenthesised groups only.
        const prev = seg.elems[seg.elems.length - 1];
        if (!(prev && prev.paren && elem.paren)) throw new DiscreteError(`Two things side by side at position ${elem.pos + 1} with no connective between them — write ∧ between clauses, ∨ inside one.`);
        segments.push({ elems: [elem], ors: 0 });
      } else seg.elems.push(elem);
      lastWasElem = true;
      q = r;
    }
    if (!lastWasElem) throw new DiscreteError(`${where}: ends with a connective.`);
    if (segments.length > 1 && segments.some((s) => s.ors > 0)) {
      throw new DiscreteError(`${where}: ∨ between clauses without parentheses is ambiguous (∧ binds tighter than ∨ in a formula, so a ∨ b ∧ c is not in CNF) — write (a ∨ b) ∧ (c ∨ d).`);
    }
    for (const seg of segments) {
      const lits: SatLit[] = [];
      for (const e of seg.elems) {
        if (e.toks.some((t) => t.t === "and")) throw new DiscreteError(`${where}: "∧" inside a parenthesised clause — not in CNF (convert first: write cnf … in the logic engine).`);
        lits.push(...litsOfRun(e.toks, vars, "or", where));
      }
      addClause(lits);
    }
  }
  return { vars: vars.names, clauses };
}

/** DIMACS: optional `c` comment lines, `p cnf n m`, literals ending each clause with 0. */
export function parseDimacs(text: string): { cnf: Cnf; declared: { n: number; m: number }; comments: number } {
  const lines = text.replace(/\r/g, "").split("\n");
  let n = -1, m = -1;
  let comments = 0;
  const ints: number[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (/^c\b/i.test(l) || l.startsWith("%")) { comments++; continue; }
    const pm = /^p\s+cnf\s+(\d+)\s+(\d+)\s*$/i.exec(l);
    if (pm) { if (n >= 0) throw new DiscreteError("Two p cnf header lines."); n = Number(pm[1]); m = Number(pm[2]); continue; }
    if (/^(?:dimacs)\s*:?$/i.test(l)) continue;
    if (n < 0) throw new DiscreteError(`DIMACS needs the header line "p cnf <variables> <clauses>" before the clauses (found "${l}").`);
    for (const w of l.split(/\s+/)) {
      if (!/^-?\d+$/.test(w)) throw new DiscreteError(`"${w}" is not a DIMACS literal (signed integers, 0 ends a clause).`);
      ints.push(Number(w));
    }
  }
  if (n < 0) throw new DiscreteError('DIMACS needs a "p cnf n m" header line.');
  const clauses: SatLit[][] = [];
  let cur: SatLit[] = [];
  for (const k of ints) {
    if (k === 0) { clauses.push(cur); cur = []; continue; }
    if (Math.abs(k) > n) throw new DiscreteError(`Literal ${k} names variable ${Math.abs(k)}, but the header declares only ${n} variables.`);
    cur.push({ v: Math.abs(k) - 1, neg: k < 0 });
  }
  if (cur.length) clauses.push(cur); // a last clause without its 0 is accepted
  const vars = Array.from({ length: n }, (_, i) => `x${SUB(i + 1)}`);
  // Dedupe/tautology fold as the symbolic reader does.
  const out: SatLit[][] = [];
  for (const c of clauses) {
    const seen = new Map<string, SatLit>();
    for (const l of c) seen.set(`${l.neg ? "-" : ""}${l.v}`, l);
    const lits = [...seen.values()];
    if (lits.some((l) => seen.has(`${l.neg ? "" : "-"}${l.v}`))) continue;
    out.push(lits);
  }
  return { cnf: { vars, clauses: out }, declared: { n, m }, comments };
}

// ---------------------------------------------------------------------------
// Printing (re-parses through parseCnf)

export function showLit(cnf: Cnf, l: SatLit): string { return `${l.neg ? "¬" : ""}${cnf.vars[l.v]}`; }
/** (a ∨ ¬b); a unit clause prints bare; the empty clause is □. */
export function showClause(cnf: Cnf, c: SatLit[]): string {
  if (!c.length) return "□";
  if (c.length === 1) return showLit(cnf, c[0]);
  return `(${c.map((l) => showLit(cnf, l)).join(" ∨ ")})`;
}
export function showCnf(cnf: Cnf): string {
  if (!cnf.clauses.length) return "⊤ (no clauses)";
  return cnf.clauses.map((c) => (c.length === 1 ? `(${showClause(cnf, c)})` : showClause(cnf, c))).join(" ∧ ");
}
const TF = (b: boolean): string => (b ? "T" : "F");
function showModel(cnf: Cnf, model: boolean[]): string { return cnf.vars.map((v, i) => `${v}=${TF(model[i])}`).join(" "); }

function clauseValue(c: SatLit[], model: boolean[]): SatLit | null {
  for (const l of c) if (model[l.v] !== l.neg) return l;
  return null;
}

/** Every clause re-evaluated under the model: the checklist, and whether all pass. */
function checklist(cnf: Cnf, model: boolean[]): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  let ok = true;
  for (const c of cnf.clauses) {
    const w = clauseValue(c, model);
    if (!w) ok = false;
    lines.push(`${showClause(cnf, c)} ${w ? `✓ (${showLit(cnf, w)})` : "✗ FALSE"}`);
  }
  return { lines, ok };
}

// ---------------------------------------------------------------------------
// Brute force (the cross-check and the model count)

/** Counts models by enumeration with a clause-evaluation budget; null = budget exceeded. */
export function countModels(cnf: Cnf, budget = SAT_CAPS.countBudget): { count: number; evaluations: number } | null {
  const r = enumerate(cnf, budget, false);
  return r && { count: r.count, evaluations: r.evaluations };
}

/** Clause-evaluation budget of the brute-force AGREEMENT check (separate from
 *  the stated model-count budget: it may stop at the first model). */
export const AGREE_BUDGET = 60_000_000;

/** Brute-force satisfiability (stops at the first model); null = not run (above 20 variables or budget). */
export function bruteSatisfiable(cnf: Cnf): boolean | null {
  const r = enumerate(cnf, AGREE_BUDGET, true);
  return r && r.count > 0;
}

/** Bitmask enumeration over every assignment (variable i = bit i). */
function enumerate(cnf: Cnf, budget: number, stopAtFirst: boolean): { count: number; evaluations: number } | null {
  const n = cnf.vars.length;
  if (n > SAT_CAPS.countVars) return null;
  const pos = new Int32Array(cnf.clauses.length);
  const neg = new Int32Array(cnf.clauses.length);
  cnf.clauses.forEach((c, i) => { for (const l of c) { if (l.neg) neg[i] |= 1 << l.v; else pos[i] |= 1 << l.v; } });
  const m = cnf.clauses.length;
  let count = 0;
  let evals = 0;
  const total = 2 ** n;
  for (let mask = 0; mask < total; mask++) {
    let all = true;
    for (let i = 0; i < m; i++) {
      evals++;
      if (((mask & pos[i]) | (~mask & neg[i])) === 0) { all = false; break; }
    }
    if (evals > budget) return null;
    if (all) { count++; if (stopAtFirst) break; }
  }
  return { count, evaluations: evals };
}

// ---------------------------------------------------------------------------
// DPLL with trace, decision tree and refutation extraction

export interface Derivation {
  /** id ≥ 1; inputs are 1..m, derived clauses follow. */
  id: number;
  lits: SatLit[];
  from?: [number, number];
  pivot?: number;
}

export interface DpllOutcome {
  kind: "sat" | "unsat" | "budget";
  model?: boolean[];
  /** Variables that never needed a value (set F in the model). */
  free?: number[];
  steps: string[];
  tree: { nodes: TreeNode[]; edges: TreeEdge[]; truncated: boolean };
  decisions: number;
  conflicts: number;
  branches: number;
  derivations?: Derivation[];
  empty?: number;
  core?: number[];
}

export function dpll(cnf: Cnf, decisionCap = SAT_CAPS.decisions): DpllOutcome {
  const n = cnf.vars.length;
  const assign = new Int8Array(n).fill(-1);
  interface TrailEntry { v: number; val: boolean; reason: number } // reason: clause index, -1 decision, -2 pure
  const trail: TrailEntry[] = [];
  const steps: string[] = [];
  let omitted = 0;
  const log = (s: () => string): void => { if (steps.length < SAT_CAPS.stepLines) steps.push(s()); else omitted++; };
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  let truncated = false;
  let nodeSeq = 0;
  const addNode = (label: string, parent: string | null, kind?: TreeNode["kind"], highlight?: boolean): string | null => {
    if (nodes.length >= SAT_CAPS.treeNodes) { truncated = true; return null; }
    const id = `n${nodeSeq++}`;
    nodes.push({ id, label, kind, highlight });
    if (parent) edges.push({ from: parent, to: id });
    return id;
  };
  const derivations: Derivation[] = cnf.clauses.map((lits, i) => ({ id: i + 1, lits }));
  let decisions = 0, conflicts = 0, branches = 0;
  const ind = (d: number): string => "  ".repeat(d);
  const litFalse = (l: SatLit): boolean => assign[l.v] === (l.neg ? 1 : 0);
  const litTrue = (l: SatLit): boolean => assign[l.v] === (l.neg ? 0 : 1);
  const set = (v: number, val: boolean, reason: number): void => { assign[v] = val ? 1 : 0; trail.push({ v, val, reason }); markFalsified(v, val); };
  const undoTo = (mark: number): void => { while (trail.length > mark) { const e = trail.pop()!; assign[e.v] = -1; } };

  // Occurrence lists: occ[2v] = clauses holding v, occ[2v+1] = clauses holding ¬v.
  const m = cnf.clauses.length;
  const occ: number[][] = Array.from({ length: 2 * n }, () => []);
  cnf.clauses.forEach((c, ci) => { for (const l of c) occ[2 * l.v + (l.neg ? 1 : 0)].push(ci); });
  // Only a clause that just lost a literal can become unit or empty, so only
  // those ("dirty") are re-examined — in clause order, pass after pass, which
  // is exactly the order of a full rescan (same trace, a fraction of the work).
  const dirty = new Uint8Array(m).fill(1);
  const markFalsified = (v: number, val: boolean): void => { for (const ci of occ[2 * v + (val ? 1 : 0)]) dirty[ci] = 1; };

  /** Unit propagation to a fixpoint; returns the index of a falsified clause or -1. */
  const propagate = (depth: number, parent: { id: string | null }): number => {
    for (;;) {
      let changed = false;
      for (let ci = 0; ci < m; ci++) {
        if (!dirty[ci]) continue;
        dirty[ci] = 0;
        const c = cnf.clauses[ci];
        let unassigned: SatLit | null = null;
        let count = 0;
        let sat = false;
        for (const l of c) {
          if (litTrue(l)) { sat = true; break; }
          if (!litFalse(l)) { count++; unassigned = l; }
        }
        if (sat) continue;
        if (count === 0) { dirty.fill(0); return ci; }
        if (count === 1) {
          const l = unassigned!;
          set(l.v, !l.neg, ci);
          log(() => `${ind(depth)}unit ${cnf.vars[l.v]} = ${TF(!l.neg)} from ${showClause(cnf, c)}`);
          const nid = addNode(`${cnf.vars[l.v]} = ${TF(!l.neg)}`, parent.id);
          if (nid) parent.id = nid;
          changed = true;
        }
      }
      if (!changed) return -1;
    }
  };
  /** The pure-literal rule, one variable at a time in variable order: counts
   *  of each literal over the open clauses, updated as each pure assignment
   *  satisfies more clauses (so a later variable sees the earlier ones). */
  /** Returns −1 when no clause is open (every clause satisfied), 1 when a
   *  pure literal was set, 0 otherwise. One scan serves both questions. */
  const cnt = new Int32Array(2 * n);
  const open = new Uint8Array(m);
  const pure = (depth: number, parent: { id: string | null }): number => {
    cnt.fill(0);
    let openCount = 0;
    for (let ci = 0; ci < m; ci++) {
      const c = cnf.clauses[ci];
      open[ci] = 0;
      let sat = false;
      for (const l of c) if (assign[l.v] === (l.neg ? 0 : 1)) { sat = true; break; }
      if (sat) continue;
      open[ci] = 1;
      openCount++;
      for (const l of c) if (assign[l.v] < 0) cnt[2 * l.v + (l.neg ? 1 : 0)]++;
    }
    if (!openCount) return -1;
    let any = false;
    for (let v = 0; v < n; v++) {
      if (assign[v] >= 0) continue;
      const pos = cnt[2 * v] > 0, neg = cnt[2 * v + 1] > 0;
      if (pos === neg) continue; // both or neither
      set(v, pos, -2);
      for (const ci of occ[2 * v + (pos ? 0 : 1)]) {
        if (!open[ci]) continue;
        open[ci] = 0;
        for (const l of cnf.clauses[ci]) if (assign[l.v] < 0) cnt[2 * l.v + (l.neg ? 1 : 0)]--;
      }
      log(() => `${ind(depth)}pure ${cnf.vars[v]} = ${TF(pos)} (${pos ? "only positive" : "only negative"} in the open clauses)`);
      const nid = addNode(`${cnf.vars[v]} = ${TF(pos)}`, parent.id);
      if (nid) parent.id = nid;
      any = true;
    }
    return any ? 1 : 0;
  };

  /** Conflict analysis: resolve the falsified clause against the reasons of
   *  every implied literal (whole trail, newest first) until only decision
   *  literals remain. Returns the derivation id of that clause. */
  const analyze = (conflict: number): number => {
    let cur = derivations[conflict];
    const has = (lits: SatLit[], v: number): SatLit | undefined => lits.find((l) => l.v === v);
    for (let i = trail.length - 1; i >= 0; i--) {
      const e = trail[i];
      const l = has(cur.lits, e.v);
      if (!l) continue;
      if (e.reason === -1) continue;
      if (e.reason === -2) throw new DiscreteError("Refutation extraction met a pure-literal variable in a conflict clause — a defect in this tool; nothing is reported.");
      const reason = derivations[e.reason];
      const resolvent = resolve(cur.lits, reason.lits, e.v);
      if (!resolvent) throw new DiscreteError("Refutation extraction failed to resolve on an implied literal — a defect in this tool; nothing is reported.");
      cur = { id: derivations.length + 1, lits: resolvent, from: [cur.id, reason.id], pivot: e.v };
      derivations.push(cur);
    }
    return cur.id;
  };

  type Res = { kind: "sat" } | { kind: "unsat"; learned: number } | { kind: "budget" };
  const search = (depth: number, parentId: string | null): Res => {
    const mark = trail.length;
    const p = { id: parentId };
    for (;;) {
      const c = propagate(depth, p);
      if (c >= 0) {
        conflicts++;
        log(() => `${ind(depth)}conflict ${showClause(cnf, cnf.clauses[c])}`);
        addNode("⊥", p.id, "bottom");
        const learned = analyze(c);
        undoTo(mark);
        return { kind: "unsat", learned };
      }
      const pr = pure(depth, p);
      if (pr < 0) {
        log(() => `${ind(depth)}every clause satisfied`);
        addNode("□", p.id, "box", true);
        return { kind: "sat" };
      }
      if (pr === 0) break;
    }
    let v = 0;
    while (v < n && assign[v] >= 0) v++;
    if (v === n) throw new DiscreteError("DPLL state error (no variable to decide while clauses remain open) — a defect in this tool.");
    if (decisions >= decisionCap) { undoTo(mark); return { kind: "budget" }; }
    decisions++;
    const results: Res[] = [];
    for (const val of [true, false]) {
      branches++;
      const m2 = trail.length;
      set(v, val, -1);
      log(() => `${ind(depth)}decide ${cnf.vars[v]} = ${TF(val)}`);
      const nid = addNode(`${cnf.vars[v]} = ${TF(val)}`, p.id);
      const r = search(depth + 1, nid);
      // SAT: keep the whole trail (the decision AND every literal the subtree
      // propagated) — it IS the model. Undoing first would lose the subtree.
      if (r.kind === "sat") return r;
      undoTo(m2);
      if (r.kind === "budget") { undoTo(mark); return r; }
      results.push(r);
      const learned = derivations[r.learned - 1].lits;
      // The learned clause is false under the decisions above; if it does not
      // mention v, the other branch cannot help and is logically redundant.
      if (!learned.some((l) => l.v === v)) { undoTo(mark); return r; }
    }
    const a = derivations[(results[0] as { learned: number }).learned - 1];
    const b = derivations[(results[1] as { learned: number }).learned - 1];
    const resolvent = resolve(a.lits, b.lits, v);
    if (!resolvent) throw new DiscreteError("Refutation extraction failed at a decision — a defect in this tool; nothing is reported.");
    const d: Derivation = { id: derivations.length + 1, lits: resolvent, from: [a.id, b.id], pivot: v };
    derivations.push(d);
    undoTo(mark);
    return { kind: "unsat", learned: d.id };
  };

  const rootId = addNode("start", null);
  const r = search(0, rootId);
  if (omitted) steps.push(`… ${omitted.toLocaleString("en-US")} more steps not listed (the first ${SAT_CAPS.stepLines} are shown; the verdict covers the whole search).`);
  const tree = { nodes, edges, truncated };
  if (r.kind === "sat") {
    const model = Array.from({ length: n }, (_, i) => assign[i] === 1);
    const free = Array.from({ length: n }, (_, i) => i).filter((i) => assign[i] < 0);
    return { kind: "sat", model, free, steps, tree, decisions, conflicts, branches };
  }
  if (r.kind === "budget") return { kind: "budget", steps, tree, decisions, conflicts, branches };
  const empty = derivations[r.learned - 1];
  if (empty.lits.length) throw new DiscreteError("Refutation extraction ended in a non-empty clause — a defect in this tool; nothing is reported.");
  // Core: input clauses reachable from □.
  const core = new Set<number>();
  const stack = [empty.id];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const d = derivations[id - 1];
    if (d.from) stack.push(...d.from); else core.add(id);
  }
  return { kind: "unsat", steps, tree, decisions, conflicts, branches, derivations, empty: empty.id, core: [...core].sort((x, y) => x - y) };
}

/** Binary resolution on variable v: null when the clauses do not clash on v exactly once each or the result would be a tautology. */
export function resolve(a: SatLit[], b: SatLit[], v: number): SatLit[] | null {
  const la = a.filter((l) => l.v === v);
  const lb = b.filter((l) => l.v === v);
  if (la.length !== 1 || lb.length !== 1 || la[0].neg === lb[0].neg) return null;
  // Literal code 2v + neg: numeric keys (this runs once per implied literal per conflict).
  const out = new Map<number, SatLit>();
  for (const l of a) if (l.v !== v) out.set(2 * l.v + (l.neg ? 1 : 0), l);
  for (const l of b) if (l.v !== v) out.set(2 * l.v + (l.neg ? 1 : 0), l);
  for (const k of out.keys()) if (out.has(k ^ 1)) return null;
  return [...out.values()];
}

function sameLits(a: SatLit[], b: SatLit[]): boolean {
  const key = (ls: SatLit[]): string => ls.map((l) => `${l.neg ? "-" : ""}${l.v}`).sort().join(",");
  return key(a) === key(b);
}

/** The refutation as numbered lines (only the ancestors of □), each re-verified. */
function refutationLines(cnf: Cnf, derivations: Derivation[], empty: number): { lines: string[]; ok: boolean; steps: number; number: Map<number, number> } {
  const need = new Set<number>();
  const stack = [empty];
  while (stack.length) {
    const id = stack.pop()!;
    if (need.has(id)) continue;
    need.add(id);
    const d = derivations[id - 1];
    if (d.from) stack.push(...d.from);
  }
  const m = cnf.clauses.length;
  const number = new Map<number, number>();
  for (let i = 1; i <= m; i++) number.set(i, i);
  let next = m + 1;
  const lines: string[] = [];
  let ok = true;
  let steps = 0;
  for (const d of derivations) {
    if (!d.from || !need.has(d.id)) continue;
    number.set(d.id, next++);
    const a = derivations[d.from[0] - 1], b = derivations[d.from[1] - 1];
    const check = resolve(a.lits, b.lits, d.pivot!);
    const good = !!check && sameLits(check, d.lits);
    if (!good) ok = false;
    steps++;
    lines.push(`${number.get(d.id)}. ${showClause(cnf, a.lits)}, ${showClause(cnf, b.lits)} ⇒ ${showClause(cnf, d.lits)}  [on ${cnf.vars[d.pivot!]}; from ${number.get(a.id)}, ${number.get(b.id)}]${good ? "" : " — VERIFICATION FAILED"}`);
  }
  return { lines, ok, steps, number };
}

// ---------------------------------------------------------------------------
// 2-SAT and Horn

export interface TwoSatOutcome {
  kind: "sat" | "unsat";
  model?: boolean[];
  contradiction?: number;
  components: number[][];
  edges: { from: string; to: string }[];
  names: string[];
  svg?: string;
}

export function twoSat(cnf: Cnf, draw = true): TwoSatOutcome {
  const n = cnf.vars.length;
  const names: string[] = [];
  for (let i = 0; i < n; i++) { names.push(cnf.vars[i]); names.push(`¬${cnf.vars[i]}`); }
  const vid = (l: SatLit): number => 2 * l.v + (l.neg ? 1 : 0);
  const negOf = (l: SatLit): SatLit => ({ v: l.v, neg: !l.neg });
  const edgeList: { from: string; to: string }[] = [];
  for (const c of cnf.clauses) {
    if (c.length === 0) return { kind: "unsat", components: [], edges: [], names };
    const [a, b] = c.length === 1 ? [c[0], c[0]] : c;
    // (a ∨ b): ¬a → b, ¬b → a
    edgeList.push({ from: names[vid(negOf(a))], to: names[vid(b)] });
    if (c.length === 2) edgeList.push({ from: names[vid(negOf(b))], to: names[vid(a)] });
  }
  const seen = new Set<string>();
  const unique = edgeList.filter((e) => { const k = `${e.from}>${e.to}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const g = buildGraph(names, unique, true);
  const comps = strongComponents(g);
  const compOf = new Int32Array(2 * n);
  comps.forEach((c, i) => { for (const v of c) compOf[v] = i; });
  for (let i = 0; i < n; i++) {
    if (compOf[2 * i] === compOf[2 * i + 1]) {
      let svg: string | undefined;
      if (draw && 2 * n <= SAT_CAPS.drawVertices) {
        svg = graphSvg(g, { caption: `Implication graph — ${cnf.vars[i]} and ¬${cnf.vars[i]} share a strongly connected component`, highlightVerts: new Set(comps[compOf[2 * i]]) });
      }
      return { kind: "unsat", contradiction: i, components: comps, edges: unique, names, svg };
    }
  }
  // Topological order of the condensation (Kahn), then x = T iff comp(x) comes after comp(¬x).
  const k = comps.length;
  const indeg = new Int32Array(k);
  const out: number[][] = Array.from({ length: k }, () => []);
  const seenC = new Set<string>();
  for (const e of g.edges) {
    const a = compOf[e.u], b = compOf[e.v];
    if (a === b || seenC.has(`${a}>${b}`)) continue;
    seenC.add(`${a}>${b}`);
    out[a].push(b);
    indeg[b]++;
  }
  const order: number[] = [];
  const queue: number[] = [];
  for (let c = 0; c < k; c++) if (indeg[c] === 0) queue.push(c);
  while (queue.length) {
    const c = queue.shift()!;
    order.push(c);
    for (const d of out[c]) if (--indeg[d] === 0) queue.push(d);
  }
  const pos = new Int32Array(k);
  order.forEach((c, i) => { pos[c] = i; });
  const model: boolean[] = [];
  for (let i = 0; i < n; i++) model.push(pos[compOf[2 * i]] > pos[compOf[2 * i + 1]]);
  let svg: string | undefined;
  if (draw && 2 * n <= SAT_CAPS.drawVertices) {
    const trueVerts = new Set<number>();
    for (let i = 0; i < n; i++) trueVerts.add(model[i] ? 2 * i : 2 * i + 1);
    svg = graphSvg(g, { caption: "Implication graph — highlighted: the literals true in the model", highlightVerts: trueVerts });
  }
  return { kind: "sat", model, components: comps, edges: unique, names, svg };
}

export interface HornOutcome { kind: "sat" | "unsat"; forced: number[]; steps: string[]; violated?: number }

export function horn(cnf: Cnf): HornOutcome {
  const n = cnf.vars.length;
  const forced = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const steps: string[] = [];
  for (;;) {
    let changed = false;
    for (let ci = 0; ci < cnf.clauses.length; ci++) {
      const c = cnf.clauses[ci];
      const negs = c.filter((l) => l.neg);
      const pos = c.find((l) => !l.neg);
      if (!negs.every((l) => forced[l.v])) continue;
      if (!pos) { steps.push(`${showClause(cnf, c)}: every negative literal is forced true — the clause is violated`); return { kind: "unsat", forced: order, steps, violated: ci }; }
      if (forced[pos.v]) continue;
      forced[pos.v] = true;
      order.push(pos.v);
      steps.push(negs.length ? `${negs.map((l) => cnf.vars[l.v]).join(" ∧ ")} → ${cnf.vars[pos.v]}: ${cnf.vars[pos.v]} forced true` : `fact ${cnf.vars[pos.v]}: forced true`);
      changed = true;
    }
    if (!changed) break;
  }
  return { kind: "sat", forced: order, steps };
}

// ---------------------------------------------------------------------------
// Front door

function pigeonholeRefusal(n: number, m: number): never {
  if (n < 1 || m < 1 || n > 9 || m > 9) throw new DiscreteError(`pigeonhole ${n} ${m} is prose, not a CNF — nothing is computed from a description. Type the clauses (variables pᵢⱼ = pigeon i in hole j; shown for n, m ≤ 9).`);
  const p = (i: number, j: number): string => `p${SUB(i)}${SUB(j)}`;
  const clauses: string[] = [];
  for (let i = 1; i <= n; i++) clauses.push(`(${Array.from({ length: m }, (_, j) => p(i, j + 1)).join(" ∨ ")})`);
  for (let h = 1; h <= m; h++) for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) clauses.push(`(¬${p(i, h)} ∨ ¬${p(j, h)})`);
  throw new DiscreteError(`"pigeonhole ${n} ${m}" is prose, not a CNF — nothing is computed from a description. The ${clauses.length} clauses over ${p(1, 1)}…${p(n, m)} (pᵢⱼ = pigeon i in hole j) are: ${clauses.join(" ∧ ")} — type "dpll" followed by them.`);
}

function capsCaveat(): string {
  return `Caps: ${SAT_CAPS.vars} variables, ${SAT_CAPS.clauses} clauses, ${SAT_CAPS.decisions.toLocaleString("en-US")} DPLL decisions; model counting by brute force up to ${SAT_CAPS.countVars} variables within ${SAT_CAPS.countBudget.toLocaleString("en-US")} clause evaluations; 2-SAT/Horn ${SAT_CAPS.twoSatClauses.toLocaleString("en-US")} clauses.`;
}

function checkDpllCaps(cnf: Cnf): void {
  if (cnf.vars.length > SAT_CAPS.vars) throw new DiscreteError(`${cnf.vars.length} variables is above the ${SAT_CAPS.vars}-variable cap for DPLL (2-SAT and Horn formulas take up to ${SAT_CAPS.linearVars.toLocaleString("en-US")} — write 2sat … or horn …).`);
  if (cnf.clauses.length > SAT_CAPS.clauses) throw new DiscreteError(`${cnf.clauses.length} clauses is above the ${SAT_CAPS.clauses}-clause cap for DPLL.`);
}

/** The engine. null = not ours. */
export function solveSat(input: string): DiscreteResult | null {
  const raw = input.replace(/\r/g, "").trim();
  if (!raw) return null;
  // DIMACS: the first non-comment line is "p cnf n m" (an optional "dimacs" line may precede it).
  const firstReal = raw.split("\n").map((l) => l.trim()).find((l) => l && !/^c\b/i.test(l) && !/^dimacs\s*:?$/i.test(l) && !/^%/.test(l));
  if (firstReal && /^p\s+cnf\b/i.test(firstReal)) {
    const d = parseDimacs(raw);
    return answerDpll(d.cnf, "dpll", { header: `DIMACS: p cnf ${d.declared.n} ${d.declared.m}${d.comments ? ` (${d.comments} comment line${d.comments === 1 ? "" : "s"} skipped)` : ""}${d.declared.m !== d.cnf.clauses.length ? ` — the header declares ${d.declared.m} clauses, ${d.cnf.clauses.length} read` : ""}` });
  }
  const km = SAT_RE.exec(raw);
  if (km) {
    const kw = km[0].trim().toLowerCase().replace(/\s+/g, " ").replace(/^2[-\s]?sat$/, "2sat").replace(/^horn[-\s]sat$/, "horn");
    const body = raw.slice(km[0].length).replace(/^\s*:\s*/, "").trim();
    if (kw === "pigeonhole" || kw === "php") {
      const nums = body.match(/\d+/g);
      if (!nums || nums.length < 2) throw new DiscreteError('"pigeonhole" is prose, not a CNF — write pigeonhole 3 2 to see the clauses, then type them under dpll.');
      pigeonholeRefusal(Number(nums[0]), Number(nums[1]));
    }
    if (kw === "dimacs" || kw === "p cnf") {
      const d = parseDimacs(raw);
      return answerDpll(d.cnf, "dpll", { header: `DIMACS: p cnf ${d.declared.n} ${d.declared.m}` });
    }
    if (!body) throw new DiscreteError(`"${kw}" needs a CNF after it: ${kw} (a ∨ ¬b) ∧ (b ∨ c).`);
    if (/^pigeonhole|^php/i.test(body)) { const nums = body.match(/\d+/g) || []; pigeonholeRefusal(Number(nums[0] ?? 0), Number(nums[1] ?? 0)); }
    const cnf = parseCnf(body, { allowImplications: true, multiline: true });
    if (kw === "2sat") return answerTwoSat(cnf);
    if (kw === "horn") return answerHorn(cnf);
    return answerDpll(cnf, kw as "dpll" | "unsat core" | "resolution proof", {});
  }
  // A bare CNF on one line with more than proplogic's 10 variables.
  if (raw.includes("\n")) return null;
  // "is <CNF> satisfiable" (§D): proplogic's verb reader takes only a LEADING
  // verb, so the trailing "satisfiable" made it refuse "two things side by
  // side". A CNF in that frame is claimed here at any size; a non-CNF formula
  // still falls through to the truth table.
  const q = /^is\s+(.+?)\s+satisfiable\s*\??$/i.exec(raw);
  if (q && /[∨|∧&]/.test(q[1])) {
    let cnf: Cnf | null = null;
    try { cnf = parseCnf(q[1], { allowImplications: false, multiline: false }); } catch { cnf = null; }
    if (cnf) {
      const r = answerDpll(cnf, "dpll", { header: "Read as a CNF question: is it satisfiable?" });
      r.display.splice(1, 0, r.display[1].startsWith("SATISFIABLE") ? "Yes: it is satisfiable." : "No: it is unsatisfiable.");
      return r;
    }
  }
  let body = raw.replace(/^(?:is\s+(?:this|it)\s+|is\s+)?(?:sat|satisfiable|cnf)\b\s*:?\s*/i, "").replace(/\s+(?:satisfiable|sat)\??\s*$/i, "").replace(/\?\s*$/, "").trim();
  if (!body || !/[∨|∧&+]|\bor\b|\band\b/i.test(body)) return null;
  let cnf: Cnf;
  try { cnf = parseCnf(body, { allowImplications: false, multiline: false }); } catch { return null; }
  if (cnf.vars.length <= PROP_MAX_VARS) return null;
  return answerDpll(cnf, "dpll", { header: `${cnf.vars.length} variables — above the ${PROP_MAX_VARS}-variable truth table, so DPLL answers` });
}

function answerDpll(cnf: Cnf, verb: "dpll" | "unsat core" | "resolution proof", opts: { header?: string }): DiscreteResult {
  checkDpllCaps(cnf);
  const display: string[] = [];
  const steps: string[] = [];
  const caveats: string[] = [];
  display.push(`CNF, ${cnf.vars.length} variable${cnf.vars.length === 1 ? "" : "s"}, ${cnf.clauses.length} clause${cnf.clauses.length === 1 ? "" : "s"}: ${showCnf(cnf)}`);
  if (opts.header) steps.push(opts.header);
  steps.push(`Variable order (decisions and the pure-literal rule follow it): ${cnf.vars.join(", ")}.`);
  const r = dpll(cnf);
  const brute = countModels(cnf);
  if (r.kind === "budget") {
    display.push(`UNKNOWN: search budget — ${SAT_CAPS.decisions.toLocaleString("en-US")} decisions without a verdict (DPLL is exponential in the worst case). Nothing is reported rather than guessed.`);
    steps.push(...r.steps);
    caveats.push(capsCaveat());
    return { title: "DPLL", display, steps, caveats };
  }
  if (r.kind === "sat") {
    const model = r.model!;
    const cl = checklist(cnf, model);
    if (!cl.ok) throw new DiscreteError("The DPLL model fails a clause on re-evaluation — a defect in this tool; nothing is reported.");
    if (brute && brute.count === 0) throw new DiscreteError("DPLL says SAT but brute force finds no model — a defect in this tool; nothing is reported.");
    display.push(`SATISFIABLE${verb === "unsat core" ? " — no unsat core exists" : ""}: ${showModel(cnf, model)}${r.free!.length ? ` (${r.free!.map((i) => cnf.vars[i]).join(", ")} never needed a value; set F)` : ""}`);
    display.push(brute ? `${brute.count.toLocaleString("en-US")} model${brute.count === 1 ? "" : "s"} in all (brute force over ${2 ** cnf.vars.length} assignments).` : `Model count not computed (${cnf.vars.length > SAT_CAPS.countVars ? `above ${SAT_CAPS.countVars} variables` : `above the ${SAT_CAPS.countBudget.toLocaleString("en-US")} clause-evaluation budget`}).`);
    steps.push(...r.steps);
    steps.push("Every clause under the model:");
    steps.push(...cl.lines.map((l) => `  ${l}`));
    steps.push(`Verified: all ${cnf.clauses.length} clauses re-evaluated true${brute ? "; brute force agrees that the formula is satisfiable" : ""}.`);
    caveats.push(`${r.decisions} decision${r.decisions === 1 ? "" : "s"}, ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}. ${capsCaveat()}`);
    const svg = treeSvg({ nodes: r.tree.nodes, edges: r.tree.edges, caption: `DPLL search tree — □ marks the model${r.tree.truncated ? ` (first ${SAT_CAPS.treeNodes} nodes)` : ""}` });
    return { title: "DPLL", display, steps, caveats, svg, alt: `DPLL decision tree with ${r.tree.nodes.length} nodes ending in a satisfying leaf.` };
  }
  // UNSAT
  const ref = refutationLines(cnf, r.derivations!, r.empty!);
  if (!ref.ok) throw new DiscreteError("A resolvent of the extracted refutation failed re-verification — a defect in this tool; nothing is reported.");
  const agree = bruteSatisfiable(cnf);
  if (agree === true) throw new DiscreteError("DPLL says UNSAT but brute force finds a model — a defect in this tool; nothing is reported.");
  const core = r.core!;
  display.push(`UNSATISFIABLE — every branch ends in a conflict (${r.branches} branch${r.branches === 1 ? "" : "es"}, ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}).`);
  const used = r.derivations!.filter((d) => d.from && ref.number.has(d.id));
  const SHOWN = 12;
  display.push(`Resolution refutation (${ref.steps} resolvent${ref.steps === 1 ? "" : "s"}): ${used.slice(0, SHOWN).map((d) => `${showClause(cnf, r.derivations![d.from![0] - 1].lits)}, ${showClause(cnf, r.derivations![d.from![1] - 1].lits)} ⇒ ${showClause(cnf, d.lits)}`).join("; ")}${used.length > SHOWN ? `; … ${used.length - SHOWN} more (all listed in the working)` : ""}`);
  display.push(`Unsat core (${core.length} of ${cnf.clauses.length} clauses): {${core.map((i) => showClause(cnf, cnf.clauses[i - 1])).join(", ")}}`);
  if (agree === false) display.push("0 models in all (brute force agrees).");
  steps.push(...r.steps);
  steps.push("Refutation (input clauses numbered as written):");
  const LISTED = 200;
  steps.push(...ref.lines.slice(0, LISTED).map((l) => `  ${l}`));
  if (ref.lines.length > LISTED) steps.push(`  … ${ref.lines.length - LISTED} more resolvents not listed (every one was verified).`);
  steps.push(`Verified: each resolvent recomputed from its two parents on the stated variable (${ref.steps} step${ref.steps === 1 ? "" : "s"})${agree === false ? `; brute force over ${2 ** cnf.vars.length} assignments finds no model` : ""}.`);
  caveats.push(`${r.decisions} decision${r.decisions === 1 ? "" : "s"}. ${capsCaveat()}`);
  if (agree === null) caveats.push(`Brute-force cross-check NOT run (${cnf.vars.length > SAT_CAPS.countVars ? `above ${SAT_CAPS.countVars} variables` : "budget"}); the verified refutation is the proof.`);
  const svg = treeSvg({ nodes: r.tree.nodes, edges: r.tree.edges, caption: `DPLL search tree — every leaf is a conflict ⊥${r.tree.truncated ? ` (first ${SAT_CAPS.treeNodes} nodes)` : ""}` });
  return { title: verb === "unsat core" ? "Unsat core" : verb === "resolution proof" ? "Resolution proof" : "DPLL", display, steps, caveats, svg, alt: `DPLL decision tree with ${r.tree.nodes.length} nodes, every leaf a conflict.` };
}

function answerTwoSat(cnf: Cnf): DiscreteResult {
  if (cnf.clauses.length > SAT_CAPS.twoSatClauses) throw new DiscreteError(`${cnf.clauses.length} clauses is above the ${SAT_CAPS.twoSatClauses.toLocaleString("en-US")}-clause cap for 2-SAT.`);
  if (cnf.vars.length > SAT_CAPS.linearVars) throw new DiscreteError(`${cnf.vars.length} variables is above the ${SAT_CAPS.linearVars.toLocaleString("en-US")}-variable cap for 2-SAT.`);
  const big = cnf.clauses.findIndex((c) => c.length > 2);
  if (big >= 0) throw new DiscreteError(`Not a 2-CNF: clause ${big + 1} ${showClause(cnf, cnf.clauses[big])} has ${cnf.clauses[big].length} literals — write dpll … for general CNF.`);
  const display = [`2-CNF, ${cnf.vars.length} variable${cnf.vars.length === 1 ? "" : "s"}, ${cnf.clauses.length} clause${cnf.clauses.length === 1 ? "" : "s"}: ${showCnf(cnf)}`];
  const steps: string[] = [];
  const r = twoSat(cnf);
  steps.push(`Implication edges (each clause (a ∨ b) gives ¬a → b and ¬b → a): ${r.edges.map((e) => `${e.from} → ${e.to}`).join(", ")}`);
  steps.push(`Strongly connected components (Tarjan): ${r.components.map((c) => `{${c.map((v) => r.names[v]).join(", ")}}`).join(", ")}`);
  const caveats = [`Exact and polynomial: a 2-CNF is unsatisfiable exactly when some x and ¬x share a strongly connected component of the implication graph (no search). ${capsCaveat()}`];
  const brute = countModels(cnf);
  if (r.kind === "unsat") {
    if (r.contradiction === undefined) { display.push("UNSATISFIABLE — the empty clause □ is present."); return { title: "2-SAT", display, steps, caveats }; }
    const v = cnf.vars[r.contradiction];
    const agree = bruteSatisfiable(cnf);
    if (agree === true) throw new DiscreteError("2-SAT says UNSAT but brute force finds a model — a defect in this tool; nothing is reported.");
    display.push(`UNSATISFIABLE — ${v} and ¬${v} are in the same strongly connected component (${v} → … → ¬${v} → … → ${v}).`);
    if (agree === false) display.push("0 models in all (brute force agrees).");
    else caveats.push("Brute-force cross-check NOT run (above 20 variables); the shared component is the proof.");
    return { title: "2-SAT", display, steps, caveats, ...(r.svg ? { svg: r.svg, alt: `Implication graph; ${v} and ¬${v} share a component.` } : {}) };
  }
  const model = r.model!;
  const cl = checklist(cnf, model);
  if (!cl.ok) throw new DiscreteError("The 2-SAT model fails a clause on re-evaluation — a defect in this tool; nothing is reported.");
  display.push(`SATISFIABLE: ${showModel(cnf, model)}`);
  if (brute) display.push(brute.count === 1 ? "1 model in all — the only model (brute force)." : `${brute.count.toLocaleString("en-US")} models in all (brute force over ${2 ** cnf.vars.length} assignments).`);
  steps.push("Model from the condensation's topological order: x = T when the component of x comes after the component of ¬x.");
  steps.push("Every clause under the model:");
  steps.push(...cl.lines.map((l) => `  ${l}`));
  steps.push(`Verified: all ${cnf.clauses.length} clauses re-evaluated true.`);
  return { title: "2-SAT", display, steps, caveats, ...(r.svg ? { svg: r.svg, alt: "Implication graph with the literals true in the model highlighted." } : {}) };
}

function answerHorn(cnf: Cnf): DiscreteResult {
  if (cnf.clauses.length > SAT_CAPS.hornClauses) throw new DiscreteError(`${cnf.clauses.length} clauses is above the ${SAT_CAPS.hornClauses.toLocaleString("en-US")}-clause cap for Horn.`);
  if (cnf.vars.length > SAT_CAPS.linearVars) throw new DiscreteError(`${cnf.vars.length} variables is above the ${SAT_CAPS.linearVars.toLocaleString("en-US")}-variable cap for Horn.`);
  const bad = cnf.clauses.findIndex((c) => c.filter((l) => !l.neg).length > 1);
  if (bad >= 0) throw new DiscreteError(`Not Horn: clause ${bad + 1} ${showClause(cnf, cnf.clauses[bad])} has ${cnf.clauses[bad].filter((l) => !l.neg).length} positive literals (a Horn clause has at most one) — write dpll … for general CNF.`);
  const display = [`Horn formula, ${cnf.vars.length} variable${cnf.vars.length === 1 ? "" : "s"}, ${cnf.clauses.length} clause${cnf.clauses.length === 1 ? "" : "s"}: ${showCnf(cnf)}`];
  const r = horn(cnf);
  const steps = [...r.steps];
  const caveats = [`Unit propagation alone decides a Horn formula (polynomial): the forced literals form its minimal model, or a goal clause with every body literal forced is violated. ${capsCaveat()}`];
  const forcedNames = r.forced.map((v) => cnf.vars[v]);
  const brute = countModels(cnf);
  if (r.kind === "unsat") {
    const agree = bruteSatisfiable(cnf);
    if (agree === true) throw new DiscreteError("Horn says UNSAT but brute force finds a model — a defect in this tool; nothing is reported.");
    display.push(`Forced true: ${forcedNames.join(", ") || "(none)"}; clause ${showClause(cnf, cnf.clauses[r.violated!])} violated → UNSATISFIABLE.`);
    if (agree === false) display.push("0 models in all (brute force agrees).");
    else caveats.push("Brute-force cross-check NOT run (above 20 variables); the forced chain is the proof.");
    return { title: "Horn-SAT", display, steps, caveats };
  }
  const model = cnf.vars.map((_, i) => r.forced.includes(i));
  const cl = checklist(cnf, model);
  if (!cl.ok) throw new DiscreteError("The Horn minimal model fails a clause on re-evaluation — a defect in this tool; nothing is reported.");
  display.push(`SATISFIABLE — minimal model: ${forcedNames.length ? `${forcedNames.join(", ")} true` : "nothing forced"}, every other variable false: ${showModel(cnf, model)}`);
  if (brute) display.push(`${brute.count.toLocaleString("en-US")} model${brute.count === 1 ? "" : "s"} in all (brute force); the minimal model is the least of them.`);
  steps.push("Every clause under the minimal model:");
  steps.push(...cl.lines.map((l) => `  ${l}`));
  steps.push(`Verified: all ${cnf.clauses.length} clauses re-evaluated true.`);
  return { title: "Horn-SAT", display, steps, caveats };
}
