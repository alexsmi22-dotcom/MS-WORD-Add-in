// The separate adversarial pass over the trajectory suite, run by an
// independent reviewer against the uncommitted diff rather than by the author.
//
// Every case below REPRODUCED A REAL DEFECT before it was fixed. They are kept
// as tests because the author's own suite passed all 59 of its checks while
// every one of these was broken — the recurring lesson that a self-written
// adversarial pass only probes what its author already thought was hard.
//
// The pattern in most of them: the function returned `ok: true` with a
// plausible-looking number that was wrong, rather than refusing.

import {
  vacuumShot,
  dragShot,
  aimForRange,
  impactEnergy,
  multiAxisMove,
  ISA_CEILING_M,
} from "../trajectory";
import { circularOrbit, ellipticalOrbit, hohmannTransfer, rocketEquation } from "../orbital";
import { G } from "../fluids";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("dragShot: the vacuum flight time is NOT an upper bound", () => {
  // The blocker. Drag shortens the ascent but LENGTHENS the descent, because
  // the fall settles towards terminal speed instead of accelerating without
  // limit. Integrating to a fixed multiple of the vacuum time returned a
  // MID-AIR state labelled as ground impact — and solveOde reported success
  // while doing it, so a `completed` check would not have caught it.

  it("a ping-pong ball off a 1000 m cliff LANDS, and takes far longer than the vacuum time", () => {
    const r = ok(dragShot(1, 0.001, 0.0027, 0.00126, 0.5, 1000));
    // Previously returned flightTimeS = 43.84 (exactly the horizon) with the
    // ball still 627 m in the air. The true answer is about 118 s.
    expect(r.flightTimeS).toBeGreaterThan(100);
    // The defining check: it must actually be at the ground.
    expect(Math.abs(r.path[r.path.length - 1].y)).toBeLessThan(1e-6);
  });

  it("the flight time exceeds the vacuum flight time for a light, draggy object", () => {
    const r = ok(dragShot(1, 0.001, 0.0027, 0.00126, 0.5, 1000));
    const vac = ok(vacuumShot(1, 0.001, 1000));
    expect(r.flightTimeS).toBeGreaterThan(vac.flightTimeS * 3);
  });

  it("every one of the reviewer's four cases now reaches the ground", () => {
    const cases: [number, number, number, number, number, number][] = [
      [1, 0.001, 0.0027, 0.00126, 0.5, 1000], // ping-pong off a cliff
      [20, 30, 0.0045, 3.14e-4, 0.47, 2000], // hailstone thrown from height
      [30, 20, 0.0027, 0.00126, 0.5, 500], // ping-pong lobbed off a tower
      [5, 5, 80, 30, 1.3, 2000], // parachutist
    ];
    for (const c of cases) {
      const r = ok(dragShot(...c));
      expect(Math.abs(r.path[r.path.length - 1].y)).toBeLessThan(1e-6);
      expect(r.flightTimeS).toBeGreaterThan(0);
    }
  });

  it("REFUSES rather than reporting a mid-air position when it truly never lands", () => {
    // Enormous drag on a near-weightless object: the descent is so slow that
    // even the grown horizon runs out. The contract is a refusal, never a
    // number.
    const r = dragShot(1, 45, 1e-9, 1e4, 2, 1e6);
    if (r.ok) {
      // If it did land, it must genuinely be at the ground.
      expect(Math.abs(r.path[r.path.length - 1].y)).toBeLessThan(1e-6);
    } else {
      expect(r.error).toMatch(/had not reached the ground|ceiling of the/);
    }
  });
});

describe("dragShot: no NaN, and no subterranean trajectory", () => {
  it("REFUSES a downward launch from ground level instead of returning NaN", () => {
    // Previously: ok:true, rangeFraction NaN, and every path point below
    // ground down to -50 m. A NaN reaches the pane as an em-dash, and the
    // em-dash blocks document insertion.
    const r = dragShot(100, -30, 1, 0.01, 0.3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no flight/);
  });

  it("refuses a level launch from ground level too", () => {
    expect(dragShot(50, 0, 1, 0.01, 0.3).ok).toBe(false);
    expect(dragShot(50, -5, 1, 0.01, 0.3).ok).toBe(false);
  });

  it("a downward launch FROM A HEIGHT is fine, and lands", () => {
    const r = ok(dragShot(100, -30, 1, 0.01, 0.3, 50));
    expect(Math.abs(r.path[r.path.length - 1].y)).toBeLessThan(1e-6);
    expect(r.apexM).toBeCloseTo(50, 6); // never climbs; the launch point is the apex
  });

  it("rangeFraction is either a real number or null, NEVER NaN", () => {
    const cases: [number, number, number, number, number, number][] = [
      [100, -30, 1, 0.01, 0.3, 50],
      [800, 30, 0.01, 5e-5, 0.3, 0],
      [14, 40, 7.26, 0.0113, 0.47, 0],
    ];
    for (const c of cases) {
      const r = ok(dragShot(...c));
      expect(r.rangeFraction === null || Number.isFinite(r.rangeFraction)).toBe(true);
      expect(r.vacuumRangeM === null || Number.isFinite(r.vacuumRangeM)).toBe(true);
    }
  });
});

