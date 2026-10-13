// Graph theory — the edge-list engine of the Solve kind "Discrete math".
//
// Surface form: one edge per line (A-B, A--B, A->B, A→B, optionally followed by
// a weight: "A-B 5", "A->B 2.5", "A-B -3"), with an optional QUESTION on the
// first line ("shortest path A to F", "mst", "eulerian", "hamiltonian",
// "bipartite", "components", "topological order", "degrees", "bfs from A",
// "dfs from A", "diameter", "tree?"). No question → a full report.
//
// House rules honoured here:
//   · every cap is named — MAX_VERTICES, MAX_EDGES, MAX_HAMILTONIAN_VERTICES —
//     and the pane calls tryGraph on every keystroke, so every routine below is
//     polynomial in ≤ 60 vertices / ≤ 500 edges (the Hamiltonian search is a
//     subset DP over ≤ 12 vertices: 2¹² × 12 states, exhaustive and bounded);
//   · refusals name what was refused and why (the offending line number, the
//     negative cycle, the directed graph handed to Kruskal, the NP-hard size);
//   · results that can be checked two ways are: the engine re-sums every path
//     and every spanning tree it reports and re-counts every Eulerian trail,
//     and the tests check Dijkstra against brute-force path enumeration and
//     Kruskal against brute force over all spanning trees on small graphs;
//   · what is displayed parses back: the Unicode minus and arrow this engine
//     prints (−, →) are accepted on input.

import { DiscreteError } from "./discrete";
import type { DiscreteResult } from "./discrete";

/** Caps, by name. Above these the request is refused, never attempted. */
export const MAX_VERTICES = 60;
export const MAX_EDGES = 500;
/** Hamiltonian cycle/path is NP-hard; the exhaustive subset DP is run only up to this many vertices. */
export const MAX_HAMILTONIAN_VERTICES = 12;

export interface GEdge {
  id: number;
  u: number;
  v: number;
  w: number;
  hasWeight: boolean;
  /** 1-based input line. */
  line: number;
}

export interface Graph {
  /** Vertex names, sorted (natural order) — vertex index everywhere below is an index into this. */
  names: string[];
  directed: boolean;
  weighted: boolean;
  /** Any edge with a negative weight. */
  negative: boolean;
  edges: GEdge[];
  /** Edge ids incident at each vertex: out-edges for a directed graph; both ends for undirected (a self-loop listed once). Sorted by the far endpoint. */
  adj: number[][];
  /** Undirected view: neighbour vertex indices (both directions, duplicates kept for parallel edges), sorted. */
  nbr: number[][];
  selfLoops: number;
  parallel: number;
  /** Edges typed without a weight in a graph where others have one (treated as 1). */
  unweightedEdges: number;
}

export type Question =
  | { kind: "default" }
  | { kind: "shortest"; from: string; to: string }
  | { kind: "mst" }
  | { kind: "euler" }
  | { kind: "hamilton" }
  | { kind: "bipartite" }
  | { kind: "components" }
  | { kind: "topo" }
  | { kind: "degree" }
  | { kind: "bfs"; from: string }
  | { kind: "dfs"; from: string }
  | { kind: "diameter" }
  | { kind: "tree" };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const NAME = "[A-Za-z0-9_]+";
/** A-B · A--B · A-B 5 · A->B · A→B · A->B 2.5 · A-B: 5 · A-B (5). The weight must be separated from the edge by a space, colon, comma or parenthesis. */
const EDGE_RE = new RegExp(
  `^(${NAME})\\s*(-->|->|→|--|-|−|–)\\s*(${NAME})(?:(?:\\s+|\\s*[:,]\\s*|\\s*\\(\\s*)([-−]?\\d+(?:\\.\\d+)?)\\s*\\)?)?\\s*$`,
);
const DIRECTED_OPS = new Set(["->", "-->", "→"]);

