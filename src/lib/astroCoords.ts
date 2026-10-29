// Astronomy & lunar, part 2: coordinate systems and their display. Spherical ⇄ vector, equatorial ⇄ ecliptic ⇄
// horizontal ⇄ galactic, precession between epochs, annual aberration, the observer on the WGS84 ellipsoid and
// topocentric parallax, refraction, airmass, angular separation; and sexagesimal parsing and formatting under the
// display contract (12ʰ 34ᵐ 56.7ˢ, −12° 34′ 56″, U+2212, carries that wrap correctly).
//
// SOURCES. Galactic pole and node: the astropy Galactic frame constants (ICRS/FK5 J2000 NGP α = 192.8594812065348°,
// δ = 27.12825118085622°, l of the NCP 122.9319185680026°, after Blaauw et al. 1960 / Liu, Zhu & Zhang 2011).
// Refraction: Sæmundsson (Sky & Telescope 1986, Meeus 16.4) for a true altitude, Bennett (1982, Meeus 16.3) for an
// apparent one, scaled for pressure and temperature (Meeus 16.4 note). Airmass: Kasten & Young (1989), with the
// plane-parallel sec z alongside. Observer: WGS84 (a = 6378.137 km, f = 1/298.257223563).

import { DEG, gast, matMul, matVec, norm2pi, precessionMatrix, rotX, rotZ, transpose, type Mat3 } from "./astroTime";

export type Vec3 = [number, number, number];

export const vec = (lon: number, lat: number, r = 1): Vec3 => [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
export const norm = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);
export const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: readonly number[], k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Longitude in [0, 2π), latitude, length of a vector. */
export function sph(v: readonly number[]): { lon: number; lat: number; r: number } {
  const r = norm(v);
  return { lon: norm2pi(Math.atan2(v[1], v[0])), lat: Math.asin(Math.max(-1, Math.min(1, v[2] / r))), r };
}

/** The angle between two vectors (rad), by atan2 of |a × b| and a·b: accurate at 0 and π alike. */
export const angleBetween = (a: readonly number[], b: readonly number[]): number => Math.atan2(norm(cross(a, b)), dot(a, b));

/** Angular separation of two points on the sphere (rad), Vincenty's form (well conditioned everywhere). */
export function separation(lon1: number, lat1: number, lon2: number, lat2: number): number {
  return angleBetween(vec(lon1, lat1), vec(lon2, lat2));
}

// ---- frames ----

/** Ecliptic → equatorial for obliquity ε (a vector rotation R₁(−ε)). */
export const eclToEq = (eps: number): Mat3 => rotX(-eps);
/** Equatorial → ecliptic. */
export const eqToEcl = (eps: number): Mat3 => rotX(eps);

const NGP_RA = 192.8594812065348 * DEG;
const NGP_DEC = 27.12825118085622 * DEG;
const L_NCP = 122.9319185680026 * DEG;
/**
 * ICRS (≈ FK5 J2000) equatorial → galactic, built from the pole and node rather than typed as nine numbers: the
 * rows are the galactic x (l = 0), y (l = 90°) and z (the NGP) axes in equatorial coordinates. The NCP lies at
 * galactic longitude L_NCP and latitude δ(NGP).
 */
export const EQ_TO_GAL: Mat3 = (() => {
  const zg = vec(NGP_RA, NGP_DEC);
  const w0 = sub([0, 0, 1], scale(zg, Math.sin(NGP_DEC)));
  const w = scale(w0, 1 / norm(w0));
  const w2 = cross(zg, w);
  const c = Math.cos(L_NCP), s = Math.sin(L_NCP);
  const xg = sub(scale(w, c), scale(w2, s));
  const yg = add(scale(w, s), scale(w2, c));
  return [xg, yg, zg] as Mat3;
})();

/** Precess an equatorial direction from one epoch (TT JD) to another through J2000 (IAU 2006 P03, mean equators). */
export function precessBetween(v: readonly number[], fromTT: number, toTT: number): Vec3 {
  const toJ2000 = transpose(precessionMatrix(fromTT));
  return matVec(precessionMatrix(toTT), matVec(toJ2000, v));
}

/** Julian epoch (e.g. 2000.0, 2026.8) as a TT Julian Date. */
export const epochToJd = (ep: number): number => 2451545.0 + (ep - 2000) * 365.25;

