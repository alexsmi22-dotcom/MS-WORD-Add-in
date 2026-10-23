// QUANTUM MECHANICS ENGINE (Release Q part Q6, 2026-10): the textbook one-particle problems and two-level dynamics.
//
//   - infinite square well: levels Eₙ = n²π²ħ²/(2mL²), ψₙ, ⟨x⟩, Δx, Δp;
//   - finite square well (full width w, depth V₀): bound states by bracketed bisection of the even / odd matching
//     conditions written WITHOUT poles, energies measured from the well bottom;
//   - harmonic oscillator: Eₙ = ħω(n + ½), ψₙ by the normalised Hermite recurrence (n ≤ 20), turning points and the
//     probability outside them;
//   - hydrogen-like atom: Bohr levels with the optional reduced-mass correction, vacuum transition wavelengths for
//     any series, ionisation energies, the radial probability P(r) = r²R²ₙₗ for n ≤ 4;
//   - rectangular barrier: the exact transmission for E < V₀, E = V₀ and E > V₀ (log-domain, so an opaque barrier is
//     10⁻⁴⁰⁰, not 0), the WKB estimate e^{−2κa} beside it;
//   - two-level dynamics: Rabi oscillation, Larmor precession, and e^{−iHt/ħ} on a 2 × 2 Hamiltonian (closed form by
//     the Pauli decomposition, CROSS-CHECKED against control.ts expm on the real 4 × 4 embedding; disagreement refuses).
//
// SI units throughout (J, m, kg, s, T). Pure functions; every loop is bounded; non-finite input is refused up front.

import { expm } from "./control";
import { cAbs2, cx, type CMat, type Cx, type State } from "./quantumCore";

// ---------------------------------------------------------------------------------------------------------------
// CODATA 2018 recommended values — the ONE constants block for this engine.
// Source: E. Tiesinga, P. J. Mohr, D. B. Newell, B. N. Taylor, "CODATA recommended values of the fundamental physical
// constants: 2018", Rev. Mod. Phys. 93, 025010 (2021); every number below was checked digit by digit against the NIST
// 2018 ASCII table as embedded in SciPy 1.18.1 (scipy/constants/_codata.py, `txt2018`). h, e and c are exact in the
// 2019 SI; ħ is computed as h/2π (exact); the rest carry the CODATA standard uncertainty in their last digits.
// ---------------------------------------------------------------------------------------------------------------
export const CODATA_2018 = {
  /** Planck constant h (J s), exact. */
  h: 6.62607015e-34,
  /** Elementary charge e (C), exact. */
  e: 1.602176634e-19,
  /** Speed of light in vacuum c (m/s), exact. */
  c: 299792458,
  /** Electron mass mₑ (kg). */
  me: 9.1093837015e-31,
  /** Proton mass mₚ (kg). */
  mp: 1.67262192369e-27,
  /** Neutron mass mₙ (kg). */
  mn: 1.67492749804e-27,
  /** Deuteron mass (kg). */
  md: 3.3435837724e-27,
  /** Alpha particle (⁴He nucleus) mass (kg). */
  malpha: 6.6446573357e-27,
  /** Rydberg constant R∞ (1/m). */
  Rinf: 10973731.56816,
  /** Bohr radius a₀ (m). */
  a0: 5.29177210903e-11,
  /** Bohr magneton μ_B (J/T). */
  muB: 9.2740100783e-24,
  /** Nuclear magneton μ_N (J/T). */
  muN: 5.0507837461e-27,
  /** Electron g factor (negative: the moment is antiparallel to the spin). */
  ge: -2.00231930436256,
  /** Proton g factor. */
  gp: 5.5856946893,
  /** Neutron g factor. */
  gn: -3.82608545,
  /** Fine-structure constant α. */
  alpha: 7.2973525693e-3,
} as const;

export const H_PLANCK = CODATA_2018.h;
export const HBAR = CODATA_2018.h / (2 * Math.PI);
export const E_CHARGE = CODATA_2018.e;
export const C_LIGHT = CODATA_2018.c;
export const M_E = CODATA_2018.me;
/** 1 eV in joules (exact). */
export const EV = CODATA_2018.e;

