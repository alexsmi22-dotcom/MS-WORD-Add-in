// Clean structure / compliance checking for the drawing canvas.
//
// complianceIssues() mirrors the rules of OCL's own validate() but reports
// every problem instead of throwing on the first, and downgrades a nonzero net
// charge to a note (validate() rejects a lone acetate ion outright — real
// chemistry the pane must not call non-compliant).
//
// cleanedCopy() is the "Clean structure" engine: fresh machine coordinates,
// identical chemistry.

import { Molecule } from "openchemlib";
import { cleanedCopy, complianceIssues } from "../builder";

/** A molecule with sane invented coordinates. */
function fromSmiles(smiles: string): Molecule {
  const mol = Molecule.fromSmiles(smiles);
  mol.inventCoordinates();
  return mol;
}

/** A pentavalent carbon: C bonded singly to five O atoms. */
function pentavalentCarbon(): Molecule {
  const mol = new Molecule(0, 0);
  const c = mol.addAtom(6);
  for (let i = 0; i < 5; i++) {
    const o = mol.addAtom(8);
    mol.addBond(c, o);
  }
  mol.inventCoordinates();
  return mol;
}

describe("complianceIssues — compliant structures stay silent", () => {
  it("reports nothing for ethanol", () => {
    expect(complianceIssues(fromSmiles("CCO"))).toEqual([]);
  });

  it("reports nothing for an empty molecule", () => {
    expect(complianceIssues(new Molecule(0, 0))).toEqual([]);
  });

  it("reports nothing for a balanced zwitterion (glycine)", () => {
    expect(complianceIssues(fromSmiles("[NH3+]CC(=O)[O-]"))).toEqual([]);
  });

  it("does not flag unbonded fragments laid out normally (C.C)", () => {
    expect(complianceIssues(fromSmiles("C.C"))).toEqual([]);
  });

  it("does not flag a Markush fragment with an R-group position", () => {
    const mol = fromSmiles("c1ccccc1C");
    mol.setFragment(true);
    expect(complianceIssues(mol)).toEqual([]);
  });

  it("deliberately does NOT surface OCL's stereo validation (unreliable verdicts)", () => {
    // The same racemic alanine passes or fails OCL's validate() stereo rules
    // depending purely on how the object was constructed — a molfile
    // round-trip of a molecule that itself validates cleanly throws
    // "Over- or under-specified stereo feature". A verdict that flips on
    // provenance must not be shown to the user as (non-)compliance.
    const viaSmiles = fromSmiles("CC(N)C(=O)O");
    const roundTripped = Molecule.fromMolfile(viaSmiles.toMolfile());
    expect(() => roundTripped.validate()).toThrow(); // OCL itself would reject it…
    expect(complianceIssues(roundTripped)).toEqual([]); // …we stay silent, by design
  });
});

describe("complianceIssues — valence", () => {
  it("flags a pentavalent carbon as non-compliant, naming the element and numbers", () => {
    const issues = complianceIssues(pentavalentCarbon());
    const valence = issues.filter((i) => i.kind === "valence");
    expect(valence).toHaveLength(1);
    expect(valence[0].severity).toBe("error");
    expect(valence[0].fixableByClean).toBe(false);
    expect(valence[0].message).toContain("A C atom");
    expect(valence[0].message).toContain("valence 5");
    expect(valence[0].message).toContain("maximum for C is 4");
    // Internal atom indices are meaningless to the canvas user (helper arrays
    // re-sort hydrogens) — messages must not cite them.
    expect(valence[0].message).not.toMatch(/atom \d/);
  });

  it("collapses identical valence findings into one message", () => {
    // Two pentavalent carbons in one drawing → one deduplicated report.
    const mol = new Molecule(0, 0);
    for (let frag = 0; frag < 2; frag++) {
      const c = mol.addAtom(6);
      for (let i = 0; i < 5; i++) mol.addBond(c, mol.addAtom(8));
    }
    mol.inventCoordinates();
    expect(complianceIssues(mol).filter((i) => i.kind === "valence")).toHaveLength(1);
  });

  it("cleaning does NOT silence a valence error (it is not a layout problem)", () => {
    const cleaned = cleanedCopy(pentavalentCarbon());
    expect(complianceIssues(cleaned).some((i) => i.kind === "valence")).toBe(true);
  });

  it("accepts charge-adjusted valence (ammonium N with 4 bonds)", () => {
    expect(complianceIssues(fromSmiles("[NH4+].[Cl-]"))).toEqual([]);
  });
});

