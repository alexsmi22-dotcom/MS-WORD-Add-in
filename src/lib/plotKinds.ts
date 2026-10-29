// Plot ▸ Plot type: the kinds beyond y = f(x).
//
//   fx          y = f(x) and data — the original Plot tool, untouched (the pane
//               keeps its own code path for it; nothing here runs).
//   parametric  x(t), y(t) over a t range.
//   polar       r(θ) over a θ range, on a polar grid (polarPlot.ts).
//   dualy       two data series sharing x, each on its own y axis (dualAxisPlot.ts).
//   contour     z = f(x, y) over a rectangle (contour.ts).
//   surface     z = f(x, y) as a 3D surface (surface3d.ts).
//
// EVERYTHING THE PANE NEEDS LIVES HERE, not in taskpane.ts: the field reading,
// the parsing, the refusals and the figure. The pane only calls renderPlotKind
// and hands the result to the same insert path the y = f(x) plot uses
// (currentPlotSvg + currentPlotRender → insertFigure, sized from the SVG's own
// width and height). That is the lesson of "taskpane parsers are untestable":
// a parser inside the pane cannot be imported by a test.
//
// Expressions go through plot.ts compileExpr — the one grammar y = f(x) uses —
// parsed once per formula, never per grid point.

import { compileExpr, foldPlotSymbols, CompiledExpr, buildPlotSvg, Series, AxisScale, dropForScales } from "./plot";
import { fmtValue } from "./axis";
import { readNumberList } from "./numberList";
import { mcDisplayFormula } from "./monteCarlo";
import { samplePolar, polarPlotSvg, POLAR_SAMPLES_MAX } from "./polarPlot";
import { parseDualData, dualAxisPlotSvg, dropForDualScales } from "./dualAxisPlot";
import { sampleGrid, gridRange, niceLevels, levelLabels, estimateLineVertices, markJumps, contourPlotSvg, marchingSquares, isobands, isFlat, rangeText, ContourLabelError, CONTOUR_GRID_MAX, CONTOUR_LEVELS_MAX, Grid } from "./contour";
import { sampleSurface, surfacePlotSvg, SURFACE_GRID_MAX, SurfaceStyle } from "./surface3d";
import type { FigureStylePreset } from "./figureStyle";
import { blackAndWhite } from "./solidformChart";

export type PlotKind = "fx" | "parametric" | "polar" | "dualy" | "contour" | "surface";
export const PLOT_KINDS: readonly PlotKind[] = ["fx", "parametric", "polar", "dualy", "contour", "surface"];

/** Everything the Plot section's fields hold, as typed. */
export interface PlotKindInput {
  kind: PlotKind;
  fn: string;
  fn2: string;
  xmin: string;
  xmax: string;
  tmin: string;
  tmax: string;
  ymin: string;
  ymax: string;
  angleUnit: "deg" | "rad";
  data: string;
  title: string;
  xlabel: string;
  ylabel: string;
  y2label: string;
  zlabel: string;
  xscale: AxisScale;
  yscale: AxisScale;
  y2scale: AxisScale;
  equal: boolean;
  levels: string;
  filled: boolean;
  grid: string;
  az: string;
  el: string;
  surfaceStyle: SurfaceStyle;
}

export type PlotKindResult =
  | {
      ok: true;
      svg: string;
      /**
       * The same figure on a canvas w units wide (figure styles re-render with it). A black-and-white
       * style (USPTO, 37 CFR 1.84(a)(1)) gets the figure drawn as black line art; a figure whose values
       * need shading (filled contour bands, a filled surface) THROWS a named refusal that says what to
       * change, which prepareFigure and the panel tray report.
       */
      render: (w: number, style?: FigureStylePreset) => string;
      /** Already drawn INTO the figure; the pane may repeat them beside it. */
      notes: string[];
      alt: string;
      /** Table→Chart kind for a style's refusal list; the plot kinds answer black and white themselves (render). */
      chartKind?: string;
    }
  | { ok: false; error: string };

const DEFAULT_W = 380;
const PARAMETRIC_SAMPLES = 800;
const POLAR_SAMPLES = 1000;
const CONTOUR_GRID_DEFAULT = 60;
const SURFACE_GRID_DEFAULT = 40;

const PI_CHAR = String.fromCharCode(0x3c0);
const MINUS_CHAR = String.fromCharCode(0x2212);

/**
 * A range bound: a number or a constant expression ("2*pi", "−pi/2", "2π").
 * Null when it is not one.
 */
