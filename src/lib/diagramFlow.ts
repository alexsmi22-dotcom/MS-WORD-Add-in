// Block diagrams, flowcharts and state diagrams (docs/SCOPE-DIAGRAMS.md): parsed from short text into a graph, laid
// out in layers (longest path, cycles broken at back edges, barycentre ordering), edges routed orthogonally — down
// between layers, back edges and long edges in channels to the right — and drawn in USPTO style by diagramCore.

import {
  DiagramOptions,
  DiagramResult,
  FONT_PT,
  MAX_SHEETS,
  SHEET_HEIGHT_PT,
  SHEET_WIDTH_PT,
  LINE_HEIGHT,
  NUMERAL,
  arrowhead,
  f,
  finishFigure,
  leadLine,
  polyline,
  text,
  textW,
  wrap,
} from "./diagramCore";

export type FlowKind = "block" | "flowchart" | "state";
type Shape = "box" | "diamond" | "start" | "end" | "state" | "initial" | "final";

export interface FlowNode {
  id: string;
  label: string;
  numeral: string | null;
  shape: Shape;
}
export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  arrow: boolean;
  dashed: boolean;
  /** An arrowhead at both ends ("<->"): one line, not two. */
  both?: boolean;
}
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  errors: string[];
  notes: string[];
}

// A trailing ":" with nothing after it is an empty label, never part of the target's name.
const EDGE = /^(.+?)\s*(<->|-->|->|<-|--|→|←)\s*(.+?)(?:\s*:\s*(.*))?$/;
const MAX_NODES = 80;
const MAX_EDGES = 240;
const MAX_LABEL = 160;

