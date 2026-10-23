// Figures for the Release Q gate and circuit tools (part Q2): the Bloch sphere (orthographic oblique view, equator and
// x–z meridian with the hidden halves dashed, labelled axes, start and final states as arrows, the path each gate
// rotates the state along), the circuit diagram (wires, gate boxes, control dots, ⊕ targets, swaps, oracle blocks,
// measurement meters and classical double wires after them, folded into bands when long) and the probability bar
// chart. Colours are literal hex (inserted artwork never follows the pane's theme); Arial, as engCharts2026.ts.

import { textWidthPt } from "./arialMetrics";
import { fmtSig } from "./axis";
import { ketLabel } from "./quantumCore";
import type { Circuit, Op } from "./quantumCircuits";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000", extra = ""): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}"${extra}>${esc(t)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = "#000000", w = 1, dash = ""): string =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const poly = (pts: [number, number][], stroke: string, w: number, dash = "", fill = "none"): string =>
  `<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const svgOpen = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}"><rect x="0" y="0" width="${f(w)}" height="${f(h)}" fill="#ffffff"/>`;
const tw = (t: string, size: number): number => textWidthPt(t, size);
/** Four significant figures, trailing zeros dropped. */
const sig = (v: number, n = 3): string =>
  Math.abs(v) < 5e-13 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

// ---------------------------------------------------------------------------------------------------------------
// Bloch sphere
// ---------------------------------------------------------------------------------------------------------------

export interface BlochFigure {
  start: [number, number, number];
  end: [number, number, number];
  /** Points on the sphere the state passes through (each gate as its rotation), or empty for no path. */
  path: [number, number, number][];
  startLabel: string;
  endLabel: string;
  /**
   * One vector, not a before/after pair (Release Q part Q3: the Bloch vector of a density matrix, |r| ≤ 1). Pass the
   * same vector as start and end; the legend then names it by endLabel alone, without "(unchanged)".
   */
  single?: boolean;
}

