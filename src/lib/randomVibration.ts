// Random vibration, base excitation and shaft critical speeds (Release E, engineering gap #12).
//
// WHO THIS IS FOR. Avionics boxes are qualified by random vibration (MIL-STD-810 method 514, RTCA DO-160 section 8,
// the NAVMAT P-9492 screening profile); rotating machinery and robot joints by their critical speeds. Three engines,
// pure functions, no Office.js, every loop capped:
//
//   1. A PSD BREAKPOINT PROFILE is straight between breakpoints on log-log axes, i.e. a power law
//      ASD(f) = a₁·(f/f₁)ⁿ with n = log(a₂/a₁)/log(f₂/f₁) on each segment. Its area is integrated EXACTLY, segment
//      by segment. The textbook closed form a₁f₁/(n+1)·((f₂/f₁)^(n+1) − 1) has a separate n = −1 case a₁f₁·ln(f₂/f₁),
//      and switching between them on a tolerance is a trap: a −3 dB/oct tail computes to n = −1 ± 1e−16 in floating
//      point and the general form then cancels catastrophically. One form serves every n:
//          area = a₁f₁·L·φ((n+1)·L),   L = ln(f₂/f₁),   φ(x) = expm1(x)/x,  φ(0) = 1
//      which IS a₁(f₂ − f₁) at n = 0 and a₁f₁·ln(f₂/f₁) at n = −1, with no branch.
//   2. MILES' EQUATION, Grms = √(π/2·fn·Q·ASD(fn)), is the response of a lightly damped SDOF to WHITE noise of level
//      ASD(fn). A real profile is not white, so the exact response ∫T(f/fn)²·ASD(f) df over the profile is integrated
//      too (composite Simpson in ln f, step a fraction of ζ so the resonance is resolved), and both are reported.
//      T is vibration.ts `transmissibility` — the app has ONE SDOF transmissibility.
//   3. A SHAFT'S FIRST CRITICAL SPEED: the uniform simply supported shaft (π/L)²√(EI/ρA) (Euler–Bernoulli, the whirl
//      speed equals the bending natural frequency when gyroscopic effects are neglected); point masses on a massless
//      shaft by Rayleigh's method from the static deflection, the deflections coming from beam.ts `analyzeBeam` so
//      the app has ONE beam-deflection answer; Dunkerley's lower bound 1/ω² = Σ 1/ωᵢ². Rayleigh is an upper bound,
//      Dunkerley a lower bound, and both are exact for one mass alone.

import { transmissibility, magnification } from "./vibration";
import { analyzeBeam, type Load } from "./beam";
import { parseRatLiteral } from "./cas";
import { fmtSig } from "./axis";

const show = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

export interface RvError {
  ok: false;
  error: string;
}

/** Standard acceleration of gravity, m/s² — a defined constant (3rd CGPM, 1901), not a measured one. */
export const STANDARD_GRAVITY = 9.80665;

/** Caps: a pane recomputes on every keystroke. */
export const PSD_MAX_POINTS = 200;
export const PSD_MAX_SPAN = 1e6;
export const ZETA_MIN = 0.001;
export const SHAFT_MAX_MASSES = 12;
/** The most integrand evaluations the exact SDOF response may use (a deterministic work bound). */
export const RESPONSE_MAX_EVALS = 250000;

const fail = (error: string): RvError => ({ ok: false, error });

// ---------------------------------------------------------------------------------------------------------------
// 1. PSD profile
// ---------------------------------------------------------------------------------------------------------------

export interface PsdSegment {
  f1: number;
  a1: number;
  f2: number;
  a2: number;
  /** Log-log slope exponent: ASD ∝ fⁿ on the segment. */
  n: number;
  /** The same slope in dB/octave: 10·log₁₀(a₂/a₁)/log₂(f₂/f₁). */
  dbPerOct: number;
  /** ∫ ASD df over the segment, g². */
  area: number;
}

export interface PsdProfile {
  ok: true;
  points: Array<[number, number]>;
  segments: PsdSegment[];
  /** Total area, g² (the mean square acceleration). */
  area: number;
  /** √area, g. */
  grms: number;
}

/** φ(x) = (eˣ − 1)/x, continuous through 0. */
function phi(x: number): number {
  return Math.abs(x) < 1e-12 ? 1 + x / 2 : Math.expm1(x) / x;
}

