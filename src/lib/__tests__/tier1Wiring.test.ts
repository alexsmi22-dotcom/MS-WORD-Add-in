// The last of the Tier-1 gap-analysis items, tested at the ENGINE level.
//
// Two of these are compositions rather than new mathematics: a number this
// product already computes in one place being carried into another by code
// instead of by the user's hands. The bug they remove is transcription, so the
// tests check that the composed answer matches the answer the upstream engine
// gives on its own — which is the only thing a hand-carry could get wrong.

import { fftFilter } from "../fftfilter";
import { switchingPower, junctionTemperature } from "../chips";
import { analyzePipe, waterProperties, npshAnalysis } from "../fluids";
import { totalLoad, parseLoads, analyzeBeam, parseSupports, parseLength } from "../beam";
import { solveGeometry } from "../geometryParse";
import { antiderivative } from "../solve";
import { probit, qqPoints } from "../regression";

/** Amplitude of a signal at one frequency, by direct correlation. */
function ampAt(x: number[], f: number, fs: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos((2 * Math.PI * f * i) / fs);
    im -= x[i] * Math.sin((2 * Math.PI * f * i) / fs);
  }
  return (2 * Math.hypot(re, im)) / x.length;
}

const FS = 200;
const N = 512;
const MIXED = Array.from(
  { length: N },
  (_, i) => Math.sin((2 * Math.PI * 5 * i) / FS) + 0.8 * Math.sin((2 * Math.PI * 60 * i) / FS),
);

describe("FFT filter: a DESIGNED edge, not just a chosen shape", () => {
  it("THE DEFAULT IS UNCHANGED — no existing caller gets different numbers", () => {
    const before = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10 })!;
    const explicit = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10, response: "cosine" })!;
    expect(before.signal).toEqual(explicit.signal);
  });

  it("a Butterworth edge removes the noise and keeps the signal", () => {
    const r = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10, response: "butterworth" })!;
    expect(ampAt(r.signal, 5, FS)).toBeGreaterThan(0.95);
    expect(ampAt(r.signal, 60, FS)).toBeLessThan(0.01);
  });

  it("it reports the ORDER and the attenuation it actually achieves", () => {
    const r = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10, response: "butterworth" })!;
    const note = r.caveats.find((c) => c.includes("Designed response"));
    expect(note).toBeDefined();
    expect(note).toMatch(/order \d+/);
    expect(note).toMatch(/dB at the stopband edge/);
  });

  it("CHEBYSHEV NEEDS A LOWER ORDER THAN BUTTERWORTH, and pays in passband ripple", () => {
    // The whole reason both families exist. Same specification, steeper family,
    // fewer poles - but the passband is no longer flat.
    const b = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10, response: "butterworth" })!;
    const c = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10, response: "chebyshev" })!;
    const orderOf = (r: typeof b): number =>
      Number(/order (\d+)/.exec(r.caveats.find((x) => x.includes("Designed response")) ?? "")?.[1] ?? "0");
    expect(orderOf(c)).toBeLessThan(orderOf(b));
    // Butterworth is maximally flat, so it holds the passband amplitude closer.
    expect(Math.abs(ampAt(b.signal, 5, FS) - 1)).toBeLessThan(Math.abs(ampAt(c.signal, 5, FS) - 1));
  });

  it("a tighter stopband demands a higher order", () => {
    const orderOf = (db: number): number => {
      const r = fftFilter(MIXED, FS, "lowpass", {
        cutoff: 10, transition: 10, response: "butterworth", stopbandDb: db,
      })!;
      return Number(/order (\d+)/.exec(r.caveats.find((x) => x.includes("Designed response")) ?? "")?.[1] ?? "0");
    };
    expect(orderOf(60)).toBeGreaterThan(orderOf(20));
  });

  it("band-pass and band-stop are complementary, and both edges are designed", () => {
    const bp = fftFilter(MIXED, FS, "bandpass", { cutoff: 40, cutoffHigh: 80, transition: 10, response: "butterworth" })!;
    const bs = fftFilter(MIXED, FS, "bandstop", { cutoff: 40, cutoffHigh: 80, transition: 10, response: "butterworth" })!;
    expect(ampAt(bp.signal, 60, FS)).toBeGreaterThan(0.7);
    expect(ampAt(bp.signal, 5, FS)).toBeLessThan(0.01);
    expect(ampAt(bs.signal, 60, FS)).toBeLessThan(0.01);
    expect(ampAt(bs.signal, 5, FS)).toBeGreaterThan(0.95);
  });

  it("FALLS BACK AND SAYS SO when the specification cannot be designed", () => {
    // A zero transition band would need infinite order - that is the brick wall.
    const r = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 0, response: "butterworth" })!;
    expect(r.caveats.some((c) => c.includes("could not be designed"))).toBe(true);
    // And it must say the filter below is not the one that was asked for.
    expect(r.caveats.some((c) => c.includes("not the one you asked for"))).toBe(true);
  });

  it("says the phase is NOT reproduced, only the magnitude", () => {
    const r = fftFilter(MIXED, FS, "lowpass", { cutoff: 10, transition: 10, response: "butterworth" })!;
    expect(r.caveats.join(" ")).toMatch(/MAGNITUDE response of that design is applied; the phase is not/);
  });
});

