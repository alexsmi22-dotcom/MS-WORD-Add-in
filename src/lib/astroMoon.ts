// Astronomy & lunar, part 4: the Moon's phases, age and libration, perigee and apogee, and eclipses, all found from
// the positions of astroBodies.ts (Meeus ch. 47 Moon, truncated VSOP87 Sun) by root-finding rather than from a
// second set of mean-phase series. Times are TT Julian Dates; the pane converts them to UTC.
//
// DEFINITIONS (stated in every result that uses them):
//   - Phase: the apparent geocentric ecliptic longitude of the Moon minus that of the Sun, 0° new, 90° first quarter,
//     180° full, 270° last quarter (the almanac definition; skyfield's moon_phases is the same).
//   - Phase name: new / first quarter / full / last quarter within ±6° of elongation (about ±12 hours) of the
//     instant, crescent or gibbous waxing or waning otherwise.
//   - Supermoon: a full Moon whose centre is under 360 000 km from the Earth's centre (no official definition exists;
//     this is a common one). Micromoon: a full Moon beyond 405 000 km.
//   - Lunar eclipses: the Earth's shadow by Danjon's method (NASA's convention since 2009: the geocentric parallax
//     enlarged by 1 %), penumbral and umbral magnitudes as fractions of the Moon's diameter.
//   - Solar eclipses: γ is the least distance of the shadow axis from the Earth's centre in equatorial radii; the
//     type and magnitude come from the umbral and penumbral cones at the fundamental plane (Meeus ch. 54 criteria,
//     with Meeus's 0.9972 for the Earth's flattening). Local circumstances (where it is seen) are NOT computed.
//   - Libration: optical libration in longitude and latitude, Meeus ch. 53 (physical libration, under 0.04°, left out).

import { apparentPlace, AU_KM, EARTH_EQ_RADIUS_KM, earthHelioEqJ2000, MOON_RADIUS_KM, moonJ2000Eq, moonMeeus, SUN_RADIUS_KM, type Place } from "./astroBodies";
import { angleBetween, dot, norm, scale, sub, type Vec3 } from "./astroCoords";
import { centuriesTT, DEG } from "./astroTime";

const SYNODIC = 29.530588853;
const wrap180 = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;

/** Elongation in longitude, Moon minus Sun, degrees in [0, 360). */
export function phaseAngleLongitude(jdTT: number): number {
  const m = apparentPlace("moon", jdTT);
  const s = apparentPlace("sun", jdTT);
  return ((((m.eclLon - s.eclLon) / DEG) % 360) + 360) % 360;
}

export const PHASE_NAMES = ["New Moon", "First quarter", "Full Moon", "Last quarter"] as const;

export interface PhaseEvent {
  /** 0 new, 1 first quarter, 2 full, 3 last quarter. */
  phase: 0 | 1 | 2 | 3;
  jdTT: number;
}

