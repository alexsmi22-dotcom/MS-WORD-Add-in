// Colour science: CIE colorimetry for the "Colour & appearance" Engineering group (colourCalcs.ts is the pane glue,
// colourCharts.ts the figures). Pure functions, no Office.js, no DOM.
//
// THE REFERENCE IMPLEMENTATION IS colour-science 0.4.7, and every function here is tested against it
// (scripts/colour-oracle.py → fixtures/colour-oracle.json, colourScience.oracle.test.ts). The tables come from
// colourData.ts, which a script extracted from the same package (see its header and colourData.crosscheck.test.ts).
//
// CONVENTIONS, stated once:
//   - XYZ is on the 0–100 scale: the perfect white has Y = 100.
//   - CIE 1976 L*a*b* and L*u*v* use the exact CIE constants ε = 216/24389 and κ = 24389/27 (CIE 15:2004 note), as
//     colour-science does, not the rounded 0.008856 and 903.3.
//   - Hue angles are in degrees on [0, 360). A neutral (a* = b* = 0) has hue 0 by convention and no meaningful hue.
//   - Differences are SAMPLE minus STANDARD (ΔL* > 0: the sample is lighter). CIE94 and CMC weight by the STANDARD's
//     chroma and hue, so they are not symmetric: swapping the two changes ΔE*94 and ΔE CMC, never ΔE*ab or ΔE₀₀.
//   - Chromatic adaptation is the von Kries form with COMPLETE adaptation (D = 1).

import {
  CAT_MATRICES,
  CMF_10,
  CMF_2,
  CMF_END,
  CMF_START,
  E313_COEFFICIENTS,
  ILLUMINANT_SPD,
  SRGB_RGB_TO_XYZ,
  SRGB_WHITE_XY,
  SRGB_XYZ_TO_RGB,
  WHITE_XY,
  type CmfTable,
} from "./colourData";

export type Vec3 = [number, number, number];
export type Observer = "2" | "10";

/** The illuminants offered, in menu order. */
export const ILLUMINANTS = ["D65", "D50", "A", "C", "F2", "F7", "F11", "D55", "D75"] as const;
export type IlluminantId = (typeof ILLUMINANTS)[number];

export const ILLUMINANT_LABELS: Record<IlluminantId, string> = {
  D65: "D65 (average daylight, 6504 K)",
  D50: "D50 (horizon daylight, graphic arts, 5003 K)",
  A: "A (incandescent tungsten, 2856 K)",
  C: "C (average daylight, older, 6774 K)",
  F2: "F2 (cool white fluorescent)",
  F7: "F7 (broadband daylight fluorescent)",
  F11: "F11 (narrow tri-band fluorescent, TL84-type)",
  D55: "D55 (mid-morning daylight, 5503 K)",
  D75: "D75 (north-sky daylight, 7504 K)",
};

export const OBSERVER_LABELS: Record<Observer, string> = {
  "2": "2° (CIE 1931)",
  "10": "10° (CIE 1964)",
};

export const isIlluminant = (s: string): s is IlluminantId => (ILLUMINANTS as readonly string[]).includes(s);

export const CIE_E = 216 / 24389;
export const CIE_K = 24389 / 27;

export interface Lab {
  L: number;
  a: number;
  b: number;
}
export interface LCh {
  L: number;
  C: number;
  h: number;
}

const DEG = Math.PI / 180;

/** A hue angle in degrees on [0, 360), with −0 written as 0. */
export function hueDeg(b: number, a: number): number {
  if (a === 0 && b === 0) return 0;
  let h = Math.atan2(b, a) / DEG;
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;
  return h + 0;
}

// ---------------------------------------------------------------------------------------------------------------
// White points and the basic transforms
// ---------------------------------------------------------------------------------------------------------------

/** xyY to XYZ (Y on the scale given). */
export function xyToXYZ(x: number, y: number, Y = 100): Vec3 {
  return [(x * Y) / y, Y, ((1 - x - y) * Y) / y];
}

/** XYZ to CIE 1931 xy; null for X + Y + Z = 0 (black has no chromaticity). */
export function XYZToxy(XYZ: Vec3): [number, number] | null {
  const s = XYZ[0] + XYZ[1] + XYZ[2];
  if (!(s !== 0) || !Number.isFinite(s)) return null;
  return [XYZ[0] / s, XYZ[1] / s];
}

const WHITE_CACHE = new Map<string, Vec3>();

/**
 * The white point of an illuminant as XYZ with Y = 100: the perfect diffuser computed from the illuminant's SPD and
 * the observer's colour-matching functions at 1 nm over 360–780 nm (CIE 15 / ASTM E308 practice: D65 2° is
 * 95.047, 100, 108.883; D65 10° 94.811, 100, 107.304). NOT the XYZ rebuilt from the tabulated chromaticity
 * (colour.CCS_ILLUMINANTS, 4–5 decimals), which gives 95.046, 100, 108.906 for D65 2° and moves b* by up to 0.011.
 * The tabulated xy is kept in colourData.ts and the crosscheck test holds the two within 10⁻³.
 */
export function whitePoint(ill: IlluminantId, obs: Observer): Vec3 {
  const key = ill + "/" + obs;
  let w = WHITE_CACHE.get(key);
  if (!w) {
    const S = illuminant1nm(ill);
    const c = cmfTable(obs);
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < S.length; i++) {
      X += S[i] * c.x[i];
      Y += S[i] * c.y[i];
      Z += S[i] * c.z[i];
    }
    w = [(100 * X) / Y, 100, (100 * Z) / Y];
    WHITE_CACHE.set(key, w);
  }
  return w.slice() as Vec3;
}

/** The tabulated white-point chromaticity (colour.CCS_ILLUMINANTS), for the record beside the computed white. */
export const tabulatedWhiteXy = (ill: IlluminantId, obs: Observer): readonly [number, number] => WHITE_XY[obs][ill];

const fLab = (t: number): number => (t > CIE_E ? Math.cbrt(t) : (CIE_K * t + 16) / 116);
const fLabInv = (f: number): number => (f ** 3 > CIE_E ? f ** 3 : (116 * f - 16) / CIE_K);

