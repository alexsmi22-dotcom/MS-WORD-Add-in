/**
 * Assay number formatters and the proportional-law figure (moved from
 * taskpane.ts in v2.144.0, docs/SCOPE-HOST-ADAPTER.md §E, so tests can call
 * them instead of reading the pane's source). The bodies are unchanged.
 */
import { buildPlotSvg, Point, Series } from "./plot";

/** Formats to `sig` significant figures without trailing-zero noise. */
export function assaySig(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  return Number(x.toPrecision(sig)).toString();
}
/** "value ± se", dropping the ± part when the standard error is unavailable. */
export function assayValSE(val: number, se: number): string {
  return Number.isFinite(se) ? `${assaySig(val)} ± ${assaySig(se, 2)}` : assaySig(val);
}
/** Pairs two equal-length lists into plot points, or null if they can't fit. */
export function assayPairXY(xs: number[], ys: number[], minPts: number): Point[] | null {
  if (xs.length < minPts || xs.length !== ys.length) return null;
  return xs.map((x, i) => ({ x, y: ys[i] }));
}

/**
 * A proportional law drawn as a line, with the user's own measurement on it.
 *
 * Shared by the assays that are a single multiplication — Beer-Lambert, A260
 * nucleic acid, and anything else of the form y = slope·x. The value of the
 * picture is not the number, which is already printed beside it, but WHERE the
 * measurement sits: an absorbance up at 2 is off the linear range of most
 * instruments and one at 0.005 is in the noise, and neither is visible from
 * "c = 1e-4 M".
 *
 * The line is the USER'S calibration (their ε, their path length, their
 * dilution), not a generic illustration — so what is drawn is the assumption
 * their number rests on.
 *
 * The window is anchored on the measurement itself and clamped, because it is
 * built from a user number: an absorbance of 1e300 must not produce a sweep
 * that never returns. A non-finite slope or point draws nothing rather than a
 * misleading straight line through the origin.
 */
export function assayLineSvg(o: {
  slope: number;
  x: number;
  y: number;
  xlabel: string;
  ylabel: string;
  title: string;
}): string | undefined {
  if (!Number.isFinite(o.slope) || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return undefined;
  // Span a little past the measurement so the point is not on the frame edge.
  // `Math.abs(o.x) || 1` keeps a zero measurement drawable.
  const hi = Math.min(1e12, Math.abs(o.x) * 1.6 || 1);
  const pts: Point[] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const x = (hi * i) / N;
    const y = o.slope * x;
    if (Number.isFinite(y)) pts.push({ x, y });
  }
  if (pts.length < 2) return undefined;
  const series: Series[] = [
    { points: pts, type: "line", color: "#2563eb", label: "the law" },
    { points: [{ x: o.x, y: o.y }], type: "scatter", color: "#b91c1c", label: "your reading" },
  ];
  return buildPlotSvg(series, {
    width: 360,
    height: 240,
    title: o.title,
    xlabel: o.xlabel,
    ylabel: o.ylabel,
  });
}
