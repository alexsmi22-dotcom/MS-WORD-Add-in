// Renders a Word table as a diagram instead of a data chart, for tables that
// aren't numeric: a top-to-bottom flowchart (rows = steps — method-claim
// figures) or a block-diagram hierarchy (rows = paths like System | Subsystem
// | Component — apparatus figures). Both honor the patent (B&W line-art)
// style and the optional "FIG. N" label, matching tablechart.ts.
//
// The geometry is computed ONCE (layoutFlowchart / layoutHierarchy) and then
// rendered twice from the same coordinates: to SVG for the task-pane preview /
// Word figure, and to native PowerPoint shapes (ppt.ts) — so what you preview
// is exactly what lands on the slide.
//
// Pure logic — no Office.js — fully unit-testable.

import { ChartStyle } from "./tablechart";

export type DiagramKind = "flowchart" | "hierarchy";

export interface DiagramResult {
  svg: string;
  warnings: string[];
}

// --- Shared geometry model ----------------------------------------------------

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pre-wrapped text lines shown inside the box. */
  lines: string[];
  kind: "rect" | "round" | "diamond";
  /** Accented boxes (decision diamonds, hierarchy roots) get the accent fill. */
  accent: boolean;
  fontPx: number;
}

export interface LayoutLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Connector arrowhead at (x2, y2). */
  arrow?: boolean;
  /** Reference-numeral lead line (thinner). */
  lead?: boolean;
}

export interface LayoutText {
  x: number;
  y: number; // baseline, like SVG
  text: string;
  anchor: "start" | "middle" | "end";
  fontPx: number;
  bold?: boolean;
}

export interface DiagramLayout {
  W: number;
  H: number;
  boxes: LayoutBox[];
  lines: LayoutLine[];
  texts: LayoutText[];
  warnings: string[];
}

const W = 380;
const MAX_STEPS = 30;
const MAX_LEAVES = 24;
const MAX_DEPTH = 6;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Greedy word-wrap into at most maxLines lines of ~maxChars, "…" on overflow. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line.length) {
      line = w;
    } else if (line.length + 1 + w.length <= maxChars) {
      line += " " + w;
    } else {
      lines.push(line);
      line = w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.reduce((n, l) => n + l.split(" ").length, 0);
  if (used < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last) + "…";
  }
  // Hard-break single words longer than the line.
  return lines.map((l) => (l.length > maxChars + 2 ? l.slice(0, maxChars + 1) + "…" : l));
}

interface Palette {
  stroke: string;
  fill: string;
  accentFill: string;
  edge: string;
  ink: string;
}

function palette(style: ChartStyle): Palette {
  return style.patent
    ? { stroke: "#000", fill: "#fff", accentFill: "#fff", edge: "#000", ink: "#000" }
    : { stroke: "#1f77b4", fill: "#eaf2fb", accentFill: "#fdf1dc", edge: "#555", ink: "#222" };
}

// --- Flowchart parsing ---------------------------------------------------------

const HEADER_WORDS = new Set(["step", "steps", "stage", "no", "no.", "#", "operation", "action", "task", "phase"]);

/** True when col0 reads as a step id — "1", "S101", "102", "Step 3". */
function isStepId(cell: string): boolean {
  return /^(?:[sS]-?\d{1,4}|\d{1,4}|step\s*\d{1,4})$/i.test(cell.trim());
}

export interface Step {
  id: string;
  text: string;
  decision: boolean;
  terminator: boolean;
}

/** Rows → steps: optional header skipped, optional id column, "?" = decision. */
export function parseSteps(rows: string[][]): { steps: Step[]; warnings: string[] } {
  const warnings: string[] = [];
  let body = rows;
  if (rows.length >= 2) {
    const first = rows[0].map((c) => c.toLowerCase().replace(/[:.]$/, "").trim());
    if (HEADER_WORDS.has(first[0]) || (first.length >= 2 && HEADER_WORDS.has(first[1]))) {
      body = rows.slice(1);
      warnings.push("The first row looked like a header — not drawn as a step.");
    }
  }
  let steps: Step[] = body
    .map((r) => {
      const hasId = r.length >= 2 && isStepId(r[0]) && r.slice(1).some((c) => c);
      const id = hasId ? r[0].trim() : "";
      const cells = (hasId ? r.slice(1) : r).filter((c) => c);
      const text = cells.join(" — ");
      return {
        id,
        text,
        decision: /\?$/.test(text),
        terminator: /^(start|begin|end|stop|done|finish|return)\b/i.test(text),
      };
    })
    .filter((s) => s.text);
  if (steps.length > MAX_STEPS) {
    warnings.push(`Only the first ${MAX_STEPS} of ${steps.length} steps are drawn.`);
    steps = steps.slice(0, MAX_STEPS);
  }
  return { steps, warnings };
}

