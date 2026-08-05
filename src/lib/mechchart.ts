// Mohr's circle and the Goodman diagram — the two constructions this bench
// already computes and never drew.
//
// BOTH NEED AN EQUAL ASPECT RATIO, which is why they are here rather than going
// through `buildPlotSvg`. That plotter scales x and y independently to fill the
// frame, which is right for a time series and wrong for these two: a Mohr's
// CIRCLE drawn as an ellipse is not a Mohr's circle, and on a Goodman diagram
// the 45° line where sigma_a equals sigma_m has to look like 45°, because
// reading the margin off the picture is the whole reason the picture exists.
//
// Colours are literal hex, never a CSS variable or the inherited-colour
// keyword: this artwork goes into a Word document as line art and must not
// follow the pane's theme. `insertedFiguresIgnoreTheme.test.ts` scans the
// SOURCE for that, so this comment cannot name the keyword either.

import { xyToUv, Chromaticity } from "./colourspace";

const INK = "#111111";
const RULE = "#888888";
const PAPER = "#ffffff";
const CIRCLE = "#2563eb";
const POINT = "#b91c1c";
const FAINT = "#cccccc";

export const MOHR_CHART_SIZE = { w: 380, h: 300 };
export const GOODMAN_CHART_SIZE = { w: 380, h: 300 };

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const n1 = (v: number): string => (Math.abs(v) < 1e-9 ? "0" : v.toFixed(1));

/**
 * A tick step that lands on 1, 2 or 5 times a power of ten.
 *
 * IT MUST RETURN A FINITE, STRICTLY POSITIVE NUMBER, and that is a
 * postcondition rather than a hope. The first version could return `Infinity`
 * (from an infinite span) or exactly `0` (from a subnormal one, where
 * `10^floor(log10 x)` underflows), and every caller is a
 * `for (t = lo; t <= hi; t += step)` loop. `t += Infinity` sticks; `t += 0`
 * never advances. Either way the loop does not terminate, and in a Word task
 * pane a loop that does not terminate is a FROZEN WORD, not an error — one of
 * them was reproduced here as a 4 GB heap exhaustion.
 */
export function niceStep(span: number, target: number): number {
  if (!Number.isFinite(span) || !Number.isFinite(target) || span <= 0 || target <= 0) return 1;
  const raw = span / target;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  if (!Number.isFinite(mag) || mag <= 0) return 1;
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = mult * mag;
  return Number.isFinite(step) && step > 0 ? step : 1;
}

/**
 * The tick positions for one axis, as a bounded ARRAY rather than an open loop.
 *
 * `Number.isFinite` on the inputs is not a bound — the repo has learned that
 * before. Even with a sane step, `lo` and `hi` far apart, or a `lo` so large
 * that `lo + step === lo` in floating point, can spin forever. This caps the
 * count outright, so no caller can hang however it is fed.
 */
export function ticks(lo: number, hi: number, step: number, cap = 200): number[] {
  const out: number[] = [];
  if (![lo, hi, step].every(Number.isFinite) || step <= 0 || hi < lo) return out;
  for (let i = 0; i <= cap; i++) {
    const t = lo + i * step;
    if (t > hi + step * 1e-9) break;
    out.push(t);
  }
  return out;
}

/**
 * A text label ON AN OPAQUE BACKING, so nothing drawn under it shows through.
 *
 * SVG paints in document order, so an annotation added after the curves is
 * already on top — but "on top" of a stroke is not the same as legible. A
 * 1.6 px line running through the middle of a 8 px label strikes it out, and
 * that is the single most common way one of these figures becomes unreadable.
 * A backing rectangle in paper colour is what a chart library does and what
 * this now does.
 *
 * `anchor` follows the SVG convention, and the backing follows the anchor.
 */
function labelText(
  x: number,
  y: number,
  text: string,
  opts: { size?: number; fill?: string; anchor?: "start" | "middle" | "end" } = {},
): string {
  const size = opts.size ?? 8;
  const fill = opts.fill ?? INK;
  const anchor = opts.anchor ?? "start";
  // A conservative advance for a sans-serif face; over-estimating only pads.
  const w = text.length * size * 0.56 + 3;
  const h = size * 1.05;
  const bx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x - 1.5;
  return (
    `<rect x="${bx.toFixed(1)}" y="${(y - size * 0.82).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${PAPER}"/>` +
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${esc(text)}</text>`
  );
}

/** A placeholder that SAYS why it is empty, instead of a blank white box. */
function emptyChart(W: number, H: number, message: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
    `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${RULE}">${esc(message)}</text>` +
    "</svg>"
  );
}

export interface MohrInput {
  sigmaX: number;
  sigmaY: number;
  tauXY: number;
  /** Principal stresses, in the caller's own convention. */
  sigma1: number;
  sigma2: number;
  centre: number;
  radius: number;
  /** Units for the axis labels, e.g. "MPa". */
  unit?: string;
}

/**
 * Mohr's circle for a plane stress state.
 *
 * The construction, and what makes it worth drawing: the two principal stresses
 * are where the circle crosses the sigma axis, the maximum in-plane shear is
 * the RADIUS, and the pole of the applied state sits at (sigma_x, tau_xy) with
 * its conjugate diametrically opposite at (sigma_y, -tau_xy). Rotating the
 * element by an angle theta moves you 2*theta around the circle — the factor of
 * two that the picture makes obvious and the algebra does not.
 */
