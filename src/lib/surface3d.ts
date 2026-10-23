// 3D surface plots of z = f(x, y) (Plot ▸ Plot type ▸ 3D surface).
//
// SCOPE — what this draws, and what it deliberately does not:
//
//   IN   * A height field z = f(x, y) over a rectangle, sampled on an n × n grid
//          (n ≤ SURFACE_GRID_MAX), drawn as quadrilaterals.
//        * Two styles: "filled" — each quad filled from the sequential blue ramp
//          (chartPalette SEQUENTIAL_BLUE, light = low z) by its mean z, with a
//          thin mesh edge; "wireframe" — white quads with dark edges, so hidden
//          lines are still hidden.
//        * A fixed view chosen by azimuth and elevation in degrees (defaults
//          −60° and 30°, the matplotlib defaults, so a reader who knows that
//          picture sees the same one). Azimuth is measured in the x–y plane from
//          +x toward +y to the viewer; elevation from the x–y plane, 0°–90°.
//        * ORTHOGRAPHIC projection of the normalised box (x and y each span 1,
//          z spans 0.8), so parallel edges stay parallel and nothing is
//          foreshortened by distance.
//        * An axes box: the three back panes drawn behind the surface, and
//          ticked, labelled x, y and z axes on the box's outer edges, labels
//          outside the box so the surface never covers them.
//   HIDDEN-SURFACE RULE — painter's algorithm in HORIZONTAL DEPTH order: quads
//          are drawn far to near by the distance of their centre along the
//          view direction projected onto the x–y plane. For a height field
//          seen from above (elevation ≥ 0) a sight line meets the surface
//          first at its horizontally nearest crossing, so drawing nearer cells
//          later is correct cell by cell. It can be wrong WITHIN one cell (a
//          non-planar quad folding over itself), which a finer grid shrinks.
//   OUT  * Interactive rotation (fix the view with the two fields instead).
//        * Perspective, lighting and shading; views from below (elevation < 0).
//        * Surfaces that are not a function of (x, y) (spheres, tori) and
//          intersecting surfaces.
//        * Holes are NOT interpolated: a quad with any non-finite corner is
//          left out, so the surface shows a gap there, and the figure says how
//          many grid points had no value.

import { CompiledExpr, escapeXml, layoutNotes, NOTE_LH, NOTE_SIZE, BW_NOTE_SIZE, BW_NOTE_LH, bwPx } from "./plot";
import { linearAxis } from "./axis";
import { SEQUENTIAL_BLUE, sampleRamp } from "./chartPalette";
import { Grid, gridRange, sampleGrid, cellOk, levelLabels } from "./contour";

const FONT = "Arial, Helvetica, sans-serif";

/** Hard cap on either grid dimension for a surface (n² quads go into the SVG). */
export const SURFACE_GRID_MAX = 120;

export type SurfaceStyle = "filled" | "wireframe";

export interface SurfaceFigure {
  grid: Grid;
  azimuthDeg?: number;
  elevationDeg?: number;
  style?: SurfaceStyle;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  zlabel?: string;
  notes?: string[];
  width?: number;
  /**
   * Black and white (37 CFR 1.84(a)(1), the USPTO figure style): the wireframe as hidden-line
   * line art (white faces, black edges, painter's order), white back panes with black edges, no
   * grey gridlines. The filled style carries z in colour and is not drawn in black and white
   * (plotKinds refuses it with advice).
   */
  bw?: boolean;
}

