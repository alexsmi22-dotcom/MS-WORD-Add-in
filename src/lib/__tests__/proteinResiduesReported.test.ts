// Regression: `proteinProperties` silently dropped unknown residues (defect
// 0.26), and `peptide.ts` rejected Sec and Pyl while the rest of the product
// accepted them (Tier 1.10).
//
// `dna.ts` skipped any residue not in RESIDUE_MASS with no invalid/skipped field
// on the result — unlike `cleanDna`, `cleanResidues` and `parseSequence`, which
// all report what they drop. Measured: MKVLSPADKTNVKAAWXXXX (20 residues)
// returned {length: 16, mw: 1759.1, pI: 10.5}, byte-identical to the 16-residue
// sequence with the X's removed. `resolveCodon` emits X for every degenerate
// codon it cannot resolve, so a translated ORF hits this constantly.

import { proteinProperties, translate } from "../dna";
import { buildPeptide, parseSequence, peptideSmiles, aminoAcidTable } from "../peptide";

const WITH_X = "MKVLSPADKTNVKAAWXXXX";
const WITHOUT_X = "MKVLSPADKTNVKAAW";

describe("proteinProperties reports what it skipped — defect 0.26", () => {
  test("REPRODUCTION: the 20-residue input is no longer described as a 16-residue one", () => {
    const p = proteinProperties(WITH_X);
    expect(p.inputLength).toBe(20);
    expect(p.length).toBe(16); // residues that HAVE a mass, unchanged meaning
    expect(p.skippedCount).toBe(4);
    expect(p.skipped).toEqual(["X"]);
  });

  test("REPRODUCTION: it is no longer indistinguishable from the deleted-residue sequence", () => {
    const withX = proteinProperties(WITH_X);
    const withoutX = proteinProperties(WITHOUT_X);
    // The MASS is legitimately the same — an X has no mass to add. What must
    // differ is that one of them TELLS you four residues went uncounted.
    expect(withX.mw).toBeCloseTo(withoutX.mw, 6);
    expect(withX.inputLength).not.toBe(withoutX.inputLength);
    expect(withX.skippedCount).toBe(4);
    expect(withoutX.skippedCount).toBe(0);
    expect(withoutX.skipped).toEqual([]);
  });

  test("a translated ORF carrying X from a degenerate codon is reported", () => {
    // NNN cannot resolve to one amino acid, so resolveCodon emits X.
    const protein = translate("ATGNNNAAA");
    expect(protein).toBe("MXK");
    const p = proteinProperties(protein);
    expect(p.inputLength).toBe(3);
    expect(p.length).toBe(2);
    expect(p.skipped).toEqual(["X"]);
  });

  test("stop symbols are counted separately from skipped residues", () => {
    const p = proteinProperties("MG*KL");
    expect(p.stops).toBe(1);
    expect(p.inputLength).toBe(4); // "*" is not a residue
    expect(p.length).toBe(4);
    expect(p.skippedCount).toBe(0);
  });

  test("an all-unknown sequence still reports its input", () => {
    const p = proteinProperties("XXXX");
    expect(p.length).toBe(0);
    expect(p.inputLength).toBe(4);
    expect(p.skippedCount).toBe(4);
    expect(p.mw).toBe(0);
  });

  test("the pinned numbers for ordinary sequences are untouched", () => {
    expect(proteinProperties("G").mw).toBeCloseTo(75.07, 2);
    expect(proteinProperties("AAAA").mw).toBeCloseTo(302.33, 2); // Expasy ProtParam
    expect(proteinProperties("G*XG").length).toBe(2);
    expect(proteinProperties("IIII").gravy).toBeCloseTo(4.5, 6);
  });
});

describe("peptide.ts accepts Sec and Pyl — Tier 1.10", () => {
  test("REPRODUCTION: a selenoprotein peptide is no longer truncated at the U", () => {
    const built = buildPeptide("MGUKL");
    expect(built).not.toBeNull();
    expect(built!.sequence).toBe("MGUKL");
    expect(built!.length).toBe(5);
    expect(built!.invalid).toEqual([]);
  });

  test("the Sec SMILES is selenocysteine, not cysteine", () => {
    const smiles = peptideSmiles(["U"])!;
    expect(smiles).toContain("[SeH]");
    expect(smiles).not.toMatch(/CS\)/); // not the Cys side chain
  });

  test("Pyl is built too", () => {
    const built = buildPeptide("MOK");
    expect(built!.sequence).toBe("MOK");
    expect(built!.invalid).toEqual([]);
  });

  test("three-letter codes work for both", () => {
    expect(parseSequence("Met-Gly-Sec-Lys").codes).toEqual(["M", "G", "U", "K"]);
    expect(parseSequence("Met Pyl Lys").codes).toEqual(["M", "O", "K"]);
  });

  test("PINNED: a lone three-letter token wins over per-character reading", () => {
    // "SEC" is now one residue, not S-E-C — consistent with "ALA" and "CYS",
    // which have always behaved this way. Space or hyphenate for the tripeptide.
    expect(parseSequence("SEC").codes).toEqual(["U"]);
    expect(parseSequence("PYL").codes).toEqual(["O"]);
    expect(parseSequence("S E C").codes).toEqual(["S", "E", "C"]);
    expect(parseSequence("ALA").codes).toEqual(["A"]); // the pre-existing behaviour
  });

  test("they are flagged as non-standard in the reference table", () => {
    const table = aminoAcidTable();
    expect(table.length).toBe(22);
    expect(table.filter((a) => a.nonstandard).map((a) => a.one).sort()).toEqual(["O", "U"]);
    expect(table.filter((a) => !a.nonstandard).length).toBe(20);
  });

  test("genuinely invalid letters are still rejected", () => {
    const built = buildPeptide("MGZKL");
    expect(built!.invalid).toEqual(["Z"]);
    expect(built!.sequence).toBe("MGKL");
  });
});
