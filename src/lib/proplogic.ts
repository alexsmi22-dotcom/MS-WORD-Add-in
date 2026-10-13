// Propositional logic — truth tables, classification, normal forms, entailment.
//
// What a student types: (p -> q) & ~q -> ~p · p | ~p · p -> q, p |= q ·
// (p & q) == ~(~p | ~q) · dnf (p -> q) & r · simplify a&b | a&~b.
//
// Everything here is decided by the truth table, which is complete and exact
// for propositional logic — no proof search, no heuristics. The one place a
// heuristic exists is the MINIMAL disjunctive normal form, which is set cover
// (NP-hard); it is delegated to the Quine–McCluskey minimiser in logic.ts,
// which says whether its cover is exact or greedy, and that note is carried
// through verbatim.
//
// ≡ / == between two formulas is read as the EQUIVALENCE question. That is
// not a separate engine: A ≡ B holds exactly when A ↔ B is a tautology, so
// the biconditional is evaluated and the verdict is phrased as equivalence.
// Entailment (premises ⊢ conclusion) is likewise a table check: no row with
// every premise true and the conclusion false. An invalid argument is
// answered with the counterexample row, which is what makes it invalid.

import { DiscreteResult, DiscreteError } from "./discrete";
import { minimise } from "./logic";

export type Formula =
  | { k: "var"; name: string }
  | { k: "const"; value: boolean }
  | { k: "not"; a: Formula }
  | { k: "bin"; op: "and" | "or" | "imp" | "iff" | "xor" | "nand" | "nor" | "equiv"; a: Formula; b: Formula };

export const MAX_VARS = 10;
const TABLE_SHOWN_VARS = 5;

// ---------------------------------------------------------------------------
// Tokens

type TokKind = "id" | "const" | "not" | "and" | "or" | "imp" | "iff" | "xor" | "nand" | "nor" | "equiv" | "lp" | "rp" | "turnstile" | "comma";
interface Tok { t: TokKind; s: string; v?: boolean; pos: number }

/** Symbols that make a line unmistakably a logic formula (vs. prose). */
const STRONG = /¬|~|!|∧|∨|→|↔|⊕|⊢|⊨|∴|&|\||->|<->|=>|<=>|\bimplies\b|\biff\b|\bxor\b|\bnand\b|\bnor\b|==|≡|\btherefore\b/i;

