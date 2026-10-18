/**
 * Exploded views (the table release): each part drawn moved apart from where it is assembled, with
 * trail lines showing where it goes. 37 CFR 1.84(h)(1): "Exploded views, with the separated parts
 * embraced by a bracket, to show the relationship or order of assembly of various parts are
 * permissible" — the bracket is drawn by cadSheet. Pure: offsets live in the document
 * (CadDoc.explode, part id → [dx, dy, dz]); the mesh of the exploded assembly is tessellated from
 * explodedDoc like any other.
 */
import type { Mesh, Vec3 } from "./cadModel";
import type { CadDoc, DocCallout } from "./cadShapes";

export type Offsets = Record<string, Vec3>;

/** Each body's box in the mesh (world), by body index; null for a body with no triangles. */
export function bodyBoxes(mesh: Mesh, bodies: number): Array<{ lo: Vec3; hi: Vec3 } | null> {
  const out: Array<{ lo: Vec3; hi: Vec3 } | null> = new Array(bodies).fill(null);
  const T = mesh.triangles, P = mesh.positions;
  for (let t = 0; t < T.length; t++) {
    const b = mesh.triBody[Math.floor(t / 3)];
    if (b === undefined || b >= bodies) continue;
    const i = 3 * T[t];
    const box = (out[b] ??= { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
    for (let k = 0; k < 3; k++) {
      box.lo[k] = Math.min(box.lo[k], P[i + k]);
      box.hi[k] = Math.max(box.hi[k], P[i + k]);
    }
  }
  return out;
}

/**
 * Offsets that lift the assembly apart in levels: parts are grouped by height (their boxes'
 * centres within 5 % of the assembly's height of each other); the lowest level stays, and each
 * level above rises by a gap per level (40 % of the assembly's height). A table's legs stay and
 * its top lifts off them.
 */
export function autoExplode(doc: CadDoc, mesh: Mesh): Offsets {
  const boxes = bodyBoxes(mesh, doc.parts.length);
  const present = boxes.flatMap((b, i) => (b ? [{ i, b }] : []));
  if (present.length < 2) return {};
  const lo = Math.min(...present.map((p) => p.b.lo[2])), hi = Math.max(...present.map((p) => p.b.hi[2]));
  const height = hi - lo || Math.max(...present.map((p) => Math.max(p.b.hi[0] - p.b.lo[0], p.b.hi[1] - p.b.lo[1])));
  const tol = height * 0.05;
  const centre = (b: { lo: Vec3; hi: Vec3 }): number => (b.lo[2] + b.hi[2]) / 2;
  const sorted = [...present].sort((p, q) => centre(p.b) - centre(q.b));
  const out: Offsets = {};
  let level = 0, levelZ = centre(sorted[0].b);
  for (const p of sorted) {
    if (centre(p.b) - levelZ > tol) {
      level++;
      levelZ = centre(p.b);
    }
    if (level) out[doc.parts[p.i].id] = [0, 0, +(level * height * 0.4).toPrecision(12)];
  }
  return out;
}

/** The document with every part moved by its offset (a copy; the document itself is unchanged). */
export function explodedDoc(doc: CadDoc, offsets: Offsets): CadDoc {
  return {
    ...doc,
    parts: doc.parts.map((p) => {
      const o = offsets[p.id];
      if (!o) return p;
      return { ...p, placement: { ...p.placement, translate: [p.placement.translate[0] + o[0], p.placement.translate[1] + o[1], p.placement.translate[2] + o[2]] as Vec3 } };
    }),
  };
}

/** Callout anchors in the exploded assembly: each moves with its part (one with no part stays). */
export function explodedAnchors(doc: CadDoc, callouts: Array<{ anchor: Vec3; src?: number }>, offsets: Offsets): Vec3[] {
  return callouts.map((c, n) => {
    const part = (doc.callouts[c.src ?? n] as DocCallout | undefined)?.part;
    const o = part ? offsets[part] : undefined;
    return o ? [c.anchor[0] + o[0], c.anchor[1] + o[1], c.anchor[2] + o[2]] : c.anchor;
  });
}

/**
 * Trail lines (world, exploded positions) showing where each moved part goes. A part moved
 * straight up or down gets one trail to each part it sits on or under (the middle of where their
 * footprints meet: a table top gets one to each leg); any other move, one trail from the face it
 * moved away from back to where that face was.
 */
export function explodeTrails(doc: CadDoc, mesh: Mesh, offsets: Offsets): Array<[Vec3, Vec3]> {
  const boxes = bodyBoxes(mesh, doc.parts.length);
  const off = (i: number): Vec3 => offsets[doc.parts[i].id] ?? [0, 0, 0];
  const out: Array<[Vec3, Vec3]> = [];
  doc.parts.forEach((p, i) => {
    const v = offsets[p.id], b = boxes[i];
    if (!v || !b) return;
    const len = Math.hypot(v[0], v[1], v[2]);
    if (!(len > 0)) return;
    const vertical = Math.abs(v[2]) / len > 1 - 1e-9;
    if (vertical) {
      const up = v[2] > 0;
      let any = false;
      boxes.forEach((q, j) => {
        if (j === i || !q) return;
        const oq = off(j);
        // Only a part on the side this one moved away from, whose relative move opens a gap.
        if (up ? q.hi[2] > b.lo[2] + 1e-9 : q.lo[2] < b.hi[2] - 1e-9) return;
        if (up ? v[2] - oq[2] <= 0 : v[2] - oq[2] >= 0) return;
        const x0 = Math.max(b.lo[0], q.lo[0]), x1 = Math.min(b.hi[0], q.hi[0]), y0 = Math.max(b.lo[1], q.lo[1]), y1 = Math.min(b.hi[1], q.hi[1]);
        if (x1 < x0 || y1 < y0) return;
        const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
        out.push([
          [x, y, (up ? b.lo[2] : b.hi[2]) + v[2]],
          [x + oq[0], y + oq[1], (up ? q.hi[2] : q.lo[2]) + oq[2]],
        ]);
        any = true;
      });
      if (any) return;
    }
    // The face the part moved away from: the box's centre, back along the move to the box's edge.
    const u: Vec3 = [v[0] / len, v[1] / len, v[2] / len];
    const c: Vec3 = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];
    // Where a ray from the centre, back along the move, leaves the box.
    const half = Math.min(...[0, 1, 2].filter((k) => Math.abs(u[k]) > 1e-12).map((k) => (b.hi[k] - b.lo[k]) / 2 / Math.abs(u[k])));
    const back: Vec3 = [c[0] - u[0] * half, c[1] - u[1] * half, c[2] - u[2] * half];
    out.push([[back[0] + v[0], back[1] + v[1], back[2] + v[2]], back]);
  });
  return out;
}
