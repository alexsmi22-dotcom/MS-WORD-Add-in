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
  /**
   * The shape's own orientation (row-major 3×3 rotation), applied BEFORE the
   * placement: an L-bracket is sketched as its section and swept, and its
   * frame turns the sweep to run along X so it stands the way it is drawn.
   */
  frame?: number[];
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
  /** The largest chord error (sagitta) any arc was flattened to; 0 for straight lines only. */
  sag: number;
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
export function flattenLoop(loop: Loop, tol: number, arcRel = Infinity): FlatLoop {
  const points: Pt2[] = [];
  let sag = 0;
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
      // An arc is never coarser than `arcRel` of its OWN radius: two circles of nearly
      // the same size (a pin in its hole) get the same facets, which nest instead of
      // crossing, and a small part beside a large one keeps its shape.
      const tolArc = Math.min(tol, r * arcRel);
      sag = Math.max(sag, Math.min(tolArc, r));
      const n = arcSteps(r, sweep, tolArc);
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
  return { points, corner, edgeNormals, sag };
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
  /**
   * Where one body's surface crosses another's (world coordinates), each piece
   * from the two triangles that cross. Parts that overlap are drawn as separate
   * parts that interfere — not merged — so this curve is a real line of the
   * drawing, and every line of one part inside the other is hidden.
   */
  crossings: Array<{ a: Vec3; b: Vec3; tris: [number, number] }>;
  /** Pairs of bodies (indices) whose surfaces cross. */
  overlaps: Array<[number, number]>;
  /** Per body: the largest chord error its curved surfaces were flattened to (0 = all flat). */
  bodySag: number[];
}

export interface TessOptions {
  /** Chord tolerance as a fraction of the model's bounding-box diagonal. */
  relTol: number;
  /** Refuse above this many triangles (a work bound: never freeze Word). */
  maxTriangles: number;
  /** Refuse when finding where overlapping parts cross needs more triangle-pair tests than this. */
  maxPairTests?: number;
}

export const DEFAULT_TESS: TessOptions = { relTol: 2e-4, maxTriangles: 200_000 };

/**
 * Arcs are flattened to at most relTol × this of their own radius (0.5 % at the
 * default) as well as to relTol of the model: see flattenLoop's arcRel.
 */
export const ARC_REL_PER_RELTOL = 25;

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
    const R = b.frame ? mul3(rotationMatrix(b.placement.rotateDeg), b.frame) : rotationMatrix(b.placement.rotateDeg);
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
  const m: Mesh = { positions: [], triangles: [], cornerNormals: [], triBody: [], edges: [], diag, crossings: [], overlaps: [], bodySag: [] };
  for (const [bi, b] of a.bodies.entries()) {
    const R = b.frame ? mul3(rotationMatrix(b.placement.rotateDeg), b.frame) : rotationMatrix(b.placement.rotateDeg);
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
    const ft: Fineness = { tol, rel: opts.relTol * ARC_REL_PER_RELTOL, sag: 0 };
    const r = b.spec.kind === "extrude" ? tessExtrude(b.spec, ft, put, tri, edge) : tessRevolve(b.spec, ft, put, tri, edge);
    m.bodySag.push(ft.sag);
    if (r) return { ok: false, reason: `${b.name || b.id}: ${r}` };
    if (m.triangles.length / 3 > opts.maxTriangles) {
      return {
        ok: false,
        reason: `the drawing needs more than ${opts.maxTriangles.toLocaleString("en-US")} triangles at this precision — simplify it (fewer or larger curved features)`,
      };
    }
  }
  const bad = findCrossings(m, a.bodies.length, opts.maxPairTests ?? 4_000_000);
  if (bad) {
    const nm = (i: number): string => a.bodies[i].name || a.bodies[i].id;
    return {
      ok: false,
      reason: `${nm(bad[0])} and ${nm(bad[1])} overlap over too much curved surface to work out where they cross — move them apart, or overlap them less`,
    };
  }
  return { ok: true, mesh: m };
}

// ---- where overlapping bodies cross ----------------------------------------------------------

