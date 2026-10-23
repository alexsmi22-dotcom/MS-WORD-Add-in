// Pressure vessels, thick-walled cylinders, shrink fits and rotating disks: closed-form linear elasticity.
//
// Everything here is SI (Pa, m, kg/m³, rad/s) and pure. The pane glue (vesselsCalcs.ts) owns units and wording.
//
// THE MODELS, and where each one stops being true:
//   - Thin wall: membrane stresses σθ = p·r/t, σz = p·r/(2t) (cylinder), σ = p·r/(2t) (sphere), with r the INNER
//     radius. Force equilibrium makes p·rᵢ/t the exact wall-AVERAGE hoop stress of a cylinder; the peak at the bore
//     is higher, by roughly t/r. Above t/r = 0.1 that difference is no longer small and the thick-wall tool is the
//     honest answer, so the thin-wall formula is refused there rather than quoted.
//   - Lamé: an axisymmetric, linear-elastic cylinder far from its ends, σr = A − B/r², σθ = A + B/r². The axial
//     stress of a closed-ended cylinder is the end load over the wall area (uniform, away from the ends).
//   - Shrink fit: both parts as Lamé cylinders in PLANE STRESS (no axial stress, an open-ended hub), and the radial
//     interference δ taken up by the two radial displacements u = r(σθ − νσr)/E at the interface:
//         δ = u_hub(b) − u_shaft(b) = p·b·[ ((c² + b²)/(c² − b²) + ν_o)/E_o + ((b² + a²)/(b² − a²) − ν_i)/E_i ].
//     Same material, it reduces to p = E·δ·(c² − b²)(b² − a²) / (2b³(c² − a²)), which the case table pins. This is
//     the textbook press/shrink-fit result (e.g. Budynas & Nisbett, Shigley's Mechanical Engineering Design,
//     "Press and shrink fits"); it is re-derived here from the Lamé displacements rather than quoted.
//   - Rotating disk: a thin disk of uniform thickness in plane stress, free at the rim, solid or with a free
//     (unloaded) bore (Timoshenko & Goodier, Theory of Elasticity, §32). Stresses scale with ρω².
//
// No design code: a yield margin is the ratio of a user-given yield strength to the von Mises (and Tresca)
// equivalent stress, computed by stress.ts, never an allowable stress.

/** A named refusal: the reason is the user-facing sentence. */
export interface VesselError {
  ok: false;
  error: string;
}

const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

// ------------------------------------------------------------------------------------------------ thin wall

export type ThinShape = "cylinder-closed" | "cylinder-open" | "sphere";

export interface ThinResult {
  ok: true;
  shape: ThinShape;
  /** Hoop (circumferential) stress, Pa. For a sphere: the equal in-plane membrane stress. */
  hoop: number;
  /** Axial (longitudinal) stress, Pa; 0 for an open-ended cylinder; equal to hoop for a sphere. */
  axial: number;
  /** Radial stress at the bore, −p (Pa); zero at the outer surface. */
  radialBore: number;
  /** t/r. */
  ratio: number;
  /** The Lamé hoop stress at the bore of the same cylinder (Pa); null for a sphere. */
  lameBoreHoop: number | null;
}

/** The thin-wall limit: t/r above this is refused with a pointer to the thick-wall tool. */
export const THIN_WALL_LIMIT = 0.1;

/** Membrane stresses of a thin-walled vessel under internal pressure p (Pa); r = inner radius (m), t = wall (m). */
export function thinVessel(p: number, r: number, t: number, shape: ThinShape): ThinResult | VesselError {
  if (!fin(p, r, t)) return { ok: false, error: "Pressure, radius and wall thickness must be finite numbers." };
  if (r <= 0) return { ok: false, error: "The inner radius must be greater than zero." };
  if (t <= 0) return { ok: false, error: "The wall thickness must be greater than zero." };
  if (p < 0) {
    return {
      ok: false,
      error:
        "A negative pressure is external pressure: a thin shell under external pressure fails by buckling long " +
        "before the membrane stress reaches yield, and buckling is not computed here. Use the thick-walled " +
        "cylinder tool for the stresses of a thick wall under external pressure.",
    };
  }
  const ratio = t / r;
  if (ratio > THIN_WALL_LIMIT * (1 + 1e-12)) {
    return {
      ok: false,
      error:
        `t/r = ${trim(ratio)} is above 0.1, where the thin-wall formula stops being accurate (the bore stress ` +
        "exceeds the wall average by about t/r). Use Thick-walled cylinder (Lamé) for this vessel.",
    };
  }
  const hoopCyl = (p * r) / t;
  const half = (p * r) / (2 * t);
  const ro = r + t;
  const lame = shape === "sphere" ? null : (p * (ro * ro + r * r)) / (ro * ro - r * r);
  if (!fin(hoopCyl, half) || (lame !== null && !fin(lame))) {
    return { ok: false, error: "These values overflow double precision; check the units." };
  }
  if (shape === "sphere") return { ok: true, shape, hoop: half, axial: half, radialBore: -p, ratio, lameBoreHoop: null };
  return { ok: true, shape, hoop: hoopCyl, axial: shape === "cylinder-closed" ? half : 0, radialBore: -p, ratio, lameBoreHoop: lame };
}

