/**
 * The sketch's drawing and editing tools beyond line / rectangle / circle / arc
 * (docs/SCOPE-CAD-R2.md; brought forward from R2d at the user's request: "I want
 * to be able to actually draw with a full suite of tools").
 *
 * Each tool builds exact geometry plus the relations that keep its intent, then
 * VERIFIES the result through the solver; a refusal leaves the sketch as it was
 * and says why.
 *   - polygon (regular, n sides), slot, centre rectangle, 3-point arc;
 *   - fillet and chamfer at a corner (the corner is kept as a virtual sharp — a
 *     construction point on both lines — so dimensions to it keep their meaning);
 *   - offset (a line, a circle / arc, or a closed outline of lines);
 *   - mirror about a line (symmetric relations), linear and circular patterns;
 *   - trim a line back to where it meets other geometry.
 */
import { Sketch, SConstraint, SEntity, SPoint, solve, radiusOf, unionCoincident } from "./sketch";
import { EditState, EditResult } from "./sketchEdit";

type Line = Extract<SEntity, { kind: "line" }>;

/** Builds onto a copy of the sketch with fresh ids; `done` verifies it. */
class Builder {
  sk: Sketch;
  seq: number;
  constructor(st: EditState) {
    this.sk = { points: [...st.sketch.points], entities: [...st.sketch.entities], constraints: [...st.sketch.constraints] };
    this.seq = st.seq;
  }
  id(prefix: string): string {
    return `${prefix}${this.seq++}`;
  }
  pt(x: number, y: number): string {
    const id = this.id("p");
    this.sk.points.push({ id, x, y });
    return id;
  }
  /** An existing point when the click snapped to one (so outlines really join), else a new one. */
  ptOr(x: number, y: number, snap?: string): string {
    return snap && this.sk.points.some((p) => p.id === snap) ? snap : this.pt(x, y);
  }
  line(a: string, b: string, construction = false): string {
    const id = this.id("L");
    this.sk.entities.push({ id, kind: "line", a, b, ...(construction ? { construction: true } : {}) });
    return id;
  }
  circle(c: string, r: number, construction = false): string {
    const id = this.id("C");
    this.sk.entities.push({ id, kind: "circle", c, r, ...(construction ? { construction: true } : {}) });
    return id;
  }
  arc(c: string, a: string, b: string, construction = false): string {
    const id = this.id("A");
    this.sk.entities.push({ id, kind: "arc", c, a, b, ...(construction ? { construction: true } : {}) });
    return id;
  }
  con(spec: Record<string, unknown>): void {
    this.sk.constraints.push({ ...spec, id: this.id("k") } as SConstraint);
  }
  P(id: string): SPoint {
    return this.sk.points.find((p) => p.id === id)!;
  }
  /** Solves and verifies; the new state, or the refusal. */
  done(st: EditState, note?: string): EditResult {
    // Checked against the geometry as BUILT (existing points are where they were; new geometry is
    // checked too). A crossing the tool drew is meant, as with the line tool; one only the solve
    // made — by moving geometry — is refused.
    const r = solve(this.sk, { crossingReference: st.sketch }, this.sk);
    if (!r.ok) return { ok: false, state: st, reason: r.reason };
    return { ok: true, state: { ...st, sketch: r.sketch, seq: this.seq, pending: [], selection: [] }, note };
  }
}

const P = (sk: Sketch, id: string): SPoint => sk.points.find((p) => p.id === id)!;

/** Two segments cross at an interior point of both (touching ends do not count). */
function segmentsCross([ax, ay, bx, by]: [number, number, number, number], [cx, cy, dx, dy]: [number, number, number, number]): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by), d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const E = (sk: Sketch, id: string): SEntity | undefined => sk.entities.find((e) => e.id === id);

// ---- drawing tools -------------------------------------------------------------------------

/** A regular polygon: centre, one vertex, n sides — vertices on a construction circle, sides equal. */
export function polygon(st: EditState, cx: number, cy: number, vx: number, vy: number, sides: number, snaps: Array<string | undefined> = []): EditResult {
  if (!Number.isInteger(sides) || sides < 3 || sides > 64) return { ok: false, state: st, reason: "a polygon needs a whole number of sides from 3 to 64" };
  const R = Math.hypot(vx - cx, vy - cy);
  if (!(R > 0)) return { ok: false, state: st, reason: "a polygon needs a size — click farther from the centre" };
  const b = new Builder(st);
  const c = b.ptOr(cx, cy, snaps[0]);
  const circ = b.circle(c, R, true);
  const t0 = Math.atan2(vy - cy, vx - cx);
  const v = Array.from({ length: sides }, (_, k) =>
    k === 0 ? b.ptOr(vx, vy, snaps[1]) : b.pt(cx + R * Math.cos(t0 + (2 * Math.PI * k) / sides), cy + R * Math.sin(t0 + (2 * Math.PI * k) / sides)),
  );
  const lines = v.map((p, k) => b.line(p, v[(k + 1) % sides], st.construction));
  for (const p of v) b.con({ kind: "onCircle", p, curve: circ });
  for (let k = 1; k < sides; k++) b.con({ kind: "equal", e1: lines[0], e2: lines[k] });
  return b.done(st);
}

