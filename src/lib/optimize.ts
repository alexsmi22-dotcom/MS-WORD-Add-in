// Unconstrained optimization — Nelder–Mead simplex minimization.
//
// Derivative-free, so it works directly on an objective the user types as an
// expression (no gradients needed). Robust for the small-dimensional problems a
// document author poses (curve tuning, parameter search, "minimize this cost").
// Pure; the objective is any (x: number[]) => number. To maximize, negate.

export interface OptimizeResult {
  /** Location of the minimum. */
  x: number[];
  /** Objective value there. */
  fx: number;
  iterations: number;
  /** True if the simplex converged within tolerance before the iteration cap. */
  converged: boolean;
}

export interface OptimizeOptions {
  maxIter?: number;
  /** Convergence tolerance on both the simplex spread and the objective spread. */
  tol?: number;
  /** Initial simplex step (absolute) added per coordinate; scaled per-coord when 0. */
  step?: number;
}

/**
 * Minimizes `f` starting from `x0` by the Nelder–Mead simplex method. Standard
 * reflection/expansion/contraction/shrink with the usual coefficients. Converges
 * when both the vertex spread and the objective spread fall below `tol`.
 */
export function nelderMead(f: (x: number[]) => number, x0: number[], opts: OptimizeOptions = {}): OptimizeResult {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 2000;
  const tol = opts.tol ?? 1e-8;
  const alpha = 1;
  const gamma = 2;
  const rho = 0.5;
  const sigma = 0.5;

  // Initial simplex: x0 plus one perturbed vertex per coordinate (scipy-style
  // relative step, with an absolute fallback for zero coordinates).
  const simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const v = x0.slice();
    const delta = opts.step ?? (x0[i] !== 0 ? 0.05 * x0[i] : 0.00025);
    v[i] += delta;
    simplex.push(v);
  }

  let fvals = simplex.map(f);
  let iter = 0;
  const centroid = (exclude: number): number[] => {
    const c = new Array(n).fill(0);
    for (let k = 0; k <= n; k++) {
      if (k === exclude) continue;
      for (let j = 0; j < n; j++) c[j] += simplex[k][j];
    }
    for (let j = 0; j < n; j++) c[j] /= n;
    return c;
  };
  const combine = (a: number[], b: number[], t: number): number[] => a.map((av, j) => av + t * (b[j] - av));

  let converged = false;
  for (; iter < maxIter; iter++) {
    // order vertices best → worst
    const order = Array.from({ length: n + 1 }, (_, i) => i).sort((a, b) => fvals[a] - fvals[b]);
    const s2: number[][] = order.map((i) => simplex[i]);
    const f2: number[] = order.map((i) => fvals[i]);
    for (let k = 0; k <= n; k++) {
      simplex[k] = s2[k];
      fvals[k] = f2[k];
    }

    // convergence: spread of objective and of vertices both tiny
    const fspread = Math.abs(fvals[n] - fvals[0]);
    let xspread = 0;
    for (let k = 1; k <= n; k++) for (let j = 0; j < n; j++) xspread = Math.max(xspread, Math.abs(simplex[k][j] - simplex[0][j]));
    if (fspread <= tol * (Math.abs(fvals[0]) + tol) && xspread <= tol * (norm(simplex[0]) + tol)) {
      converged = true;
      break;
    }

    const c = centroid(n); // exclude the worst
    const xr = combine(c, simplex[n], -alpha); // reflection: c + alpha(c - worst) = 2c - worst
    const fr = f(xr);

    if (fr < fvals[0]) {
      const xe = combine(c, xr, gamma); // expand
      const fe = f(xe);
      if (fe < fr) {
        simplex[n] = xe;
        fvals[n] = fe;
      } else {
        simplex[n] = xr;
        fvals[n] = fr;
      }
    } else if (fr < fvals[n - 1]) {
      simplex[n] = xr;
      fvals[n] = fr;
    } else {
      // contraction
      let contracted: number[];
      let fc: number;
      if (fr < fvals[n]) {
        contracted = combine(c, xr, rho); // outside contraction
        fc = f(contracted);
      } else {
        contracted = combine(c, simplex[n], rho); // inside contraction
        fc = f(contracted);
      }
      if (fc < Math.min(fr, fvals[n])) {
        simplex[n] = contracted;
        fvals[n] = fc;
      } else {
        // shrink toward the best vertex
        for (let k = 1; k <= n; k++) {
          simplex[k] = combine(simplex[0], simplex[k], sigma);
          fvals[k] = f(simplex[k]);
        }
      }
    }
  }

  let best = 0;
  for (let k = 1; k <= n; k++) if (fvals[k] < fvals[best]) best = k;
  return { x: simplex[best].slice(), fx: fvals[best], iterations: iter, converged };
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}
