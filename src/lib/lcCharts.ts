// Figures for the liquid-crystal retarder tools: transmission spectra with retardation-level lines and the
// achromatic band shaded, net retardance against wavelength with the wave-plate targets, measured spectra with
// the model overlaid, director profiles θ(z), and retardance / midplane tilt against voltage.
//
// One small line-chart builder serves them all, because these figures need three things the general plotter does
// not draw: a shaded x band, labelled horizontal reference lines, and a legend that never sits on a curve (it is
// drawn BELOW the plot frame, outside the data area). Literal hex colours and Arial, as every inserted figure; a
// black-and-white style (no colour, dash patterns and grey shading only) for patent drawings.

import { linearAxis } from "./axis";
import { decimateTrace } from "./spectraChart";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#111111";
const RULE = "#6b7280";
const GRID = "#e5e7eb";
const PAPER = "#ffffff";

export interface XY {
  x: number;
  y: number;
}
export interface LcSeries {
  points: XY[];
  colour: string;
  /** SVG stroke-dasharray, e.g. "6 4" */
  dash?: string;
  width?: number;
  label: string;
  /** markers along the trace (B/W measured data), at most about 24 of them, and on the legend swatch */
  marker?: "circle" | "square";
}
export interface LcHLine {
  y: number;
  colour: string;
  dash: string;
  label: string;
  /** drawn but not listed in the legend (a second tolerance line shares the first one's entry) */
  noLegend?: boolean;
}
export interface LcVLine {
  x: number;
  colour: string;
  dash: string;
  label: string;
}
export interface LcChartSpec {
  xLabel: string;
  yLabel: string;
  series: LcSeries[];
  hlines?: LcHLine[];
  vlines?: LcVLine[];
  /** shaded x ranges, one legend entry for all of them */
  bands?: Array<{ x0: number; x1: number }>;
  bandLabel?: string;
  bandFill?: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  width?: number;
}

const f = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const txt = (x: number, y: number, t: string, o: { anchor?: string; size?: number; fill?: string; rotate?: boolean; weight?: string } = {}): string =>
  `<text x="${f(x)}" y="${f(y)}" font-family="${FONT}" font-size="${o.size ?? 10}" fill="${o.fill ?? INK}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}${o.rotate ? ` transform="rotate(-90 ${f(x)} ${f(y)})"` : ""}>${richText(t, o.size ?? 10)}</text>`;

const SUBS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", ₘ: "m", ₑ: "e", ₒ: "o", ₜ: "t", ₕ: "h", ᵣ: "r" };
/**
 * Escaped SVG text with Unicode subscript characters drawn as real subscripts (a smaller tspan lowered by dy, the
 * baseline restored by the next tspan; dy is cumulative). Arial has no glyphs for most subscript characters, so a
 * renderer substitutes another face and the label looks patched; a lowered tspan in Arial does not.
 */
export function richText(t: string, size: number): string {
  const parts = [...t];
  let out = "";
  let run = "";
  let sub = false;
  const shift = Math.round(size * 0.28 * 10) / 10;
  const small = Math.round(size * 0.72 * 10) / 10;
  const flush = (): void => {
    if (!run) return;
    // a space that opens a tspan is collapsed away by some renderers, so it becomes an explicit dx gap
    const lead = /^ /.test(run) && out !== "";
    const body = esc(lead ? run.slice(1) : run);
    const dx = lead ? ` dx="${Math.round(size * 0.28 * 10) / 10}"` : "";
    out += sub ? `<tspan dy="${shift}" font-size="${small}">${body}</tspan>` : out ? `<tspan dy="-${shift}"${dx}>${body}</tspan>` : body;
    run = "";
  };
  let prev = "";
  for (const ch of parts) {
    // ⊥ and ∥ right after a letter are index subscripts (n⊥, n∥, T⊥), drawn lowered like the digits
    const s = SUBS[ch] !== undefined || ((ch === "⊥" || ch === "∥") && /[A-Za-zα-ωΑ-Ω]/.test(prev));
    prev = ch;
    if (s !== sub) {
      flush();
      sub = s;
    }
    run += s ? (SUBS[ch] ?? ch) : ch;
  }
  flush();
  return out;
}
/** Conservative text width (the figure-layout audit uses 0.58 em per glyph). */
const textW = (t: string, size: number): number => [...t].length * size * 0.6;

