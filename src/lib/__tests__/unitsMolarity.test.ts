// Every molarity spelling must agree. The compound-unit path multiplies unit
// factors against SI mol and m³, so M must be 1000 mol/m³ — when M was
// factor 1, convert(0.08, "mol/L", "M") returned 80 (a 1000× error).

import { convert } from "../units";

describe("molarity spellings agree", () => {
  test.each([
    ["M", 1],
    ["mol/L", 1],
    ["mol/dm3", 1],
    ["mol/dm^3", 1],
    ["mol/dm³", 1],
    ["mmol/mL", 1],
    ["µmol/µL", 1],
    ["µmol/mL", 1e-3],
    ["mol/m3", 1e-3],
    ["mol/m^3", 1e-3],
    ["mol/mL", 1e3],
    ["mM", 1e-3],
    ["µM", 1e-6],
    ["nM", 1e-9],
    ["pM", 1e-12],
    ["mmol/L", 1e-3],
  ])("1 %s = %s M", (unit, inM) => {
    expect(convert(1, unit, "M")).toBeCloseTo(inM, 12 + Math.max(0, -Math.log10(inM)));
    expect(convert(inM, "M", unit)).toBeCloseTo(1, 9);
  });
  test("the review's case: 0.0800 mol/L = 0.0800 M", () => {
    expect(convert(0.08, "mol/L", "M")).toBeCloseTo(0.08, 12);
    expect(convert(0.08, "mmol/mL", "M")).toBeCloseTo(0.08, 12);
    expect(convert(1, "mol/mL", "M")).toBeCloseTo(1000, 9);
  });
  test("single-unit ratios unchanged", () => {
    expect(convert(1, "M", "mM")).toBeCloseTo(1000, 9);
    expect(convert(250, "nM", "µM")).toBeCloseTo(0.25, 12);
  });
  test("cm³ / dm³ volume and density spellings", () => {
    expect(convert(1.5, "cm3", "mL")).toBeCloseTo(1.5, 12);
    expect(convert(1.5, "cm³", "mL")).toBeCloseTo(1.5, 12);
    expect(convert(2, "dm3", "L")).toBeCloseTo(2, 12);
    expect(convert(2.13, "g/cm3", "g/mL")).toBeCloseTo(2.13, 12);
    expect(convert(2.13, "g/cm^3", "kg/m^3")).toBeCloseTo(2130, 9);
    expect(convert(1, "cc", "mL")).toBeCloseTo(1, 12);
  });
});
