// The student-pack unit families. Expected values are DEFINITIONS only
// (SI Brochure 9th ed.; NIST SP 811): 1 P = 0.1 Pa·s; 1 St = 10⁻⁴ m²/s;
// 1 Torr = 101 325/760 Pa; 1 mmHg (conventional) = 13.5951 g/cm³ × 1 mm ×
// 9.80665 m/s² = 133.322387415 Pa (Python: 13595.1*9.80665*0.001); 1 Ci =
// 3.7×10¹⁰ Bq; 1 rad = 10⁻² Gy; 1 rem = 10⁻² Sv; 1 U = 1 µmol/min; 1 Mx =
// 10⁻⁸ Wb; 1 sr = 1 rad²; 1 week = 7 d; 1 Julian year = 365.25 d.
//
// Every case runs through convert() and parseMeasured() — the two calls the
// pane's unit converter (doConvert) makes — so a refusal is tested as the
// sentence the user will read.

import { convert, parseMeasured, unitRefusal } from "../units";
import { solveWithUnits } from "../unitSolve";

const near = (got: number | null, want: number, rel = 1e-12) => {
  expect(got).not.toBeNull();
  expect(Math.abs(got! - want)).toBeLessThanOrEqual(rel * Math.abs(want));
};
/** The sentence doConvert shows for a refused conversion. */
const why = (value: number, from: string, to: string): string => {
  expect(convert(value, from, to)).toBeNull();
  const r = parseMeasured(`${value} ${from}`, to);
  if (!("error" in r)) throw new Error(`parseMeasured accepted ${from} → ${to}`);
  return r.error;
};

