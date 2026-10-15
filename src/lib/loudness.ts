// Loudness per ITU-R BS.1770-4 — what IS computable from typed numbers, and a
// refusal BY NAME for what is not.
//
// COMPUTABLE: the K-weighting filter's gain at a frequency (the two published
// 48 kHz biquads, evaluated exactly on the unit circle); the loudness of a
// steady sine in a stated set of channels; combining per-channel levels with
// the BS.1770 channel weights; the two-stage gate applied to a TYPED list of
// 400 ms block loudnesses; normalisation gain from a measured value to a
// target, with the true peak that gain produces.
//
// NOT COMPUTABLE: the integrated loudness, loudness range or true peak of a
// PROGRAMME from one reading (a peak, an RMS, a dBFS figure). Loudness is gated
// over the whole programme waveform, and no single level determines it. Those
// questions are refused, whatever their phrasing.
//
// LUFS and LKFS are the same scale (EBU and ITU names for one thing); LU is a
// difference of loudness, 1 LU = 1 dB. None of them is a unit to convert().

import { AudioError, AudioFigure, FigurePoint, logSpace, fmtNum } from "./audio";

const fail = (error: string): AudioError => ({ ok: false, error });

/** BS.1770-4 Table 1: stage 1 pre-filter (high shelf), 48 kHz. */
export const K_STAGE1 = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1.0, -1.69065929318241, 0.73248077421585],
};

/** BS.1770-4 Table 2: stage 2 RLB high-pass, 48 kHz. Numerator exactly 1, −2, 1. */
export const K_STAGE2 = {
  b: [1.0, -2.0, 1.0],
  a: [1.0, -1.99004745483398, 0.99007225036621],
};

/** The only sample rate BS.1770 publishes coefficients for. */
export const K_FS = 48000;

/** The −0.691 dB offset in L = −0.691 + 10·log₁₀ Σ Gᵢ·zᵢ. */
export const K_OFFSET_DB = -0.691;

/** Absolute gate, LKFS. */
export const ABSOLUTE_GATE = -70;
/** Relative gate below the absolute-gated loudness, LU. */
export const RELATIVE_GATE_LU = -10;

/** BS.1770-4 channel weights. LFE is excluded (weight 0). */
export const CHANNEL_WEIGHTS: Record<string, number> = {
  L: 1.0,
  R: 1.0,
  C: 1.0,
  Ls: 1.41,
  Rs: 1.41,
  LFE: 0,
};

export const CHANNEL_SETS: Record<string, string[]> = {
  L: ["L"],
  "L+R": ["L", "R"],
  "5.1": ["L", "R", "C", "LFE", "Ls", "Rs"],
};

/** |H(e^{jω})|² of a biquad. */
function biquadMag2(b: number[], a: number[], w: number): number {
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = b[0] + b[1] * c1 + b[2] * c2;
  const ni = -(b[1] * s1 + b[2] * s2);
  const dr = a[0] + a[1] * c1 + a[2] * c2;
  const di = -(a[1] * s1 + a[2] * s2);
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}

/** K-weighting gain in dB at f (48 kHz coefficients), no validation. */
export function kGainDb(f: number): number {
  const w = (2 * Math.PI * f) / K_FS;
  return 10 * Math.log10(biquadMag2(K_STAGE1.b, K_STAGE1.a, w) * biquadMag2(K_STAGE2.b, K_STAGE2.a, w));
}

const RATE_REFUSAL =
  "BS.1770 publishes 48 kHz coefficients; other rates need a re-derived filter this tool does not do.";

function checkFreq(f: number, fs: number): AudioError | null {
  if (fs !== K_FS) return fail(RATE_REFUSAL);
  if (typeof f !== "number" || !Number.isFinite(f) || f <= 0) {
    return fail("The frequency must be greater than zero: the K-filter blocks DC entirely (−∞ dB).");
  }
  if (f >= K_FS / 2) {
    return fail(`The K-filter is digital at 48 kHz: ${fmtNum(f)} Hz is at or above the Nyquist frequency (24 kHz) and does not exist in that signal.`);
  }
  if (f < 1) return fail("Below 1 Hz the K-weighting is below −80 dB; give a frequency of at least 1 Hz.");
  return null;
}

