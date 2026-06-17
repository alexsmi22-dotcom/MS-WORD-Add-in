import { expandDefinition, buildLegendText, buildLegendTableHtml, LegendEntry } from "../markush";

describe("expandDefinition — carbon-range shorthands", () => {
  it("expands the dash-range form C1-6 alkyl", () => {
    expect(expandDefinition("C1-6 alkyl")).toBe("C₁–C₆ alkyl");
  });

  it("expands the explicit Cx-Cy form", () => {
    expect(expandDefinition("C1-C6 alkyl")).toBe("C₁–C₆ alkyl");
  });

  it("tolerates surrounding spaces", () => {
    expect(expandDefinition("C 1 - C 10 alkenyl")).toBe("C₁–C₁₀ alkenyl");
  });

  it("expands a single count before a carbon-group word", () => {
    expect(expandDefinition("C6 alkyl")).toBe("C₆ alkyl");
    expect(expandDefinition("C3 cycloalkyl")).toBe("C₃ cycloalkyl");
  });

  it("handles multiple ranges in one definition", () => {
    expect(expandDefinition("C1-C4 alkyl or C5-C10 aryl")).toBe("C₁–C₄ alkyl or C₅–C₁₀ aryl");
  });

  it("leaves ordinary chemical formulas untouched", () => {
    expect(expandDefinition("C2H5")).toBe("C2H5");
    expect(expandDefinition("CO2H")).toBe("CO2H");
  });

  it("leaves plain words untouched", () => {
    expect(expandDefinition("halogen")).toBe("halogen");
    expect(expandDefinition("H")).toBe("H");
  });

  it("is idempotent", () => {
    const once = expandDefinition("C1-6 alkyl");
    expect(expandDefinition(once)).toBe(once);
  });
});

describe("buildLegendText", () => {
  const entries: LegendEntry[] = [
    { label: "R1", definition: "H" },
    { label: "R2", definition: "C1-6 alkyl" },
  ];

  it("joins defined groups into a where-line with shorthands expanded", () => {
    expect(buildLegendText(entries)).toBe("where R1 = H; R2 = C₁–C₆ alkyl");
  });

  it("skips blank definitions", () => {
    expect(buildLegendText([{ label: "R1", definition: "  " }, { label: "R2", definition: "halogen" }])).toBe(
      "where R2 = halogen",
    );
  });

  it("returns empty string when nothing is defined", () => {
    expect(buildLegendText([{ label: "R1", definition: "" }])).toBe("");
  });
});

describe("buildLegendTableHtml", () => {
  it("renders a two-column table with expanded definitions", () => {
    const html = buildLegendTableHtml([{ label: "R1", definition: "C1-C6 alkyl" }]);
    expect(html).toContain("<table");
    expect(html).toContain("R-group");
    expect(html).toContain("Definition");
    expect(html).toContain("<td style=\"border:1px solid #000;padding:2px 8px;\">R1</td>");
    expect(html).toContain("C₁–C₆ alkyl");
  });

  it("escapes HTML-special characters in definitions", () => {
    const html = buildLegendTableHtml([{ label: "R1", definition: "a < b & c" }]);
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).not.toContain("a < b & c");
  });

  it("returns empty string when nothing is defined", () => {
    expect(buildLegendTableHtml([{ label: "R1", definition: "" }])).toBe("");
  });
});
