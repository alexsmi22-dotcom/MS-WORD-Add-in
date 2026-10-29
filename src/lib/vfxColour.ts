// VFX & compositing, colour: camera log ↔ scene-linear curves, Porter–Duff compositing and blend modes in linear light
// against display-referred values, and chroma-key distance, alpha and spill suppression in RGB and Y′CbCr.
// Pure functions; the pane glue is vfxCalcs.ts. Colour difference, conversion between colour spaces, chromatic
// adaptation and contrast are the Colour & appearance group's; this file keeps to what a compositor computes.
//
// LOG CURVES. Each is the manufacturer's published formula; a curve stays only where a second source agrees (the
// colour-science 0.4.7 implementation, checked in vfxLog.oracle.test.ts, AND a published code value):
//   ARRI LogC3, EI 800 (ARRI, "ALEXA Log C Curve: Usage in VFX", SUP 3.x, scene-linear exposure): 18 % grey 0.3910.
//   ARRI LogC4 (ARRI, "ARRI LogC4 Logarithmic Color Space Specification"): 18 % grey 0.2784, linear 0 at 95/1023.
//   Sony S-Log3 (Sony, "Technical Summary for S-Gamut3.Cine/S-Log3 and S-Gamut3/S-Log3"): 0 %, 18 %, 90 % at 10-bit
//     95, 420, 598.
//   Panasonic V-Log (Panasonic, "V-Log/V-Gamut Reference Manual"): 0 %, 18 %, 90 % at 10-bit 128, 433, 602.
//   RED Log3G10 (RED, "REDWideGamutRGB and Log3G10" white paper, v3 with the 0.01 offset): 18 % grey at 1/3.
//   ACEScct (Academy S-2016-001) and ACEScc (S-2014-003): 18 % grey 0.4135884 (both, above the toe).
//   Cineon (Kodak, "Conversion of 10-bit Log Film Data to 8-bit Linear or Video Data for the Cineon Digital Film
//     System", v2.1): reference black 95 and white 685, 0.002 density per code value, negative gamma 0.6.
// Canon Log 3 is LEFT OUT: only colour-science's implementation (two differing methods, v1 and v1.2) could be found;
// Canon's own white paper value for 18 % grey could not be read, so it fails the two-source rule.

export interface Err {
  ok: false;
  error: string;
}

export interface LogCurve {
  id: string;
  label: string;
  /** Scene-linear reflectance (0.18 = grey) → normalised code value (×1023 = 10-bit code). */
  encode: (x: number) => number;
  /** Normalised code value → scene linear; null where the curve has no inverse. */
  decode: (y: number) => number | null;
  /** The smallest linear value the curve can encode (−∞ for curves whose toe is a straight line). */
  minLinear: number;
  /** The published reference points used as the second source: [linear, normalised code]. */
  published: Array<[number, number]>;
  source: string;
  /** Range of the stored code values (all of these are full-range: normalised × 1023). */
  note: string;
}

// ARRI LogC3, SUP 3.x, EI 800, linear scene exposure factor.
const C3 = { cut: 0.010591, a: 5.555556, b: 0.052272, c: 0.24719, d: 0.385537, e: 5.367655, f: 0.092809 };
// ARRI LogC4.
const C4a = (2 ** 18 - 16) / 117.45;
const C4b = (1023 - 95) / 1023;
const C4c = 95 / 1023;
const C4s = (7 * Math.log(2) * 2 ** (7 - (14 * C4c) / C4b)) / (C4a * C4b);
const C4t = (2 ** (14 * (-C4c / C4b) + 6) - 64) / C4a;
// Sony S-Log3.
const SL3_KNEE = 171.2102946929;
// Panasonic V-Log.
const VL = { cut1: 0.01, cut2: 0.181, b: 0.00873, c: 0.241514, d: 0.598206 };
// RED Log3G10 v3.
const RL = { a: 0.224282, b: 155.975327, c: 0.01, g: 15.1927 };
// ACES.
const CCT_X = 0.0078125;
const CCT_A = 10.5402377416545;
const CCT_B = 0.0729055341958355;
const CCT_Y = 0.155251141552511;
const HALF_MAX = 65504;
const ACES_TOP = (Math.log2(HALF_MAX) + 9.72) / 17.52;

export const CINEON_DEFAULT = { black: 95, white: 685 };