/** Parses the text of a block diagram, flowchart or state diagram. */
export function parseFlow(kind: FlowKind, input: string): FlowGraph {
  const g: FlowGraph = { nodes: [], edges: [], errors: [], notes: [] };
  const byId = new Map<string, FlowNode>();
  const add = (id: string, label: string, shape: Shape, lineNo: number): FlowNode | null => {
    const prev = byId.get(id);
    if (prev) {
      if (label && prev.label && prev.label !== label) g.errors.push(`Line ${lineNo}: “${id}” is defined twice (“${prev.label}” and “${label}”).`);
      return prev;
    }
    if (g.nodes.length >= MAX_NODES) {
      if (!g.errors.some((e) => e.startsWith("More than"))) g.errors.push(`More than ${MAX_NODES} boxes — split the figure.`);
      return null;
    }
    const n: FlowNode = { id, label, numeral: NUMERAL.test(id) ? id : null, shape };
    byId.set(id, n);
    g.nodes.push(n);
    return n;
  };
  const explicitFrom = new Set<string>();
  const sequence: FlowNode[] = [];
  const pendingRefs: Array<{ id: string; line: number }> = [];
  let terminals = 0;
  const lines = input.split(/\r\n|\r|\n/).map((l, i) => ({ t: l.trim(), n: i + 1 })).filter((l) => l.t && !/^#(\s|$|[^\d])/.test(l.t));
  for (const { t, n } of lines) {
    // Flowchart "410 yes -> 415": an exit with its label written first.
    const labelled = kind === "flowchart" ? /^(\S+)\s+([^\s<>-]+)\s*->\s*(\S+)$/.exec(t) : null;
    const em = labelled ? null : EDGE.exec(t);
    if (labelled || em) {
      let from = labelled ? labelled[1] : em![1].trim();
      let to = labelled ? labelled[3] : em![3].trim();
      let op = labelled ? "->" : em![2];
      // "B <- A" is "A -> B".
      if (op === "<-" || op === "←") [from, to, op] = [to, from, "->"];
      const lab = labelled ? labelled[2] : (em![4] ?? "").trim();
      if (kind === "state") {
        // [*] as a source is the initial pseudo-state, as a target the final one.
        if (from === "[*]") (from = "__init"), add(from, "", "initial", n);
        if (to === "[*]") (to = "__final"), add(to, "", "final", n);
        for (const s of [from, to]) if (!byId.has(s)) add(s, s, "state", n);
      } else {
        pendingRefs.push({ id: from, line: n }, { id: to, line: n });
      }
      if (g.edges.length >= MAX_EDGES) {
        if (!g.errors.some((x) => x.startsWith("More than"))) g.errors.push(`More than ${MAX_EDGES} arrows — split the figure.`);
        continue;
      }
      if (lab.length > MAX_LABEL) g.errors.push(`Line ${n}: an arrow label of ${lab.length} characters — keep it under ${MAX_LABEL}.`);
      g.edges.push({ from, to, label: lab, arrow: op !== "--", dashed: op === "-->", ...(op === "<->" ? { both: true } : {}) });
      explicitFrom.add(from);
      continue;
    }
    if (kind === "flowchart" && /^(start|begin|end|stop)\b/i.test(t)) {
      const isEnd = /^(end|stop)/i.test(t);
      const node = add(`__t${terminals++}`, t.replace(/^(start|begin|end|stop)\s*/i, "") || (isEnd ? "End" : "Start"), isEnd ? "end" : "start", n);
      if (node) sequence.push(node);
      continue;
    }
    const decision = kind === "flowchart" && t.startsWith("?");
    const body = decision ? t.slice(1).trim() : t;
    const m = /^(\S+)\s+(.+)$/.exec(body);
    if (!m) {
      g.errors.push(`Line ${n}: “${t}” is not a box (“104 Control circuit”) or an arrow (“104 -> 112”).`);
      continue;
    }
    if (m[2].length > MAX_LABEL) g.errors.push(`Line ${n}: a label of ${m[2].length} characters — keep it under ${MAX_LABEL}.`);
    const node = add(m[1], m[2], decision ? "diamond" : kind === "state" ? "state" : "box", n);
    if (node) sequence.push(node);
  }
  // "end" and "start" in an arrow name the flowchart's own terminals (410 yes -> end).
  if (kind === "flowchart") {
    const ends = g.nodes.filter((x) => x.shape === "end"), starts = g.nodes.filter((x) => x.shape === "start");
    const alias = (id: string): string => (/^(end|stop)$/i.test(id) && ends.length && !byId.has(id) ? ends[ends.length - 1].id : /^(start|begin)$/i.test(id) && starts.length && !byId.has(id) ? starts[0].id : id);
    for (const e of g.edges) (e.from = alias(e.from)), (e.to = alias(e.to));
    for (const r of pendingRefs) r.id = alias(r.id);
    for (const id of [...explicitFrom]) if (alias(id) !== id) explicitFrom.add(alias(id));
  }
  // A reference to a box never defined is refused by name, never drawn as an empty box.
  for (const r of pendingRefs) {
    if (!byId.has(r.id) && !g.errors.some((e) => e.includes(`“${r.id}”, which`))) {
      // "410 not ready -> 405": a label of more than one word written where a one-word exit label goes.
      const [first, ...more] = r.id.split(/\s+/);
      if (more.length && byId.has(first)) g.errors.push(`Line ${r.line}: “${r.id}” — a label of more than one word goes after a colon: “${first} -> … : ${more.join(" ")}”.`);
      else g.errors.push(`Line ${r.line}: an arrow refers to “${r.id}”, which is not defined — add a line “${r.id} label”.`);
    }
  }
  // Flowchart: each step leads to the next as listed — unless it has its own exits, is a decision, or is an end.
  if (kind === "flowchart") {
    // Two steps listed after a decision and both reached from it are its two branches: the first is never chained to
    // the second (that would draw a connection nobody wrote); it says it has no exit instead. A step a decision loops
    // BACK to (listed before it) is not a branch, and keeps its own chain.
    const at = new Map(sequence.map((s, i) => [s.id, i]));
    const siblings = (a: string, b: string): boolean =>
      sequence.some(
        (d, di) =>
          d.shape === "diamond" &&
          [a, b].every((t) => (at.get(t) ?? -1) > di && g.edges.some((e) => e.from === d.id && e.to === t)),
      );
    for (let i = 0; i < sequence.length - 1; i++) {
      const s = sequence[i];
      if (explicitFrom.has(s.id) || s.shape === "diamond" || s.shape === "end") continue;
      if (siblings(s.id, sequence[i + 1].id)) {
        g.notes.push(`Step ${s.numeral ?? s.label} is a branch with no exit — add “${s.id} -> …” (or it ends there).`);
        continue;
      }
      g.edges.push({ from: s.id, to: sequence[i + 1].id, label: "", arrow: true, dashed: false });
    }
    for (const s of sequence.filter((x) => x.shape === "diamond")) {
      const n = g.edges.filter((e) => e.from === s.id).length;
      if (n < 2) g.errors.push(`Decision ${s.numeral ?? s.label} needs two exits (“${s.id} yes -> …” and “${s.id} no -> …”).`);
      if (n > 2) g.errors.push(`Decision ${s.numeral ?? s.label} has ${n} exits — a patent flowchart decision has two; split it into two decisions.`);
    }
  }
  // A box nothing connects to is drawn, and said: it is usually a missing arrow.
  if (!g.errors.length && g.nodes.length > 1)
    for (const nd of g.nodes) if (!g.edges.some((e) => e.from === nd.id || e.to === nd.id)) g.notes.push(`${nd.shape === "start" ? "Start" : nd.shape === "end" ? "End" : `“${nd.numeral ?? nd.label}”`} is not connected to anything.`);
  if (!g.nodes.length && !g.errors.length) g.errors.push("Nothing to draw yet.");
  return g;
}

export interface PlacedNode {
  node: FlowNode;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}
export interface Route {
  edge: FlowEdge;
  pts: Array<[number, number]>;
  labelAt: [number, number, "start" | "middle" | "end"] | null;
}
export interface FlowLayout {
  placed: PlacedNode[];
  routes: Route[];
  width: number;
  height: number;
}

const MAX_TEXT_W = 190;
const PAD = 9;
const V_GAP = 46;

/** Places the boxes and routes the edges. */
export function layoutFlow(kind: FlowKind, graph: FlowGraph, opts: DiagramOptions = {}): FlowLayout {
  const style = opts.numerals ?? "inside";
  const nodes = graph.nodes;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const out: number[][] = nodes.map(() => []);
  for (const e of graph.edges) out[idx.get(e.from)!].push(idx.get(e.to)!);

  // Back edges by DFS in listing order: a cycle is broken where it closes.
  const back = new Set<string>();
  const seen = nodes.map(() => 0);
  const dfs = (u: number): void => {
    seen[u] = 1;
    for (const v of out[u]) {
      if (seen[v] === 1) back.add(`${u}>${v}`);
      else if (seen[v] === 0) dfs(v);
    }
    seen[u] = 2;
  };
  nodes.forEach((_, i) => seen[i] === 0 && dfs(i));
  const fwd = (u: number, v: number): boolean => u !== v && !back.has(`${u}>${v}`);

  // Layers: longest path from the sources.
  const layer = nodes.map(() => 0);
  for (let pass = 0; pass <= nodes.length; pass++) {
    let changed = false;
    nodes.forEach((_, u) => out[u].forEach((v) => {
      if (fwd(u, v) && layer[v] < layer[u] + 1) (layer[v] = layer[u] + 1), (changed = true);
    }));
    if (!changed) break;
  }

  // Sizes.
  const placed: PlacedNode[] = nodes.map((node, i) => {
    if (node.shape === "initial") return { node, lines: [], x: 0, y: 0, w: 14, h: 14, layer: layer[i] };
    if (node.shape === "final") return { node, lines: [], x: 0, y: 0, w: 18, h: 18, layer: layer[i] };
    const lines = wrap(node.label, MAX_TEXT_W);
    if (style === "inside" && node.numeral) lines.push(node.numeral);
    const tw = Math.max(...lines.map((l) => textW(l)));
    let w = tw + 2 * PAD + (node.shape === "start" || node.shape === "end" ? FONT_PT : 0);
    let h = (lines.length - 1) * LINE_HEIGHT + FONT_PT + 2 * PAD;
    if (node.shape === "diamond") (w = Math.max(w * 1.6, h * 2.2)), (h = h * 1.9);
    // Wide enough that side-by-side duplicates, and arrows from several sources, all meet its flat top or bottom.
    const pairs = new Map<string, number>();
    for (const e of graph.edges) if (e.from !== e.to && (e.from === node.id || e.to === node.id)) pairs.set(`${e.from}>${e.to}`, (pairs.get(`${e.from}>${e.to}`) ?? 0) + 1);
    const lanes = Math.max(1, ...pairs.values(), new Set(graph.edges.filter((e) => e.to === node.id && e.from !== node.id).map((e) => e.from)).size);
    const rx = node.shape === "start" || node.shape === "end" ? h / 2 : node.shape === "state" ? 10 : 0;
    if (node.shape !== "diamond") w = Math.max(w, 2 * rx + (lanes - 1) * 14 + 12);
    return { node, lines, x: 0, y: 0, w, h, layer: layer[i] };
  });

  // Order within layers: listing order, then barycentre sweeps.
  const nLayers = nodes.length ? Math.max(...layer) + 1 : 0;
  let rows: number[][] = Array.from({ length: nLayers }, (_, L) => nodes.map((_, i) => i).filter((i) => layer[i] === L));
  const preds = nodes.map((_, v) => nodes.map((_, u) => u).filter((u) => out[u].includes(v) && fwd(u, v)));
  const succs = nodes.map((_, u) => out[u].filter((v) => fwd(u, v)));
  for (let sweep = 0; sweep < 4; sweep++) {
    const pos = new Map<number, number>();
    rows.forEach((r) => r.forEach((i, k) => pos.set(i, k)));
    rows = rows.map((r) => {
      const bary = (i: number): number => {
        const ns = sweep % 2 === 0 ? preds[i] : succs[i];
        return ns.length ? ns.reduce((s, j) => s + pos.get(j)!, 0) / ns.length : pos.get(i)!;
      };
      return [...r].sort((a, b) => bary(a) - bary(b) || a - b);
    });
  }
  // A decision's second exit leaves from its right vertex: when both exits land in one row, the second's target goes
  // right of the first's, so the two exits never cross.
  nodes.forEach((d, di) => {
    if (d.shape !== "diamond") return;
    const ts = graph.edges.filter((e) => e.from === d.id && e.to !== d.id).map((e) => nodes.findIndex((n) => n.id === e.to));
    if (ts.length !== 2 || ts[0] === ts[1] || layer[ts[0]] !== layer[ts[1]] || layer[ts[0]] <= layer[di]) return;
    const r = rows[layer[ts[0]]];
    const [i0, i1] = [r.indexOf(ts[0]), r.indexOf(ts[1])];
    if (i1 < i0) [r[i0], r[i1]] = [r[i1], r[i0]];
  });

  // Horizontal positions: each row left to right, a node under its parents' mean centre where room allows.
  const hGap = style === "lead" ? 60 : 34;
  // Self-loops alternate sides — the first on the right, the second on the left, further ones nesting outward — so two
  // loops on one box are never drawn on top of each other. Each side needs room for its loops and their labels.
  const loopsOn = (id: string, side: "right" | "left"): FlowEdge[] =>
    graph.edges.filter((e) => e.from === id && e.to === id).filter((_, k) => (k % 2 === 0) === (side === "right"));
  const loopRoom = (i: number, side: "right" | "left" = "right"): number => {
    const loops = loopsOn(nodes[i].id, side);
    return loops.length ? 22 + 14 * (loops.length - 1) + Math.max(0, ...loops.map((e) => (e.label ? textW(e.label) + 8 : 0))) : 0;
  };
  for (const r of rows) {
    let cursor = -Infinity;
    let prev = -1;
    for (const i of r) {
      const p = placed[i];
      const ps = preds[i].filter((j) => layer[j] < layer[i]);
      const ideal = ps.length ? ps.reduce((s, j) => s + placed[j].x + placed[j].w / 2, 0) / ps.length - p.w / 2 : 0;
      p.x = cursor === -Infinity ? ideal : Math.max(ideal, cursor + hGap + (prev >= 0 ? loopRoom(prev) : 0) + loopRoom(i, "left"));
      cursor = p.x + p.w;
      prev = i;
    }
  }
  const minX = placed.length ? Math.min(...placed.map((p, i) => p.x - loopRoom(i, "left"))) : 0;
  placed.forEach((p) => (p.x -= minX));
  const cx = (p: PlacedNode): number => p.x + p.w / 2;
  const leadW = (p: PlacedNode): number => (style === "lead" && p.node.numeral ? 22 + textW(p.node.numeral) : 0);

  // Edge plan. Every horizontal run lies in a GAP between rows (gap L is below row L; gap −1 is above row 0), on its
  // own track, so no edge ever runs through a box and edges from different sources never share a line. Return edges
  // and edges that skip rows travel in channels to the right of everything.
  type Plan =
    | { kind: "self"; u: number; e: FlowEdge }
    | { kind: "down"; u: number; v: number; e: FlowEdge; sx: number; sy: (yRow: number[]) => number; side: boolean; tx: number; trackKey: string | null; viaChannel: boolean; slot: number };
  const isFwd = (u: number, v: number): boolean => fwd(u, v) && placed[v].layer > placed[u].layer;
  // Same-pair duplicates are drawn side by side.
  const pairSlot = new Map<string, number>();
  const exitCount = new Map<number, number>();
  const plans: Plan[] = [];
  const pairCount = new Map<string, number>();
  for (const e of graph.edges) if (e.from !== e.to) pairCount.set(`${idx.get(e.from)}>${idx.get(e.to)}`, (pairCount.get(`${idx.get(e.from)}>${idx.get(e.to)}`) ?? 0) + 1);
  const outOrder = [...graph.edges.filter((e) => isFwd(idx.get(e.from)!, idx.get(e.to)!)), ...graph.edges.filter((e) => !isFwd(idx.get(e.from)!, idx.get(e.to)!))];
  for (const e of outOrder) {
    const u = idx.get(e.from)!, v = idx.get(e.to)!;
    if (u === v) {
      plans.push({ kind: "self", u, e });
      continue;
    }
    const a = placed[u], b = placed[v];
    const pk = `${u}>${v}`;
    const slot = pairSlot.get(pk) ?? 0;
    pairSlot.set(pk, slot + 1);
    // Centred on the box, so even a small rounded box takes both lines on its flat side.
    const off = (slot - ((pairCount.get(pk) ?? 1) - 1) / 2) * 12;
    // A decision's exits leave from its vertices, never beside them: no side-by-side offset there.
    let sx = a.node.shape === "diamond" ? cx(a) : cx(a) + off, side = false;
    if (a.node.shape === "diamond") {
      const k = exitCount.get(u) ?? 0;
      exitCount.set(u, k + 1);
      // A decision's first exit leaves from its bottom vertex, the second from its right vertex.
      if (k === 1) (sx = a.x + a.w), (side = true);
    }
    const fwdEdge = isFwd(u, v);
    const between = fwdEdge ? placed.filter((p) => p.layer > a.layer && p.layer < b.layer) : [];
    const crosses = (x: number): boolean => between.some((p) => x >= p.x - 6 && x <= p.x + p.w + 6);
    let tx = cx(b) + off;
    const straight = fwdEdge && b.layer === a.layer + 1 && !side && Math.abs(sx - tx) < 0.5 && !e.label;
    if (straight) tx = sx;
    const viaChannel = !fwdEdge || crosses(sx) || crosses(tx);
    // Fan-out from one source shares a track (a bus); a labelled edge or a duplicate gets its own, so labels never pile up.
    const trackKey = straight ? null : e.label || slot > 0 || side ? `edge:${plans.length}` : `src:${u}`;
    plans.push({ kind: "down", u, v, e, sx, sy: () => 0, side, tx, trackKey, viaChannel, slot });
  }
  type Down = Extract<Plan, { kind: "down" }>;
  // Where a vertical line at x meets a shape's top or bottom outline: a rounded corner, a stadium end, a diamond's
  // slanted side or a circle — so an arrowhead always lands ON the outline, never in the white beside it.
  const cornerR = (p: PlacedNode): number => (p.node.shape === "start" || p.node.shape === "end" ? p.h / 2 : p.node.shape === "state" ? 10 : 0);
  const edgeY = (p: PlacedNode, x: number, side: "top" | "bottom"): number => {
    const dx = Math.min(Math.abs(x - cx(p)), p.w / 2);
    let inset = 0;
    if (p.node.shape === "diamond") inset = (dx * p.h) / p.w;
    else if (p.node.shape === "initial" || p.node.shape === "final") {
      const r = p.w / 2;
      inset = r - Math.sqrt(Math.max(0, r * r - dx * dx));
    } else {
      const r = cornerR(p), flat = p.w / 2 - r;
      if (r > 0 && dx > flat) {
        const ex = Math.min(r, dx - flat);
        inset = r - Math.sqrt(Math.max(0, r * r - ex * ex));
      }
    }
    return side === "top" ? p.y + inset : p.y + p.h - inset;
  };
  // Return edges (and edges that must detour) leave and enter a box through its right side when nothing else in its
  // row lies to its right: a short run to the channel and an arrowhead of their own, never merged into another line.
  const rowClearRight = (i: number): boolean =>
    !placed.some((q, j) => j !== i && q.layer === placed[i].layer && q.x > placed[i].x) && !graph.edges.some((e) => e.from === placed[i].node.id && e.to === placed[i].node.id);
  const PORT = FONT_PT + 2;
  const portCap = (i: number): number => {
    const sh = placed[i].node.shape;
    return sh === "diamond" ? 0 : sh === "box" || sh === "state" ? Math.floor((placed[i].h - 8) / PORT) + 1 : 1;
  };
  const ports = new Map<number, Array<{ plan: number; end: "out" | "in" }>>();
  plans.forEach((p, k) => {
    if (p.kind !== "down" || !p.viaChannel) return;
    for (const [i, end] of [[p.u, "out"], [p.v, "in"]] as const) {
      if (end === "out" && p.side) continue;
      if (!rowClearRight(i)) continue;
      const list = ports.get(i) ?? [];
      if (list.length >= portCap(i)) continue;
      list.push({ plan: k, end });
      ports.set(i, list);
    }
  });
  const portY = (i: number, k: number, end: "out" | "in"): number | null => {
    const list = ports.get(i) ?? [];
    const at = list.findIndex((q) => q.plan === k && q.end === end);
    return at < 0 ? null : placed[i].y + placed[i].h / 2 + (at - (list.length - 1) / 2) * PORT;
  };
  // A decision's side exit runs straight to its channel when nothing in its row is in the way.
  const sideDirect = (p: Down): boolean => p.side && p.viaChannel && rowClearRight(p.u);
  // Edges from different sources into one box's top each get their own entry point (and arrowhead), never a merge.
  const tops = new Map<number, number[]>();
  plans.forEach((p, k) => {
    if (p.kind === "down" && portY(p.v, k, "in") === null) tops.set(p.v, [...(tops.get(p.v) ?? []), k]);
  });
  for (const [v, ks] of tops) {
    const b = placed[v];
    if (b.node.shape === "initial" || b.node.shape === "final") continue;
    const ds = ks.map((k) => plans[k] as Down);
    const srcs = [...new Set(ds.map((p) => p.u))];
    if (srcs.length < 2) continue;
    // Where each source comes from: its own x, or the far right for a channel.
    const from = (u: number): number => (ds.some((p) => p.u === u && p.viaChannel) ? Infinity : ds.find((p) => p.u === u)!.sx);
    const near = (m: number, n: number): number => Math.abs(from(m) - cx(b)) - Math.abs(from(n) - cx(b));
    const primary = [...srcs].sort(near)[0];
    const slots = (u: number): number => ds.filter((p) => p.u === u).length;
    // A diamond takes entries on its upper slanted sides (edgeY puts each arrowhead on the side), clear of its corners.
    const reach = b.node.shape === "diamond" ? b.w / 2 - 14 : b.w / 2 - cornerR(b) - 4;
    const shift = new Map<number, number>([[primary, 0]]);
    let right = 12 * (slots(primary) - 1) + 14, left = -14;
    for (const u of srcs.filter((u) => u !== primary).sort(near)) {
      if (from(u) < cx(b)) {
        shift.set(u, left);
        left -= 14 + 12 * (slots(u) - 1);
      } else {
        shift.set(u, right);
        right += 14 + 12 * (slots(u) - 1);
      }
    }
    const fits = ds.every((p) => Math.abs(p.tx - cx(b) + (shift.get(p.u) ?? 0)) <= reach);
    if (fits) {
      for (const p of ds) {
        const d = shift.get(p.u) ?? 0;
        if (!d) continue;
        p.tx += d;
        if (!p.trackKey) p.trackKey = `src:${p.u}`;
      }
    } else {
      // Too many for one side: every entry evenly across the top, in the order the sources come from.
      const order = [...ds].sort((m, n) => from(m.u) - from(n.u) || m.u - n.u || m.slot - n.slot);
      const step = order.length > 1 ? (2 * reach) / (order.length - 1) : 0;
      order.forEach((p, i) => {
        const x = cx(b) - reach + i * step;
        if (Math.abs(x - p.tx) < 0.01) return;
        p.tx = x;
        if (!p.trackKey) p.trackKey = `src:${p.u}`;
      });
    }
  }
  // Tracks per gap: gap a.layer for the run out of the source; gap b.layer−1 for the run into the target (channels).
  const gapKeys = new Map<number, string[]>();
  const want = (gap: number, key: string): void => {
    const ks = gapKeys.get(gap) ?? [];
    if (!ks.includes(key)) ks.push(key);
    gapKeys.set(gap, ks);
  };
  plans.forEach((p, k) => {
    if (p.kind !== "down" || !p.trackKey) return;
    const a = placed[p.u], b = placed[p.v];
    if (portY(p.u, k, "out") === null && !sideDirect(p)) want(a.layer, p.trackKey);
    if (p.viaChannel && portY(p.v, k, "in") === null) want(b.layer - 1, `${p.trackKey}:in`);
  });
  // Within a gap the widest runs take the top tracks: a nearer target's drop then never crosses a farther target's run.
  const spanOf = (key: string): number => {
    if (key.endsWith(":in")) return Infinity;
    return Math.max(0, ...plans.filter((p): p is Down => p.kind === "down" && p.trackKey === key).map((p) => Math.abs(p.tx - p.sx) + (p.side ? 14 : 0)));
  };
  for (const [g, ks] of gapKeys) gapKeys.set(g, [...ks].sort((a, b) => spanOf(b) - spanOf(a)));
  // Tracks far enough apart that a label 6 pt above one (descenders and halo clear of its own line) clears the next.
  const TRACK = FONT_PT + 6;
  const gapH = (gap: number): number => 34 + (gapKeys.get(gap)?.length ?? 0) * TRACK;
  // Vertical positions, now that each gap's height is known.
  const rowTop: number[] = [];
  let y = (style === "lead" ? 24 : 0) + (gapKeys.has(-1) ? gapH(-1) : 0);
  for (let L = 0; L < nLayers; L++) {
    const hMax = Math.max(...rows[L].map((i) => placed[i].h));
    rowTop.push(y);
    for (const i of rows[L]) placed[i].y = y + (hMax - placed[i].h) / 2;
    y += hMax + gapH(L);
  }
  const rowBottom = (L: number): number => rowTop[L] + Math.max(...rows[L].map((i) => placed[i].h));
  const trackY = (gap: number, key: string): number => {
    const ks = gapKeys.get(gap) ?? [];
    const top = gap < 0 ? rowTop[0] - gapH(-1) : rowBottom(gap);
    return top + 19 + ks.indexOf(key) * TRACK;
  };
  // Self-loops (and their labels) and lead numerals reach right of the boxes; channels start beyond all of it.
  const selfReach = (p: PlacedNode): number => {
    const room = loopRoom(placed.indexOf(p));
    return room ? p.x + p.w + room : 0;
  };
  const rightOf = placed.length ? Math.max(...placed.map((p) => Math.max(p.x + p.w + leadW(p), selfReach(p)))) : 0;
  // Where an edge's runs lie: the run out of its source (a right-side port, a decision's vertex, or its own track) and,
  // for a channel edge, the run into its target (a right-side port or its own track).
  const runs = (k: number, p: Down): { t1: number; start: Array<[number, number]>; t2: number; inY: number | null } => {
    const a = placed[p.u], b = placed[p.v];
    const sy = p.side ? a.y + a.h / 2 : edgeY(a, p.sx, "bottom");
    const outY = portY(p.u, k, "out"), inY = portY(p.v, k, "in");
    let t1: number;
    let start: Array<[number, number]>;
    if (outY !== null) (t1 = outY), (start = [[a.x + a.w, outY]]);
    else if (sideDirect(p)) (t1 = sy), (start = [[p.sx, sy]]);
    else {
      t1 = trackY(a.layer, p.trackKey!);
      start = p.side ? [[p.sx, sy], [p.sx + 14, sy], [p.sx + 14, t1]] : [[p.sx, sy], [p.sx, t1]];
    }
    const t2 = !p.viaChannel ? t1 : inY !== null ? inY : trackY(b.layer - 1, `${p.trackKey}:in`);
    return { t1, start, t2, inY };
  };
  // Channels nest by the height they climb: a loop lying within another's span runs inside it, so it never crosses it.
  const chIndex = new Map<number, number>();
  plans
    .map((p, k) => ({ p, k }))
    .filter(({ p }) => p.kind === "down" && p.viaChannel)
    .map(({ p, k }) => {
      const r = runs(k, p as Down);
      return { k, h: Math.abs(r.t1 - r.t2) };
    })
    .sort((m, n) => m.h - n.h || m.k - n.k)
    .forEach(({ k }, i) => chIndex.set(k, i));
  // Channels start far enough right that a labelled run out of a right-side port carries its label clear of them.
  const chBase0 = Math.max(
    rightOf + 24,
    ...[...chIndex.keys()].map((k) => {
      const p = plans[k] as Down;
      return p.e.label && (portY(p.u, k, "out") !== null || sideDirect(p)) ? placed[p.u].x + placed[p.u].w + textW(p.e.label) + 16 : 0;
    }),
  );
  const channels = chIndex.size;
  // The edge's own track: its label's level when it has no long horizontal run.
  const own = new Map<number, number>();
  const buildRoutes = (chBase: number): Route[] =>
    plans.map((p, k) => {
      if (p.kind === "self") {
        const a = placed[p.u];
        const mine = graph.edges.filter((e) => e.from === a.node.id && e.to === a.node.id);
        const n = mine.indexOf(p.e);
        const right = n % 2 === 0, depth = Math.floor(n / 2);
        const x0 = right ? a.x + a.w : a.x;
        const xr = right ? x0 + 18 + 14 * depth : x0 - 18 - 14 * depth;
        const spread = Math.min(a.h * 0.2 + 5 * depth, a.h / 2 - 3);
        const y0 = a.y + a.h / 2 - spread, y1 = a.y + a.h / 2 + spread;
        return { edge: p.e, pts: [[x0, y0], [xr, y0], [xr, y1], [x0, y1]], labelAt: null };
      }
      const a = placed[p.u], b = placed[p.v];
      const sy = p.side ? a.y + a.h / 2 : edgeY(a, p.sx, "bottom");
      const ty = edgeY(b, p.tx, "top");
      let pts: Array<[number, number]>;
      own.set(k, (sy + ty) / 2);
      if (!p.trackKey) {
        pts = [[p.sx, sy], [p.tx, ty]];
      } else {
        const { t1, start, t2, inY } = runs(k, p);
        own.set(k, t1);
        if (!p.viaChannel) {
          pts = [...start, [p.tx, t1], [p.tx, ty]];
        } else {
          const ch = chBase + chIndex.get(k)! * 14;
          pts = inY !== null ? [...start, [ch, t1], [ch, inY], [b.x + b.w, inY]] : [...start, [ch, t1], [ch, t2], [p.tx, t2], [p.tx, ty]];
        }
      }
      // Drop zero-length and collinear points.
      const clean: Array<[number, number]> = [];
      for (const q of pts) {
        const last = clean[clean.length - 1];
        if (last && Math.abs(last[0] - q[0]) < 0.01 && Math.abs(last[1] - q[1]) < 0.01) continue;
        if (clean.length >= 2) {
          const pr = clean[clean.length - 2];
          if ((Math.abs(pr[0] - last![0]) < 0.01 && Math.abs(last![0] - q[0]) < 0.01) || (Math.abs(pr[1] - last![1]) < 0.01 && Math.abs(last![1] - q[1]) < 0.01)) clean.pop();
        }
        clean.push(q);
      }
      return { edge: p.e, pts: clean, labelAt: null };
    });

  // Labels go where nothing else is: each edge has a list of places, best first, and takes the first one that
  // touches no box, no lead numeral, no line (its own included) and no label already placed.
  type At = NonNullable<Route["labelAt"]>;
  type Rect = [number, number, number, number];
  const fixedRects: Rect[] = [
    ...placed.map((p): Rect => [p.x - 1, p.y - 1, p.w + 2, p.h + 2]),
    ...placed.filter((p) => style === "lead" && p.node.numeral).map((p): Rect => [p.x + p.w - 6, p.y - 19, 28 + textW(p.node.numeral!), 27]),
  ];
  const candidates = (k: number, r: Route): At[] => {
    const p = plans[k];
    const t = r.edge.label;
    const w = textW(t);
    const pts = r.pts;
    if (p.kind === "self") {
      const a = placed[p.u];
      const mine = graph.edges.filter((e) => e.from === a.node.id && e.to === a.node.id);
      const n = mine.indexOf(p.e);
      const right = n % 2 === 0, depth = Math.floor(n / 2);
      const x0 = right ? a.x + a.w : a.x;
      const outer = right ? x0 + 18 + 14 * (loopsOn(a.node.id, "right").length - 1) : x0 - 18 - 14 * (loopsOn(a.node.id, "left").length - 1);
      const ly = a.y + a.h / 2 + FONT_PT * 0.35 + depth * LINE_HEIGHT;
      return [right ? [outer + 6, ly, "start"] : [outer - 6, ly, "end"]];
    }
    const out: At[] = [];
    // A decision's side exit is labelled beside its vertex ("no"), as patent flowcharts do.
    if (p.side) out.push([pts[0][0] + 4, pts[0][1] - 6, "start"], [pts[0][0] + 4, pts[0][1] + FONT_PT + 4, "start"]);
    const along = (i: number): At[] => {
      const [a, b] = [pts[i - 1], pts[i]];
      if (Math.abs(a[1] - b[1]) > 0.01) return [];
      const lo = Math.min(a[0], b[0]) + 6 + w / 2, hi = Math.max(a[0], b[0]) - 6 - w / 2;
      if (hi < lo) return [];
      const mid = (lo + hi) / 2;
      const xs = [mid];
      for (let st = 12; st <= (hi - lo) / 2 + 0.01; st += 12) xs.push(mid - st, mid + st);
      xs.push(lo, hi);
      return [a[1] - 6, a[1] + FONT_PT + 4].flatMap((yy) => xs.map((x): At => [x, yy, "middle"]));
    };
    const beside = (i: number, level: number): At[] => {
      const [a, b] = [pts[i - 1], pts[i]];
      if (Math.abs(a[0] - b[0]) > 0.01) return [];
      const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      const yy = level - 6 >= y0 + FONT_PT && level - 6 <= y1 ? level - 6 : (y0 + y1) / 2 + FONT_PT * 0.35;
      return [[a[0] + 6, yy, "start"], [a[0] - 6, yy, "end"]];
    };
    const lvl = own.get(k) ?? (pts[0][1] + pts[pts.length - 1][1]) / 2;
    // A pair of side-by-side duplicates is labelled outside each line: the first on its left, the second on its right.
    if (p.kind === "down") {
      const dups = pairSlot.get(`${p.u}>${p.v}`) ?? 1;
      if (dups === 2) out.push(...beside(1, lvl).filter((c) => (p.slot === 0 ? c[2] === "end" : c[2] === "start")));
    }
    for (let i = 1; i < Math.min(pts.length, 3); i++) out.push(...along(i));
    out.push(...beside(1, lvl));
    for (let i = 3; i < pts.length; i++) out.push(...along(i));
    for (let i = 2; i < pts.length; i++) out.push(...beside(i, (pts[i - 1][1] + pts[i][1]) / 2 + 6));
    return out;
  };
  const rectOf = (t: string, at: At): Rect => {
    const w = textW(t);
    const x0 = at[2] === "middle" ? at[0] - w / 2 : at[2] === "end" ? at[0] - w : at[0];
    return [x0 - 1, at[1] - FONT_PT * 0.8 - 1, w + 2, FONT_PT * 1.05 + 2];
  };
  const overlap = (a: Rect, b: Rect): boolean => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  // A segment (orthogonal or not) through a rectangle: Liang–Barsky clipping.
  const cuts = (p0: [number, number], p1: [number, number], r: Rect): boolean => {
    let t0 = 0, t1 = 1;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    for (const [pp, q] of [[-dx, p0[0] - r[0]], [dx, r[0] + r[2] - p0[0]], [-dy, p0[1] - r[1]], [dy, r[1] + r[3] - p0[1]]]) {
      if (pp === 0) {
        if (q < 0) return false;
      } else {
        const tt = q / pp;
        if (pp < 0) t0 = Math.max(t0, tt);
        else t1 = Math.min(t1, tt);
        if (t0 > t1) return false;
      }
    }
    return true;
  };
  const placeLabels = (routes: Route[]): void => {
    const taken: Rect[] = [];
    const clash = (rect: Rect): number =>
      fixedRects.filter((f) => overlap(rect, f)).length +
      taken.filter((f) => overlap(rect, f)).length +
      routes.reduce((n, o) => n + o.pts.slice(1).filter((q, i) => cuts(o.pts[i], q, rect)).length, 0);
    // Self-loops and decision exits have the fewest choices: they go first.
    const order = routes.map((_, k) => k).sort((m, n) => Number(plans[n].kind === "self") - Number(plans[m].kind === "self") || Number(!!(plans[n] as Down).side) - Number(!!(plans[m] as Down).side));
    for (const k of order) {
      const r = routes[k];
      if (!r.edge.label) continue;
      const cs = candidates(k, r);
      if (!cs.length) continue;
      let best = cs[0], bestN = Infinity;
      for (const c of cs) {
        const n = clash(rectOf(r.edge.label, c));
        if (n < bestN) (best = c), (bestN = n);
        if (n === 0) break;
      }
      r.labelAt = best;
      taken.push(rectOf(r.edge.label, best));
    }
  };
  let chBase = chBase0;
  let routes = buildRoutes(chBase);
  placeLabels(routes);
  // A forward edge's label never lies under a channel: when one reaches that far, the channels move right of it.
  if (channels) {
    const reach = Math.max(0, ...routes.map((r, k) => (r.labelAt && !(plans[k].kind === "down" && (plans[k] as Down).viaChannel) ? rectOf(r.edge.label, r.labelAt)[0] + rectOf(r.edge.label, r.labelAt)[2] : 0)));
    if (reach + 10 > chBase) {
      chBase = reach + 10;
      routes = buildRoutes(chBase);
      placeLabels(routes);
    }
  }
  const channelX = chBase + channels * 14;
  // A label left of its line may reach past the left edge: everything moves right by that much.
  const left = Math.min(
    0,
    ...routes.filter((r) => r.labelAt).map((r) => rectOf(r.edge.label, r.labelAt!)[0]),
    ...routes.flatMap((r) => r.pts.map((q) => q[0] - 5)),
  );
  if (left < 0) {
    placed.forEach((p) => (p.x -= left));
    routes.forEach((r) => {
      r.pts = r.pts.map(([qx, qy]) => [qx - left, qy]);
      if (r.labelAt) r.labelAt = [r.labelAt[0] - left, r.labelAt[1], r.labelAt[2]];
    });
  }
  const labelReach = Math.max(0, ...routes.filter((r) => r.labelAt).map((r) => rectOf(r.edge.label, r.labelAt!)[0] + rectOf(r.edge.label, r.labelAt!)[2]));
  const width = Math.max((channels ? channelX : rightOf) - left, labelReach);
  // The figure's extent is everything drawn: boxes, every route (with room for an arrowhead's half-width) and labels.
  const labelTops = routes.filter((r) => r.labelAt).map((r) => r.labelAt![1] - FONT_PT * 0.8 - 2);
  const labelBottoms = routes.filter((r) => r.labelAt).map((r) => r.labelAt![1] + FONT_PT * 0.25 + 2);
  const bottom = Math.max(0, ...placed.map((p) => p.y + p.h), ...routes.flatMap((r) => r.pts.map((q) => q[1] + 5)), ...labelBottoms);
  const top = Math.min(0, ...routes.flatMap((r) => r.pts.map((q) => q[1] - 5)), ...labelTops);
  if (top < 0) {
    placed.forEach((p) => (p.y -= top));
    routes.forEach((r) => {
      r.pts = r.pts.map(([qx, qy]) => [qx, qy - top]);
      if (r.labelAt) r.labelAt = [r.labelAt[0], r.labelAt[1] - top, r.labelAt[2]];
    });
  }
  return { placed, routes, width, height: bottom - top + 4 };
}

/** Draws the laid-out graph. */
export function drawFlow(kind: FlowKind, graph: FlowGraph, opts: DiagramOptions = {}): DiagramResult {
  const notes = [...graph.notes];
  if (graph.errors.length) return { ok: false, errors: graph.errors, notes };
  const style = opts.numerals ?? "inside";
  const L = layoutFlow(kind, graph, opts);
  if (L.width > SHEET_WIDTH_PT * MAX_SHEETS || L.height > SHEET_HEIGHT_PT * MAX_SHEETS) {
    return { ok: false, errors: [`This figure would be ${(L.width / 72 * 2.54).toFixed(0)} × ${(L.height / 72 * 2.54).toFixed(0)} cm — more than ${MAX_SHEETS} sheets; split it into smaller figures.`], notes };
  }
  const parts: string[] = [];
  const labels: string[] = [];
  for (const r of L.routes) {
    parts.push(polyline(r.pts, r.edge.dashed));
    if (r.edge.arrow) {
      const [p1, p2] = [r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]];
      parts.push(arrowhead(p2[0], p2[1], p2[0] - p1[0], p2[1] - p1[1]));
      if (r.edge.both) parts.push(arrowhead(r.pts[0][0], r.pts[0][1], r.pts[0][0] - r.pts[1][0], r.pts[0][1] - r.pts[1][1]));
    }
    if (r.labelAt) labels.push(text(r.labelAt[0], r.labelAt[1], r.edge.label, { anchor: r.labelAt[2], halo: true }));
  }
  for (const p of L.placed) {
    const { x, y, w, h, node: n } = p;
    if (n.shape === "initial") {
      parts.push(`<circle cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" r="${f(w / 2)}" fill="#000"/>`);
      continue;
    }
    if (n.shape === "final") {
      parts.push(`<circle cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" r="${f(w / 2)}" fill="#fff" stroke="#000" stroke-width="1.1"/><circle cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" r="${f(w / 2 - 4)}" fill="#000"/>`);
      continue;
    }
    if (n.shape === "diamond") {
      parts.push(`<polygon points="${f(x + w / 2)},${f(y)} ${f(x + w)},${f(y + h / 2)} ${f(x + w / 2)},${f(y + h)} ${f(x)},${f(y + h / 2)}" fill="#fff" stroke="#000" stroke-width="1.1"/>`);
    } else {
      const rx = n.shape === "start" || n.shape === "end" ? h / 2 : n.shape === "state" ? 10 : 0;
      parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="#fff" stroke="#000" stroke-width="1.1"/>`);
    }
    // Block boxes read as FIG. 1 of a patent does: the label and its numeral underlined, from the left.
    const blockLeft = kind === "block" && n.shape === "box";
    const top = y + h / 2 - ((p.lines.length - 1) * LINE_HEIGHT) / 2 + FONT_PT * 0.35;
    p.lines.forEach((l, k) => {
      const isNumeral = style === "inside" && !!n.numeral && k === p.lines.length - 1;
      parts.push(blockLeft ? text(x + PAD, top + k * LINE_HEIGHT, l, { anchor: "start", underline: style === "inside" && !!n.numeral }) : text(x + w / 2, top + k * LINE_HEIGHT, l, { underline: isNumeral }));
    });
    if (style === "lead" && n.numeral) {
      // A diamond's lead line ends on its upper-right edge, never in the white corner of its bounding box.
      const tip: [number, number] = n.shape === "diamond" ? [x + w * 0.75, y + h * 0.25] : [x + w - 6, y + 8];
      parts.push(leadLine(x + w + 22 + textW(n.numeral) / 2, y - 6, tip[0], tip[1], n.numeral));
    }
  }
  // Labels last, over everything, each on its own halo.
  const fin = finishFigure(parts.join("") + labels.join(""), L.width, L.height, opts, notes);
  return { ok: true, svg: fin.svg, widthPt: fin.widthPt, heightPt: fin.heightPt, notes, numerals: graph.nodes.map((n) => n.numeral).filter((x): x is string => !!x) };
}