const FILLER = /^(?:please|find|compute|give|show|list|what is|what's|whats|is it|is this|is the|is there|is|does it have|does this graph have|has|the|this|graph|me|its|an?)\s+/i;
const TRAILING = /\s+(?:of|in|for)\s+(?:the|this)\s+graph$/i;

/** The question grammar, documented by example in the tests. Case-insensitive; vertex names keep their case. */
export function parseQuestion(raw: string): Question | null {
  let s = raw.trim().replace(/[?.!:]+$/, "").replace(/\s+/g, " ").trim();
  s = s.replace(TRAILING, "");
  for (let k = 0; k < 8; k++) {
    const m = FILLER.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^(?:shortest(?: (?:path|route|distance|way))?|distance|dijkstra|bellman[- ]?ford|path|route)(?: from)? (${NAME}) (?:to|→|->) (${NAME})$`, "i").exec(s))) {
    return { kind: "shortest", from: m[1], to: m[2] };
  }
  if (/^(?:mst|msf|minimum (?:weight )?spanning (?:tree|forest)|min spanning tree|spanning tree|kruskal)$/i.test(s)) return { kind: "mst" };
  if (/^euler(?:ian)?(?: (?:circuit|cycle|path|trail|tour|walk))?$/i.test(s)) return { kind: "euler" };
  if (/^hamilton(?:ian)?(?: (?:circuit|cycle|path|tour))?$/i.test(s)) return { kind: "hamilton" };
  if (/^(?:bipartite|bipartition|2[- ]?colou?r(?:able|ing)?|two[- ]?colou?r(?:able|ing)?)$/i.test(s)) return { kind: "bipartite" };
  if (/^(?:(?:connected|strongly connected|strong|weakly connected|weak) components?|components?|connected|connectivity|sccs?)$/i.test(s)) return { kind: "components" };
  if (/^(?:topological(?: (?:order(?:ing)?|sort(?:ing)?))?|topo(?:logical)? ?sort|toposort|topsort|topo)$/i.test(s)) return { kind: "topo" };
  if (/^(?:degrees?|degree (?:table|sequence)|valenc(?:y|ies))$/i.test(s)) return { kind: "degree" };
  if ((m = new RegExp(`^(?:bfs|breadth[- ]?first(?: search)?)(?: (?:from|at|starting (?:at|from)))? (${NAME})$`, "i").exec(s))) return { kind: "bfs", from: m[1] };
  if ((m = new RegExp(`^(?:dfs|depth[- ]?first(?: search)?)(?: (?:from|at|starting (?:at|from)))? (${NAME})$`, "i").exec(s))) return { kind: "dfs", from: m[1] };
  if (/^diameter$/i.test(s)) return { kind: "diameter" };
  if (/^(?:tree|forest|acyclic|cycle|cycles)$/i.test(s)) return { kind: "tree" };
  return null;
}

function cmpName(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** null = not a graph (no line parses as an edge). Throws DiscreteError for a
 *  recognised edge list that cannot be used (a stray line, mixed edge kinds,
 *  a cap). */
export function parseGraph(input: string): { graph: Graph; question: Question } | null {
  const lines = input.replace(/\r/g, "").split("\n");
  interface Raw { line: number; u: string; v: string; dir: boolean; w: number | null }
  const raws: Raw[] = [];
  let question: Question = { kind: "default" };
  let first = true;
  let badLine = 0;
  let badText = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const m = EDGE_RE.exec(t);
    if (m) {
      raws.push({ line: i + 1, u: m[1], v: m[3], dir: DIRECTED_OPS.has(m[2]), w: m[4] === undefined ? null : Number(m[4].replace("−", "-")) });
    } else if (first) {
      const q = parseQuestion(t);
      if (q) question = q;
      else { badLine = i + 1; badText = t; }
    } else if (!badLine) {
      badLine = i + 1;
      badText = t;
    }
    first = false;
  }
  if (!raws.length) return null;
  if (raws.length > MAX_EDGES) {
    throw new DiscreteError(`This edge list has ${raws.length} edges; the cap is ${MAX_EDGES} edges (and ${MAX_VERTICES} vertices) so the pane can answer on every keystroke.`);
  }
  if (badLine) {
    const hint = parseQuestion(badText) ? " — a question is read only on the first line" : "";
    throw new DiscreteError(`Line ${badLine} ("${clip(badText, 40)}") is neither an edge (A-B, A->B, A-B 5) nor a question${hint}.`);
  }
  const firstDir = raws.find((r) => r.dir);
  const firstUnd = raws.find((r) => !r.dir);
  if (firstDir && firstUnd) {
    throw new DiscreteError(`Mixed edge kinds: line ${firstDir.line} is directed (${firstDir.u}->${firstDir.v}) but line ${firstUnd.line} is undirected (${firstUnd.u}-${firstUnd.v}). Use one kind throughout.`);
  }
  const nameSet = new Set<string>();
  for (const r of raws) { nameSet.add(r.u); nameSet.add(r.v); }
  if (nameSet.size > MAX_VERTICES) {
    throw new DiscreteError(`This graph has ${nameSet.size} vertices; the cap is ${MAX_VERTICES} vertices (and ${MAX_EDGES} edges) so the pane can answer on every keystroke.`);
  }
  const names = [...nameSet].sort(cmpName);
  const index = new Map<string, number>();
  names.forEach((nm, i) => index.set(nm, i));
  const n = names.length;
  const directed = !!firstDir;
  const weighted = raws.some((r) => r.w !== null);
  const edges: GEdge[] = raws.map((r, id) => ({
    id, u: index.get(r.u)!, v: index.get(r.v)!, w: r.w === null ? 1 : r.w, hasWeight: r.w !== null, line: r.line,
  }));
  const adj: number[][] = Array.from({ length: n }, () => []);
  const nbr: number[][] = Array.from({ length: n }, () => []);
  const seen = new Map<string, number>();
  let selfLoops = 0;
  let parallel = 0;
  for (const e of edges) {
    if (e.u === e.v) selfLoops++;
    const key = directed ? `${e.u}>${e.v}` : `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`;
    const c = seen.get(key) || 0;
    if (c > 0) parallel++;
    seen.set(key, c + 1);
    adj[e.u].push(e.id);
    if (!directed && e.u !== e.v) adj[e.v].push(e.id);
    nbr[e.u].push(e.v);
    if (e.u !== e.v) nbr[e.v].push(e.u);
  }
  for (let v = 0; v < n; v++) {
    adj[v].sort((a, b) => nextOf(directed, edges[a], v) - nextOf(directed, edges[b], v) || a - b);
    nbr[v].sort((a, b) => a - b);
  }
  const graph: Graph = {
    names, directed, weighted, negative: edges.some((e) => e.w < 0), edges, adj, nbr, selfLoops, parallel,
    unweightedEdges: weighted ? edges.filter((e) => !e.hasWeight).length : 0,
  };
  return { graph, question };
}

/** The vertex reached by travelling edge e away from v. */
function nextOf(directed: boolean, e: GEdge, v: number): number {
  return directed ? e.v : e.u === v ? e.v : e.u;
}
function far(g: Graph, eid: number, v: number): number {
  return nextOf(g.directed, g.edges[eid], v);
}

// ---------------------------------------------------------------------------
// Algorithms — each exported so the tests can cross-check it directly.
// ---------------------------------------------------------------------------

export function degrees(g: Graph): { deg: number[]; inn: number[]; out: number[] } {
  const n = g.names.length;
  const deg = new Array<number>(n).fill(0);
  const inn = new Array<number>(n).fill(0);
  const out = new Array<number>(n).fill(0);
  for (const e of g.edges) {
    out[e.u]++;
    inn[e.v]++;
    deg[e.u]++;
    deg[e.v]++; // a self-loop counts twice, as the handshake lemma requires
  }
  return { deg, inn, out };
}

/** Weakly connected components (ignores direction), each sorted, ordered by smallest member. */
export function weakComponents(g: Graph): number[][] {
  const n = g.names.length;
  const comp = new Int32Array(n).fill(-1);
  const out: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const id = out.length;
    const members: number[] = [];
    const queue = [s];
    comp[s] = id;
    while (queue.length) {
      const v = queue.shift()!;
      members.push(v);
      for (const w of g.nbr[v]) if (comp[w] < 0) { comp[w] = id; queue.push(w); }
    }
    members.sort((a, b) => a - b);
    out.push(members);
  }
  return out;
}

/** Strongly connected components (Tarjan). Recursion depth ≤ MAX_VERTICES. */
export function strongComponents(g: Graph): number[][] {
  const n = g.names.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const comps: number[][] = [];
  let counter = 0;
  const visit = (v: number): void => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = 1;
    for (const eid of g.adj[v]) {
      const w = far(g, eid, v);
      if (index[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]); }
      else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const c: number[] = [];
      let w: number;
      do { w = stack.pop()!; onStack[w] = 0; c.push(w); } while (w !== v);
      c.sort((a, b) => a - b);
      comps.push(c);
    }
  };
  for (let v = 0; v < n; v++) if (index[v] < 0) visit(v);
  comps.sort((a, b) => a[0] - b[0]);
  return comps;
}

/** 2-colouring of the undirected view. Either the two parts, or an odd cycle
 *  as a vertex list (closed implicitly: last is adjacent to first; a single
 *  vertex means a self-loop). */
export function bipartition(g: Graph): { parts: [number[], number[]] } | { oddCycle: number[] } {
  const n = g.names.length;
  const colour = new Int8Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if (colour[s] >= 0) continue;
    colour[s] = 0;
    const queue = [s];
    while (queue.length) {
      const v = queue.shift()!;
      for (const w of g.nbr[v]) {
        if (w === v) return { oddCycle: [v] };
        if (colour[w] < 0) { colour[w] = 1 - colour[v]; parent[w] = v; queue.push(w); }
        else if (colour[w] === colour[v]) {
          const up = (x: number): number[] => { const p: number[] = []; for (let y = x; y >= 0; y = parent[y]) p.push(y); return p; };
          const a = up(v), b = up(w);
          let lca = -1;
          while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) { lca = a.pop()!; b.pop(); }
          return { oddCycle: canonicalCycle([...a, lca, ...b.reverse()], false) };
        }
      }
    }
  }
  const parts: [number[], number[]] = [[], []];
  for (let v = 0; v < n; v++) parts[colour[v]].push(v);
  return { parts };
}

export interface EulerResult {
  kind: "circuit" | "path" | "none";
  /** Vertex sequence (m+1 long) and the edge taken at each step (m long). */
  trail: number[];
  trailEdges: number[];
  reason: string;
}

/** Euler conditions + Hierholzer's algorithm (iterative, O(m)). */
export function eulerTrail(g: Graph): EulerResult {
  const n = g.names.length;
  const { deg, inn, out } = degrees(g);
  const active = weakComponents(g).filter((c) => c.some((v) => deg[v] > 0));
  if (active.length > 1) {
    return { kind: "none", trail: [], trailEdges: [], reason: `the edges lie in ${active.length} separate components, so no single trail can cover them` };
  }
  let start = -1;
  let kind: "circuit" | "path";
  if (!g.directed) {
    const odd: number[] = [];
    for (let v = 0; v < n; v++) if (deg[v] % 2 === 1) odd.push(v);
    if (odd.length === 0) { kind = "circuit"; start = deg.findIndex((d) => d > 0); }
    else if (odd.length === 2) { kind = "path"; start = odd[0]; }
    else {
      return { kind: "none", trail: [], trailEdges: [], reason: `${odd.length} vertices have odd degree (${listCut(odd.map((v) => g.names[v]), 8)}); an Eulerian path needs 0 or 2` };
    }
  } else {
    const plus: number[] = [], minus: number[] = [], bad: number[] = [];
    for (let v = 0; v < n; v++) {
      const d = out[v] - inn[v];
      if (d === 1) plus.push(v); else if (d === -1) minus.push(v); else if (d !== 0) bad.push(v);
    }
    if (bad.length === 0 && plus.length === 0 && minus.length === 0) { kind = "circuit"; start = out.findIndex((d) => d > 0); }
    else if (bad.length === 0 && plus.length === 1 && minus.length === 1) { kind = "path"; start = plus[0]; }
    else {
      const off = [...plus, ...minus, ...bad].sort((a, b) => a - b).map((v) => `${g.names[v]} (in ${inn[v]}, out ${out[v]})`);
      return { kind: "none", trail: [], trailEdges: [], reason: `in-degree ≠ out-degree at ${listCut(off, 5, 70)}; a directed trail allows one +1 and one −1 imbalance at most` };
    }
  }
  // Hierholzer.
  const m = g.edges.length;
  const used = new Uint8Array(m);
  const ptr = new Int32Array(n);
  const stackV: number[] = [start];
  const stackE: number[] = [-1];
  const pathV: number[] = [];
  const pathE: number[] = [];
  while (stackV.length) {
    const v = stackV[stackV.length - 1];
    const list = g.adj[v];
    while (ptr[v] < list.length && used[list[ptr[v]]]) ptr[v]++;
    if (ptr[v] < list.length) {
      const eid = list[ptr[v]];
      used[eid] = 1;
      stackV.push(far(g, eid, v));
      stackE.push(eid);
    } else {
      pathV.push(stackV.pop()!);
      pathE.push(stackE.pop()!);
    }
  }
  pathV.reverse();
  pathE.reverse();
  pathE.shift();
  return { kind, trail: pathV, trailEdges: pathE, reason: "" };
}

/** Undirected: the first cycle closed in input order, as an open vertex list
 *  (A B C means A–B–C–A; [A] means a self-loop; [A, B] a parallel pair). */
export function findCycleUndirected(g: Graph): number[] | null {
  const n = g.names.length;
  const uf = new Int32Array(n);
  for (let i = 0; i < n; i++) uf[i] = i;
  const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  for (const e of g.edges) {
    if (e.u === e.v) return [e.u];
    const a = find(e.u), b = find(e.v);
    if (a !== b) { uf[a] = b; continue; }
    // Path from e.u to e.v through earlier edges, then the closing edge e.
    const parent = new Int32Array(n).fill(-1);
    parent[e.u] = e.u;
    const queue = [e.u];
    while (queue.length) {
      const v = queue.shift()!;
      if (v === e.v) break;
      for (const eid of g.adj[v]) {
        if (eid >= e.id) continue;
        const w = far(g, eid, v);
        if (parent[w] < 0) { parent[w] = v; queue.push(w); }
      }
    }
    const path: number[] = [];
    for (let x = e.v; x !== e.u; x = parent[x]) path.push(x);
    path.push(e.u);
    return canonicalCycle(path.reverse(), false);
  }
  return null;
}

/** Directed: a cycle as an open vertex list (A B C means A→B→C→A), or null for a DAG. */
export function findCycleDirected(g: Graph): number[] | null {
  const n = g.names.length;
  const state = new Int8Array(n); // 0 white, 1 grey, 2 black
  const path: number[] = [];
  let found: number[] | null = null;
  const visit = (v: number): boolean => {
    state[v] = 1;
    path.push(v);
    for (const eid of g.adj[v]) {
      const w = far(g, eid, v);
      if (state[w] === 1) { found = path.slice(path.indexOf(w)); return true; }
      if (state[w] === 0 && visit(w)) return true;
    }
    path.pop();
    state[v] = 2;
    return false;
  };
  for (let v = 0; v < n && !found; v++) if (state[v] === 0) visit(v);
  return found ? canonicalCycle(found, true) : null;
}

/** Kahn's algorithm; among the available vertices the alphabetically first is
 *  taken (pinned tie-break). null if the graph has a cycle. */
export function topologicalOrder(g: Graph): number[] | null {
  const n = g.names.length;
  const indeg = degrees(g).inn.slice();
  const done = new Uint8Array(n);
  const order: number[] = [];
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let v = 0; v < n; v++) if (!done[v] && indeg[v] === 0) { pick = v; break; }
    if (pick < 0) return null;
    done[pick] = 1;
    order.push(pick);
    for (const eid of g.adj[pick]) indeg[g.edges[eid].v]--;
  }
  return order;
}

export interface PathResult { dist: number[]; pred: number[]; order: number[] }

/** Dijkstra, O(n²) selection (n ≤ 60). Requires non-negative weights. */
export function dijkstra(g: Graph, s: number): PathResult {
  const n = g.names.length;
  const dist = new Array<number>(n).fill(Infinity);
  const pred = new Array<number>(n).fill(-1);
  const done = new Uint8Array(n);
  const order: number[] = [];
  dist[s] = 0;
  for (let k = 0; k < n; k++) {
    let v = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (v < 0 || dist[i] < dist[v])) v = i;
    if (v < 0) break;
    done[v] = 1;
    order.push(v);
    for (const eid of g.adj[v]) {
      const e = g.edges[eid];
      const w = far(g, eid, v);
      if (dist[v] + e.w < dist[w]) { dist[w] = dist[v] + e.w; pred[w] = eid; }
    }
  }
  return { dist, pred, order };
}

export interface BellmanFordResult extends PathResult {
  rounds: number;
  snapshots: number[][];
  /** A negative cycle reachable from s, as an open vertex list, or null. */
  negCycle: number[] | null;
}

/** Bellman–Ford over the arc expansion (an undirected edge is two arcs, so a
 *  negative undirected edge is itself a negative cycle). */
export function bellmanFord(g: Graph, s: number): BellmanFordResult {
  const n = g.names.length;
  const arcs: { u: number; v: number; w: number; e: number }[] = [];
  for (const e of g.edges) {
    arcs.push({ u: e.u, v: e.v, w: e.w, e: e.id });
    if (!g.directed && e.u !== e.v) arcs.push({ u: e.v, v: e.u, w: e.w, e: e.id });
  }
  const dist = new Array<number>(n).fill(Infinity);
  const pred = new Array<number>(n).fill(-1);
  dist[s] = 0;
  const snapshots: number[][] = [];
  let rounds = 0;
  for (let r = 1; r < n; r++) {
    let changed = false;
    for (const a of arcs) {
      if (dist[a.u] < Infinity && dist[a.u] + a.w < dist[a.v]) { dist[a.v] = dist[a.u] + a.w; pred[a.v] = a.e; changed = true; }
    }
    rounds = r;
    snapshots.push(dist.slice());
    if (!changed) break;
  }
  // Negative-cycle detection: an arc that still relaxes after n−1 rounds means
  // a negative cycle is reachable. Reading it off the predecessor chain is
  // bounded by a visited set (never more than n steps per attempt); if one
  // chain happens to end at the source instead, further rounds are run (at
  // most n) until a chain closes — it must, because the cycle keeps relaxing.
  let negCycle: number[] | null = null;
  const chainCycle = (start: number): number[] | null => {
    const seenAt = new Int32Array(n).fill(-1);
    const chain: number[] = [];
    let x = start;
    while (x >= 0 && seenAt[x] < 0 && chain.length <= n) {
      seenAt[x] = chain.length;
      chain.push(x);
      x = pred[x] < 0 ? -1 : predVertex(g, pred[x], x);
    }
    if (x < 0 || seenAt[x] < 0) return null;
    return canonicalCycle(chain.slice(seenAt[x]).reverse(), true);
  };
  for (let extra = 0; extra <= n && !negCycle; extra++) {
    let relaxable: typeof arcs[number] | null = null;
    for (const a of arcs) {
      if (dist[a.u] < Infinity && dist[a.u] + a.w < dist[a.v]) {
        if (!relaxable) relaxable = a;
        dist[a.v] = dist[a.u] + a.w;
        pred[a.v] = a.e;
      }
    }
    if (!relaxable) break;
    negCycle = chainCycle(relaxable.v);
    if (!negCycle) {
      for (let v = 0; v < n && !negCycle; v++) negCycle = chainCycle(v);
    }
    if (!negCycle && extra === n) negCycle = [relaxable.u, relaxable.v];
  }
  return { dist, pred, order: [], rounds, snapshots, negCycle };
}

/** The tail of pred-edge eid as seen from its head v. */
function predVertex(g: Graph, eid: number, v: number): number {
  const e = g.edges[eid];
  return g.directed ? e.u : e.u === v ? e.v : e.u;
}

/** Rebuilds s→t from predecessor edges; null when t is unreachable. */
export function buildPath(g: Graph, pred: number[], s: number, t: number): { verts: number[]; edges: number[] } | null {
  if (s === t) return { verts: [s], edges: [] };
  const verts: number[] = [t];
  const edges: number[] = [];
  let x = t;
  for (let k = 0; k <= g.names.length && x !== s; k++) {
    const eid = pred[x];
    if (eid < 0) return null;
    edges.push(eid);
    x = predVertex(g, eid, x);
    verts.push(x);
  }
  if (x !== s) return null;
  return { verts: verts.reverse(), edges: edges.reverse() };
}

export interface MstResult {
  /** Edge ids in the order Kruskal accepted them. */
  chosen: number[];
  /** Edge ids examined and rejected (would close a cycle), in order. */
  rejected: number[];
  total: number;
  components: number;
}

/** Kruskal with union-find. Edges are taken in order of weight; equal weights
 *  are broken by the alphabetically-first endpoint pair, then input order
 *  (pinned in the tests). Self-loops are never spanning-tree edges. */
export function kruskal(g: Graph): MstResult {
  const n = g.names.length;
  const uf = new Int32Array(n);
  for (let i = 0; i < n; i++) uf[i] = i;
  const find = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const key = (e: GEdge): string => {
    const a = g.names[e.u], b = g.names[e.v];
    return cmpName(a, b) <= 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  };
  const sorted = g.edges.filter((e) => e.u !== e.v).sort((a, b) => a.w - b.w || cmpName(key(a), key(b)) || a.id - b.id);
  const chosen: number[] = [];
  const rejected: number[] = [];
  let total = 0;
  let components = n;
  for (const e of sorted) {
    const a = find(e.u), b = find(e.v);
    if (a === b) { rejected.push(e.id); continue; }
    uf[a] = b;
    chosen.push(e.id);
    total += e.w;
    components--;
    if (components === 1) break;
  }
  return { chosen, rejected, total, components };
}

/** Exhaustive subset DP (Held–Karp style) over ≤ MAX_HAMILTONIAN_VERTICES
 *  vertices: a Hamiltonian cycle (closed) or path, as a vertex list, or null
 *  when none exists. Respects direction; ignores self-loops and weights. */
export function hamiltonian(g: Graph, wantCycle: boolean): number[] | null {
  const n = g.names.length;
  if (n > MAX_HAMILTONIAN_VERTICES) return null;
  if (n === 1) return wantCycle ? null : [0];
  if (wantCycle && n < 3) return null;
  const adjM: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (const e of g.edges) {
    if (e.u === e.v) continue;
    adjM[e.u][e.v] = true;
    if (!g.directed) adjM[e.v][e.u] = true;
  }
  const full = (1 << n) - 1;
  // par[mask*n + v]: predecessor of v on a path covering mask ending at v; -1 = path start; -2 = unreachable.
  const par = new Int8Array((1 << n) * n).fill(-2);
  if (wantCycle) par[(1 << 0) * n + 0] = -1;
  else for (let s = 0; s < n; s++) par[(1 << s) * n + s] = -1;
  for (let mask = 1; mask <= full; mask++) {
    if (wantCycle && !(mask & 1)) continue;
    for (let v = 0; v < n; v++) {
      if (!(mask & (1 << v)) || par[mask * n + v] === -2) continue;
      for (let w = 0; w < n; w++) {
        if (mask & (1 << w) || !adjM[v][w]) continue;
        const nm = mask | (1 << w);
        if (par[nm * n + w] === -2) par[nm * n + w] = v;
      }
    }
  }
  const rebuild = (end: number): number[] => {
    const out: number[] = [];
    let mask = full, v = end;
    while (v >= 0) { out.push(v); const p = par[mask * n + v]; mask &= ~(1 << v); v = p; }
    return out.reverse();
  };
  for (let v = 0; v < n; v++) {
    if (par[full * n + v] === -2) continue;
    if (wantCycle && !adjM[v][0]) continue;
    return rebuild(v);
  }
  return null;
}

export interface DiameterResult {
  /** Infinity when some pair is unreachable. */
  diameter: number;
  from: number;
  to: number;
  ecc: number[];
  path: { verts: number[]; edges: number[] } | null;
}

/** All-pairs shortest paths by repeated Dijkstra (BFS when unweighted). Requires non-negative weights. */
export function diameter(g: Graph): DiameterResult {
  const n = g.names.length;
  const ecc = new Array<number>(n).fill(0);
  let best = -Infinity, from = 0, to = 0, bestPred: number[] = [];
  for (let s = 0; s < n; s++) {
    const r = dijkstra(g, s);
    for (let t = 0; t < n; t++) {
      if (r.dist[t] > ecc[s]) ecc[s] = r.dist[t];
      if (r.dist[t] > best) { best = r.dist[t]; from = s; to = t; bestPred = r.pred; }
    }
  }
  const path = Number.isFinite(best) ? buildPath(g, bestPred, from, to) : null;
  return { diameter: best, from, to, ecc, path };
}

/** Breadth-first search; neighbours visited in name order. */
export function bfs(g: Graph, s: number): { order: number[]; dist: number[]; treeEdges: number[] } {
  const n = g.names.length;
  const dist = new Array<number>(n).fill(-1);
  const order: number[] = [];
  const treeEdges: number[] = [];
  const queue = [s];
  dist[s] = 0;
  while (queue.length) {
    const v = queue.shift()!;
    order.push(v);
    for (const eid of g.adj[v]) {
      const w = far(g, eid, v);
      if (dist[w] < 0) { dist[w] = dist[v] + 1; treeEdges.push(eid); queue.push(w); }
    }
  }
  return { order, dist, treeEdges };
}

/** Depth-first search (preorder); neighbours visited in name order. */
export function dfs(g: Graph, s: number): { order: number[]; treeEdges: number[] } {
  const n = g.names.length;
  const seen = new Uint8Array(n);
  const order: number[] = [];
  const treeEdges: number[] = [];
  const visit = (v: number): void => {
    seen[v] = 1;
    order.push(v);
    for (const eid of g.adj[v]) {
      const w = far(g, eid, v);
      if (!seen[w]) { treeEdges.push(eid); visit(w); }
    }
  };
  visit(s);
  return { order, treeEdges };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function fmtW(w: number): string {
  const s = Number.isInteger(w) ? String(w) : String(Number(w.toPrecision(10)));
  return s.replace(/^-/, "−");
}

/** "a, b, c, … and 12 more" — cut by item count AND by a character budget, so a line never runs long. */
function listCut(items: string[], max = 12, chars = 110): string {
  let used = 0, k = 0;
  while (k < items.length && k < max && used + items[k].length + 2 <= chars) { used += items[k].length + 2; k++; }
  if (k === items.length) return items.join(", ");
  if (k === 0) k = 1;
  return items.slice(0, k).join(", ") + `, … and ${items.length - k} more`;
}

function setStr(g: Graph, verts: number[], max = 15, chars = 60): string {
  return "{" + listCut(verts.map((v) => g.names[v]), max, chars) + "}";
}

/** Rotates (and, when undirected, reflects) an open cycle so it starts at the
 *  smallest vertex and heads to its smaller neighbour — one canonical spelling. */
function canonicalCycle(cyc: number[], directed: boolean): number[] {
  if (cyc.length <= 1) return cyc;
  let k = 0;
  for (let i = 1; i < cyc.length; i++) if (cyc[i] < cyc[k]) k = i;
  const rot = [...cyc.slice(k), ...cyc.slice(0, k)];
  if (!directed && rot.length > 2 && rot[rot.length - 1] < rot[1]) return [rot[0], ...rot.slice(1).reverse()];
  return rot;
}

/** "A: 3 · B: 2 · …" wrapped into lines of at most `width` characters. */
function wrapLines(prefix: string, items: string[], sep = " · ", width = 150): string[] {
  const out: string[] = [];
  let cur = prefix;
  let first = true;
  for (const it of items) {
    const piece = (first ? "" : sep) + it;
    if (!first && cur.length + piece.length > width) { out.push(cur); cur = "  " + it; }
    else cur += piece;
    first = false;
  }
  out.push(cur);
  return out;
}

/** "A → B → C" / "A – B – C", with "(w)" after each connector when weights are shown. */
function seqStr(g: Graph, verts: number[], edges?: number[], showWeights = g.weighted, max = 40, chars = 115): string {
  const con = g.directed ? "→" : "–";
  const parts: string[] = [];
  let used = 0;
  let shown = 0;
  for (let i = 0; i < verts.length && i < max; i++) {
    const link = i > 0 ? (edges && showWeights ? `${con}(${fmtW(g.edges[edges[i - 1]].w)})` : con) : "";
    const name = g.names[verts[i]];
    const add = (link ? link.length + 1 : 0) + name.length + 1;
    if (i >= 2 && used + add > chars) break;
    if (link) parts.push(link);
    parts.push(name);
    used += add;
    shown++;
  }
  if (shown < verts.length) parts.push(`${con} … (${verts.length - shown} more)`);
  return parts.join(" ");
}

/** Closed cycle from an open vertex list. `ignoreDirection` prints "–" even on
 *  a directed graph (a bipartite odd-cycle witness runs against the arrows). */
function cycleStr(g: Graph, cyc: number[], ignoreDirection = false): string {
  const con = g.directed && !ignoreDirection ? "→" : "–";
  if (cyc.length === 1) return `${g.names[cyc[0]]} ${con} ${g.names[cyc[0]]} (self-loop)`;
  const s = seqStr(g, [...cyc, cyc[0]], undefined, false);
  return ignoreDirection ? s.replace(/→/g, "–") : s;
}

function vertexIndex(g: Graph, name: string, role: string): number {
  const i = g.names.indexOf(name);
  if (i < 0) {
    const ci = g.names.findIndex((nm) => nm.toLowerCase() === name.toLowerCase());
    if (ci >= 0) return ci;
    throw new DiscreteError(`${role} vertex "${name}" is not in the edge list (vertices: ${listCut(g.names, 10)}).`);
  }
  return i;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function vcount(n: number): string {
  return n === 1 ? "1 vertex" : `${n} vertices`;
}

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface FigureOptions {
  caption: string;
  highlightEdges?: Set<number>;
  highlightVerts?: Set<number>;
  /** Vertices drawn with a white fill (the second part of a bipartition). */
  hollowVerts?: Set<number>;
  /** Per-edge labels that replace the weight (e.g. the step number along a trail). */
  edgeLabels?: Map<number, string>;
}

const INK = "#1A1A1A", ACCENT = "#0C4A6E", MUTED = "#7B8C99", FILL = "#9DB3C4";

/** Deterministic circular layout (vertices in name order), 460 × 320, white
 *  background, caption on the last line. No external references. */

/** Does the segment (x1,y1)-(x2,y2) touch the axis-aligned box? */
function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, bx1: number, by1: number, bx2: number, by2: number): boolean {
  const inside = (x: number, y: number): boolean => x >= bx1 && x <= bx2 && y >= by1 && y <= by2;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  // Liang–Barsky clip.
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const checks: [number, number][] = [[-dx, x1 - bx1], [dx, bx2 - x1], [-dy, y1 - by1], [dy, by2 - y1]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

interface LabelSeg { x1: number; y1: number; x2: number; y2: number; owner: string }

/** Picks, among candidate centres, the one whose box crosses the fewest
 *  segments of OTHER edges (ties → the earlier candidate, i.e. the preferred
 *  side). A label laid across a stroke reads as struck through. */
function pickLabelSpot(cands: { x: number; y: number }[], w: number, h: number, segs: LabelSeg[], owner: string): { x: number; y: number } {
  let best = cands[0];
  let bestHits = Infinity;
  for (const c of cands) {
    let hits = 0;
    for (const s of segs) {
      if (s.owner === owner) continue;
      if (segmentHitsBox(s.x1, s.y1, s.x2, s.y2, c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2)) hits++;
    }
    if (hits < bestHits) { bestHits = hits; best = c; if (hits === 0) break; }
  }
  return best;
}

export function graphSvg(g: Graph, opts: FigureOptions, width = 460, height = 320): string {
  const n = g.names.length;
  const cx = width / 2, cy = (height - 24) / 2;
  const longest = g.names.reduce((m, s) => Math.max(m, s.length), 1);
  let r = Math.max(11, Math.min(22, Math.ceil(longest * 3.1) + 5));
  let R = Math.min(cx, cy) - r - 22;
  const spacing = n > 1 ? (2 * Math.PI * R) / n : Infinity;
  const compact = spacing < 2 * r + 3;
  if (compact) { r = 4; R = Math.min(cx, cy) - 44; }
  const fs = r >= 16 ? 11 : 10;
  const pos: { x: number; y: number; ang: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = n === 1 ? -Math.PI / 2 : -Math.PI / 2 + (2 * Math.PI * i) / n;
    pos.push(n === 1 ? { x: cx, y: cy, ang } : { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang });
  }
  const f = (v: number): string => v.toFixed(1);
  const hiE = opts.highlightEdges || new Set<number>();
  const hiV = opts.highlightVerts || new Set<number>();
  const hollow = opts.hollowVerts || new Set<number>();

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Georgia,serif">`;
  out += `<rect width="${width}" height="${height}" fill="#fff"/>`;
  if (g.directed) {
    out += `<defs>` +
      `<marker id="gArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${INK}"/></marker>` +
      `<marker id="gArrowHi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${ACCENT}"/></marker>` +
      `</defs>`;
  }

  // Group edges by unordered pair so parallel (and mutual) edges fan out.
  const groups = new Map<string, number[]>();
  // Label placement is decided AFTER every edge's geometry is known, so a
  // label can dodge the other chords that cross it in a circular layout.
  const segs: LabelSeg[] = [];
  const pending: { owner: string; cands: { x: number; y: number }[]; label: string; hi: boolean }[] = [];
  for (const e of g.edges) {
    const key = `${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`;
    const list = groups.get(key);
    if (list) list.push(e.id); else groups.set(key, [e.id]);
  }
  const labels: string[] = [];
  const edgeMarkup: string[] = [];
  const hiMarkup: string[] = [];
  for (const [, ids] of groups) {
    ids.forEach((eid, j) => {
      const e = g.edges[eid];
      const hi = hiE.has(eid);
      const stroke = hi ? ACCENT : INK;
      const sw = hi ? 2.6 : 1.2;
      const marker = g.directed ? ` marker-end="url(#${hi ? "gArrowHi" : "gArrow"})"` : "";
      const label = opts.edgeLabels?.get(eid) ?? (g.weighted ? fmtW(e.w) : "");
      let d: string;
      let cands: { x: number; y: number }[];
      const owner = String(eid);
      if (e.u === e.v) {
        const p = pos[e.u];
        // Radially outward from the layout centre, so the loop and its label
        // sit outside the ring of chords rather than across a neighbour's edge.
        const dl = Math.hypot(p.x - cx, p.y - cy);
        const ox = dl > 1 ? (p.x - cx) / dl : 0, oy = dl > 1 ? (p.y - cy) / dl : -1;
        const tx = -oy, ty = ox;
        const ca = Math.cos(0.42), sa = Math.sin(0.42);
        const s0 = { x: p.x + r * (ox * ca - tx * sa), y: p.y + r * (oy * ca - ty * sa) };
        const e0 = { x: p.x + r * (ox * ca + tx * sa), y: p.y + r * (oy * ca + ty * sa) };
        const c1 = { x: p.x + (r + 30) * ox - 28 * tx, y: p.y + (r + 30) * oy - 28 * ty };
        const c2 = { x: p.x + (r + 30) * ox + 28 * tx, y: p.y + (r + 30) * oy + 28 * ty };
        d = `M${f(s0.x)} ${f(s0.y)} C${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(e0.x)} ${f(e0.y)}`;
        cands = [{ x: p.x + (r + 32) * ox, y: p.y + (r + 32) * oy }, { x: p.x + (r + 40) * ox, y: p.y + (r + 40) * oy }];
      } else {
        const a = pos[e.u], b = pos[e.v];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        // Offset perpendicular to the canonical (min→max) orientation so mutual arcs separate.
        const sign = e.u < e.v ? 1 : -1;
        const off = ids.length === 1 ? 0 : (j - (ids.length - 1) / 2) * 16 * sign;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const c = { x: mx - uy * off * 2, y: my + ux * off * 2 };
        const trim = (from: { x: number; y: number }, toward: { x: number; y: number }, by: number): { x: number; y: number } => {
          const tx = toward.x - from.x, ty = toward.y - from.y, tl = Math.hypot(tx, ty) || 1;
          return { x: from.x + (tx / tl) * by, y: from.y + (ty / tl) * by };
        };
        const s = trim(a, c, r);
        const t = trim(b, c, r + (g.directed ? 2 : 0));
        d = off === 0 ? `M${f(s.x)} ${f(s.y)} L${f(t.x)} ${f(t.y)}` : `M${f(s.x)} ${f(s.y)} Q${f(c.x)} ${f(c.y)} ${f(t.x)} ${f(t.y)}`;
        // The label sits BESIDE the edge, not on it: 11 px along the normal,
        // on the outer side of a curved edge, so the stroke never crosses the
        // text (the figure-layout gate reads an on-line label as a strikethrough).
        // Straight chord: the side facing AWAY from the layout centre, where
        // other chords do not cross. Curved pair: the outer side of the bulge.
        const outward = (mx - cx) * -uy + (my - cy) * ux >= 0 ? 1 : -1;
        const side = off === 0 ? outward : Math.sign(off);
        // Candidates in preference order: the outward side at the midpoint,
        // then along the edge, then the other side — the first with no crossing wins.
        const at = (frac: number, dist: number, sg: number): { x: number; y: number } => {
          const bx = (1 - frac) * (1 - frac) * s.x + 2 * (1 - frac) * frac * c.x + frac * frac * t.x;
          const by = (1 - frac) * (1 - frac) * s.y + 2 * (1 - frac) * frac * c.y + frac * frac * t.y;
          return { x: bx - uy * dist * sg, y: by + ux * dist * sg };
        };
        cands = [at(0.5, 11, side), at(0.35, 11, side), at(0.65, 11, side), at(0.5, 18, side), at(0.25, 11, side), at(0.75, 11, side),
          at(0.5, 11, -side), at(0.35, 11, -side), at(0.65, 11, -side), at(0.5, 18, -side)];
        if (off === 0) segs.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, owner });
        else { segs.push({ x1: s.x, y1: s.y, x2: c.x, y2: c.y, owner }); segs.push({ x1: c.x, y1: c.y, x2: t.x, y2: t.y, owner }); }
      }
      const path = `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${marker}/>`;
      (hi ? hiMarkup : edgeMarkup).push(path);
      if (label && !compact) pending.push({ owner, cands, label, hi });
    });
  }
  for (const q of pending) {
    const wpx = q.label.length * 5.4 + 4;
    const spot = pickLabelSpot(q.cands, wpx, 11, segs, q.owner);
    const lx = spot.x, ly = spot.y;
    labels.push(`<rect x="${f(lx - wpx / 2)}" y="${f(ly - 6)}" width="${f(wpx)}" height="11" fill="#fff" fill-opacity="0.85"/>` +
      `<text x="${f(lx)}" y="${f(ly + 3)}" text-anchor="middle" font-size="9" fill="${q.hi ? ACCENT : MUTED}">${escapeXml(q.label)}</text>`);
  }
  out += edgeMarkup.join("") + hiMarkup.join("") + labels.join("");

  for (let v = 0; v < n; v++) {
    const p = pos[v];
    const hi = hiV.has(v);
    const fill = hollow.has(v) ? "#fff" : FILL;
    out += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${r}" fill="${fill}" stroke="${hi ? ACCENT : INK}" stroke-width="${hi ? 2.4 : 1}"/>`;
    const name = escapeXml(g.names[v]);
    if (!compact) {
      out += `<text x="${f(p.x)}" y="${f(p.y + fs * 0.36)}" text-anchor="middle" font-size="${fs}" fill="${INK}">${name}</text>`;
    } else {
      const lx = p.x + 12 * Math.cos(p.ang), ly = p.y + 12 * Math.sin(p.ang);
      const anchor = Math.cos(p.ang) > 0.3 ? "start" : Math.cos(p.ang) < -0.3 ? "end" : "middle";
      out += `<text x="${f(lx)}" y="${f(ly + 3)}" text-anchor="${anchor}" font-size="8" fill="${INK}">${name}</text>`;
    }
  }
  out += `<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="10" fill="${INK}">${escapeXml(clip(opts.caption, 95))}</text>`;
  out += `</svg>`;
  return out;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

function basicCaveats(g: Graph): string[] {
  const out: string[] = [];
  out.push(`Caps: ${MAX_VERTICES} vertices and ${MAX_EDGES} edges; the figure is a circular layout in name order, not a planar embedding.`);
  if (g.unweightedEdges > 0) out.push(`${plural(g.unweightedEdges, "edge")} had no weight and ${g.unweightedEdges === 1 ? "was" : "were"} taken as 1.`);
  if (g.selfLoops > 0) out.push(`${plural(g.selfLoops, "self-loop")} present: each adds 2 to its vertex's degree (1 in, 1 out when directed) and must be traversed by an Eulerian trail.`);
  if (g.parallel > 0) out.push(`${plural(g.parallel, "parallel edge")} present: counted separately in degrees and trails; the lighter one is what a shortest path or spanning tree uses.`);
  return out;
}

function headline(g: Graph): string {
  const n = g.names.length, m = g.edges.length;
  let s = `${vcount(n)}, ${plural(m, "edge")} — ${g.directed ? "directed" : "undirected"}, ${g.weighted ? "weighted" : "unweighted"}`;
  if (g.selfLoops) s += `, ${plural(g.selfLoops, "self-loop")}`;
  if (g.parallel) s += `, ${plural(g.parallel, "parallel edge")}`;
  return s;
}

function degreeLines(g: Graph): string[] {
  const { deg, inn, out } = degrees(g);
  if (g.directed) {
    return wrapLines("Degrees (in/out): ", g.names.map((nm, v) => `${nm}: ${inn[v]}/${out[v]}`));
  }
  return wrapLines("Degrees: ", g.names.map((nm, v) => `${nm}: ${deg[v]}`));
}

function finish(g: Graph, title: string, display: string[], steps: string[], caveats: string[], fig: FigureOptions): DiscreteResult {
  const svg = graphSvg(g, fig);
  const alt = `${g.directed ? "Directed" : "Undirected"} graph with ${g.names.length} vertices and ${g.edges.length} edges drawn in a circle. ${fig.caption}`;
  return { title, display, steps, caveats, svg, alt };
}

/** The graph engine. null = not an edge list; DiscreteError = recognised but refused. */
export function tryGraph(input: string): DiscreteResult | null {
  const parsed = parseGraph(input);
  if (!parsed) return null;
  const { graph: g, question: q } = parsed;
  switch (q.kind) {
    case "default": return answerDefault(g);
    case "shortest": return answerShortest(g, q.from, q.to);
    case "mst": return answerMst(g);
    case "euler": return answerEuler(g);
    case "hamilton": return answerHamilton(g);
    case "bipartite": return answerBipartite(g);
    case "components": return answerComponents(g);
    case "topo": return answerTopo(g);
    case "degree": return answerDegree(g);
    case "bfs": return answerSearch(g, q.from, "bfs");
    case "dfs": return answerSearch(g, q.from, "dfs");
    case "diameter": return answerDiameter(g);
    case "tree": return answerTree(g);
  }
}

function describeComponents(g: Graph): { display: string[]; steps: string[] } {
  const weak = weakComponents(g);
  const display: string[] = [];
  const steps: string[] = [];
  if (!g.directed) {
    display.push(weak.length === 1 ? "Connected: yes (1 component)" : `Connected: no — ${plural(weak.length, "component")}`);
    if (weak.length > 1) steps.push(...wrapLines("Components: ", weak.map((c) => setStr(g, c, 10))));
  } else {
    const strong = strongComponents(g);
    display.push(weak.length === 1 ? "Weakly connected: yes" : `Weakly connected: no — ${plural(weak.length, "weak component")}`);
    display.push(strong.length === 1 ? "Strongly connected: yes (every vertex reaches every other)" : `Strongly connected: no — ${plural(strong.length, "strongly connected component")}`);
    if (weak.length > 1) steps.push(...wrapLines("Weak components: ", weak.map((c) => setStr(g, c, 10))));
    if (strong.length > 1) steps.push(...wrapLines("Strongly connected components (Tarjan): ", strong.map((c) => setStr(g, c, 10))));
  }
  return { display, steps };
}

function describeBipartite(g: Graph): { line: string; detail: string[]; fig: Partial<FigureOptions> } {
  const b = bipartition(g);
  if ("parts" in b) {
    return {
      line: `Bipartite: yes — parts ${setStr(g, b.parts[0])} and ${setStr(g, b.parts[1])}`,
      detail: [`2-colouring by breadth-first search: ${vcount(b.parts[0].length)} in part 1 (filled), ${b.parts[1].length} in part 2 (hollow); every edge joins the two parts.`],
      fig: { hollowVerts: new Set(b.parts[1]) },
    };
  }
  const len = b.oddCycle.length;
  const hiE = new Set<number>();
  for (let i = 0; i < len; i++) {
    const a = b.oddCycle[i], c = b.oddCycle[(i + 1) % len];
    const e = g.edges.find((x) => (x.u === a && x.v === c) || (x.u === c && x.v === a));
    if (e) hiE.add(e.id);
  }
  return {
    line: `Bipartite: no — odd cycle of length ${len}: ${cycleStr(g, b.oddCycle, true)}`,
    detail: [`An odd cycle cannot be 2-coloured, so no bipartition exists${g.directed ? " (direction ignored)" : ""}.`],
    fig: { highlightEdges: hiE, highlightVerts: new Set(b.oddCycle) },
  };
}

function describeEuler(g: Graph): { line: string; detail: string[]; fig: Partial<FigureOptions>; caveat?: string } {
  const e = eulerTrail(g);
  const m = g.edges.length;
  if (e.kind === "none") return { line: `Eulerian: neither circuit nor path — ${e.reason}`, detail: [], fig: {} };
  const labels = new Map<number, string>();
  e.trailEdges.forEach((eid, i) => labels.set(eid, String(i + 1)));
  const distinct = new Set(e.trailEdges).size;
  const ok = e.trailEdges.length === m && distinct === m && e.trail.length === m + 1;
  const start = g.names[e.trail[0]], end = g.names[e.trail[e.trail.length - 1]];
  const line = e.kind === "circuit"
    ? `Eulerian circuit: yes — ${seqStr(g, e.trail, undefined, false, 30)}`
    : `Eulerian path (open trail) from ${start} to ${end}: ${seqStr(g, e.trail, undefined, false, 30)}`;
  const detail = [
    e.kind === "circuit"
      ? (g.directed ? "Every vertex has in-degree = out-degree and the edges are connected, so a closed trail using every edge once exists (Hierholzer)." : "Every vertex has even degree and the edges are connected, so a closed trail using every edge once exists (Hierholzer).")
      : (g.directed ? `${start} has out − in = 1 and ${end} has in − out = 1; all others balance, so an open trail exists (Hierholzer).` : `Exactly two vertices have odd degree (${start}, ${end}), so an open trail between them exists (Hierholzer).`),
    `The trail uses all ${m} edges exactly once (numbered along the figure).`,
  ];
  return { line, detail, fig: { edgeLabels: labels, highlightEdges: new Set(e.trailEdges), highlightVerts: new Set([e.trail[0], e.trail[e.trail.length - 1]]) }, caveat: ok ? undefined : "Cross-check FAILED: the Eulerian trail does not use every edge exactly once — treat this result as a defect." };
}

function describeCycle(g: Graph): { lines: string[]; detail: string[]; fig: Partial<FigureOptions> } {
  const n = g.names.length, m = g.edges.length;
  if (!g.directed) {
    const cyc = findCycleUndirected(g);
    if (!cyc) {
      const comps = weakComponents(g).length;
      const line = comps === 1 ? `Tree: yes — connected with no cycle (${m} edges = ${n} − 1)` : `Tree: no — a forest of ${comps} trees (no cycle, but disconnected)`;
      return { lines: [line], detail: [], fig: {} };
    }
    const hiE = new Set<number>();
    if (cyc.length === 1) { const e = g.edges.find((x) => x.u === cyc[0] && x.v === cyc[0]); if (e) hiE.add(e.id); }
    else for (let i = 0; i < cyc.length; i++) {
      const a = cyc[i], c = cyc[(i + 1) % cyc.length];
      const e = g.edges.find((x) => !hiE.has(x.id) && ((x.u === a && x.v === c) || (x.u === c && x.v === a)));
      if (e) hiE.add(e.id);
    }
    const what = cyc.length === 1 ? "self-loop" : cyc.length === 2 ? "parallel edges form a cycle" : `cycle of length ${cyc.length}`;
    return { lines: [`Tree: no — ${what}: ${cycleStr(g, cyc)}`], detail: [], fig: { highlightEdges: hiE, highlightVerts: new Set(cyc) } };
  }
  const cyc = findCycleDirected(g);
  if (!cyc) {
    const order = topologicalOrder(g) || [];
    return {
      lines: [`Acyclic (DAG): yes — topological order ${seqStr(g, order, undefined, false, 30)}`],
      detail: ["Topological order by Kahn's algorithm, alphabetically-first available vertex each step."],
      fig: {},
    };
  }
  const hiE = new Set<number>();
  for (let i = 0; i < cyc.length; i++) {
    const e = g.edges.find((x) => x.u === cyc[i] && x.v === cyc[(i + 1) % cyc.length]);
    if (e) hiE.add(e.id);
  }
  return { lines: [`Acyclic (DAG): no — directed cycle: ${cycleStr(g, cyc)}`], detail: [], fig: { highlightEdges: hiE, highlightVerts: new Set(cyc) } };
}

function answerDefault(g: Graph): DiscreteResult {
  const display: string[] = [headline(g)];
  const steps: string[] = [];
  const caveats = basicCaveats(g);
  const comps = describeComponents(g);
  display.push(...comps.display);
  steps.push(...degreeLines(g));
  steps.push(...comps.steps);
  const bip = describeBipartite(g);
  display.push(bip.line);
  const eul = describeEuler(g);
  display.push(eul.line);
  if (eul.caveat) caveats.push(eul.caveat);
  const cyc = describeCycle(g);
  display.push(...cyc.lines);
  steps.push(...bip.detail, ...eul.detail, ...cyc.detail);
  const fig: FigureOptions = { caption: `Graph: ${headline(g).split(" — ")[0]}${g.directed ? ", directed" : ""}`, hollowVerts: bip.fig.hollowVerts };
  // Default figure: weights stay visible on a weighted graph; on an unweighted
  // one the Eulerian trail is numbered along the edges when there is one.
  // Either way a cycle, when there is one, is highlighted.
  if (eul.fig.edgeLabels && !g.weighted) { fig.edgeLabels = eul.fig.edgeLabels; fig.caption += " — Eulerian trail numbered"; }
  else if (cyc.fig.highlightEdges) { fig.highlightEdges = cyc.fig.highlightEdges; fig.highlightVerts = cyc.fig.highlightVerts; fig.caption += " — cycle highlighted"; }
  return finish(g, "Graph", display, steps, caveats, fig);
}

function answerShortest(g: Graph, fromName: string, toName: string): DiscreteResult {
  const s = vertexIndex(g, fromName, "Start");
  const t = vertexIndex(g, toName, "End");
  const steps: string[] = [];
  const caveats = basicCaveats(g);
  let dist: number[], pred: number[];
  let method: string;
  if (!g.negative) {
    const r = dijkstra(g, s);
    dist = r.dist; pred = r.pred;
    method = g.weighted ? "Dijkstra" : "breadth-first search (all weights 1)";
    steps.push(`Settled in order (distance from ${g.names[s]}): ` + listCut(r.order.map((v) => `${g.names[v]} ${fmtW(r.dist[v])}`), 14));
  } else {
    const r = bellmanFord(g, s);
    if (r.negCycle) {
      const total = cycleWeight(g, r.negCycle);
      throw new DiscreteError(`Shortest path is undefined: the negative cycle ${cycleStr(g, r.negCycle)} (total ${fmtW(total)}) is reachable from ${g.names[s]} — every pass around it lowers the distance without bound${g.directed ? "" : " (an undirected negative edge can be traversed back and forth)"}.`);
    }
    dist = r.dist; pred = r.pred;
    method = "Bellman–Ford (negative weights present)";
    const show = Math.min(r.snapshots.length, 4);
    for (let i = 0; i < show; i++) {
      steps.push(`Round ${i + 1}: ` + listCut(g.names.map((nm, v) => `${nm} ${Number.isFinite(r.snapshots[i][v]) ? fmtW(r.snapshots[i][v]) : "∞"}`), 12));
    }
    if (r.snapshots.length > show) steps.push(`… ${r.snapshots.length - show} more rounds; distances stable after round ${r.rounds} (no negative cycle reachable).`);
    else steps.push(`Distances stable after round ${r.rounds}; a further pass relaxes nothing, so no negative cycle is reachable from ${g.names[s]}.`);
  }
  const path = buildPath(g, pred, s, t);
  if (!path || !Number.isFinite(dist[t])) {
    const reach = g.names.filter((_, v) => Number.isFinite(dist[v]));
    return finish(g, "Shortest path",
      [`No path from ${g.names[s]} to ${g.names[t]} — ${g.names[t]} is not reachable${g.directed ? " along the arrows" : ""}.`],
      [...steps, `Reachable from ${g.names[s]}: ${listCut(reach, 15)}`], caveats,
      { caption: `Graph: ${vcount(g.names.length)}, ${plural(g.edges.length, "edge")} — ${g.names[t]} unreachable from ${g.names[s]}`, highlightVerts: new Set([s, t]) });
  }
  const resum = path.edges.reduce((acc, eid) => acc + g.edges[eid].w, 0);
  if (Math.abs(resum - dist[t]) > 1e-9 * Math.max(1, Math.abs(resum))) caveats.push("Cross-check FAILED: re-summing the path's edges does not give the reported distance — treat this result as a defect.");
  const display = [
    `Shortest path ${g.names[s]} → ${g.names[t]}: ${seqStr(g, path.verts, path.edges)}`,
    `${g.weighted ? "Length" : "Length (edges)"}: ${fmtW(dist[t])}${path.edges.length !== 1 ? ` over ${plural(path.edges.length, "edge")}` : ""}`,
  ];
  steps.unshift(`Method: ${method}.`);
  steps.push(...wrapLines(`Distances from ${g.names[s]}: `, g.names.map((nm, v) => `${nm}: ${Number.isFinite(dist[v]) ? fmtW(dist[v]) : "∞"}`)));
  if (g.weighted) steps.push(`Re-summed along the path: ${path.edges.map((eid) => fmtW(g.edges[eid].w)).join(" + ")} = ${fmtW(resum)} ✓`);
  return finish(g, "Shortest path", display, steps, caveats, {
    caption: `Graph: ${vcount(g.names.length)}, ${plural(g.edges.length, "edge")} — shortest path ${g.names[s]}→${g.names[t]} highlighted, length ${fmtW(dist[t])}`,
    highlightEdges: new Set(path.edges), highlightVerts: new Set([s, t]),
  });
}

function cycleWeight(g: Graph, cyc: number[]): number {
  let total = 0;
  for (let i = 0; i < cyc.length; i++) {
    const a = cyc[i], b = cyc[(i + 1) % cyc.length];
    let best = Infinity;
    for (const e of g.edges) {
      if ((e.u === a && e.v === b) || (!g.directed && e.u === b && e.v === a)) best = Math.min(best, e.w);
    }
    total += Number.isFinite(best) ? best : 0;
  }
  return total;
}

function answerMst(g: Graph): DiscreteResult {
  if (g.directed) {
    throw new DiscreteError("A minimum spanning tree is defined for undirected graphs; this graph is directed (A->B). A minimum spanning arborescence (Edmonds) is not offered — write the edges as A-B for a spanning tree.");
  }
  const r = kruskal(g);
  const caveats = basicCaveats(g);
  const n = g.names.length;
  const forest = r.components > 1;
  const resum = r.chosen.reduce((acc, eid) => acc + g.edges[eid].w, 0);
  if (Math.abs(resum - r.total) > 1e-9 * Math.max(1, Math.abs(resum)) || r.chosen.length !== n - r.components) {
    caveats.push("Cross-check FAILED: the chosen edges do not re-sum to the reported total or are the wrong number for a spanning forest — treat this result as a defect.");
  }
  const title = forest ? "Minimum spanning forest" : "Minimum spanning tree";
  const display = [
    `${title}: ${plural(r.chosen.length, "edge")}, total weight ${fmtW(r.total)}`,
  ];
  if (forest) display.push(`The graph is disconnected (${plural(r.components, "component")}), so this is a minimum spanning forest — one tree per component.`);
  const steps: string[] = ["Kruskal: edges in non-decreasing weight (ties by alphabetical endpoint pair, then input order); an edge is taken unless it closes a cycle (union-find)."];
  let running = 0;
  const chosenSet = new Set(r.chosen);
  // Present in Kruskal's examination order: chosen and rejected interleaved by weight.
  const orderAll = kruskalOrder(g, r);
  let shown = 0;
  for (const eid of orderAll) {
    const e = g.edges[eid];
    if (shown >= 24) { steps.push(`… ${orderAll.length - shown} more edges examined`); break; }
    shown++;
    if (chosenSet.has(eid)) { running += e.w; steps.push(`take ${g.names[e.u]}–${g.names[e.v]} (${fmtW(e.w)}) — running total ${fmtW(running)}`); }
    else steps.push(`skip ${g.names[e.u]}–${g.names[e.v]} (${fmtW(e.w)}) — would close a cycle`);
  }
  if (forest) {
    const comps = weakComponents(g);
    steps.push(...wrapLines("Per component: ", comps.map((c) => {
      const inC = new Set(c);
      const sum = r.chosen.filter((eid) => inC.has(g.edges[eid].u)).reduce((acc, eid) => acc + g.edges[eid].w, 0);
      return `${setStr(g, c, 6)} total ${fmtW(sum)}`;
    })));
  }
  if (!g.weighted) caveats.push("No weights were given, so every edge counts 1 and any spanning tree is minimum; the one shown is Kruskal's with the pinned tie-break.");
  if (g.selfLoops) caveats.push("Self-loops are never spanning-tree edges and were skipped.");
  return finish(g, title, display, steps, caveats, {
    caption: `Graph: ${vcount(n)}, ${plural(g.edges.length, "edge")} — ${forest ? "minimum spanning forest" : "minimum spanning tree"} highlighted, total ${fmtW(r.total)}`,
    highlightEdges: chosenSet,
  });
}

/** Kruskal's examination order (same sort as kruskal()), restricted to edges it looked at. */
function kruskalOrder(g: Graph, r: MstResult): number[] {
  const looked = new Set([...r.chosen, ...r.rejected]);
  const key = (e: GEdge): string => {
    const a = g.names[e.u], b = g.names[e.v];
    return cmpName(a, b) <= 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  };
  return g.edges.filter((e) => looked.has(e.id)).sort((a, b) => a.w - b.w || cmpName(key(a), key(b)) || a.id - b.id).map((e) => e.id);
}

function answerEuler(g: Graph): DiscreteResult {
  const d = describeEuler(g);
  const caveats = basicCaveats(g);
  if (d.caveat) caveats.push(d.caveat);
  const { deg, inn, out } = degrees(g);
  const steps = g.directed
    ? wrapLines("In/out degrees: ", g.names.map((nm, v) => `${nm}: ${inn[v]}/${out[v]}`))
    : wrapLines("Degrees: ", g.names.map((nm, v) => `${nm}: ${deg[v]}${deg[v] % 2 ? " (odd)" : ""}`));
  steps.push(...d.detail);
  const n = g.names.length, m = g.edges.length;
  const fig: FigureOptions = { caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — ${d.fig.edgeLabels ? "Eulerian trail numbered along the edges" : "no Eulerian trail"}`, ...d.fig };
  return finish(g, "Eulerian trail", [d.line], steps, caveats, fig);
}

function answerHamilton(g: Graph): DiscreteResult {
  const n = g.names.length, m = g.edges.length;
  if (n > MAX_HAMILTONIAN_VERTICES) {
    throw new DiscreteError(`Hamiltonian cycle/path is NP-hard; this engine searches exhaustively only up to ${MAX_HAMILTONIAN_VERTICES} vertices, and this graph has ${n}.`);
  }
  const caveats = basicCaveats(g);
  const cyc = hamiltonian(g, true);
  const steps = [`Exhaustive search by dynamic programming over all 2^${n} vertex subsets (${1 << n} states × ${n} end-vertices) — every Hamiltonian cycle and path is accounted for.`];
  const fig: FigureOptions = { caption: `Graph: ${vcount(n)}, ${plural(m, "edge")}` };
  const edgesAlong = (verts: number[], closed: boolean): Set<number> => {
    const hi = new Set<number>();
    const steps2 = closed ? verts.length : verts.length - 1;
    for (let i = 0; i < steps2; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const e = g.edges.find((x) => (x.u === a && x.v === b) || (!g.directed && x.u === b && x.v === a));
      if (e) hi.add(e.id);
    }
    return hi;
  };
  if (cyc) {
    fig.highlightEdges = edgesAlong(cyc, true);
    fig.caption += " — Hamiltonian cycle highlighted";
    return finish(g, "Hamiltonian cycle", [`Hamiltonian cycle: yes — ${cycleStr(g, cyc)}`, "(a Hamiltonian path exists too: drop any edge of the cycle)"], steps, caveats, fig);
  }
  const path = hamiltonian(g, false);
  if (path) {
    fig.highlightEdges = edgesAlong(path, false);
    fig.highlightVerts = new Set([path[0], path[path.length - 1]]);
    fig.caption += " — Hamiltonian path highlighted (no cycle)";
    return finish(g, "Hamiltonian path", [
      `Hamiltonian cycle: none exists (proved by exhaustive search${n < 3 ? "; a cycle needs at least 3 vertices" : ""}).`,
      `Hamiltonian path: yes — ${seqStr(g, path, undefined, false)}`,
    ], steps, caveats, fig);
  }
  fig.caption += " — no Hamiltonian cycle or path";
  return finish(g, "Hamiltonian path", ["Hamiltonian cycle: none exists.", "Hamiltonian path: none exists (proved by exhaustive search)."], steps, caveats, fig);
}

function answerBipartite(g: Graph): DiscreteResult {
  const d = describeBipartite(g);
  const n = g.names.length, m = g.edges.length;
  const caveats = basicCaveats(g);
  if (g.directed) caveats.push("Bipartiteness ignores edge direction.");
  return finish(g, "Bipartite", [d.line], d.detail, caveats, {
    caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — ${"hollowVerts" in d.fig ? "bipartition: filled vs hollow vertices" : "odd cycle highlighted"}`,
    ...d.fig,
  });
}

