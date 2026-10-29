// Astronomy & lunar, part 3: where the Sun, the Moon and the planets are, as seen from the Earth's centre or from a
// site, and when they rise, transit and set.
//
// THEORIES, AND THE ACCURACY MEASURED AGAINST JPL DE421/DE440s (astroOracle.test.ts, 1900–2100):
//   - Moon: Meeus ch. 47 (the 60 + 60 term truncation of ELP-2000/82, tables generated into astroData.ts), mean
//     equinox of date with the light-time constant; nutation in longitude added for the apparent place.
//   - Sun and planets: VSOP87B (Bretagnon & Francou 1988), heliocentric, truncated mechanically by
//     scripts/gen-astro-data.js (1230 of its terms; the threshold is stated on the table). Light time is iterated,
//     annual aberration applied from the Earth's velocity, then IAU 2006 precession and IAU 1980 nutation
//     (astroTime.ts) give the apparent place of date. The FK5 correction of VSOP87's dynamical frame (0.09″) is
//     neglected.
//   - Magnitudes: Mallama & Hilton (2018), "Computing apparent planetary magnitudes for The Astronomical Almanac".
//   - Rise/set: the instant the topocentric centre crosses h₀ = −50′ (Sun: 34′ refraction + 16′ semidiameter), −34′ −
//     the topocentric semidiameter (Moon, radius 1737.1 km), −34′ (planets and stars); standard refraction, sea-level
//     horizon, no dip. Transit: topocentric hour angle zero.

import { MOON_B, MOON_LR, VSOP87 } from "./astroData";
import { bodyById } from "./orbital";
import {
  ARCSEC,
  DEG,
  centuriesTT,
  decimalYear,
  gast,
  matVec,
  meanObliquity,
  norm2pi,
  nutation,
  precessionMatrix,
  precessNutate,
  rotX,
  transpose,
  trueObliquity,
  type Mat3,
} from "./astroTime";
import { aberrate, altAzOf, angleBetween, cross, dot, eclToEq, eqToEcl, norm, scale, siteTrueOfDate, sph, sub, vec, type Site, type Vec3 } from "./astroCoords";

export const AU_KM = 149597870.7;
export const C_KM_S = 299792.458;
/** Light speed in au per day. */
export const C_AU_DAY = (C_KM_S * 86400) / AU_KM;
/** Obliquity of J2000 (IAU 2006), for VSOP87's ecliptic of J2000. */
const EPS_J2000 = 84381.406 * ARCSEC;
const ECL_J2000_TO_EQ: Mat3 = rotX(-EPS_J2000);

export const MOON_RADIUS_KM = 1737.1;
export const SUN_RADIUS_KM = 696000;
export const EARTH_EQ_RADIUS_KM = 6378.137;

/**
 * Years an apparent place is computed for. VSOP87 holds 1″ over ±1000 years for Jupiter and Saturn (longer for the
 * others) before truncation, and ΔT is uncertain by minutes before 1000; outside these years the tools refuse.
 */
export const EPHEMERIS_YEARS = { min: 1000, max: 3000 } as const;
/** Years the oracle comparison covers. */
export const VERIFIED_YEARS = { min: 1900, max: 2100 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Moon (Meeus ch. 47)
// ---------------------------------------------------------------------------------------------------------------

export interface MoonGeo {
  /** Ecliptic longitude, mean equinox of date (rad). */
  lon: number;
  /** Ecliptic latitude (rad). */
  lat: number;
  /** Earth–Moon centre distance, km. */
  distKm: number;
}

/** The geocentric Moon, Meeus ch. 47 (mean equinox of date, light time included as a constant). */
export function moonMeeus(jdTT: number): MoonGeo {
  const T = centuriesTT(jdTT);
  const Lp = (218.3164477 + T * (481267.88123421 + T * (-0.0015786 + T * (1 / 538841 - T / 65194000)))) * DEG;
  const D = (297.8501921 + T * (445267.1114034 + T * (-0.0018819 + T * (1 / 545868 - T / 113065000)))) * DEG;
  const M = (357.5291092 + T * (35999.0502909 + T * (-0.0001536 + T / 24490000))) * DEG;
  const Mp = (134.9633964 + T * (477198.8675055 + T * (0.0087414 + T * (1 / 69699 - T / 14712000)))) * DEG;
  const F = (93.272095 + T * (483202.0175233 + T * (-0.0036539 + T * (-1 / 3526000 + T / 863310000)))) * DEG;
  const A1 = (119.75 + 131.849 * T) * DEG;
  const A2 = (53.09 + 479264.29 * T) * DEG;
  const A3 = (313.45 + 481266.484 * T) * DEG;
  const E = 1 - T * (0.002516 + 0.0000074 * T);
  const eFac = (m: number): number => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);
  let sl = 3958 * Math.sin(A1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(A2);
  let sr = 0;
  let sb = -2235 * Math.sin(Lp) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lp - Mp) - 115 * Math.sin(Lp + Mp);
  for (const r of MOON_LR) {
    const arg = r[0] * D + r[1] * M + r[2] * Mp + r[3] * F;
    const k = eFac(r[1]);
    sl += r[4] * k * Math.sin(arg);
    sr += r[5] * k * Math.cos(arg);
  }
  for (const r of MOON_B) sb += r[4] * eFac(r[1]) * Math.sin(r[0] * D + r[1] * M + r[2] * Mp + r[3] * F);
  return { lon: norm2pi(Lp + sl * 1e-6 * DEG), lat: sb * 1e-6 * DEG, distKm: 385000.56 + sr / 1000 };
}

