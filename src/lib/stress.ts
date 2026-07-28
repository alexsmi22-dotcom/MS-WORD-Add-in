// Stress states, failure criteria, torsion and column buckling — what you do
// with a load once a beam or section analysis has given you one.
//
// WHY THIS IS FLOATING POINT WHEN beam.ts IS EXACT. A stress transformation is
// not a rational operation: the principal directions involve atan2 and the
// principal magnitudes a square root, so sqrt(σ² + 4τ²) is irrational for
// almost every input a student types. beam.ts stays exact because Macaulay
// integration genuinely is exact; pretending the same here would mean carrying
// a Rat through a square root and rounding anyway, one layer further from where
// the reader can see it happen. So this module is honest double precision and
// the reporting layer quotes to the significant figures the inputs carry.
//
// THE ABSOLUTE-MAXIMUM-SHEAR TRAP, which is the single most common error in
// undergraduate mechanics and the reason this module computes in 3D even when
// asked a 2D question. For a plane stress state the out-of-plane principal
// stress is ZERO, and zero is still a principal stress. The in-plane maximum
// shear is (σ1 - σ2)/2, but the ABSOLUTE maximum shear the material actually
// sees is (σmax - σmin)/2 taken over all THREE principal stresses including
// that zero. When σ1 and σ2 have the same sign these differ — for a bar in
// uniaxial tension the in-plane formula gives σ/2 correctly, but for a
// biaxial state σ1 = 100, σ2 = 60 the in-plane answer is 20 while the true
// answer is 50, and the bar yields at the number the in-plane formula never
// mentions. Both are therefore reported, labelled, and the report says when
// they differ rather than leaving the reader to notice.
//
// PRINCIPAL STRESSES IN 3D ARE FOUND IN CLOSED FORM, not by iteration. The
// characteristic polynomial of a symmetric 3x3 tensor has three real roots, so
// the trigonometric solution of the depressed cubic applies exactly and
// terminates. An eigenvalue iteration here would be slower, would need a
// convergence cap to be safe in a task pane, and would be approximating
// something that has an answer.
//
// SIGN CONVENTIONS:
//   Tensile normal stress is POSITIVE. Compression is negative.
//   τxy is positive when it acts on the +x face in the +y direction — the
//     usual continuum convention, which is also the one that makes the stress
//     tensor symmetric.
//   The principal angle θp is measured COUNTERCLOCKWISE from the x axis to the
//     direction of σ1, in degrees, reported in (-90, 90].
//   NOTE that Mohr's circle is conventionally drawn with θ doubled and, in many
//     texts, with the shear axis inverted so the rotation sense matches
//     physical space. This module reports ANGLES IN PHYSICAL SPACE, so a
//     reader comparing against a Mohr diagram should double them.

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** A general stress state. Out-of-plane components default to zero (plane stress). */
export interface StressState {
  sx: number;
  sy: number;
  sz: number;
  txy: number;
  tyz: number;
  tzx: number;
}

export interface PrincipalResult {
  ok: true;
  /** The three principal stresses, sorted descending: s1 >= s2 >= s3. */
  principal: [number, number, number];
  /** True when the input was a plane-stress state (sz = tyz = tzx = 0). */
  plane: boolean;
  /** In-plane principal stresses for a plane-stress state, descending. */
  inPlane: [number, number] | null;
  /** Angle in degrees, counterclockwise from +x to the in-plane s1 direction. */
  thetaP: number | null;
  /** Maximum shear in the xy plane only — (sA - sB)/2 of the in-plane pair. */
  tauInPlane: number | null;
  /** Absolute maximum shear over all three principal stresses. */
  tauAbsMax: number;
  /** Centre of the in-plane Mohr circle, (sx + sy)/2. */
  mohrCentre: number | null;
  /** Radius of the in-plane Mohr circle. */
  mohrRadius: number | null;
  /** Hydrostatic (mean) stress, the average of the three principals. */
  hydrostatic: number;
  /** von Mises equivalent stress. */
  vonMises: number;
  /** Tresca equivalent stress, equal to 2 * tauAbsMax. */
  tresca: number;
  notes: string[];
}

export interface StressError {
  ok: false;
  error: string;
}

/** Every number in a stress state must be finite; a NaN silently poisons every
 * downstream comparison and would be reported as a confident result. */
