// Candlestick charts: the convention is stated, the columns are identified, and an
// impossible candle is refused rather than drawn.
//
// Three things carry most of the risk in this form, and each has its own block below.
//
//   THE UP/DOWN CONVENTION. Green-up/red-down is Western; in much of East Asia red is
//   UP. A chart relying on colour alone is ambiguous to a large part of its audience
//   before colour blindness or a photocopier is considered. Direction is therefore
//   carried FIRST by hollow-vs-filled bodies — the older Japanese convention, which
//   survives greyscale — with colour as reinforcement and the legend saying which is
//   which in words.
//
//   COLUMN IDENTIFICATION. Reading open/high/low/close in the wrong order produces
//   candles that look entirely plausible and are wrong. Names are used first; position
//   is a fallback only when the OHLC invariants then hold on every row, which is a
//   real check rather than a hope.
//
//   IMPOSSIBLE ROWS. A high below the close is not a candle. Drawing it anyway would
//   render a shape that means nothing and let a data-entry error pass as a market
//   event.

import { buildCandlestickSvg, identifyOhlc } from "../candlestick";
import { buildChartPreviewSvg, TableChart } from "../tablechart";

const mk = (cats: string[], cols: Array<[string, (number | null)[]]>): TableChart => ({
  categories: cats,
  series: cols.map(([name, values]) => ({ name, values })),
  categoryLabel: "Day",
  hasHeader: true,
  rows: [],
  warnings: [],
});

/** Five well-formed periods: two up, two down, one flat-ish. */
const OK = mk(
  ["Mon", "Tue", "Wed", "Thu", "Fri"],
  [
    ["Open", [100, 104, 102, 108, 107]],
    ["High", [106, 107, 109, 112, 110]],
    ["Low", [99, 101, 101, 106, 104]],
    ["Close", [104, 102, 108, 107, 109]],
  ],
);

describe("the columns are identified, not guessed", () => {
  test("by name, in any order and any capitalisation", () => {
    const shuffled = mk(
      ["a"],
      [["CLOSE", [4]], ["low", [1]], ["Open", [2]], ["High", [9]]],
    );
    const r = identifyOhlc(shuffled);
    expect(typeof r).not.toBe("string");
    if (typeof r === "string") return;
    expect({ o: r.open[0], h: r.high[0], l: r.low[0], c: r.close[0], how: r.how }).toEqual({
      o: 2, h: 9, l: 1, c: 4, how: "named",
    });
  });

  test("\"Open Interest\" is NOT read as \"Open\"", () => {
    // A real futures column and a completely different quantity. A prefix match would
    // take it and hand its figures to the renderer as prices.
    const t = mk(["r"], [["Open Interest", [2]], ["High", [9]], ["Low", [1]], ["Close", [4]]]);
    const r = identifyOhlc(t);
    // Only three roles are named, so it must fall back or refuse — never silently
    // treat open interest as the opening price.
    if (typeof r !== "string") expect(r.how).toBe("positional");
  });

  test.each([
    ["O", "H", "L", "C"],
    ["Open", "Max", "Min", "Last"],
    ["open price", "high price", "low price", "closing"],
    ["Open Px", "High Px", "Low Px", "Close Px"],
  ])("recognises %s/%s/%s/%s", (a, b, c, d) => {
    const t = mk(["r"], [[a, [2]], [b, [9]], [c, [1]], [d, [4]]]);
    const r = identifyOhlc(t);
    expect(typeof r).not.toBe("string");
    if (typeof r === "string") return;
    expect(r.how).toBe("named");
    expect(r.high[0]).toBe(9);
  });

  test("unnamed columns fall back to position ONLY when the data confirms it", () => {
    const pos = mk(["a", "b"], [["c1", [10, 12]], ["c2", [14, 15]], ["c3", [9, 11]], ["c4", [13, 11]]]);
    const r = identifyOhlc(pos);
    expect(typeof r).not.toBe("string");
    if (typeof r === "string") return;
    expect(r.how).toBe("positional");
    // and the assumption is DISCLOSED, not silent
    const built = buildCandlestickSvg(pos, "", {}, 620, 420);
    expect(built.notes.join(" ")).toMatch(/conventional order/);
    expect(built.notes.join(" ")).toMatch(/CHECKED against the data/);
  });

  test("a positional guess that the data contradicts is REFUSED", () => {
    // Columns in the order open, low, high, close. If position were trusted blindly,
    // this would draw candles that look perfectly ordinary and are wrong.
    const wrong = mk(["a", "b"], [["c1", [10, 12]], ["c2", [9, 11]], ["c3", [14, 15]], ["c4", [13, 11]]]);
    const r = identifyOhlc(wrong);
    expect(typeof r).toBe("string");
    expect(r as string).toMatch(/could not be identified/);
    expect(r as string).toMatch(/not the largest of its four values/);
    expect(r as string).toMatch(/look perfectly\s+plausible and are wrong/);
  });

  test("too few columns says how many it found and what it needs", () => {
    const few = mk(["a"], [["Open", [1]], ["Close", [2]]]);
    const r = identifyOhlc(few);
    expect(typeof r).toBe("string");
    expect(r as string).toMatch(/needs four numeric columns/);
    expect(r as string).toMatch(/"Open", "Close"/);
  });
});

