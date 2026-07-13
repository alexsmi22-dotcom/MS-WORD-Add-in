import { MODE_EXAMPLES, ExampleMode } from "../examples";

const MODES: ExampleMode[] = [
  "chemical",
  "math",
  "build",
  "code",
  "sequence",
  "botanical",
  "numerals",
  "dna",
  "audit",
  "reaction",
  "units",
  "refs",
  "plot",
  "ppt",
  "citations",
  "finance",
  "assay",
  "massspec",
  "peptide",
];

describe("MODE_EXAMPLES", () => {
  it("has non-trivial help content for every mode", () => {
    for (const mode of MODES) {
      const html = MODE_EXAMPLES[mode];
      expect(typeof html).toBe("string");
      expect(html.trim().length).toBeGreaterThan(30);
    }
  });

  it("has no modes beyond the known set", () => {
    expect(Object.keys(MODE_EXAMPLES).sort()).toEqual([...MODES].sort());
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
  });
});