const AZ = (25 * Math.PI) / 180;
const EL = (20 * Math.PI) / 180;
const VIEW_D: [number, number, number] = [Math.cos(EL) * Math.cos(AZ), Math.cos(EL) * Math.sin(AZ), Math.sin(EL)];
const VIEW_R: [number, number, number] = [-Math.sin(AZ), Math.cos(AZ), 0];
const VIEW_U: [number, number, number] = [-Math.sin(EL) * Math.cos(AZ), -Math.sin(EL) * Math.sin(AZ), Math.cos(EL)];
const dot3 = (a: [number, number, number], b: [number, number, number]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const BLOCH_WIDTH = 380;

/**
 * The Bloch sphere: x toward the viewer's lower left, y to the right, z up (|0⟩ at the north pole). Orthographic view
 * from 25° azimuth, 20° elevation; the far halves of the equator, the meridian, the axes and the path are dashed.
 */
export function blochSphereSvg(fig: BlochFigure): string {
  const W = BLOCH_WIDTH, R = 118, cx = W / 2, cy = 168;
  const P = (p: [number, number, number]): [number, number] => [cx + R * dot3(p, VIEW_R), cy - R * dot3(p, VIEW_U)];
  const depth = (p: [number, number, number]): number => dot3(p, VIEW_D);
  const out: string[] = [];
  // A great circle (or the path) split into front (solid) and back (dashed) runs.
  const runs = (pts: [number, number, number][], stroke: string, w: number, backDash: string, closed: boolean): void => {
    let cur: [number, number][] = [];
    let front: boolean | null = null;
    const flush = (): void => {
      if (cur.length > 1) out.push(poly(cur, stroke, w, front ? "" : backDash));
      cur = [];
    };
    const list = closed ? [...pts, pts[0]] : pts;
    for (const p of list) {
      const fr = depth(p) >= 0;
      if (front !== null && fr !== front) {
        const last = cur[cur.length - 1];
        flush();
        if (last) cur.push(last);
      }
      front = fr;
      cur.push(P(p));
    }
    flush();
  };
  out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="#f6f8fb" stroke="#6b6b6b" stroke-width="1"/>`);
  const N = 180;
  const eq: [number, number, number][] = [];
  const mer: [number, number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    eq.push([Math.cos(t), Math.sin(t), 0]);
    mer.push([Math.sin(t), 0, Math.cos(t)]);
  }
  runs(eq, "#8c8c8c", 0.9, "3,3", true);
  runs(mer, "#8c8c8c", 0.9, "3,3", true);
  // Axes: the near half solid, the far half dashed, then a short arrow past the surface.
  const axes: { v: [number, number, number]; lab: string }[] = [
    { v: [1, 0, 0], lab: "x" },
    { v: [0, 1, 0], lab: "y" },
    { v: [0, 0, 1], lab: "z" },
  ];
  for (const a of axes) {
    const neg: [number, number, number] = [-a.v[0], -a.v[1], -a.v[2]];
    const [x0, y0] = P([0, 0, 0]);
    const [xn, yn] = P(neg);
    out.push(line(x0, y0, xn, yn, "#9a9a9a", 0.8, "3,3"));
    const [x1, y1] = P(a.v);
    out.push(line(x0, y0, x1, y1, "#9a9a9a", 0.8));
    const tip: [number, number, number] = [a.v[0] * 1.16, a.v[1] * 1.16, a.v[2] * 1.16];
    const [x2, y2] = P(tip);
    out.push(line(x1, y1, x2, y2, "#404040", 0.9));
    out.push(arrowHead(x1, y1, x2, y2, "#404040", 6));
    const lp: [number, number, number] = [a.v[0] * 1.3, a.v[1] * 1.3, a.v[2] * 1.3];
    const [lx, ly] = P(lp);
    out.push(text(lx, ly + 4, a.lab, "middle", 12, "#000000", ' font-style="italic"'));
  }
  // Poles.
  const [nx, ny] = P([0, 0, 1]);
  const [sx, sy] = P([0, 0, -1]);
  out.push(text(nx - 8, ny - 10, "|0⟩", "end", 12));
  out.push(text(sx, sy + 18, "|1⟩", "middle", 12));
  // The path, then the two states.
  if (fig.path.length > 1) runs(fig.path, "#d07a00", 1.4, "2,2.5", false);
  const arrow = (v: [number, number, number], color: string): void => {
    const [x0, y0] = P([0, 0, 0]);
    const [x1, y1] = P(v);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 18) {
      // Pointing (nearly) at or away from the viewer, too short for a shaft and a head: a marker, filled when it is
      // on the near side and open on the far side (the legend gives the coordinates).
      out.push(`<circle cx="${f(x1)}" cy="${f(y1)}" r="6" fill="${depth(v) >= 0 ? color : "#ffffff"}" stroke="${color}" stroke-width="1.8"/>`);
      return;
    }
    const k = (len - 7) / len;
    out.push(line(x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, color, 2.2, depth(v) >= 0 ? "" : "5,3"));
    out.push(arrowHead(x0, y0, x1, y1, color, 10));
  };
  const same = Math.hypot(fig.start[0] - fig.end[0], fig.start[1] - fig.end[1], fig.start[2] - fig.end[2]) < 1e-9;
  if (!same) arrow(fig.start, "#1f5fa8");
  arrow(fig.end, "#c00000");
  out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="2" fill="#000000"/>`);
  // Legend below the sphere.
  let ly = cy + R + 42;
  const leg = (color: string, label: string, dash = ""): void => {
    out.push(line(28, ly - 4, 52, ly - 4, color, dash ? 1.4 : 2.2, dash));
    out.push(text(60, ly, label, "start", 11));
    ly += 17;
  };
  if (same) leg("#c00000", fig.single ? fig.endLabel : `${fig.endLabel} (unchanged)`);
  else {
    leg("#1f5fa8", fig.startLabel);
    leg("#c00000", fig.endLabel);
  }
  if (fig.path.length > 1) leg("#d07a00", "path (each gate as its rotation)", "2,2.5");
  const H = ly + 4;
  return svgOpen(W, H) + out.join("") + "</svg>";
}

/** A filled arrowhead at (x1, y1) pointing away from (x0, y0). */
function arrowHead(x0: number, y0: number, x1: number, y1: number, color: string, size: number): string {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const bx = x1 - ux * size, by = y1 - uy * size;
  const w = size * 0.42;
  const pts: [number, number][] = [[x1, y1], [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]];
  return `<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${color}" stroke="${color}" stroke-width="0.4"/>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Circuit diagram
