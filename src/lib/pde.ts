// The three classical linear second-order PDEs, by finite differences.
//
//   HEAT     u_t  = α u_xx        parabolic — smooths, decays
//   WAVE     u_tt = c² u_xx       hyperbolic — propagates, preserves
//   LAPLACE  u_xx + u_yy = f      elliptic — steady state, no time at all
//
// The classification is not decoration. It decides what the solution DOES, and
// it decides which discretisation is even allowed:
//
//   STABILITY IS THE WHOLE PROBLEM WITH EXPLICIT SCHEMES. For the heat equation,
//   explicit FTCS is stable only when r = αΔt/Δx² ≤ 1/2. At r = 0.51 the
//   solution does not degrade gracefully — it oscillates and blows up to 1e300
//   within a few dozen steps, from input that looks entirely reasonable. A
//   solver that silently returns that garbage is worse than one that refuses.
//   So the stability number is COMPUTED, REPORTED, and enforced: Δt is reduced
//   to satisfy the bound and the result says it was, rather than either failing
//   mysteriously or quietly returning nonsense.
//
//   For the wave equation the corresponding bound is the Courant number
//   C = cΔt/Δx ≤ 1. At exactly C = 1 the scheme is not merely stable, it is
//   EXACT for the 1D wave equation — the discrete update reproduces d'Alembert's
//   solution — which is why that is the default here.
//
// Crank-Nicolson is offered for the heat equation because it is unconditionally
// stable: no restriction on Δt at all, second-order in both variables, and each
// step is a tridiagonal solve. It is the better default and it is the default.
//
// WHAT THIS DOES NOT DO, stated rather than approximated: nonlinear PDEs,
// systems, more than one space dimension for the time-dependent equations,
// Neumann/Robin boundary conditions, and irregular domains. Each is refused by
// name where it can be detected.

import { solveTridiagonal } from "./bvp";
import { gridSize, guard1, guard2, RELAX_WORK_BUDGET } from "./numguard";

export type PdeKind = "heat" | "wave" | "laplace";
export type HeatScheme = "crank-nicolson" | "explicit";

export interface PdeResult {
  kind: PdeKind;
  /** Space grid (x for 1D, the x axis for Laplace). */
  x: number[];
  /** Time levels reported (absent for Laplace, which has no time). */
  t?: number[];
  /** The y axis, for Laplace only. */
  y?: number[];
  /**
   * Solution. For heat/wave, u[k][i] is u(x_i, t_k). For Laplace, u[j][i] is
   * u(x_i, y_j) — row index is y, matching how a grid is drawn.
   */
  u: number[][];
  scheme: string;
  /** r = αΔt/Δx² for heat, Courant C = cΔt/Δx for wave. Absent for Laplace. */
  stabilityNumber?: number;
  /** True when the requested Δt had to be reduced to keep the scheme stable. */
  stepReduced?: boolean;
  /** Iterations used by the elliptic solver, and whether it converged. */
  iterations?: number;
  converged: boolean;
  steps: string[];
  caveats: string[];
}

export type PdeOutcome =
  | { ok: true; result: PdeResult }
  | { ok: false; error: string };

const MAX_NODES = 400;
const MAX_LEVELS = 4000;
/**
 * A 2-D grid costs nx*ny per sweep and SOR needs about 4n sweeps, so the total
 * is ~4n^3: measured at 48ms for n=40, 1.3s for n=120, 3.3s for n=160 and 8.0s
 * for n=200. 160 is the largest that still relaxes fully inside a few seconds,
 * and a task pane is frozen for every one of them.
 */
const MAX_NODES_2D = 120;

/** Reports at most `want` time levels out of `have`, always including the last. */
function levelStride(have: number, want: number): number {
  return Math.max(1, Math.ceil(have / want));
}

// ---------------------------------------------------------------------------
// Heat: u_t = α u_xx on [0, L], u(0,t) = left, u(L,t) = right, u(x,0) = f(x).