/** CIE 1976 L*a*b* from XYZ relative to the white Wn (both on the same scale). */
export function XYZToLab(XYZ: Vec3, Wn: Vec3): Lab {
  const fx = fLab(XYZ[0] / Wn[0]);
  const fy = fLab(XYZ[1] / Wn[1]);
  const fz = fLab(XYZ[2] / Wn[2]);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** XYZ from CIE 1976 L*a*b* relative to the white Wn. */
export function labToXYZ(lab: Lab, Wn: Vec3): Vec3 {
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const yr = lab.L > CIE_K * CIE_E ? fy ** 3 : lab.L / CIE_K;
  return [fLabInv(fx) * Wn[0], yr * Wn[1], fLabInv(fz) * Wn[2]];
}

export function labToLch(lab: Lab): LCh {
  return { L: lab.L, C: Math.hypot(lab.a, lab.b), h: hueDeg(lab.b, lab.a) };
}

export function lchToLab(lch: LCh): Lab {
  return { L: lch.L, a: lch.C * Math.cos(lch.h * DEG), b: lch.C * Math.sin(lch.h * DEG) };
}

/** CIE 1976 u'v' chromaticity of XYZ; null for black. */
export function XYZToUpVp(XYZ: Vec3): [number, number] | null {
  const d = XYZ[0] + 15 * XYZ[1] + 3 * XYZ[2];
  if (!(d !== 0) || !Number.isFinite(d)) return null;
  return [(4 * XYZ[0]) / d, (9 * XYZ[1]) / d];
}

export interface Luv {
  L: number;
  u: number;
  v: number;
}

/** CIE 1976 L*u*v* relative to the white Wn. A black sample (X + 15Y + 3Z = 0) has u* = v* = 0. */
export function XYZToLuv(XYZ: Vec3, Wn: Vec3): Luv {
  const yr = XYZ[1] / Wn[1];
  const L = yr > CIE_E ? 116 * Math.cbrt(yr) - 16 : CIE_K * yr;
  const uv = XYZToUpVp(XYZ);
  const uvn = XYZToUpVp(Wn) as [number, number];
  if (!uv) return { L, u: 0, v: 0 };
  return { L, u: 13 * L * (uv[0] - uvn[0]), v: 13 * L * (uv[1] - uvn[1]) };
}

/** XYZ from CIE 1976 L*u*v* relative to the white Wn. */
export function luvToXYZ(luv: Luv, Wn: Vec3): Vec3 {
  if (luv.L === 0) return [0, 0, 0];
  const uvn = XYZToUpVp(Wn) as [number, number];
  const Y = (luv.L > CIE_K * CIE_E ? ((luv.L + 16) / 116) ** 3 : luv.L / CIE_K) * Wn[1];
  const up = luv.u / (13 * luv.L) + uvn[0];
  const vp = luv.v / (13 * luv.L) + uvn[1];
  const X = (Y * 9 * up) / (4 * vp);
  const Z = (Y * (12 - 3 * up - 20 * vp)) / (4 * vp);
  return [X, Y, Z];
}

// ---------------------------------------------------------------------------------------------------------------
// Matrices and chromatic adaptation
// ---------------------------------------------------------------------------------------------------------------

type M3 = readonly (readonly number[])[];

export function mulMV(m: M3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function inv3(m: M3): number[][] {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

export type CatMethod = "bradford" | "vonkries" | "cat02" | "cat16";
export const CAT_LABELS: Record<CatMethod, string> = {
  bradford: "Bradford",
  vonkries: "von Kries (Hunt–Pointer–Estévez)",
  cat02: "CAT02",
  cat16: "CAT16",
};

/**
 * Von Kries-type chromatic adaptation with complete adaptation (D = 1): XYZ seen under the white Ws, mapped to the
 * corresponding colour under the white Wd (colour.adaptation.chromatic_adaptation_VonKries). The whites and the colour
 * share one scale.
 */
export function adaptXYZ(XYZ: Vec3, Ws: Vec3, Wd: Vec3, method: CatMethod): Vec3 {
  const M = CAT_MATRICES[method];
  const s = mulMV(M, Ws);
  const d = mulMV(M, Wd);
  const cone = mulMV(M, XYZ);
  const adapted: Vec3 = [(cone[0] * d[0]) / s[0], (cone[1] * d[1]) / s[1], (cone[2] * d[2]) / s[2]];
  return mulMV(inv3(M), adapted);
}

// ---------------------------------------------------------------------------------------------------------------
// sRGB (IEC 61966-2-1)
// ---------------------------------------------------------------------------------------------------------------

/** The sRGB encoding (colour.models.eotf_inverse_sRGB): linear → encoded, both 0–1; linear below 0.0031308. */
export function srgbEncode(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055;
}

/** The sRGB decoding (colour.models.eotf_sRGB): encoded → linear, both 0–1; linear below 0.04045. */
export function srgbDecode(V: number): number {
  return V <= 0.04045 ? V / 12.92 : Math.sign(V + 0.055) * (Math.abs(V + 0.055) / 1.055) ** 2.4;
}

export const SRGB_WHITE: Vec3 = xyToXYZ(SRGB_WHITE_XY[0], SRGB_WHITE_XY[1], 100);

/** The adaptation used to reach the sRGB white from another white: Bradford, as ICC profiles do. */
export const SRGB_CAT: CatMethod = "bradford";

export interface SrgbResult {
  /** Linear RGB, 0–1 nominal (outside it when out of gamut). */
  linear: Vec3;
  /** Encoded R′G′B′, 0–1 nominal, unclipped. */
  encoded: Vec3;
  /** Within the sRGB gamut to 8-bit precision. */
  inGamut: boolean;
  /** 8-bit values after clipping each encoded channel to 0–1. */
  rgb255: Vec3;
  hex: string;
  /** True when the white is not D65 2° (to 10⁻³), i.e. a real change of illuminant or observer was adapted away. */
  adapted: boolean;
}

const sameWhite = (a: Vec3, b: Vec3): boolean => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;

/** XYZ (relative to the white Wn) to sRGB, adapting Wn → the sRGB D65 white by Bradford when they differ. */
export function XYZToSrgb(XYZ: Vec3, Wn: Vec3): SrgbResult {
  // Any difference of white is adapted (the computed D65 2° white, 95.047/108.883, and IEC's rounded sRGB white,
  // 95.046/108.906, differ in the fourth figure); `adapted` reports only a real change of illuminant or observer.
  const x = sameWhite(Wn, SRGB_WHITE) ? XYZ : adaptXYZ(XYZ, Wn, SRGB_WHITE, SRGB_CAT);
  const adapted = [0, 1, 2].some((i) => Math.abs(Wn[i] / SRGB_WHITE[i] - 1) > 1e-3);
  const linear = mulMV(SRGB_XYZ_TO_RGB, [x[0] / 100, x[1] / 100, x[2] / 100]);
  const encoded = linear.map(srgbEncode) as Vec3;
  const half = 0.5 / 255;
  const inGamut = encoded.every((v) => v >= -half && v <= 1 + half);
  const rgb255 = encoded.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as Vec3;
  return { linear, encoded, inGamut, rgb255, hex: rgbHex(rgb255), adapted };
}

/** sRGB (encoded, 0–1) to XYZ relative to the white Wn, adapting the sRGB white → Wn by Bradford when they differ. */
export function srgbToXYZ(encoded: Vec3, Wn: Vec3): Vec3 {
  const lin = encoded.map(srgbDecode) as Vec3;
  const x = mulMV(SRGB_RGB_TO_XYZ, lin).map((v) => v * 100) as Vec3;
  return sameWhite(Wn, SRGB_WHITE) ? x : adaptXYZ(x, SRGB_WHITE, Wn, SRGB_CAT);
}

export function rgbHex(rgb: Vec3): string {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** "#7F3A00", "7f3a00" or "#fa0" to 0–255 integers; null when it is not a hex colour. */
export function parseHex(s: string): Vec3 | null {
  const t = s.trim().replace(/^(?:#|0x)/i, "");
  if (/^[0-9a-fA-F]{3}$/.test(t)) return [0, 1, 2].map((i) => parseInt(t[i] + t[i], 16)) as Vec3;
  if (/^[0-9a-fA-F]{6}$/.test(t)) return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16)) as Vec3;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Colour differences
// ---------------------------------------------------------------------------------------------------------------

/**
 * The largest ΔE whose tolerance region is drawn. CIE94, CMC and CIEDE2000 were fitted to small differences; at large
 * levels the CIEDE2000 "region" stops closing (from a neutral standard no ray reaches ΔE₀₀ = 50) and is no tolerance.
 */
export const CONTOUR_MAX_DE = 10;

export interface DiffComponents {
  dL: number;
  da: number;
  db: number;
  C1: number;
  C2: number;
  dC: number;
  /** Signed metric hue difference ΔH*ab = 2√(C*₁C*₂)·sin(Δhab/2); positive when the sample's hue angle is larger. */
  dH: number;
  h1: number;
  h2: number;
  /** Hue-angle difference, sample minus standard, wrapped to (−180, 180]; 0 when either colour is neutral. */
  dh: number;
  /** False when either colour has C*ab = 0: its hue is undefined and no hue words apply. */
  hueDefined: boolean;
}

/** Sample minus standard, in L*a*b* and L*C*h. */
export function diffComponents(std: Lab, smp: Lab): DiffComponents {
  const C1 = Math.hypot(std.a, std.b);
  const C2 = Math.hypot(smp.a, smp.b);
  const h1 = hueDeg(std.b, std.a);
  const h2 = hueDeg(smp.b, smp.a);
  const hueDefined = C1 > 0 && C2 > 0;
  let dh = 0;
  if (hueDefined) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh <= -180) dh += 360;
  }
  const dH = hueDefined ? 2 * Math.sqrt(C1 * C2) * Math.sin((dh * DEG) / 2) : 0;
  return { dL: smp.L - std.L, da: smp.a - std.a, db: smp.b - std.b, C1, C2, dC: C2 - C1, dH, h1, h2, dh, hueDefined };
}

/** CIE 1976 ΔE*ab: the Euclidean distance in L*a*b*. */
export function deltaE76(std: Lab, smp: Lab): number {
  return Math.hypot(smp.L - std.L, smp.a - std.a, smp.b - std.b);
}

/**
 * CIE 1994 ΔE*94 (colour.difference.delta_E_CIE1994): graphic arts kL = 1, K₁ = 0.045, K₂ = 0.015; textiles kL = 2,
 * K₁ = 0.048, K₂ = 0.014. S_C and S_H use the STANDARD's chroma.
 */
export function deltaE94(std: Lab, smp: Lab, textiles = false): number {
  const k1 = textiles ? 0.048 : 0.045;
  const k2 = textiles ? 0.014 : 0.015;
  const kL = textiles ? 2 : 1;
  const C1 = Math.hypot(std.a, std.b);
  const C2 = Math.hypot(smp.a, smp.b);
  const sC = 1 + k1 * C1;
  const sH = 1 + k2 * C1;
  const dL = std.L - smp.L;
  const dC = C1 - C2;
  const radical = (std.a - smp.a) ** 2 + (std.b - smp.b) ** 2 - dC * dC;
  const dH = radical > 0 ? Math.sqrt(radical) : 0;
  return Math.sqrt((dL / kL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2);
}

/** CMC l:c (colour.difference.delta_E_CMC), weighted by the STANDARD. Acceptability 2:1, perceptibility 1:1. */
export function deltaECMC(std: Lab, smp: Lab, l = 2, c = 1): number {
  const C1 = Math.hypot(std.a, std.b);
  const C2 = Math.hypot(smp.a, smp.b);
  const sL = std.L < 16 ? 0.511 : (0.040975 * std.L) / (1 + 0.01765 * std.L);
  const sC = (0.0638 * C1) / (1 + 0.0131 * C1) + 0.638;
  const h1 = hueDeg(std.b, std.a);
  const T = h1 >= 164 && h1 <= 345 ? 0.56 + Math.abs(0.2 * Math.cos((h1 + 168) * DEG)) : 0.36 + Math.abs(0.4 * Math.cos((h1 + 35) * DEG));
  const C4 = C1 ** 4;
  const F = Math.sqrt(C4 / (C4 + 1900));
  const sH = sC * (F * T + 1 - F);
  const dL = std.L - smp.L;
  const dC = C1 - C2;
  const dH2 = (std.a - smp.a) ** 2 + (std.b - smp.b) ** 2 - dC * dC;
  return Math.sqrt((dL / (l * sL)) ** 2 + (dC / (c * sC)) ** 2 + dH2 / (sH * sH));
}

export interface Ciede2000 {
  dE: number;
  dLp: number;
  dCp: number;
  dHp: number;
  SL: number;
  SC: number;
  SH: number;
  RT: number;
  /** Mean hue h̄′ (degrees). */
  hBar: number;
  G: number;
}

/**
 * CIEDE2000 (CIE 142-2001; Sharma, Wu & Dalal 2005) with parametric factors kL:kC:kH.
 *
 * THE |Δh′| = 180° TIE. Sharma's statement is in exact arithmetic: |h′₁ − h′₂| ≤ 180° takes the plain mean and
 * difference. When the a′b′ vectors are EXACTLY antiparallel (cross product 0, dot product negative) the exact
 * difference is 180° and that branch applies, whatever the last bit of two atan2 results says. Without this rule the
 * published pair 14 of the Sharma table (−0.0010, 2.4900 against 0.0010, −2.4900, ΔE₀₀ = 4.8045) comes out 4.7461
 * on platforms whose atan2 rounds the difference to 180.000000000000028 (colour-science excludes the pair for it).
 */
export function ciede2000(std: Lab, smp: Lab, kL = 1, kC = 1, kH = 1): Ciede2000 {
  const C1 = Math.hypot(std.a, std.b);
  const C2 = Math.hypot(smp.a, smp.b);
  const Cb = (C1 + C2) / 2;
  const Cb7 = Cb ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1 = (1 + G) * std.a;
  const a2 = (1 + G) * smp.a;
  const Cp1 = Math.hypot(a1, std.b);
  const Cp2 = Math.hypot(a2, smp.b);
  const hp1 = hueDeg(std.b, a1);
  const hp2 = hueDeg(smp.b, a2);
  const CC = Cp1 * Cp2;
  const antiparallel = CC !== 0 && a1 * smp.b - a2 * std.b === 0 && a1 * a2 + std.b * smp.b < 0;
  const d = hp2 - hp1;
  let dhp: number;
  let hBar: number;
  if (CC === 0) {
    dhp = 0;
    hBar = hp1 + hp2;
  } else if (antiparallel) {
    dhp = d >= 0 ? 180 : -180;
    hBar = (hp1 + hp2) / 2;
  } else if (Math.abs(d) <= 180) {
    dhp = d;
    hBar = (hp1 + hp2) / 2;
  } else {
    dhp = d > 180 ? d - 360 : d + 360;
    hBar = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  }
  const dLp = smp.L - std.L;
  const dCp = Cp2 - Cp1;
  const dHp = 2 * Math.sqrt(CC) * Math.sin((dhp * DEG) / 2);
  const Lb = (std.L + smp.L) / 2;
  const Cbp = (Cp1 + Cp2) / 2;
  const T =
    1 -
    0.17 * Math.cos((hBar - 30) * DEG) +
    0.24 * Math.cos(2 * hBar * DEG) +
    0.32 * Math.cos((3 * hBar + 6) * DEG) -
    0.2 * Math.cos((4 * hBar - 63) * DEG);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const Lb2 = (Lb - 50) ** 2;
  const SL = 1 + (0.015 * Lb2) / Math.sqrt(20 + Lb2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * DEG) * RC;
  const l = dLp / (kL * SL);
  const c = dCp / (kC * SC);
  const h = dHp / (kH * SH);
  return { dE: Math.sqrt(l * l + c * c + h * h + RT * c * h), dLp, dCp, dHp, SL, SC, SH, RT, hBar, G };
}

/** The formulas a tolerance can be stated on. */
export type DeFormula = "de00" | "de76" | "de94g" | "de94t" | "cmc21" | "cmc11";
export const DE_FORMULA_LABELS: Record<DeFormula, string> = {
  de00: "ΔE₀₀ (CIEDE2000)",
  de76: "ΔE*ab (CIE76)",
  de94g: "ΔE*94 (CIE94, graphic arts)",
  de94t: "ΔE*94 (CIE94, textiles)",
  cmc21: "ΔE CMC(2:1)",
  cmc11: "ΔE CMC(1:1)",
};
/** The symbol alone, for a claim line. */
export const DE_SYMBOL: Record<DeFormula, string> = {
  de00: "ΔE₀₀",
  de76: "ΔE*ab",
  de94g: "ΔE*94",
  de94t: "ΔE*94",
  cmc21: "ΔE CMC(2:1)",
  cmc11: "ΔE CMC(1:1)",
};

export interface ParametricK {
  kL: number;
  kC: number;
  kH: number;
}

/** ΔE between a standard and a sample on a named formula (k used by ΔE₀₀ only). */
export function deltaE(f: DeFormula, std: Lab, smp: Lab, k: ParametricK = { kL: 1, kC: 1, kH: 1 }): number {
  switch (f) {
    case "de00":
      return ciede2000(std, smp, k.kL, k.kC, k.kH).dE;
    case "de76":
      return deltaE76(std, smp);
    case "de94g":
      return deltaE94(std, smp, false);
    case "de94t":
      return deltaE94(std, smp, true);
    case "cmc21":
      return deltaECMC(std, smp, 2, 1);
    case "cmc11":
      return deltaECMC(std, smp, 1, 1);
    default:
      return NaN;
  }
}

/**
 * The tolerance contour of a formula around the standard in the a*b* plane at the standard's L*: along each of
 * `rays` directions, the FIRST distance at which ΔE reaches `tol` (stepped outward, then bisected). One code path for
 * every formula, because CIEDE2000's region is not an ellipse. Returns NO points when the level is above
 * CONTOUR_MAX_DE or any ray fails to reach it (an unclosed region is not drawn as a closed one).
 */
export function toleranceContour(f: DeFormula, std: Lab, tol: number, k: ParametricK = { kL: 1, kC: 1, kH: 1 }, rays = 144): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  if (!(tol > 0) || !Number.isFinite(tol) || tol > CONTOUR_MAX_DE) return pts;
  if (![std.L, std.a, std.b].every(Number.isFinite)) return pts;
  // A finite, bounded ray count whatever the caller passes (an unbounded loop freezes Word).
  rays = Number.isFinite(rays) ? Math.min(720, Math.max(8, Math.round(rays))) : 144;
  for (let i = 0; i <= rays; i++) {
    const th = (2 * Math.PI * (i % rays)) / rays;
    const at = (r: number): number => deltaE(f, std, { L: std.L, a: std.a + r * Math.cos(th), b: std.b + r * Math.sin(th) }, k);
    // Fine steps out to 4·tol (the first crossing is found, not a later one), then doubling to |Δab| = 400.
    let lo = 0;
    let hi = tol / 16;
    let found = false;
    for (let s = 0; s < 120 && hi <= 400; s++) {
      if (at(hi) >= tol) {
        found = true;
        break;
      }
      lo = hi;
      hi = s < 63 ? hi + tol / 16 : hi * 2;
    }
    // A ray that never reaches the level means the region is not closed: draw no contour rather than join the rest.
    if (!found) return [];
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (at(mid) >= tol) hi = mid;
      else lo = mid;
    }
    const r = (lo + hi) / 2;
    pts.push({ x: std.a + r * Math.cos(th), y: std.b + r * Math.sin(th) });
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// Spectral data
// ---------------------------------------------------------------------------------------------------------------

export const cmfTable = (obs: Observer): CmfTable => (obs === "2" ? CMF_2 : CMF_10);

/** Linear interpolation of a uniform table to 1 nm over CMF_START..CMF_END, the end values held outside it. */
function linearTo1nm(start: number, step: number, values: readonly number[]): number[] {
  const out: number[] = [];
  const end = start + step * (values.length - 1);
  for (let w = CMF_START; w <= CMF_END; w++) {
    if (w <= start) out.push(values[0]);
    else if (w >= end) out.push(values[values.length - 1]);
    else {
      const i = Math.floor((w - start) / step);
      const t = (w - start - i * step) / step;
      out.push(t === 0 ? values[i] : values[i] + t * (values[i + 1] - values[i]));
    }
  }
  return out;
}

const SPD_CACHE = new Map<IlluminantId, number[]>();

/** An illuminant's relative SPD at 1 nm, 360–780 nm: linear between its 5 nm values, held constant beyond them. */
export function illuminant1nm(ill: IlluminantId): number[] {
  let v = SPD_CACHE.get(ill);
  if (!v) {
    if (ill === "A") {
      // CIE standard illuminant A is DEFINED by Planck's law (CIE 15; colour.sd_CIE_standard_illuminant_A), so it
      // is computed at every nanometre rather than interpolated from the 5 nm table (which the crosscheck test
      // holds to the formula).
      v = [];
      for (let w = CMF_START; w <= CMF_END; w++) v.push((100 * (560 / w) ** 5 * Math.expm1(1.435e7 / (2848 * 560))) / Math.expm1(1.435e7 / (2848 * w)));
    } else {
      const s = ILLUMINANT_SPD[ill];
      v = linearTo1nm(s.start, s.step, s.values);
    }
    SPD_CACHE.set(ill, v);
  }
  return v;
}

const SPRAGUE_C = [
  [884, -1960, 3033, -2648, 1080, -180],
  [508, -540, 488, -367, 144, -24],
  [-24, 144, -367, 488, -540, 508],
  [-180, 1080, -2648, 3033, -1960, 884],
];
const SPRAGUE_W = [
  [2, -16, 0, 16, -2, 0],
  [-1, 16, -30, 16, -1, 0],
  [-9, 39, -70, 66, -33, 7],
  [13, -64, 126, -124, 61, -12],
  [-5, 25, -50, 50, -25, 5],
];

/**
 * Sprague (1880) fifth-order interpolation of uniformly spaced data, as CIE 167:2005 recommends and
 * colour.algebra.SpragueInterpolator implements it (two points of padding at each end from the CIE boundary
 * coefficients). Needs at least six points; evaluated only inside [x₀, xₙ].
 */
export function sprague(x: readonly number[], y: readonly number[]): (xi: number) => number {
  const n = y.length;
  const dx = x[1] - x[0];
  const pad = SPRAGUE_C.map((c, k) => {
    const src = k < 2 ? y.slice(0, 6) : y.slice(n - 6);
    return c.reduce((s, ci, j) => s + ci * src[j], 0) / 209;
  });
  const yp = [pad[0], pad[1], ...y, pad[2], pad[3]];
  const xp = [x[0] - 2 * dx, x[0] - dx, ...x, x[n - 1] + dx, x[n - 1] + 2 * dx];
  return (xi: number): number => {
    // np.searchsorted(xp, xi) − 1 (left side): the last knot strictly below xi.
    let lo = 0;
    let hi = xp.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xp[mid] < xi) lo = mid + 1;
      else hi = mid;
    }
    const i = lo - 1;
    const X = (xi - xp[i]) / (xp[i + 1] - xp[i]);
    const r = [yp[i - 2], yp[i - 1], yp[i], yp[i + 1], yp[i + 2], yp[i + 3]];
    let v = yp[i];
    let Xk = 1;
    for (let k = 0; k < 5; k++) {
      Xk *= X;
      const a = SPRAGUE_W[k].reduce((s, w, j) => s + w * r[j], 0) / 24;
      v += a * Xk;
    }
    return v;
  };
}

export interface Spectrum {
  /** Wavelengths, nm, strictly increasing and uniformly spaced. */
  wl: number[];
  /** Reflectance or transmittance factor (fraction; 1 = the perfect white). */
  v: number[];
}

export type SpectralMethod = "astm-e308" | "integration";
export const SPECTRAL_METHOD_LABELS: Record<SpectralMethod, string> = {
  "astm-e308": "ASTM E308 (weighting factors for 10 and 20 nm data, summation at 1 and 5 nm)",
  integration: "CIE 15 integration at 1 nm (Sprague interpolation)",
};

export interface SpectrumCheck {
  ok: true;
  step: number;
  notes: string[];
}

/** Uniform step, at least 6 points, finite, inside the ranges the methods support; sorts a descending block. */
export function checkSpectrum(s: Spectrum): SpectrumCheck | { ok: false; error: string } {
  const n = s.wl.length;
  if (n !== s.v.length) return { ok: false, error: "Each row needs a wavelength and a value." };
  if (n < 6) return { ok: false, error: `A spectrum needs at least six rows (got ${n}): the interpolation CIE 167 recommends (Sprague) uses six neighbouring points.` };
  if (s.wl.some((w) => !Number.isFinite(w)) || s.v.some((v) => !Number.isFinite(v))) return { ok: false, error: "Every wavelength and value must be a finite number." };
  if (s.wl.some((w) => w !== Math.round(w))) return { ok: false, error: "Wavelengths must be whole nanometres (380, 390, …): the colour-matching functions are tabulated at 1 nm." };
  const notes: string[] = [];
  if (s.wl.every((w, i) => i === 0 || w < s.wl[i - 1])) {
    s.wl.reverse();
    s.v.reverse();
    notes.push("The rows were in descending wavelength order and were reversed.");
  }
  for (let i = 1; i < n; i++) {
    if (s.wl[i] === s.wl[i - 1]) return { ok: false, error: `The wavelength ${s.wl[i]} nm appears twice. Give each wavelength once.` };
    if (s.wl[i] < s.wl[i - 1]) return { ok: false, error: `The wavelengths are not in order (${s.wl[i - 1]} nm is followed by ${s.wl[i]} nm). Sort the rows by wavelength.` };
  }
  const step = s.wl[1] - s.wl[0];
  for (let i = 2; i < n; i++) {
    const d = s.wl[i] - s.wl[i - 1];
    if (Math.abs(d - step) > 1e-6 * Math.max(1, step)) {
      return { ok: false, error: `The wavelength step is not uniform (${step} nm, then ${d} nm at ${s.wl[i]} nm). Resample the data to one step (1, 5, 10 or 20 nm) first; irregular spacing is not interpolated here.` };
    }
  }
  if (step > 20) return { ok: false, error: `A ${step} nm step is too coarse: CIE 15 and ASTM E308 work at 1, 5, 10 or 20 nm.` };
  if (s.wl[0] > 400 || s.wl[n - 1] < 700) {
    return { ok: false, error: `The data run from ${s.wl[0]} to ${s.wl[n - 1]} nm, but must cover at least 400–700 nm (ASTM E308; ideally 360–780 nm). Beyond the measured range the end values are held, which is acceptable only outside 400–700 nm.` };
  }
  if (s.wl[0] < 300 || s.wl[n - 1] > 900) return { ok: false, error: `The data run from ${s.wl[0]} to ${s.wl[n - 1]} nm: wavelengths must be in nanometres, within 300–900 nm.` };
  return { ok: true, step, notes };
}

/** The spectrum's values on a grid: Sprague inside its range (exact at its own knots), end values held outside. */
function alignSpectrum(s: Spectrum, grid: number[]): number[] {
  const f = sprague(s.wl, s.v);
  const lo = s.wl[0];
  const hi = s.wl[s.wl.length - 1];
  const at = new Map(s.wl.map((w, i) => [w, s.v[i]]));
  return grid.map((w) => (w <= lo ? s.v[0] : w >= hi ? s.v[s.v.length - 1] : at.has(w) ? (at.get(w) as number) : f(w)));
}

const range = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let w = a; w <= b + 1e-9; w += step) out.push(w);
  return out;
};

