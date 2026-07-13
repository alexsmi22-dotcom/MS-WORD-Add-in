import { parseSequence, peptideSmiles, buildPeptide, aminoAcidTable } from "../peptide";
import { Molecule } from "openchemlib";

function formula(smiles: string): string {
  return Molecule.fromSmiles(smiles).getMolecularFormula().formula;
}

// Each single residue built by itself is the free amino acid — its formula is a
// well-known fixed value, so this validates all 20 side chains at once.
const FREE_AMINO_ACID_FORMULA: Record<string, string> = {
  G: "C2H5NO2",
  A: "C3H7NO2",
  V: "C5H11NO2",
  L: "C6H13NO2",
  I: "C6H13NO2",
  P: "C5H9NO2",
  F: "C9H11NO2",
  W: "C11H12N2O2",
  M: "C5H11NO2S",
  S: "C3H7NO3",
  T: "C4H9NO3",
  C: "C3H7NO2S",
  Y: "C9H11NO3",
  N: "C4H8N2O3",
  Q: "C5H10N2O3",
  D: "C4H7NO4",
  E: "C5H9NO4",
  K: "C6H14N2O2",
  R: "C6H14N4O2",
  H: "C6H9N3O2",
};

describe("peptideSmiles — each residue is its free amino acid", () => {
  it.each(Object.entries(FREE_AMINO_ACID_FORMULA))("%s builds valid SMILES with formula %s", (code, expected) => {
    const smiles = peptideSmiles([code])!;
    expect(smiles).toBeTruthy();
    const mol = Molecule.fromSmiles(smiles);
    expect(mol.getAllAtoms()).toBeGreaterThan(0);
    expect(mol.getMolecularFormula().formula).toBe(expected);
  });
});

describe("peptide bonds and termini", () => {
  it("dipeptides lose one water per bond", () => {
    // Gly-Gly = C4H8N2O3 (2× glycine C2H5NO2 minus H2O).
    expect(formula(peptideSmiles(["G", "G"])!)).toBe("C4H8N2O3");
    // Ala-Ala = C6H12N2O3.
    expect(formula(peptideSmiles(["A", "A"])!)).toBe("C6H12N2O3");
  });

  it("a longer peptide parses to a valid molecule", () => {
    const smiles = peptideSmiles("ACDEFGHIKLMNPQRSTVWY".split(""))!;
    const mol = Molecule.fromSmiles(smiles);
    expect(mol.getAllAtoms()).toBeGreaterThan(50);
  });
});

describe("parseSequence", () => {
  it("reads a one-letter sequence (case-insensitive)", () => {
    expect(parseSequence("acg").codes).toEqual(["A", "C", "G"]);
    expect(parseSequence("A C G").codes).toEqual(["A", "C", "G"]);
  });
  it("reads three-letter codes with separators", () => {
    expect(parseSequence("Ala-Gly-Ser").codes).toEqual(["A", "G", "S"]);
    expect(parseSequence("Met Lys").codes).toEqual(["M", "K"]);
  });
  it("collects unrecognized tokens as invalid", () => {
    expect(parseSequence("AXG").invalid).toEqual(["X"]);
    expect(parseSequence("Ala-Xyz").invalid).toEqual(["Xyz"]);
  });
});

describe("buildPeptide", () => {
  it("returns sequence, SMILES, length, and invalids", () => {
    const r = buildPeptide("AG")!;
    expect(r.sequence).toBe("AG");
    expect(r.length).toBe(2);
    expect(r.invalid).toEqual([]);
    expect(formula(r.smiles)).toBe("C5H10N2O3");
  });
  it("returns null when nothing valid is present", () => {
    expect(buildPeptide("")).toBeNull();
    expect(buildPeptide("123")).toBeNull();
  });
  it("aminoAcidTable lists all 20", () => {
    expect(aminoAcidTable()).toHaveLength(20);
  });
});
