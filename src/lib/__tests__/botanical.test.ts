import { formatBotanicalNameHtml, formatTraitTableHtml } from "../botanical";

describe("formatBotanicalNameHtml", () => {
  it("italicizes genus and species, capitalizing the genus", () => {
    expect(formatBotanicalNameHtml("rosa rubiginosa")).toBe("<i>Rosa</i> <i>rubiginosa</i>");
  });

  it("keeps the author citation roman", () => {
    expect(formatBotanicalNameHtml("Rosa canina L.")).toBe("<i>Rosa</i> <i>canina</i> L.");
  });

  it("renders a rank connector roman with its epithet italic", () => {
    expect(formatBotanicalNameHtml("Quercus robur subsp. robur")).toBe(
      "<i>Quercus</i> <i>robur</i> subsp. <i>robur</i>",
    );
  });

  it("keeps a cultivar roman in single quotes (and normalizes quotes)", () => {
    expect(formatBotanicalNameHtml('Rosa "Peace"')).toBe("<i>Rosa</i> 'Peace'");
    expect(formatBotanicalNameHtml("Malus domestica 'Gala'")).toBe(
      "<i>Malus</i> <i>domestica</i> 'Gala'",
    );
  });

  it("handles the hybrid marker between epithets", () => {
    expect(formatBotanicalNameHtml("Magnolia x soulangeana")).toBe(
      "<i>Magnolia</i> × <i>soulangeana</i>",
    );
  });

  it("handles a leading genus-hybrid marker", () => {
    expect(formatBotanicalNameHtml("×Triticosecale")).toBe("× <i>Triticosecale</i>");
    expect(formatBotanicalNameHtml("× Triticosecale")).toBe("× <i>Triticosecale</i>");
  });

  it("keeps sp./spp. roman", () => {
    expect(formatBotanicalNameHtml("Rosa sp.")).toBe("<i>Rosa</i> sp.");
  });

  it("returns empty string for empty input", () => {
    expect(formatBotanicalNameHtml("   ")).toBe("");
  });

  it("does not crash on a lone hybrid marker", () => {
    expect(() => formatBotanicalNameHtml("×")).not.toThrow();
    expect(() => formatBotanicalNameHtml("x")).not.toThrow();
    expect(formatBotanicalNameHtml("×")).toBe("×");
  });
});

describe("formatTraitTableHtml", () => {
  it("builds a two-column table from Label: value lines", () => {
    const html = formatTraitTableHtml("Plant height: 1.2 m\nFlower color: RHS 46A\nHabit: upright");
    expect(html).toContain("<table");
    expect((html.match(/<tr>/g) || []).length).toBe(3);
    expect(html).toContain("Plant height");
    expect(html).toContain("RHS 46A");
  });

  it("tolerates lines without a colon", () => {
    const html = formatTraitTableHtml("Notes only");
    expect(html).toContain("Notes only");
  });

  it("escapes HTML and returns empty for blank input", () => {
    expect(formatTraitTableHtml("a < b: x & y")).toContain("a &lt; b");
    expect(formatTraitTableHtml("  \n ")).toBe("");
  });
});
