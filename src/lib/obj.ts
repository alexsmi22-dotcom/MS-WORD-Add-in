/**
 * Wavefront OBJ parts (docs/SCOPE-CAD-VIEWS.md §D): `v x y z` corners and `f` faces read into the same facets an STL
 * gives (lib/stl.ts), so an OBJ goes through the STL pipeline unchanged — its closedness checks, edge angle, units
 * asked (an OBJ, like an STL, does not say its units) and its place in the drawing by content fingerprint.
 *
 * Read: `v` (a fourth, weight, number ignored); `f` with any number of corners (a polygon is split into a fan from
 * its first corner), each corner `i`, `i/t`, `i//n` or `i/t/n`, negative indices counting back from the last `v`.
 * Ignored: `vt`, `vn`, `vp`, `o`, `g`, `s`, `l`, `p`, `usemtl`, `mtllib` (a material file is never fetched), comments.
 * A line that cannot be read is refused with its line number — never skipped.
 */
import { PrintedDigits, STL_LIMITS, StlFacets, tooMany } from "./stl";

const n0 = (v: number): string => v.toLocaleString("en-US");

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
      for (let j = 1; j + 1 < idx.length; j++) {
        facets++;
        if (facets > STL_LIMITS.facets) return { ok: false, reason: tooMany(facets) };
        for (const k of [idx[0], idx[j], idx[j + 1]]) corners.push(verts[3 * k], verts[3 * k + 1], verts[3 * k + 2]);
      }
    }
    // Every other statement (texture and normal corners, groups, smoothing, materials) carries no shape.
  }
  if (!facets) return { ok: false, reason: verts.length ? "it has corners but no faces" : "it has no faces" };
  return { ok: true, stl: { format: "obj", corners: Float64Array.from(corners), count: facets, unreadable: 0, step: printed.step, sig: printed.sig, f32: printed.f32 } };
}
