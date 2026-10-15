// Parsing for the differential-algebraic tool — every initial value BY NAME.
//
// WHY THIS FILE EXISTS. The pane used to read `x' = …` lines, throw the name
// away, and line the right-hand sides up with the initial values IN THE ORDER
// THE INITIAL VALUES WERE TYPED. `x' = u; u' = -x - z; 0 = z` gave cos 1 with
// `x = 1, u = 0` and a different, silent answer with `u = 0, x = 1` — the first
// equation was applied to u. Here the state order comes from the EQUATIONS
// alone and every initial value is bound to the name on its left, so the order
// it was typed in cannot matter.
//
// The same parser also fixes the second silent loss: `z = 1/2`, `y = pi` and
// `y = −1` were dropped by a numbers-only regex and then reported "missing".
// Any constant expression is accepted (it is parsed and evaluated by the same
// grammar as the equations), and a value that cannot be read is an error that
// names it — never a skip.
//
// Grammar (one item per line, or separated by ";"):
//   name' = expr          a differential equation (name'' = … is reduced to
//                         first order: the state name' is introduced)
//   0 = expr / expr = 0   a constraint; `lhs = rhs` is lhs − (rhs) = 0; a bare
//                         expression is a constraint too
// Every name that has no ' equation is ALGEBRAIC. λ and the word lambda are
// read as `lam` (the expression grammar reserves both), and the output says so.
//
// Pure; no DOM; no regex lookbehind (this is bundled into the pane, and Mac
// WKWebView is the reason).

import { Expr, parseExpr, evalAst, freeVars } from "./solve";

/** One first-order state of the system after order reduction. */
export interface DaeState {
  /** Display name: "x" or "x'". */
  label: string;
  /** Name inside the expressions: "x" or "x__d1". */
  varName: string;
  /** The function it came from, and which derivative of it this is. */
  base: string;
  order: number;
}

/** One differential equation as the user wrote it, bound to its NAME. */
export interface DaeDiffEq {
  name: string;
  order: number;
  rhs: Expr;
  text: string;
}

export interface DaeSystem {
  /** The user's differential equations, in the order typed. */
  diff: DaeDiffEq[];
  /** First-order states, ordered by the EQUATIONS (never by the initial values). */
  states: DaeState[];
  /** Right-hand side of each first-order state's equation (internal names). */
  stateRhs: Expr[];
  /** Algebraic unknowns, in order of first appearance in the equations. */
  alg: string[];
  /** Constraints, each meaning 0 = cons[i]. */
  cons: Expr[];
  /** Each constraint as typed (after the λ rewrite), for messages. */
  consText: string[];
  /** Initial value of every state, keyed by its internal name. */
  init: Record<string, number>;
  /** Starting guesses for algebraic unknowns (optional), keyed by name. */
  guesses: Record<string, number>;
  /** Things the reader should know about how the text was read. */
  notes: string[];
}

export type DaeParse = { ok: true; system: DaeSystem } | { ok: false; error: string };

/** The tool's caps, checked before any work (structural analysis is the expensive part). */
export const DAE_MAX_UNKNOWNS = 12;
const MAX_TEXT = 20000;
const MAX_LINE = 2000;
const MAX_ORDER = 4;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED: Record<string, string> = {
  t: "t is the independent variable (time)",
  e: "e is Euler's number 2.71828… in these expressions",
  pi: "pi is the constant π",
};

/** Internal name for the k-th derivative of `base`. */
export function daeDerivVar(base: string, k: number): string {
  return k === 0 ? base : `${base}__d${k}`;
}

/** Display label for the k-th derivative of `base`. */
export function daeDerivLabel(base: string, k: number): string {
  return base + "'".repeat(k);
}

/** Internal name back to what the user wrote: x__d2 → x''. */
export function daePrettyName(varName: string): string {
  const m = /^(.*)__d(\d+)$/.exec(varName);
  return m ? daeDerivLabel(m[1], Number(m[2])) : varName;
}

