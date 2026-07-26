// ode.ts was 840 lines with no test file. An integrator is the easiest thing in
// this codebase to test honestly, because textbook systems have closed-form
// answers — so every assertion here compares against an exact solution rather
// than against a previous run's output. A snapshot of a wrong answer is worse
// than no test.

import { integrate, integrateStiff, solveOde } from "../ode";

/** Largest |numeric - exact| over the whole returned trajectory. */
function maxError(
  res: { t: number[]; y: number[][] },
  exact: (t: number) => number[],
): number {
  let worst = 0;
  for (let i = 0; i < res.t.length; i++) {
    const want = exact(res.t[i]);
    for (let k = 0; k < want.length; k++) {
      worst = Math.max(worst, Math.abs(res.y[i][k] - want[k]));
    }
  }
  return worst;
}

describe("ode — RK45 against closed-form solutions", () => {
  test("exponential decay y' = -y matches e^-t", () => {
    const res = integrate((_t, y) => [-y[0]], [1], 0, 5, { rtol: 1e-8, atol: 1e-10 });
    expect(res.completed).toBe(true);
    expect(maxError(res, (t) => [Math.exp(-t)])).toBeLessThan(1e-6);
  });

  test("the harmonic oscillator stays on its circle", () => {
    // y'' = -y as a first-order system. x = cos t, v = -sin t, so x^2 + v^2 = 1
    // for all t: an invariant the integrator must not drift off.
    const res = integrate((_t, y) => [y[1], -y[0]], [1, 0], 0, 20, { rtol: 1e-9, atol: 1e-11 });
    expect(res.completed).toBe(true);
    expect(maxError(res, (t) => [Math.cos(t), -Math.sin(t)])).toBeLessThan(1e-5);
    for (let i = 0; i < res.t.length; i++) {
      const energy = res.y[i][0] ** 2 + res.y[i][1] ** 2;
      expect(Math.abs(energy - 1)).toBeLessThan(1e-5);
    }
  });

  test("a tighter tolerance actually produces a smaller error", () => {
    // Guards the step controller: if rtol were ignored, both runs would agree.
    const f = (t: number, y: number[]) => [y[0] * Math.cos(t)];
    const exact = (t: number) => [Math.exp(Math.sin(t))];
    const loose = integrate(f, [1], 0, 6, { rtol: 1e-4, atol: 1e-6 });
    const tight = integrate(f, [1], 0, 6, { rtol: 1e-10, atol: 1e-12 });
    expect(maxError(tight, exact)).toBeLessThan(maxError(loose, exact));
    expect(tight.steps).toBeGreaterThan(loose.steps);
  });

  test("integrating backwards in time works", () => {
    const res = integrate((_t, y) => [-y[0]], [Math.exp(-3)], 3, 0, { rtol: 1e-9 });
    expect(res.completed).toBe(true);
    expect(res.y[res.y.length - 1][0]).toBeCloseTo(1, 6);
  });

  test("a two-species linear system matches its analytic solution", () => {
    // y1' = -2*y1, y2' = y1 - y2, y(0) = [1, 0]
    // y1 = e^-2t, y2 = e^-t - e^-2t
    const res = integrate((_t, y) => [-2 * y[0], y[0] - y[1]], [1, 0], 0, 4, { rtol: 1e-9 });
    expect(maxError(res, (t) => [Math.exp(-2 * t), Math.exp(-t) - Math.exp(-2 * t)])).toBeLessThan(1e-6);
  });
});

describe("ode — tEval lands on the requested points", () => {
  test("requested times are hit exactly, not interpolated", () => {
    const want = [0.5, 1, 2.5, 4];
    const res = integrate((_t, y) => [-y[0]], [1], 0, 4, { rtol: 1e-9, tEval: want });
    expect(res.evalT).toEqual(want);
    for (let i = 0; i < want.length; i++) {
      expect(res.evalY![i][0]).toBeCloseTo(Math.exp(-want[i]), 6);
    }
  });
});

