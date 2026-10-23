// Semiconductor devices (Release E, gap #9): the abrupt pn junction (built-in potential, depletion width, junction
// capacitance, the Shockley diode), the long-channel MOSFET square law, and equilibrium carrier statistics.
//
// THE MATERIAL CONSTANTS ARE ONE CITED BLOCK (MATERIALS below) and every one of them is overridable in the pane.
// Each was read from a fetched copy of its source on 2026-10-23 — nothing here is from memory:
//   - Ioffe Institute, "New Semiconductor Materials. Characteristics and Properties" (NSM archive):
//       Si   https://www.ioffe.ru/SVA/NSM/Semicond/Si/basic.html (dielectric constant 11.7)
//            https://www.ioffe.ru/SVA/NSM/Semicond/Si/bandstr.html (Eg 1.12 eV, Nc 3.2·10¹⁹, Nv 1.8·10¹⁹ cm⁻³,
//            intrinsic carrier concentration 1·10¹⁰ cm⁻³ — all under "Basic Parameters at 300 K")
//       GaAs https://www.ioffe.ru/SVA/NSM/Semicond/GaAs/basic.html (static dielectric constant 12.9)
//            https://www.ioffe.ru/SVA/NSM/Semicond/GaAs/bandstr.html (Eg 1.424 eV, Nc 4.7·10¹⁷, Nv 9.0·10¹⁸ cm⁻³,
//            nᵢ 2.1·10⁶ cm⁻³)
//     (fetched with curl -k: the site's certificate chain did not verify from this machine; the text was read.)
//   - Si nᵢ: P. P. Altermatt, A. Schenk, F. Geelhaar, G. Heiser, "Reassessment of the intrinsic carrier density in
//     crystalline silicon in view of band-gap narrowing", J. Appl. Phys. 93, 1598 (2003), doi:10.1063/1.1529297 —
//     checked against the PUBLISHED ABSTRACT (Crossref record), which states nᵢ = 9.65×10⁹ cm⁻³ at 300 K (and that
//     the commonly used 1.00×10¹⁰ cm⁻³ of Sproul & Green 1991 was influenced by band-gap narrowing). That value is the
//     Si preset; Ioffe's 1·10¹⁰ is NOT used for Si, so one material never has two nᵢ. The full paper was not read.
//   - Textbooks also quote 1.5×10¹⁰ cm⁻³: three values in circulation, which is why every result STATES the nᵢ it used
//     and where it came from, and why the field is overridable.
// What is NOT here: the oxide permittivity (a TU Wien thesis table gives 3.7–3.9 for SiO₂ citing a reference we could
// not resolve, so ε_ox is the user's input), mobilities (doping- and temperature-dependent tables: user inputs), and
// any temperature dependence (the presets are 300 K values; at another temperature nᵢ must be typed).
//
// THE PRESETS ARE NOT MUTUALLY CONSISTENT, and the code never pretends they are: √(Nc·Nv)·exp(−Eg/2kT) from Ioffe's
// own Si numbers is about 9.4×10⁹ cm⁻³, a third value beside 9.65×10⁹ and 1×10¹⁰. So nᵢ is NEVER derived from Nc, Nv
// and Eg; EF − Eᵢ comes from nᵢ, and a band-edge distance (from Nc or Nv) is labelled as coming from other data.
//
// Physical constants: k/q from chips.ts (K_BOLTZMANN_EV, eV/K = V/K), q from optics.ts, ε₀ from lcRetarder.ts
// (CODATA 2018). Concentrations are cm⁻³ at the interface (as datasheets write them) and m⁻³ inside formulas.

import { K_BOLTZMANN_EV } from "./chips";
import { E_CHARGE } from "./optics";
import { EPS0 } from "./lcRetarder";
import { fmtSig } from "./axis";

export type MaterialId = "si" | "gaas";

export interface MaterialData {
  id: MaterialId;
  label: string;
  /** Band gap, eV. */
  eg: number;
  /** Effective densities of states, cm⁻³. */
  nc: number;
  nv: number;
  /** Intrinsic carrier density, cm⁻³. */
  ni: number;
  /** Static relative permittivity. */
  epsR: number;
  /** Where nᵢ comes from (stated in every result that uses it). */
  niSource: string;
  /** Where Eg, Nc, Nv, εᵣ come from. */
  source: string;
}

/** The temperature every preset is quoted at, K. */
export const PRESET_T = 300;

