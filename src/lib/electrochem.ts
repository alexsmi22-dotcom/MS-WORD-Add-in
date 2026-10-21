// Electrochemistry (gap item 5, docs/SCOPE-ENGINEERING-2026-10.md): the Nernst potential of a half-reaction or cell,
// Butler–Volmer current against overpotential, and a Tafel fit of measured polarization data (slopes, transfer
// coefficients, exchange current density). Constants are CODATA 2018 exact values. Pure: no Office.js.

import { linFit } from "./arrhenius";

export const FARADAY = 96485.33212; // C/mol (CODATA 2018, exact: e·N_A)
export const R_GAS_EC = 8.314462618; // J mol⁻¹ K⁻¹
export const ELECTROCHEM_SOURCE = "F = 96485.33212 C/mol, R = 8.314462618 J mol⁻¹ K⁻¹ (CODATA 2018). Nernst E = E° − (RT/nF) ln Q; Butler–Volmer j = j₀[exp(αa·Fη/RT) − exp(−αc·Fη/RT)].";

/** Thermal voltage RT/F at a temperature in °C. */
export const thermalVoltage = (tC: number): number => (R_GAS_EC * (tC + 273.15)) / FARADAY;

export interface Species {
  /** Activity (or concentration / partial pressure as the activity's stand-in). */
  a: number;
  /** Stoichiometric coefficient (positive). */
  nu: number;
}

/**
 * E = E° − (RT/nF) ln Q with Q = Π a(products)^ν / Π a(reactants)^ν, for the reduction written
 * reactants + n e⁻ → products (a half-reaction) or for a cell reaction transferring n electrons.
 */
export function nernst(E0: number, n: number, tC: number, products: Species[], reactants: Species[]): { E: number; lnQ: number; slopePerDecade: number } | string {
  if (!Number.isFinite(E0)) return "E° must be a number (volts)";
  if (!(n > 0) || !Number.isInteger(n)) return "n (electrons transferred) must be a whole number above zero";
  if (!(tC > -273.15 && Number.isFinite(tC))) return "the temperature must be a finite number above absolute zero";
  for (const s of [...products, ...reactants]) {
    if (!(s.a > 0 && Number.isFinite(s.a))) return "every activity must be a finite number above zero (ln 0 is −∞)";
    if (!(s.nu > 0 && Number.isFinite(s.nu))) return "every coefficient must be a finite number above zero";
  }
  const lnQ = products.reduce((t, s) => t + s.nu * Math.log(s.a), 0) - reactants.reduce((t, s) => t + s.nu * Math.log(s.a), 0);
  const vt = thermalVoltage(tC);
  return { E: E0 - (vt / n) * lnQ, lnQ, slopePerDecade: (vt / n) * Math.LN10 };
}

export interface BVParams {
  /** Exchange current density (any current-density unit; the curve is in the same unit). */
  j0: number;
  alphaA: number;
  alphaC: number;
  tC: number;
}

/** Butler–Volmer current density at overpotential η (V). */
export function butlerVolmer(eta: number, p: BVParams): number {
  const f = 1 / thermalVoltage(p.tC);
  return p.j0 * (Math.exp(p.alphaA * f * eta) - Math.exp(-p.alphaC * f * eta));
}

/** The curve over [ηmin, ηmax]: points for the figure. */
export function butlerVolmerCurve(p: BVParams, etaMin: number, etaMax: number, n = 201): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const eta = etaMin + ((etaMax - etaMin) * i) / (n - 1);
    return [eta, butlerVolmer(eta, p)];
  });
}

export interface TafelBranch {
  /** Tafel slope, V per decade (positive for the anodic branch, negative for the cathodic). */
  slope: number;
  /** Transfer coefficient α = 2.303 RT / (|b| F). */
  alpha: number;
  /** log10 |j| at η = 0 from this branch's line: its estimate of log10 j₀. */
  log10j0: number;
  r2: number;
  n: number;
}

export interface TafelResult {
  anodic: TafelBranch | null;
  cathodic: TafelBranch | null;
  /** j₀ from the branches (their mean in log, when both). */
  j0: number;
  notes: string[];
}

/**
 * Tafel analysis: each branch is fitted, η against log10|j|, where |η| is large enough for the opposite exponential to
 * be negligible (|η| ≥ etaMin, default 0.1 V — about four thermal voltages at 25 °C).
 */
export function tafelFit(data: Array<[number, number]>, tC: number, etaMin = 0.1): TafelResult | string {
  const pts = data.filter(([e, j]) => Number.isFinite(e) && Number.isFinite(j) && j !== 0);
  if (pts.length < 4) return "at least four (η, j) points, with currents on at least one side well away from zero";
  const notes: string[] = [];
  const vt = thermalVoltage(tC);
  const branch = (sel: Array<[number, number]>, sign: 1 | -1): TafelBranch | null => {
    if (sel.length < 3) return null;
    // η = a + b log10|j|, the form Tafel slopes are quoted in.
    const fit = linFit(sel.map(([, j]) => Math.log10(Math.abs(j))), sel.map(([e]) => e));
    const b = fit.slope;
    if (!(Math.sign(b) === sign)) return null;
    return { slope: b, alpha: (Math.LN10 * vt) / Math.abs(b), log10j0: -fit.intercept / b, r2: fit.r2, n: sel.length };
  };
  const an = branch(pts.filter(([e, j]) => e >= etaMin && j > 0), 1);
  const ca = branch(pts.filter(([e, j]) => e <= -etaMin && j < 0), -1);
  if (!an && !ca) return `no branch to fit: Tafel lines need at least three points with |η| ≥ ${etaMin} V on one side (anodic currents positive, cathodic negative)`;
  for (const [name, b] of [["anodic", an], ["cathodic", ca]] as const) if (b && b.r2 < 0.98) notes.push(`The ${name} branch is not straight on a log scale (r² = ${b.r2.toFixed(3)}): mass transport, or the wrong window?`);
  const logs = [an, ca].filter((b): b is TafelBranch => !!b).map((b) => b.log10j0);
  if (an && ca && Math.abs(an.log10j0 - ca.log10j0) > 0.3) notes.push("The two branches extrapolate to j₀ values more than a factor of 2 apart: their mean is given.");
  return { anodic: an, cathodic: ca, j0: 10 ** (logs.reduce((a, b) => a + b, 0) / logs.length), notes };
}
