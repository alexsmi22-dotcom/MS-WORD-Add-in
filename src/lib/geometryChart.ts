// Figure for composite plane figures: the base shape drawn to scale with its
// dimensions labelled, cutouts hatched inside it, additions attached beside
// it. The AREAS are what the solver computes; the PLACEMENT of the inner
// shapes is not determined by the dimensions, so the figure says "placement
// illustrative" on its face rather than implying knowledge it does not have.
//
// EQUAL SCALE on both axes — a 10 × 5 rectangle drawn stretched is a
// different rectangle (the same rule sectionShapeSvg lives by).

import { CompositeResult, CompositeShape, qtyToNumber } from "./compositeGeometry";

const INK = "#111111";
const RULE = "#888888";
const PAPER = "#ffffff";
const BASE_FILL = "#eef4f8";
const BASE_EDGE = "#0c4a6e";
const CUT_EDGE = "#b91c1c";
const ADD_EDGE = "#15803d";
const ADD_FILL = "#ecf7ef";

export const COMPOSITE_CHART_SIZE = { w: 460, h: 320 };

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtN = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
};

/** Outline path for a shape whose bounding box's top-left is (x, y), drawn at `scale` px per unit. */
function shapePath(s: CompositeShape, x: number, y: number, scale: number): string {
  const w = s.bbox.w * scale;
  const h = s.bbox.h * scale;
  switch (s.kind) {
    case "rectangle":
    case "square":
      return `M${x} ${y} h${w} v${h} h${-w} Z`;
    case "circle": {
      const r = w / 2;
      return `M${x} ${y + h / 2} a${r} ${r} 0 1 0 ${w} 0 a${r} ${r} 0 1 0 ${-w} 0 Z`;
    }
    case "semicircle": {
      // Flat side down, arc up: bbox is 2r wide, r tall.
      const r = w / 2;
      return `M${x} ${y + h} a${r} ${r} 0 0 1 ${w} 0 Z`;
    }
    case "triangle": {
      if ("a" in s.dims && "c" in s.dims) {
        // Three sides: base = longest side along the bottom; apex from the
        // side lengths (a c-length edge from the left end, b-length from the right).
        const sides = [s.dims.a, s.dims.b, s.dims.c].sort((p, q) => p - q);
        const base = sides[2];
        const e1 = sides[0];
        const e2 = sides[1];
        const px = (base * base + e1 * e1 - e2 * e2) / (2 * base);
        const py = Math.sqrt(Math.max(0, e1 * e1 - px * px));
        return `M${x} ${y + h} l${base * scale} 0 L${x + px * scale} ${y + h - py * scale} Z`;
      }
      // base/height: apex centred over the base.
      return `M${x} ${y + h} h${w} L${x + w / 2} ${y} Z`;
    }
    case "trapezoid": {
      // Parallel sides a (bottom) and b (top), top side centred.
      const a = Math.max(s.dims.a, s.dims.b) * scale;
      const b = Math.min(s.dims.a, s.dims.b) * scale;
      const inset = (a - b) / 2;
      return `M${x} ${y + h} h${a} l${-inset} ${-h} h${-b} Z`;
    }
  }
}

/** A dimension label under/beside a shape. */
function dimText(s: CompositeShape, unit: string | null): string {
  const u = unit ? ` ${unit}` : "";
  switch (s.kind) {
    case "rectangle":
      return `${fmtN(s.dims.w)} × ${fmtN(s.dims.h)}${u}`;
    case "square":
      return `s = ${fmtN(s.dims.s)}${u}`;
    case "circle":
    case "semicircle":
      return `r = ${fmtN(s.dims.r)}${u}`;
    case "triangle":
      return "a" in s.dims && "c" in s.dims
        ? `${fmtN(s.dims.a)}, ${fmtN(s.dims.b)}, ${fmtN(s.dims.c)}${u}`
        : `b = ${fmtN(s.dims.b)}, h = ${fmtN(s.dims.h)}${u}`;
    case "trapezoid":
      return `a = ${fmtN(s.dims.a)}, b = ${fmtN(s.dims.b)}, h = ${fmtN(s.dims.h)}${u}`;
  }
}

/**
 * Draws the composite figure. Cutouts are laid out in a row across the base's
 * middle (scaled down if the row would not fit — the caption owns the truth
 * about sizes; the drawing stays legible). Additions attach to the base's
 * right edge.
 */
