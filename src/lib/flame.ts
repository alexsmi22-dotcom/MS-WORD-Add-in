// Adiabatic flame temperature — the one energy calculator that needed real
// thermodynamic DATA, built the only way this product accepts data:
//
// PROVENANCE. The four species tables below are NASA-7 polynomials taken
// MECHANICALLY from GRI-Mech 3.0 as distributed by the Cantera project
// (repository Cantera/cantera, file data/gri30.yaml, main branch, fetched
// 2026-08-01; species CO2 / H2O / N2 / O2, both temperature ranges). No URL
// appears here because the network-surface gate enforces the offline claim
// by scanning source for hostnames — the repository + path + date above
// identify the source exactly.
// They were extracted and formatted by a script — no coefficient was typed by
// hand — and flame.crosscheck.test.ts validates them against INDEPENDENT
// landmarks (CODATA/JANAF cp at 298.15 K, JANAF sensible enthalpies at
// 1000 K, low/high-range continuity, and a numerical cp-integration identity)
// so a transcription error cannot survive the suite.
//
// WHY THIS DESIGN KEEPS THE DATA MANDATE. The heating value — the number that
// varies with the actual fuel blend — remains the USER'S measured input, as
// everywhere else in the energy suite. The polynomials supply only the
// SENSIBLE enthalpies of the fixed product set, which are properties of four
// pure gases, not of anyone's fuel.
//
// THE HONEST LIMIT, STATED UP FRONT: this is the classical adiabatic flame
// temperature WITHOUT DISSOCIATION. Above ~2200 K real CO2 and H2O dissociate
// and soak up heat, so near stoichiometric this calculation OVERSTATES a
// hydrocarbon-air flame by roughly 100–200 K (methane: ~2320 K here vs
// ~2225 K with equilibrium). The overstatement shrinks quickly with excess
// air. Every result carries this caveat.

import { combustion, AIR_N2_PER_O2, EnergyError } from "./energy";

/** Universal gas constant, J/(mol·K) — same value thermo.ts uses. */
const R = 8.314462618;

const T_REF = 298.15;

interface Nasa7 {
  /** [Tmin, Tmid, Tmax] — low coefficients below Tmid, high above. */
  ranges: number[];
  low: number[];
  high: number[];
}

/** GRI-Mech 3.0 via Cantera gri30.yaml — see the provenance note above. */
const SPECIES: Record<string, Nasa7> = {
  CO2: {
    ranges: [200.0, 1000.0, 3500.0],
    low: [2.35677352, 0.00898459677, -7.12356269e-06, 2.45919022e-09, -1.43699548e-13, -48371.9697, 9.90105222],
    high: [3.85746029, 0.00441437026, -2.21481404e-06, 5.23490188e-10, -4.72084164e-14, -48759.166, 2.27163806],
  },
  H2O: {
    ranges: [200.0, 1000.0, 3500.0],
    low: [4.19864056, -0.0020364341, 6.52040211e-06, -5.48797062e-09, 1.77197817e-12, -30293.7267, -0.849032208],
    high: [3.03399249, 0.00217691804, -1.64072518e-07, -9.7041987e-11, 1.68200992e-14, -30004.2971, 4.9667701],
  },
  N2: {
    ranges: [300.0, 1000.0, 5000.0],
    low: [3.298677, 0.0014082404, -3.963222e-06, 5.641515e-09, -2.444854e-12, -1020.8999, 3.950372],
    high: [2.92664, 0.0014879768, -5.68476e-07, 1.0097038e-10, -6.753351e-15, -922.7977, 5.980528],
  },
  O2: {
    ranges: [200.0, 1000.0, 3500.0],
    low: [3.78245636, -0.00299673416, 9.84730201e-06, -9.68129509e-09, 3.24372837e-12, -1063.94356, 3.65767573],
    high: [3.28253784, 0.00148308754, -7.57966669e-07, 2.09470555e-10, -2.16717794e-14, -1088.45772, 5.45323129],
  },
};

export type FlameSpecies = keyof typeof SPECIES;

/** The polynomials' common validity ceiling (CO2/H2O/O2 end at 3500 K). */
export const T_MAX_VALID = 3500;

