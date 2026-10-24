/**
 * The sketch canvas's decisions (docs/SCOPE-CAD-R2.md, R2a) — tools, snapping,
 * relations and dimensions applied to a selection, deleting, dragging, the
 * status line, and dimension text — as pure functions over the sketch, so the
 * DOM controller (taskpane/sketchPane.ts) only wires events. Every change goes
 * through the verified solver (sketch.ts); a refusal leaves the sketch as it was
 * and says why.
 */
import {
  Sketch,
  SConstraint,
  SEntity,
  SPoint,
  addConstraint,
  dragPoint,
  freedom,
  measure,
  setDimension,
  solve,
  radiusOf,
  sketchScale,
  describe,
  DIMENSION_KINDS,
  Freedom,
} from "./sketch";
import { polygon, slot, centreRectangle, arc3, trim } from "./sketchTools";

/** A relation or dimension before it has an id (distributive, unlike Omit on a union). */
export type ConstraintSpec = SConstraint extends infer T ? (T extends unknown ? Omit<T, "id"> : never) : never;

export type SketchTool = "select" | "line" | "rectangle" | "circle" | "arc" | "point" | "polygon" | "slot" | "centreRectangle" | "arc3" | "trim";

export interface EditState {
  sketch: Sketch;
  tool: SketchTool;
  /** Points clicked so far for the tool in progress (sketch coordinates). */
  pending: Array<{ x: number; y: number; snap?: string }>;
  /** Selected point and entity ids. */
  selection: string[];
  /** Whether new geometry is construction. */
  construction: boolean;
  /** Sides for the polygon tool. */
  sides?: number;
  /** The next line keeps its exact direction (a typed angle): no automatic H / V. */
  noAutoHV?: boolean;
  /** Counter for fresh ids. */
  seq: number;
}

export type EditResult = { ok: true; state: EditState; note?: string } | { ok: false; state: EditState; reason: string };

export const emptySketch = (): Sketch => ({ points: [], entities: [], constraints: [] });

export function startEdit(sketch: Sketch = emptySketch()): EditState {
  const ids = [...sketch.points, ...sketch.entities, ...sketch.constraints].map((x) => Number(/(\d+)$/.exec(x.id)?.[1] ?? 0));
  return { sketch, tool: "line", pending: [], selection: [], construction: false, seq: Math.max(0, ...ids) + 1 };
}

const nid = (st: EditState, prefix: string): [string, EditState] => [`${prefix}${st.seq}`, { ...st, seq: st.seq + 1 }];

// ---- picking and snapping -----------------------------------------------------------------

const P = (sk: Sketch, id: string): SPoint => sk.points.find((p) => p.id === id)!;

/** The nearest existing point within `tol`, if any. */
export function snapPoint(sk: Sketch, x: number, y: number, tol: number): string | null {
  let best: string | null = null, bd = tol;
  for (const p of sk.points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bd) [best, bd] = [p.id, d];
  }
  return best;
}

function distToSeg(px: number, py: number, a: SPoint, b: SPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + t * dx - px, a.y + t * dy - py);
}

/** What is under (x, y): a point first, then the nearest line / circle / arc, within `tol`. */
export function pick(sk: Sketch, x: number, y: number, tol: number): string | null {
  const p = snapPoint(sk, x, y, tol);
  if (p) return p;
  let best: string | null = null, bd = tol;
  for (const e of sk.entities) {
    let d: number;
    if (e.kind === "line") d = distToSeg(x, y, P(sk, e.a), P(sk, e.b));
    else {
      const c = P(sk, e.c), r = radiusOf(sk, e.id);
      d = Math.abs(Math.hypot(x - c.x, y - c.y) - r);
      if (e.kind === "arc") {
        // Only on the drawn part of the arc.
        const a = P(sk, e.a), b = P(sk, e.b);
        const ang = (q: { x: number; y: number }): number => Math.atan2(q.y - c.y, q.x - c.x);
        let s = ang(b) - ang(a), t = ang({ x, y }) - ang(a);
        while (s <= 0) s += 2 * Math.PI;
        while (t < 0) t += 2 * Math.PI;
        if (t > s) d = Infinity;
      }
    }
    if (d <= bd) [best, bd] = [e.id, d];
  }
  return best;
}

