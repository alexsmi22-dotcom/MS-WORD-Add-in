// Two data series that share x, each on its own y axis (Plot ▸ Plot type ▸
// Two y axes).
//
// Each axis is coloured to match its series and has its own, independent scale
// (linear or log₁₀, the axis engine's own ticks — plot.ts plotAxisTicks — so a
// log axis here reads exactly like a log axis in an ordinary plot). Colour is
// never the only cue: series 1 is a solid line with filled circles, series 2 a
// dashed line with hollow squares, and a key under the plot names which axis
// each belongs to, so the figure survives black-and-white printing.

import { Point, AxisScale, plotAxisTicks, PlotAxisTicks, escapeXml, layoutNotes, NOTE_LH, NOTE_SIZE } from "./plot";
import { seriesStyle, seriesMarkerSvg, SeriesStyle } from "./categoricalPalette";
import { readDataBlock } from "./dataBlock";

const FONT = "Arial, Helvetica, sans-serif";

/** A point of one series; `gap` = a missing value came before it, so the line breaks here. */
export interface DualPoint extends Point {
  gap?: boolean;
}

export interface DualRows {
  left: DualPoint[];
  right: DualPoint[];
  /** Lines that could not be read, as typed (for the note). */
  skipped: string[];
  /** Lines with more than three fields (the extra fields are not plotted). */
  extraColumns: number;
  /** How the commas were read, for the note ("" when there were none to weigh). */
  commaNote: string;
  /** Set when the block cannot be read without guessing (an ambiguous comma). */
  refusal?: string;
}


/** Hard cap on data rows read. */
export const DUAL_ROWS_MAX = 5000;

/**
 * Parses "x y₁ y₂" lines through RULE N (dataBlock.readDataBlock, the one reader
 * the titration and materials tools use): one field-separator decision per
 * block, comma-numbers read by the block's evidence or refused by name, a block
 * mixing dot decimals and comma-numbers refused, a word row refused with its
 * line number, an all-word first row read as a header. Lines starting with #
 * are comments. A missing value (-, NA, N/A, nan, ., an empty field, or a short
 * row) BREAKS that series' line there.
 */
export function parseDualData(text: string): DualRows {
  const left: DualPoint[] = [];
  const right: DualPoint[] = [];
  const skipped: string[] = [];
  let extraColumns = 0;
  const src = text.split(/\r?\n/);
  // Comments become blank lines, so the reader's line numbers still match the paste.
  const clean = src.map((l) => (l.trim().startsWith("#") ? "" : l)).join("\n");
  const b = readDataBlock(clean, "The data", { maxRows: DUAL_ROWS_MAX });
  if (!b.ok) return { left, right, skipped, extraColumns, commaNote: "", refusal: b.error };
  let gapL = false;
  let gapR = false;
  b.rows.forEach((r, k) => {
    const x = r[0] ?? null;
    const a = r[1] ?? null;
    const c = r[2] ?? null;
    if (x === null || (a === null && c === null)) {
      skipped.push((src[b.lines[k] - 1] ?? "").trim());
      return;
    }
    if (r.length > 3 && r.slice(3).some((v) => v !== null)) extraColumns++;
    if (a !== null) {
      left.push(gapL && left.length ? { x, y: a, gap: true } : { x, y: a });
      gapL = false;
    } else gapL = true;
    if (c !== null) {
      right.push(gapR && right.length ? { x, y: c, gap: true } : { x, y: c });
      gapR = false;
    } else gapR = true;
  });
  return { left, right, skipped, extraColumns, commaNote: b.notes.join(" ") };
}

