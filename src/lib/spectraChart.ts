// Chart construction for predicted spectra.
//
// Pure: takes a prediction from nmr.ts / ir.ts / fragment.ts and returns an SVG
// string via plot.ts. Lives in lib/ (not taskpane.ts) so the axis conventions
// below are actually testable — they are easy to get backwards and a flipped
// axis silently produces a plausible-looking but wrong spectrum.
//
// Axis conventions this module is responsible for:
//   * NMR — δ increases to the LEFT (downfield left). buildPlotSvg draws x
//     ascending rightward, so shifts are negated and the label says so.
//   * IR  — wavenumber decreases to the RIGHT. Same negation trick.
//   * MS  — m/z increases rightward, the ordinary direction.

import { NmrResult, nmrSticks } from "./nmr";
import { IrBand, irTransmittanceCurve } from "./ir";
import { FragmentResult, Likelihood } from "./fragment";
import { Cosy2D, Hsqc2D, Hmbc2D, Tocsy2D } from "./nmr2d";
import { buildPlotSvg, Series, Point, fmtTick } from "./plot";
import { minOf, maxOf } from "./minmax";

const WIDTH = 380;
const HEIGHT = 240;

/**
 * A NEGATED AXIS MUST BE LABELLED BACK.
 *
 * The negation in the builders below is a DRAWING device: buildPlotSvg draws x
 * ascending rightward and nothing else, so an axis that runs the other way is fed
 * −x. The LABEL is a separate question, and it went unasked: the ticks were
 * formatted from the plotted coordinate, so every predicted spectrum in this
 * product read `-4 -3.5 -3 …` beneath "δ (ppm) — increases leftward", and IR read
 * −4000 to −500 cm⁻¹.
 *
 * That is not a figure a reader can dismiss as a glitch: δ = −3.5 ppm is a real
 * upfield-of-TMS shift and −500 cm⁻¹ is not, but both look like data. Undoing the
 * negation for the LABEL only is the whole fix, and it belongs here beside the
 * negation rather than inside the plotter, because only this module knows the
 * axis was flipped.
 */
const unflip = (v: number): string => fmtTick(-v);
/** For 1-D spectra: x is flipped, y is the ordinary direction. */
const FLIP_X = { xTickLabel: unflip } as const;
/** For 2-D maps: both shift axes are flipped. */
const FLIP_BOTH = { xTickLabel: unflip, yTickLabel: unflip } as const;

/** Stick spectrum for a predicted 1H/13C spectrum, δ increasing leftward. */
export function nmrChartSvg(r: NmrResult): string | null {
  if (!r.signals.length) return null;
  const series: Series[] = nmrSticks(r).map((pts) => ({
    points: pts.map((p) => ({ x: -p.x, y: p.y })),
    type: "line",
    color: "#2563eb",
  }));
  const shifts = r.signals.map((s) => s.shift);
  const max = maxOf(shifts);
  const min = minOf(shifts);
  // A single-signal molecule (benzene) would otherwise give a zero-width axis.
  const pad = Math.max(0.4, (max - min) * 0.08);
  series.push({
    points: [
      { x: -(max + pad), y: 0 },
      { x: -(min - pad), y: 0 },
    ],
    type: "line",
    color: "#94a3b8",
  });
  return buildPlotSvg(series, {
    title: `Predicted ${r.nucleus} NMR (estimate)`,
    xlabel: "δ (ppm) — increases leftward",
    ylabel: r.nucleus === "1H" ? "rel. integration" : "",
    width: WIDTH,
    height: HEIGHT,
    ...FLIP_X,
  });
}

/** Simulated transmittance trace, wavenumber decreasing rightward. */
export function irChartSvg(bands: IrBand[]): string | null {
  if (!bands.length) return null;
  const curve = irTransmittanceCurve(bands);
  return buildPlotSvg([{ points: curve.map((p) => ({ x: -p.x, y: p.y })), type: "line", color: "#2563eb" }], {
    title: "Predicted IR (group frequencies)",
    xlabel: "wavenumber (cm⁻¹) — decreases rightward",
    ylabel: "transmittance (%)",
    width: WIDTH,
    height: HEIGHT,
    ...FLIP_X,
  });
}

/**
 * Fragment stick plot. Stick height encodes the rule-based likelihood RANKING —
 * it is not a predicted intensity, and the title says so, because a bar chart of
 * m/z against height reads as an abundance spectrum unless told otherwise.
 */
