// Differential-algebraic equations, semi-explicit form:
//
//     y' = f(t, y, z)        the differential part
//     0  = g(t, y, z)        the algebraic constraint
//
// A DAE is not an ODE with an extra equation. Two things make it genuinely
// different, and both are refusals rather than features.
//
// THE INDEX. Differentiate the constraint until the system can be rewritten as
// an ODE; the number of differentiations needed is the index. This solver
// handles INDEX 1 ONLY, which is exactly the condition that ∂g/∂z is
// nonsingular — the constraint determines z directly from (t, y). That
// condition is CHECKED at the initial point, numerically, and a singular ∂g/∂z
// is refused by name.
//
// Refusing matters because index ≥ 2 does not fail loudly. The classic example
// is the pendulum in Cartesian coordinates:
//     x' = u,  y' = v,  u' = -λx,  v' = -λy - g,  0 = x² + y² - L²
// Here ∂g/∂λ = 0 identically — the constraint does not mention λ at all — so the
// system is index 3. Run an index-1 method on it and you get either an
// immediate singular Jacobian or, worse, a solution that drifts steadily off
// the constraint while looking like a plausible pendulum. Solving it properly
// needs index reduction (differentiate the constraint twice, then stabilise the
// result — Baumgarte or GGL), which this does not do. It says so instead.
//
// CONSISTENT INITIAL CONDITIONS. Unlike an ODE, you may not choose y(0) and
// z(0) freely: they must already satisfy g(t₀, y₀, z₀) = 0. An inconsistent
// start is not a small error that decays — it is not a point on the solution
// manifold at all. Rather than refuse outright, this PROJECTS z₀ onto the
// constraint by Newton (holding y₀, which is the genuinely free data) and
// reports both the original residual and what it moved z₀ to.
//
// The method is implicit Euler on the differential part with the constraint
// imposed at the SAME time level, so g = 0 holds exactly at every step by
// construction and there is no constraint drift to monitor. It is first-order
// accurate, which is stated rather than implied.

/** y' = f(t, y, z) — returns the derivative vector, length ny. */
export type DaeF = (t: number, y: number[], z: number[]) => number[];
/** 0 = g(t, y, z) — returns the residual vector, length nz. */
export type DaeG = (t: number, y: number[], z: number[]) => number[];

export interface DaeResult {
  t: number[];
  /** y[k] is the differential state at t[k]. */
  y: number[][];
  /** z[k] is the algebraic state at t[k]. */
  z: number[][];
  /** Max |g| over every step — should be at machine precision by construction. */
  maxConstraintResidual: number;
  /** |g| at the user's original initial values, before any projection. */
  initialResidual: number;
  /** True when z0 had to be moved to satisfy the constraint. */
  projectedInitial: boolean;
  steps: string[];
  caveats: string[];
  completed: boolean;
}

export type DaeOutcome =
  | { ok: true; result: DaeResult }
  | { ok: false; error: string };

const MAX_STEPS = 20000;
const NEWTON_MAX = 50;

/** Dense solve by Gaussian elimination with partial pivoting. Null if singular. */
function luSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (!Number.isFinite(M[piv][col]) || Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Smallest singular value of a small square matrix, by its inverse's growth. */
function isNearlySingular(A: number[][]): boolean {
  const n = A.length;
  if (!n) return true;
  // Solve A x = e_j for each basis vector; if any solve fails or explodes, the
  // matrix is effectively singular. Cheap and sufficient at these sizes.
  let worst = 0;
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const x = luSolve(A, e);
    if (!x) return true;
    worst = Math.max(worst, Math.max(...x.map(Math.abs)));
  }
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  return worst > 1e12 / scale;
}

/** ∂g/∂z at a point, by central differences. */
function dgdz(g: DaeG, t: number, y: number[], z: number[]): number[][] | null {
  const nz = z.length;
  const J: number[][] = Array.from({ length: nz }, () => new Array<number>(nz).fill(0));
  for (let j = 0; j < nz; j++) {
    const h = Math.max(1e-7, 1e-7 * Math.abs(z[j]));
    const zp = z.slice(); zp[j] += h;
    const zm = z.slice(); zm[j] -= h;
    const gp = g(t, y, zp);
    const gm = g(t, y, zm);
    if (!gp.every(Number.isFinite) || !gm.every(Number.isFinite)) return null;
    for (let i = 0; i < nz; i++) J[i][j] = (gp[i] - gm[i]) / (2 * h);
  }
  return J;
}

/**
 * Solve a semi-explicit index-1 DAE from t0 to t1.
 *
 * Each step solves the coupled nonlinear system
 *     y_{n+1} − y_n − h f(t_{n+1}, y_{n+1}, z_{n+1}) = 0
 *     g(t_{n+1}, y_{n+1}, z_{n+1})                   = 0
 * by Newton with a numerical Jacobian. The constraint is imposed at the new
 * time level, so it holds to Newton tolerance at every reported point.
 */
