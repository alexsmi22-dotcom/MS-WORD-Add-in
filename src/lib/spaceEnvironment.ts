// Spacecraft-environment engines for the Spaceflight & missions calculators: ballistic re-entry (Allen–Eggers in closed
// form, checked against a numerical integration with gravity on a real atmosphere), Sutton–Graves stagnation heating,
// orbital decay from drag on the NRLMSIS 2.1 density table at three solar-activity levels, ground-station geometry
// (look angles, coverage, pass duration, slant range and Doppler) on the WGS 84 ellipsoid, and the radiative
// equilibrium temperature of a spacecraft. SI units (m, s, rad, K) throughout.

import { atmosphere } from "./aero";
import { GM_SI, MSIS_ALT_KM, MSIS_RHO, R_EQ_SI, SIGMA_SB, SOLAR_CONSTANT } from "./spaceConstants";
import type { OrbitFail, V3 } from "./spaceOrbit";

const fail = (error: string): OrbitFail => ({ ok: false, error });

export type SolarActivity = "low" | "moderate" | "high";

// ---------------------------------------------------------------------------------------------------------------
// Atmosphere: US Standard 1976 below 86 km (aero.ts), NRLMSIS 2.1 mean above
// ---------------------------------------------------------------------------------------------------------------

/**
 * Density (kg/m³) at a geometric altitude: the US Standard Atmosphere 1976 (aero.ts, layer by layer from its defining
 * constants) up to 86 km, then the NRLMSIS 2.1 global-mean table for the activity level, log-linear between rows. Zero
 * above 1000 km is NOT returned: null, because the table stops there.
 */
export function densityAt(altM: number, activity: SolarActivity = "moderate"): number | null {
  if (!Number.isFinite(altM) || altM < 0) return null;
  const km = altM / 1000;
  if (km <= 84) {
    const a = atmosphere(altM);
    return a ? a.densityKgM3 : null;
  }
  const rho = MSIS_RHO[activity];
  if (km < MSIS_ALT_KM[0]) {
    // 84–86 km: log-linear between the 1976 value at 84 km and the table's first row.
    const a = atmosphere(84000);
    if (!a) return null;
    const f = (km - 84) / (MSIS_ALT_KM[0] - 84);
    return Math.exp(Math.log(a.densityKgM3) * (1 - f) + Math.log(rho[0]) * f);
  }
  if (km > MSIS_ALT_KM[MSIS_ALT_KM.length - 1]) return null;
  let k = 0;
  while (k < MSIS_ALT_KM.length - 2 && MSIS_ALT_KM[k + 1] < km) k++;
  const f = (km - MSIS_ALT_KM[k]) / (MSIS_ALT_KM[k + 1] - MSIS_ALT_KM[k]);
  return Math.exp(Math.log(rho[k]) * (1 - f) + Math.log(rho[k + 1]) * f);
}

// ---------------------------------------------------------------------------------------------------------------
// Ballistic entry
// ---------------------------------------------------------------------------------------------------------------

/** Sutton–Graves constant for Earth air, kg^½/m (NASA TR R-376, 1971: 1.7415×10⁻⁴ in SI). */
export const SUTTON_GRAVES_EARTH = 1.7415e-4;

export interface EntryInput {
  /** Ballistic coefficient m/(C_d·A), kg/m². */
  beta: number;
  /** Entry speed at the interface, m/s. */
  vEntry: number;
  /** Flight-path angle below the horizontal, rad (> 0). */
  gamma: number;
  /** Exponential-atmosphere surface density (kg/m³) and scale height (m) for the closed form. */
  rho0: number;
  H: number;
  /** Nose radius, m (Sutton–Graves). */
  noseR: number;
  /** Sutton–Graves constant, kg^½/m. */
  kSG: number;
  /** Entry interface altitude, m. */
  hEntry: number;
}

