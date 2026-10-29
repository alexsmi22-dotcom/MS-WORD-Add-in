// Constants for the Spaceflight & missions calculators (spaceOrbit.ts, spaceMissions.ts), kept OUT of orbital.ts so
// that file's BODIES stays as it is (the astronomy branch extends it; this module adds nothing to it).
//
// PROVENANCE. Everything between the GENERATED markers was printed by scripts/spaceflight-extract.py from:
//   - poliastro/poliastro src/poliastro/constants/general.py (main, fetched 2026-10-28): GM from the IAU 2009 system
//     of astronomical constants (GM_jupiter and GM_neptune are SYSTEM values, planet plus moons), radii from the IAU
//     WG on Cartographic Coordinates 2009, J2 from the sources that file cites. The same file orbital.ts's BODIES came
//     from, so Earth, Moon, Mars, Sun and Jupiter agree with it digit for digit (spaceConstants.test.ts checks).
//   - E. M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets" (JPL Solar System Dynamics,
//     https://ssd.jpl.nasa.gov/planets/approx_pos.html, fetched 2026-10-28): Table 1 (mean ecliptic and equinox of
//     J2000, valid 1800 AD to 2050 AD) and its accuracy table (heliocentric longitude and latitude in arcsec, distance
//     in 1000 km). spaceConstants.test.ts checks positions from these elements against the DE421 ephemeris.
//   - NRLMSIS 2.1 (pymsis 0.13): total mass density 86 to 1000 km, a global mean (cos-latitude weighted, 12
//     longitudes so every local time counts) at the 2020 March equinox for three solar-activity levels: low
//     (F10.7 = 70, Ap = 4), moderate (150, 15) and high (250, 45). Thermospheric density at 400 km differs by a factor
//     of about 20 between low and high activity, which is why an orbital lifetime is a range, never a date.
// Nothing in the generated block was typed by hand.