export function compositeShapeSvg(result: CompositeResult): string {
  const { w: W, h: H } = COMPOSITE_CHART_SIZE;
  if (!result.shapes.length || result.incomplete) {
    return emptyChart(W, H, result.incomplete ?? "No shapes to draw");
  }
  const base = result.shapes[0];
  const cuts = result.shapes.filter((s) => s.op === "minus");
  const adds = result.shapes.filter((s) => s.op === "plus");

  const MT = 30;
  const MB = 58; // room for the caption lines
  const ML = 16;
  const MR = 16;

  // Scale from the full extent: base plus any additions attached to its right.
  const totalW = base.bbox.w + adds.reduce((acc, s) => acc + s.bbox.w, 0);
  const totalH = Math.max(base.bbox.h, ...adds.map((s) => s.bbox.h), 0);
  if (!(totalW > 0) || !(totalH > 0)) return emptyChart(W, H, "The dimensions do not define a figure to draw");
  const gap = adds.length ? 8 : 0;
  const scale = Math.min((W - ML - MR - gap * adds.length) / totalW, (H - MT - MB) / totalH);

  const baseW = base.bbox.w * scale;
  const baseH = base.bbox.h * scale;
  const x0 = ML + (W - ML - MR - totalW * scale - gap * adds.length) / 2;
  const y0 = MT + (H - MT - MB - baseH) / 2;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(
    `<defs><pattern id="cutHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<line x1="0" y1="0" x2="0" y2="6" stroke="${CUT_EDGE}" stroke-width="1" opacity="0.55"/></pattern></defs>`,
  );

  // Base shape.
  p.push(`<path d="${shapePath(base, x0, y0, scale)}" fill="${BASE_FILL}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`);

  // Cutouts: a centred row inside the base, shrunk if the row would overflow.
  if (cuts.length) {
    const rowGap = 10;
    const rowW = cuts.reduce((acc, s) => acc + s.bbox.w, 0) * scale + rowGap * (cuts.length - 1);
    const rowH = Math.max(...cuts.map((s) => s.bbox.h)) * scale;
    const fit = Math.min(1, (baseW * 0.82) / Math.max(rowW, 1e-9), (baseH * 0.82) / Math.max(rowH, 1e-9));
    const cScale = scale * fit;
    let cx = x0 + (baseW - (cuts.reduce((acc, s) => acc + s.bbox.w, 0) * cScale + rowGap * (cuts.length - 1))) / 2;
    for (const s of cuts) {
      const cy = y0 + (baseH - s.bbox.h * cScale) / 2;
      const d = shapePath(s, cx, cy, cScale);
      p.push(`<path d="${d}" fill="url(#cutHatch)" stroke="${CUT_EDGE}" stroke-width="1.3"/>`);
      const label = dimText(s, result.unit);
      p.push(
        `<text x="${cx + (s.bbox.w * cScale) / 2}" y="${cy + s.bbox.h * cScale + 12}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${CUT_EDGE}">${esc(`− ${label}`)}</text>`,
      );
      cx += s.bbox.w * cScale + rowGap;
    }
    if (fit < 1) {
      p.push(
        `<text x="${x0 + baseW / 2}" y="${y0 - 18}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="${RULE}">cutouts drawn reduced to stay legible — the caption carries the true sizes</text>`,
      );
    }
  }

  // Additions: attached along the base's right edge.
  let ax = x0 + baseW + gap;
  for (const s of adds) {
    const ay = y0 + (baseH - s.bbox.h * scale) / 2;
    p.push(`<path d="${shapePath(s, ax, ay, scale)}" fill="${ADD_FILL}" stroke="${ADD_EDGE}" stroke-width="1.4"/>`);
    p.push(
      `<text x="${ax + (s.bbox.w * scale) / 2}" y="${ay - 5}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${ADD_EDGE}">${esc(`+ ${dimText(s, result.unit)}`)}</text>`,
    );
    ax += s.bbox.w * scale + gap;
  }

  // Base dimension label.
  p.push(
    `<text x="${x0 + baseW / 2}" y="${y0 - 6}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="${BASE_EDGE}">${esc(`${base.kind} ${dimText(base, result.unit)}`)}</text>`,
  );

  // Caption: the three headline numbers, then the placement disclaimer.
  const u2 = result.unit ? ` ${result.unit}²` : "";
  const capBits = [`base area ${fmtN(qtyToNumber(result.baseArea))}${u2}`];
  if (cuts.length) capBits.push(`removed ${fmtN(qtyToNumber(result.removedArea))}${u2}`);
  if (adds.length) capBits.push(`added ${fmtN(qtyToNumber(result.addedArea))}${u2}`);
  if (cuts.length || adds.length) capBits.push(`net ${fmtN(qtyToNumber(result.netArea))}${u2}`);
  p.push(
    `<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="sans-serif" font-size="10.5" fill="${INK}">${esc(capBits.join("   ·   "))}</text>`,
  );
  if (cuts.length || adds.length) {
    p.push(
      `<text x="${W / 2}" y="${H - 18}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="${RULE}">placement illustrative — the areas do not depend on where the inner shapes sit</text>`,
    );
  }
  p.push("</svg>");
  return p.join("");
}

function emptyChart(W: number, H: number, message: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
    `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${RULE}">${esc(message)}</text>` +
    "</svg>"
  );
}
