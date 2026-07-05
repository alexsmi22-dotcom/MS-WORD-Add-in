import { validateFormula, isElement, hillFormula, PERIODIC } from "../chemValidate";

describe("isElement / PERIODIC", () => {
  test("recognizes real elements, case-sensitively", () => {
    expect(isElement("C")).toBe(true);
    expect(isElement("Co")).toBe(true); // cobalt
    expect(isElement("Uue")).toBe(false);
    expect(isElement("co")).toBe(false); // wrong case
    expect(isElement("Xx")).toBe(false);
  });
  test("covers all 118 elements", () => {
    expect(Object.keys(PERIODIC)).toHaveLength(118);
  });
});

describe("validateFormula — valid formulas", () => {
  test("water: counts and molecular weight", () => {
    const r = validateFormula("H2O");
    expect(r.valid).toBe(true);
    expect(r.counts).toEqual({ H: 2, O: 1 });
    expect(r.mass).toBeCloseTo(18.015, 2);
    expect(r.hill).toBe("H2O");
    expect(r.charge).toBe(0);
  });
  test("glucose Hill formula and mass", () => {
    const r = validateFormula("C6H12O6");
    expect(r.valid).toBe(true);
    expect(r.mass).toBeCloseTo(180.156, 2);
    expect(r.hill).toBe("C6H12O6");
  });
  test("nested groups: Ca(OH)2", () => {
    const r = validateFormula("Ca(OH)2");
    expect(r.counts).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(r.mass).toBeCloseTo(74.09, 1);
  });
  test("doubly nested: K4[Fe(CN)6]", () => {
    const r = validateFormula("K4[Fe(CN)6]");
    expect(r.valid).toBe(true);
    expect(r.counts).toEqual({ K: 4, Fe: 1, C: 6, N: 6 });
  });
  test("hydrate: CuSO4·5H2O (and with a dot)", () => {
    const a = validateFormula("CuSO4·5H2O");
    expect(a.valid).toBe(true);
    expect(a.counts).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(a.mass).toBeCloseTo(249.68, 1);
    expect(validateFormula("CuSO4.5H2O").counts).toEqual(a.counts);
  });
  test("charges: Na+, Ca2+, SO4^2-", () => {
    expect(validateFormula("Na+").charge).toBe(1);
    expect(validateFormula("Ca2+")).toMatchObject({ valid: true, charge: 2, counts: { Ca: 1 } });
    expect(validateFormula("SO4^2-")).toMatchObject({ charge: -2, counts: { S: 1, O: 4 } });
  });
});

describe("validateFormula — polyatomic ions (bare charge sign)", () => {
  test("ammonium NH4+ keeps the subscript and takes charge +1", () => {
    expect(validateFormula("NH4+")).toMatchObject({ valid: true, counts: { N: 1, H: 4 }, charge: 1 });
    expect(validateFormula("NH4+").mass).toBeCloseTo(18.04, 2);
  });
  test("nitrate, bicarbonate, dihydrogen phosphate", () => {
    expect(validateFormula("NO3-")).toMatchObject({ counts: { N: 1, O: 3 }, charge: -1 });
    expect(validateFormula("HCO3-")).toMatchObject({ counts: { H: 1, C: 1, O: 3 }, charge: -1 });
    expect(validateFormula("H2PO4-")).toMatchObject({ counts: { H: 2, P: 1, O: 4 }, charge: -1 });
    expect(validateFormula("H3O+")).toMatchObject({ counts: { H: 3, O: 1 }, charge: 1 });
  });
  test("monatomic metal cations still read the digit as the charge", () => {
    expect(validateFormula("Ca2+")).toMatchObject({ counts: { Ca: 1 }, charge: 2 });
    expect(validateFormula("Fe3+")).toMatchObject({ counts: { Fe: 1 }, charge: 3 });
    expect(validateFormula("Na+")).toMatchObject({ counts: { Na: 1 }, charge: 1 });
  });
});

describe("validateFormula — invalid formulas", () => {
  test("flags a fake element symbol", () => {
    const r = validateFormula("H2G");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("Unknown element");
    expect(r.errors.join(" ")).toContain("G");
    expect(r.mass).toBeNull();
  });
  test("flags a mis-cased element (Co vs CO)", () => {
    expect(validateFormula("cO").valid).toBe(false); // "c" is not an element start
  });
  test("flags unbalanced brackets", () => {
    expect(validateFormula("Ca(OH2").valid).toBe(false);
    expect(validateFormula("Fe(CN)6]").valid).toBe(false);
  });
  test("flags an empty formula", () => {
    expect(validateFormula("   ").valid).toBe(false);
  });
});

describe("hillFormula", () => {
  test("orders C, H, then alphabetical", () => {
    expect(hillFormula({ O: 1, H: 2 })).toBe("H2O");
    expect(hillFormula({ O: 2, C: 1 })).toBe("CO2");
    expect(hillFormula({ N: 1, C: 1, H: 5, O: 2 })).toBe("C H5 N O2".replace(/ /g, ""));
  });
});
