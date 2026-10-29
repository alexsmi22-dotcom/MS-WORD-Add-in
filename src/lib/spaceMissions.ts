// Mission-design engines for the Spaceflight & missions calculators: approximate planet positions (JPL Standish
// Table 1), interplanetary Hohmann transfers, launch windows and a Lambert porkchop; the patched-conic lunar Δv budget;
// orbit changes (plane change, bi-elliptic, phasing); J2 perturbations and the special orbits they make (sun-synchronous,
// frozen/critical, geostationary drift, repeat ground tracks); and the circular restricted three-body problem
// (Lagrange points, Hill and Laplace spheres, Roche limits, the Jacobi constant). SI units (m, s, rad) throughout.
//
// Numbers in this file come from spaceOrbit.ts (the two-body core) and spaceConstants.ts (script-extracted constants).

import { AU_M, DAY_S, GM_SI, J2, JULIAN_CENTURY_D, OMEGA_EARTH, R_EQ_SI, STANDISH_JD_MAX, STANDISH_JD_MIN, STANDISH_T1, SUN_MEAN_RATE, G_NEWTON, isoFromJd } from "./spaceConstants";
import { guardedRoot, keplerE, lambert, norm, sub, type V3, type OrbitFail, timeSincePeriapsis } from "./spaceOrbit";

const D2R = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const wrapPi = (x: number): number => x - TWO_PI * Math.floor((x + Math.PI) / TWO_PI);
const wrap2pi = (x: number): number => x - TWO_PI * Math.floor(x / TWO_PI);
const fail = (error: string): OrbitFail => ({ ok: false, error });

// ---------------------------------------------------------------------------------------------------------------
// Planet positions (Standish Table 1)
// ---------------------------------------------------------------------------------------------------------------

export interface PlanetState {
  r: V3;
  v: V3;
  /** Mean longitude L, rad (ecliptic J2000). */
  L: number;
  /** Heliocentric ecliptic longitude of the position, rad. */
  lon: number;
}

/** The Standish key of a planet ("earth" is the Earth–Moon barycentre row). */
const sKey = (id: string): string => (id === "earth" ? "emb" : id);

/**
 * Heliocentric position and velocity (m, m/s; mean ecliptic and equinox of J2000) of a planet at a Julian Date, from
 * Standish's Table 1 (valid 1800 to 2050; outside that it is refused). Velocity is the two-body velocity on the
 * instantaneous ellipse with GM of the Sun.
 */
export function planetState(id: string, jd: number): PlanetState | OrbitFail {
  const row = STANDISH_T1[sKey(id)];
  if (!row) return fail(`No approximate orbit is held for "${id}".`);
  if (!(jd >= STANDISH_JD_MIN && jd <= STANDISH_JD_MAX)) return fail(`${isoFromJd(jd)} is outside 1800 to 2050, the interval Standish's Table 1 elements are fitted to; they are not valid outside it.`);
  const T = (jd - 2451545.0) / JULIAN_CENTURY_D;
  const [a0, e0, i0, L0, w0, O0] = row.el.map((x, k) => x + row.rate[k] * T);
  const a = a0 * AU_M;
  const e = e0;
  const i = i0 * D2R;
  const L = L0 * D2R;
  const varpi = w0 * D2R;
  const node = O0 * D2R;
  const argp = varpi - node;
  const M = wrapPi(L - varpi);
  const ke = keplerE(M, e);
  if ("ok" in ke) return ke;
  const E = ke.E;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const mu = GM_SI.sun;
  const n = Math.sqrt(mu / (a * a * a));
  const Edot = n / (1 - e * Math.cos(E));
  const vxp = -a * Math.sin(E) * Edot;
  const vyp = a * Math.sqrt(1 - e * e) * Math.cos(E) * Edot;
  const cw = Math.cos(argp), sw = Math.sin(argp), cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(i), si = Math.sin(i);
  const rot = (x: number, y: number): V3 => [
    (cw * cO - sw * sO * ci) * x + (-sw * cO - cw * sO * ci) * y,
    (cw * sO + sw * cO * ci) * x + (-sw * sO + cw * cO * ci) * y,
    sw * si * x + cw * si * y,
  ];
  const r = rot(xp, yp);
  return { r, v: rot(vxp, vyp), L: wrap2pi(L), lon: wrap2pi(Math.atan2(r[1], r[0])) };
}

/** The published Table 1 accuracy for a planet, 1800–2050: [longitude arcsec, latitude arcsec, distance 1000 km]. */
export function standishError(id: string): number[] {
  return STANDISH_T1[sKey(id)]?.err ?? [];
}

/** Semi-major axis (m) of a planet's heliocentric orbit at J2000 (Standish Table 1). */
export function planetSma(id: string): number {
  return STANDISH_T1[sKey(id)].el[0] * AU_M;
}

// ---------------------------------------------------------------------------------------------------------------
// Interplanetary Hohmann, windows, departure and capture
// ---------------------------------------------------------------------------------------------------------------

