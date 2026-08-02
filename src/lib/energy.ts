// Energy engineering — wind, solar PV, hydro, battery packs, combustion
// stoichiometry, and levelized cost of energy.
//
// WHAT IS NOT HERE, AND WHY. There are no fuel heating-value tables, no site
// insolation tables, and no battery chemistry curves. A heating value depends
// on the actual fuel blend, insolation on the actual site, and capacity on the
// actual cell — all measured quantities the user looks up, exactly like the
// steam-table refusal in thermo.ts. The tools take those numbers as input and
// do the arithmetic, the unit conversions, and the physical-bound checks
// around them. What IS computed from first principles: the Betz limit, swept
// areas, stoichiometric air from the fuel's chemical formula via the real
// IUPAC atomic weights, discounted cash-flow sums, and every derived quantity.
//
// CLAIMED PERFORMANCE IS CHECKED AGAINST PHYSICAL BOUNDS. A wind Cp above
// 16/27 and a conversion efficiency above 1 are refused with an explanation,
// the same way thermo.ts refuses a claimed efficiency above Carnot. These are
// the two numbers most often quoted wrongly in specifications.
//
// NO INFINITY IS EVER REPORTED. Every ratio whose denominator can reach zero
// (runtime at zero load, LCOE with zero generation) returns an explanation of
// what the zero means physically instead.

import { atomicNumber, atomicWeight } from "./periodic";
import { parseFormula } from "./massspec";
import { G } from "./fluids";
import { gammaln } from "./stats";

export interface EnergyError {
  ok: false;
  error: string;
}

/** Standard gravity — re-exported from fluids.ts so hydro here and pipe/NPSH
 * there can never disagree on it. */
export const G_STANDARD = G;

/** ISA sea-level air density, kg/m^3 — from the standard atmosphere definition. */
export const RHO_AIR_SL = 1.225;

/** Density of water, kg/m^3, at the 4 °C reference. Real intakes run 998–1000. */
export const RHO_WATER = 1000;

/** The Betz limit 16/27, derived from actuator-disc theory — exact as a fraction. */
export const BETZ_LIMIT = 16 / 27;

/**
 * Latent heat of vaporisation of water at 25 °C, J/kg (2441.7 kJ/kg, standard
 * steam-table value at the HHV/LHV reference temperature). This single measured
 * constant is the entire difference between the two heating values.
 */
export const H_FG_WATER_25C = 2.4417e6;

const HOURS_PER_YEAR = 8760;

function finitePositive(pairs: [string, number][]): EnergyError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
}

function finiteNonNegative(pairs: [string, number][]): EnergyError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v < 0) return { ok: false, error: `The ${name} must not be negative.` };
  }
  return null;
}

/** Guards a computed result against silent overflow reaching the document. */
function allFinite(o: Record<string, unknown>): boolean {
  return Object.values(o).every((v) => typeof v !== "number" || Number.isFinite(v));
}

// --- Wind --------------------------------------------------------------------

export interface WindInput {
  /** Rotor diameter, m. */
  diameter: number;
  /** Hub-height wind speed, m/s. */
  windSpeed: number;
  /** Air density, kg/m^3 (1.225 at ISA sea level; falls ~10% per 1000 m). */
  airDensity?: number;
  /** Measured power coefficient. Omit to get the Betz bound instead. */
  cp?: number;
  /** Rotor speed, rpm — enables tip-speed ratio. */
  rpm?: number;
  /** Capacity factor (0–1) — enables annual energy. */
  capacityFactor?: number;
}

export interface WindResult {
  ok: true;
  sweptArea: number;
  /** Kinetic power in the wind through the disc, W. */
  windPower: number;
  /** The Betz bound on extractable power, W. */
  betzPower: number;
  /** Actual output at the given Cp, W — null when no Cp was given. */
  outputPower: number | null;
  cpUsed: number | null;
  tipSpeedRatio: number | null;
  /** Annual energy, kWh — null without a capacity factor. */
  annualEnergyKWh: number | null;
  notes: string[];
}

/**
 * Power in the wind and the Betz-bounded turbine output.
 *
 * THE CUBE LAW IS THE WHOLE SUBJECT: P = ½ρAv³, so a 10% error in wind speed
 * is a 33% error in power, and the difference between a 6 m/s and 8 m/s site
 * is a factor of 2.4 — which is why resource assessment is measured for a
 * year, and why this tool refuses to guess a site's wind speed for you.
 *
 * THE BETZ LIMIT IS NOT AN ENGINEERING SHORTFALL. 16/27 of the kinetic power
 * is the most ANY momentum-extracting disc can take: extracting all of it
 * would stop the air dead behind the rotor, and stopped air cannot leave to
 * make room for more. A quoted Cp above 0.593 is a claim the machine outruns
 * its own wake, and is refused as such.
 */