export function mohrCircleSvg(inp: MohrInput): string {
  const { w: W, h: H } = MOHR_CHART_SIZE;
  const ML = 52;
  const MR = 16;
  const MT = 24;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const unit = inp.unit ?? "";

  const { centre: c, radius: R } = inp;
  // EVERY coordinate is checked, not just the circle's own two. A finite centre
  // and radius with a non-finite sigma_x still put NaN into the marker's x
  // attribute, and an SVG carrying NaN goes into the document looking like
  // artwork while rendering as nothing.
  const allFinite = [c, R, inp.sigmaX, inp.sigmaY, inp.tauXY, inp.sigma1, inp.sigma2].every((v) =>
    Number.isFinite(v),
  );
  if (!allFinite || R < 0) {
    return emptyChart(W, H, "Mohr's circle needs a finite stress state");
  }

  // EQUAL SCALE ON BOTH AXES. The domain is squared off around the circle and
  // then the tighter of the two pixel scales is used for both, so the circle is
  // a circle whatever the frame's shape.
  const pad = R > 0 ? R * 0.35 : 1;
  const xLo = c - R - pad;
  const xHi = c + R + pad;
  const yLo = -R - pad;
  const yHi = R + pad;
  const scale = Math.min(pw / (xHi - xLo), ph / (yHi - yLo));
  // Centre the drawing in whatever room is left over on the looser axis.
  const ox = ML + (pw - (xHi - xLo) * scale) / 2;
  const oy = MT + (ph - (yHi - yLo) * scale) / 2;
  const X = (v: number): number => ox + (v - xLo) * scale;
  // Shear increases UPWARDS on the page, so the pixel axis is inverted.
  const Y = (v: number): number => oy + (yHi - v) * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(
    `<text x="${W / 2}" y="14" text-anchor="middle" font-size="11" fill="${INK}">Mohr's circle</text>`,
  );

  // Axes through the origin of stress space, drawn faint where they are only
  // reference lines.
  const y0 = Y(0);
  p.push(`<line x1="${ML}" y1="${y0.toFixed(1)}" x2="${W - MR}" y2="${y0.toFixed(1)}" stroke="${RULE}" stroke-width="1"/>`);
  if (X(0) >= ML && X(0) <= W - MR) {
    p.push(`<line x1="${X(0).toFixed(1)}" y1="${MT}" x2="${X(0).toFixed(1)}" y2="${H - MB}" stroke="${FAINT}" stroke-width="1"/>`);
  }

  // Ticks on sigma. The MARKS go here; the LABELS are held back and emitted
  // last, because the line joining the applied state to its conjugate sweeps
  // well below the axis and would otherwise strike one of them out. A backing
  // rectangle only hides what was painted before it.
  const step = niceStep(xHi - xLo, 5);
  const tickLabels: string[] = [];
  for (const t of ticks(Math.ceil(xLo / step) * step, xHi, step)) {
    const x = X(t);
    if (x < ML - 0.5 || x > W - MR + 0.5) continue;
    p.push(`<line x1="${x.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y0 + 4).toFixed(1)}" stroke="${RULE}"/>`);
    tickLabels.push(labelText(x, y0 + 14, n1(t), { anchor: "middle", size: 9 }));
  }

  // The circle itself.
  p.push(
    `<circle cx="${X(c).toFixed(1)}" cy="${Y(0).toFixed(1)}" r="${(R * scale).toFixed(1)}" fill="none" stroke="${CIRCLE}" stroke-width="1.6"/>`,
  );

  // The applied state and its conjugate, joined through the centre. That line
  // IS the element's current orientation; the sigma axis is the principal one,
  // and the angle between them is 2*theta_p.
  const ax = X(inp.sigmaX);
  const ay = Y(inp.tauXY);
  const bx = X(inp.sigmaY);
  const by = Y(-inp.tauXY);
  p.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${POINT}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
  for (const [px, py, lbl] of [
    [ax, ay, "(σx, τxy)"],
    [bx, by, "(σy, −τxy)"],
  ] as [number, number, string][]) {
    p.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${POINT}"/>`);
    p.push(labelText((px + 5), (py - 5), lbl, { fill: POINT, size: 8 }));
  }

  // Principal stresses, where the circle meets the sigma axis.
  for (const [s, label] of [
    [inp.sigma1, "σ₁"],
    [inp.sigma2, "σ₂"],
  ] as [number, string][]) {
    const x = X(s);
    p.push(`<circle cx="${x.toFixed(1)}" cy="${y0.toFixed(1)}" r="2.6" fill="${CIRCLE}"/>`);
    p.push(`<text x="${x.toFixed(1)}" y="${(y0 - 7).toFixed(1)}" text-anchor="middle" fill="${CIRCLE}" font-size="9">${esc(label)}</text>`);
  }

  // The radius IS the maximum in-plane shear — drawn, because that equivalence
  // is the single most useful thing the picture says.
  const topY = Y(R);
  p.push(`<line x1="${X(c).toFixed(1)}" y1="${y0.toFixed(1)}" x2="${X(c).toFixed(1)}" y2="${topY.toFixed(1)}" stroke="${CIRCLE}" stroke-width="1" stroke-dasharray="2 2"/>`);
  p.push(labelText(X(c) + 4, (y0 + topY) / 2, "τmax = R = " + n1(R), { fill: CIRCLE, size: 8 }));

  p.push(...tickLabels);
  p.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="${INK}">σ${unit ? " (" + esc(unit) + ")" : ""}</text>`);
  p.push(`<text x="12" y="${MT + ph / 2}" text-anchor="middle" fill="${INK}" transform="rotate(-90 12 ${MT + ph / 2})">τ${unit ? " (" + esc(unit) + ")" : ""}</text>`);
  p.push("</g></svg>");
  return p.join("");
}

export interface GoodmanCriterionLine {
  /** Display name, e.g. "Modified Goodman". */
  name: string;
  /** Stroke colour. */
  colour: string;
  /**
   * The locus as (sigma_m, sigma_a) pairs from the sigma_a axis rightwards.
   * Drawn as a polyline, so a two-point list gives a straight line and a
   * sampled list gives a curve.
   */
  points: { m: number; a: number }[];
}

export interface GoodmanInput {
  /** The operating point the FATIGUE criteria see. */
  sigmaM: number;
  sigmaA: number;
  /**
   * The mean stress the YIELD check sees, when it differs.
   *
   * It differs for a compressive mean: the fatigue criteria clamp it to zero,
   * because compression closes cracks and helps, while the Langer yield line
   * uses its MAGNITUDE, because a large compressive mean yields the part just
   * as readily as a tensile one. Drawing one point against both families made
   * the figure contradict the very factor of safety printed above it — a point
   * plotted at m = 0 looked comfortably inside a Langer line the text had
   * already reported as failing.
   */
  yieldSigmaM?: number;
  lines: GoodmanCriterionLine[];
  /** Axis limits; computed from the lines when omitted. */
  sutMPa?: number;
  seMPa?: number;
  unit?: string;
}

/**
 * The Goodman diagram: every mean-stress criterion on one pair of axes, with
 * the operating point on it.
 *
 * THE WHOLE REASON TO SHOW FOUR CRITERIA IS THAT THEY DISAGREE, and the
 * disagreement is a picture — four loci and one point. A table of four factors
 * of safety tells you the numbers differ; the diagram tells you by how much and
 * in which direction, and whether the point sits in the region where the choice
 * of criterion actually decides the answer.
 *
 * The Langer yield line is expected to be one of the loci passed in, because a
 * point can sit safely under Goodman and still yield on the first cycle.
 */
export function goodmanDiagramSvg(inp: GoodmanInput): string {
  const { w: W, h: H } = GOODMAN_CHART_SIZE;
  const ML = 52;
  const MR = 96; // room for the legend, measured against its longest entry
  const MT = 24;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const unit = inp.unit ?? "MPa";

  const xs: number[] = [inp.sigmaM, 0];
  const ys: number[] = [inp.sigmaA, 0];
  for (const l of inp.lines) for (const pt of l.points) { xs.push(pt.m); ys.push(pt.a); }
  if (inp.yieldSigmaM !== undefined) xs.push(inp.yieldSigmaM);
  if (inp.sutMPa) xs.push(inp.sutMPa);
  if (inp.seMPa) ys.push(inp.seMPa);
  const finiteX = xs.filter(Number.isFinite);
  const finiteY = ys.filter(Number.isFinite);
  if (!finiteX.length || !finiteY.length) {
    return emptyChart(W, H, "Nothing to plot");
  }
  const xHi = Math.max(...finiteX) * 1.08 || 1;
  const yHi = Math.max(...finiteY) * 1.12 || 1;
  // Equal scale, so the 45-degree line looks like 45 degrees.
  const scale = Math.min(pw / xHi, ph / yHi);
  const X = (v: number): number => ML + v * scale;
  const Y = (v: number): number => MT + ph - v * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="14" text-anchor="middle" font-size="11">Mean-stress (Goodman) diagram</text>`);

  // Axes.
  p.push(`<line x1="${ML}" y1="${MT + ph}" x2="${(ML + pw).toFixed(1)}" y2="${MT + ph}" stroke="${RULE}"/>`);
  p.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}"/>`);

  const sx = niceStep(xHi, 4);
  for (const t of ticks(0, xHi, sx)) {
    const x = X(t);
    if (x > ML + pw + 0.5) break;
    p.push(`<line x1="${x.toFixed(1)}" y1="${MT + ph}" x2="${x.toFixed(1)}" y2="${MT + ph + 4}" stroke="${RULE}"/>`);
    p.push(`<text x="${x.toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle">${esc(n1(t))}</text>`);
  }
  const sy = niceStep(yHi, 4);
  for (const t of ticks(0, yHi, sy)) {
    const y = Y(t);
    if (y < MT - 0.5) break;
    p.push(`<line x1="${ML - 4}" y1="${y.toFixed(1)}" x2="${ML}" y2="${y.toFixed(1)}" stroke="${RULE}"/>`);
    p.push(`<text x="${ML - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${esc(n1(t))}</text>`);
  }

  // The criterion loci.
  for (const l of inp.lines) {
    const pts = l.points
      .filter((q) => Number.isFinite(q.m) && Number.isFinite(q.a))
      .map((q) => `${X(q.m).toFixed(1)},${Y(q.a).toFixed(1)}`);
    if (pts.length < 2) continue;
    p.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${l.colour}" stroke-width="1.5"/>`);
  }

  // The operating point, and the load line from the origin through it. The load
  // line matters: a factor of safety on this diagram is measured ALONG it, not
  // vertically, because increasing the load raises mean and alternating stress
  // together.
  //
  // Drawn only when the point is a point. A non-finite operating stress used to
  // put NaN into three separate coordinate attributes, and an SVG carrying NaN
  // is inserted into the document looking like artwork and renders as nothing.
  if (Number.isFinite(inp.sigmaM) && Number.isFinite(inp.sigmaA)) {
    const px = X(inp.sigmaM);
    const py = Y(inp.sigmaA);
    p.push(`<line x1="${X(0).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${RULE}" stroke-width="1" stroke-dasharray="3 3"/>`);
    p.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.4" fill="${POINT}"/>`);
    const twoPoints =
      inp.yieldSigmaM !== undefined &&
      Number.isFinite(inp.yieldSigmaM) &&
      Math.abs(inp.yieldSigmaM - inp.sigmaM) > 1e-9;
    p.push(labelText(px + 6, py - 5, twoPoints ? "fatigue point" : "operating point", { fill: POINT, size: 8 }));
    // The yield check sees a different mean when the applied one is
    // compressive, so it gets its own marker rather than being read off the
    // fatigue one — which is how the picture came to contradict the text.
    if (twoPoints) {
      const qx = X(inp.yieldSigmaM as number);
      const qy = Y(inp.sigmaA);
      p.push(`<circle cx="${qx.toFixed(1)}" cy="${qy.toFixed(1)}" r="3.4" fill="none" stroke="${POINT}" stroke-width="1.6"/>`);
      p.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${qx.toFixed(1)}" y2="${qy.toFixed(1)}" stroke="${POINT}" stroke-width="0.9" stroke-dasharray="2 2"/>`);
      p.push(labelText(qx + 6, qy + 10, "yield point (|σm|)", { fill: POINT, size: 8 }));
    }
  }

  // Legend.
  let ly = MT + 4;
  for (const l of inp.lines) {
    p.push(`<line x1="${(ML + pw + 8).toFixed(1)}" y1="${ly}" x2="${(ML + pw + 22).toFixed(1)}" y2="${ly}" stroke="${l.colour}" stroke-width="1.5"/>`);
    p.push(`<text x="${(ML + pw + 25).toFixed(1)}" y="${ly + 3}" font-size="7.5">${esc(l.name)}</text>`);
    ly += 12;
  }

  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">σm (${esc(unit)})</text>`);
  p.push(`<text x="12" y="${MT + ph / 2}" text-anchor="middle" transform="rotate(-90 12 ${MT + ph / 2})">σa (${esc(unit)})</text>`);
  p.push("</g></svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------
// The rest of Structural & solids, so every tool in the discipline draws.
// ---------------------------------------------------------------------------

export const SECTION_CHART_SIZE = { w: 380, h: 260 };
export const COLUMN_CHART_SIZE = { w: 380, h: 260 };
export const TRUSS_CHART_SIZE = { w: 400, h: 280 };
export const TORSION_CHART_SIZE = { w: 380, h: 240 };

/** A rectangle of the section outline, centred on the vertical centreline. */
export interface SectionStrip {
  b: number;
  h: number;
  /** Centre height above the datum. */
  yc: number;
  /** +1 solid, -1 void. */
  sign: 1 | -1;
}

export interface SectionShapeInput {
  name: string;
  strips: SectionStrip[];
  /** Overall depth, for the frame. */
  depth: number;
  /** Centroid height — where the neutral axis is drawn. */
  yBar: number;
  /** A round outline instead of strips: outer diameter and optional bore. */
  circle?: { d: number; bore?: number };
  unit: string;
}

/**
 * The cross-section itself, drawn to scale with its neutral axis.
 *
 * WHERE THE NEUTRAL AXIS SITS IS THE POINT for an unsymmetric section. A tee's
 * centroid is nowhere near mid-depth, which is exactly why its two section
 * moduli differ and why the smaller one governs — a sentence in the text, and
 * obvious in the picture.
 */
export function sectionShapeSvg(inp: SectionShapeInput): string {
  const { w: W, h: H } = SECTION_CHART_SIZE;
  const ML = 46;
  const MR = 92;
  const MT = 24;
  const MB = 26;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  const widest = inp.circle
    ? inp.circle.d
    : Math.max(...inp.strips.filter((s) => s.sign > 0).map((s) => s.b), 0);
  const depth = inp.depth;
  if (![widest, depth, inp.yBar].every(Number.isFinite) || widest <= 0 || depth <= 0) {
    return emptyChart(W, H, "The section dimensions do not define a shape to draw");
  }
  // EQUAL SCALE. A section drawn with stretched axes is a different section.
  const scale = Math.min(pw / widest, ph / depth);
  const cx = ML + pw / 2;
  const yBase = MT + ph - (ph - depth * scale) / 2;
  const X = (x: number): number => cx + x * scale;
  const Y = (y: number): number => yBase - y * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${W / 2}" y="14" text-anchor="middle" font-size="11">${esc(inp.name)}</text>`);

  if (inp.circle) {
    const r = (inp.circle.d / 2) * scale;
    p.push(`<circle cx="${cx.toFixed(1)}" cy="${Y(depth / 2).toFixed(1)}" r="${r.toFixed(1)}" fill="#dbeafe" stroke="${INK}" stroke-width="1.2"/>`);
    if (inp.circle.bore && inp.circle.bore > 0) {
      p.push(`<circle cx="${cx.toFixed(1)}" cy="${Y(depth / 2).toFixed(1)}" r="${((inp.circle.bore / 2) * scale).toFixed(1)}" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>`);
    }
  } else {
    for (const s of inp.strips) {
      if (![s.b, s.h, s.yc].every(Number.isFinite) || s.b <= 0 || s.h <= 0) continue;
      p.push(
        `<rect x="${X(-s.b / 2).toFixed(1)}" y="${Y(s.yc + s.h / 2).toFixed(1)}" width="${(s.b * scale).toFixed(1)}" height="${(s.h * scale).toFixed(1)}" fill="${s.sign > 0 ? "#dbeafe" : PAPER}" stroke="${INK}" stroke-width="1.2"/>`,
      );
    }
  }

  const yNA = Y(inp.yBar);
  p.push(`<line x1="${(ML - 8).toFixed(1)}" y1="${yNA.toFixed(1)}" x2="${(ML + pw + 8).toFixed(1)}" y2="${yNA.toFixed(1)}" stroke="${POINT}" stroke-width="1.2" stroke-dasharray="6 3"/>`);
  p.push(`<text x="${(ML + pw + 12).toFixed(1)}" y="${(yNA + 3).toFixed(1)}" fill="${POINT}" font-size="8">neutral axis</text>`);
  p.push(`<text x="${(ML + pw + 12).toFixed(1)}" y="${(Y(depth) + 11).toFixed(1)}" font-size="7.5">c_top = ${esc(n1(depth - inp.yBar))} ${esc(inp.unit)}</text>`);
  p.push(`<text x="${(ML + pw + 12).toFixed(1)}" y="${(Y(0) - 4).toFixed(1)}" font-size="7.5">c_bot = ${esc(n1(inp.yBar))} ${esc(inp.unit)}</text>`);
  p.push(`<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="8">to scale, dimensions in ${esc(inp.unit)}</text>`);
  p.push("</g></svg>");
  return p.join("");
}

export interface ColumnCurveInput {
  /** Young's modulus, Pa. */
  E: number;
  /** Yield strength, Pa; null draws Euler alone. */
  Fy: number | null;
  slenderness: number;
  /** Governing critical stress, Pa. */
  sigmaCritical: number;
  transition: number | null;
}

/**
 * The Euler hyperbola and the Johnson parabola against slenderness, with this
 * column on them.
 *
 * WHY THE JOHNSON PARABOLA EXISTS is impossible to miss once drawn: the Euler
 * curve runs off to infinity as the column gets stumpy, predicting critical
 * stresses far above yield for a member that would simply squash. The parabola
 * caps it, and the transition slenderness is where the two meet.
 */
export function columnCurveSvg(inp: ColumnCurveInput): string {
  const { w: W, h: H } = COLUMN_CHART_SIZE;
  const ML = 54;
  const MR = 16;
  const MT = 24;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  const { E, Fy } = inp;
  if (![E, inp.slenderness, inp.sigmaCritical].every(Number.isFinite) || E <= 0 || inp.slenderness <= 0) {
    return emptyChart(W, H, "The column inputs do not define a curve to draw");
  }
  // THE TRANSITION SLENDERNESS FEEDS xHi AND WAS NOT CHECKED. A vanishing yield
  // strength sends it to Infinity — `analyzeColumn` returns that quite happily
  // — and an infinite axis limit then produced an infinite tick step and a loop
  // that exhausted four gigabytes. Treated as absent rather than trusted.
  const transition =
    inp.transition !== null && Number.isFinite(inp.transition) && inp.transition > 0
      ? inp.transition
      : null;
  const xHi = Math.max(inp.slenderness * 1.6, (transition ?? 0) * 1.8, 60);
  const yHi = (Fy && Fy > 0 ? Fy : inp.sigmaCritical) * 1.35;
  if (!(yHi > 0) || !Number.isFinite(yHi)) {
    return emptyChart(W, H, "The column inputs do not define a curve to draw");
  }
  const X = (v: number): number => ML + (v / xHi) * pw;
  const Y = (v: number): number => MT + ph - (Math.min(v, yHi) / yHi) * ph;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="14" text-anchor="middle" font-size="11">Buckling curves</text>`);
  p.push(`<line x1="${ML}" y1="${MT + ph}" x2="${(ML + pw).toFixed(1)}" y2="${MT + ph}" stroke="${RULE}"/>`);
  p.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}"/>`);

  const sx = niceStep(xHi, 4);
  for (const t of ticks(0, xHi, sx)) {
    if (X(t) > ML + pw + 0.5) break;
    p.push(`<line x1="${X(t).toFixed(1)}" y1="${MT + ph}" x2="${X(t).toFixed(1)}" y2="${MT + ph + 4}" stroke="${RULE}"/>`);
    p.push(`<text x="${X(t).toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle">${esc(n1(t))}</text>`);
  }
  const syStep = niceStep(yHi / 1e6, 4) * 1e6;
  for (const t of ticks(0, yHi, syStep)) {
    if (Y(t) < MT - 0.5) break;
    p.push(`<line x1="${ML - 4}" y1="${Y(t).toFixed(1)}" x2="${ML}" y2="${Y(t).toFixed(1)}" stroke="${RULE}"/>`);
    p.push(`<text x="${ML - 6}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end">${esc(n1(t / 1e6))}</text>`);
  }

  // Euler, sigma = pi^2 E / lambda^2, sampled only where it is on scale —
  // near zero slenderness it is unboundedly large, which is the whole problem
  // the Johnson parabola exists to fix.
  const euler: string[] = [];
  for (let i = 1; i <= 240; i++) {
    const lam = (xHi * i) / 240;
    const sg = (Math.PI * Math.PI * E) / (lam * lam);
    if (!Number.isFinite(sg) || sg > yHi) continue;
    euler.push(`${X(lam).toFixed(1)},${Y(sg).toFixed(1)}`);
  }
  if (euler.length > 1) p.push(`<polyline points="${euler.join(" ")}" fill="none" stroke="${CIRCLE}" stroke-width="1.5"/>`);

  if (Fy && Fy > 0 && transition !== null) {
    const john: string[] = [];
    for (let i = 0; i <= 140; i++) {
      const lam = (transition * i) / 140;
      const sg = Fy - ((Fy * lam) / (2 * Math.PI)) ** 2 / E;
      if (!Number.isFinite(sg) || sg < 0) continue;
      john.push(`${X(lam).toFixed(1)},${Y(sg).toFixed(1)}`);
    }
    if (john.length > 1) p.push(`<polyline points="${john.join(" ")}" fill="none" stroke="#059669" stroke-width="1.5"/>`);
    p.push(`<line x1="${ML}" y1="${Y(Fy).toFixed(1)}" x2="${(ML + pw).toFixed(1)}" y2="${Y(Fy).toFixed(1)}" stroke="${FAINT}" stroke-dasharray="3 3"/>`);
    p.push(`<text x="${(ML + pw - 2).toFixed(1)}" y="${(Y(Fy) - 3).toFixed(1)}" text-anchor="end" fill="${RULE}" font-size="7.5">yield</text>`);
    p.push(`<line x1="${X(transition).toFixed(1)}" y1="${MT}" x2="${X(transition).toFixed(1)}" y2="${MT + ph}" stroke="${FAINT}" stroke-dasharray="2 3"/>`);
    p.push(`<text x="${(X(transition) + 3).toFixed(1)}" y="${MT + 10}" fill="${RULE}" font-size="7.5">transition</text>`);
  }

  p.push(`<circle cx="${X(inp.slenderness).toFixed(1)}" cy="${Y(inp.sigmaCritical).toFixed(1)}" r="3.4" fill="${POINT}"/>`);
  p.push(labelText(X(inp.slenderness) + 6, Y(inp.sigmaCritical) - 5, "this column", { fill: POINT, size: 8 }));
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">slenderness Le/r</text>`);
  p.push(`<text x="12" y="${MT + ph / 2}" text-anchor="middle" transform="rotate(-90 12 ${MT + ph / 2})">critical stress (MPa)</text>`);
  p.push("</g></svg>");
  return p.join("");
}

