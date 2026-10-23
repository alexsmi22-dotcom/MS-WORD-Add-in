// Compressible flow beyond the isentropic relations (Release E, gap #11): the normal shock, the oblique shock with
// its θ–β–M relation, the Prandtl–Meyer expansion, Fanno flow (adiabatic duct with friction) and Rayleigh flow
// (frictionless duct with heat addition). Calorically perfect gas, γ a user input.
//
// Every closed form is NACA Report 1135 ("Equations, tables, and charts for compressible flow", Ames Research Staff,
// 1953). EVERY ISENTROPIC RATIO — T₀/T, p₀/p, A/A* — COMES FROM fluids.ts compressibleFlow, so the app never gives two
// answers to one isentropic question: the stagnation-pressure ratio across a shock is (p₂/p₁)·(p₀/p)(M₂)/(p₀/p)(M₁),
// Fanno's p₀/p₀* is A/A* identically, and Rayleigh's T₀/T₀* and p₀/p₀* are the static ratios times the isentropic
// ratio at M over the one at M = 1.
//
// Root finding is bisection on a bracket that is proved before the loop starts (each function is monotonic on the
// branch it is searched on), with a hard iteration cap: no Newton step can leave a branch or run forever.

import { compressibleFlow } from "./fluids";
import { fmtSig, MINUS } from "./axis";

/** An input echoed in a message: six significant figures, trailing zeros dropped, U+2212, ×10ⁿ, never e-notation. */
function fv(v: number): string {
  const a = Math.abs(v);
  if (v !== 0 && (a < 1e-3 || a >= 1e6)) return fmtSig(v, 6);
  return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(6)));
}

export type GdError = { ok: false; error: string };

/** The largest specific-heat ratio accepted: 5/3, the monatomic ideal gas (no ideal gas exceeds it). */
export const GAMMA_MAX = 5 / 3;
/** The largest Mach number accepted: bounds every bracket and figure. */
export const MACH_MAX = 50;
/** Bisection iterations: 200 halvings exhaust double precision on any bracket used here. */
const BISECT_CAP = 200;
const DEG = 180 / Math.PI;

/** γ must satisfy 1 < γ ≤ 5/3. */
export function checkGamma(g: number): GdError | null {
  if (!Number.isFinite(g)) return { ok: false, error: "The specific-heat ratio γ must be a finite number." };
  if (g <= 1) return { ok: false, error: `γ = ${fv(g)} is not allowed: the specific-heat ratio of a gas must be greater than 1.` };
  // 1.667 and 1.6667 are how people type 5/3; the tolerance admits them and nothing a real gas could not have.
  if (g > GAMMA_MAX + 1e-3) {
    return { ok: false, error: `γ = ${fv(g)} is not allowed: no ideal gas has γ above 5/3 (1.667, a monatomic gas).` };
  }
  return null;
}

/** The isentropic ratios at M from fluids.ts (stagnation over static, and A/A*). */
function isen(M: number, g: number): { T0T: number; p0p: number; AAs: number } {
  const r = compressibleFlow(M, g);
  if (!r.ok) throw new Error(r.error); // unreachable: M ≥ 0 and γ > 1 are checked by every caller
  return { T0T: r.temperatureRatio, p0p: r.pressureRatio, AAs: r.areaRatio };
}

/** Bisection for f(x) = 0 on [lo, hi] where f(lo) and f(hi) have opposite signs (checked by the caller). */
function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  // A root exactly on an end (a zero-length duct, no heat) is returned as is: with flo = 0 the sign test below
  // would walk the bracket away from it.
  if (flo === 0) return lo;
  if (f(hi) === 0) return hi;
  for (let i = 0; i < BISECT_CAP; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fm > 0 === flo > 0) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function checkMach(M: number, name: string, min: number, minText: string): GdError | null {
  if (!Number.isFinite(M)) return { ok: false, error: `${name} must be a finite number.` };
  if (M <= min) return { ok: false, error: minText };
  if (M > MACH_MAX) return { ok: false, error: `${name} = ${fv(M)} is above the limit of ${MACH_MAX} this tool accepts.` };
  return null;
}

