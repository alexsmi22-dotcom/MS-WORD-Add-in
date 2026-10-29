// Figures for the VFX & compositing calculators (vfxCalcs.ts): the time-warp curve and its speed, the shot timeline
// with handles, sensor field-of-view wedges, the top-down projection/parallax diagram, axes before and after a
// transform, the shading vector diagram, camera log curves, compositing swatches and channel bars, the chroma-key
// CbCr plane, the Froude/CFL scale chart and the bouncing drop.
// Colours are literal hex (inserted artwork never follows the pane's theme); labels keep the display contract (U+2212,
// no e-notation), and every text box is placed so the layout audit finds no collision, strike-through or clipping.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import type { RetimeResult, FrameRangeResult } from "./vfxTime";

const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#888888";
const LIGHT = "#d9d9d9";
const INK = "#111111";
const ORANGE = "#d46a00";
const PURPLE = "#6a3d9a";
const PAPER = "#ffffff";

const W = 460;
const H = Math.round(W * 0.66);

/** 4 significant figures, trailing zeros dropped, U+2212 (a label, not a measurement). */
export const sig = (v: number, n = 4): string =>
  fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

const esc = (s: string): string => trueMinus(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The layout audit's own width estimate (0.58 em per glyph), so a label placed by it is never judged too wide. */
const textW = (s: string, size: number): number => [...s].length * 0.58 * size;
const f1 = (v: number): string => v.toFixed(1);
/** A label shortened (with an ellipsis) to fit a width, by the audit's own width estimate. */
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textW(s, size) <= maxW) return s;
  const chars = [...s];
  const keep = Math.max(1, Math.floor(maxW / (0.58 * size)) - 1);
  return chars.slice(0, keep).join("") + "…";
};

function svgOpen(w: number, h: number, size = 10): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${PAPER}"/>`,
    `<g font-family="Arial, sans-serif" font-size="${size}" fill="${INK}">`,
  ];
}
const text = (x: number, y: number, s: string, anchor: "start" | "middle" | "end" = "start", extra = ""): string =>
  `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`;

// ---------------------------------------------------------------------------------------------------------------
// Retime
// ---------------------------------------------------------------------------------------------------------------

