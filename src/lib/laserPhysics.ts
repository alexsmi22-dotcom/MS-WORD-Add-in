// Laser physics and nonlinear optics (Release E, gap #5): the Fabry–Pérot cavity, laser threshold and slope efficiency,
// coherence from a linewidth (with the Schawlow–Townes limit), and second-harmonic phase matching.
//
// Pure functions; the pane glue is laserCalcs.ts, the figures laserCharts.ts. The constants are optics.ts's exact SI
// ones, so the app has one c and one h. optics.ts's resonator() is a different question (mode size from mirror
// CURVATURE); nothing here duplicates it.
//
// SOURCES (each formula below was checked against the text named; the wikitext was read raw, 2026-10-23):
//   [FP]  Wikipedia "Fabry–Pérot interferometer" (after Ismail, Kores, Geskus & Pollnau, Opt. Express 24, 16366 (2016)):
//         t_RT = 1/Δν_FSR = 2ℓ/c (c the speed in the medium, c₀/n); 1/τ_c = −ln(R₁R₂)/t_RT; Δν_c = 1/(2πτ_c);
//         Lorentzian finesse 2π/(−ln R₁R₂); Airy linewidth Δν_FSR·(2/π)·arcsin((1 − √(R₁R₂))/(2·(R₁R₂)^¼)) and its
//         approximation F ≈ π(R₁R₂)^¼/(1 − √(R₁R₂)) (= π√R/(1 − R) with R = √(R₁R₂), the brief's form);
//         A′_trans = (1 − R₁)(1 − R₂)/((1 − √(R₁R₂))² + 4√(R₁R₂)·sin²φ), with 2φ = 2πν·t_RT.
//   [Q]   Wikipedia "Q factor": Q = f_r/Δf (FWHM); "the optical Q is equal to the ratio of the resonant frequency to the
//         bandwidth of the cavity resonance".
//   [LT]  Wikipedia "Lasing threshold" (after Yariv, Quantum Electronics, 3rd ed.): R₁R₂·exp(2g_th·l)·exp(−2αl) = 1,
//         g_th = α₀ − (1/2l)·ln(R₁R₂); α a power (intensity) loss per unit length.
//   [EXT] Sobolev et al., arXiv:2408.02469, Sec. IV: 1/η_ext = (α_i/α_m + 1)/η_i, i.e. η_ext = η_i·α_m/(α_m + α_i)
//         (a diode laser, where η_i is the internal quantum efficiency); arXiv:2306.10360 Eq. 1: α_m = −(1/2L)ln(R₁R₂).
//   [QD]  Wikipedia "Quantum defect (lasers)": the quantum defect is the part of the pump photon's energy not turned
//         into a laser photon, ħω_p − ħω_s; it bounds the power efficiency. A laser photon per pump photon therefore
//         carries the power fraction ω_s/ω_p = λ_p/λ (E = hc/λ).
//   [LW]  Wikipedia "Laser linewidth": Δν_L,ST = 2πhν_L(Δν_c)²/P_out (FWHM; Δν_c the passive cavity's FWHM linewidth);
//         τ^coh = 2τ with Δν = 1/(2πτ), so a Lorentzian line of FWHM Δν has τ_coh = 1/(πΔν), L_coh = cτ_coh.
//   [CL]  Wikipedia "Coherence length" (after Akcay, Parrein & Rolland, Appl. Opt. 41, 5256 (2002), eq. 8): a Gaussian
//         spectrum of FWHM Δλ has L = (2 ln 2/π)·λ²/(n_g Δλ), the path offset at which fringe visibility falls to 50 %;
//         the 1/e visibility convention is also stated there.
//   [SHG] Wikipedia "Second-harmonic generation": Δk = k(2ω) − 2k(ω); ℓ_c = π/Δk; plane-wave, undepleted pump:
//         I(2ω, ℓ) = 2ω²d_eff²ℓ²/(n_2ω n_ω² c³ ε₀)·sinc²(Δkℓ/2)·I²(ω). Cross-checked against the Université
//         Paris-Saclay exercise (η = (2ω)²/(8ε₀n_ω²n_2ωc³)·χ_eff²·sinc²(Δkz/2)·I·z², the same with χ_eff = 2d_eff).
//   [QPM] Hum & Fejer, C. R. Physique 8, 180 (2007), Sec. 2.1–2.2: ℓ_c = π/(k₂ − 2k₁) = λ/(4(n₂ − n₁)); a grating of
//         period Λ has K_g = 2π/Λ and moves the phase-matching peak to Δk = mK_g, so first order Λ = 2π/Δk = 2ℓ_c
//         (also Aston: "the poling period being double the coherence length"); square-wave Fourier coefficient
//         d_m = d_eff·2 sin(mπD)/(mπ), 2d_eff/π at m = 1, D = 50 %. (Wikipedia's QPM page writes Λ = π/Δk; that is
//         the domain length, not the period, and is NOT used.)
//   Not included, because no source was read for them: how α_m divides between the two mirrors (the share of the output
//   leaving through the output coupler); the Gaussian-beam (Boyd–Kleinman) SHG focusing function, the
//   Henry α-factor broadening of Schawlow–Townes, threshold pump power from cross-sections and lifetimes.

