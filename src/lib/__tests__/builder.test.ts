import { Molecule } from "openchemlib";
import { build, buildFromAtomBondList, resultFromMolecule, rgroupLabels } from "../builder";

describe("builder — concrete molecules", () => {
  it("builds CO2 with double bonds", () => {
    const r = build("atoms: C O O\nbonds: 1=2 1=3", "auto");
    expect(r.formula).toBe("CO2");
    expect(r.generic).toBe(false);
    expect(r.idcode).toBeTruthy();
  });

  it("builds ethanol and fills implicit hydrogens", () => {
    const r = build("atoms: C C O\nbonds: 1-2 2-3", "auto");
    expect(r.formula).toBe("C2H6O");
    expect(r.mw).toBeCloseTo(46.07, 1);
  });

  it("applies a charge", () => {
    const r = build("atoms: N+", "auto");
    expect(r.formula).toBe("H4N");
  });

  it("parses a molfile (round-trip via build)", () => {
    const r = build("atoms: C C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto");
    expect(r.formula).toBe("C6H6");
  });
});

describe("builder — generic / Markush", () => {
  it("marks an atom list as generic", () => {
    const r = build("atoms: [C,N] C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto");
    expect(r.generic).toBe(true);
    expect(r.formula).toBe("generic structure");
  });

  it("treats an undefined (~) bond as generic", () => {
    const r = build("atoms: C C\nbonds: 1~2", "auto");
    expect(r.generic).toBe(true);
  });

  it("expands the halogen shorthand X to a generic atom list", () => {
    const r = build("atoms: C X\nbonds: 1-2", "auto");
    expect(r.generic).toBe(true);
  });
});

describe("builder — query features (Markush genus constraints)", () => {
  it("treats an atom query feature as generic and still builds", () => {
    const r = build("atoms: C{ar,nosub} C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto");
    expect(r.generic).toBe(true);
    expect(r.idcode).toBeTruthy();
  });

  it("accepts ring-size constraints (e.g. r5 / r6)", () => {
    expect(() => build("atoms: C{r6} C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto")).not.toThrow();
    expect(build("atoms: C{r5} C C C C\nbonds: 1-2 2-3 3-4 4-5 5-1", "auto").generic).toBe(true);
  });

  it("accepts query features on a query atom list and on R-groups", () => {
    expect(() => build("atoms: [C,N]{ar} C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1", "auto")).not.toThrow();
    expect(() => build("atoms: R1{sub} C\nbonds: 1-2", "auto")).not.toThrow();
  });

  it("accepts a bond query feature (ring / chain / ar)", () => {
    const r = build("atoms: C C\nbonds: 1-2{ring}", "auto");
    expect(r.generic).toBe(true);
  });

  it("rejects an unknown query feature with a clear error", () => {
    expect(() => build("atoms: C{bogus} C\nbonds: 1-2", "auto")).toThrow(/query feature/i);
  });

  it("rejects a second/stray query block instead of silently dropping it", () => {
    expect(() => build("atoms: C{ar}{bogus} C\nbonds: 1-2", "auto")).toThrow();
  });

  it("accepts multiple features in one block", () => {
    expect(() => build("atoms: C{ar,nosub,r6} C\nbonds: 1-2", "auto")).not.toThrow();
  });

  it("does not treat a charge-only atom as a query feature", () => {
    expect(build("atoms: N+", "auto").generic).toBe(false);
  });
});

describe("builder — stereo & extended Markush", () => {
  it("accepts a wedge bond without becoming generic", () => {
    const r = build("atoms: C F Cl Br\nbonds: 1-2 1>3 1-4", "auto");
    expect(r.generic).toBe(false);
    expect(r.formula).toBe("CHBrClF");
  });

  it("accepts a hash bond", () => {
    expect(() => build("atoms: C F Cl Br\nbonds: 1-2 1<3 1-4", "auto")).not.toThrow();
  });

  it("treats R1 as an R-group (generic) and reports it", () => {
    const r = build("atoms: R1 C C O\nbonds: 1-2 2-3 3-4", "auto");
    expect(r.generic).toBe(true);
    expect(r.rgroups).toEqual(["R1"]);
  });

  it("reports multiple distinct R-groups sorted", () => {
    const r = build("atoms: R2 C R1 O\nbonds: 1-2 2-3 3-4", "auto");
    expect(r.rgroups).toEqual(["R1", "R2"]);
  });

  it("reports no R-groups for a concrete molecule", () => {
    expect(build("atoms: C C O\nbonds: 1-2 2-3", "auto").rgroups).toEqual([]);
  });

  it("treats A (any atom) and Q (heteroatom) as generic", () => {
    expect(build("atoms: A C\nbonds: 1-2", "auto").generic).toBe(true);
    expect(build("atoms: Q C\nbonds: 1-2", "auto").generic).toBe(true);
  });

  it("does not mistake R-prefixed elements (Ru, Rb) for an R-group", () => {
    expect(build("atoms: Ru", "auto").generic).toBe(false);
    expect(build("atoms: Rb", "auto").generic).toBe(false);
  });
});

