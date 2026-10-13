// The untyped λ-calculus — parse, reduce, decode, and type.
//
// WHAT THIS IS. A term is a variable, an abstraction λx.M, or an application
// M N. Computation is β-reduction: (λx.M) N → M[x := N]. That substitution
// must be CAPTURE-AVOIDING — substituting y for x in λy.x must not produce
// λy.y, which is a different function — so bound variables are renamed on
// collision (α-conversion) and every rename is reported as a step of its own.
//
// NORMAL ORDER IS THE DEFAULT, BECAUSE IT IS THE STRATEGY WITH A THEOREM.
// Leftmost-outermost reduction reaches a normal form whenever one exists
// (the standardisation theorem); applicative order (call-by-value, arguments
// first) can diverge on terms that have a perfectly good normal form —
// K I Ω is the classic: normal order answers I, applicative order never
// returns. Applicative order is offered by name so the difference can be
// SHOWN, which is the whole point of a tool like this for a student.
//
// NORMALISATION IS UNDECIDABLE, so there are three honest outcomes and never
// a fourth: a normal form; a PROVEN divergence (the term came back to itself,
// up to α-equivalence, which is a cycle and a cycle never terminates); or a
// cap, reported as "no normal form within …", which is NOT a claim that none
// exists. A pane recomputes on every keystroke, so the caps bound TIME, and
// the one that actually does so is the WORK budget — the total number of
// nodes walked across all steps — because a step count alone admits a
// thousand steps over an eight-thousand-node term, which is seconds. The
// size cap keeps any single term walkable (the walkers recurse on depth),
// and is checked BEFORE a step as well as after it, since one β-step can
// duplicate its argument thousands of times. 2 2 2 2 is a Church numeral of
// 65,536 and must be refused, not attempted.
//
// RESULTS ARE CHECKED TWO INDEPENDENT WAYS. When the normal form reads as a
// Church numeral or boolean, the ORIGINAL term is also run through a separate
// environment-based lazy evaluator (closures and thunks, no substitution at
// all) applied to native successor/zero. Agreement means the syntactic
// reducer and the semantic evaluator — two different mechanisms with
// different failure modes — produced the same value; disagreement is
// reported as a defect rather than hidden. Same discipline as the Euler
// characteristic cross-check in homology.ts.
//
// An independent adversarial pass over the first version found: `let`
// expansion that captured (a definition's free y substituted under the
// user's λy), a substitution that walked a captured body twice per binder
// (2^d α-steps for d nested captures, most of them phantom), Church 0 under a
// shadowed binder (λx.λx.x) not decoded, an uncapped principal type that is
// exponential on a shared DAG, "normal form of X" read as the term `form of
// X`, and caps that bounded time at four seconds rather than one. All closed
// below, each with its own pin in lambda.test.ts.

// ---------------------------------------------------------------------------
// Terms

export type Term =
  | { kind: "var"; name: string }
  | { kind: "lam"; param: string; body: Term }
  | { kind: "app"; fn: Term; arg: Term };

export const v = (name: string): Term => ({ kind: "var", name });
export const lam = (param: string, body: Term): Term => ({ kind: "lam", param, body });
export const app = (fn: Term, arg: Term): Term => ({ kind: "app", fn, arg });

/** Number of nodes — the size every cap is measured in. */
export function termSize(t: Term): number {
  switch (t.kind) {
    case "var": return 1;
    case "lam": return 1 + termSize(t.body);
    case "app": return 1 + termSize(t.fn) + termSize(t.arg);
  }
}

export function freeVars(t: Term): Set<string> {
  const out = new Set<string>();
  const walk = (u: Term, bound: Set<string>): void => {
    if (u.kind === "var") {
      if (!bound.has(u.name)) out.add(u.name);
    } else if (u.kind === "lam") {
      const b = new Set(bound);
      b.add(u.param);
      walk(u.body, b);
    } else {
      walk(u.fn, bound);
      walk(u.arg, bound);
    }
  };
  walk(t, new Set());
  return out;
}

/** Nesting depth, computed WITHOUT recursion so the check that guards the
 *  recursive walkers can never itself be the overflow. */
export function termDepth(t: Term): number {
  let max = 0;
  const stack: [Term, number][] = [[t, 1]];
  while (stack.length) {
    const [u, d] = stack.pop() as [Term, number];
    if (d > max) max = d;
    if (u.kind === "lam") stack.push([u.body, d + 1]);
    else if (u.kind === "app") { stack.push([u.fn, d + 1]); stack.push([u.arg, d + 1]); }
  }
  return max;
}

/** How many times `x` occurs FREE in t. */
function countFree(t: Term, x: string): number {
  if (t.kind === "var") return t.name === x ? 1 : 0;
  if (t.kind === "lam") return t.param === x ? 0 : countFree(t.body, x);
  return countFree(t.fn, x) + countFree(t.arg, x);
}

function allVars(t: Term, out = new Set<string>()): Set<string> {
  if (t.kind === "var") out.add(t.name);
  else if (t.kind === "lam") { out.add(t.param); allVars(t.body, out); }
  else { allVars(t.fn, out); allVars(t.arg, out); }
  return out;
}

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const toSubscript = (n: number): string =>
  String(n).split("").map((d) => SUBSCRIPT_DIGITS[Number(d)]).join("");

/** Strips a trailing subscript index so x₁ renames to x₂, not x₁₁. */
function baseName(name: string): string {
  return name.replace(/[₀-₉]+$/u, "");
}

/** A name not in `avoid`, formed from `name` by a subscript index — displayed
 *  as x₁ and read back as x₁ (the parser accepts subscript digits), so the
 *  display contract holds for every renamed variable. */
export function freshName(name: string, avoid: Set<string>): string {
  const base = baseName(name) || "x";
  for (let i = 1; ; i++) {
    const cand = base + toSubscript(i);
    if (!avoid.has(cand)) return cand;
  }
}

// ---------------------------------------------------------------------------
// Substitution with explicit α-renames

export interface Rename { from: string; to: string }

interface Binding { term: Term; fv: Set<string> }

/** Which names in `keys` occur free in t. Stops descending a branch once a
 *  shadowing binder removes every remaining key. */
function keysOccurringFree(t: Term, keys: Set<string>, out = new Set<string>()): Set<string> {
  if (t.kind === "var") {
    if (keys.has(t.name)) out.add(t.name);
  } else if (t.kind === "lam") {
    if (keys.has(t.param)) {
      if (keys.size === 1) return out;
      const k = new Set(keys);
      k.delete(t.param);
      keysOccurringFree(t.body, k, out);
    } else {
      keysOccurringFree(t.body, keys, out);
    }
  } else {
    keysOccurringFree(t.fn, keys, out);
    keysOccurringFree(t.arg, keys, out);
  }
  return out;
}

/**
 * SIMULTANEOUS capture-avoiding substitution of every free occurrence of a key
 * of `env` by its binding. One pass: a binder that would capture a free
 * variable of a binding that is actually used beneath it is renamed, and the
 * rename simply joins the environment for the body — no second walk, so there
 * are no phantom α-steps and no 2^d blow-up for d nested captures.
 *
 * A binder is renamed only when some key that OCCURS free in its body has the
 * binder's name free in its binding; that check is linear in the body and is
 * made only for binders whose name is free in some binding at all.
 */
function substituteMany(m: Term, env: Map<string, Binding>, renames: Rename[]): Term {
  const unionFv = (e: Map<string, Binding>): Set<string> => {
    const s = new Set<string>();
    for (const b of e.values()) for (const n of b.fv) s.add(n);
    return s;
  };
  const go = (t: Term, e: Map<string, Binding>, fvE: Set<string>): Term => {
    switch (t.kind) {
      case "var": {
        const b = e.get(t.name);
        return b ? b.term : t;
      }
      case "app": {
        const f = go(t.fn, e, fvE);
        const a = go(t.arg, e, fvE);
        return f === t.fn && a === t.arg ? t : app(f, a);
      }
      case "lam": {
        let e2 = e;
        let fv2 = fvE;
        if (e.has(t.param)) {
          // The binder shadows a key: that key is not substituted beneath it.
          e2 = new Map(e);
          e2.delete(t.param);
          fv2 = unionFv(e2);
        }
        if (e2.size === 0) return t;
        if (fv2.has(t.param)) {
          const used = keysOccurringFree(t.body, new Set(e2.keys()));
          let captures = false;
          for (const k of used) if ((e2.get(k) as Binding).fv.has(t.param)) { captures = true; break; }
          if (captures) {
            const avoid = new Set<string>([...allVars(t.body), ...fv2, ...e2.keys()]);
            const fresh = freshName(t.param, avoid);
            renames.push({ from: t.param, to: fresh });
            const e3 = new Map(e2);
            e3.set(t.param, { term: v(fresh), fv: new Set([fresh]) });
            const fv3 = new Set(fv2);
            fv3.add(fresh);
            return lam(fresh, go(t.body, e3, fv3));
          }
        }
        const body = go(t.body, e2, fv2);
        return body === t.body ? t : lam(t.param, body);
      }
    }
  };
  return go(m, env, unionFv(env));
}