let clipSeq = 0;

/** An open marker (white fill) so it reads in black and white. */
function markerAt(kind: "circle" | "square", x: number, y: number, colour: string): string {
  return kind === "circle"
    ? `<circle cx="${f(x)}" cy="${f(y)}" r="2.8" fill="#ffffff" stroke="${colour}" stroke-width="1.1"/>`
    : `<rect x="${f(x - 2.6)}" y="${f(y - 2.6)}" width="5.2" height="5.2" fill="#ffffff" stroke="${colour}" stroke-width="1.1"/>`;
}

/** The shared builder. Height grows with the legend rows, which sit below the x-axis title. */
export function lcLineChartSvg(spec: LcChartSpec): string {
  const W = spec.width ?? 460;
  const ML = 56;
  const MR = 18;
  const MT = 14;
  const PH = 230;
  const pw = W - ML - MR;
  // Domain
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of spec.series)
    for (const p of s.points)
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        xs.push(p.x);
        ys.push(p.y);
      }
  for (const h of spec.hlines ?? []) if (Number.isFinite(h.y)) ys.push(h.y);
  let [x0, x1] = spec.xDomain ?? [Math.min(...xs), Math.max(...xs)];
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) [x0, x1] = [0, 1];
  if (x1 <= x0) [x0, x1] = [x0 - 1, x0 + 1];
  let y0: number;
  let y1: number;
  if (spec.yDomain) [y0, y1] = spec.yDomain;
  else {
    y0 = ys.length ? Math.min(...ys) : 0;
    y1 = ys.length ? Math.max(...ys) : 1;
    if (!(y1 > y0)) {
      y0 -= 1;
      y1 += 1;
    }
    const pad = (y1 - y0) * 0.06;
    y0 -= pad;
    y1 += pad;
  }
  const xa = linearAxis(x0, x1, { target: 6 });
  const ya = linearAxis(y0, y1, { target: 6 });
  const X = (v: number): number => ML + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v: number): number => MT + PH - ((v - y0) / (y1 - y0)) * PH;

  // Legend entries (below the frame)
  type Entry = { kind: "line" | "fill"; colour: string; dash?: string; width?: number; label: string; marker?: "circle" | "square" };
  const entries: Entry[] = [];
  if (spec.bands && spec.bands.length && spec.bandLabel) entries.push({ kind: "fill", colour: spec.bandFill ?? "#dbeafe", label: spec.bandLabel });
  for (const s of spec.series) entries.push({ kind: "line", colour: s.colour, dash: s.dash, width: s.width, label: s.label, marker: s.marker });
  for (const h of spec.hlines ?? []) if (!h.noLegend) entries.push({ kind: "line", colour: h.colour, dash: h.dash, width: 1.4, label: h.label });
  for (const v of spec.vlines ?? []) entries.push({ kind: "line", colour: v.colour, dash: v.dash, width: 1.2, label: v.label });
  const LEG_SIZE = 10;
  const SW = 26;
  const colW = pw / 2;
  const twoCols = entries.every((e) => SW + 6 + textW(e.label, LEG_SIZE) <= colW - 8);
  const cols = twoCols ? 2 : 1;
  const rows = Math.ceil(entries.length / cols);
  const legTop = MT + PH + 44;
  const H = legTop + rows * 16 + 8;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  const cid = `lcclip${++clipSeq}`;
  p.push(`<defs><clipPath id="${cid}"><rect x="${ML}" y="${MT}" width="${pw}" height="${PH}"/></clipPath></defs>`);
  // grid
  for (const v of xa.values) p.push(`<line x1="${f(X(v))}" y1="${MT}" x2="${f(X(v))}" y2="${MT + PH}" stroke="${GRID}" stroke-width="0.6"/>`);
  for (const v of ya.values) p.push(`<line x1="${ML}" y1="${f(Y(v))}" x2="${ML + pw}" y2="${f(Y(v))}" stroke="${GRID}" stroke-width="0.6"/>`);
  // bands
  for (const b of spec.bands ?? []) {
    const a = Math.max(x0, Math.min(b.x0, b.x1));
    const c = Math.min(x1, Math.max(b.x0, b.x1));
    if (c > a) p.push(`<rect x="${f(X(a))}" y="${MT}" width="${f(Math.max(0.6, X(c) - X(a)))}" height="${PH}" fill="${spec.bandFill ?? "#dbeafe"}" stroke="none"/>`);
  }
  // reference lines
  p.push(`<g clip-path="url(#${cid})">`);
  for (const h of spec.hlines ?? [])
    if (h.y >= y0 && h.y <= y1)
      p.push(`<polyline points="${f(ML)},${f(Y(h.y))} ${f(ML + pw)},${f(Y(h.y))}" fill="none" stroke="${h.colour}" stroke-width="1.4" stroke-dasharray="${h.dash}"/>`);
  for (const v of spec.vlines ?? [])
    if (v.x >= x0 && v.x <= x1)
      p.push(`<polyline points="${f(X(v.x))},${f(MT)} ${f(X(v.x))},${f(MT + PH)}" fill="none" stroke="${v.colour}" stroke-width="1.2" stroke-dasharray="${v.dash}"/>`);
  // series
  for (const s of spec.series) {
    const pts = s.points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
    if (pts.length < 2) continue;
    const coords = pts.map((q) => `${f(X(q.x))},${f(Y(q.y))}`).join(" ");
    p.push(
      `<polyline points="${coords}" fill="none" stroke="${s.colour}" stroke-width="${s.width ?? 1.8}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`,
    );
    if (s.marker) {
      const every = Math.max(1, Math.floor(pts.length / 24));
      for (let i = Math.floor(every / 2); i < pts.length; i += every) p.push(markerAt(s.marker, X(pts[i].x), Y(pts[i].y), s.colour));
    }
  }
  p.push(`</g>`);
  // frame, ticks, labels
  p.push(`<rect x="${ML}" y="${MT}" width="${pw}" height="${PH}" fill="none" stroke="${RULE}" stroke-width="1"/>`);
  xa.values.forEach((v, i) => {
    p.push(`<line x1="${f(X(v))}" y1="${MT + PH}" x2="${f(X(v))}" y2="${MT + PH + 4}" stroke="${RULE}"/>`);
    p.push(txt(X(v), MT + PH + 15, xa.labels[i], { anchor: "middle" }));
  });
  ya.values.forEach((v, i) => {
    p.push(`<line x1="${ML - 4}" y1="${f(Y(v))}" x2="${ML}" y2="${f(Y(v))}" stroke="${RULE}"/>`);
    p.push(txt(ML - 6, Y(v) + 3.5, ya.labels[i], { anchor: "end" }));
  });
  const xm = xa.multiplier ? ` (${xa.multiplier})` : "";
  const ym = ya.multiplier ? ` (${ya.multiplier})` : "";
  p.push(txt(ML + pw / 2, MT + PH + 32, spec.xLabel + xm, { anchor: "middle", size: 11 }));
  p.push(txt(14, MT + PH / 2, spec.yLabel + ym, { anchor: "middle", size: 11, rotate: true }));
  // legend
  entries.forEach((e, i) => {
    const col = cols === 2 ? i % 2 : 0;
    const row = cols === 2 ? Math.floor(i / 2) : i;
    const lx = ML + col * colW;
    const ly = legTop + row * 16;
    if (e.kind === "fill") p.push(`<rect x="${f(lx)}" y="${f(ly - 7)}" width="${SW}" height="10" fill="${e.colour}" stroke="${RULE}" stroke-width="0.6"/>`);
    else
      p.push(
        `<path d="M${f(lx)} ${f(ly - 2)} L${f(lx + SW)} ${f(ly - 2)}" fill="none" stroke="${e.colour}" stroke-width="${e.width ?? 1.8}"${e.dash ? ` stroke-dasharray="${e.dash}"` : ""}/>`,
      );
    if (e.marker) p.push(markerAt(e.marker, lx + SW / 2, ly - 2, e.colour));
    p.push(txt(lx + SW + 6, ly + 2, e.label, { size: LEG_SIZE }));
  });
  p.push(`</svg>`);
  return p.join("");
}

