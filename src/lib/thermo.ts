// Thermodynamics — ideal-gas processes, air-standard power cycles, and the
// Carnot limits that bound all of them.
//
// TEMPERATURE IS ABSOLUTE, ALWAYS, AND IT IS CHECKED. Every efficiency,
// entropy and state relation in this module divides by or takes the ratio of
// temperatures, and doing that with Celsius is not a small error — the Carnot
// efficiency of a cycle between 500 C and 20 C is 0.62 correctly and 0.96 if
// the numbers go in as they are written. That mistake produces a plausible,
// publishable, completely wrong number, and it is the single most common error
// in the subject. So the caller states the unit, conversion happens here, and a
// temperature at or below absolute zero is refused rather than divided by.
//
// WHAT IS NOT HERE, AND WHY. There are no steam tables. Rankine and
// vapour-compression cycles are computed from enthalpies THE USER SUPPLIES from
// their own property tables, rather than from tabulated data baked into this
// file. That is a deliberate refusal: this product's rule is that all data must
// be real, and a saturated-water table reconstructed from memory would be
// plausible, unverifiable, and wrong in the third digit in places nobody would
// check. Doing the cycle arithmetic on the reader's own properties is honest
// and is exactly the workflow a student already has.
//
// THE AIR-STANDARD CYCLES ARE IDEALISATIONS AND SAY SO. They assume air as an
// ideal gas with constant specific heats, no friction, no combustion chemistry
// and no heat loss. A real spark-ignition engine reaches roughly a third of its
// air-standard efficiency, and quoting the air-standard number as "the
// efficiency" is the standard way to be wrong by a factor of three.
//
// ISENTROPIC IS NOT THE SAME AS ADIABATIC. Adiabatic means only that no heat
// crosses the boundary; isentropic means adiabatic AND reversible. Every real
// adiabatic compression generates entropy and ends hotter than the isentropic
// one for the same pressure ratio, which is what an isentropic efficiency is
// for. The two words are used interchangeably in conversation constantly, and
// the distinction is exactly where compressor and turbine work come from.

/** Universal gas constant, J/(mol*K). */
export const R_UNIVERSAL = 8.314462618;

export interface ThermoError {
  ok: false;
  error: string;
}

export type TempUnit = "K" | "C" | "F";

/**
 * Converts a temperature to kelvin and refuses anything at or below absolute
 * zero. A negative absolute temperature is not a cold system, it is a typo or a
 * unit error, and every ratio downstream would be meaningless.
 */
export function toKelvin(value: number, unit: TempUnit): number | ThermoError {
  if (!Number.isFinite(value)) return { ok: false, error: "The temperature must be a finite number." };
  let k: number;
  if (unit === "K") k = value;
  else if (unit === "C") k = value + 273.15;
  else k = (value - 32) * (5 / 9) + 273.15;
  if (k <= 0) {
    return {
      ok: false,
      error:
        `${value} ${unit} is ${k.toFixed(2)} K, at or below absolute zero. Check the unit — this ` +
        "is almost always a Celsius value entered as kelvin, or the other way round.",
    };
  }
  return k;
}

/**
 * Specific-heat data for common gases at around 300 K, in SI.
 *
 * cp AND cv VARY WITH TEMPERATURE, appreciably. Air's cp rises about 15%
 * between 300 K and 1000 K, so a cycle with a 1500 K peak computed on 300 K
 * values overstates its efficiency. These are the constant-specific-heat
 * ("cold air-standard") values every textbook starts with, and the tools that
 * use them say so rather than presenting them as exact.
 */
export interface GasProperties {
  id: string;
  label: string;
  /** Molar mass, g/mol. */
  M: number;
  /** Specific heats, J/(kg*K) — the measured quantities. */
  cp: number;
  cv: number;
  /** Gas constant and specific-heat ratio, DERIVED so the identities hold exactly. */
  R: number;
  k: number;
}

