// Figures for the Kalman-filter and attitude calculators (Release E, gap #7): the prior σ of each state converging
// over the Riccati recursion, the filtered estimate with its ±2σ band over the measurements, the innovation sequence
// with its ±2√S band, and a body-axes triad against the reference axes in oblique (cabinet) projection. The plots go
// through buildPlotSvg, so axes, ticks, ×10ⁿ multipliers and legends follow the one plotter. Colours are literal hex
// (inserted artwork never follows the pane's theme); the font is the one engCharts2026.ts uses.

import { buildPlotSvg, combineSvgs, escapeXml, type Series, type Point } from "./plot";
import { fmtSig } from "./axis";

export const KALMAN_CHART_WIDTH = 440;
const H = (w: number): number => Math.round(w * 0.6);
const INK = "#000000", RED = "#c00000", GREY = "#777777", BLUE = "#1f4e9c", BAND = "#6f8fbf";
const PALETTE = ["#000000", "#c00000", "#1f4e9c", "#2e7d32", "#7b3f9e", "#b8860b"];
const FONT = "Arial, Helvetica, sans-serif";

/** A legend number: significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁵. */
function lab(v: number, sig = 3): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) return fmtSig(v, sig).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return fmtSig(v, sig).replace(/(\.\d*?)0+×/, "$1×").replace(/\.×/, "×");
}

/** Log y when the drawn values span more than a decade and are all positive. */
function wantsLog(values: number[]): boolean {
  const pos = values.filter((v) => v > 0 && Number.isFinite(v));
  if (pos.length !== values.length || !pos.length) return false;
  return Math.max(...pos) / Math.min(...pos) > 10;
}

/**
 * Prior σ of each state over the recursion from P₀, against its steady value. Up to three states: one panel each
 * (the states carry different units). Four to six: one panel of σₖ/σ∞ (dimensionless), every line ending at 1.
 */
export function kalmanConvergenceSvg(sigmas: number[][], steady: number[], names: string[], width = KALMAN_CHART_WIDTH): { svg: string; width: number; height: number } {
  const n = steady.length;
  const steps = sigmas.length;
  if (n <= 3) {
    const panels = steady.map((s, i) => {
      const pts: Point[] = sigmas.map((row, k) => ({ x: k, y: row[i] }));
      const series: Series[] = [
        { points: pts, type: "line", color: INK, label: `prior σ of ${names[i]}` },
        { points: [{ x: 0, y: s }, { x: steps - 1, y: s }], type: "line", color: RED, label: `steady σ = ${lab(s)}` },
      ];
      const log = wantsLog([...pts.map((p) => p.y), s]);
      return buildPlotSvg(series, {
        xlabel: "Step k",
        ylabel: `σ of ${names[i]}`,
        width,
        height: n === 1 ? H(width) : Math.round(width * 0.5),
        ...(log ? { yScale: "log" as const } : {}),
      });
    });
    return combineSvgs(panels);
  }
  // States whose ratio curves coincide (two identical, decoupled axes) are drawn once with a joint label, so no
  // line hides under another unnamed.
  const curves = steady.map((s, i) => sigmas.map((row, k) => ({ x: k, y: row[i] / s })));
  const same = (a: Point[], b: Point[]): boolean => a.every((p, k) => Math.abs(p.y - b[k].y) <= 1e-9 * Math.max(1, Math.abs(p.y)));
  const series: Series[] = [];
  const owner: number[] = [];
  curves.forEach((c, i) => {
    const j = owner.findIndex((o) => same(curves[o], c));
    if (j >= 0) series[j].label = `${series[j].label} = ${names[i]}`;
    else {
      owner.push(i);
      series.push({ points: c, type: "line", color: PALETTE[series.length % PALETTE.length], label: names[i] });
    }
  });
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const log = wantsLog(all);
  const svg = buildPlotSvg(series, {
    xlabel: "Step k",
    ylabel: "Prior σ / steady σ",
    width,
    height: H(width),
    ...(log ? { yScale: "log" as const } : {}),
    notes: ["Each state's σ divided by its steady value; every line ends at 1."],
  });
  return combineSvgs([svg]);
}

export interface RunPoint {
  k: number;
  z: number | null;
  est: number;
  sd: number;
}