/** A slot: the two end centres, then a point giving the half-width — two lines tangent to two end arcs. */
export function slot(st: EditState, x1: number, y1: number, x2: number, y2: number, wx: number, wy: number, snaps: Array<string | undefined> = []): EditResult {
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (!(L > 0)) return { ok: false, state: st, reason: "a slot needs two different end centres" };
  const ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
  const w = Math.abs((wx - x1) * nx + (wy - y1) * ny);
  if (!(w > 0)) return { ok: false, state: st, reason: "a slot needs a width — click to the side of the centre line" };
  const b = new Builder(st);
  const c1 = b.ptOr(x1, y1, snaps[0]), c2 = b.ptOr(x2, y2, snaps[1]);
  const a1 = b.pt(x1 + nx * w, y1 + ny * w), b1 = b.pt(x2 + nx * w, y2 + ny * w);
  const a2 = b.pt(x2 - nx * w, y2 - ny * w), b2 = b.pt(x1 - nx * w, y1 - ny * w);
  const top = b.line(a1, b1, st.construction), bottom = b.line(a2, b2, st.construction);
  const right = b.arc(c2, a2, b1, st.construction), left = b.arc(c1, a1, b2, st.construction);
  for (const [l, k] of [[top, right], [top, left], [bottom, right], [bottom, left]]) {
    const le = b.sk.entities.find((e) => e.id === l) as Line;
    const A = b.P(le.a), B = b.P(le.b), O = b.P((b.sk.entities.find((e) => e.id === k) as { c: string }).c);
    const side = (B.x - A.x) * (O.y - A.y) - (B.y - A.y) * (O.x - A.x) >= 0 ? 1 : -1;
    b.con({ kind: "tangent", e1: l, e2: k, side });
  }
  b.con({ kind: "equal", e1: right, e2: left });
  return b.done(st);
}

/** A rectangle from its centre and a corner: H/V sides, its centre at the middle of a construction diagonal. */
export function centreRectangle(st: EditState, cx: number, cy: number, x: number, y: number, snaps: Array<string | undefined> = []): EditResult {
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
  if (!(dx > 0 && dy > 0)) return { ok: false, state: st, reason: "a rectangle needs width and height — click a corner away from the centre" };
  const b = new Builder(st);
  const c = b.ptOr(cx, cy, snaps[0]);
  // The clicked corner is the one on its side of the centre; it uses the snapped point.
  const hit = y < cy ? (x < cx ? 0 : 1) : x > cx ? 2 : 3;
  const at: Array<[number, number]> = [[cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy]];
  const p = at.map(([px, py], i) => (i === hit ? b.ptOr(x, y, snaps[1]) : b.pt(px, py)));
  const l = p.map((q, i) => b.line(q, p[(i + 1) % 4], st.construction));
  b.con({ kind: "horizontal", line: l[0] });
  b.con({ kind: "vertical", line: l[1] });
  b.con({ kind: "horizontal", line: l[2] });
  b.con({ kind: "vertical", line: l[3] });
  const diag = b.line(p[0], p[2], true);
  b.con({ kind: "midpoint", p: c, line: diag });
  return b.done(st);
}

/** An arc through three points: start, end, and a point it passes through. */
export function arc3(st: EditState, ax: number, ay: number, bx: number, by: number, mx: number, my: number, snaps: Array<string | undefined> = []): EditResult {
  const d = 2 * (ax * (by - my) + bx * (my - ay) + mx * (ay - by));
  if (Math.abs(d) < 1e-12 * (Math.abs(ax) + Math.abs(bx) + Math.abs(mx) + 1)) return { ok: false, state: st, reason: "those three points are in a line — an arc needs them to bend" };
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, m2 = mx * mx + my * my;
  const ox = (a2 * (by - my) + b2 * (my - ay) + m2 * (ay - by)) / d;
  const oy = (a2 * (mx - bx) + b2 * (ax - mx) + m2 * (bx - ax)) / d;
  // Counter-clockwise from start to end must pass the middle point; otherwise the other way round.
  const ang = (x: number, y: number): number => Math.atan2(y - oy, x - ox);
  const norm = (t: number): number => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccwPasses = norm(ang(mx, my) - ang(ax, ay)) < norm(ang(bx, by) - ang(ax, ay));
  const b = new Builder(st);
  const o = b.pt(ox, oy), pa = b.ptOr(ax, ay, snaps[0]), pb = b.ptOr(bx, by, snaps[1]);
  if (ccwPasses) b.arc(o, pa, pb, st.construction);
  else b.arc(o, pb, pa, st.construction);
  return b.done(st);
}

