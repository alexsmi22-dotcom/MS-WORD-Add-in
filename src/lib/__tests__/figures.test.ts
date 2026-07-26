// The arithmetic behind the figure-sizing fix in v1.88.0.
//
// The bug being guarded against: rasterising at 2x and inserting without an
// explicit size made Spectra and Sequence Map figures come out at double their
// intended width, because Word lays a PNG out at pixels/96 dpi. The pairing of
// figureScale() with figurePoints() is what makes supersampling produce
// resolution instead of size, so both halves are pinned here.

import { figureScale, figurePoints, FIGURE_SCALE, FIGURE_PIXEL_BUDGET } from "../figures";

describe("figurePoints — pixels to Word points", () => {
  test("96 dpi pixels convert at 0.75 pt per px", () => {
    // 96 px = 1 inch = 72 pt
    expect(figurePoints(96)).toBe(72);
    expect(figurePoints(380)).toBe(285);
    expect(figurePoints(0)).toBe(0);
  });

  test("a figure inserted at natural size keeps its physical width", () => {
    // This is the whole point of the fix: whatever supersampling factor is
    // chosen, the points handed to Word depend only on the natural width.
    const natural = 380;
    for (const scale of [1, 2, 3, 4]) {
      const rasterWidth = natural * scale;
      expect(figurePoints(natural)).toBe(285);
      expect(rasterWidth / scale).toBe(natural);
    }
  });
});

describe("figureScale — supersample, but stay inside the pixel budget", () => {
  test("an ordinary figure gets the full factor", () => {
    expect(figureScale(380, 270)).toBe(FIGURE_SCALE);
    expect(380 * 4 * 270 * 4).toBeLessThan(FIGURE_PIXEL_BUDGET);
  });

  test("a large figure degrades rather than blowing the budget", () => {
    // 1400 x 900 at 4x would be 20.2 MP, well over budget.
    const s = figureScale(1400, 900);
    expect(s).toBeLessThan(FIGURE_SCALE);
    expect(1400 * s * 900 * s).toBeLessThanOrEqual(FIGURE_PIXEL_BUDGET);
  });

  test("whatever factor comes back, the result is always within budget", () => {
    for (const [w, h] of [
      [100, 100], [380, 270], [600, 400], [900, 600],
      [1400, 900], [2000, 1500], [4000, 3000],
    ]) {
      const s = figureScale(w, h);
      expect({ w, h, within: w * s * h * s <= FIGURE_PIXEL_BUDGET || s === 1 }).toEqual({
        w, h, within: true,
      });
    }
  });

  test("a figure too big to supersample at all still returns 1, not 0", () => {
    // Returning 0 would rasterise to a zero-size canvas — an invisible figure is
    // worse than an unsharp one.
    expect(figureScale(9000, 9000)).toBe(1);
    expect(figureScale(100000, 100000)).toBe(1);
  });

  test("degradation is monotonic — bigger figures never get a larger factor", () => {
    let prev = Infinity;
    for (const w of [200, 400, 800, 1200, 1600, 2400, 3200]) {
      const s = figureScale(w, w * 0.7);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  test("nonsense dimensions fall back to 1 instead of NaN", () => {
    expect(figureScale(0, 270)).toBe(1);
    expect(figureScale(380, 0)).toBe(1);
    expect(figureScale(-5, 270)).toBe(1);
    expect(figureScale(NaN, 270)).toBe(1);
  });

  test("the budget and max factor are honoured when passed explicitly", () => {
    expect(figureScale(100, 100, 8, 1_000_000)).toBe(8); // 640k px, fits
    expect(figureScale(1000, 1000, 8, 1_000_000)).toBe(1); // even 1x is 1M
    expect(figureScale(500, 500, 4, 1_000_000)).toBe(2); // 2x = 1M exactly
  });
});