export const CODATA_SOURCE = "Constants: CODATA 2018 (Tiesinga et al., Rev. Mod. Phys. 93, 025010, 2021); h, e, c exact, ħ = h/2π.";

export type Err = { error: string };
export const isErr = (v: unknown): v is Err => typeof v === "object" && v !== null && "error" in v;

const fin = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));

// ---------------------------------------------------------------------------------------------------------------
// Infinite square well, 0 ≤ x ≤ L
// ---------------------------------------------------------------------------------------------------------------

/** The most levels any well/oscillator tool lists. */
export const MAX_LEVELS = 50;

export interface InfiniteWell {
  /** E₁ (J); Eₙ = n²E₁. */
  E1: number;
  /** The state asked about. */
  n: number;
  En: number;
  /** ⟨x⟩ = L/2, Δx, Δp (SI). */
  xMean: number;
  dx: number;
  dp: number;
}

export function infiniteWell(m: number, L: number, n: number): InfiniteWell | Err {
  if (!fin(m, L, n)) return { error: "The mass, width and quantum number must be finite numbers." };
  if (m <= 0) return { error: "The mass must be positive." };
  if (L <= 0) return { error: "The well width must be positive." };
  if (!Number.isInteger(n) || n < 1 || n > 10000) return { error: "The quantum number n must be a whole number from 1 to 10 000." };
  const E1 = (Math.PI * Math.PI * HBAR * HBAR) / (2 * m * L * L);
  if (!fin(E1) || E1 <= 0) return { error: "The ground-state energy is not representable for this mass and width." };
  const dx = L * Math.sqrt(1 / 12 - 1 / (2 * n * n * Math.PI * Math.PI));
  return { E1, n, En: n * n * E1, xMean: L / 2, dx, dp: (n * Math.PI * HBAR) / L };
}

/** ψₙ(x) = √(2/L) sin(nπx/L) inside, 0 outside (1/√m). */
export function infiniteWellPsi(n: number, L: number, x: number): number {
  if (x <= 0 || x >= L) return 0;
  return Math.sqrt(2 / L) * Math.sin((n * Math.PI * x) / L);
}

// ---------------------------------------------------------------------------------------------------------------
// Finite square well: V = 0 for |x| < a = w/2, V = V₀ outside. Energies from the well bottom.
// ---------------------------------------------------------------------------------------------------------------

/** The most bound states the finite well solves (z₀ ≤ 500π). */
export const FINITE_MAX_STATES = 1000;

export interface FiniteState {
  /** 1-based level number (1 = ground). */
  n: number;
  parity: "even" | "odd";
  /** z = ka, the dimensionless inside wave number. */
  z: number;
  /** Energy above the well bottom (J). */
  E: number;
}

export interface FiniteWell {
  /** z₀ = a√(2mV₀)/ħ, a = half-width. */
  z0: number;
  a: number;
  V0: number;
  states: FiniteState[];
  /** A state sits at the rim to rounding (z₀ = kπ/2): not counted, named. */
  threshold: boolean;
}

/** Bisection on a sign change, a fixed 200-step cap (converges to the last bit long before). */
function bisect(f: (z: number) => number, lo: number, hi: number): number | null {
  let flo = f(lo);
  const fhi = f(hi);
  if (!fin(flo, fhi)) return null;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  let a = lo, b = hi;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (a + b);
    if (mid <= a || mid >= b) break;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      a = mid;
      flo = fm;
    } else b = mid;
  }
  return 0.5 * (a + b);
}

