// Aviation tests. Expected values come from the published standard-atmosphere
// table, from closed forms, or from physical invariants — not from what the
// implementation returns.

import {
  atmosphere,
  pressureAltitude,
  airspeeds,
  dragPolar,
  levelTurn,
  climbGlide,
  LAYERS,
  P0,
  T0,
  R_AIR,
  GAMMA,
  G0,
} from "../aero";

describe("standard atmosphere", () => {
  test("sea level reproduces the defining constants", () => {
    const a = atmosphere(0)!;
    expect(a.temperatureK).toBeCloseTo(288.15, 10);
    expect(a.pressurePa).toBeCloseTo(101325, 6);
    expect(a.densityKgM3).toBeCloseTo(1.225, 3);
    expect(a.soundSpeedMs).toBeCloseTo(340.294, 2);
    expect(a.sigma).toBeCloseTo(1, 12);
  });

  test("the tropopause matches the published table", () => {
    // 11 km geopotential: 216.65 K and 22632 Pa are definitional.
    const a = atmosphere(11000 * (1 + 11000 / 6356766))!; // geometric that maps to 11 km geopotential
    expect(a.geopotentialM).toBeCloseTo(11000, 0);
    expect(a.temperatureK).toBeCloseTo(216.65, 2);
    expect(a.pressurePa).toBeCloseTo(22632, 0);
  });

  test("layer base pressures are continuous — they are generated, not typed", () => {
    // Each layer's stored base pressure must equal what the previous layer's own
    // formula produces at that height. A typo in a table cannot survive this.
    for (let i = 1; i < LAYERS.length; i++) {
      const prev = LAYERS[i - 1];
      const dh = LAYERS[i].h - prev.h;
      const expected =
        prev.lapse === 0
          ? prev.p * Math.exp((-(G0 * 28.9644) / 8314.32) * dh / prev.t)
          : prev.p * Math.pow(prev.t / (prev.t + prev.lapse * dh), ((G0 * 28.9644) / 8314.32) / prev.lapse);
      expect(LAYERS[i].p).toBeCloseTo(expected, 10);
    }
  });

  test("temperature is continuous across every layer boundary", () => {
    for (const L of LAYERS.slice(1, -1)) {
      const below = atmosphere(L.h - 1)!;
      const above = atmosphere(L.h + 1)!;
      expect(Math.abs(below.temperatureK - above.temperatureK)).toBeLessThan(0.02);
      expect(Math.abs(below.pressurePa / above.pressurePa - 1)).toBeLessThan(1e-3);
    }
  });

  test("the isothermal layer really is isothermal, and the next one warms", () => {
    // 11-20 km is flat; 20-32 km rises at +1 K/km.
    expect(atmosphere(12000)!.temperatureK).toBeCloseTo(atmosphere(18000)!.temperatureK, 6);
    expect(atmosphere(30000)!.temperatureK).toBeGreaterThan(atmosphere(21000)!.temperatureK);
  });

  test("pressure falls monotonically all the way up", () => {
    let last = Infinity;
    for (let z = 0; z <= 80000; z += 500) {
      const a = atmosphere(z)!;
      expect(a.pressurePa).toBeLessThan(last);
      last = a.pressurePa;
    }
  });

  test("geometric and geopotential altitude differ, and the model uses geopotential", () => {
    const a = atmosphere(30000)!;
    expect(a.geopotentialM).toBeLessThan(30000);
    expect(a.geopotentialM).toBeCloseTo((6356766 * 30000) / (6356766 + 30000), 6);
    expect(a.notes.join(" ")).toMatch(/GEOPOTENTIAL/);
  });

  test("an ISA offset moves temperature and density but NOT pressure", () => {
    const std = atmosphere(5000)!;
    const hot = atmosphere(5000, 15)!;
    expect(hot.pressurePa).toBeCloseTo(std.pressurePa, 9);
    expect(hot.temperatureK).toBeCloseTo(std.temperatureK + 15, 12);
    expect(hot.densityKgM3).toBeLessThan(std.densityKgM3);
  });

  test("above the model's ceiling it refuses rather than extrapolating", () => {
    expect(atmosphere(90000)).toBeNull();
    expect(atmosphere(-6000)).toBeNull();
    expect(atmosphere(NaN)).toBeNull();
  });

  test("pressureAltitude inverts atmosphere at every layer", () => {
    for (const z of [0, 5000, 11000, 15000, 25000, 40000, 60000]) {
      const a = atmosphere(z)!;
      expect(pressureAltitude(a.pressurePa)!).toBeCloseTo(a.geopotentialM, 1);
    }
  });

  test("the ideal-gas relation holds at every altitude", () => {
    for (const z of [0, 8000, 15000, 35000]) {
      const a = atmosphere(z)!;
      expect(a.pressurePa / (R_AIR * a.temperatureK)).toBeCloseTo(a.densityKgM3, 9);
      expect(Math.sqrt(GAMMA * R_AIR * a.temperatureK)).toBeCloseTo(a.soundSpeedMs, 9);
    }
  });
});

