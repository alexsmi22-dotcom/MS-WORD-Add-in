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

// ---------------------------------------------------------------------------
// Parenthesised compound units.
//
// "W/(m^2*K)" is how every engineering text writes a heat transfer coefficient
// and how every student will type it. It used to be refused as "not a unit this
// recognises", which reads as a typo rather than as an unsupported notation, and
// sent people to guess at the equivalent "W/m^2/K". Both now work and must agree
// exactly, because they are the same unit written two ways.
// ---------------------------------------------------------------------------
describe("parenthesised compound units", () => {
  test("a parenthesised denominator equals the slash-chained form", () => {
    for (const [paren, chained] of [
      ["W/(m^2*K)", "W/m^2/K"],
      ["W/(m*K)", "W/m/K"],
      ["J/(kg*K)", "J/kg/K"],
      ["kJ/(kg*K)", "kJ/kg/K"],
      ["N/(m*s)", "N/m/s"],
    ]) {
      const a = convert(1, paren, chained);
      expect({ unit: paren, factor: a }).toEqual({ unit: paren, factor: 1 });
    }
  });

  test("the value converts correctly through a parenthesised unit", () => {
    // 1 kW/(m^2*K) is 1000 W/(m^2*K).
    expect(convert(1, "kW/(m^2*K)", "W/m^2/K")).toBeCloseTo(1000, 9);
    expect(ok(parseMeasured("25 W/(m^2*K)", "W/m^2/K")).inTarget).toBeCloseTo(25, 12);
    expect(ok(parseMeasured("1.5 kJ/(kg*K)", "J/kg/K")).inTarget).toBeCloseTo(1500, 9);
  });

  test("a parenthesised numerator works too", () => {
    expect(convert(1, "(N*m)/s", "W")).toBeCloseTo(1, 12);
  });

  // The two readings of "a/(b/c)" differ by c^2, so guessing one is a wrong
  // answer wearing a unit. It is refused instead.
  test("a nested division inside a group is refused rather than guessed", () => {
    expect(convert(1, "W/(m^2/K)", "W/m^2/K")).toBeNull();
  });

  test("unbalanced parentheses are refused, not silently repaired", () => {
    for (const bad of ["W/(m^2*K", "W/m^2*K)", "W/((m^2*K)", "W/)m^2*K("]) {
      expect(convert(1, bad, "W/m^2/K")).toBeNull();
    }
  });

  test("units without parentheses are completely unaffected", () => {
    // The regression guard for the change: every pre-existing form still works.
    expect(convert(1, "km/h", "m/s")).toBeCloseTo(1 / 3.6, 12);
    expect(convert(1, "kg*m/s^2", "N")).toBeCloseTo(1, 12);
    expect(convert(1, "mol/L/s", "mol/m^3/s")).toBeCloseTo(1000, 9);
    expect(convert(1, "N*m", "J")).toBeCloseTo(1, 12);
    expect(convert(1, "mm^4", "m^4")).toBeCloseTo(1e-12, 24);
  });
});

// ---------------------------------------------------------------------------
// THE NO-REGRESSION INVARIANT for making the Engineering tools unit-aware.
//
// Every one of those fields used to be read with Number(). They now go through
// parseMeasured(). That is safe ONLY because a bare number is returned in the
// target unit untouched — if parseMeasured ever started scaling a bare number,
// every Engineering answer would change silently and no oracle test would
// notice, because they all pass bare numbers too. This is the load-bearing
// property, so it is pinned directly.
// ---------------------------------------------------------------------------
describe("a bare number is never rescaled, whatever the target unit", () => {
  const targets = ["m", "m^2", "m^4", "Pa", "N", "N*m", "W", "W/m^2/K", "W/m/K", "kg/m^3", "Pa*s", "m/s", "m^3/s", "°C"];
  const values = ["0", "1", "-1", "8", "2.5", "-40", "250", "1e-6", "2e11", "998.2", "1.002e-3", "0.0000001", "1234567"];

  test.each(targets)("target %s", (unit) => {
    for (const v of values) {
      const m = parseMeasured(v, unit);
      if ("error" in m) throw new Error(`${v} as ${unit}: ${m.error}`);
      expect({ unit, v, inTarget: m.inTarget, assumed: m.assumed }).toEqual({
        unit,
        v,
        inTarget: Number(v),
        assumed: true,
      });
    }
  });

  test("and writing the target unit explicitly is also the identity", () => {
    for (const unit of ["m", "Pa", "N*m", "m^4"]) {
      const m = parseMeasured(`12.5 ${unit}`, unit);
      if ("error" in m) throw new Error(m.error);
      expect(m.inTarget).toBeCloseTo(12.5, 12);
      expect(m.assumed).toBe(false);
    }
  });
});
