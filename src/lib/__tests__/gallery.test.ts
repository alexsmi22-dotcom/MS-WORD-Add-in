import { parseSubstituents } from "../gallery";

describe("parseSubstituents", () => {
  it("splits 'label = input' lines", () => {
    expect(parseSubstituents("R1a = c1ccccc1\nR1b = c1ccncc1")).toEqual([
      { label: "R1a", input: "c1ccccc1" },
      { label: "R1b", input: "c1ccncc1" },
    ]);
  });

  it("accepts a colon separator and trims", () => {
    expect(parseSubstituents("Ra:  phenyl ")).toEqual([{ label: "Ra", input: "phenyl" }]);
  });

  it("keeps the first '=' as the separator (SMILES with a double bond on the right)", () => {
    expect(parseSubstituents("R1 = CC(=O)O")).toEqual([{ label: "R1", input: "CC(=O)O" }]);
  });

  it("does NOT split a label-less SMILES that contains '='", () => {
    expect(parseSubstituents("CC(=O)O")).toEqual([{ label: "", input: "CC(=O)O" }]);
  });

  it("does NOT split a SMILES whose first atom precedes '=' (O=C=O)", () => {
    expect(parseSubstituents("O=C=O")).toEqual([{ label: "", input: "O=C=O" }]);
    expect(parseSubstituents("N=C=S")).toEqual([{ label: "", input: "N=C=S" }]);
  });

  it("treats a bare structure (no separator) as input with no label", () => {
    expect(parseSubstituents("c1ccccc1")).toEqual([{ label: "", input: "c1ccccc1" }]);
  });

  it("drops blank lines", () => {
    expect(parseSubstituents("\n\nR1 = C\n\n")).toEqual([{ label: "R1", input: "C" }]);
  });
});