/** Summation over a grid (1 or 5 nm) of R·S·CMF with k = 100/ΣS·ȳ·Δλ (colour.sd_to_XYZ_integration). */
function integrate(R: number[], S: number[], cmf: { x: number[]; y: number[]; z: number[] }, dw: number): { XYZ: Vec3; white: Vec3 } {
  let X = 0, Y = 0, Z = 0, Xw = 0, Yw = 0, Zw = 0;
  for (let i = 0; i < R.length; i++) {
    const s = S[i];
    X += R[i] * s * cmf.x[i];
    Y += R[i] * s * cmf.y[i];
    Z += R[i] * s * cmf.z[i];
    Xw += s * cmf.x[i];
    Yw += s * cmf.y[i];
    Zw += s * cmf.z[i];
  }
  const k = 100 / (Yw * dw);
  return { XYZ: [k * X * dw, k * Y * dw, k * Z * dw], white: [k * Xw * dw, 100, k * Zw * dw] };
}

/** colour.algebra.lagrange_coefficients(r, n): the Lagrange basis at r over the nodes 0 … n − 1. */
function lagrange(r: number, n: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    let p = 1;
    for (let i = 0; i < n; i++) if (i !== j) p *= (r - i) / (j - i);
    out.push(p);
  }
  return out;
}