export interface EntryResult {
  ok: true;
  /** Peak deceleration, m/s², its altitude (m; may be negative: the ground is reached first) and the speed there. */
  aMax: number;
  hAmax: number;
  vAmax: number;
  /** Peak Sutton–Graves stagnation heat flux (W/m²), its altitude and speed (Allen–Eggers trajectory). */
  qMax: number;
  hQmax: number;
  vQmax: number;
  /** Speed at the ground in the closed form, m/s. */
  vGround: number;
  /** The closed-form profile, altitude descending: h (m), v (m/s), deceleration (m/s²), q (W/m²). */
  profile: Array<{ h: number; v: number; a: number; q: number }>;
  /** A numerical check: 2-D point-mass entry over a spherical Earth with gravity, on the 1976/MSIS atmosphere. */
  numeric: { aMax: number; hAmax: number; vAmax: number; qMax: number; hQmax: number; profile: Array<{ h: number; v: number; a: number }>; ended: "ground" | "slow" | "skip" | "time" } | null;
  peakReached: boolean;
}

/**
 * Allen–Eggers ballistic entry (NACA Report 1381, 1958): straight-line flight at constant γ, gravity neglected next to
 * drag, exponential atmosphere ρ = ρ₀e^(−h/H):
 *   v(h) = v_E·exp(−ρ(h)·H/(2β sin γ)),
 *   a_max = v_E² sin γ/(2eH) at ρ = β sin γ/H (h* = H ln(ρ₀H/(β sin γ))), where v = v_E/√e;
 *   Sutton–Graves q = k√(ρ/r_n)·v³ peaks at ρ = β sin γ/(3H), where v = v_E·e^(−1/6).
 * γ = 0 is refused: the closed form divides by sin γ, and a grazing entry skips or needs lift, which it does not model.
 */
export function ballisticEntry(inp: EntryInput): EntryResult | OrbitFail {
  const { beta, vEntry: vE, gamma, rho0, H, noseR, kSG, hEntry } = inp;
  if (!(beta > 0)) return fail("The ballistic coefficient must be greater than zero.");
  if (!(vE > 0) || vE > 20000) return fail("The entry speed must be above 0 and at most 20 km/s.");
  if (!(gamma > 0)) return fail("A flight-path angle of 0° (or above the horizon) is refused: the Allen–Eggers closed form divides by sin γ, and a grazing entry either skips back out or needs a lifting model, neither of which this is. Enter the angle below the horizontal, for example 6°.");
  if (!(gamma <= Math.PI / 2)) return fail("The flight-path angle must be at most 90° (straight down).");
  if (!(H > 0) || !(rho0 > 0)) return fail("The scale height and the surface density must be greater than zero.");
  if (!(noseR > 0)) return fail("The nose radius must be greater than zero.");
  if (!(kSG > 0)) return fail("The Sutton–Graves constant must be greater than zero.");
  if (!(hEntry > 0)) return fail("The entry interface altitude must be greater than zero.");
  const sg = Math.sin(gamma);
  const K = H / (2 * beta * sg);
  const rhoH = (h: number): number => rho0 * Math.exp(-h / H);
  const vAt = (h: number): number => vE * Math.exp(-K * rhoH(h));
  const aAt = (h: number): number => (rhoH(h) * vAt(h) ** 2) / (2 * beta);
  const qAt = (h: number): number => kSG * Math.sqrt(rhoH(h) / noseR) * vAt(h) ** 3;
  const hA = H * Math.log((rho0 * H) / (beta * sg));
  const hQ = H * Math.log((3 * rho0 * H) / (beta * sg));
  const peakReached = hA > 0;
  const aMax = peakReached ? (vE * vE * sg) / (2 * Math.E * H) : aAt(0);
  const hAm = peakReached ? hA : 0;
  const qPeakReached = hQ > 0;
  const profile: EntryResult["profile"] = [];
  for (let k = 0; k <= 200; k++) {
    const h = hEntry * (1 - k / 200);
    profile.push({ h, v: vAt(h), a: aAt(h), q: qAt(h) });
  }
  const numeric = entryIntegrate(beta, vE, gamma, hEntry, noseR, kSG);
  return {
    ok: true,
    aMax, hAmax: hAm, vAmax: vAt(hAm),
    qMax: qPeakReached ? qAt(hQ) : qAt(0), hQmax: qPeakReached ? hQ : 0, vQmax: vAt(qPeakReached ? hQ : 0),
    vGround: vAt(0), profile, numeric, peakReached,
  };
}