export function finiteWell(m: number, V0: number, width: number): FiniteWell | Err {
  if (!fin(m, V0, width)) return { error: "The mass, depth and width must be finite numbers." };
  if (m <= 0) return { error: "The mass must be positive." };
  if (width <= 0) return { error: "The well width must be positive." };
  if (V0 <= 0) return { error: "The well depth V₀ must be positive (the barrier height above the well floor)." };
  const a = width / 2;
  const z0 = (a * Math.sqrt(2 * m * V0)) / HBAR;
  if (!fin(z0)) return { error: "z₀ = a√(2mV₀)/ħ is not representable for these inputs." };
  if (z0 > (FINITE_MAX_STATES * Math.PI) / 2) {
    return { error: `This well holds more than ${FINITE_MAX_STATES} bound states (z₀ = ${z0.toPrecision(4)}); the infinite-well levels are an excellent approximation for its low states.` };
  }
  const half = Math.PI / 2;
  const k = z0 / half;
  // Within 10⁻⁶ of z₀ = kπ/2 the k-th state's binding energy is below what double precision resolves (it scales as the
  // square of the distance): it is named, not counted.
  const kr = Math.round(k);
  const threshold = Math.abs(k - kr) < 1e-6 && kr >= 1;
  // A new state enters at the rim as z₀ crosses kr·π/2 (interval j = kr): it is excluded either side of the crossing,
  // and every interval below it holds exactly one well-bound state.
  const expected = threshold ? kr : Math.ceil(k);
  const eta = (z: number): number => Math.sqrt(Math.max(0, z0 * z0 - z * z));
  const even = (z: number): number => z * Math.sin(z) - eta(z) * Math.cos(z);
  const odd = (z: number): number => z * Math.cos(z) + eta(z) * Math.sin(z);
  const states: FiniteState[] = [];
  for (let j = 0; j < FINITE_MAX_STATES + 1; j++) {
    const lo = j * half;
    if (lo >= z0) break;
    const hi = Math.min((j + 1) * half, z0);
    if (threshold && j === expected) break;
    const f = j % 2 === 0 ? even : odd;
    // The bracket's lower end of an even interval is 0 for j = 0: f(0) = −z₀ < 0, fine.
    const z = bisect(f, lo === 0 ? 0 : lo, hi);
    if (z === null || z <= 0 || z >= z0) continue;
    states.push({ n: states.length + 1, parity: j % 2 === 0 ? "even" : "odd", z, E: (HBAR * HBAR * z * z) / (2 * m * a * a) });
  }
  if (states.length !== expected) {
    return { error: `The bound-state search found ${states.length} states where the count formula gives ${expected}; no result is printed (a defect to report).` };
  }
  return { z0, a, V0, states, threshold };
}

/**
 * ψ(x) of a finite-well state, continuous with a continuous derivative, normalised to ∫|ψ|² dx = 1 (1/√m).
 * Even: cos(kx) inside, cos(ka)e^{−κ(|x|−a)} outside; odd: sin(kx) inside, sgn(x) sin(ka)e^{−κ(|x|−a)}.
 */
export function finiteWellPsi(st: FiniteState, z0: number, a: number, x: number): number {
  const k = st.z / a;
  const kap = Math.sqrt(Math.max(0, z0 * z0 - st.z * st.z)) / a;
  const evenS = st.parity === "even";
  const inside = (ax: number): number => (evenS ? Math.cos(k * ax) : Math.sin(k * ax));
  const edge = evenS ? Math.cos(st.z) : Math.sin(st.z);
  // Normalisation: inside ∫_{−a}^{a} cos² = a + sin(2z)/(2k), sin² = a − sin(2z)/(2k); outside 2·edge²/(2κ).
  const inner = evenS ? a + Math.sin(2 * st.z) / (2 * k) : a - Math.sin(2 * st.z) / (2 * k);
  const norm = Math.sqrt(inner + (kap > 0 ? (edge * edge) / kap : 0));
  const ax = Math.abs(x);
  const s = x < 0 && !evenS ? -1 : 1;
  const v = ax <= a ? inside(ax) : edge * Math.exp(-kap * (ax - a));
  return (s * v) / norm;
}

// ---------------------------------------------------------------------------------------------------------------
// Harmonic oscillator
// ---------------------------------------------------------------------------------------------------------------

/** The highest oscillator state with a wavefunction (brief: n ≤ 20). */
export const OSC_MAX_N = 20;

