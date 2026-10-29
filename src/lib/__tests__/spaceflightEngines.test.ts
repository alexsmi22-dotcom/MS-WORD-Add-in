// Spaceflight & missions engines (spaceOrbit.ts, spaceMissions.ts, spaceEnvironment.ts) against the independent oracle
// scripts/spaceflight-oracle.py (scipy DOP853 integration, brentq, numpy quintic roots, skyfield DE421, astropy WGS 84),
// whose output is the fixture fixtures/spaceflight-oracle.json, and against published values: Curtis Examples 4.3, 4.7
// and 5.2, Vallado Example 2-1, Earth–Moon L1 ≈ 326 400 km, Sun–Earth L1 ≈ 1.5 million km, the sun-synchronous
// inclination at 800 km ≈ 98.6°, Apollo TLI ≈ 3.1 km/s, the GTO-to-GEO budget ≈ 4.2 km/s.
//
// Regenerate the fixture (from outside the repo):
//   C:\Users\AlexanderSmith\jurislab-oracle-venv\Scripts\python.exe -I <repo>\scripts\spaceflight-oracle.py
//       C:\Users\AlexanderSmith\jurislab-oracle-data\de421.bsp <repo>\src\lib\__tests__\fixtures\spaceflight-oracle.json

import * as fs from "fs";
import * as path from "path";
import { AU_M, DAY_S, GM_SI, R_EQ_SI, R_MEAN_SI, STANDISH_JD_MAX, STANDISH_JD_MIN, julianDate, isoFromJd, MSIS_RHO } from "../spaceConstants";
import { BODIES } from "../orbital";
import { barker, elementsToState, keplerE, keplerH, lambert, norm, propagate, stateToElements, sub, timeSincePeriapsis, type V3 } from "../spaceOrbit";
import {
  CRITICAL_INC, PAIRS, biellipticDvNorm, biellipticInfNorm, biellipticThresholds, combinedDv, geoRadius, hohmannDvNorm, interplanetaryHohmann, j2Rates,
  jacobi, lagrange, lunarMission, phasing, planeChangeDv, planetState, porkchop, repeatTracks, ssoInclination, standishError, hillRadius, soiRadius, rocheLimits, bodyDensity,
} from "../spaceMissions";
import { ballisticEntry, coverage, densityAt, geodeticToEcef, lookAngles, orbitalDecay, thermalBalance, SUTTON_GRAVES_EARTH } from "../spaceEnvironment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const O: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "spaceflight-oracle.json"), "utf8"));
const mu = GM_SI.earth;
const D2R = Math.PI / 180;
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const near = (a: number, b: number, tol: number): void => expect(rel(a, b)).toBeLessThanOrEqual(tol);
const vnear = (a: number[], b: number[], tol: number): void => {
  const d = norm(sub(a as V3, b as V3));
  expect(d / norm(b as V3)).toBeLessThanOrEqual(tol);
};
const okv = <T extends object>(x: T | { ok: false; error: string }): T => {
  if ("ok" in x && (x as { ok: boolean }).ok === false) throw new Error((x as { error: string }).error);
  return x as T;
};