// ------------------------------------------------------------------ normal shock

export interface NormalShock {
  ok: true;
  M1: number;
  M2: number;
  p2p1: number;
  T2T1: number;
  rho2rho1: number;
  /** Stagnation-pressure ratio p₀₂/p₀₁ (the total-pressure recovery). */
  p02p01: number;
  /** Pitot ratio p₀₂/p₁ (what a pitot tube reads behind the shock over the free-stream static pressure). */
  p02p1: number;
}

/** The normal-shock relations (NACA 1135 eqs. 93–97). M₁ ≤ 1 is refused: there is no normal shock in subsonic flow. */
export function normalShock(M1: number, g = 1.4): NormalShock | GdError {
  const eg = checkGamma(g);
  if (eg) return eg;
  const em = checkMach(
    M1,
    "The upstream Mach number M₁",
    1,
    `M₁ = ${fv(M1)} is not supersonic: a normal shock needs M₁ > 1 (subsonic flow has no normal shock).`,
  );
  if (em) return em;
  const m2 = M1 * M1;
  const M2 = Math.sqrt((1 + ((g - 1) / 2) * m2) / (g * m2 - (g - 1) / 2));
  const p2p1 = 1 + ((2 * g) / (g + 1)) * (m2 - 1);
  const rho2rho1 = ((g + 1) * m2) / ((g - 1) * m2 + 2);
  const T2T1 = p2p1 / rho2rho1;
  const p02p01 = (p2p1 * isen(M2, g).p0p) / isen(M1, g).p0p;
  const p02p1 = p2p1 * isen(M2, g).p0p;
  return { ok: true, M1, M2, p2p1, T2T1, rho2rho1, p02p01, p02p1 };
}

// ------------------------------------------------------------------ oblique shock

/** Flow deflection θ (rad) for shock angle β (rad) at M₁: tan θ = 2 cot β (M₁² sin²β − 1)/(M₁²(γ + cos 2β) + 2). */
export function thetaOfBeta(beta: number, M1: number, g: number): number {
  const s = Math.sin(beta);
  const num = 2 * (M1 * M1 * s * s - 1);
  const den = Math.tan(beta) * (M1 * M1 * (g + Math.cos(2 * beta)) + 2);
  return Math.atan(num / den);
}

/** The shock angle at maximum deflection (closed form, NACA 1135 eq. 168). */
export function betaAtThetaMax(M1: number, g: number): number {
  const m2 = M1 * M1;
  const s2 =
    (((g + 1) / 4) * m2 - 1 + Math.sqrt((g + 1) * (1 + ((g - 1) / 2) * m2 + ((g + 1) / 16) * m2 * m2))) / (g * m2);
  return Math.asin(Math.sqrt(Math.min(1, s2)));
}

export interface ObliqueSide {
  /** Shock angle, degrees. */
  betaDeg: number;
  M2: number;
  p2p1: number;
  T2T1: number;
  rho2rho1: number;
  p02p01: number;
  /** The upstream normal Mach component M₁ sin β. */
  Mn1: number;
}

export interface ObliqueShock {
  ok: true;
  M1: number;
  thetaDeg: number;
  thetaMaxDeg: number;
  betaMaxDeg: number;
  /** Mach angle μ = asin(1/M₁), degrees. */
  muDeg: number;
  weak: ObliqueSide;
  strong: ObliqueSide;
}

