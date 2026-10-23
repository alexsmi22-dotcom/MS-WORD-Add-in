// Figures for Release Q parts Q1 + Q3 (Dirac linear algebra, density matrices, entanglement):
//   - amplitudeChartSvg: a state's amplitudes as two aligned panels, the modulus |cₖ| as bars and the phase arg cₖ as
//     stems (−180° … 180°), one colour per state when two are compared;
//   - matrixHeatmapSvg: an operator's entries |Aᵢⱼ| as a single-hue heat map with a colour bar, the exact entry printed
//     in each cell up to 4 × 4;
//   - quantumBarsSvg: labelled bars on a signed axis with a zero line (outcome probabilities, eigenvalue spectra,
//     Schmidt coefficients, the partial-transpose spectrum with its negative eigenvalues marked in red).
// Colours are literal hex; Arial (as engCharts2026.ts and quantumCharts.ts). Every builder caps what it draws.

import { textWidthPt } from "./arialMetrics";
import { fmtSig, linearAxis } from "./axis";
import type { CMat, Cx } from "./quantumCore";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000", extra = ""): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}"${extra}>${esc(t)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = "#000000", w = 1, dash = ""): string =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, stroke = "none"): string =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${stroke !== "none" ? ` stroke="${stroke}" stroke-width="0.8"` : ""}/>`;
const svgOpen = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}"><rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="#ffffff"/>`;
const tw = (t: string, size: number): number => textWidthPt(t, size);
const vtext = (x: number, y: number, t: string, size = 12): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="${size}" fill="#000000" transform="rotate(-90 ${f(x)} ${f(y)})">${esc(t)}</text>`;
/** Three significant figures, trailing zeros dropped, U+2212. */
const sig = (v: number, n = 3): string =>
  Math.abs(v) < 5e-13 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** The most basis states / bars one figure draws; beyond it the largest are drawn and the rest noted. */
export const DIRAC_MAX_BARS = 32;

const SERIES_COLORS = ["#1f5fa8", "#d07a00"];

// ---------------------------------------------------------------------------------------------------------------
// Amplitudes: modulus bars over phase stems
// ---------------------------------------------------------------------------------------------------------------

export interface AmplitudeSeries {
  name: string;
  amps: Cx[];
}

/**
 * Amplitudes of one or two states over the same basis: |cₖ| as bars (top panel) and arg cₖ in degrees as stems from
 * 0 (bottom panel, drawn only where |cₖ| > 10⁻⁹ — a zero amplitude has no phase). At most 32 basis states: the
 * largest (by the larger modulus of the series) in index order, the rest noted.
 */
export function amplitudeChartSvg(labels: string[], series: AmplitudeSeries[]): string {
  const ser = series.slice(0, 2);
  const n = labels.length;
  let keep = Array.from({ length: n }, (_, k) => k);
  let restNote = "";
  if (n > DIRAC_MAX_BARS) {
    const mag = (k: number): number => Math.max(...ser.map((s) => Math.hypot(s.amps[k].re, s.amps[k].im)));
    const top = new Set([...keep].sort((a, b) => mag(b) - mag(a) || a - b).slice(0, DIRAC_MAX_BARS));
    keep = keep.filter((k) => top.has(k));
    restNote = `${n - keep.length} other basis states not drawn`;
  }
  const labs = keep.map((k) => labels[k]);
  const maxLab = Math.max(...labs.map((l) => tw(l, 11)));
  const slot = Math.max(ser.length > 1 ? 34 : 24, Math.min(56, Math.floor(560 / Math.max(1, keep.length))));
  const rotate = maxLab + 6 > slot;
  const L = 62, Rm = 18;
  const plotW = keep.length * slot;
  const W = Math.max(360, L + plotW + Rm);
  const x0 = L + (W - L - Rm - plotW) / 2;
  const out: string[] = [];
  let T = 14;
  if (ser.length > 1) {
    // Legend in one row above the panels.
    let lx = L;
    for (let s = 0; s < ser.length; s++) {
      out.push(rect(lx, T, 12, 10, SERIES_COLORS[s]));
      out.push(text(lx + 17, T + 9, ser[s].name, "start", 11));
      lx += 17 + tw(ser[s].name, 11) + 22;
    }
    T += 22;
  }
  // Top panel: modulus.
  const H1 = 150;
  const B1 = T + H1;
  const maxMag = Math.max(1e-12, ...keep.flatMap((k) => ser.map((s) => Math.hypot(s.amps[k].re, s.amps[k].im))));
  const top = [0.25, 0.5, 0.75, 1].find((v) => v >= maxMag - 1e-12) ?? 1;
  const ticks = top === 0.75 ? 3 : top === 0.25 ? 5 : top === 0.5 ? 5 : 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (top * i) / ticks;
    const y = B1 - (H1 * i) / ticks;
    out.push(line(L, y, W - Rm, y, i === 0 ? "#000000" : "#e3e3e3", i === 0 ? 1 : 0.8));
    out.push(line(L - 4, y, L, y));
    out.push(text(L - 7, y + 4, sig(v), "end", 11));
  }
  out.push(line(L, T, L, B1));
  out.push(vtext(18, T + H1 / 2, "Modulus |cₖ|"));
  const nS = ser.length;
  const bw = Math.min(22, (slot * 0.72) / nS);
  const xOf = (i: number, s: number): number => x0 + slot * (i + 0.5) + (s - (nS - 1) / 2) * bw;
  keep.forEach((k, i) => {
    ser.forEach((s, si) => {
      const m = Math.hypot(s.amps[k].re, s.amps[k].im);
      const h = (H1 * m) / top;
      if (h > 0.2) out.push(rect(xOf(i, si) - bw / 2, B1 - h, bw, h, SERIES_COLORS[si]));
    });
  });
  // Bottom panel: phase, −180° … 180°.
  const gap = 26;
  const T2 = B1 + gap;
  const H2 = 120;
  const B2 = T2 + H2;
  const yPh = (deg: number): number => T2 + (H2 * (180 - deg)) / 360;
  for (const d of [-180, -90, 0, 90, 180]) {
    const y = yPh(d);
    out.push(line(L, y, W - Rm, y, d === 0 ? "#000000" : "#e3e3e3", d === 0 ? 1 : 0.8));
    out.push(line(L - 4, y, L, y));
    out.push(text(L - 7, y + 4, `${d < 0 ? "−" : ""}${Math.abs(d)}°`, "end", 11));
  }
  out.push(line(L, T2, L, B2));
  out.push(vtext(18, T2 + H2 / 2, "Phase arg cₖ"));
  keep.forEach((k, i) => {
    ser.forEach((s, si) => {
      const z = s.amps[k];
      if (Math.hypot(z.re, z.im) <= 1e-9) return;
      let deg = (Math.atan2(z.im, z.re) * 180) / Math.PI;
      if (deg <= -180 + 1e-9) deg = 180;
      const x = xOf(i, si);
      out.push(line(x, yPh(0), x, yPh(deg), SERIES_COLORS[si], 1.6));
      out.push(`<circle cx="${f(x)}" cy="${f(yPh(deg))}" r="3.6" fill="${SERIES_COLORS[si]}"/>`);
    });
  });
  // Basis labels under the phase panel.
  keep.forEach((_, i) => {
    const xc = x0 + slot * (i + 0.5);
    if (rotate) {
      const y = B2 + 6 + tw(labs[i], 11) / 2;
      out.push(`<text x="${f(xc + 4)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#000000" transform="rotate(-90 ${f(xc + 4)} ${f(y)})">${esc(labs[i])}</text>`);
    } else out.push(text(xc, B2 + 15, labs[i], "middle", 11));
  });
  let yb = B2 + (rotate ? maxLab + 10 : 18) + 18;
  out.push(text(L + (W - L - Rm) / 2, yb, "Basis state", "middle", 12));
  if (restNote) {
    yb += 16;
    out.push(text(L + (W - L - Rm) / 2, yb, restNote, "middle", 11, "#444444"));
  }
  return svgOpen(W, yb + 10) + out.join("") + "</svg>";
}

// ---------------------------------------------------------------------------------------------------------------
// Matrix heat map
// ---------------------------------------------------------------------------------------------------------------

/** A sequential single-hue ramp (white → dark blue) at t ∈ [0, 1]. */
function ramp(t: number): string {
  const a = [247, 251, 255], b = [8, 48, 107];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t))));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * |Aᵢⱼ| as a heat map: rows labelled ⟨i|, columns |j⟩, a colour bar from 0 to the largest modulus. Up to 4 × 4 the
 * entry itself (cellText) is printed in each cell, white on dark cells. Operators are at most 16 × 16.
 */
export function matrixHeatmapSvg(M: CMat, labels: string[], cellText: (z: Cx) => string, title = "|Aᵢⱼ|"): string {
  const d = Math.min(M.length, 16);
  const showText = d <= 4;
  const texts = showText ? M.map((r) => r.map(cellText)) : [];
  const textW = showText ? Math.max(...texts.flat().map((t) => tw(t, 11))) : 0;
  const cell = showText ? Math.max(46, Math.min(150, textW + 14)) : Math.max(18, Math.floor(400 / d));
  const rowLabW = Math.max(...labels.slice(0, d).map((l) => tw(`⟨${l}|`, 11)));
  const colLabW = Math.max(...labels.slice(0, d).map((l) => tw(`|${l}⟩`, 11)));
  const rotateCols = colLabW + 6 > cell;
  const L = 16 + rowLabW + 8;
  const T = (rotateCols ? colLabW + 12 : 22) + 8;
  const gridW = d * cell;
  const barX = L + gridW + 26, barW = 14;
  const maxMod = Math.max(0, ...M.slice(0, d).flatMap((r) => r.slice(0, d).map((z) => Math.hypot(z.re, z.im))));
  const barLab = [sig(maxMod), sig(maxMod / 2), "0"];
  const W = barX + barW + 8 + Math.max(...barLab.map((t) => tw(t, 11))) + 16;
  const out: string[] = [];
  for (let i = 0; i < d; i++)
    for (let j = 0; j < d; j++) {
      const m = Math.hypot(M[i][j].re, M[i][j].im);
      const t = maxMod > 0 ? m / maxMod : 0;
      const x = L + j * cell, y = T + i * cell;
      out.push(rect(x, y, cell, cell, ramp(t), "#ffffff"));
      if (showText) out.push(text(x + cell / 2, y + cell / 2 + 4, texts[i][j], "middle", 11, t > 0.55 ? "#ffffff" : "#000000"));
    }
  out.push(`<rect x="${f(L)}" y="${f(T)}" width="${f(gridW)}" height="${f(gridW)}" fill="none" stroke="#6b6b6b" stroke-width="1"/>`);
  for (let k = 0; k < d; k++) {
    out.push(text(L - 6, T + k * cell + cell / 2 + 4, `⟨${labels[k]}|`, "end", 11));
    const xc = L + k * cell + cell / 2;
    if (rotateCols) {
      const y = T - 6 - tw(`|${labels[k]}⟩`, 11) / 2;
      out.push(`<text x="${f(xc + 4)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#000000" transform="rotate(-90 ${f(xc + 4)} ${f(y)})">${esc(`|${labels[k]}⟩`)}</text>`);
    } else out.push(text(xc, T - 7, `|${labels[k]}⟩`, "middle", 11));
  }
  // Colour bar.
  const steps = 24;
  for (let s = 0; s < steps; s++) out.push(rect(barX, T + (gridW * s) / steps, barW, gridW / steps + 0.5, ramp(1 - s / steps)));
  out.push(`<rect x="${f(barX)}" y="${f(T)}" width="${barW}" height="${f(gridW)}" fill="none" stroke="#6b6b6b" stroke-width="0.8"/>`);
  // An all-zero operator has one tick, 0 (three ticks all reading "0" would be a duplicate-label axis).
  (maxMod > 0 ? [0, 0.5, 1] : [1]).forEach((p) => {
    const i = p === 0 ? 0 : p === 0.5 ? 1 : 2;
    const y = T + gridW * p;
    out.push(line(barX + barW, y, barX + barW + 4, y));
    out.push(text(barX + barW + 7, y + 4, barLab[i], "start", 11));
  });
  out.push(text(barX + barW / 2, T - 8, title, "middle", 11));
  const H = T + gridW + 16;
  return svgOpen(W, H) + out.join("") + "</svg>";
}

// ---------------------------------------------------------------------------------------------------------------
// Signed bars
// ---------------------------------------------------------------------------------------------------------------

export interface BarsFigure {
  values: number[];
  labels: string[];
  yTitle: string;
  xTitle: string;
  /** Print each bar's value at its end (default when ≤ 16 bars). */
  valueLabels?: boolean;
  /** A horizontal reference line (dashed) with its label, e.g. 1/d for a maximally mixed spectrum. */
  ref?: { value: number; label: string };
  /** A note under the x title. */
  note?: string;
}

/**
 * Labelled bars on a signed axis: positive bars blue, negative bars red (the axis always holds 0, with a solid zero
 * line). At most 32 bars (the caller passes what it wants drawn; extra values are cut and noted).
 */
export function quantumBarsSvg(fig: BarsFigure): string {
  const nAll = fig.values.length;
  const vals = fig.values.slice(0, DIRAC_MAX_BARS).map((v) => (Math.abs(v) < 1e-13 ? 0 : v));
  const labs = fig.labels.slice(0, DIRAC_MAX_BARS);
  const lo0 = Math.min(0, ...vals, fig.ref ? fig.ref.value : 0);
  const hi0 = Math.max(0, ...vals, fig.ref ? fig.ref.value : 0);
  const span = hi0 - lo0 || 1;
  // Head-room for the value labels: above the tallest bar, and below the deepest negative one.
  const lo = lo0 < 0 ? lo0 - 0.09 * span : 0;
  const hi = hi0 > 0 ? hi0 + 0.06 * span : lo0 < 0 ? 0 : 1;
  const ax = linearAxis(lo, hi, { loose: true, target: 5 });
  const yLo = ax.lo, yHi = ax.hi;
  const maxLab = Math.max(...labs.map((l) => tw(l, 11)));
  const slot = Math.max(26, Math.min(64, Math.floor(560 / Math.max(1, vals.length))));
  const rotate = maxLab + 6 > slot;
  const tickW = Math.max(...ax.labels.map((t) => tw(t, 11)));
  const L = Math.max(54, tickW + 34), Rm = 18;
  const plotW = vals.length * slot;
  const refW = fig.ref ? tw(fig.ref.label, 10) + 8 : 0;
  const W = Math.max(320, L + plotW + Rm + refW);
  const x0 = L + (W - L - Rm - refW - plotW) / 2;
  const T = 18, H = 200, B = T + H;
  const yOf = (v: number): number => T + (H * (yHi - v)) / (yHi - yLo);
  const out: string[] = [];
  ax.values.forEach((v, i) => {
    const y = yOf(v);
    out.push(line(L, y, W - Rm - refW, y, "#e3e3e3", 0.8));
    out.push(line(L - 4, y, L, y));
    out.push(text(L - 7, y + 4, ax.labels[i] + (i === ax.values.length - 1 && ax.multiplier ? ` ${ax.multiplier}` : ""), "end", 11));
  });
  out.push(line(L, T, L, B));
  out.push(line(L, yOf(0), W - Rm - refW, yOf(0), "#000000", 1));
  out.push(vtext(16, T + H / 2, fig.yTitle));
  if (fig.ref) {
    const y = yOf(fig.ref.value);
    out.push(line(L, y, W - Rm - refW, y, "#6b6b6b", 1, "4,3"));
    out.push(text(W - Rm - refW + 4, y + 4, fig.ref.label, "start", 10, "#444444"));
  }
  const bw = Math.min(30, slot * 0.66);
  // Value labels only when each fits its own slot with a gap (neighbouring labels never touch).
  const showVals = (fig.valueLabels ?? vals.length <= 16) && Math.max(...vals.map((v) => tw(sig(v), 10))) <= slot - 8;
  vals.forEach((v, i) => {
    const xc = x0 + slot * (i + 0.5);
    const y0 = yOf(0), y1 = yOf(v);
    const neg = v < 0;
    if (Math.abs(y1 - y0) > 0.2) out.push(rect(xc - bw / 2, Math.min(y0, y1), bw, Math.abs(y1 - y0), neg ? "#c00000" : "#1f5fa8"));
    if (showVals && v !== 0) out.push(text(xc, neg ? y1 + 13 : y1 - 4, sig(v), "middle", 10, neg ? "#c00000" : "#000000"));
  });
  // Labels sit under the plot frame (below any negative bar).
  labs.forEach((l, i) => {
    const xc = x0 + slot * (i + 0.5);
    if (rotate) {
      const y = B + 6 + tw(l, 11) / 2;
      out.push(`<text x="${f(xc + 4)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#000000" transform="rotate(-90 ${f(xc + 4)} ${f(y)})">${esc(l)}</text>`);
    } else out.push(text(xc, B + 15, l, "middle", 11));
  });
  let yb = B + (rotate ? maxLab + 10 : 18) + 18;
  out.push(text(L + (W - L - Rm) / 2, yb, fig.xTitle, "middle", 12));
  const notes = [fig.note, nAll > vals.length ? `${nAll - vals.length} more not drawn` : ""].filter(Boolean) as string[];
  for (const nt of notes) {
    yb += 16;
    out.push(text(L + (W - L - Rm) / 2, yb, nt, "middle", 11, "#444444"));
  }
  return svgOpen(W, yb + 10) + out.join("") + "</svg>";
}