// ---- corners ----------------------------------------------------------------------------------

/** Two lines meeting at a corner: the shared point, and each line's far end. */
function corner(sk: Sketch, l1: string, l2: string): { line1: Line; line2: Line; P: string; A: string; B: string } | string {
  const e1 = E(sk, l1), e2 = E(sk, l2);
  if (!e1 || !e2 || e1.kind !== "line" || e2.kind !== "line") return "select the two lines that meet at the corner";
  const root = unionCoincident(sk);
  for (const p of [e1.a, e1.b]) for (const q of [e2.a, e2.b]) {
    if (root(p) === root(q)) return { line1: e1, line2: e2, P: p, A: p === e1.a ? e1.b : e1.a, B: q === e2.a ? e2.b : e2.a };
  }
  // Already rounded: both lines end on one arc they are tangent to.
  const arcs = sk.constraints.filter((k) => k.kind === "tangent").map((k) => k as { e1: string; e2: string });
  const curveOf = (l: string): string[] => arcs.filter((k) => k.e1 === l || k.e2 === l).map((k) => (k.e1 === l ? k.e2 : k.e1));
  if (curveOf(l1).some((c) => curveOf(l2).includes(c) && E(sk, c)?.kind === "arc")) return "that corner is already rounded — change its R dimension instead";
  return "those two lines do not meet at a corner — join them first";
}

/**
 * Rewires a corner: each line's corner end moves to its new point. The ORIGINAL
 * lines live on as construction lines from their far ends to the corner (the
 * virtual sharp), and every relation that was on a line now names its
 * construction line — so a length, an equal, a midpoint keeps exactly what it
 * meant (third review: converting only lengths changed equal and midpoint).
 */
function cutCorner(b: Builder, c: { line1: Line; line2: Line; P: string; A: string; B: string }, T1: string, T2: string): void {
  const root = unionCoincident(b.sk);
  const twin = (l: Line, far: string): string => (root(l.a) === root(c.P) ? b.line(c.P, far, true) : b.line(far, c.P, true));
  const C1 = twin(c.line1, c.A), C2 = twin(c.line2, c.B);
  const swap: Record<string, string> = { [c.line1.id]: C1, [c.line2.id]: C2 };
  b.sk.constraints = b.sk.constraints.map((k) => {
    const out: Record<string, unknown> = { ...k };
    for (const [f, v] of Object.entries(k)) if (f !== "id" && f !== "kind" && typeof v === "string" && swap[v]) out[f] = swap[v];
    return out as unknown as SConstraint;
  });
  b.sk.entities = b.sk.entities.map((e) => {
    if (e.id === c.line1.id) return { ...e, ...(root(c.line1.a) === root(c.P) ? { a: T1 } : { b: T1 }) } as SEntity;
    if (e.id === c.line2.id) return { ...e, ...(root(c.line2.a) === root(c.P) ? { a: T2 } : { b: T2 }) } as SEntity;
    return e;
  });
  b.con({ kind: "onLine", p: T1, line: C1 });
  b.con({ kind: "onLine", p: T2, line: C2 });
}

function cornerGeometry(sk: Sketch, c: { P: string; A: string; B: string }): { px: number; py: number; u1: [number, number]; u2: [number, number]; d1: number; d2: number; theta: number } | string {
  const p = P(sk, c.P), a = P(sk, c.A), q = P(sk, c.B);
  const d1 = Math.hypot(a.x - p.x, a.y - p.y), d2 = Math.hypot(q.x - p.x, q.y - p.y);
  const u1: [number, number] = [(a.x - p.x) / d1, (a.y - p.y) / d1], u2: [number, number] = [(q.x - p.x) / d2, (q.y - p.y) / d2];
  const theta = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
  if (!(theta > 1e-6 && theta < Math.PI - 1e-6)) return "the two lines are in line — there is no corner to round";
  return { px: p.x, py: p.y, u1, u2, d1, d2, theta };
}

