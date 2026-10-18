/**
 * What an imported DXF becomes (docs/SCOPE-CAD-IMPORT.md, R3a):
 *   - a FIGURE: the drawing at its true size as SVG — the file's own line types and
 *     weights, its text with Ø / ° / ±, arcs as arcs — to insert into Word (fitted to
 *     the page there, the stated scale explained, as engineering sheets are);
 *   - a SKETCH: lines, arcs and circles as editable sketch geometry, for a single
 *     profile or a flat pattern; refused by name for what a sketch cannot hold.
 */
import type { DxfDrawing, DxfItem } from "./dxf";
import { MAX_POINTS, type Sketch } from "./sketch";

const PX_PER_MM = 96 / 25.4;
/** A line with no weight in the file: ISO 128 narrow, 0.25 mm (PRODUCT). */
export const DEFAULT_WEIGHT_MM = 0.25;
const MARGIN_MM = 2;

export interface DxfFigure {
  svg: string;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
}

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();

type DxfTextItem = Extract<DxfItem, { kind: "text" }>;

/** How far below the insertion point the first line's baseline sits (drawing units; negative = above). */
function firstBaseline(it: DxfTextItem): number {
  const cap = it.h, n = it.lines.length, em = cap / 0.716;
  return it.valign === "top" ? cap : it.valign === "middle" ? cap / 2 - ((n - 1) * cap * 5) / 6 : it.valign === "bottom" ? -0.21 * em - ((n - 1) * cap * 5) / 3 : 0;
}

/**
 * The corners of a text's box in drawing units (y up), rotated with it. Widths are estimated at
 * 0.65 em a character (wider than Arial's average, so the box errs on the side of room).
 */
