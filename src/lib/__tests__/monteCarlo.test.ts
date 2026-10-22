// Monte Carlo uncertainty propagation. Expected values:
//  • closed forms — a linear f has exactly the GUM mean and standard deviation
//    and normal percentiles; x² with x ~ N(1, 0.5²) has mean μ² + σ² = 1.25 and
//    variance 4μ²σ² + 2σ⁴ = 1.125 (sd 1.0606601717798212);
//  • scipy.stats.norm.ppf(0.975) = 1.959963984540054;
//  • a numpy oracle of 10⁷ draws (default_rng(12345)) for a·b/c with
//    a = 10.0 ± 0.1, b = 4.00 ± 0.05, c = 2.0 ± 0.1: mean 20.049729868022247,
//    sd 1.0601645453853032, 2.5 % 18.117607838139627, 97.5 % 22.271321529155696;
//    and for x² above: 2.5 % 0.012704810395278035, 97.5 % 3.918639017357682;
//  • the GUM u for a·b/c in closed form: √((b/c·0.1)² + (a/c·0.05)² + (ab/c²·0.1)²) = √1.1025 = 1.05.
// Agreement is asserted to within a few Monte Carlo standard errors at N, never
// to digits the draws cannot carry; the fixed-seed snapshot pins determinism.

import {
  monteCarlo,
  tryMonteCarlo,
  fillNormals,
  splitmix32,
  plannedSamples,
  numericalTolerance,
  mcHistogramSvg,
  fmtCount,
  Z975,
  MC_MAX_SAMPLES,
  MC_DEFAULT_SAMPLES,
  MC_HIST_BINS,
} from "../monteCarlo";
import { studentPackVerb } from "../studentPack";
import { propagateUncertainty } from "../stats";

/** U+2009, built from its code point (never an invisible literal in source). */
const THIN = String.fromCharCode(0x2009);
/** Output with SI thin-space digit groups read as plain spaces, for matching. */
const plain = (s: string): string => s.split(THIN).join(" ");

describe("the seeded generator", () => {
  it("is deterministic, and even-length chunks give the same draws as one fill", () => {
    const one = new Float64Array(10);
    fillNormals(new Int32Array([42]), one);
    const st = new Int32Array([42]);
    const a = new Float64Array(4);
    const b = new Float64Array(6);
    fillNormals(st, a);
    fillNormals(st, b);
    expect([...Array.from(a), ...Array.from(b)]).toEqual(Array.from(one));
    const again = new Float64Array(10);
    fillNormals(new Int32Array([42]), again);
    expect(Array.from(again)).toEqual(Array.from(one));
    const other = new Float64Array(2);
    fillNormals(new Int32Array([43]), other);
    expect(other[0]).not.toBe(one[0]);
  });
  it("fillNormals uses the splitmix32 stream", () => {
    const next = splitmix32(9);
    const u1 = (next() + 0.5) / 4294967296;
    const u2 = (next() + 0.5) / 4294967296;
    const buf = new Float64Array(2);
    fillNormals(new Int32Array([9]), buf);
    expect(buf[0]).toBeCloseTo(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2), 14);
  });
  it("draws are standard normal: mean 0, variance 1 within 5 standard errors at N = 10⁵", () => {
    const N = 100000;
    const buf = new Float64Array(N);
    fillNormals(new Int32Array([1]), buf);
    let m = 0;
    for (const v of buf) m += v;
    m /= N;
    let s2 = 0;
    for (const v of buf) s2 += (v - m) ** 2;
    s2 /= N - 1;
    expect(Math.abs(m)).toBeLessThan(5 / Math.sqrt(N));
    expect(Math.abs(s2 - 1)).toBeLessThan(5 * Math.sqrt(2 / N));
    // Φ(1.959963984540054) = 0.975: the upper tail holds 2.5 % within 5 SE.
    let tail = 0;
    for (const v of buf) if (v > Z975) tail++;
    expect(Math.abs(tail / N - 0.025)).toBeLessThan(5 * Math.sqrt(0.025 * 0.975 / N));
  });
});