/** THE cited block (see the header for what was read, where and when). */
export const MATERIALS: Record<MaterialId, MaterialData> = {
  si: {
    id: "si",
    label: "Si",
    eg: 1.12,
    nc: 3.2e19,
    nv: 1.8e19,
    ni: 9.65e9,
    epsR: 11.7,
    niSource: "Si at 300 K: Altermatt et al., J. Appl. Phys. 93, 1598 (2003)",
    source: "Ioffe Institute NSM archive, Si (300 K)",
  },
  gaas: {
    id: "gaas",
    label: "GaAs",
    eg: 1.424,
    nc: 4.7e17,
    nv: 9.0e18,
    ni: 2.1e6,
    epsR: 12.9,
    niSource: "GaAs at 300 K: Ioffe Institute NSM archive",
    source: "Ioffe Institute NSM archive, GaAs (300 K)",
  },
};

/** Fermi level closer than this many kT to a band edge = degenerate: Boltzmann statistics no longer hold. */
export const DEGENERACY_KT = 3;
/** Doping must exceed nᵢ by this factor for the depletion approximation (a junction needs majority carriers). */
export const MIN_DOPING_OVER_NI = 100;
/** Largest Shockley exponent V/(nVₜ) evaluated (exp overflows a double past 709). */
export const MAX_EXPONENT = 700;
/** Temperature range accepted, K. */
export const T_MIN = 1;
export const T_MAX = 2000;

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const fin = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));

/** kT/q in volts. */
export function thermalVoltage(tK: number): number {
  return K_BOLTZMANN_EV * tK;
}

/** The highest majority density at which EF stays DEGENERACY_KT·kT from the band edge: N·e⁻³. */
export function degeneracyLimit(nEdge: number): number {
  return nEdge * Math.exp(-DEGENERACY_KT);
}

/** Three significant figures, ×10ⁿ (axis.ts fmtSig), for refusal messages. */
const sci = (v: number): string => fmtSig(v, 3);

// ---------------------------------------------------------------------------------------------------------------
// pn junction
// ---------------------------------------------------------------------------------------------------------------

export interface PnInput {
  /** Acceptor (p side) and donor (n side) densities, cm⁻³. */
  na: number;
  nd: number;
  /** Intrinsic density, cm⁻³. */
  ni: number;
  epsR: number;
  tK: number;
  /** Reverse bias, V (≥ 0). */
  vr: number;
  /** Effective densities of states, cm⁻³, for the degeneracy check (null = not checked). */
  nc: number | null;
  nv: number | null;
}

export interface PnResult {
  vt: number;
  vbi: number;
  /** Total depletion width and its two sides, m. */
  w: number;
  xn: number;
  xp: number;
  /** Peak field at the metallurgical junction, V/m. */
  emax: number;
  /** Junction capacitance per area at vr, F/m². */
  cj: number;
  /** Zero-bias capacitance per area, F/m². */
  cj0: number;
  /** One-sided (lighter side only) width when the doping ratio is ≥ 10, m; null otherwise. */
  w1: number | null;
  /** "p" when the p side is the lightly doped one (one-sided n⁺p), "n" for p⁺n, null when not one-sided. */
  lightSide: "p" | "n" | null;
  degeneracyChecked: boolean;
}

/** Depletion width (m) of an abrupt junction at total potential vbi + vr. Densities in cm⁻³. */
export function depletionWidth(na: number, nd: number, epsR: number, vTotal: number): number {
  const eps = epsR * EPS0;
  return Math.sqrt(((2 * eps * vTotal) / E_CHARGE) * (1 / (na * 1e6) + 1 / (nd * 1e6)));
}

/**
 * Abrupt (step) pn junction in the depletion approximation, complete ionisation, non-degenerate doping:
 *   Vbi = (kT/q) ln(N_A N_D / nᵢ²),  W = √(2ε(Vbi + V_R)/q · (1/N_A + 1/N_D)),  C′ = ε/W.
 * The 2kT/q majority-carrier-tail correction to Vbi in W is NOT applied (the textbook form; it is stated).
 */