export interface TrussDrawJoint { name: string; x: number; y: number }
export interface TrussDrawMember { a: string; b: string; force: number }

/**
 * The truss, with every member coloured by what it carries.
 *
 * ZERO-FORCE MEMBERS ARE THE POINT. They look structurally essential on a
 * sketch and carry nothing, and a list of member names does not make that
 * visible the way a dashed, greyed member in the real geometry does.
 */
export function trussSvg(joints: TrussDrawJoint[], members: TrussDrawMember[]): string {
  const { w: W, h: H } = TRUSS_CHART_SIZE;
  const ML = 30;
  const MR = 98;
  const MT = 24;
  const MB = 26;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const good = joints.filter((j) => Number.isFinite(j.x) && Number.isFinite(j.y));
  if (good.length < 2) {
    return emptyChart(W, H, "A truss needs at least two joints with finite coordinates");
  }
  const xs = good.map((j) => j.x);
  const ys = good.map((j) => j.y);
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  // EQUAL SCALE: stretched axes give the wrong member angles, and the angles
  // are exactly where the forces come from.
  const raw = Math.min(pw / Math.max(xHi - xLo, 1e-9), ph / Math.max(yHi - yLo, 1e-9));
  const s = Number.isFinite(raw) && raw > 0 ? raw : 1;
  const ox = ML + (pw - (xHi - xLo) * s) / 2;
  const oy = MT + ph - (ph - (yHi - yLo) * s) / 2;
  const X = (x: number): number => ox + (x - xLo) * s;
  const Y = (y: number): number => oy - (y - yLo) * s;

  const forces = members.map((m) => Math.abs(m.force)).filter(Number.isFinite);
  const peak = forces.length ? Math.max(...forces, 1e-12) : 1;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="14" text-anchor="middle" font-size="11">Member forces</text>`);

  const at = (name: string): TrussDrawJoint | undefined => good.find((j) => j.name === name);
  for (const m of members) {
    const a = at(m.a);
    const b = at(m.b);
    if (!a || !b || !Number.isFinite(m.force)) continue;
    const zero = Math.abs(m.force) < 1e-9;
    const colour = zero ? FAINT : m.force > 0 ? "#b91c1c" : "#2563eb";
    const wdt = zero ? 1 : 1 + 2.4 * (Math.abs(m.force) / peak);
    p.push(`<line x1="${X(a.x).toFixed(1)}" y1="${Y(a.y).toFixed(1)}" x2="${X(b.x).toFixed(1)}" y2="${Y(b.y).toFixed(1)}" stroke="${colour}" stroke-width="${wdt.toFixed(2)}"${zero ? ' stroke-dasharray="4 3"' : ""}/>`);
  }
  for (const j of good) {
    p.push(`<circle cx="${X(j.x).toFixed(1)}" cy="${Y(j.y).toFixed(1)}" r="3" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>`);
    p.push(labelText(X(j.x) + 5, Y(j.y) - 5, j.name, { size: 7.5 }));
  }

  let ly = MT + 6;
  for (const [c, label] of [["#b91c1c", "tension"], ["#2563eb", "compression"], [FAINT, "zero-force"]] as [string, string][]) {
    p.push(`<line x1="${(ML + pw + 10).toFixed(1)}" y1="${ly}" x2="${(ML + pw + 26).toFixed(1)}" y2="${ly}" stroke="${c}" stroke-width="2"/>`);
    p.push(`<text x="${(ML + pw + 29).toFixed(1)}" y="${ly + 3}" font-size="7.5">${esc(label)}</text>`);
    ly += 13;
  }
  p.push(labelText(ML + pw + 10, ly + 6, "width follows force", { size: 7 }));
  p.push("</g></svg>");
  return p.join("");
}

/**
 * Shear stress across a shaft's radius.
 *
 * TORSIONAL SHEAR IS ZERO AT THE AXIS and greatest at the surface, growing
 * linearly with radius — which is the entire argument for a hollow shaft: the
 * material near the centre carries almost nothing while weighing the same.
 */
export function torsionProfileSvg(
  outerD: number,
  boreD: number,
  tauMax: number,
  unit = "MPa",
  radiusUnit = "m",
): string {
  const { w: W, h: H } = TORSION_CHART_SIZE;
  const ML = 54;
  const MR = 20;
  const MT = 24;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  if (![outerD, boreD, tauMax].every(Number.isFinite) || outerD <= 0 || tauMax <= 0 || boreD < 0) {
    return emptyChart(W, H, "There is no shear to plot for these inputs");
  }
  const ro = outerD / 2;
  const ri = Math.min(Math.max(0, boreD / 2), ro);
  const yTop = tauMax * 1.15;
  const X = (rr: number): number => ML + (rr / ro) * pw;
  const Y = (t: number): number => MT + ph - (t / yTop) * ph;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="14" text-anchor="middle" font-size="11">Shear stress across the radius</text>`);
  p.push(`<line x1="${ML}" y1="${MT + ph}" x2="${(ML + pw).toFixed(1)}" y2="${MT + ph}" stroke="${RULE}"/>`);
  p.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}"/>`);

  if (ri > 0) {
    p.push(`<rect x="${ML}" y="${MT}" width="${(X(ri) - ML).toFixed(1)}" height="${ph}" fill="#f3f4f6"/>`);
    p.push(`<text x="${((ML + X(ri)) / 2).toFixed(1)}" y="${MT + 12}" text-anchor="middle" fill="${RULE}" font-size="7.5">bore</text>`);
  }
  p.push(`<polyline points="${X(ri).toFixed(1)},${Y((tauMax * ri) / ro).toFixed(1)} ${X(ro).toFixed(1)},${Y(tauMax).toFixed(1)}" fill="none" stroke="${CIRCLE}" stroke-width="1.8"/>`);
  p.push(`<circle cx="${X(ro).toFixed(1)}" cy="${Y(tauMax).toFixed(1)}" r="3.2" fill="${POINT}"/>`);
  p.push(labelText(X(ro) - 4, Y(tauMax) - 6, "τmax = " + n1(tauMax), { anchor: "end", fill: POINT, size: 8 }));
  if (ri === 0) p.push(labelText(ML + 4, MT + ph - 6, "zero at the axis", { fill: RULE, size: 7.5 }));

  const st = niceStep(yTop, 4);
  for (const t of ticks(0, yTop, st)) {
    if (Y(t) < MT - 0.5) break;
    p.push(`<line x1="${ML - 4}" y1="${Y(t).toFixed(1)}" x2="${ML}" y2="${Y(t).toFixed(1)}" stroke="${RULE}"/>`);
    p.push(`<text x="${ML - 6}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end">${esc(n1(t))}</text>`);
  }
  p.push(`<text x="${ML}" y="${MT + ph + 14}" text-anchor="middle">0</text>`);
  p.push(`<text x="${X(ro).toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle">${esc(n1(ro))}</text>`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">radius (${esc(radiusUnit)})</text>`);
  p.push(`<text x="12" y="${MT + ph / 2}" text-anchor="middle" transform="rotate(-90 12 ${MT + ph / 2})">τ (${esc(unit)})</text>`);
  p.push("</g></svg>");
  return p.join("");
}

