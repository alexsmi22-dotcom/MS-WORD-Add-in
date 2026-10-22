// Figures for the control-design calculators: the root locus on the s-plane, the
// Nyquist plot of L(jω), and the discrete pole-zero map on the z-plane.
//
// EQUAL SCALE ON BOTH AXES, which is why these are not buildPlotSvg figures. The
// damping ratio of a pole pair is the cosine of the angle it makes at the origin,
// asymptotes leave the centroid at stated angles, and the unit circle has to be a
// circle; all three lie on unequal axes.
//
// EVERY LABEL SITS OUTSIDE THE PLOT FRAME (ticks below and left, a key underneath),
// and every line inside the frame is CLIPPED TO IT GEOMETRICALLY rather than with a
// clipPath. Branches and asymptotes run to infinity by nature; a clipPath would hide
// them on screen while leaving the segments in the file for any reader that ignores
// clipping — and the figure-layout audit is such a reader.
//
// Colours are literal hex: inserted artwork never follows the pane's theme.

import { linearAxis, fmtSig } from "./axis";
import type { Complex } from "./linalg";
import type { RootLocusResult, NyquistResult, C2dResult } from "./controlDesign";
import { fmtShort, ratPlain } from "./controlDesign";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#111111";
const RULE = "#9ca3af";
const GRID = "#e5e7eb";
const PAPER = "#ffffff";
const BLUE = "#2563eb";
const RED = "#b91c1c";
const GREEN = "#047857";
const PURPLE = "#6d28d9";
const ORANGE = "#c2410c";

const f = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, opts: { anchor?: string; size?: number; fill?: string; rotate?: boolean } = {}): string => {
  const a = opts.anchor ?? "start";
  const rot = opts.rotate ? ` transform="rotate(-90 ${f(x)} ${f(y)})"` : "";
  return `<text x="${f(x)}" y="${f(y)}" text-anchor="${a}" font-family="${FONT}" font-size="${opts.size ?? 9}" fill="${opts.fill ?? INK}"${rot}>${esc(t)}</text>`;
};

export const S_PLANE_W = 420;

interface Frame {
  W: number;
  H: number;
  ML: number;
  MT: number;
  pw: number;
  ph: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  X: (v: number) => number;
  Y: (v: number) => number;
}

/** An equal-scale frame around a set of points (always including `must`). */
function equalFrame(pts: Complex[], keyLines: number, opts: { minHalf?: number; pad?: number } = {}): Frame {
  const W = S_PLANE_W;
  const ML = 52;
  const MR = 14;
  const MT = 26;
  const pw = W - ML - MR;
  const ph = 290;
  const H = MT + ph + 34 + keyLines * 13 + 6;
  const fin = pts.filter((p) => Number.isFinite(p.re) && Number.isFinite(p.im));
  let xlo = Math.min(...fin.map((p) => p.re));
  let xhi = Math.max(...fin.map((p) => p.re));
  let ylo = Math.min(...fin.map((p) => p.im));
  let yhi = Math.max(...fin.map((p) => p.im));
  if (!fin.length) {
    xlo = -1;
    xhi = 1;
    ylo = -1;
    yhi = 1;
  }
  const pad = opts.pad ?? 0.18;
  let spanX = xhi - xlo;
  let spanY = yhi - ylo;
  const minHalf = Math.max(opts.minHalf ?? 0, 1e-9, 0.25 * Math.max(spanX, spanY));
  if (spanX < 2 * minHalf) {
    const c = (xlo + xhi) / 2;
    xlo = c - minHalf;
    xhi = c + minHalf;
  }
  if (spanY < 2 * minHalf) {
    const c = (ylo + yhi) / 2;
    ylo = c - minHalf;
    yhi = c + minHalf;
  }
  spanX = xhi - xlo;
  spanY = yhi - ylo;
  xlo -= pad * spanX;
  xhi += pad * spanX;
  ylo -= pad * spanY;
  yhi += pad * spanY;
  // Equal scale: widen the tighter direction.
  const k = Math.min(pw / (xhi - xlo), ph / (yhi - ylo));
  const cx = (xlo + xhi) / 2;
  const cy = (ylo + yhi) / 2;
  const x0 = cx - pw / k / 2;
  const x1 = cx + pw / k / 2;
  const y0 = cy - ph / k / 2;
  const y1 = cy + ph / k / 2;
  return {
    W,
    H,
    ML,
    MT,
    pw,
    ph,
    x0,
    x1,
    y0,
    y1,
    X: (v) => ML + (v - x0) * k,
    Y: (v) => MT + ph - (v - y0) * k,
  };
}