// ---------------------------------------------------------------------------------------------------------------

const WIRE = 40;
const GATE_H = 28;
const MAX_BAND_WIDTH = 640;
const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const subNum = (k: number): string => String(k).split("").map((d) => SUBS[Number(d)]).join("");

/**
 * Text whose Unicode subscript digits (q₀, R₂) are drawn as a smaller, lowered run: the subscript glyphs fall back to
 * another font in most renderers and come out tiny and raised. Each run is its own <text> (no tspan), placed by the
 * Arial metrics.
 */
function runText(x: number, y: number, s: string, anchor: "start" | "middle" | "end", size: number, extra = ""): string {
  const parts: { t: string; sub: boolean }[] = [];
  for (const ch of s) {
    const k = SUBS.indexOf(ch);
    const sub = k >= 0;
    const c = sub ? String(k) : ch;
    if (parts.length && parts[parts.length - 1].sub === sub) parts[parts.length - 1].t += c;
    else parts.push({ t: c, sub });
  }
  if (parts.length === 1 && !parts[0].sub) return text(x, y, s, anchor, size, "#000000", extra);
  const ss = Math.round(size * 0.72);
  // A hair of space before each run, so neighbouring runs never touch whatever metrics a reader measures with.
  const widths = parts.map((p, i) => tw(p.t, p.sub ? ss : size) + (i < parts.length - 1 ? 1.5 : 0));
  const total = widths.reduce((a, b) => a + b, 0);
  let x0 = anchor === "start" ? x : anchor === "middle" ? x - total / 2 : x - total;
  return parts
    .map((p, i) => {
      const out = text(x0, p.sub ? y + size * 0.28 : y, p.t, "start", p.sub ? ss : size, "#000000", extra);
      x0 += widths[i];
      return out;
    })
    .join("");
}

const span = (op: Op): [number, number] => {
  const qs =
    op.kind === "gate" ? [...op.controls, op.target] : op.kind === "swap" ? [...op.controls, op.a, op.b] : op.kind === "two" ? [op.a, op.b] : op.kind === "measure" ? [op.qubit] : op.qubits;
  return [Math.min(...qs), Math.max(...qs)];
};
const opWidth = (op: Op): number => {
  if (op.kind === "gate") return op.draw === "box" ? Math.max(GATE_H, tw(op.label, 12) + 12) : 22;
  if (op.kind === "two") return Math.max(GATE_H, tw(op.label, 12) + 12);
  if (op.kind === "block") return Math.max(44, tw(op.label, 12) + 16);
  if (op.kind === "measure") return 30;
  return 18;
};

/**
 * The circuit diagram, Qiskit/textbook style: one wire per qubit (q₀ at the top), time left to right, gates packed
 * into columns so no vertical connector crosses another gate; a long circuit folds into bands.
 */
