// A finite result must never produce a figure containing NaN.
//
// FOUND BY AN ADVERSARIAL PASS THAT CALLED THE CODE rather than reading it.
// `hi - lo` overflows to Infinity for two finite values near opposite ends of
// the double range, and every scale of the form `(v - lo) / span` is then
// Infinity/Infinity = NaN, which goes into the markup and into a document.
//
// WHAT MAKES IT REACHABLE rather than theoretical: a RANK test is immune to
// magnitude by construction. Mann-Whitney on `1.7e308 -1.7e308 1 2 3` returns a
// perfectly finite U, z and p, so `insertableResultText` sees clean text and
// enables the button — the text gate can never catch this class. Kruskal-Wallis,
// Friedman and Wilcoxon are the same shape.
//
// `hBarSvg` has carried this guard since the Engineering campaign
// (mechchart.ts, "hi and lo are each finite, but hi - lo can still overflow").
// statchart did not inherit it. The lesson is the reusable part: when a new
// module does the same job as an old one, port its GUARDS, not just its shape.

import { boxPlotSvg, forestPlotSvg, groupedBarSvg, boxStats } from "../statchart";
import { hBarSvg, ladderSvg } from "../mechchart";
import { mannWhitneyU } from "../stats2";

const BIG = 1.7e308;

/** Anything a Word document must never receive. */
function isDirty(svg: string): string[] {
  return ["NaN", "Infinity", "undefined"].filter((bad) => svg.includes(bad));
}

describe("the reachable path: a rank test on extreme magnitudes", () => {
  test("the statistic really is finite, so the text gate cannot catch it", () => {
    const a = [BIG, -BIG, 1, 2, 3];
    const b = [4, 5, 6, 7, 8];
    const res = mannWhitneyU(a, b);
    // If this ever stops being finite, this whole file is testing a path the
    // product can no longer reach — which would make it obsolete, not passing.
    expect(Number.isFinite(res.statistic)).toBe(true);
    expect(Number.isFinite(res.z)).toBe(true);
    expect(Number.isFinite(res.p)).toBe(true);
  });

  test("and the box plot beside it is clean", () => {
    const svg = boxPlotSvg(
      [
        { label: "group 1", values: [BIG, -BIG, 1, 2, 3] },
        { label: "group 2", values: [4, 5, 6, 7, 8] },
      ],
      { title: "Mann-Whitney U", ylabel: "value" },
    );
    expect(isDirty(svg)).toEqual([]);
  });
});

describe("no builder emits NaN for any finite input", () => {
  const HOSTILE: number[][] = [
    [BIG, -BIG],
    [BIG, -BIG, 0],
    [-BIG, BIG, 1e-320],
    [Number.MAX_VALUE, -Number.MAX_VALUE],
    [5e-324, -5e-324],
    [1e308, 1e308, -1e308],
    [0, -0],
    [7, 7, 7, 7],
    [42],
  ];

  test("boxPlotSvg", () => {
    for (const values of HOSTILE) {
      const svg = boxPlotSvg([{ label: "g", values }], { title: "t", ylabel: "v" });
      expect({ values, dirty: isDirty(svg) }).toEqual({ values, dirty: [] });
    }
  });

  test("groupedBarSvg", () => {
    for (const values of HOSTILE) {
      const svg = groupedBarSvg(
        values.map((_, i) => `c${i}`),
        [{ label: "s", values }],
        { title: "t", ylabel: "v" },
      );
      expect({ values, dirty: isDirty(svg) }).toEqual({ values, dirty: [] });
    }
  });

  test("forestPlotSvg", () => {
    const svg = forestPlotSvg(
      [
        { label: "a", estimate: 0, low: -BIG, high: BIG },
        { label: "b", estimate: 1, low: 0, high: 2 },
      ],
      { title: "t", xlabel: "d" },
    );
    expect(isDirty(svg)).toEqual([]);
  });

  test("hBarSvg and ladderSvg, which already had the guard", () => {
    expect(isDirty(hBarSvg([{ name: "a", value: BIG }, { name: "b", value: -BIG }], { title: "t", unit: "" }))).toEqual([]);
    expect(
      isDirty(
        ladderSvg(
          [
            { name: "a", delta: BIG, gain: true },
            { name: "b", delta: -BIG, gain: false },
            { name: "total", delta: 0, gain: true, result: true },
          ],
          { title: "t", axisLabel: "x", fmt: (v) => String(v) },
        ),
      ),
    ).toEqual([]);
  });
});

describe("boxStats quartiles stay finite across the whole double range", () => {
  test("the interpolation does not overflow", () => {
    // `a + (b - a) * f` returns Infinity here; the weighted-mean form does not.
    const s = boxStats([BIG, -BIG])!;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "number") {
        expect({ k, finite: Number.isFinite(v) }).toEqual({ k, finite: true });
      }
    }
  });

  test("and the ordinary answers are unchanged", () => {
    // The fix must be a no-op for every normal input: R gives 3, 5, 7.
    const s = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(s.q1).toBeCloseTo(3, 10);
    expect(s.median).toBeCloseTo(5, 10);
    expect(s.q3).toBeCloseTo(7, 10);
  });
});