describe("airspeeds", () => {
  test("at sea level standard, TAS = EAS = CAS exactly", () => {
    const a = atmosphere(0)!;
    const r = airspeeds(100, a.densityKgM3, a.pressurePa)!;
    expect(r.easMs).toBeCloseTo(100, 6);
    expect(r.casMs).toBeCloseTo(100, 4);
    expect(r.mach).toBeCloseTo(100 / a.soundSpeedMs, 9);
  });

  test("at altitude TAS exceeds EAS, and CAS sits between EAS and TAS", () => {
    const a = atmosphere(10000)!;
    const r = airspeeds(200, a.densityKgM3, a.pressurePa)!;
    expect(r.easMs).toBeLessThan(r.tasMs);
    expect(r.easMs).toBeCloseTo(200 * Math.sqrt(a.densityKgM3 / (P0 / (R_AIR * T0))), 9);
    // Compressibility makes CAS exceed EAS at altitude.
    expect(r.casMs).toBeGreaterThan(r.easMs);
    expect(r.casMs).toBeLessThan(r.tasMs);
  });

  test("CAS is NOT EAS — the difference grows with altitude", () => {
    const low = atmosphere(1000)!;
    const high = atmosphere(12000)!;
    const rl = airspeeds(150, low.densityKgM3, low.pressurePa)!;
    const rh = airspeeds(150, high.densityKgM3, high.pressurePa)!;
    const gapLow = rl.casMs - rl.easMs;
    const gapHigh = rh.casMs - rh.easMs;
    expect(gapHigh).toBeGreaterThan(gapLow);
  });

  test("impact pressure round-trips back to the same CAS", () => {
    const a = atmosphere(8000)!;
    const r = airspeeds(180, a.densityKgM3, a.pressurePa)!;
    const a0 = Math.sqrt(GAMMA * R_AIR * T0);
    const back = a0 * Math.sqrt(5 * (Math.pow(r.impactPa / P0 + 1, 2 / 7) - 1));
    expect(back).toBeCloseTo(r.casMs, 9);
  });

  test("dynamic pressure is the incompressible half-rho-v-squared", () => {
    const a = atmosphere(0)!;
    const r = airspeeds(50, a.densityKgM3, a.pressurePa)!;
    expect(r.dynamicPa).toBeCloseTo(0.5 * a.densityKgM3 * 2500, 9);
    // At low Mach the impact pressure is close to it, but not equal.
    expect(r.impactPa).toBeGreaterThan(r.dynamicPa);
    expect(r.impactPa / r.dynamicPa).toBeLessThan(1.01);
  });

  test("supersonic is flagged as out of range rather than silently wrong", () => {
    const a = atmosphere(11000)!;
    const r = airspeeds(400, a.densityKgM3, a.pressurePa)!;
    expect(r.mach).toBeGreaterThan(1);
    expect(r.notes.join(" ")).toMatch(/SUPERSONIC/);
  });

  test("IAS is never claimed", () => {
    const a = atmosphere(0)!;
    expect(airspeeds(100, a.densityKgM3, a.pressurePa)!.notes.join(" ")).toMatch(/IAS is NOT computed/);
  });

  test("non-physical inputs are refused", () => {
    expect(airspeeds(-1, 1.2, 101325)).toBeNull();
    expect(airspeeds(100, 0, 101325)).toBeNull();
    expect(airspeeds(100, 1.2, 0)).toBeNull();
  });
});

