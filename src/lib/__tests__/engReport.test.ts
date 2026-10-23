// An Engineering report's blocks and text, with the em-dash sentinel cleaned out (engReport.ts, moved out of
// taskpane.ts unchanged).
import { engCell, engReport, kvTable, plainDashes } from "../engReport";

describe("plainDashes", () => {
  it("swaps every em dash for a hyphen and touches nothing else", () => {
    expect(plainDashes("Welch — unequal variances — assumed")).toBe("Welch - unequal variances - assumed");
    // En dashes and minus signs are not the sentinel.
    expect(plainDashes("10–20 °C, −5")).toBe("10–20 °C, −5");
    expect(plainDashes("")).toBe("");
  });
});

describe("engReport", () => {
  it("turns prose into line blocks and marked formulas into math blocks, both cleaned", () => {
    const out = engReport(["Stress — within the limit", { math: "sigma = F/A", fallback: "σ = F/A — axial" }]);
    expect(out.blocks).toEqual([
      { kind: "line", text: "Stress - within the limit" },
      // The source syntax is left alone: only what a reader sees is cleaned.
      { kind: "math", math: "sigma = F/A", fallback: "σ = F/A - axial" },
    ]);
    expect(out.text).toBe("Stress - within the limit\nσ = F/A - axial");
    expect(out.text).not.toContain("—");
  });

  it("cleans a figure's caption and alt text, and passes other extra blocks through as they are", () => {
    const out = engReport(
      ["Result"],
      [
        { kind: "plot", svg: "<svg>—</svg>", caption: "Heading — track", alt: "Wind — triangle", w: 300, h: 200 },
        { kind: "line", text: "kept — as given" },
      ],
    );
    expect(out.blocks).toEqual([
      { kind: "line", text: "Result" },
      { kind: "plot", svg: "<svg>—</svg>", caption: "Heading - track", alt: "Wind - triangle", w: 300, h: 200 },
      { kind: "line", text: "kept — as given" },
    ]);
    // An extra LINE is not cleaned, so its dash still reaches the text (pinned as it is today).
    expect(out.text).toBe("Result\nHeading - track\nkept — as given");
  });

  it("places a table line where it stands among the lines, cells and label cleaned (Release E)", () => {
    const out = engReport(["Members", { table: [["Member", "Force (kN)"], ["AB", "−12 — tension"]], label: "Forces — all" }, "Note after"]);
    expect(out.blocks).toEqual([
      { kind: "line", text: "Members" },
      { kind: "table", label: "Forces - all", rows: [["Member", "Force (kN)"], ["AB", "−12 - tension"]] },
      { kind: "line", text: "Note after" },
    ]);
    expect(out.text).toBe("Members\nForces - all\nMember  Force (kN)\nAB      −12 - tension\nNote after");
    expect(engReport([{ table: [["a", "b"]] }]).blocks).toEqual([{ kind: "table", rows: [["a", "b"]] }]);
  });

  it("typesets table cells: true minus, ×10ⁿ for e-notation, names left alone", () => {
    expect(engCell("-12.5")).toBe("−12.5");
    expect(engCell("1.2e-5")).toBe("1.2×10⁻⁵");
    expect(engCell("-3.4e+06 N")).toBe("−3.4×10⁶ N");
    expect(engCell("A-B")).toBe("A-B");
    expect(engCell("1-2")).toBe("1-2");
    expect(engCell("member 2e3x")).toBe("member 2e3x");
    expect(engCell("Force (kN)")).toBe("Force (kN)");
    expect(engReport([{ table: [["x"], ["-1e-3"]] }]).blocks).toEqual([{ kind: "table", rows: [["x"], ["−1×10⁻³"]] }]);
  });

  it("kvTable lays a quantity/value/unit summary out as a table line", () => {
    expect(kvTable([["Flow", "0.012", "m³/s"]], "Result")).toEqual({ table: [["Quantity", "Value", "Unit"], ["Flow", "0.012", "m³/s"]], label: "Result" });
    expect(kvTable([["n", "3", ""]])).toEqual({ table: [["Quantity", "Value", "Unit"], ["n", "3", ""]] });
  });

  it("an empty report is empty", () => {
    expect(engReport([])).toEqual({ blocks: [], text: "" });
  });
});