/** A ratio for a sentence (3 significant figures, plain digits). */
function trim(v: number): string {
  return String(Number(v.toPrecision(3)));
}

// ---------------------------------------------------------------------------------------------- Lamé cylinder

export type EndCondition = "closed" | "open";

export interface LameResult {
  ok: true;
  ri: number;
  ro: number;
  /** σr = A − B/r², σθ = A + B/r² (Pa, Pa·m²). */
  A: number;
  B: number;
  /** Axial stress (Pa): A for closed ends, 0 for open ends. */
  axial: number;
  ends: EndCondition;
  /** The boundary pressures (Pa). */
  pi: number;
  po: number;
}

/** Lamé constants of a thick cylinder, inner radius ri, outer ro (m), internal pi and external po pressure (Pa). */
export function lame(ri: number, ro: number, pi: number, po: number, ends: EndCondition): LameResult | VesselError {
  if (!fin(ri, ro, pi, po)) return { ok: false, error: "Radii and pressures must be finite numbers." };
  if (ri <= 0) return { ok: false, error: "The inner radius must be greater than zero (a solid cylinder has no bore pressure)." };
  if (ro <= ri) return { ok: false, error: "The outer radius must be larger than the inner radius." };
  if (pi < 0 || po < 0) {
    return { ok: false, error: "Enter pressures as positive magnitudes: pᵢ pushes outward on the bore, pₒ inward on the outside." };
  }
  const d = ro * ro - ri * ri;
  const A = (pi * ri * ri - po * ro * ro) / d;
  const B = ((pi - po) * ri * ri * ro * ro) / d;
  if (!fin(A, B) || d <= 0) return { ok: false, error: "These values overflow double precision; check the units." };
  return { ok: true, ri, ro, A, B, axial: ends === "closed" ? A : 0, ends, pi, po };
}

/**
 * σr and σθ of a Lamé cylinder at radius r (Pa). At a surface whose pressure is known (`bounds`), σr is that
 * boundary value exactly: A − B/r² there differs from it by rounding alone (7×10⁻¹⁵ MPa instead of 0).
 */
export function lameAt(
  l: { A: number; B: number; ri?: number; ro?: number; pi?: number; po?: number },
  r: number,
): { sr: number; st: number } {
  const st = l.A + l.B / (r * r);
  if (r === l.ri && l.pi !== undefined) return { sr: l.pi === 0 ? 0 : -l.pi, st };
  if (r === l.ro && l.po !== undefined) return { sr: l.po === 0 ? 0 : -l.po, st };
  return { sr: l.A - l.B / (r * r), st };
}

// -------------------------------------------------------------------------------------------------- shrink fit

export interface FitMaterial {
  /** Young's modulus, Pa. */
  E: number;
  /** Poisson's ratio. */
  nu: number;
}

/** Lamé constants of one part, with its surfaces and their pressures when known (see lameAt). */
export interface LameBody {
  A: number;
  B: number;
  ri?: number;
  ro?: number;
  pi?: number;
  po?: number;
}

export interface ShrinkResult {
  ok: true;
  /** Interface pressure, Pa. */
  p: number;
  a: number;
  b: number;
  c: number;
  /** The shaft as a Lamé cylinder (a = 0: solid, σr = σθ = −p throughout). */
  shaft: LameBody;
  /** The hub as a Lamé cylinder. */
  hub: LameBody;
  /** Hub hoop stress at the interface (its peak), Pa. */
  hubHoopB: number;
  /** Shaft hoop stress at the interface, Pa (= −p for a solid shaft; the bore of a hollow shaft is higher). */
  shaftHoopB: number;
  /** Shaft hoop stress at its bore (Pa); null for a solid shaft. */
  shaftHoopA: number | null;
  sameMaterial: boolean;
}

const nuOk = (nu: number): boolean => nu > -1 && nu <= 0.5;

/**
 * Interface pressure of a shrink (press) fit: shaft inner radius a (0 = solid), interface radius b, hub outer radius
 * c (m), RADIAL interference delta (m) — half the diametral interference.
 */