/**
 * ψₙ(ξ) normalised in ξ = x/x₀ (∫ψₙ² dξ = 1): ψ₀ = π^{−1/4}e^{−ξ²/2}, ψₙ = √(2/n) ξ ψₙ₋₁ − √((n−1)/n) ψₙ₋₂ — the
 * normalised form of the Hermite recurrence, which never forms Hₙ(ξ) or 2ⁿn! (no overflow).
 */
export function oscillatorPsi(n: number, xi: number): number {
  if (!Number.isInteger(n) || n < 0 || n > OSC_MAX_N || !fin(xi)) return NaN;
  let p0 = Math.pow(Math.PI, -0.25) * Math.exp(-0.5 * xi * xi);
  if (n === 0) return p0;
  let p1 = Math.SQRT2 * xi * p0;
  for (let k = 2; k <= n; k++) {
    const p2 = Math.sqrt(2 / k) * xi * p1 - Math.sqrt((k - 1) / k) * p0;
    p0 = p1;
    p1 = p2;
  }
  return p1;
}

/** The physicists' Hermite polynomial Hₙ(ξ) (n ≤ 20), for the formula table: H₀ = 1, H₁ = 2ξ, Hₙ₊₁ = 2ξHₙ − 2nHₙ₋₁. */
export function hermite(n: number, xi: number): number {
  if (!Number.isInteger(n) || n < 0 || n > OSC_MAX_N) return NaN;
  let h0 = 1;
  if (n === 0) return h0;
  let h1 = 2 * xi;
  for (let k = 1; k < n; k++) {
    const h2 = 2 * xi * h1 - 2 * k * h0;
    h0 = h1;
    h1 = h2;
  }
  return h1;
}

/**
 * The probability of finding the particle outside the classical turning points ξ = ±√(2n + 1):
 * 1 − 2∫₀^{ξₜ} ψₙ² dξ, composite Simpson with 4000 panels (n ≤ 20 has at most 10 lobes on [0, ξₜ]).
 */
export function oscillatorProbOutside(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > OSC_MAX_N) return NaN;
  const xt = Math.sqrt(2 * n + 1);
  const N = 4000;
  const h = xt / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const p = oscillatorPsi(n, i * h);
    const w = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    s += w * p * p;
  }
  return Math.max(0, 1 - (2 * s * h) / 3);
}

export interface Oscillator {
  omega: number;
  /** ħω (J). */
  quantum: number;
  n: number;
  En: number;
  /** x₀ = √(ħ/(mω)) (m). */
  x0: number;
  /** Turning point |x| = x₀√(2n + 1) (m). */
  turning: number;
  pOutside: number;
  dx: number;
  dp: number;
}

