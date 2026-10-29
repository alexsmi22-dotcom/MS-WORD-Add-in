/**
 * Figures for the clinical-research Stats calculators (v2.206.0). The Fagan nomogram is drawn here; every other
 * figure is laid out by a shared builder (plot.buildPlotSvg, statchart.forestPlotSvg / groupedBarSvg, plot.combineSvgs)
 * so it follows the figure styles like the rest of Stats. Every plotted value is one the calculator computed and prints.
 */
import { buildPlotSvg, type Series } from "./plot";
import { forestPlotSvg, type ForestRow } from "./statchart";
import { ctxCanvas } from "./figContext";
import { fmtFixed } from "./regTable";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BLUE = "#1d4ed8";
const RED = "#b91c1c";
const INK = "#111827";
const GREY = "#6b7280";

const logit = (p: number): number => Math.log(p / (1 - p));

/** A probability tick label: "0.1", "1", "50", "99.9" (percent). */
function pctLabel(p: number): string {
  const v = 100 * p;
  return v < 1 || v > 99 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
}

/** An LR tick label. */
function lrLabel(v: number): string {
  return v >= 1 ? String(v) : String(v);
}

// Ticks in PRIORITY order: each is kept only when it clears every tick already kept by a label height (thinTicks), so a
// narrow redraw (a figure style) keeps 50, 10, 90, 1, 99 … and drops the crowded middle values first.
const PRE_TICKS = [0.5, 0.1, 0.9, 0.01, 0.99, 0.001, 0.2, 0.8, 0.05, 0.95, 0.3, 0.7, 0.02, 0.005];
const LR_TICKS = [1, 1000, 0.001, 100, 0.01, 10, 0.1, 20, 0.05, 5, 0.2];
const POST_TICKS = [0.5, 0.9, 0.1, 0.99, 0.01, 0.999, 0.001, 0.8, 0.2, 0.95, 0.05, 0.7, 0.3, 0.02, 0.005];

/** The ticks (in priority order) whose labels clear every label already kept by at least gap px. */
function thinTicks<T>(ticks: T[], yOf: (t: T) => number, gap: number): T[] {
  const kept: number[] = [];
  const out: T[] = [];
  for (const t of ticks) {
    const y = yOf(t);
    if (kept.every((k) => Math.abs(k - y) >= gap)) {
      kept.push(y);
      out.push(t);
    }
  }
  return out;
}

export interface FaganLine {
  label: string;
  lr: number;
  post: number;
}

/**
 * The Fagan nomogram (Fagan 1975, N Engl J Med 293:257): pre-test probability on the left, the likelihood ratio in
 * the middle, post-test probability on the right; a straight line from the pre-test probability through the LR meets
 * the post-test probability, because logit(post) = logit(pre) + ln LR. Scales: left y = −logit(pre), middle
 * y = ln(LR)/2, right y = logit(post), so the three points are collinear. LRs and probabilities outside the drawn
 * scales (LR 0.001–1000, probability 0.1–99.9%) are clamped to the scale end, and the figure says so.
 */
