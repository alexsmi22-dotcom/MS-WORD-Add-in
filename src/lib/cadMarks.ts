/**
 * Marks drawn by hand on a drawing's figures: pencil strokes, lines, arrows, text
 * and reference numerals with lead lines. What the user draws is what is kept —
 * no snapping, no solving, no profile rules.
 *
 * Each mark belongs to one view (by its kind: "front", "iso", …) and is stored in
 * that view's own plane, in model units (the coordinates drawLines gives). So a
 * mark moves and scales with its figure when the sheet is laid out again (a part
 * added, a sheet size changed), and it reopens with the drawing.
 */

export type MarkPt = [number, number];

export type SheetMark =
  /** A freehand stroke, kept as drawn. */
  | { kind: "pen"; view: string; pts: MarkPt[] }
  /** A straight line from a to b; with an arrowhead at b when `arrow`. */
  | { kind: "line"; view: string; a: MarkPt; b: MarkPt; arrow?: boolean }
  /** Text whose left end of the baseline is at `at`. */
  | { kind: "text"; view: string; at: MarkPt; text: string }
  /** A reference numeral at `at`, with a lead line to the point `tip` it names. */
  | { kind: "numeral"; view: string; tip: MarkPt; at: MarkPt; label: string };

export const MARK_LIMITS = { marks: 2000, points: 5000, text: 200 };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7;
const isPt = (v: unknown): v is MarkPt => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Reads saved marks field by field; a damaged one refuses the drawing (by its number). */
export function parseMarks(raw: unknown): { ok: true; marks: SheetMark[] } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, marks: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "its hand-drawn marks are damaged" };
  if (raw.length > MARK_LIMITS.marks) return { ok: false, reason: `it has more than ${MARK_LIMITS.marks} hand-drawn marks` };
  const out: SheetMark[] = [];
  for (const [i, m] of raw.entries()) {
    const bad = { ok: false as const, reason: `hand-drawn mark ${i + 1} is damaged` };
    if (!m || typeof m !== "object" || !isStr((m as { view?: unknown }).view, 20)) return bad;
    const v = m as Record<string, unknown>;
    const view = v.view as string;
    if (v.kind === "pen") {
      if (!Array.isArray(v.pts) || v.pts.length < 2 || v.pts.length > MARK_LIMITS.points || !v.pts.every(isPt)) return bad;
      out.push({ kind: "pen", view, pts: v.pts.map((p) => [p[0], p[1]]) });
    } else if (v.kind === "line") {
      if (!isPt(v.a) || !isPt(v.b) || (v.arrow !== undefined && typeof v.arrow !== "boolean")) return bad;
      out.push({ kind: "line", view, a: [v.a[0], v.a[1]], b: [v.b[0], v.b[1]], ...(v.arrow ? { arrow: true } : {}) });
    } else if (v.kind === "text") {
      if (!isPt(v.at) || !isStr(v.text, MARK_LIMITS.text)) return bad;
      out.push({ kind: "text", view, at: [v.at[0], v.at[1]], text: v.text });
    } else if (v.kind === "numeral") {
      if (!isPt(v.tip) || !isPt(v.at) || !isStr(v.label, 20)) return bad;
      out.push({ kind: "numeral", view, tip: [v.tip[0], v.tip[1]], at: [v.at[0], v.at[1]], label: v.label });
    } else return bad;
  }
  return { ok: true, marks: out };
}

/**
 * A stroke as drawn, with the points that add nothing dropped: closer than `minStep`
 * to the last kept point. The ends are always kept. Capped at MARK_LIMITS.points by
 * keeping every k-th point (a very long stroke, never refused).
 */
export function simplifyStroke(pts: MarkPt[], minStep: number): MarkPt[] {
  if (pts.length < 2) return pts.slice();
  const out: MarkPt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= minStep) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  if (out.length <= MARK_LIMITS.points) return out;
  const k = Math.ceil(out.length / (MARK_LIMITS.points - 1));
  const thin = out.filter((_, i) => i % k === 0);
  thin.push(out[out.length - 1]);
  return thin;
}

