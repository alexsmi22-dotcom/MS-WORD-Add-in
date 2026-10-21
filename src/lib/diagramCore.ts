// Shared drawing for the Diagrams tool (docs/SCOPE-DIAGRAMS.md): USPTO line figures (37 CFR 1.84) — black lines on
// white, lettering at least 1/8 in high, reference numerals with lead lines, "FIG. n" labels. Coordinates are points;
// the SVG is sized in px (96/72 per pt) so the pane's PNG insert keeps the lettering at its height.
//
// Pure: no Office.js, no DOM.

import { textWidthPt } from "./arialMetrics";
import { USPTO_REQUIRED_FONT_PT } from "./figureStyle";

/** Lettering: the USPTO style's own size (cap height ≥ 3.2 mm with its 10 % margin). */
export const FONT_PT = Math.ceil(USPTO_REQUIRED_FONT_PT);
export const LINE_PT = 1.1;
export const FONT_FAMILY = "Arial, Helvetica, sans-serif";
/** The sheet's usable width (21.6 cm less 2.5 + 1.5 cm margins = 17.0 cm … 1.84(g)), in points. */
export const SHEET_WIDTH_PT = (170 / 25.4) * 72;
export const LINE_HEIGHT = FONT_PT * 1.25;
/** The sheet's usable height (27.9 cm less 2.5 + 1.0 cm margins = 24.4 cm), in points. */
export const SHEET_HEIGHT_PT = (244 / 25.4) * 72;

export type NumeralStyle = "inside" | "lead";

export interface DiagramOptions {
  /** "FIG. n" under the figure; omitted when null. */
  fig?: string | null;
  numerals?: NumeralStyle;
  /** The figure's own numeral (100), drawn with an arrow pointing at the figure. */
  figureNumeral?: string | null;
}

/** Beyond this many sheets in either direction a figure is refused, not noted: it cannot be inserted legibly. */
export const MAX_SHEETS = 3;

export type DiagramResult =
  | { ok: true; svg: string; widthPt: number; heightPt: number; notes: string[]; numerals: string[] }
  | { ok: false; errors: string[]; notes: string[] };

export const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const f = (v: number): string => String(Math.round(v * 100) / 100);

// Full-width scripts (CJK ideographs, kana, hangul, full-width forms) set at 1 em each; Arial's metrics do not cover
// them and would size their boxes too narrow.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/gu;
export const textW = (t: string, size = FONT_PT): number => {
  const wide = t.match(WIDE)?.length ?? 0;
  return (wide ? textWidthPt(t.replace(WIDE, ""), size) : textWidthPt(t, size)) + wide * size;
};

/** Words wrapped to lines no wider than maxW (a word longer than maxW keeps its own line). */
export function wrap(text: string, maxW: number, size = FONT_PT): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && textW(cand, size) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export function text(x: number, y: number, t: string, opts: { anchor?: "start" | "middle" | "end"; size?: number; underline?: boolean; italic?: boolean; bold?: boolean; halo?: boolean } = {}): string {
  const a = opts.anchor ?? "middle";
  // A halo (a white outline painted under the glyphs) keeps a label legible where a line runs behind it.
  const extra = `${opts.underline ? ' text-decoration="underline"' : ""}${opts.italic ? ' font-style="italic"' : ""}${opts.bold ? ' font-weight="bold"' : ""}${opts.halo ? ' stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"' : ""}`;
  return `<text x="${f(x)}" y="${f(y)}" text-anchor="${a}" font-family="${FONT_FAMILY}" font-size="${f(opts.size ?? FONT_PT)}"${extra} fill="#000">${esc(t)}</text>`;
}

export const line = (x1: number, y1: number, x2: number, y2: number, dash = false): string =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#000" stroke-width="${LINE_PT}"${dash ? ' stroke-dasharray="6 4"' : ""}/>`;

export const polyline = (pts: Array<[number, number]>, dash = false): string =>
  `<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="none" stroke="#000" stroke-width="${LINE_PT}" stroke-linejoin="miter"${dash ? ' stroke-dasharray="6 4"' : ""}/>`;

/** A solid arrowhead at (x, y) pointing along (dx, dy). */
export function arrowhead(x: number, y: number, dx: number, dy: number, size = 8): string {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  const bx = x - ux * size, by = y - uy * size;
  const px = -uy * size * 0.45, py = ux * size * 0.45;
  return `<polygon points="${f(x)},${f(y)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}" fill="#000"/>`;
}

