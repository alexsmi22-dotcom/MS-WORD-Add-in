/**
 * What the sketch canvas draws (docs/SCOPE-CAD-R2.md, R2a): geometry coloured
 * by state (free = blue, fully defined = black, construction dashed, selection
 * highlighted), points, the tool in progress, dimension labels with their
 * display text, and relation glyphs. Pure: canvas coordinates out, so the DOM
 * controller only paints, and tests can check what is drawn.
 */
import { Sketch, SEntity, SConstraint, radiusOf, DIMENSION_KINDS } from "./sketch";
import { formatDimension } from "./sketchEdit";
import { measure } from "./sketch";

/** Sketch ↔ canvas: canvas = (ox + x·s, oy − y·s). */
export interface SketchView {
  ox: number;
  oy: number;
  s: number;
}

export type Style = "free" | "defined" | "construction" | "selected" | "pending";

export type SketchOp =
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; style: Style; id: string }
  | { op: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; style: Style; id: string }
  | { op: "point"; x: number; y: number; style: Style; id: string }
  | { op: "text"; x: number; y: number; text: string; kind: "dimension" | "driven" | "glyph"; id: string };

/** A view that frames the sketch (or a default 100-unit square) in a w × h canvas. */
export function frameSketch(sk: Sketch, w: number, h: number, margin = 30): SketchView {
  const xs: number[] = [], ys: number[] = [];
  for (const p of sk.points) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const e of sk.entities)
    if (e.kind === "circle") {
      const c = sk.points.find((p) => p.id === e.c)!;
      xs.push(c.x - e.r, c.x + e.r);
      ys.push(c.y - e.r, c.y + e.r);
    }
  if (!xs.length) return { s: Math.min(w, h) / 120, ox: w / 2, oy: h / 2 };
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 1e-9);
  const s = Math.min((w - 2 * margin) / Math.max(x1 - x0, span * 0.2), (h - 2 * margin) / Math.max(y1 - y0, span * 0.2));
  return { s, ox: w / 2 - ((x0 + x1) / 2) * s, oy: h / 2 + ((y0 + y1) / 2) * s };
}

export const toCanvas = (v: SketchView, x: number, y: number): [number, number] => [v.ox + x * v.s, v.oy - y * v.s];
export const toSketch = (v: SketchView, cx: number, cy: number): [number, number] => [(cx - v.ox) / v.s, (v.oy - cy) / v.s];

const GLYPH: Partial<Record<SConstraint["kind"], string>> = {
  horizontal: "H",
  vertical: "V",
  parallel: "∥",
  perpendicular: "⊥",
  tangent: "T",
  equal: "=",
  concentric: "◎",
  midpoint: "M",
  symmetric: "S",
  fix: "⚓",
  coincident: "•",
  onLine: "∈",
  onCircle: "∈",
};

