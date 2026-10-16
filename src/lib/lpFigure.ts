/**
 * The feasible-region figure for a two-variable linear program.
 *
 * Everything here is float: the engine (lp.ts) has already found the exact
 * vertices and the exact optimum, and this file only has to draw them. The
 * region is the window rectangle clipped by every constraint half-plane
 * (Sutherland–Hodgman), so an unbounded region is drawn as far as the window
 * goes and an empty region draws nothing — the caption says "empty" and the
 * half-planes' boundary lines are still shown so the reader can see WHY.
 *
 * Drawn: each constraint line labelled, the shaded region, the objective
 * contour through the optimum (dashed) with an arrow in the improving
 * direction, the optimum marked with its coordinates and value, an
 * alternative-optima edge highlighted, an unbounded ray drawn as an arrow.
 *
 * LABEL PLACEMENT is scored, not guessed: every line drawn is recorded, and a
 * label is put at the candidate position (line exits, perpendicular offsets,
 * the four diagonals around a point) that no segment crosses and no earlier
 * label overlaps, inside the canvas. Labels are painted LAST on a white halo,
 * so the layout gate's strikethrough test (scripts/figure-layout-audit.js)
 * measures the same thing a reader sees.
 */

import { linearAxis } from "./axis";

export type LpRel = "<=" | ">=" | "=";

export interface LpFigureSpec {
  vars: [string, string];
  rows: { a: [number, number]; rel: LpRel; b: number; label: string }[];
  nonneg: [boolean, boolean];
  /** Exact feasible vertices (as floats), possibly empty. */
  vertices: [number, number][];
  optimum?: [number, number];
  optimumLabel?: string;
  /** Objective coefficients and sense — the contour and its arrow. */
  c: [number, number];
  sense: "max" | "min";
  status: "optimal" | "unbounded" | "infeasible";
  altEdge?: [[number, number], [number, number]];
  ray?: { from: [number, number]; dir: [number, number] };
  integerPoint?: [number, number];
  caption: string;
}

type Pt = [number, number];
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The audit's text metrics: a conservative 0.58 em advance, 1.2 em line. */
const ADVANCE = 0.58;
const LINE = 1.2;

/** Half-plane n·p <= k (strict form used for clipping). */
interface Half {
  n: Pt;
  k: number;
}

function clipPolygon(poly: Pt[], h: Half): Pt[] {
  if (!poly.length) return poly;
  const inside = (p: Pt): boolean => h.n[0] * p[0] + h.n[1] * p[1] <= h.k + 1e-9;
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const cIn = inside(cur);
    const pIn = inside(prev);
    if (cIn !== pIn) {
      const fp = h.n[0] * prev[0] + h.n[1] * prev[1] - h.k;
      const fc = h.n[0] * cur[0] + h.n[1] * cur[1] - h.k;
      const t = fp / (fp - fc);
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
    }
    if (cIn) out.push(cur);
  }
  return out;
}