function obliqueSide(M1: number, beta: number, theta: number, g: number): ObliqueSide {
  const Mn1 = M1 * Math.sin(beta);
  if (Mn1 <= 1 + 1e-12) {
    // A Mach wave (θ = 0, β = μ): no compression.
    return { betaDeg: beta * DEG, M2: M1, p2p1: 1, T2T1: 1, rho2rho1: 1, p02p01: 1, Mn1: 1 };
  }
  const ns = normalShock(Mn1, g) as NormalShock;
  return {
    betaDeg: beta * DEG,
    M2: ns.M2 / Math.sin(beta - theta),
    p2p1: ns.p2p1,
    T2T1: ns.T2T1,
    rho2rho1: ns.rho2rho1,
    p02p01: ns.p02p01,
    Mn1,
  };
}

/** The attached oblique shock for deflection θ (degrees): weak and strong solutions; θ > θmax is a detached shock. */
export function obliqueShock(M1: number, thetaDeg: number, g = 1.4): ObliqueShock | GdError {
  const eg = checkGamma(g);
  if (eg) return eg;
  const em = checkMach(M1, "The upstream Mach number M₁", 1, `M₁ = ${fv(M1)} is not supersonic: an oblique shock needs M₁ > 1.`);
  if (em) return em;
  if (!Number.isFinite(thetaDeg)) return { ok: false, error: "The deflection angle θ must be a finite number." };
  if (thetaDeg < 0) {
    return {
      ok: false,
      error: `θ = ${fv(thetaDeg)}° is negative: a wall turning away from the flow is an expansion. Choose the Prandtl–Meyer expansion instead.`,
    };
  }
  const mu = Math.asin(1 / M1);
  const bMax = betaAtThetaMax(M1, g);
  const thMax = thetaOfBeta(bMax, M1, g);
  const th = thetaDeg / DEG;
  const base = { ok: true as const, M1, thetaDeg, thetaMaxDeg: thMax * DEG, betaMaxDeg: bMax * DEG, muDeg: mu * DEG };
  if (th > thMax + 1e-12) {
    return {
      ok: false,
      error:
        `Detached shock: θ = ${fv(thetaDeg)}° exceeds θmax = ${(thMax * DEG).toFixed(2)}° for M₁ = ${fv(M1)} (γ = ${fv(g)}). ` +
        "No attached oblique shock turns the flow that far; a curved bow shock stands off the body instead.",
    };
  }
  if (th === 0) {
    return { ...base, weak: obliqueSide(M1, mu, 0, g), strong: obliqueSide(M1, Math.PI / 2, 0, g) };
  }
  if (th >= thMax - 1e-12) {
    const s = obliqueSide(M1, bMax, th, g);
    return { ...base, weak: s, strong: s };
  }
  const f = (b: number): number => thetaOfBeta(b, M1, g) - th;
  // θ(β) rises from 0 at μ to θmax at βmax, then falls to 0 at 90°: one root on each side.
  const bw = bisect(f, mu, bMax);
  const bs = bisect(f, bMax, Math.PI / 2);
  return { ...base, weak: obliqueSide(M1, bw, th, g), strong: obliqueSide(M1, bs, th, g) };
}

// ------------------------------------------------------------------ Prandtl–Meyer

/** ν(M), radians (NACA 1135 eq. 171). */
export function prandtlMeyerNu(M: number, g: number): number {
  const k = Math.sqrt((g + 1) / (g - 1));
  const r = Math.sqrt(M * M - 1);
  return k * Math.atan(r / k) - Math.atan(r);
}

/** ν_max = (π/2)(√((γ+1)/(γ−1)) − 1), radians: the turn that expands the flow to vacuum. */
export function prandtlMeyerNuMax(g: number): number {
  return (Math.PI / 2) * (Math.sqrt((g + 1) / (g - 1)) - 1);
}

/** The Mach number with ν(M) = nu (radians), 0 ≤ ν < ν(MACH_MAX); null above that. */
export function machFromNu(nu: number, g: number): number | null {
  if (nu === 0) return 1;
  if (!(nu > 0) || nu > prandtlMeyerNu(MACH_MAX, g)) return null;
  return bisect((M) => prandtlMeyerNu(M, g) - nu, 1, MACH_MAX);
}