const WORD_OPS: Record<string, TokKind> = {
  not: "not", and: "and", or: "or", implies: "imp", iff: "iff", xor: "xor", nand: "nand", nor: "nor",
  equiv: "equiv", equivalent: "equiv", therefore: "turnstile", entails: "turnstile",
};
// Only the words and symbols: a bare t or f is a VARIABLE (f, g, t are common names).
const CONSTS: Record<string, boolean> = { true: true, false: false, "⊤": true, "⊥": false, "1": true, "0": false };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const chars = Array.from(src);
  let i = 0;
  const push = (t: TokKind, s: string, pos: number, v?: boolean): void => { toks.push({ t, s, pos, v }); };
  while (i < chars.length) {
    const c = chars[i];
    const two = c + (chars[i + 1] ?? "");
    const three = two + (chars[i + 2] ?? "");
    if (/\s/u.test(c)) { i++; continue; }
    if (three === "<->" || three === "<=>") { push("iff", three, i); i += 3; continue; }
    if (two === "->" || two === "=>" ) { push("imp", two, i); i += 2; continue; }
    if (two === "&&") { push("and", two, i); i += 2; continue; }
    if (two === "||") { push("or", two, i); i += 2; continue; }
    if (two === "|=") { push("turnstile", two, i); i += 2; continue; }
    if (two === "==") { push("equiv", two, i); i += 2; continue; }
    const one: Record<string, TokKind> = {
      "¬": "not", "~": "not", "!": "not", "∧": "and", "&": "and", "·": "and", "∙": "and", "∨": "or", "|": "or", "+": "or",
      "→": "imp", "⊃": "imp", "↔": "iff", "⊕": "xor", "↑": "nand", "↓": "nor", "≡": "equiv", "⊢": "turnstile", "⊨": "turnstile", "∴": "turnstile",
      "(": "lp", ")": "rp", ",": "comma",
    };
    if (one[c]) { push(one[c], c, i); i++; continue; }
    if (c === "⊤" || c === "⊥") { push("const", c, i, c === "⊤"); i++; continue; }
    if (/[A-Za-z_0-9]/.test(c)) {
      let j = i;
      while (j < chars.length && /[A-Za-z0-9_'′₀-₉]/u.test(chars[j])) j++;
      const word = chars.slice(i, j).join("");
      const lw = word.toLowerCase();
      if (WORD_OPS[lw]) push(WORD_OPS[lw], word, i);
      else if (lw in CONSTS) push("const", word, i, CONSTS[lw]);
      else if (/^[0-9]/.test(word)) throw new DiscreteError(`"${word}" is not a propositional variable (only the constants 0 and 1 are read as truth values).`);
      else push("id", word, i);
      i = j;
      continue;
    }
    if (c === "^") throw new DiscreteError('"^" is ambiguous (AND in some books, XOR in others) — write & for and, xor for exclusive or.');
    throw new DiscreteError(`Unexpected character "${c}" at position ${i + 1}.`);
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Parser: ¬ > ∧,↑ > ∨,↓,⊕ > → (right-assoc) > ↔ > ≡

export function parseFormula(src: string): Formula {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const take = (): Tok => {
    const t = toks[p++];
    if (!t) throw new DiscreteError("The formula ends too early.");
    return t;
  };
  const bin = (k: Formula["k"] & "bin", op: Extract<Formula, { k: "bin" }>["op"], a: Formula, b: Formula): Formula => ({ k, op, a, b });

  const atom = (): Formula => {
    const t = take();
    if (t.t === "id") return { k: "var", name: t.s };
    if (t.t === "const") return { k: "const", value: t.v as boolean };
    if (t.t === "not") return { k: "not", a: atom() };
    if (t.t === "lp") {
      const inner = equiv();
      const close = peek();
      if (!close || close.t !== "rp") throw new DiscreteError(`Missing ")" for the "(" at position ${t.pos + 1}.`);
      take();
      return inner;
    }
    throw new DiscreteError(`Unexpected "${t.s}" at position ${t.pos + 1}.`);
  };
  const conj = (): Formula => {
    let a = atom();
    for (;;) {
      const t = peek();
      if (t && (t.t === "and" || t.t === "nand")) { take(); a = bin("bin", t.t, a, atom()); }
      else if (t && (t.t === "id" || t.t === "const" || t.t === "lp" || t.t === "not")) {
        throw new DiscreteError(`Two things side by side at position ${t.pos + 1} with no connective between them — write & for and, | for or.`);
      } else return a;
    }
  };
  // NOT > AND > XOR > OR — the same precedence as the digital-logic
  // minimiser elsewhere in this product.
  const xorLevel = (): Formula => {
    let a = conj();
    for (;;) {
      const t = peek();
      if (t && t.t === "xor") { take(); a = bin("bin", "xor", a, conj()); }
      else return a;
    }
  };
  const disj = (): Formula => {
    let a = xorLevel();
    for (;;) {
      const t = peek();
      if (t && (t.t === "or" || t.t === "nor")) { take(); a = bin("bin", t.t, a, xorLevel()); }
      else return a;
    }
  };
  const imp = (): Formula => {
    const a = disj();
    const t = peek();
    if (t && t.t === "imp") { take(); return bin("bin", "imp", a, imp()); } // right-associative
    return a;
  };
  const iff = (): Formula => {
    let a = imp();
    for (;;) {
      const t = peek();
      if (t && t.t === "iff") { take(); a = bin("bin", "iff", a, imp()); }
      else return a;
    }
  };
  const equiv = (): Formula => {
    let a = iff();
    for (;;) {
      const t = peek();
      if (t && t.t === "equiv") { take(); a = bin("bin", "equiv", a, iff()); }
      else return a;
    }
  };
  const f = equiv();
  const rest = peek();
  if (rest) throw new DiscreteError(`Unexpected "${rest.s}" at position ${rest.pos + 1}.`);
  return f;
}

export function variablesOf(f: Formula, out: string[] = []): string[] {
  if (f.k === "var") { if (!out.includes(f.name)) out.push(f.name); }
  else if (f.k === "not") variablesOf(f.a, out);
  else if (f.k === "bin") { variablesOf(f.a, out); variablesOf(f.b, out); }
  return out;
}

export function evaluate(f: Formula, env: Record<string, boolean>): boolean {
  switch (f.k) {
    case "var": return env[f.name];
    case "const": return f.value;
    case "not": return !evaluate(f.a, env);
    case "bin": {
      const a = evaluate(f.a, env);
      const b = evaluate(f.b, env);
      switch (f.op) {
        case "and": return a && b;
        case "or": return a || b;
        case "imp": return !a || b;
        case "iff": case "equiv": return a === b;
        case "xor": return a !== b;
        case "nand": return !(a && b);
        case "nor": return !(a || b);
      }
    }
  }
}

const OP_SYM: Record<string, string> = { and: "∧", or: "∨", imp: "→", iff: "↔", equiv: "≡", xor: "⊕", nand: "↑", nor: "↓" };
const PREC: Record<string, number> = { equiv: 0, iff: 1, imp: 2, or: 3, nor: 3, xor: 4, and: 5, nand: 5 };

/** Unicode rendering with minimal parentheses — and it parses back.
 *  A child is bracketed when it binds more loosely than its parent, or
 *  equally loosely with a different operator (p ∨ q ⊕ r is ambiguous to a
 *  reader even if not to the grammar), or on the LEFT of → (right-assoc). */
export function show(f: Formula): string {
  const go = (u: Formula, parent: number, side: "l" | "r" | "n", parentOp: string): string => {
    switch (u.k) {
      case "var": return u.name;
      case "const": return u.value ? "⊤" : "⊥";
      case "not": return `¬${u.a.k === "bin" ? `(${go(u.a, -1, "n", "")})` : go(u.a, 99, "n", "")}`;
      case "bin": {
        const pr = PREC[u.op];
        const s = `${go(u.a, pr, "l", u.op)} ${OP_SYM[u.op]} ${go(u.b, pr, "r", u.op)}`;
        if (parent < 0) return s;
        const needs = pr < parent || (pr === parent && (u.op !== parentOp || (u.op === "imp" && side === "l") || ((u.op === "nand" || u.op === "nor") && side === "r")));
        return needs ? `(${s})` : s;
      }
    }
  };
  return go(f, -1, "n", "");
}

// ---------------------------------------------------------------------------
// Tables

export interface Row { env: Record<string, boolean>; value: boolean }

export function truthRows(f: Formula, vars: string[]): Row[] {
  const n = vars.length;
  const rows: Row[] = [];
  for (let i = 0; i < 1 << n; i++) {
    const env: Record<string, boolean> = {};
    // First variable is the most significant bit, T before F (textbook order).
    for (let b = 0; b < n; b++) env[vars[b]] = ((i >> (n - 1 - b)) & 1) === 0;
    rows.push({ env, value: evaluate(f, env) });
  }
  return rows;
}

const TF = (b: boolean): string => (b ? "T" : "F");

function literal(v: string, val: boolean): string { return val ? v : `¬${v}`; }

function dnfOf(rows: Row[], vars: string[]): string {
  const trues = rows.filter((r) => r.value);
  if (!trues.length) return "⊥ (no satisfying row)";
  if (trues.length === rows.length) return "⊤ (every row)";
  return trues.map((r) => (vars.length > 1 ? "(" : "") + vars.map((v) => literal(v, r.env[v])).join(" ∧ ") + (vars.length > 1 ? ")" : "")).join(" ∨ ");
}
function cnfOf(rows: Row[], vars: string[]): string {
  const falses = rows.filter((r) => !r.value);
  if (!falses.length) return "⊤ (no falsifying row)";
  if (falses.length === rows.length) return "⊥ (every row)";
  return falses.map((r) => (vars.length > 1 ? "(" : "") + vars.map((v) => literal(v, !r.env[v])).join(" ∨ ") + (vars.length > 1 ? ")" : "")).join(" ∧ ");
}

/** Minimal DNF via Quine–McCluskey in logic.ts. Variables are passed as
 *  single letters (its implicant strings concatenate names) and mapped back. */
function minimalDnf(rows: Row[], vars: string[]): { expr: string; note: string } | null {
  if (!vars.length) return null;
  const letters = vars.map((_, i) => String.fromCharCode(65 + i));
  // logic.ts numbers minterms with bit set = TRUE, first variable most
  // significant; the table here lists T before F, so the row index is NOT
  // the minterm — recompute it from the assignment.
  const minterms: number[] = [];
  for (const r of rows) {
    if (!r.value) continue;
    let idx = 0;
    vars.forEach((v, b) => { if (r.env[v]) idx |= 1 << (vars.length - 1 - b); });
    minterms.push(idx);
  }
  if (!minterms.length || minterms.length === rows.length) return null;
  const m = minimise(minterms, letters);
  if (!m.ok) return null;
  const render = (term: string): string => {
    if (term === "1") return "⊤";
    const lits: string[] = [];
    for (let i = 0; i < term.length; i++) {
      const idx = term.charCodeAt(i) - 65;
      const neg = term[i + 1] === "'";
      lits.push(literal(vars[idx], !neg));
      if (neg) i++;
    }
    return lits.length > 1 ? lits.join(" ∧ ") : lits[0];
  };
  const terms = m.terms.map(render);
  const expr = terms.length > 1 ? terms.map((t) => (t.includes("∧") ? `(${t})` : t)).join(" ∨ ") : terms[0];
  const note = `${m.literals} literal${m.literals === 1 ? "" : "s"}${m.alternatives > 1 ? `; ${m.alternatives} equally minimal alternatives exist` : ""}${m.notes.length ? "; " + m.notes.join(" ") : ""}`;
  return { expr, note };
}

// ---------------------------------------------------------------------------
// Front door

const VERB_RE = /^(truth\s*table|table|dnf|cnf|simplify|minimi[sz]e|minimal|tautology\??|is\s+it\s+a\s+tautology\??|valid\??|satisfiable\??|sat\??|is\s+(?:this|it)\s+satisfiable\??|contradiction\??)\s*:?\s*/i;

export function tryPropLogic(input: string): DiscreteResult | null {
  const text = input.trim();
  if (!text || text.includes("\n")) return null;
  let body = text;
  let verb = "";
  const vm = VERB_RE.exec(body);
  if (vm) { verb = vm[1].toLowerCase().replace(/\s+|\?/g, ""); body = body.slice(vm[0].length).trim(); }
  // Not ours: automata keywords (a one-line regex carries |), and a weighted
  // or single directed edge line ("A->B 5"), which is the graph engine's.
  if (/^(?:regex|dfa|nfa|to\s+dfa|minimi[sz]e|equivalent)\b/i.test(text)) return null;
  if (/^[A-Za-z0-9_]+\s*(?:->|→|--?)\s*[A-Za-z0-9_]+\s+-?\d/.test(text)) return null;
  const strong = STRONG.test(body) || verb !== "";
  // Without a strong symbol, "and"/"or"/"not" in prose must not be mistaken
  // for a formula: a parse failure then simply declines the input.
  const weak = /\b(and|or|not|implies|iff)\b/i.test(body);
  if (!strong && !weak) return null;

  try {
    // Entailment: premises ⊢ conclusion (one turnstile; premises comma-separated).
    const toks = tokenize(body);
    const turn = toks.filter((t) => t.t === "turnstile");
    if (turn.length > 1) throw new DiscreteError("Only one ⊢ / |= per argument.");
    if (turn.length === 1) {
      const idx = turn[0].pos;
      const lhs = Array.from(body).slice(0, idx).join("");
      const rhs = Array.from(body).slice(idx + turn[0].s.length).join("");
      const premises = splitTopLevelCommas(lhs).map((s) => s.trim()).filter(Boolean).map(parseFormula);
      const conclusion = parseFormula(rhs);
      return entailment(premises, conclusion);
    }
    if (toks.some((t) => t.t === "comma")) throw new DiscreteError("Commas separate premises — add ⊢ (or |=) and a conclusion to make an argument.");
    const f = parseFormula(body);
    return analyse(f, verb);
  } catch (e) {
    if (e instanceof DiscreteError) {
      if (!strong) return null;
      throw e;
    }
    throw e;
  }
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function tableLines(rows: Row[], vars: string[], label: string, extra?: { label: string; values: boolean[] }[]): string[] {
  const lines: string[] = [];
  const header = [...vars, ...(extra ?? []).map((e) => e.label), label].join(" │ ");
  lines.push(header);
  lines.push("─".repeat(Math.min(header.length, 120)));
  const shown = rows.length <= 1 << TABLE_SHOWN_VARS ? rows : rows.slice(0, 1 << TABLE_SHOWN_VARS);
  shown.forEach((r, i) => {
    const cells = vars.map((v) => TF(r.env[v]));
    for (const e of extra ?? []) cells.push(TF(e.values[i]));
    cells.push(TF(r.value));
    lines.push(cells.map((c, j) => c.padStart(j < vars.length ? vars[j].length : (extra ?? [])[j - vars.length]?.label.length ?? label.length).padEnd(j < vars.length ? vars[j].length : (extra ?? [])[j - vars.length]?.label.length ?? label.length)).join(" │ "));
  });
  if (rows.length > shown.length) lines.push(`… ${rows.length - shown.length} more rows not listed (the counts above cover all ${rows.length}).`);
  return lines;
}

function analyse(f: Formula, verb: string): DiscreteResult {
  const vars = variablesOf(f);
  if (vars.length > MAX_VARS) throw new DiscreteError(`${vars.length} variables is above the ${MAX_VARS}-variable cap (${2 ** vars.length} rows).`);
  const rows = truthRows(f, vars);
  const trues = rows.filter((r) => r.value).length;
  const kind = trues === rows.length ? "tautology" : trues === 0 ? "contradiction" : "contingent";
  const rendered = show(f);
  const display: string[] = [];
  const steps: string[] = [];
  const caveats: string[] = [];
  const isEquiv = f.k === "bin" && f.op === "equiv";
  let title = "Truth table";
  if (isEquiv) {
    title = "Equivalence";
    display.push(`${show((f as Extract<Formula, { k: "bin" }>).a)}  and  ${show((f as Extract<Formula, { k: "bin" }>).b)}`);
    display.push(kind === "tautology" ? "EQUIVALENT: the two formulas agree on every row." : `NOT equivalent: they differ on ${rows.length - trues} of ${rows.length} rows.`);
    if (kind !== "tautology") {
      const bad = rows.find((r) => !r.value) as Row;
      display.push(`Differ at ${vars.map((v) => `${v} = ${TF(bad.env[v])}`).join(", ")}.`);
    }
  } else {
    display.push(rendered);
    display.push(
      kind === "tautology" ? `TAUTOLOGY — true in all ${rows.length} rows.` :
      kind === "contradiction" ? `CONTRADICTION — false in all ${rows.length} rows (unsatisfiable).` :
      `CONTINGENT — true in ${trues} of ${rows.length} rows (satisfiable, not valid).`,
    );
    if (verb === "tautology" || verb === "valid") display.push(kind === "tautology" ? "Yes: it is a tautology." : "No: it is not a tautology.");
    if (verb === "satisfiable" || verb === "sat") display.push(kind === "contradiction" ? "No: it is unsatisfiable." : "Yes: it is satisfiable.");
    if (verb === "contradiction") display.push(kind === "contradiction" ? "Yes: it is a contradiction." : "No: it is not a contradiction.");
    if (kind === "contingent" && trues <= 8) {
      display.push(`Satisfying assignments: ${rows.filter((r) => r.value).map((r) => vars.map((v) => `${v}=${TF(r.env[v])}`).join(" ")).join("; ")}.`);
    }
  }
  if (!vars.length) caveats.push("No variables: the formula is a constant.");
  if (verb === "dnf" || verb === "cnf" || verb === "simplify" || verb === "minimise" || verb === "minimize" || verb === "minimal") {
    title = verb === "dnf" ? "Disjunctive normal form" : verb === "cnf" ? "Conjunctive normal form" : "Minimal form";
  }
  // The table.
  steps.push(...tableLines(rows, vars, isEquiv ? "↔" : "value"));
  // Normal forms, always available from the table.
  if (vars.length && !isEquiv) {
    steps.push(`DNF (from the true rows): ${dnfOf(rows, vars)}`);
    steps.push(`CNF (from the false rows): ${cnfOf(rows, vars)}`);
    const wantsMin = verb === "simplify" || verb === "minimise" || verb === "minimize" || verb === "minimal";
    const min = vars.length <= 7 || wantsMin ? minimalDnf(rows, vars) : null;
    if (!min && vars.length > 7 && kind === "contingent") {
      steps.push(`Minimal DNF: skipped above 7 variables (Quine–McCluskey over ${trues} minterms takes seconds) — write "simplify …" to run it.`);
    }
    if (min) {
      steps.push(`Minimal DNF (Quine–McCluskey): ${min.expr}  — ${min.note}`);
      if (verb === "simplify" || verb === "minimise" || verb === "minimize" || verb === "minimal") display.push(`Simplest sum of products: ${min.expr}`);
      // Cross-check: the minimal form must have the same table.
      try {
        const g = parseFormula(min.expr.replace(/⊤/g, "true"));
        const same = rows.every((r) => evaluate(g, r.env) === r.value);
        if (!same) caveats.push("CROSS-CHECK FAILED: the minimised form does not match the table — a defect in this tool.");
        else steps.push("Verified: the minimal form has the same truth table.");
      } catch {
        caveats.push("The minimal form could not be re-parsed for checking.");
      }
    } else if (kind === "tautology") {
      if (verb === "simplify" || verb === "minimise" || verb === "minimize" || verb === "minimal") display.push("Simplest form: ⊤ (always true).");
    } else if (kind === "contradiction") {
      if (verb === "simplify" || verb === "minimise" || verb === "minimize" || verb === "minimal") display.push("Simplest form: ⊥ (always false).");
    }
    if (verb === "dnf") display.push(`DNF: ${dnfOf(rows, vars)}`);
    if (verb === "cnf") display.push(`CNF: ${cnfOf(rows, vars)}`);
  }
  caveats.push("Propositional logic only: the table is a complete decision procedure here. Quantifiers (∀, ∃) are not read.");
  return { title, display, steps, caveats };
}

function entailment(premises: Formula[], conclusion: Formula): DiscreteResult {
  const vars: string[] = [];
  for (const p of premises) variablesOf(p, vars);
  variablesOf(conclusion, vars);
  if (vars.length > MAX_VARS) throw new DiscreteError(`${vars.length} variables is above the ${MAX_VARS}-variable cap.`);
  const rows = truthRows(conclusion, vars);
  const premVals = premises.map((p) => rows.map((r) => evaluate(p, r.env)));
  const counter: number[] = [];
  rows.forEach((r, i) => { if (premVals.every((pv) => pv[i]) && !r.value) counter.push(i); });
  const valid = counter.length === 0;
  const display = [
    `${premises.map((p) => show(p)).join(", ")} ⊢ ${show(conclusion)}`,
    valid ? "VALID: in every row where all premises are true, the conclusion is true." : `INVALID: ${counter.length} counterexample row${counter.length === 1 ? "" : "s"}.`,
  ];
  if (!valid) {
    const r = rows[counter[0]];
    display.push(`Counterexample: ${vars.map((v) => `${v} = ${TF(r.env[v])}`).join(", ")} — all premises true, conclusion false.`);
  }
  const steps = tableLines(rows, vars, "conclusion", premises.map((p, i) => ({ label: `P${i + 1}`, values: premVals[i] })));
  const caveats = ["Entailment is checked semantically (every row), which is complete for propositional logic; no proof is constructed."];
  if (!premises.length) caveats.push("No premises: this asks whether the conclusion is a tautology.");
  return { title: "Entailment", display, steps, caveats };
}