describe("a LINEAR function: Monte Carlo must agree with the first-order (GUM) result", () => {
  // f = 2a + 3b, a = 1 ± 0.1, b = 2 ± 0.2: mean 8, u = √(0.04 + 0.36) = √0.4.
  const u = Math.sqrt(0.4);
  const inputs = [
    { name: "a", value: 1, u: 0.1 },
    { name: "b", value: 2, u: 0.2 },
  ];
  it.each([1, 2, 3])("seed %i", (seed) => {
    const r = monteCarlo("2*a + 3*b", inputs, { seed });
    const N = r.samples;
    expect(N).toBe(MC_DEFAULT_SAMPLES);
    expect(r.gum.value).toBe(8);
    expect(r.gum.u).toBeCloseTo(u, 8);
    expect(Math.abs(r.mean - 8)).toBeLessThan((5 * u) / Math.sqrt(N));
    expect(Math.abs(r.sd - u)).toBeLessThan(5 * u * Math.sqrt(1 / (2 * N)));
    // Normal percentiles: 8 ∓ 1.959963984540054·u, within 5 endpoint standard errors.
    expect(Math.abs(r.lo - (8 - Z975 * u))).toBeLessThan(5 * r.seLow);
    expect(Math.abs(r.hi - (8 + Z975 * u))).toBeLessThan(5 * r.seHigh);
    expect(["agree", "noise"]).toContain(r.verdict);
  });
});

describe("a NONLINEAR function: the disagreement is found and said", () => {
  it("a·b/c against the 10⁷-draw numpy oracle and the closed-form GUM u = 1.05", () => {
    const r = monteCarlo("a*b/c", [
      { name: "a", value: 10.0, u: 0.1 },
      { name: "b", value: 4.0, u: 0.05 },
      { name: "c", value: 2.0, u: 0.1 },
    ]);
    const N = r.samples;
    expect(r.gum.value).toBe(20);
    expect(r.gum.u).toBeCloseTo(1.05, 7);
    expect(Math.abs(r.mean - 20.049729868022247)).toBeLessThan((5 * r.sd) / Math.sqrt(N));
    expect(Math.abs(r.sd - 1.0601645453853032)).toBeLessThan(5 * r.sd * Math.sqrt(2 / N));
    expect(Math.abs(r.lo - 18.117607838139627)).toBeLessThan(5 * r.seLow);
    expect(Math.abs(r.hi - 22.271321529155696)).toBeLessThan(5 * r.seHigh);
    // GUM 20 ± 1.96·1.05 puts the lower end at 17.94; the draws put it at 18.12.
    expect(r.verdict).toBe("disagree");
    expect(r.validated).toBe(false);
  });
  it("x² with x = 1 ± 0.5: closed-form mean 1.25 and sd √1.125", () => {
    const r = monteCarlo("x^2", [{ name: "x", value: 1, u: 0.5 }]);
    const N = r.samples;
    expect(Math.abs(r.mean - 1.25)).toBeLessThan((5 * Math.sqrt(1.125)) / Math.sqrt(N));
    // Var of s² for x² has kurtosis > 3; 8 × the normal-theory SE is still tight here.
    expect(Math.abs(r.sd - 1.0606601717798212)).toBeLessThan(8 * Math.sqrt(1.125) * Math.sqrt(1 / (2 * N)));
    expect(Math.abs(r.lo - 0.012704810395278035)).toBeLessThan(5 * r.seLow + 1e-4);
    expect(Math.abs(r.hi - 3.918639017357682)).toBeLessThan(5 * r.seHigh);
    expect(r.verdict).toBe("disagree");
  });
});

describe("fixed-seed snapshot (determinism, not accuracy)", () => {
  it("x², seed 7, 1 000 draws", () => {
    const r = monteCarlo("x^2", [{ name: "x", value: 1, u: 0.5 }], { samples: 1000, seed: 7 });
    expect(r.samples).toBe(1000);
    expect(r.mean).toBeCloseTo(1.2436682294383283, 12);
    expect(r.sd).toBeCloseTo(1.0130787662107719, 12);
    expect(r.lo).toBeCloseTo(0.011486746184857285, 12);
    expect(r.hi).toBeCloseTo(3.812062314784729, 12);
    const again = monteCarlo("x^2", [{ name: "x", value: 1, u: 0.5 }], { samples: 1000, seed: 7 });
    expect(Array.from(again.sorted)).toEqual(Array.from(r.sorted));
  });
});