export interface PrandtlMeyer {
  ok: true;
  M1: number;
  nu1Deg: number;
  nuMaxDeg: number;
  /** Present when a turning angle was given. */
  turnDeg?: number;
  nu2Deg?: number;
  M2?: number;
  /** Static ratios across the (isentropic) expansion. */
  p2p1?: number;
  T2T1?: number;
  rho2rho1?: number;
  /** Mach angles before and after, degrees (the fan's edges). */
  mu1Deg: number;
  mu2Deg?: number;
}

/** ν(M₁) and, given a turning angle (degrees), the expanded M₂ (isentropic, so p₀ and T₀ are unchanged). */
export function prandtlMeyer(M1: number, turnDeg: number | null, g = 1.4): PrandtlMeyer | GdError {
  const eg = checkGamma(g);
  if (eg) return eg;
  if (!Number.isFinite(M1)) return { ok: false, error: "The upstream Mach number M₁ must be a finite number." };
  if (M1 < 1) return { ok: false, error: `M₁ = ${fv(M1)} is subsonic: a Prandtl–Meyer expansion needs M₁ ≥ 1.` };
  if (M1 > MACH_MAX) return { ok: false, error: `M₁ = ${fv(M1)} is above the limit of ${MACH_MAX} this tool accepts.` };
  const nu1 = prandtlMeyerNu(M1, g);
  const nuMax = prandtlMeyerNuMax(g);
  const out: PrandtlMeyer = { ok: true, M1, nu1Deg: nu1 * DEG, nuMaxDeg: nuMax * DEG, mu1Deg: Math.asin(1 / M1) * DEG };
  if (turnDeg === null) return out;
  if (!Number.isFinite(turnDeg)) return { ok: false, error: "The turning angle must be a finite number." };
  if (turnDeg < 0) {
    return {
      ok: false,
      error: `A turning angle of ${fv(turnDeg)}° turns the flow into itself: that is a compression. Choose the oblique shock instead.`,
    };
  }
  const nu2 = nu1 + turnDeg / DEG;
  if (nu2 >= nuMax) {
    return {
      ok: false,
      error:
        `The turn of ${fv(turnDeg)}° is beyond the maximum: ν(M₁) + θ = ${(nu2 * DEG).toFixed(2)}° reaches ` +
        `νmax = ${(nuMax * DEG).toFixed(2)}° (γ = ${fv(g)}), the turn that expands the flow to vacuum. ` +
        `The largest possible turn from M₁ = ${fv(M1)} is ${((nuMax - nu1) * DEG).toFixed(2)}°.`,
    };
  }
  const M2 = machFromNu(nu2, g);
  if (M2 === null) {
    return {
      ok: false,
      error: `The expansion would reach a Mach number above ${MACH_MAX}, the limit of this tool (ν = ${(nu2 * DEG).toFixed(2)}°).`,
    };
  }
  const a = isen(M1, g), b = isen(M2, g);
  return {
    ...out,
    turnDeg,
    nu2Deg: nu2 * DEG,
    M2,
    p2p1: a.p0p / b.p0p,
    T2T1: a.T0T / b.T0T,
    rho2rho1: a.p0p / a.T0T / (b.p0p / b.T0T),
    mu2Deg: Math.asin(1 / M2) * DEG,
  };
}

// ------------------------------------------------------------------ Fanno

export interface FannoState {
  M: number;
  /** 4f̄L* / D with f̄ the mean FANNING friction factor (= f_D L* / D with the Darcy factor). */
  fLD: number;
  TTs: number;
  pps: number;
  p0p0s: number;
  VVs: number;
  rhoRhos: number;
}

/** 4f̄L* / D (Fanning) at M (NACA 1135 eq. 117 form). */
export function fannoFLD(M: number, g: number): number {
  const m2 = M * M;
  return (1 - m2) / (g * m2) + ((g + 1) / (2 * g)) * Math.log(((g + 1) * m2) / (2 + (g - 1) * m2));
}

