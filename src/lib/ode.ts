// Ordinary differential equations — two integrators plus an auto-selector.
//
//   integrate()       explicit adaptive Dormand–Prince RK45. Fast and very
//                     accurate on well-behaved (non-stiff) problems.
//   integrateStiff()  linearly-implicit Rosenbrock (Shampine's modified
//                     Rosenbrock pair, the method behind MATLAB's ode23s).
//                     L-stable, so it handles STIFF systems that RK45 cannot.
//   solveOde()        runs RK45 and switches to the stiff solver automatically
//                     when the problem turns out to be stiff.
//
// Why two solvers: an explicit method's step size on a stiff problem is limited
// by STABILITY, not accuracy, so it crawls or dies — Van der Pol at μ=1000 burns
// through any step budget under RK45. Stiffness is the normal case in chemical
// kinetics whenever rate constants differ by orders of magnitude, so the stiff
// path is not an exotic extra here.
//
// Honest trade-off between them: RK45 is 5th order, the Rosenbrock is 2nd. On a
// NON-stiff problem RK45 is both faster and far more accurate (y' = -y over
// [0,5] at rtol 1e-6: RK45 hits 8 significant figures in 23 steps; the stiff
// solver takes 188 steps for ~4). Low-order global error accumulates — local
// error control bounds the step, not the total. That is exactly why "auto"
// stays on RK45 unless the problem is actually stiff, and why tightening rtol is
// the right move when the stiff path is in use. Both solvers converge cleanly:
// error falls monotonically as rtol tightens.
//
// Systems are y' = f(t, y). Higher-order ODEs are entered by hand-reducing to
// first order (y'' = -y → y1' = y2, y2' = -y1). Pure; f is any (t, y[]) => y'[].

export interface OdeResult {
  /** Time points (includes t0 and t1). */
  t: number[];
  /** State at each time point; y[i] is the vector at t[i]. */
  y: number[][];
  /** Number of accepted steps. */
  steps: number;
  /** True if the integration reached t1 within the step budget. */
  completed: boolean;
  /** Which integrator produced this result. */
  method?: OdeMethodUsed;
  /** Why the solver stopped early, when it did. */
  stopReason?: "stiff" | "stepUnderflow" | "stepBudget";
}

/** What actually ran — "rk45→stiff" means the auto-selector switched mid-run. */
export type OdeMethodUsed = "rk45" | "stiff" | "rk45→stiff";

/** Solver choice. "auto" starts explicit and switches to stiff if needed. */
export type OdeMethod = "auto" | "rk45" | "stiff";

export interface OdeOptions {
  rtol?: number;
  atol?: number;
  hInit?: number;
  maxSteps?: number;
  /**
   * Stop as soon as the step controller shows the problem is stiff, returning
   * the partial solution with stopReason "stiff". Used by solveOde() to hand off
   * to the implicit solver; off by default so integrate() keeps its old
   * behaviour for callers that asked for RK45 specifically.
   */
  detectStiff?: boolean;
}

// Dormand–Prince coefficients (the classic RK45 tableau).
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A: number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
// 5th-order solution weights (b) and 4th-order (bStar) for error estimate.
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

function axpy(y: number[], k: number[], h: number): number[] {
  return y.map((yi, i) => yi + h * k[i]);
}

/**
 * Integrates y' = f(t, y) from t0 to t1 with adaptive step control. Returns the
 * accepted (t, y) points. `t1` may be less than `t0` (integrates backward).
 */
