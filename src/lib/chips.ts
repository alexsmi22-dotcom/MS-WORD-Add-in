// Digital integrated circuits — switching power, thermal path, interconnect delay
// and timing closure.
//
// WHAT IS COMPUTED AND WHAT IS YOURS. Everything here follows from the four
// inputs a datasheet actually gives you: a capacitance, a supply voltage, a
// frequency and a thermal resistance. Nothing about a PROCESS is modelled —
// leakage current in particular is exponential in temperature and specific to a
// node, so it is taken as a measured input rather than predicted, the same
// decision as refractive index in optics.ts and enthalpies in thermo.ts.
//
// THE CONVENTIONS THAT GO WRONG, named at the point of use:
//   - the activity factor counts 0->1 TRANSITIONS PER CYCLE, and the energy per
//     such transition is C*V^2 (not 1/2 C V^2, which is only the energy STORED);
//     the two conventions differ by exactly 2x;
//   - Elmore delay is an upper BOUND on an RC ladder, not the 50% delay, and for
//     a distributed wire the two differ by 0.5 vs 0.38;
//   - clock skew HELPS setup and HURTS hold, with opposite signs in the two
//     checks. A hold slack computed with the setup sign is positive when the part
//     is broken, which is the one failure here that silicon finds and you do not.

/** Boltzmann constant in eV/K, for the thermal-voltage note. */
export const K_BOLTZMANN_EV = 8.617333262e-5;

export interface PowerResult {
  dynamicW: number;
  staticW: number;
  totalW: number;
  /** Energy per 0->1 transition of the whole switched capacitance, joules. */
  energyPerTransitionJ: number;
  /** Energy drawn per clock cycle, joules. */
  energyPerCycleJ: number;
  /** Fraction of total that is leakage. */
  leakageFraction: number;
  notes: string[];
}

/**
 * Switching and static power.
 *
 * P_dyn = alpha * C * V^2 * f, where ALPHA IS THE NUMBER OF 0->1 TRANSITIONS PER
 * CLOCK CYCLE. A clock net has alpha = 1 (it rises every cycle); random logic is
 * often quoted near 0.1. The other convention in circulation counts every edge
 * and writes P = 1/2 * alpha * C * V^2 * f — identical physics, alpha twice as
 * large. Mixing them is a clean factor of two in the answer with nothing to
 * indicate it, so the choice is stated in the result.
 *
 * Leakage is a MEASURED input. It is exponential in temperature and depends on
 * the process, so predicting it here would be inventing data.
 */
export function switchingPower(
  capacitanceF: number,
  voltageV: number,
  frequencyHz: number,
  activity = 1,
  leakageA = 0,
): PowerResult | null {
  if (![capacitanceF, voltageV, frequencyHz, activity, leakageA].every(Number.isFinite)) return null;
  if (capacitanceF <= 0 || voltageV <= 0 || frequencyHz < 0) return null;
  if (activity < 0 || leakageA < 0) return null;

  const energyPerTransitionJ = capacitanceF * voltageV * voltageV;
  const dynamicW = activity * energyPerTransitionJ * frequencyHz;
  const staticW = voltageV * leakageA;
  const totalW = dynamicW + staticW;

  const notes: string[] = [
    "Activity factor is 0->1 TRANSITIONS PER CYCLE: a clock net is 1, random logic is " +
      "often near 0.1. The other common form, P = ½·α·C·V²·f, counts every edge and so uses " +
      "an alpha twice this one — the same physics with a factor of two moved.",
    "Energy per 0->1 transition is C·V², not ½C·V². Half is stored on the capacitor and half " +
      "is burned in the pull-up; discharging burns the stored half in the pull-down, so a full " +
      "cycle costs C·V² in total.",
  ];
  if (leakageA === 0) {
    notes.push(
      "Leakage was left at zero, so this is dynamic power only. Static power is not predicted " +
        "here because it is exponential in temperature and specific to the process — measure it " +
        "or take it from the datasheet and enter it.",
    );
  }
  notes.push(
    "Voltage enters SQUARED, so it is the strongest lever: dropping the supply 20% cuts dynamic " +
      "power by 36% at the same frequency.",
  );

  return {
    dynamicW,
    staticW,
    totalW,
    energyPerTransitionJ,
    energyPerCycleJ: frequencyHz > 0 ? totalW / frequencyHz : activity * energyPerTransitionJ,
    leakageFraction: totalW > 0 ? staticW / totalW : 0,
    notes,
  };
}

