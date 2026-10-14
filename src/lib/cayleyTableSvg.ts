/**
 * cayleyTableSvg — a Cayley (operation) table as a grid of TEXT cells
 * (v2.134.0, SCOPE-ABSTRACT-ALGEBRA §C.5). The heat-map builder is numeric;
 * a table of permutations or field elements needs text, so this is its own
 * builder with one look:
 *
 *  - the header row and column in bold ink on the surface colour;
 *  - each body cell tinted by its ENTRY's index on SEQUENTIAL_BLUE (so equal
 *    entries share a colour and an abelian group's diagonal symmetry is
 *    visible), or — when `bands` is given — by the coset band of the entry;
 *  - text ink from `inkOn` (legible on every step of the ramp);
 *  - identity cells outlined; an optional `grey` element (0 in a field's ×
 *    table) drawn in grey;
 *  - cell width sized from the longest label; a table wider than the
 *    display width is scaled as a whole (the viewBox keeps the natural size,
 *    width/height attributes keep the SAME aspect), so nothing leaves the canvas.
 *
 * At most MAX_TABLE elements are drawn; the caller states the cap.
 */
import { SEQUENTIAL_BLUE, SEQUENTIAL_GREY, INK, inkOn, sampleRamp } from "./chartPalette";

export const MAX_TABLE = 20;
/** The widest the table is DISPLAYED (px) — the same bound as treeSvg. */
export const MAX_DISPLAY = 640;
/** Text is never drawn below this size: a wider table is refused by name instead. */
export const MIN_TEXT_PX = 9;

/** Thrown when the table cannot be drawn with legible text; callers keep the text table and say so. */
export class TableTooWideError extends Error {}

export interface CayleyTableOptions {
  caption?: string;
  /** Index of the identity: its cells are outlined. */
  identity?: number;
  /** Band id per element (e.g. its coset): cells tinted by the band of their entry. */
  bands?: number[];
  /** An element whose cells are drawn grey (0 in a multiplication table of a ring/field). */
  grey?: number;
  /** Operation symbol in the corner cell. */
  op?: string;
  /** Widest display width in px (default 460). */
  maxWidth?: number;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (x: number): string => (Math.round(x * 10) / 10).toString();
const CHAR = 7.2;
const CELL_H = 22;
const PAD = 12;

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w0 of text.split(/\s+/).filter(Boolean)) {
    let w = w0;
    while (w.length > max) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, max)); w = w.slice(max); }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= max) line += " " + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

/** labels: element names; table[i][j] = index of labels[i] ∘ labels[j]. */
export function cayleyTableSvg(labels: string[], table: number[][], opts: CayleyTableOptions = {}): string {
  const n = labels.length;
  if (n === 0 || n > MAX_TABLE) throw new Error(`cayleyTableSvg draws 1 to ${MAX_TABLE} elements (got ${n}).`);
  for (const row of table) if (row.length !== n) throw new Error("cayleyTableSvg: the table is not square.");
  const longest = Math.max(1, ...labels.map((l) => [...l].length), [...(opts.op ?? "·")].length);
  const cw = Math.max(24, Math.ceil(longest * CHAR + 12));
  const gridW = cw * (n + 1);
  const gridH = CELL_H * (n + 1);
  const VW = Math.max(gridW + 2 * PAD, 200);
  const capChars = Math.max(20, Math.floor((VW - 2 * PAD) / (11 * 0.6)));
  const capLines = opts.caption ? wrap(opts.caption, capChars) : [];
  const VH = PAD + gridH + (capLines.length ? 10 + capLines.length * 15 : 0) + PAD;
  const maxW = opts.maxWidth ?? MAX_DISPLAY;
  const scale = VW > maxW ? maxW / VW : 1;
  if (12 * scale < MIN_TEXT_PX) {
    throw new TableTooWideError(`The table's labels (up to ${longest} characters) would be drawn at ${(12 * scale).toFixed(1)} px — below the ${MIN_TEXT_PX} px legibility floor, so it is not drawn.`);
  }
  const dispW = Math.round(VW * scale * 100) / 100;
  const dispH = Math.round(VH * scale * 100) / 100;
  const x0 = (VW - gridW) / 2;
  const y0 = PAD;
  const bandCount = opts.bands ? Math.max(...opts.bands) + 1 : 0;
  const fillOf = (entry: number): string => {
    if (opts.grey !== undefined && entry === opts.grey) return SEQUENTIAL_GREY[1];
    if (opts.bands) return sampleRamp(SEQUENTIAL_BLUE, bandCount <= 1 ? 0.2 : (opts.bands[entry] / (bandCount - 1)) * 0.85);
    return sampleRamp(SEQUENTIAL_BLUE, n <= 1 ? 0.2 : (entry / (n - 1)) * 0.85);
  };
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${dispW}" height="${dispH}" viewBox="0 0 ${r1(VW)} ${r1(VH)}" font-family="Segoe UI, Arial, sans-serif" font-size="12">`);
  parts.push(`<rect width="${r1(VW)}" height="${r1(VH)}" fill="#fff"/>`);
  const text = (x: number, y: number, s: string, fill: string, bold = false): void => {
    parts.push(`<text x="${r1(x)}" y="${r1(y + 4)}" text-anchor="middle"${bold ? ' font-weight="bold"' : ""} fill="${fill}">${esc(s)}</text>`);
  };
  // Corner and headers.
  parts.push(`<rect x="${r1(x0)}" y="${r1(y0)}" width="${cw}" height="${CELL_H}" fill="${INK.surface}" stroke="${INK.baseline}"/>`);
  text(x0 + cw / 2, y0 + CELL_H / 2, opts.op ?? "·", INK.secondary, true);
  for (let j = 0; j < n; j++) {
    const x = x0 + cw * (j + 1);
    parts.push(`<rect x="${r1(x)}" y="${r1(y0)}" width="${cw}" height="${CELL_H}" fill="${INK.surface}" stroke="${INK.baseline}"/>`);
    text(x + cw / 2, y0 + CELL_H / 2, labels[j], INK.primary, true);
  }
  for (let i = 0; i < n; i++) {
    const y = y0 + CELL_H * (i + 1);
    parts.push(`<rect x="${r1(x0)}" y="${r1(y)}" width="${cw}" height="${CELL_H}" fill="${INK.surface}" stroke="${INK.baseline}"/>`);
    text(x0 + cw / 2, y + CELL_H / 2, labels[i], INK.primary, true);
    for (let j = 0; j < n; j++) {
      const x = x0 + cw * (j + 1);
      const entry = table[i][j];
      const fill = fillOf(entry);
      parts.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${cw}" height="${CELL_H}" fill="${fill}" stroke="#ffffff"/>`);
      text(x + cw / 2, y + CELL_H / 2, labels[entry], inkOn(fill));
    }
  }
  // Identity cells outlined (after the fills so the outline is on top).
  if (opts.identity !== undefined) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (table[i][j] !== opts.identity) continue;
      parts.push(`<rect x="${r1(x0 + cw * (j + 1) + 1.5)}" y="${r1(y0 + CELL_H * (i + 1) + 1.5)}" width="${cw - 3}" height="${CELL_H - 3}" fill="none" stroke="${INK.primary}" stroke-width="1.5"/>`);
    }
  }
  let cy = y0 + gridH + 10;
  for (const line of capLines) {
    cy += 15;
    parts.push(`<text x="${PAD}" y="${r1(cy - 3)}" font-size="11" fill="${INK.secondary}">${esc(line)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
