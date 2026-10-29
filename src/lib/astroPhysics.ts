// Astronomy & lunar, part 5: telescopes and cameras, stellar magnitudes, distance and luminosity, cosmological
// distances, Kepler's third law with exoplanet transits and radial velocity, and surface gravity, tides and day
// length on the planets and major moons. Closed forms (and one quadrature), each with its assumptions returned.
//
// CONSTANTS: IAU 2015 Resolution B3 nominal solar values (L☉ = 3.828×10²⁶ W, R☉ = 6.957×10⁸ m, T☉ = 5772 K,
// M_bol☉ = 4.74); CODATA 2018 G and σ (heat2.ts SIGMA_SB); Wien b = 2.897771955×10⁻³ m·K (CODATA 2018); IAU 2012 au,
// IAU 2015 pc (648000/π au); μ of the Sun, Earth and Jupiter from orbital.ts BODIES; body radii, masses and periods
// from JPL SSD (astroData.ts PLANET_PHYS, MOON_PHYS, generated).

import { MOON_PHYS, PLANET_PHYS } from "./astroData";
import { SIGMA_SB } from "./heat2";
import { bodyById } from "./orbital";

export const G = 6.6743e-11;
export const L_SUN = 3.828e26;
export const R_SUN = 6.957e8;
export const T_SUN = 5772;
export const MBOL_SUN = 4.74;
export const WIEN_B = 2.897771955e-3;
export const AU_M = 1.495978707e11;
export const PC_M = (648000 / Math.PI) * AU_M;
export const LY_M = 9460730472580800;
export const C_M_S = 299792458;
export const MPC_KM = PC_M / 1e3 * 1e6;
export const GYR_S = 3.15576e16;
export const MU_SUN = bodyById("sun")!.mu;
export const MU_EARTH = bodyById("earth")!.mu;
export const MU_JUPITER = bodyById("jupiter")!.mu;
export const R_EARTH_M = 6.3781e6;
export const R_JUP_M = 7.1492e7;
const RAD_ARCSEC = 206264.80624709636;

export interface Err {
  ok: false;
  error: string;
}
const err = (error: string): Err => ({ ok: false, error });
const pos = (pairs: Array<[string, number | null]>): Err | null => {
  for (const [name, v] of pairs) {
    if (v === null) continue;
    if (!Number.isFinite(v)) return err(`${name} must be a finite number.`);
    if (v <= 0) return err(`${name} must be greater than zero.`);
  }
  return null;
};

// ---------------------------------------------------------------------------------------------------------------
// Telescope and camera
// ---------------------------------------------------------------------------------------------------------------

export interface TelescopeIn {
  apertureMm: number;
  focalMm: number;
  eyepieceMm: number | null;
  afovDeg: number | null;
  pupilMm: number;
  eyeLimit: number;
  transmission: number;
  wavelengthNm: number;
  seeingArcsec: number | null;
  pixelUm: number | null;
  sensorWmm: number | null;
  sensorHmm: number | null;
}

export interface TelescopeOut {
  ok: true;
  focalRatio: number;
  magnification: number | null;
  trueFovDeg: number | null;
  exitPupilMm: number | null;
  dawesArcsec: number;
  rayleighArcsec: number;
  limitingMag: number;
  /** Aperture actually used by the eye (stopped down when the exit pupil exceeds the eye's). */
  effectiveApertureMm: number;
  minUsefulMag: number;
  maxUsefulMag: number;
  plateScaleArcsecPerMm: number;
  pixelScale: number | null;
  samplesPerSeeing: number | null;
  sampling: "under" | "good" | "over" | null;
  cameraFovArcmin: [number, number] | null;
  notes: string[];
}

