// Plane frames by the direct stiffness method (gap item 5, docs/SCOPE-ENGINEERING-2026-10.md): nodes, members with
// E, A and I, supports, nodal loads and member loads in; displacements, reactions, member end forces and the
// bending-moment, shear and axial diagrams out. Each member is an Euler–Bernoulli frame element (axial + bending,
// 3 degrees of freedom per node: u, v, θ); a hinge at a member end is a moment release, condensed out of that member's
// stiffness. A structure that can move without straining (a mechanism) is refused by name, never "solved".
//
// Units are the user's, consistently (kN, m, kN/m², …): nothing converts. Pure: no Office.js.

export interface FrameNode {
  id: string;
  x: number;
  y: number;
}
export interface FrameMember {
  id: string;
  i: number;
  j: number;
  E: number;
  A: number;
  I: number;
  /** Moment releases (hinges) at the i and j ends. */
  hinge: [boolean, boolean];
}
export interface MemberLoad {
  member: number;
  /** "udl": w per unit length; "point": P at distance a from end i. Both in the member's local y (90° CCW from i→j). */
  kind: "udl" | "point";
  w: number;
  a?: number;
}
export interface FrameModel {
  nodes: FrameNode[];
  members: FrameMember[];
  /** Restrained degrees of freedom per node: [ux, uy, rz]. */
  supports: Map<number, [boolean, boolean, boolean]>;
  /** Nodal loads [Fx, Fy, M] (global; +x right, +y up, M counter-clockwise). */
  nodalLoads: Map<number, [number, number, number]>;
  memberLoads: MemberLoad[];
}

export interface MemberResult {
  id: string;
  length: number;
  /** End forces ON the member in local axes: [N_i, V_i, M_i, N_j, V_j, M_j]. */
  endLocal: number[];
  /** Axial force, tension positive (constant along the member). */
  axial: number;
  /** Bending moment along the member, sagging (tension on the local −y face) positive: samples [x, M]. */
  moment: Array<[number, number]>;
  shear: Array<[number, number]>;
  maxMoment: { x: number; M: number };
}
export interface FrameResult {
  ok: true;
  model: FrameModel;
  /** [u, v, θ] per node, global. */
  disp: Array<[number, number, number]>;
  /** Reactions [Rx, Ry, Mz] per supported node. */
  reactions: Map<number, [number, number, number]>;
  members: MemberResult[];
  /** Largest equilibrium residual over all nodes (force units), relative to the largest load: a self-check. */
  residual: number;
  notes: string[];
}
export type FrameError = { ok: false; errors: string[] };

const MAX_NODES = 200;
const MAX_MEMBERS = 400;

/** Solves A x = b by Gaussian elimination with partial pivoting; null when singular (relative to the matrix's scale). */
function solve(A0: number[][], b0: number[]): number[] | null {
  const n = b0.length;
  // SYMMETRIC DIAGONAL SCALING first (A → DAD, D = 1/√|Aᵢᵢ|). Translations and rotations carry stiffnesses of very
  // different size (12EI/L³ against 4EI/L), so one tolerance against the largest entry called a stiff 1 nm member's
  // rotation "singular" and refused a sound cantilever as a mechanism. Scaled, every diagonal is 1 and the pivot
  // test below is relative to each degree of freedom's own stiffness; a real mechanism still pivots at ~10⁻¹⁶.
  const D = A0.map((r, i) => (Math.abs(r[i]) > 0 && Number.isFinite(r[i]) ? 1 / Math.sqrt(Math.abs(r[i])) : 1));
  const A = A0.map((r, i) => r.map((v, j) => v * D[i] * D[j]));
  const b = b0.map((v, i) => v * D[i]);
  const y = solveScaled(A, b, n);
  return y === null ? null : y.map((v, i) => v * D[i]);
}