describe("chips: the power/thermal handoff computes what the user used to re-type", () => {
  it("the composed power equals what the power engine gives on its own", () => {
    // This is the only thing the hand-carry could get wrong.
    const pw = switchingPower(2e-9, 1.1, 2e9, 0.15, 0)!;
    expect(pw.totalW).toBeCloseTo(0.15 * 2e-9 * 1.1 * 1.1 * 2e9, 12);
    // And the thermal engine, given that power, gives the same junction as it
    // would given the number typed by hand.
    const a = junctionTemperature(pw.totalW, 25, 0.5, 0.2, 1.3, 125)!;
    const b = junctionTemperature(Number(pw.totalW.toPrecision(15)), 25, 0.5, 0.2, 1.3, 125)!;
    expect(a.junctionC).toBeCloseTo(b.junctionC, 9);
  });

  it("A DROPPED DIGIT IS THE FAILURE THIS REMOVES", () => {
    // 0.726 W mis-typed as 0.72 W is a 0.8 degree error here, and nothing in
    // the old flow could notice. The point is not the size - it is that the
    // composed path cannot make the mistake at all.
    const pw = switchingPower(2e-9, 1.1, 2e9, 0.15, 0)!;
    const right = junctionTemperature(pw.totalW, 25, 0.5, 0.2, 1.3)!;
    const typo = junctionTemperature(Math.floor(pw.totalW * 100) / 100, 25, 0.5, 0.2, 1.3)!;
    expect(right.junctionC).not.toBeCloseTo(typo.junctionC, 3);
  });

  it("leakage still contributes, and is still a measured input", () => {
    const dry = switchingPower(2e-9, 1.1, 2e9, 0.15, 0)!;
    const leaky = switchingPower(2e-9, 1.1, 2e9, 0.15, 0.05)!;
    expect(leaky.totalW).toBeGreaterThan(dry.totalW);
    expect(leaky.staticW).toBeCloseTo(1.1 * 0.05, 12);
  });
});