/**
 * ASTM E2022 tristimulus weighting factors at a 10 nm interval over 360–780 nm, built from the 1 nm CMFs and the 1 nm
 * illuminant with third-order (boundary) and fourth-order (inner) Lagrange interpolation coefficients
 * (colour.colorimetry.tristimulus_weighting_factors_ASTME2022, transcribed loop for loop). Normalised so the
 * perfect white has Y = 100.
 */
export function weightingFactors10(ill: IlluminantId, obs: Observer): Vec3[] {
  const cmf = cmfTable(obs);
  const S = illuminant1nm(ill);
  const Ycmf = [cmf.x, cmf.y, cmf.z];
  const interval = 10;
  const wC = S.length; // 421
  const W: Vec3[] = [];
  for (let j = 0; j < wC; j += interval) W.push([S[j] * cmf.x[j], S[j] * cmf.y[j], S[j] * cmf.z[j]]);
  const rN = (inner: boolean): number[][] => {
    const out: number[][] = [];
    for (let k = 1; k < interval; k++) out.push(lagrange(k / interval + (inner ? 1 : 0), inner ? 4 : 3));
    return out;
  };
  const cc = rN(false);
  const cb = rN(true);
  const rC = cb.length; // 9
  const wLif = wC - ((wC - 1) % interval) - 1 - rC;
  const iC = W.length;
  const iCm = iC - 1;
  for (let i = 0; i < 3; i++) {
    const Yi = Ycmf[i];
    for (let h = 0; h < rC; h++) for (let g = 0; g < 3; g++) W[g][i] += cc[h][g] * S[h + 1] * Yi[h + 1];
    for (let h = 0; h < rC; h++) for (let g = iCm; g > iCm - 3; g--) W[g][i] += cc[rC - h - 1][iCm - g] * S[h + wLif] * Yi[h + wLif];
    for (let h = 0; h < iC - 3; h++) {
      for (let g = 0; g < rC; g++) {
        const wi = (rC + 1) * (h + 1) + 1 + g;
        const sy = S[wi] * Yi[wi];
        W[h][i] += cb[g][0] * sy;
        W[h + 1][i] += cb[g][1] * sy;
        W[h + 2][i] += cb[g][2] * sy;
        W[h + 3][i] += cb[g][3] * sy;
      }
    }
    for (let h = wC - ((wC - 1) % interval); h < wC; h++) W[iCm][i] += S[h] * Yi[h];
  }
  const k = 100 / W.reduce((s, w) => s + w[1], 0);
  return W.map((w) => [w[0] * k, w[1] * k, w[2] * k]);
}

