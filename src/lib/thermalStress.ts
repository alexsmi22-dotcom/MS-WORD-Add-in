// Thermal stress and expansion mismatch (Release E, gap #3): the restrained-bar / plate / body stress, the Timoshenko
// (1925) bimetal curvature with the layer stresses of the same model, Stoney's thin-film relation both ways, and the
// first thermal-shock resistance parameter. Pure functions in SI (Pa, m, K, 1/K); no units, wording or drawing here.
//
// Sources (closed forms, checked against the integrator's oracle ~/jurislab-relE/oracle_wave1.py):
//   - Restrained stress: σ = −EαΔT (bar), −EαΔT/(1−ν) (equal-biaxial, plate restrained in its plane),
//     −EαΔT/(1−2ν) (all three directions) — Hooke's law with the total strain held at zero.
//   - S. Timoshenko, "Analysis of bi-metal thermostats" (1925), as the brief states it:
//     κ = 6ΔαΔT(1+m)² / (h[3(1+m)² + (1+mn)(m² + 1/(mn))]), m = t₁/t₂, n = E₁/E₂, h = t₁+t₂ (beam theory, no ν).
//     Layer stresses from the same model: the axial force P per unit width obeys the moment balance
//     P·h/2 = κ(E₁t₁³ + E₂t₂³)/12, and each layer carries ∓P/tᵢ plus its own bending ±Eᵢκtᵢ/2. Verified by solving
//     force balance, moment balance and interface strain compatibility as a linear system (numpy) — it reproduces
//     Timoshenko's κ to machine precision for both case-table strips (see thermalStressCases.test.ts).
//   - G. G. Stoney (1909), the thin-film relation:
//     σ_f = E_s h_s² κ / (6(1−ν_s) h_f), the biaxial-modulus form, valid for a film much thinner than its substrate.
//   - The first thermal-shock resistance parameter R = σ_f(1−ν)/(Eα) and R′ = kR. No Biot correction: no form of it
//     was checked against a source for this release, so none is used.

export type Fail = { ok: false; error: string };

const fin = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));
/** −0 is not a stress anybody wrote down; Object.is(−0, 0) is false, and "−0 MPa" is not a display. */
const z = (x: number): number => (x === 0 ? 0 : x);

/** Poisson's ratio inside isotropic linear elasticity, or a named refusal. */
function poissonError(nu: number, what: string): string | null {
  if (!Number.isFinite(nu)) return `${what}: Poisson's ratio ν is required here.`;
  if (nu >= 0.5) {
    return (
      `${what}: ν = ${nu} is at or above 0.5, outside isotropic linear elasticity (−1 < ν < 0.5). At ν = 0.5 the ` +
      "material is incompressible and a body restrained in all directions carries unbounded stress; use a ν below 0.5."
    );
  }
  if (nu <= -1) return `${what}: ν = ${nu} is at or below −1, outside isotropic linear elasticity (−1 < ν < 0.5).`;
  return null;
}

// ------------------------------------------------------------------ restrained thermal stress

export type RestraintMode = "uniaxial" | "biaxial" | "triaxial";
export type Restraint = { kind: "full" } | { kind: "fraction"; r: number } | { kind: "gap"; gap: number; length: number };

export interface RestrainedInput {
  E: number;
  alpha: number;
  dT: number;
  nu: number;
  mode: RestraintMode;
  restraint: Restraint;
}

export interface RestrainedResult {
  ok: true;
  /** The restrained stress in each restrained direction (Pa); negative = compression. */
  sigma: number;
  /** The free thermal strain αΔT. */
  freeStrain: number;
  /** The mode multiplier: 1, 1/(1−ν), 1/(1−2ν). */
  modeFactor: number;
  /** Gap restraint: the ΔT at which the gap closes (K), or null (never closes for this sign of α). */
  dTClose: number | null;
  /** The stress state (Pa), for the yield check: equal normal stresses in the restrained directions. */
  state: { sx: number; sy: number; sz: number };
}