describe("pump NPSH: density and suction losses come from the engines that own them", () => {
  it("the water table fills density, and it is the interpolated value", () => {
    const w = waterProperties(20)!;
    expect(w.rho).toBeCloseTo(998.2, 6);
    const mid = waterProperties(25)!;
    expect(mid.rho).toBeGreaterThan(waterProperties(30)!.rho);
    expect(mid.rho).toBeLessThan(waterProperties(20)!.rho);
  });

  it("the composed suction loss equals the pipe engine's own answer", () => {
    const w = waterProperties(20)!;
    const pipe = analyzePipe({ D: 0.1, L: 12, Q: 0.015, eps: 4.5e-5, rho: w.rho, mu: w.mu, sumK: 2.5 });
    expect(pipe.ok).toBe(true);
    if (!pipe.ok) return;
    expect(pipe.hTotal).toBeCloseTo(pipe.hMajor + pipe.hMinor, 12);
    // And feeding it in gives the same NPSH as typing that number would.
    const a = npshAnalysis({
      pSurface: 101325, pVapour: 2339, rho: w.rho, staticHead: 2,
      suctionLosses: pipe.hTotal, npshRequired: 3,
    });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.npshAvailable).toBeGreaterThan(0);
  });

  it("A BIGGER SUCTION LINE IS THE FIX, and the composition shows it", () => {
    const w = waterProperties(20)!;
    const loss = (D: number): number => {
      const p = analyzePipe({ D, L: 12, Q: 0.015, eps: 4.5e-5, rho: w.rho, mu: w.mu, sumK: 2.5 });
      return p.ok ? p.hTotal : NaN;
    };
    // Head loss falls steeply with diameter - roughly the fifth power.
    expect(loss(0.15)).toBeLessThan(loss(0.1) / 5);
  });

  it("hotter water is LESS dense, which is half of why NPSH falls with temperature", () => {
    expect(waterProperties(80)!.rho).toBeLessThan(waterProperties(20)!.rho);
  });
});

describe("beam: the equilibrium check is independent of the solve", () => {
  it("total load is summed from the PARSED loads, not the solved reactions", () => {
    const loads = parseLoads("point 30 at 2\nudl 10 from 0 to 4").loads;
    // 30 kN point + 10 kN/m over 4 m = 70 kN.
    expect(totalLoad(loads)).toBeCloseTo(70, 9);
  });

  it("the reactions carry exactly the applied load, on a determinate beam", () => {
    const loads = parseLoads("point 30 at 2\nudl 10 from 0 to 4").loads;
    const sup = parseSupports("pin 0\nroller 6").supports;
    const res = analyzeBeam({ length: parseLength("6")!, supports: sup, loads });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const carried = res.reactions.reduce((s, r) => s + r.force, 0);
    expect(carried).toBeCloseTo(totalLoad(loads), 9);
  });

  it("and on an INDETERMINATE beam too — the check does not depend on determinacy", () => {
    const loads = parseLoads("udl 24 from 0 to 6").loads;
    const sup = parseSupports("fixed 0\nroller 6").supports;
    const res = analyzeBeam({ length: parseLength("6")!, supports: sup, loads });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const carried = res.reactions.reduce((s, r) => s + r.force, 0);
    expect(carried).toBeCloseTo(144, 9); // 24 kN/m x 6 m
    expect(carried).toBeCloseTo(totalLoad(loads), 9);
  });

  it("AN APPLIED COUPLE ADDS NO VERTICAL LOAD, which is why it is absent from the total", () => {
    const withCouple = parseLoads("point 30 at 2\ncouple 50 at 3").loads;
    const without = parseLoads("point 30 at 2").loads;
    expect(totalLoad(withCouple)).toBeCloseTo(totalLoad(without), 9);
    expect(totalLoad(withCouple)).toBeCloseTo(30, 9);
  });

  it("a linearly varying load contributes its average times its length", () => {
    // Triangular 0 to 12 over 4 m = 24 - the average intensity, not the peak.
    expect(totalLoad(parseLoads("udl 0 to 12 from 0 to 4").loads)).toBeCloseTo(24, 9);
    // And a trapezoid: (4+8)/2 x 3 = 18.
    expect(totalLoad(parseLoads("udl 4 to 8 from 1 to 4").loads)).toBeCloseTo(18, 9);
  });

  it("a load line the parser cannot read contributes NOTHING, and is an error", () => {
    // The equilibrium check earns its place here: a mis-typed load silently
    // vanishes from the total, and the printed residual is what reveals it.
    const bad = parseLoads("ramp 0 12 from 0 to 4");
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(totalLoad(bad.loads)).toBe(0);
  });
});

