// Light & camera engines (docs/SCOPE-AUDIO-VIDEO-2026-10.md §B3, §D3):
// photometry.ts (illuminance, beams, screens, exposure, f-stops, depth of
// field, angle of view) and the colour-temperature additions in colourspace.ts.
//
// Oracle classes as in §D0: [X] exact identity, [L] colour-science 0.4.7,
// [P] published, [F] formula re-typed (NOT independent — each has an [X]/[P]
// landmark beside it).

import {
  LUX_PER_FOOTCANDLE,
  NIT_PER_FOOTLAMBERT,
  luxToFootcandle,
  footcandleToLux,
  nitToFootlambert,
  footlambertToNit,
  pointIlluminance,
  coneFlux,
  screenLuminance,
  exposureValue,
  shutterForEv,
  apertureForEv,
  evFromIlluminance,
  evFromLuminance,
  isoStops,
  fNumberExact,
  stopsBetween,
  depthOfField,
  angleOfView,
  PhotometryError,
} from "../photometry";
import {
  mired,
  miredShift,
  daylightXy,
  cctMcCamy,
  cctRobertson,
  MCCAMY_ERROR_K,
  ROBERTSON_ERROR_RELATIVE,
  daylightLocusFigure,
  planckianXy,
  ColourTempError,
} from "../colourspace";
import { convert } from "../units";

function okOf<T extends { ok: true }>(r: T | PhotometryError | ColourTempError): T {
  if (!r.ok) throw new Error(`unexpected refusal: ${r.error}`);
  return r;
}
function refusal(r: { ok: boolean; error?: string } | number): string {
  if (typeof r === "number") throw new Error(`expected a refusal, got ${r}`);
  if (r.ok) throw new Error("expected a refusal, got a result");
  return r.error!;
}
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe("§D3 unit pairs [X]", () => {
  it("1 fc = 10.763910416709722 lx; 1 ftL = 3.4262590996353905 cd/m²", () => {
    expect(LUX_PER_FOOTCANDLE).toBe(10.763910416709722);
    expect(NIT_PER_FOOTLAMBERT).toBe(3.4262590996353905);
    expect(footcandleToLux(1)).toBe(10.763910416709722);
    expect(footlambertToNit(1)).toBe(3.4262590996353905);
  });
  it("14 ftL = 47.9676 cd/m²; 48 cd/m² = 14.0094 ftL ([P] SMPTE ST 431-1 48 cd/m²)", () => {
    expect(footlambertToNit(14)).toBeCloseTo(47.9676, 4);
    expect(nitToFootlambert(48)).toBeCloseTo(14.0094, 4);
  });
  it("the engine's constants agree with the units converter exactly", () => {
    expect(convert(1, "fc", "lx")).toBe(LUX_PER_FOOTCANDLE);
    expect(convert(1, "ftL", "nit")).toBe(NIT_PER_FOOTLAMBERT);
    expect(luxToFootcandle(LUX_PER_FOOTCANDLE)).toBe(1);
  });
});

