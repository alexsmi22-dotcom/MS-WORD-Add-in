// Hertz contact: two smooth, frictionless, linear-elastic bodies touching at a point (spheres) or along a line
// (parallel cylinders), with the contact patch small against both radii (K. L. Johnson, Contact Mechanics, 1985,
// ch. 4). SI throughout (N, m, Pa); pure.
//
//   1/E* = (1 − ν₁²)/E₁ + (1 − ν₂²)/E₂,   1/R = 1/R₁ + 1/R₂ (a flat is R = ∞).
//   Spheres:   a = (3FR/(4E*))^(1/3),  p₀ = 3F/(2πa²),  δ = a²/R (mutual approach),  p(r) = p₀√(1 − r²/a²).
//   Cylinders: b = √(4F′R/(πE*)) with F′ = F/L,  p₀ = 2F′/(πb),  p(x) = p₀√(1 − x²/b²).
//
// THE SUBSURFACE SHEAR is computed for the body's own ν rather than quoted as "0.31 p₀ at 0.48 a". On the axis of
// symmetry (Johnson, Contact Mechanics, ch. 3 for the sphere and ch. 4 for the cylinder in plane strain):
//   sphere:   σr = σθ = p₀[−(1 + ν)(1 − ζ·atan(1/ζ)) + ½/(1 + ζ²)],  σz = −p₀/(1 + ζ²),  ζ = z/a
//   cylinder: σx = −p₀[(1 + 2ζ²)/√(1 + ζ²) − 2ζ],  σz = −p₀/√(1 + ζ²),  σy = ν(σx + σz),  ζ = z/b
// and the maximum shear is half the spread of the three principal stresses, maximised over depth by a bounded
// golden-section search (with the surface itself as a candidate: for a cylinder with small ν the surface governs).
// At ν = 0.3 this reproduces the textbook 0.310 p₀ at 0.481 a (sphere) and 0.300 p₀ at 0.786 b (cylinder).
//
// The approach of two cylinders is NOT computed: it depends on the bodies' overall dimensions (it is logarithmic in
// them), which the Hertz line-contact solution does not fix.

import { fmtSig } from "./axis";

export interface ContactError {
  ok: false;
  error: string;
}

export interface ContactBody {
  E: number;
  nu: number;
}

const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

/** The effective modulus E* (Pa). */
export function effectiveModulus(b1: ContactBody, b2: ContactBody): number {
  return 1 / ((1 - b1.nu * b1.nu) / b1.E + (1 - b2.nu * b2.nu) / b2.E);
}

function bodiesError(b1: ContactBody, b2: ContactBody): string | null {
  if (!fin(b1.E, b1.nu, b2.E, b2.nu)) return "Moduli and Poisson's ratios must be finite numbers.";
  if (b1.E <= 0 || b2.E <= 0) return "Young's modulus must be greater than zero for both bodies.";
  for (const nu of [b1.nu, b2.nu]) if (!(nu > -1 && nu <= 0.5)) return "Poisson's ratio must lie between −1 and 0.5.";
  return null;
}

/** Effective radius; r2 === null is a flat (R₂ = ∞). Concave (conforming) contact is not offered. */
function effectiveRadius(r1: number, r2: number | null): number | string {
  if (!fin(r1) || (r2 !== null && !fin(r2))) return "The radii must be finite numbers.";
  if (r1 <= 0 || (r2 !== null && r2 <= 0)) {
    return "Radii must be positive: both bodies convex (choose a flat for the second body). Concave, conforming contact (a ball in a groove) is not computed here.";
  }
  return r2 === null ? r1 : 1 / (1 / r1 + 1 / r2);
}

export interface SubsurfaceShear {
  /** Maximum shear stress over depth on the axis, as a fraction of p₀. */
  tauOverP0: number;
  /** Depth of that maximum, as a fraction of a (sphere) or b (cylinder). 0 = at the surface. */
  depthOverA: number;
}

/** The principal-shear profile on the axis, τ(ζ)/p₀. */
export function axisShear(kind: "sphere" | "cylinder", nu: number, zeta: number): number {
  if (kind === "sphere") {
    // ζ·atan(1/ζ) → 0 as ζ → 0; at ζ = 0 the surface values σr = −(1 + 2ν)/2, σz = −1.
    const za = zeta === 0 ? 0 : zeta * Math.atan(1 / zeta);
    const sr = -(1 + nu) * (1 - za) + 0.5 / (1 + zeta * zeta);
    const sz = -1 / (1 + zeta * zeta);
    return 0.5 * Math.abs(sz - sr);
  }
  const q = Math.sqrt(1 + zeta * zeta);
  const sx = -((1 + 2 * zeta * zeta) / q - 2 * zeta);
  const sz = -1 / q;
  const sy = nu * (sx + sz);
  return 0.5 * (Math.max(sx, sy, sz) - Math.min(sx, sy, sz));
}

/** Iterations of the golden-section search: a fixed bound (the bracket shrinks by 0.618 each step). */
const GOLDEN_STEPS = 80;
const SCAN = 60;

/**
 * Maximum of axisShear over depth 0 ≤ ζ ≤ 3: a coarse scan (60 points) picks the bracket, then a fixed-step
 * golden-section search refines it. Both are hard-capped; the profile is smooth and unimodal away from the surface.
 */