export function circuitDiagramSvg(c: Circuit, opts: { initial?: number } = {}): string {
  const n = c.n;
  // Columns: each op goes after the last column used by any wire its connector spans.
  const colOf: number[] = [];
  const wireFree = new Array<number>(n).fill(0);
  c.ops.forEach((op, i) => {
    const [lo, hi] = span(op);
    let col = 0;
    for (let q = lo; q <= hi; q++) col = Math.max(col, wireFree[q]);
    colOf[i] = col;
    for (let q = lo; q <= hi; q++) wireFree[q] = col + 1;
  });
  const nCols = Math.max(1, ...wireFree);
  const colW = new Array<number>(nCols).fill(GATE_H);
  c.ops.forEach((op, i) => (colW[colOf[i]] = Math.max(colW[colOf[i]], opWidth(op))));
  // Measured-from column per qubit (the wire turns into a classical double line after its meter).
  const measCol = new Array<number>(n).fill(Infinity);
  c.ops.forEach((op, i) => {
    if (op.kind === "measure") measCol[op.qubit] = Math.min(measCol[op.qubit], colOf[i]);
  });
  const inputs = c.inputs ?? Array.from({ length: n }, (_, q) => `|${ketLabel(opts.initial ?? 0, n)[q]}⟩`);
  const labW = Math.max(...inputs.map((s, q) => tw(`q${subNum(q)}`, 12) + 8 + tw(s, 12))) + 16;
  const GAP = 14;
  // Bands.
  const bands: number[][] = [[]];
  let wSoFar = 0;
  for (let k = 0; k < nCols; k++) {
    const w = colW[k] + GAP;
    if (bands[bands.length - 1].length && labW + wSoFar + w + 16 > MAX_BAND_WIDTH) {
      bands.push([]);
      wSoFar = 0;
    }
    bands[bands.length - 1].push(k);
    wSoFar += w;
  }
  const bandW = bands.map((b) => b.reduce((s, k) => s + colW[k] + GAP, 0));
  const W = Math.max(220, labW + Math.max(...bandW) + 16);
  const bandH = n * WIRE + 14;
  const H = bands.length * bandH + 10;
  const out: string[] = [];
  bands.forEach((cols, bi) => {
    const top = 10 + bi * bandH + WIRE / 2;
    const yq = (q: number): number => top + q * WIRE;
    const colX: Record<number, number> = {};
    let x = labW + GAP / 2;
    for (const k of cols) {
      colX[k] = x + colW[k] / 2;
      x += colW[k] + GAP;
    }
    const xEnd = x - GAP / 2 + 14;
    const first = cols[0], last = cols[cols.length - 1];
    // Wire labels (repeated on every band) and wires.
    for (let q = 0; q < n; q++) {
      out.push(runText(6, yq(q) + 4, `q${subNum(q)}`, "start", 12));
      if (bi === 0) out.push(runText(labW - 6, yq(q) + 4, inputs[q], "end", 12));
      const x0 = labW;
      const mc = measCol[q];
      const xm = mc === Infinity || mc > last ? xEnd : mc < first ? x0 : colX[mc];
      if (xm > x0) out.push(line(x0, yq(q), xm, yq(q)));
      if (xm < xEnd) {
        out.push(line(xm, yq(q) - 1.5, xEnd, yq(q) - 1.5));
        out.push(line(xm, yq(q) + 1.5, xEnd, yq(q) + 1.5));
      }
    }
    c.ops.forEach((op, i) => {
      const k = colOf[i];
      if (!(k in colX)) return;
      out.push(drawOp(op, colX[k], yq, (q) => measCol[q] < k));
    });
  });
  return svgOpen(W, H) + out.join("") + "</svg>";
}

