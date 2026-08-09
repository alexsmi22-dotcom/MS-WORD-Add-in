// Draw-to-solve for the Solve geometry canvas.
//
// THE DRAWING IS AN INPUT METHOD, NOT A SECOND GEOMETRY ENGINE. Every gesture
// becomes text in the existing geometry grammar (geometryParse / composite),
// and the solver, the exact arithmetic, the figures and the insert path all
// run on that text exactly as if it had been typed. That keeps one source of
// truth, makes the whole surface testable without a DOM, and — deliberately —
// TEACHES the grammar: the generated request appears in the input box, so a
// user who draws a triangle today can type one tomorrow.
//
// EXACTNESS SURVIVES DRAWING because everything snaps to a half-unit grid:
// a snapped coordinate is x.0 or x.5, whose double is exact, so the rational
// layer downstream sees clean halves (7/2), never float noise.
//
// All state is immutable-ish plain data; the dialog owns a current state and
// replaces it through these functions.

export type DrawTool = "select" | "triangle" | "rectangle" | "circle" | "polygon" | "segment";

export interface DrawPt { x: number; y: number }

export type DrawShape =
  | { kind: "triangle"; pts: [DrawPt, DrawPt, DrawPt] }
  | { kind: "polygon"; pts: DrawPt[] }
  | { kind: "rectangle"; a: DrawPt; b: DrawPt }
  | { kind: "circle"; c: DrawPt; r: number }
  | { kind: "segment"; a: DrawPt; b: DrawPt };

export interface DrawState {
  tool: DrawTool;
  shapes: DrawShape[];
  /** Clicks collected toward the active tool's next shape. */
  pending: DrawPt[];
}

/** The drawing world: x in [0, WORLD_W], y in [0, WORLD_H], y UP. */
export const WORLD_W = 16;
export const WORLD_H = 10;
export const SNAP_STEP = 0.5;

export const emptyDrawState = (tool: DrawTool = "triangle"): DrawState =>
  ({ tool, shapes: [], pending: [] });

export const snap = (v: number): number => Math.round(v / SNAP_STEP) * SNAP_STEP;

export const snapPt = (p: DrawPt): DrawPt => ({
  // NaN in comparisons propagates, so a non-finite coordinate is pinned to 0
  // rather than poisoning every downstream string.
  x: Number.isFinite(p.x) ? Math.min(WORLD_W, Math.max(0, snap(p.x))) : 0,
  y: Number.isFinite(p.y) ? Math.min(WORLD_H, Math.max(0, snap(p.y))) : 0,
});