/** One log-log segment's area, by the single branch-free form above. */
export function segmentArea(f1: number, a1: number, f2: number, a2: number): number {
  const L = Math.log(f2 / f1);
  const n = Math.log(a2 / a1) / L;
  return a1 * f1 * L * phi((n + 1) * L);
}

/** Validates and integrates a breakpoint profile (frequency in Hz, ASD in g²/Hz). */
export function psdProfile(points: Array<[number, number]>): PsdProfile | RvError {
  if (points.length < 2) return fail("A PSD profile needs at least two breakpoints (frequency, ASD).");
  if (points.length > PSD_MAX_POINTS) return fail(`At most ${PSD_MAX_POINTS} breakpoints.`);
  for (let i = 0; i < points.length; i++) {
    const [f, a] = points[i];
    if (!Number.isFinite(f) || !Number.isFinite(a)) return fail(`Breakpoint ${i + 1}: every value must be a finite number.`);
    if (!(f > 0)) return fail(`Breakpoint ${i + 1}: frequency ${show(f)} Hz: a PSD frequency must be greater than zero (a log-log profile has no 0 Hz).`);
    if (!(a > 0)) return fail(`Breakpoint ${i + 1}: ASD ${show(a)} g²/Hz: an ASD must be greater than zero (a negative or zero level has no logarithm; leave the band out instead).`);
    if (i > 0 && !(f > points[i - 1][0]))
      return fail(`Breakpoint ${i + 1}: frequency ${show(f)} Hz does not increase from ${show(points[i - 1][0])} Hz; breakpoints must be in strictly increasing frequency.`);
  }
  if (points[points.length - 1][0] / points[0][0] > PSD_MAX_SPAN) return fail("The profile spans more than six decades of frequency; check the units of the frequency column (Hz).");
  const segments: PsdSegment[] = [];
  let area = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [f1, a1] = points[i];
    const [f2, a2] = points[i + 1];
    const n = Math.log(a2 / a1) / Math.log(f2 / f1);
    const seg = segmentArea(f1, a1, f2, a2);
    segments.push({ f1, a1, f2, a2, n, dbPerOct: (10 * Math.log10(a2 / a1)) / Math.log2(f2 / f1), area: seg });
    area += seg;
  }
  if (!Number.isFinite(area) || !(area > 0)) return fail("The profile's area is not a finite positive number; check the values.");
  return { ok: true, points: points.map(([f, a]) => [f, a]), segments, area, grms: Math.sqrt(area) };
}

/** ASD at f by log-log interpolation inside the profile; null outside [f_first, f_last]. */
export function asdAt(p: PsdProfile, f: number): number | null {
  const pts = p.points;
  if (!(f >= pts[0][0] && f <= pts[pts.length - 1][0])) return null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [f1, a1] = pts[i];
    const [f2, a2] = pts[i + 1];
    if (f <= f2) {
      if (f === f1) return a1;
      if (f === f2) return a2;
      return a1 * Math.exp((Math.log(a2 / a1) * Math.log(f / f1)) / Math.log(f2 / f1));
    }
  }
  return pts[pts.length - 1][1];
}

export interface MilesResult {
  /** Response Grms, g. */
  grms: number;
  /** RMS relative displacement, m. */
  xRms: number;
  /** 3σ relative displacement, m. */
  x3Sigma: number;
}

/** Miles' equation: Grms = √(π/2·fn·Q·ASD); x_rms = Grms·g/(2πfn)². */
export function miles(fn: number, Q: number, asd: number): MilesResult {
  const grms = Math.sqrt((Math.PI / 2) * fn * Q * asd);
  const xRms = (grms * STANDARD_GRAVITY) / Math.pow(2 * Math.PI * fn, 2);
  return { grms, xRms, x3Sigma: 3 * xRms };
}

export interface SdofRandomResponse {
  /** Exact response Grms over the profile band (absolute acceleration), g. */
  grms: number;
  /** Exact RMS relative displacement over the profile band, m. */
  xRms: number;
  /** Integrand evaluations used (the work bound). */
  evals: number;
}

/**
 * The exact random response of a base-excited SDOF to the profile (zero outside its band):
 *   absolute acceleration  Grms² = ∫ T(f/fn)²·ASD(f) df
 *   relative displacement  x_rms² = ∫ (M(f/fn)/ωn²)²·ASD(f)·g² df
 * by composite Simpson in u = ln f on each segment, step ≤ ζ/10 (the resonance half-width in ln f is ≈ ζ).
 */
