/**
 * The hidden-line engine: a tessellated CAD model (cadModel.ts) seen from a
 * view becomes a line drawing — real edges and the outlines of curved
 * surfaces, with what is hidden removed (docs/SCOPE-CAD-CANVAS.md §C).
 *
 * Every drawing standard the canvas produces (USPTO 1.84, ISO/ASME engineering
 * views, journal figures) starts from this one engine; the standards differ in
 * line weights, labels and sheets, not in which lines are visible.
 *
 * The method, in three steps:
 *   1. FEATURE LINES. Every crease and boundary edge of the mesh, plus the
 *      outline (silhouette) of each smooth surface, found as the zero crossing
 *      of n·v across each triangle using the analytic corner normals — so a
 *      cylinder's outline is two clean lines, never its facets.
 *   2. SPLIT. A line can only change from visible to hidden where, on the
 *      screen, it crosses another feature line (an occluder's outline is made of
 *      feature lines). Every line is cut at those crossings.
 *   3. CLASSIFY. Each piece's midpoint is visible iff no triangle covers it
 *      nearer the eye. Endpoints are therefore exact vector points, not
 *      pixel-snapped, and the result is deterministic.
 *
 * Orthographic projection (every engineering and patent view is one).
 * Bounded by work: the caller's triangle cap (cadModel.tessellate) bounds every
 * loop here; nothing runs on a user number directly.
 */
import type { Mesh, Vec3 } from "./cadModel";
import { mul3, rotationMatrix } from "./cadModel";

// ---- views ---------------------------------------------------------------------------

/**
 * A view: a row-major rotation taking world coordinates to camera coordinates.
 * Camera x = right on the page, camera y = up on the page, camera z = toward
 * the eye (larger z is nearer).
 */
export interface CadView {
  name: string;
  rot: number[];
}

/** Rows of the camera frame in world coordinates: right, up, toward-eye. */
function frame(right: Vec3, up: Vec3, toEye: Vec3): number[] {
  return [...right, ...up, ...toEye];
}

/**
 * The standard views. World: X right, Y away from the front viewer, Z up.
 * Front looks along +Y (eye at −Y); top looks down −Z; right looks along −X.
 */
export const STANDARD_VIEWS: Record<"front" | "back" | "top" | "bottom" | "right" | "left" | "iso", CadView> = {
  front: { name: "front", rot: frame([1, 0, 0], [0, 0, 1], [0, -1, 0]) },
  back: { name: "back", rot: frame([-1, 0, 0], [0, 0, 1], [0, 1, 0]) },
  top: { name: "top", rot: frame([1, 0, 0], [0, 1, 0], [0, 0, 1]) },
  bottom: { name: "bottom", rot: frame([1, 0, 0], [0, -1, 0], [0, 0, -1]) },
  right: { name: "right", rot: frame([0, 1, 0], [0, 0, 1], [1, 0, 0]) },
  left: { name: "left", rot: frame([0, -1, 0], [0, 0, 1], [-1, 0, 0]) },
  iso: { name: "isometric", rot: isoFrame() },
};

/** True isometric: looking along (−1, +1, −1)·(-1) — from front-right-above toward the origin. */
function isoFrame(): number[] {
  const toEye: Vec3 = norm([1, -1, 1]);
  const right: Vec3 = norm([1, 1, 0]);
  const up: Vec3 = crossV(toEye, right);
  return frame(right, up, toEye);
}

/** A view from Euler degrees (the orbit's rotation applied to the front view). */
export function viewFromDegrees(deg: Vec3, name = "view"): CadView {
  return { name, rot: mul3(STANDARD_VIEWS.front.rot, rotationMatrix(deg)) };
}

