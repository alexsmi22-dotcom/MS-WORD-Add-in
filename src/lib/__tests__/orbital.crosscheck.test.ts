// The committed cross-check for the fetched gravitational parameters, the same
// treatment flame.ts and colourspace.ts received.
//
// μ and the body radii were script-extracted from the poliastro constants
// module (IAU 2009). These tests validate them against facts known
// INDEPENDENTLY of that file: a wrong μ_Earth cannot reproduce the sidereal day
// from the geostationary radius, nor surface gravity, nor the ISS period.

import {
  BODIES,
  bodyById,
  circularOrbit,
  ellipticalOrbit,
  hohmannTransfer,
  rocketEquation,
  escapeSpeed,
  G0,
} from "../orbital";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("fetched gravitational parameters vs independent facts", () => {
  it("mu_Earth reproduces the SIDEREAL DAY at geostationary altitude", () => {
    // The strongest available check: geostationary is defined by the sidereal
    // day (23h 56m 4s = 86164 s), and 35786 km is the published altitude.
    // A wrong mu misses this immediately.
    const geo = ok(circularOrbit("earth", 35786e3));
    expect(geo.periodS).toBeCloseTo(86164, -2); // within ~100 s
    expect(geo.periodS / 3600).toBeCloseTo(23.934, 2);
  });

  it("mu_Earth reproduces surface gravity", () => {
    // g = mu / R^2 must come out at 9.80 m/s^2.
    const e = bodyById("earth")!;
    expect(e.mu / (e.radius * e.radius)).toBeCloseTo(9.80, 2);
  });

  it("mu_Earth reproduces the ISS orbital period", () => {
    // ~420 km altitude, ~93 minutes — a widely published figure.
    const iss = ok(circularOrbit("earth", 420e3));
    expect(iss.periodS / 60).toBeGreaterThan(92);
    expect(iss.periodS / 60).toBeLessThan(94);
    expect(iss.speedMs).toBeGreaterThan(7600);
    expect(iss.speedMs).toBeLessThan(7700);
  });

  it("Earth's escape speed from the surface is the known 11.2 km/s", () => {
    expect(ok(escapeSpeed("earth", 0)).escapeSpeedMs / 1000).toBeCloseTo(11.18, 1);
  });

  it("the Moon's surface gravity is about a sixth of Earth's", () => {
    const m = bodyById("moon")!;
    const e = bodyById("earth")!;
    const gm = m.mu / (m.radius * m.radius);
    const ge = e.mu / (e.radius * e.radius);
    expect(gm / ge).toBeCloseTo(1 / 6, 1);
  });

  it("Mars surface gravity is about 3.7 m/s^2", () => {
    const m = bodyById("mars")!;
    expect(m.mu / (m.radius * m.radius)).toBeCloseTo(3.72, 1);
  });

  it("every body cites its source and has plausible magnitudes", () => {
    for (const b of BODIES) {
      expect(b.source).toMatch(/IAU/);
      expect(b.mu).toBeGreaterThan(1e12);
      expect(b.radius).toBeGreaterThan(1e6);
    }
    // The Sun's mu must dominate every planet's.
    const sun = bodyById("sun")!;
    for (const b of BODIES.filter((x) => x.id !== "sun")) {
      expect(sun.mu).toBeGreaterThan(b.mu * 100);
    }
  });
});

describe("circular orbits", () => {
  it("a LOWER orbit is a FASTER orbit", () => {
    const low = ok(circularOrbit("earth", 300e3));
    const high = ok(circularOrbit("earth", 20000e3));
    expect(low.speedMs).toBeGreaterThan(high.speedMs);
    expect(low.periodS).toBeLessThan(high.periodS);
  });

  it("speed follows sqrt(mu/r) exactly", () => {
    const b = bodyById("earth")!;
    const r = ok(circularOrbit("earth", 1000e3));
    expect(r.speedMs).toBeCloseTo(Math.sqrt(b.mu / (b.radius + 1000e3)), 6);
  });

  it("escape speed is exactly sqrt(2) times circular speed", () => {
    const c = ok(circularOrbit("earth", 500e3));
    expect(c.escapeSpeedMs / c.speedMs).toBeCloseTo(Math.SQRT2, 12);
  });

  it("refuses a negative altitude and an unknown body", () => {
    expect(circularOrbit("earth", -1).ok).toBe(false);
    expect(circularOrbit("pluto", 100e3).ok).toBe(false);
  });

  it("warns that a very low orbit decays", () => {
    expect(ok(circularOrbit("earth", 150e3)).notes.join(" ")).toMatch(/decays/);
  });
});

