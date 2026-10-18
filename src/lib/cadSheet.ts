/**
 * A drawing sheet from the CAD model (docs/SCOPE-CAD-CANVAS.md §D): several
 * views at ONE scale, arranged as the chosen standard's projection requires,
 * labelled, with part callouts — as a single SVG.
 *
 * ARRANGEMENT. Orthographic views must line up: the top view shares the front
 * view's width, the side views share its height. Third-angle (ASME Y14.3) puts
 * the top view ABOVE the front and the right side to its RIGHT; first-angle
 * (ISO 5456-2) puts the top view BELOW and the view from the right on the
 * LEFT. A pictorial view (isometric, or the user's orbit) takes the free
 * corner. Because every orthographic view here shares the world axes, aligning
 * the cells aligns the views.
 *
 * CALLOUTS are anchored to 3D surface points (picked on the canvas), so each
 * view shows a part's callout only where that point is visible, and moves it
 * with the view.
 *
 * SHEET FORMATS (R2b). With a format (ISO 5457 / ANSI) the views are laid out in
 * the frame's view area, clear of the title block; the scale and the projection
 * symbol go beside the block (ISO 7200: outside it), or in its SCALE field for
 * ASME. Every stroke names a line type (cadLineTypes) and every element sits in
 * a named LAYER group; a layer switched off is left out of the SVG entirely, so
 * what inserts is what shows.
 */
import type { Mesh, Vec3 } from "./cadModel";
import { baryIn, drawLines, LineDrawing, STANDARD_VIEWS, viewFromDegrees, CadView, Polyline } from "./cadLines";
import { DRAWING_STANDARDS, DrawingStandard, StandardId, STANDARD_SCALES, snapScale, scaleLabel } from "./cadStandards";
import { ptToMm } from "./figureStyle";
import { buildFrame, Frame, Orientation, SheetSizeId, sheetRefusal, TitleValues } from "./cadFormats";
import { LineType, lineTypesFor, strokeAttrs } from "./cadLineTypes";

/** The sheet's layers. The user may switch off frame, titleBlock, callouts and titles. */
export type LayerId = "visible" | "hidden" | "callouts" | "titles" | "frame" | "titleBlock" | "info";
export const SWITCHABLE_LAYERS: Array<{ id: LayerId; name: string }> = [
  { id: "frame", name: "Frame and grid" },
  { id: "titleBlock", name: "Title block" },
  { id: "callouts", name: "Callouts" },
  { id: "titles", name: "View titles" },
];

export interface SheetFormat {
  size: SheetSizeId;
  orientation?: Orientation;
  title?: TitleValues;
}

export type OrthoKind = "front" | "top" | "right" | "left" | "back" | "bottom";
/** An orbit view carries either Euler degrees or the exact matrix the user dragged to. */
export type ViewSpec = { kind: OrthoKind | "iso" } | { kind: "orbit"; deg?: Vec3; rot?: number[]; name?: string };

export interface Callout {
  /** A world point ON the part (from pickAt). */
  anchor: Vec3;
  /** What the callout says: a reference numeral, a balloon number, a part letter. */
  label: string;
}

export interface SheetOptions {
  standard: StandardId;
  views: ViewSpec[];
  callouts?: Callout[];
  /** The first FIG number (for "fig" labels). */
  figStart?: number;
  /** Override the standard's hidden-line rule for every view. */
  showHidden?: boolean;
  /** A framed sheet (ISO / ASME); none = the drawing area alone, as before R2b. */
  format?: SheetFormat;
  /** Layers switched off (false). */
  layers?: Partial<Record<LayerId, boolean>>;
}

export interface Sheet {
  svg: string;
  widthPx: number;
  heightPx: number;
  /** The label of each view, in the order given ("FIG. 1", "FRONT", …). */
  labels: string[];
  /** Model units → mm on the sheet. */
  scaleMmPerUnit: number;
  /** Plain-language notes the pane shows (a callout hidden in every view, …). */
  notes: string[];
  /** The sheet in mm (the trimmed sheet when framed), and its size designation. */
  widthMm?: number;
  heightMm?: number;
  sizeName?: string;
}

