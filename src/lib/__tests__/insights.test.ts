import { parseTable, summarizeColumn, countOutliers, correlate, analyzeData } from "../insights";

describe("parseTable", () => {
  it("detects a header row and comma delimiter", () => {
    const t = parseTable("x,y\n1,2\n3,4\n5,6");
    expect(t.headers).toEqual(["x", "y"]);
    expect(t.rowCount).toBe(3);
    expect(t.columns[0]).toEqual(["1", "3", "5"]);
  });
  it("synthesizes headers when the first row is numeric", () => {
    const t = parseTable("1 2\n3 4");
    expect(t.headers).toEqual(["C1", "C2"]);
    expect(t.rowCount).toBe(2);
  });
  it("pads ragged rows", () => {
    const t = parseTable("a,b\n1,2\n3");
    expect(t.columns[1]).toEqual(["2", ""]);
  });
});

describe("summarizeColumn", () => {
  it("summarizes a numeric column", () => {
    const c = summarizeColumn("v", ["2", "4", "4", "4", "5", "5", "7", "9"]);
    expect(c.type).toBe("numeric");
    expect(c.n).toBe(8);
    expect(c.mean).toBeCloseTo(5, 6);
    expect(c.median).toBe(4.5);
    expect(c.min).toBe(2);
    expect(c.max).toBe(9);
  });
  it("counts missing cells", () => {
    const c = summarizeColumn("v", ["1", "", "3"]);
    expect(c.missing).toBe(1);
    expect(c.n).toBe(2);
  });
  it("classifies a text column as categorical with distinct count", () => {
    const c = summarizeColumn("g", ["red", "blue", "red", "green"]);
    expect(c.type).toBe("categorical");
    expect(c.distinct).toBe(3);
  });
});

describe("countOutliers", () => {
  it("flags a clear high outlier via Tukey fences", () => {
    expect(countOutliers([10, 11, 12, 13, 14, 100])).toBe(1);
  });
  it("returns 0 for tight data", () => {
    expect(countOutliers([5, 5, 6, 5, 6, 5])).toBe(0);
  });
});

describe("correlate", () => {
  it("finds a perfect positive linear correlation", () => {
    const c = correlate("x", "y", [1, 2, 3, 4], [2, 4, 6, 8])!;
    expect(c.r).toBeCloseTo(1, 8);
    expect(c.rho).toBeCloseTo(1, 8);
    expect(c.p).toBeLessThan(0.05);
  });
  it("finds a perfect negative correlation", () => {
    const c = correlate("x", "y", [1, 2, 3, 4], [8, 6, 4, 2])!;
    expect(c.r).toBeCloseTo(-1, 8);
  });
  it("returns null with too few points", () => {
    expect(correlate("x", "y", [1, 2], [3, 4])).toBeNull();
  });
});

describe("analyzeData", () => {
  it("produces a full report with a significant correlation and trend", () => {
    // y ≈ 2x (perfectly correlated and increasing over rows)
    const report = analyzeData("x,y\n1,2\n2,4\n3,6\n4,8\n5,10")!;
    expect(report).not.toBeNull();
    expect(report.columns).toHaveLength(2);
    expect(report.correlations.length).toBeGreaterThan(0);
    const top = report.correlations[0];
    expect(Math.abs(top.r)).toBeCloseTo(1, 6);
    expect(top.p).toBeLessThan(0.05);
    // both columns trend upward over row order
    expect(report.trends.some((t) => t.direction === "increasing")).toBe(true);
    expect(report.insights.length).toBeGreaterThan(1);
    expect(report.text).toContain("Insights:");
  });
  it("reports no significant correlation for unrelated data", () => {
    const report = analyzeData("a,b\n1,5\n2,3\n3,9\n4,1\n5,7\n6,2")!;
    const sig = report.correlations.filter((c) => c.p < 0.05);
    expect(sig.length).toBe(0);
  });
  it("returns null for empty input", () => {
    expect(analyzeData("")).toBeNull();
  });
  it("surfaces a missing-data insight", () => {
    const report = analyzeData("x,y\n1,2\n2,\n3,6\n4,8")!;
    expect(report.insights.some((i) => i.toLowerCase().includes("missing"))).toBe(true);
  });
});
