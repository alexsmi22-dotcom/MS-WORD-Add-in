/**
 * Perspective views (docs/SCOPE-CAD-VIEWS.md §C) — 37 CFR 1.84(h): "The views may be plan, elevation, section, or
 * perspective views."
 *
 * THE METHOD. In the view's camera frame (x right, y up, z toward the eye), with the model centred and the eye at
 * (0, 0, d), every point goes through the projective map
 *     (x, y, z) → (x·s, y·s, z·s),  s = d / (d − z).
 * A projective map keeps straight lines straight and keeps depth order in front of the eye, so the ORTHOGRAPHIC
 * hidden-line engine (cadLines) run on the mapped mesh draws the PERSPECTIVE drawing — no second engine. The plane
 * through the model's centre (z = 0) keeps its size (s = 1): the drawing is about as large as the parallel one.
 *
 * Normals go through the map's inverse-transpose Jacobian, so a curved surface's outline is where the eye's rays
 * graze it: n·(eye − p) = 0 before the map is exactly n′·(0, 0, 1) = 0 after it.
 */
import type { Mesh, Vec3 } from "./cadModel";
import type { CadView } from "./cadLines";

/** The eye's distance from the model's centre, in model diagonals, unless the view says otherwise. */
export const PERSPECTIVE_DISTANCE = 3;
/** The distances offered (in model diagonals): nearer is stronger perspective. */
export const PERSPECTIVE_DISTANCES = [1.5, 2, 3, 5, 8];

/** The view the mapped mesh is drawn from: its coordinates are already the camera's. */
export const MAPPED_VIEW: CadView = { name: "perspective", rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

export type PerspectiveResult =
  | { ok: true; mesh: Mesh; map: (p: Vec3) => Vec3 }
  | { ok: false; reason: string };

/**
 * The mesh mapped for a perspective drawing from `view` with the eye `distance` model diagonals from its centre; draw
 * it from MAPPED_VIEW. `map` takes a world point (a callout's anchor) to the same mapped coordinates.
 */
export function perspectiveMesh(mesh: Mesh, view: CadView, distance = PERSPECTIVE_DISTANCE): PerspectiveResult {
  const P = mesh.positions, R = view.rot;
  const nv = P.length / 3;
  if (!nv) return { ok: true, mesh, map: (p) => p };
  const cam = (x: number, y: number, z: number): Vec3 => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
  // The centre of the model's box in the camera frame.
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) {
    const c = cam(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], c[k])), (hi[k] = Math.max(hi[k], c[k]));
  }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const d = distance * mesh.diag;
  // The eye must be outside the model and in front of all of it (a point at or behind the eye has no image).
  if (!(d > 0) || hi[2] - centre[2] >= d * 0.98) return { ok: false, reason: "the eye would be inside the model at this distance — choose a farther perspective" };
  const rel = (c: Vec3): Vec3 => [c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]];
  const toMapped = (c: Vec3): Vec3 => {
    const s = d / (d - c[2]);
    return [c[0] * s, c[1] * s, c[2] * s];
  };
  const map = (p: Vec3): Vec3 => toMapped(rel(cam(p[0], p[1], p[2])));

  const positions = new Array<number>(P.length);
  const relPos: Vec3[] = [];
  for (let i = 0; i < nv; i++) {
    const r = rel(cam(P[3 * i], P[3 * i + 1], P[3 * i + 2]));
    relPos.push(r);
    const m = toMapped(r);
    positions[3 * i] = m[0];
    positions[3 * i + 1] = m[1];
    positions[3 * i + 2] = m[2];
  }
  // Each corner's normal, turned into the camera frame and through the inverse-transpose Jacobian at its corner:
  // n′ ∝ (nx, ny, nz/s − (x·nx + y·ny)/d).
  const T = mesh.triangles, N = mesh.cornerNormals;
  const cornerNormals = new Array<number>(N.length);
  for (let t = 0; t < T.length / 3; t++) {
    for (let c = 0; c < 3; c++) {
      const [x, y, z] = relPos[T[3 * t + c]];
      const n = cam(N[9 * t + 3 * c], N[9 * t + 3 * c + 1], N[9 * t + 3 * c + 2]);
      const s = d / (d - z);
      const m: Vec3 = [n[0], n[1], n[2] / s - (x * n[0] + y * n[1]) / d];
      const l = Math.hypot(m[0], m[1], m[2]) || 1;
      cornerNormals[9 * t + 3 * c] = m[0] / l;
      cornerNormals[9 * t + 3 * c + 1] = m[1] / l;
      cornerNormals[9 * t + 3 * c + 2] = m[2] / l;
    }
  }
  const mlo = [Infinity, Infinity, Infinity], mhi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) (mlo[k] = Math.min(mlo[k], positions[3 * i + k])), (mhi[k] = Math.max(mhi[k], positions[3 * i + k]));
  const diag = Math.hypot(mhi[0] - mlo[0], mhi[1] - mlo[1], mhi[2] - mlo[2]);
  return {
    ok: true,
    mesh: {
      ...mesh,
      positions,
      cornerNormals,
      diag,
      crossings: mesh.crossings.map((c) => ({ ...c, a: map(c.a), b: map(c.b) })),
    },
    map,
  };
}