describe("ode — the stiff path", () => {
  // Van der Pol at mu = 1000 is the standard stiff benchmark. RK45 cannot hold
  // it: the point is that the solver says so rather than silently returning
  // whatever it managed before running out of steps.
  const vanDerPol = (_t: number, y: number[]) => [y[1], 1000 * (1 - y[0] * y[0]) * y[1] - y[0]];

  test("RK45 bails out of a stiff problem and names the reason", () => {
    // Asserted unconditionally, not behind `if (!completed)`. A guarded version
    // would go quiet the day the detector stopped firing, which is exactly the
    // regression worth catching. Measured: bails after 42 steps.
    const res = integrate(vanDerPol, [2, 0], 0, 3000, { detectStiff: true, maxSteps: 20000 });
    expect(res.completed).toBe(false);
    expect(res.stopReason).toBe("stiff");
    expect(res.steps).toBeLessThan(1000);
  });

  test("the implicit solver handles decay RK45 also handles", () => {
    // Cross-check: on a problem both can do, they must agree.
    const res = integrateStiff((_t, y) => [-y[0]], [1], 0, 5, { rtol: 1e-8, atol: 1e-10 });
    expect(res.completed).toBe(true);
    expect(res.y[res.y.length - 1][0]).toBeCloseTo(Math.exp(-5), 5);
  });

  test("solveOde auto-selects and labels which integrator ran", () => {
    const easy = solveOde((_t, y) => [-y[0]], [1], 0, 5, { method: "auto" });
    expect(easy.completed).toBe(true);
    expect(easy.method).toBeDefined();
    expect(["rk45", "stiff", "rk45→stiff"]).toContain(easy.method);
  });

  test("an explicitly requested method is honoured", () => {
    const res = solveOde((_t, y) => [-y[0]], [1], 0, 2, { method: "stiff" });
    expect(res.method).toBe("stiff");
  });
});

describe("ode — events", () => {
  test("a falling crossing is located to solver tolerance", () => {
    // y = cos t crosses zero at pi/2.
    const res = solveOde((_t, y) => [y[1], -y[0]], [1, 0], 0, 3, {
      rtol: 1e-9,
      events: [{ g: (_t, y) => y[0], name: "zero", terminal: true }],
    });
    expect(res.events && res.events.length).toBeGreaterThan(0);
    expect(res.events![0].t).toBeCloseTo(Math.PI / 2, 4);
    expect(res.events![0].name).toBe("zero");
  });

  test("direction filters out the crossing going the other way", () => {
    // Over [0, 7], cos t crosses zero twice: pi/2 falling, 3pi/2 rising. The
    // undirected run is the control — comparing the two counts is what proves
    // the filter did something, where looping over a possibly-empty list would
    // pass whether it worked or not.
    const osc = (_t: number, y: number[]) => [y[1], -y[0]];
    const both = solveOde(osc, [1, 0], 0, 7, {
      rtol: 1e-9,
      events: [{ g: (_t, y) => y[0], name: "any" }],
    });
    const rising = solveOde(osc, [1, 0], 0, 7, {
      rtol: 1e-9,
      events: [{ g: (_t, y) => y[0], direction: 1, name: "up" }],
    });
    expect(both.events!.length).toBe(2);
    expect(rising.events!.length).toBe(1);
    expect(rising.events![0].t).toBeCloseTo((3 * Math.PI) / 2, 3);
  });

  test("a terminal event stops the integration early", () => {
    const res = solveOde((_t, y) => [-y[0]], [1], 0, 100, {
      events: [{ g: (_t, y) => y[0] - 0.5, name: "half", terminal: true }],
    });
    expect(res.t[res.t.length - 1]).toBeLessThan(100);
    expect(res.t[res.t.length - 1]).toBeCloseTo(Math.log(2), 3);
  });
});

describe("ode — refuses to invent an answer", () => {
  test("a step budget that cannot be met is reported, not hidden", () => {
    const res = integrate((_t, y) => [-y[0]], [1], 0, 1000, { maxSteps: 5 });
    expect(res.completed).toBe(false);
    expect(res.stopReason).toBeDefined();
  });

  test("a non-finite derivative never produces NaN in the output", () => {
    // y' = 1/t from t=0 blows up immediately. Whatever comes back, no caller
    // should be handed NaN dressed as a solution.
    const res = integrate((t) => [1 / t], [0], 0, 1, { maxSteps: 200 });
    for (const row of res.y) {
      for (const v of row) expect(Number.isNaN(v)).toBe(false);
    }
  });

  test("t0 === t1 returns the initial state and does not hang", () => {
    const res = integrate((_t, y) => [-y[0]], [1], 2, 2, {});
    expect(res.t[0]).toBe(2);
    expect(res.y[0]).toEqual([1]);
  });
});
