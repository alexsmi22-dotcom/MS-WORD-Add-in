// VFX & compositing, physics for FX TDs: Froude scaling of miniatures (frame rate, time, velocity, fall), the
// Reynolds and Weber numbers a miniature cannot match, a fluid simulation's CFL timestep and substeps, and rigid-body
// impact with restitution and Coulomb friction, with drop time and impact speed under gravity in the scene's units.
// Pure functions; the pane glue is vfxCalcs.ts.
//
// Navier–Stokes itself is a solver, not a calculator: nothing here simulates a fluid. What a calculator can say
// honestly is how a sim's timestep must be chosen (CFL) and which dimensionless numbers a scaled set-up keeps.

export interface Err {
  ok: false;
  error: string;
}

/** Standard gravity, m/s² (CGPM 1901, exact). */
export const G0 = 9.80665;

export const SCENE_UNITS: Record<string, { label: string; noun: string; m: number }> = {
  m: { label: "metres", noun: "metre", m: 1 },
  cm: { label: "centimetres", noun: "centimetre", m: 0.01 },
  mm: { label: "millimetres", noun: "millimetre", m: 0.001 },
  dm: { label: "decimetres", noun: "decimetre", m: 0.1 },
  ft: { label: "feet", noun: "foot", m: 0.3048 },
  in: { label: "inches", noun: "inch", m: 0.0254 },
};

export interface ScaleInput {
  /** Miniature scale: model = real / n. */
  n: number;
  fps: number;
  /** Real fall height (m) or null. */
  fall: number | null;
  /** Real characteristic velocity (m/s) and length (m). */
  U: number;
  L: number;
  /** Kinematic viscosity (m²/s), density (kg/m³), surface tension (N/m) or null. */
  nu: number;
  rho: number;
  sigma: number | null;
}

export interface ScaleResult {
  ok: true;
  sqrtN: number;
  shootFps: number;
  /** Fall: real height and time, model height and time. */
  fall: { h: number; t: number; hm: number; tm: number; vReal: number; vModel: number } | null;
  Um: number;
  Lm: number;
  Re: number;
  ReM: number;
  Fr: number;
  We: number | null;
  WeM: number | null;
  /** The viscosity the model fluid would need for Re to match too: ν/n^1.5. */
  nuNeeded: number;
}

export function froudeScale(inp: ScaleInput): ScaleResult | Err {
  const { n, fps, U, L, nu, rho } = inp;
  if (![n, fps, U, L, nu, rho].every(Number.isFinite)) return { ok: false, error: "Every value must be a finite number." };
  if (!(n >= 1)) return { ok: false, error: `Scale: 1:${n} is not a miniature (the model is smaller than the real thing, 1:n with n ≥ 1).` };
  if (n > 1000) return { ok: false, error: `Scale: 1:${n} is beyond 1:1000; Froude scaling is not meaningful for that small a model.` };
  if (!(fps > 0)) return { ok: false, error: "Frame rate: must be greater than zero." };
  if (!(U > 0) || !(L > 0)) return { ok: false, error: "Velocity and length: both must be greater than zero." };
  if (!(nu > 0) || !(rho > 0)) return { ok: false, error: "Viscosity and density: both must be greater than zero." };
  const sqrtN = Math.sqrt(n);
  let fall: ScaleResult["fall"] = null;
  if (inp.fall !== null) {
    if (!(inp.fall > 0) || !Number.isFinite(inp.fall)) return { ok: false, error: "Fall height: must be greater than zero." };
    const t = Math.sqrt((2 * inp.fall) / G0);
    fall = { h: inp.fall, t, hm: inp.fall / n, tm: t / sqrtN, vReal: Math.sqrt(2 * G0 * inp.fall), vModel: Math.sqrt((2 * G0 * inp.fall) / n) };
  }
  const Um = U / sqrtN;
  const Lm = L / n;
  const Re = (U * L) / nu;
  let We: number | null = null;
  let WeM: number | null = null;
  if (inp.sigma !== null) {
    if (!(inp.sigma > 0)) return { ok: false, error: "Surface tension: must be greater than zero." };
    We = (rho * U * U * L) / inp.sigma;
    WeM = (rho * Um * Um * Lm) / inp.sigma;
  }
  return { ok: true, sqrtN, shootFps: fps * sqrtN, fall, Um, Lm, Re, ReM: (Um * Lm) / nu, Fr: U / Math.sqrt(G0 * L), We, WeM, nuNeeded: nu / Math.pow(n, 1.5) };
}

export interface CflResult {
  ok: true;
  dtMax: number;
  frameTime: number;
  substeps: number;
  dt: number;
  /** Cells the fastest fluid crosses per frame. */
  cellsPerFrame: number;
}

