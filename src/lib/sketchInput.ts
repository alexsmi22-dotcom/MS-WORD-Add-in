/**
 * How the sketcher takes input the way a Solid Edge (or draw.io) user expects
 * (docs/SCOPE-CAD-R2.md, usability round after the 2026-10-18 user test: "if i
 * want to draw a box, it's very challenging"):
 *
 *   - a GRID that snaps, its spacing a round number of mm that follows the zoom;
 *   - INFERENCE: the cursor locks onto existing points and line midpoints, and
 *     lines up horizontally / vertically with points already drawn, each shown
 *     with a guide — points beat alignment, alignment beats the grid;
 *   - TYPED SIZES while drawing: a rectangle's W and H, a line's length and
 *     angle, a circle's Ø — typed values place the shape exactly; W, H, a line's
 *     length and Ø become its driving dimensions, in ONE undo step (a typed angle
 *     places the line but is not a dimension: an angle dimension needs a second line);
 *   - a LIVE readout of the size under the cursor, and a PROMPT saying what to
 *     click next.
 * Pure functions over the sketch and the view scale; the pane only wires them.
 */
import type { Sketch, SPoint } from "./sketch";
import { EditResult, EditState, SketchTool, applyDimension, click, snapPoint } from "./sketchEdit";

/** px on screen per sketch mm, at which the grid stays readable (12 px between lines). */
const GRID_MIN_PX = 12;

/** The grid spacing (mm) at `pxPerMm`: the smallest 1, 2 or 5 × 10ⁿ at least 12 px apart. */
export function gridStep(pxPerMm: number): number {
  const raw = GRID_MIN_PX / pxPerMm;
  const e = Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    const s = m * 10 ** e;
    if (s >= raw * (1 - 1e-12)) return +s.toPrecision(12);
  }
  return 10 ** (e + 1);
}

/** "grid 5 mm", "grid 0.5 mm". */
export const gridLabel = (step: number): string => `grid ${fmt(step)} mm`;

