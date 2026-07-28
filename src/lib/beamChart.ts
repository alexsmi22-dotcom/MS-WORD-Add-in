// Shear-force and bending-moment diagrams, drawn to go into a document.
//
// Three panels sharing one x axis: the loaded beam, then V(x), then M(x). The
// shared axis is the point — a shear diagram is read by looking at where it
// crosses zero and finding the same x on the moment diagram, and that only
// works if the two are drawn to the same scale and aligned. Panels drawn
// separately and stacked by the caller never line up.
//
// Colours are literal hex, never a CSS variable or the inherited-colour keyword:
// this artwork is inserted into a Word document as line art and must not follow
// the pane's theme. `insertedFiguresIgnoreTheme.test.ts` enforces it by scanning
// the SOURCE, so this comment may not name the keyword either - the first draft
// did, and failed its own rule.
//
// THE SHEAR DIAGRAM IS DISCONTINUOUS at a point load and at a support, and
// drawing it as a polyline through evenly spaced samples rounds those jumps off
// into ramps — which reads as a distributed load that is not there. Every
// breakpoint is therefore sampled on BOTH sides so the vertical step is drawn
// as a vertical step.

import { BeamResult, Load, Support } from "./beam";

const W = 420;
const PANEL_H = 96;
const BEAM_H = 78;
const ML = 46;
const MR = 16;
const GAP = 16;

const INK = "#111111";
const RULE = "#888888";
const FILL_V = "#cfe3f3";
const FILL_M = "#f6dfc8";
const LOAD = "#333333";
const PAPER = "#ffffff";

export interface BeamChartInput {
  result: BeamResult;
  supports: Support[];
  loads: Load[];
  /** Units shown on the axes, e.g. "kN" and "kN·m". */
  forceUnit?: string;
  momentUnit?: string;
  lengthUnit?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toPrecision(4)));
};

/** Samples of f across the beam, with both sides of every breakpoint. */
function sample(f: (x: number) => number, L: number, breaks: number[], n = 240): { x: number; y: number }[] {
  const eps = Math.max(L * 1e-9, Number.MIN_VALUE);
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) xs.push((L * i) / n);
  for (const b of breaks) {
    if (b > 0) xs.push(b - eps);
    if (b < L) xs.push(b + eps);
    xs.push(b);
  }
  xs.sort((a, b) => a - b);
  return xs.map((x) => ({ x, y: f(x) }));
}

export function beamDiagramSvg(input: BeamChartInput): string {
  const { result, supports, loads } = input;
  const L = result.length;
  const fu = input.forceUnit ?? "";
  const mu = input.momentUnit ?? "";
  const lu = input.lengthUnit ?? "";

  const pw = W - ML - MR;
  const H = BEAM_H + GAP + PANEL_H + GAP + PANEL_H + 34;
  const sx = (x: number): number => ML + (L > 0 ? (x / L) * pw : 0);

  const vs = sample(result.shearAt, L, result.breakpoints);
  const ms = sample(result.momentAt, L, result.breakpoints);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto" role="img">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
  parts.push(`<g font-family="sans-serif" font-size="9" fill="${INK}">`);

  // ---- panel 1: the beam, its supports and its loads ----
  const beamY = 46;
  parts.push(drawBeam(beamY, sx, L, supports, loads, lu));

  // ---- panel 2: shear ----
  const vTop = BEAM_H + GAP;
  parts.push(drawPanel(vs, vTop, PANEL_H, sx, `Shear V${fu ? ` (${fu})` : ""}`, FILL_V));
  parts.push(annotate(result.maxShear.x, result.maxShear.value, vs, vTop, PANEL_H, sx, fu));

  // ---- panel 3: moment ----
  const mTop = vTop + PANEL_H + GAP;
  parts.push(drawPanel(ms, mTop, PANEL_H, sx, `Moment M${mu ? ` (${mu})` : ""}`, FILL_M));
  const gov = Math.abs(result.minMoment.value) > Math.abs(result.maxMoment.value) ? result.minMoment : result.maxMoment;
  parts.push(annotate(gov.x, gov.value, ms, mTop, PANEL_H, sx, mu));

  // ---- x axis ----
  const axisY = mTop + PANEL_H + 14;
  parts.push(`<line x1="${ML}" y1="${axisY}" x2="${ML + pw}" y2="${axisY}" stroke="${RULE}" stroke-width="1"/>`);
  for (const b of result.breakpoints) {
    const x = sx(b);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${axisY + 4}" stroke="${RULE}"/>`);
    parts.push(
      `<text x="${x.toFixed(1)}" y="${axisY + 14}" text-anchor="middle" font-size="8" fill="${INK}">${esc(fmt(b))}</text>`,
    );
  }
  parts.push(
    `<text x="${ML + pw / 2}" y="${axisY + 26}" text-anchor="middle" font-size="9" fill="${INK}">x${lu ? ` (${lu})` : ""}</text>`,
  );

  parts.push(`</g></svg>`);
  return parts.join("");
}

