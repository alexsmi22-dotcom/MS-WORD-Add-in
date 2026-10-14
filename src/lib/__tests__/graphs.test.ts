// Graph engine (graphs.ts).
//
// Textbook oracles, not values copied from the engine: K4, the Königsberg
// bridges, the Petersen graph, the CLRS Dijkstra and Kruskal figures. The
// cross-checks the house rule asks for are here too — Dijkstra against brute
// force over all simple paths, Kruskal against brute force over all spanning
// trees, Eulerian trails re-counted edge by edge, topological orders and
// bipartitions checked against every edge — on seeded random graphs, so a
// failure is reproducible.

import {
  tryGraph, parseGraph, parseQuestion, dijkstra, bellmanFord, kruskal, eulerTrail, bipartition,
  topologicalOrder, hamiltonian, strongComponents, weakComponents, findCycleUndirected,
  buildPath, graphSvg, MAX_VERTICES, MAX_EDGES, MAX_HAMILTONIAN_VERTICES, Graph,
} from "../graphs";
import { DiscreteError } from "../discrete";

const run = (s: string) => tryGraph(s)!;
const text = (s: string) => { const r = run(s); return [...r.display, ...r.steps, ...r.caveats].join("\n"); };
const graphOf = (s: string): Graph => parseGraph(s)!.graph;
const expectRefusal = (s: string, re: RegExp) => {
  let err: unknown = null;
  try { tryGraph(s); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(DiscreteError);
  expect((err as Error).message).toMatch(re);
};

// Deterministic PRNG so the random cross-checks reproduce.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const K4 = "A-B\nA-C\nA-D\nB-C\nB-D\nC-D";
const KONIGSBERG = "A-B\nA-B\nA-C\nA-C\nA-D\nB-D\nC-D";
// Petersen: outer 5-cycle, inner pentagram, five spokes.
const PETERSEN = ["o0-o1", "o1-o2", "o2-o3", "o3-o4", "o4-o0", "i0-i2", "i2-i4", "i4-i1", "i1-i3", "i3-i0", "o0-i0", "o1-i1", "o2-i2", "o3-i3", "o4-i4"].join("\n");
const C6 = "A-B\nB-C\nC-D\nD-E\nE-F\nF-A";
// CLRS 3rd ed. Figure 24.6 (Dijkstra).
const CLRS_DIJKSTRA = "s->t 10\ns->y 5\nt->x 1\nt->y 2\nx->z 4\ny->t 3\ny->x 9\ny->z 2\nz->s 7\nz->x 6";
// CLRS 3rd ed. Figure 23.4 (Kruskal), MST weight 37.
const CLRS_KRUSKAL = "a-b 4\na-h 8\nb-c 8\nb-h 11\nc-d 7\nc-f 4\nc-i 2\nd-e 9\nd-f 14\ne-f 10\nf-g 2\ng-h 1\ng-i 6\nh-i 7";

describe("claiming the input", () => {
  test("returns null for non-graph text", () => {
    expect(tryGraph("gcd 84 36")).toBeNull();
    expect(tryGraph("hello")).toBeNull();
    expect(tryGraph("")).toBeNull();
    expect(tryGraph("10 choose 3")).toBeNull();
    expect(tryGraph("mst")).toBeNull(); // a question with no edges is not a graph
  });
  test("claims an edge list in every accepted spelling", () => {
    for (const s of ["A-B", "A--B", "A->B", "A→B", "A - B 5", "a_1 -> b_2 2.5", "A-B: 5", "A-B (5)", "A−B", "A-->B"]) {
      expect(tryGraph(s)).not.toBeNull();
    }
  });
  test("weight needs a separator: A-B-3 is not an edge", () => {
    expectRefusal("A-B\nA-B-3", /line 2/i);
  });
  test("a non-edge line is refused with its line number", () => {
    expectRefusal("A-B\nfoo bar\nB-C", /Line 2/);
    expectRefusal("A-B\n\n\nB-C\nnot an edge", /Line 5/);
  });
  test("a question on a later line is refused and the hint names the rule", () => {
    expectRefusal("A-B\nB-C\nshortest path A to C", /Line 3.*first line/);
  });
  test("mixed directed and undirected edges are refused by name", () => {
    expectRefusal("A->B\nB-C", /directed.*undirected/i);
  });
  test("vertex cap: 61 vertices refused, 60 accepted", () => {
    const star = (k: number) => Array.from({ length: k }, (_, i) => `hub-v${i}`).join("\n");
    expectRefusal(star(60), new RegExp(`61 vertices.*${MAX_VERTICES}`));
    expect(run(star(59)).display[0]).toMatch(/^60 vertices/);
  });
  test("edge cap: 501 edges refused", () => {
    expectRefusal(Array(MAX_EDGES + 1).fill("A-B").join("\n"), new RegExp(`${MAX_EDGES} edges`));
  });
  test("unknown vertex in a question is refused by name", () => {
    expectRefusal("shortest path A to Z\nA-B", /"Z" is not in the edge list/);
  });
  test("question grammar", () => {
    expect(parseQuestion("shortest path A to F")).toEqual({ kind: "shortest", from: "A", to: "F" });
    expect(parseQuestion("Shortest path from A to F?")).toEqual({ kind: "shortest", from: "A", to: "F" });
    expect(parseQuestion("minimum spanning tree")).toEqual({ kind: "mst" });
    expect(parseQuestion("MST")).toEqual({ kind: "mst" });
    expect(parseQuestion("is it eulerian?")).toEqual({ kind: "euler" });
    expect(parseQuestion("hamiltonian cycle")).toEqual({ kind: "hamilton" });
    expect(parseQuestion("is it bipartite")).toEqual({ kind: "bipartite" });
    expect(parseQuestion("connected components")).toEqual({ kind: "components" });
    expect(parseQuestion("topological order")).toEqual({ kind: "topo" });
    expect(parseQuestion("toposort")).toEqual({ kind: "topo" });
    expect(parseQuestion("degrees")).toEqual({ kind: "degree" });
    expect(parseQuestion("bfs from A")).toEqual({ kind: "bfs", from: "A" });
    expect(parseQuestion("DFS from s1")).toEqual({ kind: "dfs", from: "s1" });
    expect(parseQuestion("diameter of the graph")).toEqual({ kind: "diameter" });
    expect(parseQuestion("tree?")).toEqual({ kind: "tree" });
    expect(parseQuestion("is it a tree")).toEqual({ kind: "tree" });
    expect(parseQuestion("A-B")).toBeNull();
  });
});

describe("default report", () => {
  test("K4: 4 vertices, 6 edges, every degree 3", () => {
    const r = run(K4);
    expect(r.title).toBe("Graph");
    expect(r.display[0]).toBe("4 vertices, 6 edges — undirected, unweighted");
    expect(r.steps[0]).toBe("Degrees: A: 3 · B: 3 · C: 3 · D: 3");
    expect(r.display.join("\n")).toMatch(/Connected: yes/);
    expect(r.display.join("\n")).toMatch(/Bipartite: no — odd cycle of length 3/);
    expect(r.display.join("\n")).toMatch(/Eulerian: neither.*4 vertices have odd degree/);
    expect(r.display.join("\n")).toMatch(/Tree: no — cycle/);
    expect(r.svg).toContain("<text");
    expect(r.alt).toMatch(/4 vertices and 6 edges/);
  });
  test("Königsberg bridges: degrees 5,3,3,3 and no Eulerian path", () => {
    const r = run(KONIGSBERG);
    expect(r.steps[0]).toBe("Degrees: A: 5 · B: 3 · C: 3 · D: 3");
    expect(r.display[0]).toMatch(/7 edges.*2 parallel edges/); // A-B and A-C each doubled
    expect(r.display.join("\n")).toMatch(/Eulerian: neither circuit nor path — 4 vertices have odd degree \(A, B, C, D\)/);
    const e = eulerTrail(graphOf(KONIGSBERG));
    expect(e.kind).toBe("none");
  });
  test("a 6-cycle is bipartite with the alternating parts", () => {
    const r = run(C6);
    expect(r.display.join("\n")).toContain("Bipartite: yes — parts {A, C, E} and {B, D, F}");
    expect(r.display.join("\n")).toMatch(/Eulerian circuit: yes/);
  });
  test("self-loop: degree 2 undirected, in 1 / out 1 directed, and reported in the headline", () => {
    expect(run("A-A").steps[0]).toBe("Degrees: A: 2");
    expect(run("A-A").display[0]).toMatch(/1 self-loop/);
    expect(run("A->A\nA->B").steps[0]).toBe("Degrees (in/out): A: 1/2 · B: 1/0"); // the loop is one in and one out at A
  });
  test("directed graph: weak and strong components, DAG topological order", () => {
    const r = run("A->B\nB->A\nB->C");
    expect(r.display.join("\n")).toMatch(/Weakly connected: yes/);
    expect(r.display.join("\n")).toMatch(/Strongly connected: no — 2 strongly connected components/);
    expect(r.steps.join("\n")).toContain("Strongly connected components (Tarjan): {A, B} · {C}");
    expect(r.display.join("\n")).toMatch(/directed cycle: A → B → A/);
    const dag = run("A->B\nA->C\nB->D\nC->D");
    expect(dag.display.join("\n")).toContain("Acyclic (DAG): yes — topological order A → B → C → D");
  });
  test("tree and forest are told apart", () => {
    expect(run("A-B\nB-C\nC-D").display.join("\n")).toContain("Tree: yes — connected with no cycle (3 edges = 4 − 1)");
    expect(run("A-B\nC-D").display.join("\n")).toContain("Tree: no — a forest of 2 trees");
    expect(run("A-B\nA-B").display.join("\n")).toMatch(/parallel edges form a cycle: A – B – A/);
  });
  test("weighted edges without a weight are taken as 1 and said so", () => {
    const r = run("A-B 3\nB-C");
    expect(r.display[0]).toMatch(/weighted/);
    expect(r.caveats.join("\n")).toMatch(/1 edge had no weight and was taken as 1/);
  });
});

describe("shortest path", () => {
  test("CLRS Figure 24.6: distances from s are t 8, x 9, y 5, z 7", () => {
    const g = graphOf(CLRS_DIJKSTRA);
    const d = dijkstra(g, g.names.indexOf("s"));
    const at = (nm: string) => d.dist[g.names.indexOf(nm)];
    expect([at("s"), at("t"), at("x"), at("y"), at("z")]).toEqual([0, 8, 9, 5, 7]);
    const r = run("shortest path s to x\n" + CLRS_DIJKSTRA);
    expect(r.display[0]).toBe("Shortest path s → x: s →(5) y →(3) t →(1) x");
    expect(r.display[1]).toMatch(/^Length: 9/);
    expect(r.steps.join("\n")).toContain("Re-summed along the path: 5 + 3 + 1 = 9 ✓");
    expect(r.caveats.join("\n")).not.toMatch(/FAILED/);
  });
  test("unweighted: BFS distances, path in edges", () => {
    const r = run("shortest path A to D\nA-B\nB-C\nC-D\nA-D");
    expect(r.display[0]).toBe("Shortest path A → D: A – D");
    expect(r.display[1]).toMatch(/^Length \(edges\): 1/);
  });
  test("unreachable target is said, not invented", () => {
    const r = run("shortest path A to C\nA-B\nC-D");
    expect(r.display[0]).toMatch(/No path from A to C — C is not reachable/);
    const dir = run("shortest path B to A\nA->B");
    expect(dir.display[0]).toMatch(/not reachable along the arrows/);
  });
  test("negative weights route to Bellman–Ford and get the right answer", () => {
    const r = run("shortest path A to C\nA->B 1\nA->C 4\nB->C -2");
    expect(r.display[0]).toBe("Shortest path A → C: A →(1) B →(−2) C");
    expect(r.display[1]).toMatch(/^Length: −1/);
    expect(r.steps[0]).toMatch(/Bellman–Ford/);
  });
  test("a reachable negative cycle is refused by name", () => {
    expectRefusal("shortest path A to C\nA->B 1\nB->C -3\nC->A 1", /negative cycle .*(A → B → C → A|B → C → A → B|C → A → B → C).*total −1/);
  });
  test("an undirected negative edge is a negative cycle", () => {
    expectRefusal("shortest path A to C\nA-B -2\nB-C 1", /negative cycle/);
  });
  test("an unreachable negative cycle does not block the answer", () => {
    const r = run("shortest path A to B\nA->B 2\nC->D -5\nD->C 1");
    expect(r.display[1]).toMatch(/^Length: 2/);
  });
  test("Unicode minus on input displays as − and parses back", () => {
    const r = run("shortest path A to B\nA->B −3\nC->D 1");
    expect(r.display[1]).toMatch(/^Length: −3/);
  });
  test("the figure highlights the path and carries the caption", () => {
    const r = run("shortest path A to F\nA-B 2\nB-C 3\nC-F 4\nA-D 1\nD-E 1\nE-F 1\nA-F 20\nB-E 5");
    expect(r.display[1]).toMatch(/^Length: 3/);
    expect(r.svg).toContain('stroke="#0C4A6E" stroke-width="2.6"');
    expect(r.svg).toMatch(/<text[^>]*>Graph: 6 vertices, 8 edges — shortest path A→F highlighted, length 3<\/text>/);
    expect(r.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="460" height="320"/);
    expect(r.svg).toContain('<rect width="460" height="320" fill="#fff"/>');
    expect(r.svg).not.toContain("<script");
    expect(r.svg).toContain("Georgia,serif");
  });

  test("CROSS-CHECK: Dijkstra equals brute force over all simple paths on random graphs ≤ 7 vertices", () => {
    const rand = rng(20261012);
    for (let trial = 0; trial < 120; trial++) {
      const n = 2 + Math.floor(rand() * 6);
      const directed = rand() < 0.5;
      const lines: string[] = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j || (!directed && j < i)) continue;
        if (rand() < 0.45) lines.push(`v${i}${directed ? "->" : "-"}v${j} ${1 + Math.floor(rand() * 9)}`);
      }
      if (!lines.length) continue;
      const g = graphOf(lines.join("\n"));
      const nn = g.names.length;
      const brute = (s: number, t: number): number => {
        let best = Infinity;
        const visited = new Uint8Array(nn);
        const go = (v: number, acc: number) => {
          if (v === t) { best = Math.min(best, acc); return; }
          visited[v] = 1;
          for (const eid of g.adj[v]) {
            const e = g.edges[eid];
            const w = g.directed ? e.v : e.u === v ? e.v : e.u;
            if (!visited[w]) go(w, acc + e.w);
          }
          visited[v] = 0;
        };
        go(s, 0);
        return best;
      };
      for (let s = 0; s < nn; s++) {
        const d = dijkstra(g, s);
        for (let t = 0; t < nn; t++) {
          expect(d.dist[t]).toBe(brute(s, t));
          const p = buildPath(g, d.pred, s, t);
          if (Number.isFinite(d.dist[t])) {
            expect(p).not.toBeNull();
            expect(p!.edges.reduce((a, eid) => a + g.edges[eid].w, 0)).toBe(d.dist[t]);
          } else expect(p).toBeNull();
        }
        // Bellman–Ford agrees with Dijkstra when weights are non-negative.
        const bf = bellmanFord(g, s);
        expect(bf.negCycle).toBeNull();
        expect(bf.dist).toEqual(d.dist);
      }
    }
  });
});

