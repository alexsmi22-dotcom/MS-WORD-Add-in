// A result's plain-text form, derived from its blocks (analyzeBlocks.ts, moved out of taskpane.ts unchanged).
import { analyzeBlocksToText, AnalyzeBlock } from "../analyzeBlocks";
import { formatMatrix } from "../linalg";

describe("analyzeBlocksToText", () => {
  it("writes a line as itself, a formula as its fallback and a figure as its caption", () => {
    const blocks: AnalyzeBlock[] = [
      { kind: "line", text: "Determinant = 2" },
      { kind: "math", math: "x = (-b +- sqrt(b^2 - 4a c))/(2a)", fallback: "x = (-b ± √(b² - 4ac))/(2a)" },
      { kind: "plot", svg: "<svg/>", caption: "Residuals against fitted values", alt: "residual plot", w: 300, h: 190 },
    ];
    expect(analyzeBlocksToText(blocks)).toBe("Determinant = 2\nx = (-b ± √(b² - 4ac))/(2a)\nResiduals against fitted values");
  });

  it("writes a matrix through formatMatrix, under its label when it has one", () => {
    const m = [
      [1, 2],
      [3, 4],
    ];
    expect(analyzeBlocksToText([{ kind: "matrix", label: "A⁻¹ =", m }])).toBe(`A⁻¹ =\n${formatMatrix(m)}`);
    expect(analyzeBlocksToText([{ kind: "matrix", m }])).toBe(formatMatrix(m));
    // An empty label is no label: no blank line above the numbers.
    expect(analyzeBlocksToText([{ kind: "matrix", label: "", m }])).toBe(formatMatrix(m));
  });

  it("is empty for no blocks, and keeps empty lines as empty lines", () => {
    expect(analyzeBlocksToText([])).toBe("");
    expect(analyzeBlocksToText([{ kind: "line", text: "" }, { kind: "line", text: "b" }])).toBe("\nb");
  });
});
