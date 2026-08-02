import {
  vacuumShot,
  dragShot,
  aimForRange,
  impactEnergy,
  multiAxisMove,
  sCurveProfile,
  greatCircle,
  windTriangle,
  EARTH_MEAN_RADIUS,
} from "../trajectory";
import { G } from "../fluids";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("vacuum projectile", () => {
  it("range matches the closed form v² sin(2θ)/g", () => {
    const r = ok(vacuumShot(20, 30));
    expect(r.rangeM).toBeCloseTo((400 * Math.sin(60 * (Math.PI / 180))) / G, 9);
  });

  it("45° gives maximum range on flat ground, and equals v²/g", () => {
    const r = ok(vacuumShot(20, 45));
    expect(r.optimumAngleDeg).toBeCloseTo(45, 9);
    expect(r.rangeM).toBeCloseTo(400 / G, 9);
    expect(r.maxRangeM).toBeCloseTo(400 / G, 6);
  });

  it("45° IS NOT OPTIMAL FROM A HEIGHT — the point of the calculator", () => {
    const r = ok(vacuumShot(20, 45, 10));
    expect(r.optimumAngleDeg).toBeLessThan(45);
    expect(r.optimumAngleDeg).toBeGreaterThan(30);
    // And the optimum really does out-range 45 degrees from that height.
    expect(r.maxRangeM).toBeGreaterThan(r.rangeM);
    expect(ok(vacuumShot(20, r.optimumAngleDeg, 10)).rangeM).toBeCloseTo(r.maxRangeM, 6);
  });

  it("complementary angles give the same range on flat ground", () => {
    expect(ok(vacuumShot(20, 30)).rangeM).toBeCloseTo(ok(vacuumShot(20, 60)).rangeM, 9);
  });

  it("impact speed equals launch speed on flat ground (energy conservation)", () => {
    expect(ok(vacuumShot(25, 40)).impactSpeedMs).toBeCloseTo(25, 6);
  });

  it("launching from a height lands faster than it left", () => {
    expect(ok(vacuumShot(20, 30, 15)).impactSpeedMs).toBeGreaterThan(20);
  });

  it("refuses impossible angles and heights", () => {
    expect(vacuumShot(20, 90).ok).toBe(false);
    expect(vacuumShot(20, 45, -1).ok).toBe(false);
    expect(vacuumShot(0, 45).ok).toBe(false);
  });
});

describe("projectile with drag", () => {
  it("DRAG DOMINATES for a small fast projectile", () => {
    // A bullet-like object: the vacuum answer is wrong by more than 10x.
    const r = ok(dragShot(800, 30, 0.01, 5e-5, 0.3));
    expect(r.rangeFraction).toBeLessThan(0.2);
    expect(r.rangeM).toBeLessThan(r.vacuumRangeM! / 5);
  });

  it("a heavy slow projectile is barely affected", () => {
    // A shot put: drag is a small correction here, which is the contrast.
    const r = ok(dragShot(14, 40, 7.26, 0.0113, 0.47));
    expect(r.rangeFraction).toBeGreaterThan(0.9);
  });

  it("more drag means less range, monotonically", () => {
    let prev = Infinity;
    for (const cd of [0.1, 0.3, 0.6, 1.0]) {
      const r = ok(dragShot(300, 35, 0.05, 1e-4, cd));
      expect(r.rangeM).toBeLessThan(prev);
      prev = r.rangeM;
    }
  });

  it("STOPS AT THE GROUND — no underground trajectory", () => {
    const r = ok(dragShot(200, 45, 1, 0.01, 0.4));
    // Every sampled point is at or above ground level.
    for (const p of r.path) expect(p.y).toBeGreaterThan(-1e-6);
    // And the last point is essentially at the ground.
    expect(Math.abs(r.path[r.path.length - 1].y)).toBeLessThan(1);
  });

  it("the path starts at the launch height and rises to the apex", () => {
    const r = ok(dragShot(100, 60, 1, 0.01, 0.3, 5));
    expect(r.path[0].y).toBeCloseTo(5, 6);
    expect(r.apexM).toBeGreaterThan(5);
  });

  it("says Cd is the user's input and varies with Mach", () => {
    expect(ok(dragShot(100, 30, 1, 0.01, 0.3)).notes.join(" ")).toMatch(/YOUR input/);
  });

  it("refuses an absurd drag coefficient", () => {
    expect(dragShot(100, 30, 1, 0.01, 10).ok).toBe(false);
  });
});