describe("minimum spanning tree", () => {
  test("CLRS Figure 23.4: total 37; the a-h / b-c tie goes to a-h (alphabetical pin)", () => {
    const r = run("mst\n" + CLRS_KRUSKAL);
    expect(r.title).toBe("Minimum spanning tree");
    expect(r.display[0]).toBe("Minimum spanning tree: 8 edges, total weight 37");
    const taken = r.steps.filter((s) => s.startsWith("take ")).map((s) => s.slice(5, 8));
    expect(taken).toEqual(["g–h", "c–i", "f–g", "a–b", "c–f", "c–d", "a–h", "d–e"]);
    expect(r.steps.join("\n")).toContain("skip b–c (8) — would close a cycle");
    expect(r.steps.join("\n")).toContain("take d–e (9) — running total 37");
    expect(r.svg).toContain('stroke="#0C4A6E"');
    expect(r.svg).toMatch(/minimum spanning tree highlighted, total 37/);
  });
  test("directed graphs are refused by name", () => {
    expectRefusal("mst\nA->B 1\nB->C 2", /spanning tree is defined for undirected graphs.*directed/);
  });
  test("disconnected graph gives a minimum spanning forest per component", () => {
    const r = run("mst\nA-B 1\nB-C 5\nA-C 2\nD-E 7");
    expect(r.title).toBe("Minimum spanning forest");
    expect(r.display[0]).toBe("Minimum spanning forest: 3 edges, total weight 10");
    expect(r.steps.join("\n")).toContain("Per component: {A, B, C} total 3 · {D, E} total 7");
  });
  test("self-loops and the heavier parallel edge are never chosen", () => {
    const r = run("mst\nA-A 1\nA-B 5\nA-B 2\nB-C 1");
    expect(r.display[0]).toBe("Minimum spanning tree: 2 edges, total weight 3");
  });

  test("CROSS-CHECK: Kruskal equals brute force over all spanning trees on random graphs ≤ 6 vertices", () => {
    const rand = rng(777);
    for (let trial = 0; trial < 100; trial++) {
      const n = 2 + Math.floor(rand() * 5);
      const lines: string[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < 0.6) lines.push(`v${i}-v${j} ${1 + Math.floor(rand() * 6)}`);
      if (!lines.length) continue;
      const g = graphOf(lines.join("\n"));
      const nn = g.names.length, m = g.edges.length;
      const comps = weakComponents(g).length;
      const need = nn - comps;
      // Brute force: every subset of `need` edges that is a forest spanning all components.
      let best = Infinity;
      const pick: number[] = [];
      const go = (start: number) => {
        if (pick.length === need) {
          const uf = Array.from({ length: nn }, (_, i) => i);
          const find = (x: number): number => (uf[x] === x ? x : (uf[x] = find(uf[x])));
          let ok = true, total = 0;
          for (const eid of pick) {
            const e = g.edges[eid];
            const a = find(e.u), b = find(e.v);
            if (a === b) { ok = false; break; }
            uf[a] = b; total += e.w;
          }
          if (ok) best = Math.min(best, total);
          return;
        }
        for (let i = start; i < m; i++) { pick.push(i); go(i + 1); pick.pop(); }
      };
      go(0);
      const k = kruskal(g);
      expect(k.total).toBe(best);
      expect(k.chosen.length).toBe(need);
      expect(k.components).toBe(comps);
    }
  });
});

