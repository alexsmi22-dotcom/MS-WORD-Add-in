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

// ------------------------------------------------------------ cyclic voltammetry
//
// Reversible (Nernstian), diffusion-controlled electron transfer O + n e⁻ ⇌ R at a planar electrode under semi-
// infinite linear diffusion, only one form present in the bulk. Sources: R. S. Nicholson and I. Shain, Anal. Chem.
// 36 (1964) 706; A. J. Bard and L. R. Faulkner, Electrochemical Methods, 2nd ed. (2001), §6.2 (Randles–Ševčík,
// eq. 6.2.18–6.2.21) and §6.7 (convolutive voltammetry).

/** π^½·χ(σt) at its maximum for a reversible wave (Nicholson–Shain). */
export const RS_PEAK = 0.4463;
/**
 * Peak separation of a reversible wave in units of RT/nF: 2.218 (57.0/n mV at 25 °C) for a switching potential far
 * past the forward peak; it rises toward 2.3 RT/nF (59/n mV) when the sweep is reversed close to the peak (Nicholson
 * 1965, Anal. Chem. 37, 1351).
 */
export const DELTA_EP_RT_NF = 2.218;
/** |Ep − E½| in units of RT/nF (28.5/n mV at 25 °C). */
export const EP_HALF_RT_NF = 1.109;

/** 0.4463·F·√(F/RT): the Randles–Ševčík constant at a temperature, ≈ 2.69×10⁵ at 25 °C (A in cm², C in mol/cm³, D in cm²/s, v in V/s). */
export const rsConstant = (tC: number): number => RS_PEAK * FARADAY * Math.sqrt(1 / thermalVoltage(tC));

/**
 * Randles–Ševčík peak current (A): ip = 0.4463·nFAC·√(nFvD/RT), the temperature-dependent form.
 * A in cm², C in mol/cm³ (1 mM = 10⁻⁶ mol/cm³), D in cm²/s, v in V/s.
 */
export function randlesSevcik(n: number, A: number, C: number, D: number, v: number, tC: number): number {
  return RS_PEAK * n * FARADAY * A * C * Math.sqrt((n * v * D) / thermalVoltage(tC));
}

/** D (cm²/s) from the slope b of ip against √v (A per (V/s)^½). */
export function diffusionFromSlope(b: number, n: number, A: number, C: number, tC: number): number {
  const k = RS_PEAK * n * FARADAY * A * C * Math.sqrt(n / thermalVoltage(tC));
  return (b / k) ** 2;
}

/** Reversible peak positions (V): ΔEp, and |Ep − E½| for each peak. */
export function reversiblePeaks(n: number, tC: number): { deltaEp: number; epOffset: number } {
  const vt = thermalVoltage(tC);
  return { deltaEp: (DELTA_EP_RT_NF * vt) / n, epOffset: (EP_HALF_RT_NF * vt) / n };
}

export interface RsAnalysis {
  /** ip = a + b√v (A, V/s). */
  slope: number;
  intercept: number;
  r2: number;
  /** D from the slope, cm²/s. */
  D: number;
  /** Slope of log₁₀ ip against log₁₀ v: 0.5 for diffusion control, 1 for an adsorbed species. */
  logSlope: number;
  n: number;
  flags: string[];
}

/**
 * Randles–Ševčík analysis of measured peak currents: ip against √v by least squares (intercept kept, not forced
 * through zero, so a non-zero one shows), D from the slope, and the log–log slope as the diagnostic.
 * Data: (v in V/s, ip in A), one peak; cathodic peaks may be negative (magnitudes are used).
 */
export function randlesSevcikAnalysis(data: Array<[number, number]>, n: number, A: number, C: number, tC: number): RsAnalysis | string {
  if (data.length < 3) return "give at least three (scan rate, peak current) pairs";
  if (data.length > 500) return "give at most 500 pairs";
  for (const [v, ip] of data) {
    if (!(Number.isFinite(v) && v > 0)) return "every scan rate must be a number above zero";
    if (!(Number.isFinite(ip) && ip !== 0)) return "every peak current must be a non-zero number";
  }
  if (new Set(data.map(([v]) => v)).size < 2) return "the scan rates must not all be the same";
  const sgn = Math.sign(data[0][1]);
  if (data.some(([, ip]) => Math.sign(ip) !== sgn)) return "the peak currents mix signs: give one peak (all anodic or all cathodic)";
  const xs = data.map(([v]) => Math.sqrt(v)), ys = data.map(([, ip]) => Math.abs(ip));
  const fit = linFit(xs, ys);
  const lg = linFit(data.map(([v]) => Math.log10(v)), ys.map((y) => Math.log10(y)));
  if (!(fit.slope > 0)) return "the peak current does not rise with √v, so no diffusion coefficient can be read from it";
  const flags: string[] = [];
  if (fit.r2 < 0.99) flags.push(`ip is not linear in √v (R² = ${fit.r2.toFixed(4)}): the wave is probably quasi-reversible, or a coupled chemical step or adsorption contributes`);
  const ipMax = Math.max(...ys);
  if (Math.abs(fit.intercept) > 0.1 * ipMax) flags.push("the intercept is more than 10 % of the largest peak current: background (charging) current not subtracted, or adsorption");
  if (lg.slope > 0.65) flags.push(`log ip against log v has slope ${lg.slope.toFixed(2)} (0.5 for diffusion, 1 for an adsorbed layer): adsorption contributes`);
  else if (lg.slope < 0.4) flags.push(`log ip against log v has slope ${lg.slope.toFixed(2)}, below the 0.5 of diffusion control: slow electron transfer or uncompensated resistance`);
  return { slope: fit.slope, intercept: fit.intercept, r2: fit.r2, D: diffusionFromSlope(fit.slope, n, A, C, tC), logSlope: lg.slope, n: data.length, flags };
}

