// Astronomy & lunar, part 1: calendars, Julian Dates, the time scales (UTC, TAI, TT, UT1, ΔT), Earth rotation
// (ERA, GMST, GAST), the obliquity, nutation and precession. Pure functions; no Office.js, no network.
//
// SOURCES AND ACCURACY (each measured against an independent oracle in astroTime.test.ts / astroOracle.test.ts):
//   - Julian Date ⇄ calendar: Meeus, Astronomical Algorithms (2nd ed.), ch. 7. Dates from 1582-10-15 are Gregorian,
//     earlier ones Julian (the convention of Meeus and of the astronomical almanacs); 1582-10-05…14 never existed and
//     are refused by name. Years use astronomical numbering: year 0 = 1 BC, year −1 = 2 BC.
//   - TAI − UTC: the IERS leap-second table (astroData.ts, generated), valid 1972-01-01 to its stated expiry. Inside
//     that window TT = UTC + (TAI − UTC) + 32.184 s exactly and UT1 is taken equal to UTC (|UT1 − UTC| < 0.9 s by
//     definition of UTC). Outside it ΔT = TT − UT comes from the Espenak–Meeus polynomials (NASA, "Polynomial
//     Expressions for Delta T", 2006), and the input is read as UT.
//   - ERA and GMST: IAU 2006 (Capitaine et al. 2003; IERS Conventions 2010 eq. 5.15 and 5.32). GAST adds the
//     equation of the equinoxes Δψ cos ε plus its two largest complementary terms.
//   - Mean obliquity: IAU 2006 (IERS Conventions 2010 eq. 5.40).
//   - Nutation: Meeus table 22.A (IAU 1980 theory, terms below 0.0003″ dropped), generated into astroData.ts;
//     within 0.001″ of the full 106-term IAU 1980 series and about 0.05″ of IAU 2000A.
//   - Precession: IAU 2006 P03 angles ζA, zA, θA (Capitaine, Wallace & Chapront 2003; IERS Conventions 2010 eq.
//     5.40). Frame bias (23 mas) is ignored: J2000 here is the mean equator and equinox of J2000.0, within 0.03″ of
//     the ICRS.

import { LEAP_SECONDS, LEAP_SECONDS_EXPIRY, NUTATION_22A } from "./astroData";

export const DEG = Math.PI / 180;
export const ARCSEC = DEG / 3600;
export const J2000 = 2451545.0;
/** Julian Date of 1582-10-15 0h, the first Gregorian day. */
export const JD_GREGORIAN_START = 2299160.5;
const MJD0 = 2400000.5;

export type CalendarMode = "auto" | "gregorian" | "julian";
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

/** Normalises an angle to [0, 2π). */
export const norm2pi = (x: number): number => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** Normalises degrees to [0, 360). */
export const norm360 = (x: number): number => ((x % 360) + 360) % 360;

// ---------------------------------------------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------------------------------------------

