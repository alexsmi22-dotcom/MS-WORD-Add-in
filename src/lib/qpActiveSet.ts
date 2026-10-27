/**
 * A small dense convex quadratic programme with equality constraints and non-negative variables (release F1,
 * gap item #4: the long-only Markowitz frontier and tangency portfolio):
 *
 *     minimise ½ xᵀGx + cᵀx   subject to   A x = b,   x ≥ 0,
 *
 * by the primal active-set method (Nocedal & Wright, Numerical Optimization, 2nd ed., Algorithm 16.3), started from
 * a feasible point the caller supplies (the frontier always has one in closed form: a single asset, or two assets
 * mixed to hit the target return). G must be positive definite (the caller refuses a singular covariance first), so
 * every equality-constrained subproblem has a unique solution and the method terminates.
 *
 * Each step solves the KKT system of the free variables, [G_FF  −A_Fᵀ; A_F  0][p; ν] = [−g_F; 0], by Gaussian
 * elimination with partial pivoting (n ≤ 20 assets, so at most a 22 × 22 system). Rows of A_F that become dependent
 * once variables are fixed at zero (all free assets sharing one mean return) are dropped with multiplier 0 rather than
 * making the system singular. The iteration count is capped; past the cap the solve refuses rather than loops.
 */

export interface QpProblem {
  /** n × n, symmetric positive definite. */
  G: number[][];
  c: number[];
  /** m × n equality constraints (m ≤ 2 here). */
  A: number[][];
  b: number[];
  /** A feasible starting point: A x0 = b, x0 ≥ 0. */
  x0: number[];
}

export type QpResult = { ok: true; x: number[]; iterations: number } | { ok: false; reason: string };

/** Solves M z = r (M square) by Gaussian elimination with partial pivoting; null when a pivot vanishes. */
export function solveDense(M: number[][], r: number[]): number[] | null {
  const n = r.length;
  const a = M.map((row, i) => [...row, r[i]]);
  let scale = 0;
  for (const row of M) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[piv][k])) piv = i;
    if (!(Math.abs(a[piv][k]) > 1e-14 * scale)) return null;
    if (piv !== k) [a[piv], a[k]] = [a[k], a[piv]];
    for (let i = k + 1; i < n; i++) {
      const f = a[i][k] / a[k][k];
      if (f === 0) continue;
      for (let j = k; j <= n; j++) a[i][j] -= f * a[k][j];
    }
  }
  const z = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = a[i][n];
    for (let j = i + 1; j < n; j++) s -= a[i][j] * z[j];
    z[i] = s / a[i][i];
  }
  return z.every(Number.isFinite) ? z : null;
}

/** Indices of a maximal independent subset of the rows (Gram–Schmidt with a relative tolerance). */
function independentRows(rows: number[][]): number[] {
  const kept: number[] = [];
  const basis: number[][] = [];
  rows.forEach((row, i) => {
    const v = [...row];
    const norm0 = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (!(norm0 > 0)) return;
    for (const q of basis) {
      const d = v.reduce((s, x, j) => s + x * q[j], 0);
      for (let j = 0; j < v.length; j++) v[j] -= d * q[j];
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm > 1e-10 * norm0) {
      basis.push(v.map((x) => x / norm));
      kept.push(i);
    }
  });
  return kept;
}

