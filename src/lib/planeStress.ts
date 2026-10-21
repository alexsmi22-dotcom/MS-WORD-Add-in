// Plane-stress finite elements (gap item 5, docs/SCOPE-ENGINEERING-2026-10.md): a rectangular plate of thickness t,
// meshed into constant-strain triangles (each grid cell split in two), with edge supports, edge tractions or pressure
// and point loads; displacements, element stresses and the von Mises field out. The constant-strain triangle passes
// the patch test exactly (uniform stress is reproduced to rounding) and converges under refinement; it is stiff in
// bending, so a coarse mesh under-predicts bending deflection — the result says so, and how fine the mesh was.
//
// Units are the user's, consistently (N, mm, MPa …). Pure: no Office.js.

export type Edge = "left" | "right" | "top" | "bottom";

export interface PlateModel {
  W: number;
  H: number;
  t: number;
  E: number;
  nu: number;
  nx: number;
  ny: number;
  /** Edge supports: which displacement components each edge holds. */
  supports: Array<{ edge: Edge; ux: boolean; uy: boolean }>;
  /** Uniform edge tractions (force per unit area of the edge face): tx, ty. */
  tractions: Array<{ edge: Edge; tx: number; ty: number }>;
  /** Point loads at the nearest mesh node. */
  points: Array<{ x: number; y: number; Fx: number; Fy: number }>;
}

export interface PlateResult {
  ok: true;
  model: PlateModel;
  nodes: Array<[number, number]>;
  tris: Array<[number, number, number]>;
  disp: Array<[number, number]>;
  /** Per element: [σx, σy, τxy, von Mises]. */
  stress: Array<[number, number, number, number]>;
  maxVM: { value: number; x: number; y: number };
  maxDisp: { value: number; x: number; y: number };
  /** Sum of reactions, which must balance the applied loads. */
  reaction: [number, number];
  notes: string[];
}

export const MAX_ELEMENTS = 8000;

/** Banded symmetric solver (Cholesky on the band): the mesh numbering keeps the bandwidth to about 2(ny+2). */
function solveBanded(K: Float64Array[], bw: number, F: Float64Array, fixed: Uint8Array): Float64Array | null {
  const n = F.length;
  // Fixed DOFs: row and column cleared, unit diagonal, zero right-hand side.
  const A = K.map((r) => Float64Array.from(r));
  const b = Float64Array.from(F);
  for (let i = 0; i < n; i++) {
    if (!fixed[i]) continue;
    for (let j = Math.max(0, i - bw); j <= Math.min(n - 1, i + bw); j++) {
      if (j === i) continue;
      setB(A, bw, i, j, 0);
    }
    setB(A, bw, i, i, 1);
    b[i] = 0;
  }
  // Cholesky factorisation in band storage (A[i][k] holds row i, column i−bw+k, lower band). A pivot that has
  // collapsed to rounding level against its own diagonal means a mechanism. Only rounding level: a slender plate's
  // bending pivots fall to 1e-9 of the diagonal and are real; the equilibrium check below catches what slips through.
  const L = A;
  const diag = Array.from({ length: n }, (_, i) => getB(A, bw, i, i));
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - bw); j <= i; j++) {
      let s = getB(L, bw, i, j);
      for (let k = Math.max(0, i - bw, j - bw); k < j; k++) s -= getB(L, bw, i, k) * getB(L, bw, j, k);
      if (i === j) {
        if (!(s > 1e-14 * diag[i])) return null;
        setB(L, bw, i, i, Math.sqrt(s));
      } else setB(L, bw, i, j, s / getB(L, bw, j, j));
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = Math.max(0, i - bw); k < i; k++) s -= getB(L, bw, i, k) * y[k];
    y[i] = s / getB(L, bw, i, i);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= getB(L, bw, k, i) * x[k];
    x[i] = s / getB(L, bw, i, i);
  }
  return x;
}
function getB(A: Float64Array[], bw: number, i: number, j: number): number {
  if (j > i) [i, j] = [j, i];
  const k = j - i + bw;
  return k < 0 ? 0 : A[i][k];
}
function setB(A: Float64Array[], bw: number, i: number, j: number, v: number): void {
  if (j > i) [i, j] = [j, i];
  const k = j - i + bw;
  if (k >= 0) A[i][k] = v;
}

