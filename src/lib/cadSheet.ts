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
import { markSvg, marksExtent, SheetMark } from "./cadMarks";
import { circlePolyline, detailDrawing } from "./cadDetail";

/** The sheet's layers. The user may switch off frame, titleBlock, callouts and titles. */
export type LayerId = "visible" | "hidden" | "callouts" | "markup" | "titles" | "frame" | "titleBlock" | "info";
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
/** "blank": a figure with no model in it, only what is drawn on it by hand (cadMarks). */
/** "exploded": the isometric view of the exploded assembly (SheetOptions.exploded). */
export type ViewSpec = { kind: OrthoKind | "iso" | "blank" | "exploded" } | { kind: "orbit"; deg?: Vec3; rot?: number[]; name?: string } | DetailSpec;
/**
 * A detail view (cadDetail): the circle of radius `r` about `at` on view `of` (in that view's plane,
 * model units), drawn again `factor` times larger, named by `letter`.
 */
export interface DetailSpec {
  kind: "detail";
  letter: string;
  of: OrthoKind | "iso" | "exploded";
  at: [number, number];
  r: number;
  factor: number;
}
/** What names a view on the sheet (marks and frames): its kind, or "detail:A" for a detail. */
export const viewKey = (v: ViewSpec): string => (v.kind === "detail" ? `detail:${v.letter}` : v.kind);

export interface Callout {
  /** A world point ON the part (from pickAt). */
  anchor: Vec3;
  /** What the callout says: a reference numeral, a balloon number, a part letter. */
  label: string;
  /** Its place in the document's callout list (resolveCallouts may leave some out). */
  src?: number;
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
  /** Hand-drawn marks, each on the view of its kind (cadMarks). */
  marks?: SheetMark[];
  /**
   * The exploded assembly (cadExplode), for an "exploded" view: its mesh, each callout's anchor
   * moved with its part (parallel to `callouts`), and the trail lines (world).
   */
  exploded?: { mesh: Mesh; anchors: Vec3[]; trails: Array<[Vec3, Vec3]> };
}

/** Where a view was put: sheet px = (ox + (x − minX)·k, oyBottom − (y − minY)·k); its cell, px. */
export interface SheetFrame {
  view: string;
  ox: number;
  oyBottom: number;
  minX: number;
  minY: number;
  k: number;
  cell: { x: number; y: number; w: number; h: number };
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
  /** Each view's placement, for mapping a click on the sheet back into the view. */
  frames?: SheetFrame[];
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
  if (v.kind === "detail") return v.of === "exploded" ? STANDARD_VIEWS.iso : STANDARD_VIEWS[v.of];
  if (v.kind === "exploded") return STANDARD_VIEWS.iso;
  return v.kind === "blank" ? STANDARD_VIEWS.front : STANDARD_VIEWS[v.kind];
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
    case "blank": return "";
    case "exploded": return "EXPLODED VIEW";
    case "detail": return `DETAIL ${v.letter}`;
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

/**
 * Lays out the sheet. Hand-drawn text is sized on paper, so the room it needs in model units
 * depends on the scale — and that room changes the scale. The scale used is the LARGEST at which
 * the room the text needs there still fits: searched over the standard scales on an engineering
 * sheet, by bisection otherwise. (Repeating the layout with the room the last scale asked for
 * ratcheted down through the standard scales and shrank a drawing twentyfold — the figure-layout
 * audit caught it.) The figures' lines are drawn once and reused by every pass. A mark that does
 * not fit its figure's cell even so is refused by name.
 */
export function layoutSheet(mesh: Mesh, o: SheetOptions): Sheet {
  const std = DRAWING_STANDARDS[o.standard];
  const room = ptToMm(std.textPt) * 1.15; // mm of paper per em of text, with a margin
  const info: LayoutInfo = { textUnits: 0, overflow: null, fitS: 0, drawn: new Map() };
  const first = layoutCore(mesh, o, undefined, info);
  if (!info.textUnits) return first; // no hand-drawn text or numerals to make room for
  const fitAt = (s: number): number => {
    layoutCore(mesh, o, room / s, info);
    return info.fitS;
  };
  let best = 0;
  if (std.standardScale) {
    for (const s of STANDARD_SCALES) {
      if (fitAt(s) >= s * (1 - 1e-9)) {
        best = s;
        break;
      }
    }
  } else {
    const hi = fitAt(1e12); // the text taking no room: an upper bound
    if (hi > 0 && fitAt(hi) >= hi * (1 - 1e-9)) best = hi;
    else if (hi > 0) {
      let lo = hi * 1e-6, up = hi;
      if (fitAt(lo) >= lo) {
        for (let k = 0; k < 40; k++) {
          const mid = Math.sqrt(lo * up);
          if (fitAt(mid) >= mid) lo = mid;
          else up = mid;
        }
        best = lo;
      }
    }
  }
  if (!(best > 0)) return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: ["The hand-drawn text and numerals do not fit on this sheet at any scale — shorten the text, or choose a larger sheet."] };
  // Notes that would shrink the drawing to under a third of its size are refused, not obeyed: a
  // part drawn at 1:20 to make room for a sentence is a drawing nobody can read.
  const plain = std.standardScale ? snapScale(fitAt(1e12)) : fitAt(1e12);
  if (best * 3 < plain) {
    return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: [`The hand-drawn text would shrink the drawing from ${scaleLabel(plain)} to ${scaleLabel(best)} to make room — shorten the notes, put them on fewer figures, or choose a larger sheet.`] };
  }
  const sheet = layoutCore(mesh, o, room / best, info);
  return info.overflow ? { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: [info.overflow] } : sheet;
}