// Function declarations (hoisted): STANDARD_VIEWS above is built at module load.
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function crossV(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---- the result ---------------------------------------------------------------------------

/** A polyline on the page, in camera units (x right, y UP). */
export type Polyline = Array<[number, number]>;

export interface LineDrawing {
  visible: Polyline[];
  hidden: Polyline[];
  /** Page bounds of everything (visible and hidden), camera units. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: { triangles: number; featureSegments: number; pieces: number };
}

// ---- the engine -----------------------------------------------------------------------------

interface Seg {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  /** Where the line came from: a mesh edge (its two vertices), a smooth triangle's outline, or two bodies crossing. */
  src: { edge: [number, number] } | { tri: number } | { cross: [number, number] };
  /** The body or bodies the line belongs to. */
  bodies: number[];
}

/**
 * Barycentric coordinates of screen point (x, y) in the triangle (x1,y1)(x2,y2)(x3,y3),
 * or null when the triangle is edge-on (`degen` = the determinant below which it counts
 * as edge-on). INCLUSIVE: a point on a side or corner is inside — one rule for the hidden-line
 * test, the piercing test and callout anchors (review D5).
 */
export function baryIn(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x: number, y: number, degen: number): [number, number, number] | null {
  const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  if (Math.abs(det) < degen) return null;
  const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det;
  const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det;
  const l3 = 1 - l1 - l2;
  const onEdge = -1e-9;
  if (l1 < onEdge || l2 < onEdge || l3 < onEdge) return null;
  return [l1, l2, l3];
}

/** Draws the mesh from the view. */
export function drawLines(mesh: Mesh, view: CadView): LineDrawing {
  const R = view.rot;
  const P = mesh.positions;
  const nv = P.length / 3;
  // Camera coordinates of every vertex.
  const cx = new Float64Array(nv), cy = new Float64Array(nv), cz = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    cx[i] = R[0] * x + R[1] * y + R[2] * z;
    cy[i] = R[3] * x + R[4] * y + R[5] * z;
    cz[i] = R[6] * x + R[7] * y + R[8] * z;
  }
  const toEye: Vec3 = [R[6], R[7], R[8]];
  const eps = mesh.diag * 1e-9;

  // 1. Feature segments: drawable edges + smooth-surface silhouettes.
  const segs: Seg[] = [];
  for (const e of mesh.edges) {
    segs.push({ ax: cx[e.a], ay: cy[e.a], az: cz[e.a], bx: cx[e.b], by: cy[e.b], bz: cz[e.b], src: { edge: [e.a, e.b] }, bodies: [e.body] });
  }
  // Where overlapping parts cross: a real line, found once per model by tessellate.
  for (const c of mesh.crossings) {
    const pr = (p: Vec3): [number, number, number] => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
    const [a, b] = [pr(c.a), pr(c.b)];
    segs.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], src: { cross: c.tris }, bodies: [mesh.triBody[c.tris[0]], mesh.triBody[c.tris[1]]] });
  }
  const T = mesh.triangles;
  const N = mesh.cornerNormals;
  const ntri = T.length / 3;
  for (let t = 0; t < ntri; t++) {
    // n·v at each corner (orthographic: v is the same everywhere).
    const g: number[] = [];
    for (let c = 0; c < 3; c++) {
      const o = 9 * t + 3 * c;
      // Symbolic perturbation: an EXACT zero (the outline passing through a
      // vertex, as a front view of a cylinder does at its seam) counts as a
      // tiny NEGATIVE, so the crossing falls consistently on the edges beside
      // that vertex instead of vanishing between two triangles. Negative, so
      // the outline is the edge of the strictly front-facing surface: a wall
      // seen exactly edge-on (a bullet's cylinder from above) puts its outline
      // where the nose begins, not against the hidden bottom (second review).
      const gi = N[o] * toEye[0] + N[o + 1] * toEye[1] + N[o + 2] * toEye[2];
      g.push(Math.abs(gi) < 1e-12 ? -1e-12 : gi);
    }
    // A planar face has identical corner normals: no crossing inside it.
    if ((g[0] > 0) === (g[1] > 0) && (g[1] > 0) === (g[2] > 0)) continue;
    if (Math.abs(g[0] - g[1]) < 1e-12 && Math.abs(g[1] - g[2]) < 1e-12) continue;
    const pts: Array<[number, number, number]> = [];
    for (let c = 0; c < 3; c++) {
      const i = T[3 * t + c], j = T[3 * t + ((c + 1) % 3)];
      const gi = g[c], gj = g[(c + 1) % 3];
      if ((gi > 0) === (gj > 0)) continue;
      const s = gi / (gi - gj);
      pts.push([cx[i] + s * (cx[j] - cx[i]), cy[i] + s * (cy[j] - cy[i]), cz[i] + s * (cz[j] - cz[i])]);
    }
    if (pts.length === 2) {
      const [a, b] = pts;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > eps) segs.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], src: { tri: t }, bodies: [mesh.triBody[t]] });
    }
  }

  // Page bounds and a uniform screen grid for segments and triangles.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < nv; i++) {
    if (cx[i] < minX) minX = cx[i];
    if (cx[i] > maxX) maxX = cx[i];
    if (cy[i] < minY) minY = cy[i];
    if (cy[i] > maxY) maxY = cy[i];
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cells = Math.max(8, Math.min(256, Math.ceil(Math.sqrt(ntri + segs.length) / 2)));
  const cell = span / cells + eps;
  const gx = (x: number): number => Math.max(0, Math.min(cells - 1, Math.floor((x - minX) / cell)));
  const gy = (y: number): number => Math.max(0, Math.min(cells - 1, Math.floor((y - minY) / cell)));
  const triGrid: number[][] = Array.from({ length: cells * cells }, () => []);
  for (let t = 0; t < ntri; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const x0 = gx(Math.min(cx[a], cx[b], cx[c])), x1 = gx(Math.max(cx[a], cx[b], cx[c]));
    const y0 = gy(Math.min(cy[a], cy[b], cy[c])), y1 = gy(Math.max(cy[a], cy[b], cy[c]));
    for (let u = x0; u <= x1; u++) for (let w = y0; w <= y1; w++) triGrid[w * cells + u].push(t);
  }
  const segGrid: number[][] = Array.from({ length: cells * cells }, () => []);
  segs.forEach((s, k) => {
    const x0 = gx(Math.min(s.ax, s.bx)), x1 = gx(Math.max(s.ax, s.bx));
    const y0 = gy(Math.min(s.ay, s.by)), y1 = gy(Math.max(s.ay, s.by));
    for (let u = x0; u <= x1; u++) for (let w = y0; w <= y1; w++) segGrid[w * cells + u].push(k);
  });

  // Which triangles touch each vertex (the mesh shares vertices along smooth walls).
  const vertTris: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < ntri; t++) for (let c = 0; c < 3; c++) vertTris[T[3 * t + c]].push(t);
  /**
   * Triangles a piece must not be tested against. For an OUTLINE of a smooth
   * surface: the source facet and two rings around it — an outline from
   * interpolated normals sits a fraction of a facet inside the faceted
   * surface's own edge, so its nearest neighbours would "hide" it. Farther
   * parts of the same surface still can (a groove hiding its own wall). For a
   * mesh EDGE: only triangles containing the WHOLE edge. A triangle that
   * merely touches one end can hide it — in an isometric box, a hidden edge
   * lies exactly along the top face's own diagonal — and the edge's faces are
   * at its depth anyway, which depthEps already ignores.
   */
  const exclusion = (src: Seg["src"]): Set<number> => {
    const out = new Set<number>();
    if ("cross" in src) return new Set(src.cross);
    if ("edge" in src) {
      const [a, b] = src.edge;
      for (const t of vertTris[a]) if (vertTris[b].includes(t)) out.add(t);
      return out;
    }
    let ring = new Set<number>([src.tri]);
    for (let k = 0; k < 2; k++) {
      const next = new Set<number>(ring);
      for (const t of ring) for (let c = 0; c < 3; c++) for (const u of vertTris[T[3 * t + c]]) next.add(u);
      ring = next;
    }
    return ring;
  };

  // Is the camera-space point (x, y, z) covered by a triangle nearer the eye?
  // Points ON a triangle's edge count as covered: in a true isometric view a
  // box's hidden edges project exactly onto its visible ones, and only the
  // depth test may tell them apart. A line's own faces are at the same depth
  // and fall under depthEps.
  const depthEps = mesh.diag * 1e-6;
  const degen = span * span * 1e-14;
  const covered = (x: number, y: number, z: number, skip: Set<number>): boolean => {
    const list = triGrid[gy(y) * cells + gx(x)];
    for (const t of list) {
      if (skip.has(t)) continue;
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const l = baryIn(cx[a], cy[a], cx[b], cy[b], cx[c], cy[c], x, y, degen);
      if (!l) continue; // outside, or edge-on in this view
      const zt = l[0] * cz[a] + l[1] * cz[b] + l[2] * cz[c];
      if (zt > z + depthEps) return true;
    }
    return false;
  };

  // Bodies each body overlaps: a line can only pass into solid where its body's surface crosses another's.
  const partners: number[][] = [];
  for (const [p, q] of mesh.overlaps) {
    (partners[p] ??= []).push(q);
    (partners[q] ??= []).push(p);
  }

  // 2 + 3. Split at crossings, classify each piece.
  const visible: Array<[number, number, number, number]> = [];
  const hidden: Array<[number, number, number, number]> = [];
  let pieces = 0;
  const seen = new Int32Array(segs.length).fill(-1);
  segs.forEach((s, k) => {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < eps * eps) return;
    const ts: number[] = [0, 1];
    const x0 = gx(Math.min(s.ax, s.bx)), x1 = gx(Math.max(s.ax, s.bx));
    const y0 = gy(Math.min(s.ay, s.by)), y1 = gy(Math.max(s.ay, s.by));
    for (let u = x0; u <= x1; u++)
      for (let w = y0; w <= y1; w++)
        for (const m of segGrid[w * cells + u]) {
          if (m === k || seen[m] === k) continue;
          seen[m] = k;
          const o = segs[m];
          const ex = o.bx - o.ax, ey = o.by - o.ay;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-18 * span * span) continue; // parallel: no crossing point
          const t = ((o.ax - s.ax) * ey - (o.ay - s.ay) * ex) / den;
          const v = ((o.ax - s.ax) * dy - (o.ay - s.ay) * dx) / den;
          if (t > 1e-9 && t < 1 - 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) ts.push(t);
        }
    // Visibility also changes where the line PIERCES a face of an overlapping body
    // (it goes into, or comes out of, the other part) — a point no screen crossing marks.
    const into = new Set<number>();
    for (const b of s.bodies) for (const q of partners[b] ?? []) if (!s.bodies.includes(q)) into.add(q);
    if (into.size) {
      const stamp = new Set<number>();
      for (let u = x0; u <= x1; u++)
        for (let w = y0; w <= y1; w++)
          for (const t of triGrid[w * cells + u]) {
            if (stamp.has(t) || !into.has(mesh.triBody[t])) continue;
            stamp.add(t);
            const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
            const det = (cy[b] - cy[c]) * (cx[a] - cx[c]) + (cx[c] - cx[b]) * (cy[a] - cy[c]);
            if (Math.abs(det) < degen) continue;
            // The face's depth is affine on the page, so (line depth − face depth) is linear along the line.
            const faceZ = (x: number, y: number): number => {
              const l1 = ((cy[b] - cy[c]) * (x - cx[c]) + (cx[c] - cx[b]) * (y - cy[c])) / det;
              const l2 = ((cy[c] - cy[a]) * (x - cx[c]) + (cx[a] - cx[c]) * (y - cy[c])) / det;
              return l1 * cz[a] + l2 * cz[b] + (1 - l1 - l2) * cz[c];
            };
            const f0 = s.az - faceZ(s.ax, s.ay), f1 = s.bz - faceZ(s.bx, s.by);
            if (f0 > 0 === f1 > 0 || Math.abs(f0 - f1) < depthEps * 1e-3) continue;
            const t0 = f0 / (f0 - f1);
            if (t0 <= 1e-9 || t0 >= 1 - 1e-9) continue;
            if (baryIn(cx[a], cy[a], cx[b], cy[b], cx[c], cy[c], s.ax + t0 * dx, s.ay + t0 * dy, degen)) ts.push(t0);
          }
    }
    ts.sort((a, b) => a - b);
    const skip = exclusion(s.src);
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i], t1 = ts[i + 1];
      if ((t1 - t0) * Math.sqrt(len2) < eps) continue;
      const tm = (t0 + t1) / 2;
      const mx = s.ax + tm * dx, my = s.ay + tm * dy, mz = s.az + tm * (s.bz - s.az);
      const seg: [number, number, number, number] = [s.ax + t0 * dx, s.ay + t0 * dy, s.ax + t1 * dx, s.ay + t1 * dy];
      pieces++;
      (covered(mx, my, mz, skip) ? hidden : visible).push(seg);
    }
  });

  // DRAFTING PRECEDENCE: where a hidden line coincides with a visible one on
  // the page (a box's back edges behind its front edges), the visible line is
  // drawn and the hidden one is not (ISO 128 / ASME Y14.2 line precedence).
  const visGrid: number[][] = Array.from({ length: cells * cells }, () => []);
  visible.forEach((p, k) => {
    const x0 = gx(Math.min(p[0], p[2])), x1 = gx(Math.max(p[0], p[2]));
    const y0 = gy(Math.min(p[1], p[3])), y1 = gy(Math.max(p[1], p[3]));
    for (let u = x0; u <= x1; u++) for (let w = y0; w <= y1; w++) visGrid[w * cells + u].push(k);
  });
  const onTol = span * 1e-7;
  const onVisible = (x: number, y: number): boolean => {
    for (const k of visGrid[gy(y) * cells + gx(x)]) {
      const [ax, ay, bx, by] = visible[k];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      const t = ((x - ax) * dx + (y - ay) * dy) / l2;
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      if (Math.abs((x - ax) * dy - (y - ay) * dx) / Math.sqrt(l2) <= onTol) return true;
    }
    return false;
  };
  const hiddenShown = hidden.filter((p) => !onVisible((p[0] + p[2]) / 2, (p[1] + p[3]) / 2));

  return {
    visible: chain(visible, span),
    hidden: chain(hiddenShown, span),
    bounds: { minX, minY, maxX, maxY },
    stats: { triangles: ntri, featureSegments: segs.length, pieces },
  };
}

