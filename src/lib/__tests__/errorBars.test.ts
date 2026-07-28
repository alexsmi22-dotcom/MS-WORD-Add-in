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

  test("no declaration means no claim on the figure", () => {
    const svg = buildPlotSvg(withErr, { xlabel: "Dose" });
    expect(svg).not.toMatch(/Error bars/);
  });

  test("a declaration with no error data draws no note", () => {
    // Otherwise a figure with no bars would still assert what its absent bars mean.
    const svg = buildPlotSvg(noErr, { errorBars: "sem" });
    expect(svg).not.toMatch(/Error bars/);
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
  test("height grows to make room rather than overlapping the axis label", () => {
    const a = buildPlotSvg(withErr, { xlabel: "Dose" });
    const b = buildPlotSvg(withErr, { xlabel: "Dose", errorBars: "sd" });
    const ha = Number(/height="(\d+)"/.exec(a)?.[1]);
    const hb = Number(/height="(\d+)"/.exec(b)?.[1]);
    // Same canvas height; the PLOT AREA shrinks so the note has its own line.
    expect(hb).toBe(ha);
    expect(b.length).toBeGreaterThan(a.length);
  });

  test("inserted figures still use no theme colours", () => {
    const svg = buildPlotSvg(withErr, { errorBars: "ci95" });
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).not.toContain("currentColor");
  });
});