// ------------------------------------------------------------- palettes

export type LcStyle = "colour" | "bw";
export const LEVEL_COLOURS = ["#2563eb", "#7c3aed", "#0891b2", "#d97706", "#db2777", "#65a30d", "#4b5563", "#9333ea"];
const LEVEL_DASHES = ["8 5", "3 3", "10 3 2 3", "6 2", "2 4", "12 4", "4 2 1 2", "1 3"];
export const CURVE = {
  colour: { crossed: "#b91c1c", parallel: "#15803d", analyser: "#1f2937", model: "#6b7280", band: "#dbeafe" },
  bw: { crossed: "#000000", parallel: "#000000", analyser: "#000000", model: "#555555", band: "#e5e5e5" },
};
export function levelStyle(i: number, style: LcStyle): { colour: string; dash: string } {
  return style === "bw" ? { colour: "#888888", dash: LEVEL_DASHES[i % LEVEL_DASHES.length] } : { colour: LEVEL_COLOURS[i % LEVEL_COLOURS.length], dash: "8 5" };
}

// ------------------------------------------------------------- the figures

export interface Level {
  /** retardance, rad */
  gamma: number;
  label: string;
  /** the second line of a ± pair: drawn in the previous level's style and not listed again in the legend */
  pair?: boolean;
}

