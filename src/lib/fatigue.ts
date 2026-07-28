// Fatigue and machine design — endurance limit, mean-stress criteria, finite
// life and cumulative damage.
//
// THIS IS THE MOST OVER-TRUSTED CALCULATION IN MECHANICAL ENGINEERING, and the
// module is written accordingly. Fatigue life scatter is ENORMOUS: identical
// specimens from the same bar, tested on the same machine, routinely differ by
// a factor of three in life, and a factor of ten is not remarkable. A computed
// life of 10^6 cycles does not mean 10^6 cycles; it means "somewhere around
// 10^6, probably", and every result here says so. Reporting a fatigue life to
// three significant figures is not precision, it is a category error.
//
// THE ENDURANCE LIMIT DOES NOT EXIST FOR MOST MATERIALS. Steels (and some
// titanium alloys) have a genuine knee in the S-N curve below which they
// survive indefinitely. ALUMINIUM, COPPER, MAGNESIUM and most other non-ferrous
// alloys DO NOT — their S-N curve keeps falling for ever, so there is no stress
// below which the part is safe, and "design for infinite life" is not available
// at any stress. Aluminium is usually quoted with a "fatigue strength at 5x10^8
// cycles" instead, which is a different quantity with a different meaning, and
// treating it as an endurance limit is a real and common design error. The
// caller states the material class and a non-ferrous one is told this.
//
// NO MATERIAL STRENGTH TABLE IS BUILT IN, for the same reason there are no
// steam tables in thermo.ts: Sut and Sy are on the drawing or the material
// certificate, and they move by a FACTOR OF THREE with heat treatment for the
// same alloy designation — 4340 spans roughly 750 to 1980 MPa. A table of
// "typical" values would be plausible, unverifiable, and wrong for the specific
// piece of steel in front of the reader. They are asked for instead.
//
// GOODMAN ALONE CAN PASS A PART THAT YIELDS ON THE FIRST CYCLE. The fatigue
// criteria describe crack initiation over many cycles; none of them knows about
// static yield. A state with a high mean stress can sit inside the Goodman line
// and still be above the yield line, so the LANGER static-yield check is
// computed alongside every criterion and the GOVERNING (smaller) factor of
// safety is the one reported.

import { normalCdf } from "./stats2";

export interface FatigueError {
  ok: false;
  error: string;
}

export type MaterialClass = "steel" | "non-ferrous";
export type LoadKind = "bending" | "axial" | "torsion";
export type SurfaceFinish = "ground" | "machined" | "hot-rolled" | "as-forged";

/**
 * Surface-finish coefficients for ka = a * Sut^b with Sut in MPa.
 *
 * These are the standard Marin surface factors. Surface finish is the single
 * largest of the modifying factors and the one most often skipped: an as-forged
 * surface can more than HALVE the endurance limit of the same steel that would
 * be fine ground. It is not a refinement, it is a first-order effect.
 */
export const SURFACE_FACTORS: Record<SurfaceFinish, { a: number; b: number; label: string }> = {
  ground: { a: 1.58, b: -0.085, label: "Ground" },
  machined: { a: 4.51, b: -0.265, label: "Machined or cold-drawn" },
  "hot-rolled": { a: 57.7, b: -0.718, label: "Hot-rolled" },
  "as-forged": { a: 272, b: -0.995, label: "As-forged" },
};

/**
 * The standard-normal variate for a given reliability, by bisection on the CDF.
 *
 * DERIVED RATHER THAN TABULATED. The reliability factor is DEFINED as
 * ke = 1 - 0.08*z_a, so tabulating ke at 90/95/99/99.9% — as most textbooks do —
 * is just that formula evaluated at five points, and it forces the reader to
 * pick one of five reliabilities instead of the one their application needs.
 * Inverting the CDF gives any reliability and cannot disagree with the table.
 *
 * Bisection rather than a rational approximation: the bracket is fixed, the
 * iteration count is fixed, and it reuses the erf already in stats2.ts rather
 * than adding a second approximation that could drift from the first.
 */
