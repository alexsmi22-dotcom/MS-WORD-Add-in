// AI compute (Release E3-f, gap #8): the roofline model, transformer parameter / FLOP / memory counts, and the
// low-precision number formats with integer quantisation.
//
// Pure functions; every hardware figure (peak FLOP/s, memory bandwidth) is the CALLER'S input — there is no vendor
// table here. The float formats are computation.ts's FLOAT_FORMATS with its ONE rounding rule (roundToFormat), so
// the Computation tools never give two answers to one question.
//
// Counting conventions (stated in every result by the pane):
//   - 2 FLOPs per multiply-accumulate (Kaplan et al. 2020, arXiv 2001.08361, §2.1: "the factor of two comes from the
//     multiply-accumulate operation used in matrix multiplication").
//   - A kernel's bytes are its MINIMUM traffic: every operand read once and the result written once (perfect on-chip
//     reuse). Real kernels move at least this much, so the arithmetic intensity here is an upper bound.
//   - Transformer layer weights: Q, K, V, O projections and the FFN matrices; biases, layer norms and positional
//     tables left out (Kaplan's Table 1 omits the same sub-leading terms). 12·d² per layer for d_ff = 4d, MHA.
//   - Training activations: Korthikanti et al. 2022 (arXiv 2205.05198) eq. (1), sbh(34 + 5as/h) bytes per layer, which
//     assumes 16-bit activations, 1-byte dropout masks, a 4h two-matrix FFN and multi-head attention; 2sbhL with full
//     recomputation. Outside those assumptions it is not estimated.
//   - Mixed-precision Adam: 2Ψ + 2Ψ + 12Ψ = 16Ψ bytes (Rajbhandari et al. 2020, ZeRO, arXiv 1910.02054).

import { FLOAT_FORMATS, formatConstants, formatUlp, roundToFormat, type FloatFormatId } from "./computation";

export type Res<T> = ({ ok: true } & T) | { ok: false; error: string };

const isPosInt = (v: number): boolean => Number.isInteger(v) && v >= 1;