/** Level lines in their styles; a pair's second line shares the first's style and legend entry. */
function levelLines(levels: Level[], k: number, style: LcStyle, offset: number): LcHLine[] {
  let idx = offset - 1;
  return levels.map((L) => {
    if (!L.pair) idx++;
    const st = levelStyle(idx, style);
    return { y: Math.sin(L.gamma / 2) ** 2 * k, colour: st.colour, dash: st.dash, label: L.label, noLegend: !!L.pair };
  });
}

/** Transmission T(λ) between crossed and parallel polarisers (and an analyser angle), levels and band. */
export function lcTransmissionSvg(o: {
  lam: number[];
  Tc: number[];
  Tp: number[];
  Ta?: number[] | null;
  anaLabel?: string;
  levels: Level[];
  bands: Array<{ x0: number; x1: number }>;
  bandLabel: string;
  percent: boolean;
  style: LcStyle;
}): string {
  const k = o.percent ? 100 : 1;
  const C = CURVE[o.style];
  const pts = (T: number[]): XY[] => o.lam.map((x, i) => ({ x, y: T[i] * k }));
  const series: LcSeries[] = [
    { points: pts(o.Tc), colour: C.crossed, label: "Crossed polarisers", width: 2 },
    { points: pts(o.Tp), colour: C.parallel, label: "Parallel polarisers", width: 2, dash: o.style === "bw" ? "7 4" : undefined },
  ];
  if (o.Ta) series.push({ points: pts(o.Ta), colour: C.analyser, label: o.anaLabel ?? "Analyser", width: 1.6, dash: "2 3" });
  const hlines: LcHLine[] = levelLines(o.levels, k, o.style, 0);
  return lcLineChartSvg({
    xLabel: "Wavelength (nm)",
    yLabel: o.percent ? "Transmission (%)" : "Transmission",
    series,
    hlines,
    bands: o.bands,
    bandLabel: o.bandLabel,
    bandFill: C.band,
    xDomain: [o.lam[0], o.lam[o.lam.length - 1]],
    yDomain: [0, hlines.some((h) => h.y > 0.995 * k) || o.Tc.concat(o.Tp).some((t) => t > 0.995) ? 1.04 * k : k],
  });
}