function textCorners(it: DxfTextItem): Array<[number, number]> {
  const cap = it.h, em = cap / 0.716, n = it.lines.length;
  const w = Math.max(0, ...it.lines.map((l) => l.length)) * 0.65 * em;
  const first = firstBaseline(it);
  const top = -(first - cap * 1.1), bottom = -(first + ((n - 1) * cap * 5) / 3 + 0.21 * em);
  const x0 = it.anchor === "middle" ? -w / 2 : it.anchor === "end" ? -w : 0;
  const t = ((it.rot ?? 0) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  return [
    [x0, top],
    [x0 + w, top],
    [x0, bottom],
    [x0 + w, bottom],
  ].map(([u, v]) => [it.x + u * c - v * sn, it.y + u * sn + v * c] as [number, number]);
}

/** The drawing at true size (mmPerUnit: the file's units, or the ones the user chose). */
export function dxfFigure(d: DxfDrawing, mmPerUnit: number): DxfFigure | string {
  if (!(mmPerUnit > 0)) return "choose the drawing's units first";
  if (!d.bounds || !d.items.length) return "the file has nothing this importer can draw";
  // The geometry's bounds, grown to hold every text's box: a note set below or beside its
  // insertion point must not be cut off at the picture's edge.
  let { minX, minY, maxX, maxY } = d.bounds;
  for (const it of d.items) {
    if (it.kind !== "text") continue;
    for (const [x, y] of textCorners(it)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const k = mmPerUnit * PX_PER_MM;
  const wMm = (maxX - minX) * mmPerUnit + 2 * MARGIN_MM, hMm = (maxY - minY) * mmPerUnit + 2 * MARGIN_MM;
  if (wMm > 5000 || hMm > 5000) return `at ${f2(mmPerUnit)} mm per unit the drawing is ${f2(wMm / 1000)} × ${f2(hMm / 1000)} m — check its units`;
  const m = MARGIN_MM * PX_PER_MM;
  const X = (x: number): number => (x - minX) * k + m;
  const Y = (y: number): number => (maxY - y) * k + m;
  // Strokes grouped by weight and dash: one path each.
  const groups = new Map<string, string[]>();
  const fills: string[] = [];
  const texts: string[] = [];
  const style = (it: DxfItem): string => {
    const w = Math.max(0.13, it.weightMm ?? DEFAULT_WEIGHT_MM);
    const dash = it.dash.length ? it.dash.map((v) => (v === 0 ? w * 0.5 : Math.abs(v) * mmPerUnit) * PX_PER_MM) : [];
    return `stroke-width="${f2(w * PX_PER_MM)}"` + (dash.length ? ` stroke-dasharray="${dash.map(f2).join(" ")}" stroke-linecap="butt"` : ` stroke-linecap="round" stroke-linejoin="round"`);
  };
  const add = (it: DxfItem, d0: string): void => {
    const s = style(it);
    (groups.get(s) ?? groups.set(s, []).get(s)!).push(d0);
  };
  for (const it of d.items) {
    if (it.kind === "line") add(it, `M${f2(X(it.x1))} ${f2(Y(it.y1))}L${f2(X(it.x2))} ${f2(Y(it.y2))}`);
    else if (it.kind === "arc") {
      const r = it.r * k;
      if (it.full) {
        // Two half arcs: a closed circle inside one path.
        add(it, `M${f2(X(it.cx) + r)} ${f2(Y(it.cy))}A${f2(r)} ${f2(r)} 0 1 0 ${f2(X(it.cx) - r)} ${f2(Y(it.cy))}A${f2(r)} ${f2(r)} 0 1 0 ${f2(X(it.cx) + r)} ${f2(Y(it.cy))}`);
      } else {
        const x0 = X(it.cx + it.r * Math.cos(it.a0)), y0 = Y(it.cy + it.r * Math.sin(it.a0));
        const x1 = X(it.cx + it.r * Math.cos(it.a1)), y1 = Y(it.cy + it.r * Math.sin(it.a1));
        // Counter-clockwise in the drawing is clockwise on screen (y down): sweep 0.
        add(it, `M${f2(x0)} ${f2(y0)}A${f2(r)} ${f2(r)} 0 ${it.a1 - it.a0 > Math.PI ? 1 : 0} 0 ${f2(x1)} ${f2(y1)}`);
      }
    } else if (it.kind === "poly") add(it, "M" + it.pts.map(([x, y]) => `${f2(X(x))} ${f2(Y(y))}`).join("L") + (it.closed ? "Z" : ""));
    else if (it.kind === "fill") fills.push(`<path d="M${it.pts.map(([x, y]) => `${f2(X(x))} ${f2(Y(y))}`).join("L")}Z" fill="#000" stroke="none"/>`);
    else {
      // Text: the file's height is the capitals' (Arial caps ≈ 0.716 em); lines 5/3 of it apart.
      const capPx = it.h * k, fs = capPx / 0.716;
      const x = X(it.x), y = Y(it.y);
      const first = firstBaseline(it) * k;
      const anchor = it.anchor === "middle" ? "middle" : it.anchor === "end" ? "end" : "start";
      const body = it.lines.map((ln, i) => `<tspan x="${f2(x)}" y="${f2(y + first + (i * capPx * 5) / 3)}">${esc(ln)}</tspan>`).join("");
      texts.push(`<text text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${f2(fs)}" fill="#000"${it.rot ? ` transform="rotate(${f2(-it.rot)} ${f2(x)} ${f2(y)})"` : ""}>${body}</text>`);
    }
  }
  const W = wMm * PX_PER_MM, H = hMm * PX_PER_MM;
  const paths = [...groups].map(([s, ds]) => `<path d="${ds.join("")}" fill="none" stroke="#000" ${s}/>`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}" height="${f2(H)}" viewBox="0 0 ${f2(W)} ${f2(H)}">` +
    `<rect width="${f2(W)}" height="${f2(H)}" fill="#fff"/>` +
    fills.join("") +
    paths.join("") +
    texts.join("") +
    `</svg>`;
  return { svg, widthPx: W, heightPx: H, widthMm: wMm, heightMm: hMm };
}

/**
 * Lines, arcs and circles as sketch geometry (mm): ends that meet share one point. Refused by name
 * for curves a sketch cannot hold (ellipses, splines), or past the sketch's point limit.
 */
export function dxfSketch(d: DxfDrawing, mmPerUnit: number): { ok: true; sketch: Sketch; notes: string[] } | { ok: false; reason: string } {
  if (!(mmPerUnit > 0)) return { ok: false, reason: "choose the drawing's units first" };
  const curves = d.items.filter((i) => i.kind === "poly").length;
  if (curves) return { ok: false, reason: `the drawing has ${curves} ellipse${curves === 1 ? "" : "s"} or spline${curves === 1 ? "" : "s"} — a sketch holds lines, arcs and circles; insert it as a drawing instead` };
  const geo = d.items.filter((i) => i.kind === "line" || i.kind === "arc");
  if (!geo.length) return { ok: false, reason: "the drawing has no lines, arcs or circles to sketch" };
  const span = d.bounds ? Math.max(d.bounds.maxX - d.bounds.minX, d.bounds.maxY - d.bounds.minY) * mmPerUnit : 1;
  // Ends within a millionth of the drawing meet: arc ends are recomputed from angles an exporter
  // may round to six decimals, and must still close on the lines they were drawn to.
  const tol = Math.max(span, 1) * 1e-6;
  const sk: Sketch = { points: [], entities: [], constraints: [] };
  let seq = 1;
  const point = (x: number, y: number): string => {
    const found = sk.points.find((p) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol);
    if (found) return found.id;
    const id = `p${seq++}`;
    sk.points.push({ id, x, y });
    return id;
  };
  let zero = 0;
  for (const it of geo) {
    if (it.kind === "line") {
      if (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) * mmPerUnit <= tol) {
        zero++;
        continue;
      }
      sk.entities.push({ id: `L${seq++}`, kind: "line", a: point(it.x1 * mmPerUnit, it.y1 * mmPerUnit), b: point(it.x2 * mmPerUnit, it.y2 * mmPerUnit) });
    } else if (it.kind === "arc") {
      const c = point(it.cx * mmPerUnit, it.cy * mmPerUnit);
      if (it.full) sk.entities.push({ id: `C${seq++}`, kind: "circle", c, r: it.r * mmPerUnit });
      else {
        const a = point((it.cx + it.r * Math.cos(it.a0)) * mmPerUnit, (it.cy + it.r * Math.sin(it.a0)) * mmPerUnit);
        const b = point((it.cx + it.r * Math.cos(it.a1)) * mmPerUnit, (it.cy + it.r * Math.sin(it.a1)) * mmPerUnit);
        sk.entities.push({ id: `A${seq++}`, kind: "arc", c, a, b });
      }
    }
    if (sk.points.length > MAX_POINTS) return { ok: false, reason: `the drawing has more than ${MAX_POINTS} points — a sketch holds ${MAX_POINTS}; insert it as a drawing instead, or a smaller part of it` };
  }
  const notes: string[] = [];
  const texts = d.items.filter((i) => i.kind === "text").length, fills = d.items.filter((i) => i.kind === "fill").length;
  if (texts) notes.push(`${texts} text item${texts === 1 ? " was" : "s were"} left out of the sketch.`);
  if (fills) notes.push(`${fills} filled shape${fills === 1 ? " was" : "s were"} left out of the sketch.`);
  if (zero) notes.push(`${zero} line${zero === 1 ? "" : "s"} of zero length ${zero === 1 ? "was" : "were"} left out.`);
  return { ok: true, sketch: sk, notes };
}
