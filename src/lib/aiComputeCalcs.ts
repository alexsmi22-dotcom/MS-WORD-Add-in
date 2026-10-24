// Pane glue for the Release E AI-compute calculators (gap #8): the roofline, transformer size / FLOPs / memory, and
// the low-precision number formats with integer quantisation. Kept OUT of taskpane.ts; the integrator spreads
// AI_COMPUTE_CALCS into ENG_CALCS (group "Computation & information", which already exists).
//
// No number is computed here: aiCompute.ts and computation.ts own them. This file reads the fields (the roofline's
// rates and sizes through units.ts parseMeasured; counts and dimensionless values as plain numbers), words the result
// under the display contract (U+2212, ×10ⁿ, no em dash, NaN or Infinity in an ok result) and draws. No hardware table:
// peak FLOP/s and bandwidth are the user's figures.

import type { EngCalcDef } from "./engCalc";
import { engReport, kvTable, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig, superscript, timesTen } from "./axis";
import { fieldNumber, trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import { FLOAT_FORMATS, floatPrecision, type FloatFormatId } from "./computation";
import {
  COMPARED_FORMATS,
  conv2dWork,
  floatReport,
  gemmWork,
  quantize,
  roofline,
  transformerModel,
  type AttnFlops,
  type KernelWork,
} from "./aiCompute";
import { memoryBarsSvg, quantStairSvg, rooflineSvg, siPrefix, spacingChartSvg, type MemoryBar } from "./aiComputeCharts";

type AiCalc = EngCalcDef<"Computation & information">;

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Six significant figures, trailing zeros kept (a computed value), ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const n6 = (v: number): string => fmtSig(v, 6);
/** Six significant figures with trailing zeros dropped: a value as the user typed it. */
const trimSig = (v: number, s = 6): string => fmtSig(v, s).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
const NNBSP = String.fromCharCode(0x202f);
/** A whole number with narrow no-break spaces between groups of three (201 326 592); ×10ⁿ beyond 10¹⁵. */
export function intText(v: number): string {
  if (!Number.isFinite(v)) return n6(v);
  if (Math.abs(v) >= 1e15 || !Number.isInteger(v)) return n6(v);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return (v < 0 ? "−" : "") + s;
}

/**
 * The EXACT decimal of a binary floating-point value (every one is a dyadic rational) when it has at most 20
 * significant digits, written plain from 10⁻³ to 10⁵ and as m×10ⁿ outside; otherwise 9 significant figures.
 */
export function exactDec(v: number): string {
  if (v === 0) return "0";
  if (!Number.isFinite(v)) return n6(v);
  const a = Math.abs(v);
  let t = a, fb = 0;
  while (t !== Math.floor(t) && fb < 1100) {
    t *= 2;
    fb++;
  }
  if (fb <= 100 && a < 1e21) {
    const s = a.toFixed(fb);
    const digits = s.replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
    if (digits.length <= 20) {
      const sign = v < 0 ? "−" : "";
      if (a >= 1e-3 && a < 1e5) return sign + (fb ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
      // m×10ⁿ: the exponent is the position of the first significant digit.
      const intPart = s.split(".")[0].replace(/^0+/, "");
      const exp = intPart.length ? intPart.length - 1 : -(s.split(".")[1].search(/[1-9]/) + 1);
      const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
      return `${sign}${mant}${timesTen(exp)}`;
    }
  }
  return fmtSig(v, 9);
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 304);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngReportLine[], notes: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  lines.push(...notes);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : "math" in l ? { math: l.math, fallback: trueMinus(l.fallback) } : l));
  return { ...engReport(clean, extra), outputs };
}

/** A plain dimensionless number: null when blank, NaN when unreadable or followed by a unit. */
function plainOpt(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  return fieldNumber(t);
}

/** A duration with its unit chosen for reading. */
function timeText(s: number): string {
  if (s >= 1) return `${n6(s)} s`;
  if (s >= 1e-3) return `${n6(s * 1e3)} ms`;
  if (s >= 1e-6) return `${n6(s * 1e6)} µs`;
  return `${n6(s * 1e9)} ns`;
}

/** Bytes in SI units (kB = 10³ B … ). */
function bytesText(b: number): string {
  const { factor, prefix } = siPrefix(b);
  return `${n6(b / factor)} ${prefix}B`;
}

// ---------------------------------------------------------------------------------------------------------------
// Unit-aware reading for the roofline (the titrationCalcs.ts / semiconductorCalcs.ts pattern)
// ---------------------------------------------------------------------------------------------------------------

