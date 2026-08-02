// Grid electrical power — three-phase circuits, power factor correction, and
// conductor voltage drop. The power-systems half of the Energy & power bench:
// everything here is closed-form AC circuit arithmetic on the user's numbers.
//
// CONVENTIONS, STATED BECAUSE EACH IS A SILENT FACTOR OF √3 OR 3:
// - Three-phase quantities are LINE-to-LINE voltage and LINE current unless a
//   result says otherwise; P = √3·V_LL·I_L·pf holds for wye AND delta.
// - Reactive power of a correction bank is TOTAL three-phase kVAR; the
//   per-phase capacitance depends on how the bank is wired (delta vs wye
//   differ by a factor of 3) and both are reported.
// - Voltage drop uses the ROUND-TRIP path for DC and single-phase (out and
//   back: factor 2) and √3 for balanced three-phase, resistance only —
//   reactance matters on long/large-section runs and the result says when.
//
// THE ONE DATA DECISION: conductor resistivity. Copper is 1.7241e-8 Ω·m at
// 20 °C BY DEFINITION — 100% IACS, the International Annealed Copper Standard
// — and aluminium's 61% IACS grade is the standard overhead/building grade.
// These are two citable standards constants, the same class as the latent
// heat in energy.ts, not a property table typed from memory. AWG sizes are an
// exact geometric definition, computed rather than tabulated.

export interface GridError {
  ok: false;
  error: string;
}

/** 100% IACS copper resistivity at 20 °C, Ω·m — definitional. */
export const RHO_COPPER_20C = 1.7241e-8;
/** 61% IACS aluminium (the standard conductor grade), Ω·m at 20 °C. */
export const RHO_ALUMINIUM_20C = RHO_COPPER_20C / 0.61;

const SQRT3 = Math.sqrt(3);

function finitePositive(pairs: [string, number][]): GridError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
}

function allFinite(o: Record<string, unknown>): boolean {
  return Object.values(o).every((v) => typeof v !== "number" || Number.isFinite(v));
}

// --- Three-phase power -------------------------------------------------------

export interface ThreePhaseInput {
  /** Line-to-line voltage, V. */
  lineVoltage: number;
  /** Give ONE of: line current (A) or real power (W). */
  lineCurrentA?: number;
  realPowerW?: number;
  /** Power factor, 0–1. */
  powerFactor: number;
}

export interface ThreePhaseResult {
  ok: true;
  realPowerW: number;
  reactivePowerVAR: number;
  apparentPowerVA: number;
  lineCurrentA: number;
  /** Phase voltage for a wye load (V_LL/√3) — delta phase voltage IS V_LL. */
  phaseVoltageWye: number;
  /** Phase current for a delta load (I_L/√3) — wye phase current IS I_L. */
  phaseCurrentDelta: number;
  notes: string[];
}

/**
 * Balanced three-phase power from line quantities.
 *
 * P = √3·V_LL·I_L·pf IS CONNECTION-INDEPENDENT — the same expression for wye
 * and delta, which is exactly why line quantities are the ones worth quoting.
 * What differs by connection is which PHASE quantity equals the line one, so
 * both phase values are reported with their connection named.
 */