/** Validates once, so the sweep below can trust the input. */
export function checkRestrained(inp: RestrainedInput): Fail | null {
  const { E, alpha, dT, nu, mode, restraint } = inp;
  if (!fin(E) || E <= 0) return { ok: false, error: "Young's modulus E must be a positive finite number." };
  if (!fin(alpha)) return { ok: false, error: "The expansion coefficient α must be a finite number." };
  if (Math.abs(alpha) > 1e-3) {
    return { ok: false, error: `α = ${alpha} /K is above 10⁻³ /K, far beyond any solid (most lie between 10⁻⁷ and 3×10⁻⁴ /K); check its unit.` };
  }
  if (!fin(dT)) return { ok: false, error: "The temperature change ΔT must be a finite number." };
  if (mode !== "uniaxial") {
    const e = poissonError(nu, mode === "biaxial" ? "Biaxial restraint" : "Triaxial restraint");
    if (e) return { ok: false, error: e };
  }
  if (restraint.kind === "fraction") {
    if (!fin(restraint.r) || restraint.r < 0 || restraint.r > 1) {
      return { ok: false, error: "The restraint fraction r must lie between 0 (free) and 1 (fully restrained)." };
    }
  }
  if (restraint.kind === "gap") {
    if (mode !== "uniaxial") {
      return { ok: false, error: "A gap restraint is a bar growing into a stop: it is defined for the bar (uniaxial) only, not for a plate or a body." };
    }
    if (!fin(restraint.gap) || restraint.gap < 0) return { ok: false, error: "The gap must be zero or a positive length." };
    if (!fin(restraint.length) || restraint.length <= 0) return { ok: false, error: "The bar length L must be a positive length." };
  }
  return null;
}

/** σ at one ΔT for an input already checked. */
export function restrainedSigmaAt(inp: RestrainedInput, dT: number): number {
  const { E, alpha, nu, mode, restraint } = inp;
  const k = mode === "uniaxial" ? 1 : mode === "biaxial" ? 1 / (1 - nu) : 1 / (1 - 2 * nu);
  const eps = alpha * dT;
  if (restraint.kind === "gap") {
    // The stop is on one side only: the bar grows freely until αΔT·L closes the gap, then pushes on a rigid stop.
    // Contraction (αΔT < 0) pulls the bar away from the stop: no stress.
    const room = restraint.gap / restraint.length;
    return z(eps > room ? -E * (eps - room) : 0);
  }
  const r = restraint.kind === "fraction" ? restraint.r : 1;
  return z(-r * E * eps * k);
}

export function restrainedStress(inp: RestrainedInput): RestrainedResult | Fail {
  const bad = checkRestrained(inp);
  if (bad) return bad;
  const sigma = restrainedSigmaAt(inp, inp.dT);
  const { nu, mode, restraint, alpha } = inp;
  const modeFactor = mode === "uniaxial" ? 1 : mode === "biaxial" ? 1 / (1 - nu) : 1 / (1 - 2 * nu);
  const dTClose = restraint.kind === "gap" && alpha !== 0 ? restraint.gap / restraint.length / alpha : null;
  const state =
    mode === "uniaxial"
      ? { sx: sigma, sy: 0, sz: 0 }
      : mode === "biaxial"
        ? { sx: sigma, sy: sigma, sz: 0 }
        : { sx: sigma, sy: sigma, sz: sigma };
  return { ok: true, sigma, freeStrain: z(alpha * inp.dT), modeFactor, dTClose, state };
}

// ------------------------------------------------------------------ Timoshenko bilayer

export interface BilayerInput {
  /** Layer 1 thickness and modulus (the layer whose α is the larger when Δα > 0). */
  t1: number;
  E1: number;
  t2: number;
  E2: number;
  /** Δα = α₁ − α₂ (1/K). */
  dAlpha: number;
  dT: number;
  /** Cantilever length for the tip deflection (m), or null. */
  length: number | null;
}

