// Dedicated tests for optimize.ts (Nelder-Mead).
//
// The oracles are functions whose minimum is known analytically, so nothing
// here depends on the implementation being right in order to say what the
// answer is. Rosenbrock is the one that matters: its minimum sits at the end of
// a curved, nearly-flat valley, and a simplex method that has its contraction
// or shrink step wrong still descends the valley walls quickly and then STALLS
// — reporting a plausible point with a small objective value and
// `converged: true`. A test that only checked "fx got smaller" would pass.

import { nelderMead } from "../optimize";

const sphere = (x: number[]): number => x.reduce((a, v) => a + v * v, 0);
const rosenbrock = (x: number[]): number => {
  let s = 0;
  for (let i = 0; i + 1 < x.length; i++) s += 100 * Math.pow(x[i + 1] - x[i] * x[i], 2) + Math.pow(1 - x[i], 2);
  return s;
};
/** Minimum 0 at (3, 0.5). */
const beale = (x: number[]): number =>
  Math.pow(1.5 - x[0] + x[0] * x[1], 2) +
  Math.pow(2.25 - x[0] + x[0] * x[1] * x[1], 2) +
  Math.pow(2.625 - x[0] + x[0] * x[1] * x[1] * x[1], 2);

describe("known minima are actually found", () => {
  test("sphere in 1-D", () => {
    const r = nelderMead(sphere, [4]);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0])).toBeLessThan(1e-4);
    expect(r.fx).toBeLessThan(1e-8);
  });

  test("sphere in 5-D from a bad start", () => {
    const r = nelderMead(sphere, [10, -8, 6, -4, 2], { maxIter: 5000 });
    for (const v of r.x) expect(Math.abs(v)).toBeLessThan(1e-3);
    expect(r.fx).toBeLessThan(1e-6);
  });

  test("Rosenbrock reaches (1,1), not merely a small objective", () => {
    const r = nelderMead(rosenbrock, [-1.2, 1], { maxIter: 5000, tol: 1e-12 });
    expect(Math.abs(r.x[0] - 1)).toBeLessThan(1e-3);
    expect(Math.abs(r.x[1] - 1)).toBeLessThan(1e-3);
    expect(r.fx).toBeLessThan(1e-6);
  });

  test("Beale reaches (3, 0.5)", () => {
    const r = nelderMead(beale, [1, 1], { maxIter: 5000, tol: 1e-12 });
    expect(Math.abs(r.x[0] - 3)).toBeLessThan(1e-2);
    expect(Math.abs(r.x[1] - 0.5)).toBeLessThan(1e-2);
  });

  test("a minimum away from the origin is found, so the simplex is not anchored there", () => {
    const shifted = (x: number[]): number => Math.pow(x[0] - 137, 2) + Math.pow(x[1] + 42, 2);
    const r = nelderMead(shifted, [0, 0], { maxIter: 5000 });
    expect(Math.abs(r.x[0] - 137)).toBeLessThan(1e-2);
    expect(Math.abs(r.x[1] + 42)).toBeLessThan(1e-2);
  });
});

describe("properties any minimiser must have", () => {
  test("it never returns a point worse than where it started", () => {
    for (const start of [[5, 5], [-3, 7], [0.1, -0.1]]) {
      const r = nelderMead(rosenbrock, start, { maxIter: 2000 });
      expect(r.fx).toBeLessThanOrEqual(rosenbrock(start) + 1e-12);
    }
  });

  test("the reported fx is the objective AT the reported x", () => {
    // Returning a stale best value while the point moved on is a classic
    // bookkeeping slip, and it makes every downstream number inconsistent.
    const r = nelderMead(rosenbrock, [2, -1], { maxIter: 1500 });
    expect(Math.abs(rosenbrock(r.x) - r.fx)).toBeLessThan(1e-12);
  });

  test("starting AT the minimum stays there", () => {
    const r = nelderMead(sphere, [0, 0]);
    expect(r.fx).toBeLessThan(1e-12);
  });

  test("translation invariance: shifting the problem shifts the answer", () => {
    const base = nelderMead(rosenbrock, [-1.2, 1], { maxIter: 5000, tol: 1e-12 });
    const shifted = nelderMead((x) => rosenbrock([x[0] - 10, x[1] - 10]), [8.8, 11], {
      maxIter: 5000,
      tol: 1e-12,
    });
    expect(Math.abs(shifted.x[0] - 10 - base.x[0])).toBeLessThan(1e-2);
    expect(Math.abs(shifted.x[1] - 10 - base.x[1])).toBeLessThan(1e-2);
  });
});

describe("it terminates on hostile objectives rather than running forever", () => {
  test("a flat objective converges immediately and says so", () => {
    const r = nelderMead(() => 7, [1, 2, 3]);
    expect(r.fx).toBe(7);
    expect(r.iterations).toBeLessThan(2000);
  });

  test("an objective returning NaN still terminates", () => {
    const started = Date.now();
    const r = nelderMead(() => NaN, [1, 1], { maxIter: 500 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.iterations).toBeLessThanOrEqual(500);
  });

  test("an objective returning Infinity still terminates", () => {
    const started = Date.now();
    const r = nelderMead((x) => (x[0] > 0 ? Infinity : x[0] * x[0]), [1, 1], { maxIter: 500 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(Number.isFinite(r.iterations)).toBe(true);
  });

  test("the iteration cap is respected on a problem that cannot converge", () => {
    let calls = 0;
    const wobbly = (x: number[]): number => {
      calls++;
      return Math.sin(x[0] * 1e6) + x[0] * x[0];
    };
    const r = nelderMead(wobbly, [1], { maxIter: 200, tol: 1e-18 });
    expect(r.iterations).toBeLessThanOrEqual(200);
    expect(calls).toBeLessThan(100000);
  });

  test("a hard iteration budget is honoured and reported as not converged", () => {
    const r = nelderMead(rosenbrock, [-1.2, 1], { maxIter: 5, tol: 1e-15 });
    expect(r.iterations).toBeLessThanOrEqual(5);
    expect(r.converged).toBe(false);
  });
});