export function normalVariate(reliability: number): number | null {
  if (!Number.isFinite(reliability) || reliability <= 0 || reliability >= 1) return null;
  let lo = -10;
  let hi = 10;
  // 200 halvings is far beyond double precision on this bracket; a fixed bound
  // rather than a tolerance loop, because this runs on every keystroke.
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < reliability) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Endurance limit
// ---------------------------------------------------------------------------

export interface EnduranceInput {
  /** Ultimate tensile strength, MPa. */
  sut: number;
  materialClass: MaterialClass;
  surface: SurfaceFinish;
  /** Diameter or equivalent dimension, mm. Ignored for axial loading. */
  diameter: number;
  load: LoadKind;
  /** Operating temperature, degrees C. */
  tempC: number;
  /** Reliability, 0 to 1 exclusive. */
  reliability: number;
}

export interface EnduranceResult {
  ok: true;
  /** Uncorrected rotating-beam endurance limit, MPa. */
  sePrime: number;
  ka: number;
  kb: number;
  kc: number;
  kd: number;
  ke: number;
  /** Corrected endurance limit, MPa. */
  se: number;
  notes: string[];
}

/**
 * The corrected endurance limit by the Marin factor method.
 *
 * EVERY FACTOR IS AN EMPIRICAL FIT with its own scatter, and multiplying five
 * of them together multiplies five uncertainties. The result is a design
 * estimate, not a material property, and the product of the factors is reported
 * so the reader can see which one is doing the damage — it is almost always the
 * surface finish.
 */
