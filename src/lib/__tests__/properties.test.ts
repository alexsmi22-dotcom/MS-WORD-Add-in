import { computeProperties } from "../properties";

describe("computeProperties", () => {
  it("computes accurate properties for aspirin (by name)", () => {
    const p = computeProperties("aspirin");
    expect(p).not.toBeNull();
    expect(p!.formula).toBe("C9H8O4");
    expect(p!.mw).toBeCloseTo(180.16, 2);
    expect(p!.heavyAtoms).toBe(13);
    expect(p!.logP).toBeCloseTo(1.13, 2);
    expect(p!.tpsa).toBeCloseTo(63.6, 1);
    expect(p!.hbd).toBe(1);
    expect(p!.hba).toBe(4);
    expect(p!.rotatableBonds).toBe(3);
    expect(p!.lipinski.pass).toBe(true);
    expect(p!.lipinski.violations).toHaveLength(0);
    expect(p!.veber.pass).toBe(true);
  });

  it("resolves a raw SMILES to the same result as the name", () => {
    const byName = computeProperties("aspirin");
    const bySmiles = computeProperties("CC(=O)Oc1ccccc1C(=O)O");
    expect(bySmiles).not.toBeNull();
    expect(bySmiles!.formula).toBe(byName!.formula);
    expect(bySmiles!.mw).toBeCloseTo(byName!.mw, 2);
    expect(bySmiles!.tpsa).toBeCloseTo(byName!.tpsa, 1);
  });

  it("caffeine has no H-bond donors and passes Lipinski", () => {
    const p = computeProperties("caffeine")!;
    expect(p.hbd).toBe(0);
    expect(p.hba).toBe(6);
    expect(p.lipinski.pass).toBe(true);
  });

  it("flags a large natural product (paclitaxel) as failing both screens", () => {
    const p = computeProperties("paclitaxel")!;
    expect(p.mw).toBeGreaterThan(500);
    // Lipinski: MW > 500 and HBA > 10 → ≥ 2 violations → fails.
    expect(p.lipinski.violations.length).toBeGreaterThanOrEqual(2);
    expect(p.lipinski.pass).toBe(false);
    expect(p.lipinski.violations).toContain("MW > 500");
    expect(p.lipinski.violations).toContain("H-bond acceptors > 10");
    // Veber: rotatable bonds > 10 and tPSA > 140 → fails.
    expect(p.veber.pass).toBe(false);
    expect(p.veber.violations).toContain("tPSA > 140 Å²");
  });

  it("ibuprofen is drug-like (passes both)", () => {
    const p = computeProperties("ibuprofen")!;
    expect(p.lipinski.pass).toBe(true);
    expect(p.veber.pass).toBe(true);
  });

  it("returns null for unresolvable input", () => {
    expect(computeProperties("not_a_compound_xyz!!")).toBeNull();
    expect(computeProperties("")).toBeNull();
  });
});