import { C_LIGHT, H_PLANCK } from "./optics";
// The app's one ε₀ (lcRetarder.ts), so the SHG efficiency and the LC retarder never disagree on a constant.
import { EPS0 } from "./lcRetarder";

export type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

// ---------------------------------------------------------------------------------------------------------------
// 1. Fabry–Pérot cavity
// ---------------------------------------------------------------------------------------------------------------

export interface FabryPerotInput {
  /** Mirror spacing, m. */
  L: number;
  /** Refractive (group) index between the mirrors. */
  n: number;
  /** Mirror power reflectivities, 0 < R < 1. */
  R1: number;
  R2: number;
  /** Vacuum wavelength, m (for ν and Q); null for none. */
  lambda: number | null;
}

export interface FabryPerotResult {
  ok: true;
  fsr: number;
  /** √(R₁R₂), the effective reflectivity. */
  R: number;
  /** π√R/(1 − R), the brief's (approximate Airy) finesse. */
  finesse: number;
  /** Exact Airy finesse; null when the Airy peaks have no half maximum (R₁R₂ ≤ 0.0294). */
  finesseExact: number | null;
  /** FWHM of the transmission peaks, FSR/F (Hz). */
  linewidth: number;
  /** Round-trip time, s. */
  tRT: number;
  /** Photon (energy) decay time, mirror loss only, s. */
  tauC: number;
  /** Lorentzian linewidth of the decaying mode, 1/(2πτ_c) (Hz). */
  dnuC: number;
  /** Lorentzian finesse 2π/(−ln R₁R₂). */
  finesseLorentz: number;
  /** Optical frequency (Hz) and Q = ν/Δν; null without a wavelength. */
  nu: number | null;
  Q: number | null;
  /** Peak transmission (1 − R₁)(1 − R₂)/(1 − √(R₁R₂))², lossless mirrors. */
  peakT: number;
}

