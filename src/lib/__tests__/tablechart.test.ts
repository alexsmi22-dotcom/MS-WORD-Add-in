import { parseNumberCell, parseTableData, buildChartPreviewSvg, ChartKind } from "../tablechart";

describe("parseNumberCell", () => {
  test("plain integers and decimals", () => {
    expect(parseNumberCell("42")).toBe(42);
    expect(parseNumberCell("3.14")).toBe(3.14);
    expect(parseNumberCell(".5")).toBe(0.5);
    expect(parseNumberCell("-7")).toBe(-7);
    expect(parseNumberCell("+7")).toBe(7);
  });

  test("thousands separators and currency", () => {
    expect(parseNumberCell("1,234")).toBe(1234);
    expect(parseNumberCell("$2,500.50")).toBe(2500.5);
    expect(parseNumberCell("€1,000")).toBe(1000);
    expect(parseNumberCell("£12.5")).toBe(12.5);
  });

  test("percentages keep their face value", () => {
    expect(parseNumberCell("45%")).toBe(45);
    expect(parseNumberCell("4.5 %")).toBe(4.5);
  });

  test("accountant-style parentheses mean negative", () => {
    expect(parseNumberCell("(1,200)")).toBe(-1200);
    expect(parseNumberCell("($300)")).toBe(-300);
  });

  test("scientific notation", () => {
    expect(parseNumberCell("1.2e3")).toBe(1200);
    expect(parseNumberCell("5E-2")).toBe(0.05);
  });

  test("unicode minus and unit suffixes", () => {
    expect(parseNumberCell("−3")).toBe(-3);
    expect(parseNumberCell("12 kg")).toBe(12);
    expect(parseNumberCell("9.81 m/s^2")).toBe(9.81);
  });

  test("non-numbers are null", () => {
    expect(parseNumberCell("")).toBeNull();
    expect(parseNumberCell("—")).toBeNull();
    expect(parseNumberCell("n/a")).toBeNull();
    expect(parseNumberCell("abc")).toBeNull();
    expect(parseNumberCell("kg 12")).toBeNull();
  });
});

describe("parseTableData", () => {
  const typical = [
    ["Year", "Sales", "Costs"],
    ["2022", "100", "80"],
    ["2023", "150", "90"],
    ["2024", "210", "95"],
  ];

  test("header row + label column", () => {
    const c = parseTableData(typical);
    expect(c.hasHeader).toBe(true);
    expect(c.categoryLabel).toBe("Year");
    expect(c.categories).toEqual(["2022", "2023", "2024"]);
    expect(c.series.map((s) => s.name)).toEqual(["Sales", "Costs"]);
    expect(c.series[0].values).toEqual([100, 150, 210]);
    expect(c.warnings).toEqual([]);
  });

  test("no header when the first row is numeric", () => {
    const c = parseTableData([
      ["1", "10", "20"],
      ["2", "30", "40"],
    ]);
    expect(c.hasHeader).toBe(false);
    expect(c.categories).toEqual(["1", "2"]);
    expect(c.series.map((s) => s.name)).toEqual(["Series 1", "Series 2"]);
  });

  test("single column of numbers", () => {
    const c = parseTableData([["10"], ["20"], ["30"]]);
    expect(c.series).toHaveLength(1);
    expect(c.series[0].values).toEqual([10, 20, 30]);
    expect(c.categories).toEqual(["1", "2", "3"]);
  });

  test("single column with a header", () => {
    const c = parseTableData([["Revenue"], ["10"], ["20"]]);
    expect(c.hasHeader).toBe(true);
    expect(c.series[0].name).toBe("Revenue");
    expect(c.series[0].values).toEqual([10, 20]);
  });

  test("single row reads as one series", () => {
    const c = parseTableData([["Sales", "10", "20", "30"]]);
    expect(c.series).toHaveLength(1);
    expect(c.series[0].name).toBe("Sales");
    expect(c.series[0].values).toEqual([10, 20, 30]);
    expect(c.categories).toEqual(["1", "2", "3"]);
  });

  test("empty rows and columns are dropped; ragged rows are padded", () => {
    const c = parseTableData([
      ["Year", "Sales", ""],
      ["", "", ""],
      ["2022", "100"],
      ["2023", "150", ""],
    ]);
    expect(c.categories).toEqual(["2022", "2023"]);
    expect(c.series).toHaveLength(1);
    expect(c.series[0].values).toEqual([100, 150]);
  });

  test("text-only column is skipped with a warning", () => {
    const c = parseTableData([
      ["Item", "Note", "Qty"],
      ["A", "good", "5"],
      ["B", "bad", "7"],
    ]);
    expect(c.series.map((s) => s.name)).toEqual(["Qty"]);
    expect(c.warnings.some((w) => w.includes("Note"))).toBe(true);
  });

  test("unreadable cells produce a warning and stay null", () => {
    const c = parseTableData([
      ["Year", "Sales"],
      ["2022", "100"],
      ["2023", "tbd"],
    ]);
    expect(c.series[0].values).toEqual([100, null]);
    expect(c.warnings.some((w) => w.includes("couldn't be read"))).toBe(true);
  });

  test("missing category labels fall back to row numbers", () => {
    const c = parseTableData([
      ["Year", "Sales"],
      ["", "100"],
      ["2023", "150"],
    ]);
    expect(c.categories).toEqual(["Row 1", "2023"]);
  });

  test("word control characters are stripped from cells", () => {
    const c = parseTableData([
      ["Year", "Sales\r\n"],
      ["2022", "100"],
    ]);
    expect(c.categoryLabel).toBe("Year");
    expect(c.series[0].values).toEqual([100]);
  });

  test("empty table throws", () => {
    expect(() => parseTableData([])).toThrow(/empty/i);
    expect(() => parseTableData([["", ""]])).toThrow(/empty/i);
  });

  test("all-text table throws", () => {
    expect(() =>
      parseTableData([
        ["Name", "Role"],
        ["Ada", "Engineer"],
      ])
    ).toThrow(/numeric/i);
  });
});