describe("point-source illuminance E = I·cosθ/d²", () => {
  it("1000 cd at 2 m: 250 lx at 0°, 216.5064 lx at 30° [X]", () => {
    expect(okOf(pointIlluminance(1000, 2, 0)).lux).toBe(250);
    const r = okOf(pointIlluminance(1000, 2, 30));
    expect(r.lux).toBeCloseTo(216.5064, 4);
    expect(r.normalLux).toBe(250);
    expect(r.footcandles).toBeCloseTo(216.50635094610968 / LUX_PER_FOOTCANDLE, 12);
  });
  it("inverse square: doubling the distance quarters it (log–log slope −2 in the figure)", () => {
    expect(okOf(pointIlluminance(1000, 4)).lux).toBe(62.5);
    const pts = okOf(pointIlluminance(1000, 2)).figure.series[0].points;
    const a = pts[0];
    const b = pts[pts.length - 1];
    expect(Math.log10(b.y / a.y) / Math.log10(b.x / a.x)).toBeCloseTo(-2, 12);
  });
  it("figure: log–log axes, the entered point on it, a second curve only when θ > 0", () => {
    const f0 = okOf(pointIlluminance(1000, 2)).figure;
    expect(f0.xScale).toBe("log");
    expect(f0.series.filter((s) => s.type === "line")).toHaveLength(1);
    const f30 = okOf(pointIlluminance(1000, 2, 30)).figure;
    expect(f30.series.filter((s) => s.type === "line")).toHaveLength(2);
    expect(f30.series.at(-1)!.points[0]).toEqual({ x: 2, y: okOf(pointIlluminance(1000, 2, 30)).lux });
  });
  it("refusals by name: grazing/behind angles, zero/negative distance, negative intensity", () => {
    expect(refusal(pointIlluminance(1000, 2, 90))).toMatch(/grazes/);
    expect(refusal(pointIlluminance(1000, 2, 120))).toMatch(/0° ≤ θ < 90°/);
    expect(refusal(pointIlluminance(1000, 2, -5))).toMatch(/0° ≤ θ < 90°/);
    expect(refusal(pointIlluminance(1000, 0))).toMatch(/distance must be greater than zero/);
    expect(refusal(pointIlluminance(-1, 2))).toMatch(/intensity/);
    expect(refusal(pointIlluminance(1000, NaN))).toMatch(/finite/);
  });
});

describe("uniform cone Φ = I·Ω, Ω = 2π(1 − cos θ/2)", () => {
  it("1000 cd, 30° full: Ω 0.21409435 sr, 214.0943 lm [X]", () => {
    const r = okOf(coneFlux(1000, 30));
    expect(r.solidAngleSr).toBeCloseTo(0.21409435, 8);
    expect(r.lumens).toBeCloseTo(214.0943, 4);
    // the cancellation-free form agrees with the textbook form
    expect(rel(r.solidAngleSr, 2 * Math.PI * (1 - Math.cos((15 * Math.PI) / 180)))).toBeLessThan(1e-12);
  });
  it("isotropic 1000 cd = 4π·1000 = 12566.37 lm [X]", () => {
    expect(okOf(coneFlux(1000, 360)).lumens).toBeCloseTo(4000 * Math.PI, 9);
    expect(okOf(coneFlux(1000, 360)).lumens).toBeCloseTo(12566.37, 2);
  });
  it("a hemisphere is 2π sr", () => {
    expect(okOf(coneFlux(1, 180)).solidAngleSr).toBeCloseTo(2 * Math.PI, 12);
  });
  it("a very narrow beam keeps its precision (Ω ≈ π(θ/2)² for small θ)", () => {
    const θ = 1e-4; // degrees
    const half = ((θ / 2) * Math.PI) / 180;
    expect(rel(okOf(coneFlux(1, θ)).solidAngleSr, Math.PI * half * half)).toBeLessThan(1e-8);
  });
  it("states the uniform-beam assumption, and refuses impossible angles", () => {
    expect(okOf(coneFlux(1000, 30)).notes.join(" ")).toMatch(/UNIFORM INTENSITY/);
    expect(refusal(coneFlux(1000, 0))).toMatch(/0° < θ ≤ 360°/);
    expect(refusal(coneFlux(1000, 361))).toMatch(/0° < θ ≤ 360°/);
  });
});

describe("screen luminance L = E·gain/π", () => {
  it("5000 lm on 10 m², gain 1: 159.1549 cd/m², 46.4515 ftL [X]", () => {
    const r = okOf(screenLuminance(5000, 10, 1));
    expect(r.lux).toBe(500);
    expect(r.nits).toBeCloseTo(159.1549, 4);
    expect(r.footlamberts).toBeCloseTo(46.4515, 4);
    expect(r.ofCinemaReference).toBeCloseTo(159.15494309189535 / 48, 12);
  });
  it("gain scales on-axis luminance linearly", () => {
    expect(okOf(screenLuminance(5000, 10, 1.5)).nits).toBeCloseTo(1.5 * 500 / Math.PI, 12);
  });
  it("never writes the foot-lambert as fL", () => {
    const text = okOf(screenLuminance(5000, 10)).notes.join(" ");
    expect(text).toMatch(/never fL/);
    expect(text).not.toMatch(/\d fL\b/);
  });
  it("refuses zero or negative inputs by name", () => {
    expect(refusal(screenLuminance(5000, 0))).toMatch(/screen area/);
    expect(refusal(screenLuminance(5000, 10, 0))).toMatch(/screen gain/);
    expect(refusal(screenLuminance(-1, 10))).toMatch(/luminous flux/);
  });
});

