// Contour plots of z = f(x, y) over a rectangle (Plot ▸ Plot type ▸ Contour).
//
// THE ENGINE, in three pieces, each testable alone:
//
//   sampleGrid       f on an nx × ny lattice (hard caps; non-finite values are
//                    KEPT as NaN so the figure can show them as holes).
//   marchingSquares  iso-lines at given levels, chained into polylines.
//   isobands         filled regions between consecutive levels.
//
// RULES, stated once and pinned in contour.test.ts:
//
//   * A corner counts as ABOVE a level when z ≥ level (a value exactly on the
//     level is above). Crossings are placed by linear interpolation along the
//     cell edge, so a shared edge gives the same point from both of its cells.
//   * SADDLES (opposite corners above, the other two below — cases 5 and 10)
//     are resolved by the CENTRE-VALUE RULE: the centre is the mean of the four
//     corners; if it is above the level the two above corners are joined
//     through the cell, otherwise the two below corners are. A centre exactly
//     on the level counts as above, the same tie rule as the corners.
//   * HOLES: a cell with any non-finite corner (1/0, sqrt of a negative, log of
//     zero) is SKIPPED by both the lines and the bands, and drawn grey. A
//     contour never runs through a region where z has no value; the figure says
//     how many grid points had none.
//   * Filled bands are the exact level sets of the piecewise-linear surface on
//     the four triangles that join each cell's corners to its centre (centre =
//     the same mean the saddle rule uses), so band topology agrees with the
//     lines; inside a cell the band edge can sit a fraction of a cell from the
//     straight marching-squares segment, which is far below the grid spacing
//     the user chose.
//   * JUMPS (poles and steps: tan x, 1/x, sign x): the grid only sees values at
//     its points, so a sign change ACROSS a pole looks exactly like a crossing
//     and marching squares would draw a contour where z never takes the level.
//     Every grid edge whose ends differ is therefore bisected JUMP_HALVINGS
//     (10) times, each time keeping the half that changes more. A continuous
//     function's change shrinks as the bracket narrows (smooth: ~1024×; even a
//     cube-root cusp: ~10×); across a pole it grows and across a step it stays.
//     An edge is a JUMP when the change left in its final 1/1024-wide bracket
//     is more than a quarter of the largest change seen in the first two
//     halvings, or when z has no value somewhere along it. A cell with a jump
//     edge is skipped like a hole (drawn grey, counted in the figure). Steep but
//     continuous functions (atan(50x)) still draw; a feature steeper than 1/1024
//     of a cell is indistinguishable from a step and is treated as one.
//   * FLAT: z is "constant" when its range is at most 64 ulps of its largest
//     magnitude (isFlat): sin² x + cos² x (a few ulps of 1) is noise and is not
//     drawn as structure, while 10⁶ + 10⁻⁷x (thousands of ulps) is real
//     variation and draws. 1 + 10⁻¹⁵x on [−10, 10] (~90 ulps) also draws.
//   * LEVEL LABELS (RULE C, levelLabels): pairwise distinct, and each reads back
//     as its own level (within isFlat's 64 ulps and a quarter of the gap to the
//     next level); levels crowded far from zero are labelled as an offset named
//     in the bar title ("z − 1×10⁶"); if even that fails the contour is refused.
//
// The figure carries a colour bar keyed to the levels instead of labels on the
// lines: a number drawn on a curve is a number struck through, and the layout
// gate (scripts/figure-layout-audit.js) rightly flags that.

import { CompiledExpr, plotAxisTicks, escapeXml, layoutNotes, NOTE_LH, NOTE_SIZE } from "./plot";
import { linearAxis, formatIntRow, scale10, fmtSig, fmtValue } from "./axis";
import { SEQUENTIAL_BLUE, sampleRamp } from "./chartPalette";

const FONT = "Arial, Helvetica, sans-serif";

/** Hard cap on either grid dimension (points per side). */
export const CONTOUR_GRID_MAX = 200;
/** Hard cap on the number of levels. */
export const CONTOUR_LEVELS_MAX = 40;

export interface Grid {
  xs: number[];
  ys: number[];
  /** z[j][i] is f(xs[i], ys[j]); NaN where f has no finite value. */
  z: number[][];
  /** How many lattice points had no finite value. */
  holes: number;
  /** Cells (index j·(nx−1)+i) with a jump edge (see JUMPS above); absent = none. */
  broken?: Uint8Array;
  /** How many cells are broken. */
  jumps?: number;
}

/** Bisection depth of the jump test (the bracket ends 1/1024 of an edge wide). */
export const JUMP_HALVINGS = 10;

