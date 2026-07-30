// Chip tests. Expected values are derived independently — from the closed form,
// from a hand-worked case, or from a physical invariant — never from what the
// implementation happens to return.

import {
  switchingPower,
  junctionTemperature,
  interconnectDelay,
  timingCheck,
} from "../chips";

describe("switching power", () => {
  test("the textbook case: 1 nF, 1 V, 1 GHz, alpha 1", () => {
    const r = switchingPower(1e-9, 1, 1e9, 1)!;
    // E = C V^2 = 1e-9 J per transition; at 1e9 transitions/s that is 1 W.
    expect(r.energyPerTransitionJ).toBeCloseTo(1e-9, 18);
    expect(r.dynamicW).toBeCloseTo(1, 12);
    expect(r.staticW).toBe(0);
  });

  test("energy per transition is C*V^2, NOT half of it", () => {
    const r = switchingPower(2e-12, 1.2, 1e9, 0.1)!;
    expect(r.energyPerTransitionJ).toBeCloseTo(2e-12 * 1.44, 20);
    // Guard the factor of two explicitly: half would be the STORED energy.
    expect(r.energyPerTransitionJ).not.toBeCloseTo(0.5 * 2e-12 * 1.44, 20);
    expect(r.notes.join(" ")).toMatch(/not ½C·V²|not ½C/);
  });

  test("power is quadratic in voltage and linear in frequency and activity", () => {
    const base = switchingPower(1e-12, 1.0, 1e9, 0.2)!.dynamicW;
    expect(switchingPower(1e-12, 2.0, 1e9, 0.2)!.dynamicW).toBeCloseTo(4 * base, 15);
    expect(switchingPower(1e-12, 1.0, 2e9, 0.2)!.dynamicW).toBeCloseTo(2 * base, 15);
    expect(switchingPower(1e-12, 1.0, 1e9, 0.4)!.dynamicW).toBeCloseTo(2 * base, 15);
  });

  test("the 20% voltage drop claim in the note is arithmetically true", () => {
    const full = switchingPower(1e-12, 1.0, 1e9, 0.2)!.dynamicW;
    const reduced = switchingPower(1e-12, 0.8, 1e9, 0.2)!.dynamicW;
    expect(1 - reduced / full).toBeCloseTo(0.36, 12);
  });

  test("leakage adds V*I and is reported as a fraction", () => {
    const r = switchingPower(1e-12, 1.0, 1e9, 0.1, 5e-3)!;
    expect(r.staticW).toBeCloseTo(5e-3, 15);
    expect(r.totalW).toBeCloseTo(r.dynamicW + r.staticW, 15);
    expect(r.leakageFraction).toBeCloseTo(r.staticW / r.totalW, 15);
  });

  test("zero leakage says leakage was NOT modelled rather than implying it is zero", () => {
    expect(switchingPower(1e-12, 1, 1e9, 0.1)!.notes.join(" ")).toMatch(/not predicted here/);
  });

  test("a zero-frequency part still has an energy per transition", () => {
    const r = switchingPower(1e-12, 1, 0, 0.5)!;
    expect(r.dynamicW).toBe(0);
    expect(r.energyPerCycleJ).toBeCloseTo(0.5 * 1e-12, 20);
  });

  test("non-physical inputs are refused", () => {
    expect(switchingPower(0, 1, 1e9)).toBeNull();
    expect(switchingPower(1e-12, 0, 1e9)).toBeNull();
    expect(switchingPower(1e-12, 1, -1)).toBeNull();
    expect(switchingPower(1e-12, 1, 1e9, -0.1)).toBeNull();
    expect(switchingPower(1e-12, 1, 1e9, 0.1, -1)).toBeNull();
    expect(switchingPower(NaN, 1, 1e9)).toBeNull();
  });
});