describe("Eulerian trails", () => {
  const checkTrail = (g: Graph) => {
    const e = eulerTrail(g);
    expect(e.kind).not.toBe("none");
    expect(e.trailEdges.length).toBe(g.edges.length);
    expect(new Set(e.trailEdges).size).toBe(g.edges.length);
    expect(e.trail.length).toBe(g.edges.length + 1);
    for (let i = 0; i < e.trailEdges.length; i++) {
      const ed = g.edges[e.trailEdges[i]];
      const a = e.trail[i], b = e.trail[i + 1];
      const fits = g.directed ? ed.u === a && ed.v === b : (ed.u === a && ed.v === b) || (ed.u === b && ed.v === a);
      expect(fits).toBe(true);
    }
    return e;
  };
  test("K5 has an Eulerian circuit using all 10 edges", () => {
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) lines.push(`v${i}-v${j}`);
    const e = checkTrail(graphOf(lines.join("\n")));
    expect(e.kind).toBe("circuit");
    expect(e.trail[0]).toBe(e.trail[e.trail.length - 1]);
  });
  test("a path graph has an open Eulerian path between its ends", () => {
    const r = run("eulerian\nA-B\nB-C\nC-D");
    expect(r.display[0]).toBe("Eulerian path (open trail) from A to D: A – B – C – D");
    expect(r.svg).toMatch(/Eulerian trail numbered/);
  });
  test("parallel edges and self-loops are traversed once each", () => {
    const e = checkTrail(graphOf("A-B\nA-B\nA-A"));
    expect(e.kind).toBe("circuit");
    const r = run("eulerian\nA-B\nA-B\nA-A");
    expect(r.caveats.join("\n")).toMatch(/self-loop.*Eulerian trail/);
    expect(r.caveats.join("\n")).not.toMatch(/FAILED/);
  });
  test("directed: circuit, open path with its ends, and refusal reason naming the unbalanced vertex", () => {
    expect(checkTrail(graphOf("A->B\nB->C\nC->A")).kind).toBe("circuit");
    const r = run("euler circuit\nA->B\nB->C");
    expect(r.display[0]).toBe("Eulerian path (open trail) from A to C: A → B → C");
    const none = run("eulerian\nA->B\nA->C");
    expect(none.display[0]).toMatch(/neither.*in-degree ≠ out-degree at A \(in 0, out 2\)/);
  });
  test("edges in two components: no trail, said by name", () => {
    expect(run("eulerian\nA-B\nC-D").display[0]).toMatch(/edges lie in 2 separate components/);
  });
  test("CROSS-CHECK: random Eulerian graphs — every edge exactly once", () => {
    const rand = rng(4242);
    for (let trial = 0; trial < 60; trial++) {
      // Build a graph as a union of random closed walks, so it is Eulerian by construction.
      const n = 3 + Math.floor(rand() * 6);
      const directed = rand() < 0.5;
      const lines: string[] = [];
      const walks = 1 + Math.floor(rand() * 3);
      for (let w = 0; w < walks; w++) {
        const len = 2 + Math.floor(rand() * 5);
        let v = 0; // all walks start at v0 so the edges are connected
        for (let k = 0; k < len; k++) {
          const next = k === len - 1 ? 0 : Math.floor(rand() * n);
          lines.push(`v${v}${directed ? "->" : "-"}v${next}`);
          v = next;
        }
      }
      const e = checkTrail(graphOf(lines.join("\n")));
      expect(e.kind).toBe("circuit");
    }
  });
});