const samePt = (a: DrawPt, b: DrawPt): boolean => a.x === b.x && a.y === b.y;
const dist = (a: DrawPt, b: DrawPt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** "3" for whole units, "3.5" for halves — never float tails. */
export const fmtN = (v: number): string => String(Math.round(v * 2) / 2);
const fmtPt = (p: DrawPt): string => `(${fmtN(p.x)},${fmtN(p.y)})`;

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

export function setTool(state: DrawState, tool: DrawTool): DrawState {
  // Switching tools abandons an unfinished shape — half a triangle is not a
  // thing the solver should ever see.
  return { ...state, tool, pending: [] };
}

/** A click on the surface (already in world coordinates; snapping is ours). */
export function clickAt(state: DrawState, raw: DrawPt): DrawState {
  const p = snapPt(raw);
  const { tool } = state;
  if (tool === "select") return state;

  const pending = [...state.pending];
  // A repeated click on the same snapped point is a no-op, not a degenerate
  // vertex waiting to happen.
  if (pending.length && samePt(pending[pending.length - 1], p)) return state;
  pending.push(p);

  if (tool === "triangle" && pending.length === 3) {
    if (collinearish(pending)) return { ...state, pending: pending.slice(0, 2) };
    return { ...state, pending: [], shapes: [...state.shapes, { kind: "triangle", pts: pending as [DrawPt, DrawPt, DrawPt] }] };
  }
  if (tool === "rectangle" && pending.length === 2) {
    const [a, b] = pending;
    if (a.x === b.x || a.y === b.y) return { ...state, pending: [a] }; // zero width/height — wait for a real corner
    return { ...state, pending: [], shapes: [...state.shapes, { kind: "rectangle", a, b }] };
  }
  if (tool === "circle" && pending.length === 2) {
    // The radius is capped so the grip handle stays reachable inside the
    // world — an off-world grip is a handle that silently died.
    const r = Math.min(snap(dist(pending[0], pending[1])), maxGripR(pending[0]));
    if (!(r > 0)) return { ...state, pending: [pending[0]] };
    return { ...state, pending: [], shapes: [...state.shapes, { kind: "circle", c: pending[0], r }] };
  }
  if (tool === "segment" && pending.length === 2) {
    return { ...state, pending: [], shapes: [...state.shapes, { kind: "segment", a: pending[0], b: pending[1] }] };
  }
  // polygon accumulates until closePolygon().
  return { ...state, pending };
}

/** Closes a pending polygon (double-click / the Close button). */
export function closePolygon(state: DrawState): DrawState {
  if (state.tool !== "polygon") return state;
  let pts = state.pending;
  if (pts.length > 1 && samePt(pts[0], pts[pts.length - 1])) pts = pts.slice(0, -1);
  if (pts.length < 3) return state;
  return { ...state, pending: [], shapes: [...state.shapes, { kind: "polygon", pts }] };
}

/** Undo: last pending click first, then the last completed shape. */
export function undo(state: DrawState): DrawState {
  if (state.pending.length) return { ...state, pending: state.pending.slice(0, -1) };
  if (state.shapes.length) return { ...state, shapes: state.shapes.slice(0, -1) };
  return state;
}

export const clearAll = (state: DrawState): DrawState => ({ ...state, shapes: [], pending: [] });

function collinearish(pts: DrawPt[]): boolean {
  if (pts.length < 3) return false;
  const [a, b, c] = pts;
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-9;
}

/**
 * Does the closed polygon cross itself (or repeat a vertex)? Grid coordinates
 * are halves, exact in doubles, so the orientation tests here are exact.
 *
 * WHY THIS EXISTS: the shoelace formula on a bowtie returns the SIGNED area —
 * mathematically defined, but not the area of the painted region, and the
 * surface fills the region. A picture asserting an area the emitted request
 * does not compute is exactly what this module must never produce.
 */
export function polygonSelfIntersects(pts: DrawPt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (samePt(pts[i], pts[j])) return true;
    }
  }
  const orient = (a: DrawPt, b: DrawPt, c: DrawPt): number =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const onSeg = (a: DrawPt, b: DrawPt, q: DrawPt): boolean =>
    orient(a, b, q) === 0 &&
    Math.min(a.x, b.x) <= q.x && q.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= q.y && q.y <= Math.max(a.y, b.y);
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share a vertex by construction; skip them.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      const o1 = orient(a1, a2, b1), o2 = orient(a1, a2, b2);
      const o3 = orient(b1, b2, a1), o4 = orient(b1, b2, a2);
      if (o1 !== o2 && o3 !== o4) return true; // proper crossing
      if (onSeg(a1, a2, b1) || onSeg(a1, a2, b2) || onSeg(b1, b2, a1) || onSeg(b1, b2, a2)) return true;
    }
  }
  return false;
}

/** The largest radius whose compass grip still lies inside the world. */
const maxGripR = (c: DrawPt): number =>
  Math.max(c.x, WORLD_W - c.x, c.y, WORLD_H - c.y);

/** The radius grip, on the first compass side that fits inside the world. */
export function circleGrip(c: DrawPt, r: number): DrawPt {
  if (c.x + r <= WORLD_W) return { x: c.x + r, y: c.y };
  if (c.x - r >= 0) return { x: c.x - r, y: c.y };
  if (c.y + r <= WORLD_H) return { x: c.x, y: c.y + r };
  return { x: c.x, y: c.y - r };
}

