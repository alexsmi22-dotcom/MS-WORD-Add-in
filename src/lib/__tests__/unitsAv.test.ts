// Audio/video/light units, v2.140.0 (docs/SCOPE-AUDIO-VIDEO-2026-10.md §C0).
//
// Every default string the new Audio, Video and Light calculators ship is
// read through parseMeasured — the path whose failure inserts NOTHING. The
// §C0 probe found 13 of 57 failing; this file pins the whole table so a later
// units edit cannot silently break a default.

import { convert, parseMeasured, parseCompoundUnit } from "../units";
import { solveWithUnits, dimsToUnit } from "../unitSolve";

type Ok = { value: number; unit: string; inTarget: number; assumed: boolean };

function ok(text: string, target: string): Ok {
  const r = parseMeasured(text, target);
  if ("error" in r) throw new Error(`${text} → ${target}: ${r.error}`);
  return r;
}

function err(text: string, target: string): string {
  const r = parseMeasured(text, target);
  if (!("error" in r)) throw new Error(`${text} → ${target} was accepted as ${r.inTarget}`);
  return r.error;
}

describe("§C0 default strings — every row parses to its SI target", () => {
  const rows: Array<[string, string, number]> = [
    ["44.1 kHz", "Hz", 44100],
    ["48 kHz", "Hz", 48000],
    ["20 kHz", "Hz", 20000],
    ["2.5 kHz", "Hz", 2500],
    ["25", "fps", 25],
    ["29.97 fps", "fps", 29.97],
    ["5 Mbit/s", "bit/s", 5e6],
    ["8 Mbit/s", "bit/s", 8e6],
    ["100 Mbit/s", "bit/s", 1e8],
    ["5 MB", "B", 5e6],
    ["128 GB", "B", 128e9],
    ["1000 nits", "nit", 1000],
    ["1000 Nits", "nit", 1000],
    ["500 Lux", "lx", 500],
    ["500 LUX", "lx", 500],
    ["800 Lumens", "lm", 800],
    ["800 lm", "lm", 800],
    ["1000 cd", "cd", 1000],
    ["0.008 s", "s", 0.008],
    ["10 ms", "s", 0.01],
    ["41.667 ms", "s", 0.041667],
    ["60 s", "s", 60],
    ["1 h", "s", 3600],
    ["5 m", "m", 5],
    ["16.4 ft", "m", 16.4 * 0.3048],
    ["50 mm", "m", 0.05],
    ["0.03 mm", "m", 0.00003],
    ["200 m³", "m^3", 200],
    ["240 m²", "m^2", 240],
    ["1 m^2", "m^2", 1],
    ["10 m^2", "m^2", 10],
    ["2.5 mm²", "m^2", 2.5e-6],
    ["343 m/s", "m/s", 343],
    ["8 Ω", "Ω", 8],
    ["8 ohms", "Ω", 8],
    ["8 Ohm", "Ω", 8],
    ["0.02 Ω", "Ω", 0.02],
    ["100 W", "W", 100],
    ["2.83 V", "V", 2.83],
    ["3200 K", "K", 3200],
    ["20 °C", "K", 293.15],
    ["320 kbit/s", "bit/s", 320000],
    ["997 Hz", "Hz", 997],
    ["36 mm", "m", 0.036],
    ["48 s^-1", "Hz", 48],
    // ---- the 13 that FAILED on 2026-10-14 ----
    ["29.97 FPS", "fps", 29.97],
    ["30 Fps", "fps", 30],
    ["48 KHz", "Hz", 48000],
    ["48 khz", "Hz", 48000],
    ["5 Mbps", "bit/s", 5e6],
    ["320 kbps", "bit/s", 320000],
    ["320 Kbps", "bit/s", 320000],
    ["1000 NIT", "nit", 1000],
    ["50 fc", "lx", 50 / (0.3048 * 0.3048)],
    ["14 ftL", "nit", 14 / (Math.PI * 0.3048 * 0.3048)],
    ["20 µPa", "Pa", 20e-6],
    ["1 pW", "W", 1e-12],
    ["1/125 s", "s", 0.008],
    ["5 1/s", "Hz", 5],
  ];
  it.each(rows)("%s → %s", (text, target, want) => {
    const r = ok(text, target);
    expect(Math.abs(r.inTarget - want) / Math.abs(want)).toBeLessThan(1e-9);
  });

  it("angles parse (display goes through engNum: 15° is 14.999999999999998 in float)", () => {
    expect(ok("15°", "°").inTarget).toBeCloseTo(15, 12);
    expect(ok("30 deg", "°").inTarget).toBeCloseTo(30, 12);
    expect(ok("180°", "°").inTarget).toBeCloseTo(180, 12);
    expect(ok("180 deg", "°").inTarget).toBeCloseTo(180, 12);
  });

  it("'20 C' stays refused — C is the coulomb, never ship it as a temperature default", () => {
    expect(err("20 C", "K")).toMatch(/not compatible/);
  });

  it("the extra acoustic units: nW, mPa, and µPa in its ASCII and Greek-mu spellings", () => {
    expect(ok("1 nW", "W").inTarget).toBeCloseTo(1e-9, 20);
    expect(ok("20 mPa", "Pa").inTarget).toBeCloseTo(0.02, 15);
    expect(ok("20 uPa", "Pa").inTarget).toBeCloseTo(20e-6, 18);
    // U+03BC (Greek small mu) is what most keyboards and PDFs produce; the
    // tables are keyed on U+00B5 (micro sign). They look identical.
    expect(ok("20 μPa", "Pa").inTarget).toBeCloseTo(20e-6, 18);
    expect(ok("8 Ω", "Ω").inTarget).toBe(8); // OHM SIGN → Greek capital omega
  });
});

