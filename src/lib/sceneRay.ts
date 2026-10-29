// Scene modelling & pipeline: rays and bounding volumes. Ray–sphere (the quadratic, with the origin-inside and
// tangent cases named), ray–box (Kay–Kajiya slabs, a ray parallel to a slab pair named), ray–triangle (Möller–Trumbore,
// with barycentrics, the parallel and coplanar cases and back faces named), the bounding-volume comparison for a point
// set (axis-aligned box against two spheres: the box-centred one and Ritter's), and the surface-area-heuristic cost of
// one BVH split with the best split found by a sweep. Pure functions; glue in sceneCalcs.ts.

import type { Vec } from "./sceneCurves";

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec): number => Math.sqrt(dot(a, a));

export interface RayHit {
  /** "hit", "miss", or why there is no single answer. */
  outcome: "hit" | "miss";
  /** The case, in words (tangent, inside, parallel, behind, back face, edge …). */
  note: string;
  /** Distances along the unit direction (t ≥ 0 is in front of the origin). */
  tNear: number | null;
  tFar: number | null;
  point: Vec | null;
  normal: Vec | null;
  /** Triangle barycentrics (w0, w1, w2) at the hit, w0 the weight of v0. */
  bary: Vec | null;
  /** Closest approach of the ray's line to the primitive's centre (sphere) when it misses. */
  missBy: number | null;
}

const miss = (note: string, missBy: number | null = null): RayHit => ({ outcome: "miss", note, tNear: null, tFar: null, point: null, normal: null, bary: null, missBy });

/** Normalise a direction; null for the zero vector. */
export function unitDir(d: Vec): Vec | null {
  const l = len(d);
  return l > 0 && Number.isFinite(l) ? mul(d, 1 / l) : null;
}

/** Ray–sphere. `d` must be a unit vector. Tangent when the discriminant is within rounding of zero. */
export function raySphere(o: Vec, d: Vec, c: Vec, r: number): RayHit {
  const oc = sub(o, c);
  const b = dot(d, oc);
  const cc = dot(oc, oc) - r * r;
  const scale = Math.max(dot(oc, oc), r * r);
  const disc = b * b - cc;
  const tol = 1e-12 * scale;
  if (disc < -tol) {
    const closest = Math.sqrt(Math.max(0, dot(oc, oc) - b * b));
    return miss("outside", closest - r);
  }
  const s = disc <= tol ? 0 : Math.sqrt(disc);
  const t1 = -b - s;
  const t2 = -b + s;
  if (cc < -tol) {
    const p = add(o, mul(d, t2));
    return { outcome: "hit", note: "inside", tNear: null, tFar: t2, point: p, normal: mul(sub(p, c), 1 / r), bary: null, missBy: null };
  }
  if (t2 < 0) return miss("behind");
  if (s === 0) {
    const p = add(o, mul(d, t1));
    return { outcome: "hit", note: "tangent", tNear: t1, tFar: t1, point: p, normal: mul(sub(p, c), 1 / r), bary: null, missBy: null };
  }
  const tn = t1 >= 0 ? t1 : t2;
  const p = add(o, mul(d, tn));
  return { outcome: "hit", note: Math.abs(cc) <= tol ? "on the surface" : "through", tNear: t1, tFar: t2, point: p, normal: mul(sub(p, c), 1 / r), bary: null, missBy: null };
}

/** Ray–box by slabs. `d` must be a unit vector. */
export function rayBox(o: Vec, d: Vec, lo: Vec, hi: Vec): RayHit & { entryAxis: number | null; parallelAxes: number[] } {
  let tmin = -Infinity;
  let tmax = Infinity;
  let entryAxis: number | null = null;
  let exitAxis: number | null = null;
  const parallelAxes: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) {
      parallelAxes.push(i);
      if (o[i] < lo[i] || o[i] > hi[i]) return { ...miss(`parallel-${i}`), entryAxis: null, parallelAxes };
      continue;
    }
    let t1 = (lo[i] - o[i]) / d[i];
    let t2 = (hi[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      entryAxis = i;
    }
    if (t2 < tmax) {
      tmax = t2;
      exitAxis = i;
    }
  }
  if (tmin > tmax) return { ...miss("outside"), entryAxis: null, parallelAxes };
  if (tmax < 0) return { ...miss("behind"), entryAxis: null, parallelAxes };
  const inside = tmin < 0;
  const t = inside ? tmax : tmin;
  const p = add(o, mul(d, t));
  const ax = inside ? exitAxis : entryAxis;
  const normal: Vec = [0, 0, 0];
  if (ax !== null) normal[ax] = inside ? Math.sign(d[ax]) : -Math.sign(d[ax]);
  const span = Math.max(...hi.map((h, i) => h - lo[i]), 1e-300);
  // Grazing: entry and exit coincide (an edge or corner touched), or the ray runs IN a face's plane (parallel to a
  // slab pair and exactly on one of its planes), sliding along the surface.
  const onFace = parallelAxes.some((i) => Math.abs(o[i] - lo[i]) <= 1e-12 * span || Math.abs(o[i] - hi[i]) <= 1e-12 * span);
  const note = inside && !onFace ? "inside" : Math.abs(tmax - tmin) <= 1e-12 * span || onFace ? "grazing" : "through";
  return { outcome: "hit", note, tNear: inside ? null : tmin, tFar: tmax, point: p, normal, bary: null, missBy: null, entryAxis: inside ? null : entryAxis, parallelAxes };
}

