/**
 * Markov chains — the `markov` verb of the equation kind.
 *
 * Everything is EXACT over the rationals of cas.ts: the transition matrix is
 * read with parseRatLiteral (0.1 is 1/10, not the nearest double), the
 * stationary distribution comes from systems.rref on πP = π, Σπ = 1, n-step
 * distributions from exact repeated squaring, and absorbing chains from
 * N = (I − Q)⁻¹ by the same rref. Classification (irreducible, closed and
 * transient classes, period) uses graphs.ts's strongly connected components
 * on the graph of positive entries. The state diagram is graphs.ts's figure.
 *
 * Refusals by name: a row that does not sum to 1 (the sum is shown, never
 * rounded), more than MAX_STATES states, a periodic chain asked for its
 * limit, a reducible chain asked for "the" stationary distribution, a chain
 * that is not absorbing asked for absorption times.
 */
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratToNumber, parseRatLiteral, RAT_ONE, RAT_ZERO, ratIsZero, ratEq, ratInt, ratSign } from "./cas";
import { fmtRat } from "./geometry";
import { rref } from "./systems";
import { parseGraph, strongComponents, graphSvg } from "./graphs";
import { eigenvaluesGeneral } from "./linalg";
import { groupedBarSvg } from "./statchart";
import type { VerbResult } from "./algebraTools";

export const MARKOV_VERB_RE = /^\s*(?:markov|transition\s+matrix|stationary\s+distribution|steady[- ]state|absorbing\s+(?:markov\s+)?chain|is\s+the\s+chain)\b|^\s*(?:markov\s+)?chain\s*\[\[/i;

const MAX_STATES = 12;
const MAX_STEPS = 200;

const refuse = (title: string, why: string, extra: string[] = []): VerbResult => ({ title, lines: [], caveats: [why, ...extra] });
const line = (text: string, math = false): { text: string; math?: boolean } => (math ? { text, math: true } : { text });
const sig6 = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x));
const fmt = (r: Rat): string => {
  const f = fmtRat(r);
  return f.length <= 24 ? f : sig6(ratToNumber(r));
};
const fmtWithDec = (r: Rat): string => {
  const f = fmtRat(r);
  if (f.length > 24) return `≈ ${sig6(ratToNumber(r))}`;
  return f.includes("/") ? `${f} ≈ ${sig6(ratToNumber(r))}` : f;
};
const allShort = (v: Rat[]): boolean => v.every((r) => fmtRat(r).length <= 24);
/** "(5/6, 1/6)  ≈ (0.833333, 0.166667)" when exact and printable; "≈ (…)" when the fractions are too long. */
const vecText = (v: Rat[]): string => {
  if (allShort(v)) {
    const ex = `(${v.map(fmtRat).join(", ")})`;
    return v.some((r) => fmtRat(r).includes("/")) ? `${ex}  ≈ (${v.map((r) => sig6(ratToNumber(r))).join(", ")})` : ex;
  }
  return `≈ (${v.map((r) => sig6(ratToNumber(r))).join(", ")})`;
};
const vec = (v: Rat[]): string => (allShort(v) ? `(${v.map(fmtRat).join(", ")})` : `≈ (${v.map((r) => sig6(ratToNumber(r))).join(", ")})`);
const LONG_NOTE = "Some exact fractions are too long to print; those entries are shown as decimals correctly rounded from the exact values (the checks ran on the exact values).";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Chain {
  P: Rat[][];
  n: number;
  names: string[];
}

