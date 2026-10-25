/**
 * Two-player finite games in strategic form (Release E5c, game-nash): iterated elimination of strictly dominated
 * strategies, pure Nash equilibria, ALL mixed equilibria of a nondegenerate game by support enumeration, and the value
 * of a zero-sum (or constant-sum) game by linear programming.
 *
 * EXACT throughout: payoffs are cas.ts rationals and every equilibrium is solved and VERIFIED in rational arithmetic
 * against the full game (strategies removed by elimination included): both mixes sum to one, every strategy in a
 * support earns the same expected payoff, and no pure strategy earns strictly more.
 *
 * Support enumeration (von Stengel 2007, "Equilibrium computation for two-player games in strategic and extensive
 * form", Algorithmic Game Theory ch. 3, §3.4): for every pair of supports I (rows) and J (columns) of EQUAL size k, the
 * column mix y on J must make the row player indifferent over I (row payoffs A) and the row mix x on I must make the
 * column player indifferent over J (column payoffs B). In a nondegenerate game every equilibrium has equal-size
 * supports and the linear systems are nonsingular, so the enumeration finds them all and their number is odd. A
 * degenerate game can have a continuum; the enumeration then lists what it found at equal-size supports with a unique
 * solution, and the caller says it may not be all.
 *
 * Degeneracy (von Stengel's definition: some mixed strategy with support size k has more than k pure best responses)
 * is PROVED by either of: (1) a pure strategy with two or more pure best responses (support size 1); (2) a found
 * equilibrium in which a player has more pure best responses than the opponent's support size. A third signal is only
 * a caution: (3) an equal-size support pair whose indifference system is singular with infinitely many solutions
 * (skipped by the enumeration; an inconsistent singular system has no solution and skips nothing). Neither proof is
 * necessary for degeneracy, so a game that passes all three is called nondegenerate "by the tests used".
 *
 * Cost: the support pairs are Σₖ C(m, k)·C(n, k) ≤ 12,870 at 8 × 8; every pair checks a wall clock (NASH_WALL_MS)
 * and the run refuses by name if it runs out. Games larger than NASH_MAX × NASH_MAX are refused before any work.
 */
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratNeg, ratSign, ratEq, ratIsZero, ratInt, RAT_ZERO, RAT_ONE } from "./cas";
import { solveProblem, type LpProblem, type LpRow } from "./lp";

export const NASH_MAX = 8;
export const NASH_WALL_MS = 6000;

export interface Game {
  rowNames: string[];
  colNames: string[];
  /** Row player's payoffs A[i][j]. */
  A: Rat[][];
  /** Column player's payoffs B[i][j]. */
  B: Rat[][];
}

export interface Equilibrium {
  /** Row player's mix over ALL rows of the game (zeros off the support). */
  x: Rat[];
  /** Column player's mix over ALL columns. */
  y: Rat[];
  /** Expected payoffs xᵀAy and xᵀBy. */
  u1: Rat;
  u2: Rat;
  pure: boolean;
}

export interface ElimStep {
  player: "row" | "col";
  removed: number;
  /** The dominating pure strategy, or the dominating mixture (index → weight) over the remaining strategies. */
  by: { pure: number } | { mix: { idx: number; w: Rat }[] };
}

export interface Elimination {
  rows: number[];
  cols: number[];
  steps: ElimStep[];
}

export class NashTimeout extends Error {}

const lt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) < 0;
const gt = (a: Rat, b: Rat): boolean => ratSign(ratSub(a, b)) > 0;
const dot = (a: Rat[], b: Rat[]): Rat => a.reduce((s, v, i) => (ratIsZero(v) || ratIsZero(b[i]) ? s : ratAdd(s, ratMul(v, b[i]))), RAT_ZERO);

class Clock {
  private readonly deadline: number;
  constructor(wallMs: number) {
    this.deadline = Date.now() + wallMs;
  }
  check(what: string): void {
    if (Date.now() > this.deadline) throw new NashTimeout(what);
  }
}

/** Expected payoff of each row against the column mix y: (Ay)ᵢ. */
export function rowPayoffs(A: Rat[][], y: Rat[]): Rat[] {
  return A.map((row) => dot(row, y));
}