describe("viscosity", () => {
  it("dynamic: P, cP, Pa·s, mPa·s", () => {
    near(convert(1, "P", "Pa*s"), 0.1);
    near(convert(1, "cP", "Pa·s"), 1e-3);
    near(convert(1, "cP", "mPa·s"), 1);
    near(convert(1, "poise", "cP"), 100);
    near(convert(0.89, "mPa*s", "cP"), 0.89);
  });
  it("kinematic: St, cSt, m²/s, mm²/s", () => {
    near(convert(1, "St", "m^2/s"), 1e-4);
    near(convert(1, "cSt", "mm²/s"), 1);
    near(convert(1, "stokes", "cSt"), 100);
  });
  it("dynamic ↔ kinematic is refused by name (needs the density)", () => {
    expect(why(1, "cP", "cSt")).toMatch(/kinematic = dynamic ÷ density/);
    expect(why(1, "Pa*s", "m^2/s")).toMatch(/Converting needs the fluid's density/);
  });
});

describe("pressure: Torr and mmHg by their own definitions", () => {
  it("1 Torr = 101 325/760 Pa exactly; 760 Torr = 1 atm", () => {
    near(convert(1, "Torr", "Pa"), 101325 / 760);
    near(convert(760, "torr", "atm"), 1);
  });
  it("1 mmHg = 133.322387415 Pa (conventional)", () => {
    near(convert(1, "mmHg", "Pa"), 133.322387415);
  });
  it("Torr and mmHg differ by the definitions' ratio, about 1.4×10⁻⁷", () => {
    near(convert(1, "mmHg", "Torr"), 133.322387415 / (101325 / 760));
    expect(Math.abs(convert(1, "mmHg", "Torr")! - 1)).toBeGreaterThan(1e-7);
    expect(Math.abs(convert(1, "mmHg", "Torr")! - 1)).toBeLessThan(2e-7);
  });
});

describe("radioactivity", () => {
  it("1 Ci = 3.7×10¹⁰ Bq; prefixes", () => {
    near(convert(1, "Ci", "Bq"), 3.7e10);
    near(convert(1, "mCi", "MBq"), 37);
    near(convert(4, "pCi", "Bq"), 0.148);
    near(convert(1, "curie", "GBq"), 37);
    near(convert(1, "µCi", "kBq"), 37);
    near(convert(1, "μCi", "kBq"), 37); // Greek mu pasted from a datasheet
  });
  it("Bq is NOT Hz, s⁻¹ or fps — refused by name", () => {
    expect(why(1, "Bq", "Hz")).toMatch(/Bq \(activity: random decays per second\) and Hz/);
    expect(why(1, "Bq", "1/s")).toMatch(/is not converted to a frequency or a bare s⁻¹/);
    expect(why(1, "Hz", "Bq")).toMatch(/Bq \(activity/);
    expect(convert(1, "Bq", "fps")).toBeNull();
    expect(convert(1, "Bq/kg", "Hz/kg")).toBeNull();
  });
});

describe("absorbed and equivalent dose", () => {
  it("1 rd (the dose rad) = 1 cGy = 10⁻² Gy; 1 rem = 10⁻² Sv", () => {
    near(convert(1, "rd", "Gy"), 0.01);
    near(convert(1, "cGy", "rd"), 1);
    near(convert(100, "rem", "Sv"), 1);
    near(convert(1, "mSv", "mrem"), 100);
    near(convert(1, "gray", "mGy"), 1000);
    near(convert(2, "mGy/h", "µGy/h"), 2000);
  });
  it("Gy → Sv is refused BY NAME, including prefixed and per-hour forms", () => {
    const msg = why(1, "Gy", "Sv");
    expect(msg).toMatch(/Gy \(absorbed dose\) and Sv \(equivalent or effective dose\) are both J\/kg, but they are DIFFERENT quantities/);
    expect(msg).toMatch(/radiation weighting factor w_R/);
    expect(why(1, "mGy/h", "µSv/h")).toMatch(/DIFFERENT quantities/);
    expect(why(1, "rem", "rd")).toMatch(/DIFFERENT quantities/);
  });
  it("a dose is not a bare J/kg (so it can never become the other dose)", () => {
    expect(why(1, "Gy", "J/kg")).toMatch(/Gy is kept as its own quantity \(absorbed dose\)/);
    expect(why(1, "J/kg", "Sv")).toMatch(/Sv is kept as its own quantity \(equivalent dose\)/);
  });
  it("“rad” is the radian here: rad → Gy names the dose symbol rd", () => {
    expect(why(1, "rad", "Gy")).toMatch(/“rad” here is the RADIAN \(an angle\)\. The absorbed-dose rad \(= 0\.01 Gy exactly\) is written “rd”/);
    near(convert(Math.PI, "rad", "°"), 180); // the radian is untouched
  });
});

describe("catalytic activity, magnetic flux, solid angle", () => {
  it("1 U = 1 µmol/min = 10⁻⁶/60 kat", () => {
    near(convert(1, "U", "µmol/min"), 1);
    near(convert(60, "U", "µkat"), 1);
    near(convert(1, "kat", "mol/s"), 1);
    near(convert(1, "nkat", "mU"), 60);
  });
  it("1 Mx = 10⁻⁸ Wb; Wb/m² is the tesla; Wb = V·s", () => {
    near(convert(1, "Mx", "Wb"), 1e-8);
    near(convert(1, "Wb/m^2", "T"), 1);
    near(convert(1, "V*s", "Wb"), 1);
    near(convert(1, "maxwell", "µWb"), 0.01);
  });
  it("1 sr = 1 rad²; a square degree is (π/180)² sr", () => {
    near(convert(1, "deg^2", "sr"), (Math.PI / 180) ** 2);
    near(convert(1, "sr", "rad^2"), 1);
    expect(convert(1, "cd*sr", "lm")).toBeNull(); // the photometry separation stands
  });
});

describe("week and the Julian year", () => {
  it("1 week = 7 d = 604 800 s; 1 Julian year = 365.25 d = 31 557 600 s", () => {
    near(convert(1, "week", "day"), 7);
    near(convert(2, "wk", "h"), 336);
    near(convert(1, "Julian year", "day"), 365.25);
    near(convert(1, "julianyear", "s"), 31557600);
    near(convert(1, "julian-year", "week"), 365.25 / 7);
  });
  it("a bare year is refused by name, from either side", () => {
    expect(why(1, "year", "day")).toMatch(/“year” does not say which year: a common year is 365 d, the Gregorian 365\.2425 d, the Julian 365\.25 d/);
    expect(why(5, "day", "yr")).toMatch(/“yr” does not say which year/);
    expect(why(1, "km/year", "m/s")).toMatch(/Write “Julian year”/);
  });
  it("the ampere is not caught by the year refusal", () => {
    expect(unitRefusal("A", "s")).toBeNull();
    expect(why(1, "A", "s")).toMatch(/is not compatible with s/);
  });
});

describe("units-aware Solve: the new short keys are disclosed, never silent", () => {
  it("P read as the poise carries the ambiguity caveat", () => {
    const r = solveWithUnits("F = k*x\nk = 2 P\nx = 3");
    expect(r).not.toBeNull();
    expect(r!.caveats.join(" ")).toMatch(/"2 P" for k was read as the poise \(a dynamic viscosity, 0\.1 Pa·s\)/);
    expect(r!.value).toBeCloseTo(0.6, 12); // 2 P = 0.2 Pa·s, times 3
  });
  it("P as a variable of the system is left to the plain system path", () => {
    expect(solveWithUnits("W = P*t\nP = 5 W\nt = 3 s")?.refusal ?? "").not.toMatch(/poise/);
  });
  it("a dose result is named in Gy, never as a raw dim key", () => {
    const r = solveWithUnits("D = d*n\nd = 2 mGy\nn = 3");
    expect(r).not.toBeNull();
    expect(r!.unit).toBe("Gy");
    expect(r!.value).toBeCloseTo(0.006, 12);
  });
});