/** Does z jump (pole, step, or a gap with no value) between two grid points? */
function edgeJumps(f: CompiledExpr, ax: number, ay: number, va: number, bx: number, by: number, vb: number): boolean {
  const d0 = Math.abs(vb - va);
  // LOCAL tolerance: a field-wide one is dominated by the spikes beside a pole
  // (z ≈ 10¹⁶ at a grid point on it) and would wave every real jump through.
  if (!(d0 > 1e-9 * Math.max(Math.abs(va), Math.abs(vb)))) return false;
  let x0 = ax;
  let y0 = ay;
  let v0 = va;
  let x1 = bx;
  let y1 = by;
  let v1 = vb;
  let ref = d0;
  for (let k = 0; k < JUMP_HALVINGS; k++) {
    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    const vm = f([xm, ym]);
    if (!Number.isFinite(vm)) return true;
    const left = Math.abs(vm - v0);
    const right = Math.abs(v1 - vm);
    if (k < 2) ref = Math.max(ref, left, right);
    if (left >= right) {
      x1 = xm;
      y1 = ym;
      v1 = vm;
    } else {
      x0 = xm;
      y0 = ym;
      v0 = vm;
    }
  }
  return Math.abs(v1 - v0) > 0.25 * ref;
}

/** Marks the cells that have a jump edge (see JUMPS in the header). */
export function markJumps(g: Grid, f: CompiledExpr): void {
  const r = gridRange(g);
  const nx = g.xs.length;
  const ny = g.ys.length;
  const broken = new Uint8Array(Math.max(0, (nx - 1) * (ny - 1)));
  g.broken = broken;
  g.jumps = 0;
  if (!r) return;
  const hJ = new Uint8Array(nx * ny);
  const vJ = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = g.z[j][i];
      if (!Number.isFinite(v)) continue;
      if (i < nx - 1 && Number.isFinite(g.z[j][i + 1])) hJ[j * nx + i] = edgeJumps(f, g.xs[i], g.ys[j], v, g.xs[i + 1], g.ys[j], g.z[j][i + 1]) ? 1 : 0;
      if (j < ny - 1 && Number.isFinite(g.z[j + 1][i])) vJ[j * nx + i] = edgeJumps(f, g.xs[i], g.ys[j], v, g.xs[i], g.ys[j + 1], g.z[j + 1][i]) ? 1 : 0;
    }
  let n = 0;
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      if (hJ[j * nx + i] || hJ[(j + 1) * nx + i] || vJ[j * nx + i] || vJ[j * nx + i + 1]) {
        broken[j * (nx - 1) + i] = 1;
        n++;
      }
    }
  g.jumps = n;
}

/** A cell both figures may draw: four finite corners and no jump edge. */
export function cellOk(g: Grid, i: number, j: number): boolean {
  if (g.broken && g.broken[j * (g.xs.length - 1) + i]) return false;
  return Number.isFinite(g.z[j][i]) && Number.isFinite(g.z[j][i + 1]) && Number.isFinite(g.z[j + 1][i]) && Number.isFinite(g.z[j + 1][i + 1]);
}

/** z is constant to within float noise: its range is ≤ 10⁻¹² of its magnitude. */
export function isFlat(lo: number, hi: number): boolean {
  if (hi === lo) return true;
  const m = Math.max(Math.abs(lo), Math.abs(hi));
  if (!(m > 0) || !Number.isFinite(m)) return false;
  const ulp = Math.pow(2, Math.floor(Math.log2(m)) - 52);
  return hi - lo <= 64 * ulp;
}

/** One ulp of |v| (0 for 0). */
function ulpOf(v: number): number {
  const m = Math.abs(v);
  return m > 0 && Number.isFinite(m) ? Math.pow(2, Math.floor(Math.log2(m)) - 52) : 0;
}

/** Labels plus the number each one reads back as. */
interface LabelRow {
  labels: string[];
  multiplier: string;
  back: number[];
}

/**
 * Labels for `vals` that read back within `tol[k]` of each value: fixed decimals
 * shared along the bar (at most 10 significant figures wide), else per-label
 * significant figures (at most `maxSig`). Null when neither holds.
 */