export function solveHeat(
  alpha: number, L: number, tEnd: number,
  f: (x: number) => number,
  left: number, right: number,
  opts: { nx?: number; nt?: number; scheme?: HeatScheme; reportLevels?: number } = {}
): PdeOutcome {
  if (!Number.isFinite(alpha) || alpha <= 0) return { ok: false, error: "The diffusivity α must be a positive finite number." };
  if (!Number.isFinite(L) || L <= 0) return { ok: false, error: "The rod length L must be a positive finite number." };
  if (!Number.isFinite(tEnd) || tEnd <= 0) return { ok: false, error: "The final time must be a positive finite number." };
  if (![left, right].every(Number.isFinite)) return { ok: false, error: "Both boundary values must be finite numbers." };

  const nx = gridSize(opts.nx, 60, 4, MAX_NODES);
  const scheme: HeatScheme = opts.scheme ?? "crank-nicolson";
  const dx = L / nx;
  const x = Array.from({ length: nx + 1 }, (_, i) => i * dx);

  let nt = gridSize(opts.nt, 400, 1, MAX_LEVELS);
  let dt = tEnd / nt;
  let stepReduced = false;

  // The explicit scheme has a hard stability bound. Enforce it rather than
  // letting the run produce 1e300 and calling it an answer.
  const rOf = (d: number) => (alpha * d) / (dx * dx);
  if (scheme === "explicit" && rOf(dt) > 0.5) {
    const dtMax = (0.5 * dx * dx) / alpha;
    const needed = Math.ceil(tEnd / dtMax);
    if (needed > MAX_LEVELS) {
      return {
        ok: false,
        error:
          `Explicit stepping needs Δt ≤ ${dtMax.toExponential(3)} for stability (r ≤ 1/2), which is ${needed.toLocaleString()} steps — past the ${MAX_LEVELS.toLocaleString()} this will run. ` +
          `Use Crank-Nicolson, which has no such restriction, or a coarser space grid.`,
      };
    }
    nt = needed;
    dt = tEnd / nt;
    stepReduced = true;
  }
  const r = rOf(dt);

  const gf = guard1(f);
  const u0 = x.map(gf.fn);
  if (gf.error) return { ok: false, error: `The initial condition could not be evaluated: ${gf.error}` };
  if (!u0.every(Number.isFinite)) return { ok: false, error: "The initial condition is not finite everywhere on the grid." };
  u0[0] = left;
  u0[nx] = right;

  const levels: number[][] = [u0.slice()];
  const times: number[] = [0];
  let cur = u0.slice();

  const m = nx - 1;
  for (let k = 1; k <= nt; k++) {
    const next = cur.slice();
    if (scheme === "explicit") {
      for (let i = 1; i < nx; i++) next[i] = cur[i] + r * (cur[i - 1] - 2 * cur[i] + cur[i + 1]);
    } else {
      // Crank-Nicolson: average the space operator at the old and new levels.
      // (1 + r) u_i^{k+1} − (r/2)(u_{i−1}^{k+1} + u_{i+1}^{k+1}) = RHS at level k.
      const lower = new Array<number>(m).fill(-r / 2);
      const diag = new Array<number>(m).fill(1 + r);
      const upper = new Array<number>(m).fill(-r / 2);
      lower[0] = 0;
      upper[m - 1] = 0;
      const rhs = new Array<number>(m);
      for (let i = 1; i < nx; i++) {
        rhs[i - 1] = cur[i] + (r / 2) * (cur[i - 1] - 2 * cur[i] + cur[i + 1]);
      }
      // Boundaries are fixed in time, so they move to the right-hand side.
      rhs[0] += (r / 2) * left;
      rhs[m - 1] += (r / 2) * right;
      const sol = solveTridiagonal(lower, diag, upper, rhs);
      if (!sol) return { ok: false, error: "The Crank-Nicolson system was singular — no solution is reported." };
      for (let i = 1; i < nx; i++) next[i] = sol[i - 1];
    }
    next[0] = left;
    next[nx] = right;
    if (!next.every(Number.isFinite)) {
      return { ok: false, error: `The solution stopped being finite at step ${k}. Nothing is reported rather than a diverged field.` };
    }
    cur = next;
    levels.push(cur.slice());
    times.push(k * dt);
  }

  const stride = levelStride(levels.length, opts.reportLevels ?? 21);
  const keep: number[] = [];
  for (let i = 0; i < levels.length; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== levels.length - 1) keep.push(levels.length - 1);

  const steps = [
    `Heat equation u_t = ${alpha} u_xx on [0, ${L}] to t = ${tEnd}.`,
    scheme === "explicit"
      ? `Explicit FTCS on ${nx} intervals, ${nt} time steps. Stability number r = αΔt/Δx² = ${r.toFixed(4)} (must be ≤ 0.5).`
      : `Crank-Nicolson on ${nx} intervals, ${nt} time steps; each step is a tridiagonal solve. r = ${r.toFixed(4)} — no bound needed, the scheme is unconditionally stable.`,
    `Reporting ${keep.length} of ${levels.length} time levels.`,
  ];
  if (stepReduced) {
    steps.push(`Δt was REDUCED to ${dt.toExponential(3)} (${nt} steps) to satisfy r ≤ 1/2. Without that the explicit scheme oscillates and diverges.`);
  }

  const caveats = [
    "Second-order accurate in space. Crank-Nicolson is second-order in time; explicit FTCS is first-order.",
    "Dirichlet boundaries only — the ends are held at fixed values. Insulated (Neumann) or radiating (Robin) ends are not solved here.",
    "Linear, constant-coefficient, one space dimension. A temperature-dependent diffusivity is a nonlinear problem and is not what this computes.",
  ];
  if (scheme === "crank-nicolson" && r > 10) {
    caveats.push(
      `r = ${r.toFixed(1)} is large. Crank-Nicolson stays stable, but at large r it rings: a sharp initial profile produces oscillations that decay slowly rather than smoothing immediately. Halve Δt if the early levels look wavy.`
    );
  }

  return {
    ok: true,
    result: {
      kind: "heat", x, t: keep.map((i) => times[i]), u: keep.map((i) => levels[i]),
      scheme: scheme === "explicit" ? "explicit FTCS" : "Crank-Nicolson",
      stabilityNumber: r, stepReduced, converged: true, steps, caveats,
    },
  };
}