describe("aiming for a range", () => {
  it("returns BOTH the low and high solutions", () => {
    const r = ok(aimForRange(20, 30));
    expect(r.lowAngleDeg).toBeLessThan(45);
    expect(r.highAngleDeg).toBeGreaterThan(45);
    // They are complementary.
    expect(r.lowAngleDeg + r.highAngleDeg).toBeCloseTo(90, 9);
  });

  it("both solutions really do reach the target", () => {
    for (const angle of [ok(aimForRange(20, 30)).lowAngleDeg, ok(aimForRange(20, 30)).highAngleDeg]) {
      expect(ok(vacuumShot(20, angle)).rangeM).toBeCloseTo(30, 6);
    }
  });

  it("the lofted shot takes longer", () => {
    const r = ok(aimForRange(20, 30));
    expect(r.highFlightTimeS).toBeGreaterThan(r.lowFlightTimeS);
  });

  it("REFUSES an out-of-reach target rather than clamping to 45°", () => {
    const r = aimForRange(20, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/beyond the maximum range/);
      expect(r.error).toMatch(/Refused rather than clamped/);
    }
  });

  it("the two solutions merge at maximum range", () => {
    const max = (20 * 20) / G;
    const r = ok(aimForRange(20, max * 0.9999));
    expect(Math.abs(r.lowAngleDeg - r.highAngleDeg)).toBeLessThan(3);
  });
});

