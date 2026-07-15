// Dense output (requested times) and event detection.
//
// Both features are only worth having if they are exact. The assertions below
// are against closed-form answers — the times a user asks for must carry the
// same accuracy as the solver's own steps, and a located event must sit on the
// true crossing, not near it.

import { integrate, integrateStiff, solveOde } from "../ode";

describe("dense output: values at the times you asked for", () => {
  test("requested times are hit exactly and are accurate", () => {
    const tEval = [0, 1, 2, 3, 4, 5];
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, { tEval, rtol: 1e-10, atol: 1e-12 });
    expect(r.evalT).toEqual(tEval);
    expect(r.evalY).toHaveLength(tEval.length);
    for (let i = 0; i < tEval.length; i++) {
      expect(r.evalY![i][0]).toBeCloseTo(Math.exp(-tEval[i]), 8);
    }
  });

  test("the full step-by-step trajectory is STILL returned (a plot wants every step)", () => {
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, { tEval: [0, 5] });
    expect(r.evalT).toEqual([0, 5]);
    // t/y must not be reduced to just the two requested points.
    expect(r.t.length).toBeGreaterThan(5);
    expect(r.t[0]).toBe(0);
    expect(r.t[r.t.length - 1]).toBeCloseTo(5, 9);
  });

  test("values are computed by landing on the point, not interpolated", () => {
    // Every requested time must appear in the accepted-step list, which is only
    // true if the controller was forced to land there.
    const tEval = [0.3, 1.7, 4.2];
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, { tEval });
    for (const te of tEval) {
      expect(r.t.some((x) => Math.abs(x - te) < 1e-9)).toBe(true);
    }
  });

  test("dense output does not degrade accuracy vs an unconstrained run", () => {
    const free = solveOde((t, y) => [-y[0]], [1], 0, 5, { rtol: 1e-10, atol: 1e-12 });
    const dense = solveOde((t, y) => [-y[0]], [1], 0, 5, {
      tEval: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
      rtol: 1e-10,
      atol: 1e-12,
    });
    const freeEnd = free.y[free.y.length - 1][0];
    const denseEnd = dense.evalY![dense.evalY!.length - 1][0];
    expect(denseEnd).toBeCloseTo(freeEnd, 9);
    expect(denseEnd).toBeCloseTo(Math.exp(-5), 9);
  });

  test("works on the stiff solver too", () => {
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const r = integrateStiff(f, [0], 0, 20, { tEval: [0, 5, 10, 20], rtol: 1e-8 });
    expect(r.evalT).toEqual([0, 5, 10, 20]);
    // y(t) = 3 - 0.998e^-1000t - 2.002e^-t
    for (let i = 0; i < r.evalT!.length; i++) {
      const t = r.evalT![i];
      const exact = 3 - 0.998 * Math.exp(-1000 * t) - 2.002 * Math.exp(-t);
      expect(r.evalY![i][0]).toBeCloseTo(exact, 5);
    }
  });

  test("survives the auto handoff from explicit to stiff", () => {
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const r = solveOde(f, [0], 0, 20, { tEval: [0, 1, 5, 10, 20] });
    expect(r.method).toBe("rk45→stiff");
    expect(r.evalT).toEqual([0, 1, 5, 10, 20]);
    for (let i = 0; i < r.evalT!.length; i++) {
      const t = r.evalT![i];
      const exact = 3 - 0.998 * Math.exp(-1000 * t) - 2.002 * Math.exp(-t);
      expect(r.evalY![i][0]).toBeCloseTo(exact, 4);
    }
  });

  test("out-of-range and unsorted requests are handled sanely", () => {
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, { tEval: [3, 1, 99, -4, 5] });
    // Sorted into integration order; out-of-range dropped.
    expect(r.evalT).toEqual([1, 3, 5]);
  });

  test("backward integration reports times in integration order", () => {
    const r = solveOde((t, y) => [-y[0]], [Math.exp(-5)], 5, 0, { tEval: [5, 3, 1, 0], rtol: 1e-9 });
    expect(r.evalT).toEqual([5, 3, 1, 0]);
    expect(r.evalY![3][0]).toBeCloseTo(1, 5);
  });

  test("no tEval → no evalT/evalY, and the old shape is untouched", () => {
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5);
    expect(r.evalT).toBeUndefined();
    expect(r.evalY).toBeUndefined();
  });

  test("many requested points stay fast", () => {
    const tEval = Array.from({ length: 500 }, (_, i) => i * 0.02);
    const t0 = Date.now();
    const r = solveOde((t, y) => [y[1], -y[0]], [1, 0], 0, 10, { tEval });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.evalT).toHaveLength(500);
    // Spot-check against cos(t).
    expect(r.evalY![250][0]).toBeCloseTo(Math.cos(5), 5);
  });
});