/** Cineon with a chosen reference black and white (code values 0–1023). */
export function cineonCurve(black: number, white: number): LogCurve {
  const offset = Math.pow(10, ((black - white) * 0.002) / 0.6);
  return {
    id: "cineon",
    label: `Cineon (black ${black}, white ${white})`,
    encode: (x) => {
      const arg = x * (1 - offset) + offset;
      return arg > 0 ? (white + (Math.log10(arg) * 0.6) / 0.002) / 1023 : NaN;
    },
    decode: (y) => (Math.pow(10, ((y * 1023 - white) * 0.002) / 0.6) - offset) / (1 - offset),
    minLinear: -offset / (1 - offset),
    published: [[0, black / 1023], [1, white / 1023]],
    source: "Kodak, Conversion of 10-bit Log Film Data to 8-bit Linear or Video Data for the Cineon Digital Film System (v2.1): reference black and white, 0.002 density per code value, gamma 0.6",
    note: "Cineon printing density: 1.0 linear is the reference white, not the brightest value a negative holds (codes above the white point are highlights).",
  };
}

export const LOG_CURVES: LogCurve[] = [
  {
    id: "logc3",
    label: "ARRI LogC3 (EI 800)",
    encode: (x) => (x > C3.cut ? C3.c * Math.log10(C3.a * x + C3.b) + C3.d : C3.e * x + C3.f),
    decode: (y) => (y > C3.e * C3.cut + C3.f ? (Math.pow(10, (y - C3.d) / C3.c) - C3.b) / C3.a : (y - C3.f) / C3.e),
    minLinear: -Infinity,
    published: [[0.18, 0.391]],
    source: "ARRI, ALEXA Log C Curve: Usage in VFX (SUP 3.x, EI 800, scene-linear exposure factor)",
    note: "LogC3 depends on the exposure index; this is EI 800, the base sensitivity.",
  },
  {
    id: "logc4",
    label: "ARRI LogC4",
    encode: (x) => (x >= C4t ? ((Math.log2(C4a * x + 64) - 6) / 14) * C4b + C4c : (x - C4t) / C4s),
    decode: (y) => (y >= 0 ? (Math.pow(2, (14 * (y - C4c)) / C4b + 6) - 64) / C4a : y * C4s + C4t),
    minLinear: -Infinity,
    published: [[0.18, 0.2784], [0, 95 / 1023]],
    source: "ARRI, ARRI LogC4 Logarithmic Color Space Specification",
    note: "LogC4 is one curve for every exposure index (unlike LogC3).",
  },
  {
    id: "slog3",
    label: "Sony S-Log3",
    encode: (x) => (x >= 0.01125 ? (420 + Math.log10((x + 0.01) / 0.19) * 261.5) / 1023 : ((x * (SL3_KNEE - 95)) / 0.01125 + 95) / 1023),
    decode: (y) => (y >= SL3_KNEE / 1023 ? Math.pow(10, (y * 1023 - 420) / 261.5) * 0.19 - 0.01 : ((y * 1023 - 95) * 0.01125) / (SL3_KNEE - 95)),
    minLinear: -Infinity,
    published: [[0, 95 / 1023], [0.18, 420 / 1023], [0.9, 598 / 1023]],
    source: "Sony, Technical Summary for S-Gamut3.Cine/S-Log3 and S-Gamut3/S-Log3",
    note: "S-Log3 code values are 10-bit full range (the formula writes them directly).",
  },
  {
    id: "vlog",
    label: "Panasonic V-Log",
    encode: (x) => (x < VL.cut1 ? 5.6 * x + 0.125 : VL.c * Math.log10(x + VL.b) + VL.d),
    decode: (y) => (y < VL.cut2 ? (y - 0.125) / 5.6 : Math.pow(10, (y - VL.d) / VL.c) - VL.b),
    minLinear: -Infinity,
    published: [[0, 128 / 1023], [0.18, 433 / 1023], [0.9, 602 / 1023]],
    source: "Panasonic, V-Log/V-Gamut Reference Manual",
    note: "V-Log code values are 10-bit full range.",
  },
  {
    id: "log3g10",
    label: "RED Log3G10",
    encode: (x) => {
      const xc = x + RL.c;
      return xc < 0 ? xc * RL.g : RL.a * Math.log10(xc * RL.b + 1);
    },
    decode: (y) => (y < 0 ? y / RL.g - RL.c : (Math.pow(10, y / RL.a) - 1) / RL.b - RL.c),
    minLinear: -Infinity,
    published: [[0.18, 1 / 3]],
    source: "RED, REDWideGamutRGB and Log3G10 white paper (v3, with the 0.01 black offset): 18 % grey at 1/3, ten stops above it at 1.0",
    note: "Log3G10 places 18 % grey at 1/3 by design.",
  },
  {
    id: "acescct",
    label: "ACEScct",
    encode: (x) => (x <= CCT_X ? CCT_A * x + CCT_B : (Math.log2(x) + 9.72) / 17.52),
    decode: (y) => (y <= CCT_Y ? (y - CCT_B) / CCT_A : y < ACES_TOP ? Math.pow(2, y * 17.52 - 9.72) : HALF_MAX),
    minLinear: -Infinity,
    published: [[0.18, 0.4135884]],
    source: "Academy, ACEScct (S-2016-001)",
    note: "ACEScct is a working space for grading (linear toe, unlike ACEScc); values are not 10-bit camera codes.",
  },
  {
    id: "acescc",
    label: "ACEScc",
    encode: (x) => (x <= 0 ? (-16 + 9.72) / 17.52 : x < 2 ** -15 ? (Math.log2(2 ** -16 + x * 0.5) + 9.72) / 17.52 : (Math.log2(x) + 9.72) / 17.52),
    decode: (y) => (y < (9.72 - 15) / 17.52 ? (Math.pow(2, y * 17.52 - 9.72) - 2 ** -16) * 2 : y < ACES_TOP ? Math.pow(2, y * 17.52 - 9.72) : HALF_MAX),
    minLinear: 0,
    published: [[0.18, 0.4135884]],
    source: "Academy, ACEScc (S-2014-003)",
    note: "ACEScc is pure log above 2⁻¹⁵: every linear value at or below 0 encodes to the same code (−0.3584), so negatives do not survive a round trip.",
  },
];

