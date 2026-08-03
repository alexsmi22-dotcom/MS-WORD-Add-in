// Flow measurement, pump and system curves, the affinity laws, and drag.
//
// Each engine is pinned to a closed form, and each of the four
// counter-intuitive results the module exists to surface gets its own case:
// the velocity-of-approach factor, the venturi's pressure recovery, throttling
// moving the operating point UP the pump curve, and power going as the cube.

import { flowMeter, pumpSystemCurve, affinityLaws, bodyDrag } from "../fluids2";
import { G } from "../fluids";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("differential-pressure flow meters", () => {
  const base = { kind: "orifice" as const, pipeD: 0.1, throatD: 0.05, deltaP: 20000, rho: 998, cd: 0.61 };

  it("matches the closed form exactly", () => {
    const r = ok(flowMeter(base));
    const beta = 0.5;
    const E = 1 / Math.sqrt(1 - beta ** 4);
    const At = (Math.PI * 0.05 ** 2) / 4;
    expect(r.Q).toBeCloseTo(0.61 * E * At * Math.sqrt((2 * 20000) / 998), 12);
    expect(r.beta).toBeCloseTo(0.5, 12);
    expect(r.approachFactor).toBeCloseTo(E, 12);
  });

  it("THE VELOCITY-OF-APPROACH FACTOR IS NOT NEGLIGIBLE at a large beta", () => {
    // The ideal derivation assumes the fluid arrives at rest; it does not.
    const wide = ok(flowMeter({ ...base, throatD: 0.075 }));
    expect(wide.beta).toBeCloseTo(0.75, 12);
    expect(wide.approachFactor).toBeCloseTo(1.2095, 4);
    // Omitting it would under-read by that factor.
    expect(wide.approachFactor).toBeCloseTo(1 / Math.sqrt(1 - 0.75 ** 4), 12);
  });

  it("mass flow, and both velocities, follow from the volumetric flow", () => {
    const r = ok(flowMeter(base));
    expect(r.massFlow).toBeCloseTo(r.Q * 998, 12);
    expect(r.throatVelocity).toBeCloseTo(r.Q / ((Math.PI * 0.05 ** 2) / 4), 10);
    expect(r.pipeVelocity).toBeCloseTo(r.Q / ((Math.PI * 0.1 ** 2) / 4), 10);
    // Continuity: the throat is four times smaller in area, so four times faster.
    expect(r.throatVelocity / r.pipeVelocity).toBeCloseTo(4, 9);
  });

  it("THE PERMANENT LOSS IS NOT INVENTED — it is reported only if supplied", () => {
    // The first version carried three hand-fitted polynomials in beta under a
    // comment calling them "the standard fractions". They were not: they
    // disagreed with the published relative-loss expression by twenty points
    // at beta 0.5, and above beta 0.98 they crossed so a venturi came out
    // lossier than a nozzle, which a diffuser makes impossible.
    const silent = ok(flowMeter(base));
    expect(silent.lossFraction).toBeNull();
    expect(silent.permanentLoss).toBeNull();
    expect(silent.notes.join(" ")).toMatch(/will not invent it/);
  });

  it("and is applied faithfully when it is", () => {
    const given = ok(flowMeter({ ...base, lossFraction: 0.62 }));
    expect(given.lossFraction).toBeCloseTo(0.62, 12);
    expect(given.permanentLoss).toBeCloseTo(0.62 * base.deltaP, 9);
    expect(given.notes.join(" ")).toMatch(/using the fraction you supplied/);
  });

  it("refuses a loss fraction outside 0 to 1 — a meter cannot lose more than it develops", () => {
    expect(flowMeter({ ...base, lossFraction: 1.2 }).ok).toBe(false);
    expect(flowMeter({ ...base, lossFraction: -0.1 }).ok).toBe(false);
  });

  it("more differential means more flow, monotonically", () => {
    let prev = 0;
    for (const deltaP of [1000, 5000, 20000, 100000]) {
      const r = ok(flowMeter({ ...base, deltaP }));
      expect(r.Q).toBeGreaterThan(prev);
      prev = r.Q;
    }
  });

  it("zero differential is zero flow, not an error", () => {
    const r = ok(flowMeter({ ...base, deltaP: 0 }));
    expect(r.Q).toBe(0);
  });

  it("REFUSES a throat that is not smaller than the pipe", () => {
    expect(flowMeter({ ...base, throatD: 0.1 }).ok).toBe(false);
    expect(flowMeter({ ...base, throatD: 0.15 }).ok).toBe(false);
  });

  it("refuses a discharge coefficient above 1 and a negative differential", () => {
    expect(flowMeter({ ...base, cd: 1.5 }).ok).toBe(false);
    // The message says "above 1", so the gate is at 1 rather than 1.05.
    expect(flowMeter({ ...base, cd: 1.05 }).ok).toBe(false);
    expect(flowMeter({ ...base, deltaP: -100 }).ok).toBe(false);
  });

  it("says Cd is measured, not predicted", () => {
    expect(ok(flowMeter(base)).notes.join(" ")).toMatch(/YOUR measured or certified value/);
  });

  it("warns above the beta standards cap at", () => {
    expect(ok(flowMeter({ ...base, throatD: 0.085 })).notes.join(" ")).toMatch(/0\.75/);
  });
});