/** The primal active-set method on bounds x ≥ 0 with equality constraints A x = b. */
export function solveQpNonneg(p: QpProblem): QpResult {
  const n = p.c.length;
  const m = p.A.length;
  // Scale the objective so the tolerances are relative (a covariance of returns is 10⁻⁴…10⁻¹).
  let gs = 0;
  for (let i = 0; i < n; i++) gs = Math.max(gs, Math.abs(p.G[i][i]));
  for (const v of p.c) gs = Math.max(gs, Math.abs(v));
  if (!(gs > 0) || !Number.isFinite(gs)) return { ok: false, reason: "The quadratic programme has a zero or non-finite objective." };
  const G = p.G.map((row) => row.map((v) => v / gs));
  const c = p.c.map((v) => v / gs);
  const x = p.x0.map((v) => (v > 0 ? v : 0));
  const atZero = new Set<number>();
  for (let i = 0; i < n; i++) if (x[i] === 0) atZero.add(i);
  const maxIter = 50 * (n + m) + 50;
  const stuck = new Set<number>();
  let lastDropped = -1;
  for (let it = 1; it <= maxIter; it++) {
    const g = G.map((row, i) => row.reduce((s, v, j) => s + v * x[j], 0) + c[i]);
    const F = [...Array(n).keys()].filter((i) => !atZero.has(i));
    const AF = p.A.map((row) => F.map((j) => row[j]));
    const rowsKept = F.length ? independentRows(AF) : [];
    const mk = rowsKept.length;
    const dim = F.length + mk;
    let step = new Array<number>(F.length).fill(0);
    const nu = new Array<number>(m).fill(0);
    if (dim > 0) {
      const K: number[][] = [];
      const rhs: number[] = [];
      for (let a = 0; a < F.length; a++) {
        const row = new Array<number>(dim).fill(0);
        for (let b2 = 0; b2 < F.length; b2++) row[b2] = G[F[a]][F[b2]];
        rowsKept.forEach((r, k) => (row[F.length + k] = -AF[r][a]));
        K.push(row);
        rhs.push(-g[F[a]]);
      }
      rowsKept.forEach((r) => {
        const row = new Array<number>(dim).fill(0);
        for (let a = 0; a < F.length; a++) row[a] = AF[r][a];
        K.push(row);
        rhs.push(0);
      });
      const z = solveDense(K, rhs);
      if (!z) return { ok: false, reason: "The optimisation's linear system is singular (the covariance matrix is not positive definite)." };
      // With as many independent constraints as free variables the point is pinned: the step is zero by
      // construction (the solve returns rounding noise of 10⁻¹³, which, taken as a step, never ended).
      step = F.length <= mk ? new Array<number>(F.length).fill(0) : z.slice(0, F.length);
      rowsKept.forEach((r, k) => (nu[r] = z[F.length + k]));
    }
    const pmax = step.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
    if (pmax <= 1e-11) {
      // Multipliers of the active bounds: λᵢ = gᵢ − (Aᵀν)ᵢ must be ≥ 0 at the optimum.
      // The tolerance is relative to the terms that make λ: with nearly equal mean returns ν is large and λ is a
      // difference of large numbers, so an absolute threshold saw rounding as a negative multiplier and cycled.
      let worst = -1;
      let scale = 1;
      for (const i of atZero) {
        scale = Math.max(scale, Math.abs(g[i]));
        for (let r = 0; r < m; r++) scale = Math.max(scale, Math.abs(p.A[r][i] * nu[r]));
      }
      let worstVal = -1e-10 * scale;
      for (const i of atZero) {
        if (stuck.has(i)) continue;
        let lam = g[i];
        for (let r = 0; r < m; r++) lam -= p.A[r][i] * nu[r];
        if (lam < worstVal) {
          worstVal = lam;
          worst = i;
        }
      }
      if (worst < 0) return { ok: true, x, iterations: it };
      atZero.delete(worst);
      lastDropped = worst;
      continue;
    }
    let alpha = 1;
    let block = -1;
    F.forEach((i, a) => {
      if (step[a] < 0) {
        const t = -x[i] / step[a];
        if (t < alpha) {
          alpha = t;
          block = i;
        }
      }
    });
    F.forEach((i, a) => (x[i] += alpha * step[a]));
    if (block >= 0) {
      x[block] = 0;
      atZero.add(block);
      // Anti-cycling: a bound released and re-blocked at once (a zero step) is degenerate; it is not released again
      // until the iterate actually moves.
      if (alpha === 0 && block === lastDropped) stuck.add(block);
    }
    if (alpha > 0) stuck.clear();
    lastDropped = -1;
    for (let i = 0; i < n; i++) if (x[i] < 0) x[i] = 0;
  }
  return { ok: false, reason: `The optimisation did not settle within ${maxIter} active-set steps.` };
}