export function pnJunction(p: PnInput): Result<PnResult> {
  if (!fin(p.na, p.nd, p.ni, p.epsR, p.tK, p.vr)) return { ok: false, error: "Every input must be a finite number." };
  if (p.na <= 0 || p.nd <= 0) return { ok: false, error: "Both N_A and N_D must be positive: a pn junction needs acceptors on one side and donors on the other." };
  if (p.ni <= 0) return { ok: false, error: "nᵢ must be positive." };
  if (p.epsR < 1) return { ok: false, error: "The relative permittivity εᵣ must be at least 1." };
  if (p.tK < T_MIN || p.tK > T_MAX) return { ok: false, error: `Temperature must lie between ${T_MIN} K and ${T_MAX} K.` };
  if (p.vr < 0)
    return {
      ok: false,
      error:
        "Reverse bias V_R must be zero or positive. Forward bias is not computed: the depletion approximation fails as V approaches Vbi (the injected carriers are no longer negligible). Use the diode current (Iₛ) for the forward branch.",
    };
  const minN = MIN_DOPING_OVER_NI * p.ni;
  if (p.na < minN || p.nd < minN)
    return {
      ok: false,
      error: `Both dopings must exceed ${MIN_DOPING_OVER_NI}·nᵢ = ${sci(minN)} cm⁻³: at a doping comparable to nᵢ the side is nearly intrinsic and the depletion approximation (all charge from ionised dopants) does not hold.`,
    };
  if (p.nc !== null && p.nd > degeneracyLimit(p.nc))
    return {
      ok: false,
      error: `N_D = ${sci(p.nd)} cm⁻³ is degenerate: above Nc·e⁻³ = ${sci(degeneracyLimit(p.nc))} cm⁻³ the Fermi level is within 3kT of the conduction band, so Boltzmann statistics (and the ln(N_A N_D/nᵢ²) form of Vbi) no longer hold.`,
    };
  if (p.nv !== null && p.na > degeneracyLimit(p.nv))
    return {
      ok: false,
      error: `N_A = ${sci(p.na)} cm⁻³ is degenerate: above Nv·e⁻³ = ${sci(degeneracyLimit(p.nv))} cm⁻³ the Fermi level is within 3kT of the valence band, so Boltzmann statistics (and the ln(N_A N_D/nᵢ²) form of Vbi) no longer hold.`,
    };
  const vt = thermalVoltage(p.tK);
  // ln(NA) + ln(ND) − 2 ln(ni): no product that could overflow.
  const vbi = vt * (Math.log(p.na) + Math.log(p.nd) - 2 * Math.log(p.ni));
  const eps = p.epsR * EPS0;
  const w = depletionWidth(p.na, p.nd, p.epsR, vbi + p.vr);
  const xn = (w * p.na) / (p.na + p.nd);
  const xp = (w * p.nd) / (p.na + p.nd);
  const emax = (E_CHARGE * p.nd * 1e6 * xn) / eps;
  const cj = eps / w;
  const cj0 = eps / depletionWidth(p.na, p.nd, p.epsR, vbi);
  const ratio = Math.max(p.na, p.nd) / Math.min(p.na, p.nd);
  const light = Math.min(p.na, p.nd);
  const w1 = ratio >= 10 ? Math.sqrt((2 * eps * (vbi + p.vr)) / (E_CHARGE * light * 1e6)) : null;
  const lightSide = ratio >= 10 ? (p.na < p.nd ? "p" : "n") : null;
  if (!fin(vbi, w, cj, emax)) return { ok: false, error: "The inputs give a non-finite result (check the magnitudes)." };
  return { ok: true, vt, vbi, w, xn, xp, emax, cj, cj0, w1, lightSide, degeneracyChecked: p.nc !== null && p.nv !== null };
}

/** Junction capacitance per area (F/m²) at reverse bias vr for a computed junction. */
export function cjAt(p: Pick<PnInput, "na" | "nd" | "epsR">, vbi: number, vr: number): number {
  return (p.epsR * EPS0) / depletionWidth(p.na, p.nd, p.epsR, vbi + vr);
}

export interface DiodeResult {
  vt: number;
  current: number;
  /** n·Vₜ·ln 10: forward volts per decade of current, V. */
  perDecade: number;
}

/** Shockley ideal diode I = Iₛ(exp(V/(nVₜ)) − 1). No series resistance, no high injection, no breakdown. */
export function shockley(is: number, n: number, v: number, tK: number): Result<DiodeResult> {
  if (!fin(is, n, v, tK)) return { ok: false, error: "Every input must be a finite number." };
  if (is <= 0) return { ok: false, error: "The saturation current Iₛ must be positive." };
  if (n < 1 || n > 10) return { ok: false, error: "The ideality factor n must lie between 1 and 10 (1 for diffusion current, about 2 for recombination)." };
  if (tK < T_MIN || tK > T_MAX) return { ok: false, error: `Temperature must lie between ${T_MIN} K and ${T_MAX} K.` };
  const vt = thermalVoltage(tK);
  const x = v / (n * vt);
  if (x > MAX_EXPONENT)
    return { ok: false, error: `V/(nVₜ) = ${Math.round(x)} is beyond the range evaluated (${MAX_EXPONENT}); an ideal diode at this bias carries an unphysical current — a real one is limited by its series resistance, which this model does not include.` };
  const current = is * Math.expm1(x);
  if (!Number.isFinite(current)) return { ok: false, error: "The diode current overflows at this bias." };
  return { ok: true, vt, current, perDecade: n * vt * Math.LN10 };
}

