// Video engineering — bitrate budgets, resolution and viewing geometry, HDR
// luminance, quality metrics, and delivery.
//
// WHAT IS NOT HERE. No codec implementation (encoding video in a Word pane is
// not a document-authoring capability), no VMAF or other trained perceptual
// metric (those are fitted models, not formulas, and cannot honestly be
// reimplemented from a description), and — for now — no colour-gamut coverage,
// because that needs the chromaticity primaries of sRGB / Rec.709 / Rec.2020 /
// DCI-P3 and those must be fetched from a citable source and cross-checked in a
// committed test before they ship, exactly as the NASA polynomials in flame.ts
// were. Typing them from recollection would be the one thing this file must not
// do.
//
// COMPRESSION RATIO IS AN INPUT, NEVER A CONSTANT. "H.265 is about half the
// bitrate of H.264" is content-dependent, encoder-dependent and largely
// marketing; a built-in efficiency table would be a plausible wrong answer for
// every clip that is not the one it was measured on.
//
// EXACT WHERE THE STANDARD IS EXACT. Frame rates such as 30000/1001 are
// rationals, so frame counts, samples per frame, shutter times and SDI link
// rates are computed as BigInt fractions (timecode.ts) and rounded only for
// display. Timecode itself lives in timecode.ts.

import {
  FrameRate,
  Rational,
  parseRate,
  rat,
  ratAdd,
  ratCeil,
  ratCmp,
  ratDiv,
  ratFromNumber,
  ratFromText,
  ratIsInteger,
  ratMul,
  ratSub,
  ratToDecimal,
  ratToNumber,
  RATE_LIST,
} from "./timecode";

export interface VideoError {
  ok: false;
  error: string;
}

function finitePositive(pairs: [string, number][]): VideoError | null {
  for (const [name, v] of pairs) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
    if (v <= 0) return { ok: false, error: `The ${name} must be greater than zero.` };
  }
  return null;
}

// --- Bitrate -----------------------------------------------------------------

export type ChromaSubsampling = "4:4:4" | "4:2:2" | "4:2:0";

/**
 * Bits per pixel actually stored, for a given bit depth and subsampling.
 *
 * 4:2:0 IS A 50% REDUCTION, NOT 25%, and this is the number most often got
 * wrong. It halves the chroma resolution horizontally AND vertically, so the
 * two chroma planes together carry a quarter of the samples they would at
 * 4:4:4: three planes become 1 + 0.25 + 0.25 = 1.5 of a plane, against 3. That
 * is half the data. 4:2:2 subsamples horizontally only, giving 2 of 3 planes,
 * a third less.
 */
export function bitsPerPixel(bitDepth: number, chroma: ChromaSubsampling): number {
  const planes = chroma === "4:4:4" ? 3 : chroma === "4:2:2" ? 2 : 1.5;
  return bitDepth * planes;
}

export interface BitrateResult {
  ok: true;
  /** Raw, uncompressed rate, bit/s. */
  uncompressedBps: number;
  /** Rate after the stated compression ratio, bit/s. */
  compressedBps: number;
  bitsPerPixel: number;
  /** Pixels per second through the pipe. */
  pixelRate: number;
  /** Size of a given duration at the compressed rate, bytes — null without one. */
  sizeBytes: number | null;
  /**
   * The ACTIVE-PICTURE rate (same as uncompressedBps): pixels in the picture
   * only. A serial interface carries more — see `sdi`.
   */
  activePictureBps: number;
  /**
   * The SDI link this format travels on, including blanking, when a SMPTE
   * raster is tabulated for it and SDI carries it in the 4:2:2 10-bit mapping;
   * null otherwise (the notes say why).
   */
  sdi: SdiLink | null;
  notes: string[];
}

/** Uncompressed and compressed video bitrate for a format. */
export function bitrate(
  width: number,
  height: number,
  fps: number,
  bitDepth: number,
  chroma: ChromaSubsampling,
  compressionRatio = 1,
  durationSeconds?: number,
): BitrateResult | VideoError {
  const bad = finitePositive([
    ["width", width],
    ["height", height],
    ["frame rate", fps],
    ["bit depth", bitDepth],
    ["compression ratio", compressionRatio],
  ]);
  if (bad) return bad;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { ok: false, error: "Width and height are whole numbers of pixels." };
  }
  if (width > 100000 || height > 100000) return { ok: false, error: "That is larger than any real frame." };
  if (bitDepth > 16) return { ok: false, error: "Bit depth above 16 is not a video format this models." };
  if (compressionRatio < 1) {
    return {
      ok: false,
      error:
        "A compression ratio below 1 would make the file LARGER than uncompressed. Enter the " +
        "factor by which the data shrinks, e.g. 200.",
    };
  }

  const bpp = bitsPerPixel(bitDepth, chroma);
  const pixelRate = width * height * fps;
  const uncompressedBps = pixelRate * bpp;
  const compressedBps = uncompressedBps / compressionRatio;

  let sizeBytes: number | null = null;
  if (durationSeconds !== undefined) {
    const b = finitePositive([["duration", durationSeconds]]);
    if (b) return b;
    sizeBytes = (compressedBps * durationSeconds) / 8;
  }

  const notes: string[] = [
    `${chroma} stores ${bpp / bitDepth} of the three colour planes: ` +
      (chroma === "4:2:0"
        ? "4:2:0 halves chroma resolution BOTH horizontally and vertically, so the two chroma " +
          "planes together carry a quarter of their full-resolution samples. That is a 50% " +
          "reduction overall, not 25% — the commonest arithmetic error here."
        : chroma === "4:2:2"
          ? "4:2:2 halves chroma horizontally only, a third less data than 4:4:4."
          : "4:4:4 keeps full chroma resolution; no subsampling."),
    "The compression ratio is YOUR input. Codec efficiency depends on the content, the encoder " +
      "and the settings, so a built-in figure would be wrong for every clip except the one it " +
      "was measured on.",
  ];
  const link = sdiLinkFor(width, height, fps, bitDepth, chroma);
  if (compressionRatio === 1) {
    const active = `${gbit(uncompressedBps)} Gbit/s`;
    if (link.sdi) {
      const s = link.sdi;
      notes.push(
        `No compression applied — this is the ACTIVE-PICTURE data rate, ${active}. A serial digital interface ` +
          `(SDI) carries more: it also carries the blanking of the full raster. ${s.rasterStandard} puts ` +
          `${width}×${height} at ${s.rateId} frames/s in a ${s.totalW}×${s.totalH} raster, so the link runs at ` +
          `${gbit(s.lineRateBps)} Gbit/s (${s.sdiClass}), ${s.overheadPct.toFixed(2)}% more than the picture. ` +
          "Size a link, router port or recorder input from the link rate, not the picture rate.",
      );
    } else {
      notes.push(
        `No compression applied — this is the ACTIVE-PICTURE data rate, ${active}. A serial digital interface also ` +
          "carries blanking, so its link rate is higher than this. " +
          link.why,
      );
    }
  }
  if (link.sdi && link.sdi.carriedAs) notes.push(link.sdi.carriedAs);
  notes.push(
    "Frame rate here means complete frames per second: 1080i59.94 is 29.97 frames (59.94 fields) per second.",
  );
  return {
    ok: true,
    uncompressedBps,
    compressedBps,
    bitsPerPixel: bpp,
    pixelRate,
    sizeBytes,
    activePictureBps: uncompressedBps,
    sdi: link.sdi,
    notes,
  };
}

/** Gbit/s text from bit/s: exact up to 5 places, "…" when it does not terminate. */
function gbit(bps: number | Rational): string {
  const r = typeof bps === "number" ? ratFromNumber(bps) : bps;
  if (!r) return String(bps);
  return ratToDecimal(ratDiv(r, rat(1_000_000_000)), 5).text;
}

// --- SDI rasters (blanking included) ---------------------------------------

/**
 * Total raster (active + blanking) per SMPTE standard, by nominal frame rate.
 * Every row is self-checked in the tests: totalW × totalH × fps × 20 bits must
 * land EXACTLY on an SDI class rate (270 Mbit/s, 1.485, 2.97, 5.94 or
 * 11.88 Gbit/s, ×1000/1001 at the fractional rates) — a transcription slip
 * cannot pass that.
 */
interface RasterDef {
  w: number;
  h: number;
  standard: string;
  totalH: number;
  /** nominal frame rate → total samples per line */
  totalW: Record<number, number>;
  /** Only these exact rates exist for the raster (SD is 29.97 or 25 only). */
  fractionalOnly?: boolean;
  integerOnly?: boolean;
}

const RASTERS: RasterDef[] = [
  { w: 1920, h: 1080, standard: "SMPTE ST 274", totalH: 1125, totalW: { 60: 2200, 30: 2200, 50: 2640, 25: 2640, 24: 2750 } },
  { w: 1280, h: 720, standard: "SMPTE ST 296", totalH: 750, totalW: { 60: 1650, 30: 3300, 50: 1980, 25: 3960, 24: 4125 } },
  {
    w: 3840,
    h: 2160,
    standard: "SMPTE ST 2036-1 (2 × the ST 274 raster each way)",
    totalH: 2250,
    totalW: { 60: 4400, 30: 4400, 50: 5280, 25: 5280, 24: 5500 },
  },
  { w: 720, h: 486, standard: "SMPTE ST 125 / ITU-R BT.656 (525-line)", totalH: 525, totalW: { 30: 858 }, fractionalOnly: true },
  { w: 720, h: 480, standard: "SMPTE ST 125 / ITU-R BT.656 (525-line)", totalH: 525, totalW: { 30: 858 }, fractionalOnly: true },
  { w: 720, h: 576, standard: "ITU-R BT.656 (625-line)", totalH: 625, totalW: { 25: 864 }, integerOnly: true },
];

/** SDI line-rate classes, bit/s (each ×1000/1001 variant listed separately). */
const SDI_CLASSES: { name: string; bps: Rational }[] = (() => {
  const base: [string, number][] = [
    ["SD-SDI, SMPTE ST 259", 270_000_000],
    ["HD-SDI, SMPTE ST 292-1", 1_485_000_000],
    ["3G-SDI, SMPTE ST 424", 2_970_000_000],
    ["6G-SDI, SMPTE ST 2081-1", 5_940_000_000],
    ["12G-SDI, SMPTE ST 2082-1", 11_880_000_000],
  ];
  const out: { name: string; bps: Rational }[] = [];
  for (const [name, b] of base) {
    if (b !== 270_000_000) out.push({ name: `${name}, ${gbitPlain(b)}/1.001 Gbit/s`, bps: rat(b * 1000, 1001) });
    out.push({ name: `${name}, ${gbitPlain(b)} Gbit/s`, bps: rat(b) });
  }
  return out.sort((a, b) => ratCmp(a.bps, b.bps));
})();

