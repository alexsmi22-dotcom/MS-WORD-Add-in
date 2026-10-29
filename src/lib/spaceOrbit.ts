// Two-body orbit core for the Spaceflight & missions calculators: classical elements and state vectors both ways,
// Kepler's equation for every conic (elliptic, parabolic exactly, hyperbolic), propagation by the universal variable,
// and Lambert's problem by the universal variable (Bate, Mueller & White §5.3; Curtis, Orbital Mechanics for
// Engineering Students, Algorithms 3.3, 4.2, 4.5 and 5.2; Vallado, Fundamentals of Astrodynamics, Algorithms 2, 4,
// 8, 9 and 58). SI units throughout (m, m/s, s, rad); the glue converts.
//
// EVERY ITERATION IS BOUNDED. Each root-finder brackets its root first and then runs a Newton step guarded by bisection,
// so a step that leaves the bracket is replaced by halving it; a root that cannot be bracketed, or a bracket that does
// not close inside the iteration cap, is a refusal that says which equation failed and for which input. Nothing here
// returns a number from an iteration that did not converge.
//
// CONVENTIONS FOR THE UNDEFINED ANGLES (Vallado §2.5): a circular orbit has no periapsis, so ω is reported as 0 and the
// position is the argument of latitude u = ω + ν (inclined) or the true longitude ℓ = Ω + ω + ν (equatorial); an
// equatorial orbit has no node, so Ω is 0 and the periapsis direction is the longitude of periapsis ϖ = Ω + ω, measured
// from the x axis. "Circular" means e below 1×10⁻⁹ and "equatorial" an inclination within 1×10⁻⁹ rad of 0 or π.

export type V3 = [number, number, number];

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): number => Math.sqrt(dot(a, a));
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export interface OrbitFail {
  ok: false;
  error: string;
}

const TWO_PI = 2 * Math.PI;
const wrap2pi = (x: number): number => {
  const y = x % TWO_PI;
  return y < 0 ? y + TWO_PI : y;
};
const clamp1 = (x: number): number => Math.max(-1, Math.min(1, x));

/** e below this is circular (ω undefined). */
export const CIRCULAR_E = 1e-9;
/** An inclination within this of 0 or π (rad) is equatorial (Ω undefined). */
export const EQUATORIAL_I = 1e-9;
/** e within this of 1 is treated as the parabola (the conic family switches formula there). */
export const PARABOLIC_BAND = 1e-9;

// ---------------------------------------------------------------------------------------------------------------
// Stumpff functions
// ---------------------------------------------------------------------------------------------------------------

/** C(z) = (1 − cos √z)/z, its hyperbolic form for z < 0, and the series near 0 (where both forms cancel). */
export function stumpffC(z: number): number {
  if (z > 1e-3) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-3) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720 - (z * z * z) / 40320;
}
/** S(z) = (√z − sin √z)/√z³, its hyperbolic form, and the series near 0. */
export function stumpffS(z: number): number {
  if (z > 1e-3) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-3) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040 - (z * z * z) / 362880;
}

// ---------------------------------------------------------------------------------------------------------------
// A bounded scalar root-finder: Newton guarded by a bracket
// ---------------------------------------------------------------------------------------------------------------

/**
 * Finds x in [lo, hi] with f(x) = 0, f increasing or decreasing with a sign change across the bracket. Newton when the
 * step stays inside the bracket and shrinks it, bisection otherwise; at most `cap` steps. Null when the bracket has no
 * sign change or does not close.
 */