export function fabryPerot(inp: FabryPerotInput): FabryPerotResult | Fail {
  const { L, n, R1, R2, lambda } = inp;
  if (!fin(L, n, R1, R2)) return fail("Every input must be a finite number.");
  if (!(L > 0)) return fail("The mirror spacing must be greater than zero.");
  if (L < 1e-9) return fail("The mirror spacing is below 1 nm, shorter than any optical cavity: check the unit.");
  if (!(n >= 1) || n > 10) return fail("The refractive (group) index must be from 1 to 10.");
  // A PERFECT MIRROR, named (fix2-eng2: R₁ = 1 fell into the generic range refusal). Both perfect: a closed lossless
  // cavity, finesse and photon lifetime infinite. One perfect: nothing is ever transmitted (a Gires–Tournois
  // reflector), so the transmission peaks, their linewidth and the Airy curve this tool draws do not exist.
  if (R1 === 1 && R2 === 1)
    return fail("R₁ = R₂ = 1: two perfect mirrors make a closed, lossless cavity — the finesse and photon lifetime are infinite and nothing gets in or out. Give a real reflectivity below 1 (e.g. 0.9999) for at least one mirror.");
  if (R1 === 1 || R2 === 1)
    return fail(`${R1 === 1 ? "R₁" : "R₂"} = 1 is a perfect mirror: it transmits nothing, so the etalon's transmission is zero at every frequency (a Gires–Tournois reflector) and there are no transmission peaks, transmission linewidth or Airy curve to compute. Give its real reflectivity below 1 (e.g. 0.9999); for a laser cavity with a 100 % high reflector use Laser threshold & slope efficiency, which accepts R = 1.`);
  for (const [R, name] of [[R1, "R₁"], [R2, "R₂"]] as const)
    if (!(R > 0 && R < 1)) return fail(`${name} must be a reflectivity strictly between 0 and 1 (a fraction: 0.99, or 99 %).`);
  if (lambda !== null && !(Number.isFinite(lambda) && lambda > 0)) return fail("The wavelength must be greater than zero.");
  const fsr = C_LIGHT / (2 * n * L);
  const tRT = 1 / fsr;
  const R = Math.sqrt(R1 * R2);
  const finesse = (Math.PI * Math.sqrt(R)) / (1 - R);
  const arg = (1 - R) / (2 * Math.pow(R1 * R2, 0.25));
  const finesseExact = arg < 1 ? Math.PI / 2 / Math.asin(arg) : null;
  const lnRR = -Math.log(R1 * R2);
  const tauC = tRT / lnRR;
  const dnuC = 1 / (2 * Math.PI * tauC);
  const linewidth = fsr / finesse;
  const nu = lambda === null ? null : C_LIGHT / lambda;
  const Q = nu === null ? null : nu / linewidth;
  const peakT = ((1 - R1) * (1 - R2)) / ((1 - R) * (1 - R));
  return { ok: true, fsr, R, finesse, finesseExact, linewidth, tRT, tauC, dnuC, finesseLorentz: (2 * Math.PI) / lnRR, nu, Q, peakT };
}