/** The draw list. `free` = entity ids still free (from freedom()); `pending` = the tool's clicks so far + hover. */
export function sketchOps(sk: Sketch, v: SketchView, opts: { selection?: string[]; free?: string[]; pending?: Array<{ x: number; y: number }>; tool?: string; sides?: number } = {}): SketchOp[] {
  const sel = new Set(opts.selection ?? []);
  const free = new Set(opts.free ?? []);
  const P = (id: string) => sk.points.find((p) => p.id === id)!;
  const style = (e: SEntity): Style => (sel.has(e.id) ? "selected" : e.construction ? "construction" : free.has(e.id) ? "free" : "defined");
  const ops: SketchOp[] = [];
  for (const e of sk.entities) {
    if (e.kind === "line") {
      const [x1, y1] = toCanvas(v, P(e.a).x, P(e.a).y), [x2, y2] = toCanvas(v, P(e.b).x, P(e.b).y);
      ops.push({ op: "line", x1, y1, x2, y2, style: style(e), id: e.id });
    } else {
      const c = P(e.c);
      const [cx, cy] = toCanvas(v, c.x, c.y);
      const r = radiusOf(sk, e.id) * v.s;
      if (e.kind === "circle") ops.push({ op: "arc", cx, cy, r, a0: 0, a1: 2 * Math.PI, style: style(e), id: e.id });
      else {
        // Canvas y runs down: a counter-clockwise sketch arc is clockwise on the canvas.
        const a = P(e.a), b = P(e.b);
        const t0 = Math.atan2(a.y - c.y, a.x - c.x), t1 = Math.atan2(b.y - c.y, b.x - c.x);
        let sw = t1 - t0;
        while (sw <= 0) sw += 2 * Math.PI;
        ops.push({ op: "arc", cx, cy, r, a0: -t0, a1: -(t0 + sw), style: style(e), id: e.id });
      }
    }
  }
  for (const p of sk.points) {
    const [x, y] = toCanvas(v, p.x, p.y);
    ops.push({ op: "point", x, y, style: sel.has(p.id) ? "selected" : "defined", id: p.id });
  }
  // Dimensions: their display text beside what they measure, OUTSIDE the shape; relation
  // glyphs on the inside — so neither sits on its line or on the other.
  const cxs = sk.points.map((p) => p.x), cys = sk.points.map((p) => p.y);
  const centre = cxs.length ? toCanvas(v, (Math.min(...cxs) + Math.max(...cxs)) / 2, (Math.min(...cys) + Math.max(...cys)) / 2) : [v.ox, v.oy];
  /** Unit normal (canvas) of the line a relation is on, pointing away from the sketch's centre. */
  const outward = (c: SConstraint, x: number, y: number): [number, number] => {
    const lineId = "line" in c ? c.line : "l1" in c ? c.l1 : null;
    const e = lineId ? sk.entities.find((q) => q.id === lineId) : undefined;
    if (!e || e.kind !== "line") {
      const dx = x - centre[0], dy = y - centre[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    }
    const [ax, ay] = toCanvas(v, P(e.a).x, P(e.a).y), [bx, by] = toCanvas(v, P(e.b).x, P(e.b).y);
    let nx = -(by - ay), ny = bx - ax;
    const l = Math.hypot(nx, ny) || 1;
    [nx, ny] = [nx / l, ny / l];
    return nx * (x - centre[0]) + ny * (y - centre[1]) >= 0 ? [nx, ny] : [-nx, -ny];
  };
  for (const c of sk.constraints) {
    if (DIMENSION_KINDS.has(c.kind)) {
      const at = anchorOf(sk, c);
      if (!at) continue;
      const [x, y] = toCanvas(v, at[0], at[1]);
      const [nx, ny] = outward(c, x, y);
      const driven = "driven" in c && !!c.driven;
      const value = driven ? measure(sk, c) : (c as { value: number }).value;
      const text = driven ? `(${formatDimension(c, value)})` : formatDimension(c, value);
      // Text is anchored at its left: centre it on the offset point.
      ops.push({ op: "text", x: x + nx * 16 - 3.5 * text.length, y: y + ny * 16 + 4, text, kind: driven ? "driven" : "dimension", id: c.id });
    } else {
      const g = GLYPH[c.kind];
      const at = g ? anchorOf(sk, c) : null;
      if (g && at && c.kind !== "coincident") {
        const [x, y] = toCanvas(v, at[0], at[1]);
        const [nx, ny] = outward(c, x, y);
        ops.push({ op: "text", x: x - nx * 12 - 3, y: y - ny * 12 + 4, text: g, kind: "glyph", id: c.id });
      }
    }
  }
  // The tool in progress: a rubber band from the clicks so far to the cursor.
  const pend = opts.pending ?? [];
  if (pend.length >= 2) {
    const pts = pend.map((q) => toCanvas(v, q.x, q.y));
    if (opts.tool === "rectangle") {
      const [[ax, ay], [bx, by]] = [pts[0], pts[pts.length - 1]];
      for (const [x1, y1, x2, y2] of [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]])
        ops.push({ op: "line", x1, y1, x2, y2, style: "pending", id: "_pending" });
    } else if (opts.tool === "centreRectangle") {
      const [[cx, cy], [bx, by]] = [pts[0], pts[pts.length - 1]];
      const [ax, ay] = [2 * cx - bx, 2 * cy - by];
      for (const [x1, y1, x2, y2] of [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]])
        ops.push({ op: "line", x1, y1, x2, y2, style: "pending", id: "_pending" });
    } else if (opts.tool === "polygon") {
      const n = Math.max(3, Math.min(64, Math.round(opts.sides ?? 6)));
      const [[cx, cy], [bx, by]] = [pts[0], pts[pts.length - 1]];
      const R = Math.hypot(bx - cx, by - cy), t0 = Math.atan2(by - cy, bx - cx);
      const at = (k: number): [number, number] => [cx + R * Math.cos(t0 + (2 * Math.PI * k) / n), cy + R * Math.sin(t0 + (2 * Math.PI * k) / n)];
      for (let k = 0; k < n; k++) {
        const [x1, y1] = at(k), [x2, y2] = at(k + 1);
        ops.push({ op: "line", x1, y1, x2, y2, style: "pending", id: "_pending" });
      }
    } else if (opts.tool === "slot" && pts.length >= 3) {
      const [[x1, y1], [x2, y2], [wx, wy]] = pts;
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
      const w = Math.abs((wx - x1) * nx + (wy - y1) * ny);
      ops.push({ op: "line", x1: x1 + nx * w, y1: y1 + ny * w, x2: x2 + nx * w, y2: y2 + ny * w, style: "pending", id: "_pending" });
      ops.push({ op: "line", x1: x1 - nx * w, y1: y1 - ny * w, x2: x2 - nx * w, y2: y2 - ny * w, style: "pending", id: "_pending" });
      ops.push({ op: "arc", cx: x1, cy: y1, r: w, a0: 0, a1: 2 * Math.PI, style: "pending", id: "_pending" });
      ops.push({ op: "arc", cx: x2, cy: y2, r: w, a0: 0, a1: 2 * Math.PI, style: "pending", id: "_pending" });
    } else if (opts.tool === "circle") {
      const [[ax, ay], [bx, by]] = [pts[0], pts[pts.length - 1]];
      ops.push({ op: "arc", cx: ax, cy: ay, r: Math.hypot(bx - ax, by - ay), a0: 0, a1: 2 * Math.PI, style: "pending", id: "_pending" });
    } else {
      for (let i = 1; i < pts.length; i++) ops.push({ op: "line", x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], style: "pending", id: "_pending" });
    }
  }
  return ops;
}