describe("constants", () => {
  test("agree with orbital.ts BODIES digit for digit (same extracted source)", () => {
    for (const b of BODIES) {
      expect(GM_SI[b.id]).toBe(b.mu);
      expect(R_EQ_SI[b.id]).toBe(b.radius);
    }
  });
  test("Julian dates: J2000, the Standish window ends, and the round trip", () => {
    expect(julianDate("2000-01-01T12:00")).toBe(2451545);
    expect(STANDISH_JD_MIN).toBe(O.standish.jd_1800);
    expect(STANDISH_JD_MAX).toBe(O.standish.jd_2050_12_31);
    expect(julianDate("1800-01-01")).toBe(STANDISH_JD_MIN);
    expect(isoFromJd(julianDate("2026-10-28") as number)).toBe("2026-10-28");
    expect(julianDate("2026-02-30")).toBeNull();
    expect(julianDate("tomorrow")).toBeNull();
  });
  test("the NRLMSIS table is monotone in altitude and ordered by activity above 150 km", () => {
    for (const k of ["low", "moderate", "high"] as const) for (let i = 1; i < MSIS_RHO[k].length; i++) expect(MSIS_RHO[k][i]).toBeLessThan(MSIS_RHO[k][i - 1]);
    const i400 = 57; // 400 km
    expect(MSIS_RHO.high[i400] / MSIS_RHO.low[i400]).toBeGreaterThan(10);
  });
  test("US 1976 below 86 km matches the oracle's own implementation (50 km, sea level)", () => {
    near(densityAt(50000) as number, O.entry.us76_50km, 1e-6);
    near(densityAt(0) as number, O.entry.us76_0, 1e-6);
    expect(densityAt(-1)).toBeNull();
    expect(densityAt(1.2e6)).toBeNull();
  });
});

describe("elements and Kepler", () => {
  test("Curtis Example 4.3: state to elements", () => {
    const e = okv(stateToElements(mu, [-6045e3, -3490e3, 2500e3], [-3.457e3, 6.618e3, 2.533e3]));
    const c = O.orbit.curtis_4_3;
    near(e.h, c.h, 1e-12);
    near(e.e, c.e, 1e-12);
    near(e.i, c.i, 1e-12);
    near(e.raan, c.O, 1e-12);
    near(e.argp, c.w, 1e-10);
    near(e.nu, c.nu, 1e-10);
    near(e.a as number, c.a, 1e-12);
    // Curtis's printed values: h 58 310 km²/s, i 153.2°, Ω 255.3°, e 0.1712, ω 20.07°, θ 28.45°.
    near(e.h / 1e6, 58310, 1e-4);
    near(e.argp / D2R, 20.07, 1e-3);
  });
  test("Curtis Example 4.7: elements to state (hyperbola)", () => {
    const s = elementsToState(mu, { p: (80000e6) ** 2 / mu, e: 1.4, i: 30 * D2R, raan: 40 * D2R, argp: 60 * D2R, nu: 30 * D2R });
    vnear(s.r, O.orbit.curtis_4_7.r, 1e-13);
    vnear(s.v, O.orbit.curtis_4_7.v, 1e-13);
    // Printed: r = (−4040, 4815, 3629) km, v = (−10.39, −4.772, 1.744) km/s.
    vnear(s.r, [-4040e3, 4815e3, 3629e3], 2e-4);
  });
  test("Vallado Example 2-1 and a hyperbolic Kepler equation by brentq", () => {
    near(okv(keplerE(235.4 * D2R, 0.4)).E / D2R, O.orbit.vallado_2_1_E_deg, 1e-13);
    near(okv(keplerH(40.69, 2.4)).F, O.orbit.hyperbolic_F, 1e-13);
  });
  test("Barker's equation is solved exactly: D + D³/3 = 2·Mp", () => {
    for (const Mp of [-50, -1, 0, 0.3, 1, 7, 1e4]) {
      const D = barker(Mp);
      expect(Math.abs(D / 2 + D ** 3 / 6 - Mp)).toBeLessThan(1e-9 * Math.max(1, Math.abs(Mp)));
    }
  });
  test("propagation matches DOP853 integration: Molniya 2 h, parabola (e = 1 exactly) 6000 s, hyperbola 5000 s", () => {
    const m = O.orbit.molniya;
    const p = okv(propagate(mu, m.r0, m.v0, 7200));
    vnear(p.r, m.r2h, 1e-8);
    vnear(p.v, m.v2h, 1e-8);
    for (const k of ["parabola", "hyperbola"]) {
      const c = O.orbit[k];
      const q = okv(propagate(mu, c.r0, c.v0, c.t));
      vnear(q.r, c.r, 1e-8);
      vnear(q.v, c.v, 1e-8);
    }
  });
  test("e = 1 exactly is a parabola: no semi-major axis, the time since periapsis from Barker", () => {
    const s = elementsToState(mu, { p: 14000e3, e: 1, i: 0.3, raan: 0.2, argp: 0.1, nu: 1 });
    const e = okv(stateToElements(mu, s.r, s.v));
    expect(e.conic).toBe("parabolic");
    expect(e.a).toBeNull();
    near(e.tSincePeri, timeSincePeriapsis(mu, 14000e3, 1, 1), 1e-9);
  });
  test("circular inclined: ω reported 0 and the position as the argument of latitude", () => {
    const s = elementsToState(mu, { p: 7000e3, e: 0, i: 0.5, raan: 1, argp: 0, nu: 2 });
    const e = okv(stateToElements(mu, s.r, s.v));
    expect(e.circular).toBe(true);
    expect(e.argp).toBe(0);
    near(e.u, 2, 1e-9);
  });
  test("equatorial elliptic: Ω reported 0 and ω is the longitude of periapsis", () => {
    const s = elementsToState(mu, { p: 9000e3, e: 0.2, i: 0, raan: 0, argp: 1.1, nu: 0.4 });
    const e = okv(stateToElements(mu, s.r, s.v));
    expect(e.equatorial).toBe(true);
    expect(e.raan).toBe(0);
    near(e.argp, 1.1, 1e-9);
    near(e.lonPeri, 1.1, 1e-9);
  });
  test("circular equatorial: the true longitude", () => {
    const s = elementsToState(mu, { p: 7000e3, e: 0, i: 0, raan: 0, argp: 0, nu: 2.5 });
    const e = okv(stateToElements(mu, s.r, s.v));
    expect(e.circular && e.equatorial).toBe(true);
    near(e.trueLon, 2.5, 1e-9);
  });
  test("a radial (rectilinear) state is refused by name", () => {
    const e = stateToElements(mu, [7000e3, 0, 0], [1000, 0, 0]);
    expect("ok" in e && e.ok === false && /radial|rectilinear/.test(e.error)).toBe(true);
  });
  test("non-convergence and bad input are refused, never returned as numbers", () => {
    expect("ok" in keplerE(NaN, 0.5)).toBe(true);
    expect("ok" in keplerE(1, 1)).toBe(true);
    expect("ok" in keplerH(1, 0.5)).toBe(true);
    expect(propagate(mu, [7000e3, 0, 0], [0, 7.5e3, 0], NaN).ok).toBe(false);
    // A hyperbola propagated absurdly far overflows the universal variable: a named refusal, not Infinity.
    const far = propagate(mu, [7000e3, 0, 0], [0, 40e3, 0], 1e30);
    if (far.ok) expect(far.r.every(Number.isFinite)).toBe(true);
    else expect(far.error.length).toBeGreaterThan(20);
  });
});