function tryLabels(vals: number[], ok: (k: number, back: number) => boolean, maxSig: number): LabelRow | null {
  const maxAbs = vals.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  if (!vals.every(Number.isFinite)) return null;
  if (maxAbs === 0) return { labels: vals.map(() => "0"), multiplier: "", back: vals.map(() => 0) };
  const e0 = Math.floor(Math.log10(maxAbs));
  for (let d = -e0; d <= 9 - e0; d++) {
    const ints = vals.map((v) => Math.round(scale10(v, d)));
    if (!ints.every((n) => Math.abs(n) <= Number.MAX_SAFE_INTEGER)) break;
    const back = ints.map((n) => scale10(n, -d));
    if (back.every((b, k) => ok(k, b))) {
      const row = formatIntRow(ints, -d);
      if (!row.duplicate) return { labels: row.labels, multiplier: row.multiplier, back };
    }
  }
  const labels: string[] = [];
  const back: number[] = [];
  for (let k = 0; k < vals.length; k++) {
    const v = vals[k];
    let done = false;
    if (v === 0 && ok(k, 0)) {
      labels.push("0");
      back.push(0);
      continue;
    }
    for (let sig = 1; sig <= maxSig && !done; sig++) {
      const b = Number(v.toPrecision(sig));
      if (ok(k, b)) {
        labels.push(fmtSig(v, sig));
        back.push(b);
        done = true;
      }
    }
    if (!done) return null;
  }
  return new Set(labels).size === labels.length ? { labels, multiplier: "", back } : null;
}

/**
 * The colour bar's labels (RULE C): the labels are pairwise distinct and each
 * reads back as ITS level — within 64 ulps (isFlat's tolerance) and within a
 * quarter of the gap to its nearest neighbour, so no label can be mistaken for
 * the next level. In order of preference:
 *   1. fixed decimals shared along the bar (≤ 10 significant figures), or each
 *      label to its own significance (≤ 12 figures, ×10ⁿ where the display
 *      contract wants it) — 10⁻¹⁴ beside 1 is "1×10⁻¹⁴", never "0.0000000";
 *   2. an OFFSET: levels crowded far from zero (10⁶ + 10⁻⁷x) are labelled as
 *      their difference from a round number, and the bar's title says so
 *      ("z − 1×10⁶"), the subtraction being exact for neighbouring doubles;
 *   3. null: the caller refuses (the levels cannot be told apart in print).
 */
export function levelLabels(levels: number[]): { labels: string[]; multiplier: string; offset: string } | null {
  if (!levels.length) return { labels: [], multiplier: "", offset: "" };
  if (!levels.every(Number.isFinite)) return null;
  const sorted = [...levels].sort((a, b) => a - b);
  const tol = levels.map((v) => {
    const i = sorted.indexOf(v);
    const gap = Math.min(i > 0 ? v - sorted[i - 1] : Infinity, i < sorted.length - 1 ? sorted[i + 1] - v : Infinity);
    return Math.min(64 * ulpOf(v), gap / 4);
  });
  const plainOk = (k: number, b: number): boolean => Math.abs(b - levels[k]) <= tol[k];
  const plain = tryLabels(levels, plainOk, levels.length === 1 ? 17 : 12);
  if (plain) return { labels: plain.labels, multiplier: plain.multiplier, offset: "" };
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const span = hi - lo;
  const p = Math.floor(Math.log10(span)) + 1;
  const base = span > 0 ? scale10(Math.round(scale10((lo + hi) / 2, -p)), p) : 0;
  const diffs = levels.map((v) => v - base);
  // THE OFFSET BRANCH IS JUDGED ON THE DIFFERENCE: a label must read back as
  // level − offset to within that difference's own rounding (64 ulps of it, or the
  // few ulps of the level the subtraction can carry) — 64 ulps of 10⁶ is 7×10⁻⁹,
  // which let "3" stand for 2.5 when the levels were 2.5×10⁻⁸ apart.
  const gapOf = (k: number): number => {
    const i = sorted.indexOf(levels[k]);
    return Math.min(i > 0 ? levels[k] - sorted[i - 1] : Infinity, i < sorted.length - 1 ? sorted[i + 1] - levels[k] : Infinity);
  };
  const off =
    span > 0 && base !== 0
      ? tryLabels(diffs, (k, b) => Math.abs(b - diffs[k]) <= Math.min(gapOf(k) / 4, Math.max(64 * ulpOf(diffs[k]), 4 * ulpOf(levels[k]))), 12)
      : null;
  if (!off) {
    // Levels typed to 13–15 significant figures: echo them as typed when nothing shorter is exact.
    const long = tryLabels(levels, plainOk, 15);
    return long ? { labels: long.labels, multiplier: long.multiplier, offset: "" } : null;
  }
  let bsig = 1;
  while (bsig < 17 && Number(base.toPrecision(bsig)) !== base) bsig++;
  const btext = fmtSig(Math.abs(base), bsig);
  return { labels: off.labels, multiplier: off.multiplier, offset: base > 0 ? `− ${btext}` : `+ ${btext}` };
}