export const POLE_ZERO_SIZE = { w: 340, h: 300 };

export interface PoleZeroPoint {
  re: number;
  im: number;
}

/**
 * The pole-zero map on the s-plane: poles as ×, zeros as ○, the right half
 * plane shaded because THAT is what the map exists to show — a mark in the
 * shading is the instability the verdict names.
 *
 * EQUAL SCALE ON BOTH AXES. Conjugate pairs must mirror visibly, and the
 * damping ratio of a pole pair is the cosine of the angle it subtends at the
 * origin — an angle that lies about its cosine on unequal axes.
 */
export function poleZeroSvg(poles: PoleZeroPoint[], zeros: PoleZeroPoint[]): string {
  const { w: W, h: H } = POLE_ZERO_SIZE;
  const all = [...poles, ...zeros];
  if (!all.length || !all.every((p) => Number.isFinite(p.re) && Number.isFinite(p.im))) {
    return emptyChart(W, H, "There are no finite poles or zeros to draw");
  }
  const ML = 46;
  const MR = 12;
  const MT = 22;
  const MB = 34;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  // One scale for both axes, centred on the data with the origin always in
  // view — the imaginary axis is the boundary the reader is reading against.
  const maxAbs = Math.max(1e-9, ...all.map((p) => Math.max(Math.abs(p.re), Math.abs(p.im))));
  const span = maxAbs * 2.4;
  const scale = Math.min(pw, ph) / span;
  const cx = ML + pw / 2;
  const cy = MT + ph / 2;
  const X = (re: number): number => cx + re * scale;
  const Y = (im: number): number => cy - im * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="14" text-anchor="middle" font-size="11">Pole-zero map</text>`);

  // The right half plane, shaded from the imaginary axis to the frame edge.
  if (X(0) < ML + pw) {
    p.push(`<rect x="${X(0).toFixed(1)}" y="${MT}" width="${(ML + pw - X(0)).toFixed(1)}" height="${ph}" fill="#fef2f2"/>`);
    p.push(`<text x="${(ML + pw - 4).toFixed(1)}" y="${MT + 11}" text-anchor="end" fill="${POINT}" font-size="7.5">unstable</text>`);
  }
  p.push(`<rect x="${ML}" y="${MT}" width="${pw}" height="${ph}" fill="none" stroke="${RULE}"/>`);
  p.push(`<line x1="${X(0).toFixed(1)}" y1="${MT}" x2="${X(0).toFixed(1)}" y2="${MT + ph}" stroke="${INK}" stroke-width="1"/>`);
  p.push(`<line x1="${ML}" y1="${Y(0).toFixed(1)}" x2="${(ML + pw).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="${RULE}"/>`);

  // n1() rounds to one decimal, and a map whose only content sits at the
  // origin has ticks at ±1e-9 — which n1 prints as "-0.0". Small magnitudes
  // get exponent form instead.
  const tickLabel = (t: number): string => (Math.abs(t) >= 0.01 ? n1(t) : t.toExponential(0));
  const step = niceStep(span, 4);
  for (const t of ticks(Math.ceil(-span / 2 / step) * step, span / 2, step)) {
    if (Math.abs(t) < step * 1e-6) continue;
    if (X(t) >= ML && X(t) <= ML + pw) {
      p.push(`<line x1="${X(t).toFixed(1)}" y1="${(Y(0) - 3).toFixed(1)}" x2="${X(t).toFixed(1)}" y2="${(Y(0) + 3).toFixed(1)}" stroke="${RULE}"/>`);
      p.push(`<text x="${X(t).toFixed(1)}" y="${MT + ph + 12}" text-anchor="middle">${esc(tickLabel(t))}</text>`);
    }
    if (Y(t) >= MT && Y(t) <= MT + ph) {
      p.push(`<line x1="${(X(0) - 3).toFixed(1)}" y1="${Y(t).toFixed(1)}" x2="${(X(0) + 3).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="${RULE}"/>`);
      p.push(`<text x="${ML - 4}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end">${esc(tickLabel(t))}</text>`);
    }
  }

  for (const z of zeros) {
    p.push(`<circle cx="${X(z.re).toFixed(1)}" cy="${Y(z.im).toFixed(1)}" r="4" fill="none" stroke="${CIRCLE}" stroke-width="1.8"/>`);
  }
  for (const po of poles) {
    const x = X(po.re);
    const y = Y(po.im);
    const colour = po.re > 0 ? POINT : "#111111";
    p.push(`<line x1="${(x - 4).toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${(x + 4).toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="${colour}" stroke-width="1.8"/>`);
    p.push(`<line x1="${(x - 4).toFixed(1)}" y1="${(y + 4).toFixed(1)}" x2="${(x + 4).toFixed(1)}" y2="${(y - 4).toFixed(1)}" stroke="${colour}" stroke-width="1.8"/>`);
  }

  p.push(labelText(ML + 4, MT + 11, "× pole   ○ zero", { size: 8 }));
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">Re(s)</text>`);
  p.push(`<text x="12" y="${(MT + ph / 2).toFixed(1)}" text-anchor="middle" transform="rotate(-90 12 ${(MT + ph / 2).toFixed(1)})">Im(s)</text>`);
  p.push("</g></svg>");
  return p.join("");
}

export const HBAR_ROW_H = 22;

export interface HBarRow {
  name: string;
  value: number;
  /** Literal hex; defaults to blue for positive, red for negative. */
  colour?: string;
}

/**
 * A horizontal bar chart — the figure for results that are a LIST of named
 * quantities rather than a curve: per-element power, an energy budget, a
 * timing ledger. Height grows with the row count so twenty rows do not
 * crush into an unreadable stripe.
 */