/** Ray–triangle by Möller–Trumbore. `d` must be a unit vector. */
export function rayTriangle(o: Vec, d: Vec, v0: Vec, v1: Vec, v2: Vec): RayHit & { det: number; backFace: boolean; planeDistance: number | null } {
  const e1 = sub(v1, v0);
  const e2 = sub(v2, v0);
  const n = cross(e1, e2);
  const nl = len(n);
  if (!(nl > 0)) return { ...miss("degenerate"), det: 0, backFace: false, planeDistance: null };
  const pvec = cross(d, e2);
  const det = dot(e1, pvec);
  const tvec = sub(o, v0);
  const planeDistance = dot(tvec, n) / nl;
  if (Math.abs(det) <= 1e-12 * len(e1) * len(e2)) {
    const ext = Math.max(len(e1), len(e2));
    return { ...miss(Math.abs(planeDistance) <= 1e-12 * ext ? "coplanar" : "parallel"), det, backFace: false, planeDistance };
  }
  const inv = 1 / det;
  const u = dot(tvec, pvec) * inv;
  const qvec = cross(tvec, e1);
  const v = dot(d, qvec) * inv;
  const t = dot(e2, qvec) * inv;
  const w = 1 - u - v;
  const eps = 1e-12;
  if (u < -eps || v < -eps || w < -eps) return { ...miss("outside"), det, backFace: det < 0, planeDistance, bary: [w, u, v] };
  if (t < 0) return { ...miss("behind"), det, backFace: det < 0, planeDistance, bary: [w, u, v] };
  const onEdge = Math.min(u, v, w) <= eps;
  const p = add(o, mul(d, t));
  const nn = mul(n, 1 / nl);
  return { outcome: "hit", note: onEdge ? "edge" : "through", tNear: t, tFar: t, point: p, normal: nn, bary: [w, u, v], missBy: null, det, backFace: det < 0, planeDistance };
}

// ---------------------------------------------------------------------------------------------------------------
// Bounding volumes and the SAH
// ---------------------------------------------------------------------------------------------------------------

export interface BoundingComparison {
  bmin: Vec;
  bmax: Vec;
  boxVolume: number;
  boxArea: number;
  /** Sphere centred on the box centre, radius to the farthest point. */
  centred: { c: Vec; r: number };
  /** Ritter's (1990) two-pass sphere: an approximation, typically within a few per cent of the minimum. */
  ritter: { c: Vec; r: number };
}

/** The box and two bounding spheres of a point set. */
export function boundingVolumes(P: Vec[]): BoundingComparison {
  const bmin = [0, 1, 2].map((j) => Math.min(...P.map((p) => p[j])));
  const bmax = [0, 1, 2].map((j) => Math.max(...P.map((p) => p[j])));
  const e = sub(bmax, bmin);
  const c0 = mul(add(bmin, bmax), 0.5);
  const r0 = Math.max(...P.map((p) => len(sub(p, c0))));
  // Ritter: start from the farthest pair found by two sweeps, then grow to cover every point.
  const far = (from: Vec): Vec => P.reduce((best, p) => (len(sub(p, from)) > len(sub(best, from)) ? p : best), P[0]);
  const a = far(P[0]);
  const b = far(a);
  let c = mul(add(a, b), 0.5);
  let r = len(sub(b, a)) / 2;
  for (const p of P) {
    const dist = len(sub(p, c));
    if (dist > r) {
      const nr = (r + dist) / 2;
      c = add(c, mul(sub(p, c), (nr - r) / dist));
      r = nr;
    }
  }
  return { bmin, bmax, boxVolume: e[0] * e[1] * e[2], boxArea: 2 * (e[0] * e[1] + e[1] * e[2] + e[2] * e[0]), centred: { c: c0, r: r0 }, ritter: { c, r } };
}

const boxArea = (lo: Vec, hi: Vec): number => {
  const e = sub(hi, lo);
  return 2 * (e[0] * e[1] + e[1] * e[2] + e[2] * e[0]);
};

export interface SahSplit {
  axis: number;
  position: number;
  left: number;
  right: number;
  areaParent: number;
  areaLeft: number;
  areaRight: number;
  cost: number;
}

/**
 * The SAH cost of splitting a node of point primitives at `position` on `axis` (a primitive goes left when its
 * coordinate is below the plane): C = C_trav + (A_L/A)·N_L·C_isect + (A_R/A)·N_R·C_isect, child boxes the tight
 * boxes of their points. Null when one side is empty.
 */
export function sahCost(P: Vec[], axis: number, position: number, cTrav: number, cIsect: number): SahSplit | null {
  const L = P.filter((p) => p[axis] < position);
  const R = P.filter((p) => p[axis] >= position);
  if (!L.length || !R.length) return null;
  const box = (Q: Vec[]): [Vec, Vec] => [[0, 1, 2].map((j) => Math.min(...Q.map((p) => p[j]))), [0, 1, 2].map((j) => Math.max(...Q.map((p) => p[j])))];
  const [lo, hi] = box(P);
  const [llo, lhi] = box(L);
  const [rlo, rhi] = box(R);
  const A = boxArea(lo, hi);
  const AL = boxArea(llo, lhi);
  const AR = boxArea(rlo, rhi);
  const cost = cTrav + (AL / A) * L.length * cIsect + (AR / A) * R.length * cIsect;
  return { axis, position, left: L.length, right: R.length, areaParent: A, areaLeft: AL, areaRight: AR, cost };
}

/** The cheapest split over every axis, at every midpoint between consecutive distinct coordinates (a full sweep). */
export function bestSahSplit(P: Vec[], cTrav: number, cIsect: number): SahSplit | null {
  let best: SahSplit | null = null;
  for (let axis = 0; axis < 3; axis++) {
    const xs = [...new Set(P.map((p) => p[axis]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i++) {
      const s = sahCost(P, axis, (xs[i] + xs[i + 1]) / 2, cTrav, cIsect);
      if (s && (!best || s.cost < best.cost - 1e-12)) best = s;
    }
  }
  return best;
}