/** Output frame against source frame: the warp, the 100 % line for reference, and the frames that land between frames. */
export function retimeWarpSvg(r: RetimeResult): string {
  const pts = r.frames.map((f) => ({ x: f.out, y: f.src }));
  const x0 = r.frames[0].out;
  const x1 = r.frames[r.frames.length - 1].out;
  const ys = pts.map((p) => p.y).concat([r.first, r.last]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const series: Series[] = [{ points: pts, type: "line", color: BLUE, label: "source frame shown" }];
  // The 100 % reference over the same output span, from the first source frame (or the last, for a reverse).
  const startY = r.constant !== null && r.constant < 0 ? r.last : r.first;
  const dir = r.constant !== null && r.constant < 0 ? -1 : 1;
  const refEnd = Math.min(x1, x0 + (r.last - r.first));
  series.push({ points: [{ x: x0, y: startY }, { x: refEnd, y: startY + dir * (refEnd - x0) }], type: "line", color: GREY, label: "100 % (no retime)" });
  if (r.frames.length <= 240) {
    const between = r.frames.filter((f) => f.status === "between").map((f) => ({ x: f.out, y: f.src }));
    if (between.length) series.push({ points: between, type: "scatter", color: ORANGE, label: "between frames" });
    const outside = r.frames.filter((f) => f.status === "outside").map((f) => ({ x: f.out, y: f.src }));
    if (outside.length) series.push({ points: outside, type: "scatter", color: RED, label: "outside the source" });
  }
  const pad = Math.max(1, (yMax - yMin) * 0.05);
  return buildPlotSvg(series, {
    xlabel: "Output frame",
    ylabel: "Source frame",
    xLimits: { min: x0, max: x1 > x0 ? x1 : x0 + 1 },
    yLimits: { min: Math.floor(yMin - pad), max: Math.ceil(yMax + pad) },
    width: W,
    height: H,
  });
}

/** Speed (%) against output frame, with 100 % for reference and the keys marked. */
export function retimeSpeedSvg(r: RetimeResult): string {
  const pts = r.frames.map((f) => ({ x: f.out, y: f.speed }));
  const x0 = r.frames[0].out;
  const x1 = r.frames[r.frames.length - 1].out;
  const series: Series[] = [
    { points: pts, type: "line", color: PURPLE, label: "speed" },
    { points: [{ x: x0, y: 100 }, { x: x1 > x0 ? x1 : x0 + 1, y: 100 }], type: "line", color: GREY, label: "100 %" },
  ];
  if (r.mode === "ramp" && r.curve) {
    const keys = r.curve.keys.filter((k) => k[0] >= x0 && k[0] <= x1).map((k) => ({ x: k[0], y: k[1] }));
    if (keys.length) series.push({ points: keys, type: "scatter", color: RED, label: "speed keys" });
  }
  const ys = pts.map((p) => p.y).concat([100, 0]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = Math.max(5, (hi - lo) * 0.08);
  return buildPlotSvg(series, {
    xlabel: "Output frame",
    ylabel: "Speed (%)",
    xLimits: { min: x0, max: x1 > x0 ? x1 : x0 + 1 },
    yLimits: { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) },
    width: W,
    height: Math.round(H * 0.8),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Shot timeline
// ---------------------------------------------------------------------------------------------------------------

/** The plate as a bar: head handle, cut, tail handle, frame numbers at each boundary, the file pattern beneath. */
export function timelineSvg(r: FrameRangeResult, head: number, tail: number, pattern: string, editorial: string): string {
  const w = W;
  const left = 16;
  const right = w - 16;
  const span = right - left;
  // Proportional widths, a handle given at least 36 px so its label has room.
  const minH = 36;
  let hw = head > 0 ? Math.max(minH, (span * head) / r.total) : 0;
  let tw = tail > 0 ? Math.max(minH, (span * tail) / r.total) : 0;
  if (hw + tw > span * 0.6) {
    const s = (span * 0.6) / (hw + tw);
    hw *= s;
    tw *= s;
  }
  const cw = span - hw - tw;
  const yBar = 44;
  const hBar = 26;
  const out = svgOpen(w, 160);
  out.push(text(w / 2, 16, fitText(`Plate ${r.plateFirst} to ${r.plateLast} (${r.total} frames)`, 11, span), "middle", ' font-size="11"'));
  if (hw > 0) out.push(`<rect x="${f1(left)}" y="${yBar}" width="${f1(hw)}" height="${hBar}" fill="${LIGHT}" stroke="${GREY}"/>`);
  out.push(`<rect x="${f1(left + hw)}" y="${yBar}" width="${f1(cw)}" height="${hBar}" fill="${BLUE}" stroke="${BLUE}"/>`);
  if (tw > 0) out.push(`<rect x="${f1(left + hw + cw)}" y="${yBar}" width="${f1(tw)}" height="${hBar}" fill="${LIGHT}" stroke="${GREY}"/>`);
  const mid = yBar + hBar / 2 + 3.5;
  const inLabel = (x: number, width: number, s: string, fill: string): void => {
    if (textW(s, 9) + 4 <= width) out.push(text(x + width / 2, mid, s, "middle", ` font-size="9" fill="${fill}"`));
  };
  if (hw > 0) inLabel(left, hw, `${head}`, INK);
  inLabel(left + hw, cw, `cut ${r.cutLength}`, PAPER);
  if (tw > 0) inLabel(left + hw + cw, tw, `${tail}`, INK);
  // Cut numbers above the bar (when the cut is wide enough for both), plate numbers below it.
  const a = `${r.cutFirst}`;
  const b = `${r.cutLast}`;
  if (textW(a, 9) + textW(b, 9) + 8 <= cw) {
    out.push(text(left + hw, yBar - 6, a, "start", ' font-size="9" fill="#1f5fa8"'));
    out.push(text(left + hw + cw, yBar - 6, b, "end", ' font-size="9" fill="#1f5fa8"'));
  }
  out.push(text(left, yBar + hBar + 14, `${r.plateFirst}`, "start", ' font-size="9"'));
  out.push(text(right, yBar + hBar + 14, `${r.plateLast}`, "end", ' font-size="9"'));
  out.push(text(left, 112, fitText(`Cut ${r.cutFirst} to ${r.cutLast} in the plate; handles ${head} head, ${tail} tail.`, 9, span), "start", ' font-size="9"'));
  out.push(text(left, 128, fitText(editorial, 9, span), "start", ' font-size="9"'));
  out.push(text(left, 144, fitText(pattern, 9, span), "start", ' font-size="9"'));
  out.push("</g></svg>");
  return out.join("");
}

export { BLUE, RED, GREEN, GREY, LIGHT, INK, ORANGE, PURPLE, PAPER, W, H, esc, textW, f1, svgOpen, text };
