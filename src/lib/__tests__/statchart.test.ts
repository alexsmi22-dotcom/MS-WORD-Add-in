// The statistics chart builders.
//
// Tested on PROPERTIES, not on recorded output. A snapshot of an SVG passes
// forever and tells you nothing about whether the picture is right; these
// assert the things that make the picture true — that the median line sits
// between the quartiles, that an interval crossing the null line is drawn
// differently from one that does not, that a builder handed rubbish says so on
// the artwork instead of returning a blank frame.
//
// "An empty page cannot overlap itself" is this repo's recorded worst gate
// failure: the figure-layout auditor reports a blank SVG as clean. So every
// case here also asserts the figure is NON-DEGENERATE — it carries text.

import {
  boxStats,
  boxPlotSvg,
  forestPlotSvg,
  groupedBarSvg,
} from "../statchart";

/**
 * The bar rectangles only — NOT the legend swatch beside them.
 *
 * The first version of this matched any `<rect>` in the series colour and
 * counted three bars where two were drawn, because the legend key is a rect in
 * exactly that colour. Bars carry computed geometry and are written with one
 * decimal place; the legend swatch is a fixed 9x9 integer square. Requiring the
 * decimal point separates them without depending on drawing order.
 */
const BAR_RECT = /<rect x="[\d.]+" y="[\d.]+" width="\d+\.\d" height="[\d.]+" fill="#2563eb"/g;

/** Every builder must emit one well-formed root with something drawn in it. */
function isRealFigure(svg: string): boolean {
  return (
    /^<svg\b/.test(svg) &&
    svg.trim().endsWith("</svg>") &&
    /<text[ >]/.test(svg) &&
    !/NaN|Infinity|undefined/.test(svg)
  );
}

describe("boxStats", () => {
  test("quartiles follow the type-7 definition the doc comment names", () => {
    // R: quantile(1:9, c(.25,.5,.75)) -> 3, 5, 7
    const s = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(s.q1).toBeCloseTo(3, 10);
    expect(s.median).toBeCloseTo(5, 10);
    expect(s.q3).toBeCloseTo(7, 10);
  });

  test("the five numbers are always ordered", () => {
    // Random data, because an ordering bug hides behind any one example.
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + ((trial * 7) % 30);
      const xs = Array.from({ length: n }, (_, i) => Math.sin(trial * 13.7 + i * 2.3) * 100);
      const s = boxStats(xs)!;
      expect(s.min).toBeLessThanOrEqual(s.q1);
      expect(s.q1).toBeLessThanOrEqual(s.median);
      expect(s.median).toBeLessThanOrEqual(s.q3);
      expect(s.q3).toBeLessThanOrEqual(s.max);
      expect(s.loWhisker).toBeLessThanOrEqual(s.hiWhisker);
    }
  });

  test("a far-out value is an outlier and does not become the whisker", () => {
    const s = boxStats([1, 2, 3, 4, 5, 200])!;
    expect(s.outliers).toContain(200);
    expect(s.hiWhisker).toBeLessThan(200);
    expect(s.max).toBe(200); // still reported, never dropped
  });

  test("non-finite values are dropped, not propagated", () => {
    const s = boxStats([1, NaN, 2, Infinity, 3, -Infinity])!;
    expect(Number.isFinite(s.median)).toBe(true);
    expect(s.max).toBe(3);
  });

  test("no finite values at all returns null rather than a fake summary", () => {
    expect(boxStats([])).toBeNull();
    expect(boxStats([NaN, Infinity])).toBeNull();
  });

  test("all values identical: a degenerate box, not a crash", () => {
    const s = boxStats([7, 7, 7, 7])!;
    expect(s.q1).toBe(7);
    expect(s.median).toBe(7);
    expect(s.q3).toBe(7);
  });
});