export function isLeapYear(year: number, gregorian: boolean): boolean {
  if (!gregorian) return ((year % 4) + 4) % 4 === 0;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number, gregorian: boolean): number {
  return [31, isLeapYear(year, gregorian) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Julian Date of a calendar date (Meeus 7.1). `day` may carry a fraction. In "auto" mode dates before 1582-10-15 are
 * Julian; 1582-10-05…14 are refused because they never happened in the Gregorian reform.
 */
export function jdFromCalendar(year: number, month: number, day: number, mode: CalendarMode = "auto"): number | { error: string } {
  if (![year, month, day].every(Number.isFinite)) return { error: "The date must be finite numbers." };
  if (!Number.isInteger(year)) return { error: `The year must be a whole number (astronomical numbering: 0 = 1 BC, −1 = 2 BC); got ${year}.` };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: `The month must be 1 to 12; got ${month}.` };
  const iday = Math.floor(day);
  const gregorian =
    mode === "gregorian" ? true : mode === "julian" ? false : year > 1582 || (year === 1582 && (month > 10 || (month === 10 && iday >= 15)));
  if (mode === "auto" && year === 1582 && month === 10 && iday >= 5 && iday <= 14)
    return { error: `1582-10-${String(iday).padStart(2, "0")} does not exist: the Gregorian reform followed Thursday 4 October 1582 (Julian) with Friday 15 October 1582 (Gregorian). Choose the Julian or proleptic Gregorian calendar explicitly to name that day.` };
  if (iday < 1 || iday > daysInMonth(year, month, gregorian)) return { error: `Day ${iday} is not in ${year}-${String(month).padStart(2, "0")} (${daysInMonth(year, month, gregorian)} days in the ${gregorian ? "Gregorian" : "Julian"} calendar).` };
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  let b = 0;
  if (gregorian) {
    const a = Math.floor(y / 100);
    b = 2 - a + Math.floor(a / 4);
  }
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

export interface CalendarDate {
  year: number;
  month: number;
  /** Day of the month with its fraction. */
  day: number;
  calendar: "gregorian" | "julian";
}

/** The calendar date of a Julian Date (Meeus ch. 7); Julian before JD 2299160.5 in "auto" mode. JD ≥ 0 required by the algorithm; extended below 0 by whole 400-year (Gregorian) / 4-year (Julian) cycles. */
export function calendarFromJd(jd: number, mode: CalendarMode = "auto"): CalendarDate {
  const gregorian = mode === "gregorian" ? true : mode === "julian" ? false : jd >= JD_GREGORIAN_START;
  // Shift negative JDs up by whole cycles: 146097 days per 400 Gregorian years, 1461 per 4 Julian years.
  let shiftYears = 0;
  let j = jd;
  if (j < 0) {
    const cycleDays = gregorian ? 146097 : 1461;
    const cycleYears = gregorian ? 400 : 4;
    const n = Math.ceil(-j / cycleDays) + 1;
    j += n * cycleDays;
    shiftYears = n * cycleYears;
  }
  const z0 = Math.floor(j + 0.5);
  const f = j + 0.5 - z0;
  let a = z0;
  if (gregorian) {
    const alpha = Math.floor((z0 - 1867216.25) / 36524.25);
    a = z0 + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  const year = (month > 2 ? c - 4716 : c - 4715) - shiftYears;
  return { year, month, day, calendar: gregorian ? "gregorian" : "julian" };
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Day of the week of the civil day containing JD (0 = Sunday), Meeus ch. 7. */
export const dayOfWeek = (jd: number): number => ((Math.floor(jd + 1.5) % 7) + 7) % 7;

/** Day of the year (1 = 1 January), Meeus ch. 7. */
export function dayOfYear(year: number, month: number, day: number, gregorian: boolean): number {
  const k = isLeapYear(year, gregorian) ? 1 : 2;
  return Math.floor((275 * month) / 9) - k * Math.floor((month + 9) / 12) + Math.floor(day) - 30;
}

/** Decimal year of a JD (for ΔT): 2000.0 at J2000, Julian years. */
export const decimalYear = (jd: number): number => 2000 + (jd - J2000) / 365.25;

// ---------------------------------------------------------------------------------------------------------------
// ΔT and leap seconds
// ---------------------------------------------------------------------------------------------------------------

/**
 * ΔT = TT − UT in seconds by the Espenak–Meeus polynomials (NASA Five Millennium Canon, 2006), for a decimal year.
 * Their stated uncertainty grows from under a second in the 20th century to minutes before 1000 and hours at −2000.
 * The 2005–2050 branch was a 2006 extrapolation: by 2026 it runs about 4–5 s ahead of the observed value (≈ 69 s).
 */
export function deltaTEspenakMeeus(y: number): number {
  if (y < -500) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (y < 500) {
    const u = y / 100;
    return 10583.6 + u * (-1014.41 + u * (33.78311 + u * (-5.952053 + u * (-0.1798452 + u * (0.022174192 + u * 0.0090316521)))));
  }
  if (y < 1600) {
    const u = (y - 1000) / 100;
    return 1574.2 + u * (-556.01 + u * (71.23472 + u * (0.319781 + u * (-0.8503463 + u * (-0.005050998 + u * 0.0083572073)))));
  }
  if (y < 1700) {
    const t = y - 1600;
    return 120 - 0.9808 * t - 0.01532 * t * t + (t * t * t) / 7129;
  }
  if (y < 1800) {
    const t = y - 1700;
    return 8.83 + t * (0.1603 + t * (-0.0059285 + t * (0.00013336 - t / 1174000)));
  }
  if (y < 1860) {
    const t = y - 1800;
    return 13.72 + t * (-0.332447 + t * (0.0068612 + t * (0.0041116 + t * (-0.00037436 + t * (0.0000121272 + t * (-0.0000001699 + t * 0.000000000875))))));
  }
  if (y < 1900) {
    const t = y - 1860;
    return 7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * (-0.0004473624 + t / 233174))));
  }
  if (y < 1920) {
    const t = y - 1900;
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - 0.000197 * t)));
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.2 + t * (0.84493 + t * (-0.0761 + 0.0020936 * t));
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + (t * t * t) / 2547;
  }
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718;
  }
  if (y < 2005) {
    const t = y - 2000;
    return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))));
  }
  if (y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (y < 2150) {
    const u = (y - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - y);
  }
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** MJD of 1972-01-01 (first row of the leap-second table) and of the table's expiry. */
export const LEAP_TABLE_START_MJD = LEAP_SECONDS[0][0];
export const LEAP_TABLE_EXPIRY_MJD = (jdFromCalendar(LEAP_SECONDS_EXPIRY.year, LEAP_SECONDS_EXPIRY.month, LEAP_SECONDS_EXPIRY.day, "gregorian") as number) - MJD0;
export const LEAP_TABLE_EXPIRY_TEXT = `${LEAP_SECONDS_EXPIRY.year}-${String(LEAP_SECONDS_EXPIRY.month).padStart(2, "0")}-${String(LEAP_SECONDS_EXPIRY.day).padStart(2, "0")}`;

/** TAI − UTC (s) for a UTC Julian Date; null before 1972 (the leap-second era) or after the table's expiry. */
export function taiMinusUtc(jdUtc: number): number | null {
  const mjd = jdUtc - MJD0;
  if (mjd < LEAP_TABLE_START_MJD || mjd >= LEAP_TABLE_EXPIRY_MJD) return null;
  let v = LEAP_SECONDS[0][1];
  for (const [start, dat] of LEAP_SECONDS) if (mjd >= start) v = dat;
  return v;
}

export interface TimeScales {
  /** The instant as entered, read as UTC (or as UT outside the leap-second table). */
  jdUTC: number;
  jdUT1: number;
  jdTT: number;
  /** TAI, inside the leap-second table only. */
  jdTAI: number | null;
  /** TT − UT1 used, s. */
  deltaT: number;
  /** TAI − UTC, s (null outside the table). */
  taiUtc: number | null;
  source: "leap-seconds" | "deltaT-polynomial";
  notes: string[];
}

/**
 * The time scales for an instant typed as UTC. Inside the leap-second table TT = UTC + (TAI − UTC) + 32.184 s and
 * UT1 = UTC (within 0.9 s); outside it the instant is UT and TT = UT + ΔT(Espenak–Meeus).
 */
export function scalesFromUTC(jdUtc: number): TimeScales {
  const dat = taiMinusUtc(jdUtc);
  const notes: string[] = [];
  if (dat !== null) {
    const tai = jdUtc + dat / 86400;
    const tt = tai + 32.184 / 86400;
    return { jdUTC: jdUtc, jdUT1: jdUtc, jdTT: tt, jdTAI: tai, deltaT: dat + 32.184, taiUtc: dat, source: "leap-seconds", notes };
  }
  const mjd = jdUtc - MJD0;
  const dt = deltaTEspenakMeeus(decimalYear(jdUtc));
  if (mjd >= LEAP_TABLE_EXPIRY_MJD)
    notes.push(`The date is past the leap-second table's expiry (${LEAP_TABLE_EXPIRY_TEXT}): a leap second announced since then is not known here, so UTC is read as UT and TT = UT + ΔT from the Espenak–Meeus polynomial (${fmtFixed(dt, 1)} s; that 2006 extrapolation ran about 4 to 5 s above the observed ΔT by 2026, so expect seconds of error in clock times).`);
  else notes.push(`Before 1972 there are no leap seconds: the time is read as UT, and TT = UT + ΔT with ΔT = ${fmtFixed(dt, 1)} s from the Espenak–Meeus polynomial.`);
  return { jdUTC: jdUtc, jdUT1: jdUtc, jdTT: jdUtc + dt / 86400, jdTAI: null, deltaT: dt, taiUtc: null, source: "deltaT-polynomial", notes };
}

/** The UTC (or UT) instant of a TT Julian Date: the inverse of scalesFromUTC (two fixed-point passes). */
export function utcFromTT(jdTT: number): number {
  let u = jdTT - 69.184 / 86400;
  for (let i = 0; i < 4; i++) u = jdTT - scalesFromUTC(u).deltaT / 86400;
  return u;
}

const fmtFixed = (x: number, d: number): string => x.toFixed(d).replace("-", "−");

// ---------------------------------------------------------------------------------------------------------------
// Earth rotation, obliquity, nutation, precession
// ---------------------------------------------------------------------------------------------------------------

/** Julian centuries of TT from J2000. */
export const centuriesTT = (jdTT: number): number => (jdTT - J2000) / 36525;

/** Earth rotation angle (rad), IAU 2000: 2π(0.7790572732640 + 1.00273781191135448·Du), Du = UT1 − J2000. */
export function earthRotationAngle(jdUT1: number): number {
  const du = jdUT1 - J2000;
  const frac = (jdUT1 % 1) + (J2000 % 1);
  return norm2pi(2 * Math.PI * (frac + 0.7790572732640 + 0.00273781191135448 * du));
}

/** Greenwich mean sidereal time (rad), IAU 2006: ERA plus the precession polynomial in TT. */
export function gmst(jdUT1: number, jdTT: number): number {
  const t = centuriesTT(jdTT);
  const p = 0.014506 + t * (4612.156534 + t * (1.3915817 + t * (-0.00000044 + t * (-0.000029956 + t * -0.0000000368))));
  return norm2pi(earthRotationAngle(jdUT1) + p * ARCSEC);
}

/** Mean obliquity of the ecliptic (rad), IAU 2006. */
export function meanObliquity(jdTT: number): number {
  const t = centuriesTT(jdTT);
  return (84381.406 + t * (-46.836769 + t * (-0.0001831 + t * (0.0020034 + t * (-0.000000576 + t * -0.0000000434))))) * ARCSEC;
}

/** Fundamental arguments of Meeus ch. 22 (rad): D, M, M′, F, Ω. */
function nutationArgs(t: number): [number, number, number, number, number] {
  const D = 297.85036 + t * (445267.11148 + t * (-0.0019142 + t / 189474));
  const M = 357.52772 + t * (35999.05034 + t * (-0.0001603 - t / 300000));
  const Mp = 134.96298 + t * (477198.867398 + t * (0.0086972 + t / 56250));
  const F = 93.27191 + t * (483202.017538 + t * (-0.0036825 + t / 327270));
  const O = 125.04452 + t * (-1934.136261 + t * (0.0020708 + t / 450000));
  return [D * DEG, M * DEG, Mp * DEG, F * DEG, O * DEG];
}

/** Nutation in longitude and obliquity (rad), Meeus table 22.A. */
export function nutation(jdTT: number): { dpsi: number; deps: number } {
  const t = centuriesTT(jdTT);
  const [D, M, Mp, F, O] = nutationArgs(t);
  let dpsi = 0;
  let deps = 0;
  for (let i = NUTATION_22A.length - 1; i >= 0; i--) {
    const r = NUTATION_22A[i];
    const arg = r[0] * D + r[1] * M + r[2] * Mp + r[3] * F + r[4] * O;
    dpsi += Math.sin(arg) * (r[5] + r[6] * t);
    deps += Math.cos(arg) * (r[7] + r[8] * t);
  }
  return { dpsi: dpsi * 0.0001 * ARCSEC, deps: deps * 0.0001 * ARCSEC };
}

/** True obliquity ε = ε₀ + Δε (rad). */
export const trueObliquity = (jdTT: number): number => meanObliquity(jdTT) + nutation(jdTT).deps;

/** Greenwich apparent sidereal time (rad): GMST + Δψ cos ε + the two largest complementary terms. */
export function gast(jdUT1: number, jdTT: number): number {
  const { dpsi, deps } = nutation(jdTT);
  const eps = meanObliquity(jdTT) + deps;
  const O = nutationArgs(centuriesTT(jdTT))[4];
  const ct = (0.00264096 * Math.sin(O) + 0.00006352 * Math.sin(2 * O)) * ARCSEC;
  return norm2pi(gmst(jdUT1, jdTT) + dpsi * Math.cos(eps) + ct);
}

// ---- 3×3 rotations ----

export function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
}
export function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
export function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}
export function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
export const matVec = (m: Mat3, v: readonly number[]): [number, number, number] => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export const transpose = (m: Mat3): Mat3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];