/** Airy transmission A′_trans of a lossless Fabry–Pérot at a detuning (Hz) from a resonance. */
export function fpTransmission(R1: number, R2: number, fsr: number, detune: number): number {
  const R = Math.sqrt(R1 * R2);
  const s = Math.sin((Math.PI * detune) / fsr);
  return ((1 - R1) * (1 - R2)) / ((1 - R) * (1 - R) + 4 * R * s * s);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Laser threshold and slope efficiency
// ---------------------------------------------------------------------------------------------------------------

export interface ThresholdInput {
  /** Gain-medium (= cavity) length, m. */
  L: number;
  /** Internal (distributed) power loss, 1/m. */
  alphaI: number;
  R1: number;
  R2: number;
  /** Pump and laser vacuum wavelengths, m. */
  lambdaP: number;
  lambda: number;
  /** Internal efficiency, 0 < η_i ≤ 1. */
  etaI: number;
  /** Refractive (group) index of the medium, for the photon lifetime. */
  n: number;
  /** Threshold pump power, W (a measured or quoted value); null for none. */
  Pth: number | null;
  /** Pump power, W; null for none. */
  Pp: number | null;
}

export interface ThresholdResult {
  ok: true;
  alphaM: number;
  gth: number;
  /** α_m/(α_m + α_i): the share of the generated light that leaves through the mirrors (both of them). */
  extraction: number;
  /** λ_p/λ, the quantum-defect factor. */
  quantum: number;
  /** η_s = η_i·α_m/(α_m + α_i)·λ_p/λ. */
  etaS: number;
  /**
   * Photon lifetime n/(c(α_i + α_m)), s: DERIVED, not quoted — [FP]'s 1/τ = −ln(R₁R₂)/t_RT with t_RT = 2nL/c, and the
   * round-trip internal loss e^(−2α_i L) of [LT] added to the mirror loss.
   */
  tauP: number;
  /** Output power at Pp (both mirrors), W; null without Pp and Pth. */
  Pout: number | null;
}

export function laserThreshold(inp: ThresholdInput): ThresholdResult | Fail {
  const { L, alphaI, R1, R2, lambdaP, lambda, etaI, n, Pth, Pp } = inp;
  if (!fin(L, alphaI, R1, R2, lambdaP, lambda, etaI, n)) return fail("Every input must be a finite number.");
  if (!(L > 0)) return fail("The cavity length must be greater than zero.");
  if (L < 1e-9) return fail("The cavity length is below 1 nm, shorter than any laser cavity (the mirror loss would be unbounded): check the unit.");
  if (!(alphaI >= 0)) return fail("The internal loss cannot be negative.");
  for (const [R, name] of [[R1, "R₁"], [R2, "R₂"]] as const)
    if (!(R > 0 && R <= 1)) return fail(`${name} must be a reflectivity above 0 and at most 1 (a fraction: 0.95, or 95 %).`);
  if (R1 * R2 >= 1) return fail("With R₁ = R₂ = 1 nothing leaves the cavity: the mirror loss and the output are zero. Give the output coupler's reflectivity below 1.");
  if (!(lambdaP > 0 && lambda > 0)) return fail("The wavelengths must be greater than zero.");
  if (lambdaP > lambda) return fail("The pump wavelength is longer than the laser wavelength: a pump photon would carry less energy than the laser photon it makes (the quantum-defect model needs λₚ ≤ λ).");
  if (!(etaI > 0 && etaI <= 1)) return fail("The internal efficiency ηᵢ must be above 0 and at most 1.");
  if (!(n >= 1) || n > 10) return fail("The refractive (group) index must be from 1 to 10.");
  if (Pth !== null && !(Number.isFinite(Pth) && Pth > 0)) return fail("The threshold pump power must be greater than zero.");
  if (Pp !== null && !(Number.isFinite(Pp) && Pp >= 0)) return fail("The pump power cannot be negative.");
  const alphaM = (1 / (2 * L)) * Math.log(1 / (R1 * R2));
  const gth = alphaI + alphaM;
  const extraction = alphaM / (alphaM + alphaI);
  const quantum = lambdaP / lambda;
  const etaS = etaI * extraction * quantum;
  const tauP = n / (C_LIGHT * (alphaI + alphaM));
  const Pout = Pp !== null && Pth !== null ? outputPower(etaS, Pp, Pth) : null;
  return { ok: true, alphaM, gth, extraction, quantum, etaS, tauP, Pout };
}

/** P_out = η_s(P_p − P_th) above threshold, 0 at and below it (never negative). */
export function outputPower(etaS: number, Pp: number, Pth: number): number {
  return Pp > Pth ? etaS * (Pp - Pth) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Coherence and the Schawlow–Townes limit
// ---------------------------------------------------------------------------------------------------------------

export type LineShape = "lorentzian" | "gaussian";

export interface CoherenceResult {
  ok: true;
  shape: LineShape;
  dnu: number;
  /** Delay (s) and path difference (m) at which |γ| falls to 1/e and to 1/2. */
  tau1e: number;
  tauHalf: number;
  L1e: number;
  LHalf: number;
  /** The cited headline: 1/e for a Lorentzian [LW], 1/2 for a Gaussian [CL]. */
  tauCoh: number;
  Lcoh: number;
  convention: "1/e" | "1/2";
}

/**
 * |γ(τ)|, the degree of coherence (the normalised Fourier transform of the power spectrum, Wiener–Khinchin): exp(−πΔν|τ|)
 * for a Lorentzian of FWHM Δν (the e^(−t/2τ_c) field decay of [FP]), exp(−(πΔντ)²/(4 ln 2)) for a Gaussian of FWHM Δν.
 */
export function coherenceDegree(shape: LineShape, dnu: number, tau: number): number {
  const x = Math.PI * dnu * Math.abs(tau);
  return shape === "lorentzian" ? Math.exp(-x) : Math.exp(-(x * x) / (4 * Math.LN2));
}

export function coherence(shape: LineShape, dnu: number): CoherenceResult | Fail {
  if (!Number.isFinite(dnu) || !(dnu > 0)) return fail("The linewidth must be greater than zero.");
  const p = Math.PI * dnu;
  // Inverting |γ|: Lorentzian e^(−x) = level → x = −ln(level); Gaussian e^(−x²/4ln2) = level → x = 2√(−ln2·ln(level)).
  const tau1e = shape === "lorentzian" ? 1 / p : (2 * Math.sqrt(Math.LN2)) / p;
  const tauHalf = shape === "lorentzian" ? Math.LN2 / p : (2 * Math.LN2) / p;
  const conv = shape === "lorentzian" ? "1/e" : "1/2";
  const tauCoh = conv === "1/e" ? tau1e : tauHalf;
  return { ok: true, shape, dnu, tau1e, tauHalf, L1e: C_LIGHT * tau1e, LHalf: C_LIGHT * tauHalf, tauCoh, Lcoh: C_LIGHT * tauCoh, convention: conv };
}

/** Δν = cΔλ/λ² (first order in Δλ/λ); refused beyond Δλ/λ = 0.1, where the first-order conversion stops holding. */
export function linewidthFromWavelength(dlambda: number, lambda: number): number | Fail {
  if (!(dlambda > 0) || !(lambda > 0) || !fin(dlambda, lambda)) return fail("The linewidth and the centre wavelength must be greater than zero.");
  if (dlambda / lambda > 0.1) return fail("A wavelength linewidth above a tenth of the centre wavelength is not a narrow line: Δν = cΔλ/λ² no longer holds. Give the linewidth in frequency.");
  return (C_LIGHT * dlambda) / (lambda * lambda);
}

/** Schawlow–Townes FWHM linewidth 2πhν(Δν_c)²/P_out [LW]. */
export function schawlowTownes(lambda: number, dnuC: number, Pout: number): number | Fail {
  if (!fin(lambda, dnuC, Pout) || !(lambda > 0) || !(dnuC > 0) || !(Pout > 0)) return fail("Schawlow–Townes needs a wavelength, a cavity linewidth and an output power, all greater than zero.");
  return (2 * Math.PI * H_PLANCK * (C_LIGHT / lambda) * dnuC * dnuC) / Pout;
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Second-harmonic generation
// ---------------------------------------------------------------------------------------------------------------

export type PhaseMatching = "none" | "qpm" | "perfect";

export interface ShgInput {
  /** Fundamental vacuum wavelength, m. */
  lambda: number;
  nW: number;
  n2W: number;
  /** Crystal length, m; null for none. */
  L: number | null;
  mode: PhaseMatching;
  /** QPM period, m (first order); null = the computed 2π/|Δk|. */
  period: number | null;
  /** Effective nonlinear coefficient, m/V; null for none. */
  deff: number | null;
  /** Fundamental intensity, W/m²; null for none. */
  I: number | null;
}

export interface ShgResult {
  ok: true;
  /** Signed material mismatch k(2ω) − 2k(ω), 1/m. */
  dk: number;
  /** π/|Δk| and 2π/|Δk|, m; null when Δk = 0. */
  lc: number | null;
  period: number | null;
  /** The mismatch left after the chosen phase matching, 1/m. */
  dkRes: number;
  /** The QPM period used (m), when mode = "qpm". */
  periodUsed: number | null;
  /** Coefficient driving the wave: d_eff, or 2d_eff/π under first-order QPM. */
  dDrive: number | null;
  /** sinc²(Δk_res·L/2); null without L. */
  sinc2: number | null;
  /** Full width of the sinc² peak in Δk (1/m), 4·1.39156/L; null without L. */
  dkFwhm: number | null;
  /** Plane-wave, undepleted-pump efficiency I(2ω)/I(ω); null when an input is missing. */
  eta: number | null;
}

/** The half-maximum point of sinc²(x): sin²x/x² = 1/2 at x = 1.39155737825151 (scipy brentq). */
export const SINC2_HALF_X = 1.39155737825151;

export function sinc2(x: number): number {
  if (Math.abs(x) < 1e-8) return 1 - (x * x) / 3;
  const s = Math.sin(x) / x;
  return s * s;
}

export function shg(inp: ShgInput): ShgResult | Fail {
  const { lambda, nW, n2W, L, mode, period, deff, I } = inp;
  if (!fin(lambda, nW, n2W) || !(lambda > 0)) return fail("The fundamental wavelength must be greater than zero.");
  if (!(nW >= 1 && nW <= 10 && n2W >= 1 && n2W <= 10)) return fail("The refractive indices must be from 1 to 10.");
  if (L !== null && !(Number.isFinite(L) && L > 0)) return fail("The crystal length must be greater than zero.");
  if (period !== null && !(Number.isFinite(period) && period > 0)) return fail("The QPM period must be greater than zero.");
  if (deff !== null && !(Number.isFinite(deff) && deff > 0)) return fail("d(eff) must be greater than zero (its magnitude).");
  if (I !== null && !(Number.isFinite(I) && I > 0)) return fail("The fundamental intensity must be greater than zero.");
  const dk = ((4 * Math.PI) / lambda) * (n2W - nW);
  const adk = Math.abs(dk);
  const lc = adk > 0 ? Math.PI / adk : null;
  const per = adk > 0 ? (2 * Math.PI) / adk : null;
  let dkRes = dk;
  let periodUsed: number | null = null;
  let dDrive = deff;
  if (mode === "perfect") dkRes = 0;
  else if (mode === "qpm") {
    if (adk === 0) return fail("n(2ω) = n(ω): the interaction is already phase-matched (Δk = 0) and needs no QPM grating. Choose “perfect”.");
    periodUsed = period ?? (per as number);
    // The grating vector cancels |Δk|; what remains is |Δk| − 2π/Λ (its sign does not enter sinc²).
    dkRes = adk - (2 * Math.PI) / periodUsed;
    dDrive = deff === null ? null : (2 / Math.PI) * deff;
  }
  const sinc = L === null ? null : sinc2((dkRes * L) / 2);
  const dkFwhm = L === null ? null : (4 * SINC2_HALF_X) / L;
  let eta: number | null = null;
  if (L !== null && dDrive !== null && I !== null && sinc !== null) {
    const w = (2 * Math.PI * C_LIGHT) / lambda;
    eta = ((2 * w * w * dDrive * dDrive * L * L) / (n2W * nW * nW * C_LIGHT ** 3 * EPS0)) * sinc * I;
  }
  return { ok: true, dk, lc, period: per, dkRes, periodUsed, dDrive, sinc2: sinc, dkFwhm, eta };
}

/**
 * Second-harmonic growth along the crystal, |∫₀ᶻ s(z′)e^(−iΔkz′)dz′|² / ℓ_c² (the integral of Hum & Fejer Eq. 2, with a
 * plane, undepleted pump), for s ≡ 1 at Δk = 0 ("perfect"), s ≡ 1 at the material Δk ("none"), and s flipping sign
 * every ℓ_c ("qpm", first order, 50 % duty). Exact piecewise sums; `points` and the segment count are capped.
 */
export function shgGrowth(adk: number, zMax: number, points = 241): Array<{ perfect: number; none: number; qpm: number; z: number }> {
  const out: Array<{ perfect: number; none: number; qpm: number; z: number }> = [];
  if (!(adk > 0) || !(zMax > 0) || !Number.isFinite(adk) || !Number.isFinite(zMax)) return out;
  const lc = Math.PI / adk;
  const n = Math.max(2, Math.min(2001, Math.floor(points)));
  // ∫_a^b e^(−iΔkz) dz = (e^(−iΔka) − e^(−iΔkb))/(iΔk), split into (re, im).
  const seg = (a: number, b: number): [number, number] => {
    const re = (Math.sin(adk * b) - Math.sin(adk * a)) / adk;
    const im = (Math.cos(adk * b) - Math.cos(adk * a)) / adk;
    return [re, im];
  };
  const maxSeg = Math.min(400, Math.ceil(zMax / lc) + 1);
  for (let i = 0; i < n; i++) {
    // The last sample is zMax exactly (zMax·i/(n − 1) can land one ulp past it, outside a figure's axis limit).
    const z = i === n - 1 ? zMax : (zMax * i) / (n - 1);
    const [nr, ni] = seg(0, z);
    let qr = 0, qi = 0;
    for (let k = 0; k < maxSeg && k * lc < z; k++) {
      const [r, im] = seg(k * lc, Math.min(z, (k + 1) * lc));
      const s = k % 2 === 0 ? 1 : -1;
      qr += s * r;
      qi += s * im;
    }
    out.push({ z, perfect: (z * z) / (lc * lc), none: (nr * nr + ni * ni) / (lc * lc), qpm: (qr * qr + qi * qi) / (lc * lc) });
  }
  return out;
}
