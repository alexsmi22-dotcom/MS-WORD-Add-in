// Linear elastic fracture mechanics — the damage-tolerance half of fatigue.
//
// `fatigue.ts` is entirely S-N: it answers "how many cycles until a smooth part
// initiates a crack?". This answers the other half, which is the half that
// governs once a crack has been FOUND: given a flaw of this size, is the part
// safe now, and how long before it is not?
//
// FRACTURE IS A THRESHOLD, NOT A GRADUAL DEGRADATION. Stress intensity rises
// with the square root of crack length, so a flaw that is comfortably safe at
// one stress becomes catastrophic at a stress only modestly higher — and the
// failure is instantaneous when it comes. That is the opposite of the intuition
// S-N curves build, where damage accumulates smoothly, and it is why a
// found-crack assessment is a different calculation rather than a correction.
//
// MOST OF THE LIFE IS SPENT WHILE THE CRACK IS SMALL, FOR THE USUAL EXPONENT.
// Paris-law growth goes as (ΔK)^m and ΔK goes as √a, so for m above 2 the rate
// rises steeply as the crack lengthens and the final doubling takes almost no
// cycles at all. An inspection interval set from the total life is therefore
// worthless; it has to be set from the time between detectable and critical.
// Below m = 2 that is not true, and the tool says so instead — the claim is
// conditional on the exponent rather than a slogan.
//
// A THIN PLATE IS TOUGHER THAN A THICK ONE OF THE SAME MATERIAL. Plane strain
// suppresses through-thickness yielding and gives the lowest toughness, which
// is why K_IC is defined there and why the standards impose a minimum thickness
// before a measured toughness may be called K_IC at all. That check is applied
// here rather than assumed.
//
// K_IC, Y AND THE PARIS CONSTANTS ARE USER INPUTS. The geometry factor Y
// depends on the crack's shape and where it sits relative to the boundaries; C
// and m depend on the material, the environment and the stress ratio. Built-in
// tables would be wrong for every case except the one they were measured on —
// the same refusal as drag coefficients and emissivity elsewhere in this bench.
//
// Units are SI everywhere EXCEPT the Paris coefficient, and that exception is
// deliberate rather than sloppy. C is the coefficient of a power law, so it is
// meaningless without the units of its argument, and every published value is
// quoted for delta-K in MPa*sqrt(m) with da/dN in m/cycle. Demanding a
// converted C would guarantee that someone pastes a handbook number and gets a
// life wrong by 10^(6m) — a factor of 10^18 at m = 3. So C is taken exactly as
// published and the conversion happens inside. Everything else, stress
// intensity included, is in pascals.

export interface FractureError {
  ok: false;
  error: string;
}

const finite = (pairs: [string, number][]): FractureError | null => {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  return null;
};