/** M[x := N], capture-avoiding. Renames are appended to `renames`. */
export function substitute(m: Term, x: string, n: Term, renames: Rename[] = []): Term {
  return substituteMany(m, new Map([[x, { term: n, fv: freeVars(n) }]]), renames);
}

// ---------------------------------------------------------------------------
// α-equivalence via de Bruijn indices

export function deBruijn(t: Term): string {
  const go = (u: Term, ctx: string[]): string => {
    switch (u.kind) {
      case "var": {
        const i = ctx.lastIndexOf(u.name);
        // Free variables keep their names: λx.y and λx.z are NOT equivalent.
        return i < 0 ? `f:${u.name}` : `#${ctx.length - 1 - i}`;
      }
      case "lam": return `(λ ${go(u.body, [...ctx, u.param])})`;
      case "app": return `(${go(u.fn, ctx)} ${go(u.arg, ctx)})`;
    }
  };
  return go(t, []);
}

export function alphaEquivalent(a: Term, b: Term): boolean {
  return deBruijn(a) === deBruijn(b);
}

/** FNV-1a over the de Bruijn string — a cycle candidate, confirmed by the
 *  full string only on a hit, so the detector keeps one number per step
 *  rather than one copy of every string seen. */
function dbHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Display: minimal parentheses, λ as λ.
//   - the body of an abstraction extends as far right as possible
//   - application associates left: a b c = (a b) c
//   - nested binders print in full (λx.λy.M), so what is displayed is exactly
//     the structure, and parses back to the same term.

/** Appends pieces to one array and joins once — O(size). Nested template
 *  strings were O(size × depth) per call, and a step list calls this per step. */
export function show(t: Term, limit = Infinity): string {
  const parts: string[] = [];
  let len = 0;
  let cut = false;
  const push = (s: string): void => { if (cut) return; parts.push(s); len += s.length; if (len > limit) cut = true; };
  const go = (u: Term, ctx: "top" | "fn" | "arg"): void => {
    if (cut) return;
    switch (u.kind) {
      case "var": push(u.name); return;
      case "lam": { const wrap = ctx !== "top"; if (wrap) push("("); push(`λ${u.param}.`); go(u.body, "top"); if (wrap) push(")"); return; }
      case "app": { const wrap = ctx === "arg"; if (wrap) push("("); go(u.fn, "fn"); push(" "); go(u.arg, "arg"); if (wrap) push(")"); return; }
    }
  };
  go(t, "top");
  const s = parts.join("");
  return cut ? s.slice(0, limit) + "…" : s;
}

/** For step lines: a long term is cut (and the walk stops there), since the
 *  normal form line carries the full one (and is the line that must parse back). */
const STEP_TEXT_MAX = 400;
function showCut(t: Term): string {
  return show(t, STEP_TEXT_MAX);
}

/** A structural hash of the de Bruijn form, computed without building the
 *  string: O(size) with O(1) per variable (a stack of binder depths per name).
 *  Candidates that collide are confirmed by the full de Bruijn string. */
function termHash(t: Term): number {
  const binders = new Map<string, number[]>();
  let depth = 0;
  let h = 0x811c9dc5;
  const mix = (x: number): void => { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; };
  const mixStr = (s: string): void => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  const go = (u: Term): void => {
    switch (u.kind) {
      case "var": {
        const st = binders.get(u.name);
        if (st && st.length) { mix(1); mix(depth - st[st.length - 1]); }
        else { mix(2); mixStr(u.name); }
        return;
      }
      case "lam": {
        mix(3);
        let st = binders.get(u.param);
        if (!st) { st = []; binders.set(u.param, st); }
        st.push(depth);
        depth++;
        go(u.body);
        depth--;
        st.pop();
        mix(4);
        return;
      }
      case "app": mix(5); go(u.fn); mix(6); go(u.arg); mix(7); return;
    }
  };
  go(t);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Parser
//
//   term   := lambda | application
//   lambda := ('λ' | '\' | 'lambda') ident+ '.' term
//   application := atom atom*
//   atom   := ident | number | '(' term ')'
//
// Identifiers: a letter (Latin or Greek, not λ) or underscore, then letters,
// digits, underscores, primes (' or ′) and subscript digits. Decimal
// integers are Church numerals.

const IDENT_START = /[A-Za-z_α-κμ-ωΑ-ΚΜ-Ω]/u;
const IDENT_CHAR = /[A-Za-z0-9_'′₀-₉α-κμ-ωΑ-ΚΜ-Ω]/u;
/** Negative lookahead: "the keyword ends here" (a variable named fvx is not fv x). */
const WORD_END = "(?![A-Za-z0-9_'′₀-₉α-κμ-ωΑ-ΚΜ-Ω])";
/** The λ as it arrives from a rendered equation: mathematical italic/bold/
 *  sans variants of U+03BB, read as the binder they are. */
const LAMBDA_GLYPHS = new Set(["λ", "\\", "𝛌", "𝜆", "𝝀", "𝝺", "𝞴"]);

interface Tok { t: "lam" | "dot" | "lp" | "rp" | "id" | "num" | "lb" | "rb" | "comma"; s: string; pos: number }

export class LambdaSyntaxError extends Error {}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  // Iterate by code point, so a λ from the astral plane is one character and
  // an error never shows half a surrogate pair.
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
    if (c === "[") { toks.push({ t: "lb", s: c, pos: i }); i++; continue; }
    if (c === "]") { toks.push({ t: "rb", s: c, pos: i }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma", s: c, pos: i }); i++; continue; }
    if (isDigit(c)) {
      let j = i;
      while (j < chars.length && isDigit(chars[j])) j++;
      toks.push({ t: "num", s: chars.slice(i, j).join(""), pos: i });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i;
      while (j < chars.length && IDENT_CHAR.test(chars[j])) j++;
      const word = chars.slice(i, j).join("");
      if (word === "lambda") toks.push({ t: "lam", s: word, pos: i });
      else toks.push({ t: "id", s: word, pos: i });
      i = j;
      continue;
    }
    throw new LambdaSyntaxError(`Unexpected character "${c}" at position ${i + 1}.`);
  }
  return toks;
}

/** Church numeral n = λf.λx.f (f (… x)). */
export function churchNumeral(n: number): Term {
  if (!Number.isInteger(n) || n < 0) throw new LambdaSyntaxError(`A Church numeral needs a non-negative integer, not ${n}.`);
  let body: Term = v("x");
  for (let i = 0; i < n; i++) body = app(v("f"), body);
  return lam("f", lam("x", body));
}

/** The largest literal that can be typed. Depth is what the walkers recurse
 *  on, and a literal n is 2n + 3 nodes deep. */
export const MAX_LITERAL = 500;
/** Parenthesis-plus-binder nesting the parser will follow before refusing
 *  (the parser recurses on both; measured overflow is ~2,400 binders). */
export const MAX_PARSE_DEPTH = 400;

export interface ParseNote { text: string }

/** Does `name` occur as a whole word in `text`? */
function occursAsWord(name: string, text: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_'′₀-₉α-κμ-ωΑ-ΚΜ-Ω])${esc}${WORD_END}`, "u").test(text);
}

/**
 * Parses one term. `known` lists names with definitions (library or `let`),
 * which the textbook-shorthand heuristics must never split.
 */
export function parseTerm(src: string, notes: ParseNote[] = [], known: Set<string> = new Set()): Term {
  const toks = tokenize(src);
  const chars = Array.from(src);
  let p = 0;
  let depth = 0;
  const peek = (): Tok | undefined => toks[p];
  const next = (): Tok => {
    const t = toks[p++];
    if (!t) throw new LambdaSyntaxError("The term ends too early.");
    return t;
  };

  // The source text from the current token to the end of the enclosing
  // group — what a binder's body is about to be parsed from.
  const bodySource = (): string => {
    let d = 0;
    let end = chars.length;
    for (let i = p; i < toks.length; i++) {
      if (toks[i].t === "lp") d++;
      else if (toks[i].t === "rp") { if (d === 0) { end = toks[i].pos; break; } d--; }
    }
    return chars.slice(toks[p]?.pos ?? chars.length, end).join("");
  };

  const parseLambda = (bound: Set<string>): Term => {
    next(); // the λ
    if (++depth > MAX_PARSE_DEPTH) throw new LambdaSyntaxError(`Binders and parentheses nested deeper than ${MAX_PARSE_DEPTH}.`);
    let params: string[] = [];
    while (peek()?.t === "id") params.push(next().s);
    if (params.length === 0) throw new LambdaSyntaxError("λ must be followed by a variable name.");
    const dot = peek();
    if (!dot || dot.t !== "dot") throw new LambdaSyntaxError(`Expected "." after λ${params.join(" ")}.`);
    next();
    // λxy.M in textbook notation binds x and y. A pure-letter multi-letter
    // binder is split ONLY when the whole name is never used in the body
    // and at least one of its letters is — the one case where reading it as
    // a single variable binds something that is never referred to. Either
    // reading is stated, so a reader who meant the other can see it.
    const body = bodySource();
    const split: string[] = [];
    for (const q of params) {
      if (q.length > 1 && /^[A-Za-z]+$/.test(q) && !known.has(q)) {
        if (!occursAsWord(q, body) && q.split("").some((l) => occursAsWord(l, body))) {
          notes.push({ text: `Read λ${q}. as λ${q.split("").join(".λ")}. — one binder per letter, since "${q}" itself is never used in the body.` });
          split.push(...q.split(""));
          continue;
        }
        if (occursAsWord(q, body)) {
          notes.push({ text: `"${q}" is ONE variable here (it is used as a whole in the body); write λ${q.split("").join(" ")}. to bind ${q.length} variables.` });
        }
      }
      split.push(q);
    }
    params = split;
    const inner = new Set(bound);
    for (const q of params) inner.add(q);
    let term = parseApplication(inner);
    depth--;
    for (let i = params.length - 1; i >= 0; i--) term = lam(params[i], term);
    return term;
  };

  // A multi-letter identifier is ONE variable — unless it is not bound, has
  // no definition, and every letter of it IS bound, in which case the
  // textbook reading (λx.xx means x applied to x) is the only one that refers
  // to anything, and it is taken, with a note saying so.
  const readIdent = (word: string, bound: Set<string>): Term => {
    if (word.length > 1 && !bound.has(word) && !known.has(word) && /^[A-Za-z]+$/.test(word)) {
      const letters = word.split("");
      if (letters.every((l) => bound.has(l))) {
        notes.push({ text: `Read "${word}" as ${letters.join(" ")} (each letter is a bound variable here); separate names with spaces to write an application explicitly.` });
        let t: Term = v(letters[0]);
        for (let i = 1; i < letters.length; i++) t = app(t, v(letters[i]));
        return t;
      }
    }
    return v(word);
  };

  const parseAtom = (bound: Set<string>): Term | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === "id") {
      next();
      return readIdent(t.s, bound);
    }
    if (t.t === "num") {
      next();
      const n = Number(t.s);
      if (n > MAX_LITERAL) throw new LambdaSyntaxError(`${t.s} is above the ${MAX_LITERAL} cap for a typed Church numeral.`);
      return churchNumeral(n);
    }
    if (t.t === "lp") {
      next();
      if (++depth > MAX_PARSE_DEPTH) throw new LambdaSyntaxError(`Parentheses nested deeper than ${MAX_PARSE_DEPTH}.`);
      const inner = parseApplication(bound);
      depth--;
      const close = peek();
      if (!close || close.t !== "rp") throw new LambdaSyntaxError(`Missing ")" for the "(" at position ${t.pos + 1}.`);
      next();
      return inner;
    }
    if (t.t === "lam") return parseLambda(bound);
    if (t.t === "lb") {
      // A list literal [a, b, c] is CONS a (CONS b (CONS c NIL)) — Church
      // (right-fold) lists, expanded from the library like any other name.
      next();
      const items: Term[] = [];
      if (peek()?.t !== "rb") {
        for (;;) {
          items.push(parseApplication(bound));
          const sep = peek();
          if (sep?.t === "comma") { next(); continue; }
          if (sep?.t === "rb") break;
          throw new LambdaSyntaxError(`Expected "," or "]" in the list starting at position ${t.pos + 1}.`);
        }
      }
      next(); // ]
      let list: Term = v("NIL");
      for (let i = items.length - 1; i >= 0; i--) list = app(app(v("CONS"), items[i]), list);
      return list;
    }
    return null;
  };

  const parseApplication = (bound: Set<string>): Term => {
    const first = parseAtom(bound);
    if (!first) {
      const t = peek();
      throw new LambdaSyntaxError(t ? `Unexpected "${t.s}" at position ${t.pos + 1}.` : "The term ends too early.");
    }
    let acc = first;
    for (;;) {
      const t = peek();
      if (!t || t.t === "rp" || t.t === "dot" || t.t === "rb" || t.t === "comma") break;
      const a = parseAtom(bound);
      if (!a) break;
      acc = app(acc, a);
    }
    return acc;
  };

  const term = parseApplication(new Set());
  const rest = peek();
  if (rest) throw new LambdaSyntaxError(`Unexpected "${rest.s}" at position ${rest.pos + 1}.`);
  return term;
}