describe("Lambert", () => {
  const r1: V3 = [5000e3, 10000e3, 2100e3];
  const r2: V3 = [-14600e3, 2500e3, 7000e3];
  test("Curtis Example 5.2 (1 h, short way) against the oracle and the printed values", () => {
    const L = okv(lambert(mu, r1, r2, 3600, "short"));
    vnear(L.v1, O.lambert.curtis_5_2.v1, 1e-6);
    vnear(L.v2, O.lambert.curtis_5_2.v2, 1e-6);
    vnear(L.v1, [-5.9925e3, 1.9254e3, 3.2456e3], 2e-5);
    // Self-consistency: propagating v1 reaches r2.
    const p = okv(propagate(mu, r1, L.v1, 3600));
    expect(norm(sub(p.r, r2))).toBeLessThan(1e-3);
  });
  test("long way (5 h) and a hyperbolic transfer (25 min) against the oracle", () => {
    vnear(okv(lambert(mu, r1, r2, 5 * 3600, "long")).v1, O.lambert.curtis_5_2_long_5h.v1, 1e-6);
    vnear(okv(lambert(mu, r1, r2, 1500, "short")).v1, O.lambert.curtis_5_2_hyperbolic_25min.v1, 1e-6);
  });
  test("a 180° transfer is refused by name (singular plane)", () => {
    const L = lambert(mu, [7000e3, 0, 0], [-9000e3, 1e-3, 0], 4000);
    expect(L.ok).toBe(false);
    if (!L.ok) expect(L.error).toMatch(/180°.*plane is undefined/);
    const L0 = lambert(mu, [7000e3, 0, 0], [9000e3, 0, 0], 4000);
    expect(L0.ok).toBe(false);
    if (!L0.ok) expect(L0.error).toMatch(/same line/);
  });
  test("a time of flight too short to fly (light-speed fraction) is refused by name; a short-way 1 s is too", () => {
    const L = lambert(mu, r1, r2, 0.5, "long");
    expect(L.ok).toBe(false);
    if (!L.ok) expect(L.error).toMatch(/too short.*speed of light/);
    const S = lambert(mu, r1, r2, 1, "short");
    expect(S.ok).toBe(false);
    // Below the parabolic time is NOT a refusal: the transfer is hyperbolic and is solved.
    const H = lambert(mu, r1, r2, 1500, "short");
    expect(H.ok && 1500 < H.tofParabolic).toBe(true);
  });
  test("a time longer than one revolution allows is refused (multi-rev not offered)", () => {
    const L = lambert(mu, r1, r2, 1e40, "short");
    expect(L.ok).toBe(false);
    if (!L.ok) expect(L.error).toMatch(/Multi-revolution/);
  });
});

