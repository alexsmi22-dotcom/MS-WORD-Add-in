// lookupSmiles / nameForIdcode — the name→structure entry point.
//
// compounds.test.ts covers renderStructure and nameForStructure, but lookupSmiles
// had no direct tests despite being the front door for the whole chemistry stack:
// molgraph.ts (and through it nmr/ir/uvvis/fragment), massspec.ts and pka.ts all
// resolve their input through it. If it silently returned the wrong SMILES, every
// predicted spectrum for that compound would be confidently wrong.

import { lookupSmiles, nameForIdcode, nameForStructure } from "../structures";
import { Molecule } from "openchemlib";

/** The molecular formula OpenChemLib derives from a SMILES. */
const formulaOf = (smiles: string): string => Molecule.fromSmiles(smiles).getMolecularFormula().formula;

describe("lookupSmiles resolves names to the RIGHT structure", () => {
  // Ground truth a chemist would check — the formula each name must produce.
  const CASES: [string, string][] = [
    ["water", "H2O"],
    ["aspirin", "C9H8O4"],
    ["caffeine", "C8H10N4O2"],
    ["benzene", "C6H6"],
    ["ethanol", "C2H6O"],
    ["glucose", "C6H12O6"],
    ["acetic acid", "C2H4O2"],
    ["methane", "CH4"],
    ["ammonia", "H3N"],
    ["toluene", "C7H8"],
  ];

  test.each(CASES)("%s resolves to %s", (name, formula) => {
    const r = lookupSmiles(name);
    expect(r).not.toBeNull();
    expect(r!.source).toBe("name");
    expect(formulaOf(r!.smiles)).toBe(formula);
  });

  test("lookup is case-insensitive", () => {
    for (const v of ["Aspirin", "ASPIRIN", "AsPiRiN"]) {
      const r = lookupSmiles(v);
      expect(r).not.toBeNull();
      expect(formulaOf(r!.smiles)).toBe("C9H8O4");
    }
  });

  test("surrounding whitespace is tolerated", () => {
    expect(lookupSmiles("  caffeine  ")?.source).toBe("name");
  });
});

describe("lookupSmiles resolves formulas", () => {
  test("a known formula resolves and is reported as a formula match", () => {
    const r = lookupSmiles("C8H10N4O2");
    expect(r).not.toBeNull();
    expect(r!.source).toBe("formula");
    expect(formulaOf(r!.smiles)).toBe("C8H10N4O2");
  });

  test("whitespace inside a formula is ignored", () => {
    const a = lookupSmiles("C8H10N4O2");
    const b = lookupSmiles("C8 H10 N4 O2");
    expect(b).not.toBeNull();
    expect(b!.smiles).toBe(a!.smiles);
  });

  test("a name wins over a formula when both could match", () => {
    // Names are checked first; the source field must say which path was taken so
    // callers (and the pane) can be honest about how the input was interpreted.
    const r = lookupSmiles("water");
    expect(r!.source).toBe("name");
  });
});

describe("lookupSmiles fails cleanly rather than guessing", () => {
  test("unknown input returns null — never a near-miss compound", () => {
    for (const junk of ["", "   ", "not-a-compound", "zzzz", "!!!", "💥"]) {
      expect(lookupSmiles(junk)).toBeNull();
    }
  });

  test("a SMILES string is NOT resolved here (callers fall through to parsing it)", () => {
    // lookupSmiles only knows the dictionary. Its callers try the raw input as a
    // SMILES when it returns null, so a false positive here would shadow real
    // structures.
    expect(lookupSmiles("CC(=O)Oc1ccccc1C(=O)O")).toBeNull();
  });

  test("every dictionary hit produces a parseable structure", () => {
    // A dictionary entry that does not parse would throw deep inside a predictor.
    for (const [name] of [["water"], ["aspirin"], ["caffeine"], ["glucose"], ["violacein"]] as [string][]) {
      const r = lookupSmiles(name);
      if (!r) continue;
      expect(() => Molecule.fromSmiles(r.smiles)).not.toThrow();
      expect(Molecule.fromSmiles(r.smiles).getAllAtoms()).toBeGreaterThan(0);
    }
  });
});

describe("round trip: name → structure → name", () => {
  test("a looked-up structure names back to the same compound", () => {
    for (const name of ["aspirin", "caffeine", "benzene"]) {
      const r = lookupSmiles(name);
      expect(r).not.toBeNull();
      const back = nameForStructure(r!.smiles);
      expect(back).not.toBeNull();
      expect((back as string).toLowerCase()).toBe(name);
    }
  });

  test("nameForIdcode resolves a canonical id code back to its name", () => {
    const r = lookupSmiles("aspirin")!;
    const idcode = Molecule.fromSmiles(r.smiles).getIDCode();
    expect(nameForIdcode(idcode)?.toLowerCase()).toBe("aspirin");
  });

  test("nameForIdcode returns null for an unknown structure rather than guessing", () => {
    const idcode = Molecule.fromSmiles("CCCCCCCCCCCCCCCCCCCCCC").getIDCode();
    expect(nameForIdcode(idcode)).toBeNull();
  });
});