export interface DualFigure {
  left: DualPoint[];
  right: DualPoint[];
  xScale?: AxisScale;
  leftScale?: AxisScale;
  rightScale?: AxisScale;
  title?: string;
  xlabel?: string;
  leftLabel?: string;
  rightLabel?: string;
  notes?: string[];
  width?: number;
  height?: number;
  /**
   * Black and white (37 CFR 1.84(a)(1), the USPTO figure style): both series in black, told apart by
   * the dash and marker they already carry (seriesStyle grey), no light grid, black frame and text.
   */
  bw?: boolean;
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

function domain(vals: number[], log: boolean, pad: boolean): { lo: number; hi: number } {
  const t = vals.map((v) => (log ? Math.log10(v) : v));
  let lo = Math.min(...t);
  let hi = Math.max(...t);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  if (pad) {
    const p = (hi - lo) * 0.06;
    lo -= p;
    hi += p;
  }
  return { lo, hi };
}

const withMult = (label: string, ax: PlotAxisTicks): string => (ax.multiplier ? (label ? `${label} (${ax.multiplier})` : ax.multiplier) : label);

/** What a log axis cannot show, removed and counted (the caller must say so). */
export function dropForDualScales(fig: DualFigure): { fig: DualFigure; dropped: number } {
  let dropped = 0;
  // A dropped point breaks its line like a missing value: the next kept point starts a new run.
  const keep = (pts: DualPoint[], logY: boolean): DualPoint[] => {
    const out: DualPoint[] = [];
    let gap = false;
    for (const p of pts) {
      const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && !(fig.xScale === "log" && !(p.x > 0)) && !(logY && !(p.y > 0));
      if (!ok) {
        dropped++;
        gap = true;
        continue;
      }
      out.push((gap || p.gap) && out.length ? { ...p, gap: true } : { x: p.x, y: p.y });
      gap = false;
    }
    return out;
  };
  return { fig: { ...fig, left: keep(fig.left, fig.leftScale === "log"), right: keep(fig.right, fig.rightScale === "log") }, dropped };
}

/** The two-y-axis figure. Both series must be non-empty and finite (dropForDualScales first). */
export function dualAxisPlotSvg(fig: DualFigure): string {
  const W = fig.width ?? 380;
  const H = fig.height ?? 270;
  const logX = fig.xScale === "log";
  const logL = fig.leftScale === "log";
  const logR = fig.rightScale === "log";
  const bw = fig.bw === true;
  const INK = bw ? "#000000" : "#333333";
  const RULE = bw ? "#000000" : "#888888";
  const sL: SeriesStyle = seriesStyle(0, { grey: bw });
  const sR: SeriesStyle = { ...seriesStyle(1, { grey: bw }), filled: false };
  const xs = [...fig.left, ...fig.right].map((p) => p.x);
  const xd = domain(xs, logX, false);
  const ld = domain(fig.left.map((p) => p.y), logL, true);
  const rd = domain(fig.right.map((p) => p.y), logR, true);
  const xAxis = plotAxisTicks(xd.lo, xd.hi, logX, 6, undefined, undefined);
  const lAxis = plotAxisTicks(ld.lo, ld.hi, logL, 5, undefined, undefined);
  const rAxis = plotAxisTicks(rd.lo, rd.hi, logR, 5, undefined, undefined);
  const xlabel = withMult(fig.xlabel ?? "", xAxis);
  const leftLabel = withMult(fig.leftLabel ?? "", lAxis);
  const rightLabel = withMult(fig.rightLabel ?? "", rAxis);
  const widest = (ax: PlotAxisTicks): number => Math.max(1, ...ax.ticks.map((t) => t.text.length));
  let ml = Math.min(130, Math.max(48, Math.ceil(widest(lAxis) * 6 + 7 + (leftLabel ? 23 : 4))));
  let mr = Math.min(130, Math.max(48, Math.ceil(widest(rAxis) * 6 + 7 + (rightLabel ? 23 : 4))));
  const mt = fig.title ? 26 : 12;
  // The key: side by side when both entries fit in half the width each, else
  // one per row (a long axis title is shortened only past the full width).
  // Black and white (USPTO): the key names the axis only (its title is beside it), so an entry is never shortened.
  const keyText = (label: string | undefined, side: string): string => (label && !bw ? `${side} axis: ${label}` : `${side} axis`);
  const halfRoom = Math.floor((W / 2 - 8 - 24 - 10) / 6);
  const fullRoom = Math.max(8, Math.floor((W - 16 - 24) / 6));
  const keyL = keyText(fig.leftLabel, "left");
  const keyR = keyText(fig.rightLabel, "right");
  const stacked = keyL.length > halfRoom || keyR.length > halfRoom;
  const keyH = stacked ? 30 : 16;
  const mb = (xlabel ? 42 : 30) + keyH;
  const ph = H - mt - mb;
  // Black and white (USPTO, review round 1): an axis title is never clipped. It is centred on the frame and moved to
  // stay on the canvas, above the key; a title longer than that room is set on two lines; a title that
  // cannot fit on two is refused by name (USPTO lettering cannot shrink below 37 CFR 1.84(p)(3)).
  const TITLE_FS = 11;
  const titleLen = (t: string): number => t.length * TITLE_FS * 0.6;
  // From the canvas top to just above the key (the side margins are clear of the x title below the frame).
  const titleBottom = H - keyH - 6;
  const titleRoom = titleBottom - 4;
  const titleLines = (t: string, side: string): string[] => {
    if (!t) return [];
    if (!bw || titleLen(t) <= titleRoom) return [t];
    const words = t.split(" ");
    let best: string[] | null = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      if (titleLen(a) <= titleRoom && titleLen(b) <= titleRoom && (!best || Math.abs(a.length - b.length) < Math.abs(best[0].length - best[1].length))) best = [a, b];
    }
    if (!best) throw new Error(`the ${side} axis title “${t}” is too long to fit beside the plot in a USPTO drawing (its letters cannot be smaller than 37 CFR 1.84(p)(3) allows); shorten it`);
    return best;
  };
  const leftLines = titleLines(leftLabel, "left");
  const rightLines = titleLines(rightLabel, "right");
  if (leftLines.length > 1) ml += 13;
  if (rightLines.length > 1) mr += 13;
  const pw = W - ml - mr;
  const noteLines = layoutNotes(fig.notes, W);
  const outH = H + (noteLines.length ? noteLines.length * NOTE_LH + 4 : 0);
  const tx = (v: number): number => (logX ? Math.log10(v) : v);
  const sx = (v: number): number => ml + ((tx(v) - xd.lo) / (xd.hi - xd.lo)) * pw;
  const syL = (v: number): number => mt + ph - (((logL ? Math.log10(v) : v) - ld.lo) / (ld.hi - ld.lo)) * ph;
  const syR = (v: number): number => mt + ph - (((logR ? Math.log10(v) : v) - rd.lo) / (rd.hi - rd.lo)) * ph;

