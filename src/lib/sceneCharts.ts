// Figures for the Scene modelling & pipeline calculators (sceneCalcs.ts).
//
// The geometry figures (Bézier, NURBS, the mesh wireframe, the ray and its primitive) are drawn on EQUAL SCALES, the
// controlCharts.ts way: a circle has to be a circle and a curve's shape is the result. Every label sits OUTSIDE the
// plot frame (ticks below and left, a key underneath), and every line inside the frame is clipped to it
// geometrically (Liang–Barsky), never with a clipPath: a ray runs to infinity by nature, and the figure-layout audit
// reads the segments a clipPath would only hide. The pipeline figures (polycount, LOD bands, texture memory, farm
// completion, pipeline throughput) are ordinary buildPlotSvg charts.
//
// Colours are literal hex (inserted artwork never follows the pane's theme); Arial, as the other chart modules.

import { linearAxis, fmtSig } from "./axis";
import type { Vec } from "./sceneCurves";
import { buildPlotSvg, type Series } from "./plot";
import { hBarSvg } from "./mechchart";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#111111";
const RULE = "#9ca3af";
const GRID = "#e5e7eb";
const PAPER = "#ffffff";
const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#6b7280";
const ORANGE = "#d46a00";
const PURPLE = "#6d28d9";

const f = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function text(x: number, y: number, t: string, opts: { anchor?: string; size?: number; fill?: string; rotate?: boolean } = {}): string {
  const a = opts.anchor ?? "start";
  const rot = opts.rotate ? ` transform="rotate(-90 ${f(x)} ${f(y)})"` : "";
  return `<text x="${f(x)}" y="${f(y)}" text-anchor="${a}" font-family="${FONT}" font-size="${opts.size ?? 9}" fill="${opts.fill ?? INK}"${rot}>${esc(t)}</text>`;
}
/** Four significant figures, trailing zeros dropped: a label, not a measurement. */
export const sig4 = (v: number): string => fmtSig(Number(v.toPrecision(4)), 4).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

export const SCENE_W = 460;

interface P2 {
  x: number;
  y: number;
}

interface Frame {
  W: number;
  H: number;
  ML: number;
  MT: number;
  pw: number;
  ph: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  X: (v: number) => number;
  Y: (v: number) => number;
}

/** An equal-scale frame around the points, with room for `keyLines` lines of key underneath. */
function equalFrame(pts: P2[], keyLines: number, pad = 0.08): Frame {
  const W = SCENE_W;
  const ML = 52;
  const MR = 14;
  const MT = 12;
  const pw = W - ML - MR;
  const ph = 250;
  const H = MT + ph + 34 + keyLines * 13 + 8;
  const fin = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  let xlo = fin.length ? Math.min(...fin.map((p) => p.x)) : -1;
  let xhi = fin.length ? Math.max(...fin.map((p) => p.x)) : 1;
  let ylo = fin.length ? Math.min(...fin.map((p) => p.y)) : -1;
  let yhi = fin.length ? Math.max(...fin.map((p) => p.y)) : 1;
  const span = Math.max(xhi - xlo, yhi - ylo);
  const minHalf = span > 0 ? 0.02 * span : Math.max(1, Math.abs(xlo), Math.abs(ylo)) * 0.5;
  if (xhi - xlo < 2 * minHalf) {
    const c = (xlo + xhi) / 2;
    xlo = c - minHalf;
    xhi = c + minHalf;
  }
  if (yhi - ylo < 2 * minHalf) {
    const c = (ylo + yhi) / 2;
    ylo = c - minHalf;
    yhi = c + minHalf;
  }
  const sx = xhi - xlo;
  const sy = yhi - ylo;
  xlo -= pad * sx;
  xhi += pad * sx;
  ylo -= pad * sy;
  yhi += pad * sy;
  const k = Math.min(pw / (xhi - xlo), ph / (yhi - ylo));
  const cx = (xlo + xhi) / 2;
  const cy = (ylo + yhi) / 2;
  const x0 = cx - pw / k / 2;
  const x1 = cx + pw / k / 2;
  const y0 = cy - ph / k / 2;
  const y1 = cy + ph / k / 2;
  return { W, H, ML, MT, pw, ph, x0, x1, y0, y1, X: (v) => ML + (v - x0) * k, Y: (v) => MT + ph - (v - y0) * k };
}

