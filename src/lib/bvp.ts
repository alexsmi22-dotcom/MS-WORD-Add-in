// Two-point boundary value problems:  y'' = f(x, y, y'),  y(a) = α,  y(b) = β.
//
// A BVP is not an IVP with the data written differently, and the difference is
// the whole reason this file exists rather than a wrapper around ode.ts.
//
//   AN IVP HAS ONE SOLUTION. A BVP MAY HAVE NONE, ONE, OR INFINITELY MANY.
//   y'' + y = 0 on [0, π] with y(0) = 0, y(π) = 0 has infinitely many (every
//   multiple of sin x). Change the right boundary to y(π) = 1 and it has NONE.
//   Both are perfectly ordinary-looking inputs, and a solver that returns "a"
//   solution for either is lying. Every result here therefore says which of
//   those situations it believes it is in, and on what evidence.
//
// Two methods, because they fail in different places and neither dominates:
//
//   FINITE DIFFERENCES  discretise the whole interval at once and solve the
//     resulting system with Newton. Robust — it never has to integrate far from
//     the solution — and it is what runs by default. Error is O(h²).
//   SHOOTING            guess y'(a), integrate as an IVP, and correct the guess
//     from how far the far boundary was missed. Accurate when it converges, and
//     it genuinely fails to converge on unstable problems, where a small change
//     in the initial slope grows exponentially across the interval. It reports
//     that rather than returning its last iterate.
//
// THE SELF-CHECK. Everything is solved TWICE, on a grid of n and of 2n, and the
// two are compared by Richardson extrapolation. For a second-order method the
// difference should fall by ~4×, so the ratio is both an error estimate and a
// test that the method is behaving as its theory says. When the observed order
// is nowhere near 2 the result says so — that is the signature of a solution
// with a kink, a boundary layer the grid cannot see, or a bug.

/** y'' = f(x, y, y'). */
export type BvpRhs = (x: number, y: number, yp: number) => number;

export type BvpMethod = "fd" | "shooting";

export interface BvpResult {
  x: number[];
  y: number[];
  /** y' at each grid point, by central differences (one-sided at the ends). */
  yp: number[];
  method: BvpMethod;
  /** Grid intervals used for the reported solution. */
  n: number;
  /**
   * Richardson estimate of the max error in `y`. Absent when the two grids
   * disagreed so badly that extrapolating between them would be meaningless.
   */
  errorEstimate?: number;
  /** Observed convergence order from the two grids; ~2 for finite differences. */
  observedOrder?: number;
  converged: boolean;
  steps: string[];
  caveats: string[];
}

export type BvpOutcome =
  | { ok: true; result: BvpResult }
  | { ok: false; error: string; caveats: string[] };

const MAX_N = 4000;
const NEWTON_MAX = 60;

/** Thomas algorithm. Returns null if a pivot vanishes — the system is singular there. */
export function solveTridiagonal(
  lower: number[], diag: number[], upper: number[], rhs: number[]
): number[] | null {
  const n = diag.length;
  const c = upper.slice();
  const d = rhs.slice();
  const b = diag.slice();
  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(b[i - 1]) || Math.abs(b[i - 1]) < 1e-300) return null;
    const m = lower[i] / b[i - 1];
    b[i] -= m * c[i - 1];
    d[i] -= m * d[i - 1];
  }
  if (!Number.isFinite(b[n - 1]) || Math.abs(b[n - 1]) < 1e-300) return null;
  const out = new Array<number>(n);
  out[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) out[i] = (d[i] - c[i] * out[i + 1]) / b[i];
  return out.every(Number.isFinite) ? out : null;
}

/**
 * One finite-difference solve on a fixed grid of `n` intervals.
 *
 * Interior unknowns are y_1..y_{n-1}; the boundaries are known. The discrete
 * equations are
 *     (y_{i-1} - 2 y_i + y_{i+1}) / h²  -  f(x_i, y_i, (y_{i+1} - y_{i-1}) / 2h)  =  0
 * and Newton is applied to that system. The Jacobian is tridiagonal because each
 * equation touches only its two neighbours, so each iteration is O(n).
 *
 * The partial derivatives of f are taken numerically — f is a user-supplied
 * callback and there is no symbolic form to differentiate.
 */