export function threePhase(inp: ThreePhaseInput): ThreePhaseResult | GridError {
  const bad = finitePositive([["line-to-line voltage", inp.lineVoltage]]);
  if (bad) return bad;
  const pf = inp.powerFactor;
  if (!Number.isFinite(pf) || pf <= 0 || pf > 1) {
    return { ok: false, error: "The power factor must be a fraction between 0 and 1 (0.8, not 80)." };
  }
  if (inp.lineCurrentA !== undefined && inp.realPowerW !== undefined) {
    return { ok: false, error: "Give the line current OR the real power, not both — each determines the other." };
  }

  let iLine: number;
  let p: number;
  if (inp.lineCurrentA !== undefined) {
    const b = finitePositive([["line current", inp.lineCurrentA]]);
    if (b) return b;
    iLine = inp.lineCurrentA;
    p = SQRT3 * inp.lineVoltage * iLine * pf;
  } else if (inp.realPowerW !== undefined) {
    const b = finitePositive([["real power", inp.realPowerW]]);
    if (b) return b;
    p = inp.realPowerW;
    iLine = p / (SQRT3 * inp.lineVoltage * pf);
  } else {
    return { ok: false, error: "Give the line current or the real power." };
  }

  const s = SQRT3 * inp.lineVoltage * iLine;
  const q = Math.sqrt(Math.max(0, s * s - p * p));

  const notes = [
    "Line-to-line voltage and line current throughout; P = √3·V·I·pf holds for wye and " +
      "delta alike. The pf alone does not say lagging or leading — an induction motor lags, " +
      "an overcorrected bank leads, and the kVAR magnitude is the same either way.",
    "Balanced load assumed. An unbalanced system has no single line current, and per-phase " +
      "analysis is the honest route there.",
  ];

  const res: ThreePhaseResult = {
    ok: true,
    realPowerW: p,
    reactivePowerVAR: q,
    apparentPowerVA: s,
    lineCurrentA: iLine,
    phaseVoltageWye: inp.lineVoltage / SQRT3,
    phaseCurrentDelta: iLine / SQRT3,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Power factor correction -------------------------------------------------

export interface PfCorrectionInput {
  /** Real power of the load, W. */
  realPowerW: number;
  /** Present power factor, 0–1. */
  pfBefore: number;
  /** Target power factor, 0–1. */
  pfAfter: number;
  /** Line-to-line voltage, V — enables capacitance sizing. */
  lineVoltage?: number;
  /** Supply frequency, Hz. */
  frequencyHz?: number;
}

export interface PfCorrectionResult {
  ok: true;
  /** Total three-phase capacitor bank rating, VAR. */
  bankVAR: number;
  currentBefore: number | null;
  currentAfter: number | null;
  /** Fractional reduction in line current. */
  currentReduction: number;
  /** Fractional reduction in I²R distribution loss. */
  lossReduction: number;
  /** Per-phase capacitance, farads — null without voltage + frequency. */
  capacitanceDeltaF: number | null;
  capacitanceWyeF: number | null;
  notes: string[];
}

/**
 * Capacitor bank to move a load from one power factor to another.
 *
 * Qc = P·(tan φ₁ − tan φ₂). THE REAL POWER DOES NOT CHANGE — correction
 * relieves the wires, not the motor: the utility meter's kW is identical
 * before and after, which is why the payback is in demand charges and I²R
 * losses, both of which fall with the CURRENT. The current falls by the ratio
 * pf₁/pf₂ and the distribution loss by its square.
 */
export function pfCorrection(inp: PfCorrectionInput): PfCorrectionResult | GridError {
  const bad = finitePositive([["real power", inp.realPowerW]]);
  if (bad) return bad;
  for (const [name, v] of [
    ["present power factor", inp.pfBefore],
    ["target power factor", inp.pfAfter],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0 || v > 1) {
      return { ok: false, error: `The ${name} must be a fraction between 0 and 1.` };
    }
  }
  if (inp.pfAfter <= inp.pfBefore) {
    return {
      ok: false,
      error:
        `The target (${inp.pfAfter}) must be above the present power factor (${inp.pfBefore}) — ` +
        "capacitors can only supply reactive power, not absorb the surplus of a target below " +
        "where you already are.",
    };
  }

  const phi1 = Math.acos(inp.pfBefore);
  const phi2 = Math.acos(inp.pfAfter);
  const qc = inp.realPowerW * (Math.tan(phi1) - Math.tan(phi2));
  const currentReduction = 1 - inp.pfBefore / inp.pfAfter;
  const lossReduction = 1 - (inp.pfBefore / inp.pfAfter) ** 2;

  let iBefore: number | null = null;
  let iAfter: number | null = null;
  let cDelta: number | null = null;
  let cWye: number | null = null;
  const notes: string[] = [
    "The real power is unchanged — correction relieves the wires, not the motor. The " +
      "current falls by pf₁/pf₂ and the I²R distribution loss by its square; the saving " +
      "is in demand charges and losses, never in the kWh the load itself uses.",
  ];
  if (inp.lineVoltage !== undefined || inp.frequencyHz !== undefined) {
    if (inp.lineVoltage === undefined || inp.frequencyHz === undefined) {
      return { ok: false, error: "Capacitance sizing needs both the line voltage and the frequency." };
    }
    const b = finitePositive([
      ["line-to-line voltage", inp.lineVoltage],
      ["frequency", inp.frequencyHz],
    ]);
    if (b) return b;
    iBefore = inp.realPowerW / (SQRT3 * inp.lineVoltage * inp.pfBefore);
    iAfter = inp.realPowerW / (SQRT3 * inp.lineVoltage * inp.pfAfter);
    const w = 2 * Math.PI * inp.frequencyHz;
    // Per phase: delta sees V_LL, wye sees V_LL/√3 — hence the factor of 3.
    cDelta = qc / 3 / (w * inp.lineVoltage * inp.lineVoltage);
    cWye = 3 * cDelta;
    notes.push(
      "Per-phase capacitance depends on the bank wiring: a delta bank sees the full " +
        "line voltage and needs one third the capacitance of a wye bank for the same kVAR — " +
        "which is why LV banks are usually delta.",
    );
  }
  notes.push(
    "Do not correct past ~0.95–0.98 in practice: at unity the bank resonates more readily " +
      "with supply harmonics, and past it the system runs LEADING, which many utilities " +
      "penalise exactly like lagging.",
  );

  const res: PfCorrectionResult = {
    ok: true,
    bankVAR: qc,
    currentBefore: iBefore,
    currentAfter: iAfter,
    currentReduction,
    lossReduction,
    capacitanceDeltaF: cDelta,
    capacitanceWyeF: cWye,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Conductor voltage drop --------------------------------------------------

export type ConductorMaterial = "copper" | "aluminium";
export type CircuitKind = "dc" | "single-phase" | "three-phase";

export interface VoltageDropInput {
  material: ConductorMaterial;
  kind: CircuitKind;
  /** One-way run length, m. */
  lengthM: number;
  /** Load current, A. */
  currentA: number;
  /** Conductor cross-section, mm² — or give awg instead. */
  sectionMm2?: number;
  /** American Wire Gauge number (use 0 for 1/0; -1 for 2/0, etc.). */
  awg?: number;
  /** Supply voltage, V — enables the percentage and a minimum-section solve. */
  supplyVoltage?: number;
  /** Target maximum drop as a fraction (0.03 = 3%) — solves the minimum section. */
  maxDropFraction?: number;
}

export interface VoltageDropResult {
  ok: true;
  sectionMm2: number;
  /** Conductor resistance of the full current path, Ω. */
  pathResistance: number;
  dropV: number;
  dropFraction: number | null;
  /** Power dissipated in the conductors, W. */
  lossW: number;
  /** Minimum section meeting the target drop, mm² — null without a target. */
  minSectionMm2: number | null;
  notes: string[];
}

/**
 * AWG diameter in mm — the gauge is an exact geometric progression by
 * definition (92^(1/39) per step between #36 = 0.005" and 4/0 = 0.46"), so it
 * is computed, not tabulated. n = 0 is 1/0; negative n continues to 4/0 = -3.
 */
export function awgDiameterMm(n: number): number | null {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < -3 || n > 40) return null;
  return 0.127 * Math.pow(92, (36 - n) / 39);
}

/**
 * Resistive voltage drop and loss on a cable run.
 *
 * THE FACTOR IN FRONT IS THE WHOLE QUESTION: DC and single-phase current
 * flows out AND back (2·L), balanced three-phase drops √3·I·R over one
 * conductor's length. Using the single-phase factor on a three-phase feeder
 * oversizes the cable by 15% — cheap insurance bought by accident.
 *
 * Resistance only, at 20 °C. Reactance adds to the drop on runs above
 * ~50 mm² or ~100 m at mains frequency, and conductor resistance rises
 * ~0.4%/°C — a cable at 60 °C has ~16% more resistance than this figure.
 * Both are stated in the result rather than silently ignored.
 */
export function voltageDrop(inp: VoltageDropInput): VoltageDropResult | GridError {
  const bad = finitePositive([
    ["run length", inp.lengthM],
    ["load current", inp.currentA],
  ]);
  if (bad) return bad;

  let section = inp.sectionMm2;
  if (section !== undefined && inp.awg !== undefined) {
    return { ok: false, error: "Give the section in mm² OR as an AWG number, not both." };
  }
  if (section === undefined) {
    if (inp.awg === undefined) return { ok: false, error: "Give a conductor section (mm² or AWG)." };
    const d = awgDiameterMm(inp.awg);
    if (d === null) {
      return {
        ok: false,
        error:
          "AWG numbers run 40 (finest) to -3 (4/0): whole numbers, with 0 = 1/0, -1 = 2/0, " +
          "-2 = 3/0, -3 = 4/0.",
      };
    }
    section = (Math.PI / 4) * d * d;
  }
  const b2 = finitePositive([["conductor section", section]]);
  if (b2) return b2;
  if (section > 2000) {
    return { ok: false, error: `${section} mm² is beyond any single conductor — check the unit (this field wants mm²).` };
  }

  const rho = inp.material === "copper" ? RHO_COPPER_20C : RHO_ALUMINIUM_20C;
  const rPerM = rho / (section * 1e-6);
  const pathFactor = inp.kind === "three-phase" ? SQRT3 : 2;
  const pathR = inp.kind === "three-phase" ? rPerM * inp.lengthM : 2 * rPerM * inp.lengthM;
  const drop = pathFactor * inp.currentA * rPerM * inp.lengthM;
  // Loss: DC/1φ dissipate I² over both conductors; balanced 3φ dissipates
  // 3·I² over one conductor's resistance each.
  const loss =
    inp.kind === "three-phase"
      ? 3 * inp.currentA * inp.currentA * rPerM * inp.lengthM
      : 2 * inp.currentA * inp.currentA * rPerM * inp.lengthM;

  let dropFraction: number | null = null;
  let minSection: number | null = null;
  const notes: string[] = [];
  if (inp.supplyVoltage !== undefined) {
    const b = finitePositive([["supply voltage", inp.supplyVoltage]]);
    if (b) return b;
    dropFraction = drop / inp.supplyVoltage;
    if (dropFraction >= 1) {
      return {
        ok: false,
        error:
          "The computed drop exceeds the supply voltage — this cable cannot carry this " +
          "current over this distance at all. Check the section and the length.",
      };
    }
    if (inp.maxDropFraction !== undefined) {
      if (!Number.isFinite(inp.maxDropFraction) || inp.maxDropFraction <= 0 || inp.maxDropFraction >= 1) {
        return { ok: false, error: "The target drop is a fraction like 0.03 (3%)." };
      }
      // Drop scales as 1/section, so the minimum section is a direct ratio.
      minSection = (section * dropFraction) / inp.maxDropFraction;
    }
  }

  notes.push(
    inp.kind === "three-phase"
      ? "Balanced three-phase: drop = √3·I·R over ONE conductor's length. Using the " +
          "single-phase factor 2 here would oversize the cable by 15%."
      : "The current path is out AND back, so the resistance is 2× the one-way run.",
    "Resistance at 20 °C; copper and aluminium rise ~0.4% per °C, so a conductor at 60 °C " +
      "drops ~16% more than this. Reactance is ignored — it adds meaningfully above " +
      "~50 mm² or ~100 m at mains frequency.",
    "Resistivity: copper 1.7241×10⁻⁸ Ω·m (100% IACS, definitional), aluminium at the " +
      "standard 61% IACS conductor grade."
  );

  const res: VoltageDropResult = {
    ok: true,
    sectionMm2: section,
    pathResistance: pathR,
    dropV: drop,
    dropFraction,
    lossW: loss,
    minSectionMm2: minSection,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}
