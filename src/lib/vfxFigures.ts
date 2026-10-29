// Figures for the VFX & compositing calculators, part 2 (part 1, time, is vfxCharts.ts): sensor field-of-view wedges,
// the top-down projection and parallax diagram, axes before and after a transform, the shading vectors, a camera log
// curve with its point, compositing swatches and channel bars, the chroma-key CbCr plane, the Froude frame-rate curve
// and the bouncing drop. Diagrams place every label clear of every other label and every drawn segment; a label that
// cannot be placed is left to the key beneath the figure, which names everything drawn.

import { buildPlotSvg, type Series } from "./plot";
import { BLUE, RED, GREEN, GREY, LIGHT, INK, ORANGE, PURPLE, PAPER, W, H, esc, textW, f1, svgOpen, text, sig, fitText } from "./vfxCharts";
import type { ProjectionInput, ProjectionResult, Vec3 } from "./vfxCamera";
import type { ShadingResult, TransformResult } from "./vfxGeometry";
import { srgbEncode, type LogCurve } from "./vfxColour";
import { G0 } from "./vfxSim";

// ---------------------------------------------------------------------------------------------------------------
// Label placement: boxes as the layout audit measures them, kept off each other and off every segment.
// ---------------------------------------------------------------------------------------------------------------

type Box = [number, number, number, number];
type Seg = [number, number, number, number];

