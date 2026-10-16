// Tick labels for an axis drawn NEGATED (spectra: δ and wavenumber run
// leftward, so the builders feed buildPlotSvg −x and label the ticks back).
//
// WHY THIS FILE. plot.ts's `xTickLabel` / `yTickLabel` hooks are per VALUE: the
// hook sees one tick and returns one string. Formatting each tick alone is what
// gave `0, 0.25, 0.5, 0.75, 1` and `4, 3.5, 3 …` (mixed decimals in one row,
// docs/SCOPE-JOURNAL-FIGURES-2026-10.md B.4), because precision has to come
// from the STEP, which a single value does not know.
//
// The fix keeps the hook (plot.ts owns the drawing) but makes it row-aware:
//   1. reproduce the domain buildPlotSvg derives from the same series (linear
//      scales, no user limits): x is min/max of the finite points, unpadded,
//      widened by ±1 when the range is zero; y is the same over y ∓ err, then
//      padded 6%;
//   2. ask axis.ts `linearAxis` for the row plot.ts will ask for (targets 6 on
//      x, 5 on y) — the same function on the same arguments gives the same row;
//   3. look each tick up BY LATTICE INDEX (it survives plot's snap-to-zero) and
//      return that row's label with the sign toggled. The label string is never
//      re-formatted, so decimals stay constant and labels stay distinct.
//
// A custom hook makes plot.ts drop the row's ×10ⁿ multiplier, so `multiplier`
// is returned for the caller to put on the axis title.

import { linearAxis, fmtValue, MINUS, type AxisRow } from "./axis";
import type { Series } from "./plot";

/** plot.ts's tick density targets (buildPlotSvg: x 6, y 5). */
export const PLOT_X_TARGET = 6;
export const PLOT_Y_TARGET = 5;

/** The linear [lo, hi] buildPlotSvg derives on one axis from these series, or null when nothing is plottable. */
export function plotLinearDomain(series: Series[], axis: "x" | "y"): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  let any = false;
  for (const s of series)
    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      any = true;
      if (axis === "x") {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      } else {
        const e = p.err !== undefined && Number.isFinite(p.err) ? p.err : 0;
        if (p.y - e < lo) lo = p.y - e;
        if (p.y + e > hi) hi = p.y + e;
      }
    }
  if (!any) return null;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  if (axis === "y") {
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
  }
  return [lo, hi];
}

/** "1.5" → "−1.5", "−1.5" → "1.5", "0.0" stays "0.0" (zero is never signed). */
export function negateLabel(label: string): string {
  if (label.startsWith(MINUS)) return label.slice(MINUS.length);
  if (!/[1-9]/.test(label)) return label;
  return MINUS + label;
}

export interface RowLabeller {
  /** The per-value hook to hand buildPlotSvg. */
  label: (v: number) => string;
  /** "" or "×10ⁿ": plot.ts drops it when a hook is set, so the caller appends it to the title. */
  multiplier: string;
  /** The row the labels come from (for tests). */
  row: AxisRow;
}

/**
 * A row-aware tick labeller for one linear axis of buildPlotSvg, optionally
 * NEGATED (the plotted coordinate is −value). Null when the series give no domain.
 */
export function rowLabeller(series: Series[], axis: "x" | "y", negate: boolean): RowLabeller | null {
  const dom = plotLinearDomain(series, axis);
  if (!dom) return null;
  const row = linearAxis(dom[0], dom[1], { target: axis === "x" ? PLOT_X_TARGET : PLOT_Y_TARGET });
  const label = (v: number): string => {
    if (row.values.length && row.step > 0) {
      const i = Math.round((v - row.values[0]) / row.step);
      if (i >= 0 && i < row.values.length && Math.abs(row.values[i] - v) <= row.step * 1e-6) {
        return negate ? negateLabel(row.labels[i]) : row.labels[i];
      }
    } else if (row.values.length === 1 && Math.abs(row.values[0] - v) <= Math.abs(v) * 1e-9) {
      return negate ? negateLabel(row.labels[0]) : row.labels[0];
    }
    // Not a tick of this row: the domain reproduction disagreed with plot.ts.
    // Still honest (U+2212, no e-notation), just not row-consistent.
    return fmtValue(negate ? -v : v);
  };
  return { label, multiplier: row.multiplier, row };
}

/** "δ (ppm)" + "×10³" → "δ (ppm) (×10³)"; no multiplier → the title unchanged. */
export function titleWithMultiplier(title: string, multiplier: string): string {
  if (!multiplier) return title;
  return title ? `${title} (${multiplier})` : multiplier;
}