/** Δv from a circular parking orbit of radius rp to a hyperbola of excess speed vinf (the Oberth burn at periapsis). */
export function departureDv(mu: number, rp: number, vinf: number): number {
  return Math.sqrt(vinf * vinf + (2 * mu) / rp) - Math.sqrt(mu / rp);
}
/** Δv to capture from a hyperbola of excess vinf into an ellipse with periapsis rp and apoapsis ra (ra = rp: circular). */
export function captureDv(mu: number, rp: number, ra: number, vinf: number): number {
  const a = (rp + ra) / 2;
  return Math.sqrt(vinf * vinf + (2 * mu) / rp) - Math.sqrt(mu * (2 / rp - 1 / a));
}

export interface InterplanetaryResult {
  ok: true;
  r1: number;
  r2: number;
  tofS: number;
  vinfDep: number;
  vinfArr: number;
  c3: number;
  dvDepart: number;
  dvCapture: number;
  synodicS: number;
  /** Phase angle the arrival planet must lead the departure planet by at departure, rad (−π, π]. */
  phaseRad: number;
  /** Next date on or after the start date when the mean-longitude phase equals the Hohmann phase (JD), or null. */
  nextWindowJd: number | null;
  /** The phase at the start date, rad. */
  phaseNowRad: number | null;
  period1S: number;
  period2S: number;
}

export function interplanetaryHohmann(dep: string, arr: string, parkAltM: number, capPeriAltM: number, capApoAltM: number, startJd: number | null): InterplanetaryResult | OrbitFail {
  if (dep === arr) return fail("The departure and arrival planets are the same: there is no interplanetary transfer.");
  if (!STANDISH_T1[sKey(dep)] || !STANDISH_T1[sKey(arr)]) return fail("Both ends must be planets (Mercury to Neptune).");
  if (!(parkAltM >= 0) || !(capPeriAltM >= 0)) return fail("Parking and capture altitudes must be zero or more (an altitude below zero is inside the planet).");
  if (!(capApoAltM >= capPeriAltM)) return fail("The capture orbit's apoapsis altitude must be at or above its periapsis altitude.");
  const mu = GM_SI.sun;
  const r1 = planetSma(dep);
  const r2 = planetSma(arr);
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1);
  const v2 = Math.sqrt(mu / r2);
  const vt1 = Math.sqrt(mu * (2 / r1 - 1 / at));
  const vt2 = Math.sqrt(mu * (2 / r2 - 1 / at));
  const vinfDep = Math.abs(vt1 - v1);
  const vinfArr = Math.abs(v2 - vt2);
  const tof = Math.PI * Math.sqrt((at * at * at) / mu);
  const T1 = TWO_PI * Math.sqrt((r1 * r1 * r1) / mu);
  const T2 = TWO_PI * Math.sqrt((r2 * r2 * r2) / mu);
  const syn = 1 / Math.abs(1 / T1 - 1 / T2);
  const n2 = TWO_PI / T2;
  const phase = wrapPi(Math.PI - n2 * tof);
  const muD = GM_SI[dep];
  const muA = GM_SI[arr];
  const rp = R_EQ_SI[dep] + parkAltM;
  const rcp = R_EQ_SI[arr] + capPeriAltM;
  const rca = R_EQ_SI[arr] + capApoAltM;
  let nextJd: number | null = null;
  let phaseNow: number | null = null;
  if (startJd !== null) {
    const s0 = planetState(dep, startJd);
    const a0 = planetState(arr, startJd);
    if ("ok" in s0) return s0;
    if ("ok" in a0) return a0;
    phaseNow = wrapPi(a0.lon - s0.lon);
    // The relative phase changes at the synodic rate; step by a day across 1.5 synodic periods and refine.
    const f = (jd: number): number | null => {
      const s = planetState(dep, jd);
      const a = planetState(arr, jd);
      if ("ok" in s || "ok" in a) return null;
      return wrapPi(a.lon - s.lon - phase);
    };
    const span = Math.min(1.5 * syn / DAY_S, STANDISH_JD_MAX - startJd);
    const step = Math.max(0.5, Math.min(5, syn / DAY_S / 400));
    let prev = f(startJd);
    for (let t = step; t <= span && prev !== null; t += step) {
      const cur = f(startJd + t);
      if (cur === null) break;
      // A sign change that is not the ±π wrap.
      if (Math.sign(cur) !== Math.sign(prev) && Math.abs(cur - prev) < Math.PI) {
        const g = (x: number): number => f(x) ?? NaN;
        const root = guardedRoot(g, null, startJd + t - step, startJd + t, startJd + t - step / 2, 1e-12, 100);
        nextJd = root ? root.x : startJd + t;
        break;
      }
      prev = cur;
    }
  }
  return {
    ok: true, r1, r2, tofS: tof, vinfDep, vinfArr, c3: vinfDep * vinfDep,
    dvDepart: departureDv(muD, rp, vinfDep), dvCapture: captureDv(muA, rcp, rca, vinfArr),
    synodicS: syn, phaseRad: phase, nextWindowJd: nextJd, phaseNowRad: phaseNow, period1S: T1, period2S: T2,
  };
}