/** The supersonic limit of 4f̄L* / D as M → ∞: ((γ+1)/2γ) ln((γ+1)/(γ−1)) − 1/γ. */
export function fannoFLDSupersonicLimit(g: number): number {
  return ((g + 1) / (2 * g)) * Math.log((g + 1) / (g - 1)) - 1 / g;
}

export function fannoState(M: number, g: number): FannoState {
  const TTs = (g + 1) / (2 + (g - 1) * M * M);
  const VVs = M * Math.sqrt(TTs);
  return { M, fLD: fannoFLD(M, g), TTs, pps: Math.sqrt(TTs) / M, p0p0s: isen(M, g).AAs, VVs, rhoRhos: 1 / VVs };
}

export interface FannoResult {
  ok: true;
  branch: "subsonic" | "sonic" | "supersonic";
  s1: FannoState;
  /** Present when a duct 4f̄L/D was given and the flow does not choke. */
  fLD?: number;
  s2?: FannoState;
}

/** Fanno state at M₁ and, given the duct's 4f̄L/D (Fanning), the exit M₂ on the same branch; choking is refused. */
export function fanno(M1: number, fLD: number | null, g = 1.4): FannoResult | GdError {
  const eg = checkGamma(g);
  if (eg) return eg;
  const em = checkMach(M1, "The inlet Mach number M₁", 0, `M₁ = ${fv(M1)}: the Mach number must be greater than 0.`);
  if (em) return em;
  const s1 = fannoState(M1, g);
  const branch = M1 === 1 ? "sonic" : M1 < 1 ? "subsonic" : "supersonic";
  if (fLD === null) return { ok: true, branch, s1 };
  if (!Number.isFinite(fLD) || fLD < 0) return { ok: false, error: "The duct's 4f̄L/D must be zero or greater." };
  const target = s1.fLD - fLD;
  if (target < -1e-12 * Math.max(1, s1.fLD)) {
    return {
      ok: false,
      error:
        `Choked: the duct's 4f̄L/D = ${fmtSig(fLD, 4)} exceeds 4f̄L*/D = ${fmtSig(s1.fLD, 4)} at M₁ = ${fv(M1)}, ` +
        "the length that brings the flow to Mach 1. The flow cannot pass with this inlet state: " +
        (M1 < 1
          ? "a subsonic inlet Mach number falls (the mass flow drops) until the duct is exactly choking."
          : "a supersonic inlet flow takes a shock inside the duct (or the inlet unstarts)."),
    };
  }
  if (fLD === 0) return { ok: true, branch, s1, fLD, s2: s1 };
  if (target <= 0 || M1 === 1) return { ok: true, branch, s1, fLD, s2: fannoState(1, g) };
  const f = (M: number): number => fannoFLD(M, g) - target;
  // 4f̄L*/D falls monotonically to 0 at M = 1 from either side, so the exit lies between M₁ and 1.
  const M2 = M1 < 1 ? bisect(f, M1, 1) : bisect(f, 1, M1);
  return { ok: true, branch, s1, fLD, s2: fannoState(M2, g) };
}

// ------------------------------------------------------------------ Rayleigh

export interface RayleighState {
  M: number;
  T0T0s: number;
  TTs: number;
  pps: number;
  p0p0s: number;
  VVs: number;
  rhoRhos: number;
}

export function rayleighState(M: number, g: number): RayleighState {
  const d = 1 + g * M * M;
  const pps = (g + 1) / d;
  const TTs = pps * pps * M * M;
  const at = isen(M, g), star = isen(1, g);
  const VVs = ((g + 1) * M * M) / d;
  return { M, T0T0s: (TTs * at.T0T) / star.T0T, TTs, pps, p0p0s: (pps * at.p0p) / star.p0p, VVs, rhoRhos: 1 / VVs };
}

/** The supersonic limit of T₀/T₀* as M → ∞: (γ² − 1)/γ². */
export function rayleighT0SupersonicLimit(g: number): number {
  return (g * g - 1) / (g * g);
}

