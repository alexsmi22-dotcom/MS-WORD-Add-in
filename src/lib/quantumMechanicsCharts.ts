// Figures for Release Q part Q6 (quantum mechanics):
//   - levelFigureSvg: a potential with its energy levels and |ψₙ|² drawn on each level (the textbook figure for the
//     infinite and finite square wells and the harmonic oscillator);
//   - hydrogenLevelSvg: the hydrogen-like level diagram with the chosen transition as an arrow;
//   - curvesSvg: labelled curves on linear axes (the radial probability P(r), two-level P₁(t) and Bloch components);
//   - tunnelSvg: transmission against E/V₀, a log axis below the barrier beside a linear one above it.
// Colours are literal hex; Arial (as engCharts2026.ts). Every builder caps what it draws.

import { textWidthPt } from "./arialMetrics";
import { fmtSig, linearAxis, logAxis } from "./axis";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000"): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}">${esc(t)}</text>`;
const vtext = (x: number, y: number, t: string, size = 12): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="${size}" fill="#000000" transform="rotate(-90 ${f(x)} ${f(y)})">${esc(t)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = "#000000", w = 1, dash = ""): string =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(Math.max(0, h))}" fill="${fill}"/>`;
const svgOpen = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}"><rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="#ffffff"/>`;
const tw = (t: string, size: number): number => textWidthPt(t, size);
/** The most vertices one path carries (a longer series is strided; the tools send at most 4001). */
const PATH_MAX = 6000;
const path = (raw: Array<[number, number]>, stroke: string, w = 1.6, dash = "", fill = "none"): string => {
  const step = Math.ceil(raw.length / PATH_MAX);
  const pts = (step > 1 ? raw.filter((_, i) => i % step === 0 || i === raw.length - 1) : raw).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return pts.length < 2
    ? ""
    : `<path d="${pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join(" ")}${fill !== "none" ? " Z" : ""}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>`;
};

/** Three significant figures, trailing zeros dropped, U+2212. */
export const sig3 = (v: number, n = 3): string =>
  Math.abs(v) < 5e-13 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** Vertical label placement: keep each label at its target y unless that collides, then push it up (bounded). */
function declutter(targets: number[], gap: number, top: number): number[] {
  const order = targets.map((y, i) => ({ y, i })).sort((a, b) => b.y - a.y); // bottom first
  const out = new Array<number>(targets.length);
  let last = Infinity;
  for (const o of order) {
    const y = Math.min(o.y, last - gap);
    out[o.i] = y;
    last = y;
  }
  // If the stack ran off the top, shift everything down as a block (it stays ordered).
  const minY = Math.min(...out);
  if (minY < top) for (let i = 0; i < out.length; i++) out[i] += top - minY;
  return out;
}

const AXIS_GREY = "#e6e6e6";

/** Y axis ticks + gridlines + title for a linear axis; returns the y mapper. */
function yAxisLinear(out: string[], lo: number, hi: number, L: number, R: number, T: number, B: number, title: string, grid = true): (v: number) => number {
  const ax = linearAxis(lo, hi, { target: 5 });
  const y = (v: number): number => B - ((v - lo) / (hi - lo)) * (B - T);
  ax.values.forEach((v, i) => {
    const yy = y(v);
    if (grid) out.push(line(L, yy, R, yy, AXIS_GREY, 0.8));
    out.push(line(L - 4, yy, L, yy));
    out.push(text(L - 7, yy + 4, ax.labels[i], "end", 11));
  });
  out.push(vtext(16, (T + B) / 2, title + (ax.multiplier ? ` (${ax.multiplier})` : "")));
  return y;
}

// ---------------------------------------------------------------------------------------------------------------
// Potential + levels + |ψ|²
// ---------------------------------------------------------------------------------------------------------------

export interface LevelCurve {
  /** Level energy (display units). */
  E: number;
  /** Where the level line is drawn (data x). */
  x1: number;
  x2: number;
  /** "n = 1". */
  label: string;
  /** "0.376 eV". */
  value: string;
  /** |ψ|² samples: [x, relative height 0…1]. */
  curve: Array<[number, number]>;
  /** This curve's peak height (energy units); the spec's common height when absent. */
  amp?: number;
  /** A labelled reference height (the finite well's rim V₀), not a state: never counted against LEVEL_FIG_MAX. */
  marker?: boolean;
}

