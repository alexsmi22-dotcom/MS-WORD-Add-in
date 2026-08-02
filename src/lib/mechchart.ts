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

/** A tick step that lands on 1, 2 or 5 times a power of ten. */
function niceStep(span: number, target: number): number {
  if (!(span > 0) || !(target > 0)) return 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${RULE}">Mohr's circle needs a finite stress state</text></svg>`;
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

  // Ticks on sigma.
  const step = niceStep(xHi - xLo, 5);
  for (let t = Math.ceil(xLo / step) * step; t <= xHi + 1e-9; t += step) {
    const x = X(t);
    if (x < ML - 0.5 || x > W - MR + 0.5) continue;
    p.push(`<line x1="${x.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y0 + 4).toFixed(1)}" stroke="${RULE}"/>`);
    p.push(`<text x="${x.toFixed(1)}" y="${(y0 + 14).toFixed(1)}" text-anchor="middle" fill="${INK}">${esc(n1(t))}</text>`);
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
  for (const [px, py, label] of [
    [ax, ay, `(σx, τxy)`],
    [bx, by, `(σy, −τxy)`],
  ] as [number, number, string][]) {
    p.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${POINT}"/>`);
    p.push(`<text x="${(px + 5).toFixed(1)}" y="${(py - 5).toFixed(1)}" fill="${POINT}" font-size="8">${esc(label)}</text>`);
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
  p.push(`<text x="${(X(c) + 4).toFixed(1)}" y="${((y0 + topY) / 2).toFixed(1)}" fill="${CIRCLE}" font-size="8">τmax = R = ${esc(n1(R))}</text>`);

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
  /** The operating point. */
  sigmaM: number;
  sigmaA: number;
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
  const MR = 74; // room for the legend
  const MT = 24;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const unit = inp.unit ?? "MPa";

  const xs: number[] = [inp.sigmaM, 0];
  const ys: number[] = [inp.sigmaA, 0];
  for (const l of inp.lines) for (const pt of l.points) { xs.push(pt.m); ys.push(pt.a); }
  if (inp.sutMPa) xs.push(inp.sutMPa);
  if (inp.seMPa) ys.push(inp.seMPa);
  const finiteX = xs.filter(Number.isFinite);
  const finiteY = ys.filter(Number.isFinite);
  if (!finiteX.length || !finiteY.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${RULE}">Nothing to plot</text></svg>`;
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
  for (let t = 0; t <= xHi + 1e-9; t += sx) {
    const x = X(t);
    if (x > ML + pw + 0.5) break;
    p.push(`<line x1="${x.toFixed(1)}" y1="${MT + ph}" x2="${x.toFixed(1)}" y2="${MT + ph + 4}" stroke="${RULE}"/>`);
    p.push(`<text x="${x.toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle">${esc(n1(t))}</text>`);
  }
  const sy = niceStep(yHi, 4);
  for (let t = 0; t <= yHi + 1e-9; t += sy) {
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
    p.push(`<text x="${(px + 6).toFixed(1)}" y="${(py - 5).toFixed(1)}" fill="${POINT}" font-size="8">operating point</text>`);
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/></svg>`;
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/></svg>`;
  }
  const xHi = Math.max(inp.slenderness * 1.6, (inp.transition ?? 0) * 1.8, 60);
  const yHi = (Fy && Fy > 0 ? Fy : inp.sigmaCritical) * 1.35;
  if (!(yHi > 0) || !Number.isFinite(yHi)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/></svg>`;
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
  for (let t = 0; t <= xHi + 1e-9; t += sx) {
    if (X(t) > ML + pw + 0.5) break;
    p.push(`<line x1="${X(t).toFixed(1)}" y1="${MT + ph}" x2="${X(t).toFixed(1)}" y2="${MT + ph + 4}" stroke="${RULE}"/>`);
    p.push(`<text x="${X(t).toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle">${esc(n1(t))}</text>`);
  }
  const syStep = niceStep(yHi / 1e6, 4) * 1e6;
  for (let t = 0; t <= yHi + 1e-9; t += syStep) {
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

  if (Fy && Fy > 0 && inp.transition && Number.isFinite(inp.transition)) {
    const john: string[] = [];
    for (let i = 0; i <= 140; i++) {
      const lam = (inp.transition * i) / 140;
      const sg = Fy - ((Fy * lam) / (2 * Math.PI)) ** 2 / E;
      if (!Number.isFinite(sg) || sg < 0) continue;
      john.push(`${X(lam).toFixed(1)},${Y(sg).toFixed(1)}`);
    }
    if (john.length > 1) p.push(`<polyline points="${john.join(" ")}" fill="none" stroke="#059669" stroke-width="1.5"/>`);
    p.push(`<line x1="${ML}" y1="${Y(Fy).toFixed(1)}" x2="${(ML + pw).toFixed(1)}" y2="${Y(Fy).toFixed(1)}" stroke="${FAINT}" stroke-dasharray="3 3"/>`);
    p.push(`<text x="${(ML + pw - 2).toFixed(1)}" y="${(Y(Fy) - 3).toFixed(1)}" text-anchor="end" fill="${RULE}" font-size="7.5">yield</text>`);
    p.push(`<line x1="${X(inp.transition).toFixed(1)}" y1="${MT}" x2="${X(inp.transition).toFixed(1)}" y2="${MT + ph}" stroke="${FAINT}" stroke-dasharray="2 3"/>`);
    p.push(`<text x="${(X(inp.transition) + 3).toFixed(1)}" y="${MT + 10}" fill="${RULE}" font-size="7.5">transition</text>`);
  }

  p.push(`<circle cx="${X(inp.slenderness).toFixed(1)}" cy="${Y(inp.sigmaCritical).toFixed(1)}" r="3.4" fill="${POINT}"/>`);
  p.push(`<text x="${(X(inp.slenderness) + 6).toFixed(1)}" y="${(Y(inp.sigmaCritical) - 5).toFixed(1)}" fill="${POINT}" font-size="8">this column</text>`);
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/></svg>`;
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
    p.push(`<text x="${(X(j.x) + 5).toFixed(1)}" y="${(Y(j.y) - 5).toFixed(1)}" font-size="7.5">${esc(j.name)}</text>`);
  }

  let ly = MT + 6;
  for (const [c, label] of [["#b91c1c", "tension"], ["#2563eb", "compression"], [FAINT, "zero-force"]] as [string, string][]) {
    p.push(`<line x1="${(ML + pw + 10).toFixed(1)}" y1="${ly}" x2="${(ML + pw + 26).toFixed(1)}" y2="${ly}" stroke="${c}" stroke-width="2"/>`);
    p.push(`<text x="${(ML + pw + 29).toFixed(1)}" y="${ly + 3}" font-size="7.5">${esc(label)}</text>`);
    ly += 13;
  }
  p.push(`<text x="${(ML + pw + 10).toFixed(1)}" y="${ly + 6}" font-size="7">thickness scales with force</text>`);
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
export function torsionProfileSvg(outerD: number, boreD: number, tauMax: number, unit = "MPa"): string {
  const { w: W, h: H } = TORSION_CHART_SIZE;
  const ML = 54;
  const MR = 20;
  const MT = 24;
  const MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  if (![outerD, boreD, tauMax].every(Number.isFinite) || outerD <= 0 || tauMax <= 0 || boreD < 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/></svg>`;
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
  p.push(`<text x="${(X(ro) - 4).toFixed(1)}" y="${(Y(tauMax) - 6).toFixed(1)}" text-anchor="end" fill="${POINT}" font-size="8">τmax = ${esc(n1(tauMax))}</text>`);
  if (ri === 0) p.push(`<text x="${(ML + 4).toFixed(1)}" y="${(MT + ph - 6).toFixed(1)}" fill="${RULE}" font-size="7.5">zero at the axis</text>`);

  const st = niceStep(yTop, 4);
  for (let t = 0; t <= yTop + 1e-9; t += st) {
    if (Y(t) < MT - 0.5) break;
    p.push(`<line x1="${ML - 4}" y1="${Y(t).toFixed(1)}" x2="${ML}" y2="${Y(t).toFixed(1)}" stroke="${RULE}"/>`);
    p.push(`<text x="${ML - 6}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end">${esc(n1(t))}</text>`);
  }
  p.push(`<text x="${ML}" y="${MT + ph + 14}" text-anchor="middle">0</text>`);
  p.push(`<text x="${X(ro).toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle">${esc(n1(ro))}</text>`);
  p.push(`<text x="${(ML + pw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">radius</text>`);
  p.push(`<text x="12" y="${MT + ph / 2}" text-anchor="middle" transform="rotate(-90 12 ${MT + ph / 2})">τ (${esc(unit)})</text>`);
  p.push("</g></svg>");
  return p.join("");
}