// ---------------------------------------------------------------------------
// Wave: u_tt = c² u_xx, u(x,0) = f(x), u_t(x,0) = g(x), fixed ends.

export function solveWave(
  c: number, L: number, tEnd: number,
  f: (x: number) => number, g: (x: number) => number,
  left: number, right: number,
  opts: { nx?: number; courant?: number; reportLevels?: number } = {}
): PdeOutcome {
  if (!Number.isFinite(c) || c <= 0) return { ok: false, error: "The wave speed c must be a positive finite number." };
  if (!Number.isFinite(L) || L <= 0) return { ok: false, error: "The length L must be a positive finite number." };
  if (!Number.isFinite(tEnd) || tEnd <= 0) return { ok: false, error: "The final time must be a positive finite number." };

  const nx = gridSize(opts.nx, 80, 4, MAX_NODES);
  const dx = L / nx;
  const x = Array.from({ length: nx + 1 }, (_, i) => i * dx);

  // C = 1 is both stable and EXACT for the 1D wave equation, so it is the default.
  let C = opts.courant ?? 1;
  if (!Number.isFinite(C) || C <= 0) return { ok: false, error: "The Courant number must be a positive finite number." };
  let clamped = false;
  if (C > 1) { C = 1; clamped = true; }

  const dt = (C * dx) / c;
  const nt = Math.min(Math.max(1, Math.ceil(tEnd / dt)), MAX_LEVELS);
  if (Math.ceil(tEnd / dt) > MAX_LEVELS) {
    return { ok: false, error: `Reaching t = ${tEnd} at the stable step size needs ${Math.ceil(tEnd / dt).toLocaleString()} steps — past the ${MAX_LEVELS.toLocaleString()} this will run. Use a coarser space grid.` };
  }

  const gf = guard1(f);
  const gg = guard1(g);
  const u0 = x.map(gf.fn);
  const v0 = x.map(gg.fn);
  if (gf.error || gg.error) return { ok: false, error: `The initial data could not be evaluated: ${gf.error ?? gg.error}` };
  if (!u0.every(Number.isFinite) || !v0.every(Number.isFinite)) {
    return { ok: false, error: "The initial displacement or velocity is not finite everywhere on the grid." };
  }
  u0[0] = left; u0[nx] = right;

  // The first level needs a special formula: the ordinary update refers to
  // u^{k−1}, which does not exist at k = 0. A Taylor step using u_tt = c² u_xx
  // keeps it second-order — a naive u¹ = u⁰ + Δt·g would drop the accuracy of
  // the whole run to first order.
  const C2 = C * C;
  const u1 = u0.slice();
  for (let i = 1; i < nx; i++) {
    u1[i] = u0[i] + dt * v0[i] + (C2 / 2) * (u0[i - 1] - 2 * u0[i] + u0[i + 1]);
  }
  u1[0] = left; u1[nx] = right;

  const levels: number[][] = [u0.slice(), u1.slice()];
  const times = [0, dt];
  let prev = u0.slice();
  let cur = u1.slice();

  for (let k = 2; k <= nt; k++) {
    const next = cur.slice();
    for (let i = 1; i < nx; i++) {
      next[i] = 2 * cur[i] - prev[i] + C2 * (cur[i - 1] - 2 * cur[i] + cur[i + 1]);
    }
    next[0] = left; next[nx] = right;
    if (!next.every(Number.isFinite)) {
      return { ok: false, error: `The solution stopped being finite at step ${k}.` };
    }
    prev = cur;
    cur = next;
    levels.push(cur.slice());
    times.push(k * dt);
  }

  const stride = levelStride(levels.length, opts.reportLevels ?? 21);
  const keep: number[] = [];
  for (let i = 0; i < levels.length; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== levels.length - 1) keep.push(levels.length - 1);

  const steps = [
    `Wave equation u_tt = ${c}² u_xx on [0, ${L}] to t = ${tEnd}.`,
    `Explicit leapfrog on ${nx} intervals, ${nt} steps. Courant number C = cΔt/Δx = ${C.toFixed(4)} (must be ≤ 1).`,
    `The first time level uses a Taylor step with u_tt = c² u_xx substituted, so the run is second-order throughout.`,
  ];
  if (C === 1) {
    steps.push("At C = 1 this scheme is not merely stable but EXACT for the 1D wave equation — it reproduces d'Alembert's solution on the grid.");
  }
  if (clamped) {
    steps.push("The requested Courant number exceeded 1 and was reduced to 1. Above 1 the scheme is unconditionally unstable — the answer would have been noise.");
  }

  const caveats = [
    "The wave equation does NOT smooth its initial data. A corner in u(x,0) stays a corner, and near it the finite-difference solution shows dispersive ripples that are an artefact of the grid, not physics.",
    "Fixed (Dirichlet) ends, so waves REFLECT off both boundaries. There is no absorbing boundary here; after t = L/c the picture contains reflections.",
    "Linear, constant speed, one space dimension.",
  ];

  return {
    ok: true,
    result: {
      kind: "wave", x, t: keep.map((i) => times[i]), u: keep.map((i) => levels[i]),
      scheme: "explicit leapfrog", stabilityNumber: C, converged: true, steps, caveats,
    },
  };
}