function answerComponents(g: Graph): DiscreteResult {
  const c = describeComponents(g);
  const n = g.names.length, m = g.edges.length;
  const steps = [...c.steps];
  if (!g.directed && weakComponents(g).length === 1) steps.push("Every vertex is reachable from every other.");
  return finish(g, "Components", c.display, steps, basicCaveats(g), {
    caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — ${c.display[0].replace(/^(Weakly c|C)onnected: /, "connected: ")}`,
  });
}

function answerTopo(g: Graph): DiscreteResult {
  if (!g.directed) throw new DiscreteError("A topological order is defined for directed graphs; this graph is undirected (A-B). Write the edges as A->B.");
  const n = g.names.length, m = g.edges.length;
  const order = topologicalOrder(g);
  if (!order) {
    const cyc = findCycleDirected(g)!;
    throw new DiscreteError(`No topological order exists: the graph has the directed cycle ${cycleStr(g, cyc)}.`);
  }
  return finish(g, "Topological order", [`Topological order: ${seqStr(g, order, undefined, false, 40)}`],
    ["Kahn's algorithm: repeatedly remove a vertex with no incoming edges; ties broken alphabetically (so this is one valid order among possibly many).",
      `Every edge u→v has u before v in the order (${m} edges checked).`],
    basicCaveats(g), { caption: `DAG: ${vcount(n)}, ${plural(m, "edge")} — topological order ${clip(order.map((v) => g.names[v]).join(", "), 50)}` });
}

function answerDegree(g: Graph): DiscreteResult {
  const { deg, inn, out } = degrees(g);
  const n = g.names.length, m = g.edges.length;
  const display: string[] = [];
  const steps: string[] = [];
  if (g.directed) {
    display.push(...wrapLines("In/out degrees: ", g.names.map((nm, v) => `${nm}: in ${inn[v]}, out ${out[v]}`)));
    steps.push(`Sum of in-degrees = sum of out-degrees = ${m} = number of edges.`);
  } else {
    display.push(...wrapLines("Degrees: ", g.names.map((nm, v) => `${nm}: ${deg[v]}`)));
    const seq = deg.slice().sort((a, b) => b - a);
    display.push(`Degree sequence: ${listCut(seq.map(String), 30)}`);
    steps.push(`Handshake check: degrees sum to ${deg.reduce((a, b) => a + b, 0)} = 2 × ${m} edges.`);
    const max = Math.max(...deg), min = Math.min(...deg);
    steps.push(max === min ? `Regular: every vertex has degree ${max}.` : `Maximum degree ${max}, minimum degree ${min}.`);
  }
  return finish(g, "Degrees", display, steps, basicCaveats(g), { caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — degree table in the text` });
}

