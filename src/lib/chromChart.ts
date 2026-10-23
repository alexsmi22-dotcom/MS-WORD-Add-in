// The reconstructed chromatogram for the peak-table calculator (chromCalcs.ts): each peak of the table drawn as a
// Gaussian (σ = W₀.₅ / 2.3548) at its retention time, summed into one trace, the tallest point at 100 %. It is a
// picture OF THE TABLE, not the measured trace, and the figure says so in its own notes (the insert path takes the
// SVG and nothing else, so a caption beside it would be lost).
//
// Hand-built rather than buildPlotSvg because the peaks carry labels at their apices, which plot.ts has no place
// for. Every label is placed against the trace it sits over (measured from the polyline actually drawn, not the
// ideal curve), raised past any label it would touch, and given up (named in a note) when it cannot fit; names are
// used when every one fits, numbers with a key in the notes otherwise. Text boxes are sized at 0.6 em per glyph, a
// little over the layout audit's 0.58, so what this file thinks is clear the audit also finds clear.
//
// Colours are literal hex and the face is Arial (inserted artwork never follows the pane theme). Bounded: at most
// 200 peaks (chromatography.ts MAX_PEAKS) and a fixed number of samples per peak.

import { linearAxis } from "./axis";
import { escapeXml, NOTE_SIZE, NOTE_LH } from "./plot";
import { MAX_PEAKS, type DrawPeak } from "./chromatography";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#000000";
const AXIS = "#333333";
const TRACE = "#000000";
const LABEL = "#1f1f1f";
const W = 480;
const L = 52;
const R = 16;
const T = 40;
const PH = 196;
const LABEL_FS = 10;
const ADV = 0.6;

export interface ChromFigure {
  svg: string;
  width: number;
  height: number;
  /** Peaks (1-based elution numbers) that could not be labelled. */
  unlabelled: number[];
  /** True when the labels are numbers (with a key in the notes) rather than names. */
  numbered: boolean;
}

const f1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
/** Note lines at most this many characters: 0.6 em per glyph of the 9 px face (over the audit's 0.58), x = 8 to W − 8. */
const NOTE_CHARS = Math.floor((W - 16) / (NOTE_SIZE * 0.6));
const NOTE_LINES = 14;
/** Greedy packing of atoms into lines; an atom longer than a line is hard-split. Bounded at NOTE_LINES lines. */
function packNotes(notes: string[][]): string[] {
  const out: string[] = [];
  for (const atoms of notes) {
    let cur = "";
    for (const raw of atoms) {
      let a = raw;
      while (a.length > NOTE_CHARS) {
        if (cur) out.push(cur);
        cur = "";
        out.push(a.slice(0, NOTE_CHARS));
        a = a.slice(NOTE_CHARS);
      }
      if (!cur) cur = a;
      else if (cur.length + 1 + a.length <= NOTE_CHARS) cur += ` ${a}`;
      else {
        out.push(cur);
        cur = a;
      }
    }
    if (cur) out.push(cur);
  }
  if (out.length <= NOTE_LINES) return out;
  return [...out.slice(0, NOTE_LINES - 1), `(+${out.length - NOTE_LINES + 1} more lines not shown; the full list is in the table)`];
}

