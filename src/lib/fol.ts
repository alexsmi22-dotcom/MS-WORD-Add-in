// First-order logic — the quantifier engine of the Solve kind "Discrete math"
// (v2.133.0, SCOPE-COMPUTATION-THEORY §B FOL row, §C.5).
//
// What a student types: ∀x (P(x) → Q(x)) · forall x. P(x) -> exists y. Q(x, y) ·
// prenex … · skolemize … · clausal form … · unify P(x, f(y)) and P(a, f(b)) ·
// mgu of t₁, t₂ · resolve Γ ⊢ φ · resolution: clauses · free variables of … ·
// check φ in domain {1, 2}, R = {(1, 2), (2, 1)} · is φ valid.
//
// House rules honoured here:
//   · the formula parser is ITERATIVE (shunting-yard with explicit stacks) and
//     the depth cap is checked right after the parse, before any recursive
//     walker meets the tree — 2,000 nested parentheses answer, they never
//     overflow the JS stack (the lambda.ts pattern);
//   · every cap is named — FOL_CAPS — and checked BEFORE the work;
//   · three verdicts that must never blur: REFUTED (a proof of validity),
//     SATURATED (a proof of invalidity, since resolution with factoring is
//     refutation-complete), UNKNOWN (a cap, which proves nothing — FOL validity
//     is only semi-decidable);
//   · every resolvent is re-verified by re-unifying its parents' complementary
//     literals with the PRINTED substitution; every unifier is verified by
//     applying it to both terms and checking they coincide;
//   · refusals by name: equality (no paramodulation), arithmetic, second-order
//     quantification, infinite domains;
//   · what is displayed parses back: ∀ ∃ ¬ ∧ ∨ → ↔, subscripted Skolem names
//     f₁(x), primed variables x′, clause braces {¬P(x), Q(x)} and □.

import { DiscreteError } from "./discrete";
import type { DiscreteResult } from "./discrete";
import { treeSvg } from "./treeSvg";

export const FOL_CAPS = {
  /** AST depth after the parse (nested ¬ / quantifiers / connectives). */
  depth: 400,
  /** Tokens in one request. */
  tokens: 20_000,
  /** Clauses kept during resolution (input + derived). */
  clauses: 500,
  /** Unification attempts during one resolution run. */
  unifications: 20_000,
  /** Finite-model domain size for `check`. */
  domain: 6,
  /** Quantifier bindings evaluated in one `check` (6⁶). */
  cells: 46_656,
  /** ↔ connectives expanded for prenex/clausal form (each doubles its operands). */
  iffs: 8,
  /** Clauses produced by one clausal-form conversion. */
  cnfClauses: 500,
  /** Interpretations tried in the countermodel search after SATURATED/UNKNOWN. */
  countermodels: 4_096,
  /** Term nesting kept in a derived clause during resolution. */
  termDepth: 6,
};

/** The guard discrete.ts uses to route to this engine (before propositional logic). */
export const FOL_RE = /[∀∃]|\b(?:forall|exists|prenex|skolemi[sz]e|clausal|clause\s+form|clausify|unify|mgu|most\s+general\s+unifier|resol(?:ve|ution)|model\s+check|free\s+(?:and\s+bound\s+)?variables|in\s+(?:the\s+)?(?:model|domain|structure))\b/i;

// ---------------------------------------------------------------------------
// Syntax

export type Term = { k: "var"; name: string } | { k: "fn"; name: string; args: Term[] };
export type Formula =
  | { k: "pred"; name: string; args: Term[] }
  | { k: "not"; a: Formula }
  | { k: "bin"; op: "and" | "or" | "imp" | "iff"; a: Formula; b: Formula }
  | { k: "q"; q: "forall" | "exists"; v: string; a: Formula };

export interface Lit { neg: boolean; name: string; args: Term[] }
export type Clause = Lit[];
export type Subst = Map<string, Term>;

type TokKind = "id" | "num" | "str" | "forall" | "exists" | "not" | "and" | "or" | "imp" | "iff" | "lp" | "rp" | "lb" | "rb" | "comma" | "dot" | "box" | "turnstile" | "eq";
interface Tok { t: TokKind; s: string; pos: number }

const WORDS: Record<string, TokKind> = {
  forall: "forall", all: "forall", exists: "exists", some: "exists", not: "not", and: "and", or: "or",
  implies: "imp", iff: "iff", therefore: "turnstile", entails: "turnstile",
};

export function tokenizeFol(src: string): Tok[] {
  const toks: Tok[] = [];
  const chars = Array.from(src);
  let i = 0;
  const push = (t: TokKind, s: string, pos: number): void => {
    toks.push({ t, s, pos });
    if (toks.length > FOL_CAPS.tokens) throw new DiscreteError(`More than ${FOL_CAPS.tokens.toLocaleString("en-US")} tokens — above the cap for one request.`);
  };
  while (i < chars.length) {
    const c = chars[i];
    const two = c + (chars[i + 1] ?? "");
    const three = two + (chars[i + 2] ?? "");
    if (/\s/u.test(c)) { i++; continue; }
    if (three === "<->" || three === "<=>") { push("iff", three, i); i += 3; continue; }
    if (two === "->" || two === "=>") { push("imp", two, i); i += 2; continue; }
    if (two === "|=" || two === "|-") { push("turnstile", two, i); i += 2; continue; }
    if (two === "&&") { push("and", two, i); i += 2; continue; }
    if (two === "||") { push("or", two, i); i += 2; continue; }
    if (two === "/\\") { push("and", two, i); i += 2; continue; }
    if (two === "\\/") { push("or", two, i); i += 2; continue; }
    if (two === "!=" || two === "<=" || two === ">=") throw new DiscreteError(`"${two}" is arithmetic — this is first-order logic without arithmetic; the Equation kind solves inequalities.`);
    const one: Record<string, TokKind> = {
      "∀": "forall", "∃": "exists", "¬": "not", "~": "not", "!": "not", "∧": "and", "&": "and", "·": "and", "∙": "and",
      "∨": "or", "|": "or", "→": "imp", "⊃": "imp", "↔": "iff", "≡": "iff", "(": "lp", ")": "rp", "[": "lp", "]": "rp",
      "{": "lb", "}": "rb", ",": "comma", ".": "dot", ":": "dot", "□": "box", "⊢": "turnstile", "⊨": "turnstile", "∴": "turnstile", "=": "eq",
    };
    if (one[c]) { push(one[c], c, i); i++; continue; }
    if (c === "⊤" || c === "⊥") { push("id", c, i); i++; continue; }
    if (c === '"' || c === "'" || c === "“" || c === "‘") {
      const close = c === "“" ? "”" : c === "‘" ? "’" : c;
      let j = i + 1;
      while (j < chars.length && chars[j] !== close) j++;
      if (j >= chars.length) throw new DiscreteError(`The quoted name starting at position ${i + 1} has no closing quote.`);
      const word = chars.slice(i + 1, j).join("").trim();
      if (!word) throw new DiscreteError(`Empty quoted name at position ${i + 1}.`);
      push("str", word, i);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c) || /[Ͱ-Ͽ]/.test(c)) {
      let j = i;
      while (j < chars.length && /[A-Za-z0-9_'′″₀-₉Ͱ-Ͽ]/u.test(chars[j])) j++;
      const word = chars.slice(i, j).join("");
      const lw = word.toLowerCase();
      if (WORDS[lw]) push(WORDS[lw], word, i);
      else push("id", word, i);
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
    if ("<>+-*/^%".includes(c) || c === "−" || c === "×" || c === "≤" || c === "≥" || c === "≠") {
      throw new DiscreteError(`"${c}" is arithmetic — this is first-order logic without arithmetic (no <, >, +, ×, ^); the Equation kind solves inequalities.`);
    }
    throw new DiscreteError(`Unexpected character "${c}" at position ${i + 1}.`);
  }
  return toks;
}

/** Variable convention: u–z (with digits, primes or subscripts) are variables,
 *  everything else at term position is a constant — unless a `var …` line
 *  lists the variables explicitly, in which case ONLY those are. */
export interface VarRule { explicit: Set<string> | null }
export const DEFAULT_VARS: VarRule = { explicit: null };

export function isVariableName(name: string, rule: VarRule): boolean {
  if (rule.explicit) return rule.explicit.has(name);
  return /^[u-z]/.test(name);
}

const PREC: Record<string, number> = { iff: 1, imp: 2, or: 3, and: 4 };
const UNARY_PREC = 5;

interface OpEntry { kind: "lp" | "not" | "q" | "bin"; op?: "and" | "or" | "imp" | "iff"; q?: "forall" | "exists"; v?: string; prec: number; pos: number }

/** Iterative term parser from a token slice starting at `start` (an id/num/str).
 *  Returns the term and the index just past it. Uses an explicit frame stack. */
function parseTermAt(toks: Tok[], start: number, rule: VarRule, bound: Set<string>): { term: Term; next: number } {
  interface Frame { name: string; args: Term[]; pos: number }
  const frames: Frame[] = [];
  let i = start;
  let current: Term | null = null;
  const nameTok = (t: Tok): string => (t.t === "num" ? t.s : t.s);
  for (;;) {
    const t = toks[i];
    if (!t) throw new DiscreteError("The term ends too early.");
    if (t.t === "id" || t.t === "num" || t.t === "str") {
      const nm = nameTok(t);
      if (toks[i + 1] && toks[i + 1].t === "lp" && t.t !== "str") {
        if (/^[0-9]/.test(nm)) throw new DiscreteError(`"${nm}(" — a number cannot be a function symbol.`);
        frames.push({ name: nm, args: [], pos: t.pos });
        i += 2;
        if (toks[i] && toks[i].t === "rp") throw new DiscreteError(`${nm}() has no arguments — write ${nm} for a constant.`);
        continue;
      }
      if (t.t === "str" || t.t === "num") current = { k: "fn", name: nm, args: [] };
      else if (bound.has(nm) || isVariableName(nm, rule)) current = { k: "var", name: nm };
      else current = { k: "fn", name: nm, args: [] };
      i++;
    } else if (t.t === "eq") {
      throw new DiscreteError("Equality (=) is not supported: this engine has no paramodulation. Write a predicate such as Eq(x, y) if you want it treated as an ordinary relation.");
    } else {
      throw new DiscreteError(`Unexpected "${t.s}" at position ${t.pos + 1} — a term was expected.`);
    }
    // Close as many frames as the following tokens allow.
    for (;;) {
      if (!frames.length) return { term: current as Term, next: i };
      const top = frames[frames.length - 1];
      top.args.push(current as Term);
      const sep = toks[i];
      if (!sep) throw new DiscreteError(`Missing ")" for ${top.name}( at position ${top.pos + 1}.`);
      if (sep.t === "comma") { i++; break; }
      if (sep.t === "rp") {
        frames.pop();
        current = { k: "fn", name: top.name, args: top.args };
        i++;
        continue;
      }
      if (sep.t === "eq") throw new DiscreteError("Equality (=) is not supported: this engine has no paramodulation.");
      throw new DiscreteError(`Unexpected "${sep.s}" at position ${sep.pos + 1} inside ${top.name}(…) — expected "," or ")".`);
    }
  }
}

/** Shunting-yard formula parser over a token slice [from, to). Explicit
 *  operand/operator stacks; nothing recurses. */
function parseFormulaToks(toks: Tok[], from: number, to: number, rule: VarRule): Formula {
  const out: Formula[] = [];
  const ops: OpEntry[] = [];
  const bound = new Set<string>();
  let expectOperand = true;
  let i = from;
  const apply = (e: OpEntry): void => {
    if (e.kind === "not") {
      const a = out.pop();
      if (!a) throw new DiscreteError(`"¬" at position ${e.pos + 1} has nothing to negate.`);
      out.push({ k: "not", a });
    } else if (e.kind === "q") {
      const a = out.pop();
      if (!a) throw new DiscreteError(`The quantifier at position ${e.pos + 1} has no formula after it.`);
      out.push({ k: "q", q: e.q!, v: e.v!, a });
    } else if (e.kind === "bin") {
      const b = out.pop();
      const a = out.pop();
      if (!a || !b) throw new DiscreteError(`The connective at position ${e.pos + 1} is missing an operand.`);
      out.push({ k: "bin", op: e.op!, a, b });
    }
  };
  const atomStart = (t: Tok): boolean => t.t === "id" || t.t === "num" || t.t === "str" || t.t === "lb" || t.t === "box";
  while (i < to) {
    const t = toks[i];
    if (t.t === "lp") {
      if (!expectOperand) throw new DiscreteError(`Two things side by side at position ${t.pos + 1} with no connective between them — write ∧ for and, ∨ for or.`);
      ops.push({ kind: "lp", prec: -1, pos: t.pos });
      i++;
      continue;
    }
    if (t.t === "rp") {
      if (expectOperand) throw new DiscreteError(`")" at position ${t.pos + 1} closes an empty or unfinished group.`);
      for (;;) {
        const e = ops.pop();
        if (!e) throw new DiscreteError(`")" at position ${t.pos + 1} has no matching "(".`);
        if (e.kind === "lp") break;
        apply(e);
      }
      i++;
      continue;
    }
    if (t.t === "not") {
      if (!expectOperand) throw new DiscreteError(`"¬" at position ${t.pos + 1} follows an operand — a connective is missing.`);
      ops.push({ kind: "not", prec: UNARY_PREC, pos: t.pos });
      i++;
      continue;
    }
    if (t.t === "forall" || t.t === "exists") {
      if (!expectOperand) throw new DiscreteError(`The quantifier at position ${t.pos + 1} follows an operand — a connective is missing.`);
      // ∀x · ∀x y · ∀x, y · forall x. (dot: scope to the end of the group)
      const vars: string[] = [];
      let j = i + 1;
      const first = toks[j];
      if (!first || first.t !== "id") throw new DiscreteError(`"${t.s}" at position ${t.pos + 1} must be followed by a variable name (∀x …).`);
      if (/^[A-Z]/.test(first.s) && !(rule.explicit && rule.explicit.has(first.s))) throw new DiscreteError(`"${t.s}${first.s}" quantifies over ${first.s}, which looks like a predicate — second-order quantification is not supported (variables are u–z, or those on a "var …" line).`);
      vars.push(first.s);
      j++;
      // Further bound variables: "∀x, y" or "∀x y" (a variable-named id that is
      // not the body's predicate and not the last token).
      while (j < to) {
        if (toks[j].t === "comma" && toks[j + 1] && toks[j + 1].t === "id" && !(toks[j + 2] && toks[j + 2].t === "lp")) { vars.push(toks[j + 1].s); j += 2; continue; }
        if (toks[j].t === "id" && j + 1 < to && !(toks[j + 1].t === "lp") && isVariableName(toks[j].s, rule) && !/^[A-Z]/.test(toks[j].s)) { vars.push(toks[j].s); j++; continue; }
        break;
      }
      let dotted = false;
      if (j < to && toks[j].t === "dot") { dotted = true; j++; }
      for (const v of vars) {
        bound.add(v);
        ops.push({ kind: "q", q: t.t, v, prec: dotted ? 0 : UNARY_PREC, pos: t.pos });
      }
      i = j;
      continue;
    }
    if (atomStart(t)) {
      if (!expectOperand) throw new DiscreteError(`Two things side by side at position ${t.pos + 1} with no connective between them — write ∧ for and, ∨ for or.`);
      if (t.t === "box") { out.push({ k: "pred", name: "⊥", args: [] }); i++; expectOperand = false; continue; }
      if (t.t === "lb") {
        // A printed clause {l₁, l₂, …}: the disjunction of its literals; {} is □.
        const lits: Formula[] = [];
        let j = i + 1;
        for (;;) {
          const u = toks[j];
          if (!u) throw new DiscreteError(`Missing "}" for the "{" at position ${t.pos + 1}.`);
          if (u.t === "rb") { j++; break; }
          if (u.t === "comma") { j++; continue; }
          let neg = false;
          while (toks[j] && toks[j].t === "not") { neg = !neg; j++; }
          const a = toks[j];
          if (!a || !(a.t === "id" || a.t === "str" || a.t === "num")) throw new DiscreteError(`A clause in braces holds literals only (P(x), ¬Q(a)); found "${a ? a.s : "}"}" at position ${a ? a.pos + 1 : t.pos + 1}.`);
          const r = parseTermAt(toks, j, rule, bound);
          const atom = termToAtom(r.term);
          lits.push(neg ? { k: "not", a: atom } : atom);
          j = r.next;
        }
        let f: Formula = lits.length ? lits[0] : { k: "pred", name: "⊥", args: [] };
        for (let q = 1; q < lits.length; q++) f = { k: "bin", op: "or", a: f, b: lits[q] };
        out.push(f);
        i = j;
        expectOperand = false;
        continue;
      }
      const r = parseTermAt(toks, i, rule, bound);
      out.push(termToAtom(r.term));
      i = r.next;
      expectOperand = false;
      continue;
    }
    if (t.t === "and" || t.t === "or" || t.t === "imp" || t.t === "iff") {
      if (expectOperand) throw new DiscreteError(`"${t.s}" at position ${t.pos + 1} has nothing on its left.`);
      const prec = PREC[t.t];
      const rightAssoc = t.t === "imp";
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.kind === "lp") break;
        if (top.prec > prec || (top.prec === prec && !rightAssoc)) { ops.pop(); apply(top); } else break;
      }
      ops.push({ kind: "bin", op: t.t, prec, pos: t.pos });
      i++;
      expectOperand = true;
      continue;
    }
    if (t.t === "eq") throw new DiscreteError("Equality (=) is not supported: this engine has no paramodulation. Write a predicate such as Eq(x, y) if you want it treated as an ordinary relation.");
    if (t.t === "turnstile") throw new DiscreteError(`Only one ⊢ per argument (found another at position ${t.pos + 1}).`);
    if (t.t === "dot") throw new DiscreteError(`Unexpected "." at position ${t.pos + 1} — a dot is read only after a quantifier (forall x. …).`);
    throw new DiscreteError(`Unexpected "${t.s}" at position ${t.pos + 1}.`);
  }
  if (expectOperand) throw new DiscreteError(out.length || ops.length ? "The formula ends too early." : "No formula found.");
  while (ops.length) {
    const e = ops.pop()!;
    if (e.kind === "lp") throw new DiscreteError(`Missing ")" for the "(" at position ${e.pos + 1}.`);
    apply(e);
  }
  if (out.length !== 1) throw new DiscreteError("Could not read that formula.");
  return out[0];
}

