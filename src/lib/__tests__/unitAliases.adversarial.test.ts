// Alias collisions, pinned BOTH WAYS (docs/SCOPE-AUDIO-VIDEO-2026-10.md §E2/§E4).
//
// Alias lookup falls back to a LOWERCASED key, so every new alias is a chance
// to capture a different unit that differs only in case. The history: "Nm"
// (newton-metre) once became 1852 m and "KN" became knots. Each pair below is
// checked from both sides — the intended reading works AND the neighbour does
// not fall into it.

import { convert, parseMeasured } from "../units";
import { solveWithUnits } from "../unitSolve";

const refused = (text: string, target: string): boolean => "error" in parseMeasured(text, target);

describe("nm (nanometre) vs Nm (newton-metre) vs nmi (nautical mile)", () => {
  it("nm is the nanometre", () => {
    expect(convert(1, "nm", "m")).toBe(1e-9);
  });
  it("Nm is never a length", () => {
    expect(convert(1, "Nm", "m")).toBeNull();
    expect(convert(1, "Nm", "nmi")).toBeNull();
  });
  it("the newton-metre is written N*m and is a torque/energy", () => {
    expect(convert(1, "N*m", "J")).toBe(1);
  });
});

describe("KN is not knots", () => {
  it("KN does not resolve to the knot", () => {
    expect(convert(1, "KN", "kt")).toBeNull();
  });
  it("kN is the kilonewton", () => {
    expect(convert(1, "kN", "N")).toBe(1000);
  });
});

describe("Mbps (megabits/s) vs MBps (megabytes/s) — the 8× trap", () => {
  it("Mbps is 10⁶ bit/s", () => {
    expect(convert(1, "Mbps", "bit/s")).toBe(1e6);
  });
  it("MBps is 8 × 10⁶ bit/s, NEVER 10⁶", () => {
    expect(convert(1, "MBps", "bit/s")).toBe(8e6);
  });
  it("kBps is bytes too; KBps is its capital-K spelling", () => {
    expect(convert(1, "kBps", "bit/s")).toBe(8000);
    expect(convert(1, "KBps", "bit/s")).toBe(8000);
  });
  it("Kbps (capital K) is kilobits, like kbps", () => {
    expect(convert(1, "Kbps", "bit/s")).toBe(1000);
  });
  it("no all-lowercase or all-caps data-rate spelling resolves by case folding", () => {
    // These would have to guess between bits and bytes.
    for (const u of ["mbps", "MBPS", "KBPS", "GBPS", "gbps"]) expect(convert(1, u, "bit/s")).toBeNull();
  });
  it("the size units keep their KB/kb rule", () => {
    expect(convert(1, "KB", "bit")).toBe(8000);
    expect(convert(1, "kbit", "bit")).toBe(1000);
  });
});

describe("fL (femtolitre) vs ftL (foot-lambert)", () => {
  it("fL is a volume — the haematology unit (MCV ≈ 90 fL)", () => {
    expect(convert(90, "fL", "µL")).toBeCloseTo(9e-8, 20);
    expect(convert(1, "fL", "µm^3")).toBeCloseTo(1, 12);
  });
  it("fL is never a luminance", () => {
    expect(convert(1, "fL", "nit")).toBeNull();
    expect(refused("14 fL", "nit")).toBe(true);
  });
  it("ftL is never a volume", () => {
    expect(convert(1, "ftL", "L")).toBeNull();
    expect(convert(1, "ftL", "nit")).toBe(3.4262590996353905);
  });
  it("no case-folded spelling reaches either", () => {
    for (const u of ["FL", "fl", "FTL", "ftl", "Ftl"]) expect(convert(1, u, "nit")).toBeNull();
  });
});

describe("foot-candle (illuminance) vs foot-lambert (luminance) are not crossed", () => {
  it("footcandle is never a luminance and footlambert never an illuminance", () => {
    expect(convert(1, "footcandle", "nit")).toBeNull();
    expect(convert(1, "fc", "nit")).toBeNull();
    expect(convert(1, "footlambert", "lx")).toBeNull();
    expect(convert(1, "ftL", "lx")).toBeNull();
  });
  it("fc and nit stay apart even through lm/cd (the photometric refusals hold)", () => {
    expect(convert(1, "fc", "cd/m^2")).toBeNull();
    expect(convert(1, "lx", "nit")).toBeNull();
  });
});

