// Combined loading of a straight member: axial force, bending moment, torque and transverse shear on a round
// (solid or hollow) section, and axial + bending + shear on a solid rectangle, with an optional beam-column moment
// amplification. SI throughout (N, N·m, m, Pa); pure. The stress-state arithmetic (principal stresses, maximum
// shear, von Mises, Tresca) is stress.ts analyzeStress — this module only builds the stress state at the two points
// that can govern:
//   A  the outer fibre where the axial and bending stresses ADD: σ = P/A ± Mc/I, τ = Tc/J (no transverse shear);
//   B  the neutral axis: σ = P/A, τ = Tc/J + τ_V, with τ_V the Jourawski mean shear VQ/(I·t) across the chord
//      (4V/3A for a solid circle, 3V/2A for a rectangle). Torsion and transverse shear add on one side of the
//      neutral axis; that side is the one reported.
//
// TORSION IS CIRCULAR-ONLY. τ = Tr/J is a theorem for a circular section (plane sections stay plane); any other
// section warps and needs a different (tabulated, aspect-ratio-dependent) solution, so a rectangle with a torque is
// refused by name, never approximated.
//
// BEAM-COLUMN: for a pinned-pinned length L under a COMPRESSIVE axial load, the bending moment is amplified by the
// standard approximation 1/(1 − P/P_cr), with P_cr = π²EI/L² the perfect-column (Euler) load about the bending axis.
// A compressive load at or above the smallest P_cr of the section (the weak axis of a rectangle) is refused: the
// perfect column has buckled. A TENSILE load straightens a beam-column, so no amplification is applied (the
// unamplified moment is the conservative value) and the result says so.

import { analyzeStress, type PrincipalResult } from "./stress";

export type Section = { kind: "circle"; d: number; di: number } | { kind: "rect"; b: number; h: number };

export interface CombinedInput {
  section: Section;
  /** Axial force (N), tension positive. */
  P: number;
  /** Bending moment (N·m); for a rectangle, about the axis parallel to b (h is the depth). */
  M: number;
  /** Torque (N·m); must be 0 for a rectangle. */
  T: number;
  /** Transverse shear force (N), in the bending plane; 0 to skip. */
  V: number;
  /** Pinned-pinned beam-column length (m) and Young's modulus (Pa), or null. */
  beamColumn: { L: number; E: number } | null;
}

export interface PointState {
  sigma: number;
  tau: number;
  stress: PrincipalResult;
}

export interface CombinedResult {
  ok: true;
  A: number;
  /** Second moment about the bending axis, and the smallest one (m⁴). */
  I: number;
  Imin: number;
  /** Polar moment (circle) or null (rectangle). */
  J: number | null;
  /** P/A (signed) and the bending stress magnitude at the outer fibre (amplified), Pa. */
  sigmaAxial: number;
  sigmaBend: number;
  /** Torsional shear at the outer surface (Pa). */
  tauTorsion: number;
  /** Mean transverse shear at the neutral axis (Pa). */
  tauShear: number;
  outer: PointState;
  /** The neutral-axis point, when a transverse shear was given; null otherwise. */
  neutral: PointState | null;
  governing: "outer" | "neutral";
  /** Beam-column: P_cr about the bending axis and the smallest one (N), and the factor applied. */
  pcr: number | null;
  pcrMin: number | null;
  amplification: number;
  /** Why no amplification was applied although a beam-column length was given. */
  ampNote: string | null;
}

export interface CombinedError {
  ok: false;
  error: string;
}

const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