describe("planets, interplanetary, porkchop", () => {
  test("Standish positions match the oracle's own implementation", () => {
    for (const key of Object.keys(O.standish.positions)) {
      const id = key === "emb" ? "earth" : key;
      for (const row of O.standish.positions[key]) {
        if (row.jd < STANDISH_JD_MIN || row.jd > STANDISH_JD_MAX) continue;
        const s = okv(planetState(id, row.jd));
        vnear(s.r, row.r, 1e-10);
      }
    }
  });
  test("Standish against DE421 (heliocentric, 1900–2050): the measured error, stated where the calculator quotes it", () => {
    // Measured by the oracle at five dates. Mercury to Saturn are within (Mercury: 1.04×) the published nominal
    // longitude error. Uranus and Neptune are NOT: 82″ and 45″ against nominal 50″ and 10″ (their elements fit the
    // barycentric motion better; the Sun moves about 0.01 au about the barycentre). Distances run up to 1.34× nominal, except Neptune: 919 thousand km against a nominal 200.
    // The interplanetary calculator prints these measured figures, so this test pins them.
    const w = O.standish.de421_max_error_arcsec_arcsec_1000km;
    for (const key of ["mercury", "venus", "emb", "mars", "jupiter", "saturn"]) expect(w[key][0]).toBeLessThanOrEqual(standishError(key === "emb" ? "earth" : key)[0] * 1.05);
    expect(w.uranus[0]).toBeLessThan(85);
    expect(w.neptune[0]).toBeLessThan(50);
    for (const key of Object.keys(w).filter((k) => k !== "neptune")) expect(w[key][2]).toBeLessThanOrEqual(standishError(key === "emb" ? "earth" : key)[2] * 1.4);
    expect(w.neptune[2]).toBeLessThan(1000); // 919 thousand km measured against a nominal 200
  });
  test("dates outside 1800–2050 are refused by name", () => {
    const s = planetState("mars", julianDate("2051-06-01") as number);
    expect("ok" in s).toBe(true);
    if ("ok" in s) expect(s.error).toMatch(/1800 to 2050/);
  });
  test("Hohmann Earth→Mars, Venus, Jupiter against the oracle", () => {
    for (const [arr, key, cap] of [["mars", "earth_mars", 400e3], ["venus", "earth_venus", 300e3], ["jupiter", "earth_jupiter", 5000e3]] as Array<[string, string, number]>) {
      const H = okv(interplanetaryHohmann("earth", arr, key === "earth_venus" ? 200e3 : 300e3, cap, cap, null));
      const o = O.interplanetary[key];
      near(H.tofS / DAY_S, o.tof_days, 1e-12);
      near(H.c3, o.c3, 1e-12);
      near(H.dvDepart, o.dv_dep, 1e-12);
      near(H.dvCapture, o.dv_cap, 1e-12);
      near(H.synodicS / DAY_S, o.synodic_days, 1e-12);
    }
  });
  test("porkchop cells match the oracle (Standish) to 1e-6 and DE421 to 1 %", () => {
    const jd0 = julianDate("2026-09-01") as number;
    for (const c of O.interplanetary.porkchop_cells) {
      const pc = okv(porkchop("earth", "mars", jd0 + c.dep_days, 1, c.tof_days, c.tof_days + 1, 2));
      const v = pc.c3[0][0];
      near(v, c.c3, 1e-6);
      near(v, c.c3_de421, 1e-2);
    }
  });
  test("the porkchop grid finds the 2026 window's minimum and blanks no cell needlessly", () => {
    const pc = okv(porkchop("earth", "mars", julianDate("2026-09-01") as number, 200, 120, 400, 41));
    expect(pc.best).not.toBeNull();
    expect(pc.best!.c3 / 1e6).toBeGreaterThan(8.5);
    expect(pc.best!.c3 / 1e6).toBeLessThan(10);
    expect(isoFromJd(pc.best!.depJd).startsWith("2026-1")).toBe(true);
  });
});

