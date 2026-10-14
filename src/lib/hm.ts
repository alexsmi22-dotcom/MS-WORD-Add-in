/**
 * Hindley–Milner type inference with let-polymorphism — Algorithm W with a
 * numbered step log, for the λ kind's `hm` verb (v2.133.0,
 * docs/SCOPE-COMPUTATION-THEORY.md §B "HM", §C.7, §E.3/4/9/13/14).
 *
 * WHAT THIS IS. The λ kind's `type` verb gives the principal SIMPLE type of a
 * term (`principalType` in lambda.ts: unification with the occurs check, →
 * only). Hindley–Milner adds `let`: a let-bound name is GENERALISED over the
 * type variables that are not free in the environment Γ, and every use
 * INSTANTIATES the scheme afresh, so `let id = λx.x in (id 1, id true)` types
 * as int × bool while `(λid. (id 1, id true)) (λx.x)` does not — a λ-bound
 * name has ONE type (rank-1, monomorphic). `let rec` is typed by monomorphic
 * recursion: the name has a plain type variable while its own body is typed,
 * and is generalised only afterwards.
 *
 * The hm reader is a SEPARATE grammar: besides λ-terms it reads `let NAME =
 * term in term`, `let rec`, integer literals (`1 : int`), `true`/`false`
 * (`: bool`), pairs `(e, e) : τ × τ` with `fst`/`snd`, and `if c then a else
 * b`. The λ kind's reducer never sees these forms — hm is a typing verb, and
 * under the `type` verb `1` is still the Church numeral (each verb says so,
 * §E.14). Library names (PLUS, PAIR, …) and `let` definitions on earlier
 * lines keep their λ-types: each is typed from its expanded λ-term and
 * generalised, so `let id = λx.x ⏎ hm (id 1, id true)` is polymorphic too.
 *
 * VERIFICATION (§E.13 — not optional). Two independent checks, both run:
 *   1. The final substitution is applied to EVERY node and each node is
 *      re-checked syntactically: an application `f a` needs f : τ₁ → τ₂ and
 *      a : τ₁; a λ gives an arrow; an `if` has a bool condition and equal
 *      branches; a variable's type is an instance of the scheme it was taken
 *      from. A node that fails is a defect in W, and the result is REFUSED.
 *   2. For pure λ-terms (no literals, pairs, if, fst/snd, let rec) every
 *      `let` is expanded by capture-avoiding substitution (lambda.ts's
 *      `substitute`) and the EXISTING `principalType` is run on the result:
 *      the two must print the same type (let-polymorphic typing of a term is
 *      simple typing of its expansion when the bound name is used — Milner).
 *      When a let-bound name is unused the expansion drops its value, so the
 *      check is one-way and says so. A disagreement is refused, not printed.
 *
 * Caps (the λ kind's, checked before any walker): MAX_PARSE_DEPTH while
 * reading, MAX_TERM_DEPTH / MAX_TERM_SIZE straight after the parse,
 * MAX_TYPE_WORK for unification/resolution steps, MAX_TYPE_TEXT for printing,
 * and the expansion for check 2 is skipped (said) when it would exceed the
 * size or depth cap — `let a₂ = a₁ a₁ in let a₃ = a₂ a₂ in …` doubles per level.
 *
 * Naming: type variables are α β γ δ ε ζ η θ ι κ then τ₁ τ₂ …, named in
 * order of first appearance in the FINAL type (lambda.ts's convention), then
 * in order of creation for the variables that appear only in the log — so the
 * α of the log is the α of the answer. A scheme's bound variables are its
 * own, and the `Scheme:` lines print them canonically (∀α. α → α), avoiding
 * the names of any free variable from Γ (`∀β. β → α` under λy with y : α).
 */

import {
  Term, v, lam, app, show, substitute, freeVars, termSize, termDepth, principalType, TypeTooLarge, LambdaSyntaxError,
  MAX_TERM_DEPTH, MAX_TERM_SIZE, MAX_TYPE_WORK, MAX_TYPE_TEXT, MAX_PARSE_DEPTH, LAMBDA_GLYPHS, IDENT_START, IDENT_CHAR,
} from "./lambda";
import { treeSvg, TreeNode, TreeEdge } from "./treeSvg";

// ---------------------------------------------------------------------------
// Terms of the hm reader

export type HTerm =
  | { kind: "var"; name: string }
  | { kind: "lam"; param: string; body: HTerm }
  | { kind: "app"; fn: HTerm; arg: HTerm }
  | { kind: "let"; name: string; rec: boolean; value: HTerm; body: HTerm }
  | { kind: "lit"; value: number | boolean }
  | { kind: "pair"; a: HTerm; b: HTerm }
  | { kind: "if"; c: HTerm; a: HTerm; b: HTerm };

/** Nodes drawn in the derivation tree at most (§B: "for ≤ 20 nodes"). */
export const MAX_TREE_NODES = 20;
/** Digits an integer literal may have: the label must print exactly. */
const MAX_LITERAL_DIGITS = 15;

const KEYWORDS = new Set(["let", "rec", "in", "if", "then", "else", "true", "false"]);

interface Tok { t: "lam" | "dot" | "lp" | "rp" | "comma" | "eq" | "id" | "num" | "kw"; s: string; pos: number }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const chars = Array.from(src);
  let i = 0;
  const isDigit = (c: string): boolean => c >= "0" && c <= "9";
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/u.test(c)) { i++; continue; }
    if (LAMBDA_GLYPHS.has(c)) { toks.push({ t: "lam", s: c, pos: i }); i++; continue; }
    if (c === ".") { toks.push({ t: "dot", s: c, pos: i }); i++; continue; }
    if (c === "(") { toks.push({ t: "lp", s: c, pos: i }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", s: c, pos: i }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma", s: c, pos: i }); i++; continue; }
    if (c === "=") { toks.push({ t: "eq", s: c, pos: i }); i++; continue; }
    if (c === ":" && chars[i + 1] === "=") { toks.push({ t: "eq", s: ":=", pos: i }); i += 2; continue; }
    if (isDigit(c)) {
      let j = i;
      while (j < chars.length && isDigit(chars[j])) j++;
      const s = chars.slice(i, j).join("");
      if (s.length > MAX_LITERAL_DIGITS) throw new LambdaSyntaxError(`${s} has more than ${MAX_LITERAL_DIGITS} digits; an int literal under hm is only a label, but it must print exactly.`);
      toks.push({ t: "num", s, pos: i });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i;
      while (j < chars.length && IDENT_CHAR.test(chars[j])) j++;
      const word = chars.slice(i, j).join("");
      if (word === "lambda") toks.push({ t: "lam", s: word, pos: i });
      else if (KEYWORDS.has(word)) toks.push({ t: "kw", s: word, pos: i });
      else toks.push({ t: "id", s: word, pos: i });
      i = j;
      continue;
    }
    if (c === "[" || c === "]") throw new LambdaSyntaxError(`Unexpected "${c}" at position ${i + 1}: list literals are not part of the hm reader (pairs are: (a, b)).`);
    throw new LambdaSyntaxError(`Unexpected character "${c}" at position ${i + 1}.`);
  }
  return toks;
}

