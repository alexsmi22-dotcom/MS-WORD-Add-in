// Digital logic — truth tables and Boolean minimisation.
//
// MINIMISATION IS DONE BY QUINE-McCLUSKEY, NOT BY A KARNAUGH MAP. The K-map is
// the method taught because a human can see it, and it stops working at about
// five variables because a human cannot see five dimensions. Quine-McCluskey is
// the same algorithm made explicit — combine terms that differ in one bit,
// repeat until nothing combines, then choose a minimal cover of the prime
// implicants — and it does not care how many variables there are. What it costs
// is that the prime-implicant cover step is genuinely hard (it is set cover),
// so the exact search is capped and the result says when it fell back.
//
// A MINIMAL EXPRESSION IS NOT UNIQUE. When several prime implicants cover the
// same remaining minterms at the same cost, there are genuinely different
// expressions of identical size, and a textbook answer key showing one of them
// does not make the others wrong. The number of alternatives found is reported
// rather than one arbitrary choice being presented as the answer.
//
// DON'T-CARES ARE A DESIGN INPUT, NOT MISSING DATA. A don't-care means the
// input combination cannot occur, so the minimiser may set the output either
// way to simplify — and it usually can, often dramatically. They are accepted
// separately from the minterms and the result says which were used, because a
// don't-care that turns out to be reachable is a latent bug that no amount of
// logic simplification will reveal.

export interface LogicError {
  ok: false;
  error: string;
}

/** A pane recomputes on every keystroke; 2^n grows fast. */
const MAX_VARS = 10;

export interface TruthRow {
  /** Input values, most significant variable first. */
  inputs: boolean[];
  output: boolean;
}

