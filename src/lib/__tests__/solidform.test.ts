import { claimText, dSpacing, dscEvents, parsePeakList, parseTable, peakRows, pickPeaks, tgaSteps, thermalText, WAVELENGTHS, type XY } from "../solidform";

const CU = WAVELENGTHS.CuKa1.a;

/** A deterministic noise source (LCG), so the synthetic patterns are the same every run. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32 - 0.5);
}

describe("Bragg's law", () => {
  test("NIST SRM 640 silicon: (111) at 28.442° 2θ with Cu Kα1 is d = a/√3 = 3.1357 Å", () => {
    const a = 5.43123;
    const d111 = a / Math.sqrt(3);
    const twoTheta = (2 * Math.asin(CU / (2 * d111)) * 180) / Math.PI;
    expect(twoTheta).toBeCloseTo(28.442, 2);
    expect(dSpacing(twoTheta, CU)).toBeCloseTo(d111, 6);
    expect(dSpacing(47.303, CU)).toBeCloseTo(a / Math.sqrt(8), 3); // (220)
  });
});

describe("peak picking from a measured pattern", () => {
  // Pseudo-Voigt peaks on a sloping background with noise, sampled every 0.02°.
  const truth = [
    { x: 5.21, h: 1000 },
    { x: 10.43, h: 420 },
    { x: 15.68, h: 760 },
    { x: 18.02, h: 150 },
    { x: 21.35, h: 90 },
    { x: 26.9, h: 300 },
  ];
  const rnd = noise(7);
  const pattern: XY[] = [];
  for (let x = 3; x <= 35; x += 0.02) {
    let y = 200 - 2 * x;
    for (const p of truth) {
      const w = 0.08;
      const g = Math.exp(-((x - p.x) ** 2) / (2 * w * w)), l = 1 / (1 + ((x - p.x) / w) ** 2);
      y += p.h * (0.6 * g + 0.4 * l);
    }
    pattern.push([Number(x.toFixed(2)), y + rnd() * 12]);
  }
  test("every true peak found within 0.02°, relative intensities within 6 points, nothing invented", () => {
    const r = pickPeaks(pattern, CU, { minRelative: 5 });
    expect(r.errors).toEqual([]);
    expect(r.peaks).toHaveLength(truth.length);
    truth.forEach((t, i) => {
      expect(Math.abs(r.peaks[i].twoTheta - t.x)).toBeLessThan(0.02);
      expect(Math.abs(r.peaks[i].rel - (t.h / 1000) * 100)).toBeLessThan(6);
      expect(r.peaks[i].d).toBeCloseTo(dSpacing(r.peaks[i].twoTheta, CU), 9);
    });
  });
  test("a higher threshold drops the weak peaks", () => {
    const r = pickPeaks(pattern, CU, { minRelative: 20 });
    expect(r.peaks.map((p) => Math.round(p.twoTheta))).toEqual([5, 10, 16, 27]);
  });
  test("bad data is refused by name", () => {
    expect(pickPeaks([[5, 1], [6, 2]], CU).errors.join(" ")).toMatch(/Too few points/);
    expect(pickPeaks(Array.from({ length: 20 }, (_, i) => [i * 20, 1] as XY), CU).errors.join(" ")).toMatch(/between 0 and 180/);
    expect(pickPeaks(Array.from({ length: 20 }, (_, i) => [5 + Math.floor(i / 2), i] as XY), CU).errors.join(" ")).toMatch(/same angle/);
  });
});

describe("peak lists, the table and the claim text", () => {
  test("a typed list with intensities", () => {
    const r = parsePeakList("5.2 100\n10.4 45\n15.6 80\n20.1 12", CU);
    expect(r.errors).toEqual([]);
    expect(peakRows(r.peaks)).toEqual([["5.2", "16.98", "100"], ["10.4", "8.50", "45"], ["15.6", "5.68", "80"], ["20.1", "4.41", "12"]]);
  });
  test("comma-separated angles, no intensities", () => {
    const r = parsePeakList("5.2, 10.4, 15.6", CU);
    expect(r.peaks.map((p) => p.twoTheta)).toEqual([5.2, 10.4, 15.6]);
    expect(peakRows(r.peaks)[0][2]).toBe("—");
  });
  test("the strongest peaks cited, by angle, with the tolerance and the radiation", () => {
    const r = parsePeakList("5.2 100\n10.4 45\n15.6 80\n20.1 12\n24.8 60", CU);
    const c = claimText(r.peaks, { count: 3, tolerance: 0.2, wavelength: "CuKa1", subject: "Crystalline Form A of compound 1" });
    expect(c.text).toBe("Crystalline Form A of compound 1, characterized by an X-ray powder diffraction pattern comprising peaks at 2θ angles of about 5.2°, 15.6° and 24.8° ± 0.2° 2θ, measured with Cu Kα1 radiation.");
  });
  test("peaks within twice the tolerance are said", () => {
    const r = parsePeakList("5.2 100\n5.5 90", CU);
    expect(claimText(r.peaks, { count: 2, tolerance: 0.2, wavelength: "CuKa1" }).notes.join(" ")).toMatch(/within 2 × ±0\.2°/);
  });
  test("bad entries are refused by name", () => {
    expect(parsePeakList("five", CU).errors.join(" ")).toMatch(/is not/);
    expect(parsePeakList("190", CU).errors.join(" ")).toMatch(/not a 2θ angle/);
    expect(parsePeakList("5.2\n5.2", CU).notes.join(" ")).toMatch(/merged/);
  });
});

describe("columns", () => {
  test("headers skipped and counted; tabs, commas, semicolons with decimal commas", () => {
    const r = parseTable("Angle\tCounts\n5.00\t120\n5.02\t125");
    expect(r.rows).toEqual([[5, 120], [5.02, 125]]);
    expect(r.header).toEqual(["Angle", "Counts"]);
    expect(r.notes.join(" ")).toMatch(/1 header line skipped/);
    expect(parseTable("5,00;120\n5,02;125").rows).toEqual([[5, 120], [5.02, 125]]);
    expect(parseTable("5.0,120\n5.02,125").rows).toEqual([[5, 120], [5.02, 125]]);
  });
  test("a stray line inside the data is said, never silently dropped", () => {
    expect(parseTable("5 1\n6 2\noops\n7 3").notes.join(" ")).toMatch(/left out: “oops”/);
  });
});

describe("DSC", () => {
  // A melting endotherm (down, "exo up") on a sloping baseline: a Gaussian at 158 °C, σ = 1.5 °C — its tangent onset is
  // exactly μ − 2σ = 155.0 °C (the steepest point of a Gaussian is at μ − σ).
  const pts: XY[] = [];
  for (let t = 100; t <= 200; t += 0.1) pts.push([Number(t.toFixed(1)), -0.002 * t - 5 * Math.exp(-((t - 158) ** 2) / (2 * 1.5 ** 2))]);
  test("onset by tangent intersection, peak, kind", () => {
    const r = dscEvents(pts, true);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe("endotherm");
    expect(r.events[0].peak).toBeCloseTo(158, 1);
    expect(r.events[0].onset).toBeCloseTo(155, 0);
    expect(thermalText("dsc", r)[0]).toMatch(/an endotherm with an onset at about 155\.\d °C and a peak at about 158\.0 °C/);
  });
  test("with endotherms up, the same dip is an exotherm", () => {
    expect(dscEvents(pts, false).events[0].kind).toBe("exotherm");
  });
});

describe("TGA", () => {
  // Two logistic steps: 5.0 % (water) centred at 90 °C and 40.0 % (decomposition) at 260 °C.
  const pts: XY[] = [];
  for (let t = 25; t <= 400; t += 0.5) pts.push([t, 100 - 5 / (1 + Math.exp(-(t - 90) / 4)) - 40 / (1 + Math.exp(-(t - 260) / 6))]);
  test("both steps, their losses to 0.3 points, the DTG peaks", () => {
    const r = tgaSteps(pts);
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0].loss).toBeCloseTo(5, 0);
    expect(Math.abs(r.steps[0].loss - 5)).toBeLessThan(0.3);
    expect(Math.abs(r.steps[1].loss - 40)).toBeLessThan(0.5);
    expect(r.steps[0].dtgPeak).toBeCloseTo(90, 0);
    expect(r.steps[1].dtgPeak).toBeCloseTo(260, 0);
    expect(thermalText("tga", r)[0]).toMatch(/a weight loss of about 5\.\d% between about/);
  });
  test("mg weights are read as a percentage of the first point, and said", () => {
    const r = tgaSteps(pts.map(([t, w]) => [t, (w / 100) * 3.2] as XY));
    expect(r.notes.join(" ")).toMatch(/% of the starting weight/);
    expect(Math.abs(r.steps[1].loss - 40)).toBeLessThan(0.5);
  });
});