export interface PorkchopResult {
  ok: true;
  depJd: number[];
  tofDays: number[];
  /** c3[j][i]: departure C3 (m²/s²) for depJd[i] and tofDays[j]; NaN where Lambert refused (a hole). */
  c3: number[][];
  vinfArr: number[][];
  best: { depJd: number; tofDays: number; c3: number; vinfArr: number } | null;
  holes: number;
}

/**
 * C3 over departure date × time of flight: one prograde single-revolution Lambert solve per cell between the two
 * planets' Standish positions. Cells Lambert refuses (the 180° ridge, outside the fit interval) are holes, not failures.
 */
export function porkchop(dep: string, arr: string, startJd: number, spanDays: number, tofMinDays: number, tofMaxDays: number, n = 41): PorkchopResult | OrbitFail {
  if (dep === arr) return fail("The departure and arrival planets are the same.");
  if (!(spanDays > 0) || !(tofMaxDays > tofMinDays) || !(tofMinDays > 0)) return fail("The window needs a positive span and a time-of-flight range with the maximum above the minimum, both above zero.");
  if (spanDays > 3650) return fail("A departure span above 3650 days is refused: the grid would be too coarse to read.");
  if (startJd < STANDISH_JD_MIN || startJd + spanDays + tofMaxDays > STANDISH_JD_MAX) return fail(`The window (departure plus flight) must lie within 1800 to 2050, where Standish's Table 1 is valid; this one runs to ${isoFromJd(startJd + spanDays + tofMaxDays)}.`);
  const mu = GM_SI.sun;
  // Grid size clamped (2 to 101 per side): every count a caller supplies is bounded, so no input can stall Word.
  n = Number.isFinite(n) ? Math.max(2, Math.min(101, Math.round(n))) : 41;
  const depJd = Array.from({ length: n }, (_, i) => startJd + (spanDays * i) / (n - 1));
  const tofDays = Array.from({ length: n }, (_, j) => tofMinDays + ((tofMaxDays - tofMinDays) * j) / (n - 1));
  const c3: number[][] = [];
  const va: number[][] = [];
  let best: PorkchopResult["best"] = null;
  let holes = 0;
  const depStates = depJd.map((jd) => planetState(dep, jd));
  for (const tf of tofDays) {
    const row: number[] = [];
    const rowA: number[] = [];
    depJd.forEach((jd, i) => {
      const s = depStates[i];
      const a = planetState(arr, jd + tf);
      if ("ok" in s || "ok" in a) {
        row.push(NaN);
        rowA.push(NaN);
        holes++;
        return;
      }
      const L = lambert(mu, s.r, a.r, tf * DAY_S, "prograde");
      if (!L.ok) {
        row.push(NaN);
        rowA.push(NaN);
        holes++;
        return;
      }
      const c = norm(sub(L.v1, s.v)) ** 2;
      const vi = norm(sub(L.v2, a.v));
      row.push(c);
      rowA.push(vi);
      if (!best || c < best.c3) best = { depJd: jd, tofDays: tf, c3: c, vinfArr: vi };
    });
    c3.push(row);
    va.push(rowA);
  }
  return { ok: true, depJd, tofDays, c3, vinfArr: va, best, holes };
}

// ---------------------------------------------------------------------------------------------------------------
// Lunar mission, patched conic
// ---------------------------------------------------------------------------------------------------------------

export interface LunarInput {
  parkAltM: number;
  /** Earth–Moon distance, m. */
  moonDistM: number;
  /** Translunar flight time, s; null = the minimum-energy (Hohmann-like) transfer. */
  tofS: number | null;
  lloAltM: number;
  /** Gravity-loss allowances (m/s) added to the ideal powered descent and ascent. */
  descentLossMs: number;
  ascentLossMs: number;
  /** Mid-course correction allowance per leg, m/s. */
  mccMs: number;
  /** Landing and ascent included. */
  landing: boolean;
  ispS: number;
}

export interface LunarLeg {
  name: string;
  dv: number;
  note: string;
}

export interface LunarResult {
  ok: true;
  tliDv: number;
  tofS: number;
  /** Perigee speed after TLI and the apogee radius of the transfer conic (null when hyperbolic). */
  vTli: number;
  apogeeM: number | null;
  e: number;
  vinfMoon: number;
  /** Laplace sphere of influence of the Moon, m. */
  soiM: number;
  loiDv: number;
  descentIdeal: number;
  ascentIdeal: number;
  teiDv: number;
  legs: LunarLeg[];
  totalDv: number;
  /** Propellant fraction of the initial mass for the whole budget in one stage at the Isp (rocket equation). */
  propFraction: number;
  /** Cumulative mass remaining (fraction of the departure mass) after each leg. */
  massAfter: number[];
  minTofS: number;
}

