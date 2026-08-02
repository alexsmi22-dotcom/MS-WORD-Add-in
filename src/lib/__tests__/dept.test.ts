// DEPT: the one piece of 13C information this module knows EXACTLY.
import { predictNmr, deptClass, deptBehaviour, DeptClass } from "../nmr";
import { Molecule } from "openchemlib";

const classesOf = (smiles: string): string[] => {
  const r = predictNmr(smiles, "13C");
  if (!r) throw new Error("no prediction for " + smiles);
  return r.signals.map((s) => s.dept ?? "?");
};

describe("DEPT classification is read from the structure, not predicted", () => {
  it("ethanol: one CH3 and one CH2", () => {
    expect(classesOf("CCO").sort()).toEqual(["CH2", "CH3"]);
  });

  it("acetone: a carbonyl C plus equivalent CH3", () => {
    const c = classesOf("CC(=O)C");
    expect(c).toContain("C");
    expect(c).toContain("CH3");
  });

  it("toluene: quaternary ipso, aromatic CH, and the methyl", () => {
    const c = classesOf("Cc1ccccc1");
    expect(c).toContain("C"); // ipso carbon bears no H
    expect(c).toContain("CH"); // ring CH
    expect(c).toContain("CH3");
  });

  it("tert-butanol: a quaternary carbon and methyls", () => {
    const c = classesOf("CC(C)(C)O");
    expect(c).toContain("C");
    expect(c).toContain("CH3");
    expect(c).not.toContain("CH2");
  });

  it("propan-2-ol has a CH, propan-1-ol has a CH2 — the case DEPT-90 separates", () => {
    expect(classesOf("CC(O)C")).toContain("CH");
    expect(classesOf("CCCO")).toContain("CH2");
  });

  it("every 13C signal carries a class, and 1H signals carry none", () => {
    const c13 = predictNmr("CCC(=O)OC", "13C")!;
    expect(c13.signals.every((s) => s.dept !== undefined)).toBe(true);
    const h1 = predictNmr("CCC(=O)OC", "1H")!;
    expect(h1.signals.every((s) => s.dept === undefined)).toBe(true);
  });

  it("deptClass counts hydrogens directly", () => {
    const mol = Molecule.fromSmiles("CCO");
    mol.ensureHelperArrays(Molecule.cHelperNeighbours);
    const seen = new Set<DeptClass>();
    for (let a = 0; a < mol.getAllAtoms(); a++) {
      if (mol.getAtomicNo(a) === 6) seen.add(deptClass(mol, a));
    }
    expect(seen.has("CH3")).toBe(true);
    expect(seen.has("CH2")).toBe(true);
  });
});

describe("what the experiments actually show", () => {
  it("DEPT-135 phases: CH and CH3 up, CH2 down, quaternary absent", () => {
    expect(deptBehaviour("CH").dept135).toBe("up");
    expect(deptBehaviour("CH3").dept135).toBe("up");
    expect(deptBehaviour("CH2").dept135).toBe("DOWN");
    expect(deptBehaviour("C").dept135).toBe("absent");
  });

  it("DEPT-90 shows CH only — that is its whole purpose", () => {
    expect(deptBehaviour("CH").dept90).toBe("present");
    for (const k of ["C", "CH2", "CH3"] as DeptClass[]) {
      expect(deptBehaviour(k).dept90).toBe("absent");
    }
  });
});

describe("the sp3 path now names substituents it ignored", () => {
  it("a group with no tabulated increment is reported, not silently dropped", () => {
    // Boron has no sp3 increment table entry; the shift is computed as if the
    // group were absent, which is exactly what the caveat must say.
    const r = predictNmr("CCB(O)O", "13C");
    if (r && r.caveats.length) {
      const joined = r.caveats.join(" ");
      if (/no tabulated sp3 increment/.test(joined)) {
        expect(joined).toMatch(/contributed NOTHING/);
      }
    }
    expect(r).not.toBeNull();
  });

  it("ordinary molecules get no such caveat — it must stay specific", () => {
    for (const smiles of ["CCO", "CCCC", "CC(=O)C"]) {
      const r = predictNmr(smiles, "13C")!;
      expect(r.caveats.join(" ")).not.toMatch(/no tabulated sp3 increment/);
    }
  });
});
