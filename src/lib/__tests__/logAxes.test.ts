// Logarithmic axes.
//
// The capability matters (dose-response is defined on log10[concentration], and
// the tool could fit an EC50 but not draw the curve it came from), but the
// dangerous part is that log is undefined at <= 0. Selecting a log axis
// therefore DISCARDS data, and a titration series with a zero-concentration
// control hits that on the very first attempt. These pin the discarding
// behaviour as hard as the drawing.

import { buildPlotSvg, dropForScales, logTicks, fmtLogTick, type Series } from "../plot";

const line = (points: Array<[number, number]>, err?: number): Series => ({
  type: "line",
  points: points.map(([x, y]) => ({ x, y, ...(err === undefined ? {} : { err }) })),
});

describe("a log axis drops what it cannot represent, and says so", () => {
  test("zero and negative x are dropped on a log x axis", () => {
    const r = dropForScales([line([[0, 1], [1, 2], [10, 3], [-5, 4]])], { xScale: "log" });
    expect(r.dropped).toBe(2);
    expect(r.axes).toEqual(["x"]);
    expect(r.series[0].points.map((p) => p.x)).toEqual([1, 10]);
  });

  test("zero and negative y are dropped on a log y axis", () => {
    const r = dropForScales([line([[1, 0], [2, 5], [3, -1]])], { yScale: "log" });
    expect(r.dropped).toBe(2);
    expect(r.axes).toEqual(["y"]);
  });

  test("both axes report independently", () => {
    const r = dropForScales([line([[0, 5], [1, 0], [2, 2]])], { xScale: "log", yScale: "log" });
    expect(r.dropped).toBe(2);
    expect(r.axes.sort()).toEqual(["x", "y"]);
  });

  test("a linear plot drops nothing and returns the same series", () => {
    const input = [line([[0, 0], [-1, -1]])];
    const r = dropForScales(input, {});
    expect(r.dropped).toBe(0);
    expect(r.series).toBe(input); // untouched, not a copy
  });

  test("dropping never silently empties a series without reporting it", () => {
    const r = dropForScales([line([[0, 1], [-1, 2]])], { xScale: "log" });
    expect(r.series[0].points).toEqual([]);
    expect(r.dropped).toBe(2); // the caller has what it needs to warn
  });
});

describe("decades are placed and labelled correctly", () => {
  test("major ticks are the decades in range", () => {
    const { major } = logTicks(0, 3); // 10^0 .. 10^3
    expect(major).toEqual([1, 10, 100, 1000]);
  });

  test("minor ticks fill each decade at 2-9", () => {
    const { minor } = logTicks(0, 1);
    expect(minor).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("minor ticks are suppressed over a wide span, where they would be mush", () => {
    const { minor } = logTicks(0, 10);
    expect(minor).toEqual([]);
  });

  test("a pathological domain yields no ticks rather than thousands", () => {
    expect(logTicks(-500, 500)).toEqual({ major: [], minor: [] });
  });

  test("labels are plain numbers in the readable range", () => {
    expect(fmtLogTick(1)).toBe("1");
    expect(fmtLogTick(100)).toBe("100");
    expect(fmtLogTick(0.01)).toBe("0.01");
  });

  test("labels are 10^n with superscripts outside it", () => {
    expect(fmtLogTick(1e-9)).toBe("10⁻⁹");
    expect(fmtLogTick(1e12)).toBe("10¹²");
  });
});

describe("the rendered SVG uses log geometry", () => {
  /** Pulls the x of every plotted vertex out of the series path. */
  function pathXs(svg: string): number[] {
    const m = /<path d="([^"]+)" fill="none"/.exec(svg);
    if (!m) return [];
    return [...m[1].matchAll(/[ML]([\d.]+),/g)].map((g) => Number(g[1]));
  }

  test("equal ratios occupy equal width — a decade is a decade", () => {
    // 1, 10, 100, 1000 must be evenly spaced on a log axis.
    const svg = buildPlotSvg([line([[1, 1], [10, 2], [100, 3], [1000, 4]])], {
      xScale: "log",
      width: 400,
      height: 300,
    });
    const xs = pathXs(svg);
    expect(xs.length).toBe(4);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    // Coordinates are emitted with toFixed(1), so two mathematically equal gaps
    // can differ by one unit in the last place (112.7 vs 112.6). The tolerance
    // is that rounding granularity and nothing more — a linear axis puts these
    // gaps hundreds of px apart, which the next test asserts.
    for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(0.2);
  });

  test("the same data on a linear axis is NOT evenly spaced", () => {
    // Guards against the log option being accepted and ignored.
    const svg = buildPlotSvg([line([[1, 1], [10, 2], [100, 3], [1000, 4]])], {
      width: 400,
      height: 300,
    });
    const xs = pathXs(svg);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    expect(Math.abs(gaps[0] - gaps[2])).toBeGreaterThan(10);
  });

  test("log tick labels appear on the axis", () => {
    const svg = buildPlotSvg([line([[1, 1], [1000, 4]])], { xScale: "log" });
    for (const label of ["1", "10", "100", "1000"]) {
      expect(svg).toContain(`>${label}</text>`);
    }
  });

  test("a log y axis renders without producing NaN geometry", () => {
    // The failure mode when a transform is missed: log10 of a negative leaks
    // into a coordinate and the whole SVG silently stops drawing.
    const svg = buildPlotSvg([line([[1, 0.001], [2, 1], [3, 1000]])], { yScale: "log" });
    expect(svg).not.toContain("NaN");
  });

  test("an error bar that reaches below zero does not escape a log axis", () => {
    // y=1 with err=5 would put the lower end at -4, where log is undefined.
    const svg = buildPlotSvg([{ ...line([[1, 1]], 5), type: "scatter" }], { yScale: "log" });
    expect(svg).not.toContain("NaN");
    const ys = [...svg.matchAll(/<line[^>]*y1="([\d.-]+)"[^>]*y2="([\d.-]+)"[^>]*stroke="#1f77b4"/g)];
    for (const m of ys) {
      expect(Number(m[1])).toBeGreaterThan(-1);
      expect(Number(m[2])).toBeGreaterThan(-1);
    }
  });

  test("log and linear of the same data differ", () => {
    const data = line([[1, 1], [10, 2], [100, 3]]);
    expect(buildPlotSvg([data], { xScale: "log" })).not.toBe(buildPlotSvg([data], {}));
  });
});