describe("the axis does not collapse to one repeated tick", () => {
  // The second failure in this family is not a NaN. With a span of 3.4e308 a
  // niceStep of 1 satisfies its postcondition and still yields 201 gridlines
  // that are all the same pixel and 201 labels that all read the same number —
  // a figure that is well-formed, insertable and unreadable.
  test("an extreme span still produces distinct tick labels", () => {
    const svg = boxPlotSvg([{ label: "g", values: [BIG, -BIG] }], { title: "t", ylabel: "v" });
    const labels = [...svg.matchAll(/<text[^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBeGreaterThan(1);
  });

  test("and the figure does not balloon", () => {
    // 201 repeated gridlines and labels produced a 42 KB SVG for two points.
    const svg = boxPlotSvg([{ label: "g", values: [BIG, -BIG] }], { title: "t", ylabel: "v" });
    expect(svg.length).toBeLessThan(12000);
  });
});

describe("labels that XML cannot carry are removed, not escaped", () => {
  // A C0 control character is not representable in XML 1.0 in ANY form, so one
  // in a label makes the whole SVG not-well-formed. The pane's innerHTML
  // preview is lenient and renders it fine; svgToPngBase64 rejects — so the
  // chart looks perfect on screen and the insert fails. Preview is not insert.
  //
  // Reachable through two-way ANOVA, whose factor levels are raw user
  // substrings: 0x07 (BEL) is Word's own table-cell marker, so pasting a cell
  // out of a Word table as a factor level is the realistic vector.
  const BEL = String.fromCharCode(7);

  test("the control character is gone from the output", () => {
    const svg = groupedBarSvg([`high${BEL}`, "low"], [{ label: `B = high${BEL}`, values: [1, 2] }], {
      title: "t",
    });
    for (let i = 0; i < svg.length; i++) {
      const c = svg.charCodeAt(i);
      const legal = c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 159;
      expect({ at: i, code: c, legal }).toEqual({ at: i, code: c, legal: true });
    }
  });

  test("every builder strips them, and the visible text survives", () => {
    const svgs = [
      boxPlotSvg([{ label: `g${BEL}1`, values: [1, 2, 3] }], { title: "t" }),
      forestPlotSvg([{ label: `r${BEL}1`, estimate: 1, low: 0, high: 2 }], { title: "t" }),
      groupedBarSvg([`c${BEL}1`], [{ label: `s${BEL}1`, values: [1] }], { title: "t" }),
    ];
    for (const svg of svgs) {
      expect(svg.includes(BEL)).toBe(false);
      // The label is still readable — stripping must not eat the whole string.
      expect(/[gsrc]1/.test(svg)).toBe(true);
    }
  });

  test("ordinary escaping still happens", () => {
    const svg = boxPlotSvg([{ label: "a<b&c", values: [1, 2, 3] }], { title: "t" });
    expect(svg).toContain("a&lt;b&amp;c");
    expect(svg).not.toContain("a<b&c");
  });
});

describe("caps report what they dropped", () => {
  test("boxPlotSvg says when it drew fewer points than n", () => {
    // Printing n=200 beside sixty dots is the figure contradicting its own
    // caption — the defect already fixed once on the Wilcoxon box.
    const values = Array.from({ length: 200 }, (_, i) => i);
    const svg = boxPlotSvg([{ label: "g", values }], { title: "t" });
    expect(svg).toContain("n=200");
    expect(svg).toMatch(/60 shown/);
  });

  test("ladderSvg says when it dropped rows", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ name: `row${i}`, delta: 1, gain: true }));
    rows.push({ name: "total", delta: 40, gain: true, result: true } as never);
    const svg = ladderSvg(rows, { title: "Budget", axisLabel: "x", fmt: (v) => String(v) });
    expect(svg).toMatch(/more/);
  });

  test("ladderSvg's cap cannot be escaped by a negative slice end", () => {
    // `slice(0, 10 - resultRows.length)` went NEGATIVE past ten result rows,
    // and a negative end counts from the tail instead of truncating — so the
    // cap silently stopped applying.
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({ name: `n${i}`, delta: 1, gain: true })),
      ...Array.from({ length: 15 }, (_, i) => ({ name: `r${i}`, delta: 1, gain: true, result: true })),
    ];
    const svg = ladderSvg(rows, { title: "t", axisLabel: "x", fmt: (v) => String(v) });
    const height = Number(/height="(\d+)"/.exec(svg)![1]);
    // Ten rows at 34px plus chrome; anything near 20 rows means the cap leaked.
    expect(height).toBeLessThan(56 + 11 * 34 + 12);
  });
});
