// Figure for composite plane figures: the base shape drawn to scale with its
// dimensions labelled, cutouts hatched inside it, additions attached beside
// it. The AREAS are what the solver computes; the PLACEMENT of the inner
// shapes is not determined by the dimensions, so the figure says "placement
// illustrative" on its face rather than implying knowledge it does not have.
//
// EQUAL SCALE on both axes — a 10 × 5 rectangle drawn stretched is a
// different rectangle (the same rule sectionShapeSvg lives by).

import { CompositeResult, CompositeShape, qtyToNumber } from "./compositeGeometry";
import { GeoFigure } from "./geometry";

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

// ---------------------------------------------------------------------------
// Plain-geometry figures — triangle solving, point sets, conics and the circle
// toolkit. Every builder keeps EQUAL SCALE on both axes (a stretched triangle
// is a different triangle) and draws only what the numbers determine.
// ---------------------------------------------------------------------------

/** Equal-scale projector from a math-coordinate bbox into a pixel box (y up). */
function fitBox(
  minX: number, maxX: number, minY: number, maxY: number,
  x0: number, x1: number, y0: number, y1: number
): { X: (x: number) => number; Y: (y: number) => number; s: number } {
  const w = Math.max(maxX - minX, 1e-9);
  const h = Math.max(maxY - minY, 1e-9);
  const s = Math.min((x1 - x0) / w, (y1 - y0) / h);
  const ox = x0 + (x1 - x0 - w * s) / 2 - minX * s;
  const oy = y0 + (y1 - y0 - h * s) / 2 + maxY * s;
  return { X: (x) => ox + x * s, Y: (y) => oy - y * s, s };
}

const round2 = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return String(r);
};

/**
 * One triangle drawn into the given pixel box, sides labelled.
 *
 * ANGLE VALUES GO IN THE CAPTION, NOT AT THE VERTICES. The layout gate caught
 * the vertex labels immediately: for a right triangle the label at the right
 * angle sits on an edge, and for a sliver triangle there is NO interior point
 * far enough from all three edges to hold a label — no offset survives it. A
 * side label, by contrast, can always move PERPENDICULAR to its own edge on
 * the outward side, which clears that edge by construction.
 */
function drawTriangle(
  p: string[], t: { a: number; b: number; c: number; A: number; B: number; C: number },
  x0: number, x1: number, y0: number, y1: number
): void {
  // Vertices: A at the origin, B along the base at distance c, C from side b
  // and angle A. This is a faithful construction, not a sketch.
  const Arad = (t.A * Math.PI) / 180;
  const vA = { x: 0, y: 0 };
  const vB = { x: t.c, y: 0 };
  const vC = { x: t.b * Math.cos(Arad), y: t.b * Math.sin(Arad) };
  const xs = [vA.x, vB.x, vC.x], ys = [vA.y, vB.y, vC.y];
  const { X, Y } = fitBox(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), x0, x1, y0, y1);
  p.push(
    `<path d="M${X(vA.x)} ${Y(vA.y)} L${X(vB.x)} ${Y(vB.y)} L${X(vC.x)} ${Y(vC.y)} Z" ` +
    `fill="${BASE_FILL}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`
  );
  const centroid = { x: (vA.x + vB.x + vC.x) / 3, y: (vA.y + vB.y + vC.y) / 3 };
  // Side labels: perpendicular to the OWN edge, on the side away from the
  // centroid, in PIXEL space (offsetting in math space shrinks with scale).
  const side = (P: { x: number; y: number }, Q: { x: number; y: number }, label: string): void => {
    const mx = (X(P.x) + X(Q.x)) / 2, my = (Y(P.y) + Y(Q.y)) / 2;
    let nx = -(Y(Q.y) - Y(P.y)), ny = X(Q.x) - X(P.x);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    // Flip the normal if it points toward the centroid.
    if (nx * (X(centroid.x) - mx) + ny * (Y(centroid.y) - my) > 0) { nx = -nx; ny = -ny; }
    p.push(
      `<text x="${mx + nx * 11}" y="${my + ny * 11 + 3}" text-anchor="middle" ` +
      `font-family="sans-serif" font-size="9" fill="${INK}">${esc(label)}</text>`
    );
  };
  side(vB, vC, `a = ${round2(t.a)}`);
  side(vA, vC, `b = ${round2(t.b)}`);
  side(vA, vB, `c = ${round2(t.c)}`);
}