/** Expected payoff of each column against the row mix x: (xᵀB)ⱼ. */
export function colPayoffs(B: Rat[][], x: Rat[]): Rat[] {
  const n = B[0].length;
  const out: Rat[] = [];
  for (let j = 0; j < n; j++) {
    let s = RAT_ZERO;
    for (let i = 0; i < B.length; i++) if (!ratIsZero(x[i])) s = ratAdd(s, ratMul(x[i], B[i][j]));
    out.push(s);
  }
  return out;
}

const maxOf = (v: Rat[]): Rat => v.reduce((m, a) => (gt(a, m) ? a : m), v[0]);

// ---------------------------------------------------------------------------------------------------------------
// Iterated elimination of strictly dominated strategies

/**
 * Row r is strictly dominated by a mixture of the other remaining rows when max ε subject to
 * Σₖ σₖA[k][j] − ε ≥ A[r][j] for every remaining column j, Σσ = 1, σ ≥ 0 has ε* > 0 (an exact LP).
 */
function mixedDominator(M: Rat[][], r: number, others: number[], cols: number[]): { idx: number; w: Rat }[] | null {
  if (others.length < 2) return null; // a mixture of one strategy is the pure check
  const nv = others.length + 1;
  const vars = [...others.map((_, k) => `s${k + 1}`), "e"];
  const rows: LpRow[] = cols.map((j) => ({
    coeffs: [...others.map((k) => M[k][j]), ratInt(-1)],
    rel: ">=",
    rhs: M[r][j],
    label: `column ${j + 1}`,
  }));
  rows.push({ coeffs: [...others.map(() => RAT_ONE), RAT_ZERO], rel: "=", rhs: RAT_ONE, label: "weights sum to 1" });
  const p: LpProblem = {
    sense: "max",
    objName: "e",
    vars,
    c: [...others.map(() => RAT_ZERO), RAT_ONE],
    c0: RAT_ZERO,
    rows,
    nonneg: [...others.map(() => true), false],
    integer: new Array<boolean>(nv).fill(false),
    signsStated: true,
    notes: [],
  };
  const sol = solveProblem(p, { light: true });
  if (sol.status !== "optimal" || !sol.x || ratSign(sol.x[nv - 1]) <= 0) return null;
  const mix = others.map((idx, k) => ({ idx, w: sol.x![k] })).filter((t) => ratSign(t.w) > 0);
  // Verified exactly: the mixture beats r strictly in every remaining column.
  for (const j of cols) {
    const v = mix.reduce((s, t) => ratAdd(s, ratMul(t.w, M[t.idx][j])), RAT_ZERO);
    if (!gt(v, M[r][j])) return null;
  }
  return mix;
}

/** Transposed view: the column player's payoffs with columns as "rows". */
function transpose(M: Rat[][]): Rat[][] {
  return M[0].map((_, j) => M.map((row) => row[j]));
}

