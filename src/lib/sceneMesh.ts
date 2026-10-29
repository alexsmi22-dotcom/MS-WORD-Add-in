// Scene modelling & pipeline: polygon meshes. An OBJ-style reader (v and f lines, 1-based and negative-relative
// indices, or a 0-based list by choice), mesh statistics and validity (Euler characteristic and genus, boundary,
// non-manifold and inconsistently wound edges, orientability by propagation, surface area, signed volume by the
// divergence theorem, centroids, bounding box, face-type counts), and Catmull–Clark and Loop subdivision, both as
// count formulas over any number of levels and as a real implementation on small meshes that the formulas are
// checked against.
//
// Topology comes from homology.ts / topology2.ts's χ = V − E + F in the abstract; this is the same number read off a
// production mesh, with the defects that stop it being a surface named. Pure functions; glue in sceneCalcs.ts.

import type { Vec } from "./sceneCurves";

export interface Fail {
  ok: false;
  error: string;
}

/** Input caps: a pasted OBJ is a test object, not a production asset. */
export const MESH_MAX_VERTICES = 20000;
export const MESH_MAX_FACES = 20000;
/** The real subdivision runs while the next level stays at or below this many faces; beyond, counts only. */
export const SUBDIV_REAL_MAX_FACES = 30000;

/** OBJ statements that do not change the polygon mesh: read past, counted, and named in the result. */
const OBJ_SKIPPED = new Set([
  "vt", "vn", "vp", "o", "g", "s", "mg", "usemtl", "mtllib", "usemap", "maplib", "l", "p",
  "cstype", "deg", "bmat", "step", "curv", "curv2", "surf", "parm", "trim", "hole", "scrv", "sp", "end", "con",
  "bevel", "c_interp", "d_interp", "lod", "shadow_obj", "trace_obj", "ctech", "stech", "call", "csh",
]);

export interface Mesh {
  V: Vec[];
  F: number[][];
  /** Notes on lines read but not used (vt, vn, groups, materials, polylines). */
  ignored: string[];
}

/**
 * Read an OBJ-style block. `base` "obj": indices are 1-based and a negative index counts back from the last vertex
 * defined so far (the OBJ rule); "zero": indices are 0-based (a list from code), negatives refused.
 */