/** Liang-Barsky: the part of segment a-b inside the frame, in data units, or null. */
function clipSeg(F: Frame, a: Complex, b: Complex): [Complex, Complex] | null {
  if (![a.re, a.im, b.re, b.im].every(Number.isFinite)) return null;
  let t0 = 0;
  let t1 = 1;
  const dx = b.re - a.re;
  const dy = b.im - a.im;
  const tests: Array<[number, number]> = [
    [-dx, a.re - F.x0],
    [dx, F.x1 - a.re],
    [-dy, a.im - F.y0],
    [dy, F.y1 - a.im],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    { re: a.re + t0 * dx, im: a.im + t0 * dy },
    { re: a.re + t1 * dx, im: a.im + t1 * dy },
  ];
}

/** A polyline through data points, clipped to the frame, as one or more <polyline>s. */
function clippedPolyline(F: Frame, pts: Complex[], attrs: string): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length >= 2) out.push(`<polyline points="${run.join(" ")}" fill="none" ${attrs}/>`);
    run = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = clipSeg(F, pts[i], pts[i + 1]);
    if (!seg) {
      flush();
      continue;
    }
    const p0 = `${f(F.X(seg[0].re))},${f(F.Y(seg[0].im))}`;
    const p1 = `${f(F.X(seg[1].re))},${f(F.Y(seg[1].im))}`;
    if (!run.length) run.push(p0);
    else if (run[run.length - 1] !== p0) {
      flush();
      run.push(p0);
    }
    run.push(p1);
    // a segment that was cut at its far end leaves the frame: start a new run
    if (seg[1].re !== pts[i + 1].re || seg[1].im !== pts[i + 1].im) flush();
  }
  flush();
  return out.join("");
}

const inside = (F: Frame, z: Complex): boolean => z.re >= F.x0 && z.re <= F.x1 && z.im >= F.y0 && z.im <= F.y1;

/** Frame, grid, ticks and axis titles. */
function frameParts(F: Frame, title: string, xTitle: string, yTitle: string): string[] {
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${F.W}" height="${F.H}" viewBox="0 0 ${F.W} ${F.H}">`);
  p.push(`<rect width="${F.W}" height="${F.H}" fill="${PAPER}"/>`);
  p.push(text(F.ML + F.pw / 2, 15, title, { anchor: "middle", size: 11 }));
  const xa = linearAxis(F.x0, F.x1, { target: 6 });
  const ya = linearAxis(F.y0, F.y1, { target: 6 });
  xa.values.forEach((v) => {
    const x = F.X(v);
    p.push(`<line x1="${f(x)}" y1="${F.MT}" x2="${f(x)}" y2="${F.MT + F.ph}" stroke="${GRID}" stroke-width="0.6"/>`);
  });
  ya.values.forEach((v) => {
    const y = F.Y(v);
    p.push(`<line x1="${F.ML}" y1="${f(y)}" x2="${F.ML + F.pw}" y2="${f(y)}" stroke="${GRID}" stroke-width="0.6"/>`);
  });
  // The axes through the origin, when the origin is in view.
  if (F.x0 < 0 && F.x1 > 0) p.push(`<line x1="${f(F.X(0))}" y1="${F.MT}" x2="${f(F.X(0))}" y2="${F.MT + F.ph}" stroke="${RULE}" stroke-width="1"/>`);
  if (F.y0 < 0 && F.y1 > 0) p.push(`<line x1="${F.ML}" y1="${f(F.Y(0))}" x2="${F.ML + F.pw}" y2="${f(F.Y(0))}" stroke="${RULE}" stroke-width="1"/>`);
  p.push(`<rect x="${F.ML}" y="${F.MT}" width="${F.pw}" height="${F.ph}" fill="none" stroke="${RULE}"/>`);
  xa.values.forEach((v, i) => {
    const x = F.X(v);
    p.push(`<line x1="${f(x)}" y1="${F.MT + F.ph}" x2="${f(x)}" y2="${F.MT + F.ph + 3}" stroke="${RULE}"/>`);
    p.push(text(x, F.MT + F.ph + 13, xa.labels[i], { anchor: "middle", size: 8.5 }));
  });
  ya.values.forEach((v, i) => {
    const y = F.Y(v);
    p.push(`<line x1="${F.ML - 3}" y1="${f(y)}" x2="${F.ML}" y2="${f(y)}" stroke="${RULE}"/>`);
    p.push(text(F.ML - 5, y + 3, ya.labels[i], { anchor: "end", size: 8.5 }));
  });
  const xm = xa.multiplier ? ` (${xa.multiplier})` : "";
  const ym = ya.multiplier ? ` (${ya.multiplier})` : "";
  p.push(text(F.ML + F.pw / 2, F.MT + F.ph + 26, xTitle + xm, { anchor: "middle", size: 9.5 }));
  p.push(text(13, F.MT + F.ph / 2, yTitle + ym, { anchor: "middle", size: 9.5, rotate: true }));
  return p;
}