/** Bisection on g over [a, b] (g(a) < 0 ≤ g(b)) to about 0.01 s. */
function bisect(a: number, b: number, g: (t: number) => number): number {
  let lo = a, hi = b;
  for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
    const m = (lo + hi) / 2;
    if (g(m) < 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** The principal phases in [jd0, jd1) (TT), in time order. */
export function phasesBetween(jd0: number, jd1: number): PhaseEvent[] {
  const out: PhaseEvent[] = [];
  const step = 0.5;
  let t0 = jd0;
  let e0 = phaseAngleLongitude(t0);
  while (t0 < jd1) {
    const t1 = Math.min(t0 + step, jd1);
    const e1 = phaseAngleLongitude(t1);
    for (let k = 0; k < 4; k++) {
      const d0 = wrap180(e0 - 90 * k);
      const d1 = wrap180(e1 - 90 * k);
      if (d0 < 0 && d1 >= 0 && d1 - d0 < 90) {
        const t = bisect(t0, t1, (t) => wrap180(phaseAngleLongitude(t) - 90 * k));
        if (t >= jd0 && t < jd1) out.push({ phase: k as 0 | 1 | 2 | 3, jdTT: t });
      }
    }
    t0 = t1;
    e0 = e1;
  }
  return out.sort((a, b) => a.jdTT - b.jdTT);
}

/** The next instant of a given principal phase after jd (TT). */
export function nextPhase(jdTT: number, phase: 0 | 1 | 2 | 3): number {
  const ev = phasesBetween(jdTT, jdTT + 31).find((e) => e.phase === phase);
  return (ev as PhaseEvent).jdTT;
}

/** The previous New Moon at or before jd (TT). */
export function previousNewMoon(jdTT: number): number {
  const ev = phasesBetween(jdTT - 31, jdTT).filter((e) => e.phase === 0);
  return ev[ev.length - 1].jdTT;
}

export interface MoonState {
  moon: Place;
  sun: Place;
  /** Elongation in longitude, Moon − Sun (deg, 0–360). */
  elongLon: number;
  /** Phase angle Sun–Moon–Earth (rad). */
  phaseAngle: number;
  illuminated: number;
  waxing: boolean;
  name: string;
  /** Days since the previous New Moon. */
  ageDays: number;
  /** Apparent angular diameter, geocentric (rad). */
  diameter: number;
}

export function phaseName(elongLon: number): string {
  const tol = 6;
  if (elongLon < tol || elongLon > 360 - tol) return "New Moon";
  if (Math.abs(elongLon - 90) < tol) return "First quarter";
  if (Math.abs(elongLon - 180) < tol) return "Full Moon";
  if (Math.abs(elongLon - 270) < tol) return "Last quarter";
  if (elongLon < 90) return "Waxing crescent";
  if (elongLon < 180) return "Waxing gibbous";
  if (elongLon < 270) return "Waning gibbous";
  return "Waning crescent";
}

export function moonState(jdTT: number): MoonState {
  const moon = apparentPlace("moon", jdTT);
  const sun = apparentPlace("sun", jdTT);
  const elongLon = ((((moon.eclLon - sun.eclLon) / DEG) % 360) + 360) % 360;
  const illuminated = (1 + Math.cos(moon.phaseAngle)) / 2;
  return {
    moon,
    sun,
    elongLon,
    phaseAngle: moon.phaseAngle,
    illuminated,
    waxing: elongLon < 180,
    name: phaseName(elongLon),
    ageDays: jdTT - previousNewMoon(jdTT),
    diameter: 2 * Math.asin(MOON_RADIUS_KM / moon.distKm),
  };
}

/** The lit fraction and whether the Moon is waxing, without the age search (for calendars). */
export function moonLit(jdTT: number): { illuminated: number; waxing: boolean } {
  const moon = apparentPlace("moon", jdTT);
  const sun = apparentPlace("sun", jdTT);
  const e = ((((moon.eclLon - sun.eclLon) / DEG) % 360) + 360) % 360;
  return { illuminated: (1 + Math.cos(moon.phaseAngle)) / 2, waxing: e < 180 };
}

/** Optical libration (deg) in longitude l′ and latitude b′, Meeus ch. 53. */
export function libration(jdTT: number): { l: number; b: number } {
  const T = centuriesTT(jdTT);
  const m = moonMeeus(jdTT);
  const F = (93.272095 + T * (483202.0175233 + T * (-0.0036539 + T * (-1 / 3526000 + T / 863310000)))) * DEG;
  const Om = (125.0445479 + T * (-1934.1362891 + T * (0.0020754 + T * (1 / 467441 - T / 60616000)))) * DEG;
  const I = 1.54242 * DEG;
  const W = m.lon - Om; // Meeus: λ − Δψ − Ω, with λ the apparent longitude; m.lon is the mean-equinox longitude.
  const A = Math.atan2(Math.sin(W) * Math.cos(m.lat) * Math.cos(I) - Math.sin(m.lat) * Math.sin(I), Math.cos(W) * Math.cos(m.lat));
  const l = wrap180((A - F) / DEG);
  const b = Math.asin(-Math.sin(W) * Math.cos(m.lat) * Math.sin(I) - Math.sin(m.lat) * Math.cos(I)) / DEG;
  return { l, b };
}

// ---------------------------------------------------------------------------------------------------------------
// Perigee and apogee
// ---------------------------------------------------------------------------------------------------------------

export interface Apsis {
  kind: "perigee" | "apogee";
  jdTT: number;
  distKm: number;
}

/** Golden-section search for the extremum of f in [a, b]; sign +1 finds a minimum, −1 a maximum. */
function extremum(f: (t: number) => number, a: number, b: number, sign: 1 | -1): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a);
  let f1 = sign * f(x1), f2 = sign * f(x2);
  for (let i = 0; i < 60 && b - a > 1e-6; i++) {
    if (f1 < f2) {
      b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = sign * f(x1);
    } else {
      a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = sign * f(x2);
    }
  }
  return (a + b) / 2;
}