describe("mPa (millipascal) vs MPa (megapascal) — 10⁹ apart", () => {
  it("each is itself", () => {
    expect(convert(1, "mPa", "Pa")).toBe(1e-3);
    expect(convert(1, "MPa", "Pa")).toBe(1e6);
    expect(convert(1, "µPa", "Pa")).toBe(1e-6);
  });
  it("no case-folded spelling resolves", () => {
    for (const u of ["mpa", "MPA", "Mpa"]) expect(convert(1, u, "Pa")).toBeNull();
  });
});

describe("mHz (millihertz) vs MHz (megahertz)", () => {
  it("MHz is the megahertz; mHz is not silently mapped to it", () => {
    expect(convert(1, "MHz", "Hz")).toBe(1e6);
    for (const u of ["mhz", "MHZ", "Mhz"]) expect(convert(1, u, "Hz")).toBeNull();
  });
  it("the kHz case variants are safe: no millihertz sibling folds onto them", () => {
    for (const u of ["KHz", "khz", "KHZ", "kHZ"]) expect(convert(1, u, "Hz")).toBe(1000);
    expect(convert(1, "hz", "Hz")).toBe(1);
    expect(convert(1, "HZ", "Hz")).toBe(1);
  });
});

describe("case variants of every new default (and the merges that must NOT happen)", () => {
  it("fps / nit variants", () => {
    for (const u of ["fps", "FPS", "Fps", "fPS"]) expect(convert(30, u, "Hz")).toBe(30);
    for (const u of ["nit", "NIT", "Nit", "nits", "Nits", "NITS"]) expect(convert(1, u, "cd/m^2")).toBe(1);
  });
  it("lookup is NOT case-insensitive on canonical keys: mS/MS, mW/MW stay distinct", () => {
    expect(convert(1, "mW", "W")).toBe(1e-3);
    expect(convert(1, "MW", "W")).toBe(1e6);
    expect(convert(1, "mS", "S")).toBe(1e-3);
    expect(convert(1, "MS", "S")).toBeNull(); // there is no megasiemens key, and it must not fold to mS
    expect(convert(1, "pW", "W")).toBe(1e-12);
    expect(convert(1, "PW", "W")).toBeNull();
    expect(convert(1, "nW", "W")).toBe(1e-9);
    expect(convert(1, "NW", "W")).toBeNull();
  });
});

describe("S is the siemens — sample rates are written in Hz", () => {
  it("kS/s and MS/s are not sample rates", () => {
    expect(convert(1, "kS/s", "Hz")).toBeNull();
    expect(convert(1, "MS/s", "Hz")).toBeNull();
    expect(refused("96 kS/s", "Hz")).toBe(true);
  });
  it("S/s is a conductance rate, never a frequency", () => {
    expect(convert(1, "S/s", "Hz")).toBeNull();
  });
});

describe("fs: femtosecond as a unit, sample rate as a Solve symbol", () => {
  it("2 fs is two femtoseconds", () => {
    expect(convert(2, "fs", "s")).toBeCloseTo(2e-15, 30);
  });
  it("N = fs*t with fs = 48 kHz is 96000 samples, not 10⁻¹⁵ s", () => {
    const r = solveWithUnits("N = fs*t\nfs = 48 kHz\nt = 2 s")!;
    expect(r.value).toBe(96000);
    expect(r.unit).toBe("");
  });
  it("fps is frames per second, not feet per second (ft/s stays the speed)", () => {
    expect(convert(1, "fps", "Hz")).toBe(1);
    expect(convert(1, "fps", "m/s")).toBeNull();
    expect(convert(1, "ft/s", "m/s")).toBeCloseTo(0.3048, 12);
  });
});

