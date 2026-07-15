// Stiff-ODE solver tests.
//
// Pinned to problems with known analytical solutions and to the standard stiff
// benchmarks (Van der Pol at mu=1000, Robertson kinetics). The point of the
// stiff solver is that it finishes problems RK45 cannot, WITHOUT degrading the
// non-stiff path — both halves are asserted here.

import { integrate, integrateStiff, solveOde } from "../ode";

const last = (r: { y: number[][] }) => r.y[r.y.length - 1];

describe("stiff solver: accuracy on problems with known solutions", () => {
  test("exponential decay matches e^-t", () => {
    const r = integrateStiff((t, y) => [-y[0]], [1], 0, 5, { rtol: 1e-8, atol: 1e-12 });
    expect(r.completed).toBe(true);
    expect(last(r)[0]).toBeCloseTo(Math.exp(-5), 7);
  });

  test("harmonic oscillator returns to its initial state after one period", () => {
    const r = integrateStiff((t, y) => [y[1], -y[0]], [1, 0], 0, 2 * Math.PI, { rtol: 1e-9, atol: 1e-12 });
    expect(last(r)[0]).toBeCloseTo(1, 8);
    // y' is held to a looser bar than y on purpose. Residual error here is a
    // small phase shift d: y(2pi) = cos(2pi+d) ~ 1 - d^2/2, but
    // y'(2pi) = -sin(2pi+d) ~ -d. The derivative exposes phase error linearly
    // while the value only feels it quadratically, so y' is legitimately the
    // less accurate component — not a defect.
    expect(last(r)[1]).toBeCloseTo(0, 5);
  });

  test("logistic growth matches its closed form", () => {
    const r = integrateStiff((t, y) => [y[0] * (1 - y[0])], [0.1], 0, 10, { rtol: 1e-9, atol: 1e-12 });
    expect(last(r)[0]).toBeCloseTo(1 / (1 + 9 * Math.exp(-10)), 7);
  });

  test("error falls monotonically as rtol tightens (the solver actually converges)", () => {
    let prev = Infinity;
    for (const rtol of [1e-4, 1e-6, 1e-8, 1e-10]) {
      const r = integrateStiff((t, y) => [-y[0]], [1], 0, 5, { rtol, atol: rtol * 1e-3 });
      const err = Math.abs(last(r)[0] - Math.exp(-5));
      expect(err).toBeLessThan(prev);
      prev = err;
    }
  });

  test("non-autonomous systems are handled (the df/dt term is not dropped)", () => {
    // y' = -y + t, y(0)=1  ->  y(t) = t - 1 + 2e^-t
    const r = integrateStiff((t, y) => [-y[0] + t], [1], 0, 3, { rtol: 1e-9, atol: 1e-12 });
    expect(last(r)[0]).toBeCloseTo(3 - 1 + 2 * Math.exp(-3), 6);
  });

  test("integrates backward in time", () => {
    const r = integrateStiff((t, y) => [-y[0]], [Math.exp(-5)], 5, 0, { rtol: 1e-9, atol: 1e-12 });
    expect(r.completed).toBe(true);
    expect(last(r)[0]).toBeCloseTo(1, 5);
  });
});

describe("stiff solver: the benchmarks RK45 cannot do", () => {
  // Van der Pol at mu=1000 is THE standard stiff test. RK45 burns any step
  // budget on it; this is the whole reason the implicit solver exists.
  test("Van der Pol mu=1000 completes (RK45 does not)", () => {
    const f = (t: number, y: number[]) => [y[1], 1000 * (1 - y[0] * y[0]) * y[1] - y[0]];
    const stiff = integrateStiff(f, [2, 0], 0, 3000, { maxSteps: 200000 });
    expect(stiff.completed).toBe(true);
    // The limit cycle keeps |y| near 2 — a diverged solution would not.
    expect(Math.abs(last(stiff)[0])).toBeLessThan(3);

    const explicit = integrate(f, [2, 0], 0, 3000, { maxSteps: 20000 });
    expect(explicit.completed).toBe(false); // documents the gap being closed
  });

  test("Robertson kinetics (ROBER) solves and conserves mass", () => {
    // The canonical stiff chemical-kinetics problem: rate constants spanning
    // 0.04 to 3e7. Exactly the case JurisLab users hit in real kinetics.
    const f = (t: number, y: number[]) => [
      -0.04 * y[0] + 1e4 * y[1] * y[2],
      0.04 * y[0] - 1e4 * y[1] * y[2] - 3e7 * y[1] * y[1],
      3e7 * y[1] * y[1],
    ];
    const r = integrateStiff(f, [1, 0, 0], 0, 1000, { rtol: 1e-8, atol: 1e-14, maxSteps: 200000 });
    expect(r.completed).toBe(true);
    // y1+y2+y3 is conserved at 1 for all time — a real invariant of the system.
    const sum = last(r).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 9);
    // Converged reference (self-consistent to 8 digits across rtol 1e-8..1e-10).
    expect(last(r)[0]).toBeCloseTo(0.3368745, 5);
    expect(last(r)[2]).toBeCloseTo(0.6631235, 5);
    // Concentrations stay physical.
    for (const v of last(r)) expect(v).toBeGreaterThanOrEqual(-1e-9);
  });

  test("a stiff linear problem needs far fewer steps than RK45", () => {
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const stiff = integrateStiff(f, [0], 0, 20);
    const explicit = integrate(f, [0], 0, 20);
    expect(stiff.completed).toBe(true);
    expect(stiff.steps).toBeLessThan(explicit.steps / 2);
    expect(last(stiff)[0]).toBeCloseTo(3, 5); // exact steady state
  });
});