describe("exposure value EV = log₂(N²/t) and the ISO 2720 meter equations", () => {
  it("f/8 1/125 = 12.96578; f/16 1/125 = 14.96578 [X]", () => {
    expect(okOf(exposureValue(8, 1 / 125)).evSettings).toBeCloseTo(12.96578, 5);
    expect(okOf(exposureValue(16, 1 / 125)).evSettings).toBeCloseTo(14.96578, 5);
  });
  it("EV 0 at ISO 100: incident 2.5 lx (C 250), reflected 0.125 cd/m² (K 12.5) [X]", () => {
    const r = okOf(exposureValue(1, 1, 100));
    expect(r.evSettings).toBe(0);
    expect(r.incidentLux).toBe(2.5);
    expect(r.reflectedNit).toBe(0.125);
  });
  it("same settings at ISO 200 suit a scene one stop darker: EV₁₀₀ − 1 and HALF the lux", () => {
    const a = okOf(exposureValue(8, 1 / 125, 100));
    const b = okOf(exposureValue(8, 1 / 125, 200));
    expect(b.evSettings).toBe(a.evSettings);
    expect(b.ev100).toBeCloseTo(a.ev100 - 1, 12);
    expect(b.incidentLux).toBeCloseTo(a.incidentLux / 2, 9);
  });
  it("long exposures give zero or negative EV without refusal: f/2 4 s = 0, f/1.4 30 s < 0", () => {
    expect(okOf(exposureValue(2, 4)).evSettings).toBe(0);
    expect(okOf(exposureValue(1.4, 30)).evSettings).toBeLessThan(-3.9);
    expect(okOf(exposureValue(2, 0.25)).evSettings).toBe(4); // "1/4 s" is not "4 s"
  });
  it("extreme but real exposures stay finite: 1/32000 s at f/32, and a 1-hour astro exposure", () => {
    const fast = okOf(exposureValue(32, 1 / 32000));
    expect(fast.evSettings).toBeCloseTo(Math.log2(1024 * 32000), 9);
    const slow = okOf(exposureValue(2.8, 3600, 6400));
    expect(Number.isFinite(slow.ev100)).toBe(true);
    expect(slow.ev100).toBeLessThan(-12);
  });
  it("inverses round-trip: shutter and aperture for an EV, EV from lux and from luminance", () => {
    expect(shutterForEv(12.965784284662087, 8) as number).toBeCloseTo(1 / 125, 12);
    expect(apertureForEv(12.965784284662087, 1 / 125) as number).toBeCloseTo(8, 12);
    expect(evFromIlluminance(2.5, 100, 250)).toBe(0);
    expect(evFromLuminance(0.125, 100, 12.5)).toBe(0);
    const r = okOf(exposureValue(5.6, 1 / 60, 400));
    expect(evFromIlluminance(r.incidentLux, 400) as number).toBeCloseTo(r.evSettings, 12);
  });
  it("ISO stops: 100 → 400 is +2", () => {
    expect(isoStops(100, 400)).toBe(2);
    expect(isoStops(400, 100)).toBe(-2);
  });
  it("refusals by name: f-numbers below f/0.5, zero shutter, zero ISO, an EV needing an impossible aperture", () => {
    expect(refusal(exposureValue(0.3, 1))).toMatch(/impossible in air/);
    expect(refusal(exposureValue(8, 0))).toMatch(/shutter time/);
    expect(refusal(exposureValue(8, 1 / 125, 0))).toMatch(/ISO speed/);
    expect(refusal(exposureValue(8, 1 / 125, 100, 0))).toMatch(/constant C/);
    expect(refusal(apertureForEv(-20, 1 / 1000))).toMatch(/below f\/0.5/);
    expect(refusal(exposureValue(8, Infinity))).toMatch(/finite/);
  });
  it("figure: the entered settings sit on the reciprocity line", () => {
    const r = okOf(exposureValue(8, 1 / 125, 100));
    const line = r.figure.series[0].points;
    const mark = r.figure.series[1].points[0];
    expect(mark).toEqual({ x: r.ev100, y: 1 / 125 });
    // the line at x = ev100 passes through t = 1/125: check by interpolation in log t
    const i = line.findIndex((p) => p.x > r.ev100);
    const [p, q] = [line[i - 1], line[i]];
    const logT = Math.log2(p.y) + ((Math.log2(q.y) - Math.log2(p.y)) * (r.ev100 - p.x)) / (q.x - p.x);
    expect(Math.pow(2, logT)).toBeCloseTo(1 / 125, 12);
    expect(r.figure.yScale).toBe("log");
  });
});