// ---------------------------------------------------------------------------
// Reduction

export type Strategy = "normal" | "applicative";

export const MAX_STEPS = 1000;
/** Every walker here recurses on term depth, and depth is bounded by size,
 *  so this is also the stack bound. */
export const MAX_TERM_SIZE = 8000;
/** Nesting the walkers may be asked to recurse through. Measured inside a
 *  full jest run (the deepest stack the code meets): the weakest walker
 *  overflows at ~3,400 on a wide application chain, so 1,500 is a 2× margin.
 *  Checked as written and BEFORE every step, since one β-step can nest the
 *  argument's depth under the body's. */
export const MAX_TERM_DEPTH = 1500;
/** Total nodes walked over the whole reduction (Σ term size per step) — the
 *  cap that actually bounds time: measured at ~0.5 µs per node-step, so this
 *  is well under a second even on a slow WebView. */
export const MAX_WORK = 1_000_000;

export interface Step {
  n: number;
  /** "β" or "α" */
  rule: "β" | "α";
  /** The whole term after the step. */
  term: Term;
  /** For β: the redex that was contracted, as displayed. For α: the rename. */
  detail: string;
}

export type ReduceOutcome =
  | { status: "normal"; term: Term; steps: Step[] }
  | { status: "diverges"; steps: Step[]; cycleLength: number; term: Term }
  | { status: "capped"; steps: Step[]; term: Term; reason: string };

interface StepResult { term: Term; redex: Term; renames: Rename[] }

class SizeCap extends Error {}

/** Contracts the redex (λx.M) N — unless the result would exceed the size
 *  cap, which one step can do by duplicating N many times over. */
function contract(fn: Term & { kind: "lam" }, arg: Term): StepResult {
  const argSize = termSize(arg);
  if (argSize > 1) {
    const deep = termDepth(fn.body) + termDepth(arg);
    if (deep > MAX_TERM_DEPTH) {
      throw new SizeCap(`the next β-step could nest the term ${deep} deep, past the ${MAX_TERM_DEPTH}-deep cap`);
    }
  }
  if (argSize > 1) {
    const copies = countFree(fn.body, fn.param);
    if (copies > 1 && termSize(fn.body) + copies * argSize > MAX_TERM_SIZE) {
      throw new SizeCap(`the next β-step would copy a ${argSize}-node argument ${copies} times, past the ${MAX_TERM_SIZE}-node cap`);
    }
  }
  const renames: Rename[] = [];
  const term = substitute(fn.body, fn.param, arg, renames);
  return { term, redex: app(fn, arg), renames };
}

/** One leftmost-outermost β-step, or null if the term is in normal form. */
function stepNormal(t: Term): StepResult | null {
  if (t.kind === "var") return null;
  if (t.kind === "lam") {
    const r = stepNormal(t.body);
    return r ? { term: lam(t.param, r.term), redex: r.redex, renames: r.renames } : null;
  }
  if (t.fn.kind === "lam") return contract(t.fn, t.arg);
  const f = stepNormal(t.fn);
  if (f) return { term: app(f.term, t.arg), redex: f.redex, renames: f.renames };
  const a = stepNormal(t.arg);
  if (a) return { term: app(t.fn, a.term), redex: a.redex, renames: a.renames };
  return null;
}

/** One leftmost-innermost (applicative, call-by-value) β-step. */
function stepApplicative(t: Term): StepResult | null {
  if (t.kind === "var") return null;
  if (t.kind === "lam") {
    const r = stepApplicative(t.body);
    return r ? { term: lam(t.param, r.term), redex: r.redex, renames: r.renames } : null;
  }
  const f = stepApplicative(t.fn);
  if (f) return { term: app(f.term, t.arg), redex: f.redex, renames: f.renames };
  const a = stepApplicative(t.arg);
  if (a) return { term: app(t.fn, a.term), redex: a.redex, renames: a.renames };
  if (t.fn.kind === "lam") return contract(t.fn, t.arg);
  return null;
}

export function isNormalForm(t: Term): boolean {
  return stepNormal(t) === null;
}