/** The grid for a surface: contour.ts sampleGrid (one sampler, two figures), capped at SURFACE_GRID_MAX. */
export function sampleSurface(f: CompiledExpr, xmin: number, xmax: number, ymin: number, ymax: number, n: number): Grid {
  return sampleGrid(f, xmin, xmax, ymin, ymax, n, n, SURFACE_GRID_MAX);
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
const HZ = 0.4; // half-height of the normalised box (z spans 0.8)

export interface View {
  /** Screen right, screen up, and horizontal view direction (toward the viewer). */
  project: (x: number, y: number, z: number) => [number, number];
  /** Horizontal depth: larger = nearer the viewer. */
  depth: (x: number, y: number) => number;
}

/** The orthographic view for an azimuth/elevation in degrees (normalised coordinates). */
export function makeView(azDeg: number, elDeg: number): View {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const ce = Math.cos(el);
  const se = Math.sin(el);
  return {
    project: (x, y, z) => [-sa * x + ca * y, -se * (ca * x + sa * y) + ce * z],
    depth: (x, y) => ca * x + sa * y,
  };
}

/** The surface figure (see the scope comment at the top of this file). */
/** An axis title with no clear spot beside the box at the margin tried (surfacePlotSvg then widens the margin). */
class SurfaceTitleRoom extends Error {}

/**
 * The surface figure. The side margins start at 74 units (every short-title figure exactly as before); an axis title
 * with no clear spot widens them in 30-unit steps (the box shrinks, to no less than 30 % of the width), and past that
 * is refused by name.
 */
export function surfacePlotSvg(fig: SurfaceFigure): string {
  let last: unknown = null;
  // Widened only while the box keeps at least 30 % of the canvas width (a narrow canvas never shrinks it to nothing).
  const W = fig.width ?? 380;
  const sides = [74, 104, 134, 164].filter((sd, i) => i === 0 || W - 2 * sd >= 100);
  for (const side of sides) {
    try {
      return drawSurface(fig, side);
    } catch (e) {
      if (!(e instanceof SurfaceTitleRoom)) throw e;
      last = e;
    }
  }
  throw new Error((last as Error).message);
}

function drawSurface(fig: SurfaceFigure, side: number): string {
  const W = fig.width ?? 380;
  const bw = fig.bw === true;
  const INK = bw ? "#000000" : "#333333";
  const AXIS = bw ? "#000000" : "#555555";
  const H0 = Math.round(W * 0.82);
  const g = fig.grid;
  const az = Number.isFinite(fig.azimuthDeg) ? (fig.azimuthDeg as number) : -60;
  const el = Math.max(0, Math.min(90, Number.isFinite(fig.elevationDeg) ? (fig.elevationDeg as number) : 30));
  const view = makeView(az, el);
  const xlo = g.xs[0];
  const xhi = g.xs[g.xs.length - 1];
  const ylo = g.ys[0];
  const yhi = g.ys[g.ys.length - 1];
  const zr = gridRange(g) ?? { lo: 0, hi: 1 };
  let zlo = zr.lo;
  let zhi = zr.hi;
  if (zlo === zhi) {
    zlo -= 1;
    zhi += 1;
  }
  const zRow0 = linearAxis(zlo, zhi, { target: 4 });
  // RULE C on the z axis too: ticks crowded far from zero (10⁶ + 10⁻⁷x) read as
  // "1 000 000.0000001"; they are labelled as an offset named in the axis title.
  const zOff = zRow0.labels.some((l) => l.length > 10) ? levelLabels(zRow0.values) : null;
  const zAxisRow = zOff && zOff.offset ? { values: zRow0.values, labels: zOff.labels, multiplier: zOff.multiplier } : zRow0;
  const zTitle = (fig.zlabel || "z") + (zOff && zOff.offset ? ` ${zOff.offset}` : "");
  const xAxisRow = linearAxis(xlo, xhi, { target: 5 });
  const yAxisRow = linearAxis(ylo, yhi, { target: 5 });
  const nx = (x: number): number => (x - xlo) / (xhi - xlo) - 0.5;
  const ny = (y: number): number => (y - ylo) / (yhi - ylo) - 0.5;
  const nz = (z: number): number => ((z - zlo) / (zhi - zlo) - 0.5) * 2 * HZ;

  // Fit the projected box (and room for labels) into the canvas.
  const corners: [number, number, number][] = [];
  for (const X of [-0.5, 0.5]) for (const Y of [-0.5, 0.5]) for (const Z of [-HZ, HZ]) corners.push([X, Y, Z]);
  const proj = corners.map(([X, Y, Z]) => view.project(X, Y, Z));
  const pu = proj.map((p) => p[0]);
  const pv = proj.map((p) => p[1]);
  const umin = Math.min(...pu);
  const umax = Math.max(...pu);
  const vmin = Math.min(...pv);
  const vmax = Math.max(...pv);
  const mt = (fig.title ? 30 : 14) + 16; // + the z title above the z axis
  // side: tick labels + axis titles either side (74 unless a long title needs more; see surfacePlotSvg)
  const bottom = 46;
  const scale = Math.min((W - 2 * side) / (umax - umin), (H0 - mt - bottom) / (vmax - vmin));
  const ox = W / 2 - ((umin + umax) / 2) * scale;
  const oy = mt + (H0 - mt - bottom) / 2 + ((vmin + vmax) / 2) * scale;
  const S = (X: number, Y: number, Z: number): [number, number] => {
    const [u, v] = view.project(X, Y, Z);
    return [ox + u * scale, oy - v * scale];
  };
  const H = H0;
  const notes = [...(fig.notes ?? [])];
  // Seen from (nearly) straight above, the vertical z axis projects to a point: its tick labels would all print on one
  // spot. It is left out and the figure says so.
  // Likewise an x or y axis seen end-on (azimuth along it, elevation 0). Screen length of each unit box edge, in px.
  const azr = (az * Math.PI) / 180;
  const elr = (el * Math.PI) / 180;
  const xAxisShown = Math.hypot(Math.sin(azr), Math.sin(elr) * Math.cos(azr)) * scale >= 24;
  const yAxisShown = Math.hypot(Math.cos(azr), Math.sin(elr) * Math.sin(azr)) * scale >= 24;
  const zAxisShown = Math.cos(elr) * 2 * HZ * scale >= 24;
  const hidden = [xAxisShown ? "" : "x", yAxisShown ? "" : "y", zAxisShown ? "" : "z"].filter(Boolean);
  if (hidden.length) notes.push(`From this view the ${hidden.join(" and ")} axis ${hidden.length > 1 ? "edges have" : "edge has"} no length on the page, so ${hidden.join(" and ")} ${hidden.length > 1 ? "are" : "is"} not labelled.`);
  const noteSize = bw ? BW_NOTE_SIZE : NOTE_SIZE;
  const noteLh = bw ? BW_NOTE_LH : NOTE_LH;
  const noteLines = layoutNotes(notes, W, noteSize);
  const outH = H + (noteLines.length ? noteLines.length * noteLh + 4 : 0);
  const parts: string[] = [`<rect width="${W}" height="${outH}" fill="#ffffff"/>`];
  const poly = (pts: [number, number][], fill: string, stroke: string, sw: number): string =>
    `<polygon points="${pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

  // Which side of the box is nearer the viewer, along x and along y.
  const ca = Math.cos((az * Math.PI) / 180);
  const sa = Math.sin((az * Math.PI) / 180);
  const xNear = ca >= 0 ? 0.5 : -0.5; // the x face nearer the viewer
  const yNear = sa >= 0 ? 0.5 : -0.5;
  // Back panes: the far x face, the far y face, the floor.
  const pane = bw ? "#ffffff" : "#f3f3f3";
  const edge = bw ? "#000000" : "#b5b5b5";
  parts.push(poly([S(-xNear, -0.5, -HZ), S(-xNear, 0.5, -HZ), S(-xNear, 0.5, HZ), S(-xNear, -0.5, HZ)], pane, edge, 0.8));
  parts.push(poly([S(-0.5, -yNear, -HZ), S(0.5, -yNear, -HZ), S(0.5, -yNear, HZ), S(-0.5, -yNear, HZ)], pane, edge, 0.8));
  parts.push(poly([S(-0.5, -0.5, -HZ), S(0.5, -0.5, -HZ), S(0.5, 0.5, -HZ), S(-0.5, 0.5, -HZ)], pane, edge, 0.8));
  // z gridlines on the two back walls.
  // (Patent drawings carry no light grid: none in black and white.)
  for (const v of bw ? [] : zAxisRow.values) {
    const Z = nz(v);
    const a = S(-xNear, -yNear, Z);
    parts.push(`<polyline points="${f1(S(-xNear, yNear, Z)[0])},${f1(S(-xNear, yNear, Z)[1])} ${f1(a[0])},${f1(a[1])} ${f1(S(xNear, -yNear, Z)[0])},${f1(S(xNear, -yNear, Z)[1])}" fill="none" stroke="#dedede" stroke-width="0.7"/>`);
  }

  // The quads, far to near (horizontal depth of the centre).
  const cells: { d: number; i: number; j: number; zm: number }[] = [];
  for (let j = 0; j < g.ys.length - 1; j++)
    for (let i = 0; i < g.xs.length - 1; i++) {
      const v = [g.z[j][i], g.z[j][i + 1], g.z[j + 1][i + 1], g.z[j + 1][i]];
      // Holes and jump cells (contour.ts JUMPS) leave a gap: no vertical wall up a pole.
      if (!cellOk(g, i, j)) continue;
      const cxn = (nx(g.xs[i]) + nx(g.xs[i + 1])) / 2;
      const cyn = (ny(g.ys[j]) + ny(g.ys[j + 1])) / 2;
      cells.push({ d: view.depth(cxn, cyn), i, j, zm: (v[0] + v[1] + v[2] + v[3]) / 4 });
    }
  cells.sort((a, b) => a.d - b.d);
  const wire = fig.style === "wireframe" || bw;
  const meshW = g.xs.length > 60 ? 0.2 : 0.35;
  const wireW = bw ? (g.xs.length > 60 ? 0.3 : 0.5) : 0.6;
  for (const c of cells) {
    const { i, j } = c;
    const P = (ii: number, jj: number): [number, number] => S(nx(g.xs[ii]), ny(g.ys[jj]), nz(g.z[jj][ii]));
    const fill = wire ? "#ffffff" : sampleRamp(SEQUENTIAL_BLUE, (c.zm - zlo) / (zhi - zlo));
    parts.push(poly([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], fill, wire ? (bw ? "#000000" : "#333333") : "#2b3a4a", wire ? wireW : meshW));
  }

  // Every style (review round 1, then the final review): an axis title may not touch the 3D box (its edges or the surface inside
  // it), a tick label or the canvas edge. The box's screen outline is the convex hull of its eight corners.
  const hull = ((): [number, number][] => {
    const pts = corners.map(([X, Y, Z]) => S(X, Y, Z)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: [number, number][] = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: [number, number][] = [];
    for (const p of [...pts].reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  })();
  const inHull = (x: number, y: number): boolean => {
    let sign = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (c !== 0) {
        if (sign === 0) sign = Math.sign(c);
        else if (Math.sign(c) !== sign) return false;
      }
    }
    return true;
  };
  type TBox = { x0: number; y0: number; x1: number; y1: number };
  /** Does a title box meet the box outline (an edge crossing it, or a corner of it inside the outline)? Sampled every 2 px along each hull edge. */
  const meetsHull = (b: TBox): boolean => {
    if ([[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].some(([x, y]) => inHull(x, y))) return true;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const c = hull[(i + 1) % hull.length];
      const n = Math.min(400, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2));
      for (let k = 0; k <= n; k++) {
        const x = a[0] + ((c[0] - a[0]) * k) / n;
        const y = a[1] + ((c[1] - a[1]) * k) / n;
        if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) return true;
      }
    }
    return false;
  };
  /** The title as one line, else split at the space that balances two lines best. */
  const titleVariants = (t: string): string[][] => {
    const out: string[][] = [[t]];
    const words = t.split(" ");
    let best: string[] | null = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      if (!best || Math.abs(a.length - b.length) < Math.abs(best[0].length - best[1].length)) best = [a, b];
    }
    if (best) out.push(best);
    // Three lines, the longest as short as possible (a narrow journal column: "Vertical / displacement / (mm)").
    let three: string[] | null = null;
    for (let i = 1; i < words.length - 1; i++)
      for (let j = i + 1; j < words.length; j++) {
        const parts3 = [words.slice(0, i).join(" "), words.slice(i, j).join(" "), words.slice(j).join(" ")];
        if (!three || Math.max(...parts3.map((q) => q.length)) < Math.max(...three.map((q) => q.length))) three = parts3;
      }
    if (three) out.push(three);
    return out;
  };
  const tooLong = (t: string): Error =>
    new SurfaceTitleRoom(
      bw
        ? `the axis title “${t}” has no room beside the 3D box in a USPTO drawing (its letters cannot be smaller than 37 CFR 1.84(p)(3) allows); shorten it`
        : `the axis title “${t}” has no room beside the 3D box, even on two lines; shorten it`,
    );

  // Axes on the outer edges, labels pushed away from the box centre.
  const [bcx, bcy] = S(0, 0, 0);
  /** Text boxes already drawn (the layout audit's own width estimate, 0.58 em, rounded up). */
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const boxOf = (x: number, y: number, anchor: string, text: string, size: number): { x0: number; y0: number; x1: number; y1: number } => {
    const w = text.length * size * 0.6;
    const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    return { x0, y0: y - size * 0.8, x1: x0 + w, y1: y + size * 0.2 };
  };
  const axis = (
    a: [number, number, number],
    b: [number, number, number],
    row: { values: number[]; labels: string[]; multiplier: string },
    at: (v: number) => [number, number, number],
    title: string,
    lo: number,
    hi: number,
    skipLo: boolean,
    skipHi: boolean,
    titleOnTop: boolean,
  ): void => {
    const A = S(...a);
    const B = S(...b);
    parts.push(`<line x1="${f1(A[0])}" y1="${f1(A[1])}" x2="${f1(B[0])}" y2="${f1(B[1])}" stroke="${AXIS}" stroke-width="1"/>`);
    // Outward normal in screen space.
    let nxs = -(B[1] - A[1]);
    let nys = B[0] - A[0];
    const len = Math.hypot(nxs, nys) || 1;
    nxs /= len;
    nys /= len;
    const mx = (A[0] + B[0]) / 2;
    const my = (A[1] + B[1]) / 2;
    if ((mx - bcx) * nxs + (my - bcy) * nys < 0) {
      nxs = -nxs;
      nys = -nys;
    }
    const anchor = nxs > 0.35 ? "start" : nxs < -0.35 ? "end" : "middle";
    const span = hi - lo;
    row.values.forEach((v, k) => {
      // A tick at a corner another axis labels too would put two labels on one spot.
      const frac = (v - lo) / span;
      if ((skipLo && frac < 0.04) || (skipHi && frac > 0.96)) return;
      const T = S(...at(v));
      parts.push(`<line x1="${f1(T[0])}" y1="${f1(T[1])}" x2="${f1(T[0] + nxs * 4)}" y2="${f1(T[1] + nys * 4)}" stroke="${AXIS}"/>`);
      const lx = T[0] + nxs * 9;
      const ly = T[1] + nys * 9 + 3.5;
      placed.push(boxOf(lx, ly, anchor, row.labels[k], 10));
      parts.push(`<text x="${f1(lx)}" y="${f1(ly)}" text-anchor="${anchor}" font-family="${FONT}" font-size="10" fill="${INK}">${escapeXml(row.labels[k])}</text>`);
    });
    const full = row.multiplier ? `${title} (${row.multiplier})` : title;
    const tsz = bwPx(full, 11, bw);
    const clearOf = (b: TBox): boolean =>
      b.x0 >= 4 && b.x1 <= W - 4 && b.y0 >= 2 && b.y1 <= H - 2 && !meetsHull(b) && !placed.some((p) => p.x0 < b.x1 + 3 && b.x0 < p.x1 + 3 && p.y0 < b.y1 + 4 && b.y0 < p.y1 + 4);
    const LH = tsz * 1.2;
    const drawLines = (lines: string[], x: number, y0: number, anchorHere: string): void => {
      lines.forEach((t, i) => {
        placed.push(boxOf(x, y0 + i * LH, anchorHere, t, tsz));
        parts.push(`<text x="${f1(x)}" y="${f1(y0 + i * LH)}" text-anchor="${anchorHere}" font-family="${FONT}" font-size="${tsz}" fill="${INK}">${escapeXml(t)}</text>`);
      });
    };
    const blockBox = (lines: string[], x: number, y0: number, anchorHere: string): TBox => {
      const bs = lines.map((t, i) => boxOf(x, y0 + i * LH, anchorHere, t, tsz));
      return { x0: Math.min(...bs.map((q) => q.x0)), y0: bs[0].y0, x1: Math.max(...bs.map((q) => q.x1)), y1: bs[bs.length - 1].y1 };
    };
    if (titleOnTop) {
      // Above the top end of the vertical axis, moved sideways (never over the box) or set on two lines.
      const top = A[1] < B[1] ? A : B;
      for (const lines of titleVariants(full)) {
        // Raised in 6 px steps (the box's back edges rise away from the axis top), then moved sideways.
        for (let j = 0; j <= 12; j++) {
          const y0 = top[1] - 9 - (lines.length - 1) * LH - j * 6;
          for (let k = 0; k <= 40; k++) {
            const dx = k % 2 ? -Math.ceil(k / 2) * 6 : (k / 2) * 6;
            if (!clearOf(blockBox(lines, top[0] + dx, y0, "middle"))) continue;
            drawLines(lines, top[0] + dx, y0, "middle");
            return;
          }
        }
      }
      throw tooLong(full);
    }
    {
      // Beside the edge, pushed out along its normal until clear of the box, the tick labels and the canvas edge.
      for (const lines of titleVariants(full)) {
        for (let off = 22; off <= 22 + 5 * 20; off += 5) {
          const tx = mx + nxs * off;
          const ty = my + nys * off + 4 - (nys < -0.35 ? (lines.length - 1) * LH : 0);
          if (!clearOf(blockBox(lines, tx, ty, anchor))) continue;
          drawLines(lines, tx, ty, anchor);
          return;
        }
      }
      throw tooLong(full);
    }
  };
  // z on the vertical silhouette edge furthest left on screen (never the near corner).
  const verticals: [number, number][] = [
    [-xNear, yNear],
    [xNear, -yNear],
  ];
  const zEdge = verticals.reduce((best, e) => (S(e[0], e[1], 0)[0] < S(best[0], best[1], 0)[0] ? e : best));
  const zOnX = zEdge[0] === -xNear; // z's foot is the far end of the x edge, else of the y edge
  // x runs along the bottom edge on the near-y side; y along the near-x side.
  // Their shared corner is at x = xNear, y = yNear; z's foot is the other end of one of them.
  const xFar = -xNear;
  const yFar = -yNear;
  if (xAxisShown) axis([-0.5, yNear, -HZ], [0.5, yNear, -HZ], xAxisRow, (v) => [nx(v), yNear, -HZ], fig.xlabel || "x", xlo, xhi,
    xNear < 0 || (zOnX && xFar < 0), xNear > 0 || (zOnX && xFar > 0), false);
  if (yAxisShown) axis([xNear, -0.5, -HZ], [xNear, 0.5, -HZ], yAxisRow, (v) => [xNear, ny(v), -HZ], fig.ylabel || "y", ylo, yhi,
    yNear < 0 || (!zOnX && yFar < 0), yNear > 0 || (!zOnX && yFar > 0), false);
  if (zAxisShown) axis([zEdge[0], zEdge[1], -HZ], [zEdge[0], zEdge[1], HZ], zAxisRow, (v) => [zEdge[0], zEdge[1], nz(v)], zTitle, zlo, zhi, true, false, true);

  if (fig.title) {
    parts.push(`<text data-figure-title="1" x="${f1(W / 2)}" y="16" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="bold" fill="${bw ? "#000000" : "#222222"}">${escapeXml(fig.title)}</text>`);
  }
  noteLines.forEach((line, i) => {
    parts.push(`<text x="8" y="${H + (bw ? 15 : 11) + i * noteLh}" font-family="${FONT}" font-size="${noteSize}" fill="${bw ? "#000000" : "#555555"}">${escapeXml(line)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${outH}" viewBox="0 0 ${W} ${outH}">${parts.join("")}</svg>`;
}