export function parseObj(text: string, base: "obj" | "zero"): Mesh | Fail {
  const V: Vec[] = [];
  const F: number[][] = [];
  const faceLine: number[] = [];
  const ignoredKinds = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  // A trailing backslash continues the statement on the next line (the OBJ spec; review M6). The joined statement is
  // read on the last of its lines, so line numbers in messages still point into the text as typed.
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/\\\s*$/.test(lines[i])) {
      lines[i + 1] = lines[i].replace(/\\\s*$/, " ") + lines[i + 1];
      lines[i] = "";
    }
  }
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].replace(/#.*$/, "").trim();
    if (!raw) continue;
    const parts = raw.split(/\s+/);
    const kw = parts[0];
    if (kw === "v") {
      if (V.length >= MESH_MAX_VERTICES) return { ok: false, error: `More than ${MESH_MAX_VERTICES.toLocaleString("en-US")} vertices: the cap for a pasted mesh. Decimate it, or use the V, E, F counts form.` };
      const c = parts.slice(1, 4).map((s) => Number(s.replace(/[−–]/g, "-")));
      if (c.length < 3 || c.some((x) => !Number.isFinite(x))) return { ok: false, error: `Line ${li + 1}: "${raw}" is not a vertex (write v x y z).` };
      if (c.some((x) => Math.abs(x) > 1e100)) return { ok: false, error: `Line ${li + 1}: a coordinate is beyond 10¹⁰⁰; rescale the model.` };
      V.push(c);
    } else if (kw === "f") {
      if (F.length >= MESH_MAX_FACES) return { ok: false, error: `More than ${MESH_MAX_FACES.toLocaleString("en-US")} faces: the cap for a pasted mesh. Decimate it, or use the V, E, F counts form.` };
      const idx: number[] = [];
      for (const tok of parts.slice(1)) {
        const s = tok.split("/")[0].replace(/[−–]/g, "-");
        if (!/^[-+]?\d+$/.test(s)) return { ok: false, error: `Line ${li + 1}: "${tok}" is not a vertex index.` };
        const k = Number(s);
        let i: number;
        if (base === "obj") {
          if (k === 0) return { ok: false, error: `Line ${li + 1}: index 0. OBJ indices are 1-based (the first vertex is 1), so this list looks 0-based: choose "0-based list" as the index base, or add 1 to every index.` };
          i = k > 0 ? k - 1 : V.length + k;
          if (k < 0 && i < 0) return { ok: false, error: `Line ${li + 1}: the relative index ${k} reaches back past the first vertex (only ${V.length} defined above it).` };
        } else {
          if (k < 0) return { ok: false, error: `Line ${li + 1}: index ${k} is negative; a 0-based list has none (negative indices are an OBJ feature: choose the OBJ index base).` };
          i = k;
        }
        idx.push(i);
      }
      if (idx.length < 3) return { ok: false, error: `Line ${li + 1}: a face needs at least 3 vertices; this one has ${idx.length}.` };
      F.push(idx);
      faceLine.push(li + 1);
    } else if (OBJ_SKIPPED.has(kw)) {
      // Texture and normal data, grouping, materials, display attributes and free-form (curve and surface) statements:
      // none changes the polygon mesh, so each is counted and named in the result rather than refused (review M6: mg).
      ignoredKinds.set(kw, (ignoredKinds.get(kw) ?? 0) + 1);
    } else {
      return { ok: false, error: `Line ${li + 1}: "${kw}" is not an OBJ keyword (v and f are read; vt, vn, o, g, s, mg, usemtl, mtllib, l, p and the free-form statements are skipped).` };
    }
  }
  // Range checks after all vertices are known (OBJ allows a face before a later vertex only by negative index).
  for (let fi = 0; fi < F.length; fi++) {
    const f = F[fi];
    for (const i of f) {
      if (i >= V.length) {
        const shown = base === "obj" ? i + 1 : i;
        return { ok: false, error: `Line ${faceLine[fi]}: index ${shown} is out of range; there are ${V.length} vertices (${base === "obj" ? `1 to ${V.length}` : `0 to ${V.length - 1}`}).` };
      }
    }
    if (new Set(f).size !== f.length) return { ok: false, error: `Line ${faceLine[fi]}: the face uses one vertex twice (${f.map((i) => (base === "obj" ? i + 1 : i)).join(" ")}); a degenerate face has no area or orientation.` };
  }
  if (V.length === 0) return { ok: false, error: "No vertices: write one v x y z line per vertex, then f lines." };
  if (F.length === 0) return { ok: false, error: "No faces: write f lines that index the vertices (f 1 2 3)." };
  const ignored = [...ignoredKinds].map(([k, n]) => `${n} ${k} line${n === 1 ? "" : "s"}`);
  return { V, F, ignored };
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotV = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lenV = (a: Vec): number => Math.sqrt(dotV(a, a));

/** Undirected edge key. */
const ekey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

export interface EdgeInfo {
  a: number;
  b: number;
  /** Faces using the edge, each with the direction it traverses it (true: a→b). */
  uses: Array<{ face: number; forward: boolean }>;
}

export function edgeMap(F: number[][]): Map<string, EdgeInfo> {
  const m = new Map<string, EdgeInfo>();
  F.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const u = f[i];
      const v = f[(i + 1) % f.length];
      const k = ekey(u, v);
      let e = m.get(k);
      if (!e) {
        e = { a: Math.min(u, v), b: Math.max(u, v), uses: [] };
        m.set(k, e);
      }
      e.uses.push({ face: fi, forward: u === e.a });
    }
  });
  return m;
}