const PX_PER_MM = 96 / 25.4;
const ORTHO = new Set(["front", "top", "right", "left", "back", "bottom"]);

/** Grid cell (col, row) of each orthographic view, per projection; the pictorial view takes "pic". */
const CELLS: Record<"third" | "first", Record<OrthoKind | "pic", [number, number]>> = {
  // Third angle: as if unfolded from a glass box toward the viewer.
  third: { top: [1, 0], left: [0, 1], front: [1, 1], right: [2, 1], back: [3, 1], bottom: [1, 2], pic: [2, 0] },
  // First angle: each view on the far side of the front from where it is seen.
  first: { bottom: [1, 0], right: [0, 1], front: [1, 1], left: [2, 1], back: [3, 1], top: [1, 2], pic: [2, 2] },
};

function viewOf(v: ViewSpec): CadView {
  if (v.kind === "orbit") {
    if (v.rot && v.rot.length === 9 && v.rot.every((x) => Number.isFinite(x))) return { name: v.name ?? "view", rot: v.rot };
    return viewFromDegrees(v.deg ?? [0, 0, 0], v.name ?? "view");
  }
  return STANDARD_VIEWS[v.kind];
}

function viewName(v: ViewSpec): string {
  switch (v.kind) {
    case "front": return "FRONT";
    case "top": return "TOP";
    case "right": return "RIGHT SIDE";
    case "left": return "LEFT SIDE";
    case "back": return "REAR";
    case "bottom": return "BOTTOM";
    case "iso": return "ISOMETRIC";
    default: return (v.name ?? "VIEW").toUpperCase();
  }
}

/** Is world point p hidden behind the mesh in this view? (A point ON a surface is not hidden by that surface.) */
export function pointHidden(mesh: Mesh, view: CadView, p: Vec3): boolean {
  const R = view.rot;
  const P = mesh.positions;
  const T = mesh.triangles;
  const x = R[0] * p[0] + R[1] * p[1] + R[2] * p[2];
  const y = R[3] * p[0] + R[4] * p[1] + R[5] * p[2];
  const z = R[6] * p[0] + R[7] * p[1] + R[8] * p[2];
  const eps = mesh.diag * 1e-6;
  for (let t = 0; t < T.length; t += 3) {
    const c: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = 3 * T[t + k];
      c.push(R[0] * P[i] + R[1] * P[i + 1] + R[2] * P[i + 2], R[3] * P[i] + R[4] * P[i + 1] + R[5] * P[i + 2], R[6] * P[i] + R[7] * P[i + 1] + R[8] * P[i + 2]);
    }
    // Inclusive, as the line engine: an anchor exactly behind a face's edge is hidden (review D5).
    const l = baryIn(c[0], c[1], c[3], c[4], c[6], c[7], x, y, mesh.diag * mesh.diag * 1e-14);
    if (!l) continue;
    if (l[0] * c[2] + l[1] * c[5] + l[2] * c[8] > z + eps) return true;
  }
  return false;
}