/** "lo" and "hi" with enough significant figures to differ (a message never says "from 1 to 1"). */
export function rangeText(lo: number, hi: number): [string, string] {
  // Each end READS BACK AS ITSELF to within 10⁻⁴ of the range (or 64 ulps): fmtValue's
  // three figures printed 1 000 004 as "1×10⁶". The fewest figures that do, plain
  // digits below 10⁷.
  const tol = Math.max((hi - lo) * 1e-4, 64 * ulpOf(Math.max(Math.abs(lo), Math.abs(hi))));
  const one = (v: number): string => {
    if (v === 0 || !Number.isFinite(v)) return fmtValue(v);
    for (let sig = 1; sig <= 15; sig++) if (Math.abs(Number(v.toPrecision(sig)) - v) <= tol) return fmtSig(v, sig, 7);
    return fmtSig(v, 15, 7);
  };
  return [one(lo), one(hi)];
}

/**
 * About how many vertices the contour LINES will hold: one per grid edge whose
 * ends straddle a level. Counted before any line is traced, so a figure far past
 * the size budget is refused in milliseconds rather than after the work.
 */
export function estimateLineVertices(g: Grid, levels: number[], cap = Infinity): number {
  const nx = g.xs.length;
  const ny = g.ys.length;
  const lv = levels.filter(Number.isFinite);
  let n = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = g.z[j][i];
      if (!Number.isFinite(v)) continue;
      const h = i < nx - 1 ? g.z[j][i + 1] : NaN;
      const w = j < ny - 1 ? g.z[j + 1][i] : NaN;
      for (const L of lv) {
        const a = v >= L;
        if (Number.isFinite(h) && a !== h >= L) n++;
        if (Number.isFinite(w) && a !== w >= L) n++;
      }
      if (n > cap) return n;
    }
  return n;
}

/** f on an nx × ny lattice over [xmin, xmax] × [ymin, ymax]. Throws on bad bounds. */
export function sampleGrid(f: CompiledExpr, xmin: number, xmax: number, ymin: number, ymax: number, nx: number, ny: number, cap = CONTOUR_GRID_MAX, jumps = true): Grid {
  if (![xmin, xmax, ymin, ymax].every(Number.isFinite) || !(xmax > xmin) || !(ymax > ymin)) throw new Error("bad range");
  const cx = Math.max(2, Math.min(cap, Math.floor(nx) || 2));
  const cy = Math.max(2, Math.min(cap, Math.floor(ny) || 2));
  const xs = Array.from({ length: cx }, (_, i) => (i === cx - 1 ? xmax : xmin + ((xmax - xmin) * i) / (cx - 1)));
  const ys = Array.from({ length: cy }, (_, j) => (j === cy - 1 ? ymax : ymin + ((ymax - ymin) * j) / (cy - 1)));
  let holes = 0;
  const z = ys.map((y) =>
    xs.map((x) => {
      const v = f([x, y]);
      if (Number.isFinite(v)) return v;
      holes++;
      return NaN;
    }),
  );
  const g: Grid = { xs, ys, z, holes };
  // `jumps: false` defers the jump test (the costly part: up to 10 evaluations per edge) to a caller that
  // may refuse the figure first; it must then call markJumps itself.
  if (jumps) markJumps(g, f);
  return g;
}

/** min and max over the finite values (null when there are none). */
export function gridRange(g: Grid): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of g.z)
    for (const v of row) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return lo <= hi ? { lo, hi } : null;
}

/**
 * "Nice" levels strictly inside (lo, hi): the axis engine's ticks for that
 * range, so a contour at 0.5 means what an axis tick at 0.5 means.
 */
export function niceLevels(lo: number, hi: number, target = 8): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const row = linearAxis(lo, hi, { target });
  const span = hi - lo;
  return row.values.filter((v) => v > lo + span * 1e-9 && v < hi - span * 1e-9).slice(0, CONTOUR_LEVELS_MAX);
}

export interface ContourPath {
  pts: [number, number][];
  closed: boolean;
}
export interface ContourLevel {
  level: number;
  paths: ContourPath[];
}

// Cell corners: 0 = (i, j) bottom-left, 1 = (i+1, j), 2 = (i+1, j+1), 3 = (i, j+1).
// Cell edges: 0 bottom (0–1), 1 right (1–2), 2 top (3–2), 3 left (0–3).
const SEGMENTS: Record<number, [number, number][]> = {
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[0, 2]],
  11: [[1, 2]],
  12: [[1, 3]],
  13: [[0, 1]],
  14: [[3, 0]],
};

