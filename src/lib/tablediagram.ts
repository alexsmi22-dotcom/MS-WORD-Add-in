// Renders a Word table as a diagram instead of a data chart, for tables that
// aren't numeric: a top-to-bottom flowchart (rows = steps — method-claim
// figures) or a block-diagram hierarchy (rows = paths like System | Subsystem
// | Component — apparatus figures). Both honor the patent (B&W line-art)
// style and the optional "FIG. N" label, matching tablechart.ts.
//
// Pure logic — no Office.js — fully unit-testable.

import { ChartStyle } from "./tablechart";

export type DiagramKind = "flowchart" | "hierarchy";

export interface DiagramResult {
  svg: string;
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

function titleSvg(title: string, ink: string): string {
  return title
    ? `<text x="${W / 2}" y="17" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="${ink}">${esc(title.length > 48 ? title.slice(0, 47) + "…" : title)}</text>`
    : "";
}

function figLabelSvg(figLabel: string, H: number): string {
  return figLabel
    ? `<text x="${W / 2}" y="${H - 9}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${esc(figLabel)}</text>`
    : "";
}

function shell(H: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${inner}</svg>`;
}

/** Downward arrow from (x, y1) to (x, y2): shaft + solid triangular head. */
function arrow(x: number, y1: number, y2: number, color: string): string {
  const tip = y2;
  return (
    `<line class="fi-edge" x1="${x}" y1="${y1.toFixed(1)}" x2="${x}" y2="${(tip - 6).toFixed(1)}" stroke="${color}" stroke-width="1.3"/>` +
    `<polygon class="fi-arrow" points="${x - 3.6},${(tip - 6.5).toFixed(1)} ${x + 3.6},${(tip - 6.5).toFixed(1)} ${x},${tip.toFixed(1)}" fill="${color}"/>`
  );
}

// --- Flowchart ---------------------------------------------------------------

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

/** Rows → steps: optional header skipped, optional id column, "?" = decision. Exported for the PPT shape builder. */
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

/** Renders the table rows as a top-to-bottom flowchart. */
export function buildFlowchartSvg(rows: string[][], title = "", style: ChartStyle = {}): DiagramResult {
  const { steps, warnings } = parseSteps(rows);
  if (!steps.length) {
    return { svg: shell(120, `<text x="${W / 2}" y="60" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">No steps to draw</text>`), warnings };
  }
  const p = palette(style);
  const figLabel = (style.figLabel ?? "").trim();
  const cx = W / 2;
  const boxW = 216;
  const gap = 26;

  // Measure first so the canvas height is exact.
  interface Placed extends Step {
    y: number;
    h: number;
    lines: string[];
  }
  let y = title ? 34 : 16;
  const placed: Placed[] = steps.map((s, i) => {
    const lines = s.decision ? wrapText(s.text, 18, 3) : wrapText(s.text, 30, 4);
    const h = s.decision ? Math.max(46, lines.length * 13 + 26) : lines.length * 13 + 14;
    const box: Placed = { ...s, y, h, lines };
    y += h + (i < steps.length - 1 ? gap : 0);
    return box;
  });
  const H = y + (figLabel ? 34 : 14);

  const parts: string[] = [titleSvg(title, p.ink)];
  placed.forEach((s, i) => {
    const midY = s.y + s.h / 2;
    if (s.decision) {
      const halfW = boxW / 2 - 24;
      const halfH = s.h / 2 + 4;
      parts.push(
        `<polygon class="fi-box" points="${cx},${s.y - 4} ${cx + halfW},${midY} ${cx},${s.y + s.h + 4} ${cx - halfW},${midY}" fill="${p.accentFill}" stroke="${p.stroke}" stroke-width="1.2"/>`
      );
    } else {
      parts.push(
        `<rect class="fi-box" x="${cx - boxW / 2}" y="${s.y}" width="${boxW}" height="${s.h}" rx="${s.terminator ? 14 : 0}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.2"/>`
      );
    }
    const y0 = midY - ((s.lines.length - 1) * 13) / 2 + 3.5;
    s.lines.forEach((line, li) => {
      parts.push(
        `<text x="${cx}" y="${(y0 + li * 13).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10.5" fill="${p.ink}">${esc(line)}</text>`
      );
    });
    // Reference numeral: the step's own id, or an auto callout (102, 104, …)
    // when the patent numeral option is on and the row had no id. Drawn
    // free-standing with a straight lead line to the box edge, alternating
    // sides so the numbers don't stack into a column (37 CFR 1.84(q)).
    const refId = s.id || (style.numerals ? String(102 + i * 2) : "");
    if (refId) {
      const ext = s.decision ? boxW / 2 - 24 : boxW / 2;
      const right = i % 2 === 0;
      const edgeX = cx + (right ? ext : -ext);
      const numX = cx + (right ? ext + 24 : -ext - 24);
      const numY = midY - 11; // lift the number so the lead line is angled
      parts.push(
        `<line x1="${(numX + (right ? -3 : 3)).toFixed(1)}" y1="${(numY + 2).toFixed(1)}" x2="${edgeX.toFixed(1)}" y2="${midY.toFixed(1)}" stroke="${p.edge}" stroke-width="0.9"/>` +
          `<text x="${numX.toFixed(1)}" y="${numY.toFixed(1)}" text-anchor="${right ? "start" : "end"}" font-family="sans-serif" font-size="10.5" fill="${p.ink}">${esc(refId)}</text>`
      );
    }
    if (i < placed.length - 1) {
      parts.push(arrow(cx, s.y + s.h + (s.decision ? 4 : 0), placed[i + 1].y - (placed[i + 1].decision ? 4 : 0), p.edge));
    }
  });
  parts.push(figLabelSvg(figLabel, H));
  return { svg: shell(H, parts.join("")), warnings };
}

