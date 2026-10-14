// treeSvg — the shared tree/DAG figure (SCOPE-COMPUTATION-THEORY §C.1).
// Nodes are keyed by id (labels may repeat), at most MAX_DRAWN are drawn
// and the rest are counted by name, and no label can leave the canvas.

import { treeSvg, MAX_DRAWN, TreeNode, TreeEdge } from "../treeSvg";

const CHAR = 7.2;

interface Text { x: number; y: number; text: string; size: number }

/** Node/edge text elements (in viewBox units — the canvas a reader measures) and the display scale. */
function texts(svg: string): { scale: number; width: number; height: number; items: Text[] } {
  const sz = /<svg[^>]*width="([\d.]+)" height="([\d.]+)" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
  const g = /<g>([\s\S]*?)<\/g>/.exec(svg)!;
  const scale = Number(sz[1]) / Number(sz[3]);
  const items: Text[] = [];
  const re = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
  let m: RegExpExecArray | null;
  const unesc = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  while ((m = re.exec(g[1]))) items.push({ x: Number(m[1]), y: Number(m[2]), text: unesc(m[4]), size: Number(m[3]) });
  return { scale, width: Number(sz[3]), height: Number(sz[4]), items };
}

/** Every <text> (caption included) inside the viewBox, measured at 0.6 em per character. */
function allTextInside(svg: string): void {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
  const W = Number(vb[1]), H = Number(vb[2]);
  const re = /<text x="([-\d.]+)" y="([-\d.]+)"([^>]*)font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const x = Number(m[1]), y = Number(m[2]), fs = Number(m[4]);
    const len = m[5].replace(/&\w+;/g, "x").length * fs * 0.6;
    const mid = /text-anchor="middle"/.test(m[3]);
    const x0 = mid ? x - len / 2 : x, x1 = mid ? x + len / 2 : x + len;
    if (x0 < 0 || x1 > W || y - fs * 0.8 < 0 || y > H) throw new Error(`"${m[5]}" at (${x}, ${y}) leaves the ${W}x${H} canvas`);
  }
}

const nodeRects = (svg: string): number => (svg.match(/rx="4"/g) ?? []).length;

function chain(n: number): { nodes: TreeNode[]; edges: TreeEdge[] } {
  // A binary tree with n nodes, ids 0..n-1, child i has parent floor((i-1)/2).
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: String(i), label: i % 2 ? "S" : "a" });
    if (i > 0) edges.push({ from: String(Math.floor((i - 1) / 2)), to: String(i) });
  }
  return { nodes, edges };
}