function finiteState(s: StressState): string | null {
  const entries: [string, number][] = [
    ["σx", s.sx],
    ["σy", s.sy],
    ["σz", s.sz],
    ["τxy", s.txy],
    ["τyz", s.tyz],
    ["τzx", s.tzx],
  ];
  for (const [name, v] of entries) {
    if (!Number.isFinite(v)) return `${name} must be a finite number.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Principal stresses
// ---------------------------------------------------------------------------

/**
 * The three real roots of the characteristic equation of a symmetric 3x3
 * tensor, returned descending.
 *
 * The invariants are
 *   I1 = tr, I2 = sum of principal 2x2 minors, I3 = det
 * and the depressed cubic is solved by the trigonometric method, which is the
 * branch that applies when all three roots are real — guaranteed here because
 * the tensor is symmetric. The discriminant is CLAMPED to [-1, 1] before acos
 * because a state that is numerically hydrostatic can push it a few ulp
 * outside by rounding alone, and acos(1 + 1e-16) is NaN.
 */
function principal3(s: StressState): [number, number, number] {
  // NORMALISE BEFORE FORMING THE INVARIANTS. I1^3 and I3 are cubic in the
  // components, so a state written in pascals rather than megapascals can
  // overflow a double to Infinity while every single input is perfectly finite
  // — and the acos then returns NaN, so all three principal stresses come back
  // NaN from a legal question. Scaling the tensor to unit magnitude makes every
  // coefficient O(1) for ANY finite input, and the eigenvalues of a scaled
  // tensor are the scaled eigenvalues exactly, so multiplying back at the end
  // costs one rounding and buys immunity to the whole failure mode. It also
  // conditions the cubic better for states with a wide spread of components.
  //
  // Found by the adversarial pass, not by the oracle tests: every textbook case
  // is O(100) and none of them can reach this.
  const scale = Math.max(
    Math.abs(s.sx),
    Math.abs(s.sy),
    Math.abs(s.sz),
    Math.abs(s.txy),
    Math.abs(s.tyz),
    Math.abs(s.tzx),
  );
  if (scale === 0) return [0, 0, 0];
  const u = {
    sx: s.sx / scale,
    sy: s.sy / scale,
    sz: s.sz / scale,
    txy: s.txy / scale,
    tyz: s.tyz / scale,
    tzx: s.tzx / scale,
  };
  const raw = principalUnit(u);
  return [raw[0] * scale, raw[1] * scale, raw[2] * scale];
}

/** The roots for a tensor already normalised to unit magnitude. */
function principalUnit(s: StressState): [number, number, number] {
  const I1 = s.sx + s.sy + s.sz;
  const I2 =
    s.sx * s.sy + s.sy * s.sz + s.sz * s.sx - s.txy * s.txy - s.tyz * s.tyz - s.tzx * s.tzx;
  const I3 =
    s.sx * s.sy * s.sz +
    2 * s.txy * s.tyz * s.tzx -
    s.sx * s.tyz * s.tyz -
    s.sy * s.tzx * s.tzx -
    s.sz * s.txy * s.txy;

  // Depressed cubic: with s = I1/3, the roots are s + 2r cos(phi + 2kpi/3).
  const mean = I1 / 3;
  const p = (I1 * I1) / 3 - I2; // >= 0 for a symmetric tensor
  if (p <= 1e-300) {
    // Hydrostatic to within representable precision: all three roots equal.
    return [mean, mean, mean];
  }
  const r = Math.sqrt(p / 3);
  // With x = lambda - I1/3 the cubic is x^3 - p*x - q = 0, and substituting
  // x = 2r cos(theta) with p = 3r^2 collapses it to 2r^3 cos(3 theta) = q by the
  // triple-angle identity. Hence cos(3 theta) = q / (2 r^3) = 3q / (2 p r).
  const q = (2 * I1 * I1 * I1) / 27 - (I1 * I2) / 3 + I3;
  let cos3phi = (3 * q) / (2 * p * r);
  if (cos3phi > 1) cos3phi = 1;
  if (cos3phi < -1) cos3phi = -1;
  const phi = Math.acos(cos3phi) / 3;
  const a = mean + 2 * r * Math.cos(phi);
  const b = mean + 2 * r * Math.cos(phi - (2 * Math.PI) / 3);
  const c = mean + 2 * r * Math.cos(phi + (2 * Math.PI) / 3);
  const sorted = [a, b, c].sort((x, y) => y - x);
  return [sorted[0], sorted[1], sorted[2]];
}

/** Analyses a stress state: principal stresses, shears, and equivalent stresses. */
export function analyzeStress(s: StressState): PrincipalResult | StressError {
  const bad = finiteState(s);
  if (bad) return { ok: false, error: bad };

  const notes: string[] = [];
  // "Plane stress" means the z face carries nothing. Judged against the scale
  // of the state rather than against zero, so that a state stored as 1e-17
  // from an earlier subtraction is still recognised as plane.
  const scale = Math.max(
    Math.abs(s.sx),
    Math.abs(s.sy),
    Math.abs(s.sz),
    Math.abs(s.txy),
    Math.abs(s.tyz),
    Math.abs(s.tzx),
    1,
  );
  const tol = scale * 1e-12;
  const plane = Math.abs(s.sz) <= tol && Math.abs(s.tyz) <= tol && Math.abs(s.tzx) <= tol;

  const principal = principal3(s);

  let inPlane: [number, number] | null = null;
  let thetaP: number | null = null;
  let tauInPlane: number | null = null;
  let mohrCentre: number | null = null;
  let mohrRadius: number | null = null;

  if (plane) {
    const centre = (s.sx + s.sy) / 2;
    const radius = Math.hypot((s.sx - s.sy) / 2, s.txy);
    inPlane = [centre + radius, centre - radius];
    tauInPlane = radius;
    mohrCentre = centre;
    mohrRadius = radius;
    // atan2 gives 2θp directly and without the quadrant ambiguity that
    // atan(2τ/(σx-σy)) has — the latter is wrong by 90 degrees whenever
    // σx < σy, which is exactly the case a student is most likely to check.
    if (radius <= tol) {
      // Every direction is principal; naming one would be arbitrary.
      thetaP = 0;
      notes.push(
        "The state is isotropic in the xy plane (Mohr's circle is a point), so every " +
          "direction is principal and the reported angle is arbitrary.",
      );
    } else {
      thetaP = (Math.atan2(s.txy, (s.sx - s.sy) / 2) * 90) / Math.PI;
    }
  }

  const tauAbsMax = (principal[0] - principal[2]) / 2;
  const hydrostatic = (principal[0] + principal[1] + principal[2]) / 3;

  const [a, b, c] = principal;
  // SCALED, for the same reason principal3 is. The differences are SQUARED
  // here, so a state around 1e200 — entirely representable, and whose von Mises
  // stress is also around 1e200 — overflows the intermediate to Infinity and
  // destroys an answer that fits in a double comfortably. Dividing through by
  // the largest principal stress first makes every square O(1).
  const pScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  const vonMises =
    pScale === 0
      ? 0
      : pScale *
        Math.sqrt(
          (((a - b) / pScale) ** 2 + ((b - c) / pScale) ** 2 + ((c - a) / pScale) ** 2) / 2,
        );
  const tresca = principal[0] - principal[2];

  if (plane && tauInPlane !== null && tauAbsMax > tauInPlane * (1 + 1e-9)) {
    notes.push(
      "The absolute maximum shear is LARGER than the in-plane maximum shear, because the " +
        "zero out-of-plane principal stress lies outside the in-plane pair. Design against the " +
        "absolute value — the in-plane circle alone understates the shear this state produces.",
    );
  }

  // A state at the very top of double precision has a Tresca stress
  // (sigma1 - sigma3) that genuinely does not fit in a double, however the
  // arithmetic is arranged. There is nothing to do about that except say so:
  // an Infinity reported as an equivalent stress becomes a number in someone's
  // document, and this is the last place it can be stopped.
  for (const v of [...principal, tauAbsMax, vonMises, tresca, hydrostatic]) {
    if (!Number.isFinite(v)) {
      return {
        ok: false,
        error:
          "This stress state is too large to analyse in double precision — the principal " +
          "stresses or their differences overflow. Work in MPa rather than Pa.",
      };
    }
  }

  return {
    ok: true,
    principal,
    plane,
    inPlane,
    thetaP,
    tauInPlane,
    tauAbsMax,
    mohrCentre,
    mohrRadius,
    hydrostatic,
    vonMises,
    tresca,
    notes,
  };
}

/**
 * The stress components on a plane rotated by `deg` counterclockwise from x.
 * Plane stress only — the out-of-plane components rotate too in 3D, and
 * reporting a 2D rotation of a 3D state would be wrong.
 */
export function transformPlane(
  sx: number,
  sy: number,
  txy: number,
  deg: number,
): { sxp: number; syp: number; txyp: number } | StressError {
  for (const v of [sx, sy, txy, deg]) {
    if (!Number.isFinite(v)) return { ok: false, error: "Every value must be a finite number." };
  }
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(2 * t);
  const s = Math.sin(2 * t);
  const avg = (sx + sy) / 2;
  const dif = (sx - sy) / 2;
  return {
    sxp: avg + dif * c + txy * s,
    syp: avg - dif * c - txy * s,
    txyp: -dif * s + txy * c,
  };
}

/**
 * Factor of safety against yield under both common ductile criteria.
 *
 * Reported together deliberately: von Mises (distortion energy) is the more
 * accurate for ductile metals and Tresca (maximum shear) is the more
 * conservative, and a reader who only sees one does not know which side of the
 * real answer they are on. The two never differ by more than about 15%, with
 * Tresca always the lower — that bound is the useful thing to see.
 */
export function factorOfSafety(
  r: PrincipalResult,
  yieldStrength: number,
): { vonMises: number; tresca: number } | StressError {
  if (!Number.isFinite(yieldStrength) || yieldStrength <= 0) {
    return { ok: false, error: "The yield strength must be a positive number." };
  }
  return {
    vonMises: r.vonMises > 0 ? yieldStrength / r.vonMises : Infinity,
    tresca: r.tresca > 0 ? yieldStrength / r.tresca : Infinity,
  };
}

// ---------------------------------------------------------------------------
// Torsion of circular shafts
// ---------------------------------------------------------------------------

export interface TorsionInput {
  /** Applied torque. */
  T: number;
  /** Outer diameter. */
  d: number;
  /** Inner diameter; 0 for a solid shaft. */
  di: number;
  /** Length, for the angle of twist. 0 to skip. */
  L: number;
  /** Shear modulus, for the angle of twist. 0 to skip. */
  G: number;
}

export interface TorsionResult {
  ok: true;
  /** Polar second moment of area. */
  J: number;
  /** Peak shear stress, at the outer surface. */
  tauMax: number;
  /** Shear stress at the inner surface; equals tauMax for a solid shaft. */
  tauInner: number;
  /** Angle of twist in radians, or null when L or G was not given. */
  twistRad: number | null;
  twistDeg: number | null;
  notes: string[];
}

/**
 * Torsion of a circular shaft.
 *
 * RESTRICTED TO CIRCULAR SECTIONS ON PURPOSE. τ = Tr/J is exact for a circular
 * shaft because plane sections remain plane and radii remain straight — that is
 * a theorem, not an approximation. For ANY non-circular section it is simply
 * false: the section warps, the peak shear moves to the middle of the long side
 * rather than the corner, and the rectangular-shaft answer needs a tabulated
 * coefficient that depends on the aspect ratio. Accepting a width and height
 * here and applying the circular formula would produce a plausible number that
 * is wrong by a factor of two or more, so the shape is not offered.
 */
export function analyzeTorsion(inp: TorsionInput): TorsionResult | StressError {
  const { T, d, di, L, G } = inp;
  for (const [name, v] of [
    ["torque", T],
    ["outer diameter", d],
    ["inner diameter", di],
    ["length", L],
    ["shear modulus", G],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (d <= 0) return { ok: false, error: "The outer diameter must be greater than zero." };
  if (di < 0) return { ok: false, error: "The inner diameter cannot be negative." };
  if (di >= d) return { ok: false, error: "The inner diameter must be smaller than the outer diameter." };

  const ro = d / 2;
  const ri = di / 2;
  const J = (Math.PI / 2) * (ro ** 4 - ri ** 4);
  // J IS A FOURTH POWER, so it leaves double precision long before the diameter
  // does: a diameter of 1e-300 m underflows J to exactly zero and the stress
  // comes out Infinity, while 1e150 m overflows it and the stress comes out
  // zero. Both are finite inputs producing a confident wrong answer, so the
  // range is checked rather than assumed. Refusing here is honest; a diameter
  // that cannot be squared twice is not a shaft.
  if (!Number.isFinite(J) || J <= 0) {
    return {
      ok: false,
      error:
        "These diameters are outside the range that can be computed in double precision — the " +
        "polar second moment is a fourth power and has overflowed or underflowed. Work in " +
        "millimetres or metres rather than in a unit that makes the numbers this extreme.",
    };
  }
  const tauMax = (Math.abs(T) * ro) / J;
  const tauInner = (Math.abs(T) * ri) / J;
  if (!Number.isFinite(tauMax) || !Number.isFinite(tauInner)) {
    return {
      ok: false,
      error:
        "The shear stress overflowed double precision for this torque and diameter. Check the " +
        "units — a torque in N·mm with a diameter in metres is the usual cause.",
    };
  }

  const notes: string[] = [];
  let twistRad: number | null = null;
  if (L > 0 && G > 0) {
    twistRad = (T * L) / (G * J);
  } else if (L > 0 || G > 0) {
    notes.push("The angle of twist needs both a length and a shear modulus; one was missing.");
  }

  if (ri > 0 && d - di < d * 0.05) {
    notes.push(
      "This is a thin-walled tube. The linear stress distribution used here is still correct, " +
        "but check it against buckling of the wall, which governs thin tubes long before the " +
        "shear stress reaches yield.",
    );
  }

  return {
    ok: true,
    J,
    tauMax,
    tauInner,
    twistRad,
    twistDeg: twistRad === null ? null : (twistRad * 180) / Math.PI,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Column buckling
// ---------------------------------------------------------------------------

/** End restraint, with the theoretical effective-length factor K. */
export type EndCondition = "pinned" | "fixed" | "fixed-pinned" | "fixed-free" | "custom";

export const K_FACTORS: Record<Exclude<EndCondition, "custom">, number> = {
  pinned: 1,
  fixed: 0.5,
  "fixed-pinned": 0.7,
  "fixed-free": 2,
};

export interface ColumnInput {
  /** Unbraced length. */
  L: number;
  /** Young's modulus. */
  E: number;
  /** Second moment of area about the buckling axis — the SMALLER principal I. */
  I: number;
  /** Cross-sectional area. */
  A: number;
  /** Yield strength; 0 to skip the squash-load and Johnson checks. */
  Fy: number;
  end: EndCondition;
  /** Used only when `end` is "custom". */
  kCustom?: number;
}

export interface ColumnResult {
  ok: true;
  K: number;
  /** Effective length, K*L. */
  Le: number;
  /** Radius of gyration, sqrt(I/A). */
  r: number;
  /** Slenderness ratio, Le/r. */
  slenderness: number;
  /** Euler critical load. */
  pEuler: number;
  /** Euler critical stress. */
  sigmaEuler: number;
  /** Transition slenderness between Johnson and Euler; null without a yield strength. */
  slendernessTransition: number | null;
  /** Squash load, A*Fy; null without a yield strength. */
  pSquash: number | null;
  /** The governing critical load once yielding is accounted for. */
  pCritical: number;
  /** Which curve governs. */
  governs: "euler" | "johnson" | "euler-only";
  notes: string[];
}

/**
 * Euler buckling, with the Johnson parabola for short columns.
 *
 * WHY THE EULER LOAD ALONE IS NOT AN ANSWER. Pcr = π²EI/Le² has no upper
 * bound: as the column gets shorter it predicts a critical stress that passes
 * yield and keeps climbing, so for a stocky column it returns a load the
 * material cannot reach — the column squashes long before it buckles. Reporting
 * that number by itself is the classic way to be non-conservative by a wide
 * margin in the one regime where the error matters. So the transition
 * slenderness
 *
 *     λc = sqrt(2π²E / Fy)
 *
 * is computed — the slenderness at which the Euler stress equals HALF the yield
 * stress, which is where the Johnson parabola is tangent to the Euler
 * hyperbola — and below it the Johnson formula governs:
 *
 *     σcr = Fy · (1 - Fy·λ² / (4π²E))
 *
 * Without a yield strength no such statement can be made, which is reported as
 * "euler-only" rather than silently assumed away.
 *
 * I MUST BE THE MINOR AXIS VALUE. A column buckles about its weakest axis, so
 * feeding the strong-axis I of an I-beam gives a critical load several times too
 * high. The caller is warned; this function cannot tell which one it was given.
 */
export function analyzeColumn(inp: ColumnInput): ColumnResult | StressError {
  const { L, E, I, A, Fy } = inp;
  for (const [name, v] of [
    ["length", L],
    ["modulus", E],
    ["second moment of area", I],
    ["area", A],
    ["yield strength", Fy],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (L <= 0) return { ok: false, error: "The length must be greater than zero." };
  if (E <= 0) return { ok: false, error: "Young's modulus must be greater than zero." };
  if (I <= 0) return { ok: false, error: "The second moment of area must be greater than zero." };
  if (A <= 0) return { ok: false, error: "The area must be greater than zero." };
  if (Fy < 0) return { ok: false, error: "The yield strength cannot be negative." };

  let K: number;
  if (inp.end === "custom") {
    const k = inp.kCustom;
    if (k === undefined || !Number.isFinite(k) || k <= 0) {
      return { ok: false, error: "A custom effective-length factor must be a positive number." };
    }
    K = k;
  } else {
    K = K_FACTORS[inp.end];
  }

  const Le = K * L;
  const r = Math.sqrt(I / A);
  const slenderness = Le / r;
  const pEuler = (Math.PI * Math.PI * E * I) / (Le * Le);
  const sigmaEuler = pEuler / A;
  // E*I is a product of a very large number and a very small one, and in the
  // wrong units it overflows: E in Pa with I in mm^4 is off by 10^12 and lands
  // outside double precision for a stiff section. An Infinity here would be
  // reported as a critical load, which is the most unconservative possible way
  // to be wrong. Caught by the adversarial pass.
  if (!Number.isFinite(pEuler) || !Number.isFinite(sigmaEuler) || !Number.isFinite(slenderness)) {
    return {
      ok: false,
      error:
        "The critical load overflowed double precision for these values. Check that E, I and A " +
        "are in consistent units — E in pascals with I in mm^4 is off by a factor of 10^12 and " +
        "is the usual cause.",
    };
  }

  const notes: string[] = [];
  notes.push(
    "I must be the value about the axis the column is weakest in — the SMALLER principal " +
      "second moment of area, unless that axis is separately braced.",
  );

  if (inp.end !== "custom" && inp.end !== "pinned") {
    notes.push(
      `K = ${K} is the theoretical value for ${inp.end} ends. Design codes use a larger ` +
        "value to allow for real end restraint being imperfect (AISC recommends 0.65 for " +
        "fixed-fixed and 0.80 for fixed-pinned).",
    );
  }

  let slendernessTransition: number | null = null;
  let pSquash: number | null = null;
  let pCritical = pEuler;
  let governs: "euler" | "johnson" | "euler-only" = "euler-only";

  if (Fy > 0) {
    slendernessTransition = Math.sqrt((2 * Math.PI * Math.PI * E) / Fy);
    pSquash = A * Fy;
    if (slenderness >= slendernessTransition) {
      governs = "euler";
      pCritical = pEuler;
    } else {
      governs = "johnson";
      const sigmaCr = Fy * (1 - (Fy * slenderness * slenderness) / (4 * Math.PI * Math.PI * E));
      pCritical = sigmaCr * A;
      notes.push(
        `The slenderness ${slenderness.toFixed(1)} is below the transition ` +
          `${slendernessTransition.toFixed(1)}, so this is an INTERMEDIATE or short column and ` +
          "the Euler load is not attainable — it would need a stress above yield. The Johnson " +
          "parabola governs and is the value reported as critical.",
      );
    }
  } else {
    notes.push(
      "No yield strength was given, so only the Euler load is reported. For a short column " +
        "the Euler load is unreachable — the column yields first — and this figure would be " +
        "unconservative. Enter a yield strength to get the governing value.",
    );
  }

  if (slenderness < 10) {
    notes.push(
      `A slenderness of ${slenderness.toFixed(1)} is very low. This is a block rather than a ` +
        "column; buckling is not the relevant failure mode and the compressive strength of the " +
        "material governs.",
    );
  }

  return {
    ok: true,
    K,
    Le,
    r,
    slenderness,
    pEuler,
    sigmaEuler,
    slendernessTransition,
    pSquash,
    pCritical,
    governs,
    notes,
  };
}
