import { evalExpr, samplePlot, parseData, buildPlotSvg, Series } from "../plot";

describe("evalExpr", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(evalExpr("2 + 3 * 4", 0)).toBe(14);
    expect(evalExpr("(2 + 3) * 4", 0)).toBe(20);
    expect(evalExpr("2^3^2", 0)).toBe(512); // right-associative
    expect(evalExpr("-x^2", 3)).toBe(-9); // unary minus looser than ^
    expect(evalExpr("-3^2", 0)).toBe(-9);
    expect(evalExpr("2^-2", 0)).toBe(0.25); // signed exponent
  });
  it("uses the variable x, constants, and functions", () => {
    expect(evalExpr("x^2", 3)).toBe(9);
    expect(evalExpr("sin(0)", 0)).toBe(0);
    expect(evalExpr("2*pi", 0)).toBeCloseTo(Math.PI * 2, 10);
    expect(evalExpr("-x + 1", 5)).toBe(-4);
  });
  it("throws on malformed input", () => {
    expect(() => evalExpr("2 +", 0)).toThrow();
    expect(() => evalExpr("frobnicate(2)", 0)).toThrow();
  });
  it("supports multi-argument functions", () => {
    expect(evalExpr("atan2(1, 1)", 0)).toBeCloseTo(Math.PI / 4, 10);
    expect(evalExpr("hypot(3, 4)", 0)).toBe(5);
    expect(evalExpr("min(3, 1, 2)", 0)).toBe(1);
    expect(evalExpr("max(3, 1, 2)", 0)).toBe(3);
    expect(evalExpr("mod(7, 3)", 0)).toBe(1);
    expect(evalExpr("pow(2, 10)", 0)).toBe(1024);
  });
  it("supports cbrt and factorial", () => {
    expect(evalExpr("cbrt(27)", 0)).toBeCloseTo(3, 10);
    expect(evalExpr("factorial(5)", 0)).toBe(120);
    expect(evalExpr("fact(0)", 0)).toBe(1);
  });
  it("validates function arity", () => {
    expect(() => evalExpr("atan2(1)", 0)).toThrow(); // needs 2
    expect(() => evalExpr("sin(1, 2)", 0)).toThrow(); // takes 1
  });
});

