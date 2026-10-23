// Liquid-crystal retarders: birefringent / LC wave-plate spectra and design (normal incidence), and the
// Fréedericksz transition with the voltage-dependent director profile and retardance of a planar nematic cell.
//
// PHYSICS AND SOURCES (textbook, stated once):
//   - Effective extraordinary index for a director tilted by θ FROM THE SUBSTRATE PLANE, light at normal incidence
//     (the index ellipsoid; Yariv & Yeh, Optical Waves in Crystals, ch. 4; Yang & Wu, Fundamentals of Liquid
//     Crystal Devices, 2nd ed., ch. 1):  n_eff(θ) = n_e n_o / √(n_e² sin²θ + n_o² cos²θ),  Δn_eff = n_eff − n_o.
//     θ = 0 gives the full Δn = n_e − n_o; θ = 90° gives 0. This is the same expression as Eq. 1 of Abuleil &
//     Abdulhalim, Opt. Lett. 39, 5487 (2014), doi:10.1364/OL.39.005487, with n∥ = n_e, n⊥ = n_o and ϑ measured from
//     the substrate plane.
//   - Retardance of a uniform cell: Γ(λ) = 2π Δn_eff(λ) d / λ.
//   - Dispersion: the three-coefficient Cauchy model n(λ) = A + B/λ² + C/λ⁴, λ in µm, for n_e and n_o separately
//     (J. Li and S.-T. Wu, "Extended Cauchy equations for the refractive indices of liquid crystals",
//     J. Appl. Phys. 95, 896 (2004)). B = C = 0 is a constant index.
//   - Polarisation: every transmission goes through jones.ts (elementMatrix / propagate), the engine of the
//     "optics-jones" calculator, so the two tools cannot disagree. A cell whose optic axis is at α is a linear
//     retarder whose SLOW axis is at α for Δn > 0, i.e. jones.ts "retarder" with fast axis α + 90° and δ = Γ.
//   - Fréedericksz transition (splay, planar cell, positive Δε): V_th = π √(K11 / (ε₀ Δε)) (Yang & Wu ch. 5;
//     de Gennes & Prost, The Physics of Liquid Crystals, §3.2). The director profile at a constant applied voltage
//     is solved through the first integral of the splay–bend Euler–Lagrange equation with the non-uniform field
//     (D uniform, V = ∫ E dz): H. J. Deuling, "Deformation of nematic liquid crystals in an electric field",
//     Mol. Cryst. Liq. Cryst. 19, 123 (1972); also Welford & Sambles, Mol. Cryst. Liq. Cryst. 147, 25 (1987).
//
// Bounded everywhere: every loop has a hard cap and non-finite inputs are refused by the callers (lcCalcs.ts).

import { propagate, linearState, type JonesElement } from "./jones";

export const EPS0 = 8.8541878128e-12; // F/m (CODATA 2018)

// ------------------------------------------------------------------ materials

export interface Cauchy {
  A: number;
  /** µm² */
  B: number;
  /** µm⁴ */
  C: number;
}
export interface Material {
  name: string;
  ne: Cauchy;
  no: Cauchy;
  /** A citation, for a built-in material. */
  source?: string;
  /** The wavelength range (nm) the coefficients were fitted over, when known. */
  fitRangeNm?: [number, number];
}

/**
 * Built-in materials, each from a PUBLISHED coefficient table (both fetched 2026-10-22).
 *
 * E7 and BL036 (Merck): M. Wahle and H.-S. Kitzerow, "Liquid crystal assisted optical fibres", Opt. Express 22(1),
 * 262–273 (2014), doi:10.1364/OE.22.000262, Appendix A, Table 2 — Jelly-refractometer measurements over 450–750 nm
 * fitted to n = n⁰ + A/λ² + B/λ⁴ (λ in µm):
 *            n_o⁰   A_o (µm²)  B_o      n_e⁰   A_e (µm²)  B_e
 *   E7      1.499   0.0072     3.01    1.693   0.0078     28.00
 *   BL036   1.513   0.0042     3.67    1.733   0.0137     25.04
 * The table heads the B columns "(10⁴ µm²)"; B multiplies λ⁻⁴, so its unit must be µm⁴, and only the factor 10⁻⁴
 * gives indices of the measured size (E7 nₑ ≈ 1.74 at 589 nm; BL036 Δn ≈ 0.265, the mixture's nominal value), so the
 * B values are read as ×10⁻⁴ µm⁴. Measurement temperature is not stated in the table.
 *
 * E7-Li: G. Capobianco and S. Fineschi, "Achromatic Liquid Crystals Variable Retarders Preliminary Study Report",
 * INAF Osservatorio Astrofisico di Torino Technical Report no. 124 (28 Oct 2009), §2.1,
 * https://www.oato.inaf.it/biblioteca/pdf/TechRep124_Capobianco.pdf — a three-coefficient Cauchy fit to the E7
 * data of J. Li et al., IEEE/OSA J. Display Technol. 1(1), 51 (2005), at 23 °C, over about 450–650 nm. The report
 * prints B in nm² and C in nm⁴ (Ae = 1.6985, Be = 8956.69, Ce = 2.69175×10⁹; Ao = 1.49949, Bo = 6830.58,
 * Co = 4.05656×10⁸); converted here to µm.
 */
