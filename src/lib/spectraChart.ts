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
import { buildPlotSvg, Series } from "./plot";

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

export const SPECTRUM_CHART_SIZE = { width: WIDTH, height: HEIGHT };