// ---------------------------------------------------------------------------------------------------------------
// MOSFET square law
// ---------------------------------------------------------------------------------------------------------------

export interface MosInput {
  /** Channel mobility, cm²/(V·s). */
  mu: number;
  /** Oxide thickness, m. */
  tox: number;
  /** Oxide relative permittivity (the user's value). */
  epsOx: number;
  /** W/L. */
  wl: number;
  vth: number;
  vgs: number;
  vds: number;
  /** Channel-length modulation, 1/V. */
  lambda: number;
}

export type MosRegion = "cutoff" | "triode" | "saturation";

export interface MosResult {
  /** F/m². */
  cox: number;
  /** µCox·W/L, A/V². */
  beta: number;
  vov: number;
  region: MosRegion;
  id: number;
  gm: number;
  /** Output conductance ∂I_D/∂V_DS, S. */
  gds: number;
  /** Saturation voltage V_DS,sat = V_ov (0 in cutoff). */
  vdsat: number;
}

/** Largest W/L, |V| and λ accepted (a guard against a mistyped exponent, not a physical limit). */
export const MOS_MAX_WL = 1e6;
export const MOS_MAX_V = 1e3;

/** SPICE level-1 drain current (A) at one bias point; the shared formula for the result and the figure. */
export function mosId(beta: number, vov: number, vds: number, lambda: number): number {
  if (vov <= 0) return 0;
  const clm = 1 + lambda * vds;
  return vds >= vov ? 0.5 * beta * vov * vov * clm : beta * (vov * vds - 0.5 * vds * vds) * clm;
}

/**
 * Long-channel square law, SPICE level-1 form (both regions carry (1 + λV_DS), so I_D is continuous at V_DS = V_ov):
 *   saturation (V_DS ≥ V_ov): I_D = ½µC_ox(W/L)V_ov²(1 + λV_DS)
 *   triode (V_DS < V_ov):     I_D = µC_ox(W/L)(V_ov V_DS − ½V_DS²)(1 + λV_DS)
 * gm and g_ds are the exact partial derivatives of that I_D. nMOS sign convention; a pMOS is entered by magnitudes.
 * No subthreshold conduction, velocity saturation, mobility degradation or body effect.
 */
export function mosfet(m: MosInput): Result<MosResult> {
  if (!fin(m.mu, m.tox, m.epsOx, m.wl, m.vth, m.vgs, m.vds, m.lambda)) return { ok: false, error: "Every input must be a finite number." };
  if (m.mu <= 0) return { ok: false, error: "The mobility µ must be positive." };
  if (m.tox <= 0) return { ok: false, error: "The oxide thickness must be positive." };
  if (m.epsOx < 1) return { ok: false, error: "The oxide relative permittivity must be at least 1." };
  if (m.wl <= 0 || m.wl > MOS_MAX_WL) return { ok: false, error: `W/L must be positive and at most ${sci(MOS_MAX_WL)}.` };
  if ([m.vth, m.vgs, m.vds].some((v) => Math.abs(v) > MOS_MAX_V)) return { ok: false, error: `Voltages above ${MOS_MAX_V} V are refused (check for a mistyped exponent).` };
  if (m.vds < 0)
    return { ok: false, error: "V_DS must be zero or positive (nMOS convention). For a pMOS enter the magnitudes |V_GS|, |V_DS|, |V_th|; for V_DS < 0 on an nMOS the source and drain swap roles." };
  if (m.lambda < 0 || m.lambda > 1) return { ok: false, error: "λ must lie between 0 and 1 V⁻¹ (typical values are 0.01–0.2 V⁻¹)." };
  const cox = (m.epsOx * EPS0) / m.tox;
  const beta = m.mu * 1e-4 * cox * m.wl;
  const vov = m.vgs - m.vth;
  if (vov <= 0) return { ok: true, cox, beta, vov, region: "cutoff", id: 0, gm: 0, gds: 0, vdsat: 0 };
  const clm = 1 + m.lambda * m.vds;
  const sat = m.vds >= vov;
  const id = mosId(beta, vov, m.vds, m.lambda);
  const gm = sat ? beta * vov * clm : beta * m.vds * clm;
  const gds = sat ? 0.5 * beta * vov * vov * m.lambda : beta * (vov - m.vds) * clm + m.lambda * beta * (vov * m.vds - 0.5 * m.vds * m.vds);
  if (!fin(cox, beta, id, gm, gds)) return { ok: false, error: "The inputs give a non-finite result (check the magnitudes)." };
  return { ok: true, cox, beta, vov, region: sat ? "saturation" : "triode", id, gm, gds, vdsat: vov };
}

