// Ordinary differential equations — adaptive Dormand–Prince RK45 integrator.
//
// Solves systems y' = f(t, y) with automatic step-size control (embedded 4th/5th
// order pair for the local error estimate). Handles a single ODE or a coupled
// system (higher-order ODEs are entered by hand-reducing to first order, e.g.
// y'' = -y → y1' = y2, y2' = -y1). Pure; f is any (t, y[]) => y'[].

export interface OdeResult {
  /** Time points (includes t0 and t1). */
  t: number[];
  /** State at each time point; y[i] is the vector at t[i]. */
  y: number[][];
  /** Number of accepted steps. */
  steps: number;
  /** True if the integration reached t1 within the step budget. */
  completed: boolean;
}

export interface OdeOptions {
  rtol?: number;
  atol?: number;
  hInit?: number;
  maxSteps?: number;
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
  const dir = t1 >= t0 ? 1 : -1;
  const span = Math.abs(t1 - t0);
  let h = opts.hInit ?? (span / 100 || 1e-3);
  h = Math.abs(h) * dir;

  const ts = [t0];
  const ys = [y0.slice()];
  let t = t0;
  let y = y0.slice();
  let steps = 0;

  while ((dir > 0 ? t < t1 : t > t1) && steps < maxSteps) {
    // don't overshoot the endpoint
    if ((dir > 0 && t + h > t1) || (dir < 0 && t + h < t1)) h = t1 - t;

    const k: number[][] = [];
    k[0] = f(t, y);
    for (let s = 1; s < 7; s++) {
      let yi = y.slice();
      for (let j = 0; j < s; j++) yi = axpy(yi, k[j], h * A[s][j]);
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
    if (!Number.isFinite(h) || Math.abs(h) <= 1e-13 * Math.max(1, Math.abs(t))) break;
  }

  return { t: ts, y: ys, steps, completed: dir > 0 ? t >= t1 - 1e-9 : t <= t1 + 1e-9 };
}