describe("drag polar", () => {
  const W = 50000;
  const S = 30;
  const AR = 9;
  const CD0 = 0.02;
  const e = 0.8;

  test("CL follows from level flight, and CD from the polar", () => {
    const rho = 1.225;
    const V = 80;
    const r = dragPolar(W, V, S, rho, CD0, AR, e)!;
    const q = 0.5 * rho * V * V;
    expect(r.cl).toBeCloseTo(W / (q * S), 12);
    expect(r.k).toBeCloseTo(1 / (Math.PI * AR * e), 12);
    expect(r.cd).toBeCloseTo(CD0 + r.k * r.cl * r.cl, 12);
    expect(r.dragN).toBeCloseTo(q * S * r.cd, 9);
  });

  test("best L/D matches the closed form and occurs where the two drags are equal", () => {
    const r = dragPolar(W, 80, S, 1.225, CD0, AR, e)!;
    expect(r.bestLd).toBeCloseTo(1 / (2 * Math.sqrt(CD0 * r.k)), 12);
    expect(r.clAtBestLd).toBeCloseTo(Math.sqrt(CD0 / r.k), 12);
    // At that CL the induced drag equals the parasite drag.
    const induced = r.k * r.clAtBestLd * r.clAtBestLd;
    expect(induced).toBeCloseTo(CD0, 12);
  });

  test("flying at the best-L/D speed actually achieves the best L/D", () => {
    const rho = 1.225;
    const probe = dragPolar(W, 80, S, rho, CD0, AR, e)!;
    const at = dragPolar(W, probe.speedAtBestLdMs, S, rho, CD0, AR, e)!;
    expect(at.liftToDrag).toBeCloseTo(probe.bestLd, 6);
    expect(at.cl).toBeCloseTo(probe.clAtBestLd, 6);
  });

  test("no other speed beats it", () => {
    const rho = 1.225;
    const best = dragPolar(W, 80, S, rho, CD0, AR, e)!;
    for (const V of [40, 60, 70, 90, 120, 200]) {
      const r = dragPolar(W, V, S, rho, CD0, AR, e)!;
      expect(r.liftToDrag).toBeLessThanOrEqual(best.bestLd + 1e-9);
    }
  });

  test("stall speed follows from CLmax, and flying below it is called out", () => {
    const rho = 1.225;
    const r = dragPolar(W, 80, S, rho, CD0, AR, e, 1.5)!;
    expect(r.stallSpeedMs!).toBeCloseTo(Math.sqrt((2 * W) / (rho * S * 1.5)), 12);
    const slow = dragPolar(W, r.stallSpeedMs! * 0.8, S, rho, CD0, AR, e, 1.5)!;
    expect(slow.cl).toBeGreaterThan(1.5);
    expect(slow.notes.join(" ")).toMatch(/EXCEEDS the stated CLmax/);
  });

  test("a higher aspect ratio gives a better best-L/D", () => {
    const low = dragPolar(W, 80, S, 1.225, CD0, 6, e)!;
    const high = dragPolar(W, 80, S, 1.225, CD0, 14, e)!;
    expect(high.bestLd).toBeGreaterThan(low.bestLd);
  });

  test("non-physical inputs are refused", () => {
    expect(dragPolar(0, 80, S, 1.225, CD0, AR)).toBeNull();
    expect(dragPolar(W, 0, S, 1.225, CD0, AR)).toBeNull();
    expect(dragPolar(W, 80, S, 1.225, 0, AR)).toBeNull();
    expect(dragPolar(W, 80, S, 1.225, CD0, AR, 1.5)).toBeNull(); // Oswald > 1
    expect(dragPolar(W, 80, S, 1.225, CD0, AR, e, 0)).toBeNull();
  });
});