/**
 * The same entry integrated (RK4, 0.05 s steps): planar point mass over a spherical non-rotating Earth with inverse-
 * square gravity and no lift, US 1976 density below 86 km and the NRLMSIS moderate-activity table above. Stops at the
 * ground, below 100 m/s, on climbing back above the interface (a skip), or after two hours.
 */
function entryIntegrate(beta: number, vE: number, gamma: number, hEntry: number, noseR: number, kSG: number): EntryResult["numeric"] {
  if (![beta, vE, gamma, hEntry, noseR, kSG].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0) || vE > 20000 || hEntry > 1e6) return null;
  const mu = GM_SI.earth;
  const Re = R_EQ_SI.earth;
  let r = Re + hEntry;
  let v = vE;
  let g = -gamma;
  let t = 0;
  const dtS = 0.05;
  const deriv = (rr: number, vv: number, gg: number): [number, number, number] | null => {
    const rho = densityAt(rr - Re, "moderate") ?? 0;
    const grav = mu / (rr * rr);
    const D = (rho * vv * vv) / (2 * beta);
    return [vv * Math.sin(gg), -D - grav * Math.sin(gg), (vv / rr - grav / vv) * Math.cos(gg)];
  };
  let best = { a: 0, h: hEntry, v: vE };
  let bestQ = { q: 0, h: hEntry };
  const prof: Array<{ h: number; v: number; a: number }> = [];
  let ended: "ground" | "slow" | "skip" | "time" = "time";
  for (let step = 0; step < 144000; step++) {
    const k1 = deriv(r, v, g);
    if (!k1) return null;
    const k2 = deriv(r + 0.5 * dtS * k1[0], v + 0.5 * dtS * k1[1], g + 0.5 * dtS * k1[2]);
    const k3 = k2 && deriv(r + 0.5 * dtS * k2[0], v + 0.5 * dtS * k2[1], g + 0.5 * dtS * k2[2]);
    const k4 = k3 && deriv(r + dtS * k3[0], v + dtS * k3[1], g + dtS * k3[2]);
    if (!k2 || !k3 || !k4) return null;
    r += (dtS / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    v += (dtS / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    g += (dtS / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    t += dtS;
    const h = r - Re;
    if (h <= 0) {
      ended = "ground";
      break;
    }
    const rho = densityAt(h, "moderate") ?? 0;
    const a = (rho * v * v) / (2 * beta);
    const q = kSG * Math.sqrt(rho / noseR) * v ** 3;
    if (a > best.a) best = { a, h, v };
    if (q > bestQ.q) bestQ = { q, h };
    if (step % 20 === 0) prof.push({ h, v, a });
    if (v < 100) {
      ended = "slow";
      break;
    }
    if (h > hEntry * 1.001) {
      ended = "skip";
      break;
    }
  }
  return { aMax: best.a, hAmax: best.h, vAmax: best.v, qMax: bestQ.q, hQmax: bestQ.h, profile: prof, ended };
}

// ---------------------------------------------------------------------------------------------------------------
// Orbital decay
// ---------------------------------------------------------------------------------------------------------------

export interface DecayResult {
  ok: true;
  /** Days from the start altitude down to the stop altitude, per activity level (null: longer than the cap). */
  lifetimeDays: Record<SolarActivity, number | null>;
  /** Decay rate da/dt at the start altitude, m/day, per activity. */
  rateMPerDay: Record<SolarActivity, number>;
  /** Altitude (m) against time (days) per activity, for the figure. */
  curves: Record<SolarActivity, Array<{ t: number; h: number }>>;
  capDays: number;
  stopAltM: number;
}

/**
 * Circular-orbit decay by drag (King-Hele's quasi-circular rate da/dt = −ρ·√(μa)/β, the orbit staying circular): the
 * NRLMSIS 2.1 global-mean density at the low, moderate and high activity levels, held constant over the lifetime.
 * Integrated in altitude steps of 1 km (dt = da/|ȧ|) down to `stopAltM`; a lifetime longer than `capDays` is reported
 * as such rather than extrapolated.
 */
export function orbitalDecay(altM: number, beta: number, stopAltM = 120e3, capDays = 365.25 * 200): DecayResult | OrbitFail {
  if (!(beta > 0)) return fail("The ballistic coefficient must be greater than zero.");
  if (!(altM > stopAltM)) return fail(`The starting altitude must be above ${stopAltM / 1000} km, where this stops (below it the orbit is re-entering, not decaying).`);
  if (altM > 1000e3) return fail("The density table stops at 1000 km; above it drag lifetimes are centuries to millennia and set by solar-cycle extremes this does not model.");
  const mu = GM_SI.earth;
  const Re = R_EQ_SI.earth;
  const levels: SolarActivity[] = ["low", "moderate", "high"];
  const lifetime = {} as Record<SolarActivity, number | null>;
  const rate = {} as Record<SolarActivity, number>;
  const curves = {} as Record<SolarActivity, Array<{ t: number; h: number }>>;
  for (const lv of levels) {
    const adot = (h: number): number => ((densityAt(h, lv) ?? 0) * Math.sqrt(mu * (Re + h))) / beta; // m/s, magnitude
    rate[lv] = adot(altM) * 86400;
    let t = 0;
    let h = altM;
    const pts: Array<{ t: number; h: number }> = [{ t: 0, h }];
    const dh = 1000;
    let capped = false;
    while (h > stopAltM) {
      const step = Math.min(dh, h - stopAltM);
      // Midpoint rule in altitude: dt = Δh / ȧ(h − Δh/2).
      t += step / adot(h - step / 2);
      h -= step;
      if (t / 86400 > capDays) {
        capped = true;
        break;
      }
      pts.push({ t: t / 86400, h });
    }
    lifetime[lv] = capped ? null : t / 86400;
    curves[lv] = pts;
  }
  return { ok: true, lifetimeDays: lifetime, rateMPerDay: rate, curves, capDays, stopAltM };
}

// ---------------------------------------------------------------------------------------------------------------
// Ground station
// ---------------------------------------------------------------------------------------------------------------

/** WGS 84 defining constants: equatorial radius and flattening. */
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;

/** Geodetic latitude/longitude/height → Earth-fixed position, m (WGS 84). */
export function geodeticToEcef(lat: number, lon: number, h: number): V3 {
  const e2 = WGS84_F * (2 - WGS84_F);
  const N = WGS84_A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * Math.sin(lat)];
}

export interface LookAngles {
  ok: true;
  azimuth: number;
  elevation: number;
  range: number;
  /** East, north, up components of the line of sight, m. */
  enu: V3;
}

/** Azimuth (from north, clockwise), elevation and slant range from a site to an Earth-fixed position. */
export function lookAngles(siteLat: number, siteLon: number, siteH: number, sat: V3): LookAngles {
  const s = geodeticToEcef(siteLat, siteLon, siteH);
  const d: V3 = [sat[0] - s[0], sat[1] - s[1], sat[2] - s[2]];
  const sl = Math.sin(siteLat), cl = Math.cos(siteLat), so = Math.sin(siteLon), co = Math.cos(siteLon);
  const e = -so * d[0] + co * d[1];
  const n = -sl * co * d[0] - sl * so * d[1] + cl * d[2];
  const u = cl * co * d[0] + cl * so * d[1] + sl * d[2];
  const range = Math.hypot(e, n, u);
  let az = Math.atan2(e, n);
  if (az < 0) az += 2 * Math.PI;
  return { ok: true, azimuth: az, elevation: Math.asin(u / range), range, enu: [e, n, u] };
}

export interface CoverageResult {
  ok: true;
  /** Earth central angle from the sub-satellite point to the edge of coverage, rad. */
  lambda: number;
  /** Nadir angle at the satellite to that edge, rad. */
  eta: number;
  /** Ground radius of the footprint (arc), m, and the swath (twice it). */
  footprintRadius: number;
  swath: number;
  /** Slant range at the minimum elevation, m. */
  slantMax: number;
  /** Fraction of Earth's surface inside the footprint. */
  areaFraction: number;
  /** Circular orbit period, speed, and the longest pass (directly overhead, Earth rotation neglected), s. */
  period: number;
  speed: number;
  maxPass: number;
  /** Largest range rate over that pass (m/s, at the minimum elevation) and the Doppler shift at `freqHz`. */
  rangeRateMax: number;
  dopplerHz: number;
}

/**
 * Coverage of a circular orbit of altitude h above a spherical Earth of radius R for a minimum elevation ε
 * (Wertz, Space Mission Engineering §8): sin η = R cos ε/(R + h), λ = 90° − ε − η. The longest pass is the overhead one,
 * 2λ/n with the Earth's rotation neglected; its largest range rate is at the edge, ṙ = R(R+h)·n·sin λ/ρ.
 */
export function coverage(altM: number, minElev: number, freqHz: number): CoverageResult | OrbitFail {
  const R = R_EQ_SI.earth;
  const mu = GM_SI.earth;
  if (!(altM > 0)) return fail("The orbit altitude must be greater than zero.");
  if (!(minElev >= 0 && minElev < Math.PI / 2)) return fail("The minimum elevation must be from 0° up to (not including) 90°.");
  if (!(freqHz >= 0)) return fail("The carrier frequency must be zero or more.");
  const r = R + altM;
  const eta = Math.asin((R * Math.cos(minElev)) / r);
  const lambda = Math.PI / 2 - minElev - eta;
  const slant = R * Math.sin(lambda) / Math.sin(eta);
  const n = Math.sqrt(mu / (r * r * r));
  const rr = (R * r * n * Math.sin(lambda)) / slant;
  return {
    ok: true, lambda, eta, footprintRadius: R * lambda, swath: 2 * R * lambda, slantMax: slant,
    areaFraction: (1 - Math.cos(lambda)) / 2, period: (2 * Math.PI) / n, speed: Math.sqrt(mu / r),
    maxPass: (2 * lambda) / n, rangeRateMax: rr, dopplerHz: (freqHz * rr) / 299792458,
  };
}

/** Points (lon, lat in rad) on the small circle of angular radius λ about (lat0, lon0), longitude wrapped to (−π, π]. */
export function footprintCircle(lat0: number, lon0: number, lambda: number, n = 180): Array<{ lon: number; lat: number }> {
  if (![lat0, lon0, lambda, n].every((x) => typeof x === "number" && Number.isFinite(x))) return [];
  const out: Array<{ lon: number; lat: number }> = [];
  const m = Number.isFinite(n) ? Math.max(8, Math.min(2000, Math.round(n))) : 180;
  for (let k = 0; k <= m; k++) {
    const az = (2 * Math.PI * k) / m;
    const lat = Math.asin(Math.sin(lat0) * Math.cos(lambda) + Math.cos(lat0) * Math.sin(lambda) * Math.cos(az));
    const lon = lon0 + Math.atan2(Math.sin(az) * Math.sin(lambda) * Math.cos(lat0), Math.cos(lambda) - Math.sin(lat0) * Math.sin(lat));
    out.push({ lon: Math.atan2(Math.sin(lon), Math.cos(lon)), lat });
  }
  return out;
}


// ---------------------------------------------------------------------------------------------------------------
// Thermal balance
// ---------------------------------------------------------------------------------------------------------------

export interface ThermalInput {
  alpha: number;
  eps: number;
  /** Distance from the Sun, m. */
  distM: number;
  /** Area projected toward the Sun, m²; total radiating area, m². */
  aSun: number;
  aRad: number;
  /** Planet: albedo fraction, IR flux at the planet's surface (W/m²), view factor to it, and the area facing it (m²). */
  albedo: number;
  planetIR: number;
  viewF: number;
  aPlanet: number;
  /** Internal dissipation, W. */
  power: number;
}

export interface ThermalResult {
  ok: true;
  solarFlux: number;
  /** Absorbed powers, W: direct sun, albedo, planet IR, internal. */
  qSun: number;
  qAlbedo: number;
  qIR: number;
  qInt: number;
  /** Hot case (sunlit) and cold case (eclipse: no sun, no albedo), K. */
  tHot: number;
  tCold: number;
}

/**
 * Single-node radiative equilibrium (Gilmore, Spacecraft Thermal Control Handbook ch. 2): εσA_rad·T⁴ = αS·A_sun +
 * αSa·F·A_planet + εq_IR·F·A_planet + Q, with S = 1361 W/m²·(1 au/d)², deep space at 0 K, the whole craft at one
 * temperature. The cold case drops the Sun and the albedo (an eclipse).
 */
export function thermalBalance(inp: ThermalInput): ThermalResult | OrbitFail {
  const { alpha, eps, distM, aSun, aRad, albedo, planetIR, viewF, aPlanet, power } = inp;
  if (!(alpha >= 0 && alpha <= 1)) return fail("The solar absorptance α must be from 0 to 1.");
  if (!(eps > 0 && eps <= 1)) return fail("The infrared emittance ε must be above 0 and at most 1 (a surface with ε = 0 cannot radiate, so it has no equilibrium).");
  if (!(distM > 0)) return fail("The distance from the Sun must be greater than zero.");
  if (distM < 0.01 * 149597870700) return fail("Closer than 0.01 au the Sun is not a point source and the inverse-square flux is meaningless; this calculator stops there.");
  if (!(aSun >= 0) || !(aRad > 0)) return fail("The sunlit area must be zero or more and the radiating area greater than zero.");
  if (aSun > aRad) return fail("The area facing the Sun cannot exceed the total radiating area (a convex body shows at most a quarter of its surface to the Sun as a sphere, half as a flat plate).");
  if (!(albedo >= 0 && albedo <= 1)) return fail("The planetary albedo must be from 0 to 1.");
  if (!(viewF >= 0 && viewF <= 1)) return fail("The view factor to the planet must be from 0 to 1.");
  if (!(planetIR >= 0) || !(aPlanet >= 0) || !(power >= 0)) return fail("The planet IR flux, the planet-facing area and the internal power must be zero or more.");
  const S = SOLAR_CONSTANT * (149597870700 / distM) ** 2;
  const qSun = alpha * S * aSun;
  const qAlbedo = alpha * S * albedo * viewF * aPlanet;
  const qIR = eps * planetIR * viewF * aPlanet;
  const den = eps * SIGMA_SB * aRad;
  const tHot = Math.pow((qSun + qAlbedo + qIR + power) / den, 0.25);
  const tCold = Math.pow((qIR + power) / den, 0.25);
  return { ok: true, solarFlux: S, qSun, qAlbedo, qIR, qInt: power, tHot, tCold };
}

/** Equilibrium temperature (K) of a body with the given α/ε and area ratio at distance d (no planet, no power). */
export const tempAtDistance = (alphaOverEps: number, areaRatio: number, distM: number): number =>
  Math.pow((alphaOverEps * SOLAR_CONSTANT * (149597870700 / distM) ** 2 * areaRatio) / SIGMA_SB, 0.25);

