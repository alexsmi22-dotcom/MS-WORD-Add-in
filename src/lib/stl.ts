/**
 * Reading an STL (docs/SCOPE-CAD-IMPORT.md, R3b) into a triangle body the
 * hidden-line engine draws (cadModel SolidMesh).
 *
 * An STL is only facets: no units, no shared corners, no faces, no edges. So:
 *   - binary or text is decided by the file's SIZE (84 + 50 × the count it
 *     states), never by a leading "solid", which many binary headers also carry;
 *   - corners are joined where their coordinates are identical (CAD exporters
 *     write a shared corner with the same numbers every time);
 *   - facets are turned to agree with their neighbours, and a closed piece that
 *     comes out inside out is turned to face out (normals come from the winding;
 *     the stored facet normals are ignored — exporters often write zeros);
 *   - an edge is drawn where two facets meet at more than the crease angle, and
 *     wherever the surface is open (one facet) or more than two facets meet;
 *     elsewhere the corner normals are smoothed, so a faceted cylinder is drawn
 *     with its outline, not its facets.
 * Every limit is checked before the work it bounds; facets with unreadable
 * numbers or no area are counted in the notes, never silently dropped.
 */
import type { SolidMesh } from "./cadModel";

export const STL_LIMITS = {
  /** File size (a 200 000-facet text STL is about 50 MB). */
  bytes: 60 * 1024 * 1024,
  /** Facets: the drawing's own triangle limit (cadModel DEFAULT_TESS). */
  facets: 200_000,
};

/** Facets meeting at more than this are drawn as an edge (the user can change it). */
export const DEFAULT_CREASE_DEG = 30;

export interface StlFacets {
  format: "binary" | "text";
  /** 9 numbers a facet (three corners), in the file's units. */
  corners: Float64Array;
  count: number;
  /** Facets left out because a number could not be read. */
  unreadable: number;
}

const n0 = (v: number): string => v.toLocaleString("en-US");
const latin1 = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);

/** The facets of an STL, or a refusal that says why (without the file's name: the caller adds it). */
export function readStl(bytes: Uint8Array): { ok: true; stl: StlFacets } | { ok: false; reason: string } {
  const len = bytes.length;
  if (len > STL_LIMITS.bytes) return { ok: false, reason: `the file is ${Math.ceil((len / 1048576) * 10) / 10} MB — this importer reads STL files up to ${STL_LIMITS.bytes / 1048576} MB` };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, len);
  const stated = len >= 84 ? dv.getUint32(80, true) : -1;
  const binarySize = stated >= 0 && 84 + 50 * stated === len;
  const head = latin1(bytes.subarray(0, Math.min(len, 4096)));
  const textStart = /^\s*solid\b/i.test(head) && /\bfacet\b/i.test(head);
  // Both can hold: a binary header that starts "solid …". Text after the 84-byte header settles it.
  const printable = (): boolean => {
    for (let i = 84; i < Math.min(len, 1084); i++) {
      const c = bytes[i];
      if (c !== 9 && c !== 10 && c !== 13 && (c < 32 || c > 126)) return false;
    }
    return true;
  };
  if (binarySize && !(textStart && printable())) return readBinary(dv, stated);
  if (textStart || /^\s*solid\b/i.test(head)) return readText(latin1(bytes));
  if (len < 84) return { ok: false, reason: "the file is too short to be an STL" };
  return {
    ok: false,
    reason: `this is not an STL this importer can read — as a binary STL it states ${n0(stated)} facets, which take ${n0(84 + 50 * stated)} bytes, but the file has ${n0(len)}; and it does not start as a text STL ("solid …")`,
  };
}

function tooMany(count: number): string {
  return `it has ${count > STL_LIMITS.facets ? "more than " + n0(STL_LIMITS.facets) : n0(count)} facets — this importer reads up to ${n0(STL_LIMITS.facets)}; export it again with a coarser tolerance`;
}