// ---- tools ------------------------------------------------------------------------------

/** A point at (x, y): an existing one if it snaps, else a new one. */
function pointAt(st: EditState, x: number, y: number, snap: string | undefined): [string, EditState] {
  if (snap) return [snap, st];
  const [id, s2] = nid(st, "p");
  return [id, { ...s2, sketch: { ...s2.sketch, points: [...s2.sketch.points, { id, x, y }] } }];
}

const addEntity = (st: EditState, e: SEntity): EditState => ({ ...st, sketch: { ...st.sketch, entities: [...st.sketch.entities, e] } });
const withCon = (e: SEntity, construction: boolean): SEntity => (construction ? { ...e, construction: true } : e);

/** Adds a relation the tool infers; a refusal (e.g. redundant) just means it is not added. */
function tryRelation(st: EditState, c: ConstraintSpec): EditState {
  const [id, s2] = nid(st, "k");
  const r = addConstraint(s2.sketch, { ...c, id } as SConstraint);
  return r.ok ? { ...s2, sketch: r.sketch } : st;
}

/** Within 2° of horizontal / vertical: the line gets that relation as it is drawn. */
function autoHV(st: EditState, line: string): EditState {
  const e = st.sketch.entities.find((x) => x.id === line);
  if (!e || e.kind !== "line") return st;
  const a = P(st.sketch, e.a), b = P(st.sketch, e.b);
  const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x));
  const near = (t: number): boolean => Math.abs(ang - t) < (2 * Math.PI) / 180;
  if (near(0) || near(Math.PI)) return tryRelation(st, { kind: "horizontal", line } as ConstraintSpec);
  if (near(Math.PI / 2)) return tryRelation(st, { kind: "vertical", line } as ConstraintSpec);
  return st;
}

