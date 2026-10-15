// The measured-vs-predicted figure (docs/SCOPE-SPECTROSCOPY-BATCH.md §B2).
//
// Pure: takes an OverlayOk from spectrumOverlay.ts and returns an SVG string via
// plot.ts. Conventions this module owns:
//   * NMR δ and IR wavenumber increase LEFTWARD. buildPlotSvg draws x ascending
//     rightward only, so x is negated for drawing and the tick LABELS are
//     un-negated (spectraChart's FLIP_X rule, rebuilt here from fmtTick).
//   * MS is head-to-tail: measured sticks UP, predicted sticks DOWN.
//   * NMR predicted lines are sticks; IR predicted is a curve in the FILE's own y
//     convention (spectrumOverlay converted it); UV predicted is a λmax marker.
//   * The title is MEASURED and truncated, so a long file title can never run off
//     the canvas (the reason "jcamp measured ir" carries a CLIPPED waiver).
//   * The caveats that change how the figure reads (offset, phase, identity,
//     ranking, "a prediction is not an assignment") are drawn INTO the figure:
//     the insert path takes the SVG and nothing else.

import { buildPlotSvg, fmtTick, Series } from "./plot";
import { decimateTrace } from "./spectraChart";
import { OverlayOk, NOT_AN_ASSIGNMENT, matchSummary } from "./spectrumOverlay";

const WIDTH = 380;
const HEIGHT = 260;
export const OVERLAY_CHART_SIZE = { width: WIDTH, height: HEIGHT };

const MEASURED = "#2563eb";
const PREDICTED = "#ea580c";
const AXIS_GREY = "#94a3b8";

/**
 * A bound on the width of one character of the 13 px bold title face — a bound,
 * not an average, the way plot.ts sizes its legend: "M" and "W" run near 11 px,
 * the average is ~7.5. Titles are cut to (width − 16) / 8.6 characters.
 */
const TITLE_PX_PER_CHAR = 8.6;

export function fitTitle(title: string, width = WIDTH): string {
  const max = Math.max(12, Math.floor((width - 16) / TITLE_PX_PER_CHAR));
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** U+2212 for a leading minus (the display contract): "-9" → "−9", "-1.0e-3" → "−1.0e-3". */
const trueMinus = (s: string): string => s.replace(/^-/, "−");

const TECH_TITLE: Record<OverlayOk["technique"], string> = {
  "1H": "¹H NMR",
  "13C": "¹³C NMR",
  ir: "IR",
  uvvis: "UV-Vis",
  ms: "MS",
};

/** The notes drawn under the plot: only what changes how the figure reads. */
function figureNotes(r: OverlayOk): string[] {
  const keep = r.caveats.filter((c) =>
    /offset by|UNREFERENCED|Gas-phase|Identity:|RANKING|referencings disagree/.test(c)
  );
  const notes = keep.slice(0, 4);
  notes.push(`${matchSummary(r)} ${NOT_AN_ASSIGNMENT}`);
  return notes;
}

/** The overlay figure. Null when there is nothing to draw. */
export function overlayChartSvg(r: OverlayOk): string | null {
  if (!r.measured.length) return null;
  const flip = r.axis.reversed;
  const fx = (x: number): number => (flip ? -x : x);
  const series: Series[] = [];
  const measuredLabel = `measured — ${r.fileTitle || "file"}`;
  const predictedLabel =
    r.technique === "ms"
      ? "predicted (below)"
      : r.technique === "uvvis"
        ? "predicted λmax"
        : "predicted (estimate)";

  // Measured.
  if (r.measuredForm === "sticks") {
    r.measured.forEach((p, i) => {
      series.push({
        points: [
          { x: fx(p.x), y: 0 },
          { x: fx(p.x), y: p.y },
        ],
        type: "line",
        color: MEASURED,
        ...(i === 0 ? { label: measuredLabel } : {}),
      });
    });
  } else {
    const pts = decimateTrace(r.measured.map((p) => ({ x: p.x, y: p.y })), 1400).map((p) => ({ x: fx(p.x), y: p.y }));
    // decimateTrace keeps file order; a reversed axis drawn from negated x must
    // still run monotonically, so sort by the plotted coordinate.
    pts.sort((a, b) => a.x - b.x);
    series.push({ points: pts, type: "line", color: MEASURED, label: measuredLabel });
  }

  // Predicted.
  let yTop = 0;
  let yBottom = 0;
  for (const p of r.measured) {
    if (p.y > yTop) yTop = p.y;
    if (p.y < yBottom) yBottom = p.y;
  }
  if (r.predictedCurve && r.predictedCurve.length) {
    const pts = r.predictedCurve.map((p) => ({ x: fx(p.x), y: p.y })).sort((a, b) => a.x - b.x);
    series.push({ points: pts, type: "line", color: PREDICTED, label: predictedLabel });
  } else if (r.predictedSticks && r.predictedSticks.length) {
    // NMR sticks are scaled into the measured range; MS sticks are already
    // negative percentages (head-to-tail).
    const scale = r.technique === "ms" ? 1 : yTop > 0 ? yTop : 1;
    r.predictedSticks.forEach((s, i) => {
      series.push({
        points: [
          { x: fx(s.x), y: 0 },
          { x: fx(s.x), y: s.height * scale },
        ],
        type: "line",
        color: PREDICTED,
        ...(i === 0 ? { label: predictedLabel } : {}),
      });
    });
  } else if (r.predictedMarker !== undefined) {
    const top = yTop > 0 ? yTop : 1;
    series.push({
      points: [
        { x: fx(r.predictedMarker), y: Math.min(0, yBottom) },
        { x: fx(r.predictedMarker), y: top },
      ],
      type: "line",
      color: PREDICTED,
      label: predictedLabel,
    });
  }

  // A zero line: the head-to-tail axis for MS, the baseline for sticks.
  if (r.technique === "ms" || r.predictedSticks) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series)
      for (const p of s.points) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
    const pad = Math.max(1e-6, (hi - lo) * 0.03);
    series.push({
      points: [
        { x: lo - pad, y: 0 },
        { x: hi + pad, y: 0 },
      ],
      type: "line",
      color: AXIS_GREY,
    });
  }

  const title = fitTitle(`${TECH_TITLE[r.technique]} — measured vs predicted: ${r.fileTitle}`);
  return buildPlotSvg(series, {
    title,
    xlabel: r.axis.label,
    ylabel: r.technique === "ms" ? "rel. intensity (%) — predicted below" : r.yLabel,
    width: WIDTH,
    height: HEIGHT,
    notes: figureNotes(r),
    // Tick labels: un-negate a flipped x; a true minus where a value is negative;
    // and on the MS head-to-tail y axis the predicted half is labelled by its
    // magnitude (the axis title says it is drawn below).
    xTickLabel: (v: number) => trueMinus(fmtTick(flip ? -v : v)),
    yTickLabel: (v: number) => (r.technique === "ms" ? fmtTick(Math.abs(v)) : trueMinus(fmtTick(v))),
  });
}