describe("impact energy", () => {
  // A 20 mm hailstone: 4.5 g, 3.14e-4 m2 frontal area, sphere Cd 0.47.
  const HAIL = [0.0045, 3.14e-4, 0.47] as const;

  it("IMPACT ENERGY SATURATES — a 50x longer fall adds nothing", () => {
    const near = ok(impactEnergy(HAIL[0], 100, HAIL[1], HAIL[2]));
    const far = ok(impactEnergy(HAIL[0], 5000, HAIL[1], HAIL[2]));
    // Fifty times the drop height, and under 2% more energy.
    expect(far.energyJ / near.energyJ).toBeLessThan(1.02);
    // Meanwhile the vacuum answer grew by a factor of fifty.
    expect(far.vacuumSpeedMs / near.vacuumSpeedMs).toBeCloseTo(Math.sqrt(50), 6);
  });

  it("energy never exceeds the terminal-speed ceiling", () => {
    for (const h of [1, 10, 100, 1000, 10000]) {
      const r = ok(impactEnergy(HAIL[0], h, HAIL[1], HAIL[2]));
      expect(r.energyJ).toBeLessThanOrEqual(r.ceilingEnergyJ);
      expect(r.impactSpeedMs).toBeLessThan(r.terminalSpeedMs * (1 + 1e-12));
      expect(r.energyFraction).toBeLessThanOrEqual(1);
    }
  });

  it("CANNOT FALL FASTER THAN TERMINAL SPEED — the fall time floor", () => {
    // The physical floor: even at terminal speed the whole way, the fall takes
    // at least h/vt. A fall time computed by inverting v saturates and breaks
    // this for deep drops.
    for (const h of [1, 10, 100, 1000, 10000, 100000]) {
      const r = ok(impactEnergy(HAIL[0], h, HAIL[1], HAIL[2]));
      expect(r.fallTimeS).toBeGreaterThanOrEqual(h / r.terminalSpeedMs);
    }
  });

  it("a deep fall takes h/vt plus a fixed startup, and grows with height", () => {
    const r = ok(impactEnergy(HAIL[0], 5000, HAIL[1], HAIL[2]));
    expect(r.fallTimeS).toBeCloseTo(5000 / r.terminalSpeedMs + (r.terminalSpeedMs / G) * Math.LN2, 3);
    const deeper = ok(impactEnergy(HAIL[0], 10000, HAIL[1], HAIL[2]));
    expect(deeper.fallTimeS).toBeGreaterThan(r.fallTimeS * 1.9);
  });

  it("a short fall matches the vacuum time sqrt(2h/g)", () => {
    const r = ok(impactEnergy(1, 2, 0.005, 1.0));
    expect(r.fallTimeS).toBeCloseTo(Math.sqrt((2 * 2) / G), 2);
  });

  it("terminal speed follows sqrt(2mg/(rho Cd A))", () => {
    const r = ok(impactEnergy(HAIL[0], 100, HAIL[1], HAIL[2]));
    const rho = 1.225; // ISA sea level
    expect(r.terminalSpeedMs).toBeCloseTo(
      Math.sqrt((2 * HAIL[0] * G) / (rho * HAIL[2] * HAIL[1])),
      2,
    );
  });

  it("a short drop of a dense object is essentially the vacuum answer", () => {
    // A 1 kg wrench dropped 2 m: drag has no time to matter.
    const r = ok(impactEnergy(1, 2, 0.005, 1.0));
    expect(r.impactSpeedMs / r.vacuumSpeedMs).toBeGreaterThan(0.99);
  });

  it("a long drop of the same object is NOT the vacuum answer", () => {
    const r = ok(impactEnergy(1, 500, 0.005, 1.0));
    expect(r.impactSpeedMs / r.vacuumSpeedMs).toBeLessThan(0.6);
  });

  it("momentum is mass times the impact speed", () => {
    const r = ok(impactEnergy(2.5, 30, 0.01, 0.6));
    expect(r.momentumNs).toBeCloseTo(2.5 * r.impactSpeedMs, 9);
    expect(r.energyJ).toBeCloseTo(0.5 * 2.5 * r.impactSpeedMs ** 2, 9);
  });

  it("thinner air at altitude raises terminal speed", () => {
    const sea = ok(impactEnergy(1, 100, 0.01, 0.5, 0));
    const high = ok(impactEnergy(1, 100, 0.01, 0.5, 8000));
    expect(high.terminalSpeedMs).toBeGreaterThan(sea.terminalSpeedMs);
  });

  it("says energy carried is not force felt", () => {
    expect(ok(impactEnergy(1, 10, 0.01, 0.5)).notes.join(" ")).toMatch(/stopping distance/);
  });

  it("refuses an absurd drag coefficient and bad inputs", () => {
    expect(impactEnergy(1, 10, 0.01, 10).ok).toBe(false);
    expect(impactEnergy(0, 10, 0.01, 0.5).ok).toBe(false);
    expect(impactEnergy(1, -1, 0.01, 0.5).ok).toBe(false);
  });
});

