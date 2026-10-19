// An Engineering report's blocks and text, with the em-dash sentinel cleaned out (engReport.ts, moved out of
// taskpane.ts unchanged).
import { engReport, plainDashes } from "../engReport";

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

  it("an empty report is empty", () => {
    expect(engReport([])).toEqual({ blocks: [], text: "" });
  });
});