// ---- chaining: pieces → polylines, collinear runs merged --------------------------------------

function chain(pieces: Array<[number, number, number, number]>, span: number): Polyline[] {
  const q = span * 1e-7;
  const key = (x: number, y: number): string => `${Math.round(x / q)},${Math.round(y / q)}`;
  // Drop exact duplicates (a crease shared by two bodies, a silhouette over a crease).
  const uniq = new Map<string, [number, number, number, number]>();
  for (const p of pieces) {
    const k1 = key(p[0], p[1]), k2 = key(p[2], p[3]);
    const k = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    if (!uniq.has(k)) uniq.set(k, p);
  }
  const list = [...uniq.values()];
  const at = new Map<string, number[]>();
  list.forEach((p, i) => {
    for (const k of [key(p[0], p[1]), key(p[2], p[3])]) {
      const a = at.get(k);
      if (a) a.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(list.length);
  const lines: Polyline[] = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Polyline = [
      [list[i][0], list[i][1]],
      [list[i][2], list[i][3]],
    ];
    // Extend at both ends. Through a plain joint (exactly one other piece) the
    // chain always continues; at a junction it continues only straight on, so
    // an edge cut where another line crosses it stays ONE line.
    for (const atEnd of [true, false]) {
      for (;;) {
        const tip = atEnd ? line[line.length - 1] : line[0];
        const prev = atEnd ? line[line.length - 2] : line[1];
        const here = at.get(key(tip[0], tip[1])) ?? [];
        const cand = here.filter((j) => !used[j]);
        if (!cand.length) break;
        const far = (j: number): [number, number] => {
          const p = list[j];
          return key(p[0], p[1]) === key(tip[0], tip[1]) ? [p[2], p[3]] : [p[0], p[1]];
        };
        let j = -1;
        if (here.length === 2 && cand.length === 1) j = cand[0];
        else {
          const dx = tip[0] - prev[0], dy = tip[1] - prev[1];
          const dl = Math.hypot(dx, dy) || 1;
          const straightOn = cand.filter((c) => {
            const f = far(c);
            const ex = f[0] - tip[0], ey = f[1] - tip[1];
            const el = Math.hypot(ex, ey) || 1;
            return Math.abs(dx * ey - dy * ex) / (dl * el) < 1e-6 && dx * ex + dy * ey > 0;
          });
          if (straightOn.length === 1) j = straightOn[0];
        }
        if (j < 0) break;
        used[j] = 1;
        const nextPt = far(j);
        if (atEnd) line.push(nextPt);
        else line.unshift(nextPt);
      }
    }
    lines.push(simplify(line, span * 1e-6));
  }
  return lines;
}

/** Removes interior points that lie on the line through their neighbours (within tol). */
function simplify(line: Polyline, tol: number): Polyline {
  if (line.length < 3) return line;
  const out: Polyline = [line[0]];
  for (let i = 1; i < line.length - 1; i++) {
    const a = out[out.length - 1], b = line[i], c = line[i + 1];
    const cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len > 0 && cr / len <= tol) continue;
    out.push(b);
  }
  out.push(line[line.length - 1]);
  return out;
}