export function analyzePlate(m: PlateModel): PlateResult | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!(m.W > 0 && m.H > 0 && m.t > 0 && Number.isFinite(m.W * m.H * m.t))) errors.push("Width, height and thickness must be finite numbers above zero.");
  if (!(m.E > 0 && Number.isFinite(m.E))) errors.push("E must be a finite number above zero.");
  if (!(m.nu > -1 && m.nu < 0.5)) errors.push("Poisson's ratio must be above −1 and below 0.5.");
  if (!(Number.isInteger(m.nx) && Number.isInteger(m.ny) && m.nx >= 1 && m.ny >= 1)) errors.push("The mesh needs whole numbers of divisions (at least 1 × 1).");
  if (2 * m.nx * m.ny > MAX_ELEMENTS) errors.push(`${2 * m.nx * m.ny} elements — at most ${MAX_ELEMENTS}; use a coarser mesh.`);
  if (!m.supports.length) errors.push("No supports: the plate would fly away. Hold an edge (e.g. “support left fixed”).");
  if (errors.length) return { ok: false, errors };
  const { W, H, t, E, nu, nx, ny } = m;
  // Nodes numbered across the shorter side first, so neighbouring nodes are close in number: bandwidth ≈ 2(min + 2),
  // and the solve costs about N·bw² — a tall mesh numbered the long way would freeze the pane.
  const nodes: Array<[number, number]> = [];
  const across = Math.min(nx, ny);
  const id = (i: number, j: number): number => (ny <= nx ? i * (ny + 1) + j : j * (nx + 1) + i);
  for (let k = 0; k < (nx + 1) * (ny + 1); k++) nodes.push([0, 0]);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) nodes[id(i, j)] = [(W * i) / nx, (H * j) / ny];
  const tris: Array<[number, number, number]> = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      // Alternate the diagonal so the mesh has no preferred direction.
      if ((i + j) % 2 === 0) tris.push([a, b, c], [a, c, d]);
      else tris.push([a, b, d], [b, c, d]);
    }
  const N = 2 * nodes.length;
  const bw = 2 * (across + 2) + 1;
  const K = Array.from({ length: N }, () => new Float64Array(bw + 1));
  const F = new Float64Array(N);
  const D0 = E / (1 - nu * nu);
  const D = [
    [D0, D0 * nu, 0],
    [D0 * nu, D0, 0],
    [0, 0, (D0 * (1 - nu)) / 2],
  ];
  const Bs: number[][][] = [];
  for (const [p, q, r] of tris) {
    const [x1, y1] = nodes[p], [x2, y2] = nodes[q], [x3, y3] = nodes[r];
    const A2 = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    const b1 = y2 - y3, b2 = y3 - y1, b3 = y1 - y2, c1 = x3 - x2, c2 = x1 - x3, c3 = x2 - x1;
    const B = [
      [b1, 0, b2, 0, b3, 0],
      [0, c1, 0, c2, 0, c3],
      [c1, b1, c2, b2, c3, b3],
    ].map((row) => row.map((v) => v / A2));
    Bs.push(B);
    const DB = D.map((row) => [0, 1, 2, 3, 4, 5].map((c) => row[0] * B[0][c] + row[1] * B[1][c] + row[2] * B[2][c]));
    const dofs = [2 * p, 2 * p + 1, 2 * q, 2 * q + 1, 2 * r, 2 * r + 1];
    const vol = (t * Math.abs(A2)) / 2;
    for (let a = 0; a < 6; a++)
      for (let c = 0; c <= a; c++) {
        const kac = vol * (B[0][a] * DB[0][c] + B[1][a] * DB[1][c] + B[2][a] * DB[2][c]);
        // The lower triangle in band storage; (a, c) and (c, a) are the same entry, added once.
        const [i, j] = dofs[a] >= dofs[c] ? [dofs[a], dofs[c]] : [dofs[c], dofs[a]];
        K[i][j - i + bw] += kac;
      }
  }
  const edgeNodes = (e: Edge): number[] => {
    const out: number[] = [];
    if (e === "left") for (let j = 0; j <= ny; j++) out.push(id(0, j));
    if (e === "right") for (let j = 0; j <= ny; j++) out.push(id(nx, j));
    if (e === "bottom") for (let i = 0; i <= nx; i++) out.push(id(i, 0));
    if (e === "top") for (let i = 0; i <= nx; i++) out.push(id(i, ny));
    return out;
  };
  // Tractions: consistent nodal loads (each edge segment's force shared equally by its two nodes).
  for (const tr of m.tractions) {
    const ns = edgeNodes(tr.edge);
    for (let k = 0; k + 1 < ns.length; k++) {
      const [xa, ya] = nodes[ns[k]], [xb, yb] = nodes[ns[k + 1]];
      const len = Math.hypot(xb - xa, yb - ya);
      for (const nn of [ns[k], ns[k + 1]]) {
        F[2 * nn] += (tr.tx * t * len) / 2;
        F[2 * nn + 1] += (tr.ty * t * len) / 2;
      }
    }
  }
  const notes: string[] = [];
  for (const pl of m.points) {
    let best = 0, bd = Infinity;
    nodes.forEach(([x, y], k) => {
      const d = Math.hypot(x - pl.x, y - pl.y);
      if (d < bd) (bd = d), (best = k);
    });
    if (bd > 1e-9 * Math.max(W, H)) notes.push(`The point load at (${pl.x}, ${pl.y}) is applied at the nearest mesh node (${+nodes[best][0].toPrecision(6)}, ${+nodes[best][1].toPrecision(6)}).`);
    F[2 * best] += pl.Fx;
    F[2 * best + 1] += pl.Fy;
  }
  const fixed = new Uint8Array(N);
  for (const s of m.supports) for (const nn of edgeNodes(s.edge)) {
    if (s.ux) fixed[2 * nn] = 1;
    if (s.uy) fixed[2 * nn + 1] = 1;
  }
  // solveBanded factors a copy: K stays as assembled, for the reactions.
  const Korig = K;
  const u = solveBanded(K, bw, F, fixed);
  if (!u) return { ok: false, errors: ["The plate can move without straining (its supports do not stop it sliding or turning): hold it in both directions somewhere, and against rotation."] };
  const disp = nodes.map((_, k): [number, number] => [u[2 * k], u[2 * k + 1]]);
  // Reactions: K u − F at fixed DOFs, summed.
  const Ku = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = Math.max(0, i - bw); j <= Math.min(N - 1, i + bw); j++) s += getB(Korig, bw, i, j) * u[j];
    Ku[i] = s;
  }
  let rx = 0, ry = 0;
  for (let i = 0; i < N; i++) if (fixed[i]) i % 2 === 0 ? (rx += Ku[i] - F[i]) : (ry += Ku[i] - F[i]);
  // Equilibrium: the reactions must balance the applied loads, or the answer is not one. A slender plate balances
  // to about six digits (its bending stiffness is ill-conditioned); a mechanism misses by the whole load.
  let fx = 0, fy = 0, fmag = 0;
  for (let i = 0; i < N; i += 2) (fx += F[i]), (fy += F[i + 1]), (fmag += Math.abs(F[i]) + Math.abs(F[i + 1]));
  if (!Number.isFinite(rx + ry) || Math.abs(rx + fx) + Math.abs(ry + fy) > 1e-3 * Math.max(fmag, 1e-300) || u.some((v) => !Number.isFinite(v)))
    return { ok: false, errors: ["The solution does not balance the loads (the supports leave the plate free to move, or the numbers are out of range): hold it in both directions somewhere, and against rotation."] };
  const stress = tris.map(([p, q, r], e): [number, number, number, number] => {
    const ue = [u[2 * p], u[2 * p + 1], u[2 * q], u[2 * q + 1], u[2 * r], u[2 * r + 1]];
    const eps = Bs[e].map((row) => row.reduce((s, v, k) => s + v * ue[k], 0));
    const [sx, sy, txy] = D.map((row) => row[0] * eps[0] + row[1] * eps[1] + row[2] * eps[2]);
    return [sx, sy, txy, Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy)];
  });
  let iv = 0;
  stress.forEach((s, e) => s[3] > stress[iv][3] && (iv = e));
  const cen = (e: number): [number, number] => {
    const [p, q, r] = tris[e];
    return [(nodes[p][0] + nodes[q][0] + nodes[r][0]) / 3, (nodes[p][1] + nodes[q][1] + nodes[r][1]) / 3];
  };
  let id2 = 0;
  disp.forEach((d, k) => Math.hypot(...d) > Math.hypot(...disp[id2]) && (id2 = k));
  if (Math.min(nx, ny) < 4) notes.push(`A coarse mesh (${nx} × ${ny}): constant-strain triangles are stiff in bending, so deflections are under-predicted — refine and compare.`);
  return {
    ok: true,
    model: m,
    nodes,
    tris,
    disp,
    stress,
    maxVM: { value: stress[iv][3], x: cen(iv)[0], y: cen(iv)[1] },
    maxDisp: { value: Math.hypot(...disp[id2]), x: nodes[id2][0], y: nodes[id2][1] },
    reaction: [rx, ry],
    notes,
  };
}