// ---------------------------------------------------------------------------
// Editing (Select tool): every shape exposes draggable handles.
// ---------------------------------------------------------------------------

export interface HandleRef { shape: number; handle: number }

/** All handles of a shape, in a stable order the drag code can index. */
export function handlesOf(s: DrawShape): DrawPt[] {
  switch (s.kind) {
    case "triangle": return [...s.pts];
    case "polygon": return [...s.pts];
    case "rectangle": return [s.a, s.b];
    // The circle's handles: its centre, then a radius grip on whichever
    // compass side still lies inside the world (a big circle near the east
    // wall keeps a WEST grip — a grip off-world is unreachable and invisible).
    case "circle": return [s.c, circleGrip(s.c, s.r)];
    case "segment": return [s.a, s.b];
  }
}

export function hitHandle(state: DrawState, raw: DrawPt, tol = 0.4): HandleRef | null {
  // Later shapes sit visually on top, so search from the end.
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const hs = handlesOf(state.shapes[i]);
    for (let h = 0; h < hs.length; h++) {
      if (dist(hs[h], raw) <= tol) return { shape: i, handle: h };
    }
  }
  return null;
}

export function dragHandle(state: DrawState, ref: HandleRef, raw: DrawPt): DrawState {
  const p = snapPt(raw);
  const shapes = state.shapes.slice();
  const s = shapes[ref.shape];
  if (!s) return state;
  switch (s.kind) {
    case "triangle": {
      const pts = s.pts.slice() as [DrawPt, DrawPt, DrawPt];
      const others = pts.filter((_, i) => i !== ref.handle);
      if (others.some((q) => samePt(q, p))) return state; // no collapsing two vertices
      pts[ref.handle] = p;
      if (collinearish(pts)) return state;
      shapes[ref.shape] = { kind: "triangle", pts };
      break;
    }
    case "polygon": {
      const pts = s.pts.slice();
      if (pts.some((q, i) => i !== ref.handle && samePt(q, p))) return state;
      pts[ref.handle] = p;
      shapes[ref.shape] = { kind: "polygon", pts };
      break;
    }
    case "rectangle": {
      const a = ref.handle === 0 ? p : s.a;
      const b = ref.handle === 1 ? p : s.b;
      if (a.x === b.x || a.y === b.y) return state;
      shapes[ref.shape] = { kind: "rectangle", a, b };
      break;
    }
    case "circle": {
      if (ref.handle === 0) {
        // A centre move that would strand the radius grip outside the world
        // on every compass side is refused, like any other breaking drag.
        if (s.r > maxGripR(p)) return state;
        shapes[ref.shape] = { kind: "circle", c: p, r: s.r };
      } else {
        const r = Math.min(snap(dist(s.c, p)), maxGripR(s.c));
        if (!(r > 0)) return state;
        shapes[ref.shape] = { kind: "circle", c: s.c, r };
      }
      break;
    }
    case "segment": {
      const a = ref.handle === 0 ? p : s.a;
      const b = ref.handle === 1 ? p : s.b;
      if (samePt(a, b)) return state;
      shapes[ref.shape] = { kind: "segment", a, b };
      break;
    }
  }
  return { ...state, shapes };
}

// ---------------------------------------------------------------------------
// DSL emission — the whole point.
// ---------------------------------------------------------------------------

const rectDims = (s: Extract<DrawShape, { kind: "rectangle" }>): { w: number; h: number } =>
  ({ w: Math.abs(s.a.x - s.b.x), h: Math.abs(s.a.y - s.b.y) });