function gbitPlain(b: number): string {
  return String(b / 1e9);
}

export interface SdiLink {
  rasterStandard: string;
  rateId: string;
  totalW: number;
  totalH: number;
  /** Link rate, bit/s (exact value in lineRate). */
  lineRateBps: number;
  lineRate: Rational;
  /** Active picture at 20 bits/pixel (4:2:2 10-bit), bit/s. */
  activeRateBps: number;
  /** Blanking overhead over the active picture, %. */
  overheadPct: number;
  /** The SDI class the rate equals (or the smallest that holds it). */
  sdiClass: string;
  sdiClassBps: number;
  exactClass: boolean;
  /** Said when the source format is not itself 4:2:2 10-bit. */
  carriedAs: string | null;
}

/** Look up the SDI link for a format; `why` explains a null. */
export function sdiLinkFor(
  width: number,
  height: number,
  fps: number | string,
  bitDepth = 10,
  chroma: ChromaSubsampling = "4:2:2",
): { sdi: SdiLink | null; why: string } {
  if (chroma === "4:4:4" || bitDepth > 10) {
    return {
      sdi: null,
      why:
        `${chroma} ${bitDepth}-bit does not travel in the single-link 4:2:2 10-bit mapping; it needs another SDI ` +
        "mapping (dual link, SMPTE ST 372, or the ST 425-1 level A/B mappings), which is not modelled here, so no " +
        "link figure is given.",
    };
  }
  const r = parseRate(fps);
  if (!r.ok) {
    return {
      sdi: null,
      why: `No SMPTE raster is tabulated here at ${fps} frames/s (rasters are listed for 23.976–60), so no link figure is given.`,
    };
  }
  const def = RASTERS.find((d) => d.w === width && d.h === height);
  const tw = def ? def.totalW[r.nominal] : undefined;
  if (!def || tw === undefined || (def.fractionalOnly && !r.fractional) || (def.integerOnly && r.fractional)) {
    return {
      sdi: null,
      why:
        `No SMPTE raster is tabulated here for ${width}×${height} at ${r.id} frames/s (tabulated: 1920×1080, ` +
        "1280×720, 3840×2160, 720×486/480 at 29.97, 720×576 at 25), so no link figure is given.",
    };
  }
  const link = interfaceRate(width, height, r, tw, def.totalH, 20);
  if (!link.ok) return { sdi: null, why: link.error };
  let carriedAs: string | null = null;
  if (chroma === "4:2:0") {
    carriedAs = "SDI has no 4:2:0 mapping: a 4:2:0 source travels as 4:2:2 10-bit, so the link rate is the 4:2:2 one.";
  } else if (bitDepth < 10) {
    carriedAs = `SDI carries ${bitDepth}-bit samples in 10-bit words, so the link rate is the 10-bit one.`;
  }
  return {
    sdi: {
      rasterStandard: def.standard,
      rateId: r.id,
      totalW: tw,
      totalH: def.totalH,
      lineRateBps: link.lineRateBps,
      lineRate: link.lineRate,
      activeRateBps: link.activeRateBps,
      overheadPct: link.overheadPct,
      sdiClass: link.sdiClass ? link.sdiClass.name : "above 12G-SDI",
      sdiClassBps: link.sdiClass ? link.sdiClass.bps : NaN,
      exactClass: link.sdiClass ? link.sdiClass.exact : false,
      carriedAs,
    },
    why: "",
  };
}

export interface InterfaceRateResult {
  ok: true;
  rate: FrameRate | null;
  activeRateBps: number;
  lineRate: Rational;
  lineRateBps: number;
  /** Blanking over active, %. */
  overheadPct: number;
  /** Smallest SDI class ≥ the link rate (exact when equal), or null above 12G. */
  sdiClass: { name: string; bps: number; exact: boolean } | null;
  figure: { bars: { label: string; bps: number }[] };
  notes: string[];
}

/**
 * Interface (link) rate of a raster including blanking:
 * totalW × totalH × fps × bitsPerPixel, exact for 1000/1001 rates.
 * 4:2:2 10-bit is 20 bits per pixel (10-bit Y′ every pixel, Cb/Cr alternating).
 */
export function interfaceRate(
  activeW: number,
  activeH: number,
  fpsIn: number | string | FrameRate,
  totalW: number,
  totalH: number,
  bitsPerPx = 20,
): InterfaceRateResult | VideoError {
  for (const [n, v] of [["active width", activeW], ["active height", activeH], ["total width", totalW], ["total height", totalH]] as [string, number][]) {
    if (!Number.isInteger(v) || v <= 0 || v > 100000) return { ok: false, error: `The ${n} must be a whole number of samples (1–100000).` };
  }
  if (totalW < activeW || totalH < activeH) {
    return { ok: false, error: "The total raster includes the active picture, so it cannot be smaller than it." };
  }
  if (!Number.isFinite(bitsPerPx) || bitsPerPx <= 0 || bitsPerPx > 64) return { ok: false, error: "Bits per pixel must be between 0 and 64." };
  let rate: FrameRate | null = null;
  let fps: Rational | null;
  if (typeof fpsIn === "object") {
    rate = fpsIn;
    fps = fpsIn.fps;
  } else {
    const p = parseRate(fpsIn);
    if (p.ok) {
      rate = p;
      fps = p.fps;
    } else fps = typeof fpsIn === "number" ? ratFromNumber(fpsIn) : ratFromText(fpsIn);
  }
  if (!fps || fps.num <= 0n || ratToNumber(fps) > 10000) return { ok: false, error: "The frame rate must be a positive number up to 10000." };
  const bpp = ratFromNumber(bitsPerPx)!;
  const lineRate = ratMul(ratMul(rat(totalW * totalH), fps), bpp);
  const active = ratMul(ratMul(rat(activeW * activeH), fps), bpp);
  const overheadPct = ratToNumber(ratDiv(rat(totalW * totalH - activeW * activeH), rat(activeW * activeH))) * 100;
  // The 1/1.001 link rates belong ONLY to the 1/1.001 picture rates, and the
  // integer link rates only to integer picture rates (SMPTE ST 292-1, ST 424,
  // ST 2081-1): a 60 fps signal never runs on a 5.94/1.001 link. SD-SDI's
  // 270 Mbit/s has no 1/1.001 variant and carries the 525-line 29.97 raster,
  // so it is in both families.
  const fractionalPicture = rate ? rate.fractional : fps.den % 1001n === 0n;
  const family = SDI_CLASSES.filter((c) => c.name.startsWith("SD-SDI") || c.name.includes("/1.001") === fractionalPicture);
  const cls = family.find((c) => ratCmp(c.bps, lineRate) >= 0) ?? null;
  const sdiClass = cls ? { name: cls.name, bps: ratToNumber(cls.bps), exact: ratCmp(cls.bps, lineRate) === 0 } : null;
  const notes: string[] = [
    `Link rate = total raster ${totalW}×${totalH} × frame rate × ${bitsPerPx} bits/pixel; the blanking adds ` +
      `${overheadPct.toFixed(2)}% over the ${activeW}×${activeH} picture.`,
  ];
  if (rate && rate.snapNote) notes.push(rate.snapNote);
  if (!sdiClass) notes.push("That is above the 12G-SDI class (11.88 Gbit/s): it needs multiple links or IP transport.");
  else if (!sdiClass.exact) notes.push(`It is not an SDI class rate itself; the smallest class that holds it is ${sdiClass.name}.`);
  return {
    ok: true,
    rate,
    activeRateBps: ratToNumber(active),
    lineRate,
    lineRateBps: ratToNumber(lineRate),
    overheadPct,
    sdiClass,
    figure: {
      bars: [
        { label: "Active picture", bps: ratToNumber(active) },
        { label: "Blanking", bps: ratToNumber(ratSub(lineRate, active)) },
        ...(sdiClass ? [{ label: "SDI class", bps: sdiClass.bps }] : []),
      ],
    },
    notes,
  };
}

export interface RecordTimeResult {
  ok: true;
  seconds: number;
  /** "h:mm:ss" of the recording time. */
  hms: string;
  gbPerHour: number;
  capacityGiB: number;
  notes: string[];
}

/**
 * Recording time on a medium: capacity (bytes, decimal as marketed) × 8 / rate.
 * 100 Mbit/s fills 45 GB per hour; a 128 GB card holds 10240 s, and 128 GB is
 * 119.209 GiB (what an operating system may call "GB").
 */
