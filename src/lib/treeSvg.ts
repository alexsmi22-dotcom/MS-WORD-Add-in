/**
 * treeSvg — the one figure builder the computation-theory verbs share
 * (v2.133.0, SCOPE-COMPUTATION-THEORY §C.1): a layered top-down tree or DAG.
 *
 * Nodes are keyed by id so labels may repeat (two `S` children of one `S`
 * must stay two nodes — `buildHierarchySvg` merges equal labels, which is
 * why it cannot be used here). Edges may carry a label. A node may be a
 * conflict leaf (⊥), a success leaf (□), or highlighted (the model leaf, the
 * leftmost derivation path, the goal clause).
 *
 * Layout:
 *  - trees: Reingold–Tilford contours — every subtree is laid out once,
 *    siblings are pushed apart until no two nodes at ANY depth come closer
 *    than SEP, and a parent is centred over its first and last child. A
 *    forest (several roots) is laid out as siblings of a phantom root.
 *  - DAGs: longest-path ranks from the roots (Kahn's order; an edge that
 *    closes a cycle is ignored, never drawn twice), then four barycentre
 *    sweeps (down by parents' mean x, up by children's mean x) to reduce
 *    crossings, then rows packed left to right and centred.
 *  - If the natural layout is wider than the canvas the whole drawing —
 *    text included — is scaled down uniformly, so no label can leave the
 *    canvas (the caption stays at full size below the drawing).
 *  - At most MAX_DRAWN nodes are drawn (breadth-first from the roots, so a
 *    cut tree keeps its top); the rest are counted in the caption by name.
 */

import { currentFigCtx } from "./figContext";

export interface TreeNode {
  id: string;
  label: string;
  /** "bottom" draws ⊥ (a conflict), "box" draws □ (success), default is a text node. */
  kind?: "normal" | "bottom" | "box";
  highlight?: boolean;
}

export interface TreeEdge {
  from: string;
  to: string;
  label?: string;
  highlight?: boolean;
}

export interface TreeSpec {
  nodes: TreeNode[];
  edges: TreeEdge[];
  /** Bottom-left caption; the "… N more nodes not drawn" note is appended here. */
  caption?: string;
  /** DAG mode: a node may have several parents; ranks by longest path from the roots. */
  dag?: boolean;
  width?: number;
}

export const MAX_DRAWN = 200;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHAR = 7.2; // px per character at 12px sans — the layout audit's advance
const NODE_H1 = 22;
const LEVEL = 64;
const PAD = 18;
const SEP = 14;
/** The widest the figure is DISPLAYED (px); wider layouts are scaled to it. */
const MAX_DISPLAY = 640;
/** Below this display scale a 12px label is unreadable: nodes are left out instead. */
const MIN_SCALE = 0.5;
/** Caption advance per font-size unit, above the layout audit's 0.58 so wrapping never overruns. */
const CAP_ADVANCE = 0.6;

const edgeLabelWidth = (s: string): number => s.length * 6.4 + 6;

/** Greedy word wrap; a word longer than the line is cut. */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (line) { out.push(line); line = ""; }
      out.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= max) line += " " + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

interface Placed { node: TreeNode; x: number; y: number; w: number; rank: number }

/** A subtree's silhouette: per depth below (and including) its root, the
 *  leftmost and rightmost extent relative to the root's x. */
interface Contour { left: number[]; right: number[] }

/** A label may hold several lines (separated by a newline): the node is as wide as its longest line. */
const labelLines = (n: TreeNode): string[] => n.label.split(String.fromCharCode(10));
const nodeWidth = (n: TreeNode): number =>
  n.kind === "bottom" || n.kind === "box" ? 22 : Math.max(22, Math.max(...labelLines(n).map((l) => l.length)) * CHAR + 12);

