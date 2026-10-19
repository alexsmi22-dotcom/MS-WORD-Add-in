/**
 * Section views (docs/SCOPE-CAD-VIEWS.md §B): the model cut by a plane, the part between the viewer and the plane
 * taken away, the cut faces capped and hatched — 37 CFR 1.84(h)(3): "Hatching must be used to indicate section
 * portions of an object … regularly spaced oblique parallel lines … preferably 45°. … The hatching of juxtaposed
 * different elements must be angled in a different way."
 *
 * Pure: a mesh, a plane and a view in; the cut mesh (with its caps, so they hide what lies behind them in the
 * hidden-line pass) and each body's cut regions in the section view's plane out. Every loop spends the sheet's work
 * budget, never a clock of its own.
 */
import type { Mesh, Pt2, Vec3 } from "./cadModel";
import { triangulateWithHoles } from "./cadModel";
import type { CadView, LineBudget, Polyline } from "./cadLines";
import { spendBudget } from "./cadLines";

/** A cutting plane: a point on it and the direction of sight (unit), which points from the viewer through the plane. */
export interface SectionPlane {
  point: Vec3;
  sight: Vec3;
}

/** One body's cut face in the section view's plane: an outline and its holes. */
export interface CutRegion {
  body: number;
  outer: Pt2[];
  holes: Pt2[][];
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** A camera-frame vector in world coordinates (the view's rotation is world → camera, rows right / up / toward-eye). */
const toWorld = (rot: number[], v: Vec3): Vec3 => [
  rot[0] * v[0] + rot[3] * v[1] + rot[6] * v[2],
  rot[1] * v[0] + rot[4] * v[1] + rot[7] * v[2],
  rot[2] * v[0] + rot[5] * v[1] + rot[8] * v[2],
];

/**
 * The plane through the line a → b drawn on a view (the view's own plane, model units), perpendicular to that view.
 * The direction of sight is to the right of a → b (the arrows of the cutting line point that way); `flip` reverses
 * it. Null when a and b are the same point.
 */
export function sectionPlane(parent: CadView, a: Pt2, b: Pt2, flip = false): SectionPlane | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  const s = flip ? -1 : 1;
  return { point: toWorld(parent.rot, [a[0], a[1], 0]), sight: unit(toWorld(parent.rot, [(s * dy) / len, (-s * dx) / len, 0])) };
}

/**
 * The section view: looking along the direction of sight. Its "up" is the parent view's up wherever the cut lets
 * it be (a vertical cut across a front view reads like a side view, the part standing as it stands); a cut that
 * looks straight up or down takes the parent's line of sight as up (a horizontal cut across a front view reads
 * like the top view).
 */
export function sectionView(parent: CadView, plane: SectionPlane, name: string): CadView {
  const toEye: Vec3 = [-plane.sight[0], -plane.sight[1], -plane.sight[2]];
  const flat = (v: Vec3): Vec3 => {
    const along = dot(v, toEye);
    return [v[0] - along * toEye[0], v[1] - along * toEye[1], v[2] - along * toEye[2]];
  };
  // The part stands as it stands: world up (+Z) when at least half of it survives the sight; else the parent's up;
  // else (the sight runs along both) the parent's line of sight. Front and side cuts read as before; a cut across a
  // top view no longer comes out upside down or on its side (review).
  const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
  let up = flat([0, 0, 1]);
  if (len(up) < 0.5) up = flat([parent.rot[3], parent.rot[4], parent.rot[5]]);
  if (len(up) < 0.5) up = flat([-parent.rot[6], -parent.rot[7], -parent.rot[8]]);
  up = unit(up);
  const right = cross(up, toEye);
  return { name, rot: [...right, ...up, ...toEye] };
}

/** Points that are the same within a tolerance, found through a grid of cells `q` wide (each point checked against its neighbours). */
class PointIndex {
  private cells = new Map<string, number[]>();
  readonly pts: Vec3[] = [];
  constructor(private q: number) {}
  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }
  id(p: Vec3): number {
    const cx = Math.round(p[0] / this.q), cy = Math.round(p[1] / this.q), cz = Math.round(p[2] / this.q);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          for (const id of this.cells.get(this.key(cx + i, cy + j, cz + k)) ?? []) {
            const o = this.pts[id];
            if (Math.abs(o[0] - p[0]) <= this.q && Math.abs(o[1] - p[1]) <= this.q && Math.abs(o[2] - p[2]) <= this.q) return id;
          }
        }
    const id = this.pts.length;
    this.pts.push(p);
    const k = this.key(cx, cy, cz);
    const cell = this.cells.get(k);
    if (cell) cell.push(id);
    else this.cells.set(k, [id]);
    return id;
  }
}