export function harmonicOscillator(m: number, omega: number, n: number): Oscillator | Err {
  if (!fin(m, omega, n)) return { error: "The mass, angular frequency and quantum number must be finite numbers." };
  if (m <= 0) return { error: "The mass must be positive." };
  if (omega <= 0) return { error: "The angular frequency ω must be positive." };
  if (!Number.isInteger(n) || n < 0 || n > OSC_MAX_N) return { error: `The quantum number n must be a whole number from 0 to ${OSC_MAX_N}.` };
  const x0 = Math.sqrt(HBAR / (m * omega));
  if (!fin(x0) || x0 <= 0) return { error: "The oscillator length √(ħ/mω) is not representable for these inputs." };
  const q = HBAR * omega;
  return {
    omega,
    quantum: q,
    n,
    En: q * (n + 0.5),
    x0,
    turning: x0 * Math.sqrt(2 * n + 1),
    pOutside: oscillatorProbOutside(n),
    dx: x0 * Math.sqrt(n + 0.5),
    dp: (HBAR / x0) * Math.sqrt(n + 0.5),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hydrogen-like atom (Bohr levels; no fine structure, Lamb shift or hyperfine structure)
// ---------------------------------------------------------------------------------------------------------------

export const HYDROGEN_MAX_N = 1000;
export const RADIAL_MAX_N = 4;

export interface HydrogenModel {
  Z: number;
  /** Nuclear mass (kg); null = infinitely heavy. */
  M: number | null;
  /** μ/mₑ (1 when M is null). */
  muRatio: number;
  /** R_M = R∞·μ/mₑ (1/m). */
  RM: number;
  /** a_μ = a₀·mₑ/μ (m). */
  aMu: number;
}

export function hydrogenModel(Z: number, M: number | null): HydrogenModel | Err {
  if (!fin(Z) || !Number.isInteger(Z) || Z < 1 || Z > 118) return { error: "The nuclear charge Z must be a whole number from 1 to 118." };
  if (M !== null && (!fin(M) || M <= 0)) return { error: "The nuclear mass must be positive." };
  const muRatio = M === null ? 1 : M / (M + M_E);
  return { Z, M, muRatio, RM: CODATA_2018.Rinf * muRatio, aMu: CODATA_2018.a0 / muRatio };
}

/** Eₙ = −Z²R_M hc/n² (J). */
export const hydrogenLevel = (h: HydrogenModel, n: number): number => (-h.Z * h.Z * h.RM * H_PLANCK * C_LIGHT) / (n * n);

export const SERIES_NAMES: Record<number, string> = { 1: "Lyman", 2: "Balmer", 3: "Paschen", 4: "Brackett", 5: "Pfund", 6: "Humphreys" };

export interface Transition {
  nUpper: number;
  nLower: number;
  /** Wavenumber in vacuum (1/m). */
  wavenumber: number;
  /** Vacuum wavelength (m). */
  lambda: number;
  /** Photon energy (J) and frequency (Hz). */
  energy: number;
  freq: number;
  /** The series limit (n → ∞) vacuum wavelength (m). */
  limit: number;
}

export function hydrogenTransition(h: HydrogenModel, nUpper: number, nLower: number): Transition | Err {
  if (![nUpper, nLower].every((n) => Number.isInteger(n) && n >= 1 && n <= HYDROGEN_MAX_N)) {
    return { error: `Both levels must be whole numbers from 1 to ${HYDROGEN_MAX_N}.` };
  }
  if (nUpper <= nLower) return { error: "The upper level must be above the lower one (n_upper > n_lower)." };
  const s = h.Z * h.Z * h.RM;
  const wavenumber = s * (1 / (nLower * nLower) - 1 / (nUpper * nUpper));
  return {
    nUpper,
    nLower,
    wavenumber,
    lambda: 1 / wavenumber,
    energy: H_PLANCK * C_LIGHT * wavenumber,
    freq: C_LIGHT * wavenumber,
    limit: (nLower * nLower) / s,
  };
}

/** Generalised Laguerre L_k^α(ρ) by the three-term recurrence (k small: n ≤ 4). */
function laguerre(k: number, alpha: number, rho: number): number {
  let l0 = 1;
  if (k === 0) return l0;
  let l1 = 1 + alpha - rho;
  for (let j = 1; j < k; j++) {
    const l2 = ((2 * j + 1 + alpha - rho) * l1 - (j + alpha) * l0) / (j + 1);
    l0 = l1;
    l1 = l2;
  }
  return l1;
}

const factorial = (n: number): number => {
  let f = 1;
  for (let i = 2; i <= n && i <= 170; i++) f *= i;
  return f;
};

/**
 * The radial probability density P(r) = r²Rₙₗ(r)² in units of 1/a (r in units of a, the reduced-mass Bohr radius when
 * the correction is on), normalised so ∫P dr = 1:
 *   Rₙₗ = √((2Z/n)³ (n−l−1)!/(2n (n+l)!)) e^{−ρ/2} ρˡ L_{n−l−1}^{2l+1}(ρ), ρ = 2Zr/n.
 */
export function radialP(n: number, l: number, Z: number, r: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(l) || n < 1 || n > RADIAL_MAX_N || l < 0 || l >= n || !fin(r) || r < 0) return NaN;
  const rho = (2 * Z * r) / n;
  const norm = Math.sqrt(Math.pow((2 * Z) / n, 3) * (factorial(n - l - 1) / (2 * n * factorial(n + l))));
  const R = norm * Math.exp(-rho / 2) * Math.pow(rho, l) * laguerre(n - l - 1, 2 * l + 1, rho);
  return r * r * R * R;
}

/** ⟨r⟩ = (a/2Z)(3n² − l(l+1)) and the most probable radius (both in units of a). */
export function radialStats(n: number, l: number, Z: number): { mean: number; peak: number } {
  const mean = (3 * n * n - l * (l + 1)) / (2 * Z);
  // The global maximum of P on a fine grid out to 4× the mean, refined by golden-section on the best cell.
  const rMax = 4 * mean + 10 / Z;
  const N = 4000;
  let best = 0, bi = 0;
  for (let i = 1; i <= N; i++) {
    const p = radialP(n, l, Z, (i * rMax) / N);
    if (p > best) {
      best = p;
      bi = i;
    }
  }
  let lo = (Math.max(0, bi - 1) * rMax) / N, hi = ((bi + 1) * rMax) / N;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 100; it++) {
    const c1 = hi - g * (hi - lo), c2 = lo + g * (hi - lo);
    if (radialP(n, l, Z, c1) > radialP(n, l, Z, c2)) hi = c2;
    else lo = c1;
  }
  return { mean, peak: 0.5 * (lo + hi) };
}

