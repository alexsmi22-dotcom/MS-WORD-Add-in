// Kaplan–Meier figures for the Stats pane (Survival and Log-rank), moved out of
// taskpane.ts so the drawing rules are testable:
//   - the curve runs to the largest follow-up time (the censored tail is drawn);
//   - the y axis is fixed at 0 to 1 — a survival probability, never auto-scaled
//     to 0.6–1, which makes a small drop look like a collapse;
//   - every censoring time carries a + tick on the curve, as journals draw them.

import { buildPlotSvg, Series } from "./plot";
import { KaplanMeierResult, survivalCensorMarks, survivalCurvePoints } from "./survival";

const PALETTE = ["#0369a1", "#b91c1c", "#059669", "#d97706", "#7c3aed", "#0891b2"];

export function kaplanMeierSvg(
  curves: { km: KaplanMeierResult; label: string }[],
  opts: { title: string; width?: number; height?: number },
): string {
  const series: Series[] = [];
  let anyCensored = false;
  curves.forEach((c, i) => {
    const color = PALETTE[i % PALETTE.length];
    if (!c.km.ok) return;
    series.push({ type: "line", points: survivalCurvePoints(c.km), color, label: c.label });
    const marks = survivalCensorMarks(c.km);
    if (marks.length) {
      anyCensored = true;
      series.push({ type: "scatter", points: marks, color, marker: "plus" });
    }
  });
  if (anyCensored) {
    // One legend entry for the tick, in a neutral colour, drawn off-data (no points).
    series.push({ type: "scatter", points: [], color: "#444444", marker: "plus", label: "censored" });
  }
  // x from 0 to a little past the last follow-up, so a + tick at the last
  // (censored) time is not cut in half by the frame.
  let tMax = 0;
  for (const c of curves) if (c.km.ok && c.km.points.length) tMax = Math.max(tMax, c.km.points[c.km.points.length - 1].time);
  return buildPlotSvg(series, {
    width: opts.width ?? 320,
    height: opts.height ?? 210,
    title: opts.title,
    xlabel: "Time",
    ylabel: "Survival probability",
    yLimits: { min: 0, max: 1 },
    ...(tMax > 0 ? { xLimits: { min: 0, max: tMax * 1.05 } } : {}),
  });
}