/**
 * Joins a cut's loose ends that lie within `tol` of each other (a cone's apex is a ring of microscopic radius, open
 * at the tip: the cut through it ran off one side and on at the other). Only ends of degree 1, nearest first.
 */
function joinLooseEnds(adj: Map<number, number[]>, pts: Vec3[], tol: number): void {
  const loose = [...adj.entries()].filter(([, nb]) => nb.length === 1).map(([id]) => id);
  if (loose.length < 2 || loose.length > 64) return;
  const dist = (a: number, b: number): number => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1], pts[a][2] - pts[b][2]);
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < loose.length; i++) for (let j = i + 1; j < loose.length; j++) {
    const g = dist(loose[i], loose[j]);
    if (g <= tol) pairs.push([g, loose[i], loose[j]]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const used = new Set<number>();
  for (const [, a, b] of pairs) {
    if (used.has(a) || used.has(b) || adj.get(a)!.includes(b)) continue;
    used.add(a);
    used.add(b);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
}

/** Signed area of a polygon (counter-clockwise positive). */
function area2(pts: Pt2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return a / 2;
}

function inside(p: Pt2, poly: Pt2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export type SectionResult = { ok: true; mesh: Mesh; regions: CutRegion[] } | { ok: false; reason: string };

/**
 * The mesh with everything on the viewer's side of the plane taken away, and the cut faces capped. A body whose cut
 * does not close (an open surface: an STL with gaps) has no cut face to hatch and is refused by name.
 */
export function cutMesh(mesh: Mesh, plane: SectionPlane, view: CadView, budget?: LineBudget): SectionResult {
  const P = mesh.positions, T = mesh.triangles, N = mesh.cornerNormals;
  const nv = P.length / 3, nt = T.length / 3;
  const tol = 1e-9 * Math.max(mesh.diag, 1e-300);
  const spend = (n: number): void => {
    if (budget) spendBudget(budget, n);
  };
  // Signed distance along the sight: kept where ≥ 0 (beyond the plane); within tol of it counts as ON it, kept.
  const d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const v = dot([P[3 * i] - plane.point[0], P[3 * i + 1] - plane.point[1], P[3 * i + 2] - plane.point[2]], plane.sight);
    d[i] = Math.abs(v) < tol ? 0 : v;
  }
  spend(nv);
  const kept = (i: number): boolean => d[i] >= 0;

  const pos: number[] = [];
  const remap = new Int32Array(nv).fill(-1);
  const keepVertex = (i: number): number => {
    if (remap[i] < 0) {
      remap[i] = pos.length / 3;
      pos.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    }
    return remap[i];
  };
  /** Where edge i–j crosses the plane: one vertex for every triangle and edge that shares the edge. */
  const crossAt = new Map<number, number>();
  const crossPoint = (i: number, j: number): { id: number; p: Vec3; t: number; lo: number; hi: number } => {
    const lo = Math.min(i, j), hi = Math.max(i, j);
    // A kept end ON the plane is where the edge crosses it: that vertex, not a new one at the same place.
    for (const [e, t] of [[lo, 0], [hi, 1]] as const) {
      if (d[e] === 0) return { id: keepVertex(e), p: [P[3 * e], P[3 * e + 1], P[3 * e + 2]], t, lo, hi };
    }
    const t = d[lo] / (d[lo] - d[hi]);
    const p: Vec3 = [P[3 * lo] + t * (P[3 * hi] - P[3 * lo]), P[3 * lo + 1] + t * (P[3 * hi + 1] - P[3 * lo + 1]), P[3 * lo + 2] + t * (P[3 * hi + 2] - P[3 * lo + 2])];
    const key = lo * nv + hi;
    let id = crossAt.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      pos.push(p[0], p[1], p[2]);
      crossAt.set(key, id);
    }
    return { id, p, t, lo, hi };
  };

  const tris: number[] = [];
  const normals: number[] = [];
  const triBody: number[] = [];
  const triFrom = new Int32Array(nt).fill(-1);
  /** Each body's cut segments (world), keyed so a segment found twice (a ridge touching the plane) cancels. */
  const segs = new Map<number, Map<string, [Vec3, Vec3]>>();
  const index = new PointIndex(Math.max(1e-7 * mesh.diag, tol * 10));
  const addSeg = (body: number, a: Vec3, b: Vec3): void => {
    const ia = index.id(a), ib = index.id(b);
    if (ia === ib) return;
    const key = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
    let m = segs.get(body);
    if (!m) segs.set(body, (m = new Map()));
    if (m.has(key)) m.delete(key);
    else m.set(key, [a, b]);
  };

  for (let t = 0; t < nt; t++) {
    const v = [T[3 * t], T[3 * t + 1], T[3 * t + 2]];
    const k = v.map(kept);
    if (!k[0] && !k[1] && !k[2]) continue;
    const corner = (c: number): Vec3 => [N[9 * t + 3 * c], N[9 * t + 3 * c + 1], N[9 * t + 3 * c + 2]];
    if (k[0] && k[1] && k[2]) {
      triFrom[t] = tris.length / 3;
      tris.push(keepVertex(v[0]), keepVertex(v[1]), keepVertex(v[2]));
      for (let c = 0; c < 3; c++) normals.push(...corner(c));
      triBody.push(mesh.triBody[t]);
      continue;
    }
    // Sutherland–Hodgman on the one plane, in the triangle's own order (its winding kept).
    const poly: Array<{ id: number; n: Vec3 }> = [];
    const cut: Vec3[] = [];
    for (let c = 0; c < 3; c++) {
      const c2 = (c + 1) % 3;
      if (k[c]) poly.push({ id: keepVertex(v[c]), n: corner(c) });
      if (k[c] !== k[c2]) {
        const x = crossPoint(v[c], v[c2]);
        // The normal along the edge, from the end the point was worked out from.
        const nLo = x.lo === v[c] ? corner(c) : corner(c2), nHi = x.lo === v[c] ? corner(c2) : corner(c);
        const n = unit([nLo[0] + x.t * (nHi[0] - nLo[0]), nLo[1] + x.t * (nHi[1] - nLo[1]), nLo[2] + x.t * (nHi[2] - nLo[2])]);
        poly.push({ id: x.id, n });
        cut.push(x.p);
      }
    }
    if (cut.length === 2) addSeg(mesh.triBody[t], cut[0], cut[1]);
    for (let i = 1; i + 1 < poly.length; i++) {
      const a = poly[0], b = poly[i], c = poly[i + 1];
      if (a.id === b.id || b.id === c.id || a.id === c.id) continue;
      if (triFrom[t] < 0) triFrom[t] = tris.length / 3;
      tris.push(a.id, b.id, c.id);
      normals.push(...a.n, ...b.n, ...c.n);
      triBody.push(mesh.triBody[t]);
    }
  }
  spend(nt);

  const edges: Mesh["edges"] = [];
  for (const e of mesh.edges) {
    const ka = kept(e.a), kb = kept(e.b);
    if (ka && kb) edges.push({ ...e, a: keepVertex(e.a), b: keepVertex(e.b) });
    else if (ka || kb) {
      const x = crossPoint(e.a, e.b);
      const end = keepVertex(ka ? e.a : e.b);
      if (x.id !== end) edges.push({ ...e, a: end, b: x.id });
    }
  }
  spend(mesh.edges.length);

  // The cut, body by body: closed loops, or the body is refused.
  const R = view.rot;
  const to2 = (p: Vec3): Pt2 => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2]];
  const regions: CutRegion[] = [];
  const capNormal: Vec3 = [-plane.sight[0], -plane.sight[1], -plane.sight[2]];
  // Which bodies reach strictly beyond the plane: only those are cut (a plane lying on a face with the part on the
  // viewer's side takes the whole part away — it has no cut face to hatch: review).
  const beyond = new Set<number>();
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) if (d[T[3 * t + c]] > 0) beyond.add(mesh.triBody[t]);
  for (const body of [...segs.keys()].sort((a, b) => a - b)) {
    const m = segs.get(body)!;
    if (!m.size || !beyond.has(body)) continue;
    const adj = new Map<number, number[]>();
    for (const key of m.keys()) {
      const [a, b] = key.split("|").map(Number);
      (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
    }
    spend(m.size);
    joinLooseEnds(adj, index.pts, Math.max(mesh.bodySag[body] ?? 0, (mesh.bodyNoise?.[body] ?? 0) * 4, 1e-6 * mesh.diag));
    for (const nb of adj.values()) {
      if (nb.length !== 2) {
        const imported = (mesh.bodyNoise?.[body] ?? 0) > 0;
        return { ok: false, reason: `part ${body + 1} is not a closed solid where the plane cuts it, so it has no cut face to hatch — cut where the part is closed${imported ? ", or repair the file" : ""}` };
      }
    }
    // Walk the loops.
    const seen = new Set<number>();
    const loops3: Vec3[][] = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop: Vec3[] = [];
      let prev = -1, cur = start;
      while (!seen.has(cur)) {
        seen.add(cur);
        loop.push(index.pts[cur]);
        const [n1, n2] = adj.get(cur)!;
        const next = n1 !== prev ? n1 : n2;
        prev = cur;
        cur = next;
      }
      if (loop.length >= 3) loops3.push(loop);
    }
    spend(seen.size);
    const loops2 = loops3.map((l) => l.map(to2));
    // Outlines and holes: a loop inside an even number of others is an outline; inside an odd number, a hole of
    // the smallest outline holding it.
    const probe = (l: Pt2[]): Pt2 => [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2];
    const depth = loops2.map((l, i) => loops2.filter((o, j) => j !== i && inside(probe(l), o)).length);
    spend(loops2.length * loops2.length);
    const outers = loops2.map((l, i) => i).filter((i) => depth[i] % 2 === 0);
    for (const oi of outers) {
      const holes = loops2
        .map((l, i) => i)
        .filter((i) => depth[i] === depth[oi] + 1 && inside(probe(loops2[i]), loops2[oi]));
      const outer2 = area2(loops2[oi]) < 0 ? [...loops2[oi]].reverse() : loops2[oi];
      const outer3 = area2(loops2[oi]) < 0 ? [...loops3[oi]].reverse() : loops3[oi];
      const holes2 = holes.map((h) => (area2(loops2[h]) > 0 ? [...loops2[h]].reverse() : loops2[h]));
      const holes3 = holes.map((h) => (area2(loops2[h]) > 0 ? [...loops3[h]].reverse() : loops3[h]));
      const idx = triangulateWithHoles(outer2, holes2);
      spend((outer2.length + holes2.reduce((s, h) => s + h.length, 0)) ** 2);
      if (!idx) return { ok: false, reason: `the cut face of part ${body + 1} crosses itself, so it cannot be hatched — move the cutting line a little` };
      const all3 = [...outer3, ...holes3.flat()];
      const base = pos.length / 3;
      for (const p of all3) pos.push(p[0], p[1], p[2]);
      for (let i = 0; i < idx.length; i += 3) {
        tris.push(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
        for (let c = 0; c < 3; c++) normals.push(...capNormal);
        triBody.push(body);
      }
      // The cut face's outline is a drawn edge (it meets the part's surface at a crease).
      let off = base;
      for (const ring of [outer3, ...holes3]) {
        for (let i = 0; i < ring.length; i++) edges.push({ a: off + i, b: off + ((i + 1) % ring.length), body, sag: 0 });
        off += ring.length;
      }
      regions.push({ body, outer: outer2, holes: holes2 });
    }
  }

  // Where parts cross each other: the part of each crossing beyond the plane.
  const crossings: Mesh["crossings"] = [];
  for (const c of mesh.crossings) {
    const da = dot([c.a[0] - plane.point[0], c.a[1] - plane.point[1], c.a[2] - plane.point[2]], plane.sight);
    const db = dot([c.b[0] - plane.point[0], c.b[1] - plane.point[1], c.b[2] - plane.point[2]], plane.sight);
    const t0 = triFrom[c.tris[0]], t1 = triFrom[c.tris[1]];
    if (t0 < 0 || t1 < 0 || (da < -tol && db < -tol)) continue;
    if (da >= -tol && db >= -tol) crossings.push({ a: c.a, b: c.b, tris: [t0, t1] });
    else {
      const t = da / (da - db);
      const x: Vec3 = [c.a[0] + t * (c.b[0] - c.a[0]), c.a[1] + t * (c.b[1] - c.a[1]), c.a[2] + t * (c.b[2] - c.a[2])];
      crossings.push(da >= -tol ? { a: c.a, b: x, tris: [t0, t1] } : { a: x, b: c.b, tris: [t0, t1] });
    }
  }

  return {
    ok: true,
    mesh: { ...mesh, positions: pos, triangles: tris, cornerNormals: normals, triBody, edges, crossings },
    regions,
  };
}

