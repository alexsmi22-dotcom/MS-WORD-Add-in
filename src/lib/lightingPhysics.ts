// The engine behind Engineering ▸ Lighting & rendering: the sun's position and the day's light (sunrise, golden and blue
// hour, shadows), soft shadows from an area light, light falloff and near-field error, the Cook–Torrance microfacet
// BRDF, Monte Carlo render noise, tone-mapping curves, and atmospheric extinction and scattering.
//
// Every number the calculators print is computed here; lightingCalcs.ts only reads fields and words results.
// Each function validates its own inputs and refuses by name (an Err), so no loop is ever driven by a NaN, an
// infinite or an absurd count (the whole-library fuzz calls every export with hostile values).
//
// Sources, cited where they are used:
//   Meeus, J. (1998). Astronomical Algorithms, 2nd ed., Willmann-Bell: ch. 7 (Julian day), ch. 12 (sidereal time),
//     ch. 22 (nutation, low-accuracy terms), ch. 25 (solar coordinates, low accuracy), ch. 13 (azimuth/altitude).
//   Reda, I. & Andreas, A. (2004). Solar Position Algorithm for Solar Radiation Applications, NREL/TP-560-34302:
//     eq. 42 (refraction), the −0.8333° rise/set altitude, the sun's equatorial horizontal parallax 8.794″.
//   Espenak, F. & Meeus, J. (2006). Five Millennium Canon of Solar Eclipses, NASA/TP-2006-214141 (ΔT polynomials).
//   Walter, B., Marschner, S., Li, H. & Torrance, K. (2007). Microfacet Models for Refraction through Rough Surfaces
//     (GGX D and its Smith G₁); Heitz, E. (2014). Understanding the Masking-Shadowing Function in Microfacet-Based
//     BRDFs, JCGT 3(2) (height-correlated G₂); Schlick, C. (1994), Computer Graphics Forum 13(3) (Fresnel
//     approximation); Burley, B. (2012). Physically-Based Shading at Disney (α = r²); Karis, B. (2013). Real Shading
//     in Unreal Engine 4 (α = r², metallic F0 mix).
//   Reinhard, E. et al. (2002). Photographic Tone Reproduction for Digital Images, SIGGRAPH (eq. 3 and 4);
//     Hable, J. (2010). Uncharted 2: HDR Lighting, GDC, and "Filmic Tonemapping Operators" (constants A–F, W = 11.2,
//     exposure bias 2); Narkowicz, K. (2016). ACES Filmic Tone Mapping Curve (blog post, fit dated 2015).
//   Koschmieder, H. (1924); Kasten, F. & Young, A. T. (1989). Revised optical air mass tables and approximation
//     formula, Applied Optics 28(22); Bucholtz, A. (1995). Rayleigh-scattering calculations for the terrestrial
//     atmosphere, Applied Optics 34(15), Table 3 (US Standard Atmosphere optical depth fit); Henyey, L. G. &
//     Greenstein, J. L. (1941), ApJ 93.

import { coneFlux } from "./photometry";
import { cx, fresnelAt } from "./thinFilm";

export interface Err {
  ok: false;
  error: string;
}
export const isErr = (x: unknown): x is Err => typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
const err = (error: string): Err => ({ ok: false, error });

const DEG = Math.PI / 180;
const fin = (...v: number[]): boolean => v.every((x) => typeof x === "number" && Number.isFinite(x));
const sind = (d: number): number => Math.sin(d * DEG);
const cosd = (d: number): number => Math.cos(d * DEG);
const mod360 = (d: number): number => ((d % 360) + 360) % 360;
/** An angle in degrees reduced to (−180, 180]. */
const wrap180 = (d: number): number => {
  const m = mod360(d);
  return m > 180 ? m - 360 : m;
};

// =====================================================================================================================
// 1. The sun
// =====================================================================================================================

/** The altitude of the sun's centre at sunrise and sunset (SPA): 0.26667° semi-diameter + 0.5667° standard refraction. */
export const RISE_SET_ALT = -0.8333;
/** Golden hour: the sun between 6° above and 4° below the horizon (the photographers' convention, PhotoPills). */
export const GOLDEN_HIGH = 6;
export const GOLDEN_LOW = -4;
/** Blue hour: the sun between 4° and 6° below the horizon (civil twilight ends at −6°). */
export const BLUE_LOW = -6;
/** The sun's equatorial horizontal parallax (SPA, 8.794″), in degrees. */
const SUN_PARALLAX = 8.794 / 3600;

/** Gregorian calendar check: a real day of a real month, years 1901–2099 (the ΔT fits and Meeus' low-accuracy terms). */
export function validDate(year: number, month: number, day: number): string | null {
  if (!fin(year, month, day) || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "the date must be whole numbers (year, month, day).";
  if (year < 1901 || year > 2099) return `the year ${year} is outside 1901–2099, the range the solar-position terms and ΔT fit used here cover.`;
  if (month < 1 || month > 12) return `month ${month} does not exist.`;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > dim) return `day ${day} does not exist in month ${month} of ${year}.`;
  return null;
}

/** Julian Day of a Gregorian calendar date at 0 h UT plus `dayFraction` days (Meeus eq. 7.1); the fraction may be negative or exceed 1. */
export function julianDay(year: number, month: number, day: number, dayFraction = 0): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5 + dayFraction;
}

/** ΔT = TT − UT in seconds, Espenak & Meeus (2006) polynomials at the decimal year y = year + (month − 0.5)/12 (as pvlib). */
export function deltaT(year: number, month: number): number {
  const y = year + (month - 0.5) / 12;
  if (y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3;
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + t ** 3 / 2547;
  }
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - t ** 3 / 718;
  }
  if (y < 2005) {
    const t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
}

export interface SunPosition {
  /** Topocentric altitude of the sun's centre without refraction (degrees). */
  elevation: number;
  /** With the SPA refraction correction (degrees); equals `elevation` below −0.8334°. */
  apparentElevation: number;
  /** Compass azimuth, degrees east of north (0–360). */
  azimuth: number;
  declination: number;
  /** Local hour angle, degrees in (−180, 180]; 0 at solar noon, positive in the afternoon. */
  hourAngle: number;
  /** Equation of time, minutes (apparent minus mean solar time). */
  eotMinutes: number;
}

