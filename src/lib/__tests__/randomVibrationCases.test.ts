// Release E, gap #12 — the FIXED CASE TABLE for random vibration, base excitation and shaft critical speeds.
// Oracle values were computed by the integrator (closed forms + numpy, ~/jurislab-relE/oracle_vib.py). Every later fix
// round must keep every row's outcome (cumulative gate); reviewers add rows at the end.
import { miles, psdProfile, baseExcitation, roundSection, uniformShaftCriticals, massShaft, dunkerley } from "../randomVibration";
import { RANDOM_VIBRATION_CALCS } from "../randomVibrationCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";

const calc = (id: string) => {
  const c = RANDOM_VIBRATION_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
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
/** |a − b| ≤ tol·|b| (the table gives six significant figures). */
const near = (a: number, b: number, tol = 5e-6): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.abs(b));
};

const NAVMAT = "20 0.01\n80 0.04\n350 0.04\n2000 0.007";
const RPM = 60 / (2 * Math.PI);

describe("fixed case table (Release E vibration)", () => {
  test("Miles fn 100 Hz, Q 10, ASD 0.04 g²/Hz → Grms 7.92665 g; x_rms 0.196902 mm; 3σ 0.590707 mm", () => {
    const m = miles(100, 10, 0.04);
    near(m.grms, 7.92665);
    near(m.xRms * 1000, 0.196902);
    near(m.x3Sigma * 1000, 0.590707);
    // The same row through the pane tool: fn 100 Hz sits on the NAVMAT 0.04 g²/Hz plateau.
    const o = run("vib-random-psd", { psd: NAVMAT, fn: "100", dkind: "q", damp: "10" });
    expect(o.ok).not.toBe(false);
    near(out(o, "asdFn"), 0.04);
    near(out(o, "milesGrms"), 7.92665);
    near(out(o, "xRms"), 0.196902);
    near(out(o, "x3Sigma"), 0.590707);
  });

  test("NAVMAT P-9492 profile → area 36.7016 g², Grms 6.05818 g; slopes +3.01 then −3.01 dB/oct", () => {
    const p = psdProfile([[20, 0.01], [80, 0.04], [350, 0.04], [2000, 0.007]]);
    if (!p.ok) throw new Error(p.error);
    near(p.area, 36.7016);
    near(p.grms, 6.05818);
    expect(p.segments[0].dbPerOct).toBeCloseTo(3.01, 2);
    expect(p.segments[1].dbPerOct).toBeCloseTo(0, 10);
    expect(p.segments[2].dbPerOct).toBeCloseTo(-3.01, 2);
    const o = run("vib-random-psd", { psd: NAVMAT, fn: "" });
    near(out(o, "area"), 36.7016);
    near(out(o, "grms"), 6.05818);
    expect(o.text).toContain("+3.01");
    expect(o.text).toContain("−3.01");
  });

  test("transmissibility r = 1, ζ 0.05 → T = 10.0499", () => {
    const r = baseExcitation(100, 0.05, 100, { kind: "acc", amplitude: 1 });
    if (!r.ok) throw new Error(r.error);
    near(r.T, 10.0499);
    near(out(run("vib-base-excitation", { fn: "100", f: "100", dkind: "zeta", damp: "0.05" }), "T"), 10.0499);
  });

  test("r = 2, ζ 0.05 → T = 0.339182", () => {
    const r = baseExcitation(100, 0.05, 200, { kind: "acc", amplitude: 1 });
    if (!r.ok) throw new Error(r.error);
    near(r.T, 0.339182);
    near(out(run("vib-base-excitation", { fn: "100", f: "200", dkind: "zeta", damp: "0.05" }), "T"), 0.339182);
  });

  test.each([0.001, 0.01, 0.05, 0.2, 0.5, 0.9])("r = √2 (ζ %p) → T = 1", (z) => {
    const r = baseExcitation(100, z, 100 * Math.SQRT2, { kind: "acc", amplitude: 1 });
    if (!r.ok) throw new Error(r.error);
    expect(r.T).toBeCloseTo(1, 10);
  });

  test("uniform steel shaft d 50 mm, L 1 m, E 200 GPa, ρ 7850 → ω₁ 622.716 rad/s = 5946.50 rpm", () => {
    const s = roundSection(0.05);
    if (!("I" in s)) throw new Error("section");
    const w = uniformShaftCriticals(200e9, s, 7850, 1);
    if (!Array.isArray(w)) throw new Error(w.error);
    near(w[0], 622.716);
    near(w[0] * RPM, 5946.5);
    const o = run("vib-shaft-critical", { masses: "", op: "" });
    near(out(o, "shaft1RadS"), 622.716);
    near(out(o, "shaft1Rpm"), 5946.5);
  });

  test("massless shaft, central 20 kg, same EI → ω 383.748 rad/s = 3664.52 rpm", () => {
    const s = roundSection(0.05) as { I: number; A: number };
    const m = massShaft(200e9, s.I, 1, [{ m: 20, x: 0.5 }]);
    if (!m.ok) throw new Error(m.error);
    near(m.rayleigh, 383.748);
    near(m.rayleigh * RPM, 3664.52);
    const o = run("vib-shaft-critical", { rho: "", masses: "20 0.5" });
    near(out(o, "rayleighRadS"), 383.748);
    near(out(o, "rayleighRpm"), 3664.52);
  });

  test("Dunkerley of the two → ω 326.696 rad/s = 3119.71 rpm", () => {
    const s = roundSection(0.05) as { I: number; A: number };
    const w = uniformShaftCriticals(200e9, s, 7850, 1) as number[];
    const m = massShaft(200e9, s.I, 1, [{ m: 20, x: 0.5 }]);
    if (!m.ok) throw new Error(m.error);
    const wd = dunkerley([w[0], m.alone[0]]);
    near(wd, 326.696);
    near(wd * RPM, 3119.71);
    const o = run("vib-shaft-critical");
    near(out(o, "dunkerleyRadS"), 326.696);
    near(out(o, "dunkerleyRpm"), 3119.71);
  });

  test.each([
    ["frequency 0", "0 0.01\n80 0.04\n2000 0.007", /frequency 0 Hz.*greater than zero/],
    ["negative frequency", "-20 0.01\n80 0.04", /greater than zero/],
    ["negative ASD", "20 0.01\n80 -0.04\n2000 0.007", /ASD −0\.04 g²\/Hz.*greater than zero/],
    ["zero ASD", "20 0.01\n80 0\n2000 0.007", /ASD 0 g²\/Hz.*greater than zero/],
  ])("PSD row with %s → named refusal", (_n, psd, msg) => {
    const o = run("vib-random-psd", { psd });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
  });

  test.each([
    ["decreasing", "20 0.01\n80 0.04\n50 0.04"],
    ["repeated", "20 0.01\n80 0.04\n80 0.02\n2000 0.007"],
  ])("non-increasing frequencies (%s) → named refusal", (_n, psd) => {
    const o = run("vib-random-psd", { psd });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/does not increase.*strictly increasing frequency/);
  });
});