/**
 * The patched-conic lunar budget (Bate, Mueller & White ch. 7, simplified): a coplanar geocentric conic from a circular
 * parking orbit to the Moon's distance; the Moon on a circular orbit; the arrival patched AT THE MOON'S DISTANCE (not
 * at the sphere-of-influence boundary) so the lunar hyperbola's excess is the difference of the two velocities there;
 * lunar orbit insertion into a circular orbit at periapsis; descent as a Hohmann from that orbit to the surface plus a
 * braking burn and a gravity-loss allowance; ascent the reverse; trans-Earth injection equal to insertion by symmetry.
 */
export function lunarMission(inp: LunarInput): LunarResult | OrbitFail {
  const muE = GM_SI.earth;
  const muM = GM_SI.moon;
  const RE = R_EQ_SI.earth;
  const RM = R_EQ_SI.moon;
  if (!(inp.parkAltM >= 0)) return fail("The parking-orbit altitude must be zero or more (below zero is inside Earth).");
  if (!(inp.lloAltM > 0)) return fail("The lunar orbit altitude must be above zero (zero or below is inside the Moon).");
  if (!(inp.moonDistM > 3e8 && inp.moonDistM < 4.2e8)) return fail("The Earth–Moon distance must be between 300 000 and 420 000 km (the real range is about 356 500 to 406 700 km).");
  for (const [n, v] of [["descent gravity-loss allowance", inp.descentLossMs], ["ascent gravity-loss allowance", inp.ascentLossMs], ["mid-course allowance", inp.mccMs]] as Array<[string, number]>) {
    if (!(v >= 0) || v > 3000) return fail(`The ${n} must be between 0 and 3 km/s.`);
  }
  if (!(inp.ispS > 0 && inp.ispS <= 10000)) return fail("The specific impulse must be above 0 and at most 10 000 s.");
  const r0 = RE + inp.parkAltM;
  const D = inp.moonDistM;
  if (r0 >= D) return fail("The parking orbit is at or beyond the Moon's distance.");
  const vc0 = Math.sqrt(muE / r0);
  // Time from perigee to radius D on the conic with perigee r0 and perigee speed vp.
  const tToD = (vp: number): { t: number; e: number; ra: number | null } => {
    const h = r0 * vp;
    const p = (h * h) / muE;
    const e = p / r0 - 1;
    const cosNu = (p / D - 1) / e;
    if (!(cosNu >= -1 && cosNu <= 1)) return { t: Infinity, e, ra: e < 1 ? p / (1 - e) : null };
    const nu = Math.acos(cosNu);
    return { t: timeSincePeriapsis(muE, p, e, nu), e, ra: e < 1 ? p / (1 - e) : null };
  };
  const vHoh = Math.sqrt(muE * (2 / r0 - 2 / (r0 + D)));
  // A Hohmann apogee exactly at D gives ν = 180°: its time is half the transfer period.
  const aH = (r0 + D) / 2;
  const tHoh = Math.PI * Math.sqrt((aH * aH * aH) / muE);
  let vp = vHoh;
  let tof = tHoh;
  const vEsc = Math.sqrt((2 * muE) / r0);
  const tFast = tToD(vEsc * 1.6).t;
  if (inp.tofS !== null) {
    if (!(inp.tofS > 0)) return fail("The flight time must be greater than zero.");
    if (inp.tofS > tHoh * (1 + 1e-9)) return fail(`A ${(inp.tofS / DAY_S).toFixed(2)}-day flight is longer than the minimum-energy transfer (${(tHoh / DAY_S).toFixed(2)} days): the Moon's distance is the apogee there, and a slower conic never reaches it.`);
    if (inp.tofS < tFast) return fail(`A ${(inp.tofS / DAY_S).toFixed(2)}-day flight needs a perigee speed above 1.6 times escape; this calculator stops there (the Moon's own pull, ignored here, dominates such a fast pass).`);
    if (inp.tofS < tHoh * (1 - 1e-9)) {
      const root = guardedRoot((v) => tToD(v).t - (inp.tofS as number), null, vHoh * (1 + 1e-12), vEsc * 1.6, vHoh * 1.001, 1e-13, 200);
      if (!root) return fail("The translunar conic for that flight time did not converge.");
      vp = root.x;
      tof = inp.tofS;
    }
  }
  const conic = tToD(vp);
  const h = r0 * vp;
  const p = (h * h) / muE;
  const eT = p / r0 - 1;
  // Velocity at D in the Earth frame: transverse h/D, radial from the energy.
  const vAtD = Math.sqrt(Math.max(0, vp * vp - 2 * muE / r0 + 2 * muE / D));
  const vTrans = h / D;
  const vRad = Math.sqrt(Math.max(0, vAtD * vAtD - vTrans * vTrans));
  const vMoon = Math.sqrt((muE + muM) / D);
  const vinf = Math.sqrt((vTrans - vMoon) ** 2 + vRad * vRad);
  const rL = RM + inp.lloAltM;
  const vLLO = Math.sqrt(muM / rL);
  const loi = Math.sqrt(vinf * vinf + (2 * muM) / rL) - vLLO;
  // Descent: Hohmann from rL to the surface (deorbit), then brake from the periapsis speed to rest.
  const aD = (rL + RM) / 2;
  const deorbit = vLLO - Math.sqrt(muM * (2 / rL - 1 / aD));
  const brake = Math.sqrt(muM * (2 / RM - 1 / aD));
  const descentIdeal = deorbit + brake;
  const ascentIdeal = descentIdeal;
  const tei = loi;
  const legs: LunarLeg[] = [];
  legs.push({ name: "Trans-lunar injection", dv: vp - vc0, note: "from the circular parking orbit" });
  if (inp.mccMs > 0) legs.push({ name: "Mid-course corrections (out)", dv: inp.mccMs, note: "allowance" });
  legs.push({ name: "Lunar orbit insertion", dv: loi, note: `into a ${(inp.lloAltM / 1000).toFixed(0)} km circular orbit` });
  if (inp.landing) {
    legs.push({ name: "Descent to the surface", dv: descentIdeal + inp.descentLossMs, note: `ideal ${(descentIdeal / 1000).toFixed(3)} km/s plus the gravity-loss allowance` });
    legs.push({ name: "Ascent to lunar orbit", dv: ascentIdeal + inp.ascentLossMs, note: `ideal ${(ascentIdeal / 1000).toFixed(3)} km/s plus the gravity-loss allowance` });
  }
  legs.push({ name: "Trans-Earth injection", dv: tei, note: "equal to insertion by symmetry" });
  if (inp.mccMs > 0) legs.push({ name: "Mid-course corrections (back)", dv: inp.mccMs, note: "allowance" });
  const total = legs.reduce((s, l) => s + l.dv, 0);
  const ve = inp.ispS * 9.80665;
  const massAfter: number[] = [];
  let m = 1;
  for (const l of legs) {
    m *= Math.exp(-l.dv / ve);
    massAfter.push(m);
  }
  const soi = D * Math.pow(muM / muE, 0.4);
  return {
    ok: true, tliDv: vp - vc0, tofS: tof, vTli: vp, apogeeM: conic.ra, e: eT, vinfMoon: vinf, soiM: soi, loiDv: loi,
    descentIdeal, ascentIdeal, teiDv: tei, legs, totalDv: total, propFraction: 1 - Math.exp(-total / ve), massAfter, minTofS: tFast,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Orbit changes
// ---------------------------------------------------------------------------------------------------------------

/** Pure plane change at speed v through Δi: 2v sin(Δi/2). */
export const planeChangeDv = (v: number, di: number): number => 2 * v * Math.sin(Math.abs(di) / 2);
/** One burn that changes speed from v1 to v2 and the plane by Δi (law of cosines). */
export const combinedDv = (v1: number, v2: number, di: number): number => Math.sqrt(Math.max(0, v1 * v1 + v2 * v2 - 2 * v1 * v2 * Math.cos(di)));

/** Hohmann Δv between circular radii, in units of the inner circular speed, for a ratio R = r2/r1. */
export function hohmannDvNorm(R: number): number {
  return Math.abs(Math.sqrt((2 * R) / (1 + R)) - 1) + Math.abs(Math.sqrt(1 / R) - Math.sqrt(2 / (R * (1 + R))));
}
/** Bi-elliptic Δv (three burns) normalised by the inner circular speed: ratios R = r2/r1 and Rb = rb/r1 (rb ≥ r2). */
export function biellipticDvNorm(R: number, Rb: number): number {
  const b1 = Math.sqrt((2 * Rb) / (1 + Rb)) - 1;
  const b2 = Math.sqrt(2 / Rb) * (Math.sqrt(R / (R + Rb)) - Math.sqrt(1 / (1 + Rb)));
  const b3 = Math.sqrt(2 / R) * Math.sqrt(Rb / (R + Rb)) - Math.sqrt(1 / R);
  return Math.abs(b1) + Math.abs(b2) + Math.abs(b3);
}
/** Bi-elliptic with rb → ∞ (the parabolic limit): (√2 − 1)(1 + 1/√R). */
export const biellipticInfNorm = (R: number): number => (Math.SQRT2 - 1) * (1 + 1 / Math.sqrt(R));

/**
 * The two bi-elliptic thresholds, as roots (not typed): R₁ ≈ 11.94, below which Hohmann always wins (where the rb → ∞
 * bi-elliptic first matches Hohmann; the root of R³ − (7 + 4√2)R² + (3 + 4√2)R − 1), and R₂ ≈ 15.58, above which every
 * bi-elliptic beats it (the root of R³ − 15R² − 9R − 1, where the slope of the bi-elliptic cost at rb = r2 turns
 * negative). Both solved by the bracketed root-finder and cross-checked against the direct Δv comparison in the tests.
 */
export function biellipticThresholds(): { r1: number; r2: number } {
  const s2 = Math.SQRT2;
  const a = guardedRoot((R) => R ** 3 - (7 + 4 * s2) * R ** 2 + (3 + 4 * s2) * R - 1, null, 5, 14, 12, 1e-15, 200);
  const b = guardedRoot((R) => R ** 3 - 15 * R ** 2 - 9 * R - 1, null, 14, 20, 15.6, 1e-15, 200);
  return { r1: a ? a.x : NaN, r2: b ? b.x : NaN };
}

export interface PhasingResult {
  ok: true;
  periodTarget: number;
  periodPhasing: number;
  aPhasing: number;
  /** The phasing orbit's other apsis radius, m. */
  otherApsis: number;
  dvTotal: number;
  /** Time spent phasing, s. */
  timeS: number;
  lower: boolean;
}

/**
 * Phasing for a target `leadRad` ahead (positive) or behind (negative) in the same circular orbit of radius r, over
 * `revs` revolutions of the phasing orbit: T_ph = T(1 − lead/(2π·revs)). One burn into the phasing ellipse and one
 * out, each |v_circ − v_ph(r)|. Refused when the phasing ellipse would pass below `minRadius` (the surface).
 */
export function phasing(mu: number, r: number, leadRad: number, revs: number, minRadius: number): PhasingResult | OrbitFail {
  if (!(revs >= 1 && Number.isInteger(revs))) return fail("The number of phasing revolutions must be a whole number of 1 or more.");
  if (!(Math.abs(leadRad) < TWO_PI) || leadRad === 0) return fail("The lead angle must be nonzero and less than 360° in size (positive: the target is ahead).");
  const T = TWO_PI * Math.sqrt((r * r * r) / mu);
  const Tph = T * (1 - leadRad / (TWO_PI * revs));
  const aph = Math.cbrt(mu * (Tph / TWO_PI) ** 2);
  const other = 2 * aph - r;
  if (other < minRadius) return fail(`One phasing revolution would drop the orbit to ${((other - minRadius) / 1000).toFixed(0)} km altitude, inside the body. Spread the phasing over more revolutions (try ${Math.ceil(revs * 2)}).`);
  const vc = Math.sqrt(mu / r);
  const vph = Math.sqrt(mu * (2 / r - 1 / aph));
  return { ok: true, periodTarget: T, periodPhasing: Tph, aPhasing: aph, otherApsis: other, dvTotal: 2 * Math.abs(vc - vph), timeS: revs * Tph, lower: Tph < T };
}

// ---------------------------------------------------------------------------------------------------------------
// J2 perturbations and the special orbits
// ---------------------------------------------------------------------------------------------------------------

export interface J2Rates {
  /** Mean motion (two-body), rad/s. */
  n: number;
  /** Nodal regression Ω̇, rad/s. */
  raanDot: number;
  /** Apsidal precession ω̇, rad/s. */
  argpDot: number;
  /** Mean-anomaly drift Ṁ − n, rad/s. */
  mDot: number;
  /** Nodal (draconitic) period, s: 2π/(n + Ṁ₀ + ω̇). */
  nodalPeriod: number;
}

/** First-order secular J2 rates (Vallado eqs. 9-41 and 9-42; Curtis eqs. 4.52 and 4.53). */
export function j2Rates(mu: number, R: number, j2: number, a: number, e: number, i: number): J2Rates {
  const n = Math.sqrt(mu / (a * a * a));
  const p = a * (1 - e * e);
  const k = 1.5 * n * j2 * (R / p) ** 2;
  const ci = Math.cos(i);
  const raanDot = -k * ci;
  const argpDot = 0.5 * k * (5 * ci * ci - 1);
  const mDot = 0.5 * k * Math.sqrt(1 - e * e) * (3 * ci * ci - 1);
  return { n, raanDot, argpDot, mDot, nodalPeriod: TWO_PI / (n + mDot + argpDot) };
}

/** The sun-synchronous inclination at semi-major axis a (Earth), rad, or null when no inclination is fast enough. */
export function ssoInclination(a: number, e = 0): number | null {
  const mu = GM_SI.earth;
  const R = R_EQ_SI.earth;
  const n = Math.sqrt(mu / (a * a * a));
  const p = a * (1 - e * e);
  const c = -SUN_MEAN_RATE / (1.5 * n * J2.earth * (R / p) ** 2);
  return c >= -1 && c <= 1 ? Math.acos(c) : null;
}

/** The critical inclinations where ω̇ = 0: arccos(±1/√5), 63.43° and 116.57°. */
export const CRITICAL_INC = Math.acos(1 / Math.sqrt(5));

/** The geostationary radius (μ/ω²)^(1/3), m: the sidereal rotation rate, two-body. */
export const geoRadius = (): number => Math.cbrt(GM_SI.earth / (OMEGA_EARTH * OMEGA_EARTH));

export interface RepeatTrack {
  /** Revolutions per repeat cycle and days per cycle. */
  revs: number;
  days: number;
  /** The circular altitude (m) for this exact repeat at the inclination. */
  altitudeM: number;
}

/** Westward shift of the ground track per nodal period (rad of longitude) for a circular Earth orbit. */
export function trackShift(a: number, i: number): { shift: number; rates: J2Rates } {
  const rates = j2Rates(GM_SI.earth, R_EQ_SI.earth, J2.earth, a, 0, i);
  return { shift: (OMEGA_EARTH - rates.raanDot) * rates.nodalPeriod, rates };
}

/**
 * Repeat ground tracks near an altitude: revs/days = 2π/shift. For each cycle length up to `maxDays`, the integer
 * revolution count nearest the current orbit's, and the exact circular altitude (J2 included) that repeats with it.
 * Sorted by how close the altitude is.
 */
export function repeatTracks(altM: number, i: number, maxDays: number): RepeatTrack[] {
  const R = R_EQ_SI.earth;
  const perDay = (a: number): number => (TWO_PI / trackShift(a, i).shift) ; // revolutions per (nodal) day
  const here = perDay(R + altM);
  const out: RepeatTrack[] = [];
  const dMax = Number.isFinite(maxDays) ? Math.max(1, Math.min(60, Math.floor(maxDays))) : 16;
  for (let d = 1; d <= dMax; d++) {
    const rv = Math.round(here * d);
    if (rv < 1) continue;
    // Skip non-reduced ratios (they repeat earlier with the smaller pair).
    const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
    if (gcd(rv, d) !== 1) continue;
    const target = rv / d;
    const root = guardedRoot((a) => perDay(a) - target, null, R + 100e3, R + 40000e3, R + altM, 1e-13, 200);
    if (root) out.push({ revs: rv, days: d, altitudeM: root.x - R });
  }
  return out.sort((x, y) => Math.abs(x.altitudeM - altM) - Math.abs(y.altitudeM - altM));
}

/**
 * Sub-satellite points (longitude, latitude in rad) of a circular Earth orbit over `orbits` nodal periods, starting at
 * the ascending node at longitude 0: node regression and Earth rotation included, spherical Earth, geocentric latitude.
 */
export function groundTrack(a: number, i: number, orbits: number, perOrbit = 180): Array<{ lon: number; lat: number }> {
  if (![a, i, orbits, perOrbit].every((x) => typeof x === "number" && Number.isFinite(x)) || !(a > 0)) return [];
  const { rates } = trackShift(a, i);
  const pts: Array<{ lon: number; lat: number }> = [];
  // Bounded whatever the caller passes: at most 50 orbits and 20 000 points.
  const orb = Number.isFinite(orbits) ? Math.max(0.01, Math.min(50, orbits)) : 3;
  const N = Math.max(2, Math.min(20000, Math.round(orb * (Number.isFinite(perOrbit) ? perOrbit : 180))));
  const Tn = rates.nodalPeriod;
  const uRate = TWO_PI / Tn;
  for (let k = 0; k <= N; k++) {
    const t = (orb * Tn * k) / N;
    const u = uRate * t;
    const lat = Math.asin(Math.sin(i) * Math.sin(u));
    const dl = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u));
    const lon = wrapPi(dl + rates.raanDot * t - OMEGA_EARTH * t);
    pts.push({ lon, lat });
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// Circular restricted three-body problem
// ---------------------------------------------------------------------------------------------------------------

export interface PairDef {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  /** GM of the primary and the secondary, m³/s². */
  mu1: number;
  mu2: number;
  /** Separation, m. */
  dist: number;
  note: string;
}

export const PAIRS: PairDef[] = [
  { id: "earth-moon", label: "Earth–Moon", primary: "Earth", secondary: "Moon", mu1: GM_SI.earth, mu2: GM_SI.moon, dist: 3.844e8, note: "mean distance 384 400 km" },
  { id: "sun-earth", label: "Sun–Earth", primary: "Sun", secondary: "Earth + Moon", mu1: GM_SI.sun, mu2: GM_SI.earth + GM_SI.moon, dist: STANDISH_T1.emb.el[0] * AU_M, note: "the Earth–Moon system as one mass at the Standish semi-major axis" },
  ...["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"].map((p) => ({
    id: `sun-${p}`,
    label: `Sun–${p[0].toUpperCase()}${p.slice(1)}`,
    primary: "Sun",
    secondary: `${p[0].toUpperCase()}${p.slice(1)}`,
    mu1: GM_SI.sun,
    mu2: GM_SI[p],
    dist: STANDISH_T1[p].el[0] * AU_M,
    note: `Standish semi-major axis${p === "jupiter" || p === "neptune" ? "; GM is the planet-plus-moons system value" : ""}`,
  })),
];

/** The CR3BP x-axis force balance in units of the separation, origin at the barycentre (primary at −μ). */
function collinearF(mu: number, x: number): number {
  const r1 = x + mu;
  const r2 = x - 1 + mu;
  return x - ((1 - mu) * r1) / Math.abs(r1) ** 3 - (mu * r2) / Math.abs(r2) ** 3;
}

export interface LagrangeResult {
  ok: true;
  mu: number;
  /** Normalised x of L1, L2, L3 (barycentric, separation = 1), and L4/L5 at (0.5 − μ, ±√3/2). */
  xL: [number, number, number];
  /** Jacobi constants of L1…L5 (L4 = L5 = 3 − μ + μ², in the convention C = x² + y² + 2(1−μ)/r₁ + 2μ/r₂ − v²). */
  cL: [number, number, number, number, number];
  /** Routh's criterion: L4/L5 linearly stable when μ < 0.03852. */
  triangularStable: boolean;
}

/** The ratio μ₂/(μ₁ + μ₂) of Routh's stability limit, (1 − √(23/27))/2. */
export const ROUTH_MU = (1 - Math.sqrt(23 / 27)) / 2;

export function lagrange(mu: number): LagrangeResult | OrbitFail {
  if (!(mu > 0 && mu <= 0.5)) return fail("The mass ratio μ₂/(μ₁ + μ₂) must be above 0 and at most 0.5 (the smaller mass is the secondary).");
  const eps = 1e-12;
  const p1 = -mu;
  const p2 = 1 - mu;
  // L1 between the primaries, L2 beyond the secondary, L3 beyond the primary: the force balance changes sign once in
  // each interval (it runs from −∞ to +∞ between consecutive poles), so each root is bracketed exactly.
  const L1 = guardedRoot((x) => collinearF(mu, x), null, p1 + eps, p2 - eps, p2 - Math.cbrt(mu / 3), 1e-15, 300);
  const L2 = guardedRoot((x) => collinearF(mu, x), null, p2 + eps, 3, p2 + Math.cbrt(mu / 3), 1e-15, 300);
  const L3 = guardedRoot((x) => collinearF(mu, x), null, -3, p1 - eps, -1 - (5 * mu) / 12, 1e-15, 300);
  if (!L1 || !L2 || !L3) return fail("The collinear Lagrange-point equations did not converge for this mass ratio.");
  const C = (x: number, y: number): number => x * x + y * y + (2 * (1 - mu)) / Math.hypot(x + mu, y) + (2 * mu) / Math.hypot(x - 1 + mu, y);
  const c4 = C(0.5 - mu, Math.sqrt(3) / 2);
  return { ok: true, mu, xL: [L1.x, L2.x, L3.x], cL: [C(L1.x, 0), C(L2.x, 0), C(L3.x, 0), c4, c4], triangularStable: mu < ROUTH_MU };
}

/** Jacobi constant of a normalised rotating-frame state (barycentric, separation 1, angular rate 1). */
export function jacobi(mu: number, x: number, y: number, vx: number, vy: number): number {
  return x * x + y * y + (2 * (1 - mu)) / Math.hypot(x + mu, y) + (2 * mu) / Math.hypot(x - 1 + mu, y) - vx * vx - vy * vy;
}

/** 2Ω(x, y) on the plane z = 0 (the zero-velocity surface value), normalised. */
export function twoOmega(mu: number, x: number, y: number): number {
  return x * x + y * y + (2 * (1 - mu)) / Math.hypot(x + mu, y) + (2 * mu) / Math.hypot(x - 1 + mu, y);
}

/** Hill sphere a(1 − e)·∛(m/(3M)), Laplace sphere of influence a(m/M)^(2/5), m. */
export const hillRadius = (a: number, e: number, mu1: number, mu2: number): number => a * (1 - e) * Math.cbrt(mu2 / (3 * mu1));
export const soiRadius = (a: number, mu1: number, mu2: number): number => a * Math.pow(mu2 / mu1, 0.4);

/**
 * Roche limits for a satellite of density ρ_s about a primary of radius R and density ρ_M: rigid d = R·∛(2ρ_M/ρ_s)
 * (≈ 1.26 R(ρ_M/ρ_s)^(1/3)), fluid d ≈ 2.44 R(ρ_M/ρ_s)^(1/3) (Chandrasekhar's 2.455 for a synchronously rotating fluid
 * body is quoted beside it).
 */
export function rocheLimits(R: number, rhoPrimary: number, rhoSat: number): { rigid: number; fluid: number; fluidChandra: number } {
  const k = Math.cbrt(rhoPrimary / rhoSat);
  return { rigid: R * Math.cbrt(2) * k, fluid: 2.44 * R * k, fluidChandra: 2.455 * R * k };
}

/** Mean density of a body from GM and mean radius, kg/m³. */
export function bodyDensity(mu: number, Rmean: number): number {
  return mu / G_NEWTON / ((4 / 3) * Math.PI * Rmean ** 3);
}