// --- Flowchart layout ----------------------------------------------------------

/** Computes the flowchart geometry (px). SVG and PPT render from this. */
export function layoutFlowchart(rows: string[][], title = "", style: ChartStyle = {}): DiagramLayout {
  const { steps, warnings } = parseSteps(rows);
  const layout: DiagramLayout = { W, H: 120, boxes: [], lines: [], texts: [], warnings };
  if (!steps.length) return layout;

  const figLabel = (style.figLabel ?? "").trim();
  const cx = W / 2;
  const boxW = 216;
  const gap = 26;

  if (title) {
    layout.texts.push({ x: W / 2, y: 17, text: title.length > 48 ? title.slice(0, 47) + "…" : title, anchor: "middle", fontPx: 13, bold: true });
  }

  let y = title ? 34 : 16;
  interface Placed extends Step {
    y: number;
    h: number;
    lines: string[];
  }
  const placed: Placed[] = steps.map((s, i) => {
    const lines = s.decision ? wrapText(s.text, 18, 3) : wrapText(s.text, 30, 4);
    const h = s.decision ? Math.max(46, lines.length * 13 + 26) : lines.length * 13 + 14;
    const box: Placed = { ...s, y, h, lines };
    y += h + (i < steps.length - 1 ? gap : 0);
    return box;
  });
  layout.H = y + (figLabel ? 34 : 14);

  placed.forEach((s, i) => {
    const midY = s.y + s.h / 2;
    if (s.decision) {
      const halfW = boxW / 2 - 24;
      layout.boxes.push({ x: cx - halfW, y: s.y - 4, w: halfW * 2, h: s.h + 8, lines: s.lines, kind: "diamond", accent: true, fontPx: 10.5 });
    } else {
      layout.boxes.push({ x: cx - boxW / 2, y: s.y, w: boxW, h: s.h, lines: s.lines, kind: s.terminator ? "round" : "rect", accent: false, fontPx: 10.5 });
    }
    // Reference numeral: the step's own id, or an auto callout (102, 104, …)
    // when the patent numeral option is on and the row had no id. Free-standing
    // with a straight lead line to the box edge, alternating sides.
    const refId = s.id || (style.numerals ? String(102 + i * 2) : "");
    if (refId) {
      const ext = s.decision ? boxW / 2 - 24 : boxW / 2;
      const right = i % 2 === 0;
      const edgeX = cx + (right ? ext : -ext);
      const numX = cx + (right ? ext + 24 : -ext - 24);
      const numY = midY - 11;
      layout.lines.push({ x1: numX + (right ? -3 : 3), y1: numY + 2, x2: edgeX, y2: midY, lead: true });
      layout.texts.push({ x: numX, y: numY, text: refId, anchor: right ? "start" : "end", fontPx: 10.5 });
    }
    if (i < placed.length - 1) {
      layout.lines.push({
        x1: cx,
        y1: s.y + s.h + (s.decision ? 4 : 0),
        x2: cx,
        y2: placed[i + 1].y - (placed[i + 1].decision ? 4 : 0),
        arrow: true,
      });
    }
  });
  if (figLabel) {
    layout.texts.push({ x: W / 2, y: layout.H - 9, text: figLabel.length > 24 ? figLabel.slice(0, 23) + "…" : figLabel, anchor: "middle", fontPx: 14 });
  }
  return layout;
}

// --- Block diagram (hierarchy) ---------------------------------------------------

export interface TreeNode {
  label: string;
  children: TreeNode[];
  /** Assigned reference numeral, when the patent numeral option is on. */
  num?: string;
}

/**
 * Patent-style hierarchical numbering: roots 100, 200, …; first-level children
 * step by 10 (110, 120, …); deeper levels step by 2 (112, 114, …).
 */
export function numberTree(roots: TreeNode[]): void {
  const walk = (node: TreeNode, num: number, level: number): void => {
    node.num = String(num);
    node.children.forEach((c, i) => walk(c, level === 0 ? num + 10 * (i + 1) : num + 2 * (i + 1), level + 1));
  };
  roots.forEach((r, i) => walk(r, 100 * (i + 1), 0));
}

/**
 * Rows are root→leaf paths (e.g. System | Subsystem | Component). An empty
 * cell inherits from the row above only when the row has content further
 * right (merged / hand-repeated parents); trailing blanks end the path.
 */
