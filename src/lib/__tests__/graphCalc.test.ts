// The equation canvas's graphing calculator: sampling honesty.

import { graphSeries } from "../graphCalc";
import { buildPlotSvg } from "../plot";

const WIN = { xMin: -10, xMax: 10 };

describe("graphing-calculator entries", () => {
  test("a bare expression plots one curve", () => {
    const g = graphSeries("x^2 - 3", WIN);
    expect(g.series.length).toBeGreaterThanOrEqual(1);
    expect(g.variable).toBe("x");
    expect(g.notes).toEqual([]);
  });

  test("y = x^2 is a labelled single curve, not a two-sided equation", () => {
    const g = graphSeries("y = x^2", WIN);
    expect(g.series).toHaveLength(1);
    expect(g.series[0].label).toContain("y = x^2");
  });

  test("an equation plots BOTH sides — the crossings are the solutions", () => {
    const g = graphSeries("x^2 = 2x + 1", WIN);
    const labelled = g.series.filter((s) => s.label);
    expect(labelled.map((s) => s.label)).toEqual(["x^2", "2x + 1"]);
  });

  test("multiple lines overlay like a graphing calculator", () => {
    const g = graphSeries("x^2\nsin(x)\nx/2 + 1", WIN);
    expect(new Set(g.series.map((s) => s.color)).size).toBe(3);
  });

  test("pasted math graphs too (𝑥², θ)", () => {
    expect(graphSeries("\u{1D465}^2", WIN).series.length).toBeGreaterThan(0);
    const g = graphSeries("θ^2 - 1", WIN);
    expect(g.variable).toBe("theta");
    expect(g.series.length).toBeGreaterThan(0);
  });
});

describe("poles and gaps stay gaps", () => {
  test("1/x splits at the pole instead of drawing a wall through it", () => {
    const g = graphSeries("1/x", WIN);
    // Two branches → at least two segments; no sample bridges x = 0.
    expect(g.series.length).toBeGreaterThanOrEqual(2);
    for (const s of g.series) {
      const signs = new Set(s.points.map((p) => Math.sign(p.x)));
      expect(signs.size).toBe(1); // each segment stays on one side of the pole
    }
  });

  test("√x over a window crossing zero graphs only where it exists", () => {
    const g = graphSeries("sqrt(x)", WIN);
    for (const s of g.series) for (const p of s.points) expect(p.x).toBeGreaterThanOrEqual(0);
  });

  test("a function with no finite values says so", () => {
    const g = graphSeries("sqrt(-1 - x^2)", WIN);
    expect(g.series).toHaveLength(0);
    expect(g.notes.some((n) => n.includes("no finite values"))).toBe(true);
  });
});

describe("honest refusals", () => {
  test("two different symbols cannot share one axis", () => {
    const g = graphSeries("a + b", WIN);
    expect(g.series).toHaveLength(0);
    expect(g.notes.some((n) => n.includes("ONE variable"))).toBe(true);
  });

  test("a bad line is reported per line; good lines still graph", () => {
    const g = graphSeries("x^2\n)))broken(((", WIN);
    expect(g.series.length).toBeGreaterThan(0);
    expect(g.notes.some((n) => n.startsWith("Line 2"))).toBe(true);
  });

  test("line cap is disclosed, never silent", () => {
    const many = Array.from({ length: 12 }, (_, i) => `x + ${i}`).join("\n");
    const g = graphSeries(many, WIN);
    expect(g.notes.some((n) => n.includes("first 8"))).toBe(true);
  });

  test("a broken window is refused with instructions", () => {
    expect(graphSeries("x", { xMin: 5, xMax: 5 }).notes[0]).toContain("window");
    expect(graphSeries("x", { xMin: NaN, xMax: 3 }).notes[0]).toContain("window");
  });
});

describe("the samples feed the shared plotter cleanly", () => {
  test("buildPlotSvg renders every scenario without NaN in the markup", () => {
    for (const input of ["x^2 - 3", "1/x", "x^2 = 2x + 1", "sin(x)\ncos(x)\ntan(x)"]) {
      const g = graphSeries(input, WIN);
      const svg = buildPlotSvg(g.series, { width: 640, height: 360, xlabel: g.variable ?? "x" });
      expect(svg).toContain("<svg");
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
  });
});