// ---- BEGIN GENERATED (scripts/spaceflight-extract.py) ----
export const GM_SI: Record<string, number> = {
  sun: 1.32712442099e+20,
  mercury: 22032090000000.0,
  venus: 324858592000000.0,
  earth: 398600441800000.0,
  moon: 4902799810000.0,
  mars: 42828374400000.0,
  jupiter: 1.2671276253e+17,
  saturn: 3.79312077e+16,
  uranus: 5793939300000000.0,
  neptune: 6836527100580397.0,
  pluto: 870300000000.0,
};
export const R_EQ_SI: Record<string, number> = {
  sun: 695700000.0,
  mercury: 2440530.0,
  venus: 6051800.0,
  earth: 6378136.6,
  moon: 1737400.0,
  mars: 3396190.0,
  jupiter: 71492000.0,
  saturn: 60268000.0,
  uranus: 25559000.0,
  neptune: 24764000.0,
  pluto: 1188300.0,
};
export const R_MEAN_SI: Record<string, number> = {
  mercury: 2439400.0,
  venus: 6051800.0,
  earth: 6371008.4,
  moon: 1737400.0,
  mars: 3389500.0,
  jupiter: 69911000.0,
  saturn: 58232000.0,
  uranus: 25362000.0,
  neptune: 24622000.0,
  pluto: 1188000.0,
};
export const J2: Record<string, number> = {
  sun: 2.2e-07,
  earth: 0.00108263,
  mars: 0.0019555,
  venus: 4.4044e-06,
};
export const H0_EARTH_M = 8500.0;
export const RHO0_EARTH = 1.3;
/** [a au, e, I deg, L deg, long.peri deg, long.node deg] and the same per Julian century. */
export const STANDISH_T1: Record<string, { el: number[]; rate: number[]; err: number[] }> = {
  mercury: { el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rate: [3.7e-07, 1.906e-05, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], err: [15.0, 1.0, 1.0] },
  venus: { el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [3.9e-06, -4.107e-05, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], err: [20.0, 1.0, 4.0] },
  emb: { el: [1.00000261, 0.01671123, -1.531e-05, 100.46457166, 102.93768193, 0.0], rate: [5.62e-06, -4.392e-05, -0.01294668, 35999.37244981, 0.32327364, 0.0], err: [20.0, 8.0, 6.0] },
  mars: { el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [1.847e-05, 7.882e-05, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], err: [40.0, 2.0, 25.0] },
  jupiter: { el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], err: [400.0, 10.0, 600.0] },
  saturn: { el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], err: [600.0, 25.0, 1500.0] },
  uranus: { el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rate: [-0.00196176, -4.397e-05, -0.00242939, 428.48202785, 0.40805281, 0.04240589], err: [50.0, 2.0, 1000.0] },
  neptune: { el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 5.105e-05, 0.00035372, 218.45945325, -0.32241464, -0.00508664], err: [10.0, 1.0, 200.0] },
};
/** NRLMSIS 2.1 total mass density, kg/m³: global mean (cos-latitude weighted, 12 longitudes), 2020-03-20 12:00 UT. */
export const MSIS_ALT_KM = [86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 142, 144, 146, 148, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 525, 550, 575, 600, 625, 650, 675, 700, 725, 750, 775, 800, 825, 850, 875, 900, 925, 950, 975, 1000];
export const MSIS_RHO: Record<"low" | "moderate" | "high", number[]> = {
  low: [5.8205e-06, 4.1435e-06, 2.95e-06, 2.1014e-06, 1.4982e-06, 1.0676e-06, 7.5672e-07, 5.3093e-07, 3.6829e-07, 2.5296e-07, 1.7252e-07, 1.177e-07, 8.0945e-08, 5.6456e-08, 4.016e-08, 2.9305e-08, 2.1962e-08, 1.6865e-08, 1.3242e-08, 1.0606e-08, 8.6401e-09, 7.1402e-09, 5.9726e-09, 5.0481e-09, 4.3052e-09, 3.7007e-09, 3.2033e-09, 2.79e-09, 2.4436e-09, 2.151e-09, 1.9019e-09, 1.6884e-09, 1.5044e-09, 8.8351e-10, 5.4924e-10, 3.5566e-10, 2.3754e-10, 1.6259e-10, 1.1355e-10, 8.0665e-11, 5.8155e-11, 4.2472e-11, 3.1375e-11, 2.3414e-11, 1.7632e-11, 1.3385e-11, 1.0235e-11, 7.8768e-12, 6.0969e-12, 4.7436e-12, 3.7079e-12, 2.9106e-12, 2.2936e-12, 1.8138e-12, 1.4391e-12, 1.1453e-12, 9.1421e-13, 7.3182e-13, 5.8746e-13, 4.7288e-13, 3.8171e-13, 3.0899e-13, 2.5086e-13, 2.0428e-13, 1.6689e-13, 1.368e-13, 1.1254e-13, 9.2932e-14, 5.8658e-14, 3.8142e-14, 2.5658e-14, 1.7915e-14, 1.3002e-14, 9.8006e-15, 7.6509e-15, 6.1581e-15, 5.0845e-15, 4.2848e-15, 3.6692e-15, 3.1813e-15, 2.7847e-15, 2.4556e-15, 2.1782e-15, 1.9412e-15, 1.7368e-15, 1.5591e-15, 1.4038e-15, 1.2673e-15],
  moderate: [5.8109e-06, 4.1755e-06, 3.006e-06, 2.1608e-06, 1.5475e-06, 1.102e-06, 7.7838e-07, 5.4422e-07, 3.7673e-07, 2.5881e-07, 1.77e-07, 1.2131e-07, 8.3898e-08, 5.8855e-08, 4.2088e-08, 3.0839e-08, 2.3179e-08, 1.7838e-08, 1.4032e-08, 1.1263e-08, 9.2059e-09, 7.6427e-09, 6.4296e-09, 5.4708e-09, 4.7012e-09, 4.0748e-09, 3.559e-09, 3.1298e-09, 2.7692e-09, 2.4637e-09, 2.2028e-09, 1.9782e-09, 1.7837e-09, 1.1175e-09, 7.4577e-10, 5.2059e-10, 3.7569e-10, 2.7811e-10, 2.1004e-10, 1.6122e-10, 1.2541e-10, 9.8654e-11, 7.836e-11, 6.2762e-11, 5.0638e-11, 4.1122e-11, 3.3587e-11, 2.7575e-11, 2.2744e-11, 1.8839e-11, 1.5665e-11, 1.307e-11, 1.0941e-11, 9.1845e-12, 7.7311e-12, 6.5239e-12, 5.5178e-12, 4.6769e-12, 3.972e-12, 3.3797e-12, 2.8808e-12, 2.4596e-12, 2.1033e-12, 1.8013e-12, 1.5449e-12, 1.3268e-12, 1.141e-12, 9.8258e-13, 6.7988e-13, 4.7409e-13, 3.3315e-13, 2.3597e-13, 1.6853e-13, 1.2144e-13, 8.8361e-14, 6.4973e-14, 4.833e-14, 3.6406e-14, 2.78e-14, 2.1538e-14, 1.6943e-14, 1.3539e-14, 1.099e-14, 9.0597e-15, 7.5802e-15, 6.4312e-15, 5.5266e-15, 4.8043e-15],
  high: [5.7955e-06, 4.2141e-06, 3.0768e-06, 2.2372e-06, 1.6111e-06, 1.146e-06, 8.0572e-07, 5.6055e-07, 3.8687e-07, 2.6579e-07, 1.8242e-07, 1.258e-07, 8.7644e-08, 6.1955e-08, 4.4609e-08, 3.2852e-08, 2.4767e-08, 1.9093e-08, 1.5036e-08, 1.2087e-08, 9.911e-09, 8.2719e-09, 7.007e-09, 6.0101e-09, 5.2106e-09, 4.5594e-09, 4.0221e-09, 3.5736e-09, 3.1954e-09, 2.8736e-09, 2.5972e-09, 2.358e-09, 2.1496e-09, 1.4227e-09, 1.0021e-09, 7.3712e-10, 5.595e-10, 4.3479e-10, 3.4407e-10, 2.7621e-10, 2.2434e-10, 1.8397e-10, 1.521e-10, 1.2663e-10, 1.0607e-10, 8.9311e-11, 7.5556e-11, 6.4189e-11, 5.4737e-11, 4.6837e-11, 4.0202e-11, 3.4606e-11, 2.9867e-11, 2.5839e-11, 2.2405e-11, 1.9468e-11, 1.6949e-11, 1.4782e-11, 1.2915e-11, 1.1302e-11, 9.9051e-12, 8.6934e-12, 7.6403e-12, 6.7234e-12, 5.9238e-12, 5.2254e-12, 4.6145e-12, 4.0794e-12, 3.0108e-12, 2.2353e-12, 1.6686e-12, 1.2519e-12, 9.4393e-13, 7.1508e-13, 5.4423e-13, 4.1612e-13, 3.1964e-13, 2.4669e-13, 1.9132e-13, 1.4912e-13, 1.1684e-13, 9.2053e-14, 7.2947e-14, 5.8161e-14, 4.6674e-14, 3.7712e-14, 3.069e-14, 2.5164e-14],
};
// ---- END GENERATED ----