// --- Block diagram (hierarchy) -----------------------------------------------

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

/** Renders the table rows as a connected-boxes hierarchy (block diagram). */
export function buildHierarchySvg(rows: string[][], title = "", style: ChartStyle = {}): DiagramResult {
  const { roots, warnings } = buildTree(rows);
  if (!roots.length) {
    return { svg: shell(120, `<text x="${W / 2}" y="60" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#999">No hierarchy to draw</text>`), warnings };
  }
  let leaves = roots.reduce((acc, r) => acc + countLeaves(r), 0);
  if (leaves > MAX_LEAVES) {
    warnings.push(`The diagram is dense (${leaves} end boxes) — labels may be small.`);
  }
  leaves = Math.max(1, leaves);
  const depth = Math.max(...roots.map(depthOf));
  if (style.numerals) numberTree(roots);

  const p = palette(style);
  const figLabel = (style.figLabel ?? "").trim();
  const slotW = 96;
  const levelH = 62;
  const boxH = 30;
  const LW = Math.max(W, leaves * slotW + 20);
  const top = title ? 36 : 18;
  const LH = top + depth * levelH - (levelH - boxH) + (figLabel ? 36 : 16);

  const parts: string[] = [];
  let cursor = 10 + (LW - leaves * slotW - 20) / 2 + 10;

  const layout = (node: TreeNode, level: number): { cx: number } => {
    const y = top + level * levelH;
    let cx: number;
    if (!node.children.length) {
      cx = cursor + slotW / 2;
      cursor += slotW;
    } else {
      const centers = node.children.map((c) => layout(c, level + 1).cx);
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      // Orthogonal connectors: down from parent, across, down into each child.
      const busY = y + boxH + (levelH - boxH) / 2;
      parts.push(`<line class="fi-edge" x1="${cx.toFixed(1)}" y1="${y + boxH}" x2="${cx.toFixed(1)}" y2="${busY}" stroke="${p.edge}" stroke-width="1.1"/>`);
      if (centers.length > 1) {
        parts.push(`<line class="fi-edge" x1="${centers[0].toFixed(1)}" y1="${busY}" x2="${centers[centers.length - 1].toFixed(1)}" y2="${busY}" stroke="${p.edge}" stroke-width="1.1"/>`);
      }
      for (const ccx of centers) {
        parts.push(`<line class="fi-edge" x1="${ccx.toFixed(1)}" y1="${busY}" x2="${ccx.toFixed(1)}" y2="${y + levelH}" stroke="${p.edge}" stroke-width="1.1"/>`);
      }
    }
    const bw = Math.min(slotW * Math.max(1, countLeaves(node)) - 10, 150);
    const lines = wrapText(node.label, Math.max(10, Math.floor(bw / 6)), 2);
    parts.push(
      `<rect class="fi-box" x="${(cx - bw / 2).toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${boxH}" fill="${level === 0 ? p.accentFill : p.fill}" stroke="${p.stroke}" stroke-width="1.2"/>`
    );
    const ty = y + boxH / 2 - ((lines.length - 1) * 11) / 2 + 3.5;
    lines.forEach((line, li) => {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(ty + li * 11).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="${p.ink}">${esc(line)}</text>`
      );
    });
    // Reference numeral: free-standing above the top-left corner with a short
    // straight lead line to the box (not inside the box, not in a column).
    if (node.num) {
      const cornerX = cx - bw / 2;
      const numX = cornerX - 7;
      const numY = y - 5;
      parts.push(
        `<line class="fi-lead" x1="${(numX + 2).toFixed(1)}" y1="${(numY + 1).toFixed(1)}" x2="${(cornerX + 4).toFixed(1)}" y2="${(y + 2).toFixed(1)}" stroke="${p.edge}" stroke-width="0.9"/>` +
          `<text x="${numX.toFixed(1)}" y="${numY.toFixed(1)}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${p.ink}">${esc(node.num)}</text>`
      );
    }
    return { cx };
  };
  for (const root of roots) layout(root, 0);

  // Title / FIG. label are placed in layout coordinates, then the whole canvas
  // is scaled to the 380px pane width when the tree is wider.
  const head = title
    ? `<text x="${LW / 2}" y="19" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="${p.ink}">${esc(title.length > 48 ? title.slice(0, 47) + "…" : title)}</text>`
    : "";
  const foot = figLabel
    ? `<text x="${LW / 2}" y="${LH - 10}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000">${esc(figLabel)}</text>`
    : "";
  const scale = LW > W ? W / LW : 1;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(LW * scale)}" height="${Math.round(LH * scale)}" viewBox="0 0 ${LW} ${LH}">` +
    `<rect width="${LW}" height="${LH}" fill="#fff"/>${head}${parts.join("")}${foot}</svg>`;
  return { svg, warnings };
}

/** Dispatch helper used by the task pane. */
export function buildDiagramSvg(kind: DiagramKind, rows: string[][], title = "", style: ChartStyle = {}): DiagramResult {
  return kind === "flowchart" ? buildFlowchartSvg(rows, title, style) : buildHierarchySvg(rows, title, style);
}