function cross(F: Frame, z: Complex, colour: string, r = 4): string {
  const x = F.X(z.re);
  const y = F.Y(z.im);
  return (
    `<line x1="${f(x - r)}" y1="${f(y - r)}" x2="${f(x + r)}" y2="${f(y + r)}" stroke="${colour}" stroke-width="1.8"/>` +
    `<line x1="${f(x - r)}" y1="${f(y + r)}" x2="${f(x + r)}" y2="${f(y - r)}" stroke="${colour}" stroke-width="1.8"/>`
  );
}
const ring = (F: Frame, z: Complex, colour: string): string =>
  `<circle cx="${f(F.X(z.re))}" cy="${f(F.Y(z.im))}" r="4.2" fill="${PAPER}" stroke="${colour}" stroke-width="1.6"/>`;
const dot = (F: Frame, z: Complex, colour: string, r = 3.4): string =>
  `<circle cx="${f(F.X(z.re))}" cy="${f(F.Y(z.im))}" r="${r}" fill="${colour}"/>`;
const square = (F: Frame, z: Complex, colour: string): string =>
  `<rect x="${f(F.X(z.re) - 3.4)}" y="${f(F.Y(z.im) - 3.4)}" width="6.8" height="6.8" fill="${colour}"/>`;
const diamond = (F: Frame, z: Complex, colour: string): string => {
  const x = F.X(z.re);
  const y = F.Y(z.im);
  return `<polygon points="${f(x)},${f(y - 4.6)} ${f(x + 4.6)},${f(y)} ${f(x)},${f(y + 4.6)} ${f(x - 4.6)},${f(y)}" fill="${colour}"/>`;
};

function keyBlock(F: Frame, lines: Array<{ t: string; fill?: string }>): string[] {
  const y0 = F.MT + F.ph + 42;
  return lines.map((l, i) => text(F.ML - 40, y0 + i * 13, l.t, { size: 8.5, fill: l.fill ?? INK }));
}