export interface ThermalResult {
  junctionC: number;
  caseC: number;
  sinkC: number;
  totalResistance: number;
  /** Margin to the stated maximum; negative means over. */
  marginC: number | null;
  withinLimit: boolean | null;
  /** Power that would exactly reach the limit, watts. */
  maxPowerW: number | null;
  notes: string[];
}

/**
 * Junction temperature through a series thermal path,
 * Tj = Ta + P*(theta_jc + theta_cs + theta_sa).
 *
 * THIS IS A SINGLE HEAT PATH. Real packages lose heat through the board as well
 * as the case, and those are PARALLEL paths whose combined resistance is lower
 * than either — so a part that fails this calculation may survive, and a
 * theta_ja from a datasheet already bundles an assumed board. Adding resistances
 * in series is right only for the one route they describe, and that is said
 * rather than assumed.
 */
export function junctionTemperature(
  powerW: number,
  ambientC: number,
  thetaJc: number,
  thetaCs: number,
  thetaSa: number,
  tjMaxC?: number,
): ThermalResult | null {
  const vals = [powerW, ambientC, thetaJc, thetaCs, thetaSa];
  if (!vals.every(Number.isFinite)) return null;
  if (powerW < 0 || thetaJc < 0 || thetaCs < 0 || thetaSa < 0) return null;

  const totalResistance = thetaJc + thetaCs + thetaSa;
  const sinkC = ambientC + powerW * thetaSa;
  const caseC = sinkC + powerW * thetaCs;
  const junctionC = caseC + powerW * thetaJc;

  const notes: string[] = [
    "Series path only: junction → case → sink → ambient. A package also loses heat through the " +
      "board, and that is a PARALLEL path — so this is the conservative answer for the route " +
      "described, and a datasheet θja already assumes a board and must not be added to these.",
  ];

  let marginC: number | null = null;
  let withinLimit: boolean | null = null;
  let maxPowerW: number | null = null;
  if (tjMaxC !== undefined) {
    if (!Number.isFinite(tjMaxC)) return null;
    marginC = tjMaxC - junctionC;
    withinLimit = marginC >= 0;
    maxPowerW = totalResistance > 0 ? (tjMaxC - ambientC) / totalResistance : null;
    if (!withinLimit) {
      notes.push(
        `OVER THE LIMIT by ${(-marginC).toPrecision(4)} °C. At this ambient the path can carry ` +
          `${maxPowerW === null ? "no" : maxPowerW.toPrecision(4)} W before the junction reaches ` +
          `${tjMaxC} °C.`,
      );
    }
  }
  if (totalResistance === 0) {
    notes.push(
      "Every thermal resistance is zero, so the junction sits at ambient. That is the arithmetic, " +
        "not a physical package.",
    );
  }

  return { junctionC, caseC, sinkC, totalResistance, marginC, withinLimit, maxPowerW, notes };
}

export interface DelayResult {
  /** Elmore delay of the distributed wire alone, seconds. */
  wireElmoreS: number;
  /** 50% propagation delay of the wire alone, seconds. */
  wireFiftyS: number;
  /** Driver + wire + load, the composite 50% delay, seconds. */
  totalFiftyS: number;
  /** 10-90% rise time of the lumped equivalent, seconds. */
  riseTenNinetyS: number;
  notes: string[];
}

/**
 * RC interconnect delay for a driver of output resistance Rd driving a wire of
 * total R and C into a load Cl.
 *
 * ELMORE IS A BOUND, NOT THE DELAY. For a distributed uniform wire the Elmore
 * value is 0.5*R*C, while the actual 50% crossing is about 0.38*R*C — Elmore is
 * an upper bound and is roughly 30% pessimistic here. Both are reported, named,
 * because quoting one as the other is a silent 30% error in a timing budget.
 *
 * The composite uses the standard form
 *   t50 = 0.69*Rd*(Cw + Cl) + 0.38*Rw*Cw + 0.69*Rw*Cl
 * where 0.69 = ln 2 is the single-pole 50% factor and 0.38 is the distributed one.
 */