/** A click with the current tool at (x, y); `tol` is the snapping distance in sketch units. */
export function click(st0: EditState, x: number, y: number, tol: number): EditResult {
  const st = { ...st0 };
  const snap = snapPoint(st.sketch, x, y, tol) ?? undefined;
  const here = { x: snap ? P(st.sketch, snap).x : x, y: snap ? P(st.sketch, snap).y : y, snap };
  // The tools in sketchTools take their clicks here and build when they have them all.
  const need: Partial<Record<SketchTool, number>> = { polygon: 2, slot: 3, centreRectangle: 2, arc3: 3 };
  const n = need[st.tool];
  if (n) {
    const pend = [...st.pending, here];
    if (pend.length < n) return { ok: true, state: { ...st, pending: pend } };
    const [p0, p1, p2] = pend;
    const snaps = pend.map((q) => q.snap);
    const r =
      st.tool === "polygon" ? polygon(st, p0.x, p0.y, p1.x, p1.y, st.sides ?? 6, snaps)
      : st.tool === "slot" ? slot(st, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, snaps)
      : st.tool === "centreRectangle" ? centreRectangle(st, p0.x, p0.y, p1.x, p1.y, snaps)
      : arc3(st, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, snaps);
    return r.ok ? r : { ok: false, state: { ...st, pending: [] }, reason: r.reason };
  }
  if (st.tool === "trim") {
    const hit = pick(st.sketch, x, y, tol);
    if (!hit || !st.sketch.entities.some((e) => e.id === hit)) return { ok: false, state: st, reason: "click on the part of a line to trim away" };
    return trim(st, hit, x, y);
  }
  switch (st.tool) {
    case "select": {
      const hit = pick(st.sketch, x, y, tol);
      return { ok: true, state: { ...st, selection: hit ? (st.selection.includes(hit) ? st.selection.filter((s) => s !== hit) : [...st.selection, hit]) : [] } };
    }
    case "point": {
      if (snap) return { ok: true, state: st };
      const [, s2] = pointAt(st, x, y, undefined);
      return { ok: true, state: s2 };
    }
    case "line": {
      if (!st.pending.length) return { ok: true, state: { ...st, pending: [here] } };
      const first = st.pending[0];
      if (Math.hypot(here.x - first.x, here.y - first.y) <= tol) return { ok: false, state: st, reason: "a line needs two different points" };
      let [a, s2] = pointAt(st, first.x, first.y, first.snap);
      let b: string;
      [b, s2] = pointAt(s2, here.x, here.y, here.snap);
      let id: string;
      [id, s2] = nid(s2, "L");
      s2 = addEntity(s2, withCon({ id, kind: "line", a, b }, s2.construction));
      if (!s2.noAutoHV) s2 = autoHV(s2, id);
      // Chain: the next line starts where this one ended.
      return { ok: true, state: { ...s2, pending: [{ x: here.x, y: here.y, snap: b }] } };
    }
    case "rectangle": {
      if (!st.pending.length) return { ok: true, state: { ...st, pending: [here] } };
      const f = st.pending[0];
      if (Math.abs(here.x - f.x) <= tol || Math.abs(here.y - f.y) <= tol) return { ok: false, state: st, reason: "a rectangle needs width and height — drag the second corner away" };
      let s2: EditState = { ...st, pending: [] };
      const corners: string[] = [];
      for (const [cx, cy, sn] of [[f.x, f.y, f.snap], [here.x, f.y, undefined], [here.x, here.y, here.snap], [f.x, here.y, undefined]] as Array<[number, number, string | undefined]>) {
        let id: string;
        [id, s2] = pointAt(s2, cx, cy, sn);
        corners.push(id);
      }
      const lines: string[] = [];
      for (let i = 0; i < 4; i++) {
        let id: string;
        [id, s2] = nid(s2, "L");
        s2 = addEntity(s2, withCon({ id, kind: "line", a: corners[i], b: corners[(i + 1) % 4] }, s2.construction));
        lines.push(id);
      }
      for (const [i, kind] of [[0, "horizontal"], [1, "vertical"], [2, "horizontal"], [3, "vertical"]] as Array<[number, "horizontal" | "vertical"]>)
        s2 = tryRelation(s2, { kind, line: lines[i] } as ConstraintSpec);
      return { ok: true, state: s2 };
    }
    case "circle": {
      if (!st.pending.length) return { ok: true, state: { ...st, pending: [here] } };
      const c0 = st.pending[0];
      const r = Math.hypot(x - c0.x, y - c0.y);
      if (r <= tol) return { ok: false, state: st, reason: "a circle needs a radius — click farther from the centre" };
      let [c, s2] = pointAt({ ...st, pending: [] }, c0.x, c0.y, c0.snap);
      let id: string;
      [id, s2] = nid(s2, "C");
      return { ok: true, state: addEntity(s2, withCon({ id, kind: "circle", c, r }, s2.construction)) };
    }
    case "arc": {
      // Centre, then start, then a point giving the end's direction (counter-clockwise from the start).
      if (st.pending.length < 2) {
        if (st.pending.length === 1 && Math.hypot(here.x - st.pending[0].x, here.y - st.pending[0].y) <= tol) return { ok: false, state: st, reason: "an arc needs a radius — click farther from the centre" };
        return { ok: true, state: { ...st, pending: [...st.pending, here] } };
      }
      const [c0, a0] = st.pending;
      const r = Math.hypot(a0.x - c0.x, a0.y - c0.y);
      const t = Math.atan2(y - c0.y, x - c0.x);
      const bx = c0.x + r * Math.cos(t), by = c0.y + r * Math.sin(t);
      if (Math.hypot(bx - a0.x, by - a0.y) <= tol) return { ok: false, state: st, reason: "an arc needs two different ends" };
      let s2: EditState = { ...st, pending: [] };
      let c: string, a: string, b: string, id: string;
      [c, s2] = pointAt(s2, c0.x, c0.y, c0.snap);
      [a, s2] = pointAt(s2, a0.x, a0.y, a0.snap);
      // The end lies exactly on the radius (an end snapped elsewhere would break the arc).
      [b, s2] = pointAt(s2, bx, by, undefined);
      [id, s2] = nid(s2, "A");
      return { ok: true, state: addEntity(s2, withCon({ id, kind: "arc", c, a, b }, s2.construction)) };
    }
    default:
      return { ok: true, state: st }; // handled above (the sketchTools tools)
  }
}