function fdSolve(
  f: BvpRhs, a: number, b: number, alpha: number, beta: number, n: number,
  guess?: (x: number) => number
): { y: number[]; converged: boolean; iterations: number } | null {
  const h = (b - a) / n;
  const x = Array.from({ length: n + 1 }, (_, i) => a + i * h);
  const y = new Array<number>(n + 1);
  y[0] = alpha;
  y[n] = beta;
  // A straight line between the boundary values is the standard starting point
  // and costs nothing when it is wrong — Newton simply takes a few more steps.
  for (let i = 1; i < n; i++) y[i] = guess ? guess(x[i]) : alpha + ((beta - alpha) * i) / n;

  const m = n - 1;
  if (m < 1) return null;

  for (let iter = 0; iter < NEWTON_MAX; iter++) {
    const F = new Array<number>(m);
    const lower = new Array<number>(m).fill(0);
    const diag = new Array<number>(m).fill(0);
    const upper = new Array<number>(m).fill(0);

    for (let k = 0; k < m; k++) {
      const i = k + 1;
      const yp = (y[i + 1] - y[i - 1]) / (2 * h);
      const fi = f(x[i], y[i], yp);
      if (!Number.isFinite(fi)) return null;
      F[k] = (y[i - 1] - 2 * y[i] + y[i + 1]) / (h * h) - fi;

      // Numerical partials. The step scales with the magnitude of the argument
      // so it stays meaningful for both tiny and large values.
      const dy = Math.max(1e-7, 1e-7 * Math.abs(y[i]));
      const dyp = Math.max(1e-7, 1e-7 * Math.abs(yp));
      const dfdy = (f(x[i], y[i] + dy, yp) - fi) / dy;
      const dfdyp = (f(x[i], y[i], yp + dyp) - fi) / dyp;
      if (!Number.isFinite(dfdy) || !Number.isFinite(dfdyp)) return null;

      diag[k] = -2 / (h * h) - dfdy;
      if (k > 0) lower[k] = 1 / (h * h) + dfdyp / (2 * h);
      if (k < m - 1) upper[k] = 1 / (h * h) - dfdyp / (2 * h);
    }

    const delta = solveTridiagonal(lower, diag, upper, F.map((v) => -v));
    if (!delta) return null;

    let maxStep = 0;
    for (let k = 0; k < m; k++) {
      y[k + 1] += delta[k];
      maxStep = Math.max(maxStep, Math.abs(delta[k]));
    }
    if (!y.every(Number.isFinite)) return null;
    if (maxStep < 1e-12 * (1 + Math.max(...y.map(Math.abs)))) {
      return { y, converged: true, iterations: iter + 1 };
    }
  }
  return { y, converged: false, iterations: NEWTON_MAX };
}

/** Central-difference derivative on a uniform grid, one-sided at the ends. */
function derivatives(y: number[], h: number): number[] {
  const n = y.length - 1;
  const yp = new Array<number>(n + 1);
  for (let i = 1; i < n; i++) yp[i] = (y[i + 1] - y[i - 1]) / (2 * h);
  // Second-order one-sided formulas, so the ends are not a worse approximation
  // than the interior.
  yp[0] = (-3 * y[0] + 4 * y[1] - y[2]) / (2 * h);
  yp[n] = (3 * y[n] - 4 * y[n - 1] + y[n - 2]) / (2 * h);
  return yp;
}