describe("multi-axis coordination", () => {
  const GANTRY = [
    { label: "X", distanceM: 1.0, vmax: 1.0, amax: 2 },
    { label: "Y", distanceM: 0.2, vmax: 1.0, amax: 2 },
  ];

  it("the slowest axis sets the move time", () => {
    const r = ok(multiAxisMove(GANTRY));
    expect(r.limitingAxis).toBe("X");
    expect(r.moveTimeS).toBeCloseTo(1.5, 9); // 1/2 + 1/1 for the trapezoid
    expect(r.axes.find((a) => a.limiting)!.label).toBe("X");
  });

  it("THE SCALED LIMITS REALLY DO TAKE THE FULL MOVE TIME", () => {
    // The claim the calculator makes is that every axis now finishes together.
    // Re-plan each axis alone at its scaled limits and check the time matches.
    const r = ok(multiAxisMove(GANTRY));
    for (const a of r.axes) {
      const solo = ok(
        multiAxisMove([
          { label: a.label, distanceM: a.distanceM, vmax: a.scaledVmax, amax: a.scaledAmax },
          { label: "dummy", distanceM: 0, vmax: 1, amax: 1 },
        ]),
      );
      expect(solo.moveTimeS).toBeCloseTo(r.moveTimeS, 6);
    }
  });

  it("slowing the fast axes COSTS NOTHING — the move time is unchanged", () => {
    const r = ok(multiAxisMove(GANTRY));
    const limiting = r.axes.find((a) => a.limiting)!;
    expect(limiting.soloTimeS).toBeCloseTo(r.moveTimeS, 9);
    expect(limiting.utilisation).toBeCloseTo(1, 9);
    // And the fast axis was going to be idle anyway.
    expect(r.earliestFinishS).toBeLessThan(r.moveTimeS);
  });

  it("the fast axis is throttled, not the slow one", () => {
    const y = ok(multiAxisMove(GANTRY)).axes.find((a) => a.label === "Y")!;
    expect(y.scaledVmax).toBeLessThan(1.0);
    expect(y.scaledAmax).toBeLessThan(2);
    expect(y.utilisation).toBeLessThan(1);
  });

  it("equal axes need no throttling at all", () => {
    const r = ok(
      multiAxisMove([
        { label: "A", distanceM: 1, vmax: 1, amax: 2 },
        { label: "B", distanceM: 1, vmax: 1, amax: 2 },
      ]),
    );
    for (const a of r.axes) expect(a.utilisation).toBeCloseTo(1, 9);
    expect(r.earliestFinishS).toBeCloseTo(r.moveTimeS, 9);
  });

  it("explains the dog-leg that synchronising avoids", () => {
    expect(ok(multiAxisMove(GANTRY)).notes.join(" ")).toMatch(/dog-leg/);
  });

  it("refuses fewer than two axes, and an all-zero move", () => {
    expect(multiAxisMove([{ label: "X", distanceM: 1, vmax: 1, amax: 1 }]).ok).toBe(false);
    expect(
      multiAxisMove([
        { label: "X", distanceM: 0, vmax: 1, amax: 1 },
        { label: "Y", distanceM: 0, vmax: 1, amax: 1 },
      ]).ok,
    ).toBe(false);
  });

  it("refuses a non-positive limit", () => {
    expect(
      multiAxisMove([
        { label: "X", distanceM: 1, vmax: 0, amax: 1 },
        { label: "Y", distanceM: 1, vmax: 1, amax: 1 },
      ]).ok,
    ).toBe(false);
  });
});

describe("S-curve motion profile", () => {
  it("IS SLOWER THAN TRAPEZOIDAL — which is the entire point", () => {
    const r = ok(sCurveProfile(1, 0.5, 2, 10));
    expect(r.totalTimeS).toBeGreaterThan(r.trapezoidalTimeS);
  });

  it("approaches the trapezoidal time as jerk becomes very large", () => {
    const soft = ok(sCurveProfile(1, 0.5, 2, 5));
    const stiff = ok(sCurveProfile(1, 0.5, 2, 100000));
    expect(stiff.totalTimeS).toBeLessThan(soft.totalTimeS);
    expect(stiff.totalTimeS).toBeCloseTo(stiff.trapezoidalTimeS, 2);
  });

  it("lower jerk costs more time", () => {
    let prev = 0;
    for (const j of [1000, 100, 10, 2]) {
      const r = ok(sCurveProfile(1, 0.5, 2, j));
      expect(r.totalTimeS).toBeGreaterThan(prev);
      prev = r.totalTimeS;
    }
  });

  it("reports when a move is too short to reach the commanded speed", () => {
    const r = ok(sCurveProfile(0.001, 10, 2, 10));
    expect(r.reachesCruise).toBe(false);
    expect(r.peakSpeedMs).toBeLessThan(10);
  });

  it("explains why the extra time is worth paying", () => {
    expect(ok(sCurveProfile(1, 0.5, 2, 10)).notes.join(" ")).toMatch(/structural mode/);
  });

  it("refuses non-positive limits", () => {
    expect(sCurveProfile(0, 1, 1, 1).ok).toBe(false);
    expect(sCurveProfile(1, 1, 1, 0).ok).toBe(false);
  });
});