  const parts: string[] = [`<rect width="${W}" height="${outH}" fill="#ffffff"/>`];
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${RULE}" stroke-width="1"/>`);
  // Patent drawings carry no light grid (the tablechart / solid-form convention).
  if (!bw) for (const v of xAxis.minor) parts.push(`<line x1="${f1(sx(v))}" y1="${mt}" x2="${f1(sx(v))}" y2="${mt + ph}" stroke="#f5f5f5"/>`);
  for (const t of xAxis.ticks) {
    const px = sx(t.v);
    if (!bw) parts.push(`<line x1="${f1(px)}" y1="${mt}" x2="${f1(px)}" y2="${mt + ph}" stroke="#eeeeee"/>`);
    parts.push(`<line x1="${f1(px)}" y1="${mt + ph}" x2="${f1(px)}" y2="${mt + ph + 4}" stroke="${RULE}"/>`);
    parts.push(`<text x="${f1(px)}" y="${mt + ph + 16}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${INK}">${escapeXml(t.text)}</text>`);
  }
  // Gridlines follow the LEFT axis only: two sets of horizontal rules would
  // make neither readable.
  for (const t of lAxis.ticks) {
    const py = syL(t.v);
    if (!bw) parts.push(`<line x1="${ml}" y1="${f1(py)}" x2="${ml + pw}" y2="${f1(py)}" stroke="#eeeeee"/>`);
    parts.push(`<line x1="${ml - 4}" y1="${f1(py)}" x2="${ml}" y2="${f1(py)}" stroke="${sL.color}"/>`);
    parts.push(`<text x="${ml - 7}" y="${f1(py + 3)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${sL.color}">${escapeXml(t.text)}</text>`);
  }
  for (const t of rAxis.ticks) {
    const py = syR(t.v);
    parts.push(`<line x1="${ml + pw}" y1="${f1(py)}" x2="${ml + pw + 4}" y2="${f1(py)}" stroke="${sR.color}"/>`);
    parts.push(`<text x="${ml + pw + 7}" y="${f1(py + 3)}" font-family="${FONT}" font-size="10" fill="${sR.color}">${escapeXml(t.text)}</text>`);
  }
  // The two y axis lines, in their series' colours, over the frame.
  parts.push(`<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="${sL.color}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${ml + pw}" y1="${mt}" x2="${ml + pw}" y2="${mt + ph}" stroke="${sR.color}" stroke-width="1.5"/>`);