/** Is `inner` entirely inside `base`? Conservative and exact on the grid. */
function insideBase(base: DrawShape, inner: DrawShape): boolean {
  if (base.kind === "rectangle") {
    const x0 = Math.min(base.a.x, base.b.x), x1 = Math.max(base.a.x, base.b.x);
    const y0 = Math.min(base.a.y, base.b.y), y1 = Math.max(base.a.y, base.b.y);
    if (inner.kind === "circle") {
      return inner.c.x - inner.r > x0 && inner.c.x + inner.r < x1 &&
             inner.c.y - inner.r > y0 && inner.c.y + inner.r < y1;
    }
    if (inner.kind === "rectangle") {
      const ix0 = Math.min(inner.a.x, inner.b.x), ix1 = Math.max(inner.a.x, inner.b.x);
      const iy0 = Math.min(inner.a.y, inner.b.y), iy1 = Math.max(inner.a.y, inner.b.y);
      return ix0 > x0 && ix1 < x1 && iy0 > y0 && iy1 < y1;
    }
    return false;
  }
  if (base.kind === "circle") {
    if (inner.kind === "circle") return dist(base.c, inner.c) + inner.r < base.r;
    if (inner.kind === "rectangle") {
      const corners: DrawPt[] = [inner.a, { x: inner.a.x, y: inner.b.y }, inner.b, { x: inner.b.x, y: inner.a.y }];
      return corners.every((q) => dist(base.c, q) < base.r);
    }
    return false;
  }
  return false;
}

/** Overlap tests for cutout pairs — touching (zero shared area) is fine. */
function shapesOverlap(a: DrawShape, b: DrawShape): boolean {
  if (a.kind === "circle" && b.kind === "circle") return dist(a.c, b.c) < a.r + b.r;
  if (a.kind === "rectangle" && b.kind === "rectangle") {
    const ax0 = Math.min(a.a.x, a.b.x), ax1 = Math.max(a.a.x, a.b.x);
    const ay0 = Math.min(a.a.y, a.b.y), ay1 = Math.max(a.a.y, a.b.y);
    const bx0 = Math.min(b.a.x, b.b.x), bx1 = Math.max(b.a.x, b.b.x);
    const by0 = Math.min(b.a.y, b.b.y), by1 = Math.max(b.a.y, b.b.y);
    return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
  }
  const circle = (a.kind === "circle" ? a : b) as Extract<DrawShape, { kind: "circle" }>;
  const rect = (a.kind === "circle" ? b : a) as Extract<DrawShape, { kind: "rectangle" }>;
  const x0 = Math.min(rect.a.x, rect.b.x), x1 = Math.max(rect.a.x, rect.b.x);
  const y0 = Math.min(rect.a.y, rect.b.y), y1 = Math.max(rect.a.y, rect.b.y);
  const qx = Math.min(x1, Math.max(x0, circle.c.x));
  const qy = Math.min(y1, Math.max(y0, circle.c.y));
  return dist(circle.c, { x: qx, y: qy }) < circle.r;
}

/**
 * The ONE decision about how multiple shapes read, shared by the emitter and
 * the painter so the surface can never color a reading the solver won't make:
 *   "composite" — base with disjoint cutouts fully inside it;
 *   "overlap"   — would be a composite, but cutouts overlap EACH OTHER, and
 *                 `minus` would subtract the shared region twice — refused;
 *   null        — no composite reading at all.
 */
export function compositeReading(shapes: DrawShape[]): "composite" | "overlap" | null {
  if (shapes.length < 2) return null;
  const base = shapes[0];
  if (base.kind !== "rectangle" && base.kind !== "circle") return null;
  const rest = shapes.slice(1);
  if (!rest.every((s) => (s.kind === "rectangle" || s.kind === "circle") && insideBase(base, s))) return null;
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      if (shapesOverlap(rest[i], rest[j])) return "overlap";
    }
  }
  return "composite";
}

export interface EmittedDsl {
  text: string;
  /** Guidance shown next to the surface — why the reading is what it is. */
  note: string;
}

/**
 * Turns the drawing into a request in the geometry grammar.
 *
 * One shape maps to its natural request. A rectangle-or-circle BASE with
 * rectangle/circle shapes fully inside it maps to a COMPOSITE (base minus
 * cutouts) — the dims are read exactly off the snapped grid, so nothing is
 * fabricated. Anything more exotic keeps the FIRST shape and says so, rather
 * than guessing at a relationship the drawing does not determine.
 */