/** The segment of the line a·p = b inside the window, or null. */
function clipLine(a: Pt, b: number, win: { x0: number; x1: number; y0: number; y1: number }): [Pt, Pt] | null {
  const pts: Pt[] = [];
  const push = (p: Pt): void => {
    if (p[0] < win.x0 - 1e-9 || p[0] > win.x1 + 1e-9 || p[1] < win.y0 - 1e-9 || p[1] > win.y1 + 1e-9) return;
    if (!pts.some((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9)) pts.push(p);
  };
  if (Math.abs(a[1]) > 1e-12) {
    push([win.x0, (b - a[0] * win.x0) / a[1]]);
    push([win.x1, (b - a[0] * win.x1) / a[1]]);
  }
  if (Math.abs(a[0]) > 1e-12) {
    push([(b - a[1] * win.y0) / a[0], win.y0]);
    push([(b - a[1] * win.y1) / a[0], win.y1]);
  }
  if (pts.length < 2) return null;
  return [pts[0], pts[1]];
}

/** Does the segment pass through the box? (Liang–Barsky parametric clip.) */
function segmentHitsBox(s: Seg, b: Box): boolean {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, s.x0 - b.x0],
    [dx, b.x1 - s.x0],
    [-dy, s.y0 - b.y0],
    [dy, b.y1 - s.y0],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

const boxesOverlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const COLOURS = ["#2563eb", "#b91c1c", "#047857", "#7c3aed", "#b45309", "#0e7490", "#be185d", "#4d7c0f"];

export function lpRegionSvg(spec: LpFigureSpec): string {
  const W = 460;
  const H = 340;
  const ML = 52;
  const MR = 18;
  const MT = 30;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  // --- window ---
  const pts: Pt[] = [...spec.vertices];
  if (spec.optimum) pts.push(spec.optimum);
  if (spec.integerPoint) pts.push(spec.integerPoint);
  if (spec.nonneg[0] && spec.nonneg[1]) pts.push([0, 0]);
  for (const r of spec.rows) {
    if (Math.abs(r.a[0]) > 1e-12) pts.push([r.b / r.a[0], 0]);
    if (Math.abs(r.a[1]) > 1e-12) pts.push([0, r.b / r.a[1]]);
  }
  if (spec.ray) {
    const len = Math.hypot(spec.ray.dir[0], spec.ray.dir[1]) || 1;
    const span = Math.max(1, ...pts.map((p) => Math.abs(p[0])), ...pts.map((p) => Math.abs(p[1])));
    pts.push([spec.ray.from[0] + (spec.ray.dir[0] / len) * span * 0.8, spec.ray.from[1] + (spec.ray.dir[1] / len) * span * 0.8]);
  }
  if (!pts.length) pts.push([0, 0], [1, 1]);
  let x0 = Math.min(...pts.map((p) => p[0]));
  let x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1]));
  let y1 = Math.max(...pts.map((p) => p[1]));
  if (x0 > 0) x0 = 0;
  if (y0 > 0) y0 = 0;
  // Keep the window from clamping onto a degenerate span, and pad it.
  const sx = Math.max(x1 - x0, 1e-9);
  const sy = Math.max(y1 - y0, 1e-9);
  const span = Math.max(sx, sy, 1);
  x0 -= span * 0.12;
  x1 += span * 0.12;
  y0 -= span * 0.12;
  y1 += span * 0.12;
  if (x1 - x0 < span) x1 = x0 + span;
  if (y1 - y0 < span) y1 = y0 + span;
  const win = { x0, x1, y0, y1 };
  const X = (x: number): number => ML + ((x - x0) / (x1 - x0)) * pw;
  const Y = (y: number): number => MT + ph - ((y - y0) / (y1 - y0)) * ph;

  // --- region: window clipped by every half-plane ---
  let poly: Pt[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const halves: Half[] = [];
  for (const r of spec.rows) {
    if (r.rel === "<=") halves.push({ n: r.a, k: r.b });
    else if (r.rel === ">=") halves.push({ n: [-r.a[0], -r.a[1]], k: -r.b });
    else {
      halves.push({ n: r.a, k: r.b });
      halves.push({ n: [-r.a[0], -r.a[1]], k: -r.b });
    }
  }
  if (spec.nonneg[0]) halves.push({ n: [-1, 0], k: 0 });
  if (spec.nonneg[1]) halves.push({ n: [0, -1], k: 0 });
  for (const h of halves) poly = clipPolygon(poly, h);
  const hasEquality = spec.rows.some((r) => r.rel === "=");

  // Every straight segment drawn, in pixels — the label placer avoids them all.
  const segs: Seg[] = [];
  const p: string[] = [];
  const drawLine = (ax: number, ay: number, bx: number, by: number, attrs: string): void => {
    segs.push({ x0: ax, y0: ay, x1: bx, y1: by });
    p.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" ${attrs}/>`);
  };

  // Every label's box, including the ticks and axis names drawn first, so the
  // scored labels keep clear of them too.
  const placed: Box[] = [];
  const boxFor = (x: number, y: number, anchor: "start" | "middle" | "end", text: string, fs: number): Box => {
    const w = text.length * fs * ADVANCE;
    const h = fs * LINE;
    const bx0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    return { x0: bx0, y0: y - h * 0.8, x1: bx0 + w, y1: y + h * 0.2 };
  };
  const fixedText = (x: number, y: number, anchor: "start" | "middle" | "end", text: string, fs: number, fill: string): void => {
    placed.push(boxFor(x, y, anchor, text, fs));
    p.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${fill}" font-size="${fs}">${esc(text)}</text>`);
  };

  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif" font-size="11">`);
  p.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  fixedText(W / 2, 17, "middle", spec.caption, 12, "#1A1A1A");

  // axes
  const axisX = Y(0) >= MT && Y(0) <= MT + ph ? Y(0) : MT + ph;
  const axisY = X(0) >= ML && X(0) <= ML + pw ? X(0) : ML;
  drawLine(ML, axisX, ML + pw, axisX, 'stroke="#1A1A1A" stroke-width="1"');
  drawLine(axisY, MT, axisY, MT + ph, 'stroke="#1A1A1A" stroke-width="1"');
  // Ticks: a handful on each axis, as axis.ts ROWS. `String(v)` per value gave
  // `-1, -0.5` (hyphen-minus), `0, 0.5, 1, 1.5` (mixed decimals) and would give
  // `1e-7`. A row's ×10ⁿ multiplier goes on the variable's name.
  const xRow = linearAxis(x0, x1, { target: 5 });
  const yRow = linearAxis(y0, y1, { target: 5 });
  const withMult = (name: string, m: string): string => (m ? `${name} (${m})` : name);
  fixedText(ML + pw, H - 8, "end", withMult(spec.vars[0], xRow.multiplier), 11, "#7B8C99");
  fixedText(ML - 40, MT + 10, "start", withMult(spec.vars[1], yRow.multiplier), 11, "#7B8C99");
  xRow.values.forEach((v, i) => {
    drawLine(X(v), axisX - 3, X(v), axisX + 3, 'stroke="#1A1A1A"');
    fixedText(X(v), H - 22, "middle", xRow.labels[i], 9, "#7B8C99");
  });
  yRow.values.forEach((v, i) => {
    drawLine(axisY - 3, Y(v), axisY + 3, Y(v), 'stroke="#1A1A1A"');
    fixedText(ML - 6, Y(v) + 3, "end", yRow.labels[i], 9, "#7B8C99");
  });

  // region
  if (poly.length >= 3 && !hasEquality) {
    p.push(`<polygon points="${poly.map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(" ")}" fill="#9DB3C4" fill-opacity="0.45" stroke="none"/>`);
  } else if (poly.length >= 2 && hasEquality) {
    // The region is a segment (or a point) of the equality line.
    p.push(`<polyline points="${poly.map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="#0C4A6E" stroke-width="4" stroke-opacity="0.5"/>`);
    for (let i = 0; i + 1 < poly.length; i++) segs.push({ x0: X(poly[i][0]), y0: Y(poly[i][1]), x1: X(poly[i + 1][0]), y1: Y(poly[i + 1][1]) });
  }

  // constraint lines (labels come last)
  const lineSegs: ([Pt, Pt] | null)[] = spec.rows.map((r) => clipLine(r.a, r.b, win));
  spec.rows.forEach((r, i) => {
    const seg = lineSegs[i];
    if (!seg) return;
    drawLine(X(seg[0][0]), Y(seg[0][1]), X(seg[1][0]), Y(seg[1][1]), `stroke="${COLOURS[i % COLOURS.length]}" stroke-width="1.4"`);
  });

  // alternative-optima edge
  if (spec.altEdge) {
    const [a, b] = spec.altEdge;
    drawLine(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), 'stroke="#0C4A6E" stroke-width="4" stroke-opacity="0.7"');
  }

  // objective contour through the optimum, dashed, with the improving arrow
  const arrowHead = (fx: number, fy: number, tx: number, ty: number, colour: string): void => {
    const ang = Math.atan2(ty - fy, tx - fx);
    const h = 7;
    const a1x = tx - h * Math.cos(ang - 0.45);
    const a1y = ty - h * Math.sin(ang - 0.45);
    const a2x = tx - h * Math.cos(ang + 0.45);
    const a2y = ty - h * Math.sin(ang + 0.45);
    p.push(`<polygon points="${tx.toFixed(1)},${ty.toFixed(1)} ${a1x.toFixed(1)},${a1y.toFixed(1)} ${a2x.toFixed(1)},${a2y.toFixed(1)}" fill="${colour}"/>`);
  };
  if (spec.optimum && (Math.abs(spec.c[0]) > 1e-12 || Math.abs(spec.c[1]) > 1e-12)) {
    const zv = spec.c[0] * spec.optimum[0] + spec.c[1] * spec.optimum[1];
    const seg = clipLine(spec.c, zv, win);
    if (seg) drawLine(X(seg[0][0]), Y(seg[0][1]), X(seg[1][0]), Y(seg[1][1]), 'stroke="#1A1A1A" stroke-width="1.2" stroke-dasharray="6 4"');
    // arrow in pixel space along the improving direction
    const dirSign = spec.sense === "max" ? 1 : -1;
    const dxp = dirSign * spec.c[0] * (pw / (x1 - x0));
    const dyp = -dirSign * spec.c[1] * (ph / (y1 - y0));
    const len = Math.hypot(dxp, dyp) || 1;
    const fx = X(spec.optimum[0]);
    const fy = Y(spec.optimum[1]);
    const tx = fx + (dxp / len) * 34;
    const ty = fy + (dyp / len) * 34;
    drawLine(fx, fy, tx, ty, 'stroke="#1A1A1A" stroke-width="1.4"');
    arrowHead(fx, fy, tx, ty, "#1A1A1A");
  }

  // unbounded ray
  let rayMid: { x: number; y: number; dx: number; dy: number } | null = null;
  if (spec.ray) {
    const { from, dir } = spec.ray;
    // extend to the window edge
    let tMax = Infinity;
    if (dir[0] > 1e-12) tMax = Math.min(tMax, (x1 - from[0]) / dir[0]);
    if (dir[0] < -1e-12) tMax = Math.min(tMax, (x0 - from[0]) / dir[0]);
    if (dir[1] > 1e-12) tMax = Math.min(tMax, (y1 - from[1]) / dir[1]);
    if (dir[1] < -1e-12) tMax = Math.min(tMax, (y0 - from[1]) / dir[1]);
    if (Number.isFinite(tMax) && tMax > 0) {
      const to: Pt = [from[0] + dir[0] * tMax, from[1] + dir[1] * tMax];
      drawLine(X(from[0]), Y(from[1]), X(to[0]), Y(to[1]), 'stroke="#b91c1c" stroke-width="2.2"');
      arrowHead(X(from[0]), Y(from[1]), X(to[0]), Y(to[1]), "#b91c1c");
      p.push(`<circle cx="${X(from[0]).toFixed(1)}" cy="${Y(from[1]).toFixed(1)}" r="3.5" fill="#b91c1c"/>`);
      rayMid = { x: X(from[0] + dir[0] * tMax * 0.5), y: Y(from[1] + dir[1] * tMax * 0.5), dx: X(to[0]) - X(from[0]), dy: Y(to[1]) - Y(from[1]) };
    }
  }

  // optimum marker
  if (spec.optimum) {
    p.push(`<circle cx="${X(spec.optimum[0]).toFixed(1)}" cy="${Y(spec.optimum[1]).toFixed(1)}" r="4.5" fill="#0C4A6E" stroke="#fff" stroke-width="1.2"/>`);
  }
  if (spec.integerPoint) {
    const ix = X(spec.integerPoint[0]);
    const iy = Y(spec.integerPoint[1]);
    p.push(`<rect x="${(ix - 4).toFixed(1)}" y="${(iy - 4).toFixed(1)}" width="8" height="8" fill="#047857" stroke="#fff" stroke-width="1"/>`);
  }

  // --- labels, placed by score and painted last on a white halo ---
  const score = (b: Box): number => {
    if (b.x0 < 2 || b.x1 > W - 2 || b.y0 < MT - 8 || b.y1 > H - 2) return Infinity;
    let s = 0;
    for (const sg of segs) if (segmentHitsBox(sg, b)) s += 1;
    for (const o of placed) if (boxesOverlap(o, b)) s += 3;
    return s;
  };
  const putLabel = (cands: { x: number; y: number; anchor: "start" | "middle" | "end" }[], text: string, fs: number, colour: string, bold = false): void => {
    let best: { x: number; y: number; anchor: "start" | "middle" | "end"; box: Box; s: number } | null = null;
    for (const c of cands) {
      const box = boxFor(c.x, c.y, c.anchor, text, fs);
      const s = score(box);
      if (!best || s < best.s) best = { ...c, box, s };
    }
    if (!best) return;
    let { x, y, anchor, box } = best;
    // Still outside? Slide it back inside the canvas.
    if (!Number.isFinite(best.s)) {
      const w = box.x1 - box.x0;
      const h = box.y1 - box.y0;
      let bx0 = Math.min(Math.max(box.x0, 2), W - 2 - w);
      let by0 = Math.min(Math.max(box.y0, MT - 8), H - 2 - h);
      x = anchor === "middle" ? bx0 + w / 2 : anchor === "end" ? bx0 + w : bx0;
      y = by0 + h * 0.8;
      box = { x0: bx0, y0: by0, x1: bx0 + w, y1: by0 + h };
    }
    placed.push(box);
    p.push(`<rect x="${(box.x0 - 1).toFixed(1)}" y="${(box.y0 - 1).toFixed(1)}" width="${(box.x1 - box.x0 + 2).toFixed(1)}" height="${(box.y1 - box.y0 + 2).toFixed(1)}" fill="#ffffff" fill-opacity="1" rx="2"/>`);
    p.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${colour}" font-size="${fs}"${bold ? ' font-weight="bold"' : ""}>${esc(text)}</text>`);
  };

  // constraint labels: along the line, offset perpendicular to it on either side
  spec.rows.forEach((r, i) => {
    const seg = lineSegs[i];
    if (!seg) return;
    const ax = X(seg[0][0]);
    const ay = Y(seg[0][1]);
    const bx = X(seg[1][0]);
    const by = Y(seg[1][1]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const cands: { x: number; y: number; anchor: "start" | "middle" | "end" }[] = [];
    for (const f of [0.08, 0.92, 0.3, 0.7, 0.5, 0.18, 0.82]) {
      const px = ax + f * (bx - ax);
      const py = ay + f * (by - ay);
      for (const side of [1, -1]) {
        for (const off of [9, 16]) {
          const lx = px + side * nx * off;
          const ly = py + side * ny * off;
          cands.push({ x: lx, y: ly + 3, anchor: side * nx >= 0 ? "start" : "end" });
          cands.push({ x: lx, y: ly + 3, anchor: "middle" });
        }
      }
    }
    putLabel(cands, r.label, 9, COLOURS[i % COLOURS.length]);
  });

  // optimum label: the diagonal with the fewest crossings
  if (spec.optimum && spec.optimumLabel) {
    const ox = X(spec.optimum[0]);
    const oy = Y(spec.optimum[1]);
    const cands: { x: number; y: number; anchor: "start" | "middle" | "end" }[] = [];
    for (const d of [10, 18]) {
      cands.push({ x: ox + d, y: oy - d + 4, anchor: "start" }, { x: ox - d, y: oy - d + 4, anchor: "end" }, { x: ox + d, y: oy + d + 4, anchor: "start" }, { x: ox - d, y: oy + d + 4, anchor: "end" });
      cands.push({ x: ox, y: oy - d, anchor: "middle" }, { x: ox, y: oy + d + 8, anchor: "middle" });
    }
    putLabel(cands, spec.optimumLabel, 10, "#0C4A6E", true);
  }
  if (spec.integerPoint) {
    const ix = X(spec.integerPoint[0]);
    const iy = Y(spec.integerPoint[1]);
    putLabel([{ x: ix + 8, y: iy + 14, anchor: "start" }, { x: ix - 8, y: iy + 14, anchor: "end" }, { x: ix + 8, y: iy - 8, anchor: "start" }, { x: ix - 8, y: iy - 8, anchor: "end" }], "integer optimum", 10, "#047857");
  }
  // ray caption: beside the ray's midpoint, perpendicular, kept inside the canvas
  if (rayMid) {
    const len = Math.hypot(rayMid.dx, rayMid.dy) || 1;
    const nx = -rayMid.dy / len;
    const ny = rayMid.dx / len;
    const cands: { x: number; y: number; anchor: "start" | "middle" | "end" }[] = [];
    for (const off of [10, 18]) {
      for (const side of [1, -1]) {
        cands.push({ x: rayMid.x + side * nx * off, y: rayMid.y + side * ny * off + 3, anchor: side * nx >= 0 ? "start" : "end" });
        cands.push({ x: rayMid.x + side * nx * off, y: rayMid.y + side * ny * off + 3, anchor: "middle" });
      }
    }
    putLabel(cands, "unbounded along this ray", 10, "#b91c1c");
  }

  if (spec.status === "infeasible") {
    putLabel([{ x: ML + pw / 2, y: MT + ph / 2, anchor: "middle" }, { x: ML + pw / 2, y: MT + ph * 0.25, anchor: "middle" }, { x: ML + pw / 2, y: MT + ph * 0.75, anchor: "middle" }], "feasible region: empty", 12, "#b91c1c", true);
  }
  p.push("</svg>");
  return p.join("");
}
