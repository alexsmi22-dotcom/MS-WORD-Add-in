/**
 * Detail views (the table release): a circle on a figure, and the part of that figure inside it
 * drawn again, larger, as a view of its own — "Detail views of portions of elements, on a larger
 * scale if necessary, may also be used" (37 CFR 1.84(h)); "When a portion of a view is enlarged
 * for magnification purposes, the view and the enlarged view must each be labeled as separate
 * views" (1.84(h)(2)). ASME Y14.3 and ISO 128 label the circle with a letter and the view with that
 * letter and its scale. Pure: the parent view's line drawing in, the detail's line drawing out,
 * already enlarged, so the sheet lays it out at its one scale like any view.
 */
import type { LineDrawing } from "./cadLines";

type Pt = [number, number];
type Polyline = Pt[];

/** Detail-view sizes on offer (the enlargement over the parent view). */
export const DETAIL_FACTORS = [2, 3, 4, 5, 10];
/** How many points a circle is drawn with. */
const CIRCLE_STEPS = 72;

/** The parts of a polyline inside a circle (segment by segment, cut exactly at the circle). */
export function clipPolyline(line: Polyline, c: Pt, r: number): Polyline[] {
  const out: Polyline[] = [];
  let cur: Polyline | null = null;
  const inside = (p: Pt): boolean => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const fx = a[0] - c[0], fy = a[1] - c[1];
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
    let t0 = 0, t1 = 1;
    if (A === 0) {
      if (!inside(a)) {
        cur = null;
        continue;
      }
    } else {
      const disc = B * B - 4 * A * C;
      if (disc < 0) {
        cur = null;
        continue;
      }
      const sq = Math.sqrt(disc);
      t0 = Math.max(0, (-B - sq) / (2 * A));
      t1 = Math.min(1, (-B + sq) / (2 * A));
      if (t0 >= t1) {
        cur = null;
        continue;
      }
    }
    const p0: Pt = [a[0] + dx * t0, a[1] + dy * t0], p1: Pt = [a[0] + dx * t1, a[1] + dy * t1];
    if (cur && t0 === 0) cur.push(p1);
    else {
      cur = [p0, p1];
      out.push(cur);
    }
    if (t1 < 1) cur = null;
  }
  return out;
}

/** A circle as a closed polyline. */
export function circlePolyline(c: Pt, r: number): Polyline {
  const out: Polyline = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_STEPS;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/**
 * The detail: the parent's visible and hidden lines inside the circle, enlarged by `factor` about
 * its centre, with the circle itself (enlarged) as its boundary. Coordinates stay in the parent's
 * plane, scaled about the centre — so a point at the centre stays put.
 */
export function detailDrawing(parent: LineDrawing, c: Pt, r: number, factor: number): LineDrawing & { boundary: Polyline } {
  const grow = (p: Pt): Pt => [c[0] + (p[0] - c[0]) * factor, c[1] + (p[1] - c[1]) * factor];
  const clip = (lines: Polyline[]): Polyline[] => lines.flatMap((l) => clipPolyline(l, c, r)).map((l) => l.map(grow));
  const R = r * factor;
  return {
    visible: clip(parent.visible),
    hidden: clip(parent.hidden),
    boundary: circlePolyline(c, R),
    bounds: { minX: c[0] - R, minY: c[1] - R, maxX: c[0] + R, maxY: c[1] + R },
    stats: parent.stats,
  };
}

/** Next free detail letter: A, B, … (I, O and Q are not used for view letters: ASME Y14.3). */
export function nextDetailLetter(taken: string[]): string {
  for (const ch of "ABCDEFGHJKLMNPRSTUVWXYZ") if (!taken.includes(ch)) return ch;
  return "";
}