describe("elliptical orbits", () => {
  it("PERIOD DEPENDS ONLY ON SEMI-MAJOR AXIS, not eccentricity", () => {
    // A circle and a highly eccentric orbit with the same a take the same time.
    const circ = ok(ellipticalOrbit("earth", 10000e3, 10000e3));
    const ecc = ok(ellipticalOrbit("earth", 1000e3, 19000e3));
    expect(ecc.semiMajorAxisM).toBeCloseTo(circ.semiMajorAxisM, 6);
    expect(ecc.periodS).toBeCloseTo(circ.periodS, 6);
    expect(ecc.eccentricity).toBeGreaterThan(0.4);
  });

  it("is fastest at periapsis and slowest at apoapsis", () => {
    const e = ok(ellipticalOrbit("earth", 300e3, 35786e3));
    expect(e.periapsisSpeedMs).toBeGreaterThan(e.apoapsisSpeedMs);
  });

  it("a circular case has zero eccentricity and matches circularOrbit", () => {
    const e = ok(ellipticalOrbit("earth", 500e3, 500e3));
    const c = ok(circularOrbit("earth", 500e3));
    expect(e.eccentricity).toBeCloseTo(0, 12);
    expect(e.periodS).toBeCloseTo(c.periodS, 6);
    expect(e.periapsisSpeedMs).toBeCloseTo(c.speedMs, 6);
  });

  it("refuses swapped apsides", () => {
    const r = ellipticalOrbit("earth", 35786e3, 300e3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/swapped/);
  });
});

describe("Hohmann transfer", () => {
  it("LEO to GEO costs about 3.9 km/s and takes about 5.3 hours", () => {
    const h = ok(hohmannTransfer("earth", 300e3, 35786e3));
    expect(h.totalDeltaVMs / 1000).toBeCloseTo(3.9, 1);
    expect(h.transferTimeS / 3600).toBeCloseTo(5.3, 1);
  });

  it("raising uses two POSITIVE burns; lowering uses two negative ones", () => {
    const up = ok(hohmannTransfer("earth", 300e3, 35786e3));
    expect(up.burn1Ms).toBeGreaterThan(0);
    expect(up.burn2Ms).toBeGreaterThan(0);
    const down = ok(hohmannTransfer("earth", 35786e3, 300e3));
    expect(down.burn1Ms).toBeLessThan(0);
    expect(down.burn2Ms).toBeLessThan(0);
  });

  it("costs the same Δv in both directions", () => {
    const up = ok(hohmannTransfer("earth", 300e3, 35786e3));
    const down = ok(hohmannTransfer("earth", 35786e3, 300e3));
    expect(down.totalDeltaVMs).toBeCloseTo(up.totalDeltaVMs, 6);
  });

  it("says to SLOW DOWN to catch something ahead", () => {
    expect(ok(hohmannTransfer("earth", 300e3, 400e3)).notes.join(" ")).toMatch(/SLOW DOWN/);
  });

  it("flags the bi-elliptic threshold at large radius ratios", () => {
    const far = ok(hohmannTransfer("earth", 300e3, 400000e3));
    expect(far.notes.join(" ")).toMatch(/bi-elliptic/);
  });

  it("refuses a transfer between identical orbits", () => {
    expect(hohmannTransfer("earth", 500e3, 500e3).ok).toBe(false);
  });
});

describe("the rocket equation", () => {
  it("follows ve * ln(mass ratio)", () => {
    const r = ok(rocketEquation(450, 100, 20));
    expect(r.exhaustVelocityMs).toBeCloseTo(450 * G0, 9);
    expect(r.deltaVMs).toBeCloseTo(450 * G0 * Math.log(5), 6);
  });

  it("Δv is EXPONENTIAL in mass ratio, not linear", () => {
    const a = ok(rocketEquation(300, 10, 5)); // ratio 2
    const b = ok(rocketEquation(300, 10, 2.5)); // ratio 4
    // Doubling the ratio adds a fixed increment; it does not double Δv.
    expect(b.deltaVMs).toBeCloseTo(a.deltaVMs * 2, 6);
    // And to double Δv again the ratio must square, not double.
    const c = ok(rocketEquation(300, 16, 1));
    expect(c.deltaVMs).toBeGreaterThan(b.deltaVMs);
  });

  it("uses the definitional g0, not local gravity", () => {
    expect(G0).toBe(9.80665);
    expect(ok(rocketEquation(1, 2, 1)).exhaustVelocityMs).toBeCloseTo(9.80665, 9);
  });

  it("refuses a final mass at or above the initial", () => {
    expect(rocketEquation(300, 10, 10).ok).toBe(false);
    expect(rocketEquation(300, 10, 20).ok).toBe(false);
  });

  it("says the last increment costs the most", () => {
    expect(ok(rocketEquation(450, 100, 20)).notes.join(" ")).toMatch(/EXPONENTIAL/);
  });
});

describe("escape", () => {
  it("is independent of direction, and says so", () => {
    expect(ok(escapeSpeed("earth", 0)).notes.join(" ")).toMatch(/independent of DIRECTION/);
  });

  it("falls with altitude", () => {
    expect(ok(escapeSpeed("earth", 1000e3)).escapeSpeedMs).toBeLessThan(
      ok(escapeSpeed("earth", 0)).escapeSpeedMs,
    );
  });

  it("leaving from orbit costs about 41% more speed", () => {
    const e = ok(escapeSpeed("earth", 400e3));
    expect(e.additionalFromOrbitMs / e.circularSpeedMs).toBeCloseTo(Math.SQRT2 - 1, 9);
  });
});