/** CFL: Δt ≤ C·Δx/u_max; substeps per frame = ⌈(1/fps)/Δt_max⌉. */
export function cfl(dx: number, umax: number, fps: number, C: number): CflResult | Err {
  if (![dx, umax, fps, C].every(Number.isFinite)) return { ok: false, error: "Every value must be a finite number." };
  if (!(dx > 0)) return { ok: false, error: "Voxel size: must be greater than zero." };
  if (!(umax > 0)) return { ok: false, error: "Maximum velocity: must be greater than zero (a still fluid has no CFL limit)." };
  if (!(fps > 0)) return { ok: false, error: "Frame rate: must be greater than zero." };
  if (!(C > 0 && C <= 10)) return { ok: false, error: `CFL number: ${C} is outside (0, 10].` };
  const dtMax = (C * dx) / umax;
  const frameTime = 1 / fps;
  const substeps = Math.max(1, Math.ceil(frameTime / dtMax - 1e-12));
  if (substeps > 1e6) return { ok: false, error: `That needs ${substeps.toExponential(2)} substeps per frame: check the voxel size and velocity units.` };
  return { ok: true, dtMax, frameTime, substeps, dt: frameTime / substeps, cellsPerFrame: umax / (dx * fps) };
}

// ---------------------------------------------------------------------------------------------------------------
// Rigid-body impact and drop
// ---------------------------------------------------------------------------------------------------------------

export interface DropResult {
  ok: true;
  g: number;
  t: number;
  v: number;
  bounce: number;
  /** Total time until the bounces die away (geometric series), null for e = 1. */
  tRest: number | null;
}

export function drop(h: number, unitM: number, e: number): DropResult | Err {
  if (!Number.isFinite(h) || !(h > 0)) return { ok: false, error: "Drop height: must be greater than zero." };
  if (!(e >= 0 && e <= 1)) return { ok: false, error: `Restitution: e = ${e} is outside 0 (perfectly plastic) to 1 (perfectly elastic).` };
  const g = G0 / unitM;
  const t = Math.sqrt((2 * h) / g);
  return { ok: true, g, t, v: g * t, bounce: e * e * h, tRest: e < 1 ? (t * (1 + e)) / (1 - e) : null };
}

export interface ImpactInput {
  m1: number;
  /** null = immovable (the ground, a static collider). */
  m2: number | null;
  /** Normal velocities along the line of impact, positive from body 1 toward body 2. */
  u1: number;
  u2: number;
  /** Body 1's tangential speed (along the contact surface); body 2 has none. */
  vt: number;
  e: number;
  mu: number;
}

export interface ImpactResult {
  ok: true;
  mEff: number;
  approach: number;
  Jn: number;
  Jt: number;
  sticks: boolean;
  v1n: number;
  v2n: number;
  v1t: number;
  v2t: number;
  keBefore: number;
  keAfter: number;
  lost: number;
  lostNormal: number;
  lostFriction: number;
}

export function impact(inp: ImpactInput): ImpactResult | Err {
  const { m1, m2, u1, u2, vt, e, mu } = inp;
  if (![m1, u1, u2, vt, e, mu].every(Number.isFinite) || (m2 !== null && !Number.isFinite(m2))) return { ok: false, error: "Every value must be a finite number." };
  if (!(m1 > 0) || (m2 !== null && !(m2 > 0))) return { ok: false, error: "Masses: must be greater than zero (leave body 2 blank for the immovable ground)." };
  if (!(e >= 0 && e <= 1)) return { ok: false, error: `Restitution: e = ${e} is outside 0 (perfectly plastic) to 1 (perfectly elastic).` };
  if (!(mu >= 0)) return { ok: false, error: "Friction: μ cannot be negative." };
  if (m2 === null && u2 !== 0) return { ok: false, error: "The ground does not move: body 2's velocity must be 0 when it is immovable." };
  const approach = u1 - u2;
  if (!(approach > 0)) return { ok: false, error: `The bodies are separating (closing speed ${approach}): body 1 must move toward body 2 faster than body 2 moves away for them to collide.` };
  const mEff = m2 === null ? m1 : (m1 * m2) / (m1 + m2);
  const Jn = (1 + e) * mEff * approach;
  const stick = mEff * Math.abs(vt);
  const Jt = Math.min(mu * Jn, stick);
  const sgn = vt >= 0 ? 1 : -1;
  const v1n = u1 - Jn / m1;
  const v2n = m2 === null ? 0 : u2 + Jn / m2;
  const v1t = vt - (sgn * Jt) / m1;
  const v2t = m2 === null ? 0 : (sgn * Jt) / m2;
  const ke = (m: number, a: number, b: number): number => 0.5 * m * (a * a + b * b);
  const keBefore = ke(m1, u1, vt) + (m2 === null ? 0 : ke(m2, u2, 0));
  const keAfter = ke(m1, v1n, v1t) + (m2 === null ? 0 : ke(m2, v2n, v2t));
  const lostNormal = 0.5 * mEff * approach * approach * (1 - e * e);
  return { ok: true, mEff, approach, Jn, Jt, sticks: mu * Jn >= stick, v1n, v2n, v1t, v2t, keBefore, keAfter, lost: keBefore - keAfter, lostNormal, lostFriction: keBefore - keAfter - lostNormal };
}
