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
 */
import type { Mesh, Vec3 } from "./cadModel";
import { drawLines, LineDrawing, STANDARD_VIEWS, viewFromDegrees, CadView, Polyline } from "./cadLines";
import { DRAWING_STANDARDS, DrawingStandard, StandardId } from "./cadStandards";
import { ptToMm } from "./figureStyle";

export type OrthoKind = "front" | "top" | "right" | "left" | "back" | "bottom";
export type ViewSpec = { kind: OrthoKind | "iso" } | { kind: "orbit"; deg: Vec3; name?: string };

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
  if (v.kind === "orbit") return viewFromDegrees(v.deg, v.name ?? "view");
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
    const det = (c[4] - c[7]) * (c[0] - c[6]) + (c[6] - c[3]) * (c[1] - c[7]);
    if (Math.abs(det) < 1e-18) continue;
    const l1 = ((c[4] - c[7]) * (x - c[6]) + (c[6] - c[3]) * (y - c[7])) / det;
    const l2 = ((c[7] - c[1]) * (x - c[6]) + (c[0] - c[6]) * (y - c[7])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 1e-9 || l2 < 1e-9 || l3 < 1e-9) continue;
    if (l1 * c[2] + l2 * c[5] + l3 * c[8] > z + eps) return true;
  }
  return false;
}

