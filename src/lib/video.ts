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
  if (compressionRatio === 1) {
    notes.push("No compression applied — this is the raw rate, which is what a capture interface must carry.");
  }
  return { ok: true, uncompressedBps, compressedBps, bitsPerPixel: bpp, pixelRate, sizeBytes, notes };
}

// --- Resolution and viewing geometry ----------------------------------------

export interface ResolutionResult {
  ok: true;
  pixels: number;
  megapixels: number;
  aspectRatio: number;
  /** Simplified integer aspect, e.g. "16:9". */
  aspectLabel: string;
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
  return { ok: true, pixels, megapixels: pixels / 1e6, aspectRatio, aspectLabel, ppi, retinaDistanceM, notes };
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

/** PQ signal (0-1) to absolute luminance in nits. */
export function pqToNits(signal: number): number {
  if (signal <= 0) return 0;
  const e = Math.pow(signal, 1 / PQ_M2);
  const num = Math.max(e - PQ_C1, 0);
  const den = PQ_C2 - PQ_C3 * e;
  return PQ_PEAK_NITS * Math.pow(num / den, 1 / PQ_M1);
}

/** Absolute luminance in nits to a PQ signal (0-1). */
export function nitsToPq(nits: number): number {
  if (nits <= 0) return 0;
  const y = Math.pow(nits / PQ_PEAK_NITS, PQ_M1);
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
  /** Frames of latency at the display's refresh rate. */
  frames: number;
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

  const totalMs = stages.reduce((s, x) => s + x.ms, 0);
  const frameMs = 1000 / refreshHz;
  const quantisedMs = Math.ceil(totalMs / frameMs) * frameMs;
  const worst = stages.reduce((a, b) => (b.ms > a.ms ? b : a));

  return {
    ok: true,
    stages,
    totalMs,
    quantisedMs,
    frames: quantisedMs / frameMs,
    worst,
    notes: [
      `The display refreshes every ${frameMs.toFixed(2)} ms, so the delivered latency is the ` +
        "total rounded UP to the next boundary. Shaving time off a stage changes nothing unless " +
        "it moves the total across one of those boundaries.",
      `"${worst.name}" is the largest stage at ${worst.ms} ms — that is where effort pays, ` +
        "rather than wherever is easiest to change.",
      "Network time is treated as a fixed figure here. In reality it is a distribution, and the " +
        "tail is what causes the visible stutter rather than the mean.",
    ],
  };
}