export function reduce(start: Term, strategy: Strategy = "normal", maxSteps = MAX_STEPS): ReduceOutcome {
  const steps: Step[] = [];
  const startDepth = termDepth(start);
  if (startDepth > MAX_TERM_DEPTH) {
    return { status: "capped", steps, term: start, reason: `the term as written nests ${startDepth} deep, above the ${MAX_TERM_DEPTH}-deep cap` };
  }
  const startSize = termSize(start);
  if (startSize > MAX_TERM_SIZE) {
    return { status: "capped", steps, term: start, reason: `the term as written has ${startSize} nodes, above the ${MAX_TERM_SIZE}-node cap` };
  }
  // hash -> the steps whose term had that hash (terms share structure, so
  // keeping them for the confirming comparison is cheap).
  const seen = new Map<number, { idx: number; term: Term }[]>();
  const remember = (t: Term, idx: number): number | null => {
    const h = termHash(t);
    const bucket = seen.get(h);
    if (bucket) {
      // A hash hit is only a candidate: confirm with the full de Bruijn form.
      const key = deBruijn(t);
      for (const b of bucket) if (deBruijn(b.term) === key) return b.idx;
      bucket.push({ idx, term: t });
    } else {
      seen.set(h, [{ idx, term: t }]);
    }
    return null;
  };
  let cur = start;
  let work = startSize;
  remember(cur, 0);
  const stepper = strategy === "normal" ? stepNormal : stepApplicative;
  let n = 0;
  for (;;) {
    let r: StepResult | null;
    try {
      r = stepper(cur);
    } catch (e) {
      if (e instanceof SizeCap) return { status: "capped", steps, term: cur, reason: `${e.message} (after ${n} β-steps)` };
      throw e;
    }
    if (!r) return { status: "normal", term: cur, steps };
    if (n >= maxSteps) {
      return { status: "capped", steps, term: cur, reason: `no normal form within ${maxSteps} β-steps` };
    }
    for (const rn of r.renames) {
      steps.push({ n: steps.length + 1, rule: "α", term: cur, detail: `${rn.from} renamed to ${rn.to} to avoid capture` });
    }
    n++;
    cur = r.term;
    steps.push({ n: steps.length + 1, rule: "β", term: cur, detail: showCut(r.redex) });
    const size = termSize(cur);
    if (size > MAX_TERM_SIZE) {
      return { status: "capped", steps, term: cur, reason: `the term grew past ${MAX_TERM_SIZE} nodes (${size}) after ${n} β-steps` };
    }
    work += size;
    if (work > MAX_WORK) {
      return { status: "capped", steps, term: cur, reason: `the reduction exceeded its work budget (${MAX_WORK.toLocaleString("en-US")} node-steps) after ${n} β-steps` };
    }
    const prev = remember(cur, n);
    if (prev !== null) {
      return { status: "diverges", steps, cycleLength: n - prev, term: cur };
    }
  }
}

// ---------------------------------------------------------------------------
// Decoding normal forms. Binder names are irrelevant, INCLUDING a shadowing
// one: λx.λx.x is α-equivalent to λf.λx.x and is Church 0 (and FALSE).

export function decodeNumeral(t: Term): number | null {
  if (t.kind !== "lam" || t.body.kind !== "lam") return null;
  const f = t.param;
  const x = t.body.param;
  let cur = t.body.body;
  if (f === x) return cur.kind === "var" && cur.name === x ? 0 : null;
  let n = 0;
  while (cur.kind === "app") {
    if (cur.fn.kind !== "var" || cur.fn.name !== f) return null;
    cur = cur.arg;
    n++;
  }
  if (cur.kind !== "var" || cur.name !== x) return null;
  return n;
}

export function decodeBoolean(t: Term): boolean | null {
  if (t.kind !== "lam" || t.body.kind !== "lam" || t.body.body.kind !== "var") return null;
  const a = t.param;
  const b = t.body.param;
  const r = t.body.body.name;
  if (a === b) return r === b ? false : null;
  if (r === a) return true;
  if (r === b) return false;
  return null;
}

/** A Church (right-fold) list λc.λn.c h₁ (c h₂ (… n)) → its elements, each
 *  decoded as a numeral or boolean where it is one, else shown as a term.
 *  Null for anything else; the EMPTY list is λc.λn.n, which is also Church 0
 *  and FALSE, so it is reported as a list only when asked (see the caller). */
export function decodeList(t: Term): string[] | null {
  if (t.kind !== "lam" || t.body.kind !== "lam") return null;
  const c = t.param;
  const n = t.body.param;
  if (c === n) return null;
  const items: { num: number | null; bool: boolean | null; text: string }[] = [];
  let cur = t.body.body;
  for (;;) {
    if (cur.kind === "var") break;
    if (cur.kind !== "app" || cur.fn.kind !== "app" || cur.fn.fn.kind !== "var" || cur.fn.fn.name !== c) return null;
    const head = cur.fn.arg;
    const fv = freeVars(head);
    if (fv.has(c) || fv.has(n)) return null;
    const num = decodeNumeral(head);
    items.push({ num, bool: decodeBoolean(head), text: show(head) });
    cur = cur.arg;
  }
  if (cur.name !== n) return null;
  // Church 0 and FALSE are one term. In a list that also holds TRUE and no
  // positive numeral, read it as FALSE; otherwise as 0.
  const booleanContext = items.some((i) => i.bool === true) && !items.some((i) => i.num !== null && i.num > 0);
  return items.map((i) => {
    if (i.num !== null && !(booleanContext && i.num === 0)) return String(i.num);
    if (i.bool !== null) return i.bool ? "TRUE" : "FALSE";
    return i.text;
  });
}

// ---------------------------------------------------------------------------
// η-reduction: λx.M x → M when x is not free in M. Applied bottom-up and
// repeated, on a β-normal form it gives the βη-normal form (η is confluent
// and terminating on its own).

export function etaStep(t: Term): { term: Term; detail: string } | null {
  if (t.kind === "lam") {
    const b = t.body;
    if (b.kind === "app" && b.arg.kind === "var" && b.arg.name === t.param && !freeVars(b.fn).has(t.param)) {
      return { term: b.fn, detail: `${show(t)} → ${show(b.fn)}` };
    }
    const r = etaStep(t.body);
    return r ? { term: lam(t.param, r.term), detail: r.detail } : null;
  }
  if (t.kind === "app") {
    const f = etaStep(t.fn);
    if (f) return { term: app(f.term, t.arg), detail: f.detail };
    const a = etaStep(t.arg);
    if (a) return { term: app(t.fn, a.term), detail: a.detail };
  }
  return null;
}

export function etaNormalize(t: Term, maxSteps = 200): { term: Term; steps: string[] } {
  const steps: string[] = [];
  let cur = t;
  for (let i = 0; i < maxSteps; i++) {
    const r = etaStep(cur);
    if (!r) break;
    steps.push(r.detail);
    cur = r.term;
  }
  return { term: cur, steps };
}

// ---------------------------------------------------------------------------
// Combinatory logic: bracket abstraction to S, K, I (with the η rule), and
// reduction by the combinator rules alone — no λ, no substitution.

const CL_NAMES = new Set(["S", "K", "I", "B", "C", "W"]);

/** [x]M, the standard abstraction algorithm with the η shortcut. */
function bracket(x: string, m: Term): Term {
  if (!freeVars(m).has(x)) return app(v("K"), m);
  if (m.kind === "var") return v("I"); // m is x
  if (m.kind === "app") {
    if (m.arg.kind === "var" && m.arg.name === x && !freeVars(m.fn).has(x)) return m.fn; // η
    return app(app(v("S"), bracket(x, m.fn)), bracket(x, m.arg));
  }
  // m is λy.N with x free in N: abstract the inner binder first.
  return bracket(x, bracket(m.param, m.body));
}

/** Translates a λ-term to S/K/I combinators (free variables stay). */
export function toSKI(t: Term): Term {
  switch (t.kind) {
    case "var": return t;
    case "app": return app(toSKI(t.fn), toSKI(t.arg));
    case "lam": return bracket(t.param, toSKI(t.body));
  }
}

/** The spine of an application: head and its arguments. */
function spine(t: Term): { head: Term; args: Term[] } {
  const args: Term[] = [];
  let cur = t;
  while (cur.kind === "app") { args.unshift(cur.arg); cur = cur.fn; }
  return { head: cur, args };
}
function applyAll(head: Term, args: Term[]): Term {
  let t = head;
  for (const a of args) t = app(t, a);
  return t;
}

/** One leftmost-outermost combinator step: S x y z → x z (y z), K x y → x,
 *  I x → x, B x y z → x (y z), C x y z → x z y, W x y → x y y. */
export function clStep(t: Term): { term: Term; detail: string } | null {
  if (t.kind === "lam") {
    const r = clStep(t.body);
    return r ? { term: lam(t.param, r.term), detail: r.detail } : null;
  }
  const { head, args } = spine(t);
  if (head.kind === "var" && CL_NAMES.has(head.name)) {
    const need: Record<string, number> = { S: 3, K: 2, I: 1, B: 3, C: 3, W: 2 };
    const k = need[head.name];
    if (args.length >= k) {
      const [x, y, z] = args;
      let red: Term;
      switch (head.name) {
        case "S": red = app(app(x, z), app(y, z)); break;
        case "K": red = x; break;
        case "I": red = x; break;
        case "B": red = app(x, app(y, z)); break;
        case "C": red = app(app(x, z), y); break;
        default: red = app(app(x, y), y); break; // W
      }
      const redex = applyAll(head, args.slice(0, k));
      return { term: applyAll(red, args.slice(k)), detail: show(redex) };
    }
  }
  // No head redex: reduce the leftmost argument that has one.
  if (t.kind === "app") {
    const f = clStep(t.fn);
    if (f) return { term: app(f.term, t.arg), detail: f.detail };
    const a = clStep(t.arg);
    if (a) return { term: app(t.fn, a.term), detail: a.detail };
  }
  return null;
}