/** Escape: abandon the tool in progress. */
export function cancel(st: EditState): EditState {
  return { ...st, pending: [] };
}

// ---- relations and dimensions on the selection ------------------------------------------------

export type RelationKind = "coincident" | "horizontal" | "vertical" | "parallel" | "perpendicular" | "tangent" | "equal" | "concentric" | "midpoint" | "fix" | "onCurve" | "symmetric";

const kindOf = (sk: Sketch, id: string): "point" | "line" | "circle" | "arc" | null =>
  sk.points.some((p) => p.id === id) ? "point" : ((sk.entities.find((e) => e.id === id)?.kind as "line" | "circle" | "arc") ?? null);

/** The relation for the selection, or why it does not apply. */
export function relationFor(sk: Sketch, kind: RelationKind, sel: string[]): ConstraintSpec | string {
  const k = sel.map((id) => kindOf(sk, id));
  const is = (...want: Array<string | string[]>): boolean => want.length === k.length && want.every((w, i) => (Array.isArray(w) ? w.includes(k[i]!) : w === k[i]));
  const curve = ["circle", "arc"];
  switch (kind) {
    case "horizontal":
    case "vertical":
      if (is("line")) return { kind, line: sel[0] } as ConstraintSpec;
      if (is("point", "point")) {
        // Two points level / plumb: a zero horizontal / vertical offset is a relation, kept as a dimension of 0 would be refused.
        return `select one line for ${kind}`;
      }
      return `select one line for ${kind}`;
    case "parallel":
    case "perpendicular":
      return is("line", "line") ? ({ kind, l1: sel[0], l2: sel[1] } as ConstraintSpec) : `select two lines for ${kind}`;
    case "coincident":
      return is("point", "point") ? { kind, p: sel[0], q: sel[1] } : "select two points to make coincident";
    case "fix": {
      if (!is("point")) return "select one point to fix";
      const p = P(sk, sel[0]);
      return { kind, p: sel[0], x: p.x, y: p.y };
    }
    case "midpoint":
      if (is("point", "line")) return { kind, p: sel[0], line: sel[1] };
      if (is("line", "point")) return { kind, p: sel[1], line: sel[0] };
      return "select a point and a line";
    case "onCurve":
      if (is("point", "line")) return { kind: "onLine", p: sel[0], line: sel[1] };
      if (is("line", "point")) return { kind: "onLine", p: sel[1], line: sel[0] };
      if (is("point", curve)) return { kind: "onCircle", p: sel[0], curve: sel[1] };
      if (is(curve, "point")) return { kind: "onCircle", p: sel[1], curve: sel[0] };
      return "select a point and a line, circle or arc";
    case "equal":
      if (is("line", "line") || is(curve, curve)) return { kind, e1: sel[0], e2: sel[1] };
      return "select two lines, or two circles / arcs";
    case "concentric":
      return is(curve, curve) ? { kind, e1: sel[0], e2: sel[1] } : "select two circles or arcs";
    case "symmetric":
      if (is("point", "point", "line")) return { kind, p: sel[0], q: sel[1], line: sel[2] };
      return "select two points and then the line of symmetry";
    case "tangent": {
      if (!(is("line", curve) || is(curve, "line") || is(curve, curve))) return "select a line and a circle / arc, or two circles / arcs";
      // The side / internal-ness as drawn now, so the solve keeps it.
      if (k[0] === "line" || k[1] === "line") {
        const [l, c] = k[0] === "line" ? [sel[0], sel[1]] : [sel[1], sel[0]];
        const le = sk.entities.find((e) => e.id === l) as Extract<SEntity, { kind: "line" }>;
        const ce = sk.entities.find((e) => e.id === c) as Extract<SEntity, { kind: "circle" | "arc" }>;
        const a = P(sk, le.a), b = P(sk, le.b), o = P(sk, ce.c);
        const side = (b.x - a.x) * (o.y - a.y) - (b.y - a.y) * (o.x - a.x) >= 0 ? 1 : -1;
        return { kind, e1: l, e2: c, side } as ConstraintSpec;
      }
      const c1 = sk.entities.find((e) => e.id === sel[0]) as Extract<SEntity, { kind: "circle" | "arc" }>;
      const c2 = sk.entities.find((e) => e.id === sel[1]) as Extract<SEntity, { kind: "circle" | "arc" }>;
      const d = Math.hypot(P(sk, c1.c).x - P(sk, c2.c).x, P(sk, c1.c).y - P(sk, c2.c).y);
      const inner = d < Math.max(radiusOf(sk, c1.id), radiusOf(sk, c2.id));
      return { kind, e1: sel[0], e2: sel[1], inner } as ConstraintSpec;
    }
  }
}