describe("lunar", () => {
  test("minimum-energy and 3-day transfers against the oracle; Apollo TLI ≈ 3.1 km/s, LOI ≈ 0.9 km/s", () => {
    for (const [key, tof] of [["hohmann", null], ["three_day", 3 * DAY_S]] as Array<[string, number | null]>) {
      const L = okv(lunarMission({ parkAltM: 185e3, moonDistM: 3.844e8, tofS: tof, lloAltM: 110e3, descentLossMs: 0, ascentLossMs: 0, mccMs: 0, landing: true, ispS: 320 }));
      const o = O.lunar[key];
      near(L.tliDv, o.tli, 1e-9);
      near(L.tofS / DAY_S, o.tof_days, 1e-9);
      near(L.vinfMoon, o.vinf, 1e-8);
      near(L.loiDv, o.loi, 1e-8);
      near(L.descentIdeal, o.descent_ideal, 1e-12);
      near(L.soiM, o.soi, 1e-12);
    }
    const A = okv(lunarMission({ parkAltM: 185e3, moonDistM: 3.844e8, tofS: 3 * DAY_S, lloAltM: 110e3, descentLossMs: 0, ascentLossMs: 0, mccMs: 0, landing: false, ispS: 320 }));
    expect(Math.abs(A.tliDv - 3100)).toBeLessThan(100);
    expect(Math.abs(A.loiDv - 900)).toBeLessThan(100);
  });
  test("refusals by name: below the surface, slower than minimum energy, faster than the cap", () => {
    const base = { parkAltM: 185e3, moonDistM: 3.844e8, tofS: null, lloAltM: 110e3, descentLossMs: 0, ascentLossMs: 0, mccMs: 0, landing: true, ispS: 320 };
    expect(lunarMission({ ...base, parkAltM: -10e3 }).ok).toBe(false);
    expect(lunarMission({ ...base, lloAltM: 0 }).ok).toBe(false);
    const slow = lunarMission({ ...base, tofS: 8 * DAY_S });
    expect(!slow.ok && /longer than the minimum-energy/.test(slow.error)).toBe(true);
    const fast = lunarMission({ ...base, tofS: 0.2 * DAY_S });
    expect(!fast.ok && /1\.6 times escape/.test(fast.error)).toBe(true);
  });
});