export interface BilayerResult {
  ok: true;
  m: number;
  n: number;
  h: number;
  /** Curvature (1/m), signed: positive = layer 1 on the convex (outer) side. */
  kappa: number;
  /** Curvature per kelvin (1/(m·K)), for the κ–ΔT line. */
  kappaPerK: number;
  /** Axial force per unit width (N/m): compression in layer 1 when positive. */
  P: number;
  /** Layer stresses (Pa) at the outer face of layer 1, its interface face, layer 2's interface face, layer 2's outer face. */
  s1Outer: number;
  s1Interface: number;
  s2Interface: number;
  s2Outer: number;
  /** Tip deflection of a cantilever of the given length (m), small-deflection κL²/2, or null. */
  tip: number | null;
  /** κL (rad) when a length is given. */
  kappaL: number | null;
}

/** The largest κL (rad) the small-deflection tip formula is used for. */
export const BILAYER_MAX_KAPPA_L = 0.2;

function timoKappaPerUnit(t1: number, t2: number, E1: number, E2: number): number {
  const m = t1 / t2, n = E1 / E2, h = t1 + t2;
  return (6 * (1 + m) ** 2) / (h * (3 * (1 + m) ** 2 + (1 + m * n) * (m * m + 1 / (m * n))));
}

export function timoshenkoBilayer(inp: BilayerInput): BilayerResult | Fail {
  const { t1, t2, E1, E2, dAlpha, dT, length } = inp;
  if (!fin(t1, t2) || t1 <= 0 || t2 <= 0) return { ok: false, error: "Both layer thicknesses must be positive." };
  if (!fin(E1, E2) || E1 <= 0 || E2 <= 0) return { ok: false, error: "Both layer moduli must be positive." };
  if (t1 / t2 > 1e6 || t2 / t1 > 1e6) return { ok: false, error: "The layer thicknesses differ by more than 10⁶×: use the Stoney thin-film relation for a film on a thick substrate." };
  if (E1 / E2 > 1e6 || E2 / E1 > 1e6) return { ok: false, error: "The layer moduli differ by more than 10⁶×; the bilayer beam model is not meaningful there." };
  if (!fin(dAlpha)) return { ok: false, error: "Δα must be a finite number." };
  if (Math.abs(dAlpha) > 1e-3) return { ok: false, error: `Δα = ${dAlpha} /K is above 10⁻³ /K, beyond any pair of solids; check its unit.` };
  if (!fin(dT)) return { ok: false, error: "ΔT must be a finite number." };
  if (length !== null && (!fin(length) || length <= 0)) return { ok: false, error: "The cantilever length L must be a positive length." };
  const m = t1 / t2, n = E1 / E2, h = t1 + t2;
  const kappaPerK = dAlpha * timoKappaPerUnit(t1, t2, E1, E2);
  const kappa = z(kappaPerK * dT);
  const P = z((kappa * (E1 * t1 ** 3 + E2 * t2 ** 3)) / (6 * h));
  let tip: number | null = null, kappaL: number | null = null;
  if (length !== null) {
    kappaL = Math.abs(kappa) * length;
    if (kappaL > BILAYER_MAX_KAPPA_L) {
      return {
        ok: false,
        error:
          `Large deflection: κL = ${Number(kappaL.toPrecision(3))} rad exceeds ${BILAYER_MAX_KAPPA_L} rad, where the ` +
          "small-deflection tip formula δ = κL²/2 is no longer accurate. Shorten L, or clear the length field for the curvature alone.",
      };
    }
    tip = z((kappa * length * length) / 2);
  }
  return {
    ok: true, m, n, h, kappa, kappaPerK, P,
    s1Outer: z(-P / t1 + (E1 * kappa * t1) / 2),
    s1Interface: z(-P / t1 - (E1 * kappa * t1) / 2),
    s2Interface: z(P / t2 + (E2 * kappa * t2) / 2),
    s2Outer: z(P / t2 - (E2 * kappa * t2) / 2),
    tip, kappaL,
  };
}