/** Applies a relation to the selection (verified); the selection is cleared on success. */
export function applyRelation(st: EditState, kind: RelationKind): EditResult {
  const c = relationFor(st.sketch, kind, st.selection);
  if (typeof c === "string") return { ok: false, state: st, reason: c };
  const [id, s2] = nid(st, "k");
  const r = addConstraint(s2.sketch, { ...c, id } as SConstraint);
  if (!r.ok) return { ok: false, state: st, reason: r.reason };
  return { ok: true, state: { ...s2, sketch: r.sketch, selection: [] } };
}

/** The dimension a selection suggests, at its current measure (value filled from the sketch). */
export function dimensionFor(sk: Sketch, sel: string[]): ConstraintSpec | string {
  const k = sel.map((id) => kindOf(sk, id));
  const kinds = k.join(",");
  let c: ConstraintSpec;
  if (kinds === "line") c = { kind: "length", line: sel[0], value: 0 };
  else if (kinds === "circle") c = { kind: "diameter", curve: sel[0], value: 0 };
  else if (kinds === "arc") c = { kind: "radius", curve: sel[0], value: 0 };
  else if (kinds === "point,point") c = { kind: "distance", p: sel[0], q: sel[1], value: 0 };
  else if (kinds === "line,line") {
    const sign = signedAngle(sk, sel[0], sel[1]) >= 0 ? 1 : -1;
    c = { kind: "angle", l1: sel[0], l2: sel[1], value: 0, sign } as ConstraintSpec;
  } else if (kinds === "point,line" || kinds === "line,point") {
    const [p, l] = k[0] === "point" ? [sel[0], sel[1]] : [sel[1], sel[0]];
    const le = sk.entities.find((e) => e.id === l) as Extract<SEntity, { kind: "line" }>;
    const a = P(sk, le.a), b = P(sk, le.b), q = P(sk, p);
    const side = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) >= 0 ? 1 : -1;
    c = { kind: "pointLine", p, line: l, value: 0, side } as ConstraintSpec;
  } else return "select a line (length), a circle (diameter), an arc (radius), two points (distance), two lines (angle), or a point and a line";
  const value = measure(sk, { ...c, id: "_", driven: true } as SConstraint);
  return { ...c, value } as ConstraintSpec;
}