describe("f-stop arithmetic: exact √2 powers vs engraved markings", () => {
  it("f/5.6 = 5.656854, f/11 = 11.313708 [X]", () => {
    expect(okOf(fNumberExact(5.6)).exact).toBeCloseTo(5.656854, 6);
    expect(okOf(fNumberExact(11)).exact).toBeCloseTo(11.313708, 6);
    expect(okOf(fNumberExact(5.6, "full")).exact).toBeCloseTo(4 * Math.SQRT2, 12);
  });
  it("stops f/4 → f/11: nominal 2.9189, exact 3.0000 [X]", () => {
    const r = okOf(stopsBetween(4, 11));
    expect(r.nominalStops).toBeCloseTo(2.9189, 4);
    expect(r.exactStops).toBeCloseTo(3, 12);
    expect(r.lightRatio).toBeCloseTo(8, 9);
  });
  it("every standard third-stop marking is recognised (f/1.2 by its named convention)", () => {
    const thirds = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32];
    thirds.forEach((m, i) => {
      const r = okOf(fNumberExact(m, "third"));
      expect({ m, onScale: r.onScale }).toEqual({ m, onScale: true });
      expect(r.stopsFromF1).toBeCloseTo(i / 3, 12);
    });
  });
  it("every half-stop marking is recognised on the half scale", () => {
    const halves = [1, 1.2, 1.4, 1.7, 2, 2.4, 2.8, 3.3, 4, 4.8, 5.6, 6.7, 8, 9.5, 11, 13, 16, 19, 22];
    halves.forEach((m, i) => {
      const r = okOf(fNumberExact(m, "half"));
      expect({ m, onScale: r.onScale }).toEqual({ m, onScale: true });
      expect(r.stopsFromF1).toBeCloseTo(i / 2, 12);
    });
  });
  it("half-stop markings are NOT snapped onto the wrong third-stop position", () => {
    for (const m of [1.7, 2.4, 3.3, 4.8, 6.7, 9.5]) {
      const r = okOf(fNumberExact(m, "third"));
      expect({ m, onScale: r.onScale, exact: r.exact }).toEqual({ m, onScale: false, exact: m });
    }
  });
  it("f/13 depends on the scale stated (12.70 as a third stop, 13.45 as a half stop)", () => {
    expect(okOf(fNumberExact(13, "third")).exact).toBeCloseTo(Math.pow(2, 22 / 6), 12);
    expect(okOf(fNumberExact(13, "half")).exact).toBeCloseTo(Math.pow(2, 15 / 4), 12);
  });
  it("an off-scale number (f/0.95) is used as typed and said so", () => {
    const r = okOf(fNumberExact(0.95));
    expect(r.onScale).toBe(false);
    expect(r.exact).toBe(0.95);
    expect(r.note).toMatch(/not a standard marking/);
  });
  it("refuses f-numbers below f/0.5", () => {
    expect(refusal(fNumberExact(0.4))).toMatch(/impossible in air/);
    expect(refusal(stopsBetween(4, 0.2))).toMatch(/impossible in air/);
  });
});