/** Iso-lines of the grid at each level, chained into polylines (data coordinates). */
export function marchingSquares(g: Grid, levels: number[]): ContourLevel[] {
  const nx = g.xs.length;
  const ny = g.ys.length;
  const out: ContourLevel[] = [];
  for (const L of levels.slice(0, CONTOUR_LEVELS_MAX)) {
    if (!Number.isFinite(L)) continue;
    // Edge keys: horizontal edge (i,j)-(i+1,j) = "h" + index, vertical (i,j)-(i,j+1) = "v" + index.
    const point = new Map<string, [number, number]>();
    const segs: [string, string][] = [];
    const cross = (key: string, ax: number, ay: number, va: number, bx: number, by: number, vb: number): string => {
      if (!point.has(key)) {
        const t = va === vb ? 0.5 : (L - va) / (vb - va);
        point.set(key, [ax + (bx - ax) * t, ay + (by - ay) * t]);
      }
      return key;
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v0 = g.z[j][i];
        const v1 = g.z[j][i + 1];
        const v2 = g.z[j + 1][i + 1];
        const v3 = g.z[j + 1][i];
        if (!cellOk(g, i, j)) continue;
        const c = (v0 >= L ? 1 : 0) | (v1 >= L ? 2 : 0) | (v2 >= L ? 4 : 0) | (v3 >= L ? 8 : 0);
        if (c === 0 || c === 15) continue;
        const x0 = g.xs[i];
        const x1 = g.xs[i + 1];
        const y0 = g.ys[j];
        const y1 = g.ys[j + 1];
        const edge = (e: number): string => {
          switch (e) {
            case 0:
              return cross(`h${j * nx + i}`, x0, y0, v0, x1, y0, v1);
            case 1:
              return cross(`v${j * nx + i + 1}`, x1, y0, v1, x1, y1, v2);
            case 2:
              return cross(`h${(j + 1) * nx + i}`, x0, y1, v3, x1, y1, v2);
            default:
              return cross(`v${j * nx + i}`, x0, y0, v0, x0, y1, v3);
          }
        };
        let pairs: [number, number][];
        if (c === 5 || c === 10) {
          const centreAbove = (v0 + v1 + v2 + v3) / 4 >= L;
          // Centre above: the above corners connect, so the lines cut off the
          // two BELOW corners; centre below: they cut off the two ABOVE corners.
          // Case 5 = corners 0, 2 above; case 10 = corners 1, 3 above.
          const cutOff13 = c === 5 ? centreAbove : !centreAbove;
          pairs = cutOff13
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [3, 0],
                [1, 2],
              ];
        } else pairs = SEGMENTS[c];
        for (const [a, b] of pairs) segs.push([edge(a), edge(b)]);
      }
    }
    out.push({ level: L, paths: chain(segs, point) });
  }
  return out;
}

/** Joins segments that share an edge crossing into polylines; open chains first, then loops. */
function chain(segs: [string, string][], point: Map<string, [number, number]>): ContourPath[] {
  const adj = new Map<string, number[]>();
  segs.forEach(([a, b], k) => {
    for (const key of [a, b]) {
      const l = adj.get(key);
      if (l) l.push(k);
      else adj.set(key, [k]);
    }
  });
  const used = new Uint8Array(segs.length);
  const paths: ContourPath[] = [];
  const walk = (startSeg: number, from: string): ContourPath => {
    const keys = [from];
    let cur = startSeg;
    let at = from;
    // Bounded: each segment is visited once.
    for (let guard = 0; guard <= segs.length && cur >= 0; guard++) {
      used[cur] = 1;
      const [a, b] = segs[cur];
      const next = a === at ? b : a;
      keys.push(next);
      at = next;
      const cand = (adj.get(next) ?? []).find((k) => !used[k]);
      cur = cand === undefined ? -1 : cand;
    }
    const closed = keys.length > 2 && keys[0] === keys[keys.length - 1];
    return { pts: keys.map((k) => point.get(k) as [number, number]), closed };
  };
  // Open chains start at an end (a crossing used by one segment only).
  for (const [key, list] of adj) {
    if (list.length !== 1 || used[list[0]]) continue;
    paths.push(walk(list[0], key));
  }
  for (let k = 0; k < segs.length; k++) if (!used[k]) paths.push(walk(k, segs[k][0]));
  return paths;
}

/** A filled polygon in data coordinates, in band `band` (0 = below the first level). */
export interface BandPolygon {
  band: number;
  pts: [number, number][];
}

/** Which band a value is in: the number of levels at or below it. */
function bandOf(v: number, levels: number[]): number {
  let k = 0;
  while (k < levels.length && v >= levels[k]) k++;
  return k;
}

type P3 = [number, number, number];

/** Clips a polygon (x, y, z) to z ≥ L (keepAbove) or z < L, interpolating on z. */
function clip(poly: P3[], L: number, keepAbove: boolean): P3[] {
  const out: P3[] = [];
  const inside = (p: P3): boolean => (keepAbove ? p[2] >= L : p[2] < L);
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (L - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, L]);
    }
  }
  return out;
}