/** The hatch styles, in the order juxtaposed parts take them (angle in degrees, spacing factor). */
export const HATCH_STYLES: ReadonlyArray<{ deg: number; k: number }> = [
  { deg: 45, k: 1 },
  { deg: 135, k: 1 },
  { deg: 30, k: 1 },
  { deg: 150, k: 1 },
  { deg: 45, k: 0.55 },
  { deg: 135, k: 0.55 },
];
/** At most this many hatch lines across one part's cut (a work bound; a part this wide gets wider spacing). */
const MAX_LINES_PER_BODY = 400;

/**
 * The hatching of the cut regions: one style per body ("the various parts of a cross section of the same item
 * should be hatched in the same manner"), juxtaposed bodies given different styles (greedy, over bodies whose cuts'
 * boxes touch), lines on a grid fixed to the view so a body cut into pieces is hatched as one. Spacing from the total
 * cut area ("chosen on the basis of the total area to be hatched"), but never closer than `minSpacing` (model units)
 * for any style — the sheet passes what still reads on paper ("spaced sufficiently apart to enable the lines to be
 * distinguished without difficulty"); the base spacing is raised, so the styles keep their ratios and stay distinct.
 */
/** The narrowest style's spacing factor. */
export const HATCH_K_MIN = Math.min(...HATCH_STYLES.map((s) => s.k));