describe("depth of field (thin lens)", () => {
  // [F] textbook thin-lens formula — NOT independent of the engine. The [X]
  // landmarks beside it: H/2 is the near limit when focused at H, and the
  // harmonic-mean identity 2/s = 1/near + 1/far, which these near/far
  // formulas satisfy exactly for any s < H.
  it("50 mm, f/8, c 0.03 mm, s 5 m: H 10.4667 m; near 3.38937 m; far 9.52744 m [F]", () => {
    const r = okOf(depthOfField(0.05, 8, 0.00003, 5));
    expect(r.hyperfocalM).toBeCloseTo(10.4667, 4);
    expect(r.nearM).toBeCloseTo(3.38937, 5);
    expect(r.farM).toBeCloseTo(9.52744, 5);
    expect(r.totalM).toBeCloseTo(9.52744 - 3.38937, 4);
  });
  it("[X] focused at H the far limit is ∞ and the near limit is H/2", () => {
    const H = okOf(depthOfField(0.05, 8, 0.00003, 5)).hyperfocalM;
    const r = okOf(depthOfField(0.05, 8, 0.00003, H));
    expect(r.farM).toBe(Infinity);
    expect(r.nearM).toBeCloseTo(H / 2, 12);
    expect(r.totalM).toBe(Infinity);
  });
  it("beyond H the far limit is ∞ — never negative", () => {
    const r = okOf(depthOfField(0.05, 8, 0.00003, 50));
    expect(r.farM).toBe(Infinity);
    expect(r.nearM).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/far limit is infinity/);
  });
  it("[X] 1/near + 1/far = 2/s (the subject is the harmonic mean of the limits)", () => {
    for (const s of [0.5, 2, 5, 10]) {
      const r = okOf(depthOfField(0.05, 8, 0.00003, s));
      expect(1 / r.nearM + 1 / r.farM).toBeCloseTo(2 / s, 12);
    }
  });
  it("refuses a subject at or inside the focal length, by name", () => {
    expect(refusal(depthOfField(0.05, 8, 0.00003, 0.05))).toMatch(/not beyond the focal length/);
    expect(refusal(depthOfField(0.05, 8, 0.00003, 0.01))).toMatch(/no real image/);
    expect(refusal(depthOfField(0.05, 8, 0, 5))).toMatch(/circle of confusion/);
  });
  it("figure: the far-limit series never contains infinity, and the CoC is called a convention", () => {
    const r = okOf(depthOfField(0.05, 8, 0.00003, 5));
    for (const s of r.figure.series) for (const p of s.points) expect(Number.isFinite(p.y)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/convention, not a standard/);
  });
});

describe("angle of view 2·atan(d/2f)", () => {
  it("36 × 24 mm at 50 mm: 39.5978° horizontal, 46.7930° diagonal [X]", () => {
    const r = okOf(angleOfView(0.036, 0.05, 0.024));
    expect(r.horizontalDeg).toBeCloseTo(39.5978, 4);
    expect(r.diagonalDeg!).toBeCloseTo(46.793, 4);
    expect(r.verticalDeg!).toBeCloseTo((2 * Math.atan(0.24) * 180) / Math.PI, 12);
  });
  it("a width alone gives no diagonal", () => {
    expect(okOf(angleOfView(0.036, 0.05)).diagonalDeg).toBeNull();
  });
  it("refuses a zero focal length", () => {
    expect(refusal(angleOfView(0.036, 0))).toMatch(/focal length/);
  });
});