export interface SpectralXYZ {
  ok: true;
  XYZ: Vec3;
  /** The perfect reflecting diffuser computed the same way (the white for L*a*b*). */
  white: Vec3;
  /** What was done, in words: the method branch, the grid and any extension. */
  path: string;
  notes: string[];
}

/**
 * Tristimulus values of a reflectance (or transmittance) spectrum under an illuminant, as colour.sd_to_XYZ does with
 * the CMFs trimmed to 360–780 nm:
 *   - "astm-e308" (colour's default, ASTM E308-15): 1 nm data are summed at 1 nm; 5 nm data at 5 nm; 10 nm data with
 *     the ASTM E2022 weighting factors, the weights outside the measured range folded into its end wavelengths (E308
 *     Table 6 practice); 20 nm data are first brought to 10 nm by E308's four-point Lagrange step. 10 or 20 nm data
 *     that do not start and end on a multiple of 10 nm are Sprague-interpolated to 1 nm and summed, as colour does.
 *   - "integration" (CIE 15): the data are Sprague-interpolated to 1 nm (CIE 167) and summed.
 * Outside the measured range the end values are held constant (CIE 15's recommendation), in both methods.
 */
export function spectrumToXYZ(input: Spectrum, ill: IlluminantId, obs: Observer, method: SpectralMethod): SpectralXYZ | { ok: false; error: string } {
  const s: Spectrum = { wl: input.wl.slice(), v: input.v.slice() };
  const chk = checkSpectrum(s);
  if (!chk.ok) return chk;
  const notes = chk.notes.slice();
  const step = chk.step;
  const cmf = cmfTable(obs);
  const S1 = illuminant1nm(ill);
  const grid1 = range(CMF_START, CMF_END, 1);
  const cmf1 = { x: cmf.x.slice(), y: cmf.y.slice(), z: cmf.z.slice() };
  const lo = s.wl[0];
  const hi = s.wl[s.wl.length - 1];
  const held = lo > CMF_START || hi < CMF_END ? ` Outside ${lo}–${hi} nm the end values are held constant to fill ${CMF_START}–${CMF_END} nm.` : "";
  const at1nm = (why: string): SpectralXYZ => {
    const R = alignSpectrum(s, grid1);
    const r = integrate(R, S1, cmf1, 1);
    return { ok: true, ...r, path: why + held, notes };
  };
  if (method === "integration") return at1nm(`CIE 15 summation at 1 nm over ${CMF_START}–${CMF_END} nm, the ${step} nm data interpolated by Sprague's method (CIE 167).`);
  const isInt = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-9;
  if (Math.abs(step - 1) < 1e-9) return at1nm(`ASTM E308: 1 nm data summed at 1 nm over ${CMF_START}–${CMF_END} nm.`);
  if (Math.abs(step - 5) < 1e-9) {
    if (!isInt(lo / 5)) return { ok: false, error: `ASTM E308 sums 5 nm data on the 5 nm grid (360, 365, …), and these start at ${lo} nm. Choose the CIE 15 integration method (Sprague interpolation to 1 nm) instead.` };
    const grid5 = range(CMF_START, CMF_END, 5);
    const idx = grid5.map((w) => w - CMF_START);
    const R = alignSpectrum(s, grid5);
    const r = integrate(R, idx.map((i) => S1[i]), { x: idx.map((i) => cmf.x[i]), y: idx.map((i) => cmf.y[i]), z: idx.map((i) => cmf.z[i]) }, 5);
    return { ok: true, ...r, path: `ASTM E308: 5 nm data summed at 5 nm over ${CMF_START}–${CMF_END} nm (the CIE 5 nm CMFs).${held}`, notes };
  }
  if (Math.abs(step - 10) > 1e-9 && Math.abs(step - 20) > 1e-9) {
    return { ok: false, error: `ASTM E308 defines its calculation for 1, 5, 10 or 20 nm data; this is ${step} nm. Choose the CIE 15 integration method (Sprague interpolation to 1 nm) instead.` };
  }
  if (!isInt(lo / 10) || !isInt(hi / 10)) {
    return at1nm(`ASTM E308 does not define ${step} nm data that start or end off a multiple of 10 nm (${lo}–${hi} nm); as colour-science does, they were Sprague-interpolated to 1 nm and summed at 1 nm.`);
  }
  // Trim to 360–780 nm.
  let wl = s.wl.filter((w) => w >= CMF_START - 1e-9 && w <= CMF_END + 1e-9);
  let v = s.v.filter((_, i) => s.wl[i] >= CMF_START - 1e-9 && s.wl[i] <= CMF_END + 1e-9);
  const trimmed = wl.length < s.wl.length ? ` Data outside ${CMF_START}–${CMF_END} nm were not used.` : "";
  let how = "10 nm data weighted by ASTM E2022 tristimulus weighting factors (10 nm, built from the 1 nm CMFs and illuminant)";
  if (Math.abs(step - 20) < 1e-9) {
    // ASTM E308 §7.3: 20 nm → 10 nm by the four-point Lagrange step, with a quadratic extrapolation 20 nm beyond each end.
    const n = v.length;
    const ext = [3 * v[0] - 3 * v[1] + v[2], ...v, v[n - 3] - 3 * v[n - 2] + 3 * v[n - 1]];
    const out: number[] = [];
    for (let j = 1; j < ext.length - 1; j++) {
      out.push(ext[j]);
      if (j < ext.length - 2) out.push(-0.0625 * ext[j - 1] + 0.5625 * ext[j] + 0.5625 * ext[j + 1] - 0.0625 * ext[j + 2]);
    }
    v = out;
    wl = range(wl[0], wl[wl.length - 1], 10);
    how = "20 nm data brought to 10 nm by ASTM E308's four-point Lagrange interpolation, then weighted by ASTM E2022 10 nm factors";
  }
  const W = weightingFactors10(ill, obs);
  const startIdx = Math.round((wl[0] - CMF_START) / 10);
  const endIdx = Math.round((CMF_END - wl[wl.length - 1]) / 10);
  const Wa = W.map((w) => [w[0], w[1], w[2]] as Vec3);
  for (let i = 0; i < startIdx; i++) for (let c = 0; c < 3; c++) Wa[startIdx][c] += Wa[i][c];
  for (let i = 0; i < endIdx; i++) for (let c = 0; c < 3; c++) Wa[Wa.length - endIdx - 1][c] += Wa[Wa.length - 1 - i][c];
  const Wt = Wa.slice(startIdx, Wa.length - endIdx);
  const XYZ: Vec3 = [0, 0, 0];
  const white: Vec3 = [0, 0, 0];
  for (let i = 0; i < Wt.length; i++) {
    for (let c = 0; c < 3; c++) {
      XYZ[c] += Wt[i][c] * v[i];
      white[c] += Wt[i][c];
    }
  }
  const folded = startIdx || endIdx ? ` The weights for ${CMF_START}–${CMF_END} nm outside ${wl[0]}–${wl[wl.length - 1]} nm were added to the end wavelengths (ASTM E308 practice).` : "";
  return { ok: true, XYZ, white, path: `ASTM E308: ${how}.${folded}${trimmed}`, notes };
}