describe("dragShot: the apex is the real vertex, not the highest sample", () => {
  // RK45 integrates a near-ballistic arc so accurately that it takes only a
  // handful of enormous steps, and none of them lands near the vertex. Taking
  // the maximum over the samples UNDER-reported the apex systematically.

  it("the shot put's apex is 4.11 m, not the 3.48 m the samples gave", () => {
    const r = ok(dragShot(14, 40, 7.26, 0.0113, 0.47));
    expect(r.apexM).toBeGreaterThan(4.0);
    expect(r.apexM).toBeLessThan(4.2);
  });

  it("a dense low-drag shot's apex is 255 m, not the 153 m the samples gave", () => {
    const r = ok(dragShot(100, 45, 1000, 1e-4, 0.01));
    expect(r.apexM).toBeGreaterThan(250);
    expect(r.apexM).toBeLessThan(260);
  });

  it("a near-vacuum shot's apex matches the closed form", () => {
    // Almost no drag, so v²sin²θ/(2g) is the oracle.
    const speed = 100;
    const angle = 50;
    const r = ok(dragShot(speed, angle, 1e6, 1e-6, 0.01));
    const exact = (speed * Math.sin((angle * Math.PI) / 180)) ** 2 / (2 * G);
    expect(r.apexM / exact).toBeGreaterThan(0.999);
    expect(r.apexM / exact).toBeLessThan(1.001);
  });

  it("the apex is never below the highest sampled point", () => {
    for (const c of [
      [200, 60, 4, 0.005, 0.2],
      [45, 35, 0.145, 0.0042, 0.35],
      [70, 12, 0.0459, 0.00143, 0.28],
    ] as [number, number, number, number, number][]) {
      const r = ok(dragShot(...c));
      expect(r.apexM).toBeGreaterThanOrEqual(Math.max(...r.path.map((p) => p.y)) - 1e-9);
    }
  });
});

describe("dragShot: no silent vacuum above the ISA ceiling", () => {
  it("REFUSES a trajectory that leaves the standard atmosphere", () => {
    // Previously integrated ~94 km of flight as a pure vacuum while the notes
    // claimed standard-atmosphere density.
    const r = dragShot(2000, 80, 100, 0.01, 0.1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/standard atmosphere|ceiling/);
  });

  it("the ceiling is the same one the aviation bench uses", () => {
    expect(ISA_CEILING_M).toBe(84852);
  });

  it("a trajectory below the ceiling is still computed", () => {
    expect(dragShot(800, 30, 0.01, 5e-5, 0.3).ok).toBe(true);
  });
});

describe("impactEnergy: the shallow end of the fall-time formula", () => {
  // Fixing the deep-drop saturation introduced a mirror failure: as x → 0,
  // exp(x) rounds towards 1 and acosh near 1 goes as sqrt(2*eps), so the
  // relative error blew up like 1/x and eventually returned a flat ZERO.

  it("a tiny-x fall does NOT return zero time", () => {
    const r = ok(impactEnergy(1, 1, 1e-16, 0.5));
    expect(r.fallTimeS).toBeGreaterThan(0.4);
    expect(r.fallTimeS).toBeCloseTo(Math.sqrt(2 / G), 4);
  });

  it("the physical floor holds across fourteen orders of magnitude of drag", () => {
    for (const area of [1e-18, 1e-16, 1e-12, 1e-8, 1e-4, 1e-2, 1]) {
      for (const h of [1e-6, 1, 1000]) {
        const r = impactEnergy(1, h, area, 0.5);
        if (!r.ok) continue;
        expect(r.fallTimeS).toBeGreaterThanOrEqual(h / r.terminalSpeedMs);
      }
    }
  });

  it("a negligible-drag fall matches the vacuum time to five figures", () => {
    for (const h of [1e-6, 1e-3, 1, 100]) {
      const r = ok(impactEnergy(1, h, 1e-14, 0.1));
      expect(r.fallTimeS).toBeCloseTo(Math.sqrt((2 * h) / G), 5);
    }
  });

  it("the three regimes join up smoothly with no step at the joins", () => {
    // Sweep the drop height through both switch points and check the fall time
    // is monotone and continuous — a discontinuity means a regime is wrong.
    let prev = 0;
    for (let i = 0; i < 400; i++) {
      const h = Math.pow(10, -8 + i * 0.04);
      const r = ok(impactEnergy(0.0045, h, 3.14e-4, 0.47));
      expect(r.fallTimeS).toBeGreaterThan(prev);
      prev = r.fallTimeS;
    }
  });

  it("REFUSES an area so small the terminal speed overflows", () => {
    // Previously returned seven bad fields at once: NaN, Infinity, NaN...
    const r = impactEnergy(1, 1, 1e-320, 0.5);
    expect(r.ok).toBe(false);
  });

  it("refuses a mass so large the energy overflows", () => {
    const r = impactEnergy(1e305, 10, 1, 0.5);
    expect(r.ok).toBe(false);
  });
});