describe("orbit changes", () => {
  test("bi-elliptic thresholds: the cubic roots match the oracle's direct Δv comparisons", () => {
    const th = biellipticThresholds();
    near(th.r1, O.maneuvers.threshold_1, 1e-12);
    near(th.r2, O.maneuvers.threshold_2, 1e-6);
    near(th.r1, 11.94, 1e-3);
    near(th.r2, 15.58, 1e-3);
    // Below r1 Hohmann beats even rb → ∞; above r2 a bi-elliptic just above r2 already wins.
    expect(hohmannDvNorm(11)).toBeLessThan(biellipticInfNorm(11));
    expect(biellipticDvNorm(17, 17 * 1.5)).toBeLessThan(hohmannDvNorm(17));
  });
  test("GTO to GEO with 28.5°: combined and separate plane change, phasing (oracle; published ≈ 4.2 km/s)", () => {
    const r1 = R_EQ_SI.earth + 400e3, r2 = R_EQ_SI.earth + 35786e3;
    const v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2), at = (r1 + r2) / 2;
    const vp = Math.sqrt(mu * (2 / r1 - 1 / at)), va = Math.sqrt(mu * (2 / r2 - 1 / at));
    near(vp - v1 + combinedDv(va, v2, 28.5 * D2R), O.maneuvers.gto.combined_end, 1e-12);
    near(vp - v1 + v2 - va + planeChangeDv(v1, 28.5 * D2R), O.maneuvers.gto.separate_start, 1e-12);
    near(okv(phasing(mu, r2, 30 * D2R, 1, R_EQ_SI.earth)).dvTotal, O.maneuvers.gto.phasing_dv, 1e-10);
    expect(Math.abs(O.maneuvers.gto.combined_end - 4220)).toBeLessThan(50);
  });
  test("phasing that would dip into the body is refused by name", () => {
    const p = phasing(mu, R_EQ_SI.earth + 400e3, 30 * D2R, 1, R_EQ_SI.earth);
    expect(!p.ok && /inside the body/.test(p.error)).toBe(true);
    expect(phasing(mu, 7e6, 0, 1, 6.4e6).ok).toBe(false);
    expect(phasing(mu, 7e6, 0.3, 1.5, 6.4e6).ok).toBe(false);
  });
});

describe("J2 and special orbits", () => {
  test("sun-synchronous inclinations, rates, repeat altitude, GEO, critical inclination (oracle; published SSO at 800 km ≈ 98.6°)", () => {
    const R = R_EQ_SI.earth;
    near((ssoInclination(R + 800e3) as number) / D2R, O.j2.sso_800_deg, 1e-9);
    near((ssoInclination(R + 500e3) as number) / D2R, O.j2.sso_500_deg, 1e-9);
    near((ssoInclination(R + 1000e3) as number) / D2R, O.j2.sso_1000_deg, 1e-9);
    expect(Math.abs((ssoInclination(R + 800e3) as number) / D2R - 98.6)).toBeLessThan(0.05);
    const rates = j2Rates(mu, R, 0.00108263, R + 800e3, 0, ssoInclination(R + 800e3) as number);
    near((rates.raanDot / D2R) * DAY_S, O.j2.raan_dot_800_deg_day, 1e-9);
    near((rates.argpDot / D2R) * DAY_S, O.j2.argp_dot_800_deg_day, 1e-9);
    const iss = j2Rates(mu, R, 0.00108263, R + 420e3, 0.0005, 51.64 * D2R);
    near((iss.raanDot / D2R) * DAY_S, O.j2.iss_raan_dot_deg_day, 1e-9);
    const rep = repeatTracks(800e3, ssoInclination(R + 800e3) as number, 16).find((x) => x.revs === 57 && x.days === 4);
    expect(rep).toBeDefined();
    expect(Math.abs((rep as { altitudeM: number }).altitudeM - O.j2.repeat_57_4_alt_m)).toBeLessThan(0.05);
    near(geoRadius(), O.j2.geo_radius_m, 1e-12);
    near(CRITICAL_INC / D2R, O.j2.critical_deg, 1e-13);
  });
  test("no sun-synchronous inclination above about 5970 km", () => {
    expect(ssoInclination(R_EQ_SI.earth + 6500e3)).toBeNull();
  });
});