describe("junction temperature", () => {
  test("a hand-worked series path", () => {
    // 10 W through 0.5 + 0.2 + 1.3 = 2.0 K/W from 25 °C: rise 20 °C, Tj = 45 °C.
    const r = junctionTemperature(10, 25, 0.5, 0.2, 1.3)!;
    expect(r.totalResistance).toBeCloseTo(2.0, 12);
    expect(r.junctionC).toBeCloseTo(45, 12);
    // Intermediate nodes: sink at 25 + 10*1.3 = 38, case at 38 + 10*0.2 = 40.
    expect(r.sinkC).toBeCloseTo(38, 12);
    expect(r.caseC).toBeCloseTo(40, 12);
  });

  test("temperatures increase monotonically from ambient to junction", () => {
    const r = junctionTemperature(7, 30, 0.4, 0.3, 2.0)!;
    expect(r.sinkC).toBeGreaterThan(30);
    expect(r.caseC).toBeGreaterThan(r.sinkC);
    expect(r.junctionC).toBeGreaterThan(r.caseC);
  });

  test("the power limit is the inverse of the same path", () => {
    const r = junctionTemperature(10, 25, 0.5, 0.2, 1.3, 125)!;
    // (125 - 25)/2.0 = 50 W.
    expect(r.maxPowerW!).toBeCloseTo(50, 12);
    // Feeding that power back must land exactly on the limit.
    expect(junctionTemperature(r.maxPowerW!, 25, 0.5, 0.2, 1.3)!.junctionC).toBeCloseTo(125, 9);
    expect(r.withinLimit).toBe(true);
    expect(r.marginC!).toBeCloseTo(80, 12);
  });

  test("exceeding the limit is stated, with how far over", () => {
    const r = junctionTemperature(60, 25, 0.5, 0.2, 1.3, 125)!;
    expect(r.junctionC).toBeCloseTo(145, 12);
    expect(r.withinLimit).toBe(false);
    expect(r.marginC!).toBeCloseTo(-20, 12);
    expect(r.notes.join(" ")).toMatch(/OVER THE LIMIT by 20/);
  });

  test("the parallel-path caveat is always present", () => {
    expect(junctionTemperature(5, 25, 1, 1, 1)!.notes.join(" ")).toMatch(/PARALLEL path/);
  });

  test("zero power leaves the junction at ambient", () => {
    const r = junctionTemperature(0, 42, 1, 1, 1)!;
    expect(r.junctionC).toBeCloseTo(42, 12);
  });

  test("negative power or resistance is refused", () => {
    expect(junctionTemperature(-1, 25, 1, 1, 1)).toBeNull();
    expect(junctionTemperature(1, 25, -1, 1, 1)).toBeNull();
    expect(junctionTemperature(1, 25, 1, 1, 1, NaN)).toBeNull();
  });
});

describe("interconnect delay", () => {
  test("Elmore and the 50% delay are different numbers and both are given", () => {
    const R = 100;
    const C = 1e-12;
    const r = interconnectDelay(0, R, C, 0)!;
    expect(r.wireElmoreS).toBeCloseTo(0.5 * R * C, 20);
    expect(r.wireFiftyS).toBeCloseTo(0.38 * R * C, 20);
    // Elmore is the larger — it is an upper bound.
    expect(r.wireElmoreS).toBeGreaterThan(r.wireFiftyS);
    expect(r.notes.join(" ")).toMatch(/upper BOUND/);
  });

  test("a pure lumped RC uses ln2, checked against the closed form", () => {
    // No wire: t50 = ln2 * Rd * Cl exactly.
    const r = interconnectDelay(1000, 0, 0, 1e-12)!;
    expect(r.totalFiftyS).toBeCloseTo(Math.LN2 * 1000 * 1e-12, 20);
    expect(Math.LN2).toBeCloseTo(0.6931, 4);
  });

  test("the composite is the sum of its three named terms", () => {
    const Rd = 200;
    const Rw = 50;
    const Cw = 2e-13;
    const Cl = 5e-13;
    const r = interconnectDelay(Rd, Rw, Cw, Cl)!;
    const expected = Math.LN2 * Rd * (Cw + Cl) + 0.38 * Rw * Cw + Math.LN2 * Rw * Cl;
    expect(r.totalFiftyS).toBeCloseTo(expected, 20);
  });

  test("wire delay grows with the SQUARE of length", () => {
    // Doubling length doubles both R and C, so the RC term quadruples.
    const a = interconnectDelay(0, 100, 1e-12, 0)!.wireFiftyS;
    const b = interconnectDelay(0, 200, 2e-12, 0)!.wireFiftyS;
    expect(b / a).toBeCloseTo(4, 12);
  });

  test("everything zero is zero, not a division", () => {
    const r = interconnectDelay(0, 0, 0, 0)!;
    expect(r.totalFiftyS).toBe(0);
    expect(r.wireElmoreS).toBe(0);
  });

  test("negative resistance or capacitance is refused", () => {
    expect(interconnectDelay(-1, 1, 1e-12, 1e-12)).toBeNull();
    expect(interconnectDelay(1, 1, -1e-12, 1e-12)).toBeNull();
    expect(interconnectDelay(1, 1, 1e-12, NaN)).toBeNull();
  });
});