describe("builder — errors", () => {
  it("rejects an unknown element", () => {
    expect(() => buildFromAtomBondList("atoms: C Zz\nbonds: 1-2")).toThrow(/Unknown element/);
  });
  it("rejects an out-of-range bond", () => {
    expect(() => buildFromAtomBondList("atoms: C O\nbonds: 1=9")).toThrow(/outside/);
  });
  it("rejects a malformed bond", () => {
    expect(() => buildFromAtomBondList("atoms: C O\nbonds: 1*2")).toThrow(/Could not parse bond/);
  });
});

describe("builder — resultFromMolecule (canvas-editor bridge)", () => {
  it("derives the same result as the typed path for the same molecule", () => {
    const typed = build("atoms: C C O\nbonds: 1-2 2-3", "auto");
    const mol = Molecule.fromSmiles("CCO");
    mol.inventCoordinates();
    const drawn = resultFromMolecule(mol);
    expect(drawn.formula).toBe(typed.formula);
    expect(drawn.idcode).toBe(typed.idcode);
    expect(drawn.mw).toBe(typed.mw);
    expect(drawn.svg).toContain("<svg");
  });

  it("does not mutate the editor's live molecule", () => {
    const mol = Molecule.fromSmiles("c1ccccc1");
    mol.inventCoordinates();
    const before = mol.getIDCode();
    resultFromMolecule(mol);
    expect(mol.getIDCode()).toBe(before);
    expect(mol.getAllAtoms()).toBe(6);
  });

  it("throws on an empty canvas", () => {
    expect(() => resultFromMolecule(new Molecule(8, 8))).toThrow(/Nothing drawn/);
  });

  it("reports a fragment-flagged molecule as generic", () => {
    const mol = Molecule.fromSmiles("CC");
    mol.setFragment(true);
    const r = resultFromMolecule(mol);
    expect(r.generic).toBe(true);
    expect(r.formula).toBe("generic structure");
  });

  it("round-trips a concrete drawn molecule through its molfile", () => {
    const mol = Molecule.fromSmiles("CC(=O)Oc1ccccc1C(=O)O"); // aspirin
    mol.inventCoordinates();
    const drawn = resultFromMolecule(mol);
    const reloaded = build(mol.toMolfile(), "auto");
    expect(reloaded.idcode).toBe(drawn.idcode);
    expect(reloaded.formula).toBe(drawn.formula);
  });
});

describe("builder — rgroupLabels", () => {
  it("finds R-groups set as custom labels (typed builds)", () => {
    const mol = Molecule.fromSmiles("CC");
    mol.setAtomCustomLabel(1, "R1");
    expect(rgroupLabels(mol)).toEqual(["R1"]);
  });

  it("finds R-groups drawn as R atoms (canvas editor, atomicNo 129–144)", () => {
    const mol = Molecule.fromSmiles("CC");
    // In OpenChemLib the editor's R1 and R2 atoms are real atomic numbers whose
    // labels are "R1"/"R2" (142 = R1, 143 = R2).
    const r1 = mol.addAtom(142);
    mol.addBond(0, r1);
    const r2 = mol.addAtom(143);
    mol.addBond(1, r2);
    expect(rgroupLabels(mol)).toEqual(["R1", "R2"]);
  });

  it("does not mistake Ru/Rb or plain atoms for R-groups", () => {
    const mol = Molecule.fromSmiles("CC");
    mol.addAtom(Molecule.getAtomicNoFromLabel("Ru"));
    mol.addAtom(Molecule.getAtomicNoFromLabel("Rb"));
    expect(rgroupLabels(mol)).toEqual([]);
  });

  it("feeds drawn R-groups into resultFromMolecule", () => {
    const mol = Molecule.fromSmiles("c1ccccc1");
    mol.inventCoordinates();
    const r1 = mol.addAtom(142);
    mol.addBond(0, r1);
    expect(resultFromMolecule(mol).rgroups).toEqual(["R1"]);
  });
});