describe("exact US photometric factors (derived from ft = 0.3048 m, never retyped)", () => {
  it("1 fc = 10.763910416709722 lx and 1 ftL = 3.4262590996353905 cd/m² [X]", () => {
    expect(convert(1, "fc", "lx")).toBe(10.763910416709722);
    expect(convert(1, "ftL", "nit")).toBe(3.4262590996353905);
    expect(convert(1, "fc", "lm/ft^2")).toBeCloseTo(1, 12);
    expect(convert(1, "ftL", "cd/ft^2")).toBeCloseTo(1 / Math.PI, 12);
  });
  it("14 ftL ≈ 48 cd/m², the SMPTE ST 431-1 cinema reference [X][P]", () => {
    expect(convert(14, "ftL", "nit")!).toBeCloseTo(47.9676, 4);
    expect(convert(48, "nit", "ftL")!).toBeCloseTo(14.0094, 4);
  });
  it("spelled-out names land on the right quantity", () => {
    expect(convert(1, "footcandle", "lx")).toBe(10.763910416709722);
    expect(convert(1, "foot-candles", "lx")).toBe(10.763910416709722);
    expect(convert(1, "footlambert", "nit")).toBe(3.4262590996353905);
    expect(convert(1, "foot-lambert", "nit")).toBe(3.4262590996353905);
  });
});

describe("data rates convert with the compounds", () => {
  it("Mbps ≡ Mbit/s, kbps ≡ kbit/s, MBps ≡ MB/s = 8 Mbit/s", () => {
    expect(convert(1, "Mbps", "Mbit/s")).toBeCloseTo(1, 12);
    expect(convert(320, "kbps", "kbit/s")).toBeCloseTo(320, 12);
    expect(convert(1, "Gbps", "bit/s")).toBe(1e9);
    expect(convert(1, "MBps", "Mbit/s")).toBeCloseTo(8, 12);
    expect(convert(1, "MBps", "MB/s")).toBeCloseTo(1, 12);
    expect(convert(1, "Gbit/s", "GB/h")).toBeCloseTo(450, 9);
    expect(convert(100, "Mbps", "GB/h")).toBeCloseTo(45, 9);
  });
  it("a rate is not a size", () => {
    expect(convert(1, "Mbps", "MB")).toBeNull();
    expect(convert(1, "Mbps", "Hz")).toBeNull();
  });
});

describe("the shutter-fraction reader and the 1/x numerator (same parse path, pinned together)", () => {
  it("leading simple fractions", () => {
    expect(ok("1/125 s", "s").inTarget).toBeCloseTo(0.008, 15);
    expect(ok("1/48 s", "s").inTarget).toBeCloseTo(1 / 48, 15);
    expect(ok("1 / 125 s", "s").inTarget).toBeCloseTo(0.008, 15);
    expect(ok("1/4 s", "s").inTarget).toBe(0.25);
    expect(ok("1/8000 s", "s").inTarget).toBeCloseTo(1.25e-4, 15);
    expect(ok("1/125", "s")).toMatchObject({ assumed: true, inTarget: 0.008 });
    expect(ok("1/125 ms", "s").inTarget).toBeCloseTo(8e-6, 15);
  });
  it("a whole number of seconds is not a fraction: '4 s' is 4, '1/4 s' is 0.25", () => {
    expect(ok("4 s", "s").inTarget).toBe(4);
    expect(ok("30 s", "s").inTarget).toBe(30);
  });
  it("5 1/s is 5 in the reciprocal unit — a space separates number and unit", () => {
    expect(ok("5 1/s", "Hz").inTarget).toBe(5);
    expect(ok("2 1/ms", "Hz").inTarget).toBeCloseTo(2000, 9);
    expect(ok("48 s^-1", "Hz").inTarget).toBe(48);
    expect(ok("48 s⁻¹", "Hz").inTarget).toBe(48);
  });
  it("refusals by name: zero denominator, a second slash, a mixed number, a bare slash", () => {
    expect(err("1/0 s", "s")).toMatch(/divides by zero/);
    expect(err("1/2/3 s", "s")).toMatch(/more than one slash/);
    expect(err("2 1/2 h", "s")).toMatch(/not a unit/);
    expect(err("51/s", "Hz")).toMatch(/not a unit/);
  });
  it("convert and parseCompoundUnit accept a 1/x numerator, and only that", () => {
    expect(convert(1, "1/s", "Hz")).toBe(1);
    expect(convert(1, "1/K", "K^-1")).toBe(1);
    expect(convert(1, "1/in", "m^-1")).toBeCloseTo(1 / 0.0254, 9);
    expect(convert(1, "1/(m*s)", "m^-1*s^-1")).toBe(1);
    expect(parseCompoundUnit("1")).toBeNull(); // "1" alone is not a unit
    expect(parseCompoundUnit("m/1")).toBeNull(); // nor is it a denominator
    expect(parseCompoundUnit("2/s")).toBeNull(); // only the numerator 1
  });
});