/** The spectral locus in CIE 1931 xy for the observer, 360–780 nm at 1 nm. */
export function spectralLocus(obs: Observer): Array<{ wl: number; x: number; y: number }> {
  const c = cmfTable(obs);
  return c.x.map((x, i) => {
    const s = x + c.y[i] + c.z[i];
    return { wl: CMF_START + i, x: x / s, y: c.y[i] / s };
  });
}

/**
 * Whether a chromaticity lies inside the horseshoe (spectral locus closed by the purple line) of the observer, to
 * 10⁻⁶ in xy. Outside it, a colour has no real spectrum: it is a typing slip or an imaginary colour.
 */
export function insideLocus(xy: [number, number], obs: Observer): boolean {
  const p = spectralLocus(obs);
  let inside = false;
  let near = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a.y > xy[1] !== b.y > xy[1] && xy[0] < ((b.x - a.x) * (xy[1] - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((xy[0] - a.x) * dx + (xy[1] - a.y) * dy) / L2)) : 0;
    near = Math.min(near, Math.hypot(xy[0] - (a.x + t * dx), xy[1] - (a.y + t * dy)));
  }
  return inside || near < 1e-6;
}

export interface DominantResult {
  ok: true;
  /** Dominant wavelength (nm) for a spectral hue; for a purple, the NEGATIVE of the complementary wavelength (CIE). */
  wavelength: number;
  purple: boolean;
  /** Where the line from the white through the colour meets the locus or the purple line. */
  xyBoundary: [number, number];
  /** The locus point of the (complementary) wavelength reported. */
  xyLocus: [number, number];
  /** Excitation purity: distance white→colour over white→boundary. */
  purity: number;
}

