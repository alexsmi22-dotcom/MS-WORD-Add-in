// Photometry: luminous intensity is the 7th SI base unit, and the interesting
// part of this family is which conversions must be REFUSED.

import { convert, parseMeasured } from "../units";

describe("the derived photometric quantities convert", () => {
  const cases: [number, string, string, number][] = [
    [1, "cd", "mcd", 1000],
    [1, "kcd", "cd", 1000],
    [1, "nit", "cd/m^2", 1],       // a nit IS a candela per square metre
    [500, "cd/m^2", "nit", 500],
    [1, "lx", "lm/m^2", 1],        // a lux IS a lumen per square metre
    [1, "klm", "lm", 1000],
    [1, "klx", "lx", 1000],
  ];
  it.each(cases)("%p %s -> %s", (v, from, to, want) => {
    const got = convert(v, from, to);
    expect(got).not.toBeNull();
    expect(got!).toBeCloseTo(want, 9);
  });

  it("spelled-out names work", () => {
    expect(convert(1, "candela", "cd")).toBe(1);
    expect(convert(1, "lumen", "lm")).toBe(1);
    expect(convert(1, "lux", "lx")).toBe(1);
    expect(convert(1, "nits", "nit")).toBe(1);
  });
});

describe("the conversions that MUST be refused", () => {
  // Each of these would be a confident answer to a question the units alone
  // cannot settle. Refusing is the whole point of keeping the dimensions apart.

  it("lumen to watt — related by the wavelength-dependent luminosity function", () => {
    // 1 W at 555 nm is 683 lm; deep red is a small fraction of that. There is
    // no constant to convert by.
    expect(convert(1, "lm", "W")).toBeNull();
    expect(convert(1, "W", "lm")).toBeNull();
  });

  it("candela to lumen — needs the solid angle the source emits into", () => {
    // A torch and a bare lamp of equal candela differ enormously in lumens.
    expect(convert(1, "cd", "lm")).toBeNull();
    expect(convert(1, "lm", "cd")).toBeNull();
  });

  it("luminance to illuminance — opposite ends of the light path", () => {
    expect(convert(1, "nit", "lx")).toBeNull();
    expect(convert(1, "cd/m^2", "lx")).toBeNull();
    expect(convert(1, "lx", "nit")).toBeNull();
  });

  it("photometric quantities do not leak into radiometric ones", () => {
    for (const [f, t] of [["cd", "W"], ["lx", "W/m^2"], ["nit", "W/m^2"]] as const) {
      expect(convert(1, f, t)).toBeNull();
      expect(convert(1, t, f)).toBeNull();
    }
  });
});

describe("frame rate", () => {
  it("converts with Hz — the point is checking a source against a panel", () => {
    expect(convert(60, "fps", "Hz")).toBe(60);
    expect(convert(1, "kHz", "fps")).toBe(1000);
  });

  it("feet per second stays available and unambiguous as a compound", () => {
    // The collision this accepts: "fps" means frames, ft/s means feet.
    const ftPerS = convert(1, "ft/s", "m/s");
    expect(ftPerS).not.toBeNull();
    expect(ftPerS!).toBeCloseTo(0.3048, 9);
    // And a frame rate is NOT a speed.
    expect(convert(1, "fps", "m/s")).toBeNull();
  });
});

describe("no collisions with existing units", () => {
  it("the new symbols did not capture anything that already worked", () => {
    expect(convert(1, "cd", "cd")).toBe(1);
    // 'lm' must not have disturbed 'm', 'lx' must not have disturbed 'L'.
    expect(convert(1, "km", "m")).toBe(1000);
    // toBeCloseTo, not toBe: L->mL is 0.001/1e-6 = 1000.0000000000001 in binary
    // floating point. Pre-existing and unrelated to photometry, but a strict
    // equality here would read like a collision to the next person.
    expect(convert(1, "L", "mL")!).toBeCloseTo(1000, 9);
    expect(convert(1, "cm", "mm")!).toBeCloseTo(10, 9);
    // Existing frequency and speed families are intact.
    expect(convert(1, "MHz", "kHz")).toBe(1000);
    expect(convert(1, "kt", "m/s")).toBeCloseTo(1852 / 3600, 9);
    expect(convert(1, "fpm", "m/s")).toBeCloseTo(0.3048 / 60, 9);
  });

  it("the bare-number identity holds for every new target unit", () => {
    for (const u of ["cd", "lm", "lx", "nit", "cd/m^2", "lm/m^2", "fps"]) {
      const r = parseMeasured("42", u);
      expect("error" in r).toBe(false);
      if (!("error" in r)) {
        expect(r.inTarget).toBe(42);
        expect(r.assumed).toBe(true);
      }
    }
  });
});