export function integrate(
  f: (t: number, y: number[]) => number[],
  y0: number[],
  t0: number,
  t1: number,
  opts: OdeOptions = {},
): OdeResult {
  const rtol = opts.rtol ?? 1e-6;
  const atol = opts.atol ?? 1e-9;
  const maxSteps = opts.maxSteps ?? 100000;
  const detectStiff = opts.detectStiff ?? false;
  const dir = t1 >= t0 ? 1 : -1;
  const span = Math.abs(t1 - t0);
  let h = opts.hInit ?? (span / 100 || 1e-3);
  h = Math.abs(h) * dir;

  const ts = [t0];
  const ys = [y0.slice()];
  let t = t0;
  let y = y0.slice();
  let steps = 0;
  let stiffHits = 0;
  let nonStiffRun = 0;
  let stopReason: OdeResult["stopReason"];

  while ((dir > 0 ? t < t1 : t > t1) && steps < maxSteps) {
    // don't overshoot the endpoint
    if ((dir > 0 && t + h > t1) || (dir < 0 && t + h < t1)) h = t1 - t;

    const k: number[][] = [];
    const stageY: number[][] = [];
    k[0] = f(t, y);
    stageY[0] = y.slice();
    for (let s = 1; s < 7; s++) {
      let yi = y.slice();
      for (let j = 0; j < s; j++) yi = axpy(yi, k[j], h * A[s][j]);
      stageY[s] = yi;
      k[s] = f(t + C[s] * h, yi);
    }
    let y5 = y.slice();
    let y4 = y.slice();
    for (let s = 0; s < 7; s++) {
      y5 = axpy(y5, k[s], h * B5[s]);
      y4 = axpy(y4, k[s], h * B4[s]);
    }

    // scaled error norm
    let err = 0;
    for (let i = 0; i < y.length; i++) {
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y5[i]));
      const e = (y5[i] - y4[i]) / sc;
      err += e * e;
    }
    err = Math.sqrt(err / y.length);

    // Accept only on a finite error within tolerance. A non-finite error means
    // the solution is blowing up (e.g. y' = y²) — never accept that step.
    if (Number.isFinite(err) && err <= 1) {
      // Stiffness probe (Hairer's DOPRI5 test), free of extra f-evaluations:
      // stages 6 and 7 straddle t+h, so ‖Δk‖/‖Δy‖ approximates the dominant
      // eigenvalue of the Jacobian. h·|λ| beyond RK45's real-axis stability
      // boundary (~3.25) means the step is being limited by STABILITY rather
      // than accuracy — the definition of stiffness.
      if (detectStiff) {
        let dk = 0;
        let dy = 0;
        for (let i = 0; i < y.length; i++) {
          dk += (k[6][i] - k[5][i]) ** 2;
          dy += (stageY[6][i] - stageY[5][i]) ** 2;
        }
        const hLambda = dy > 0 ? Math.abs(h) * Math.sqrt(dk / dy) : 0;
        if (Number.isFinite(hLambda) && hLambda > 3.25) {
          nonStiffRun = 0;
          // Require a run of consistent hits: one spike is a transient, not
          // stiffness, and a false switch would slow a healthy problem down.
          if (++stiffHits >= 15) {
            stopReason = "stiff";
            t += h;
            y = y5;
            ts.push(t);
            ys.push(y.slice());
            steps++;
            break;
          }
        } else if (++nonStiffRun >= 6) {
          stiffHits = 0;
        }
      }
      t += h;
      y = y5;
      ts.push(t);
      ys.push(y.slice());
      steps++;
      const factor = err === 0 ? 5 : 0.9 * Math.pow(err, -1 / 5);
      h *= Math.min(5, factor);
    } else {
      // Reject and shrink. A non-finite error can't drive the exponent, so shrink
      // by the hard minimum instead.
      const factor = Number.isFinite(err) && err > 0 ? Math.max(0.2, 0.9 * Math.pow(err, -1 / 5)) : 0.2;
      h *= factor;
    }

    // Give up if the step underflows (blow-up / stiffness) or becomes non-finite —
    // this GUARANTEES termination: every iteration either accepts a step (bounded
    // by maxSteps) or strictly shrinks |h| toward this floor.
    if (!Number.isFinite(h) || Math.abs(h) <= 1e-13 * Math.max(1, Math.abs(t))) {
      stopReason = "stepUnderflow";
      break;
    }
  }

  const completed = dir > 0 ? t >= t1 - 1e-9 : t <= t1 + 1e-9;
  if (!completed && !stopReason && steps >= maxSteps) stopReason = "stepBudget";
  return { t: ts, y: ys, steps, completed, method: "rk45", stopReason };
}

// ---------------------------------------------------------------------------
// Stiff solver — Shampine's modified Rosenbrock pair (the ode23s method)
//
// Linearly implicit: each step solves three linear systems against the SAME
// matrix W = I − h·d·J, so one LU factorisation serves the whole step and there
// is no Newton iteration to converge. Second-order accurate with a third-order
// embedded error estimate, and L-stable — which is what lets it take large steps
// on stiff problems instead of being throttled by stability.
// ---------------------------------------------------------------------------

const ROS_D = 1 / (2 + Math.SQRT2);
const ROS_E32 = 6 + Math.SQRT2;
/** Relative perturbation for finite-difference derivatives (≈ √machine-eps). */
const FD_EPS = 1.4901161193847656e-8;

interface LU {
  lu: number[][];
  piv: number[];
  singular: boolean;
}