export interface MeshStats {
  ok: true;
  vertices: number;
  referenced: number;
  isolated: number;
  edges: number;
  faces: number;
  tris: number;
  quads: number;
  ngons: number;
  /** Triangles after fan triangulation: Σ (k − 2). */
  triangulated: number;
  /** Σ of face valences (corners). */
  corners: number;
  chi: number;
  components: number;
  boundaryEdges: Array<[number, number]>;
  nonManifoldEdges: Array<[number, number]>;
  /** Interior edges both of whose faces traverse it in the same direction. */
  inconsistentEdges: Array<[number, number]>;
  /** Boundary loops (closed chains of boundary edges), when the boundary is manifold. */
  boundaryLoops: number;
  closed: boolean;
  /** Whether the faces can be oriented consistently (by flipping some): null when non-manifold edges stop the test. */
  orientable: boolean | null;
  /** Faces that would need flipping to make the winding consistent (from the propagation). */
  flipsNeeded: number;
  /** Genus of a closed orientable surface: (2c − χ)/2 summed over components. Null otherwise. */
  genus: number | null;
  area: number;
  /** Signed volume by the divergence theorem (fan triangles against the origin). Meaningful only when closed and consistent. */
  volume: number;
  /** Volume centroid (only meaningful when closed and consistent and the volume is non-zero). */
  volumeCentroid: Vec | null;
  /** Area-weighted surface centroid. */
  surfaceCentroid: Vec;
  bmin: Vec;
  bmax: Vec;
  /** Faces whose corners are not coplanar (an n-gon whose fan triangulation is a choice). */
  nonPlanar: number;
  zeroAreaFaces: number;
  /** Boundary vertices where two holes touch (boundary degree above 2). */
  pinchVertices: number[];
  /** Signed volume of each connected piece. */
  pieceVolumes: number[];
  /** Pieces with a negative volume that are not nested in a positive piece: inside-out. */
  invertedPieces: number;
}