describe("builder — idcode format (drawn-structure history fidelity)", () => {
  /** A drawn-style genus: benzene + R1 atom, fragment flag, one query feature. */
  function drawnGenus(): Molecule {
    const mol = Molecule.fromSmiles("c1ccccc1");
    mol.inventCoordinates();
    const r1 = mol.addAtom(142); // editor's R1 atom
    mol.addBond(0, r1);
    mol.setFragment(true);
    mol.setAtomQueryFeature(1, Molecule.cAtomQFAromatic, true);
    return mol;
  }

  it("round-trips fragment flag, query features and R-groups through `idcode:` (what a molfile drops)", () => {
    const mol = drawnGenus();
    const drawn = resultFromMolecule(mol);
    const enc = mol.getIDCodeAndCoordinates();
    const reloaded = build(`idcode: ${enc.idCode} ${enc.coordinates}`, "auto");
    expect(reloaded.generic).toBe(true);
    expect(reloaded.idcode).toBe(drawn.idcode);
    expect(reloaded.rgroups).toEqual(["R1"]);
    expect(reloaded.formula).toBe("generic structure");
  });

  it("documents WHY molfile is not the history format: it loses the fragment flag", () => {
    // A genus with NO R atom (R-groups are now re-detected even from a molfile;
    // the fragment flag and query features are what a molfile still drops).
    const mol = Molecule.fromSmiles("c1ccccc1");
    mol.inventCoordinates();
    mol.setFragment(true);
    mol.setAtomQueryFeature(1, Molecule.cAtomQFAromatic, true);
    expect(resultFromMolecule(mol).generic).toBe(true);
    expect(build(mol.toMolfile(), "auto").generic).toBe(false); // the defect idcode avoids
  });

  it("parses an idcode without coordinates by inventing a layout", () => {
    const mol = Molecule.fromSmiles("CCO");
    const r = build(`idcode: ${mol.getIDCode()}`, "auto");
    expect(r.formula).toBe("C2H6O");
    expect(r.svg).toContain("<svg");
  });

  it("honors the explicit idcode format and rejects junk", () => {
    const mol = Molecule.fromSmiles("CCO");
    expect(build(`idcode: ${mol.getIDCode()}`, "idcode").formula).toBe("C2H6O");
    expect(() => build("idcode:", "auto")).toThrow(/No ID code/);
    expect(() => build("idcode: !!!not-an-idcode!!!", "auto")).toThrow(/Could not read|no atoms/i);
  });

  it("does not auto-detect ordinary atom lists or molfiles as idcodes", () => {
    expect(build("atoms: C O O\nbonds: 1=2 1=3", "auto").formula).toBe("CO2");
  });
});

describe("builder — R-groups force generic on every path", () => {
  it("treats a drawn R-group as generic even without the fragment flag", () => {
    const mol = Molecule.fromSmiles("CC");
    mol.inventCoordinates();
    const r1 = mol.addAtom(142);
    mol.addBond(0, r1);
    expect(mol.isFragment()).toBe(false); // user never ticked the Markush box
    const r = resultFromMolecule(mol);
    expect(r.generic).toBe(true);
    expect(r.formula).toBe("generic structure"); // NOT a bogus "C2H5R1" with R at mass 0
    expect(r.mw).toBe(0);
  });

  it("agrees with the typed path for the same genus", () => {
    const typed = build("atoms: C C R1\nbonds: 1-2 2-3", "auto");
    const mol = Molecule.fromSmiles("CC");
    mol.inventCoordinates();
    const r1 = mol.addAtom(142);
    mol.addBond(1, r1);
    const drawn = resultFromMolecule(mol);
    expect(drawn.generic).toBe(typed.generic);
    expect(drawn.formula).toBe(typed.formula);
  });
});

describe("builder — idcode canonicality guard (no confident fictions)", () => {
  it("rejects junk strings OCL would silently 'decode' into fabricated molecules", () => {
    expect(() => build("idcode: hello", "auto")).toThrow(/valid ID code/i);
    expect(() => build("idcode: xyz", "auto")).toThrow(/valid ID code/i);
  });

  it("rejects a truncated real idcode instead of rendering the wrong molecule", () => {
    const full = Molecule.fromSmiles("CC(=O)Oc1ccccc1C(=O)O").getIDCode();
    expect(() => build(`idcode: ${full.slice(0, -4)}`, "auto")).toThrow(/valid ID code|Could not read|no atoms/i);
  });

  it("still accepts every machine-recorded code (canonical by construction)", () => {
    const mol = Molecule.fromSmiles("c1ccncc1");
    mol.inventCoordinates();
    mol.setFragment(true);
    const enc = mol.getIDCodeAndCoordinates();
    expect(build(`idcode: ${enc.idCode} ${enc.coordinates}`, "auto").generic).toBe(true);
  });
});

describe("builder — molfile path joins the R-group⇒generic invariant", () => {
  it("treats a pasted molfile containing an R atom as generic with a legend entry", () => {
    const mol = Molecule.fromSmiles("c1ccccc1");
    mol.inventCoordinates();
    const r1 = mol.addAtom(142);
    mol.addBond(0, r1);
    const r = build(mol.toMolfile(), "auto");
    expect(r.generic).toBe(true);
    expect(r.formula).toBe("generic structure");
    expect(r.rgroups).toEqual(["R1"]);
  });

  it("leaves concrete molfiles untouched", () => {
    const mol = Molecule.fromSmiles("CCO");
    mol.inventCoordinates();
    const r = build(mol.toMolfile(), "auto");
    expect(r.generic).toBe(false);
    expect(r.formula).toBe("C2H6O");
  });
});