export type SnapKind = "point" | "midpoint" | "align" | "grid" | "free";
export interface Snapped {
  x: number;
  y: number;
  kind: SnapKind;
  /** The existing point the cursor locked onto (kind "point"). */
  point?: string;
  /** Guides to draw (sketch coordinates): alignment lines through the point lined up with. */
  guides: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

/**
 * Where a click at (x, y) lands. `pxPerMm` is the view scale; snapping reaches 8 px.
 * `anchor` is the tool's first point, which the cursor also lines up with.
 */
export function snapCursor(sk: Sketch, x: number, y: number, pxPerMm: number, opts: { grid: boolean; anchor?: { x: number; y: number } }): Snapped {
  const tol = 8 / pxPerMm;
  const p = snapPoint(sk, x, y, tol);
  if (p) {
    const q = sk.points.find((k) => k.id === p)!;
    return { x: q.x, y: q.y, kind: "point", point: p, guides: [] };
  }
  for (const e of sk.entities) {
    if (e.kind !== "line") continue;
    const a = P(sk, e.a), b = P(sk, e.b);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (Math.hypot(mx - x, my - y) <= tol) return { x: mx, y: my, kind: "midpoint", guides: [] };
  }
  // Line up with points already drawn (and the anchor): the nearest within reach, per axis.
  const refs: Array<{ x: number; y: number }> = [...sk.points, ...(opts.anchor ? [opts.anchor] : [])];
  let ax: { x: number; y: number } | null = null, ay: { x: number; y: number } | null = null;
  let bx = tol, by = tol;
  for (const r of refs) {
    if (Math.abs(r.x - x) <= bx) [ax, bx] = [r, Math.abs(r.x - x)];
    if (Math.abs(r.y - y) <= by) [ay, by] = [r, Math.abs(r.y - y)];
  }
  const step = gridStep(pxPerMm);
  const g = (v: number): number => +(Math.round(v / step) * step).toPrecision(12);
  let nx = ax ? ax.x : opts.grid ? g(x) : x;
  let ny = ay ? ay.y : opts.grid ? g(y) : y;
  if (!Number.isFinite(nx)) nx = x;
  if (!Number.isFinite(ny)) ny = y;
  const guides: Snapped["guides"] = [];
  if (ax) guides.push({ x1: ax.x, y1: ax.y, x2: ax.x, y2: ny });
  if (ay) guides.push({ x1: ay.x, y1: ay.y, x2: nx, y2: ay.y });
  const kind: SnapKind = ax || ay ? "align" : opts.grid ? "grid" : "free";
  return { x: nx, y: ny, kind, guides };
}

// ---- typed sizes -----------------------------------------------------------------------------

/** The size fields a tool offers (the pane shows these, in this order). */
export function typedFields(tool: SketchTool): Array<{ label: string; kind: "length" | "angle" }> {
  switch (tool) {
    case "rectangle":
    case "centreRectangle":
      return [{ label: "W", kind: "length" }, { label: "H", kind: "length" }];
    case "line":
      return [{ label: "Length", kind: "length" }, { label: "Angle °", kind: "angle" }];
    case "circle":
      return [{ label: "Ø", kind: "length" }];
    default:
      return [];
  }
}

/** A typed size: the number, or why it is refused (by name). Empty = not typed (null). */
export function parseTyped(text: string, kind: "length" | "angle", label: string): number | null | string {
  let t = text.trim().replace(",", ".");
  if (!t) return null;
  t = kind === "angle" ? t.replace(/\s*(°|º|deg)$/i, "") : t.replace(/^[Ø⌀]/, "").replace(/\s*mm$/i, "");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return `${label}: "${text.trim()}" is not a number`;
  const v = Number(t);
  if (kind === "length" && !(v > 0)) return `${label} must be greater than 0`;
  if (kind === "length" && v < 1e-6) return `${label} must be at least 0.000001 mm`;
  if (Math.abs(v) > 1e6) return `${label} must be at most 1 000 000${kind === "angle" ? "°" : " mm"}`;
  return v;
}

/** What the cursor would make now: the readout for the size fields (W × H, length and angle, Ø). */
export function liveSize(tool: SketchTool, anchor: { x: number; y: number } | undefined, cursor: { x: number; y: number } | null): number[] {
  if (!anchor || !cursor) return [];
  const dx = cursor.x - anchor.x, dy = cursor.y - anchor.y;
  switch (tool) {
    case "rectangle":
      return [Math.abs(dx), Math.abs(dy)];
    case "centreRectangle":
      return [2 * Math.abs(dx), 2 * Math.abs(dy)];
    case "line": {
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (a < 0) a += 360;
      return [Math.hypot(dx, dy), a];
    }
    case "circle":
      return [2 * Math.hypot(dx, dy)];
    default:
      return [];
  }
}

/**
 * Places the tool's shape from typed sizes. `at` is where the user clicked (or the cursor when
 * Enter was pressed). Without a first point yet, `at` becomes it — the shape grows up and to the
 * right; with one, the shape goes toward `at`. Each typed size becomes a driving dimension; the
 * result is one state (one undo step). Untyped sizes come from `at`.
 */
export function placeTyped(st: EditState, typed: Array<number | null>, at: { x: number; y: number; snap?: string }, tol: number): EditResult {
  const tool = st.tool;
  if (!typedFields(tool).length) return { ok: false, state: st, reason: "this tool takes no typed size" };
  const first = st.pending[0];
  const anchor = first ?? at;
  // The first click (when it is this one) snaps as any click does; the typed corner never snaps,
  // so a nearby point cannot change the size that was typed.
  let s: EditState = st;
  if (!first) {
    const r = click(st, at.x, at.y, tol);
    if (!r.ok) return r;
    s = r.state;
  }
  const a0 = s.pending[0] ?? anchor;
  const sx = first ? Math.sign(at.x - a0.x) || 1 : 1, sy = first ? Math.sign(at.y - a0.y) || 1 : 1;
  const [t0, t1] = typed;
  let to: { x: number; y: number };
  if (tool === "rectangle" || tool === "centreRectangle") {
    const half = tool === "centreRectangle" ? 0.5 : 1;
    const w = t0 ?? (first ? Math.abs(at.x - a0.x) / half : NaN), h = t1 ?? (first ? Math.abs(at.y - a0.y) / half : NaN);
    if (!(w > 0) || !(h > 0)) return { ok: true, state: s }; // a size still to come from the next click
    to = { x: a0.x + sx * w * half, y: a0.y + sy * h * half };
  } else if (tool === "line") {
    const ang = t1 !== null && t1 !== undefined ? (t1 * Math.PI) / 180 : first ? Math.atan2(at.y - a0.y, at.x - a0.x) : 0;
    const len = t0 ?? (first ? (at.x - a0.x) * Math.cos(ang) + (at.y - a0.y) * Math.sin(ang) : NaN);
    if (first && t0 === null && !(len > 0)) return { ok: false, state: st, reason: "that click is behind the typed angle — click on the side it points to, or type the length" };
    if (!(len > 0)) return { ok: true, state: s };
    to = { x: a0.x + len * Math.cos(ang), y: a0.y + len * Math.sin(ang) };
  } else {
    const d = t0 ?? (first ? 2 * Math.hypot(at.x - a0.x, at.y - a0.y) : NaN);
    if (!(d > 0)) return { ok: true, state: s };
    to = { x: a0.x + d / 2, y: a0.y };
  }
  if (!(Math.abs(to.x) <= 1e6 && Math.abs(to.y) <= 1e6)) return { ok: false, state: st, reason: "the shape would reach beyond ±1 000 000 mm — a sketch is drawn within that" };
  const before = new Set(s.sketch.entities.map((e) => e.id));
  // A typed angle that is not a multiple of 90° keeps its exact direction (no automatic H / V).
  const keepAngle = tool === "line" && t1 !== null && t1 !== undefined && Math.abs(Math.round(t1 / 90) * 90 - t1) > 1e-12;
  const r = click(keepAngle ? { ...s, noAutoHV: true } : s, to.x, to.y, 1e-9 * Math.max(1, Math.abs(to.x), Math.abs(to.y)));
  if (!r.ok) return { ok: false, state: st, reason: r.reason };
  let out: EditState = { ...r.state };
  delete out.noAutoHV;
  const made = out.sketch.entities.filter((e) => !before.has(e.id));
  let refused: string | null = null;
  const dim = (id: string | undefined, text: string): void => {
    if (!id || refused) return;
    const d = applyDimension({ ...out, selection: [id] }, text);
    if (d.ok) out = { ...d.state, selection: [], pending: out.pending };
    else refused = d.reason;
  };
  // Construction geometry is dimensioned too (as a typed circle always was).
  const lines = made.filter((e): e is Extract<typeof e, { kind: "line" }> => e.kind === "line");
  const isH = (l: (typeof lines)[number]): boolean => Math.abs(P(out.sketch, l.a).y - P(out.sketch, l.b).y) < 1e-9;
  if (tool === "rectangle" || tool === "centreRectangle") {
    if (t0 !== null && t0 !== undefined) dim(lines.find(isH)?.id, exact(t0));
    if (t1 !== null && t1 !== undefined) dim(lines.find((l) => !isH(l))?.id, exact(t1));
  } else if (tool === "line") {
    if (t0 !== null && t0 !== undefined) dim(lines[0]?.id, exact(t0));
  } else if (t0 !== null && t0 !== undefined) dim(made.find((e) => e.kind === "circle")?.id, `Ø${exact(t0)}`);
  if (refused) return { ok: false, state: st, reason: refused };
  return { ok: true, state: out };
}

// ---- prompts ---------------------------------------------------------------------------------

/** What to do next, in the words a Solid Edge prompt bar would use. */
export function promptFor(st: EditState, dimensionTool = false): string {
  if (dimensionTool) return "Smart Dimension: click a line, circle or arc (or two lines for an angle), type the value, press Enter.";
  const n = st.pending.length;
  switch (st.tool) {
    case "select":
      return "Select: click to select, drag a point to move it. Wheel zooms, middle-drag (or Space + drag) pans.";
    case "line":
      return n ? "Line: click the next point, or type the length (Tab: angle) and press Enter. Right-click or Esc ends the chain." : "Line: click the first point.";
    case "rectangle":
      return n ? "Rectangle: click the opposite corner, or type W and H (Tab between) and press Enter." : "Rectangle: click the first corner — or type W and H first (Tab between), then click where it goes.";
    case "centreRectangle":
      return n ? "Centre rectangle: click a corner, or type W and H and press Enter." : "Centre rectangle: click the centre — or type W and H first, then click the centre.";
    case "circle":
      return n ? "Circle: click a point on it, or type the diameter and press Enter." : "Circle: click the centre — or type the diameter first, then click the centre.";
    case "arc":
      return ["Arc: click the centre.", "Arc: click the start (sets the radius).", "Arc: click the end (counter-clockwise from the start)."][Math.min(n, 2)];
    case "arc3":
      return ["3-point arc: click the start.", "3-point arc: click the end.", "3-point arc: click a point on the arc."][Math.min(n, 2)];
    case "polygon":
      return n ? "Polygon: click a corner." : "Polygon: click the centre (sides in the Sides box).";
    case "slot":
      return ["Slot: click one end's centre.", "Slot: click the other end's centre.", "Slot: click to set the width."][Math.min(n, 2)];
    case "point":
      return "Point: click to place a point.";
    case "trim":
      return "Trim: click the piece of a line to cut away.";
  }
}

const P = (sk: Sketch, id: string): SPoint => sk.points.find((p) => p.id === id)!;
/** Up to 4 decimals, no trailing zeros (for display). */
export const fmt = (v: number): string => String(+v.toFixed(4));
/** The value as typed, to 12 significant digits: what a typed size's dimension holds (not rounded to 4 decimals). */
const exact = (v: number): string => String(+v.toPrecision(12));
