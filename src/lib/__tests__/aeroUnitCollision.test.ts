// Guards the unit collisions an independent review found in the aviation aliases.
import { convert } from "../units";

describe("aviation unit aliases do not collide with existing symbols", () => {
  test('"Nm" must NOT become a nautical mile', () => {
    // The alias table falls back to a lowercased key, so an "nm" -> "nmi" alias
    // made newton-metre resolve to 1852 metres. nm stays nanometre.
    expect(convert(1, "nm", "m")).toBeCloseTo(1e-9, 20);
    expect(convert(12, "Nm", "m")).toBeNull();
    expect(convert(1, "NM", "m")).toBeNull();
  });

  test('"KN" must NOT become knots', () => {
    expect(convert(1, "kN", "N")).toBeCloseTo(1000, 9);
    expect(convert(1, "KN", "m/s")).toBeNull();
  });

  test("the spelled-out aviation aliases still work", () => {
    expect(convert(1, "knot", "m/s")).toBeCloseTo(1852 / 3600, 12);
    expect(convert(1, "knots", "m/s")).toBeCloseTo(1852 / 3600, 12);
    expect(convert(1, "kts", "m/s")).toBeCloseTo(1852 / 3600, 12);
    expect(convert(1, "nmi", "m")).toBeCloseTo(1852, 9);
    expect(convert(1, "nauticalmile", "m")).toBeCloseTo(1852, 9);
  });

  test("the new speed dimension still interoperates with compounds", () => {
    expect(convert(100, "kt", "km/h")).toBeCloseTo(185.2, 6);
    expect(convert(1, "m/s", "kt")).toBeCloseTo(3600 / 1852, 9);
    expect(convert(1, "ft/s", "m/s")).toBeCloseTo(0.3048, 12);
    // And it must not make unrelated quantities compatible.
    expect(convert(1, "kt", "kg")).toBeNull();
    expect(convert(1, "kt", "Hz")).toBeNull();
    expect(convert(1, "m/s", "m")).toBeNull();
  });
});