/** Statistics and validity of a polygon mesh. */
export function meshStats(mesh: Mesh): MeshStats {
  const { V, F } = mesh;
  const used = new Set<number>();
  for (const f of F) for (const i of f) used.add(i);
  const E = edgeMap(F);
  const boundaryEdges: Array<[number, number]> = [];
  const nonManifoldEdges: Array<[number, number]> = [];
  const inconsistentEdges: Array<[number, number]> = [];
  for (const e of E.values()) {
    if (e.uses.length === 1) boundaryEdges.push([e.a, e.b]);
    else if (e.uses.length > 2) nonManifoldEdges.push([e.a, e.b]);
    else if (e.uses[0].forward === e.uses[1].forward) inconsistentEdges.push([e.a, e.b]);
  }
  // Components over faces sharing an edge or a vertex (union–find on vertices).
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    let y = x;
    while (parent.get(y) !== r) {
      const nx = parent.get(y) as number;
      parent.set(y, r);
      y = nx;
    }
    return r;
  };
  for (const i of used) parent.set(i, i);
  for (const f of F) for (let i = 1; i < f.length; i++) {
    const a = find(f[0]);
    const b = find(f[i]);
    if (a !== b) parent.set(a, b);
  }
  const components = new Set([...used].map(find)).size;
  // Orientation propagation across manifold edges: BFS assigning each face a flip bit so that every shared edge is
  // traversed in opposite directions; a conflict means no consistent orientation exists (non-orientable).
  let orientable: boolean | null = nonManifoldEdges.length ? null : true;
  let flipsNeeded = 0;
  if (orientable) {
    const adj: Array<Array<{ g: number; same: boolean }>> = F.map(() => []);
    for (const e of E.values()) {
      if (e.uses.length !== 2) continue;
      const [x, y] = e.uses;
      const same = x.forward === y.forward;
      adj[x.face].push({ g: y.face, same });
      adj[y.face].push({ g: x.face, same });
    }
    const flip = new Array<number>(F.length).fill(-1);
    for (let s = 0; s < F.length && orientable; s++) {
      if (flip[s] !== -1) continue;
      flip[s] = 0;
      const queue = [s];
      let compFlips = 0;
      let compSize = 0;
      while (queue.length && orientable) {
        const fi = queue.pop() as number;
        compSize++;
        if (flip[fi] === 1) compFlips++;
        for (const { g, same } of adj[fi]) {
          const want = same ? 1 - flip[fi] : flip[fi];
          if (flip[g] === -1) {
            flip[g] = want;
            queue.push(g);
          } else if (flip[g] !== want) orientable = false;
        }
      }
      flipsNeeded += Math.min(compFlips, compSize - compFlips);
    }
    if (!orientable) flipsNeeded = 0;
  }
  // Boundary loops (review B8, B9). A boundary vertex of boundary degree 2 joins its two boundary edges into one loop.
  // A vertex of boundary degree above 2 is a PINCH (holes touching at one point): there the edges are joined across
  // each angular gap with no face in it, found by sorting the vertex's neighbours by angle about its normal, so holes
  // that only touch stay separate. Loops are the classes of a union–find over boundary edges. Adjacency lists are
  // pushed onto, never re-spread (re-spreading was quadratic: 8.8 s on a 20,000-face fan).
  let boundaryLoops = 0;
  const pinchVertices: number[] = [];
  if (boundaryEdges.length) {
    const bIndex = new Map<string, number>();
    boundaryEdges.forEach(([a, b], i) => bIndex.set(ekey(a, b), i));
    const up = boundaryEdges.map((_, i) => i);
    const root = (x: number): number => {
      while (up[x] !== x) x = up[x] = up[up[x]];
      return x;
    };
    const join = (x: number, y: number): void => {
      const rx = root(x);
      const ry = root(y);
      if (rx !== ry) up[rx] = ry;
    };
    const nb = new Map<number, number[]>();
    for (const [a, b] of boundaryEdges) {
      let la = nb.get(a);
      if (!la) nb.set(a, (la = []));
      la.push(b);
      let lb = nb.get(b);
      if (!lb) nb.set(b, (lb = []));
      lb.push(a);
    }
    for (const [v, l] of nb) {
      if (l.length === 2) join(bIndex.get(ekey(v, l[0])) as number, bIndex.get(ekey(v, l[1])) as number);
      else if (l.length > 2) pinchVertices.push(v);
    }
    if (pinchVertices.length) {
      const pinch = new Set(pinchVertices);
      const fans = new Map<number, number[]>(); // faces at each pinch vertex
      F.forEach((f, fi) => {
        for (const v of f) if (pinch.has(v)) {
          let l = fans.get(v);
          if (!l) fans.set(v, (l = []));
          l.push(fi);
        }
      });
      for (const v of pinchVertices) {
        const P0 = V[v];
        const facePairs = new Set<string>();
        const nbrs = new Set<number>();
        const n = [0, 0, 0];
        for (const fi of fans.get(v) ?? []) {
          const f = F[fi];
          const i = f.indexOf(v);
          const prev = f[(i + f.length - 1) % f.length];
          const next = f[(i + 1) % f.length];
          facePairs.add(ekey(prev, next));
          nbrs.add(prev);
          nbrs.add(next);
          const c = crossV(sub(V[next], P0), sub(V[prev], P0));
          const cl = lenV(c) || 1;
          for (let j = 0; j < 3; j++) n[j] += c[j] / cl;
        }
        // A basis perpendicular to the mean normal (any, if the normals cancel).
        const nl = lenV(n);
        const nn = nl > 0 ? n.map((x) => x / nl) : [0, 0, 1];
        const helper = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const t1 = crossV(nn, helper);
        const t1l = lenV(t1);
        const e1 = t1.map((x) => x / t1l);
        const e2 = crossV(nn, e1);
        const ring = [...nbrs].map((w) => {
          const d = sub(V[w], P0);
          return { w, ang: Math.atan2(dotV(d, e2), dotV(d, e1)) };
        }).sort((x, y) => x.ang - y.ang);
        for (let k = 0; k < ring.length; k++) {
          const wa = ring[k].w;
          const wb = ring[(k + 1) % ring.length].w;
          if (facePairs.has(ekey(wa, wb))) continue; // a face fills this gap
          const ia = bIndex.get(ekey(v, wa));
          const ib = bIndex.get(ekey(v, wb));
          if (ia !== undefined && ib !== undefined) join(ia, ib);
        }
      }
    }
    const roots = new Set<number>();
    for (let i = 0; i < boundaryEdges.length; i++) roots.add(root(i));
    boundaryLoops = roots.size;
  }
  const closed = boundaryEdges.length === 0 && nonManifoldEdges.length === 0;
  const chi = used.size - E.size + F.length;
  const genus = closed && orientable && (2 * components - chi) % 2 === 0 && 2 * components - chi >= 0 ? (2 * components - chi) / 2 : null;
  // Geometry by fan triangulation.
  let area = 0;
  let volume = 0;
  const pieceVolume = new Map<number, number>();
  const vc = [0, 0, 0];
  const sc = [0, 0, 0];
  let nonPlanar = 0;
  let zeroAreaFaces = 0;
  let tris = 0;
  let quads = 0;
  let ngons = 0;
  let triangulated = 0;
  let corners = 0;
  for (const f of F) {
    const k = f.length;
    const piece = find(f[0]);
    corners += k;
    if (k === 3) tris++;
    else if (k === 4) quads++;
    else ngons++;
    triangulated += k - 2;
    let fa = 0;
    const p0 = V[f[0]];
    const nrm = [0, 0, 0];
    for (let i = 1; i + 1 < k; i++) {
      const p1 = V[f[i]];
      const p2 = V[f[i + 1]];
      const c = crossV(sub(p1, p0), sub(p2, p0));
      const a = lenV(c) / 2;
      fa += a;
      nrm[0] += c[0];
      nrm[1] += c[1];
      nrm[2] += c[2];
      const cen = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
      for (let j = 0; j < 3; j++) sc[j] += a * cen[j];
      const v6 = dotV(p0, crossV(p1, p2));
      volume += v6 / 6;
      pieceVolume.set(piece, (pieceVolume.get(piece) ?? 0) + v6 / 6);
      for (let j = 0; j < 3; j++) vc[j] += (v6 / 6) * ((p0[j] + p1[j] + p2[j]) / 4);
    }
    area += fa;
    if (fa === 0) zeroAreaFaces++;
    if (k > 3) {
      const nl = lenV(nrm);
      const ext = Math.max(...f.map((i) => lenV(sub(V[i], p0))));
      if (nl > 0 && f.some((i) => Math.abs(dotV(sub(V[i], p0), nrm)) / nl > 1e-9 * Math.max(ext, 1e-300))) nonPlanar++;
    }
  }
  const usedV = [...used].map((i) => V[i]);
  const bmin = [0, 1, 2].map((j) => Math.min(...usedV.map((v) => v[j])));
  const bmax = [0, 1, 2].map((j) => Math.max(...usedV.map((v) => v[j])));
  const diag = lenV(sub(bmax, bmin));
  const volumeCentroid = Math.abs(volume) > 1e-12 * Math.pow(Math.max(diag, 1e-300), 3) ? vc.map((x) => x / volume) : null;
  const surfaceCentroid = area > 0 ? sc.map((x) => x / area) : usedV[0].slice();
  // Pieces with a negative signed volume are inside-out, unless nested inside a positive piece (a cavity, correctly
  // wound inward). A disjoint inverted piece otherwise cancels part of the total silently.
  const pieceBox = new Map<number, [Vec, Vec]>();
  for (const i of used) {
    const r = find(i);
    const v = V[i];
    const bx = pieceBox.get(r);
    if (!bx) pieceBox.set(r, [v.slice(), v.slice()]);
    else for (let j = 0; j < 3; j++) {
      if (v[j] < bx[0][j]) bx[0][j] = v[j];
      if (v[j] > bx[1][j]) bx[1][j] = v[j];
    }
  }
  const volTol = 1e-12 * Math.pow(Math.max(diag, 1e-300), 3);
  const pieces = [...pieceVolume].map(([r, vol]) => ({ volume: vol, box: pieceBox.get(r) as [Vec, Vec] }));
  const inside = (a: [Vec, Vec], b: [Vec, Vec]): boolean => [0, 1, 2].every((j) => a[0][j] >= b[0][j] && a[1][j] <= b[1][j]);
  const invertedPieces = pieces.filter((pc) => pc.volume < -volTol && !pieces.some((q) => q !== pc && q.volume > volTol && inside(pc.box, q.box))).length;
  return {
    ok: true,
    vertices: V.length,
    referenced: used.size,
    isolated: V.length - used.size,
    edges: E.size,
    faces: F.length,
    tris,
    quads,
    ngons,
    triangulated,
    corners,
    chi,
    components,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentEdges,
    boundaryLoops,
    closed,
    orientable,
    flipsNeeded,
    genus,
    area,
    volume,
    volumeCentroid,
    surfaceCentroid,
    bmin,
    bmax,
    nonPlanar,
    zeroAreaFaces,
    pinchVertices,
    pieceVolumes: pieces.map((pc) => pc.volume),
    invertedPieces,
  };
}