const WAHLE = "Wahle & Kitzerow, Opt. Express 22, 262 (2014), Table 2 (Cauchy fit to refractometer data, 450–750 nm)";
export const E7: Material = {
  name: "E7",
  ne: { A: 1.693, B: 0.0078, C: 28.0e-4 },
  no: { A: 1.499, B: 0.0072, C: 3.01e-4 },
  source: `E7 (Merck): ${WAHLE}`,
  fitRangeNm: [450, 750],
};
export const BL036: Material = {
  name: "BL036",
  ne: { A: 1.733, B: 0.0137, C: 25.04e-4 },
  no: { A: 1.513, B: 0.0042, C: 3.67e-4 },
  source: `BL036 (Merck): ${WAHLE}`,
  fitRangeNm: [450, 750],
};
export const E7_LI: Material = {
  name: "E7-Li",
  ne: { A: 1.6985, B: 8956.69e-6, C: 2.69175e9 * 1e-12 },
  no: { A: 1.49949, B: 6830.58e-6, C: 4.05656e8 * 1e-12 },
  source:
    "E7 (Merck): Cauchy fit of Capobianco & Fineschi, INAF-OATo Tech. Rep. 124 (2009), to the data of Li et al., J. Display Technol. 1, 51 (2005), 23 °C",
  fitRangeNm: [450, 650],
};
export const BUILTIN_MATERIALS: Material[] = [E7, BL036, E7_LI];

/** n(λ) by the Cauchy model, λ in nm. */
export function cauchyN(c: Cauchy, lamNm: number): number {
  const l2 = (lamNm / 1000) ** 2;
  return c.A + c.B / l2 + c.C / (l2 * l2);
}

/** n_eff for a director tilted θ (degrees) from the substrate plane, normal incidence. */
export function nEff(ne: number, no: number, thetaDeg: number): number {
  const t = (thetaDeg * Math.PI) / 180;
  const s = Math.sin(t);
  const c = Math.cos(t);
  return (ne * no) / Math.sqrt(ne * ne * s * s + no * no * c * c);
}
export function dnEff(ne: number, no: number, thetaDeg: number): number {
  return nEff(ne, no, thetaDeg) - no;
}

/**
 * The uniform tilt (degrees) whose Δn_eff equals `dn` (closed form from the index ellipsoid), or null when dn is
 * outside [0, n_e − n_o] (for n_e > n_o) or the material is not birefringent.
 */
export function tiltForDn(ne: number, no: number, dn: number): number | null {
  if (ne === no) return null;
  const n = no + dn;
  if (!(n > 0)) return null;
  const s2 = ((ne * ne * no * no) / (n * n) - no * no) / (ne * ne - no * no);
  if (s2 < -1e-12 || s2 > 1 + 1e-12) return null;
  return (Math.asin(Math.sqrt(Math.min(1, Math.max(0, s2)))) * 180) / Math.PI;
}

// ------------------------------------------------------------------ stack

export interface Cell {
  /** µm */
  d: number;
  /** tilt from the substrate plane, degrees, 0–90 */
  tilt: number;
  /** optic-axis orientation in the x–y plane, degrees from x toward y */
  oa: number;
  material: Material;
}

export function cellRetardance(cell: Cell, lamNm: number): number {
  const ne = cauchyN(cell.material.ne, lamNm);
  const no = cauchyN(cell.material.no, lamNm);
  return (2 * Math.PI * dnEff(ne, no, cell.tilt) * cell.d) / (lamNm / 1000);
}