export function emitDsl(state: DrawState): EmittedDsl {
  const shapes = state.shapes;
  if (!shapes.length) {
    return { text: "", note: "Click to draw — the request writes itself below, and the solver runs live." };
  }

  // Two segments are a LINE INTERSECTION question, which beats answering each
  // segment separately.
  if (shapes.length === 2 && shapes[0].kind === "segment" && shapes[1].kind === "segment") {
    const [s1, s2] = shapes as [Extract<DrawShape, { kind: "segment" }>, Extract<DrawShape, { kind: "segment" }>];
    return {
      text: `line ${fmtPt(s1.a)} ${fmtPt(s1.b)} ${fmtPt(s2.a)} ${fmtPt(s2.b)}`,
      note: "Two segments read as two lines — slope and intersection (or parallel, named).",
    };
  }

  // Composite: base + cutouts strictly inside it, DISJOINT from each other.
  const reading = compositeReading(shapes);
  if (reading === "composite") {
    const base = shapes[0] as Extract<DrawShape, { kind: "rectangle" | "circle" }>;
    const rest = shapes.slice(1);
    const baseTxt = base.kind === "rectangle"
      ? `rectangle ${fmtN(rectDims(base).w)} x ${fmtN(rectDims(base).h)}`
      : `circle r=${fmtN(base.r)}`;
    const cuts = rest.map((s) =>
      s.kind === "circle"
        ? `minus circle r=${fmtN(s.r)}`
        : `minus rectangle ${fmtN(rectDims(s as Extract<DrawShape, { kind: "rectangle" }>).w)} x ${fmtN(rectDims(s as Extract<DrawShape, { kind: "rectangle" }>).h)}`
    );
    return {
      text: `${baseTxt} ${cuts.join(" ")}`,
      note: "Shapes inside the base read as CUTOUTS — the composite area is solved with them removed.",
    };
  }
  if (reading === "overlap") {
    // Subtracting overlapping cutouts counts the shared region twice. The
    // surface KNOWS they overlap — it drew them — so it refuses the reading
    // rather than emitting arithmetic the picture contradicts.
    return {
      ...single(shapes[0]),
      note: "The cutouts OVERLAP each other, and subtracting both would remove the shared region twice — so only the first shape is being solved. Drag them apart to get the composite.",
    };
  }

  if (shapes.length > 1) {
    return {
      ...single(shapes[0]),
      note: "Only the FIRST shape is being solved. For a composite, draw a rectangle or circle base and put rectangle/circle cutouts fully inside it; otherwise solve one shape at a time.",
    };
  }
  return single(shapes[0]);
}

function single(s: DrawShape): EmittedDsl {
  switch (s.kind) {
    case "triangle":
      return {
        text: `triangle ${s.pts.map(fmtPt).join(" ")}`,
        note: "Solved from the drawn vertices — sides, angles, area, centres. Drag a vertex to change it.",
      };
    case "polygon":
      if (polygonSelfIntersects(s.pts)) {
        // The shoelace area of a self-crossing loop is the SIGNED value, not
        // the painted region — the request is withheld until the drawing is a
        // simple polygon, and the surface paints the warning.
        return {
          text: "",
          note: "This polygon CROSSES ITSELF, so the shoelace area would not be the area of the painted region. Drag the vertices apart (Select) or redraw it without crossings.",
        };
      }
      return {
        text: `polygon ${s.pts.map(fmtPt).join(" ")}`,
        note: "Area by the shoelace formula (exact), perimeter, centroid, convexity.",
      };
    case "rectangle": {
      const { w, h } = rectDims(s);
      return {
        text: `rectangle a=${fmtN(w)} b=${fmtN(h)}`,
        note: "Area, perimeter and diagonal from the drawn width and height.",
      };
    }
    case "circle":
      return {
        text: `circle r=${fmtN(s.r)}`,
        note: "Area and circumference from the drawn radius (drag the east grip to resize).",
      };
    case "segment":
      return {
        text: `distance ${fmtPt(s.a)} ${fmtPt(s.b)}`,
        note: "The distance between the endpoints. Draw a SECOND segment to intersect two lines.",
      };
  }
}