export function sdofRandomResponse(p: PsdProfile, fn: number, zeta: number): SdofRandomResponse | RvError {
  if (!(fn > 0) || !Number.isFinite(fn)) return fail("The natural frequency must be a positive number of hertz.");
  if (!(zeta >= ZETA_MIN && zeta < 1)) return fail(`The damping ratio must be at least ${ZETA_MIN} (Q at most ${1 / (2 * ZETA_MIN)}) and below 1.`);
  const h = Math.min(zeta / 10, 0.02);
  const span = Math.log(p.points[p.points.length - 1][0] / p.points[0][0]);
  if (span / h + 3 * p.segments.length > RESPONSE_MAX_EVALS) return fail("The profile is too wide for this damping to integrate within the work bound; use a narrower band or more damping.");
  const wn2 = Math.pow(2 * Math.PI * fn, 2);
  let accSq = 0;
  let dispSq = 0;
  let evals = 0;
  for (const s of p.segments) {
    const L = Math.log(s.f2 / s.f1);
    let N = Math.max(2, Math.ceil(L / h));
    if (N % 2) N++;
    const du = L / N;
    let sa = 0;
    let sd = 0;
    for (let k = 0; k <= N; k++) {
      const u = k * du;
      const f = s.f1 * Math.exp(u);
      const asd = s.a1 * Math.exp(s.n * u);
      const r = f / fn;
      const T = transmissibility(r, zeta);
      const Mg = magnification(r, zeta);
      const w = k === 0 || k === N ? 1 : k % 2 ? 4 : 2;
      // df = f du
      sa += w * T * T * asd * f;
      sd += w * Mg * Mg * asd * f;
      evals++;
    }
    accSq += (sa * du) / 3;
    dispSq += (sd * du) / 3;
  }
  const g = STANDARD_GRAVITY;
  return { grms: Math.sqrt(accSq), xRms: (Math.sqrt(dispSq) * g) / wn2, evals };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Base excitation (sine)
// ---------------------------------------------------------------------------------------------------------------

export type BaseInput = { kind: "acc"; amplitude: number } | { kind: "disp"; amplitude: number };

export interface BaseExcitationResult {
  ok: true;
  r: number;
  /** Absolute transmissibility (acceleration out / acceleration in, or displacement out / in). */
  T: number;
  /** Magnification factor M(r) (relative displacement / (input acceleration/ωn²)). */
  M: number;
  /** Base acceleration amplitude, m/s². */
  baseAcc: number;
  /** Base displacement amplitude, m. */
  baseDisp: number;
  /** Absolute acceleration amplitude of the mass, m/s². */
  absAcc: number;
  /** Absolute displacement amplitude of the mass, m. */
  absDisp: number;
  /** Relative displacement (isolator deflection) amplitude, m. */
  relDisp: number;
  /** r above √2: the mount isolates. */
  isolating: boolean;
  /** The transmissibility peak (r, T) for this ζ. */
  peak: { r: number; T: number };
}

/** Peak of the absolute transmissibility: r_p = √(√(1 + 8ζ²) − 1)/(2ζ). */
export function transmissibilityPeak(zeta: number): { r: number; T: number } {
  const r = Math.sqrt(Math.sqrt(1 + 8 * zeta * zeta) - 1) / (2 * zeta);
  return { r, T: transmissibility(r, zeta) };
}

/** Steady-state response of a base-excited SDOF to a sine base input at frequency f (Hz). */
export function baseExcitation(fn: number, zeta: number, f: number, input: BaseInput): BaseExcitationResult | RvError {
  if (!(fn > 0) || !Number.isFinite(fn)) return fail("The natural frequency must be a positive number of hertz.");
  if (!(f > 0) || !Number.isFinite(f)) return fail("The excitation frequency must be a positive number of hertz.");
  if (!(zeta >= ZETA_MIN && zeta < 1)) return fail(`The damping ratio must be at least ${ZETA_MIN} and below 1.`);
  if (!(input.amplitude > 0) || !Number.isFinite(input.amplitude)) return fail("The base input amplitude must be a positive number.");
  const r = f / fn;
  if (!(r >= 1e-3 && r <= 1e3)) return fail("The frequency ratio f/fn is outside 0.001–1000; check the frequencies and their units.");
  const w = 2 * Math.PI * f;
  const wn2 = Math.pow(2 * Math.PI * fn, 2);
  const baseAcc = input.kind === "acc" ? input.amplitude : input.amplitude * w * w;
  const baseDisp = input.kind === "disp" ? input.amplitude : input.amplitude / (w * w);
  const T = transmissibility(r, zeta);
  const M = magnification(r, zeta);
  return {
    ok: true,
    r,
    T,
    M,
    baseAcc,
    baseDisp,
    absAcc: T * baseAcc,
    absDisp: T * baseDisp,
    relDisp: (M * baseAcc) / wn2,
    isolating: r > Math.SQRT2,
    peak: transmissibilityPeak(zeta),
  };
}

/** T(r) sampled for the figure: log-spaced over [lo, hi] plus a dense run through the peak. */
export function transmissibilityCurve(zeta: number, lo: number, hi: number): Array<[number, number]> {
  const xs: number[] = [];
  const N = 300;
  for (let i = 0; i <= N; i++) xs.push(lo * Math.pow(hi / lo, i / N));
  const pk = transmissibilityPeak(zeta).r;
  const band = Math.max(4 * zeta, 0.002);
  for (let i = 0; i <= 160; i++) {
    const x = pk * Math.exp(-band + (2 * band * i) / 160);
    if (x > lo && x < hi) xs.push(x);
  }
  xs.sort((a, b) => a - b);
  return xs.map((x) => [x, transmissibility(x, zeta)]);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Shaft critical speeds
// ---------------------------------------------------------------------------------------------------------------

export interface ShaftSection {
  /** Second moment of area, m⁴. */
  I: number;
  /** Cross-section area, m². */
  A: number;
}

/** A solid (di = 0) or hollow round section. */
export function roundSection(dOuter: number, dInner = 0): ShaftSection | RvError {
  if (!(dOuter > 0) || !Number.isFinite(dOuter)) return fail("The shaft diameter must be a positive length.");
  if (!(dInner >= 0) || !Number.isFinite(dInner)) return fail("The bore must be zero or a positive length.");
  if (!(dInner < dOuter)) return fail("The bore must be smaller than the outside diameter.");
  return { I: (Math.PI * (dOuter ** 4 - dInner ** 4)) / 64, A: (Math.PI * (dOuter ** 2 - dInner ** 2)) / 4 };
}

/** The first `modes` bending criticals of a uniform simply supported shaft, rad/s: ωₙ = (nπ/L)²√(EI/ρA). */
export function uniformShaftCriticals(E: number, s: ShaftSection, rho: number, L: number, modes = 3): number[] | RvError {
  if (!(E > 0) || !(rho > 0) || !(L > 0) || ![E, rho, L, s.I, s.A].every(Number.isFinite)) return fail("E, density and length must be positive numbers.");
  const base = Math.sqrt((E * s.I) / (rho * s.A));
  const out: number[] = [];
  for (let n = 1; n <= Math.min(10, Math.max(1, Math.floor(modes))); n++) out.push(Math.pow((n * Math.PI) / L, 2) * base);
  return out;
}

export interface PointMass {
  /** kg */
  m: number;
  /** Position from the left bearing, m. */
  x: number;
}

export interface MassShaftResult {
  ok: true;
  /** Static deflection per unit g at each mass (δᵢ, m per (m/s²)): y = g·δ under gravity. */
  delta: number[];
  /** Self-influence aᵢᵢ (m/N): deflection at mass i under a unit load there alone. */
  selfInfluence: number[];
  /** Each mass alone on the massless shaft, rad/s: 1/√(mᵢaᵢᵢ). */
  alone: number[];
  /** Rayleigh first critical of the masses on the massless shaft, rad/s (exact for one mass). */
  rayleigh: number;
  /** Static deflection shape (x, y per unit g … scaled to max 1) for the figure. */
  shape: Array<[number, number]>;
}

/**
 * An exact rational for beam.ts from a finite double, rounded to 12 significant figures first: the inputs were typed
 * to far fewer, and a 17-digit binary artefact (0.24020000000000002) makes the exact solve several times slower.
 */
function ratOf(v: number) {
  return parseRatLiteral(String(Number(v.toPrecision(12))));
}

/** Point masses on a massless simply supported shaft: Rayleigh from the static deflection, influences from beam.ts. */
export function massShaft(E: number, I: number, L: number, masses: PointMass[]): MassShaftResult | RvError {
  if (!masses.length) return fail("Give at least one mass.");
  if (masses.length > SHAFT_MAX_MASSES) return fail(`At most ${SHAFT_MAX_MASSES} masses.`);
  if (!(E > 0) || !(I > 0) || !(L > 0) || ![E, I, L].every(Number.isFinite)) return fail("E, I and the length must be positive numbers.");
  for (let i = 0; i < masses.length; i++) {
    const { m, x } = masses[i];
    if (!(m > 0) || !Number.isFinite(m)) return fail(`Mass ${i + 1}: the mass must be a positive number.`);
    if (!Number.isFinite(x) || !(x > 0 && x < L)) return fail(`Mass ${i + 1}: its position must lie strictly between the bearings (0 and the length); a mass on a bearing does not deflect the shaft.`);
  }
  const Lr = ratOf(L);
  const zero = ratOf(0);
  if (!Lr || !zero) return fail("The length could not be read exactly.");
  const supports = [
    { kind: "pin" as const, x: zero },
    { kind: "roller" as const, x: Lr },
  ];
  const pointLoad = (x: number, p: number): Load | null => {
    const xr = ratOf(x);
    const pr = ratOf(p);
    return xr && pr ? { kind: "point", x: xr, p: pr } : null;
  };
  // All masses' weights per unit g: loads equal to the masses (beam.ts takes downward loads positive; v is up-positive).
  const all = masses.map((q) => pointLoad(q.x, q.m));
  if (all.some((l) => !l)) return fail("A mass or position could not be read exactly.");
  const beamAll = analyzeBeam({ length: Lr, supports, loads: all as Load[] });
  if (!beamAll.ok) return fail(`Static deflection: ${beamAll.error}`);
  const EI = E * I;
  const delta = masses.map((q) => -beamAll.eiDeflectionAt(q.x) / EI);
  // Self-influence of each mass alone: a·b²·a/(3EIL) for a unit load at a (b = L − a), the classical simply supported
  // result. Taken in closed form because a beam.ts solve per mass costs ~17 ms each in exact
  // arithmetic (12 masses would blow the 300 ms budget); randomVibration.test.ts pins it equal to analyzeBeam's
  // unit-load deflection at many positions, so the app still has one beam-deflection answer.
  const selfInfluence = masses.map((q) => selfInfluenceSS(EI, L, q.x));
  if (!delta.every((d) => d > 0) || !selfInfluence.every((a) => a > 0)) return fail("The static deflection is not positive at every mass; check the inputs.");
  let num = 0;
  let den = 0;
  masses.forEach((q, i) => {
    num += q.m * delta[i];
    den += q.m * delta[i] * delta[i];
  });
  const rayleigh = Math.sqrt(num / den);
  const alone = masses.map((q, i) => 1 / Math.sqrt(q.m * selfInfluence[i]));
  const shape: Array<[number, number]> = [];
  const NS = 60;
  let maxY = 0;
  for (let k = 0; k <= NS; k++) {
    const x = (L * k) / NS;
    const y = -beamAll.eiDeflectionAt(x) / EI;
    shape.push([x, y]);
    maxY = Math.max(maxY, Math.abs(y));
  }
  return { ok: true, delta, selfInfluence, alone, rayleigh, shape: shape.map(([x, y]) => [x, maxY > 0 ? y / maxY : 0]) };
}

/** Deflection at a under a unit load at a, simply supported span L: a²(L − a)²/(3EIL), m/N. */
export function selfInfluenceSS(EI: number, L: number, a: number): number {
  const b = L - a;
  return (a * a * b * b) / (3 * EI * L);
}

/** Dunkerley's lower bound: 1/ω² = Σ 1/ωᵢ² over the components (each acting alone). */
export function dunkerley(components: number[]): number {
  let s = 0;
  for (const w of components) s += 1 / (w * w);
  return 1 / Math.sqrt(s);
}

/** Within ±band (fraction) of a critical? Returns the signed margin (Ω − ω)/ω. */
export function speedMargin(operating: number, critical: number): number {
  return (operating - critical) / critical;
}