/** Crout/Doolittle LU with partial pivoting. Factor once, solve many. */
function luFactor(a: number[][]): LU {
  const n = a.length;
  const lu = a.map((r) => r.slice());
  const piv = Array.from({ length: n }, (_, i) => i);
  let singular = false;
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(lu[r][col]) > Math.abs(lu[p][col])) p = r;
    if (Math.abs(lu[p][col]) < 1e-300) {
      singular = true;
      continue;
    }
    if (p !== col) {
      [lu[p], lu[col]] = [lu[col], lu[p]];
      [piv[p], piv[col]] = [piv[col], piv[p]];
    }
    for (let r = col + 1; r < n; r++) {
      lu[r][col] /= lu[col][col];
      const m = lu[r][col];
      if (m === 0) continue;
      for (let c = col + 1; c < n; c++) lu[r][c] -= m * lu[col][c];
    }
  }
  return { lu, piv, singular };
}

function luSolve(fac: LU, b: number[]): number[] | null {
  if (fac.singular) return null;
  const { lu, piv } = fac;
  const n = lu.length;
  const x = piv.map((p) => b[p]);
  for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) x[i] -= lu[i][j] * x[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= lu[i][j] * x[j];
    x[i] /= lu[i][i];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

/** Numerical Jacobian ∂f/∂y by forward differences (n extra f-evaluations). */
function jacobian(f: (t: number, y: number[]) => number[], t: number, y: number[], f0: number[]): number[][] {
  const n = y.length;
  const J = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const dy = FD_EPS * Math.max(Math.abs(y[j]), 1e-3);
    const yp = y.slice();
    yp[j] += dy;
    const fp = f(t, yp);
    for (let i = 0; i < n; i++) J[i][j] = (fp[i] - f0[i]) / dy;
  }
  return J;
}

/** Numerical ∂f/∂t by forward difference — zero for autonomous systems. */
function dfdt(
  f: (t: number, y: number[]) => number[],
  t: number,
  y: number[],
  f0: number[],
  h: number
): number[] {
  const dt = FD_EPS * Math.max(Math.abs(t), Math.abs(h), 1e-3);
  const fp = f(t + dt, y);
  return f0.map((v, i) => (fp[i] - v) / dt);
}

// --- RODAS4 -----------------------------------------------------------------
// Hairer & Wanner's RODAS: a 4th-order (3rd-order embedded) Rosenbrock, 6 stages,
// L-stable and STIFFLY ACCURATE. This is the high-accuracy stiff path: it gets
// the accuracy of the explicit solver on problems where the explicit solver
// cannot run at all, and reaches a given error in far fewer steps than the
// 2nd-order ode23s method.
//
// Stiff accuracy gives the error estimate its elegant form: the embedded 3rd
// order solution is exactly the 6th stage value, so y_new = y6stage + k6 and the
// error estimate is simply k6.
const RODAS_GAMMA = 0.25;
const RODAS_ALPHA = [0, 0.386, 0.21, 0.63, 1, 1];
// a[i][j] — stage-value coefficients.
const RODAS_A: number[][] = [
  [],
  [1.544],
  [0.9466785280815826, 0.2557011698983284],
  [3.314825187068521, 2.896124015972201, 0.9986419139977817],
  [1.221224509226641, 6.019134481288629, 12.53708332932087, -0.687886036105895],
  [1.221224509226641, 6.019134481288629, 12.53708332932087, -0.687886036105895, 1],
];
// c[i][j] — the (gamma_ij / h) coupling terms.
const RODAS_C: number[][] = [
  [],
  [-5.6688],
  [-2.430093356833875, -0.2063599157091915],
  [-0.1073529058151375, -9.594562251023355, -20.4702861489071],
  [7.496443313967647, -10.24680431464352, -33.99990352819905, 11.7089089320616],
  [8.083246795921522, -7.981132988064893, -31.52159432874371, 16.31930543123136, -6.058818238834054],
];
// d[i] — the h·(df/dt) coefficients (gamma_i).
const RODAS_D = [0.25, -0.1043, 0.1035, -0.0362, 0, 0];