/** One status line describing where the current gesture stands. */
export function describePending(state: DrawState): string {
  const n = state.pending.length;
  switch (state.tool) {
    case "select": return state.shapes.length ? "Drag a handle to reshape — the numbers follow." : "Nothing to select yet — draw a shape first.";
    case "triangle": return n === 0 ? "Triangle: click the first vertex." : `Triangle: ${n} of 3 vertices.`;
    case "rectangle": return n === 0 ? "Rectangle: click one corner." : "Rectangle: click the opposite corner.";
    case "circle": return n === 0 ? "Circle: click the centre." : "Circle: click a point on the rim.";
    case "polygon": return n === 0 ? "Polygon: click vertices, then double-click (or Close) to finish."
      : `Polygon: ${n} vert${n === 1 ? "ex" : "ices"} — double-click or Close to finish.`;
    case "segment": return n === 0 ? "Segment: click the first endpoint." : "Segment: click the second endpoint.";
  }
}

// ---------------------------------------------------------------------------
// The drawing surface as SVG — a pure function of state, so it is testable.
// ---------------------------------------------------------------------------

const PX_PER_UNIT = 36;
/** A grid-free strip below the canvas for the coordinate readout — text laid
 *  over the grid always crosses a grid line, and the layout gate rightly
 *  refuses a label with a line through it. */
const FOOTER_H = 22;
export const DRAW_VIEW = { w: WORLD_W * PX_PER_UNIT, h: WORLD_H * PX_PER_UNIT + FOOTER_H };

const GRID_MINOR = "#eef1f4";
const GRID_MAJOR = "#dde3e9";
const SHAPE_EDGE = "#0c4a6e";
const SHAPE_FILL = "rgba(12,74,110,0.08)";
const CUT_EDGE = "#b91c1c";
const CUT_FILL = "rgba(185,28,28,0.10)";
const PEND = "#b45309";
const HANDLE = "#0c4a6e";

const X = (x: number): number => x * PX_PER_UNIT;
const Y = (y: number): number => (WORLD_H - y) * PX_PER_UNIT;

function shapeSvg(s: DrawShape, cut: boolean): string {
  const edge = cut ? CUT_EDGE : SHAPE_EDGE;
  const fill = cut ? CUT_FILL : SHAPE_FILL;
  switch (s.kind) {
    case "triangle":
    case "polygon": {
      const d = s.pts.map((p, i) => `${i ? "L" : "M"}${X(p.x)} ${Y(p.y)}`).join(" ") + " Z";
      // A self-crossing polygon is NOT painted as an enclosed region — a fill
      // would assert an area the withheld request does not compute.
      if (s.kind === "polygon" && polygonSelfIntersects(s.pts)) {
        return `<path d="${d}" fill="none" stroke="${CUT_EDGE}" stroke-width="2" stroke-dasharray="6 4"/>`;
      }
      return `<path d="${d}" fill="${fill}" stroke="${edge}" stroke-width="2"/>`;
    }
    case "rectangle": {
      const x0 = Math.min(s.a.x, s.b.x), y1 = Math.max(s.a.y, s.b.y);
      const { w, h } = rectDims(s);
      return `<rect x="${X(x0)}" y="${Y(y1)}" width="${w * PX_PER_UNIT}" height="${h * PX_PER_UNIT}" fill="${fill}" stroke="${edge}" stroke-width="2"/>`;
    }
    case "circle":
      return `<circle cx="${X(s.c.x)}" cy="${Y(s.c.y)}" r="${s.r * PX_PER_UNIT}" fill="${fill}" stroke="${edge}" stroke-width="2"/>`;
    case "segment":
      return `<line x1="${X(s.a.x)}" y1="${Y(s.a.y)}" x2="${X(s.b.x)}" y2="${Y(s.b.y)}" stroke="${edge}" stroke-width="2"/>`;
  }
}