/** Measurements (points), the filtered estimate of the measured quantity (line) and its ±2σ band (two lines). */
export function kalmanRunSvg(pts: RunPoint[], quantity: string, width = KALMAN_CHART_WIDTH): string {
  const meas = pts.filter((p) => p.z !== null).map((p) => ({ x: p.k, y: p.z as number }));
  const series: Series[] = [
    { points: pts.map((p) => ({ x: p.k, y: p.est + 2 * p.sd })), type: "line", color: BAND, label: "estimate ± 2σ" },
    { points: pts.map((p) => ({ x: p.k, y: p.est - 2 * p.sd })), type: "line", color: BAND },
    { points: meas, type: "scatter", color: GREY, label: "measurement (dots)" },
    { points: pts.map((p) => ({ x: p.k, y: p.est })), type: "line", color: INK, label: "filtered estimate" },
  ];
  return buildPlotSvg(series, { xlabel: "Step k", ylabel: quantity, width, height: H(width) });
}

/** The innovation z − Hx⁻ at each update, with ±2√S. */
export function kalmanInnovationSvg(pts: Array<{ k: number; nu: number; sd: number }>, quantity: string, width = KALMAN_CHART_WIDTH): string {
  const series: Series[] = [
    { points: pts.map((p) => ({ x: p.k, y: 2 * p.sd })), type: "line", color: RED, label: "±2√S" },
    { points: pts.map((p) => ({ x: p.k, y: -2 * p.sd })), type: "line", color: RED },
    { points: pts.map((p) => ({ x: p.k, y: p.nu })), type: "scatter", color: BLUE, label: "innovation ν (dots)" },
  ];
  return buildPlotSvg(series, { xlabel: "Step k", ylabel: `Innovation in ${quantity}`, width, height: Math.round(width * 0.5) });
}

// ------------------------------------------------------------------ attitude triad

export const TRIAD_WIDTH = 420;

/**
 * Cabinet projection of a reference-frame vector: X toward the viewer (drawn down-left at 45°, half length), Y to
 * the right, Z up — a right-handed set. Screen y grows downward.
 */
function project(v: readonly number[], L: number): [number, number] {
  const c = Math.SQRT1_2 * 0.5;
  return [L * (v[1] - c * v[0]), -L * (v[2] - c * v[0])];
}

function arrow(x0: number, y0: number, x1: number, y1: number, color: string, w: number, head: number): string {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return "";
  const ux = dx / len, uy = dy / len;
  const bx = x1 - ux * head, by = y1 - uy * head;
  const px = -uy * head * 0.38, py = ux * head * 0.38;
  const f = (v: number): string => v.toFixed(1);
  return (
    `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(bx)}" y2="${f(by)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>` +
    `<polygon points="${f(x1)},${f(y1)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}" fill="${color}"/>`
  );
}

/**
 * Body axes (the columns of the active rotation matrix R) against the reference axes, in cabinet projection. The
 * drawing is laid out around its own bounding box (no dead space whatever the orientation), with the key beneath. An
 * axis that points almost along the line of sight projects to almost nothing; that is said in the figure.
 */