/** The Moon's geocentric position vector (km) in the mean equator and equinox of J2000. */
export function moonJ2000Eq(jdTT: number): Vec3 {
  const m = moonMeeus(jdTT);
  const eqDate = matVec(eclToEq(meanObliquity(jdTT)), vec(m.lon, m.lat, m.distKm));
  return matVec(transpose(precessionMatrix(jdTT)), eqDate);
}

// ---------------------------------------------------------------------------------------------------------------
// Planets (VSOP87B, truncated)
// ---------------------------------------------------------------------------------------------------------------

export type PlanetId = "mercury" | "venus" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune";
export type BodyId = "sun" | "moon" | PlanetId;
export const PLANETS: PlanetId[] = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
export const BODY_LABEL: Record<BodyId, string> = {
  sun: "Sun", moon: "Moon", mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune",
};

/** Σ over powers α of τ^α · Σ A cos(B + Cτ), for one VSOP87 coordinate (flat triples per power). */
function vsopSum(series: number[][], tau: number): number {
  let total = 0;
  let tp = 1;
  for (const terms of series) {
    let s = 0;
    for (let i = 0; i < terms.length; i += 3) s += terms[i] * Math.cos(terms[i + 1] + terms[i + 2] * tau);
    total += s * tp;
    tp *= tau;
  }
  return total;
}

/** Heliocentric position (au) in the mean ecliptic and equinox of J2000, truncated VSOP87B. */
export function vsopHelio(id: PlanetId | "earth", jdTT: number): Vec3 {
  const tau = (jdTT - 2451545.0) / 365250;
  const s = VSOP87[id];
  return vec(vsopSum(s.L, tau), vsopSum(s.B, tau), vsopSum(s.R, tau));
}

/** Heliocentric position (au) of a planet in the mean equator and equinox of J2000. */
const helioEqJ2000 = (id: PlanetId, jdTT: number): Vec3 => matVec(ECL_J2000_TO_EQ, vsopHelio(id, jdTT));

/** The Earth's heliocentric position (au), J2000 equatorial (VSOP87B gives the Earth itself, not the barycentre). */
export const earthHelioEqJ2000 = (jdTT: number): Vec3 => matVec(ECL_J2000_TO_EQ, vsopHelio("earth", jdTT));

/** The Earth's heliocentric velocity (au/day), J2000 equatorial, by a central difference over ±0.05 d. */
export function earthVelocityEqJ2000(jdTT: number): Vec3 {
  const h = 0.05;
  return scale(sub(earthHelioEqJ2000(jdTT + h), earthHelioEqJ2000(jdTT - h)), 1 / (2 * h));
}

// ---------------------------------------------------------------------------------------------------------------
// Apparent places
// ---------------------------------------------------------------------------------------------------------------