describe("timing closure", () => {
  // A 1 ns period, 100 ps clock-to-Q, 700 ps max logic, 50 ps min logic,
  // 80 ps setup, 40 ps hold.
  const P = 1e-9;
  const TCQ = 100e-12;
  const TMAX = 700e-12;
  const TMIN = 50e-12;
  const TSU = 80e-12;
  const TH = 40e-12;

  test("setup slack is the period minus the path, worked by hand", () => {
    const r = timingCheck(P, TCQ, TMAX, TMIN, TSU, TH, 0)!;
    // 1000 - (100 + 700 + 80) = 120 ps.
    expect(r.setupSlackS).toBeCloseTo(120e-12, 18);
    expect(r.setupOk).toBe(true);
    expect(r.minPeriodS).toBeCloseTo(880e-12, 18);
    expect(r.fMaxHz!).toBeCloseTo(1 / 880e-12, 0);
  });

  test("hold slack is independent of the clock period", () => {
    const fast = timingCheck(P, TCQ, TMAX, TMIN, TSU, TH, 0)!;
    const slow = timingCheck(P * 100, TCQ, TMAX, TMIN, TSU, TH, 0)!;
    expect(slow.holdSlackS).toBeCloseTo(fast.holdSlackS, 20);
    // 100 + 50 - 40 = 110 ps.
    expect(fast.holdSlackS).toBeCloseTo(110e-12, 18);
  });

  test("SKEW HAS OPPOSITE SIGNS: it helps setup and hurts hold", () => {
    const none = timingCheck(P, TCQ, TMAX, TMIN, TSU, TH, 0)!;
    const skewed = timingCheck(P, TCQ, TMAX, TMIN, TSU, TH, 50e-12)!;
    expect(skewed.setupSlackS).toBeCloseTo(none.setupSlackS + 50e-12, 18);
    expect(skewed.holdSlackS).toBeCloseTo(none.holdSlackS - 50e-12, 18);
    // The sign error this guards: hold slack must NOT improve with positive skew.
    expect(skewed.holdSlackS).toBeLessThan(none.holdSlackS);
  });

  test("enough positive skew breaks hold while setup still passes", () => {
    const r = timingCheck(P, TCQ, TMAX, TMIN, TSU, TH, 200e-12)!;
    expect(r.setupOk).toBe(true);
    expect(r.holdOk).toBe(false);
    expect(r.notes.join(" ")).toMatch(/slowing the clock does NOT fix it/);
  });

  test("a setup failure names the period it actually needs", () => {
    const r = timingCheck(500e-12, TCQ, TMAX, TMIN, TSU, TH, 0)!;
    expect(r.setupOk).toBe(false);
    expect(r.minPeriodS).toBeCloseTo(880e-12, 18);
    expect(r.notes.join(" ")).toMatch(/SETUP IS VIOLATED/);
  });

  test("fMax is exactly the inverse of the required period", () => {
    const r = timingCheck(P, TCQ, TMAX, TMIN, TSU, TH, 25e-12)!;
    expect(r.fMaxHz!).toBeCloseTo(1 / r.minPeriodS, 6);
    // Skew relaxes the required period by exactly the skew.
    expect(r.minPeriodS).toBeCloseTo(880e-12 - 25e-12, 18);
  });

  test("a minimum path longer than the maximum is not a circuit", () => {
    expect(timingCheck(P, TCQ, 100e-12, 700e-12, TSU, TH)).toBeNull();
  });

  test("negative times and a non-positive period are refused", () => {
    expect(timingCheck(0, TCQ, TMAX, TMIN, TSU, TH)).toBeNull();
    expect(timingCheck(-1e-9, TCQ, TMAX, TMIN, TSU, TH)).toBeNull();
    expect(timingCheck(P, -1, TMAX, TMIN, TSU, TH)).toBeNull();
    expect(timingCheck(P, TCQ, TMAX, TMIN, TSU, NaN)).toBeNull();
  });

  test("the corner caveat is always present", () => {
    expect(timingCheck(P, TCQ, TMAX, TMIN, TSU, TH)!.notes.join(" ")).toMatch(/FAST corner for hold/);
  });
});
