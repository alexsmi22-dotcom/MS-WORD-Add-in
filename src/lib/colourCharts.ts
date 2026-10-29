// Figures for the Colour & appearance calculators (colourScience.ts computes, colourCalcs.ts words the results).
// Planes whose geometry is the claim — the a*b* plane (chroma is a distance, hue an angle) and the chromaticity
// diagram — are drawn at EQUAL SCALE on both axes (plotKinds.parametricPlotSvg), so a CIE76 tolerance circle is a
// circle and the CIEDE2000 region shows its real shape. Colours are literal hex (inserted artwork never follows the
// pane's theme); Arial, as the other chart modules.

import { buildPlotSvg, type Series } from "./plot";
import { parametricPlotSvg } from "./plotKinds";
import { groupedBarSvg } from "./statchart";
import { gamutById } from "./colourspace";
import { DE_SYMBOL, spectralLocus, toleranceContour, type DeFormula, type Lab, type Observer, type ParametricK } from "./colourScience";

const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#888888";
const BLACK = "#000000";
const ORANGE = "#d46a00";
const W = 460;

/** A number for a legend: two decimals, true minus. */
const f2 = (v: number): string => {
  const t = Math.abs(v).toFixed(2);
  return v < 0 && Number(t) !== 0 ? `−${t}` : t;
};

export interface AbPoint {
  label: string;
  lab: Lab;
  colour?: string;
}

/**
 * The a*b* plane with the origin: each colour as a point with its chroma ray from the neutral axis (the ray's length
 * is C*ab, its angle hab). The standard and the sample of a difference sit on it together; batch samples go in `extra`.
 */
export function abPlaneSvg(points: AbPoint[], opts: { contour?: { f: DeFormula; std: Lab; tol: number; k?: ParametricK }; title?: string } = {}): string {
  const series: Series[] = [];
  const palette = [BLUE, RED, GREEN, ORANGE, GREY];
  points.forEach((p, i) => {
    const c = p.colour ?? palette[i % palette.length];
    series.push({ points: [{ x: 0, y: 0 }, { x: p.lab.a, y: p.lab.b }], type: "line", color: c });
    series.push({ points: [{ x: p.lab.a, y: p.lab.b }], type: "scatter", color: c, label: p.label });
  });
  series.push({ points: [{ x: 0, y: 0 }], type: "scatter", color: BLACK, label: "neutral (0, 0)" });
  if (opts.contour) {
    const ring = toleranceContour(opts.contour.f, opts.contour.std, opts.contour.tol, opts.contour.k);
    if (ring.length > 2) series.push({ points: ring, type: "line", color: GREEN, label: `${DE_SYMBOL[opts.contour.f]} = ${f2(opts.contour.tol)}` });
  }
  return parametricPlotSvg(series, { xlabel: "a* (green − / red +)", ylabel: "b* (blue − / yellow +)", title: opts.title, equal: true }, W);
}

/**
 * A close-up of the a*b* plane around the standard: the sample, and the contour on which the chosen formula reaches
 * the tolerance (or, without a tolerance, the sample's own ΔE) at the standard's L*. ΔE*ab's circle of the same value
 * is drawn beside it, so the reader sees how differently the two formulas weigh chroma and hue.
 */