describe("pump and system curves", () => {
  const base = { shutOffHead: 50, maxFlow: 0.1, staticHead: 10, resistanceK: 2000, efficiency: 0.7 };

  it("the operating point satisfies BOTH curves", () => {
    const r = ok(pumpSystemCurve(base));
    const a = 50 / (0.1 * 0.1);
    expect(50 - a * r.flow * r.flow).toBeCloseTo(r.head, 9); // pump
    expect(10 + 2000 * r.flow * r.flow).toBeCloseTo(r.head, 9); // system
  });

  it("THROTTLING MOVES THE POINT UP THE PUMP CURVE — flow down, head UP", () => {
    // Closing a valve does not slow the pump. It steepens the system curve.
    const r = ok(pumpSystemCurve({ ...base, throttleFactor: 3 }));
    expect(r.throttled).not.toBeNull();
    expect(r.throttled!.flow).toBeLessThan(r.flow);
    expect(r.throttled!.head).toBeGreaterThan(r.head);
    expect(r.notes.join(" ")).toMatch(/UP THE PUMP CURVE/);
  });

  it("and quantifies the power burned across the valve", () => {
    const r = ok(pumpSystemCurve({ ...base, throttleFactor: 3 }));
    expect(r.throttled!.wastedW).not.toBeNull();
    expect(r.throttled!.wastedW as number).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/variable-speed drive/);
  });

  it("hydraulic power is rho·g·Q·H, and shaft power divides by efficiency", () => {
    const r = ok(pumpSystemCurve(base));
    expect(r.hydraulicPower).toBeCloseTo(998 * G * r.flow * r.head, 6);
    expect(r.shaftPower).toBeCloseTo(r.hydraulicPower / 0.7, 6);
  });

  it("a stiffer system gives less flow at more head", () => {
    let prevQ = Infinity;
    let prevH = 0;
    for (const K of [500, 2000, 8000, 30000]) {
      const r = ok(pumpSystemCurve({ ...base, resistanceK: K }));
      expect(r.flow).toBeLessThan(prevQ);
      expect(r.head).toBeGreaterThan(prevH);
      prevQ = r.flow;
      prevH = r.head;
    }
  });

  it("REFUSES when the static lift exceeds the shut-off head — no valve setting helps", () => {
    const r = pumpSystemCurve({ ...base, staticHead: 60 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cannot lift the liquid at all/);
  });

  it("with no static lift the point is pure friction", () => {
    const r = ok(pumpSystemCurve({ ...base, staticHead: 0 }));
    expect(r.head).toBeCloseTo(2000 * r.flow * r.flow, 9);
  });

  it("says a pump has no flow rate of its own", () => {
    expect(ok(pumpSystemCurve(base)).notes.join(" ")).toMatch(/NO FLOW RATE OF ITS OWN/);
  });

  it("returns curves that actually cross where it says", () => {
    const r = ok(pumpSystemCurve(base));
    expect(r.pumpCurve.length).toBeGreaterThan(10);
    expect(r.systemCurve.length).toBe(r.pumpCurve.length);
    // The system curve starts below the pump curve and ends above it.
    expect(r.systemCurve[0].h).toBeLessThan(r.pumpCurve[0].h);
    const last = r.pumpCurve.length - 1;
    expect(r.systemCurve[last].h).toBeGreaterThan(r.pumpCurve[last].h);
  });
});