/** Liang–Barsky: the part of segment a–b inside the frame, or null. */
function clipSeg(F: Frame, a: P2, b: P2): [P2, P2] | null {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tests: Array<[number, number]> = [
    [-dx, a.x - F.x0],
    [dx, F.x1 - a.x],
    [-dy, a.y - F.y0],
    [dy, F.y1 - a.y],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** A polyline through data points, clipped to the frame. */
function polyline(F: Frame, pts: P2[], attrs: string): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length >= 2) out.push(`<polyline points="${run.join(" ")}" fill="none" ${attrs}/>`);
    run = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = clipSeg(F, pts[i], pts[i + 1]);
    if (!seg) {
      flush();
      continue;
    }
    const p0 = `${f(F.X(seg[0].x))},${f(F.Y(seg[0].y))}`;
    const p1 = `${f(F.X(seg[1].x))},${f(F.Y(seg[1].y))}`;
    if (!run.length) run.push(p0);
    else if (run[run.length - 1] !== p0) {
      flush();
      run.push(p0);
    }
    run.push(p1);
    if (seg[1].x !== pts[i + 1].x || seg[1].y !== pts[i + 1].y) flush();
  }
  flush();
  return out.join("");
}

const inside = (F: Frame, p: P2): boolean => p.x >= F.x0 && p.x <= F.x1 && p.y >= F.y0 && p.y <= F.y1;
const dotAt = (F: Frame, p: P2, colour: string, r = 3): string => (inside(F, p) ? `<circle cx="${f(F.X(p.x))}" cy="${f(F.Y(p.y))}" r="${r}" fill="${colour}"/>` : "");
const ringAt = (F: Frame, p: P2, colour: string, r = 3.6): string =>
  inside(F, p) ? `<circle cx="${f(F.X(p.x))}" cy="${f(F.Y(p.y))}" r="${r}" fill="${PAPER}" stroke="${colour}" stroke-width="1.4"/>` : "";
const tickAt = (F: Frame, p: P2, colour: string): string => {
  if (!inside(F, p)) return "";
  const x = F.X(p.x);
  const y = F.Y(p.y);
  return `<line x1="${f(x - 4)}" y1="${f(y - 4)}" x2="${f(x + 4)}" y2="${f(y + 4)}" stroke="${colour}" stroke-width="1.6"/><line x1="${f(x - 4)}" y1="${f(y + 4)}" x2="${f(x + 4)}" y2="${f(y - 4)}" stroke="${colour}" stroke-width="1.6"/>`;
};