// ---------------------------------------------------------------------------------------------------------------
// Rectangular barrier
// ---------------------------------------------------------------------------------------------------------------

export interface Barrier {
  regime: "below" | "at" | "above";
  /** T as log₁₀ (exact for every regime; T itself underflows past 10⁻³⁰⁸). */
  log10T: number;
  T: number;
  /** κa below the barrier, k₂a above it, 0 at it. */
  phase: number;
  /** WKB log₁₀T = −2κa/ln10 (below the barrier only). */
  wkbLog10: number | null;
}

/**
 * The exact transmission through a rectangular barrier of height V₀ and width a for a particle of energy E:
 *   E < V₀: T = [1 + V₀² sinh²(κa)/(4E(V₀ − E))]⁻¹, κ = √(2m(V₀ − E))/ħ   (log domain past κa = 20)
 *   E = V₀: T = [1 + mV₀a²/(2ħ²)]⁻¹
 *   E > V₀: T = [1 + V₀² sin²(k₂a)/(4E(E − V₀))]⁻¹, k₂ = √(2m(E − V₀))/ħ  (T = 1 at k₂a = nπ)
 */
export function barrierT(m: number, V0: number, a: number, E: number): Barrier | Err {
  if (!fin(m, V0, a, E)) return { error: "The mass, barrier height, width and energy must be finite numbers." };
  if (m <= 0) return { error: "The mass must be positive." };
  if (a <= 0) return { error: "The barrier width must be positive." };
  if (V0 <= 0) return { error: "The barrier height V₀ must be positive." };
  if (E <= 0) return { error: "The particle energy must be positive (measured from the potential outside the barrier)." };
  const LN10 = Math.LN10;
  if (Math.abs(E - V0) <= 1e-12 * V0) {
    const T = 1 / (1 + (m * V0 * a * a) / (2 * HBAR * HBAR));
    return { regime: "at", log10T: Math.log10(T), T, phase: 0, wkbLog10: null };
  }
  if (E < V0) {
    const kap = Math.sqrt(2 * m * (V0 - E)) / HBAR;
    const x = kap * a;
    const c = (V0 * V0) / (4 * E * (V0 - E));
    let lnT: number;
    if (x < 20) {
      const s = Math.sinh(x);
      lnT = -Math.log1p(c * s * s);
    } else {
      const lnS2 = 2 * x - 2 * Math.LN2 + 2 * Math.log1p(-Math.exp(-2 * x));
      const lnCS = Math.log(c) + lnS2;
      lnT = -(lnCS + Math.log1p(Math.exp(-lnCS)));
    }
    if (!fin(lnT)) return { error: "The transmission is not representable for these inputs." };
    return { regime: "below", log10T: lnT / LN10, T: Math.exp(lnT), phase: x, wkbLog10: (-2 * x) / LN10 };
  }
  const k2 = Math.sqrt(2 * m * (E - V0)) / HBAR;
  const x = k2 * a;
  const sn = Math.sin(x);
  const T = 1 / (1 + (V0 * V0 * sn * sn) / (4 * E * (E - V0)));
  return { regime: "above", log10T: Math.log10(T), T, phase: x, wkbLog10: null };
}