describe("colour temperature: mired (computed, never a unit)", () => {
  it("mired 3200 / 5600 / 6500 / 2856 = 312.5 / 178.5714 / 153.8462 / 350.1401 [X]", () => {
    expect(mired(3200)).toBe(312.5);
    expect(mired(5600) as number).toBeCloseTo(178.5714, 4);
    expect(mired(6500) as number).toBeCloseTo(153.8462, 4);
    expect(mired(2856) as number).toBeCloseTo(350.1401, 4);
  });
  it("3200 → 5600 is −133.9286 mired, a blue correction [X]", () => {
    const r = okOf(miredShift(3200, 5600));
    expect(r.shift).toBeCloseTo(-133.9286, 4);
    expect(r.direction).toBe("blue");
    expect(okOf(miredShift(5600, 3200)).direction).toBe("amber");
    expect(okOf(miredShift(5600, 5600)).direction).toBe("none");
  });
  it("refuses zero, negative and non-finite temperatures", () => {
    expect(refusal(mired(0))).toMatch(/above absolute zero/);
    expect(refusal(miredShift(-3200, 5600))).toMatch(/above absolute zero/);
    expect(refusal(mired(NaN))).toMatch(/finite/);
  });
});

describe("CIE D-series daylight chromaticity", () => {
  it("6504 K = (0.31271406, 0.32911910) [L]; D65 (0.3127, 0.3290) to 4 d.p. [P]", () => {
    const r = okOf(daylightXy(6504));
    expect(r.xy.x).toBeCloseTo(0.31271406, 8);
    expect(r.xy.y).toBeCloseTo(0.3291191, 7);
    expect(r.xy.x).toBeCloseTo(0.3127, 4);
  });
  it("5003 K = (0.34565305, 0.35859616) [L]; D50 (0.3457, 0.3585) [P]", () => {
    const r = okOf(daylightXy(5003));
    expect(r.xy.x).toBeCloseTo(0.34565305, 8);
    expect(r.xy.y).toBeCloseTo(0.35859616, 8);
  });
  it("the two polynomial branches meet at 7000 K (continuity to 1e-4)", () => {
    const below = okOf(daylightXy(7000)).xy.x;
    const above = okOf(daylightXy(7000.0001)).xy.x;
    expect(Math.abs(below - above)).toBeLessThan(1e-4);
  });
  it("the 6504-not-6500 note is given", () => {
    expect(okOf(daylightXy(6504)).notes.join(" ")).toMatch(/6504 K, not 6500 K/);
  });
  it("refuses outside 4000–25000 K, by name", () => {
    expect(refusal(daylightXy(3200))).toMatch(/4000 K to 25000 K/);
    expect(refusal(daylightXy(25001))).toMatch(/4000 K to 25000 K/);
    expect(okOf(daylightXy(4000)).xy.x).toBeGreaterThan(0.38);
    expect(okOf(daylightXy(25000)).xy.x).toBeLessThan(0.26);
  });
  // v2.140.0 fix round: 3200 K is no longer dropped — it is marked on the
  // Planckian locus (Robertson's table), and the drop/placement is reported.
  it("locus figure: every temperature is marked on the locus that defines it, plus sRGB", () => {
    const f = daylightLocusFigure([3200, 5600, 6504]);
    expect(f.series.map((s) => s.label)).toEqual(["sRGB gamut", "daylight locus", "Planckian locus", "entered temperatures"]);
    expect(f.series[3].points).toHaveLength(3);
    expect(f.onPlanckian).toEqual([3200]);
    expect(f.omitted).toEqual([]);
    expect(f.series[1].points.length).toBeGreaterThan(50);
    expect(daylightLocusFigure([500]).omitted).toEqual([500]);
    const g = daylightLocusFigure([], { x: 0.3127, y: 0.329 });
    expect(g.series[g.series.length - 1].label).toBe("entered chromaticity");
  });
  it("planckianXy against the CMF-integrated blackbody (colour-science) [L]", () => {
    // 3200 K blackbody: (0.4233629, 0.3989530); 2000 K: (0.5266810, 0.4132965).
    for (const [T, x, y] of [
      [3200, 0.4233629100363704, 0.3989529937899826],
      [2000, 0.5266809938314436, 0.41329645889543093],
      [6504, 0.3134651603652432, 0.32356915457724944],
    ]) {
      const p = planckianXy(T);
      expect(p.ok).toBe(true);
      if (p.ok) {
        expect(Math.abs(p.xy.x - x)).toBeLessThan(2e-3);
        expect(Math.abs(p.xy.y - y)).toBeLessThan(2e-3);
      }
    }
  });
});