export interface TruthTable {
  ok: true;
  variables: string[];
  rows: TruthRow[];
  /** Row indices where the output is true. */
  minterms: number[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Expression parsing and evaluation
// ---------------------------------------------------------------------------

type Node =
  | { k: "var"; name: string }
  | { k: "const"; v: boolean }
  | { k: "not"; a: Node }
  | { k: "and"; a: Node; b: Node }
  | { k: "or"; a: Node; b: Node }
  | { k: "xor"; a: Node; b: Node };

/**
 * Parses a Boolean expression.
 *
 * ACCEPTS THE THREE NOTATIONS PEOPLE ACTUALLY MIX, because a student copying
 * from one textbook and a datasheet from another will use all of them in the
 * same session: `A AND B`, `A & B`, `A * B` for conjunction; `OR`, `|`, `+`;
 * `NOT`, `!`, `~`, and a trailing `'` for negation. Precedence is the standard
 * NOT > AND > XOR > OR, which is the one place the notations agree.
 */
function parseExpression(text: string, variables: string[]): Node | LogicError {
  // WHITESPACE IS SKIPPED, NOT STRIPPED. Removing it up front turns "A AND B"
  // into "AANDB", which the identifier matcher then swallows whole — the word
  // operators need their boundaries. Caught by an oracle test on the most basic
  // expression in the language.
  const src = text;
  let i = 0;

  // Longest variable name first, so implicit AND works ("AB" is A then B) while
  // multi-character names ("X1") still match as one token.
  const byLength = [...variables].sort((a, b) => b.length - a.length);
  const WORD_OPS = ["AND", "OR", "XOR", "NAND", "NOR"];

  const skipWs = (): void => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const peek = (): string => {
    skipWs();
    return src[i] ?? "";
  };
  const eat = (t: string): boolean => {
    skipWs();
    if (src.startsWith(t, i)) {
      i += t.length;
      return true;
    }
    return false;
  };
  const eatWord = (w: string): boolean => {
    skipWs();
    if (src.slice(i, i + w.length).toUpperCase() === w) {
      const after = src[i + w.length] ?? "";
      if (!/[A-Za-z0-9_]/.test(after)) {
        i += w.length;
        return true;
      }
    }
    return false;
  };
  /** True when a word operator starts here, so implicit AND must not fire. */
  const atWordOp = (): boolean => {
    skipWs();
    for (const w of WORD_OPS) {
      if (src.slice(i, i + w.length).toUpperCase() === w) {
        const after = src[i + w.length] ?? "";
        if (!/[A-Za-z0-9_]/.test(after)) return true;
      }
    }
    return false;
  };
  const matchVariable = (): string | null => {
    skipWs();
    for (const v of byLength) {
      if (src.startsWith(v, i)) {
        const after = src[i + v.length] ?? "";
        // A longer identifier starting with this name is not this variable.
        if (/[A-Za-z0-9_]/.test(after) && byLength.some((o) => o !== v && src.startsWith(o, i) && o.length > v.length)) {
          continue;
        }
        return v;
      }
    }
    return null;
  };

  let error: string | null = null;

  const postfix = (n: Node): Node => {
    let out = n;
    while (eat("'")) out = { k: "not", a: out };
    return out;
  };

  const parsePrimary = (): Node | null => {
    if (eat("(")) {
      const inner = parseOr();
      if (!inner) return null;
      if (!eat(")")) {
        error = "A bracket was opened and never closed.";
        return null;
      }
      return postfix(inner);
    }
    skipWs();
    if (eat("1")) return postfix({ k: "const", v: true });
    if (eat("0")) return postfix({ k: "const", v: false });
    const v = matchVariable();
    if (v !== null) {
      i += v.length;
      return postfix({ k: "var", name: v });
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (ident) {
      error = `"${ident[0]}" is not one of the variables (${variables.join(", ")}).`;
      return null;
    }
    error = i >= src.length ? "The expression ended unexpectedly." : `Unexpected "${src[i]}".`;
    return null;
  };

  const parseNot = (): Node | null => {
    if (eat("!") || eat("~") || eatWord("NOT")) {
      const a = parseNot();
      return a ? { k: "not", a } : null;
    }
    return parsePrimary();
  };

  const parseAnd = (): Node | null => {
    let a = parseNot();
    if (!a) return null;
    for (;;) {
      if (eat("&&") || eat("&") || eat("*") || eat(".") || eatWord("AND")) {
        const b = parseNot();
        if (!b) return null;
        a = { k: "and", a, b };
        continue;
      }
      // IMPLICIT AND: "AB" means A AND B, which is how printed Boolean algebra
      // is written. It must not fire on a word operator, or "A OR B" would parse
      // as A AND (a variable called O)...
      if (!atWordOp() && /[A-Za-z_(!~]/.test(peek())) {
        const b = parseNot();
        if (!b) return null;
        a = { k: "and", a, b };
        continue;
      }
      break;
    }
    return a;
  };

  const parseXor = (): Node | null => {
    let a = parseAnd();
    if (!a) return null;
    while (eat("^") || eatWord("XOR")) {
      const b = parseAnd();
      if (!b) return null;
      a = { k: "xor", a, b };
    }
    return a;
  };

  function parseOr(): Node | null {
    let a = parseXor();
    if (!a) return null;
    while (eat("||") || eat("|") || eat("+") || eatWord("OR")) {
      const b = parseXor();
      if (!b) return null;
      a = { k: "or", a, b };
    }
    return a;
  }

  if (!src.trim()) return { ok: false, error: "The expression is empty." };
  const root = parseOr();
  if (!root) return { ok: false, error: error ?? "The expression could not be parsed." };
  skipWs();
  if (i < src.length) return { ok: false, error: `Unexpected "${src.slice(i)}" at the end of the expression.` };
  return root;
}

function evaluate(n: Node, env: Record<string, boolean>): boolean {
  switch (n.k) {
    case "var":
      return env[n.name];
    case "const":
      return n.v;
    case "not":
      return !evaluate(n.a, env);
    case "and":
      return evaluate(n.a, env) && evaluate(n.b, env);
    case "or":
      return evaluate(n.a, env) || evaluate(n.b, env);
    case "xor":
      return evaluate(n.a, env) !== evaluate(n.b, env);
  }
}

/** Builds the full truth table of a Boolean expression. */
export function truthTable(expression: string, variableList: string): TruthTable | LogicError {
  const variables = variableList
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((v) => v.trim());
  if (!variables.length) return { ok: false, error: "Give at least one variable." };
  if (variables.length > MAX_VARS) {
    return {
      ok: false,
      error: `${variables.length} variables means ${2 ** variables.length} rows; the limit is ${MAX_VARS} variables.`,
    };
  }
  const seen = new Set<string>();
  for (const v of variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return { ok: false, error: `"${v}" is not a valid variable name.` };
    if (seen.has(v)) return { ok: false, error: `Variable "${v}" is listed twice.` };
    seen.add(v);
  }

  const ast = parseExpression(expression, variables);
  if ("ok" in ast) return ast;

  const n = variables.length;
  const rows: TruthRow[] = [];
  const minterms: number[] = [];
  for (let row = 0; row < 1 << n; row++) {
    const inputs: boolean[] = [];
    const env: Record<string, boolean> = {};
    for (let b = 0; b < n; b++) {
      // Most significant variable first, so the table reads in the usual order.
      const val = ((row >> (n - 1 - b)) & 1) === 1;
      inputs.push(val);
      env[variables[b]] = val;
    }
    const output = evaluate(ast as Node, env);
    rows.push({ inputs, output });
    if (output) minterms.push(row);
  }

  const notes: string[] = [];
  if (!minterms.length) notes.push("The output is FALSE for every input: this expression is a contradiction.");
  if (minterms.length === rows.length) notes.push("The output is TRUE for every input: this expression is a tautology.");

  return { ok: true, variables, rows, minterms, notes };
}

// ---------------------------------------------------------------------------
// Quine-McCluskey minimisation
// ---------------------------------------------------------------------------

/** An implicant: `bits` with `mask` marking the positions that are don't-care. */
interface Implicant {
  bits: number;
  mask: number;
  covers: number[];
}

export interface MinimiseResult {
  ok: true;
  variables: string[];
  /** The minimised sum-of-products expression. */
  expression: string;
  /** Each product term, as a readable string. */
  terms: string[];
  /** Every prime implicant found, before the cover was chosen. */
  primeImplicants: string[];
  /** Implicants that MUST be in any cover. */
  essential: string[];
  /** Number of equally minimal alternative expressions found. */
  alternatives: number;
  /** Literal count of the result, the usual measure of cost. */
  literals: number;
  notes: string[];
}

function implicantToString(imp: Implicant, variables: string[]): string {
  const n = variables.length;
  const parts: string[] = [];
  for (let b = 0; b < n; b++) {
    const bit = 1 << (n - 1 - b);
    if (imp.mask & bit) continue;
    parts.push(imp.bits & bit ? variables[b] : `${variables[b]}'`);
  }
  return parts.length ? parts.join("") : "1";
}

/**
 * Minimises a Boolean function to a sum of products.
 *
 * THE COVER STEP IS SET COVER, WHICH IS NP-HARD. Essential prime implicants are
 * found exactly and always; what remains is a genuine set-cover problem, solved
 * exactly by exhaustive search while the remaining problem is small and by a
 * greedy heuristic when it is not. The result SAYS which happened, because
 * "minimal" from a greedy pass is not a proof of minimality and presenting it
 * as one would be the wrong kind of confidence.
 */
export function minimise(
  minterms: number[],
  variables: string[],
  dontCares: number[] = [],
): MinimiseResult | LogicError {
  const n = variables.length;
  if (!n || n > MAX_VARS) return { ok: false, error: `The number of variables must be between 1 and ${MAX_VARS}.` };
  const limit = 1 << n;
  for (const m of [...minterms, ...dontCares]) {
    if (!Number.isInteger(m) || m < 0 || m >= limit) {
      return { ok: false, error: `Minterm ${m} is outside the range 0 to ${limit - 1} for ${n} variables.` };
    }
  }
  const mset = new Set(minterms);
  const dset = new Set(dontCares.filter((d) => !mset.has(d)));
  const notes: string[] = [];

  if (!mset.size) {
    return {
      ok: true,
      variables,
      expression: "0",
      terms: [],
      primeImplicants: [],
      essential: [],
      alternatives: 1,
      literals: 0,
      notes: ["The function is FALSE everywhere; the minimal expression is the constant 0."],
    };
  }
  if (mset.size + dset.size === limit && mset.size === limit) {
    return {
      ok: true,
      variables,
      expression: "1",
      terms: ["1"],
      primeImplicants: ["1"],
      essential: ["1"],
      alternatives: 1,
      literals: 0,
      notes: ["The function is TRUE everywhere; the minimal expression is the constant 1."],
    };
  }

  // --- Find prime implicants by repeated one-bit combination. -------------
  const all = [...mset, ...dset].sort((a, b) => a - b);
  let current: Implicant[] = all.map((m) => ({ bits: m, mask: 0, covers: [m] }));
  const primes: Implicant[] = [];
  const seenKey = new Set<string>();

  for (let round = 0; round <= n; round++) {
    const next: Implicant[] = [];
    const combined = new Array(current.length).fill(false);
    const nextSeen = new Set<string>();
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        if (a.mask !== b.mask) continue;
        const diff = a.bits ^ b.bits;
        // Combinable exactly when they differ in a single non-masked bit.
        if (diff === 0 || (diff & (diff - 1)) !== 0) continue;
        combined[i] = true;
        combined[j] = true;
        const merged: Implicant = {
          bits: a.bits & ~diff,
          mask: a.mask | diff,
          covers: [...new Set([...a.covers, ...b.covers])],
        };
        const key = `${merged.bits}|${merged.mask}`;
        if (!nextSeen.has(key)) {
          nextSeen.add(key);
          next.push(merged);
        }
      }
    }
    for (let i = 0; i < current.length; i++) {
      if (!combined[i]) {
        const key = `${current[i].bits}|${current[i].mask}`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          primes.push(current[i]);
        }
      }
    }
    if (!next.length) break;
    current = next;
  }

  // --- Essential prime implicants. ----------------------------------------
  const required = [...mset].sort((a, b) => a - b);
  const coversOf = (imp: Implicant): Set<number> => new Set(imp.covers.filter((c) => mset.has(c)));
  const primeCovers = primes.map(coversOf);

  const essentialIdx = new Set<number>();
  for (const m of required) {
    const owners: number[] = [];
    for (let p = 0; p < primes.length; p++) if (primeCovers[p].has(m)) owners.push(p);
    if (owners.length === 1) essentialIdx.add(owners[0]);
  }

  const covered = new Set<number>();
  for (const p of essentialIdx) for (const m of primeCovers[p]) covered.add(m);
  const remaining = required.filter((m) => !covered.has(m));

  // --- Cover the rest. ----------------------------------------------------
  const candidates = primes
    .map((_, idx) => idx)
    .filter((idx) => !essentialIdx.has(idx) && [...primeCovers[idx]].some((m) => !covered.has(m)));

  let chosen: number[] = [...essentialIdx];
  let alternatives = 1;
  let exact = true;

  if (remaining.length) {
    // Exhaustive over subsets while that is small; the cost is 2^candidates.
    const MAX_EXHAUSTIVE = 20;
    if (candidates.length <= MAX_EXHAUSTIVE) {
      let bestSize = Infinity;
      let bestLiterals = Infinity;
      let best: number[] | null = null;
      let count = 0;
      const total = 1 << candidates.length;
      for (let mask = 0; mask < total; mask++) {
        const pick: number[] = [];
        for (let b = 0; b < candidates.length; b++) if (mask & (1 << b)) pick.push(candidates[b]);
        if (pick.length > bestSize) continue;
        const got = new Set<number>();
        for (const p of pick) for (const m of primeCovers[p]) got.add(m);
        if (!remaining.every((m) => got.has(m))) continue;
        const lits = pick.reduce((s, p) => s + (n - popcount(primes[p].mask)), 0);
        if (pick.length < bestSize || (pick.length === bestSize && lits < bestLiterals)) {
          bestSize = pick.length;
          bestLiterals = lits;
          best = pick;
          count = 1;
        } else if (pick.length === bestSize && lits === bestLiterals) {
          count++;
        }
      }
      if (best) {
        chosen = [...essentialIdx, ...best];
        alternatives = count;
      }
    } else {
      exact = false;
      // Greedy: repeatedly take the implicant covering the most of what is left.
      const left = new Set(remaining);
      const pool = [...candidates];
      let guard = 0;
      while (left.size && guard++ < 1000) {
        let bestP = -1;
        let bestGain = 0;
        for (const p of pool) {
          let gain = 0;
          for (const m of primeCovers[p]) if (left.has(m)) gain++;
          if (gain > bestGain) {
            bestGain = gain;
            bestP = p;
          }
        }
        if (bestP < 0) break;
        chosen.push(bestP);
        for (const m of primeCovers[bestP]) left.delete(m);
        pool.splice(pool.indexOf(bestP), 1);
      }
      notes.push(
        `There were ${candidates.length} non-essential prime implicants, too many to search ` +
          "exhaustively, so the remaining cover was chosen greedily. The result is a valid and " +
          "usually minimal expression, but it is NOT PROVEN MINIMAL — minimal-cover selection is " +
          "set cover, which is NP-hard, and a greedy answer is not a proof.",
      );
    }
  }

  const terms = chosen.map((p) => implicantToString(primes[p], variables));
  const literals = chosen.reduce((s, p) => s + (n - popcount(primes[p].mask)), 0);
  const expression = terms.length ? terms.join(" + ") : "0";

  if (essentialIdx.size) {
    notes.push(
      `${essentialIdx.size} of the ${primes.length} prime implicants are ESSENTIAL — each is the ` +
        "only one covering some minterm, so every minimal expression must contain all of them.",
    );
  }
  if (alternatives > 1 && exact) {
    notes.push(
      `There are ${alternatives} equally minimal expressions of this function. A different textbook ` +
        "answer of the same size is not a different result — minimal sum-of-products form is NOT " +
        "unique, and none of them is more correct than another.",
    );
  }
  if (dset.size) {
    const used = chosen.some((p) => primes[p].covers.some((c) => dset.has(c)));
    notes.push(
      used
        ? `Don't-cares were USED to simplify this expression. That is their purpose — but it means ` +
          "the output is now defined for input combinations you declared impossible. If any of " +
          "them can actually occur, the circuit does something you did not specify."
        : "The don't-cares did not help simplify this particular function.",
    );
  }
  notes.push(
    `Cost: ${terms.length} product term(s), ${literals} literal(s). Literal count is the usual ` +
      "measure because it tracks gate inputs, which is what silicon area and propagation delay " +
      "actually scale with — not the number of terms.",
  );

  return {
    ok: true,
    variables,
    expression,
    terms,
    primeImplicants: primes.map((p) => implicantToString(p, variables)),
    essential: [...essentialIdx].map((p) => implicantToString(primes[p], variables)),
    alternatives,
    literals,
    notes,
  };
}

function popcount(x: number): number {
  let c = 0;
  let v = x;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}