describe("geometry: the 3-D transform toolkit is reachable at last", () => {
  const val = (s: string, label: string): number | undefined =>
    solveGeometry(s)?.values.find((v) => v.label === label)?.value;

  it("a rotation is REACHABLE FROM TYPED INPUT — not merely exported", () => {
    // The failure this fixes: a complete, tested toolkit with no way in.
    const r = solveGeometry("rotate 90 z (1,0,0)");
    expect(r).not.toBeNull();
    expect(r!.title).toMatch(/Transform/);
  });

  it("rotating (1,0,0) by 90 degrees about z gives (0,1,0)", () => {
    expect(val("rotate 90 z (1,0,0)", "x")!).toBeCloseTo(0, 9);
    expect(val("rotate 90 z (1,0,0)", "y")!).toBeCloseTo(1, 9);
    expect(val("rotate 90 z (1,0,0)", "z")!).toBeCloseTo(0, 9);
  });

  it("a rotation preserves length; a scale does not", () => {
    const rot = solveGeometry("rotate 37 z (3,4,0)")!;
    const [x, y, z] = ["x", "y", "z"].map((l) => rot.values.find((v) => v.label === l)!.value);
    expect(Math.hypot(x, y, z)).toBeCloseTo(5, 9);
    expect(val("rotate 37 z (3,4,0)", "volume scale factor")!).toBeCloseTo(1, 9);
  });

  it("scaling multiplies volume by the product of the factors", () => {
    expect(val("scale 2 3 4 (1,1,1)", "volume scale factor")!).toBeCloseTo(24, 9);
    expect(val("scale 2 (1,2,3)", "volume scale factor")!).toBeCloseTo(8, 9);
    expect(val("scale 2 (1,2,3)", "y")!).toBeCloseTo(4, 9);
  });

  it("A REFLECTION HAS DETERMINANT -1 and is named as flipping orientation", () => {
    const r = solveGeometry("reflect xy (1,2,3)")!;
    expect(r.values.find((v) => v.label === "z")!.value).toBeCloseTo(-3, 9);
    expect(r.steps.join(" ")).toMatch(/FLIPS ORIENTATION/);
    // The volume scale factor is the ABSOLUTE determinant, so it is 1: a
    // reflection changes no volume at all, only handedness.
    expect(r.values.find((v) => v.label === "volume scale factor")!.value).toBeCloseTo(1, 9);
  });

  it("reflecting twice in the same plane is the identity", () => {
    const r = solveGeometry("reflect xy then reflect xy (1,2,3)")!;
    expect(r.values.find((v) => v.label === "z")!.value).toBeCloseTo(3, 9);
  });

  it("A SINGULAR TRANSFORM IS NAMED, not returned as an ordinary answer", () => {
    const r = solveGeometry("scale 0 (1,2,3)")!;
    expect(r.steps.join(" ")).toMatch(/COLLAPSES/);
    expect(r.values.find((v) => v.label === "volume scale factor")!.value).toBeCloseTo(0, 12);
  });

  it("ORDER MATTERS, and the composition says so", () => {
    const a = solveGeometry("rotate 90 z then scale 2 3 4 (1,0,0)")!;
    const b = solveGeometry("scale 2 3 4 then rotate 90 z (1,0,0)")!;
    const yOf = (r: typeof a): number => r.values.find((v) => v.label === "y")!.value;
    // Rotate first: (1,0,0) -> (0,1,0) -> scaled by 3 in y = 3.
    // Scale first: (1,0,0) -> (2,0,0) -> rotated = (0,2,0).
    expect(yOf(a)).toBeCloseTo(3, 9);
    expect(yOf(b)).toBeCloseTo(2, 9);
    expect(a.caveats.join(" ")).toMatch(/ORDER MATTERS/);
  });

  it("a rotation is reported as NUMERIC rather than exact", () => {
    expect(solveGeometry("rotate 30 z (1,0,0)")!.caveats.join(" ")).toMatch(/NUMERIC rather than exact/);
  });

  it("an exact transform keeps its exact fractions", () => {
    const r = solveGeometry("scale 2 3 4 (1,1,1)")!;
    expect(r.values.find((v) => v.label === "x")!.exact).toBe("2");
  });

  it("A ROTATION'S EXACT FORM IS NOT PRINTED — cos 90 is not a sane fraction", () => {
    // The rational layer exists so rotations COMPOSE with exact transforms,
    // not so 6.1e-17 gets printed as a sixty-digit fraction.
    const r = solveGeometry("rotate 90 z (1,0,0)")!;
    for (const v of r.values) expect(v.exact).toBeUndefined();
  });
});

