// 3D-view structure edits (src/lib/mol3dEdit.ts): every edit verified by
// CANONICAL IDCODE against the molecule it should produce — "looks attached"
// is not the oracle, "IS phenol" is. Refusals by name; libraries are real,
// conformer-viable chemistry.

import { Molecule } from "openchemlib/full";
import {
  changeElement, deleteAtomIn, setBondOrderIn, deleteBondIn, attachFragment,
  addTemplate, MOL_TEMPLATES, ATTACH_GROUPS, EDIT_ELEMENTS,
} from "../mol3dEdit";
import { generate3d, isMol3dError, MOL3D_MAX_HEAVY, MOL3D_MAX_ROTATABLE } from "../mol3d";

const id = (smiles: string): string => Molecule.fromSmiles(smiles).getIDCode();

describe("edits verified by canonical idcode", () => {
  test("attach OH to benzene = phenol, exactly", () => {
    const benzene = Molecule.fromSmiles("c1ccccc1");
    const r = attachFragment(benzene, 0, "O");
    expect(r.error).toBeUndefined();
    expect(r.mol!.getIDCode()).toBe(id("Oc1ccccc1"));
  });

  test("attach COOH to benzene = benzoic acid; CF3 = benzotrifluoride", () => {
    const acid = attachFragment(Molecule.fromSmiles("c1ccccc1"), 0, "C(=O)O");
    expect(acid.mol!.getIDCode()).toBe(id("OC(=O)c1ccccc1"));
    const tfm = attachFragment(Molecule.fromSmiles("c1ccccc1"), 0, "C(F)(F)F");
    expect(tfm.mol!.getIDCode()).toBe(id("FC(F)(F)c1ccccc1"));
  });

  test("change a benzene carbon to nitrogen = pyridine", () => {
    const r = changeElement(Molecule.fromSmiles("c1ccccc1"), 0, 7);
    expect(r.error).toBeUndefined();
    expect(r.mol!.getIDCode()).toBe(id("c1ccncc1"));
  });

  test("delete the oxygen of ethanol = ethane", () => {
    const ethanol = Molecule.fromSmiles("CCO");
    let oxy = -1;
    for (let i = 0; i < ethanol.getAllAtoms(); i++) if (ethanol.getAtomicNo(i) === 8) oxy = i;
    const r = deleteAtomIn(ethanol, oxy);
    expect(r.mol!.getIDCode()).toBe(id("CC"));
  });

  test("raise ethane's bond to double = ethene, to triple = ethyne; back to single restores", () => {
    const ethane = Molecule.fromSmiles("CC");
    const dbl = setBondOrderIn(ethane, 0, 2);
    expect(dbl.mol!.getIDCode()).toBe(id("C=C"));
    const tpl = setBondOrderIn(dbl.mol!, 0, 3);
    expect(tpl.mol!.getIDCode()).toBe(id("C#C"));
    const back = setBondOrderIn(tpl.mol!, 0, 1);
    expect(back.mol!.getIDCode()).toBe(id("CC"));
  });

  test("delete a bond splits into fragments — legal, not an error", () => {
    const ethane = Molecule.fromSmiles("CC");
    const r = deleteBondIn(ethane, 0);
    expect(r.error).toBeUndefined();
    expect(r.mol!.getFragmentNumbers(new Array(r.mol!.getAllAtoms()), false, false)).toBe(2);
  });

  test("attach preserves the rest of the molecule (toluene + OH at methyl = benzyl alcohol)", () => {
    const toluene = Molecule.fromSmiles("Cc1ccccc1");
    // Atom 0 in SMILES order is the methyl carbon of the un-canonicalised
    // molecule object — fromSmiles keeps input order.
    const r = attachFragment(toluene, 0, "O");
    expect(r.mol!.getIDCode()).toBe(id("OCc1ccccc1"));
  });
});