describe("affinity laws", () => {
  const base = { flow1: 100, head1: 50, power1: 20000, speed1: 1450, speed2: 1160 };

  it("flow goes as N, head as N squared, POWER AS N CUBED", () => {
    const r = ok(affinityLaws(base));
    const n = 1160 / 1450;
    expect(r.flow2).toBeCloseTo(100 * n, 9);
    expect(r.head2).toBeCloseTo(50 * n * n, 9);
    expect(r.power2).toBeCloseTo(20000 * n ** 3, 6);
    expect(r.powerFraction).toBeCloseTo(0.8 ** 3, 12);
  });

  it("A 20% SPEED CUT LEAVES 51% OF THE POWER — the case for a VSD", () => {
    const r = ok(affinityLaws(base));
    expect(r.powerFraction).toBeCloseTo(0.512, 10);
    expect(r.notes.join(" ")).toMatch(/ENTIRE CASE FOR A VARIABLE-SPEED DRIVE/);
  });

  it("halving the speed leaves an eighth of the power", () => {
    const r = ok(affinityLaws({ ...base, speed2: 725 }));
    expect(r.powerFraction).toBeCloseTo(0.125, 10);
  });

  it("impeller diameter scales flow by D cubed and power by D to the fifth", () => {
    const r = ok(affinityLaws({ ...base, speed2: 1450, diameter1: 200, diameter2: 180 }));
    const d = 0.9;
    expect(r.flow2).toBeCloseTo(100 * d ** 3, 9);
    expect(r.head2).toBeCloseTo(50 * d ** 2, 9);
    expect(r.power2).toBeCloseTo(20000 * d ** 5, 6);
    expect(r.notes.join(" ")).toMatch(/trimming an impeller/i);
  });

  it("no change is no change", () => {
    const r = ok(affinityLaws({ ...base, speed2: 1450 }));
    expect(r.flow2).toBeCloseTo(100, 12);
    expect(r.head2).toBeCloseTo(50, 12);
    expect(r.power2).toBeCloseTo(20000, 9);
  });

  it("states the constant-efficiency assumption", () => {
    expect(ok(affinityLaws(base)).notes.join(" ")).toMatch(/constant efficiency/);
  });

  it("refuses a non-positive speed or diameter", () => {
    expect(affinityLaws({ ...base, speed2: 0 }).ok).toBe(false);
    expect(affinityLaws({ ...base, diameter1: 0, diameter2: 1 }).ok).toBe(false);
  });
});

describe("drag on a body", () => {
  const car = { velocity: 30, rho: 1.225, area: 2.2, cd: 0.3 };

  it("drag is the dynamic pressure times Cd times area", () => {
    const r = ok(bodyDrag(car));
    expect(r.dynamicPressure).toBeCloseTo(0.5 * 1.225 * 900, 12);
    expect(r.drag).toBeCloseTo(0.5 * 1.225 * 900 * 0.3 * 2.2, 12);
    expect(r.power).toBeCloseTo(r.drag * 30, 12);
  });

  it("POWER GOES AS THE CUBE — doubling the speed takes EIGHT times the power", () => {
    const slow = ok(bodyDrag(car));
    const fast = ok(bodyDrag({ ...car, velocity: 60 }));
    expect(fast.power / slow.power).toBeCloseTo(8, 9);
    expect(fast.drag / slow.drag).toBeCloseTo(4, 9);
    expect(slow.notes.join(" ")).toMatch(/CUBE OF SPEED/);
  });

  it("terminal velocity balances drag against weight", () => {
    const r = ok(bodyDrag({ ...car, mass: 1500 }));
    expect(r.terminalVelocity).not.toBeNull();
    const v = r.terminalVelocity as number;
    // At terminal velocity the drag equals the weight.
    expect(0.5 * 1.225 * v * v * 0.3 * 2.2).toBeCloseTo(1500 * G, 6);
  });

  it("Reynolds number is rho·V·L/mu when both are given", () => {
    const r = ok(bodyDrag({ ...car, mu: 1.8e-5, length: 4.5 }));
    expect(r.reynolds).toBeCloseTo((1.225 * 30 * 4.5) / 1.8e-5, 6);
    expect(r.notes.join(" ")).toMatch(/drag crisis/);
  });

  it("omits what it was not given, rather than inventing it", () => {
    const r = ok(bodyDrag(car));
    expect(r.terminalVelocity).toBeNull();
    expect(r.reynolds).toBeNull();
  });

  it("zero velocity is zero drag, not an error", () => {
    const r = ok(bodyDrag({ ...car, velocity: 0 }));
    expect(r.drag).toBe(0);
    expect(r.power).toBe(0);
  });

  it("a negative velocity gives the same magnitude of drag and positive power", () => {
    const r = ok(bodyDrag({ ...car, velocity: -30 }));
    expect(r.drag).toBeCloseTo(ok(bodyDrag(car)).drag, 9);
    expect(r.power).toBeGreaterThan(0);
  });

  it("refuses an absurd drag coefficient and a non-positive mass", () => {
    expect(bodyDrag({ ...car, cd: 10 }).ok).toBe(false);
    expect(bodyDrag({ ...car, mass: 0 }).ok).toBe(false);
  });

  it("says Cd is a measured input", () => {
    expect(ok(bodyDrag(car)).notes.join(" ")).toMatch(/YOUR measured input/);
  });
});