function parseMatrixText(src: string): Rat[][] | string {
  let t = src.trim();
  // [[a, b], [c, d]]  |  a b; c d  |  rows on lines
  let rowsText: string[];
  if (t.startsWith("[[")) {
    const inner = /^\[\s*\[(.*)\]\s*\]$/s.exec(t);
    if (!inner) return "Unbalanced brackets in the matrix.";
    rowsText = inner[1].split(/\]\s*,?\s*\[/);
  } else if (t.startsWith("[")) {
    t = t.replace(/^\[|\]$/g, "");
    rowsText = t.split(/;|\n/);
  } else rowsText = t.split(/;|\n/);
  const rows: Rat[][] = [];
  for (const r of rowsText) {
    const cells = r
      .replace(/[[\]]/g, " ")
      .split(/\s*,\s*|\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!cells.length) continue;
    const row: Rat[] = [];
    for (const c of cells) {
      const v = parseRatLiteral(c);
      if (!v) return `"${c}" is not a number this reads exactly (decimals and fractions like 1/3 are; 0.3333 for 1/3 is not 1/3 — write 1/3).`;
      row.push(v);
    }
    rows.push(row);
  }
  if (!rows.length) return "No matrix found.";
  return rows;
}

function readChain(text: string, title: string): Chain | VerbResult {
  const mt = /(\[\[.*?\]\]|\[[^[\]]*\](?:\s*;\s*\[[^[\]]*\])+|(?:[-\d./]+(?:[ ,]+[-\d./]+)+\s*;\s*)+[-\d./]+(?:[ ,]+[-\d./]+)+)/s.exec(text);
  if (!mt) return refuse(title, "Give the transition matrix as [[0.9, 0.1], [0.5, 0.5]] (rows = from-state, columns = to-state), or rows separated by ;.");
  const rows = parseMatrixText(mt[1]);
  if (typeof rows === "string") return refuse(title, rows);
  const n = rows.length;
  if (n > MAX_STATES) return refuse(title, `${n} states: up to ${MAX_STATES} here (exact rational arithmetic keeps the denominators printable).`);
  if (rows.some((r) => r.length !== n)) return refuse(title, `The transition matrix must be square: ${n} rows but a row has ${rows.find((r) => r.length !== n)!.length} entries.`);
  for (let i = 0; i < n; i++) {
    let s = RAT_ZERO;
    for (const v of rows[i]) {
      if (ratSign(v) < 0 || ratSign(ratSub(v, RAT_ONE)) > 0) return refuse(title, `Entry row ${i + 1} = ${fmtRat(v)} is not a probability in [0, 1].`);
      s = ratAdd(s, v);
    }
    if (!ratEq(s, RAT_ONE)) return refuse(title, `Row ${i + 1} sums to ${fmtRat(s)}, not 1 — not a stochastic matrix (rows are the FROM state; each must sum to exactly 1). Nothing is rounded.`);
  }
  // optional state names: "states A, B, C"
  let names = rows.map((_, i) => `S${i + 1}`);
  const nm = /\bstates?\s*(?:named|are|:)?\s*([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)+)/i.exec(text);
  if (nm) {
    const given = nm[1].split(/\s*,\s*/);
    if (given.length === n) names = given;
  }
  return { P: rows, n, names };
}

// ---------------------------------------------------------------------------
// Exact linear algebra
// ---------------------------------------------------------------------------

function matMul(A: Rat[][], B: Rat[][]): Rat[][] {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const C: Rat[][] = [];
  for (let i = 0; i < n; i++) {
    const row: Rat[] = [];
    for (let j = 0; j < m; j++) {
      let s = RAT_ZERO;
      for (let t = 0; t < k; t++) if (!ratIsZero(A[i][t]) && !ratIsZero(B[t][j])) s = ratAdd(s, ratMul(A[i][t], B[t][j]));
      row.push(s);
    }
    C.push(row);
  }
  return C;
}
function identity(n: number): Rat[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? RAT_ONE : RAT_ZERO)));
}
function matPow(P: Rat[][], k: number): Rat[][] {
  let result = identity(P.length);
  let base = P;
  let e = k;
  while (e > 0) {
    if (e & 1) result = matMul(result, base);
    e >>= 1;
    if (e) base = matMul(base, base);
  }
  return result;
}
function rowVecMul(v: Rat[], P: Rat[][]): Rat[] {
  const n = P.length;
  const out: Rat[] = [];
  for (let j = 0; j < n; j++) {
    let s = RAT_ZERO;
    for (let i = 0; i < n; i++) if (!ratIsZero(v[i])) s = ratAdd(s, ratMul(v[i], P[i][j]));
    out.push(s);
  }
  return out;
}