/** Rounds the corner between two lines with an arc of radius r, tangent to both. */
export function fillet(st: EditState, l1: string, l2: string, r: number): EditResult {
  if (!(r > 0)) return { ok: false, state: st, reason: "a fillet needs a radius greater than 0" };
  const c = corner(st.sketch, l1, l2);
  if (typeof c === "string") return { ok: false, state: st, reason: c };
  const g = cornerGeometry(st.sketch, c);
  if (typeof g === "string") return { ok: false, state: st, reason: g };
  const t = r / Math.tan(g.theta / 2);
  if (t >= g.d1 || t >= g.d2) return { ok: false, state: st, reason: `R${+r.toFixed(4)} is too large for these lines — the rounding would run past an end` };
  const b = new Builder(st);
  const T1 = b.pt(g.px + g.u1[0] * t, g.py + g.u1[1] * t);
  const T2 = b.pt(g.px + g.u2[0] * t, g.py + g.u2[1] * t);
  const bx = g.u1[0] + g.u2[0], by = g.u1[1] + g.u2[1], bl = Math.hypot(bx, by);
  const h = r / Math.sin(g.theta / 2);
  const O = b.pt(g.px + (bx / bl) * h, g.py + (by / bl) * h);
  cutCorner(b, c, T1, T2);
  const o = b.P(O), p1 = b.P(T1), p2 = b.P(T2);
  const ccw = (p1.x - o.x) * (p2.y - o.y) - (p1.y - o.y) * (p2.x - o.x) > 0;
  const arc = ccw ? b.arc(O, T1, T2) : b.arc(O, T2, T1);
  for (const l of [c.line1.id, c.line2.id]) {
    const le = b.sk.entities.find((e) => e.id === l) as Line;
    const A = b.P(le.a), B = b.P(le.b);
    const side = (B.x - A.x) * (o.y - A.y) - (B.y - A.y) * (o.x - A.x) >= 0 ? 1 : -1;
    b.con({ kind: "tangent", e1: l, e2: arc, side });
  }
  b.con({ kind: "radius", curve: arc, value: r });
  return b.done(st, `Rounded with R${+r.toFixed(4)}; the corner is kept as a construction point, so dimensions to it still hold.`);
}

/** Cuts the corner between two lines with a chamfer set back d along each. */
export function chamfer(st: EditState, l1: string, l2: string, d: number): EditResult {
  if (!(d > 0)) return { ok: false, state: st, reason: "a chamfer needs a distance greater than 0" };
  const c = corner(st.sketch, l1, l2);
  if (typeof c === "string") return { ok: false, state: st, reason: c };
  const g = cornerGeometry(st.sketch, c);
  if (typeof g === "string") return { ok: false, state: st, reason: g };
  if (d >= g.d1 || d >= g.d2) return { ok: false, state: st, reason: `a ${+d.toFixed(4)} chamfer is longer than the lines` };
  const b = new Builder(st);
  const T1 = b.pt(g.px + g.u1[0] * d, g.py + g.u1[1] * d);
  const T2 = b.pt(g.px + g.u2[0] * d, g.py + g.u2[1] * d);
  cutCorner(b, c, T1, T2);
  b.line(T1, T2);
  b.con({ kind: "distance", p: c.P, q: T1, value: d });
  b.con({ kind: "distance", p: c.P, q: T2, value: d });
  return b.done(st, `Chamfered ${+d.toFixed(4)} × ${+d.toFixed(4)}; the corner is kept as a construction point.`);
}

// ---- offset, mirror, patterns -------------------------------------------------------------------

/**
 * Offsets the selection by d: a line (parallel, d to its left; negative = right),
 * a circle or arc (concentric, radius + d), or a whole closed outline of lines
 * (d outward; negative = inward).
 */