// ---------------------------------------------------------------------------
// Laplace / Poisson: u_xx + u_yy = f(x,y) on a rectangle, Dirichlet boundary.

export function solveLaplace(
  W: number, H: number,
  boundary: (x: number, y: number) => number,
  opts: { nx?: number; ny?: number; source?: (x: number, y: number) => number; tol?: number; maxIter?: number } = {}
): PdeOutcome {
  if (!Number.isFinite(W) || W <= 0 || !Number.isFinite(H) || H <= 0) {
    return { ok: false, error: "The rectangle's width and height must be positive finite numbers." };
  }
  const nx = gridSize(opts.nx, 40, 3, MAX_NODES_2D);
  const ny = gridSize(opts.ny, 40, 3, MAX_NODES_2D);
  const dx = W / nx;
  const dy = H / ny;
  const x = Array.from({ length: nx + 1 }, (_, i) => i * dx);
  const y = Array.from({ length: ny + 1 }, (_, j) => j * dy);

  // u[j][i] — row index is y, so the array prints the way the region is drawn.
  const gb = guard2(boundary);
  const gs = opts.source ? guard2(opts.source) : null;
  const u: number[][] = Array.from({ length: ny + 1 }, () => new Array<number>(nx + 1).fill(0));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const onEdge = i === 0 || i === nx || j === 0 || j === ny;
      if (onEdge) {
        const v = gb.fn(x[i], y[j]);
        if (!Number.isFinite(v)) return { ok: false, error: "The boundary values are not finite everywhere." };
        u[j][i] = v;
      }
    }
  }
  if (gb.error) return { ok: false, error: `The boundary values could not be evaluated: ${gb.error}` };
  const src = gs ? gs.fn : null;
  const fgrid: number[][] = Array.from({ length: ny + 1 }, (_, j) =>
    Array.from({ length: nx + 1 }, (_, i) => (src ? src(x[i], y[j]) : 0))
  );
  if (gs && gs.error) return { ok: false, error: `The source term could not be evaluated: ${gs.error}` };
  if (fgrid.some((row) => row.some((v) => !Number.isFinite(v)))) {
    return { ok: false, error: "The source term is not finite everywhere on the grid." };
  }

  // Successive over-relaxation. The optimal ω for a rectangle is known in closed
  // form, and using it turns thousands of Gauss-Seidel sweeps into dozens.
  const rj = (Math.cos(Math.PI / nx) + (dx / dy) ** 2 * Math.cos(Math.PI / ny)) / (1 + (dx / dy) ** 2);
  const omega = 2 / (1 + Math.sqrt(Math.max(0, 1 - rj * rj)));
  const bx = 1 / (dx * dx);
  const by = 1 / (dy * dy);
  const denom = 2 * (bx + by);
  const tol = opts.tol ?? 1e-10;
  // A 400x400 grid relaxed to 1e-10 took 91 SECONDS: memory-bounded, entirely
  // unbounded in TIME. Sweeps are budgeted by total point-updates so the cost
  // of a solve cannot grow with the grid without limit.
  const perSweep = Math.max(1, (nx - 1) * (ny - 1));
  const budgetIter = Math.max(50, Math.floor(RELAX_WORK_BUDGET / perSweep));
  const maxIter = Math.min(gridSize(opts.maxIter, 20000, 1, 200000), budgetIter);

  let iterations = 0;
  let converged = false;
  for (let it = 1; it <= maxIter; it++) {
    let maxChange = 0;
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const gs =
          (bx * (u[j][i - 1] + u[j][i + 1]) + by * (u[j - 1][i] + u[j + 1][i]) - fgrid[j][i]) / denom;
        const next = u[j][i] + omega * (gs - u[j][i]);
        maxChange = Math.max(maxChange, Math.abs(next - u[j][i]));
        u[j][i] = next;
      }
    }
    iterations = it;
    if (!Number.isFinite(maxChange)) return { ok: false, error: `The relaxation diverged at iteration ${it}.` };
    if (maxChange < tol) { converged = true; break; }
  }

  const steps = [
    `${src ? "Poisson" : "Laplace"} equation on a ${W} × ${H} rectangle, ${nx} × ${ny} intervals.`,
    `Five-point stencil solved by successive over-relaxation with ω = ${omega.toFixed(4)} (the optimal value for a rectangle of this shape).`,
    converged
      ? `Converged in ${iterations} sweeps to a maximum change below ${tol.toExponential(0)}.`
      : `Stopped after ${iterations} sweeps WITHOUT reaching the tolerance` +
        (iterations >= budgetIter ? " — the work budget for this grid size was reached. A coarser grid converges further per unit of work." : "") + ".",
  ];
  const caveats = [
    "Second-order accurate. Dirichlet boundary values on all four sides of a rectangle — no other shape and no other boundary condition.",
    "An elliptic problem has no time: this is the steady state, the field the heat equation would relax to after infinitely long.",
  ];
  if (!converged) {
    caveats.push("The iteration did not converge to tolerance, so the field reported is not a solution. Treat it as an unfinished relaxation, not an answer.");
  }

  return {
    ok: true,
    result: {
      kind: "laplace", x, y, u, scheme: "5-point stencil, SOR",
      iterations, converged, steps, caveats,
    },
  };
}