export function hBarSvg(rows: HBarRow[], opts: { title: string; unit: string; w?: number }): string {
  const W = opts.w ?? 400;
  const shown = rows.slice(0, 24);
  const H = 46 + shown.length * HBAR_ROW_H + 18;
  if (!shown.length || !shown.every((r) => Number.isFinite(r.value))) {
    return emptyChart(W, 160, "There are no finite values to chart");
  }
  const longest = Math.max(...shown.map((r) => r.name.length));
  const ML = Math.min(150, Math.max(60, longest * 5.6 + 10));
  const MR = 58;
  const MT = 26;
  const pw = W - ML - MR;
  const lo = Math.min(0, ...shown.map((r) => r.value));
  const hi = Math.max(0, ...shown.map((r) => r.value));
  // hi and lo are each finite, but hi - lo can still overflow to Infinity
  // (two values near ±1.8e308), and Infinity/Infinity is the NaN this file
  // must never emit. Halve into range rather than refuse: the bars stay
  // proportionally true at half scale.
  let span = hi - lo || 1;
  if (!Number.isFinite(span)) span = Math.max(Math.abs(hi / 2 - lo / 2), 1) * 2;
  const X = (v: number): number => ML + ((v / 2 - lo / 2) / (span / 2)) * pw;

  // n1() rounds to one decimal, and a milliwatt bar labelled "0.0 W" is a
  // lie. Three significant figures, with plain decimals where they stay
  // short and exponent form where they would not.
  const fmtVal = (v: number): string => {
    const a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
    if (a >= 100) return v.toFixed(0);
    return v.toPrecision(3);
  };

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">${esc(opts.title)}</text>`);
  p.push(`<line x1="${X(0).toFixed(1)}" y1="${MT}" x2="${X(0).toFixed(1)}" y2="${MT + shown.length * HBAR_ROW_H}" stroke="${RULE}"/>`);
  shown.forEach((rw, i) => {
    const y = MT + i * HBAR_ROW_H + 4;
    const h = HBAR_ROW_H - 8;
    const x0 = Math.min(X(0), X(rw.value));
    const wBar = Math.max(Math.abs(X(rw.value) - X(0)), 0.75);
    const fill = rw.colour ?? (rw.value >= 0 ? CIRCLE : POINT);
    p.push(`<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${wBar.toFixed(1)}" height="${h}" fill="${fill}" fill-opacity="0.85"/>`);
    p.push(labelText(ML - 5, y + h / 2 + 3, rw.name, { anchor: "end" }));
    const txt = `${fmtVal(rw.value)} ${opts.unit}`;
    const wantX = Math.max(X(0), X(rw.value)) + 4;
    const estW = txt.length * 8 * 0.56 + 4;
    if (wantX + estW <= W - 2) p.push(labelText(wantX, y + h / 2 + 3, txt, { size: 8 }));
    else p.push(labelText(Math.max(X(0), X(rw.value)) - 4, y + h / 2 + 3, txt, { size: 8, anchor: "end" }));
  });
  if (rows.length > shown.length) {
    p.push(labelText(ML, H - 6, `…and ${rows.length - shown.length} more (see the table above)`, { size: 8, fill: RULE }));
  }
  p.push("</g></svg>");
  return p.join("");
}

export interface LogicWaveInput {
  /** Input variable names, in order. */
  variables: string[];
  /** One row per minterm index: the input bits, and the output bit. */
  rows: { inputs: boolean[]; output: boolean }[];
}

/**
 * The truth table drawn as logic-analyser waveforms: one lane per input
 * counting through the rows in order, the output lane at the bottom. The
 * same information as the table — which is the point; a glance shows WHERE
 * the output is high, which a column of 0s and 1s does not.
 */
export function logicWaveSvg(inp: LogicWaveInput): string {
  const n = inp.variables.length;
  const cols = inp.rows.length;
  const W = 400;
  const laneH = 26;
  const H = 40 + (n + 1) * laneH + 20;
  if (!n || !cols || cols > 64 || inp.rows.some((r) => r.inputs.length !== n)) {
    return emptyChart(W, 160, "The truth table is too large to draw as waveforms");
  }
  const ML = 44;
  const MR = 10;
  const MT = 30;
  const pw = W - ML - MR;
  const colW = pw / cols;
  const X = (c: number): number => ML + c * colW;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">Truth table as waveforms</text>`);

  const lane = (idx: number, name: string, bits: boolean[], colour: string): void => {
    const yHigh = MT + idx * laneH + 4;
    const yLow = MT + idx * laneH + laneH - 6;
    p.push(labelText(ML - 5, (yHigh + yLow) / 2 + 3, name, { anchor: "end" }));
    const pts: string[] = [];
    for (let c = 0; c < bits.length; c++) {
      const y = bits[c] ? yHigh : yLow;
      pts.push(`${X(c).toFixed(1)},${y.toFixed(1)}`, `${X(c + 1).toFixed(1)},${y.toFixed(1)}`);
    }
    p.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${colour}" stroke-width="1.5"/>`);
  };
  for (let v = 0; v < n; v++) lane(v, inp.variables[v], inp.rows.map((r) => r.inputs[v]), CIRCLE);
  lane(n, "out", inp.rows.map((r) => r.output), POINT);

  // Minterm indices along the bottom, thinned so they stay legible.
  const every = cols > 32 ? 8 : cols > 16 ? 4 : cols > 8 ? 2 : 1;
  for (let c = 0; c < cols; c += every) {
    p.push(`<text x="${(X(c) + colW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${RULE}" font-size="7.5">${c}</text>`);
  }
  p.push("</g></svg>");
  return p.join("");
}

export const GAMUT_CHART_SIZE = { w: 380, h: 330 };

export interface GamutTriangleInput {
  gamutLabel: string;
  refLabel: string;
  /** CIE 1931 xy primaries, R G B order. */
  gamutPrimaries: Chromaticity[];
  refPrimaries: Chromaticity[];
  /** Coverage fraction (u'v'), for the title. */
  coverageUv: number;
}

/**
 * Two gamut triangles on the u'v' chromaticity plane — u'v' because CIE 1931
 * xy over-weights greens the eye discriminates poorly, which is the exact
 * point the tool's own numbers make. EQUAL ASPECT: coverage is an AREA claim,
 * and areas compare honestly only when both axes share one scale.
 */
export function gamutTriangleSvg(inp: GamutTriangleInput): string {
  const { w: W, h: H } = GAMUT_CHART_SIZE;
  if (inp.gamutPrimaries.length !== 3 || inp.refPrimaries.length !== 3) {
    return emptyChart(W, H, "The gamut primaries do not define triangles");
  }
  const g = inp.gamutPrimaries.map(xyToUv);
  const rf = inp.refPrimaries.map(xyToUv);
  if (![...g, ...rf].every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))) {
    return emptyChart(W, H, "The gamut primaries do not define triangles");
  }

  // Fixed domain covering every broadcast gamut's u'v' extent, padded.
  const uLo = 0;
  const uHi = 0.63;
  const vLo = 0;
  const vHi = 0.6;
  const ML = 44;
  const MR = 14;
  const MT = 28;
  const MB = 36;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const scale = Math.min(pw / (uHi - uLo), ph / (vHi - vLo));
  const ox = ML + (pw - (uHi - uLo) * scale) / 2;
  const oy = MT + (ph - (vHi - vLo) * scale) / 2;
  const X = (uu: number): number => ox + (uu - uLo) * scale;
  const Y = (vv: number): number => oy + (vHi - vv) * scale;

  const tri = (pts: Chromaticity[]): string =>
    pts.map((c, i) => `${i === 0 ? "M" : "L"}${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}`).join(" ") + " Z";

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(
    `<text x="${(ML + pw / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">${esc(
      `${inp.gamutLabel} vs ${inp.refLabel}: ${(inp.coverageUv * 100).toFixed(1)}% coverage (u'v')`,
    )}</text>`,
  );
  p.push(`<rect x="${X(uLo).toFixed(1)}" y="${Y(vHi).toFixed(1)}" width="${((uHi - uLo) * scale).toFixed(1)}" height="${((vHi - vLo) * scale).toFixed(1)}" fill="none" stroke="${FAINT}"/>`);

  for (const t of [0, 0.2, 0.4, 0.6]) {
    if (t <= uHi) p.push(`<text x="${X(t).toFixed(1)}" y="${(Y(vLo) + 12).toFixed(1)}" text-anchor="middle">${t.toFixed(1)}</text>`);
    if (t <= vHi) p.push(`<text x="${(X(uLo) - 4).toFixed(1)}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end">${t.toFixed(1)}</text>`);
  }

  p.push(`<path d="${tri(rf)}" fill="none" stroke="${RULE}" stroke-width="1.4" stroke-dasharray="5 3"/>`);
  p.push(`<path d="${tri(g)}" fill="#2563eb" fill-opacity="0.10" stroke="${CIRCLE}" stroke-width="1.8"/>`);

  const vertexColours = ["#b91c1c", "#059669", "#2563eb"];
  const vertexNames = ["R", "G", "B"];
  g.forEach((c, i) => {
    p.push(`<circle cx="${X(c.x).toFixed(1)}" cy="${Y(c.y).toFixed(1)}" r="3.2" fill="${vertexColours[i]}"/>`);
    p.push(labelText(X(c.x) + 5, Y(c.y) - 4, vertexNames[i], { size: 8, fill: vertexColours[i] }));
  });

  p.push(labelText(ML + 4, MT + 12, `solid: ${inp.gamutLabel}`, { size: 8, fill: CIRCLE }));
  p.push(labelText(ML + 4, MT + 24, `dashed: ${inp.refLabel}`, { size: 8, fill: RULE }));
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">u′</text>`);
  p.push(`<text x="12" y="${(MT + ph / 2).toFixed(1)}" text-anchor="middle" transform="rotate(-90 12 ${(MT + ph / 2).toFixed(1)})">v′</text>`);
  p.push("</g></svg>");
  return p.join("");
}

export const POWER_TRIANGLE_SIZE = { w: 360, h: 280 };

/**
 * The power triangle: P along the base, Q upward, S the hypotenuse, φ the
 * angle whose cosine is the power factor. EQUAL SCALE on both axes, because
 * φ IS the content and an angle drawn on stretched axes has the wrong
 * cosine. At pf = 1 the triangle collapses onto the base — drawn anyway,
 * with the label saying so, because that collapse is the fact.
 */
