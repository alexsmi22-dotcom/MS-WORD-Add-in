// Polar plots r = f(θ) on a polar grid (Plot ▸ Plot type ▸ Polar).
//
// CONVENTIONS, stated in the hint and, where they bite, in the figure:
//
//   * θ in the FORMULA is in radians, always — sin, cos and tan take radians in
//     every evaluator in the product. The degrees/radians choice sets the units
//     of the θ range the user types and of the angle labels, nothing else.
//   * θ = 0 points right (the +x direction) and θ increases counter-clockwise.
//   * NEGATIVE r is plotted at angle θ + π (the standard convention; it is what
//     x = r cos θ, y = r sin θ gives), and the figure says so when it happens.
//
// Ring labels are placed between spokes at the angle where the curve passes
// furthest from them; a label the curve would still cross is moved to a radial
// scale under the disc instead, because a number with the data drawn through it
// is a number nobody can read (the layout gate flags it as a strikethrough).

import { CompiledExpr, escapeXml, layoutNotes, NOTE_LH, NOTE_SIZE } from "./plot";
import { linearAxis } from "./axis";

const FONT = "Arial, Helvetica, sans-serif";

/** Hard cap on θ samples. */
export const POLAR_SAMPLES_MAX = 4000;

export interface PolarSample {
  /** θ in radians. */
  theta: number;
  /** r, NaN where f had no finite value. */
  r: number;
}

/** Samples r(θ) at n points over [t0, t1] (radians). */
export function samplePolar(f: CompiledExpr, t0: number, t1: number, n: number): PolarSample[] {
  const k = Math.max(2, Math.min(POLAR_SAMPLES_MAX, Math.floor(n) || 2));
  const out: PolarSample[] = [];
  for (let i = 0; i < k; i++) {
    const theta = i === k - 1 ? t1 : t0 + ((t1 - t0) * i) / (k - 1);
    const r = f([theta]);
    out.push({ theta, r: Number.isFinite(r) ? r : NaN });
  }
  return out;
}

/** Cartesian (x, y) of a polar sample: negative r lands at θ + π automatically. */
export function polarToXY(s: PolarSample): { x: number; y: number } {
  return { x: s.r * Math.cos(s.theta), y: s.r * Math.sin(s.theta) };
}

export interface PolarFigure {
  samples: PolarSample[];
  angleUnit: "deg" | "rad";
  title?: string;
  notes?: string[];
  width?: number;
  color?: string;
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** "π/6", "5π/6", "π", "0" for k·30° (k = 0 … 11). */
function piLabel(k: number): string {
  const PI = "π";
  if (k === 0) return "0";
  const g = gcd(k, 6);
  const num = k / g;
  const den = 6 / g;
  const top = num === 1 ? PI : `${num}${PI}`;
  return den === 1 ? top : `${top}/${den}`;
}
function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  for (let i = 0; i < 64 && y; i++) [x, y] = [y, x % y];
  return x;
}