/**
 * Annual aberration of a unit direction u for an observer moving at v (both in the same frame; v in units of c):
 * u′ = (u + v − u(u·v)) normalised. First order; the second-order term is below 0.001″.
 */
export function aberrate(u: readonly number[], vOverC: readonly number[]): Vec3 {
  const k = dot(u, vOverC);
  const w = add(sub(u, scale(u, k)), vOverC);
  return scale(w, 1 / norm(w));
}

// ---- observer ----

export interface Site {
  /** Geodetic latitude, rad. */
  lat: number;
  /** East longitude, rad. */
  lon: number;
  /** Height above the WGS84 ellipsoid, m. */
  height: number;
}

const WGS84_A = 6378.137;
const WGS84_F = 1 / 298.257223563;

/** The observer's geocentric position in km in Earth-fixed axes (x to Greenwich on the equator, z to the pole). */
export function siteEcef(site: Site): Vec3 {
  const e2 = WGS84_F * (2 - WGS84_F);
  const s = Math.sin(site.lat);
  const N = WGS84_A / Math.sqrt(1 - e2 * s * s);
  const h = site.height / 1000;
  return [(N + h) * Math.cos(site.lat) * Math.cos(site.lon), (N + h) * Math.cos(site.lat) * Math.sin(site.lon), (N * (1 - e2) + h) * s];
}

/** The observer's position (km) in the true equator and equinox of date, rotated by the apparent sidereal time. */
export function siteTrueOfDate(site: Site, jdUT1: number, jdTT: number): Vec3 {
  return matVec(rotZ(-gast(jdUT1, jdTT)), siteEcef(site));
}

export interface AltAz {
  /** Altitude without refraction (rad). */
  alt: number;
  /** Azimuth from north through east (rad). */
  az: number;
  /** Hour angle (rad), in (−π, π]. */
  ha: number;
}

/** Horizontal coordinates of a true-of-date topocentric direction, at local apparent sidereal time `last`. */
export function altAzOf(ra: number, dec: number, site: Site, last: number): AltAz {
  let ha = norm2pi(last - ra);
  if (ha > Math.PI) ha -= 2 * Math.PI;
  const sl = Math.sin(site.lat), cl = Math.cos(site.lat);
  const sd = Math.sin(dec), cd = Math.cos(dec);
  const east = -cd * Math.sin(ha);
  const north = sd * cl - cd * Math.cos(ha) * sl;
  const up = sd * sl + cd * Math.cos(ha) * cl;
  return { alt: Math.asin(Math.max(-1, Math.min(1, up))), az: norm2pi(Math.atan2(east, north)), ha };
}


// ---- refraction and airmass ----

/** Refraction (rad) for a TRUE (airless) altitude, Sæmundsson, scaled by P/1010 hPa · 283/(273 + T °C). */
export function refractionFromTrue(altTrue: number, pressureHPa = 1010, tempC = 10): number {
  const h = altTrue / DEG;
  if (h < -1.9) return 0;
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG); // arcmin
  return Math.max(0, r) * (pressureHPa / 1010) * (283 / (273 + tempC)) * (DEG / 60);
}