describe("complianceIssues — overlapping atoms", () => {
  function overlapped(): Molecule {
    const mol = fromSmiles("CCO");
    // Park the O on top of the middle C — closer than a quarter bond length.
    mol.setAtomX(2, mol.getAtomX(1) + 0.01);
    mol.setAtomY(2, mol.getAtomY(1));
    return mol;
  }

  it("flags two atoms drawn on top of each other, and marks it clean-fixable", () => {
    const issues = complianceIssues(overlapped());
    const overlap = issues.filter((i) => i.kind === "overlap");
    expect(overlap).toHaveLength(1);
    expect(overlap[0].severity).toBe("error");
    expect(overlap[0].fixableByClean).toBe(true);
    expect(overlap[0].message).toMatch(/Two atoms \(C and O\)/);
  });

  it("summarizes multiple overlapping pairs as a count", () => {
    const mol = fromSmiles("CCCC");
    mol.setAtomX(1, mol.getAtomX(0));
    mol.setAtomY(1, mol.getAtomY(0));
    mol.setAtomX(3, mol.getAtomX(2));
    mol.setAtomY(3, mol.getAtomY(2));
    const overlap = complianceIssues(mol).filter((i) => i.kind === "overlap");
    expect(overlap).toHaveLength(1);
    expect(overlap[0].message).toContain("2 pairs");
  });

  it("Clean structure actually fixes an overlap", () => {
    const cleaned = cleanedCopy(overlapped());
    expect(complianceIssues(cleaned).filter((i) => i.kind === "overlap")).toEqual([]);
  });
});

describe("complianceIssues — net charge is a note, not non-compliance", () => {
  it("notes a lone acetate anion with a true minus sign", () => {
    const issues = complianceIssues(fromSmiles("CC(=O)[O-]"));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("charge");
    expect(issues[0].severity).toBe("note");
    expect(issues[0].fixableByClean).toBe(false);
    // Display is a contract: a real − (U+2212), never a hyphen.
    expect(issues[0].message).toContain("Net charge −1");
    expect(issues[0].message).not.toContain("-1");
  });

  it("notes a cation with an explicit plus", () => {
    const issues = complianceIssues(fromSmiles("[NH4+]"));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Net charge +1");
  });

  it("stays silent when counter-ions balance the charge", () => {
    expect(complianceIssues(fromSmiles("[Na+].[Cl-]"))).toEqual([]);
  });
});

describe("complianceIssues — does not disturb the caller's molecule", () => {
  it("leaves coordinates and helper state of the live editor molecule alone", () => {
    const mol = fromSmiles("CCO");
    const xs = [0, 1, 2].map((i) => mol.getAtomX(i));
    complianceIssues(mol);
    expect([0, 1, 2].map((i) => mol.getAtomX(i))).toEqual(xs);
  });
});

describe("cleanedCopy — chemistry is untouched, only layout changes", () => {
  it("preserves the canonical ID code (connectivity, charges, stereo)", () => {
    const mol = fromSmiles("C[C@H](N)C(=O)O");
    const before = mol.getIDCode();
    expect(cleanedCopy(mol).getIDCode()).toBe(before);
  });

  it("preserves stereochemistry in the isomeric SMILES", () => {
    const cleaned = cleanedCopy(fromSmiles("C[C@H](N)C(=O)O"));
    expect(cleaned.toIsomericSmiles()).toMatch(/@/);
  });

  it("preserves the Markush/fragment flag", () => {
    const mol = fromSmiles("c1ccccc1");
    mol.setFragment(true);
    expect(cleanedCopy(mol).isFragment()).toBe(true);
  });

  it("does not mutate the original molecule's coordinates", () => {
    const mol = fromSmiles("CCO");
    mol.setAtomX(2, mol.getAtomX(1) + 0.01); // deliberately messy
    const xBefore = mol.getAtomX(2);
    cleanedCopy(mol);
    expect(mol.getAtomX(2)).toBe(xBefore);
  });

  it("survives an empty molecule", () => {
    expect(cleanedCopy(new Molecule(0, 0)).getAllAtoms()).toBe(0);
  });
});