/**
 * The hm grammar (recursive descent with the λ kind's parse-depth cap):
 *   term := 'let' ['rec'] NAME '=' term 'in' term | 'if' term 'then' term 'else' term
 *         | λ ids '.' term | application
 *   application := atom atom*
 *   atom := NAME | NUM | 'true' | 'false' | '(' term [',' term] ')' | let | if | λ
 */
export function parseHM(src: string): HTerm {
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = (): Tok | undefined => toks[p];
  const next = (): Tok => {
    const t = toks[p++];
    if (!t) throw new LambdaSyntaxError("The term ends too early.");
    return t;
  };
  const enter = (): void => {
    if (++depth > MAX_PARSE_DEPTH) throw new LambdaSyntaxError(`Binders, lets and parentheses nested deeper than ${MAX_PARSE_DEPTH}.`);
  };
  const isKw = (t: Tok | undefined, k: string): boolean => !!t && t.t === "kw" && t.s === k;
  const expectKw = (k: string, what: string): void => {
    const t = peek();
    if (!isKw(t, k)) throw new LambdaSyntaxError(t ? `Expected "${k}" ${what}, found "${t.s}" at position ${t.pos + 1}.` : `Expected "${k}" ${what}, but the term ended.`);
    next();
  };
  const parseTermH = (): HTerm => {
    const t = peek();
    if (!t) throw new LambdaSyntaxError("The term ends too early.");
    if (isKw(t, "let")) {
      next();
      enter();
      let rec = false;
      if (isKw(peek(), "rec")) { next(); rec = true; }
      const n = peek();
      if (!n || n.t !== "id") throw new LambdaSyntaxError(n ? `let needs a name, found "${n.s}" at position ${n.pos + 1}.` : "let needs a name.");
      next();
      const e = peek();
      if (!e || e.t !== "eq") throw new LambdaSyntaxError(`Expected "=" after let ${n.s}${e ? `, found "${e.s}" at position ${e.pos + 1}` : ""}.`);
      next();
      const value = parseTermH();
      expectKw("in", `after let ${n.s} = …`);
      const body = parseTermH();
      depth--;
      return { kind: "let", name: n.s, rec, value, body };
    }
    if (isKw(t, "if")) {
      next();
      enter();
      const c = parseTermH();
      expectKw("then", "after if …");
      const a = parseTermH();
      expectKw("else", "after then …");
      const b = parseTermH();
      depth--;
      return { kind: "if", c, a, b };
    }
    if (t.t === "lam") {
      next();
      enter();
      const params: string[] = [];
      while (peek()?.t === "id") params.push(next().s);
      if (params.length === 0) throw new LambdaSyntaxError("λ must be followed by a variable name.");
      const dot = peek();
      if (!dot || dot.t !== "dot") throw new LambdaSyntaxError(`Expected "." after λ${params.join(" ")}.`);
      next();
      let body = parseTermH();
      depth--;
      for (let i = params.length - 1; i >= 0; i--) body = { kind: "lam", param: params[i], body };
      return body;
    }
    return parseApplication();
  };
  const parseAtom = (): HTerm | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === "id") { next(); return { kind: "var", name: t.s }; }
    if (t.t === "num") { next(); return { kind: "lit", value: Number(t.s) }; }
    if (isKw(t, "true") || isKw(t, "false")) { next(); return { kind: "lit", value: t.s === "true" }; }
    if (isKw(t, "let") || isKw(t, "if") || t.t === "lam") return parseTermH();
    if (t.t === "lp") {
      next();
      enter();
      const a = parseTermH();
      let out: HTerm = a;
      if (peek()?.t === "comma") {
        next();
        const b = parseTermH();
        out = { kind: "pair", a, b };
        if (peek()?.t === "comma") throw new LambdaSyntaxError(`A pair has two components (the "(" at position ${t.pos + 1}): write (a, (b, c)) for a triple.`);
      }
      const close = peek();
      if (!close || close.t !== "rp") throw new LambdaSyntaxError(`Missing ")" for the "(" at position ${t.pos + 1}.`);
      next();
      depth--;
      return out;
    }
    return null;
  };
  const parseApplication = (): HTerm => {
    const first = parseAtom();
    if (!first) {
      const t = peek();
      throw new LambdaSyntaxError(t ? `Unexpected "${t.s}" at position ${t.pos + 1}.` : "The term ends too early.");
    }
    let acc = first;
    for (;;) {
      const t = peek();
      if (!t || t.t === "rp" || t.t === "dot" || t.t === "comma" || t.t === "eq") break;
      if (t.t === "kw" && (t.s === "in" || t.s === "then" || t.s === "else")) break;
      const a = parseAtom();
      if (!a) break;
      acc = { kind: "app", fn: acc, arg: a };
    }
    return acc;
  };
  const term = parseTermH();
  const rest = peek();
  if (rest) throw new LambdaSyntaxError(`Unexpected "${rest.s}" at position ${rest.pos + 1}.`);
  return term;
}

function childrenOf(t: HTerm): HTerm[] {
  switch (t.kind) {
    case "var": case "lit": return [];
    case "lam": return [t.body];
    case "app": return [t.fn, t.arg];
    case "let": return [t.value, t.body];
    case "pair": return [t.a, t.b];
    case "if": return [t.c, t.a, t.b];
  }
}

/** Depth and size, WITHOUT recursion (the check that guards the walkers). */
export function htermMeasure(t: HTerm): { depth: number; size: number } {
  let depth = 0;
  let size = 0;
  const stack: [HTerm, number][] = [[t, 1]];
  while (stack.length) {
    const [u, d] = stack.pop() as [HTerm, number];
    size++;
    if (d > depth) depth = d;
    for (const c of childrenOf(u)) stack.push([c, d + 1]);
  }
  return { depth, size };
}

/** Minimal parentheses; what is displayed parses back to the same term. */
export function showH(t: HTerm): string {
  const go = (u: HTerm, ctx: "top" | "fn" | "arg"): string => {
    switch (u.kind) {
      case "var": return u.name;
      case "lit": return String(u.value);
      case "pair": return `(${go(u.a, "top")}, ${go(u.b, "top")})`;
      case "lam": { const s = `λ${u.param}.${go(u.body, "top")}`; return ctx === "top" ? s : `(${s})`; }
      case "let": { const s = `let ${u.rec ? "rec " : ""}${u.name} = ${go(u.value, "top")} in ${go(u.body, "top")}`; return ctx === "top" ? s : `(${s})`; }
      case "if": { const s = `if ${go(u.c, "top")} then ${go(u.a, "top")} else ${go(u.b, "top")}`; return ctx === "top" ? s : `(${s})`; }
      case "app": { const s = `${go(u.fn, "fn")} ${go(u.arg, "arg")}`; return ctx === "arg" ? `(${s})` : s; }
    }
  };
  return go(t, "top");
}

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Does the line read `let [rec] NAME = … in …` with the `in` at parenthesis
 * depth 0 and followed by whitespace? That is a Hindley–Milner expression,
 * not a definition line — it must be recognised BEFORE `DEF_RE` (§E.3).
 */