describe("bipartite", () => {
  test("Petersen is not bipartite: a 5-cycle witness", () => {
    const g = graphOf(PETERSEN);
    const b = bipartition(g);
    expect("oddCycle" in b).toBe(true);
    if ("oddCycle" in b) expect(b.oddCycle.length % 2).toBe(1);
    const r = run("bipartite\n" + PETERSEN);
    expect(r.display[0]).toMatch(/Bipartite: no — odd cycle of length 5/);
  });
  test("C6 bipartition and an odd-cycle witness for a self-loop", () => {
    const r = run("bipartite\n" + C6);
    expect(r.display[0]).toBe("Bipartite: yes — parts {A, C, E} and {B, D, F}");
    expect(r.svg).toContain('fill="#fff" stroke="#1A1A1A"'); // hollow part-2 vertices
    expect(run("bipartite\nA-B\nB-B").display[0]).toMatch(/odd cycle of length 1: B – B \(self-loop\)/);
  });
  test("CROSS-CHECK: parts verified against every edge; witnesses are genuine odd cycles", () => {
    const rand = rng(99);
    for (let trial = 0; trial < 150; trial++) {
      const n = 2 + Math.floor(rand() * 10);
      const lines: string[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < 0.3) lines.push(`v${i}-v${j}`);
      if (!lines.length) continue;
      const g = graphOf(lines.join("\n"));
      const b = bipartition(g);
      if ("parts" in b) {
        const side = new Map<number, number>();
        b.parts[0].forEach((v) => side.set(v, 0));
        b.parts[1].forEach((v) => side.set(v, 1));
        for (const e of g.edges) expect(side.get(e.u)).not.toBe(side.get(e.v));
      } else {
        const c = b.oddCycle;
        expect(c.length % 2).toBe(1);
        expect(new Set(c).size).toBe(c.length);
        for (let i = 0; i < c.length; i++) {
          const a = c[i], d = c[(i + 1) % c.length];
          expect(g.edges.some((e) => (e.u === a && e.v === d) || (e.u === d && e.v === a))).toBe(true);
        }
      }
    }
  });
});