export function shrinkFit(a: number, b: number, c: number, delta: number, shaft: FitMaterial, hub: FitMaterial): ShrinkResult | VesselError {
  if (!fin(a, b, c, delta, shaft.E, shaft.nu, hub.E, hub.nu)) return { ok: false, error: "Every value must be a finite number." };
  if (a < 0) return { ok: false, error: "The shaft bore radius cannot be negative (0 is a solid shaft)." };
  if (b <= 0) return { ok: false, error: "The interface radius must be greater than zero." };
  if (a >= b) return { ok: false, error: "The shaft bore must be smaller than the interface radius." };
  if (c <= b) return { ok: false, error: "The hub outer radius must be larger than the interface radius." };
  if (delta <= 0) return { ok: false, error: "The radial interference must be greater than zero (no interference, no fit pressure)." };
  if (delta >= 0.01 * b) {
    return {
      ok: false,
      error:
        "A radial interference of 1 % of the radius or more is far outside small-strain elasticity (real fits are " +
        "about 0.05–0.2 %); check that the interference is radial and in the unit typed.",
    };
  }
  if (shaft.E <= 0 || hub.E <= 0) return { ok: false, error: "Young's modulus must be greater than zero." };
  if (!nuOk(shaft.nu) || !nuOk(hub.nu)) return { ok: false, error: "Poisson's ratio must lie between −1 and 0.5." };
  const hubTerm = ((c * c + b * b) / (c * c - b * b) + hub.nu) / hub.E;
  const shaftTerm = ((b * b + a * a) / (b * b - a * a) - shaft.nu) / shaft.E;
  const p = delta / (b * (hubTerm + shaftTerm));
  if (!fin(p) || p <= 0) return { ok: false, error: "These values overflow double precision; check the units." };
  // The hub: internal pressure p, free outside. The shaft: external pressure p, free bore (or solid).
  const hd = c * c - b * b;
  const hubL = { A: (p * b * b) / hd, B: (p * b * b * c * c) / hd, ri: b, ro: c, pi: p, po: 0 };
  let shaftL: LameBody;
  if (a === 0) shaftL = { A: -p, B: 0 };
  else {
    const sd = b * b - a * a;
    shaftL = { A: (-p * b * b) / sd, B: (-p * a * a * b * b) / sd, ri: a, ro: b, pi: 0, po: p };
  }
  return {
    ok: true,
    p,
    a,
    b,
    c,
    shaft: shaftL,
    hub: hubL,
    hubHoopB: lameAt(hubL, b).st,
    shaftHoopB: a === 0 ? -p : lameAt(shaftL, b).st,
    shaftHoopA: a === 0 ? null : lameAt(shaftL, a).st,
    sameMaterial: shaft.E === hub.E && shaft.nu === hub.nu,
  };
}

// ------------------------------------------------------------------------------------------------ rotating disk

export interface DiskResult {
  ok: true;
  /** Bore radius a (0 = solid) and rim radius b (m). */
  a: number;
  b: number;
  rho: number;
  omega: number;
  nu: number;
  /** Peak hoop stress (Pa): the centre (solid) or the bore (hollow). */
  hoopMax: number;
  /** Peak radial stress (Pa): the centre (solid) or r = √(ab) (hollow). */
  radialMax: number;
  radialMaxAt: number;
  /** Hoop stress at the rim (Pa). */
  hoopRim: number;
}

/** A rotating disk, density rho (kg/m³), speed omega (rad/s), bore a (0 = solid) and rim b (m), Poisson nu. */
export function rotatingDisk(rho: number, omega: number, a: number, b: number, nu: number): DiskResult | VesselError {
  if (!fin(rho, omega, a, b, nu)) return { ok: false, error: "Every value must be a finite number." };
  if (rho <= 0) return { ok: false, error: "The density must be greater than zero." };
  if (omega < 0) return { ok: false, error: "Enter the speed as a positive magnitude (the stresses do not depend on the sense of rotation)." };
  if (b <= 0) return { ok: false, error: "The outer radius must be greater than zero." };
  if (a < 0) return { ok: false, error: "The bore radius cannot be negative (0 is a solid disk)." };
  if (a >= b) return { ok: false, error: "The bore radius must be smaller than the outer radius." };
  if (!nuOk(nu)) return { ok: false, error: "Poisson's ratio must lie between −1 and 0.5." };
  const k = rho * omega * omega;
  if (!fin(k * b * b)) return { ok: false, error: "These values overflow double precision; check the units." };
  const s = diskAt({ a, b, rho, omega, nu }, a);
  const rim = diskAt({ a, b, rho, omega, nu }, b);
  const rStar = a === 0 ? 0 : Math.sqrt(a * b);
  const radialMax = diskAt({ a, b, rho, omega, nu }, rStar).sr;
  return { ok: true, a, b, rho, omega, nu, hoopMax: s.st, radialMax, radialMaxAt: rStar, hoopRim: rim.st };
}

/** σr and σθ (Pa) of a rotating disk at radius r (a ≤ r ≤ b). */
export function diskAt(d: { a: number; b: number; rho: number; omega: number; nu: number }, r: number): { sr: number; st: number } {
  const { a, b, nu } = d;
  const k = d.rho * d.omega * d.omega;
  if (a === 0) {
    return { sr: ((3 + nu) / 8) * k * (b * b - r * r), st: (k / 8) * ((3 + nu) * b * b - (1 + 3 * nu) * r * r) };
  }
  const c = ((3 + nu) / 8) * k;
  // Written with r ≥ a only (callers never ask inside the bore), so a²b²/r² is finite.
  return {
    sr: c * (a * a + b * b - (a * a * b * b) / (r * r) - r * r),
    st: c * (a * a + b * b + (a * a * b * b) / (r * r) - ((1 + 3 * nu) / (3 + nu)) * r * r),
  };
}