// ---------------------------------------------------------------------------------------------------------------
// Carrier statistics
// ---------------------------------------------------------------------------------------------------------------

export interface CarrierInput {
  nd: number;
  na: number;
  ni: number;
  tK: number;
  /** Electron and hole mobilities, cm²/(V·s) (user inputs). */
  mun: number;
  mup: number;
  nc: number | null;
  nv: number | null;
}

export interface CarrierResult {
  vt: number;
  /** Net doping N_D − N_A, cm⁻³. */
  net: number;
  n: number;
  p: number;
  type: "n" | "p" | "intrinsic";
  /** E_F − Eᵢ in eV (from nᵢ). */
  efEi: number;
  /** E_c − E_F (n-type) or E_F − E_v (p-type), eV, from Nc or Nv; null when not available or intrinsic. */
  edge: number | null;
  /** S/cm and Ω·cm. */
  sigma: number;
  rho: number;
  degeneracyChecked: boolean;
}

/** Majority density for net doping |N| (cm⁻³): |N|/2 + √(N²/4 + nᵢ²), written so a huge N does not overflow. */
export function majority(netAbs: number, ni: number): number {
  const h = netAbs / 2;
  return h + Math.hypot(h, ni);
}

/** E_F − Eᵢ (eV) for net doping N (signed, cm⁻³): kT·asinh(N/2nᵢ), which is kT·ln(n/nᵢ) for the exact n. */
export function fermiFromNet(net: number, ni: number, vt: number): number {
  return vt * Math.asinh(net / (2 * ni));
}

/**
 * Equilibrium carrier densities with COMPLETE IONISATION and Boltzmann statistics: charge neutrality n − p = N_D − N_A
 * with np = nᵢ², the majority from the quadratic and the minority as nᵢ²/majority (the subtraction form cancels to 0).
 * E_F − Eᵢ = kT ln(n/nᵢ); σ = q(nµₙ + pµₚ).
 */
export function carriers(c: CarrierInput): Result<CarrierResult> {
  if (!fin(c.nd, c.na, c.ni, c.tK, c.mun, c.mup)) return { ok: false, error: "Every input must be a finite number." };
  if (c.nd < 0 || c.na < 0) return { ok: false, error: "Dopant densities cannot be negative (enter 0 for none)." };
  if (c.ni <= 0) return { ok: false, error: "nᵢ must be positive." };
  if (c.mun <= 0 || c.mup <= 0) return { ok: false, error: "Both mobilities must be positive." };
  if (c.tK < T_MIN || c.tK > T_MAX) return { ok: false, error: `Temperature must lie between ${T_MIN} K and ${T_MAX} K.` };
  const net = c.nd - c.na;
  const maj = majority(Math.abs(net), c.ni);
  const min = (c.ni / maj) * c.ni;
  const n = net >= 0 ? maj : min;
  const p = net >= 0 ? min : maj;
  if (c.nc !== null && n > degeneracyLimit(c.nc))
    return {
      ok: false,
      error: `n = ${sci(n)} cm⁻³ is degenerate: above Nc·e⁻³ = ${sci(degeneracyLimit(c.nc))} cm⁻³ the Fermi level is within 3kT of the conduction band, so Boltzmann statistics and complete ionisation no longer hold.`,
    };
  if (c.nv !== null && p > degeneracyLimit(c.nv))
    return {
      ok: false,
      error: `p = ${sci(p)} cm⁻³ is degenerate: above Nv·e⁻³ = ${sci(degeneracyLimit(c.nv))} cm⁻³ the Fermi level is within 3kT of the valence band, so Boltzmann statistics and complete ionisation no longer hold.`,
    };
  const vt = thermalVoltage(c.tK);
  const efEi = fermiFromNet(net, c.ni, vt);
  const type = net > 0 ? "n" : net < 0 ? "p" : "intrinsic";
  const edge = type === "n" && c.nc !== null ? vt * Math.log(c.nc / n) : type === "p" && c.nv !== null ? vt * Math.log(c.nv / p) : null;
  const sigma = E_CHARGE * (n * c.mun + p * c.mup);
  if (!fin(n, p, efEi, sigma) || sigma <= 0) return { ok: false, error: "The inputs give a non-finite result (check the magnitudes)." };
  return { ok: true, vt, net, n, p, type, efEi, edge, sigma, rho: 1 / sigma, degeneracyChecked: c.nc !== null && c.nv !== null };
}