/** Inverse by rref on [A | I]; null when singular. */
function inverse(A: Rat[][]): Rat[][] | null {
  const n = A.length;
  const aug = A.map((row, i) => [...row, ...identity(n)[i]]);
  // rref treats the LAST column as the augmentation marker (stops at nCols−1); add a dummy column.
  const r = rref(aug.map((row) => [...row, RAT_ZERO]));
  if (r.pivots.length !== n || r.pivots.some((p, i) => p !== i)) return null;
  return r.rows.map((row) => row.slice(n, 2 * n));
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

interface Structure {
  comps: number[][]; // SCCs, indices into states
  closed: boolean[]; // per component
  irreducible: boolean;
  period: number | null; // for an irreducible chain
  absorbing: number[]; // states with P_ii = 1
  reach: boolean[][]; // reach[i][j]
}

function analyse(c: Chain): Structure {
  const { P, n } = c;
  const edges: string[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!ratIsZero(P[i][j])) edges.push(`${c.names[i]}->${c.names[j]} ${sig6(ratToNumber(P[i][j]))}`);
  const g = parseGraph(edges.join("\n"))!.graph;
  // map graph vertex indices (sorted names) back to state indices
  const idx = (name: string): number => c.names.indexOf(name);
  const compsG = strongComponents(g);
  const comps = compsG.map((comp) => comp.map((v) => idx(g.names[v])).sort((a, b) => a - b));
  const reach: boolean[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => i === j));
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (reach[i][k] || !ratIsZero(P[i][k])) for (let j = 0; j < n; j++) if ((reach[i][k] || !ratIsZero(P[i][k])) && (reach[k][j] || !ratIsZero(P[k][j]))) reach[i][j] = true;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!ratIsZero(P[i][j])) reach[i][j] = true;
  const closed = comps.map((comp) => comp.every((i) => c.P[i].every((v, j) => ratIsZero(v) || comp.includes(j))));
  const irreducible = comps.length === 1;
  let period: number | null = null;
  if (irreducible) period = periodOf(c, comps[0]);
  const absorbing: number[] = [];
  for (let i = 0; i < n; i++) if (ratEq(P[i][i], RAT_ONE)) absorbing.push(i);
  return { comps, closed, irreducible, period, absorbing, reach };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Period of a closed communicating class: gcd over edges u→v of (level(u) + 1 − level(v)) from a BFS. */
function periodOf(c: Chain, comp: number[]): number {
  const inComp = new Set(comp);
  const level = new Map<number, number>();
  const start = comp[0];
  level.set(start, 0);
  const queue = [start];
  while (queue.length) {
    const u = queue.shift()!;
    for (let v = 0; v < c.n; v++) {
      if (ratIsZero(c.P[u][v]) || !inComp.has(v) || level.has(v)) continue;
      level.set(v, level.get(u)! + 1);
      queue.push(v);
    }
  }
  let d = 0;
  for (const u of comp) for (let v = 0; v < c.n; v++) if (!ratIsZero(c.P[u][v]) && inComp.has(v)) d = gcd(d, Math.abs(level.get(u)! + 1 - level.get(v)!));
  return d || 1;
}

