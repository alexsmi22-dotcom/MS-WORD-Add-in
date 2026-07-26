// Sizing rules for figures inserted into Word.
//
// Word lays an inserted PNG out at its pixel count interpreted at 96 dpi. So
// rasterising at 2x and inserting the result *without* setting an explicit size
// makes the figure twice as big on the page, not twice as sharp. That was
// shipping in Spectra and Sequence Map through v1.87.0: every predicted spectrum
// and every sequence map came in at double its intended width.
//
// Supersampling only buys resolution when it is paired with pinning the picture
// back to its natural physical size, which is what figurePoints() is for.
//
// This lives in lib/ rather than beside the call sites in taskpane.ts because
// taskpane.ts imports Office and cannot be reached from jest. The arithmetic is
// the part with a failure mode, so it is the part that needs a test.

/** Supersampling factor for inserted figures. 4x ≈ 384 dpi at natural size. */
export const FIGURE_SCALE = 4;

/**
 * Roughly 8 megapixels. A 4x canvas of a dense flowchart is 16x the pixels of a
 * 1x one, and the pane has to hold the canvas, the PNG and its base64 encoding
 * at once. Beyond this the figure degrades to a lower factor rather than risking
 * a stall on the widest sequence maps and Table → Chart flowcharts.
 */
export const FIGURE_PIXEL_BUDGET = 8_000_000;

/**
 * The largest supersampling factor that keeps a width x height figure inside the
 * pixel budget. Never returns less than 1: a figure too big to supersample at
 * all is still inserted, just at its natural resolution.
 */
export function figureScale(
  width: number,
  height: number,
  max: number = FIGURE_SCALE,
  budget: number = FIGURE_PIXEL_BUDGET,
): number {
  if (!(width > 0) || !(height > 0)) return 1;
  let s = Math.max(1, Math.floor(max));
  while (s > 1 && width * s * height * s > budget) s--;
  return s;
}

/**
 * Device pixels to Word points. A PNG at w pixels is w/96 inches, and a point is
 * 1/72 inch, so w px = w * 72/96 = w * 0.75 pt.
 */
export function figurePoints(px: number): number {
  return px * 0.75;
}