describe("the GUM side is the project's own propagation", () => {
  it("same value and u as the Stats calculator's propagateUncertainty", () => {
    const inputs = [
      { name: "a", value: 10, u: 0.1 },
      { name: "b", value: 20, u: 0.2 },
      { name: "c", value: 5, u: 0.05 },
    ];
    const r = monteCarlo("a*b/c", inputs, { samples: 2000 });
    const g = propagateUncertainty("a*b/c", { a: { value: 10, uncertainty: 0.1 }, b: { value: 20, uncertainty: 0.2 }, c: { value: 5, uncertainty: 0.05 } });
    expect(r.gum.value).toBe(g.value);
    expect(r.gum.u).toBe(g.uncertainty);
  });
  it("δ of JCGM 101 §7.9: u = 1.05 (1.0 = 10×10⁻¹) → δ = 0.05; u = 0.0632 (63×10⁻³) → 0.0005", () => {
    expect(numericalTolerance(1.05)).toBeCloseTo(0.05, 15);
    expect(numericalTolerance(0.0632)).toBeCloseTo(0.0005, 15);
  });
});

describe("work bounds: Word never freezes", () => {
  it("caps the request and scales with a fixed per-draw cost + the formula's length + its inputs", () => {
    // 2×10⁶ / (6 + 1 + 2·1) = 222 222; 2×10⁶ / (6 + 300 + 2) = 6493.
    expect(plannedSamples(1e9, 1)).toBe(222222);
    expect(plannedSamples(1e9, 1)).toBeLessThanOrEqual(MC_MAX_SAMPLES);
    expect(plannedSamples(1e9, 300)).toBe(6493);
    expect(plannedSamples(20000, 5)).toBe(20000);
    expect(plannedSamples(1e9, 1e6)).toBe(1000); // never below the floor that places a 2.5 % tail
  });
  it("a long formula is reduced, and the answer says so", () => {
    const long = Array.from({ length: 60 }, () => "a").join("+"); // 119 characters
    const r = tryMonteCarlo(`monte carlo ${long} a = 1 ± 0.1 samples 1000000`)!;
    expect(plain(r.caveats.join("\n"))).toMatch(/472 440 draws \(capped from 1 000 000 to keep Word responsive\)\./); // 6×10⁷ / (6 + 119 + 2), compiled
  });
  it("10^7 samples is read as ten million and capped", () => {
    const r = tryMonteCarlo("monte carlo a*b a = 1 ± 0.1, b = 2 ± 0.1 samples 10^7 seed 3")!;
    expect(plain(r.caveats.join("\n"))).toMatch(/capped from 10 000 000/);
  });
});