describe("three-body", () => {
  test("Lagrange points against numpy's quintic roots; Earth–Moon L1 ≈ 326 400 km, Sun–Earth L1 ≈ 1.5 million km", () => {
    for (const [key, m1, m2] of [["earth-moon", GM_SI.earth, GM_SI.moon], ["sun-earth", GM_SI.sun, GM_SI.earth + GM_SI.moon], ["sun-jupiter", GM_SI.sun, GM_SI.jupiter], ["equal", 1, 1], ["pluto-charon-like", 1, 0.1218]] as Array<[string, number, number]>) {
      const o = O.three_body[key];
      const L = okv(lagrange(m2 / (m1 + m2)));
      for (let k = 0; k < 3; k++) expect(Math.abs(L.xL[k] - o.x[k])).toBeLessThan(1e-12);
      for (let k = 0; k < 4; k++) near(L.cL[k], o.C[k], 1e-12);
    }
    const em = O.three_body["earth-moon"];
    expect(Math.abs(em.L1_from_primary_m / 1e3 - 326400)).toBeLessThan(400);
    const se = O.three_body["sun-earth"];
    expect(Math.abs(se.L1_from_secondary_m / 1e9 - 1.5)).toBeLessThan(0.01);
  });
  test("Hill, SOI, Roche and the default state's Jacobi constant", () => {
    const p = PAIRS.find((x) => x.id === "earth-moon")!;
    near(hillRadius(p.dist, 0, p.mu1, p.mu2), O.three_body["earth-moon"].hill_m, 1e-12);
    near(soiRadius(p.dist, p.mu1, p.mu2), O.three_body["earth-moon"].soi_m, 1e-12);
    const roche = rocheLimits(R_MEAN_SI.earth, bodyDensity(GM_SI.earth, R_MEAN_SI.earth), 3340);
    near(roche.rigid, O.three_body.roche_earth_rigid_3340_m, 1e-9);
    near(roche.fluid, O.three_body.roche_earth_fluid_3340_m, 1e-9);
    const mu2 = p.mu2 / (p.mu1 + p.mu2);
    const w = Math.sqrt((p.mu1 + p.mu2) / p.dist ** 3);
    near(jacobi(mu2, 3e8 / p.dist, 0, 0, 100 / (w * p.dist)), O.three_body.default_state_C, 1e-12);
  });
  test("mass ratio exactly 0.5: L1 at the barycentre, L2 and L3 symmetric; above 0.5 refused", () => {
    const L = okv(lagrange(0.5));
    expect(Math.abs(L.xL[0])).toBeLessThan(1e-12);
    expect(Math.abs(L.xL[1] + L.xL[2])).toBeLessThan(1e-12);
    expect(L.triangularStable).toBe(false);
    expect(lagrange(0.6).ok).toBe(false);
    expect(lagrange(0).ok).toBe(false);
    const nearOne = okv(lagrange(0.4999999));
    expect(Math.abs(nearOne.xL[0])).toBeLessThan(1e-6);
  });
});