export function recordTime(rateBps: number, capacityBytes: number): RecordTimeResult | VideoError {
  const bad = finitePositive([["stream rate", rateBps], ["capacity", capacityBytes]]);
  if (bad) return bad;
  const seconds = (capacityBytes * 8) / rateBps;
  const whole = Math.floor(seconds);
  const hms = `${Math.floor(whole / 3600)}:${String(Math.floor(whole / 60) % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  return {
    ok: true,
    seconds,
    hms,
    gbPerHour: (rateBps * 3600) / 8 / 1e9,
    capacityGiB: capacityBytes / 2 ** 30,
    notes: [
      "Capacity is taken in DECIMAL bytes (1 GB = 10⁹ B) as media are sold; the binary figure (GiB, 2³⁰ B) is " +
        "what many operating systems display as \"GB\", about 7% smaller at this scale.",
      "Real cards reserve space for the file system and the recorder may pad its stream, so expect slightly less.",
    ],
  };
}

// --- Resolution and viewing geometry ----------------------------------------

export interface ResolutionResult {
  ok: true;
  pixels: number;
  megapixels: number;
  aspectRatio: number;
  /**
   * Simplified integer aspect of the PIXEL GRID, e.g. "16:9" — the STORAGE
   * aspect. The displayed aspect also depends on the pixel aspect ratio
   * (720×480 stores 3:2 and displays 4:3 or 16:9); see aspect().
   */
  aspectLabel: string;
  /** Same as aspectLabel, under the name that says what it is. */
  storageAspectLabel: string;
  /** The nearest common display-aspect name, e.g. 1366×768 → "16:9" (≈, true 1.7786). */
  nearestCommon: { name: string; value: number; exact: boolean };
  /** Pixels per inch at the given diagonal — null without one. */
  ppi: number | null;
  /** Distance beyond which the pixel grid is unresolvable, m — null without a diagonal. */
  retinaDistanceM: number | null;
  notes: string[];
}

/** Greatest common divisor, for reducing an aspect ratio. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Pixel count, aspect ratio, density and the distance past which more pixels
 * stop being visible.
 *
 * THE EYE IS THE LIMIT, NOT THE PANEL. Normal acuity resolves about one arc
 * minute, so beyond a certain distance-to-size ratio a finer grid changes
 * nothing at all — which is why a 4K phone and a 4K television are very
 * different propositions, and why "more pixels" is a specification claim rather
 * than a viewing one past that point.
 */
export function resolution(
  width: number,
  height: number,
  diagonalInches?: number,
): ResolutionResult | VideoError {
  const bad = finitePositive([["width", width], ["height", height]]);
  if (bad) return bad;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { ok: false, error: "Width and height are whole numbers of pixels." };
  }
  const pixels = width * height;
  const aspectRatio = width / height;
  const g = gcd(width, height);
  const aspectLabel = `${width / g}:${height / g}`;

  let ppi: number | null = null;
  let retinaDistanceM: number | null = null;
  const notes: string[] = [];
  if (diagonalInches !== undefined) {
    const b = finitePositive([["diagonal", diagonalInches]]);
    if (b) return b;
    const diagPixels = Math.hypot(width, height);
    ppi = diagPixels / diagonalInches;
    // One arc minute of visual acuity: pixel pitch subtends 1/60 degree.
    const pitchM = 0.0254 / ppi;
    retinaDistanceM = pitchM / Math.tan((1 / 60) * (Math.PI / 180));
    notes.push(
      `At ${ppi.toFixed(0)} PPI the grid becomes unresolvable to normal acuity beyond about ` +
        `${retinaDistanceM.toFixed(2)} m. Past that distance a finer panel changes nothing that ` +
        "can be seen — the eye is the limit, not the display.",
    );
  }
  notes.push(
    "Acuity of one arc minute is the standard normal figure; sharper eyes and high-contrast " +
      "test patterns both push the distance further out, so treat it as a guide rather than a " +
      "threshold.",
  );
  const nearestCommon = nearestAspectName(rat(width, height));
  notes.push(
    `${aspectLabel} is the STORAGE aspect of the pixel grid. ` +
      (nearestCommon.exact
        ? `It is exactly ${nearestCommon.name}. `
        : `The nearest common name is ${nearestCommon.name} (true ${aspectRatio.toFixed(4)}). `) +
      "The DISPLAYED aspect is storage × pixel aspect: square pixels make them equal, but 720×480 DV/DVD stores " +
      "3:2 and displays 4:3 or 16:9.",
  );
  return {
    ok: true,
    pixels,
    megapixels: pixels / 1e6,
    aspectRatio,
    aspectLabel,
    storageAspectLabel: aspectLabel,
    nearestCommon,
    ppi,
    retinaDistanceM,
    notes,
  };
}

// --- HDR and luminance -------------------------------------------------------

/**
 * SMPTE ST 2084 (PQ) constants, as the EXACT RATIONALS the standard defines
 * them by rather than as decimals.
 *
 * Written this way because they are definitional rather than measured: the
 * standard specifies m1 = 2610/16384 and so on, so the fractions ARE the
 * specification and a decimal would be a lossy transcription of it. The test
 * suite verifies them by a property rather than by comparing digits — PQ(1)
 * must return exactly the 10000 nit peak the curve is defined against, and
 * PQ(0) must return 0. Wrong constants fail that immediately.
 */
const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

/** Peak luminance the PQ curve is defined against, cd/m². */
export const PQ_PEAK_NITS = 10000;

/**
 * PQ signal (0-1) to absolute luminance in nits. A signal above 1 is clamped
 * to 1 (10000 nits): PQ defines nothing above its own ceiling, and the raw
 * formula would return 74,604 nits at 1.2.
 */
export function pqToNits(signal: number): number {
  if (signal <= 0) return 0;
  const e = Math.pow(Math.min(signal, 1), 1 / PQ_M2);
  const num = Math.max(e - PQ_C1, 0);
  const den = PQ_C2 - PQ_C3 * e;
  return PQ_PEAK_NITS * Math.pow(num / den, 1 / PQ_M1);
}

/** Absolute luminance in nits to a PQ signal (0-1); above 10000 nits clamps to 1. */
export function nitsToPq(nits: number): number {
  if (nits <= 0) return 0;
  const y = Math.pow(Math.min(nits, PQ_PEAK_NITS) / PQ_PEAK_NITS, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * y) / (1 + PQ_C3 * y), PQ_M2);
}

export interface HdrResult {
  ok: true;
  peakNits: number;
  blackNits: number;
  contrastRatio: number;
  /** Dynamic range in stops (log2 of the contrast ratio). */
  stops: number;
  /** PQ code value for the peak, 0-1. */
  pqAtPeak: number;
  /** Where this peak sits on the 10000-nit PQ scale, as a percentage of code range. */
  pqHeadroomPct: number;
  notes: string[];
}

/**
 * Display dynamic range and its place on the PQ curve.
 *
 * CONTRAST RATIO IS DOMINATED BY THE BLACK LEVEL, not the peak. Doubling peak
 * brightness doubles the ratio; halving the black level also doubles it, and
 * black levels vary by orders of magnitude between panel technologies while
 * peak brightness varies by a factor of a few. A "1,000,000:1" claim is a
 * statement about black, and is usually measured in a dark room in a way that
 * has little to do with a lit living room.
 */
export function hdrRange(peakNits: number, blackNits: number): HdrResult | VideoError {
  const bad = finitePositive([["peak luminance", peakNits]]);
  if (bad) return bad;
  if (!Number.isFinite(blackNits) || blackNits < 0) {
    return { ok: false, error: "Black level must be zero or greater, in nits." };
  }
  if (peakNits > PQ_PEAK_NITS) {
    return {
      ok: false,
      error:
        `${peakNits} nits is above the ${PQ_PEAK_NITS} nit peak the PQ curve is defined against. ` +
        "No consumer display reaches it; check the figure.",
    };
  }
  if (blackNits >= peakNits) {
    return { ok: false, error: "The black level must be below the peak, or there is no contrast to report." };
  }

  const notes: string[] = [
    "Contrast is dominated by the BLACK level, not the peak: black varies by orders of " +
      "magnitude between panel technologies while peak brightness varies by a factor of a few. " +
      "A headline contrast figure is a claim about black, usually measured in a dark room.",
    `PQ is an ABSOLUTE curve: a code value means a fixed luminance in nits, unlike gamma, which ` +
      "is relative to whatever the display can do. That is why HDR mastering quotes nits at all.",
  ];
  if (blackNits === 0) {
    notes.push(
      "A black level of exactly zero gives an infinite contrast ratio, which is why " +
        "self-emissive panels are quoted as 'infinite' — true in the sense that the pixel is " +
        "off, and not a number you can put in a table.",
    );
  }
  const contrastRatio = blackNits === 0 ? Infinity : peakNits / blackNits;
  const pqAtPeak = nitsToPq(peakNits);
  return {
    ok: true,
    peakNits,
    blackNits,
    contrastRatio,
    stops: blackNits === 0 ? Infinity : Math.log2(contrastRatio),
    pqAtPeak,
    pqHeadroomPct: pqAtPeak * 100,
    notes,
  };
}

// --- Quality metrics ---------------------------------------------------------

export interface PsnrResult {
  ok: true;
  mse: number;
  psnrDb: number;
  bitDepth: number;
  maxValue: number;
  notes: string[];
}

/**
 * PSNR from mean squared error.
 *
 * PSNR IS COMPARABLE ONLY WITHIN ONE CLIP AT ONE RESOLUTION. It measures
 * squared pixel error, which is not what an eye responds to: a small shift of
 * the whole frame scores terribly and looks fine, while a subtle artefact in a
 * face scores well and is obvious. Comparing PSNR across different content is
 * the standard misuse and the number is meaningless that way.
 */
export function psnr(mse: number, bitDepth = 8): PsnrResult | VideoError {
  if (!Number.isFinite(mse) || mse < 0) {
    return { ok: false, error: "Mean squared error must be zero or greater." };
  }
  if (!Number.isInteger(bitDepth) || bitDepth < 1 || bitDepth > 16) {
    return { ok: false, error: "Bit depth must be a whole number from 1 to 16." };
  }
  const maxValue = Math.pow(2, bitDepth) - 1;
  if (mse === 0) {
    return {
      ok: false,
      error:
        "A mean squared error of zero means the images are identical, so PSNR is infinite. " +
        "That is a correct answer and not a useful one — there is nothing to compare.",
    };
  }
  const psnrDb = 10 * Math.log10((maxValue * maxValue) / mse);
  return {
    ok: true,
    mse,
    psnrDb,
    bitDepth,
    maxValue,
    notes: [
      "PSNR compares only WITHIN one piece of content at one resolution. Across different " +
        "clips it is meaningless — squared pixel error is not what an eye responds to, and a " +
        "whole-frame shift scores terribly while looking fine.",
      "Rough guide for 8-bit: above 40 dB is usually indistinguishable, 30-40 dB good, below " +
        "30 dB visibly degraded. These are habits, not thresholds.",
      "No perceptual model is applied. VMAF and similar metrics are trained models rather than " +
        "formulas and are deliberately not reimplemented here.",
    ],
  };
}

// --- Delivery ----------------------------------------------------------------

export interface StreamResult {
  ok: true;
  /** Startup delay to fill the buffer, s. */
  startupDelayS: number;
  /** Seconds of video held by the buffer. */
  bufferSeconds: number;
  /** Headroom: fraction by which bandwidth exceeds the stream rate. */
  headroom: number;
  /** Time to drain the buffer if delivery stops entirely, s. */
  drainS: number;
  notes: string[];
}

/**
 * Startup delay and buffer behaviour for a stream.
 *
 * A BUFFER TRADES LATENCY FOR ROBUSTNESS, and the trade is the whole design.
 * Ten seconds of buffer survives a ten-second outage and costs ten seconds
 * before playback begins; live sport cannot pay that and so cannot ride out the
 * same dropout. There is no setting that gives both.
 */
export function streamBuffer(
  streamBitrateBps: number,
  bandwidthBps: number,
  bufferBytes: number,
): StreamResult | VideoError {
  const bad = finitePositive([
    ["stream bitrate", streamBitrateBps],
    ["available bandwidth", bandwidthBps],
    ["buffer size", bufferBytes],
  ]);
  if (bad) return bad;

  const bufferBits = bufferBytes * 8;
  const bufferSeconds = bufferBits / streamBitrateBps;
  const notes: string[] = [
    "A buffer trades latency for robustness: it survives an outage as long as its own duration, " +
      "and costs that same duration before playback starts. Live content cannot pay it, which " +
      "is exactly why live streams break on a dropout that recorded ones ride out.",
  ];

  if (bandwidthBps <= streamBitrateBps) {
    notes.push(
      "Bandwidth does not exceed the stream rate, so the buffer can never fill and playback " +
        "will stall repeatedly however long you wait. This is a bitrate problem, not a buffer " +
        "problem.",
    );
    return {
      ok: true,
      startupDelayS: Infinity,
      bufferSeconds,
      headroom: bandwidthBps / streamBitrateBps - 1,
      drainS: bufferSeconds,
      notes,
    };
  }

  // The buffer fills at the surplus rate, not the full bandwidth: playback is
  // draining it at the stream rate the whole time.
  const startupDelayS = bufferBits / (bandwidthBps - streamBitrateBps);
  notes.push(
    "Startup delay uses the SURPLUS bandwidth, not the total: playback drains the buffer at the " +
      "stream rate while it fills, so only the excess accumulates.",
  );
  return {
    ok: true,
    startupDelayS,
    bufferSeconds,
    headroom: bandwidthBps / streamBitrateBps - 1,
    drainS: bufferSeconds,
    notes,
  };
}

export interface LatencyStage {
  name: string;
  ms: number;
}

export interface LatencyResult {
  ok: true;
  stages: LatencyStage[];
  totalMs: number;
  /** Total rounded up to whole display refresh intervals, ms. */
  quantisedMs: number;
  /** Whole frames of latency at the display's refresh rate (always an integer). */
  frames: number;
  /** total ÷ frame interval before rounding up (display only). */
  rawFrames: number;
  /** The stage contributing most, for where effort actually pays. */
  worst: LatencyStage;
  notes: string[];
}

/**
 * End-to-end latency, quantised to the display's refresh.
 *
 * THE DISPLAY QUANTISES THE TOTAL, and that is what makes latency budgeting
 * counter-intuitive. A frame appears only at a refresh boundary, so shaving 5 ms
 * off the encoder can change the delivered latency by exactly nothing if the
 * total still lands inside the same refresh interval. Effort belongs wherever it
 * crosses a boundary, which is usually the largest stage rather than the easiest
 * one.
 */
export function latencyBudget(stages: LatencyStage[], refreshHz: number): LatencyResult | VideoError {
  if (!stages.length) return { ok: false, error: "Give at least one stage." };
  if (stages.some((s) => !Number.isFinite(s.ms) || s.ms < 0)) {
    return { ok: false, error: "Every stage must be zero or more milliseconds." };
  }
  const bad = finitePositive([["refresh rate", refreshHz]]);
  if (bad) return bad;

  // EXACT FRAME COUNT. Each stage and the refresh rate are read as the exact
  // decimals they display as (41.67 is 4167/100, not its binary neighbour), the
  // total is summed exactly, and frames = ⌈total × Hz / 1000⌉ in rationals. A
  // total within 1e-9 (relative) of a whole number of frames IS that number —
  // stage values computed upstream in floating point (15 × 1000/23.976) land a
  // hair over the boundary and must not be billed an extra frame.
  const hz = ratFromNumber(refreshHz)!;
  let total = rat(0);
  for (const s of stages) total = ratAdd(total, ratFromNumber(s.ms)!);
  const rawFrames = ratDiv(ratMul(total, hz), rat(1000));
  const rawN = ratToNumber(rawFrames);
  const nearest = Math.round(rawN);
  let frames: number;
  let snapped = false;
  if (nearest > 0 && Math.abs(rawN - nearest) <= 1e-9 * nearest) {
    frames = nearest;
    snapped = ratCmp(rawFrames, rat(nearest)) !== 0;
  } else {
    frames = Number(ratCeil(rawFrames));
  }
  const totalMs = ratToNumber(total);
  const frameMs = 1000 / refreshHz;
  const quantisedMs = ratToNumber(ratDiv(rat(frames * 1000), hz));
  const worst = stages.reduce((a, b) => (b.ms > a.ms ? b : a));

  const notes = [
    `The display refreshes every ${frameMs.toFixed(2)} ms, so the delivered latency is the ` +
      "total rounded UP to the next boundary. Shaving time off a stage changes nothing unless " +
      "it moves the total across one of those boundaries.",
    `"${worst.name}" is the largest stage at ${ratToDecimal(ratFromNumber(worst.ms)!, 3).text} ms — that is where effort pays, ` +
      "rather than wherever is easiest to change.",
    "Network time is treated as a fixed figure here. In reality it is a distribution, and the " +
      "tail is what causes the visible stutter rather than the mean.",
  ];
  if (snapped) {
    notes.push(
      `The total is ${frames} refresh intervals to within 1 part in 10⁹ (rounding in the stage figures), so it ` +
        `is counted as exactly ${frames} — not billed ${frames + 1}, a frame that is not there.`,
    );
  }
  const near1001 = [24, 30, 60, 120].find(
    (n) => Math.abs(refreshHz - (n * 1000) / 1001) < 0.005 && Math.abs(refreshHz / ((n * 1000) / 1001) - 1) > 1e-9,
  );
  if (near1001 !== undefined) {
    notes.push(
      `${ratToDecimal(hz, 6).text} Hz is taken exactly as typed. The broadcast rate it stands for is ${near1001 * 1000}/1001 Hz; the ` +
        "two differ by about 1 ppm, which moves a frame boundary only for a total within 1 ppm of it.",
    );
  }
  return {
    ok: true,
    stages,
    totalMs,
    quantisedMs,
    frames,
    rawFrames: rawN,
    worst,
    notes,
  };
}

// --- Chroma planes -----------------------------------------------------------

export interface ChromaPlanes {
  luma: number;
  /** Samples in EACH of Cb and Cr. */
  chromaEach: number;
  total: number;
  /** Fraction of the 4:4:4 sample count. */
  fractionOf444: number;
}

/**
 * Samples per frame in each plane. Odd dimensions round the chroma plane UP
 * (a 1921-wide 4:2:2 frame still needs 961 chroma columns).
 */
export function chromaPlanes(width: number, height: number, chroma: ChromaSubsampling): ChromaPlanes | VideoError {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 100000 || height > 100000) {
    return { ok: false, error: "Width and height are whole numbers of pixels (1–100000)." };
  }
  const luma = width * height;
  const cw = chroma === "4:4:4" ? width : Math.ceil(width / 2);
  const ch = chroma === "4:2:0" ? Math.ceil(height / 2) : height;
  const chromaEach = cw * ch;
  return { luma, chromaEach, total: luma + 2 * chromaEach, fractionOf444: (luma + 2 * chromaEach) / (3 * luma) };
}

// --- Aspect, pixel aspect and framing ---------------------------------------

/** Parse "10:11", "4:3", "16/9", "2.39", "2.39:1", "1.85 : 1" exactly. */
export function parseRatio(text: string | number): Rational | VideoError {
  if (typeof text === "number") {
    const r = ratFromNumber(text);
    if (!r || r.num <= 0n) return { ok: false, error: "A ratio must be a positive number." };
    return r;
  }
  // The product comma rule: "2,39" is 2.39 (a decimal comma), as everywhere.
  const t = text.trim().replace(/(^|[:/∶]\s*)(\d+),(\d+)(?=\s*(?:[:/∶]|$))/g, "$1$2.$3");
  if (t.length > 40) return { ok: false, error: "That is too long to be a ratio." };
  const m = /^(\d+(?:\.\d+)?)\s*(?:[:/∶]\s*(\d+(?:\.\d+)?))?$/.exec(t);
  if (!m) return { ok: false, error: `"${t}" is not a ratio. Write it as 4:3, 16/9 or 2.39.` };
  const a = ratFromText(m[1]);
  const b = m[2] !== undefined ? ratFromText(m[2]) : rat(1);
  if (!a || !b || a.num === 0n || b.num === 0n) return { ok: false, error: `"${t}": a ratio needs two non-zero parts.` };
  return ratDiv(a, b);
}

/** Parse "1920×1080", "1920x1080", "1920 X 1080", "1920*1080". */
export function parseFrameSize(text: string): { w: number; h: number } | VideoError {
  const t = text.trim();
  const m = /^(\d{1,6})\s*[×xX*]\s*(\d{1,6})$/.exec(t);
  if (!m) return { ok: false, error: `"${t}" is not a frame size. Write width×height, e.g. 1920×1080.` };
  const w = +m[1];
  const h = +m[2];
  if (w <= 0 || h <= 0 || w > 100000 || h > 100000) return { ok: false, error: "Frame width and height must be 1–100000 pixels." };
  return { w, h };
}

const COMMON_ASPECTS: { name: string; r: Rational }[] = [
  { name: "1:1", r: rat(1) },
  { name: "5:4", r: rat(5, 4) },
  { name: "4:3", r: rat(4, 3) },
  { name: "3:2", r: rat(3, 2) },
  { name: "16:10", r: rat(16, 10) },
  { name: "16:9", r: rat(16, 9) },
  { name: "1.85:1", r: rat(185, 100) },
  { name: "1.90:1 (DCI 256:135)", r: rat(256, 135) },
  { name: "2:1", r: rat(2) },
  { name: "64:27 (sold as \"21:9\")", r: rat(64, 27) },
  { name: "2.39:1", r: rat(239, 100) },
  { name: "9:16 (vertical)", r: rat(9, 16) },
];

/** Nearest common aspect by log distance; `exact` when it IS that ratio. */
export function nearestAspectName(r: Rational): { name: string; value: number; exact: boolean } {
  const x = ratToNumber(r);
  let best = COMMON_ASPECTS[0];
  let bestD = Infinity;
  for (const c of COMMON_ASPECTS) {
    const d = Math.abs(Math.log(x / ratToNumber(c.r)));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return { name: best.name, value: ratToNumber(best.r), exact: ratCmp(best.r, r) === 0 };
}

function ratioText(r: Rational): string {
  return `${r.num}:${r.den}`;
}

export interface AspectRect {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AspectResult {
  ok: true;
  /** Storage aspect of the pixel grid, reduced. */
  sar: Rational;
  par: Rational;
  dar: Rational;
  sarText: string;
  parText: string;
  darText: string;
  nearestCommon: { name: string; value: number; exact: boolean };
  /** For 720×480 / 720×576 SD rasters: both pixel-aspect conventions, named. */
  sdConventions: { basis: string; par: string }[] | null;
  /** When a BT.601 (704-basis) pixel aspect is given: the display aspect of the 704-sample picture. */
  darOn704: string | null;
  /** Letterbox or pillarbox of the content aspect in the delivery frame, null without one. */
  framing: {
    frameW: number;
    frameH: number;
    contentAspect: number;
    kind: "letterbox" | "pillarbox" | "none";
    /** Exact active size along the constrained axis (lines or pixels). */
    activeExact: number;
    /** The same rounded to an even number (4:2:0/4:2:2 need even sizes). */
    activeEven: number;
    /** Each bar (top/bottom or left/right) at the even-rounded size. */
    barEach: number;
    /** Each bar at the exact size. */
    barEachExact: number;
  } | null;
  /** SMPTE ST 2046-1 safe areas in the delivery frame (or the storage frame). */
  safe: { actionW: number; actionH: number; titleW: number; titleH: number };
  figure: { frameW: number; frameH: number; rects: AspectRect[] };
  notes: string[];
}

/**
 * Storage aspect × pixel aspect = display aspect, plus letterbox/pillarbox and
 * safe areas. Give the pixel aspect OR the intended display aspect.
 *
 * NTSC/PAL SD HAS TWO PIXEL-ASPECT CONVENTIONS and both are named: computing
 * from the full 720-sample line gives 8:9 (525) and 16:15 (625); ITU-R BT.601
 * defines the picture on 704 active samples, giving 10:11 and 12:11.
 */
export function aspect(input: {
  width: number;
  height: number;
  par?: string | number;
  dar?: string | number;
  frame?: string | { w: number; h: number };
  content?: string | number;
}): AspectResult | VideoError {
  const { width, height } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 100000 || height > 100000) {
    return { ok: false, error: "Width and height are whole numbers of pixels (1–100000)." };
  }
  const hasPar = input.par !== undefined && input.par !== "";
  const hasDar = input.dar !== undefined && input.dar !== "";
  if (hasPar && hasDar) {
    return { ok: false, error: "Give the pixel aspect OR the display aspect, not both — each determines the other." };
  }
  const sar = rat(width, height);
  let par: Rational;
  let dar: Rational;
  if (hasDar) {
    const d = parseRatio(input.dar!);
    if ("ok" in d) return d;
    dar = d;
    par = ratDiv(dar, sar);
  } else if (hasPar) {
    const p = parseRatio(input.par!);
    if ("ok" in p) return p;
    par = p;
    dar = ratMul(sar, par);
  } else {
    par = rat(1);
    dar = sar;
  }
  const notes: string[] = [
    `Storage ${ratioText(sar)} × pixel aspect ${ratioText(par)} = display ${ratioText(dar)} (${ratToNumber(dar).toFixed(4)}).`,
  ];
  let sdConventions: AspectResult["sdConventions"] = null;
  let darOn704: string | null = null;
  if (width === 720 && (height === 480 || height === 486 || height === 576)) {
    const target = hasDar ? dar : null;
    if (target) {
      sdConventions = [
        { basis: "full 720-sample line", par: ratioText(ratDiv(target, sar)) },
        { basis: "ITU-R BT.601 704 active samples", par: ratioText(ratDiv(target, rat(704, height))) },
      ];
      notes.push(
        `SD has two pixel-aspect conventions: ${sdConventions[0].par} from the full 720-sample line and ` +
          `${sdConventions[1].par} from BT.601's 704 active samples (the extra 16 samples are not picture). ` +
          "Both are in use; check which one the file declares.",
      );
    } else if (hasPar) {
      const pt = ratioText(par);
      const basis704: Record<number, string[]> = { 480: ["10:11", "40:33"], 576: ["12:11", "16:11"] };
      const basis720: Record<number, string[]> = { 480: ["8:9", "32:27"], 576: ["16:15", "64:45"] };
      if ((basis704[height] ?? []).includes(pt)) {
        const d704 = ratMul(rat(704, height), par);
        darOn704 = ratioText(d704);
        notes.push(
          `${pt} is the ITU-R BT.601 pixel aspect, defined on the 704 active samples: 704×${height} at ${pt} displays ` +
            `exactly ${darOn704}. Over the full 720-sample line it is ${ratioText(dar)}, because the extra 16 samples lie ` +
            "outside that picture.",
        );
      } else if ((basis720[height] ?? []).includes(pt)) {
        notes.push(`${pt} is the full-720-line pixel aspect: 720×${height} at ${pt} displays exactly ${ratioText(dar)}.`);
      } else {
        notes.push(
          "720-wide SD rasters use one of two pixel-aspect conventions (full 720 line, or BT.601's 704 active samples); " +
            `${pt} is neither standard value for ${height} lines.`,
        );
      }
    } else {
      notes.push(
        "720-wide SD rasters are not square-pixel: give the intended display aspect (4:3 or 16:9) to get the pixel " +
          "aspect under both conventions (full 720 line, or BT.601's 704 active samples).",
      );
    }
  }
  const nearestCommon = nearestAspectName(dar);
  if (!nearestCommon.exact) {
    notes.push(`Display aspect ${ratToNumber(dar).toFixed(4)} is nearest ${nearestCommon.name}, but is not exactly it.`);
  }

  // Framing.
  let frameW = width;
  let frameH = height;
  if (input.frame !== undefined && input.frame !== "") {
    const fr = typeof input.frame === "string" ? parseFrameSize(input.frame) : input.frame;
    if ("ok" in fr) return fr;
    if (!Number.isInteger(fr.w) || !Number.isInteger(fr.h) || fr.w <= 0 || fr.h <= 0) {
      return { ok: false, error: "The delivery frame must be whole pixels." };
    }
    frameW = fr.w;
    frameH = fr.h;
  }
  let framing: AspectResult["framing"] = null;
  const rects: AspectRect[] = [{ label: "Frame", x: 0, y: 0, w: frameW, h: frameH }];
  if (input.content !== undefined && input.content !== "") {
    const c = parseRatio(input.content);
    if ("ok" in c) return c;
    const cx = ratToNumber(c);
    const frameR = rat(frameW, frameH);
    const cmp = ratCmp(c, frameR);
    if (cmp === 0) {
      framing = { frameW, frameH, contentAspect: cx, kind: "none", activeExact: frameH, activeEven: frameH, barEach: 0, barEachExact: 0 };
      rects.push({ label: "Active picture", x: 0, y: 0, w: frameW, h: frameH });
    } else if (cmp > 0) {
      const activeExact = frameW / cx;
      const activeEven = 2 * Math.round(activeExact / 2);
      framing = {
        frameW,
        frameH,
        contentAspect: cx,
        kind: "letterbox",
        activeExact,
        activeEven,
        barEach: (frameH - activeEven) / 2,
        barEachExact: (frameH - activeExact) / 2,
      };
      rects.push({ label: "Active picture", x: 0, y: (frameH - activeEven) / 2, w: frameW, h: activeEven });
      notes.push(
        `Letterbox: ${cx} content in ${frameW}×${frameH} is ${activeExact.toFixed(3)} lines tall exactly; at an even ` +
          `${activeEven} lines the bars are ${framing.barEach} lines each. Square delivery pixels are assumed.`,
      );
    } else {
      const activeExact = frameH * cx;
      const activeEven = 2 * Math.round(activeExact / 2);
      framing = {
        frameW,
        frameH,
        contentAspect: cx,
        kind: "pillarbox",
        activeExact,
        activeEven,
        barEach: (frameW - activeEven) / 2,
        barEachExact: (frameW - activeExact) / 2,
      };
      rects.push({ label: "Active picture", x: (frameW - activeEven) / 2, y: 0, w: activeEven, h: frameH });
      notes.push(
        `Pillarbox: ${ratToNumber(c).toFixed(4)} content in ${frameW}×${frameH} is ${activeExact.toFixed(3)} pixels wide; ` +
          `at ${activeEven} the side bars are ${framing.barEach} pixels each. Square delivery pixels are assumed.`,
      );
    }
  }
  const safe = { actionW: frameW * 0.93, actionH: frameH * 0.93, titleW: frameW * 0.9, titleH: frameH * 0.9 };
  rects.push({ label: "Action safe (93%)", x: (frameW - safe.actionW) / 2, y: (frameH - safe.actionH) / 2, w: safe.actionW, h: safe.actionH });
  rects.push({ label: "Title safe (90%)", x: (frameW - safe.titleW) / 2, y: (frameH - safe.titleH) / 2, w: safe.titleW, h: safe.titleH });
  notes.push(
    `Safe areas (SMPTE ST 2046-1): action ${fmtPx(safe.actionW)}×${fmtPx(safe.actionH)} (93%), graphics/title ` +
      `${fmtPx(safe.titleW)}×${fmtPx(safe.titleH)} (90%), centred.`,
  );
  return {
    ok: true,
    sar,
    par,
    dar,
    sarText: ratioText(sar),
    parText: ratioText(par),
    darText: ratioText(dar),
    nearestCommon,
    sdConventions,
    darOn704,
    framing,
    safe,
    figure: { frameW, frameH, rects },
    notes,
  };
}