export function abZoomSvg(std: Lab, samples: Array<{ label: string; lab: Lab; pass?: boolean }>, f: DeFormula, level: number, k?: ParametricK): string {
  const series: Series[] = [];
  const ring = toleranceContour(f, std, level, k);
  if (ring.length > 2) series.push({ points: ring, type: "line", color: GREEN, label: `${DE_SYMBOL[f]} = ${f2(level)}` });
  if (f !== "de76") {
    const circle = toleranceContour("de76", std, level);
    if (circle.length > 2) series.push({ points: circle, type: "line", color: GREY, label: `ΔE*ab = ${f2(level)}` });
  }
  series.push({ points: [{ x: std.a, y: std.b }], type: "scatter", color: BLACK, label: "standard" });
  const pass = samples.filter((s) => s.pass !== false);
  const fail = samples.filter((s) => s.pass === false);
  if (samples.length === 1) series.push({ points: [{ x: samples[0].lab.a, y: samples[0].lab.b }], type: "scatter", color: samples[0].pass === false ? RED : BLUE, label: samples[0].label });
  else {
    if (pass.length) series.push({ points: pass.map((s) => ({ x: s.lab.a, y: s.lab.b })), type: "scatter", color: BLUE, label: `pass (${pass.length})` });
    if (fail.length) series.push({ points: fail.map((s) => ({ x: s.lab.a, y: s.lab.b })), type: "scatter", color: RED, label: `fail (${fail.length})` });
  }
  return parametricPlotSvg(series, { xlabel: "a*", ylabel: "b*", equal: true }, W);
}

/** L* of the standard and the sample(s) as bars on 0–100 (the lightness axis the a*b* plane leaves out). */
export function lightnessBarsSvg(names: string[], L: number[], title?: string): string {
  return groupedBarSvg(names, [{ label: "L*", values: L, colour: BLUE }], { ylabel: "L* (0 = black, 100 = white)", title, w: W });
}

/** ΔL* (sample − standard) per sample: above zero lighter, below darker. */
export function deltaLBarsSvg(names: string[], dL: number[]): string {
  return groupedBarSvg(names, [{ label: "ΔL*", values: dL, colour: BLUE }], { ylabel: "ΔL* (+ lighter, − darker)", w: W });
}

/** ΔE per illuminant (metamerism) or per formula: one bar per category. */
export function barsSvg(names: string[], values: number[], ylabel: string, label: string): string {
  return groupedBarSvg(names, [{ label, values, colour: BLUE }], { ylabel, w: W });
}

/** Reflectance (or transmittance) spectra against wavelength. */
export function spectrumSvg(spectra: Array<{ label: string; wl: number[]; v: number[] }>, ylabel = "Reflectance factor"): string {
  const palette = [BLUE, RED, GREEN, ORANGE];
  const series: Series[] = spectra.map((s, i) => ({ points: s.wl.map((w, j) => ({ x: w, y: s.v[j] })), type: "line" as const, color: palette[i % palette.length], label: s.label }));
  const lo = Math.min(...spectra.map((s) => s.wl[0]));
  const hi = Math.max(...spectra.map((s) => s.wl[s.wl.length - 1]));
  const vmax = Math.max(...spectra.flatMap((s) => s.v));
  const vmin = Math.min(0, ...spectra.flatMap((s) => s.v));
  return buildPlotSvg(series, {
    xlabel: "Wavelength (nm)",
    ylabel,
    xLimits: { min: lo, max: hi },
    yLimits: { min: vmin, max: Math.max(vmax * 1.08, 0.05) },
    width: W,
    height: Math.round(W * 0.62),
  });
}

/**
 * The CIE 1931 xy chromaticity diagram for the observer: the spectral locus (360–780 nm) closed by the purple line,
 * the sRGB triangle for orientation, the white point and the colours given. With `dominant`, the line from the white
 * through the colour to the locus (or the purple line) is drawn.
 */
