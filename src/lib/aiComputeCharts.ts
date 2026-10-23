// Figures for the Release E AI-compute calculators (aiCompute.ts): the roofline on log-log axes with the kernel point,
// the memory breakdown as stacked bars (inference per precision, and mixed-precision training), and the relative
// spacing of the floating-point formats against magnitude. Colours are literal hex (inserted artwork never follows the
// pane's theme); Arial, as engCharts2026.ts.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import { COMPARED_FORMATS, spacingCurve } from "./aiCompute";
import { FLOAT_FORMATS, type FloatFormatId } from "./computation";

const FONT = "Arial, Helvetica, sans-serif";
const f2 = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000"): string =>
  `<text x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}">${esc(t)}</text>`;

/** 4 significant figures, trailing zeros dropped (a label, not a measurement). */
export const sig = (v: number, n = 4): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** An integer with the true minus. */
const minus = (n: number): string => (n < 0 ? "−" + String(-n) : String(n));

/** Short format names for a legend entry (22 characters at most). */
const SHORT: Record<FloatFormatId, string> = { fp64: "fp64", fp32: "fp32", fp16: "fp16", bf16: "bf16", e4m3fn: "E4M3", e5m2: "E5M2" };

/** An SI prefix for a rate or a size: the factor and its symbol, chosen so the value reads 1 to 1000. */
export function siPrefix(v: number): { factor: number; prefix: string } {
  const table: Array<[number, string]> = [[1e18, "E"], [1e15, "P"], [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"]];
  for (const [fac, p] of table) if (v >= fac) return { factor: fac, prefix: p };
  return { factor: 1, prefix: "" };
}

export const ROOFLINE_WIDTH = 460;

export interface RooflinePoint {
  intensity: number;
  /** FLOP/s */
  perf: number;
  label: string;
  color: string;
}

/**
 * The roofline: the memory roof bandwidth·I up to the ridge, the flat compute roof after it, the ridge as a grey
 * vertical, and the kernel (and a measured point, if any) marked. Log-log; y in the SI-prefixed FLOP/s of the peak.
 */
export function rooflineSvg(peak: number, bandwidth: number, points: RooflinePoint[], width = ROOFLINE_WIDTH): string {
  const ridge = peak / bandwidth;
  const is = [ridge, ...points.map((p) => p.intensity)];
  const xmin = Math.pow(10, Math.floor(Math.log10(Math.min(...is) / 3)));
  const xmax = Math.pow(10, Math.ceil(Math.log10(Math.max(...is) * 3)));
  const { factor, prefix } = siPrefix(peak);
  const Y = (v: number): number => v / factor;
  const ymin = Math.min(bandwidth * xmin, ...points.map((p) => p.perf));
  const yLo = Math.pow(10, Math.floor(Math.log10(Y(ymin))));
  const yHi = Math.pow(10, Math.ceil(Math.log10(Y(peak) * 2)));
  const series: Series[] = [
    { points: [{ x: xmin, y: Y(bandwidth * xmin) }, { x: ridge, y: Y(peak) }], type: "line", color: "#1f5fa8", label: `Memory, ${sig(bandwidth / siPrefix(bandwidth).factor)} ${siPrefix(bandwidth).prefix}B/s` },
    { points: [{ x: ridge, y: Y(peak) }, { x: xmax, y: Y(peak) }], type: "line", color: "#000000", label: `Peak, ${sig(Y(peak))} ${prefix}FLOP/s` },
    { points: [{ x: ridge, y: yLo }, { x: ridge, y: Y(peak) }], type: "line", color: "#999999", label: `Ridge, I = ${sig(ridge)}` },
  ];
  for (const p of points) series.push({ points: [{ x: p.intensity, y: Y(p.perf) }], type: "scatter", color: p.color, label: p.label });
  return buildPlotSvg(series, {
    xlabel: "Arithmetic intensity (FLOP/byte)",
    ylabel: `Performance (${prefix}FLOP/s)`,
    xScale: "log",
    yScale: "log",
    xLimits: { min: xmin, max: xmax },
    yLimits: { min: yLo, max: yHi },
    width,
    height: Math.round(width * 0.66),
  });
}

export interface MemorySegment {
  name: string;
  bytes: number;
}

export interface MemoryBar {
  label: string;
  segments: MemorySegment[];
}

/** One colour per segment name, in legend order (weights blue, KV cache orange, then the training parts). */
const SEGMENT_COLORS: Record<string, string> = {
  Weights: "#1f5fa8",
  "KV cache": "#e07b00",
  Gradients: "#6a9fd4",
  "Optimizer states": "#7a4fa0",
  Activations: "#2e7d32",
};
const FALLBACK = ["#555555", "#c00000", "#8c6d1f"];

/**
 * Stacked horizontal bars, one per configuration, on one linear byte axis (SI-prefixed); each bar's total at its end
 * and a legend of the segment names below the axis. Up to 8 bars.
 */
export function memoryBarsSvg(bars: MemoryBar[], title: string, width = 460): string {
  const shown = bars.slice(0, 8);
  const names: string[] = [];
  for (const b of shown) for (const s of b.segments) if (s.bytes > 0 && !names.includes(s.name)) names.push(s.name);
  const color = (n: string): string => SEGMENT_COLORS[n] ?? FALLBACK[names.indexOf(n) % FALLBACK.length];
  const totals = shown.map((b) => b.segments.reduce((a, s) => a + Math.max(0, s.bytes), 0));
  const maxT = Math.max(...totals, 1);
  const { factor, prefix } = siPrefix(maxT);
  const unit = `${prefix}B`;
  // A tick step of 1, 2 or 5 × 10ⁿ giving 4 to 8 intervals.
  const span = maxT / factor;
  const raw = span / 5;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p10).find((s) => span / s <= 6) ?? 10 * p10;
  const axisMax = Math.ceil(span / step - 1e-9) * step;
  const longest = Math.max(...shown.map((b) => b.label.length));
  const ML = Math.min(200, Math.max(70, longest * 6.2 + 14));
  const totalLabelW = 74;
  const MR = totalLabelW;
  const MT = 30;
  const ROW = 30;
  const pw = width - ML - MR;
  const plotH = shown.length * ROW;
  const legendCols = Math.max(1, Math.floor((width - 20) / 150));
  const legendRows = Math.ceil(names.length / legendCols);
  const H = MT + plotH + 34 + legendRows * 18 + 10;
  const X = (v: number): number => ML + (v / factor / axisMax) * pw;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">`);
  out.push(`<rect width="${width}" height="${H}" fill="#ffffff"/>`);
  out.push(text(width / 2, 18, title, "middle", 12));
  // grid and ticks
  for (let i = 0; i * step <= axisMax + 1e-9; i++) {
    const v = i * step;
    const x = ML + (v / axisMax) * pw;
    out.push(`<line x1="${f2(x)}" y1="${MT}" x2="${f2(x)}" y2="${MT + plotH}" stroke="${i === 0 ? "#000000" : "#e2e2e2"}" stroke-width="1"/>`);
    out.push(text(x, MT + plotH + 14, sig(v), "middle", 10, "#333333"));
  }
  out.push(text(ML + pw / 2, MT + plotH + 28, `Memory (${unit})`, "middle", 11));
  shown.forEach((b, i) => {
    const y = MT + i * ROW + 6;
    const h = ROW - 12;
    let acc = 0;
    for (const s of b.segments) {
      if (!(s.bytes > 0)) continue;
      const x0 = X(acc), x1 = X(acc + s.bytes);
      out.push(`<rect x="${f2(x0)}" y="${f2(y)}" width="${f2(Math.max(x1 - x0, 0.75))}" height="${h}" fill="${color(s.name)}"/>`);
      acc += s.bytes;
    }
    out.push(text(ML - 6, y + h / 2 + 4, b.label, "end", 10));
    out.push(text(X(acc) + 5, y + h / 2 + 4, `${sig(totals[i] / factor, 3)} ${unit}`, "start", 10, "#333333"));
  });
  // legend
  const ly = MT + plotH + 44;
  names.forEach((n, i) => {
    const col = i % legendCols, row = Math.floor(i / legendCols);
    const x = 10 + col * 150, y = ly + row * 18;
    out.push(`<rect x="${x}" y="${y - 9}" width="12" height="10" fill="${color(n)}"/>`);
    out.push(text(x + 17, y, n, "start", 10));
  });
  out.push("</svg>");
  return out.join("");
}

/**
 * Integer quantisation as a transfer curve: the dequantised value x̂ against x over the range (with a margin either
 * side, so the clipping is visible), the identity x̂ = x in grey, the code steps in blue, the value marked.
 * At most 2⁸ codes, so at most 520 points.
 */
export function quantStairSvg(
  q: { scale: number; zeroPoint: number; qmin: number; qmax: number; lo: number; hi: number },
  x: number | null,
  width = 460,
): string {
  const s = q.scale, z = q.zeroPoint;
  const deq = (c: number): number => (c - z) * s;
  const span = q.hi - q.lo;
  let a = q.lo - 0.12 * span, b = q.hi + 0.12 * span;
  if (x !== null) {
    a = Math.min(a, x - 0.05 * span);
    b = Math.max(b, x + 0.05 * span);
  }
  const code = (v: number): number => {
    const t = v / s;
    const n = Math.floor(t), d = t - n;
    const r = d > 0.5 ? n + 1 : d < 0.5 ? n : n % 2 === 0 ? n : n + 1;
    return Math.min(q.qmax, Math.max(q.qmin, r + z));
  };
  const stairs: Array<{ x: number; y: number }> = [];
  let c = code(a);
  stairs.push({ x: a, y: deq(c) });
  for (let i = 0; i < 300 && c < q.qmax; i++) {
    // The boundary between code c and c + 1 is the midpoint of their values.
    const edge = (deq(c) + deq(c + 1)) / 2;
    if (edge >= b) break;
    stairs.push({ x: edge, y: deq(c) }, { x: edge, y: deq(c + 1) });
    c++;
  }
  stairs.push({ x: b, y: deq(c) });
  const series: Series[] = [
    { points: [{ x: a, y: a }, { x: b, y: b }], type: "line", color: "#999999", label: "No error" },
    { points: stairs, type: "line", color: "#1f5fa8", label: `Codes ${minus(q.qmin)} to ${minus(q.qmax)}` },
  ];
  if (x !== null) series.push({ points: [{ x, y: deq(code(x)) }], type: "scatter", color: "#c00000", label: `x = ${sig(x)} → code ${minus(code(x))}` });
  return buildPlotSvg(series, {
    xlabel: "Input x",
    ylabel: "Dequantised value",
    width,
    height: Math.round(width * 0.66),
  });
}

export const SPACING_COLORS: Record<FloatFormatId, string> = {
  fp64: "#555555",
  fp32: "#000000",
  fp16: "#1f5fa8",
  bf16: "#2e7d32",
  e4m3fn: "#c00000",
  e5m2: "#e07b00",
};

/**
 * Relative spacing ulp(x)/x against |x| (log-log) for fp32, fp16, bf16, E4M3 and E5M2: each format's sawtooth between
 * 2^−nmant and 2^−(nmant+1), the 1/x ramp through its subnormals, ending at its largest finite value. The x range is
 * 10⁻⁸ … 10⁶ (widened to show the value); fp32 and bf16 run on past it, as a note says. The value is marked on the
 * chosen format.
 */
export function spacingChartSvg(chosen: FloatFormatId | null, value: number | null, width = 460): string {
  let xmin = 1e-8, xmax = 1e6;
  const v = value !== null && value !== 0 && Number.isFinite(value) ? Math.abs(value) : null;
  if (v !== null) {
    xmin = Math.min(xmin, Math.pow(10, Math.floor(Math.log10(v)) - 1));
    xmax = Math.max(xmax, Math.pow(10, Math.ceil(Math.log10(v)) + 1));
  }
  // Wider than 50 decades the sawtooth is a smear; the value is still marked, the range clipped to its neighbourhood.
  if (Math.log10(xmax / xmin) > 50) {
    if (v !== null && v > 1) xmin = xmax / 1e50;
    else xmax = xmin * 1e50;
  }
  const series: Series[] = [];
  const wide = Math.log10(xmax / xmin) > 20;
  for (const id of COMPARED_FORMATS) {
    const pts = spacingCurve(id, xmin, xmax, 600, wide);
    if (pts.length) series.push({ points: pts, type: "line", color: SPACING_COLORS[id], label: FLOAT_FORMATS[id].label });
  }
  if (chosen !== null && chosen !== "fp64" && v !== null) {
    const pts = spacingCurve(chosen, v, v * 1.0000001);
    if (pts.length) series.push({ points: [{ x: v, y: pts[0].y }], type: "scatter", color: SPACING_COLORS[chosen], label: `x = ${sig(v)} (${SHORT[chosen]})` });
  }
  const runOn = COMPARED_FORMATS.filter((id) => FLOAT_FORMATS[id].max > xmax || Math.pow(2, FLOAT_FORMATS[id].minExp - FLOAT_FORMATS[id].nmant) < xmin);
  const notes: string[] = [];
  if (chosen !== null && chosen !== "fp64" && v !== null && v > FLOAT_FORMATS[chosen].max)
    notes.push(`x = ${sig(v)} is beyond the largest finite ${SHORT[chosen]} value, ${sig(FLOAT_FORMATS[chosen].max)}: not marked.`);
  if (wide) notes.push("Over this wide range each format's normal range is drawn at its machine epsilon, the largest relative spacing; within each binade it falls to half of that.");
  if (runOn.length) notes.push(`${runOn.map((id) => SHORT[id]).join(", ")} continue beyond the plotted range.`);
  return buildPlotSvg(series, {
    xlabel: "Magnitude |x|",
    ylabel: "Relative spacing ulp(x)/|x|",
    xScale: "log",
    yScale: "log",
    xLimits: { min: xmin, max: xmax },
    yLimits: { min: 1e-8, max: 1 },
    width,
    height: Math.round(width * 0.7),
    notes: notes.length ? notes : undefined,
  });
}