describe("hohmannTransfer: the phase angle is a real lead angle", () => {
  it("a DESCENDING transfer no longer reports minus a thousand degrees", () => {
    // Previously -1078.75 deg for GEO to LEO, because whole revolutions were
    // never wrapped out. The field is documented as a lead angle.
    const r = ok(hohmannTransfer("earth", 35786e3, 300e3));
    expect(r.phaseAngleDeg).toBeCloseTo(1.25, 1);
  });

  it("every phase angle lies in (-180, 180]", () => {
    const pairs: [number, number][] = [
      [300e3, 35786e3],
      [35786e3, 300e3],
      [35786e3, 400e3],
      [400000e3, 300e3],
      [300e3, 400000e3],
      [300e3, 400e3],
    ];
    for (const [a, b] of pairs) {
      const r = ok(hohmannTransfer("earth", a, b));
      expect(r.phaseAngleDeg).toBeGreaterThan(-180);
      expect(r.phaseAngleDeg).toBeLessThanOrEqual(180);
    }
  });

  it("the ascending case is unchanged, which is why this went unnoticed", () => {
    expect(ok(hohmannTransfer("earth", 300e3, 35786e3)).phaseAngleDeg).toBeCloseTo(100.66, 1);
  });
});

describe("multiAxisMove: the notes must not contradict the numbers", () => {
  it("does NOT claim a dog-leg when every axis already finishes together", () => {
    const r = ok(
      multiAxisMove([
        { label: "X", distanceM: 1, vmax: 1, amax: 2 },
        { label: "Y", distanceM: 1, vmax: 1, amax: 2 },
      ]),
    );
    expect(r.earliestFinishS).toBeCloseTo(r.moveTimeS, 12);
    // It may mention the dog-leg to say there ISN'T one; it must not assert
    // that the move traces one, nor that an axis sits idle waiting.
    expect(r.notes.join(" ")).not.toMatch(/traces a dog-leg|sit\s+still/);
    expect(r.notes.join(" ")).toMatch(/already finishes at the same moment/);
  });

  it("still claims the dog-leg when the axes genuinely differ", () => {
    const r = ok(
      multiAxisMove([
        { label: "X", distanceM: 1, vmax: 1, amax: 2 },
        { label: "Y", distanceM: 0.2, vmax: 1, amax: 2 },
      ]),
    );
    expect(r.notes.join(" ")).toMatch(/dog-leg/);
  });

  it("A ZERO-DISTANCE AXIS IS NOT THROTTLED TO ZERO — the plan feeds back in", () => {
    // Previously emitted scaledVmax 0, which this same function refuses as
    // input, so the returned plan could not be used.
    const r = ok(
      multiAxisMove([
        { label: "X", distanceM: 1, vmax: 1, amax: 2 },
        { label: "Z", distanceM: 0, vmax: 0.3, amax: 1 },
      ]),
    );
    const fedBack = multiAxisMove(
      r.axes.map((a) => ({ label: a.label, distanceM: a.distanceM, vmax: a.scaledVmax, amax: a.scaledAmax })),
    );
    expect(fedBack.ok).toBe(true);
  });

  it("refuses limits that overflow rather than returning NaN", () => {
    const r = multiAxisMove([
      { label: "X", distanceM: 1e300, vmax: 1e-300, amax: 1 },
      { label: "Y", distanceM: 1, vmax: 1, amax: 1 },
    ]);
    if (r.ok) {
      for (const a of r.axes) {
        expect(Number.isFinite(a.scaledVmax)).toBe(true);
        expect(Number.isFinite(a.utilisation)).toBe(true);
      }
      expect(Number.isFinite(r.moveTimeS)).toBe(true);
    }
  });
});

describe("overflow with finite, legal inputs is refused rather than returned", () => {
  // Each of these previously returned ok:true with an Infinity or a NaN in a
  // numeric output field — which the pane renders as an em-dash, and the
  // em-dash then blocks insertion of the whole result.

  it("vacuumShot at an absurd speed", () => {
    expect(vacuumShot(1e155, 45).ok).toBe(false);
  });

  it("aimForRange at an absurd speed", () => {
    expect(aimForRange(1e200, 1e10).ok).toBe(false);
  });

  it("circularOrbit at an absurd radius", () => {
    expect(circularOrbit("earth", 1e103).ok).toBe(false);
  });

  it("ellipticalOrbit at an absurd radius", () => {
    expect(ellipticalOrbit("earth", 1e103, 1e104).ok).toBe(false);
  });

  it("rocketEquation at an absurd mass ratio", () => {
    expect(rocketEquation(300, 1e300, 1e-300).ok).toBe(false);
  });

  it("but the ordinary cases all still work", () => {
    expect(vacuumShot(20, 45).ok).toBe(true);
    expect(aimForRange(20, 30).ok).toBe(true);
    expect(circularOrbit("earth", 400e3).ok).toBe(true);
    expect(ellipticalOrbit("earth", 300e3, 35786e3).ok).toBe(true);
    expect(rocketEquation(450, 100, 20).ok).toBe(true);
  });
});