describe("buildChartPreviewSvg", () => {
  const chart = parseTableData([
    ["Year", "Sales", "Costs"],
    ["2022", "100", "80"],
    ["2023", "150", "90"],
    ["2024", "-30", "95"],
  ]);

  const kinds: ChartKind[] = ["column", "bar", "line", "area", "pie", "doughnut"];

  test.each(kinds)("%s renders valid-looking SVG", (kind) => {
    const svg = buildChartPreviewSvg(chart, kind, "My chart");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("My chart");
  });

  test("column chart draws one rect per numeric cell (plus frame and legend)", () => {
    const svg = buildChartPreviewSvg(chart, "column");
    const rects = svg.match(/<rect /g) || [];
    // background + frame + 6 bars + 2 legend swatches
    expect(rects.length).toBe(10);
  });

  test("line chart draws one polyline per series", () => {
    const svg = buildChartPreviewSvg(chart, "line");
    expect((svg.match(/<polyline /g) || []).length).toBe(2);
  });

  test("pie uses only positive values of the first series", () => {
    const svg = buildChartPreviewSvg(chart, "pie");
    // 2022 and 2023 are positive; -30 (2024) is excluded → 2 slices
    expect((svg.match(/<path /g) || []).length).toBe(2);
    expect(svg).toContain("first data column only");
  });

  test("patent style is pure black & white with hatching and a FIG. label", () => {
    const kinds: ChartKind[] = ["column", "bar", "pie", "doughnut", "area"];
    for (const kind of kinds) {
      const svg = buildChartPreviewSvg(chart, kind, "", { patent: true, figLabel: "FIG. 2" });
      expect(svg).toContain("<pattern");
      expect(svg).toContain("FIG. 2");
      for (const color of ["#1f77b4", "#d62728", "#2ca02c"]) {
        expect(svg).not.toContain(color);
      }
    }
  });

  test("patent line charts use dashes and marker shapes instead of color", () => {
    const svg = buildChartPreviewSvg(chart, "line", "", { patent: true });
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("<circle"); // series-1 markers
    expect(svg).not.toContain("#1f77b4");
    // Both polylines are black.
    expect((svg.match(/<polyline [^>]*stroke="#000"/g) || []).length).toBe(2);
  });

  test("FIG. label extends the canvas height", () => {
    const plain = buildChartPreviewSvg(chart, "column");
    const labeled = buildChartPreviewSvg(chart, "column", "", { figLabel: "FIG. 3" });
    expect(plain).toContain('height="260"');
    expect(labeled).toContain('height="286"');
    expect(labeled).toContain("FIG. 3");
  });

  test("labels are XML-escaped", () => {
    const c = parseTableData([
      ["Year", "P&L", "R&D"],
      ["2022", "5", "3"],
    ]);
    const svg = buildChartPreviewSvg(c, "column", `A "<b>" title`);
    expect(svg).toContain("P&amp;L"); // series names appear in the legend
    expect(svg).toContain("&quot;&lt;b&gt;&quot;");
    expect(svg).not.toContain("<b>");
  });
});