export function windPower(inp: WindInput): WindResult | EnergyError {
  const rho = inp.airDensity ?? RHO_AIR_SL;
  const bad =
    finitePositive([
      ["rotor diameter", inp.diameter],
      ["wind speed", inp.windSpeed],
      ["air density", rho],
    ]);
  if (bad) return bad;
  if (rho > 2 || rho < 0.1) {
    return {
      ok: false,
      error:
        `An air density of ${rho} kg/m³ is outside anything in Earth's atmosphere ` +
        "(sea level is 1.225). Check the unit — this field wants kg/m³.",
    };
  }

  const notes: string[] = [];
  const A = (Math.PI / 4) * inp.diameter * inp.diameter;
  const pWind = 0.5 * rho * A * Math.pow(inp.windSpeed, 3);
  const pBetz = BETZ_LIMIT * pWind;

  let pOut: number | null = null;
  let cpUsed: number | null = null;
  if (inp.cp !== undefined) {
    if (!Number.isFinite(inp.cp) || inp.cp <= 0) {
      return { ok: false, error: "The power coefficient Cp must be a positive number." };
    }
    if (inp.cp > BETZ_LIMIT) {
      return {
        ok: false,
        error:
          `Cp = ${inp.cp} exceeds the Betz limit 16/27 ≈ 0.593 — no wind turbine can do ` +
          "this. Modern three-blade machines reach 0.45–0.50. If this is a claimed " +
          "specification, the claim is wrong; if it is an overall efficiency including " +
          "generator losses it should be below the aerodynamic Cp, not above it.",
      };
    }
    cpUsed = inp.cp;
    pOut = inp.cp * pWind;
    notes.push(
      "Cp is a measured property of the turbine at this tip-speed ratio, not a constant — " +
        "it falls off away from the design point, which is why real annual output needs " +
        "the full power curve, not one Cp."
    );
  } else {
    notes.push(
      "No Cp given, so the output shown is the Betz bound — the theoretical maximum. " +
        "Real turbines reach 75–85% of it at the design point."
    );
  }

  let tsr: number | null = null;
  if (inp.rpm !== undefined) {
    if (!Number.isFinite(inp.rpm) || inp.rpm <= 0) {
      return { ok: false, error: "The rotor speed must be a positive number of rpm." };
    }
    tsr = ((inp.rpm * 2 * Math.PI) / 60) * (inp.diameter / 2) / inp.windSpeed;
  }

  let annual: number | null = null;
  if (inp.capacityFactor !== undefined) {
    if (!Number.isFinite(inp.capacityFactor) || inp.capacityFactor <= 0 || inp.capacityFactor > 1) {
      return { ok: false, error: "The capacity factor must be between 0 and 1." };
    }
    const p = pOut ?? pBetz;
    annual = (p / 1000) * HOURS_PER_YEAR * inp.capacityFactor;
    notes.push(
      "Annual energy = rated output × 8760 h × capacity factor. The capacity factor " +
        "already contains every real-world loss (wind distribution, availability, " +
        "curtailment); typical onshore is 0.25–0.40, offshore 0.40–0.55."
    );
  }

  notes.push(
    "Power goes as the CUBE of wind speed: +10% wind is +33% power. The wind speed " +
      "here must be at hub height — speed measured at 10 m is substantially lower."
  );

  const res: WindResult = {
    ok: true,
    sweptArea: A,
    windPower: pWind,
    betzPower: pBetz,
    outputPower: pOut,
    cpUsed,
    tipSpeedRatio: tsr,
    annualEnergyKWh: annual,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Solar PV ----------------------------------------------------------------

export interface SolarInput {
  /** Plane-of-array irradiance, W/m^2 (1000 at STC). */
  irradiance: number;
  /** Array area, m^2. */
  area: number;
  /** Module efficiency at STC, as a fraction (0–1). */
  efficiency: number;
  /** Power temperature coefficient, %/°C — NEGATIVE for every real module. */
  tempCoeffPctPerC?: number;
  /** Ambient temperature, °C — with NOCT, enables cell-temperature derating. */
  ambientC?: number;
  /** Nominal operating cell temperature, °C (datasheet; 42–48 typical). */
  noctC?: number;
  /** Site peak sun hours per day — enables daily energy. */
  peakSunHours?: number;
  /** System performance ratio (0–1), inverter/wiring/soiling losses combined. */
  performanceRatio?: number;
}

export interface SolarResult {
  ok: true;
  /** Output at the stated irradiance ignoring temperature, W. */
  powerStc: number;
  /** Estimated cell temperature, °C — null without ambient + NOCT. */
  cellTempC: number | null;
  /** Temperature-derated output, W — null without the derating inputs. */
  powerDerated: number | null;
  /** Daily energy, kWh — null without peak sun hours. */
  dailyEnergyKWh: number | null;
  notes: string[];
}

/**
 * PV array output with the standard NOCT cell-temperature derating.
 *
 * THE PANEL RATING IS AT 25 °C CELLS, AND CELLS IN SUN ARE NEVER AT 25 °C.
 * Under full sun a cell runs 20–30 °C above ambient, and crystalline silicon
 * loses ~0.35–0.45% of its power per °C, so a "400 W" panel on a warm roof is
 * a ~350 W panel. The NOCT model here — Tc = Ta + (NOCT − 20)/800 × G — is
 * the standard first-order estimate, and its inputs (NOCT, the coefficient)
 * come from the module datasheet, not from this tool.
 *
 * IRRADIANCE AND PEAK SUN HOURS ARE SITE DATA THE USER SUPPLIES. Baking in an
 * insolation table would be inventing a site survey; look the site up in PVGIS
 * or NREL's tools and bring the number.
 */
export function solarPV(inp: SolarInput): SolarResult | EnergyError {
  const bad = finitePositive([
    ["irradiance", inp.irradiance],
    ["array area", inp.area],
    ["module efficiency", inp.efficiency],
  ]);
  if (bad) return bad;
  if (inp.efficiency >= 1) {
    return {
      ok: false,
      error:
        "The efficiency must be a fraction below 1. Commercial modules are 0.18–0.23; " +
        "the single-junction (Shockley–Queisser) limit is about 0.33.",
    };
  }
  if (inp.efficiency > 0.5) {
    return {
      ok: false,
      error:
        `An efficiency of ${inp.efficiency} exceeds anything ever built — the single-junction ` +
        "limit is ~0.33 and lab multi-junction concentrator cells peak below 0.48. If this " +
        "is a percentage, enter it as a fraction (20% → 0.20).",
    };
  }
  if (inp.irradiance > 1500) {
    return {
      ok: false,
      error:
        `${inp.irradiance} W/m² exceeds terrestrial sunlight (the solar constant is 1361 ` +
        "W/m² above the atmosphere; ground-level peak is ~1000–1200). Check the unit.",
    };
  }

  const notes: string[] = [];
  const pStc = inp.irradiance * inp.area * inp.efficiency;

  let cellT: number | null = null;
  let pDerated: number | null = null;
  if (inp.ambientC !== undefined && inp.noctC !== undefined) {
    if (!Number.isFinite(inp.ambientC) || inp.ambientC < -90 || inp.ambientC > 60) {
      return { ok: false, error: "The ambient temperature must be a real outdoor value in °C." };
    }
    if (!Number.isFinite(inp.noctC) || inp.noctC < 25 || inp.noctC > 60) {
      return { ok: false, error: "NOCT is a datasheet value, typically 42–48 °C." };
    }
    const gamma = inp.tempCoeffPctPerC ?? -0.35;
    if (!Number.isFinite(gamma) || Math.abs(gamma) > 2) {
      return { ok: false, error: "The temperature coefficient is a small percentage per °C, e.g. -0.35." };
    }
    if (gamma > 0) {
      notes.push(
        "A POSITIVE temperature coefficient means this module gains power as it heats, " +
          "which no commercial technology does — datasheets write it as negative " +
          "(e.g. -0.35 %/°C). Proceeding with the value as given."
      );
    }
    cellT = inp.ambientC + ((inp.noctC - 20) / 800) * inp.irradiance;
    pDerated = pStc * (1 + (gamma / 100) * (cellT - 25));
    if (pDerated < 0) pDerated = 0;
    notes.push(
      "Cell temperature uses the NOCT model Tc = Ta + (NOCT − 20)/800 × G — a standard " +
        "first-order estimate; wind cooling and mounting change it by several °C."
    );
  }

  let daily: number | null = null;
  if (inp.peakSunHours !== undefined) {
    if (!Number.isFinite(inp.peakSunHours) || inp.peakSunHours <= 0 || inp.peakSunHours > 13) {
      return { ok: false, error: "Peak sun hours per day is a site figure between 0 and ~13." };
    }
    const pr = inp.performanceRatio ?? 1;
    if (!Number.isFinite(pr) || pr <= 0 || pr > 1) {
      return { ok: false, error: "The performance ratio must be a fraction between 0 and 1." };
    }
    const basis = pDerated ?? pStc;
    // Peak sun hours are defined against 1000 W/m^2, so daily energy uses the
    // array's 1000 W/m^2 output, not the instantaneous one at `irradiance`.
    const p1000 = 1000 * inp.area * inp.efficiency * (basis / pStc);
    daily = (p1000 / 1000) * inp.peakSunHours * pr;
    if (inp.performanceRatio === undefined) {
      notes.push(
        "No performance ratio given, so daily energy assumes a lossless system. Real " +
          "systems deliver 75–85% after inverter, wiring, soiling and mismatch losses."
      );
    }
  }

  notes.push(
    "Irradiance and peak sun hours are SITE measurements — look them up (PVGIS, NREL " +
      "NSRDB) rather than estimating. This tool computes from your numbers; it does not " +
      "contain an insolation model."
  );

  const res: SolarResult = {
    ok: true,
    powerStc: pStc,
    cellTempC: cellT,
    powerDerated: pDerated,
    dailyEnergyKWh: daily,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

/** Fill factor and consistency checks from the four datasheet I-V points. */
export interface FillFactorResult {
  ok: true;
  /** Maximum power, W. */
  pMax: number;
  fillFactor: number;
  notes: string[];
}

export function fillFactor(
  voc: number,
  isc: number,
  vmp: number,
  imp: number
): FillFactorResult | EnergyError {
  const bad = finitePositive([
    ["open-circuit voltage", voc],
    ["short-circuit current", isc],
    ["max-power voltage", vmp],
    ["max-power current", imp],
  ]);
  if (bad) return bad;
  if (vmp >= voc) {
    return {
      ok: false,
      error:
        "Vmp must be below Voc — the maximum-power point sits inside the I-V curve. " +
        "These two are probably swapped.",
    };
  }
  if (imp >= isc) {
    return {
      ok: false,
      error:
        "Imp must be below Isc — the maximum-power point sits inside the I-V curve. " +
        "These two are probably swapped.",
    };
  }
  const pMax = vmp * imp;
  const ff = pMax / (voc * isc);
  const notes = [
    "Fill factor = Vmp·Imp / (Voc·Isc). Crystalline silicon runs 0.75–0.85; a value " +
      "below ~0.7 on a datasheet that claims c-Si suggests the numbers are inconsistent, " +
      "and a measured value falling over time indicates series-resistance degradation.",
  ];
  const res: FillFactorResult = { ok: true, pMax, fillFactor: ff, notes };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Hydro -------------------------------------------------------------------

export interface HydroInput {
  /** Volumetric flow, m^3/s. */
  flow: number;
  /** Gross head, m. */
  grossHead: number;
  /** Head loss in the penstock, m (or use lossFraction). */
  headLoss?: number;
  /** Overall efficiency, water-to-wire (0–1). */
  efficiency: number;
  /** Water density, kg/m^3. */
  waterDensity?: number;
  /** Capacity factor (0–1) — enables annual energy. */
  capacityFactor?: number;
}

export interface HydroResult {
  ok: true;
  netHead: number;
  /** Hydraulic power in the water at net head, W. */
  hydraulicPower: number;
  /** Electrical output, W. */
  outputPower: number;
  annualEnergyKWh: number | null;
  notes: string[];
}

/**
 * Hydropower P = η·ρ·g·Q·H on the NET head.
 *
 * GROSS HEAD IS GEOGRAPHY; NET HEAD IS WHAT THE TURBINE SEES. Friction in the
 * penstock takes metres off the head before the water arrives, and quoting
 * output on gross head overstates every small-hydro project. The loss is a
 * design quantity (Darcy-Weisbach on the actual pipe — the Fluids tools
 * compute it); here it is an input subtracted before the power calculation.
 */
export function hydroPower(inp: HydroInput): HydroResult | EnergyError {
  const rho = inp.waterDensity ?? RHO_WATER;
  const bad = finitePositive([
    ["flow", inp.flow],
    ["gross head", inp.grossHead],
    ["efficiency", inp.efficiency],
    ["water density", rho],
  ]);
  if (bad) return bad;
  if (inp.efficiency > 1) {
    return {
      ok: false,
      error:
        "The efficiency must be a fraction at or below 1 (write 85% as 0.85). " +
        "Water-to-wire efficiencies run 0.6–0.9.",
    };
  }
  if (rho < 900 || rho > 1200) {
    return {
      ok: false,
      error: `${rho} kg/m³ is not a water density (fresh water is ~1000). Check the unit.`,
    };
  }
  const loss = inp.headLoss ?? 0;
  const badLoss = finiteNonNegative([["head loss", loss]]);
  if (badLoss) return badLoss;
  if (loss >= inp.grossHead) {
    return {
      ok: false,
      error:
        `A head loss of ${loss} m consumes the entire ${inp.grossHead} m gross head — ` +
        "no power can be produced. The penstock is undersized for this flow.",
    };
  }

  const notes: string[] = [];
  const netHead = inp.grossHead - loss;
  const pHydraulic = rho * G_STANDARD * inp.flow * netHead;
  const pOut = inp.efficiency * pHydraulic;

  let annual: number | null = null;
  if (inp.capacityFactor !== undefined) {
    if (!Number.isFinite(inp.capacityFactor) || inp.capacityFactor <= 0 || inp.capacityFactor > 1) {
      return { ok: false, error: "The capacity factor must be between 0 and 1." };
    }
    annual = (pOut / 1000) * HOURS_PER_YEAR * inp.capacityFactor;
  }

  if (loss === 0) {
    notes.push(
      "No head loss entered, so this is GROSS-head power. A real penstock loses head to " +
        "friction — the Fluids tools compute it from the pipe; subtracting it here gives " +
        "the honest output."
    );
  }
  notes.push(
    "P = η·ρ·g·Q·H. At η = 1, one m^3/s falling 1 m is 9.81 kW — hydro arithmetic is " +
      "exact enough that discrepancies from measured output usually mean the flow or the " +
      "net head is not what was assumed."
  );

  const res: HydroResult = {
    ok: true,
    netHead,
    hydraulicPower: pHydraulic,
    outputPower: pOut,
    annualEnergyKWh: annual,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Battery pack ------------------------------------------------------------

export interface BatteryInput {
  /** Nominal cell voltage, V. */
  cellVoltage: number;
  /** Cell capacity, Ah. */
  cellCapacityAh: number;
  /** Cells in series. */
  series: number;
  /** Parallel strings. */
  parallel: number;
  /** Load: give ONE of current (A) or power (W). */
  loadCurrentA?: number;
  loadPowerW?: number;
  /** Usable depth of discharge (0–1]. */
  depthOfDischarge?: number;
  /** Peukert exponent — 1 disables the correction. */
  peukertExponent?: number;
  /** Rated discharge time behind the Ah rating, hours (Peukert reference). */
  ratedHours?: number;
  /** Charge current, A — enables charge-time estimate. */
  chargeCurrentA?: number;
}

export interface BatteryResult {
  ok: true;
  packVoltage: number;
  packCapacityAh: number;
  packEnergyWh: number;
  usableEnergyWh: number;
  cellCount: number;
  loadCurrentA: number | null;
  cRate: number | null;
  /** Runtime at the load, hours — null when there is no load. */
  runtimeHours: number | null;
  /** Runtime with the Peukert correction — null when exponent is 1 or no load. */
  runtimePeukertHours: number | null;
  chargeTimeHours: number | null;
  notes: string[];
}

/**
 * Series/parallel pack arithmetic, C-rate, runtime and Peukert correction.
 *
 * THE Ah RATING IS ITSELF RATE-DEPENDENT, which is what Peukert's law
 * describes: a battery rated 100 Ah at the 20-hour rate delivers less than
 * 100 Ah at higher current. The exponent is an empirical, chemistry- and
 * age-dependent measurement (lead-acid 1.1–1.3; Li-ion 1.02–1.1) — it is an
 * input here, and the uncorrected figure is always shown beside the corrected
 * one so the size of the correction is visible.
 *
 * ENERGY FROM NOMINAL VOLTAGE IS AN APPROXIMATION. The real terminal voltage
 * falls through discharge; Wh from V_nominal × Ah is the convention every
 * datasheet uses and is typically within a few percent for Li-ion, worse for
 * lead-acid under load.
 */
export function batteryPack(inp: BatteryInput): BatteryResult | EnergyError {
  const bad = finitePositive([
    ["cell voltage", inp.cellVoltage],
    ["cell capacity", inp.cellCapacityAh],
    ["series count", inp.series],
    ["parallel count", inp.parallel],
  ]);
  if (bad) return bad;
  if (!Number.isInteger(inp.series) || !Number.isInteger(inp.parallel)) {
    return { ok: false, error: "Series and parallel counts are whole numbers of cells." };
  }
  if (inp.series > 10000 || inp.parallel > 10000) {
    return { ok: false, error: "More than 10,000 cells in one dimension is not a pack this models." };
  }
  if (inp.cellVoltage > 6) {
    return {
      ok: false,
      error:
        `${inp.cellVoltage} V is above any single electrochemical cell (Li-ion is 3.6–3.7 ` +
        "nominal, LiFePO₄ 3.2, lead-acid 2.0). If this is a pack voltage, enter the CELL " +
        "voltage and the series count instead.",
    };
  }

  const notes: string[] = [];
  const packV = inp.cellVoltage * inp.series;
  const packAh = inp.cellCapacityAh * inp.parallel;
  const packWh = packV * packAh;
  const dod = inp.depthOfDischarge ?? 1;
  if (!Number.isFinite(dod) || dod <= 0 || dod > 1) {
    return { ok: false, error: "Depth of discharge must be a fraction between 0 and 1." };
  }
  const usableWh = packWh * dod;
  if (inp.depthOfDischarge === undefined) {
    notes.push(
      "No depth of discharge given, so usable energy assumes 100% — which no chemistry " +
        "survives for long. Lead-acid is cycled to ~50%, Li-ion to 80–90%."
    );
  }

  let loadA: number | null = null;
  if (inp.loadCurrentA !== undefined && inp.loadPowerW !== undefined) {
    return { ok: false, error: "Give the load as a current OR a power, not both." };
  }
  if (inp.loadCurrentA !== undefined) {
    const b = finitePositive([["load current", inp.loadCurrentA]]);
    if (b) return b;
    loadA = inp.loadCurrentA;
  } else if (inp.loadPowerW !== undefined) {
    const b = finitePositive([["load power", inp.loadPowerW]]);
    if (b) return b;
    loadA = inp.loadPowerW / packV;
    notes.push(
      "Load current from power assumes the nominal pack voltage; near end of discharge " +
        "the voltage is lower and the current for the same power is higher."
    );
  }

  let cRate: number | null = null;
  let runtime: number | null = null;
  let runtimePeukert: number | null = null;
  if (loadA !== null) {
    cRate = loadA / packAh;
    runtime = (packAh * dod) / loadA;
    const k = inp.peukertExponent ?? 1;
    if (!Number.isFinite(k) || k < 1 || k > 2) {
      return {
        ok: false,
        error:
          "The Peukert exponent is an empirical value between 1 and 2 (lead-acid 1.1–1.3, " +
          "Li-ion 1.02–1.1).",
      };
    }
    if (k > 1) {
      const ratedH = inp.ratedHours ?? 20;
      if (!Number.isFinite(ratedH) || ratedH <= 0 || ratedH > 1000) {
        return { ok: false, error: "The rated discharge time must be a positive number of hours (20 is the common rating)." };
      }
      // Peukert: t = H · (C / (I·H))^k, applied to the usable capacity.
      runtimePeukert = ratedH * Math.pow((packAh * dod) / (loadA * ratedH), k);
      notes.push(
        `Peukert correction uses the ${ratedH}-hour rating: at currents above the rated ` +
          "rate the battery delivers LESS than its nameplate Ah, and more below it. The " +
          "exponent is an empirical, age- and temperature-dependent measurement — " +
          "treat the corrected runtime as an estimate, not a specification.",
      );
    }
    if (cRate > 10) {
      notes.push(
        `This load is ${cRate.toFixed(1)}C — beyond what most cells sustain continuously. ` +
          "High-rate cells are specified to 5–10C; check the cell datasheet's continuous " +
          "discharge rating."
      );
    }
  }

  let chargeH: number | null = null;
  if (inp.chargeCurrentA !== undefined) {
    const b = finitePositive([["charge current", inp.chargeCurrentA]]);
    if (b) return b;
    chargeH = (packAh * dod) / inp.chargeCurrentA;
    notes.push(
      "Charge time is the constant-current estimate. Li-ion chargers finish with a " +
        "constant-voltage phase that adds roughly 20–40% to the time; lead-acid " +
        "absorption adds more."
    );
  }

  notes.push(
    "Pack energy uses the NOMINAL voltage; the real terminal voltage falls through " +
      "discharge, so delivered energy differs by a few percent (more for lead-acid)."
  );

  const res: BatteryResult = {
    ok: true,
    packVoltage: packV,
    packCapacityAh: packAh,
    packEnergyWh: packWh,
    usableEnergyWh: usableWh,
    cellCount: inp.series * inp.parallel,
    loadCurrentA: loadA,
    cRate,
    runtimeHours: runtime,
    runtimePeukertHours: runtimePeukert,
    chargeTimeHours: chargeH,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Combustion stoichiometry ------------------------------------------------

/**
 * Molar composition of dry air used throughout combustion practice: 1 mol O2
 * is accompanied by 3.76 mol of "atmospheric nitrogen" (N2 + argon + trace,
 * lumped). This is the standard textbook convention, stated in the output.
 */
export const AIR_N2_PER_O2 = 3.76;

const DIGIT_TO_SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};

/**
 * A molecular formula typeset the way chemistry writes it: CH4 → CH₄,
 * C8H18 → C₈H₁₈, (NH4)2SO4 → (NH₄)₂SO₄.
 *
 * ONLY a count is a subscript. A digit run after an element symbol or a
 * closing bracket is a count; a LEADING coefficient — the 5 in CuSO₄·5H₂O —
 * multiplies the whole hydrate part and stays full size, because 5H₂O and
 * H₅₂O are different statements. Anything that does not look like a formula
 * is returned unchanged rather than half-typeset.
 */
export function formatFormula(formula: string): string {
  const t = formula.trim();
  if (!t) return formula;
  let out = "";
  let prevEndsGroup = false; // just closed an element symbol or bracket group
  let atPartStart = true; // start of the formula or of a hydrate part
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (/[0-9]/.test(ch)) {
      out += prevEndsGroup && !atPartStart ? DIGIT_TO_SUBSCRIPT[ch] : ch;
      continue; // a digit run keeps its role, so both flags stay as they are
    }
    if (/[₀-₉]/.test(ch)) {
      out += ch; // already a subscript — keep it
      prevEndsGroup = true;
      atPartStart = false;
      continue;
    }
    if (/[·•.*]/.test(ch)) {
      out += "·";
      prevEndsGroup = false;
      atPartStart = true; // the next digit run is a hydrate coefficient
      continue;
    }
    out += ch;
    prevEndsGroup = /[A-Za-z)\]}]/.test(ch);
    atPartStart = false;
  }
  return out;
}

export interface CombustionInput {
  /** Fuel molecular formula, e.g. "CH4", "C8H18", "C2H5OH". */
  formula: string;
  /** Excess air as a fraction (0.2 = 20% excess). Default 0 = stoichiometric. */
  excessAir?: number;
  /** Higher heating value of the fuel, MJ/kg — user-supplied, enables LHV + intensity. */
  hhvMJPerKg?: number;
}

export interface CombustionResult {
  ok: true;
  /** Element counts parsed from the formula. */
  composition: Record<string, number>;
  /** Fuel molar mass, g/mol, from IUPAC atomic weights. */
  molarMass: number;
  /** Mol O2 per mol fuel, stoichiometric. */
  o2PerMolFuel: number;
  /** Stoichiometric air-fuel ratio, kg air per kg fuel. */
  afrStoich: number;
  /** Actual AFR at the given excess air. */
  afrActual: number;
  /** Products per kg fuel, kg. */
  co2PerKgFuel: number;
  h2oPerKgFuel: number;
  so2PerKgFuel: number | null;
  /** LHV derived from the supplied HHV, MJ/kg — null without an HHV. */
  lhvMJPerKg: number | null;
  /** kg CO2 per kWh of fuel energy (HHV basis) — null without an HHV. */
  co2PerKWh: number | null;
  notes: string[];
}

/**
 * Stoichiometric air and combustion products from the fuel's formula alone.
 *
 * EVERYTHING HERE IS EXACT ARITHMETIC ON THE FORMULA — mol O2 = C + H/4 + S −
 * O/2, molar masses from the real IUPAC atomic weights — except two stated
 * conventions: dry air as 1 O2 : 3.76 N2, and complete combustion (all C →
 * CO2, all H → H2O, all S → SO2, fuel N → N2). Incomplete combustion, CO, and
 * NOx are real and are chemistry this tool does not model.
 *
 * THE HEATING VALUE IS NOT COMPUTED, IT IS SUPPLIED. Predicting an HHV from a
 * formula (Dulong etc.) is a correlation with several-percent error dressed as
 * a calculation; the measured value for the actual fuel is the honest input.
 * What IS derived is LHV from HHV — that difference is exactly the latent heat
 * of the water formed, m_H2O × 2.4417 MJ/kg, which follows from the formula.
 */
export function combustion(inp: CombustionInput): CombustionResult | EnergyError {
  const counts = parseFormula(inp.formula ?? "");
  const symbols = Object.keys(counts);
  if (symbols.length === 0) {
    return { ok: false, error: `"${inp.formula}" does not parse as a molecular formula (e.g. CH₄, C₈H₁₈, C₂H₅OH).` };
  }
  const allowed = new Set(["C", "H", "O", "N", "S"]);
  const outside = symbols.filter((s) => !allowed.has(s));
  if (outside.length > 0) {
    return {
      ok: false,
      error:
        `This tool models C/H/O/N/S fuels; "${inp.formula}" contains ${outside.join(", ")}. ` +
        "Metal and halogenated fuels form different products (oxides, acids) and their " +
        "stoichiometry is not a formula this covers.",
    };
  }

  const weightOf = (sym: string): number | null => {
    const z = atomicNumber(sym);
    return z === null ? null : atomicWeight(z);
  };
  // Derived molar masses from the same periodic table the rest of the product
  // uses — never retyped constants that could drift out of consistency.
  const wC = weightOf("C")!;
  const wH = weightOf("H")!;
  const wO = weightOf("O")!;
  const wN = weightOf("N")!;
  const wS = weightOf("S")!;

  const nC = counts.C ?? 0;
  const nH = counts.H ?? 0;
  const nO = counts.O ?? 0;
  const nN = counts.N ?? 0;
  const nS = counts.S ?? 0;
  if (nC + nH + nS === 0) {
    return {
      ok: false,
      error: `"${inp.formula}" has nothing to oxidise — a fuel needs carbon, hydrogen or sulfur.`,
    };
  }
  // The largest molecular species anyone burns as a discrete compound —
  // waxes, asphaltene models, fullerenes — sit in the hundreds of atoms. Ten
  // thousand catches a pasted polymer or a repeat-typo without touching any
  // real fuel; polymers are written as their repeat unit ((C2H4)n → C2H4).
  const total = nC + nH + nO + nN + nS;
  if (total > 10000) {
    return {
      ok: false,
      error:
        "This formula is too large to be a molecular fuel. For a polymer, use the repeat " +
        "unit (polyethylene → C₂H₄) — the ratios, AFR and CO₂ per kg are identical.",
    };
  }

  const excess = inp.excessAir ?? 0;
  if (!Number.isFinite(excess) || excess < 0 || excess > 10) {
    return {
      ok: false,
      error: "Excess air is a fraction from 0 (stoichiometric) to a few tenths (0.2 = 20% excess).",
    };
  }

  const M = nC * wC + nH * wH + nO * wO + nN * wN + nS * wS;
  const o2 = nC + nH / 4 + nS - nO / 2;
  if (o2 <= 0) {
    return {
      ok: false,
      error:
        `"${inp.formula}" carries more oxygen than its fuel content can use — it does not ` +
        "need air to burn (it is at or past complete oxidation).",
    };
  }

  // kg air per kg fuel: mol O2 × (M_O2 + 3.76 × M_N2) / M_fuel, with the
  // molecular masses derived from the same atomic weights.
  const mO2 = 2 * wO;
  const mN2 = 2 * wN;
  const mAirPerMolO2 = mO2 + AIR_N2_PER_O2 * mN2;
  const afr = (o2 * mAirPerMolO2) / M;
  const afrActual = afr * (1 + excess);

  const co2 = (nC * (wC + 2 * wO)) / M;
  const h2o = ((nH / 2) * (2 * wH + wO)) / M;
  const so2 = nS > 0 ? (nS * (wS + 2 * wO)) / M : null;

  const notes: string[] = [
    "Air is modelled as 1 mol O₂ : 3.76 mol N₂ (the textbook convention lumping argon " +
      "into 'atmospheric nitrogen'); AFR shifts by ~1% under other conventions.",
    "Complete combustion is assumed: all C → CO₂, H → H₂O, S → SO₂, fuel N → N₂. Real " +
      "flames make CO under rich conditions and NOx at high temperature — neither is " +
      "modelled here.",
  ];

  let lhv: number | null = null;
  let co2PerKWh: number | null = null;
  if (inp.hhvMJPerKg !== undefined) {
    const b = finitePositive([["higher heating value", inp.hhvMJPerKg]]);
    if (b) return b;
    if (inp.hhvMJPerKg > 150) {
      return {
        ok: false,
        error:
          `${inp.hhvMJPerKg} MJ/kg is beyond any chemical fuel (hydrogen, the highest, is ` +
          "~142). Check the unit — this field wants MJ/kg.",
      };
    }
    lhv = inp.hhvMJPerKg - h2o * (H_FG_WATER_25C / 1e6);
    if (lhv <= 0) {
      return {
        ok: false,
        error:
          `An HHV of ${inp.hhvMJPerKg} MJ/kg is smaller than the latent heat of this fuel's ` +
          `own combustion water (${(h2o * (H_FG_WATER_25C / 1e6)).toFixed(2)} MJ/kg) — the ` +
          "two numbers are inconsistent. The HHV is probably for a different fuel or unit.",
      };
    }
    // kg CO2 per kWh of fuel energy, HHV basis: 1 kWh = 3.6 MJ.
    co2PerKWh = co2 / (inp.hhvMJPerKg / 3.6);
    notes.push(
      "LHV = HHV − latent heat of the combustion water (2.4417 MJ per kg of H₂O at " +
        "25 °C) — derived from the formula's hydrogen content. Condensing appliances " +
        "recover part of that difference; everything else is bounded by LHV.",
      "CO₂ intensity is per kWh of FUEL energy (HHV basis), not per kWh of electricity — " +
        "divide by the plant efficiency for the generation figure."
    );
  } else {
    notes.push(
      "Heating values are MEASURED properties of the actual fuel blend and are taken as " +
        "input, not predicted — formula-based correlations (Dulong) carry several percent " +
        "error. Supply the HHV to get LHV and CO₂ intensity."
    );
  }

  const res: CombustionResult = {
    ok: true,
    composition: counts,
    molarMass: M,
    o2PerMolFuel: o2,
    afrStoich: afr,
    afrActual,
    co2PerKgFuel: co2,
    h2oPerKgFuel: h2o,
    so2PerKgFuel: so2,
    lhvMJPerKg: lhv,
    co2PerKWh,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- LCOE + capacity factor --------------------------------------------------

export interface LcoeInput {
  /** Total capital cost at year 0. */
  capex: number;
  /** Annual operating cost, year-1 money. */
  annualOpex: number;
  /** First-year energy, MWh. */
  annualEnergyMWh: number;
  /** Discount rate as a fraction (0.07 = 7%). */
  discountRate: number;
  /** Project lifetime, whole years, 1–100. */
  lifetimeYears: number;
  /** Annual output degradation as a fraction (0.005 = 0.5%/yr). Default 0. */
  degradationRate?: number;
}

export interface LcoeResult {
  ok: true;
  /** Levelized cost per MWh, in the currency the costs were given in. */
  lcoePerMWh: number;
  /** The same per kWh. */
  lcoePerKWh: number;
  presentValueCosts: number;
  presentValueMWh: number;
  notes: string[];
}

/**
 * Levelized cost of energy: discounted lifetime costs over discounted lifetime
 * generation.
 *
 * ENERGY IS DISCOUNTED TOO, and that surprises people every time. The
 * denominator Σ E_t/(1+r)^t is not a claim that electrons decay — it is the
 * algebra that makes LCOE the constant price which, earned on every MWh,
 * exactly repays the discounted costs. Skipping it understates the cost of
 * capital-heavy projects, which is every renewable.
 */
export function lcoe(inp: LcoeInput): LcoeResult | EnergyError {
  const bad = finitePositive([
    ["capital cost", inp.capex],
    ["annual energy", inp.annualEnergyMWh],
  ]);
  if (bad) return bad;
  const badOpex = finiteNonNegative([["annual operating cost", inp.annualOpex]]);
  if (badOpex) return badOpex;
  if (!Number.isFinite(inp.discountRate) || inp.discountRate < 0 || inp.discountRate > 0.5) {
    return { ok: false, error: "The discount rate is a fraction, typically 0.03–0.12 (7% → 0.07)." };
  }
  if (!Number.isInteger(inp.lifetimeYears) || inp.lifetimeYears < 1 || inp.lifetimeYears > 100) {
    return { ok: false, error: "The lifetime must be a whole number of years from 1 to 100." };
  }
  const deg = inp.degradationRate ?? 0;
  if (!Number.isFinite(deg) || deg < 0 || deg >= 1) {
    return { ok: false, error: "Degradation is a small fraction per year (0.005 = 0.5%)." };
  }

  // Explicit year loop — bounded at 100 above, and clearer than the geometric
  // closed form once degradation and discounting compound differently.
  let pvCosts = inp.capex;
  let pvEnergy = 0;
  for (let t = 1; t <= inp.lifetimeYears; t++) {
    const df = Math.pow(1 + inp.discountRate, -t);
    pvCosts += inp.annualOpex * df;
    pvEnergy += inp.annualEnergyMWh * Math.pow(1 - deg, t - 1) * df;
  }
  if (pvEnergy <= 0 || !Number.isFinite(pvEnergy) || !Number.isFinite(pvCosts)) {
    return { ok: false, error: "These inputs produce no discounted generation — check the magnitudes." };
  }

  const perMWh = pvCosts / pvEnergy;
  const notes = [
    "LCOE compares technologies on cost alone — it carries no information about WHEN the " +
      "energy arrives. A dispatchable and an intermittent source at the same LCOE are " +
      "not equivalent products.",
    "Use a REAL (inflation-adjusted) discount rate with costs in constant money, or a " +
      "nominal rate with inflated costs — mixing the two is the classic LCOE error.",
  ];
  if (deg > 0) {
    notes.push(
      `Output degrades at ${(deg * 100).toFixed(2)}%/yr, so year ${inp.lifetimeYears} produces ` +
        `${(Math.pow(1 - deg, inp.lifetimeYears - 1) * 100).toFixed(1)}% of year 1.`
    );
  }

  const res: LcoeResult = {
    ok: true,
    lcoePerMWh: perMWh,
    lcoePerKWh: perMWh / 1000,
    presentValueCosts: pvCosts,
    presentValueMWh: pvEnergy,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

export interface CapacityFactorResult {
  ok: true;
  capacityFactor: number;
  /** Energy the plant would make at 100% output, MWh. */
  maximumMWh: number;
  equivalentFullLoadHours: number;
  notes: string[];
}

/** Capacity factor from nameplate power and energy actually generated. */
export function capacityFactor(
  nameplateMW: number,
  energyMWh: number,
  periodHours = HOURS_PER_YEAR
): CapacityFactorResult | EnergyError {
  const bad = finitePositive([
    ["nameplate capacity", nameplateMW],
    ["generated energy", energyMWh],
    ["period", periodHours],
  ]);
  if (bad) return bad;
  if (periodHours > 24 * 366 * 100) {
    return { ok: false, error: "The period is longer than a century — check the units (hours)." };
  }
  const maxMWh = nameplateMW * periodHours;
  const cf = energyMWh / maxMWh;
  if (cf > 1) {
    return {
      ok: false,
      error:
        `${energyMWh} MWh exceeds what ${nameplateMW} MW can produce in ${periodHours} hours ` +
        `(${maxMWh.toFixed(0)} MWh) — a capacity factor above 1 means one of these numbers ` +
        "is wrong, usually the period or a MW/MWh mix-up.",
    };
  }
  const notes = [
    "Capacity factor folds every source of downtime and derating into one number — " +
      "resource variability, maintenance, curtailment. Typical: nuclear 0.90+, onshore " +
      "wind 0.25–0.40, solar 0.15–0.25 depending on site.",
  ];
  const res: CapacityFactorResult = {
    ok: true,
    capacityFactor: cf,
    maximumMWh: maxMWh,
    equivalentFullLoadHours: cf * periodHours,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Wind shear --------------------------------------------------------------

export interface WindShearInput {
  /** Measured speed, m/s, at the reference height. */
  refSpeed: number;
  /** Reference (measurement) height, m. */
  refHeight: number;
  /** Target (hub) height, m. */
  targetHeight: number;
  /** Power-law exponent (1/7 open terrain is the classic default). */
  alpha?: number;
  /** Roughness length for the log law, m (0.03 open grass, 0.5+ suburbs). */
  roughnessM?: number;
}

export interface WindShearResult {
  ok: true;
  /** Speed at target height by the power law — null if no alpha given. */
  powerLawSpeed: number | null;
  /** Speed at target height by the log law — null if no roughness given. */
  logLawSpeed: number | null;
  /** Fractional disagreement between the two — null unless both ran. */
  disagreement: number | null;
  /** Cube of the speed ratio (power law preferred, else log) — the energy factor. */
  powerRatio: number;
  notes: string[];
}

/**
 * Extrapolates a measured wind speed to hub height — the gap the wind-power
 * tool itself points at: resource is measured at 10 m and turbines live at
 * 80–120 m, and the CUBE law turns a modest speed correction into a large
 * energy one.
 *
 * TWO INDEPENDENT MODELS, BOTH REPORTED. The power law (v ∝ h^α) and the log
 * law (v ∝ ln(h/z0)) are different physics fitted to the same layer; when the
 * user supplies both parameters the two answers and their disagreement are
 * shown, because agreement is evidence and disagreement means the site's
 * profile is not textbook — the same design as Routh vs eigenvalues in
 * control.ts. Both parameters are SITE measurements taken as input.
 */
export function windShear(inp: WindShearInput): WindShearResult | EnergyError {
  const bad = finitePositive([
    ["measured speed", inp.refSpeed],
    ["reference height", inp.refHeight],
    ["target height", inp.targetHeight],
  ]);
  if (bad) return bad;
  if (inp.alpha === undefined && inp.roughnessM === undefined) {
    return {
      ok: false,
      error:
        "Give a power-law exponent (1/7 = 0.143 for open terrain) or a roughness length " +
        "(0.03 m open grass), or both to compare the two models.",
    };
  }

  const notes: string[] = [];
  let vPower: number | null = null;
  if (inp.alpha !== undefined) {
    if (!Number.isFinite(inp.alpha) || inp.alpha <= 0 || inp.alpha > 1) {
      return { ok: false, error: "The shear exponent is a fraction, typically 0.1–0.4 (1/7 = 0.143 open terrain)." };
    }
    vPower = inp.refSpeed * Math.pow(inp.targetHeight / inp.refHeight, inp.alpha);
  }

  let vLog: number | null = null;
  if (inp.roughnessM !== undefined) {
    if (!Number.isFinite(inp.roughnessM) || inp.roughnessM <= 0) {
      return { ok: false, error: "The roughness length must be a positive number of metres (0.0002 open sea to ~1 city)." };
    }
    if (inp.refHeight <= inp.roughnessM || inp.targetHeight <= inp.roughnessM) {
      return {
        ok: false,
        error:
          `The log law is undefined at or below the roughness length (${inp.roughnessM} m) — ` +
          "both heights must be above it, and a roughness of that size next to these heights " +
          "usually means the unit is wrong.",
      };
    }
    vLog = (inp.refSpeed * Math.log(inp.targetHeight / inp.roughnessM)) / Math.log(inp.refHeight / inp.roughnessM);
  }

  let disagreement: number | null = null;
  if (vPower !== null && vLog !== null) {
    disagreement = Math.abs(vPower - vLog) / ((vPower + vLog) / 2);
    if (disagreement > 0.1) {
      notes.push(
        "The two models disagree by more than 10% — the parameters describe different " +
          "terrain. Neither answer should be trusted for an energy estimate until the site's " +
          "own measured profile settles which is right."
      );
    } else {
      notes.push("The two models agree closely, which is evidence the extrapolation is reasonable for this terrain.");
    }
  }

  const vBest = vPower ?? vLog!;
  const powerRatio = Math.pow(vBest / inp.refSpeed, 3);
  notes.push(
    "Both laws describe a NEUTRALLY STRATIFIED boundary layer averaged over time; a single " +
      "gust or a stable night profile follows neither. The exponent and roughness are site " +
      "measurements, not constants of nature — 1/7 is a habit, not a law.",
    "The energy consequence is the CUBE of the speed ratio, shown as the power ratio — a 15% " +
      "speed gain at hub height is a 52% power gain."
  );

  const res: WindShearResult = {
    ok: true,
    powerLawSpeed: vPower,
    logLawSpeed: vLog,
    disagreement,
    powerRatio,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Weibull wind resource ---------------------------------------------------

/** Γ(x) for x > 0, via the same Lanczos log-gamma under every p-value. */
function gammaFn(x: number): number {
  return Math.exp(gammaln(x));
}

export interface WeibullInput {
  /** Weibull shape k (site measurement; ~2 inland, higher offshore). */
  shape: number;
  /** Give ONE of: scale c (m/s) or the measured mean speed (m/s). */
  scale?: number;
  meanSpeed?: number;
  /** Air density, kg/m^3. */
  airDensity?: number;
  /** Optional turbine for a capacity-factor estimate. */
  turbine?: {
    cutIn: number;
    rated: number;
    cutOut: number;
  };
}

export interface WeibullResult {
  ok: true;
  shape: number;
  scale: number;
  meanSpeed: number;
  /** Most probable speed, m/s — null for k <= 1 (mode at zero). */
  mostProbableSpeed: number | null;
  /** Mean wind power density, W/m^2: ½ρc³Γ(1+3/k). */
  meanPowerDensity: number;
  /** Ratio of mean-cube to cube-of-mean — why mean speed understates energy. */
  energyPatternFactor: number;
  /** Capacity-factor estimate — null without a turbine. */
  capacityFactor: number | null;
  /** Fraction of hours inside the operating band — null without a turbine. */
  availabilityFraction: number | null;
  notes: string[];
}

/**
 * Weibull statistics of a wind site, and the capacity factor they imply.
 *
 * THE MEAN SPEED UNDERSTATES THE RESOURCE, always. Power goes as v³ and the
 * cube of the mean is less than the mean of the cube for any spread; the
 * energy pattern factor Γ(1+3/k)/Γ(1+1/k)³ quantifies it — about 1.9 at the
 * common k = 2, meaning a site holds nearly twice the energy its mean speed
 * suggests. This single fact is why resource assessment fits a distribution
 * instead of quoting an average.
 *
 * The capacity factor integrates the Weibull density against the STANDARD
 * SIMPLIFIED power curve — cubic rise from cut-in to rated, flat to cut-out
 * (stated, because a real curve's knee is softer and real CF runs a little
 * lower). k and the mean/scale are SITE measurements taken as input.
 */
export function weibullWind(inp: WeibullInput): WeibullResult | EnergyError {
  const k = inp.shape;
  if (!Number.isFinite(k) || k <= 0.5 || k > 10) {
    return { ok: false, error: "The Weibull shape k is a site measurement, typically 1.5–3 (2 is the Rayleigh case)." };
  }
  if ((inp.scale === undefined) === (inp.meanSpeed === undefined)) {
    return { ok: false, error: "Give the scale c OR the mean speed — each determines the other through Γ(1+1/k)." };
  }
  const g1 = gammaFn(1 + 1 / k);
  let c: number;
  if (inp.scale !== undefined) {
    const b = finitePositive([["scale parameter", inp.scale]]);
    if (b) return b;
    c = inp.scale;
  } else {
    const b = finitePositive([["mean speed", inp.meanSpeed!]]);
    if (b) return b;
    c = inp.meanSpeed! / g1;
  }
  if (c > 50) {
    return { ok: false, error: `A scale of ${c.toFixed(1)} m/s is beyond any wind climate on Earth — check the unit.` };
  }
  const rho = inp.airDensity ?? RHO_AIR_SL;
  const bRho = finitePositive([["air density", rho]]);
  if (bRho) return bRho;
  if (rho > 2 || rho < 0.1) {
    return { ok: false, error: `An air density of ${rho} kg/m³ is outside Earth's atmosphere — this field wants kg/m³.` };
  }

  const mean = c * g1;
  const g3 = gammaFn(1 + 3 / k);
  const meanPowerDensity = 0.5 * rho * c * c * c * g3;
  const epf = g3 / (g1 * g1 * g1);
  const mostProbable = k > 1 ? c * Math.pow((k - 1) / k, 1 / k) : null;

  const notes: string[] = [
    `The energy pattern factor is ${epf.toFixed(2)}: the site holds ${epf.toFixed(2)}× the energy ` +
      "its mean speed suggests, because power goes as v³ and the spread contributes " +
      "disproportionately. Quoting mean speed alone always undersells a windy site.",
  ];

  let cf: number | null = null;
  let avail: number | null = null;
  if (inp.turbine) {
    const { cutIn, rated, cutOut } = inp.turbine;
    const b = finitePositive([
      ["cut-in speed", cutIn],
      ["rated speed", rated],
      ["cut-out speed", cutOut],
    ]);
    if (b) return b;
    if (!(cutIn < rated && rated < cutOut)) {
      return { ok: false, error: "Turbine speeds must satisfy cut-in < rated < cut-out." };
    }
    const F = (v: number): number => 1 - Math.exp(-Math.pow(v / c, k));
    // Cubic-rise band, integrated numerically with a FIXED bounded step count.
    const STEPS = 4000;
    let sum = 0;
    const ci3 = cutIn ** 3;
    const denom = rated ** 3 - ci3;
    for (let i = 0; i < STEPS; i++) {
      const v = cutIn + ((i + 0.5) / STEPS) * (rated - cutIn);
      const pdf = (k / c) * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k));
      sum += ((v ** 3 - ci3) / denom) * pdf;
    }
    cf = sum * ((rated - cutIn) / STEPS) + (F(cutOut) - F(rated));
    avail = F(cutOut) - F(cutIn);
    notes.push(
      "The capacity factor uses the standard simplified power curve — cubic from cut-in to " +
        "rated, flat to cut-out, dead outside. A real curve's knee is softer, so the real CF " +
        "runs somewhat lower; for a bankable figure integrate the manufacturer's curve.",
      "Availability here is hours inside the operating band, not mechanical availability — " +
        "maintenance downtime is on top."
    );
  }

  const res: WeibullResult = {
    ok: true,
    shape: k,
    scale: c,
    meanSpeed: mean,
    mostProbableSpeed: mostProbable,
    meanPowerDensity,
    energyPatternFactor: epf,
    capacityFactor: cf,
    availabilityFraction: avail,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Flue-gas analysis -------------------------------------------------------

export interface FlueGasInput {
  /** Fuel molecular formula, as in the combustion tool. */
  formula: string;
  /** Measured O2 in the DRY flue gas, percent (what an analyser reads). */
  o2DryPct: number;
}

export interface FlueGasResult {
  ok: true;
  /** Excess air solved from the measurement, as a fraction. */
  excessAir: number;
  afrActual: number;
  /** Dry flue composition at the solved excess air, mole percent. */
  dryCO2Pct: number;
  dryO2Pct: number;
  dryN2Pct: number;
  drySO2Pct: number | null;
  /** The maximum ("ultimate") dry CO2 percent, at exactly stoichiometric air. */
  ultimateCO2Pct: number;
  notes: string[];
}

/**
 * Excess air from a flue-gas oxygen measurement — the practical direction.
 *
 * Nobody sets excess air by guessing: the analyser reads the DRY flue O₂ and
 * the excess follows from stoichiometry. This inverts the combustion tool's
 * arithmetic in closed form, on the same air convention (1 O₂ : 3.76 N₂), so
 * the two tools cannot disagree — the fraction of O₂ in the model air,
 * 1/4.76, is DERIVED from that ratio rather than typed as 20.9.
 */
export function flueGas(inp: FlueGasInput): FlueGasResult | EnergyError {
  const base = combustion({ formula: inp.formula });
  if (!base.ok) return base;
  const f = inp.o2DryPct / 100;
  const o2AirFraction = 1 / (1 + AIR_N2_PER_O2);
  if (!Number.isFinite(inp.o2DryPct) || inp.o2DryPct < 0) {
    return { ok: false, error: "The flue O₂ reading must be zero or a positive percentage." };
  }
  if (f >= o2AirFraction) {
    return {
      ok: false,
      error:
        `${inp.o2DryPct}% O₂ is at or above air itself (${(o2AirFraction * 100).toFixed(1)}% in the ` +
        "dry-air model) — the analyser is reading air, not flue gas, or the probe is leaking.",
    };
  }

  const counts = base.composition;
  const nC = counts.C ?? 0;
  const nN = counts.N ?? 0;
  const nS = counts.S ?? 0;
  const a = base.o2PerMolFuel;
  // Dry flue at excess e (per mol fuel): CO2 = nC, SO2 = nS, O2 = e·a,
  // N2 = 3.76·a·(1+e) + nN/2. Solving f = e·a / (dry total) for e is linear.
  const dryBase = nC + nS + AIR_N2_PER_O2 * a + nN / 2;
  const denomE = a * (1 - f * (1 + AIR_N2_PER_O2));
  const e = (f * dryBase) / denomE;
  if (!Number.isFinite(e) || e < 0) {
    return { ok: false, error: "This O₂ reading is not reachable for this fuel — check the fuel formula and the reading." };
  }
  if (e > 10) {
    return {
      ok: false,
      error:
        `${inp.o2DryPct}% flue O₂ implies ${(e * 100).toFixed(0)}% excess air — the burner is ` +
        "mostly heating air. Readings this close to air usually mean dilution before the probe.",
    };
  }

  const dryTotal = nC + nS + e * a + AIR_N2_PER_O2 * a * (1 + e) + nN / 2;
  const stoichTotal = nC + nS + AIR_N2_PER_O2 * a + nN / 2;
  const notes = [
    "DRY basis throughout — the analyser condenses the water out, which is why the O₂ and " +
      "CO₂ percentages both read higher than in the wet stack gas.",
    "Same air convention as the combustion tool (1 O₂ : 3.76 N₂, derived not retyped), " +
      "complete combustion assumed. CO in the flue means the excess-air figure here is an " +
      "underestimate — fix the combustion before trusting the number.",
    "The ultimate CO₂ is this fuel's fingerprint: the dry CO₂ can never exceed it, and " +
      "the gap between measured and ultimate CO₂ is the classic cross-check on the O₂ reading.",
  ];

  const res: FlueGasResult = {
    ok: true,
    excessAir: e,
    afrActual: base.afrStoich * (1 + e),
    dryCO2Pct: (100 * nC) / dryTotal,
    dryO2Pct: (100 * e * a) / dryTotal,
    dryN2Pct: (100 * (AIR_N2_PER_O2 * a * (1 + e) + nN / 2)) / dryTotal,
    drySO2Pct: nS > 0 ? (100 * nS) / dryTotal : null,
    ultimateCO2Pct: (100 * nC) / stoichTotal,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Storage sizing + LCOS ---------------------------------------------------

export interface StorageInput {
  /** Daily load to be served, kWh. */
  dailyLoadKWh: number;
  /** Days the bank must carry the load with no input. */
  autonomyDays: number;
  /** Usable depth of discharge, 0-1. */
  depthOfDischarge: number;
  /** Round-trip efficiency of the storage itself, 0-1. */
  roundTripEff: number;
  /** Inverter/conversion efficiency, 0-1 (blank = 1). */
  inverterEff?: number;
  /** DC bus voltage, V — enables the Ah figure. */
  busVoltage?: number;
  /** Optional economics for LCOS. */
  economics?: {
    capex: number;
    annualOpex: number;
    cyclesPerYear: number;
    lifetimeYears: number;
    discountRate: number;
    /** Capacity fade per year, fraction (blank = none). */
    degradationRate?: number;
  };
}

export interface StorageResult {
  ok: true;
  /** Nameplate bank energy required, kWh. */
  bankKWh: number;
  usableKWh: number;
  bankAh: number | null;
  /** Energy that must be supplied to recharge one day's load, kWh. */
  dailyChargeKWh: number;
  /** Levelized cost per kWh DISCHARGED — null without economics. */
  lcosPerKWh: number | null;
  presentValueCosts: number | null;
  presentValueKWh: number | null;
  notes: string[];
}

/**
 * Battery bank sizing from the load, and the levelized cost of storage.
 *
 * THE LOSSES COMPOUND UPSTREAM: the bank must be sized for the load AFTER
 * the inverter takes its cut, and the charger must supply the load divided
 * by the whole efficiency chain. Sizing on the nameplate kWh with the DoD
 * and efficiencies left out — the spreadsheet default — undersizes an
 * off-grid bank by a third or more.
 *
 * LCOS divides discounted costs by discounted DISCHARGED energy, the same
 * algebra as LCOE. It deliberately EXCLUDES the cost of the charging energy,
 * and says so — with a charging price, add price × annual charge energy to
 * the operating cost and the formula carries it.
 */
export function storageSizing(inp: StorageInput): StorageResult | EnergyError {
  const bad = finitePositive([
    ["daily load", inp.dailyLoadKWh],
    ["autonomy days", inp.autonomyDays],
  ]);
  if (bad) return bad;
  for (const [name, v] of [
    ["depth of discharge", inp.depthOfDischarge],
    ["round-trip efficiency", inp.roundTripEff],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0 || v > 1) {
      return { ok: false, error: `The ${name} must be a fraction between 0 and 1.` };
    }
  }
  const invEff = inp.inverterEff ?? 1;
  if (!Number.isFinite(invEff) || invEff <= 0 || invEff > 1) {
    return { ok: false, error: "The inverter efficiency must be a fraction between 0 and 1." };
  }
  if (inp.autonomyDays > 60) {
    return { ok: false, error: "More than 60 days of autonomy is a fuel dump, not a battery bank — check the number." };
  }

  // Discharge-side efficiency: the square root convention splits round-trip
  // losses evenly between charge and discharge, and is stated.
  const dischargeEff = Math.sqrt(inp.roundTripEff);
  const usableNeeded = (inp.dailyLoadKWh * inp.autonomyDays) / (invEff * dischargeEff);
  const bankKWh = usableNeeded / inp.depthOfDischarge;
  const dailyCharge = inp.dailyLoadKWh / (invEff * inp.roundTripEff);

  let bankAh: number | null = null;
  if (inp.busVoltage !== undefined) {
    const b = finitePositive([["bus voltage", inp.busVoltage]]);
    if (b) return b;
    bankAh = (bankKWh * 1000) / inp.busVoltage;
  }

  const notes = [
    "Round-trip losses are split evenly between charge and discharge (the square-root " +
      "convention, stated because datasheets rarely say which side their number lives on).",
    "Sized for the END of the autonomy period at the stated DoD — cycling to that depth " +
      "daily is a different, harder duty than surviving it occasionally; check the cycle " +
      "life at this DoD on the cell datasheet.",
  ];

  let lcos: number | null = null;
  let pvCosts: number | null = null;
  let pvKWh: number | null = null;
  if (inp.economics) {
    const ec = inp.economics;
    const b = finitePositive([
      ["capital cost", ec.capex],
      ["cycles per year", ec.cyclesPerYear],
    ]);
    if (b) return b;
    const bOpex = finiteNonNegative([["annual operating cost", ec.annualOpex]]);
    if (bOpex) return bOpex;
    if (!Number.isInteger(ec.lifetimeYears) || ec.lifetimeYears < 1 || ec.lifetimeYears > 100) {
      return { ok: false, error: "The lifetime must be a whole number of years from 1 to 100." };
    }
    if (!Number.isFinite(ec.discountRate) || ec.discountRate < 0 || ec.discountRate > 0.5) {
      return { ok: false, error: "The discount rate is a fraction, typically 0.03–0.12." };
    }
    if (ec.cyclesPerYear > 2000) {
      return { ok: false, error: "More than 2000 cycles a year is more than five a day — check the number." };
    }
    const deg = ec.degradationRate ?? 0;
    if (!Number.isFinite(deg) || deg < 0 || deg >= 1) {
      return { ok: false, error: "Degradation is a small fraction per year (0.02 = 2%)." };
    }
    const dischargedPerCycle = bankKWh * inp.depthOfDischarge * dischargeEff;
    let costs = ec.capex;
    let energy = 0;
    for (let t = 1; t <= ec.lifetimeYears; t++) {
      const df = Math.pow(1 + ec.discountRate, -t);
      costs += ec.annualOpex * df;
      energy += ec.cyclesPerYear * dischargedPerCycle * Math.pow(1 - deg, t - 1) * df;
    }
    if (energy <= 0 || !Number.isFinite(energy) || !Number.isFinite(costs)) {
      return { ok: false, error: "These economics produce no discounted throughput — check the magnitudes." };
    }
    lcos = costs / energy;
    pvCosts = costs;
    pvKWh = energy;
    notes.push(
      "LCOS excludes the cost of the CHARGING energy on purpose — it prices the storage " +
        "service alone. To include it, add electricity price × annual charge energy " +
        `(${(ec.cyclesPerYear * (dischargedPerCycle / inp.roundTripEff)).toFixed(0)} kWh/yr here) to the operating cost.`,
      "Cycle life and calendar life both bound the real lifetime; the shorter one governs, " +
        "and the cycle count at THIS depth of discharge is the datasheet number to check."
    );
  }

  const res: StorageResult = {
    ok: true,
    bankKWh,
    usableKWh: bankKWh * inp.depthOfDischarge,
    bankAh,
    dailyChargeKWh: dailyCharge,
    lcosPerKWh: lcos,
    presentValueCosts: pvCosts,
    presentValueKWh: pvKWh,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}

// --- Solar geometry ----------------------------------------------------------

export interface SolarGeometryInput {
  /** Latitude, degrees, north positive. */
  latitudeDeg: number;
  /** Day of year, 1–366. */
  dayOfYear: number;
  /** Solar time, hours 0–24 — enables position at that hour. */
  solarHour?: number;
}

export interface SolarGeometryResult {
  ok: true;
  declinationDeg: number;
  /** Day length, hours — 0 for polar night, 24 for polar day. */
  dayLengthHours: number;
  /** Solar elevation at solar noon, degrees. */
  noonElevationDeg: number;
  /** Daily extraterrestrial irradiation on a horizontal plane, kWh/m². */
  extraterrestrialKWhM2: number;
  /** Elevation/azimuth at the given hour — null without an hour. */
  hourElevationDeg: number | null;
  /** Azimuth measured from north, clockwise, degrees. */
  hourAzimuthDeg: number | null;
  notes: string[];
}

/** Modern total solar irradiance, W/m² — same constant the PV tool's bound uses. */
export const SOLAR_CONSTANT = 1361;

const DEG = Math.PI / 180;

/**
 * Sun position and day length from latitude and date — pure astronomy, no
 * site data, which is exactly why it can be computed while insolation cannot.
 *
 * Declination uses Cooper's equation (±0.5° against the ephemeris — stated,
 * and irrelevant next to weather for energy purposes). POLAR CASES ARE REAL
 * ANSWERS, NOT ERRORS: above the polar circle the sunset equation's cosine
 * leaves [−1, 1], and the honest result is a 0- or 24-hour day, named.
 *
 * The daily extraterrestrial total H₀ is the ceiling the ATMOSPHERE then
 * discounts — a clear day delivers ~70–75% of it at the surface. It uses the
 * same 1361 W/m² solar constant as the PV tool's irradiance bound, so the two
 * tools cannot disagree about the Sun.
 */
export function solarGeometry(inp: SolarGeometryInput): SolarGeometryResult | EnergyError {
  const lat = inp.latitudeDeg;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: "Latitude runs -90 to 90 degrees (north positive)." };
  }
  if (!Number.isFinite(inp.dayOfYear) || !Number.isInteger(inp.dayOfYear) || inp.dayOfYear < 1 || inp.dayOfYear > 366) {
    return { ok: false, error: "The day of year is a whole number from 1 to 366 (Jun 21 is 172)." };
  }

  const n = inp.dayOfYear;
  const decl = 23.45 * Math.sin(DEG * ((360 * (284 + n)) / 365));
  const phi = lat * DEG;
  const delta = decl * DEG;

  const notes: string[] = [
    "Declination by Cooper's equation, within ±0.5° of the ephemeris — negligible next to " +
      "weather for any energy purpose. Times are SOLAR time; clock time differs by the " +
      "equation of time (±16 min through the year) plus 4 minutes per degree of longitude " +
      "off the zone meridian.",
  ];

  // Sunset hour angle: cos ωs = −tanφ·tanδ. Out of range = polar day/night.
  const x = -Math.tan(phi) * Math.tan(delta);
  let omegaS: number;
  let dayLength: number;
  if (x <= -1) {
    omegaS = Math.PI;
    dayLength = 24;
    notes.push("The Sun does not set on this date at this latitude — polar day; the 24-hour figure is the real answer.");
  } else if (x >= 1) {
    omegaS = 0;
    dayLength = 0;
    notes.push("The Sun does not rise on this date at this latitude — polar night; zero hours is the real answer.");
  } else {
    omegaS = Math.acos(x);
    dayLength = (2 * omegaS) / DEG / 15;
  }

  const noonElevation = 90 - Math.abs(lat - decl);
  // H0 = (24/π)·Gsc·E0·(cosφcosδ·sinωs + ωs·sinφsinδ), J/m² with Gsc in W and
  // the leading 24 h in seconds — expressed directly in kWh/m².
  const e0 = 1 + 0.033 * Math.cos(DEG * ((360 * n) / 365));
  const h0Wh =
    ((24 / Math.PI) * SOLAR_CONSTANT * e0 * (Math.cos(phi) * Math.cos(delta) * Math.sin(omegaS) + omegaS * Math.sin(phi) * Math.sin(delta))) /
    1;
  const h0 = Math.max(0, h0Wh) / 1000;

  let hourElev: number | null = null;
  let hourAz: number | null = null;
  if (inp.solarHour !== undefined) {
    if (!Number.isFinite(inp.solarHour) || inp.solarHour < 0 || inp.solarHour > 24) {
      return { ok: false, error: "The solar hour runs 0 to 24 (12 = solar noon)." };
    }
    const omega = (inp.solarHour - 12) * 15 * DEG;
    const sinElev = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(omega);
    hourElev = Math.asin(Math.max(-1, Math.min(1, sinElev))) / DEG;
    // Azimuth from north, clockwise, via atan2 — no quadrant ambiguity.
    const az = Math.atan2(
      Math.sin(omega),
      Math.cos(omega) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi)
    );
    hourAz = ((az / DEG + 180) % 360 + 360) % 360;
    if (hourElev < 0) {
      notes.push("At this hour the Sun is below the horizon — the elevation is reported as negative rather than clipped.");
    }
  }

  notes.push(
    "H₀ is the extraterrestrial DAILY total on a horizontal plane — the hard ceiling before " +
      "the atmosphere. A clear day at the surface delivers roughly 70–75% of it; your site's " +
      "measured peak-sun-hours figure is the number that already includes the weather."
  );

  const res: SolarGeometryResult = {
    ok: true,
    declinationDeg: decl,
    dayLengthHours: dayLength,
    noonElevationDeg: noonElevation,
    extraterrestrialKWhM2: h0,
    hourElevationDeg: hourElev,
    hourAzimuthDeg: hourAz,
    notes,
  };
  if (!allFinite(res as unknown as Record<string, unknown>)) {
    return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
  }
  return res;
}