/**
 * Fills m.crossings / m.overlaps. Only bodies whose boxes overlap are compared,
 * through a 3D grid; the triangle-pair tests are counted against a bound, and
 * the pair that runs over is returned (the caller refuses by name — a drawing
 * with its intersection lines silently missing would be a plausible wrong one).
 * Coplanar contact draws nothing; a crossing that runs along an edge already
 * drawn (a block standing on a plate) is not drawn twice.
 */
function findCrossings(m: Mesh, nBodies: number, maxTests: number): [number, number] | null {
  if (nBodies < 2) return null;
  const P = m.positions, T = m.triangles;
  const ntri = T.length / 3;
  const tol = m.diag * 1e-9;
  const V = (i: number): Vec3 => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  // Triangle boxes, body boxes.
  const tlo = new Float64Array(3 * ntri), thi = new Float64Array(3 * ntri);
  const blo = Array.from({ length: nBodies }, () => [Infinity, Infinity, Infinity]);
  const bhi = Array.from({ length: nBodies }, () => [-Infinity, -Infinity, -Infinity]);
  const byBody: number[][] = Array.from({ length: nBodies }, () => []);
  for (let t = 0; t < ntri; t++) {
    const b = m.triBody[t];
    byBody[b].push(t);
    for (let k = 0; k < 3; k++) {
      let lo = Infinity, hi = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = P[3 * T[3 * t + c] + k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      tlo[3 * t + k] = lo;
      thi[3 * t + k] = hi;
      if (lo < blo[b][k]) blo[b][k] = lo;
      if (hi > bhi[b][k]) bhi[b][k] = hi;
    }
  }
  // Drawable edges by exact endpoint coordinates (a wall shares its rim's computed positions).
  const ck = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;
  // Each drawn edge by its endpoints, to find the drawn edges at a triangle's corners.
  const drawnAt = new Map<string, Array<[Vec3, Vec3]>>();
  for (const e of m.edges) {
    const pa = V(e.a), pb = V(e.b);
    const ka = ck(pa), kb = ck(pb);
    for (const k of [ka, kb]) {
      const list = drawnAt.get(k);
      if (list) list.push([pa, pb]);
      else drawnAt.set(k, [[pa, pb]]);
    }
  }
  // Triangles by side (exact endpoint coordinates): walls and caps keep separate
  // vertices with the same positions, so adjacency across a rim is positional.
  // Built only once some pair of bodies actually meets.
  let edgeTrisMap: Map<string, number[]> | null = null;
  const edgeTrisOf = (key: string): number[] => {
    if (!edgeTrisMap) {
      edgeTrisMap = new Map();
      for (let t = 0; t < ntri; t++) {
        for (let c = 0; c < 3; c++) {
          const ka = ck(V(T[3 * t + c])), kb = ck(V(T[3 * t + ((c + 1) % 3)]));
          const k2 = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          const list = edgeTrisMap.get(k2);
          if (list) list.push(t);
          else edgeTrisMap.set(k2, [t]);
        }
      }
    }
    return edgeTrisMap.get(key) ?? [];
  };
  const seen = new Set<string>();
  let tests = 0;
  for (let A = 0; A < nBodies; A++) {
    for (let B = A + 1; B < nBodies; B++) {
      const lo = [0, 1, 2].map((k) => Math.max(blo[A][k], blo[B][k]) - tol);
      const hi = [0, 1, 2].map((k) => Math.min(bhi[A][k], bhi[B][k]) + tol);
      if (lo.some((v, k) => v > hi[k])) continue;
      const inBox = (t: number): boolean => [0, 1, 2].every((k) => tlo[3 * t + k] <= hi[k] && thi[3 * t + k] >= lo[k]);
      const ta = byBody[A].filter(inBox), tb = byBody[B].filter(inBox);
      if (!ta.length || !tb.length) continue;
      // 3D grid over the overlap box holding B's triangles.
      const res = Math.max(1, Math.min(48, Math.round(Math.cbrt(tb.length))));
      const size = [0, 1, 2].map((k) => (hi[k] - lo[k]) / res || 1);
      const cell = (v: number, k: number): number => Math.max(0, Math.min(res - 1, Math.floor((v - lo[k]) / size[k])));
      const grid: number[][] = Array.from({ length: res * res * res }, () => []);
      for (const t of tb) {
        const [x0, y0, z0] = [0, 1, 2].map((k) => cell(tlo[3 * t + k], k));
        const [x1, y1, z1] = [0, 1, 2].map((k) => cell(thi[3 * t + k], k));
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) grid[(x * res + y) * res + z].push(t);
      }
      const stamp = new Int32Array(ntri).fill(-1);
      let crossed = false;
      /**
       * Does triangle `k` (corners `tri`) pass through the plane of `other`? Yes when
       * it has corners strictly on both sides. When it only touches the plane with
       * one side, yes only if the face continues across that side onto the other
       * side of the plane (a crossing that runs along a facet edge); otherwise the
       * surface merely meets the plane there.
       */
      // Within the two parts' faceting error a surface has not passed through anything: a
      // pin in its bore, a stepped shaft in a hole of its small diameter, a pin turned in
      // its bore — their facet corners poke through the coincident wall by up to that error
      // whatever the facet counts (third review). A real penetration goes far beyond it.
      const thr = tol + (m.bodySag[A] ?? 0) + (m.bodySag[B] ?? 0);
      const passesThrough = (k: number, tri: Vec3[], other: Vec3[]): boolean => {
        const nn = cross3(sub3(other[1], other[0]), sub3(other[2], other[0]));
        const ln = Math.hypot(...nn);
        if (!(ln > 0)) return false;
        const u: Vec3 = [nn[0] / ln, nn[1] / ln, nn[2] / ln];
        const d0 = dot3(u, other[0]);
        const sd = tri.map((p) => dot3(u, p) - d0);
        if (sd.some((v) => v > thr) && sd.some((v) => v < -thr)) return true;
        const on = [0, 1, 2].filter((i) => Math.abs(sd[i]) <= thr);
        if (on.length !== 2) return false;
        const off = 3 - on[0] - on[1];
        const side = Math.sign(sd[off]);
        const ka = ck(tri[on[0]]), kb = ck(tri[on[1]]);
        for (const q of edgeTrisOf(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`)) {
          if (q === k || m.triBody[q] !== m.triBody[k]) continue;
          for (let c = 0; c < 3; c++) {
            const v = V(T[3 * q + c]);
            const kv = ck(v);
            if (kv === ka || kv === kb) continue;
            const sv = dot3(u, v) - d0;
            if (Math.abs(sv) > thr && Math.sign(sv) === -side) return true;
          }
        }
        return false;
      };
      for (const s of ta) {
        const [x0, y0, z0] = [0, 1, 2].map((k) => cell(tlo[3 * s + k], k));
        const [x1, y1, z1] = [0, 1, 2].map((k) => cell(thi[3 * s + k], k));
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            for (let z = z0; z <= z1; z++)
              for (const t of grid[(x * res + y) * res + z]) {
                if (stamp[t] === s) continue;
                stamp[t] = s;
                if ([0, 1, 2].some((k) => tlo[3 * s + k] > thi[3 * t + k] + tol || thi[3 * s + k] < tlo[3 * t + k] - tol)) continue;
                if (++tests > maxTests) return [A, B];
                const sa = [V(T[3 * s]), V(T[3 * s + 1]), V(T[3 * s + 2])];
                const sb = [V(T[3 * t]), V(T[3 * t + 1]), V(T[3 * t + 2])];
                const seg = triTriSegment(sa, sb, tol);
                if (!seg) continue;
                // Surfaces that only TOUCH (a pin exactly in its bore, a roller on a
                // plate, a cone's tip) meet along a line without passing through each
                // other: not a crossing, not an overlap.
                if (!passesThrough(s, sa, sb) || !passesThrough(t, sb, sa)) continue;
                if (alongDrawnEdge(seg, sa, drawnAt, ck, tol, thr) || alongDrawnEdge(seg, sb, drawnAt, ck, tol, thr)) continue;
                crossed = true; // a real crossing, not contact along an edge already drawn
                const q = (p: Vec3): string => p.map((v) => Math.round(v / (tol * 1000))).join(",");
                const ka = q(seg[0]), kb = q(seg[1]);
                const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
                if (seen.has(key)) continue;
                seen.add(key);
                m.crossings.push({ a: seg[0], b: seg[1], tris: [s, t] });
              }
      }
      if (crossed) m.overlaps.push([A, B]);
    }
  }
  return null;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Where triangle a crosses the plane (n, d): 0–2 points (a vertex on the plane counts once). */
function planeCut(a: Vec3[], n: Vec3, d: number, tol: number): Vec3[] {
  const s = a.map((p) => dot3(n, p) - d);
  const out: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (Math.abs(s[i]) <= tol) out.push(a[i]);
    else if (Math.abs(s[j]) > tol && s[i] > 0 !== s[j] > 0) {
      const f = s[i] / (s[i] - s[j]);
      out.push([a[i][0] + f * (a[j][0] - a[i][0]), a[i][1] + f * (a[j][1] - a[i][1]), a[i][2] + f * (a[j][2] - a[i][2])]);
    }
  }
  return out;
}

/** The segment where two triangles cross, or null (apart, touching at a point, or coplanar). */
export function triTriSegment(a: Vec3[], b: Vec3[], tol: number): [Vec3, Vec3] | null {
  const na = cross3(sub3(a[1], a[0]), sub3(a[2], a[0]));
  const nb = cross3(sub3(b[1], b[0]), sub3(b[2], b[0]));
  const la = Math.hypot(...na), lb = Math.hypot(...nb);
  if (la < tol * tol || lb < tol * tol) return null;
  const ua: Vec3 = [na[0] / la, na[1] / la, na[2] / la], ub: Vec3 = [nb[0] / lb, nb[1] / lb, nb[2] / lb];
  const D = cross3(ua, ub);
  if (Math.hypot(...D) < 1e-9) return null; // parallel or coplanar: no crossing line
  const ca = planeCut(a, ub, dot3(ub, b[0]), tol);
  const cb = planeCut(b, ua, dot3(ua, a[0]), tol);
  if (ca.length < 2 || cb.length < 2) return null;
  const pa = [ca[0], ca[ca.length - 1]], pb = [cb[0], cb[cb.length - 1]];
  const sA = pa.map((p) => dot3(p, D)), sB = pb.map((p) => dot3(p, D));
  const lo = Math.max(Math.min(...sA), Math.min(...sB));
  const hiS = Math.min(Math.max(...sA), Math.max(...sB));
  if (hiS - lo <= tol) return null;
  const at = (s: number): Vec3 => {
    const [p, q, s0, s1] = Math.abs(sA[1] - sA[0]) > tol ? [pa[0], pa[1], sA[0], sA[1]] : [pb[0], pb[1], sB[0], sB[1]];
    const f = (s - s0) / (s1 - s0);
    return [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1]), p[2] + f * (q[2] - p[2])];
  };
  return [at(lo), at(hiS)];
}

/**
 * Does the segment lie along drawn edges at triangle tri's corners — every point of it
 * within `near` (the two parts' faceting error) of one of them? Such a crossing is
 * contact, and the edge is drawn already: a shaft in a hole of its own diameter meets
 * the plate's face in slivers along the hole's rim, as wide as the facets are wrong,
 * some running across a cap triangle past a rim corner (third review).
 */
function alongDrawnEdge(seg: [Vec3, Vec3], tri: Vec3[], drawnAt: Map<string, Array<[Vec3, Vec3]>>, ck: (p: Vec3) => string, tol: number, near: number): boolean {
  const edges = tri.flatMap((p) => drawnAt.get(ck(p)) ?? []);
  if (!edges.length) return false;
  const lim = Math.max(tol * 1000, near);
  const nearEdge = (x: Vec3): boolean =>
    edges.some(([p, q]) => {
      const e = sub3(q, p);
      const l2 = dot3(e, e);
      const t = l2 > 0 ? Math.max(0, Math.min(1, dot3(sub3(x, p), e) / l2)) : 0;
      const c: Vec3 = [p[0] + t * e[0], p[1] + t * e[1], p[2] + t * e[2]];
      return Math.hypot(x[0] - c[0], x[1] - c[1], x[2] - c[2]) <= lim;
    });
  const mid: Vec3 = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2, (seg[0][2] + seg[1][2]) / 2];
  return nearEdge(seg[0]) && nearEdge(seg[1]) && nearEdge(mid);
}

type Put = (p: Vec3) => number;
type Tri = (i: number, j: number, k: number, ni: Vec3, nj: Vec3, nk: Vec3) => void;
type Edge = (i: number, j: number) => void;

/** Chord tolerances for one body: absolute, relative to each arc's radius, and the largest used (out). */
interface Fineness {
  tol: number;
  rel: number;
  sag: number;
}

function tessExtrude(spec: Extract<BodySpec, { kind: "extrude" }>, ft: Fineness, put: Put, tri: Tri, edge: Edge): string | null {
  const outer = flattenLoop(spec.profile.outer, ft.tol, ft.rel);
  if (signedArea(outer.points) < 0) return "the outline must run counter-clockwise";
  const holes = spec.profile.holes.map((h) => flattenLoop(h, ft.tol, ft.rel));
  ft.sag = Math.max(outer.sag, ...holes.map((h) => h.sag));
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

function tessRevolve(spec: Extract<BodySpec, { kind: "revolve" }>, ft: Fineness, put: Put, tri: Tri, edge: Edge): string | null {
  const L = flattenLoop(spec.profile.outer, ft.tol, ft.rel);
  if (signedArea(L.points) < 0) return "the profile must run counter-clockwise in the (r, z) plane";
  const rmax = Math.max(...L.points.map((p) => p[0]));
  // Steps round the axis as an extruded circle of radius rmax takes them (two half
  // turns at the same tolerance), so a revolved pin and an extruded hole of the same
  // size have the same facets.
  const tolTurn = Math.min(ft.tol, rmax * ft.rel);
  const steps = Math.max(24, Math.min(512, 2 * arcSteps(rmax, Math.PI, tolTurn)));
  // Doubly curved: a facet's middle can be off by the profile's chord error AND the turn's.
  ft.sag = L.sag + Math.min(tolTurn, rmax);
  const n = L.points.length;
  const onAxis = (p: Pt2): boolean => Math.abs(p[0]) <= rmax * 1e-9;
  // ring[i][j]: vertex of profile point i at angle step j (one vertex on the axis).
  const angle = (j: number): number => (2 * Math.PI * j) / steps;
  // A SHARP point on the axis (a cone's apex) has no single normal: one shared vertex
  // would give each fan triangle a different apex normal and break the outline short
  // of the apex. It gets a ring of its own vertices instead, at a radius far below any
  // drawable size, so every meridian keeps its own normal right up to the tip. A
  // smooth pole (a sphere's, normal along the axis) keeps its single vertex.
  const sharpApex = (i: number): boolean => {
    const prev = (i - 1 + n) % n;
    const ends: Pt2[] = [];
    if (!onAxis(L.points[prev])) ends.push(L.edgeNormals[prev][1]);
    if (!onAxis(L.points[(i + 1) % n])) ends.push(L.edgeNormals[i][0]);
    return ends.some((nn) => Math.abs(nn[0]) > 1e-6);
  };
  const apexR = rmax * 1e-7;
  const ring: number[][] = L.points.map((p, i) => {
    if (onAxis(p)) {
      if (sharpApex(i)) return Array.from({ length: steps }, (_, j) => put([apexR * Math.cos(angle(j)), apexR * Math.sin(angle(j)), p[1]]));
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
      // (An apex ring has distinct vertices, so both triangles of its band are kept.)
      if (a0 !== a1) tri(a0, a1, b1, n3(nA, j), n3(nA, j1), n3(nB, j1));
      if (b0 !== b1) tri(a0, b1, b0, n3(nA, j), n3(nB, j1), n3(nB, j));
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
 * (self-intersection), which the caller refuses by name. Bounded by the triangle
 * cap, which the flattening tolerance keeps small for real profiles.
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
    // The closest polygon vertex whose bridge from M crosses no edge: candidates
    // nearest first, so the first clear one is the answer (review D6 — testing
    // every vertex against every edge made a 200-hole plate take a second).
    const holeIdx = h.map((_, k) => base + k);
    const allEdges: Array<[Pt2, Pt2]> = [];
    for (let k = 0; k < poly.length; k++) allEdges.push([pts[poly[k]], pts[poly[(k + 1) % poly.length]]]);
    for (const hh of holes) for (let k = 0; k < hh.length; k++) allEdges.push([hh[k], hh[(k + 1) % hh.length]]);
    const byDist = poly.map((q, k) => ({ k, d: (pts[q][0] - M[0]) ** 2 + (pts[q][1] - M[1]) ** 2 })).sort((p, q) => p.d - q.d);
    let best = -1;
    for (const { k } of byDist) {
      const P = pts[poly[k]];
      if (allEdges.some(([u, v]) => segsIntersect(M, P, u, v))) continue;
      best = k;
      break;
    }
    if (best < 0) return null;
    // Splice: ... P, M, (hole from M around back to M), M', P', ...
    const holeRing = [...holeIdx.slice(mi), ...holeIdx.slice(0, mi)];
    const P = poly[best];
    poly = [...poly.slice(0, best + 1), ...holeRing, holeRing[0], P, ...poly.slice(best + 1)];
  }
  // Ear clipping over a linked ring with a pointer that moves on (it no longer
  // restarts from the first vertex after every ear), testing only REFLEX vertices
  // for containment — no convex vertex can lie inside an ear unless a reflex one
  // does (Eberly, "Triangulation by Ear Clipping"). Was O(n³), now O(n·r).
  const out: number[] = [];
  const m = poly.length;
  const prv = new Int32Array(m), nxt = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    prv[k] = (k - 1 + m) % m;
    nxt[k] = (k + 1) % m;
  }
  const at = (k: number): Pt2 => pts[poly[k]];
  const convexAt = (k: number): boolean => cross2(at(prv[k]), at(k), at(nxt[k])) > 0;
  const reflex = new Set<number>();
  for (let k = 0; k < m; k++) if (!convexAt(k)) reflex.add(k);
  const inTri = (p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean =>
    cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  const same = (p: Pt2, q: Pt2): boolean => p[0] === q[0] && p[1] === q[1];
  const unlink = (k: number): void => {
    nxt[prv[k]] = nxt[k];
    prv[nxt[k]] = prv[k];
    reflex.delete(k);
    for (const j of [prv[k], nxt[k]]) {
      if (convexAt(j)) reflex.delete(j);
      else reflex.add(j);
    }
  };
  let remaining = m;
  let cur = 0;
  let sinceClip = 0;
  let guard = 0;
  const limit = m * m * 4 + 100;
  while (remaining > 3) {
    if (++guard > limit) return null;
    const a = prv[cur], c = nxt[cur];
    let ear = convexAt(cur);
    if (ear) {
      const A = at(a), B = at(cur), C = at(c);
      for (const q of reflex) {
        if (q === a || q === cur || q === c) continue;
        const Q = at(q);
        // Bridge duplicates share coordinates with a corner: not "inside".
        if (same(Q, A) || same(Q, B) || same(Q, C)) continue;
        if (inTri(Q, A, B, C)) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      out.push(poly[a], poly[cur], poly[c]);
      unlink(cur);
      remaining--;
      cur = a;
      sinceClip = 0;
      continue;
    }
    cur = nxt[cur];
    if (++sinceClip > remaining) {
      // A full turn with no ear: collinear runs leave zero-area "ears" — drop a vertex on its neighbours' line.
      let k = cur, found = -1;
      for (let n2 = 0; n2 < remaining; n2++, k = nxt[k]) {
        if (Math.abs(cross2(at(prv[k]), at(k), at(nxt[k]))) < 1e-18) {
          found = k;
          break;
        }
      }
      if (found < 0) return null;
      cur = prv[found];
      unlink(found);
      remaining--;
      sinceClip = 0;
    }
  }
  if (cross2(at(prv[cur]), at(cur), at(nxt[cur])) > 0) out.push(poly[prv[cur]], poly[cur], poly[nxt[cur]]);
  return out;
}
