// The data-sketch surface and fit overlay for the Solve equation canvas.
//
// Unlike the geometry surface, data lives in all four quadrants: the world is
// x ∈ [−8, 8], y ∈ [−5, 5] with the axes drawn through the origin. And unlike
// geometry, the fit overlay does NOT need equal scale — data axes carry
// different units, and forcing equal scale would flatten a steep exponential
// into a line. The overlay says which model and what R² on its face.

import { SketchPt, FitResult } from "./sketchFit";
import { parseExpr, evalAst } from "./solve";

export const SK_X0 = -8, SK_X1 = 8, SK_Y0 = -5, SK_Y1 = 5;
export const SK_SNAP = 0.5;
const PX = 36;
const FOOTER_H = 22;
export const SK_VIEW = { w: (SK_X1 - SK_X0) * PX, h: (SK_Y1 - SK_Y0) * PX + FOOTER_H };

const GRID_MINOR = "#eef1f4";
const GRID_MAJOR = "#dde3e9";
const AXIS = "#9aa6b2";
const PT = "#0c4a6e";
const CURVE = "#b45309";
const INK = "#111111";
const PAPER = "#ffffff";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtN = (v: number): string => String(Math.round(v * 100) / 100);

export const skSnap = (v: number): number => Math.round(v / SK_SNAP) * SK_SNAP;
export const skSnapPt = (p: SketchPt): SketchPt => ({
  x: Number.isFinite(p.x) ? Math.min(SK_X1, Math.max(SK_X0, skSnap(p.x))) : 0,
  y: Number.isFinite(p.y) ? Math.min(SK_Y1, Math.max(SK_Y0, skSnap(p.y))) : 0,
});

const X = (x: number): number => (x - SK_X0) * PX;
const Y = (y: number): number => (SK_Y1 - y) * PX;
const GRID_H = (SK_Y1 - SK_Y0) * PX;

/** The click surface: four-quadrant grid, axes, points, footer readout. */
export function sketchSurfaceSvg(pts: SketchPt[], hover: SketchPt | null): string {
  if (hover && !(Number.isFinite(hover.x) && Number.isFinite(hover.y))) hover = null;
  const { w: W, h: H } = SK_VIEW;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;touch-action:none">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  for (let x = SK_X0; x <= SK_X1; x += SK_SNAP) {
    p.push(`<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${GRID_H}" stroke="${x % 1 === 0 ? GRID_MAJOR : GRID_MINOR}" stroke-width="1"/>`);
  }
  for (let y = SK_Y0; y <= SK_Y1; y += SK_SNAP) {
    p.push(`<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="${y % 1 === 0 ? GRID_MAJOR : GRID_MINOR}" stroke-width="1"/>`);
  }
  // Axes through the origin, darker.
  p.push(`<line x1="${X(0)}" y1="0" x2="${X(0)}" y2="${GRID_H}" stroke="${AXIS}" stroke-width="1.5"/>`);
  p.push(`<line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="${AXIS}" stroke-width="1.5"/>`);

  for (const q of pts) {
    p.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="4" fill="${PT}"/>`);
  }
  if (hover) {
    p.push(`<circle cx="${X(hover.x)}" cy="${Y(hover.y)}" r="3.5" fill="none" stroke="${CURVE}" stroke-width="1.5"/>`);
    p.push(
      `<text x="6" y="${GRID_H + FOOTER_H - 7}" font-family="sans-serif" font-size="12" fill="#555">` +
      `(${fmtN(hover.x)}, ${fmtN(hover.y)})   ·   ${pts.length} point${pts.length === 1 ? "" : "s"} — click to add, click a point to remove</text>`
    );
  }
  p.push("</svg>");
  return p.join("");
}

/**
 * The fit overlay: the points with ONE fitted curve through them, captioned
 * with the exact expression and the R² OF THAT EXPRESSION. Not equal-scale —
 * data axes are not lengths.
 */
export function sketchFitSvg(pts: SketchPt[], fit: FitResult): string {
  if (!pts.length) return "";
  let ast;
  try {
    ast = parseExpr(fit.expr);
  } catch {
    return "";
  }
  const W = 460, H = 320;
  const MT = 18, ML = 34, MR = 18, MB = 56;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const padX = Math.max((x1 - x0) * 0.08, 0.5);

  // Sample the curve over the padded x-range; skip non-finite stretches (a
  // log fit sampled at x ≤ 0 breaks the path rather than lying through it).
  const N = 160;
  const samples: ({ x: number; y: number } | null)[] = [];
  for (let i = 0; i <= N; i++) {
    const x = x0 - padX + ((x1 - x0 + 2 * padX) * i) / N;
    let y: number;
    try {
      y = evalAst(ast, { x });
    } catch {
      samples.push(null);
      continue;
    }
    samples.push(Number.isFinite(y) ? { x, y } : null);
  }
  const curveYs = samples.filter((s): s is { x: number; y: number } => !!s).map((s) => s.y);
  const y0 = Math.min(...ys, ...curveYs), y1 = Math.max(...ys, ...curveYs);
  const spanY = Math.max(y1 - y0, 1e-9);
  const sx = (W - ML - MR) / Math.max(x1 - x0 + 2 * padX, 1e-9);
  const sy = (H - MT - MB) / (spanY * 1.16);
  const PXx = (x: number): number => ML + (x - (x0 - padX)) * sx;
  const PXy = (y: number): number => MT + (y1 + spanY * 0.08 - y) * sy;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  // Axes at zero when zero is in range.
  if (y0 <= 0 && y1 >= 0) p.push(`<line x1="${ML}" y1="${PXy(0)}" x2="${W - MR}" y2="${PXy(0)}" stroke="${AXIS}" stroke-width="1"/>`);
  if (x0 - padX <= 0 && x1 + padX >= 0) p.push(`<line x1="${PXx(0)}" y1="${MT}" x2="${PXx(0)}" y2="${H - MB}" stroke="${AXIS}" stroke-width="1"/>`);

  // The curve, broken where samples were non-finite.
  let d = "";
  let pen = false;
  for (const s of samples) {
    if (!s) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${PXx(s.x).toFixed(2)} ${PXy(s.y).toFixed(2)} `;
    pen = true;
  }
  if (d) p.push(`<path d="${d.trim()}" fill="none" stroke="${CURVE}" stroke-width="2"/>`);

  for (const q of pts) {
    p.push(`<circle cx="${PXx(q.x)}" cy="${PXy(q.y)}" r="3.4" fill="${PT}"/>`);
  }

  p.push(
    `<text x="${W / 2}" y="${H - 36}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${INK}">${esc(`y = ${fit.expr}`)}</text>`
  );
  p.push(
    `<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${INK}">` +
    `${esc(`${fit.model} — R² = ${fmtN(fit.r2)} (adjusted ${Number.isFinite(fit.adjR2) ? fmtN(fit.adjR2) : "n/a at this n"}), RMSE ${fmtN(fit.rmse)}, n = ${pts.length}`)}</text>`
  );
  p.push(
    `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#888888">R² computed from the displayed expression — the quality of exactly this formula</text>`
  );
  p.push("</svg>");
  return p.join("");
}