export function eliminate(g: Game, mixed: boolean, wallMs = NASH_WALL_MS): Elimination {
  const clock = new Clock(wallMs);
  let rows = g.rowNames.map((_, i) => i);
  let cols = g.colNames.map((_, j) => j);
  const Bt = transpose(g.B);
  const steps: ElimStep[] = [];
  // At most m + n − 2 removals; each pass removes one strategy or stops.
  for (let pass = 0; pass < g.rowNames.length + g.colNames.length; pass++) {
    clock.check("eliminating dominated strategies");
    let found: ElimStep | null = null;
    // Pure domination first (rows, then columns), then mixtures.
    for (const player of ["row", "col"] as const) {
      const own = player === "row" ? rows : cols;
      const opp = player === "row" ? cols : rows;
      const M = player === "row" ? g.A : Bt;
      if (own.length < 2) continue;
      for (const r of own) {
        const dom = own.find((k) => k !== r && opp.every((j) => gt(M[k][j], M[r][j])));
        if (dom !== undefined) {
          found = { player, removed: r, by: { pure: dom } };
          break;
        }
      }
      if (found) break;
    }
    if (!found && mixed) {
      for (const player of ["row", "col"] as const) {
        const own = player === "row" ? rows : cols;
        const opp = player === "row" ? cols : rows;
        const M = player === "row" ? g.A : Bt;
        if (own.length < 3) continue;
        for (const r of own) {
          clock.check("eliminating dominated strategies");
          const mix = mixedDominator(M, r, own.filter((k) => k !== r), opp);
          if (mix) {
            found = { player, removed: r, by: { mix } };
            break;
          }
        }
        if (found) break;
      }
    }
    if (!found) break;
    steps.push(found);
    if (found.player === "row") rows = rows.filter((i) => i !== found!.removed);
    else cols = cols.filter((j) => j !== found!.removed);
  }
  return { rows, cols, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Pure equilibria and support enumeration

/** Every cell (i, j) where i is a best response to j AND j is a best response to i. */
export function pureEquilibria(g: Game): [number, number][] {
  const m = g.rowNames.length;
  const n = g.colNames.length;
  const out: [number, number][] = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let ok = true;
      for (let k = 0; k < m && ok; k++) if (gt(g.A[k][j], g.A[i][j])) ok = false;
      for (let l = 0; l < n && ok; l++) if (gt(g.B[i][l], g.B[i][j])) ok = false;
      if (ok) out.push([i, j]);
    }
  }
  return out;
}

/** Solves M z = b exactly by Gauss–Jordan elimination; null when M is singular. */
export function solveExact(M: Rat[][], b: Rat[]): Rat[] | null {
  const r = solveSquare(M, b);
  return r.status === "unique" ? r.z : null;
}

/**
 * The square system M z = b classified: one solution, none (singular and inconsistent), or infinitely many (singular
 * and consistent), by Gauss–Jordan elimination with row reduction to echelon form.
 */
export function solveSquare(M: Rat[][], b: Rat[]): { status: "unique"; z: Rat[] } | { status: "none" | "many" } {
  const n = M.length;
  const a = M.map((row, i) => [...row, b[i]]);
  let row = 0;
  const pivCols: number[] = [];
  for (let c = 0; c < n && row < n; c++) {
    let p = -1;
    for (let r = row; r < n; r++) if (!ratIsZero(a[r][c])) { p = r; break; }
    if (p < 0) continue;
    if (p !== row) [a[p], a[row]] = [a[row], a[p]];
    const piv = a[row][c];
    for (let k = c; k <= n; k++) a[row][k] = ratDiv(a[row][k], piv);
    for (let r = 0; r < n; r++) {
      if (r === row || ratIsZero(a[r][c])) continue;
      const f = a[r][c];
      for (let k = c; k <= n; k++) a[r][k] = ratSub(a[r][k], ratMul(f, a[row][k]));
    }
    pivCols.push(c);
    row++;
  }
  if (row === n) return { status: "unique", z: a.map((rw) => rw[n]) };
  for (let r = row; r < n; r++) if (!ratIsZero(a[r][n])) return { status: "none" };
  return { status: "many" };
}

function combinations(items: number[], k: number, out: number[][] = [], start = 0, cur: number[] = []): number[][] {
  if (cur.length === k) {
    out.push([...cur]);
    return out;
  }
  for (let i = start; i <= items.length - (k - cur.length); i++) {
    cur.push(items[i]);
    combinations(items, k, out, i + 1, cur);
    cur.pop();
  }
  return out;
}

const binom = (n: number, k: number): number => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

/** The number of equal-size support pairs over m rows and n columns. */
export function supportPairs(m: number, n: number): number {
  let s = 0;
  for (let k = 1; k <= Math.min(m, n); k++) s += binom(m, k) * binom(n, k);
  return s;
}

