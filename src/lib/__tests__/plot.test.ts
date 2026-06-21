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

  it("draws a legend for labeled series", () => {
    const svg = buildPlotSvg([
      { points: samplePlot("x", -2, 2, 10), type: "line", label: "y=x" },
      { points: samplePlot("x^2", -2, 2, 10), type: "line", label: "y=x^2" },
    ]);
    expect(svg).toContain("y=x");
    expect(svg).toContain("y=x^2");
  });
});
