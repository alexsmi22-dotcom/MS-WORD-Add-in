// Release E3-f: AI compute. The FIXED CASE TABLE from the brief (oracle ~/jurislab-relE/oracle_e3.py, "--- AI
// compute") is pinned twice: on the engine (aiCompute.ts / computation.ts) and through the pane's own registry
// (AI_COMPUTE_CALCS compute → named outputs). Later fix rounds keep every row (cumulative gate).
//
// Further reference values, Python venv C:\Users\AlexanderSmith\jurislab-oracle-venv (numpy 2, ml_dtypes):
//   import numpy as np, ml_dtypes
//   T = {fp32: np.float32, fp16: np.float16, bf16: ml_dtypes.bfloat16, e4m3fn: ml_dtypes.float8_e4m3fn, e5m2: ml_dtypes.float8_e5m2}
//   ml_dtypes.finfo(t): eps / max / smallest_normal / smallest_subnormal
//     fp32   1.1920928955078125e-07  3.4028234663852886e+38  1.1754943508222875e-38  1.401298464324817e-45
//     fp16   0.0009765625            65504                   6.103515625e-05         5.960464477539063e-08
//     bf16   0.0078125               3.3895313892515355e+38  1.1754943508222875e-38  9.183549615799121e-41
//     e4m3fn 0.125                   448                     0.015625                0.001953125
//     e5m2   0.25                    57344                   6.103515625e-05         1.52587890625e-05
//   float(t(np.float64(x))) for x, in the order fp32, fp16, bf16, e4m3fn, e5m2 (nan / inf = overflow):
//     0.1      0.10000000149011612 0.0999755859375 0.10009765625 0.1015625 0.09375
//     1/3      0.3333333432674408 0.333251953125 0.333984375 0.34375 0.3125
//     300      300 300 300 288 320
//     449      449 449 448 448 448
//     464      464 464 464 448 448          (E4M3fn: 464 is the tie between 448 and the NaN code; even → 448)
//     465      465 465 464 nan 448
//     1000     1000 1000 1000 nan 1024
//     65519    65519 65504 65536 nan inf
//     65520    65520 inf 65536 nan inf      (fp16: the tie above 65504 rounds to even = ∞)
//     61440    61440 61440 61440 nan inf    (E5M2: the tie between 57344 and 65536)
//     0.001    0.0010000000474974513 0.0010004043579101562 0.00099945068359375 0.001953125 0.0009765625
//     0.000732421875   exact in fp32/fp16/bf16/e5m2; 0 in e4m3fn (below half its smallest subnormal)
//     0.0009765625     exact except e4m3fn 0 (exactly half the smallest subnormal: ties to even → 0)
//     1e-09    9.999999717180685e-10 0 9.968061931431293e-10 0 0
//     1e-39    1.0000002153053333e-39 0 1.0101904577379033e-39 0 0
//     -2.7     -2.700000047683716 -2.69921875 -2.703125 -2.75 -2.5
//     3.14159  3.141590118408203 3.140625 3.140625 3.25 3
//     1.1875   1.1875 1.1875 1.1875 1.25 1.25
//     240      240 240 240 240 256
//   DOUBLE ROUNDING IN THE ORACLE: float(ml_dtypes.bfloat16(np.float64(1 + 2**-8 + 2**-30))) is 1.0 — ml_dtypes goes
//   double → fp32 → bf16 and rounds twice. Correctly rounded from the double it is 1.0078125 (above the midpoint
//   1 + 2⁻⁸); this tool rounds once, so that row is pinned at the IEEE value. fp16 and E4M3 are single-rounded in
//   ml_dtypes (1 + 2⁻¹¹ + 2⁻⁴⁰ → 1.0009765625; 1 + 2⁻⁴ + 2⁻⁴⁰ → 1.125) and agree.
//   Convolution N32 C64 H56 W56 K64 R3 S3 stride 1 pad 1 dil 1, 2 B: P = Q = 56, F 7398752256, D 25763840, I 287.1758346581876
//   Convolution N1 C3 H224 W224 K64 R7 S7 stride 2 pad 3, 2 B:       P = Q = 112, F 236027904, D 1925504, I 122.57980456026058
//   GEMV M1 N4096 K4096, 1 B; peak 5e15, 8e12 B/s:  F 33554432, D 16785408, I 1.9990239141044412, P 15992191312835.53
//   typed I 0.25, peak 19.5e12, 900e9 B/s: ridge 21.666666666666668, P 2.25e11, t(1e9 FLOPs) 0.0044444444444444444 s
//   Transformer d4096 L32 h32 r4 V50257 S2048 B1 tied (Kaplan attention 2·L·S·d):
//     N 6442450944, total 6648303616, forward 13833478144, training 41500434432, KV 16-bit 1073741824 B,
//     activations L·s·b·h·(34 + 5as/h) = 30601641984 B, mixed-precision Adam 16Ψ = 106372857856 B
//   GQA d4096 L32 h32 kv8 r3.5 gated V128256 S8192 B8 untied: per layer 218103808, N 6979321856, total 8029995008,
//     forward 17156800512, KV 16-bit 8589934592 B
//   int8 asymmetric [−1.5, 3]: s = 4.5/255 = 0.01764705882352941, z = −128 − round(−1.5/s) = −43;
//     0.1 → −37, x̂ 0.10588235294117647; 5 → 127 (clipped), x̂ 3; max error (brute force, 2·10⁶ points) 0.0088235 = s/2
//   int4 symmetric [−1.5, 3]: s = 3/7 = 0.42857142857142855, max error s/2; 0.1 → 0; 2.9 → 7, x̂ 3
//   int4 asymmetric [0.5, 4] → widened [0, 4]: s = 4/15, z = −8; 5 → 7 (clipped); 1 → −4, x̂ 1.0666666666666667