/**
 * ONLY cp AND cv ARE STORED; R AND k ARE DERIVED FROM THEM.
 *
 * This is not tidiness — it is the fix for a real first-law violation. The
 * handbook values are each rounded independently, so quoting all four makes them
 * mutually INCONSISTENT: air's usual cp = 1005, cv = 718, R = 287, k = 1.4 look
 * fine, but R/(k-1) = 717.5, not 718. The isentropic work integral uses R and k
 * while the internal-energy change uses cv, so the two disagree by 0.07% and the
 * result is a process where heat is not zero for an adiabatic expansion — an
 * apparent violation of the first law caused entirely by the rounding of a
 * table. Caught by an oracle test asserting Q = 0 for an isentropic process.
 *
 * Deriving R = cp - cv and k = cp/cv makes every identity exact by construction
 * (R = cp - cv, k = cp/cv, cv = R/(k-1)) at the cost of k coming out as 1.3997
 * for air rather than the rounded 1.4. That is the better trade: the third
 * decimal of k is not physically meaningful, and a self-inconsistent property
 * table produces errors that look like physics.
 *
 * cp AND cv VARY WITH TEMPERATURE, appreciably — air's cp rises about 15%
 * between 300 K and 1000 K. These are the constant-specific-heat ("cold
 * air-standard") values every textbook starts with, and the tools that use them
 * say so rather than presenting them as exact.
 */
const RAW_GASES: { id: string; label: string; M: number; cp: number; cv: number }[] = [
  { id: "air", label: "Air", M: 28.97, cp: 1005, cv: 718 },
  { id: "n2", label: "Nitrogen (N₂)", M: 28.013, cp: 1039, cv: 743 },
  { id: "o2", label: "Oxygen (O₂)", M: 31.999, cp: 918, cv: 658 },
  { id: "co2", label: "Carbon dioxide (CO₂)", M: 44.01, cp: 846, cv: 657 },
  { id: "he", label: "Helium (He)", M: 4.003, cp: 5193, cv: 3116 },
  { id: "ar", label: "Argon (Ar)", M: 39.948, cp: 520, cv: 312 },
  { id: "h2", label: "Hydrogen (H₂)", M: 2.016, cp: 14307, cv: 10183 },
  { id: "ch4", label: "Methane (CH₄)", M: 16.043, cp: 2254, cv: 1735 },
  { id: "co", label: "Carbon monoxide (CO)", M: 28.011, cp: 1040, cv: 744 },
];

export const GASES: GasProperties[] = RAW_GASES.map((g) => ({
  ...g,
  R: g.cp - g.cv,
  k: g.cp / g.cv,
}));

// ---------------------------------------------------------------------------
// Ideal-gas processes
// ---------------------------------------------------------------------------

export type ProcessKind = "isothermal" | "isobaric" | "isochoric" | "isentropic" | "polytropic";

export interface ProcessInput {
  gasId: string;
  /** Mass, kg. */
  m: number;
  /** Initial pressure, Pa, and temperature, K. */
  p1: number;
  t1: number;
  kind: ProcessKind;
  /** The single quantity that fixes state 2: one of these, in Pa / K / m^3. */
  p2?: number;
  t2?: number;
  v2?: number;
  /** Polytropic index, used only for "polytropic". */
  n?: number;
}

export interface ProcessResult {
  ok: true;
  gas: string;
  /** Polytropic index actually used: 1 isothermal, k isentropic, 0 isobaric, Infinity isochoric. */
  n: number;
  p1: number;
  v1: number;
  t1: number;
  p2: number;
  v2: number;
  t2: number;
  /** Boundary work done BY the gas, J. */
  work: number;
  /** Heat added TO the gas, J. */
  heat: number;
  deltaU: number;
  deltaH: number;
  deltaS: number;
  notes: string[];
}

/**
 * A closed-system ideal-gas process, treated as polytropic throughout.
 *
 * ALL FOUR NAMED PROCESSES ARE THE SAME FAMILY, P*V^n = constant, with n = 0
 * (isobaric), 1 (isothermal), k (isentropic) and infinity (isochoric). Writing
 * them as one relation with four special cases rather than four separate
 * formulas means the work integral is derived once and cannot disagree between
 * them — and it makes the n = 1 singularity explicit rather than hidden.
 *
 * THE WORK INTEGRAL HAS A REMOVABLE SINGULARITY AT n = 1. Integrating P dV with
 * P = C/V^n gives (P1V1 - P2V2)/(n - 1), which is 0/0 at n = 1; the limit is
 * P1V1*ln(V2/V1), the isothermal result. An isothermal process is the single
 * most ordinary thing in this subject, so the limit branch is written rather
 * than left to produce a division by zero.
 */