function signedAngle(sk: Sketch, l1: string, l2: string): number {
  const e1 = sk.entities.find((e) => e.id === l1) as Extract<SEntity, { kind: "line" }>;
  const e2 = sk.entities.find((e) => e.id === l2) as Extract<SEntity, { kind: "line" }>;
  const a = P(sk, e1.a), b = P(sk, e1.b), p = P(sk, e2.a), q = P(sk, e2.b);
  const ux = b.x - a.x, uy = b.y - a.y, vx = q.x - p.x, vy = q.y - p.y;
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * Dimensions the selection with the typed value (in display form: "20", "Ø20",
 * "R5", "45°"). `asDriven` adds it as a reference dimension (shown, not solved).
 */
export function applyDimension(st: EditState, text: string, asDriven = false): EditResult {
  const c = dimensionFor(st.sketch, st.selection);
  if (typeof c === "string") return { ok: false, state: st, reason: c };
  // A driven (reference) dimension shows what the sketch measures: nothing to type.
  const v = asDriven ? (c as { value: number }).value : parseDimension(text, c.kind);
  if (typeof v === "string") return { ok: false, state: st, reason: v };
  const [id, s2] = nid(st, "d");
  const con = { ...c, id, value: asDriven ? (c as { value: number }).value : v, ...(asDriven ? { driven: true } : {}) } as SConstraint;
  const r = addConstraint(s2.sketch, con);
  if (!r.ok) {
    const hint = r.canDrive ? " Add it as a driven (reference) dimension instead?" : "";
    return { ok: false, state: st, reason: r.reason + "." + hint };
  }
  return { ok: true, state: { ...s2, sketch: r.sketch, selection: [] } };
}

/** Changes an existing dimension's value from typed text. */
export function editDimension(st: EditState, id: string, text: string): EditResult {
  const c = st.sketch.constraints.find((k) => k.id === id);
  if (!c || !DIMENSION_KINDS.has(c.kind)) return { ok: false, state: st, reason: "that is not a dimension" };
  const v = parseDimension(text, c.kind);
  if (typeof v === "string") return { ok: false, state: st, reason: v };
  const r = setDimension(st.sketch, id, v);
  return r.ok ? { ok: true, state: { ...st, sketch: r.sketch } } : { ok: false, state: st, reason: r.reason };
}

// ---- dimension text: display is a contract -------------------------------------------------

/** "20", "Ø20", "R5", "45°" — what a dimension shows (4 significant decimals at most). */
export function formatDimension(c: SConstraint, value = "value" in c ? c.value : NaN): string {
  const n = (v: number): string => (Math.abs(v) > 0 && Math.abs(v) < 0.001 ? `${+v.toPrecision(6)}` : `${+v.toFixed(4)}`);
  const tail = "driven" in c && c.driven ? "" : "";
  switch (c.kind) {
    case "diameter": return `Ø${n(value)}${tail}`;
    case "radius": return `R${n(value)}${tail}`;
    case "angle": return `${n((value * 180) / Math.PI)}°${tail}`;
    default: return `${n(value)}${tail}`;
  }
}

/**
 * A comma decimal ("2,5" → "2.5"), or null when the comma could as well group thousands: one comma followed by
 * exactly three digits ("1,000" — one thousand, or 1.000 mm?). The decimal-comma rule of the Table→Chart reader
 * (tablechart.parseNumberCell) reads "1,000" as a thousand; a DIMENSION cannot guess, so it is refused by name.
 * Whitespace is left as it is (the callers strip what they allow).
 */
export function decimalComma(t: string): string | null {
  if (/^[^,]*\d,\d{3}(?!\d)[^,]*$/.test(t) && !/\./.test(t)) return null;
  return t.replace(",", ".");
}

/** Why a typed size with an ambiguous comma is refused. */
export const AMBIGUOUS_COMMA = (text: string): string => {
  const t = text.trim();
  return `"${t}" is ambiguous — type ${t.replace(",", "")} for a thousand, or ${t.replace(",", ".")} with a point`;
};

/**
 * A typed dimension value: accepts what is displayed ("Ø20", "R5", "45°") and the
 * plain number, a comma decimal ("2,5"), and an "mm" suffix; refuses a mismatched
 * prefix by name (an R on a diameter). Angles return radians.
 */
export function parseDimension(text: string, kind: SConstraint["kind"]): number | string {
  const dc = decimalComma(text.trim().replace(/\s+/g, ""));
  if (dc === null) return AMBIGUOUS_COMMA(text);
  let t = dc;
  if (!t) return "type a value";
  let prefix = "";
  const m = /^(Ø|⌀|ø|R|r)/.exec(t);
  if (m) {
    prefix = m[1] === "r" ? "R" : m[1] === "R" ? "R" : "Ø";
    t = t.slice(m[1].length);
  }
  let deg = false;
  if (/(°|deg)$/i.test(t)) {
    deg = true;
    t = t.replace(/(°|deg)$/i, "");
  }
  t = t.replace(/mm$/i, "");
  if (!/^[+]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t)) return `"${text.trim()}" is not a number`;
  const v = Number(t);
  if (kind === "angle") {
    if (prefix) return "an angle takes degrees, like 45°";
    if (!(v > 0 && v < 180)) return "an angle must be between 0° and 180°";
    return (v * Math.PI) / 180;
  }
  if (deg) return "that dimension is a length, not an angle";
  if (prefix === "R" && kind === "diameter") return "this is a diameter (Ø) — type Ø, or the number alone";
  if (prefix === "Ø" && kind === "radius") return "this is a radius (R) — type R, or the number alone";
  if (prefix && kind !== "radius" && kind !== "diameter") return "this dimension is a length — type the number alone";
  if (!(v > 0)) return "a dimension must be greater than 0 (use a coincident relation for 0)";
  if (v > 1e6) return "that is larger than this canvas draws (1,000,000)";
  return v;
}