const RATE_PREFIX: Record<string, number> = { "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12)
      conversions.push(`${label}: ${trimSig(m.value)} ${formatUnit(m.unit)} = ${trimSig(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  /**
   * A FLOP rate in TFLOP/s. units.ts has no FLOP (a count is dimensionless), so "312 TFLOP/s", "312 TFLOPS" and the
   * integer "624 TOPS" are rewritten to the same rate in hertz (1/s) and read by the unit layer, so a wrong quantity
   * ("2 TB/s", "5 kg") is refused there. "TFLOPs" (a lower-case s) is the plural of a COUNT, so it is refused by name
   * rather than guessed to be a rate.
   */
  const rate = (key: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    if (/\d\s*[kKMGTPE]?(FLOP|OP)s$/.test(raw)) {
      errors.push(`${label}: "${raw}" reads as a count of operations (FLOPs); a rate is written FLOP/s or FLOPS, for example 312 TFLOP/s.`);
      return NaN;
    }
    const fm = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([kKMGTPE]?)(?:FLOP\/s|FLOPS|OP\/s|OPS)$/i.exec(raw);
    let text = raw;
    let typedUnit: string | null = null;
    if (fm) {
      const p = fm[2] === "K" ? "k" : fm[2];
      if (!(p in RATE_PREFIX)) {
        errors.push(`${label}: "${raw}" has an unknown prefix.`);
        return NaN;
      }
      typedUnit = `${p}${/OP/i.test(raw) && !/FLOP/i.test(raw) ? "OP" : "FLOP"}/s`;
      text = `${Number(fm[1]) * RATE_PREFIX[p]} Hz`;
    }
    const m = parseMeasured(text, "THz");
    if ("error" in m) {
      errors.push(`${label}: "${raw}" is not a FLOP rate; write it as 312 TFLOP/s (or TFLOPS, GFLOP/s, PFLOP/s, TOPS).`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget) || !fm && !m.assumed) {
      errors.push(`${label}: "${raw}" is not a FLOP rate; write it as 312 TFLOP/s (or TFLOPS, GFLOP/s, PFLOP/s, TOPS).`);
      return NaN;
    }
    if (typedUnit && typedUnit !== "TFLOP/s") conversions.push(`${label}: ${trimSig(Number(fm![1]))} ${typedUnit} = ${trimSig(m.inTarget)} TFLOP/s`);
    return m.inTarget * 1e12;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    rateReq: (key: string, label: string): number => rate(key, label, true) as number,
    rateOpt: (key: string, label: string): number | null => rate(key, label, false),
  };
}

/** Whole-number lists ("4096, 4096, 4096") through the ONE number reader. */
function intList(text: string, what: string, count: number): number[] | string {
  const b = readDataBlock(text, what);
  if (!b.ok) return b.error;
  const vals = b.rows.flat();
  if (b.rows.length !== 1 || vals.length !== count || vals.some((v) => v === null))
    return `${what}: give exactly ${count} numbers on one line, separated by commas or spaces.`;
  return vals as number[];
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Roofline
// ---------------------------------------------------------------------------------------------------------------

const ROOF_NOTE =
  "Units: peak compute in TFLOP/s unless you write GFLOP/s, PFLOP/s, FLOPS or TOPS; bandwidth in TB/s unless you write " +
  "GB/s, TiB/s or Gbit/s (converted for you); the element size in bytes (16 bit = 2 B). Hardware figures are yours: no " +
  "device table is built in.";

const rooflineCalc: AiCalc = {
  id: "ai-roofline",
  name: "Roofline: ridge point, attainable FLOP/s, memory- or compute-bound",
  group: "Computation & information",
  unitContract: "converts",
  hint:
    "The roofline model: your accelerator's peak compute and memory bandwidth give the ridge point (FLOP/byte); a " +
    "kernel's arithmetic intensity — typed, or counted for a matrix multiply (GEMM M×N×K) or a 2-D convolution at an " +
    "element size — gives the attainable FLOP/s, whether it is memory- or compute-bound, and (with the FLOP count) " +
    "the shortest run time. Bytes are the minimum traffic (each operand moved once), so the intensity is an upper " +
    "bound. Add a measured rate to see how close the kernel is to its roof.",
  fields: [
    { key: "peak", label: "Peak compute (TFLOP/s; your hardware's figure for this precision)", default: "312 TFLOP/s", kind: "text" },
    { key: "bw", label: "Memory bandwidth (TB/s; your hardware's figure)", default: "2.039 TB/s", kind: "text" },
    {
      key: "kernel",
      label: "Kernel",
      default: "gemm",
      kind: "select",
      options: [
        { value: "gemm", label: "Matrix multiply (GEMM) M×N×K" },
        { value: "conv", label: "2-D convolution (direct, groups 1)" },
        { value: "typed", label: "Type the arithmetic intensity" },
      ],
    },
    { key: "elem", label: "Element size (bytes; 2 B fp16/bf16, 1 B fp8/int8, 0.5 B int4)", default: "2 B", kind: "text" },
    { key: "mnk", label: "GEMM M, N, K (C = A·B, A is M×K)", default: "4096, 4096, 4096", kind: "text" },
    { key: "conv_in", label: "Convolution input N, C, H, W (batch, channels, height, width)", default: "32, 64, 56, 56", kind: "text" },
    { key: "conv_f", label: "Convolution filters K, R, S (count, height, width)", default: "64, 3, 3", kind: "text" },
    { key: "conv_s", label: "Convolution stride, padding, dilation", default: "1, 1, 1", kind: "text" },
    { key: "ai", label: "Arithmetic intensity (FLOP/byte; typed kernel)", default: "10", kind: "text" },
    { key: "flops", label: "FLOP count (typed kernel; optional, for the run time)", default: "", kind: "text" },
    { key: "meas", label: "Measured rate (TFLOP/s; optional)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const peak = u.rateReq("peak", "Peak compute");
    const bw = u.req("bw", "TB/s", "TB/s", "Memory bandwidth") * 1e12;
    const meas = u.rateOpt("meas", "Measured rate");
    const kernel = r("kernel");
    let elem = NaN;
    if (kernel === "gemm" || kernel === "conv") elem = u.req("elem", "B", "B", "Element size");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const lines: EngReportLine[] = [];
    let work: KernelWork | null = null;
    let intensity: number;
    let flops: number | null = null;
    const rows: Array<[string, string, string]> = [];
    if (kernel === "gemm") {
      const d = intList(r("mnk"), "GEMM M, N, K", 3);
      if (typeof d === "string") return refuse(d);
      const g = gemmWork(d[0], d[1], d[2], elem);
      if (!g.ok) return refuse(g.error);
      work = g;
      lines.push(`Kernel: GEMM C = A·B with M = ${intText(d[0])}, N = ${intText(d[1])}, K = ${intText(d[2])}, ${trimSig(elem)} B per element.`);
      lines.push({ math: "F = 2 M N K", fallback: "F = 2·M·N·K (2 FLOPs per multiply-accumulate)" });
      lines.push({ math: "D = e (M K + K N + M N)", fallback: "D = e·(MK + KN + MN) (A and B read once, C written once)" });
    } else if (kernel === "conv") {
      const a = intList(r("conv_in"), "Convolution input N, C, H, W", 4);
      if (typeof a === "string") return refuse(a);
      const fl = intList(r("conv_f"), "Convolution filters K, R, S", 3);
      if (typeof fl === "string") return refuse(fl);
      const st = intList(r("conv_s"), "Convolution stride, padding, dilation", 3);
      if (typeof st === "string") return refuse(st);
      const c = conv2dWork({ n: a[0], c: a[1], h: a[2], w: a[3], k: fl[0], r: fl[1], s: fl[2], stride: st[0], pad: st[1], dil: st[2] }, elem);
      if (!c.ok) return refuse(c.error);
      work = c;
      lines.push(
        `Kernel: 2-D convolution, input ${intText(a[0])}×${intText(a[1])}×${intText(a[2])}×${intText(a[3])} (N×C×H×W), ${intText(fl[0])} filters of ${intText(fl[1])}×${intText(fl[2])}, stride ${st[0]}, padding ${st[1]}, dilation ${st[2]}; output ${intText(c.p)}×${intText(c.q)}; ${trimSig(elem)} B per element.`,
      );
      lines.push({ math: "P = floor((H + 2 p - d (R - 1) - 1)/s) + 1", fallback: "P = ⌊(H + 2p − d(R − 1) − 1)/s⌋ + 1 (Q likewise from W and S)" });
      lines.push({ math: "F = 2 N K P Q C R S", fallback: "F = 2·N·K·P·Q·C·R·S" });
      lines.push({ math: "D = e (N C H W + K C R S + N K P Q)", fallback: "D = e·(NCHW + KCRS + NKPQ) (input, filters, output each moved once)" });
    } else if (kernel === "typed") {
      const t = (r("ai") ?? "").trim().replace(/\s*FLOP\s*\/\s*(B|byte)$/i, "");
      intensity = fieldNumber(t);
      if (!Number.isFinite(intensity)) return refuse(`Arithmetic intensity: "${(r("ai") ?? "").trim()}" is not a number of FLOPs per byte.`);
      const fRaw = (r("flops") ?? "").trim();
      if (fRaw) {
        const fv = fieldNumber(fRaw.replace(/\s*FLOPs?$/i, ""));
        if (!Number.isFinite(fv)) return refuse(`FLOP count: "${fRaw}" is not a number.`);
        flops = fv;
      }
      lines.push(`Kernel: arithmetic intensity I = ${trimSig(intensity)} FLOP/byte (typed)${flops !== null ? `, ${n6(flops)} FLOPs` : ""}.`);
    } else return refuse(`Kernel: "${kernel}" is not one of the choices.`);
    if (work) {
      intensity = work.intensity;
      flops = work.flops;
      lines.push({ math: "I = F/D", fallback: "I = F/D (FLOP/byte)" });
      lines.push(`Work F = ${n6(work.flops)} FLOPs; minimum traffic D = ${n6(work.bytes)} bytes (${bytesText(work.bytes)}); arithmetic intensity I = ${n6(work.intensity)} FLOP/byte.`);
      rows.push(["Work F", n6(work.flops), "FLOPs"], ["Minimum traffic D", n6(work.bytes), "B"], ["Arithmetic intensity I", n6(work.intensity), "FLOP/byte"]);
    }
    const res = roofline(peak, bw, intensity!, flops, meas);
    if (!res.ok) return refuse(res.error);
    const rateText = (v: number): string => { const p = siPrefix(v); return `${n6(v / p.factor)} ${p.prefix}FLOP/s`; };
    lines.push({ math: "I_r = P_peak/B", fallback: "Iᵣ = Pₚₑₐₖ/B (FLOP/byte)" });
    lines.push({ math: "P = min(P_peak, B I)", fallback: "P = min(Pₚₑₐₖ, B·I)" });
    lines.push(`Machine: peak ${rateText(peak)}, bandwidth ${bytesText(bw)}/s (your figures); ridge point Iᵣ = ${n6(res.ridge)} FLOP/byte.`);
    const boundText =
      res.bound === "balanced"
        ? "BALANCED: the kernel sits exactly at the ridge, where memory and compute limits meet"
        : res.bound === "memory"
          ? `MEMORY-BOUND: I is below the ridge, so bandwidth limits it (raising data reuse moves it right)`
          : "COMPUTE-BOUND: I is above the ridge, so the peak FLOP rate limits it";
    lines.push(`Attainable performance P = ${rateText(res.attainable)} (${n6(res.fractionOfPeak * 100)} % of peak); ${boundText}.`);
    rows.push(["Ridge point", n6(res.ridge), "FLOP/byte"], ["Attainable P", n6(res.attainable / 1e12), "TFLOP/s"], ["Bound", res.bound, ""]);
    const outputs: EngOutput[] = [
      { key: "ridge", label: "Ridge point", value: res.ridge, unit: "FLOP/byte" },
      { key: "intensity", label: "Arithmetic intensity", value: intensity!, unit: "FLOP/byte" },
      { key: "attainable", label: "Attainable performance", value: res.attainable / 1e12, unit: "TFLOP/s" },
      { key: "fraction", label: "Fraction of peak", value: res.fractionOfPeak * 100, unit: "%" },
    ];
    if (work) outputs.push({ key: "flops", label: "Work", value: work.flops, unit: "FLOPs" }, { key: "bytes", label: "Minimum traffic", value: work.bytes, unit: "B" });
    if (res.time !== null) {
      lines.push({ math: "t_min = F/P", fallback: "tₘᵢₙ = F/P (the shortest run time)" });
      lines.push(`Shortest run time tₘᵢₙ = ${timeText(res.time)} (no kernel can beat its roof).`);
      rows.push(["Shortest run time", n6(res.time * 1e3), "ms"]);
      outputs.push({ key: "time", label: "Shortest run time", value: res.time * 1e3, unit: "ms" });
    }
    if (res.efficiency !== null && meas !== null) {
      lines.push(`Measured ${rateText(meas)} = ${n6(res.efficiency * 100)} % of the attainable roof.${res.efficiency > 1 ? " ABOVE the roof: check the FLOP count, the element size or the hardware figures (or the data is served from a cache faster than the bandwidth given)." : ""}`);
      rows.push(["Measured / attainable", n6(res.efficiency * 100), "%"]);
      outputs.push({ key: "efficiency", label: "Measured / attainable", value: res.efficiency * 100, unit: "%" });
    }
    lines.push(
      "Model: the roofline (Williams, Waterman & Patterson 2009) with one memory level; 2 FLOPs per multiply-accumulate; traffic is the minimum (each tensor moved once, perfect cache reuse), so real intensity is lower; overlap of transfer and compute is assumed perfect.",
    );
    lines.push(kvTable(rows, "Roofline"));
    const pts = [{ intensity: intensity!, perf: res.attainable, label: `Kernel, I = ${trimSig(intensity!, 4)}`, color: "#c00000" }];
    if (meas !== null) pts.push({ intensity: intensity!, perf: meas, label: "Measured", color: "#2e7d32" });
    const notes = [...(u.conversions.length ? ["Units read: " + u.conversions.join("; ") + "."] : []), ROOF_NOTE];
    return finish(lines, notes, [
      plot(rooflineSvg(peak, bw, pts), "Roofline (log-log)", "Attainable FLOP rate against arithmetic intensity on log-log axes: a rising memory roof meeting a flat compute roof at the ridge point, the kernel marked on the roof"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Transformer size, FLOPs and memory
// ---------------------------------------------------------------------------------------------------------------

const MODEL_NOTE =
  "Units: every field is a count (no unit). Memory in SI bytes (1 GB = 10⁹ B). Quantisation scales, framework overhead and fragmentation are not counted.";

/** A count field: a whole number, no unit (null when blank). */
function countField(r: (k: string) => string, key: string, label: string, errors: string[], blankOk = false): number | null {
  const t = (r(key) ?? "").trim();
  if (!t) {
    if (!blankOk) errors.push(`${label}: this field is required.`);
    return null;
  }
  const v = fieldNumber(t);
  if (!Number.isFinite(v)) {
    errors.push(`${label}: "${t}" is not a number (this field is a count, without a unit).`);
    return null;
  }
  return v;
}

const modelCalc: AiCalc = {
  id: "ai-transformer-size",
  name: "Transformer size: parameters, FLOPs per token, weight / KV-cache / activation memory",
  group: "Computation & information",
  unitContract: "domain",
  hint:
    "A decoder-only transformer from d_model, layers, heads (and key/value heads for grouped-query attention), the " +
    "FFN ratio, vocabulary, sequence length and batch: parameters per layer and in total, forward FLOPs per token " +
    "(2 FLOPs per multiply-accumulate; the attention term counted as you choose) and training FLOPs (3× forward), " +
    "and memory for the weights and KV cache at fp32, fp16/bf16, fp8/int8 and int4, with mixed-precision Adam " +
    "training memory and its activations, drawn as stacked bars.",
  fields: [
    { key: "d", label: "d_model (hidden size)", default: "4096", kind: "text" },
    { key: "layers", label: "Layers L", default: "32", kind: "text" },
    { key: "heads", label: "Attention heads h", default: "32", kind: "text" },
    { key: "kvheads", label: "Key/value heads (grouped-query attention; blank = h)", default: "", kind: "text" },
    { key: "ffn", label: "FFN ratio d_ff/d_model", default: "4", kind: "text" },
    {
      key: "ffntype",
      label: "FFN type",
      default: "plain",
      kind: "select",
      options: [
        { value: "plain", label: "Two matrices (GELU / ReLU)" },
        { value: "gated", label: "Gated, three matrices (SwiGLU / GeGLU)" },
      ],
    },
    { key: "vocab", label: "Vocabulary V", default: "50257", kind: "text" },
    { key: "seq", label: "Sequence length (context, tokens)", default: "2048", kind: "text" },
    { key: "batch", label: "Batch (sequences)", default: "1", kind: "text" },
    {
      key: "tied",
      label: "Output projection",
      default: "tied",
      kind: "select",
      options: [
        { value: "tied", label: "Tied to the input embedding" },
        { value: "untied", label: "Separate (untied) weights" },
      ],
    },
    {
      key: "attn",
      label: "Attention FLOPs per token",
      default: "kaplan",
      kind: "select",
      options: [
        { value: "kaplan", label: "2·L·S·d (Kaplan et al. 2020, Table 1)" },
        { value: "full", label: "4·L·S·d (QKᵀ and A·V over the full context)" },
        { value: "none", label: "Not counted (the 6N rule)" },
      ],
    },
    {
      key: "recompute",
      label: "Training activations",
      default: "none",
      kind: "select",
      options: [
        { value: "none", label: "Stored (no recomputation)" },
        { value: "full", label: "Full recomputation (layer inputs only)" },
      ],
    },
  ],
  compute: (r) => {
    const errors: string[] = [];
    const d = countField(r, "d", "Hidden size d", errors);
    const layers = countField(r, "layers", "Layers", errors);
    const heads = countField(r, "heads", "Heads", errors);
    const kvheads = countField(r, "kvheads", "Key/value heads", errors, true);
    const ffn = countField(r, "ffn", "FFN ratio", errors);
    const vocab = countField(r, "vocab", "Vocabulary", errors);
    const seq = countField(r, "seq", "Sequence length", errors);
    const batch = countField(r, "batch", "Batch", errors);
    if (errors.length) return refuse(errors.join("\n"));
    const gated = r("ffntype") === "gated";
    const tied = r("tied") !== "untied";
    const attn = r("attn") as AttnFlops;
    if (!["kaplan", "full", "none"].includes(attn)) return refuse(`Attention FLOPs: "${attn}" is not one of the choices.`);
    const recompute = r("recompute") === "full";
    const res = transformerModel({ d: d!, layers: layers!, heads: heads!, kvHeads: kvheads ?? heads!, ffnRatio: ffn!, gated, vocab: vocab!, seq: seq!, batch: batch!, tied, attn, recompute });
    if (!res.ok) return refuse(res.error);
    const mha = res.dkv === d;
    const lines: EngReportLine[] = [];
    lines.push(
      `Model: d = ${intText(d!)}, L = ${intText(layers!)}, h = ${intText(heads!)} (head size ${intText(res.headDim)}${mha ? "" : `; ${intText(kvheads!)} key/value heads, dₖᵥ = ${intText(res.dkv)}`}), FFN width f = ${intText(res.dff)} (${gated ? "gated, 3 matrices" : "2 matrices"}), V = ${intText(vocab!)}, context S = ${intText(seq!)}, batch B = ${intText(batch!)}, ${tied ? "tied" : "untied"} output projection.`,
    );
    lines.push({ math: "N_attn = 2 d^2 + 2 d d_kv", fallback: "Nₐₜₜₙ = 2d² + 2d·dₖᵥ (Q, O: d×d; K, V: d×dₖᵥ)" });
    lines.push(gated ? { math: "N_ffn = 3 d d_ff", fallback: "FFN weights = 3·d·f (gate, up, down; f the FFN width)" } : { math: "N_ffn = 2 d d_ff", fallback: "FFN weights = 2·d·f (up, down; f the FFN width)" });
    lines.push({ math: "N = L (N_attn + N_ffn)", fallback: "N = L·(attention + FFN weights) (non-embedding)" });
    lines.push({ math: "C_fwd = 2 N + C_attn + 2 d V", fallback: "forward FLOPs per token = 2N + Cₐₜₜₙ + 2dV" });
    lines.push({ math: "M_KV = 2 L S B d_kv b", fallback: "Mₖᵥ = 2·L·S·B·dₖᵥ·b (keys and values, b bytes per element)" });
    lines.push(
      `Parameters per layer: attention ${intText(res.attnParamsPerLayer)}, FFN ${intText(res.ffnParamsPerLayer)}, total ${intText(res.paramsPerLayer)}${!gated && ffn === 4 && mha ? " (= 12·d²)" : ""}.`,
    );
    lines.push(
      `Non-embedding parameters N = ${intText(res.nonEmbedding)}; embedding ${intText(res.embedding)}${tied ? " (shared with the output projection)" : `, output projection ${intText(res.unembedding)}`}; total ${intText(res.total)} (${n6(res.total)}).`,
    );
    const attnText = attn === "kaplan" ? "2·L·S·d" : attn === "full" ? "4·L·S·d" : "not counted";
    lines.push(
      `Forward FLOPs per token: matrix multiplies 2N = ${n6(res.flopsMatmul)}, attention scores and mixing (${attnText}) ${n6(res.flopsAttention)}, output logits 2dV = ${n6(res.flopsHead)}; total ${n6(res.flopsForward)}. Training ≈ 3 × forward = ${n6(res.flopsTraining)} FLOPs per token.`,
    );
    lines.push(`KV cache at S = ${intText(seq!)}, B = ${intText(batch!)}: ${n6(res.kvElements)} elements.`);
    const memRows: string[][] = [["Precision", "Bytes / element", "Weights (GB)", "KV cache (GB)", "Weights + KV (GB)"]];
    for (const m of res.memory) memRows.push([m.label, trimSig(m.bytesPerElement), n6(m.weights / 1e9), n6(m.kvCache / 1e9), n6((m.weights + m.kvCache) / 1e9)]);
    lines.push({ table: memRows, label: "Inference memory by precision" });
    const trainTotal = res.trainWeights + res.trainGrads + res.trainOptimizer + (res.activations ?? 0);
    lines.push(
      `Training, mixed-precision Adam (16 bytes per parameter: 2 fp16 weights + 2 fp16 gradients + 12 fp32 master weights, momentum and variance; Rajbhandari et al. 2020): ${bytesText(res.trainWeights + res.trainGrads + res.trainOptimizer)} of states.`,
    );
    if (res.activations !== null) {
      lines.push(
        recompute
          ? { math: "M_act = 2 S B d L", fallback: "activation memory = 2·S·B·d·L bytes (full recomputation)" }
          : { math: "M_act = L S B d (34 + (5 h S)/d)", fallback: "activation memory = L·S·B·d·(34 + 5hS/d) bytes" },
      );
      lines.push(
        `Training activations ${bytesText(res.activations)} (Korthikanti et al. 2022, eq. 1${recompute ? ", full recomputation" : ""}: 16-bit activations, 1-byte dropout masks, no tensor or sequence parallelism${recompute ? "" : "; the 5hS/d term stores the S×S attention scores, which fused (flash) attention kernels do not"}); training total ${bytesText(trainTotal)}.`,
      );
    } else if (res.activationsWhyNot) lines.push(res.activationsWhyNot + " Choose full recomputation for the layer-input count, or add your own figure.");
    lines.push(
      "Convention: weights are the Q, K, V, O and FFN matrices plus the embedding; biases, layer norms and positional tables are left out (sub-leading, as in Kaplan et al. 2020); 2 FLOPs per multiply-accumulate; backward ≈ 2 × forward.",
    );
    const fp16 = res.memory[1];
    const outputs: EngOutput[] = [
      { key: "paramsLayer", label: "Parameters per layer", value: res.paramsPerLayer, unit: "" },
      { key: "nonEmbedding", label: "Non-embedding parameters", value: res.nonEmbedding, unit: "" },
      { key: "params", label: "Total parameters", value: res.total, unit: "" },
      { key: "flopsForward", label: "Forward FLOPs per token", value: res.flopsForward, unit: "FLOPs" },
      { key: "flopsTraining", label: "Training FLOPs per token", value: res.flopsTraining, unit: "FLOPs" },
      { key: "weights16", label: "Weights at 16 bit", value: fp16.weights / 1e9, unit: "GB" },
      { key: "kv16", label: "KV cache at 16 bit", value: fp16.kvCache / 1e9, unit: "GB" },
      { key: "trainStates", label: "Mixed-precision Adam states", value: (res.trainWeights + res.trainGrads + res.trainOptimizer) / 1e9, unit: "GB" },
    ];
    if (res.activations !== null) outputs.push({ key: "activations", label: "Training activations", value: res.activations / 1e9, unit: "GB" });
    lines.push(
      kvTable(
        [
          ["Parameters per layer", intText(res.paramsPerLayer), ""],
          ["Total parameters", intText(res.total), ""],
          ["Forward FLOPs per token", n6(res.flopsForward), "FLOPs"],
          ["Training FLOPs per token", n6(res.flopsTraining), "FLOPs"],
          ["Training memory (states" + (res.activations !== null ? " + activations" : "") + ")", n6(trainTotal / 1e9), "GB"],
        ],
        "Model summary",
      ),
    );
    // Two figures, each on its own scale: training memory (activations especially, which grow with S²) can be hundreds
    // of times the inference footprint, and one shared axis would flatten the inference bars to slivers.
    const bars: MemoryBar[] = res.memory.map((m) => ({ label: m.label, segments: [{ name: "Weights", bytes: m.weights }, { name: "KV cache", bytes: m.kvCache }] }));
    const train: MemoryBar[] = [
      {
        label: "Mixed-precision Adam",
        segments: [
          { name: "Weights", bytes: res.trainWeights },
          { name: "Gradients", bytes: res.trainGrads },
          { name: "Optimizer states", bytes: res.trainOptimizer },
          { name: "Activations", bytes: res.activations ?? 0 },
        ],
      },
    ];
    return finish(lines, [MODEL_NOTE], [
      plot(memoryBarsSvg(bars, `Inference memory, ${trimSig(res.total, 4)} parameters, S = ${intText(seq!)}, B = ${intText(batch!)}`), "Inference memory by precision", "Stacked horizontal bars of inference memory, weights and KV cache, at fp32, fp16 or bf16, fp8 or int8, and int4"),
      plot(memoryBarsSvg(train, "Training memory"), "Training memory (mixed-precision Adam)", "One stacked horizontal bar of training memory: fp16 weights, gradients, fp32 optimizer states and activations"),
    ], outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Number formats and quantisation
// ---------------------------------------------------------------------------------------------------------------

const FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "fp32", label: "fp32 (binary32)" },
  { value: "fp16", label: "fp16 (binary16)" },
  { value: "bf16", label: "bf16 (bfloat16)" },
  { value: "e4m3fn", label: "fp8 E4M3 (fn: finite, NaN only)" },
  { value: "e5m2", label: "fp8 E5M2" },
  { value: "int8s", label: "int8, symmetric quantisation" },
  { value: "int8a", label: "int8, asymmetric (zero point)" },
  { value: "int4s", label: "int4, symmetric quantisation" },
  { value: "int4a", label: "int4, asymmetric (zero point)" },
];

const formatsCalc: AiCalc = {
  id: "ai-number-formats",
  name: "Number formats: fp32, fp16, bf16, fp8, int8 / int4 quantisation",
  group: "Computation & information",
  unitContract: "same-units",
  hint:
    "A floating-point format's machine epsilon, largest value, smallest normal and subnormal, and a value's nearest " +
    "representable neighbours with its rounding error (round to nearest, ties to even), compared across fp32, fp16, " +
    "bf16, fp8 E4M3 and E5M2; or integer quantisation (int8, int4; symmetric or with a zero point) of a range: scale, " +
    "zero point, the largest rounding error, and a value's code. Values are plain numbers in any one unit.",
  fields: [
    { key: "fmt", label: "Format", default: "fp16", kind: "select", options: FORMAT_OPTIONS },
    { key: "x", label: "Value x", default: "0.1", kind: "text" },
    { key: "lo", label: "Range minimum (integer quantisation)", default: "-1.5", kind: "text" },
    { key: "hi", label: "Range maximum (integer quantisation)", default: "3.0", kind: "text" },
  ],
  compute: (r) => {
    const fmt = r("fmt");
    const x = plainOpt(r("x"));
    if (x !== null && !Number.isFinite(x)) return refuse(`Value x: "${(r("x") ?? "").trim()}" is not a number (this tool reads plain numbers; there is nothing to convert).`);
    /** The value as typed (the double behind "0.1" is 0.1000000000000000055…; the user typed 0.1). */
    const typed = (r("x") ?? "").trim().replace(/^[-–]/, "−");
    const xTyped = /^[−+]?(\d+\.?\d*|\.\d+)$/.test(typed) ? typed : x !== null && Number.isFinite(x) ? trimSig(x, 15) : typed;
    const intm = /^int([48])([sa])$/.exec(fmt);
    if (intm) {
      const lo = plainOpt(r("lo"));
      const hi = plainOpt(r("hi"));
      if (lo === null || hi === null) return refuse("Range: give both the minimum and the maximum to quantise.");
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return refuse("Range: the minimum and maximum must be plain numbers.");
      const bits = Number(intm[1]) as 4 | 8;
      const sym = intm[2] === "s";
      const q = quantize(lo, hi, bits, sym, x);
      if (!q.ok) return refuse(q.error);
      const lines: EngReportLine[] = [];
      lines.push(`int${bits} ${sym ? "symmetric" : "asymmetric"} quantisation of [${trimSig(lo)}, ${trimSig(hi)}]: codes ${q.qmin} to ${q.qmax}.`);
      if (sym) lines.push({ math: `s = max(|x_min|, |x_max|)/${q.qmax}`, fallback: `s = max(|xₘᵢₙ|, |xₘₐₓ|)/${q.qmax}, zero point z = 0` });
      else {
        lines.push({ math: `s = (x_max - x_min)/${q.qmax - q.qmin}`, fallback: `s = (xₘₐₓ − xₘᵢₙ)/${q.qmax - q.qmin}` });
        lines.push({ math: `z = q_min - round(x_min/s)`, fallback: "z = qₘᵢₙ − round(xₘᵢₙ/s), clamped to the code range" });
      }
      lines.push({ math: "q = clamp(round(x/s) + z, q_min, q_max)", fallback: "q = clamp(round(x/s) + z, qₘᵢₙ, qₘₐₓ), round half to even" });
      lines.push({ math: "x_q = (q - z) s", fallback: "x̂ = (q − z)·s" });
      if (q.widened) lines.push(`The range does not contain 0, so it is widened to [${trimSig(q.lo)}, ${trimSig(q.hi)}] to make zero exactly representable (the usual convention); the scale is set by the widened range.`);
      lines.push(`Scale s = ${n6(q.scale)}; zero point z = ${q.zeroPoint}; largest rounding error over the range ${n6(q.maxError)} (evaluated${Math.abs(q.maxError - q.scale / 2) <= 1e-12 * q.scale ? "; = s/2" : ""}).`);
      const rows: Array<[string, string, string]> = [
        ["Scale s", n6(q.scale), ""],
        ["Zero point z", String(q.zeroPoint), ""],
        ["Largest rounding error", n6(q.maxError), ""],
      ];
      const outputs: EngOutput[] = [
        { key: "scale", label: "Scale", value: q.scale, unit: "" },
        { key: "zeroPoint", label: "Zero point", value: q.zeroPoint, unit: "" },
        { key: "maxError", label: "Largest rounding error", value: q.maxError, unit: "" },
      ];
      if (x !== null && q.q !== null && q.dequantised !== null && q.error !== null) {
        lines.push(`x = ${trimSig(x)} → code q = ${q.q}, dequantised x̂ = ${n6(q.dequantised)}, error ${n6(q.error)}${q.clipped ? ` (CLIPPED: x lies outside the representable range [${n6((q.qmin - q.zeroPoint) * q.scale)}, ${n6((q.qmax - q.zeroPoint) * q.scale)}])` : ""}.`);
        rows.push(["Code q", String(q.q), ""], ["Dequantised x̂", n6(q.dequantised), ""], ["Error |x − x̂|", n6(q.error), ""]);
        outputs.push({ key: "q", label: "Code", value: q.q, unit: "" }, { key: "dequantised", label: "Dequantised value", value: q.dequantised, unit: "" }, { key: "error", label: "Rounding error", value: q.error, unit: "" });
      }
      lines.push(
        `Convention: uniform per-tensor quantisation; ${sym ? `the restricted symmetric range ±${q.qmax} (the code ${q.qmin - 1} is unused)` : "signed codes with an integer zero point"}; round half to even. Per-channel or block scales (and their storage) are not modelled.`,
      );
      lines.push(kvTable(rows, `int${bits} quantisation`));
      return finish(lines, ["Units: plain numbers; the scale and errors are in the unit of the range."], [
        plot(quantStairSvg(q, x), `int${bits} ${sym ? "symmetric" : "asymmetric"} quantisation`, "Dequantised value against input over the range: a staircase following the identity line, flat beyond the clipping limits, the value marked"),
      ], outputs);
    }
    if (!(fmt in FLOAT_FORMATS) || fmt === "fp64") return refuse(`Format: "${fmt}" is not one of the choices.`);
    const id = fmt as FloatFormatId;
    const xv = x ?? 1;
    const rep = floatReport(id, xv);
    if (!rep.ok) return refuse(rep.error);
    const f = FLOAT_FORMATS[id];
    const lines: EngReportLine[] = [];
    lines.push(`${f.label}: ${f.bits} bits = 1 sign + ${f.nexp} exponent + ${f.nmant} mantissa bits; round to nearest, ties to even.`);
    lines.push({ math: `ε = 2^{-${f.nmant}}`, fallback: `ε = 2${superscript(-f.nmant)} (the spacing just above 1)` });
    lines.push({ math: "ulp(x) = 2^{e - p}", fallback: "ulp(x) = 2ᵉ⁻ᵖ with e = ⌊log₂|x|⌋ (e = eₘᵢₙ below the smallest normal), p mantissa bits" });
    lines.push({ math: "|x - x_r|/|x| ≤ ε/2", fallback: "|x − x̃|/|x| ≤ ε/2 for x̃ the rounded value, in the normal range (round to nearest)" });
    lines.push(
      `Machine epsilon ε = ${exactDec(rep.epsilon)}; about ${trimSig(rep.digits, 3)} decimal digits; largest finite ${exactDec(rep.max)}; smallest normal ${exactDec(rep.smallestNormal)}; smallest subnormal ${exactDec(rep.smallestSubnormal)}.`,
    );
    const outputs: EngOutput[] = [
      { key: "epsilon", label: "Machine epsilon", value: rep.epsilon, unit: "" },
      { key: "max", label: "Largest finite value", value: rep.max, unit: "" },
      { key: "smallestNormal", label: "Smallest normal", value: rep.smallestNormal, unit: "" },
      { key: "smallestSubnormal", label: "Smallest subnormal", value: rep.smallestSubnormal, unit: "" },
    ];
    if (x !== null) {
      if (rep.overflow) {
        lines.push(
          `x = ${trimSig(x)} is beyond the largest finite value ${exactDec(rep.max)}: round-to-nearest conversion OVERFLOWS ${rep.overflowTo === "inf" ? `to ${x < 0 ? "−" : "+"}∞` : "(E4M3fn has no infinity; the result is its not-a-number code)"}. A saturating conversion, common in fp8 kernels, gives ${x < 0 ? "−" : ""}${exactDec(rep.max)}.`,
        );
      } else {
        const fp = floatPrecision(xv, undefined, id);
        lines.push(
          `x = ${xTyped} rounds to ${exactDec(rep.rounded!)}${rep.underflow ? " (UNDERFLOW: below half the smallest subnormal)" : ""}${rep.tie ? " (exactly halfway: ties to even)" : ""}; neighbours ${rep.below !== null ? exactDec(rep.below) : "none"} and ${rep.above !== null ? exactDec(rep.above) : "none (past the largest finite value)"}.`,
        );
        lines.push(`Rounding error |x − x̃| = ${n6(rep.absError!)}${rep.relError !== null && x !== 0 ? `, relative ${n6(rep.relError)}` : ""}; spacing there ulp = ${exactDec(rep.ulp!)}${fp && x !== 0 ? ` (relative ${n6(fp.relativeSpacing)})` : ""}.`);
        outputs.push({ key: "rounded", label: "Nearest representable value", value: rep.rounded!, unit: "" }, { key: "absError", label: "Rounding error", value: rep.absError!, unit: "" });
        if (rep.relError !== null) outputs.push({ key: "relError", label: "Relative rounding error", value: rep.relError, unit: "" });
        outputs.push({ key: "ulp", label: "Spacing at the value", value: rep.ulp!, unit: "" });
      }
    }
    const table: string[][] = [["Format", "ε", "Largest finite", "Smallest normal", "Smallest subnormal", x !== null ? `${trimSig(x)} rounds to` : "Digits"]];
    for (const fid of COMPARED_FORMATS) {
      const t = floatReport(fid, xv);
      if (!t.ok) continue;
      const last = x === null ? n6(t.digits) : t.overflow ? (t.overflowTo === "inf" ? "overflow (∞)" : "overflow (no ∞ code)") : exactDec(t.rounded!);
      table.push([FLOAT_FORMATS[fid].label, exactDec(t.epsilon), exactDec(t.max), exactDec(t.smallestNormal), exactDec(t.smallestSubnormal), last]);
    }
    lines.push({ table, label: "Floating-point formats compared" });
    lines.push(
      "Values are exact decimals where they fit in 20 significant digits, otherwise 9 significant figures. Rounding is one step from the typed value's double (no detour through fp32). E4M3fn follows the OCP 8-bit specification: no infinities, largest finite 448.",
    );
    return finish(lines, ["Units: plain numbers (the formats are unit-free)."], [
      plot(spacingChartSvg(id, x), "Relative spacing of floating-point formats", "Relative spacing ulp over magnitude against magnitude on log-log axes for fp32, fp16, bf16, E4M3 and E5M2: sawtooth bands at two to the minus mantissa bits, rising through each format's subnormals and ending at its largest value"),
    ], outputs);
  },
};

export const AI_COMPUTE_CALCS: AiCalc[] = [rooflineCalc, modelCalc, formatsCalc];