export interface Place {
  body: BodyId;
  /** Geocentric apparent right ascension and declination, true equator and equinox of date (rad). */
  ra: number;
  dec: number;
  /** Apparent ecliptic longitude and latitude, true ecliptic and equinox of date (rad). */
  eclLon: number;
  eclLat: number;
  /** Distance from the Earth's centre, km (light-time corrected for Sun and planets). */
  distKm: number;
  /** Apparent geocentric direction as a unit vector, true of date. */
  dir: Vec3;
  /** Heliocentric distance of the body (km); 0 for the Sun. */
  helioKm: number;
  /** Phase angle Sun–body–Earth (rad); 0 for the Sun. */
  phaseAngle: number;
}

/** The apparent geocentric place of the Sun, the Moon or a planet at a TT Julian Date. */
export function apparentPlace(body: BodyId, jdTT: number): Place {
  const eps = trueObliquity(jdTT);
  const sunGeo = (): Vec3 => scale(earthHelioEqJ2000(jdTT), -1);
  if (body === "moon") {
    const m = moonMeeus(jdTT);
    const lonApp = norm2pi(m.lon + nutation(jdTT).dpsi);
    const dir = matVec(eclToEq(eps), vec(lonApp, m.lat));
    const s = sph(dir);
    // Phase angle from the geometric vectors (J2000; the frame does not matter for an angle).
    const moonJ = moonJ2000Eq(jdTT);
    const sunJ = scale(sunGeo(), AU_KM);
    const moonToSun = sub(sunJ, moonJ);
    return { body, ra: s.lon, dec: s.lat, eclLon: lonApp, eclLat: m.lat, distKm: m.distKm, dir, helioKm: norm(moonToSun), phaseAngle: angleBetween(moonToSun, scale(moonJ, -1)) };
  }
  const earth = earthHelioEqJ2000(jdTT);
  let g: Vec3 = scale(earth, -1);
  let p: Vec3 = [0, 0, 0];
  if (body !== "sun") {
    let tau = 0;
    for (let k = 0; k < 3; k++) {
      p = helioEqJ2000(body, jdTT - tau);
      g = sub(p, earth);
      tau = norm(g) / C_AU_DAY;
    }
  }
  const u = scale(g, 1 / norm(g));
  const v = scale(earthVelocityEqJ2000(jdTT), 1 / C_AU_DAY);
  const dir = matVec(precessNutate(jdTT), aberrate(u, v));
  const s = sph(dir);
  const e = sph(matVec(eqToEcl(eps), dir));
  return {
    body,
    ra: s.lon,
    dec: s.lat,
    eclLon: e.lon,
    eclLat: e.lat,
    distKm: norm(g) * AU_KM,
    dir,
    helioKm: norm(p) * AU_KM,
    phaseAngle: body === "sun" ? 0 : angleBetween(scale(p, -1), scale(g, -1)),
  };
}

/** Elongation from the Sun (rad), from two apparent places. */
export const elongation = (a: Place, sun: Place): number => angleBetween(a.dir, sun.dir);

/** The illuminated fraction of the disc, (1 + cos i)/2. */
export const illuminatedFraction = (phaseAngle: number): number => (1 + Math.cos(phaseAngle)) / 2;

/** Angular semidiameter (rad) of a body of radius rKm at distance dKm. */
export const semidiameter = (rKm: number, dKm: number): number => Math.asin(Math.min(1, rKm / dKm));

/** Equatorial radii (km) for apparent diameters: IAU WGCCRE 2015 via orbital.ts BODIES where present. */
export function bodyRadiusKm(body: BodyId): number {
  if (body === "sun") return SUN_RADIUS_KM;
  if (body === "moon") return MOON_RADIUS_KM;
  return bodyById(body)!.radius / 1000;
}

/** Planet pole directions (IAU WGCCRE, J2000 equatorial) used by the Saturn and Uranus magnitude terms. */
const SATURN_POLE = vec(40.589 * DEG, 83.537 * DEG);
const URANUS_POLE = vec(257.311 * DEG, -15.175 * DEG);

/**
 * Apparent visual magnitude, Mallama & Hilton (2018), from r (Sun–planet) and Δ (Earth–planet) in au and the phase
 * angle in degrees. Saturn includes its rings (sub-Earth and sub-Sun ring latitudes from the pole). Null where the
 * formulae have no data (Saturn beyond 6.5° phase from the Earth's side, which does not occur geocentrically).
 */
