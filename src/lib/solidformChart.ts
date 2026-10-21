// Figures for the Solid form tool (docs/SCOPE-SOLID-FORM.md): the XRPD pattern, the DSC and TGA thermograms, drawn
// from the user's own data in black on white through plot.ts — so the pane's figure styles (USPTO, journals) fit them
// like any other plot. Pure: no Office.js.
//
// A pattern of several thousand points is thinned by decimateTrace, which keeps every bucket's highest and lowest
// point: a sharp reflection one step wide survives into the drawing.

import { buildPlotSvg, Point, Series } from "./plot";
import { decimateTrace } from "./spectraChart";
import { Peak, WAVELENGTHS, WavelengthId, XY } from "./solidform";

/** The plot's own canvas, and its height per unit of width when a style re-renders it wider or narrower. */
export const SOLID_CHART_SIZE = { width: 420, height: 270 };
const ASPECT = SOLID_CHART_SIZE.height / SOLID_CHART_SIZE.width;
const INK = "#000000";

/**
 * Pure black and white (37 CFR 1.84(a)(1)): the plot's grey frame, ticks and lettering made black and its light grid
 * left out — patent figures carry no grid, and a journal prints this as clean line art too.
 */
export function blackAndWhite(svg: string): string {
  return svg
    .replace(/<line [^>]*stroke="#eee"[^>]*\/>/g, "")
    .replace(/(stroke|fill)="#(?:888|333|555|666|777|999)"/g, '$1="#000"');
}

const pts = (xy: XY[]): Point[] => decimateTrace(xy.map(([x, y]) => ({ x, y })), 2400);

/**
 * The diffraction pattern: the measured trace when there is one, else the peak list as sticks on a baseline (their
 * relative intensities, or equal heights when the list has none). The x label names the radiation, since 2θ means
 * nothing without it.
 */
export function xrpdChartSvg(pattern: XY[] | null, peaks: Peak[], wavelength: WavelengthId, width = SOLID_CHART_SIZE.width): string | null {
  const rad = WAVELENGTHS[wavelength].name.replace(/ \(.*\)$/, "");
  const xlabel = `2θ (°), ${rad}`;
  let series: Series[];
  let ylabel: string;
  if (pattern && pattern.length >= 2) {
    series = [{ points: pts([...pattern].sort((a, b) => a[0] - b[0])), type: "line", color: INK }];
    ylabel = "Intensity (counts)";
  } else if (peaks.length) {
    const hasRel = Number.isFinite(peaks[0].rel);
    const sticks: Point[] = [];
    for (const p of [...peaks].sort((a, b) => a.twoTheta - b.twoTheta)) {
      const h = hasRel ? p.rel : 100;
      sticks.push({ x: p.twoTheta, y: 0 }, { x: p.twoTheta, y: h }, { x: p.twoTheta, y: 0 });
    }
    series = [{ points: sticks, type: "line", color: INK }];
    ylabel = hasRel ? "Relative intensity (%)" : "Peak positions";
    // Room either side, so the first and last sticks stand clear of the frame.
    const lo = Math.min(...peaks.map((p) => p.twoTheta)), hi = Math.max(...peaks.map((p) => p.twoTheta));
    const pad = Math.max(1, (hi - lo) * 0.06);
    return blackAndWhite(buildPlotSvg(series, {
      xlabel,
      ylabel,
      width,
      height: Math.round(width * ASPECT),
      xLimits: { min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad) },
      yLimits: { min: 0, max: 110 },
    }));
  } else return null;
  return blackAndWhite(buildPlotSvg(series, { xlabel, ylabel, width, height: Math.round(width * ASPECT) }));
}

/** The DSC thermogram, its y label saying which way the exotherm points (the reader cannot tell otherwise). */
export function dscChartSvg(trace: XY[], endoDown: boolean, yUnits = "W/g", width = SOLID_CHART_SIZE.width): string | null {
  if (trace.length < 2) return null;
  const series: Series[] = [{ points: pts([...trace].sort((a, b) => a[0] - b[0])), type: "line", color: INK }];
  const unit = yUnits.trim();
  return blackAndWhite(
    buildPlotSvg(series, {
      xlabel: "Temperature (°C)",
      ylabel: `Heat flow${unit ? ` (${unit})` : ""}, ${endoDown ? "exo up" : "endo up"}`,
      width,
      height: Math.round(width * ASPECT),
    }),
  );
}

/** The TGA thermogram: weight against temperature, in the units the data arrived in. */
export function tgaChartSvg(trace: XY[], yUnits = "%", width = SOLID_CHART_SIZE.width): string | null {
  if (trace.length < 2) return null;
  const series: Series[] = [{ points: pts([...trace].sort((a, b) => a[0] - b[0])), type: "line", color: INK }];
  const unit = yUnits.trim();
  return blackAndWhite(buildPlotSvg(series, { xlabel: "Temperature (°C)", ylabel: `Weight${unit ? ` (${unit})` : ""}`, width, height: Math.round(width * ASPECT) }));
}