/**
 * Renders the whole surface. `hover` (snapped) draws the crosshair and the
 * rubber preview of the in-progress shape.
 */
export function renderDrawSvg(state: DrawState, hover: DrawPt | null): string {
  // The dialog always snaps before calling, but this is the exported API:
  // a non-finite hover renders as no hover, never as "(NaN, NaN)".
  if (hover && !(Number.isFinite(hover.x) && Number.isFinite(hover.y))) hover = null;
  const { w: W, h: H } = DRAW_VIEW;
  const GRID_H = WORLD_H * PX_PER_UNIT;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;touch-action:none">`);
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // Grid: half-unit minor, whole-unit major — the same grid the snap uses.
  for (let x = 0; x <= WORLD_W; x += SNAP_STEP) {
    p.push(`<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${GRID_H}" stroke="${x % 1 === 0 ? GRID_MAJOR : GRID_MINOR}" stroke-width="1"/>`);
  }
  for (let y = 0; y <= WORLD_H; y += SNAP_STEP) {
    p.push(`<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="${y % 1 === 0 ? GRID_MAJOR : GRID_MINOR}" stroke-width="1"/>`);
  }

  // Which shapes are reading as cutouts right now? THE SAME function the
  // emitter uses decides — the surface can never color a reading the solver
  // will not make, including the overlapping-cutouts refusal.
  const cut = compositeReading(state.shapes) === "composite";
  state.shapes.forEach((s, i) => p.push(shapeSvg(s, cut && i > 0)));

  // Handles.
  for (const s of state.shapes) {
    for (const hnd of handlesOf(s)) {
      p.push(`<rect x="${X(hnd.x) - 4}" y="${Y(hnd.y) - 4}" width="8" height="8" fill="#ffffff" stroke="${HANDLE}" stroke-width="1.5"/>`);
    }
  }

  // Pending clicks + rubber preview toward the hover point.
  for (const q of state.pending) {
    p.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="4" fill="${PEND}"/>`);
  }
  if (state.pending.length && hover) {
    const last = state.pending[state.pending.length - 1];
    if (state.tool === "circle") {
      const r = dist(state.pending[0], hover);
      if (r > 0) p.push(`<circle cx="${X(state.pending[0].x)}" cy="${Y(state.pending[0].y)}" r="${r * PX_PER_UNIT}" fill="none" stroke="${PEND}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    } else if (state.tool === "rectangle") {
      const x0 = Math.min(state.pending[0].x, hover.x), y1 = Math.max(state.pending[0].y, hover.y);
      const w = Math.abs(state.pending[0].x - hover.x), h = Math.abs(state.pending[0].y - hover.y);
      p.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${w * PX_PER_UNIT}" height="${h * PX_PER_UNIT}" fill="none" stroke="${PEND}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    } else {
      p.push(`<line x1="${X(last.x)}" y1="${Y(last.y)}" x2="${X(hover.x)}" y2="${Y(hover.y)}" stroke="${PEND}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
      // The polygon preview also closes back to the first vertex.
      if (state.tool === "polygon" && state.pending.length >= 2) {
        p.push(`<line x1="${X(hover.x)}" y1="${Y(hover.y)}" x2="${X(state.pending[0].x)}" y2="${Y(state.pending[0].y)}" stroke="${PEND}" stroke-width="1" stroke-dasharray="2 4"/>`);
      }
    }
  }

  // Crosshair on the canvas; the coordinate readout lives in the grid-free
  // footer strip, where no line can cross it.
  if (hover) {
    p.push(`<circle cx="${X(hover.x)}" cy="${Y(hover.y)}" r="3.5" fill="none" stroke="${PEND}" stroke-width="1.5"/>`);
    p.push(`<text x="6" y="${GRID_H + FOOTER_H - 7}" font-family="sans-serif" font-size="12" fill="#555">(${fmtN(hover.x)}, ${fmtN(hover.y)})</text>`);
  }

  p.push("</svg>");
  return p.join("");
}