describe("event detection: answering 'when does it...?'", () => {
  test("locates a zero crossing at the analytically known time", () => {
    // Projectile: z = 20t - 4.905t^2 lands at t = 20/4.905 = 4.0775739...
    const f = (t: number, y: number[]) => [y[1], -9.81];
    const r = solveOde(f, [0, 20], 0, 10, {
      events: [{ g: (t, y) => y[0], name: "ground", terminal: true, direction: -1 }],
    });
    expect(r.events).toHaveLength(1);
    expect(r.events![0].t).toBeCloseTo(20 / 4.905, 8);
    expect(r.events![0].y[0]).toBeCloseTo(0, 8);
    expect(r.events![0].direction).toBe(-1);
  });

  test("a terminal event ENDS the solution at the event, not past it", () => {
    // Regression: the integrator only learns of the event after the step that
    // crossed it. RK45 integrates this quadratic exactly in ~4 huge steps, so the
    // overshooting step ran all the way to t1=10 — the run reported completed
    // and the trajectory continued underground. A terminal event must truncate.
    const f = (t: number, y: number[]) => [y[1], -9.81];
    const r = solveOde(f, [0, 20], 0, 10, {
      events: [{ g: (t, y) => y[0], name: "ground", terminal: true, direction: -1 }],
    });
    expect(r.completed).toBe(false);
    expect(r.stopReason).toBe("event");
    // The LAST point is the event itself.
    expect(r.t[r.t.length - 1]).toBeCloseTo(20 / 4.905, 8);
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(0, 8);
    // And nothing in the trajectory is past it (no underground tail).
    for (const x of r.t) expect(x).toBeLessThanOrEqual(20 / 4.905 + 1e-9);
    for (const yy of r.y) expect(yy[0]).toBeGreaterThan(-1e-6);
  });

  test("dense-output points past a terminal event are dropped", () => {
    const f = (t: number, y: number[]) => [y[1], -9.81];
    const r = solveOde(f, [0, 20], 0, 10, {
      tEval: [0, 2, 4, 6, 8],
      events: [{ g: (t, y) => y[0], name: "ground", terminal: true, direction: -1 }],
    });
    // Landing is at ~4.077, so 6 and 8 are after the solution ends.
    expect(r.evalT).toEqual([0, 2, 4]);
    expect(r.evalY).toHaveLength(3);
  });

  test("a non-terminal event records every crossing and keeps going", () => {
    // cos(t) crosses zero at pi/2 and 3pi/2 within [0, 5].
    const r = solveOde((t, y) => [y[1], -y[0]], [1, 0], 0, 5, {
      events: [{ g: (t, y) => y[0], name: "zero" }],
      rtol: 1e-10,
      atol: 1e-12,
    });
    expect(r.completed).toBe(true);
    expect(r.events).toHaveLength(2);
    expect(r.events![0].t).toBeCloseTo(Math.PI / 2, 6);
    expect(r.events![1].t).toBeCloseTo((3 * Math.PI) / 2, 6);
  });

  test("direction filtering: rising only", () => {
    // sin-like: y=cos(t) falls through zero at pi/2, rises at 3pi/2.
    const rising = solveOde((t, y) => [y[1], -y[0]], [1, 0], 0, 5, {
      events: [{ g: (t, y) => y[0], name: "up", direction: 1 }],
      rtol: 1e-10,
    });
    expect(rising.events).toHaveLength(1);
    expect(rising.events![0].t).toBeCloseTo((3 * Math.PI) / 2, 6);
    expect(rising.events![0].direction).toBe(1);
  });

  test("a threshold crossing (not just zero) via g = y - level", () => {
    // y = e^-t reaches 0.5 at t = ln 2.
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, {
      events: [{ g: (t, y) => y[0] - 0.5, name: "half", terminal: true }],
      rtol: 1e-10,
      atol: 1e-12,
    });
    expect(r.events![0].t).toBeCloseTo(Math.LN2, 7);
    expect(r.events![0].y[0]).toBeCloseTo(0.5, 8);
  });

  test("no crossing → no events, and the run completes normally", () => {
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, {
      events: [{ g: (t, y) => y[0] + 10, name: "never", terminal: true }],
    });
    expect(r.completed).toBe(true);
    expect(r.events).toEqual([]);
  });

  test("events work on the stiff path", () => {
    // Stiff: y rises to a steady state of 3; catch it passing 2.5.
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const r = solveOde(f, [0], 0, 20, {
      method: "stiff",
      events: [{ g: (t, y) => y[0] - 2.5, name: "hit2.5", terminal: true }],
      rtol: 1e-8,
    });
    expect(r.events).toHaveLength(1);
    expect(r.events![0].y[0]).toBeCloseTo(2.5, 6);
  });

  test("events survive the auto handoff between solvers", () => {
    const f = (t: number, y: number[]) => [-1000 * y[0] + 3000 - 2000 * Math.exp(-t)];
    const r = solveOde(f, [0], 0, 20, {
      events: [{ g: (t, y) => y[0] - 2.9, name: "late", terminal: true }],
      rtol: 1e-8,
    });
    // The 2.9 threshold is reached in the slow tail, after the switch to stiff.
    expect(r.events).toHaveLength(1);
    expect(r.events![0].y[0]).toBeCloseTo(2.9, 5);
  });

  test("several events are tracked independently", () => {
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, {
      events: [
        { g: (t, y) => y[0] - 0.5, name: "half" },
        { g: (t, y) => y[0] - 0.25, name: "quarter" },
      ],
      rtol: 1e-10,
      atol: 1e-12,
    });
    expect(r.events!.map((e) => e.name)).toEqual(["half", "quarter"]);
    expect(r.events![0].t).toBeCloseTo(Math.LN2, 6);
    expect(r.events![1].t).toBeCloseTo(Math.log(4), 6);
  });

  test("dense output and events compose", () => {
    const f = (t: number, y: number[]) => [y[1], -9.81];
    const r = solveOde(f, [0, 20], 0, 10, {
      tEval: [0, 1, 2, 3, 4],
      events: [{ g: (t, y) => y[0], name: "ground", terminal: true, direction: -1 }],
    });
    expect(r.events).toHaveLength(1);
    // Requested points up to the stop are still reported.
    expect(r.evalT).toEqual([0, 1, 2, 3, 4]);
    expect(r.evalY![2][0]).toBeCloseTo(20 * 2 - 4.905 * 4, 6);
  });

  test("an event function that returns NaN does not crash the solve", () => {
    const r = solveOde((t, y) => [-y[0]], [1], 0, 5, {
      events: [{ g: () => NaN, name: "bad", terminal: true }],
    });
    expect(r.completed).toBe(true);
    expect(r.events).toEqual([]);
  });
});