describe("decibels are NOT units — refused with a pointer to the level calculators (§E1)", () => {
  it.each(["dB", "dBu", "dBV", "dBFS", "dB SPL", "Np", "dBA"])("%s", (u) => {
    expect(convert(1, u, "Pa")).toBeNull();
    expect(convert(1, u, "V")).toBeNull();
    expect(err(`94 ${u}`, "Pa")).toMatch(/logarithmic level, not a unit.*Levels & references/);
  });
});

describe("units-aware Solve: named photometric units and the display round-trip", () => {
  it("E = Φ/A names lux; the base form is still shown", () => {
    const r = solveWithUnits("E = Phi/A\nPhi = 800 lm\nA = 10 ft^2")!;
    expect(r.namedUnit).toBe("lx");
    expect(r.unit).toBe("lm/m²");
    expect(r.value).toBeCloseTo(800 / (10 * 0.3048 * 0.3048), 9);
  });
  it("cd/m² is NOT named nit: E = I/d² is an illuminance with the same signature; a caveat says so", () => {
    for (const text of ["L = I/A\nI = 1000 cd\nA = 4 m^2", "E = I/d^2\nI = 1000 cd\nd = 2 m"]) {
      const r = solveWithUnits(text)!;
      expect(r.value).toBe(250);
      expect(r.namedUnit).toBeNull();
      expect(r.unit).toBe("cd/m²");
      expect(r.caveats.join(" ")).toMatch(/LUMINANCE it is the nit.*illuminance.*LUX/);
    }
  });
  it("every superscript digit prints, multi-digit too, and parses back: m⁶, m¹², s⁻¹⁰", () => {
    const six = solveWithUnits("y = a*b\na = 2 m^3\nb = 3 m^3")!;
    expect(six.unit).toBe("m⁶");
    expect(convert(1, six.unit, "m^6")).toBe(1);
    expect(dimsToUnit({ length: 12 })).toBe("m¹²");
    expect(convert(1, "m¹²", "m^12")).toBe(1);
    expect(dimsToUnit({ time: -10 })).toBe("1/s¹⁰");
    expect(convert(1, "s⁻¹⁰", "1/s^10")).toBe(1);
    for (let n = 1; n <= 19; n++) {
      expect(parseCompoundUnit(dimsToUnit({ length: n }))!.dims).toEqual({ length: n });
      expect(parseCompoundUnit(dimsToUnit({ time: -n }))!.dims).toEqual({ time: -n });
    }
  });
  it("a bare per-second result is still not force-named Hz, and now parses back", () => {
    const r = solveWithUnits("R = b*fs*ch\nb = 24\nfs = 48 kHz\nch = 2")!;
    expect(r.namedUnit).toBeNull();
    expect(r.unit).toBe("1/s");
    expect(r.value).toBe(2304000);
    expect(convert(r.value, r.unit, "Hz")).toBe(2304000);
  });
  it("a percentage known is a pure ratio, never the pseudo-unit 'frac'", () => {
    const r = solveWithUnits("P = eff*Q\neff = 90 %\nQ = 100 W")!;
    expect(r.value).toBeCloseTo(90, 12);
    expect(r.namedUnit).toBe("W");
    expect(r.unit).not.toContain("frac");
  });
  it("EVERY printed unit re-parses to the same dimensions (display is a contract)", () => {
    const shapes: Array<Record<string, number>> = [
      { mass: 1, length: 1, time: -2 },
      { mass: 1, length: -1, time: -2 },
      { mass: 1, length: 2, time: -2 },
      { mass: 1, length: 2, time: -3 },
      { current: 1, time: 1 },
      { mass: 1, length: 2, time: -3, current: -1 },
      { mass: 1, length: 2, time: -3, current: -2 },
      { luminousflux: 1, length: -2 },
      { luminousintensity: 1, length: -2 },
      { time: -1 },
      { time: -2 },
      { length: -1, time: -1 },
      { temp: -1 },
      { information: 1, time: -1 },
      { angle: 1, time: -1 },
      { amount: 1, length: -3 },
      { length: 0.5 },
      { mass: 1, temp: -1, length: -1 },
    ];
    for (const d of shapes) {
      const printed = dimsToUnit(d);
      const back = parseCompoundUnit(printed);
      expect({ printed, dims: back?.dims }).toEqual({ printed, dims: d });
      expect(back!.factor).toBeCloseTo(1, 12);
    }
  });
});