describe("level turn", () => {
  test("60 degrees of bank is exactly 2 g", () => {
    const r = levelTurn(60, 100)!;
    expect(r.loadFactor).toBeCloseTo(2, 12);
    // And the stall speed goes up by sqrt(2), not by 2.
    const s = levelTurn(60, 100, 50)!;
    expect(s.stallInTurnMs!).toBeCloseTo(50 * Math.SQRT2, 12);
    expect(s.stallInTurnMs!).toBeCloseTo(70.71, 2);
  });

  test("radius and rate match the closed forms", () => {
    const V = 100;
    const r = levelTurn(45, V)!;
    expect(r.radiusM).toBeCloseTo((V * V) / (G0 * Math.tan(Math.PI / 4)), 9);
    expect(r.rateRadS).toBeCloseTo((G0 * Math.tan(Math.PI / 4)) / V, 12);
    // Rate times radius is the speed, by definition of a circle.
    expect(r.rateRadS * r.radiusM).toBeCloseTo(V, 9);
    expect(r.periodS).toBeCloseTo((2 * Math.PI) / r.rateRadS, 9);
  });

  test("wings level is an infinite radius, not a division by zero", () => {
    const r = levelTurn(0, 100)!;
    expect(r.loadFactor).toBeCloseTo(1, 12);
    expect(r.radiusM).toBe(Infinity);
    expect(r.rateRadS).toBe(0);
    expect(r.periodS).toBe(Infinity);
  });

  test("90 degrees of bank cannot be held in level flight and is refused", () => {
    expect(levelTurn(90, 100)).toBeNull();
    expect(levelTurn(95, 100)).toBeNull();
    expect(levelTurn(-10, 100)).toBeNull();
  });

  test("a bank that cannot be flown at this speed says so", () => {
    const r = levelTurn(75, 60, 50)!;
    expect(r.stallInTurnMs!).toBeGreaterThan(60);
    expect(r.notes.join(" ")).toMatch(/cannot be held at this speed/);
  });

  test("tighter bank means smaller radius and higher rate", () => {
    const a = levelTurn(30, 100)!;
    const b = levelTurn(60, 100)!;
    expect(b.radiusM).toBeLessThan(a.radiusM);
    expect(b.rateRadS).toBeGreaterThan(a.rateRadS);
  });
});

describe("climb and glide", () => {
  test("excess thrust gives the exact arcsine flight-path angle", () => {
    const r = climbGlide(20000, 10000, 100000, 80)!;
    const gamma = Math.asin(0.1);
    expect(r.angleDeg).toBeCloseTo((gamma * 180) / Math.PI, 12);
    // ROC = V*sin(gamma) and sin(gamma) IS (T-D)/W, so the rate is exactly 8 m/s.
    expect(r.rocMs).toBeCloseTo(80 * Math.sin(gamma), 12);
    expect(r.rocMs).toBeCloseTo(8, 12);
    // Where the shortcut shows up is the ANGLE: treating (T-D)/W as the angle in
    // radians gives 5.7296°, where the exact arcsine is 5.7392° — small here, and
    // not small at all by 20°.
    expect(r.angleDeg).toBeCloseTo(5.7392, 3);
    expect(r.angleDeg).toBeGreaterThan((0.1 * 180) / Math.PI);
  });

  test("thrust equal to drag is level flight", () => {
    const r = climbGlide(10000, 10000, 100000, 80)!;
    expect(r.rocMs).toBeCloseTo(0, 12);
    expect(r.angleDeg).toBeCloseTo(0, 12);
    expect(r.glideRatio).toBeNull();
  });

  test("a power-off glide ratio is L/D, and the range follows from it", () => {
    // Zero thrust, drag = W/L_over_D.
    const W = 100000;
    const LD = 15;
    const D = W / LD;
    const r = climbGlide(0, D, W, 80, 3000)!;
    expect(r.rocMs).toBeLessThan(0);
    // For a shallow glide the ratio is close to L/D.
    expect(r.glideRatio!).toBeCloseTo(Math.abs(1 / Math.tan(Math.asin(-1 / LD))), 9);
    expect(r.glideRatio!).toBeCloseTo(14.97, 1);
    expect(r.glideRangeM!).toBeCloseTo(r.glideRatio! * 3000, 9);
  });

  test("a drag that exceeds the weight has no real flight-path angle and is refused", () => {
    expect(climbGlide(0, 200000, 100000, 80)).toBeNull();
    expect(climbGlide(300000, 0, 100000, 80)).toBeNull();
  });

  test("non-physical inputs are refused", () => {
    expect(climbGlide(0, 1000, 0, 80)).toBeNull();
    expect(climbGlide(0, 1000, 100000, 0)).toBeNull();
    expect(climbGlide(-1, 1000, 100000, 80)).toBeNull();
  });
});