export function chromaticitySvg(
  obs: Observer,
  marks: Array<{ label: string; x: number; y: number; colour?: string }>,
  opts: { white?: { label: string; x: number; y: number }; dominant?: { to: [number, number] }; zoom?: boolean } = {},
): string {
  const locus = spectralLocus(obs);
  const series: Series[] = [];
  if (!opts.zoom) {
    series.push({ points: [...locus.map((p) => ({ x: p.x, y: p.y })), { x: locus[0].x, y: locus[0].y }], type: "line", color: BLACK, label: `locus (${obs}°)` });
    const s = gamutById("srgb")!.primaries;
    series.push({ points: [...s, s[0]].map((p) => ({ x: p.x, y: p.y })), type: "line", color: GREY, label: "sRGB gamut" });
  }
  if (opts.white) series.push({ points: [{ x: opts.white.x, y: opts.white.y }], type: "scatter", color: BLACK, label: opts.white.label });
  if (opts.white && opts.dominant) series.push({ points: [{ x: opts.white.x, y: opts.white.y }, { x: opts.dominant.to[0], y: opts.dominant.to[1] }], type: "line", color: ORANGE, label: "white → colour → locus" });
  const palette = [RED, BLUE, GREEN, ORANGE];
  marks.forEach((m, i) => series.push({ points: [{ x: m.x, y: m.y }], type: "scatter", color: m.colour ?? palette[i % palette.length], label: m.label }));
  if (opts.zoom) {
    // A close-up: a square window centred on the points, at least ±0.01 so a tiny offset is not magnified into a shape.
    const pts = [...marks, ...(opts.white ? [opts.white] : [])];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(0.01, 0.75 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    return buildPlotSvg(series, { xlabel: "x", ylabel: "y", xLimits: { min: cx - half, max: cx + half }, yLimits: { min: cy - half, max: cy + half }, width: W, height: Math.round(W * 0.8) });
  }
  return parametricPlotSvg(series, { xlabel: "x", ylabel: "y", equal: true }, W);
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A contrast sample: the two colours as text on each other at the WCAG normal (16 px) and large (24 px) sizes, each
 * panel captioned with its colours below it in black on white.
 */
export function contrastSwatchSvg(fg: string, bg: string, ratio: string): string {
  const w = W;
  const h = 236;
  const panel = (x: number, fill: string, ink: string, cap: string): string =>
    `<rect x="${x}" y="12" width="210" height="150" fill="${fill}" stroke="#888888" stroke-width="1"/>` +
    `<text x="${x + 14}" y="52" font-family="Arial" font-size="16" fill="${ink}">Normal text 16 px</text>` +
    `<text x="${x + 14}" y="96" font-family="Arial" font-size="24" font-weight="bold" fill="${ink}">Large 24 px</text>` +
    `<text x="${x + 14}" y="140" font-family="Arial" font-size="12" fill="${ink}">Aa Bb 0123</text>` +
    `<text x="${x + 105}" y="184" font-family="Arial" font-size="12" text-anchor="middle" fill="#000000">${esc(cap)}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>` +
    panel(14, bg, fg, `${fg} on ${bg}`) +
    panel(236, fg, bg, `${bg} on ${fg}`) +
    `<text x="${w / 2}" y="218" font-family="Arial" font-size="13" text-anchor="middle" fill="#000000">Contrast ratio ${esc(ratio)} (the same either way round)</text>` +
    `</svg>`
  );
}

/** A colour patch with its hex value, for a conversion or a spectrum (out-of-gamut colours shown clipped, and said). */
export function swatchSvg(patches: Array<{ hex: string; caption: string }>): string {
  const n = Math.max(1, patches.length);
  const pw = Math.min(180, Math.floor((W - 28 - 14 * (n - 1)) / n));
  const h = 196;
  const parts = patches.map((p, i) => {
    const x = 14 + i * (pw + 14);
    return (
      `<rect x="${x}" y="12" width="${pw}" height="130" fill="${p.hex}" stroke="#888888" stroke-width="1"/>` +
      `<text x="${x + pw / 2}" y="164" font-family="Arial" font-size="12" text-anchor="middle" fill="#000000">${esc(p.caption)}</text>` +
      `<text x="${x + pw / 2}" y="182" font-family="Arial" font-size="12" text-anchor="middle" fill="#000000">${esc(p.hex)}</text>`
    );
  });
  const width = Math.max(14 + n * (pw + 14), 200);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"><rect x="0" y="0" width="${width}" height="${h}" fill="#ffffff"/>${parts.join("")}</svg>`;
}