export function solveDae(
  f: DaeF, g: DaeG, t0: number, t1: number, y0: number[], z0: number[],
  opts: { steps?: number; reportPoints?: number } = {}
): DaeOutcome {
  if (![t0, t1].every(Number.isFinite)) return { ok: false, error: "The time interval must be finite." };
  if (t1 === t0) return { ok: false, error: "The time interval is empty — t0 and t1 are the same." };
  if (!y0.length) return { ok: false, error: "There must be at least one differential equation (y' = …)." };
  if (!z0.length) return { ok: false, error: "There must be at least one algebraic constraint (0 = …). Without one this is an ODE — use the ODE solver." };
  if (!y0.every(Number.isFinite) || !z0.every(Number.isFinite)) {
    return { ok: false, error: "The initial values must all be finite numbers." };
  }

  const ny = y0.length;
  const nz = z0.length;
  const caveats: string[] = [];
  const steps: string[] = [];

  // --- The index check ------------------------------------------------------
  const g0 = g(t0, y0, z0);
  if (g0.length !== nz) {
    return { ok: false, error: `There are ${nz} algebraic unknowns but ${g0.length} constraint equations. A semi-explicit DAE needs exactly as many constraints as algebraic variables.` };
  }
  const J0 = dgdz(g, t0, y0, z0);
  if (!J0) return { ok: false, error: "The constraint is not finite near the initial point." };
  if (isNearlySingular(J0)) {
    return {
      ok: false,
      error:
        "∂g/∂z is singular at the initial point, so this system is NOT index 1 — it is index 2 or higher, and this solver cannot do it. " +
        "The usual cause is a constraint that does not mention the algebraic variable at all: the Cartesian pendulum, 0 = x² + y² − L², is index 3 for exactly that reason. " +
        "Solving it needs index reduction (differentiating the constraint, then stabilising), which is not implemented here. Reformulating in a coordinate that makes the constraint depend on z directly — an angle for the pendulum — usually gives an ODE instead.",
    };
  }
  steps.push(`Index check: ∂g/∂z is nonsingular at t₀, so the system is index 1 and the constraint determines z from (t, y).`);

  // --- Consistent initial conditions ---------------------------------------
  const initialResidual = Math.max(...g0.map(Math.abs));
  let z = z0.slice();
  let projectedInitial = false;
  if (initialResidual > 1e-10) {
    // Move z only. y0 is the free data; changing it would silently answer a
    // different question from the one that was asked.
    for (let it = 0; it < NEWTON_MAX; it++) {
      const gr = g(t0, y0, z);
      if (Math.max(...gr.map(Math.abs)) < 1e-12) break;
      const J = dgdz(g, t0, y0, z);
      if (!J) return { ok: false, error: "The constraint stopped being finite while projecting the initial values onto it." };
      const d = luSolve(J, gr.map((v) => -v));
      if (!d) return { ok: false, error: "Could not project the initial values onto the constraint — ∂g/∂z went singular." };
      for (let i = 0; i < nz; i++) z[i] += d[i];
      if (!z.every(Number.isFinite)) return { ok: false, error: "Projecting the initial values onto the constraint diverged." };
    }
    if (Math.max(...g(t0, y0, z).map(Math.abs)) > 1e-8) {
      return { ok: false, error: `The initial values do not satisfy the constraint (|g| = ${initialResidual.toExponential(2)}) and could not be projected onto it. Give values that satisfy 0 = g(t₀, y₀, z₀).` };
    }
    projectedInitial = true;
    steps.push(
      `The initial values were INCONSISTENT: |g(t₀, y₀, z₀)| = ${initialResidual.toExponential(2)}, not zero. ` +
        `z₀ was projected onto the constraint (y₀ held fixed, being the free data) and is now [${z.map((v) => v.toPrecision(6)).join(", ")}].`
    );
    caveats.push("The initial algebraic values you gave were not on the constraint manifold and were MOVED. Unlike an ODE, a DAE does not accept arbitrary initial values — the answer starts from the projected point, not the one entered.");
  } else {
    steps.push("The initial values satisfy the constraint, so no projection was needed.");
  }

  // --- Integrate ------------------------------------------------------------
  const nSteps = Math.max(1, Math.min(Math.floor(opts.steps ?? 500), MAX_STEPS));
  const h = (t1 - t0) / nSteps;
  const ts = [t0];
  const ys = [y0.slice()];
  const zs = [z.slice()];
  let y = y0.slice();
  let maxRes = Math.max(...g(t0, y, z).map(Math.abs));
  let completed = true;

  const n = ny + nz;
  for (let k = 1; k <= nSteps; k++) {
    const tn = t0 + k * h;
    const yPrev = y.slice();
    // Newton on [y_{n+1}, z_{n+1}].
    let yk = y.slice();
    let zk = z.slice();
    let converged = false;
    for (let it = 0; it < NEWTON_MAX; it++) {
      const fv = f(tn, yk, zk);
      const gv = g(tn, yk, zk);
      if (fv.length !== ny) return { ok: false, error: `The differential part returned ${fv.length} values but there are ${ny} differential unknowns.` };
      if (!fv.every(Number.isFinite) || !gv.every(Number.isFinite)) {
        return { ok: false, error: `The equations stopped being finite at t = ${tn.toPrecision(6)}.` };
      }
      const F = new Array<number>(n);
      for (let i = 0; i < ny; i++) F[i] = yk[i] - yPrev[i] - h * fv[i];
      for (let i = 0; i < nz; i++) F[ny + i] = gv[i];
      if (Math.max(...F.map(Math.abs)) < 1e-12) { converged = true; break; }

      // Numerical Jacobian of the whole coupled system.
      const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      for (let j = 0; j < n; j++) {
        const yj = yk.slice();
        const zj = zk.slice();
        const base = j < ny ? yk[j] : zk[j - ny];
        const d = Math.max(1e-7, 1e-7 * Math.abs(base));
        if (j < ny) yj[j] += d; else zj[j - ny] += d;
        const fp = f(tn, yj, zj);
        const gp = g(tn, yj, zj);
        if (!fp.every(Number.isFinite) || !gp.every(Number.isFinite)) {
          return { ok: false, error: `The equations stopped being finite while forming the Jacobian at t = ${tn.toPrecision(6)}.` };
        }
        for (let i = 0; i < ny; i++) {
          const Fp = yj[i] - yPrev[i] - h * fp[i];
          J[i][j] = (Fp - F[i]) / d;
        }
        for (let i = 0; i < nz; i++) J[ny + i][j] = (gp[i] - F[ny + i]) / d;
      }
      const delta = luSolve(J, F.map((v) => -v));
      if (!delta) {
        return { ok: false, error: `The Newton system went singular at t = ${tn.toPrecision(6)}. For an index-1 DAE this usually means ∂g/∂z lost rank along the solution — the index is not constant on this trajectory.` };
      }
      for (let i = 0; i < ny; i++) yk[i] += delta[i];
      for (let i = 0; i < nz; i++) zk[i] += delta[ny + i];
      if (!yk.every(Number.isFinite) || !zk.every(Number.isFinite)) {
        return { ok: false, error: `Newton diverged at t = ${tn.toPrecision(6)}.` };
      }
    }
    if (!converged) { completed = false; break; }
    y = yk; z = zk;
    maxRes = Math.max(maxRes, Math.max(...g(tn, y, z).map(Math.abs)));
    ts.push(tn); ys.push(y.slice()); zs.push(z.slice());
  }

  const want = Math.max(2, opts.reportPoints ?? 41);
  const stride = Math.max(1, Math.ceil(ts.length / want));
  const keep: number[] = [];
  for (let i = 0; i < ts.length; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== ts.length - 1) keep.push(ts.length - 1);

  steps.push(`Implicit Euler with the constraint imposed at the same time level: ${nSteps} steps of h = ${h.toExponential(3)}, each a Newton solve on ${n} unknowns.`);
  steps.push(`Maximum |g| over the whole run: ${maxRes.toExponential(2)} — the constraint is satisfied at every step by construction, so there is no drift to correct.`);
  if (!completed) {
    steps.push(`Newton failed to converge before t = ${t1}; the run stopped at t = ${ts[ts.length - 1].toPrecision(6)}.`);
  }

  caveats.push("Implicit Euler is FIRST-order accurate. Halving the step size halves the error, rather than quartering it — for a smooth answer use more steps than you would for an ODE of the same size.");
  caveats.push("Semi-explicit INDEX-1 systems only. ∂g/∂z is checked at the initial point; if the index changes along the trajectory the Newton solve fails and says so rather than drifting.");
  caveats.push("The constraint is enforced at every step, not merely at the start, so the usual DAE failure of slow drift off the manifold does not occur here.");
  if (!completed) {
    caveats.push("The run did NOT reach the final time. What is reported ends where Newton stopped converging.");
  }

  return {
    ok: true,
    result: {
      t: keep.map((i) => ts[i]),
      y: keep.map((i) => ys[i]),
      z: keep.map((i) => zs[i]),
      maxConstraintResidual: maxRes,
      initialResidual, projectedInitial, steps, caveats, completed,
    },
  };
}