/** The astronomical unit, m: exact by IAU 2012 Resolution B2. */
export const AU_M = 149597870700;
/** Seconds in a day (exact) and in a Julian century of 36525 days (the Standish rates are per Julian century). */
export const DAY_S = 86400;
export const JULIAN_CENTURY_D = 36525;
/** Earth's rotation rate, rad/s: the WGS 84 defining constant (sidereal, relative to the stars). */
export const OMEGA_EARTH = 7.292115e-5;
/**
 * The mean Sun's rate along the equator of date, rad/s: 360° per tropical year of 365.2421897 days (the rate a
 * sun-synchronous orbit's node must match). Differs from the J2000-fixed rate in Standish's EM Bary row only by
 * precession, 50 arcsec a year.
 */
export const SUN_MEAN_RATE = (2 * Math.PI) / (365.2421897 * DAY_S);
/**
 * The Moon's mean distance from Earth, m (384 400 km, the round figure most references quote; the semi-major axis of
 * the mean lunar orbit is 384 399 km). The Moon's real distance runs from about 356 500 km to 406 700 km, a ±5 %
 * swing that moves the Earth–Moon L1 point by about 16 000 km; the calculators take the distance as an input.
 */
export const EARTH_MOON_DISTANCE_M = 3.844e8;
/** The solar constant at 1 au, W/m² (the IAU 2015 nominal total solar irradiance, Resolution B3: 1361 W/m²). */
export const SOLAR_CONSTANT = 1361;
/** Stefan–Boltzmann constant, W/(m²·K⁴): exact in the 2019 SI (derived from the exact h, c and k). */
export const SIGMA_SB = 5.670374419e-8;
/** Newtonian G, m³/(kg·s²): CODATA 2018. Only used to turn a density into a mass for the Roche limit. */
export const G_NEWTON = 6.6743e-11;