/** Round half to even (zero points and integer codes; Math.round rounds halves up). */
export function roundHalfEven(x: number): number {
  const n = Math.floor(x);
  const d = x - n;
  if (d > 0.5) return n + 1;
  if (d < 0.5) return n;
  return n % 2 === 0 ? n : n + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Roofline
// ---------------------------------------------------------------------------------------------------------------

export interface KernelWork {
  flops: number;
  bytes: number;
  intensity: number;
}

/** Largest dimension accepted (a sanity bound; the arithmetic is closed form, no loop depends on it). */
export const MAX_DIM = 1e9;

/** C = A·B with A M×K, B K×N: 2MNK FLOPs; minimum traffic e·(MK + KN + MN) bytes. */
export function gemmWork(m: number, n: number, k: number, elemBytes: number): Res<KernelWork> {
  for (const [v, name] of [[m, "M"], [n, "N"], [k, "K"]] as const) {
    if (!isPosInt(v)) return { ok: false, error: `GEMM ${name}: give a whole number of at least 1 (got ${v}).` };
    if (v > MAX_DIM) return { ok: false, error: `GEMM ${name}: ${v} is beyond the 10⁹ this tool accepts.` };
  }
  if (!(elemBytes > 0) || !Number.isFinite(elemBytes)) return { ok: false, error: "Element size: give a positive number of bytes." };
  const flops = 2 * m * n * k;
  const bytes = elemBytes * (m * k + k * n + m * n);
  return { ok: true, flops, bytes, intensity: flops / bytes };
}

export interface ConvInput {
  /** batch */
  n: number;
  /** input channels */
  c: number;
  h: number;
  w: number;
  /** output channels (filters) */
  k: number;
  /** filter height and width */
  r: number;
  s: number;
  stride: number;
  pad: number;
  dil: number;
}

/**
 * Direct 2-D convolution (groups 1, no bias): output P×Q with P = ⌊(H + 2·pad − dil·(R − 1) − 1)/stride⌋ + 1;
 * 2·N·K·P·Q·C·R·S FLOPs; minimum traffic e·(N·C·H·W + K·C·R·S + N·K·P·Q) bytes.
 */
export function conv2dWork(c: ConvInput, elemBytes: number): Res<KernelWork & { p: number; q: number }> {
  const named: Array<[number, string]> = [[c.n, "batch N"], [c.c, "input channels C"], [c.h, "height H"], [c.w, "width W"], [c.k, "filters K"], [c.r, "filter height R"], [c.s, "filter width S"], [c.stride, "stride"], [c.dil, "dilation"]];
  for (const [v, name] of named) {
    if (!isPosInt(v)) return { ok: false, error: `Convolution ${name}: give a whole number of at least 1 (got ${v}).` };
    if (v > MAX_DIM) return { ok: false, error: `Convolution ${name}: ${v} is beyond the 10⁹ this tool accepts.` };
  }
  if (!Number.isInteger(c.pad) || c.pad < 0 || c.pad > MAX_DIM) return { ok: false, error: `Convolution padding: give a whole number of 0 or more (got ${c.pad}).` };
  if (!(elemBytes > 0) || !Number.isFinite(elemBytes)) return { ok: false, error: "Element size: give a positive number of bytes." };
  const p = Math.floor((c.h + 2 * c.pad - c.dil * (c.r - 1) - 1) / c.stride) + 1;
  const q = Math.floor((c.w + 2 * c.pad - c.dil * (c.s - 1) - 1) / c.stride) + 1;
  if (p < 1 || q < 1)
    return { ok: false, error: `The filter (${c.r}×${c.s}, dilation ${c.dil}) does not fit the padded ${c.h}×${c.w} input: the output would be ${p}×${q}.` };
  const flops = 2 * c.n * c.k * p * q * c.c * c.r * c.s;
  const bytes = elemBytes * (c.n * c.c * c.h * c.w + c.k * c.c * c.r * c.s + c.n * c.k * p * q);
  return { ok: true, flops, bytes, intensity: flops / bytes, p, q };
}

export interface RooflineResult {
  /** FLOP/byte where the memory roof meets the compute roof. */
  ridge: number;
  /** FLOP/s the kernel can reach: min(peak, bandwidth × intensity). */
  attainable: number;
  bound: "memory" | "compute" | "balanced";
  /** attainable / peak */
  fractionOfPeak: number;
  /** Lower-bound run time when the FLOP count is known: FLOPs / attainable (s). */
  time: number | null;
  /** measured / attainable, when a measured rate is given. */
  efficiency: number | null;
}

/**
 * The roofline (Williams, Waterman & Patterson 2009): attainable = min(peak, bandwidth·I). Exactly at the ridge the
 * kernel is "balanced". Rates in FLOP/s, bandwidth in byte/s, intensity in FLOP/byte.
 */
export function roofline(peak: number, bandwidth: number, intensity: number, flops: number | null = null, measured: number | null = null): Res<RooflineResult> {
  if (!(peak > 0) || !Number.isFinite(peak)) return { ok: false, error: "Peak compute: give a positive, finite FLOP rate." };
  if (!(bandwidth > 0) || !Number.isFinite(bandwidth)) return { ok: false, error: "Memory bandwidth: give a positive, finite byte rate." };
  if (!(intensity > 0) || !Number.isFinite(intensity)) return { ok: false, error: "Arithmetic intensity: give a positive, finite number of FLOPs per byte." };
  if (flops !== null && (!(flops > 0) || !Number.isFinite(flops))) return { ok: false, error: "FLOP count: give a positive, finite number." };
  if (measured !== null && (!(measured > 0) || !Number.isFinite(measured))) return { ok: false, error: "Measured rate: give a positive, finite FLOP rate." };
  const ridge = peak / bandwidth;
  const memRoof = bandwidth * intensity;
  const attainable = Math.min(peak, memRoof);
  const near = Math.abs(intensity / ridge - 1) <= 1e-12;
  const bound = near ? "balanced" : intensity < ridge ? "memory" : "compute";
  return {
    ok: true,
    ridge,
    attainable,
    bound,
    fractionOfPeak: attainable / peak,
    time: flops === null ? null : flops / attainable,
    efficiency: measured === null ? null : measured / attainable,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Transformer size, FLOPs and memory
// ---------------------------------------------------------------------------------------------------------------

export type AttnFlops = "kaplan" | "full" | "none";

export interface ModelInput {
  d: number;
  layers: number;
  heads: number;
  /** Key/value heads (grouped-query attention); equal to heads for multi-head attention. */
  kvHeads: number;
  /** d_ff / d_model */
  ffnRatio: number;
  /** Gated FFN (SwiGLU/GeGLU: three matrices) instead of two. */
  gated: boolean;
  vocab: number;
  /** Context length (tokens). */
  seq: number;
  batch: number;
  /** Input embedding shared with the output projection. */
  tied: boolean;
  attn: AttnFlops;
  /** Full activation recomputation (checkpointing every layer). */
  recompute: boolean;
}

export interface PrecisionMemory {
  label: string;
  bytesPerElement: number;
  weights: number;
  kvCache: number;
}

export interface ModelResult {
  dff: number;
  dkv: number;
  headDim: number;
  attnParamsPerLayer: number;
  ffnParamsPerLayer: number;
  paramsPerLayer: number;
  /** L × per-layer (Kaplan's N). */
  nonEmbedding: number;
  embedding: number;
  unembedding: number;
  total: number;
  /** Forward FLOPs per token, by term. */
  flopsMatmul: number;
  flopsAttention: number;
  flopsHead: number;
  flopsForward: number;
  /** Forward + backward ≈ 3 × forward (Kaplan: backward ≈ twice the forward). */
  flopsTraining: number;
  /** KV-cache elements for the batch at the full context: 2·L·S·B·d_kv. */
  kvElements: number;
  memory: PrecisionMemory[];
  /** Training activations (bytes) by Korthikanti eq. (1), or null with the reason. */
  activations: number | null;
  activationsWhyNot: string | null;
  /** Mixed-precision Adam (ZeRO): weights 2Ψ, gradients 2Ψ, optimizer states 12Ψ (bytes). */
  trainWeights: number;
  trainGrads: number;
  trainOptimizer: number;
}

/** The precisions the memory table compares (bytes per element; int4 packs two to a byte). */
export const MEMORY_PRECISIONS: Array<{ label: string; bytes: number }> = [
  { label: "fp32", bytes: 4 },
  { label: "fp16 / bf16", bytes: 2 },
  { label: "fp8 / int8", bytes: 1 },
  { label: "int4", bytes: 0.5 },
];

export const MODEL_CAPS = { d: 1e6, layers: 1e4, heads: 1e5, vocab: 1e8, seq: 1e8, batch: 1e6, ffnRatio: 64 };

export function transformerModel(m: ModelInput): Res<ModelResult> {
  const ints: Array<[number, string, number]> = [
    [m.d, "Hidden size d", MODEL_CAPS.d],
    [m.layers, "Layers", MODEL_CAPS.layers],
    [m.heads, "Heads", MODEL_CAPS.heads],
    [m.kvHeads, "KV heads", MODEL_CAPS.heads],
    [m.vocab, "Vocabulary", MODEL_CAPS.vocab],
    [m.seq, "Sequence length", MODEL_CAPS.seq],
    [m.batch, "Batch", MODEL_CAPS.batch],
  ];
  for (const [v, name, cap] of ints) {
    if (!isPosInt(v)) return { ok: false, error: `${name}: give a whole number of at least 1 (got ${v}).` };
    if (v > cap) return { ok: false, error: `${name}: ${v} is beyond the ${cap.toLocaleString("en-US")} this tool accepts.` };
  }
  if (m.d % m.heads !== 0) return { ok: false, error: `The hidden size d = ${m.d} is not divisible by ${m.heads} heads: the head dimension d/h must be a whole number.` };
  if (m.heads % m.kvHeads !== 0) return { ok: false, error: `${m.heads} query heads cannot be shared evenly among ${m.kvHeads} key/value heads (grouped-query attention needs h divisible by the KV heads).` };
  if (!(m.ffnRatio > 0) || !Number.isFinite(m.ffnRatio) || m.ffnRatio > MODEL_CAPS.ffnRatio) return { ok: false, error: "FFN ratio (FFN width over d): give a positive number up to 64." };
  const dffRaw = m.ffnRatio * m.d;
  const dff = Math.round(dffRaw);
  if (Math.abs(dffRaw - dff) > 1e-9 * dffRaw) return { ok: false, error: `The FFN width = ratio × d = ${dffRaw} is not a whole number: give the ratio as FFN width over d exactly (for example 11008/4096 = 2.6875).` };
  const d = m.d, L = m.layers, h = m.heads;
  const headDim = d / h;
  const dkv = headDim * m.kvHeads;
  const attnParamsPerLayer = 2 * d * d + 2 * d * dkv;
  const ffnParamsPerLayer = (m.gated ? 3 : 2) * d * dff;
  const paramsPerLayer = attnParamsPerLayer + ffnParamsPerLayer;
  const nonEmbedding = L * paramsPerLayer;
  const embedding = m.vocab * d;
  const unembedding = m.tied ? 0 : m.vocab * d;
  const total = nonEmbedding + embedding + unembedding;
  const flopsMatmul = 2 * nonEmbedding;
  const flopsAttention = m.attn === "kaplan" ? 2 * L * m.seq * d : m.attn === "full" ? 4 * L * m.seq * d : 0;
  const flopsHead = 2 * d * m.vocab;
  const flopsForward = flopsMatmul + flopsAttention + flopsHead;
  const kvElements = 2 * L * m.seq * m.batch * dkv;
  const memory = MEMORY_PRECISIONS.map((p) => ({ label: p.label, bytesPerElement: p.bytes, weights: total * p.bytes, kvCache: kvElements * p.bytes }));
  let activations: number | null = null;
  let activationsWhyNot: string | null = null;
  const why: string[] = [];
  if (m.gated) why.push("a gated FFN");
  if (Math.abs(m.ffnRatio - 4) > 1e-12) why.push(`an FFN width of ${m.ffnRatio}·d (not 4d)`);
  if (m.kvHeads !== h) why.push("grouped-query attention");
  if (why.length && !m.recompute)
    activationsWhyNot = `Training activations not estimated: the published count (Korthikanti et al. 2022, eq. 1) assumes a two-matrix 4d FFN and multi-head attention, and this model has ${why.join(" and ")}.`;
  else {
    const s = m.seq, b = m.batch;
    activations = m.recompute ? 2 * s * b * d * L : L * s * b * d * (34 + (5 * h * s) / d);
  }
  return {
    ok: true,
    dff,
    dkv,
    headDim,
    attnParamsPerLayer,
    ffnParamsPerLayer,
    paramsPerLayer,
    nonEmbedding,
    embedding,
    unembedding,
    total,
    flopsMatmul,
    flopsAttention,
    flopsHead,
    flopsForward,
    flopsTraining: 3 * flopsForward,
    kvElements,
    memory,
    activations,
    activationsWhyNot,
    trainWeights: 2 * total,
    trainGrads: 2 * total,
    trainOptimizer: 12 * total,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Number formats
// ---------------------------------------------------------------------------------------------------------------

/** The float formats the tool compares, narrowest last. */
export const COMPARED_FORMATS: FloatFormatId[] = ["fp32", "fp16", "bf16", "e4m3fn", "e5m2"];

export interface FloatReport {
  id: FloatFormatId;
  label: string;
  epsilon: number;
  max: number;
  smallestNormal: number;
  smallestSubnormal: number;
  /** -log10(ε/2): decimal digits carried. */
  digits: number;
  /** x rounded (null when it overflows). */
  rounded: number | null;
  overflow: boolean;
  overflowTo: "inf" | "nan";
  underflow: boolean;
  tie: boolean;
  below: number | null;
  above: number | null;
  absError: number | null;
  relError: number | null;
  /** Spacing at the rounded value. */
  ulp: number | null;
}

export function floatReport(id: FloatFormatId, x: number): Res<FloatReport> {
  if (!Number.isFinite(x)) return { ok: false, error: "Value: give a finite number." };
  const f = FLOAT_FORMATS[id];
  const k = formatConstants(f);
  const r = roundToFormat(x, f);
  if (!r) return { ok: false, error: "Value: give a finite number." };
  const absError = r.value === null ? null : Math.abs(r.value - x);
  return {
    ok: true,
    id,
    label: f.label,
    epsilon: k.epsilon,
    max: k.max,
    smallestNormal: k.smallestNormal,
    smallestSubnormal: k.smallestSubnormal,
    digits: -Math.log10(k.epsilon / 2),
    rounded: r.value,
    overflow: r.overflow,
    overflowTo: f.overflow,
    underflow: r.underflow,
    tie: r.tie,
    below: r.below,
    above: r.above,
    absError,
    relError: absError === null || x === 0 ? (x === 0 ? 0 : null) : absError / Math.abs(x),
    ulp: r.value === null ? null : formatUlp(r.value, f),
  };
}

/**
 * Relative spacing ulp(x)/x against x for a format over [xmin, xmax]: the sawtooth, two points per binade (2^-nmant
 * at each power of two, falling towards 2^-(nmant+1) just below the next), the 1/x ramp through the subnormals, ending
 * at the largest finite value. At most `cap` binades (bounded work).
 */
export function spacingCurve(id: FloatFormatId, xmin: number, xmax: number, cap = 600, envelope = false): Array<{ x: number; y: number }> {
  const f = FLOAT_FORMATS[id];
  const k = formatConstants(f);
  const lo = Math.max(xmin, k.smallestSubnormal);
  const hi = Math.min(xmax, k.max);
  const pts: Array<{ x: number; y: number }> = [];
  if (!(lo < hi)) return pts;
  const sub = k.smallestSubnormal;
  if (lo < k.smallestNormal) {
    pts.push({ x: lo, y: sub / lo });
    const end = Math.min(hi, k.smallestNormal);
    pts.push({ x: end, y: sub / end });
  }
  if (envelope) {
    // The binade maximum 2^−nmant only (the upper edge of the sawtooth), for ranges too wide to show each tooth.
    const start = Math.max(lo, k.smallestNormal);
    if (start < hi) pts.push({ x: start, y: k.epsilon }, { x: hi, y: k.epsilon });
    return pts;
  }
  let e = Math.max(f.minExp, Math.floor(Math.log2(lo)) - 1);
  for (let i = 0; i < cap; i++, e++) {
    const a = Math.pow(2, e), b = Math.pow(2, e + 1);
    if (a > hi) break;
    if (b <= lo) continue;
    const q = Math.pow(2, e - f.nmant);
    const x0 = Math.max(a, lo), x1 = Math.min(b, hi);
    pts.push({ x: x0, y: q / x0 }, { x: x1, y: q / x1 });
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// Integer quantisation
// ---------------------------------------------------------------------------------------------------------------

export interface QuantResult {
  bits: 4 | 8;
  symmetric: boolean;
  qmin: number;
  qmax: number;
  scale: number;
  zeroPoint: number;
  /** The range actually quantised (an asymmetric range is widened to include 0). */
  lo: number;
  hi: number;
  widened: boolean;
  /** The largest |x − dequantise(quantise(x))| over the given range, evaluated (not assumed to be scale/2). */
  maxError: number;
  /** The value's code, its dequantised value, its error, and whether it was clipped. */
  q: number | null;
  dequantised: number | null;
  error: number | null;
  clipped: boolean;
}

/**
 * Uniform integer quantisation, q = clamp(round(x/s) + z, qmin, qmax), x̂ = (q − z)·s, round half to even.
 *   symmetric:  z = 0, restricted range ±(2^(b−1) − 1) (±127, ±7), s = max(|lo|, |hi|)/(2^(b−1) − 1).
 *   asymmetric: signed codes [−2^(b−1), 2^(b−1) − 1], the range widened to include 0, s = (hi − lo)/(2^b − 1),
 *               z = clamp(qmin − round(lo/s), qmin, qmax) so that 0 is exactly representable.
 */
export function quantize(lo: number, hi: number, bits: 4 | 8, symmetric: boolean, x: number | null = null): Res<QuantResult> {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ok: false, error: "Range: give finite minimum and maximum values." };
  if (!(hi > lo)) return { ok: false, error: `Range: the maximum (${hi}) must be greater than the minimum (${lo}).` };
  if (x !== null && !Number.isFinite(x)) return { ok: false, error: "Value: give a finite number." };
  const half = Math.pow(2, bits - 1);
  let qmin: number, qmax: number, scale: number, zeroPoint: number, rlo: number, rhi: number;
  let widened = false;
  if (symmetric) {
    qmax = half - 1;
    qmin = -qmax;
    const amax = Math.max(Math.abs(lo), Math.abs(hi));
    scale = amax / qmax;
    zeroPoint = 0;
    rlo = lo;
    rhi = hi;
  } else {
    qmin = -half;
    qmax = half - 1;
    rlo = Math.min(lo, 0);
    rhi = Math.max(hi, 0);
    widened = rlo !== lo || rhi !== hi;
    scale = (rhi - rlo) / (qmax - qmin);
    zeroPoint = Math.min(qmax, Math.max(qmin, qmin - roundHalfEven(rlo / scale)));
  }
  if (!(scale > 0) || !Number.isFinite(scale)) return { ok: false, error: "Range: the scale is zero or not finite; give a range with a non-zero, finite span." };
  const quant = (v: number): number => Math.min(qmax, Math.max(qmin, roundHalfEven(v / scale) + zeroPoint));
  const deq = (q: number): number => (q - zeroPoint) * scale;
  const err = (v: number): number => Math.abs(v - deq(quant(v)));
  // The error over [lo, hi] is piecewise linear: its maximum is at an end (including clipping) or at a midpoint between
  // two codes inside the range, where it is s/2.
  let maxError = Math.max(err(lo), err(hi));
  const gmin = deq(qmin), gmax = deq(qmax);
  const a = Math.max(lo, gmin), b = Math.min(hi, gmax);
  if (b > a) {
    let j = Math.ceil((a - gmin) / scale - 0.5);
    if (j < 0) j = 0;
    const mid = gmin + (j + 0.5) * scale;
    if (mid <= b && mid < gmax) maxError = Math.max(maxError, scale / 2);
  }
  let q: number | null = null, dq: number | null = null, e: number | null = null, clipped = false;
  if (x !== null) {
    const raw = roundHalfEven(x / scale) + zeroPoint;
    q = quant(x);
    clipped = raw !== q;
    dq = deq(q);
    e = Math.abs(x - dq);
  }
  return { ok: true, bits, symmetric, qmin, qmax, scale, zeroPoint, lo: rlo, hi: rhi, widened, maxError, q, dequantised: dq, error: e, clipped };
}