export function buildTree(rows: string[][]): { roots: TreeNode[]; warnings: string[] } {
  const warnings: string[] = [];
  const roots: TreeNode[] = [];
  let prev: string[] = [];
  for (const row of rows) {
    let last = -1;
    row.forEach((c, j) => {
      if (c) last = j;
    });
    if (last < 0) continue;
    const filled = row.map((c, j) => (j < last && !c && j < prev.length ? prev[j] : c));
    const path = filled.slice(0, last + 1).filter((c) => c);
    if (!path.length) continue;
    prev = filled;
    let level = roots;
    for (const label of path.slice(0, MAX_DEPTH)) {
      let node = level.length ? level[level.length - 1] : undefined;
      if (!node || node.label !== label) {
        node = { label, children: [] };
        level.push(node);
      }
      level = node.children;
    }
    if (path.length > MAX_DEPTH) warnings.push(`Levels beyond ${MAX_DEPTH} are not drawn.`);
  }
  return { roots, warnings: [...new Set(warnings)] };
}

export function countLeaves(n: TreeNode): number {
  return n.children.length ? n.children.reduce((acc, c) => acc + countLeaves(c), 0) : 1;
}

export function depthOf(n: TreeNode): number {
  return 1 + (n.children.length ? Math.max(...n.children.map(depthOf)) : 0);
}

/** Computes the block-diagram geometry (px). SVG and PPT render from this. */
export function layoutHierarchy(rows: string[][], title = "", style: ChartStyle = {}): DiagramLayout {
  const { roots, warnings } = buildTree(rows);
  const layout: DiagramLayout = { W, H: 120, boxes: [], lines: [], texts: [], warnings };
  if (!roots.length) return layout;

  let leaves = roots.reduce((acc, r) => acc + countLeaves(r), 0);
  if (leaves > MAX_LEAVES) {
    warnings.push(`The diagram is dense (${leaves} end boxes) — labels may be small.`);
  }
  leaves = Math.max(1, leaves);
  const depth = Math.max(...roots.map(depthOf));
  if (style.numerals) numberTree(roots);

  const figLabel = (style.figLabel ?? "").trim();
  const slotW = 96;
  const levelH = 62;
  const boxH = 30;
  const LW = Math.max(W, leaves * slotW + 20);
  const top = title ? 36 : 18;
  layout.W = LW;
  layout.H = top + depth * levelH - (levelH - boxH) + (figLabel ? 36 : 16);

  if (title) {
    layout.texts.push({ x: LW / 2, y: 19, text: title.length > 48 ? title.slice(0, 47) + "…" : title, anchor: "middle", fontPx: 13, bold: true });
  }

  let cursor = 10 + (LW - leaves * slotW - 20) / 2 + 10;
  const walk = (node: TreeNode, level: number): { cx: number } => {
    const y = top + level * levelH;
    let cx: number;
    if (!node.children.length) {
      cx = cursor + slotW / 2;
      cursor += slotW;
    } else {
      const centers = node.children.map((c) => walk(c, level + 1).cx);
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      // Orthogonal connectors: down from parent, across, down into each child.
      const busY = y + boxH + (levelH - boxH) / 2;
      layout.lines.push({ x1: cx, y1: y + boxH, x2: cx, y2: busY });
      if (centers.length > 1) {
        layout.lines.push({ x1: centers[0], y1: busY, x2: centers[centers.length - 1], y2: busY });
      }
      for (const ccx of centers) {
        layout.lines.push({ x1: ccx, y1: busY, x2: ccx, y2: y + levelH });
      }
    }
    const bw = Math.min(slotW * Math.max(1, countLeaves(node)) - 10, 150);
    const lines = wrapText(node.label, Math.max(10, Math.floor(bw / 6)), 2);
    layout.boxes.push({ x: cx - bw / 2, y, w: bw, h: boxH, lines, kind: "rect", accent: level === 0, fontPx: 9.5 });
    // Reference numeral: free-standing above the top-left corner with a short
    // straight lead line to the box (not inside the box, not in a column).
    if (node.num) {
      const cornerX = cx - bw / 2;
      layout.lines.push({ x1: cornerX - 5, y1: y - 4, x2: cornerX + 4, y2: y + 2, lead: true });
      layout.texts.push({ x: cornerX - 7, y: y - 5, text: node.num, anchor: "end", fontPx: 10 });
    }
    return { cx };
  };
  for (const root of roots) walk(root, 0);

  if (figLabel) {
    layout.texts.push({ x: LW / 2, y: layout.H - 10, text: figLabel, anchor: "middle", fontPx: 14 });
  }
  return layout;
}

// --- SVG renderer ---------------------------------------------------------------