export interface KGainResult {
  ok: true;
  frequencyHz: number;
  gainDb: number;
  notes: string[];
  figure: AudioFigure;
}

/** K-weighting gain at a frequency: +0.6910 dB at 997 Hz, 48 kHz coefficients. */
export function kWeightGainDb(f: number, fs = K_FS): KGainResult | AudioError {
  const bad = checkFreq(f, fs);
  if (bad) return bad;
  const g = kGainDb(f);
  return {
    ok: true,
    frequencyHz: f,
    gainDb: g,
    notes: [
      "K-weighting = BS.1770-4 stage 1 (high shelf, about +4 dB above 2 kHz) × stage 2 (RLB high-pass), the two " +
        "published 48 kHz biquads evaluated exactly on the unit circle.",
    ],
    figure: kFigure(f),
  };
}

function kFigure(markF?: number): AudioFigure {
  const pts: FigurePoint[] = logSpace(20, 20000).map((x) => ({ x, y: kGainDb(x) }));
  return {
    kind: "line",
    title: "K-weighting (BS.1770-4, 48 kHz)",
    xLabel: "frequency (Hz)",
    yLabel: "gain (dB)",
    xLog: true,
    series: [{ label: "K-weighting", points: pts.filter((p) => Number.isFinite(p.y)) }],
    markers: markF !== undefined ? [{ axis: "x", at: markF, label: `${fmtNum(markF, 6)} Hz` }] : [],
  };
}

function channelList(channels: string | string[]): string[] | AudioError {
  const list = typeof channels === "string" ? CHANNEL_SETS[channels] : channels;
  if (!Array.isArray(list) || list.length === 0) return fail("Choose a channel set: L only, L+R or 5.1.");
  if (list.length > 64) return fail("At most 64 channels.");
  for (const c of list) {
    if (!(c in CHANNEL_WEIGHTS)) return fail(`"${c}" is not a BS.1770 channel (L, R, C, Ls, Rs, LFE).`);
  }
  return list;
}