/**
 * Precession matrix (IAU 2006, P03 angles) from the mean equator and equinox of J2000 to those of the date:
 * P = R₃(−zA)·R₂(θA)·R₃(−ζA). Multiply a J2000 equatorial vector by it to get the mean-of-date vector.
 */
export function precessionMatrix(jdTT: number): Mat3 {
  const t = centuriesTT(jdTT);
  const zeta = (2.650545 + t * (2306.083227 + t * (0.2988499 + t * (0.01801828 + t * (-0.000005971 + t * -0.0000003173))))) * ARCSEC;
  const z = (-2.650545 + t * (2306.077181 + t * (1.0927348 + t * (0.01826837 + t * (-0.000028596 + t * -0.0000002904))))) * ARCSEC;
  const theta = t * (2004.191903 + t * (-0.4294934 + t * (-0.04182264 + t * (-0.000007089 + t * -0.0000001274)))) * ARCSEC;
  return matMul(rotZ(-z), matMul(rotY(theta), rotZ(-zeta)));
}

/** Nutation matrix: mean equator/equinox of date to true equator/equinox of date, N = R₁(−ε)·R₃(−Δψ)·R₁(ε₀). */
export function nutationMatrix(jdTT: number): Mat3 {
  const eps0 = meanObliquity(jdTT);
  const { dpsi, deps } = nutation(jdTT);
  return matMul(rotX(-(eps0 + deps)), matMul(rotZ(-dpsi), rotX(eps0)));
}

/** J2000 mean equatorial → true equatorial of date (precession then nutation). */
export const precessNutate = (jdTT: number): Mat3 => matMul(nutationMatrix(jdTT), precessionMatrix(jdTT));