function boxOf(x: number, y: number, s: string, size: number, anchor: "start" | "middle" | "end"): Box {
  const w = textW(s, size);
  const x0 = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  return [x0 - 1, y - size * 0.78 - 1, x0 + w + 1, y + 2];
}
const overlap = (a: Box, b: Box): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function segHitsBox(s: Seg, b: Box): boolean {
  // Liang–Barsky clip of the segment against the box.
  let t0 = 0;
  let t1 = 1;
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const p = [-dx, dx, -dy, dy];
  const q = [s[0] - b[0], b[2] - s[0], s[1] - b[1], b[3] - s[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

class Layout {
  boxes: Box[] = [];
  segs: Seg[] = [];
  out: string[];
  constructor(out: string[], private w: number, private h: number) {
    this.out = out;
  }
  line(x1: number, y1: number, x2: number, y2: number, colour: string, width = 1.5, extra = ""): void {
    this.segs.push([x1, y1, x2, y2]);
    this.out.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${colour}" stroke-width="${width}"${extra}/>`);
  }
  /** Places a label if it is clear of every label, every segment and the canvas edge. */
  label(x: number, y: number, s: string, size: number, anchor: "start" | "middle" | "end", colour = INK): boolean {
    const b = boxOf(x, y, s, size, anchor);
    if (b[0] < 1 || b[1] < 1 || b[2] > this.w - 1 || b[3] > this.h - 1) return false;
    if (this.boxes.some((o) => overlap(o, b)) || this.segs.some((sg) => segHitsBox(sg, b))) return false;
    this.boxes.push(b);
    this.out.push(text(x, y, s, anchor, ` font-size="${size}" fill="${colour}"`));
    return true;
  }
  /** A label that must appear (titles, keys): reserved first so later labels avoid it. */
  fixed(x: number, y: number, s: string, size: number, anchor: "start" | "middle" | "end", colour = INK): void {
    this.boxes.push(boxOf(x, y, s, size, anchor));
    this.out.push(text(x, y, s, anchor, ` font-size="${size}" fill="${colour}"`));
  }
}

/** A key row: a colour swatch and its text, one per line from y. */
function key(L: Layout, x: number, y: number, rows: Array<{ colour: string; text: string }>, size = 9): number {
  rows.forEach((r, i) => {
    const yy = y + i * (size + 5);
    L.out.push(`<rect x="${f1(x)}" y="${f1(yy - size + 1)}" width="10" height="${size - 1}" fill="${r.colour}"/>`);
    L.fixed(x + 15, yy, fitText(r.text, size, W - x - 32), size, "start");
  });
  return y + rows.length * (size + 5);
}

// ---------------------------------------------------------------------------------------------------------------
// Camera match: field-of-view wedges seen from above
// ---------------------------------------------------------------------------------------------------------------

export interface Wedge {
  label: string;
  /** Full horizontal field of view, degrees. */
  fov: number;
  colour: string;
}

/** Horizontal field-of-view wedges from one lens position, seen from above, widest drawn first. */
export function fovWedgesSvg(wedges: Wedge[], title: string): string {
  const w = W;
  const len = 190;
  const apexY = 30 + len;
  const keyTop = apexY + 26;
  const h = keyTop + wedges.length * 14 + 4;
  const out = svgOpen(w, h);
  const L = new Layout(out, w, h);
  L.fixed(w / 2, 16, fitText(title, 11, w - 24), 11, "middle");
  const cx = w / 2;
  const sorted = [...wedges].sort((a, b) => b.fov - a.fov);
  for (const wd of sorted) {
    const half = (Math.min(wd.fov, 179) * Math.PI) / 360;
    const dx = len * Math.sin(half);
    const dy = len * Math.cos(half);
    out.push(`<path d="M ${f1(cx)} ${f1(apexY)} L ${f1(cx - dx)} ${f1(apexY - dy)} A ${len} ${len} 0 0 1 ${f1(cx + dx)} ${f1(apexY - dy)} Z" fill="${wd.colour}" fill-opacity="0.18" stroke="${wd.colour}" stroke-width="1.5"/>`);
  }
  out.push(`<circle cx="${f1(cx)}" cy="${f1(apexY)}" r="3" fill="${INK}"/>`);
  L.fixed(cx, apexY + 14, "lens", 9, "middle");
  key(L, 16, keyTop, wedges.map((wd) => ({ colour: wd.colour, text: `${wd.label}: ${sig(wd.fov, 4)}° horizontal` })));
  out.push("</g></svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Projection and parallax, from above
// ---------------------------------------------------------------------------------------------------------------

/**
 * Camera space seen from above (x right, depth up the page): the frustum, the two parallax depths, the camera after
 * one frame's lateral move (exaggerated so it shows, and said so), rays from both positions to a point on the view
 * axis at each depth, and the projected point.
 */
export function parallaxTopSvg(res: ProjectionResult, inp: ProjectionInput): string {
  const w = W;
  const drawW = 300; // the frustum lives in [16, 316]; labels go right of it
  const top = 34;
  const bottom = 250;
  const maxDepth = Math.max(inp.far, inp.near, res.p0.depth) * 1.12;
  const half = (res.hFov * Math.PI) / 360;
  const sc = Math.min((bottom - top) / maxDepth, drawW / 2 / (maxDepth * Math.tan(half)));
  const cx = 16 + drawW / 2;
  const X = (x: number): number => cx + x * sc;
  const Y = (z: number): number => bottom - z * sc;
  // The lateral move, exaggerated to at least 14 px.
  const moveDraw = res.lateral === 0 ? 0 : Math.sign(res.lateral) * Math.max(14, Math.abs(res.lateral) * sc);
  const exaggeration = res.lateral === 0 ? 1 : Math.abs(moveDraw / (res.lateral * sc));
  const keyTop = 280;
  const h = keyTop + 6 * 14 + 4;
  const out = svgOpen(w, h);
  const L = new Layout(out, w, h);
  L.fixed(w / 2, 16, "Camera space from above (depth up the page)", 11, "middle");
  const fx = maxDepth * Math.tan(half);
  L.line(X(0), Y(0), X(-fx), Y(maxDepth), GREY, 1);
  L.line(X(0), Y(0), X(fx), Y(maxDepth), GREY, 1);
  for (const [d, colour] of [[inp.near, GREEN], [inp.far, PURPLE]] as Array<[number, string]>) {
    const hw = d * Math.tan(half);
    L.line(X(-hw), Y(d), X(hw), Y(d), colour, 1.5);
  }
  const cam2 = X(0) + moveDraw;
  // Rays from both camera positions to the on-axis points at each depth.
  for (const [d, colour] of [[inp.near, GREEN], [inp.far, PURPLE]] as Array<[number, string]>) {
    L.line(X(0), Y(0), X(0), Y(d), colour, 1);
    if (moveDraw !== 0) L.line(cam2, Y(0), X(0), Y(d), colour, 1, ' stroke-dasharray="4 3"');
  }
  out.push(`<circle cx="${f1(X(0))}" cy="${f1(Y(0))}" r="4" fill="${INK}"/>`);
  if (moveDraw !== 0) out.push(`<circle cx="${f1(cam2)}" cy="${f1(Y(0))}" r="4" fill="${ORANGE}"/>`);
  const px = X(res.p0.pc[0]);
  const py = Y(res.p0.depth);
  out.push(`<circle cx="${f1(px)}" cy="${f1(py)}" r="4" fill="${RED}"/>`);
  // Depth labels right of the drawing area.
  L.label(16 + drawW + 8, Y(inp.near) + 3, `near ${sig(inp.near)}`, 9, "start", GREEN);
  L.label(16 + drawW + 8, Y(inp.far) + 3, `far ${sig(inp.far)}`, 9, "start", PURPLE);
  L.label(X(0), Y(0) + 16, "camera", 9, "middle");
  key(L, 16, keyTop, [
    { colour: INK, text: "camera at frame 1" },
    { colour: ORANGE, text: moveDraw !== 0 ? `camera after one frame${exaggeration > 1.05 ? ` (move drawn ×${sig(exaggeration, 3)})` : ""}` : "no sideways move: no parallax" },
    { colour: GREEN, text: `near depth: shifts ${sig(Math.abs(res.shiftNear), 4)} px per frame` },
    { colour: PURPLE, text: `far depth: shifts ${sig(Math.abs(res.shiftFar), 4)} px per frame` },
    { colour: RED, text: `the projected point, depth ${sig(res.p0.depth, 4)}` },
    { colour: GREY, text: `frustum, ${sig(res.hFov, 4)}° horizontal` },
  ]);
  out.push("</g></svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Isometric 3D: axes before and after a transform; shading vectors
// ---------------------------------------------------------------------------------------------------------------

const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;
/** Isometric view, Y up: x runs right and down, z left and down. */
const iso = (p: Vec3): [number, number] => [(p[0] - p[2]) * C30, -p[1] + (p[0] + p[2]) * S30];

interface Arrow {
  from: Vec3;
  to: Vec3;
  colour: string;
  label: string;
  width?: number;
  dash?: boolean;
}

function isoScene(title: string, arrows: Arrow[], dots: Array<{ p: Vec3; colour: string }>, keyRows: Array<{ colour: string; text: string }>, plane?: Vec3[]): string {
  const w = W;
  const top = 30;
  const area = 240;
  const pts: Array<[number, number]> = [];
  for (const a of arrows) pts.push(iso(a.from), iso(a.to));
  for (const d of dots) pts.push(iso(d.p));
  if (plane) for (const p of plane) pts.push(iso(p));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sc = Math.min((w - 80) / Math.max(1e-9, maxX - minX), (area - 30) / Math.max(1e-9, maxY - minY));
  const ox = w / 2 - ((minX + maxX) / 2) * sc;
  const oy = top + 15 + area / 2 - ((minY + maxY) / 2) * sc - 15;
  const P = (p: Vec3): [number, number] => {
    const [a, b] = iso(p);
    return [ox + a * sc, oy + b * sc];
  };
  const keyTop = top + area + 18;
  const h = keyTop + keyRows.length * 14 + 4;
  const out = svgOpen(w, h);
  const L = new Layout(out, w, h);
  L.fixed(w / 2, 16, fitText(title, 11, w - 24), 11, "middle");
  if (plane) out.push(`<polygon points="${plane.map((p) => P(p).map(f1).join(",")).join(" ")}" fill="${LIGHT}" fill-opacity="0.6" stroke="${GREY}" stroke-width="0.8"/>`);
  for (const a of arrows) {
    const [x1, y1] = P(a.from);
    const [x2, y2] = P(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.5) continue;
    L.line(x1, y1, x2, y2, a.colour, a.width ?? 2, a.dash ? ' stroke-dasharray="5 3"' : "");
    // Arrowhead as a filled triangle (no line segments to cross labels).
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const hx = x2 - ux * 8;
    const hy = y2 - uy * 8;
    out.push(`<polygon points="${f1(x2)},${f1(y2)} ${f1(hx - uy * 3.5)},${f1(hy + ux * 3.5)} ${f1(hx + uy * 3.5)},${f1(hy - ux * 3.5)}" fill="${a.colour}"/>`);
  }
  for (const d of dots) {
    const [x, y] = P(d.p);
    out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="3" fill="${d.colour}"/>`);
  }
  // Tip labels, beyond each tip along the arrow; tried at three distances, skipped when nothing is clear.
  for (const a of arrows) {
    const [x1, y1] = P(a.from);
    const [x2, y2] = P(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.5 || !a.label) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (const dist of [10, 18, 28]) {
      const lx = x2 + ux * dist;
      const ly = y2 + uy * dist + 3.5;
      if (L.label(lx, ly, a.label, 10, "middle", a.colour)) break;
    }
  }
  key(L, 16, keyTop, keyRows);
  out.push("</g></svg>");
  return out.join("");
}

/** World axes (grey) and the transformed basis (columns of the 3×3 part, from the transformed origin). */
export function axesSvg(res: TransformResult): string {
  const O: Vec3 = [res.M[0][3], res.M[1][3], res.M[2][3]];
  const col = (j: number): Vec3 => [res.M[0][j], res.M[1][j], res.M[2][j]];
  const arrows: Arrow[] = [
    { from: [0, 0, 0], to: [1, 0, 0], colour: "#bbbbbb", label: "X", width: 1.5 },
    { from: [0, 0, 0], to: [0, 1, 0], colour: "#bbbbbb", label: "Y", width: 1.5 },
    { from: [0, 0, 0], to: [0, 0, 1], colour: "#bbbbbb", label: "Z", width: 1.5 },
    { from: O, to: [O[0] + col(0)[0], O[1] + col(0)[1], O[2] + col(0)[2]], colour: RED, label: "X′" },
    { from: O, to: [O[0] + col(1)[0], O[1] + col(1)[1], O[2] + col(1)[2]], colour: GREEN, label: "Y′" },
    { from: O, to: [O[0] + col(2)[0], O[1] + col(2)[1], O[2] + col(2)[2]], colour: BLUE, label: "Z′" },
  ];
  const dots = res.out.slice(0, 12).map((p) => ({ p, colour: ORANGE }));
  return isoScene("Axes before (grey) and after the transform", arrows, dots, [
    { colour: "#bbbbbb", text: "before: the world axes at the origin" },
    { colour: RED, text: "after: X′ (first column of M), from the moved origin" },
    { colour: GREEN, text: "after: Y′ (second column)" },
    { colour: BLUE, text: "after: Z′ (third column)" },
    ...(dots.length ? [{ colour: ORANGE, text: `transformed point${dots.length === 1 ? "" : "s"}` }] : []),
  ]);
}

/** The shading vectors at a surface point, the tangent plane of the geometric normal shaded. */
export function shadingSvg(res: ShadingResult, Ngeo: Vec3): string {
  const n0 = Math.hypot(...Ngeo);
  const N: Vec3 = [Ngeo[0] / n0, Ngeo[1] / n0, Ngeo[2] / n0];
  // Two directions in the tangent plane.
  const a: Vec3 = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1: Vec3 = [a[1] * N[2] - a[2] * N[1], a[2] * N[0] - a[0] * N[2], a[0] * N[1] - a[1] * N[0]];
  const l1 = Math.hypot(...t1);
  const u: Vec3 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
  const v: Vec3 = [N[1] * u[2] - N[2] * u[1], N[2] * u[0] - N[0] * u[2], N[0] * u[1] - N[1] * u[0]];
  const s = 0.8;
  const plane: Vec3[] = [
    [(u[0] + v[0]) * s, (u[1] + v[1]) * s, (u[2] + v[2]) * s],
    [(u[0] - v[0]) * s, (u[1] - v[1]) * s, (u[2] - v[2]) * s],
    [(-u[0] - v[0]) * s, (-u[1] - v[1]) * s, (-u[2] - v[2]) * s],
    [(-u[0] + v[0]) * s, (-u[1] + v[1]) * s, (-u[2] + v[2]) * s],
  ];
  const O: Vec3 = [0, 0, 0];
  return isoScene(
    "Shading vectors at the surface point",
    [
      { from: O, to: N, colour: GREY, label: "N", width: 1.5 },
      { from: O, to: res.n, colour: BLUE, label: "n" },
      { from: O, to: res.l, colour: ORANGE, label: "L" },
      { from: O, to: res.v, colour: GREEN, label: "V" },
      { from: O, to: res.h, colour: PURPLE, label: "H" },
      { from: O, to: res.r, colour: RED, label: "R", dash: true },
    ],
    [],
    [
      { colour: GREY, text: "N: geometric normal (tangent plane shaded)" },
      { colour: BLUE, text: `n: mapped normal, tilted ${sig(res.tilt, 3)}° from N` },
      { colour: ORANGE, text: `L: toward the light, n·L = ${sig(res.nDotL, 4)}` },
      { colour: GREEN, text: `V: toward the camera, n·V = ${sig(res.nDotV, 4)}` },
      { colour: PURPLE, text: `H: half vector, n·H = ${sig(res.nDotH, 4)}` },
      { colour: RED, text: `R: mirror of L about n, R·V = ${sig(res.rDotV, 4)}` },
    ],
    plane,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Log curve
// ---------------------------------------------------------------------------------------------------------------

/** Code value against stops from 18 % grey, grey and the converted value marked. */
export function logCurveSvg(curve: LogCurve, stops: number | null, code: number): string {
  const lo = Math.min(-8, stops !== null ? Math.floor(stops) - 1 : -8);
  const hi = Math.max(8, stops !== null ? Math.ceil(stops) + 1 : 8);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 320; i++) {
    const s = lo + ((hi - lo) * i) / 320;
    const y = curve.encode(0.18 * Math.pow(2, s));
    if (Number.isFinite(y)) pts.push({ x: s, y });
  }
  const grey = curve.encode(0.18);
  const series: Series[] = [
    { points: pts, type: "line", color: BLUE, label: curve.label.replace(/ \(black .*\)$/, "") },
    { points: [{ x: 0, y: grey }], type: "scatter", color: GREY, label: `18 % grey, ${sig(grey, 4)}` },
  ];
  const notes: string[] = [];
  if (stops !== null) series.push({ points: [{ x: stops, y: code }], type: "scatter", color: RED, label: `this value, ${sig(code, 4)}` });
  else notes.push(`This value is at or below linear 0 (code ${sig(code, 4)}): it has no stops from grey, so it is not on this axis.`);
  const ys = pts.map((p) => p.y).concat([code]);
  return buildPlotSvg(series, {
    xlabel: "Stops from 18 % grey",
    ylabel: "Code value (0 to 1)",
    xLimits: { min: lo, max: hi },
    yLimits: { min: Math.min(0, Math.floor(Math.min(...ys) * 10) / 10), max: Math.max(1, Math.ceil(Math.max(...ys) * 10) / 10) },
    width: W,
    height: H,
    notes,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------------------------------------------

const hex = (lin: number[]): string =>
  "#" + lin.slice(0, 3).map((c) => Math.round(Math.max(0, Math.min(1, srgbEncode(c))) * 255).toString(16).padStart(2, "0")).join("");

export interface Swatch {
  label: string;
  /** Straight (unpremultiplied) linear RGB and the alpha shown. */
  rgb: number[];
  alpha: number;
}

export interface BarSet {
  label: string;
  colour: string;
  /** R, G, B (and A when given). */
  values: number[];
}

/** A row of swatches (over a grey/white checker, so alpha shows) and a grouped bar chart of the channels. */
export function compositeSvg(swatches: Swatch[], bars: BarSet[], title: string): string {
  const w = W;
  const n = swatches.length;
  const cell = Math.min(72, (w - 32) / n);
  const sw = cell - 12;
  const out = svgOpen(w, 10);
  const L = new Layout(out, w, 1000);
  L.fixed(w / 2, 16, fitText(title, 11, w - 24), 11, "middle");
  out.push(`<defs><pattern id="vfxck" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#ffffff"/><rect width="5" height="5" fill="#cccccc"/><rect x="5" y="5" width="5" height="5" fill="#cccccc"/></pattern></defs>`);
  swatches.forEach((s, i) => {
    const x = 16 + i * cell + 6;
    out.push(`<rect x="${f1(x)}" y="28" width="${f1(sw)}" height="40" fill="url(#vfxck)" stroke="${GREY}"/>`);
    out.push(`<rect x="${f1(x)}" y="28" width="${f1(sw)}" height="40" fill="${hex(s.rgb)}" fill-opacity="${Math.max(0, Math.min(1, s.alpha)).toFixed(3)}"/>`);
    L.fixed(x + sw / 2, 82, s.label, 9, "middle");
  });
  // Bars.
  const chTop = 104;
  const chH = 130;
  const base = chTop + chH;
  const all = bars.flatMap((b) => b.values);
  const vmax = Math.max(1, ...all);
  const yv = (v: number): number => base - (Math.max(0, v) / vmax) * chH;
  const groups = Math.max(...bars.map((b) => b.values.length));
  const left = 52;
  const gw = (w - left - 16) / groups;
  const bw = Math.min(18, (gw - 16) / bars.length);
  for (const t of [0, vmax / 2, vmax]) {
    out.push(`<line x1="${left}" y1="${f1(yv(t))}" x2="${w - 16}" y2="${f1(yv(t))}" stroke="#e0e0e0" stroke-width="1"/>`);
    L.fixed(left - 4, yv(t) + 3, sig(t, 3), 9, "end");
  }
  L.fixed(10, chTop - 8, "Channel value (linear)", 9, "start");
  const names = ["R", "G", "B", "A"];
  for (let g = 0; g < groups; g++) {
    const gx = left + g * gw + (gw - bw * bars.length) / 2;
    bars.forEach((b, i) => {
      if (g >= b.values.length) return;
      const v = b.values[g];
      out.push(`<rect x="${f1(gx + i * bw)}" y="${f1(yv(v))}" width="${f1(bw - 2)}" height="${f1(base - yv(v))}" fill="${b.colour}"/>`);
    });
    L.fixed(left + g * gw + gw / 2, base + 13, names[g], 9, "middle");
  }
  out.push(`<line x1="${left}" y1="${base}" x2="${w - 16}" y2="${base}" stroke="${INK}" stroke-width="1"/>`);
  const end = key(L, 16, base + 32, bars.map((b) => ({ colour: b.colour, text: b.label })));
  const h = Math.ceil(end + 2);
  out[0] = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  out[1] = `<rect width="${w}" height="${h}" fill="${PAPER}"/>`;
  out.push("</g></svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Chroma key: the CbCr plane
// ---------------------------------------------------------------------------------------------------------------

export function cbcrSvg(key: [number, number], pix: [number, number], tol: number | null, soft: number | null): string {
  const circle = (c: [number, number], r: number): Array<{ x: number; y: number }> =>
    Array.from({ length: 121 }, (_, i) => ({ x: c[0] + r * Math.cos((i * Math.PI) / 60), y: c[1] + r * Math.sin((i * Math.PI) / 60) }));
  const series: Series[] = [];
  if (tol !== null && tol > 0) series.push({ points: circle(key, tol), type: "line", color: RED, label: "tolerance: α 0 inside" });
  if (tol !== null && soft !== null && soft > 0) series.push({ points: circle(key, tol + soft), type: "line", color: ORANGE, label: "softness: α 1 outside" });
  series.push({ points: [{ x: key[0], y: key[1] }], type: "scatter", color: GREEN, label: "key colour" });
  series.push({ points: [{ x: pix[0], y: pix[1] }], type: "scatter", color: BLUE, label: "pixel" });
  series.push({ points: [{ x: 0, y: 0 }], type: "scatter", color: GREY, label: "neutral grey" });
  // The plane is ±0.5; widened (symmetrically, to a tenth) when a circle reaches past it, so nothing is clipped.
  const reach = Math.max(0.5, ...series.flatMap((s) => s.points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))));
  const lim = Math.ceil(reach * 10 - 1e-9) / 10;
  // Equal units per pixel on both axes, so a circle draws as a circle: the plot area is read back from the drawn
  // frame (its clip rectangle) and the axis with more pixels per unit is widened to match, twice (ticks can move the
  // margins a little).
  let xl = lim;
  let yl = lim;
  let svg = "";
  for (let pass = 0; pass < 3; pass++) {
    svg = buildPlotSvg(series, { xlabel: "Cb (blue difference)", ylabel: "Cr (red difference)", xLimits: { min: -xl, max: xl }, yLimits: { min: -yl, max: yl }, width: 400, height: 400 });
    const m = /<clipPath[^>]*><rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/.exec(svg);
    if (!m) break;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (Math.abs(w / h - xl / yl) < 0.005 * (xl / yl)) break;
    if (w > h) { xl = lim * (w / h); yl = lim; } else { yl = lim * (h / w); xl = lim; }
  }
  return svg;
}

// ---------------------------------------------------------------------------------------------------------------
// Miniature scale and the drop
// ---------------------------------------------------------------------------------------------------------------

/** Shooting frame rate against miniature scale (fps·√n), this scale marked. */
export function froudeSvg(fps: number, n: number): string {
  const nMax = Math.max(64, n * 2);
  const pts = Array.from({ length: 200 }, (_, i) => {
    const s = Math.pow(nMax, i / 199);
    return { x: s, y: fps * Math.sqrt(s) };
  });
  return buildPlotSvg(
    [
      { points: pts, type: "line", color: BLUE, label: `${sig(fps, 4)} fps × √n` },
      { points: [{ x: n, y: fps * Math.sqrt(n) }], type: "scatter", color: RED, label: `1:${sig(n, 4)} → ${sig(fps * Math.sqrt(n), 4)} fps` },
    ],
    { xlabel: "Miniature scale n (model is 1/n)", ylabel: "Shooting frame rate (fps)", xScale: "log", xLimits: { min: 1, max: nMax }, width: W, height: H },
  );
}

/** Height against time for a ball dropped from h with restitution e, gravity in the scene unit. */
export function bounceSvg(h: number, e: number, unitM: number, unitLabel: string): string {
  const g = G0 / unitM;
  const pts: Array<{ x: number; y: number }> = [];
  let t0 = 0;
  let v = Math.sqrt(2 * g * h);
  // The drop.
  const td = Math.sqrt((2 * h) / g);
  for (let i = 0; i <= 40; i++) {
    const t = (td * i) / 40;
    pts.push({ x: t, y: h - 0.5 * g * t * t });
  }
  t0 = td;
  const impacts = [{ x: td, y: 0 }];
  for (let b = 0; b < 8 && e > 0; b++) {
    v *= e;
    const T = (2 * v) / g;
    if (v * v / (2 * g) < h * 0.01) break;
    for (let i = 1; i <= 40; i++) {
      const t = (T * i) / 40;
      pts.push({ x: t0 + t, y: Math.max(0, v * t - 0.5 * g * t * t) });
    }
    t0 += T;
    impacts.push({ x: t0, y: 0 });
  }
  return buildPlotSvg(
    [
      { points: pts, type: "line", color: BLUE, label: `height, e = ${sig(e, 3)}` },
      { points: impacts, type: "scatter", color: RED, label: "impacts" },
    ],
    { xlabel: "Time (s)", ylabel: `Height (${unitLabel})`, xLimits: { min: 0, max: Math.max(t0, td) * 1.02 }, yLimits: { min: 0, max: h * 1.1 }, width: W, height: H },
  );
}