/** True when (x, y) is a Nash equilibrium of the full game, checked exactly. */
export function isEquilibrium(g: Game, x: Rat[], y: Rat[]): boolean {
  const sum = (v: Rat[]): Rat => v.reduce((s, a) => ratAdd(s, a), RAT_ZERO);
  if (x.some((v) => ratSign(v) < 0) || y.some((v) => ratSign(v) < 0)) return false;
  if (!ratEq(sum(x), RAT_ONE) || !ratEq(sum(y), RAT_ONE)) return false;
  const ra = rowPayoffs(g.A, y);
  const cb = colPayoffs(g.B, x);
  const u1 = dot(x, ra);
  const u2 = dot(y, cb);
  // No pure deviation does strictly better (which also forces equal payoffs over each support).
  return ra.every((v) => !gt(v, u1)) && cb.every((v) => !gt(v, u2));
}

const bAbs = (a: bigint): bigint => (a < 0n ? -a : a);
const bGcd = (a: bigint, b: bigint): bigint => {
  a = bAbs(a);
  b = bAbs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

/**
 * The payoffs as integers for the fraction-free solver: each ROW of A multiplied by the lcm LA[i] of its denominators,
 * each COLUMN of B by the lcm LB[j] of its denominators (the indifference equations use rows of A and columns of B, so
 * every equation scales by one positive integer and its solution is unchanged).
 */
export function integerPayoffs(g: Game): { A: bigint[][]; LA: bigint[]; B: bigint[][]; LB: bigint[] } {
  const lcm = (ds: bigint[]): bigint => ds.reduce((l, d) => (l / bGcd(l, d)) * d, 1n);
  const LA = g.A.map((row) => lcm(row.map((v) => v.d)));
  const A = g.A.map((row, i) => row.map((v) => v.n * (LA[i] / v.d)));
  const LB = g.B[0].map((_, j) => lcm(g.B.map((row) => row[j].d)));
  const B = g.B.map((row) => row.map((v, j) => v.n * (LB[j] / v.d)));
  return { A, LA, B, LB };
}

/**
 * The square integer system [M | b] (n rows, n + 1 columns) classified by fraction-free (Bareiss) elimination: a
 * unique solution zᵢ = num[i]/den, none (inconsistent), or infinitely many. Every division in the elimination is exact
 * (Bareiss 1968); with a column that has no pivot the elimination continues on the next column with the same rule
 * (fraction-free echelon form), and the zero rows left at the bottom decide consistency.
 */
export function solveIntSystem(Mx: bigint[][]): { status: "unique"; num: bigint[]; den: bigint } | { status: "none" | "many" } {
  const n = Mx.length;
  const a = Mx.map((r) => r.slice());
  let prev = 1n;
  let row = 0;
  for (let c = 0; c < n && row < n; c++) {
    let p = -1;
    for (let r = row; r < n; r++) if (a[r][c] !== 0n) { p = r; break; }
    if (p < 0) continue;
    if (p !== row) [a[p], a[row]] = [a[row], a[p]];
    const piv = a[row][c];
    for (let r = row + 1; r < n; r++) {
      const f = a[r][c];
      for (let k = c + 1; k <= n; k++) a[r][k] = (piv * a[r][k] - f * a[row][k]) / prev;
      a[r][c] = 0n;
    }
    prev = piv;
    row++;
  }
  if (row < n) {
    for (let r = row; r < n; r++) if (a[r][n] !== 0n) return { status: "none" };
    return { status: "many" };
  }
  // Upper triangular with full rank; D = a[n−1][n−1] is ±det, and D·zᵢ is an integer (Cramer), found by exact
  // integer back substitution.
  const D = a[n - 1][n - 1];
  const num = new Array<bigint>(n).fill(0n);
  for (let i = n - 1; i >= 0; i--) {
    let s = D * a[i][n];
    for (let j = i + 1; j < n; j++) s -= a[i][j] * num[j];
    num[i] = s / a[i][i];
  }
  return { status: "unique", num, den: D };
}

/** True when the first k components of a unique solution are all strictly positive. */
const positive = (r: { num: bigint[]; den: bigint }, k: number): boolean => {
  const s = r.den > 0n ? 1n : -1n;
  for (let t = 0; t < k; t++) if (r.num[t] * s <= 0n) return false;
  return true;
};

export interface EnumResult {
  equilibria: Equilibrium[];
  /** Support pairs examined. */
  pairs: number;
  /** Equal-size support pairs whose indifference system has infinitely many solutions (skipped; a possible degeneracy). */
  singular: number;
}

/**
 * Support enumeration over the strategies in `rows` × `cols` (the game left after elimination); every equilibrium is
 * returned over the FULL strategy sets and verified against the full game.
 */
export function enumerateSupports(g: Game, rows: number[], cols: number[], wallMs = NASH_WALL_MS): EnumResult {
  const clock = new Clock(wallMs);
  const m = g.rowNames.length;
  const n = g.colNames.length;
  const eqs: Equilibrium[] = [];
  let pairs = 0;
  let singular = 0;
  const ints = integerPayoffs(g);
  for (let k = 1; k <= Math.min(rows.length, cols.length); k++) {
    const Is = combinations(rows, k);
    const Js = combinations(cols, k);
    for (const I of Is) {
      for (const J of Js) {
        clock.check("enumerating supports");
        pairs++;
        // y on J with v: Σⱼ A[i][j]yⱼ − v = 0 (i ∈ I), Σ yⱼ = 1 (each row scaled to integers by its denominators).
        const My: bigint[][] = I.map((i) => [...J.map((j) => ints.A[i][j]), -ints.LA[i], 0n]);
        My.push([...J.map(() => 1n), 0n, 1n]);
        const ry = solveIntSystem(My);
        // A unique solution with a nonpositive weight rules the pair out; so does an inconsistent system.
        if (ry.status === "none" || (ry.status === "unique" && !positive(ry, k))) continue;
        // x on I with u: Σᵢ xᵢB[i][j] − u = 0 (j ∈ J), Σ xᵢ = 1.
        const Mx: bigint[][] = J.map((j) => [...I.map((i) => ints.B[i][j]), -ints.LB[j], 0n]);
        Mx.push([...I.map(() => 1n), 0n, 1n]);
        const rx = solveIntSystem(Mx);
        if (rx.status === "none" || (rx.status === "unique" && !positive(rx, k))) continue;
        if (ry.status !== "unique" || rx.status !== "unique") {
          // Neither side rules the pair out, and one side has infinitely many solutions: skipped, and counted.
          singular++;
          continue;
        }
        const sy = ry.num.map((v) => ratDiv({ n: v, d: 1n }, { n: ry.den, d: 1n }));
        const sx = rx.num.map((v) => ratDiv({ n: v, d: 1n }, { n: rx.den, d: 1n }));
        const x = new Array<Rat>(m).fill(RAT_ZERO);
        const y = new Array<Rat>(n).fill(RAT_ZERO);
        I.forEach((i, t) => (x[i] = sx[t]));
        J.forEach((j, t) => (y[j] = sy[t]));
        if (!isEquilibrium(g, x, y)) continue;
        if (eqs.some((e) => e.x.every((v, i) => ratEq(v, x[i])) && e.y.every((v, j) => ratEq(v, y[j])))) continue;
        const u1 = dot(x, rowPayoffs(g.A, y));
        const u2 = dot(y, colPayoffs(g.B, x));
        eqs.push({ x, y, u1, u2, pure: k === 1 });
      }
    }
  }
  return { equilibria: eqs, pairs, singular };
}

/**
 * Proof that the game is degenerate (tests 1 and 2; empty when neither fires). Test 3, support pairs with infinitely
 * many indifference solutions, is NOT proof (those solutions may not be best responses) and is reported separately by
 * the caller as a caution.
 */
export function degeneracyEvidence(g: Game, eqs: Equilibrium[]): string[] {
  const out: string[] = [];
  const m = g.rowNames.length;
  const n = g.colNames.length;
  // (1) A pure strategy with two or more pure best responses.
  for (let j = 0; j < n && out.length === 0; j++) {
    const col = g.A.map((row) => row[j]);
    const best = maxOf(col);
    const ties = col.filter((v) => ratEq(v, best)).length;
    if (ties > 1) out.push(`against the column strategy ${g.colNames[j]}, the row player has ${ties} pure best responses`);
  }
  for (let i = 0; i < m && out.length < 2; i++) {
    const row = g.B[i];
    const best = maxOf(row);
    const ties = row.filter((v) => ratEq(v, best)).length;
    if (ties > 1) {
      out.push(`against the row strategy ${g.rowNames[i]}, the column player has ${ties} pure best responses`);
      break;
    }
  }
  // (2) More pure best responses than the opponent's support size at a found equilibrium.
  for (const e of eqs) {
    const ra = rowPayoffs(g.A, e.y);
    const cb = colPayoffs(g.B, e.x);
    const brRows = ra.filter((v) => ratEq(v, maxOf(ra))).length;
    const brCols = cb.filter((v) => ratEq(v, maxOf(cb))).length;
    const supY = e.y.filter((v) => ratSign(v) > 0).length;
    const supX = e.x.filter((v) => ratSign(v) > 0).length;
    if (brRows > supY || brCols > supX) {
      out.push("at a found equilibrium a player has more pure best responses than the opponent's support size");
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Zero-sum and constant-sum games

/** The constant c with A + B = c in every cell, or null. */
export function constantSum(g: Game): Rat | null {
  const c = ratAdd(g.A[0][0], g.B[0][0]);
  for (let i = 0; i < g.A.length; i++) for (let j = 0; j < g.A[0].length; j++) if (!ratEq(ratAdd(g.A[i][j], g.B[i][j]), c)) return null;
  return c;
}

export interface ZeroSumValue {
  /** The row player's value (maximin of A = minimax of A). */
  value: Rat;
  /** An optimal (maximin) row mix and an optimal (minimax) column mix from the two LPs. */
  x: Rat[];
  y: Rat[];
}

/**
 * The value of the matrix game A to the row player by two exact LPs: max v s.t. Σᵢ xᵢA[i][j] ≥ v for every j, Σx = 1,
 * x ≥ 0 (v free); and min w s.t. Σⱼ A[i][j]yⱼ ≤ w for every i, Σy = 1, y ≥ 0. Strong duality makes v* = w*; the
 * two are compared exactly and a disagreement throws.
 */
export function zeroSumValue(A: Rat[][]): ZeroSumValue {
  const m = A.length;
  const n = A[0].length;
  const rowLp: LpProblem = {
    sense: "max",
    objName: "v",
    vars: [...A.map((_, i) => `x${i + 1}`), "v"],
    c: [...A.map(() => RAT_ZERO), RAT_ONE],
    c0: RAT_ZERO,
    rows: [
      ...A[0].map((_, j): LpRow => ({ coeffs: [...A.map((r) => r[j]), ratInt(-1)], rel: ">=", rhs: RAT_ZERO, label: `column ${j + 1}` })),
      { coeffs: [...A.map(() => RAT_ONE), RAT_ZERO], rel: "=", rhs: RAT_ONE, label: "sum" },
    ],
    nonneg: [...A.map(() => true), false],
    integer: new Array<boolean>(m + 1).fill(false),
    signsStated: true,
    notes: [],
  };
  const colLp: LpProblem = {
    sense: "min",
    objName: "w",
    vars: [...A[0].map((_, j) => `y${j + 1}`), "w"],
    c: [...A[0].map(() => RAT_ZERO), RAT_ONE],
    c0: RAT_ZERO,
    rows: [
      ...A.map((r, i): LpRow => ({ coeffs: [...r, ratInt(-1)], rel: "<=", rhs: RAT_ZERO, label: `row ${i + 1}` })),
      { coeffs: [...A[0].map(() => RAT_ONE), RAT_ZERO], rel: "=", rhs: RAT_ONE, label: "sum" },
    ],
    nonneg: [...A[0].map(() => true), false],
    integer: new Array<boolean>(n + 1).fill(false),
    signsStated: true,
    notes: [],
  };
  const a = solveProblem(rowLp, { light: true });
  const b = solveProblem(colLp, { light: true });
  if (a.status !== "optimal" || b.status !== "optimal" || !a.x || !b.x) throw new Error("the value LP did not reach an optimum");
  const v = a.x[m];
  const w = b.x[n];
  if (!ratEq(v, w)) throw new Error("the maximin and minimax LP values disagree");
  return { value: v, x: a.x.slice(0, m), y: b.x.slice(0, n) };
}