/** Perigees and apogees in [jd0, jd1) (TT): extrema of the ch. 47 geocentric distance. */
export function apsidesBetween(jd0: number, jd1: number): Apsis[] {
  const out: Apsis[] = [];
  const step = 0.25;
  const d = (t: number): number => moonMeeus(t).distKm;
  let tPrev = jd0 - step, dPrev = d(tPrev), t = jd0, dCur = d(t);
  while (t < jd1) {
    const tNext = t + step;
    const dNext = d(tNext);
    if (dCur < dPrev && dCur <= dNext) {
      const te = extremum(d, tPrev, tNext, 1);
      if (te >= jd0 && te < jd1) out.push({ kind: "perigee", jdTT: te, distKm: d(te) });
    } else if (dCur > dPrev && dCur >= dNext) {
      const te = extremum(d, tPrev, tNext, -1);
      if (te >= jd0 && te < jd1) out.push({ kind: "apogee", jdTT: te, distKm: d(te) });
    }
    tPrev = t; dPrev = dCur; t = tNext; dCur = dNext;
  }
  return out;
}

export const SUPERMOON_KM = 360000;
export const MICROMOON_KM = 405000;

// ---------------------------------------------------------------------------------------------------------------
// Eclipses
// ---------------------------------------------------------------------------------------------------------------

export type LunarEclipseType = "penumbral" | "partial" | "total";
export interface LunarEclipse {
  type: LunarEclipseType;
  /** Greatest eclipse, TT. */
  jdTT: number;
  umbralMag: number;
  penumbralMag: number;
}

/** The Earth's shadow at the Moon (Danjon) and the Moon's distance from its axis, at a TT instant. */
function lunarGeometry(jdTT: number): { sep: number; umbra: number; penumbra: number; moonR: number } {
  const moon = apparentPlace("moon", jdTT);
  const sun = apparentPlace("sun", jdTT);
  const sep = Math.PI - angleBetween(moon.dir, sun.dir);
  const piM = EARTH_EQ_RADIUS_KM / moon.distKm;
  const piS = EARTH_EQ_RADIUS_KM / sun.distKm;
  const sS = SUN_RADIUS_KM / sun.distKm;
  return { sep, umbra: 1.01 * piM + piS - sS, penumbra: 1.01 * piM + piS + sS, moonR: Math.asin(MOON_RADIUS_KM / moon.distKm) };
}

/** The lunar eclipse at a full Moon (TT), or null if the Moon misses the penumbra. */
export function lunarEclipseAt(fullTT: number): LunarEclipse | null {
  const t = extremum((x) => lunarGeometry(x).sep, fullTT - 0.25, fullTT + 0.25, 1);
  const g = lunarGeometry(t);
  const pen = (g.penumbra + g.moonR - g.sep) / (2 * g.moonR);
  if (pen <= 0) return null;
  const um = (g.umbra + g.moonR - g.sep) / (2 * g.moonR);
  const type: LunarEclipseType = g.sep < g.umbra - g.moonR ? "total" : g.sep < g.umbra + g.moonR ? "partial" : "penumbral";
  return { type, jdTT: t, umbralMag: um, penumbralMag: pen };
}

export type SolarEclipseType = "partial" | "annular" | "total" | "hybrid";
export interface SolarEclipse {
  type: SolarEclipseType;
  central: boolean;
  /** Greatest eclipse (least axis distance), TT. */
  jdTT: number;
  /** Signed γ, Earth equatorial radii (positive: the axis passes north of the Earth's centre). */
  gamma: number;
  magnitude: number;
}