// TRUE BLACKBODY chromaticities — the oracle independent of every CCT formula:
// colour-science 0.4.7 sd_blackbody(T) integrated with the CIE 1931 2°
// colour-matching functions, 360–830 nm at 1 nm. Beside each, colour-science's
// own McCamy and Robertson values for the same xy. [L]
const BLACKBODY: Array<[T: number, x: number, y: number, robertson: number]> = [
  [1667, 0.5650472960166701, 0.402740399571468, 1667.005874761731],
  [2000, 0.5266809938314436, 0.41329645889543093, 2000.0236558085114],
  [2700, 0.4598625797922523, 0.41059983787527204, 2699.901161540218],
  [2856, 0.44753864026831863, 0.4074293007499549, 2856.0749736191647],
  [3200, 0.4233629100363704, 0.3989529937899826, 3199.7971624419242],
  [4000, 0.38044236403037585, 0.3767485876116532, 4000.047100421351],
  [5000, 0.3451034310805278, 0.3516098503642987, 4999.983639879778],
  [6504, 0.3134651603652432, 0.32356915457724944, 6503.294454628685],
  [7500, 0.30033585913536565, 0.31026778903839664, 7499.447349105739],
  [10000, 0.2806344603603076, 0.2882888896111529, 9998.985433182774],
  [15000, 0.2637065853809278, 0.26727996015174144, 15007.912237700333],
  [25000, 0.2525209393740827, 0.2522208839262844, 24992.191793618902],
];
// colour-science McCamy on the in-band blackbody points (its own formula, [L]).
const MCCAMY_ORACLE: Array<[T: number, mccamy: number]> = [
  [2856, 2857.6156937662454],
  [3000, 3004.8618890558605],
  [3200, 3207.942657997746],
  [3500, 3509.9374223228797],
  [4000, 4008.843715742514],
  [4500, 4505.712268702916],
  [5000, 5002.898941405354],
  [5500, 5501.17708342676],
  [6000, 6000.2556363966],
  [6504, 6503.201080092381],
];