/** Stationary distribution(s): unique for an irreducible chain; one per closed class otherwise. */
function stationary(c: Chain, states: number[]): Rat[] | null {
  // Restrict to the class, solve π(P − I) = 0 with Σπ = 1 → columns are equations.
  const m = states.length;
  const rows: Rat[][] = [];
  for (let j = 0; j < m; j++) {
    const row: Rat[] = [];
    for (let i = 0; i < m; i++) row.push(ratSub(c.P[states[i]][states[j]], i === j ? RAT_ONE : RAT_ZERO));
    row.push(RAT_ZERO);
    rows.push(row);
  }
  rows.push([...Array.from({ length: m }, () => RAT_ONE), RAT_ONE]);
  const r = rref(rows);
  if (r.pivots.length !== m) return null;
  const pi: Rat[] = Array.from({ length: m }, () => RAT_ZERO);
  r.pivots.forEach((col, i) => (pi[col] = r.rows[i][m]));
  // consistency: every non-pivot row must be 0 = 0
  for (let i = r.pivots.length; i < r.rows.length; i++) if (!ratIsZero(r.rows[i][m])) return null;
  return pi;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

function diagramSvg(c: Chain, caption: string): string {
  const edges: string[] = [];
  // parseGraph reads decimal weights only; the exact fraction goes on the label.
  for (let i = 0; i < c.n; i++) for (let j = 0; j < c.n; j++) if (!ratIsZero(c.P[i][j])) edges.push(`${c.names[i]}->${c.names[j]} ${sig6(ratToNumber(c.P[i][j]))}`);
  const parsed = parseGraph(edges.join("\n"));
  if (!parsed) return "";
  const g = parsed.graph;
  const labels = new Map<number, string>();
  for (const e of g.edges) {
    const i = c.names.indexOf(g.names[e.u]);
    const j = c.names.indexOf(g.names[e.v]);
    const p = c.P[i][j];
    labels.set(e.id, fmtRat(p).length <= 6 ? fmtRat(p) : sig6(ratToNumber(p)));
  }
  // Self-loop labels sit outside the ring of states: give the canvas room.
  return graphSvg(g, { caption, edgeLabels: labels }, 520, 400);
}

function stationaryBarsSvg(c: Chain, pi: Rat[], title: string): string {
  return groupedBarSvg(c.names, [{ label: "π", values: pi.map(ratToNumber) }], { title, ylabel: "probability", w: 420, h: 240 });
}

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

export function tryMarkov(input: string): VerbResult | null {
  // rows on lines → rows separated by ";"
  const text = input
    .replace(/\r/g, "")
    .replace(/(\d[\d\s./,]*)\n(?=\s*[-\d.])/g, "$1 ; ")
    .replace(/\s+/g, " ")
    .trim();
  if (!MARKOV_VERB_RE.test(text) && !/\btransition\b.*\[\[/i.test(text)) return null;
  const title = "Markov chain";
  // No matrix and no "markov" word: "steady state concentration", "transition
  // matrix of the basis change" are not ours.
  if (!/\[\[|;|\d\s+\d/.test(text) && !/\bmarkov\b/i.test(text)) return null;
  // Questions this verb does not answer are refused BY NAME, not answered
  // with the stationary distribution.
  if (/first passage|hitting time|P\s*\(\s*X_|commute time|mixing time|entropy rate|continuous[- ]time|generator/i.test(text)) {
    return refuse(title, "Not answered here: first-passage / hitting times, P(X_n = j | X_0 = i) for specific n and states, mixing times and continuous-time chains are outside this verb. It gives the stationary distribution, classification, the distribution after k steps (\"after 3 steps from (1, 0)\" — the j-th entry IS P(X_k = j | X_0)), and absorbing-chain expected steps and probabilities.");
  }
  const chain = readChain(text, title);
  if ("lines" in chain) return chain;
  const c = chain;
  const S = analyse(c);
  const lines: VerbResult["lines"] = [];
  const caveats: string[] = [];
  lines.push(line(`P = [${c.P.map((r) => `[${r.map(fmt).join(", ")}]`).join(", ")}]   (rows: from ${c.names.join(", ")}; columns: to the same)`));

  // --- classification (always shown) ---
  const classText = S.comps
    .map((comp, k) => `{${comp.map((i) => c.names[i]).join(", ")}}${S.closed[k] ? " (closed)" : " (transient)"}`)
    .join(", ");
  if (S.irreducible) lines.push(line(`Irreducible (every state reaches every other); period ${S.period}${S.period === 1 ? " — aperiodic" : ""}.`));
  else lines.push(line(`Reducible: communicating classes ${classText}.`));
  if (S.absorbing.length) lines.push(line(`Absorbing state${S.absorbing.length > 1 ? "s" : ""}: ${S.absorbing.map((i) => c.names[i]).join(", ")}.`));

  // --- n-step ---
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const textN = text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(steps?|transitions?)\b/gi, (_, w, u) => `${WORDS[w.toLowerCase()]} ${u}`).replace(/\bP\s*\^\s*(\d+)|\b(\d+)-step\b/gi, (_, a, b) => `after ${a ?? b} steps`);
  const stepM = /(?:after|in|steps?|n\s*=)\s*(\d+)\s*(?:steps?|transitions?)?|(\d+)\s*(?:steps?|transitions?)/i.exec(textN);
  const fromM = /(?:from|start(?:ing)?\s+(?:at|in|from)?|initial(?:\s+distribution)?)\s*\(?\s*([-\d./]+(?:\s*,\s*[-\d./]+)*)\s*\)?/i.exec(text);
  const fromStateM = !fromM ? /(?:from|start(?:ing)?\s+(?:at|in))\s+state\s+(\w+)/i.exec(text) : null;
  if (stepM) {
    const k = Number(stepM[1] ?? stepM[2]);
    const cap = c.n <= 6 ? MAX_STEPS : 50; // 12 states × 200 exact steps took 10 s
    if (!(k >= 0) || k > cap) return refuse(title, `Steps must be 0..${cap} for the exact power with ${c.n} states (ask for the stationary distribution for the long run).`);
    let v0: Rat[];
    if (fromM) {
      const parts = fromM[1].split(/\s*,\s*/).map((p) => parseRatLiteral(p));
      if (parts.some((p) => !p) || parts.length !== c.n) return refuse(title, `The starting distribution needs ${c.n} exact entries.`);
      v0 = parts as Rat[];
      const s = v0.reduce((a, b) => ratAdd(a, b), RAT_ZERO);
      if (!ratEq(s, RAT_ONE)) return refuse(title, `The starting distribution sums to ${fmtRat(s)}, not 1.`);
    } else if (fromStateM) {
      const i = c.names.indexOf(fromStateM[1]);
      if (i < 0) return refuse(title, `"${fromStateM[1]}" is not a state (${c.names.join(", ")}).`);
      v0 = c.names.map((_, j) => (j === i ? RAT_ONE : RAT_ZERO));
    } else {
      v0 = c.names.map((_, j) => (j === 0 ? RAT_ONE : RAT_ZERO));
      caveats.push(`No starting distribution given: started in ${c.names[0]} (write "from (1, 0, …)" or "from state S2").`);
    }
    const Pk = matPow(c.P, k);
    const vk = rowVecMul(v0, Pk);
    // cross-check: v·P applied k times, step by step
    let w = v0;
    for (let i = 0; i < k; i++) w = rowVecMul(w, c.P);
    const same = w.every((x, i) => ratEq(x, vk[i]));
    const rowsOk = Pk.every((r) => ratEq(r.reduce((a, b) => ratAdd(a, b), RAT_ZERO), RAT_ONE));
    if (!same || !rowsOk) return refuse(title, "Cross-check FAILED: the exact power disagreed with step-by-step multiplication — withheld.");
    lines.push(line(`Distribution after ${k} step${k === 1 ? "" : "s"} from ${vec(v0)}: ${vecText(vk)}`));
    if (!allShort(vk)) caveats.push(LONG_NOTE);
    vk.forEach((x, i) => lines.push(line(fmtRat(x).length <= 24 ? fmtRat(x) : sig6(ratToNumber(x)), true)));
    if (k <= 6) lines.push(line(`P^${k} = [${Pk.map((r) => `[${r.map(fmt).join(", ")}]`).join(", ")}]`));
    caveats.push("Verified: the exact matrix power agrees with k successive multiplications, and every row of Pᵏ sums to 1.");
  }

  // --- absorbing analysis ---
  const wantsAbsorb = /absorb|expected (?:number of )?steps|time to absorption|absorption/i.test(text);
  if (wantsAbsorb || (S.absorbing.length && !stepM && !/stationary|steady|limit/i.test(text))) {
    if (!S.absorbing.length) return refuse(title, "No absorbing state (a state with P_ii = 1), so this is not an absorbing chain.", [`Classes: ${classText}.`]);
    const transient = c.names.map((_, i) => i).filter((i) => !S.absorbing.includes(i));
    const stuck = transient.filter((i) => !S.absorbing.some((a) => S.reach[i][a]));
    if (stuck.length) return refuse(title, `State${stuck.length > 1 ? "s" : ""} ${stuck.map((i) => c.names[i]).join(", ")} cannot reach any absorbing state, so absorption is not certain and N = (I − Q)⁻¹ does not describe it.`);
    if (!transient.length) {
      lines.push(line("Every state is absorbing; nothing moves."));
    } else {
      const Q = transient.map((i) => transient.map((j) => c.P[i][j]));
      const R = transient.map((i) => S.absorbing.map((j) => c.P[i][j]));
      const IQ = Q.map((row, i) => row.map((v, j) => ratSub(i === j ? RAT_ONE : RAT_ZERO, v)));
      const N = inverse(IQ);
      if (!N) return refuse(title, "I − Q is singular — withheld (absorption from some transient state is not certain).");
      const t = N.map((row) => row.reduce((a, b) => ratAdd(a, b), RAT_ZERO));
      const B = matMul(N, R);
      // verify: (I − Q)·N = I, rows of B sum to 1
      const chk = matMul(IQ, N);
      const isI = chk.every((row, i) => row.every((v, j) => ratEq(v, i === j ? RAT_ONE : RAT_ZERO)));
      const bRows = B.every((row) => ratEq(row.reduce((a, b) => ratAdd(a, b), RAT_ZERO), RAT_ONE));
      if (!isI || !bRows) return refuse(title, "Cross-check FAILED on N = (I − Q)⁻¹ — withheld.");
      lines.push(line(`Transient states ${transient.map((i) => c.names[i]).join(", ")}; Q = [${Q.map((r) => `[${r.map(fmt).join(", ")}]`).join(", ")}], R = [${R.map((r) => `[${r.map(fmt).join(", ")}]`).join(", ")}]`));
      lines.push(line(`Fundamental matrix N = (I − Q)⁻¹ = [${N.map((r) => `[${r.map(fmt).join(", ")}]`).join(", ")}]   (N_ij = expected visits to ${"j"} starting from i)`));
      transient.forEach((i, a) => {
        lines.push(line(`Expected steps to absorption from ${c.names[i]}: ${fmtWithDec(t[a])}`));
        lines.push(line(fmt(t[a]), true));
      });
      transient.forEach((i, a) => {
        lines.push(line(`From ${c.names[i]}: absorbed in ${S.absorbing.map((j, b) => `${c.names[j]} with probability ${fmtWithDec(B[a][b])}`).join(", ")}`));
      });
      caveats.push("Verified: (I − Q)·N = I exactly, and each row of B = N·R sums to 1.");
    }
    return { title, lines, caveats, svg: diagramSvg(c, `Markov chain: ${S.absorbing.length} absorbing state${S.absorbing.length > 1 ? "s" : ""}`), alt: "State diagram of the absorbing Markov chain." };
  }

  // --- stationary / limit (default) ---
  const wantsStationary = !stepM || /stationary|steady|limit|long run/i.test(text);
  if (wantsStationary) {
    if (S.irreducible) {
      const pi = stationary(c, c.names.map((_, i) => i));
      if (!pi) return refuse(title, "The stationary equations πP = π, Σπ = 1 had no unique solution — withheld (this should not happen for an irreducible chain; please report the matrix).");
      const back = rowVecMul(pi, c.P);
      if (!back.every((x, i) => ratEq(x, pi[i]))) return refuse(title, "Cross-check FAILED: πP ≠ π for the solution found — withheld.");
      lines.push(line(`Stationary distribution π (πP = π, Σπ = 1): π = ${vecText(pi)}`));
      if (!allShort(pi)) caveats.push(LONG_NOTE);
      pi.forEach((x) => lines.push(line(fmt(x), true)));
      if (S.period === 1) lines.push(line(`Irreducible and aperiodic, so π is also the LIMIT distribution: from any start, the distribution after n steps → π, and the long-run fraction of time in ${c.names[0]} is ${fmt(pi[0])}.`));
      else lines.push(line(`Period ${S.period}: π is stationary and gives the long-run fractions of time, but there is NO limit distribution — the chain cycles with period ${S.period}, so P^n does not converge.`));
      const rt = /(?:expected\s+)?return\s+time\s+(?:to|of)\s+(\w+)/i.exec(text);
      if (rt) {
        const i = c.names.indexOf(rt[1]);
        if (i < 0) return refuse(title, `"${rt[1]}" is not a state (${c.names.join(", ")}).`);
        const r = ratDiv(RAT_ONE, pi[i]);
        lines.push(line(`Expected return time to ${c.names[i]} = 1/π_${i + 1} = ${fmtWithDec(r)} steps`));
        lines.push(line(fmt(r), true));
      }
      // eigenvalue cross-check
      const ev = eigenvaluesGeneral(c.P.map((r) => r.map(ratToNumber)));
      if (ev) {
        const hasOne = ev.some((z) => Math.abs(z.re - 1) < 1e-8 && Math.abs(z.im) < 1e-8);
        const maxMod = Math.max(...ev.map((z) => Math.hypot(z.re, z.im)));
        caveats.push(hasOne && maxMod <= 1 + 1e-8 ? "Verified: πP = π exactly; the eigenvalues (floating point) include 1 and none exceeds 1 in modulus." : "Cross-check note: the floating-point eigenvalues did not show the expected spectrum (1 present, all |λ| ≤ 1) — the exact πP = π check still passed.");
      } else caveats.push("Verified: πP = π exactly.");
      return { title, lines, caveats, svg: diagramSvg(c, `Markov chain (${c.n} states): π = ${vec(pi)}`), alt: `State diagram; stationary distribution ${vec(pi)}.` };
    }
    // reducible
    const closedIdx = S.comps.map((_, k) => k).filter((k) => S.closed[k]);
    const extras: string[] = [];
    for (const k of closedIdx) {
      const comp = S.comps[k];
      const pi = stationary(c, comp);
      if (pi) extras.push(`on {${comp.map((i) => c.names[i]).join(", ")}}: ${vec(pi)}`);
    }
    if (closedIdx.length === 1) {
      const comp = S.comps[closedIdx[0]];
      const piC = stationary(c, comp)!;
      const pi = c.names.map((_, i) => (comp.includes(i) ? piC[comp.indexOf(i)] : RAT_ZERO));
      lines.push(line(`One closed class {${comp.map((i) => c.names[i]).join(", ")}}; the transient states ${S.comps.filter((__, k) => !S.closed[k]).flat().map((i) => c.names[i]).join(", ")} are left for good, so the unique stationary distribution puts 0 on them: π = ${vec(pi)}`));
      pi.forEach((x) => lines.push(line(fmt(x), true)));
      caveats.push("Verified: πP = π exactly on the closed class.");
      return { title, lines, caveats, svg: diagramSvg(c, `Reducible chain: π = ${vec(pi)}`), alt: "State diagram of a reducible chain." };
    }
    lines.push(line(`${closedIdx.length} closed classes, so there is no single stationary distribution: every mixture of the class stationary distributions is stationary — ${extras.join("; ")}.`));
    caveats.push("A reducible chain with several closed classes has a stationary distribution for EACH closed class; which one the long run settles into depends on the start.");
    return { title, lines, caveats, svg: diagramSvg(c, `Reducible chain: ${closedIdx.length} closed classes`), alt: "State diagram of a reducible chain." };
  }
  return { title, lines, caveats, svg: diagramSvg(c, `Markov chain (${c.n} states)`), alt: "State diagram." };
}