export function enduranceLimit(inp: EnduranceInput): EnduranceResult | FatigueError {
  const { sut, diameter, tempC, reliability } = inp;
  if (!Number.isFinite(sut) || sut <= 0) return { ok: false, error: "The ultimate tensile strength must be greater than zero." };
  if (!Number.isFinite(diameter) || diameter <= 0) return { ok: false, error: "The diameter must be greater than zero." };
  if (!Number.isFinite(tempC)) return { ok: false, error: "The temperature must be a finite number." };

  const notes: string[] = [];

  // Uncorrected endurance limit.
  let sePrime: number;
  if (inp.materialClass === "steel") {
    sePrime = sut <= 1400 ? 0.5 * sut : 700;
    if (sut > 1400) {
      notes.push(
        "Above about 1400 MPa the endurance limit of steel stops rising with tensile strength and " +
          "plateaus near 700 MPa. Making the steel harder past that point buys static strength and " +
          "NO fatigue strength — and usually costs toughness.",
      );
    }
  } else {
    // Non-ferrous alloys have no endurance limit at all.
    sePrime = 0.4 * sut;
    notes.push(
      "THIS MATERIAL HAS NO TRUE ENDURANCE LIMIT. Aluminium, copper, magnesium and most other " +
        "non-ferrous alloys keep failing at ever-lower stresses — the S-N curve never flattens — so " +
        "there is NO stress below which the part is safe indefinitely, and infinite-life design is " +
        "not available at any stress. The figure used here stands in for a fatigue strength quoted " +
        "at about 5x10^8 cycles; treat every result below as a FINITE-LIFE estimate at that " +
        "endurance, never as a guarantee of survival.",
    );
  }

  // ka — surface.
  const sf = SURFACE_FACTORS[inp.surface] ?? SURFACE_FACTORS.machined;
  let ka = sf.a * Math.pow(sut, sf.b);
  if (ka > 1) ka = 1;

  // kb — size. Axial loading has no size effect, because there is no gradient.
  let kb: number;
  if (inp.load === "axial") {
    kb = 1;
    notes.push(
      "Axial loading has no size factor: the size effect comes from the stress GRADIENT across a " +
        "bent or twisted section, and an axially loaded bar has none. It does get a smaller load " +
        "factor instead, because the whole section sees the peak stress at once.",
    );
  } else if (diameter < 2.79) {
    kb = 1;
    notes.push("Below about 2.8 mm the size factor is taken as 1; the fits are not defined smaller than that.");
  } else if (diameter <= 51) {
    kb = 1.24 * Math.pow(diameter, -0.107);
  } else if (diameter <= 254) {
    kb = 1.51 * Math.pow(diameter, -0.157);
  } else {
    kb = 1.51 * Math.pow(254, -0.157);
    notes.push(
      `The size factor fit stops at 254 mm; the value at 254 mm has been held for this ${diameter} mm ` +
        "section, which is optimistic. Large forgings are usually treated with test data rather than " +
        "a size factor.",
    );
  }

  // A SIZE FACTOR ABOVE 1 IS REAL, NOT A BUG. The fit is normalised at the
  // 7.62 mm rotating-beam specimen the endurance data came from, so a section
  // SMALLER than that genuinely does better — less material, less chance of
  // containing the flaw that starts the crack. It is left as the method gives
  // it rather than clamped, because clamping would invent a conservatism the
  // method does not have; but it is explained, because a factor above 1 looks
  // like an error. Surfaced by the adversarial pass asserting se <= Se'.
  if (kb > 1) {
    notes.push(
      `The size factor is ${kb.toFixed(3)}, ABOVE 1. That is correct rather than a fault: the fit ` +
        "is normalised at the 7.62 mm rotating-beam specimen the endurance data was measured on, " +
        "and a smaller section really does have a higher endurance limit, because there is less " +
        "material to contain the flaw that starts the crack. It does mean the corrected limit here " +
        "is above the uncorrected one.",
    );
  }

  // kc — load.
  const kc = inp.load === "bending" ? 1 : inp.load === "axial" ? 0.85 : 0.59;

  // kd — temperature.
  let kd = 1;
  if (tempC > 450) {
    return {
      ok: false,
      error:
        `At ${tempC} °C the failure mode is CREEP rather than fatigue, and none of the room-temperature ` +
        "fatigue methods here apply. Steel loses strength rapidly above about 450 °C and time-dependent " +
        "deformation dominates; this needs creep data, not an S-N curve.",
    };
  }
  if (tempC > 20) {
    // The standard linear-ish derating for steel between room temperature and 450 C.
    kd = 1 - 0.0006 * (tempC - 20);
    if (kd < 0.5) kd = 0.5;
    notes.push(
      `Temperature factor ${kd.toFixed(3)} for ${tempC} °C. Above about 250 °C also check that the ` +
        "material is not losing strength faster than this linear derating suggests.",
    );
  }
  if (tempC < -50) {
    notes.push(
      "Below about -50 °C many steels become BRITTLE, and the governing failure mode changes from " +
        "fatigue crack growth to fast fracture. Check the material's transition temperature; a " +
        "fatigue calculation is not the relevant one if the steel is below it.",
    );
  }

  // ke — reliability, from the definition rather than a five-row table.
  const z = normalVariate(reliability);
  if (z === null) return { ok: false, error: "The reliability must be strictly between 0 and 1." };
  let ke = 1 - 0.08 * z;
  if (ke <= 0) return { ok: false, error: "That reliability is too high for this method to give a meaningful factor." };
  if (reliability < 0.5) {
    notes.push(
      `A reliability below 50% gives a factor above 1, which raises the endurance limit. That is ` +
        "arithmetically consistent and almost never what anyone wants — check the value.",
    );
  }

  const se = sePrime * ka * kb * kc * kd * ke;

  // Name the factor doing the most damage, which is the actionable information.
  const factors: [string, number][] = [
    ["surface finish", ka],
    ["size", kb],
    ["load type", kc],
    ["temperature", kd],
    ["reliability", ke],
  ];
  const worst = factors.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (worst[1] < 0.9) {
    notes.push(
      `The ${worst[0]} factor (${worst[1].toFixed(3)}) is the largest single reduction. The combined ` +
        `factors take the endurance limit from ${sePrime.toFixed(0)} to ${se.toFixed(0)} MPa, a ` +
        `reduction of ${((1 - se / sePrime) * 100).toFixed(0)}%.`,
    );
  }
  notes.push(
    "Every Marin factor is an empirical fit with its own scatter, and five of them multiply. This " +
      "is a design estimate, not a material property.",
  );

  return { ok: true, sePrime, ka, kb, kc, kd, ke, se, notes };
}