export function offset(st: EditState, d: number): EditResult {
  if (!Number.isFinite(d) || d === 0) return { ok: false, state: st, reason: "an offset needs a distance (negative goes the other way)" };
  const sel = st.selection.map((id) => E(st.sketch, id)).filter((e): e is SEntity => !!e);
  if (!sel.length) return { ok: false, state: st, reason: "select a line, a circle / arc, or every line of a closed outline to offset" };
  const b = new Builder(st);
  if (sel.length === 1 && sel[0].kind !== "line") {
    const e = sel[0];
    const r = radiusOf(st.sketch, e.id) + d;
    if (!(r > 0)) return { ok: false, state: st, reason: "that offset would shrink the curve to nothing" };
    const o = b.P(e.c);
    if (e.kind === "circle") {
      // A horizontal construction ray from the centre meets the original at q and the copy at
      // q'; |q q'| = |d| holds the copy d away whatever the original's size becomes.
      const r0 = radiusOf(st.sketch, e.id);
      const nc = b.circle(e.c, r);
      const q = b.pt(o.x + r0, o.y), q2 = b.pt(o.x + r, o.y);
      const ray = b.line(e.c, q2, true);
      b.con({ kind: "horizontal", line: ray });
      b.con({ kind: "onCircle", p: q, curve: e.id });
      b.con({ kind: "onLine", p: q, line: ray });
      b.con({ kind: "onCircle", p: q2, curve: nc });
      b.con({ kind: "distance", p: q, q: q2, value: Math.abs(d) });
    } else {
      // The copy's ends lie on rays from the centre through the original's ends, |d| beyond them.
      const a = b.P(e.a), q = b.P(e.b);
      const s = r / radiusOf(st.sketch, e.id);
      const na = b.pt(o.x + (a.x - o.x) * s, o.y + (a.y - o.y) * s), nb = b.pt(o.x + (q.x - o.x) * s, o.y + (q.y - o.y) * s);
      b.arc(e.c, na, nb);
      const ra = b.line(e.c, na, true), rb = b.line(e.c, nb, true);
      b.con({ kind: "onLine", p: e.a, line: ra });
      b.con({ kind: "onLine", p: e.b, line: rb });
      b.con({ kind: "distance", p: e.a, q: na, value: Math.abs(d) });
    }
    return b.done(st);
  }
  if (sel.some((e) => e.kind !== "line")) return { ok: false, state: st, reason: "offset one curve at a time, or a closed outline made of lines" };
  const lines = sel as Line[];
  if (lines.length === 1) {
    const l = lines[0];
    const a = b.P(l.a), q = b.P(l.b);
    const len = Math.hypot(q.x - a.x, q.y - a.y);
    const nx = -(q.y - a.y) / len, ny = (q.x - a.x) / len;
    const na = b.pt(a.x + nx * d, a.y + ny * d), nb = b.pt(q.x + nx * d, q.y + ny * d);
    const nl = b.line(na, nb);
    b.con({ kind: "parallel", l1: l.id, l2: nl });
    b.con({ kind: "pointLine", p: na, line: l.id, value: Math.abs(d), side: d > 0 ? 1 : -1 });
    return b.done(st);
  }
  // A closed outline of lines: order it, offset each side outward, corners where neighbours meet.
  const root = unionCoincident(st.sketch);
  const order: Line[] = [lines[0]];
  let end = root(lines[0].b);
  const rest = new Set(lines.slice(1));
  while (rest.size) {
    const next = [...rest].find((l) => root(l.a) === end || root(l.b) === end);
    if (!next) return { ok: false, state: st, reason: "the selected lines do not form one closed outline" };
    rest.delete(next);
    order.push(next);
    end = root(next.a) === end ? root(next.b) : root(next.a);
  }
  if (end !== root(lines[0].a)) return { ok: false, state: st, reason: "the selected lines do not form one closed outline" };
  // Corner points in travel order, and the outline's turning direction.
  const pts: SPoint[] = [];
  let cur = root(lines[0].a);
  for (const l of order) {
    const startId = root(l.a) === cur ? l.a : l.b;
    pts.push(P(st.sketch, startId));
    cur = root(startId === l.a ? l.b : l.a);
  }
  const area = pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;
  const out = area > 0 ? -1 : 1; // the left normal points inward for a counter-clockwise outline
  const n = pts.length;
  const shifted = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = (-(q.y - p.y) / len) * out, ny = ((q.x - p.x) / len) * out;
    return { ax: p.x + nx * d, ay: p.y + ny * d, bx: q.x + nx * d, by: q.y + ny * d };
  });
  const corners = shifted.map((s, i) => {
    const t = shifted[(i - 1 + n) % n];
    // Intersection of line t (previous side) and line s.
    const d1x = t.bx - t.ax, d1y = t.by - t.ay, d2x = s.bx - s.ax, d2y = s.by - s.ay;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return [s.ax, s.ay];
    const u = ((s.ax - t.ax) * d2y - (s.ay - t.ay) * d2x) / den;
    return [t.ax + u * d1x, t.ay + u * d1y];
  });
  // Every side of the copy must run the same way as its original: one that turned round means
  // the offset is larger than the outline allows (an inward 6 on a 10 × 10 square).
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % n];
    if ((q.x - p.x) * (x2 - x1) + (q.y - p.y) * (y2 - y1) <= 0) return { ok: false, state: st, reason: `an offset of ${+d.toFixed(4)} is larger than this outline allows` };
  }
  const segs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) segs.push([corners[i][0], corners[i][1], corners[(i + 1) % n][0], corners[(i + 1) % n][1]]);
  const orig: Array<[number, number, number, number]> = pts.map((p, i) => [p.x, p.y, pts[(i + 1) % n].x, pts[(i + 1) % n].y]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1) && segmentsCross(segs[i], segs[j])) return { ok: false, state: st, reason: `an offset of ${+d.toFixed(4)} is larger than this outline allows` };
    for (const o of orig) if (segmentsCross(segs[i], o)) return { ok: false, state: st, reason: `an offset of ${+d.toFixed(4)} is larger than this outline allows` };
  }
  const ids = corners.map(([x, y]) => b.pt(x, y));
  const newLines = ids.map((p, i) => b.line(p, ids[(i + 1) % n]));
  order.forEach((l, i) => b.con({ kind: "parallel", l1: l.id, l2: newLines[i] }));
  // One distance fixes the offset; the parallels and corners carry it round.
  const first = order[0];
  const fa = P(st.sketch, first.a), fb = P(st.sketch, first.b), c0 = b.P(ids[0]);
  const side = (fb.x - fa.x) * (c0.y - fa.y) - (fb.y - fa.y) * (c0.x - fa.x) >= 0 ? 1 : -1;
  b.con({ kind: "pointLine", p: ids[1], line: first.id, value: Math.abs(d), side });
  for (let i = 1; i < n; i++) {
    const l = order[i];
    const la = P(st.sketch, l.a), lb = P(st.sketch, l.b), q = b.P(ids[(i + 1) % n]);
    const sd = (lb.x - la.x) * (q.y - la.y) - (lb.y - la.y) * (q.x - la.x) >= 0 ? 1 : -1;
    b.con({ kind: "pointLine", p: ids[(i + 1) % n], line: l.id, value: Math.abs(d), side: sd });
  }
  return b.done(st);
}

