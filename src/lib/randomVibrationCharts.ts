// Figures for the Release E vibration calculators (randomVibration.ts): the PSD profile on log-log axes with its
// breakpoints and the SDOF response PSD, the base-excitation transmissibility against r with the operating point,
// and the shaft's first mode shape over a ladder of critical speeds with the operating speed and the ±20 % bands.
// Colours are literal hex (inserted artwork never follows the pane's theme); Arial, as engCharts2026.ts.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig, linearAxis } from "./axis";
import { transmissibility } from "./vibration";
import { asdAt, transmissibilityCurve, type PsdProfile } from "./randomVibration";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000", weight = ""): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}"${weight ? ` font-weight="${weight}"` : ""}>${esc(t)}</text>`;

/** 4 significant figures, trailing zeros dropped (a label, not a measurement). */
const sig = (v: number, n = 4): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

export const PSD_CHART_WIDTH = 460;

/** The decade at or below v/1.2 (a little room under the lowest point). */
const decadeBelow = (v: number): number => Math.pow(10, Math.floor(Math.log10(v / 1.2)));

/**
 * The PSD profile (black, breakpoints marked) on log-log axes; with an SDOF (fn, ζ) the response PSD T²·ASD (blue)
 * and fn marked on the profile (red). Grms of each in the legend.
 */
export function psdChartSvg(p: PsdProfile, sdof?: { fn: number; zeta: number; grms: number }, width = PSD_CHART_WIDTH): string {
  const series: Series[] = [
    { points: p.points.map(([x, y]) => ({ x, y })), type: "line", color: "#000000", label: `Input, ${sig(p.grms)} g rms` },
    { points: p.points.map(([x, y]) => ({ x, y })), type: "scatter", color: "#000000" },
  ];
  let yFloor: number | undefined;
  if (sdof) {
    const lo = p.points[0][0], hi = p.points[p.points.length - 1][0];
    const xs: number[] = [];
    for (let i = 0; i <= 400; i++) xs.push(lo * Math.pow(hi / lo, i / 400));
    const band = Math.max(4 * sdof.zeta, 0.002);
    for (let i = 0; i <= 120; i++) {
      const x = sdof.fn * Math.exp(-band + (2 * band * i) / 120);
      if (x > lo && x < hi) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    const resp = xs.map((x) => {
      const t = transmissibility(x / sdof.fn, sdof.zeta);
      return { x, y: t * t * (asdAt(p, x) ?? NaN) };
    }).filter((q) => q.y > 0 && Number.isFinite(q.y));
    // The response rolls off as r⁻⁴; below a hundredth of the lowest input level it only stretches the axis and
    // squashes the profile. The curve is cut exactly where it crosses that floor (interpolated in log-log), so it runs
    // to the frame rather than stopping short.
    const floor = Math.min(...p.points.map(([, y]) => y)) / 100;
    const cut: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < resp.length; i++) {
      const q = resp[i];
      if (q.y >= floor) cut.push(q);
      else {
        const prev = resp[i - 1];
        if (prev && prev.y >= floor) {
          const t = Math.log(floor / prev.y) / Math.log(q.y / prev.y);
          cut.push({ x: prev.x * Math.pow(q.x / prev.x, t), y: floor });
        }
        const next = resp[i + 1];
        if (next && next.y >= floor) {
          const t = Math.log(floor / q.y) / Math.log(next.y / q.y);
          cut.push({ x: q.x * Math.pow(next.x / q.x, t), y: floor });
        }
      }
    }
    if (cut.some((q) => q.y === floor)) yFloor = floor;
    series.push({ points: cut, type: "line", color: "#1f5fa8", label: `Response, ${sig(sdof.grms)} g rms` });
    const a = asdAt(p, sdof.fn);
    if (a !== null) series.push({ points: [{ x: sdof.fn, y: a }], type: "scatter", color: "#c00000", label: `fn = ${sig(sdof.fn)} Hz` });
  }
  const allY = series.flatMap((q) => q.points.map((pt) => pt.y));
  return buildPlotSvg(series, {
    xlabel: "Frequency (Hz)",
    ylabel: "ASD (g²/Hz)",
    xScale: "log",
    yScale: "log",
    // A little room either side so the end breakpoints are not cut in half by the frame.
    xLimits: { min: p.points[0][0] / 1.15, max: p.points[p.points.length - 1][0] * 1.15 },
    // The response case runs from its cut floor to twice its peak; a profile alone spans whole decades, so a profile
    // inside one decade still gets three labelled ticks rather than two linear-looking ones.
    yLimits: sdof
      ? { min: yFloor ?? decadeBelow(Math.min(...allY)), max: 2 * Math.max(...allY) }
      : { min: decadeBelow(Math.min(...allY)), max: Math.pow(10, Math.ceil(Math.log10(Math.max(...allY) * 1.2))) },
    width,
    height: Math.round(width * 0.66),
  });
}

/** Absolute transmissibility T against r (log-log), T = 1 and r = √2 drawn, the operating point marked. */
export function transmissibilityChartSvg(zeta: number, rOp: number, width = 440): string {
  const lo = Math.min(0.1, rOp / 2), hi = Math.max(10, rOp * 2);
  const curve = transmissibilityCurve(zeta, lo, hi).map(([x, y]) => ({ x, y }));
  const ys = curve.map((q) => q.y);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const series: Series[] = [
    { points: curve, type: "line", color: "#000000", label: `T (ζ = ${sig(zeta, 3)})` },
    { points: [{ x: lo, y: 1 }, { x: hi, y: 1 }], type: "line", color: "#999999", label: "T = 1" },
    { points: [{ x: Math.SQRT2, y: yMin }, { x: Math.SQRT2, y: yMax }], type: "line", color: "#2e7d32", label: "r = √2" },
    { points: [{ x: rOp, y: transmissibility(rOp, zeta) }], type: "scatter", color: "#c00000", label: "operating point" },
  ];
  return buildPlotSvg(series, {
    xlabel: "Frequency ratio r = f/fn",
    ylabel: "Transmissibility T",
    xScale: "log",
    yScale: "log",
    width,
    height: Math.round(width * 0.66),
  });
}

export interface ShaftChartRow {
  label: string;
  /** rpm */
  rpm: number;
}

export const SHAFT_CHART_WIDTH = 460;

/**
 * Two panels. Top: the shaft between its bearings, the first-mode (static-deflection) shape exaggerated and dashed,
 * the masses as discs. Bottom: one row per critical speed (rpm) with its ±20 % band, and the operating speed as a
 * vertical line through every row — rows, not labels on one axis, so close criticals never overprint.
 */
export function shaftCriticalSvg(
  L: number,
  shape: Array<[number, number]>,
  masses: Array<{ x: number; label: string }>,
  rows: ShaftChartRow[],
  operatingRpm: number | null,
  shapeTitle = "First mode shape (static deflection, exaggerated)",
  width = SHAFT_CHART_WIDTH,
): string {
  const W = width;
  const out: string[] = [];
  // ---- top panel: the shaft ----
  const ML = 40, MR = 40, shaftY = 60, amp = 34;
  const X = (x: number): number => ML + (x / L) * (W - ML - MR);
  out.push(text(12, 18, shapeTitle, "start", 12));
  out.push(`<line x1="${f(X(0))}" y1="${shaftY}" x2="${f(X(L))}" y2="${shaftY}" stroke="#888888" stroke-width="5" stroke-linecap="butt"/>`);
  const path = shape.map(([x, y], i) => `${i ? "L" : "M"}${f(X(x))},${f(shaftY + amp * y)}`).join(" ");
  out.push(`<path d="${path}" fill="none" stroke="#1f5fa8" stroke-width="1.6" stroke-dasharray="5 3"/>`);
  for (const xb of [0, L]) {
    const cx = X(xb);
    out.push(`<polygon points="${f(cx)},${shaftY + 3} ${f(cx - 9)},${shaftY + 19} ${f(cx + 9)},${shaftY + 19}" fill="#ffffff" stroke="#000000" stroke-width="1.2"/>`);
    out.push(`<line x1="${f(cx - 13)}" y1="${shaftY + 19}" x2="${f(cx + 13)}" y2="${shaftY + 19}" stroke="#000000" stroke-width="1.2"/>`);
  }
  const yAt = (x: number): number => {
    for (let i = 1; i < shape.length; i++) {
      if (x <= shape[i][0]) {
        const [x0, y0] = shape[i - 1], [x1, y1] = shape[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
      }
    }
    return 0;
  };
  // Mass labels sit above the undeformed shaft, over their discs (clear of the curve and the bearings), stepping up a
  // line when two would collide.
  let lastX = -1e9, drop = 0;
  masses.forEach((m) => {
    const cx = X(m.x), cy = shaftY + amp * yAt(m.x);
    out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="6.5" fill="#000000"/>`);
    drop = cx - lastX < 6 * m.label.length + 8 ? (drop ? 0 : 12) : 0;
    const half = 2.9 * m.label.length;
    const lx = Math.min(Math.max(cx, 4 + half), W - 4 - half);
    out.push(text(lx, shaftY - 9 - drop, m.label, "middle", 10));
    lastX = cx;
  });
  // Span labels under the bearings.
  out.push(text(X(0), shaftY + 33, "0", "middle", 10, "#555555"), text(X(L), shaftY + 33, `${sig(L)} m`, "middle", 10, "#555555"));

  // ---- bottom panel: the criticals ladder ----
  const p2 = shaftY + amp + 38;
  out.push(text(12, p2, "Critical speeds (rpm), ±20 % bands", "start", 12));
  const longest = Math.max(...rows.map((r) => r.label.length), 8);
  const LL = Math.min(190, 14 + longest * 5.9);
  const RW = W - LL - 52;
  const vmax = Math.max(...rows.map((r) => r.rpm * 1.2), (operatingRpm ?? 0) * 1.1, 1);
  const axis = linearAxis(0, vmax, { loose: true, target: 5 });
  const hiAx = axis.hi > 0 ? axis.hi : vmax;
  const SX = (v: number): number => LL + (v / hiAx) * RW;
  const rowH = 22, r0 = p2 + 16;
  rows.forEach((r, i) => {
    const y = r0 + i * rowH + rowH / 2;
    out.push(`<rect x="${f(SX(0.8 * r.rpm))}" y="${f(y - 6)}" width="${f(SX(1.2 * r.rpm) - SX(0.8 * r.rpm))}" height="12" fill="#f4c7c3"/>`);
    out.push(`<line x1="${f(SX(r.rpm))}" y1="${f(y - 8)}" x2="${f(SX(r.rpm))}" y2="${f(y + 8)}" stroke="#c00000" stroke-width="2"/>`);
    out.push(text(LL - 8, y + 4, r.label, "end", 10));
    // The value sits right of its band unless the operating line or the canvas edge is in the way; then left of it.
    const label = sig(r.rpm), lw = 6 * label.length + 2;
    const opX = operatingRpm !== null && operatingRpm > 0 ? SX(operatingRpm) : null;
    const clear = (a: number, b: number): boolean => a >= LL && b <= W - 4 && (opX === null || opX < a - 2 || opX > b + 2);
    const rx = SX(1.2 * r.rpm) + 4, lx = SX(0.8 * r.rpm) - 4;
    if (clear(rx, rx + lw)) out.push(text(rx, y + 4, label, "start", 10, "#c00000"));
    else if (clear(lx - lw, lx)) out.push(text(lx, y + 4, label, "end", 10, "#c00000"));
    else if (opX !== null && opX + 4 + lw <= W - 4) out.push(text(opX + 4, y + 4, label, "start", 10, "#c00000"));
    else out.push(text(rx, y + 4, label, "start", 10, "#c00000"));
  });
  const yAx = r0 + rows.length * rowH + 4;
  out.push(`<line x1="${f(LL)}" y1="${f(yAx)}" x2="${f(LL + RW)}" y2="${f(yAx)}" stroke="#000000" stroke-width="1"/>`);
  axis.values.forEach((v, i) => {
    out.push(`<line x1="${f(SX(v))}" y1="${f(yAx)}" x2="${f(SX(v))}" y2="${f(yAx + 4)}" stroke="#000000" stroke-width="1"/>`);
    out.push(text(SX(v), yAx + 15, axis.labels[i] ?? "", "middle", 10));
  });
  const axTitle = `Speed (rpm${axis.multiplier ? `, ${axis.multiplier}` : ""})`;
  out.push(text(LL + RW / 2, yAx + 30, axTitle, "middle", 11));
  let H = yAx + 40;
  if (operatingRpm !== null && operatingRpm > 0) {
    const ox = SX(operatingRpm);
    out.push(`<line x1="${f(ox)}" y1="${f(r0 - 2)}" x2="${f(ox)}" y2="${f(yAx)}" stroke="#1f5fa8" stroke-width="1.6"/>`);
    out.push(text(LL, H + 4, `Operating speed ${sig(operatingRpm)} rpm (blue line)`, "start", 10, "#1f5fa8"));
    H += 12;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${f(H)}" viewBox="0 0 ${W} ${f(H)}"><rect width="${W}" height="${f(H)}" fill="#ffffff"/>${out.join("")}</svg>`;
}