// ---------------------------------------------------------------------------
// Notch sensitivity
// ---------------------------------------------------------------------------

export interface NotchResult {
  ok: true;
  kt: number;
  q: number;
  kf: number;
  notes: string[];
}

/**
 * The fatigue stress-concentration factor, Kf = 1 + q(Kt - 1).
 *
 * NOTCH SENSITIVITY q IS ASKED FOR, NOT ESTIMATED. The usual route is Neuber's
 * constant, which is read off a curve fitted per material class and notch
 * radius; reproducing that fit from memory would put an unverifiable number at
 * the centre of a safety calculation. The default of q = 1 gives Kf = Kt, which
 * is the CONSERVATIVE assumption (a fully notch-sensitive material), and real
 * steels sit between about 0.6 and 0.9 with q rising as the material gets
 * stronger and the notch gets sharper.
 */
export function notchFactor(kt: number, q = 1): NotchResult | FatigueError {
  if (!Number.isFinite(kt) || kt < 1) {
    return { ok: false, error: "The stress-concentration factor Kt must be at least 1 — a notch cannot reduce stress." };
  }
  if (!Number.isFinite(q) || q < 0 || q > 1) {
    return { ok: false, error: "Notch sensitivity q must be between 0 and 1." };
  }
  const kf = 1 + q * (kt - 1);
  const notes: string[] = [];
  if (q === 1) {
    notes.push(
      "q = 1 means fully notch-sensitive, so Kf = Kt. That is the CONSERVATIVE assumption and the " +
        "right default; real steels are usually 0.6 to 0.9, and using a measured q reduces Kf and " +
        "so increases the computed life.",
    );
  }
  notes.push(
    "Kf multiplies the ALTERNATING stress. Whether it also multiplies the mean stress depends on " +
      "whether the notch root yields: if it does, local plasticity relieves the mean stress and Kf " +
      "is applied to the alternating component only. Applying it to both is conservative.",
  );
  if (kt > 3) {
    notes.push(
      `A Kt of ${kt} is severe. Fatigue cracks start at stress concentrations in the overwhelming ` +
        "majority of real failures, so a generous fillet radius is usually worth far more than a " +
        "stronger material.",
    );
  }
  return { ok: true, kt, q, kf, notes };
}

// ---------------------------------------------------------------------------
// Mean stress criteria
// ---------------------------------------------------------------------------

export type Criterion = "goodman" | "soderberg" | "gerber" | "asme-elliptic";

export interface MeanStressResult {
  ok: true;
  /** Factor of safety against fatigue by the chosen criterion. */
  nFatigue: number;
  /** Factor of safety against first-cycle yielding (the Langer line). */
  nYield: number;
  /** The smaller of the two — the one that actually governs. */
  nGoverning: number;
  governedBy: "fatigue" | "first-cycle yield";
  criterion: Criterion;
  /** All four criteria, for comparison. */
  comparison: { criterion: Criterion; n: number }[];
  notes: string[];
}

/**
 * Factor of safety under a mean plus alternating stress.
 *
 * ALL FOUR CRITERIA ARE COMPUTED AND SHOWN, not just the chosen one, because
 * they disagree by a lot and the reader should see the spread rather than the
 * single number their textbook happens to use. Soderberg is the most
 * conservative (it uses yield rather than ultimate), Gerber the least, and
 * Goodman sits between and is what most codes assume.
 *
 * THE LANGER YIELD LINE IS ALWAYS CHECKED. None of the fatigue criteria knows
 * about static yield, so a state with a large mean stress can sit safely inside
 * the Goodman line and still yield on the very first application of load. The
 * governing factor of safety is the smaller of the two, and which one governs is
 * reported.
 *
 * A COMPRESSIVE MEAN STRESS IS TREATED AS ZERO, not as a negative. Compressive
 * mean stress does not accelerate fatigue — it closes cracks and is beneficial,
 * which is the entire point of shot peening — and feeding a negative mean stress
 * into Goodman produces a factor of safety above the fully reversed one, which
 * overstates the benefit. Setting it to zero is the standard conservative
 * treatment.
 */