  const drawSeries = (pts: DualPoint[], st: SeriesStyle, sy: (v: number) => number): void => {
    // A missing value breaks the line (M), so no segment claims data that was not there.
    const d = pts.map((p, k) => `${k === 0 || p.gap ? "M" : "L"}${f1(sx(p.x))},${f1(sy(p.y))}`).join(" ");
    if (pts.length >= 2) parts.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="1.5"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`);
    if (pts.length <= 60) for (const p of pts) parts.push(seriesMarkerSvg(st, sx(p.x), sy(p.y), 2.6));
  };
  drawSeries(fig.left, sL, syL);
  drawSeries(fig.right, sR, syR);

  if (fig.title) {
    parts.push(`<text data-figure-title="1" x="${f1(W / 2)}" y="16" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="bold" fill="${bw ? "#000000" : "#222222"}">${escapeXml(fig.title)}</text>`);
  }
  if (xlabel) parts.push(`<text x="${f1(ml + pw / 2)}" y="${H - 8 - keyH}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${escapeXml(xlabel)}</text>`);
  const cy = mt + ph / 2;
  if (!bw) {
    if (leftLabel) parts.push(`<text x="14" y="${f1(cy)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${sL.color}" transform="rotate(-90 14 ${f1(cy)})">${escapeXml(leftLabel)}</text>`);
    if (rightLabel) parts.push(`<text x="${W - 14}" y="${f1(cy)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${sR.color}" transform="rotate(90 ${W - 14} ${f1(cy)})">${escapeXml(rightLabel)}</text>`);
  } else {
    // Centred on the frame, moved (not clipped) to keep the whole title between the canvas top and the key.
    const at = (t: string): number => Math.min(titleBottom - titleLen(t) / 2, Math.max(4 + titleLen(t) / 2, cy));
    leftLines.forEach((t, i) => {
      const x = 14 + i * 13;
      parts.push(`<text x="${x}" y="${f1(at(t))}" text-anchor="middle" font-family="${FONT}" font-size="${TITLE_FS}" fill="${sL.color}" transform="rotate(-90 ${x} ${f1(at(t))})">${escapeXml(t)}</text>`);
    });
    rightLines.forEach((t, i) => {
      const x = W - 14 - i * 13;
      parts.push(`<text x="${x}" y="${f1(at(t))}" text-anchor="middle" font-family="${FONT}" font-size="${TITLE_FS}" fill="${sR.color}" transform="rotate(90 ${x} ${f1(at(t))})">${escapeXml(t)}</text>`);
    });
  }

  // The key: which series reads against which axis.
  const keyItem = (x: number, ky: number, st: SeriesStyle, text: string, anchorEnd: boolean): void => {
    const w = 24 + text.length * 6;
    const x0 = anchorEnd ? x - w : x;
    parts.push(`<line x1="${f1(x0)}" y1="${ky - 3.5}" x2="${f1(x0 + 18)}" y2="${ky - 3.5}" stroke="${st.color}" stroke-width="1.5"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`);
    parts.push(seriesMarkerSvg(st, x0 + 9, ky - 3.5, 2.6));
    parts.push(`<text x="${f1(x0 + 22)}" y="${ky}" font-family="${FONT}" font-size="10" fill="${st.color}">${escapeXml(text)}</text>`);
  };
  const short = (s: string, room: number): string => (s.length > room ? s.slice(0, room - 1) + "…" : s);
  if (stacked) {
    keyItem(8, H - 22, sL, short(keyL, fullRoom), false);
    keyItem(8, H - 8, sR, short(keyR, fullRoom), false);
  } else {
    keyItem(8, H - 8, sL, keyL, false);
    keyItem(W - 8, H - 8, sR, keyR, true);
  }
  noteLines.forEach((line, i) => {
    parts.push(`<text x="8" y="${H + 11 + i * NOTE_LH}" font-family="${FONT}" font-size="${NOTE_SIZE}" fill="${bw ? "#000000" : "#555555"}">${escapeXml(line)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${outH}" viewBox="0 0 ${W} ${outH}">${parts.join("")}</svg>`;
}