function solveScaled(A: number[][], b: number[], n: number): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  const scale = Math.max(1e-300, ...A.map((r) => Math.max(...r.map(Math.abs))));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < scale * 1e-11) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** The member's local stiffness (6×6) and fixed-end forces (local, ON the member's ends from its own loads). */
function localStiffness(m: FrameMember, L: number, loads: MemberLoad[]): { k: number[][]; fef: number[] } {
  const { E, A, I } = m;
  const a = (E * A) / L, b = (12 * E * I) / L ** 3, c = (6 * E * I) / L ** 2, d = (4 * E * I) / L, e = (2 * E * I) / L;
  const k = [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
  // Fixed-end forces: the end actions that hold a fully fixed member still under its loads (ON the member).
  const fef = [0, 0, 0, 0, 0, 0];
  for (const ld of loads) {
    if (ld.kind === "udl") {
      fef[1] += (-ld.w * L) / 2;
      fef[2] += (-ld.w * L * L) / 12;
      fef[4] += (-ld.w * L) / 2;
      fef[5] += (ld.w * L * L) / 12;
    } else {
      const P = ld.w, aa = ld.a ?? L / 2, bb = L - aa;
      fef[1] += (-P * bb * bb * (3 * aa + bb)) / L ** 3;
      fef[2] += (-P * aa * bb * bb) / L ** 2;
      fef[4] += (-P * aa * aa * (aa + 3 * bb)) / L ** 3;
      fef[5] += (P * aa * aa * bb) / L ** 2;
    }
  }
  // Hinges: condense each released rotation out (its row of the stiffness, and its fixed-end moment, become zero).
  for (const [end, dof] of [[0, 2], [1, 5]] as const) {
    if (!m.hinge[end]) continue;
    const kk = k[dof][dof];
    if (kk === 0) continue;
    const row = [...k[dof]];
    const f0 = fef[dof];
    for (let r = 0; r < 6; r++) {
      const fr = k[r][dof] / kk;
      for (let s = 0; s < 6; s++) k[r][s] -= fr * row[s];
      fef[r] -= fr * f0;
    }
  }
  return { k, fef };
}

function transform(c: number, s: number): number[][] {
  const T = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (const o of [0, 3]) {
    T[o][o] = c;
    T[o][o + 1] = s;
    T[o + 1][o] = -s;
    T[o + 1][o + 1] = c;
    T[o + 2][o + 2] = 1;
  }
  return T;
}
const matVec = (M: number[][], v: number[]): number[] => M.map((r) => r.reduce((s, x, i) => s + x * v[i], 0));
const transpose = (M: number[][]): number[][] => M[0].map((_, j) => M.map((r) => r[j]));
const matMul = (A: number[][], B: number[][]): number[][] => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));