/** Lays out the sheet. */
export function layoutSheet(mesh: Mesh, o: SheetOptions): Sheet {
  const std: DrawingStandard = DRAWING_STANDARDS[o.standard];
  const callouts = o.callouts ?? [];
  const notes: string[] = [];
  if (!o.views.length) return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: ["Choose at least one view."] };

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

  // One scale for every view, so the orthographic views stay true to each other.
  const textMm = ptToMm(std.textPt);
  const headingMm = ptToMm(std.headingPt);
  const labelMm = std.viewLabels === "none" ? 0 : headingMm * 2.2;
  // A callout column beside a view: 5 mm of leader, then the balloon (or the
  // numeral). Two views share every gap, so it holds two columns.
  const balloonMm = Math.max(textMm * 0.95, 4);
  const calloutMm = callouts.length ? 5 + (std.callouts === "balloon" ? 2 * balloonMm : textMm * 1.6) + 1 : 0;
  // Horizontal room: every gap between two views holds two callout columns,
  // an outer edge holds one. Vertical room needs only the view title.
  const gapMm = 10 + 2 * calloutMm;
  const edgeMm = 6 + calloutMm;
  const rowGapMm = 8;
  const sumW = colW.reduce((a, b) => a + b, 0) || 1;
  const sumH = rowH.reduce((a, b) => a + b, 0) || 1;
  const availW = std.areaMm.w - 2 * edgeMm - gapMm * (cols.length - 1);
  const availH = std.areaMm.h - (rowGapMm + labelMm) * rows.length - rowGapMm;
  const s = Math.max(1e-6, Math.min(availW / sumW, availH / sumH)); // mm per model unit
  if (availW <= 0 || availH <= 0) notes.push("These views leave almost no room on the sheet; choose fewer views.");

  const W = std.areaMm.w * PX_PER_MM;
  const totalH = rowH.reduce((a, b) => a + b, 0) * s + (rowGapMm + labelMm) * rows.length + rowGapMm;
  const H = Math.min(std.areaMm.h, totalH) * PX_PER_MM;
  const usedW = colW.reduce((a, b) => a + b, 0) * s + 2 * edgeMm + gapMm * (cols.length - 1);
  const x0 = ((std.areaMm.w - usedW) / 2) * PX_PER_MM;

  const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
  const strokeV = std.visibleMm * PX_PER_MM;
  const strokeH = std.hiddenMm * PX_PER_MM;
  const dashArray = std.dashMm
    ? `${fmt(std.dashMm[0] * PX_PER_MM)} ${fmt(std.dashMm[1] * PX_PER_MM)}`
    : `${fmt(strokeH * std.dash[0])} ${fmt(strokeH * std.dash[1])}`;
  const fontPx = textMm * PX_PER_MM;
  const headingPx = headingMm * PX_PER_MM;
  const parts: string[] = [];
  const labels: string[] = [];
  // FIG numbers follow the sheet's reading order (top row first, left to
  // right), not the order the views were asked for.
  const readingOrder = [...items].sort((p, q) => p.cell[1] - q.cell[1] || p.cell[0] - q.cell[0]);
  const figOf = new Map(readingOrder.map((it, i) => [it, (o.figStart ?? 1) + i]));
  const calloutSeen = new Array(callouts.length).fill(false);
  const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  for (const it of items) {
    const ci = cols.indexOf(it.cell[0]);
    const ri = rows.indexOf(it.cell[1]);
    // Cell origin (top-left), px.
    const cellX = x0 + (edgeMm + gapMm * ci + colW.slice(0, ci).reduce((a, b) => a + b, 0) * s) * PX_PER_MM;
    const cellY = ((rowGapMm + labelMm) * ri + rowGapMm + rowH.slice(0, ri).reduce((a, b) => a + b, 0) * s) * PX_PER_MM;
    const b = it.d.bounds;
    const vw = (b.maxX - b.minX) * s * PX_PER_MM;
    const vh = (b.maxY - b.minY) * s * PX_PER_MM;
    const cw = colW[ci] * s * PX_PER_MM;
    const chh = rowH[ri] * s * PX_PER_MM;
    // Orthographic views align on the shared axes (left edge for a column, bottom
    // edge for a row); a pictorial view is centred in its cell.
    const ox = it.pictorial ? cellX + (cw - vw) / 2 : cellX;
    const oyBottom = it.pictorial ? cellY + (chh + vh) / 2 : cellY + chh;
    const k = s * PX_PER_MM;
    const X = (x: number): number => ox + (x - b.minX) * k;
    const Y = (y: number): number => oyBottom - (y - b.minY) * k;
    const path = (lines: Polyline[]): string => lines.map((l) => "M" + l.map(([x, y]) => `${fmt(X(x))} ${fmt(Y(y))}`).join("L")).join("");

    const showHidden = o.showHidden ?? (it.pictorial ? std.hiddenInPictorial : std.hiddenInOrthographic);
    if (showHidden && it.d.hidden.length) {
      parts.push(
        `<path d="${path(it.d.hidden)}" fill="none" stroke="#000" stroke-width="${fmt(strokeH)}" stroke-dasharray="${dashArray}"/>`,
      );
    }
    if (it.d.visible.length) {
      parts.push(`<path d="${path(it.d.visible)}" fill="none" stroke="#000" stroke-width="${fmt(strokeV)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }

    // Callouts visible in this view, set in a COLUMN beside the view on the
    // nearer side, each at its part's height and pushed apart so none overlap
    // (the usual drafting arrangement). Placing them radially put the lower
    // ones on top of the view's own label.
    const cxC = (X(b.minX) + X(b.maxX)) / 2;
    const r = Math.max(fontPx * 0.95, 4 * PX_PER_MM); // balloon radius
    const pitch = std.callouts === "balloon" ? 2 * r + 1.5 * PX_PER_MM : fontPx * 1.5;
    const side: Array<{ n: number; ax: number; ay: number; right: boolean; ly: number }> = [];
    callouts.forEach((c, n) => {
      if (pointHidden(mesh, it.view, c.anchor)) return;
      calloutSeen[n] = true;
      const R = it.view.rot;
      const ax = X(R[0] * c.anchor[0] + R[1] * c.anchor[1] + R[2] * c.anchor[2]);
      const ay = Y(R[3] * c.anchor[0] + R[4] * c.anchor[1] + R[5] * c.anchor[2]);
      side.push({ n, ax, ay, right: ax >= cxC, ly: ay });
    });
    const top = oyBottom - vh, bottom = oyBottom;
    for (const right of [true, false]) {
      const col = side.filter((s2) => s2.right === right).sort((p, q) => p.ay - q.ay);
      // Push down to keep the pitch, then pull the whole column back up if it ran past the view.
      for (let i = 1; i < col.length; i++) col[i].ly = Math.max(col[i].ly, col[i - 1].ly + pitch);
      const overflow = col.length ? col[col.length - 1].ly - bottom : 0;
      if (overflow > 0) for (const s2 of col) s2.ly -= overflow;
      for (let i = col.length - 2; i >= 0; i--) col[i].ly = Math.min(col[i].ly, col[i + 1].ly - pitch);
      if (col.length && col[0].ly < top - pitch) {
        const shift = top - pitch - col[0].ly;
        for (const s2 of col) s2.ly += shift;
      }
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

    const label = std.viewLabels === "fig" ? `FIG. ${figOf.get(it)}` : std.viewLabels === "name" ? viewName(it.spec) : "";
    labels.push(label);
    if (label) {
      const ly = cellY + chh + labelMm * 0.75 * PX_PER_MM;
      parts.push(`<text x="${fmt(ox + vw / 2)}" y="${fmt(ly)}" text-anchor="middle" font-family="${esc(std.font)}" font-size="${fmt(headingPx)}" fill="#000">${esc(label)}</text>`);
    }
  }

  callouts.forEach((c, n) => {
    if (!calloutSeen[n]) notes.push(`Callout ${c.label} is hidden in every view on this sheet, so it is not drawn.`);
  });

  if (std.projectionSymbol) parts.push(projectionSymbol(std, W, H, strokeV, strokeH));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}" height="${fmt(H)}" viewBox="0 0 ${fmt(W)} ${fmt(H)}">` +
    `<rect width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>` +
    parts.join("") +
    `</svg>`;
  return { svg, widthPx: W, heightPx: H, labels, scaleMmPerUnit: s, notes };
}

/**
 * The projection symbol (ISO 5456-2 / ASME Y14.3): a truncated cone seen from
 * the side, large end on the left, and its end view as two concentric circles —
 * drawn to the LEFT of the cone for third-angle, to the RIGHT for first-angle.
 * Bottom-right of the sheet.
 */
function projectionSymbol(std: DrawingStandard, W: number, H: number, thick: number, thin: number): string {
  const u = 2.2 * PX_PER_MM; // module
  const big = 2 * u, small = u; // radii
  const len = 2.6 * u;
  const pad = 3 * PX_PER_MM;
  const totalW = 2 * big + 1.4 * u + len;
  const baseX = W - pad - totalW;
  const cy = H - pad - big;
  const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
  const third = std.projection === "third";
  const circlesX = third ? baseX + big : baseX + len + 1.4 * u + big;
  const coneX = third ? baseX + 2 * big + 1.4 * u : baseX;
  const cone = `M${fmt(coneX)} ${fmt(cy - big)}L${fmt(coneX + len)} ${fmt(cy - small)}L${fmt(coneX + len)} ${fmt(cy + small)}L${fmt(coneX)} ${fmt(cy + big)}Z`;
  return (
    `<g fill="none" stroke="#000">` +
    `<path d="${cone}" stroke-width="${fmt(thick)}"/>` +
    `<circle cx="${fmt(circlesX)}" cy="${fmt(cy)}" r="${fmt(big)}" stroke-width="${fmt(thick)}"/>` +
    `<circle cx="${fmt(circlesX)}" cy="${fmt(cy)}" r="${fmt(small)}" stroke-width="${fmt(thick)}"/>` +
    `<path d="M${fmt(baseX - u * 0.5)} ${fmt(cy)}L${fmt(baseX + totalW + u * 0.5)} ${fmt(cy)}" stroke-width="${fmt(thin)}" stroke-dasharray="${fmt(thin * 12)} ${fmt(thin * 3)} ${fmt(thin)} ${fmt(thin * 3)}"/>` +
    `</g>`
  );
}

export type { LineDrawing };