// ------------------------------------------------------------------ Stoney

export interface StoneyInput {
  Es: number;
  nus: number;
  hs: number;
  hf: number;
}

/** The largest film/substrate thickness ratio Stoney's relation is used for. */
export const STONEY_MAX_RATIO = 0.1;

function checkStoney(s: StoneyInput): Fail | null {
  if (!fin(s.Es) || s.Es <= 0) return { ok: false, error: "The substrate modulus Eₛ must be positive." };
  const e = poissonError(s.nus, "Stoney");
  if (e) return { ok: false, error: e };
  if (!fin(s.hs, s.hf) || s.hs <= 0 || s.hf <= 0) return { ok: false, error: "Both the substrate and the film thickness must be positive." };
  if (s.hf / s.hs > STONEY_MAX_RATIO) {
    return {
      ok: false,
      error:
        `Film not thin: the film/substrate thickness ratio ${Number((s.hf / s.hs).toPrecision(3))} exceeds ${STONEY_MAX_RATIO}, outside Stoney's ` +
        "thin-film validity (the film's own stiffness is neglected). Use the bilayer (Timoshenko) calculator for comparable thicknesses.",
    };
  }
  return null;
}

/** The biaxial-modulus factor E_s h_s² / (6(1−ν_s) h_f): σ_f = factor · κ. */
const stoneyFactor = (s: StoneyInput): number => (s.Es * s.hs * s.hs) / (6 * (1 - s.nus) * s.hf);

export function stoneyFilmStress(s: StoneyInput, kappa: number): { ok: true; sigma: number; factor: number } | Fail {
  const bad = checkStoney(s);
  if (bad) return bad;
  if (!fin(kappa)) return { ok: false, error: "The curvature κ must be a finite number." };
  const factor = stoneyFactor(s);
  return { ok: true, sigma: z(factor * kappa), factor };
}

export function stoneyCurvature(s: StoneyInput, sigma: number): { ok: true; kappa: number; factor: number } | Fail {
  const bad = checkStoney(s);
  if (bad) return bad;
  if (!fin(sigma)) return { ok: false, error: "The film stress must be a finite number." };
  const factor = stoneyFactor(s);
  return { ok: true, kappa: z(sigma / factor), factor };
}

// ------------------------------------------------------------------ thermal shock

export interface ShockInput {
  sf: number;
  nu: number;
  E: number;
  alpha: number;
  /** Thermal conductivity (W/(m·K)), or null. */
  k: number | null;
}

export function thermalShock(s: ShockInput): { ok: true; R: number; Rp: number | null } | Fail {
  if (!fin(s.sf) || s.sf <= 0) return { ok: false, error: "The fracture strength must be positive." };
  const e = poissonError(s.nu, "Thermal shock");
  if (e) return { ok: false, error: e };
  if (!fin(s.E) || s.E <= 0) return { ok: false, error: "Young's modulus E must be positive." };
  if (!fin(s.alpha) || s.alpha <= 0) {
    return { ok: false, error: "The expansion coefficient α must be positive: R = (strength)(1 − ν)/(Eα) has no meaning for α ≤ 0 (no thermal stress to resist)." };
  }
  if (s.alpha > 1e-3) return { ok: false, error: `α = ${s.alpha} /K is above 10⁻³ /K, far beyond any solid; check its unit.` };
  if (s.k !== null && (!fin(s.k) || s.k <= 0)) return { ok: false, error: "The thermal conductivity k must be positive." };
  const R = (s.sf * (1 - s.nu)) / (s.E * s.alpha);
  return { ok: true, R, Rp: s.k === null ? null : s.k * R };
}