export function meanStressAnalysis(
  sigmaA: number,
  sigmaM: number,
  se: number,
  sut: number,
  sy: number,
  criterion: Criterion = "goodman",
): MeanStressResult | FatigueError {
  for (const [name, v] of [
    ["alternating stress", sigmaA],
    ["mean stress", sigmaM],
    ["endurance limit", se],
    ["ultimate strength", sut],
    ["yield strength", sy],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (sigmaA < 0) return { ok: false, error: "The alternating stress is an amplitude and cannot be negative." };
  if (se <= 0) return { ok: false, error: "The endurance limit must be greater than zero." };
  if (sut <= 0) return { ok: false, error: "The ultimate strength must be greater than zero." };
  if (sy <= 0) return { ok: false, error: "The yield strength must be greater than zero." };
  if (sy > sut) return { ok: false, error: "The yield strength is above the ultimate strength, which cannot be." };
  if (sigmaA === 0 && sigmaM === 0) {
    return { ok: false, error: "Both stresses are zero, so there is nothing to assess." };
  }

  const notes: string[] = [];
  let sm = sigmaM;
  if (sigmaM < 0) {
    sm = 0;
    notes.push(
      "The mean stress is COMPRESSIVE and has been treated as zero. Compressive mean stress does " +
        "not accelerate fatigue — it holds cracks closed, which is exactly why shot peening and " +
        "case hardening work — and putting a negative mean into these criteria would overstate the " +
        "benefit rather than merely ignore it.",
    );
  }

  const compute = (c: Criterion): number => {
    if (sigmaA === 0) {
      // Pure static load: the fatigue criteria reduce to a static check.
      return c === "soderberg" || c === "asme-elliptic" ? sy / sm : sut / sm;
    }
    switch (c) {
      case "goodman":
        return 1 / (sigmaA / se + sm / sut);
      case "soderberg":
        return 1 / (sigmaA / se + sm / sy);
      case "gerber": {
        if (sm === 0) return se / sigmaA;
        // n from n*sa/Se + (n*sm/Sut)^2 = 1, the positive root.
        const A = (sm / sut) ** 2;
        const B = sigmaA / se;
        return (-B + Math.sqrt(B * B + 4 * A)) / (2 * A);
      }
      case "asme-elliptic":
        return 1 / Math.sqrt((sigmaA / se) ** 2 + (sm / sy) ** 2);
    }
  };

  const comparison: { criterion: Criterion; n: number }[] = (
    ["goodman", "soderberg", "gerber", "asme-elliptic"] as Criterion[]
  ).map((c) => ({ criterion: c, n: compute(c) }));

  const nFatigue = compute(criterion);
  // Langer static yield line: sa + sm = Sy/n.
  const nYield = sy / (sigmaA + Math.abs(sigmaM));
  const nGoverning = Math.min(nFatigue, nYield);
  const governedBy = nYield < nFatigue ? "first-cycle yield" : "fatigue";

  if (!Number.isFinite(nFatigue)) {
    notes.push(
      "There is NO FATIGUE LOADING here: the alternating stress is zero and the mean stress is " +
        "not tensile, so no crack can be driven and the fatigue factor of safety is unbounded. " +
        "Only the static yield check below means anything for this state.",
    );
  }

  if (governedBy === "first-cycle yield") {
    notes.push(
      `FIRST-CYCLE YIELD GOVERNS, not fatigue: the static factor of safety ${nYield.toFixed(2)} is ` +
        `below the fatigue factor ${nFatigue.toFixed(2)}. This part yields on the very first ` +
        "application of load, before fatigue has any opportunity to matter — and none of the " +
        "fatigue criteria would have told you, because they do not know about yield.",
    );
  }
  if (nGoverning < 1) {
    notes.push(
      `A factor of safety below 1 means this part is predicted to FAIL as loaded, not merely to be ` +
        "marginal.",
    );
  }
  const spread = Math.max(...comparison.map((c) => c.n)) / Math.min(...comparison.map((c) => c.n));
  if (spread > 1.3) {
    notes.push(
      `The four criteria span a factor of ${spread.toFixed(2)} on this state. That spread is the ` +
        "honest uncertainty in the method, not a reason to pick the most favourable one — use " +
        "whichever your design code names, and Goodman if none does.",
    );
  }
  notes.push(
    "Fatigue life scatter is large: identical specimens differ by a factor of three routinely. A " +
      "factor of safety near 1 on a fatigue criterion is not a small margin, it is no margin.",
  );

  return { ok: true, nFatigue, nYield, nGoverning, governedBy, criterion, comparison, notes };
}

// ---------------------------------------------------------------------------
// Finite life and cumulative damage
// ---------------------------------------------------------------------------

export interface FiniteLifeResult {
  ok: true;
  /** Cycles to failure. */
  cycles: number;
  /** Coefficients of S = a*N^b. */
  a: number;
  b: number;
  infiniteLife: boolean;
  notes: string[];
}

/**
 * Cycles to failure from the S-N line, built between 0.9*Sut at 10^3 cycles and
 * Se at 10^6 cycles on log-log axes.
 *
 * BELOW Se A STEEL HAS INFINITE LIFE AND A NON-FERROUS ALLOY DOES NOT. For a
 * steel the S-N curve genuinely flattens, so a stress below the corrected
 * endurance limit gives unlimited life and the function says so. For anything
 * else the curve keeps falling and there is no such stress; the caller is told
 * rather than being handed an "infinite" that does not exist.
 */
export function finiteLife(
  sigmaA: number,
  se: number,
  sut: number,
  materialClass: MaterialClass = "steel",
): FiniteLifeResult | FatigueError {
  if (!Number.isFinite(sigmaA) || sigmaA <= 0) return { ok: false, error: "The alternating stress must be greater than zero." };
  if (!Number.isFinite(se) || se <= 0) return { ok: false, error: "The endurance limit must be greater than zero." };
  if (!Number.isFinite(sut) || sut <= 0) return { ok: false, error: "The ultimate strength must be greater than zero." };
  if (se >= 0.9 * sut) {
    return {
      ok: false,
      error:
        "The endurance limit is at or above 0.9 x the ultimate strength, so the S-N line has no " +
        "slope and finite life cannot be computed. Check that the endurance limit is the CORRECTED " +
        "value, after the Marin factors, rather than the uncorrected 0.5 x Sut.",
    };
  }

  const notes: string[] = [];
  const s1000 = 0.9 * sut;
  const b = -Math.log10(s1000 / se) / 3;
  const a = s1000 / Math.pow(1000, b);

  if (sigmaA <= se) {
    if (materialClass === "steel") {
      return {
        ok: true,
        cycles: Infinity,
        a,
        b,
        infiniteLife: true,
        notes: [
          "The alternating stress is at or below the corrected endurance limit, so a steel has " +
            "INFINITE life here — the S-N curve genuinely flattens and the part survives " +
            "indefinitely, provided nothing changes: corrosion, fretting or an overload that " +
            "starts a crack all remove the endurance limit entirely.",
        ],
      };
    }
    notes.push(
      "The stress is below the quoted endurance figure, but THIS MATERIAL HAS NO ENDURANCE LIMIT — " +
        "its S-N curve keeps falling, so there is no infinite life at any stress. The life below is " +
        "extrapolated past the point the S-N line was fitted over and should be treated as " +
        "indicative only.",
    );
  }

  if (sigmaA > s1000) {
    notes.push(
      `The alternating stress exceeds 0.9 x Sut, which is where the S-N line starts at 10^3 cycles. ` +
        "This is LOW-CYCLE fatigue, where the part is yielding every cycle and life is governed by " +
        "strain rather than stress. A stress-life calculation does not apply below about 1000 " +
        "cycles; a strain-life (Coffin-Manson) analysis does.",
    );
  }

  const cycles = Math.pow(sigmaA / a, 1 / b);
  notes.push(
    "Fatigue life scatter is a factor of three or more between identical specimens. Read this as " +
      "an order of magnitude, not as a number of cycles — quoting it to three significant figures " +
      "is a category error.",
  );

  return { ok: true, cycles, a, b, infiniteLife: false, notes };
}

export interface DamageBlock {
  /** Alternating stress of this block, MPa. */
  sigmaA: number;
  /** Cycles applied at that stress. */
  cycles: number;
}

export interface MinerResult {
  ok: true;
  blocks: { sigmaA: number; applied: number; allowable: number; damage: number }[];
  /** Total damage; failure is nominally at 1. */
  damage: number;
  /** How many times the whole spectrum can be repeated. */
  repeats: number;
  notes: string[];
}

/**
 * Cumulative damage by Palmgren-Miner, D = sum(n_i / N_i), with failure at
 * D = 1.
 *
 * MINER'S RULE IGNORES THE ORDER OF THE LOADS, and that is not a small
 * approximation. A large overload early can start a crack that a later small
 * load would never have started, and it can also introduce a compressive
 * residual stress at a notch that RETARDS subsequent growth. Observed damage
 * sums at failure scatter between roughly 0.3 and 3 rather than landing on 1 —
 * so a Miner sum of 0.9 is not a pass and a sum of 1.1 is not a certainty. It
 * remains the standard method because nothing simple does better, not because
 * it is accurate.
 */
export function minerDamage(
  blocks: DamageBlock[],
  se: number,
  sut: number,
  materialClass: MaterialClass = "steel",
): MinerResult | FatigueError {
  if (!blocks.length) return { ok: false, error: "Give at least one load block." };
  if (blocks.length > 200) return { ok: false, error: `Too many load blocks (${blocks.length}); the limit is 200.` };

  const out: { sigmaA: number; applied: number; allowable: number; damage: number }[] = [];
  let total = 0;
  const notes: string[] = [];
  let anyInfinite = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!Number.isFinite(b.sigmaA) || b.sigmaA <= 0) {
      return { ok: false, error: `Block ${i + 1}: the alternating stress must be greater than zero.` };
    }
    if (!Number.isFinite(b.cycles) || b.cycles < 0) {
      return { ok: false, error: `Block ${i + 1}: the cycle count cannot be negative.` };
    }
    const life = finiteLife(b.sigmaA, se, sut, materialClass);
    if (!life.ok) return life;
    const allowable = life.cycles;
    const damage = allowable === Infinity ? 0 : b.cycles / allowable;
    if (allowable === Infinity) anyInfinite = true;
    out.push({ sigmaA: b.sigmaA, applied: b.cycles, allowable, damage });
    total += damage;
  }

  if (anyInfinite) {
    notes.push(
      "One or more blocks are below the endurance limit and contribute NO damage in this model. " +
        "That is standard practice and it is optimistic: once a crack has been started by the " +
        "higher blocks, stresses below the endurance limit will grow it. If the spectrum contains " +
        "occasional large events, the small cycles are not free.",
    );
  }
  notes.push(
    "Miner's rule takes no account of the ORDER of the loads, and order matters: a large overload " +
      "early can start a crack that later small loads would not have, and can also leave a " +
      "compressive residual stress that retards growth. Observed damage sums at failure scatter " +
      "between about 0.3 and 3, so a sum of 0.9 is not a pass.",
  );
  if (total > 0.5 && total < 2) {
    notes.push(
      `A damage sum of ${total.toFixed(3)} is inside the band where the method cannot distinguish ` +
        "survival from failure. Treat it as close to the limit rather than as either answer.",
    );
  }

  return {
    ok: true,
    blocks: out,
    damage: total,
    repeats: total > 0 ? 1 / total : Infinity,
    notes,
  };
}