export function powerTriangleSvg(pKw: number, qKvar: number, sKva: number, pf: number): string {
  const { w: W, h: H } = POWER_TRIANGLE_SIZE;
  if (![pKw, qKvar, sKva, pf].every(Number.isFinite) || sKva <= 0) {
    return emptyChart(W, H, "The power inputs do not define a triangle");
  }
  const ML = 50;
  const MR = 16;
  const MT = 26;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const scale = Math.min(pw / Math.max(pKw, 1e-9), ph / Math.max(qKvar, pKw * 0.2, 1e-9));
  if (!Number.isFinite(scale) || scale <= 0) return emptyChart(W, H, "The power inputs do not define a triangle");
  const ox = ML;
  const oy = MT + ph;
  const X = (v: number): number => ox + v * scale;
  const Y = (v: number): number => oy - v * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">The power triangle</text>`);

  p.push(`<line x1="${X(0).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(pKw).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="${CIRCLE}" stroke-width="2.4"/>`);
  p.push(`<line x1="${X(pKw).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(pKw).toFixed(1)}" y2="${Y(qKvar).toFixed(1)}" stroke="${POINT}" stroke-width="2.4"/>`);
  p.push(`<line x1="${X(0).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(pKw).toFixed(1)}" y2="${Y(qKvar).toFixed(1)}" stroke="#059669" stroke-width="2"/>`);

  // The angle arc at the origin, radius fixed in pixels.
  const phi = Math.acos(Math.min(Math.max(pf, 0), 1));
  if (phi > 1e-4) {
    const rArc = Math.min(36, pKw * scale * 0.45);
    const ax = ox + rArc * Math.cos(phi);
    const ay = oy - rArc * Math.sin(phi);
    p.push(`<path d="M ${(ox + rArc).toFixed(1)} ${oy.toFixed(1)} A ${rArc.toFixed(1)} ${rArc.toFixed(1)} 0 0 0 ${ax.toFixed(1)} ${ay.toFixed(1)}" fill="none" stroke="${RULE}"/>`);
    p.push(labelText(ox + rArc + 5, oy - 6, `φ = ${n1((phi * 180) / Math.PI)}°`, { size: 8 }));
  }

  // Three significant figures, not n1's one decimal: a 20 W load labelled
  // "0.0 kW" is the same lie hBarSvg's formatter exists to prevent.
  const sig3 = (v: number): string => {
    const a2 = Math.abs(v);
    if (a2 === 0) return "0";
    if (a2 >= 1e5 || a2 < 1e-3) return v.toExponential(2);
    if (a2 >= 100) return v.toFixed(0);
    return v.toPrecision(3);
  };
  p.push(labelText(X(pKw / 2), Y(0) + 13, `P = ${sig3(pKw)} kW`, { anchor: "middle", fill: CIRCLE }));
  // RELATIVE collapse test: a unity power factor entered by POWER round-trips
  // through S = √3·V·I and picks up ~2e-8·P of float residue in Q — an
  // absolute epsilon missed it and drew "Q = 0.0 kVAR" instead of saying the
  // triangle collapsed.
  if (qKvar > 1e-9 * sKva && pf < 1) {
    // The Q label sits right of its leg when there is room and inside-left of
    // it when there is not — the audit caught it running off the canvas.
    const qTxt = `Q = ${sig3(qKvar)} kVAR`;
    const estW = qTxt.length * 8 * 0.56 + 4;
    if (X(pKw) + 4 + estW <= W - 2) p.push(labelText(X(pKw) + 4, Y(qKvar / 2) + 3, qTxt, { fill: POINT }));
    else p.push(labelText(X(pKw) - 4, Y(qKvar / 2) + 3, qTxt, { anchor: "end", fill: POINT }));
    p.push(labelText(X(pKw / 2) - 6, Y(qKvar / 2) - 6, `S = ${sig3(sKva)} kVA`, { anchor: "end", fill: "#059669" }));
  } else {
    // Collapsed triangle: S lies exactly on P, so ONE line says both — two
    // labels on the same segment collided in the audit.
    p.push(labelText(X(pKw / 2), Y(0) - 8, `S = P = ${sig3(sKva)} kVA: unity power factor, the triangle collapses`, { anchor: "middle", fill: RULE }));
  }
  p.push(labelText(ML, H - 8, `power factor = cos φ = ${pf.toFixed(3)}`, { size: 8 }));
  p.push("</g></svg>");
  return p.join("");
}

export const ORBIT_CHART_SIZE = { w: 360, h: 340 };

export interface OrbitConic {
  /** Semi-major axis, m. */
  a: number;
  /** Eccentricity; 0 draws a circle. */
  e: number;
  colour: string;
  label?: string;
  /** Draw only the transfer half (periapsis to apoapsis). */
  half?: boolean;
  dashed?: boolean;
}

export interface OrbitMarker {
  /** Radius from the focus, m, along the +x (periapsis) or -x axis. */
  rM: number;
  side: 1 | -1;
  label: string;
  colour: string;
}

/**
 * Orbits about a body, EQUAL ASPECT with the body at the shared focus. A
 * circular orbit drawn as an ellipse is wrong twice over here — the shape IS
 * the claim, and the focus offset of an ellipse is the physics the tool
 * exists to show.
 */
export function orbitChartSvg(bodyRadiusM: number, conics: OrbitConic[], markers: OrbitMarker[], title: string): string {
  const { w: W, h: H } = ORBIT_CHART_SIZE;
  if (!Number.isFinite(bodyRadiusM) || bodyRadiusM <= 0 || !conics.length) {
    return emptyChart(W, H, "The orbit inputs do not define a figure");
  }
  for (const c of conics) {
    if (!Number.isFinite(c.a) || c.a <= 0 || !Number.isFinite(c.e) || c.e < 0 || c.e >= 1) {
      return emptyChart(W, H, "The orbit inputs do not define a figure");
    }
  }
  const ML = 10;
  const MT = 24;
  const MB = 14;
  const pw = W - 2 * ML;
  const ph = H - MT - MB;
  // Extent: every conic's apoapsis and periapsis, plus the body. Guarded —
  // a semi-major axis near MAX_VALUE overflows the padding to Infinity and
  // scale 0 turns the polyline into NaN arithmetic.
  const ext = Math.max(bodyRadiusM, ...conics.map((c) => c.a * (1 + c.e))) * 1.08;
  if (!Number.isFinite(ext) || ext <= 0) return emptyChart(W, H, "The orbit inputs do not define a figure");
  const scale = Math.min(pw, ph) / (2 * ext);
  const cx = W / 2;
  const cy = MT + ph / 2;
  const X = (x: number): number => cx + x * scale;
  const Y = (y: number): number => cy - y * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(W / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">${esc(title)}</text>`);

  // The body, at the focus.
  p.push(`<circle cx="${X(0).toFixed(1)}" cy="${Y(0).toFixed(1)}" r="${Math.max(bodyRadiusM * scale, 2).toFixed(1)}" fill="#d1d5db" stroke="${RULE}"/>`);

  for (const c of conics) {
    const b = c.a * Math.sqrt(1 - c.e * c.e);
    const cOff = c.a * c.e; // focus at origin; centre at -c along x toward apoapsis
    const pts: string[] = [];
    const span = c.half ? Math.PI : 2 * Math.PI;
    for (let i = 0; i <= 120; i++) {
      const th = (span * i) / 120;
      const x = c.a * Math.cos(th) - cOff;
      const y = b * Math.sin(th);
      pts.push(`${X(x).toFixed(1)},${Y(y).toFixed(1)}`);
    }
    p.push(
      `<polyline points="${pts.join(" ")}" fill="none" stroke="${c.colour}" stroke-width="1.6"${c.dashed ? ' stroke-dasharray="5 3"' : ""}/>`,
    );
    if (c.label) {
      p.push(labelText(X(-cOff), Y(b) - 4, c.label, { anchor: "middle", fill: c.colour, size: 8 }));
    }
  }

  for (const mk of markers) {
    if (!Number.isFinite(mk.rM)) continue;
    const mx = X(mk.side * mk.rM);
    p.push(`<circle cx="${mx.toFixed(1)}" cy="${Y(0).toFixed(1)}" r="3" fill="${mk.colour}"/>`);
    // Anchored AWAY from the nearer edge, whatever side the marker is on — an
    // apoapsis label anchored end at the left rim ran off the canvas.
    const estW = mk.label.length * 8 * 0.56 + 4;
    const outward = mk.side > 0 ? mx + 5 : mx - 5;
    const fits = mk.side > 0 ? outward + estW <= W - 2 : outward - estW >= 2;
    if (fits) {
      p.push(labelText(outward, Y(0) + (mk.side > 0 ? -6 : 12), mk.label, { fill: mk.colour, size: 8, anchor: mk.side > 0 ? "start" : "end" }));
    } else {
      p.push(labelText(mk.side > 0 ? mx - 5 : mx + 5, Y(0) + (mk.side > 0 ? -6 : 12), mk.label, { fill: mk.colour, size: 8, anchor: mk.side > 0 ? "end" : "start" }));
    }
  }
  p.push("</g></svg>");
  return p.join("");
}

export const VECTOR_TRIANGLE_SIZE = { w: 340, h: 320 };

export interface TriangleVector {
  /** Components in the drawing plane (x right, y up). */
  dx: number;
  dy: number;
  colour: string;
  label: string;
  dashed?: boolean;
}

/**
 * Vectors drawn tip-to-tail with the resultant closing the figure, EQUAL
 * ASPECT because the angles between the legs are the entire content — a wind
 * triangle's drift angle or a climb triangle's γ read straight off the page
 * only when both axes share one scale.
 */
export function vectorTriangleSvg(legs: TriangleVector[], resultant: TriangleVector, title: string, note?: string): string {
  const { w: W, h: H } = VECTOR_TRIANGLE_SIZE;
  const all = [...legs, resultant];
  if (!all.length || !all.every((v) => Number.isFinite(v.dx) && Number.isFinite(v.dy))) {
    return emptyChart(W, H, "The vectors do not define a triangle");
  }
  // Tip-to-tail positions.
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (const v of legs) {
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + v.dx, y: last.y + v.dy });
  }
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const lo = { x: Math.min(0, ...xs), y: Math.min(0, ...ys) };
  const hi = { x: Math.max(0, ...xs), y: Math.max(0, ...ys) };
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, 1e-9) * 1.25;
  const ML = 14;
  const MT = 26;
  const MB = note ? 30 : 16;
  const pw = W - 2 * ML;
  const ph = H - MT - MB;
  const scale = Math.min(pw, ph) / span;
  const ox = ML + (pw - (hi.x - lo.x) * scale) / 2 - lo.x * scale;
  const oy = MT + (ph + (hi.y - lo.y) * scale) / 2 + lo.y * scale;
  const X = (x: number): number => ox + x * scale;
  const Y = (y: number): number => oy - y * scale;

  const arrow = (x0: number, y0: number, x1: number, y1: number, colour: string, dashed?: boolean): string => {
    const ang = Math.atan2(Y(y1) - Y(y0), X(x1) - X(x0));
    const hx = X(x1);
    const hy = Y(y1);
    const a1 = ang + Math.PI - 0.4;
    const a2 = ang + Math.PI + 0.4;
    return (
      `<line x1="${X(x0).toFixed(1)}" y1="${Y(y0).toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${colour}" stroke-width="2"${dashed ? ' stroke-dasharray="5 3"' : ""}/>` +
      `<line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${(hx + 8 * Math.cos(a1)).toFixed(1)}" y2="${(hy + 8 * Math.sin(a1)).toFixed(1)}" stroke="${colour}" stroke-width="2"/>` +
      `<line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${(hx + 8 * Math.cos(a2)).toFixed(1)}" y2="${(hy + 8 * Math.sin(a2)).toFixed(1)}" stroke="${colour}" stroke-width="2"/>`
    );
  };

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(W / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">${esc(title)}</text>`);

  // Labels sit OFF their vectors, pushed along each vector's screen-space
  // perpendicular — legs one way, the resultant the other — because a
  // shallow triangle (small drift, small climb angle) lays its legs almost
  // on top of the resultant and midpoint labels collided exactly there.
  const perpLabel = (x0: number, y0: number, x1: number, y1: number, txt: string, colour: string, side: 1 | -1): string => {
    const mx = (X(x0) + X(x1)) / 2;
    const my = (Y(y0) + Y(y1)) / 2;
    let px = -(Y(y1) - Y(y0));
    let py = X(x1) - X(x0);
    const n = Math.hypot(px, py) || 1;
    px = (px / n) * 14 * side;
    py = (py / n) * 14 * side;
    return labelText(mx + px, my + py, txt, { fill: colour, size: 8, anchor: "middle" });
  };
  legs.forEach((v, i) => {
    const from = pts[i];
    const to = pts[i + 1];
    p.push(arrow(from.x, from.y, to.x, to.y, v.colour, v.dashed));
    p.push(perpLabel(from.x, from.y, to.x, to.y, v.label, v.colour, 1));
  });
  p.push(arrow(0, 0, resultant.dx, resultant.dy, resultant.colour, resultant.dashed));
  p.push(perpLabel(0, 0, resultant.dx, resultant.dy, resultant.label, resultant.colour, -1));
  if (note) p.push(labelText(W / 2, H - 8, note, { anchor: "middle", size: 8, fill: RULE }));
  p.push("</g></svg>");
  return p.join("");
}