const positive = (pairs: [string, number][]): FractureError | null => {
  const bad = finite(pairs);
  if (bad) return bad;
  for (const [name, v] of pairs) {
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
};

// ---------------------------------------------------------------------------
// 1. Stress intensity and the critical crack size
// ---------------------------------------------------------------------------

export interface StressIntensityInput {
  /** Remote (gross-section) stress, Pa. */
  stress: number;
  /** Crack length, m. Half-length for a central crack; full depth for an edge one. */
  crack: number;
  /** Geometry factor Y — dimensionless, and YOUR input. */
  Y: number;
  /** Plane-strain fracture toughness, Pa*sqrt(m). */
  kic: number;
  /** Yield strength, Pa — for the plastic-zone and thickness checks. */
  yieldStrength?: number;
  /** Section thickness, m — for the plane-strain validity check. */
  thickness?: number;
}

export interface StressIntensityResult {
  ok: true;
  /** Applied stress intensity, Pa*sqrt(m). */
  K: number;
  /** K / K_IC. At or above 1 the part fractures. */
  ratio: number;
  /** Factor of safety on stress at this crack size. */
  safetyOnStress: number;
  /** The crack size at which THIS stress becomes critical, m. */
  criticalCrack: number;
  /** The stress at which THIS crack becomes critical, Pa. */
  criticalStress: number;
  /** Plastic zone radius, m; null without a yield strength. */
  plasticZone: number | null;
  /** Minimum thickness for a valid plane-strain assessment, m; null without a yield strength. */
  thicknessRequired: number | null;
  /** True when the section is thick enough for plane strain to apply. */
  planeStrainValid: boolean | null;
  fractures: boolean;
  notes: string[];
}

/**
 * Stress intensity at a crack, and how much margin is left.
 *
 * THE CRITICAL CRACK SIZE IS THE USEFUL NUMBER, not the stress intensity
 * itself. K on its own is an abstraction; "this flaw becomes critical at 9.2 mm
 * and yours is 3 mm" is an inspection interval.
 */
export function stressIntensity(inp: StressIntensityInput): StressIntensityResult | FractureError {
  const bad = positive([
    ["crack length", inp.crack],
    ["geometry factor", inp.Y],
    ["fracture toughness", inp.kic],
  ]);
  if (bad) return bad;
  const f = finite([["stress", inp.stress]]);
  if (f) return f;
  if (inp.stress <= 0) {
    return {
      ok: false,
      error:
        "The stress must be greater than zero. A crack under pure compression does not open, so " +
        "linear elastic fracture mechanics has nothing to say about it.",
    };
  }

  const K = inp.Y * inp.stress * Math.sqrt(Math.PI * inp.crack);
  if (!Number.isFinite(K)) {
    return { ok: false, error: "Those inputs overflow the arithmetic. Check the magnitudes." };
  }
  const ratio = K / inp.kic;
  const criticalCrack = (1 / Math.PI) * Math.pow(inp.kic / (inp.Y * inp.stress), 2);
  const criticalStress = inp.kic / (inp.Y * Math.sqrt(Math.PI * inp.crack));
  // A vanishing stress or geometry factor sends the critical crack to infinity,
  // and the note then read "the crack becomes critical at Infinity mm" while
  // the pane fed that straight into an axis limit and emitted MNaN,NaN.
  if (![criticalCrack, criticalStress].every(Number.isFinite)) {
    return {
      ok: false,
      error:
        "Those inputs give no finite critical crack size - the stress or the geometry factor is " +
        "so small that no crack is ever critical. Check the magnitudes.",
    };
  }

  let plasticZone: number | null = null;
  let thicknessRequired: number | null = null;
  let planeStrainValid: boolean | null = null;
  const notes: string[] = [];

  if (inp.yieldStrength !== undefined) {
    if (!(inp.yieldStrength > 0) || !Number.isFinite(inp.yieldStrength)) {
      return { ok: false, error: "The yield strength must be greater than zero." };
    }
    // Plane-strain plastic zone radius.
    plasticZone = (1 / (6 * Math.PI)) * Math.pow(K / inp.yieldStrength, 2);
    // The standard 2.5(K_IC/sy)^2 size requirement. It is checked against the
    // THICKNESS only. The comment here used to claim crack and ligament too:
    // the crack is checked against a far looser plastic-zone criterion below,
    // and the ligament cannot be checked at all because this geometry has no
    // width input. Saying otherwise was a claim the code did not honour.
    thicknessRequired = 2.5 * Math.pow(inp.kic / inp.yieldStrength, 2);
    if (![plasticZone, thicknessRequired].every(Number.isFinite)) {
      return {
        ok: false,
        error:
          "Those inputs overflow the plane-strain checks. Check the toughness and yield strength.",
      };
    }
    if (inp.thickness !== undefined) {
      if (!(inp.thickness > 0) || !Number.isFinite(inp.thickness)) {
        return { ok: false, error: "The thickness must be greater than zero." };
      }
      planeStrainValid = inp.thickness >= thicknessRequired;
    }
    // NET-SECTION YIELD FIRST. The plastic-zone test below reduces to a
    // condition on stress alone, and it let a part loaded at 800 MPa against a
    // 500 MPa yield through with "safety on stress 2.58" and no mention of
    // yielding. A section stressed past its yield strength has already failed
    // by a mechanism this tool does not model, and LEFM assumes the body is
    // elastic away from the tip.
    if (inp.stress >= inp.yieldStrength) {
      return {
        ok: false,
        error:
          `The applied stress (${(inp.stress / 1e6).toPrecision(4)} MPa) is at or above the yield ` +
          `strength (${(inp.yieldStrength / 1e6).toPrecision(4)} MPa), so the section has yielded ` +
          "through. Linear elastic fracture mechanics assumes the body is elastic away from the " +
          "crack tip, and a factor of safety against fracture would be meaningless here - the " +
          "part has already failed by a mechanism this tool does not model.",
      };
    }
    // LEFM needs the plastic zone to be small compared with the crack.
    if (plasticZone > inp.crack * 0.5) {
      return {
        ok: false,
        error:
          `The plastic zone (${plasticZone.toPrecision(3)} m) is not small compared with the crack ` +
          `(${inp.crack.toPrecision(3)} m), so LINEAR ELASTIC fracture mechanics does not apply ` +
          "here - the assumption underneath every formula in this tool is that yielding is " +
          "confined to a small region at the tip. This case needs an elastic-plastic method " +
          "(J-integral or CTOD). Refused rather than caveated, because the number would be wrong " +
          "rather than imprecise.",
      };
    }
  }

  notes.push(
    "K = Y·σ·√(πa). Stress intensity rises with the SQUARE ROOT of crack length, so FRACTURE IS " +
      "A THRESHOLD rather than a gradual degradation: a flaw comfortably safe at one stress is " +
      "catastrophic at a stress only modestly higher, and the failure is instantaneous.",
    `At this stress the crack becomes critical at ${(criticalCrack * 1000).toPrecision(4)} mm; ` +
      `yours is ${(inp.crack * 1000).toPrecision(4)} mm. At this crack size the critical stress is ` +
      `${(criticalStress / 1e6).toPrecision(4)} MPa.`,
    "Y is YOUR input. It depends on the crack's shape and its position relative to the " +
      "boundaries - about 1.12 for an edge crack in a wide plate, 1.0 for a central through " +
      "crack, and a function of a/W once the crack is a significant fraction of the width. A " +
      "handbook solution for the actual geometry is not optional.",
  );
  if (ratio >= 1) {
    notes.push(
      `K/K_IC = ${ratio.toPrecision(3)} IS AT OR ABOVE 1: this part fractures at this stress with ` +
        "this flaw. There is no margin to consume.",
    );
  }
  if (planeStrainValid === false && thicknessRequired !== null) {
    notes.push(
      `The section (${((inp.thickness as number) * 1000).toPrecision(3)} mm) is thinner than the ` +
        `${(thicknessRequired * 1000).toPrecision(3)} mm plane-strain requirement, so a K_IC ` +
        "assessment is CONSERVATIVE here: A THIN PLATE IS TOUGHER THAN A THICK ONE of the same " +
        "material, because plane stress permits through-thickness yielding that plane strain " +
        "suppresses. The real toughness is higher than K_IC and the real margin larger.",
    );
  } else if (planeStrainValid === true) {
    notes.push(
      "The section is thick enough for plane strain, so K_IC is the appropriate toughness and " +
        "this assessment is not conservative on that account.",
    );
  }
  if (plasticZone !== null) {
    notes.push(
      `The plastic zone radius is ${(plasticZone * 1000).toPrecision(3)} mm against a crack of ` +
        `${(inp.crack * 1000).toPrecision(3)} mm. LEFM needs that to stay small; this tool refuses ` +
        "rather than reporting a number once it is not.",
    );
  }

  return {
    ok: true,
    K,
    ratio,
    safetyOnStress: criticalStress / inp.stress,
    criticalCrack,
    criticalStress,
    plasticZone,
    thicknessRequired,
    planeStrainValid,
    fractures: ratio >= 1,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 2. Paris-law crack growth
// ---------------------------------------------------------------------------

export interface ParisInput {
  /** Initial crack length, m. */
  initialCrack: number;
  /** Stress range, Pa. */
  stressRange: number;
  /** Geometry factor Y. */
  Y: number;
  /**
   * Paris coefficient C, giving da/dN in METRES PER CYCLE when ΔK is in
   * MPa·√m.
   *
   * THAT UNIT PAIRING IS NOT A CHOICE, IT IS THE ONE EVERY SOURCE USES. C is
   * only meaningful alongside the units of ΔK, because it is the coefficient of
   * a power law: feeding a handbook C (about 6.9e-12 for ferritic steel) a ΔK
   * in pascals rather than megapascals inflates the growth rate by 10^(6m) —
   * a factor of 10^18 at m = 3, which turns a 180,000-cycle life into 1.8e-13
   * cycles. The first draft of this module documented SI and would have done
   * exactly that. ΔK is therefore converted to MPa·√m internally, and the
   * reported ΔK values stay in pascals so they agree with the rest of the tool.
   */
  C: number;
  /** Paris exponent m, typically 3 to 4. */
  m: number;
  /** Fracture toughness, Pa*sqrt(m) — sets the final crack size. */
  kic: number;
  /** Threshold stress intensity range below which the crack does not grow. */
  deltaKth?: number;
}

export interface ParisResult {
  ok: true;
  /** Crack size at which fast fracture takes over, m. */
  finalCrack: number;
  /** Cycles from the initial size to that final size. */
  cycles: number;
  /** Initial and final stress intensity range, Pa*sqrt(m). */
  deltaKInitial: number;
  deltaKFinal: number;
  /** Growth rate at the start and end, m/cycle. */
  rateInitial: number;
  rateFinal: number;
  /**
   * Cycles to reach twice the initial crack length — null when the crack
   * reaches its critical size before it can double, which is an ordinary
   * outcome for a large starting flaw.
   */
  cyclesToDouble: number | null;
  /** Fraction of the total life spent in that first doubling; null likewise. */
  firstDoublingFraction: number | null;
  /** Sampled crack length against cycles, for plotting. */
  curve: { n: number; a: number }[];
  notes: string[];
}

/**
 * Cycles to grow a crack from a found size to fast fracture.
 *
 * INTEGRATED IN CLOSED FORM WHERE ONE EXISTS. With Y taken as constant,
 * da/dN = C(YΔσ√(πa))^m separates, and for m ≠ 2 the integral is elementary.
 * That is exact for the model rather than a numerical approximation of it — and
 * the m = 2 case is a logarithm, taken explicitly rather than dividing by zero.
 *
 * TREATING Y AS CONSTANT IS THE MODEL'S REAL LIMIT, not the arithmetic. Y grows
 * as the crack approaches a boundary, so a long crack grows faster than this
 * predicts and the answer is optimistic near the end of life.
 */
export function parisGrowth(inp: ParisInput): ParisResult | FractureError {
  const bad = positive([
    ["initial crack length", inp.initialCrack],
    ["stress range", inp.stressRange],
    ["geometry factor", inp.Y],
    ["Paris coefficient", inp.C],
    ["Paris exponent", inp.m],
    ["fracture toughness", inp.kic],
  ]);
  if (bad) return bad;
  if (inp.m > 8) {
    return { ok: false, error: `A Paris exponent of ${inp.m} is outside any measured range; 3 to 4 is typical.` };
  }

  const dkOf = (a: number): number => inp.Y * inp.stressRange * Math.sqrt(Math.PI * a);
  // Fast fracture takes over where the peak K reaches toughness. Using the
  // stress RANGE here is the conservative reading for fully reversed loading;
  // for a positive stress ratio the peak is higher and the final crack smaller.
  const finalCrack = (1 / Math.PI) * Math.pow(inp.kic / (inp.Y * inp.stressRange), 2);
  if (!Number.isFinite(finalCrack) || finalCrack <= 0) {
    return { ok: false, error: "Those inputs give no finite critical crack size." };
  }
  if (finalCrack <= inp.initialCrack) {
    return {
      ok: false,
      error:
        `The crack is ALREADY at or past the critical size for this stress range ` +
        `(${(finalCrack * 1000).toPrecision(3)} mm). There is no remaining life to compute: this ` +
        "part fractures on the next cycle.",
    };
  }

  const dkInit = dkOf(inp.initialCrack);
  if (inp.deltaKth !== undefined) {
    if (!Number.isFinite(inp.deltaKth) || inp.deltaKth < 0) {
      return { ok: false, error: "The threshold stress-intensity range cannot be negative." };
    }
    if (dkInit < inp.deltaKth) {
      return {
        ok: false,
        error:
          `The initial ΔK (${(dkInit / 1e6).toPrecision(3)} MPa√m) is BELOW the threshold ` +
          `(${(inp.deltaKth / 1e6).toPrecision(3)} MPa√m), so this crack does not grow at all ` +
          "under this loading. That is an answer, not a failure - it is the basis of damage-" +
          "tolerant design, and the remaining life is unlimited for as long as the loading holds.",
      };
    }
  }

  // N = integral from a0 to af of da / (C (Y ds sqrt(pi a))^m)
  //   = [a^(1 - m/2)] / (C (Y ds sqrt(pi))^m (1 - m/2))   for m != 2
  //
  // The stress range is divided by 1e6 so that delta-K enters in MPa*sqrt(m),
  // which is the unit every published C is quoted against. See the note on C.
  const B = inp.C * Math.pow((inp.Y * inp.stressRange * Math.sqrt(Math.PI)) / 1e6, inp.m);
  const cyclesBetween = (a0: number, a1: number): number => {
    if (Math.abs(inp.m - 2) < 1e-12) return Math.log(a1 / a0) / B;
    const p = 1 - inp.m / 2;
    return (Math.pow(a1, p) - Math.pow(a0, p)) / (B * p);
  };
  const cycles = cyclesBetween(inp.initialCrack, finalCrack);
  if (!Number.isFinite(cycles) || cycles <= 0) {
    return { ok: false, error: "Those inputs give no finite crack-growth life. Check C, m and the stress range." };
  }
  // The crack cannot always double before it fractures. Clamping to the final
  // size and still calling the result "the first doubling" reported the WHOLE
  // life to failure as 100% of a doubling that never happens.
  const canDouble = finalCrack > inp.initialCrack * 2;
  const cyclesToDouble = canDouble ? cyclesBetween(inp.initialCrack, inp.initialCrack * 2) : null;

  // Crack length against cycles, inverted from the same closed form.
  const curve: { n: number; a: number }[] = [];
  for (let i = 0; i <= 80; i++) {
    const n = (cycles * i) / 80;
    let a: number;
    if (Math.abs(inp.m - 2) < 1e-12) {
      a = inp.initialCrack * Math.exp(B * n);
    } else {
      const p = 1 - inp.m / 2;
      a = Math.pow(Math.pow(inp.initialCrack, p) + B * p * n, 1 / p);
    }
    if (Number.isFinite(a)) curve.push({ n, a: Math.min(a, finalCrack) });
  }

  // Same conversion here: the rate must use the same units the life did, or
  // the two disagree by 10^(6m) and only one of them is right.
  const rateOf = (a: number): number => inp.C * Math.pow(dkOf(a) / 1e6, inp.m);
  const rateInitial = rateOf(inp.initialCrack);
  const rateFinal = rateOf(finalCrack);
  const frac = cyclesToDouble === null ? null : cyclesToDouble / cycles;

  const notes: string[] = [
    `The crack grows from ${(inp.initialCrack * 1000).toPrecision(3)} mm to ` +
      `${(finalCrack * 1000).toPrecision(3)} mm in ${cycles.toPrecision(4)} cycles, at which point ` +
      "fast fracture takes over.",
    // CONDITIONAL, because the headline is only true for m > 2. Below that the
    // growth rate rises slowly enough with crack length that the late life is
    // NOT compressed, and the unconditional sentence contradicted its own
    // number - "the first doubling alone takes 0.8% of it ... so the final
    // doubling takes almost no cycles at all".
    frac !== null && inp.m > 2
      ? `MOST OF THE LIFE IS SPENT WHILE THE CRACK IS SMALL: the first doubling alone takes ` +
        `${(frac * 100).toFixed(1)}% of it. The growth rate rises from ` +
        `${rateInitial.toPrecision(3)} to ${rateFinal.toPrecision(3)} m/cycle - a factor of ` +
        `${(rateFinal / rateInitial).toPrecision(3)} - so the final doubling takes almost no ` +
        "cycles at all. An inspection interval set from the TOTAL life is worthless; it has to " +
        "come from the time between detectable and critical."
      : frac !== null
        ? `The first doubling takes ${(frac * 100).toFixed(1)}% of the life, and the growth rate ` +
          `rises by a factor of ${(rateFinal / rateInitial).toPrecision(3)} over the whole ` +
          `growth. At m = ${inp.m}, which is below 2, the late life is NOT compressed the way it ` +
          "is for the usual m of 3 to 4 - the rate does not run away as the crack lengthens."
        : `This crack reaches its critical size at ${(finalCrack * 1000).toPrecision(3)} mm, before ` +
          "it can double, so there is no first-doubling figure to quote. The growth rate still " +
          `rises by a factor of ${(rateFinal / rateInitial).toPrecision(3)} on the way.`,
    "C IS QUOTED FOR ΔK IN MPa√m and that is how it is used here - a coefficient of a power law " +
      "is meaningless without the units of its argument, and feeding a handbook C a ΔK in " +
      "pascals inflates the growth rate by 10^(6m), a factor of 10^18 at m = 3.",
    "C and m are YOUR inputs and are not material constants in any clean sense: they depend on " +
      "the environment and the stress ratio, and quoted values scatter by orders of magnitude " +
      "across sources. The exponent is what matters most, since it is a power.",
    "Y is treated as CONSTANT over the whole growth, which is the model's real limit. Y rises as " +
      "the crack approaches a boundary, so a long crack grows faster than this predicts and the " +
      "answer is optimistic towards the end of life.",
  ];
  if (inp.deltaKth === undefined) {
    notes.push(
      "No threshold ΔK was given, so growth is assumed at every crack size. Real cracks below " +
        "the threshold do not grow at all, which is the basis of damage-tolerant design - give " +
        "one if you have it.",
    );
  }

  return {
    ok: true,
    finalCrack,
    cycles,
    deltaKInitial: dkInit,
    deltaKFinal: dkOf(finalCrack),
    rateInitial,
    rateFinal,
    cyclesToDouble,
    firstDoublingFraction: frac,
    curve,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 3. Where fracture takes over from yielding
// ---------------------------------------------------------------------------

export interface TransitionInput {
  /** Fracture toughness, Pa*sqrt(m). */
  kic: number;
  /** Yield strength, Pa. */
  yieldStrength: number;
  /** Geometry factor Y. */
  Y: number;
  /** A crack size to assess, m. */
  crack?: number;
}

export interface TransitionResult {
  ok: true;
  /** The crack size at which net-section yield and fast fracture coincide, m. */
  transitionCrack: number;
  /** Which mechanism governs at the assessed crack size. */
  governs: "yielding" | "fracture" | "neither given";
  /** Stress to cause yielding, and to cause fracture at that crack size, Pa. */
  yieldStress: number | null;
  fractureStress: number | null;
  notes: string[];
}

/**
 * The crack size below which a part yields before it fractures.
 *
 * BELOW THE TRANSITION SIZE, FRACTURE MECHANICS IS THE WRONG TOOL. A small flaw
 * in a tough material never reaches its critical stress intensity because the
 * section yields first, and a yield check governs. Above it, the part snaps
 * while nominally elastic and only a toughness assessment sees it coming.
 * Knowing which side you are on decides which calculation is even relevant, and
 * that is a single number: a_t = (1/π)(K_IC/(Y·σ_y))².
 */
export function fractureTransition(inp: TransitionInput): TransitionResult | FractureError {
  const bad = positive([
    ["fracture toughness", inp.kic],
    ["yield strength", inp.yieldStrength],
    ["geometry factor", inp.Y],
  ]);
  if (bad) return bad;

  const at = (1 / Math.PI) * Math.pow(inp.kic / (inp.Y * inp.yieldStrength), 2);
  if (!Number.isFinite(at) || at <= 0) {
    return { ok: false, error: "Those inputs give no finite transition crack size." };
  }

  let governs: TransitionResult["governs"] = "neither given";
  let fractureStress: number | null = null;
  const notes: string[] = [
    `The transition crack size is ${(at * 1000).toPrecision(4)} mm. BELOW it the section yields ` +
      "before it fractures, so a yield check governs and fracture mechanics is the wrong tool. " +
      "ABOVE it the part snaps while nominally elastic, and only a toughness assessment sees it " +
      "coming.",
    "A tough material has a LARGE transition size, which is exactly what toughness buys: it is " +
      "not that tough materials do not crack, it is that they tolerate bigger cracks before " +
      "cracking matters more than yielding.",
  ];

  if (inp.crack !== undefined) {
    if (!(inp.crack > 0) || !Number.isFinite(inp.crack)) {
      return { ok: false, error: "The crack length must be greater than zero." };
    }
    fractureStress = inp.kic / (inp.Y * Math.sqrt(Math.PI * inp.crack));
    governs = fractureStress < inp.yieldStrength ? "fracture" : "yielding";
    notes.push(
      governs === "fracture"
        ? `At ${(inp.crack * 1000).toPrecision(3)} mm the part FRACTURES first, at ` +
          `${(fractureStress / 1e6).toPrecision(4)} MPa - below the yield strength of ` +
          `${(inp.yieldStrength / 1e6).toPrecision(4)} MPa. It will break without any warning ` +
          "deformation, which is what makes this the dangerous side of the transition."
        : `At ${(inp.crack * 1000).toPrecision(3)} mm the part YIELDS first: fracture would need ` +
          `${(fractureStress / 1e6).toPrecision(4)} MPa, above the yield strength of ` +
          `${(inp.yieldStrength / 1e6).toPrecision(4)} MPa. Gross yielding gives visible warning, ` +
          "and a conventional strength check governs.",
    );
  }

  return {
    ok: true,
    transitionCrack: at,
    governs,
    yieldStress: inp.yieldStrength,
    fractureStress,
    notes,
  };
}
