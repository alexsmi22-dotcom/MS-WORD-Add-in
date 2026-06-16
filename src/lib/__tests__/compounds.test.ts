import { Molecule } from "openchemlib";
import { NAME_TO_SMILES, FORMULA_TO_SMILES } from "../compounds";
import { renderStructure } from "../structures";

const nameEntries = Object.entries(NAME_TO_SMILES);
const formulaEntries = Object.entries(FORMULA_TO_SMILES);

describe("compound dictionary", () => {
  it("has a substantial number of compounds", () => {
    expect(nameEntries.length).toBeGreaterThan(200);
  });

  it.each(nameEntries)("name %s -> valid SMILES", (_name, smiles) => {
    const mol = Molecule.fromSmiles(smiles);
    expect(mol.getAllAtoms()).toBeGreaterThan(0);
  });

  it.each(formulaEntries)("formula %s -> valid SMILES", (_formula, smiles) => {
    const mol = Molecule.fromSmiles(smiles);
    expect(mol.getAllAtoms()).toBeGreaterThan(0);
  });
});

describe("renderStructure provenance", () => {
  it("resolves a name and returns formula/idcode/mw", () => {
    const r = renderStructure("aspirin", 200, 160);
    expect(r).not.toBeNull();
    expect(r!.formula).toBe("C9H8O4");
    expect(r!.idcode).toBeTruthy();
    expect(r!.mw).toBeCloseTo(180.16, 1);
  });

  it("returns null for an unknown, unparseable input", () => {
    expect(renderStructure("not_a_compound_xyz", 200, 160)).toBeNull();
  });
});