const angleLine = (t: { A: number; B: number; C: number }): string =>
  `A = ${round2(t.A)}°, B = ${round2(t.B)}°, C = ${round2(t.C)}°`;

/**
 * The figure for a plain-geometry result. Returns "" when the figure kind has
 * nothing faithful to draw, so the caller can skip the picture entirely rather
 * than insert a placeholder.
 */
export function geometryFigureSvg(fig: GeoFigure): string {
  const { w: W, h: H } = COMPOSITE_CHART_SIZE;
  const MT = 16, MB = 40, ML = 16, MR = 16;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  const caption = (text: string): void => {
    p.push(
      `<text x="${W / 2}" y="${H - 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${INK}">${esc(text)}</text>`
    );
  };

  switch (fig.kind) {
    case "triangle": {
      const ts = fig.triangles.slice(0, 2);
      if (!ts.length) return "";
      // Wide margins: side labels sit OUTSIDE the triangle, and the angle
      // readout takes a caption line of its own.
      const TB = H - MB - 14;
      if (ts.length === 1) {
        drawTriangle(p, ts[0], ML + 26, W - MR - 26, MT + 6, TB);
        p.push(
          `<text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${BASE_EDGE}">${esc(angleLine(ts[0]))}</text>`
        );
      } else {
        // The SSA pair: both solutions, side by side, labelled 1 and 2.
        const mid = W / 2;
        drawTriangle(p, ts[0], ML + 24, mid - 20, MT + 16, TB);
        drawTriangle(p, ts[1], mid + 20, W - MR - 24, MT + 16, TB);
        p.push(`<text x="${(ML + mid) / 2}" y="${MT + 4}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${RULE}">solution 1</text>`);
        p.push(`<text x="${(mid + W - MR) / 2}" y="${MT + 4}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${RULE}">solution 2</text>`);
        p.push(
          `<text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="${BASE_EDGE}">` +
          `${esc(`1: ${angleLine(ts[0])}    2: ${angleLine(ts[1])}`)}</text>`
        );
      }
      caption(
        ts.length === 2
          ? "SSA: both triangles satisfy the given parts — drawn to scale"
          : "drawn to scale from the solved sides and angles"
      );
      break;
    }
    case "points": {
      const all = [...fig.pts, ...(fig.probe ? [fig.probe] : [])];
      if (!all.length) return "";
      const xs = all.map((q) => q.x), ys = all.map((q) => q.y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      const pad = Math.max(spanX, spanY, 1) * 0.08;
      // Extra lateral margin: vertex labels hang outside the hull, and an
      // end-anchored label needs its whole width of clearance.
      const { X, Y } = fitBox(
        Math.min(...xs) - pad, Math.max(...xs) + pad,
        Math.min(...ys) - pad, Math.max(...ys) + pad,
        ML + 40, W - MR - 40, MT + 8, H - MB
      );
      if (fig.closed && fig.pts.length >= 3) {
        const d = fig.pts.map((q, i) => `${i ? "L" : "M"}${X(q.x)} ${Y(q.y)}`).join(" ") + " Z";
        p.push(`<path d="${d}" fill="${BASE_FILL}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`);
      } else if (!fig.closed && fig.pts.length === 2) {
        // A before → after pair (2D transform): an arrow from the first to the second.
        p.push(
          `<line x1="${X(fig.pts[0].x)}" y1="${Y(fig.pts[0].y)}" x2="${X(fig.pts[1].x)}" y2="${Y(fig.pts[1].y)}" ` +
          `stroke="${RULE}" stroke-width="1.2" stroke-dasharray="4 3"/>`
        );
      }
      if (fig.hull && fig.hull.length >= 3) {
        const d = fig.hull.map((q, i) => `${i ? "L" : "M"}${X(q.x)} ${Y(q.y)}`).join(" ") + " Z";
        p.push(`<path d="${d}" fill="none" stroke="${ADD_EDGE}" stroke-width="1.2" stroke-dasharray="5 3"/>`);
      }
      // Vertex labels push OUTWARD from the figure's centre in pixel space —
      // a fixed corner offset put "(-1, 3)" straight across its own edge, and
      // the layout gate caught it.
      const cxm = fig.pts.reduce((acc, q) => acc + q.x, 0) / fig.pts.length;
      const cym = fig.pts.reduce((acc, q) => acc + q.y, 0) / fig.pts.length;
      fig.pts.forEach((q, i) => {
        p.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="2.6" fill="${BASE_EDGE}"/>`);
        let dx = X(q.x) - X(cxm), dy = Y(q.y) - Y(cym);
        const dlen = Math.hypot(dx, dy) || 1;
        dx /= dlen; dy /= dlen;
        const anchor = dx < -0.3 ? "end" : dx > 0.3 ? "start" : "middle";
        p.push(
          `<text x="${X(q.x) + dx * 9}" y="${Y(q.y) + dy * 9 + 3}" text-anchor="${anchor}" ` +
          `font-family="sans-serif" font-size="8" fill="${INK}">` +
          `${esc(`(${round2(q.x)}, ${round2(q.y)})`)}${i === 0 && !fig.closed ? " →" : ""}</text>`
        );
      });
      if (fig.centroid) {
        const cx = X(fig.centroid.x), cy = Y(fig.centroid.y);
        p.push(`<path d="M${cx - 5} ${cy} h10 M${cx} ${cy - 5} v10" stroke="${CUT_EDGE}" stroke-width="1.4"/>`);
      }
      if (fig.probe) {
        p.push(`<circle cx="${X(fig.probe.x)}" cy="${Y(fig.probe.y)}" r="3.4" fill="${CUT_EDGE}"/>`);
        p.push(
          `<text x="${X(fig.probe.x) + 6}" y="${Y(fig.probe.y) + 3}" font-family="sans-serif" font-size="8.5" fill="${CUT_EDGE}">${esc(fig.probe.verdict)}</text>`
        );
      }
      caption(
        fig.probe
          ? `the marked point is ${fig.probe.verdict === "boundary" ? "on the boundary" : fig.probe.verdict}`
          : fig.closed
            ? `${fig.pts.length} vertices${fig.centroid ? " — centroid marked +" : ""}${fig.hull ? ", convex hull dashed" : ""}`
            : "before → after"
      );
      break;
    }
    case "conic": {
      const rot = (fig.rotationDeg * Math.PI) / 180;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const paths: { x: number; y: number }[][] = [];
      const N = 120;
      // The semi-major axis lies along x' only when the classifier says so —
      // 25x² + 4y² = 100 is major-along-y, and drawing a along x' put both
      // foci OUTSIDE the drawn ellipse (the adversarial pass caught it).
      const alongX = fig.alongX !== false;
      if (fig.conic === "circle" || fig.conic === "ellipse") {
        const c = fig.centre!;
        const b = fig.b ?? fig.a;
        const ring: { x: number; y: number }[] = [];
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * 2 * Math.PI;
          const u = alongX ? fig.a * Math.cos(t) : b * Math.cos(t);
          const v = alongX ? b * Math.sin(t) : fig.a * Math.sin(t);
          ring.push({ x: c.x + u * cosR - v * sinR, y: c.y + u * sinR + v * cosR });
        }
        paths.push(ring);
      } else if (fig.conic === "hyperbola") {
        const c = fig.centre!;
        const b = fig.b ?? fig.a;
        for (const sgn of [1, -1]) {
          const branch: { x: number; y: number }[] = [];
          for (let i = 0; i <= N; i++) {
            const t = -1.8 + (i / N) * 3.6;
            const u = alongX ? sgn * fig.a * Math.cosh(t) : b * Math.sinh(t);
            const v = alongX ? b * Math.sinh(t) : sgn * fig.a * Math.cosh(t);
            branch.push({ x: c.x + u * cosR - v * sinR, y: c.y + u * sinR + v * cosR });
          }
          paths.push(branch);
        }
      } else {
        // Parabola: vertex + (t²/4p)·axis + t·perp, a faithful parametrisation.
        const vx = fig.vertex!, ax = fig.axis!;
        const perp = { x: -ax.y, y: ax.x };
        const T = 4 * fig.a;
        const arm: { x: number; y: number }[] = [];
        for (let i = 0; i <= N; i++) {
          const t = -T + (i / N) * 2 * T;
          const depth = (t * t) / (4 * fig.a);
          arm.push({ x: vx.x + depth * ax.x + t * perp.x, y: vx.y + depth * ax.y + t * perp.y });
        }
        paths.push(arm);
      }
      const marks = [...(fig.foci ?? []), ...(fig.marks ?? []), ...(fig.centre ? [fig.centre] : []), ...(fig.vertex ? [fig.vertex] : [])];
      const xs = [...paths.flat().map((q) => q.x), ...marks.map((q) => q.x)];
      const ys = [...paths.flat().map((q) => q.y), ...marks.map((q) => q.y)];
      const { X, Y } = fitBox(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), ML, W - MR, MT, H - MB);
      for (const path of paths) {
        p.push(
          `<path d="${path.map((q, i) => `${i ? "L" : "M"}${X(q.x).toFixed(2)} ${Y(q.y).toFixed(2)}`).join(" ")}" ` +
          `fill="none" stroke="${BASE_EDGE}" stroke-width="1.6"/>`
        );
      }
      if (fig.centre) {
        p.push(`<circle cx="${X(fig.centre.x)}" cy="${Y(fig.centre.y)}" r="2.2" fill="${INK}"/>`);
      }
      if (fig.vertex) {
        p.push(`<circle cx="${X(fig.vertex.x)}" cy="${Y(fig.vertex.y)}" r="2.6" fill="${BASE_EDGE}"/>`);
      }
      for (const f of fig.foci ?? []) {
        const fx = X(f.x), fy = Y(f.y);
        p.push(`<path d="M${fx - 3.5} ${fy - 3.5} l7 7 M${fx - 3.5} ${fy + 3.5} l7 -7" stroke="${CUT_EDGE}" stroke-width="1.4"/>`);
      }
      for (const mk of fig.marks ?? []) {
        p.push(`<circle cx="${X(mk.x)}" cy="${Y(mk.y)}" r="2.6" fill="${ADD_EDGE}"/>`);
      }
      caption(
        `${fig.conic}${fig.foci?.length ? " — foci marked ×" : ""}` +
        (fig.conic === "hyperbola" ? " (both branches)" : "") +
        (fig.marks?.length ? " — the given points marked" : "")
      );
      break;
    }
    case "circle-feature": {
      const r = fig.r;
      if (!(r > 0)) return "";
      if (fig.feature === "tangent") {
        const d = fig.d ?? r;
        // Circle at the origin, external point on the +x axis.
        const alpha = Math.acos(Math.min(1, r / d));
        const t1 = { x: r * Math.cos(alpha), y: r * Math.sin(alpha) };
        const t2 = { x: t1.x, y: -t1.y };
        const pad = r * 0.25;
        const { X, Y, s } = fitBox(-r - pad, Math.max(d, r) + pad, -r - pad, r + pad, ML, W - MR, MT, H - MB);
        p.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="${r * s}" fill="none" stroke="${BASE_EDGE}" stroke-width="1.6"/>`);
        p.push(`<line x1="${X(d)}" y1="${Y(0)}" x2="${X(t1.x)}" y2="${Y(t1.y)}" stroke="${CUT_EDGE}" stroke-width="1.4"/>`);
        p.push(`<line x1="${X(d)}" y1="${Y(0)}" x2="${X(t2.x)}" y2="${Y(t2.y)}" stroke="${CUT_EDGE}" stroke-width="1.4"/>`);
        p.push(`<line x1="${X(0)}" y1="${Y(0)}" x2="${X(t1.x)}" y2="${Y(t1.y)}" stroke="${RULE}" stroke-width="1" stroke-dasharray="3 3"/>`);
        p.push(`<circle cx="${X(d)}" cy="${Y(0)}" r="2.6" fill="${INK}"/>`);
        p.push(`<circle cx="${X(t1.x)}" cy="${Y(t1.y)}" r="2.2" fill="${CUT_EDGE}"/>`);
        p.push(`<circle cx="${X(t2.x)}" cy="${Y(t2.y)}" r="2.2" fill="${CUT_EDGE}"/>`);
        caption(`r = ${round2(r)}, d = ${round2(d)} — the radius meets each tangent at a right angle`);
        break;
      }
      const angle = fig.angleDeg ?? 0;
      if (!(angle > 0)) return "";
      if (angle >= 360) {
        // A full turn: the sector IS the disc and the arc IS the circle — an
        // SVG arc command with coincident endpoints would draw nothing.
        const pad = r * 0.15;
        const { X, Y, s } = fitBox(-r - pad, r + pad, -r - pad, r + pad, ML, W - MR, MT, H - MB);
        p.push(
          `<circle cx="${X(0)}" cy="${Y(0)}" r="${r * s}" ` +
          `fill="${fig.feature === "sector" ? BASE_FILL : "none"}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`
        );
        p.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="2" fill="${INK}"/>`);
        caption(`${fig.feature}, r = ${round2(r)}, central angle 360° — the whole circle`);
        break;
      }
      const th = (angle * Math.PI) / 180;
      // The arc spans symmetric about the +x axis for a balanced figure.
      const a0 = -th / 2, a1 = th / 2;
      const P0 = { x: r * Math.cos(a0), y: r * Math.sin(a0) };
      const P1 = { x: r * Math.cos(a1), y: r * Math.sin(a1) };
      const pad = r * 0.15;
      const { X, Y, s } = fitBox(-r - pad, r + pad, -r - pad, r + pad, ML, W - MR, MT, H - MB);
      p.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="${r * s}" fill="none" stroke="${RULE}" stroke-width="1" stroke-dasharray="3 3"/>`);
      const large = angle > 180 ? 1 : 0;
      // SVG's y axis points down, so a counter-clockwise math sweep is sweep=0.
      const arcPath = `M${X(P0.x)} ${Y(P0.y)} A${r * s} ${r * s} 0 ${large} 0 ${X(P1.x)} ${Y(P1.y)}`;
      if (fig.feature === "sector") {
        p.push(`<path d="M${X(0)} ${Y(0)} L${X(P0.x)} ${Y(P0.y)} A${r * s} ${r * s} 0 ${large} 0 ${X(P1.x)} ${Y(P1.y)} Z" fill="${BASE_FILL}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`);
      } else if (fig.feature === "segment") {
        p.push(`<path d="${arcPath} Z" fill="${BASE_FILL}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`);
        p.push(`<line x1="${X(P0.x)}" y1="${Y(P0.y)}" x2="${X(P1.x)}" y2="${Y(P1.y)}" stroke="${BASE_EDGE}" stroke-width="1.6"/>`);
      } else {
        p.push(`<path d="${arcPath}" fill="none" stroke="${BASE_EDGE}" stroke-width="2.4"/>`);
        p.push(`<line x1="${X(P0.x)}" y1="${Y(P0.y)}" x2="${X(P1.x)}" y2="${Y(P1.y)}" stroke="${CUT_EDGE}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
      }
      p.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="2" fill="${INK}"/>`);
      caption(`${fig.feature}, r = ${round2(r)}, central angle ${round2(angle)}°${fig.feature === "arc" ? " — chord dashed" : ""}`);
      break;
    }
  }
  p.push("</svg>");
  return p.join("");
}

/** Alt text for a plain-geometry figure — written by the kind that drew it. */
export function geometryFigureAlt(fig: GeoFigure, title: string): string {
  switch (fig.kind) {
    case "triangle":
      return `${title} — the solved triangle${fig.triangles.length > 1 ? "s (both SSA solutions)" : ""}, drawn to scale with sides and angles labelled.`;
    case "points":
      return fig.probe
        ? `${title} — the polygon with the query point marked ${fig.probe.verdict}.`
        : fig.closed
          ? `${title} — the polygon drawn to scale${fig.centroid ? ", centroid marked" : ""}${fig.hull ? ", convex hull dashed" : ""}.`
          : `${title} — the point before and after the transformation.`;
    case "conic":
      return `${title} — the ${fig.conic} drawn to scale${fig.foci?.length ? " with its foci marked" : ""}.`;
    case "circle-feature":
      return `${title} — the ${fig.feature} drawn to scale on its circle.`;
  }
}

function emptyChart(W: number, H: number, message: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
    `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${RULE}">${esc(message)}</text>` +
    "</svg>"
  );
}
