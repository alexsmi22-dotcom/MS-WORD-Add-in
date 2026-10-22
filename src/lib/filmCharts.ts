// The polarisation-ellipse figure for the Jones calculator.
//
// The trace is DRAWN FROM THE JONES VECTOR ITSELF, not from the fitted ellipse
// parameters: the tip of Re{(Ex, Ey)·exp(−iωt)} over one period, so the shape,
// the tilt and the direction of the arrow are all the field's own. Equal x and
// y scales are mandatory (a general plotter that fits each axis would draw a
// circle as an ellipse), which is why this is a small builder of its own.
//
// View: looking INTO the beam (the beam travels toward the viewer), x to the
// right and y up; counter-clockwise is right-handed in the IEEE convention
// jones.ts states. Literal hex colours, Arial, as the other inserted figures.

import type { JonesVec } from "./jones";

const FONT = "Arial, Helvetica, sans-serif";

export interface EllipsePanel {
  title: string;
  vec: JonesVec;
  /** Lines of text under the drawing (already display-contract clean). */
  lines: string[];
  colour: string;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f = (v: number): string => (Math.abs(v) < 5e-4 ? "0" : v.toFixed(2));

export const ELLIPSE_PANEL_W = 210;
export const ELLIPSE_FIG_H = 262;

/** One or two polarisation ellipses side by side, each normalised to its own amplitude. */
export function polarisationEllipseSvg(panels: EllipsePanel[]): string {
  const PW = ELLIPSE_PANEL_W;
  const H = ELLIPSE_FIG_H;
  const W = PW * Math.max(1, panels.length);
  const R = 68;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  panels.forEach((p, i) => {
    const cxp = i * PW + PW / 2;
    const cyp = 128;
    parts.push(
      `<text x="${f(cxp)}" y="20" font-family="${FONT}" font-size="12" font-weight="bold" fill="#111111" text-anchor="middle">${esc(p.title)}</text>`,
    );
    const [ex, ey] = p.vec;
    // The CALLER decides darkness (filmCalcs passes a zero vector below jones.ts DARK, the threshold its text uses);
    // any non-zero vector is drawn normalised, however faint. Scaled first so a 1e-200 amplitude cannot underflow.
    const big = Math.max(Math.abs(ex.re), Math.abs(ex.im), Math.abs(ey.re), Math.abs(ey.im));
    const amp = big > 0 && Number.isFinite(big) ? big * Math.hypot(ex.re / big, ex.im / big, ey.re / big, ey.im / big) : 0;
    // With no light there is nothing to draw against, so the axes are left out too (and no text crosses them).
    if (amp > 0) {
      // Axes and the unit reference circle.
      parts.push(`<circle cx="${f(cxp)}" cy="${cyp}" r="${R}" fill="none" stroke="#d1d5db" stroke-width="1" stroke-dasharray="3 3"/>`);
      parts.push(`<line x1="${f(cxp - R - 12)}" y1="${cyp}" x2="${f(cxp + R + 12)}" y2="${cyp}" stroke="#9ca3af" stroke-width="1"/>`);
      parts.push(`<line x1="${f(cxp)}" y1="${cyp + R + 12}" x2="${f(cxp)}" y2="${cyp - R - 12}" stroke="#9ca3af" stroke-width="1"/>`);
      parts.push(`<text x="${f(cxp + R + 16)}" y="${cyp + 4}" font-family="${FONT}" font-size="11" fill="#4b5563">x</text>`);
      parts.push(`<text x="${f(cxp + 5)}" y="${cyp - R - 14}" font-family="${FONT}" font-size="11" fill="#4b5563">y</text>`);
    }
    if (!(amp > 0)) {
      parts.push(
        `<text x="${f(cxp)}" y="${cyp - 6}" font-family="${FONT}" font-size="12" fill="#b91c1c" text-anchor="middle">no light</text>`,
        `<text x="${f(cxp)}" y="${cyp + 10}" font-family="${FONT}" font-size="12" fill="#b91c1c" text-anchor="middle">transmitted</text>`,
      );
    } else {
      // Normalised so the larger semi-axis fills most of the reference circle.
      const at = (t: number): [number, number] => [
        (ex.re * Math.cos(t) + ex.im * Math.sin(t)) / amp,
        (ey.re * Math.cos(t) + ey.im * Math.sin(t)) / amp,
      ];
      let maxR = 0;
      let tMax = 0;
      const pts: [number, number][] = [];
      for (let k = 0; k <= 180; k++) {
        const t = (2 * Math.PI * k) / 180;
        const q = at(t);
        pts.push(q);
        const r = Math.hypot(q[0], q[1]);
        if (r > maxR) {
          maxR = r;
          tMax = t;
        }
      }
      const sc = (R * 0.92) / Math.max(maxR, 1e-12);
      const X = (q: [number, number]): string => f(cxp + q[0] * sc);
      const Y = (q: [number, number]): string => f(cyp - q[1] * sc);
      const d = pts.map((q, k) => `${k === 0 ? "M" : "L"}${X(q)},${Y(q)}`).join(" ") + " Z";
      parts.push(`<path d="${d}" fill="none" stroke="${p.colour}" stroke-width="2"/>`);
      // The rotation arrow at a quarter period past the major-axis end, where the
      // tangent is along the major axis direction of travel. For a linear state
      // the tip only oscillates, so it gets no arrow.
      const st = stokesLike(p.vec);
      if (Math.abs(st) > 1e-6) {
        const t0 = tMax + Math.PI / 2;
        const a0 = at(t0);
        const a1 = at(t0 + 0.08);
        const x0 = cxp + a0[0] * sc;
        const y0 = cyp - a0[1] * sc;
        const dx = (a1[0] - a0[0]) * sc;
        const dy = -(a1[1] - a0[1]) * sc;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L;
        const uy = dy / L;
        const tipX = x0 + ux * 7;
        const tipY = y0 + uy * 7;
        const bx = x0 - ux * 4;
        const by = y0 - uy * 4;
        parts.push(
          `<polygon points="${f(tipX)},${f(tipY)} ${f(bx - uy * 5)},${f(by + ux * 5)} ${f(bx + uy * 5)},${f(by - ux * 5)}" fill="${p.colour}"/>`,
        );
      } else {
        // Linear: mark both ends of the oscillation.
        const e0 = at(tMax);
        parts.push(`<circle cx="${X(e0)}" cy="${Y(e0)}" r="3" fill="${p.colour}"/>`);
        const e1: [number, number] = [-e0[0], -e0[1]];
        parts.push(`<circle cx="${X(e1)}" cy="${Y(e1)}" r="3" fill="${p.colour}"/>`);
      }
    }
    p.lines.slice(0, 2).forEach((ln, k) => {
      parts.push(
        `<text x="${f(cxp)}" y="${226 + k * 16}" font-family="${FONT}" font-size="11" fill="#111111" text-anchor="middle">${esc(ln)}</text>`,
      );
    });
  });
  if (panels.length > 1) {
    for (let i = 1; i < panels.length; i++) {
      parts.push(`<line x1="${i * PW}" y1="34" x2="${i * PW}" y2="${H - 44}" stroke="#e5e7eb" stroke-width="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** S3 / S0, the sign of rotation. */
function stokesLike(v: JonesVec): number {
  const [a, b] = v;
  const s0 = a.re * a.re + a.im * a.im + b.re * b.re + b.im * b.im;
  return s0 > 0 ? (2 * (a.re * b.im - a.im * b.re)) / s0 : 0;
}