/** First index i with a[i] >= v (a ascending). */
function lowerBound(a: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The sampled trace: a coarse uniform grid plus 31 points over ±4σ of every Gaussian peak (its apex exact). */
function sampleTrace(draw: DrawPeak[], lo: number, hi: number): Array<[number, number]> {
  const xs: number[] = [];
  const N0 = 480;
  for (let i = 0; i <= N0; i++) xs.push(lo + ((hi - lo) * i) / N0);
  for (const p of draw) {
    if (p.sigma === null) continue;
    for (let j = -15; j <= 15; j++) {
      const x = p.tR + (j / 15) * 4 * p.sigma;
      if (x >= lo && x <= hi) xs.push(x);
    }
  }
  xs.sort((a, b) => a - b);
  const ux: number[] = [];
  for (const x of xs) if (!ux.length || x > ux[ux.length - 1]) ux.push(x);
  const ys = new Float64Array(ux.length);
  // Each peak adds to the samples within ±9σ of it only (found by bisection): O(samples + peaks × window).
  for (const p of draw) {
    if (p.sigma === null) continue;
    const s = p.sigma;
    let i = lowerBound(ux, p.tR - 9 * s);
    for (; i < ux.length && ux[i] <= p.tR + 9 * s; i++) {
      const z = (ux[i] - p.tR) / s;
      ys[i] += p.rel * Math.exp(-0.5 * z * z);
    }
  }
  return ux.map((x, i) => [x, ys[i]] as [number, number]);
}

/**
 * The chromatogram. `draw` from chromatography.drawPlan; `numbers` are the peaks' 1-based elution numbers (the
 * same order as `draw`); `notes` go into the figure under the axis title.
 */
export function chromatogramSvg(
  draw: DrawPeak[],
  opts: { unit: string; numbers: number[]; notes?: string[]; named: boolean },
): ChromFigure {
  if (draw.length > MAX_PEAKS) throw new Error(`at most ${MAX_PEAKS} peaks`);
  if (!draw.length) throw new Error("nothing to draw");
  // The time window: every peak with 4σ either side, padded 6 %, never before 0.
  let tmin = Infinity;
  let tmax = -Infinity;
  for (const p of draw) {
    const s = p.sigma ?? 0;
    tmin = Math.min(tmin, p.tR - 4 * s);
    tmax = Math.max(tmax, p.tR + 4 * s);
  }
  let span = tmax - tmin;
  if (!(span > 0)) span = Math.max(Math.abs(tmax) * 0.2, 1e-6);
  const lo = Math.max(0, tmin - 0.06 * span);
  const hi = tmax + 0.06 * span;
  const trace = sampleTrace(draw, lo, hi);
  // The sticks (no W₀.₅) and the trace share one 0–100 % scale: the tallest point drawn is 100.
  let top = 0;
  for (const [, y] of trace) top = Math.max(top, y);
  for (const p of draw) if (p.sigma === null) top = Math.max(top, p.rel);
  if (!(top > 0)) top = 1;
  const px = (x: number): number => L + ((x - lo) / (hi - lo)) * (W - L - R);
  const py = (y: number): number => T + PH - (y / top) * 100 * (PH / 100);
  const bottom = T + PH;

  const parts: string[] = [];
  // Axes: left and bottom only (an open frame, as a chromatogram is drawn).
  parts.push(`<line x1="${L}" y1="${T - 4}" x2="${L}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>`);
  parts.push(`<line x1="${L}" y1="${bottom}" x2="${W - R}" y2="${bottom}" stroke="${AXIS}" stroke-width="1"/>`);
  const xa = linearAxis(lo, hi, { target: 6 });
  xa.values.forEach((v, i) => {
    const x = px(v);
    parts.push(`<line x1="${f1(x)}" y1="${bottom}" x2="${f1(x)}" y2="${bottom + 4}" stroke="${AXIS}" stroke-width="1"/>`);
    parts.push(`<text x="${f1(x)}" y="${bottom + 15}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${INK}">${escapeXml(xa.labels[i])}</text>`);
  });
  const ya = linearAxis(0, 100, { target: 5 });
  ya.values.forEach((v, i) => {
    const y = T + PH - v * (PH / 100);
    parts.push(`<line x1="${L - 4}" y1="${f1(y)}" x2="${L}" y2="${f1(y)}" stroke="${AXIS}" stroke-width="1"/>`);
    parts.push(`<text x="${L - 6}" y="${f1(y + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${INK}">${escapeXml(ya.labels[i])}</text>`);
  });
  const xTitle = `Time (${opts.unit})${xa.multiplier ? ` ${xa.multiplier}` : ""}`;
  parts.push(`<text x="${f1((L + W - R) / 2)}" y="${bottom + 32}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${escapeXml(xTitle)}</text>`);
  const cy = T + PH / 2;
  parts.push(`<text x="14" y="${cy}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}" transform="rotate(-90 14 ${cy})">Relative response (%)</text>`);

  // The trace, then the sticks.
  const pts = trace.map(([x, y]) => [px(x), py(y)] as [number, number]);
  const ptsX = pts.map((p) => p[0]);
  parts.push(`<polyline points="${pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ")}" fill="none" stroke="${TRACE}" stroke-width="1.2" stroke-linejoin="round"/>`);
  const sticks: Array<[number, number]> = [];
  for (const p of draw)
    if (p.sigma === null) {
      const x = px(p.tR), y = py(p.rel);
      sticks.push([x, y]);
      parts.push(`<line x1="${f1(x)}" y1="${bottom}" x2="${f1(x)}" y2="${f1(y)}" stroke="${TRACE}" stroke-width="1.2"/>`);
    }

  /** The highest drawn ink (smallest SVG y) over [x0, x1]: the polyline's segments clipped to it, and the sticks. */
  const inkTop = (x0: number, x1: number): number => {
    let yTop = bottom;
    const start = Math.max(1, lowerBound(ptsX, x0));
    for (let i = start; i < pts.length && pts[i - 1][0] <= x1; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      if (bx < x0 || ax > x1) continue;
      const at = (x: number): number => (bx === ax ? Math.min(ay, by) : ay + ((by - ay) * (x - ax)) / (bx - ax));
      yTop = Math.min(yTop, at(Math.max(ax, x0)), at(Math.min(bx, x1)));
    }
    for (const [sx, sy] of sticks) if (sx >= x0 - 1 && sx <= x1 + 1) yTop = Math.min(yTop, sy);
    return yTop;
  };

  type Box = { x0: number; x1: number; y0: number; y1: number };
  const place = (texts: string[]): { boxes: Array<{ box: Box; x: number; y: number; text: string } | null>; failed: number } => {
    const placed: Box[] = [];
    const out: Array<{ box: Box; x: number; y: number; text: string } | null> = [];
    let failed = 0;
    draw.forEach((p, i) => {
      const text = texts[i];
      const w = text.length * LABEL_FS * ADV + 2;
      let x = px(p.tR);
      x = Math.min(Math.max(x, L + 3 + w / 2), W - 3 - w / 2);
      const x0 = x - w / 2, x1 = x + w / 2;
      // Baseline 4 px above the ink under the label; raised past any earlier label it would touch.
      let y = inkTop(x0 - 2, x1 + 2) - 4 - LABEL_FS * 0.25;
      for (let guard = 0; guard <= placed.length; guard++) {
        const hit = placed.find((b) => b.x0 < x1 + 2 && b.x1 > x0 - 2 && b.y0 < y + LABEL_FS * 0.25 + 1 && b.y1 > y - LABEL_FS * 0.8 - 1);
        if (!hit) break;
        y = hit.y0 - 2 - LABEL_FS * 0.25;
      }
      const box = { x0, x1, y0: y - LABEL_FS * 0.8, y1: y + LABEL_FS * 0.25 };
      const clear = !placed.some((b) => b.x0 < x1 + 2 && b.x1 > x0 - 2 && b.y0 < box.y1 + 1 && b.y1 > box.y0 - 1);
      if (box.y0 < 2 || !clear) {
        failed++;
        out.push(null);
        return;
      }
      placed.push(box);
      out.push({ box, x, y, text });
    });
    return { boxes: out, failed };
  };
  const numbersText = opts.numbers.map(String);
  let numbered = !opts.named;
  let laid = place(opts.named ? draw.map((p) => (p.label.length <= 24 ? p.label : "")) : numbersText);
  if (opts.named && (laid.failed || draw.some((p) => p.label.length > 24))) {
    numbered = true;
    laid = place(numbersText);
  }
  const unlabelled: number[] = [];
  laid.boxes.forEach((b, i) => {
    if (!b) {
      unlabelled.push(opts.numbers[i]);
      return;
    }
    parts.push(`<text x="${f1(b.x)}" y="${f1(b.y)}" text-anchor="middle" font-family="${FONT}" font-size="${LABEL_FS}" fill="${LABEL}">${escapeXml(b.text)}</text>`);
  });

  // Each note is a list of ATOMS that a line break may fall between: words, or for the key whole "n = name;"
  // entries, so "5" never ends one line with "= Compound 5" starting the next.
  const notes: string[][] = [words("Reconstructed from the peak table (Gaussian peaks), not the measured trace.")];
  if (numbered && opts.named) notes.push(["Peaks:", ...draw.map((p, i) => `${opts.numbers[i]} = ${p.label}${i < draw.length - 1 ? ";" : "."}`)]);
  if (unlabelled.length) notes.push(words(`Too crowded to number in the figure: peak${unlabelled.length > 1 ? "s" : ""} ${unlabelled.join(", ")} (see the table).`));
  for (const n of opts.notes ?? []) notes.push(words(n));
  const lines = packNotes(notes);
  let y = bottom + 50;
  for (const l of lines) {
    parts.push(`<text x="8" y="${y}" font-family="${FONT}" font-size="${NOTE_SIZE}" fill="#444444">${escapeXml(l)}</text>`);
    y += NOTE_LH;
  }
  const H = Math.ceil(y - NOTE_LH + 8);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    parts.join("") +
    `</svg>`;
  return { svg, width: W, height: H, unlabelled, numbered };
}
