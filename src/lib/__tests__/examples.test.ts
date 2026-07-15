// Examples & syntax panel content.
//
// This test used to hand-write its OWN copy of the mode list and iterate that —
// so "has non-trivial help content for every mode" only ever checked the modes
// the test itself remembered. When "spectra" shipped in v1.54.0 it was added to
// the pane but not to the ExampleMode union or to this list, so the panel was
// silently EMPTY for that tool and every test still passed.
//
// The list now comes from modes.ts (the single source of truth), so a new tool
// fails here until it has help content — which is what this test always claimed
// to do.

import { MODE_EXAMPLES } from "../examples";
import { EXAMPLE_MODES, ALL_MODES } from "../modes";

describe("MODE_EXAMPLES", () => {
  it("covers every mode the pane can show — derived, not re-listed", () => {
    // The guard that matters: this iterates the real mode list, so a tool added
    // to the pane without help content fails right here.
    expect(EXAMPLE_MODES.length).toBe(ALL_MODES.length - 1); // all but "home"
    for (const mode of EXAMPLE_MODES) {
      const html = MODE_EXAMPLES[mode];
      expect(typeof html).toBe("string");
      expect(html.trim().length).toBeGreaterThan(30);
    }
  });

  it("has no entries beyond the real mode list", () => {
    expect(Object.keys(MODE_EXAMPLES).sort()).toEqual([...EXAMPLE_MODES].sort());
  });

  it("home has no entry (the panel is hidden there — the tool cards are the content)", () => {
    expect(Object.keys(MODE_EXAMPLES)).not.toContain("home");
  });

  it("references each mode's signature syntax", () => {
    expect(MODE_EXAMPLES.chemical).toContain("SMILES");
    expect(MODE_EXAMPLES.math).toContain("quadratic");
    expect(MODE_EXAMPLES.build).toContain("atoms:");
    expect(MODE_EXAMPLES.code).toContain("KeyGen");
    expect(MODE_EXAMPLES.sequence).toContain("ST.26");
    expect(MODE_EXAMPLES.botanical).toContain("subsp.");
    expect(MODE_EXAMPLES.numerals).toContain("(12)");
    expect(MODE_EXAMPLES.dna).toContain("ORF");
    expect(MODE_EXAMPLES.audit).toContain("Reference numerals");
    expect(MODE_EXAMPLES.reaction).toContain("&gt;&gt;");
    expect(MODE_EXAMPLES.units).toContain("convert");
    expect(MODE_EXAMPLES.refs).toContain("caption");
    expect(MODE_EXAMPLES.plot).toContain("Function");
    expect(MODE_EXAMPLES.ppt).toContain("PowerPoint");
    expect(MODE_EXAMPLES.citations).toContain("Bluebook");
    expect(MODE_EXAMPLES.finance).toContain("IRR");
    expect(MODE_EXAMPLES.assay).toContain("IC50");
    expect(MODE_EXAMPLES.massspec).toContain("monoisotopic");
    expect(MODE_EXAMPLES.peptide).toContain("One-letter");
    expect(MODE_EXAMPLES.stats).toContain("ANOVA");
    expect(MODE_EXAMPLES.analyze).toContain("Nelder");
    expect(MODE_EXAMPLES.spectra).toContain("NMR");
  });

  it("the Spectra panel carries its honesty caveat, like the pane does", () => {
    // The whole feature is predictions from additivity rules. If the help sold
    // them as measured spectra it would undo the caveats everywhere else.
    const s = MODE_EXAMPLES.spectra;
    expect(s).toMatch(/estimate/i);
    expect(s).toMatch(/not acquired spectra/i);
    expect(s).toMatch(/ranking, not an intensity/i);
  });
});
