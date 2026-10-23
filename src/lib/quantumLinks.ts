// Space and lunar quantum links (Release Q, part Q5): the free-space optical link for single photons, entanglement
// distribution between two receivers, and BB84 over the link. Pure functions; every input is SI (or dB / a fraction as
// named); every refusal is a sentence (a confident wrong number is the worst outcome).
//
// Sources and conventions (each checked against the source named, 2026-10-23):
//   c = 299 792 458 m/s, exact (SI 2019) — linkBudget.ts C_LIGHT, so the app has one c.
//   Range presets:
//     LEO 500 km — the Micius satellite "orbiting at an altitude of ~500 km": S.-K. Liao et al., "Satellite-to-ground
//       quantum key distribution", Nature (2017), doi:10.1038/nature23655, arXiv:1707.00542 (read in the arXiv text).
//       The same paper gives the daily shortest satellite-to-station distance as 507.0 km to 1034.7 km: 500 km is the
//       zenith range, and a slant range is longer.
//     GEO 35 786 km — Wikipedia, "Geostationary orbit": "35,786 km … in altitude above Earth's equator, 42,164 km … in
//       radius from Earth's center" (radius minus the 6 378 km equatorial radius). Cross-checked here by Kepler's third
//       law, (GM·T²/4π²)^⅓ − 6 378.137 km = 35 786.03 km (GM = 3.986004418×10¹⁴ m³/s², sidereal day 86 164.0905 s).
//     Earth–Moon 3.844×10⁸ m — NASA NSSDC Moon Fact Sheet, "Semimajor axis (10⁶ km) 0.3844" (mean perigee 0.3633, mean
//       apogee 0.4055). It is the orbit's semimajor axis (centre to centre), so the preset says so.
//   Geometric coupling (the brief's convention, Fraunhofer, on axis, uniform circular apertures, diffraction-limited):
//     η_geo = (π D_t D_r /(4 λ L))². It is the small-argument limit of the Airy encircled energy
//     P(θ)/P₀ = 1 − J₀²(ka sin θ) − J₁²(ka sin θ) (Wikipedia, "Airy disk", k = 2π/λ, a the aperture radius), with
//     ka sin θ = x = π D_t D_r /(2 λ L) and 1 − J₀² − J₁² ≈ x²/4. The full encircled energy is computed too and shown
//     beside it, because the small-argument form overestimates as η_geo approaches 1 (18 % at the LEO case).
//   Decoy-state BB84 (asymptotic, infinitely many decoys): X. Ma, B. Qi, Y. Zhao, H.-K. Lo, "Practical decoy state for
//     quantum key distribution", Phys. Rev. A 72, 012326 (2005), arXiv:quant-ph/0503005 — read in the ar5iv text:
//       Eq. 1  R ≥ q{−Q_μ f(E_μ) H₂(E_μ) + Q₁[1 − H₂(e₁)]}, q = ½ for standard BB84;
//       Eq. 7  Yᵢ = Y₀ + ηᵢ − Y₀ηᵢ (so Y₁ = Y₀ + η − Y₀η);  Eq. 8  Qᵢ = Yᵢ μⁱ e^(−μ)/i!;
//       Eq. 9  eᵢ = (e₀Y₀ + e_detector ηᵢ)/Yᵢ;  Eq. 10  Q_μ = Y₀ + 1 − e^(−ημ);  Eq. 11  E_μQ_μ = e₀Y₀ + e_detector(1 − e^(−ημ));
//       e₀ = ½ (background errors are random); η = t_AB η_Bob.
//     Checked by reproducing the paper's GYS result (Table 1: e_detector 3.3 %, Y₀ 1.7×10⁻⁶, η_Bob 0.045, 0.21 dB/km;
//     f = 1.22, μ from its Eq. 12 = 0.4789): the cutoff falls at 142.02 km against the paper's 142.05 km (Fig. 2).
//   Single-photon BB84: the same model with exactly one photon per pulse (Y₁, e₁ above) and the Shor–Preskill secret
//     fraction 1 − 2h(e₁) — quantum.ts bb84KeyRate, the app's one BB84 engine.
//   Visibility from accidentals (derived, stated in the result): accidental coincidences are uncorrelated, so they land
//     evenly on the four outcome pairs — white noise on the entangled state, i.e. a Werner state of weight
//     p = C/(C + A), whose fringe visibility is p. quantum.ts wernerState(p) gives the CHSH bound 2√2·p.

