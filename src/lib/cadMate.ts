/**
 * Mates (the table release): click a flat face on the part to move, then a flat face on the part
 * it goes against — the first part turns so the two faces look at each other, and moves so they
 * lie flush with the clicked points meeting (as Solid Edge's Mate, with the points as the
 * Align). A click near a face's corner or centre snaps to it, so corners meet corners and centres
 * centres. Pure: the pane picks (cadPreview.pickAt) and applies the placement it returns.
 */
import { Mesh, Placement, Vec3, mul3, apply3, rotationMatrix } from "./cadModel";

export interface FaceHit {
  body: number;
  /** World point on the face (snapped to a corner or the centre when close enough). */
  point: Vec3;
  /** The face's outward unit normal (world). */
  normal: Vec3;
  /** What the point snapped to. */
  snap: "corner" | "centre" | "none";
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/**
 * The flat face under a pick: the picked triangle's plane (outward, as its corner normals say), and
 * the point snapped to the nearest face corner, or the face's centre, within `snapDist` (world units).
 * A curved surface is refused by name: a mate needs a flat face.
 */
export function faceAt(mesh: Mesh, tri: number, point: Vec3, snapDist: number): { ok: true; hit: FaceHit } | { ok: false; reason: string } {
  const T = mesh.triangles, P = mesh.positions, N = mesh.cornerNormals;
  if (!Number.isInteger(tri) || tri < 0 || 3 * tri + 2 >= T.length) return { ok: false, reason: "that spot is not on a part" };
  const v = (i: number): Vec3 => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const a = v(T[3 * tri]), b = v(T[3 * tri + 1]), c = v(T[3 * tri + 2]);
  const n0 = cross(sub(b, a), sub(c, a));
  const len = norm(n0);
  if (!(len > 0)) return { ok: false, reason: "that spot is on an edge — click inside a flat face" };
  let n = scale(n0, 1 / len);
  // Corner normals of a flat face all equal the face normal; a curved surface's differ.
  const cn = (k: number): Vec3 => [N[9 * tri + 3 * k], N[9 * tri + 3 * k + 1], N[9 * tri + 3 * k + 2]];
  for (let k = 0; k < 3; k++) {
    const m = cn(k), ml = norm(m);
    if (!(ml > 0) || Math.abs(dot(m, n)) / ml < 1 - 1e-6) return { ok: false, reason: "that is a curved surface — a mate needs a flat face (a side, top or end of a part)" };
  }
  if (dot(cn(0), n) < 0) n = scale(n, -1);
  const body = mesh.triBody[tri];
  // The face: this body's triangles in the same plane facing the same way, CONNECTED to the one picked
  // (a U-shaped part's two arm tops are one plane but two faces: its centre is never in the gap).
  const d0 = dot(n, a);
  const eps = Math.max(1e-9, mesh.diag * 1e-9);
  const cand: number[] = [];
  for (let t = 0; t < T.length / 3; t++) {
    if (mesh.triBody[t] !== body) continue;
    const p = v(T[3 * t]), q = v(T[3 * t + 1]), r = v(T[3 * t + 2]);
    const m = cross(sub(q, p), sub(r, p));
    const ml = norm(m);
    if (!(ml > 0) || dot(m, n) / ml < 1 - 1e-9) continue;
    if (Math.abs(dot(n, p) - d0) > eps || Math.abs(dot(n, q) - d0) > eps || Math.abs(dot(n, r) - d0) > eps) continue;
    cand.push(t);
  }
  // Triangles touch where they share a corner (by position: faces may not share vertex indices).
  const key = (i: number): string => [0, 1, 2].map((k) => Math.round(P[3 * i + k] / eps)).join(",");
  const byCorner = new Map<string, number[]>();
  for (const t of cand) for (let k = 0; k < 3; k++) (byCorner.get(key(T[3 * t + k])) ?? byCorner.set(key(T[3 * t + k]), []).get(key(T[3 * t + k]))!).push(t);
  const face = new Set<number>([tri]);
  const queue = [tri];
  while (queue.length) {
    const t = queue.pop()!;
    for (let k = 0; k < 3; k++)
      for (const u of byCorner.get(key(T[3 * t + k])) ?? [])
        if (!face.has(u)) {
          face.add(u);
          queue.push(u);
        }
  }
  const corners: Vec3[] = [];
  const seen = new Set<string>();
  let area = 0;
  let cx = 0, cy = 0, cz = 0;
  for (const t of face) {
    const p = v(T[3 * t]), q = v(T[3 * t + 1]), r = v(T[3 * t + 2]);
    const ml = norm(cross(sub(q, p), sub(r, p)));
    area += ml;
    cx += (ml * (p[0] + q[0] + r[0])) / 3;
    cy += (ml * (p[1] + q[1] + r[1])) / 3;
    cz += (ml * (p[2] + q[2] + r[2])) / 3;
    for (const i of [T[3 * t], T[3 * t + 1], T[3 * t + 2]]) if (!seen.has(key(i))) (seen.add(key(i)), corners.push(v(i)));
  }
  let best: Vec3 = point, snap: FaceHit["snap"] = "none", bestD = snapDist;
  for (const k of corners) {
    const dd = norm(sub(k, point));
    if (dd <= bestD) (bestD = dd, best = k, snap = "corner");
  }
  if (snap === "none" && area > 0) {
    const centre: Vec3 = [cx / area, cy / area, cz / area];
    if (norm(sub(centre, point)) <= snapDist) (best = centre, snap = "centre");
  }
  return { ok: true, hit: { body, point: best, normal: n, snap } };
}

/** Degrees about X, then Y, then Z for a rotation matrix (the inverse of rotationMatrix), snapped near whole degrees. */
export function eulerFromMatrix(R: number[]): Vec3 {
  const sy = Math.max(-1, Math.min(1, -R[6]));
  let ax: number, ay: number, az: number;
  ay = Math.asin(sy);
  if (Math.abs(sy) < 1 - 1e-12) {
    ax = Math.atan2(R[7], R[8]);
    az = Math.atan2(R[3], R[0]);
  } else {
    // Gimbal lock (Y = ±90°): only X ∓ Z is fixed; Z is taken as 0.
    az = 0;
    ax = sy > 0 ? Math.atan2(R[1], R[4]) : Math.atan2(-R[1], R[4]);
    ay = sy > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  return [ax, ay, az].map((r) => {
    const d = (r * 180) / Math.PI;
    const w = Math.round(d);
    const out = Math.abs(d - w) < 1e-7 ? w : d;
    return out === 0 ? 0 : out; // never −0
  }) as Vec3;
}

/** The rotation taking unit vector `from` onto unit vector `to` (a half turn about a perpendicular when they are opposite). */
function rotationBetween(from: Vec3, to: Vec3): number[] {
  const c = dot(from, to);
  if (c > 1 - 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let axis: Vec3;
  if (c < -1 + 1e-12) {
    // Opposite: a half turn about the principal axis most nearly perpendicular to `from`.
    const pick: Vec3 = Math.abs(from[0]) <= Math.abs(from[1]) && Math.abs(from[0]) <= Math.abs(from[2]) ? [1, 0, 0] : Math.abs(from[1]) <= Math.abs(from[2]) ? [0, 1, 0] : [0, 0, 1];
    const p = sub(pick, scale(from, dot(pick, from)));
    axis = scale(p, 1 / norm(p));
    const [x, y, z] = axis;
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const k = cross(from, to);
  const s = norm(k);
  axis = scale(k, 1 / s);
  const [x, y, z] = axis, t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

const snapEntries = (m: number[]): number[] =>
  m.map((x) => {
    for (const w of [0, 1, -1]) if (Math.abs(x - w) < 1e-12) return w;
    return x;
  });

/**
 * Where the moving part goes so its face lies flush against the target face, the two clicked
 * points meeting. `frame` is the moving part's shape frame (or none); `placement` its placement now.
 */
export function mate(moving: FaceHit, target: FaceHit, placement: Placement, frame?: number[]): { ok: true; placement: Placement } | { ok: false; reason: string } {
  if (moving.body === target.body) return { ok: false, reason: "both faces are on the same part — click a face of the part to move, then a face of the part it goes against" };
  const turn = rotationMatrix(placement.rotateDeg);
  const R = frame ? mul3(turn, frame) : turn;
  const align = rotationBetween(moving.normal, scale(target.normal, -1));
  const newTurnExact = snapEntries(mul3(align, turn));
  const rotateDeg = eulerFromMatrix(newTurnExact);
  // The turn as it will be rebuilt from those degrees (what the drawing will use).
  const newTurn = rotationMatrix(rotateDeg);
  const newR = frame ? mul3(newTurn, frame) : newTurn;
  // The moving point in the part's own coordinates, then where the new turn puts it.
  const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const local = apply3(Rt, sub(moving.point, placement.translate));
  const turned = apply3(newR, local);
  const translate = sub(target.point, turned).map((x, k) => {
    // Clean float dust where the target coordinate is whole-ish, so flush faces are exactly flush.
    const exact = target.point[k] - turned[k];
    const r = Math.round(exact * 1e9) / 1e9;
    return Math.abs(exact - r) < 1e-9 * Math.max(1, Math.abs(exact)) ? (r === 0 ? 0 : r) : x;
  }) as Vec3;
  if (!translate.every(Number.isFinite) || !rotateDeg.every(Number.isFinite)) return { ok: false, reason: "the mate could not be worked out for those faces" };
  return { ok: true, placement: { translate, rotateDeg } };
}