/**
 * The input, one item per line:
 *   plate 100 x 20 t=1          (W × H, thickness)
 *   material E=200000 nu=0.3
 *   mesh 40 x 8
 *   support left fixed | left x | left y          (edge, and which displacement it holds)
 *   traction right tx=0 ty=-5                     (force per unit area of the edge face)
 *   pressure top 2                                (normal pressure, pushing into the plate)
 *   load 100,10 Fx=0 Fy=-1000                     (at the nearest node)
 */
export function parsePlate(text: string): { model: PlateModel | null; errors: string[] } {
  const errors: string[] = [];
  const m: PlateModel = { W: NaN, H: NaN, t: 1, E: NaN, nu: 0.3, nx: 20, ny: 5, supports: [], tractions: [], points: [] };
  const NUM = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
  // key=value items: only the keys a line takes, each a finite number — a typo ("v=0.45", "Fz=5") or "Fy=abc" is
  // refused, never dropped (dropping it would run the model with a default and print its numbers as the answer).
  const kv = (toks: string[], allowed: string[], at: string): Record<string, number> | null => {
    const o: Record<string, number> = {};
    for (const tk of toks) {
      const mm = /^([A-Za-z]+)=(.+)$/.exec(tk);
      const key = mm ? mm[1].toLowerCase() : "";
      if (!mm || !allowed.includes(key)) {
        errors.push(`${at}: “${tk}” — this line takes ${allowed.map((k) => `${k === "e" ? "E" : k === "fx" ? "Fx" : k === "fy" ? "Fy" : k}=…`).join(", ")}.`);
        return null;
      }
      const v = NUM.test(mm[2]) ? Number(mm[2]) : NaN;
      if (!Number.isFinite(v)) {
        errors.push(`${at}: “${tk}” — ${mm[1]} must be a number.`);
        return null;
      }
      o[key] = v;
    }
    return o;
  };
  const num = (t: string): number => (NUM.test(t) ? Number(t) : NaN);
  const EDGES = ["left", "right", "top", "bottom"];
  text.split(/\r\n|\r|\n/).forEach((raw, li) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const at = `Line ${li + 1}`;
    const toks = line.split(/\s+/);
    const head = toks[0].toLowerCase();
    if (head === "plate" || head === "mesh") {
      const dims = /^(\S+)\s*[x×]\s*(\S+)/.exec(toks.slice(1).join(" "));
      if (!dims || !Number.isFinite(num(dims[1])) || !Number.isFinite(num(dims[2]))) return void errors.push(`${at}: “${head === "plate" ? "plate 100 x 20 t=1" : "mesh 40 x 8"}”.`);
      if (head === "plate") {
        m.W = Number(dims[1]);
        m.H = Number(dims[2]);
        const o = kv(toks.filter((tk) => tk.includes("=")), ["t"], at);
        if (!o) return;
        if (o.t !== undefined) m.t = o.t;
      } else {
        m.nx = Number(dims[1]);
        m.ny = Number(dims[2]);
      }
      return;
    }
    if (head === "material") {
      const o = kv(toks.slice(1), ["e", "nu"], at);
      if (!o) return;
      if (o.e !== undefined) m.E = o.e;
      if (o.nu !== undefined) m.nu = o.nu;
      if (o.e === undefined && o.nu === undefined) errors.push(`${at}: “material E=200000 nu=0.3”.`);
      return;
    }
    if (head === "support") {
      const e = (toks[1] ?? "").toLowerCase(), how = (toks[2] ?? "fixed").toLowerCase();
      if (!EDGES.includes(e) || !["fixed", "x", "y"].includes(how)) return void errors.push(`${at}: “support left fixed”, “support bottom y” (holds y only) or “support left x”.`);
      m.supports.push({ edge: e as Edge, ux: how !== "y", uy: how !== "x" });
      return;
    }
    if (head === "traction" || head === "pressure") {
      const e = (toks[1] ?? "").toLowerCase();
      if (!EDGES.includes(e)) return void errors.push(`${at}: the edge is left, right, top or bottom.`);
      if (head === "traction") {
        const o = kv(toks.slice(2), ["tx", "ty"], at);
        if (!o) return;
        const tx = o.tx ?? 0, ty = o.ty ?? 0;
        if (!Number.isFinite(tx) || !Number.isFinite(ty) || (o.tx === undefined && o.ty === undefined)) return void errors.push(`${at}: “traction right tx=10 ty=0”.`);
        m.tractions.push({ edge: e as Edge, tx, ty });
      } else {
        const p = num(toks[2] ?? "");
        if (!Number.isFinite(p)) return void errors.push(`${at}: “pressure top 2”.`);
        // Pressure pushes into the plate: the outward normal's opposite.
        const n: Record<string, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, -1], bottom: [0, 1] };
        m.tractions.push({ edge: e as Edge, tx: p * n[e][0], ty: p * n[e][1] });
      }
      return;
    }
    if (head === "load") {
      const xy = /^(-?[\d.eE+-]+),(-?[\d.eE+-]+)$/.exec(toks[1] ?? "");
      const o = kv(toks.slice(2), ["fx", "fy"], at);
      if (!o) return;
      if (!xy || !Number.isFinite(num(xy[1])) || !Number.isFinite(num(xy[2])) || (o.fx === undefined && o.fy === undefined)) return void errors.push(`${at}: “load 100,10 Fy=-1000”.`);
      m.points.push({ x: Number(xy[1]), y: Number(xy[2]), Fx: o.fx ?? 0, Fy: o.fy ?? 0 });
      return;
    }
    errors.push(`${at}: “${toks[0]}” — start a line with plate, material, mesh, support, traction, pressure or load.`);
  });
  if (!Number.isFinite(m.W)) errors.push("Give the plate's size: “plate 100 x 20 t=1”.");
  if (!Number.isFinite(m.E)) errors.push("Give the material: “material E=200000 nu=0.3”.");
  for (const p of m.points) if (p.x < 0 || p.x > m.W || p.y < 0 || p.y > m.H) errors.push(`The load at (${p.x}, ${p.y}) is outside the plate.`);
  return { model: errors.length ? null : m, errors };
}
