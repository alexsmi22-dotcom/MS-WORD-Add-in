// The energy-domain unit family: grid energy (kWh/MWh/GWh), fuel energy
// (BTU/therm), battery charge (Ah/mAh), and the US gallon for flow — plus the
// collision guards that keep the lowercase alias fallback from misreading a
// differently-cased real unit (the Nm → nmi / kb → kilobit precedent).

import { convert, parseMeasured } from "../units";

describe("energy units convert exactly", () => {
  const cases: [number, string, string, number][] = [
    [1, "kWh", "J", 3.6e6],
    [1, "kWh", "Wh", 1000],
    [1, "MWh", "kWh", 1000],
    [1, "GWh", "MWh", 1000],
    [1, "BTU", "J", 1055.05585262],
    [1, "therm", "BTU", 1e5], // derived as exactly 100000 BTU — see units.ts
    [1, "Ah", "C", 3600],
    [1000, "mAh", "Ah", 1],
    [1, "Ah", "A*h", 1], // charge decomposes, so Ah meets the compound form
    [1, "gal", "L", 3.785411784],
    [1, "gal/min", "m^3/s", 3.785411784e-3 / 60],
    [1, "kWh/kg", "MJ/kg", 3.6],
    [1, "kg/kWh", "g/kWh", 1000],
    [1, "W/m^2", "kW/m^2", 1e-3],
    [25, "kwh", "kWh", 25], // unambiguous lowercase alias
    [2, "Btu", "BTU", 2], // the ASHRAE casing
  ];
  it.each(cases)("%p %s -> %s", (v, from, to, want) => {
    const got = convert(v, from, to);
    expect(got).not.toBeNull();
    expect(Math.abs((got! - want) / want)).toBeLessThan(1e-12);
  });
});

describe("collision guards", () => {
  it("mWh is REFUSED, not read as megawatt-hours", () => {
    // A lowercase "mwh" alias would make a typed mWh — milliwatt-hour, a real
    // unit on coin-cell spec sheets — resolve to MWh, a 10^9 error.
    expect(convert(1, "mWh", "J")).toBeNull();
  });

  it("newton-metre still works as a compound and is not hijacked", () => {
    expect(convert(1, "N*m", "J")).toBe(1);
  });

  it("gal did not break cal", () => {
    expect(convert(1, "cal", "J")).toBeCloseTo(4.184, 12);
    expect(convert(1, "kcal", "cal")).toBeCloseTo(1000, 9);
  });

  it("Ah did not break ampere or hour on their own", () => {
    expect(convert(1, "A", "mA")).toBeCloseTo(1000, 9);
    expect(convert(1, "h", "s")).toBe(3600);
  });
});

describe("superscript unit text parses — the display must round-trip", () => {
  // Labels and results print m², m³/s and W/m² with real superscripts; a user
  // pasting a displayed unit back into a field is typing what we showed them.
  it("m³, m² and W/m² convert identically to their caret forms", () => {
    expect(convert(1, "m³/s", "L/s")).toBeCloseTo(1000, 9);
    expect(convert(1, "W/m²", "W/m^2")).toBe(1);
    expect(convert(1, "kg/m³", "kg/m^3")).toBe(1);
    expect(convert(1, "m⁻¹", "1/m")).toBeNull(); // "1" is not a unit — unchanged behaviour
    expect(convert(1, "s⁻¹", "Hz")).toBe(1); // negative superscript exponent
  });

  it("parseMeasured accepts a superscripted unit against a superscripted target", () => {
    const r = parseMeasured("500 gal/min", "m³/s");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.inTarget).toBeCloseTo((500 * 3.785411784e-3) / 60, 9);
  });
});

describe("the bare-number identity holds for every energy target unit", () => {
  // parseMeasured(bare, unit).inTarget === Number(bare) exactly — the contract
  // that makes unit-aware reading a provable no-op for unitless input.
  const targets = ["kWh", "MWh", "BTU", "Ah", "W/m^2", "m^3/s", "MJ/kg", "MW", "gal/min"];
  it.each(targets)("%s", (t) => {
    const r = parseMeasured("42", t);
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.inTarget).toBe(42);
      expect(r.assumed).toBe(true);
    }
  });
});