function readBinary(dv: DataView, count: number): { ok: true; stl: StlFacets } | { ok: false; reason: string } {
  if (!count) return { ok: false, reason: "it has no facets" };
  if (count > STL_LIMITS.facets) return { ok: false, reason: tooMany(count) };
  const out = new Float64Array(9 * count);
  let n = 0, unreadable = 0;
  for (let f = 0; f < count; f++) {
    const o = 84 + 50 * f + 12; // past the stored normal
    let ok = true;
    for (let k = 0; k < 9; k++) {
      const v = dv.getFloat32(o + 4 * k, true);
      if (!Number.isFinite(v)) ok = false;
      out[9 * n + k] = v;
    }
    if (ok) n++;
    else unreadable++;
  }
  if (!n) return { ok: false, reason: "none of its facets has readable numbers" };
  return { ok: true, stl: { format: "binary", corners: out.subarray(0, 9 * n), count: n, unreadable } };
}

function readText(text: string): { ok: true; stl: StlFacets } | { ok: false; reason: string } {
  // A facet starts "facet normal" (so a solid NAMED "facet" is not one); "endfacet" never
  // matches "facet" (no word boundary before its f).
  const re = /\b(endfacet\b|facet\s+normal\b|vertex\s+(\S+)\s+(\S+)\s+(\S+))/gi;
  const corners: number[] = [];
  let facet = 0, inFacet = false, seen = 0, bad = false, unreadable = 0;
  const cur: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const w = m[1].slice(0, 5).toLowerCase();
    if (w === "endfa") {
      if (!inFacet) return { ok: false, reason: `the text is damaged: an "endfacet" with no facet before it (after facet ${n0(facet)})` };
      if (seen !== 3) return { ok: false, reason: `facet ${n0(facet)} has ${seen} corner${seen === 1 ? "" : "s"} — an STL facet has three` };
      if (bad) unreadable++;
      else corners.push(...cur);
      inFacet = false;
    } else if (w === "facet") {
      if (inFacet) return { ok: false, reason: `facet ${n0(facet)} has no "endfacet"` };
      facet++;
      if (facet > STL_LIMITS.facets) return { ok: false, reason: tooMany(facet) };
      inFacet = true;
      seen = 0;
      bad = false;
      cur.length = 0;
    } else {
      if (!inFacet) return { ok: false, reason: `the text is damaged: a vertex outside any facet (after facet ${n0(facet)})` };
      seen++;
      if (seen <= 3) {
        for (const t of [m[2], m[3], m[4]]) {
          const v = Number(t);
          if (!Number.isFinite(v)) bad = true;
          cur.push(v);
        }
      }
    }
  }
  if (inFacet) return { ok: false, reason: `facet ${n0(facet)} has no "endfacet" (the file is cut short)` };
  if (!facet) return { ok: false, reason: "it has no facets" };
  if (!corners.length) return { ok: false, reason: "none of its facets has readable numbers" };
  return { ok: true, stl: { format: "text", corners: Float64Array.from(corners), count: corners.length / 9, unreadable } };
}

export interface StlBody {
  mesh: SolidMesh;
  /** Size along X, Y, Z in mm (the body is moved so its lowest corner is at the origin). */
  size: [number, number, number];
  notes: string[];
}

/**
 * The facets as a body, in mm (`mmPerUnit` from the units the user chose), moved to
 * the origin, with edges where facets meet at more than `creaseDeg`.
 */