export const ARM_CHART_SIZE = { w: 360, h: 330 };

export interface ArmChain {
  joints: { x: number; y: number }[];
  colour: string;
  label?: string;
  dashed?: boolean;
}

export interface ArmCircle {
  r: number;
  cx?: number;
  cy?: number;
  dashed?: boolean;
  colour?: string;
}

export interface ArmEllipse {
  cx: number;
  cy: number;
  /** Semi-axes and rotation of the major axis, radians. */
  a: number;
  b: number;
  phi: number;
  colour: string;
}

/**
 * Linkages in the plane: chains of joints, reference circles (reach, wheel
 * tracks), a target cross, an optional ellipse (manipulability). EQUAL
 * ASPECT — the joint angles and the ellipse's eccentricity are the content.
 */
export function armSvg(
  chains: ArmChain[],
  circles: ArmCircle[],
  opts: {
    title: string;
    target?: { x: number; y: number };
    ellipse?: ArmEllipse;
    note?: string;
    /**
     * Floor on the drawn span, in data units. Two views of the SAME chain
     * (plan and elevation) must pass each other's extent here, or the same
     * link reads two different lengths across the pair.
     */
    minSpan?: number;
  },
): string {
  const { w: W, h: H } = ARM_CHART_SIZE;
  const xs: number[] = [0];
  const ys: number[] = [0];
  for (const ch of chains)
    for (const j of ch.joints) {
      if (!Number.isFinite(j.x) || !Number.isFinite(j.y)) return emptyChart(W, H, "The linkage has a non-finite joint");
      xs.push(j.x);
      ys.push(j.y);
    }
  for (const c of circles) {
    if (!Number.isFinite(c.r) || c.r < 0) continue;
    xs.push((c.cx ?? 0) - c.r, (c.cx ?? 0) + c.r);
    ys.push((c.cy ?? 0) - c.r, (c.cy ?? 0) + c.r);
  }
  if (opts.target) {
    xs.push(opts.target.x);
    ys.push(opts.target.y);
  }
  if (opts.ellipse) {
    const m = Math.max(opts.ellipse.a, opts.ellipse.b);
    xs.push(opts.ellipse.cx - m, opts.ellipse.cx + m);
    ys.push(opts.ellipse.cy - m, opts.ellipse.cy + m);
  }
  const lo = { x: Math.min(...xs), y: Math.min(...ys) };
  const hi = { x: Math.max(...xs), y: Math.max(...ys) };
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, opts.minSpan ?? 0, 1e-9) * 1.12;
  const ML = 12;
  const MT = 24;
  const MB = opts.note ? 28 : 14;
  const pw = W - 2 * ML;
  const ph = H - MT - MB;
  const scale = Math.min(pw, ph) / span;
  const ox = ML + (pw - (hi.x - lo.x) * scale) / 2 - lo.x * scale;
  const oy = MT + (ph + (hi.y - lo.y) * scale) / 2 + lo.y * scale;
  const X = (x: number): number => ox + x * scale;
  const Y = (y: number): number => oy - y * scale;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(W / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">${esc(opts.title)}</text>`);

  for (const c of circles) {
    if (!Number.isFinite(c.r) || c.r <= 0) continue;
    p.push(
      `<circle cx="${X(c.cx ?? 0).toFixed(1)}" cy="${Y(c.cy ?? 0).toFixed(1)}" r="${(c.r * scale).toFixed(1)}" fill="none" stroke="${c.colour ?? FAINT}"${c.dashed !== false ? ' stroke-dasharray="4 3"' : ""}/>`,
    );
  }
  if (opts.ellipse) {
    const el = opts.ellipse;
    const deg = (el.phi * 180) / Math.PI;
    p.push(
      `<ellipse cx="${X(el.cx).toFixed(1)}" cy="${Y(el.cy).toFixed(1)}" rx="${Math.max(el.a * scale, 0.75).toFixed(1)}" ry="${Math.max(el.b * scale, 0.75).toFixed(1)}" transform="rotate(${(-deg).toFixed(1)} ${X(el.cx).toFixed(1)} ${Y(el.cy).toFixed(1)})" fill="${el.colour}" fill-opacity="0.15" stroke="${el.colour}" stroke-width="1.6"/>`,
    );
  }
  for (const ch of chains) {
    const pts = ch.joints.map((j) => `${X(j.x).toFixed(1)},${Y(j.y).toFixed(1)}`).join(" ");
    p.push(`<polyline points="${pts}" fill="none" stroke="${ch.colour}" stroke-width="3" stroke-linecap="round"${ch.dashed ? ' stroke-dasharray="6 4"' : ""}/>`);
    for (const j of ch.joints) {
      p.push(`<circle cx="${X(j.x).toFixed(1)}" cy="${Y(j.y).toFixed(1)}" r="3.4" fill="${PAPER}" stroke="${ch.colour}" stroke-width="1.6"/>`);
    }
    if (ch.label && ch.joints.length) {
      const tip = ch.joints[ch.joints.length - 1];
      p.push(labelText(X(tip.x) + 6, Y(tip.y) - 6, ch.label, { fill: ch.colour, size: 8 }));
    }
  }
  if (opts.target) {
    const tx = X(opts.target.x);
    const ty = Y(opts.target.y);
    p.push(`<line x1="${(tx - 5).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(tx + 5).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${POINT}" stroke-width="2"/>`);
    p.push(`<line x1="${tx.toFixed(1)}" y1="${(ty - 5).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(ty + 5).toFixed(1)}" stroke="${POINT}" stroke-width="2"/>`);
  }
  if (opts.note) p.push(labelText(W / 2, H - 8, opts.note, { anchor: "middle", size: 8, fill: RULE }));
  p.push("</g></svg>");
  return p.join("");
}

export const LADDER_CHART_SIZE_W = 400;

export interface LadderRow {
  name: string;
  /** Signed contribution; the result row's delta is its absolute position. */
  delta: number;
  gain: boolean;
  /** The final bar, drawn from zero to delta. */
  result?: boolean;
}

/**
 * A generic waterfall ledger — the npshLadderSvg shape with the strings and
 * the number format as parameters, because a temperature ladder in °C, a
 * timing budget in picoseconds and an enthalpy ledger in kJ/kg all need the
 * same bars and none of them survives a formatter hardwired to one decimal
 * of a metre of head.
 */