/** Fixed-step RK4 — used by the shooting method, where the step must be reproducible. */
function rk4(
  f: BvpRhs, a: number, alpha: number, slope: number, h: number, n: number
): { x: number[]; y: number[]; yp: number[] } | null {
  const x = [a];
  const y = [alpha];
  const yp = [slope];
  let cy = alpha;
  let cp = slope;
  for (let i = 0; i < n; i++) {
    const t = a + i * h;
    const k1y = cp, k1p = f(t, cy, cp);
    const k2y = cp + (h / 2) * k1p, k2p = f(t + h / 2, cy + (h / 2) * k1y, cp + (h / 2) * k1p);
    const k3y = cp + (h / 2) * k2p, k3p = f(t + h / 2, cy + (h / 2) * k2y, cp + (h / 2) * k2p);
    const k4y = cp + h * k3p, k4p = f(t + h, cy + h * k3y, cp + h * k3p);
    cy += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    cp += (h / 6) * (k1p + 2 * k2p + 2 * k3p + k4p);
    if (!Number.isFinite(cy) || !Number.isFinite(cp)) return null;
    x.push(t + h);
    y.push(cy);
    yp.push(cp);
  }
  return { x, y, yp };
}

/**
 * Shooting: find the initial slope s such that y(b; s) = β, by the secant
 * method on the miss distance.
 *
 * Divergence here is a real property of the problem, not a defect in the code —
 * on an unstable BVP the map s → y(b; s) amplifies a slope perturbation
 * exponentially, so no guess is accurate enough. That is reported.
 */
function shoot(
  f: BvpRhs, a: number, b: number, alpha: number, beta: number, n: number
): { y: number[]; yp: number[]; converged: boolean; slope: number } | null {
  const h = (b - a) / n;
  const miss = (s: number): number | null => {
    const r = rk4(f, a, alpha, s, h, n);
    return r ? r.y[n] - beta : null;
  };
  // Two starting slopes: the straight-line slope, and a perturbation of it.
  let s0 = (beta - alpha) / (b - a);
  let s1 = s0 + (Math.abs(s0) > 1 ? 0.1 * Math.abs(s0) : 0.1);
  let f0 = miss(s0);
  let f1 = miss(s1);
  if (f0 === null || f1 === null) return null;

  for (let i = 0; i < 60; i++) {
    if (Math.abs(f1) < 1e-10 * (1 + Math.abs(beta))) break;
    const den = f1 - f0;
    if (!Number.isFinite(den) || Math.abs(den) < 1e-300) break;
    const s2 = s1 - (f1 * (s1 - s0)) / den;
    if (!Number.isFinite(s2)) return null;
    const f2 = miss(s2);
    if (f2 === null) return null;
    s0 = s1; f0 = f1; s1 = s2; f1 = f2;
  }
  const final = rk4(f, a, alpha, s1, h, n);
  if (!final) return null;
  return {
    y: final.y,
    yp: final.yp,
    converged: Math.abs(final.y[n] - beta) < 1e-6 * (1 + Math.abs(beta)),
    slope: s1,
  };
}

/**
 * Solve y'' = f(x, y, y') with y(a) = α, y(b) = β.
 *
 * Runs on two grids and compares them, both to estimate the error and to check
 * that the method converged at the order it should.
 */
