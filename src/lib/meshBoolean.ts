/**
 * Combining imported parts (docs/SCOPE-MESH-BOOLEANS.md): join two parts, cut one out of another, or keep where they
 * overlap. The geometry engine (Manifold, WebAssembly) is the pane's to load — it is asynchronous and ESM-only — and is
 * handed in as a BoolEngine; everything here is synchronous and pure, so the drawing can be rebuilt from a cache the
 * same way an imported part is (cadMeshStore).
 *
 * A combined part is a RECIPE over its operands (never baked triangles: the drawing travels as JSON in the alt text);
 * its result is computed once, cached by `combineKey`, and drawn through stlBody like an imported part.
 */
import { apply3, rotationMatrix, type Placement, type SolidMesh, type Vec3 } from "./cadModel";
import { STL_LIMITS, stlBody, type StlFacets } from "./stl";

export type BoolOp = "union" | "subtract" | "intersect";
export const BOOL_OPS: BoolOp[] = ["union", "subtract", "intersect"];

/** The operation in words, as the pane offers it: A … B. */
export const BOOL_OP_WORDS: Record<BoolOp, string> = { union: "joined to", subtract: "with this cut out of it:", intersect: "kept only where it overlaps" };

/** Triangles as a geometry engine takes them: xyz per vertex, three vertex indices per triangle. */
export interface EngineMesh {
  positions: ArrayLike<number>;
  triangles: ArrayLike<number>;
}

/** The geometry engine (Manifold in the pane; anything with the same contract in a test). */
export interface BoolEngine {
  readonly version: string;
  run(op: BoolOp, a: EngineMesh, b: EngineMesh): { ok: true; result: EngineMesh; pieces: number } | { ok: false; reason: string };
}

/**
 * A part's triangles where the drawing puts them (world = R·p + T), with its corners WELDED: a drawable body splits
 * each corner per face for its shading (a box has 24 vertices, not 8), and the engine reads a split surface as one
 * with gaps. Corners with identical numbers are one vertex, joined before the move so the move cannot part them.
 */
export function worldMesh(m: SolidMesh, pl: Placement): EngineMesh {
  const R = rotationMatrix(pl.rotateDeg);
  const index = new Map<string, number>();
  const remap = new Int32Array(m.positions.length / 3);
  const out: number[] = [];
  for (let v = 0; v < remap.length; v++) {
    const x = m.positions[3 * v], y = m.positions[3 * v + 1], z = m.positions[3 * v + 2];
    const key = `${x === 0 ? 0 : x},${y === 0 ? 0 : y},${z === 0 ? 0 : z}`;
    let i = index.get(key);
    if (i === undefined) {
      i = out.length / 3;
      index.set(key, i);
      const w = apply3(R, [x, y, z]);
      out.push(w[0] + pl.translate[0], w[1] + pl.translate[1], w[2] + pl.translate[2]);
    }
    remap[v] = i;
  }
  const triangles = new Uint32Array(m.triangles.length);
  for (let k = 0; k < triangles.length; k++) triangles[k] = remap[m.triangles[k]];
  return { positions: Float64Array.from(out), triangles };
}

/**
 * The engine's result as a drawable body: through stlBody at 1 mm per unit (the same welding, crease edges and
 * `closed` flag as an imported part), placed where the operands were (its lowest corner), its noise and sag at least
 * the operands' (sections and hidden lines rely on them). Refused by name when empty, open or over the facet limit.
 */
export function combinedBody(
  result: EngineMesh,
  operands: SolidMesh[],
  creaseDeg: number,
): { ok: true; mesh: SolidMesh; placement: Placement; notes: string[] } | { ok: false; reason: string } {
  const count = Math.floor(result.triangles.length / 3);
  if (count === 0) return { ok: false, reason: "nothing is left (the parts do not overlap, or the cut removes all of it)" };
  if (count > STL_LIMITS.facets) return { ok: false, reason: `the result has ${count.toLocaleString("en-US")} facets, more than this canvas draws (${STL_LIMITS.facets.toLocaleString("en-US")})` };
  const corners = new Float64Array(9 * count);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const v = result.triangles[3 * t + k];
      for (let d = 0; d < 3; d++) {
        const x = result.positions[3 * v + d];
        corners[9 * t + 3 * k + d] = x;
        if (x < lo[d]) lo[d] = x;
      }
    }
  }
  // Float32 positions in the engine: "binary" is the float32 reading of the numbers.
  const facets: StlFacets = { format: "binary", corners, count, unreadable: 0 };
  const b = stlBody(facets, 1, creaseDeg);
  if (!b.ok) return { ok: false, reason: b.reason };
  if (!b.body.mesh.closed) return { ok: false, reason: "the result does not enclose a volume" };
  const mesh: SolidMesh = {
    ...b.body.mesh,
    noise: Math.max(b.body.mesh.noise, ...operands.map((o) => o.noise)),
    sag: Math.max(b.body.mesh.sag, ...operands.map((o) => o.sag)),
  };
  return { ok: true, mesh, placement: { translate: lo, rotateDeg: [0, 0, 0] }, notes: b.body.notes };
}