function termToAtom(t: Term): Formula {
  if (t.k === "var") return { k: "pred", name: t.name, args: [] };
  return { k: "pred", name: t.name, args: t.args };
}

/** Depth and node count, computed with an explicit stack (the parse is
 *  iterative; this is the first walker, so it must be too). */
export function formulaDepth(f: Formula): { depth: number; nodes: number } {
  let depth = 0;
  let nodes = 0;
  const stack: { f: Formula; d: number }[] = [{ f, d: 1 }];
  while (stack.length) {
    const { f: u, d } = stack.pop()!;
    nodes++;
    if (d > depth) depth = d;
    if (u.k === "not" || u.k === "q") stack.push({ f: u.a, d: d + 1 });
    else if (u.k === "bin") { stack.push({ f: u.a, d: d + 1 }); stack.push({ f: u.b, d: d + 1 }); }
    else for (const a of u.args) { const td = d + termDepth(a); if (td > depth) depth = td; }
  }
  return { depth, nodes };
}

/** Parse a formula; the depth cap is checked here, before any recursive walker. */
export function parseFol(src: string, rule: VarRule = DEFAULT_VARS): Formula {
  const toks = tokenizeFol(src);
  if (!toks.length) throw new DiscreteError("No formula found.");
  const f = parseFormulaToks(toks, 0, toks.length, rule);
  const { depth } = formulaDepth(f);
  if (depth > FOL_CAPS.depth) throw new DiscreteError(`The formula as written nests ${depth} deep, above the ${FOL_CAPS.depth}-deep cap.`);
  return fixScopes(f, rule);
}

/** The parser reads a name bound by ANY quantifier as a variable everywhere
 *  after it; scope is known only once the tree exists. This walker (safe:
 *  the depth cap has been checked) turns an out-of-scope occurrence of a
 *  non-u–z name back into the constant it is: ∃a P(a) ∧ ¬P(a) has a
 *  constant a on the right. */
function fixScopes(f: Formula, rule: VarRule): Formula {
  const term = (t: Term, bound: Set<string>): Term => {
    if (t.k === "var") return bound.has(t.name) || isVariableName(t.name, rule) ? t : { k: "fn", name: t.name, args: [] };
    return { k: "fn", name: t.name, args: t.args.map((a) => term(a, bound)) };
  };
  const walk = (u: Formula, bound: Set<string>): Formula => {
    switch (u.k) {
      case "pred": return { k: "pred", name: u.name, args: u.args.map((a) => term(a, bound)) };
      case "not": return { k: "not", a: walk(u.a, bound) };
      case "bin": return { k: "bin", op: u.op, a: walk(u.a, bound), b: walk(u.b, bound) };
      case "q": { const b = new Set(bound); b.add(u.v); return { k: "q", q: u.q, v: u.v, a: walk(u.a, b) }; }
    }
  };
  return walk(f, new Set());
}

/** ∀x₁ … ∀xₙ φ over φ's free variables (in order of appearance). */
export function universalClosure(f: Formula): Formula {
  const fv = freeVars(f);
  let out = f;
  for (let i = fv.length - 1; i >= 0; i--) out = { k: "q", q: "forall", v: fv[i], a: out };
  return out;
}

/** Parse a bare term (for unify / mgu). */
export function parseTerm(src: string, rule: VarRule = DEFAULT_VARS): Term {
  const toks = tokenizeFol(src);
  if (!toks.length) throw new DiscreteError("No term found.");
  const r = parseTermAt(toks, 0, rule, new Set());
  if (r.next !== toks.length) throw new DiscreteError(`Unexpected "${toks[r.next].s}" at position ${toks[r.next].pos + 1} after the term.`);
  const d = termDepth(r.term);
  if (d > FOL_CAPS.depth) throw new DiscreteError(`The term as written nests ${d} deep, above the ${FOL_CAPS.depth}-deep cap.`);
  return r.term;
}