export interface SpaceBody {
  id: string;
  label: string;
  /** GM, m³/s². */
  mu: number;
  /** Equatorial radius, m. */
  radius: number;
  /** Standish Table 1 key for the heliocentric orbit (planets only). */
  orbit?: string;
}

const LABELS: Record<string, string> = {
  sun: "Sun", mercury: "Mercury", venus: "Venus", earth: "Earth", moon: "Moon", mars: "Mars", jupiter: "Jupiter",
  saturn: "Saturn", uranus: "Uranus", neptune: "Neptune", pluto: "Pluto",
};

/** Every body the spaceflight calculators know, from the generated GM and radius tables. */
export const SPACE_BODIES: SpaceBody[] = Object.keys(LABELS).map((id) => ({
  id,
  label: LABELS[id],
  mu: GM_SI[id],
  radius: R_EQ_SI[id],
  ...(STANDISH_T1[id] ? { orbit: id } : id === "earth" ? { orbit: "emb" } : {}),
}));

export function spaceBody(id: string): SpaceBody | undefined {
  return SPACE_BODIES.find((b) => b.id === id);
}

/** The eight planets in order from the Sun (the bodies with a Standish heliocentric orbit). */
export const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

/**
 * Julian Date (UTC treated as TT; the 69 s difference moves a planet by under 0.003 arcsec of mean longitude per day
 * of motion and is far inside the Standish error) from an ISO date "2026-11-15" or "2026-11-15T06:30". A LOCAL helper:
 * the astronomy branch's time-scale module will carry the full UTC/TAI/TT treatment; this one only feeds approximate
 * planet positions. Gregorian calendar (Meeus, Astronomical Algorithms, ch. 7). Null for anything else.
 */
export function julianDate(iso: string): number | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?\s*(?:Z|UTC)?\s*$/i.exec(iso);
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  const ss = m[6] ? Number(m[6]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || hh > 23 || mi > 59 || ss >= 60) return null;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > dim) return null;
  if (mo <= 2) {
    y -= 1;
    mo += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + d + B - 1524.5 + (hh + mi / 60 + ss / 3600) / 24;
}

/** Calendar date "YYYY-MM-DD" of a Julian Date (Meeus ch. 7, Gregorian). */
export function isoFromJd(jd: number): string {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const A = z + 1 + alpha - Math.floor(alpha / 4);
  const B = A + 1524;
  const C = Math.floor((B - 122.1) / 365.25);
  const D = Math.floor(365.25 * C);
  const E = Math.floor((B - D) / 30.6001);
  const day = Math.floor(B - D - Math.floor(30.6001 * E) + f);
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The Standish Table 1 validity window, as Julian Dates (1800-01-01 and 2050-12-31). */
export const STANDISH_JD_MIN = 2378496.5;
export const STANDISH_JD_MAX = 2470171.5;