function fmtPx(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

// --- Frame rates, audio per frame, pulldown, shutter ------------------------

/** A frame rate from a timecode rate (exact 1000/1001) or any positive number. */
function exactFps(input: string | number): { fps: Rational; rate: FrameRate | null } | VideoError {
  const p = parseRate(input);
  if (p.ok) return { fps: p.fps, rate: p };
  const r = typeof input === "number" ? ratFromNumber(input) : ratFromText(String(input).replace(/\s*(fps|hz|p)\s*$/i, ""));
  if (!r || r.num <= 0n) return { ok: false, error: `"${input}" is not a frame rate.` };
  if (ratToNumber(r) > 100000) return { ok: false, error: "That frame rate is beyond any camera (over 100000 fps)." };
  return { fps: r, rate: null };
}

export interface RateFactsResult {
  ok: true;
  rate: FrameRate;
  fps: Rational;
  fpsText: string;
  frameMs: number;
  /** Audio samples per frame, exact. */
  samplesPerFrame: Rational;
  samplesPerFrameText: string;
  /** Frames in the repeating audio sequence (1 when samples/frame is whole). */
  audioCycleFrames: number | null;
  /** Samples in one sequence (8008 at 29.97 / 48 kHz). */
  audioCycleSamples: number | null;
  /** In one sequence: how many frames carry ⌈s⌉ and ⌊s⌋ samples (order not asserted). */
  audioSplit: { high: number; highCount: number; low: number; lowCount: number } | null;
  /** NDF label drift against the wall clock per real hour, s (0 at integer rates). */
  ndfDriftSPerHour: number;
  dropFrameDefined: boolean;
  notes: string[];
}

/**
 * Facts about a frame rate: exact value, frame duration, audio samples per
 * frame and the repeating sequence (1601.6 at 29.97/48 kHz: five frames sum to
 * 8008 — three of 1602 and two of 1601), and NDF drift.
 */
export function rateFacts(rateIn: string | number, audioHz: number = 48000): RateFactsResult | VideoError {
  let rate: FrameRate;
  const tcRate = parseRate(rateIn);
  let offTimecode: string | null = null;
  if (tcRate.ok) rate = tcRate;
  else {
    // Rate facts do not involve timecode: 48 fps (HFR cinema) or 120 fps has an
    // exact frame duration, samples per frame and shutter arithmetic even though
    // SMPTE ST 12-1 defines no timecode for it. Taken exactly as typed.
    const e = exactFps(rateIn);
    if ("ok" in e) return e;
    const x = ratToNumber(e.fps);
    const fractional = e.fps.den % 1001n === 0n;
    rate = {
      ok: true,
      id: ratToDecimal(e.fps, 6).text,
      fps: e.fps,
      nominal: fractional ? Math.round((x * 1001) / 1000) : Math.round(x),
      fractional,
      dropPerMinute: 0,
      snapNote: null,
      dfInText: null,
    };
    offTimecode =
      `${rate.id} fps is not a SMPTE ST 12-1 timecode rate (those are ${RATE_LIST}); the frame and audio ` +
      "arithmetic below uses it exactly as typed, and it has no timecode of its own.";
  }
  const a = ratFromNumber(audioHz);
  if (!a || a.num <= 0n || audioHz > 10_000_000) return { ok: false, error: "The audio sample rate must be a positive number of hertz." };
  const spf = ratDiv(a, rate.fps);
  const notes: string[] = [];
  if (rate.snapNote) notes.push(rate.snapNote);
  if (offTimecode) notes.push(offTimecode);
  let audioCycleFrames: number | null = 1;
  let audioCycleSamples: number | null = Number(spf.num);
  let audioSplit: RateFactsResult["audioSplit"] = null;
  if (!ratIsInteger(spf)) {
    if (spf.den <= 100000n) {
      audioCycleFrames = Number(spf.den);
      audioCycleSamples = Number(spf.num);
      const low = Number(spf.num / spf.den);
      const highCount = Number(spf.num % spf.den);
      audioSplit = { high: low + 1, highCount, low, lowCount: audioCycleFrames - highCount };
      notes.push(
        `${ratToDecimal(spf, 6).text} samples per frame is not whole, so the samples are distributed over a ` +
          `${audioCycleFrames}-frame sequence of ${audioCycleSamples} samples: ${highCount} frames of ${low + 1} and ` +
          `${audioCycleFrames - highCount} of ${low}. (The order within the sequence is set by the interface standard, ` +
          "e.g. SMPTE ST 272 for SDI embedding, and is not asserted here.)",
      );
    } else {
      audioCycleFrames = null;
      audioCycleSamples = null;
      notes.push("The audio and video rates have no short common cycle at this pairing.");
    }
  }
  const ndfDriftSPerHour = rate.fractional ? 3.6 : 0;
  if (rate.fractional) {
    notes.push(
      `${rate.id} is ${rate.nominal * 1000}/1001 fps exactly (the 1000/1001 rate), 0.1% slower than ${rate.nominal}. ` +
        `A non-drop label falls behind the wall clock by 3.6 s (${rate.nominal * 3.6 >= 100 ? (rate.nominal * 3.6).toFixed(0) : (rate.nominal * 3.6).toFixed(1)} frames) per hour` +
        (rate.dropPerMinute ? "; drop-frame timecode removes that." : "; drop-frame is not defined at this rate, so the drift stays."),
    );
  }
  return {
    ok: true,
    rate,
    fps: rate.fps,
    fpsText: rate.fractional ? `${rate.id} (${rate.nominal * 1000}/1001)` : rate.id,
    frameMs: ratToNumber(ratDiv(rat(1000), rate.fps)),
    samplesPerFrame: spf,
    samplesPerFrameText: ratIsInteger(spf) ? String(spf.num) : `${spf.num}/${spf.den} (${ratToDecimal(spf, 4).text})`,
    audioCycleFrames,
    audioCycleSamples,
    audioSplit,
    ndfDriftSPerHour,
    dropFrameDefined: rate.dropPerMinute > 0,
    notes,
  };
}

export interface CadenceSlot {
  /** 0-based target frame. */
  target: number;
  /** Field 1 or 2 for an interlaced target; null for progressive. */
  field: 1 | 2 | null;
  /** 0-based source frame shown in that slot. */
  source: number;
}

export interface PulldownResult {
  ok: true;
  from: FrameRate;
  to: FrameRate;
  kind: "identity" | "speed change" | "repeat" | "2:3 pulldown (fields)" | "2:3 frame cadence" | "speed change + repeat";
  /** Playback speed factor applied to the source (1 = none), exact. */
  speed: Rational;
  speedPct: number;
  /** Pitch shift of the audio if it is not corrected, semitones and cents. */
  semitones: number;
  cents: number;
  /** A 100-minute source runs this many minutes after the speed change. */
  runtimeOf100Min: number;
  /** One cycle of the cadence: source frames → target frames. */
  cycle: { sourceFrames: number; targetFrames: number };
  cadence: CadenceSlot[];
  /** Target frames by source letter, e.g. ["AA","BB","BC","CD","DD"]. */
  pattern: string[];
  notes: string[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Frame-rate conversion that has a standard cadence: 24 → 30 as 2:3 pulldown
 * (4 film frames → 10 fields → 5 frames), 24 → 60 as a 2:3 frame cadence,
 * integer repeats (25 → 50), the PAL speed-up (24 → 25, +4.17%, +70.7 cents,
 * 100 min → 96 min), and the 0.1% 1000/1001 slow-down. Anything else needs
 * motion-compensated standards conversion and is refused by name.
 */
export function pulldown(fromIn: string | number, toIn: string | number): PulldownResult | VideoError {
  const from = parseRate(fromIn);
  if (!from.ok) return { ok: false, error: `Source: ${from.error}` };
  const to = parseRate(toIn);
  if (!to.ok) return { ok: false, error: `Target: ${to.error}` };
  const nominalRatio = rat(to.nominal, from.nominal);
  const fpsRatio = ratDiv(to.fps, from.fps);
  const notes: string[] = [];
  for (const r of [from, to]) if (r.snapNote) notes.push(r.snapNote);
  let kind: PulldownResult["kind"];
  let repeat: Rational;
  // Cadence ratio: target frames per source frame, before any speed change.
  const eq = (r: Rational, n: number, d = 1) => ratCmp(r, rat(n, d)) === 0;
  if (eq(nominalRatio, 1)) {
    kind = ratCmp(fpsRatio, rat(1)) === 0 ? "identity" : "speed change";
    repeat = rat(1);
  } else if (ratIsInteger(nominalRatio)) {
    kind = "repeat";
    repeat = nominalRatio;
  } else if (eq(nominalRatio, 5, 4)) {
    kind = "2:3 pulldown (fields)";
    repeat = rat(5, 4);
  } else if (eq(nominalRatio, 5, 2)) {
    kind = "2:3 frame cadence";
    repeat = rat(5, 2);
  } else if (eq(nominalRatio, 25, 24)) {
    kind = "speed change";
    repeat = rat(1);
  } else if (eq(nominalRatio, 25, 12)) {
    kind = "speed change + repeat";
    repeat = rat(2);
  } else if (eq(nominalRatio, 24, 25)) {
    kind = "speed change";
    repeat = rat(1);
  } else if (eq(nominalRatio, 4, 5) || eq(nominalRatio, 2, 5)) {
    return {
      ok: false,
      error:
        `${from.id} → ${to.id} would REMOVE a 2:3 cadence (inverse telecine), which depends on finding the cadence in ` +
        "the material and is not modelled. Enter the conversion the other way round to see the cadence.",
    };
  } else {
    return {
      ok: false,
      error:
        `${from.id} → ${to.id} has no standard cadence. Converting between these rates (e.g. 25 ↔ 29.97) is a ` +
        "standards conversion that synthesises new frames by motion-compensated interpolation; it is not a formula " +
        "and is not modelled here. Supported: 2:3 pulldown (24 → 30, 24 → 60), integer repeats, 24 ↔ 25 speed change, " +
        "and the 0.1% 1000/1001 adjustment.",
    };
  }
  if (ratCmp(nominalRatio, rat(1)) < 0 && kind !== "speed change") {
    return { ok: false, error: "Dropping frames to a lower rate is not a cadence this models; enter the conversion the other way round." };
  }
  // speed = (to fps / from fps) / repeat
  const speed = ratDiv(fpsRatio, repeat);
  const sp = ratToNumber(speed);
  const semitones = 12 * Math.log2(sp);
  const cadence: CadenceSlot[] = [];
  const pattern: string[] = [];
  let cycle = { sourceFrames: 1, targetFrames: Number(repeat.num) };
  if (kind === "2:3 pulldown (fields)") {
    // A A | B B B | C C | D D D → fields, paired into 5 frames.
    const fields = [0, 0, 1, 1, 1, 2, 2, 3, 3, 3];
    for (let i = 0; i < 10; i++) cadence.push({ target: Math.floor(i / 2), field: (i % 2) + 1 as 1 | 2, source: fields[i] });
    for (let t = 0; t < 5; t++) pattern.push(LETTERS[fields[2 * t]] + LETTERS[fields[2 * t + 1]]);
    cycle = { sourceFrames: 4, targetFrames: 5 };
    notes.push(
      "2:3 pulldown: film frames are held for 2 then 3 fields alternately, so 4 film frames fill 10 fields = 5 " +
        "interlaced frames. Two of every five video frames (BC, CD) mix fields from two film frames.",
    );
  } else if (kind === "2:3 frame cadence") {
    const frames = [0, 0, 1, 1, 1, 2, 2, 3, 3, 3];
    frames.forEach((s, i) => cadence.push({ target: i, field: null, source: s }));
    pattern.push(...frames.map((s) => LETTERS[s]));
    cycle = { sourceFrames: 4, targetFrames: 10 };
    notes.push("2:3 frame cadence at 60p: frames are shown 2, 3, 2, 3 times, so 4 source frames fill 10 output frames (judder).");
  } else {
    const k = Number(repeat.num);
    for (let i = 0; i < k; i++) cadence.push({ target: i, field: null, source: 0 });
    pattern.push("A".repeat(k));
    cycle = { sourceFrames: 1, targetFrames: k };
    if (k > 1) notes.push(`Each source frame is shown ${k} times.`);
  }
  if (ratCmp(speed, rat(1)) !== 0) {
    const pct = (sp - 1) * 100;
    notes.push(
      `The source plays ${pct > 0 ? "FAST" : "SLOW"} by ${Math.abs(pct).toFixed(4)}% (speed ×${ratToDecimal(speed, 6).text}): ` +
        `uncorrected audio shifts ${semitones > 0 ? "up" : "down"} ${Math.abs(semitones).toFixed(5)} semitones ` +
        `(${Math.abs(semitones * 100).toFixed(3)} cents), and 100 minutes of source runs ${(100 / sp).toFixed(3)} minutes.`,
    );
    if (Math.abs(pct) < 0.2) {
      notes.push("This is the 1000/1001 adjustment: 0.1% is inaudible as pitch (1.7 cents) but it accumulates to 3.6 s per hour.");
    }
  }
  return {
    ok: true,
    from,
    to,
    kind,
    speed,
    speedPct: (sp - 1) * 100,
    semitones,
    cents: semitones * 100,
    runtimeOf100Min: 100 / sp,
    cycle,
    cadence,
    pattern,
    notes,
  };
}

export interface ShutterResult {
  ok: true;
  angleDeg: number;
  /** Exposure time, exact. */
  time: Rational;
  timeS: number;
  timeMs: number;
  /** "1/48 s" when the time is a unit fraction, else decimal seconds. */
  timeText: string;
  fps: Rational;
  notes: string[];
}

/**
 * Shutter angle ↔ exposure time: t = angle / (360° × fps). 180° at 24 fps is
 * 1/48 s; 172.8° at 25 is 19.2 ms; 1/50 s at 25 is 180°. Exact rationals.
 */
export function shutter(given: { angleDeg?: number; timeS?: number | string }, fpsIn: string | number): ShutterResult | VideoError {
  const f = exactFps(fpsIn);
  if ("ok" in f) return f;
  const hasA = given.angleDeg !== undefined;
  const hasT = given.timeS !== undefined && given.timeS !== "";
  if (hasA === hasT) return { ok: false, error: "Give the shutter angle OR the exposure time, not both and not neither." };
  let time: Rational;
  let angle: Rational;
  if (hasA) {
    const a = ratFromNumber(given.angleDeg!);
    if (!a || a.num <= 0n) return { ok: false, error: "The shutter angle must be greater than 0°." };
    if (ratCmp(a, rat(360)) > 0) {
      return { ok: false, error: "A shutter angle above 360° would expose longer than one frame lasts; the maximum is 360°." };
    }
    angle = a;
    time = ratDiv(a, ratMul(rat(360), f.fps));
  } else {
    const t = typeof given.timeS === "number" ? ratFromNumber(given.timeS) : ratFromText(String(given.timeS));
    if (!t || t.num <= 0n) return { ok: false, error: "The exposure time must be greater than zero (e.g. 0.02 or 1/48)." };
    time = t;
    angle = ratMul(ratMul(t, f.fps), rat(360));
    if (ratCmp(angle, rat(360)) > 0) {
      return {
        ok: false,
        error: `${ratToDecimal(t, 6).text} s is longer than one frame at this rate (${ratToDecimal(ratDiv(rat(1), f.fps), 6).text} s); the exposure cannot exceed the frame.`,
      };
    }
  }
  const timeS = ratToNumber(time);
  const timeText = time.num === 1n ? `1/${time.den} s` : `${ratToDecimal(time, 6).text} s`;
  const notes: string[] = [`Exposure = angle / (360° × frame rate): ${ratToDecimal(angle, 4).text}° at ${ratToDecimal(f.fps, 4).text} fps is ${timeText}.`];
  if (f.rate && f.rate.snapNote) notes.push(f.rate.snapNote);
  if (ratCmp(angle, rat(180)) === 0) notes.push("180° is the conventional \"film look\" motion blur: the shutter is open half of each frame.");
  return { ok: true, angleDeg: ratToNumber(angle), time, timeS, timeMs: timeS * 1000, timeText, fps: f.fps, notes };
}

// --- Transfer functions ------------------------------------------------------

// ITU-R BT.709-6 item 1.2 OETF, constants as published.
const BT709_ALPHA = 1.099;
const BT709_BETA = 0.018;
const BT709_GAMMA = 0.45;
/** Signal value at L = 0.018 on the LINEAR branch (4.5 × 0.018). */
const BT709_V_BREAK = 4.5 * BT709_BETA;

/**
 * BT.709 OETF: scene light L (0–1) → signal V. A CAMERA curve.
 * V = 4.5L for L < 0.018, 1.099·L^0.45 − 0.099 otherwise.
 * The published (rounded) constants make it discontinuous by 2.5×10⁻⁴ at
 * L = 0.018 (0.08100 linear vs 0.08125 power).
 */
export function oetf709(L: number): number {
  return L < BT709_BETA ? 4.5 * L : BT709_ALPHA * Math.pow(L, BT709_GAMMA) - (BT709_ALPHA - 1);
}

/**
 * Inverse BT.709 OETF: V → SCENE light (not display light). Linear branch for
 * V < 0.081 (= 4.5 × 0.018), power branch from 0.081. Signals in
 * [0.08100, 0.08125) are not produced by the forward curve (its discontinuity),
 * so they map slightly below 0.018 and do not round-trip.
 */
export function oetf709Inverse(V: number): number {
  return V < BT709_V_BREAK ? V / 4.5 : Math.pow((V + (BT709_ALPHA - 1)) / BT709_ALPHA, 1 / BT709_GAMMA);
}

/** BT.1886 EOTF constants for white Lw and black Lb (cd/m²), γ = 2.4. */
function bt1886ab(Lw: number, Lb: number): { a: number; b: number } {
  const wg = Math.pow(Lw, 1 / 2.4);
  const bg = Math.pow(Lb, 1 / 2.4);
  return { a: Math.pow(wg - bg, 2.4), b: bg / (wg - bg) };
}

/** ITU-R BT.1886 Annex 1 EOTF: L = a·max(V + b, 0)^2.4, cd/m². */
export function eotf1886(V: number, Lw = 100, Lb = 0): number {
  const { a, b } = bt1886ab(Lw, Lb);
  return a * Math.pow(Math.max(V + b, 0), 2.4);
}

/** Inverse BT.1886: V = (L/a)^(1/2.4) − b. */
export function eotf1886Inverse(L: number, Lw = 100, Lb = 0): number {
  const { a, b } = bt1886ab(Lw, Lb);
  return Math.pow(Math.max(L, 0) / a, 1 / 2.4) - b;
}

/** sRGB EOTF (IEC 61966-2-1): V/12.92 for V ≤ 0.04045, ((V + 0.055)/1.055)^2.4 above. */
export function eotfSrgb(V: number): number {
  return V <= 0.04045 ? V / 12.92 : Math.pow((V + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB EOTF: 12.92L for L ≤ 0.0031308, 1.055·L^(1/2.4) − 0.055 above. */
export function eotfSrgbInverse(L: number): number {
  return L <= 0.0031308 ? 12.92 * L : 1.055 * Math.pow(L, 1 / 2.4) - 0.055;
}

/** BT.2100 HLG constants (Table 5), as published. */
export const HLG_A = 0.17883277;
export const HLG_B = 1 - 4 * HLG_A; // 0.28466892
export const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A); // 0.559910729529562

/** BT.2100 HLG OETF: scene light E (0–1) → E′. √(3E) to 1/12, a·ln(12E − b) + c above. */
export function hlgOetf(E: number): number {
  return E <= 1 / 12 ? Math.sqrt(3 * Math.max(E, 0)) : HLG_A * Math.log(12 * E - HLG_B) + HLG_C;
}

/** Inverse HLG OETF: E′ → scene light E. */
export function hlgOetfInverse(Ep: number): number {
  return Ep <= 0.5 ? (Ep * Ep) / 3 : (Math.exp((Ep - HLG_C) / HLG_A) + HLG_B) / 12;
}

export type TransferCurve = "bt709" | "bt1886" | "srgb" | "pq" | "hlg";
export type TransferDirection = "toLight" | "toSignal";

export interface TransferResult {
  ok: true;
  curve: TransferCurve;
  direction: TransferDirection;
  input: number;
  output: number;
  /** What the output is: "signal (0–1)", "scene light (relative, 0–1)", "display light, cd/m²", … */
  outputIs: string;
  formula: string;
  standard: string;
  figure: {
    /**
     * x = signal 0–1, y = light: relative 0–1 (BT.709, sRGB, HLG), normalised
     * to white (BT.1886, y = L/Lw), cd/m² for PQ. On logY curves every y > 0.
     */
    curve: { x: number; y: number }[];
    /** Faint comparison curves (BT.709 inverse, BT.1886, sRGB), relative light. */
    compare: { name: string; points: { x: number; y: number }[] }[];
    /** The entered point on the same scale; null when it cannot be drawn (zero on a log axis). */
    mark: { x: number; y: number } | null;
    logY: boolean;
  };
  notes: string[];
}

const TRAP_709 =
  "BT.709 is a CAMERA curve (an OETF: scene light → signal). The display curve is BT.1886 (EOTF, γ 2.4). Inverting " +
  "the 709 OETF to get display light is the commonest error: the two do not round-trip, and the difference — an " +
  "end-to-end system gamma of about 1.2 — is deliberate (it compensates for dim viewing).";

/**
 * One transfer curve in one direction, with the curve's figure data.
 * Light is relative 0–1 for BT.709, sRGB and HLG (scene light), cd/m² for
 * BT.1886 and PQ. Out-of-domain inputs are refused by name.
 */
export function transfer(
  curve: TransferCurve,
  direction: TransferDirection,
  value: number,
  opts: { Lw?: number; Lb?: number } = {},
): TransferResult | VideoError {
  if (!Number.isFinite(value)) return { ok: false, error: "The value must be a finite number." };
  const Lw = opts.Lw ?? 100;
  const Lb = opts.Lb ?? 0;
  const notes: string[] = [];
  const unitSignal = (v: number): VideoError | null =>
    v < 0 || v > 1 ? { ok: false, error: `A normalised signal runs 0 to 1; ${v} is outside it.` } : null;
  const relLight = (v: number): VideoError | null =>
    v < 0 || v > 1 ? { ok: false, error: `Relative light runs 0 (black) to 1 (reference white); ${v} is outside it.` } : null;
  const toSignal = direction === "toSignal";
  let output: number;
  let outputIs: string;
  let formula: string;
  let standard: string;
  let curveFn: (x: number) => number;
  let logY = false;
  switch (curve) {
    case "bt709": {
      standard = "ITU-R BT.709-6, item 1.2 (OETF)";
      formula = "V = 4.5L (L < 0.018); V = 1.099·L⁰·⁴⁵ − 0.099 (L ≥ 0.018)";
      const bad = toSignal ? relLight(value) : unitSignal(value);
      if (bad) return bad;
      output = toSignal ? oetf709(value) : oetf709Inverse(value);
      outputIs = toSignal ? "signal V (0–1)" : "SCENE light L (relative, 0–1) — not display light";
      curveFn = oetf709Inverse;
      notes.push(TRAP_709);
      if (!toSignal && value >= BT709_V_BREAK && value < oetf709(BT709_BETA)) {
        notes.push(
          `V = ${value} lies in [0.08100, 0.08125), which the published BT.709 OETF never outputs: its rounded constants ` +
            "make it jump by 2.5×10⁻⁴ at L = 0.018. The inverse uses the power branch from V = 0.081, so this value maps " +
            "just below 0.018 and does not round-trip.",
        );
      }
      break;
    }
    case "bt1886": {
      standard = "ITU-R BT.1886, Annex 1 (EOTF)";
      formula = "L = a·max(V + b, 0)²·⁴, a = (Lw¹ᐟ²·⁴ − Lb¹ᐟ²·⁴)²·⁴, b = Lb¹ᐟ²·⁴/(Lw¹ᐟ²·⁴ − Lb¹ᐟ²·⁴)";
      if (!Number.isFinite(Lw) || !Number.isFinite(Lb) || Lw <= 0 || Lb < 0 || Lb >= Lw) {
        return { ok: false, error: "BT.1886 needs a white level Lw above a black level Lb ≥ 0 (cd/m²)." };
      }
      if (toSignal) {
        if (value < Lb || value > Lw) {
          return { ok: false, error: `Display light must lie between the black level ${Lb} and the white level ${Lw} cd/m².` };
        }
        output = eotf1886Inverse(value, Lw, Lb);
      } else {
        const bad = unitSignal(value);
        if (bad) return bad;
        output = eotf1886(value, Lw, Lb);
      }
      outputIs = toSignal ? "signal V (0–1)" : "display light, cd/m²";
      curveFn = (v) => eotf1886(v, Lw, Lb);
      notes.push(`Display white ${Lw} cd/m², black ${Lb} cd/m², γ = 2.4.`);
      notes.push(TRAP_709);
      break;
    }
    case "srgb": {
      standard = "IEC 61966-2-1 (sRGB)";
      formula = "L = V/12.92 (V ≤ 0.04045); L = ((V + 0.055)/1.055)²·⁴ above";
      const bad = toSignal ? relLight(value) : unitSignal(value);
      if (bad) return bad;
      output = toSignal ? eotfSrgbInverse(value) : eotfSrgb(value);
      outputIs = toSignal ? "signal V (0–1)" : "light (relative, 0–1)";
      curveFn = eotfSrgb;
      notes.push("sRGB is NOT a pure 2.2 gamma: it has a linear toe below V = 0.04045; the overall curve only approximates 2.2.");
      break;
    }
    case "pq": {
      standard = "SMPTE ST 2084 / ITU-R BT.2100 (PQ EOTF)";
      formula = "L = 10000·(max(E′¹ᐟᵐ² − c₁, 0)/(c₂ − c₃·E′¹ᐟᵐ²))¹ᐟᵐ¹, with m₁, m₂, c₁, c₂, c₃ as exact rationals";
      if (toSignal) {
        if (value < 0 || value > PQ_PEAK_NITS) return { ok: false, error: `PQ is defined from 0 to ${PQ_PEAK_NITS} cd/m²; ${value} is outside it.` };
        output = nitsToPq(value);
      } else {
        const bad = unitSignal(value);
        if (bad) return bad;
        output = pqToNits(value);
      }
      outputIs = toSignal ? "signal E′ (0–1)" : "display light, cd/m² (absolute)";
      curveFn = pqToNits;
      logY = true;
      notes.push("PQ is ABSOLUTE: each code value is a fixed luminance in cd/m², whatever the display.");
      break;
    }
    case "hlg": {
      standard = "ITU-R BT.2100, Table 5 (HLG OETF)";
      formula = "E′ = √(3E) (E ≤ 1/12); E′ = a·ln(12E − b) + c above; a = 0.17883277, b = 1 − 4a, c = 0.5 − a·ln(4a)";
      const bad = toSignal ? relLight(value) : unitSignal(value);
      if (bad) return bad;
      output = toSignal ? hlgOetf(value) : hlgOetfInverse(value);
      outputIs = toSignal ? "signal E′ (0–1)" : "SCENE light E (relative, 0–1)";
      curveFn = hlgOetfInverse;
      logY = true;
      notes.push(
        "HLG is RELATIVE and scene-referred: the display applies its own system gamma (an OOTF that depends on its peak " +
          "luminance), which is not modelled here. With the published constants E′(1) = 0.999999995, not exactly 1.",
      );
      break;
    }
    default:
      return { ok: false, error: `Unknown curve "${curve}". Choose BT.709, BT.1886, sRGB, PQ or HLG.` };
  }
  // Figure scale: BT.1886 is drawn normalised to its white (0–1) so it shares
  // an axis with the faint comparison curves; `output` stays in cd/m². On a log
  // axis (PQ, HLG) non-positive points cannot be drawn and are left out.
  const yScale = curve === "bt1886" ? 1 / Lw : 1;
  const drawable = (y: number) => Number.isFinite(y) && (!logY || y > 0);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const y = curveFn(x) * yScale;
    if (drawable(y)) pts.push({ x, y });
  }
  const cmpCurve = (fn: (x: number) => number) => {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i <= 50; i++) out.push({ x: i / 50, y: fn(i / 50) });
    return out;
  };
  const compare =
    curve === "pq" || curve === "hlg"
      ? []
      : [
          { name: "BT.709 OETF⁻¹ (scene)", points: cmpCurve(oetf709Inverse) },
          { name: "BT.1886 (Lw 1, Lb 0)", points: cmpCurve((v) => Math.pow(v, 2.4)) },
          { name: "sRGB", points: cmpCurve(eotfSrgb) },
        ];
  const raw = toSignal ? { x: output, y: value * yScale } : { x: value, y: output * yScale };
  const mark = drawable(raw.y) ? raw : null;
  if (!mark) notes.push("Zero light cannot be marked on the logarithmic luminance axis; the curve is drawn without a mark.");
  return { ok: true, curve, direction, input: value, output, outputIs, formula, standard, figure: { curve: pts, compare, mark, logY }, notes };
}

export interface CodeValueResult {
  ok: true;
  code: number;
  bits: number;
  range: "narrow" | "full";
  component: "luma" | "chroma";
  /** Black/white (luma) or min/max (chroma) codes at this depth and range. */
  nominalMin: number;
  nominalMax: number;
  formula: string;
  notes: string[];
}

/**
 * Digital code value of a non-linear signal (ITU-R BT.2100 Table 9; BT.709
 * item 6.10). Narrow range: luma D = round((219E′ + 16)·2^(n−8)), chroma
 * D = round((224E′ + 128)·2^(n−8)). Full range: luma round((2ⁿ − 1)E′), chroma
 * Clip1(round((2ⁿ − 1)E′ + 2ⁿ⁻¹)) per ITU-T H.273 (so +0.5 lands on 2ⁿ − 1,
 * never 2ⁿ). 10-bit narrow luma: 64 black, 940 white.
 */
export function codeValue(
  Ep: number,
  bits: number,
  range: "narrow" | "full",
  component: "luma" | "chroma" = "luma",
): CodeValueResult | VideoError {
  if (!Number.isFinite(Ep)) return { ok: false, error: "The signal must be a finite number." };
  if (![8, 10, 12, 16].includes(bits)) return { ok: false, error: "Bit depth must be 8, 10, 12 or 16." };
  if (component === "luma" && (Ep < 0 || Ep > 1)) {
    return { ok: false, error: "Luma E′ runs 0 to 1 here; narrow range keeps footroom and headroom codes for overshoot, which this does not map." };
  }
  if (component === "chroma" && (Ep < -0.5 || Ep > 0.5)) {
    return { ok: false, error: "Colour-difference E′ (Cb, Cr) runs −0.5 to +0.5." };
  }
  const scale = Math.pow(2, bits - 8);
  let code: number;
  let lo: number;
  let hi: number;
  let formula: string;
  let clipNote: string | null = null;
  if (range === "narrow") {
    if (component === "luma") {
      code = Math.round((219 * Ep + 16) * scale);
      lo = 16 * scale;
      hi = 235 * scale;
      formula = "D = round((219E′ + 16)·2ⁿ⁻⁸)";
    } else {
      code = Math.round((224 * Ep + 128) * scale);
      lo = 16 * scale;
      hi = 240 * scale;
      formula = "D = round((224E′ + 128)·2ⁿ⁻⁸)";
    }
  } else {
    const max = Math.pow(2, bits) - 1;
    if (component === "luma") {
      code = Math.round(max * Ep);
      lo = 0;
      hi = max;
      formula = "D = round((2ⁿ − 1)·E′)";
    } else {
      // ITU-T H.273 (VideoFullRangeFlag = 1): Cb = Clip1C(Round((2ⁿ − 1)·E′ + 2ⁿ⁻¹)),
      // Clip1C clamping to the word, 0 … 2ⁿ − 1. Without the clip, E′ = +0.5
      // gives 2ⁿ, a code no n-bit word holds; −0.5 rounds to 1. So the range
      // actually reachable is 1 … 2ⁿ − 1, with +0.5 clipped onto the top code.
      const clip = (x: number) => Math.min(max, Math.max(0, x));
      const off = Math.pow(2, bits - 1);
      const unclipped = Math.round(max * Ep + off);
      code = clip(unclipped);
      lo = clip(Math.round(max * -0.5 + off));
      hi = clip(Math.round(max * 0.5 + off));
      formula = "D = Clip1(round((2ⁿ − 1)·E′ + 2ⁿ⁻¹)), clipped to 0 … 2ⁿ − 1 (ITU-T H.273, full range)";
      if (unclipped !== code) {
        clipNote = `round((2ⁿ − 1)·E′ + 2ⁿ⁻¹) is ${unclipped} here, which no ${bits}-bit word holds; ITU-T H.273's Clip1 puts it on ${code}, the top code.`;
      }
    }
  }
  const notes = [
    `${range === "narrow" ? "Narrow" : "Full"} range, ${bits}-bit ${component}: ${lo} to ${hi} ` +
      `(${range === "full" && component === "chroma" ? "ITU-T H.273 full range, clipped to the word" : "ITU-R BT.2100 Table 9"}).`,
  ];
  if (clipNote) notes.push(clipNote);
  if (range === "narrow") {
    notes.push("Narrow (\"legal\", \"video\") range keeps footroom below black and headroom above white for overshoot.");
  }
  return { ok: true, code, bits, range, component, nominalMin: lo, nominalMax: hi, formula, notes };
}