export function treeSvg(spec: TreeSpec): string {
  // A figure-style re-render (lib/figContext.ts): the canvas is at least the context's width (a layout wider than that
  // keeps its natural width, the narrowest it can be drawn legibly), and black and white marks highlighted nodes with
  // a heavy outline and highlighted edges with a heavy line instead of colour.
  const fctx = currentFigCtx();
  const width = fctx ? fctx.width : (spec.width ?? 460);
  const bw = fctx?.bw === true;
  const maxLines = Math.max(1, ...spec.nodes.map((n) => (n.kind === "bottom" || n.kind === "box" ? 1 : labelLines(n).length)));
  const NODE_H = NODE_H1 + 14 * (maxLines - 1);
  const byId = new Map<string, TreeNode>();
  for (const n of spec.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const ids = [...byId.keys()];
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const id of ids) { children.set(id, []); parents.set(id, []); }
  const seenEdge = new Set<string>();
  for (const e of spec.edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    const key = e.from + "\u0000" + e.to;
    if (seenEdge.has(key)) continue; // a duplicate edge is one edge
    seenEdge.add(key);
    children.get(e.from)!.push(e.to);
    parents.get(e.to)!.push(e.from);
  }
  let roots = ids.filter((id) => parents.get(id)!.length === 0);
  if (!roots.length && ids.length) roots = [ids[0]]; // everything is in a cycle: start somewhere

  // ---- ranks and the drawing order ---------------------------------------
  const rank = new Map<string, number>();
  const order: string[] = [];
  if (!spec.dag) {
    // A tree: breadth-first from the roots; the first parent to reach a node owns it.
    const treeKids = new Map<string, string[]>();
    const queue: string[] = [];
    for (const r of roots) { rank.set(r, 0); queue.push(r); }
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      const kids: string[] = [];
      for (const c of children.get(id)!) {
        if (rank.has(c)) continue;
        rank.set(c, rank.get(id)! + 1);
        kids.push(c);
        queue.push(c);
      }
      treeKids.set(id, kids);
    }
    children.clear();
    for (const [k, v] of treeKids) children.set(k, v);
  } else {
    // Longest path from a root, by Kahn's order; a node left with unsatisfied
    // parents when the queue empties sits on a cycle — it is forced in, and
    // the edges into it from later nodes are ignored.
    const indeg = new Map<string, number>();
    for (const id of ids) indeg.set(id, parents.get(id)!.length);
    const ready: string[] = ids.filter((id) => indeg.get(id) === 0);
    const done = new Set<string>();
    while (done.size < ids.length) {
      if (!ready.length) {
        const forced = ids.find((id) => !done.has(id))!;
        ready.push(forced);
      }
      const id = ready.shift()!;
      if (done.has(id)) continue;
      done.add(id);
      let r = 0;
      for (const p of parents.get(id)!) if (rank.has(p)) r = Math.max(r, rank.get(p)! + 1);
      rank.set(id, r);
      order.push(id);
      for (const c of children.get(id)!) {
        indeg.set(c, indeg.get(c)! - 1);
        if (indeg.get(c) === 0) ready.push(c);
      }
    }
  }
  const yOf = (r: number): number => PAD + NODE_H / 2 + r * LEVEL;

  // ---- placement of the first k nodes in drawing order ---------------------
  const placeFirst = (k: number): { placed: Map<string, Placed>; drawnIds: string[] } => {
  const drawnIds = order.slice(0, k);
  const drawn = new Set(drawnIds);
  const placed = new Map<string, Placed>();

  if (!spec.dag) {
    // Reingold–Tilford. layout() returns the subtree's contour relative to
    // its root and records each child's offset from its parent.
    const offset = new Map<string, number>();
    const layout = (id: string): Contour => {
      const node = byId.get(id)!;
      const w = nodeWidth(node);
      const kids = children.get(id)!.filter((c) => drawn.has(c));
      if (!kids.length) return { left: [-w / 2], right: [w / 2] };
      const acc: Contour = { left: [], right: [] };
      const kidX: number[] = [];
      for (let k = 0; k < kids.length; k++) {
        const c = layout(kids[k]);
        let shift = 0;
        if (k > 0) {
          const depth = Math.min(acc.right.length, c.left.length);
          shift = -Infinity;
          for (let d = 0; d < depth; d++) shift = Math.max(shift, acc.right[d] + SEP - c.left[d]);
        }
        kidX.push(shift);
        for (let d = 0; d < c.left.length; d++) {
          if (d >= acc.left.length) { acc.left.push(c.left[d] + shift); acc.right.push(c.right[d] + shift); }
          else acc.right[d] = c.right[d] + shift;
        }
      }
      const mid = (kidX[0] + kidX[kidX.length - 1]) / 2;
      for (let k = 0; k < kids.length; k++) offset.set(kids[k], kidX[k] - mid);
      return { left: [-w / 2, ...acc.left.map((v) => v - mid)], right: [w / 2, ...acc.right.map((v) => v - mid)] };
    };
    // A forest is the children of a phantom root.
    const drawnRoots = roots.filter((r) => drawn.has(r));
    const phantom = "\u0000forest";
    children.set(phantom, drawnRoots);
    byId.set(phantom, { id: phantom, label: "" });
    drawn.add(phantom);
    layout(phantom);
    drawn.delete(phantom);
    byId.delete(phantom);
    // Absolute positions, top-down.
    const stack: { id: string; x: number }[] = drawnRoots.map((r) => ({ id: r, x: offset.get(r) ?? 0 }));
    while (stack.length) {
      const { id, x } = stack.pop()!;
      const node = byId.get(id)!;
      placed.set(id, { node, x, y: yOf(rank.get(id)!), w: nodeWidth(node), rank: rank.get(id)! });
      for (const c of children.get(id)!) if (drawn.has(c)) stack.push({ id: c, x: x + (offset.get(c) ?? 0) });
    }
  } else {
    const maxRank = Math.max(0, ...drawnIds.map((id) => rank.get(id) ?? 0));
    const rows: string[][] = [];
    for (let r = 0; r <= maxRank; r++) rows.push(drawnIds.filter((id) => rank.get(id) === r));
    const pos = new Map<string, number>();
    const setPos = (): void => { for (const row of rows) row.forEach((id, i) => pos.set(id, i)); };
    setPos();
    const mean = (ids_: string[]): number | null => {
      const xs = ids_.filter((p) => pos.has(p)).map((p) => pos.get(p)!);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    for (let sweep = 0; sweep < 4; sweep++) {
      const down = sweep % 2 === 0;
      const seq = down ? rows : [...rows].reverse();
      for (const row of seq) {
        const key = new Map<string, number>();
        row.forEach((id, i) => {
          const m = mean((down ? parents : children).get(id)!.filter((n) => drawn.has(n)));
          key.set(id, m === null ? i : m);
        });
        row.sort((a, b) => key.get(a)! - key.get(b)! || pos.get(a)! - pos.get(b)!);
        setPos();
      }
    }
    // Pack each row, then centre the rows on the widest one.
    const rowWidth = (row: string[]): number => row.reduce((s, id) => s + nodeWidth(byId.get(id)!), 0) + SEP * Math.max(0, row.length - 1);
    const widest = Math.max(0, ...rows.map(rowWidth));
    rows.forEach((row, r) => {
      let x = (widest - rowWidth(row)) / 2;
      for (const id of row) {
        const node = byId.get(id)!;
        const w = nodeWidth(node);
        placed.set(id, { node, x: x + w / 2, y: yOf(r), w, rank: r });
        x += w + SEP;
      }
    });
  }
  return { placed, drawnIds };
  };

  // ---- size: natural layout, shrunk only as far as stays legible ------------
  // The drawing is laid out at its natural size and that size is the viewBox
  // (user units = layout units, so a reader of the SVG measures what is drawn);
  // the DISPLAY width is sized from the content — at least spec.width, at most
  // MAX_DISPLAY — and the figure is scaled to it by the viewer. Below MIN_SCALE
  // a 12px label is unreadable, so instead of shrinking further whole nodes are
  // left out (drawing order: breadth-first, so the top of the tree survives)
  // and the caption says so.
  const extent = (placed: Map<string, Placed>): { minX: number; maxX: number; depth: number } => {
    let minX = Infinity, maxX = -Infinity, depth = 0;
    for (const p of placed.values()) {
      minX = Math.min(minX, p.x - p.w / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      depth = Math.max(depth, p.rank);
    }
    for (const e of spec.edges) {
      const a = placed.get(e.from), b = placed.get(e.to);
      if (!a || !b || a === b || !e.label) continue;
      const mx = (a.x + b.x) / 2, lw = edgeLabelWidth(e.label);
      minX = Math.min(minX, mx - lw / 2);
      maxX = Math.max(maxX, mx + lw / 2);
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 0; }
    return { minX, maxX, depth };
  };
  const naturalWidth = (placed: Map<string, Placed>): number => { const x = extent(placed); return x.maxX - x.minX + PAD * 2; };
  const maxDisplay = Math.max(width, MAX_DISPLAY);
  const legibleNatural = maxDisplay / MIN_SCALE;
  let k = Math.min(order.length, MAX_DRAWN);
  let laid = placeFirst(k);
  let tooWide = false;
  if (k > 1 && naturalWidth(laid.placed) > legibleNatural) {
    tooWide = true;
    let lo = 1, hi = k - 1; // largest prefix that fits
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (naturalWidth(placeFirst(mid).placed) <= legibleNatural) lo = mid; else hi = mid - 1;
    }
    k = lo;
    laid = placeFirst(k);
  }
  const { placed, drawnIds } = laid;
  const notDrawn = ids.length - drawnIds.length;
  const ext = extent(placed);
  const natural = ext.maxX - ext.minX + PAD * 2;
  const VW = Math.max(natural, width);
  const shift = PAD - ext.minX + (VW - natural) / 2; // centre a narrow figure
  for (const p of placed.values()) p.x += shift;
  const displayW = Math.min(VW, maxDisplay);
  const scale = displayW / VW;
  const treeH = PAD * 2 + ext.depth * LEVEL + NODE_H;

  // Caption: below every node and edge, wrapped to the canvas, its font enlarged
  // by 1/scale so it DISPLAYS at 11px however far the drawing is scaled.
  // Under a figure-style re-render the caption is set at the node size (12), so it is not the run that misses a
  // style's minimum.
  // In black and white (USPTO) at 17, so its lowercase letters stand as tall as the 12 px numerals' capitals
  // (37 CFR 1.84(p)(3) measures every letter).
  const capFont = Math.round(((fctx ? (fctx.bw ? 17 : 12) : 11) / scale) * 10) / 10;
  const note = notDrawn > 0 ? `… ${notDrawn} more node${notDrawn === 1 ? "" : "s"} not drawn${tooWide ? " (too wide to draw legibly)" : ""}` : "";
  const cap = [spec.caption, note].filter(Boolean).join(" — ");
  const capLines = cap ? wrap(cap, Math.max(8, Math.floor((VW - PAD * 2) / (capFont * CAP_ADVANCE)))) : [];
  const capLead = capFont * 1.3;
  const VH = Math.ceil(treeH + (capLines.length ? capLines.length * capLead + capFont * 0.4 : 0));
  const displayH = Math.ceil(VH * scale);
  const r1 = (v: number): number => Math.round(v * 10) / 10;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(displayW)}" height="${displayH}" viewBox="0 0 ${r1(VW)} ${VH}">`);
  parts.push(`<rect width="${r1(VW)}" height="${VH}" fill="#fff"/>`);
  parts.push("<g>");
  // Every line first, then the edge labels on their white backings, then the
  // nodes: no stroke is painted over a label drawn earlier.
  for (const e of spec.edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b || a === b) continue;
    const stroke = bw ? "#000" : e.highlight ? "#d62728" : "#666";
    parts.push(`<line x1="${r1(a.x)}" y1="${r1(a.y + NODE_H / 2)}" x2="${r1(b.x)}" y2="${r1(b.y - NODE_H / 2)}" stroke="${stroke}" stroke-width="${e.highlight ? 2 : 1}"/>`);
  }
  for (const e of spec.edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b || a === b || !e.label) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const lw = edgeLabelWidth(e.label);
    parts.push(`<rect x="${r1(mx - lw / 2)}" y="${r1(my - 8)}" width="${r1(lw)}" height="14" fill="#fff"/>`);
    parts.push(`<text x="${r1(mx)}" y="${r1(my + 3)}" text-anchor="middle" font-family="sans-serif" font-size="10.5" fill="${bw ? "#000" : "#333"}">${esc(e.label)}</text>`);
  }
  for (const id of drawnIds) {
    const p = placed.get(id);
    if (!p) continue;
    const fill = bw ? "#fff" : p.node.highlight ? "#ffe8a3" : p.node.kind === "bottom" ? "#fde2e2" : p.node.kind === "box" ? "#e2f5e2" : "#f4f6fa";
    const stroke = bw ? "#000" : p.node.highlight ? "#b8860b" : "#555";
    const sw = bw && p.node.highlight ? ` stroke-width="2.5"` : "";
    parts.push(`<rect x="${r1(p.x - p.w / 2)}" y="${r1(p.y - NODE_H / 2)}" width="${r1(p.w)}" height="${NODE_H}" rx="4" fill="${fill}" stroke="${stroke}"${sw}/>`);
    const lines = p.node.kind === "bottom" ? ["⊥"] : p.node.kind === "box" ? ["□"] : labelLines(p.node);
    const top = p.y + 4 - (7 * (lines.length - 1));
    lines.forEach((line, li) =>
      parts.push(`<text x="${r1(p.x)}" y="${r1(top + 14 * li)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${bw ? "#000" : "#222"}">${esc(line)}</text>`),
    );
  }
  parts.push("</g>");
  capLines.forEach((line, i) => {
    parts.push(`<text x="${PAD}" y="${r1(treeH + capFont + i * capLead)}" font-family="sans-serif" font-size="${capFont}" fill="${bw ? "#000" : "#333"}">${esc(line)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}