export function readBound(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  try {
    // compileExpr folds U+2212, π and θ (plot.ts foldPlotSymbols): "−pi/2", "2π".
    const v = compileExpr(s, [])([]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** A plain decimal number as typed: parseFloat and the grammar agree on every one of these. */
const PLAIN_NUMBER = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;

/**
 * The y = f(x) x-range fields. A plain number is read by parseFloat exactly as
 * it always was (byte-identical bounds for every plain number, "5." included);
 * anything else is read as a constant expression ("2*pi", "−π/2") by readBound,
 * and text that is neither is null — it is REFUSED, where parseFloat used to
 * truncate "2pi" to 2 and "1,5" to 1 without a word.
 */
export function readRangeBound(text: string): number | null {
  if (PLAIN_NUMBER.test(text)) {
    const v = parseFloat(text);
    return Number.isFinite(v) ? v : null;
  }
  return readBound(text);
}

/** Shown in messages and alt text: carets as superscripts, * as ·, U+2212. */
function shown(expr: string): string {
  return mcDisplayFormula(expr.trim());
}

/**
 * Compiles one formula for a kind: folds θ → theta, strips the kind's own
 * definition prefix ("z =", "f(x, y) =", "r(θ) =", "x(t) ="), refuses an
 * equation. Returns the evaluator or a message.
 */
export function compileKindExpr(raw: string, what: string, prefix: RegExp, vars: readonly string[]): CompiledExpr | string {
  // θ, π and U+2212 are folded first (plot.ts foldPlotSymbols), so "r(θ) =" and
  // "cos(2θ)" read as written.
  let s = foldPlotSymbols(raw.trim());
  if (!s) return `Enter ${what}.`;
  const m = prefix.exec(s);
  if (m) s = s.slice(m[0].length);
  if (s.includes("=")) return `${what} must be a formula, not an equation (write it as ${what.split(" ")[0]} = …).`;
  try {
    return compileExpr(s, vars);
  } catch (e) {
    const msg = (e as Error).message.split("-").join(MINUS_CHAR);
    // "2x", "3theta": the grammar needs * between a number and a name, and says so.
    const implicit = /(?<![A-Za-z_\d.])\d+\.?\d*\s*[A-Za-z_(]/.exec(s.replace(/\d*\.?\d+[eE][-+]?\d+/g, "1"));
    const hint = implicit ? ` Write * for multiplication (2*${vars[0] ?? "x"}, not 2${vars[0] ?? "x"}).` : "";
    return `Could not read ${what}: ${msg}.${hint}`;
  }
}

const PREFIX = {
  x: /^\s*x\s*(?:\(\s*t\s*\))?\s*=/,
  y: /^\s*y\s*(?:\(\s*t\s*\))?\s*=/,
  r: /^\s*r\s*(?:\(\s*(?:theta|t)\s*\))?\s*=/,
  z: /^\s*(?:z|f)\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=/,
};

function range(lo: string, hi: string, name: string): { lo: number; hi: number } | string {
  const a = readBound(lo);
  const b = readBound(hi);
  if (a === null || b === null || !(b > a)) return `Set a valid ${name} range (from < to; a number or an expression such as 2*pi).`;
  // Both ends finite is not enough: −1e308 to 1e308 spans Infinity, and every sample
  // position would come out NaN.
  if (!Number.isFinite(b - a)) return `The ${name} range is too wide to sample; narrow it.`;
  return { lo: a, hi: b };
}

function gridSize(text: string, def: number, cap: number): number | string {
  const t = text.trim();
  if (!t) return def;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 5 || n > cap) return `Grid points per side must be a whole number from 5 to ${cap}.`;
  return n;
}

/** Most vertices a contour figure may hold (≈ 12 bytes each in the SVG: about 4 MB). */
export const CONTOUR_VERTEX_BUDGET = 330_000;

/** A black-and-white figure style (USPTO): the figure is drawn as black line art. */
const isBw = (style?: FigureStylePreset): boolean => style?.color === "bw";

/**
 * plot.ts figures in black and white: solidformChart.blackAndWhite (the existing convention: grey
 * frame, ticks and lettering made black, the light grid left out), plus the two paints it does not
 * meet in these figures: the minor log-axis grid (#f5f5f5, left out) and the legend frame (#ccc).
 */
function plotBlackAndWhite(svg: string): string {
  return blackAndWhite(svg)
    .replace(/<line [^>]*stroke="#f5f5f5"[^>]*\/>/g, "")
    .replace(/(stroke|fill)="#(?:ccc|222)"/g, '$1="#000"');
}

/** No finite z on the grid (Release D item 3: the advice names what to change). */
export const NO_FINITE_Z =
  "z has no finite value anywhere in the rectangle; move the x and y ranges to where the formula is defined (log and sqrt need positive arguments).";

/** Why a figure that needs shading is not drawn in black and white, and what to change (Release D item 3). */
export const BW_FILLED_CONTOUR =
  "filled contour bands carry z in shading, and 37 CFR 1.84(a)(1) requires black-and-white line art. Turn off Filled bands: the contour lines are then drawn in black with each level written on its line";
export const BW_FILLED_SURFACE =
  "a filled surface carries z in colour, and 37 CFR 1.84(a)(1) requires black-and-white line art. Choose the Wireframe surface style: it is drawn as black line art with hidden lines removed";

function jumpNote(g: Grid, what: string): string {
  const n = g.jumps ?? 0;
  return `z jumps (a pole or a step) inside ${n} grid cell${n === 1 ? "" : "s"}; ${what}.`;
}

function holeCount(g: Grid): string {
  return `${g.holes} of ${g.xs.length * g.ys.length}`;
}

/** Builds the figure for any kind but "fx" (which the pane draws itself). */
export function buildPlotKind(inp: PlotKindInput): PlotKindResult {
  switch (inp.kind) {
    case "parametric":
      return parametric(inp);
    case "polar":
      return polar(inp);
    case "dualy":
      return dualy(inp);
    case "contour":
      return contour(inp);
    case "surface":
      return surface(inp);
    default:
      return { ok: false, error: "y = f(x) is drawn by the Plot tool itself." };
  }
}

// --- parametric ---------------------------------------------------------------

/**
 * A parametric curve through the ordinary plotter (buildPlotSvg), with EQUAL
 * SCALES on x and y when the curve's proportions allow: a circle must look like
 * a circle. The plotter has no aspect option, so the canvas HEIGHT is solved
 * for: its margins do not depend on the height, so one measuring render gives
 * the frame width and the height that makes one unit the same length on both
 * axes.
 */
export function parametricPlotSvg(series: Series[], opts: Parameters<typeof buildPlotSvg>[1] & { equal?: boolean }, w: number): string {
  const base = { ...opts, width: w, height: Math.round((270 * w) / 380) };
  const pts = series.flatMap((s) => s.points);
  const linear = opts?.xScale !== "log" && opts?.yScale !== "log";
  if (!opts?.equal || !linear || !pts.length) return buildPlotSvg(series, base);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xspan = Math.max(...xs) - Math.min(...xs);
  const yspan = (Math.max(...ys) - Math.min(...ys)) * 1.12; // the plotter pads y by 6% each side
  if (!(xspan > 0) || !(yspan > 0)) return buildPlotSvg(series, base);
  const first = buildPlotSvg(series, base);
  const frame = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="#888"/.exec(first);
  if (!frame) return first;
  const pw = Number(frame[3]);
  const ph = Number(frame[4]);
  const want = (pw * yspan) / xspan;
  const H = (base.height as number) + (want - ph);
  const lo = Math.round(0.45 * w);
  const hi = Math.round(1.5 * w);
  if (H < lo || H > hi) {
    return buildPlotSvg(series, {
      ...base,
      height: Math.max(lo, Math.min(hi, Math.round(H))),
      notes: [...(base.notes ?? []), "x and y are drawn to different scales (the curve is too long and thin for equal scales)."],
    });
  }
  return buildPlotSvg(series, { ...base, height: Math.round(H * 100) / 100 });
}

function parametric(inp: PlotKindInput): PlotKindResult {
  const fx = compileKindExpr(inp.fn, "x(t)", PREFIX.x, ["t"]);
  if (typeof fx === "string") return { ok: false, error: fx };
  const fy = compileKindExpr(inp.fn2, "y(t)", PREFIX.y, ["t"]);
  if (typeof fy === "string") return { ok: false, error: fy };
  const r = range(inp.tmin, inp.tmax, "t");
  if (typeof r === "string") return { ok: false, error: r };
  const n = PARAMETRIC_SAMPLES;
  const segs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const t = i === n - 1 ? r.hi : r.lo + ((r.hi - r.lo) * i) / (n - 1);
    const x = fx([t]);
    const y = fy([t]);
    if (Number.isFinite(x) && Number.isFinite(y)) cur.push({ x, y });
    else {
      bad++;
      if (cur.length) segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  if (!segs.length) return { ok: false, error: "x(t) and y(t) have no finite values together anywhere in the t range." };
  const colour = "#1f77b4";
  let series: Series[] = segs.map((points) => ({ points, type: "line", color: colour }));
  const notes: string[] = [];
  if (bad) notes.push(`x(t) or y(t) has no finite value at ${bad} of ${n} values of t; the curve is broken there.`);
  const opts = {
    title: inp.title.trim(),
    xlabel: inp.xlabel.trim() || "x",
    ylabel: inp.ylabel.trim() || "y",
    xScale: inp.xscale,
    yScale: inp.yscale,
  };
  const filtered = dropForScales(series, opts);
  if (filtered.dropped > 0) {
    notes.push(`${filtered.dropped} point${filtered.dropped === 1 ? "" : "s"} not plotted: a logarithmic ${filtered.axes.join(" and ")} axis cannot show zero or negative values.`);
  }
  series = filtered.series.filter((s) => s.points.length);
  if (!series.length) return { ok: false, error: "Nothing left to plot: every point is zero or negative, which a logarithmic axis cannot show." };
  const black: Series[] = series.map((sr) => ({ ...sr, color: "#000" }));
  const render = (w: number, style?: FigureStylePreset): string =>
    isBw(style) ? plotBlackAndWhite(parametricPlotSvg(black, { ...opts, notes, equal: inp.equal }, w)) : parametricPlotSvg(series, { ...opts, notes, equal: inp.equal }, w);
  return {
    ok: true,
    svg: render(DEFAULT_W),
    render,
    notes,
    alt: `Parametric plot: x = ${shown(inp.fn)}, y = ${shown(inp.fn2)}, t from ${fmtValue(r.lo)} to ${fmtValue(r.hi)}`,
  };
}

// --- polar --------------------------------------------------------------------

function polar(inp: PlotKindInput): PlotKindResult {
  const f = compileKindExpr(inp.fn, "r(θ)", PREFIX.r, ["theta", "t"]);
  if (typeof f === "string") return { ok: false, error: f };
  const r = range(inp.tmin, inp.tmax, "θ");
  if (typeof r === "string") return { ok: false, error: r };
  const k = inp.angleUnit === "deg" ? Math.PI / 180 : 1;
  const t0 = r.lo * k;
  const t1 = r.hi * k;
  // Over 100 turns a polar plot is a solid disc; refuse rather than sample it thinly.
  if (t1 - t0 > 200 * Math.PI) return { ok: false, error: "The θ range is more than 100 full turns; narrow it." };
  const n = Math.min(POLAR_SAMPLES_MAX, Math.max(POLAR_SAMPLES, Math.ceil(((t1 - t0) / (2 * Math.PI)) * 360)));
  const ev: CompiledExpr = (v) => f([v[0], v[0]]);
  const samples = samplePolar(ev, t0, t1, n);
  const finite = samples.filter((s) => Number.isFinite(s.r));
  if (!finite.length) return { ok: false, error: "r(θ) has no finite value anywhere in the θ range." };
  const notes: string[] = [];
  const bad = samples.length - finite.length;
  if (bad) notes.push(`r has no finite value at ${bad} of ${samples.length} values of θ; the curve is broken there.`);
  const title = inp.title.trim();
  const render = (w: number, style?: FigureStylePreset): string => polarPlotSvg({ samples, angleUnit: inp.angleUnit, title, notes, width: w, bw: isBw(style) });
  const svg = render(DEFAULT_W);
  // polarPlotSvg writes this one into the figure itself; repeated for the pane.
  // The units sentence is for the pane only (the angle labels show the unit in the figure).
  const shownNotes = [...notes, `θ in the formula is in radians; the θ range and angle labels are in ${inp.angleUnit === "deg" ? "degrees" : "radians"}.`];
  if (finite.some((s) => s.r < 0)) shownNotes.push("Where r < 0 the point is drawn at angle θ + π (the standard convention).");
  const unit = inp.angleUnit === "deg" ? "°" : "";
  return { ok: true, svg, render, notes: shownNotes, alt: `Polar plot: r = ${shown(inp.fn)}, θ from ${fmtValue(r.lo)}${unit} to ${fmtValue(r.hi)}${unit}` };
}

// --- two y axes ---------------------------------------------------------------

function dualy(inp: PlotKindInput): PlotKindResult {
  const rows = parseDualData(inp.data);
  if (rows.refusal) return { ok: false, error: rows.refusal };
  if (!rows.left.length || !rows.right.length) {
    return { ok: false, error: "Enter data as x y₁ y₂ per line (both series need at least one value; write - for a missing one)." };
  }
  const notes: string[] = [];
  if (rows.skipped.length) notes.push(`${rows.skipped.length} line${rows.skipped.length === 1 ? "" : "s"} left out: no x value, or neither y₁ nor y₂.`);
  if (rows.extraColumns) notes.push(`${rows.extraColumns} line${rows.extraColumns === 1 ? " has" : "s have"} more than three columns; only x, y₁ and y₂ (the first three) are plotted.`);
  if (rows.commaNote) notes.push(rows.commaNote);
  const base = {
    left: rows.left,
    right: rows.right,
    xScale: inp.xscale,
    leftScale: inp.yscale,
    rightScale: inp.y2scale,
    title: inp.title.trim(),
    xlabel: inp.xlabel.trim(),
    leftLabel: inp.ylabel.trim(),
    rightLabel: inp.y2label.trim(),
  };
  const d = dropForDualScales(base);
  const spanOk = (v: number[], log: boolean): boolean => {
    const t = v.map((q) => (log ? Math.log10(q) : q));
    return !t.length || Number.isFinite((Math.max(...t) - Math.min(...t)) * 1.2);
  };
  if (
    !spanOk([...d.fig.left, ...d.fig.right].map((q) => q.x), inp.xscale === "log") ||
    !spanOk(d.fig.left.map((q) => q.y), inp.yscale === "log") ||
    !spanOk(d.fig.right.map((q) => q.y), inp.y2scale === "log")
  ) {
    return { ok: false, error: "The values span too wide a range to draw on a linear axis (beyond about 10³⁰⁷); use a log axis or rescale the data." };
  }
  if (d.dropped) notes.push(`${d.dropped} point${d.dropped === 1 ? "" : "s"} not plotted: a logarithmic axis cannot show zero or negative values.`);
  if (!d.fig.left.length || !d.fig.right.length) return { ok: false, error: "Nothing left to plot on one of the axes: a logarithmic axis cannot show zero or negative values." };
  const render = (w: number, style?: FigureStylePreset): string => dualAxisPlotSvg({ ...d.fig, notes, width: w, height: Math.round((270 * w) / 380), bw: isBw(style) });
  return {
    ok: true,
    svg: render(DEFAULT_W),
    render,
    notes,
    alt: `Plot with two y axes: ${base.leftLabel || "series 1"} (left) and ${base.rightLabel || "series 2"} (right) against ${base.xlabel || "x"}`,
  };
}

// --- contour ------------------------------------------------------------------

/** Contour levels from the field: blank = automatic, else a list of numbers. */
export function readLevels(text: string, lo: number, hi: number): { levels: number[]; notes: string[] } | string {
  const t = text.trim();
  if (!t) {
    const lv = niceLevels(lo, hi, 8);
    return lv.length ? { levels: lv, notes: [] } : "z varies too little over the rectangle for automatic levels; type the levels to draw in Levels (for example 0.1 0.2 0.3).";
  }
  const r = readNumberList(t);
  // A lone "1,000,500" (two levels, or one) is asked, never read as a list in silence (fix round 3 N1).
  if (r.ambiguous) return `Levels: ${r.ambiguous}`;
  if (r.dropped.length) return `Could not read the level${r.dropped.length === 1 ? "" : "s"} ${r.dropped.map((d) => `“${d}”`).join(", ")}; write numbers separated by spaces or commas.`;
  const levels = [...new Set(r.values)].sort((a, b) => a - b);
  if (!levels.length) return "Enter at least one level, or leave the field blank for automatic levels.";
  if (levels.length > CONTOUR_LEVELS_MAX) return `At most ${CONTOUR_LEVELS_MAX} levels.`;
  const outside = levels.filter((v) => v < lo || v > hi);
  const notes: string[] = [];
  const [tlo, thi] = rangeText(lo, hi);
  if (outside.length) {
    notes.push(`No contour at ${outside.map(fmtValue).join(", ")}: outside the z range ${tlo} to ${thi} on this grid.`);
  }
  // A level equal to the grid's own minimum or maximum is touched only at grid
  // points: there is no line to draw, and the figure says so instead of nothing.
  const touch = levels.filter((v) => v === lo || v === hi);
  if (touch.length) {
    notes.push(`No line at ${touch.map(fmtValue).join(", ")}: z only reaches ${touch.length === 1 ? "it" : "them"} at its ${touch.every((v) => v === lo) ? "minimum" : touch.every((v) => v === hi) ? "maximum" : "minimum and maximum"} on this grid.`);
  }
  return { levels, notes };
}

function readGridFor(inp: PlotKindInput, cap: number, def: number): { f: CompiledExpr; xr: { lo: number; hi: number }; yr: { lo: number; hi: number }; n: number } | string {
  const f = compileKindExpr(inp.fn, "z = f(x, y)", PREFIX.z, ["x", "y"]);
  if (typeof f === "string") return f;
  const xr = range(inp.xmin, inp.xmax, "x");
  if (typeof xr === "string") return xr;
  const yr = range(inp.ymin, inp.ymax, "y");
  if (typeof yr === "string") return yr;
  const n = gridSize(inp.grid, def, cap);
  if (typeof n === "string") return n;
  return { f, xr, yr, n };
}

function contour(inp: PlotKindInput): PlotKindResult {
  const g0 = readGridFor(inp, CONTOUR_GRID_MAX, CONTOUR_GRID_DEFAULT);
  if (typeof g0 === "string") return { ok: false, error: g0 };
  const grid = sampleGrid(g0.f, g0.xr.lo, g0.xr.hi, g0.yr.lo, g0.yr.hi, g0.n, g0.n, CONTOUR_GRID_MAX, false);
  const zr = gridRange(grid);
  if (!zr) return { ok: false, error: NO_FINITE_Z };
  if (isFlat(zr.lo, zr.hi)) return { ok: false, error: `z is constant (${fmtValue(zr.lo)}${zr.lo === zr.hi ? "" : ", to within rounding"}) over the whole rectangle, so it has no contours. Check the formula, or widen the x and y ranges to take in a region where z changes.` };
  if (!Number.isFinite(zr.hi - zr.lo)) return { ok: false, error: "z spans too wide a range to contour (beyond about 10³⁰⁷); rescale the formula." };
  const lv = readLevels(inp.levels, zr.lo, zr.hi);
  if (typeof lv === "string") return { ok: false, error: lv };
  // RULE C: labels that cannot be told apart (or do not read back as their levels) are refused, never printed.
  if (!levelLabels(lv.levels)) return { ok: false, error: "The levels are too close together to label distinctly; choose levels further apart." };
  // The figure's own words for a hole: grey as drawn, hatched in black and white.
  const notesFor = (bw: boolean): string[] => {
    const out = [...lv.notes];
    if (grid.holes) out.push(`z has no finite value at ${holeCount(grid)} grid points (${bw ? "hatched" : "grey"}); no contour is drawn through them.`);
    if (grid.jumps) out.push(jumpNote(grid, `they are ${bw ? "hatched" : "grey"} and no contour is drawn across them`));
    return out;
  };
  const notes = [...lv.notes];
  if (grid.holes) notes.push(`z has no finite value at ${holeCount(grid)} grid points (grey); no contour is drawn through them.`);
  // THE SIZE BUDGET, on work rather than time: the pieces are computed once,
  // here, and a figure that would hold more than CONTOUR_VERTEX_BUDGET vertices
  // (about 4 MB of SVG) is refused before any of it is drawn. The fill stops
  // computing as soon as it passes the budget.
  // Estimated first (a count of straddling edges, milliseconds): past the budget, refuse before tracing.
  const estimate = estimateLineVertices(grid, lv.levels, CONTOUR_VERTEX_BUDGET * 2);
  if (estimate > CONTOUR_VERTEX_BUDGET || (inp.filled && 2 * estimate > CONTOUR_VERTEX_BUDGET)) {
    return {
      ok: false,
      error: `This contour is too detailed to draw (over about 4 MB of figure): use a smaller grid or fewer levels${inp.filled ? ", or turn off Filled bands" : ""}.`,
    };
  }
  markJumps(grid, g0.f); // deferred until the size estimate has passed (sampleGrid jumps: false above)
  if (grid.jumps) notes.push(jumpNote(grid, "they are grey and no contour is drawn across them"));
  const lines = marchingSquares(grid, lv.levels);
  const lineVerts = lines.reduce((a, l) => a + l.paths.reduce((b, q) => b + q.pts.length, 0), 0);
  const bands = inp.filled ? isobands(grid, lv.levels, CONTOUR_VERTEX_BUDGET - lineVerts) : undefined;
  if (lineVerts > CONTOUR_VERTEX_BUDGET || bands === null) {
    return {
      ok: false,
      error: `This contour is too detailed to draw (over about 4 MB of figure): use a smaller grid or fewer levels${inp.filled ? ", or turn off Filled bands" : ""}.`,
    };
  }
  const title = inp.title.trim();
  const bwNotes = notesFor(true);
  const render = (w: number, style?: FigureStylePreset): string => {
    if (!isBw(style))
      return contourPlotSvg({ grid, levels: lv.levels, filled: inp.filled, title, xlabel: inp.xlabel.trim(), ylabel: inp.ylabel.trim(), zlabel: inp.zlabel.trim(), notes, width: w, lines, bands });
    if (inp.filled) throw new Error(BW_FILLED_CONTOUR);
    // Black and white writes each level on its line at USPTO lettering (3.5 mm), which crowds a
    // figure 17 cm wide. AUTOMATIC levels thin out (about 8, then 5, then 3 nice levels) until every
    // level has room for its value ON its line; a level that still has none (or a typed level without room) is
    // drawn without a label and the figure says so. A label is never placed off its own line.
    const sets = bwLevelSets();
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      try {
        return contourPlotSvg({ grid, levels: set.levels, filled: false, title, xlabel: inp.xlabel.trim(), ylabel: inp.ylabel.trim(), zlabel: inp.zlabel.trim(), notes: bwNotes, width: w, lines: set.lines, bw: true, dropUnlabelled: i === sets.length - 1 });
      } catch (e) {
        if (!(e instanceof ContourLabelError) || i === sets.length - 1) throw e;
      }
    }
    throw new Error("no contour levels");
  };
  // Narrowed values captured for the lazily built level sets (a nested function loses the narrowing).
  const autoLevels = lv.levels;
  const zLo = zr.lo;
  const zHi = zr.hi;
  let bwSets: { levels: number[]; lines: ReturnType<typeof marchingSquares> }[] | null = null;
  const bwLevelSets = (): { levels: number[]; lines: ReturnType<typeof marchingSquares> }[] => {
    if (bwSets) return bwSets;
    const sets = [{ levels: autoLevels, lines }];
    if (!inp.levels.trim()) {
      for (const target of [5, 3]) {
        const lvls = niceLevels(zLo, zHi, target);
        if (lvls.length && lvls.length < sets[sets.length - 1].levels.length && levelLabels(lvls)) sets.push({ levels: lvls, lines: marchingSquares(grid, lvls) });
      }
    }
    bwSets = sets;
    return sets;
  };
  return {
    ok: true,
    svg: render(DEFAULT_W),
    render,
    // The grid line is for the pane; the figure keeps only the caveats.
    notes: [...notes, `Grid ${grid.xs.length} × ${grid.ys.length}; z from ${rangeText(zr.lo, zr.hi).join(" to ")}.`],
    alt: `Contour plot: z = ${shown(inp.fn)}, ${lv.levels.length} level${lv.levels.length === 1 ? "" : "s"}`,
  };
}

// --- surface ------------------------------------------------------------------

function surface(inp: PlotKindInput): PlotKindResult {
  const g0 = readGridFor(inp, SURFACE_GRID_MAX, SURFACE_GRID_DEFAULT);
  if (typeof g0 === "string") return { ok: false, error: g0 };
  const az = inp.az.trim() ? readBound(inp.az) : -60;
  const el = inp.el.trim() ? readBound(inp.el) : 30;
  if (az === null) return { ok: false, error: "Azimuth must be a number of degrees." };
  if (el === null || el < 0 || el > 90) return { ok: false, error: "Elevation must be from 0° to 90° (views from below are not drawn)." };
  const grid = sampleSurface(g0.f, g0.xr.lo, g0.xr.hi, g0.yr.lo, g0.yr.hi, g0.n);
  const zr = gridRange(grid);
  if (!zr) return { ok: false, error: NO_FINITE_Z };
  if (!Number.isFinite(zr.hi - zr.lo)) return { ok: false, error: "z spans too wide a range to draw (beyond about 10³⁰⁷); rescale the formula." };
  if (isFlat(zr.lo, zr.hi) && zr.lo !== zr.hi) {
    // Float noise (sin² x + cos² x) stretched to the full z axis would be drawn as terrain.
    return { ok: false, error: `z is constant (${fmtValue(zr.lo)}) to within rounding over the whole rectangle; there is no surface shape to draw. Check the formula (it may simplify to a constant), or widen the x and y ranges.` };
  }
  const notes: string[] = [];
  if (grid.holes) notes.push(`z has no finite value at ${holeCount(grid)} grid points; the surface has a gap there.`);
  if (grid.jumps) notes.push(jumpNote(grid, "the surface is broken there rather than drawn as a wall"));
  const title = inp.title.trim();
  const render = (w: number, style?: FigureStylePreset): string => {
    if (isBw(style) && inp.surfaceStyle !== "wireframe") throw new Error(BW_FILLED_SURFACE);
    return surfacePlotSvg({
      grid,
      azimuthDeg: az,
      elevationDeg: el,
      style: inp.surfaceStyle,
      title,
      xlabel: inp.xlabel.trim(),
      ylabel: inp.ylabel.trim(),
      zlabel: inp.zlabel.trim(),
      notes,
      width: w,
      bw: isBw(style),
    });
  };
  // A title with no clear spot beside the box is refused by name (the figure is never drawn with it over the box).
  let svg: string;
  try {
    svg = render(DEFAULT_W);
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, error: m.charAt(0).toUpperCase() + m.slice(1) + "." };
  }
  return {
    ok: true,
    svg,
    render,
    notes,
    alt: `Surface plot: z = ${shown(inp.fn)}, viewed from azimuth ${fmtValue(az)}°, elevation ${fmtValue(el)}°`,
    // Filled faces carry z in colour: under a black-and-white style render refuses them with advice (BW_FILLED_SURFACE).
  };
}

// ---------------------------------------------------------------------------
// The Plot section's fields (the pane's markup, src/taskpane/taskpane.html).

/** Which elements each kind shows; every other id in PLOT_KIND_TOGGLED is hidden. */
const SHOWN: Record<PlotKind, string[]> = {
  fx: ["plot-fn-row", "plot-x-row", "plot-data-label", "plot-data", "plot-scale-row", "plot-errbars-label", "plot-errbars"],
  parametric: ["plot-fn-row", "plot-fn2-row", "plot-t-row", "plot-scale-row"],
  polar: ["plot-fn-row", "plot-t-row", "plot-angle-label", "plot-angle-unit"],
  dualy: ["plot-data-label", "plot-data", "plot-scale-row", "plot-y2-row"],
  contour: ["plot-fn-row", "plot-x-row", "plot-y-row", "plot-z-row", "plot-contour-row"],
  surface: ["plot-fn-row", "plot-x-row", "plot-y-row", "plot-z-row", "plot-surface-row"],
};

/** Every element whose visibility depends on the kind. */
export const PLOT_KIND_TOGGLED: readonly string[] = [
  "plot-fn-row",
  "plot-fn2-row",
  "plot-x-row",
  "plot-t-row",
  "plot-angle-label",
  "plot-angle-unit",
  "plot-y-row",
  "plot-z-row",
  "plot-data-label",
  "plot-data",
  "plot-scale-row",
  "plot-errbars-label",
  "plot-errbars",
  "plot-y2-row",
  "plot-contour-row",
  "plot-surface-row",
];

/** The function field's label and placeholder per kind (fx = the markup's own text). */
export const FN_LABEL: Record<PlotKind, { label: string; placeholder: string }> = {
  fx: { label: "Function y = f(x) (separate multiple with ;)", placeholder: "e.g. sin(x)/x ; x^2 ; exp(-x^2)" },
  parametric: { label: "x(t) =", placeholder: "e.g. cos(t)" },
  polar: { label: "r(θ) = (θ in radians in the formula; write theta or θ)", placeholder: "e.g. cos(3*theta)" },
  dualy: { label: "", placeholder: "" },
  contour: { label: "z = f(x, y)", placeholder: "e.g. x^2 + y^2" },
  surface: { label: "z = f(x, y)", placeholder: "e.g. sin(x)*cos(y)" },
};

/** The data field's label per kind. */
export const DATA_LABEL: Record<"fx" | "dualy", string> = {
  fx: "Data (x y [err] per line)",
  dualy: "Data (x y₁ y₂ per line; - for a missing value)",
};

/** Ids the plot-kind fields add to the section (all read by readPlotKindInput). */
export const PLOT_KIND_INPUT_IDS: readonly string[] = [
  "plot-kind",
  "plot-fn2",
  "plot-equal",
  "plot-tmin",
  "plot-tmax",
  "plot-angle-unit",
  "plot-ymin",
  "plot-ymax",
  "plot-grid",
  "plot-zlabel",
  "plot-y2label",
  "plot-y2scale",
  "plot-levels",
  "plot-filled",
  "plot-az",
  "plot-el",
  "plot-surface-style",
];

function el<T extends HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}
const val = (doc: Document, id: string): string => el<HTMLInputElement>(doc, id)?.value ?? "";
const checked = (doc: Document, id: string): boolean => !!el<HTMLInputElement>(doc, id)?.checked;

/** The kind the select shows ("fx" when the select is missing or unknown). */
export function currentPlotKind(doc: Document): PlotKind {
  const v = val(doc, "plot-kind") as PlotKind;
  return PLOT_KINDS.includes(v) ? v : "fx";
}

/** Reads every Plot field into a PlotKindInput. */
export function readPlotKindInput(doc: Document): PlotKindInput {
  const scale = (id: string): AxisScale => (val(doc, id) === "log" ? "log" : "linear");
  return {
    kind: currentPlotKind(doc),
    fn: val(doc, "plot-fn"),
    fn2: val(doc, "plot-fn2"),
    xmin: val(doc, "plot-xmin"),
    xmax: val(doc, "plot-xmax"),
    tmin: val(doc, "plot-tmin"),
    tmax: val(doc, "plot-tmax"),
    ymin: val(doc, "plot-ymin"),
    ymax: val(doc, "plot-ymax"),
    angleUnit: val(doc, "plot-angle-unit") === "deg" ? "deg" : "rad",
    data: val(doc, "plot-data"),
    title: val(doc, "plot-title"),
    xlabel: val(doc, "plot-xlabel"),
    ylabel: val(doc, "plot-ylabel"),
    y2label: val(doc, "plot-y2label"),
    zlabel: val(doc, "plot-zlabel"),
    xscale: scale("plot-xscale"),
    yscale: scale("plot-yscale"),
    y2scale: scale("plot-y2scale"),
    equal: checked(doc, "plot-equal"),
    levels: val(doc, "plot-levels"),
    filled: checked(doc, "plot-filled"),
    grid: val(doc, "plot-grid"),
    az: val(doc, "plot-az"),
    el: val(doc, "plot-el"),
    surfaceStyle: val(doc, "plot-surface-style") === "wireframe" ? "wireframe" : "filled",
  };
}

/** Each kind's own formula text, kept while the user switches kinds. */
const fnByKind = new WeakMap<Document, Partial<Record<PlotKind, string>>>();
const lastKind = new WeakMap<Document, PlotKind>();
const dataByKind = new WeakMap<Document, Partial<Record<"fx" | "dualy", string>>>();
const lastDataKind = new WeakMap<Document, "fx" | "dualy">();

/** Shows the fields the current kind uses, relabels the formula field, and keeps each kind's formula. */
export function applyPlotKindUi(doc: Document): PlotKind {
  const kind = currentPlotKind(doc);
  const shown = new Set(SHOWN[kind]);
  for (const id of PLOT_KIND_TOGGLED) {
    const e = el(doc, id);
    if (e) e.hidden = !shown.has(id);
  }
  const fn = el<HTMLInputElement>(doc, "plot-fn");
  const prev = lastKind.get(doc) ?? "fx";
  if (fn && prev !== kind) {
    const store = fnByKind.get(doc) ?? {};
    store[prev] = fn.value;
    fnByKind.set(doc, store);
    // A kind not used yet starts empty (its placeholder shows an example):
    // y = f(x) text is rarely a valid r(θ) or x(t).
    fn.value = store[kind] ?? "";
  }
  const data = el<HTMLTextAreaElement>(doc, "plot-data");
  const dataKind = (k: PlotKind): "fx" | "dualy" | null => (k === "fx" || k === "dualy" ? k : null);
  const lastData = lastDataKind.get(doc) ?? "fx";
  const nextData = dataKind(kind);
  // THE DATA BOX IS KEPT PER KIND: the same lines mean x y err to one and x y₁ y₂ to
  // the other, so carrying them across would draw error bars as a series (or back).
  if (data && nextData && nextData !== lastData) {
    const store = dataByKind.get(doc) ?? {};
    store[lastData] = data.value;
    dataByKind.set(doc, store);
    data.value = store[nextData] ?? "";
  }
  if (nextData) lastDataKind.set(doc, nextData);
  lastKind.set(doc, kind);
  const lab = el(doc, "plot-fn-label");
  if (lab && FN_LABEL[kind].label) lab.textContent = FN_LABEL[kind].label;
  if (fn && FN_LABEL[kind].placeholder) fn.placeholder = FN_LABEL[kind].placeholder;
  const dl = el(doc, "plot-data-label");
  if (dl) dl.textContent = kind === "dualy" ? DATA_LABEL.dualy : DATA_LABEL.fx;
  const tl = el(doc, "plot-tmin-label");
  if (tl) tl.textContent = kind === "polar" ? "θ from" : "t from";
  return kind;
}

/** Switching degrees ↔ radians converts a θ range still at its full-turn default. */
export function convertAngleDefaults(doc: Document): void {
  const unit = val(doc, "plot-angle-unit");
  const hi = el<HTMLInputElement>(doc, "plot-tmax");
  if (!hi) return;
  const v = hi.value.trim().split(" ").join("");
  if (unit === "deg" && (v === "2*pi" || v === "2pi" || v === "2" + PI_CHAR)) hi.value = "360";
  else if (unit === "rad" && v === "360") hi.value = "2*pi";
}

/** Reads the fields and builds the figure for the current kind (never "fx"). */
export function renderPlotKind(doc: Document): PlotKindResult {
  return buildPlotKind(readPlotKindInput(doc));
}

/**
 * Wires the kind select and the new fields to `onChange` (the pane's preview).
 * The y = f(x) fields keep the listeners the pane already gives them.
 */
export function initPlotKinds(doc: Document, onChange: () => void): void {
  applyPlotKindUi(doc);
  el(doc, "plot-kind")?.addEventListener("change", () => {
    applyPlotKindUi(doc);
    onChange();
  });
  el(doc, "plot-angle-unit")?.addEventListener("change", () => {
    convertAngleDefaults(doc);
    onChange();
  });
  for (const id of ["plot-fn2", "plot-tmin", "plot-tmax", "plot-ymin", "plot-ymax", "plot-grid", "plot-zlabel", "plot-y2label", "plot-levels", "plot-az", "plot-el"]) {
    el(doc, id)?.addEventListener("input", onChange);
  }
  for (const id of ["plot-y2scale", "plot-equal", "plot-filled", "plot-surface-style"]) {
    el(doc, id)?.addEventListener("change", onChange);
  }
}
