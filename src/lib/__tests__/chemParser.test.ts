import { parseChemical } from "../chemParser";
import { segmentsToHtml } from "../segments";

const html = (formula: string) => segmentsToHtml(parseChemical(formula));

describe("parseChemical", () => {
  it("subscripts counts after elements", () => {
    expect(html("H2O")).toBe("H<sub>2</sub>O");
    expect(html("H2SO4")).toBe("H<sub>2</sub>SO<sub>4</sub>");
  });

  it("subscripts counts after groups", () => {
    expect(html("Ca(OH)2")).toBe("Ca(OH)<sub>2</sub>");
  });

  it("treats a leading number as a coefficient (normal size)", () => {
    expect(html("2H2O")).toBe("2H<sub>2</sub>O");
  });

  it("renders explicit charges as superscripts", () => {
    expect(html("SO4^2-")).toBe("SO<sub>4</sub><sup>2-</sup>");
    expect(html("Fe^3+")).toBe("Fe<sup>3+</sup>");
  });

  it("renders trailing +/- as a superscript charge", () => {
    expect(html("Na+")).toBe("Na<sup>+</sup>");
    expect(html("Cl-")).toBe("Cl<sup>-</sup>");
  });

  it("treats a digit run before a sign as a charge, not a subscript count", () => {
    expect(html("Ca2+")).toBe("Ca<sup>2+</sup>");
    expect(html("Fe3+")).toBe("Fe<sup>3+</sup>");
    // Subscript count on the group, then the ion charge.
    expect(html("[Fe(CN)6]3-")).toBe("[Fe(CN)<sub>6</sub>]<sup>3-</sup>");
    // A count NOT followed by a sign stays a subscript.
    expect(html("H2O")).toBe("H<sub>2</sub>O");
  });

  it("keeps bond glyphs and lone pairs inline (normal size)", () => {
    expect(html("CH2=CH2")).toBe("CH<sub>2</sub>=CH<sub>2</sub>");
    expect(html(":O:")).toBe(":O:");
  });
});