describe("fc: the foot-candle as a unit never captures the cutoff-frequency symbol", () => {
  it("f = 1/(2πRC) solves with R and C as symbols", () => {
    const r = solveWithUnits("f = 1/(2*pi*R*C)\nR = 8 ohm\nC = 10 uF")!;
    expect(r.refusal).toBeUndefined();
    expect(r.value).toBeCloseTo(1 / (2 * Math.PI * 8 * 10e-6), 6);
    expect(r.unit).toBe("1/s");
  });
  it("fc on the LEFT of = is a symbol: fc = 1/(2πRC) gives the same frequency", () => {
    const r = solveWithUnits("fc = 1/(2*pi*R*C)\nR = 8 ohm\nC = 10 uF")!;
    expect(r.unknown).toBe("fc");
    expect(r.value).toBeCloseTo(1 / (2 * Math.PI * 8 * 10e-6), 6);
  });
  it("fc as a KNOWN symbol is a symbol too", () => {
    const r = solveWithUnits("w = 2*pi*fc\nfc = 1000 Hz")!;
    expect(r.value).toBeCloseTo(2000 * Math.PI, 9);
  });
  it("'fL = 2 fL' — fL is a variable in this system, so it is never read as a femtolitre", () => {
    expect(solveWithUnits("fH = 8*fL\nfL = 2 fL")).toBeNull(); // left to the plain system path
    expect(solveWithUnits("y = fc*k\nfc = 3 fc\nk = 2")).toBeNull();
    expect(solveWithUnits("G = S*k\nS = 2 S\nk = 3")).toBeNull();
  });
  it("'f1 = 3 fc' with no fc variable IS read as foot-candles, and says so by name", () => {
    const r = solveWithUnits("f2 = k*f1\nk = 2\nf1 = 3 fc")!;
    expect(r.namedUnit).toBe("lx");
    expect(r.caveats.join(" ")).toMatch(/read as the foot-candle.*If fc is meant as a symbol/);
  });
  it("a genuine foot-candle illuminance known still converts (E·A = Φ)", () => {
    const r = solveWithUnits("Phi = E*A\nE = 50 fc\nA = 10 m^2")!;
    expect(r.refusal).toBeUndefined();
    expect(r.value).toBeCloseTo(5381.955208354861, 9); // lm
    expect(r.unit).toBe("lm");
  });
  it("the restriction is to the AMBIGUOUS keys: F = m a with m (mass) and m (metre) still works", () => {
    const r = solveWithUnits("F = m*a\nm = 3 kg\na = 2 m/s^2")!;
    expect(r.value).toBe(6);
    expect(r.namedUnit).toBe("N");
  });
});

describe("FC and the decibar (review pins)", () => {
  it("50 FC = 538.2 lx; 'Fc'/'fC' do not fold (no lowercase alias)", () => {
    expect(convert(50, "FC", "lx")).toBeCloseTo(538.1955208354861, 9);
    expect(convert(1, "fC", "lx")).toBeNull();
  });
  it("dbar is the decibar (10 kPa), never a logarithmic level", () => {
    expect(convert(2, "dbar", "Pa")).toBe(20000);
    expect(convert(1, "decibar", "kPa")).toBe(10);
    expect(parseMeasured("2 dbar", "Pa")).toMatchObject({ inTarget: 20000 });
    expect(convert(1, "dB", "Pa")).toBeNull();
  });
});

describe("mired, EV, f-stops and dB are NEVER units (the converter is linear) — §E4", () => {
  it("mired", () => {
    expect(convert(1, "mired", "K")).toBeNull();
    expect(convert(1, "MK^-1", "K^-1")).toBeNull(); // M is molarity, so this is mol·L⁻¹·K⁻¹
    expect(refused("150 mired", "K")).toBe(true);
  });
  it("M K^-1 spaced is molarity per kelvin, never mega-per-kelvin", () => {
    expect(convert(1, "M K^-1", "mol/m^3/K")).toBe(1000);
  });
  it("EV and stops", () => {
    expect(convert(1, "EV", "lx")).toBeNull();
    expect(convert(1, "stop", "EV")).toBeNull();
    // eV is the electronvolt and must stay an energy
    expect(convert(1, "eV", "J")).toBeCloseTo(1.602176634e-19, 30);
  });
  it("dB in any spelling", () => {
    for (const u of ["dB", "db", "DB", "dBFS", "dBu", "dBV", "dBm"]) expect(convert(1, u, "Pa")).toBeNull();
  });
});

describe("shutter-speed spellings photographers type", () => {
  it('4" (the camera display for 4 s) is refused rather than read as inches', () => {
    expect(refused('4"', "s")).toBe(true);
  });
  it("1/125 is a fraction, 1/125 s a time, 125 a bare number", () => {
    expect(parseMeasured("1/125", "s")).toMatchObject({ inTarget: 0.008 });
    expect(parseMeasured("125", "s")).toMatchObject({ inTarget: 125, assumed: true });
  });
  it("a fraction in a frequency field is still a fraction", () => {
    expect(parseMeasured("1/2 kHz", "Hz")).toMatchObject({ inTarget: 500 });
  });
  it("the e-notation numerator is not mistaken for a fraction numerator", () => {
    expect(refused("1e3/2 s", "s")).toBe(true);
  });
});