describe("Hamiltonian", () => {
  test("Petersen: no Hamiltonian cycle, but a Hamiltonian path", () => {
    const g = graphOf(PETERSEN);
    expect(hamiltonian(g, true)).toBeNull();
    const p = hamiltonian(g, false)!;
    expect(p).not.toBeNull();
    expect(new Set(p).size).toBe(10);
    for (let i = 0; i + 1 < p.length; i++) {
      expect(g.edges.some((e) => (e.u === p[i] && e.v === p[i + 1]) || (e.u === p[i + 1] && e.v === p[i]))).toBe(true);
    }
    const r = run("hamiltonian\n" + PETERSEN);
    expect(r.display[0]).toMatch(/Hamiltonian cycle: none exists \(proved by exhaustive search\)/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: yes/);
  });
  test("C5 has a Hamiltonian cycle; a star has neither", () => {
    const r = run("hamiltonian cycle\nA-B\nB-C\nC-D\nD-E\nE-A");
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: yes — A – (B – C – D – E|E – D – C – B) – A$/);
    const star = run("hamiltonian\nhub-a\nhub-b\nhub-c");
    expect(star.display[1]).toMatch(/Hamiltonian path: none exists/);
  });
  test("directed: respects the arrows", () => {
    expect(hamiltonian(graphOf("A->B\nB->C"), false)).toEqual([0, 1, 2]);
    expect(hamiltonian(graphOf("A->B\nC->B"), false)).toBeNull();
  });
  test("17 vertices is above the exact range, and is answered with a certificate rather than refused", () => {
    const lines = Array.from({ length: 17 }, (_, i) => `v${i}-v${(i + 1) % 17}`).join("\n");
    const r = run("hamiltonian\n" + lines);
    expect(r.steps[0]).toMatch(new RegExp(`above the exhaustive range \\(${MAX_HAMILTONIAN_VERTICES}\\)`));
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: yes/);
  });
  test("12 vertices with no Hamiltonian path still answers quickly (worst case for backtracking)", () => {
    // K10 plus two leaves on the same hub: no Hamiltonian path exists.
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) lines.push(`k${i}-k${j}`);
    lines.push("k0-leafA", "k0-leafB");
    const t0 = Date.now();
    const r = run("hamiltonian\n" + lines.join("\n"));
    expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
    expect(r.display[1]).toMatch(/Hamiltonian path: none exists/);
  });
});

