// ST.26's molecule type guessed from the residues (sequence.ts, moved out of taskpane.ts unchanged).
import { guessMolType } from "../sequence";

describe("guessMolType", () => {
  it("DNA by default, RNA for a U with no T, protein for letters outside the nucleotide alphabet", () => {
    expect(guessMolType("ATGCGTAA")).toBe("DNA");
    expect(guessMolType("AUGGCUUAA")).toBe("RNA");
    expect(guessMolType("MKVLLEQ")).toBe("AA");
  });

  it("reads past case, spacing and numbering, as a pasted GenBank block has", () => {
    expect(guessMolType("1 augg cuua a")).toBe("RNA");
    expect(guessMolType("  atgc\n  nnry  ")).toBe("DNA");
  });

  it("a U alongside a T is DNA, and IUPAC ambiguity codes stay nucleotide", () => {
    expect(guessMolType("ATGU")).toBe("DNA");
    expect(guessMolType("ACGTNRYKMSWBDHV")).toBe("DNA");
  });

  it("the ambiguous cases read as DNA, visibly: empty input and a peptide spelt in GATC letters", () => {
    expect(guessMolType("")).toBe("DNA");
    expect(guessMolType("123 --")).toBe("DNA");
    expect(guessMolType("CAT")).toBe("DNA");
  });
});