export function isLetIn(text: string): boolean {
  const m = /^let\s+(?:rec\s+)?[A-Za-z_α-κμ-ωΑ-ΚΜ-Ω][A-Za-z0-9_'′₀-₉α-κμ-ωΑ-ΚΜ-Ω]*\s*(?::=|=)\s*(.*)$/u.exec(text);
  if (!m) return false;
  const rest = m[1];
  let depth = 0;
  const re = /\(|\)|(?<![A-Za-z0-9_'′₀-₉α-κμ-ωΑ-ΚΜ-Ω])in(?=\s)/gu;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(rest))) {
    if (hit[0] === "(") depth++;
    else if (hit[0] === ")") depth--;
    else if (depth === 0 && rest.slice(0, hit.index).trim().length > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Types and schemes

export type HTy =
  | { k: "var"; id: number }
  | { k: "arrow"; from: HTy; to: HTy }
  | { k: "con"; name: "int" | "bool" }
  | { k: "pair"; a: HTy; b: HTy };

export interface Scheme { vars: number[]; ty: HTy }

const INT: HTy = { k: "con", name: "int" };
const BOOL: HTy = { k: "con", name: "bool" };
const arrow = (from: HTy, to: HTy): HTy => ({ k: "arrow", from, to });
const pairTy = (a: HTy, b: HTy): HTy => ({ k: "pair", a, b });

const GREEK = "αβγδεζηθικ";
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const toSubscript = (n: number): string => String(n).split("").map((d) => SUBSCRIPT_DIGITS[Number(d)]).join("");
const nthName = (i: number): string => (i < GREEK.length ? GREEK[i] : `τ${toSubscript(i - GREEK.length + 1)}`);

/** Printer: → right-associative, × binds tighter than →, nested pairs parenthesised. */
export function showTy(ty: HTy, nm: (id: number) => string, budget = { n: 0 }): string {
  const go = (t: HTy, ctx: "top" | "arrowLeft" | "pairPart"): string => {
    if (++budget.n > MAX_TYPE_TEXT) throw new TypeTooLarge();
    switch (t.k) {
      case "var": return nm(t.id);
      case "con": return t.name;
      case "arrow": { const s = `${go(t.from, "arrowLeft")} → ${go(t.to, "top")}`; return ctx === "top" ? s : `(${s})`; }
      case "pair": { const s = `${go(t.a, "pairPart")} × ${go(t.b, "pairPart")}`; return ctx === "pairPart" ? `(${s})` : s; }
    }
  };
  return go(ty, "top");
}

function tyVarsInOrder(ty: HTy, out: number[] = []): number[] {
  switch (ty.k) {
    case "var": if (!out.includes(ty.id)) out.push(ty.id); return out;
    case "con": return out;
    case "arrow": tyVarsInOrder(ty.from, out); return tyVarsInOrder(ty.to, out);
    case "pair": tyVarsInOrder(ty.a, out); return tyVarsInOrder(ty.b, out);
  }
}

/** `∀α β. body` with the bound variables renamed canonically, dodging the
 *  names of the scheme's free variables (which print under `nm`). */
export function showScheme(s: Scheme, nm: (id: number) => string): string {
  if (s.vars.length === 0) return showTy(s.ty, nm);
  const { order, nm2 } = schemeNaming(s, nm);
  return `∀${order.map(nm2).join(" ")}. ${showTy(s.ty, nm2)}`;
}

function schemeNaming(s: Scheme, nm: (id: number) => string): { order: number[]; nm2: (id: number) => string } {
  const bound = new Set(s.vars);
  const order = tyVarsInOrder(s.ty).filter((id) => bound.has(id));
  const taken = new Set(tyVarsInOrder(s.ty).filter((id) => !bound.has(id)).map(nm));
  const local = new Map<number, string>();
  let i = 0;
  for (const id of order) {
    let name = nthName(i++);
    while (taken.has(name)) name = nthName(i++);
    local.set(id, name);
  }
  return { order, nm2: (id: number): string => local.get(id) ?? nm(id) };
}

/** The same scheme under ONE global naming (for the step log, where "γ is
 *  not free in Γ" must name the γ of the scheme beside it). */
function showSchemeGlobal(s: Scheme, nm: (id: number) => string): string {
  if (s.vars.length === 0) return showTy(s.ty, nm);
  const bound = new Set(s.vars);
  const order = tyVarsInOrder(s.ty).filter((id) => bound.has(id));
  return `∀${order.map(nm).join(" ")}. ${showTy(s.ty, nm)}`;
}

/**
 * Reads a type or a scheme as the printer writes it (`∀α β. (α → β) × γ`,
 * also `forall a b.`, `->`, `*`), so a printed scheme re-parses — the
 * display contract. Variable ids are assigned in order of first appearance;
 * `names[id]` is the name read.
 */
export function parseScheme(src: string, names: string[] = []): { vars: number[]; ty: HTy; names: string[] } {
  const s = src.trim();
  const idOf = (name: string): number => {
    let i = names.indexOf(name);
    if (i < 0) { i = names.length; names.push(name); }
    return i;
  };
  const toks: { t: string; s: string }[] = [];
  const chars = Array.from(s);
  for (let i = 0; i < chars.length;) {
    const c = chars[i];
    if (/\s/u.test(c)) { i++; continue; }
    if (c === "∀") { toks.push({ t: "forall", s: c }); i++; continue; }
    if (c === "." ) { toks.push({ t: "dot", s: c }); i++; continue; }
    if (c === "," ) { i++; continue; }
    if (c === "(") { toks.push({ t: "lp", s: c }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", s: c }); i++; continue; }
    if (c === "→") { toks.push({ t: "arrow", s: c }); i++; continue; }
    if (c === "-" && chars[i + 1] === ">") { toks.push({ t: "arrow", s: "->" }); i += 2; continue; }
    if (c === "×" || c === "*") { toks.push({ t: "times", s: c }); i++; continue; }
    if (IDENT_START.test(c)) {
      let j = i;
      while (j < chars.length && IDENT_CHAR.test(chars[j])) j++;
      const w = chars.slice(i, j).join("");
      toks.push({ t: w === "forall" ? "forall" : w === "int" || w === "bool" ? "con" : "id", s: w });
      i = j;
      continue;
    }
    throw new LambdaSyntaxError(`Unexpected character "${c}" in the type at position ${i + 1}.`);
  }
  let p = 0;
  const peek = (): { t: string; s: string } | undefined => toks[p];
  const vars: number[] = [];
  if (peek()?.t === "forall") {
    p++;
    while (peek()?.t === "id") vars.push(idOf(toks[p++].s));
    if (peek()?.t !== "dot") throw new LambdaSyntaxError('Expected "." after the ∀ variables.');
    p++;
  }
  const parseTy = (): HTy => {
    const left = parsePair();
    if (peek()?.t === "arrow") { p++; return arrow(left, parseTy()); }
    return left;
  };
  const parsePair = (): HTy => {
    let t = parseAtom();
    while (peek()?.t === "times") { p++; t = pairTy(t, parseAtom()); }
    return t;
  };
  const parseAtom = (): HTy => {
    const t = peek();
    if (!t) throw new LambdaSyntaxError("The type ends too early.");
    p++;
    if (t.t === "id") return { k: "var", id: idOf(t.s) };
    if (t.t === "con") return t.s === "int" ? INT : BOOL;
    if (t.t === "lp") {
      const inner = parseTy();
      if (peek()?.t !== "rp") throw new LambdaSyntaxError('Missing ")" in the type.');
      p++;
      return inner;
    }
    throw new LambdaSyntaxError(`Unexpected "${t.s}" in the type.`);
  };
  const ty = parseTy();
  if (peek()) throw new LambdaSyntaxError(`Unexpected "${peek()!.s}" after the type.`);
  return { vars, ty, names };
}

/** Is `ty` an instance of `scheme` (bound variables consistently replaced,
 *  free variables equal)? Pure structural matching, no state. */
export function isInstance(scheme: Scheme, ty: HTy): boolean {
  const bound = new Set(scheme.vars);
  const assign = new Map<number, HTy>();
  const eq = (a: HTy, b: HTy): boolean => {
    if (a.k !== b.k) return false;
    switch (a.k) {
      case "var": return a.id === (b as { id: number }).id;
      case "con": return a.name === (b as { name: string }).name;
      case "arrow": return eq(a.from, (b as { from: HTy }).from) && eq(a.to, (b as { to: HTy }).to);
      case "pair": return eq(a.a, (b as { a: HTy }).a) && eq(a.b, (b as { b: HTy }).b);
    }
  };
  const match = (pat: HTy, t: HTy): boolean => {
    if (pat.k === "var" && bound.has(pat.id)) {
      const seen = assign.get(pat.id);
      if (seen) return eq(seen, t);
      assign.set(pat.id, t);
      return true;
    }
    if (pat.k !== t.k) return false;
    switch (pat.k) {
      case "var": return pat.id === (t as { id: number }).id;
      case "con": return pat.name === (t as { name: string }).name;
      case "arrow": return match(pat.from, (t as { from: HTy }).from) && match(pat.to, (t as { to: HTy }).to);
      case "pair": return match(pat.a, (t as { a: HTy }).a) && match(pat.b, (t as { b: HTy }).b);
    }
  };
  return match(scheme.ty, ty);
}

// ---------------------------------------------------------------------------
// Algorithm W

export interface HMContext {
  /** Expands library names and earlier-line definitions in a λ-term (capture-avoiding). */
  expand: (t: Term) => Term;
  /** The expanded λ-term of a library name or earlier-line definition, or null. */
  defTerm: (name: string) => Term | null;
}

export interface HMOutcome {
  shown: string;
  display: string[];
  steps: string[];
  caveats: string[];
  /** The inferred type (canonical names), or null when not typable / too large. */
  type: string | null;
  /** The term's own scheme, when its type has variables. */
  scheme?: string;
  /** `name : scheme` for every let-bound name, in order. */
  letSchemes: { name: string; scheme: string }[];
  svg?: string;
  /** The pure-λ expansion (lets substituted, library expanded) when one exists. */
  expansion: Term | null;
  /** Set when a cross-check disagreed: the caller must REFUSE, not print. */
  defect?: string;
}

interface EnvEntry { scheme: Scheme; origin: "lam" | "let" | "letrec" | "def" | "builtin"; redexArg?: string; lamBody?: string }
type Env = Map<string, EnvEntry>;

class Occurs { constructor(public id: number, public ty: HTy) {} }
class Clash { constructor(public a: HTy, public b: HTy) {} }
/** A typing failure with its message (a RESULT, not an exception, at the front door). */
class HMFail {
  /** The message is rendered with the FINAL naming (creation order on failure), so it is kept lazy. */
  constructor(public render: (n: (id: number) => string) => string, public kind: "occurs" | "clash" | "unbound" | "def", public hint = "") {}
}
class ExpansionTooBig { constructor(public why: string) {} }

// Bound variables of the builtin schemes carry NEGATIVE ids: the inference
// counter starts at 0, so they can never collide with a variable in the
// substitution (ids 0 and 1 did — check 1 caught `snd (fst ((1, true), 2), λx.x)`).
const A: HTy = { k: "var", id: -1 };
const B: HTy = { k: "var", id: -2 };
const BUILTINS = new Map<string, Scheme>([
  ["fst", { vars: [-1, -2], ty: arrow(pairTy(A, B), A) }],
  ["snd", { vars: [-1, -2], ty: arrow(pairTy(A, B), B) }],
]);

const TERM_CUT = 60;
/** The λ kind's step elision (lambda.ts STEP_LINES_SHOWN). */
export const STEP_LINES_SHOWN = 40;
const MAX_INSTANCE_LINES = 8;
const MAX_INSTANCES_PER_NAME = 6;

/** Runs Algorithm W on a term of the hm reader. Never throws for a typing
 *  failure (that is a result); throws LambdaSyntaxError for a cap hit before
 *  the work, TypeTooLarge is caught and reported. */
export function solveHM(term: HTerm, ctx: HMContext): HMOutcome {
  const { depth, size } = htermMeasure(term);
  if (depth > MAX_TERM_DEPTH) throw new LambdaSyntaxError(`the term as written nests ${depth} deep, above the ${MAX_TERM_DEPTH}-deep cap.`);
  if (size > MAX_TERM_SIZE) throw new LambdaSyntaxError(`the term as written has ${size} nodes, above the ${MAX_TERM_SIZE}-node cap.`);

  // --- state ---------------------------------------------------------------
  let counter = 0;
  let work = 0;
  const spend = (): void => { if (++work > MAX_TYPE_WORK) throw new TypeTooLarge(); };
  const fresh = (): HTy & { k: "var" } => ({ k: "var", id: counter++ });
  const subst = new Map<number, HTy>();
  const prune = (ty: HTy): HTy => {
    while (ty.k === "var" && subst.has(ty.id)) { spend(); ty = subst.get(ty.id) as HTy; }
    return ty;
  };
  const zonk = (ty: HTy): HTy => {
    spend();
    ty = prune(ty);
    switch (ty.k) {
      case "var": case "con": return ty;
      case "arrow": return arrow(zonk(ty.from), zonk(ty.to));
      case "pair": return pairTy(zonk(ty.a), zonk(ty.b));
    }
  };
  const freeTyVars = (ty: HTy, out = new Set<number>()): Set<number> => {
    spend();
    ty = prune(ty);
    switch (ty.k) {
      case "var": out.add(ty.id); return out;
      case "con": return out;
      case "arrow": freeTyVars(ty.from, out); return freeTyVars(ty.to, out);
      case "pair": freeTyVars(ty.a, out); return freeTyVars(ty.b, out);
    }
  };
  const occurs = (id: number, ty: HTy): boolean => {
    spend();
    ty = prune(ty);
    switch (ty.k) {
      case "var": return ty.id === id;
      case "con": return false;
      case "arrow": return occurs(id, ty.from) || occurs(id, ty.to);
      case "pair": return occurs(id, ty.a) || occurs(id, ty.b);
    }
  };
  let bindings: number[] = [];
  const bind = (id: number, ty: HTy): void => { subst.set(id, ty); bindings.push(id); };
  const unify = (a: HTy, b: HTy): void => {
    spend();
    a = prune(a);
    b = prune(b);
    if (a.k === "var" && b.k === "var" && a.id === b.id) return;
    if (a.k === "var") { if (occurs(a.id, b)) throw new Occurs(a.id, b); bind(a.id, b); return; }
    if (b.k === "var") { if (occurs(b.id, a)) throw new Occurs(b.id, a); bind(b.id, a); return; }
    if (a.k === "con" && b.k === "con") { if (a.name !== b.name) throw new Clash(a, b); return; }
    if (a.k === "arrow" && b.k === "arrow") { unify(a.from, b.from); unify(a.to, b.to); return; }
    if (a.k === "pair" && b.k === "pair") { unify(a.a, b.a); unify(a.b, b.b); return; }
    throw new Clash(a, b);
  };

  // --- naming (decided at the end; log lines are rendered then) -------------
  const names = new Map<number, string>();
  const nm = (id: number): string => {
    let s = names.get(id);
    if (!s) { s = nthName(names.size); names.set(id, s); }
    return s;
  };
  type Render = (nm: (id: number) => string) => string;
  const log: Render[] = [];
  let quiet = 0; // > 0 while a library/definition term is typed (its steps are not the user's)
  const say = (r: Render): void => { if (!quiet) log.push(r); };
  const T = (ty: HTy): ((nm: (id: number) => string) => string) => { const z = zonk(ty); return (n) => showTy(z, n); };

  /** unify with the log line `unify A with B ⇒ {…}`; failures carry `where`. */
  const unifyLogged = (a: HTy, b: HTy, where: string, label?: string): void => {
    const sa = T(a);
    const sb = T(b);
    bindings = [];
    try {
      unify(a, b);
      const made = bindings.map((id) => [id, zonk(subst.get(id) as HTy)] as const);
      say((n) => `unify ${sa(n)} with ${sb(n)}${label ? ` (${label})` : ""} ⇒ ${made.length ? `{${made.map(([id, ty]) => `${n(id)} ↦ ${showTy(ty, n)}`).join(", ")}}` : "already equal"}`);
    } catch (e) {
      if (e instanceof Occurs) {
        const id = e.id;
        const z = zonk(e.ty);
        say((n) => `unify ${sa(n)} with ${sb(n)}${label ? ` (${label})` : ""} ⇒ FAILS: occurs check, ${n(id)} = ${showTy(z, n)}`);
        throw new HMFail((n) => `occurs check — ${n(id)} = ${showTy(z, n)} at ${where}`, "occurs");
      }
      if (e instanceof Clash) {
        const za = zonk(e.a);
        const zb = zonk(e.b);
        say((n) => `unify ${sa(n)} with ${sb(n)}${label ? ` (${label})` : ""} ⇒ FAILS: clash ${showTy(za, n)} ≠ ${showTy(zb, n)}`);
        throw new HMFail((n) => `clash ${showTy(za, n)} ≠ ${showTy(zb, n)} at ${where}`, "clash");
      }
      throw e;
    }
  };

  const instantiate = (s: Scheme, map = new Map<number, HTy>()): HTy => {
    if (s.vars.length === 0) return s.ty;
    for (const id of s.vars) map.set(id, fresh());
    const go = (t: HTy): HTy => {
      spend();
      t = prune(t);
      switch (t.k) {
        case "var": return map.get(t.id) ?? t;
        case "con": return t;
        case "arrow": return arrow(go(t.from), go(t.to));
        case "pair": return pairTy(go(t.a), go(t.b));
      }
    };
    return go(s.ty);
  };
  const freeInEnv = (env: Env): Set<number> => {
    const out = new Set<number>();
    for (const e of env.values()) {
      const fv = freeTyVars(e.scheme.ty);
      for (const id of e.scheme.vars) fv.delete(id);
      for (const id of fv) out.add(id);
    }
    return out;
  };
  const generalise = (ty: HTy, env: Env): Scheme => {
    const z = zonk(ty);
    const envFree = freeInEnv(env);
    const vars = tyVarsInOrder(z).filter((id) => !envFree.has(id));
    return { vars, ty: z };
  };

  // Library names and earlier-line definitions: typed from their λ-term once.
  const defCache = new Map<string, Scheme>();
  const defScheme = (name: string): EnvEntry | null => {
    const hit = defCache.get(name);
    if (hit) return { scheme: hit, origin: "def" };
    let t: Term | null;
    try {
      t = ctx.defTerm(name);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new HMFail(() => `${name} cannot be typed: ${why}`, "def");
    }
    if (!t) return null;
    const open = [...freeVars(t)];
    if (open.length) {
      const body = cut(show(t), TERM_CUT);
      throw new HMFail(() => `${name} is an open term (${open.join(", ")} free in ${body}), and under hm every name must be bound — bind ${open.join(", ")} with λ or let`, "def");
    }
    quiet++;
    let scheme: Scheme;
    try {
      const ty = infer(fromTerm(t), new Map());
      scheme = generalise(ty, new Map());
    } catch (e) {
      if (e instanceof HMFail) {
        const inner = e;
        throw new HMFail((n) => `${name} has no simple type (its λ-term ${cut(show(t as Term), TERM_CUT)}: ${inner.render(n)}), so it cannot be used under hm — the library names carry their λ-types`, "def");
      }
      throw e;
    } finally {
      quiet--;
    }
    defCache.set(name, scheme);
    say((n) => `${name} : ${showSchemeGlobal(scheme, n)} — typed from its λ-term ${cut(show(t as Term), TERM_CUT)}`);
    return { scheme, origin: "def" };
  };

  const nodeTypes = new Map<HTerm, HTy>();
  const nodeSchemes = new Map<HTerm, Scheme>();
  /** Every instantiation of a polymorphic name, for the "Instances of" line. */
  const uses: { name: string; scheme: Scheme; map: Map<number, HTy>; ty: HTy }[] = [];
  const letSchemes: { name: string; scheme: Scheme }[] = [];
  let usedBuiltin = false;
  let usedLetRec = false;

  const infer = (t: HTerm, env: Env, redexArg?: string): HTy => {
    const ty = inferInner(t, env, redexArg);
    nodeTypes.set(t, ty);
    return ty;
  };
  const inferInner = (t: HTerm, env: Env, redexArg?: string): HTy => {
    switch (t.kind) {
      case "var": {
        const builtin = BUILTINS.get(t.name);
        const e = env.get(t.name) ?? (builtin ? { scheme: builtin, origin: "builtin" as const } : null) ?? defScheme(t.name);
        if (!e) { const name = t.name; throw new HMFail(() => `unbound variable ${name} — under hm every name must be λ-bound, let-bound, or a library name (the type verb gives a free variable a fresh type variable instead)`, "unbound"); }
        if (e.origin === "builtin") usedBuiltin = true;
        nodeSchemes.set(t, e.scheme);
        const map = new Map<number, HTy>();
        const ty = instantiate(e.scheme, map);
        if (e.scheme.vars.length && !quiet) uses.push({ name: t.name, scheme: e.scheme, map, ty });
        if (e.scheme.vars.length) {
          const s = e.scheme;
          const inst = T(ty);
          say((n) => `instantiate ${t.name} : ${(e.origin === "builtin" ? showScheme : showSchemeGlobal)(s, n)} ↦ ${inst(n)}`);
        }
        return ty;
      }
      case "lam": {
        const a = fresh();
        const name = t.param;
        say((n) => `fresh ${n(a.id)} for λ-bound ${name} (monomorphic: one type for every use)`);
        const env2: Env = new Map(env);
        env2.set(name, { scheme: { vars: [], ty: a }, origin: "lam", redexArg, lamBody: showH(t.body) });
        const r = infer(t.body, env2);
        return arrow(a, r);
      }
      case "app": {
        const f = infer(t.fn, env, t.fn.kind === "lam" ? showH(t.arg) : undefined);
        const a = infer(t.arg, env);
        const r = fresh();
        try {
          unifyLogged(f, arrow(a, r), cut(showH(t), TERM_CUT));
        } catch (e) {
          if (e instanceof HMFail && !e.hint && t.fn.kind === "var") {
            const entry = env.get(t.fn.name);
            if (entry && entry.origin === "lam") {
              const f = t.fn.name;
              e.hint = entry.redexArg
                ? ` — ${f} is λ-bound, hence MONOMORPHIC; write let ${f} = ${entry.redexArg} in ${entry.lamBody} for polymorphism`
                : e.kind === "occurs"
                  ? ` — ${f} is λ-bound, hence MONOMORPHIC: one type at every use, so applying ${f} to itself needs a type containing itself (only a let-bound name is instantiated afresh at each use)`
                  : ` — ${f} is λ-bound, hence MONOMORPHIC; write let ${f} = … in … for polymorphism`;
            }
          }
          throw e;
        }
        return r;
      }
      case "let": {
        if (!t.rec) {
          const tv = infer(t.value, env);
          const s = generalise(tv, env);
          const name = t.name;
          if (s.vars.length) say((n) => `generalise ${name} : ${showSchemeGlobal(s, n)} — ${s.vars.map(n).join(", ")} ${s.vars.length === 1 ? "is" : "are"} not free in Γ`);
          else say((n) => `${name} : ${showTy(s.ty, n)} — no type variable to generalise${freeTyVars(s.ty).size ? " (every variable of its type is free in Γ)" : ""}`);
          letSchemes.push({ name, scheme: s });
          const env2: Env = new Map(env);
          env2.set(name, { scheme: s, origin: "let" });
          return infer(t.body, env2);
        }
        usedLetRec = true;
        const a = fresh();
        const name = t.name;
        say((n) => `let rec ${name}: ${name} : ${n(a.id)} while its own body is typed (monomorphic recursion — the name is generalised only afterwards)`);
        const env1: Env = new Map(env);
        env1.set(name, { scheme: { vars: [], ty: a }, origin: "letrec" });
        const tv = infer(t.value, env1);
        unifyLogged(a, tv, `let rec ${name} = ${cut(showH(t.value), TERM_CUT)}`, `${name} with its body`);
        const s = generalise(a, env);
        if (s.vars.length) say((n) => `generalise ${name} : ${showSchemeGlobal(s, n)} — ${s.vars.map(n).join(", ")} ${s.vars.length === 1 ? "is" : "are"} not free in Γ`);
        else say((n) => `${name} : ${showTy(s.ty, n)} — no type variable to generalise`);
        letSchemes.push({ name, scheme: s });
        const env2: Env = new Map(env);
        env2.set(name, { scheme: s, origin: "let" });
        return infer(t.body, env2);
      }
      case "lit": {
        const con = typeof t.value === "number" ? "int" : "bool";
        const lit = String(t.value);
        say(() => `literal ${lit} : ${con}`);
        return con === "int" ? INT : BOOL;
      }
      case "pair": {
        const a = infer(t.a, env);
        const b = infer(t.b, env);
        return pairTy(a, b);
      }
      case "if": {
        const where = cut(showH(t), TERM_CUT);
        const c = infer(t.c, env);
        unifyLogged(c, BOOL, `the condition of ${where} — it must be bool`, "condition");
        const x = infer(t.a, env);
        const y = infer(t.b, env);
        unifyLogged(x, y, `the branches of ${where} — both branches must have one type`, "branches");
        return x;
      }
    }
  };

  // --- run -------------------------------------------------------------------
  const shown = showH(term);
  const display: string[] = [`Term: ${shown}`];
  const caveats: string[] = [];
  const steps: string[] = [];
  let finalTy: HTy | null = null;
  let fail: HMFail | null = null;
  let tooLarge = false;
  try {
    finalTy = infer(term, new Map());
  } catch (e) {
    if (e instanceof HMFail) fail = e;
    else if (e instanceof TypeTooLarge) tooLarge = true;
    else throw e;
  }

  const out: HMOutcome = { shown, display, steps, caveats, type: null, letSchemes: [], expansion: null };
  // The λ kind's elision: at most STEP_LINES_SHOWN steps go to the pane
  // (and through say() into Word); the rest are counted, never dropped silently.
  const renderLog = (): void => {
    const n = Math.min(log.length, STEP_LINES_SHOWN);
    for (let i = 0; i < n; i++) steps.push(`${i + 1}. ${log[i](nm)}`);
    if (log.length > n) steps.push(`… ${log.length - n} more steps not listed.`);
  };

  if (tooLarge) {
    display.push(`Type: too large to show (over ${MAX_TYPE_TEXT} symbols, or more than ${MAX_TYPE_WORK.toLocaleString("en-US")} unification steps).`);
    try { renderLog(); } catch (e) { if (!(e instanceof TypeTooLarge)) throw e; }
    return out;
  }
  if (fail) {
    // Names in creation order (the failure message was rendered that way too).
    for (let i = 0; i < counter; i++) nm(i);
    display.push(`Not typable: ${fail.render(nm)}${fail.hint}.`);
    renderLog();
    for (const { name, scheme } of letSchemes) out.letSchemes.push({ name, scheme: showScheme({ vars: scheme.vars, ty: zonk(scheme.ty) }, nm) });
    for (const ls of out.letSchemes) display.push(schemeLine(ls));
    if (fail.kind === "occurs" || fail.kind === "clash") crossCheckExpansion(term, ctx, out, null, usedBuiltin, usedLetRec);
    return out;
  }

  // Success: name the final type's variables first, then the rest by creation.
  let typeText: string;
  const z = zonk(finalTy as HTy);
  try {
    typeText = showTy(z, nm);
    for (let i = 0; i < counter; i++) nm(i);
  } catch (e) {
    if (e instanceof TypeTooLarge) {
      display.push(`Type: too large to show (over ${MAX_TYPE_TEXT} symbols).`);
      return out;
    }
    throw e;
  }
  out.type = typeText;
  display.push(`Type: ${typeText}`);
  const topScheme = generalise(z, new Map());
  if (topScheme.vars.length) {
    out.scheme = showScheme(topScheme, nm);
    // Display contract, enforced at run time and not only in tests: the
    // printed scheme must re-read to itself, or it is withheld as a defect.
    {
      const rn: string[] = [];
      let back = "";
      try {
        const p = parseScheme(out.scheme, rn);
        back = showScheme({ vars: p.vars, ty: p.ty }, (id) => rn[id]);
      } catch {
        back = "";
      }
      if (back !== out.scheme && !out.defect) out.defect = `display contract: the printed scheme ${out.scheme} does not re-read to itself — withheld.`;
    }
    display.push(`Scheme: ${out.scheme}`);
  }
  // A let's scheme is printed under the FINAL substitution (its free
  // variables, from Γ, may have been bound after the let was typed; its
  // bound variables never are).
  for (const { name, scheme } of letSchemes) out.letSchemes.push({ name, scheme: showScheme({ vars: scheme.vars, ty: zonk(scheme.ty) }, nm) });
  for (const ls of out.letSchemes) display.push(schemeLine(ls));
  // Each polymorphic name's instantiations, under the final substitution,
  // with the scheme's own variable names (α ↦ int, α ↦ bool).
  const byName = new Map<string, string[]>();
  for (const u of uses) {
    const { order, nm2 } = schemeNaming({ vars: u.scheme.vars, ty: zonk(u.scheme.ty) }, nm);
    const parts = order.map((id) => `${nm2(id)} ↦ ${showTy(zonk(u.map.get(id) as HTy), nm)}`);
    const line = `${parts.join(", ")} (${showTy(zonk(u.ty), nm)})`;
    (byName.get(u.name) ?? byName.set(u.name, []).get(u.name)!).push(line);
  }
  let instanceLines = 0;
  for (const [name, lines] of byName) {
    if (instanceLines++ >= MAX_INSTANCE_LINES) { display.push(`… instances of ${byName.size - MAX_INSTANCE_LINES} more names not listed.`); break; }
    const shownL = lines.slice(0, MAX_INSTANCES_PER_NAME).map((l) => cut(l, 160));
    display.push(`Instances of ${name}: ${shownL.join("; ")}${lines.length > shownL.length ? `; … ${lines.length - shownL.length} more` : ""}`);
  }
  renderLog();

  // Check 1: every node, under the final substitution.
  const bad = recheckNodes(term, nodeTypes, nodeSchemes, zonk, nm);
  if (bad) {
    out.defect = `CROSS-CHECK FAILED: after the final substitution the node ${bad} does not type-check — a defect in this tool, so no type is reported.`;
    return out;
  }
  steps.push(`Verified: the final substitution applied to every node re-checks (each application f a has f : τ₁ → τ₂ and a : τ₁; each λ is an arrow; each if has a bool condition and equal branches; each variable is an instance of its scheme).`);

  // Check 2: pure λ-terms against principalType on the let-expansion.
  crossCheckExpansion(term, ctx, out, typeText, usedBuiltin, usedLetRec);
  if (out.defect) return out;

  // The derivation tree.
  if (size <= MAX_TREE_NODES) {
    out.svg = derivationSvg(term, nodeTypes, zonk, nm);
  } else {
    caveats.push(`Derivation tree not drawn: ${size} nodes, above the ${MAX_TREE_NODES}-node figure cap (the numbered steps are the derivation).`);
  }
  return out;
}

const schemeLine = (ls: { name: string; scheme: string }): string =>
  ls.scheme.startsWith("∀") ? `Scheme: ${ls.scheme} for ${ls.name}` : `${ls.name} : ${ls.scheme} — no type variable to generalise, so no ∀`;

/** A λ-term (library or definition body) as a term of the hm reader. */
function fromTerm(t: Term): HTerm {
  switch (t.kind) {
    case "var": return { kind: "var", name: t.name };
    case "lam": return { kind: "lam", param: t.param, body: fromTerm(t.body) };
    case "app": return { kind: "app", fn: fromTerm(t.fn), arg: fromTerm(t.arg) };
  }
}

function countFreeT(t: Term, x: string): number {
  if (t.kind === "var") return t.name === x ? 1 : 0;
  if (t.kind === "lam") return t.param === x ? 0 : countFreeT(t.body, x);
  return countFreeT(t.fn, x) + countFreeT(t.arg, x);
}

/**
 * Expands every `let` by capture-avoiding substitution. Returns null when
 * the term is not pure λ (literals, pairs, if, let rec). `unused` is set when
 * some let-bound name does not occur in its body (the check is then one-way).
 */
export function expandLets(t: HTerm, flags: { unused: boolean; capped?: string }): Term | null {
  const go = (u: HTerm): Term => {
    switch (u.kind) {
      case "var": return v(u.name);
      case "lam": return lam(u.param, go(u.body));
      case "app": return app(go(u.fn), go(u.arg));
      case "lit": case "pair": case "if": throw new ExpansionTooBig("not pure");
      case "let": {
        if (u.rec) throw new ExpansionTooBig("let rec");
        const body = go(u.body);
        const val = go(u.value);
        const n = countFreeT(body, u.name);
        if (n === 0) { flags.unused = true; return body; }
        if (termSize(body) + n * termSize(val) > MAX_TERM_SIZE) throw new ExpansionTooBig(`the expansion exceeds the ${MAX_TERM_SIZE.toLocaleString("en-US")}-node cap`);
        const out = substitute(body, u.name, val);
        const d = termDepth(out);
        if (d > MAX_TERM_DEPTH) throw new ExpansionTooBig(`the expansion nests ${d} deep, above the ${MAX_TERM_DEPTH}-deep cap`);
        return out;
      }
    }
  };
  try {
    return go(t);
  } catch (e) {
    if (e instanceof ExpansionTooBig) {
      if (e.why !== "not pure" && e.why !== "let rec") { flags.unused = false; flags.capped = e.why; }
      return null;
    }
    throw e;
  }
}

function crossCheckExpansion(term: HTerm, ctx: HMContext, out: HMOutcome, hmType: string | null, usedBuiltin: boolean, usedLetRec: boolean): void {
  if (usedBuiltin) { out.caveats.push("Cross-check against the simple type of the let-expansion: not applicable — fst/snd have no λ-term here (the node-by-node re-check applies)."); return; }
  if (usedLetRec) { out.caveats.push("Cross-check against the simple type of the let-expansion: not applicable — let rec expands through Y, which has no simple type (the node-by-node re-check applies)."); return; }
  const flags: { unused: boolean; capped?: string } = { unused: false };
  const pure = expandLets(term, flags);
  if (!pure) {
    if (flags.capped) out.caveats.push(`Cross-check against the simple type of the let-expansion: skipped — ${flags.capped} (the node-by-node re-check applies).`);
    else out.caveats.push("Cross-check against the simple type of the let-expansion: not applicable — the term uses literals, pairs or if, which have no λ-expansion here (the node-by-node re-check applies).");
    return;
  }
  let expanded: Term;
  try {
    expanded = ctx.expand(pure);
  } catch (e) {
    out.caveats.push(`Cross-check against the simple type of the let-expansion: skipped — ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  out.expansion = expanded;
  let simple: string | null;
  try {
    simple = principalType(expanded);
  } catch (e) {
    if (e instanceof TypeTooLarge) { out.caveats.push("Cross-check against the simple type of the let-expansion: skipped — the expansion's type is above the print/work cap."); return; }
    throw e;
  }
  const expText = cut(show(expanded), 120);
  if (hmType !== null) {
    if (simple === hmType) {
      out.steps.push(`Verified: the let-expansion ${expText} has principal simple type ${simple} — the same type, by the independent simple-type engine${flags.unused ? " (a let-bound name is unused, so the expansion drops its value: this direction of the check still holds)" : ""}.`);
    } else {
      out.defect = `CROSS-CHECK FAILED: Hindley–Milner gives ${hmType} but the let-expansion ${expText} has principal simple type ${simple ?? "none (not simply typable)"} — a defect in this tool, so no type is reported.`;
    }
    return;
  }
  // HM failed (occurs/clash). With every let-bound name used, the expansion must fail too.
  if (simple === null) {
    out.steps.push(`Verified: the let-expansion ${expText} is not simply typable either (independent simple-type engine).`);
  } else if (flags.unused) {
    out.caveats.push(`The let-expansion ${expText} is simply typable (${simple}) because a let-bound name is unused and its value drops out; Hindley–Milner still types the value, which is where the failure is (one-way check, said).`);
  } else {
    out.defect = `CROSS-CHECK FAILED: Hindley–Milner found no type but the let-expansion ${expText} has principal simple type ${simple} — a defect in this tool, so no verdict is reported.`;
  }
}

/** Check 1: the final substitution applied to every node, re-checked syntactically. */
function recheckNodes(root: HTerm, nodeTypes: Map<HTerm, HTy>, nodeSchemes: Map<HTerm, Scheme>, zonk: (t: HTy) => HTy, nm: (id: number) => string): string | null {
  const eq = (a: HTy, b: HTy): boolean => {
    if (a.k !== b.k) return false;
    switch (a.k) {
      case "var": return a.id === (b as { id: number }).id;
      case "con": return a.name === (b as { name: string }).name;
      case "arrow": return eq(a.from, (b as { from: HTy }).from) && eq(a.to, (b as { to: HTy }).to);
      case "pair": return eq(a.a, (b as { a: HTy }).a) && eq(a.b, (b as { b: HTy }).b);
    }
  };
  const ty = (t: HTerm): HTy => zonk(nodeTypes.get(t) as HTy);
  const stack: HTerm[] = [root];
  while (stack.length) {
    const t = stack.pop() as HTerm;
    if (!nodeTypes.has(t)) return `${cut(showH(t), TERM_CUT)} (never typed)`;
    const me = ty(t);
    let ok = true;
    switch (t.kind) {
      case "var": {
        const s = nodeSchemes.get(t);
        ok = !!s && isInstance({ vars: s.vars, ty: zonk(s.ty) }, me);
        break;
      }
      case "lit": ok = me.k === "con" && me.name === (typeof t.value === "number" ? "int" : "bool"); break;
      case "lam": ok = me.k === "arrow" && eq(me.to, ty(t.body)); break;
      case "app": { const f = ty(t.fn); ok = f.k === "arrow" && eq(f.from, ty(t.arg)) && eq(f.to, me); break; }
      case "let": ok = eq(me, ty(t.body)); break;
      case "pair": ok = me.k === "pair" && eq(me.a, ty(t.a)) && eq(me.b, ty(t.b)); break;
      case "if": { const c = ty(t.c); ok = c.k === "con" && c.name === "bool" && eq(ty(t.a), me) && eq(ty(t.b), me); break; }
    }
    if (!ok) return `${cut(showH(t), TERM_CUT)} : ${showTy(me, nm)}`;
    for (const c of childrenOf(t)) stack.push(c);
  }
  return null;
}

function derivationSvg(root: HTerm, nodeTypes: Map<HTerm, HTy>, zonk: (t: HTy) => HTy, nm: (id: number) => string): string {
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  const walk = (t: HTerm, parent: string | null, edgeLabel?: string): void => {
    const id = `n${nodes.length}`;
    const ty = nodeTypes.get(t);
    const label = `${cut(showH(t), 16)} : ${ty ? cut(showTy(zonk(ty), nm), 24) : "?"}`;
    nodes.push({ id, label, highlight: parent === null });
    if (parent !== null) edges.push({ from: parent, to: id, label: edgeLabel });
    switch (t.kind) {
      case "var": case "lit": return;
      case "lam": walk(t.body, id); return;
      case "app": walk(t.fn, id); walk(t.arg, id); return;
      case "let": walk(t.value, id, `${t.name} =`); walk(t.body, id, "in"); return;
      case "pair": walk(t.a, id); walk(t.b, id); return;
      case "if": walk(t.c, id, "if"); walk(t.a, id, "then"); walk(t.b, id, "else"); return;
    }
  };
  walk(root, null);
  return treeSvg({ nodes, edges, caption: "Algorithm W derivation — each node: term : type, after the final substitution" });
}