/** The jones.ts elements of the cells at λ: slow axis = optic axis, so fast axis = OA + 90°, δ = Γ. */
export function cellElements(cells: Cell[], lamNm: number): JonesElement[] {
  return cells.map((c) => ({ kind: "retarder", angleDeg: c.oa + 90, deltaDeg: (cellRetardance(c, lamNm) * 180) / Math.PI }));
}

/** Transmission after the input polariser, through the cells, through an analyser at `anaDeg` (jones.ts). */
export function transmission(polDeg: number, cells: Cell[], anaDeg: number, lamNm: number): number {
  const r = propagate(linearState(polDeg), [...cellElements(cells, lamNm), { kind: "polariser", angleDeg: anaDeg }]);
  return r ? r.transmitted : NaN;
}

/**
 * Signs that make net retardance meaningful: +1 for a cell whose optic axis is parallel to cell 1's, −1 for one at
 * 90° to it; null when any axis is at another angle (the stack is then an elliptical retarder in general and a
 * scalar "net retardance" is not defined).
 */
export function collinearSigns(cells: Cell[]): number[] | null {
  if (!cells.length) return null;
  const ref = cells[0].oa;
  const out: number[] = [];
  for (const c of cells) {
    const d = (((c.oa - ref) % 180) + 180) % 180; // [0, 180)
    if (Math.abs(d) < 1e-9 || Math.abs(d - 180) < 1e-9) out.push(1);
    else if (Math.abs(d - 90) < 1e-9) out.push(-1);
    else return null;
  }
  return out;
}

export function netRetardance(cells: Cell[], signs: number[], lamNm: number): number {
  let s = 0;
  for (let i = 0; i < cells.length; i++) s += signs[i] * cellRetardance(cells[i], lamNm);
  return s;
}

export type Target = "qwp" | "hwp";
/** The target |net| of order m: π/2 + mπ (quarter wave) or (2m + 1)π (half wave). */
export function targetOf(t: Target, m: number): number {
  return t === "qwp" ? Math.PI / 2 + m * Math.PI : (2 * m + 1) * Math.PI;
}
/** The order m whose target is nearest |net| (m ≥ 0). */
export function orderOf(t: Target, net: number): number {
  const a = Math.abs(net);
  return t === "qwp" ? Math.max(0, Math.round((a - Math.PI / 2) / Math.PI)) : Math.max(0, Math.round((a - Math.PI) / (2 * Math.PI)));
}
/** Crossed-polariser transmission of a perfect quarter- / half-wave device between a polariser and its ±45° cells. */
export const targetT = (t: Target): number => (t === "qwp" ? 0.5 : 1);

// ------------------------------------------------------------------ bands

export interface Band {
  /** nm */
  from: number;
  to: number;
  /** largest deviation inside the band (the tolerance at an interpolated edge) */
  worst: number;
  /** true when the band runs into the end of the computed range (the true edge may lie beyond it) */
  openLow: boolean;
  openHigh: boolean;
}

/**
 * Contiguous ranges of x where dev ≤ tol, edges linearly interpolated between samples. Pure: (x ascending, dev).
 * At most `cap` bands are returned (the rest are counted by the caller from `total`).
 */
export function findBands(x: number[], dev: number[], tol: number, cap = 200): { bands: Band[]; total: number } {
  const bands: Band[] = [];
  let total = 0;
  const n = Math.min(x.length, dev.length);
  let i = 0;
  while (i < n) {
    if (!(dev[i] <= tol)) {
      i++;
      continue;
    }
    const start = i;
    let worst = dev[i];
    while (i + 1 < n && dev[i + 1] <= tol) {
      i++;
      if (dev[i] > worst) worst = dev[i];
    }
    const end = i;
    const edge = (a: number, b: number): number => {
      // x where dev crosses tol between samples a (inside) and b (outside)
      const da = dev[a];
      const db = dev[b];
      if (!Number.isFinite(db) || db === da) return x[a];
      const t = (tol - da) / (db - da);
      return x[a] + Math.max(0, Math.min(1, t)) * (x[b] - x[a]);
    };
    const from = start > 0 ? edge(start, start - 1) : x[start];
    const to = end < n - 1 ? edge(end, end + 1) : x[end];
    total++;
    // `worst` is the largest SAMPLED deviation inside the band; at a closed (interpolated) edge the deviation reaches
    // the tolerance itself, which the caller states.
    if (bands.length < cap) bands.push({ from, to, worst, openLow: start === 0, openHigh: end === n - 1 });
    i = end + 1;
  }
  return { bands, total };
}

