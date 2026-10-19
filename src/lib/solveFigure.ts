import { buildPlotSvg, type Point, type Series } from "./plot";
import { evalFormula } from "./stats";
import { evalAst, parseExpr } from "./solve";

/**
 * Plots one or two expressions over a window, optionally marking points.
 *
 * WHY SOLVE NEEDS THIS AT ALL. Solve was the last mode in the product with no
 * figure of any kind: it had the plumbing (`currentSolveSvg` is rasterised and
 * inserted) but only the topology barcode ever filled it. A root is a place
 * where a curve crosses zero, a derivative is a slope, and an integral is an
 * area — three things that are pictures by nature and were arriving as text.
 *
 * THE WINDOW IS ALWAYS BOUNDED AND NEVER TAKEN RAW FROM USER INPUT. It is
 * derived from the marked points when there are any, and is a fixed [-10, 10]
 * otherwise; the sample count is a constant. This runs on every keystroke, so
 * an unbounded window here would not be a bad chart, it would be a frozen Word.
 *
 * `evalFormula` is the evaluator the rest of the pane uses; an expression it
 * refuses (an implicit product, "5x") is read by Solve's own parser instead, so
 * the curve is the arithmetic that produced the answer. Anything neither can
 * evaluate yields no figure at all — a plot with a silent hole in it would be
 * worse than none.
 */
export function solveFunctionSvg(o: {
  exprs: { expr: string; label: string; color: string }[];
  variable: string;
  window?: { lo: number; hi: number };
  marks?: { x: number; y: number; label: string }[];
  shadeBetween?: { lo: number; hi: number };
  title: string;
}): string | null {
  const marks = (o.marks ?? []).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y));
  let lo: number;
  let hi: number;
  if (o.window && Number.isFinite(o.window.lo) && Number.isFinite(o.window.hi) && o.window.hi > o.window.lo) {
    lo = o.window.lo;
    hi = o.window.hi;
  } else if (marks.length) {
    // Span the marked points with a margin, so every root is comfortably
    // inside the frame rather than sitting on its edge.
    let mlo = Infinity;
    let mhi = -Infinity;
    for (const m of marks) {
      if (m.x < mlo) mlo = m.x;
      if (m.x > mhi) mhi = m.x;
    }
    const pad = Math.max(1, (mhi - mlo) * 0.6);
    lo = mlo - pad;
    hi = mhi + pad;
  } else {
    lo = -10;
    hi = 10;
  }
  // Clamped hard: the span can still come from a root at 1e300.
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;
  const span = hi - lo;
  if (!Number.isFinite(span) || span > 1e12) return null;

  const N = 200;
  const series: Series[] = [];
  // ONE reader for the whole figure: if the plotter's own reader refuses any expression (an implicit product,
  // "5x"), every curve is read as Solve read it — f and f′ by two different readers could disagree where one
  // gives NaN and the other a real value (x^(1/3) for x < 0: v2.160.0 review).
  let solveReader = false;
  for (const e of o.exprs) {
    try {
      evalFormula(e.expr, { [o.variable]: lo });
    } catch {
      solveReader = true;
    }
  }
  const readers: Array<(x: number) => number> = [];
  for (const e of o.exprs) {
    const pts: Point[] = [];
    // The plotter's reader refuses an implicit product ("5x", "3sin(x)") that Solve's own parser read, and
    // the figure was silently dropped: "x^2 - 5x + 6 = 0" inserted no curve (host-trace audit). What the
    // plotter reads it still reads; what it refuses is read as Solve read it.
    let read = (x: number): number => evalFormula(e.expr, { [o.variable]: x });
    if (solveReader) {
      try {
        const ast = parseExpr(e.expr);
        read = (x) => evalAst(ast, { [o.variable]: x });
      } catch {
        return null;
      }
    }
    for (let i = 0; i <= N; i++) {
      const x = lo + (span * i) / N;
      let y: number;
      try {
        y = read(x);
      } catch {
        return null;
      }
      // buildPlotSvg drops non-finite points at the door, but a pole would
      // otherwise join across the discontinuity as a near-vertical line that
      // looks like a real feature.
      if (Number.isFinite(y)) pts.push({ x, y });
    }
    if (pts.length < 2) return null;
    series.push({ points: pts, type: "line", color: e.color, label: e.label });
    readers.push(read);
  }
  if (o.shadeBetween) {
    // The integrated interval drawn as its own segment of the curve. Not a
    // filled polygon: `buildPlotSvg` draws lines and scatters, and a fake fill
    // assembled here would be a second renderer to keep in step with the first.
    const a = Math.max(lo, o.shadeBetween.lo);
    const b = Math.min(hi, o.shadeBetween.hi);
    if (b > a) {
      const pts: Point[] = [];
      for (let i = 0; i <= 60; i++) {
        const x = a + ((b - a) * i) / 60;
        try {
          const y = readers[0](x);
          if (Number.isFinite(y)) pts.push({ x, y });
        } catch {
          break;
        }
      }
      if (pts.length > 1) {
        series.push({ points: pts, type: "line", color: "#b91c1c", label: "integrated" });
      }
    }
  }
  if (marks.length) {
    series.push({
      points: marks.map((m) => ({ x: m.x, y: m.y })),
      type: "scatter",
      color: "#b91c1c",
      label: marks[0].label,
    });
  }
  return buildPlotSvg(series, {
    width: 380,
    height: 250,
    title: o.title,
    xlabel: o.variable,
    ylabel: "value",
  });
}
