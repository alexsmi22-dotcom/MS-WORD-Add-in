/**
 * The CAD model: an assembly of solid bodies built from 2D profiles
 * (docs/SCOPE-CAD-CANVAS.md §B), and their tessellation for the
 * hidden-line engine (cadLines.ts).
 *
 * WHY PARAMETRIC AND NOT A MESH. A line drawing made from a faceted mesh fails
 * in two characteristic ways: outlines of curved surfaces come out jagged, and
 * the facet edges of a cylinder get drawn as if they were real edges. Here
 * every face is generated, so the tessellation KNOWS which edges are real
 * creases (drawn) and which only subdivide a smooth surface (never drawn), and
 * curved faces carry analytic normals so their outlines are computed from the
 * true surface, not guessed from facets.
 *
 * Coordinates: X to the right, Y away from the viewer of the front view, Z up.
 * Units are the user's (millimetres by convention); only ratios matter to the
 * drawing.
 */

// ---- the model -------------------------------------------------------------------

export type Pt2 = [number, number];

/** One piece of a closed loop, from the previous point to `to`. */
export type LoopSeg =
  | { kind: "line"; to: Pt2 }
  /** A circular arc to `to` about `center`, counter-clockwise unless `cw`. */
  | { kind: "arc"; to: Pt2; center: Pt2; cw?: boolean };

/** A closed loop: from `start` through each segment and back to `start` (the last `to` must equal `start`). */
export interface Loop {
  start: Pt2;
  segs: LoopSeg[];
}

/** An outer boundary and any number of holes inside it. */
export interface Profile {
  outer: Loop;
  holes: Loop[];
}

export type Vec3 = [number, number, number];

/** Where a body sits in the assembly: rotate (degrees, about X then Y then Z), then translate. */
export interface Placement {
  translate: Vec3;
  rotateDeg: Vec3;
}

export type BodySpec =
  /** The profile (in the XY plane) swept `depth` along +Z. */
  | { kind: "extrude"; profile: Profile; depth: number }
  /**
   * The profile, drawn in the (r, z) half-plane with r ≥ 0, turned a full
   * turn about the Z axis. One loop, no holes; a loop may touch the axis.
   */
  | { kind: "revolve"; profile: Profile };

export interface Body {
  id: string;
  name: string;
  spec: BodySpec;
  placement: Placement;
}

export interface Assembly {
  version: 1;
  bodies: Body[];
}

export const IDENTITY_PLACEMENT: Placement = { translate: [0, 0, 0], rotateDeg: [0, 0, 0] };

// ---- primitives (each is just a profile and a sweep) -----------------------------------

export function rectLoop(x0: number, y0: number, x1: number, y1: number): Loop {
  return { start: [x0, y0], segs: [{ kind: "line", to: [x1, y0] }, { kind: "line", to: [x1, y1] }, { kind: "line", to: [x0, y1] }, { kind: "line", to: [x0, y0] }] };
}

/** A full circle as two half arcs (counter-clockwise; `cw` for a hole's clockwise winding). */
export function circleLoop(cx: number, cy: number, r: number, cw = false): Loop {
  return {
    start: [cx + r, cy],
    segs: [
      { kind: "arc", to: [cx - r, cy], center: [cx, cy], cw },
      { kind: "arc", to: [cx + r, cy], center: [cx, cy], cw },
    ],
  };
}

export function box(w: number, d: number, h: number): BodySpec {
  return { kind: "extrude", profile: { outer: rectLoop(0, 0, w, d), holes: [] }, depth: h };
}

export function cylinder(r: number, h: number): BodySpec {
  return { kind: "extrude", profile: { outer: circleLoop(0, 0, r), holes: [] }, depth: h };
}

export function tube(rOuter: number, rInner: number, h: number): BodySpec {
  return { kind: "extrude", profile: { outer: circleLoop(0, 0, rOuter), holes: [circleLoop(0, 0, rInner, true)] }, depth: h };
}