export function stlBody(stl: StlFacets, mmPerUnit: number, creaseDeg = DEFAULT_CREASE_DEG): { ok: true; body: StlBody } | { ok: false; reason: string } {
  if (!(mmPerUnit > 0) || !Number.isFinite(mmPerUnit)) return { ok: false, reason: "choose the file's units first" };
  if (!(creaseDeg > 0 && creaseDeg < 180)) return { ok: false, reason: "the edge angle must be between 0° and 180°" };
  const C = stl.corners;
  const nc = 3 * stl.count;

  // 1. Corners joined where their numbers are identical (an open-addressed table over the
  //    three coordinates; typed arrays throughout — this runs on 600 000 corners).
  let size = 1;
  while (size < 2 * nc) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const raw = new Float64Array(3 * nc); // each distinct corner, in the file's units
  const bits = new Uint32Array(new Float64Array([0]).buffer);
  const f64 = new Float64Array(bits.buffer);
  const hash = (x: number, y: number, z: number): number => {
    let h = 0x811c9dc5;
    for (const v of [x, y, z]) {
      f64[0] = v === 0 ? 0 : v; // −0 and 0 are one place
      h = Math.imul(h ^ bits[0], 0x01000193);
      h = Math.imul(h ^ bits[1], 0x01000193);
    }
    return (h ^ (h >>> 15)) >>> 0;
  };
  let nv = 0;
  const cornerVertex = new Int32Array(nc);
  for (let i = 0; i < nc; i++) {
    const x = C[3 * i], y = C[3 * i + 1], z = C[3 * i + 2];
    let slot = hash(x, y, z) & (size - 1);
    for (;;) {
      const id = table[slot];
      if (id < 0) {
        table[slot] = nv;
        raw[3 * nv] = x;
        raw[3 * nv + 1] = y;
        raw[3 * nv + 2] = z;
        cornerVertex[i] = nv++;
        break;
      }
      if (raw[3 * id] === x && raw[3 * id + 1] === y && raw[3 * id + 2] === z) {
        cornerVertex[i] = id;
        break;
      }
      slot = (slot + 1) & (size - 1);
    }
  }
  // Two corners in one place: a facet with no area and no shape. Left out (counted).
  const keep: number[] = [];
  for (let f = 0; f < stl.count; f++) {
    const a = cornerVertex[3 * f], b = cornerVertex[3 * f + 1], c = cornerVertex[3 * f + 2];
    if (a !== b && b !== c && a !== c) keep.push(a, b, c);
  }
  const collapsed = stl.count - keep.length / 3;
  const tris = Int32Array.from(keep);
  const nt = tris.length / 3;
  if (!nt) return { ok: false, reason: "every facet has two corners in one place (no area)" };
  const pos = new Float64Array(3 * nv);
  for (let i = 0; i < 3 * nv; i++) {
    pos[i] = raw[i] * mmPerUnit;
    if (!(Math.abs(pos[i]) <= 1e6)) return { ok: false, reason: "it reaches farther than 1,000,000 mm from the origin in these units — check the units" };
  }
  const P = (i: number, k: number): number => pos[3 * i + k];

  // 2. Each side of each facet (half-edge h = 3t + c, from corner c to c + 1), grouped by the
  //    edge it lies on: bucketed by its lower vertex, matched by its higher one.
  const nh = 3 * nt;
  const lowV = new Int32Array(nh), highV = new Int32Array(nh);
  const start = new Int32Array(nv + 1);
  for (let h = 0; h < nh; h++) {
    const t = (h / 3) | 0, c = h % 3;
    const a = tris[h], b = tris[3 * t + ((c + 1) % 3)];
    lowV[h] = a < b ? a : b;
    highV[h] = a < b ? b : a;
    start[lowV[h] + 1]++;
  }
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const byLow = new Int32Array(nh);
  const fill = start.slice(0, nv);
  for (let h = 0; h < nh; h++) byLow[fill[lowV[h]]++] = h;
  const edgeOf = new Int32Array(nh).fill(-1);
  const edgeStart: number[] = [];
  const edgeList = new Int32Array(nh);
  let ne = 0, put = 0;
  for (let v = 0; v < nv; v++)
    for (let i = start[v]; i < start[v + 1]; i++) {
      const h = byLow[i];
      if (edgeOf[h] >= 0) continue;
      edgeStart.push(put);
      for (let j = i; j < start[v + 1]; j++) {
        const g = byLow[j];
        if (edgeOf[g] < 0 && highV[g] === highV[h]) {
          edgeOf[g] = ne;
          edgeList[put++] = g;
        }
      }
      ne++;
    }
  edgeStart.push(put);
  const count = (e: number): number => edgeStart[e + 1] - edgeStart[e];
  /** Does half-edge h run from its edge's lower vertex to its higher one? */
  const rising = (h: number): boolean => tris[h] === lowV[h];

  // 3. Facets turned to agree with their neighbours across two-facet edges; each closed
  //    piece that encloses negative volume is turned over (it was inside out).
  const flip = new Int8Array(nt);
  const piece = new Int32Array(nt).fill(-1);
  let pieces = 0, disagree = 0;
  const stack: number[] = [];
  for (let s = 0; s < nt; s++) {
    if (piece[s] >= 0) continue;
    const id = pieces++;
    piece[s] = id;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop()!;
      for (let c = 0; c < 3; c++) {
        const h = 3 * t + c, e = edgeOf[h];
        if (count(e) !== 2) continue;
        const g = edgeList[edgeStart[e]] === h ? edgeList[edgeStart[e] + 1] : edgeList[edgeStart[e]];
        const u = (g / 3) | 0;
        // Agreeing neighbours run a shared edge in opposite directions.
        const want = rising(h) !== rising(g) ? flip[t] : 1 - flip[t];
        if (piece[u] < 0) {
          piece[u] = id;
          flip[u] = want;
          stack.push(u);
        } else if (flip[u] !== want) disagree++;
      }
    }
  }
  const closed = new Uint8Array(pieces).fill(1);
  for (let e = 0; e < ne; e++) if (count(e) !== 2) closed[piece[(edgeList[edgeStart[e]] / 3) | 0]] = 0;
  const vol = new Float64Array(pieces);
  const triVol = (a: number, b: number, c: number): number =>
    P(a, 0) * (P(b, 1) * P(c, 2) - P(b, 2) * P(c, 1)) - P(a, 1) * (P(b, 0) * P(c, 2) - P(b, 2) * P(c, 0)) + P(a, 2) * (P(b, 0) * P(c, 1) - P(b, 1) * P(c, 0));
  for (let t = 0; t < nt; t++) {
    const v = triVol(tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]);
    vol[piece[t]] += flip[t] ? -v : v;
  }
  let turned = 0;
  for (let t = 0; t < nt; t++) {
    const over = closed[piece[t]] === 1 && vol[piece[t]] < 0;
    if ((flip[t] === 1) !== over) {
      turned++;
      const b = tris[3 * t + 1];
      tris[3 * t + 1] = tris[3 * t + 2];
      tris[3 * t + 2] = b;
    }
  }
  // Turning a facet swaps its corners 1 and 2: its sides are now (0,2), (2,1), (1,0) —
  // the same edges, so edgeOf is looked up by vertex pair below, not by side.

  // 4. Facet normals from the winding (length = twice the area: an area-weighted sum).
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++)
    for (let k = 0; k < 3; k++) {
      const v = pos[3 * i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(diag > 0)) return { ok: false, reason: "it has no size" };
  const fn = new Float64Array(3 * nt); // raw (area-weighted)
  const un = new Float64Array(3 * nt); // unit, or 0 for a sliver
  let flat = 0;
  for (let t = 0; t < nt; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2);
    const vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l <= diag * diag * 1e-14) {
      flat++; // a sliver with no area: kept (it joins its neighbours) but has no direction
      continue;
    }
    fn[3 * t] = nx;
    fn[3 * t + 1] = ny;
    fn[3 * t + 2] = nz;
    un[3 * t] = nx / l;
    un[3 * t + 1] = ny / l;
    un[3 * t + 2] = nz / l;
  }

  // 5. Edges: open (one facet), shared by more than two, or a crease. A smooth edge joins
  //    the corners on either side, so their normals are averaged.
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const parent = new Int32Array(3 * nt);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (i: number, j: number): void => {
    const a = find(i), b = find(j);
    if (a !== b) parent[a] = b;
  };
  const corner = (t: number, v: number): number => 3 * t + (tris[3 * t] === v ? 0 : tris[3 * t + 1] === v ? 1 : 2);
  const edges: number[] = [];
  let open = 0, many = 0;
  for (let e = 0; e < ne; e++) {
    const h0 = edgeList[edgeStart[e]];
    const a = lowV[h0], b = highV[h0];
    const n = count(e);
    if (n !== 2) {
      edges.push(a, b);
      if (n === 1) open++;
      else many++;
      continue;
    }
    const t1 = (h0 / 3) | 0, t2 = (edgeList[edgeStart[e] + 1] / 3) | 0;
    const cos = un[3 * t1] * un[3 * t2] + un[3 * t1 + 1] * un[3 * t2 + 1] + un[3 * t1 + 2] * un[3 * t2 + 2];
    const sliver = (un[3 * t1] === 0 && un[3 * t1 + 1] === 0 && un[3 * t1 + 2] === 0) || (un[3 * t2] === 0 && un[3 * t2 + 1] === 0 && un[3 * t2 + 2] === 0);
    if (!sliver && cos < cosCrease) {
      edges.push(a, b);
      continue;
    }
    join(corner(t1, a), corner(t2, a));
    join(corner(t1, b), corner(t2, b));
  }

  // 6. Corner normals: each group of joined corners shares the area-weighted mean; a facet
  //    inside a flat face carries exactly its own normal (no outline is found inside it).
  const sum = new Float64Array(9 * nt);
  for (let i = 0; i < 3 * nt; i++) {
    const r = find(i), t = (i / 3) | 0;
    sum[3 * r] += fn[3 * t];
    sum[3 * r + 1] += fn[3 * t + 1];
    sum[3 * r + 2] += fn[3 * t + 2];
  }
  const cornerNormals: number[] = new Array(9 * nt);
  for (let t = 0; t < nt; t++) {
    let planar = true;
    for (let c = 0; c < 3; c++) {
      const r = find(3 * t + c);
      const l = Math.hypot(sum[3 * r], sum[3 * r + 1], sum[3 * r + 2]);
      for (let k = 0; k < 3; k++) {
        const v = l ? sum[3 * r + k] / l : un[3 * t + k];
        cornerNormals[9 * t + 3 * c + k] = v;
        if (Math.abs(v - un[3 * t + k]) > 1e-6) planar = false;
      }
    }
    if (planar) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) cornerNormals[9 * t + 3 * c + k] = un[3 * t + k];
  }
  // The chord error of the smooth regions: per side whose ends are smoothed, |(q − p)·(n_q − n_p)| / 8.
  let sag = 0;
  for (let t = 0; t < nt; t++)
    for (let c = 0; c < 3; c++) {
      const d = (c + 1) % 3;
      const a = tris[3 * t + c], b = tris[3 * t + d];
      let s = 0;
      for (let k = 0; k < 3; k++) s += (P(b, k) - P(a, k)) * (cornerNormals[9 * t + 3 * d + k] - cornerNormals[9 * t + 3 * c + k]);
      if (Math.abs(s) / 8 > sag) sag = Math.abs(s) / 8;
    }

  // 7. Moved so the lowest corner is at the origin.
  const positions: number[] = new Array(3 * nv);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) positions[3 * i + k] = pos[3 * i + k] - lo[k];

  const notes: string[] = [];
  const s = (n: number, one: string, many2: string): string => `${n0(n)} ${n === 1 ? one : many2}`;
  if (stl.unreadable) notes.push(`${s(stl.unreadable, "facet", "facets")} with a number that could not be read ${stl.unreadable === 1 ? "was" : "were"} left out.`);
  if (collapsed) notes.push(`${s(collapsed, "facet", "facets")} with two corners in one place ${collapsed === 1 ? "was" : "were"} left out.`);
  if (flat) notes.push(`${s(flat, "facet has", "facets have")} no area (kept, so the surface stays joined).`);
  if (open) notes.push(`${s(open, "edge is", "edges are")} open — the surface has gaps there, drawn as edges.`);
  if (many) notes.push(`${s(many, "edge is", "edges are")} shared by more than two facets (drawn as edges).`);
  if (disagree) notes.push(`${s(disagree, "pair", "pairs")} of facets could not be turned to agree (a one-sided surface).`);
  if (turned) notes.push(`${s(turned, "facet was", "facets were")} wound the wrong way and turned.`);
  return {
    ok: true,
    body: {
      mesh: { positions, triangles: Array.from(tris), cornerNormals, edges, sag },
      size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
      notes,
    },
  };
}