describe("indefinite integrals", () => {
  it("returns F(x) with no limits at all", () => {
    const r = antiderivative("x^2")!;
    expect(r.antiderivative).toBe("x^3/3");
    expect(r.variable).toBe("x");
  });

  it("EVERY ANSWER IS CHECKED BY DIFFERENTIATING IT BACK", () => {
    for (const f of ["x^2", "sin(x)", "1/x", "x*exp(x)", "1/(x^2+1)", "tan(x)", "x*cos(x)"]) {
      const r = antiderivative(f)!;
      expect(r).not.toBeNull();
      expect(r.verified).not.toBe("unverified");
    }
  });

  it("integration by parts and substitution both come back", () => {
    expect(antiderivative("x*exp(x)")!.antiderivative).toBe("x*exp(x) - exp(x)");
    expect(antiderivative("1/(x^2+1)")!.antiderivative).toBe("atan(x)");
  });

  it("SAYS NO when there is no elementary antiderivative", () => {
    // The correct answer, not a failure: these genuinely have none.
    expect(antiderivative("exp(-x^2)")).toBeNull();
    expect(antiderivative("sin(x)/x")).toBeNull();
  });

  it("other symbols are treated as constants, and it says so", () => {
    const r = antiderivative("a*x^2")!;
    expect(r.antiderivative).toBe("a*x^3/3");
    expect(r.caveats.join(" ")).toMatch(/treated as a constant/);
  });

  it("integrates with respect to a named variable", () => {
    const r = antiderivative("a*t^2", "t")!;
    expect(r.variable).toBe("t");
    expect(r.antiderivative).toBe("a*t^3/3");
  });

  it("always states that + C is not decoration", () => {
    expect(antiderivative("x^2")!.caveats.join(" ")).toMatch(/only defined up to an additive constant/);
  });

  it("WARNS THAT THE CONSTANT IS NOT SHARED ACROSS A POLE", () => {
    // The standard omission in every table of integrals.
    expect(antiderivative("1/x")!.caveats.join(" ")).toMatch(/NOT shared across it/);
  });

  it("refuses unparseable input rather than guessing", () => {
    expect(antiderivative("x^^2")).toBeNull();
    expect(antiderivative("")).toBeNull();
  });
});

describe("probit was never dead — the gap analysis was wrong about it", () => {
  it("it is the engine behind every Q-Q plot the pane draws", () => {
    const pts = qqPoints([-1.2, -0.4, 0.1, 0.55, 1.8]);
    expect(pts).toHaveLength(5);
    // The theoretical quantiles come straight from probit at the Blom
    // plotting positions, so they must match it exactly.
    expect(pts[0].theoretical).toBeCloseTo(probit((1 - 0.375) / (5 + 0.25)), 12);
    expect(pts[4].theoretical).toBeCloseTo(probit((5 - 0.375) / (5 + 0.25)), 12);
  });

  it("inverts the normal CDF at the values everyone knows", () => {
    expect(probit(0.5)).toBeCloseTo(0, 12);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 5);
  });

  it("the quantiles increase, which is what makes a Q-Q plot readable", () => {
    const pts = qqPoints([-2, -1, 0, 1, 2, 3]);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].theoretical).toBeGreaterThan(pts[i - 1].theoretical);
    }
  });
});