export function attitudeTriadSvg(R: readonly (readonly number[])[]): { svg: string; width: number; height: number } {
  const W = TRIAD_WIDTH;
  const L = 105;
  interface Ax { tip: [number, number]; color: string; w: number; head: number; text: string; sub: string; label: [number, number] }
  const notes: string[] = [];
  const bodyColors = [RED, "#2e7d32", BLUE];
  // Every arrow first (reference axes grey, thin and longer than the body axes so coincident axes stay
  // distinguishable; body axes coloured and heavier, drawn on top), so each label can be placed clear of all of them.
  const axes: Ax[] = [
    ...["X", "Y", "Z"].map((name, i): Ax => {
      const e = [0, 0, 0];
      e[i] = 1.22;
      return { tip: project(e, L), color: GREY, w: 1.2, head: 8, text: name, sub: "", label: [0, 0] };
    }),
    ...["x", "y", "z"].map((name, i): Ax => {
      const tip = project([R[0][i], R[1][i], R[2][i]], L);
      if (Math.hypot(tip[0], tip[1]) < 0.15 * L) {
        // The projection's null direction is (1, c, c) with c = 0.5/√2: positive along it is toward the viewer.
        const c = Math.SQRT1_2 * 0.5;
        const toward = R[0][i] + c * R[1][i] + c * R[2][i] > 0;
        notes.push(`The body ${name} axis points almost straight ${toward ? "toward" : "away from"} the viewer, so its arrow is drawn very short.`);
      }
      return { tip, color: bodyColors[i], w: 2.4, head: 10, text: name, sub: "b", label: [0, 0] };
    }),
  ];
  /** Distance from p to the segment origin–tip. */
  const segDist = (p: [number, number], tip: [number, number]): number => {
    const l2 = tip[0] * tip[0] + tip[1] * tip[1];
    const t = l2 > 0 ? Math.max(0, Math.min(1, (p[0] * tip[0] + p[1] * tip[1]) / l2)) : 0;
    return Math.hypot(p[0] - t * tip[0], p[1] - t * tip[1]);
  };
  const placed: Array<[number, number]> = [];
  // Candidates around the tip: along the axis first, then rotating away from it, at growing radius. A label (about
  // 18 × 14 px) must keep 11 px from every arrow and 20 px from every label already placed; the candidate with the
  // most clearance wins when none qualifies.
  const place = (tip: [number, number]): [number, number] => {
    const len = Math.hypot(tip[0], tip[1]);
    const base = len > 1 ? Math.atan2(tip[1], tip[0]) : -Math.PI / 4;
    let best: [number, number] = [tip[0] + 14 * Math.cos(base), tip[1] + 14 * Math.sin(base)];
    let bestScore = -Infinity;
    for (const d of [14, 22, 32]) {
      for (const turn of [0, 45, -45, 90, -90, 135, -135, 180]) {
        const a = base + (turn * Math.PI) / 180;
        const p: [number, number] = [tip[0] + d * Math.cos(a), tip[1] + d * Math.sin(a)];
        const lineClear = Math.min(...axes.map((ax) => segDist(p, ax.tip)));
        const labelClear = placed.length ? Math.min(...placed.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]))) : Infinity;
        if (lineClear >= 11 && labelClear >= 20) return p;
        const score = Math.min(lineClear / 11, labelClear / 20);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    return best;
  };
  for (const ax of axes) {
    ax.label = place(ax.tip);
    placed.push(ax.label);
  }
  // Bounding box of every tip and label (labels as ±9 px boxes), then the drawing centred in the width.
  const xs = axes.flatMap((a) => [a.tip[0], a.label[0] - 9, a.label[0] + 9]).concat([0]);
  const ys = axes.flatMap((a) => [a.tip[1], a.label[1] - 9, a.label[1] + 9]).concat([0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const ox = (W - (maxX - minX)) / 2 - minX;
  const oy = 14 - minY;
  const parts: string[] = [];
  for (const a of axes) parts.push(arrow(ox, oy, ox + a.tip[0], oy + a.tip[1], a.color, a.w, a.head));
  parts.push(`<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="2.2" fill="${INK}"/>`);
  for (const a of axes) {
    const sub = a.sub ? `<tspan font-size="10" dy="3">${a.sub}</tspan>` : "";
    parts.push(
      `<text x="${(ox + a.label[0]).toFixed(1)}" y="${(oy + a.label[1] + 5).toFixed(1)}" font-family="${FONT}" font-size="14" font-style="italic" fill="${a.color}" text-anchor="middle">${escapeXml(a.text)}${sub}</text>`,
    );
  }
  // Key, beneath the drawing.
  const ky = Math.round(oy + maxY + 22);
  parts.push(
    `<line x1="30" y1="${ky}" x2="54" y2="${ky}" stroke="${GREY}" stroke-width="1.2"/>` +
      `<text x="60" y="${ky + 4}" font-family="${FONT}" font-size="11" fill="${INK}">reference axes X, Y, Z</text>` +
      `<line x1="222" y1="${ky}" x2="246" y2="${ky}" stroke="${RED}" stroke-width="2.4"/>` +
      `<text x="252" y="${ky + 4}" font-family="${FONT}" font-size="11" fill="${INK}">body axes (columns of R)</text>`,
  );
  const noteLines = notes.length ? notes.flatMap((n) => n.split(", so ").map((p, i, a) => (a.length === 1 ? p : i < a.length - 1 ? p + "," : "so " + p))) : ["Oblique (cabinet) projection: X toward the viewer, Y right, Z up."];
  noteLines.forEach((t, i) =>
    parts.push(`<text x="${W / 2}" y="${ky + 22 + i * 12}" font-family="${FONT}" font-size="9" fill="${GREY}" text-anchor="middle">${escapeXml(t)}</text>`),
  );
  const Hh = ky + 22 + (noteLines.length - 1) * 12 + 10;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">` +
    `<rect x="0" y="0" width="${W}" height="${Hh}" fill="#ffffff"/>` +
    parts.join("") +
    `</svg>`;
  return { svg, width: W, height: Hh };
}