describe("the up/down convention is stated, never assumed", () => {
  test("the legend spells out hollow and filled in words", () => {
    const r = buildCandlestickSvg(OK, "ACME", {}, 620, 420);
    expect(r.error).toBeNull();
    expect(r.svg).toMatch(/hollow = close at or above open/);
    expect(r.svg).toMatch(/filled = close below open/);
  });

  test("direction survives with NO colour at all", () => {
    // The point of hollow-vs-filled being primary. In greyscale nothing green or red
    // may remain, and the chart must still distinguish up from down.
    const r = buildCandlestickSvg(OK, "", { grey: true }, 620, 420);
    expect(r.svg).not.toMatch(/#0ca30c|#d03b3b/);
    expect(r.svg).toMatch(/hollow = close at or above open/);
    expect(r.notes.join(" ")).toMatch(/carried entirely by hollow versus filled/);
    // Both a hollow (surface-filled) and a solid (ink-filled) body must be present.
    expect(r.svg).toMatch(/fill="#fcfcfb" stroke="#0b0b0b"/);
    expect(r.svg).toMatch(/fill="#0b0b0b" stroke="#0b0b0b"/);
  });

  test("the East Asian convention is supported, and the legend follows it", () => {
    const west = buildCandlestickSvg(OK, "", {}, 620, 420);
    const east = buildCandlestickSvg(OK, "", { redIsUp: true }, 620, 420);
    expect(west.svg).toMatch(/green = up/);
    expect(east.svg).toMatch(/red = up/);
    expect(east.svg).not.toBe(west.svg);
  });

  test("an up candle is hollow and a down candle is filled", () => {
    // Mon closes 104 above its open of 100 (up, hollow); Tue closes 102 below 104
    // (down, filled). Both must appear.
    const r = buildCandlestickSvg(OK, "", {}, 620, 420);
    expect(r.svg).toMatch(/fill="#fcfcfb" stroke="#0ca30c"/); // hollow up
    expect(r.svg).toMatch(/fill="#d03b3b" stroke="#d03b3b"/); // filled down
  });
});

describe("impossible and incomplete rows", () => {
  test("a high below the close is a data error, and no candle is drawn", () => {
    const imp = mk(
      ["a", "b"],
      [["Open", [10, 10]], ["High", [5, 15]], ["Low", [1, 8]], ["Close", [9, 12]]],
    );
    const r = buildCandlestickSvg(imp, "", {}, 620, 420);
    expect(r.error).toBeNull(); // the other row still draws
    expect(r.notes.join(" ")).toMatch(/could not be drawn/);
    expect(r.notes.join(" ")).toMatch(/data error rather than a market event/);
  });

  test("a missing value leaves a gap rather than closing it up", () => {
    // Shifting later candles left would silently misdate every one of them.
    const gap = mk(
      ["a", "b", "c"],
      [["Open", [10, null, 12]], ["High", [15, 16, 17]], ["Low", [8, 9, 10]], ["Close", [12, 13, 14]]],
    );
    const r = buildCandlestickSvg(gap, "", {}, 620, 420);
    expect(r.notes.join(" ")).toMatch(/missing one or more of the four values/);
    expect(r.notes.join(" ")).toMatch(/time axis stays honest/);
  });

  test("when nothing is drawable it says so instead of returning a blank frame", () => {
    const allBad = mk(["a"], [["Open", [10]], ["High", [1]], ["Low", [20]], ["Close", [5]]]);
    const r = buildCandlestickSvg(allBad, "", {}, 620, 420);
    expect(r.error).toMatch(/No row has a usable set of four values/);
  });

  test("a figure too small to draw says so", () => {
    expect(buildCandlestickSvg(OK, "", {}, 50, 50).error).toMatch(/too small/);
  });
});

describe("the rendered figure", () => {
  test("no non-finite coordinate reaches the markup", () => {
    for (const opts of [{}, { grey: true }, { redIsUp: true }]) {
      const r = buildCandlestickSvg(OK, "ACME", opts, 620, 420);
      expect(r.svg).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  test("a flat period still shows a body", () => {
    // Open equal to close has zero height; without a minimum it would vanish and the
    // period would look absent rather than unchanged.
    const flat = mk(["a"], [["Open", [10]], ["High", [12]], ["Low", [8]], ["Close", [10]]]);
    const r = buildCandlestickSvg(flat, "", {}, 620, 420);
    expect(r.error).toBeNull();
    expect(r.svg).toMatch(/height="1(\.0)?"/);
  });

  test("all values identical does not produce a degenerate axis", () => {
    const same = mk(["a", "b"], [["Open", [5, 5]], ["High", [5, 5]], ["Low", [5, 5]], ["Close", [5, 5]]]);
    const r = buildCandlestickSvg(same, "", {}, 620, 420);
    expect(r.error).toBeNull();
    expect(r.svg).not.toMatch(/NaN|Infinity/);
    expect(r.notes.join(" ")).toMatch(/arbitrary span/);
  });

  test("many periods thin the LABELS but draw every candle", () => {
    const n = 120;
    const many = mk(
      Array.from({ length: n }, (_, i) => `d${i}`),
      [
        ["Open", Array.from({ length: n }, () => 10)],
        ["High", Array.from({ length: n }, () => 12)],
        ["Low", Array.from({ length: n }, () => 8)],
        ["Close", Array.from({ length: n }, () => 11)],
      ],
    );
    const r = buildCandlestickSvg(many, "", {}, 620, 420);
    expect(r.notes.join(" ")).toMatch(/Every candle is drawn/);
    // One body rect per period, plus the two legend swatches.
    const rects = [...r.svg.matchAll(/<rect /g)].length;
    expect(rects).toBeGreaterThanOrEqual(n);
  });
});

describe("it is reachable, and its refusals are visible", () => {
  test('buildChartPreviewSvg dispatches kind "candlestick"', () => {
    const svg = buildChartPreviewSvg(OK, "candlestick", "ACME", {});
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/hollow = close at or above open/);
  });

  test("a refusal is drawn INTO the figure, not swallowed into a blank frame", () => {
    // A blank frame is indistinguishable from a bug and gives the reader nothing to
    // act on. The message has to survive into the inserted picture.
    const wrong = mk(["a"], [["c1", [10]], ["c2", [9]], ["c3", [14]], ["c4", [13]]]);
    const svg = buildChartPreviewSvg(wrong, "candlestick", "", {});
    expect(svg).toMatch(/This chart cannot be drawn/);
    expect(svg).toMatch(/could not be identified/);
  });

  test("the patent style renders without the status colours", () => {
    const bw = buildChartPreviewSvg(OK, "candlestick", "ACME", { patent: true });
    expect(bw).not.toMatch(/#0ca30c|#d03b3b/);
  });
});