export function combinedLoad(inp: CombinedInput): CombinedResult | CombinedError {
  const { section: s, P, M, T, V } = inp;
  if (!fin(P, M, T, V)) return { ok: false, error: "Every load must be a finite number." };
  let A: number, I: number, Imin: number, c: number, J: number | null, tauVper: number;
  if (s.kind === "circle") {
    if (!fin(s.d, s.di)) return { ok: false, error: "The diameters must be finite numbers." };
    if (s.d <= 0) return { ok: false, error: "The outer diameter must be greater than zero." };
    if (s.di < 0) return { ok: false, error: "The inner diameter cannot be negative (0 is a solid shaft)." };
    if (s.di >= s.d) return { ok: false, error: "The inner diameter must be smaller than the outer diameter." };
    const ro = s.d / 2;
    const ri = s.di / 2;
    A = Math.PI * (ro * ro - ri * ri);
    I = (Math.PI / 4) * (ro ** 4 - ri ** 4);
    Imin = I;
    J = 2 * I;
    c = ro;
    // Jourawski at the neutral axis: Q = (2/3)(ro³ − ri³), chord width t = 2(ro − ri).
    tauVper = ((2 / 3) * (ro ** 3 - ri ** 3)) / (I * 2 * (ro - ri));
  } else {
    if (!fin(s.b, s.h)) return { ok: false, error: "The width and depth must be finite numbers." };
    if (s.b <= 0 || s.h <= 0) return { ok: false, error: "The width and depth must be greater than zero." };
    if (T !== 0) {
      return {
        ok: false,
        error:
          "Torsion is computed for circular sections only: τ = Tr/J is exact for a circle and wrong for a rectangle " +
          "(the section warps and the peak shear moves to the middle of the long side). Set the torque to 0, or use a " +
          "round section.",
      };
    }
    A = s.b * s.h;
    I = (s.b * s.h ** 3) / 12;
    Imin =Math.min(I, (s.h * s.b ** 3) / 12);
    J = null;
    c = s.h / 2;
    tauVper = 1.5 / A;
  }
  if (!fin(A, I, c, tauVper) || A <= 0 || I <= 0) {
    return { ok: false, error: "The section is outside the range double precision can compute (I is a fourth power); check the units." };
  }

  let amplification = 1;
  let pcr: number | null = null;
  let pcrMin: number | null = null;
  let ampNote: string | null = null;
  if (inp.beamColumn) {
    const { L, E } = inp.beamColumn;
    if (!fin(L, E) || L <= 0) return { ok: false, error: "The beam-column length must be greater than zero." };
    if (E <= 0) return { ok: false, error: "Young's modulus must be greater than zero." };
    pcr = (Math.PI * Math.PI * E * I) / (L * L);
    pcrMin = (Math.PI * Math.PI * E * Imin) / (L * L);
    if (!fin(pcr, pcrMin) || pcrMin <= 0) return { ok: false, error: "The critical load is outside double precision for these values; check the units." };
    if (P < 0) {
      const Pc = -P;
      if (Pc >= pcrMin) {
        return {
          ok: false,
          error:
            "The compressive load is at or above the perfect-column critical load P_cr = π²EI/L² (pinned ends" +
            (pcrMin < pcr ? ", weak axis" : "") +
            "): the column has buckled, and no amplified stress exists. Reduce the load or the length, or stiffen the section.",
        };
      }
      amplification = 1 / (1 - Pc / pcr);
    } else if (P > 0) {
      ampNote = "The axial load is tensile, which straightens a beam-column: no amplification is applied (the unamplified moment is conservative).";
    } else {
      ampNote = "There is no axial load, so the amplification is 1.";
    }
  }

  const sigmaAxial = P / A;
  const sigmaBend = (Math.abs(M) * amplification * c) / I;
  const tauTorsion = J === null ? 0 : (Math.abs(T) * c) / J;
  const tauShear = Math.abs(V) * tauVper;
  // The fibre where the two normal stresses add (tension side for P ≥ 0, compression side for P < 0).
  const sigmaOuter = P < 0 ? sigmaAxial - sigmaBend : sigmaAxial + sigmaBend;
  if (!fin(sigmaAxial, sigmaBend, tauTorsion, tauShear, sigmaOuter)) {
    return { ok: false, error: "The stresses overflow double precision for these values; check the units." };
  }
  const state = (sigma: number, tau: number): PointState | CombinedError => {
    const r = analyzeStress({ sx: sigma, sy: 0, sz: 0, txy: tau, tyz: 0, tzx: 0 });
    if (!r.ok) return { ok: false, error: r.error };
    return { sigma, tau, stress: r };
  };
  const outer = state(sigmaOuter, tauTorsion);
  if ("ok" in outer) return outer;
  let neutral: PointState | null = null;
  if (V !== 0) {
    const n = state(sigmaAxial, tauTorsion + tauShear);
    if ("ok" in n) return n;
    neutral = n;
  }
  const governing = neutral && neutral.stress.vonMises > outer.stress.vonMises ? "neutral" : "outer";
  return { ok: true, A, I, Imin, J, sigmaAxial, sigmaBend, tauTorsion, tauShear, outer, neutral, governing, pcr, pcrMin, amplification, ampNote };
}