/** Net retardance / π against λ with the target order line and its tolerance lines, band shaded. */
export function lcNetRetardanceSvg(o: {
  lam: number[];
  netOverPi: number[];
  netLabel: string;
  target: number;
  targetLabel: string;
  tol: number | null;
  bands: Array<{ x0: number; x1: number }>;
  bandLabel: string;
  style: LcStyle;
}): string {
  const C = CURVE[o.style];
  const hl: LcHLine[] = [{ y: o.target, colour: o.style === "bw" ? "#000000" : "#2563eb", dash: "8 5", label: o.targetLabel }];
  if (o.tol !== null && o.tol > 0) {
    const g = o.style === "bw" ? "#777777" : "#7c3aed";
    hl.push({ y: o.target + o.tol, colour: g, dash: "3 3", label: `tolerance ±${fmt(o.tol)}π` });
    hl.push({ y: o.target - o.tol, colour: g, dash: "3 3", label: "", noLegend: true });
  }
  return lcLineChartSvg({
    xLabel: "Wavelength (nm)",
    yLabel: "Net retardance / π",
    series: [{ points: o.lam.map((x, i) => ({ x, y: o.netOverPi[i] })), colour: C.crossed, label: o.netLabel, width: 2 }],
    hlines: hl,
    bands: o.bands,
    bandLabel: o.bandLabel,
    bandFill: C.band,
    xDomain: [o.lam[0], o.lam[o.lam.length - 1]],
  });
}

/** Measured spectra (decimated, extremes kept) with the model optionally overlaid, levels and band. */
export function lcMeasuredSvg(o: {
  lam: number[];
  Tc: number[];
  Tp: number[] | null;
  model: { lam: number[]; Tc: number[]; Tp: number[] } | null;
  levels: Level[];
  bands: Array<{ x0: number; x1: number }>;
  bandLabel: string;
  normalised: boolean;
  percent: boolean;
  style: LcStyle;
}): string {
  const k = o.percent ? 100 : 1;
  const C = CURVE[o.style];
  const series: LcSeries[] = [];
  const meas = (T: number[]): XY[] => decimateTrace(o.lam.map((x, i) => ({ x, y: T[i] * k })), 1200);
  const tag = o.normalised ? " (measured, normalised)" : " (measured)";
  const bw = o.style === "bw";
  series.push({ points: meas(o.Tc), colour: C.crossed, label: "Crossed" + tag, width: 1.3, marker: bw ? "circle" : undefined });
  if (o.Tp) series.push({ points: meas(o.Tp), colour: C.parallel, label: "Parallel" + tag, width: 1.3, marker: bw ? "square" : undefined });
  if (o.model) {
    const mp = (T: number[]): XY[] => o.model!.lam.map((x, i) => ({ x, y: T[i] * k }));
    series.push({ points: mp(o.model.Tc), colour: o.style === "bw" ? "#555555" : "#7f1d1d", label: "Crossed (model)", width: 1.6, dash: "8 4" });
    series.push({ points: mp(o.model.Tp), colour: o.style === "bw" ? "#555555" : "#14532d", label: "Parallel (model)", width: 1.6, dash: "2 3" });
  }
  const hlines: LcHLine[] = levelLines(o.levels, k, o.style, 2);
  const allY = series.flatMap((s) => s.points.map((q) => q.y));
  const top = Math.max(k, ...allY.filter(Number.isFinite));
  const bot = Math.min(0, ...allY.filter(Number.isFinite));
  return lcLineChartSvg({
    xLabel: "Wavelength (nm)",
    yLabel: o.percent ? "Transmission (%)" : "Transmission",
    series,
    hlines,
    bands: o.bands,
    bandLabel: o.bandLabel,
    bandFill: C.band,
    xDomain: [o.lam[0], o.lam[o.lam.length - 1]],
    yDomain: [bot, top === k ? k : top * 1.04],
  });
}