export const MAX_CL_STEPS = 500;

export function clReduce(t: Term): { term: Term; steps: string[]; capped: boolean } {
  const steps: string[] = [];
  let cur = t;
  for (let i = 0; i < MAX_CL_STEPS; i++) {
    const r = clStep(cur);
    if (!r) return { term: cur, steps, capped: false };
    steps.push(`${r.detail}  →  ${showCut(r.term)}`);
    cur = r.term;
    if (termSize(cur) > MAX_TERM_SIZE) return { term: cur, steps, capped: true };
  }
  return { term: cur, steps, capped: true };
}

// ---------------------------------------------------------------------------
// Independent evaluator: closures and thunks, lazy, no substitution.
//
// Native values are injected so a Church numeral can be forced to a JS
// number: apply the term to `succ` and `zero`. Call-by-need: an argument is
// evaluated at most once, and only if used, so K I Ω evaluates here as well.

type Value =
  | { k: "clo"; param: string; body: Term; env: Env }
  | { k: "nat"; n: number }
  | { k: "bool"; b: boolean }
  | { k: "prim"; name: string; f: (a: Value) => Value }
  | { k: "stuck"; name: string };
interface Thunk { term?: Term; env?: Env; value?: Value; forcing?: boolean }
type Env = Map<string, Thunk>;

class FuelExhausted extends Error {}
class Fuel {
  constructor(public left: number) {}
  tick(): void {
    if (--this.left < 0) throw new FuelExhausted();
  }
}

// The machine is ITERATIVE — an explicit continuation stack, no recursion —
// because a Church numeral of 1024 is 1024 nested applications and a
// recursive evaluator spent four JS frames per level: it overflowed inside a
// full jest run while passing alone, and the overflow was being swallowed as
// "could not decide". Depth is now bounded by the heap, not the JS stack.
type Frame =
  | { k: "arg"; thunk: Thunk }        // apply the incoming value to this thunk
  | { k: "force"; th: Thunk }         // store the incoming value into this thunk
  | { k: "prim"; f: Value & { k: "prim" } }; // apply this primitive to the forced value

function runMachine(start: { term: Term; env: Env } | { value: Value }, stack: Frame[], fuel: Fuel): Value {
  let evalTerm: Term | null = "term" in start ? start.term : null;
  let env: Env = "term" in start ? start.env : new Map();
  let val: Value = "value" in start ? start.value : { k: "stuck", name: "" };
  for (;;) {
    if (evalTerm) {
      fuel.tick();
      const t = evalTerm;
      switch (t.kind) {
        case "var": {
          const th = env.get(t.name);
          if (!th) { val = { k: "stuck", name: t.name }; evalTerm = null; break; }
          if (th.value) { val = th.value; evalTerm = null; break; }
          if (th.forcing) throw new FuelExhausted(); // a self-referential thunk is a loop
          th.forcing = true;
          stack.push({ k: "force", th });
          evalTerm = th.term as Term;
          env = th.env as Env;
          break;
        }
        case "lam":
          val = { k: "clo", param: t.param, body: t.body, env };
          evalTerm = null;
          break;
        case "app":
          stack.push({ k: "arg", thunk: { term: t.arg, env } });
          evalTerm = t.fn;
          break;
      }
      continue;
    }
    // Return mode: deliver `val` to the top frame.
    const frame = stack.pop();
    if (!frame) return val;
    if (frame.k === "force") {
      frame.th.forcing = false;
      frame.th.value = val;
      continue;
    }
    if (frame.k === "prim") {
      val = frame.f.f(val);
      continue;
    }
    // "arg": apply val to the thunk.
    fuel.tick();
    if (val.k === "clo") {
      const env2 = new Map(val.env);
      env2.set(val.param, frame.thunk);
      evalTerm = val.body;
      env = env2;
      continue;
    }
    if (val.k === "prim") {
      const th = frame.thunk;
      stack.push({ k: "prim", f: val });
      if (th.value) { val = th.value; continue; }
      if (th.forcing) throw new FuelExhausted();
      th.forcing = true;
      stack.push({ k: "force", th });
      evalTerm = th.term as Term;
      env = th.env as Env;
      continue;
    }
    throw new FuelExhausted(); // applying a number or a free variable: no value
  }
}

function evaluate(t: Term, env: Env, fuel: Fuel): Value {
  return runMachine({ term: t, env }, [], fuel);
}

function applyValue(f: Value, arg: Thunk, fuel: Fuel): Value {
  return runMachine({ value: f }, [{ k: "arg", thunk: arg }], fuel);
}

/** Runs the term as a Church numeral through the closure evaluator.
 *  null = could not be decided within the fuel (never a wrong number). */
export function evalAsNumeral(t: Term, fuel = 200000): number | null {
  try {
    const fu = new Fuel(fuel);
    const f = evaluate(t, new Map(), fu);
    const succ: Value = { k: "prim", name: "succ", f: (a) => (a.k === "nat" ? { k: "nat", n: a.n + 1 } : { k: "stuck", name: "succ" }) };
    const r1 = applyValue(f, { value: succ }, fu);
    const r2 = applyValue(r1, { value: { k: "nat", n: 0 } }, fu);
    return r2.k === "nat" ? r2.n : null;
  } catch {
    return null;
  }
}

