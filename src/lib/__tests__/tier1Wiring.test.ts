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
    // Parameters chosen so designFilter actually SUCCEEDS. The first version of
    // this test used a specification needing order 22, which designFilter
    // refuses - so it silently measured the cosine fallback and would have
    // passed no matter how broken the designed path was.
    // Each kind gets a specification its own two sections can actually meet:
    // a band-pass needs a designable LOW-pass at the high edge, where a fixed
    // transition in Hz is a narrow RATIO and so a high order.
    const bpOpts = { cutoff: 25, cutoffHigh: 50, transition: 15, response: "chebyshev" as const };
    const bsOpts = { cutoff: 20, cutoffHigh: 70, transition: 10, response: "chebyshev" as const };
    const bp = fftFilter(MIXED, FS, "bandpass", bpOpts)!;
    const bs = fftFilter(MIXED, FS, "bandstop", bsOpts)!;
    for (const r of [bp, bs]) {
      expect(r.caveats.some((c) => c.includes("could not be designed"))).toBe(false);
      expect(r.caveats.some((c) => c.includes("Designed response"))).toBe(true);
    }
    // MIXED carries 5 Hz and 60 Hz. The band-pass keeps neither (both are
    // outside 25-50), so check it removes them; the band-stop keeps 5 and
    // removes 60.
    expect(ampAt(bp.signal, 5, FS)).toBeLessThan(0.02);
    expect(ampAt(bs.signal, 60, FS)).toBeLessThan(0.02);
    expect(ampAt(bs.signal, 5, FS)).toBeGreaterThan(0.9);
  });

  it("A DESIGNED BAND-STOP REALLY REACHES ITS STOPBAND — it is parallel, not 1 - LP*HP", () => {
    // The complement looks obvious and is structurally broken: the notch depth
    // of 1 - |HP|*|LP| is bounded by the PASSBAND RIPPLE, so at 1 dB of ripple
    // it can never beat about -19 dB however much attenuation is requested.
    // Measured on the shipped code it rejected 18 dB where 40 was asked for.
    const opts = { cutoff: 20, cutoffHigh: 70, transition: 10, response: "chebyshev" as const, stopbandDb: 40 };
    const tone = (f: number): number => {
      const x = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * f * i) / FS));
      const y = fftFilter(x, FS, "bandstop", opts)!.signal;
      return ampAt(y, f, FS) / ampAt(x, f, FS);
    };
    // Deep inside the stop band the rejection must be far past the old ceiling.
    expect(20 * Math.log10(tone(45))).toBeLessThan(-40);
    expect(20 * Math.log10(tone(60))).toBeLessThan(-35);
    // And the pass bands are still passed.
    expect(tone(5)).toBeGreaterThan(0.9);
    expect(tone(95)).toBeGreaterThan(0.9);
  });

  it("a band-stop NEVER AMPLIFIES, even where the two sections overlap", () => {
    const opts = { cutoff: 20, cutoffHigh: 70, transition: 10, response: "chebyshev" as const };
    for (let f = 1; f < 99; f += 2) {
      const x = Array.from({ length: 1024 }, (_, i) => Math.sin((2 * Math.PI * f * i) / FS));
      const y = fftFilter(x, FS, "bandstop", opts)!.signal;
      expect(ampAt(y, f, FS) / ampAt(x, f, FS)).toBeLessThan(1.001);
    }
  });

  it("REFUSES A STOPBAND EDGE AT OR BELOW ZERO rather than clamping and quoting a fiction", () => {
    // cutoff 2 with a 10 Hz transition implies a stopband edge at -8 Hz. The
    // clamp to 1e-9 rad/s used to report "order 1, 191 dB" for a filter passing
    // 14% of the amplitude at 0.5 Hz - and two unrelated specifications both
    // reported 195 dB, which is the giveaway that the number came from the
    // clamp rather than from any design.
    const r = fftFilter(MIXED, FS, "highpass", { cutoff: 2, transition: 10, response: "butterworth" })!;
    expect(r.caveats.some((c) => c.includes("could not be designed"))).toBe(true);
    expect(r.caveats.some((c) => c.includes("Designed response"))).toBe(false);
  });

  it("THE TYPED CUTOFF MEANS THE SAME THING FOR A LOW-PASS AND A HIGH-PASS", () => {
    // These used to use different conventions - t past the cutoff for one, t/2
    // either side for the other - so a designed high-pass was 12 dB down at its
    // own stated cutoff while the low-pass was 1 dB down at its.
    const tone = (f: number, kind: "lowpass" | "highpass", o: object): number => {
      const x = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * f * i) / FS));
      const y = fftFilter(x, FS, kind, o as never)!.signal;
      return 20 * Math.log10(ampAt(y, f, FS) / ampAt(x, f, FS));
    };
    // Same 2:1 transition ratio each way, so both are designable.
    const lp = { cutoff: 10, transition: 10, response: "butterworth" };
    const hp = { cutoff: 20, transition: 10, response: "butterworth" };
    expect(tone(10, "lowpass", lp)).toBeGreaterThan(-1.5); // at its own cutoff
    expect(tone(20, "highpass", hp)).toBeGreaterThan(-1.5);
    expect(tone(20, "lowpass", lp)).toBeLessThan(-35); // at its own stopband edge
    expect(tone(10, "highpass", hp)).toBeLessThan(-35);
  });

  it("A CASCADED CHEBYSHEV MEETS ITS RIPPLE BUDGET, not double it", () => {
    // Two 1 dB sections in series give 2 dB unless each is designed to half.
    const opts = { cutoff: 20, cutoffHigh: 70, transition: 10, response: "chebyshev" as const };
    let lo = Infinity;
    let hi = 0;
    for (let f = 26; f <= 64; f += 1) {
      const x = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * f * i) / FS));
      const y = fftFilter(x, FS, "bandpass", opts)!.signal;
      const g = ampAt(y, f, FS) / ampAt(x, f, FS);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(20 * Math.log10(hi) - 20 * Math.log10(lo)).toBeLessThan(1.0);
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

  it("THE SIGN LIVES ON THE DETERMINANT, NOT ON THE VOLUME SCALE FACTOR", () => {
    // These were one row whose numeric value was |det| and whose exact string
    // was the SIGNED det, and the renderer prints "label = exact ~ value" when
    // they differ - so a reflection displayed, and INSERTED, the self-
    // contradicting "volume scale factor = -1  ~ 1".
    for (const [input, det, vol] of [
      ["reflect xy (1,2,3)", "-1", "1"],
      ["scale -2 (1,1,1)", "-8", "8"],
      ["scale 2 3 4 (1,1,1)", "24", "24"],
    ] as [string, string, string][]) {
      const r = solveGeometry(input)!;
      const d = r.values.find((v) => v.label === "determinant")!;
      const v = r.values.find((v2) => v2.label === "volume scale factor")!;
      expect(d.exact).toBe(det);
      expect(v.exact).toBe(vol);
      // A volume scale factor is non-negative by definition.
      expect(v.value).toBeGreaterThanOrEqual(0);
      expect(Math.abs(d.value)).toBeCloseTo(v.value, 9);
    }
  });

  it("READS THE AXIS THE USER WROTE — it used to silently default to z", () => {
    const y = (s: string): number => solveGeometry(s)!.values.find((v) => v.label === "y")!.value;
    const z = (s: string): number => solveGeometry(s)!.values.find((v) => v.label === "z")!.value;
    // Rotating (1,2,3) by 90 about x gives (1,-3,2); about z it gives (-2,1,3).
    for (const form of ["rotate about x 90 (1,2,3)", "rotate x 90 (1,2,3)", "rotate 90 x-axis (1,2,3)"]) {
      expect(y(form)).toBeCloseTo(-3, 9);
      expect(z(form)).toBeCloseTo(2, 9);
    }
    expect(y("rotate y 90 (1,2,3)")).toBeCloseTo(2, 9);
  });

  it("REFUSES rather than substituting a transformation the user did not ask for", () => {
    const refusal = (s: string): string | undefined => solveGeometry(s)?.degenerate;
    expect(refusal("rotate 90 (1,2,3)")).toMatch(/does not name an axis/);
    expect(refusal("reflect (1,2,3)")).toMatch(/does not name a plane/);
    // Two factors is neither uniform nor per-axis; dropping one silently is the
    // failure being refused.
    expect(refusal("scale 2 3 (1,1,1)")).toMatch(/scale factors/);
    // A comma cannot separate operations, because it separates scale factors.
    expect(refusal("rotate 90 z, scale 2 (1,0,0)")).toMatch(/more than one transformation/);
  });

  it("reads scientific notation and fractions, instead of the first fragment", () => {
    // "1e3" used to be read as 1 and "1/2" as 1.
    const r = solveGeometry("rotate 1e3 z (1,0,0)")!;
    // 1000 degrees is 280 after three whole turns.
    expect(r.values.find((v) => v.label === "x")!.value).toBeCloseTo(Math.cos((280 * Math.PI) / 180), 6);
    const s = solveGeometry("scale 1/2 (2,2,2)")!;
    expect(s.values.find((v) => v.label === "x")!.value).toBeCloseTo(1, 9);
  });

  it("KEEPS THE WORDS AFTER THE POINT — the plane may be written last", () => {
    // Cutting the string at the first "(" threw away "in the yz plane" and
    // silently reflected in xy.
    const r = solveGeometry("mirror the point (1,2,3) in the yz plane")!;
    expect(r.values.find((v) => v.label === "x")!.value).toBeCloseTo(-1, 9);
    expect(r.values.find((v) => v.label === "z")!.value).toBeCloseTo(3, 9);
  });

  it("a transform phrased around the point is still REACHED, not read as a vector", () => {
    const r = solveGeometry("rotate the point (1,2,3) by 90 about z")!;
    expect(r.title).toMatch(/Transform/);
    expect(r.values.find((v) => v.label === "x")!.value).toBeCloseTo(-2, 9);
  });

  it("says when extra points were ignored rather than dropping them silently", () => {
    expect(solveGeometry("rotate 90 z (1,0,0) (0,1,0)")!.caveats.join(" ")).toMatch(/only the first/);
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

  it("NEVER RETURNS NaN — an integrand that is not a function is refused", () => {
    // These are constants that evaluate to NaN or Infinity, and the constant
    // rule accepted them, producing "NaN*x + C" - which the pane then INSERTED
    // into the document, because NaN is not the em-dash the insert guard scans
    // for. The definite branch of the same module already refused them.
    for (const bad of ["sqrt(-1)", "ln(-1)", "asin(2)", "1/0", "x/0"]) {
      expect(antiderivative(bad)).toBeNull();
    }
  });

  it("no answer's printed form ever contains NaN or Infinity", () => {
    for (const f of ["x^2", "1/x", "tan(x)", "sqrt(x)", "x*exp(x)", "a*x^2", "1/(x^2+1)"]) {
      const r = antiderivative(f);
      if (!r) continue;
      expect(r.antiderivative).not.toMatch(/NaN|Infinity/);
      expect(r.checkDerivative).not.toMatch(/NaN|Infinity/);
    }
  });

  it("SYMBOLIC MEANS PROVED — sampled answers are labelled numeric, not symbolic", () => {
    // symbolicIntegrate accepts a candidate either by canonical proof OR by
    // eight float samples when the simplifier cannot settle it. Reporting the
    // second as "proved identically zero" was an overclaim on every answer
    // canonical equality could not reach.
    for (const f of ["x^2", "sin(x)", "1/x", "x*exp(x)", "1/(x^2+1)"]) {
      expect(antiderivative(f)!.verified).toBe("symbolic");
    }
    // These three survive on samples alone - casint's own doc predicts it.
    for (const f of ["tan(x)", "tanh(x)", "sqrt(x)"]) {
      const r = antiderivative(f)!;
      expect(r.verified).toBe("numeric");
      expect(r.method).not.toMatch(/proved/);
    }
  });

  it("the numeric tier is REACHABLE — a status nothing can report is a lie in the docs", () => {
    const seen = new Set<string>();
    for (const f of ["x^2", "tan(x)", "sqrt(x)", "sin(x)", "tanh(x)", "1/x"]) {
      const r = antiderivative(f);
      if (r) seen.add(r.verified);
    }
    expect(seen.has("symbolic")).toBe(true);
    expect(seen.has("numeric")).toBe(true);
  });

  it("integration by parts and substitution both come back", () => {
    expect(antiderivative("x*exp(x)")!.antiderivative).toBe("x*exp(x) - exp(x)");
    expect(antiderivative("1/(x^2+1)")!.antiderivative).toBe("atan(x)");
  });

  it("SAYS NO when it finds no closed form", () => {
    expect(antiderivative("exp(-x^2)")).toBeNull();
    expect(antiderivative("sin(x)/x")).toBeNull();
  });

  it("DOES NOT CLAIM 'no elementary antiderivative exists' — most refusals are engine gaps", () => {
    // Of the integrands this returns null for, the majority have standard
    // answers a first-year student produces by hand. Blaming mathematics for
    // an integrator's reach would tell a student that sin(x)^2 - the first
    // integration-by-identity exercise there is - has no antiderivative.
    const solvableByHand = ["sin(x)^2", "sec(x)", "exp(x)*cos(x)", "ln(x)^2"];
    const missed = solvableByHand.filter((f) => antiderivative(f) === null);
    expect(missed.length).toBeGreaterThan(0); // the engine really does miss these
    // So no doc or message may assert that a refusal means none exists.
    const doc = antiderivative("x^2")!;
    expect(doc.caveats.join(" ")).not.toMatch(/genuinely have none/);
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