/** Above-barrier resonance energies Eₙ = V₀ + n²π²ħ²/(2ma²) (T = 1), the first `count`. */
export function barrierResonances(m: number, V0: number, a: number, count: number): number[] {
  const e1 = (Math.PI * Math.PI * HBAR * HBAR) / (2 * m * a * a);
  return Array.from({ length: Math.max(0, Math.min(50, count)) }, (_, i) => V0 + (i + 1) * (i + 1) * e1);
}

// ---------------------------------------------------------------------------------------------------------------
// Two-level dynamics
// ---------------------------------------------------------------------------------------------------------------

/** P₁(t) = Ω²/(Ω² + Δ²) sin²(√(Ω² + Δ²) t/2), starting in |0⟩ (Ω, Δ in rad/s). */
export function rabiP1(Omega: number, Delta: number, t: number): number {
  const W2 = Omega * Omega + Delta * Delta;
  if (W2 === 0) return 0;
  const s = Math.sin((Math.sqrt(W2) * t) / 2);
  return ((Omega * Omega) / W2) * s * s;
}

/** Larmor angular frequency ω = −gμB/ħ (signed: positive = anticlockwise about +B). */
export const larmorOmega = (g: number, magneton: number, B: number): number => (-g * magneton * B) / HBAR;

/** The most phase |b|t/ħ the evolution accepts (≈ 160 000 cycles); beyond it rounding owns the answer. */
export const EVOLVE_MAX_PHASE = 1e6;

export interface Evolution {
  /** The state at t, with the global phase e^{−iāt/ħ} (ā = (H₀₀ + H₁₁)/2) removed. */
  psi: State;
  /** e^{−i(H − āI)t/ħ}. */
  U: CMat;
  /** The Pauli decomposition H = āI + b·σ (J). */
  mean: number;
  b: [number, number, number];
  /** max |U_closed − U_expm| (the cross-check). */
  check: number;
}

/** True when the 2 × 2 complex matrix is Hermitian to a relative 10⁻¹⁰. */
export function isHermitian2(H: CMat): boolean {
  if (H.length !== 2 || H.some((r) => r.length !== 2)) return false;
  const scale = Math.max(1e-300, ...H.flat().map((z) => Math.hypot(z.re, z.im)));
  const tol = 1e-10 * scale;
  return Math.abs(H[0][0].im) <= tol && Math.abs(H[1][1].im) <= tol && Math.abs(H[0][1].re - H[1][0].re) <= tol && Math.abs(H[0][1].im + H[1][0].im) <= tol;
}

/**
 * ψ(t) = e^{−iHt/ħ}ψ(0) for a Hermitian 2 × 2 H (J), t (s). Closed form: H = āI + b·σ,
 * e^{−i(H − āI)t/ħ} = cos θ I − i sin θ (b̂·σ), θ = |b|t/ħ; cross-checked against expm of the real embedding
 * [[A, −B], [B, A]] of −i(H − āI)t/ħ (control.ts, Padé-13 with balancing). A disagreement past 10⁻⁸ refuses.
 */