function answerSearch(g: Graph, fromName: string, kind: "bfs" | "dfs"): DiscreteResult {
  const s = vertexIndex(g, fromName, "Start");
  const n = g.names.length, m = g.edges.length;
  const r = kind === "bfs" ? bfs(g, s) : dfs(g, s);
  const unreached = g.names.filter((_, v) => !r.order.includes(v));
  const display = [`${kind === "bfs" ? "Breadth-first" : "Depth-first"} order from ${g.names[s]}: ${seqStr(g, r.order, undefined, false, 40).replace(/ [–→] /g, ", ")}`];
  const steps: string[] = ["Neighbours are visited in name order (pinned), so the order is deterministic."];
  if (kind === "bfs") {
    const d = (r as ReturnType<typeof bfs>).dist;
    steps.push(...wrapLines("Levels: ", r.order.map((v) => `${g.names[v]}: ${d[v]}`)));
  }
  if (unreached.length) display.push(`Not reached: ${listCut(unreached, 15)}`);
  return finish(g, kind === "bfs" ? "Breadth-first search" : "Depth-first search", display, steps, basicCaveats(g), {
    caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — ${kind.toUpperCase()} tree from ${g.names[s]} highlighted`,
    highlightEdges: new Set(r.treeEdges), highlightVerts: new Set([s]),
  });
}

function answerDiameter(g: Graph): DiscreteResult {
  if (g.negative) throw new DiscreteError("Diameter is not defined with negative edge weights (shortest paths would be unbounded or ill-defined); remove the negative weights.");
  const n = g.names.length, m = g.edges.length;
  const r = diameter(g);
  const caveats = basicCaveats(g);
  if (!Number.isFinite(r.diameter)) {
    return finish(g, "Diameter", [`Diameter: infinite — the graph is ${g.directed ? "not strongly connected" : "disconnected"}, so some pair has no path.`],
      [`${plural(weakComponents(g).length, "weak component")}${g.directed ? `, ${plural(strongComponents(g).length, "strongly connected component")}` : ""}.`], caveats,
      { caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — diameter infinite (${g.directed ? "not strongly connected" : "disconnected"})` });
  }
  const display = [
    `Diameter: ${fmtW(r.diameter)} — between ${g.names[r.from]} and ${g.names[r.to]}: ${r.path ? seqStr(g, r.path.verts, r.path.edges) : ""}`,
  ];
  const radius = Math.min(...r.ecc);
  const centre = g.names.filter((_, v) => r.ecc[v] === radius);
  display.push(`Radius: ${fmtW(radius)} (centre: ${listCut(centre, 10)})`);
  const steps = [`All-pairs shortest paths by ${g.weighted ? "Dijkstra from every vertex" : "breadth-first search from every vertex"}; the diameter is the largest eccentricity.`];
  steps.push(...wrapLines("Eccentricities: ", g.names.map((nm, v) => `${nm}: ${fmtW(r.ecc[v])}`)));
  return finish(g, "Diameter", display, steps, caveats, {
    caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — diameter ${fmtW(r.diameter)} path highlighted`,
    highlightEdges: new Set(r.path ? r.path.edges : []), highlightVerts: new Set([r.from, r.to]),
  });
}

function answerTree(g: Graph): DiscreteResult {
  const n = g.names.length, m = g.edges.length;
  const c = describeCycle(g);
  const display = [...c.lines];
  const steps = [...c.detail];
  const caveats = basicCaveats(g);
  if (g.directed) {
    // Rooted tree (arborescence): underlying graph is a tree and exactly one root with in-degree 0, all others in-degree 1.
    const { inn } = degrees(g);
    const und = weakComponents(g).length === 1 && m === n - 1;
    const roots = g.names.filter((_, v) => inn[v] === 0);
    const ok = und && roots.length === 1 && inn.every((d) => d <= 1);
    display.push(ok ? `Rooted tree (arborescence): yes — root ${roots[0]}, every other vertex has in-degree 1` : `Rooted tree (arborescence): no${!und ? " — the underlying undirected graph is not a tree" : roots.length !== 1 ? ` — ${roots.length} vertices have in-degree 0` : " — some vertex has in-degree above 1"}`);
  } else if (!c.fig.highlightEdges) {
    steps.push(`A tree on ${n} vertices has exactly ${n - 1} edges; this graph has ${m}.`);
  }
  return finish(g, "Tree test", display, steps, caveats, {
    caption: `Graph: ${vcount(n)}, ${plural(m, "edge")} — ${c.fig.highlightEdges ? "cycle highlighted" : g.directed ? "acyclic" : "no cycle"}`,
    ...c.fig,
  });
}