describe("treeSvg", () => {
  it("draws at most MAX_DRAWN nodes and says how many were left out", () => {
    // A deep chain is narrow: the node cap is what binds.
    const nodes: TreeNode[] = Array.from({ length: 250 }, (_, i) => ({ id: "c" + i, label: "S" }));
    const edges: TreeEdge[] = nodes.slice(1).map((n, i) => ({ from: "c" + i, to: n.id }));
    const svg = treeSvg({ nodes, edges, caption: "chain" });
    expect(MAX_DRAWN).toBe(200);
    expect(nodeRects(svg)).toBe(MAX_DRAWN);
    expect(svg).toContain("chain — … 50 more nodes not drawn");
    expect((svg.match(/<line /g) ?? []).length).toBe(199);
    allTextInside(svg);
  });

  it("a bushy tree too wide to read is cut breadth-first, said by name, with depth and legible size kept", () => {
    // The figure gate's entry: 230 nodes, branching 3.
    const nodes: TreeNode[] = Array.from({ length: 230 }, (_, i) => ({ id: `n${i}`, label: `S${i % 7}` }));
    const edges: TreeEdge[] = nodes.slice(1).map((n, i) => ({ from: `n${Math.floor(i / 3)}`, to: n.id }));
    const svg = treeSvg({ nodes, edges, caption: "230-node tree" });
    const drawn = nodeRects(svg);
    expect(drawn).toBeLessThan(MAX_DRAWN);
    expect(drawn).toBeGreaterThan(20);
    expect(svg).toContain(`… ${230 - drawn} more nodes not drawn (too wide to draw legibly)`);
    const { scale, height, items } = texts(svg);
    expect(scale).toBeGreaterThanOrEqual(0.5);
    expect(new Set(items.map((t) => t.y)).size).toBeGreaterThanOrEqual(4); // several ranks, not depth 0
    expect(height).toBeGreaterThan(200);
    allTextInside(svg);
    // every drawn edge connects two drawn nodes
    expect((svg.match(/<line /g) ?? []).length).toBe(drawn - 1);
  });

  it("a 200-node binary tree is drawn legibly or cut and said", () => {
    const svg = treeSvg({ ...chain(250), caption: "parse tree" });
    expect(svg).toMatch(/parse tree — … \d+ more nodes not drawn/);
    expect(texts(svg).scale).toBeGreaterThanOrEqual(0.5);
    allTextInside(svg);
  });

  it("long labels widen the canvas (up to 640 px) and a long caption wraps inside it, below every edge", () => {
    const label = "let compose = λf.λg.λx.f (g x) : (α → β) → (γ → α) → γ → β";
    const svg = treeSvg({
      nodes: [{ id: "r", label }, { id: "a", label }, { id: "b", label: "λf.λg.λx.f (g x) : (α → β) → (γ → α) → γ → β" }],
      edges: [{ from: "r", to: "a" }, { from: "r", to: "b" }],
      caption: "Algorithm W derivation — every judgement Γ ⊢ e : τ with the substitution applied, " + "x".repeat(10) + " and a long tail of explanation that must wrap",
    });
    allTextInside(svg);
    expect(Number(/width="([\d.]+)"/.exec(svg)![1])).toBeGreaterThan(460);
    expect(Number(/width="([\d.]+)"/.exec(svg)![1])).toBeLessThanOrEqual(640);
    const capYs = [...svg.matchAll(/<text x="18" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(capYs.length).toBeGreaterThan(1);
    const lineYs = [...svg.matchAll(/<line [^>]*y2="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...capYs)).toBeGreaterThan(Math.max(...lineYs) + 22);
  });

  it("two equal-label siblings are two nodes", () => {
    const svg = treeSvg({
      nodes: [{ id: "r", label: "S" }, { id: "l", label: "S" }, { id: "rr", label: "S" }],
      edges: [{ from: "r", to: "l" }, { from: "r", to: "rr" }],
    });
    expect(nodeRects(svg)).toBe(3);
    expect((svg.match(/>S<\/text>/g) ?? []).length).toBe(3);
    const t = texts(svg).items;
    const xs = t.filter((i) => i.y > t[0].y).map((i) => i.x);
    expect(xs.length).toBe(2);
    expect(Math.abs(xs[0] - xs[1])).toBeGreaterThanOrEqual(22 + 14 - 0.5); // width + SEP
  });

  it("a DAG with a shared child places it once, below both parents", () => {
    const svg = treeSvg({
      dag: true,
      nodes: [{ id: "1", label: "{¬P(x), Q(x)}" }, { id: "2", label: "{P(a)}" }, { id: "3", label: "{¬Q(a)}" }, { id: "4", label: "{Q(a)}" }, { id: "5", label: "□", kind: "box" }],
      edges: [{ from: "1", to: "4" }, { from: "2", to: "4" }, { from: "4", to: "5" }, { from: "3", to: "5" }],
    });
    expect(nodeRects(svg)).toBe(5);
    expect((svg.match(/>\{Q\(a\)\}<\/text>/g) ?? []).length).toBe(1);
    const t = texts(svg).items;
    const y = (label: string): number => t.find((i) => i.text === label)!.y;
    expect(y("{Q(a)}")).toBeGreaterThan(y("{¬P(x), Q(x)}"));
    expect(y("{Q(a)}")).toBeGreaterThan(y("{P(a)}"));
    expect(y("□")).toBeGreaterThan(y("{Q(a)}"));
    expect(y("□")).toBeGreaterThan(y("{¬Q(a)}"));
    expect((svg.match(/<line /g) ?? []).length).toBe(4);
  });

  it("no label text exceeds the canvas, even when the layout is scaled down", () => {
    const wide: TreeNode[] = [{ id: "root", label: "S" }];
    const edges: TreeEdge[] = [];
    for (let i = 0; i < 40; i++) {
      wide.push({ id: "k" + i, label: "<a long nonterminal name " + i + ">" });
      edges.push({ from: "root", to: "k" + i });
    }
    const svg = treeSvg({ nodes: wide, edges, caption: "wide" });
    const { scale, width, items } = texts(svg);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.5);
    expect(items.length).toBeGreaterThan(1);
    for (const it of items) {
      const half = (it.text.length * CHAR) / 2;
      expect(it.x - half).toBeGreaterThanOrEqual(0);
      expect(it.x + half).toBeLessThanOrEqual(width);
    }
    allTextInside(svg);
    // The caption DISPLAYS at 11px: its font is enlarged by 1/scale.
    const capFont = Number(/font-size="([\d.]+)"[^>]*>wide[^<]*<\/text>/.exec(svg)![1]);
    expect(capFont * scale).toBeCloseTo(11, 0);
  });

  it("every drawn edge connects two drawn nodes (endpoints are node centres)", () => {
    const spec = chain(60);
    const svg = treeSvg(spec);
    const centres = new Set<string>();
    const rectRe = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="22" rx="4"/g;
    let m: RegExpExecArray | null;
    while ((m = rectRe.exec(svg))) {
      const cx = Math.round((Number(m[1]) + Number(m[3]) / 2) * 10) / 10;
      centres.add(`${cx},${Math.round((Number(m[2]) + 22) * 10) / 10}`); // bottom
      centres.add(`${cx},${Math.round(Number(m[2]) * 10) / 10}`); // top
    }
    const lineRe = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g;
    let lines = 0;
    while ((m = lineRe.exec(svg))) {
      lines++;
      expect(centres.has(`${Number(m[1])},${Number(m[2])}`)).toBe(true);
      expect(centres.has(`${Number(m[3])},${Number(m[4])}`)).toBe(true);
    }
    expect(lines).toBe(59);
  });

  it("subtrees do not collide: a deep narrow subtree beside a wide one keeps SEP at every depth", () => {
    // Left child: a chain of 4 wide labels; right child: a chain of 4 wide labels.
    // The naive "leaves evenly spaced, parents centred" layout would stack the
    // internal nodes of both chains on top of each other.
    const nodes: TreeNode[] = [{ id: "r", label: "S" }];
    const edges: TreeEdge[] = [];
    for (const side of ["L", "R"]) {
      let prev = "r";
      for (let d = 0; d < 4; d++) {
        const id = side + d;
        nodes.push({ id, label: "<" + side.toLowerCase() + "ong label " + d + ">" });
        edges.push({ from: prev, to: id });
        prev = id;
      }
    }
    const svg = treeSvg({ nodes, edges });
    const { items, scale } = texts(svg);
    const byRow = new Map<number, Text[]>();
    for (const it of items) (byRow.get(it.y) ?? byRow.set(it.y, []).get(it.y)!).push(it);
    for (const row of byRow.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].x - row[i - 1].x - ((row[i].text.length + row[i - 1].text.length) / 2) * CHAR * scale;
        expect(gap).toBeGreaterThan(0);
      }
    }
  });

  it("⊥ and □ leaves, highlighted nodes and edge labels render", () => {
    const svg = treeSvg({
      nodes: [{ id: "a", label: "p?" }, { id: "b", label: "", kind: "bottom" }, { id: "c", label: "", kind: "box", highlight: true }],
      edges: [{ from: "a", to: "b", label: "p = T" }, { from: "a", to: "c", label: "p = F", highlight: true }],
    });
    expect(svg).toContain(">⊥</text>");
    expect(svg).toContain(">□</text>");
    expect(svg).toContain("p = T");
    expect(svg).toContain('stroke="#d62728"');
    expect(svg).toContain('fill="#ffe8a3"');
  });

  it("an empty spec is still a valid svg", () => {
    expect(treeSvg({ nodes: [], edges: [] })).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });
});