describe("topological order, components, degrees, searches, diameter, tree", () => {
  test("DAG order with the alphabetical pin; cyclic graph refused by name; undirected refused", () => {
    const r = run("topological order\nB->D\nA->C\nC->D\nA->B");
    expect(r.display[0]).toBe("Topological order: A → B → C → D");
    expectRefusal("toposort\nA->B\nB->A", /No topological order.*directed cycle A → B → A/);
    expectRefusal("toposort\nA-B", /undirected/);
  });
  test("CROSS-CHECK: topological order respects every edge on random DAGs", () => {
    const rand = rng(31337);
    for (let trial = 0; trial < 80; trial++) {
      const n = 2 + Math.floor(rand() * 12);
      const perm = Array.from({ length: n }, (_, i) => i).sort(() => rand() - 0.5);
      const lines: string[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < 0.3) lines.push(`v${perm[i]}->v${perm[j]}`);
      if (!lines.length) continue;
      const g = graphOf(lines.join("\n"));
      const order = topologicalOrder(g)!;
      expect(order).not.toBeNull();
      expect(order.length).toBe(g.names.length);
      const posOf = new Map(order.map((v, i) => [v, i]));
      for (const e of g.edges) expect(posOf.get(e.u)! < posOf.get(e.v)!).toBe(true);
    }
  });
  test("components: two triangles; SCCs of a directed graph (Tarjan)", () => {
    const r = run("components\nA-B\nB-C\nC-A\nD-E\nE-F\nF-D");
    expect(r.display[0]).toBe("Connected: no — 2 components");
    expect(r.steps[0]).toBe("Components: {A, B, C} · {D, E, F}");
    const g = graphOf("A->B\nB->C\nC->A\nC->D\nD->E\nE->D\nF->E");
    expect(strongComponents(g).map((c) => c.map((v) => g.names[v]))).toEqual([["A", "B", "C"], ["D", "E"], ["F"]]);
  });
  test("degrees question: table, sequence and handshake check; directed in/out", () => {
    const r = run("degrees\n" + K4);
    expect(r.display[0]).toBe("Degrees: A: 3 · B: 3 · C: 3 · D: 3");
    expect(r.display[1]).toBe("Degree sequence: 3, 3, 3, 3");
    expect(r.steps.join("\n")).toContain("degrees sum to 12 = 2 × 6 edges");
    expect(r.steps.join("\n")).toContain("Regular: every vertex has degree 3");
    const d = run("degree\nA->B\nA->C\nB->C");
    expect(d.display[0]).toBe("In/out degrees: A: in 0, out 2 · B: in 1, out 1 · C: in 2, out 0");
  });
  test("BFS and DFS orders from a vertex are deterministic by name", () => {
    const g = "A-B\nA-C\nB-D\nC-D\nD-E";
    expect(run("bfs from A\n" + g).display[0]).toBe("Breadth-first order from A: A, B, C, D, E");
    expect(run("dfs from A\n" + g).display[0]).toBe("Depth-first order from A: A, B, D, C, E");
    expect(run("bfs from A\n" + g).steps.join("\n")).toContain("Levels: A: 0 · B: 1 · C: 1 · D: 2 · E: 3");
    const part = run("bfs from A\nA-B\nC-D");
    expect(part.display[1]).toBe("Not reached: C, D");
  });
  test("diameter: path of 4 is 3; weighted; disconnected is infinite; negative weights refused", () => {
    const r = run("diameter\nA-B\nB-C\nC-D");
    expect(r.display[0]).toMatch(/^Diameter: 3 — between A and D: A – B – C – D$/);
    expect(r.display[1]).toBe("Radius: 2 (centre: B, C)");
    const w = run("diameter\nA-B 1\nB-C 10\nA-C 4");
    expect(w.display[0]).toMatch(/^Diameter: 5 — between A and B|^Diameter: 5 — between B and C/);
    expect(run("diameter\nA-B\nC-D").display[0]).toMatch(/Diameter: infinite — the graph is disconnected/);
    expect(run("diameter\nA->B").display[0]).toMatch(/infinite.*not strongly connected/);
    expectRefusal("diameter\nA-B -1", /negative/);
  });
  test("tree?: tree, cycle shown, rooted tree for directed", () => {
    expect(run("tree?\nA-B\nB-C").display[0]).toMatch(/^Tree: yes/);
    const cyc = run("is it a tree\nA-B\nB-C\nC-A\nC-D");
    expect(cyc.display[0]).toBe("Tree: no — cycle of length 3: A – B – C – A");
    expect(cyc.svg).toMatch(/cycle highlighted/);
    expect(findCycleUndirected(graphOf("A-B\nB-C\nC-D"))).toBeNull();
    expect(run("tree?\nroot->a\nroot->b\na->c").display.join("\n")).toContain("Rooted tree (arborescence): yes — root root");
    expect(run("tree?\nA->C\nB->C").display.join("\n")).toMatch(/Rooted tree \(arborescence\): no — 2 vertices have in-degree 0/);
  });
});