describe("the verb, through the pane's decision (studentPackVerb on the RAW input)", () => {
  const brief = "monte carlo  a*b/c  a = 10.0 ± 0.1, b = 4.00 ± 0.05, c = 2.0 ± 0.1";
  it("answers the brief's example with the inputs as typed, the seed and the verdict", () => {
    const r = studentPackVerb(brief)!;
    expect(r.title).toBe("Monte Carlo uncertainty propagation");
    const t = plain(r.lines.map((l) => l.text).join("\n"));
    expect(t).toMatch(/^y = a·b\/c$/m);
    expect(t).toMatch(/^Monte Carlo: mean 20\.\d, standard deviation 1\.1$/m);
    expect(t).toMatch(/^95 % coverage interval \[18\.1, 22\.3\]$/m);
    expect(t).toMatch(/^First-order \(GUM\): 20\.0 ± 1\.1 {2}\(95 %: 20\.0 ± 2\.1\)$/m); // u = 1.05 exactly, to 2 figures
    expect(t).toMatch(/The two DISAGREE/);
    expect(t).toMatch(/a = 10\.0 ± 0\.1, b = 4\.00 ± 0\.05, c = 2\.0 ± 0\.1/);
    expect(t).toMatch(/100 000 draws, seed 1/);
    expect(r.caveats.join("\n")).toMatch(/NORMAL input with standard deviation u/);
    expect(r.caveats.join("\n")).toMatch(/correlated inputs are not supported/);
  });
  it("draws a histogram with at most 50 bins, the GUM curve and the 95 % interval", () => {
    const r = studentPackVerb(brief)!;
    expect(r.svg).toMatch(/^<svg /);
    const bars = (r.svg!.match(/fill="#9DB3C4"/g) ?? []).length - 1; // minus the legend swatch
    expect(bars).toBe(MC_HIST_BINS);
    expect(MC_HIST_BINS).toBeLessThanOrEqual(50);
    expect(r.svg).toMatch(/<polyline [^>]*stroke="#B91C1C"/);
    expect(r.svg).toMatch(/95 % interval/);
    expect(plain(r.alt!)).toMatch(/Histogram of 100 000 Monte Carlo draws/);
  });
  it("an output name and constants are read; unused inputs named", () => {
    const r = tryMonteCarlo("monte carlo P = V^2/R, V = 12.0 ± 0.1, R = 4.7 ± 0.05, k = 3 samples 5000")!;
    const t = r.lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/^P = V²\/R$/m);
    expect(t).toMatch(/k = 3 \(exact\)/);
    expect(r.caveats.join("\n")).toMatch(/Not used by the formula: k\./);
  });
  it("heavy tails: 1/c with c = 0.1 ± 0.1 reports percentiles only", () => {
    const r = tryMonteCarlo("monte carlo 1/c c = 0.1 ± 0.1")!;
    const t = r.lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/do NOT settle/);
    expect(t).not.toMatch(/standard deviation \d/);
    expect(t).not.toMatch(/First-order/);
  });
  it("refuses by name", () => {
    expect(tryMonteCarlo("monte carlo sqrt(x) x = 0.1 ± 1")!.caveats[0]).toMatch(/draws made the formula non-finite \(first at x = −/);
    expect(tryMonteCarlo("monte carlo a*d a = 1 ± 0.1")!.caveats[0]).toBe("“d” appears in the formula but has no value — give it as d = value ± uncertainty.");
    expect(tryMonteCarlo("monte carlo a*b a = 1, b = 2")!.caveats[0]).toMatch(/No input carries an uncertainty/);
    expect(tryMonteCarlo("monte carlo a*b a = 1 ± -0.1, b = 2 ± 0.1")!.caveats[0]).toMatch(/negative uncertainty/);
    expect(tryMonteCarlo("monte carlo a*b correlated a = 1 ± 0.1, b = 2 ± 0.1")!.caveats[0]).toMatch(/Correlated inputs are not supported/);
    expect(tryMonteCarlo("monte carlo integration of x^2 from 0 to 1")!.caveats[0]).toMatch(/For an integral, use the Integral kind/);
    expect(tryMonteCarlo("monte carlo a*b")!.caveats[0]).toMatch(/Give the formula and then each input/);
    expect(tryMonteCarlo("monte carlo a*b a = 1 ± 0.1 seed x")!.caveats[0]).toMatch(/The seed must be a whole number/);
  });
  it("is not claimed without the words", () => {
    expect(tryMonteCarlo("a*b/c a = 10.0 ± 0.1")).toBeNull();
    expect(tryMonteCarlo("E = mc^2")).toBeNull();
  });
});

describe("display contract", () => {
  it("counts are grouped with thin spaces, negatives use U+2212", () => {
    expect(fmtCount(100000)).toBe(`100${THIN}000`);
    expect(fmtCount(1000)).toBe("1000");
    const r = tryMonteCarlo("monte carlo a - 5 a = 1 ± 0.1 samples 2000")!;
    const t = r.lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/mean −4\.00/);
    expect(t).not.toMatch(/(^|[\s(\[,])-\d/m);
    expect(t).not.toMatch(/\de[+-]?\d/);
  });
  it("the histogram's own labels carry no hyphen-minus numbers", () => {
    const r = monteCarlo("a - 5", [{ name: "a", value: 1, u: 0.1 }], { samples: 2000 });
    const svg = mcHistogramSvg(r, "y");
    expect(svg).not.toMatch(/>-\d/);
  });
});