export function maxSubsurfaceShear(kind: "sphere" | "cylinder", nu: number): SubsurfaceShear {
  const zMax = 3;
  let best = 0;
  let bestV = axisShear(kind, nu, 0);
  for (let i = 1; i <= SCAN; i++) {
    const z = (zMax * i) / SCAN;
    const v = axisShear(kind, nu, z);
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  if (best === 0) return { tauOverP0: bestV, depthOverA: 0 };
  let lo = (zMax * Math.max(0, best - 1)) / SCAN;
  let hi = (zMax * Math.min(SCAN, best + 1)) / SCAN;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = axisShear(kind, nu, x1);
  let f2 = axisShear(kind, nu, x2);
  for (let k = 0; k < GOLDEN_STEPS; k++) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + g * (hi - lo);
      f2 = axisShear(kind, nu, x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - g * (hi - lo);
      f1 = axisShear(kind, nu, x1);
    }
  }
  const z = (lo + hi) / 2;
  const v = axisShear(kind, nu, z);
  return v >= bestV ? { tauOverP0: v, depthOverA: z } : { tauOverP0: bestV, depthOverA: (zMax * best) / SCAN };
}

export interface SphereContact {
  ok: true;
  Estar: number;
  R: number;
  /** Contact radius a (m). */
  a: number;
  /** Peak pressure p₀ and mean pressure (Pa). */
  p0: number;
  pMean: number;
  /** Mutual approach δ (m). */
  delta: number;
  /** Subsurface maximum shear in each body (its own ν). */
  shear1: SubsurfaceShear;
  shear2: SubsurfaceShear;
}

/** Sphere on sphere (r2 = null: sphere on a flat), normal load F (N). */
export function hertzSphere(F: number, r1: number, r2: number | null, b1: ContactBody, b2: ContactBody): SphereContact | ContactError {
  const be = bodiesError(b1, b2);
  if (be) return { ok: false, error: be };
  const R = effectiveRadius(r1, r2);
  if (typeof R === "string") return { ok: false, error: R };
  if (!fin(F) || F <= 0) return { ok: false, error: "The normal load must be greater than zero (Hertz contact is compressive)." };
  const Estar = effectiveModulus(b1, b2);
  const a = Math.cbrt((3 * F * R) / (4 * Estar));
  const p0 = (3 * F) / (2 * Math.PI * a * a);
  const delta = (a * a) / R;
  if (!fin(Estar, a, p0, delta) || a <= 0) return { ok: false, error: "These values overflow double precision; check the units." };
  if (a > 0.1 * R) {
    return {
      ok: false,
      error: `The contact radius comes out at ${pctOf(a / R)} of the effective radius: Hertz theory needs a small patch (a ≪ R), so this load is outside it.`,
    };
  }
  return { ok: true, Estar, R, a, p0, pMean: (2 / 3) * p0, delta, shear1: maxSubsurfaceShear("sphere", b1.nu), shear2: maxSubsurfaceShear("sphere", b2.nu) };
}

export interface CylinderContact {
  ok: true;
  Estar: number;
  R: number;
  /** Load per unit length F′ (N/m). */
  Fl: number;
  /** Half-width b (m). */
  b: number;
  p0: number;
  pMean: number;
  shear1: SubsurfaceShear;
  shear2: SubsurfaceShear;
}

/** Parallel cylinders (r2 = null: a cylinder on a flat), load F (N) along a contact length L (m). */
export function hertzCylinder(F: number, L: number, r1: number, r2: number | null, b1: ContactBody, b2: ContactBody): CylinderContact | ContactError {
  const be = bodiesError(b1, b2);
  if (be) return { ok: false, error: be };
  const R = effectiveRadius(r1, r2);
  if (typeof R === "string") return { ok: false, error: R };
  if (!fin(F) || F <= 0) return { ok: false, error: "The normal load must be greater than zero (Hertz contact is compressive)." };
  if (!fin(L) || L <= 0) return { ok: false, error: "The contact length must be greater than zero." };
  const Estar = effectiveModulus(b1, b2);
  const Fl = F / L;
  const b = Math.sqrt((4 * Fl * R) / (Math.PI * Estar));
  const p0 = (2 * Fl) / (Math.PI * b);
  if (!fin(Estar, Fl, b, p0) || b <= 0) return { ok: false, error: "These values overflow double precision; check the units." };
  if (b > 0.1 * R) {
    return {
      ok: false,
      error: `The half-width comes out at ${pctOf(b / R)} of the effective radius: Hertz theory needs a narrow strip (b ≪ R), so this load is outside it.`,
    };
  }
  return { ok: true, Estar, R, Fl, b, p0, pMean: (Math.PI / 4) * p0, shear1: maxSubsurfaceShear("cylinder", b1.nu), shear2: maxSubsurfaceShear("cylinder", b2.nu) };
}

function pctOf(frac: number): string {
  const v = frac * 100;
  const a = Math.abs(v);
  // Plain digits in 10⁻³…10⁶, ×10ⁿ outside (a refusal printed "4.02e+99 %").
  return `${a === 0 || (a >= 1e-3 && a < 1e6) ? String(Number(v.toPrecision(3))) : fmtSig(v, 3).replace(/(\.\d*?)0+(?=×)/, "$1").replace(/\.(?=×)/, "")} %`;
}