/** Airmass at a true altitude (degrees): Kasten & Young (1989); null below the horizon. */
export function airmassKastenYoung(altDeg: number): number | null {
  if (altDeg <= 0) return null;
  const z = 90 - altDeg;
  return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

// ---------------------------------------------------------------------------------------------------------------
// Sexagesimal parsing and formatting
// ---------------------------------------------------------------------------------------------------------------

const MINUS = "−";

/** Splits a sexagesimal or decimal text into [sign, a, b, c]; accepts 12h34m56s, 12:34:56, 12 34 56, −12°34′56″, 12.5. */
function sexParts(text: string): { neg: boolean; parts: number[] } | null {
  const t = text.trim().replace(/[−–]/g, "-").replace(/[hᵸʰ°dD:'′’mᵐ"″”sˢ]/g, " ").replace(/,/g, ".").trim();
  if (!t) return null;
  const neg = t.startsWith("-");
  const body = t.replace(/^[-+]\s*/, "");
  const toks = body.split(/\s+/).filter(Boolean);
  if (toks.length < 1 || toks.length > 3) return null;
  if (!toks.every((x) => /^(\d+(\.\d*)?|\.\d+)$/.test(x))) return null;
  const parts = toks.map(Number);
  for (let i = 1; i < parts.length; i++) if (parts[i] >= 60) return null;
  for (let i = 0; i < parts.length - 1; i++) if (!Number.isInteger(parts[i])) return null;
  return { neg, parts };
}

/** Hours (RA) from "12h 34m 56.7s", "12:34:56.7", "12 34 56.7" or decimal hours; or degrees with a ° / "deg" suffix. */
export function parseRA(text: string): { hours: number } | { error: string } {
  const raw = (text ?? "").trim();
  if (!raw) return { error: "this field is required." };
  const asDeg = /°|deg\s*$/i.test(raw);
  const p = sexParts(raw.replace(/deg\s*$/i, ""));
  if (!p) return { error: `"${raw}" is not a right ascension (write 12h 34m 56.7s, 12:34:56.7, 12.5826 hours, or 188.74°).` };
  if (p.neg) return { error: `"${raw}" is negative: right ascension runs from 0ʰ to 24ʰ.` };
  const v = p.parts[0] + (p.parts[1] ?? 0) / 60 + (p.parts[2] ?? 0) / 3600;
  const hours = asDeg ? v / 15 : v;
  if (hours >= 24) return { error: `"${raw}" is ${asDeg ? "360° or more" : "24ʰ or more"}: right ascension runs from 0ʰ up to (not including) 24ʰ.` };
  return { hours };
}

/** Degrees from "−12° 34′ 56″", "-12:34:56", "-12 34 56" or decimal degrees; limits checked by the caller. */
export function parseDeg(text: string): { deg: number } | { error: string } {
  const raw = (text ?? "").trim();
  if (!raw) return { error: "this field is required." };
  const p = sexParts(raw.replace(/deg\s*$/i, ""));
  if (!p) return { error: `"${raw}" is not an angle (write −12° 34′ 56″, -12:34:56, or −12.582).` };
  const v = p.parts[0] + (p.parts[1] ?? 0) / 60 + (p.parts[2] ?? 0) / 3600;
  return { deg: p.neg ? -v : v };
}

/**
 * Hours as 12ʰ 34ᵐ 56.7ˢ, rounded once at the last place and carried (59.95ˢ → the next minute; 23ʰ 59ᵐ 59.96ˢ → 0ʰ 00ᵐ 00.0ˢ).
 */
export function fmtHMS(hours: number, secDecimals = 1): string {
  const unit = Math.pow(10, secDecimals);
  let total = Math.round((((hours % 24) + 24) % 24) * 3600 * unit);
  total %= 24 * 3600 * unit;
  const h = Math.floor(total / (3600 * unit));
  total -= h * 3600 * unit;
  const m = Math.floor(total / (60 * unit));
  total -= m * 60 * unit;
  const s = total / unit;
  const sTxt = s.toFixed(secDecimals).padStart(secDecimals ? 3 + secDecimals : 2, "0");
  return `${h}ʰ ${String(m).padStart(2, "0")}ᵐ ${sTxt}ˢ`;
}

/** Degrees as −12° 34′ 56″ (sign kept below 1°: −0° 30′ 00″), carried at the last place; `plus` writes a + on positives. */
export function fmtDMS(deg: number, secDecimals = 0, plus = false): string {
  const neg = deg < 0;
  const unit = Math.pow(10, secDecimals);
  let total = Math.round(Math.abs(deg) * 3600 * unit);
  const d = Math.floor(total / (3600 * unit));
  total -= d * 3600 * unit;
  const m = Math.floor(total / (60 * unit));
  total -= m * 60 * unit;
  const s = total / unit;
  const sTxt = s.toFixed(secDecimals).padStart(secDecimals ? 3 + secDecimals : 2, "0");
  const zero = d === 0 && m === 0 && total === 0;
  const sign = neg && !zero ? MINUS : plus ? "+" : "";
  return `${sign}${d}° ${String(m).padStart(2, "0")}′ ${sTxt}″`;
}

/** A decimal with a true minus. */
export const fx = (x: number, d: number): string => {
  const s = x.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace("-", MINUS);
};