export function logCurve(id: string, black = CINEON_DEFAULT.black, white = CINEON_DEFAULT.white): LogCurve | null {
  if (id === "cineon") return cineonCurve(black, white);
  return LOG_CURVES.find((c) => c.id === id) ?? null;
}

export type LogInputKind = "linear" | "stops" | "code" | "code10";

export interface LogResult {
  ok: true;
  linear: number;
  /** Stops from 18 % grey; null at or below 0 linear. */
  stops: number | null;
  code: number;
  code10: number;
  /** The code for linear 0 and for 18 % grey. */
  blackCode: number;
  greyCode: number;
  /** The linear value is below 0 (the code is below the curve's black). */
  belowBlack: boolean;
  /** The code is outside the 0–1 range of the stored signal. */
  codeOutside: boolean;
}

export function logConvert(curve: LogCurve, value: number, kind: LogInputKind): LogResult | Err {
  if (!Number.isFinite(value)) return { ok: false, error: "Value: not a finite number." };
  let linear: number;
  let code: number;
  if (kind === "linear" || kind === "stops") {
    if (kind === "stops" && Math.abs(value) > 40) return { ok: false, error: `Stops: ${value} stops from grey is outside ±40.` };
    linear = kind === "linear" ? value : 0.18 * Math.pow(2, value);
    if (linear < curve.minLinear || (curve.id === "acescc" && linear < 0)) {
      return { ok: false, error: `${curve.label} cannot encode ${linear} linear: ${curve.id === "acescc" ? "ACEScc is pure log, so values at or below 0 all collapse to one code; use ACEScct" : `its log has no value below ${curve.minLinear.toPrecision(4)} linear`}.` };
    }
    if (Math.abs(linear) > 1e6) return { ok: false, error: `Linear: ${linear} is outside ±10⁶.` };
    code = curve.encode(linear);
    if (!Number.isFinite(code)) return { ok: false, error: `${curve.label} cannot encode ${linear} linear (below the curve's lowest value).` };
  } else {
    code = kind === "code" ? value : value / 1023;
    if (code < -0.5 || code > 1.5) return { ok: false, error: `Code value: ${kind === "code" ? value : `${value} (10-bit)`} is far outside the 0–1 signal range (allowed −0.5 to 1.5 normalised).` };
    const lin = curve.decode(code);
    if (lin === null || !Number.isFinite(lin)) return { ok: false, error: `${curve.label} has no linear value for code ${code}.` };
    linear = lin;
  }
  const blackCode = curve.encode(0);
  return {
    ok: true,
    linear,
    stops: linear > 0 ? Math.log2(linear / 0.18) : null,
    code,
    code10: code * 1023,
    blackCode,
    greyCode: curve.encode(0.18),
    belowBlack: linear < 0,
    codeOutside: code < 0 || code > 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------------------------------------------

export type RGBA = [number, number, number, number];
export type PorterDuff = "over" | "in" | "out" | "atop" | "xor" | "plus";
export type BlendMode = "multiply" | "screen" | "add" | "difference";

/** IEC 61966-2-1 sRGB encode/decode (extended as an odd function beyond 0–1 for HDR values). */
export function srgbEncode(x: number): number {
  const a = Math.abs(x);
  const e = a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return x < 0 ? -e : e;
}
export function srgbDecode(y: number): number {
  const a = Math.abs(y);
  const l = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
  return y < 0 ? -l : l;
}

/** Porter–Duff on PREMULTIPLIED RGBA (Porter & Duff 1984, "Compositing Digital Images"). */
export function porterDuff(op: PorterDuff, A: RGBA, B: RGBA): RGBA {
  const aA = A[3];
  const aB = B[3];
  const [fa, fb] =
    op === "over" ? [1, 1 - aA]
    : op === "in" ? [aB, 0]
    : op === "out" ? [1 - aB, 0]
    : op === "atop" ? [aB, 1 - aA]
    : op === "xor" ? [1 - aB, 1 - aA]
    : [1, 1];
  return [0, 1, 2, 3].map((i) => A[i] * fa + B[i] * fb) as RGBA;
}

export function blend(mode: BlendMode, a: number, b: number): number {
  switch (mode) {
    case "multiply": return a * b;
    case "screen": return 1 - (1 - a) * (1 - b);
    case "add": return a + b;
    default: return Math.abs(a - b);
  }
}

export interface CompositeResult {
  ok: true;
  /** Both inputs premultiplied, and straight. */
  Apm: RGBA;
  Bpm: RGBA;
  Ast: RGBA;
  Bst: RGBA;
  result: RGBA;
  /** The result unpremultiplied (null where its alpha is 0). */
  resultStraight: RGBA | null;
  /** The input mistaken for the other association, through the same operator. */
  mistake: { kind: "double" | "unpremultiplied"; result: RGBA; delta: [number, number, number] };
  /** Blend of A's colour onto B's, mixed by A's alpha: in linear light, and in sRGB-encoded values (decoded back). */
  blendLinear: [number, number, number];
  blendDisplay: [number, number, number];
  /** Premultiplied colour above alpha (emissive / additive). */
  emissive: boolean;
  plusOver1: boolean;
}

export function composite(A: RGBA, B: RGBA, assoc: "premult" | "straight", op: PorterDuff, mode: BlendMode): CompositeResult | Err {
  for (const [name, px] of [["A", A], ["B", B]] as const) {
    if (!px.every(Number.isFinite)) return { ok: false, error: `${name}: every channel must be a finite number.` };
    if (px[3] < 0 || px[3] > 1) return { ok: false, error: `${name}: alpha ${px[3]} is outside 0 to 1. Alpha is coverage: a fraction of the pixel.` };
    if (px.slice(0, 3).some((c) => c < 0)) return { ok: false, error: `${name}: a negative colour channel (${px.slice(0, 3).join(", ")}) has no light to composite; clamp it first.` };
  }
  const pm = (p: RGBA): RGBA => (assoc === "premult" ? p : [p[0] * p[3], p[1] * p[3], p[2] * p[3], p[3]]);
  const st = (p: RGBA): RGBA => (assoc === "straight" ? p : p[3] > 0 ? [p[0] / p[3], p[1] / p[3], p[2] / p[3], p[3]] : [0, 0, 0, 0]);
  const Apm = pm(A);
  const Bpm = pm(B);
  const result = porterDuff(op, Apm, Bpm);
  const resultStraight: RGBA | null = result[3] > 0 ? [result[0] / result[3], result[1] / result[3], result[2] / result[3], result[3]] : null;
  // The mistake: premultiplied inputs multiplied by alpha again (dark fringe), or straight inputs used as if they were
  // premultiplied (bright fringe / halo).
  const wrongA: RGBA = assoc === "premult" ? [A[0] * A[3], A[1] * A[3], A[2] * A[3], A[3]] : A;
  const wrongB: RGBA = assoc === "premult" ? [B[0] * B[3], B[1] * B[3], B[2] * B[3], B[3]] : B;
  const wrong = porterDuff(op, wrongA, wrongB);
  const Ast = st(A);
  const Bst = st(B);
  const aA = A[3];
  const blendLinear = [0, 1, 2].map((i) => aA * blend(mode, Ast[i], Bst[i]) + (1 - aA) * Bst[i]) as [number, number, number];
  const blendDisplay = [0, 1, 2].map((i) => srgbDecode(aA * blend(mode, srgbEncode(Ast[i]), srgbEncode(Bst[i])) + (1 - aA) * srgbEncode(Bst[i]))) as [number, number, number];
  return {
    ok: true,
    Apm,
    Bpm,
    Ast,
    Bst,
    result,
    resultStraight,
    mistake: { kind: assoc === "premult" ? "double" : "unpremultiplied", result: wrong, delta: [0, 1, 2].map((i) => wrong[i] - result[i]) as [number, number, number] },
    blendLinear,
    blendDisplay,
    emissive: assoc === "premult" && [A, B].some((p) => p.slice(0, 3).some((c) => c > p[3] + 1e-12)),
    plusOver1: op === "plus" && result[3] > 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Chroma key
// ---------------------------------------------------------------------------------------------------------------

export type YcbcrMatrix = "601" | "709";
export const KR_KB: Record<YcbcrMatrix, [number, number]> = { "601": [0.299, 0.114], "709": [0.2126, 0.0722] };

/** Y′CbCr from R′G′B′ (0–1): Y′ in 0–1, Cb and Cr in −0.5 to 0.5 (ITU-R BT.601 / BT.709). */
export function toYCbCr(rgb: [number, number, number], m: YcbcrMatrix): [number, number, number] {
  const [kr, kb] = KR_KB[m];
  const y = kr * rgb[0] + (1 - kr - kb) * rgb[1] + kb * rgb[2];
  return [y, (0.5 * (rgb[2] - y)) / (1 - kb), (0.5 * (rgb[0] - y)) / (1 - kr)];
}

export type KeyMetric = "cbcr" | "rgb";
export type SpillVariant = "average" | "max";

export interface KeyResult {
  ok: true;
  keyYcc: [number, number, number];
  pixYcc: [number, number, number];
  dRgb: number;
  dCbCr: number;
  /** The distance the alpha uses. */
  d: number;
  alpha: number;
  /** The screen channel (1 = green, 2 = blue) and its suppressed value. */
  channel: 1 | 2;
  limit: number;
  suppressed: [number, number, number];
  spill: number;
  /** The other variant's result, for comparison. */
  otherLimit: number;
}

export function chromaKey(key: [number, number, number], pix: [number, number, number], m: YcbcrMatrix, metric: KeyMetric, tol: number, soft: number, screen: "auto" | "green" | "blue", variant: SpillVariant): KeyResult | Err {
  if (![...key, ...pix, tol, soft].every(Number.isFinite)) return { ok: false, error: "Every value must be a finite number." };
  for (const [n, c] of [["Key colour", key], ["Pixel", pix]] as const) if (c.some((v) => v < 0 || v > 1)) return { ok: false, error: `${n}: R′G′B′ (${c.join(", ")}) is outside 0 to 1 (give 0–255 values with the 8-bit scale).` };
  if (tol < 0) return { ok: false, error: "Tolerance: a distance cannot be negative." };
  if (soft < 0) return { ok: false, error: "Softness: a distance cannot be negative." };
  const keyYcc = toYCbCr(key, m);
  const pixYcc = toYCbCr(pix, m);
  const dRgb = Math.hypot(pix[0] - key[0], pix[1] - key[1], pix[2] - key[2]);
  const dCbCr = Math.hypot(pixYcc[1] - keyYcc[1], pixYcc[2] - keyYcc[2]);
  const d = metric === "rgb" ? dRgb : dCbCr;
  const alpha = d <= tol ? 0 : soft === 0 || d >= tol + soft ? 1 : (d - tol) / soft;
  const channel: 1 | 2 = screen === "green" ? 1 : screen === "blue" ? 2 : key[2] > key[1] ? 2 : 1;
  const others = channel === 1 ? [pix[0], pix[2]] : [pix[0], pix[1]];
  const avg = (others[0] + others[1]) / 2;
  const mx = Math.max(others[0], others[1]);
  const limit = variant === "average" ? avg : mx;
  const suppressed = [...pix] as [number, number, number];
  suppressed[channel] = Math.min(pix[channel], limit);
  return { ok: true, keyYcc, pixYcc, dRgb, dCbCr, d, alpha, channel, limit, suppressed, spill: pix[channel] - suppressed[channel], otherLimit: variant === "average" ? mx : avg };
}