const PROFILE_COLOURS = ["#1d4ed8", "#b91c1c", "#15803d", "#7c3aed", "#d97706", "#0891b2"];
const PROFILE_DASHES = ["", "7 4", "2 3", "10 3 2 3", "4 2", "1 2"];

/** Director profiles θ(z) at a few voltages: z/d across, tilt (degrees) up. */
export function lcProfilesSvg(o: { profiles: Array<{ label: string; z: number[]; thetaDeg: number[] }>; style: LcStyle }): string {
  const series: LcSeries[] = o.profiles.map((pr, i) => ({
    points: pr.z.map((z, j) => ({ x: z, y: pr.thetaDeg[j] })),
    colour: o.style === "bw" ? "#000000" : PROFILE_COLOURS[i % PROFILE_COLOURS.length],
    dash: o.style === "bw" ? PROFILE_DASHES[i % PROFILE_DASHES.length] || undefined : undefined,
    label: pr.label,
    width: 1.8,
  }));
  return lcLineChartSvg({ xLabel: "Position across the cell, z/d", yLabel: "Tilt θ (°)", series, xDomain: [0, 1], yDomain: [0, 90] });
}

/** Retardance against voltage, Vₜₕ marked. */
export function lcGammaVoltageSvg(o: {
  V: number[];
  gammaOverPi: number[];
  vth: number | null;
  vthLabel: string;
  markV?: number | null;
  markLabel?: string;
  style: LcStyle;
}): string {
  const vlines: LcVLine[] = [];
  if (o.vth !== null) vlines.push({ x: o.vth, colour: o.style === "bw" ? "#555555" : "#6b7280", dash: "4 3", label: o.vthLabel });
  if (o.markV !== null && o.markV !== undefined) vlines.push({ x: o.markV, colour: o.style === "bw" ? "#000000" : "#7c3aed", dash: "8 3 2 3", label: o.markLabel ?? "" });
  return lcLineChartSvg({
    xLabel: "Voltage (V rms)",
    yLabel: "Retardance Γ / π",
    series: [{ points: o.V.map((x, i) => ({ x, y: o.gammaOverPi[i] })), colour: o.style === "bw" ? "#000000" : "#1d4ed8", label: "Γ(V), full director profile", width: 2 }],
    vlines,
    xDomain: [o.V[0], o.V[o.V.length - 1]],
  });
}

/** Midplane tilt against voltage: the full solution and the uniform-profile approximation, Vₜₕ marked. */
export function lcMidTiltSvg(o: { V: number[]; full: number[]; approx: number[] | null; vth: number | null; vthLabel: string; style: LcStyle }): string {
  const series: LcSeries[] = [{ points: o.V.map((x, i) => ({ x, y: o.full[i] })), colour: o.style === "bw" ? "#000000" : "#b91c1c", label: "θₘ, full solution", width: 2 }];
  if (o.approx)
    series.push({ points: o.V.map((x, i) => ({ x, y: o.approx![i] })), colour: o.style === "bw" ? "#555555" : "#2563eb", dash: "6 4", label: "θₘ, uniform-profile approximation", width: 1.6 });
  const vlines: LcVLine[] = o.vth !== null ? [{ x: o.vth, colour: o.style === "bw" ? "#555555" : "#6b7280", dash: "4 3", label: o.vthLabel }] : [];
  return lcLineChartSvg({ xLabel: "Voltage (V rms)", yLabel: "Midplane tilt θₘ (°)", series, vlines, xDomain: [o.V[0], o.V[o.V.length - 1]], yDomain: [0, 90] });
}

/** A short number for labels (≤ 4 significant figures, U+2212). */
export function fmt(x: number): string {
  if (x === 0) return "0";
  const s = String(Number(x.toPrecision(4)));
  if (/e/i.test(s)) return x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(/^-/, "−");
}