export interface SineLoudnessResult {
  ok: true;
  loudnessLufs: number;
  kGainDb: number;
  channels: string[];
  /** Σ Gᵢ over the channels carrying the sine. */
  weightSum: number;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Loudness of a STEADY sine of peak amplitude A dBFS at frequency f, the same
 * sine in every listed channel: L = −0.691 + 10·log₁₀(Σ Gᵢ · ½·10^(A/10) · |K(f)|²).
 * 997 Hz at 0 dBFS in one front channel = −3.0103 LUFS (BS.1770-4: "−3.01
 * LKFS"); in two = 0.00. A steady signal's gated loudness equals its ungated
 * loudness while it is above the −70 LUFS absolute gate.
 */
export function sineLoudness(
  amplitudeDbfs: number,
  f: number,
  channels: string | string[] = "L",
  fs = K_FS,
): SineLoudnessResult | AudioError {
  const bad = checkFreq(f, fs);
  if (bad) return bad;
  if (typeof amplitudeDbfs !== "number" || !Number.isFinite(amplitudeDbfs)) return fail("The amplitude must be a finite number of dBFS.");
  if (amplitudeDbfs > 0) return fail("A sine's peak cannot exceed full scale: the amplitude is 0 dBFS or below.");
  if (amplitudeDbfs < -300) return fail("Below −300 dBFS there is nothing to measure.");
  const list = channelList(channels);
  if (!Array.isArray(list)) return list;
  const weightSum = list.reduce((a, c) => a + CHANNEL_WEIGHTS[c], 0);
  if (!(weightSum > 0)) return fail("Only the LFE channel was given, and BS.1770 excludes LFE from loudness entirely.");
  const g = kGainDb(f);
  const lufs = K_OFFSET_DB + 10 * Math.log10(weightSum * 0.5) + amplitudeDbfs + g;
  if (lufs <= ABSOLUTE_GATE) {
    return fail(
      `This sine measures ${lufs.toFixed(2)} LUFS ungated, at or below the −70 LUFS absolute gate: every block is ` +
        "gated out and BS.1770 gives no integrated loudness for it.",
    );
  }
  const notes = [
    `L = −0.691 + 10·log₁₀(Σ G · ½·A²·|K|²). A sine's mean square is half its peak squared (−3.01 dB); the K-filter ` +
      `adds ${g >= 0 ? "+" : ""}${g.toFixed(4)} dB at ${fmtNum(f)} Hz.`,
    `Channels ${list.join(", ")}: Σ G = ${weightSum.toFixed(2)}` +
      (list.includes("LFE") ? " (LFE is EXCLUDED by BS.1770, weight 0)." : ".") +
      (list.some((c) => c === "Ls" || c === "Rs") ? " Surrounds weigh 1.41 (+1.5 dB)." : ""),
    "BS.1770-4's calibration: a 997 Hz sine at 0 dBFS in one front channel reads −3.01 LKFS. 997 Hz is used, not " +
      "1 kHz, because 1 kHz is a sub-multiple of 48 kHz; the K-gain also differs (1 kHz gives −3.0036 here).",
    "48 kHz coefficients only; a steady sine is gated the same as ungated while above −70 LUFS.",
  ];
  return { ok: true, loudnessLufs: lufs, kGainDb: g, channels: list, weightSum, notes, figure: kFigure(f) };
}

export interface ChannelCombineResult {
  ok: true;
  loudnessLufs: number;
  notes: string[];
}

/**
 * Combines per-channel loudness readings with the BS.1770 weights:
 * L = 10·log₁₀ Σ Gᵢ·10^(Lᵢ/10), each Lᵢ being that channel measured alone as a
 * front channel (−0.691 already inside it). Exact for steady signals; for a
 * programme the gate acts on the COMBINED blocks, so per-channel integrated
 * values do not combine exactly.
 */
export function combineChannels(readings: { channel: string; lufs: number }[]): ChannelCombineResult | AudioError {
  if (!Array.isArray(readings) || readings.length === 0) return fail("Give at least one channel reading.");
  if (readings.length > 64) return fail("At most 64 channels.");
  let max = -Infinity;
  for (const r of readings) {
    if (!r || !(r.channel in CHANNEL_WEIGHTS)) return fail(`"${r?.channel}" is not a BS.1770 channel (L, R, C, Ls, Rs, LFE).`);
    if (!Number.isFinite(r.lufs)) return fail("Every channel reading must be a finite number of LUFS.");
    if (CHANNEL_WEIGHTS[r.channel] > 0) max = Math.max(max, r.lufs);
  }
  if (max === -Infinity) return fail("Only LFE was given, and BS.1770 excludes LFE from loudness.");
  let s = 0;
  for (const r of readings) s += CHANNEL_WEIGHTS[r.channel] * Math.pow(10, (r.lufs - max) / 10);
  const L = max + 10 * Math.log10(s);
  return {
    ok: true,
    loudnessLufs: L,
    notes: [
      "Channels combine by POWER with weights L/R/C 1.0, Ls/Rs 1.41; LFE is excluded.",
      "Exact for steady signals. For a programme the gate acts on the combined 400 ms blocks, so combining " +
        "per-channel INTEGRATED values is only an approximation.",
    ],
  };
}

export interface GatedResult {
  ok: true;
  integratedLufs: number;
  relativeGateLufs: number;
  blocksGiven: number;
  passedAbsolute: number;
  passedBoth: number;
  notes: string[];
  figure: AudioFigure;
}

export const MAX_BLOCKS = 100000;

/**
 * Integrated loudness from a TYPED list of 400 ms block loudnesses (LUFS), by
 * BS.1770-4's two-stage gate: keep blocks ABOVE −70 LKFS (strictly, l > Γa);
 * Γr = (energy mean of those) − 10 LU; integrate the blocks above both
 * (strictly). The blocks must already be measured; this does not see audio.
 */
export function gatedIntegrated(blocks: number[]): GatedResult | AudioError {
  if (!Array.isArray(blocks) || blocks.length === 0) return fail("Give the block loudnesses (LUFS), one per 400 ms block.");
  if (blocks.length > MAX_BLOCKS) return fail(`At most ${MAX_BLOCKS} blocks.`);
  if (blocks.some((b) => typeof b !== "number" || !Number.isFinite(b))) return fail("Every block loudness must be a finite number of LUFS.");
  if (blocks.some((b) => b > 30)) return fail("A block above +30 LUFS is not a real measurement; check the list.");
  const energyMean = (xs: number[]): number => {
    const m = Math.max(...xs);
    let s = 0;
    for (const x of xs) s += Math.pow(10, (x - m) / 10);
    return m + 10 * Math.log10(s / xs.length);
  };
  const abs = blocks.filter((b) => b > ABSOLUTE_GATE);
  if (abs.length === 0) {
    return fail("Every block is at or below the −70 LUFS absolute gate; BS.1770 gives no integrated loudness.");
  }
  const rel = energyMean(abs) + RELATIVE_GATE_LU;
  const both = abs.filter((b) => b > rel);
  // Non-empty: the energy mean exceeds the max − 10·log10(n)... the loudest block is ≥ the mean > rel.
  const L = energyMean(both);
  const idx = blocks.slice(0, 2000).map((b, i) => ({ x: i + 1, y: b }));
  return {
    ok: true,
    integratedLufs: L,
    relativeGateLufs: rel,
    blocksGiven: blocks.length,
    passedAbsolute: abs.length,
    passedBoth: both.length,
    notes: [
      `Absolute gate −70 LUFS: ${abs.length} of ${blocks.length} blocks pass (strictly above). Relative gate ` +
        `${rel.toFixed(3)} LUFS (energy mean of those − 10 LU): ${both.length} pass.`,
      "Blocks are BS.1770's 400 ms windows with 75% overlap; each typed value must be a measured block loudness. " +
        "This works on the typed numbers only — it does not see audio.",
    ],
    figure: {
      kind: "line",
      title: "Block loudness and the gates",
      xLabel: "block",
      yLabel: "loudness (LUFS)",
      series: [{ label: "block loudness", points: idx.filter((p) => Number.isFinite(p.y)) }],
      markers: [
        { axis: "y", at: ABSOLUTE_GATE, label: "absolute gate −70" },
        { axis: "y", at: rel, label: "relative gate" },
        { axis: "y", at: L, label: "integrated" },
      ],
    },
  };
}

/** Delivery targets that ARE standards. Streaming-platform targets are policy, not tabulated. */
/** maxTruePeak is null where the ceiling was not verified against the primary text (A/85 is quoted at −2 dBTP only by secondary sources). */
export const LOUDNESS_TARGETS: { id: string; label: string; lufs: number; maxTruePeak: number | null }[] = [
  { id: "ebu-r128", label: "EBU R128 (−23 LUFS, −1 dBTP)", lufs: -23, maxTruePeak: -1 },
  { id: "atsc-a85", label: "ATSC A/85 (−24 LKFS)", lufs: -24, maxTruePeak: null },
];

export interface NormaliseResult {
  ok: true;
  gainDb: number;
  /** measured − target, LU. */
  offsetLu: number;
  resultingTruePeak: number | null;
  limiterRequired: boolean | null;
  notes: string[];
  figure: AudioFigure;
}

/**
 * Normalisation gain: target − measured (dB). With a measured true peak, the
 * true peak after that gain and whether it breaks the ceiling (default −1 dBTP,
 * EBU R128). −16.3 → −23 LUFS = −6.7 dB. Rate-free.
 */
export function normaliseGain(
  measuredLufs: number,
  targetLufs: number,
  truePeakDbtp?: number | null,
  maxTruePeakDbtp = -1,
): NormaliseResult | AudioError {
  for (const [n, v] of [
    ["measured loudness", measuredLufs],
    ["target", targetLufs],
    ["true-peak ceiling", maxTruePeakDbtp],
  ] as [string, number][]) {
    if (typeof v !== "number" || !Number.isFinite(v)) return fail(`The ${n} must be a finite number.`);
  }
  if (measuredLufs <= ABSOLUTE_GATE) {
    return fail("An integrated loudness at or below −70 LUFS cannot be measured: the absolute gate removes every block.");
  }
  if (measuredLufs > 10) return fail("An integrated loudness above +10 LUFS is not a real programme measurement.");
  if (targetLufs <= ABSOLUTE_GATE || targetLufs > 0) return fail("A loudness target lies between −70 and 0 LUFS.");
  if (maxTruePeakDbtp > 3.0103) return fail("A true-peak ceiling above +3 dBTP is not a delivery specification.");
  const gain = targetLufs - measuredLufs;
  let tp: number | null = null;
  let limiter: boolean | null = null;
  const notes = [
    `Gain = target − measured = ${fmtNum(targetLufs)} − (${fmtNum(measuredLufs)}) = ${gain > 0 ? "+" : gain < 0 ? "−" : ""}${Math.abs(gain).toFixed(2)} dB. ` +
      "LUFS and LKFS are the same scale; 1 LU = 1 dB.",
  ];
  if (truePeakDbtp !== undefined && truePeakDbtp !== null) {
    if (!Number.isFinite(truePeakDbtp)) return fail("The measured true peak must be a finite number of dBTP.");
    if (truePeakDbtp > 20) return fail("A true peak above +20 dBTP is not a real measurement.");
    tp = truePeakDbtp + gain;
    limiter = tp > maxTruePeakDbtp;
    notes.push(
      limiter
        ? `${gain >= 0 ? "+" : ""}${gain.toFixed(2)} dB of gain would put the true peak at ${tp >= 0 ? "+" : ""}${tp.toFixed(2)} dBTP, over ` +
          `the ${fmtNum(maxTruePeakDbtp)} dBTP ceiling: a true-peak limiter is required (and it lowers the loudness slightly).`
        : `True peak after gain: ${tp.toFixed(2)} dBTP, within the ${fmtNum(maxTruePeakDbtp)} dBTP ceiling.`,
    );
  } else {
    notes.push("No measured true peak given: whether a limiter is needed is not known.");
  }
  notes.push(
    "The measured value must be the programme's INTEGRATED loudness from a BS.1770 meter. A peak, RMS or dBFS " +
      "reading is not a substitute.",
  );
  // Loudness (LUFS) and true peak (dBTP) share the chart, so every bar names
  // its own unit rather than leaving the reader one axis label for both.
  const bars = [
    { label: "measured loudness (LUFS)", value: measuredLufs },
    { label: "after gain (LUFS)", value: targetLufs },
  ];
  if (truePeakDbtp !== undefined && truePeakDbtp !== null && tp !== null) {
    bars.push({ label: "true peak before (dBTP)", value: truePeakDbtp }, { label: "true peak after (dBTP)", value: tp });
  }
  return {
    ok: true,
    gainDb: gain,
    offsetLu: measuredLufs - targetLufs,
    resultingTruePeak: tp,
    limiterRequired: limiter,
    notes,
    figure: {
      kind: "bar",
      title: "Loudness and true peak, before and after",
      xLabel: "",
      yLabel: "LUFS / dBTP",
      bars,
      markers: [
        { axis: "y", at: targetLufs, label: "target (LUFS)" },
        { axis: "y", at: maxTruePeakDbtp, label: "true-peak ceiling (dBTP)" },
      ],
    },
  };
}

export const PROGRAMME_LOUDNESS_REFUSAL =
  "Integrated loudness requires the programme audio — not computable from typed numbers. Loudness is gated over " +
  "the whole programme waveform; a single level reading (peak, RMS or dBFS) cannot give it.";

/**
 * The questions this module refuses BY NAME, whatever the phrasing: the
 * integrated loudness, loudness range (LRA) or true peak of a programme from a
 * single reading. Always returns the refusal.
 */
export function programmeLoudnessFromReading(
  what: "integrated" | "lra" | "true-peak" = "integrated",
): AudioError {
  if (what === "lra") {
    return fail(
      "Loudness range (LRA, EBU Tech 3342) is a statistic of the short-term loudness distribution over the whole " +
        "programme — not computable from typed numbers.",
    );
  }
  if (what === "true-peak") {
    return fail(
      "True peak (BS.1770-4 Annex 2) is measured on the 4× oversampled waveform; inter-sample peaks cannot be " +
        "found from a sample-peak or RMS reading — not computable from typed numbers.",
    );
  }
  return fail(PROGRAMME_LOUDNESS_REFUSAL);
}