/**
 * A reference numeral with its lead line: the numeral at (nx, ny), a gentle S-curve to the point it names (tx, ty) —
 * the drafting convention (1.84(q)): lead lines are as short as possible, never crossing each other where avoidable.
 */
export function leadLine(nx: number, ny: number, tx: number, ty: number, numeral: string): string {
  const w = textW(numeral);
  const left = tx < nx;
  const sx = left ? nx - w / 2 - 3 : nx + w / 2 + 3;
  const sy = ny - FONT_PT * 0.35;
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const bend = 0.18 * Math.hypot(tx - sx, ty - sy);
  const nxv = -(ty - sy), nyv = tx - sx;
  const nl = Math.hypot(nxv, nyv) || 1;
  const c1x = (sx + mx) / 2 + (nxv / nl) * bend, c1y = (sy + my) / 2 + (nyv / nl) * bend;
  const c2x = (mx + tx) / 2 - (nxv / nl) * bend, c2y = (my + ty) / 2 - (nyv / nl) * bend;
  return (
    `<path d="M${f(sx)} ${f(sy)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(tx)} ${f(ty)}" fill="none" stroke="#000" stroke-width="${LINE_PT * 0.9}"/>` +
    text(nx, ny, numeral)
  );
}

/** The figure's numeral (100) with a curved arrow toward the figure's top-left corner. */
export function figureNumeralMark(x: number, y: number, numeral: string): { svg: string; w: number; h: number } {
  const w = textW(numeral);
  const svg =
    text(x + w / 2, y + FONT_PT, numeral) +
    `<path d="M${f(x + w + 4)} ${f(y + FONT_PT * 0.6)} C${f(x + w + 28)} ${f(y + FONT_PT * 0.3)} ${f(x + w + 42)} ${f(y + FONT_PT * 1.2)} ${f(x + w + 48)} ${f(y + FONT_PT * 2.1)}" fill="none" stroke="#000" stroke-width="${LINE_PT}"/>` +
    arrowhead(x + w + 48, y + FONT_PT * 2.1, 0.4, 1);
  return { svg, w: w + 52, h: FONT_PT * 2.4 };
}

/**
 * Wraps a drawing (content in its own coordinates, box [0, 0, w, h]) with margins, the figure numeral above it and
 * "FIG. n" under it, into one SVG sized in px. Notes when the figure is wider than the sheet.
 */
export function finishFigure(content: string, w: number, h: number, opts: DiagramOptions, notes: string[]): { svg: string; widthPt: number; heightPt: number } {
  const pad = 10;
  let top = pad;
  let head = "";
  if (opts.figureNumeral) {
    const m = figureNumeralMark(pad, pad, opts.figureNumeral);
    head = m.svg;
    top += m.h;
  }
  const figH = opts.fig ? FONT_PT * 2.6 : 0;
  const W = Math.max(w + 2 * pad, opts.fig ? textW(`FIG. ${opts.fig}`, FONT_PT * 1.6) + 2 * pad : 0);
  const H = top + h + pad + figH;
  const figLabel = opts.fig ? text(W / 2, top + h + pad + FONT_PT * 1.9, `FIG. ${opts.fig}`, { size: FONT_PT * 1.6, bold: true, italic: true }) : "";
  if (W > SHEET_WIDTH_PT + 0.5) {
    notes.push(`The figure is ${(W / 72 * 2.54).toFixed(1)} cm wide; the sheet allows 17.0 cm at 1/8 in lettering — split it into two figures, or shorten the labels.`);
  }
  if (H > SHEET_HEIGHT_PT + 0.5) {
    notes.push(`The figure is ${(H / 72 * 2.54).toFixed(1)} cm tall; the sheet allows 24.4 cm — split it across two figures (FIG. 4A, 4B).`);
  }
  const px = (v: number): string => f((v * 96) / 72);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px(W)}" height="${px(H)}" viewBox="0 0 ${f(W)} ${f(H)}">` +
    `<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="#fff"/>${head}<g transform="translate(${f((W - w) / 2)}, ${f(top)})">${content}</g>${figLabel}</svg>`;
  return { svg, widthPt: W, heightPt: H };
}

/** A reference numeral: digits, optionally a letter suffix (104, 104a, 1040). */
export const NUMERAL = /^\d{1,5}[a-z]?['′]?$/;