export function guardedRoot(f: (x: number) => number, df: ((x: number) => number) | null, lo: number, hi: number, x0: number, tol = 1e-14, cap = 200): { x: number; iterations: number } | null {
  let flo = f(lo);
  const fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo === 0) return { x: lo, iterations: 0 };
  if (fhi === 0) return { x: hi, iterations: 0 };
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  let x = x0 > lo && x0 < hi ? x0 : (lo + hi) / 2;
  for (let k = 1; k <= cap; k++) {
    const fx = f(x);
    if (!Number.isFinite(fx)) return null;
    if (fx === 0) return { x, iterations: k };
    if (Math.sign(fx) === Math.sign(flo)) {
      lo = x;
      flo = fx;
    } else hi = x;
    if (hi - lo <= tol * Math.max(1, Math.abs(x))) return { x: (lo + hi) / 2, iterations: k };
    let next = (lo + hi) / 2;
    if (df) {
      const d = df(x);
      const n = x - fx / d;
      if (Number.isFinite(n) && n > lo && n < hi) next = n;
    }
    // A Newton step that barely moves is converged: |Δx| at the tolerance.
    if (Math.abs(next - x) <= tol * Math.max(1, Math.abs(x)) && next !== (lo + hi) / 2) return { x: next, iterations: k };
    x = next;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Kepler's equation, every conic
// ---------------------------------------------------------------------------------------------------------------

/** Elliptic: M = E − e sin E, 0 ≤ e < 1. E in the same 2π branch as M. */
export function keplerE(M: number, e: number): { E: number; iterations: number } | OrbitFail {
  if (!Number.isFinite(M) || !(e >= 0 && e < 1)) return { ok: false, error: "Kepler's equation (elliptic) needs a finite mean anomaly and 0 ≤ e < 1." };
  const turns = Math.floor(M / TWO_PI);
  const m = M - turns * TWO_PI; // [0, 2π)
  // E − e sin E − m is increasing on [0, 2π] and changes sign there; start from Danby's m + 0.85e sign(sin m).
  const x0 = m + 0.85 * e * Math.sign(Math.sin(m) || 1);
  const r = guardedRoot((E) => E - e * Math.sin(E) - m, (E) => 1 - e * Math.cos(E), 0, TWO_PI, x0);
  if (!r) return { ok: false, error: `Kepler's equation did not converge for M = ${M} rad, e = ${e}.` };
  return { E: r.x + turns * TWO_PI, iterations: r.iterations };
}

/** Hyperbolic: M = e sinh F − F, e > 1. */
export function keplerH(M: number, e: number): { F: number; iterations: number } | OrbitFail {
  if (!Number.isFinite(M) || !(e > 1)) return { ok: false, error: "Kepler's equation (hyperbolic) needs a finite mean anomaly and e > 1." };
  const s = Math.sign(M) || 1;
  const a = Math.abs(M);
  // e sinh F − F − a is increasing for F ≥ 0 (its derivative e cosh F − 1 > 0) and is −a at 0; asinh(a/(e−1)) + 1
  // over-reaches it, since e sinh F − F ≥ (e − 1) sinh F.
  const hi = Math.asinh(a / (e - 1)) + 1;
  const x0 = Math.log((2 * a) / e + 1.8);
  const r = guardedRoot((F) => e * Math.sinh(F) - F - a, (F) => e * Math.cosh(F) - 1, 0, hi, x0);
  if (!r) return { ok: false, error: `Kepler's equation (hyperbolic) did not converge for M = ${M}, e = ${e}.` };
  return { F: s * r.x, iterations: r.iterations };
}

/**
 * Parabolic (Barker's equation), solved exactly: Mp = D/2 + D³/6 with D = tan(ν/2), Mp = √(μ/p³)·(t − tp). The real
 * root of the depressed cubic D³ + 3D − 6Mp = 0 by Cardano: there is exactly one, so no iteration is needed.
 */
export function barker(Mp: number): number {
  const q = 3 * Mp;
  const w = Math.cbrt(q + Math.sqrt(q * q + 1));
  return w - 1 / w;
}

/** True anomaly from the eccentric (or hyperbolic) anomaly. */
export function nuFromE(E: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}
export function nuFromF(F: number, e: number): number {
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2));
}

/**
 * Time since periapsis at true anomaly ν (signed: negative before periapsis), for any conic given p and e. Elliptic
 * values are in (−T/2, T/2].
 */
export function timeSincePeriapsis(mu: number, p: number, e: number, nu: number): number {
  if (Math.abs(e - 1) < PARABOLIC_BAND) {
    const D = Math.tan(nu / 2);
    return 0.5 * Math.sqrt((p * p * p) / mu) * (D + (D * D * D) / 3);
  }
  if (e < 1) {
    const a = p / (1 - e * e);
    const n = Math.sqrt(mu / (a * a * a));
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    return (E - e * Math.sin(E)) / n;
  }
  const a = p / (e * e - 1); // |a|
  const n = Math.sqrt(mu / (a * a * a));
  const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
  return (e * Math.sinh(F) - F) / n;
}