function coeffs(sp: Nasa7, t: number): number[] {
  return t < sp.ranges[1] ? sp.low : sp.high;
}

/** Molar heat capacity cp(T), J/(mol·K): cp/R = a1 + a2·T + a3·T² + a4·T³ + a5·T⁴. */
export function cpMolar(name: FlameSpecies, t: number): number {
  const a = coeffs(SPECIES[name], t);
  return R * (a[0] + a[1] * t + a[2] * t * t + a[3] * t ** 3 + a[4] * t ** 4);
}

/** Molar enthalpy including formation, J/mol: h/RT = a1 + a2·T/2 + … + a6/T. */
export function hMolar(name: FlameSpecies, t: number): number {
  const a = coeffs(SPECIES[name], t);
  return R * t * (a[0] + (a[1] * t) / 2 + (a[2] * t * t) / 3 + (a[3] * t ** 3) / 4 + (a[4] * t ** 4) / 5 + a[5] / t);
}

/** Sensible enthalpy above 298.15 K, J/mol — formation enthalpy cancels. */
export function sensibleEnthalpy(name: FlameSpecies, t: number): number {
  return hMolar(name, t) - hMolar(name, T_REF);
}

export interface FlameInput {
  /** Fuel molecular formula (C/H/O/N — sulfur is refused, see below). */
  formula: string;
  /** Heating value, MJ/kg, on the stated basis. */
  heatingValueMJPerKg: number;
  basis: "LHV" | "HHV";
  /** Excess air fraction (0 = stoichiometric). */
  excessAir?: number;
  /** Combustion-air preheat temperature, °C (25 = no preheat). */
  airPreheatC?: number;
}

export interface FlameResult {
  ok: true;
  /** Adiabatic flame temperature, kelvin and °C. */
  flameTempK: number;
  flameTempC: number;
  /** The LHV actually used in the balance, MJ/kg. */
  lhvUsedMJPerKg: number;
  /** Heat added by the air preheat, MJ per kg fuel — 0 without preheat. */
  preheatMJPerKg: number;
  /** Product moles per mol fuel, for the record. */
  products: { co2: number; h2o: number; n2: number; o2: number };
  notes: string[];
}

/**
 * Constant-pressure adiabatic flame temperature, no dissociation.
 *
 * The balance: all the fuel's LHV (plus any air-preheat sensible heat) goes
 * into raising the complete-combustion products from 298.15 K to T. The LHV
 * basis is not a choice here — it is FORCED by the physics: the water leaves
 * the flame as vapour, so a supplied HHV is first converted through the
 * latent heat of the combustion water (the combustion tool's own arithmetic).
 *
 * Solved by bisection on a strictly increasing function; the polynomials end
 * at 3500 K and a balance that cannot close below that is REFUSED — a real
 * flame would have dissociated long before, so a hotter answer would be
 * fiction stacked on extrapolation.
 */