export function telescope(i: TelescopeIn): TelescopeOut | Err {
  const bad = pos([
    ["The aperture", i.apertureMm], ["The focal length", i.focalMm], ["The eyepiece focal length", i.eyepieceMm], ["The eyepiece apparent field", i.afovDeg],
    ["The eye pupil", i.pupilMm], ["The wavelength", i.wavelengthNm], ["The seeing", i.seeingArcsec], ["The pixel size", i.pixelUm], ["The sensor width", i.sensorWmm], ["The sensor height", i.sensorHmm],
  ]);
  if (bad) return bad;
  if (!(i.transmission > 0 && i.transmission <= 1)) return err("The optical transmission must be a fraction above 0 and at most 1.");
  if (!Number.isFinite(i.eyeLimit) || i.eyeLimit < 1 || i.eyeLimit > 8.5) return err("The naked-eye limiting magnitude must be between 1 and 8.5 (6 under a dark rural sky).");
  if (i.afovDeg !== null && i.afovDeg >= 180) return err("The eyepiece apparent field must be under 180°.");
  if (i.focalMm < i.apertureMm * 0.5) return err(`A focal length of ${i.focalMm} mm on a ${i.apertureMm} mm aperture is f/${(i.focalMm / i.apertureMm).toFixed(2)}, faster than f/0.5: no real telescope; check the two values.`);
  if ((i.sensorWmm === null) !== (i.sensorHmm === null)) return err("Give both the sensor width and height, or neither.");
  const notes: string[] = [];
  const N = i.focalMm / i.apertureMm;
  const mag = i.eyepieceMm === null ? null : i.focalMm / i.eyepieceMm;
  const exitPupil = mag === null ? null : i.apertureMm / mag;
  const trueFov = mag !== null && i.afovDeg !== null ? i.afovDeg / mag : null;
  const effAp = exitPupil !== null && exitPupil > i.pupilMm ? (mag as number) * i.pupilMm : i.apertureMm;
  if (exitPupil !== null && exitPupil > i.pupilMm)
    notes.push(`The exit pupil (${exitPupil.toFixed(1)} mm) is wider than the eye's ${i.pupilMm} mm: the eye uses only ${effAp.toFixed(0)} mm of the aperture, so this eyepiece wastes light (and shows the secondary's shadow on a reflector).`);
  const lim = i.eyeLimit + 5 * Math.log10(effAp / i.pupilMm) + 2.5 * Math.log10(i.transmission);
  const ps = 206264.80624709636 / i.focalMm;
  const pixelScale = i.pixelUm === null ? null : (ps * i.pixelUm) / 1000;
  const samples = pixelScale !== null && i.seeingArcsec !== null ? i.seeingArcsec / pixelScale : null;
  const sampling = samples === null ? null : samples < 2 ? "under" : samples > 3.5 ? "over" : "good";
  const cam: [number, number] | null =
    i.sensorWmm !== null && i.sensorHmm !== null
      ? [(2 * Math.atan(i.sensorWmm / (2 * i.focalMm)) * RAD_ARCSEC) / 60, (2 * Math.atan(i.sensorHmm / (2 * i.focalMm)) * RAD_ARCSEC) / 60]
      : null;
  return {
    ok: true,
    focalRatio: N,
    magnification: mag,
    trueFovDeg: trueFov,
    exitPupilMm: exitPupil,
    dawesArcsec: 116 / i.apertureMm,
    rayleighArcsec: 1.21966989 * (i.wavelengthNm * 1e-9) / (i.apertureMm * 1e-3) * RAD_ARCSEC,
    limitingMag: lim,
    effectiveApertureMm: effAp,
    minUsefulMag: i.apertureMm / i.pupilMm,
    maxUsefulMag: 2 * i.apertureMm,
    plateScaleArcsecPerMm: ps,
    pixelScale,
    samplesPerSeeing: samples,
    sampling,
    cameraFovArcmin: cam,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Stars: magnitudes, distance, luminosity
// ---------------------------------------------------------------------------------------------------------------

/** Distance modulus μ = m − M − A = 5 log₁₀(d / 10 pc). */
export const distanceModulus = (dPc: number): number => 5 * Math.log10(dPc / 10);
export const distanceFromModulus = (mu: number): number => 10 * Math.pow(10, mu / 5);

export interface StarIn {
  m: number | null;
  M: number | null;
  dPc: number | null;
  parallaxMas: number | null;
  extinction: number;
  L: number | null; // L☉
  R: number | null; // R☉
  T: number | null; // K
}

export interface StarOut {
  ok: true;
  m: number | null;
  M: number | null;
  dPc: number | null;
  parallaxMas: number | null;
  mu: number | null;
  L: number | null;
  R: number | null;
  T: number | null;
  wienNm: number | null;
  fluxWm2: number | null;
  mbol: number | null;
  derived: string[];
  notes: string[];
}

export function star(i: StarIn): StarOut | Err {
  const bad = pos([["The distance", i.dPc], ["The luminosity", i.L], ["The radius", i.R], ["The temperature", i.T]]);
  if (bad) return bad;
  for (const [n, v] of [["The apparent magnitude", i.m], ["The absolute magnitude", i.M]] as Array<[string, number | null]>)
    if (v !== null && (!Number.isFinite(v) || Math.abs(v) > 40)) return err(`${n} must be a number between −40 and 40.`);
  if (!Number.isFinite(i.extinction) || i.extinction < 0) return err("The extinction A must be zero or positive (magnitudes of dimming).");
  if (i.parallaxMas !== null) {
    if (!Number.isFinite(i.parallaxMas)) return err("The parallax must be a finite number.");
    if (i.parallaxMas <= 0) return err(`A parallax of ${i.parallaxMas} mas is ${i.parallaxMas === 0 ? "zero: the star is too far to measure (or the measurement is noise), and 1/ϖ would be infinite" : "negative: a measurement dominated by noise (common in Gaia for faint, distant stars); 1/ϖ is not a distance"}. Give a distance instead.`);
    if (i.dPc !== null) return err("Give the distance OR the parallax, not both (they are the same quantity).");
  }
  const notes: string[] = [];
  const derived: string[] = [];
  let d = i.dPc ?? (i.parallaxMas !== null ? 1000 / i.parallaxMas : null);
  if (i.parallaxMas !== null) derived.push("distance from the parallax, d = 1/ϖ");
  let { m, M } = i;
  const A = i.extinction;
  const given = [m !== null, M !== null, d !== null].filter(Boolean).length;
  if (given === 3) {
    const mu = (m as number) - (M as number) - A;
    const dmu = distanceFromModulus(mu);
    if (Math.abs(dmu / (d as number) - 1) > 0.01) notes.push(`The three magnitudes and distance given are inconsistent: m − M − A = ${mu.toFixed(3)} implies ${dmu.toPrecision(4)} pc, not ${(d as number).toPrecision(4)} pc. The values are reported as entered.`);
  } else if (given === 2) {
    if (d === null) {
      d = distanceFromModulus((m as number) - (M as number) - A);
      derived.push("distance from the distance modulus");
    } else if (M === null) {
      M = (m as number) - distanceModulus(d) - A;
      derived.push("absolute magnitude from m and d");
    } else {
      m = M + distanceModulus(d) + A;
      derived.push("apparent magnitude from M and d");
    }
  }
  let { L, R, T } = i;
  const nLRT = [L !== null, R !== null, T !== null].filter(Boolean).length;
  // L = R² T⁴ in solar units (Stefan–Boltzmann with the nominal Sun: 4π R☉² σ T☉⁴ = 3.828×10²⁶ W to 0.01 %).
  if (nLRT === 2) {
    if (L === null) {
      L = (R as number) ** 2 * ((T as number) / T_SUN) ** 4;
      derived.push("luminosity from R and T (Stefan–Boltzmann)");
    } else if (R === null) {
      R = Math.sqrt(L) / ((T as number) / T_SUN) ** 2;
      derived.push("radius from L and T (Stefan–Boltzmann)");
    } else {
      T = T_SUN * Math.pow(L / (R * R), 0.25);
      derived.push("temperature from L and R (Stefan–Boltzmann)");
    }
  } else if (nLRT === 3) {
    const Lc = (R as number) ** 2 * ((T as number) / T_SUN) ** 4;
    if (Math.abs(Lc / (L as number) - 1) > 0.02) notes.push(`L, R and T are inconsistent: R²(T/T☉)⁴ = ${Lc.toPrecision(4)} L☉, not ${(L as number).toPrecision(4)} L☉.`);
  }
  const mbol = L !== null ? MBOL_SUN - 2.5 * Math.log10(L) : null;
  const flux = L !== null && d !== null ? (L * L_SUN) / (4 * Math.PI * (d * PC_M) ** 2) : null;
  if (given < 2 && nLRT < 2 && !(i.T !== null))
    return err("Give at least two of apparent magnitude, absolute magnitude and distance (or parallax), or two of luminosity, radius and temperature.");
  return {
    ok: true,
    m,
    M,
    dPc: d,
    parallaxMas: d !== null ? 1000 / d : null,
    mu: d !== null ? distanceModulus(d) : null,
    L,
    R,
    T,
    wienNm: T !== null ? (WIEN_B / T) * 1e9 : null,
    fluxWm2: flux,
    mbol,
    derived,
    notes,
  };
}

/** σ is used through the solar normalisation; exported so the test can confirm 4πR☉²σT☉⁴ = L☉. */
export const sunLuminosityFromSB = (): number => 4 * Math.PI * R_SUN * R_SUN * SIGMA_SB * T_SUN ** 4;

// ---------------------------------------------------------------------------------------------------------------
// Cosmology (flat ΛCDM, no radiation)
// ---------------------------------------------------------------------------------------------------------------

export interface CosmoOut {
  ok: true;
  z: number;
  hubbleMpc: number;
  comovingMpc: number;
  luminosityMpc: number;
  angularMpc: number;
  lookbackGyr: number;
  ageGyr: number;
  age0Gyr: number;
  /** kpc per arcsecond at z (angular-diameter distance). */
  kpcPerArcsec: number;
  /** Recession velocity cz, km/s (the low-z Hubble-law convention). */
  czKms: number;
}

/** Adaptive Simpson's rule. */
function simpson(f: (x: number) => number, a: number, b: number, eps = 1e-11): number {
  const s = (a0: number, b0: number, fa: number, fm: number, fb: number): number => ((b0 - a0) / 6) * (fa + 4 * fm + fb);
  const rec = (a0: number, b0: number, fa: number, fm: number, fb: number, whole: number, e: number, depth: number): number => {
    const m = (a0 + b0) / 2, lm = (a0 + m) / 2, rm = (m + b0) / 2;
    const flm = f(lm), frm = f(rm);
    const left = s(a0, m, fa, flm, fm), right = s(m, b0, fm, frm, fb);
    if (depth > 40 || Math.abs(left + right - whole) <= 15 * e) return left + right + (left + right - whole) / 15;
    return rec(a0, m, fa, flm, fm, left, e / 2, depth + 1) + rec(m, b0, fm, frm, fb, right, e / 2, depth + 1);
  };
  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  return rec(a, b, fa, fm, fb, s(a, b, fa, fm, fb), eps, 0);
}

export function cosmology(z: number, H0: number, Om: number): CosmoOut | Err {
  if (!Number.isFinite(z) || z < 0) return err("The redshift z must be zero or positive.");
  if (z > 1100) return err(`z = ${z} is beyond recombination (z ≈ 1100); this matter + Λ model leaves out radiation, which matters there.`);
  if (!Number.isFinite(H0) || H0 < 20 || H0 > 150) return err("H₀ must be between 20 and 150 km/s/Mpc.");
  if (!Number.isFinite(Om) || Om <= 0 || Om >= 1) return err("Ωm must be between 0 and 1 (flat: ΩΛ = 1 − Ωm).");
  const OL = 1 - Om;
  const E = (x: number): number => Math.sqrt(Om * (1 + x) ** 3 + OL);
  const dh = (C_M_S / 1000) / H0; // Mpc
  const th = (MPC_KM / H0) / GYR_S; // Gyr
  const dc = z === 0 ? 0 : dh * simpson((x) => 1 / E(x), 0, z);
  const lb = z === 0 ? 0 : th * simpson((x) => 1 / ((1 + x) * E(x)), 0, z);
  const age = (zz: number): number => ((2 * th) / (3 * Math.sqrt(OL))) * Math.asinh(Math.sqrt(OL / Om) * Math.pow(1 + zz, -1.5));
  const da = dc / (1 + z);
  return {
    ok: true,
    z,
    hubbleMpc: (z * C_M_S) / 1000 / H0,
    comovingMpc: dc,
    luminosityMpc: dc * (1 + z),
    angularMpc: da,
    lookbackGyr: lb,
    ageGyr: age(z),
    age0Gyr: age(0),
    kpcPerArcsec: (da * 1000) / RAD_ARCSEC,
    czKms: (z * C_M_S) / 1000,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Kepler's third law, transits and radial velocity
// ---------------------------------------------------------------------------------------------------------------

export interface KeplerOut {
  ok: true;
  aM: number;
  periodS: number;
  /** Transit quantities (when the star and planet radii are given). */
  depth: number | null;
  impact: number;
  inclinationDeg: number | null;
  t14H: number | null;
  t23H: number | null;
  transitProbability: number | null;
  rvKms: number | null;
  notes: string[];
}

export interface KeplerIn {
  muStar: number;
  muPlanet: number;
  aM: number | null;
  periodS: number | null;
  rStarM: number | null;
  rPlanetM: number | null;
  impact: number;
  ecc: number;
}

export function keplerTransit(i: KeplerIn): KeplerOut | Err {
  const bad = pos([["The central mass", i.muStar], ["The semi-major axis", i.aM], ["The period", i.periodS], ["The star's radius", i.rStarM], ["The planet's radius", i.rPlanetM]]);
  if (bad) return bad;
  if (!Number.isFinite(i.muPlanet) || i.muPlanet < 0) return err("The companion mass must be zero or positive.");
  if ((i.aM === null) === (i.periodS === null)) return err("Give the semi-major axis OR the period (the other is computed from Kepler's third law).");
  if (!Number.isFinite(i.ecc) || i.ecc < 0 || i.ecc >= 1) return err("The eccentricity must be from 0 up to (not including) 1.");
  if (!Number.isFinite(i.impact) || i.impact < 0) return err("The impact parameter b must be zero or positive (0 = a central transit).");
  const mu = i.muStar + i.muPlanet;
  const a = i.aM ?? Math.cbrt((mu * (i.periodS as number) ** 2) / (4 * Math.PI * Math.PI));
  const P = i.periodS ?? 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  const notes: string[] = [];
  let depth: number | null = null, inc: number | null = null, t14: number | null = null, t23: number | null = null, prob: number | null = null;
  if (i.rStarM !== null && i.rPlanetM !== null) {
    if (i.rPlanetM >= i.rStarM) return err("The planet's radius must be smaller than the star's for a transit (k = Rp/R★ < 1).");
    if (a <= i.rStarM) return err(`The orbit (a = ${(a / i.rStarM).toFixed(3)} R★) lies inside the star.`);
    const k = i.rPlanetM / i.rStarM;
    depth = k * k;
    prob = i.rStarM / a;
    const b = i.impact;
    if (b >= 1 + k) {
      notes.push(`b = ${b} ≥ 1 + k = ${(1 + k).toFixed(4)}: the planet passes clear of the stellar disc, so there is no transit.`);
    } else {
      const cosi = (b * i.rStarM) / a;
      inc = Math.acos(cosi) * (180 / Math.PI);
      const sini = Math.sqrt(1 - cosi * cosi);
      const durFor = (kk: number): number | null => {
        const q = (1 + kk) ** 2 - b * b;
        if (q <= 0) return null;
        return (P / Math.PI) * Math.asin(Math.min(1, ((i.rStarM as number) / a) * Math.sqrt(q) / sini)) / 3600;
      };
      t14 = durFor(k);
      const q23 = (1 - k) ** 2 - b * b;
      t23 = q23 > 0 ? (P / Math.PI) * Math.asin(Math.min(1, (i.rStarM / a) * Math.sqrt(q23) / sini)) / 3600 : 0;
      if (q23 <= 0) notes.push("A grazing transit (b > 1 − k): the planet never lies wholly inside the disc, so there is no flat bottom and the depth shown is an upper bound.");
      if (i.ecc > 0) notes.push("The transit duration uses a circular orbit; an eccentric orbit changes it by the speed at conjunction (not modelled).");
    }
  }
  const sini = inc !== null ? Math.sin(inc * (Math.PI / 180)) : 1;
  const rv = i.muPlanet > 0 ? Math.cbrt((2 * Math.PI * G) / P) * ((i.muPlanet / G) * sini) / Math.pow(mu / G, 2 / 3) / Math.sqrt(1 - i.ecc * i.ecc) / 1000 : null;
  return { ok: true, aM: a, periodS: P, depth, impact: i.impact, inclinationDeg: inc, t14H: t14, t23H: t23, transitProbability: prob, rvKms: rv, notes };
}

/** A trapezoid light curve: relative flux against hours from mid-transit (no limb darkening). */
export function transitCurve(depth: number, t14H: number, t23H: number, n = 241): Array<{ x: number; y: number }> {
  const span = t14H * 0.8;
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < n; k++) {
    const t = -t14H / 2 - span + ((t14H + 2 * span) * k) / (n - 1);
    const at = Math.abs(t);
    let f = 1;
    if (at <= t23H / 2) f = 1 - depth;
    else if (at < t14H / 2) f = 1 - (depth * (t14H / 2 - at)) / ((t14H - t23H) / 2 || 1e-9);
    pts.push({ x: t, y: f });
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// Surface gravity, tides and day length
// ---------------------------------------------------------------------------------------------------------------

export interface WorldData {
  id: string;
  label: string;
  /** GM, m³/s². */
  mu: number;
  /** Equatorial radius (planets) or mean radius (moons), m: surface gravity at the equator, as JPL tabulates it. */
  radius: number;
  /** Mean radius, m: the escape speed, as JPL tabulates it. */
  meanRadius: number;
  /** Sidereal rotation, days (negative: retrograde). */
  rotationD: number;
  /** Orbit around its primary, days. */
  orbitD: number;
  /** The Sun for a planet, the planet for a moon. */
  parent: string;
  /** Distance from its primary, m (semi-major axis). */
  aM: number;
  /** Distance from the Sun, m. */
  sunDistM: number;
  /** The orbit of the system around the Sun, days (the year). */
  yearD: number;
  source: string;
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/**
 * The bodies of the gravity tool: the eight planets and Pluto (JPL SSD physical parameters; μ from orbital.ts BODIES
 * where it has the body, G × mass otherwise), the Moon and ten major moons (JPL SSD satellite GM and mean radius,
 * synchronous rotation). A planet's mean distance from the Sun is its semi-major axis from Kepler's third law and
 * the JPL sidereal period, a = (μ(☉ + planet)·P²/4π²)^(1/3), so no orbital element is typed in.
 */
export const WORLDS: WorldData[] = (() => {
  const out: WorldData[] = [];
  for (const r of PLANET_PHYS) {
    const [id, eqR, meanR, mass, , rot, orbY] = r;
    const b = bodyById(id);
    const muP = b ? b.mu : G * mass;
    const aSun = Math.cbrt(((MU_SUN + muP) * (orbY * 365.25 * 86400) ** 2) / (4 * Math.PI * Math.PI));
    out.push({
      id,
      label: cap(id),
      mu: muP,
      radius: b ? b.radius : eqR * 1000,
      meanRadius: meanR * 1000,
      rotationD: rot,
      orbitD: orbY * 365.25,
      parent: "sun",
      aM: aSun,
      sunDistM: aSun,
      yearD: orbY * 365.25,
      source: b ? `μ ${b.source.replace(/ \(μ\).*/, "")} (orbital.ts); JPL SSD periods` : "JPL SSD physical parameters",
    });
  }
  for (const r of MOON_PHYS) {
    const [id, parent, gm, meanR, , aKm, P] = r;
    if (id === "moon" && out.some((w) => w.id === "moon")) continue;
    const par = out.find((w) => w.id === parent) as WorldData;
    const b = id === "moon" ? bodyById("moon") : undefined;
    out.push({
      id,
      label: cap(id),
      mu: b ? b.mu : gm * 1e9,
      radius: b ? b.radius : meanR * 1000,
      meanRadius: b ? b.radius : meanR * 1000,
      rotationD: P,
      orbitD: P,
      parent,
      aM: aKm * 1000,
      sunDistM: par.sunDistM,
      yearD: par.yearD,
      source: b ? "μ and radius IAU 2009 (orbital.ts); JPL SSD orbit" : "JPL SSD satellite GM, mean radius and orbit",
    });
  }
  return out;
})();

export interface GravityOut {
  ok: true;
  world: WorldData;
  g: number;
  gRatio: number;
  vEsc: number;
  /** Mean solar day (days); for a moon, the length of its day–night cycle. */
  solarDayD: number;
  /** Weight in newtons of the given mass, and the reading of a scale calibrated on Earth (kg). */
  weightN: number;
  scaleKg: number;
  /** Tidal acceleration (m/s²) at the surface from the primary (null for a planet) and from the Sun. */
  tideParent: number | null;
  tideSun: number;
  /** Earth's Moon-to-Sun tidal ratio at mean distances (the classic 2.2). */
  earthMoonSunRatio: number;
}

export const G0 = 9.80665;

export function surfaceGravity(id: string, massKg: number): GravityOut | Err {
  const w = WORLDS.find((x) => x.id === id);
  if (!w) return err(`Unknown body "${id}".`);
  if (!Number.isFinite(massKg) || massKg <= 0) return err("The mass to weigh must be greater than zero.");
  const g = w.mu / (w.radius * w.radius);
  const solar = w.parent === "sun" ? Math.abs(1 / (1 / w.rotationD - 1 / w.orbitD)) : Math.abs(1 / (1 / w.rotationD - 1 / w.yearD));
  const tide = (muX: number, d: number): number => (2 * muX * w.radius) / d ** 3;
  const parentMu = w.parent === "sun" ? null : (WORLDS.find((x) => x.id === w.parent) as WorldData).mu;
  const earth = WORLDS.find((x) => x.id === "earth") as WorldData;
  const moon = WORLDS.find((x) => x.id === "moon") as WorldData;
  const ratio = ((moon.mu / moon.aM ** 3) / (MU_SUN / earth.sunDistM ** 3));
  return {
    ok: true,
    world: w,
    g,
    gRatio: g / G0,
    vEsc: Math.sqrt((2 * w.mu) / w.meanRadius),
    solarDayD: solar,
    weightN: massKg * g,
    scaleKg: (massKg * g) / G0,
    tideParent: parentMu === null ? null : tide(parentMu, w.aM),
    tideSun: tide(MU_SUN, w.sunDistM),
    earthMoonSunRatio: ratio,
  };
}