/** Lays out the sheet. */
export function layoutSheet(mesh: Mesh, o: SheetOptions): Sheet {
  const std: DrawingStandard = DRAWING_STANDARDS[o.standard];
  // A layer switched off takes no room on the sheet: hidden callouts are not laid out at all.
  const callouts = o.layers?.callouts === false ? [] : (o.callouts ?? []);
  const notes: string[] = [];
  if (!o.views.length) return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: ["Choose at least one view."] };
  const types = lineTypesFor(std);
  const on = (id: LayerId): boolean => o.layers?.[id] !== false;
  let frame: Frame | null = null;
  if (o.format) {
    const why = sheetRefusal(o.standard, o.format.size, o.format.orientation);
    if (why) return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: [why[0].toUpperCase() + why.slice(1) + "."] };
    const fr = buildFrame(o.standard as "iso" | "asme", o.format.size, o.format.orientation, o.format.title ?? {}, null);
    if (!fr.ok) return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: [fr.reason[0].toUpperCase() + fr.reason.slice(1) + "."] };
    frame = fr.frame;
  }
  // Where the views go (mm): the frame's view area, or the standard's drawing area from the origin.
  const area = frame ? frame.viewArea : { x: 0, y: 0, w: std.areaMm.w, h: std.areaMm.h };

  // Each view's drawing, and its cell.
  const cellsFor = CELLS[std.projection];
  const used = new Set<string>();
  const items = o.views.map((spec) => {
    const view = viewOf(spec);
    const d = drawLines(mesh, view);
    let cell: [number, number];
    if (ORTHO.has(spec.kind)) cell = cellsFor[spec.kind as OrthoKind];
    else cell = cellsFor.pic;
    // A second pictorial view (or a repeat) goes to the next free cell along the top row.
    let key = cell.join(",");
    while (used.has(key)) {
      cell = [cell[0] + 1, cell[1]];
      key = cell.join(",");
    }
    used.add(key);
    return { spec, view, d, cell, pictorial: !ORTHO.has(spec.kind) };
  });

  // Compact the grid: only columns / rows that hold a view.
  const cols = [...new Set(items.map((i) => i.cell[0]))].sort((a, b) => a - b);
  const rows = [...new Set(items.map((i) => i.cell[1]))].sort((a, b) => a - b);
  const colW = cols.map((c) => Math.max(...items.filter((i) => i.cell[0] === c).map((i) => i.d.bounds.maxX - i.d.bounds.minX)));
  const rowH = rows.map((r) => Math.max(...items.filter((i) => i.cell[1] === r).map((i) => i.d.bounds.maxY - i.d.bounds.minY)));

  // FIG numbers follow the sheet's reading order (top row first, left to
  // right), not the order the views were asked for.
  const readingOrder = [...items].sort((p, q) => p.cell[1] - q.cell[1] || p.cell[0] - q.cell[0]);
  const figOf = new Map(readingOrder.map((it, i) => [it, (o.figStart ?? 1) + i]));
  const labelOf = (it: (typeof items)[number]): string =>
    std.viewLabels === "fig" ? `FIG. ${figOf.get(it)}` : std.viewLabels === "name" ? viewName(it.spec) : "";

  const textMm = ptToMm(std.textPt);
  const headingMm = ptToMm(std.headingPt);
  const titlesOn = o.layers?.titles !== false;
  const labelMm = std.viewLabels === "none" || !titlesOn ? 0 : headingMm * 2.2;
  // A callout column beside a view: 5 mm of leader, then the balloon (or the
  // numeral). Two views share every gap, so it holds two columns.
  const balloonMm = Math.max(textMm * 0.95, 4);
  const calloutMm = callouts.length ? 5 + (std.callouts === "balloon" ? 2 * balloonMm : textMm * 1.6) + 1 : 0;
  const pitchMm = std.callouts === "balloon" ? 2 * balloonMm + 1.5 : textMm * 1.5;

  // Which callouts each view shows, and on which side: decided before the scale,
  // because a stack of balloons needs height of its own (review D3).
  const shown = items.map((it) => {
    const R = it.view.rot;
    const mid = (it.d.bounds.minX + it.d.bounds.maxX) / 2;
    const out: Array<{ n: number; x: number; y: number; right: boolean }> = [];
    callouts.forEach((c, n) => {
      if (pointHidden(mesh, it.view, c.anchor)) return;
      const x = R[0] * c.anchor[0] + R[1] * c.anchor[1] + R[2] * c.anchor[2];
      const y = R[3] * c.anchor[0] + R[4] * c.anchor[1] + R[5] * c.anchor[2];
      out.push({ n, x, y, right: x >= mid });
    });
    return out;
  });
  // A balloon identifies its item ONCE on a sheet (the drafting convention): in the
  // first view that shows its point — the pictorial, else front, top, right, then
  // the rest. Repeating every balloon in every view also made the stacks too tall
  // to fit any sheet (second review). Patent numerals stay in every figure: each
  // figure is read on its own.
  if (std.callouts === "balloon") {
    const rank = (it: (typeof items)[number]): number =>
      it.pictorial ? 0 : (["front", "top", "right", "left", "back", "bottom"] as string[]).indexOf(it.spec.kind) + 1;
    const order = items.map((_, i) => i).sort((p, q) => rank(items[p]) - rank(items[q]) || p - q);
    const placed = new Set<number>();
    for (const i of order) {
      shown[i] = shown[i].filter((c) => !placed.has(c.n));
      for (const c of shown[i]) placed.add(c.n);
    }
  }
  // Each row holds its tallest callout stack; each column its widest title (review D4:
  // a title wider than a narrow part ran into its neighbour). Upper-case sans ≈ 0.62 em.
  const needOf = (): number[] =>
    rows.map((r) =>
      Math.max(0, ...items.flatMap((it, i) => (it.cell[1] !== r ? [] : [true, false].map((side) => shown[i].filter((c) => c.right === side).length * pitchMm)))),
    );
  let needMm = needOf();
  const titleMm = cols.map((c) => (titlesOn ? Math.max(0, ...items.filter((it) => it.cell[0] === c).map((it) => labelOf(it).length * 0.62 * headingMm)) : 0));

  // Horizontal room: every gap between two views holds two callout columns,
  // an outer edge holds one. Vertical room needs only the view title.
  const gapMm = 10 + 2 * calloutMm;
  const edgeMm = 6 + calloutMm;
  const rowGapMm = 8;
  // A framed sheet's room is tighter: there, a column of callouts is reserved only on a side of a
  // view that has callouts (review D4 — one callout made A4 refuse). Unframed sheets keep the
  // uniform reservation they have always had (their output is pinned).
  const sideHas = (ci: number, right: boolean): boolean => items.some((it, i) => cols.indexOf(it.cell[0]) === ci && shown[i].some((c) => c.right === right));
  const gapsMm = (): number[] => cols.slice(1).map((_, ci) => (frame ? 10 + (sideHas(ci, true) ? calloutMm : 0) + (sideHas(ci + 1, false) ? calloutMm : 0) : gapMm));
  const edgesMm = (): [number, number] => (frame ? [6 + (sideHas(0, false) ? calloutMm : 0), 6 + (sideHas(cols.length - 1, true) ? calloutMm : 0)] : [edgeMm, edgeMm]);
  const horizMm = (): number => (frame ? edgesMm()[0] + edgesMm()[1] + gapsMm().reduce((a, b) => a + b, 0) : 2 * edgeMm + gapMm * (cols.length - 1));
  let availW = area.w - horizMm();
  const availH = area.h - (rowGapMm + labelMm) * rows.length - rowGapMm;
  // One scale for every view, so the orthographic views stay true to each other:
  // the largest at which the drawings, their titles and their callout stacks all fit.
  const colMm = (sc: number): number[] => colW.map((w, i) => Math.max(w * sc, titleMm[i]));
  const rowMm = (sc: number): number[] => rowH.map((h, i) => Math.max(h * sc, needMm[i]));
  const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
  const refuse = (why: string): Sheet => ({ svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: [why] });
  // Titles and callout stacks do not shrink with the drawing: if they alone do not
  // fit, no scale does — refuse rather than shrink the views to dots (second review).
  if (availW <= 0 || availH <= 0 || sum(titleMm) > availW) {
    // Name what does not fit: the titles, or the room the callout columns take.
    const withoutCallouts = area.w - (12 + 10 * (cols.length - 1));
    return refuse(
      calloutMm && sum(titleMm) <= withoutCallouts && availH > 0
        ? "These views and their callout columns do not fit on the sheet; choose a larger sheet, fewer views or fewer callouts."
        : "These views do not fit on the sheet with their titles; choose fewer views.",
    );
  }
  if (sum(needMm) > availH) {
    // Too tall as anchored: use both sides of each view, the nearer half to each.
    for (const v of shown) {
      const byX = [...v].sort((p, q) => p.x - q.x);
      byX.forEach((c, i) => (c.right = i >= byX.length / 2));
    }
    needMm = needOf();
    if (frame) availW = area.w - horizMm(); // the sides changed, and with them the room they take
  }
  if (sum(needMm) > availH) {
    const most = Math.max(...shown.flatMap((v) => [true, false].map((side) => v.filter((c) => c.right === side).length)));
    return refuse(`${most} callouts beside one view do not fit on the sheet; use fewer callouts or fewer views.`);
  }
  const fits = (sc: number): boolean => sum(colMm(sc)) <= availW * (1 + 1e-9) && sum(rowMm(sc)) <= availH * (1 + 1e-9);
  // The largest scale that fits, by bisection (the fit is monotone in the scale).
  let lo = 0;
  let hi = Math.min(availW / (sum(colW) || 1), availH / (sum(rowH) || 1)); // drawings alone: an upper bound
  if (fits(hi)) lo = hi;
  else for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const fitS = lo; // mm per model unit
  if (std.standardScale && fitS < STANDARD_SCALES[STANDARD_SCALES.length - 1]) {
    return refuse(`The drawing does not fit the sheet at any standard scale (the smallest is ${scaleLabel(STANDARD_SCALES[STANDARD_SCALES.length - 1])}).`);
  }
  const s = std.standardScale ? snapScale(fitS) : fitS;
  const cwMm = colMm(s), chMm = rowMm(s);

  const W = (frame ? frame.W : area.w) * PX_PER_MM;
  const totalH = sum(chMm) + (rowGapMm + labelMm) * rows.length + rowGapMm;
  const H = (frame ? frame.H : Math.min(area.h, totalH)) * PX_PER_MM;
  const usedW = sum(cwMm) + horizMm();
  const x0 = (area.x + Math.max(0, (area.w - usedW) / 2)) * PX_PER_MM;
  const y0 = area.y * PX_PER_MM;

  const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
  const strokeV = types.visible.widthMm * PX_PER_MM;
  const strokeH = types.hidden.widthMm * PX_PER_MM;
  const fontPx = textMm * PX_PER_MM;
  const headingPx = headingMm * PX_PER_MM;
  // Each layer collects its own elements; the SVG puts them in a named group, in drawing order.
  const layer: Record<LayerId, string[]> = { frame: [], titleBlock: [], hidden: [], visible: [], callouts: [], titles: [], info: [] };
  let parts: string[] = layer.visible;
  const labels: string[] = [];
  const calloutSeen = new Array(callouts.length).fill(false);
  const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  for (const [idx, it] of items.entries()) {
    const ci = cols.indexOf(it.cell[0]);
    const ri = rows.indexOf(it.cell[1]);
    // Cell origin (top-left), px.
    const cellX = x0 + (frame ? edgesMm()[0] + sum(gapsMm().slice(0, ci)) + sum(cwMm.slice(0, ci)) : edgeMm + gapMm * ci + sum(cwMm.slice(0, ci))) * PX_PER_MM;
    const cellY = y0 + ((rowGapMm + labelMm) * ri + rowGapMm + sum(chMm.slice(0, ri))) * PX_PER_MM;
    const b = it.d.bounds;
    const vw = (b.maxX - b.minX) * s * PX_PER_MM;
    const vh = (b.maxY - b.minY) * s * PX_PER_MM;
    const cw = cwMm[ci] * PX_PER_MM;
    const chh = chMm[ri] * PX_PER_MM;
    // Orthographic views align on the shared axes (left edge for a column, bottom
    // edge for a row); a pictorial view is centred in its cell.
    const ox = it.pictorial ? cellX + (cw - vw) / 2 : cellX;
    const oyBottom = it.pictorial ? cellY + (chh + vh) / 2 : cellY + chh;
    const k = s * PX_PER_MM;
    const X = (x: number): number => ox + (x - b.minX) * k;
    const Y = (y: number): number => oyBottom - (y - b.minY) * k;
    const path = (lines: Polyline[]): string => lines.map((l) => "M" + l.map(([x, y]) => `${fmt(X(x))} ${fmt(Y(y))}`).join("L")).join("");

    const showHidden = o.showHidden ?? (it.pictorial ? std.hiddenInPictorial : std.hiddenInOrthographic);
    if (showHidden && it.d.hidden.length) layer.hidden.push(`<path d="${path(it.d.hidden)}" ${strokeAttrs(types.hidden, PX_PER_MM)}/>`);
    if (it.d.visible.length) layer.visible.push(`<path d="${path(it.d.visible)}" ${strokeAttrs(types.visible, PX_PER_MM)}/>`);
    parts = layer.callouts;

    // Callouts visible in this view, set in a COLUMN beside the view on the
    // nearer side, each at its part's height and pushed apart so none overlap
    // (the usual drafting arrangement). Placing them radially put the lower
    // ones on top of the view's own label.
    const r = balloonMm * PX_PER_MM; // balloon radius
    const pitch = pitchMm * PX_PER_MM;
    const side = shown[idx].map((c) => {
      calloutSeen[c.n] = true;
      return { n: c.n, ax: X(c.x), ay: Y(c.y), right: c.right, ly: Y(c.y) };
    });
    // Each column stays inside its view's own band of the sheet — never above the
    // sheet, into the row above, or down into the view titles (review D3). The row
    // was made tall enough for the stack, so it always fits.
    const top = cellY + pitch / 2, bottom = cellY + chh - pitch / 2;
    for (const right of [true, false]) {
      const col = side.filter((s2) => s2.right === right).sort((p, q) => p.ay - q.ay);
      if (!col.length) continue;
      // Push down to keep the pitch, pull the column back up if it ran past the band, then hold its top.
      col[0].ly = Math.max(col[0].ly, top);
      for (let i = 1; i < col.length; i++) col[i].ly = Math.max(col[i].ly, col[i - 1].ly + pitch);
      const overflow = col[col.length - 1].ly - bottom;
      if (overflow > 0) for (const s2 of col) s2.ly -= overflow;
      for (let i = col.length - 2; i >= 0; i--) col[i].ly = Math.min(col[i].ly, col[i + 1].ly - pitch);
      const under = top - col[0].ly;
      if (under > 0) for (const s2 of col) s2.ly += under;
    }
    for (const sc of side) {
      const c = callouts[sc.n];
      const ax = sc.ax, ay = sc.ay, ly = sc.ly;
      const offset = 5 * PX_PER_MM + (std.callouts === "balloon" ? r : fontPx * 0.6);
      const lx = sc.right ? ox + vw + offset : ox - offset;
      let dx = lx - ax, dy = ly - ay;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      if (std.callouts === "balloon") {
        const ex = lx - dx * r, ey = ly - dy * r;
        parts.push(`<path d="M${fmt(ax)} ${fmt(ay)}L${fmt(ex)} ${fmt(ey)}" fill="none" stroke="#000" stroke-width="${fmt(strokeH)}"/>`);
        parts.push(`<circle cx="${fmt(ax)}" cy="${fmt(ay)}" r="${fmt(strokeV * 1.2)}" fill="#000"/>`);
        parts.push(`<circle cx="${fmt(lx)}" cy="${fmt(ly)}" r="${fmt(r)}" fill="#fff" stroke="#000" stroke-width="${fmt(strokeH)}"/>`);
        parts.push(`<text x="${fmt(lx)}" y="${fmt(ly)}" dy="0.35em" text-anchor="middle" font-family="${esc(std.font)}" font-size="${fmt(fontPx)}" fill="#000">${esc(c.label)}</text>`);
      } else {
        // A lead line from the part to just short of the numeral (1.84(q)).
        const ex = lx - dx * fontPx * 0.9, ey = ly - dy * fontPx * 0.9;
        parts.push(`<path d="M${fmt(ax)} ${fmt(ay)}L${fmt(ex)} ${fmt(ey)}" fill="none" stroke="#000" stroke-width="${fmt(strokeH)}"/>`);
        parts.push(`<text x="${fmt(lx)}" y="${fmt(ly)}" dy="0.35em" text-anchor="middle" font-family="${esc(std.font)}" font-size="${fmt(fontPx)}" fill="#000">${esc(c.label)}</text>`);
      }
    }

    const label = labelOf(it);
    labels.push(label);
    parts = layer.titles;
    if (label) {
      const ly = cellY + chh + labelMm * 0.75 * PX_PER_MM;
      // Centred under the view, but kept inside its own column (sized to hold it).
      const half = (titleMm[ci] / 2) * PX_PER_MM;
      const tx = Math.max(cellX + half, Math.min(cellX + cw - half, ox + vw / 2));
      parts.push(`<text x="${fmt(tx)}" y="${fmt(ly)}" text-anchor="middle" font-family="${esc(std.font)}" font-size="${fmt(headingPx)}" fill="#000">${esc(label)}</text>`);
    }
  }

  callouts.forEach((c, n) => {
    if (!calloutSeen[n]) notes.push(`Callout ${c.label} is hidden in every view on this sheet, so it is not drawn.`);
  });

  if (frame) {
    // The frame again, now with the scale (ASME prints it in the title block's SCALE field).
    const fr = buildFrame(o.standard as "iso" | "asme", o.format!.size, o.format!.orientation, o.format!.title ?? {}, std.standardScale ? scaleLabel(s) : null);
    if (!fr.ok) return refuse(fr.reason[0].toUpperCase() + fr.reason.slice(1) + ".");
    frame = fr.frame;
    const lt = (t: string): LineType => types[t as keyof typeof types];
    // Lines of one type in one path, by layer (tb* = title block).
    const byType = new Map<string, string[]>();
    for (const l of frame.lines) (byType.get(l.type) ?? byType.set(l.type, []).get(l.type)!).push(`M${fmt(l.x1 * PX_PER_MM)} ${fmt(l.y1 * PX_PER_MM)}L${fmt(l.x2 * PX_PER_MM)} ${fmt(l.y2 * PX_PER_MM)}`);
    for (const [t, segs] of byType) (t.startsWith("tb") ? layer.titleBlock : layer.frame).push(`<path d="${segs.join("")}" ${strokeAttrs(lt(t), PX_PER_MM)}/>`);
    for (const t of frame.texts)
      layer[t.layer].push(
        `<text x="${fmt(t.x * PX_PER_MM)}" y="${fmt(t.y * PX_PER_MM)}" text-anchor="${t.anchor}" font-family="${esc(std.font)}" font-size="${fmt(t.sizeMm * PX_PER_MM)}" fill="#000">${esc(t.text)}</text>`,
      );
  }
  // The projection symbol and the scale: bottom corners of the drawing area, or — framed — beside the
  // title block (outside it, ISO 7200), the scale to the symbol's left (ASME: in the block).
  const symRight = frame ? frame.infoAt.x * PX_PER_MM : W - 3 * PX_PER_MM;
  const symBottom = frame ? frame.infoAt.y * PX_PER_MM : H - 3 * PX_PER_MM;
  if (std.projectionSymbol) layer.info.push(projectionSymbol(std, symRight, symBottom, types.visible, types.centre));
  if (std.standardScale && !(frame && o.standard === "asme" && on("titleBlock"))) {
    const at = frame
      ? `x="${fmt(symRight - (std.projectionSymbol ? SYMBOL_W_MM + 4 : 0) * PX_PER_MM)}" y="${fmt(symBottom - 1 * PX_PER_MM)}" text-anchor="end"`
      : `x="${fmt(3 * PX_PER_MM)}" y="${fmt(H - 3 * PX_PER_MM)}"`;
    // In the general text size: the stated scale of every view on the sheet.
    layer.info.push(`<text ${at} font-family="${esc(std.font)}" font-size="${fmt(fontPx)}" fill="#000">SCALE ${scaleLabel(s)}</text>`);
  }

  const order: LayerId[] = ["frame", "titleBlock", "hidden", "visible", "callouts", "titles", "info"];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}" height="${fmt(H)}" viewBox="0 0 ${fmt(W)} ${fmt(H)}">` +
    `<rect width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>` +
    order.filter((id) => layer[id].length && on(id)).map((id) => `<g data-layer="${id}">${layer[id].join("")}</g>`).join("") +
    `</svg>`;
  const out: Sheet = { svg, widthPx: W, heightPx: H, labels, scaleMmPerUnit: s, notes, widthMm: W / PX_PER_MM, heightMm: H / PX_PER_MM };
  if (frame) out.sizeName = frame.size.designation;
  return out;
}