/** Mirrors the selection about the LAST selected line, holding each copy symmetric to its original. */
export function mirror(st: EditState): EditResult {
  const axisId = [...st.selection].reverse().find((id) => E(st.sketch, id)?.kind === "line");
  if (!axisId) return { ok: false, state: st, reason: "select what to mirror, then the line to mirror about (last)" };
  const items = st.selection.filter((id) => id !== axisId).map((id) => E(st.sketch, id)).filter((e): e is SEntity => !!e);
  if (!items.length) return { ok: false, state: st, reason: "select what to mirror, then the line to mirror about (last)" };
  const ax = E(st.sketch, axisId) as Line;
  const A = P(st.sketch, ax.a), B = P(st.sketch, ax.b);
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
  const reflect = (p: SPoint): [number, number] => {
    const t = (p.x - A.x) * ux + (p.y - A.y) * uy;
    const fx = A.x + t * ux, fy = A.y + t * uy;
    return [2 * fx - p.x, 2 * fy - p.y];
  };
  const b = new Builder(st);
  const copy = new Map<string, string>();
  const onAxis = (p: SPoint): boolean => Math.abs((p.x - A.x) * uy - (p.y - A.y) * ux) <= 1e-9 * len;
  const mp = (id: string): string => {
    if (copy.has(id)) return copy.get(id)!;
    const p = P(st.sketch, id);
    // A point on the mirror line is its own mirror image.
    if (onAxis(p)) {
      copy.set(id, id);
      return id;
    }
    const [x, y] = reflect(p);
    const nid = b.pt(x, y);
    copy.set(id, nid);
    b.con({ kind: "symmetric", p: id, q: nid, line: axisId });
    return nid;
  };
  for (const e of items) {
    // Geometry that is its own mirror image (on the line, or centred on it and symmetric) is not copied.
    if (e.kind === "line" && onAxis(P(st.sketch, e.a)) && onAxis(P(st.sketch, e.b))) continue;
    if (e.kind === "circle" && onAxis(P(st.sketch, e.c))) continue;
    if (e.kind === "arc" && onAxis(P(st.sketch, e.c))) {
      const [rx, ry] = reflect(P(st.sketch, e.a)), pb = P(st.sketch, e.b);
      if (Math.hypot(rx - pb.x, ry - pb.y) <= 1e-9 * len) continue;
    }
    if (e.kind === "line") b.line(mp(e.a), mp(e.b), !!e.construction);
    else if (e.kind === "circle") {
      const nc = b.circle(mp(e.c), e.r, !!e.construction);
      b.con({ kind: "equal", e1: e.id, e2: nc });
    } else {
      // A mirror reverses turning: counter-clockwise a → b becomes counter-clockwise b' → a'.
      b.arc(mp(e.c), mp(e.b), mp(e.a), !!e.construction);
    }
  }
  if (b.sk.entities.length === st.sketch.entities.length) return { ok: false, state: st, reason: "everything selected lies on the mirror line — it is its own mirror image" };
  return b.done(st);
}

/** Copies the selection `count − 1` more times, each (dx, dy) further on. */
export function linearPattern(st: EditState, count: number, dx: number, dy: number): EditResult {
  if (!Number.isInteger(count) || count < 2 || count > 100) return { ok: false, state: st, reason: "a pattern needs a whole number of copies from 2 to 100" };
  if (!(Math.hypot(dx, dy) > 0)) return { ok: false, state: st, reason: "a pattern needs a spacing" };
  return pattern(st, count, (p, k) => [p.x + k * dx, p.y + k * dy]);
}