/** Runs one combination: both operands moved into place, the engine's verdict, the drawable result. */
export function combineMeshes(
  engine: BoolEngine,
  op: BoolOp,
  a: { mesh: SolidMesh; placement: Placement },
  b: { mesh: SolidMesh; placement: Placement },
  creaseDeg: number,
): { ok: true; mesh: SolidMesh; placement: Placement; notes: string[] } | { ok: false; reason: string } {
  if (!a.mesh.closed || !b.mesh.closed) return { ok: false, reason: "a part that does not enclose a volume (an open surface) cannot be combined" };
  const wa = worldMesh(a.mesh, a.placement), wb = worldMesh(b.mesh, b.placement);
  // The engine works in float32, and its tolerance grows with the size of the numbers: far from the origin a 0.01 mm
  // cut came back wrong (review). Both operands go to it moved by a whole-millimetre point of A's, and the result
  // comes back by the same move.
  const ref: Vec3 = [Math.round(wa.positions[0]), Math.round(wa.positions[1]), Math.round(wa.positions[2])];
  const sa = shifted(wa, ref, -1), sb = shifted(wb, ref, -1);
  const r = engine.run(op, sa, sb);
  if (!r.ok) return r;
  if (op === "union" && r.pieces > 1) return { ok: false, reason: "the two parts do not join into one piece (they are apart, or meet only along an edge or at a corner)" };
  // A cut that misses is no cut: the part would come back unchanged under a new name, and the drawing would say
  // nothing (a hands-on walk did exactly that — an imported part is placed beside the others). Refused by name.
  // The engine takes and gives float32 positions and leaves an untouched vertex exactly as it was, so the operands'
  // volumes are taken at float32, in the engine's frame: a cut that misses gives the SAME volume to the rounding of
  // the sum, and the bound is that rounding, at each part's own size (review: a bound relative to the part's volume
  // refused a pin hole; one scaled by both parts refused a real cut by an oversized cutter).
  const f32 = (m: EngineMesh): EngineMesh => ({ positions: Float32Array.from(m.positions), triangles: m.triangles });
  const va = enclosedVolume(f32(sa)), vb = enclosedVolume(f32(sb)), vr = enclosedVolume(r.result);
  const tri = (m: EngineMesh): number => m.triangles.length / 3;
  const slack = (m: EngineMesh): number => 64 * Number.EPSILON * (tri(m) + tri(r.result)) * diagonal(m) ** 3;
  const sameAs = (m: EngineMesh, v: number): boolean => Math.abs(vr - v) <= slack(m);
  if (op === "subtract" && sameAs(sa, va)) return { ok: false, reason: "the parts do not overlap — nothing would be cut (move one part into the other first)" };
  if (vr <= Math.min(slack(sa), slack(sb))) return { ok: false, reason: "nothing is left (the parts do not overlap, or the cut removes all of it)" };
  const out = combinedBody(shifted(r.result, ref, 1), [a.mesh, b.mesh], creaseDeg);
  if (!out.ok) return out;
  if (r.pieces > 1) out.notes.push(`The result is in ${r.pieces} pieces.`);
  if (op === "union" && (sameAs(sa, va) || sameAs(sb, vb))) out.notes.push("One part lies wholly inside the other: the join is the outer part as it was.");
  return out;
}

/**
 * The volume a closed triangle mesh encloses (divergence theorem), taken about `about` (a point near the mesh keeps
 * the terms the size of the part, not of its distance from the origin).
 */
export function enclosedVolume(m: EngineMesh, about: Vec3 = [0, 0, 0]): number {
  let v = 0;
  const P = m.positions, T = m.triangles;
  const [ox, oy, oz] = about;
  for (let t = 0; t + 2 < T.length; t += 3) {
    const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
    const ax = P[a] - ox, ay = P[a + 1] - oy, az = P[a + 2] - oz;
    const bx = P[b] - ox, by = P[b + 1] - oy, bz = P[b + 2] - oz;
    const cx = P[c] - ox, cy = P[c + 1] - oy, cz = P[c + 2] - oz;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

/** A mesh moved by ±d. */
function shifted(m: EngineMesh, d: Vec3, sign: 1 | -1): EngineMesh {
  const p = Float64Array.from(m.positions);
  for (let i = 0; i < p.length; i++) p[i] += sign * d[i % 3];
  return { positions: p, triangles: m.triangles };
}

/** The diagonal of a mesh's bounding box (the scale of the volume test's rounding bound). */
function diagonal(m: EngineMesh): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) {
    const x = m.positions[i], d = i % 3;
    if (x < lo[d]) lo[d] = x;
    if (x > hi[d]) hi[d] = x;
  }
  return Math.hypot(Math.max(0, hi[0] - lo[0]), Math.max(0, hi[1] - lo[1]), Math.max(0, hi[2] - lo[2]));
}

/**
 * Euler angles (degrees about X, then Y, then Z, as rotationMatrix takes them) of a row-major rotation — for
 * carrying a combined part's turn back onto its operands when it is separated.
 */
export function rotationDeg(R: number[]): Vec3 {
  const deg = (r: number): number => {
    const d = (r * 180) / Math.PI;
    const k = Math.round(d * 1e9) / 1e9; // 89.99999999999999 reads back as 90
    return k === 0 ? 0 : k;
  };
  const sy = Math.max(-1, Math.min(1, -R[6]));
  const cy = Math.hypot(R[0], R[3]);
  // Near a quarter turn about Y the X and Z angles are ill-conditioned (review: within 1e-9° of 90 the rebuilt turn
  // was off by 1.7e-4); below this the gimbal reading is the closer one.
  if (cy > 1e-6) return [deg(Math.atan2(R[7], R[8])), deg(Math.atan2(sy, cy)), deg(Math.atan2(R[3], R[0]))];
  // Gimbal lock (turned ±90° about Y): the X and Z turns are one turn; all of it is put on X.
  return [deg(Math.atan2(-R[5], R[4])), deg(Math.atan2(sy, cy)), 0];
}