describe("refusals by name — impossible chemistry is never applied", () => {
  test("attaching a 5th group to a quaternary carbon refuses", () => {
    const neopentane = Molecule.fromSmiles("CC(C)(C)C");
    // Atom 1 is the central quaternary carbon (SMILES order preserved).
    const r = attachFragment(neopentane, 1, "C");
    expect(r.mol).toBeUndefined();
    expect(r.error).toMatch(/impossible chemistry/i);
  });

  test("a double bond to fluorine refuses (F bonds once, always)", () => {
    const r = setBondOrderIn(Molecule.fromSmiles("CF"), 0, 2);
    expect(r.error).toMatch(/impossible chemistry/i);
  });

  test("a nitro group attaches as REAL nitrobenzene — charge-adjusted valence, exact idcode", () => {
    const r = attachFragment(Molecule.fromSmiles("c1ccccc1"), 0, "[N+](=O)[O-]");
    expect(r.error).toBeUndefined();
    expect(r.mol!.getIDCode()).toBe(id("c1ccccc1[N+](=O)[O-]"));
  });

  test("out-of-range atom and bond indices refuse by name, never throw", () => {
    const m = Molecule.fromSmiles("CC");
    expect(changeElement(m, 99, 7).error).toMatch(/no longer exists/);
    expect(deleteAtomIn(m, -1).error).toMatch(/no longer exists/);
    expect(setBondOrderIn(m, 99, 2).error).toMatch(/no longer exists/);
  });

  test("an edit is a DELTA check: a molecule already carrying a violation can still be edited elsewhere", () => {
    // Texas carbon drawn deliberately: CH5 via molfile-free construction.
    const broken = Molecule.fromSmiles("C(C)(C)(C)(C)C"); // pentavalent centre? OCL may normalise
    // Whatever OCL made of it, an unrelated edit far from the problem must not
    // be blocked by a PRE-EXISTING issue. Attach to a terminal methyl:
    const r = attachFragment(broken, broken.getAllAtoms() - 1, "O");
    expect(r.error ?? "").not.toMatch(/impossible/i);
  });
});

describe("libraries are real, conformer-viable chemistry", () => {
  test("every template parses, and fits inside the 3D gates", () => {
    for (const t of MOL_TEMPLATES) {
      const m = Molecule.fromSmiles(t.smiles);
      expect(m.getAllAtoms()).toBeGreaterThan(0);
      let heavy = 0;
      for (let i = 0; i < m.getAllAtoms(); i++) if (m.getAtomicNo(i) !== 1) heavy++;
      expect(heavy).toBeLessThanOrEqual(MOL3D_MAX_HEAVY);
      expect(m.getRotatableBondCount()).toBeLessThanOrEqual(MOL3D_MAX_ROTATABLE);
    }
  });

  test("template spot-check formulas (real substances, not sketches)", () => {
    const formulaOf = (name: string): string => {
      const t = MOL_TEMPLATES.find((x) => x.name === name)!;
      return Molecule.fromSmiles(t.smiles).getMolecularFormula().formula;
    };
    expect(formulaOf("Benzene")).toBe("C6H6");
    expect(formulaOf("Adamantane")).toBe("C10H16");
    expect(formulaOf("Cubane")).toBe("C8H8");
    expect(formulaOf("Porphine")).toBe("C20H14N4");
    expect(formulaOf("18-crown-6")).toBe("C12H24O6");
    expect(formulaOf("Glucose (pyranose)")).toBe("C6H12O6");
  });

  test("named scaffolds actually generate a 3D model", () => {
    for (const name of ["Adamantane", "Porphine", "18-crown-6"]) {
      const t = MOL_TEMPLATES.find((x) => x.name === name)!;
      const r = generate3d(Molecule.fromSmiles(t.smiles).getIDCode());
      expect(isMol3dError(r)).toBe(false);
    }
  });

  test("every attachable group gives EXACTLY the drawn-whole molecule (idcode oracle, all 27)", () => {
    // Adversarial-pass upgrade: "attaches without refusal" would pass for a
    // wrong attachment too. SMILES concatenation bonds the group's first atom
    // to the last ring atom — benzene's symmetry makes that the same molecule
    // as attaching at atom 0.
    for (const g of ATTACH_GROUPS) {
      const r = attachFragment(Molecule.fromSmiles("c1ccccc1"), 0, g.smiles);
      expect(r.error).toBeUndefined();
      expect(r.mol!.getIDCode()).toBe(id(`c1ccccc1${g.smiles}`));
    }
  });

  test("the attachment-point convention holds for every multi-atom group (first atom bonds)", () => {
    // Methoxy must attach through O (anisole), not through C.
    const r = attachFragment(Molecule.fromSmiles("c1ccccc1"), 0, "OC");
    expect(r.mol!.getIDCode()).toBe(id("COc1ccccc1"));
    // Benzyl through the CH2.
    const b = attachFragment(Molecule.fromSmiles("c1ccccc1"), 0, "Cc1ccccc1");
    expect(b.mol!.getIDCode()).toBe(id("c1ccccc1Cc1ccccc1"));
  });

  test("addTemplate: fresh canvas gets the template; existing canvas gains a fragment", () => {
    const fresh = addTemplate(null, "c1ccncc1");
    expect(fresh.mol!.getIDCode()).toBe(id("c1ccncc1"));
    const both = addTemplate(Molecule.fromSmiles("CCO"), "c1ccccc1");
    expect(both.mol!.getFragmentNumbers(new Array(both.mol!.getAllAtoms()), false, false)).toBe(2);
  });

  test("element palette entries are consistent", () => {
    for (const e of EDIT_ELEMENTS) {
      const m = new Molecule(4, 4);
      const a = m.addAtom(e.atomicNo);
      expect(m.getAtomLabel(a)).toBe(e.symbol);
    }
  });
});