describe("boxPlotSvg", () => {
  const groups = [
    { label: "control", values: [5, 6, 7, 8, 9] },
    { label: "treated", values: [10, 11, 12, 13, 14] },
  ];

  test("draws a real figure carrying both group labels and their n", () => {
    const svg = boxPlotSvg(groups, { title: "Groups", ylabel: "response" });
    expect(isRealFigure(svg)).toBe(true);
    expect(svg).toContain("control");
    expect(svg).toContain("treated");
    expect(svg).toContain("n=5");
  });

  test("the median line lies between the quartile edges of its own box", () => {
    // The y axis is inverted in SVG, so a larger value has a SMALLER y. The
    // check is that the red median rule sits inside the blue box rectangle.
    const svg = boxPlotSvg([{ label: "a", values: [1, 2, 3, 4, 100] }], {});
    const rect = /<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" fill="#ffffff" stroke="#2563eb"/.exec(svg);
    expect(rect).not.toBeNull();
    const top = Number(rect![1]);
    const bottom = top + Number(rect![2]);
    const med = /<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="[\d.]+" stroke="#b91c1c" stroke-width="2"\/>/.exec(svg);
    expect(med).not.toBeNull();
    const my = Number(med![1]);
    expect(my).toBeGreaterThanOrEqual(top - 0.5);
    expect(my).toBeLessThanOrEqual(bottom + 0.5);
  });

  test("empty and all-non-finite input say why instead of returning a blank", () => {
    for (const svg of [
      boxPlotSvg([], {}),
      boxPlotSvg([{ label: "a", values: [NaN, Infinity] }], {}),
    ]) {
      expect(isRealFigure(svg)).toBe(true);
      expect(svg).toMatch(/no finite values/i);
    }
  });

  test("a group beyond the cap is reported, never silently dropped", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `g${i}`, values: [i, i + 1, i + 2] }));
    const svg = boxPlotSvg(many, {});
    expect(svg).toMatch(/more group\(s\) not shown/);
  });

  test("labels rotate only when they would not fit, and rotate to -90", () => {
    // Rotation is decided by the WIDEST LABEL against the slot width, not by
    // the group count on its own — which is why TWELVE short labels stay
    // horizontal while EIGHT long ones rotate. Both directions are pinned,
    // because a rule that is wrong in one direction is usually wrong in the
    // other: rotating when it was not needed wastes half the plot height.
    //
    // Labels are truncated at 12 characters, so "widest" saturates there and
    // the crossover for a full-width label lands at about five groups.
    const short = boxPlotSvg(
      Array.from({ length: 12 }, (_, i) => ({ label: `g${i}`, values: [1, 2, 3] })),
      {},
    );
    expect(short).not.toMatch(/rotate\(-90/);

    const long = boxPlotSvg(
      Array.from({ length: 8 }, (_, i) => ({ label: `a very long name ${i}`, values: [1, 2, 3] })),
      {},
    );
    expect(long).toMatch(/rotate\(-90/);
    // -45 was tried first and made the layout audit WORSE (22 collisions became
    // 34): a 45-degree label still advances by most of its width, and the
    // auditor models only -90. Pin the angle so that is not rediscovered.
    expect(long).not.toMatch(/rotate\(-45/);
  });

  test("a rotated label is centred on its anchor, so drawn and measured agree", () => {
    // The layout auditor treats a rotated label as centred on its anchor. With
    // `end` anchoring the glyphs ran downward instead, the two rectangles
    // disagreed, and the gate reported the axis striking through every label.
    const svg = boxPlotSvg(
      Array.from({ length: 8 }, (_, i) => ({ label: `a very long name ${i}`, values: [1, 2, 3] })),
      {},
    );
    const rotated = [...svg.matchAll(/<text[^>]*transform="rotate\(-90[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(rotated.length).toBeGreaterThan(0);
    for (const t of rotated) expect(t).toContain('text-anchor="middle"');
  });

  test("the same data draws the same picture twice", () => {
    // The observations are spread by index rather than at random precisely so
    // that inserting a result twice cannot produce two different figures.
    expect(boxPlotSvg(groups, { title: "x" })).toBe(boxPlotSvg(groups, { title: "x" }));
  });

  test("a single value per group still produces a figure", () => {
    const svg = boxPlotSvg([{ label: "one", values: [42] }], {});
    expect(isRealFigure(svg)).toBe(true);
  });

  test("enormous and tiny magnitudes stay finite in the output", () => {
    for (const v of [1e-300, 1e300, -1e300]) {
      const svg = boxPlotSvg([{ label: "a", values: [v, v * 2, v * 3] }], {});
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("forestPlotSvg", () => {
  const rows = [
    { label: "A vs B", estimate: 2, low: 1, high: 3 }, // excludes 0
    { label: "A vs C", estimate: 0.5, low: -1, high: 2 }, // crosses 0
  ];

  test("draws a real figure with every row label", () => {
    const svg = forestPlotSvg(rows, { title: "Pairwise", xlabel: "difference" });
    expect(isRealFigure(svg)).toBe(true);
    expect(svg).toContain("A vs B");
    expect(svg).toContain("A vs C");
  });

  test("an interval crossing the null line is drawn differently from one that does not", () => {
    // This is the whole point of the figure, so it is asserted rather than
    // assumed: the significant row is blue, the inconclusive one grey.
    const svg = forestPlotSvg(rows, {});
    expect(svg).toContain("#2563eb");
    expect(svg).toContain("#6b7280");
  });

  test("the null line moves when the comparison is a ratio", () => {
    // A hazard ratio is null at 1. Drawing the line at 0 would mark every
    // interval as significant, which is the failure this parameter prevents.
    const ratio = [{ label: "HR", estimate: 1.1, low: 0.8, high: 1.5 }];
    const atOne = forestPlotSvg(ratio, { zero: 1 });
    const atZero = forestPlotSvg(ratio, { zero: 0 });
    expect(atOne).not.toBe(atZero);
    // Null at 1: the interval spans it, so the row is drawn as inconclusive.
    expect(atOne).toContain("#6b7280");
    // Null at 0: the interval is entirely above it, so it reads significant.
    expect(atZero).toContain("#2563eb");
  });

  test("a non-estimable row is labelled, not skipped and not drawn as zero", () => {
    const svg = forestPlotSvg(
      [
        { label: "ok", estimate: 1, low: 0.5, high: 1.5 },
        { label: "broken", estimate: NaN, low: NaN, high: NaN },
      ],
      {},
    );
    expect(svg).toContain("broken");
    expect(svg).toContain("not estimable");
    expect(svg).not.toMatch(/NaN/);
  });

  test("no finite rows says why", () => {
    const svg = forestPlotSvg([{ label: "x", estimate: NaN, low: NaN, high: NaN }], {});
    expect(isRealFigure(svg)).toBe(true);
    expect(svg).toMatch(/no finite intervals/i);
  });

  test("height grows with the row count so rows cannot overlap", () => {
    const h = (n: number): number =>
      Number(
        /height="(\d+)"/.exec(
          forestPlotSvg(
            Array.from({ length: n }, (_, i) => ({ label: `r${i}`, estimate: 1, low: 0, high: 2 })),
            {},
          ),
        )![1],
      );
    expect(h(6)).toBeGreaterThan(h(2));
  });

  test("rows beyond the cap are reported", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `r${i}`, estimate: 1, low: 0, high: 2 }));
    expect(forestPlotSvg(many, {})).toMatch(/more not shown/);
  });
});

describe("groupedBarSvg", () => {
  const cats = ["red", "green", "blue"];
  const series = [
    { label: "observed", values: [10, 20, 30] },
    { label: "expected", values: [20, 20, 20] },
  ];

  test("draws a real figure with categories and a legend", () => {
    const svg = groupedBarSvg(cats, series, { title: "Fit", ylabel: "count" });
    expect(isRealFigure(svg)).toBe(true);
    for (const c of cats) expect(svg).toContain(c);
    expect(svg).toContain("observed");
    expect(svg).toContain("expected");
  });

  test("a taller value gets a taller bar", () => {
    // Same bar-versus-legend distinction as BAR_RECT, with the height captured.
    const heights = [
      ...groupedBarSvg(cats, [series[0]], {}).matchAll(
        /<rect x="[\d.]+" y="[\d.]+" width="\d+\.\d" height="([\d.]+)" fill="#2563eb"/g,
      ),
    ].map((m) => Number(m[1]));
    expect(heights).toHaveLength(3);
    expect(heights[0]).toBeLessThan(heights[1]);
    expect(heights[1]).toBeLessThan(heights[2]);
  });

  test("a missing value leaves a gap rather than drawing a zero bar", () => {
    const svg = groupedBarSvg(cats, [{ label: "o", values: [10, NaN, 30] }], {});
    expect(svg).not.toMatch(/NaN/);
    const bars = [...svg.matchAll(BAR_RECT)];
    expect(bars).toHaveLength(2);
  });

  test("negative values are drawn from the zero line, not from the floor", () => {
    const svg = groupedBarSvg(["a", "b"], [{ label: "d", values: [-5, 5] }], {});
    expect(isRealFigure(svg)).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  test("empty input says why", () => {
    expect(groupedBarSvg([], [], {})).toMatch(/no finite values/i);
    expect(groupedBarSvg(cats, [{ label: "x", values: [NaN, NaN, NaN] }], {})).toMatch(/no finite values/i);
  });

  test("categories beyond the cap are reported", () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const svg = groupedBarSvg(many, [{ label: "v", values: many.map((_, i) => i) }], {});
    expect(svg).toMatch(/more category\(s\) not shown/);
  });
});

describe("none of these figures follows the pane theme", () => {
  // Inserted artwork goes into a Word document as line art. A themed colour
  // would render invisible on white paper. There is a repo-wide gate for this;
  // this is the module-local one that fails first.
  test("every builder emits literal colours only", () => {
    const svgs = [
      boxPlotSvg([{ label: "a", values: [1, 2, 3] }], { title: "t" }),
      forestPlotSvg([{ label: "a", estimate: 1, low: 0, high: 2 }], { title: "t" }),
      groupedBarSvg(["a"], [{ label: "s", values: [1] }], { title: "t" }),
    ];
    for (const svg of svgs) {
      expect(svg).not.toMatch(/var\(--/);
      expect(svg).not.toMatch(/currentColor/);
      expect(svg).toMatch(/#[0-9a-f]{6}/i);
    }
  });
});