export interface RayleighResult {
  ok: true;
  branch: "subsonic" | "sonic" | "supersonic";
  s1: RayleighState;
  /** Present when heat was given. */
  T02T01?: number;
  s2?: RayleighState;
  /** T₀₂/T₀₁ that would just choke the duct (= 1/(T₀/T₀*)(M₁)). */
  chokeRatio: number;
}

/** Rayleigh state at M₁ and, given T₀₂/T₀₁, the exit M₂ on the same branch; thermal choking is refused. */
export function rayleigh(M1: number, T02T01: number | null, g = 1.4): RayleighResult | GdError {
  const eg = checkGamma(g);
  if (eg) return eg;
  const em = checkMach(M1, "The inlet Mach number M₁", 0, `M₁ = ${fv(M1)}: the Mach number must be greater than 0.`);
  if (em) return em;
  const s1 = rayleighState(M1, g);
  const branch = M1 === 1 ? "sonic" : M1 < 1 ? "subsonic" : "supersonic";
  const chokeRatio = 1 / s1.T0T0s;
  if (T02T01 === null) return { ok: true, branch, s1, chokeRatio };
  if (!Number.isFinite(T02T01) || T02T01 <= 0) {
    return { ok: false, error: "T₀₂/T₀₁ must be greater than 0 (an absolute stagnation temperature cannot reach zero)." };
  }
  const target = s1.T0T0s * T02T01;
  if (T02T01 === 1) return { ok: true, branch, s1, T02T01, s2: s1, chokeRatio };
  if (target > 1 + 1e-12) {
    return {
      ok: false,
      error:
        `Thermally choked: T₀₂/T₀₁ = ${fmtSig(T02T01, 4)} needs more heat than the flow can take. At M₁ = ${fv(M1)} ` +
        `the most it can absorb raises T₀ by the factor ${fmtSig(chokeRatio, 4)} (to Mach 1 at the exit); ` +
        (M1 < 1
          ? "beyond that the inlet Mach number falls (the mass flow drops)."
          : "beyond that a shock forms and the flow upstream changes."),
    };
  }
  if (target >= 1 - 1e-12 || M1 === 1) {
    if (M1 === 1 && T02T01 !== 1) {
      return {
        ok: false,
        error: "At M₁ = 1 the flow is already thermally choked: no heat can be added, and removing heat moves it off Mach 1 on either branch (ambiguous).",
      };
    }
    return { ok: true, branch, s1, T02T01, s2: rayleighState(1, g), chokeRatio };
  }
  const f = (M: number): number => rayleighState(M, g).T0T0s - target;
  if (M1 < 1) {
    // T₀/T₀* rises monotonically from 0 (M → 0) to 1 (M = 1) on the subsonic branch.
    const lo = 1e-6;
    if (f(lo) > 0) {
      return { ok: false, error: `Cooling by T₀₂/T₀₁ = ${fmtSig(T02T01, 4)} would take the Mach number below 10⁻⁶; refused.` };
    }
    return { ok: true, branch, s1, T02T01, s2: rayleighState(bisect(f, lo, 1), g), chokeRatio };
  }
  // Supersonic branch: T₀/T₀* falls from 1 (M = 1) toward (γ² − 1)/γ² as M → ∞.
  if (f(MACH_MAX) > 0) {
    return {
      ok: false,
      error:
        `Cooling by T₀₂/T₀₁ = ${fmtSig(T02T01, 4)} is more than a supersonic Rayleigh flow can take: T₀/T₀* cannot fall ` +
        `below ${fmtSig(rayleighT0SupersonicLimit(g), 4)} (M → ∞), and the exit would pass M = ${MACH_MAX}, the limit of this tool.`,
    };
  }
  return { ok: true, branch, s1, T02T01, s2: rayleighState(bisect(f, 1, MACH_MAX), g), chokeRatio };
}
