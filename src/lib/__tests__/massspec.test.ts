import { parseFormula, computeMassSpec, adductMz, ADDUCTS } from "../massspec";

describe("parseFormula", () => {
  it("parses simple and multi-letter element formulas", () => {
    expect(parseFormula("C9H8O4")).toEqual({ C: 9, H: 8, O: 4 });
    expect(parseFormula("C22H24N2O8")).toEqual({ C: 22, H: 24, N: 2, O: 8 });
    expect(parseFormula("CH3Cl")).toEqual({ C: 1, H: 3, Cl: 1 });
    expect(parseFormula("NaCl")).toEqual({ Na: 1, Cl: 1 });
  });
});

describe("isotope-pattern M peak matches the monoisotopic mass", () => {
  it.each(["aspirin", "caffeine", "amoxicillin", "tetracycline"])("%s M-peak = monoisotopic", (name) => {
    const spec = computeMassSpec(name)!;
    // The M (offset 0) peak's centroid mass equals the OCL monoisotopic mass —
    // cross-checks the isotope table against OpenChemLib.
    const m = spec.pattern.find((p) => p.offset === 0)!;
    expect(m.mass).toBeCloseTo(spec.monoisotopicMass, 2);
  });
});

describe("computeMassSpec", () => {
  it("aspirin: exact masses and a sensible isotope pattern", () => {
    const s = computeMassSpec("aspirin")!;
    expect(s.formula).toBe("C9H8O4");
    expect(s.monoisotopicMass).toBeCloseTo(180.0423, 3);
    expect(s.averageMass).toBeCloseTo(180.159, 2);
    // M is the base peak (100); M+1 ~ 9-11% (nine carbons × 1.1%).
    expect(s.pattern[0].offset).toBe(0);
    expect(s.pattern[0].intensity).toBe(100);
    const m1 = s.pattern.find((p) => p.offset === 1)!;
    expect(m1.intensity).toBeGreaterThan(8);
    expect(m1.intensity).toBeLessThan(12);
  });

  it("chlorine gives the classic ~32% M+2 (37Cl)", () => {
    const s = computeMassSpec("CCl")!; // chloromethane CH3Cl
    expect(s.formula).toBe("CH3Cl");
    const m2 = s.pattern.find((p) => p.offset === 2)!;
    expect(m2.intensity).toBeGreaterThan(30);
    expect(m2.intensity).toBeLessThan(34);
  });

  it("sulfur raises M+2 (34S ~4.4%)", () => {
    const s = computeMassSpec("amoxicillin")!; // C16H19N3O5S
    const m2 = s.pattern.find((p) => p.offset === 2)!;
    expect(m2.intensity).toBeGreaterThan(4);
  });

  it("reports untabled elements instead of silently dropping them", () => {
    const s = computeMassSpec("chlorophyll a")!; // contains Mg
    expect(s.unsupportedInPattern).toContain("Mg");
    // Masses/adducts are still exact even when the pattern shape is incomplete.
    expect(s.monoisotopicMass).toBeGreaterThan(800);
  });

  it("adduct m/z is exact arithmetic on the monoisotopic mass", () => {
    const s = computeMassSpec("aspirin")!;
    const mh = s.adducts.find((a) => a.name === "[M+H]+")!;
    const mna = s.adducts.find((a) => a.name === "[M+Na]+")!;
    const mmh = s.adducts.find((a) => a.name === "[M-H]-")!;
    const m2h = s.adducts.find((a) => a.name === "[M+2H]2+")!;
    expect(mh.mz).toBeCloseTo(181.0495, 3);
    expect(mna.mz).toBeCloseTo(203.0315, 3);
    expect(mmh.mz).toBeCloseTo(179.0350, 3);
    // Doubly charged ion appears at roughly half the mass.
    expect(m2h.mz).toBeCloseTo((s.monoisotopicMass + 2 * 1.007276) / 2, 3);
  });

  it("returns null for unresolvable input", () => {
    expect(computeMassSpec("not_a_compound_zzz")).toBeNull();
  });

  it("[M+NH4]+ is one proton/electron correct (no double electron subtraction)", () => {
    const s = computeMassSpec("aspirin")!;
    const nh4 = s.adducts.find((a) => a.name === "[M+NH4]+")!;
    // 180.0423 + (18.0343741 − electron) = 198.0761.
    expect(nh4.mz).toBeCloseTo(198.0761, 3);
  });

  it("an all-untabled formula still anchors the M peak to the real mass (no m/z 0)", () => {
    const s = computeMassSpec("[Fe]")!; // Fe not in the isotope table
    expect(s.pattern[0].offset).toBe(0);
    expect(s.pattern[0].mass).toBeCloseTo(s.monoisotopicMass, 3);
    expect(s.pattern[0].mass).toBeGreaterThan(50);
    expect(s.unsupportedInPattern).toContain("Fe");
  });

  it("reports a neutral molecule as netCharge 0 with a full adduct table", () => {
    const s = computeMassSpec("aspirin")!;
    expect(s.netCharge).toBe(0);
    expect(s.adducts.length).toBeGreaterThan(0);
  });

  it("omits ESI adducts for an already-charged cation (choline)", () => {
    const s = computeMassSpec("[N+](C)(C)(C)CCO")!;
    expect(s.netCharge).toBe(1);
    expect(s.adducts).toHaveLength(0);
    // Mass and pattern are still valid for the ion's formula.
    expect(s.monoisotopicMass).toBeCloseTo(104.1075, 3);
    expect(s.pattern[0].offset).toBe(0);
  });

  it("omits ESI adducts for an anion (acetate)", () => {
    const s = computeMassSpec("CC(=O)[O-]")!;
    expect(s.netCharge).toBe(-1);
    expect(s.adducts).toHaveLength(0);
  });

  it("keeps adducts for a net-neutral salt (charges balance)", () => {
    const s = computeMassSpec("[Na+].[Cl-]")!;
    expect(s.netCharge).toBe(0);
    expect(s.adducts.length).toBeGreaterThan(0);
  });
});

describe("adductMz", () => {
  it("divides by the charge for multiply-charged ions", () => {
    const twoPlus = ADDUCTS.find((a) => a.name === "[M+2H]2+")!;
    expect(adductMz(1000, twoPlus)).toBeCloseTo((1000 + 2 * 1.007276) / 2, 4);
  });
});