export interface CvSim {
  /** Potential (V) and current (A; IUPAC: anodic positive) along the forward then the reverse sweep. */
  E: number[];
  i: number[];
  /** Index where the sweep reverses. */
  switchIndex: number;
  forward: { E: number; i: number };
  reverse: { E: number; i: number };
}

export const CV_STEPS_MAX = 4000;

/**
 * A reversible cyclic voltammogram by CONVOLUTION (Bard & Faulkner §6.7; K. B. Oldham and J. Spanier, The Fractional
 * Calculus, 1974): for a Nernstian couple with D_O = D_R = D and only the starting form in the bulk, the semi-integral
 * of the current is fixed by the potential alone,
 *   m(t) = nFAC√D / (1 + exp(±nf(E(t) − E°′)))    (f = F/RT; + for a reduction first, − for an oxidation first),
 * so the current is its semi-derivative, i = d^½m/dt^½, evaluated by the Grünwald–Letnikov sum with the q/2 shift
 * (second order). With 2000 steps per sweep the forward peak reproduces π^½χ = 0.4463 to 0.1 % and |Ep − E½| =
 * 28.5/n mV (pinned in titration.test.ts against the same algorithm written in numpy). D_O ≠ D_R would shift E½ by
 * (RT/nF)·ln√(D_R/D_O): not modelled. Double-layer charging and iR drop are not modelled.
 */
export function simulateReversibleCv(p: { n: number; E0: number; Estart: number; Eswitch: number; v: number; D: number; A: number; C: number; tC: number; steps?: number }): CvSim | string {
  const { n, E0, Estart, Eswitch, v, D, A, C, tC } = p;
  if (![n, E0, Estart, Eswitch, v, D, A, C, tC].every(Number.isFinite)) return "every input must be a finite number";
  if (!(n > 0 && Number.isInteger(n) && n <= 6)) return "n must be a whole number from 1 to 6";
  if (!(v > 0 && D > 0 && A > 0 && C > 0)) return "the scan rate, D, area and concentration must be above zero";
  if (!(tC > -273.15)) return "the temperature must be above absolute zero";
  const span = Math.abs(Eswitch - Estart);
  if (!(span > 0) || span > 5) return "the switching potential must differ from the start by more than zero and at most 5 V";
  const vt = thermalVoltage(tC);
  const red = Eswitch < Estart; // sweeping negative first: O in the bulk, reduced
  const need = (4.5 * vt) / n;
  // The start must be on the plateau of the bulk form, or the "voltammogram" begins with a potential step.
  if ((red ? Estart - E0 : E0 - Estart) < need) return `start at least ${Math.ceil(need * 1000)} mV on the ${red ? "positive" : "negative"} side of E°′, where only the bulk form is present`;
  if ((red ? E0 - Eswitch : Eswitch - E0) < need) return `switch at least ${Math.ceil(need * 1000)} mV past E°′, so the forward peak is complete`;
  const half = Math.min(Math.max(Math.round(p.steps ?? 2000), 100), CV_STEPS_MAX / 2);
  const N = 2 * half;
  const tau = span / v; // seconds per sweep
  const dt = tau / half;
  const Eat = (t: number): number => (t <= tau ? Estart + (Eswitch - Estart) * (t / tau) : Eswitch + (Estart - Eswitch) * ((t - tau) / tau));
  const s = red ? 1 : -1;
  const mScale = n * FARADAY * A * C * Math.sqrt(D);
  const mAt = (t: number): number => (t <= 0 ? 0 : mScale / (1 + Math.exp((s * n * (Eat(Math.min(t, 2 * tau)) - E0)) / vt)));
  const w = new Float64Array(N + 1);
  w[0] = 1;
  for (let j = 1; j <= N; j++) w[j] = (w[j - 1] * (j - 1.5)) / j;
  // The shifted sample m(t_k − (j − ¼)Δt) = m((k − j + ¼)Δt) depends on k − j only: tabulated once.
  const M = new Float64Array(N + 1);
  for (let l = 1; l <= N; l++) M[l] = mAt((l + 0.25) * dt);
  const E: number[] = [Estart], i: number[] = [0];
  const pre = 1 / Math.sqrt(dt);
  for (let k = 1; k <= N; k++) {
    const t = k * dt;
    let sum = 0;
    for (let j = 0; j < k; j++) sum += w[j] * M[k - j];
    E.push(Eat(t));
    // A reduction current is cathodic: negative under the IUPAC convention.
    i.push(-s * pre * sum);
  }
  let fwd = 0, rev = half;
  for (let k = 0; k <= half; k++) if (Math.abs(i[k]) > Math.abs(i[fwd])) fwd = k;
  for (let k = half; k <= N; k++) if (-s * i[k] < -s * i[rev]) rev = k;
  return { E, i, switchIndex: half, forward: { E: E[fwd], i: i[fwd] }, reverse: { E: E[rev], i: i[rev] } };
}