export interface LevelSpec {
  xRange: [number, number];
  /** The potential as a polyline (data x, display energy); clipped to the frame. */
  potential: Array<[number, number]>;
  /** Grey "V = ∞" regions (data x intervals) for an infinite well. */
  walls?: Array<[number, number]>;
  levels: LevelCurve[];
  /** The display height of a curve's peak (energy units). */
  amp: number;
  eRange: [number, number];
  xTicks: Array<{ v: number; label: string }>;
  xTitle: string;
  yTitle: string;
}

/** The most levels (states) one figure draws; marker entries such as the V₀ rim come on top of these. */
export const LEVEL_FIG_MAX = 8;

export function levelFigureSvg(spec: LevelSpec): string {
  let states = 0;
  const levels = spec.levels.filter((l) => l.marker || ++states <= LEVEL_FIG_MAX);
  const nameW = Math.max(...levels.map((l) => tw(l.label, 11)));
  const valW = Math.max(...levels.map((l) => tw(l.value, 11)));
  const labelW = nameW + 22 + valW;
  const L = 64, T = 14, plotW = 330, plotH = 270;
  const R = L + plotW;
  const B = T + plotH;
  const W = R + 14 + labelW + 10;
  const H = B + 46;
  const [x0, x1] = spec.xRange;
  const [e0, e1] = spec.eRange;
  const X = (x: number): number => L + ((x - x0) / (x1 - x0)) * plotW;
  const out: string[] = [svgOpen(W, H)];
  const Y = yAxisLinear(out, e0, e1, L, R, T, B, spec.yTitle, false);
  const clipY = (y: number): number => Math.max(T, Math.min(B, y));
  for (const [a, b] of spec.walls ?? []) {
    const xa = Math.max(L, X(a)), xb = Math.min(R, X(b));
    out.push(rect(xa, T, xb - xa, B - T, "#e9e9e9"));
  }
  // Curves first (fill under the level line), then the level lines, then the potential on top.
  for (const lv of levels) {
    const base = Y(lv.E);
    const pts: Array<[number, number]> = lv.curve
      .filter(([x]) => x >= x0 && x <= x1)
      .map(([x, r]) => [X(x), clipY(Y(lv.E + (lv.amp ?? spec.amp) * Math.max(0, r)))]);
    if (pts.length >= 2) {
      const poly: Array<[number, number]> = [[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]];
      out.push(path(poly, "none", 0, "", "#d6e4f5"));
      out.push(path(pts, "#1f5fa8", 1.4));
    }
  }
  for (const lv of levels) {
    const y = Y(lv.E);
    out.push(line(Math.max(L, X(lv.x1)), y, Math.min(R, X(lv.x2)), y, "#333333", 1.1));
  }
  // The potential, clipped to the frame box.
  const pot = spec.potential.filter(([x, v]) => x >= x0 && x <= x1 && v <= e1 + 1e-12 && v >= e0 - 1e-12).map(([x, v]): [number, number] => [X(x), Y(v)]);
  out.push(path(pot, "#000000", 2));
  // Axes.
  out.push(line(L, T, L, B));
  out.push(line(L, B, R, B));
  for (const t of spec.xTicks) {
    if (t.v < x0 || t.v > x1) continue;
    out.push(line(X(t.v), B, X(t.v), B + 4));
    out.push(text(X(t.v), B + 17, t.label, "middle", 11));
  }
  out.push(text((L + R) / 2, B + 38, spec.xTitle, "middle", 12));
  // Level labels in the right margin, decluttered, with a short leader when moved.
  const ys = declutter(levels.map((l) => Y(l.E) + 4), 13, T + 8);
  levels.forEach((lv, i) => {
    const yl = Y(lv.E);
    if (Math.abs(ys[i] - 4 - yl) > 1) out.push(line(R + 2, yl, R + 10, ys[i] - 4, "#777777", 0.8));
    out.push(text(R + 14, ys[i], lv.label, "start", 11));
    out.push(text(R + 14 + nameW + 22 + valW, ys[i], lv.value, "end", 11));
  });
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Hydrogen-like level diagram
// ---------------------------------------------------------------------------------------------------------------

export interface HydrogenFigure {
  /** Level energies (eV, negative) for n = 1, 2, …; the ionisation limit 0 is drawn as n = ∞. */
  levels: Array<{ n: number; E: number }>;
  upper: number;
  lower: number;
  /** "656.1 nm". */
  arrowLabel: string;
  /** The energy display unit ("eV"). */
  unit: string;
}

export function hydrogenLevelSvg(fig: HydrogenFigure): string {
  const lv = fig.levels.slice(0, 14);
  const E1 = Math.min(...lv.map((l) => l.E));
  const lo = E1 * 1.06, hi = -E1 * 0.07;
  const L = 64, T = 14, plotW = 250, plotH = 300;
  const R = L + plotW;
  const B = T + plotH;
  const nameW = Math.max(...lv.map((l) => tw(`n = ${l.n}`, 11)), tw("n = ∞", 11));
  const valW = Math.max(...lv.map((l) => tw(`${sig3(l.E, 4)} ${fig.unit}`, 11)));
  const labelW = nameW + 22 + valW;
  const W = R + 12 + labelW + 12;
  const H = B + 16;
  const out: string[] = [svgOpen(W, H)];
  const Y = yAxisLinear(out, lo, hi, L, R, T, B, `Energy (${fig.unit})`, false);
  out.push(line(L, T, L, B));
  const lx1 = L + 20, lx2 = R - 6;
  const ax = L + plotW * 0.55;
  // Labels: lowest first; one that would collide is left out, except the two transition levels and n = ∞.
  const must = new Set([fig.upper, fig.lower]);
  const all = [...lv.map((l) => ({ n: l.n, E: l.E, name: `n = ${l.n}`, val: `${sig3(l.E, 4)} ${fig.unit}` })), { n: Infinity, E: 0, name: "n = ∞", val: `0 ${fig.unit}` }];
  const placed: number[] = [];
  const show = new Set<number>();
  // Priority pass: the must-show levels and ∞, then the rest from the bottom up.
  const order = [...all.filter((a) => must.has(a.n) || a.n === Infinity), ...all.filter((a) => !must.has(a.n) && a.n !== Infinity)];
  for (const a of order) {
    const y = Y(a.E);
    if (placed.every((p) => Math.abs(p - y) >= 12.5) || must.has(a.n) || a.n === Infinity) {
      placed.push(y);
      show.add(a.n);
    }
  }
  for (const a of all) {
    const y = Y(a.E);
    const hl = must.has(a.n);
    out.push(line(lx1, y, lx2, y, a.n === Infinity ? "#555555" : hl ? "#000000" : "#444444", hl ? 1.6 : 1, a.n === Infinity ? "4 3" : ""));
  }
  // The levels left unlabelled get one label per run of consecutive n ("n = 5, 6" or "n = 5–10", no value), at the
  // run's mean height, with a leader from each of its lines, so no drawn line is anonymous.
  type Lab = { name: string; val: string; ys: number[]; col: string };
  const labs: Lab[] = all.filter((a) => show.has(a.n)).map((a) => ({ name: a.name, val: a.val, ys: [Y(a.E)], col: must.has(a.n) ? "#000000" : "#333333" }));
  const runs: Array<typeof all> = [];
  for (const a of all) {
    if (show.has(a.n)) continue;
    const last = runs[runs.length - 1];
    if (last && a.n === last[last.length - 1].n + 1) last.push(a);
    else runs.push([a]);
  }
  for (const r of runs) {
    const ns = r.map((a) => a.n);
    const name = ns.length === 1 ? `n = ${ns[0]}` : ns.length === 2 ? `n = ${ns[0]}, ${ns[1]}` : `n = ${ns[0]}–${ns[ns.length - 1]}`;
    labs.push({ name, val: ns.length === 1 ? r[0].val : "", ys: r.map((a) => Y(a.E)), col: "#333333" });
  }
  // Labels that still collide are nudged apart by the declutter pass.
  const ys = declutter(labs.map((l) => l.ys.reduce((s, v) => s + v, 0) / l.ys.length + 4), 12.5, T + 6);
  labs.forEach((l, i) => {
    for (const y of l.ys) if (l.ys.length > 1 || Math.abs(ys[i] - 4 - y) > 1) out.push(line(lx2 + 1, y, R + 8, ys[i] - 4, "#777777", 0.8));
    out.push(text(R + 12, ys[i], l.name, "start", 11, l.col));
    if (l.val) out.push(text(R + 12 + nameW + 22 + valW, ys[i], l.val, "end", 11, l.col));
  });
  // The transition arrow (emission: upper → lower).
  const yu = Y(lv.find((l) => l.n === fig.upper)?.E ?? 0);
  const yl = Y(lv.find((l) => l.n === fig.lower)?.E ?? E1);
  const head = Math.min(8, Math.max(3, (yl - yu) / 2));
  out.push(line(ax, yu, ax, yl - head, "#c0392b", 2));
  out.push(`<path d="M${f(ax - 4.5)} ${f(yl - head)} L${f(ax + 4.5)} ${f(yl - head)} L${f(ax)} ${f(yl)} Z" fill="#c0392b"/>`);
  // The wavelength beside the arrow, on a white backing so a level line does not strike through it.
  const lab = fig.arrowLabel;
  const lw = tw(lab, 11);
  const ly = Math.max(T + 12, Math.min(B - 4, (yu + yl) / 2 + 4));
  out.push(rect(ax + 7, ly - 11, lw + 6, 14, "#ffffff"));
  out.push(text(ax + 10, ly, lab, "start", 11, "#c0392b"));
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Curves on linear axes
// ---------------------------------------------------------------------------------------------------------------

export interface CurveSeries {
  name: string;
  pts: Array<[number, number]>;
  color: string;
  dash?: string;
  width?: number;
}

export interface CurvesSpec {
  series: CurveSeries[];
  xTitle: string;
  yTitle: string;
  xRange: [number, number];
  yRange: [number, number];
  /** A marked point (the typed time / energy). */
  marker?: { x: number; y: number; label: string };
  /** Horizontal reference lines. */
  hLines?: Array<{ y: number; label: string }>;
}

export const CURVES_MAX_SERIES = 6;

export function curvesSvg(spec: CurvesSpec): string {
  const ser = spec.series.slice(0, CURVES_MAX_SERIES);
  const L = 66, Rm = 22, plotW = 380, plotH = 220;
  const W = L + plotW + Rm;
  // Legend rows above the plot (wrapped).
  const items = ser.map((s) => ({ s, w: 26 + tw(s.name, 11) + 18 }));
  const rows: Array<typeof items> = [[]];
  let acc = 0;
  for (const it of items) {
    if (acc + it.w > plotW && rows[rows.length - 1].length) {
      rows.push([]);
      acc = 0;
    }
    rows[rows.length - 1].push(it);
    acc += it.w;
  }
  const legendH = ser.length > 1 || (ser.length === 1 && ser[0].name) ? rows.length * 16 + 6 : 0;  // A marker's label sits in its own strip above the frame, so no curve can cross it.
  const T = 12 + legendH + (spec.marker ? 14 : 0);
  const R = L + plotW;
  const B = T + plotH;
  const H = B + 46;
  const out: string[] = [svgOpen(W, H)];
  if (legendH) {
    rows.forEach((row, ri) => {
      let x = L;
      const y = 12 + ri * 16 + 6;
      for (const it of row) {
        out.push(line(x, y - 4, x + 20, y - 4, it.s.color, it.s.width ?? 2, it.s.dash ?? ""));
        out.push(text(x + 26, y, it.s.name, "start", 11));
        x += it.w;
      }
    });
  }
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  const X = (x: number): number => L + ((x - x0) / (x1 - x0)) * plotW;
  const Y = yAxisLinear(out, y0, y1, L, R, T, B, spec.yTitle, true);
  const xa = linearAxis(x0, x1, { target: 6 });
  xa.values.forEach((v, i) => {
    out.push(line(X(v), T, X(v), B, AXIS_GREY, 0.8));
    out.push(line(X(v), B, X(v), B + 4));
    out.push(text(X(v), B + 17, xa.labels[i], "middle", 11));
  });
  out.push(text((L + R) / 2, B + 38, spec.xTitle + (xa.multiplier ? ` (${xa.multiplier})` : ""), "middle", 12));
  for (const h of spec.hLines ?? []) {
    if (h.y < y0 || h.y > y1) continue;
    out.push(line(L, Y(h.y), R, Y(h.y), "#888888", 1, "5 4"));
    out.push(rect(R - tw(h.label, 10) - 6, Y(h.y) - 13, tw(h.label, 10) + 4, 11, "#ffffff"));
    out.push(text(R - 4, Y(h.y) - 4, h.label, "end", 10, "#555555"));
  }
  for (const s of ser) {
    const pts = s.pts.filter(([x, y]) => x >= x0 && x <= x1 && Number.isFinite(y)).map(([x, y]): [number, number] => [X(x), Math.max(T, Math.min(B, Y(y)))]);
    out.push(path(pts, s.color, s.width ?? 1.8, s.dash ?? ""));
  }
  out.push(line(L, T, L, B));
  out.push(line(L, B, R, B));
  if (spec.marker && spec.marker.x >= x0 && spec.marker.x <= x1) {
    const mx = X(spec.marker.x), my = Math.max(T, Math.min(B, Y(spec.marker.y)));
    out.push(line(mx, T, mx, B, "#c0392b", 0.9, "2 3"));
    out.push(`<circle cx="${f(mx)}" cy="${f(my)}" r="4" fill="#c0392b" stroke="#ffffff" stroke-width="1"/>`);
    const lw = tw(spec.marker.label, 11);
    const tx = Math.max(L + lw / 2, Math.min(R - lw / 2, mx));
    out.push(text(tx, T - 4, spec.marker.label, "middle", 11, "#c0392b"));
  }
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Transmission against E/V₀
// ---------------------------------------------------------------------------------------------------------------

export interface TunnelSpec {
  /** Below the barrier: E/V₀ and log₁₀T (exact) and log₁₀T (WKB). */
  below: Array<{ x: number; lt: number; wkb: number }>;
  /** Above the barrier: E/V₀ and T. */
  above: Array<{ x: number; t: number }>;
  /**
   * Resonances too dense to draw: `above` is then the LOWER ENVELOPE T_min(E) (sin² = 1) and the panel shades the band
   * from it to T = 1, where the oscillating curve lives.
   */
  band?: boolean;
  xMax: number;
  /** The typed energy. */
  mark: { x: number; lt: number; t: number };
}

/** The lowest decade the transmission axis draws (log₁₀ T); the tool states when its curve runs below it. */
export const TUNNEL_LOG_FLOOR = -300;

export function tunnelSvg(spec: TunnelSpec): string {
  const L = 66, T = 50, H1 = 230, gapX = 54;
  const w1 = 230, w2 = 200;
  const R1 = L + w1, L2 = R1 + gapX, R2 = L2 + w2;
  const B = T + H1;
  const W = R2 + 20, H = B + 50;
  const out: string[] = [svgOpen(W, H)];
  // Legend row.
  out.push(line(L, 14, L + 20, 14, "#1f5fa8", 2));
  out.push(text(L + 26, 18, "Exact", "start", 11));
  const lx = L + 26 + tw("Exact", 11) + 22;
  out.push(line(lx, 14, lx + 20, 14, "#d07a00", 1.8, "5 4"));
  out.push(text(lx + 26, 18, "WKB, exp(−2κa)", "start", 11));
  // Left panel: log₁₀T against E/V₀ in (xmin, 1).
  const xs = spec.below.map((p) => p.x);
  // No sample below the barrier (every one past the engine's range): an empty panel, still on finite axes.
  const bx0 = xs.length ? Math.min(...xs) : 0, bx1 = 1;
  const lts = spec.below.flatMap((p) => [p.lt, p.wkb]).filter((v) => Number.isFinite(v));
  let lo = Math.floor(Math.min(...lts, spec.mark.x < 1 ? spec.mark.lt : 0));
  if (lo > -1) lo = -1;
  // The decade axis reaches 10⁻³⁰⁰ at most (TUNNEL_LOG_FLOOR); anything below runs off the bottom and is not drawn.
  if (lo < TUNNEL_LOG_FLOOR) lo = TUNNEL_LOG_FLOOR;
  const hi = 0;
  const XL = (x: number): number => L + ((x - bx0) / (bx1 - bx0)) * w1;
  const YL = (lt: number): number => B - ((Math.max(lo, Math.min(hi, lt)) - lo) / (hi - lo)) * H1;
  const lax = logAxis(lo, hi);
  const leftEmpty = !spec.below.some((p) => p.lt >= lo);
  for (const t of lax.labelled) {
    const y = YL(Math.log10(t.v));
    if (!leftEmpty) out.push(line(L, y, R1, y, AXIS_GREY, 0.8));
    out.push(line(L - 4, y, L, y));
    out.push(text(L - 7, y + 4, t.text, "end", 11));
  }
  out.push(vtext(16, (T + B) / 2, "Transmission T"));
  const lxa = linearAxis(bx0, bx1, { target: 4 });
  lxa.values.forEach((v, i) => {
    out.push(line(XL(v), B, XL(v), B + 4));
    out.push(text(XL(v), B + 17, lxa.labels[i], "middle", 11));
  });
  out.push(path(spec.below.filter((p) => Number.isFinite(p.wkb) && p.wkb >= lo).map((p): [number, number] => [XL(p.x), YL(p.wkb)]), "#d07a00", 1.8, "5 4"));
  out.push(path(spec.below.filter((p) => p.lt >= lo).map((p): [number, number] => [XL(p.x), YL(p.lt)]), "#1f5fa8", 2));
  if (leftEmpty) out.push(text((L + R1) / 2, (T + B) / 2, "T < 10⁻³⁰⁰ throughout", "middle", 11, "#555555"));
  out.push(line(L, T, L, B));
  out.push(line(L, B, R1, B));
  out.push(text((L + R1) / 2, T - 6, "E < V₀ (log scale)", "middle", 11, "#333333"));
  // Right panel: T (linear) against E/V₀ in [1, xMax].
  const XR = (x: number): number => L2 + ((x - 1) / (spec.xMax - 1)) * w2;
  const YR = (t: number): number => B - Math.max(0, Math.min(1, t)) * H1;
  const rya = linearAxis(0, 1, { target: 5 });
  rya.values.forEach((v, i) => {
    out.push(line(L2, YR(v), R2, YR(v), AXIS_GREY, 0.8));
    out.push(line(L2 - 4, YR(v), L2, YR(v)));
    out.push(text(L2 - 7, YR(v) + 4, rya.labels[i], "end", 11));
  });
  const rxa = linearAxis(1, spec.xMax, { target: 4 });
  rxa.values.forEach((v, i) => {
    out.push(line(XR(v), B, XR(v), B + 4));
    out.push(text(XR(v), B + 17, rxa.labels[i], "middle", 11));
  });
  if (spec.band && spec.above.length >= 2) {
    const env = spec.above.map((p): [number, number] => [XR(p.x), YR(p.t)]);
    out.push(path([...env, [XR(spec.above[spec.above.length - 1].x), YR(1)], [XR(spec.above[0].x), YR(1)]], "none", 0, "", "#d6e4f5"));
    out.push(path(env, "#1f5fa8", 1.6));
  } else out.push(path(spec.above.map((p): [number, number] => [XR(p.x), YR(p.t)]), "#1f5fa8", 2));
  out.push(line(L2, T, L2, B));
  out.push(line(L2, B, R2, B));
  out.push(text((L2 + R2) / 2, T - 6, "E > V₀ (linear)", "middle", 11, "#333333"));
  out.push(text((L + R2) / 2, B + 40, "Energy E/V₀", "middle", 12));
  // The typed energy.
  const m = spec.mark;
  const inLeft = m.x < 1;
  if ((inLeft && m.x >= bx0 && m.lt >= lo) || (!inLeft && m.x <= spec.xMax)) {
    const mx = inLeft ? XL(m.x) : XR(m.x);
    const my = inLeft ? YL(m.lt) : YR(m.t);
    out.push(`<circle cx="${f(mx)}" cy="${f(my)}" r="4" fill="#c0392b" stroke="#ffffff" stroke-width="1"/>`);
    // Above-left of the dot: T rises with E, so that corner is clear of the exact curve.
    const ty = my - 8 < T + 10 ? my + 18 : my - 8;
    const leftRoom = mx - 6 - tw("E", 11) > (inLeft ? L : L2) + 4;
    out.push(text(leftRoom ? mx - 6 : mx + 6, ty, "E", leftRoom ? "end" : "start", 11, "#c0392b"));
  }
  out.push("</svg>");
  return out.join("");
}