/** Copies the selection round the selected centre POINT, `count` in all over `totalDeg` (360 = all round). */
export function circularPattern(st: EditState, count: number, totalDeg = 360): EditResult {
  const centre = st.selection.find((id) => st.sketch.points.some((p) => p.id === id));
  if (!centre) return { ok: false, state: st, reason: "select what to copy and the centre point to copy it round" };
  if (!Number.isInteger(count) || count < 2 || count > 100) return { ok: false, state: st, reason: "a pattern needs a whole number of copies from 2 to 100" };
  if (!(totalDeg > 0 && totalDeg <= 360)) return { ok: false, state: st, reason: "the pattern's angle must be more than 0° and at most 360°" };
  const c = P(st.sketch, centre);
  const step = ((totalDeg === 360 ? totalDeg / count : totalDeg / (count - 1)) * Math.PI) / 180;
  const st2 = { ...st, selection: st.selection.filter((id) => id !== centre) };
  return pattern(st2, count, (p, k) => {
    const t = k * step, ox = p.x - c.x, oy = p.y - c.y;
    return [c.x + ox * Math.cos(t) - oy * Math.sin(t), c.y + ox * Math.sin(t) + oy * Math.cos(t)];
  });
}

function pattern(st: EditState, count: number, place: (p: SPoint, k: number) => [number, number]): EditResult {
  const items = st.selection.map((id) => E(st.sketch, id)).filter((e): e is SEntity => !!e);
  if (!items.length) return { ok: false, state: st, reason: "select the lines, circles or arcs to copy" };
  const pointsUsed = new Set(items.flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b])));
  if (st.sketch.points.length + pointsUsed.size * (count - 1) > 150) return { ok: false, state: st, reason: "that many copies would pass the sketch's 150-point limit" };
  const b = new Builder(st);
  for (let k = 1; k < count; k++) {
    const copy = new Map<string, string>();
    const mp = (id: string): string => {
      if (!copy.has(id)) {
        const [x, y] = place(P(st.sketch, id), k);
        copy.set(id, b.pt(x, y));
      }
      return copy.get(id)!;
    };
    for (const e of items) {
      if (e.kind === "line") {
        const nl = b.line(mp(e.a), mp(e.b), !!e.construction);
        b.con({ kind: "equal", e1: e.id, e2: nl });
      } else if (e.kind === "circle") {
        const nc = b.circle(mp(e.c), e.r, !!e.construction);
        b.con({ kind: "equal", e1: e.id, e2: nc });
      } else {
        const na = b.arc(mp(e.c), mp(e.a), mp(e.b), !!e.construction);
        b.con({ kind: "equal", e1: e.id, e2: na });
      }
    }
  }
  return b.done(st);
}

// ---- trim -----------------------------------------------------------------------------------------

/** Where segment ab meets other geometry: parameters t in (0, 1) along it, with what it meets. */
function cuts(sk: Sketch, line: Line): Array<{ t: number; with: string; curve: boolean }> {
  const a = P(sk, line.a), q = P(sk, line.b);
  const dx = q.x - a.x, dy = q.y - a.y;
  const out: Array<{ t: number; with: string; curve: boolean }> = [];
  for (const e of sk.entities) {
    if (e.id === line.id || e.construction) continue;
    if (e.kind === "line") {
      const c = P(sk, e.a), d = P(sk, e.b);
      const ex = d.x - c.x, ey = d.y - c.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) out.push({ t, with: e.id, curve: false });
    } else {
      const o = P(sk, e.c), r = radiusOf(sk, e.id);
      const fx = a.x - o.x, fy = a.y - o.y;
      const A2 = dx * dx + dy * dy, B2 = 2 * (fx * dx + fy * dy), C2 = fx * fx + fy * fy - r * r;
      const disc = B2 * B2 - 4 * A2 * C2;
      if (disc < 0) continue;
      for (const t of [(-B2 - Math.sqrt(disc)) / (2 * A2), (-B2 + Math.sqrt(disc)) / (2 * A2)]) {
        if (!(t > 1e-9 && t < 1 - 1e-9)) continue;
        if (e.kind === "arc") {
          const x = a.x + t * dx, y = a.y + t * dy;
          const pa = P(sk, e.a), pb = P(sk, e.b);
          const ang = (px: number, py: number): number => Math.atan2(py - o.y, px - o.x);
          let sw = ang(pb.x, pb.y) - ang(pa.x, pa.y), at = ang(x, y) - ang(pa.x, pa.y);
          while (sw <= 0) sw += 2 * Math.PI;
          while (at < 0) at += 2 * Math.PI;
          if (at > sw) continue;
        }
        out.push({ t, with: e.id, curve: true });
      }
    }
  }
  return out.sort((p, q) => p.t - q.t);
}

/**
 * Trims the line at (x, y) back to where it meets other geometry: the piece
 * between the two nearest crossings (or a crossing and an end) is removed. A
 * line that meets nothing is deleted. Each new end is held on what it meets.
 */
