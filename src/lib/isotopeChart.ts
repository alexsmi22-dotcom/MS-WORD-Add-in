// Isotope-pattern stick chart for Mass Spec (v2.138.0).
//
// m/z against relative intensity (base peak = 100), one stick per nominal-mass
// group. The M stick — the peak built from every element's most abundant isotope
// — is drawn in its own colour with its own legend entry, because M is NOT
// always the tallest stick (cisplatin's base peak is M+1, hexabromobenzene's is
// M+6) nor the leftmost (ferrocene's ⁵⁴Fe peak is M−2).
//
// The M−n / M+n labels go in the figure's NOTES rather than as text placed over
// the sticks: plot.ts measures and wraps notes and grows the canvas for them,
// whereas hand-placed text is unmeasured and is how a label ends up clipped or
// overlapping (the figure-layout gate checks only what plot.ts lays out).
//
// Pure; no Office.js. Also the predicted MS series for the overlay (§B2).

import { buildPlotSvg, Series } from "./plot";
import type { IsotopePeak } from "./massspec";
import { typesetHill } from "./structures";

export const ISOTOPE_CHART_SIZE = { width: 380, height: 240 } as const;

const STICK = "#2563eb";
const M_STICK = "#dc2626";

export interface IsotopeChartInput {
  formula: string;
  netCharge?: number;
  pattern: IsotopePeak[];
  /** The engine's own statement of what is cut (threshold, cap). */
  patternNote?: string;
}

const peakEntry = (p: IsotopePeak): string =>
  `${p.label} ${p.mass.toFixed(4)} (${p.intensity >= 10 ? p.intensity.toFixed(1) : p.intensity.toFixed(2)} %)`;

/** The peak list as one line of text: "M−2 184.0179 (6.37 %) · M 186.0132 (100.0 %) · …". */
export function isotopePeakList(pattern: IsotopePeak[]): string {
  return pattern.map(peakEntry).join(" · ");
}

/**
 * The peak list packed into note lines that plot.ts will NOT re-wrap, so a line
 * break can fall only between entries — never leaving "M" on one line and its
 * mass on the next. (Its wrapper splits on \s, which includes U+00A0, so
 * non-breaking spaces would not help.) The width matches plot.ts's note
 * wrapper: floor((width − 16) / 6.3) characters.
 */
export function isotopePeakLines(pattern: IsotopePeak[], width = ISOTOPE_CHART_SIZE.width): string[] {
  const maxChars = Math.max(20, Math.floor((width - 16) / 6.3));
  const lines: string[] = [];
  let cur = "";
  for (const e of pattern.map(peakEntry)) {
    if (!cur) cur = e;
    else if (cur.length + 3 + e.length <= maxChars) cur += ` · ${e}`;
    else {
      lines.push(cur);
      cur = e;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * The stick chart, or null when there is nothing to draw. The title is short and
 * fixed-form ("Isotope pattern — C₁₀H₁₀Fe"); a very long formula is truncated
 * with an ellipsis, so the title can never run past the canvas.
 */
export function isotopeChartSvg(r: IsotopeChartInput): string | null {
  const peaks = r.pattern.filter((p) => Number.isFinite(p.mass) && Number.isFinite(p.intensity) && p.intensity > 0);
  if (!peaks.length) return null;
  // A grey baseline one unit beyond the outermost sticks: it gives the x range
  // its margin, so no stick is drawn ON the plot frame (buildPlotSvg pads y only).
  const xs = peaks.map((p) => p.mass);
  const series: Series[] = [
    {
      points: [
        { x: Math.min(...xs) - 1, y: 0 },
        { x: Math.max(...xs) + 1, y: 0 },
      ],
      type: "line",
      color: "#94a3b8",
    },
  ];
  let labelled = false;
  for (const p of peaks) {
    if (p.offset === 0) continue;
    series.push({
      points: [
        { x: p.mass, y: 0 },
        { x: p.mass, y: p.intensity },
      ],
      type: "line",
      color: STICK,
      ...(labelled ? {} : { label: "isotopologue peaks" }),
    });
    labelled = true;
  }
  const m = peaks.find((p) => p.offset === 0);
  if (m) {
    series.push({
      points: [
        { x: m.mass, y: 0 },
        { x: m.mass, y: m.intensity },
      ],
      type: "line",
      color: M_STICK,
      // Short enough for the legend gutter (a longer label is truncated with "…").
      label: "M (monoisotopic)",
    });
  }
  let formula = typesetHill(r.formula, r.netCharge ?? 0);
  const MAX_TITLE_FORMULA = 34;
  if ([...formula].length > MAX_TITLE_FORMULA) formula = [...formula].slice(0, MAX_TITLE_FORMULA - 1).join("") + "…";
  const notes = isotopePeakLines(peaks);
  if (r.patternNote) notes.push(r.patternNote);
  return buildPlotSvg(series, {
    title: `Isotope pattern — ${formula}`,
    xlabel: "m/z",
    ylabel: "relative intensity (%)",
    width: ISOTOPE_CHART_SIZE.width,
    height: ISOTOPE_CHART_SIZE.height,
    notes,
  });
}