import { FLOAT_FORMATS, floatPrecision, formatConstants, roundToFormat, type FloatFormatId } from "../computation";
import { conv2dWork, floatReport, gemmWork, quantize, roofline, spacingCurve, transformerModel, type ModelInput } from "../aiCompute";
import { AI_COMPUTE_CALCS, exactDec, intText } from "../aiComputeCalcs";
import { memoryBarsSvg, quantStairSvg, rooflineSvg, spacingChartSvg } from "../aiComputeCharts";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = AI_COMPUTE_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no ${id}`);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key} in ${o.text}`);
  return v.value;
};

const DEFAULT_MODEL: ModelInput = { d: 4096, layers: 32, heads: 32, kvHeads: 32, ffnRatio: 4, gated: false, vocab: 50257, seq: 2048, batch: 1, tied: true, attn: "kaplan", recompute: false };

// ---------------------------------------------------------------------------------------------------------------
// The brief's case table
// ---------------------------------------------------------------------------------------------------------------

describe("brief case table — engine", () => {
  test("GEMM 4096³ fp16 → 1.37439×10¹¹ FLOPs, 1.00663×10⁸ bytes, 1365.33 FLOP/byte", () => {
    const g = gemmWork(4096, 4096, 4096, 2);
    if (!g.ok) throw new Error(g.error);
    expect(g.flops).toBe(137438953472);
    expect(g.bytes).toBe(100663296);
    expect(rel(g.intensity, 1365.3333333333333)).toBeLessThan(1e-14);
  });
  test("312 TFLOP/s, 2.039 TB/s → ridge 153.016, attainable 312 TFLOP/s, compute-bound", () => {
    const r = roofline(312e12, 2.039e12, 1365.3333333333333);
    if (!r.ok) throw new Error(r.error);
    expect(rel(r.ridge, 153.01618440411966)).toBeLessThan(1e-12);
    expect(r.attainable).toBe(312e12);
    expect(r.bound).toBe("compute");
  });
  test("12·d² parameters per layer for d 4096 → 201 326 592", () => {
    const m = transformerModel(DEFAULT_MODEL);
    if (!m.ok) throw new Error(m.error);
    expect(m.paramsPerLayer).toBe(201326592);
    expect(m.paramsPerLayer).toBe(12 * 4096 * 4096);
  });
  test.each([
    ["fp16", 9.765625e-4, 65504, 6.103515625e-5],
    ["bf16", 7.8125e-3, 3.3895313892515355e38, 1.1754943508222875e-38],
    ["e4m3fn", 0.125, 448, 0.015625],
    ["e5m2", 0.25, 57344, 6.103515625e-5],
  ] as const)("%s ε %p, max %p, smallest normal %p", (id, eps, max, sn) => {
    const k = formatConstants(FLOAT_FORMATS[id]);
    expect(k.epsilon).toBe(eps);
    expect(k.max).toBe(max);
    expect(k.smallestNormal).toBe(sn);
  });
  test.each([
    ["fp16", 0.0999755859375],
    ["bf16", 0.10009765625],
    ["e4m3fn", 0.1015625],
  ] as const)("0.1 → %s %p", (id, v) => {
    expect(roundToFormat(0.1, FLOAT_FORMATS[id])!.value).toBe(v);
  });
  test("int8 symmetric over [−1.5, 3.0] → scale 0.0236220, max rounding error 0.0118110", () => {
    const q = quantize(-1.5, 3, 8, true);
    if (!q.ok) throw new Error(q.error);
    expect(rel(q.scale, 3 / 127)).toBeLessThan(1e-15);
    expect(rel(q.maxError, 3 / 127 / 2)).toBeLessThan(1e-12);
    expect(q.zeroPoint).toBe(0);
  });
});