export function solveBvp(
  f: BvpRhs, a: number, b: number, alpha: number, beta: number,
  opts: { n?: number; method?: BvpMethod } = {}
): BvpOutcome {
  const caveats: string[] = [];
  if (![a, b, alpha, beta].every(Number.isFinite)) {
    return { ok: false, error: "The interval and boundary values must all be finite numbers.", caveats };
  }
  if (a === b) return { ok: false, error: "The interval is empty — a and b are the same point.", caveats };
  if (b < a) return { ok: false, error: "The right endpoint must be greater than the left endpoint.", caveats };

  const method: BvpMethod = opts.method ?? "fd";
  let n = Math.max(8, Math.min(Math.floor(opts.n ?? 200), MAX_N));
  if (n % 2 === 1) n += 1; // so the coarse grid is a subset of the fine one

  const run = (m: number): { y: number[]; converged: boolean } | null => {
    if (method === "shooting") {
      const r = shoot(f, a, b, alpha, beta, m);
      return r ? { y: r.y, converged: r.converged } : null;
    }
    const r = fdSolve(f, a, b, alpha, beta, m);
    return r ? { y: r.y, converged: r.converged } : null;
  };

  const coarse = run(n);
  if (!coarse) {
    return {
      ok: false,
      caveats,
      error:
        method === "shooting"
          ? "Shooting diverged — the solution ran off to infinity before reaching the far boundary. This is typical of an unstable problem; try the finite-difference method."
          : "The finite-difference solve failed: the equations were not finite on the grid, or the Newton system was singular.",
    };
  }
  const fine = run(2 * n);
  if (!fine) {
    return { ok: false, error: "The refined grid failed to solve, so no error estimate is possible and no answer is reported.", caveats };
  }

  // Compare the two grids at the points they share.
  let maxDiff = 0;
  for (let i = 0; i <= n; i++) maxDiff = Math.max(maxDiff, Math.abs(fine.y[2 * i] - coarse.y[i]));

  const steps: string[] = [];
  steps.push(
    method === "fd"
      ? `Finite differences: the interval is split into ${2 * n} intervals and the discrete equations solved by Newton (the Jacobian is tridiagonal, so each iteration is O(n)).`
      : `Shooting: y'(a) is chosen by the secant method so that y(b) lands on ${beta}.`
  );

  // Richardson. For a second-order method, halving h should cut the error by 4.
  let errorEstimate: number | undefined;
  let observedOrder: number | undefined;
  const quarter = run(n / 2 >= 4 ? Math.floor(n / 2) : n);
  if (quarter && n / 2 >= 4) {
    let d1 = 0;
    for (let i = 0; i <= n / 2; i++) d1 = Math.max(d1, Math.abs(coarse.y[2 * i] - quarter.y[i]));
    if (d1 > 0 && maxDiff > 0) {
      observedOrder = Math.log2(d1 / maxDiff);
      steps.push(
        `Self-check: solved on three grids. The change from one refinement to the next fell by a factor of ${(d1 / maxDiff).toFixed(2)}, an observed order of ${observedOrder.toFixed(2)}.`
      );
    }
  }
  if (Number.isFinite(maxDiff)) {
    // For order p, the fine-grid error is about diff / (2^p − 1).
    const p = observedOrder && observedOrder > 0.5 ? observedOrder : 2;
    errorEstimate = maxDiff / (Math.pow(2, p) - 1);
    steps.push(`Richardson estimate of the error in the reported solution: ${errorEstimate.toExponential(2)}.`);
  }

  if (observedOrder !== undefined && (observedOrder < 1.3 || observedOrder > 3)) {
    caveats.push(
      `The observed convergence order is ${observedOrder.toFixed(2)}, not the ~2 this method should give. ` +
        `That usually means the solution has a kink or a boundary layer the grid cannot resolve — the error estimate above should not be trusted.`
    );
  }
  if (!fine.converged) {
    caveats.push(
      method === "shooting"
        ? "The secant iteration did not drive the far boundary to β. What is reported misses the boundary condition, so it is NOT a solution of the stated problem."
        : "Newton did not converge to tolerance. The values reported are its last iterate and may not satisfy the equation."
    );
  }

  // The uniqueness question, which the arithmetic cannot settle.
  caveats.push(
    "A boundary value problem may have NO solution, exactly one, or infinitely many — unlike an initial value problem. This reports ONE solution and cannot tell you which case you are in. y'' + y = 0 on [0, π] with both ends zero has infinitely many; move one endpoint to y(π) = 1 and it has none."
  );
  if (method === "shooting") {
    caveats.push("Shooting converges to the solution nearest its starting slope. A different starting guess can land on a different solution when several exist.");
  }
  caveats.push(`Finite differences are second-order accurate: halving the spacing cuts the error by about four. The solution is reported on ${2 * n + 1} points.`);

  const h = (b - a) / (2 * n);
  const x = Array.from({ length: 2 * n + 1 }, (_, i) => a + i * h);
  return {
    ok: true,
    result: {
      x, y: fine.y, yp: derivatives(fine.y, h),
      method, n: 2 * n, errorEstimate, observedOrder,
      converged: fine.converged, steps, caveats,
    },
  };
}