/** Text width in em (as dxfOut estimates: capitals and digits 0.8, a space 0.28, others 0.6). */
export function textEm(t: string): number {
  let w = 0;
  for (const ch of t) w += /[A-Z0-9@%&#]/.test(ch) ? 0.8 : ch === " " ? 0.28 : 0.6;
  return w;
}

/**
 * The extent of a view's marks in its plane (model units), so the sheet leaves room
 * for them. Text needs its size in model units: `textUnits` = the font size (em)
 * divided by the sheet scale, which is not known before layout — the caller passes
 * its best estimate and the box errs on the side of room.
 */
export function marksExtent(marks: SheetMark[], textUnits: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const m of marks) {
    if (m.kind === "pen") for (const p of m.pts) add(p[0], p[1]);
    else if (m.kind === "line") {
      add(m.a[0], m.a[1]);
      add(m.b[0], m.b[1]);
    } else if (m.kind === "text") {
      add(m.at[0], m.at[1] - 0.25 * textUnits);
      add(m.at[0] + textEm(m.text) * textUnits, m.at[1] + 0.8 * textUnits);
    } else {
      add(m.tip[0], m.tip[1]);
      const half = (textEm(m.label) * textUnits) / 2;
      add(m.at[0] - half, m.at[1] - 0.5 * textUnits);
      add(m.at[0] + half, m.at[1] + 0.5 * textUnits);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

export interface MarkStyle {
  /** Model point → sheet px. */
  X: (x: number) => number;
  Y: (y: number) => number;
  strokePx: number;
  fontPx: number;
  font: string;
}

const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One mark as SVG (black, the sheet's visible-line width and text size). */
export function markSvg(m: SheetMark, s: MarkStyle): string {
  const P = (p: MarkPt): string => `${f2(s.X(p[0]))} ${f2(s.Y(p[1]))}`;
  const stroke = `fill="none" stroke="#000" stroke-width="${f2(s.strokePx)}" stroke-linecap="round" stroke-linejoin="round"`;
  const text = (x: number, y: number, t: string, anchor: string): string =>
    `<text x="${f2(x)}" y="${f2(y)}" text-anchor="${anchor}" font-family="${esc(s.font)}" font-size="${f2(s.fontPx)}" fill="#000">${esc(t)}</text>`;
  if (m.kind === "pen") return `<path d="M${m.pts.map(P).join("L")}" ${stroke}/>`;
  if (m.kind === "line") {
    let out = `<path d="M${P(m.a)}L${P(m.b)}" ${stroke}/>`;
    if (m.arrow) {
      // A filled head 3:1, as long as the text is high (ISO 129-1 / ASME Y14.2 proportions).
      const bx = s.X(m.b[0]), by = s.Y(m.b[1]);
      const dx = bx - s.X(m.a[0]), dy = by - s.Y(m.a[1]);
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const len = Math.min(s.fontPx, L * 0.5), wid = len / 3;
      const cx = bx - ux * len, cy = by - uy * len;
      out += `<path d="M${f2(bx)} ${f2(by)}L${f2(cx - uy * wid)} ${f2(cy + ux * wid)}L${f2(cx + uy * wid)} ${f2(cy - ux * wid)}Z" fill="#000" stroke="none"/>`;
    }
    return out;
  }
  if (m.kind === "text") return text(s.X(m.at[0]), s.Y(m.at[1]), m.text, "start");
  // A numeral: centred on `at`, its lead line stopping short of the text (37 CFR 1.84(q)).
  const ax = s.X(m.at[0]), ay = s.Y(m.at[1]);
  const tx = s.X(m.tip[0]), ty = s.Y(m.tip[1]);
  const dx = tx - ax, dy = ty - ay;
  const L = Math.hypot(dx, dy);
  const gap = s.fontPx * 0.8;
  const lead = L > gap ? `<path d="M${f2(ax + (dx / L) * gap)} ${f2(ay + (dy / L) * gap)}L${f2(tx)} ${f2(ty)}" ${stroke}/>` : "";
  return lead + `<text x="${f2(ax)}" y="${f2(ay)}" dy="0.35em" text-anchor="middle" font-family="${esc(s.font)}" font-size="${f2(s.fontPx)}" fill="#000">${esc(m.label)}</text>`;
}

/** Distance in sheet px from (x, y) to the mark as drawn (for the eraser). */
export function markDistance(m: SheetMark, s: MarkStyle, x: number, y: number): number {
  const seg = (a: MarkPt, b: MarkPt): number => {
    const ax = s.X(a[0]), ay = s.Y(a[1]), bx = s.X(b[0]), by = s.Y(b[1]);
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  };
  const box = (cx: number, cy: number, w: number, h: number): number => Math.hypot(Math.max(0, Math.abs(x - cx) - w / 2), Math.max(0, Math.abs(y - cy) - h / 2));
  if (m.kind === "pen") {
    let d = Infinity;
    for (let i = 1; i < m.pts.length; i++) d = Math.min(d, seg(m.pts[i - 1], m.pts[i]));
    return d;
  }
  if (m.kind === "line") return seg(m.a, m.b);
  if (m.kind === "text") {
    const w = textEm(m.text) * s.fontPx;
    return box(s.X(m.at[0]) + w / 2, s.Y(m.at[1]) - s.fontPx * 0.3, w, s.fontPx);
  }
  const w = textEm(m.label) * s.fontPx;
  return Math.min(seg(m.tip, m.at), box(s.X(m.at[0]), s.Y(m.at[1]), w, s.fontPx));
}