/** Frame, grid, ticks and axis titles. */
function frameParts(F: Frame, xTitle: string, yTitle: string): string[] {
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${F.W}" height="${F.H}" viewBox="0 0 ${F.W} ${F.H}">`);
  p.push(`<rect width="${F.W}" height="${F.H}" fill="${PAPER}"/>`);
  const xa = linearAxis(F.x0, F.x1, { target: 6 });
  const ya = linearAxis(F.y0, F.y1, { target: 6 });
  for (const v of xa.values) p.push(`<line x1="${f(F.X(v))}" y1="${F.MT}" x2="${f(F.X(v))}" y2="${F.MT + F.ph}" stroke="${GRID}" stroke-width="0.6"/>`);
  for (const v of ya.values) p.push(`<line x1="${F.ML}" y1="${f(F.Y(v))}" x2="${F.ML + F.pw}" y2="${f(F.Y(v))}" stroke="${GRID}" stroke-width="0.6"/>`);
  if (F.x0 < 0 && F.x1 > 0) p.push(`<line x1="${f(F.X(0))}" y1="${F.MT}" x2="${f(F.X(0))}" y2="${F.MT + F.ph}" stroke="${RULE}" stroke-width="0.8"/>`);
  if (F.y0 < 0 && F.y1 > 0) p.push(`<line x1="${F.ML}" y1="${f(F.Y(0))}" x2="${F.ML + F.pw}" y2="${f(F.Y(0))}" stroke="${RULE}" stroke-width="0.8"/>`);
  p.push(`<rect x="${F.ML}" y="${F.MT}" width="${F.pw}" height="${F.ph}" fill="none" stroke="${RULE}"/>`);
  xa.values.forEach((v, i) => {
    const x = F.X(v);
    p.push(`<line x1="${f(x)}" y1="${F.MT + F.ph}" x2="${f(x)}" y2="${F.MT + F.ph + 3}" stroke="${RULE}"/>`);
    p.push(text(x, F.MT + F.ph + 13, xa.labels[i], { anchor: "middle", size: 8.5 }));
  });
  ya.values.forEach((v, i) => {
    const y = F.Y(v);
    p.push(`<line x1="${F.ML - 3}" y1="${f(y)}" x2="${F.ML}" y2="${f(y)}" stroke="${RULE}"/>`);
    p.push(text(F.ML - 5, y + 3, ya.labels[i], { anchor: "end", size: 8.5 }));
  });
  const xm = xa.multiplier ? ` (${xa.multiplier})` : "";
  const ym = ya.multiplier ? ` (${ya.multiplier})` : "";
  p.push(text(F.ML + F.pw / 2, F.MT + F.ph + 26, xTitle + xm, { anchor: "middle", size: 9.5 }));
  p.push(text(13, F.MT + F.ph / 2, yTitle + ym, { anchor: "middle", size: 9.5, rotate: true }));
  return p;
}

/** The longest key line that fits the width at 8.5 px. */
function fitKey(t: string): string {
  const max = Math.floor((SCENE_W - 16) / (8.5 * 0.56));
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}
function keyBlock(F: Frame, lines: Array<{ t: string; fill?: string }>): string[] {
  const y0 = F.MT + F.ph + 42;
  return lines.map((l, i) => text(8, y0 + i * 13, fitKey(l.t), { size: 8.5, fill: l.fill ?? INK }));
}

const xy = (v: Vec): P2 => ({ x: v[0], y: v[1] });

// ---------------------------------------------------------------------------------------------------------------
// Bézier
// ---------------------------------------------------------------------------------------------------------------

/**
 * The curve, its control polygon, de Casteljau's construction at t (every intermediate level), the point C(t) with
 * its tangent, and the tight bounding box. A 3-D curve is drawn in the x–y plane (z is not shown), which the key says.
 */
