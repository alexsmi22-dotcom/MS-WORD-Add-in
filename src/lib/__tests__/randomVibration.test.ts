// Release E, gap #12 — engine, adversarial and pane-glue tests for randomVibration.ts / randomVibrationCalcs.ts.
// The fixed case table lives in randomVibrationCases.test.ts.
//
// EXTERNAL ORACLE (C:\Users\AlexanderSmith\jurislab-oracle-venv, scipy 1.x), recorded inline:
//
//   import math; from scipy.integrate import quad
//   g = 9.80665
//   def prof(pts):                       # straight-on-log-log ASD
//       def asd(f):
//           for (f1,a1),(f2,a2) in zip(pts,pts[1:]):
//               if f1 <= f <= f2: n = math.log(a2/a1)/math.log(f2/f1); return a1*(f/f1)**n
//           return 0.0
//       return asd
//   T2 = lambda r,z: (1+(2*z*r)**2)/((1-r*r)**2+(2*z*r)**2)
//   M2 = lambda r,z: 1/((1-r*r)**2+(2*z*r)**2)
//   def exact(pts, fn, z):               # per segment, resonance as a breakpoint, epsrel 1e-12
//       ...quad(lambda f: T2(f/fn,z)*asd(f), f1, f2, points=[fn] if f1<fn<f2 else None, limit=500, epsrel=1e-12)
//       return sqrt(acc), sqrt(disp)*g/(2*pi*fn)**2*1000      # g rms, mm rms
//   NAVMAT fn 100 ζ 0.05      → (7.819853667213571, 0.1932641461240246)
//   ten-point fn 1800 ζ 0.01  → (35.264653003536566, 0.0027032109799875765); area 126.98707932710681
//   white 0.01 g²/Hz 20–2000 Hz, fn 300 ζ 0.01 → 15.346317171111783 (Miles 15.349900619197326)
//
//   Shaft (numpy; SS influence b·x(L²−b²−x²)/(6EIL)), E 200 GPa, d 50 mm, L 1 m, massless, masses 20@0.3, 15@0.55,
//   8@0.6: Rayleigh 291.73625896448584, Dunkerley 285.29127167609744, exact (eig of F·M) 291.6923033357898 rad/s.
import {
  segmentArea,
  psdProfile,
  asdAt,
  miles,
  sdofRandomResponse,
  baseExcitation,
  transmissibilityPeak,
  transmissibilityCurve,
  roundSection,
  uniformShaftCriticals,
  massShaft,
  dunkerley,
  selfInfluenceSS,
  speedMargin,
  RESPONSE_MAX_EVALS,
  PSD_MAX_POINTS,
  type PsdProfile,
} from "../randomVibration";
import * as beam from "../beam";
import { parseRatLiteral } from "../cas";
import { modalAnalysis, transmissibility } from "../vibration";
import { RANDOM_VIBRATION_CALCS } from "../randomVibrationCalcs";
import { psdChartSvg, transmissibilityChartSvg, shaftCriticalSvg } from "../randomVibrationCharts";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const near = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(Math.abs(b), 1e-300));
};
const prof = (pts: Array<[number, number]>): PsdProfile => {
  const p = psdProfile(pts);
  if (!p.ok) throw new Error(p.error);
  return p;
};
const NAV: Array<[number, number]> = [[20, 0.01], [80, 0.04], [350, 0.04], [2000, 0.007]];
const TEN: Array<[number, number]> = [[10, 0.002], [15, 0.01], [40, 0.01], [60, 0.05], [100, 0.05], [150, 0.2], [300, 0.2], [500, 0.08], [1000, 0.08], [2000, 0.005]];
const E = 200e9;
const I50 = (Math.PI * 0.05 ** 4) / 64;