/** Renders a DiagramLayout to SVG, scaled into the 380px pane when wider. */
function renderLayoutSvg(layout: DiagramLayout, style: ChartStyle, emptyMessage: string): string {
  const p = palette(style);
  const { W: LW, H: LH } = layout;
  if (!layout.boxes.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="120" viewBox="0 0 ${W} 120"><rect width="${W}" height="120" fill="#fff"/><text x="${W / 2}" y="60" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">${esc(emptyMessage)}</text></svg>`;
  }
  const parts: string[] = [];

  for (const b of layout.boxes) {
    const fill = b.accent ? p.accentFill : p.fill;
    if (b.kind === "diamond") {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      parts.push(
        `<polygon class="fi-box" points="${cx},${b.y} ${(b.x + b.w).toFixed(1)},${cy.toFixed(1)} ${cx},${(b.y + b.h).toFixed(1)} ${b.x.toFixed(1)},${cy.toFixed(1)}" fill="${fill}" stroke="${p.stroke}" stroke-width="1.2"/>`
      );
    } else {
      parts.push(
        `<rect class="fi-box" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="${b.kind === "round" ? 14 : 0}" fill="${fill}" stroke="${p.stroke}" stroke-width="1.2"/>`
      );
    }
    const lh = b.fontPx + 2.5;
    const y0 = b.y + b.h / 2 - ((b.lines.length - 1) * lh) / 2 + 3.5;
    b.lines.forEach((line, li) => {
      parts.push(
        `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${(y0 + li * lh).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="${b.fontPx}" fill="${p.ink}">${esc(line)}</text>`
      );
    });
  }

  for (const l of layout.lines) {
    if (l.arrow) {
      // Shaft stops short of the tip; solid triangular head at the end.
      parts.push(
        `<line class="fi-edge" x1="${l.x1}" y1="${l.y1.toFixed(1)}" x2="${l.x2}" y2="${(l.y2 - 6).toFixed(1)}" stroke="${p.edge}" stroke-width="1.3"/>` +
          `<polygon class="fi-arrow" points="${l.x2 - 3.6},${(l.y2 - 6.5).toFixed(1)} ${l.x2 + 3.6},${(l.y2 - 6.5).toFixed(1)} ${l.x2},${l.y2.toFixed(1)}" fill="${p.edge}"/>`
      );
    } else {
      const cls = l.lead ? "fi-lead" : "fi-edge";
      const width = l.lead ? 0.9 : 1.1;
      parts.push(
        `<line class="${cls}" x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="${p.edge}" stroke-width="${width}"/>`
      );
    }
  }

  for (const t of layout.texts) {
    parts.push(
      `<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" text-anchor="${t.anchor}" font-family="sans-serif" font-size="${t.fontPx}"${t.bold ? ' font-weight="bold"' : ""} fill="${t.fontPx >= 14 ? "#000" : p.ink}">${esc(t.text)}</text>`
    );
  }

  const scale = LW > W ? W / LW : 1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(LW * scale)}" height="${Math.round(LH * scale)}" viewBox="0 0 ${Math.round(LW)} ${Math.round(LH)}">` +
    `<rect width="${Math.round(LW)}" height="${Math.round(LH)}" fill="#fff"/>${parts.join("")}</svg>`
  );
}

/** Renders the table rows as a top-to-bottom flowchart. */
export function buildFlowchartSvg(rows: string[][], title = "", style: ChartStyle = {}): DiagramResult {
  const layout = layoutFlowchart(rows, title, style);
  return { svg: renderLayoutSvg(layout, style, "No steps to draw"), warnings: layout.warnings };
}

/** Renders the table rows as a connected-boxes hierarchy (block diagram). */
export function buildHierarchySvg(rows: string[][], title = "", style: ChartStyle = {}): DiagramResult {
  const layout = layoutHierarchy(rows, title, style);
  return { svg: renderLayoutSvg(layout, style, "No hierarchy to draw"), warnings: layout.warnings };
}

/** Dispatch helper used by the task pane. */
export function buildDiagramSvg(kind: DiagramKind, rows: string[][], title = "", style: ChartStyle = {}): DiagramResult {
  return kind === "flowchart" ? buildFlowchartSvg(rows, title, style) : buildHierarchySvg(rows, title, style);
}

/** Layout dispatch used by the PPT shape renderer. */
export function layoutDiagram(kind: DiagramKind, rows: string[][], title = "", style: ChartStyle = {}): DiagramLayout {
  return kind === "flowchart" ? layoutFlowchart(rows, title, style) : layoutHierarchy(rows, title, style);
}