function drawOp(op: Op, x: number, yq: (q: number) => number, classical: (q: number) => boolean): string {
  const out: string[] = [];
  const box = (cx: number, cy: number, label: string, w: number, h = GATE_H): void => {
    out.push(`<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" fill="#ffffff" stroke="#000000" stroke-width="1"/>`);
    out.push(runText(cx, cy + 4.5, label, "middle", 12));
  };
  const ctrlDot = (q: number): void => {
    out.push(`<circle cx="${f(x)}" cy="${f(yq(q))}" r="4" fill="#000000"/>`);
  };
  const connector = (qs: number[], cls: boolean): void => {
    const lo = Math.min(...qs), hi = Math.max(...qs);
    if (cls) {
      out.push(line(x - 1.5, yq(lo), x - 1.5, yq(hi)));
      out.push(line(x + 1.5, yq(lo), x + 1.5, yq(hi)));
    } else out.push(line(x, yq(lo), x, yq(hi)));
  };
  const swapX = (q: number): void => {
    const y = yq(q), s = 6;
    out.push(line(x - s, y - s, x + s, y + s, "#000000", 1.4));
    out.push(line(x - s, y + s, x + s, y - s, "#000000", 1.4));
  };
  switch (op.kind) {
    case "gate": {
      const qs = [...op.controls, op.target];
      if (op.controls.length) connector(qs, op.controls.every(classical));
      op.controls.forEach(ctrlDot);
      if (op.draw === "oplus" && op.controls.length) {
        const y = yq(op.target);
        out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="9" fill="#ffffff" stroke="#000000" stroke-width="1.1"/>`);
        out.push(line(x - 9, y, x + 9, y, "#000000", 1.1));
        out.push(line(x, y - 9, x, y + 9, "#000000", 1.1));
      } else if (op.draw === "dot" && op.controls.length) ctrlDot(op.target);
      else box(x, yq(op.target), op.label, opWidth(op));
      break;
    }
    case "swap":
      connector([...op.controls, op.a, op.b], false);
      op.controls.forEach(ctrlDot);
      swapX(op.a);
      swapX(op.b);
      break;
    case "two": {
      const w = opWidth(op);
      if (Math.abs(op.a - op.b) === 1) {
        const lo = Math.min(op.a, op.b), hi = Math.max(op.a, op.b);
        const top = yq(lo) - GATE_H / 2, bot = yq(hi) + GATE_H / 2;
        out.push(`<rect x="${f(x - w / 2)}" y="${f(top)}" width="${f(w)}" height="${f(bot - top)}" fill="#ffffff" stroke="#000000" stroke-width="1"/>`);
        out.push(text(x, (top + bot) / 2 + 4.5, op.label, "middle", 12));
      } else {
        connector([op.a, op.b], false);
        box(x, yq(op.a), op.label, w);
        box(x, yq(op.b), op.label, w);
      }
      break;
    }
    case "measure": {
      const y = yq(op.qubit), w = 30, h = 24;
      out.push(`<rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${w}" height="${h}" fill="#ffffff" stroke="#000000" stroke-width="1"/>`);
      const r = 9, by = y + 6;
      out.push(`<path d="M ${f(x - r)} ${f(by)} A ${r} ${r} 0 0 1 ${f(x + r)} ${f(by)}" fill="none" stroke="#000000" stroke-width="1"/>`);
      out.push(line(x, by, x + 7, y - 7, "#000000", 1));
      out.push(arrowHead(x, by, x + 7.5, y - 7.6, "#000000", 4));
      break;
    }
    case "block": {
      const lo = Math.min(...op.qubits), hi = Math.max(...op.qubits), w = opWidth(op);
      const top = yq(lo) - GATE_H / 2, bot = yq(hi) + GATE_H / 2;
      out.push(`<rect x="${f(x - w / 2)}" y="${f(top)}" width="${f(w)}" height="${f(bot - top)}" fill="#eef3fa" stroke="#000000" stroke-width="1"/>`);
      const m = /^(.*)_(.+)$/.exec(op.label);
      if (m) {
        // U_f: the subscript as a smaller, lowered run (SVG has no math layout).
        const wm = tw(m[1], 12), ws = tw(m[2], 9);
        const x0 = x - (wm + ws) / 2;
        out.push(text(x0, (top + bot) / 2 + 4.5, m[1], "start", 12, "#000000", ' font-style="italic"'));
        out.push(text(x0 + wm, (top + bot) / 2 + 8, m[2], "start", 9, "#000000", ' font-style="italic"'));
      } else out.push(text(x, (top + bot) / 2 + 4.5, op.label, "middle", 12));
      break;
    }
  }
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Probability bar chart
// ---------------------------------------------------------------------------------------------------------------

/** The most bars one chart draws; beyond it the largest are drawn and the rest summarised in the axis note. */
export const MAX_BARS = 32;

/**
 * Measurement probabilities as bars over the basis states (|q₀q₁…⟩). All 2ⁿ outcomes when 2ⁿ ≤ 32; otherwise the 32
 * most probable (in index order) and a note of how much probability the rest carry.
 */
export function probabilityBarsSvg(probs: number[], n: number, opts: { title?: string; qubits?: number[] } = {}): string {
  const all = probs.map((p, k) => ({ k, p: p < 1e-12 ? 0 : p }));
  let bars = all;
  let rest = 0;
  if (all.length > MAX_BARS) {
    const top = [...all].sort((a, b) => b.p - a.p || a.k - b.k).slice(0, MAX_BARS);
    const keep = new Set(top.filter((b) => b.p > 0).map((b) => b.k));
    bars = all.filter((b) => keep.has(b.k));
    rest = all.filter((b) => !keep.has(b.k)).reduce((s, b) => s + b.p, 0);
  }
  const labels = bars.map((b) => `|${ketLabel(b.k, n)}⟩`);
  const maxLab = Math.max(...labels.map((l) => tw(l, 11)));
  const slot = Math.max(22, Math.min(46, Math.floor(560 / Math.max(1, bars.length))));
  const rotate = maxLab + 6 > slot;
  const L = 58, Rm = 16, T = opts.title ? 30 : 16;
  const plotW = bars.length * slot;
  const W = Math.max(300, L + plotW + Rm);
  const xLabH = rotate ? maxLab + 10 : 18;
  const plotH = 190;
  const xs0 = L + (W - L - Rm - plotW) / 2;
  const B = T + plotH;
  const pmax = Math.max(0, ...bars.map((b) => b.p));
  const top = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((v) => v >= pmax - 1e-12) ?? 1;
  const ticks = 5;
  const out: string[] = [];
  if (opts.title) out.push(text(W / 2, 18, opts.title, "middle", 12));
  for (let i = 0; i <= ticks; i++) {
    const v = (top * i) / ticks;
    const y = B - (plotH * i) / ticks;
    out.push(line(L, y, W - Rm, y, i === 0 ? "#000000" : "#e3e3e3", i === 0 ? 1 : 0.8));
    out.push(line(L - 4, y, L, y));
    out.push(text(L - 7, y + 4, sig(v, 3), "end", 11));
  }
  out.push(line(L, T, L, B));
  const yTitle = T + plotH / 2;
  out.push(`<text x="16" y="${f(yTitle)}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#000000" transform="rotate(-90 16 ${f(yTitle)})">Probability</text>`);
  const bw = Math.min(30, slot * 0.7);
  bars.forEach((b, i) => {
    const xc = xs0 + slot * (i + 0.5);
    const h = (plotH * b.p) / top;
    if (h > 0) out.push(`<rect x="${f(xc - bw / 2)}" y="${f(B - h)}" width="${f(bw)}" height="${f(h)}" fill="#1f5fa8"/>`);
    if (bars.length <= 16 && b.p > 0) out.push(text(xc, B - h - 4, sig(b.p, 3), "middle", 10));
    if (rotate) {
      // Centred on its own point (the rotated box the layout gate measures), its top 6 px under the axis.
      const y = B + 6 + tw(labels[i], 11) / 2;
      out.push(`<text x="${f(xc + 4)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#000000" transform="rotate(-90 ${f(xc + 4)} ${f(y)})">${esc(labels[i])}</text>`);
    } else out.push(text(xc, B + 15, labels[i], "middle", 11));
  });
  const qs = opts.qubits ?? Array.from({ length: n }, (_, q) => q);
  let yb = B + xLabH + 18;
  const axisTitle = qs.length === 1 ? `Outcome of qubit ${qs[0]}` : `Outcome (leftmost bit = qubit ${qs[0]})`;
  out.push(text(L + (W - L - Rm) / 2, yb, axisTitle, "middle", 12));
  if (rest > 0) {
    yb += 16;
    out.push(text(L + (W - L - Rm) / 2, yb, `${all.length - bars.length} other outcomes not drawn: total ${sig(rest, 3)}`, "middle", 11, "#444444"));
  }
  return svgOpen(W, yb + 10) + out.join("") + "</svg>";
}
