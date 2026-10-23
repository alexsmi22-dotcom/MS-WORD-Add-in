// Release E (2026-10-23) unit defects from the engineering gap analysis: °C/°F inside compound units are temperature
// DIFFERENCES; a lone °C/°F keeps its offset; the missing engineering units; stress intensity with a root sign.
// Oracle: exact definitions (NIST SP 811 conversion factors; IT BTU = 1055.05585262 J; 1 lb = 0.45359237 kg;
// g₀ = 9.80665 m/s²; 1 ft = 0.3048 m; 1 US gal = 3.785411784 L). Reference values computed in
// ~/jurislab-oracle-venv:  1 Btu/(h·ft²·°F) = 1055.05585262/3600/0.3048²·9/5 = 5.678263341 W/(m²·K);
// 1 ksi·√in = 6.894757293e6·0.0254^0.5 Pa·√m = 1.098843447 MPa·√m.
import { convert, formatUnit, parseMeasured } from "../units";

const close = (v: number | null, want: number, rel = 1e-9): void => {
  expect(v).not.toBeNull();
  expect(Math.abs((v as number) - want)).toBeLessThanOrEqual(Math.abs(want) * rel);
};

describe("°C and °F inside a compound are temperature differences", () => {
  test.each([
    ["W/(m^2*°C)", "W/(m^2*K)", 1],
    ["Btu/(h*ft^2*°F)", "W/(m^2*K)", 5.678263341113487],
    ["W/(m*°F)", "W/(m*K)", 1.8],
    ["1/°C", "1/K", 1],
    ["J/(kg*°F)", "J/(kg*K)", 1.8],
    ["µm/(m*°C)", "1/K", 1e-6],
    ["µin/(in*°F)", "µm/(m*K)", 1.8],
    ["BTU/(h*ft*°F)", "W/(m*K)", 1.7307346663713907],
    ["/K", "1/K", 1],
    ["/°C", "1/K", 1],
    ["ppm/K", "1/K", 1e-6],
    ["%/°C", "1/K", 0.01],
  ])("1 %s = %s %s", (from, to, want) => close(convert(1, from, to), want as number));

  test("a lone °C or °F still converts with its offset", () => {
    close(convert(20, "°C", "K"), 293.15);
    close(convert(68, "°F", "°C"), 20);
    expect(parseMeasured("20 °C", "K")).toEqual({ value: 20, unit: "°C", inTarget: 293.15, assumed: false });
  });

  test("explicit differences and Rankine", () => {
    close(convert(180, "Δ°F", "K"), 100);
    close(convert(180, "deltaF", "ΔK"), 100);
    close(convert(491.67, "°R", "K"), 273.15);
    close(convert(1, "Δ°C", "K"), 1);
  });

  test("a lone fraction stays a fraction (never a pure number)", () => {
    expect(convert(1, "ppm", "1")).toBeNull();
    close(convert(5, "%", "ppm"), 50000);
  });

  test("a temperature still cannot become a heat transfer coefficient", () => {
    expect(convert(20, "°C", "W/(m^2*K)")).toBeNull();
  });
});

describe("units the engineering fields needed", () => {
  test.each([
    ["t", "kg", 1000],
    ["tonne", "kg", 1000],
    ["slug", "kg", 14.593902937206362],
    ["lbm", "kg", 0.45359237],
    ["kgf", "N", 9.80665],
    ["mil", "m", 2.54e-5],
    ["thou", "µm", 25.4],
    ["µin", "nm", 25.4],
    ["uin", "µm", 0.0254],
    ["TR", "W", (12000 * 1055.05585262) / 3600],
    ["gpm", "L/min", 3.785411784],
    ["cfm", "m^3/s", Math.pow(0.3048, 3) / 60],
    ["bbl", "L", 158.987294928],
    ["arcmin", "°", 1 / 60],
    ["arcsec", "µrad", 4.84813681109536],
    ["µrad", "mrad", 1e-3],
    ["Oe", "A/m", 1000 / (4 * Math.PI)],
  ])("1 %s = %s %s", (from, to, want) => close(convert(1, from, to), want as number));

  test("the tesla and the tonne are told apart by case", () => {
    expect(convert(1, "T", "kg")).toBeNull();
    close(convert(1, "T", "G"), 1e4);
  });

  test("“ton” alone is not a unit (four different tons)", () => {
    expect(convert(1, "ton", "kg")).toBeNull();
  });
});

describe("stress intensity: a root sign parses and is displayed", () => {
  test("MPa·√m, ksi·√in and the caret form all read into Pa·√m", () => {
    for (const typed of ["50 MPa*m^0.5", "50 MPa·√m", "50 MPa √m"]) {
      const m = parseMeasured(typed, "Pa*m^0.5");
      expect("error" in m ? m.error : m.inTarget).toBeCloseTo(5e7, 0);
    }
    const ksi = parseMeasured("1 ksi·√in", "MPa*m^0.5");
    expect("error" in ksi ? ksi.error : ksi.inTarget).toBeCloseTo(1.098843447, 8);
  });
  test("a bare number is read in the field's own unit, and plain MPa is refused as the wrong quantity", () => {
    expect(parseMeasured("50e6", "Pa*m^0.5")).toMatchObject({ inTarget: 5e7, assumed: true });
    expect("error" in parseMeasured("50 MPa", "Pa*m^0.5")).toBe(true);
  });
  test("formatUnit writes the root, as the field label does", () => {
    expect(formatUnit("Pa*m^0.5")).toBe("Pa·√m");
    expect(formatUnit("ksi*in^0.5")).toBe("ksi·√in");
    expect(formatUnit("m^2")).toBe("m²");
  });
});