function segIntersect(p1: number[], p2: number[], p3: number[], p4: number[]): [number, number] | null {
  const d = (p4[1] - p3[1]) * (p2[0] - p1[0]) - (p4[0] - p3[0]) * (p2[1] - p1[1]);
  if (d === 0) return null;
  const ua = ((p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0])) / d;
  const ub = ((p2[0] - p1[0]) * (p1[1] - p3[1]) - (p2[1] - p1[1]) * (p1[0] - p3[0])) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return [p1[0] + ua * (p2[0] - p1[0]), p1[1] + ua * (p2[1] - p1[1])];
}

/**
 * Dominant (or complementary) wavelength and excitation purity (CIE 15; colour.dominant_wavelength and
 * excitation_purity with the 360–780 nm CMFs): the line from the white point through the colour is extended to the
 * horseshoe. The wavelength reported is the TABULATED locus wavelength (1 nm) nearest the crossing, as colour-science
 * reports it. A colour whose line meets the purple line has no dominant wavelength; its complementary wavelength is
 * reported with a minus sign. A colour at the white point has neither.
 */
export function dominantWavelength(xy: [number, number], white: [number, number], obs: Observer): DominantResult | { ok: false; error: string } {
  const dx = xy[0] - white[0];
  const dy = xy[1] - white[1];
  const dist = Math.hypot(dx, dy);
  if (!(dist > 1e-9)) return { ok: false, error: "The colour is at the white point (achromatic): it has no dominant wavelength and zero purity." };
  const locus = spectralLocus(obs);
  const pts = locus.map((p) => [p.x, p.y]);
  const closed = [...pts, pts[0]];
  // The segment runs from the white point to one unit beyond `through`, in the direction from → through
  // (colour.geometry.extend_line_segment): white → colour for the dominant, colour → white for the complementary.
  const crossing = (from: number[], through: number[]): [number, number] | null => {
    const d = Math.hypot(through[0] - from[0], through[1] - from[1]);
    const far = [through[0] + (through[0] - from[0]) / d, through[1] + (through[1] - from[1]) / d];
    const hits: Array<[number, number]> = [];
    for (let k = 0; k < closed.length; k++) {
      const a = closed[k];
      const b = closed[(k - 1 + closed.length) % closed.length];
      const p = segIntersect(white, far, a, b);
      if (p) hits.push(p);
    }
    if (!hits.length) return null;
    // colour-science sorts the crossings' x and y independently and takes the smallest of each.
    return [Math.min(...hits.map((h) => h[0])), Math.min(...hits.map((h) => h[1]))];
  };
  const nearest = (p: [number, number]): number => {
    let best = 0;
    let bd = Infinity;
    pts.forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const boundary = crossing(white, xy);
  if (!boundary) return { ok: false, error: "The line from the white point through this colour does not meet the spectral locus." };
  const far = [xy[0] + dx / dist, xy[1] + dy / dist];
  const purple = segIntersect(white, far, pts[0], pts[pts.length - 1]) !== null;
  let iWl = nearest(boundary);
  let wavelength = locus[iWl].wl;
  if (purple) {
    const comp = crossing(xy, white);
    if (!comp) return { ok: false, error: "The complementary wavelength of this purple could not be found." };
    iWl = nearest(comp);
    wavelength = -locus[iWl].wl;
  }
  const purity = dist / Math.hypot(boundary[0] - white[0], boundary[1] - white[1]);
  return { ok: true, wavelength, purple, xyBoundary: boundary, xyLocus: [locus[iWl].x, locus[iWl].y], purity };
}

// ---------------------------------------------------------------------------------------------------------------
// Whiteness, tint, yellowness
// ---------------------------------------------------------------------------------------------------------------

export interface WhitenessResult {
  W: number;
  T: number;
  /** Within CIE 15's limits for the formula: 40 < W < 5Y − 280 and −4 < T < +2. */
  inRange: boolean;
  outOfRange: string[];
}

/**
 * CIE whiteness and tint (CIE 15:2004; colour.colorimetry.whiteness_CIE2004): W = Y + 800(xₙ − x) + 1700(yₙ − y),
 * T = 1000(xₙ − x) − 650(yₙ − y) for 2° (900 for 10°). Defined for D65; the white is the perfect diffuser's xy.
 */
export function cieWhiteness(XYZ: Vec3, whiteXy: [number, number], obs: Observer): WhitenessResult | null {
  const xy = XYZToxy(XYZ);
  if (!xy) return null;
  const Y = XYZ[1];
  const W = Y + 800 * (whiteXy[0] - xy[0]) + 1700 * (whiteXy[1] - xy[1]);
  const T = (obs === "2" ? 1000 : 900) * (whiteXy[0] - xy[0]) - 650 * (whiteXy[1] - xy[1]);
  const out: string[] = [];
  if (!(W > 40)) out.push("W is not above 40");
  if (!(W < 5 * Y - 280)) out.push(`W is not below 5Y − 280 = ${(5 * Y - 280).toFixed(2)}`);
  if (!(T > -4 && T < 2)) out.push("T is outside −4 to +2");
  return { W, T, inRange: out.length === 0, outOfRange: out };
}

/** ASTM E313 yellowness index YI = 100(C_X·X − C_Z·Z)/Y for illuminant C or D65 and either observer. */
export function yellownessE313(XYZ: Vec3, ill: "C" | "D65", obs: Observer): number {
  const [cx, cz] = E313_COEFFICIENTS[obs][ill];
  return (100 * (cx * XYZ[0] - cz * XYZ[2])) / XYZ[1];
}

/** ASTM D1925 (withdrawn 1995) yellowness index YI = 100(1.28X − 1.06Z)/Y, defined for illuminant C, 2° only. */
export function yellownessD1925(XYZ: Vec3): number {
  return (100 * (1.28 * XYZ[0] - 1.06 * XYZ[2])) / XYZ[1];
}

// ---------------------------------------------------------------------------------------------------------------
// Metamerism
// ---------------------------------------------------------------------------------------------------------------

export type MetamerismCorrection = "additive" | "multiplicative" | "none";

/**
 * The CIE special metamerism index for a change of illuminant (CIE 15; ISO 18314-4; colour.difference
 * Lab_to_metamerism_index and XYZ_to_metamerism_index). A pair that does not match exactly under the reference is
 * corrected first: "additive" subtracts the reference difference in L*a*b* (the CIE/ISO default); "multiplicative"
 * scales the sample's XYZ by the standard/sample ratio under the reference.
 */
export function metamerismIndex(
  f: DeFormula,
  correction: MetamerismCorrection,
  stdRef: { XYZ: Vec3; white: Vec3 },
  smpRef: { XYZ: Vec3; white: Vec3 },
  stdTest: { XYZ: Vec3; white: Vec3 },
  smpTest: { XYZ: Vec3; white: Vec3 },
  k: ParametricK = { kL: 1, kC: 1, kH: 1 },
): number {
  const LabStdT = XYZToLab(stdTest.XYZ, stdTest.white);
  if (correction === "multiplicative") {
    const corr: Vec3 = [0, 1, 2].map((i) => smpTest.XYZ[i] * (stdRef.XYZ[i] / smpRef.XYZ[i])) as Vec3;
    return deltaE(f, LabStdT, XYZToLab(corr, smpTest.white), k);
  }
  const LabSmpT = XYZToLab(smpTest.XYZ, smpTest.white);
  if (correction === "none") return deltaE(f, LabStdT, LabSmpT, k);
  const LabSmpR = XYZToLab(smpRef.XYZ, smpRef.white);
  const LabStdR = XYZToLab(stdRef.XYZ, stdRef.white);
  const corr: Lab = { L: LabSmpT.L - (LabSmpR.L - LabStdR.L), a: LabSmpT.a - (LabSmpR.a - LabStdR.a), b: LabSmpT.b - (LabSmpR.b - LabStdR.b) };
  return deltaE(f, LabStdT, corr, k);
}

// ---------------------------------------------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------------------------------------------

/**
 * WCAG 2.x relative luminance of an 8-bit sRGB colour: 0.2126R + 0.7152G + 0.0722B on linearised channels. The
 * linearisation threshold is 0.04045 (IEC 61966-2-1; WCAG 2.2's text). WCAG 2.0/2.1 printed 0.03928; no 8-bit value
 * lies between the two (10/255 = 0.0392, 11/255 = 0.0431), so the luminance is identical either way.
 */
export function wcagLuminance(rgb255: Vec3): number {
  const lin = rgb255.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio (L₁ + 0.05)/(L₂ + 0.05), lighter over darker: 1 to 21. */
export function wcagContrast(a: Vec3, b: Vec3): number {
  const la = wcagLuminance(a);
  const lb = wcagLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