export function interconnectDelay(
  driverOhm: number,
  wireOhm: number,
  wireFarad: number,
  loadFarad: number,
): DelayResult | null {
  const vals = [driverOhm, wireOhm, wireFarad, loadFarad];
  if (!vals.every(Number.isFinite)) return null;
  if (vals.some((v) => v < 0)) return null;

  const LN2 = Math.LN2; // 0.693, the single-pole 50% factor
  const DIST = 0.38; // distributed-wire 50% factor

  const wireElmoreS = 0.5 * wireOhm * wireFarad;
  const wireFiftyS = DIST * wireOhm * wireFarad;
  const totalFiftyS =
    LN2 * driverOhm * (wireFarad + loadFarad) + DIST * wireOhm * wireFarad + LN2 * wireOhm * loadFarad;
  const riseTenNinetyS = 2.2 * (driverOhm + wireOhm) * (wireFarad + loadFarad);

  return {
    wireElmoreS,
    wireFiftyS,
    totalFiftyS,
    riseTenNinetyS,
    notes: [
      "Elmore delay is an upper BOUND on an RC ladder, not the 50% crossing: for a distributed " +
        "wire it gives 0.5·R·C where the real 50% point is about 0.38·R·C, so Elmore is roughly " +
        "30% pessimistic. Both are shown so neither gets quoted as the other.",
      "0.693 = ln 2 is the 50% factor for a single RC pole and applies to the driver and the " +
        "load; 0.38 is the distributed-wire factor and applies to the wire's own RC. Wire " +
        "delay grows with the SQUARE of length, since R and C both scale with it.",
      "This is an RC model: it assumes the interconnect is resistive-capacitive with no " +
        "inductance, which stops being true for long, fast, low-resistance lines where " +
        "transmission-line behaviour takes over.",
    ],
  };
}

export interface TimingResult {
  setupSlackS: number;
  holdSlackS: number;
  setupOk: boolean;
  holdOk: boolean;
  /** Maximum clock frequency the setup path allows, Hz. */
  fMaxHz: number | null;
  /** The clock period actually required, seconds. */
  minPeriodS: number;
  notes: string[];
}

/**
 * Synchronous timing closure for one flop-to-flop path.
 *
 *   setup slack = T - (t_cq + t_logic_max + t_setup) + skew
 *   hold  slack = t_cq + t_logic_min - t_hold - skew
 *
 * SKEW HAS OPPOSITE SIGNS IN THE TWO CHECKS and that is the whole difficulty.
 * Positive skew means the capturing clock arrives LATER than the launching one:
 * it gives the data more time to arrive, so it HELPS setup, and it also gives the
 * new data more time to overwrite the old, so it HURTS hold. Using the setup sign
 * in the hold check returns a positive slack for a part that fails in silicon —
 * and unlike a setup failure, a hold failure cannot be fixed by slowing the clock.
 */
export function timingCheck(
  periodS: number,
  clockToQS: number,
  logicMaxS: number,
  logicMinS: number,
  setupS: number,
  holdS: number,
  skewS = 0,
): TimingResult | null {
  const vals = [periodS, clockToQS, logicMaxS, logicMinS, setupS, holdS, skewS];
  if (!vals.every(Number.isFinite)) return null;
  if (periodS <= 0) return null;
  if ([clockToQS, logicMaxS, logicMinS, setupS, holdS].some((v) => v < 0)) return null;

  const notes: string[] = [];
  if (logicMinS > logicMaxS) {
    return null; // a minimum path longer than the maximum is not a description of a circuit
  }

  const setupSlackS = periodS - (clockToQS + logicMaxS + setupS) + skewS;
  const holdSlackS = clockToQS + logicMinS - holdS - skewS;
  const minPeriodS = clockToQS + logicMaxS + setupS - skewS;
  const fMaxHz = minPeriodS > 0 ? 1 / minPeriodS : null;

  notes.push(
    "Positive skew means the CAPTURING clock arrives later than the launching one. It helps " +
      "setup (more time for data to arrive) and hurts hold (more time to clobber the old " +
      "value), which is why it enters the two checks with opposite signs.",
  );
  if (!(holdSlackS >= 0)) {
    notes.push(
      "HOLD IS VIOLATED, and slowing the clock does NOT fix it: the hold check has no period " +
        "term. It is fixed with delay in the data path or by reducing skew, and a hold " +
        "violation that reaches silicon is usually fatal to the part.",
    );
  }
  if (!(setupSlackS >= 0)) {
    notes.push(
      `SETUP IS VIOLATED. The path needs a period of at least ${minPeriodS.toPrecision(6)} s ` +
        `(${(1 / minPeriodS / 1e6).toPrecision(6)} MHz) rather than the ${periodS.toPrecision(6)} s given.`,
    );
  }
  notes.push(
    "One path only, at one corner. Real closure needs the slow corner for setup and the FAST " +
      "corner for hold — they are different silicon, and a path that passes both at the typical " +
      "corner can fail both in production.",
  );

  return {
    setupSlackS,
    holdSlackS,
    setupOk: setupSlackS >= 0,
    holdOk: holdSlackS >= 0,
    fMaxHz,
    minPeriodS,
    notes,
  };
}
