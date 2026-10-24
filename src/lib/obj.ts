/**
 * Wavefront OBJ parts (docs/SCOPE-CAD-VIEWS.md §D): `v x y z` corners and `f` faces read into the same facets an STL
 * gives (lib/stl.ts), so an OBJ goes through the STL pipeline unchanged — its closedness checks, edge angle, units
 * asked (an OBJ, like an STL, does not say its units) and its place in the drawing by content fingerprint.
 *
 * Read: `v` (a fourth, weight, number ignored); `f` with any number of corners (a convex polygon is split into a fan
 * from its first corner, a concave one ear-clipped in its plane — faceTriangles), each corner `i`, `i/t`, `i//n` or `i/t/n`, negative indices counting back from the last `v`.
 * Ignored: `vt`, `vn`, `vp`, `o`, `g`, `s`, `l`, `p`, `usemtl`, `mtllib` (a material file is never fetched), comments.
 * A line that cannot be read is refused with its line number — never skipped.
 */
import { PrintedDigits, STL_LIMITS, StlFacets, tooMany } from "./stl";
import { triangulateWithHoles, type Pt2 } from "./cadModel";

const n0 = (v: number): string => v.toLocaleString("en-US");

/**
 * The triangles of one face (corner indices into `verts`, three numbers per corner), wound as the face is.
 * A convex face is the fan from its first corner, exactly as before (an OBJ's place in a drawing is found by its
 * content, so a convex face must give the same facets). A CONCAVE face is ear-clipped in its own plane (fix2-cad:
 * the fan of an L-shaped face covered the notch and spilled outside the face); a face that cannot be clipped (it
 * crosses itself, or is not flat enough to project) keeps the fan.
 */
export function faceTriangles(idx: number[], verts: ArrayLike<number>): Array<[number, number, number]> {
  const fan = (): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [];
    for (let j = 1; j + 1 < idx.length; j++) out.push([idx[0], idx[j], idx[j + 1]]);
    return out;
  };
  const n = idx.length;
  if (n <= 3) return fan();
  // The face's normal by Newell's method (sound for a concave polygon), then the plane it projects onto: drop the
  // normal's largest axis, ordered so the face runs counter-clockwise when its normal points at the viewer.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = 3 * idx[i], b = 3 * idx[(i + 1) % n];
    nx += (verts[a + 1] - verts[b + 1]) * (verts[a + 2] + verts[b + 2]);
    ny += (verts[a + 2] - verts[b + 2]) * (verts[a] + verts[b]);
    nz += (verts[a] - verts[b]) * (verts[a + 1] + verts[b + 1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (!(ax + ay + az > 0)) return fan();
  const [u, v, sign] = az >= ax && az >= ay ? [0, 1, Math.sign(nz)] : ax >= ay ? [1, 2, Math.sign(nx)] : [2, 0, Math.sign(ny)];
  const pts: Pt2[] = idx.map((k) => [verts[3 * k + u], sign * verts[3 * k + v]]);
  // Convex (every turn the same way, no zero-length side): the fan, unchanged.
  let convex = true;
  for (let i = 0; i < n && convex; i++) {
    const o = pts[i], a = pts[(i + 1) % n], b = pts[(i + 2) % n];
    if ((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]) < 0) convex = false;
  }
  if (convex) return fan();
  const tris = triangulateWithHoles(pts, []);
  // A dropped collinear corner leaves fewer triangles than n − 2: the fan then keeps every corner on the mesh.
  if (!tris || tris.length / 3 !== n - 2) return fan();
  const out: Array<[number, number, number]> = [];
  for (let t = 0; t < tris.length; t += 3) out.push([idx[tris[t]], idx[tris[t + 1]], idx[tris[t + 2]]]);
  return out;
}

/** The facets of an OBJ, or a refusal that says why (without the file's name: the caller adds it). */
export function readObj(bytes: Uint8Array): { ok: true; stl: StlFacets } | { ok: false; reason: string } {
  if (bytes.length > STL_LIMITS.bytes) return { ok: false, reason: `the file is ${Math.ceil((bytes.length / 1048576) * 10) / 10} MB — this importer reads OBJ files up to ${STL_LIMITS.bytes / 1048576} MB` };
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\ufeff/, "");
  const verts: number[] = [];
  const corners: number[] = [];
  const printed = new PrintedDigits();
  let facets = 0;
  const lines = text.split(/\r\n|\r|\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].replace(/#.*/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const at = `line ${n0(ln + 1)}`;
    if (parts[0] === "v") {
      if (parts.length < 4) return { ok: false, reason: `${at}: a corner ("v") needs three numbers` };
      for (const t of parts.slice(1, 4)) {
        const v = Number(t);
        if (!Number.isFinite(v)) return { ok: false, reason: `${at}: "${t}" is not a number` };
        verts.push(v);
        printed.add(t, v);
      }
    } else if (parts[0] === "f") {
      if (parts.length < 4) return { ok: false, reason: `${at}: a face ("f") needs at least three corners` };
      const nv = verts.length / 3;
      const idx: number[] = [];
      for (const t of parts.slice(1)) {
        const head = t.split("/")[0];
        const i = Number(head);
        if (!/^-?\d+$/.test(head) || i === 0) return { ok: false, reason: `${at}: "${t}" is not a corner number` };
        const k = i > 0 ? i - 1 : nv + i;
        if (k < 0 || k >= nv) return { ok: false, reason: `${at}: corner ${i} does not exist (${n0(nv)} corners so far)` };
        idx.push(k);
      }
      for (const [i0, i1, i2] of faceTriangles(idx, verts)) {
        facets++;
        if (facets > STL_LIMITS.facets) return { ok: false, reason: tooMany(facets) };
        for (const k of [i0, i1, i2]) corners.push(verts[3 * k], verts[3 * k + 1], verts[3 * k + 2]);
      }
    }
    // Every other statement (texture and normal corners, groups, smoothing, materials) carries no shape.
  }
  if (!facets) return { ok: false, reason: verts.length ? "it has corners but no faces" : "it has no faces" };
  return { ok: true, stl: { format: "obj", corners: Float64Array.from(corners), count: facets, unreadable: 0, step: printed.step, sig: printed.sig, f32: printed.f32 } };
}