/**
 * The sun's position at a Julian Day (UT) seen from latitude/longitude (degrees, east positive): Meeus' low-accuracy
 * solar coordinates (ch. 25, the basis of the NOAA Solar Calculator) evaluated at TT = UT + ΔT, the hour angle from
 * Greenwich apparent sidereal time (ch. 12), the topocentric parallax correction, and SPA eq. 42 refraction at the
 * given pressure (hPa) and temperature (°C). Measured against NREL SPA (pvlib 'nrel_numpy') in the tests.
 */
export function sunPositionJd(lat: number, lon: number, jdUT: number, dT: number, pressureHpa = 1013.25, tempC = 12): SunPosition {
  const jde = jdUT + dT / 86400;
  const T = (jde - 2451545) / 36525;
  const L0 = mod360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * sind(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosd(omega);
  const ra = mod360(Math.atan2(cosd(eps) * sind(lambda), cosd(lambda)) / DEG);
  const dec = Math.asin(sind(eps) * sind(lambda)) / DEG;
  // Nutation in longitude (Meeus ch. 22, the four largest terms), for apparent sidereal time.
  const Lm = 218.3165 + 481267.8813 * T;
  const dPsi = (-17.2 * sind(omega) - 1.32 * sind(2 * L0) - 0.23 * sind(2 * Lm) + 0.21 * sind(2 * omega)) / 3600;
  const Tu = (jdUT - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jdUT - 2451545) + 0.000387933 * Tu * Tu - (Tu * Tu * Tu) / 38710000;
  const gast = gmst + dPsi * cosd(eps);
  const H = wrap180(gast + lon - ra);
  const sinE = sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(H);
  const e0 = Math.asin(Math.max(-1, Math.min(1, sinE))) / DEG;
  // Topocentric: the parallax lowers the sun by π·cos(e) (8.794″ at most).
  const elevation = e0 - SUN_PARALLAX * cosd(e0);
  const az = mod360(Math.atan2(sind(H), cosd(H) * sind(lat) - Math.tan(dec * DEG) * cosd(lat)) / DEG + 180);
  let apparentElevation = elevation;
  if (elevation >= -(0.26667 + 0.5667)) {
    apparentElevation += ((pressureHpa / 1010) * (283 / (273 + tempC)) * 1.02) / (60 * Math.tan((elevation + 10.3 / (elevation + 5.11)) * DEG));
  }
  const eot = 4 * wrap180(L0 - 0.0057183 - ra + dPsi * cosd(eps));
  return { elevation, apparentElevation, azimuth: az, declination: dec, hourAngle: H, eotMinutes: eot };
}

export interface LocalDay {
  year: number;
  month: number;
  day: number;
  /** Hours east of UTC (+1 for BST, −5 for EST). Daylight saving is whatever offset is typed. */
  utcOffset: number;
}

/** Julian Day (UT) of a local clock time, in minutes after local midnight of the given date (may lie outside 0–1440). */
export function jdLocal(d: LocalDay, minutes: number): number {
  return julianDay(d.year, d.month, d.day, (minutes - 60 * d.utcOffset) / 1440);
}

function checkSite(lat: number, lon: number, d: LocalDay): string | null {
  if (!fin(lat) || lat <= -90 || lat >= 90) return `Latitude ${fin(lat) ? lat : "(not a number)"}: it must lie strictly between −90° and 90° (at a pole the azimuth has no meaning).`;
  if (!fin(lon) || lon < -180 || lon > 180) return `Longitude ${fin(lon) ? lon : "(not a number)"}: it must lie between −180° and 180°, east positive.`;
  if (!fin(d.utcOffset) || d.utcOffset < -14 || d.utcOffset > 14) return "UTC offset: it must lie between −14 and +14 hours.";
  const bad = validDate(d.year, d.month, d.day);
  return bad ? `Date: ${bad}` : null;
}

/** The sun at a local clock time (minutes after local midnight). */
export function sunAt(lat: number, lon: number, d: LocalDay, minutes: number, pressureHpa = 1013.25, tempC = 12): SunPosition | Err {
  const bad = checkSite(lat, lon, d);
  if (bad) return err(bad);
  if (!fin(minutes) || minutes < 0 || minutes >= 1440) return err("Local time: it must lie from 00:00 to 23:59:59.");
  if (!fin(pressureHpa, tempC) || pressureHpa <= 0 || pressureHpa > 1100 || tempC <= -273) return err("Pressure and temperature: pressure 0–1100 hPa and a temperature above absolute zero.");
  return sunPositionJd(lat, lon, jdLocal(d, minutes), deltaT(d.year, d.month), pressureHpa, tempC);
}

/** A crossing of an altitude threshold: the local clock minute (may be < 0 or ≥ 1440: the day before or after). */
export type Crossing = number | null;

export interface SunEvents {
  /** Solar noon (transit), local minutes. */
  transit: number;
  /** Highest and lowest geometric elevation of the day (at transit and anti-transit). */
  maxElevation: number;
  minElevation: number;
  sunrise: Crossing;
  sunset: Crossing;
  /** "normal", or "polar day" (never sets) / "polar night" (never rises) by the −0.8333° rule. */
  daylight: "normal" | "polar day" | "polar night";
  /** Day length in minutes (1440 in polar day, 0 in polar night). */
  dayLength: number;
  /** Morning and evening golden hour [start, end] (sun from −4° up to 6°, and 6° down to −4°). */
  goldenMorning: [Crossing, Crossing];
  goldenEvening: [Crossing, Crossing];
  /** Morning and evening blue hour [start, end] (−6° to −4°, and −4° to −6°). */
  blueMorning: [Crossing, Crossing];
  blueEvening: [Crossing, Crossing];
}

/**
 * The day's events for the local date: transit by Newton steps on the hour angle; then each altitude threshold is
 * decided from the day's maximum and minimum elevation (transit and the anti-transits either side), and only a
 * threshold that is actually crossed is bisected for (so a brief dip near the poles is not missed by a coarse scan).
 * Thresholds are on the GEOMETRIC elevation of the sun's centre (refraction is folded into −0.8333° for rise and set,
 * as SPA does); golden and blue hour are geometric too.
 */
export function sunEvents(lat: number, lon: number, d: LocalDay): SunEvents | Err {
  const bad = checkSite(lat, lon, d);
  if (bad) return err(bad);
  const dT = deltaT(d.year, d.month);
  const pos = (m: number): SunPosition => sunPositionJd(lat, lon, jdLocal(d, m), dT);
  const elev = (m: number): number => pos(m).elevation;
  // Transit: H = 0. H advances 360.9856°/day ≈ 0.250684°/min.
  const rate = 360.98564736629 / 1440;
  let transit = 720;
  for (let i = 0; i < 6; i++) transit -= pos(transit).hourAngle / rate;
  const antiBefore = transit - 720;
  const antiAfter = transit + 720;
  const eMax = elev(transit);
  const eMin = Math.min(elev(antiBefore), elev(antiAfter));
  /** Where elevation crosses h going up in [antiBefore, transit] (or down in [transit, antiAfter]). */
  const cross = (h: number, rising: boolean): Crossing => {
    let a = rising ? antiBefore : transit;
    let b = rising ? transit : antiAfter;
    const fa = elev(a) - h;
    const fb = elev(b) - h;
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (Math.sign(fa) === Math.sign(fb)) return null;
    for (let i = 0; i < 48; i++) {
      const m = (a + b) / 2;
      const fm = elev(m) - h;
      if (Math.sign(fm) === Math.sign(fa)) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const sunrise = cross(RISE_SET_ALT, true);
  const sunset = cross(RISE_SET_ALT, false);
  const daylight: SunEvents["daylight"] = sunrise !== null && sunset !== null ? "normal" : eMax < RISE_SET_ALT ? "polar night" : eMin > RISE_SET_ALT ? "polar day" : "normal";
  const dayLength = daylight === "polar day" ? 1440 : daylight === "polar night" ? 0 : sunrise !== null && sunset !== null ? sunset - sunrise : 0;
  return {
    transit,
    maxElevation: eMax,
    minElevation: eMin,
    sunrise,
    sunset,
    daylight,
    dayLength,
    goldenMorning: [cross(GOLDEN_LOW, true), cross(GOLDEN_HIGH, true)],
    goldenEvening: [cross(GOLDEN_HIGH, false), cross(GOLDEN_LOW, false)],
    blueMorning: [cross(BLUE_LOW, true), cross(GOLDEN_LOW, true)],
    blueEvening: [cross(GOLDEN_LOW, false), cross(BLUE_LOW, false)],
  };
}

/** The sun's path across the local day: elevation (apparent) and azimuth every `step` minutes, 0 to 1440. */
export function sunPath(lat: number, lon: number, d: LocalDay, step = 5): Array<{ minute: number; elevation: number; azimuth: number }> | Err {
  const bad = checkSite(lat, lon, d);
  if (bad) return err(bad);
  if (!fin(step) || step < 1 || step > 120) return err("Path step: 1 to 120 minutes.");
  const dT = deltaT(d.year, d.month);
  const out: Array<{ minute: number; elevation: number; azimuth: number }> = [];
  for (let m = 0; m <= 1440; m += step) {
    const p = sunPositionJd(lat, lon, jdLocal(d, m), dT);
    out.push({ minute: m, elevation: p.apparentElevation, azimuth: p.azimuth });
  }
  return out;
}

export interface Shadow {
  /** Horizontal shadow length on level ground, same unit as the height. */
  length: number;
  /** Compass bearing the shadow points along (the sun's azimuth + 180°). */
  bearing: number;
  /** Shadow length as a multiple of the object's height (1/tan e). */
  ratio: number;
}

/** The shadow of a vertical object of height h on level ground with the sun at apparent elevation e and azimuth az. Null when the sun is not above the horizon. */
export function shadowOf(h: number, elevationDeg: number, azimuthDeg: number): Shadow | null | Err {
  if (!fin(h) || h <= 0) return err("Object height: it must be a positive length.");
  if (!fin(elevationDeg, azimuthDeg)) return err("Sun position: not finite.");
  if (elevationDeg <= 0) return null;
  const ratio = 1 / Math.tan(elevationDeg * DEG);
  return { length: h * ratio, bearing: mod360(azimuthDeg + 180), ratio };
}

// =====================================================================================================================
// 2. Soft shadows (similar triangles, a 2-D section through light, occluder and receiver, all parallel)
// =====================================================================================================================

export interface SoftShadow {
  ok: true;
  /** Width of EACH penumbra band, D·d/L. */
  penumbra: number;
  /** Umbra width w − (D − w)·d/L; ≤ 0 means no umbra (|value| is then the antumbra width). */
  umbra: number;
  hasUmbra: boolean;
  /** Receiver distance where the umbra vanishes, wL/(D − w) (null when D ≤ w: the umbra never closes). */
  umbraEnds: number | null;
  /** Outer edge to outer edge, w + (D + w)·d/L. */
  outer: number;
  /** The hard shadow a point light at the light's centre casts, w(L + d)/L. */
  pointShadow: number;
}

/**
 * Light of size D at distance L in front of an occluder of size w; receiver at distance d behind the occluder.
 * Exact for a strip light and strip occluder in section, and for coaxial discs (D, w as diameters).
 */
export function softShadow(D: number, w: number, L: number, d: number): SoftShadow | Err {
  if (!fin(D) || D <= 0) return err("Light size D: it must be a positive length (a point light, D = 0, casts no penumbra; the hard shadow is reported beside every result).");
  if (!fin(w) || w <= 0) return err("Occluder size w: it must be a positive length.");
  if (!fin(L) || L <= 0) return err("Light to occluder distance L: it must be positive. At L = 0 the occluder sits at the light and there is no shadow geometry to compute.");
  if (!fin(d) || d < 0) return err("Occluder to receiver distance d: it must be zero (contact) or positive.");
  const penumbra = (D * d) / L;
  const umbra = w - ((D - w) * d) / L;
  return {
    ok: true,
    penumbra,
    umbra,
    hasUmbra: umbra > 0,
    umbraEnds: D > w ? (w * L) / (D - w) : null,
    outer: w + ((D + w) * d) / L,
    pointShadow: (w * (L + d)) / L,
  };
}

// =====================================================================================================================
// 3. Falloff, lighting ratios, near-field error, renderer light units
// =====================================================================================================================

/** Stops lost from distance d1 to d2 under the inverse-square law: 2·log₂(d2/d1). */
export function falloffStops(d1: number, d2: number): number | Err {
  if (!fin(d1, d2) || d1 <= 0 || d2 <= 0) return err("Distances: both must be positive.");
  return 2 * Math.log2(d2 / d1);
}

/** New light distance for a change of `stops` at the subject (+ brighter): d·2^(−stops/2). */
export function distanceForStops(d: number, stops: number): number | Err {
  if (!fin(d) || d <= 0) return err("Distance: it must be positive.");
  if (!fin(stops) || Math.abs(stops) > 30) return err("Change in stops: a finite number within ±30.");
  return d * Math.pow(2, -stops / 2);
}

/** On-axis illuminance of a uniform Lambertian disc of radiance L, radius R at distance z: πL·R²/(R² + z²) = πL·sin²θ. */
export function discIlluminance(L: number, R: number, z: number): number {
  return (Math.PI * L * R * R) / (R * R + z * z);
}

/** The same disc treated as a point source of intensity I = L·πR²: E = LπR²/z². */
export function discAsPoint(L: number, R: number, z: number): number {
  return (Math.PI * L * R * R) / (z * z);
}

export interface FalloffResult {
  ok: true;
  stops: number;
  ratioBackground: number;
  /** Disc radiance L = Φ/(πA) for a one-sided Lambertian emitter (cd/m²). */
  discLuminance: number;
  discExact: number;
  discPoint: number;
  /** Point-approximation error at the subject, E_point/E_exact − 1 = (R/z)². */
  pointError: number;
  /** The same at five diameters: (1/10)² = 1 %. */
  errorAtFive: number;
  /** Distance where the error falls to 1 %: z = 10 R = 5 D. */
  onePercentDistance: number;
  pointCd: number;
  spotCd: number;
  spotOmega: number;
  areaNits: number;
  lumensFromWatts: number | null;
}

export interface FalloffInput {
  d1: number;
  d2: number;
  diameter: number;
  flux: number;
  coneDeg: number;
  watts: number | null;
  efficacy: number | null;
}

export function falloff(inp: FalloffInput): FalloffResult | Err {
  const { d1, d2, diameter, flux, coneDeg, watts, efficacy } = inp;
  if (!fin(d1) || d1 <= 0) return err("Light to subject distance: it must be positive.");
  if (!fin(d2) || d2 <= 0) return err("Light to background distance: it must be positive.");
  if (!fin(diameter) || diameter <= 0) return err("Area light diameter: it must be a positive length.");
  if (!fin(flux) || flux <= 0) return err("Luminous flux: it must be positive.");
  if (!fin(coneDeg) || coneDeg <= 0 || coneDeg > 360) return err("Spot cone angle: a full angle above 0° and at most 360°.");
  if (watts !== null && (!fin(watts) || watts < 0)) return err("Electrical power: it must be zero or positive.");
  if (efficacy !== null && (!fin(efficacy) || efficacy <= 0 || efficacy > 683)) return err("Luminous efficacy: above 0 and at most 683 lm/W (the maximum, reached only by monochromatic 555 nm light).");
  const stops = 2 * Math.log2(d2 / d1);
  const R = diameter / 2;
  const area = Math.PI * R * R;
  const Lum = flux / (Math.PI * area);
  const cone = coneFlux(1, coneDeg);
  if (!("solidAngleSr" in cone)) return err("Spot cone angle: the cone's solid angle could not be computed.");
  const discExact = discIlluminance(Lum, R, d1);
  const discPoint = discAsPoint(Lum, R, d1);
  return {
    ok: true,
    stops,
    ratioBackground: (d1 * d1) / (d2 * d2),
    discLuminance: Lum,
    discExact,
    discPoint,
    pointError: (R * R) / (d1 * d1),
    errorAtFive: discAsPoint(Lum, R, 5 * diameter) / discIlluminance(Lum, R, 5 * diameter) - 1,
    onePercentDistance: 10 * R,
    pointCd: flux / (4 * Math.PI),
    spotCd: flux / cone.solidAngleSr,
    spotOmega: cone.solidAngleSr,
    areaNits: Lum,
    lumensFromWatts: watts !== null && efficacy !== null ? watts * efficacy : null,
  };
}

// =====================================================================================================================
// 4. Microfacet BRDF: Cook–Torrance, GGX D, Smith G, Schlick F
// =====================================================================================================================

/** Filament's clamp on perceptual roughness (MIN_PERCEPTUAL_ROUGHNESS, fp32): α = 0.045² = 0.002025. */
export const MIN_ROUGHNESS = 0.045;

export type SmithForm = "correlated" | "separable";

/** GGX / Trowbridge–Reitz normal distribution D(h) = α²/(π((n·h)²(α² − 1) + 1)²). */
export function ggxD(NoH: number, alpha: number): number {
  const a2 = alpha * alpha;
  const t = NoH * NoH * (a2 - 1) + 1;
  return a2 / (Math.PI * t * t);
}

/** Smith G₁ for GGX: 2(n·v)/((n·v) + √(α² + (1 − α²)(n·v)²)). */
export function smithG1(NoV: number, alpha: number): number {
  const a2 = alpha * alpha;
  return (2 * NoV) / (NoV + Math.sqrt(a2 + (1 - a2) * NoV * NoV));
}

/**
 * The visibility term V = G₂/(4(n·l)(n·v)), written so that grazing angles never form 0/0.
 * Height-correlated (Heitz 2014): V = 0.5/((n·l)√((n·v)²(1 − α²) + α²) + (n·v)√((n·l)²(1 − α²) + α²)).
 * Separable: V = G₁(l)G₁(v)/(4(n·l)(n·v)) = 1/((n·l + √…)(n·v + √…)).
 */
export function smithV(NoL: number, NoV: number, alpha: number, form: SmithForm): number {
  const a2 = alpha * alpha;
  const lamL = Math.sqrt(NoL * NoL * (1 - a2) + a2);
  const lamV = Math.sqrt(NoV * NoV * (1 - a2) + a2);
  if (form === "separable") return 1 / ((NoL + lamL) * (NoV + lamV));
  return 0.5 / (NoL * lamV + NoV * lamL);
}

/** Schlick's Fresnel approximation F = F0 + (1 − F0)(1 − v·h)⁵. */
export function schlickF(F0: number, VoH: number): number {
  return F0 + (1 - F0) * Math.pow(1 - Math.max(0, Math.min(1, VoH)), 5);
}

/** Normal-incidence reflectance of a dielectric of index n in air, ((n − 1)/(n + 1))², via the exact Fresnel module. */
export function f0FromIor(n: number): number | Err {
  if (!fin(n) || n <= 0 || n > 10) return err("Index of refraction: a positive number up to 10.");
  const p = fresnelAt(1, cx(n), 0);
  if (!p) return err("Index of refraction: the Fresnel coefficients could not be computed.");
  return p.Rs;
}

/** Exact unpolarised Fresnel reflectance (Rs + Rp)/2 from air into index n at angle θ (degrees): to measure Schlick against. */
export function fresnelExact(n: number, thetaDeg: number): number | null {
  if (!fin(n, thetaDeg) || n <= 0 || thetaDeg < 0 || thetaDeg >= 90) return null;
  const p = fresnelAt(1, cx(n), thetaDeg);
  return p ? (p.Rs + p.Rp) / 2 : null;
}

export interface BrdfInput {
  roughness: number;
  metallic: number;
  ior: number;
  base: number;
  thetaV: number;
  thetaL: number;
  /** Azimuth of l from v about the normal, degrees; 180° is the mirror direction. */
  phi: number;
  form: SmithForm;
}

export interface BrdfResult {
  ok: true;
  roughnessUsed: number;
  floored: boolean;
  alpha: number;
  F0: number;
  F0dielectric: number;
  NoL: number;
  NoV: number;
  NoH: number;
  VoH: number;
  thetaH: number;
  D: number;
  G: number;
  V: number;
  F: number;
  /** Specular BRDF D·G·F/(4(n·l)(n·v)), sr⁻¹. */
  specular: number;
  /** Lambert diffuse (1 − metallic)·base/π, sr⁻¹. */
  diffuse: number;
  /** Reflected radiance per unit irradiance-at-normal: (specular + diffuse)·(n·l). */
  cosineWeighted: number;
  /** Exact unpolarised Fresnel at the same v·h for a pure dielectric (null for a metal mix). */
  fresnelExactAtVoH: number | null;
  /** Directional albedo with F = 1 (white furnace) at θv, and with Schlick F. */
  albedoWhite: number;
  albedoF: number;
}

const BRDF_N1 = 256;
const BRDF_N2 = 128;

/**
 * Directional albedo E(θv) = ∫ f_s(l, v)(n·l) dω_l, integrated over the HALF-VECTOR: the GGX change of variables
 * cos²θh = (1 − u)/(1 + (α² − 1)u), φh = 2πw maps the unit square onto the hemisphere of h with density D(h)cosθh, and
 * l = 2(v·h)h − v has density D cosθh/(4 v·h). The integrand per unit square is then G₂·F·(v·h)/((n·v)(n·h)), smooth
 * in u even at α = 0.002 (a θ grid cannot resolve that lobe). Midpoint rule on a graded u grid, BRDF_N1 × BRDF_N2
 * cells (within 5×10⁻⁵ of a 400 × 720 Gauss–Legendre integral over the light direction). F0 = 1 gives the
 * white-furnace test: 1 − E is the energy single scattering loses (multiple bounces between microfacets not modelled).
 */
export function directionalAlbedo(alpha: number, thetaVDeg: number, F0: number, form: SmithForm): number | Err {
  if (!fin(alpha, thetaVDeg, F0) || alpha <= 0 || alpha > 1 || thetaVDeg < 0 || thetaVDeg >= 90 || F0 < 0 || F0 > 1) return err("Albedo: α in (0, 1], θv in [0°, 90°), F0 in [0, 1].");
  const NoV = Math.cos(thetaVDeg * DEG);
  const v = [Math.sin(thetaVDeg * DEG), 0, NoV];
  const a2 = alpha * alpha;
  let sum = 0;
  for (let i = 0; i < BRDF_N1; i++) {
    // u = 1 − (1 − w)², du = 2(1 − w)dw: cells crowd toward u = 1 (grazing half-vectors), where the shadowing term
    // falls to zero over a sliver of u; a uniform u grid converged only as 1/N there (0.4 % off at 256 cells).
    const w = (i + 0.5) / BRDF_N1;
    const u = 1 - (1 - w) * (1 - w);
    const du = 2 * (1 - w);
    const c2 = (1 - u) / (1 + (a2 - 1) * u);
    const ch = Math.sqrt(c2);
    const sh = Math.sqrt(Math.max(0, 1 - c2));
    for (let j = 0; j < BRDF_N2; j++) {
      const ph = (2 * Math.PI * (j + 0.5)) / BRDF_N2;
      // v lies in the x–z plane, so h's y component never enters v·h.
      const VoH = v[0] * sh * Math.cos(ph) + v[2] * ch;
      if (VoH <= 0) continue;
      const NoL = 2 * VoH * ch - NoV;
      if (NoL <= 0) continue;
      const G2 = 4 * NoL * NoV * smithV(NoL, NoV, alpha, form);
      sum += (du * G2 * schlickF(F0, VoH) * VoH) / (NoV * ch);
    }
  }
  return sum / (BRDF_N1 * BRDF_N2);
}

export function brdf(inp: BrdfInput): BrdfResult | Err {
  const { roughness, metallic, ior, base, thetaV, thetaL, phi, form } = inp;
  if (!fin(roughness) || roughness < 0 || roughness > 1) return err("Roughness: a perceptual roughness from 0 to 1.");
  if (!fin(metallic) || metallic < 0 || metallic > 1) return err("Metallic: from 0 (dielectric) to 1 (metal).");
  if (!fin(base) || base < 0 || base > 1) return err("Base colour: a linear reflectance from 0 to 1 (one channel).");
  if (!fin(thetaV) || thetaV < 0 || thetaV >= 90) return err("View angle θv: from 0° up to (not including) 90°; at 90° or beyond the viewer is at or below the surface.");
  if (!fin(thetaL) || thetaL < 0 || thetaL >= 90) return err("Light angle θl: from 0° up to (not including) 90°; at 90° or beyond the light is at or below the surface and contributes nothing.");
  if (!fin(phi) || phi < -360 || phi > 360) return err("Azimuth φ: an angle from −360° to 360°.");
  const F0d = f0FromIor(ior);
  if (isErr(F0d)) return F0d;
  const floored = roughness < MIN_ROUGHNESS;
  const r = Math.max(roughness, MIN_ROUGHNESS);
  const alpha = r * r;
  const F0 = (1 - metallic) * F0d + metallic * base;
  const v = [Math.sin(thetaV * DEG), 0, Math.cos(thetaV * DEG)];
  const l = [Math.sin(thetaL * DEG) * Math.cos(phi * DEG), Math.sin(thetaL * DEG) * Math.sin(phi * DEG), Math.cos(thetaL * DEG)];
  const hRaw = [v[0] + l[0], v[1] + l[1], v[2] + l[2]];
  const hn = Math.hypot(hRaw[0], hRaw[1], hRaw[2]);
  const h = hRaw.map((x) => x / hn);
  const NoL = l[2];
  const NoV = v[2];
  const NoH = h[2];
  const VoH = v[0] * h[0] + v[1] * h[1] + v[2] * h[2];
  const D = ggxD(NoH, alpha);
  const V = smithV(NoL, NoV, alpha, form);
  const G = 4 * NoL * NoV * V;
  const F = schlickF(F0, VoH);
  const specular = D * V * F;
  const diffuse = ((1 - metallic) * base) / Math.PI;
  const albedoWhite = directionalAlbedo(alpha, thetaV, 1, form);
  const albedoF = directionalAlbedo(alpha, thetaV, F0, form);
  if (isErr(albedoWhite)) return albedoWhite;
  if (isErr(albedoF)) return albedoF;
  return {
    ok: true,
    roughnessUsed: r,
    floored,
    alpha,
    F0,
    F0dielectric: F0d,
    NoL,
    NoV,
    NoH,
    VoH,
    thetaH: Math.acos(Math.max(-1, Math.min(1, NoH))) / DEG,
    D,
    G,
    V,
    F,
    specular,
    diffuse,
    cosineWeighted: (specular + diffuse) * NoL,
    fresnelExactAtVoH: metallic === 0 ? fresnelExact(ior, Math.acos(Math.max(0, Math.min(1, VoH))) / DEG) : null,
    albedoWhite,
    albedoF,
  };
}

/** f_s·cosθl in the plane of incidence for light at signed angle t (degrees, −90…90; positive on the mirror side). */
export function lobeInPlane(alpha: number, thetaVDeg: number, F0: number, form: SmithForm, tDeg: number): number {
  const v = [Math.sin(thetaVDeg * DEG), 0, Math.cos(thetaVDeg * DEG)];
  const l = [-Math.sin(tDeg * DEG), 0, Math.cos(tDeg * DEG)];
  if (l[2] <= 0) return 0;
  const h = [v[0] + l[0], 0, v[2] + l[2]];
  const hn = Math.hypot(h[0], h[2]);
  const NoH = h[2] / hn;
  const VoH = (v[0] * h[0] + v[2] * h[2]) / hn;
  return ggxD(NoH, alpha) * smithV(l[2], v[2], alpha, form) * schlickF(F0, VoH) * l[2];
}

// =====================================================================================================================
// 5. Render noise and sampling
// =====================================================================================================================

export interface NoiseResult {
  ok: true;
  samples: number;
  factor: number;
  time: number;
  timeFactor: number;
}

/** Samples for a target noise (σ ∝ 1/√N): N = N0·(σ0/σt)²; render time = overhead + (T0 − overhead)·N/N0. */
export function samplesForNoise(N0: number, sigma0: number, sigmaT: number, T0: number, overhead: number): NoiseResult | Err {
  if (!fin(N0) || N0 < 1 || N0 > 1e9) return err("Current samples per pixel: from 1 to 10⁹.");
  if (!fin(sigma0) || sigma0 <= 0) return err("Current noise: it must be positive.");
  if (!fin(sigmaT) || sigmaT <= 0) return err("Target noise: it must be positive (zero noise needs infinitely many samples).");
  if (!fin(T0) || T0 <= 0) return err("Current render time: it must be positive.");
  if (!fin(overhead) || overhead < 0 || overhead >= T0) return err("Fixed overhead: zero or positive, and less than the current render time.");
  const factor = (sigma0 / sigmaT) ** 2;
  const samples = N0 * factor;
  if (!fin(samples) || samples > 1e15) return err("Target noise: it needs more than 10¹⁵ samples per pixel; no render reaches that.");
  return { ok: true, samples, factor, time: overhead + (T0 - overhead) * factor, timeFactor: (overhead + (T0 - overhead) * factor) / T0 };
}

export interface HemiVariance {
  ok: true;
  /** The integral ∫cosθ dω over the light's cone = π sin²β (radiance 1). */
  integral: number;
  varUniform: number;
  varCosine: number;
  /** Uniform variance / cosine variance (null when cosine sampling is exact: β = 90°). */
  ratio: number | null;
}

/**
 * Per-sample variance of the two hemisphere estimators of the irradiance from a light of radiance 1 filling a cone of
 * half-angle β about the normal (0 outside): E = ∫cosθ dω = π sin²β.
 *   Uniform (pdf 1/2π): Y = 2π cosθ·1[θ < β];  E[Y²] = 4π²(1 − cos³β)/3, Var = 4π²(1 − cos³β)/3 − π² sin⁴β.
 *   Cosine (pdf cosθ/π): Y = π·1[θ < β];        Var = π² sin²β cos²β (zero at β = 90°: the integrand is then exactly
 *   proportional to the pdf).
 */
export function hemiVariance(betaDeg: number): HemiVariance | Err {
  if (!fin(betaDeg) || betaDeg <= 0 || betaDeg > 90) return err("Light cone half-angle β: above 0° and at most 90° (90° is a uniform sky filling the hemisphere).");
  const b = betaDeg * DEG;
  const s2 = Math.sin(b) ** 2;
  const c = Math.cos(b);
  const integral = Math.PI * s2;
  const varUniform = (4 * Math.PI * Math.PI * (1 - c * c * c)) / 3 - Math.PI * Math.PI * s2 * s2;
  const varCosine = betaDeg === 90 ? 0 : Math.PI * Math.PI * s2 * c * c;
  return { ok: true, integral, varUniform, varCosine, ratio: varCosine > 0 ? varUniform / varCosine : null };
}

/** mulberry32: a small seeded generator, so the figure's Monte Carlo points are the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * RMS relative error of the N-sample estimate over `trials` seeded runs (for the figure only). Uniform: cosθ ~ U(0, 1);
 * cosine-weighted: sin²θ ~ U(0, 1). N·trials is capped so the pane never stalls.
 */
export function mcRelativeError(strategy: "uniform" | "cosine", betaDeg: number, N: number, trials: number, seed: number): number | Err {
  if (!fin(betaDeg, N, trials, seed) || betaDeg <= 0 || betaDeg > 90) return err("Monte Carlo: β in (0°, 90°].");
  if (!Number.isInteger(N) || !Number.isInteger(trials) || N < 1 || trials < 1 || N * trials > 2e6) return err("Monte Carlo: whole N and trials with N × trials ≤ 2×10⁶.");
  const b = betaDeg * DEG;
  const cb = Math.cos(b);
  const s2 = Math.sin(b) ** 2;
  const truth = Math.PI * s2;
  const rnd = mulberry32(seed);
  let sq = 0;
  for (let t = 0; t < trials; t++) {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const u = rnd();
      if (strategy === "uniform") s += u > cb ? 2 * Math.PI * u : 0;
      else s += u < s2 ? Math.PI : 0;
    }
    const e = s / N / truth - 1;
    sq += e * e;
  }
  return Math.sqrt(sq / trials);
}

// =====================================================================================================================
// 6. Tone mapping
// =====================================================================================================================

/** Hable's Uncharted 2 constants (GDC 2010 / "Filmic Tonemapping Operators"): shoulder, linear, toe; linear white W. */
export const HABLE = { A: 0.15, B: 0.5, C: 0.1, D: 0.2, E: 0.02, F: 0.3, W: 11.2, bias: 2 } as const;

/** Reinhard (2002) eq. 3: x/(1 + x). */
export const reinhard = (x: number): number => x / (1 + x);
/** Reinhard (2002) eq. 4: x(1 + x/Lw²)/(1 + x); exactly 1 at x = Lw. */
export const reinhardExt = (x: number, Lw: number): number => (x * (1 + x / (Lw * Lw))) / (1 + x);
const hablePartial = (x: number): number => {
  const { A, B, C, D, E, F } = HABLE;
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
};
/** Hable filmic: f(bias·x)/f(W), bias 2 as in Hable's published sample code; 1 at x = W/2 = 5.6. */
export const hable = (x: number): number => hablePartial(HABLE.bias * x) / hablePartial(HABLE.W);
/** Narkowicz (2015/16) fit to the ACES RRT + sRGB ODT: x(2.51x + 0.03)/(x(2.43x + 0.59) + 0.14), clamped to [0, 1]. */
export const acesFitted = (x: number): number => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
/** Scene value where the ACES fit reaches 1 (0.08x² − 0.56x − 0.14 = 0). */
export const ACES_CLIP = (0.56 + Math.sqrt(0.56 * 0.56 + 4 * 0.08 * 0.14)) / (2 * 0.08);

export type ToneCurve = "reinhard" | "reinhardExt" | "hable" | "aces";
export const TONE_NAMES: Record<ToneCurve, string> = {
  reinhard: "Reinhard",
  reinhardExt: "Reinhard extended",
  hable: "Hable filmic",
  aces: "ACES fit (Narkowicz)",
};

export function toneMap(curve: ToneCurve, x: number, Lw: number): number {
  if (curve === "reinhard") return reinhard(x);
  if (curve === "reinhardExt") return Math.min(1, reinhardExt(x, Lw));
  if (curve === "hable") return Math.min(1, hable(x));
  return acesFitted(x);
}

/** The scene value (after exposure) a curve maps to display value y, by bisection on [0, 1e6] (curves are increasing). Null if never reached. */
export function inverseTone(curve: ToneCurve, y: number, Lw: number): number | null {
  if (!fin(y, Lw) || y <= 0 || y >= 1 || Lw <= 0) return null;
  let a = 0;
  let b = 1e6;
  if (toneMap(curve, b, Lw) < y) return null;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (toneMap(curve, m, Lw) < y) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Scene dynamic range in stops, log₂(max/min). */
export function dynamicRangeStops(lo: number, hi: number): number | Err {
  if (!fin(lo, hi) || lo <= 0 || hi <= 0) return err("Luminances: both must be positive.");
  if (hi <= lo) return err("The brightest luminance must exceed the darkest.");
  return Math.log2(hi / lo);
}

// =====================================================================================================================
// 7. Atmosphere, fog and participating media
// =====================================================================================================================

/** Koschmieder's constant at the 2 % contrast threshold: −ln 0.02 = 3.912. */
export const KOSCHMIEDER = -Math.log(0.02);
/** The WMO meteorological optical range uses 5 %: −ln 0.05 = 2.996. */
export const MOR_CONST = -Math.log(0.05);

/** Relative optical air mass, Kasten & Young (1989): 1/(cos z + 0.50572(96.07995 − z)^−1.6364), z the zenith angle in degrees (0–90). */
export function kastenYoung(zenithDeg: number): number | Err {
  if (!fin(zenithDeg) || zenithDeg < 0 || zenithDeg > 90) return err("Zenith angle: from 0° to 90° (Kasten–Young is defined down to the horizon).");
  return 1 / (Math.cos(zenithDeg * DEG) + 0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364));
}

/**
 * Rayleigh optical depth of the whole atmosphere (US Standard Atmosphere, 1013.25 hPa) at wavelength λ (µm),
 * Bucholtz (1995) Table 3 fit τ = A·λ^−(B + Cλ + D/λ): A = 6.50362×10⁻³, B = 3.55212, C = 1.35579, D = 0.11563 for
 * 0.2–0.5 µm; A = 8.64627×10⁻³, B = 3.99668, C = 1.10298×10⁻³, D = 2.71393×10⁻² above 0.5 µm. 0.0972 at 0.55 µm.
 */
export function rayleighTau(lambdaUm: number): number | Err {
  if (!fin(lambdaUm) || lambdaUm < 0.2 || lambdaUm > 4) return err("Wavelength: from 200 nm to 4 µm (the range of the Bucholtz fit).");
  const [A, B, C, D] = lambdaUm <= 0.5 ? [6.50362e-3, 3.55212, 1.35579, 0.11563] : [8.64627e-3, 3.99668, 1.10298e-3, 2.71393e-2];
  return A * Math.pow(lambdaUm, -(B + C * lambdaUm + D / lambdaUm));
}

/** Henyey–Greenstein phase function p(θ) = (1 − g²)/(4π(1 + g² − 2g cosθ)^{3/2}), sr⁻¹; normalised over the sphere, mean cosθ = g. */
export function henyeyGreenstein(g: number, thetaDeg: number): number {
  return (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * Math.cos(thetaDeg * DEG), 1.5));
}

export interface AtmosphereInput {
  /** Extinction coefficient σ_t, 1/m (null: from the visibility). */
  sigma: number | null;
  visibility: number | null;
  distance: number;
  elevationDeg: number;
  pressureHpa: number;
  g: number;
  thetaDeg: number;
  lambdas: number[];
}

export interface AtmosphereResult {
  ok: true;
  sigma: number;
  opticalDepth: number;
  transmittance: number;
  /** Koschmieder visibility at 2 % (null when σ = 0: unlimited). */
  visibility: number | null;
  mor: number | null;
  airMass: number;
  zenith: number;
  /** Per wavelength: Rayleigh τ at the pressure, the direct beam's transmittance, and that relative to 550 nm. */
  beam: Array<{ lambdaNm: number; tau: number; T: number; rel550: number }>;
  T550: number;
  /** Rayleigh scattering of the shortest listed wavelength relative to the longest, (λmax/λmin)⁴. */
  rayleighRatio: number;
  hg: number;
  hgForwardBack: number;
}

export function atmosphere(inp: AtmosphereInput): AtmosphereResult | Err {
  const { distance, elevationDeg, pressureHpa, g, thetaDeg, lambdas } = inp;
  let sigma = inp.sigma;
  if (sigma === null) {
    if (inp.visibility === null) return err("Give either the extinction coefficient σ or a visibility.");
    if (!fin(inp.visibility) || inp.visibility <= 0) return err("Visibility: it must be a positive distance.");
    sigma = KOSCHMIEDER / inp.visibility;
  }
  if (!fin(sigma) || sigma < 0) return err("Extinction coefficient σ: it must be zero (clear vacuum-like air) or positive.");
  if (!fin(distance) || distance < 0) return err("Path length d: it must be zero or positive.");
  if (!fin(elevationDeg) || elevationDeg < 0 || elevationDeg > 90) return err("Sun elevation: from 0° (horizon) to 90°; with the sun below the horizon there is no direct beam.");
  if (!fin(pressureHpa) || pressureHpa <= 0 || pressureHpa > 1100) return err("Surface pressure: above 0 and at most 1100 hPa.");
  if (!fin(g) || g <= -1 || g >= 1) return err("Asymmetry g: strictly between −1 and 1 (g = ±1 is a delta function, not a phase function).");
  if (!fin(thetaDeg) || thetaDeg < 0 || thetaDeg > 180) return err("Scattering angle θ: from 0° (straight on) to 180° (straight back).");
  if (!lambdas.length || lambdas.length > 12) return err("Wavelengths: one to twelve of them.");
  for (const l of lambdas) if (!fin(l) || l < 200 || l > 4000) return err(`Wavelength ${fin(l) ? l : "(not a number)"} nm: from 200 to 4000 nm.`);
  const opticalDepth = sigma * distance;
  const zenith = 90 - elevationDeg;
  const am = kastenYoung(zenith);
  if (isErr(am)) return am;
  const p = pressureHpa / 1013.25;
  const tau550 = rayleighTau(0.55) as number;
  const T550 = Math.exp(-tau550 * p * am);
  const beam = lambdas.map((ln) => {
    const tau = (rayleighTau(ln / 1000) as number) * p;
    const T = Math.exp(-tau * am);
    return { lambdaNm: ln, tau, T, rel550: T / T550 };
  });
  const lmin = Math.min(...lambdas);
  const lmax = Math.max(...lambdas);
  return {
    ok: true,
    sigma,
    opticalDepth,
    transmittance: Math.exp(-opticalDepth),
    visibility: sigma > 0 ? KOSCHMIEDER / sigma : null,
    mor: sigma > 0 ? MOR_CONST / sigma : null,
    airMass: am,
    zenith,
    beam,
    T550,
    rayleighRatio: (lmax / lmin) ** 4,
    hg: henyeyGreenstein(g, thetaDeg),
    hgForwardBack: henyeyGreenstein(g, 0) / henyeyGreenstein(g, 180),
  };
}