describe("samplePlot", () => {
  it("samples a function across the domain", () => {
    const pts = samplePlot("x^2", -2, 2, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toMatchObject({ x: -2, y: 4 });
    expect(pts[4]).toMatchObject({ x: 2, y: 4 });
  });
  it("drops non-finite samples", () => {
    const pts = samplePlot("1/x", -1, 1, 3); // x=0 → Infinity dropped
    expect(pts.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});

describe("parseData", () => {
  it("parses x y [err] rows and ignores comments/blanks", () => {
    const pts = parseData("# t v\n0 1\n1 2 0.1\n\n2, 4");
    expect(pts).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 2, err: 0.1 },
      { x: 2, y: 4 },
    ]);
  });
});

describe("buildPlotSvg", () => {
  const line: Series = { points: samplePlot("x^2", -3, 3, 50), type: "line" };
  const scatter: Series = { points: [{ x: 0, y: 1, err: 0.2 }, { x: 1, y: 2 }], type: "scatter" };

  it("renders a line plot with axes", () => {
    const svg = buildPlotSvg([line], { title: "Parabola", xlabel: "x", ylabel: "y" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).toContain("Parabola");
  });
  it("renders scatter points and error bars", () => {
    const svg = buildPlotSvg([scatter]);
    expect(svg).toContain("<circle");
    expect(svg).toContain("<line"); // error bar + ticks
  });
  it("handles empty input gracefully", () => {
    expect(buildPlotSvg([{ points: [], type: "line" }])).toContain("No data");
  });

  // REGRESSION (gap analysis 2026-08-05, defect 0.20). A caveat rendered beside
  // the SVG in the task pane does not exist for the reader of the DOCUMENT: the
  // insert path takes the SVG and nothing else. The log-axis drop warning — the
  // one dropForScales's contract says the caller MUST surface — was computed,
  // shown in a <div>, and left behind. These notes go INTO the picture.
  describe("notes are drawn into the figure", () => {
    const NOTE = "⚠ 3 points not plotted: a logarithmic x axis cannot show zero or negative values.";

    /** The footnote text, reassembled across the wrap. */
    const noteText = (svg: string): string =>
      [...svg.matchAll(/<text x="8" y="[\d.]+"[^>]*>([^<]*)</g)].map((m) => m[1]).join(" ");

    it("puts the note in the SVG, not beside it", () => {
      const svg = buildPlotSvg([line], { xlabel: "x", notes: [NOTE] });
      expect(noteText(svg)).toContain("logarithmic x axis cannot show zero");
      expect(noteText(svg)).toContain("3 points not plotted");
    });

    it("grows the CANVAS to fit them, because Word sizes from the SVG", () => {
      // A note drawn past the declared height is a note cropped out of the
      // inserted picture — the intrinsic-size rule.
      const plain = buildPlotSvg([line], { xlabel: "x" });
      const noted = buildPlotSvg([line], { xlabel: "x", notes: [NOTE] });
      const h = (s: string): number => Number(/height="([\d.]+)"/.exec(s)![1]);
      expect(h(noted)).toBeGreaterThan(h(plain));
      // And the viewBox follows the height, or the extra space is not shown.
      expect(noted).toContain(`viewBox="0 0 380 ${h(noted)}"`);
      // Every note line sits inside the canvas.
      const ys = [...noted.matchAll(/<text x="8" y="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(ys.length).toBeGreaterThan(0);
      for (const y of ys) expect(y).toBeLessThan(h(noted));
    });

    it("stacks BELOW the error-bar declaration rather than over it", () => {
      const svg = buildPlotSvg([{ points: [{ x: 0, y: 1, err: 0.2 }, { x: 1, y: 2, err: 0.3 }], type: "scatter" }], {
        xlabel: "Dose",
        errorBars: "sd",
        notes: ["A note."],
      });
      const yDecl = Number(/y="([\d.]+)"[^>]*>Error bars/.exec(svg)![1]);
      const yNote = Number(/<text x="8" y="([\d.]+)"/.exec(svg)![1]);
      expect(yNote).toBeGreaterThan(yDecl);
    });

    it("wraps a long note instead of running it off the canvas", () => {
      const long = "x ".repeat(120).trim();
      const svg = buildPlotSvg([line], { notes: [long] });
      const lines = [...svg.matchAll(/<text x="8" y="[\d.]+"/g)].length;
      expect(lines).toBeGreaterThan(1);
    });

    it("is bounded — an unbounded caller cannot demand an unbounded canvas", () => {
      const many = Array.from({ length: 400 }, (_, i) => `Row ${i + 1} could not be drawn.`);
      const svg = buildPlotSvg([line], { notes: many });
      const lines = [...svg.matchAll(/<text x="8" y="[\d.]+"/g)].length;
      expect(lines).toBeLessThanOrEqual(12);
      // The cut SAYS it was cut; a block that just stops is a lost caveat again.
      expect(svg).toMatch(/more lines not shown/);
    });

    it("says WHY there is nothing to plot when the notes are the whole story", () => {
      // A log axis that discarded every point renders "No data to plot"; the
      // reason is the only useful thing on that figure.
      const svg = buildPlotSvg([{ points: [], type: "line" }], { notes: [NOTE] });
      expect(svg).toContain("No data to plot");
      expect(noteText(svg)).toContain("3 points not plotted");
      expect(noteText(svg)).toContain("cannot show zero or negative values");
    });

    it("changes nothing when there are none", () => {
      const a = buildPlotSvg([line], { xlabel: "x" });
      expect(buildPlotSvg([line], { xlabel: "x", notes: [] })).toBe(a);
      expect(buildPlotSvg([line], { xlabel: "x", notes: ["  "] })).toBe(a);
    });

    it("escapes markup in a note", () => {
      const svg = buildPlotSvg([line], { notes: ["<b>&</b> dropped"] });
      expect(svg).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
      expect(svg).not.toContain("<b>");
    });
  });

  it("draws a legend for labeled series", () => {
    const svg = buildPlotSvg([
      { points: samplePlot("x", -2, 2, 10), type: "line", label: "y=x" },
      { points: samplePlot("x^2", -2, 2, 10), type: "line", label: "y=x^2" },
    ]);
    expect(svg).toContain("y=x");
    expect(svg).toContain("y=x^2");
  });
});