/** Liang–Barsky: does segment (x0,y0)-(x1,y1) touch the box? */
function segHitsBox(x0: number, y0: number, x1: number, y1: number, b: { x0: number; y0: number; x1: number; y1: number }): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const checks: [number, number][] = [
    [-dx, x0 - b.x0],
    [dx, b.x1 - x0],
    [-dy, y0 - b.y0],
    [dy, b.y1 - y0],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/**
 * The polar figure: rings at nice radii, spokes every 30° with labels outside
 * the disc, the curve (broken where r has no value).
 */
export function polarPlotSvg(fig: PolarFigure): string {
  const W = fig.width ?? 380;
  const finite = fig.samples.filter((s) => Number.isFinite(s.r));
  let rmax = 0;
  for (const s of finite) rmax = Math.max(rmax, Math.abs(s.r));
  if (!(rmax > 0)) rmax = 1;
  const rows = linearAxis(0, rmax, { target: 4, loose: true });
  const rings = rows.values.filter((v) => v > 0);
  const rOuter = rings.length ? rings[rings.length - 1] : rmax;
  const ringText = rows.values.map((v, i) => ({ v, text: rows.labels[i] })).filter((t) => t.v > 0);
  const mt = fig.title ? 26 : 8;
  const pad = 34; // room for the angle labels outside the disc
  const R = Math.max(40, (W - 2 * pad) / 2);
  const cx = W / 2;
  const cyc = mt + pad - 10 + R;
  const toPx = (x: number, y: number): [number, number] => [cx + (x / rOuter) * R, cyc - (y / rOuter) * R];

  // The curve, as px polylines broken at non-finite samples.
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const s of fig.samples) {
    if (!Number.isFinite(s.r)) {
      if (cur.length) runs.push(cur);
      cur = [];
      continue;
    }
    const p = polarToXY(s);
    cur.push(toPx(p.x, p.y));
  }
  if (cur.length) runs.push(cur);

  // Ring labels: try the mid-spoke angles; pick the one the curve stays clear of.
  const labelBox = (rv: number, angDeg: number, text: string): { x: number; y: number; box: { x0: number; y0: number; x1: number; y1: number } } => {
    const a = (angDeg * Math.PI) / 180;
    const rr = (rv / rOuter) * R + 3;
    const x = cx + rr * Math.cos(a);
    const y = cyc - rr * Math.sin(a);
    const w = text.length * 6.2;
    // Anchored at its inner corner so the text sits just OUTSIDE its ring.
    const left = Math.cos(a) >= 0 ? x : x - w;
    const base = Math.sin(a) >= 0 ? y : y + 9;
    return { x: left, y: base, box: { x0: left - 1, y0: base - 9, x1: left + w + 1, y1: base + 2 } };
  };
  const hits = (box: { x0: number; y0: number; x1: number; y1: number }): boolean =>
    runs.some((run) => run.some((p, k) => k > 0 && segHitsBox(run[k - 1][0], run[k - 1][1], p[0], p[1], box)));
  const candidates = [75, 105, 45, 135, 15, 165, 195, 345, 225, 315, 255, 285];
  let best = candidates[0];
  let bestClear = -1;
  for (const ang of candidates) {
    const clear = ringText.filter((t) => !hits(labelBox(t.v, ang, t.text).box)).length;
    if (clear > bestClear) {
      bestClear = clear;
      best = ang;
    }
    if (clear === ringText.length) break;
  }
  const onRing = ringText.filter((t) => !hits(labelBox(t.v, best, t.text).box));
  const toScale = ringText.filter((t) => !onRing.includes(t));
  const scaleH = toScale.length ? 34 : 0;
  const H = cyc + R + pad - 4 + scaleH;
  const notes = [...(fig.notes ?? [])];
  if (finite.some((s) => s.r < 0)) notes.push("Where r < 0 the point is drawn at angle θ + π (the standard convention).");
  if (rows.multiplier) notes.push(`Ring labels are in units of ${rows.multiplier}.`);
  const noteLines = layoutNotes(notes, W);
  const outH = H + (noteLines.length ? noteLines.length * NOTE_LH + 4 : 0);

  const parts: string[] = [`<rect width="${W}" height="${outH}" fill="#ffffff"/>`];
  // Grid: rings, then spokes.
  for (const v of rings) {
    parts.push(`<circle cx="${f1(cx)}" cy="${f1(cyc)}" r="${f1((v / rOuter) * R)}" fill="none" stroke="${v === rOuter ? "#888888" : "#dddddd"}" stroke-width="1"/>`);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    const [x, y] = [cx + R * Math.cos(a), cyc - R * Math.sin(a)];
    parts.push(`<line x1="${f1(cx)}" y1="${f1(cyc)}" x2="${f1(x)}" y2="${f1(y)}" stroke="#dddddd" stroke-width="1"/>`);
    const lx = cx + (R + 7) * Math.cos(a);
    const ly = cyc - (R + 7) * Math.sin(a);
    const c = Math.cos(a);
    const anchor = Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end";
    const dy = Math.sin(a) > 0.2 ? -2 : Math.sin(a) < -0.2 ? 10 : 3.5;
    const text = fig.angleUnit === "deg" ? `${k * 30}°` : piLabel(k);
    parts.push(`<text x="${f1(lx)}" y="${f1(ly + dy)}" text-anchor="${anchor}" font-family="${FONT}" font-size="10" fill="#333333">${escapeXml(text)}</text>`);
  }
  // The curve.
  const color = fig.color ?? "#0072B2";
  const d = runs
    .filter((r) => r.length >= 2)
    .map((r) => r.map(([x, y], k) => `${k === 0 ? "M" : "L"}${f1(x)},${f1(y)}`).join(" "))
    .join(" ");
  if (d) parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`);
  for (const r of runs.filter((r) => r.length === 1)) parts.push(`<circle cx="${f1(r[0][0])}" cy="${f1(r[0][1])}" r="1.8" fill="${color}"/>`);
  // Ring labels on the disc.
  for (const t of onRing) {
    const lb = labelBox(t.v, best, t.text);
    parts.push(`<text x="${f1(lb.x)}" y="${f1(lb.y)}" font-family="${FONT}" font-size="10" fill="#555555">${escapeXml(t.text)}</text>`);
  }
  // Any the curve would cross: a radial scale under the disc, centre to rim.
  if (toScale.length) {
    const y0 = cyc + R + pad - 4 + 6;
    parts.push(`<line x1="${f1(cx)}" y1="${f1(y0)}" x2="${f1(cx + R)}" y2="${f1(y0)}" stroke="#888888" stroke-width="1"/>`);
    parts.push(`<text x="${f1(cx - 6)}" y="${f1(y0 + 3.5)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="#333333">r</text>`);
    for (const t of [{ v: 0, text: "0" }, ...ringText]) {
      const x = cx + (t.v / rOuter) * R;
      parts.push(`<line x1="${f1(x)}" y1="${f1(y0)}" x2="${f1(x)}" y2="${f1(y0 + 4)}" stroke="#888888"/>`);
      parts.push(`<text x="${f1(x)}" y="${f1(y0 + 16)}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#333333">${escapeXml(t.text)}</text>`);
    }
  }
  if (fig.title) {
    parts.push(`<text data-figure-title="1" x="${f1(W / 2)}" y="16" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="bold" fill="#222222">${escapeXml(fig.title)}</text>`);
  }
  noteLines.forEach((line, i) => {
    parts.push(`<text x="8" y="${H + 11 + i * NOTE_LH}" font-family="${FONT}" font-size="${NOTE_SIZE}" fill="#555555">${escapeXml(line)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${outH}" viewBox="0 0 ${W} ${outH}">${parts.join("")}</svg>`;
}