export function msChartSvg(r: FragmentResult): string | null {
  if (!r.fragments.length) return null;
  const weight: Record<Likelihood, number> = { high: 1.0, medium: 0.6, low: 0.3 };
  const series: Series[] = r.fragments.map((f) => ({
    points: [
      { x: f.mz, y: 0 },
      { x: f.mz, y: weight[f.likelihood] },
    ],
    type: "line",
    color: "#2563eb",
  }));
  // The molecular ion, marked distinctly.
  series.push({
    points: [
      { x: r.molecularIon, y: 0 },
      { x: r.molecularIon, y: 1.0 },
    ],
    type: "line",
    color: "#dc2626",
  });
  return buildPlotSvg(series, {
    title: "Predicted EI fragments (ranking, not intensity)",
    xlabel: "m/z",
    ylabel: "rule-based likelihood",
    width: WIDTH,
    height: HEIGHT,
  });
}

// 2D maps are square and a little larger — two shift axes need the room.
const SIZE_2D = 300;

/**
 * 1H-1H COSY contour-style map. Both axes are 1H δ increasing toward the
 * top-left (the conventional NMR orientation), so shifts are negated. The
 * diagonal is drawn in grey; cross-peaks in blue, with weak (long-range)
 * correlations lightened.
 */
export function cosyChartSvg(r: Cosy2D): string | null {
  if (!r.peaks.length) return null;
  const map = (f2: number, f1: number): Point => ({ x: -f2, y: -f1 });
  const diagonal = r.peaks.filter((p) => p.kind === "diagonal").map((p) => map(p.f2, p.f1));
  const strong = r.peaks.filter((p) => p.kind === "cross" && !p.weak).map((p) => map(p.f2, p.f1));
  const weak = r.peaks.filter((p) => p.kind === "cross" && p.weak).map((p) => map(p.f2, p.f1));

  const series: Series[] = [{ points: diagonal, type: "scatter", color: "#94a3b8", label: "diagonal" }];
  if (strong.length) series.push({ points: strong, type: "scatter", color: "#2563eb", label: "cross-peak" });
  if (weak.length) series.push({ points: weak, type: "scatter", color: "#93c5fd", label: "weak (long-range)" });

  return buildPlotSvg(series, {
    title: "Predicted ¹H–¹H COSY (estimate)",
    xlabel: "δ (ppm) — increases leftward",
    ylabel: "δ (ppm) — increases downward",
    width: SIZE_2D,
    height: SIZE_2D,
    ...FLIP_BOTH,
  });
}

/**
 * 1H-13C HSQC map: 1H δ on the direct axis (F2, leftward), 13C δ on the indirect
 * axis (F1, downward). One point per protonated carbon. The C-H topology is
 * exact; only the positions carry additivity-model uncertainty.
 */
export function hsqcChartSvg(r: Hsqc2D): string | null {
  if (!r.peaks.length) return null;
  const points: Point[] = r.peaks.map((p) => ({ x: -p.f2, y: -p.f1 }));
  return buildPlotSvg([{ points, type: "scatter", color: "#2563eb", label: "¹J(C,H)" }], {
    title: "Predicted ¹H–¹³C HSQC (estimate)",
    xlabel: "δ ¹H (ppm) — increases leftward",
    ylabel: "δ ¹³C (ppm) — increases downward",
    width: SIZE_2D,
    height: SIZE_2D,
    ...FLIP_BOTH,
  });
}

/**
 * Reduces a trace to at most `budget` points for drawing.
 *
 * Stride sampling ("keep every nth point") is the obvious approach and it is
 * WRONG for a spectrum: a peak one or two points wide is exactly what the user
 * cares about, and stride sampling drops it whenever it lands between samples —
 * silently, producing a clean-looking spectrum with a missing band.
 *
 * So this keeps, for each bucket, the point with the smallest y AND the one with
 * the largest y, in their original x order. Every extremum in the source survives
 * into the drawing; only points that were never on the outline are discarded.
 */
export function decimateTrace(points: Point[], budget = 1200): Point[] {
  if (points.length <= budget) return points.slice();
  const buckets = Math.max(1, Math.floor(budget / 2));
  const per = points.length / buckets;
  const out: Point[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor(b * per);
    const hi = Math.min(points.length, Math.floor((b + 1) * per));
    if (hi <= lo) continue;
    let min = points[lo];
    let max = points[lo];
    for (let i = lo; i < hi; i++) {
      if (points[i].y < min.y) min = points[i];
      if (points[i].y > max.y) max = points[i];
    }
    // Original x order, so the polyline never doubles back on itself.
    if (min === max) out.push(min);
    else if (min.x <= max.x) out.push(min, max);
    else out.push(max, min);
  }
  return out;
}