// ------------------------------------------------------------------ spectrum

export interface SpectrumInput {
  cells: Cell[];
  polDeg: number;
  /** analyser angle for the "chosen analyser" curve */
  anaDeg: number;
  lam0: number;
  lam1: number;
  points: number;
}
export interface Spectrum {
  lam: number[];
  Tc: number[];
  Tp: number[];
  Ta: number[];
  /** per cell, rad */
  gammas: number[][];
  /** signed net retardance (rad), or null when the axes are not collinear */
  net: number[] | null;
  signs: number[] | null;
}

export function spectrum(inp: SpectrumInput): Spectrum {
  const n = Math.max(2, Math.min(2000, Math.round(inp.points)));
  const lam: number[] = [];
  const Tc: number[] = [];
  const Tp: number[] = [];
  const Ta: number[] = [];
  const gammas: number[][] = inp.cells.map(() => []);
  const signs = collinearSigns(inp.cells);
  const net: number[] | null = signs ? [] : null;
  for (let i = 0; i < n; i++) {
    const l = inp.lam0 + ((inp.lam1 - inp.lam0) * i) / (n - 1);
    lam.push(l);
    const els = cellElements(inp.cells, l);
    const run = (a: number): number => {
      const r = propagate(linearState(inp.polDeg), [...els, { kind: "polariser", angleDeg: a }]);
      return r ? r.transmitted : NaN;
    };
    Tc.push(run(inp.polDeg + 90));
    Tp.push(run(inp.polDeg));
    Ta.push(run(inp.anaDeg));
    inp.cells.forEach((c, k) => gammas[k].push(cellRetardance(c, l)));
    if (net && signs) net.push(gammas.reduce((s, g, k) => s + signs[k] * g[i], 0));
  }
  return { lam, Tc, Tp, Ta, gammas, net, signs };
}

// ------------------------------------------------------------------ design

export interface DesignRoot {
  tilt: number;
  /** the signed net retardance hit, rad */
  net: number;
  order: number;
}

/**
 * Tilts θ ∈ [0°, 90°] of cell `k` (0-based) that make |net(λ₀)| a quarter- or half-wave target of some order.
 * Δn_eff is monotone in θ, so net(θ) is monotone and each signed target value has at most one root; every target
 * value between net(90°) and net(0°) is bracketed and bisected (60 steps, 10⁻¹³° at most). Requires collinear axes.
 */
export function designTilt(cells: Cell[], k: number, lam0: number, target: Target, maxRoots = 50): { roots: DesignRoot[]; more: boolean } | null {
  const signs = collinearSigns(cells);
  if (!signs || k < 0 || k >= cells.length) return null;
  const at = (th: number): number => netRetardance(cells.map((c, i) => (i === k ? { ...c, tilt: th } : c)), signs, lam0);
  const a = at(0);
  const b = at(90);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const vals: number[] = [];
  for (let m = 0; m < 100000 && vals.length <= maxRoots; m++) {
    const t = targetOf(target, m);
    if (t > Math.max(Math.abs(lo), Math.abs(hi)) + 1) break;
    for (const v of [t, -t]) if (v >= lo && v <= hi) vals.push(v);
  }
  const more = vals.length > maxRoots;
  const roots: DesignRoot[] = [];
  for (const v of vals.slice(0, maxRoots)) {
    let x0 = 0;
    let x1 = 90;
    let f0 = a - v;
    if (f0 === 0) {
      roots.push({ tilt: 0, net: v, order: orderOf(target, v) });
      continue;
    }
    for (let it = 0; it < 80; it++) {
      const xm = 0.5 * (x0 + x1);
      const fm = at(xm) - v;
      if (fm === 0) {
        x0 = x1 = xm;
        break;
      }
      if (Math.sign(fm) === Math.sign(f0)) {
        x0 = xm;
        f0 = fm;
      } else x1 = xm;
      if (x1 - x0 < 1e-13) break;
    }
    roots.push({ tilt: 0.5 * (x0 + x1), net: v, order: orderOf(target, v) });
  }
  roots.sort((p, q) => p.tilt - q.tilt);
  return { roots, more };
}

// ------------------------------------------------------------------ Fréedericksz / director profile