/** A sphere: a half disc in the (r, z) plane, revolved. */
export function sphere(r: number): BodySpec {
  return {
    kind: "revolve",
    profile: {
      outer: { start: [0, -r], segs: [{ kind: "arc", to: [0, r], center: [0, 0] }, { kind: "line", to: [0, -r] }] },
      holes: [],
    },
  };
}

export function cone(rBase: number, h: number): BodySpec {
  return {
    kind: "revolve",
    profile: { outer: { start: [0, 0], segs: [{ kind: "line", to: [rBase, 0] }, { kind: "line", to: [0, h] }, { kind: "line", to: [0, 0] }] }, holes: [] },
  };
}

// ---- validation: refuse by name, never guess -----------------------------------------------

export type ModelProblem = { body: string; reason: string };

const close2 = (a: Pt2, b: Pt2, tol: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

/** Every reason the model cannot be drawn, by body name. Empty = drawable. */
export function modelProblems(a: Assembly): ModelProblem[] {
  const out: ModelProblem[] = [];
  if (a.version !== 1) out.push({ body: "(model)", reason: `model version ${String(a.version)} is not one this release can read` });
  if (!a.bodies.length) out.push({ body: "(model)", reason: "the drawing has no bodies" });
  for (const b of a.bodies) {
    const p = (reason: string): void => {
      out.push({ body: b.name || b.id, reason });
    };
    const loops = [b.spec.profile.outer, ...b.spec.profile.holes];
    const size = loopExtent(b.spec.profile.outer);
    if (!(size > 0) || !Number.isFinite(size)) {
      p("its outline has no size");
      continue;
    }
    for (const [li, loop] of loops.entries()) {
      const which = li === 0 ? "the outline" : `hole ${li}`;
      if (!loop.segs.length) p(`${which} has no segments`);
      const all = [loop.start, ...loop.segs.map((s) => s.to)];
      if (all.some((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) p(`${which} has a point that is not a number`);
      const last = loop.segs.length ? loop.segs[loop.segs.length - 1].to : loop.start;
      if (!close2(last, loop.start, size * 1e-9)) p(`${which} is not closed (it ends away from where it starts)`);
      let from = loop.start;
      for (const s of loop.segs) {
        if (s.kind === "arc") {
          const r0 = Math.hypot(from[0] - s.center[0], from[1] - s.center[1]);
          const r1 = Math.hypot(s.to[0] - s.center[0], s.to[1] - s.center[1]);
          if (!(r0 > 0) || Math.abs(r0 - r1) > Math.max(r0, r1) * 1e-6) p(`${which} has an arc whose ends are not on one circle`);
        } else if (close2(from, s.to, size * 1e-12)) p(`${which} has a zero-length line`);
        from = s.to;
      }
    }
    if (b.spec.kind === "extrude" && !(b.spec.depth > 0 && Number.isFinite(b.spec.depth))) p("its extrusion depth must be a positive number");
    if (b.spec.kind === "revolve") {
      if (b.spec.profile.holes.length) p("a revolved profile cannot have holes in this release (a hollow part is a profile that goes around the hollow)");
      const pts = flattenLoop(b.spec.profile.outer, size * 1e-3).points;
      if (pts.some((q) => q[0] < -size * 1e-9)) p("a revolved profile must stay on one side of the axis (r ≥ 0)");
    }
    const pl = b.placement;
    if ([...pl.translate, ...pl.rotateDeg].some((v) => !Number.isFinite(v))) p("its placement has a value that is not a number");
  }
  return out;
}

function loopExtent(loop: Loop): number {
  const pts = [loop.start, ...loop.segs.map((s) => s.to), ...loop.segs.flatMap((s) => (s.kind === "arc" ? [s.center] : []))];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

// ---- flattening: tolerance-driven -------------------------------------------------------

/**
 * A flattened loop: points, and for each point whether the loop is SMOOTH
 * there (inside an arc, or a tangent joint) or has a CORNER. `normals[i]` is
 * the outward-or-inward 2D normal the surface has at point i on the segment
 * that ends there and the one that starts there (they differ only at corners).
 */
export interface FlatLoop {
  points: Pt2[];
  /** corner[i]: the loop turns sharply at points[i] (a crease in the swept surface). */
  corner: boolean[];
  /** For the edge points[i] → points[i+1]: the unit normal at its start and at its end (analytic on arcs). */
  edgeNormals: Array<[Pt2, Pt2]>;
}

/** Segments for an arc so its chord sagitta stays within `tol`; at least 2 per quarter turn, at most 512 per turn. */
function arcSteps(r: number, sweep: number, tol: number): number {
  const maxStep = tol >= r ? Math.PI / 2 : 2 * Math.acos(1 - tol / r);
  const perTurnCap = 512;
  const n = Math.ceil(Math.abs(sweep) / Math.max(maxStep, (2 * Math.PI) / perTurnCap));
  return Math.max(n, Math.ceil(Math.abs(sweep) / (Math.PI / 4)));
}

/** Sweep of an arc from `from` to `to` about `c`, signed (CCW positive), in (0, 2π]. */
function arcSweep(from: Pt2, to: Pt2, c: Pt2, cw: boolean): number {
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
  const a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
  let d = a1 - a0;
  if (cw) {
    while (d >= 0) d -= 2 * Math.PI;
    while (d < -2 * Math.PI) d += 2 * Math.PI;
  } else {
    while (d <= 0) d += 2 * Math.PI;
    while (d > 2 * Math.PI) d -= 2 * Math.PI;
  }
  return d;
}

const unit2 = (v: Pt2): Pt2 => {
  const l = Math.hypot(v[0], v[1]);
  return l > 0 ? [v[0] / l, v[1] / l] : [0, 0];
};

/** Below this angle between neighbouring directions a joint counts as tangent (smooth). */
const TANGENT_COS = Math.cos((1 * Math.PI) / 180);

/**
 * Flattens a loop. Normals are the RIGHT-hand normal of the travel direction
 * (outward for a counter-clockwise outer loop, and also outward from the
 * material for a clockwise hole).
 */
export function flattenLoop(loop: Loop, tol: number): FlatLoop {
  const points: Pt2[] = [];
  const edgeNormals: Array<[Pt2, Pt2]> = [];
  // tangent direction arriving at / leaving each point, for corner detection
  const tanIn: Pt2[] = [];
  const tanOut: Pt2[] = [];
  const insideArc: boolean[] = [];
  let from = loop.start;
  for (const s of loop.segs) {
    if (s.kind === "line") {
      const d = unit2([s.to[0] - from[0], s.to[1] - from[1]]);
      const n: Pt2 = [d[1], -d[0]];
      points.push(from);
      tanOut.push(d);
      insideArc.push(false);
      edgeNormals.push([n, n]);
      tanIn.push(d); // arriving at the NEXT point; aligned below
    } else {
      const cw = !!s.cw;
      const r = Math.hypot(from[0] - s.center[0], from[1] - s.center[1]);
      const sweep = arcSweep(from, s.to, s.center, cw);
      const n = arcSteps(r, sweep, tol);
      const a0 = Math.atan2(from[1] - s.center[1], from[0] - s.center[0]);
      for (let k = 0; k < n; k++) {
        const t0 = a0 + (sweep * k) / n;
        const t1 = a0 + (sweep * (k + 1)) / n;
        const p0: Pt2 = k === 0 ? from : [s.center[0] + r * Math.cos(t0), s.center[1] + r * Math.sin(t0)];
        points.push(p0);
        // CCW arc: travel tangent (-sin, cos); right-hand normal = outward radial (cos, sin).
        // CW arc: travel tangent (sin, -cos); right-hand normal = inward radial (-cos, -sin).
        const sg = cw ? -1 : 1;
        const n0: Pt2 = [sg * Math.cos(t0), sg * Math.sin(t0)];
        const n1: Pt2 = [sg * Math.cos(t1), sg * Math.sin(t1)];
        edgeNormals.push([n0, n1]);
        // The normal is to the RIGHT of travel, so travel = the normal turned left: (-n.y, n.x).
        tanOut.push([-n0[1], n0[0]]);
        tanIn.push([-n1[1], n1[0]]);
        insideArc.push(k > 0);
      }
    }
    from = s.to;
  }
  // tanIn[i] currently describes the direction ARRIVING at point i+1; rotate so tanIn[i] arrives at point i.
  const arriving = tanIn.map((_, i) => tanIn[(i - 1 + tanIn.length) % tanIn.length]);
  const corner = points.map((_, i) => {
    if (insideArc[i]) return false;
    const a = arriving[i];
    const b = tanOut[i];
    return a[0] * b[0] + a[1] * b[1] < TANGENT_COS;
  });
  return { points, corner, edgeNormals };
}

/** Signed area (CCW positive) of a flattened loop. */
export function signedArea(pts: Pt2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// ---- the tessellated mesh ---------------------------------------------------------------

/**
 * A triangle mesh with PER-CORNER normals (a smooth surface's corners carry
 * its analytic normal; a planar face's corners all carry the face normal), and
 * an explicit list of the edges a drawing may contain. Edges that only
 * subdivide a smooth surface or a planar face are NOT in the list.
 */
export interface Mesh {
  positions: number[]; // xyz per vertex
  triangles: number[]; // 3 vertex indices per triangle
  cornerNormals: number[]; // xyz per triangle corner (9 per triangle)
  /** Which body each triangle belongs to. */
  triBody: number[];
  /** Drawable edges: vertex pairs, each a crease (between two faces) or a boundary. */
  edges: Array<{ a: number; b: number; body: number }>;
  /** Size of the model's bounding box diagonal. */
  diag: number;
}

export interface TessOptions {
  /** Chord tolerance as a fraction of the model's bounding-box diagonal. */
  relTol: number;
  /** Refuse above this many triangles (a work bound: never freeze Word). */
  maxTriangles: number;
}

export const DEFAULT_TESS: TessOptions = { relTol: 2e-4, maxTriangles: 200_000 };

export type TessResult = { ok: true; mesh: Mesh } | { ok: false; reason: string };

/** Row-major 3×3 rotation from degrees about X, then Y, then Z. */
export function rotationMatrix(deg: Vec3): number[] {
  const [ax, ay, az] = deg.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(rz, mul3(ry, rx));
}

export function mul3(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function apply3(m: number[], v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Rough size of the whole assembly, before tessellation, for the tolerance. */
function assemblyDiag(a: Assembly): number {
  let lo: Vec3 = [Infinity, Infinity, Infinity];
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of a.bodies) {
    const pts = flattenLoop(b.spec.profile.outer, loopExtent(b.spec.profile.outer) * 0.05).points;
    const R = rotationMatrix(b.placement.rotateDeg);
    const corners: Vec3[] = [];
    if (b.spec.kind === "extrude") {
      for (const p of pts) for (const z of [0, b.spec.depth]) corners.push([p[0], p[1], z]);
    } else {
      const rmax = Math.max(...pts.map((p) => p[0]));
      for (const p of pts) for (const s of [-1, 1]) for (const t of [-1, 1]) corners.push([s * rmax, t * rmax, p[1]]);
    }
    for (const c of corners) {
      const w = apply3(R, c);
      for (let k = 0; k < 3; k++) {
        const v = w[k] + b.placement.translate[k];
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
    }
  }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/** Tessellates every body of a validated assembly. */
export function tessellate(a: Assembly, opts: TessOptions = DEFAULT_TESS): TessResult {
  const problems = modelProblems(a);
  if (problems.length) return { ok: false, reason: problems.map((p) => `${p.body}: ${p.reason}`).join("; ") };
  const diag = assemblyDiag(a);
  const tol = diag * opts.relTol;
  const m: Mesh = { positions: [], triangles: [], cornerNormals: [], triBody: [], edges: [], diag };
  for (const [bi, b] of a.bodies.entries()) {
    const R = rotationMatrix(b.placement.rotateDeg);
    const T = b.placement.translate;
    const put = (p: Vec3): number => {
      const w = apply3(R, p);
      m.positions.push(w[0] + T[0], w[1] + T[1], w[2] + T[2]);
      return m.positions.length / 3 - 1;
    };
    const nrm = (n: Vec3): Vec3 => apply3(R, n);
    const tri = (i: number, j: number, k: number, ni: Vec3, nj: Vec3, nk: Vec3): void => {
      m.triangles.push(i, j, k);
      m.cornerNormals.push(...nrm(ni), ...nrm(nj), ...nrm(nk));
      m.triBody.push(bi);
    };
    const edge = (i: number, j: number): void => {
      m.edges.push({ a: i, b: j, body: bi });
    };
    const r = b.spec.kind === "extrude" ? tessExtrude(b.spec, tol, put, tri, edge) : tessRevolve(b.spec, tol, put, tri, edge);
    if (r) return { ok: false, reason: `${b.name || b.id}: ${r}` };
    if (m.triangles.length / 3 > opts.maxTriangles) {
      return {
        ok: false,
        reason: `the drawing needs more than ${opts.maxTriangles.toLocaleString("en-US")} triangles at this precision — simplify it (fewer or larger curved features)`,
      };
    }
  }
  return { ok: true, mesh: m };
}

type Put = (p: Vec3) => number;
type Tri = (i: number, j: number, k: number, ni: Vec3, nj: Vec3, nk: Vec3) => void;
type Edge = (i: number, j: number) => void;

function tessExtrude(spec: Extract<BodySpec, { kind: "extrude" }>, tol: number, put: Put, tri: Tri, edge: Edge): string | null {
  const outer = flattenLoop(spec.profile.outer, tol);
  if (signedArea(outer.points) < 0) return "the outline must run counter-clockwise";
  const holes = spec.profile.holes.map((h) => flattenLoop(h, tol));
  for (const [i, h] of holes.entries()) if (signedArea(h.points) > 0) return `hole ${i + 1} must run clockwise`;
  const z1 = spec.depth;
  const loops = [outer, ...holes];

  // Side walls: per flattened edge, a quad. Corner normals from the analytic edge normals.
  const bottomIdx: number[][] = [];
  const topIdx: number[][] = [];
  for (const L of loops) {
    const bi = L.points.map((p) => put([p[0], p[1], 0]));
    const ti = L.points.map((p) => put([p[0], p[1], z1]));
    bottomIdx.push(bi);
    topIdx.push(ti);
    const n = L.points.length;
    // Wall vertices are SHARED along the loop (normals live on triangle corners,
    // so a corner needs no duplicate), which gives the line engine the
    // adjacency it uses to keep a smooth wall from hiding its own outline.
    // They are separate from the cap vertices; positions coincide.
    const wb = L.points.map((p) => put([p[0], p[1], 0]));
    const wt = L.points.map((p) => put([p[0], p[1], z1]));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = wb[i];
      const a1 = wb[j];
      const b1 = wt[j];
      const b0 = wt[i];
      const [n0, n1] = L.edgeNormals[i];
      const N0: Vec3 = [n0[0], n0[1], 0];
      const N1: Vec3 = [n1[0], n1[1], 0];
      tri(a0, a1, b1, N0, N1, N1);
      tri(a0, b1, b0, N0, N1, N0);
      // Rim edges: wall meets cap — always a crease.
      edge(bi[i], bi[j]);
      edge(ti[i], ti[j]);
      // Vertical edge at point i: drawn only where the outline has a corner.
      if (L.corner[i]) edge(bi[i], ti[i]);
    }
  }

  // Caps: triangulate the profile with its holes (ear clipping with bridges).
  const tris = triangulateWithHoles(
    outer.points,
    holes.map((h) => h.points),
  );
  if (!tris) return "its outline could not be triangulated (does it cross itself, or a hole cross the outline?)";
  // tris index into the concatenated loop points [outer..., hole1..., ...]
  const flatB = bottomIdx.flat();
  const flatT = topIdx.flat();
  const down: Vec3 = [0, 0, -1];
  const up: Vec3 = [0, 0, 1];
  for (let t = 0; t < tris.length; t += 3) {
    const [i, j, k] = [tris[t], tris[t + 1], tris[t + 2]];
    tri(flatT[i], flatT[j], flatT[k], up, up, up);
    tri(flatB[i], flatB[k], flatB[j], down, down, down);
  }
  return null;
}

function tessRevolve(spec: Extract<BodySpec, { kind: "revolve" }>, tol: number, put: Put, tri: Tri, edge: Edge): string | null {
  const L = flattenLoop(spec.profile.outer, tol);
  if (signedArea(L.points) < 0) return "the profile must run counter-clockwise in the (r, z) plane";
  const rmax = Math.max(...L.points.map((p) => p[0]));
  const steps = Math.max(24, Math.min(512, arcSteps(rmax, 2 * Math.PI, tol)));
  const n = L.points.length;
  const onAxis = (p: Pt2): boolean => Math.abs(p[0]) <= rmax * 1e-9;
  // ring[i][j]: vertex of profile point i at angle step j (one vertex on the axis).
  const angle = (j: number): number => (2 * Math.PI * j) / steps;
  const ring: number[][] = L.points.map((p) => {
    if (onAxis(p)) {
      const v = put([0, 0, p[1]]);
      return new Array(steps).fill(v);
    }
    return Array.from({ length: steps }, (_, j) => put([p[0] * Math.cos(angle(j)), p[0] * Math.sin(angle(j)), p[1]]));
  });
  const n3 = (n2: Pt2, j: number): Vec3 => [n2[0] * Math.cos(angle(j)), n2[0] * Math.sin(angle(j)), n2[1]];
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const [nA, nB] = L.edgeNormals[i];
    const axisA = onAxis(L.points[i]);
    const axisB = onAxis(L.points[k]);
    if (axisA && axisB) continue; // a segment ON the axis sweeps nothing
    for (let j = 0; j < steps; j++) {
      const j1 = (j + 1) % steps;
      const a0 = ring[i][j], a1 = ring[i][j1], b0 = ring[k][j], b1 = ring[k][j1];
      // Profile runs CCW in (r,z): with outward normals the band's triangles wind outward.
      if (!axisA) tri(a0, a1, b1, n3(nA, j), n3(nA, j1), n3(nB, j1));
      if (!axisB) tri(a0, b1, b0, n3(nA, j), n3(nB, j1), n3(nB, j));
    }
  }
  // Parallels: the circle swept by a profile CORNER is a crease. Meridians are smooth.
  for (let i = 0; i < n; i++) {
    if (!L.corner[i] || onAxis(L.points[i])) continue;
    for (let j = 0; j < steps; j++) edge(ring[i][j], ring[i][(j + 1) % steps]);
  }
  return null;
}

// ---- triangulation: ear clipping with hole bridges ------------------------------------------

function cross2(o: Pt2, a: Pt2, b: Pt2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segsIntersect(p1: Pt2, p2: Pt2, q1: Pt2, q2: Pt2): boolean {
  const d1 = cross2(q1, q2, p1), d2 = cross2(q1, q2, p2), d3 = cross2(p1, p2, q1), d4 = cross2(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Triangles (indices into [outer, ...holes] concatenated) covering the outer
 * polygon minus the holes. Outer CCW, holes CW. Null when it cannot be done
 * (self-intersection), which the caller refuses by name. O(n²): bounded by the
 * triangle cap, which the flattening tolerance keeps small for real profiles.
 */
export function triangulateWithHoles(outer: Pt2[], holes: Pt2[][]): number[] | null {
  const pts: Pt2[] = [...outer, ...holes.flat()];
  const offsets: number[] = [];
  let off = outer.length;
  for (const h of holes) {
    offsets.push(off);
    off += h.length;
  }
  // The working polygon: a list of point indices.
  let poly: number[] = outer.map((_, i) => i);
  // Bridge holes, rightmost first.
  const order = holes.map((h, i) => ({ i, x: Math.max(...h.map((p) => p[0])) })).sort((a, b) => b.x - a.x);
  for (const { i } of order) {
    const h = holes[i];
    const base = offsets[i];
    let mi = 0;
    for (let k = 1; k < h.length; k++) if (h[k][0] > h[mi][0]) mi = k;
    const M = h[mi];
    // The closest polygon vertex whose bridge from M crosses no edge.
    let best = -1;
    let bestD = Infinity;
    const holeIdx = h.map((_, k) => base + k);
    const allEdges: Array<[Pt2, Pt2]> = [];
    for (let k = 0; k < poly.length; k++) allEdges.push([pts[poly[k]], pts[poly[(k + 1) % poly.length]]]);
    for (const hh of holes) for (let k = 0; k < hh.length; k++) allEdges.push([hh[k], hh[(k + 1) % hh.length]]);
    for (let k = 0; k < poly.length; k++) {
      const P = pts[poly[k]];
      const d = (P[0] - M[0]) ** 2 + (P[1] - M[1]) ** 2;
      if (d >= bestD) continue;
      if (allEdges.some(([u, v]) => segsIntersect(M, P, u, v))) continue;
      best = k;
      bestD = d;
    }
    if (best < 0) return null;
    // Splice: ... P, M, (hole from M around back to M), M', P', ...
    const holeRing = [...holeIdx.slice(mi), ...holeIdx.slice(0, mi)];
    const P = poly[best];
    poly = [...poly.slice(0, best + 1), ...holeRing, holeRing[0], P, ...poly.slice(best + 1)];
  }
  // Ear clipping.
  const out: number[] = [];
  const isConvex = (a: number, b: number, c: number): boolean => cross2(pts[a], pts[b], pts[c]) > 0;
  const inTri = (p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean =>
    cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  let guard = 0;
  const limit = poly.length * poly.length * 4 + 100;
  while (poly.length > 3) {
    if (++guard > limit) return null;
    let clipped = false;
    for (let k = 0; k < poly.length; k++) {
      const ia = poly[(k - 1 + poly.length) % poly.length], ib = poly[k], ic = poly[(k + 1) % poly.length];
      if (!isConvex(ia, ib, ic)) continue;
      const A = pts[ia], B = pts[ib], C = pts[ic];
      let empty = true;
      for (const q of poly) {
        if (q === ia || q === ib || q === ic) continue;
        const Q = pts[q];
        // Bridge duplicates share coordinates with a corner: not "inside".
        if ((Q[0] === A[0] && Q[1] === A[1]) || (Q[0] === B[0] && Q[1] === B[1]) || (Q[0] === C[0] && Q[1] === C[1])) continue;
        if (inTri(Q, A, B, C)) {
          empty = false;
          break;
        }
      }
      if (!empty) continue;
      out.push(ia, ib, ic);
      poly.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Collinear runs leave zero-area "ears": drop a vertex that lies on its neighbours' line.
      const k = poly.findIndex((_, k2) => Math.abs(cross2(pts[poly[(k2 - 1 + poly.length) % poly.length]], pts[poly[k2]], pts[poly[(k2 + 1) % poly.length]])) < 1e-18);
      if (k < 0) return null;
      poly.splice(k, 1);
    }
  }
  if (poly.length === 3 && cross2(pts[poly[0]], pts[poly[1]], pts[poly[2]]) > 0) out.push(poly[0], poly[1], poly[2]);
  return out;
}