export function planetMagnitude(id: PlanetId, jdTT: number): number | null {
  const earth = earthHelioEqJ2000(jdTT);
  const p = helioEqJ2000(id, jdTT);
  const g = sub(p, earth);
  const r = norm(p);
  const d = norm(g);
  const ph = angleBetween(scale(p, -1), scale(g, -1)) / DEG;
  const five = 5 * Math.log10(r * d);
  switch (id) {
    case "mercury":
      return -0.613 + five + ph * (6.328e-2 + ph * (-1.6336e-3 + ph * (3.3644e-5 + ph * (-3.4265e-7 + ph * (1.6893e-9 + ph * -3.0334e-12)))));
    case "venus":
      return ph < 163.7
        ? -4.384 + five + ph * (-1.044e-3 + ph * (3.687e-4 + ph * (-2.814e-6 + ph * 8.938e-9)))
        : -4.384 + five + 236.05828 + 4.384 + ph * (-2.81914 + ph * 8.39034e-3);
    case "mars":
      return ph <= 50 ? -1.601 + five + ph * (2.267e-2 - 1.302e-4 * ph) : -0.367 + five + ph * (-0.02573 + 0.0003445 * ph);
    case "jupiter": {
      if (ph <= 12) return -9.395 + five + ph * (6.16e-4 * ph - 3.7e-4);
      const x = ph / 180;
      return -9.428 + five - 2.5 * Math.log10(((((-1.876 * x + 2.809) * x - 0.062) * x - 0.363) * x - 1.507) * x + 1);
    }
    case "saturn": {
      const sunLat = angleBetween(SATURN_POLE, p) / DEG - 90;
      const obsLat = angleBetween(SATURN_POLE, g) / DEG - 90;
      const prod = sunLat * obsLat;
      const beta = prod >= 0 ? Math.sqrt(prod) : 0;
      if (ph > 6.5 || beta > 27) return null;
      const sb = Math.sin(beta * DEG);
      return -8.914 - 1.825 * sb + 0.026 * ph - 0.378 * sb * Math.exp(-2.25 * ph) + five;
    }
    case "uranus": {
      const sunLat = angleBetween(URANUS_POLE, p) / DEG - 90;
      const obsLat = angleBetween(URANUS_POLE, g) / DEG - 90;
      const sub = (Math.abs(sunLat) + Math.abs(obsLat)) / 2;
      return -7.11 + five - 0.00084 * sub + (ph > 3.1 ? (1.045e-4 * ph + 6.587e-3) * ph : 0);
    }
    case "neptune": {
      const yr = decimalYear(jdTT);
      let m = Math.min(-6.89, Math.max(-7.0, -6.89 - 0.0054 * (yr - 1980))) + five;
      if (ph > 1.9) {
        if (yr < 2000) return null;
        m += 7.944e-3 * ph + 9.617e-5 * ph * ph;
      }
      return m;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Topocentric places, rise, transit and set
// ---------------------------------------------------------------------------------------------------------------

export interface TopoPlace {
  ra: number;
  dec: number;
  distKm: number;
  alt: number;
  az: number;
  ha: number;
}

/** The topocentric place of a body from its apparent geocentric place: parallax by vector subtraction. */
export function topocentric(place: Place, site: Site, jdUT1: number, jdTT: number): TopoPlace {
  const siteV = siteTrueOfDate(site, jdUT1, jdTT);
  const t = sub(scale(place.dir, place.distKm), siteV);
  const s = sph(t);
  const last = norm2pi(gast(jdUT1, jdTT) + site.lon);
  const h = altAzOf(s.lon, s.lat, site, last);
  return { ra: s.lon, dec: s.lat, distKm: s.r, ...h };
}

/** The standard altitude h₀ (rad) for rising and setting: −50′ Sun, −34′ − topocentric semidiameter Moon, −34′ else. */
export function horizonAltitude(body: BodyId | "star", topoDistKm: number): number {
  if (body === "sun") return (-50 / 60) * DEG;
  if (body === "moon") return (-34 / 60) * DEG - MOON_RADIUS_KM / topoDistKm;
  return (-34 / 60) * DEG;
}

export interface RiseSetDay {
  rise: number | null;
  transit: number | null;
  set: number | null;
  /** Transit altitude (rad), refraction not applied. */
  transitAlt: number | null;
  /** All day above / below h₀ (no rise and no set in the window). */
  circumpolar: "up" | "down" | null;
  /** True if more than one rise or set fell in the window (only the first is reported). */
  multiple: boolean;
}

/**
 * Rise, upper transit and set of a body within [jdUT0, jdUT0 + 1) UT1, by sampling the topocentric altitude every
 * 10 minutes and bisecting each crossing of h₀ to 0.1 s. `deltaT` is TT − UT1 in seconds for the day. `place` gives
 * the apparent geocentric place at a TT (a body, or a fixed star direction).
 */
export function riseTransitSet(placeAt: (jdTT: number) => Place, horizonKind: BodyId | "star", site: Site, jdUT0: number, deltaT: number): RiseSetDay {
  const dt = deltaT / 86400;
  const f = (u: number): { h: number; ha: number; alt: number } => {
    const tp = topocentric(placeAt(u + dt), site, u, u + dt);
    return { h: tp.alt - horizonAltitude(horizonKind, tp.distKm), ha: tp.ha, alt: tp.alt };
  };
  const N = 144;
  const samples: Array<{ u: number; h: number; ha: number; alt: number }> = [];
  for (let i = 0; i <= N; i++) {
    const u = jdUT0 + i / N;
    samples.push({ u, ...f(u) });
  }
  const bisect = (a: number, b: number, g: (u: number) => number): number => {
    let ga = g(a);
    for (let k = 0; k < 40 && b - a > 1e-6; k++) {
      const m = (a + b) / 2;
      const gm = g(m);
      if (Math.sign(gm) === Math.sign(ga)) {
        a = m;
        ga = gm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  let rise: number | null = null;
  let set: number | null = null;
  let transit: number | null = null;
  let transitAlt: number | null = null;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const s0 = samples[i], s1 = samples[i + 1];
    if (s0.h < 0 && s1.h >= 0) {
      count++;
      if (rise === null) rise = bisect(s0.u, s1.u, (u) => f(u).h);
    } else if (s0.h >= 0 && s1.h < 0) {
      count++;
      if (set === null) set = bisect(s0.u, s1.u, (u) => f(u).h);
    }
    // Upper transit: the hour angle passes from negative to positive (not the ±π wrap).
    if (transit === null && s0.ha < 0 && s1.ha >= 0 && s1.ha - s0.ha < Math.PI) {
      transit = bisect(s0.u, s1.u, (u) => f(u).ha);
      transitAlt = f(transit).alt;
    }
  }
  if (rise !== null && rise >= jdUT0 + 1) rise = null;
  if (set !== null && set >= jdUT0 + 1) set = null;
  const circumpolar = rise === null && set === null ? (samples.every((s) => s.h >= 0) ? "up" : samples.every((s) => s.h < 0) ? "down" : null) : null;
  return { rise, transit, set, transitAlt, circumpolar, multiple: count > 2 };
}

/** A fixed J2000 direction (a star) as an apparent place of date: precession, nutation and annual aberration. */
export function starPlace(raJ2000: number, decJ2000: number, jdTT: number): Place {
  const u = vec(raJ2000, decJ2000);
  const v = scale(earthVelocityEqJ2000(jdTT), 1 / C_AU_DAY);
  const dir = matVec(precessNutate(jdTT), aberrate(u, v));
  const s = sph(dir);
  const e = sph(matVec(eqToEcl(trueObliquity(jdTT)), dir));
  // "Infinitely" far: 1e15 km makes the parallax vanish.
  return { body: "sun", ra: s.lon, dec: s.lat, eclLon: e.lon, eclLat: e.lat, distKm: 1e15, dir, helioKm: 0, phaseAngle: 0 };
}

/** Position angle (rad, from north through east) of the midpoint of the bright limb of a body lit by the Sun (Meeus 48.5). */
export function brightLimbAngle(body: { ra: number; dec: number }, sun: { ra: number; dec: number }): number {
  const y = Math.cos(sun.dec) * Math.sin(sun.ra - body.ra);
  const x = Math.sin(sun.dec) * Math.cos(body.dec) - Math.cos(sun.dec) * Math.sin(body.dec) * Math.cos(sun.ra - body.ra);
  return norm2pi(Math.atan2(y, x));
}

/** Parallactic angle (rad), Meeus 14.1: the angle between the direction to the zenith and to the north celestial pole. */
export function parallacticAngle(ha: number, dec: number, lat: number): number {
  return Math.atan2(Math.sin(ha), Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(ha));
}

/** The shadow axis geometry for solar eclipses and the Earth's shadow for lunar ones: re-exported vector helpers. */
export { cross, dot };