/** Shadow-axis geometry at a TT instant: γ, and the cone radii (km) at the fundamental plane and at the surface. */
function solarGeometry(jdTT: number): { gamma: number; zSign: number; ruPlane: number; ruSurface: number; rpPlane: number; dMoonSurf: number; dSunSurf: number } {
  const moon: Vec3 = moonJ2000Eq(jdTT);
  const sun: Vec3 = scale(earthHelioEqJ2000(jdTT), -AU_KM);
  const axisV = sub(moon, sun);
  const D = norm(axisV);
  const a = scale(axisV, 1 / D);
  const perp = sub(moon, scale(a, dot(moon, a)));
  const gamma = norm(perp) / EARTH_EQ_RADIUS_KM;
  const z = -dot(moon, a); // Moon to the fundamental plane along the axis, km
  const tanU = Math.tan(Math.asin((SUN_RADIUS_KM - MOON_RADIUS_KM) / D));
  const tanP = Math.tan(Math.asin((SUN_RADIUS_KM + MOON_RADIUS_KM) / D));
  const depth = gamma < 1 ? Math.sqrt(1 - gamma * gamma) * EARTH_EQ_RADIUS_KM : 0;
  const zs = z - depth;
  const sunDist = norm(sun);
  return {
    gamma,
    zSign: Math.sign(perp[2]) || 1,
    ruPlane: MOON_RADIUS_KM - z * tanU,
    ruSurface: MOON_RADIUS_KM - zs * tanU,
    rpPlane: MOON_RADIUS_KM + z * tanP,
    dMoonSurf: zs,
    dSunSurf: sunDist - depth,
  };
}

/** The solar eclipse at a New Moon (TT), or null if the penumbra misses the Earth. */
export function solarEclipseAt(newTT: number): SolarEclipse | null {
  const t = extremum((x) => solarGeometry(x).gamma, newTT - 0.25, newTT + 0.25, 1);
  const g = solarGeometry(t);
  const L1 = g.rpPlane / EARTH_EQ_RADIUS_KM;
  const L2 = g.ruPlane / EARTH_EQ_RADIUS_KM;
  if (g.gamma > 0.9972 + L1) return null;
  const signed = g.gamma * g.zSign;
  if (g.gamma < 0.9972) {
    const type: SolarEclipseType = g.ruSurface > 0 ? (g.ruPlane < 0 ? "hybrid" : "total") : "annular";
    const magnitude = Math.asin(MOON_RADIUS_KM / g.dMoonSurf) / Math.asin(SUN_RADIUS_KM / g.dSunSurf);
    return { type, central: true, jdTT: t, gamma: signed, magnitude };
  }
  if (g.gamma < 0.9972 + Math.abs(L2)) {
    // Non-central: the umbra or antumbra grazes the polar regions while its axis misses the Earth.
    return { type: L2 > 0 ? "total" : "annular", central: false, jdTT: t, gamma: signed, magnitude: (0.9972 + L1 - g.gamma) / (L1 + L2) };
  }
  return { type: "partial", central: false, jdTT: t, gamma: signed, magnitude: (0.9972 + L1 - g.gamma) / (L1 + L2) };
}

/** Eclipses from jd0 (TT) for `days`: each New and Full Moon checked. */
export function eclipsesBetween(jd0: number, jd1: number): { lunar: LunarEclipse[]; solar: SolarEclipse[] } {
  const lunar: LunarEclipse[] = [];
  const solar: SolarEclipse[] = [];
  // Quick latitude screen: an eclipse needs the Moon within ~1.6° of the ecliptic at syzygy.
  for (const ev of phasesBetween(jd0, jd1)) {
    if (ev.phase !== 0 && ev.phase !== 2) continue;
    const lat = Math.abs(moonMeeus(ev.jdTT).lat / DEG);
    if (lat > 1.75) continue;
    if (ev.phase === 2) {
      const e = lunarEclipseAt(ev.jdTT);
      if (e) lunar.push(e);
    } else {
      const e = solarEclipseAt(ev.jdTT);
      if (e) solar.push(e);
    }
  }
  return { lunar, solar };
}

export { SYNODIC };