/** χ and genus from counts alone (a closed orientable surface of one component is assumed for the genus). */
export function eulerFromCounts(V: number, E: number, F: number, components: number): { chi: number; genus: number | null; note: string | null } {
  const chi = V - E + F;
  const g2 = 2 * components - chi;
  if (g2 < 0) return { chi, genus: null, note: `χ = ${chi} is above 2 per component (${2 * components}): these counts cannot be a closed orientable surface (several pieces, or isolated vertices, raise χ).` };
  if (g2 % 2 !== 0) return { chi, genus: null, note: `2c − χ = ${g2} is odd: a closed orientable surface always has an even 2c − χ, so these counts are an open surface (with boundary), a non-orientable one, or miscounted.` };
  return { chi, genus: g2 / 2, note: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Subdivision
// ---------------------------------------------------------------------------------------------------------------

export interface LevelCounts {
  level: number;
  V: number;
  E: number;
  F: number;
  /** Triangles to draw it (fan triangulation: Σ (k − 2)). */
  T: number;
}

/**
 * Catmull–Clark counts over `levels` levels from V, E, F and Σ face valences: V′ = V + E + F, E′ = 2E + Σk,
 * F′ = Σk (every face becomes k quads), then all quads: V′ = V + E + F, E′ = 2E + 4F, F′ = 4F. Exact integers
 * (BigInt) so deep levels do not round.
 */
export function catmullClarkCounts(V0: number, E0: number, F0: number, corners0: number, tris0: number, levels: number): Array<{ level: number; V: bigint; E: bigint; F: bigint; T: bigint }> {
  let V = BigInt(V0);
  let E = BigInt(E0);
  let F = BigInt(F0);
  const out = [{ level: 0, V, E, F, T: BigInt(tris0) }];
  for (let l = 1; l <= levels; l++) {
    const k = l === 1 ? BigInt(corners0) : 4n * F;
    const nV = V + E + F;
    const nE = 2n * E + k;
    const nF = k;
    V = nV;
    E = nE;
    F = nF;
    out.push({ level: l, V, E, F, T: 2n * F });
  }
  return out;
}

/** Loop counts (triangle meshes): V′ = V + E, E′ = 2E + 3F, F′ = 4F. */
export function loopCounts(V0: number, E0: number, F0: number, levels: number): Array<{ level: number; V: bigint; E: bigint; F: bigint; T: bigint }> {
  let V = BigInt(V0);
  let E = BigInt(E0);
  let F = BigInt(F0);
  const out = [{ level: 0, V, E, F, T: F }];
  for (let l = 1; l <= levels; l++) {
    const nV = V + E;
    const nE = 2n * E + 3n * F;
    F = 4n * F;
    V = nV;
    E = nE;
    out.push({ level: l, V, E, F, T: F });
  }
  return out;
}

const avg = (pts: Vec[]): Vec => {
  const s = [0, 0, 0];
  for (const p of pts) for (let j = 0; j < 3; j++) s[j] += p[j];
  return s.map((x) => x / pts.length);
};
const comb = (terms: Array<[number, Vec]>): Vec => {
  const s = [0, 0, 0];
  for (const [w, p] of terms) for (let j = 0; j < 3; j++) s[j] += w * p[j];
  return s;
};

/**
 * One level of Catmull–Clark on a polygon mesh (any face valence). Interior rule V′ = (Q + 2R + (n − 3)P)/n;
 * on an open mesh the boundary is a cubic B-spline crease (edge point = midpoint, vertex = (P₋ + 6P + P₊)/8).
 * Requires a manifold mesh (no edge on three faces).
 */
export function catmullClarkStep(mesh: { V: Vec[]; F: number[][] }): { V: Vec[]; F: number[][] } {
  const { V, F } = mesh;
  const E = edgeMap(F);
  const facePt = F.map((f) => avg(f.map((i) => V[i])));
  const edgeIndex = new Map<string, number>();
  const newV: Vec[] = [];
  // Vertex points first (same indices as the old vertices), then edge points, then face points.
  const vFaces: number[][] = V.map(() => []);
  F.forEach((f, fi) => f.forEach((i) => vFaces[i].push(fi)));
  const vEdges: string[][] = V.map(() => []);
  for (const [k, e] of E) {
    vEdges[e.a].push(k);
    vEdges[e.b].push(k);
  }
  const isBoundary = (k: string): boolean => (E.get(k) as EdgeInfo).uses.length === 1;
  for (let i = 0; i < V.length; i++) {
    const P = V[i];
    const be = vEdges[i].filter(isBoundary);
    if (vFaces[i].length === 0) newV.push(P.slice());
    else if (be.length >= 2) {
      const nbrs = be.slice(0, 2).map((k) => {
        const e = E.get(k) as EdgeInfo;
        return V[e.a === i ? e.b : e.a];
      });
      newV.push(comb([[1 / 8, nbrs[0]], [6 / 8, P], [1 / 8, nbrs[1]]]));
    } else {
      const n = vFaces[i].length;
      const Q = avg(vFaces[i].map((fi) => facePt[fi]));
      const R = avg(vEdges[i].map((k) => {
        const e = E.get(k) as EdgeInfo;
        return avg([V[e.a], V[e.b]]);
      }));
      newV.push(comb([[1 / n, Q], [2 / n, R], [(n - 3) / n, P]]));
    }
  }
  for (const [k, e] of E) {
    edgeIndex.set(k, newV.length);
    if (e.uses.length === 1) newV.push(avg([V[e.a], V[e.b]]));
    else newV.push(avg([V[e.a], V[e.b], ...e.uses.map((u) => facePt[u.face])]));
  }
  const faceBase = newV.length;
  for (const p of facePt) newV.push(p);
  const newF: number[][] = [];
  F.forEach((f, fi) => {
    const k = f.length;
    for (let j = 0; j < k; j++) {
      const prev = f[(j + k - 1) % k];
      const cur = f[j];
      const next = f[(j + 1) % k];
      newF.push([cur, edgeIndex.get(ekey(cur, next)) as number, faceBase + fi, edgeIndex.get(ekey(prev, cur)) as number]);
    }
  });
  return { V: newV, F: newF };
}

/**
 * One level of Loop subdivision on a triangle mesh. Interior vertex: (1 − nβ)P + β ΣQ with Warren's β = 3/(8n)
 * (3/16 at n = 3); interior edge point 3/8 (A + B) + 1/8 (C + D); boundary as a cubic B-spline crease.
 */
export function loopStep(mesh: { V: Vec[]; F: number[][] }): { V: Vec[]; F: number[][] } {
  const { V, F } = mesh;
  const E = edgeMap(F);
  const nbr: Array<Set<number>> = V.map(() => new Set());
  for (const e of E.values()) {
    nbr[e.a].add(e.b);
    nbr[e.b].add(e.a);
  }
  const bnd: number[][] = V.map(() => []);
  for (const e of E.values()) if (e.uses.length === 1) {
    bnd[e.a].push(e.b);
    bnd[e.b].push(e.a);
  }
  const newV: Vec[] = V.map((P, i) => {
    if (bnd[i].length >= 2) return comb([[1 / 8, V[bnd[i][0]]], [6 / 8, P], [1 / 8, V[bnd[i][1]]]]);
    const n = nbr[i].size;
    if (n === 0) return P.slice();
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
    return comb([[1 - n * beta, P], ...[...nbr[i]].map((j): [number, Vec] => [beta, V[j]])]);
  });
  const edgeIndex = new Map<string, number>();
  for (const [k, e] of E) {
    edgeIndex.set(k, newV.length);
    if (e.uses.length !== 2) newV.push(avg([V[e.a], V[e.b]]));
    else {
      const opp = e.uses.map((u) => F[u.face].find((i) => i !== e.a && i !== e.b) as number);
      newV.push(comb([[3 / 8, V[e.a]], [3 / 8, V[e.b]], [1 / 8, V[opp[0]]], [1 / 8, V[opp[1]]]]));
    }
  }
  const newF: number[][] = [];
  for (const [a, b, c] of F) {
    const ab = edgeIndex.get(ekey(a, b)) as number;
    const bc = edgeIndex.get(ekey(b, c)) as number;
    const ca = edgeIndex.get(ekey(c, a)) as number;
    newF.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { V: newV, F: newF };
}

/** Counted V, E, F of a mesh (referenced vertices only). */
export function countVEF(mesh: { V: Vec[]; F: number[][] }): { V: number; E: number; F: number } {
  const used = new Set<number>();
  for (const f of mesh.F) for (const i of f) used.add(i);
  return { V: used.size, E: edgeMap(mesh.F).size, F: mesh.F.length };
}