export function analyzeFrame(model: FrameModel): FrameResult | FrameError {
  const errors: string[] = [];
  const n = model.nodes.length;
  if (n < 2) errors.push("A frame needs at least two nodes.");
  if (!model.members.length) errors.push("A frame needs at least one member.");
  if (n > MAX_NODES || model.members.length > MAX_MEMBERS) errors.push(`At most ${MAX_NODES} nodes and ${MAX_MEMBERS} members.`);
  for (const m of model.members) {
    const a = model.nodes[m.i], b = model.nodes[m.j];
    if (Math.hypot(b.x - a.x, b.y - a.y) === 0) errors.push(`Member ${m.id} joins a node to itself (zero length).`);
    if (!(m.E > 0 && m.A > 0 && m.I > 0)) errors.push(`Member ${m.id} needs E, A and I all positive.`);
  }
  if (!model.supports.size) errors.push("No supports: the frame would fly away. Add e.g. “support 1 fixed”.");
  if (errors.length) return { ok: false, errors };

  const N = 3 * n;
  const K = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const F = new Array<number>(N).fill(0);
  const per = model.members.map((m) => {
    const a = model.nodes[m.i], b = model.nodes[m.j];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    const loads = model.memberLoads.filter((l) => l.member === model.members.indexOf(m));
    const { k, fef } = localStiffness(m, L, loads);
    const T = transform(c, s);
    const Kg = matMul(matMul(transpose(T), k), T);
    const fefG = matVec(transpose(T), fef);
    const dofs = [3 * m.i, 3 * m.i + 1, 3 * m.i + 2, 3 * m.j, 3 * m.j + 1, 3 * m.j + 2];
    for (let r = 0; r < 6; r++) {
      for (let q = 0; q < 6; q++) K[dofs[r]][dofs[q]] += Kg[r][q];
      F[dofs[r]] -= fefG[r];
    }
    return { m, L, c, s, k, fef, T, dofs, loads };
  });
  for (const [node, f] of model.nodalLoads) for (let d = 0; d < 3; d++) F[3 * node + d] += f[d];

  const fixed = new Array<boolean>(N).fill(false);
  for (const [node, r] of model.supports) for (let d = 0; d < 3; d++) if (r[d]) fixed[3 * node + d] = true;
  // A node every member reaches through a hinge, with no rotational support, has no rotational stiffness: its rotation
  // is undetermined but harmless (nothing depends on it) — fixed to zero, never a false "mechanism".
  const notes: string[] = [];
  for (let node = 0; node < n; node++) {
    const d = 3 * node + 2;
    if (!fixed[d] && Math.abs(K[d][d]) === 0) fixed[d] = true;
  }
  const free = [...Array(N).keys()].filter((d) => !fixed[d]);
  const Kff = free.map((r) => free.map((q) => K[r][q]));
  const Ff = free.map((r) => F[r]);
  const uf = free.length ? solve(Kff, Ff) : [];
  if (!uf) return { ok: false, errors: ["The frame is a mechanism: it can move without bending or stretching any member (too few supports, or hinges that leave part of it free to swing). Add a support or remove a hinge."] };
  const u = new Array<number>(N).fill(0);
  free.forEach((d, i) => (u[d] = uf[i]));
  const disp = model.nodes.map((_, i): [number, number, number] => [u[3 * i], u[3 * i + 1], u[3 * i + 2]]);

  // Reactions = K u − applied (nodal and equivalent member) loads, at restrained DOFs.
  const Ku = matVec(K, u);
  const reactions = new Map<number, [number, number, number]>();
  for (const [node, r] of model.supports) {
    const v: [number, number, number] = [0, 0, 0];
    for (let d = 0; d < 3; d++) if (r[d]) v[d] = Ku[3 * node + d] - F[3 * node + d];
    reactions.set(node, v);
  }

  const members: MemberResult[] = per.map(({ m, L, k, fef, T, dofs, loads }) => {
    const ul = matVec(T, dofs.map((d) => u[d]));
    const f = matVec(k, ul).map((x, i) => x + fef[i]);
    const samples = 41;
    const xs = Array.from({ length: samples }, (_, i) => (L * i) / (samples - 1));
    for (const ld of loads) if (ld.kind === "point" && ld.a !== undefined && ld.a > 0 && ld.a < L) xs.push(ld.a - 1e-9 * L, ld.a + 1e-9 * L);
    xs.sort((p, q) => p - q);
    const Mx = (x: number): number => {
      let M = -f[2] + f[1] * x;
      for (const ld of loads) {
        if (ld.kind === "udl") M += (ld.w * x * x) / 2;
        else if (x > (ld.a ?? L / 2)) M += ld.w * (x - (ld.a ?? L / 2));
      }
      return M;
    };
    const Vx = (x: number): number => {
      let V = f[1];
      for (const ld of loads) {
        if (ld.kind === "udl") V += ld.w * x;
        else if (x > (ld.a ?? L / 2)) V += ld.w;
      }
      return V;
    };
    const moment = xs.map((x): [number, number] => [x, Mx(x)]);
    const shear = xs.map((x): [number, number] => [x, Vx(x)]);
    const mx = moment.reduce((best, p) => (Math.abs(p[1]) > Math.abs(best[1]) ? p : best), moment[0]);
    return { id: m.id, length: L, endLocal: f, axial: -f[0], moment, shear, maxMoment: { x: mx[0], M: mx[1] } };
  });

  // Self-check: every node in equilibrium (member end forces + applied loads + reactions).
  const bal = model.nodes.map((): [number, number, number] => [0, 0, 0]);
  per.forEach(({ m, T }, idx) => {
    const fg = matVec(transpose(T), members[idx].endLocal);
    for (let d = 0; d < 3; d++) {
      bal[m.i][d] -= fg[d];
      bal[m.j][d] -= fg[3 + d];
    }
  });
  for (const [node, f] of model.nodalLoads) for (let d = 0; d < 3; d++) bal[node][d] += f[d];
  for (const [node, r] of reactions) for (let d = 0; d < 3; d++) bal[node][d] += r[d];
  const loadScale = Math.max(
    1e-12,
    ...[...model.nodalLoads.values()].flat().map(Math.abs),
    ...model.memberLoads.map((l) => Math.abs(l.w) * (l.kind === "udl" ? per[l.member].L : 1)),
  );
  const residual = Math.max(...bal.flat().map(Math.abs)) / loadScale;
  // An answer that does not balance the loads is not one: a load the frame cannot carry (a moment on a joint where
  // every member is pinned), or stiffnesses so different the arithmetic has lost them.
  if (!(residual <= 1e-3)) return { ok: false, errors: [`The result does not balance the loads (residual ${Number.isFinite(residual) ? residual.toExponential(1) : "not finite"} of the largest load): a load the frame cannot carry — a moment on a joint where every member is pinned? — or stiffnesses too different to compute with; check the units.`] };
  if (residual > 1e-6) notes.push(`Equilibrium check: residual ${residual.toExponential(1)} of the largest load — the frame may be badly conditioned (very different stiffnesses); check the units.`);
  return { ok: true, model, disp, reactions, members, residual, notes };
}