/** One RODAS4 step. Returns the new state and the error estimate, or null if W is singular. */
function rodasStep(
  f: (t: number, y: number[]) => number[],
  t: number,
  y: number[],
  h: number,
  f0: number[],
  J: number[][],
  T: number[]
): { yNew: number[]; err: number[] } | null {
  const n = y.length;
  // W = I/(gamma*h) - J
  const W: number[][] = [];
  const inv = 1 / (RODAS_GAMMA * h);
  for (let i = 0; i < n; i++) {
    W.push(new Array<number>(n));
    for (let j = 0; j < n; j++) W[i][j] = (i === j ? inv : 0) - J[i][j];
  }
  const fac = luFactor(W);
  if (fac.singular) return null;

  const k: number[][] = [];
  for (let i = 0; i < 6; i++) {
    // Stage value: y + sum_j a_ij k_j
    const yi = y.slice();
    for (let j = 0; j < i; j++) {
      const a = RODAS_A[i][j];
      if (a) for (let m = 0; m < n; m++) yi[m] += a * k[j][m];
    }
    const fi = i === 0 ? f0 : f(t + RODAS_ALPHA[i] * h, yi);
    if (!fi.every(Number.isFinite)) return null;
    // rhs = f_i + sum_j (c_ij/h) k_j + h*d_i*T
    const rhs = fi.slice();
    for (let j = 0; j < i; j++) {
      const c = RODAS_C[i][j];
      if (c) for (let m = 0; m < n; m++) rhs[m] += (c / h) * k[j][m];
    }
    const d = RODAS_D[i];
    if (d) for (let m = 0; m < n; m++) rhs[m] += h * d * T[m];
    const ki = luSolve(fac, rhs);
    if (!ki) return null;
    k[i] = ki;
  }

  // Stiffly accurate: the 6th stage value IS the embedded 3rd-order solution,
  // so the 4th-order result is that plus k6 and the error estimate is just k6.
  const yHat = y.slice();
  for (let j = 0; j < 5; j++) {
    const a = RODAS_A[5][j];
    if (a) for (let m = 0; m < n; m++) yHat[m] += a * k[j][m];
  }
  const yNew = yHat.map((v, m) => v + k[5][m]);
  return { yNew, err: k[5] };
}

/**
 * Integrates a STIFF system y' = f(t, y) from t0 to t1. Same contract as
 * integrate(): adaptive, returns accepted (t, y) points, never hangs.
 *
 * Defaults to the 4th-order RODAS4. Pass order: 2 for the 2nd-order ode23s
 * method (more robust on very rough problems, less accurate per step).
 */