// ---- delete, drag, status --------------------------------------------------------------------

/** Deletes the selection: the entities, the relations that use them, and points left unused. */
export function deleteSelection(st: EditState): EditResult {
  if (!st.selection.length) return { ok: false, state: st, reason: "select something to delete" };
  const sel = new Set(st.selection);
  // A selected point takes the geometry built on it.
  const entities = st.sketch.entities.filter((e) => {
    if (sel.has(e.id)) return false;
    const pts = e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b];
    return !pts.some((p) => sel.has(p));
  });
  const live = new Set(entities.map((e) => e.id));
  const used = new Set(entities.flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b])));
  const points = st.sketch.points.filter((p) => !sel.has(p.id) && (used.has(p.id) || !st.sketch.entities.some((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b]).includes(p.id))));
  const pts = new Set(points.map((p) => p.id));
  const refs = (c: SConstraint): string[] => Object.entries(c).filter(([k, v]) => typeof v === "string" && k !== "id" && k !== "kind").map(([, v]) => v as string);
  const constraints = st.sketch.constraints.filter((c) => !sel.has(c.id) && refs(c).every((r) => pts.has(r) || live.has(r)));
  return { ok: true, state: { ...st, selection: [], sketch: { points, entities, constraints } } };
}

/** Drags a point (or a whole line by one end): the solver keeps every relation; refused moves leave it. */
export function drag(st: EditState, point: string, x: number, y: number): EditResult {
  const r = dragPoint(st.sketch, point, x, y);
  return r.ok ? { ok: true, state: { ...st, sketch: r.sketch } } : { ok: false, state: st, reason: r.reason };
}

/** Re-solves the whole sketch (after loading it, say), refused by name. */
export function resolve(st: EditState): EditResult {
  const r = solve(st.sketch);
  return r.ok ? { ok: true, state: { ...st, sketch: r.sketch } } : { ok: false, state: st, reason: r.reason };
}

/** The status line: how defined the sketch is, and what is still free. */
export function statusLine(sk: Sketch, known?: Freedom): string {
  if (!sk.points.length) return "Draw lines, rectangles, circles or arcs. Click a tool, then click on the canvas.";
  const f = known ?? freedom(sk);
  if (f.dof === 0) return "Fully defined.";
  if (f.rigidOnly) return "Fully defined apart from position — fix a point to anchor it.";
  const names = f.free.slice(0, 6).join(", ") + (f.free.length > 6 ? ", …" : "");
  return `${f.dof} degree${f.dof === 1 ? "" : "s"} of freedom left — still free: ${names || "position"}. Add relations or dimensions, or drag to see.`;
}

/** The sketch's size, for scaling snaps and glyphs on the canvas. */
export const sizeOf = sketchScale;