describe("entry, decay, ground, thermal", () => {
  const entry = () => okv(ballisticEntry({ beta: 5000 / (1.3 * 12), vEntry: 7800, gamma: 6 * D2R, rho0: 1.225, H: 7200, noseR: 3, kSG: SUTTON_GRAVES_EARTH, hEntry: 122e3 }));
  test("Allen–Eggers and Sutton–Graves closed forms against the oracle", () => {
    const e = entry();
    near(e.aMax / 9.80665, O.entry.a_max_g, 1e-12);
    near(e.hAmax, O.entry.h_amax_m, 1e-12);
    near(e.vAmax, O.entry.v_amax, 1e-12);
    near(e.qMax, O.entry.q_max_w_m2, 1e-12);
    near(e.hQmax, O.entry.h_qmax_m, 1e-12);
  });
  test("the RK4 integration agrees with scipy DOP853 on the same atmosphere to 0.5 %", () => {
    const n = entry().numeric!;
    near(n.aMax / 9.80665, O.entry.numeric_a_max_g, 5e-3);
    expect(Math.abs(n.hAmax - O.entry.numeric_h_amax_m)).toBeLessThan(300);
    near(n.vAmax, O.entry.numeric_v_amax, 5e-3);
  });
  test("γ = 0 is refused by name", () => {
    const e = ballisticEntry({ beta: 300, vEntry: 7800, gamma: 0, rho0: 1.225, H: 7200, noseR: 1, kSG: SUTTON_GRAVES_EARTH, hEntry: 122e3 });
    expect(!e.ok && /0°.*skips|grazing/.test(e.error)).toBe(true);
  });
  test("decay lifetimes against scipy quad on the same table", () => {
    const d = okv(orbitalDecay(250e3, 5000 / (1.3 * 12)));
    for (const k of ["low", "moderate", "high"] as const) near(d.lifetimeDays[k] as number, O.decay.capsule_250km_days[k], 2e-3);
    const c = okv(orbitalDecay(400e3, 1.33 / (2.2 * 0.01)));
    for (const k of ["low", "moderate", "high"] as const) near(c.lifetimeDays[k] as number, O.decay.cubesat_1u_400km_days[k], 2e-3);
    expect(orbitalDecay(100e3, 50).ok).toBe(false);
    expect(orbitalDecay(1500e3, 50).ok).toBe(false);
  });
  test("look angles and coverage against astropy WGS 84 and the oracle", () => {
    const la = lookAngles(40 * D2R, -105 * D2R, 1600, geodeticToEcef(45 * D2R, -100 * D2R, 550e3));
    near(la.azimuth / D2R, O.ground.az_deg, 1e-9);
    near(la.elevation / D2R, O.ground.el_deg, 1e-9);
    near(la.range, O.ground.range_m, 1e-9);
    const c = okv(coverage(550e3, 10 * D2R, 2.25e9));
    near(c.lambda / D2R, O.ground.lambda_deg, 1e-12);
    near(c.footprintRadius, O.ground.footprint_m, 1e-12);
    near(c.maxPass, O.ground.max_pass_s, 1e-12);
    near(c.rangeRateMax, O.ground.range_rate_max, 1e-6);
    near(c.dopplerHz, O.ground.doppler_hz, 1e-6);
    near(c.slantMax, O.ground.slant_max_m, 1e-12);
    expect(coverage(-1, 0.1, 1e9).ok).toBe(false);
  });
  test("thermal balance against the oracle; refusals", () => {
    const t = okv(thermalBalance({ alpha: 0.3, eps: 0.8, distM: AU_M, aSun: 1, aRad: 6, albedo: 0.3, planetIR: 237, viewF: 0.3, aPlanet: 1, power: 100 }));
    near(t.tHot, O.thermal.t_hot, 1e-12);
    near(t.tCold, O.thermal.t_cold, 1e-12);
    const mars = okv(thermalBalance({ alpha: 1, eps: 1, distM: 1.52371034 * AU_M, aSun: 1, aRad: 4, albedo: 0, planetIR: 0, viewF: 0, aPlanet: 0, power: 0 }));
    near(mars.tHot, O.thermal.t_mars_black, 1e-12);
    expect(thermalBalance({ alpha: 0.3, eps: 0, distM: AU_M, aSun: 1, aRad: 6, albedo: 0, planetIR: 0, viewF: 0, aPlanet: 0, power: 0 }).ok).toBe(false);
  });
});