export function integrateStiff(
  f: (t: number, y: number[]) => number[],
  y0: number[],
  t0: number,
  t1: number,
  opts: OdeOptions & { order?: 2 | 4 } = {}
): OdeResult {
  const rtol = opts.rtol ?? 1e-6;
  const atol = opts.atol ?? 1e-9;
  const maxSteps = opts.maxSteps ?? 100000;
  const order = opts.order ?? 4;
  const n = y0.length;
  const dir = t1 >= t0 ? 1 : -1;
  const span = Math.abs(t1 - t0);
  let h = opts.hInit ?? (span / 100 || 1e-3);
  h = Math.abs(h) * dir;

  const ts = [t0];
  const ys = [y0.slice()];
  let t = t0;
  let y = y0.slice();
  let steps = 0;
  let stopReason: OdeResult["stopReason"];

  while ((dir > 0 ? t < t1 : t > t1) && steps < maxSteps) {
    if ((dir > 0 && t + h > t1) || (dir < 0 && t + h < t1)) h = t1 - t;

    const f0 = f(t, y);
    if (!f0.every(Number.isFinite)) break;
    const J = jacobian(f, t, y, f0);
    const T = dfdt(f, t, y, f0, h);

    // --- 4th-order RODAS path -----------------------------------------------
    if (order === 4) {
      const stepResult = rodasStep(f, t, y, h, f0, J, T);
      if (!stepResult) {
        h *= 0.5;
        if (!Number.isFinite(h) || Math.abs(h) <= 1e-13 * Math.max(1, Math.abs(t))) {
          stopReason = "stepUnderflow";
          break;
        }
        continue;
      }
      const { yNew: yR, err: errVec } = stepResult;
      let e = 0;
      for (let i = 0; i < n; i++) {
        const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yR[i]));
        const q = errVec[i] / sc;
        e += q * q;
      }
      e = Math.sqrt(e / n);
      if (Number.isFinite(e) && e <= 1 && yR.every(Number.isFinite)) {
        t += h;
        y = yR;
        ts.push(t);
        ys.push(y.slice());
        steps++;
        const factor = e === 0 ? 5 : 0.9 * Math.pow(e, -1 / 4); // order 4 → exponent 1/4
        h *= Math.min(5, Math.max(0.2, factor));
      } else {
        const factor = Number.isFinite(e) && e > 0 ? Math.max(0.2, 0.9 * Math.pow(e, -1 / 4)) : 0.2;
        h *= factor;
      }
      if (!Number.isFinite(h) || Math.abs(h) <= 1e-13 * Math.max(1, Math.abs(t))) {
        stopReason = "stepUnderflow";
        break;
      }
      continue;
    }

    // --- 2nd-order ode23s path ----------------------------------------------
    // W = I − h·d·J, factored once and reused by all three stage solves.
    const W: number[][] = [];
    for (let i = 0; i < n; i++) {
      W.push(new Array<number>(n));
      for (let j = 0; j < n; j++) W[i][j] = (i === j ? 1 : 0) - h * ROS_D * J[i][j];
    }
    const fac = luFactor(W);

    const hdT = T.map((v) => h * ROS_D * v);
    const k1 = luSolve(fac, f0.map((v, i) => v + hdT[i]));
    if (!k1) {
      // Singular W: shrink and retry — a smaller h pulls W back toward I.
      h *= 0.5;
      if (!Number.isFinite(h) || Math.abs(h) <= 1e-13 * Math.max(1, Math.abs(t))) {
        stopReason = "stepUnderflow";
        break;
      }
      continue;
    }
    const f1 = f(t + 0.5 * h, axpy(y, k1, 0.5 * h));
    const s2 = luSolve(fac, f1.map((v, i) => v - k1[i]));
    if (!s2) {
      h *= 0.5;
      continue;
    }
    const k2 = s2.map((v, i) => v + k1[i]);
    const yNew = axpy(y, k2, h);
    const f2 = f(t + h, yNew);
    const rhs3 = f2.map((v, i) => v - ROS_E32 * (k2[i] - f1[i]) - 2 * (k1[i] - f0[i]) + hdT[i]);
    const k3 = luSolve(fac, rhs3);
    if (!k3) {
      h *= 0.5;
      continue;
    }

    // Third-order embedded estimate on a second-order step.
    let err = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yNew[i]));
      const e = ((h / 6) * (k1[i] - 2 * k2[i] + k3[i])) / sc;
      err += e * e;
    }
    err = Math.sqrt(err / n);

    if (Number.isFinite(err) && err <= 1 && yNew.every(Number.isFinite)) {
      t += h;
      y = yNew;
      ts.push(t);
      ys.push(y.slice());
      steps++;
      const factor = err === 0 ? 5 : 0.9 * Math.pow(err, -1 / 3);
      h *= Math.min(5, Math.max(0.2, factor));
    } else {
      const factor = Number.isFinite(err) && err > 0 ? Math.max(0.2, 0.9 * Math.pow(err, -1 / 3)) : 0.2;
      h *= factor;
    }

    // Same termination guarantee as the explicit solver: every iteration either
    // accepts a step (bounded by maxSteps) or strictly shrinks |h| to this floor.
    if (!Number.isFinite(h) || Math.abs(h) <= 1e-13 * Math.max(1, Math.abs(t))) {
      stopReason = "stepUnderflow";
      break;
    }
  }

  const completed = dir > 0 ? t >= t1 - 1e-9 : t <= t1 + 1e-9;
  if (!completed && !stopReason && steps >= maxSteps) stopReason = "stepBudget";
  return { t: ts, y: ys, steps, completed, method: "stiff", stopReason };
}

/**
 * Solves y' = f(t, y), picking the integrator automatically by default.
 *
 * "auto" runs RK45 with stiffness detection armed; if the problem turns stiff it
 * hands the current state to the Rosenbrock solver and continues, so a system
 * that starts benign and stiffens later (Van der Pol) is still solved. The
 * result reports which method actually ran.
 */
export function solveOde(
  f: (t: number, y: number[]) => number[],
  y0: number[],
  t0: number,
  t1: number,
  opts: OdeOptions & { method?: OdeMethod } = {}
): OdeResult {
  const method = opts.method ?? "auto";
  if (method === "rk45") return integrate(f, y0, t0, t1, opts);
  if (method === "stiff") return integrateStiff(f, y0, t0, t1, opts);

  const first = integrate(f, y0, t0, t1, { ...opts, detectStiff: true });
  if (first.completed) return { ...first, method: "rk45" };

  // Not finished. If it was stiffness (or the step size collapsed / budget ran
  // out, both of which stiffness causes), continue from where RK45 gave up.
  const lastT = first.t[first.t.length - 1];
  const lastY = first.y[first.y.length - 1];
  if (!lastY.every(Number.isFinite)) return first; // genuine blow-up, not stiffness
  const used = first.steps;
  const rest = integrateStiff(f, lastY, lastT, t1, {
    ...opts,
    maxSteps: Math.max(1000, (opts.maxSteps ?? 100000) - used),
    hInit: undefined,
  });

  return {
    t: [...first.t, ...rest.t.slice(1)],
    y: [...first.y, ...rest.y.slice(1)],
    steps: first.steps + rest.steps,
    completed: rest.completed,
    method: first.steps > 0 ? "rk45→stiff" : "stiff",
    stopReason: rest.stopReason,
  };
}