export function bezierChartSvg(input: { P: Vec[]; curve: Vec[]; levels: Vec[][]; t: number; point: Vec; tangent: Vec | null; bmin: Vec; bmax: Vec }): string {
  const { P, curve, levels, t, point, tangent, bmin, bmax } = input;
  const is3d = P[0].length === 3;
  const all = [...P.map(xy), ...curve.map(xy), { x: bmin[0], y: bmin[1] }, { x: bmax[0], y: bmax[1] }];
  const F = equalFrame(all, is3d ? 5 : 4);
  const p = frameParts(F, "x", "y");
  // Bounding box.
  const bb = [
    { x: bmin[0], y: bmin[1] },
    { x: bmax[0], y: bmin[1] },
    { x: bmax[0], y: bmax[1] },
    { x: bmin[0], y: bmax[1] },
    { x: bmin[0], y: bmin[1] },
  ];
  p.push(polyline(F, bb, `stroke="${ORANGE}" stroke-width="1" stroke-dasharray="5 3"`));
  // Control polygon.
  p.push(polyline(F, P.map(xy), `stroke="${GREY}" stroke-width="1.1" stroke-dasharray="4 3"`));
  // de Casteljau levels 1 … n−1.
  for (let l = 1; l < levels.length - 1; l++) {
    p.push(polyline(F, levels[l].map(xy), `stroke="${GREEN}" stroke-width="0.9"`));
    for (const q of levels[l]) p.push(dotAt(F, xy(q), GREEN, 2.2));
  }
  // The curve.
  p.push(polyline(F, curve.map(xy), `stroke="${BLUE}" stroke-width="2"`));
  for (const q of P) p.push(ringAt(F, xy(q), GREY));
  // Tangent at t: a segment a fifth of the frame long.
  if (tangent) {
    const len = 0.18 * (F.x1 - F.x0);
    const a = xy(point);
    const tl = Math.hypot(tangent[0], tangent[1]);
    if (tl > 0) p.push(polyline(F, [a, { x: a.x + (tangent[0] / tl) * len, y: a.y + (tangent[1] / tl) * len }], `stroke="${RED}" stroke-width="1.6"`));
  }
  p.push(dotAt(F, xy(point), RED, 3.6));
  p.push(
    ...keyBlock(F, [
      { t: `Blue: the degree-${P.length - 1} curve C(t); grey dashed: its control polygon P₀ to P${toSub(P.length - 1)}.`, fill: BLUE },
      ...(is3d ? [{ t: "Drawn in the x–y plane; z is not shown." }] : []),
      { t: `Green: de Casteljau's construction at t = ${sig4(t)}.`, fill: GREEN },
      { t: `Red: C(${sig4(t)}) = (${point.map(sig4).join(", ")}) and its tangent.`, fill: RED },
      { t: `Orange dashed: the tight bounding box, x ${sig4(bmin[0])} to ${sig4(bmax[0])}, y ${sig4(bmin[1])} to ${sig4(bmax[1])}.`, fill: ORANGE },
    ]),
  );
  p.push("</svg>");
  return p.join("");
}

const SUBS = "₀₁₂₃₄₅₆₇₈₉";
export const toSub = (n: number): string => String(n).replace(/\d/g, (d) => SUBS[Number(d)]);

// ---------------------------------------------------------------------------------------------------------------
// NURBS
// ---------------------------------------------------------------------------------------------------------------