/** Where a relation or dimension is labelled (sketch coordinates). */
function anchorOf(sk: Sketch, c: SConstraint): [number, number] | null {
  const P = (id: string) => sk.points.find((p) => p.id === id);
  const E = (id: string) => sk.entities.find((e) => e.id === id);
  const mid = (id: string): [number, number] | null => {
    const e = E(id);
    if (!e) return null;
    if (e.kind === "line") {
      const a = P(e.a)!, b = P(e.b)!;
      return [(a.x + b.x) / 2, (a.y + b.y) / 2];
    }
    const o = P(e.c)!, r = radiusOf(sk, e.id);
    return [o.x + r * Math.SQRT1_2, o.y + r * Math.SQRT1_2];
  };
  const pmid = (p: string, q: string): [number, number] | null => {
    const a = P(p), b = P(q);
    return a && b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : null;
  };
  switch (c.kind) {
    case "length": case "horizontal": case "vertical": case "midpoint": case "onLine": return mid(c.line);
    case "radius": case "diameter": return mid(c.curve);
    case "parallel": case "perpendicular": case "angle": return mid(c.l1);
    case "tangent": case "equal": case "concentric": return mid(c.e1);
    case "distance": case "hdist": case "vdist": case "coincident": return pmid(c.p, c.q);
    case "symmetric": return pmid(c.p, c.q);
    case "pointLine": return mid(c.line);
    case "onCircle": return mid(c.curve);
    case "fix": { const p = P(c.p); return p ? [p.x, p.y] : null; }
  }
}