describe("CCT: McCamy's quick estimate beside Robertson's method — labelled, never over-claimed", () => {
  it("D65 xy (0.3127, 0.3290) → McCamy 6505.08 K [L], Robertson 6503.707 K, Duv +0.00326 [L]", () => {
    const r = okOf(cctMcCamy(0.3127, 0.329));
    expect(r.cctK).toBeCloseTo(6505.08, 2);
    expect(r.robertsonK).toBeCloseTo(6503.70718479529, 6);
    expect(r.duv).toBeCloseTo(0.003256663373801633, 9);
    expect(r.inMcCamyRange).toBe(true); // D65 is the band's own end, judged by Robertson
    expect(r.notes[0]).toMatch(/Measured error against the true blackbody locus is up to 10\.1 K/);
  });
  it("illuminant A xy (0.44758, 0.40745) → McCamy 2857.13 K [L], Robertson 2855.600 K [L]", () => {
    const r = okOf(cctMcCamy(0.44758, 0.40745));
    expect(r.cctK).toBeCloseTo(2857.13, 2);
    expect(r.robertsonK).toBeCloseTo(2855.6003603713875, 6);
  });
  it("Robertson reproduces colour-science's uv_to_CCT_Robertson1968 on the blackbody points (catches a table slip) [L]", () => {
    for (const [, x, y, want] of BLACKBODY) {
      const r = okOf(cctRobertson(x, y));
      expect({ x, got: r.cctK }).toEqual({ x, got: expect.closeTo(want, 6) });
    }
  });
  it("Robertson's MEASURED accuracy on the true locus: within 0.11% over 1667–25000 K, 1.5 K over 2856–6504 K", () => {
    let worstIn = 0;
    for (const [T, x, y] of BLACKBODY) {
      const err = Math.abs(okOf(cctRobertson(x, y)).cctK - T);
      expect(err / T).toBeLessThanOrEqual(ROBERTSON_ERROR_RELATIVE);
      if (T >= 2856 && T <= 6504) worstIn = Math.max(worstIn, err);
    }
    expect(worstIn).toBeLessThan(1.5);
  });
  it("McCamy's MEASURED accuracy over 2856–6504 K is the stated MCCAMY_ERROR_K (10.06 K max at 3604 K on a 4 K sweep)", () => {
    let worst = 0;
    for (const [T, want] of MCCAMY_ORACLE) {
      const xy = BLACKBODY.find((b) => b[0] === T);
      if (xy) expect(okOf(cctMcCamy(xy[1], xy[2])).cctK).toBeCloseTo(want, 6); // same formula as colour-science
      worst = Math.max(worst, Math.abs(want - T));
    }
    expect(worst).toBeCloseTo(9.94, 2); // the worst of these sample points (3500 K; 4000 K is 8.84)
    expect(worst).toBeLessThanOrEqual(MCCAMY_ERROR_K);
    expect(MCCAMY_ERROR_K).toBeGreaterThanOrEqual(10.06); // the full sweep's maximum
  });
  it("[X] round trip through the D-series: daylight at 5003 K reads back within 2 K by Robertson", () => {
    const d50 = okOf(daylightXy(5003)).xy;
    expect(Math.abs(okOf(cctMcCamy(d50.x, d50.y)).robertsonK - 5003)).toBeLessThan(2);
  });
  it("outside McCamy's band it ANSWERS, labelled, with Robertson beside it (2700 K lamp; D75; 10,000 K)", () => {
    const lamp = okOf(cctMcCamy(0.4593139523446629, 0.41066024937841794));
    expect(lamp.cctK).toBeCloseTo(2705.56, 1);
    expect(lamp.inMcCamyRange).toBe(false);
    expect(lamp.notes[0]).toMatch(/outside McCamy's range \(2856–6504 K\) — accuracy worse, approx\./);
    const d75 = okOf(daylightXy(7504)).xy;
    expect(okOf(cctMcCamy(d75.x, d75.y)).robertsonK).toBeCloseTo(7502.0316147276335, 6);
    const [, x10, y10] = BLACKBODY.find((b) => b[0] === 10000)!;
    const r10 = okOf(cctMcCamy(x10, y10));
    expect(r10.cctK).toBeLessThan(9900); // McCamy is 118 K low here …
    expect(r10.robertsonK).toBeCloseTo(9998.985433182774, 6); // … and the label points to Robertson
    expect(r10.notes[0]).toMatch(/Robertson's method here gives 9999\.0 K/);
  });
  it("Robertson refuses outside its table (below 1667 K)", () => {
    expect(refusal(cctRobertson(0.6, 0.39))).toMatch(/outside Robertson's isotemperature table/);
  });
  it("refuses a saturated colour far from the blackbody locus", () => {
    expect(refusal(cctMcCamy(0.3, 0.6))).toMatch(/blackbody locus.*no CCT/);
  });
  it("refuses the singular line, impossible chromaticities and non-numbers", () => {
    expect(refusal(cctMcCamy(0.3, 0.1858))).toMatch(/epicentre/);
    expect(refusal(cctMcCamy(0.3, 0.1))).toMatch(/epicentre/);
    expect(refusal(cctMcCamy(0.7, 0.4))).toMatch(/x \+ y < 1/);
    expect(refusal(cctMcCamy(-0.1, 0.3))).toMatch(/not a chromaticity/);
    expect(refusal(cctMcCamy(NaN, 0.3))).toMatch(/finite/);
  });
});