export interface LcElastic {
  /** N */
  K11: number;
  K33: number;
  epsPar: number;
  epsPerp: number;
  /** m */
  d: number;
  /** pretilt, rad */
  theta0: number;
}

/** V_th = π √(K11 / (ε₀ Δε)), volts (zero pretilt, strong anchoring). */
export function thresholdVoltage(K11: number, dEps: number): number {
  return Math.PI * Math.sqrt(K11 / (EPS0 * dEps));
}

// Gauss–Legendre nodes on [−1, 1] by Newton on P_n (bounded: 100 steps per node).
function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
}
const GL12 = gaussLegendre(12);
const GL24 = gaussLegendre(24);
/** Panel breakpoints in s ∈ [0, 1], graded geometrically toward s = 0 (where the integrand can peak sharply). */
function panels(depth: number): number[] {
  const b: number[] = [0];
  for (let k = depth; k >= 1; k--) b.push(Math.pow(2, -k));
  b.push(1);
  return b;
}
const P_COARSE = panels(18);
const P_FINE = panels(30);

interface Js {
  J0: number;
  J1: number;
  /** ∫ g·w(θ) dθ for the caller's weight (the retardance integrand), when given */
  J2: number;
}

/**
 * The three first-integral quadratures over the half cell, θ from θ₀ to θ_m, with the substitution
 * θ = θ_m − (θ_m − θ₀) s² (removes the inverse-square-root singularity at the midplane):
 *   g(θ) = √(k(θ) / (1/ε(θ) − 1/ε(θ_m))),  k = K11 cos²θ + K33 sin²θ,  ε = ε⊥ + Δε sin²θ,
 *   J0 = ∫ g dθ,  J1 = ∫ g/ε dθ,  J2 = ∫ g·wt(θ) dθ.
 * Then d/2 = (√ε₀/D)·J0, V = (2/√ε₀)·J1, and Γ = (2π d/λ)·J2/J0 with wt = Δn_eff(θ).
 */
function quad(p: LcElastic, thm: number, wt: ((th: number) => number) | null, fine: boolean): Js {
  const { K11, K33, epsPar, epsPerp, theta0 } = p;
  const dEps = epsPar - epsPerp;
  const D = thm - theta0;
  const sm = Math.sin(thm);
  const cm = Math.cos(thm);
  const epsM = epsPerp + dEps * sm * sm;
  const gl = fine ? GL24 : GL12;
  const br = fine ? P_FINE : P_COARSE;
  let J0 = 0;
  let J1 = 0;
  let J2 = 0;
  for (let k = 0; k + 1 < br.length; k++) {
    const a = br[k];
    const b = br[k + 1];
    const h = 0.5 * (b - a);
    const c = 0.5 * (a + b);
    for (let i = 0; i < gl.x.length; i++) {
      const s = c + h * gl.x[i];
      const th = thm - D * s * s;
      const st = Math.sin(th);
      const ct = Math.cos(th);
      const kk = K11 * ct * ct + K33 * st * st;
      const eps = epsPerp + dEps * st * st;
      // 1/ε − 1/ε_m = Δε sin(θ_m − θ) sin(θ_m + θ) / (ε ε_m), without cancellation
      const diff = (dEps * Math.sin(D * s * s) * (sm * ct + cm * st)) / (eps * epsM);
      // g dθ = √(k/diff) · 2 D s ds; written as 2 D s / √diff so s → 0 stays finite
      const gds = (2 * D * s * Math.sqrt(kk)) / Math.sqrt(diff);
      const wq = h * gl.w[i] * gds;
      J0 += wq;
      J1 += wq / eps;
      if (wt) J2 += wq * wt(th);
    }
  }
  return { J0, J1, J2 };
}

/** V(θ_m) in volts (independent of d). */
export function voltageOfMid(p: LcElastic, thm: number, fine = false): number {
  return (2 / Math.sqrt(EPS0)) * quad(p, thm, null, fine).J1;
}

export interface ProfileResult {
  ok: true;
  /** midplane tilt, rad */
  thetaM: number;
  /** true when θ ≡ θ₀ (zero pretilt at or below threshold) */
  uniform: boolean;
  /** retardance at λ, rad */
  gamma: number;
  /** ⟨Δn_eff⟩ = Γλ/(2πd) */
  dnMean: number;
}
export type ProfileOutcome = ProfileResult | { ok: false; reason: string };

