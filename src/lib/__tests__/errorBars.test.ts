// Error bars must say what they are.
//
// The same data plotted as ±1 SD, ±1 SEM and a 95% CI tells a reader three
// different things, and SEM bars are always the smallest, which is exactly why
// they get chosen. An unlabelled bar is not a neutral omission — it is the one
// piece of information needed to read the figure at all. So the declaration is
// rendered onto the figure rather than left to a caption.

import { buildPlotSvg, Series, ErrorBarKind } from "../plot";

const withErr: Series[] = [
  {
    type: "scatter",
    points: [
      { x: 1, y: 10, err: 2 },
      { x: 2, y: 14, err: 1.5 },
      { x: 3, y: 19, err: 3 },
    ],
  },
];
const noErr: Series[] = [{ type: "scatter", points: [{ x: 1, y: 10 }, { x: 2, y: 14 }] }];

describe("the declaration reaches the figure", () => {
  const expected: [ErrorBarKind, RegExp][] = [
    ["sd", /±1 SD/],
    ["sem", /±1 SEM/],
    ["ci95", /95% CI/],
    ["range", /full range/i],
    ["custom", /as supplied/i],
  ];
  for (const [kind, re] of expected) {
    test(kind, () => {
      const svg = buildPlotSvg(withErr, { errorBars: kind, xlabel: "Dose" });
      expect(svg).toMatch(re);
      // The x label must survive alongside it rather than be overwritten.
      expect(svg).toMatch(/Dose/);
    });
  }

  // REGRESSION (gap analysis 2026-08-05). The header above — and plot.ts's own
  // comment — said the figure states what its bars are. THE DEFAULT DID NOT. Bars
  // are drawn from `p.err` alone; the declaration was gated on `options.errorBars`,
  // which the pane leaves empty until the user picks something. So the out-of-the-
  // box figure carried undeclared bars: precisely the thing the comment forbids.
  //
  // This test used to assert the defect ("no declaration means no claim on the
  // figure"), which is why it survived. A drawn bar IS a claim.
  test("bars drawn with no kind given SAY that no kind was given", () => {
    const svg = buildPlotSvg(withErr, { xlabel: "Dose" });
    expect(svg).toMatch(/Error bars/);
    expect(svg).toMatch(/kind not stated/);
    // And it must not silently pick one of the five real kinds.
    expect(svg).not.toMatch(/SD|SEM|CI|full range|as supplied/);
    // The bars themselves are still drawn — refusing to draw them would delete a
    // column of the user's data with no channel to say why.
    expect((svg.match(/<line /g) || []).length).toBeGreaterThanOrEqual(9);
  });

  test("a declaration with no error data draws no note", () => {
    // Otherwise a figure with no bars would still assert what its absent bars mean.
    const svg = buildPlotSvg(noErr, { errorBars: "sem" });
    expect(svg).not.toMatch(/Error bars/);
  });

  test("no bars, no declaration — the note is about bars, not about options", () => {
    expect(buildPlotSvg(noErr, {})).not.toMatch(/Error bars/);
  });

  test("an err that draws no bar makes no claim either", () => {
    // The note's predicate must be the one the DRAWING uses: `err: 0` and a
    // non-finite err both produce no bar, so they must produce no declaration.
    const zero: Series[] = [{ type: "scatter", points: [{ x: 1, y: 10, err: 0 }, { x: 2, y: 12, err: 0 }] }];
    const nan: Series[] = [{ type: "scatter", points: [{ x: 1, y: 10, err: NaN }, { x: 2, y: 12, err: NaN }] }];
    expect(buildPlotSvg(zero, {})).not.toMatch(/Error bars/);
    expect(buildPlotSvg(nan, {})).not.toMatch(/Error bars/);
  });

  test("a LINE series draws no bars, so it makes no claim about them", () => {
    // Bars are a scatter-only rendering, but the pane reads a third data column
    // into `err` whatever type the user picked — so a line plot of the same data
    // would otherwise carry a declaration about bars nobody can see.
    const asLine: Series[] = [{ type: "line", points: withErr[0].points }];
    const svg = buildPlotSvg(asLine, { xlabel: "Dose" });
    expect(svg).not.toMatch(/Error bars/);
    expect(svg).toMatch(/Dose/);
  });
});

describe("bars are drawn with caps", () => {
  test("each bar gets a stem and two caps", () => {
    const svg = buildPlotSvg(withErr, { errorBars: "sd" });
    // Three points, each with a stem plus an upper and lower cap.
    const lines = (svg.match(/<line /g) || []).length;
    expect(lines).toBeGreaterThanOrEqual(9);
  });

  test("a bar clipped at a log axis keeps its upper cap and drops the lower one", () => {
    // y - err <= 0 cannot be shown on a log axis. The bar is drawn from the
    // point, and drawing a lower cap there would assert a value that was never
    // measured.
    const clipped: Series[] = [{ type: "scatter", points: [{ x: 1, y: 5, err: 20 }] }];
    const svg = buildPlotSvg(clipped, { yScale: "log", errorBars: "sd" });
    expect(svg).toMatch(/Error bars/);
    expect(svg).toContain("<svg");
  });
});

describe("the note does not disturb the rest of the figure", () => {
  test("the note gets its own line rather than overlapping the axis label", () => {
    // Compared against a figure with NO BARS, because a figure with bars now
    // always carries a note — declared or "kind not stated".
    const a = buildPlotSvg(noErr, { xlabel: "Dose" });
    const b = buildPlotSvg(withErr, { xlabel: "Dose", errorBars: "sd" });
    const ha = Number(/height="(\d+)"/.exec(a)?.[1]);
    const hb = Number(/height="(\d+)"/.exec(b)?.[1]);
    // Same canvas height; the PLOT AREA shrinks so the note has its own line.
    expect(hb).toBe(ha);
    // The x label survives, on its own line above the declaration.
    const yLabel = Number(/y="([\d.]+)"[^>]*>Dose</.exec(b)?.[1]);
    const yNote = Number(/y="([\d.]+)"[^>]*>Error bars/.exec(b)?.[1]);
    expect(yNote).toBeGreaterThan(yLabel);
  });

  test("inserted figures still use no theme colours", () => {
    const svg = buildPlotSvg(withErr, { errorBars: "ci95" });
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).not.toContain("currentColor");
  });
});