/** The curve, its control polygon, the joints at the knots (× marks), the point at u, and an inserted knot's new polygon. */
export function nurbsChartSvg(input: {
  P: Vec[];
  curve: Vec[];
  knotPoints: Array<{ u: number; point: Vec }>;
  u: number;
  point: Vec;
  degree: number;
  rational: boolean;
  inserted: Vec[] | null;
  circle: { centre: Vec; radius: number } | null;
}): string {
  const { P, curve, knotPoints, u, point, degree, rational, inserted, circle } = input;
  const is3d = P[0].length === 3;
  const all = [...P.map(xy), ...curve.map(xy), ...(inserted ?? []).map(xy)];
  const keyLines = 3 + (circle ? 1 : 0);
  const F = equalFrame(all, keyLines);
  const p = frameParts(F, "x", "y");
  if (circle) {
    const ring: P2[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (2 * Math.PI * i) / 180;
      ring.push({ x: circle.centre[0] + circle.radius * Math.cos(a), y: circle.centre[1] + circle.radius * Math.sin(a) });
    }
    p.push(polyline(F, ring, `stroke="${RULE}" stroke-width="0.8" stroke-dasharray="2 3"`));
  }
  p.push(polyline(F, P.map(xy), `stroke="${GREY}" stroke-width="1.1" stroke-dasharray="4 3"`));
  if (inserted) p.push(polyline(F, inserted.map(xy), `stroke="${PURPLE}" stroke-width="1" stroke-dasharray="1.5 2.5"`));
  p.push(polyline(F, curve.map(xy), `stroke="${BLUE}" stroke-width="2"`));
  for (const q of P) p.push(ringAt(F, xy(q), GREY));
  if (inserted) for (const q of inserted) p.push(dotAt(F, xy(q), PURPLE, 2.2));
  for (const k of knotPoints) p.push(tickAt(F, xy(k.point), GREEN));
  p.push(dotAt(F, xy(point), RED, 3.6));
  const key: Array<{ t: string; fill?: string }> = [
    { t: `Blue: the degree-${degree} ${rational ? "NURBS" : "B-spline"} curve; grey dashed: its ${P.length} control points${is3d ? " (x–y plane, z not shown)" : ""}.`, fill: BLUE },
    { t: `Green ×: the curve at its ${knotPoints.length} distinct knots (the joints between pieces); red: C(${sig4(u)}).`, fill: GREEN },
    inserted ? { t: `Purple dotted: the ${inserted.length} control points after knot insertion (the same curve).`, fill: PURPLE } : { t: "No knot inserted (give one to see the refined control polygon)." },
  ];
  if (circle) key.push({ t: `Dotted grey: the circle of radius ${sig4(circle.radius)} about (${circle.centre.map(sig4).join(", ")}) the arc lies on.` });
  p.push(...keyBlock(F, key));
  p.push("</svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Mesh wireframe
// ---------------------------------------------------------------------------------------------------------------

/** Edges drawn at most; problem edges are always drawn. */
export const WIREFRAME_MAX_EDGES = 6000;
/** Problem edges drawn at most, per kind (boundary, inconsistent, non-manifold). */
export const WIREFRAME_MAX_PROBLEM_EDGES = 1500;

/**
 * An orthographic wireframe from a fixed three-quarter view (azimuth −35°, elevation 25°), all edges grey, with the
 * boundary edges orange, non-manifold edges red and inconsistently wound edges purple, drawn over them.
 */
export function meshWireframeSvg(input: {
  V: Vec[];
  edges: Array<[number, number]>;
  boundary: Array<[number, number]>;
  nonManifold: Array<[number, number]>;
  inconsistent: Array<[number, number]>;
}): string {
  const az = (-35 * Math.PI) / 180;
  const el = (25 * Math.PI) / 180;
  const proj = (v: Vec): P2 => {
    const x = v[0] * Math.cos(az) - v[1] * Math.sin(az);
    const yv = v[0] * Math.sin(az) + v[1] * Math.cos(az);
    return { x, y: v[2] * Math.cos(el) - yv * Math.sin(el) };
  };
  const used = new Set<number>();
  for (const [a, b] of input.edges) {
    used.add(a);
    used.add(b);
  }
  const P = input.V.map(proj);
  const pts = [...used].map((i) => P[i]);
  const F = equalFrame(pts, 3, 0.06);
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${F.W}" height="${F.H}" viewBox="0 0 ${F.W} ${F.H}">`);
  p.push(`<rect width="${F.W}" height="${F.H}" fill="${PAPER}"/>`);
  p.push(`<rect x="${F.ML}" y="${F.MT}" width="${F.pw}" height="${F.ph}" fill="none" stroke="${RULE}"/>`);
  p.push(text(F.ML + F.pw / 2, F.MT + F.ph + 16, "Orthographic view from azimuth −35°, elevation 25° (z up); shape only, no axes", { anchor: "middle", size: 9 }));
  const seg = (e: [number, number], attrs: string): string => polyline(F, [P[e[0]], P[e[1]]], attrs);
  const drawn = input.edges.slice(0, WIREFRAME_MAX_EDGES);
  p.push(drawn.map((e) => seg(e, `stroke="${GREY}" stroke-width="0.7"`)).join(""));
  // Problem edges are drawn over the grey ones, each kind capped too (a triangle soup is all boundary).
  const cap = (es: Array<[number, number]>): Array<[number, number]> => es.slice(0, WIREFRAME_MAX_PROBLEM_EDGES);
  p.push(cap(input.boundary).map((e) => seg(e, `stroke="${ORANGE}" stroke-width="2.2"`)).join(""));
  p.push(cap(input.inconsistent).map((e) => seg(e, `stroke="${PURPLE}" stroke-width="2.2" stroke-dasharray="4 2"`)).join(""));
  p.push(cap(input.nonManifold).map((e) => seg(e, `stroke="${RED}" stroke-width="2.6"`)).join(""));
  const g = (n: number): string => n.toLocaleString("en-US");
  const capped = input.edges.length > WIREFRAME_MAX_EDGES ? ` (the first ${g(WIREFRAME_MAX_EDGES)} drawn)` : "";
  const over = [input.boundary, input.inconsistent, input.nonManifold].some((es) => es.length > WIREFRAME_MAX_PROBLEM_EDGES);
  p.push(
    ...keyBlock(F, [
      { t: `Grey: ${g(input.edges.length)} edges${capped}${over ? `; problem edges: first ${g(WIREFRAME_MAX_PROBLEM_EDGES)} of each kind` : ""}.`, fill: GREY },
      { t: `Orange: ${g(input.boundary.length)} boundary edge${input.boundary.length === 1 ? "" : "s"} (one face); red: ${g(input.nonManifold.length)} non-manifold (3+ faces).`, fill: input.nonManifold.length ? RED : ORANGE },
      { t: `Purple dashed: ${g(input.inconsistent.length)} edge${input.inconsistent.length === 1 ? "" : "s"} whose two faces run the same way (inconsistent winding).`, fill: PURPLE },
    ]),
  );
  p.push("</svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Ray and primitive
// ---------------------------------------------------------------------------------------------------------------

/**
 * The ray and the primitive in the plane containing the ray and the primitive's centre: x along the ray from its
 * origin, y across it. A sphere's section in that plane is a great circle (exact); a box's and a triangle's edges
 * are projected orthographically onto the plane.
 */
export function rayChartSvg(input: {
  o: Vec;
  d: Vec;
  kind: "sphere" | "box" | "triangle";
  centre: Vec;
  shapes3d: Vec[][];
  sphereR: number | null;
  hit: Vec | null;
  hitLabel: string;
  tEnd: number;
}): string {
  const { o, d, centre } = input;
  const oc = [centre[0] - o[0], centre[1] - o[1], centre[2] - o[2]];
  const along = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
  let e2 = [oc[0] - along * d[0], oc[1] - along * d[1], oc[2] - along * d[2]];
  let l2 = Math.hypot(e2[0], e2[1], e2[2]);
  if (!(l2 > 1e-9 * Math.max(1, Math.hypot(oc[0], oc[1], oc[2])))) {
    // The centre is on the ray's line: any perpendicular will do; take the one nearest world up (z), else x.
    const up = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const k = up[0] * d[0] + up[1] * d[1] + up[2] * d[2];
    e2 = [up[0] - k * d[0], up[1] - k * d[1], up[2] - k * d[2]];
    l2 = Math.hypot(e2[0], e2[1], e2[2]);
  }
  e2 = e2.map((v) => v / l2);
  const to2 = (p: Vec): P2 => {
    const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return { x: q[0] * d[0] + q[1] * d[1] + q[2] * d[2], y: q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2] };
  };
  const shapes: P2[][] = [];
  if (input.sphereR !== null) {
    const c2 = to2(centre);
    const ring: P2[] = [];
    for (let i = 0; i <= 180; i++) ring.push({ x: c2.x + input.sphereR * Math.cos((2 * Math.PI * i) / 180), y: c2.y + input.sphereR * Math.sin((2 * Math.PI * i) / 180) });
    shapes.push(ring);
  } else for (const s of input.shapes3d) shapes.push(s.map(to2));
  const end = { x: input.tEnd, y: 0 };
  const all = [...shapes.flat(), { x: 0, y: 0 }, end];
  const F = equalFrame(all, 2, 0.1);
  const p = frameParts(F, "Distance along the ray from its origin", "Across the ray");
  for (const s of shapes) p.push(polyline(F, s, `stroke="${BLUE}" stroke-width="1.6"`));
  p.push(polyline(F, [{ x: 0, y: 0 }, end], `stroke="${RED}" stroke-width="1.4"`));
  p.push(ringAt(F, { x: 0, y: 0 }, RED));
  if (input.hit) p.push(dotAt(F, to2(input.hit), RED, 3.8));
  const what = input.kind === "sphere" ? "the sphere's great circle" : input.kind === "box" ? "the box's edges, projected" : "the triangle, projected";
  p.push(
    ...keyBlock(F, [
      { t: `Blue: ${what} (the plane of the ray and the ${input.kind === "triangle" ? "centroid" : "centre"}).`, fill: BLUE },
      { t: `Red: the ray from its origin (open circle); ${input.hitLabel}`, fill: RED },
    ]),
  );
  p.push("</svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Bounding volumes and the SAH split
// ---------------------------------------------------------------------------------------------------------------

/** The points in the plane of their two widest axes (always including the split axis), the box, both spheres, the split. */
export function boundingChartSvg(input: { P: Vec[]; bmin: Vec; bmax: Vec; centred: { c: Vec; r: number }; ritter: { c: Vec; r: number }; split: { axis: number; position: number } | null }): string {
  const ext = [0, 1, 2].map((j) => input.bmax[j] - input.bmin[j]);
  let axes = [0, 1, 2].sort((a, b) => ext[b] - ext[a]).slice(0, 2);
  if (input.split && !axes.includes(input.split.axis)) axes = [input.split.axis, axes[0]];
  axes.sort((a, b) => a - b);
  const [ax, ay] = axes;
  const AX = ["x", "y", "z"];
  const q = (v: Vec): P2 => ({ x: v[ax], y: v[ay] });
  const circle = (c: Vec, r: number): P2[] => {
    const out: P2[] = [];
    for (let i = 0; i <= 180; i++) out.push({ x: c[ax] + r * Math.cos((2 * Math.PI * i) / 180), y: c[ay] + r * Math.sin((2 * Math.PI * i) / 180) });
    return out;
  };
  const c1 = circle(input.centred.c, input.centred.r);
  const c2 = circle(input.ritter.c, input.ritter.r);
  const F = equalFrame([...input.P.map(q), ...c1, ...c2], 3, 0.05);
  const p = frameParts(F, AX[ax], AX[ay]);
  p.push(polyline(F, [q(input.bmin), { x: input.bmax[ax], y: input.bmin[ay] }, q(input.bmax), { x: input.bmin[ax], y: input.bmax[ay] }, q(input.bmin)], `stroke="${ORANGE}" stroke-width="1.6"`));
  p.push(polyline(F, c1, `stroke="${GREY}" stroke-width="1.2" stroke-dasharray="4 3"`));
  p.push(polyline(F, c2, `stroke="${GREEN}" stroke-width="1.4"`));
  if (input.split) {
    const s = input.split;
    const line = s.axis === ax ? [{ x: s.position, y: F.y0 }, { x: s.position, y: F.y1 }] : [{ x: F.x0, y: s.position }, { x: F.x1, y: s.position }];
    p.push(polyline(F, line, `stroke="${RED}" stroke-width="1.4" stroke-dasharray="6 3"`));
  }
  for (const v of input.P.slice(0, 2000)) p.push(dotAt(F, q(v), BLUE, 2.4));
  p.push(
    ...keyBlock(F, [
      { t: `Blue: ${input.P.length} points in the ${AX[ax]}–${AX[ay]} plane; orange: the axis-aligned box.`, fill: BLUE },
      { t: `Grey dashed: the sphere about the box centre (r ${sig4(input.centred.r)}); green: Ritter's sphere (r ${sig4(input.ritter.r)}).`, fill: GREEN },
      { t: input.split ? `Red dashed: the split plane ${AX[input.split.axis]} = ${sig4(input.split.position)}.` : "No split drawn.", fill: RED },
    ]),
  );
  p.push("</svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Pipeline charts (ordinary axes)
// ---------------------------------------------------------------------------------------------------------------

/** Faces or triangles per subdivision level on a log axis, with the budget line. */
export function polycountChartSvg(levels: Array<{ level: number; T: number }>, budget: number | null, what: string): string {
  const n = levels[levels.length - 1].level;
  const pts = levels.map((l) => ({ x: l.level, y: l.T }));
  const series: Series[] = [
    { points: pts, type: "line", color: BLUE, label: what },
    { points: pts, type: "scatter", color: BLUE },
  ];
  if (budget !== null) series.push({ points: [{ x: 0, y: budget }, { x: Math.max(1, n), y: budget }], type: "line", color: RED, label: `budget ${Math.round(budget).toLocaleString("en-US")}` });
  return buildPlotSvg(series, {
    xlabel: "Subdivision level",
    ylabel: `${what} (log scale)`,
    yScale: "log",
    xLimits: { min: 0, max: Math.max(1, n) },
    xTickLabel: (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : ""),
    width: SCENE_W,
    height: Math.round(SCENE_W * 0.66),
  });
}

/** Projected diameter in pixels against distance (log–log), the pixel-error switch distances as vertical lines. */
export function lodChartSvg(input: { focal: number; r: number; bands: Array<{ name: string; switchDistance: number }>; d: number }): string {
  const ds = input.bands.map((b) => b.switchDistance).filter((v) => v > 0);
  const lo = Math.min(input.d, ...ds) / 4;
  const hi = Math.max(input.d, ...ds) * 4;
  const size = (x: number): number => (2 * input.focal * input.r) / x;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 200; i++) {
    const x = lo * Math.pow(hi / lo, i / 200);
    pts.push({ x, y: size(x) });
  }
  const COLS = [GREEN, ORANGE, PURPLE, GREY, RED];
  const series: Series[] = [{ points: pts, type: "line", color: BLUE, label: "projected diameter" }];
  input.bands.forEach((b, i) => {
    if (i === 0 || !(b.switchDistance > 0)) return;
    series.push({ points: [{ x: b.switchDistance, y: size(hi) }, { x: b.switchDistance, y: size(lo) }], type: "line", color: COLS[(i - 1) % COLS.length], label: `${b.name} from ${sig4(b.switchDistance)} m` });
  });
  series.push({ points: [{ x: input.d, y: size(input.d) }], type: "scatter", color: RED, label: `at ${sig4(input.d)} m` });
  return buildPlotSvg(series, {
    xlabel: "Distance (m, log scale)",
    ylabel: "Projected diameter (px, log scale)",
    xScale: "log",
    yScale: "log",
    xLimits: { min: lo, max: hi },
    yLimits: { min: size(hi), max: size(lo) },
    width: SCENE_W,
    height: Math.round(SCENE_W * 0.66),
  });
}

/** Completion time against node count, the deadline line and this farm's point. */
export function farmChartSvg(curve: Array<{ n: number; hours: number }>, deadlineH: number | null, nodes: number, hours: number): string {
  const series: Series[] = [{ points: curve.map((c) => ({ x: c.n, y: c.hours })), type: "line", color: BLUE, label: "completion" }];
  if (deadlineH !== null) series.push({ points: [{ x: curve[0].n, y: deadlineH }, { x: curve[curve.length - 1].n, y: deadlineH }], type: "line", color: RED, label: `deadline ${sig4(deadlineH)} h` });
  series.push({ points: [{ x: nodes, y: hours }], type: "scatter", color: ORANGE, label: `${nodes} nodes: ${sig4(hours)} h` });
  const ys = [...curve.map((c) => c.hours), deadlineH ?? hours, hours].filter((v) => v > 0);
  return buildPlotSvg(series, {
    xlabel: "Render nodes",
    ylabel: "Completion (h, log scale)",
    yScale: "log",
    yLimits: { min: Math.min(...ys) / 1.5, max: Math.max(...ys) * 1.5 },
    xLimits: { min: curve[0].n, max: curve[curve.length - 1].n },
    width: SCENE_W,
    height: Math.round(SCENE_W * 0.66),
  });
}

/** Named horizontal bars (texture memory per format, a texture budget, stage capacities). */
export function sceneBarsSvg(rows: Array<{ name: string; value: number; text: string; colour?: string }>, title: string, unit: string): string {
  return hBarSvg(rows, { title, unit, w: SCENE_W });
}