import { C_LIGHT } from "./linkBudget";
import { bb84KeyRate, binaryEntropy, wernerState } from "./quantum";
import { erfPrecise } from "./probdist";

export type Err = { ok: false; error: string };
const err = (error: string): Err => ({ ok: false, error });
const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

const toDb = (x: number): number => 10 * Math.log10(x);
const fromDb = (db: number): number => Math.pow(10, db / 10);

/** Largest total loss accepted, dB. */
export const MAX_LOSS_DB = 400;
/** Largest range accepted, m (about 70 AU: beyond it a typo is likelier than a link). */
const MAX_RANGE_M = 1e13;
/** Largest aperture accepted, m. */
const MAX_APERTURE_M = 100;
/** Background error rate e₀ (Ma et al.: background counts are random). */
export const E0 = 0.5;
/** BB84 sifting factor q (standard BB84). */
export const Q_SIFT = 0.5;

// ---------------------------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------------------------

export interface RangePreset {
  id: "leo" | "geo" | "moon";
  /** Short name for figures. */
  short: string;
  label: string;
  m: number;
  source: string;
}

export const RANGE_PRESETS: RangePreset[] = [
  {
    id: "leo",
    short: "LEO 500 km",
    label: "LEO 500 km (Micius orbit altitude; zenith range)",
    m: 500e3,
    source: "Liao et al., “Satellite-to-ground quantum key distribution”, Nature (2017), doi:10.1038/nature23655: Micius orbits “at an altitude of ~500 km”",
  },
  {
    id: "geo",
    short: "GEO 35 786 km",
    label: "GEO 35 786 km (geostationary altitude above the equator)",
    m: 35786e3,
    source: "geostationary altitude 35 786 km above the equator (orbit radius 42 164 km less the 6 378 km equatorial radius; Wikipedia, “Geostationary orbit”, checked by Kepler’s third law)",
  },
  {
    id: "moon",
    short: "Earth–Moon",
    label: "Earth–Moon 3.844×10⁸ m (lunar orbit semimajor axis)",
    m: 3.844e8,
    source: "lunar orbit semimajor axis 0.3844×10⁶ km, centre to centre (NASA NSSDC Moon Fact Sheet; mean perigee 0.3633, mean apogee 0.4055×10⁶ km)",
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Bessel J₀, J₁ (for the Airy encircled energy)
// ---------------------------------------------------------------------------------------------------------------

/** Above this argument the asymptotic J₀² + J₁² ≈ 2/(πx) is used (its error is below 10⁻⁹ there). */
const BESSEL_ASYMPTOTIC_X = 20000;

/**
 * Jₙ(x) for n = 0, 1 by Bessel's integral (1/π)∫₀^π cos(nτ − x sin τ) dτ with the trapezoid rule. The integrand is
 * smooth and its extension is periodic, so the rule converges exponentially once the step resolves x: N = ⌈x⌉ + 64
 * points (at most 20 064 at the asymptotic switch).
 */
function besselJ01(x: number): [number, number] {
  const n = Math.ceil(x) + 64;
  let s0 = 0;
  let s1 = 0;
  for (let i = 0; i <= n; i++) {
    const t = (Math.PI * i) / n;
    const w = i === 0 || i === n ? 0.5 : 1;
    const xs = x * Math.sin(t);
    s0 += w * Math.cos(xs);
    s1 += w * Math.cos(t - xs);
  }
  return [s0 / n, s1 / n];
}

/** Airy encircled energy 1 − J₀²(x) − J₁²(x). */
export function airyEncircled(x: number): number {
  if (x <= 0) return 0;
  if (x > BESSEL_ASYMPTOTIC_X) return 1 - 2 / (Math.PI * x);
  const [j0, j1] = besselJ01(x);
  return Math.min(1, Math.max(0, 1 - j0 * j0 - j1 * j1));
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Free-space optical link for single photons
// ---------------------------------------------------------------------------------------------------------------

export interface FsoInput {
  lambda: number;
  dt: number;
  dr: number;
  rangeM: number;
  /** Pointing, atmospheric and optics losses, dB ≥ 0 each. */
  pointingDb: number;
  atmosDb: number;
  opticsDb: number;
  /** Detector efficiency, 0 < η_d ≤ 1. */
  detEff: number;
  /** Emitted photons per second (optional). */
  emitRate: number | null;
}

export interface FsoResult {
  ok: true;
  /** π D_t D_r /(2 λ L), the Airy argument. */
  x: number;
  /** (π D_t D_r /(4 λ L))², uncapped. */
  etaFormula: number;
  /** min(1, etaFormula): the brief's convention. */
  etaGeo: number;
  capped: boolean;
  /** The full Airy encircled energy at the receiver. */
  etaAiry: number;
  geoDb: number;
  extraDb: number;
  etaTotal: number;
  lossDb: number;
  /** Transmitter Fraunhofer distance 2D_t²/λ. */
  fraunhoferM: number;
  insideFraunhofer: boolean;
  lightTimeS: number;
  photonsRx: number | null;
}

export function validateFsoInput(inp: FsoInput): Err | null {
  const { lambda, dt, dr, rangeM, pointingDb, atmosDb, opticsDb, detEff, emitRate } = inp;
  if (!fin(lambda, dt, dr, rangeM, pointingDb, atmosDb, opticsDb, detEff) || (emitRate !== null && !Number.isFinite(emitRate)))
    return err("Every input must be a finite number.");
  if (!(lambda > 0)) return err("The wavelength must be greater than zero.");
  if (lambda > 1e-3) return err("A wavelength above 1 mm is not an optical link: use the RF link budget (Friis) tool.");
  if (!(dt > 0) || !(dr > 0)) return err("Both aperture diameters must be greater than zero.");
  if (dt > MAX_APERTURE_M || dr > MAX_APERTURE_M) return err(`An aperture above ${MAX_APERTURE_M} m is beyond any telescope: check the entry.`);
  if (Math.min(dt, dr) < 10 * lambda)
    return err("Each aperture must be at least ten wavelengths across: the diffraction formula treats it as a large aperture.");
  if (!(rangeM > 0)) return err("The range must be greater than zero.");
  if (rangeM > MAX_RANGE_M) return err("A range above 10¹³ m (about 70 AU) is outside this tool: check the entry.");
  for (const [v, n] of [[pointingDb, "pointing loss"], [atmosDb, "atmospheric loss"], [opticsDb, "optics loss"]] as const) {
    if (v < 0) return err(`The ${n} must be zero or more (a loss in dB is entered as a positive number).`);
    if (v > MAX_LOSS_DB) return err(`The ${n} is above ${MAX_LOSS_DB} dB: check the entry.`);
  }
  if (!(detEff > 0) || detEff > 1) return err("The detector efficiency must be above 0 and at most 1.");
  if (emitRate !== null && (emitRate < 0 || emitRate > 1e21)) return err("The emitted rate must be from 0 to 10²¹ photons per second.");
  return null;
}

/** Total link loss (dB) at a range, the curve the figure draws (same apertures, wavelength and extra losses). */
export function fsoLossAt(inp: FsoInput, rangeM: number): number {
  const eta = Math.min(1, Math.pow((Math.PI * inp.dt * inp.dr) / (4 * inp.lambda * rangeM), 2));
  return -toDb(eta) + inp.pointingDb + inp.atmosDb + inp.opticsDb - toDb(inp.detEff);
}

export function fsoLink(inp: FsoInput): FsoResult | Err {
  const bad = validateFsoInput(inp);
  if (bad) return bad;
  const { lambda, dt, dr, rangeM, detEff, emitRate } = inp;
  const x = (Math.PI * dt * dr) / (2 * lambda * rangeM);
  const etaFormula = (x / 2) * (x / 2);
  const capped = etaFormula > 1;
  const etaGeo = capped ? 1 : etaFormula;
  const extraDb = inp.pointingDb + inp.atmosDb + inp.opticsDb;
  const etaTotal = etaGeo * fromDb(-extraDb) * detEff;
  const lossDb = -toDb(etaTotal);
  if (!(etaTotal > 0) || !Number.isFinite(lossDb) || lossDb > MAX_LOSS_DB)
    return err(`The total loss would exceed ${MAX_LOSS_DB} dB: check the range, wavelength and apertures.`);
  const fraunhoferM = (2 * dt * dt) / lambda;
  return {
    ok: true,
    x,
    etaFormula,
    etaGeo,
    capped,
    etaAiry: airyEncircled(x),
    geoDb: -toDb(etaGeo),
    extraDb,
    etaTotal,
    lossDb,
    fraunhoferM,
    insideFraunhofer: rangeM < fraunhoferM,
    lightTimeS: rangeM / C_LIGHT,
    photonsRx: emitRate === null ? null : emitRate * etaTotal,
  };
}

/** The geometry the entanglement presets use (stated in their labels): 810 nm, 0.3 m transmitter, 1.0 m receivers. */
export const PRESET_GEOMETRY = { lambda: 810e-9, dt: 0.3, dr: 1.0 };

/** Arm transmission (geometric coupling by the convention, times an extra loss) for a preset range. */
export function presetArmEta(rangeM: number, extraLossDb: number): number {
  const { lambda, dt, dr } = PRESET_GEOMETRY;
  const eta = Math.min(1, Math.pow((Math.PI * dt * dr) / (4 * lambda * rangeM), 2));
  return eta * fromDb(-extraLossDb);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Entanglement distribution
// ---------------------------------------------------------------------------------------------------------------

export interface EntInput {
  /** Pair rate at the source, pairs/s. */
  pairRate: number;
  /** Arm transmissions (to the detectors, detector excluded), 0 < η ≤ 1. */
  etaA: number;
  etaB: number;
  detA: number;
  detB: number;
  /** Dark (and background) counts per second at each detector, ≥ 0. */
  darkA: number;
  darkB: number;
  /** Coincidence window, full width, s. */
  tau: number;
  /** rms jitter of the arrival-time difference t_a − t_b, s (null: none, every true pair falls in the window). */
  jitter: number | null;
}

export interface EntResult {
  ok: true;
  singlesA: number;
  singlesB: number;
  /** True coincidences before the window (all pairs detected at both ends). */
  coincTotal: number;
  /** True coincidences inside the window. */
  coinc: number;
  /** Fraction of true pairs inside the window. */
  captured: number;
  acc: number;
  car: number;
  /** Werner weight p = C/(C + A) = the fringe visibility. */
  visibility: number;
  chshMax: number;
  violatesChsh: boolean;
  entangled: boolean;
  concurrence: number;
  /** Mean source pairs per window (R·τ), for the multi-pair note. */
  pairsPerWindow: number;
}

/** Most counts per window accepted at either detector (above it dead time and multiple counts break S_a S_b τ). */
export const MAX_COUNTS_PER_WINDOW = 0.1;

/** Fraction of true pairs inside a window of full width τ for a Gaussian time difference of rms σ. */
export function capturedFraction(tau: number, jitter: number | null): number {
  if (jitter === null || jitter === 0) return 1;
  return erfPrecise(tau / (2 * Math.SQRT2 * jitter));
}

export function entanglement(inp: EntInput): EntResult | Err {
  const { pairRate, etaA, etaB, detA, detB, darkA, darkB, tau, jitter } = inp;
  if (!fin(pairRate, etaA, etaB, detA, detB, darkA, darkB, tau) || (jitter !== null && !Number.isFinite(jitter)))
    return err("Every input must be a finite number.");
  if (!(pairRate > 0)) return err("The pair rate must be greater than zero.");
  if (pairRate > 1e15) return err("A pair rate above 10¹⁵ per second is beyond any source: check the entry.");
  for (const [v, n] of [[etaA, "arm A transmission"], [etaB, "arm B transmission"], [detA, "detector A efficiency"], [detB, "detector B efficiency"]] as const)
    if (!(v > 0) || v > 1) return err(`The ${n} must be above 0 and at most 1.`);
  if (darkA < 0 || darkB < 0) return err("Dark-count rates must be zero or more.");
  if (darkA > 1e10 || darkB > 1e10) return err("A dark-count rate above 10¹⁰ per second is not a photon counter: check the entry.");
  if (!(tau > 0)) return err("The coincidence window must be greater than zero.");
  if (tau > 1) return err("A coincidence window above 1 s is not a coincidence window: check the entry.");
  if (jitter !== null && jitter < 0) return err("The timing jitter must be zero or more.");
  const singlesA = pairRate * etaA * detA + darkA;
  const singlesB = pairRate * etaB * detB + darkB;
  const worst = Math.max(singlesA, singlesB) * tau;
  if (worst > MAX_COUNTS_PER_WINDOW)
    return err(
      `A detector sees ${fmtPlain(worst)} counts per window (more than one in ten): there the accidental rate S_a·S_b·τ no longer holds (multiple counts and dead time per window). Shorten the window or lower the rates.`,
    );
  const coincTotal = pairRate * etaA * detA * etaB * detB;
  const captured = capturedFraction(tau, jitter);
  const coinc = coincTotal * captured;
  const acc = singlesA * singlesB * tau;
  if (!(coinc > 0) || !(acc > 0) || !Number.isFinite(coinc / acc))
    return err("The coincidence or accidental rate underflows double precision (below about 10⁻³⁰⁰ per second): the link is too lossy to compute.");
  const p = coinc / (coinc + acc);
  const w = wernerState(p);
  if (!w) return err("The visibility is not a number from 0 to 1.");
  return {
    ok: true,
    singlesA,
    singlesB,
    coincTotal,
    coinc,
    captured,
    acc,
    car: coinc / acc,
    visibility: p,
    chshMax: w.maxChsh,
    violatesChsh: w.violatesChsh,
    entangled: w.entangled,
    concurrence: w.concurrence,
    pairsPerWindow: pairRate * tau,
  };
}

/** A short number for a refusal (no e-notation). */
function fmtPlain(v: number): string {
  if (v >= 1e5) return `${Math.round(v / Math.pow(10, Math.floor(Math.log10(v))))}×10${sup(Math.floor(Math.log10(v)))}`;
  return String(Number(v.toPrecision(3)));
}
function sup(n: number): string {
  const d = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(n).replace(/-/g, "⁻").replace(/\d/g, (c) => d[Number(c)]);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. BB84 over the link
// ---------------------------------------------------------------------------------------------------------------

export type QkdSource = "single" | "decoy";

export interface QkdInput {
  /** Pulse (or single-photon) repetition rate, per second. */
  rate: number;
  /** Channel loss, dB ≥ 0 (detector excluded). */
  lossDb: number;
  detEff: number;
  /** Background (dark) count probability per pulse, Y₀. */
  y0: number;
  /** Intrinsic error (misalignment) e_detector. */
  ed: number;
  source: QkdSource;
  /** Mean photon number of the signal state (decoy only; null = optimised at this loss). */
  mu: number | null;
  /** Error-correction efficiency f ≥ 1 (decoy only). */
  f: number;
}

export interface QkdPoint {
  /** Overall transmission η = 10^(−loss/10)·η_det. */
  eta: number;
  /** Gain: detection probability per pulse (Y₁ or Q_μ). */
  gain: number;
  qber: number;
  /** Secret bits per sifted bit (0 when no key). */
  fraction: number;
  /** Secret bits per pulse. */
  perPulse: number;
}

export interface QkdResult extends QkdPoint {
  ok: true;
  mu: number | null;
  muOptimised: boolean;
  siftedRate: number;
  keyRate: number;
  /** Shor–Preskill QBER threshold (≈ 11 %). */
  thresholdQber: number;
  /** Channel loss at which the key reaches zero, dB; null = no cutoff (no dark counts); -1 = no key at any loss. */
  cutoffDb: number | null;
  /** Decoy only: single-photon gain Q₁ and error e₁. */
  q1: number | null;
  e1: number | null;
}

/** One point of the chosen model at transmission η. */
export function qkdAt(source: QkdSource, eta: number, y0: number, ed: number, mu: number, f: number): QkdPoint & { q1: number | null; e1: number | null } {
  const y1 = y0 + eta - y0 * eta;
  const e1 = (E0 * y0 + ed * eta) / y1;
  if (source === "single") {
    const bb = bb84KeyRate(Math.min(0.5, e1));
    const fraction = bb ? bb.keyRate : 0;
    return { eta, gain: y1, qber: e1, fraction, perPulse: Q_SIFT * y1 * fraction, q1: null, e1: null };
  }
  const em = Math.exp(-eta * mu);
  const qmu = y0 + 1 - em;
  const emu = (E0 * y0 + ed * (1 - em)) / qmu;
  const q1 = y1 * mu * Math.exp(-mu);
  const r = Q_SIFT * (-qmu * f * binaryEntropy(Math.min(0.5, emu)) + q1 * (1 - binaryEntropy(Math.min(0.5, e1))));
  const perPulse = Math.max(0, r);
  return { eta, gain: qmu, qber: emu, fraction: perPulse / (Q_SIFT * qmu), perPulse, q1, e1 };
}

/** μ search interval for the optimiser. */
const MU_LO = 0.01;
const MU_HI = 1.5;

/** The μ that maximises the decoy key rate at transmission η: golden section, 80 steps (interval shrinks by 10⁻¹⁶). */
export function optimalMu(eta: number, y0: number, ed: number, f: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = MU_LO;
  let b = MU_HI;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  const val = (m: number): number => Q_SIFT * (-(y0 + 1 - Math.exp(-eta * m)) * f * binaryEntropy(Math.min(0.5, (E0 * y0 + ed * (1 - Math.exp(-eta * m))) / (y0 + 1 - Math.exp(-eta * m)))) + (y0 + eta - y0 * eta) * m * Math.exp(-m) * (1 - binaryEntropy(Math.min(0.5, (E0 * y0 + ed * eta) / (y0 + eta - y0 * eta)))));
  let fc = val(c);
  let fd = val(d);
  for (let i = 0; i < 80; i++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = val(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = val(d);
    }
  }
  return (a + b) / 2;
}

export function validateQkdInput(inp: QkdInput): Err | null {
  const { rate, lossDb, detEff, y0, ed, source, mu, f } = inp;
  if (!fin(rate, lossDb, detEff, y0, ed, f) || (mu !== null && !Number.isFinite(mu))) return err("Every input must be a finite number.");
  if (!(rate > 0)) return err("The repetition rate must be greater than zero.");
  if (rate > 1e13) return err("A repetition rate above 10¹³ per second is beyond any source: check the entry.");
  if (lossDb < 0) return err("The channel loss must be zero or more (a loss in dB is entered as a positive number).");
  if (lossDb > MAX_LOSS_DB) return err(`The channel loss is above ${MAX_LOSS_DB} dB: check the entry.`);
  if (!(detEff > 0) || detEff > 1) return err("The detector efficiency must be above 0 and at most 1.");
  if (y0 < 0 || y0 > 0.1) return err("The background count probability Y₀ must be from 0 to 0.1 per pulse.");
  if (ed < 0 || ed >= 0.5) return err("The intrinsic error e_det must be from 0 up to (not including) 0.5.");
  if (source === "decoy" && mu !== null && (!(mu > 0) || mu > 2))
    return err("The mean photon number μ must be above 0 and at most 2 (the decoy analysis is for weak pulses).");
  // Checked in both modes: with a single-photon source f sets the decoy reference curve.
  if (f < 1 || f > 2) return err("The error-correction efficiency f must be from 1 (the Shannon limit) to 2.");
  return null;
}

export function qkdLink(inp: QkdInput): QkdResult | Err {
  const bad = validateQkdInput(inp);
  if (bad) return bad;
  const { rate, lossDb, detEff, y0, ed, source, f } = inp;
  const eta = fromDb(-lossDb) * detEff;
  const thr = (bb84KeyRate(0) as NonNullable<ReturnType<typeof bb84KeyRate>>).thresholdQber;
  let mu: number | null = null;
  let muOptimised = false;
  if (source === "decoy") {
    if (inp.mu === null) {
      mu = optimalMu(eta, y0, ed, f);
      muOptimised = true;
    } else mu = inp.mu;
  }
  const pt = qkdAt(source, eta, y0, ed, mu ?? 0, f);
  // Zero-key cutoff in channel loss.
  let cutoffDb: number | null;
  if (source === "single") {
    // e₁(η) = Q* ⇔ η* = Y₀(Q* − e₀)/(e_det − Q*(1 − Y₀)); e_det ≥ Q* ⇒ no key at any loss.
    if (ed >= thr) cutoffDb = -1;
    else if (y0 === 0) cutoffDb = null;
    else {
      const etaStar = (y0 * (thr - E0)) / (ed - thr * (1 - y0));
      const chan = etaStar / detEff;
      cutoffDb = chan >= 1 ? -1 : -toDb(chan);
    }
  } else {
    const m = mu as number;
    const rAt = (l: number): number => qkdAt("decoy", fromDb(-l) * detEff, y0, ed, m, f).perPulse;
    if (!(rAt(0) > 0)) cutoffDb = -1;
    else if (rAt(MAX_LOSS_DB) > 0) cutoffDb = y0 === 0 ? null : MAX_LOSS_DB;
    else {
      let lo = 0;
      let hi = MAX_LOSS_DB;
      for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
        const mid = (lo + hi) / 2;
        if (rAt(mid) > 0) lo = mid;
        else hi = mid;
      }
      cutoffDb = (lo + hi) / 2;
    }
  }
  return {
    ok: true,
    ...pt,
    mu,
    muOptimised,
    siftedRate: rate * Q_SIFT * pt.gain,
    keyRate: rate * pt.perPulse,
    thresholdQber: thr,
    cutoffDb,
  };
}