/** A view's lines on the sheet: an exploded view adds its trail lines; a detail, its boundary circle. */
type SheetDrawing = LineDrawing & { trails?: Polyline[]; boundary?: Polyline };

/** What one layout pass reports back, and the figures' lines it shares with the next pass. */
interface LayoutInfo {
  /** The room given to text (model units per em); 0 when there is no hand-drawn text. */
  textUnits: number;
  /** A mark that ran out of its figure's cell. */
  overflow: string | null;
  /** The largest scale that fit, before any snapping to a standard scale (0 when refused earlier). */
  fitS: number;
  /** Each view's line drawing, drawn on the first pass. */
  drawn: Map<string, LineDrawing>;
}

function layoutCore(mesh: Mesh, o: SheetOptions, textUnitsIn: number | undefined, info: LayoutInfo): Sheet {
  info.textUnits = 0;
  info.overflow = null;
  info.fitS = 0;
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

  // Each view's drawing, and its cell. With no parts at all, only blank figures can be drawn.
  const noModel = !mesh.triangles.length;
  const needsExploded = (v: ViewSpec): boolean => v.kind === "exploded" || (v.kind === "detail" && v.of === "exploded");
  let views = noModel ? o.views.filter((v) => v.kind === "blank") : o.views;
  if (!o.exploded && views.some(needsExploded)) {
    views = views.filter((v) => !needsExploded(v));
    notes.push("The exploded view needs the parts apart: press Auto explode, or give a part an explode distance.");
  }
  if (!views.length) return { svg: "", widthPx: 0, heightPx: 0, labels: [], scaleMmPerUnit: 0, notes: ["Add a part, or tick Blank figure to draw freehand."] };
  if (views.length < o.views.length) notes.push("There are no parts yet, so only the blank figure is drawn.");
  // A blank figure is as large as the largest model view (so marks keep their size when parts come
  // and go), or 100 × 70 units with no model.
  const BLANK_EMPTY: LineDrawing = { visible: [], hidden: [], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 70 }, stats: { triangles: 0, featureSegments: 0, pieces: 0 } };
  const cellsFor = CELLS[std.projection];
  const used = new Set<string>();
  const project = (view: CadView, p: Vec3): [number, number] => {
    const R = view.rot;
    return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2]];
  };
  /** A view's lines: the model's; the exploded assembly's with its trails; a detail's from its parent's. */
  const drawingOf = (spec: ViewSpec): SheetDrawing => {
    const key = JSON.stringify(spec);
    let d = info.drawn.get(key) as SheetDrawing | undefined;
    if (d) return d;
    if (spec.kind === "detail") d = detailDrawing(drawingOf({ kind: spec.of }), spec.at, spec.r, spec.factor);
    else if (spec.kind === "exploded") {
      const view = viewOf(spec);
      const base = drawLines(o.exploded!.mesh, view);
      const trails: Polyline[] = o.exploded!.trails.map(([a, b]) => [project(view, a), project(view, b)]);
      const bd = { ...base.bounds };
      for (const l of trails) for (const [x, y] of l) (bd.minX = Math.min(bd.minX, x)), (bd.maxX = Math.max(bd.maxX, x)), (bd.minY = Math.min(bd.minY, y)), (bd.maxY = Math.max(bd.maxY, y));
      d = { ...base, bounds: bd, trails };
    } else d = drawLines(mesh, viewOf(spec));
    info.drawn.set(key, d);
    return d;
  };
  const drawings = views.map((spec): SheetDrawing | null => {
    if (spec.kind === "blank") return null;
    const d = drawingOf(spec);
    // Each pass grows its own copy's box (marks): the drawing itself is shared.
    return { ...d, bounds: { ...d.bounds } };
  });
  let blankW = 0, blankH = 0;
  for (const d of drawings) {
    if (!d) continue;
    blankW = Math.max(blankW, d.bounds.maxX - d.bounds.minX);
    blankH = Math.max(blankH, d.bounds.maxY - d.bounds.minY);
  }
  const items = views.map((spec, vi) => {
    const view = viewOf(spec);
    const d: SheetDrawing = drawings[vi] ?? (blankW > 0 ? { ...BLANK_EMPTY, bounds: { minX: 0, minY: 0, maxX: blankW, maxY: Math.max(blankH, blankW * 0.5) } } : { ...BLANK_EMPTY, bounds: { ...BLANK_EMPTY.bounds } });
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

  // Each detail's circle is drawn on its parent view (when that view is on the sheet): its box holds it.
  const details = items.filter((i): i is (typeof items)[number] & { spec: DetailSpec } => i.spec.kind === "detail");
  for (const dt of details) {
    const parent = items.find((i) => viewKey(i.spec) === dt.spec.of);
    if (!parent) {
      notes.push(`Detail ${dt.spec.letter} is of the ${dt.spec.of === "iso" ? "isometric" : dt.spec.of} view, which is not on this sheet: its circle is not drawn — the enlarged view and the view it enlarges must both be shown.`);
      continue;
    }
    const b = parent.d.bounds, [cx, cy] = dt.spec.at, r = dt.spec.r;
    parent.d.bounds = { minX: Math.min(b.minX, cx - r), minY: Math.min(b.minY, cy - r), maxX: Math.max(b.maxX, cx + r), maxY: Math.max(b.maxY, cy + r) };
  }

  // Compact the grid: only columns / rows that hold a view.
  const cols = [...new Set(items.map((i) => i.cell[0]))].sort((a, b) => a - b);
  const rows = [...new Set(items.map((i) => i.cell[1]))].sort((a, b) => a - b);

  // Hand-drawn marks: each view's box grows to hold its own. Text is sized on paper, so its
  // extent in model units uses the scale the drawings alone would get (an estimate that errs
  // on the side of room). Orthographic views in one column share their X extent, and in one
  // row their Y extent, so the projections stay aligned.
  // Marks on "This view" are not drawn: that view turns with the model, and a mark drawn at one
  // angle would point at nothing at another (review). Marks far outside their figure (a damaged
  // model) are not drawn either: they would shrink the drawing to a dot.
  const onSheet = new Set(items.map((i) => viewKey(i.spec)));
  const strays = new Map<string, number>();
  let orbitMarks = 0, farMarks = 0;
  const marks = (o.marks ?? []).filter((m) => {
    if (m.view === "orbit") {
      orbitMarks++;
      return false;
    }
    if (!onSheet.has(m.view)) {
      strays.set(m.view, (strays.get(m.view) ?? 0) + 1);
      return false;
    }
    const it = items.find((i) => viewKey(i.spec) === m.view)!;
    const b = it.d.bounds, span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
    const e = marksExtent([m], 0)!;
    if (e.minX < b.minX - 3 * span || e.maxX > b.maxX + 3 * span || e.minY < b.minY - 3 * span || e.maxY > b.maxY + 3 * span) {
      farMarks++;
      return false;
    }
    return true;
  });
  for (const [v, n] of strays) notes.push(`${n} hand-drawn mark${n === 1 ? " belongs" : "s belong"} to the ${v === "iso" ? "isometric" : v} view, which is not on this sheet.`);
  if (orbitMarks) notes.push(`${orbitMarks} hand-drawn mark${orbitMarks === 1 ? " is" : "s are"} on "This view", which turns with the model, so ${orbitMarks === 1 ? "it is" : "they are"} not drawn — draw on a standard view or the isometric.`);
  if (farMarks) notes.push(`${farMarks} hand-drawn mark${farMarks === 1 ? " lies" : "s lie"} far outside ${farMarks === 1 ? "its" : "their"} figure and ${farMarks === 1 ? "is" : "are"} not drawn.`);
  if (marks.length) {
    const spanW = cols.reduce((a, c) => a + Math.max(...items.filter((i) => i.cell[0] === c).map((i) => i.d.bounds.maxX - i.d.bounds.minX)), 0);
    const spanH = rows.reduce((a, r) => a + Math.max(...items.filter((i) => i.cell[1] === r).map((i) => i.d.bounds.maxY - i.d.bounds.minY)), 0);
    const sEst = Math.min(area.w / (spanW || 1), area.h / (spanH || 1)) * 0.8;
    const textUnits = textUnitsIn ?? (ptToMm(std.textPt) * 1.1) / (sEst || 1);
    info.textUnits = textUnits;
    for (const it of items) {
      const ext = marksExtent(marks.filter((m) => m.view === viewKey(it.spec)), textUnits);
      if (!ext) continue;
      const b = it.d.bounds;
      it.d.bounds = { minX: Math.min(b.minX, ext.minX), minY: Math.min(b.minY, ext.minY), maxX: Math.max(b.maxX, ext.maxX), maxY: Math.max(b.maxY, ext.maxY) };
    }
    for (const c of cols) {
      const col = items.filter((i) => !i.pictorial && i.cell[0] === c);
      const lo = Math.min(...col.map((i) => i.d.bounds.minX)), hi = Math.max(...col.map((i) => i.d.bounds.maxX));
      for (const i of col) i.d.bounds = { ...i.d.bounds, minX: lo, maxX: hi };
    }
    for (const r of rows) {
      const row = items.filter((i) => !i.pictorial && i.cell[1] === r);
      const lo = Math.min(...row.map((i) => i.d.bounds.minY)), hi = Math.max(...row.map((i) => i.d.bounds.maxY));
      for (const i of row) i.d.bounds = { ...i.d.bounds, minY: lo, maxY: hi };
    }
  }
  const colW = cols.map((c) => Math.max(...items.filter((i) => i.cell[0] === c).map((i) => i.d.bounds.maxX - i.d.bounds.minX)));
  const rowH = rows.map((r) => Math.max(...items.filter((i) => i.cell[1] === r).map((i) => i.d.bounds.maxY - i.d.bounds.minY)));

  // FIG numbers follow the sheet's reading order (top row first, left to
  // right), not the order the views were asked for.
  const readingOrder = [...items].sort((p, q) => p.cell[1] - q.cell[1] || p.cell[0] - q.cell[0]);
  const figOf = new Map(readingOrder.map((it, i) => [it, (o.figStart ?? 1) + i]));
  /** A view's title; a detail's names its scale (ASME "DETAIL A SCALE 2:1", ISO "A (2:1)") at sheet scale `sc`. */
  const labelOf = (it: (typeof items)[number], sc = 1): string => {
    if (std.viewLabels === "fig") return `FIG. ${figOf.get(it)}`;
    if (std.viewLabels !== "name") return "";
    if (it.spec.kind !== "detail") return viewName(it.spec);
    const k = scaleLabel(sc * it.spec.factor);
    return o.standard === "iso" ? `${it.spec.letter} (${k})` : `DETAIL ${it.spec.letter} SCALE ${k}`;
  };

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
    const sp = it.spec;
    const ex = needsExploded(sp);
    callouts.forEach((c, n) => {
      if (sp.kind === "blank") return;
      const anchor = ex ? (o.exploded!.anchors[n] ?? c.anchor) : c.anchor;
      if (pointHidden(ex ? o.exploded!.mesh : mesh, it.view, anchor)) return;
      let x = R[0] * anchor[0] + R[1] * anchor[1] + R[2] * anchor[2];
      let y = R[3] * anchor[0] + R[4] * anchor[1] + R[5] * anchor[2];
      if (sp.kind === "detail") {
        if (Math.hypot(x - sp.at[0], y - sp.at[1]) > sp.r) return;
        x = sp.at[0] + (x - sp.at[0]) * sp.factor;
        y = sp.at[1] + (y - sp.at[1]) * sp.factor;
      }
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
  // (A detail's scale is not known yet: room for the longest, "10:1" or "1:200".)
  const titleMm = cols.map((c) => (titlesOn ? Math.max(0, ...items.filter((it) => it.cell[0] === c).map((it) => (labelOf(it).length + (it.spec.kind === "detail" ? 3 : 0)) * 0.62 * headingMm)) : 0));

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
  info.fitS = fitS;
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
  const layer: Record<LayerId, string[]> = { frame: [], titleBlock: [], hidden: [], visible: [], callouts: [], markup: [], titles: [], info: [] };
  const frames: SheetFrame[] = [];
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
    frames.push({ view: viewKey(it.spec), ox, oyBottom, minX: b.minX, minY: b.minY, k, cell: { x: cellX, y: cellY, w: cw, h: chh } });
    for (const m of marks) {
      if (m.view !== viewKey(it.spec)) continue;
      const ms = { X, Y, strokePx: types.visible.widthMm * PX_PER_MM, fontPx: textMm * PX_PER_MM, font: std.font };
      layer.markup.push(markSvg(m, ms));
      // Every mark must sit in its own figure's cell (with a little slack): one that does not
      // would run over a neighbour or off the sheet.
      const e = marksExtent([m], textMm / s)!;
      const slack = 2 * PX_PER_MM;
      if (!info.overflow && (X(e.minX) < cellX - slack || X(e.maxX) > cellX + cw + slack || Y(e.maxY) < cellY - slack || Y(e.minY) > cellY + chh + slack)) {
        const what = m.kind === "text" ? `The text "${m.text.length > 30 ? m.text.slice(0, 30) + "…" : m.text}"` : m.kind === "numeral" ? `Numeral ${m.label}` : "A hand-drawn mark";
        info.overflow = `${what} does not fit beside its figure on this sheet — shorten it, move it closer, or choose a larger sheet.`;
      }
    }

    const showHidden = o.showHidden ?? (it.pictorial ? std.hiddenInPictorial : std.hiddenInOrthographic);
    if (showHidden && it.d.hidden.length) layer.hidden.push(`<path d="${path(it.d.hidden)}" ${strokeAttrs(types.hidden, PX_PER_MM)}/>`);
    if (it.d.visible.length) layer.visible.push(`<path d="${path(it.d.visible)}" ${strokeAttrs(types.visible, PX_PER_MM)}/>`);
    // Trail lines of an exploded view: phantom lines (ASME Y14.2 / ISO 128 type 05: alternate positions).
    if (it.d.trails?.length) layer.visible.push(`<path d="${path(it.d.trails)}" ${strokeAttrs(types.phantom, PX_PER_MM)}/>`);
    const thin = { ...types.hidden, dashMm: [], cap: "round" as const };
    if (it.d.boundary) layer.visible.push(`<path d="${path([it.d.boundary])}" ${strokeAttrs(thin, PX_PER_MM)}/>`);
    // The circle of each detail taken from this view, named as the detail is.
    for (const dt of details) {
      if (dt.spec.of !== viewKey(it.spec)) continue;
      const [cx, cy] = dt.spec.at, rr = dt.spec.r;
      layer.visible.push(`<path d="${path([circlePolyline([cx, cy], rr)])}" ${strokeAttrs(thin, PX_PER_MM)}/>`);
      const tag = std.viewLabels === "fig" ? `FIG. ${figOf.get(dt)}` : dt.spec.letter;
      const lx = X(cx + rr * Math.SQRT1_2) + fontPx * 0.4, ly = Y(cy + rr * Math.SQRT1_2) - fontPx * 0.4;
      layer.titles.push(`<text x="${fmt(lx)}" y="${fmt(ly)}" font-family="${esc(std.font)}" font-size="${fmt(fontPx)}" fill="#000">${esc(tag)}</text>`);
    }
    // 37 CFR 1.84(h)(1): an exploded view on a sheet with another figure is placed in brackets.
    if (it.spec.kind === "exploded" && o.standard === "uspto" && items.length > 1) {
      const m = 2 * PX_PER_MM, lip = 2 * PX_PER_MM;
      const xl = ox - m, xr = ox + vw + m, yt = oyBottom - vh - m, yb = oyBottom + m;
      layer.visible.push(`<path d="M${fmt(xl + lip)} ${fmt(yt)}L${fmt(xl)} ${fmt(yt)}L${fmt(xl)} ${fmt(yb)}L${fmt(xl + lip)} ${fmt(yb)}M${fmt(xr - lip)} ${fmt(yt)}L${fmt(xr)} ${fmt(yt)}L${fmt(xr)} ${fmt(yb)}L${fmt(xr - lip)} ${fmt(yb)}" ${strokeAttrs(thin, PX_PER_MM)}/>`);
    }
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

    const label = labelOf(it, s);
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
  // A sheet of blank figures has no model, so it has no scale to state.
  if (std.standardScale && !noModel && !(frame && o.standard === "asme" && on("titleBlock"))) {
    const at = frame
      ? `x="${fmt(symRight - (std.projectionSymbol ? SYMBOL_W_MM + 4 : 0) * PX_PER_MM)}" y="${fmt(symBottom - 1 * PX_PER_MM)}" text-anchor="end"`
      : `x="${fmt(3 * PX_PER_MM)}" y="${fmt(H - 3 * PX_PER_MM)}"`;
    // In the general text size: the stated scale of every view on the sheet.
    layer.info.push(`<text ${at} font-family="${esc(std.font)}" font-size="${fmt(fontPx)}" fill="#000">SCALE ${scaleLabel(s)}</text>`);
  }

  const order: LayerId[] = ["frame", "titleBlock", "hidden", "visible", "callouts", "markup", "titles", "info"];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}" height="${fmt(H)}" viewBox="0 0 ${fmt(W)} ${fmt(H)}">` +
    `<rect width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>` +
    order.filter((id) => layer[id].length && on(id)).map((id) => `<g data-layer="${id}">${layer[id].join("")}</g>`).join("") +
    `</svg>`;
  const out: Sheet = { svg, widthPx: W, heightPx: H, labels, scaleMmPerUnit: s, notes, frames, widthMm: W / PX_PER_MM, heightMm: H / PX_PER_MM };
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