// ---------------------------------------------------------------------------------------------------------------
// Elements <-> state
// ---------------------------------------------------------------------------------------------------------------

export interface Elements {
  /** Semi-latus rectum p = h²/μ, m (defined for every conic, unlike a). */
  p: number;
  e: number;
  /** Inclination, rad [0, π]. */
  i: number;
  /** Right ascension of the ascending node Ω, rad [0, 2π). */
  raan: number;
  /** Argument of periapsis ω, rad [0, 2π). */
  argp: number;
  /** True anomaly ν, rad. */
  nu: number;
}

export interface ElementsFull extends Elements {
  /** Semi-major axis, m: negative for a hyperbola, null for a parabola. */
  a: number | null;
  h: number;
  energy: number;
  rp: number;
  /** Apoapsis radius, m (null unless elliptic). */
  ra: number | null;
  /** Period, s (null unless elliptic). */
  period: number | null;
  circular: boolean;
  equatorial: boolean;
  /** Argument of latitude u = ω + ν (the position angle of an inclined circular orbit). */
  u: number;
  /** Longitude of periapsis ϖ = Ω + ω (for an equatorial orbit; retrograde: Ω − ω). */
  lonPeri: number;
  /** True longitude ℓ = Ω + ω + ν (the position angle of a circular equatorial orbit). */
  trueLon: number;
  /** Time since periapsis, s (signed). */
  tSincePeri: number;
  conic: "circular" | "elliptic" | "parabolic" | "hyperbolic";
}

/** Rotation from the perifocal frame (P, Q, W) to the inertial frame: R3(−Ω) R1(−i) R3(−ω). */
export function perifocalToInertial(raan: number, i: number, argp: number): [V3, V3, V3] {
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(argp), sw = Math.sin(argp);
  const P: V3 = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Q: V3 = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
  const W: V3 = [sO * si, -cO * si, ci];
  return [P, Q, W];
}

/** State vectors from classical elements (Curtis Algorithm 4.5). */
export function elementsToState(mu: number, el: Elements): { r: V3; v: V3 } {
  const { p, e, nu } = el;
  const r = p / (1 + e * Math.cos(nu));
  const rPf: V3 = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const k = Math.sqrt(mu / p);
  const vPf: V3 = [-k * Math.sin(nu), k * (e + Math.cos(nu)), 0];
  const [P, Q] = perifocalToInertial(el.raan, el.i, el.argp);
  return {
    r: add(scale(P, rPf[0]), scale(Q, rPf[1])),
    v: add(scale(P, vPf[0]), scale(Q, vPf[1])),
  };
}

