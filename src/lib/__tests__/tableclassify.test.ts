import { classifyTable } from "../tableclassify";

describe("classifyTable", () => {
  test("clean numeric table → column chart", () => {
    const r = classifyTable([
      ["Drug", "Responders"],
      ["A", "40"],
      ["B", "55"],
      ["C", "30"],
    ]);
    expect(r.kind).toBe("column");
  });

  test("a year category column → line chart", () => {
    const r = classifyTable([
      ["Year", "Revenue"],
      ["2021", "100"],
      ["2022", "150"],
      ["2023", "210"],
    ]);
    expect(r.kind).toBe("line");
  });

  test("single series, few positive categories → pie chart", () => {
    const r = classifyTable([
      ["Segment", "Share"],
      ["North", "40"],
      ["South", "35"],
      ["West", "25"],
    ]);
    expect(r.kind).toBe("pie");
  });

  test("step list → flowchart", () => {
    const r = classifyTable([
      ["Step", "Action"],
      ["S101", "Receive input"],
      ["S102", "Filter"],
      ["S103", "Store"],
    ]);
    expect(r.kind).toBe("flowchart");
  });

  test("short text hierarchy → block diagram", () => {
    const r = classifyTable([
      ["System 10", "Controller 20", "CPU 22"],
      ["System 10", "Controller 20", "Memory 24"],
      ["System 10", "Sensor 30", ""],
    ]);
    expect(r.kind).toBe("hierarchy");
  });

  test("wide all-text matrix → table figure (long prose isn't a diagram)", () => {
    const r = classifyTable([
      ["Drug", "Population", "Findings", "Evidence tier"],
      ["Semaglutide", "Obesity with established ASCVD", "Reduced 3-point MACE versus placebo in a randomized trial", "Randomized"],
      ["Tirzepatide", "Obesity-related HFpEF", "Reduced the composite of cardiovascular death and heart failure events", "Randomized"],
    ]);
    expect(r.kind).toBe("tablefigure");
  });

  test("grouped characteristics table (section bands) → table figure, not a chart", () => {
    const r = classifyTable([
      ["Section", "Category", "n", "Percent"],
      ["Most recent prior GLP-1", "", "", ""],
      ["", "No recent GLP-1", "6,283", "56.0%"],
      ["", "Wegovy injection", "2,006", "17.9%"],
      ["", "Zepbound", "1,803", "16.1%"],
    ]);
    expect(r.kind).toBe("tablefigure");
  });

  test("dense numeric table → table figure (too many rows to chart)", () => {
    const rows = [["Cell Type", "Expression"], ...Array.from({ length: 30 }, (_, i) => [`type ${i}`, String(i + 1)])];
    expect(classifyTable(rows).kind).toBe("tablefigure");
  });

  test("empty → table figure", () => {
    expect(classifyTable([]).kind).toBe("tablefigure");
  });

  test("every recommendation carries a reason", () => {
    expect(classifyTable([["A", "1"], ["B", "2"]]).reason.length).toBeGreaterThan(10);
  });
});