export function ladderSvg(
  rows: LadderRow[],
  opts: {
    title: string;
    axisLabel: string;
    fmt: (v: number) => string;
    limit?: number;
    limitLabel?: string;
    /** true: the result bar must END AT OR ABOVE the limit; false: at or below. */
    limitOkAbove?: boolean;
    okText?: string;
    failText?: string;
  },
): string {
  const W = LADDER_CHART_SIZE_W;
  // The RESULT row survives any cap: a ledger whose bottom line was silently
  // sliced off would be the latency-chart defect all over again.
  const resultRows = rows.filter((rw) => rw.result);
  // ROOM CLAMPED AT ZERO. Written as `slice(0, 10 - resultRows.length)`, a
  // ledger with more than ten result rows made the end argument NEGATIVE, and
  // a negative end counts from the tail instead of truncating — so the cap
  // silently stopped applying and 70,000 result rows produced a 28 MB SVG
  // 2.4 million pixels tall.
  const room = Math.max(0, 10 - resultRows.length);
  const normalRows = rows.filter((rw) => !rw.result);
  const shown =
    rows.length <= 10 ? rows : [...normalRows.slice(0, room), ...resultRows.slice(0, 10)];
  // AND THE TRUNCATION IS REPORTED. It was silent: forty rows in, ten bars out,
  // nothing on the artwork saying so — which reads as "that is all the data
  // there was". `hBarSvg` next door has said "…and N more" since it was
  // written; this did not.
  const droppedRows = rows.length - shown.length;
  const H = 56 + shown.length * 34 + 12;
  if (!shown.length || !shown.every((rw) => Number.isFinite(rw.delta)) || (opts.limit !== undefined && !Number.isFinite(opts.limit))) {
    return emptyChart(W, 180, "The inputs do not define a ledger");
  }

  // Running edges.
  let run = 0;
  const bars = shown.map((rw) => {
    if (rw.result) return { ...rw, from: 0, to: rw.delta };
    const from = run;
    run += rw.delta;
    return { ...rw, from, to: run };
  });
  const edges = bars.flatMap((b) => [b.from, b.to]);
  const lo = Math.min(0, ...edges, opts.limit ?? 0);
  const hi = Math.max(1e-9, ...edges, opts.limit ?? 0) * 1.12;
  if (!(hi > lo) || !Number.isFinite(hi - lo)) return emptyChart(W, 180, "The inputs do not define a ledger");

  const ML = 118;
  const MR = 16;
  const MT = 26;
  const MB = 30;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const X = (v: number): number => ML + ((v - lo) / (hi - lo)) * pw;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">${esc(opts.title)}</text>`);

  const step = niceStep(hi - lo, 5);
  for (const t of ticks(Math.ceil(lo / step) * step, hi, step)) {
    p.push(`<line x1="${X(t).toFixed(1)}" y1="${MT}" x2="${X(t).toFixed(1)}" y2="${MT + ph}" stroke="#f0f0f0"/>`);
    p.push(`<text x="${X(t).toFixed(1)}" y="${MT + ph + 12}" text-anchor="middle">${esc(opts.fmt(t))}</text>`);
  }
  p.push(`<line x1="${X(0).toFixed(1)}" y1="${MT}" x2="${X(0).toFixed(1)}" y2="${MT + ph}" stroke="${RULE}"/>`);

  // The limit line goes UNDER the bars and labels, as npshLadderSvg learned.
  let ok = true;
  if (opts.limit !== undefined) {
    const resultBar = bars.find((b) => b.result);
    if (resultBar) ok = opts.limitOkAbove ? resultBar.to >= opts.limit : resultBar.to <= opts.limit;
    p.push(`<line x1="${X(opts.limit).toFixed(1)}" y1="${MT}" x2="${X(opts.limit).toFixed(1)}" y2="${MT + ph}" stroke="${POINT}" stroke-dasharray="4 3" stroke-width="1.4"/>`);
  }

  const rowH = ph / bars.length;
  bars.forEach((b, i) => {
    const y = MT + i * rowH + rowH * 0.2;
    const h = rowH * 0.6;
    const x0 = Math.min(X(b.from), X(b.to));
    const wBar = Math.max(Math.abs(X(b.to) - X(b.from)), 0.75);
    const fill = b.result ? (opts.limit !== undefined ? (ok ? "#059669" : POINT) : "#059669") : b.gain ? CIRCLE : POINT;
    p.push(`<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${wBar.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" fill-opacity="${b.result ? "1" : "0.75"}"/>`);
    p.push(labelText(ML - 6, y + h / 2 + 3, b.name, { anchor: "end" }));
    const delta = b.result ? b.to : b.to - b.from;
    const txt = `${delta >= 0 && !b.result ? "+" : ""}${opts.fmt(delta)}`;
    const wantX = Math.max(X(b.from), X(b.to)) + 4;
    const estW = txt.length * 8 * 0.56 + 4;
    if (wantX + estW <= W - 2) p.push(labelText(wantX, y + h / 2 + 3, txt, { size: 8 }));
    else p.push(labelText(Math.max(X(b.from), X(b.to)) - 4, y + h / 2 + 3, txt, { size: 8, anchor: "end" }));
  });

  if (opts.limit !== undefined && opts.limitLabel) {
    const half = (opts.limitLabel.length * 8 * 0.56) / 2 + 3;
    p.push(labelText(Math.min(Math.max(X(opts.limit), half + 2), W - half - 2), MT - 3, opts.limitLabel, { anchor: "middle", fill: POINT }));
    p.push(labelText(ML + pw - 2, MT + ph - 4, ok ? (opts.okText ?? "within limit") : (opts.failText ?? "OVER LIMIT"), { anchor: "end", fill: ok ? "#059669" : POINT, size: 9 }));
  }
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(opts.axisLabel)}</text>`);
  // SAY WHAT WAS DROPPED. The row cap was silent: forty rows in, ten bars out,
  // nothing on the artwork — which reads as "that is all the data there was".
  // Worse on a WATERFALL than on a bar chart, because the running edges then
  // stop short of the total bar and the ledger appears not to add up.
  // hBarSvg next door has carried its "…and N more" since it was written.
  if (droppedRows > 0) {
    p.push(labelText(ML + pw, H - 6, `…and ${droppedRows} more`, { size: 8, anchor: "end", fill: POINT }));
  }
  p.push("</g></svg>");
  return p.join("");
}

export const NPSH_CHART_SIZE = { w: 400, h: 240 };

export interface NpshLadderInput {
  /** Surface-pressure head pSurface/(ρg), m. */
  surfaceHead: number;
  /** Static head, m; negative when the pump sits above the liquid. */
  staticHead: number;
  /** Vapour-pressure head pVapour/(ρg), m. Spent. */
  vapourHead: number;
  /** Suction-line losses, m. Spent. */
  losses: number;
  npshAvailable: number;
  npshRequired: number;
}

/**
 * The NPSH ledger: how the available head is assembled and where it is spent,
 * against the head the pump demands.
 *
 * A waterfall rather than a curve because with TYPED losses there is no flow
 * axis to draw — the tool may know nothing about the pipe. What the reader
 * needs is WHERE the head went: surface pressure in, static head in or out,
 * vapour pressure and friction out, and whether what is left clears NPSHr.
 */
export function npshLadderSvg(inp: NpshLadderInput): string {
  const { w: W, h: H } = NPSH_CHART_SIZE;
  const vals = [inp.surfaceHead, inp.staticHead, inp.vapourHead, inp.losses, inp.npshAvailable, inp.npshRequired];
  if (!vals.every(Number.isFinite)) return emptyChart(W, H, "The NPSH inputs do not define a chart");

  // Running edges of the waterfall.
  const c1 = inp.surfaceHead;
  const c2 = c1 + inp.staticHead;
  const c3 = c2 - inp.vapourHead;
  const c4 = c3 - inp.losses;
  const rows = [
    { name: "surface pressure", from: 0, to: c1, gain: true, result: false },
    { name: "static head", from: c1, to: c2, gain: inp.staticHead >= 0, result: false },
    { name: "vapour pressure", from: c2, to: c3, gain: false, result: false },
    { name: "suction losses", from: c3, to: c4, gain: false, result: false },
    { name: "NPSH available", from: 0, to: c4, gain: true, result: true },
  ];
  // STRICTLY greater, because the engine calls a margin of exactly zero
  // cavitation (fluids.ts: margin <= 0) — the figure must never contradict
  // the verdict printed beside it.
  const ok = inp.npshAvailable > inp.npshRequired;

  const ML = 104;
  const MR = 16;
  const MT = 26;
  const MB = 30;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const lo = Math.min(0, c1, c2, c3, c4);
  const hi = Math.max(0.001, c1, c2, c3, c4, inp.npshRequired) * 1.12;
  if (!(hi > lo) || !Number.isFinite(hi - lo)) return emptyChart(W, H, "The NPSH inputs do not define a chart");
  const X = (v: number): number => ML + ((v - lo) / (hi - lo)) * pw;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  p.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="11">Where the suction head goes</text>`);

  // Axis + gridlines, in metres of head.
  const step = niceStep(hi - lo, 5);
  for (const t of ticks(Math.ceil(lo / step) * step, hi, step)) {
    p.push(`<line x1="${X(t).toFixed(1)}" y1="${MT}" x2="${X(t).toFixed(1)}" y2="${MT + ph}" stroke="#f0f0f0"/>`);
    p.push(`<text x="${X(t).toFixed(1)}" y="${MT + ph + 12}" text-anchor="middle">${esc(n1(t))}</text>`);
  }
  p.push(`<line x1="${X(0).toFixed(1)}" y1="${MT}" x2="${X(0).toFixed(1)}" y2="${MT + ph}" stroke="${RULE}"/>`);

  // NPSH required, the line the last bar must clear — drawn UNDER the bars
  // and their value labels, because a line drawn after an opaque-backed label
  // strikes it out (the audit caught exactly that on a deep suction lift).
  p.push(`<line x1="${X(inp.npshRequired).toFixed(1)}" y1="${MT}" x2="${X(inp.npshRequired).toFixed(1)}" y2="${MT + ph}" stroke="${POINT}" stroke-dasharray="4 3" stroke-width="1.4"/>`);

  const rowH = ph / rows.length;
  rows.forEach((rw, i) => {
    const y = MT + i * rowH + rowH * 0.2;
    const h = rowH * 0.6;
    const x0 = Math.min(X(rw.from), X(rw.to));
    const wBar = Math.max(Math.abs(X(rw.to) - X(rw.from)), 0.75);
    const fill = rw.result ? (ok ? "#059669" : POINT) : rw.gain ? CIRCLE : POINT;
    p.push(`<rect x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${wBar.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" fill-opacity="${rw.result ? "1" : "0.75"}"/>`);
    p.push(labelText(ML - 6, y + h / 2 + 3, rw.name, { anchor: "end" }));
    const delta = rw.result ? rw.to : rw.to - rw.from;
    const deltaTxt = `${delta >= 0 && !rw.result ? "+" : ""}${n1(delta)} m`;
    // Clamped to the canvas: a bar driven hard right by a large negative
    // static head would otherwise push its value label past the viewBox,
    // where it is silently cropped. If it does not fit outside the bar it
    // goes INSIDE it, right-aligned.
    const wantX = Math.max(X(rw.from), X(rw.to)) + 4;
    const estW = deltaTxt.length * 8 * 0.56 + 4;
    if (wantX + estW <= W - 2) p.push(labelText(wantX, y + h / 2 + 3, deltaTxt, { size: 8 }));
    else p.push(labelText(Math.max(X(rw.from), X(rw.to)) - 4, y + h / 2 + 3, deltaTxt, { size: 8, anchor: "end" }));
  });

  // The requirement's label rides above everything; clamped so a requirement
  // near either edge cannot hang off the canvas.
  const reqTxt = `NPSH required ${n1(inp.npshRequired)} m`;
  const reqHalf = (reqTxt.length * 8 * 0.56) / 2 + 3;
  p.push(labelText(Math.min(Math.max(X(inp.npshRequired), reqHalf + 2), W - reqHalf - 2), MT - 3, reqTxt, { anchor: "middle", fill: POINT }));
  p.push(labelText(ML + pw - 2, MT + ph - 4, ok ? "clears NPSHr" : "CAVITATES", { anchor: "end", fill: ok ? "#059669" : POINT, size: 9 }));

  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">head (m)</text>`);
  p.push("</g></svg>");
  return p.join("");
}