describe("great-circle navigation", () => {
  it("London Heathrow to New York JFK is about 3000 nautical miles", () => {
    const r = ok(greatCircle(51.4775, -0.4614, 40.6413, -73.7781));
    expect(r.distanceNmi).toBeGreaterThan(2900);
    expect(r.distanceNmi).toBeLessThan(3100);
  });

  it("THE INITIAL AND FINAL BEARINGS DIFFER — the point of a great circle", () => {
    const r = ok(greatCircle(51.4775, -0.4614, 40.6413, -73.7781));
    expect(Math.abs(r.initialBearingDeg - r.finalBearingDeg)).toBeGreaterThan(30);
  });

  it("a point to itself is zero distance", () => {
    expect(ok(greatCircle(50, 0, 50, 0)).distanceM).toBeCloseTo(0, 6);
  });

  it("pole to pole is half the circumference", () => {
    const r = ok(greatCircle(90, 0, -90, 0));
    expect(r.distanceM).toBeCloseTo(Math.PI * EARTH_MEAN_RADIUS, 0);
  });

  it("due east along the equator has a bearing of 90 degrees", () => {
    const r = ok(greatCircle(0, 0, 0, 10));
    expect(r.initialBearingDeg).toBeCloseTo(90, 6);
  });

  it("is symmetric in distance", () => {
    const a = ok(greatCircle(51.5, -0.1, 40.7, -74));
    const b = ok(greatCircle(40.7, -74, 51.5, -0.1));
    expect(a.distanceM).toBeCloseTo(b.distanceM, 6);
  });

  it("refuses out-of-range coordinates", () => {
    expect(greatCircle(91, 0, 0, 0).ok).toBe(false);
    expect(greatCircle(0, 181, 0, 0).ok).toBe(false);
  });
});

describe("wind triangle", () => {
  it("a pure crosswind demands a correction into it", () => {
    // Track east, wind from the south: steer into it, south of east.
    const r = ok(windTriangle(90, 50, 180, 10));
    expect(r.driftAngleDeg).toBeGreaterThan(0);
    expect(r.headingDeg).toBeGreaterThan(90);
  });

  it("a pure headwind needs no correction but cuts ground speed", () => {
    const r = ok(windTriangle(90, 50, 90, 10));
    expect(r.driftAngleDeg).toBeCloseTo(0, 6);
    expect(r.groundSpeedMs).toBeCloseTo(40, 6);
  });

  it("a pure tailwind adds to ground speed", () => {
    const r = ok(windTriangle(90, 50, 270, 10));
    expect(r.groundSpeedMs).toBeCloseTo(60, 6);
  });

  it("no wind means heading equals track", () => {
    const r = ok(windTriangle(123, 50, 0, 0));
    expect(r.headingDeg).toBeCloseTo(123, 6);
    expect(r.groundSpeedMs).toBeCloseTo(50, 6);
  });

  it("REFUSES when the wind is too strong to crab against", () => {
    const r = windTriangle(90, 10, 180, 50);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cannot be corrected|stronger than/);
  });

  it("refuses when the headwind exceeds the airspeed", () => {
    expect(windTriangle(90, 10, 90, 30).ok).toBe(false);
  });

  it("states the from-direction convention", () => {
    expect(ok(windTriangle(90, 50, 180, 10)).notes.join(" ")).toMatch(/comes FROM/);
  });
});