/** The projection symbol's width, mm (its module is 2.2 mm). */
const SYMBOL_W_MM = 2.2 * (2 * 2 + 1.4 + 2.6);

/**
 * The projection symbol (ISO 5456-2 / ASME Y14.3): a truncated cone seen from
 * the side, narrow end on the left, and its end view as two concentric circles —
 * drawn to the LEFT of the cone for third-angle, to the RIGHT for first-angle.
 * Bottom-right of the sheet.
 */
function projectionSymbol(std: DrawingStandard, right: number, bottom: number, outline: LineType, centre: LineType): string {
  const u = 2.2 * PX_PER_MM; // module
  const big = 2 * u, small = u; // radii
  const len = 2.6 * u;
  const totalW = 2 * big + 1.4 * u + len;
  const baseX = right - totalW;
  const cy = bottom - big;
  const thick = outline.widthMm * PX_PER_MM;
  // Its axis: the centre line's pattern, scaled down when one period would not fit twice along it.
  const axisMm = (totalW + u) / PX_PER_MM;
  const period = centre.dashMm.reduce((a, b) => a + b, 0);
  const k = period > axisMm / 2 ? axisMm / 2 / period : 1;
  const axis: LineType = { ...centre, dashMm: centre.dashMm.map((d) => d * k) };
  const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
  const third = std.projection === "third";
  const circlesX = third ? baseX + big : baseX + len + 1.4 * u + big;
  const coneX = third ? baseX + 2 * big + 1.4 * u : baseX;
  // The same frustum in both symbols, narrow end LEFT; only its end view moves (ISO
  // 5456-2 / ASME Y14.3): third angle puts the view from the left on the left, so the
  // short side points TOWARD the circles; first angle puts it on the right, AWAY.
  const cone = `M${fmt(coneX)} ${fmt(cy - small)}L${fmt(coneX + len)} ${fmt(cy - big)}L${fmt(coneX + len)} ${fmt(cy + big)}L${fmt(coneX)} ${fmt(cy + small)}Z`;
  return (
    `<g fill="none" stroke="#000">` +
    `<path d="${cone}" stroke-width="${fmt(thick)}"/>` +
    `<circle cx="${fmt(circlesX)}" cy="${fmt(cy)}" r="${fmt(big)}" stroke-width="${fmt(thick)}"/>` +
    `<circle cx="${fmt(circlesX)}" cy="${fmt(cy)}" r="${fmt(small)}" stroke-width="${fmt(thick)}"/>` +
    // The axis: a centre line (ISO 128-20 type 04 / ASME center).
    `<path d="M${fmt(baseX - u * 0.5)} ${fmt(cy)}L${fmt(baseX + totalW + u * 0.5)} ${fmt(cy)}" ${strokeAttrs(axis, PX_PER_MM).replace('fill="none" stroke="#000" ', "")}/>` +
    `</g>`
  );
}

export type { LineDrawing };