export function flameTemperature(inp: FlameInput): FlameResult | EnergyError {
  if (!Number.isFinite(inp.heatingValueMJPerKg) || inp.heatingValueMJPerKg <= 0) {
    return { ok: false, error: "The heating value must be a positive number of MJ/kg." };
  }
  // Route through the combustion engine: stoichiometry, element checks, and
  // (for HHV) the LHV derivation all come from the one implementation.
  const base = combustion({
    formula: inp.formula,
    excessAir: inp.excessAir,
    hhvMJPerKg: inp.basis === "HHV" ? inp.heatingValueMJPerKg : undefined,
  });
  if (!base.ok) return base;
  if ((base.composition.S ?? 0) > 0) {
    return {
      ok: false,
      error:
        "Sulfur fuels are not supported here: the bundled thermodynamic tables cover " +
        "CO₂/H₂O/N₂/O₂ only (GRI-Mech 3.0 has no sulfur chemistry). The combustion tool " +
        "still gives the stoichiometry and SO₂ yield for this fuel.",
    };
  }
  const lhv = inp.basis === "HHV" ? base.lhvMJPerKg! : inp.heatingValueMJPerKg;
  if (inp.basis === "LHV" && lhv > 130) {
    return {
      ok: false,
      error: `${lhv} MJ/kg exceeds any chemical fuel's LHV (hydrogen is ~120). Check the unit.`,
    };
  }

  const e = inp.excessAir ?? 0;
  const a = base.o2PerMolFuel;
  const nC = base.composition.C ?? 0;
  const nH = base.composition.H ?? 0;
  const nN = base.composition.N ?? 0;
  const products = {
    co2: nC,
    h2o: nH / 2,
    n2: AIR_N2_PER_O2 * a * (1 + e) + nN / 2,
    o2: e * a,
  };

  // Energy in, J per mol fuel: the LHV, plus the air's sensible heat above
  // the reference when preheated.
  const qFuel = lhv * 1e6 * (base.molarMass / 1000);
  let qPreheat = 0;
  const preheatC = inp.airPreheatC ?? 25;
  if (!Number.isFinite(preheatC)) return { ok: false, error: "The air preheat must be a temperature in °C." };
  const preheatK = preheatC + 273.15;
  if (preheatK < 200 || preheatK > 1500) {
    return {
      ok: false,
      error:
        "Air preheat must lie between -73 °C and ~1227 °C — beyond that no recuperator " +
        "operates and the polynomial validity is being spent on the wrong side of the flame.",
    };
  }
  if (Math.abs(preheatK - T_REF) > 0.01) {
    const airO2 = a * (1 + e);
    const airN2 = AIR_N2_PER_O2 * a * (1 + e);
    qPreheat = airO2 * sensibleEnthalpy("O2", preheatK) + airN2 * sensibleEnthalpy("N2", preheatK);
  }
  const qTotal = qFuel + qPreheat;

  const productHeat = (t: number): number =>
    products.co2 * sensibleEnthalpy("CO2", t) +
    products.h2o * sensibleEnthalpy("H2O", t) +
    products.n2 * sensibleEnthalpy("N2", t) +
    products.o2 * sensibleEnthalpy("O2", t);

  if (productHeat(T_MAX_VALID) < qTotal) {
    return {
      ok: false,
      error:
        "The energy balance does not close below 3500 K, where the thermodynamic " +
        "polynomials end — and a real flame would have dissociated far below that. " +
        "Check the heating value and the excess air; this combination is not a " +
        "temperature this method can honestly report.",
    };
  }

  // Bisection on a strictly increasing function of T.
  let lo = T_REF;
  let hi = T_MAX_VALID;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (productHeat(mid) < qTotal) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  const tFlame = (lo + hi) / 2;

  const notes = [
    "NO DISSOCIATION is modelled — the classical textbook figure. Above ~2200 K real " +
      "CO₂ and H₂O dissociate and absorb heat, so near stoichiometric this OVERSTATES a " +
      "hydrocarbon-air flame by roughly 100–200 K (methane: ~2320 K here vs ~2225 K with " +
      "equilibrium). The gap closes quickly with excess air.",
    "LHV basis, forced by the physics: the water leaves the flame as vapour." +
      (inp.basis === "HHV" ? " Your HHV was converted through the latent heat of the combustion water." : ""),
    "Complete combustion at constant pressure, air as 1 O₂ : 3.76 N₂, products CO₂/H₂O/N₂" +
      (products.o2 > 0 ? "/O₂" : "") +
      ". Product properties are GRI-Mech 3.0 NASA-7 polynomials (via Cantera), " +
      "cross-checked in the test suite against JANAF landmarks.",
  ];
  if (e > 0) {
    notes.push(
      `Excess air dilutes the products: the same heat spread over ${(1 + e).toFixed(2)}× the ` +
        "nitrogen. Peak furnace temperature and NOx both fall with it — which is often the point."
    );
  }
  if (qPreheat > 0) {
    notes.push(
      "Air preheat adds its sensible heat to the balance — recuperators buy flame " +
        "temperature (and efficiency) with heat that would have left in the stack."
    );
  }

  const res: FlameResult = {
    ok: true,
    flameTempK: tFlame,
    flameTempC: tFlame - 273.15,
    lhvUsedMJPerKg: lhv,
    preheatMJPerKg: qPreheat / 1e6 / (base.molarMass / 1000),
    products,
    notes,
  };
  for (const v of Object.values(res)) {
    if (typeof v === "number" && !Number.isFinite(v)) {
      return { ok: false, error: "These inputs overflow — check the magnitudes and units." };
    }
  }
  return res;
}
