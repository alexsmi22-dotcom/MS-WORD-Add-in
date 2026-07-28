// Derived dimensions and measured quantities.
//
// Every named dimension used to be atomic: "pressure" was irreducible and
// unrelated to mass, length and time, and there was no force unit at all. So
// N/m^2 could not be recognised as a stress, N*m could not be recognised as an
// energy, and engineering quantities could not be expressed. These tests pin
// the decomposition, because the failure mode if it regresses is a refusal that
// looks like a typo rather than a bug.

import { convert, parseMeasured, Measured } from "../units";

const ok = (r: Measured | { error: string }): Measured => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("derived units reduce to the same base dimensions", () => {
  test("stress can be written three ways and they agree", () => {
    expect(convert(1, "N/m^2", "Pa")).toBeCloseTo(1, 12);
    expect(convert(1, "N/mm^2", "MPa")).toBeCloseTo(1, 12);
    expect(convert(1, "MPa", "Pa")).toBeCloseTo(1e6, 6);
    expect(convert(1, "GPa", "MPa")).toBeCloseTo(1000, 9);
  });

  test("a moment and an energy share dimensions, as they must", () => {
    expect(convert(1, "N*m", "J")).toBeCloseTo(1, 12);
    expect(convert(1, "kN*m", "N*m")).toBeCloseTo(1000, 9);
  });

  test("power is energy per time and voltage is power per current", () => {
    expect(convert(1, "J/s", "W")).toBeCloseTo(1, 12);
    expect(convert(1, "W/A", "V")).toBeCloseTo(1, 12);
    expect(convert(1, "V/A", "Ω")).toBeCloseTo(1, 12);
  });

  test("force units convert, including the imperial ones", () => {
    expect(convert(1, "kN", "N")).toBeCloseTo(1000, 9);
    expect(convert(1, "lbf", "N")).toBeCloseTo(4.4482216152605, 9);
    expect(convert(1, "kip", "lbf")).toBeCloseTo(1000, 6);
    expect(convert(1, "ksi", "MPa")).toBeCloseTo(6.894757, 6);
  });

  test("incompatible quantities are still refused", () => {
    expect(convert(1, "N", "m")).toBeNull();
    expect(convert(1, "Pa", "N")).toBeNull();
    expect(convert(1, "kg", "s")).toBeNull();
  });

  test("angle stays atomic — radians must not silently become a pure number", () => {
    expect(convert(1, "rad", "m")).toBeNull();
  });
});

describe("parseMeasured", () => {
  test("reads a value with its unit and converts it", () => {
    expect(ok(parseMeasured("12 kN·m", "N*m")).inTarget).toBeCloseTo(12000, 9);
    expect(ok(parseMeasured("4.5mm", "m")).inTarget).toBeCloseTo(0.0045, 15);
    expect(ok(parseMeasured("200 GPa", "Pa")).inTarget).toBeCloseTo(2e11, 3);
  });

  test("a bare number is accepted and flagged as assumed, not refused", () => {
    const r = ok(parseMeasured("50", "mm"));
    expect(r.inTarget).toBe(50);
    expect(r.assumed).toBe(true);
    expect(r.unit).toBe("mm");
  });

  // The point of the whole exercise: a wrong unit must not be ignored.
  test("a unit of the wrong quantity is refused, and says so", () => {
    const r = parseMeasured("12 kg", "N*m");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/not compatible/i);
  });

  test("an unrecognised unit is distinguished from an incompatible one", () => {
    const r = parseMeasured("12 zorkmids", "N");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/not a unit/i);
  });

  test("empty and non-numeric input are refused", () => {
    expect("error" in parseMeasured("", "m")).toBe(true);
    expect("error" in parseMeasured("kN", "N")).toBe(true);
  });

  test("scientific notation survives", () => {
    expect(ok(parseMeasured("2.1e11 Pa", "GPa")).inTarget).toBeCloseTo(210, 6);
  });
});