/** Typed primes and Greek lambda, folded to the ASCII forms the grammar reads. */
function foldInput(s: string): string {
  return s
    .replace(/[′’´`]/g, "'")
    .replace(/″/g, "''")
    .replace(/‴/g, "'''");
}

/** Splits on separators that are not inside brackets. */
function splitTop(s: string, seps: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(c)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Rewrites λ / lambda to lam. Refuses when lam is ALSO used, because then two
 * names the user meant to be different would silently become one.
 */
function rewriteLambda(all: string): { ok: true; used: boolean } | { ok: false; error: string } {
  const greek = /λ|Λ/.test(all);
  const word = /\blambda\b/i.test(all);
  const lam = /\blam\b/.test(all);
  if ((greek || word) && lam) {
    return {
      ok: false,
      error:
        "Both lam and λ/lambda appear. λ and lambda are read as lam here (the expression grammar reserves them), " +
        "so they would silently become the same variable. Rename one of them.",
    };
  }
  return { ok: true, used: greek || word };
}

function applyLambda(s: string): string {
  return s.replace(/[λΛ]/g, "lam").replace(/\blambda\b/gi, "lam");
}

/** Replaces x', x'' … in an expression with the internal state names. */
function substitutePrimes(
  expr: string, orderOf: Map<string, number>, where: string,
): { ok: true; text: string } | { ok: false; error: string } {
  let error: string | null = null;
  const text = expr.replace(/([A-Za-z_][A-Za-z0-9_]*)('+)/g, (_m, base: string, primes: string) => {
    const k = primes.length;
    const n = orderOf.get(base);
    if (n === undefined) {
      error ??= `${where} uses ${base}${primes}, but ${base} has no differential equation, so its derivative is not an unknown of this system.`;
    } else if (k >= n) {
      error ??=
        `${where} uses ${base}${primes}, but ${base} is order ${n}, so ${base}${primes} is not a state. ` +
        `Only ${Array.from({ length: n }, (_x, j) => daeDerivLabel(base, j)).join(", ")} may appear on a right-hand side or in a constraint.`;
    }
    return daeDerivVar(base, k);
  });
  return error ? { ok: false, error } : { ok: true, text };
}

function parseOne(text: string, where: string): { ok: true; e: Expr } | { ok: false; error: string } {
  if (text.length > MAX_LINE) return { ok: false, error: `${where} is longer than ${MAX_LINE} characters.` };
  try {
    return { ok: true, e: parseExpr(text) };
  } catch (err) {
    return { ok: false, error: `Couldn't read ${where}: ${(err as Error).message}` };
  }
}

/** Reads a constant: 1/2, pi, −1, sqrt(2)/2 — anything with no unknowns in it. */
function readConstant(text: string, label: string): { ok: true; v: number } | { ok: false; error: string } {
  const p = parseOne(text, `the value for ${label}`);
  if (!p.ok) return p;
  const fv = freeVars(p.e);
  if (fv.length) {
    return { ok: false, error: `The value for ${label} ("${text}") uses ${fv.join(", ")}; an initial value must be a constant, such as 1/2, pi or −1.` };
  }
  let v: number;
  try {
    v = evalAst(p.e, {});
  } catch (err) {
    return { ok: false, error: `The value for ${label} ("${text}") could not be evaluated: ${(err as Error).message}` };
  }
  if (!Number.isFinite(v)) return { ok: false, error: `The value for ${label} ("${text}") is not a finite number.` };
  return { ok: true, v };
}

/**
 * Parses a DAE: the equation block (differential equations AND constraints may
 * be mixed), the initial values, and optional starting guesses for the
 * algebraic unknowns. Every value is bound by NAME; a missing, extra or
 * duplicated one is refused by name.
 */
export function parseDaeSystem(eqsText: string, initText: string, guessText = ""): DaeParse {
  const raw = [eqsText, initText, guessText].map((s) => foldInput(s ?? ""));
  if (raw.some((s) => s.length > MAX_TEXT)) {
    return { ok: false, error: `The input is longer than ${MAX_TEXT} characters; that is far beyond the ${DAE_MAX_UNKNOWNS}-unknown cap.` };
  }
  const lam = rewriteLambda(raw.join("\n"));
  if (!lam.ok) return lam;
  const [eqs, init, guess] = raw.map(applyLambda);
  const notes: string[] = [];
  if (lam.used) notes.push("λ / lambda was read as the variable lam (the expression grammar reserves both).");

  const lines = splitTop(eqs.replace(/\r/g, ""), "\n;");
  if (!lines.length) return { ok: false, error: "Enter the equations, e.g.  y' = -z  and the constraint  0 = z - y." };

  // --- Pass 1: classify each line, binding differential equations by NAME ---
  const orderOf = new Map<string, number>();
  const diffRaw: { name: string; order: number; rhs: string; line: string }[] = [];
  const consRaw: { text: string; line: string }[] = [];
  for (const line of lines) {
    const d = /^([A-Za-z_][A-Za-z0-9_]*)\s*('+)\s*(?:\(\s*t\s*\))?\s*=\s*(.+)$/.exec(line);
    if (d) {
      const [, name, primes, rhs] = d;
      if (RESERVED[name]) return { ok: false, error: `"${line}": ${name} cannot be a state — ${RESERVED[name]}. Rename the variable.` };
      if (name.includes("__d")) return { ok: false, error: `"${name}" contains "__d", which is reserved for derivative states. Rename the variable.` };
      if (orderOf.has(name)) return { ok: false, error: `${name} has more than one differential equation. Give exactly one equation per function.` };
      if (primes.length > MAX_ORDER) return { ok: false, error: `${name} is order ${primes.length}; up to ${MAX_ORDER} is supported.` };
      if (rhs.includes("=")) return { ok: false, error: `"${line}" has more than one "=".` };
      orderOf.set(name, primes.length);
      diffRaw.push({ name, order: primes.length, rhs: rhs.trim(), line });
      continue;
    }
    const parts = line.split("=");
    if (parts.length > 2) return { ok: false, error: `"${line}" has more than one "=".` };
    let text: string;
    if (parts.length === 1) text = line;
    else {
      const lhs = parts[0].trim();
      const rhs = parts[1].trim();
      if (!lhs || !rhs) return { ok: false, error: `"${line}" has nothing on one side of the "=".` };
      if (lhs === "0") text = rhs;
      else if (rhs === "0") text = lhs;
      else text = `(${lhs}) - (${rhs})`;
    }
    consRaw.push({ text, line });
  }
  if (!diffRaw.length) {
    return { ok: false, error: "There is no differential equation (name' = …). A DAE needs at least one; with constraints alone this is an algebraic system." };
  }
  if (!consRaw.length) {
    return { ok: false, error: "There is no constraint (0 = …). Without one this is an ODE — use the ODE solver." };
  }

  // --- Pass 2: the first-order states, in EQUATION order --------------------
  const states: DaeState[] = [];
  const stateRhs: Expr[] = [];
  const diff: DaeDiffEq[] = [];
  for (const d of diffRaw) {
    const sub = substitutePrimes(d.rhs, orderOf, `"${d.line}"`);
    if (!sub.ok) return sub;
    const p = parseOne(sub.text, `"${d.line}"`);
    if (!p.ok) return p;
    diff.push({ name: d.name, order: d.order, rhs: p.e, text: d.line });
    for (let k = 0; k < d.order; k++) {
      states.push({ label: daeDerivLabel(d.name, k), varName: daeDerivVar(d.name, k), base: d.name, order: k });
      stateRhs.push(k < d.order - 1 ? { t: "var", name: daeDerivVar(d.name, k + 1) } : p.e);
    }
  }
  const stateSet = new Set(states.map((s) => s.varName));

  const cons: Expr[] = [];
  const consText: string[] = [];
  for (const c of consRaw) {
    const sub = substitutePrimes(c.text, orderOf, `the constraint "${c.line}"`);
    if (!sub.ok) return sub;
    const p = parseOne(sub.text, `the constraint "${c.line}"`);
    if (!p.ok) return p;
    cons.push(p.e);
    consText.push(c.line);
  }

  // --- Algebraic unknowns: every other name, in order of appearance ----------
  const alg: string[] = [];
  for (const e of [...stateRhs, ...cons]) {
    for (const v of freeVars(e)) {
      if (v === "t" || stateSet.has(v) || alg.includes(v)) continue;
      if (v.includes("__d")) return { ok: false, error: `"${v}" contains "__d", which is reserved for derivative states. Rename the variable.` };
      alg.push(v);
    }
  }
  if (states.length + alg.length > DAE_MAX_UNKNOWNS) {
    return {
      ok: false,
      error: `This system has ${states.length + alg.length} unknowns (${states.length} differential states, ${alg.length} algebraic); the cap is ${DAE_MAX_UNKNOWNS}. ` +
        (alg.length ? `The algebraic ones are read as: ${alg.join(", ")} — a misspelt name becomes an extra unknown.` : ""),
    };
  }
  if (/(^|[^A-Za-z0-9_])e([^A-Za-z0-9_(]|$)/.test(eqs.replace(/\d[eE][+-]?\d/g, "0"))) {
    notes.push("A bare e is read as Euler's number 2.71828…, not as a variable.");
  }

  // --- Initial values and guesses, BY NAME ----------------------------------
  const initVals: Record<string, number> = {};
  const guesses: Record<string, number> = {};
  const seen = new Map<string, string>();
  const algSet = new Set(alg);
  for (const [field, text] of [["initial values", init], ["guesses", guess]] as const) {
    for (const part of splitTop(text.replace(/\r/g, ""), ",;\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*('*)\s*(?:\(\s*[^)]*\))?\s*=\s*(.+)$/.exec(part);
      if (!m) return { ok: false, error: `Couldn't read "${part}" in the ${field}. Write  name = value, e.g.  x = 1, u = 0.` };
      const [, base, primes, valueText] = m;
      const label = daeDerivLabel(base, primes.length);
      if (!IDENT.test(base)) return { ok: false, error: `"${base}" is not a variable name.` };
      const key = daeDerivVar(base, primes.length);
      const prev = seen.get(key);
      if (prev !== undefined) {
        return { ok: false, error: `${label} is given twice ("${prev}" and "${part}"). Give each initial value once.` };
      }
      seen.set(key, part);
      if (!stateSet.has(key) && !(primes.length === 0 && algSet.has(base))) {
        if (orderOf.has(base)) {
          return { ok: false, error: `${label} is not a state: ${base} is order ${orderOf.get(base)}, so its states are ${Array.from({ length: orderOf.get(base) as number }, (_x, j) => daeDerivLabel(base, j)).join(", ")}.` };
        }
        return { ok: false, error: `${label} has an initial value but no equation — no ${label}' = … line defines it and no constraint uses it. Remove it or add its equation.` };
      }
      const v = readConstant(valueText.trim(), label);
      if (!v.ok) return v;
      if (stateSet.has(key)) initVals[key] = v.v;
      else guesses[base] = v.v;
    }
  }
  const missing = states.filter((s) => !(s.varName in initVals));
  if (missing.length) {
    return {
      ok: false,
      error: `Missing an initial value for ${missing.map((s) => s.label).join(", ")}. Every differential state needs one, by name: ` +
        states.map((s) => `${s.label} = …`).join(", ") + ".",
    };
  }
  const guessed = Object.keys(guesses);
  if (guessed.length) {
    notes.push(`${guessed.join(", ")} ${guessed.length === 1 ? "is an algebraic unknown" : "are algebraic unknowns"}: the value given is only a starting guess — the consistent value is computed from the constraints.`);
  }

  return { ok: true, system: { diff, states, stateRhs, alg, cons, consText, init: initVals, guesses, notes } };
}