export function evalAsBoolean(t: Term, fuel = 200000): boolean | null {
  try {
    const fu = new Fuel(fuel);
    const f = evaluate(t, new Map(), fu);
    const r1 = applyValue(f, { value: { k: "bool", b: true } }, fu);
    const r2 = applyValue(r1, { value: { k: "bool", b: false } }, fu);
    return r2.k === "bool" ? r2.b : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simple types: principal type by unification (the simply typed λ-calculus,
// with free term variables given type variables). λx.x x has no simple type
// — the occurs check — and that is reported as a fact, not a failure.
//
// A principal type is a DAG that prints as a tree, and the tree can be
// exponential in the term (PAIR x x nested n deep doubles each level), so
// both the unification work and the printed size are budgeted.

type Ty = { k: "var"; id: number } | { k: "arrow"; from: Ty; to: Ty };

class NotTypable extends Error {}
export class TypeTooLarge extends Error {}

/** Resolve/occurs steps allowed before the type is declared too large. */
export const MAX_TYPE_WORK = 200000;
/** Printed symbols allowed in a displayed type. */
export const MAX_TYPE_TEXT = 2000;

export function principalType(t: Term): string | null {
  let counter = 0;
  let work = 0;
  const spend = (): void => {
    if (++work > MAX_TYPE_WORK) throw new TypeTooLarge();
  };
  const fresh = (): Ty => ({ k: "var", id: counter++ });
  const subst = new Map<number, Ty>();
  const resolve = (ty: Ty): Ty => {
    while (ty.k === "var" && subst.has(ty.id)) { spend(); ty = subst.get(ty.id) as Ty; }
    return ty;
  };
  const occurs = (id: number, ty: Ty): boolean => {
    spend();
    ty = resolve(ty);
    if (ty.k === "var") return ty.id === id;
    return occurs(id, ty.from) || occurs(id, ty.to);
  };
  const unify = (a: Ty, b: Ty): void => {
    spend();
    a = resolve(a);
    b = resolve(b);
    if (a.k === "var" && b.k === "var" && a.id === b.id) return;
    if (a.k === "var") {
      if (occurs(a.id, b)) throw new NotTypable();
      subst.set(a.id, b);
      return;
    }
    if (b.k === "var") {
      if (occurs(b.id, a)) throw new NotTypable();
      subst.set(b.id, a);
      return;
    }
    unify(a.from, b.from);
    unify(a.to, b.to);
  };
  const freeEnv = new Map<string, Ty>();
  const infer = (u: Term, env: Map<string, Ty>): Ty => {
    switch (u.kind) {
      case "var": {
        const bound = env.get(u.name);
        if (bound) return bound;
        let f = freeEnv.get(u.name);
        if (!f) { f = fresh(); freeEnv.set(u.name, f); }
        return f;
      }
      case "lam": {
        const a = fresh();
        const env2 = new Map(env);
        env2.set(u.param, a);
        const r = infer(u.body, env2);
        return { k: "arrow", from: a, to: r };
      }
      case "app": {
        const f = infer(u.fn, env);
        const a = infer(u.arg, env);
        const r = fresh();
        unify(f, { k: "arrow", from: a, to: r });
        return r;
      }
    }
  };
  try {
    const ty = infer(t, new Map());
    // Name the type variables α, β, γ… in order of first appearance.
    const names = new Map<number, string>();
    const GREEK = "αβγδεζηθικ";
    const nameOf = (id: number): string => {
      let s = names.get(id);
      if (!s) {
        const i = names.size;
        s = i < GREEK.length ? GREEK[i] : `τ${toSubscript(i - GREEK.length + 1)}`;
        names.set(id, s);
      }
      return s;
    };
    let printed = 0;
    const showTy = (ty: Ty, left: boolean): string => {
      if (++printed > MAX_TYPE_TEXT) throw new TypeTooLarge();
      ty = resolve(ty);
      if (ty.k === "var") return nameOf(ty.id);
      const s = `${showTy(ty.from, true)} → ${showTy(ty.to, false)}`;
      return left ? `(${s})` : s;
    };
    return showTy(ty, false);
  } catch (e) {
    if (e instanceof NotTypable) return null;
    throw e;
  }
}

/** The type line for a result: a type, "not simply typable", or "too large". */
function typeLine(t: Term, prefix: string): { line: string; type: string | null } {
  try {
    const ty = principalType(t);
    return ty
      ? { line: `${prefix}: ${ty}`, type: ty }
      : { line: `${prefix}: none — not simply typable (the occurs check fails: some variable would need a type containing itself, as in λx.x x).`, type: null };
  } catch (e) {
    if (e instanceof TypeTooLarge) {
      return { line: `${prefix}: too large to show (over ${MAX_TYPE_TEXT} symbols, or more than ${MAX_TYPE_WORK.toLocaleString("en-US")} unification steps).`, type: null };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// The standard library: available by UPPERCASE name, overridable with `let`.

const LIB_SOURCE: [string, string][] = [
  ["I", "λx.x"],
  ["K", "λx.λy.x"],
  ["S", "λx.λy.λz.x z (y z)"],
  ["B", "λx.λy.λz.x (y z)"],
  ["C", "λx.λy.λz.x z y"],
  ["W", "λx.λy.x y y"],
  ["OMEGA", "(λx.x x) (λx.x x)"],
  ["Y", "λf.(λx.f (x x)) (λx.f (x x))"],
  ["TRUE", "λx.λy.x"],
  ["FALSE", "λx.λy.y"],
  ["AND", "λp.λq.p q p"],
  ["OR", "λp.λq.p p q"],
  ["NOT", "λp.λa.λb.p b a"],
  ["IF", "λp.λa.λb.p a b"],
  ["ZERO", "λf.λx.x"],
  ["SUCC", "λn.λf.λx.f (n f x)"],
  ["PLUS", "λm.λn.λf.λx.m f (n f x)"],
  ["MULT", "λm.λn.λf.m (n f)"],
  ["POW", "λb.λe.e b"],
  ["ISZERO", "λn.n (λx.FALSE) TRUE"],
  ["PRED", "λn.λf.λx.n (λg.λh.h (g f)) (λu.x) (λu.u)"],
  ["SUB", "λm.λn.n PRED m"],
  ["LEQ", "λm.λn.ISZERO (SUB m n)"],
  ["EQ", "λm.λn.AND (LEQ m n) (LEQ n m)"],
  ["PAIR", "λx.λy.λf.f x y"],
  ["FST", "λp.p TRUE"],
  ["SND", "λp.p FALSE"],
  // Church (right-fold) lists: a list is its own fold, l c n = c h₁ (c h₂ (… n)).
  ["NIL", "λc.λn.n"],
  ["CONS", "λh.λt.λc.λn.c h (t c n)"],
  ["ISNIL", "λl.l (λh.λt.FALSE) TRUE"],
  ["HEAD", "λl.l (λh.λt.h) FALSE"],
  ["TAIL", "λl.FST (l (λh.λp.PAIR (SND p) (CONS h (SND p))) (PAIR NIL NIL))"],
  ["LENGTH", "λl.l (λh.λn.SUCC n) 0"],
  ["SUM", "λl.l PLUS 0"],
  ["MAP", "λf.λl.λc.λn.l (λh.λt.c (f h) t) n"],
];

export const LIBRARY_NAMES: string[] = LIB_SOURCE.map(([n]) => n);

/** Expands library names and `let` definitions by capture-avoiding
 *  substitution, so a definition's FREE variable is never captured by one of
 *  the user's binders (let F = λx.y ⏎ (λy.F y) z is y, not z). Renames made
 *  on the way are returned so they can be stated. */
function expandDefs(t: Term, defs: Map<string, Binding>): { term: Term; renames: Rename[] } {
  const used = keysOccurringFree(t, new Set(defs.keys()));
  if (used.size === 0) return { term: t, renames: [] };
  const env = new Map<string, Binding>();
  for (const k of used) env.set(k, defs.get(k) as Binding);
  const renames: Rename[] = [];
  return { term: substituteMany(t, env, renames), renames };
}

function buildLibrary(): Map<string, Binding> {
  const defs = new Map<string, Binding>();
  for (const [name, src] of LIB_SOURCE) {
    const term = expandDefs(parseTerm(src), defs).term;
    defs.set(name, { term, fv: freeVars(term) });
  }
  return defs;
}

let LIBRARY: Map<string, Binding> | null = null;
export function library(): Map<string, Term> {
  if (!LIBRARY) LIBRARY = buildLibrary();
  return new Map([...LIBRARY].map(([k, b]) => [k, b.term]));
}
function libraryBindings(): Map<string, Binding> {
  if (!LIBRARY) LIBRARY = buildLibrary();
  return new Map(LIBRARY);
}

// ---------------------------------------------------------------------------
// The front door: a block of text → an answer with its working.

export interface LambdaResult {
  title: string;
  /** Headline lines (normal form, decoded value, type). */
  display: string[];
  /** The reduction, one line per step. */
  steps: string[];
  caveats: string[];
  /** Machine-readable, for tests. */
  outcome?: ReduceOutcome;
  normalForm?: string;
  decoded?: { numeral?: number; boolean?: boolean };
  type?: string | null;
  /** true = the independent evaluator agreed; false = it DISAGREED (a defect);
   *  null = it could not decide within its fuel. */
  verified?: boolean | null;
}

export interface LambdaRequest {
  term: Term;
  verb: "reduce" | "type" | "free" | "alpha" | "eta" | "ski" | "cl";
  strategy: Strategy;
  other?: Term;
  notes: string[];
  /** The term as the user wrote it, after definitions were expanded. */
  shown: string;
}

const STEP_LINES_SHOWN = 40;

const DEF_RE = /^(?:let\s+(rec\s+)?)?([A-Za-z_α-κμ-ωΑ-ΚΜ-Ω][A-Za-z0-9_'′₀-₉α-κμ-ωΑ-ΚΜ-Ω]*)\s*(?::=|=)\s*(.+)$/u;

/** Re-throws a syntax error with where it happened, since positions inside
 *  the message count from the start of the TERM being parsed. */
function located<T>(where: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof LambdaSyntaxError) throw new LambdaSyntaxError(`${where}: ${e.message}`);
    throw e;
  }
}

/**
 * Reads a lambda-calculus request. Returns null only for an EMPTY input;
 * malformed terms throw LambdaSyntaxError with a position.
 *
 * Lines before the last may be definitions: `let NAME = term`, `NAME := term`
 * or `NAME = term`. The last line is the term, optionally led by a verb:
 *   type λx.x · free λx.x y · alpha λx.x = λy.y ·
 *   applicative (λx.y) OMEGA · normal (λx.y) OMEGA
 */
export function parseLambdaRequest(input: string): LambdaRequest | null {
  const raw = input.replace(/\r/g, "").trim();
  if (!raw) return null;
  const notes: string[] = [];
  // Real line numbers survive the blank-line filter.
  const lines = raw.split("\n").map((l, i) => ({ text: l.trim(), no: i + 1 })).filter((l) => l.text.length > 0);
  const defs = libraryBindings();
  const known = (): Set<string> => new Set(defs.keys());
  // Depth is checked HERE, straight after the (iterative) parse and before
  // any recursive walker — expansion, show, reduce — can meet the term. A
  // 9,000-wide application chain parses fine and overflows the next walker.
  const parseChecked = (src: string, pn: ParseNote[]): Term => {
    const t = parseTerm(src, pn, known());
    const d = termDepth(t);
    if (d > MAX_TERM_DEPTH) throw new LambdaSyntaxError(`the term as written nests ${d} deep, above the ${MAX_TERM_DEPTH}-deep cap.`);
    return t;
  };
  let last = lines[lines.length - 1].text;
  const lastNo = lines[lines.length - 1].no;
  for (let i = 0; i < lines.length - 1; i++) {
    const { text, no } = lines[i];
    const m = DEF_RE.exec(text);
    if (!m) throw new LambdaSyntaxError(`Line ${no} is not a definition (write NAME = term); only the last line may be the term.`);
    const isRec = !!m[1];
    const name = m[2];
    const pn: ParseNote[] = [];
    // `let rec F = body` is F = Y (λF.body): the name is bound inside its
    // own body, and the fixed-point combinator ties the knot.
    const parsed = located(`Line ${no}, in the term after "="`, () => parseChecked(m[3], pn));
    const toExpand = isRec ? app(v("Y"), lam(name, parsed)) : parsed;
    const ex = located(`Line ${no}`, () => expandDefs(toExpand, defs));
    for (const n of pn) notes.push(n.text);
    for (const r of ex.renames) notes.push(`In ${name}: ${r.from} renamed to ${r.to} so a definition's free variable is not captured.`);
    if (isRec) notes.push(`${name} is recursive: defined as Y (λ${name}.…), so every use unfolds through the fixed-point combinator.`);
    const fv = freeVars(ex.term);
    if (fv.size) notes.push(`${name} has free variable${fv.size > 1 ? "s" : ""} ${[...fv].join(", ")} — allowed; it is an open term, and that variable stays free wherever ${name} is used.`);
    defs.set(name, { term: ex.term, fv });
  }

  let verb: LambdaRequest["verb"] = "reduce";
  let strategy: Strategy = "normal";
  const lead = (re: RegExp): boolean => {
    const m = re.exec(last.toLowerCase());
    if (!m) return false;
    last = last.slice(m[0].length).trim();
    return true;
  };
  // Prose wrappers and strategy words, in any order, before the term:
  // "the normal form of X", "reduce the term X", "normal order: reduce X".
  const stripOne = (): boolean => {
    if (lead(new RegExp(`^(?:the\\s+)?normal\\s+form\\s+of${WORD_END}\\s*:?\\s*`, "u"))) return true;
    if (lead(new RegExp(`^(?:please\\s+)?(?:reduce|evaluate|normali[sz]e|simplify|compute|what\\s+is|find)${WORD_END}\\s*:?\\s*`, "u"))) return true;
    if (lead(new RegExp(`^the\\s+term${WORD_END}\\s*:?\\s*`, "u"))) return true;
    if (lead(new RegExp(`^(?:applicative(?:\\s+order)?|call[\\s-]by[\\s-]value|cbv|eager|strict)${WORD_END}\\s*:?\\s*`, "u"))) { strategy = "applicative"; return true; }
    if (lead(new RegExp(`^(?:normal(?:\\s+order)?|call[\\s-]by[\\s-]name|cbn|lazy)${WORD_END}\\s*:?\\s*`, "u"))) { strategy = "normal"; return true; }
    return false;
  };
  for (let i = 0; i < 6 && stripOne(); i++) { /* keep stripping */ }
  if (lead(new RegExp(`^(?:type(?:\\s+of)?|typecheck|infer(?:\\s+the\\s+type\\s+of)?)${WORD_END}\\s*:?\\s*`, "u"))) verb = "type";
  else if (lead(new RegExp(`^(?:free(?:\\s+vars?|\\s+variables?)?(?:\\s+of)?|fv)${WORD_END}\\s*:?\\s*`, "u"))) verb = "free";
  else if (lead(new RegExp(`^(?:alpha(?:[\\s-]equivalent)?|α(?:[\\s-]equivalent)?|equivalent|same)${WORD_END}\\s*:?\\s*`, "u"))) verb = "alpha";
  else if (lead(new RegExp(`^(?:eta(?:[\\s-]reduce)?|η(?:[\\s-]reduce)?|beta[\\s-]eta|βη)${WORD_END}\\s*:?\\s*`, "u"))) verb = "eta";
  else if (lead(new RegExp(`^(?:ski|to\\s+ski|combinators?|bracket(?:\\s+abstraction)?)${WORD_END}\\s*:?\\s*`, "u"))) verb = "ski";
  else if (lead(new RegExp(`^(?:cl|combinatory|combinator\\s+reduction)${WORD_END}\\s*:?\\s*`, "u"))) verb = "cl";
  for (let i = 0; i < 3 && stripOne(); i++) { /* "type of the normal form of X" */ }

  if (!last) throw new LambdaSyntaxError("There is no term after the keyword.");
  if (verb !== "alpha" && verb !== "cl" && DEF_RE.test(last)) {
    throw new LambdaSyntaxError("That line is a definition. Put the term to reduce on the line after it (for example a second line reading TWICE SUCC 0).");
  }
  const where = lines.length > 1 ? `Line ${lastNo}` : "In the term";
  const expand = (src: string): Term => {
    const pn: ParseNote[] = [];
    const ex = located(where, () => expandDefs(parseChecked(src, pn), defs));
    for (const n of pn) notes.push(n.text);
    for (const r of ex.renames) notes.push(`${r.from} renamed to ${r.to} so a definition's free variable is not captured.`);
    return ex.term;
  };

  if (verb === "alpha") {
    const parts = last.split(/\s*(?:==|=|≡|≟)\s*/);
    if (parts.length !== 2) throw new LambdaSyntaxError("alpha needs two terms separated by = (e.g. alpha λx.x = λy.y).");
    const t1 = expand(parts[0]);
    const t2 = expand(parts[1]);
    return { term: t1, other: t2, verb, strategy, notes, shown: `${show(t1)}  vs  ${show(t2)}` };
  }
  if (verb === "cl") {
    // Combinator names are CONSTANTS for this verb: they must not be
    // expanded to λ-terms, or the reduction would be β, not combinatory.
    const pn: ParseNote[] = [];
    const term = located(where, () => parseChecked(last, pn));
    for (const n of pn) notes.push(n.text);
    return { term, verb, strategy, notes, shown: show(term) };
  }
  const term = expand(last);
  return { term, verb, strategy, notes, shown: show(term) };
}

export function solveLambda(input: string): LambdaResult | null {
  try {
    return solveLambdaInner(input);
  } catch (e) {
    // A term nested deeper than the JS stack: refuse by name rather than
    // surface "Maximum call stack size exceeded".
    if (e instanceof RangeError) throw new LambdaSyntaxError("The term nests too deeply for this tool to walk (the size cap bounds breadth; this bounds depth).");
    throw e;
  }
}

function solveLambdaInner(input: string): LambdaResult | null {
  const req = parseLambdaRequest(input);
  if (!req) return null;
  const caveats: string[] = [...req.notes];
  const t = req.term;

  if (req.verb === "free") {
    const fv = [...freeVars(t)];
    return {
      title: "Free variables",
      display: [`Term: ${show(t)}`, fv.length ? `Free: ${fv.join(", ")}` : "Closed term — no free variables (a combinator)."],
      steps: [],
      caveats,
    };
  }

  if (req.verb === "alpha") {
    const other = req.other as Term;
    const same = alphaEquivalent(t, other);
    return {
      title: "α-equivalence",
      display: [
        show(t),
        show(other),
        same ? "α-equivalent: the same term up to renaming of bound variables." : "NOT α-equivalent: these differ by more than the names of bound variables.",
      ],
      steps: [`de Bruijn form: ${deBruijn(t)}`, `de Bruijn form: ${deBruijn(other)}`],
      caveats: [...caveats, "α-equivalence is syntactic. Terms that are not α-equivalent may still β-reduce to the same normal form — reduce both to compare."],
    };
  }

  if (req.verb === "eta") {
    const beta = reduce(t, "normal");
    if (beta.status !== "normal") throw new LambdaSyntaxError(`η needs a β-normal form first, and this term has none within the caps (${beta.status === "diverges" ? "it diverges" : (beta as { reason: string }).reason}).`);
    const eta = etaNormalize(beta.term);
    const display = [`β-normal form: ${show(beta.term)}`, eta.steps.length ? `βη-normal form: ${show(eta.term)}` : "Already η-normal: no λx.M x with x not free in M."];
    const num = decodeNumeral(eta.term);
    const bool = num === null ? decodeBoolean(eta.term) : null;
    if (num !== null) display.push(`= Church numeral ${num} (after η)`);
    else if (bool !== null) display.push(`= ${bool ? "TRUE" : "FALSE"} (after η)`);
    return {
      title: "βη-reduction",
      display,
      steps: [`${beta.steps.filter((s) => s.rule === "β").length} β-steps (not listed — use the plain term for them), then η:`, ...eta.steps.map((s, i) => `${i + 1}. η  ${s}`)],
      caveats: [...caveats, "η-reduction identifies functions that behave the same on every argument (extensionality); the βη-normal form is unique."],
    };
  }

  if (req.verb === "ski") {
    const ski = toSKI(t);
    const skiText = show(ski);
    // Verify extensionally: apply both to as many fresh variables as the
    // original has leading binders, reduce, and compare up to α.
    let arity = 0;
    for (let u = t; u.kind === "lam"; u = u.body) arity++;
    const fresh = Array.from({ length: arity }, (_, i) => v(`z${toSubscript(i + 1)}`));
    const lhs = reduce(expandDefs(applyAll(ski, fresh), libraryBindings()).term, "normal");
    const rhs = reduce(applyAll(t, fresh), "normal");
    const steps: string[] = [`[x]x = I · [x]M = K M when x ∉ FV(M) · [x](M N) = S ([x]M) ([x]N) · [x](M x) = M when x ∉ FV(M) (η rule).`];
    const cav = [...caveats];
    if (lhs.status === "normal" && rhs.status === "normal") {
      if (alphaEquivalent(lhs.term, rhs.term)) steps.push(`Verified: applied to ${arity} fresh variable${arity === 1 ? "" : "s"}, the combinator term and the original reduce to the same normal form${arity ? ` (${show(rhs.term)})` : ""}.`);
      else cav.push("CROSS-CHECK FAILED: the combinator term and the original do not agree — a defect in this tool.");
    } else {
      cav.push("The translation could not be verified by reduction (no normal form within the caps); it follows the standard algorithm but is unchecked here.");
    }
    return { title: "SKI combinators", display: [`Term: ${show(t)}`, `SKI: ${skiText}`, `Size: ${termSize(ski)} nodes.`], steps, caveats: cav };
  }

  if (req.verb === "cl") {
    const r = clReduce(req.term);
    const display = [`Start: ${showCut(req.term)}`, r.capped ? `No combinator normal form within ${MAX_CL_STEPS} steps or the size cap.` : `Normal form: ${show(r.term)}`, `${r.steps.length} combinator step${r.steps.length === 1 ? "" : "s"}.`];
    return {
      title: "Combinatory reduction",
      display,
      steps: r.steps.slice(0, STEP_LINES_SHOWN).map((s, i) => `${i + 1}. ${s}`).concat(r.steps.length > STEP_LINES_SHOWN ? [`… ${r.steps.length - STEP_LINES_SHOWN} more steps not listed.`] : []),
      caveats: [...caveats, "Rules: S x y z → x z (y z) · K x y → x · I x → x · B x y z → x (y z) · C x y z → x z y · W x y → x y y. Combinator names are treated as constants here, not expanded to λ-terms."],
    };
  }

  if (req.verb === "type") {
    const tl = typeLine(t, "Type");
    const fv = [...freeVars(t)];
    return {
      title: "Principal simple type",
      display: [`Term: ${show(t)}`, tl.line],
      steps: [],
      caveats: [
        ...caveats,
        ...(fv.length ? [`Free variable${fv.length > 1 ? "s" : ""} ${fv.join(", ")} given fresh type variables.`] : []),
        "Simply typed λ-calculus (→ only): every typable term strongly normalises. The converse fails — λx.x x is untypable and is already in normal form.",
      ],
      type: tl.type,
    };
  }

  // reduce
  const out = reduce(t, req.strategy);
  const stratName = req.strategy === "normal" ? "normal order (leftmost-outermost)" : "applicative order (call-by-value, arguments first)";
  const steps: string[] = [`Start: ${showCut(t)}`];
  const shown = out.steps.slice(0, STEP_LINES_SHOWN);
  for (const s of shown) {
    steps.push(s.rule === "β" ? `${s.n}. β  [${s.detail}]  →  ${showCut(s.term)}` : `${s.n}. α  ${s.detail}`);
  }
  if (out.steps.length > STEP_LINES_SHOWN) steps.push(`… ${out.steps.length - STEP_LINES_SHOWN} more steps not listed.`);

  const betaCount = out.steps.filter((s) => s.rule === "β").length;
  const alphaCount = out.steps.length - betaCount;
  const display: string[] = [];
  const result: LambdaResult = { title: "β-reduction", display, steps, caveats, outcome: out };
  display.push(`Strategy: ${stratName}.`);
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

  if (out.status === "normal") {
    const nf = show(out.term);
    result.normalForm = nf;
    display.push(`Normal form: ${nf}`);
    // The reducer stopped because its stepper found no redex; an independent
    // scan must agree, or "normal form" is a misnomer.
    if (!isNormalForm(out.term)) caveats.push("CROSS-CHECK FAILED: the reported normal form still contains a redex — a defect in this tool.");
    display.push(`${plural(betaCount, "β-step")}${alphaCount ? `, ${plural(alphaCount, "α-rename")}` : ""}.`);
    const num = decodeNumeral(out.term);
    const bool = decodeBoolean(out.term);
    result.decoded = {};
    if (num !== null) {
      result.decoded.numeral = num;
      if (num === 0) {
        // One term, two readings — say both, since AND TRUE FALSE lands here.
        result.decoded.boolean = false;
        display.push("= Church numeral 0, which is the same term as FALSE (the encodings coincide).");
      } else {
        display.push(`= Church numeral ${num}`);
      }
      const check = evalAsNumeral(t);
      if (check === null) {
        result.verified = null;
        caveats.push("Independent check: the closure evaluator did not finish within its fuel, so the numeral is reported from the reducer alone.");
      } else if (check === num) {
        result.verified = true;
        display.push(`Verified: an independent environment-based evaluator also gives ${check}${num === 0 ? " (FALSE)" : ""}.`);
      } else {
        result.verified = false;
        caveats.push(`CHECK FAILED: the independent evaluator gives ${check}, the reducer ${num}. This is a defect in this tool — do not use the result.`);
      }
    } else if (bool !== null) {
      result.decoded.boolean = bool;
      display.push(`= ${bool ? "TRUE" : "FALSE"} (Church boolean${bool ? "; the same term as K" : ""})`);
      const check = evalAsBoolean(t);
      if (check === null) {
        result.verified = null;
        caveats.push("Independent check: the closure evaluator did not finish within its fuel, so the boolean is reported from the reducer alone.");
      } else if (check === bool) {
        result.verified = true;
        display.push(`Verified: an independent environment-based evaluator also gives ${bool ? "TRUE" : "FALSE"}.`);
      } else {
        result.verified = false;
        caveats.push(`CHECK FAILED: the independent evaluator gives ${check ? "TRUE" : "FALSE"}, the reducer ${bool ? "TRUE" : "FALSE"}. This is a defect in this tool — do not use the result.`);
      }
    } else {
      const list = decodeList(out.term);
      if (list) display.push(`= list [${list.join(", ")}]`);
    }
    // The η view: a β-normal form may still η-reduce (λx.f x → f), and the
    // βη-normal form may be what the reader meant — POW 2 0 is λx.x, which
    // is η-equal to Church 1 but not the same term.
    const eta = etaNormalize(out.term, 50);
    if (eta.steps.length) {
      display.push(`η-reduces further to: ${show(eta.term)}${eta.steps.length > 1 ? ` (${eta.steps.length} η-steps)` : ""}`);
      const en = decodeNumeral(eta.term);
      const eb = en === null ? decodeBoolean(eta.term) : null;
      if (en !== null) display.push(`= Church numeral ${en} up to η (write “eta …” for the βη-normal form).`);
      else if (eb !== null) display.push(`= ${eb ? "TRUE" : "FALSE"} up to η.`);
    } else if (out.term.kind === "lam" && out.term.body.kind === "var" && out.term.body.name === out.term.param && num === null) {
      caveats.push("λx.x is η-equivalent to Church numeral 1 (λf.λx.f x) but is not the same term, so nothing is decoded. POW 2 0 lands here.");
    }
    const fv = [...freeVars(out.term)];
    if (fv.length) display.push(`Free variable${fv.length > 1 ? "s" : ""}: ${fv.join(", ")}`);
    const tl = typeLine(t, "Simple type of the term as written");
    result.type = tl.type;
    display.push(tl.line);
    if (req.strategy === "normal") {
      caveats.push("Normal order reaches the normal form whenever one exists (standardisation theorem).");
    } else {
      caveats.push("Applicative order reached a normal form here; on some terms it diverges where normal order would not (K I OMEGA).");
    }
  } else if (out.status === "diverges") {
    display.push(`DIVERGES: after ${plural(betaCount, "β-step")} the term returned to an earlier form (a cycle of length ${out.cycleLength}), so this reduction never terminates.`);
    display.push(`Cycling term: ${showCut(out.term)}`);
    if (req.strategy === "applicative") {
      const alt = reduce(t, "normal");
      if (alt.status === "normal") {
        display.push(`Normal order DOES terminate on this term: ${showCut(alt.term)} — the arguments-first strategy evaluated a diverging argument that normal order discards.`);
      }
    }
    caveats.push("A cycle is a proof of divergence for this strategy; it says nothing about other strategies unless stated above.");
  } else {
    display.push(`No normal form found: ${out.reason}.`);
    display.push(`Last term: ${showCut(out.term)}`);
    caveats.push("The cap is a limit of this tool, not a theorem: the term may still have a normal form (normalisation is undecidable in general), or it may diverge without ever repeating itself.");
    if (req.strategy === "applicative") {
      const alt = reduce(t, "normal");
      if (alt.status === "normal") display.push(`Normal order DOES terminate on this term: ${showCut(alt.term)}.`);
    }
  }
  return result;
}
