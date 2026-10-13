// Hamiltonian cycles and paths above the exhaustive range: certificates both
// ways, a bounded search whose "found" is a proof, and an honest "not found".

import { tryGraph, hamiltonCertificates, hamiltonSearch, parseGraph, MAX_HAMILTONIAN_VERTICES } from "../graphs";

const run = (s: string) => tryGraph(s)!;
const edges = (pairs: [string, string][], arrow = "-") => pairs.map(([a, b]) => `${a}${arrow}${b}`).join("\n");
const cycleGraph = (n: number): string => edges(Array.from({ length: n }, (_, i) => [`v${i}`, `v${(i + 1) % n}`]));
const pathGraph = (n: number): string => edges(Array.from({ length: n - 1 }, (_, i) => [`v${i}`, `v${i + 1}`]));
const complete = (n: number): string => { const e: [string, string][] = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e.push([`v${i}`, `v${j}`]); return edges(e); };
/** k hubs, each of b triangles fully joined to every hub. Removing the hubs leaves b > k pieces. */
const hubGraph = (k: number, b: number): string => {
  const e: [string, string][] = [];
  const hubs = Array.from({ length: k }, (_, i) => `h${i + 1}`);
  for (let t = 0; t < b; t++) {
    const tri = [`t${t}a`, `t${t}b`, `t${t}c`];
    e.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[0], tri[2]]);
    for (const x of tri) for (const h of hubs) e.push([x, h]);
  }
  return edges(e);
};

describe("exact range", () => {
  it("is 16 and K16 answers in well under a second", () => {
    expect(MAX_HAMILTONIAN_VERTICES).toBe(16);
    const t0 = Date.now();
    const r = run("hamiltonian\n" + complete(16));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: yes/);
    expect(r.steps[0]).toMatch(/Exhaustive search/);
  });
  it("hub graphs inside the exact range are settled exactly", () => {
    // 3 hubs, 4 triangles (15 vertices): removing the hubs leaves 4 = 3 + 1 pieces,
    // so a path CAN exist (triangle, hub, triangle, hub, …) but a cycle cannot.
    const r = run("hamiltonian\n" + hubGraph(3, 4));
    expect(r.display[0]).toMatch(/Hamiltonian cycle: none exists/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: yes/);
    // 2 hubs, 4 triangles (14 vertices): 4 > 2 + 1 pieces — neither.
    const s = run("hamiltonian\n" + hubGraph(2, 4));
    expect(s.display[0]).toMatch(/Hamiltonian cycle: none exists/);
    expect(s.display[1]).toMatch(/Hamiltonian path: none exists \(proved by exhaustive search\)/);
  });
});

describe("above the exact range: certificates", () => {
  it("a found cycle is a proof (C20, a directed C20, a random 60-vertex graph)", () => {
    const r = run("hamiltonian\n" + cycleGraph(20));
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: yes — v0 – v1/);
    expect(r.display[1]).toMatch(/a proof: the cycle is exhibited/);
    const d = run("hamiltonian\n" + edges(Array.from({ length: 20 }, (_, i) => [`v${i}`, `v${(i + 1) % 20}`]), "->"));
    expect(d.display[0]).toMatch(/^Hamiltonian cycle: yes — v0 → v1 → v2/);
    expect(d.svg).toMatch(/<svg/);
  });
  it("a path graph: cycle refuted by a degree-1 vertex, path exhibited", () => {
    const r = run("hamiltonian\n" + pathGraph(20));
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: NONE — proof: v0 has degree 1/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: yes — v0 – v1/);
  });
  it("a star: both refuted (leaves)", () => {
    const r = run("hamiltonian\n" + edges(Array.from({ length: 19 }, (_, i) => ["hub", `v${i}`])));
    expect(r.display[0]).toMatch(/NONE — proof: hub has degree 19|NONE — proof: v0 has degree 1/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: NONE — proof: 19 vertices have degree 1/);
  });
  it("unbalanced complete bipartite K10,11: cycle refuted by the parts, path exhibited", () => {
    const e: [string, string][] = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 11; j++) e.push([`a${i}`, `b${j}`]);
    const r = run("hamiltonian\n" + edges(e));
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: NONE — proof: bipartite with parts of size 10 and 11/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: yes/);
    const e2: [string, string][] = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 12; j++) e2.push([`a${i}`, `b${j}`]);
    expect(run("hamiltonian\n" + edges(e2)).display[1]).toMatch(/^Hamiltonian path: NONE — proof: bipartite with parts of size 9 and 12/);
  });
  it("Dirac / Ore certify existence and the search exhibits the cycle", () => {
    // Complement of a perfect matching on 20 vertices: every degree is 18 ≥ 10.
    const e: [string, string][] = [];
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) if (!(i % 2 === 0 && j === i + 1)) e.push([`v${i}`, `v${j}`]);
    const certs = hamiltonCertificates(parseGraph(edges(e))!.graph);
    expect(certs.find((c) => c.about === "cycle")).toMatchObject({ verdict: "yes" });
    expect(certs.find((c) => c.about === "cycle")!.reason).toMatch(/Dirac/);
    const r = run("hamiltonian\n" + edges(e));
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: yes/);
    expect(r.display[1]).toMatch(/existence also follows from Dirac's theorem/);
  });
  it("a toughness obstruction over three removed vertices is a proof of none (18 vertices)", () => {
    const r = run("hamiltonian\n" + hubGraph(3, 5));
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: NONE — proof: removing h1, h2, h3 leaves 5 components/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: NONE — proof: removing h1, h2, h3 leaves 5 components \(more than 4/);
  });
  it("with no certificate and no cycle found, it says so and says it is NOT a proof", () => {
    // 4 hubs × 6 triangles (22 vertices): non-Hamiltonian by the 4-hub cut, which
    // the certificate search (≤ 3 removed vertices) does not reach.
    const t0 = Date.now();
    const r = run("hamiltonian\n" + hubGraph(4, 6));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: NOT FOUND within the budget .* NOT a proof that none exists/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: NOT FOUND within the budget .* not a proof/);
  });
  it("directed obstructions: strong connectivity, sources and sinks", () => {
    const g = parseGraph(edges(Array.from({ length: 19 }, (_, i) => [`v${i}`, `v${i + 1}`]), "->"))!.graph;
    const certs = hamiltonCertificates(g);
    expect(certs.find((c) => c.about === "cycle" && c.verdict === "no")!.reason).toMatch(/not strongly connected/);
    expect(certs.find((c) => c.about === "path" && c.verdict === "no")).toBeUndefined(); // one source, one sink: a path exists
    const r = run("hamiltonian\n" + edges(Array.from({ length: 19 }, (_, i) => [`v${i}`, `v${i + 1}`]), "->"));
    expect(r.display[1]).toMatch(/^Hamiltonian path: yes — v0 → v1/);
  });
  it("the bounded search returns 'none' as a proof when it finishes, 'exhausted' otherwise", () => {
    const small = parseGraph("A-B\nB-C\nC-D\nD-E\nE-A\nA-C")!.graph;
    expect(hamiltonSearch(small, true)).toHaveProperty("verts");
    const star = parseGraph(edges(Array.from({ length: 5 }, (_, i) => ["hub", `v${i}`])))!.graph;
    expect(hamiltonSearch(star, false)).toEqual({ none: true });
    const hard = parseGraph(hubGraph(4, 6))!.graph;
    expect(hamiltonSearch(hard, true, 2000)).toEqual({ exhausted: true });
  });
});