/**
 * Filled bands between consecutive levels. Cells wholly inside one band become
 * rectangles, merged along each row (a 200 × 200 grid would otherwise be 40 000
 * shapes); the rest are clipped per triangle.
 */
export function isobands(g: Grid, levels: number[], maxVertices = Infinity): BandPolygon[] | null {
  const lv = levels.filter(Number.isFinite).slice(0, CONTOUR_LEVELS_MAX);
  // The work is bounded by the OUTPUT: once the pieces hold more vertices than
  // the caller's budget the answer is "too detailed", not a 60 MB figure.
  let verts = 0;
  const nx = g.xs.length;
  const ny = g.ys.length;
  const out: BandPolygon[] = [];
  for (let j = 0; j < ny - 1; j++) {
    let runStart = -1;
    let runBand = -1;
    const flush = (endI: number): void => {
      if (runStart < 0) return;
      const xa = g.xs[runStart];
      const xb = g.xs[endI];
      const ya = g.ys[j];
      const yb = g.ys[j + 1];
      out.push({ band: runBand, pts: [[xa, ya], [xb, ya], [xb, yb], [xa, yb]] });
      verts += 4;
      runStart = -1;
    };
    for (let i = 0; i < nx - 1; i++) {
      const v = [g.z[j][i], g.z[j][i + 1], g.z[j + 1][i + 1], g.z[j + 1][i]];
      if (!cellOk(g, i, j)) {
        flush(i);
        continue;
      }
      if (verts > maxVertices) return null;
      const c = (v[0] + v[1] + v[2] + v[3]) / 4;
      const bands = v.map((z) => bandOf(z, lv));
      const bc = bandOf(c, lv);
      if (bands.every((b) => b === bc)) {
        if (runStart >= 0 && runBand !== bc) flush(i);
        if (runStart < 0) {
          runStart = i;
          runBand = bc;
        }
        continue;
      }
      flush(i);
      const x0 = g.xs[i];
      const x1 = g.xs[i + 1];
      const y0 = g.ys[j];
      const y1 = g.ys[j + 1];
      const P: P3[] = [
        [x0, y0, v[0]],
        [x1, y0, v[1]],
        [x1, y1, v[2]],
        [x0, y1, v[3]],
      ];
      const C: P3 = [(x0 + x1) / 2, (y0 + y1) / 2, c];
      for (let t = 0; t < 4; t++) {
        const tri: P3[] = [P[t], P[(t + 1) % 4], C];
        const tb = tri.map((p) => bandOf(p[2], lv));
        const bmin = Math.min(...tb);
        const bmax = Math.max(...tb);
        for (let b = bmin; b <= bmax; b++) {
          let poly = tri;
          if (b > 0) poly = clip(poly, lv[b - 1], true);
          if (poly.length >= 3 && b < lv.length) poly = clip(poly, lv[b], false);
          if (poly.length >= 3) {
            out.push({ band: b, pts: poly.map((p) => [p[0], p[1]] as [number, number]) });
            verts += poly.length;
          }
        }
      }
    }
    flush(nx - 1);
  }
  return verts > maxVertices ? null : out;
}

// ---------------------------------------------------------------------------
// The figure.

export interface ContourFigure {
  grid: Grid;
  levels: number[];
  filled: boolean;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  /** What z is called on the colour bar ("z" when unset). */
  zlabel?: string;
  notes?: string[];
  width?: number;
  /** Precomputed pieces (plotKinds computes them once, under its size budget). */
  bands?: BandPolygon[];
  lines?: ContourLevel[];
}

const HOLE_FILL = "#d4d4d4";
const f1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** The colour of band b of nBands (light = low), or of level k of nLevels for lines. */
function bandColour(b: number, nBands: number): string {
  return sampleRamp(SEQUENTIAL_BLUE, nBands <= 1 ? 0.5 : b / (nBands - 1));
}
function lineColour(k: number, nLevels: number): string {
  // The lines sit on white: start the ramp at its 300 step so the lowest level
  // is still a visible stroke.
  return sampleRamp(SEQUENTIAL_BLUE, 0.35 + 0.65 * (nLevels <= 1 ? 1 : k / (nLevels - 1)));
}

/**
 * The contour figure: frame with x/y ticks, holes shaded grey, optional bands,
 * the lines, and a colour bar to the right labelled with every level (thinned
 * to what fits). Equal x and y scales when the rectangle's aspect allows it.
 */