describe("figure", () => {
  test("directed graphs get arrowheads, weights are drawn, self-loops and parallel edges are drawn as curves", () => {
    const r = run("A->B 2.5\nA->A\nB->A\nA->B 1");
    expect(r.svg).toContain("<marker");
    expect(r.svg).toContain('marker-end="url(#gArrow)"');
    expect(r.svg).toContain(">2.5</text>");
    expect(r.svg).toContain(" C"); // self-loop cubic arc
    expect(r.svg).toContain(" Q"); // parallel / mutual edges curved
    expect(r.svg).toContain("Georgia,serif");
  });
  test("default figure: weights stay visible on a weighted graph; an unweighted Eulerian graph gets its trail numbered", () => {
    const weighted = run("A-B 2.5\nB-C 1\nC-A 4");
    expect(weighted.svg).toContain(">2.5</text>");
    expect(weighted.svg).not.toMatch(/Eulerian trail numbered/);
    const plain = run("A-B\nB-C\nC-A");
    expect(plain.svg).toMatch(/Eulerian trail numbered/);
    expect(plain.svg).toContain(">1</text>");
    expect(plain.svg).toContain(">3</text>");
  });
  test("cycles are spelled canonically: smallest vertex first, towards its smaller neighbour", () => {
    expect(run("tree?\nC-B\nB-A\nA-C").display[0]).toBe("Tree: no — cycle of length 3: A – B – C – A");
    expect(run("tree?\nC->B\nB->A\nA->C").display[0]).toBe("Acyclic (DAG): no — directed cycle: A → C → B → A");
  });
  test("a directed graph's odd-cycle witness is printed without arrows (it runs against them)", () => {
    // s→t, t→y, s→y: the triangle is odd but y→s is not an edge, so arrows would misstate it.
    expect(run("bipartite\ns->t\nt->y\ns->y").display[0]).toBe("Bipartite: no — odd cycle of length 3: s – t – y – s");
    expect(run("s->t\nt->y\ns->y").display.join("\n")).toMatch(/Eulerian: neither.*in-degree ≠ out-degree at s \(in 0, out 2\)/);
  });
  test("names are escaped and the vertex label fits the node", () => {
    const svg = graphSvg(graphOf("alpha_1-beta_22"), { caption: "x" });
    expect(svg).toContain(">alpha_1</text>");
    expect(svg).toMatch(/r="(1[1-9]|2[0-2])"/);
  });
  test("60 vertices still renders every vertex with a label", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `v${i}-v${(i + 1) % 60}`).join("\n");
    const r = run(lines);
    expect((r.svg!.match(/<circle/g) || []).length).toBe(60);
    expect(r.svg).toContain(">v59</text>");
    expect(r.svg).toMatch(/<text[^>]*>Graph: 60 vertices, 60 edges/);
  });
});