/** The longest line a key can carry at 8.5 px in this width. */
function fitKey(t: string): string {
  const max = Math.floor((S_PLANE_W - 20) / (8.5 * 0.58));
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Root locus
// ---------------------------------------------------------------------------

export function rootLocusSvg(rl: RootLocusResult): string {
  const features: Complex[] = [
    ...rl.poles,
    ...rl.zeros,
    ...(rl.centroid ? [{ re: Number(rl.centroid.n) / Number(rl.centroid.d), im: 0 }] : []),
    ...rl.breakaways.map((b) => b.s),
    ...rl.crossings.flatMap((c) => [{ re: 0, im: c.w }, { re: 0, im: -c.w }]),
    ...(rl.atK ? rl.atK.poles : []),
    { re: 0, im: 0 },
  ];
  const key: Array<{ t: string; fill?: string }> = [];
  key.push({ t: "× open-loop pole · ○ zero · ◆ jω crossing · ■ breakaway" + (rl.atK ? " · ● closed-loop pole at K" : "") });
  if (rl.crossings.length) {
    key.push({
      t: fitKey(
        "jω crossing: " +
          rl.crossings
            .slice(0, 3)
            .map((c) => `K = ${c.kExact ? ratPlain(c.kExact) : fmtShort(c.K)} at ω = ${fmtShort(c.w)} rad/s`)
            .join("; "),
      ),
      fill: RED,
    });
  }
  if (rl.breakaways.length) {
    key.push({
      t: fitKey(
        "breakaway / break-in: " +
          rl.breakaways
            .slice(0, 3)
            .map((b) => `s = ${fmtShort(b.s.re)}${Math.abs(b.s.im) > 0 ? ` ${b.s.im < 0 ? "−" : "+"} ${fmtShort(Math.abs(b.s.im))}j` : ""} (K = ${fmtShort(b.K)})`)
            .join("; "),
      ),
      fill: PURPLE,
    });
  }
  if (rl.centroid && rl.asymptoteAnglesDeg.length) {
    key.push({
      t: fitKey(
        `asymptotes (dashed) from σ = ${ratPlain(rl.centroid)} at ` + rl.asymptoteAnglesDeg.map((a) => `${fmtShort(a)}°`).join(", "),
      ),
    });
  }
  if (rl.atK) key.push({ t: `● closed-loop poles at K = ${ratPlain(rl.atK.K)}`, fill: GREEN });
  const F = equalFrame(features, key.length);
  const p = frameParts(F, "Root locus of 1 + K·G(s)H(s) = 0, K ≥ 0", "Re(s)", "Im(s)");

  // Real-axis segments, thick and pale, under everything.
  for (const s of rl.realSegments) {
    const a = { re: Math.max(s.from, F.x0 - 1), im: 0 };
    const b = { re: Math.min(s.to, F.x1 + 1), im: 0 };
    p.push(clippedPolyline(F, [a, b], `stroke="#93c5fd" stroke-width="5"`));
  }
  // Asymptotes from the centroid.
  if (rl.centroid) {
    const c = { re: Number(rl.centroid.n) / Number(rl.centroid.d), im: 0 };
    const far = 4 * Math.max(F.x1 - F.x0, F.y1 - F.y0);
    for (const a of rl.asymptoteAnglesDeg) {
      const th = (a * Math.PI) / 180;
      p.push(clippedPolyline(F, [c, { re: c.re + far * Math.cos(th), im: c.im + far * Math.sin(th) }], `stroke="#6b7280" stroke-width="1" stroke-dasharray="5 4"`));
    }
  }
  // Branches.
  for (const br of rl.branches) p.push(clippedPolyline(F, br, `stroke="${BLUE}" stroke-width="1.6"`));
  // Markers.
  for (const b of rl.breakaways) if (inside(F, b.s)) p.push(square(F, b.s, PURPLE));
  for (const c of rl.crossings) {
    for (const z of [{ re: 0, im: c.w }, { re: 0, im: -c.w }]) if (inside(F, z)) p.push(diamond(F, z, RED));
  }
  for (const z of rl.zeros) if (inside(F, z)) p.push(ring(F, z, INK));
  for (const z of rl.poles) if (inside(F, z)) p.push(cross(F, z, INK));
  if (rl.atK) for (const z of rl.atK.poles) if (inside(F, z)) p.push(dot(F, z, GREEN));
  p.push(...keyBlock(F, key));
  p.push("</svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------
// Nyquist
// ---------------------------------------------------------------------------

export function nyquistSvg(ny: NyquistResult): string {
  const curve = ny.curve.map((c) => ({ re: c.re, im: c.im }));
  // Frame: the −1 point and unit circle always; the curve where it is finite and not
  // racing to infinity at an imaginary-axis pole.
  let pts: Complex[] = [{ re: -1.25, im: 0 }, { re: 1.25, im: 0 }, { re: 0, im: 1.25 }, { re: 0, im: -1.25 }];
  let leaves = false;
  let cropNote: string[] = [];
  if (!ny.axisPoles.length) {
    // A high-gain loop (L(0) = 1000, say) would shrink the −1 point and the unit
    // circle to a pixel, and the margins are what this figure is for. The frame is
    // cropped to a few times the critical region when the curve is much larger.
    const mags = curve.map((z) => Math.hypot(z.re, z.im)).filter(Number.isFinite);
    const big = mags.length ? Math.max(...mags) : 1;
    const pcMag = ny.margins && ny.margins.gainMarginDb !== null ? Math.pow(10, -ny.margins.gainMarginDb / 20) : 0;
    if (big > 6.25) {
      // Frame the critical region: −1, the unit circle and (when it is not far off)
      // the phase-crossover point that sets the gain margin.
      const Rf = Math.max(2.5, 1.5 * Math.min(pcMag, 5));
      const kept = curve.filter((z) => Math.hypot(z.re, z.im) <= Rf);
      pts = pts.concat(kept, kept.map((z) => ({ re: z.re, im: -z.im })));
      leaves = true;
      cropNote = [`the frame is cropped around −1; the curve reaches |L| = ${fmtShort(big)}`];
      if (pcMag > Rf) cropNote.push(`it crosses the negative real axis at ${fmtShort(-pcMag)}, outside the frame`);
    } else {
      pts = pts.concat(curve, curve.map((z) => ({ re: z.re, im: -z.im })));
    }
  } else {
    const ref = ny.margins?.phaseCrossoverW ?? ny.margins?.gainCrossoverW ?? null;
    const nearPole = (w: number): boolean => ny.axisPoles.some((a) => Math.abs(w - a.w) < 0.5 * Math.max(a.w, ref ?? 1));
    const okPts = ny.curve.filter((c) => !nearPole(c.w) && (ref === null || c.w >= 0.15 * ref));
    const mags = okPts.map((c) => Math.hypot(c.re, c.im)).sort((a, b) => a - b);
    const cap = mags.length ? Math.min(mags[mags.length - 1], 50 * Math.max(1, mags[Math.floor(mags.length * 0.5)])) : 2;
    const kept = okPts.filter((c) => Math.hypot(c.re, c.im) <= cap);
    pts = pts.concat(kept.map((c) => ({ re: c.re, im: c.im })), kept.map((c) => ({ re: c.re, im: -c.im })));
    leaves = true;
  }
  const mg = ny.margins;
  const key: Array<{ t: string; fill?: string }> = [];
  key.push({ t: "solid: ω from 0⁺ to ∞ (arrows: ω rising) · dashed: the mirror, ω < 0", fill: BLUE });
  key.push({ t: "+ the −1 point · dotted circle: |L| = 1", fill: RED });
  if (mg && mg.phaseMarginDeg !== null && mg.gainCrossoverW !== null)
    key.push({ t: `● phase margin ${fmtShort(mg.phaseMarginDeg)}° at ω = ${fmtShort(mg.gainCrossoverW)} rad/s`, fill: GREEN });
  if (mg && mg.gainMarginDb !== null && mg.phaseCrossoverW !== null)
    key.push({ t: `● gain margin ${fmtShort(mg.gainMarginDb)} dB at ω = ${fmtShort(mg.phaseCrossoverW)} rad/s`, fill: ORANGE });
  const nz =
    ny.N !== null && ny.Z !== null
      ? `N = ${ny.N < 0 ? "−" + -ny.N : ny.N} encirclement(s) of −1, P = ${ny.P}, Z = N + P = ${ny.Z}`
      : `P = ${ny.P}; encirclements not counted (see the result text)`;
  key.push({ t: nz });
  if (leaves) {
    const ls = cropNote.length ? cropNote : ["the curve leaves the frame toward infinity near the imaginary-axis pole(s)"];
    for (const t of ls) key.push({ t: fitKey(t), fill: "#4b5563" });
  }

  const F = equalFrame(pts, key.length, { minHalf: 1.25, pad: 0.06 });
  const p = frameParts(F, "Nyquist plot of L(jω)", "Re L(jω)", "Im L(jω)");
  // Unit circle.
  const circ: Complex[] = [];
  for (let i = 0; i <= 160; i++) circ.push({ re: Math.cos((2 * Math.PI * i) / 160), im: Math.sin((2 * Math.PI * i) / 160) });
  p.push(clippedPolyline(F, circ, `stroke="#9ca3af" stroke-width="1" stroke-dasharray="2 3"`));
  // Mirror then the curve itself.
  p.push(clippedPolyline(F, curve.map((z) => ({ re: z.re, im: -z.im })), `stroke="#93c5fd" stroke-width="1.4" stroke-dasharray="5 3"`));
  p.push(clippedPolyline(F, curve, `stroke="${BLUE}" stroke-width="1.7"`));
  // Direction arrows on the solid branch, placed by drawn (pixel) arc length so they
  // land where the curve is visible rather than where the log-spaced samples bunch up.
  const px = curve.map((z) => ({ x: F.X(z.re), y: F.Y(z.im), in: inside(F, z) }));
  const cum: number[] = [0];
  for (let i = 1; i < px.length; i++) {
    const d = px[i].in && px[i - 1].in ? Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y) : 0;
    cum.push(cum[i - 1] + d);
  }
  const total = cum[cum.length - 1];
  if (total > 40) {
    for (const frac of [0.35, 0.72]) {
      const target = frac * total;
      const i = cum.findIndex((c) => c >= target);
      if (i <= 0 || i + 1 >= px.length || !px[i].in) continue;
      let j = i + 1;
      while (j + 1 < px.length && Math.hypot(px[j].x - px[i].x, px[j].y - px[i].y) < 4) j++;
      const dx = px[j].x - px[i].x;
      const dy = px[j].y - px[i].y;
      const len = Math.hypot(dx, dy);
      if (!(len > 0.5)) continue;
      const ux = dx / len;
      const uy = dy / len;
      const x = px[i].x;
      const y = px[i].y;
      p.push(
        `<polygon points="${f(x + 6 * ux)},${f(y + 6 * uy)} ${f(x - 4 * ux + 3.5 * uy)},${f(y - 4 * uy - 3.5 * ux)} ${f(x - 4 * ux - 3.5 * uy)},${f(y - 4 * uy + 3.5 * ux)}" fill="${BLUE}"/>`,
      );
    }
  }
  // The −1 point.
  p.push(
    `<line x1="${f(F.X(-1) - 5)}" y1="${f(F.Y(0))}" x2="${f(F.X(-1) + 5)}" y2="${f(F.Y(0))}" stroke="${RED}" stroke-width="2"/>` +
      `<line x1="${f(F.X(-1))}" y1="${f(F.Y(0) - 5)}" x2="${f(F.X(-1))}" y2="${f(F.Y(0) + 5)}" stroke="${RED}" stroke-width="2"/>`,
  );
  // Margin points.
  if (mg && mg.gainCrossoverW !== null) {
    const pmPt = ny.curve.reduce((best, c) => (Math.abs(c.w - mg.gainCrossoverW!) < Math.abs(best.w - mg.gainCrossoverW!) ? c : best), ny.curve[0]);
    if (pmPt) {
      const ang = Math.atan2(pmPt.im, pmPt.re);
      const z = { re: Math.cos(ang), im: Math.sin(ang) };
      if (inside(F, z)) p.push(dot(F, z, GREEN));
    }
  }
  if (mg && mg.gainMarginDb !== null) {
    const z = { re: -Math.pow(10, -mg.gainMarginDb / 20), im: 0 };
    if (inside(F, z)) p.push(dot(F, z, ORANGE));
  }
  p.push(...keyBlock(F, key));
  p.push("</svg>");
  return p.join("");
}

// ---------------------------------------------------------------------------
// z-plane
// ---------------------------------------------------------------------------

export function zPlaneSvg(r: C2dResult): string {
  const pts: Complex[] = [{ re: -1.15, im: -1.15 }, { re: 1.15, im: 1.15 }, ...r.poles, ...r.zeros];
  const key: Array<{ t: string; fill?: string }> = [
    { t: "× discrete pole · ○ zero · dotted circle: |z| = 1 (stability boundary)" },
    { t: `largest |z| of a pole = ${fmtSig(r.maxPoleMag, 4)}`, fill: r.maxPoleMag < 1 && !r.onCircle ? GREEN : RED },
  ];
  const F = equalFrame(pts, key.length, { minHalf: 1.15, pad: 0.05 });
  const p = frameParts(F, `Discrete poles and zeros, T = ${fmtShort(r.T)} s`, "Re(z)", "Im(z)");
  const circ: Complex[] = [];
  for (let i = 0; i <= 160; i++) circ.push({ re: Math.cos((2 * Math.PI * i) / 160), im: Math.sin((2 * Math.PI * i) / 160) });
  p.push(clippedPolyline(F, circ, `stroke="#6b7280" stroke-width="1.1" stroke-dasharray="2 3"`));
  for (const z of r.zeros) if (inside(F, z)) p.push(ring(F, z, INK));
  for (const z of r.poles) if (inside(F, z)) p.push(cross(F, z, Math.hypot(z.re, z.im) > 1 + 1e-9 ? RED : INK));
  p.push(...keyBlock(F, key));
  p.push("</svg>");
  return p.join("");
}