// ---------------------------------------------------------------------------
// The input language
// ---------------------------------------------------------------------------

const NUM = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/**
 * One item per line:
 *   node A 0,0              (id, x,y)
 *   member 1 A-B            (id, ends; E, A, I from the defaults line or E=… A=… I=… on the line; hinge=i / j / both)
 *   E=200e6 A=0.01 I=1e-4   (defaults for the members after it)
 *   support A fixed | pin | roller (vertical) | rollerx (horizontal)
 *   load B Fx=10 Fy=-20 M=5
 *   udl 1 -5                (member 1, w = −5 per unit length in its local y: downward on a member drawn left to right)
 *   point 1 -20 at 2        (member 1, P = −20 at 2 from its i end)
 */
export function parseFrame(text: string): { model: FrameModel | null; errors: string[] } {
  const errors: string[] = [];
  const nodes: FrameNode[] = [];
  const members: FrameMember[] = [];
  const supports = new Map<number, [boolean, boolean, boolean]>();
  const nodalLoads = new Map<number, [number, number, number]>();
  const memberLoads: MemberLoad[] = [];
  const nodeIdx = new Map<string, number>();
  const memIdx = new Map<string, number>();
  let defaults = { E: NaN, A: NaN, I: NaN };
  // key=value items: only the keys a line takes — a typo ("Fz=-1", "Iz=…", "hinges=i") is refused, never dropped
  // (dropping it would run the frame with a default and print its numbers as the answer).
  let kvBad = "";
  const kv = (toks: string[], allowed: string[]): Record<string, string> => {
    const o: Record<string, string> = {};
    kvBad = "";
    for (const t of toks) {
      const m = /^([A-Za-z]+)=(.+)$/.exec(t);
      if (!m || !allowed.includes(m[1].toLowerCase())) {
        kvBad ||= t;
        continue;
      }
      o[m[1].toLowerCase()] = m[2];
    }
    return o;
  };
  const badKey = (at: string, allowed: string): string => `${at}: “${kvBad}” — this line takes ${allowed}.`;
  const num = (s: string | undefined): number => (s !== undefined && NUM.test(s) && Number.isFinite(Number(s)) ? Number(s) : NaN);
  text.split(/\r\n|\r|\n/).forEach((raw, li) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const at = `Line ${li + 1}`;
    const toks = line.split(/\s+/);
    const head = toks[0].toLowerCase();
    if (/^[EAI]=/i.test(toks[0])) {
      const o = kv(toks, ["e", "a", "i"]);
      if (kvBad) return void errors.push(badKey(at, "E=…, A=…, I=…"));
      defaults = { E: o.e !== undefined ? num(o.e) : defaults.E, A: o.a !== undefined ? num(o.a) : defaults.A, I: o.i !== undefined ? num(o.i) : defaults.I };
      if ([o.e, o.a, o.i].some((v) => v !== undefined && !Number.isFinite(num(v)))) errors.push(`${at}: E, A and I must be numbers (“E=200e6 A=0.01 I=8e-5”).`);
      return;
    }
    if (head === "node") {
      const m = /^(-?[\d.eE+-]+),(-?[\d.eE+-]+)$/.exec(toks[2] ?? "");
      if (!toks[1] || !m || !Number.isFinite(num(m[1])) || !Number.isFinite(num(m[2]))) return void errors.push(`${at}: a node is “node A 0,0” (finite coordinates).`);
      if (nodeIdx.has(toks[1])) return void errors.push(`${at}: node ${toks[1]} is defined twice.`);
      nodeIdx.set(toks[1], nodes.length);
      nodes.push({ id: toks[1], x: Number(m[1]), y: Number(m[2]) });
      return;
    }
    if (head === "member") {
      const ends = /^([^-\s]+)-([^-\s]+)$/.exec(toks[2] ?? "");
      if (!toks[1] || !ends) return void errors.push(`${at}: a member is “member 1 A-B”.`);
      const [i, j] = [nodeIdx.get(ends[1]), nodeIdx.get(ends[2])];
      if (i === undefined || j === undefined) return void errors.push(`${at}: member ${toks[1]} joins ${i === undefined ? ends[1] : ends[2]}, which is not a node (define nodes first).`);
      if (memIdx.has(toks[1])) return void errors.push(`${at}: member ${toks[1]} is defined twice.`);
      const o = kv(toks.slice(3), ["e", "a", "i", "hinge"]);
      if (kvBad) return void errors.push(badKey(at, "E=…, A=…, I=… and hinge=i, j or both"));
      const E = o.e !== undefined ? num(o.e) : defaults.E, A = o.a !== undefined ? num(o.a) : defaults.A, I = o.i !== undefined ? num(o.i) : defaults.I;
      if (![E, A, I].every((v) => Number.isFinite(v))) return void errors.push(`${at}: member ${toks[1]} has no E, A or I — add a line “E=200e6 A=0.01 I=8e-5” above it, or put them on the line.`);
      const h = (o.hinge ?? "").toLowerCase();
      if (h && !["i", "j", "both"].includes(h)) return void errors.push(`${at}: hinge=i, hinge=j or hinge=both.`);
      memIdx.set(toks[1], members.length);
      members.push({ id: toks[1], i, j, E, A, I, hinge: [h === "i" || h === "both", h === "j" || h === "both"] });
      return;
    }
    if (head === "support") {
      const node = nodeIdx.get(toks[1] ?? "");
      if (node === undefined) return void errors.push(`${at}: “${toks[1] ?? ""}” is not a node.`);
      const kind = (toks[2] ?? "").toLowerCase();
      const r: Record<string, [boolean, boolean, boolean]> = { fixed: [true, true, true], pin: [true, true, false], roller: [false, true, false], rollerx: [true, false, false] };
      if (!r[kind]) return void errors.push(`${at}: a support is fixed, pin, roller (holds vertically) or rollerx (holds horizontally).`);
      if (supports.has(node)) return void errors.push(`${at}: node ${toks[1]} already has a support — one per node.`);
      supports.set(node, r[kind]);
      return;
    }
    if (head === "load") {
      const node = nodeIdx.get(toks[1] ?? "");
      if (node === undefined) return void errors.push(`${at}: “${toks[1] ?? ""}” is not a node.`);
      const o = kv(toks.slice(2), ["fx", "fy", "m"]);
      if (kvBad) return void errors.push(badKey(at, "Fx=…, Fy=… and M=…"));
      const f: [number, number, number] = [o.fx !== undefined ? num(o.fx) : 0, o.fy !== undefined ? num(o.fy) : 0, o.m !== undefined ? num(o.m) : 0];
      if (f.some((v) => !Number.isFinite(v)) || !Object.keys(o).length) return void errors.push(`${at}: a load is “load B Fx=10 Fy=-20 M=5”.`);
      const prev = nodalLoads.get(node) ?? [0, 0, 0];
      nodalLoads.set(node, [prev[0] + f[0], prev[1] + f[1], prev[2] + f[2]]);
      return;
    }
    if (head === "udl" || head === "point") {
      const mem = memIdx.get(toks[1] ?? "");
      if (mem === undefined) return void errors.push(`${at}: “${toks[1] ?? ""}” is not a member (define it first).`);
      const w = num(toks[2]);
      if (!Number.isFinite(w)) return void errors.push(`${at}: ${head === "udl" ? "“udl 1 -5”" : "“point 1 -20 at 2”"}.`);
      if (head === "udl") memberLoads.push({ member: mem, kind: "udl", w });
      else {
        const a = toks[3]?.toLowerCase() === "at" ? num(toks[4]) : NaN;
        const mm = members[mem];
        const L = Math.hypot(nodes[mm.j].x - nodes[mm.i].x, nodes[mm.j].y - nodes[mm.i].y);
        if (!Number.isFinite(a) || a < 0 || a > L) return void errors.push(`${at}: a point load is “point 1 -20 at 2”, with 0 ≤ at ≤ ${+L.toPrecision(6)} (the member's length).`);
        memberLoads.push({ member: mem, kind: "point", w, a });
      }
      return;
    }
    errors.push(`${at}: “${toks[0]}” — start a line with node, member, support, load, udl, point or E=.`);
  });
  if (errors.length) return { model: null, errors };
  return { model: { nodes, members, supports, nodalLoads, memberLoads }, errors };
}