/** The base hatch spacing hatchRegions uses for these regions and floor (0 when there is no area). */
export function hatchSpacing(regions: CutRegion[], minSpacing = 0): number {
  let total = 0;
  for (const r of regions) total += Math.abs(area2(r.outer)) - r.holes.reduce((s, h) => s + Math.abs(area2(h)), 0);
  const fromArea = Math.sqrt(Math.max(total, 0)) / 14;
  if (!(fromArea > 0)) return 0;
  return minSpacing > 0 && Number.isFinite(minSpacing) ? Math.max(fromArea, minSpacing / HATCH_K_MIN) : fromArea;
}

export function hatchRegions(regions: CutRegion[], budget?: LineBudget, minSpacing = 0): { lines: Polyline[]; styleOf: Map<number, number>; spacing: number } {
  const lines: Polyline[] = [];
  const styleOf = new Map<number, number>();
  if (!regions.length) return { lines, styleOf, spacing: 0 };
  const spend = (n: number): void => {
    if (budget) spendBudget(budget, n);
  };
  const ringsOf = (r: CutRegion): Pt2[][] => [r.outer, ...r.holes];
  const spacing = hatchSpacing(regions, minSpacing);
  if (!(spacing > 0)) return { lines, styleOf, spacing: 0 };
  // Boxes per body, and which bodies touch.
  const bodies = [...new Set(regions.map((r) => r.body))].sort((a, b) => a - b);
  const box = new Map<number, [number, number, number, number]>();
  for (const r of regions) {
    const b = box.get(r.body) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of r.outer) (b[0] = Math.min(b[0], x)), (b[1] = Math.min(b[1], y)), (b[2] = Math.max(b[2], x)), (b[3] = Math.max(b[3], y));
    box.set(r.body, b);
  }
  const eps = hatchSpacing(regions) * 1e-3;
  const touch = (a: number, b: number): boolean => {
    const p = box.get(a)!, q = box.get(b)!;
    return p[0] <= q[2] + eps && q[0] <= p[2] + eps && p[1] <= q[3] + eps && q[1] <= p[3] + eps;
  };
  for (const b of bodies) {
    const taken = new Set(bodies.filter((o) => styleOf.has(o) && touch(b, o)).map((o) => styleOf.get(o)!));
    let s = 0;
    while (taken.has(s) && s < HATCH_STYLES.length - 1) s++;
    styleOf.set(b, s);
  }
  for (const b of bodies) {
    const style = HATCH_STYLES[styleOf.get(b)!];
    const th = (style.deg * Math.PI) / 180;
    const u: Pt2 = [Math.cos(th), Math.sin(th)], n: Pt2 = [-Math.sin(th), Math.cos(th)];
    const rings = regions.filter((r) => r.body === b).flatMap(ringsOf);
    let cmin = Infinity, cmax = -Infinity;
    for (const ring of rings) for (const p of ring) {
      const c = p[0] * n[0] + p[1] * n[1];
      cmin = Math.min(cmin, c);
      cmax = Math.max(cmax, c);
    }
    let h = spacing * style.k;
    if ((cmax - cmin) / h > MAX_LINES_PER_BODY) h = (cmax - cmin) / MAX_LINES_PER_BODY;
    const segCount = rings.reduce((s, r) => s + r.length, 0);
    for (let c = Math.ceil(cmin / h) * h; c < cmax; c += h) {
      const hits: number[] = [];
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ca = ring[j][0] * n[0] + ring[j][1] * n[1], cb = ring[i][0] * n[0] + ring[i][1] * n[1];
          // Half-open, so a line through a corner counts it once.
          if ((ca <= c && c < cb) || (cb <= c && c < ca)) {
            const t = (c - ca) / (cb - ca);
            const x = ring[j][0] + t * (ring[i][0] - ring[j][0]), y = ring[j][1] + t * (ring[i][1] - ring[j][1]);
            hits.push(x * u[0] + y * u[1]);
          }
        }
      }
      spend(segCount);
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        if (hits[i + 1] - hits[i] <= 0) continue;
        lines.push([
          [c * n[0] + hits[i] * u[0], c * n[1] + hits[i] * u[1]],
          [c * n[0] + hits[i + 1] * u[0], c * n[1] + hits[i + 1] * u[1]],
        ]);
      }
    }
  }
  return { lines, styleOf, spacing };
}