function drawBeam(
  y: number,
  sx: (x: number) => number,
  L: number,
  supports: Support[],
  loads: Load[],
  lu: string,
): string {
  const p: string[] = [];
  const x0 = sx(0);
  const x1 = sx(L);
  p.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${INK}" stroke-width="2.5"/>`);

  for (const s of supports) {
    const x = sx(num(s.x));
    if (s.kind === "fixed") {
      // A hatched wall, drawn on whichever side the support sits.
      const dir = x - x0 < x1 - x ? -1 : 1;
      p.push(`<line x1="${x}" y1="${y - 13}" x2="${x}" y2="${y + 13}" stroke="${INK}" stroke-width="2"/>`);
      for (let i = -12; i <= 12; i += 5)
        p.push(
          `<line x1="${x}" y1="${y + i}" x2="${x + dir * 6}" y2="${y + i + 5}" stroke="${INK}" stroke-width="1"/>`,
        );
    } else {
      p.push(`<polygon points="${x},${y} ${x - 7},${y + 12} ${x + 7},${y + 12}" fill="${PAPER}" stroke="${INK}"/>`);
      if (s.kind === "roller") {
        p.push(`<circle cx="${x - 4}" cy="${y + 15}" r="2.5" fill="${PAPER}" stroke="${INK}"/>`);
        p.push(`<circle cx="${x + 4}" cy="${y + 15}" r="2.5" fill="${PAPER}" stroke="${INK}"/>`);
      } else {
        p.push(`<line x1="${x - 9}" y1="${y + 13}" x2="${x + 9}" y2="${y + 13}" stroke="${INK}"/>`);
      }
    }
  }

  for (const l of loads) {
    if (l.kind === "point") {
      const x = sx(num(l.x));
      p.push(arrow(x, y - 26, x, y - 3));
      p.push(`<text x="${x}" y="${y - 30}" text-anchor="middle" font-size="8.5">${esc(fmt(num(l.p)))}</text>`);
    } else if (l.kind === "moment") {
      const x = sx(num(l.x));
      p.push(
        `<path d="M ${x - 9} ${y - 12} A 9 9 0 1 1 ${x + 9} ${y - 12}" fill="none" stroke="${LOAD}" stroke-width="1.4"/>`,
      );
      p.push(`<text x="${x}" y="${y - 24}" text-anchor="middle" font-size="8.5">${esc(fmt(num(l.m)))}</text>`);
    } else {
      const a = sx(num(l.a));
      const b = sx(num(l.b));
      const w1 = l.kind === "udl" ? num(l.w) : num(l.w1);
      const w2 = l.kind === "udl" ? num(l.w) : num(l.w2);
      const peak = Math.max(Math.abs(w1), Math.abs(w2), 1e-12);
      // Baseline 3 is exactly the beam surface, so an intensity of ZERO draws
      // with zero thickness. A minimum height here would put visible load at the
      // tip of a triangular load, which is the one place there is none — and a
      // reader takes that as a small uniform load plus a taper.
      const hgt = (w: number) => 3 + 19 * (Math.abs(w) / peak);
      p.push(
        `<path d="M ${a} ${y - hgt(w1)} L ${b} ${y - hgt(w2)} L ${b} ${y - 3} L ${a} ${y - 3} Z" fill="none" stroke="${LOAD}" stroke-width="1.2"/>`,
      );
      const n = Math.max(2, Math.min(9, Math.round((b - a) / 18)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = a + (b - a) * t;
        p.push(arrow(x, y - (hgt(w1) + (hgt(w2) - hgt(w1)) * t), x, y - 3, 0.9));
      }
      const label = w1 === w2 ? fmt(w1) : `${fmt(w1)} → ${fmt(w2)}`;
      p.push(`<text x="${(a + b) / 2}" y="${y - 28}" text-anchor="middle" font-size="8.5">${esc(label)}</text>`);
    }
  }

  p.push(
    `<text x="${(x0 + x1) / 2}" y="${y + 32}" text-anchor="middle" font-size="8.5" fill="${RULE}">L = ${esc(fmt(L))}${lu ? ` ${lu}` : ""}</text>`,
  );
  return p.join("");
}

function arrow(x1: number, y1: number, x2: number, y2: number, sw = 1.2): string {
  return (
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${LOAD}" stroke-width="${sw}"/>` +
    `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${(x2 - 2.6).toFixed(1)},${(y2 - 5).toFixed(1)} ${(x2 + 2.6).toFixed(1)},${(y2 - 5).toFixed(1)}" fill="${LOAD}"/>`
  );
}

function drawPanel(
  pts: { x: number; y: number }[],
  top: number,
  h: number,
  sx: (x: number) => number,
  label: string,
  fill: string,
): string {
  const p: string[] = [];
  const vals = pts.map((q) => q.y).filter((v) => Number.isFinite(v));
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi === lo) {
    hi = 1;
    lo = -1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const sy = (v: number): number => top + h - ((v - lo) / (hi - lo)) * h;
  const zero = sy(0);

  const d = pts.map((q, i) => `${i ? "L" : "M"} ${sx(q.x).toFixed(1)} ${sy(q.y).toFixed(1)}`).join(" ");
  const area = `${d} L ${sx(pts[pts.length - 1].x).toFixed(1)} ${zero.toFixed(1)} L ${sx(pts[0].x).toFixed(1)} ${zero.toFixed(1)} Z`;
  p.push(`<path d="${area}" fill="${fill}" stroke="none"/>`);
  p.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.4"/>`);
  p.push(
    `<line x1="${sx(pts[0].x).toFixed(1)}" y1="${zero.toFixed(1)}" x2="${sx(pts[pts.length - 1].x).toFixed(1)}" y2="${zero.toFixed(1)}" stroke="${RULE}" stroke-width="1"/>`,
  );
  p.push(`<text x="${ML}" y="${(top - 3).toFixed(1)}" font-size="9" fill="${INK}">${esc(label)}</text>`);
  return p.join("");
}

/** Marks the governing value with a leader, since that is the number being looked for. */
function annotate(
  x: number,
  v: number,
  pts: { x: number; y: number }[],
  top: number,
  h: number,
  sx: (x: number) => number,
  unit: string,
): string {
  if (!Number.isFinite(v) || v === 0) return "";
  const vals = pts.map((q) => q.y).filter((n) => Number.isFinite(n));
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi === lo) return "";
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const py = top + h - ((v - lo) / (hi - lo)) * h;
  const px = sx(x);
  // Normally the label sits outside the curve — above a positive peak, below a
  // negative one. But a peak that reaches the top of its panel puts the label
  // straight through the panel TITLE, which is what a constant-shear cantilever
  // does: V is flat at its maximum for the whole span, so the "peak" is at the
  // very top left, exactly where "Shear V (kN)" is drawn. When that happens the
  // label goes on the inside instead.
  const above = v >= 0;
  const collidesWithTitle = above && py - top < 12;
  const ty = collidesWithTitle ? py + 11 : above ? py - 4 : py + 10;
  const anchor = px > W - 90 ? "end" : px < ML + 40 ? "start" : "middle";
  return (
    `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.4" fill="${INK}"/>` +
    `<text x="${px.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" font-size="8.5" fill="${INK}">${esc(fmt(v))}${unit ? ` ${unit}` : ""}</text>`
  );
}

/** Loads and supports carry exact rationals; the drawing needs numbers. */
function num(r: { n: bigint; d: bigint }): number {
  return Number(r.n) / Number(r.d);
}