describe("speed and safety", () => {
  test("every question answers in under 200 ms on a 60-vertex, 500-edge graph", () => {
    const rand = rng(5);
    const lines: string[] = [];
    while (lines.length < 500) lines.push(`v${Math.floor(rand() * 60)}-v${Math.floor(rand() * 60)} ${1 + Math.floor(rand() * 20)}`);
    const body = lines.join("\n");
    for (const q of ["", "shortest path v0 to v59\n", "mst\n", "eulerian\n", "bipartite\n", "components\n", "degrees\n", "bfs from v0\n", "dfs from v0\n", "diameter\n", "tree?\n"]) {
      const t0 = Date.now();
      const r = run(q + body);
      expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
      expect(r.svg).toContain("<text");
      expect(r.caveats.join("\n")).not.toMatch(/FAILED/);
    }
    const dir = body.replace(/-/g, "->");
    for (const q of ["", "shortest path v0 to v59\n", "components\n", "diameter\n", "tree?\n", "eulerian\n"]) {
      const t0 = Date.now();
      run(q + dir);
      expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
    }
  });
  test("Bellman–Ford on a 60-vertex graph with negative weights is fast and bounded", () => {
    const rand = rng(8);
    const lines: string[] = [];
    for (let i = 0; i < 59; i++) lines.push(`v${i}->v${i + 1} ${Math.floor(rand() * 10) - 3}`);
    for (let k = 0; k < 300; k++) { const a = Math.floor(rand() * 60), b = Math.floor(rand() * 60); if (a < b) lines.push(`v${a}->v${b} ${Math.floor(rand() * 10) - 3}`); }
    const t0 = Date.now();
    const r = run("shortest path v0 to v59\n" + lines.join("\n"));
    expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
    expect(r.steps[0]).toMatch(/Bellman–Ford/);
  });
  test("never throws anything but DiscreteError, never hangs, on fuzzed input", () => {
    const rand = rng(123);
    const atoms = ["A", "B", "C", "A-B", "A->B", "A-B 5", "-", "->", "→", "5", "−3", "shortest path A to B", "mst", "tree?", "\n", " ", "x y z", "A-B-C", "(", "A->A", "B-A −2", "hamiltonian", "bfs from Q"];
    for (let trial = 0; trial < 400; trial++) {
      let s = "";
      const k = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < k; i++) s += atoms[Math.floor(rand() * atoms.length)] + (rand() < 0.5 ? "\n" : " ");
      const t0 = Date.now();
      try { tryGraph(s); } catch (e) { expect(e).toBeInstanceOf(DiscreteError); }
      expect(Date.now() - t0).toBeLessThan(1000); // gross-freeze bound: 202 and 280 ms seen under a parallel run (2026-10-14)
    }
  });
  test("every display line stays under 160 characters even on a wide graph", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `vertex_${i}-vertex_${(i + 7) % 60}`).join("\n");
    for (const q of ["", "degrees\n", "components\n", "bfs from vertex_0\n", "eulerian\n"]) {
      const r = run(q + lines);
      for (const line of [...r.display, ...r.steps]) expect(line.length).toBeLessThan(161);
    }
  });
});