export function faganSvg(pre: number, lines: FaganLine[], title = "Fagan nomogram"): string {
  const { w: W, h: H, bw } = ctxCanvas(420, 440, 300);
  const MT = 46;
  const MB = 22 + 15 * lines.length + 14;
  const top = MT;
  const bot = H - MB;
  const span = 2 * logit(0.999);
  const yOf = (u: number): number => top + ((logit(0.999) - u) / span) * (bot - top);
  const xL = W * 0.2;
  const xM = W * 0.5;
  const xR = W * 0.8;
  const clampP = (p: number): number => Math.min(0.999, Math.max(0.001, p));
  // Review M9: each line goes from the pre-test point THROUGH ITS OWN LR on the middle scale and is clipped at the
  // frame when the post-test probability is off the scale (it used to be bent to the scale end, missing its LR). An LR
  // that is 0, unbounded or 0/0 has no line; the key says so.
  const drawable = (l: FaganLine): boolean => Number.isFinite(l.lr) && l.lr > 0;
  const preOff = !(pre >= 0.001 && pre <= 0.999);
  const yPre = yOf(-logit(clampP(pre)));
  const uPre = -(yPre - top) / (bot - top) * span + logit(0.999); // the drawn pre-test point, as −logit
  const ends = lines.map((l) => {
    if (!drawable(l)) return null;
    const u2 = -uPre + Math.log(l.lr); // logit(post) through the drawn pre-test point
    const y2 = yOf(u2);
    if (y2 >= top && y2 <= bot) return { x2: xR, y2, onScale: true };
    const yEdge = y2 < top ? top : bot;
    const x2 = xL + ((xR - xL) * (yEdge - yPre)) / (y2 - yPre);
    return { x2, y2: yEdge, onScale: false };
  });
  const clamped = preOff || ends.some((e) => e !== null && !e.onScale);
  const undrawn = lines.some((l) => !drawable(l));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-chart-kind="nomogram">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text data-figure-title="1" x="${(W / 2).toFixed(1)}" y="18" text-anchor="middle" font-family="Segoe UI, Arial" font-size="12" fill="${INK}">${esc(title)}</text>`,
  ];
  const head = (x: number, t: string): void => {
    parts.push(`<text x="${x.toFixed(1)}" y="36" text-anchor="middle" font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(t)}</text>`);
  };
  head(xL, "Pre-test %");
  head(xM, "LR");
  head(xR, "Post-test %");
  for (const x of [xL, xM, xR]) parts.push(`<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${bot.toFixed(1)}" stroke="${INK}" stroke-width="1"/>`);
  // The lines, drawn first so the tick marks sit on top; their y along the canvas, for keeping middle labels clear.
  const segs = ends.filter((e): e is { x2: number; y2: number; onScale: boolean } => e !== null).map((e) => ({ x2: e.x2, y1: yPre, y2: e.y2 }));
  const lineYAt = (s: { x2: number; y1: number; y2: number }, x: number): number =>
    x > s.x2 + 0.5 ? Number.NaN : s.y1 + ((s.y2 - s.y1) * (x - xL)) / (s.x2 - xL);
  ends.forEach((e, i) => {
    if (!e) return;
    const col = bw ? "#000000" : i === 0 ? BLUE : RED;
    const dash = bw && i > 0 ? ` stroke-dasharray="6 4"` : "";
    parts.push(`<line x1="${xL.toFixed(1)}" y1="${yPre.toFixed(1)}" x2="${e.x2.toFixed(1)}" y2="${e.y2.toFixed(1)}" stroke="${col}" stroke-width="1.6"${dash}/>`);
    if (e.onScale) parts.push(`<circle cx="${xR.toFixed(1)}" cy="${e.y2.toFixed(1)}" r="3" fill="${col}"/>`);
  });
  parts.push(`<circle cx="${xL.toFixed(1)}" cy="${yPre.toFixed(1)}" r="3" fill="${INK}"/>`);
  const tick = (x: number, y: number, side: -1 | 1, text: string): void => {
    parts.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 4 * side).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${INK}" stroke-width="1"/>`);
    parts.push(
      `<text x="${(x + 7 * side).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="${side < 0 ? "end" : "start"}" font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(text)}</text>`,
    );
  };
  const GAP = 13;
  for (const p of thinTicks(PRE_TICKS, (q) => yOf(-logit(q)), GAP)) tick(xL, yOf(-logit(p)), -1, pctLabel(p));
  for (const p of thinTicks(POST_TICKS, (q) => yOf(logit(q)), GAP)) tick(xR, yOf(logit(p)), 1, pctLabel(p));
  for (const v of thinTicks(LR_TICKS, (q) => yOf(Math.log(q) / 2), GAP)) {
    const y = yOf(Math.log(v) / 2);
    const x0 = xM + 7;
    const x1 = xM + 7 + 6.5 * lrLabel(v).length;
    // A middle label the line runs through is left out (the line itself marks the LR it crosses).
    const struck = segs.some((s) => {
      const a = lineYAt(s, x0);
      const b = lineYAt(s, x1);
      if (Number.isNaN(a) && Number.isNaN(b)) return false;
      const lo = Math.min(...[a, b].filter((v) => !Number.isNaN(v)));
      const hi = Math.max(...[a, b].filter((v) => !Number.isNaN(v)));
      return lo - 6 < y + 4 && hi + 6 > y - 8;
    });
    if (struck) {
      parts.push(`<line x1="${xM.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(xM + 4).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${INK}" stroke-width="1"/>`);
      continue;
    }
    tick(xM, y, 1, lrLabel(v));
  }
  // The key under the scales.
  lines.forEach((l, i) => {
    const y = bot + 26 + 15 * i;
    const col = bw ? "#000000" : i === 0 ? BLUE : RED;
    const dash = bw && i > 0 ? ` stroke-dasharray="6 4"` : "";
    parts.push(`<line x1="${(W * 0.04).toFixed(1)}" y1="${(y - 3.5).toFixed(1)}" x2="${(W * 0.04 + 18).toFixed(1)}" y2="${(y - 3.5).toFixed(1)}" stroke="${col}" stroke-width="1.6"${dash}/>`);
    parts.push(`<text x="${(W * 0.04 + 23).toFixed(1)}" y="${y.toFixed(1)}" font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(l.label)}</text>`);
  });
  const note = undrawn ? "An unbounded or undefined LR has no line." : clamped ? (preOff ? "Off-scale values sit at the ends." : "A line leaving the frame is off the scale.") : "";
  if (note) {
    parts.push(
      `<text x="${(W / 2).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="9" fill="${GREY}">${esc(note)}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

/** The ROC curve(s) with the chance diagonal and the Youden-optimal point of the first. */
export function rocSvg(curves: { label: string; pts: { fpr: number; tpr: number }[] }[], best: { fpr: number; tpr: number; label: string } | null): string {
  const cols = ["#1d4ed8", "#b45309"];
  const series: Series[] = [{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#9ca3af", label: "Chance (AUC 0.5)" }];
  curves.forEach((c, i) => series.push({ type: "line", points: c.pts.map((p) => ({ x: p.fpr, y: p.tpr })), color: cols[i % 2], label: c.label }));
  if (best) series.push({ type: "scatter", points: [{ x: best.fpr, y: best.tpr }], color: RED, label: best.label });
  return buildPlotSvg(series, {
    width: 420,
    height: 340,
    title: "ROC curve",
    xlabel: "1 − specificity (false-positive rate)",
    ylabel: "Sensitivity",
    xLimits: { min: 0, max: 1 },
    yLimits: { min: 0, max: 1 },
  });
}

/** A forest panel of ratios (log axis, reference 1) or differences (linear, reference 0). */
export function ratioForestSvg(rows: ForestRow[], opts: { title: string; xlabel: string; log: boolean }): string {
  return forestPlotSvg(rows, { title: opts.title, xlabel: opts.xlabel, log: opts.log, zero: opts.log ? 1 : 0 });
}

/** At most this many studies in the meta-analysis forest plot (the rest stay in the table, and the title says so). */
export const META_FOREST_MAX_STUDIES = 30;

/**
 * The meta-analysis forest plot: every study (up to META_FOREST_MAX_STUDIES), then the pooled rows (fixed, random and
 * the prediction interval) in one panel. One panel, not two stacked: a stacked pair could not meet the USPTO lettering.
 */
export function metaForestSvg(studies: ForestRow[], pooled: ForestRow[], opts: { xlabel: string; log: boolean }): string {
  const shown = studies.slice(0, META_FOREST_MAX_STUDIES);
  const more = studies.length - shown.length;
  const title = more > 0 ? `Forest plot (first ${shown.length} of ${studies.length} studies; all in the table)` : "Forest plot (95% CI)";
  const rows = [...shown, ...pooled];
  return forestPlotSvg(rows, { title, xlabel: opts.xlabel, log: opts.log, zero: opts.log ? 1 : 0, maxRows: rows.length });
}

/** The Bland–Altman plot: differences against means, the bias and the limits of agreement. */
export function blandAltmanSvg(means: number[], diffs: number[], bias: number, lower: number, upper: number, fmt: (v: number) => string, units: string): string {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of means) {
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  const pad = (hi - lo) * 0.04 || 1;
  const xs = [lo - pad, hi + pad];
  const hl = (y: number, color: string, label: string): Series => ({ type: "line", points: xs.map((x) => ({ x, y })), color, label });
  const u = units ? ` (${units})` : "";
  return buildPlotSvg(
    [
      { type: "scatter", points: means.map((m, i) => ({ x: m, y: diffs[i] })), color: BLUE, label: "Pairs" },
      hl(upper, RED, `Upper limit ${fmt(upper)}`),
      hl(bias, INK, `Bias ${fmt(bias)}`),
      hl(lower, RED, `Lower limit ${fmt(lower)}`),
    ],
    { width: 440, height: 320, title: "Bland–Altman plot", xlabel: `Mean of the two methods${u}`, ylabel: `Difference, A − B${u}` },
  );
}

/** ICC profile plot: each rater's ratings across the targets. */
export function iccProfileSvg(Y: number[][], raters: string[]): string {
  const cols = ["#1d4ed8", "#b45309", "#047857", "#7c3aed", "#be123c", "#0e7490", "#4d7c0f", "#57534e"];
  const k = Math.min(raters.length, 8);
  const n = Y.length;
  const series: Series[] = [];
  for (let j = 0; j < k; j++) {
    const pts = Y.map((r, i) => ({ x: i + 1, y: r[j] }));
    series.push({ type: "line", points: pts, color: cols[j], label: raters[j] });
    series.push({ type: "scatter", points: pts, color: cols[j] });
  }
  return buildPlotSvg(series, {
    width: 440,
    height: 300,
    title: "Ratings by target",
    xlabel: "Target (row)",
    ylabel: "Rating",
    xLimits: { min: 0.5, max: n + 0.5, step: n <= 12 ? 1 : undefined },
    notes: raters.length > k ? [`${raters.length - k} more raters not drawn.`] : [],
  });
}

/**
 * The funnel plot in Egger's form (precision 1/SE up the y axis, the effect along x), with the pooled fixed-effect
 * estimate and the pseudo 95% limits μ ± 1.96·SE. Ratio effects are drawn on a log x axis.
 */
export function funnelSvg(y: number[], se: number[], mu: number, ratio: boolean, xlabel: string): string {
  const tr = (v: number): number => (ratio ? Math.exp(v) : v);
  let maxP = 0;
  for (const s of se) if (1 / s > maxP) maxP = 1 / s;
  // The pseudo limits run off to the sides near zero precision: the x axis is held to the studies' own spread, and
  // each limit curve starts where it enters that range (review MINOR: the curve's own off-axis points were counted in
  // the figure's "points outside the axis limits" note, as if studies were missing).
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of y) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = Math.max(0.1, (hi - lo) * 0.25);
  const pEnd = maxP * 1.05;
  const limitCurve = (side: -1 | 1): { x: number; y: number }[] => {
    const edge = side < 0 ? lo - pad : hi + pad;
    const dist = side * (edge - mu);
    if (!(dist > 0)) return [];
    const pStart = Math.max(1.959963984540054 / dist, pEnd / 400);
    if (pStart >= pEnd) return [];
    return Array.from({ length: 41 }, (_, i) => pStart + ((pEnd - pStart) * i) / 40).map((p) => ({ x: tr(mu + (side * 1.959963984540054) / p), y: p }));
  };
  const series: Series[] = [
    { type: "line", points: limitCurve(-1), color: "#9ca3af", label: "Pseudo 95% limits" },
    { type: "line", points: limitCurve(1), color: "#9ca3af" },
    { type: "line", points: [{ x: tr(mu), y: 0 }, { x: tr(mu), y: pEnd }], color: INK, label: `Fixed effect ${fmtFixed(tr(mu), 2)}` },
    { type: "scatter", points: y.map((v, i) => ({ x: tr(v), y: 1 / se[i] })), color: BLUE, label: "Studies" },
  ].filter((sr) => sr.points.length > 0) as Series[];
  return buildPlotSvg(series, {
    width: 440,
    height: 320,
    title: "Funnel plot",
    xlabel,
    ylabel: "Precision (1/SE)",
    xScale: ratio ? "log" : "linear",
    xLimits: { min: tr(lo - pad), max: tr(hi + pad) },
    yLimits: { min: 0, max: maxP * 1.05 },
  });
}

/** Buderer sample size against prevalence, for the sensitivity and specificity targets, with the design's point. */
export function budererSvg(curveSens: { x: number; y: number }[], curveSpec: { x: number; y: number }[], at: { x: number; y: number }): string {
  return buildPlotSvg(
    [
      { type: "line", points: curveSens, color: BLUE, label: "n for sensitivity" },
      { type: "line", points: curveSpec, color: "#b45309", label: "n for specificity" },
      { type: "scatter", points: [at], color: RED, label: "This design" },
    ],
    { width: 420, height: 300, title: "Sample size against prevalence", xlabel: "Prevalence (%)", ylabel: "Total subjects", yScale: "log" },
  );
}