describe("brief case table — through the pane registry (named outputs)", () => {
  test("roofline defaults: the GEMM case", () => {
    const o = run("ai-roofline");
    expect(o.ok).not.toBe(false);
    expect(out(o, "flops")).toBe(137438953472);
    expect(out(o, "bytes")).toBe(100663296);
    expect(rel(out(o, "intensity"), 1365.3333333333333)).toBeLessThan(1e-12);
    expect(rel(out(o, "ridge"), 153.01618440411966)).toBeLessThan(1e-12);
    expect(rel(out(o, "attainable"), 312)).toBeLessThan(1e-12);
    expect(o.text).toMatch(/COMPUTE-BOUND/);
    expect(o.text).toMatch(/1\.37439×10¹¹ FLOPs/);
    expect(o.text).toMatch(/1365\.33 FLOP\/byte/);
    expect(o.text).toMatch(/153\.016 FLOP\/byte/);
  });
  test("transformer defaults: 201 326 592 parameters per layer", () => {
    const o = run("ai-transformer-size");
    expect(out(o, "paramsLayer")).toBe(201326592);
    expect(o.text).toContain(`total ${intText(201326592)} (= 12·d²)`);
    expect(intText(201326592)).toBe(["201", "326", "592"].join(String.fromCharCode(0x202f)));
  });
  test.each([
    ["fp16", 9.765625e-4, 65504, 6.103515625e-5, 0.0999755859375],
    ["bf16", 7.8125e-3, 3.3895313892515355e38, 1.1754943508222875e-38, 0.10009765625],
    ["e4m3fn", 0.125, 448, 0.015625, 0.1015625],
    ["e5m2", 0.25, 57344, 6.103515625e-5, 0.09375],
  ] as const)("number formats %s at 0.1", (fmt, eps, max, sn, r01) => {
    const o = run("ai-number-formats", { fmt, x: "0.1" });
    expect(out(o, "epsilon")).toBe(eps);
    expect(out(o, "max")).toBe(max);
    expect(out(o, "smallestNormal")).toBe(sn);
    expect(out(o, "rounded")).toBe(r01);
  });
  test("bf16 max shown as 3.38953…×10³⁸, fp16 ε as 9.765625×10⁻⁴", () => {
    expect(run("ai-number-formats", { fmt: "bf16" }).text).toMatch(/largest finite 3\.38953\d*×10³⁸/);
    expect(run("ai-number-formats", { fmt: "fp16" }).text).toMatch(/ε = 9\.765625×10⁻⁴/);
  });
  test("int8 symmetric over [−1.5, 3.0] → scale 0.0236220, max rounding error 0.0118110", () => {
    const o = run("ai-number-formats", { fmt: "int8s", lo: "-1.5", hi: "3.0" });
    expect(rel(out(o, "scale"), 0.023622047244094488)).toBeLessThan(1e-12);
    expect(rel(out(o, "maxError"), 0.011811023622047244)).toBeLessThan(1e-12);
    expect(o.text).toMatch(/Scale s = 0\.0236220/);
    expect(o.text).toMatch(/0\.0118110/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Number formats against ml_dtypes
// ---------------------------------------------------------------------------------------------------------------

const ORDER: FloatFormatId[] = ["fp32", "fp16", "bf16", "e4m3fn", "e5m2"];
const N = null; // overflow (nan / inf in ml_dtypes)
const ROUNDING: Array<[number, Array<number | null>]> = [
  [0.1, [0.10000000149011612, 0.0999755859375, 0.10009765625, 0.1015625, 0.09375]],
  [1 / 3, [0.3333333432674408, 0.333251953125, 0.333984375, 0.34375, 0.3125]],
  [300, [300, 300, 300, 288, 320]],
  [449, [449, 449, 448, 448, 448]],
  [464, [464, 464, 464, 448, 448]],
  [465, [465, 465, 464, N, 448]],
  [1000, [1000, 1000, 1000, N, 1024]],
  [65519, [65519, 65504, 65536, N, N]],
  [65520, [65520, N, 65536, N, N]],
  [61440, [61440, 61440, 61440, N, N]],
  [0.001, [0.0010000000474974513, 0.0010004043579101562, 0.00099945068359375, 0.001953125, 0.0009765625]],
  [0.000732421875, [0.000732421875, 0.000732421875, 0.000732421875, 0, 0.000732421875]],
  [0.0009765625, [0.0009765625, 0.0009765625, 0.0009765625, 0, 0.0009765625]],
  [1e-9, [9.999999717180685e-10, 0, 9.968061931431293e-10, 0, 0]],
  [1e-39, [1.0000002153053333e-39, 0, 1.0101904577379033e-39, 0, 0]],
  [-2.7, [-2.700000047683716, -2.69921875, -2.703125, -2.75, -2.5]],
  [3.14159, [3.141590118408203, 3.140625, 3.140625, 3.25, 3]],
  [1.1875, [1.1875, 1.1875, 1.1875, 1.25, 1.25]],
  [240, [240, 240, 240, 240, 256]],
];

describe("roundToFormat agrees with ml_dtypes (round to nearest, ties to even)", () => {
  test.each(ROUNDING)("x = %p", (x, want) => {
    ORDER.forEach((id, i) => {
      const r = roundToFormat(x, FLOAT_FORMATS[id])!;
      expect({ id, v: r.value === null ? null : r.value }).toEqual({ id, v: want[i] === null ? null : want[i] });
      expect(r.overflow).toBe(want[i] === null);
    });
  });
  test("format constants match finfo, smallest subnormals included", () => {
    const sub: Record<string, number> = { fp32: 1.401298464324817e-45, fp16: 5.960464477539063e-8, bf16: 9.183549615799121e-41, e4m3fn: 0.001953125, e5m2: 1.52587890625e-5 };
    for (const id of ORDER) expect(formatConstants(FLOAT_FORMATS[id]).smallestSubnormal).toBe(sub[id]);
    expect(formatConstants(FLOAT_FORMATS.fp32).max).toBe(3.4028234663852886e38);
    expect(formatConstants(FLOAT_FORMATS.fp32).epsilon).toBe(1.1920928955078125e-7);
  });
  test("single rounding from the double: bf16(1 + 2⁻⁸ + 2⁻³⁰) = 1.0078125 (ml_dtypes double-rounds to 1)", () => {
    expect(roundToFormat(1 + 2 ** -8 + 2 ** -30, FLOAT_FORMATS.bf16)!.value).toBe(1.0078125);
    expect(roundToFormat(1 + 2 ** -8, FLOAT_FORMATS.bf16)!.value).toBe(1); // the exact tie → even
    expect(roundToFormat(1 + 2 ** -8, FLOAT_FORMATS.bf16)!.tie).toBe(true);
    expect(roundToFormat(1 + 2 ** -11 + 2 ** -40, FLOAT_FORMATS.fp16)!.value).toBe(1.0009765625);
    expect(roundToFormat(1 + 2 ** -4 + 2 ** -40, FLOAT_FORMATS.e4m3fn)!.value).toBe(1.125);
  });
  test("neighbours bracket the value; negative values mirror", () => {
    const r = roundToFormat(0.1, FLOAT_FORMATS.fp16)!;
    expect(r.below).toBe(0.0999755859375);
    expect(r.above).toBe(0.10003662109375);
    const n = roundToFormat(-0.1, FLOAT_FORMATS.fp16)!;
    expect(n.below).toBe(-0.10003662109375);
    expect(n.above).toBe(-0.0999755859375);
    const big = roundToFormat(500, FLOAT_FORMATS.e4m3fn)!;
    expect(big.below).toBe(448);
    expect(big.above).toBeNull();
  });
  test("a subnormal double and zero", () => {
    expect(roundToFormat(1e-310, FLOAT_FORMATS.fp32)!.value).toBe(0);
    expect(roundToFormat(1e-310, FLOAT_FORMATS.fp32)!.underflow).toBe(true);
    expect(roundToFormat(0, FLOAT_FORMATS.e5m2)!.value).toBe(0);
    expect(roundToFormat(Infinity, FLOAT_FORMATS.e5m2)).toBeNull();
  });
});

describe("floatPrecision extended, fp64 unchanged", () => {
  test("fp64 default path is the original", () => {
    const r = floatPrecision(1)!;
    expect(r.epsilon).toBe(Number.EPSILON);
    expect(floatPrecision(1, undefined, "fp64")).toEqual(r);
  });
  test("fp16 at 0.1: ε 2⁻¹⁰, ulp 2⁻¹⁴, 3.31 digits", () => {
    const r = floatPrecision(0.1, undefined, "fp16")!;
    expect(r.epsilon).toBe(2 ** -10);
    expect(r.ulp).toBe(2 ** -14);
    expect(r.decimalDigits).toBeCloseTo(3.3113, 4);
    expect(r.notes[0]).toMatch(/fp16/);
  });
  test("subnormal spacing and overflow", () => {
    expect(floatPrecision(1e-6, undefined, "fp16")!.ulp).toBe(2 ** -24);
    expect(floatPrecision(70000, undefined, "fp16")).toBeNull();
    expect(floatPrecision(1, 1.001, "bf16")!.digitsLost).toBeCloseTo(3, 0);
  });
});

describe("exactDec writes binary values exactly", () => {
  test.each([
    [0.0999755859375, "0.0999755859375"],
    [2 ** -24, "5.9604644775390625×10⁻⁸"],
    [65504, "65504"],
    [57344, "57344"],
    [131072, "1.31072×10⁵"],
    [-2.69921875, "−2.69921875"],
    [3.3895313892515355e38, "3.38953139×10³⁸"],
    [0.10000000149011612, "0.100000001"],
  ] as const)("%p → %s", (v, s) => expect(exactDec(v)).toBe(s));
});

// ---------------------------------------------------------------------------------------------------------------
// Roofline: further rows
// ---------------------------------------------------------------------------------------------------------------

describe("roofline — more rows", () => {
  test("convolution 32×64×56×56, 64 3×3 filters, pad 1", () => {
    const c = conv2dWork({ n: 32, c: 64, h: 56, w: 56, k: 64, r: 3, s: 3, stride: 1, pad: 1, dil: 1 }, 2);
    if (!c.ok) throw new Error(c.error);
    expect([c.p, c.q, c.flops, c.bytes]).toEqual([56, 56, 7398752256, 25763840]);
    expect(rel(c.intensity, 287.1758346581876)).toBeLessThan(1e-14);
    const o = run("ai-roofline", { kernel: "conv" });
    expect(rel(out(o, "intensity"), 287.1758346581876)).toBeLessThan(1e-12);
  });
  test("convolution 7×7 stride 2 pad 3 on 224²", () => {
    const o = run("ai-roofline", { kernel: "conv", conv_in: "1, 3, 224, 224", conv_f: "64, 7, 7", conv_s: "2, 3, 1" });
    expect(out(o, "flops")).toBe(236027904);
    expect(out(o, "bytes")).toBe(1925504);
    expect(o.text).toMatch(/output 112×112/);
  });
  test("GEMV is memory-bound: 5 PFLOP/s, 8 TB/s, 1 B", () => {
    const o = run("ai-roofline", { mnk: "1, 4096, 4096", peak: "5 PFLOP/s", bw: "8 TB/s", elem: "1 B" });
    expect(rel(out(o, "intensity"), 1.9990239141044412)).toBeLessThan(1e-12);
    expect(rel(out(o, "attainable"), 15.99219131283553)).toBeLessThan(1e-12);
    expect(o.text).toMatch(/MEMORY-BOUND/);
    expect(o.text).toMatch(/Machine: peak 5\.00000 PFLOP\/s, bandwidth 8\.00000 TB\/s/);
    expect(o.text).toMatch(/Attainable performance P = 15\.9922 TFLOP\/s \(0\.319844 % of peak\)/);
    expect(o.text).toMatch(/Units read: Peak compute: 5 PFLOP\/s = 5000 TFLOP\/s/);
  });
  test("typed intensity with units converted (19.5 TFLOPS, 900 GB/s)", () => {
    const o = run("ai-roofline", { kernel: "typed", ai: "0.25", flops: "1e9", peak: "19.5 TFLOPS", bw: "900 GB/s" });
    expect(rel(out(o, "ridge"), 21.666666666666668)).toBeLessThan(1e-12);
    expect(rel(out(o, "attainable"), 0.225)).toBeLessThan(1e-12);
    expect(rel(out(o, "time"), 4.444444444444445)).toBeLessThan(1e-12);
    expect(o.text).toMatch(/Units read: Memory bandwidth: 900 GB\/s = 0\.9 TB\/s/);
  });
  test("exactly at the ridge is balanced; a measured rate gives the efficiency", () => {
    const r = roofline(100e12, 1e12, 100);
    expect(r.ok && r.bound).toBe("balanced");
    const o = run("ai-roofline", { kernel: "typed", ai: "100", peak: "100 TFLOP/s", bw: "1 TB/s", meas: "50 TFLOP/s" });
    expect(o.text).toMatch(/BALANCED/);
    expect(out(o, "efficiency")).toBe(50);
  });
  test("prefixes and synonyms: 312000 GFLOP/s, 0.312 PFLOPS, 624 TOPS, 1.5 TiB/s, 16 bit", () => {
    expect(rel(out(run("ai-roofline", { peak: "312000 GFLOP/s" }), "ridge"), 153.01618440411966)).toBeLessThan(1e-12);
    expect(rel(out(run("ai-roofline", { peak: "0.312 PFLOPS" }), "ridge"), 153.01618440411966)).toBeLessThan(1e-12);
    expect(rel(out(run("ai-roofline", { peak: "624 TOPS", elem: "1 B" }), "ridge"), 624 / 2.039)).toBeLessThan(1e-12);
    expect(rel(out(run("ai-roofline", { bw: "1.5 TiB/s" }), "ridge"), 312e12 / (1.5 * 2 ** 40))).toBeLessThan(1e-12);
    expect(out(run("ai-roofline", { elem: "16 bit" }), "bytes")).toBe(100663296);
    expect(rel(out(run("ai-roofline", { peak: "312" }), "ridge"), 153.01618440411966)).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Transformer: further rows
// ---------------------------------------------------------------------------------------------------------------

describe("transformer — more rows", () => {
  test("defaults: N, total, FLOPs, KV cache, activations, Adam states", () => {
    const m = transformerModel(DEFAULT_MODEL);
    if (!m.ok) throw new Error(m.error);
    expect(m.nonEmbedding).toBe(6442450944);
    expect(m.total).toBe(6648303616);
    expect(m.flopsForward).toBe(13833478144);
    expect(m.flopsTraining).toBe(41500434432);
    expect(m.memory[1].kvCache).toBe(1073741824);
    expect(m.activations).toBe(30601641984);
    expect(m.trainWeights + m.trainGrads + m.trainOptimizer).toBe(106372857856);
  });
  test("GQA + gated + untied", () => {
    const o = run("ai-transformer-size", { kvheads: "8", ffn: "3.5", ffntype: "gated", vocab: "128256", seq: "8192", batch: "8", tied: "untied" });
    expect(out(o, "paramsLayer")).toBe(218103808);
    expect(out(o, "nonEmbedding")).toBe(6979321856);
    expect(out(o, "params")).toBe(8029995008);
    expect(out(o, "flopsForward")).toBe(17156800512);
    expect(rel(out(o, "kv16"), 8.589934592)).toBeLessThan(1e-12);
    expect(o.text).toMatch(/Training activations not estimated/);
    expect(o.outputs!.some((x) => x.key === "activations")).toBe(false);
  });
  test("attention-term choices and full recomputation", () => {
    const full = transformerModel({ ...DEFAULT_MODEL, attn: "full" });
    const none = transformerModel({ ...DEFAULT_MODEL, attn: "none" });
    expect(full.ok && full.flopsAttention).toBe(4 * 32 * 2048 * 4096);
    expect(none.ok && none.flopsForward).toBe(2 * 6442450944 + 2 * 4096 * 50257);
    const rc = transformerModel({ ...DEFAULT_MODEL, recompute: true, gated: true });
    expect(rc.ok && rc.activations).toBe(2 * 2048 * 1 * 4096 * 32);
  });
  test("refusals by name", () => {
    expect(run("ai-transformer-size", { heads: "30" }).text).toMatch(/not divisible by 30 heads/);
    expect(run("ai-transformer-size", { kvheads: "5" }).text).toMatch(/cannot be shared evenly/);
    expect(run("ai-transformer-size", { ffn: "2.7" }).text).toMatch(/not a whole number/);
    expect(run("ai-transformer-size", { d: "4096 tokens" }).ok).toBe(false);
    expect(run("ai-transformer-size", { layers: "32.5" }).text).toMatch(/whole number/);
    expect(run("ai-transformer-size", { seq: "" }).text).toMatch(/required/);
    expect(run("ai-transformer-size", { batch: "0" }).ok).toBe(false);
    expect(run("ai-transformer-size", { vocab: "1e12" }).text).toMatch(/beyond/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Quantisation: further rows
// ---------------------------------------------------------------------------------------------------------------

describe("quantisation — more rows", () => {
  test("int8 asymmetric [−1.5, 3]", () => {
    const q = quantize(-1.5, 3, 8, false, 0.1);
    if (!q.ok) throw new Error(q.error);
    expect(rel(q.scale, 0.01764705882352941)).toBeLessThan(1e-15);
    expect(q.zeroPoint).toBe(-43);
    expect(q.q).toBe(-37);
    expect(rel(q.dequantised!, 0.10588235294117647)).toBeLessThan(1e-14);
    expect(rel(q.maxError, 0.008823529411764706)).toBeLessThan(1e-12);
    const c = quantize(-1.5, 3, 8, false, 5)!;
    expect(c.ok && [c.q, c.clipped, c.dequantised]).toEqual([127, true, 3]);
  });
  test("int4 symmetric and asymmetric (widened range)", () => {
    const s = quantize(-1.5, 3, 4, true, 2.9);
    expect(s.ok && [s.scale, s.q, s.dequantised]).toEqual([3 / 7, 7, 3]);
    const o = run("ai-number-formats", { fmt: "int4a", x: "1", lo: "0.5", hi: "4" });
    expect(rel(out(o, "scale"), 4 / 15)).toBeLessThan(1e-15);
    expect(out(o, "zeroPoint")).toBe(-8);
    expect(out(o, "q")).toBe(-4);
    expect(rel(out(o, "dequantised"), 1.0666666666666667)).toBeLessThan(1e-14);
    expect(o.text).toMatch(/widened to \[0, 4\]/);
  });
  test("the maximum error is evaluated: a range narrower than one step", () => {
    // [0.3, 0.32] in symmetric int8 with amax 0.32: s = 0.32/127; the range holds midpoints, so s/2.
    const q = quantize(0.3, 0.32, 8, true);
    expect(q.ok && rel(q.maxError, 0.32 / 127 / 2)).toBeLessThan(1e-9);
  });
  test("refusals", () => {
    expect(quantize(3, 3, 8, true).ok).toBe(false);
    expect(quantize(0, 0.0, 8, false).ok).toBe(false);
    expect(run("ai-number-formats", { fmt: "int8s", lo: "4", hi: "1" }).text).toMatch(/must be greater/);
    expect(run("ai-number-formats", { fmt: "int8s", hi: "" }).text).toMatch(/both/);
    expect(run("ai-number-formats", { fmt: "int8s", x: "5 V" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial input
// ---------------------------------------------------------------------------------------------------------------

describe("adversarial input is refused by name", () => {
  test.each([
    [{ bw: "5 kg" }, /Memory bandwidth/],
    [{ peak: "312 TFLOPs" }, /count of operations/],
    [{ peak: "2 TB/s" }, /not a FLOP rate/],
    [{ peak: "-5 TFLOP/s" }, /positive/],
    [{ peak: "" }, /required/],
    [{ elem: "2 m" }, /Element size/],
    [{ mnk: "4096, 4096" }, /exactly 3 numbers/],
    [{ mnk: "4096.5, 4096, 4096" }, /whole number/],
    [{ mnk: "0, 4096, 4096" }, /at least 1/],
    [{ mnk: "1e10, 1, 1" }, /beyond/],
    [{ kernel: "conv", conv_f: "64, 99, 3" }, /does not fit/],
    [{ kernel: "conv", conv_s: "1, -1, 1" }, /padding/],
    [{ kernel: "typed", ai: "abc" }, /not a number/],
    [{ kernel: "typed", ai: "0" }, /positive/],
    [{ kernel: "typed", ai: "1e400" }, /not a number|positive/],
    [{ meas: "-3 TFLOP/s" }, /positive/],
    [{ kernel: "bogus" }, /not one of the choices/],
  ] as const)("roofline %j", (over, re) => {
    const o = run("ai-roofline", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
  });
  test.each([
    [{ x: "abc" }],
    [{ x: "1e999" }],
    [{ fmt: "fp64" }],
    [{ fmt: "nope" }],
  ])("number formats %j", (over) => {
    expect(run("ai-number-formats", over).ok).toBe(false);
  });
  test("overflow is a stated outcome, never NaN or Infinity text", () => {
    const e4 = run("ai-number-formats", { fmt: "e4m3fn", x: "465" });
    expect(e4.ok).not.toBe(false);
    expect(e4.text).toMatch(/OVERFLOWS \(E4M3fn has no infinity/);
    expect(e4.text).toMatch(/saturating conversion, common in fp8 kernels, gives 448/);
    const h = run("ai-number-formats", { fmt: "fp16", x: "-1e5" });
    expect(h.text).toMatch(/OVERFLOWS to −∞/);
    for (const t of [e4.text, h.text]) expect(t).not.toMatch(/NaN|Infinity/);
  });
  test("bounded work: the spacing curve and the staircase are capped", () => {
    expect(spacingCurve("fp32", 1e-45, 3e38, 600).length).toBeLessThanOrEqual(2 + 2 * 600);
    const s = quantStairSvg({ scale: 1, zeroPoint: 0, qmin: -127, qmax: 127, lo: -127, hi: 127 }, null);
    // plot.ts draws a line series as one <path d="M x,y L x,y …">: count its vertices.
    const vertices = (s.match(/[ML]\s?-?[\d.]+[ ,]-?[\d.]+/g) ?? []).length;
    expect(vertices).toBeGreaterThan(500);
    expect(vertices).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Display contract on every ok result
// ---------------------------------------------------------------------------------------------------------------

const OK_RUNS: Array<[string, Record<string, string>]> = [
  ["ai-roofline", {}],
  ["ai-roofline", { kernel: "conv", meas: "150 TFLOPS" }],
  ["ai-roofline", { kernel: "typed", ai: "0.25", flops: "1e9", peak: "19.5 TFLOPS", bw: "900 GB/s" }],
  ["ai-roofline", { mnk: "1, 4096, 4096", peak: "5 PFLOP/s", bw: "8 TB/s", elem: "1 B" }],
  ["ai-roofline", { kernel: "typed", ai: "1e-4", peak: "1 GFLOP/s", bw: "1 GB/s" }],
  ["ai-transformer-size", {}],
  ["ai-transformer-size", { kvheads: "8", ffn: "3.5", ffntype: "gated", vocab: "128256", seq: "8192", batch: "8", tied: "untied" }],
  ["ai-transformer-size", { d: "12288", layers: "96", heads: "96", seq: "131072", recompute: "full", attn: "full" }],
  ["ai-transformer-size", { d: "64", layers: "1", heads: "1", vocab: "10", seq: "1" }],
  ["ai-number-formats", {}],
  ["ai-number-formats", { fmt: "fp32", x: "-2.7" }],
  ["ai-number-formats", { fmt: "bf16", x: "1e-39" }],
  ["ai-number-formats", { fmt: "e4m3fn", x: "465" }],
  ["ai-number-formats", { fmt: "e5m2", x: "1e30" }],
  ["ai-number-formats", { fmt: "fp16", x: "" }],
  ["ai-number-formats", { fmt: "fp16", x: "0" }],
  ["ai-number-formats", { fmt: "int8s" }],
  ["ai-number-formats", { fmt: "int8a", x: "-5" }],
  ["ai-number-formats", { fmt: "int4a", x: "5", lo: "0.5", hi: "4" }],
];

describe("display contract on every ok result", () => {
  test.each(OK_RUNS)("%s %j", (id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    const t = o.text;
    expect(t).not.toMatch(/NaN|Infinity|undefined|\u2014/);
    expect(t).not.toMatch(/\d[eE][+-]?\d/);
    expect(t).not.toMatch(/\^/);
    expect(t).not.toMatch(/[A-Za-zα-ωµ]_[A-Za-z0-9]/);
    expect(t).not.toMatch(/(^|[\s(=:,[])-\d/m);
    expect(o.outputs!.length).toBeGreaterThan(0);
    for (const v of o.outputs!) expect(Number.isFinite(v.value)).toBe(true);
    const blocks = o.blocks ?? [];
    expect(blocks.some((b) => b.kind === "plot")).toBe(true);
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    expect(blocks.filter((b) => b.kind === "math").length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
      if (b.kind === "plot") {
        expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
        expect(b.svg).not.toMatch(/\d[eE][+-]?\d+<\/text>/);
        expect(b.svg).not.toMatch(/>[^<]*-\d[^<]*<\/text>/);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
      }
      if (b.kind === "table") {
        expect(b.rows[0].length).toBeGreaterThan(1);
        for (const row of b.rows) for (const cell of row) expect(cell).not.toMatch(/NaN|Infinity|\d[eE][+-]?\d|(^|\s)-\d|[A-Za-zα-ωµ]_[A-Za-z0-9]/);
      }
    }
  });
});

describe("figure builders at their edges", () => {
  test("they draw finite SVG", () => {
    const svgs = [
      rooflineSvg(1e9, 1e12, [{ intensity: 1e-3, perf: 1e9, label: "k", color: "#c00000" }]),
      rooflineSvg(1e18, 1e9, [{ intensity: 1e6, perf: 1e15, label: "k", color: "#c00000" }]),
      memoryBarsSvg([{ label: "a", segments: [{ name: "Weights", bytes: 1 }] }], "t"),
      memoryBarsSvg([{ label: "a", segments: [{ name: "Weights", bytes: 5e15 }, { name: "KV cache", bytes: 1e12 }] }], "t"),
      spacingChartSvg("fp32", 1e-44),
      spacingChartSvg("e5m2", 3e38),
      spacingChartSvg(null, null),
    ];
    for (const s of svgs) expect(s).not.toMatch(/NaN|Infinity|undefined/);
  });
  test("floatReport refuses a non-finite value", () => {
    expect(floatReport("fp16", NaN).ok).toBe(false);
  });
});