export interface Optics {
  ne: number;
  no: number;
  /** nm */
  lam: number;
}

const HALF_PI = Math.PI / 2;
/** The largest midplane tilt the solver resolves (10⁻¹⁰ rad short of 90°, about 19 V_th for common materials): beyond it the quadrature is not reliable. */
export const THETA_M_MAX = HALF_PI - 1e-10;

function dnWeight(o: Optics): (th: number) => number {
  return (th: number) => dnEff(o.ne, o.no, (th * 180) / Math.PI);
}

function gammaAt(p: LcElastic, o: Optics, thm: number, fine = false): { gamma: number; dnMean: number; J: Js } {
  const J = quad(p, thm, dnWeight(o), fine);
  const dnMean = J.J2 / J.J0;
  return { gamma: (2 * Math.PI * p.d * dnMean) / (o.lam * 1e-9), dnMean, J };
}

/** Converged-or-refused: the coarse and fine quadratures must agree. */
function checked(p: LcElastic, o: Optics, thm: number): ProfileOutcome {
  const a = gammaAt(p, o, thm, false);
  const b = gammaAt(p, o, thm, true);
  const va = (2 / Math.sqrt(EPS0)) * a.J.J1;
  const vb = (2 / Math.sqrt(EPS0)) * b.J.J1;
  const rel = (x: number, y: number): number => Math.abs(x - y) / Math.max(Math.abs(y), 1e-300);
  if (!(rel(va, vb) < 1e-7) || !(Math.abs(b.dnMean - a.dnMean) < 1e-9 + 1e-7 * Math.abs(b.dnMean)) || !Number.isFinite(b.gamma))
    return { ok: false, reason: "The director-profile quadrature did not converge at this voltage (the midplane is too close to 90°)." };
  return { ok: true, thetaM: thm, uniform: false, gamma: b.gamma, dnMean: b.dnMean };
}

/** Uniform tilt θ₀ everywhere (zero-pretilt cell at or below threshold). */
function uniformProfile(p: LcElastic, o: Optics): ProfileResult {
  const dn = dnEff(o.ne, o.no, (p.theta0 * 180) / Math.PI);
  return { ok: true, thetaM: p.theta0, uniform: true, gamma: (2 * Math.PI * p.d * dn) / (o.lam * 1e-9), dnMean: dn };
}

/**
 * The midplane tilt for an applied rms voltage V: V(θ_m) is monotone, so θ_m is bracketed in (θ₀, THETA_M_MAX] and
 * found by Brent's method (inverse quadratic interpolation with a bisection safeguard; ≤ 100 steps). Zero pretilt
 * below V_th gives the undeformed cell. A sweep passes `hint`: the previous (lower) solution as the lower bracket,
 * and V(THETA_M_MAX), so neither is recomputed.
 */