const calc = (id: string) => RANDOM_VIBRATION_CALCS.find((x) => x.id === id)!;
const run = (id: string, over: Record<string, string> = {}): AnalyzeOutput => {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};
const out = (o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key}: ${o.text}`);
  return v.value;
};

describe("PSD segment integration", () => {
  test("flat segment is a₁(f₂ − f₁) and the n = −1 segment is a₁f₁·ln(f₂/f₁), by one formula", () => {
    near(segmentArea(80, 0.04, 350, 0.04), 0.04 * 270, 1e-14);
    near(segmentArea(350, 0.04, 2000, 0.04 * (350 / 2000)), 0.04 * 350 * Math.log(2000 / 350), 1e-13);
  });
  test("continuous through n = −1: no cancellation either side", () => {
    const exact = 0.04 * 350 * Math.log(2000 / 350);
    for (const eps of [1e-15, 1e-12, 1e-9, -1e-12, -1e-9]) {
      const a2 = 0.04 * (350 / 2000) * (1 + eps);
      near(segmentArea(350, 0.04, 2000, a2), exact, 1e-8);
    }
  });
  test("a general power law matches the closed form", () => {
    // n = 2: ∫ a₁(f/f₁)² df = a₁/(3f₁²)(f₂³ − f₁³)
    near(segmentArea(10, 1, 100, 100), (1 / 300) * (1e6 - 1e3), 1e-12);
  });
  test("ten-point profile area against scipy quad", () => {
    near(prof(TEN).area, 126.98707932710681, 1e-10);
  });
});

describe("PSD profile refusals and caps", () => {
  test.each([
    [[[20, 0.01]] as Array<[number, number]>, /at least two breakpoints/],
    [[[20, 0.01], [NaN, 0.02]] as Array<[number, number]>, /finite/],
    [[[20, 0.01], [40, Infinity]] as Array<[number, number]>, /finite/],
    [[[20, 0.01], [3e7, 0.01]] as Array<[number, number]>, /six decades/],
  ])("%p refused", (pts, msg) => {
    const p = psdProfile(pts);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(msg);
  });
  test("more than the breakpoint cap is refused", () => {
    const pts = Array.from({ length: PSD_MAX_POINTS + 1 }, (_, i) => [10 + i, 0.01] as [number, number]);
    expect(psdProfile(pts).ok).toBe(false);
  });
  test("asdAt interpolates log-log and is null outside the band", () => {
    const p = prof(NAV);
    near(asdAt(p, 40)!, 0.01 * 2, 1e-12); // +3 dB/oct: one octave doubles
    near(asdAt(p, 700)!, 0.04 / 2, 1e-12); // −3 dB/oct: one octave halves
    expect(asdAt(p, 80)).toBe(0.04);
    expect(asdAt(p, 19.9)).toBeNull();
    expect(asdAt(p, 2001)).toBeNull();
  });
  test("tiny and huge ASD magnitudes integrate finitely", () => {
    near(prof([[20, 1e-12], [2000, 1e-12]]).area, 1980e-12, 1e-12);
    near(prof([[20, 1e6], [2000, 1e6]]).area, 1980e6, 1e-12);
  });
});

describe("Miles and the exact SDOF response", () => {
  test("exact response against scipy (NAVMAT, fn 100 Hz, ζ 0.05)", () => {
    const r = sdofRandomResponse(prof(NAV), 100, 0.05);
    if (!("grms" in r)) throw new Error(r.error);
    near(r.grms, 7.819853667213571, 1e-7);
    near(r.xRms * 1000, 0.1932641461240246, 1e-7);
  });
  test("exact response against scipy (ten points, fn 1800 Hz, Q 50)", () => {
    const r = sdofRandomResponse(prof(TEN), 1800, 0.01);
    if (!("grms" in r)) throw new Error(r.error);
    near(r.grms, 35.264653003536566, 1e-6);
    near(r.xRms * 1000, 0.0027032109799875765, 1e-6);
  });
  test("on a white profile Miles and the exact response agree (scipy: 15.34632 vs 15.34990)", () => {
    const p = prof([[20, 0.01], [2000, 0.01]]);
    const r = sdofRandomResponse(p, 300, 0.01);
    if (!("grms" in r)) throw new Error(r.error);
    near(r.grms, 15.346317171111783, 1e-6);
    near(miles(300, 50, 0.01).grms, 15.349900619197326, 1e-12);
  });
  test("work bound: the widest profile at the lightest damping stays under the evaluation cap", () => {
    const p = prof([[1, 0.01], [1e6, 0.01]]);
    const r = sdofRandomResponse(p, 1000, 0.001);
    if (!("evals" in r)) throw new Error(r.error);
    expect(r.evals).toBeLessThanOrEqual(RESPONSE_MAX_EVALS);
    expect(Number.isFinite(r.grms)).toBe(true);
  });
  test.each([[0], [-1], [NaN], [Infinity]])("fn %p refused", (fn) => {
    expect(sdofRandomResponse(prof(NAV), fn, 0.05)).toHaveProperty("ok", false);
  });
  test.each([[0], [0.0005], [1], [1.5], [NaN]])("ζ %p refused", (z) => {
    expect(sdofRandomResponse(prof(NAV), 100, z)).toHaveProperty("ok", false);
  });
});

describe("base excitation", () => {
  test("uses vibration.ts transmissibility; displacement input relations hold", () => {
    const Y = 0.0005;
    const r = baseExcitation(10, 0.1, 37, { kind: "disp", amplitude: Y });
    if (!r.ok) throw new Error(r.error);
    near(r.T, transmissibility(3.7, 0.1), 1e-15);
    near(r.absDisp, r.T * Y, 1e-14);
    // Relative displacement Z = r²·M·Y for a displacement input.
    near(r.relDisp, 3.7 * 3.7 * r.M * Y, 1e-12);
    near(r.baseAcc, Y * (2 * Math.PI * 37) ** 2, 1e-14);
    expect(r.isolating).toBe(true);
  });
  test("transmissibility peak formula matches a dense scan", () => {
    for (const z of [0.01, 0.05, 0.2, 0.6]) {
      const pk = transmissibilityPeak(z);
      let best = 0, at = 0;
      for (let i = 0; i <= 200000; i++) {
        const r = 0.5 + i * 1e-5;
        const t = transmissibility(r, z);
        if (t > best) { best = t; at = r; }
      }
      near(pk.T, best, 1e-8);
      expect(Math.abs(pk.r - at)).toBeLessThan(2e-5);
    }
  });
  test("the figure curve resolves the peak", () => {
    const z = 0.002;
    const c = transmissibilityCurve(z, 0.1, 10);
    const top = Math.max(...c.map(([, t]) => t));
    expect(top).toBeGreaterThan(0.999 * transmissibilityPeak(z).T);
  });
  test.each([
    [0, 0.05, 10, 1],
    [10, 0.05, 0, 1],
    [10, 0, 10, 1],
    [10, 0.05, 10, 0],
    [10, 0.05, 10, -1],
    [10, 0.05, 1e5, 1],
    [NaN, 0.05, 10, 1],
  ])("fn %p ζ %p f %p amplitude %p refused", (fn, z, f, a) => {
    expect(baseExcitation(fn, z, f, { kind: "acc", amplitude: a }).ok).toBe(false);
  });
});

describe("shaft critical speeds", () => {
  test("self-influence closed form equals beam.ts's unit-load deflection (one beam-deflection answer)", () => {
    for (const L of [1, 1.234, 0.3]) {
      for (const f of [0.05, 0.2, 0.5, 0.731, 0.95]) {
        const a = L * f;
        const b = beam.analyzeBeam({
          length: parseRatLiteral(String(L))!,
          supports: [{ kind: "pin", x: parseRatLiteral("0")! }, { kind: "roller", x: parseRatLiteral(String(L))! }],
          loads: [{ kind: "point", x: parseRatLiteral(String(a))!, p: parseRatLiteral("1")! }],
        });
        if (!b.ok) throw new Error(b.error);
        near(selfInfluenceSS(E * I50, L, a), -b.eiDeflectionAt(a) / (E * I50), 1e-10);
      }
    }
  });
  test("Rayleigh, Dunkerley and the exact lumped-mass critical against numpy; R ≥ exact ≥ D", () => {
    const ms = [{ m: 20, x: 0.3 }, { m: 15, x: 0.55 }, { m: 8, x: 0.6 }];
    const r = massShaft(E, I50, 1, ms);
    if (!r.ok) throw new Error(r.error);
    near(r.rayleigh, 291.73625896448584, 1e-9);
    const d = dunkerley(r.alone);
    near(d, 285.29127167609744, 1e-9);
    // Exact first critical by vibration.ts modalAnalysis on K = F⁻¹ (F from beam.ts unit loads).
    const F = ms.map((qi) =>
      ms.map((qj) => {
        const b = beam.analyzeBeam({
          length: parseRatLiteral("1")!,
          supports: [{ kind: "pin", x: parseRatLiteral("0")! }, { kind: "roller", x: parseRatLiteral("1")! }],
          loads: [{ kind: "point", x: parseRatLiteral(String(qj.x))!, p: parseRatLiteral("1")! }],
        });
        if (!b.ok) throw new Error(b.error);
        return -b.eiDeflectionAt(qi.x) / (E * I50);
      }),
    );
    const det = (m: number[][]): number =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(F);
    const K = [0, 1, 2].map((i) =>
      [0, 1, 2].map((j) => {
        const minor = F.filter((_, r2) => r2 !== j).map((row) => row.filter((_, c2) => c2 !== i));
        return ((i + j) % 2 ? -1 : 1) * (minor[0][0] * minor[1][1] - minor[0][1] * minor[1][0]) / D;
      }),
    );
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? ms[i].m : 0)));
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    near(modal.frequencies[0], 291.6923033357898, 1e-7);
    expect(r.rayleigh).toBeGreaterThanOrEqual(modal.frequencies[0]);
    expect(modal.frequencies[0]).toBeGreaterThanOrEqual(d);
  });
  test("one off-centre mass: Rayleigh is exact (equals the mass alone)", () => {
    const r = massShaft(E, I50, 1.3, [{ m: 7, x: 0.2 }]);
    if (!r.ok) throw new Error(r.error);
    near(r.rayleigh, r.alone[0], 1e-12);
    near(r.rayleigh, Math.sqrt(1 / (7 * selfInfluenceSS(E * I50, 1.3, 0.2))), 1e-12);
  });
  test("work bound: twelve masses cost exactly one beam.ts solve", () => {
    const spy = jest.spyOn(beam, "analyzeBeam");
    try {
      const ms = Array.from({ length: 12 }, (_, i) => ({ m: 1.1 + i * 0.37, x: 0.05 + i * 0.0951 }));
      const r = massShaft(E, I50, 1.234, ms);
      expect(r.ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
  test.each([
    [[], /at least one mass/],
    [Array.from({ length: 13 }, (_, i) => ({ m: 1, x: 0.05 + i * 0.07 })), /At most 12/],
    [[{ m: 1, x: 0 }], /strictly between the bearings/],
    [[{ m: 1, x: 1 }], /strictly between the bearings/],
    [[{ m: 1, x: 1.2 }], /strictly between the bearings/],
    [[{ m: 0, x: 0.5 }], /positive number/],
    [[{ m: -3, x: 0.5 }], /positive number/],
    [[{ m: NaN, x: 0.5 }], /positive number/],
  ])("masses %p refused", (ms, msg) => {
    const r = massShaft(E, I50, 1, ms);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
  test("sections and uniform criticals", () => {
    expect(roundSection(0.05, 0.05)).toHaveProperty("ok", false);
    expect(roundSection(0.05, 0.06)).toHaveProperty("ok", false);
    expect(roundSection(0)).toHaveProperty("ok", false);
    const h = roundSection(0.05, 0.03) as { I: number; A: number };
    near(h.I, (Math.PI * (0.05 ** 4 - 0.03 ** 4)) / 64, 1e-14);
    const w = uniformShaftCriticals(E, h, 7850, 1) as number[];
    near(w[1] / w[0], 4, 1e-14);
    near(w[2] / w[0], 9, 1e-14);
    expect(uniformShaftCriticals(E, h, 0, 1)).toHaveProperty("ok", false);
    expect(speedMargin(80, 100)).toBeCloseTo(-0.2, 15);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Pane glue
// ---------------------------------------------------------------------------------------------------------------

/** The display contract on an ok result's text and every figure's text. */
function displayClean(o: AnalyzeOutput): void {
  expect(o.ok).not.toBe(false);
  const svgText = (o.blocks ?? []).flatMap((b) => (b.kind === "plot" ? [...b.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]) : []));
  const tableText = (o.blocks ?? []).flatMap((b) => (b.kind === "table" ? b.rows.flat() : []));
  for (const t of [o.text, ...svgText, ...tableText]) {
    expect(t).not.toMatch(/NaN|Infinity|undefined/);
    expect(t).not.toMatch(/\u2014/);
    expect(t).not.toMatch(/\d[eE][-+]?\d/);
    expect(t).not.toMatch(/\^/);
    expect(t).not.toMatch(/(^|[\s(=,:])-\d/);
  }
  // Every formula typesets.
  for (const b of o.blocks ?? []) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
  for (const v of o.outputs ?? []) expect(Number.isFinite(v.value)).toBe(true);
}

describe("the three calculators", () => {
  test("registry: ids, group, unit contract, every field read", () => {
    expect(RANDOM_VIBRATION_CALCS.map((c) => c.id)).toEqual(["vib-random-psd", "vib-base-excitation", "vib-shaft-critical"]);
    for (const c of RANDOM_VIBRATION_CALCS) {
      expect(c.group).toBe("Vibration");
      expect(c.unitContract).toBe("converts");
      // Each declared key is read: compute asks for it.
      const asked = new Set<string>();
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      c.compute((k) => {
        asked.add(k);
        return vals[k] ?? "";
      });
      for (const f of c.fields) expect({ id: c.id, key: f.key, read: asked.has(f.key) }).toEqual({ id: c.id, key: f.key, read: true });
    }
  });

  test.each(RANDOM_VIBRATION_CALCS.map((c) => [c.id]))("%s at its defaults: clean result, a table, a figure, formulas", (id) => {
    const o = run(id);
    displayClean(o);
    const kinds = (o.blocks ?? []).map((b) => b.kind);
    expect(kinds).toContain("plot");
    expect(kinds).toContain("table");
    expect(kinds).toContain("math");
  });

  test("random: profile only (fn blank) still draws and gives Grms", () => {
    const o = run("vib-random-psd", { fn: "" });
    displayClean(o);
    expect(o.outputs?.map((x) => x.key)).toEqual(["area", "grms"]);
  });
  test("random: fn in kHz converts and says so", () => {
    const o = run("vib-random-psd", { fn: "0.1 kHz" });
    displayClean(o);
    expect(out(o, "milesGrms")).toBeCloseTo(7.92665, 4);
    expect(o.text).toMatch(/Units read: Natural frequency: 0\.1 kHz = 100\.0 Hz/);
  });
  test("random: ζ form equals the Q form", () => {
    expect(out(run("vib-random-psd", { dkind: "zeta", damp: "0.05" }), "exactGrms")).toBeCloseTo(out(run("vib-random-psd"), "exactGrms"), 12);
  });
  test("random: heavy damping is flagged; a profile that is not white says Miles differs", () => {
    expect(run("vib-random-psd", { damp: "3" }).text).toMatch(/more than light damping/);
    const o = run("vib-random-psd", { psd: TEN.map(([f, a]) => `${f} ${a}`).join("\n"), fn: "1800", damp: "50" });
    displayClean(o);
    expect(o.text).toMatch(/Miles is .* (above|below) the exact response/);
  });
  test("random: decimal-comma block through RULE N", () => {
    const o = run("vib-random-psd", { psd: "20\t0,01\n80\t0,04\n350\t0,04\n2000\t0,007", fn: "" });
    displayClean(o);
    expect(out(o, "grms")).toBeCloseTo(6.05818, 5);
  });
  test.each([
    [{ fn: "5 kg" }, /Natural frequency: .*not compatible/],
    [{ fn: "100 rpm" }, /Natural frequency/],
    [{ fn: "abc" }, /does not start with a number/],
    [{ fn: "10" }, /outside the profile/],
    [{ fn: "5000" }, /outside the profile/],
    [{ damp: "0.4" }, /Q must be a number greater than 0\.5/],
    [{ damp: "x" }, /Q must be/],
    [{ dkind: "zeta", damp: "1.2" }, /ζ must be/],
    [{ psd: "" }, /nothing to read/],
    [{ psd: "20 0.01" }, /at least two breakpoints/],
    [{ psd: "20 0.01 3\n80 0.04 0" }, /exactly 2 numbers/],
    [{ psd: "20 0.01\n80 +3dB" }, /PSD breakpoints/],
    [{ psd: "20 0.01\n80 -" }, /exactly 2 numbers/],
  ])("random refuses %p", (over, msg) => {
    const o = run("vib-random-psd", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
    expect(o.text).not.toMatch(/\u2014/);
  });

  test("base: g, m/s² and displacement inputs agree", () => {
    const a = out(run("vib-base-excitation", { ikind: "g", amp: "2" }), "absAccG");
    expect(out(run("vib-base-excitation", { ikind: "g", amp: "2 g" }), "absAccG")).toBe(a);
    expect(out(run("vib-base-excitation", { ikind: "acc", amp: "19.6133 m/s^2" }), "absAccG")).toBeCloseTo(a, 10);
    // 2 g at 100 Hz is a displacement of 2·9.80665/(2π·100)² m.
    const Y = (2 * 9.80665) / (2 * Math.PI * 100) ** 2;
    expect(out(run("vib-base-excitation", { ikind: "disp", amp: `${Y * 1000} mm` }), "absAccG")).toBeCloseTo(a, 10);
    expect(out(run("vib-base-excitation", { ikind: "disp", amp: `${Y * 1e6} um` }), "absAccG")).toBeCloseTo(a, 8);
  });
  test("base: region wording", () => {
    expect(run("vib-base-excitation").text).toMatch(/ISOLATES/);
    expect(run("vib-base-excitation", { f: "26" }).text).toMatch(/AMPLIFIES: it is near resonance/);
    expect(run("vib-base-excitation", { f: "5" }).text).toMatch(/AMPLIFIES slightly/);
  });
  test.each([
    [{ amp: "2 kg" }, /not a number of g/],
    [{ ikind: "acc", amp: "2 kg" }, /Base acceleration: .*not compatible/],
    [{ ikind: "disp", amp: "1 s" }, /Base displacement/],
    [{ fn: "" }, /Natural frequency: this field is required/],
    [{ f: "0" }, /excitation frequency must be a positive/],
    [{ amp: "0" }, /amplitude must be a positive/],
    [{ dkind: "zeta", damp: "0" }, /ζ must be/],
  ])("base refuses %p", (over, msg) => {
    const o = run("vib-base-excitation", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
  });

  test("shaft: units through the selects equal SI", () => {
    const si = out(run("vib-shaft-critical", { masses: "20 0.4" }), "dunkerleyRadS");
    expect(out(run("vib-shaft-critical", { masses: `${20 / 0.45359237} 400`, munit: "lb", xunit: "mm" }), "dunkerleyRadS")).toBeCloseTo(si, 6);
    expect(out(run("vib-shaft-critical", { masses: `20 ${0.4 / 0.0254}`, xunit: "in" }), "dunkerleyRadS")).toBeCloseTo(si, 6);
    expect(out(run("vib-shaft-critical", { E: "29007547.5 psi", masses: "20 0.4" }), "dunkerleyRadS")).toBeCloseTo(si, 3);
  });
  test("shaft: ±20 % warning, supercritical, clear", () => {
    expect(run("vib-shaft-critical").text).toMatch(/WARNING: the operating speed 3000 rpm is within ±20 % of the first critical \(Dunkerley\), 3120 rpm/);
    expect(run("vib-shaft-critical", { op: "6000 rpm" }).text).toMatch(/SUPERCRITICAL/);
    expect(run("vib-shaft-critical", { op: "1000" }).text).toMatch(/clear of the computed critical/);
    expect(run("vib-shaft-critical", { op: "300 rad/s" }).text).toMatch(/WARNING/);
    expect(run("vib-shaft-critical", { masses: "", op: "24000 rpm" }).text).toMatch(/within ±20 % of critical 2/);
    expect(run("vib-shaft-critical").text).toMatch(/convention, not a code requirement/);
  });
  test("shaft: many masses draw with subscript labels and stay clean", () => {
    const o = run("vib-shaft-critical", { rho: "", masses: Array.from({ length: 12 }, (_, i) => `${5 + i} ${0.05 + i * 0.075}`).join("\n") });
    displayClean(o);
    const svg = (o.blocks ?? []).find((b) => b.kind === "plot");
    expect(svg && svg.kind === "plot" && svg.svg).toMatch(/m₁₂/);
  });
  test.each([
    [{ rho: "", masses: "" }, /Give the shaft's density/],
    [{ d: "50 kg" }, /Shaft diameter/],
    [{ di: "60 mm" }, /bore must be smaller/],
    [{ masses: "20 1.5" }, /strictly between the bearings/],
    [{ masses: "20" }, /exactly 2 numbers/],
    [{ masses: "20 0.5 3" }, /exactly 2 numbers/],
    [{ op: "-5 rpm" }, /operating speed must be greater than zero/],
    [{ op: "100 Hz" }, /Operating speed/],
    [{ E: "0" }, /Young's modulus must be greater than zero/],
    [{ masses: Array.from({ length: 13 }, (_, i) => `1 ${0.05 + i * 0.07}`).join("\n") }, /more than 12 rows/],
  ])("shaft refuses %p", (over, msg) => {
    const o = run("vib-shaft-critical", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
  });
});

describe("figures are finite, white-backed SVG with Arial text", () => {
  test.each([
    ["psd", () => psdChartSvg(prof(NAV), { fn: 100, zeta: 0.05, grms: 7.82 })],
    ["psd alone", () => psdChartSvg(prof(NAV))],
    ["transmissibility", () => transmissibilityChartSvg(0.05, 4)],
    ["shaft", () => shaftCriticalSvg(1, [[0, 0], [0.5, 1], [1, 0]], [{ x: 0.5, label: "20 kg" }], [{ label: "a", rpm: 3000 }], 2000)],
  ])("%s", (_n, mk) => {
    const svg = (mk as () => string)();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
});