/** What a JCAMP chart needs from a parsed spectrum — kept narrow so this module does not depend on jcamp.ts. */
export interface MeasuredTrace {
  title: string;
  kind: "ir" | "nmr" | "uvvis" | "ms" | "raman" | "unknown";
  xUnits: string;
  yUnits: string;
  points: Point[];
}

/**
 * A MEASURED spectrum, drawn exactly as the file gives it.
 *
 * The axis direction is a per-technique convention, and getting it backwards
 * produces a plausible-looking mirror image rather than an obvious error — so it
 * is decided here from the kind, and the axis label always says which way the
 * quantity increases.
 */
export function jcampChartSvg(s: MeasuredTrace): string | null {
  if (!s.points.length) return null;

  // IR, Raman and NMR are all drawn with their x quantity increasing LEFTWARD.
  // buildPlotSvg draws x ascending rightward, so those are negated.
  const flip = s.kind === "ir" || s.kind === "raman" || s.kind === "nmr";
  const pts = decimateTrace(s.points).map((p) => ({ x: flip ? -p.x : p.x, y: p.y }));

  const dir = flip ? "decreases rightward" : "increases rightward";
  const xlabel = `${s.xUnits || "x"} — ${dir}`;
  // A stick spectrum for MS, a continuous trace for everything else.
  const type: Series["type"] = s.kind === "ms" ? "scatter" : "line";

  return buildPlotSvg([{ points: pts, type, color: "#2563eb" }], {
    title: s.title ? `${s.title} (measured)` : "Measured spectrum",
    xlabel,
    ylabel: s.yUnits || "",
    width: WIDTH,
    height: HEIGHT,
    // Only the flipped kinds get the label transform; a UV-Vis or MS trace is
    // plotted in its own direction and its ticks are already the real values.
    ...(flip ? FLIP_X : {}),
  });
}

export const SPECTRUM_CHART_SIZE = { width: WIDTH, height: HEIGHT };
export const SPECTRUM_2D_SIZE = { width: SIZE_2D, height: SIZE_2D };

/**
 * 1H-13C HMBC map. Same axes as HSQC, different meaning: these are 2- and
 * 3-bond correlations, so a carbon with NO proton of its own still appears —
 * which is the reason to run the experiment at all.
 */
export function hmbcChartSvg(r: Hmbc2D): string | null {
  if (!r.peaks.length) return null;
  const strong = r.peaks.filter((p) => !p.weak).map((p) => ({ x: -p.f2, y: -p.f1 }));
  const weak = r.peaks.filter((p) => p.weak).map((p) => ({ x: -p.f2, y: -p.f1 }));
  const series: Series[] = [];
  if (strong.length) series.push({ points: strong, type: "scatter", color: "#2563eb", label: "³J(C,H)" });
  if (weak.length) series.push({ points: weak, type: "scatter", color: "#93c5fd", label: "²J (often weak)" });
  return buildPlotSvg(series, {
    title: "Predicted ¹H–¹³C HMBC (estimate)",
    xlabel: "δ ¹H (ppm) — increases leftward",
    ylabel: "δ ¹³C (ppm) — increases downward",
    width: SIZE_2D,
    height: SIZE_2D,
    ...FLIP_BOTH,
  });
}

/**
 * 1H-1H TOCSY map. Unlike COSY, a cross-peak appears between EVERY pair in a
 * spin system, so a contiguous coupled fragment shows as a filled block rather
 * than a chain of single steps.
 */
export function tocsyChartSvg(r: Tocsy2D): string | null {
  if (!r.peaks.length) return null;
  const map = (p: { f2: number; f1: number }): Point => ({ x: -p.f2, y: -p.f1 });
  const diagonal = r.peaks.filter((p) => p.kind === "diagonal").map(map);
  const direct = r.peaks.filter((p) => p.kind === "cross" && !p.weak).map(map);
  const relayed = r.peaks.filter((p) => p.kind === "cross" && p.weak).map(map);
  const series: Series[] = [{ points: diagonal, type: "scatter", color: "#94a3b8", label: "diagonal" }];
  if (direct.length) series.push({ points: direct, type: "scatter", color: "#2563eb", label: "direct" });
  if (relayed.length) series.push({ points: relayed, type: "scatter", color: "#93c5fd", label: "relayed" });
  return buildPlotSvg(series, {
    title: "Predicted ¹H–¹H TOCSY (estimate)",
    xlabel: "δ (ppm) — increases leftward",
    ylabel: "δ (ppm) — increases downward",
    width: SIZE_2D,
    height: SIZE_2D,
    ...FLIP_BOTH,
  });
}
