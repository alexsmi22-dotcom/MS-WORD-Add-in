import {
  toSuperscript,
  formatUnit,
  parseQuantity,
  formatQuantityHtml,
  convert,
  roundSig,
  formatSig,
} from "../units";

describe("formatUnit", () => {
  it("superscripts exponents and keeps the slash", () => {
    expect(formatUnit("m/s^2")).toBe("m/s²");
    expect(formatUnit("s^-1")).toBe("s⁻¹");
  });
  it("turns * and spaces into middle dots", () => {
    expect(formatUnit("kg*m^2")).toBe("kg·m²");
    expect(formatUnit("N m")).toBe("N·m");
  });
  it("fixes common symbols", () => {
    expect(formatUnit("ohm")).toBe("Ω");
    expect(formatUnit("degC")).toBe("°C");
    expect(formatUnit("umol")).toBe("µmol");
  });
  it("keeps a spaced division slash and maps spelled-out micro units", () => {
    expect(formatUnit("m / s")).toBe("m/s");
    expect(formatUnit("kg m / s^2")).toBe("kg·m/s²");
    expect(formatUnit("micrometer")).toBe("µm");
    expect(formatUnit("microgram")).toBe("µg");
  });
  it("handles a spaced degree unit without a stray dot", () => {
    expect(formatUnit("deg C")).toBe("°C");
    expect(formatUnit("deg F")).toBe("°F");
  });
});

describe("parseQuantity / formatQuantityHtml", () => {
  it("parses value, uncertainty, and unit", () => {
    expect(parseQuantity("5.0 +- 0.2 kg")).toMatchObject({ value: "5.0", uncertainty: "0.2", unit: "kg" });
  });
  it("typesets uncertainty with a thin space", () => {
    expect(formatQuantityHtml("5.0 +- 0.2 kg")).toBe("5.0 ± 0.2&#8201;kg");
  });
  it("typesets scientific notation", () => {
    expect(formatQuantityHtml("1.2e-3 mol/L")).toBe("1.2 × 10⁻³&#8201;mol/L");
  });
  it("handles a bare number with units", () => {
    expect(formatQuantityHtml("9.81 m/s^2")).toBe("9.81&#8201;m/s²");
  });
});

describe("convert", () => {
  it("converts within a dimension", () => {
    expect(convert(1, "km", "m")).toBeCloseTo(1000, 6);
    expect(convert(1, "in", "cm")).toBeCloseTo(2.54, 6);
    expect(convert(1000, "g", "kg")).toBeCloseTo(1, 6);
  });
  it("handles affine temperature conversions", () => {
    expect(convert(0, "°C", "K")).toBeCloseTo(273.15, 4);
    expect(convert(100, "°C", "°F")).toBeCloseTo(212, 4);
    expect(convert(32, "°F", "°C")).toBeCloseTo(0, 4);
  });
  it("resolves aliases", () => {
    expect(convert(1, "liter", "mL")).toBeCloseTo(1000, 6);
    expect(convert(1, "hour", "s")).toBeCloseTo(3600, 6);
  });
  it("returns null for incompatible or unknown units", () => {
    expect(convert(1, "kg", "m")).toBeNull();
    expect(convert(1, "m", "frobnicate")).toBeNull();
  });

  it("converts compound units by matching dimensions", () => {
    expect(convert(36, "km/h", "m/s")).toBeCloseTo(10, 6);
    expect(convert(1, "g/mol", "kg/mol")).toBeCloseTo(0.001, 9);
    expect(convert(1, "kg*m/s^2", "kg*m/s^2")).toBeCloseTo(1, 9);
    expect(convert(1, "m/s", "kg")).toBeNull(); // incompatible dimensions
    expect(convert(5, "m/", "m")).toBeNull(); // malformed trailing slash
  });
});

describe("significant figures", () => {
  it("rounds to N sig figs", () => {
    expect(roundSig(123.456, 4)).toBe(123.5);
    expect(roundSig(0.00123456, 2)).toBeCloseTo(0.0012, 8);
  });
  it("formats sig figs", () => {
    expect(formatSig(123.456, 4)).toBe("123.5");
    expect(toSuperscript("-3")).toBe("⁻³");
  });
});