export function evolve2(H: CMat, psi0: State, t: number): Evolution | Err {
  if (!isHermitian2(H)) return { error: "The Hamiltonian must be a Hermitian 2 × 2 matrix (H₀₁ = H₁₀*, real diagonal)." };
  if (psi0.length !== 2) return { error: "The initial state must be a single qubit (two amplitudes)." };
  if (!fin(t) || ![...H.flat(), ...psi0].every((z) => fin(z.re, z.im))) return { error: "The Hamiltonian, state and time must be finite." };
  const n2 = cAbs2(psi0[0]) + cAbs2(psi0[1]);
  if (!(n2 > 0)) return { error: "The initial state is the zero vector." };
  const nrm = Math.sqrt(n2);
  const p0: State = psi0.map((z) => cx(z.re / nrm, z.im / nrm));
  const mean = (H[0][0].re + H[1][1].re) / 2;
  const bz = (H[0][0].re - H[1][1].re) / 2;
  const bx = H[0][1].re;
  const by = -H[0][1].im;
  const bm = Math.hypot(bx, by, bz);
  const theta = (bm * t) / HBAR;
  if (Math.abs(theta) > EVOLVE_MAX_PHASE) {
    return { error: `|b|t/ħ = ${Math.abs(theta).toPrecision(3)} rad is past the ${EVOLVE_MAX_PHASE.toPrecision(1)} rad this tool resolves (rounding would own the phase); use a shorter time.` };
  }
  const c = Math.cos(theta), s = Math.sin(theta);
  const [nx, ny, nz] = bm > 0 ? [bx / bm, by / bm, bz / bm] : [0, 0, 1];
  // cos θ I − i sin θ (n·σ), n·σ = [[nz, nx − i ny], [nx + i ny, −nz]]
  const U: CMat = [
    [cx(c, -s * nz), cx(-s * ny, -s * nx)],
    [cx(s * ny, -s * nx), cx(c, s * nz)],
  ];
  // Cross-check: M = −i(H − āI)t/ħ = A + iB with A = Im(H')t/ħ, B = −Re(H')t/ħ.
  const Hp: CMat = [
    [cx(bz, 0), H[0][1]],
    [H[1][0], cx(-bz, 0)],
  ];
  const k = t / HBAR;
  const A = Hp.map((r) => r.map((z) => z.im * k));
  const B = Hp.map((r) => r.map((z) => -z.re * k));
  const big = [
    [A[0][0], A[0][1], -B[0][0], -B[0][1]],
    [A[1][0], A[1][1], -B[1][0], -B[1][1]],
    [B[0][0], B[0][1], A[0][0], A[0][1]],
    [B[1][0], B[1][1], A[1][0], A[1][1]],
  ];
  const E = expm(big);
  if (!E) return { error: "The matrix exponential cross-check did not run; no result is printed." };
  let check = 0;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) check = Math.max(check, Math.abs(E[i][j] - U[i][j].re), Math.abs(E[i + 2][j] - U[i][j].im));
  const tol = 1e-8 * Math.max(1, Math.abs(theta));
  if (!(check <= tol)) return { error: `The closed form and the matrix exponential disagree by ${check.toPrecision(2)}; no result is printed (a defect to report).` };
  const psi: State = [
    cx(U[0][0].re * p0[0].re - U[0][0].im * p0[0].im + U[0][1].re * p0[1].re - U[0][1].im * p0[1].im, U[0][0].re * p0[0].im + U[0][0].im * p0[0].re + U[0][1].re * p0[1].im + U[0][1].im * p0[1].re),
    cx(U[1][0].re * p0[0].re - U[1][0].im * p0[0].im + U[1][1].re * p0[1].re - U[1][1].im * p0[1].im, U[1][0].re * p0[0].im + U[1][0].im * p0[0].re + U[1][1].re * p0[1].im + U[1][1].im * p0[1].re),
  ];
  return { psi, U, mean, b: [bx, by, bz], check };
}

/** The Bloch vector (⟨σx⟩, ⟨σy⟩, ⟨σz⟩) of a normalised qubit state. */
export function bloch2(psi: State): [number, number, number] {
  const [a, b] = psi;
  // ⟨σx⟩ = 2 Re(a* b), ⟨σy⟩ = 2 Im(a* b), ⟨σz⟩ = |a|² − |b|²
  const re = a.re * b.re + a.im * b.im;
  const im = a.re * b.im - a.im * b.re;
  return [2 * re, 2 * im, cAbs2(a) - cAbs2(b)];
}

export type { Cx };