/** Classical elements from state vectors (Curtis Algorithm 4.2, Vallado Algorithm 9), with the conventions above. */
export function stateToElements(mu: number, r: V3, v: V3): ElementsFull | OrbitFail {
  const rn = norm(r);
  const vn = norm(v);
  if (!(rn > 0) || !Number.isFinite(rn) || !Number.isFinite(vn)) return { ok: false, error: "The position must be a nonzero finite vector." };
  const hv = cross(r, v);
  const h = norm(hv);
  if (!(h > 1e-12 * rn * Math.max(vn, 1e-30))) return { ok: false, error: "The velocity is parallel to the position (a radial, rectilinear trajectory): there is no orbital plane and no classical elements." };
  const vr = dot(r, v) / rn;
  const ev = scale(sub(scale(r, vn * vn - mu / rn), scale(v, rn * vr)), 1 / mu);
  const e = norm(ev);
  const i = Math.acos(clamp1(hv[2] / h));
  const nv: V3 = [-hv[1], hv[0], 0];
  const nn = norm(nv);
  const p = (h * h) / mu;
  const energy = (vn * vn) / 2 - mu / rn;
  const circular = e < CIRCULAR_E;
  const equatorial = i < EQUATORIAL_I || Math.PI - i < EQUATORIAL_I;
  const retro = i > Math.PI / 2;
  let raan = 0;
  if (!equatorial) raan = wrap2pi(Math.atan2(nv[1], nv[0]));
  let argp = 0;
  let nu: number;
  // ω from the node (or, equatorial, from the x axis), ν from periapsis (or, circular, from the node / x axis).
  const angleBetween = (a: V3, b: V3, signRef: number): number => {
    const ang = Math.acos(clamp1(dot(a, b) / (norm(a) * norm(b))));
    return signRef < 0 ? TWO_PI - ang : ang;
  };
  if (!circular) {
    if (!equatorial) argp = angleBetween(nv, ev, ev[2]);
    else {
      // Longitude of periapsis carried in ω (Ω = 0); measured in the direction of motion.
      const lp = wrap2pi(Math.atan2(ev[1], ev[0]));
      argp = retro ? wrap2pi(-lp) : lp;
    }
    nu = angleBetween(ev, r, vr);
  } else if (!equatorial) {
    nu = angleBetween(nv, r, r[2]); // argument of latitude
  } else {
    const tl = wrap2pi(Math.atan2(r[1], r[0]));
    nu = retro ? wrap2pi(-tl) : tl; // true longitude
  }
  const parab = Math.abs(e - 1) < PARABOLIC_BAND;
  const a = parab ? null : p / (1 - e * e);
  const conic = circular ? "circular" : parab ? "parabolic" : e < 1 ? "elliptic" : "hyperbolic";
  const rp = p / (1 + e);
  const ra = e < 1 && !parab ? p / (1 - e) : null;
  const period = a !== null && a > 0 ? TWO_PI * Math.sqrt((a * a * a) / mu) : null;
  const nuSigned = nu > Math.PI ? nu - TWO_PI : nu;
  return {
    p, e, i, raan, argp, nu, a, h, energy, rp, ra, period, circular, equatorial,
    u: wrap2pi(argp + nu),
    lonPeri: wrap2pi(retro ? raan - argp : raan + argp),
    trueLon: wrap2pi(retro ? raan - argp - nu : raan + argp + nu),
    tSincePeri: circular ? 0 : timeSincePeriapsis(mu, p, e, nuSigned),
    conic,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Propagation by the universal variable
// ---------------------------------------------------------------------------------------------------------------

export interface Propagated {
  ok: true;
  r: V3;
  v: V3;
  /** Universal anomaly χ, √m. */
  chi: number;
  iterations: number;
}

/**
 * The state dt after (r0, v0), any conic (Curtis Algorithm 3.4 / Vallado Algorithm 8). The universal Kepler equation
 * √μ·dt = r0·vr0/√μ·χ²C + (1 − αr0)χ³S + r0χ is increasing in χ, so its root is bracketed and found by guarded Newton.
 */
export function propagate(mu: number, r0: V3, v0: V3, dt: number): Propagated | OrbitFail {
  const R0 = norm(r0);
  const V0 = norm(v0);
  if (!(R0 > 0) || !Number.isFinite(dt)) return { ok: false, error: "Propagation needs a nonzero position and a finite time." };
  if (dt === 0) return { ok: true, r: [...r0] as V3, v: [...v0] as V3, chi: 0, iterations: 0 };
  const vr0 = dot(r0, v0) / R0;
  const alpha = 2 / R0 - (V0 * V0) / mu;
  const sm = Math.sqrt(mu);
  const F = (x: number): number => {
    const z = alpha * x * x;
    return ((R0 * vr0) / sm) * x * x * stumpffC(z) + (1 - alpha * R0) * x * x * x * stumpffS(z) + R0 * x - sm * dt;
  };
  const dF = (x: number): number => {
    const z = alpha * x * x;
    return ((R0 * vr0) / sm) * x * (1 - z * stumpffS(z)) + (1 - alpha * R0) * x * x * stumpffC(z) + R0;
  };
  // Bracket: χ ≈ √μ|α|dt for an ellipse; expand by doubling from a scale that cannot be zero.
  const x0 = alpha > 1e-12 * (1 / R0) ? sm * alpha * dt : Math.sign(dt) * Math.sqrt(Math.abs(dt) * sm / R0);
  let lo = 0;
  let hi = 0;
  let step = Math.max(Math.abs(x0), 1e-6 * Math.sqrt(R0));
  for (let k = 0; k < 200; k++) {
    const probe = Math.sign(dt) * step;
    const fp = F(probe);
    if (!Number.isFinite(fp)) return { ok: false, error: "The universal Kepler equation overflowed before its root was bracketed (an extreme hyperbola or time)." };
    if (Math.sign(fp) === Math.sign(dt)) {
      lo = Math.min(0, probe);
      hi = Math.max(0, probe);
      break;
    }
    step *= 2;
    if (k === 199) return { ok: false, error: "The universal Kepler equation's root could not be bracketed." };
  }
  const root = guardedRoot(F, dF, lo, hi, x0, 1e-15, 300);
  if (!root) return { ok: false, error: `The universal Kepler equation did not converge for a time of ${dt} s.` };
  const x = root.x;
  const z = alpha * x * x;
  const f = 1 - ((x * x) / R0) * stumpffC(z);
  const g = dt - ((x * x * x) / sm) * stumpffS(z);
  const r = add(scale(r0, f), scale(v0, g));
  const R = norm(r);
  const fdot = (sm / (R * R0)) * (alpha * x * x * x * stumpffS(z) - x);
  const gdot = 1 - ((x * x) / R) * stumpffC(z);
  const v = add(scale(r0, fdot), scale(v0, gdot));
  return { ok: true, r, v, chi: x, iterations: root.iterations };
}

// ---------------------------------------------------------------------------------------------------------------
// Lambert's problem by the universal variable
// ---------------------------------------------------------------------------------------------------------------

export type LambertWay = "short" | "long" | "prograde" | "retrograde";

export interface LambertResult {
  ok: true;
  v1: V3;
  v2: V3;
  /** Transfer angle Δθ, rad (0, 2π). */
  dtheta: number;
  z: number;
  iterations: number;
  /** The minimum-energy transfer's time of flight for this geometry and way, s (Lagrange's equation). */
  tofMinEnergy: number;
  /** The parabolic transfer time for this geometry, s: below it the transfer is hyperbolic. */
  tofParabolic: number;
}

/** Degrees from 180° (or from 0°/360°) inside which a Lambert transfer is refused as plane-singular. */
export const LAMBERT_SINGULAR_DEG = 0.01;

/**
 * Lambert's problem, single revolution (Curtis Algorithm 5.2 with a bracketed root for z). `way`: "short" (Δθ < 180°)
 * or "long" (Δθ > 180°) about r1 × r2; "prograde"/"retrograde" pick the transfer whose angular momentum has a positive
 * or negative z component (Curtis's convention, for heliocentric transfers in the ecliptic frame).
 */
export function lambert(mu: number, r1: V3, r2: V3, dt: number, way: LambertWay = "short"): LambertResult | OrbitFail {
  const R1 = norm(r1);
  const R2 = norm(r2);
  if (!(R1 > 0) || !(R2 > 0)) return { ok: false, error: "Both position vectors must be nonzero." };
  if (!(dt > 0) || !Number.isFinite(dt)) return { ok: false, error: "The time of flight must be greater than zero." };
  const c12 = cross(r1, r2);
  const cosT = clamp1(dot(r1, r2) / (R1 * R2));
  let dth = Math.acos(cosT); // [0, π]
  const sinRaw = norm(c12) / (R1 * R2);
  const nearDeg = (Math.atan2(sinRaw, Math.abs(cosT)) * 180) / Math.PI; // angle from the r1 line, 0..90
  if (nearDeg < LAMBERT_SINGULAR_DEG) {
    return cosT < 0
      ? { ok: false, error: `The two positions are ${(180 - nearDeg).toFixed(3)}° apart: a 180° transfer. Its plane is undefined (r₁ × r₂ = 0), so every plane through the two points is a solution and no single Δv exists. Move one point slightly out of line, or split the transfer.` }
      : { ok: false, error: "The two positions lie on the same line from the centre (a 0° or 360° transfer): the transfer plane is undefined. A rectilinear or whole-revolution transfer is outside this solver." };
  }
  if (way === "long") dth = TWO_PI - dth;
  else if (way === "prograde" && c12[2] < 0) dth = TWO_PI - dth;
  else if (way === "retrograde" && c12[2] >= 0) dth = TWO_PI - dth;
  const A = Math.sin(dth) * Math.sqrt((R1 * R2) / (1 - Math.cos(dth)));
  const y = (z: number): number => R1 + R2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
  const sm = Math.sqrt(mu);
  const tof = (z: number): number => {
    const yz = y(z);
    if (yz < 0) return -1;
    const C = stumpffC(z);
    const t = (Math.pow(yz / C, 1.5) * stumpffS(z) + A * Math.sqrt(yz)) / sm;
    // At z → 4π², C → 0 and the time grows without bound; past the arithmetic's reach it is "longer than anything".
    return Number.isFinite(t) && C > 0 ? t : Number.MAX_VALUE;
  };
  const zMax = 4 * Math.PI * Math.PI * (1 - 1e-7);
  /** The departure speed of the conic at z (for the refusal's wording). */
  const lambertSpeedAt = (z: number): number => {
    const yz = y(z);
    const g = A * Math.sqrt(yz / mu);
    return norm(sub(r2, scale(r1, 1 - yz / R1))) / Math.abs(g);
  };
  // The lower end. Short way (A > 0): the z where y = 0, where the time of flight falls to 0. Long way (A < 0): the time
  // falls toward 0 only as z → −∞ (an ever faster hyperbola), so the bracket stops at the most negative z the
  // arithmetic still resolves (cosh √−z overflows past z ≈ −5×10⁵, and the time loses its digits long before): a
  // shorter time than the time there is refused by name rather than solved from noise.
  let zMin: number;
  if (A > 0) {
    const r = y(-1e4) < 0 ? guardedRoot(y, null, -1e4, 0, -1, 1e-15, 400) : null;
    if (!r) return { ok: false, error: "Lambert: the y(z) = 0 bound could not be located." };
    zMin = r.x;
  } else {
    zMin = -1e4;
    while (zMin < -1 && !(tof(zMin) > 0 && tof(zMin) < tof(zMin / 2))) zMin /= 2;
  }
  const tofParab = tof(0);
  const tLow = Math.max(0, tof(zMin));
  if (dt <= tLow * (1 + 1e-9)) {
    const L1 = lambertSpeedAt(zMin);
    return { ok: false, error: `That time of flight (${dt.toPrecision(4)} s) is below the shortest this solver resolves for the long way (about ${tLow.toPrecision(3)} s, already a departure speed near ${(L1 / 1000).toPrecision(3)} km/s): no meaningful conic joins the two points that fast. Lengthen the time or take the short way.` };
  }
  if (!(tof(zMax) > dt)) {
    return { ok: false, error: "That time of flight needs a single-revolution ellipse so large that the arithmetic cannot resolve it. Multi-revolution Lambert solutions are not offered: shorten the time or split the transfer." };
  }
  const root = guardedRoot((z) => tof(z) - dt, null, zMin, zMax, 0, 1e-15, 400);
  if (!root) return { ok: false, error: "Lambert's equation did not converge for this geometry and time of flight." };
  const z = root.x;
  const yz = y(z);
  const f = 1 - yz / R1;
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1 - yz / R2;
  const v1 = scale(sub(r2, scale(r1, f)), 1 / g);
  const v2 = scale(sub(scale(r2, gdot), r1), 1 / g);
  // A time so short that the conic needs a sizeable fraction of light speed is not an answer: Newtonian two-body
  // mechanics stops describing it, and nothing could fly it.
  const vMax = Math.max(norm(v1), norm(v2));
  if (vMax > 0.01 * 299792458) {
    return { ok: false, error: `That time of flight (${dt.toPrecision(4)} s) is too short: the transfer would need ${(vMax / 1000).toPrecision(3)} km/s, above 1 % of the speed of light, outside Newtonian two-body mechanics and any propulsion. Lengthen the time.` };
  }
  // Minimum-energy transfer: a_m = s/2, with the Lagrange time (Vallado Algorithm 56 / Bate §5.2).
  const c = norm(sub(r2, r1));
  const s = (R1 + R2 + c) / 2;
  const am = s / 2;
  const beta = 2 * Math.asin(Math.sqrt((s - c) / s));
  const betaS = dth > Math.PI ? -beta : beta;
  const tme = Math.sqrt((am * am * am) / mu) * (Math.PI - betaS + Math.sin(betaS));
  return { ok: true, v1, v2, dtheta: dth, z, iterations: root.iterations, tofMinEnergy: tme, tofParabolic: tofParab };
}
