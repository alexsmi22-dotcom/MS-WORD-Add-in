// A 130,000-value paste must not throw RangeError.
//
// `Math.min(...xs)` passes every element as a separate argument; V8 throws
// "Maximum call stack size exceeded" past roughly 125,000 of them. This is a
// CLIFF, not a curve — 100,000 values worked perfectly, so the previous large
// input tests certified the bug. Every textarea reached below is uncapped, and a
// 130,000-row spreadsheet column is an ordinary paste, not a pathological one.
//
// The threshold is environment-dependent, so these use 200,000 to stay clear of
// it on any engine. Each assertion is a *reachability* claim: the numbers are
// checked against the answer a loop gives, so a future re-introduction of the
// spread fails here rather than in Word.

import { buildPlotSvg } from "../plot";
import { minOf, maxOf } from "../minmax";
import { analyzeData, parseTable, summarizeColumn } from "../insights";

const N = 200000;

describe("array minimum and maximum by reduction", () => {
  test("minOf and maxOf agree with a plain loop on a huge array", () => {
    const xs = Array.from({ length: N }, (_, i) => ((i * 7919) % 100003) - 50000);
    let lo = Infinity, hi = -Infinity;
    for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
    expect(minOf(xs)).toBe(lo);
    expect(maxOf(xs)).toBe(hi);
  });

  test("the Math.min/Math.max identities are preserved exactly", () => {
    expect(minOf([])).toBe(Infinity);
    expect(maxOf([])).toBe(-Infinity);
    expect(minOf([3, 1, 2])).toBe(1);
    expect(maxOf([3, 1, 2])).toBe(3);
    expect(Number.isNaN(minOf([1, NaN, 3]))).toBe(true);
    expect(Number.isNaN(maxOf([1, NaN, 3]))).toBe(true);
    expect(maxOf([1, 2], 5)).toBe(5);
    expect(maxOf([], 7)).toBe(7);
    expect(minOf([4, 5], 1)).toBe(1);
    // Signed zero, exactly as Math.min/Math.max do it. The plot renderer
    // divides by an axis span, and 1/+0 is +Infinity while 1/-0 is -Infinity, so
    // a "drop-in" replacement that got this wrong would be its own new bug.
    expect(minOf([0, -0])).toBe(Math.min(0, -0));
    expect(minOf([-0, 0])).toBe(Math.min(-0, 0));
    expect(maxOf([0, -0])).toBe(Math.max(0, -0));
    expect(maxOf([-0, 0])).toBe(Math.max(-0, 0));
    expect(minOf([-0])).toBe(-0);
    expect(maxOf([-0])).toBe(-0);
    // and against Math itself on every small array, since that is the contract
    for (const a of [[0, -0], [-0, 0], [-0, -0], [0, 0], [1, -0], [-0, -1], [-0, 1, -2]]) {
      expect({ a, v: minOf(a) }).toEqual({ a, v: Math.min(...a) });
      expect({ a, v: maxOf(a) }).toEqual({ a, v: Math.max(...a) });
    }
  });
});

describe("the shared plot renderer survives a huge paste", () => {
  test("buildPlotSvg does not throw on 200,000 points", () => {
    const points = Array.from({ length: N }, (_, i) => ({ x: i, y: Math.sin(i / 1000) }));
    const svg = buildPlotSvg([{ points, type: "line" }], { width: 380, height: 240 });
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<svg");
    // and no non-finite coordinate reached the markup
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe("data insights survives a huge paste", () => {
  test("analyzeData does not throw on 200,000 rows", () => {
    const TAB = "\t";
    const NL = "\n";
    const lines = [`index${TAB}value`];
    for (let i = 0; i < N; i++) lines.push(`${i}${TAB}${(i % 977) + 1}`);
    const text = lines.join(NL);
    const r = analyzeData(text);
    expect(r).toBeTruthy();
    expect(parseTable(text).rowCount).toBe(N);
  });

  test("summarizeColumn reports the true min and max of a huge column", () => {
    const col = Array.from({ length: N }, (_, i) => String(((i * 7919) % 100003) + 1));
    const s = summarizeColumn("value", col);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100003);
  });
});