export function contourPlotSvg(fig: ContourFigure): string {
  const W = fig.width ?? 380;
  const g = fig.grid;
  const xlo = g.xs[0];
  const xhi = g.xs[g.xs.length - 1];
  const ylo = g.ys[0];
  const yhi = g.ys[g.ys.length - 1];
  const levels = fig.levels.slice(0, CONTOUR_LEVELS_MAX);
  const xAxis = plotAxisTicks(xlo, xhi, false, 6, undefined, undefined);
  const yAxis = plotAxisTicks(ylo, yhi, false, 5, undefined, undefined);
  const xlabel = xAxis.multiplier ? `${fig.xlabel || "x"} (${xAxis.multiplier})` : fig.xlabel || "x";
  const ylabel = yAxis.multiplier ? `${fig.ylabel || "y"} (${yAxis.multiplier})` : fig.ylabel || "y";
  // plotKinds refuses levels that cannot be labelled; a caller that did not is given exact 17-figure labels.
  const levelRow = levelLabels(levels) ?? { labels: levels.map((v) => fmtSig(v, 17)), multiplier: "", offset: "" };
  const levelText = levelRow.labels;
  const zTitle = (fig.zlabel || "z") + (levelRow.offset ? ` ${levelRow.offset}` : "") + (levelRow.multiplier ? ` (${levelRow.multiplier})` : "");

  // Colour bar gutter on the right: bar 12 px, ticks, labels.
  const widestLevel = Math.max(1, ...levelText.map((t) => t.length));
  const barGutter = Math.max(12 + 14 + 6 + widestLevel * 6 + 8, Math.ceil(zTitle.length * 6.2) + 12);
  const widestY = Math.max(1, ...yAxis.ticks.map((t) => t.text.length));
  const ml = Math.min(130, Math.max(48, Math.ceil(widestY * 6 + 7 + 23)));
  const widestX = Math.max(1, ...xAxis.ticks.map((t) => t.text.length));
  const mr = Math.max(14, Math.ceil((widestX * 6) / 2) + 2) + barGutter;
  const mt = fig.title ? 26 : 14;
  const mb = 42;
  const pw = Math.max(60, W - ml - mr);
  // Equal scales when that keeps the frame between 0.45 and 1.4 of its width.
  const ratio = (yhi - ylo) / (xhi - xlo);
  const equal = ratio >= 0.45 && ratio <= 1.4;
  const ph = Math.round(pw * (equal ? ratio : Math.min(1.4, Math.max(0.45, ratio))));
  const H = mt + ph + mb;
  const notes = [...(fig.notes ?? [])];
  if (!equal) notes.push("x and y are drawn to different scales (the rectangle is too long and thin for equal scales).");
  const noteLines = layoutNotes(notes, W);
  const outH = H + (noteLines.length ? noteLines.length * NOTE_LH + 4 : 0);

  const sx = (x: number): number => ml + ((x - xlo) / (xhi - xlo)) * pw;
  const sy = (y: number): number => mt + ph - ((y - ylo) / (yhi - ylo)) * ph;
  const parts: string[] = [`<rect width="${W}" height="${outH}" fill="#ffffff"/>`];
  const clipId = `contourclip${++contourSeq}`;
  parts.push(`<clipPath id="${clipId}"><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}"/></clipPath>`);
  parts.push(`<g clip-path="url(#${clipId})">`);

  // Holes: every cell with a non-finite corner, merged along rows.
  if (g.holes > 0 || g.jumps) {
    for (let j = 0; j < g.ys.length - 1; j++) {
      let start = -1;
      for (let i = 0; i <= g.xs.length - 1; i++) {
        const bad = i < g.xs.length - 1 && !cellOk(g, i, j);
        if (bad && start < 0) start = i;
        if (!bad && start >= 0) {
          const x = sx(g.xs[start]);
          const y = sy(g.ys[j + 1]);
          parts.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(sx(g.xs[i]) - x)}" height="${f1(sy(g.ys[j]) - y)}" fill="${HOLE_FILL}" stroke="${HOLE_FILL}" stroke-width="0.5"/>`);
          start = -1;
        }
      }
    }
  }
  const nBands = levels.length + 1;
  if (fig.filled) {
    // ONE PATH PER BAND (disjoint subpaths): a 60 × 60 field of fine bands is
    // thousands of pieces, and an element per piece was most of a megabyte.
    const byBand: string[][] = Array.from({ length: nBands }, () => []);
    for (const poly of fig.bands ?? isobands(g, levels) ?? []) {
      byBand[poly.band].push(poly.pts.map(([x, y], n) => `${n === 0 ? "M" : "L"}${f1(sx(x))},${f1(sy(y))}`).join("") + "Z");
    }
    byBand.forEach((d, b) => {
      if (!d.length) return;
      const col = bandColour(b, nBands);
      // Stroked in its own colour: adjacent pieces rasterised edge to edge
      // otherwise show hairline seams of the white page.
      parts.push(`<path d="${d.join("")}" fill="${col}" stroke="${col}" stroke-width="0.5" stroke-linejoin="round"/>`);
    });
  }
  const lines = fig.lines ?? marchingSquares(g, levels);
  lines.forEach((lvl, k) => {
    const col = fig.filled ? "#1a1a1a" : lineColour(k, levels.length);
    const d = lvl.paths
      .filter((p) => p.pts.length >= 2)
      .map((p) => p.pts.map(([x, y], n) => `${n === 0 ? "M" : "L"}${f1(sx(x))},${f1(sy(y))}`).join(" ") + (p.closed ? " Z" : ""))
      .join(" ");
    if (d) parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${fig.filled ? 0.8 : 1.3}" stroke-linejoin="round"/>`);
  });
  parts.push(`</g>`);
  parts.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="#888888" stroke-width="1"/>`);

  for (const t of xAxis.ticks) {
    const px = sx(t.v);
    parts.push(`<line x1="${f1(px)}" y1="${mt + ph}" x2="${f1(px)}" y2="${mt + ph + 4}" stroke="#888888"/>`);
    parts.push(`<text x="${f1(px)}" y="${mt + ph + 16}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="#333333">${escapeXml(t.text)}</text>`);
  }
  for (const t of yAxis.ticks) {
    const py = sy(t.v);
    parts.push(`<line x1="${ml - 4}" y1="${f1(py)}" x2="${ml}" y2="${f1(py)}" stroke="#888888"/>`);
    parts.push(`<text x="${ml - 7}" y="${f1(py + 3)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="#333333">${escapeXml(t.text)}</text>`);
  }
  parts.push(`<text x="${f1(ml + pw / 2)}" y="${H - 8}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#333333">${escapeXml(xlabel)}</text>`);
  const cy = mt + ph / 2;
  parts.push(`<text x="14" y="${f1(cy)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#333333" transform="rotate(-90 14 ${f1(cy)})">${escapeXml(ylabel)}</text>`);

  // The colour bar: one cell per band (filled) or one stroke per level (lines),
  // spaced evenly — a level key, not a linear z scale, so unevenly spaced user
  // levels stay readable.
  const bx = W - barGutter + 6;
  const barTop = mt + 14;
  const barH = Math.max(40, ph - 14);
  parts.push(`<text x="${bx}" y="${mt + 8}" font-family="${FONT}" font-size="10" fill="#333333">${escapeXml(zTitle)}</text>`);
  if (levels.length) {
    const yAt = (k: number): number => barTop + barH - (barH * (k + 1)) / (levels.length + 1);
    if (fig.filled) {
      for (let b = 0; b < nBands; b++) {
        const yTop = b === nBands - 1 ? barTop : yAt(b);
        const yBot = b === 0 ? barTop + barH : yAt(b - 1);
        parts.push(`<rect x="${bx}" y="${f1(yTop)}" width="12" height="${f1(yBot - yTop)}" fill="${bandColour(b, nBands)}"/>`);
      }
      parts.push(`<rect x="${bx}" y="${barTop}" width="12" height="${barH}" fill="none" stroke="#888888" stroke-width="0.8"/>`);
    }
    // Label every k-th level so labels stay ≥ 12 px apart.
    const step = Math.max(1, Math.ceil(12 / (barH / (levels.length + 1))));
    levels.forEach((_, k) => {
      const y = yAt(k);
      const col = fig.filled ? "#1a1a1a" : lineColour(k, levels.length);
      parts.push(`<line x1="${bx}" y1="${f1(y)}" x2="${bx + 12}" y2="${f1(y)}" stroke="${col}" stroke-width="${fig.filled ? 1 : 2}"/>`);
      if (k % step === 0) {
        parts.push(`<text x="${bx + 18}" y="${f1(y + 3.5)}" font-family="${FONT}" font-size="10" fill="#333333">${escapeXml(levelText[k])}</text>`);
      }
    });
  }
  if (fig.title) {
    parts.push(`<text data-figure-title="1" x="${f1(W / 2)}" y="16" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="bold" fill="#222222">${escapeXml(fig.title)}</text>`);
  }
  noteLines.forEach((line, i) => {
    parts.push(`<text x="8" y="${H + 11 + i * NOTE_LH}" font-family="${FONT}" font-size="${NOTE_SIZE}" fill="#555555">${escapeXml(line)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${outH}" viewBox="0 0 ${W} ${outH}">${parts.join("")}</svg>`;
}

let contourSeq = 0;