export function solveMid(
  p: LcElastic,
  V: number,
  hint: { lo?: number; vAtLo?: number; vMax?: number } = {},
): { ok: true; thetaM: number; uniform: boolean } | { ok: false; reason: string } {
  const dEps = p.epsPar - p.epsPerp;
  const vth = thresholdVoltage(p.K11, dEps);
  if (V <= 0) return { ok: true, thetaM: p.theta0, uniform: true };
  if (p.theta0 === 0 && V <= vth) return { ok: true, thetaM: 0, uniform: true };
  const floor = p.theta0 === 0 ? 1e-9 : p.theta0 + 1e-12 * Math.max(1, p.theta0);
  let a = hint.lo !== undefined && hint.lo > floor && hint.vAtLo !== undefined && hint.vAtLo < V ? hint.lo : floor;
  let b = THETA_M_MAX;
  let fa = (a === hint.lo ? (hint.vAtLo as number) : voltageOfMid(p, a)) - V;
  let fb = (hint.vMax ?? voltageOfMid(p, b)) - V;
  if (fb < 0) return { ok: false, reason: "beyond" };
  if (fa >= 0) return { ok: true, thetaM: a, uniform: false };
  // Brent (after Numerical Recipes zbrent)
  let c = b;
  let fc = fb;
  let d = b - a;
  let e = d;
  for (let it = 0; it < 100; it++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2e-16 * Math.abs(b) + 5e-15;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol || fb === 0 || Math.abs(fb) < 1e-13 * V) break;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const sR = fb / fa;
      let pp: number;
      let q: number;
      if (a === c) {
        pp = 2 * xm * sR;
        q = 1 - sR;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        pp = sR * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (sR - 1);
      }
      if (pp > 0) q = -q;
      pp = Math.abs(pp);
      if (2 * pp < Math.min(3 * xm * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = pp / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : xm > 0 ? tol : -tol;
    fb = voltageOfMid(p, b) - V;
  }
  return { ok: true, thetaM: b, uniform: false };
}

/**
 * The profile summary (θ_m, Γ) at voltage V. `verify` runs the coarse/fine quadrature agreement check (refusing on
 * disagreement); a sweep verifies its largest voltage only, because the quadrature is hardest where θ_m is closest
 * to 90° and θ_m rises monotonically with V.
 */
export function profileAt(p: LcElastic, o: Optics, V: number, verify = true, hint: { lo?: number; vAtLo?: number; vMax?: number } = {}): ProfileOutcome {
  const m = solveMid(p, V, hint);
  if (!m.ok) return { ok: false, reason: m.reason };
  if (m.uniform) return uniformProfile(p, o);
  if (verify) return checked(p, o, m.thetaM);
  const g = gammaAt(p, o, m.thetaM);
  return { ok: true, thetaM: m.thetaM, uniform: false, gamma: g.gamma, dnMean: g.dnMean };
}

/**
 * θ(z) samples over the full cell at midplane tilt θ_m (symmetric about z = d/2): z in m, θ in rad, ascending z.
 * z(θ) = (d/2)·∫_{θ₀}^{θ} g / J0, accumulated panel by panel on a graded s grid.
 */
export function profileSamples(p: LcElastic, thm: number, uniform: boolean, nHalf = 60): { z: number[]; theta: number[] } {
  if (uniform || thm <= p.theta0) {
    const z: number[] = [];
    const theta: number[] = [];
    for (let i = 0; i <= 2 * nHalf; i++) {
      z.push((p.d * i) / (2 * nHalf));
      theta.push(p.theta0);
    }
    return { z, theta };
  }
  // s from 1 (θ₀, z = 0) down to 0 (θ_m, z = d/2)
  const sNodes: number[] = [];
  const nLin = Math.max(4, nHalf - 12);
  for (let i = 0; i <= nLin; i++) sNodes.push(1 - (0.9 * i) / nLin); // 1 … 0.1
  for (let k = 1; k <= 12; k++) sNodes.push(0.1 * Math.pow(0.5, k));
  sNodes.push(0);
  const { K11, K33, epsPar, epsPerp, theta0 } = p;
  const dEps = epsPar - epsPerp;
  const D = thm - theta0;
  const sm = Math.sin(thm);
  const epsM = epsPerp + dEps * sm * sm;
  const g = (s: number): number => {
    const th = thm - D * s * s;
    const st = Math.sin(th);
    const kk = K11 * Math.cos(th) ** 2 + K33 * st * st;
    const eps = epsPerp + dEps * st * st;
    const diff = (dEps * Math.sin(D * s * s) * Math.sin(thm + th)) / (eps * epsM);
    return (2 * D * s * Math.sqrt(kk)) / Math.sqrt(diff);
  };
  const cum: number[] = [0];
  for (let j = 1; j < sNodes.length; j++) {
    const a = sNodes[j];
    const b = sNodes[j - 1];
    const h = 0.5 * (b - a);
    const c = 0.5 * (a + b);
    let acc = 0;
    for (let i = 0; i < GL24.x.length; i++) acc += h * GL24.w[i] * g(c + h * GL24.x[i]);
    cum.push(cum[j - 1] + acc);
  }
  const J0 = cum[cum.length - 1];
  const zh = cum.map((v) => (p.d / 2) * (v / J0));
  const th = sNodes.map((s) => thm - D * s * s);
  const z: number[] = [...zh];
  const theta: number[] = [...th];
  for (let j = zh.length - 2; j >= 0; j--) {
    z.push(p.d - zh[j]);
    theta.push(th[j]);
  }
  return { z, theta };
}

/**
 * θ (rad) at z/d EXACTLY (for printed tables): z(θ)/d = ½·∫_{s(θ)}^{1} g ds / J0 is monotone in s, so s is bisected
 * (≤ 80 steps) with each partial integral done by the fine graded Gauss–Legendre rule on [s, 1]. Symmetric about 0.5.
 */
export function thetaAtZExact(p: LcElastic, thm: number, uniform: boolean, zFrac: number): number {
  if (uniform || thm <= p.theta0) return p.theta0;
  const zf = Math.min(zFrac, 1 - zFrac);
  if (zf <= 0) return p.theta0;
  const { K11, K33, epsPar, epsPerp, theta0 } = p;
  const dEps = epsPar - epsPerp;
  const D = thm - theta0;
  const sm = Math.sin(thm);
  const cm = Math.cos(thm);
  const epsM = epsPerp + dEps * sm * sm;
  const g = (s: number): number => {
    const th = thm - D * s * s;
    const st = Math.sin(th);
    const ct = Math.cos(th);
    const kk = K11 * ct * ct + K33 * st * st;
    const eps = epsPerp + dEps * st * st;
    const diff = (dEps * Math.sin(D * s * s) * (sm * ct + cm * st)) / (eps * epsM);
    return (2 * D * s * Math.sqrt(kk)) / Math.sqrt(diff);
  };
  const integ = (lo: number): number => {
    const br = [lo, ...P_FINE.filter((b) => b > lo && b < 1), 1];
    let acc = 0;
    for (let k = 0; k + 1 < br.length; k++) {
      const h = 0.5 * (br[k + 1] - br[k]);
      const c = 0.5 * (br[k + 1] + br[k]);
      for (let i = 0; i < GL24.x.length; i++) acc += h * GL24.w[i] * g(c + h * GL24.x[i]);
    }
    return acc;
  };
  const J0 = integ(0);
  // zfrac(s) = ½ I(s)/J0 decreases from ½ at s = 0 to 0 at s = 1
  let a = 0;
  let b = 1;
  for (let it = 0; it < 80 && b - a > 1e-15; it++) {
    const m = 0.5 * (a + b);
    if ((0.5 * integ(m)) / J0 > zf) a = m;
    else b = m;
  }
  const s = 0.5 * (a + b);
  return thm - D * s * s;
}

/** θ at z by linear interpolation in the samples (figures only; printed values use thetaAtZExact). */
export function thetaAtZ(samp: { z: number[]; theta: number[] }, z: number): number {
  const { z: zs, theta } = samp;
  if (z <= zs[0]) return theta[0];
  for (let i = 1; i < zs.length; i++) {
    if (z <= zs[i]) {
      const t = (z - zs[i - 1]) / Math.max(zs[i] - zs[i - 1], 1e-300);
      return theta[i - 1] + t * (theta[i] - theta[i - 1]);
    }
  }
  return theta[theta.length - 1];
}

/**
 * The uniform-profile midplane-tilt approximation (I. Abdulhalim and D. Menashe, Liq. Cryst. 37, 233 (2010), as used
 * by Abuleil & Abdulhalim, Opt. Lett. 39, 5487 (2014)):
 * θ_m ≈ θ₀ + (π/2 − θ₀)·√(1 − 1/V_r²), V_r = V/V_th, θ₀ below threshold. An approximation only.
 */
export function midApprox(theta0: number, vr: number): number {
  if (!(vr > 1)) return theta0;
  return theta0 + (HALF_PI - theta0) * Math.sqrt(1 - 1 / (vr * vr));
}

/**
 * The midplane tilt that gives retardance `target` (rad) at the optics `o`: Γ(θ_m) is monotone decreasing for
 * n_e > n_o, so it is bisected (≤ 200 steps). Null when the target is outside [Γ(THETA_M_MAX), Γ(θ₀)].
 */
export function midForGamma(p: LcElastic, o: Optics, target: number): number | null {
  const g = (thm: number): number => gammaAt(p, o, thm).gamma;
  const lo0 = p.theta0 === 0 ? 1e-9 : p.theta0 + 1e-12 * Math.max(1, p.theta0);
  const gA = uniformProfile(p, o).gamma;
  const gB = g(THETA_M_MAX);
  const top = Math.max(gA, gB);
  const bot = Math.min(gA, gB);
  if (!(target <= top && target >= bot)) return null;
  let a = lo0;
  let b = THETA_M_MAX;
  let fa = g(a) - target;
  for (let it = 0; it < 200 && b - a > 1e-14; it++) {
    const c = 0.5 * (a + b);
    const fc = g(c) - target;
    if (fc === 0) return c;
    if (Math.sign(fc) === Math.sign(fa)) {
      a = c;
      fa = fc;
    } else b = c;
  }
  return 0.5 * (a + b);
}
