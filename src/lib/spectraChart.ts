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
import { Cosy2D, Hsqc2D } from "./nmr2d";
import { buildPlotSvg, Series, Point } from "./plot";

const WIDTH = 380;
const HEIGHT = 240;

/** Stick spectrum for a predicted 1H/13C spectrum, δ increasing leftward. */
export function nmrChartSvg(r: NmrResult): string | null {
  if (!r.signals.length) return null;
  const series: Series[] = nmrSticks(r).map((pts) => ({
    points: pts.map((p) => ({ x: -p.x, y: p.y })),
    type: "line",
    color: "#2563eb",
  }));
  const shifts = r.signals.map((s) => s.shift);
  const max = Math.max(...shifts);
  const min = Math.min(...shifts);
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
  });
}

export const SPECTRUM_CHART_SIZE = { width: WIDTH, height: HEIGHT };
export const SPECTRUM_2D_SIZE = { width: SIZE_2D, height: SIZE_2D };