export function trim(st: EditState, lineId: string, x: number, y: number): EditResult {
  const line = E(st.sketch, lineId);
  if (!line || line.kind !== "line") return { ok: false, state: st, reason: "click on a line to trim it (trimming circles and arcs comes later)" };
  const a = P(st.sketch, line.a), q = P(st.sketch, line.b);
  const dx = q.x - a.x, dy = q.y - a.y;
  const tc = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy);
  const cs = cuts(st.sketch, line);
  const b = new Builder(st);
  const refersTo = (k: SConstraint, id: string): boolean => Object.entries(k).some(([f, v]) => f !== "id" && f !== "kind" && v === id);
  if (!cs.length) {
    b.sk.entities = b.sk.entities.filter((e) => e.id !== lineId);
    b.sk.constraints = b.sk.constraints.filter((k) => !refersTo(k, lineId));
    // Its ends go too, unless something else uses them.
    const usedNow = new Set(b.sk.entities.flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b])));
    const gone = new Set([line.a, line.b].filter((p) => !usedNow.has(p)));
    b.sk.points = b.sk.points.filter((p) => !gone.has(p.id));
    b.sk.constraints = b.sk.constraints.filter((k) => ![...gone].some((id) => refersTo(k, id)));
    return b.done(st, "That line met nothing, so it was deleted.");
  }
  const before = [...cs].reverse().find((c) => c.t < tc);
  const after = cs.find((c) => c.t > tc);
  const at = (t: number): [number, number] => [a.x + t * dx, a.y + t * dy];
  const hold = (p: string, c: { with: string; curve: boolean }): void => b.con(c.curve ? { kind: "onCircle", p, curve: c.with } : { kind: "onLine", p, line: c.with });
  // Relations that depend on the line's EXTENT (its length, an equal length, its midpoint) no
  // longer mean what they did: they go, and the note says which. Direction relations, and the
  // line as a mirror axis (an infinite line, unchanged), stay.
  const extent = (k: SConstraint): boolean =>
    refersTo(k, lineId) && (k.kind === "length" || k.kind === "midpoint" || (k.kind === "equal" && (k.e1 === lineId || k.e2 === lineId)));
  const droppedRel = b.sk.constraints.filter(extent);
  b.sk.constraints = b.sk.constraints.filter((k) => !extent(k));
  const keep = (k: SConstraint): boolean => !extent(k);
  if (before && after) {
    // The middle piece goes: the line keeps its start up to `before`, a new line runs from `after` to its end.
    const [x1, y1] = at(before.t), [x2, y2] = at(after.t);
    const p1 = b.pt(x1, y1), p2 = b.pt(x2, y2);
    b.sk.entities = b.sk.entities.map((e) => (e.id === lineId ? { ...e, b: p1 } as SEntity : e));
    b.line(p2, line.b, !!line.construction);
    // The second piece stays ON the first's line: both its ends held to it.
    b.con({ kind: "onLine", p: p2, line: lineId });
    b.con({ kind: "onLine", p: line.b, line: lineId });
    hold(p1, before);
    hold(p2, after);
  } else if (before) {
    const [x1, y1] = at(before.t);
    const p1 = b.pt(x1, y1);
    b.sk.entities = b.sk.entities.map((e) => (e.id === lineId ? { ...e, b: p1 } as SEntity : e));
    hold(p1, before);
  } else if (after) {
    const [x2, y2] = at(after.t);
    const p2 = b.pt(x2, y2);
    b.sk.entities = b.sk.entities.map((e) => (e.id === lineId ? { ...e, a: p2 } as SEntity : e));
    hold(p2, after);
  }
  // Points no longer used by anything (the trimmed-off end) go, with their relations.
  const used = new Set(b.sk.entities.flatMap((e) => (e.kind === "line" ? [e.a, e.b] : e.kind === "circle" ? [e.c] : [e.c, e.a, e.b])));
  const dropped = new Set(b.sk.points.filter((p) => !used.has(p.id) && (p.id === line.a || p.id === line.b)).map((p) => p.id));
  b.sk.points = b.sk.points.filter((p) => !dropped.has(p.id));
  b.sk.constraints = b.sk.constraints.filter((k) => ![...dropped].some((id) => refersTo(k, id)));
  void keep;
  return b.done(st, droppedRel.length ? `Trimmed; relations that depended on the line's full length went with it (${droppedRel.map((k) => k.kind).join(", ")}).` : undefined);
}

/** Empties the sketch (the editor keeps the old one for Undo). */
export function clearSketch(st: EditState): EditResult {
  if (!st.sketch.points.length) return { ok: false, state: st, reason: "the sketch is already empty" };
  return { ok: true, state: { ...st, sketch: { points: [], entities: [], constraints: [] }, selection: [], pending: [] }, note: "Sketch cleared — Undo brings it back." };
}