export function idealGasProcess(inp: ProcessInput): ProcessResult | ThermoError {
  const gas = GASES.find((g) => g.id === inp.gasId) ?? GASES[0];
  const { m, p1, t1 } = inp;

  for (const [name, v] of [
    ["mass", m],
    ["initial pressure", p1],
    ["initial temperature", t1],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }

  const R = gas.R;
  const k = gas.k;
  const v1 = (m * R * t1) / p1;

  // Fix the polytropic index from the process kind.
  let n: number;
  if (inp.kind === "isothermal") n = 1;
  else if (inp.kind === "isobaric") n = 0;
  else if (inp.kind === "isochoric") n = Infinity;
  else if (inp.kind === "isentropic") n = k;
  else {
    n = inp.n ?? NaN;
    if (!Number.isFinite(n)) return { ok: false, error: "Give a polytropic index n." };
  }

  // Resolve state 2 from whichever quantity the caller supplied.
  let p2: number;
  let t2: number;
  let v2: number;

  const given = [inp.p2, inp.t2, inp.v2].filter((x) => x !== undefined && Number.isFinite(x) && (x as number) > 0);
  if (given.length === 0) {
    return { ok: false, error: "Give one of pressure, temperature or volume at state 2 to fix the end state." };
  }

  if (inp.kind === "isochoric") {
    v2 = v1;
    if (inp.p2 !== undefined && inp.p2 > 0) {
      p2 = inp.p2;
      t2 = (p2 * v2) / (m * R);
    } else if (inp.t2 !== undefined && inp.t2 > 0) {
      t2 = inp.t2;
      p2 = (m * R * t2) / v2;
    } else {
      return { ok: false, error: "A constant-volume process needs an end pressure or temperature." };
    }
  } else if (inp.kind === "isobaric") {
    p2 = p1;
    if (inp.t2 !== undefined && inp.t2 > 0) {
      t2 = inp.t2;
      v2 = (m * R * t2) / p2;
    } else if (inp.v2 !== undefined && inp.v2 > 0) {
      v2 = inp.v2;
      t2 = (p2 * v2) / (m * R);
    } else {
      return { ok: false, error: "A constant-pressure process needs an end temperature or volume." };
    }
  } else {
    // General polytropic, including isothermal and isentropic.
    if (inp.p2 !== undefined && inp.p2 > 0) {
      p2 = inp.p2;
      t2 = n === 1 ? t1 : t1 * Math.pow(p2 / p1, (n - 1) / n);
      v2 = (m * R * t2) / p2;
    } else if (inp.v2 !== undefined && inp.v2 > 0) {
      v2 = inp.v2;
      p2 = p1 * Math.pow(v1 / v2, n);
      t2 = (p2 * v2) / (m * R);
    } else if (inp.t2 !== undefined && inp.t2 > 0) {
      if (n === 1) {
        return {
          ok: false,
          error:
            "An isothermal process holds temperature constant, so an end temperature does not " +
            "define the end state. Give an end pressure or volume instead.",
        };
      }
      t2 = inp.t2;
      p2 = p1 * Math.pow(t2 / t1, n / (n - 1));
      v2 = (m * R * t2) / p2;
    } else {
      return { ok: false, error: "Give an end pressure, temperature or volume." };
    }
  }

  if (![p2, v2, t2].every((x) => Number.isFinite(x) && x > 0)) {
    return { ok: false, error: "The end state came out non-physical; check the inputs and the polytropic index." };
  }

  const notes: string[] = [];

  // Boundary work. The n = 1 branch is the limit of the general formula.
  let work: number;
  if (inp.kind === "isochoric") {
    work = 0;
    notes.push("Constant volume, so the boundary work is exactly zero and all the heat goes into internal energy.");
  } else if (Math.abs(n - 1) < 1e-12) {
    work = p1 * v1 * Math.log(v2 / v1);
  } else {
    work = (p1 * v1 - p2 * v2) / (n - 1);
  }

  const deltaU = m * gas.cv * (t2 - t1);
  const deltaH = m * gas.cp * (t2 - t1);
  const heat = deltaU + work;
  const deltaS = m * (gas.cp * Math.log(t2 / t1) - R * Math.log(p2 / p1));

  if (inp.kind === "isentropic") {
    notes.push(
      "ISENTROPIC means adiabatic AND reversible, not merely adiabatic. A real adiabatic " +
        "compression generates entropy and ends HOTTER than this for the same pressure ratio; the " +
        "gap is what an isentropic efficiency measures. The heat here is zero by construction.",
    );
    if (Math.abs(heat) > 1e-6 * Math.max(1, Math.abs(deltaU))) {
      notes.push("Note that the computed heat is not quite zero, which is rounding rather than physics.");
    }
  }
  if (inp.kind === "isothermal") {
    notes.push(
      "Constant temperature, so the internal energy of an ideal gas does not change and the heat " +
        "added exactly equals the work done. That is true only because internal energy depends on " +
        "temperature alone for an ideal gas — it is not a general result.",
    );
  }
  if (inp.kind === "polytropic" && Number.isFinite(n)) {
    if (Math.abs(n - k) < 0.02) {
      notes.push(`n = ${n} is close to k = ${k}, so this is nearly isentropic.`);
    } else if (Math.abs(n - 1) < 0.02) {
      notes.push(`n = ${n} is close to 1, so this is nearly isothermal.`);
    }
  }
  if (deltaS < -1e-9) {
    notes.push(
      "The entropy of the gas DECREASES in this process. That is perfectly legal — entropy falls " +
        "whenever heat is removed — but it means the surroundings must gain at least as much, so " +
        "check that the heat rejection is accounted for before calling this reversible.",
    );
  }
  notes.push(
    `Constant specific heats at about 300 K were used (cp = ${gas.cp}, cv = ${gas.cv} J/kg·K). Both ` +
      "rise appreciably with temperature — air's cp is about 15% higher at 1000 K — so a process " +
      "spanning a wide temperature range is approximate.",
  );

  return {
    ok: true,
    gas: gas.label,
    n,
    p1,
    v1,
    t1,
    p2,
    v2,
    t2,
    work,
    heat,
    deltaU,
    deltaH,
    deltaS,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Carnot limits
// ---------------------------------------------------------------------------

export interface CarnotResult {
  ok: true;
  th: number;
  tc: number;
  /** Maximum thermal efficiency of any heat engine between these reservoirs. */
  efficiency: number;
  /** Maximum COP of a refrigerator, and of a heat pump. */
  copRefrigerator: number;
  copHeatPump: number;
  notes: string[];
}

/** The Carnot bounds between two reservoirs. */
export function carnot(thK: number, tcK: number): CarnotResult | ThermoError {
  for (const [name, v] of [
    ["hot reservoir temperature", thK],
    ["cold reservoir temperature", tcK],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be above absolute zero.` };
  }
  if (tcK >= thK) {
    return {
      ok: false,
      error:
        "The cold reservoir is at or above the hot one, so there is no temperature difference to " +
        "drive an engine. Heat does not flow from cold to hot on its own, which is the second law.",
    };
  }

  const efficiency = 1 - tcK / thK;
  const notes: string[] = [];
  notes.push(
    "This is an upper bound that no real device reaches, and it depends ONLY on the two " +
      "temperatures — not on the working fluid, the pressures, or the machine. A cycle claiming to " +
      "beat it has an error somewhere, usually a temperature in Celsius.",
  );
  notes.push(
    "The COP of a refrigerator is greater than 1 for any sensible temperature lift, and that is " +
      "not a violation of anything: it MOVES heat rather than creating it, so the ratio is heat " +
      "moved to work supplied and is not an efficiency.",
  );
  if (efficiency > 0.8) {
    notes.push(
      `An efficiency bound of ${(efficiency * 100).toFixed(1)}% implies a very large temperature ` +
        "ratio. Check that both temperatures are absolute — this is what a Celsius value entered " +
        "as kelvin looks like.",
    );
  }

  return {
    ok: true,
    th: thK,
    tc: tcK,
    efficiency,
    copRefrigerator: tcK / (thK - tcK),
    copHeatPump: thK / (thK - tcK),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Air-standard power cycles
// ---------------------------------------------------------------------------

export interface CycleResult {
  ok: true;
  name: string;
  efficiency: number;
  /** Temperatures around the cycle, K, when they could be determined. */
  temperatures: { label: string; t: number }[];
  /** Net work per unit mass, J/kg, when a temperature scale was supplied. */
  netWork: number | null;
  heatIn: number | null;
  /** Carnot efficiency between the cycle's own extremes, for comparison. */
  carnotEfficiency: number | null;
  notes: string[];
}

/** Otto cycle (spark ignition), air-standard with constant specific heats. */
export function ottoCycle(compressionRatio: number, gasId = "air", t1K?: number, t3K?: number): CycleResult | ThermoError {
  const gas = GASES.find((g) => g.id === gasId) ?? GASES[0];
  const r = compressionRatio;
  if (!Number.isFinite(r) || r <= 1) {
    return { ok: false, error: "The compression ratio must be greater than 1." };
  }
  const k = gas.k;
  const efficiency = 1 - Math.pow(r, 1 - k);
  const notes: string[] = [];

  const temperatures: { label: string; t: number }[] = [];
  let netWork: number | null = null;
  let heatIn: number | null = null;
  let carnotEff: number | null = null;

  if (t1K !== undefined && t3K !== undefined && Number.isFinite(t1K) && Number.isFinite(t3K) && t1K > 0 && t3K > 0) {
    const t2 = t1K * Math.pow(r, k - 1);
    const t4 = t3K * Math.pow(r, 1 - k);
    if (t3K <= t2) {
      return {
        ok: false,
        error:
          `The peak temperature ${t3K.toFixed(0)} K is at or below the end-of-compression ` +
          `temperature ${t2.toFixed(0)} K, so no heat is added and this is not a cycle. Compression ` +
          "alone raises the temperature; the peak must be above that.",
      };
    }
    temperatures.push({ label: "1 — start of compression", t: t1K });
    temperatures.push({ label: "2 — end of compression", t: t2 });
    temperatures.push({ label: "3 — peak, after heat addition", t: t3K });
    temperatures.push({ label: "4 — end of expansion", t: t4 });
    heatIn = gas.cv * (t3K - t2);
    netWork = efficiency * heatIn;
    carnotEff = 1 - t1K / t3K;
  }

  if (r > 12) {
    notes.push(
      `A compression ratio of ${r} is above what a spark-ignition engine can use — the mixture ` +
        "self-ignites (knocks) somewhere around 10 to 12 on pump fuel. That limit, not the " +
        "thermodynamics, is why petrol engines stop where they do.",
    );
  }
  notes.push(
    "Air-standard: air as an ideal gas with constant specific heats, no friction, no combustion " +
      "chemistry, no heat loss and no gas exchange. A real engine reaches roughly a third of this. " +
      "Quoting the air-standard figure as the efficiency overstates it by about a factor of three.",
  );
  if (carnotEff !== null) {
    notes.push(
      `Between this cycle's own extremes the Carnot bound is ${(carnotEff * 100).toFixed(1)}%, ` +
        `against the cycle's ${(efficiency * 100).toFixed(1)}%. The gap is the price of adding and ` +
        "rejecting heat over a range of temperatures rather than isothermally.",
    );
  }

  return { ok: true, name: "Otto (spark ignition)", efficiency, temperatures, netWork, heatIn, carnotEfficiency: carnotEff, notes };
}

/** Diesel cycle (compression ignition), air-standard. */
export function dieselCycle(
  compressionRatio: number,
  cutoffRatio: number,
  gasId = "air",
  t1K?: number,
): CycleResult | ThermoError {
  const gas = GASES.find((g) => g.id === gasId) ?? GASES[0];
  const r = compressionRatio;
  const rc = cutoffRatio;
  if (!Number.isFinite(r) || r <= 1) return { ok: false, error: "The compression ratio must be greater than 1." };
  if (!Number.isFinite(rc) || rc <= 1) {
    return {
      ok: false,
      error:
        "The cut-off ratio must be greater than 1 — it is the volume ratio over which heat is " +
        "added at constant pressure. A cut-off ratio of exactly 1 adds no heat and reduces the " +
        "Diesel cycle to the Otto cycle.",
    };
  }
  if (rc >= r) {
    return {
      ok: false,
      error:
        `The cut-off ratio ${rc} is at or above the compression ratio ${r}, which would mean heat ` +
        "is still being added after the piston has passed its starting volume. Cut-off must happen " +
        "during expansion.",
    };
  }

  const k = gas.k;
  const efficiency = 1 - Math.pow(r, 1 - k) * ((Math.pow(rc, k) - 1) / (k * (rc - 1)));
  const notes: string[] = [];
  const temperatures: { label: string; t: number }[] = [];
  let netWork: number | null = null;
  let heatIn: number | null = null;
  let carnotEff: number | null = null;

  if (t1K !== undefined && Number.isFinite(t1K) && t1K > 0) {
    const t2 = t1K * Math.pow(r, k - 1);
    const t3 = t2 * rc;
    const t4 = t3 * Math.pow(rc / r, k - 1);
    temperatures.push({ label: "1 — start of compression", t: t1K });
    temperatures.push({ label: "2 — end of compression", t: t2 });
    temperatures.push({ label: "3 — end of heat addition (cut-off)", t: t3 });
    temperatures.push({ label: "4 — end of expansion", t: t4 });
    heatIn = gas.cp * (t3 - t2);
    netWork = efficiency * heatIn;
    carnotEff = 1 - t1K / t3;
  }

  // The result students find surprising, and the reason Diesel wins anyway.
  const ottoAtSameR = 1 - Math.pow(r, 1 - k);
  notes.push(
    `At the SAME compression ratio the Otto cycle is more efficient — ${(ottoAtSameR * 100).toFixed(1)}% ` +
      `against this cycle's ${(efficiency * 100).toFixed(1)}%. Diesel engines win in practice not ` +
      "because the cycle is better but because they can RUN a much higher compression ratio: there " +
      "is no fuel in the cylinder during compression, so there is nothing to knock.",
  );
  notes.push(
    "As the cut-off ratio approaches 1 the Diesel efficiency approaches the Otto efficiency, " +
      "because heat addition becomes instantaneous and therefore constant-volume.",
  );
  notes.push(
    "Air-standard: constant specific heats, no friction, no combustion chemistry, no heat loss.",
  );

  return { ok: true, name: "Diesel (compression ignition)", efficiency, temperatures, netWork, heatIn, carnotEfficiency: carnotEff, notes };
}

/** Brayton cycle (gas turbine), air-standard. */
export function braytonCycle(
  pressureRatio: number,
  gasId = "air",
  t1K?: number,
  t3K?: number,
): CycleResult | ThermoError {
  const gas = GASES.find((g) => g.id === gasId) ?? GASES[0];
  const rp = pressureRatio;
  if (!Number.isFinite(rp) || rp <= 1) return { ok: false, error: "The pressure ratio must be greater than 1." };

  const k = gas.k;
  const efficiency = 1 - Math.pow(rp, (1 - k) / k);
  const notes: string[] = [];
  const temperatures: { label: string; t: number }[] = [];
  let netWork: number | null = null;
  let heatIn: number | null = null;
  let carnotEff: number | null = null;

  if (t1K !== undefined && t3K !== undefined && Number.isFinite(t1K) && Number.isFinite(t3K) && t1K > 0 && t3K > 0) {
    const t2 = t1K * Math.pow(rp, (k - 1) / k);
    const t4 = t3K * Math.pow(rp, (1 - k) / k);
    if (t3K <= t2) {
      return {
        ok: false,
        error:
          `The turbine inlet temperature ${t3K.toFixed(0)} K is at or below the compressor outlet ` +
          `${t2.toFixed(0)} K, so no heat can be added. At this pressure ratio the compressor alone ` +
          "already reaches that temperature.",
      };
    }
    temperatures.push({ label: "1 — compressor inlet", t: t1K });
    temperatures.push({ label: "2 — compressor outlet", t: t2 });
    temperatures.push({ label: "3 — turbine inlet", t: t3K });
    temperatures.push({ label: "4 — turbine outlet", t: t4 });
    heatIn = gas.cp * (t3K - t2);
    netWork = efficiency * heatIn;
    carnotEff = 1 - t1K / t3K;

    // The optimum-pressure-ratio result, which is not the maximum-efficiency one.
    const rpMaxWork = Math.pow(t3K / t1K, k / (2 * (k - 1)));
    notes.push(
      `Maximum NET WORK PER UNIT MASS occurs at a pressure ratio of about ${rpMaxWork.toFixed(1)} ` +
        "for these temperatures, which is NOT the ratio that maximises efficiency — efficiency " +
        "rises monotonically with pressure ratio. Real turbines are sized nearer the work optimum, " +
        "because a bigger machine costs more than the fuel it saves.",
    );
  }

  notes.push(
    "Brayton efficiency depends ONLY on the pressure ratio, not on the turbine inlet temperature — " +
      "raising the peak temperature increases the work output but not the efficiency of the ideal " +
      "cycle. That is an artefact of the ideal cycle; in a real one, higher inlet temperature does " +
      "help, because component losses become proportionally smaller.",
  );
  notes.push("Air-standard: constant specific heats, no pressure loss, ideal compression and expansion.");

  return { ok: true, name: "Brayton (gas turbine)", efficiency, temperatures, netWork, heatIn, carnotEfficiency: carnotEff, notes };
}

// ---------------------------------------------------------------------------
// Vapour cycles, from the reader's own property data
// ---------------------------------------------------------------------------

export interface VapourResult {
  ok: true;
  name: string;
  /** Work and heat per unit mass, J/kg. */
  turbineWork: number;
  pumpWork: number;
  netWork: number;
  heatIn: number;
  heatOut: number;
  efficiency: number;
  /** Fraction of gross work consumed by the pump or compressor. */
  backWorkRatio: number;
  notes: string[];
}

/**
 * A Rankine cycle from FOUR ENTHALPIES the reader looks up in their own steam
 * tables — deliberately not from tables baked into this file.
 *
 * State numbering is the universal one:
 *   1 pump inlet (saturated liquid leaving the condenser)
 *   2 pump outlet / boiler inlet
 *   3 turbine inlet (superheated steam leaving the boiler)
 *   4 turbine outlet / condenser inlet
 */
export function rankineFromEnthalpies(
  h1: number,
  h2: number,
  h3: number,
  h4: number,
): VapourResult | ThermoError {
  const hs = { h1, h2, h3, h4 };
  for (const [name, v] of Object.entries(hs)) {
    if (!Number.isFinite(v)) return { ok: false, error: `${name} must be a finite number.` };
  }
  if (h3 <= h2) {
    return {
      ok: false,
      error:
        "The turbine inlet enthalpy is at or below the boiler inlet, so the boiler removes heat " +
        "rather than adding it. Check that h3 is the superheated steam leaving the boiler.",
    };
  }
  if (h4 >= h3) {
    return {
      ok: false,
      error:
        "The turbine outlet enthalpy is at or above the inlet, so the turbine would absorb work " +
        "rather than producing it. Check that h4 is the state leaving the turbine.",
    };
  }
  if (h2 < h1) {
    return {
      ok: false,
      error: "The pump outlet enthalpy is below its inlet, so the pump removes energy. Check h1 and h2.",
    };
  }

  const turbineWork = h3 - h4;
  const pumpWork = h2 - h1;
  const netWork = turbineWork - pumpWork;
  const heatIn = h3 - h2;
  const heatOut = h4 - h1;
  const efficiency = netWork / heatIn;
  const backWorkRatio = turbineWork > 0 ? pumpWork / turbineWork : Infinity;

  const notes: string[] = [];
  notes.push(
    "Computed from the enthalpies you supplied — no steam tables are built into this tool, " +
      "deliberately, so the property data is yours and verifiable rather than reconstructed.",
  );
  if (backWorkRatio < 0.05) {
    notes.push(
      `The pump consumes only ${(backWorkRatio * 100).toFixed(1)}% of the turbine's output, which ` +
        "is why textbooks often neglect pump work entirely. It is small because pumping a LIQUID " +
        "takes far less work than compressing a vapour — that is the whole reason the Rankine " +
        "cycle is used instead of running a Carnot cycle in the two-phase region.",
    );
  } else if (backWorkRatio > 0.3) {
    notes.push(
      `The pump takes ${(backWorkRatio * 100).toFixed(0)}% of the gross work, which is very high ` +
        "for a Rankine cycle and suggests the enthalpies may not be a liquid pump — a gas " +
        "compressor has a back-work ratio in this range.",
    );
  }
  // An energy balance the reader can check independently.
  const balance = heatIn - heatOut - netWork;
  if (Math.abs(balance) > 1e-6 * Math.max(1, Math.abs(heatIn))) {
    notes.push(
      `Energy balance check: heat in minus heat out minus net work leaves ${balance.toFixed(3)}, ` +
        "which should be zero. A non-zero residue means the four enthalpies are not mutually " +
        "consistent.",
    );
  }

  return {
    ok: true,
    name: "Rankine",
    turbineWork,
    pumpWork,
    netWork,
    heatIn,
    heatOut,
    efficiency,
    backWorkRatio,
    notes,
  };
}

export interface RefrigerationResult {
  ok: true;
  compressorWork: number;
  refrigerationEffect: number;
  heatRejected: number;
  copRefrigerator: number;
  copHeatPump: number;
  notes: string[];
}

/**
 * A vapour-compression refrigeration cycle from three enthalpies:
 *   h1 compressor inlet (saturated vapour leaving the evaporator)
 *   h2 compressor outlet
 *   h3 condenser outlet (saturated liquid) — and h4 = h3, because the
 *     expansion valve is a THROTTLE, which is isenthalpic.
 */
export function refrigerationFromEnthalpies(h1: number, h2: number, h3: number): RefrigerationResult | ThermoError {
  for (const [name, v] of [
    ["h1", h1],
    ["h2", h2],
    ["h3", h3],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `${name} must be a finite number.` };
  }
  if (h2 <= h1) {
    return { ok: false, error: "The compressor outlet enthalpy must be above its inlet; a compressor adds energy." };
  }
  if (h3 >= h1) {
    return {
      ok: false,
      error:
        "The condenser outlet enthalpy is at or above the evaporator outlet, so the evaporator " +
        "would absorb no heat and there is no refrigeration effect.",
    };
  }

  const compressorWork = h2 - h1;
  const refrigerationEffect = h1 - h3;
  const heatRejected = h2 - h3;
  const notes: string[] = [];
  notes.push(
    "The expansion valve is a THROTTLE, so h4 = h3 — enthalpy is conserved across it while " +
      "pressure and temperature fall. It is the one deliberately irreversible step in the cycle, " +
      "kept because a turbine recovering that work would cost far more than the work is worth.",
  );
  notes.push(
    "COP is not an efficiency and is routinely greater than 1: the machine MOVES heat rather than " +
      "producing it, so nothing is violated by getting more heat out than work in.",
  );
  notes.push(
    "The two COPs differ by exactly 1 (COP_heat pump = COP_refrigerator + 1), because the heat " +
      "rejected is the heat absorbed plus the work supplied. That is an identity, not a coincidence.",
  );

  return {
    ok: true,
    compressorWork,
    refrigerationEffect,
    heatRejected,
    copRefrigerator: refrigerationEffect / compressorWork,
    copHeatPump: heatRejected / compressorWork,
    notes,
  };
}

/**
 * Checks a claimed efficiency or COP against the Carnot bound.
 *
 * This exists because "my cycle is 68% efficient between 500 C and 20 C" is a
 * sentence people write, and it is impossible — the bound is 62% — and the
 * reason is almost always that the temperatures went in as Celsius.
 */
export function checkAgainstCarnot(
  claimed: number,
  thK: number,
  tcK: number,
  kind: "efficiency" | "refrigerator" | "heat-pump",
): { ok: true; bound: number; possible: boolean; message: string } | ThermoError {
  const c = carnot(thK, tcK);
  if (!c.ok) return c;
  if (!Number.isFinite(claimed) || claimed <= 0) {
    return { ok: false, error: "The claimed figure must be a positive number." };
  }
  const bound = kind === "efficiency" ? c.efficiency : kind === "refrigerator" ? c.copRefrigerator : c.copHeatPump;
  const possible = claimed <= bound * (1 + 1e-9);
  const label = kind === "efficiency" ? "efficiency" : "COP";
  const message = possible
    ? `A ${label} of ${claimed} is below the Carnot bound of ${bound.toFixed(4)} between ` +
      `${thK.toFixed(2)} K and ${tcK.toFixed(2)} K, so it is thermodynamically possible. Whether it ` +
      "is achievable is a separate question about the machine."
    : `A ${label} of ${claimed} EXCEEDS the Carnot bound of ${bound.toFixed(4)} between ` +
      `${thK.toFixed(2)} K and ${tcK.toFixed(2)} K, so it is IMPOSSIBLE — no device of any design ` +
      "can do this. The commonest cause by far is a temperature entered in Celsius where the " +
      "formula needs kelvin; the second commonest is a heat input that omits a term.";
  return { ok: true, bound, possible, message };
}