describe("auto-selection", () => {
  test("a non-stiff problem stays on RK45 — no false switch, no slowdown", () => {
    const r = solveOde((t, y) => [y[1], -y[0]], [1, 0], 0, 2 * Math.PI);
    expect(r.method).toBe("rk45");
    expect(r.completed).toBe(true);
    expect(last(r)[0]).toBeCloseTo(1, 5);
    expect(r.steps).toBeLessThan(100); // RK45 does this in ~30
  });

  test("a stiff problem is detected and switched, and completes", () => {
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const r = solveOde(f, [0], 0, 20);
    expect(r.completed).toBe(true);
    expect(r.method).toBe("rk45→stiff");
    expect(last(r)[0]).toBeCloseTo(3, 4);
  });

  test("Van der Pol: starts non-stiff, stiffens later, still solved", () => {
    const f = (t: number, y: number[]) => [y[1], 1000 * (1 - y[0] * y[0]) * y[1] - y[0]];
    const r = solveOde(f, [2, 0], 0, 3000, { maxSteps: 200000 });
    expect(r.completed).toBe(true);
    expect(Math.abs(last(r)[0])).toBeLessThan(3);
  });

  test("explicit method choice is honoured", () => {
    const f = (t: number, y: number[]) => [-y[0]];
    expect(solveOde(f, [1], 0, 5, { method: "rk45" }).method).toBe("rk45");
    expect(solveOde(f, [1], 0, 5, { method: "stiff" }).method).toBe("stiff");
  });

  test("the switched result is one continuous, monotone trajectory", () => {
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const r = solveOde(f, [0], 0, 20);
    expect(r.t.length).toBe(r.y.length);
    for (let i = 1; i < r.t.length; i++) expect(r.t[i]).toBeGreaterThan(r.t[i - 1]);
    expect(r.t[0]).toBe(0);
    expect(r.t[r.t.length - 1]).toBeCloseTo(20, 6);
    // No duplicated hand-off point.
    expect(new Set(r.t.map((x) => x.toFixed(12))).size).toBe(r.t.length);
  });
});

describe("stiff solver: robustness", () => {
  test("genuine blow-up terminates honestly rather than hanging", () => {
    // y' = y^2 has a singularity at t=1; no solver should claim to pass it.
    for (const r of [
      integrateStiff((t, y) => [y[0] * y[0]], [1], 0, 2),
      solveOde((t, y) => [y[0] * y[0]], [1], 0, 2),
    ]) {
      expect(r.completed).toBe(false);
      expect(r.t[r.t.length - 1]).toBeLessThan(1.05);
    }
  });

  test("a singular Jacobian does not crash the solver", () => {
    // y' = 0 makes J = 0, so W = I; must still integrate cleanly.
    const r = integrateStiff(() => [0, 0], [1, 2], 0, 10);
    expect(r.completed).toBe(true);
    expect(last(r)).toEqual([1, 2]);
  });

  test("never hangs: every path terminates within the step budget", () => {
    const nasty: ((t: number, y: number[]) => number[])[] = [
      (t, y) => [1e8 * y[0]],
      (t, y) => [Math.exp(y[0])],
      () => [NaN],
      (t, y) => [1 / (y[0] - y[0])],
    ];
    for (const f of nasty) {
      const t0 = Date.now();
      const r = solveOde(f, [1], 0, 10, { maxSteps: 20000 });
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(Number.isFinite(r.steps)).toBe(true);
    }
  });

  test("results never contain NaN in the reported trajectory", () => {
    const r = integrateStiff((t, y) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)], [0], 0, 20);
    for (const row of r.y) for (const v of row) expect(Number.isFinite(v)).toBe(true);
    for (const v of r.t) expect(Number.isFinite(v)).toBe(true);
  });

  test("a zero-length interval returns the initial state", () => {
    const r = integrateStiff((t, y) => [-y[0]], [1], 3, 3);
    expect(r.completed).toBe(true);
    expect(r.y).toEqual([[1]]);
  });
});

describe("backward compatibility", () => {
  test("integrate() keeps its RK45 behaviour and accuracy", () => {
    const r = integrate((t, y) => [-y[0]], [1], 0, 5);
    expect(r.completed).toBe(true);
    // ~7 significant figures at the default rtol of 1e-6, in ~23 steps. (This
    // is the accuracy the stiff solver gives up in exchange for L-stability.)
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(Math.exp(-5), 7);
    expect(r.method).toBe("rk45");
  });

  test("integrate() does not switch or stop early unless asked to detect", () => {
    // Stiffness detection is opt-in: default integrate() must behave as before.
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const plain = integrate(f, [0], 0, 20);
    expect(plain.completed).toBe(true);
    expect(plain.stopReason).toBeUndefined();
  });
});