export function termDepth(t: Term): number {
  let depth = 0;
  const stack: { t: Term; d: number }[] = [{ t, d: 1 }];
  while (stack.length) {
    const { t: u, d } = stack.pop()!;
    if (d > depth) depth = d;
    if (u.k === "fn") for (const a of u.args) stack.push({ t: a, d: d + 1 });
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Printing (re-parses)

export function showTerm(t: Term): string {
  if (t.k === "var") return t.name;
  const nm = /^[A-Za-z_Ͱ-Ͽ][A-Za-z0-9_'′″₀-₉Ͱ-Ͽ]*$/u.test(t.name) || /^[0-9]+$/.test(t.name) ? t.name : `"${t.name}"`;
  return t.args.length ? `${nm}(${t.args.map(showTerm).join(", ")})` : nm;
}

const OPSYM: Record<string, string> = { and: "∧", or: "∨", imp: "→", iff: "↔" };

export function showFormula(f: Formula): string {
  const go = (u: Formula, parent: number, side: "l" | "r" | "n", parentOp: string): string => {
    switch (u.k) {
      case "pred": return (u.name === "⊥" || u.name === "⊤") && !u.args.length ? u.name : showTerm({ k: "fn", name: u.name, args: u.args });
      case "not": return `¬${u.k === "not" && u.a.k === "bin" ? `(${go(u.a, -1, "n", "")})` : go(u.a, 99, "n", "")}`;
      case "q": {
        const sym = u.q === "forall" ? "∀" : "∃";
        const body = u.a.k === "bin" ? `(${go(u.a, -1, "n", "")})` : go(u.a, 99, "n", "");
        return `${sym}${u.v} ${body}`;
      }
      case "bin": {
        const pr = PREC[u.op];
        const s = `${go(u.a, pr, "l", u.op)} ${OPSYM[u.op]} ${go(u.b, pr, "r", u.op)}`;
        if (parent < 0) return s;
        const needs = pr < parent || (pr === parent && (u.op !== parentOp || (u.op === "imp" && side === "l") || (u.op === "iff" && side === "r")));
        return needs ? `(${s})` : s;
      }
    }
  };
  return go(f, -1, "n", "");
}

export function showLit(l: Lit): string {
  return `${l.neg ? "¬" : ""}${showTerm({ k: "fn", name: l.name, args: l.args })}`;
}
export function showClause(c: Clause): string {
  return c.length ? `{${c.map(showLit).join(", ")}}` : "□";
}
export function showSubst(s: Subst): string {
  return `{${[...s.entries()].map(([v, t]) => `${v} ↦ ${showTerm(t)}`).join(", ")}}`;
}

// ---------------------------------------------------------------------------
// Variables, substitution, unification

export function varsOfTerm(t: Term, out = new Set<string>()): Set<string> {
  const stack = [t];
  while (stack.length) {
    const u = stack.pop()!;
    if (u.k === "var") out.add(u.name);
    else for (const a of u.args) stack.push(a);
  }
  return out;
}

export function freeVars(f: Formula): string[] {
  const free: string[] = [];
  const walk = (u: Formula, bound: Set<string>): void => {
    switch (u.k) {
      case "pred": for (const a of u.args) for (const v of varsOfTerm(a)) if (!bound.has(v) && !free.includes(v)) free.push(v); return;
      case "not": walk(u.a, bound); return;
      case "bin": walk(u.a, bound); walk(u.b, bound); return;
      case "q": { const b = new Set(bound); b.add(u.v); walk(u.a, b); return; }
    }
  };
  walk(f, new Set());
  return free;
}

export function boundVars(f: Formula): string[] {
  const out: string[] = [];
  const walk = (u: Formula): void => {
    if (u.k === "q") { if (!out.includes(u.v)) out.push(u.v); walk(u.a); }
    else if (u.k === "not") walk(u.a);
    else if (u.k === "bin") { walk(u.a); walk(u.b); }
  };
  walk(f);
  return out;
}

function allVarNames(f: Formula): Set<string> {
  const s = new Set<string>();
  const walk = (u: Formula): void => {
    switch (u.k) {
      case "pred": for (const a of u.args) varsOfTerm(a, s); return;
      case "not": walk(u.a); return;
      case "bin": walk(u.a); walk(u.b); return;
      case "q": s.add(u.v); walk(u.a); return;
    }
  };
  walk(f);
  return s;
}

function symbolsOf(f: Formula): { preds: Map<string, number>; fns: Map<string, number> } {
  const preds = new Map<string, number>();
  const fns = new Map<string, number>();
  const term = (t: Term): void => {
    const stack = [t];
    while (stack.length) {
      const u = stack.pop()!;
      if (u.k === "fn") { fns.set(u.name, u.args.length); for (const a of u.args) stack.push(a); }
    }
  };
  const walk = (u: Formula): void => {
    switch (u.k) {
      case "pred": preds.set(u.name, u.args.length); for (const a of u.args) term(a); return;
      case "not": walk(u.a); return;
      case "bin": walk(u.a); walk(u.b); return;
      case "q": walk(u.a); return;
    }
  };
  walk(f);
  return { preds, fns };
}

export function applyTerm(t: Term, s: Subst): Term {
  if (t.k === "var") { const b = s.get(t.name); return b ? b : t; }
  return { k: "fn", name: t.name, args: t.args.map((a) => applyTerm(a, s)) };
}
export function applyLit(l: Lit, s: Subst): Lit { return { neg: l.neg, name: l.name, args: l.args.map((a) => applyTerm(a, s)) }; }
export function applyClause(c: Clause, s: Subst): Clause { return c.map((l) => applyLit(l, s)); }

/** Substitute free occurrences only (used by Skolemisation and rectification on formulas). */
function substFormula(f: Formula, s: Subst): Formula {
  switch (f.k) {
    case "pred": return { k: "pred", name: f.name, args: f.args.map((a) => applyTerm(a, s)) };
    case "not": return { k: "not", a: substFormula(f.a, s) };
    case "bin": return { k: "bin", op: f.op, a: substFormula(f.a, s), b: substFormula(f.b, s) };
    case "q": {
      if (!s.has(f.v)) return { k: "q", q: f.q, v: f.v, a: substFormula(f.a, s) };
      const s2 = new Map(s);
      s2.delete(f.v);
      return { k: "q", q: f.q, v: f.v, a: substFormula(f.a, s2) };
    }
  }
}

function occurs(v: string, t: Term): boolean { return varsOfTerm(t).has(v); }

export type UnifyFailure =
  | { kind: "occurs"; v: string; t: Term }
  | { kind: "clash"; a: string; b: string }
  | { kind: "arity"; name: string; n1: number; n2: number };

export type UnifyResult = { ok: true; subst: Subst } | { ok: false; why: UnifyFailure };

/** Robinson unification with the occurs check, over a worklist (no recursion
 *  beyond the term depth, which is capped). The substitution is kept
 *  idempotent: each new binding is applied to the existing ones. */
export function unifyTerms(pairs: [Term, Term][]): UnifyResult {
  const subst: Subst = new Map();
  // Reversed so that pop() takes the first pair first (left-to-right order,
  // which the printed failure messages rely on).
  const work: [Term, Term][] = pairs.map(([a, b]) => [a, b] as [Term, Term]).reverse();
  const bind = (v: string, t: Term): UnifyFailure | null => {
    if (t.k === "var" && t.name === v) return null;
    if (occurs(v, t)) return { kind: "occurs", v, t };
    const one: Subst = new Map([[v, t]]);
    for (const [k, u] of subst) subst.set(k, applyTerm(u, one));
    subst.set(v, t);
    return null;
  };
  while (work.length) {
    const [a0, b0] = work.pop()!;
    const a = applyTerm(a0, subst);
    const b = applyTerm(b0, subst);
    if (a.k === "var") { const w = bind(a.name, b); if (w) return { ok: false, why: w }; continue; }
    if (b.k === "var") { const w = bind(b.name, a); if (w) return { ok: false, why: w }; continue; }
    if (a.name !== b.name) return { ok: false, why: { kind: "clash", a: a.name, b: b.name } };
    if (a.args.length !== b.args.length) return { ok: false, why: { kind: "arity", name: a.name, n1: a.args.length, n2: b.args.length } };
    for (let i = a.args.length - 1; i >= 0; i--) work.push([a.args[i], b.args[i]]);
  }
  return { ok: true, subst };
}

export function unifyLits(a: Lit, b: Lit): UnifyResult {
  if (a.name !== b.name) return { ok: false, why: { kind: "clash", a: a.name, b: b.name } };
  if (a.args.length !== b.args.length) return { ok: false, why: { kind: "arity", name: a.name, n1: a.args.length, n2: b.args.length } };
  return unifyTerms(a.args.map((t, i) => [t, b.args[i]] as [Term, Term]));
}

export function describeFailure(w: UnifyFailure): string {
  if (w.kind === "occurs") return `occurs check — ${w.v} would have to contain ${showTerm(w.t)}`;
  if (w.kind === "clash") return `clash: ${w.a} ≠ ${w.b}`;
  return `arity: ${w.name} takes ${w.n1} argument${w.n1 === 1 ? "" : "s"} on one side and ${w.n2} on the other (${w.n1} ≠ ${w.n2})`;
}

// ---------------------------------------------------------------------------
// Normal forms

interface Trace { steps: string[] }

function fresh(base: string, used: Set<string>): string {
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  const stem = base.replace(/[₀-₉′″']+$/u, "") || base;
  for (let n = 1; n < 10_000; n++) {
    const cand = stem + String(n).split("").map((d) => SUB[Number(d)]).join("");
    if (!used.has(cand)) { used.add(cand); return cand; }
  }
  throw new DiscreteError("Ran out of fresh variable names.");
}

/** Rectification: every quantifier binds a distinct variable, none of which
 *  is free anywhere. Renames are reported. */
export function rectify(f: Formula, tr?: Trace): Formula {
  const used = allVarNames(f);
  const seenBound = new Set<string>(freeVars(f));
  const walk = (u: Formula, ren: Subst): Formula => {
    switch (u.k) {
      case "pred": return { k: "pred", name: u.name, args: u.args.map((a) => applyTerm(a, ren)) };
      case "not": return { k: "not", a: walk(u.a, ren) };
      case "bin": return { k: "bin", op: u.op, a: walk(u.a, ren), b: walk(u.b, ren) };
      case "q": {
        let v = u.v;
        const ren2 = new Map(ren);
        if (seenBound.has(v)) {
          const nv = fresh(v, used);
          tr?.steps.push(`Rename the bound variable ${v} to ${nv} (${v} is already used elsewhere).`);
          ren2.set(v, { k: "var", name: nv });
          v = nv;
        } else ren2.delete(v);
        seenBound.add(v);
        return { k: "q", q: u.q, v, a: walk(u.a, ren2) };
      }
    }
  };
  return walk(f, new Map());
}

function hasQuantifier(f: Formula): boolean {
  const stack = [f];
  while (stack.length) {
    const u = stack.pop()!;
    if (u.k === "q") return true;
    if (u.k === "not") stack.push(u.a);
    else if (u.k === "bin") { stack.push(u.a); stack.push(u.b); }
  }
  return false;
}

/** A ↔ B whose operands carry quantifiers becomes (A → B) ∧ (B → A), so that
 *  prenex rules apply; quantifier-free ↔ stays (it is handled in the CNF step). */
function expandIff(f: Formula, tr?: Trace): Formula {
  let count = 0;
  const walk = (u: Formula): Formula => {
    switch (u.k) {
      case "pred": return u;
      case "not": return { k: "not", a: walk(u.a) };
      case "q": return { k: "q", q: u.q, v: u.v, a: walk(u.a) };
      case "bin": {
        const a = walk(u.a);
        const b = walk(u.b);
        if (u.op === "iff" && (hasQuantifier(a) || hasQuantifier(b))) {
          count++;
          if (count > FOL_CAPS.iffs) throw new DiscreteError(`More than ${FOL_CAPS.iffs} quantified ↔ connectives — each doubles its operands, above the cap.`);
          tr?.steps.push(`${showFormula(u)} ⇒ (${showFormula(a)} → ${showFormula(b)}) ∧ (${showFormula(b)} → ${showFormula(a)})  (↔ expanded so its quantifiers can be pulled out)`);
          return { k: "bin", op: "and", a: { k: "bin", op: "imp", a, b }, b: { k: "bin", op: "imp", a: b, b: a } };
        }
        return { k: "bin", op: u.op, a, b };
      }
    }
  };
  return walk(f);
}

export interface Prenex { prefix: { q: "forall" | "exists"; v: string }[]; matrix: Formula }

/** Prenex form of a rectified, ↔-expanded formula. The matrix keeps → (the
 *  flip of ∀ to ∃ in an antecedent is shown as a step). */
export function prenex(f: Formula, tr?: Trace): Prenex {
  const flip = (p: Prenex["prefix"]): Prenex["prefix"] => p.map((e) => ({ q: e.q === "forall" ? "exists" : "forall", v: e.v }));
  const qstr = (p: Prenex["prefix"]): string => p.map((e) => `${e.q === "forall" ? "∀" : "∃"}${e.v}`).join(" ");
  const walk = (u: Formula): Prenex => {
    switch (u.k) {
      case "pred": return { prefix: [], matrix: u };
      case "q": { const r = walk(u.a); return { prefix: [{ q: u.q, v: u.v }, ...r.prefix], matrix: r.matrix }; }
      case "not": {
        const r = walk(u.a);
        if (r.prefix.length) tr?.steps.push(`¬${qstr(r.prefix)} … ⇒ ${qstr(flip(r.prefix))} ¬… (negation flips each quantifier)`);
        return { prefix: flip(r.prefix), matrix: { k: "not", a: r.matrix } };
      }
      case "bin": {
        const l = walk(u.a);
        const r = walk(u.b);
        if (u.op === "imp") {
          if (l.prefix.length) tr?.steps.push(`(${qstr(l.prefix)} …) → … ⇒ ${qstr(flip(l.prefix))} (… → …)  (a quantifier in an antecedent flips: ∀ becomes ∃, ∃ becomes ∀)`);
          if (r.prefix.length) tr?.steps.push(`… → ${qstr(r.prefix)} … ⇒ ${qstr(r.prefix)} (… → …)  (a quantifier in a consequent moves out unchanged)`);
          return { prefix: [...flip(l.prefix), ...r.prefix], matrix: { k: "bin", op: "imp", a: l.matrix, b: r.matrix } };
        }
        if (u.op === "iff") {
          // expandIff leaves only quantifier-free ↔ (the CNF step handles it);
          // should one ever carry a prefix, expand it here rather than refuse.
          if (!l.prefix.length && !r.prefix.length) return { prefix: [], matrix: { k: "bin", op: "iff", a: l.matrix, b: r.matrix } };
          const a = prenexToFormula(l), b = prenexToFormula(r);
          return walk({ k: "bin", op: "and", a: { k: "bin", op: "imp", a, b }, b: { k: "bin", op: "imp", a: b, b: a } });
        }
        if (l.prefix.length || r.prefix.length) tr?.steps.push(`(${l.prefix.length ? qstr(l.prefix) + " " : ""}…) ${OPSYM[u.op]} (${r.prefix.length ? qstr(r.prefix) + " " : ""}…) ⇒ ${qstr([...l.prefix, ...r.prefix])} (… ${OPSYM[u.op]} …)  (quantifiers move out of ${OPSYM[u.op]} unchanged; left first)`);
        return { prefix: [...l.prefix, ...r.prefix], matrix: { k: "bin", op: u.op, a: l.matrix, b: r.matrix } };
      }
    }
  };
  return walk(f);
}

export function prenexToFormula(p: Prenex): Formula {
  let f = p.matrix;
  for (let i = p.prefix.length - 1; i >= 0; i--) f = { k: "q", q: p.prefix[i].q, v: p.prefix[i].v, a: f };
  return f;
}

/** Full prenex pipeline: ↔ expansion, rectification, pulling. Free variables
 *  are left free (clausal form reads them as universal). */
export function toPrenex(f: Formula, tr?: Trace): Prenex {
  const e = expandIff(f, tr);
  const r = rectify(e, tr);
  return prenex(r, tr);
}

export interface SkolemNaming { letter: string; counter: { n: number }; constCounter: { n: number }; used: Set<string> }

export function skolemNaming(letter: string, used: Set<string>): SkolemNaming {
  return { letter, counter: { n: 0 }, constCounter: { n: 0 }, used };
}

const SUBSCRIPT = (n: number): string => String(n).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");

/** Skolemise a prenex form: each ∃y becomes fᵢ(x₁…xₖ) of the ∀-variables
 *  governing it (or a constant cᵢ when none). Steps are reported. */
export function skolemize(p: Prenex, naming: SkolemNaming, tr?: Trace): { prefix: string[]; matrix: Formula; functions: string[] } {
  const universals: string[] = [];
  let matrix = p.matrix;
  const functions: string[] = [];
  for (const e of p.prefix) {
    if (e.q === "forall") { universals.push(e.v); continue; }
    let name: string;
    if (universals.length) {
      do { naming.counter.n++; name = naming.letter + SUBSCRIPT(naming.counter.n); } while (naming.used.has(name));
    } else {
      do { naming.constCounter.n++; name = "c" + SUBSCRIPT(naming.constCounter.n); } while (naming.used.has(name));
    }
    naming.used.add(name);
    const term: Term = { k: "fn", name, args: universals.map((v) => ({ k: "var", name: v })) };
    functions.push(showTerm(term));
    tr?.steps.push(universals.length
      ? `∃${e.v} is governed by ∀${universals.join(" ∀")}: ${e.v} ↦ ${showTerm(term)} (Skolem function of ${universals.join(", ")})`
      : `∃${e.v} is governed by no ∀: ${e.v} ↦ ${name} (Skolem constant)`);
    matrix = substFormula(matrix, new Map([[e.v, term]]));
  }
  return { prefix: universals, matrix, functions };
}

/** Negation normal form of a quantifier-free matrix. */
function nnf(f: Formula, neg: boolean): Formula {
  switch (f.k) {
    case "pred": return neg ? { k: "not", a: f } : f;
    case "not": return nnf(f.a, !neg);
    case "q": throw new DiscreteError("A quantifier survived into the clause matrix — a defect in this tool; nothing is reported.");
    case "bin": {
      if (f.op === "and") return { k: "bin", op: neg ? "or" : "and", a: nnf(f.a, neg), b: nnf(f.b, neg) };
      if (f.op === "or") return { k: "bin", op: neg ? "and" : "or", a: nnf(f.a, neg), b: nnf(f.b, neg) };
      if (f.op === "imp") return { k: "bin", op: neg ? "and" : "or", a: nnf(f.a, !neg), b: nnf(f.b, neg) };
      // iff: (A ∧ B) ∨ (¬A ∧ ¬B); negated: (A ∧ ¬B) ∨ (¬A ∧ B)
      const a = f.a, b = f.b;
      if (!neg) return { k: "bin", op: "or", a: { k: "bin", op: "and", a: nnf(a, false), b: nnf(b, false) }, b: { k: "bin", op: "and", a: nnf(a, true), b: nnf(b, true) } };
      return { k: "bin", op: "or", a: { k: "bin", op: "and", a: nnf(a, false), b: nnf(b, true) }, b: { k: "bin", op: "and", a: nnf(a, true), b: nnf(b, false) } };
    }
  }
}

function litKey(l: Lit): string { return showLit(l); }

/** CNF of an NNF matrix by distribution, with the clause cap. */
function cnfClauses(f: Formula): Clause[] {
  const go = (u: Formula): Clause[] => {
    if (u.k === "pred") return u.name === "⊤" ? [] : u.name === "⊥" ? [[]] : [[{ neg: false, name: u.name, args: u.args }]];
    if (u.k === "not") {
      const a = u.a as Extract<Formula, { k: "pred" }>;
      return a.name === "⊤" ? [[]] : a.name === "⊥" ? [] : [[{ neg: true, name: a.name, args: a.args }]];
    }
    if (u.k === "q") throw new DiscreteError("A quantifier survived into the clause matrix — a defect in this tool; nothing is reported.");
    const l = go(u.a);
    const r = go(u.b);
    if (u.op === "and") return [...l, ...r];
    const out: Clause[] = [];
    for (const c1 of l) for (const c2 of r) {
      out.push([...c1, ...c2]);
      if (out.length > FOL_CAPS.cnfClauses) throw new DiscreteError(`Clausal form would exceed ${FOL_CAPS.cnfClauses} clauses (distributing ∨ over ∧ is exponential) — above the cap.`);
    }
    return out;
  };
  const raw = go(f);
  // Dedupe literals, drop tautologies and duplicate clauses.
  const seen = new Set<string>();
  const out: Clause[] = [];
  for (const c of raw) {
    const m = new Map<string, Lit>();
    for (const l of c) m.set(litKey(l), l);
    const lits = [...m.values()];
    const taut = lits.some((l) => m.has(litKey({ ...l, neg: !l.neg })));
    if (taut) continue;
    const key = lits.map(litKey).sort().join(" | ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lits);
  }
  return out;
}

export interface Clausal { clauses: Clause[]; prenex: Prenex; skolem: { prefix: string[]; matrix: Formula; functions: string[] }; steps: string[] }

/** Clausal form of a formula (free variables read as universal). */
export function clausalForm(f: Formula, naming: SkolemNaming, tr?: Trace): Clausal {
  const steps: string[] = [];
  const local: Trace = { steps };
  const p = toPrenex(f, local);
  const sk = skolemize(p, naming, local);
  const matrixNnf = nnf(sk.matrix, false);
  const clauses = cnfClauses(matrixNnf);
  if (tr) tr.steps.push(...steps);
  return { clauses, prenex: p, skolem: sk, steps };
}

// ---------------------------------------------------------------------------
// Resolution with factoring

export interface Derived {
  id: number;
  clause: Clause;
  /** Input clauses carry a label (premise / negated goal); derived ones their parents. */
  label?: string;
  from?: { kind: "resolve" | "factor"; parents: number[]; subst: Subst; litA: Lit; litB: Lit; parentA: Clause; parentB: Clause; renamed: string[] };
}

export type ResolutionVerdict =
  | { kind: "refuted"; empty: Derived; all: Derived[]; resolvents: number; unifications: number }
  | { kind: "saturated"; all: Derived[]; failures: string[]; unifications: number }
  | { kind: "unknown"; all: Derived[]; reason: string; unifications: number };

function renameApart(c: Clause, avoid: Set<string>): { clause: Clause; renamed: string[] } {
  const vars = new Set<string>();
  for (const l of c) for (const a of l.args) varsOfTerm(a, vars);
  const s: Subst = new Map();
  const renamed: string[] = [];
  for (const v of vars) {
    if (!avoid.has(v)) continue;
    let nv = v + "′";
    while (avoid.has(nv) || vars.has(nv)) nv += "′";
    s.set(v, { k: "var", name: nv });
    renamed.push(`${v} → ${nv}`);
  }
  return { clause: s.size ? applyClause(c, s) : c, renamed };
}

function clauseVars(c: Clause): Set<string> {
  const s = new Set<string>();
  for (const l of c) for (const a of l.args) varsOfTerm(a, s);
  return s;
}

/** Canonical key up to variable renaming (variants are duplicates). */
function variantKey(c: Clause): string {
  const names = new Map<string, string>();
  const ren = (t: Term): Term => {
    if (t.k === "var") {
      let nm = names.get(t.name);
      if (!nm) { nm = `_${names.size}`; names.set(t.name, nm); }
      return { k: "var", name: nm };
    }
    return { k: "fn", name: t.name, args: t.args.map(ren) };
  };
  const sorted = [...c].sort((a, b) => litKey(a).localeCompare(litKey(b)));
  return sorted.map((l) => showLit({ neg: l.neg, name: l.name, args: l.args.map(ren) })).join(" | ");
}

function isTautology(c: Clause): boolean {
  const keys = new Set(c.map(litKey));
  return c.some((l) => keys.has(litKey({ ...l, neg: !l.neg })));
}

function dedupeLits(c: Clause): Clause {
  const m = new Map<string, Lit>();
  for (const l of c) m.set(litKey(l), l);
  return [...m.values()];
}

/** Saturate by resolution + factoring (given-clause loop, breadth-first), with
 *  the clause and unification caps checked before every step. */
export function resolution(inputs: { clause: Clause; label?: string }[]): ResolutionVerdict {
  const all: Derived[] = [];
  const keys = new Set<string>();
  let unifications = 0;
  const failures: string[] = [];
  let depthCut = 0;
  const add = (clause: Clause, label?: string, from?: Derived["from"]): Derived | null => {
    const lits = dedupeLits(clause);
    if (isTautology(lits)) return null;
    // Derived clauses with terms nested deeper than the bound are not kept
    // (P(f(f(f(…(a))))) forever). A cut makes "saturated" incomplete, so the
    // verdict becomes UNKNOWN by name — never INVALID — unless a finite
    // countermodel settles it.
    if (from && lits.some((l) => l.args.some((t) => termDepth(t) > FOL_CAPS.termDepth))) { depthCut++; return null; }
    const key = variantKey(lits);
    if (keys.has(key)) return null;
    keys.add(key);
    const d: Derived = { id: all.length + 1, clause: lits, label, from };
    all.push(d);
    return d;
  };
  for (const inp of inputs) {
    const d = add(inp.clause, inp.label);
    if (d && !d.clause.length) return { kind: "refuted", empty: d, all, resolvents: 0, unifications };
  }
  const queue: Derived[] = [...all];
  const processed: Derived[] = [];
  const tryUnify = (a: Lit, b: Lit): UnifyResult => { unifications++; return unifyLits(a, b); };
  while (queue.length) {
    if (all.length > FOL_CAPS.clauses) return { kind: "unknown", all, reason: `clause cap: ${FOL_CAPS.clauses} clauses kept without a refutation`, unifications };
    if (unifications > FOL_CAPS.unifications) return { kind: "unknown", all, reason: `unification cap: ${FOL_CAPS.unifications.toLocaleString("en-US")} unifications without a refutation`, unifications };
    const given = queue.shift()!;
    // Factors of the given clause.
    for (let i = 0; i < given.clause.length; i++) for (let j = i + 1; j < given.clause.length; j++) {
      const a = given.clause[i], b = given.clause[j];
      if (a.neg !== b.neg || a.name !== b.name) continue;
      const u = tryUnify(a, b);
      if (!u.ok) continue;
      const factor = applyClause(given.clause, u.subst);
      const d = add(factor, undefined, { kind: "factor", parents: [given.id], subst: u.subst, litA: a, litB: b, parentA: given.clause, parentB: given.clause, renamed: [] });
      if (d) { queue.push(d); if (!d.clause.length) return { kind: "refuted", empty: d, all, resolvents: all.length - inputs.length, unifications }; }
    }
    // Resolvents with every processed clause (and with itself, after renaming).
    for (const other of [...processed, given]) {
      const avoid = clauseVars(given.clause);
      const ren = renameApart(other.clause, avoid);
      for (let i = 0; i < given.clause.length; i++) for (let j = 0; j < ren.clause.length; j++) {
        const a = given.clause[i], b = ren.clause[j];
        if (a.neg === b.neg || a.name !== b.name) continue;
        if (unifications >= FOL_CAPS.unifications) return { kind: "unknown", all, reason: `unification cap: ${FOL_CAPS.unifications.toLocaleString("en-US")} unifications without a refutation`, unifications };
        const u = tryUnify(a, b);
        if (!u.ok) { if (failures.length < 20) failures.push(`${showLit(a)} with ${showLit(b)}: ${describeFailure(u.why)}`); continue; }
        const rest = [...given.clause.filter((_, k) => k !== i), ...ren.clause.filter((_, k) => k !== j)];
        const resolvent = applyClause(rest, u.subst);
        const lo = Math.min(given.id, other.id), hi = Math.max(given.id, other.id);
        const d = add(resolvent, undefined, { kind: "resolve", parents: [lo, hi], subst: u.subst, litA: a, litB: b, parentA: given.clause, parentB: ren.clause, renamed: ren.renamed });
        if (d) {
          if (!d.clause.length) return { kind: "refuted", empty: d, all, resolvents: all.length - inputs.length, unifications };
          queue.push(d);
          if (all.length > FOL_CAPS.clauses) return { kind: "unknown", all, reason: `clause cap: ${FOL_CAPS.clauses} clauses kept without a refutation`, unifications };
        }
      }
    }
    processed.push(given);
  }
  if (depthCut) return { kind: "unknown", all, reason: `term-depth bound: ${depthCut} resolvent${depthCut === 1 ? "" : "s"} with terms nested deeper than ${FOL_CAPS.termDepth} were not kept, so saturation is not a proof`, unifications };
  return { kind: "saturated", all, failures, unifications };
}

/** Independent re-check of one derivation step from the PRINTED substitution:
 *  apply it to both parents, the two chosen literals must coincide (as atoms)
 *  and the remaining literals must equal the recorded clause. */
export function verifyStep(d: Derived): { ok: boolean; why?: string } {
  const f = d.from;
  if (!f) return { ok: true };
  const A = applyClause(f.parentA, f.subst);
  const B = applyClause(f.parentB, f.subst);
  const la = applyLit(f.litA, f.subst), lb = applyLit(f.litB, f.subst);
  const atomA = showTerm({ k: "fn", name: la.name, args: la.args });
  const atomB = showTerm({ k: "fn", name: lb.name, args: lb.args });
  if (atomA !== atomB) return { ok: false, why: `after the substitution the chosen literals differ: ${atomA} vs ${atomB}` };
  if (f.kind === "resolve" && la.neg === lb.neg) return { ok: false, why: "the chosen literals are not complementary" };
  let expect: Clause;
  if (f.kind === "resolve") {
    const ka = litKey(la), kb = litKey(lb);
    let removedA = false, removedB = false;
    expect = [];
    for (const l of A) { if (!removedA && litKey(l) === ka) { removedA = true; continue; } expect.push(l); }
    for (const l of B) { if (!removedB && litKey(l) === kb) { removedB = true; continue; } expect.push(l); }
  } else expect = A;
  const got = new Set(d.clause.map(litKey));
  const want = new Set(dedupeLits(expect).map(litKey));
  if (got.size !== want.size || [...want].some((k) => !got.has(k))) return { ok: false, why: `recomputed ${showClause(dedupeLits(expect))} ≠ recorded ${showClause(d.clause)}` };
  return { ok: true };
}

/** The ancestors of a clause, in derivation order, renumbered 1… with the
 *  input clauses first (they keep their numbers). */
export function derivationOf(all: Derived[], target: Derived, inputCount: number): { lines: Derived[]; number: Map<number, number> } {
  const need = new Set<number>();
  const stack = [target.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (need.has(id)) continue;
    need.add(id);
    const d = all[id - 1];
    if (d.from) for (const p of d.from.parents) stack.push(p);
  }
  const number = new Map<number, number>();
  const lines: Derived[] = [];
  for (let i = 0; i < inputCount; i++) { number.set(all[i].id, i + 1); lines.push(all[i]); }
  let next = inputCount + 1;
  for (const d of all) {
    if (d.id <= inputCount || !need.has(d.id)) continue;
    number.set(d.id, next++);
    lines.push(d);
  }
  return { lines, number };
}

// ---------------------------------------------------------------------------
// Finite models

export interface Model {
  domain: string[];
  preds: Map<string, Set<string>>;      // name → set of tuple keys "1,2"
  fns: Map<string, Map<string, string>>; // name → tuple key → element (constants: key "")
}

interface EvalCtx { model: Model; cells: number; vars: Map<string, string> }

function evalTerm(t: Term, ctx: EvalCtx): string {
  if (t.k === "var") {
    const v = ctx.vars.get(t.name);
    if (v === undefined) throw new DiscreteError(`The variable ${t.name} is free and has no value — quantify it, or give it one (${t.name} = 1).`);
    return v;
  }
  const args = t.args.map((a) => evalTerm(a, ctx));
  const table = ctx.model.fns.get(t.name);
  if (!table) {
    if (!t.args.length && ctx.model.domain.includes(t.name)) return t.name;
    throw new DiscreteError(`The ${t.args.length ? "function" : "constant"} ${t.name} is not interpreted — add ${t.args.length ? `${t.name} = {${ctx.model.domain.slice(0, 1).map((d) => `${d} ↦ ${d}`).join(", ")}, …}` : `${t.name} = ${ctx.model.domain[0]}`} to the model.`);
  }
  const key = args.join(",");
  const v = table.get(key);
  if (v === undefined) throw new DiscreteError(`${t.name}(${args.join(", ")}) is not defined — the function table must be total over the domain.`);
  return v;
}

export function evalFormula(f: Formula, ctx: EvalCtx): boolean {
  switch (f.k) {
    case "pred": {
      if (f.name === "⊤") return true;
      if (f.name === "⊥") return false;
      const rel = ctx.model.preds.get(f.name);
      if (!rel) throw new DiscreteError(`The predicate ${f.name} is not interpreted — add ${f.name} = {…} to the model (${f.name} = {} for the empty relation).`);
      return rel.has(f.args.map((a) => evalTerm(a, ctx)).join(","));
    }
    case "not": return !evalFormula(f.a, ctx);
    case "bin": {
      const a = evalFormula(f.a, ctx);
      if (f.op === "and") return a && evalFormula(f.b, ctx);
      if (f.op === "or") return a || evalFormula(f.b, ctx);
      if (f.op === "imp") return !a || evalFormula(f.b, ctx);
      return a === evalFormula(f.b, ctx);
    }
    case "q": {
      const saved = ctx.vars.get(f.v);
      let result = f.q === "forall";
      for (const d of ctx.model.domain) {
        ctx.cells++;
        if (ctx.cells > FOL_CAPS.cells) throw new DiscreteError(`The model check needs more than ${FOL_CAPS.cells.toLocaleString("en-US")} quantifier cells (6⁶) — above the cap.`);
        ctx.vars.set(f.v, d);
        const v = evalFormula(f.a, ctx);
        if (f.q === "forall" && !v) { result = false; break; }
        if (f.q === "exists" && v) { result = true; break; }
      }
      if (saved === undefined) ctx.vars.delete(f.v); else ctx.vars.set(f.v, saved);
      return result;
    }
  }
}

/** A short reason for the value, naming witnesses / counter-witnesses. */
function explain(f: Formula, ctx: EvalCtx): string {
  if (f.k !== "q") {
    const v = evalFormula(f, ctx);
    const ground = showFormula(substFormula(f, new Map([...ctx.vars.entries()].map(([k, d]) => [k, { k: "fn", name: d, args: [] } as Term]))));
    return `${ground} is ${v ? "true" : "false"}`;
  }
  const parts: string[] = [];
  const saved = ctx.vars.get(f.v);
  for (const d of ctx.model.domain) {
    ctx.vars.set(f.v, d);
    const v = evalFormula(f.a, ctx);
    if (f.q === "forall") {
      if (v) parts.push(`${f.v} = ${d}: ${witness(f.a, ctx)}`);
      else { parts.push(`${f.v} = ${d} fails${failDetail(f.a, ctx)}`); break; }
    } else {
      if (v) { parts.push(`${f.v} = ${d}: ${witness(f.a, ctx)}`); break; }
      parts.push(`${f.v} = ${d} fails${failDetail(f.a, ctx)}`);
    }
  }
  if (saved === undefined) ctx.vars.delete(f.v); else ctx.vars.set(f.v, saved);
  return parts.join("; ");
}
function witness(f: Formula, ctx: EvalCtx): string {
  if (f.k === "q" && f.q === "exists") {
    for (const d of ctx.model.domain) {
      const saved = ctx.vars.get(f.v);
      ctx.vars.set(f.v, d);
      const v = evalFormula(f.a, ctx);
      if (saved === undefined) ctx.vars.delete(f.v); else ctx.vars.set(f.v, saved);
      if (v) return `${f.v} = ${d}`;
    }
  }
  if (f.k === "q" && f.q === "forall") return `every ${f.v}`;
  return "true";
}
function failDetail(f: Formula, ctx: EvalCtx): string {
  if (f.k === "q" && f.q === "forall") {
    for (const d of ctx.model.domain) {
      const saved = ctx.vars.get(f.v);
      ctx.vars.set(f.v, d);
      const v = evalFormula(f.a, ctx);
      if (saved === undefined) ctx.vars.delete(f.v); else ctx.vars.set(f.v, saved);
      if (!v) return ` at ${f.v} = ${d}`;
    }
  }
  if (f.k === "q" && f.q === "exists") return ` (no ${f.v})`;
  return "";
}

/** Parse "domain {1, 2}, R = {(1, 2), (2, 1)}, f = {1 ↦ 2, 2 ↦ 1}, a = 1, x = 2". */
export function parseModel(spec: string, rule: VarRule): { model: Model; vars: Map<string, string> } {
  const items = splitTopLevel(spec.replace(/\n/g, ","), ",;\n");
  const model: Model = { domain: [], preds: new Map(), fns: new Map() };
  const vars = new Map<string, string>();
  const pending: string[] = [];
  for (const raw of items) {
    const it = raw.trim();
    if (!it) continue;
    const dm = /^(?:domain|universe|D|U)\s*(?:=|:|is)?\s*(.*)$/i.exec(it);
    if (dm && (/^[{\[]/.test(dm[1]) || /^\d/.test(dm[1]))) {
      const body = dm[1].trim();
      if (/^(?:ℕ|ℤ|ℝ|ℚ|N|Z|R|Q|integers|naturals|reals|rationals|numbers|all integers|all naturals)$/i.test(body)) throw new DiscreteError(`Domain "${body}" is infinite — a finite model check needs a finite domain (at most ${FOL_CAPS.domain} elements): domain {1, 2, 3}.`);
      const els = body.replace(/^[{\[]|[}\]]$/g, "").split(/[\s,]+/).filter(Boolean);
      if (!els.length) throw new DiscreteError("The domain is empty — first-order semantics needs at least one element.");
      if (els.length > FOL_CAPS.domain) throw new DiscreteError(`The domain has ${els.length} elements; the cap is ${FOL_CAPS.domain} (every quantifier is evaluated by enumeration, 6⁶ = 46,656 cells).`);
      if (new Set(els).size !== els.length) throw new DiscreteError("The domain lists an element twice.");
      model.domain = els;
      continue;
    }
    if (/^(?:domain|universe)\b/i.test(it)) throw new DiscreteError(`Could not read the domain in "${it}" — write domain {1, 2, 3}; an infinite domain (ℕ, ℤ, ℝ) cannot be checked by enumeration.`);
    pending.push(it);
  }
  if (!model.domain.length) throw new DiscreteError("The model needs a domain: … in domain {1, 2}, R = {(1, 2), (2, 1)}.");
  const inDomain = (e: string, where: string): string => {
    if (!model.domain.includes(e)) throw new DiscreteError(`"${e}" in ${where} is not in the domain {${model.domain.join(", ")}}.`);
    return e;
  };
  for (const it of pending) {
    let m: RegExpExecArray | null;
    if ((m = /^([A-Za-z_][A-Za-z0-9_'′₀-₉]*)\s*\(([^()]*)\)\s*(?:=|↦|->|:)\s*([A-Za-z0-9_]+)$/u.exec(it))) {
      // f(1, 2) = 3
      const args = m[2].split(/[\s,]+/).filter(Boolean).map((e) => inDomain(e, it));
      const table = model.fns.get(m[1]) ?? new Map<string, string>();
      table.set(args.join(","), inDomain(m[3], it));
      model.fns.set(m[1], table);
      continue;
    }
    if ((m = /^([A-Za-z_][A-Za-z0-9_'′₀-₉]*)\s*(?:=|:|is)\s*(.*)$/u.exec(it))) {
      const name = m[1];
      const body = m[2].trim();
      if (/^(?:\{\s*\}|∅|empty)$/i.test(body)) { model.preds.set(name, new Set()); continue; }
      if (/^[{\[]/.test(body)) {
        const inner = body.replace(/^[{\[]|[}\]]$/g, "").trim();
        if (/↦|->|→/.test(inner)) {
          // function table {1 ↦ 2, 2 ↦ 1} or {(1,2) ↦ 3}
          const table = new Map<string, string>();
          for (const cell of splitTopLevel(inner, ",;")) {
            const cm = /^\(?([^()↦>→]*?)\)?\s*(?:↦|->|→)\s*([A-Za-z0-9_]+)$/.exec(cell.trim());
            if (!cm) throw new DiscreteError(`Could not read the function cell "${cell.trim()}" in ${name} — write 1 ↦ 2 or (1, 2) ↦ 3.`);
            const args = cm[1].split(/[\s,]+/).filter(Boolean).map((e) => inDomain(e, it));
            table.set(args.join(","), inDomain(cm[2], it));
          }
          model.fns.set(name, table);
          continue;
        }
        const tuples = new Set<string>();
        const parts = inner.includes("(") ? splitTopLevel(inner, ",;") : inner.split(/[\s,]+/).filter(Boolean);
        for (const p of parts) {
          const els = p.replace(/[()]/g, " ").split(/[\s,]+/).filter(Boolean).map((e) => inDomain(e, it));
          if (!els.length) continue;
          tuples.add(els.join(","));
        }
        model.preds.set(name, tuples);
        continue;
      }
      if (/^(?:true|false|⊤|⊥|T|F)$/.test(body)) {
        // A 0-ary predicate.
        model.preds.set(name, /^(?:true|⊤|T)$/.test(body) ? new Set([""]) : new Set());
        continue;
      }
      // a = 1 (a constant), or x = 1 (a variable value)
      const el = inDomain(body, it);
      if (isVariableName(name, rule)) vars.set(name, el);
      else model.fns.set(name, new Map([["", el]]));
      continue;
    }
    throw new DiscreteError(`Could not read "${it}" in the model — write R = {(1, 2), (2, 1)}, P = {1, 3}, f = {1 ↦ 2, 2 ↦ 1}, a = 1.`);
  }
  return { model, vars };
}

function splitTopLevel(s: string, seps: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(" || c === "{" || c === "[") depth++;
    if (c === ")" || c === "}" || c === "]") depth--;
    if (seps.includes(c) && depth <= 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Bounded search for a model of `trues` in which every formula of `falses`
 *  is false: domains {1}, {1, 2}, {1, 2, 3}, every interpretation of the
 *  symbols, at most FOL_CAPS.countermodels interpretations in all. */
export function findModel(trues: Formula[], falses: Formula[]): { model: Model; tried: number } | { exhausted: boolean; tried: number } {
  const preds = new Map<string, number>();
  const fns = new Map<string, number>();
  for (const f of [...trues, ...falses]) {
    const s = symbolsOf(f);
    for (const [k, v] of s.preds) preds.set(k, v);
    for (const [k, v] of s.fns) fns.set(k, v);
    if (freeVars(f).length) return { exhausted: false, tried: 0 };
  }
  let tried = 0;
  for (let size = 1; size <= 3; size++) {
    const domain = Array.from({ length: size }, (_, i) => String(i + 1));
    // Tuples per arity, lexicographic.
    const tuplesOf = (n: number): string[][] => {
      let acc: string[][] = [[]];
      for (let i = 0; i < n; i++) acc = acc.flatMap((t) => domain.map((d) => [...t, d]));
      return acc;
    };
    const slots: { kind: "pred" | "fn"; name: string; tuples: string[][]; choices: number }[] = [];
    let total = 1;
    for (const [name, n] of preds) { if (name === "⊤" || name === "⊥") continue; const t = tuplesOf(n); slots.push({ kind: "pred", name, tuples: t, choices: 2 ** t.length }); total *= 2 ** t.length; }
    for (const [name, n] of fns) { const t = tuplesOf(n); slots.push({ kind: "fn", name, tuples: t, choices: size ** t.length }); total *= size ** t.length; }
    if (tried + total > FOL_CAPS.countermodels) return { exhausted: false, tried };
    const counters = slots.map(() => 0);
    for (;;) {
      tried++;
      const model: Model = { domain, preds: new Map(), fns: new Map() };
      slots.forEach((sl, i) => {
        if (sl.kind === "pred") {
          const set = new Set<string>();
          sl.tuples.forEach((t, b) => { if ((counters[i] >> b) & 1) set.add(t.join(",")); });
          model.preds.set(sl.name, set);
        } else {
          const table = new Map<string, string>();
          let c = counters[i];
          for (const t of sl.tuples) { table.set(t.join(","), domain[c % size]); c = Math.floor(c / size); }
          model.fns.set(sl.name, table);
        }
      });
      const ctx: EvalCtx = { model, cells: 0, vars: new Map() };
      let ok = true;
      try {
        for (const f of trues) if (!evalFormula(f, ctx)) { ok = false; break; }
        if (ok) for (const f of falses) if (evalFormula(f, ctx)) { ok = false; break; }
      } catch { ok = false; }
      if (ok) return { model, tried };
      // Increment the mixed-radix counter.
      let i = 0;
      for (; i < slots.length; i++) { counters[i]++; if (counters[i] < slots[i].choices) break; counters[i] = 0; }
      if (i === slots.length) break;
    }
  }
  return { exhausted: true, tried };
}

export function showModel(m: Model): string {
  const parts = [`domain {${m.domain.join(", ")}}`];
  for (const [name, set] of m.preds) {
    const tuples = [...set].map((k) => (k.includes(",") ? `(${k.split(",").join(", ")})` : k));
    parts.push(`${name} = {${tuples.join(", ")}}`);
  }
  for (const [name, table] of m.fns) {
    if (table.size === 1 && table.has("")) { parts.push(`${name} = ${table.get("")}`); continue; }
    parts.push(`${name} = {${[...table.entries()].map(([k, v]) => `${k.includes(",") ? `(${k.split(",").join(", ")})` : k} ↦ ${v}`).join(", ")}}`);
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Front door

const VERB_RE = /^\s*(prenex(?:\s+(?:normal\s+)?form)?(?:\s+of)?|skolemi[sz]e(?:d)?(?:\s+form)?(?:\s+of)?|skolem(?:\s+normal)?\s+form(?:\s+of)?|clausal(?:\s+form)?(?:\s+of)?|clause\s+form(?:\s+of)?|clausify|clauses(?:\s+of)?|cnf(?:\s+of)?|unify|mgu(?:\s+of)?|most\s+general\s+unifier(?:\s+of)?|resolve|resolution|free(?:\s+and\s+bound)?\s+variables(?:\s+of|\s+in)?|free\s+vars(?:\s+of)?|(?:model\s+)?check|is|valid|satisfiable)\b\s*:?\s*/i;

function cleanSubject(s: string): string {
  return s.replace(/\s+valid\??\s*$/i, "").replace(/\s+satisfiable\??\s*$/i, "").replace(/\?\s*$/, "").trim();
}

function title(t: string, display: string[], steps: string[], caveats: string[], svg?: string, alt?: string): DiscreteResult {
  return { title: t, display, steps, caveats, ...(svg ? { svg, alt } : {}) };
}

/** The engine. null = not ours (FOL_RE does not match). */
export function solveFol(input: string): DiscreteResult | null {
  const raw = input.replace(/\r/g, "").trim();
  if (!raw) return null;
  if (!FOL_RE.test(raw)) return null;
  // "resolution proof …" of a CNF belongs to the SAT engine (same keyword family).
  if (/^\s*resolution\s+proof\b/i.test(raw)) return null;
  // A `var x y` line overrides the u–z convention.
  let rule: VarRule = DEFAULT_VARS;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const body: string[] = [];
  for (const l of lines) {
    const vm = /^(?:var|vars|variables)\s*:?\s+(.+)$/i.exec(l);
    if (vm && !/[()∀∃→↔]/.test(vm[1])) rule = { explicit: new Set(vm[1].split(/[\s,]+/).filter(Boolean)) };
    else body.push(l);
  }
  const text = body.join("\n");
  const vm = VERB_RE.exec(text);
  let verb = vm ? vm[1].toLowerCase().replace(/\s+/g, " ") : "";
  let rest = vm ? text.slice(vm[0].length).trim() : text;
  const caveatVars = rule.explicit ? `Variables: ${[...rule.explicit].join(", ")} (from the var line); every other name at term position is a constant.` : "Variables are u–z (x₁, y′ included); other lowercase names at term position are constants (a–e, Socrates); uppercase names are predicates.";

  if (/^is$/.test(verb)) {
    if (/\bvalid\??\s*$/i.test(rest)) verb = "valid";
    else if (/\bsatisfiable\??\s*$/i.test(rest)) verb = "satisfiable";
    else if (/\bunsatisfiable\??\s*$/i.test(rest)) { verb = "unsatisfiable"; rest = rest.replace(/\s+unsatisfiable\??\s*$/i, ""); }
    else { verb = ""; rest = text; }
  }
  if (/\s(?:valid|satisfiable)\??$/i.test(rest) && !verb) verb = /valid\??$/i.test(rest) ? "valid" : "satisfiable";
  rest = cleanSubject(rest);

  try {
    if (/^(?:unify|mgu|most general unifier)/.test(verb)) return answerUnify(rest, rule, caveatVars);
    if (verb === "check" || verb === "model check") return answerCheck(rest, rule, caveatVars);
    if (/^(?:free)/.test(verb)) return answerFree(rest, rule, caveatVars);
    if (/^(?:prenex)/.test(verb)) return answerPrenex(rest, rule, caveatVars);
    if (/^(?:skolem)/.test(verb)) return answerSkolem(rest, rule, caveatVars);
    if (/^(?:clausal|clause form|clausify|clauses|cnf)/.test(verb)) return answerClausal(rest, rule, caveatVars);
    if (verb === "valid") return answerValid(rest, rule, caveatVars);
    if (verb === "satisfiable" || verb === "unsatisfiable") return answerSatisfiable(rest, rule, caveatVars, verb === "unsatisfiable");
    if (verb === "resolve" || verb === "resolution" || /⊢|⊨|\|=|\|-|∴|\btherefore\b|\bentails\b/.test(rest)) return answerResolve(rest, rule, caveatVars, verb === "resolution");
    // A bare formula (or a model check phrased "φ in domain …").
    if (/\bin\s+(?:the\s+)?(?:model|domain|structure)\b/i.test(rest)) return answerCheck(rest, rule, caveatVars);
    return answerFormula(rest, rule, caveatVars);
  } catch (e) {
    if (e instanceof DiscreteError) throw e;
    if (e instanceof RangeError) throw new DiscreteError("That formula nests too deeply to process.");
    throw e;
  }
}

function splitPair(s: string): [string, string] | null {
  const m = /^(.*?)\s+(?:and|with|,|=\?|≟)\s+(.*)$/s.exec(s) || /^(.*?)\s*,\s*(.*)$/s.exec(s);
  if (!m) return null;
  // The split must be at depth 0.
  const parts = splitTopLevel(s.replace(/\s+(?:and|with)\s+/g, "\u0000"), "\u0000,");
  if (parts.length !== 2) return null;
  return [parts[0].trim(), parts[1].trim()];
}

function answerUnify(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const pair = splitPair(rest);
  if (!pair) throw new DiscreteError('Write two terms to unify: "unify P(x, f(y)) and P(a, f(b))" (or "mgu of t₁, t₂").');
  const t1 = parseTerm(pair[0], rule);
  const t2 = parseTerm(pair[1], rule);
  const display = [`${showTerm(t1)}  ≟  ${showTerm(t2)}`];
  const steps: string[] = [];
  const r = unifyTerms([[t1, t2]]);
  if (!r.ok) {
    display.push(`No unifier: ${describeFailure(r.why)}.`);
    if (r.why.kind === "occurs") steps.push(`A variable cannot be bound to a term containing itself: ${r.why.v} ↦ ${showTerm(r.why.t)} would make ${r.why.v} infinite.`);
    if (r.why.kind === "clash") steps.push(`Two different function (or predicate) symbols never unify: ${r.why.a} and ${r.why.b} are distinct constants/functors.`);
    if (r.why.kind === "arity") steps.push("A symbol used with two different numbers of arguments is read as two different symbols.");
    return title("Unification", display, steps, [caveatVars, "Robinson's algorithm with the occurs check: the most general unifier is unique up to renaming when it exists."]);
  }
  const a = applyTerm(t1, r.subst), b = applyTerm(t2, r.subst);
  const same = showTerm(a) === showTerm(b);
  display.push(r.subst.size ? `MGU: ${showSubst(r.subst)}` : "MGU: {} (the terms are already identical)");
  display.push(`Both become ${showTerm(a)}${same ? "" : " — CROSS-CHECK FAILED"}`);
  for (const [v, t] of r.subst) steps.push(`${v} ↦ ${showTerm(t)}`);
  steps.push(`Verified: ${showTerm(t1)}σ = ${showTerm(a)} and ${showTerm(t2)}σ = ${showTerm(b)}${same ? " — equal." : " — DIFFERENT (a defect in this tool)."}`);
  if (!same) throw new DiscreteError("Unifier cross-check failed: applying the substitution did not make the terms equal — a defect in this tool, nothing is reported.");
  return title("Unification", display, steps, [caveatVars, "Robinson's algorithm with the occurs check: the most general unifier is unique up to renaming when it exists."]);
}

function answerFree(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const f = parseFol(rest, rule);
  const fv = freeVars(f), bv = boundVars(f);
  return title("Free and bound variables", [
    showFormula(f),
    fv.length ? `Free: {${fv.join(", ")}}` : "Free: none — the formula is closed (a sentence).",
    bv.length ? `Bound: {${bv.join(", ")}}` : "Bound: none — no quantifiers.",
  ], [], [caveatVars]);
}

function answerPrenex(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const f = parseFol(rest, rule);
  const tr: Trace = { steps: [] };
  const p = toPrenex(f, tr);
  const out = prenexToFormula(p);
  const display = [showFormula(f), `Prenex: ${showFormula(out)}`];
  if (!p.prefix.length) display.push("No quantifiers — the formula is already its own matrix.");
  else if (showFormula(out) === showFormula(f)) display.push("Already in prenex form.");
  const steps = tr.steps.length ? tr.steps : ["No quantifier had to move."];
  const fv = freeVars(f);
  const caveats = [caveatVars, "Prenex form is not unique: quantifiers from the left operand are pulled first; ↔ with quantified operands is expanded to two implications."];
  if (fv.length) caveats.push(`Free variables ${fv.join(", ")} stay free.`);
  return title("Prenex normal form", display, steps, caveats);
}

function answerSkolem(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const f = parseFol(rest, rule);
  const tr: Trace = { steps: [] };
  const p = toPrenex(f, tr);
  const used = new Set<string>([...symbolsOf(f).fns.keys(), ...allVarNames(f)]);
  const sk = skolemize(p, skolemNaming(pickLetter(used), used), tr);
  let out: Formula = sk.matrix;
  for (let i = sk.prefix.length - 1; i >= 0; i--) out = { k: "q", q: "forall", v: sk.prefix[i], a: out };
  const display = [showFormula(f), `Prenex: ${showFormula(prenexToFormula(p))}`, `Skolem form: ${showFormula(out)}`];
  if (sk.functions.length) display.push(`Skolem ${sk.functions.length === 1 ? "term" : "terms"}: ${sk.functions.join(", ")}`);
  else display.push("No ∃ to eliminate.");
  return title("Skolem normal form", display, tr.steps, [caveatVars, "Skolemisation preserves satisfiability, not equivalence: the Skolem form is satisfiable exactly when the original is."]);
}

function pickLetter(used: Set<string>): string {
  for (const l of ["f", "g", "h", "k", "s"]) if (![...used].some((u) => u === l || new RegExp(`^${l}[₀-₉]+$`, "u").test(u))) return l;
  return "sk";
}

function answerClausal(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const f = parseFol(rest, rule);
  const used = new Set<string>([...symbolsOf(f).fns.keys(), ...allVarNames(f)]);
  const tr: Trace = { steps: [] };
  const c = clausalForm(f, skolemNaming(pickLetter(used), used), tr);
  const display = [showFormula(f), `Clauses: ${c.clauses.map(showClause).join(", ") || "(none — the formula is a tautology)"}`];
  const steps = [`Prenex: ${showFormula(prenexToFormula(c.prenex))}`, ...tr.steps, `Matrix in CNF, ∀ dropped: ${c.clauses.length} clause${c.clauses.length === 1 ? "" : "s"}.`];
  const caveats = [caveatVars, "Variables in a clause are implicitly universal; each clause is a disjunction of literals; □ is the empty clause."];
  if (freeVars(f).length) caveats.push(`Free variables (${freeVars(f).join(", ")}) are read as universally quantified.`);
  return title("Clausal form", display, steps, caveats);
}

function answerFormula(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const f = parseFol(rest, rule);
  const fv = freeVars(f), bv = boundVars(f);
  const tr: Trace = { steps: [] };
  const p = toPrenex(f, tr);
  const pf = prenexToFormula(p);
  const used = new Set<string>([...symbolsOf(f).fns.keys(), ...allVarNames(f)]);
  const c = clausalForm(f, skolemNaming(pickLetter(used), used));
  const display = [
    showFormula(f),
    fv.length ? `Free variables: {${fv.join(", ")}}${bv.length ? `; bound: {${bv.join(", ")}}` : ""}` : `Closed (no free variables)${bv.length ? `; bound: {${bv.join(", ")}}` : ""}`,
    showFormula(pf) === showFormula(f) ? "Prenex: already in prenex form." : `Prenex: ${showFormula(pf)}`,
    `Clauses: ${c.clauses.map(showClause).join(", ") || "(none — tautology)"}`,
  ];
  const steps = [...tr.steps, ...c.steps.filter((s) => !tr.steps.includes(s))];
  // A closed formula also gets a satisfiability verdict by resolution on its
  // own clauses (refuted = UNSATISFIABLE; saturated = satisfiable; a cap says nothing).
  if (!fv.length && c.clauses.length) {
    const r = resolution(c.clauses.map((clause) => ({ clause })));
    const inputCount = r.all.filter((d) => !d.from).length;
    if (r.kind === "refuted") {
      const { lines, number } = derivationOf(r.all, r.empty, inputCount);
      const derived = lines.filter((d) => d.from);
      for (const d of derived) {
        const v = verifyStep(d);
        if (!v.ok) throw new DiscreteError(`A resolvent failed re-verification (${v.why}) — a defect in this tool, nothing is reported.`);
      }
      const show1 = (d: Derived): string => {
        const ps = d.from!.parents.map((p) => r.all[p - 1]);
        const subst = d.from!.subst.size ? ` [${[...d.from!.subst.entries()].map(([k, t]) => `${k} ↦ ${showTerm(t)}`).join(", ")}]` : "";
        return `${ps.map((p) => showClause(p.clause)).join(", ")} → ${showClause(d.clause)}${subst}`;
      };
      display.push(`UNSATISFIABLE (resolution): ${derived.map(show1).join("; ")}`);
      steps.push(...derived.map((d) => `${number.get(d.id)}. ${showClause(d.clause)} from ${d.from!.parents.map((p) => number.get(p)!).sort((a, b) => a - b).join(", ")} — verified`));
    } else if (r.kind === "saturated") {
      display.push(`Satisfiable — resolution saturated after ${r.all.length} clause${r.all.length === 1 ? "" : "s"} without □ (resolution is refutation-complete).`);
    } else {
      display.push(`Satisfiability: UNKNOWN — resolution stopped at the ${r.reason} (first-order satisfiability is undecidable in general).`);
    }
  }
  return title("First-order formula", display, steps, [caveatVars, "Verbs: prenex · skolemize · clausal form · unify t₁ and t₂ · resolve Γ ⊢ φ · check φ in domain {…} · is φ valid."]);
}

function parseFormulaList(s: string, rule: VarRule): Formula[] {
  return splitTopLevel(s.replace(/\n/g, ","), ",;").map((p) => p.trim()).filter(Boolean).map((p) => parseFol(p, rule));
}

function answerValid(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const f = parseFol(rest, rule);
  if (freeVars(f).length) throw new DiscreteError(`"${showFormula(f)}" has free variables (${freeVars(f).join(", ")}) — validity is asked of a closed formula; quantify them.`);
  return runResolution([], f, rule, caveatVars, { title: "Validity (resolution)", goalWord: "formula", display0: `Is ${showFormula(f)} valid?` });
}

function answerSatisfiable(rest: string, rule: VarRule, caveatVars: string, askUnsat: boolean): DiscreteResult {
  const fs = parseFormulaList(rest, rule);
  return runResolution(fs, null, rule, caveatVars, { title: askUnsat ? "Unsatisfiability (resolution)" : "Satisfiability (resolution)", goalWord: "set", display0: `Is ${fs.map(showFormula).join(", ")} ${askUnsat ? "un" : ""}satisfiable?` });
}

function answerResolve(rest: string, rule: VarRule, caveatVars: string, clauseStyle: boolean): DiscreteResult {
  const toks = tokenizeFol(rest);
  const turns = toks.filter((t) => t.t === "turnstile");
  if (turns.length > 1) throw new DiscreteError("Only one ⊢ per argument.");
  if (turns.length === 1) {
    const chars = Array.from(rest);
    const lhs = chars.slice(0, turns[0].pos).join("");
    const rhs = chars.slice(turns[0].pos + turns[0].s.length).join("");
    const premises = parseFormulaList(lhs, rule);
    const goal = parseFol(rhs, rule);
    return runResolution(premises, goal, rule, caveatVars, { title: "Resolution", goalWord: "argument", display0: `${premises.map(showFormula).join(", ")} ⊢ ${showFormula(goal)}` });
  }
  const fs = parseFormulaList(rest, rule);
  if (!fs.length) throw new DiscreteError('Write the clauses or formulas to resolve: "resolution: P(a), ∀x (P(x) → Q(x)), ¬Q(a)" or "resolve Γ ⊢ φ".');
  return runResolution(fs, null, rule, caveatVars, { title: clauseStyle ? "Resolution" : "Resolution (clause set)", goalWord: "set", display0: fs.map(showFormula).join(", ") });
}

function runResolution(premises0: Formula[], goal0: Formula | null, rule: VarRule, caveatVars: string, opts: { title: string; goalWord: string; display0: string }): DiscreteResult {
  const display = [opts.display0];
  const steps: string[] = [];
  const caveats: string[] = [caveatVars];
  // Free variables are read as universal — and the closure is taken BEFORE
  // the goal is negated: ¬∀x φ, never ∀x ¬φ (P(a) does not entail ∀x P(x)).
  const opened = [...premises0, ...(goal0 ? [goal0] : [])].flatMap((f) => freeVars(f));
  const premises = premises0.map(universalClosure);
  const goal = goal0 ? universalClosure(goal0) : null;
  if (opened.length) caveats.push(`Free variables (${[...new Set(opened)].join(", ")}) are read as universally quantified in each formula — the closure is taken before the goal is negated.`);
  const allForms = goal ? [...premises, goal] : premises;
  const used = new Set<string>();
  for (const f of allForms) { for (const k of symbolsOf(f).fns.keys()) used.add(k); for (const v of allVarNames(f)) used.add(v); }
  const letterP = pickLetter(used);
  const namingP = skolemNaming(letterP, used);
  const inputs: { clause: Clause; label?: string }[] = [];
  const clauseSteps: string[] = [];
  premises.forEach((p, i) => {
    const tr: Trace = { steps: [] };
    const c = clausalForm(p, namingP, tr);
    for (const s of tr.steps) clauseSteps.push(`Premise ${i + 1}: ${s}`);
    for (const cl of c.clauses) inputs.push({ clause: cl, label: premises.length > 1 ? `premise ${i + 1}` : "premise" });
  });
  if (goal) {
    const neg: Formula = { k: "not", a: goal };
    const usedG = new Set(used);
    const letterG = pickLetter(new Set([...usedG, letterP, ...[...usedG]]));
    const namingG = skolemNaming(letterG === letterP ? pickLetter(new Set([...usedG, letterP])) : letterG, usedG);
    namingG.constCounter = namingP.constCounter;
    const tr: Trace = { steps: [] };
    const c = clausalForm(neg, namingG, tr);
    steps.push(`Negate the ${opts.goalWord === "formula" ? "formula" : "goal"}: ${showFormula(neg)}`);
    for (const s of tr.steps) clauseSteps.push(`Negated goal: ${s}`);
    for (const cl of c.clauses) inputs.push({ clause: cl, label: "negated goal" });
  }
  steps.push(...clauseSteps);
  const isValidity = goal !== null;
  // Pure-literal deletion at the predicate level (satisfiability-preserving):
  // a clause holding a literal whose predicate never occurs with the opposite
  // sign can take part in no refutation, so it is dropped before saturating.
  // When the negated goal is dropped this way, no refutation can use it.
  const pureDropped: string[] = [];
  let kept = inputs;
  for (;;) {
    const signs = new Set<string>();
    for (const c of kept) for (const l of c.clause) signs.add(`${l.neg ? "-" : "+"}${l.name}/${l.args.length}`);
    const pureLit = (l: Lit): boolean => !signs.has(`${l.neg ? "+" : "-"}${l.name}/${l.args.length}`);
    const next = kept.filter((c) => {
      const p = c.clause.find(pureLit);
      if (p) pureDropped.push(`${showClause(c.clause)}${c.label ? ` (${c.label})` : ""} — ${showLit(p).replace(/\(.*$/, "")} ${p.neg ? "never occurs positively" : "never occurs negated"}`);
      return !p;
    });
    if (next.length === kept.length) break;
    kept = next;
  }
  if (pureDropped.length) steps.push(`Dropped by the pure-literal rule (they can take part in no refutation): ${pureDropped.join("; ")}.`);
  const clauseCount = inputs.length;
  if (!kept.length) {
    // An empty clause set is satisfiable: the verdict follows at once.
    const why = !clauseCount ? "every formula is a tautology, so there are no clauses" : "every clause was dropped by the pure-literal rule";
    if (isValidity) display.push(`SATISFIABLE clause set (${why}) — no refutation is possible, so the ${opts.goalWord} is INVALID.`);
    else display.push(`SATISFIABLE — ${why}, and an empty clause set is satisfiable.`);
    const cm = goal ? findModel(premises, [goal]) : findModel(premises, []);
    if ("model" in cm) display.push(`${isValidity ? "Countermodel" : "Model"}: ${showModel(cm.model)}${isValidity ? " — every premise true, the goal false" : ""}.`);
    return title(opts.title, display, steps, caveats);
  }
  const r = resolution(kept);
  const inputCount = r.all.filter((d) => !d.from).length;
  // Inputs that were dropped as duplicates/tautologies are not numbered — list what was kept.
  steps.push("Clauses:");
  for (const d of r.all.slice(0, inputCount)) steps.push(`  ${d.id}. ${showClause(d.clause)}${d.label ? `  (${d.label})` : ""}`);
  caveats.push(`Caps: ${FOL_CAPS.clauses} clauses kept, ${FOL_CAPS.unifications.toLocaleString("en-US")} unifications (this run: ${r.all.length} clauses, ${r.unifications} unifications). Skolem functions: ${letterP}₁, ${letterP}₂, … for the premises${goal ? ", g₁, … for the negated goal" : ""}; constants c₁, c₂, ….`);
  if (r.kind === "refuted") {
    const { lines, number } = derivationOf(r.all, r.empty, inputCount);
    const derived = lines.filter((d) => d.from);
    steps.push("Derivation:");
    const nodes: { id: string; label: string; kind?: "box" | "normal"; highlight?: boolean }[] = [];
    const edges: { from: string; to: string; label?: string }[] = [];
    let verifiedAll = true;
    for (const d of lines) {
      const n = number.get(d.id)!;
      nodes.push({ id: String(n), label: `${n}: ${showClause(d.clause)}`, kind: d.clause.length ? "normal" : "box", highlight: !d.clause.length });
      if (!d.from) continue;
      const ps = d.from.parents.map((p) => number.get(p)!).sort((a, b) => a - b);
      const v = verifyStep(d);
      if (!v.ok) verifiedAll = false;
      const subst = d.from.subst.size ? ` [${[...d.from.subst.entries()].map(([k, t]) => `${k} ↦ ${showTerm(t)}`).join(", ")}]` : "";
      const ren = d.from.renamed.length ? ` (renamed apart: ${d.from.renamed.join(", ")})` : "";
      steps.push(`  ${n}. ${showClause(d.clause)} from ${ps.join(", ")}${d.from.kind === "factor" ? " by factoring" : ""}${subst}${ren}${v.ok ? "" : ` — VERIFICATION FAILED: ${v.why}`}`);
      for (const p of ps) edges.push({ from: String(p), to: String(n), label: p === ps[0] && subst ? undefined : undefined });
    }
    if (!verifiedAll) throw new DiscreteError("A resolvent failed re-verification (re-unifying its parents' complementary literals) — a defect in this tool, nothing is reported.");
    steps.push(`Verified: every resolvent re-derived by applying its printed substitution to both parents (${derived.length} step${derived.length === 1 ? "" : "s"}).`);
    const k = derived.length;
    if (isValidity) display.push(`REFUTED in ${k} resolvent${k === 1 ? "" : "s"} — the ${opts.goalWord} is VALID.`);
    else display.push(`UNSATISFIABLE — the empty clause □ was derived in ${k} resolvent${k === 1 ? "" : "s"}.`);
    display.push(derived.map((d) => `${number.get(d.id)}. ${showClause(d.clause)} from ${d.from!.parents.map((p) => number.get(p)!).sort((a, b) => a - b).join(", ")}${d.from!.subst.size ? ` [${[...d.from!.subst.entries()].map(([kk, t]) => `${kk} ↦ ${showTerm(t)}`).join(", ")}]` : ""}`).join(" · "));
    const svg = treeSvg({ nodes, edges, dag: true, caption: `Refutation: □ in ${k} resolvent${k === 1 ? "" : "s"}` });
    return title(opts.title, display, steps, caveats, svg, `Resolution refutation DAG: ${lines.length} clauses, ending in the empty clause.`);
  }
  if (r.kind === "saturated") {
    const derivedCount = r.all.length - inputCount;
    if (isValidity) display.push(`SATURATED after ${r.all.length} clause${r.all.length === 1 ? "" : "s"} (${derivedCount} derived), no refutation — the ${opts.goalWord} is INVALID (resolution with factoring is refutation-complete: an unsatisfiable set always yields □).`);
    else display.push(`SATISFIABLE — resolution saturated after ${r.all.length} clause${r.all.length === 1 ? "" : "s"} (${derivedCount} derived) without deriving □ (resolution is refutation-complete).`);
    if (r.failures.length) steps.push(`Pairs that did not unify: ${r.failures.slice(0, 6).join("; ")}${r.failures.length > 6 ? `; … ${r.failures.length - 6} more` : ""}.`);
    const derived = r.all.slice(inputCount);
    if (derived.length) steps.push(`Derived: ${derived.slice(0, 12).map((d) => `${d.id}. ${showClause(d.clause)}`).join(" · ")}${derived.length > 12 ? ` · … ${derived.length - 12} more` : ""}`);
    if (r.failures.length === 1 && derived.length === 0) display.push(`The only pair fails: ${r.failures[0].replace(/^.*?: /, "")}.`);
    const cm = goal ? findModel(premises, [goal]) : findModel(premises, []);
    if ("model" in cm) {
      display.push(`${isValidity ? "Countermodel" : "Model"}: ${showModel(cm.model)}${isValidity ? " — every premise true, the goal false" : ""}.`);
      caveats.push(`Finite-model search: domains {1}, {1, 2}, {1, 2, 3}, ${cm.tried} interpretation${cm.tried === 1 ? "" : "s"} tried (cap ${FOL_CAPS.countermodels.toLocaleString("en-US")}).`);
    } else caveats.push(`Finite-model search found none in domains of size ≤ 3 (${cm.tried} interpretations tried${cm.exhausted ? "" : "; cap reached"}) — saturation alone is the proof here.`);
    return title(opts.title, display, steps, caveats);
  }
  // Unknown: the cap. A finite countermodel, if one exists, still settles it.
  const cm = goal ? findModel(premises, [goal]) : findModel(premises, []);
  if ("model" in cm) {
    display.push(`${isValidity ? `INVALID — a countermodel exists: ${showModel(cm.model)} (every premise true, the goal false)` : `SATISFIABLE — a model exists: ${showModel(cm.model)}`}.`);
    caveats.push(`Resolution hit its ${r.reason}; the finite model (${cm.tried} interpretations tried) is the proof instead.`);
    return title(opts.title, display, steps, caveats);
  }
  display.push(`No refutation found within ${r.reason.startsWith("clause") ? `${FOL_CAPS.clauses} clauses` : r.reason.startsWith("unification") ? `${FOL_CAPS.unifications.toLocaleString("en-US")} unifications` : `the term-depth bound of ${FOL_CAPS.termDepth}`} — UNKNOWN (first-order validity is only semi-decidable: a refutation is a proof, "not found" is not).`);
  steps.push(`Stopped at the ${r.reason}.`);
  steps.push(`Last derived: ${r.all.slice(-5).map((d) => `${d.id}. ${showClause(d.clause)}`).join(" · ")}`);
  caveats.push(`Finite-model search (domains of size ≤ 3, ${cm.tried} interpretations${cm.exhausted ? "" : ", cap reached"}) found no ${isValidity ? "countermodel" : "model"} either — nothing is reported rather than guessed.`);
  return title(opts.title, display, steps, caveats);
}

function answerCheck(rest: string, rule: VarRule, caveatVars: string): DiscreteResult {
  const m = /^(.*?)\s+in\s+(?:the\s+)?(?:model|structure|domain)\s*:?\s*(.*)$/is.exec(rest);
  if (!m) throw new DiscreteError('Write "check φ in domain {1, 2}, R = {(1, 2), (2, 1)}".');
  const spec = /^(?:model|structure)/i.test(rest.slice(m[1].length).trim().replace(/^in\s+(?:the\s+)?/i, "")) ? m[2] : `domain ${m[2]}`;
  const f = parseFol(m[1], rule);
  const { model, vars } = parseModel(spec, rule);
  const ctx: EvalCtx = { model, cells: 0, vars };
  const fv = freeVars(f).filter((v) => !vars.has(v));
  if (fv.length) throw new DiscreteError(`${fv.join(", ")} ${fv.length === 1 ? "is" : "are"} free in ${showFormula(f)} — quantify ${fv.length === 1 ? "it" : "them"} or give ${fv.length === 1 ? "it" : "them"} a value (${fv[0]} = ${model.domain[0]}).`);
  const value = evalFormula(f, ctx);
  const why = explain(f, { model, cells: 0, vars: new Map(vars) });
  const display = [showFormula(f), `${value ? "TRUE" : "FALSE"} in ${showModel(model)}`, value ? `Why: ${why}` : `Why not: ${why}`];
  const steps = [`Domain of ${model.domain.length}: every quantifier is evaluated by enumeration (${ctx.cells} quantifier cell${ctx.cells === 1 ? "" : "s"} evaluated; cap ${FOL_CAPS.cells.toLocaleString("en-US")} = 6⁶).`];
  if (vars.size) steps.push(`Variable values: ${[...vars.entries()].map(([k, v]) => `${k} = ${v}`).join(", ")}.`);
  return title("Finite model check", display, steps, [caveatVars, "Truth in ONE finite model is not validity; falsity in one model is a countermodel (a proof of non-validity)."]);
}
