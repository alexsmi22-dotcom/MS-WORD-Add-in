// Release E3-e: transmission lines, impedance matching, two-port S-parameters. The FIXED CASE TABLE from the brief
// (oracle ~/jurislab-relE/oracle_e3.py) is pinned on the engine (transmissionLine.ts) AND through the pane's own
// registry (TLINE_CALCS compute → named outputs). Later fix rounds keep every row (cumulative gate).
//
// Further reference values, Python venv C:\Users\AlexanderSmith\jurislab-oracle-venv (scikit-rf 2.2.0, numpy, scipy;
// scipy.constants CODATA 2022: μ₀ = 1.25663706127e-6, ε₀ = 8.8541878188e-12, η₀ = 376.7303134118051):
//   freq = rf.Frequency(1, 1, 1, unit="GHz")
//   def skrf_zin(z0, zl, deg):
//       med = rf.media.DefinedGammaZ0(frequency=freq, z0=z0); g = (zl - z0)/(zl + z0)
//       return (med.line(deg, "deg") ** med.load(g)).z[0, 0, 0]
//   skrf_zin(50, 25-30j, 72)   -> 25.00217925314+30.0040312683045j   (Γ −0.149425287356322−0.459770114942529j,
//                                 VSWR 2.87178445068879, RL 6.31310672327514, ML 1.156105116743)
//   skrf_zin(75, 10, 123.4)    -> 31.7037962549855−107.33262625596j  (VSWR 7.5, RL 2.33011138142874)
//   skrf_zin(50, 5000, 30)     -> 1.999400179946−86.5679097514806j   (VSWR 99.9999999999999, ML 14.0658275623732)
//   skrf_zin(50, 20+80j, 10)   -> 39.6328321841746+119.826981847588j (VSWR 9.19120028186381)
//   skrf_zin(50, 100+50j, 1341)-> 21.7718068962596−17.0809677392976j (3.725λ)
//   short at λ/8               -> j50
// Quarter-wave (section at d, then skrf line(90°) of Zt: Zin after the section = 50 Ω to 1e-13):
//   100+50j on 50: d 0.0368959044126083 Zt 80.9016994374947; d 0.286895904412608 Zt 30.9016994374947
// Single stub — d by brentq on Re y(d) = 1 (an independent scan, not the engine's closed form), stub length from
// tan/cot, then the WHOLE network built in skrf (tee + stub line + open/short, line(d), load) gives |S11| < 1e-15:
//   60−80j: d 0.1104232186383 (open 0.344974621635891, short 0.0949746216358915);
//           d 0.259444530622826 (open 0.155025378364109, short 0.405025378364109)
//   75 Ω, 30+40j: d 0.333212729341585 (short 0.106201123205888); d 0.493209500169114 (short 0.393798876794112)
//   50+40j: d 0.25 (open 0.392611643738639); d 0.439440529204578 (open 0.107388356261361)
// Coax: rf.media.Coaxial(Dint, Dout, epsilon_r, tan_delta=0, sigma=1e99).z0:
//   0.91 mm, 2.95 mm, 2.1 -> 48.6621344044676; 0.5 mm, 3.4 mm, 2.25 -> 76.6238588834162
// Microstrip: rf.media.MLine(w, h, t=None, ep_r, tand=0, rho=None, model="hammerstadjensen", disp="none"):
//   3 mm, 1.6 mm, 4.5 -> Z0 50.1083398482762, ep_reff 3.39334733405423
//   0.3 mm, 0.254 mm, 9.8 -> 45.3125576476022, 6.67520144975478
//   0.1 mm, 1 mm, 2.2 -> 202.684941791974, 1.68062316695764; 10 mm, 0.5 mm, 3.0 -> 9.64016146439931, 2.7975707863668
// Two-port: rf.Network(s=S).stability for K; numpy for the rest; G_T also by solving the wave equations directly:
//   amplifier S11 0.61∠−170, S21 2.24∠32, S12 0.05∠16, S22 0.72∠−83: RLin 4.29340329978466, RLout 2.85335007137463,
//   S21 7.00496036668326 dB, iso 26.0205999132796, VSWR 4.128205128205128 / 6.142857142857139, K 1.1797802774995,
//   |Δ| 0.393409179048848, GTUmax 12.199190753602085 dB, U 0.162668474094156, bounds −1.30911793348664 / +1.54205114205423 dB,
//   exact G_T at Γs = S11*, ΓL = S22*: 12.8597641347314 dB (inside the bounds), Zin 12.199029130646247−4.115900297766956j
//   70.71 Ω 60° line renormalised to 50 Ω (skrf): S11 = S22 = 0.25714286+0.13997084j, S21 = S12 = 0.45714286−0.83982505j:
//   lossless (SᴴS = I to 1e-15), reciprocal, K = 1, |Δ| = 1, GTUmax 0.389180660303701 dB, U 0.0937500000000004
// Matching bandwidth (scratch oracle_bw.py: ABCD-matrix cascade, independent of the engine's Γ rotation, brentq edges),
// VSWR 1.5 (|Γ| = 0.2):
//   100 Ω on 50 Ω: qw1 78.36531040612145 % (Pozar's closed form 2 − (4/π)acos(…) gives 78.36531040612147), qw2
//   24.076825601906027 %, short stub 1 36.8017191789036 %, short stub 2 16.080903480093202 %
//   60−80j, open stubs: qw1 12.508299347372498 %, stub1 9.723963700575277 %, stub2 10.067098024034982 %

import {
  bandEdges,
  cAbs,
  coaxZ0,
  cPolar,
  cx,
  inputImpedance,
  microstripZ0,
  quarterWave,
  quarterWaveGammaAt,
  reflection,
  singleStub,
  stubGammaAt,
  twoPort,
  type Cx,
  type Load,
  type Reflection,
} from "../transmissionLine";
import { TLINE_CALCS, readSBlock } from "../tlineCalcs";
import { cxText, matchBandSvg, sParamBarsSvg, smithChartSvg } from "../tlineCharts";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = TLINE_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no ${id}`);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key} in: ${o.text}`);
  return v.value;
};
const refl = (z: Cx | "open" | "short", z0 = 50): Reflection => {
  const load: Load = z === "open" ? { kind: "open" } : z === "short" ? { kind: "short" } : { kind: "z", z };
  const r = reflection(load, z0);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const zin = (z: Cx, z0: number, turns: number): Cx => {
  const r = inputImpedance(refl(z, z0).gamma, z0, turns);
  if (!r.ok || r.zin === null) throw new Error("no zin");
  return r.zin;
};

// ---------------------------------------------------------------------------------------------------------------
// The fixed case table (brief E3-e)
// ---------------------------------------------------------------------------------------------------------------

describe("E3-e fixed case table: engine", () => {
  const r = refl(cx(100, 50));
  test.each([
    ["Z₀ 50, Z_L 100 + 50j → Re Γ 0.4", () => r.gamma.re, 0.4, 1e-12],
    ["→ Im Γ 0.2", () => r.gamma.im, 0.2, 1e-12],
    ["→ |Γ| 0.447214", () => r.mag, 0.447214, 1e-6],
    ["→ VSWR 2.61803", () => r.vswr as number, 2.61803, 1e-5],
    ["→ RL 6.98970 dB", () => r.rlDb as number, 6.9897, 1e-5],
    ["ℓ = λ/8 → Re Z_in 50", () => zin(cx(100, 50), 50, 0.125).re, 50, 1e-9],
    ["ℓ = λ/8 → Im Z_in −50", () => zin(cx(100, 50), 50, 0.125).im, -50, 1e-9],
    ["quarter-wave match of 100 Ω to 50 Ω → 70.7107 Ω", () => (quarterWave(refl(cx(100, 0)), 50) as { solutions: { zt: number }[] }).solutions[0].zt, 70.7107, 1e-4],
  ])("%s", (_n, f, want, tol) => {
    expect(Math.abs((f as () => number)() - (want as number))).toBeLessThan((tol as number) / 2 + 1e-12);
  });
});

describe("E3-e fixed case table: through TLINE_CALCS (the pane's objects)", () => {
  test.each([
    ["Re Γ 0.4", () => out(run("tl-line-termination"), "gammaRe"), 0.4, 1e-12],
    ["Im Γ 0.2", () => out(run("tl-line-termination"), "gammaIm"), 0.2, 1e-12],
    ["|Γ| 0.447214", () => out(run("tl-line-termination"), "gammaMag"), 0.447214, 1e-6],
    ["VSWR 2.61803", () => out(run("tl-line-termination"), "vswr"), 2.61803, 1e-5],
    ["RL 6.98970 dB", () => out(run("tl-line-termination"), "rl"), 6.9897, 1e-5],
    ["λ/8: Re Z_in 50 Ω", () => out(run("tl-line-termination"), "zinRe"), 50, 1e-9],
    ["λ/8: Im Z_in −50 Ω", () => out(run("tl-line-termination"), "zinIm"), -50, 1e-9],
    ["λ/8 typed as 45°: Im Z_in −50 Ω", () => out(run("tl-line-termination", { lenMode: "deg", len: "45" }), "zinIm"), -50, 1e-9],
    ["quarter-wave 100 → 50 Ω: 70.7107 Ω", () => out(run("tl-match"), "qw1Zt"), 70.7107, 1e-4],
  ])("%s", (_n, f, want, tol) => {
    expect(Math.abs((f as () => number)() - (want as number))).toBeLessThan((tol as number) / 2 + 1e-12);
  });
  test("the defaults are the case rows, and the text shows them typeset", () => {
    const t = run("tl-line-termination").text;
    expect(t).toMatch(/Γ = 0\.4 \+ j0\.2/);
    expect(t).toMatch(/VSWR = 2\.61803/);
    expect(t).toMatch(/Zᵢₙ = 50 − j50 Ω/);
    expect(run("tl-match").text).toMatch(/70\.7107 Ω/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Further oracle rows (scikit-rf, numpy)
// ---------------------------------------------------------------------------------------------------------------

describe("line and termination against scikit-rf", () => {
  test.each([
    [50, cx(25, -30), 72 / 360, cx(25.00217925314, 30.0040312683045), 2.87178445068879, 6.31310672327514, 1.156105116743],
    [75, cx(10, 0), 123.4 / 360, cx(31.7037962549855, -107.33262625596), 7.5, 2.33011138142874, 3.81716596708923],
    [50, cx(5000, 0), 30 / 360, cx(1.999400179946, -86.5679097514806), 99.9999999999999, 0.173723583701853, 14.0658275623732],
    [50, cx(20, 80), 10 / 360, cx(39.6328321841746, 119.826981847588), 9.19120028186381, 1.89755583362964, 4.51018452155457],
    [50, cx(100, 50), 1341 / 360, cx(21.7718068962596, -17.0809677392976), 2.61803398874989, 6.98970004336019, 0.969100130080564],
  ])("Z₀ %p, Z_L %j, ℓ %p λ", (z0, zl, turns, want, vswr, rl, ml) => {
    const z = zin(zl as Cx, z0 as number, turns as number);
    expect(cAbs({ re: z.re - (want as Cx).re, im: z.im - (want as Cx).im })).toBeLessThan(1e-9 * cAbs(want as Cx));
    const r = refl(zl as Cx, z0 as number);
    expect(rel(r.vswr as number, vswr as number)).toBeLessThan(1e-12);
    expect(rel(r.rlDb as number, rl as number)).toBeLessThan(1e-12);
    expect(rel(r.mlDb as number, ml as number)).toBeLessThan(1e-11);
  });
  test("a short a λ/8 from the input is j50; an open at λ/4 is a short", () => {
    const s = inputImpedance(refl("short").gamma, 50, 0.125);
    if (!s.ok || !s.zin) throw new Error();
    expect(Math.abs(s.zin.re)).toBeLessThan(1e-12);
    expect(s.zin.im).toBeCloseTo(50, 12);
    const o = inputImpedance(refl("open").gamma, 50, 0.25);
    if (!o.ok || !o.zin) throw new Error();
    expect(cAbs(o.zin)).toBeLessThan(1e-9);
  });
  test("a half wavelength repeats the load exactly, and several λ reduce modulo λ/2", () => {
    const h = inputImpedance(refl(cx(100, 50)).gamma, 50, 0.5);
    if (!h.ok || !h.zin) throw new Error();
    expect(h.reduced).toBe(0);
    expect(h.halfWaves).toBe(1);
    expect(h.zin.re).toBeCloseTo(100, 9);
    const l = inputImpedance(refl(cx(100, 50)).gamma, 50, 3.725);
    if (!l.ok) throw new Error();
    expect(l.halfWaves).toBe(7);
    expect(l.reduced).toBeCloseTo(0.225, 12);
  });
  test("an open at the input (open load, ℓ = 0) is reported, not divided by zero", () => {
    const o = run("tl-line-termination", { term: "open", len: "0.5" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/open circuit/);
    expect(o.outputs!.find((x) => x.key === "zinRe")).toBeUndefined();
    expect(o.outputs!.find((x) => x.key === "vswr")).toBeUndefined();
  });
});

describe("Z₀ from geometry against scikit-rf", () => {
  test.each([
    [0.91e-3, 2.95e-3, 2.1, 48.6621344044676],
    [1e-3, 2.3e-3, 1.0, 49.9399746444443],
    [0.5e-3, 3.4e-3, 2.25, 76.6238588834162],
  ])("coax d %p, D %p, εᵣ %p", (d, D, er, want) => {
    const g = coaxZ0(d, D, er);
    if (!g.ok) throw new Error(g.error);
    expect(rel(g.z0, want)).toBeLessThan(1e-12);
  });
  test.each([
    [3.0e-3, 1.6e-3, 4.5, 50.1083398482762, 3.39334733405423],
    [0.3e-3, 0.254e-3, 9.8, 45.3125576476022, 6.67520144975478],
    [0.1e-3, 1.0e-3, 2.2, 202.684941791974, 1.68062316695764],
    [10e-3, 0.5e-3, 3.0, 9.64016146439931, 2.7975707863668],
    [1.13e-3, 0.635e-3, 9.8, 36.0393683905016, 6.94776877823375],
  ])("microstrip w %p, h %p, εᵣ %p (Hammerstad–Jensen, t = 0, no dispersion)", (w, h, er, z0, ee) => {
    const g = microstripZ0(w, h, er);
    if (!g.ok) throw new Error(g.error);
    expect(rel(g.z0, z0)).toBeLessThan(1e-12);
    expect(rel(g.epsEff, ee)).toBeLessThan(1e-12);
  });
  test("through the pane: coax and microstrip Z₀, and the physical length takes the geometry's velocity factor", () => {
    expect(rel(out(run("tl-line-termination", { z0mode: "coax" }), "z0"), 48.6621344044676)).toBeLessThan(1e-12);
    const m = run("tl-line-termination", { z0mode: "microstrip", er: "4.5" });
    expect(rel(out(m, "z0"), 50.1083398482762)).toBeLessThan(1e-12);
    expect(rel(out(m, "epsEff"), 3.39334733405423)).toBeLessThan(1e-12);
    // 30 cm of the default coax (εᵣ 2.1) at 2.4 GHz: λ = c/(f√2.1)
    const p = run("tl-line-termination", { z0mode: "coax", lenMode: "phys", len: "30 cm", freq: "2.4 GHz", vf: "" });
    expect(rel(out(p, "turns"), 0.3 / (299792458 / (2.4e9 * Math.sqrt(2.1))))).toBeLessThan(1e-12);
    const q = run("tl-line-termination", { lenMode: "phys", len: "1 m", freq: "100 MHz", vf: "66 %" });
    expect(rel(out(q, "turns"), 1 / ((0.66 * 299792458) / 1e8))).toBeLessThan(1e-12);
  });
});

describe("matching against independent constructions", () => {
  test("quarter-wave at the voltage maximum and minimum of a complex load", () => {
    const q = quarterWave(refl(cx(100, 50)), 50);
    if (!q.ok) throw new Error(q.error);
    expect(q.solutions[0].dLambda).toBeCloseTo(0.0368959044126083, 12);
    expect(q.solutions[0].zt).toBeCloseTo(80.9016994374947, 10);
    expect(q.solutions[1].dLambda).toBeCloseTo(0.286895904412608, 12);
    expect(q.solutions[1].zt).toBeCloseTo(30.9016994374947, 10);
    for (const s of q.solutions) expect(cAbs(quarterWaveGammaAt(refl(cx(100, 50)).gamma, 50, s, 1))).toBeLessThan(1e-12);
  });
  test.each([
    [50, cx(60, -80), "open", [[0.1104232186383, 0.344974621635891], [0.259444530622826, 0.155025378364109]]],
    [50, cx(60, -80), "short", [[0.1104232186383, 0.0949746216358915], [0.259444530622826, 0.405025378364109]]],
    [75, cx(30, 40), "short", [[0.333212729341585, 0.106201123205888], [0.493209500169114, 0.393798876794112]]],
    [50, cx(50, 40), "open", [[0.25, 0.392611643738639], [0.439440529204578, 0.107388356261361]]],
    [50, cx(100, 50), "short", [[0.198791808825217, 0.125], [0.375, 0.375]]],
  ])("single stub, Z₀ %p, Z_L %j, %s stub: both solutions", (z0, zl, kind, want) => {
    const r = refl(zl as Cx, z0 as number);
    const s = singleStub(r, z0 as number, kind as "open" | "short");
    if (!s.ok) throw new Error(s.error);
    (want as number[][]).forEach(([d, l], i) => {
      expect(s.solutions[i].dLambda).toBeCloseTo(d, 11);
      expect(s.solutions[i].lLambda).toBeCloseTo(l, 11);
      expect(cAbs(stubGammaAt(r.gamma, kind as "open" | "short", s.solutions[i], 1))).toBeLessThan(1e-12);
    });
  });
  test.each([
    [{}, "qw1Bw", 78.36531040612145],
    [{}, "qw2Bw", 24.076825601906027],
    [{}, "stub1Bw", 36.8017191789036],
    [{}, "stub2Bw", 16.080903480093202],
    [{ rl: "60", xl: "-80", stub: "open" }, "qw1Bw", 12.508299347372498],
    [{ rl: "60", xl: "-80", stub: "open" }, "stub1Bw", 9.723963700575277],
    [{ rl: "60", xl: "-80", stub: "open" }, "stub2Bw", 10.067098024034982],
  ])("bandwidth at VSWR 1.5 %j %s (ABCD-cascade oracle)", (over, key, want) => {
    expect(Math.abs(out(run("tl-match", over as Record<string, string>), key as string) - (want as number))).toBeLessThan(1e-7);
  });
  test("a load already within the VSWR limit reports no bandwidth (no band edge exists)", () => {
    const o = run("tl-match", { vswrMax: "2.5" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/already within the limit/);
    expect(o.outputs!.find((x) => x.key === "qw1Bw")).toBeUndefined();
  });
  test("bandEdges returns null edges for a curve that never crosses", () => {
    expect(bandEdges(() => cx(0.1, 0), 0.2)).toEqual({ lo: null, hi: null });
  });
});

describe("two-port against scikit-rf and numpy", () => {
  const amp = (): ReturnType<typeof twoPort> => twoPort(cPolar(0.61, -170), cPolar(2.24, 32), cPolar(0.05, 16), cPolar(0.72, -83));
  test("the default amplifier", () => {
    const t = amp();
    if (!t.ok) throw new Error(t.error);
    expect(t.rlIn as number).toBeCloseTo(4.29340329978466, 11);
    expect(t.rlOut as number).toBeCloseTo(2.85335007137463, 11);
    expect(t.dB.s21 as number).toBeCloseTo(7.00496036668326, 11);
    expect(t.iso as number).toBeCloseTo(26.0205999132796, 11);
    expect(t.vswrIn as number).toBeCloseTo(4.128205128205128, 11);
    expect(t.vswrOut as number).toBeCloseTo(6.142857142857139, 11);
    expect(t.K as number).toBeCloseTo(1.1797802774995, 11);
    expect(t.deltaMag).toBeCloseTo(0.393409179048848, 12);
    expect(10 * Math.log10(t.gtu!.total)).toBeCloseTo(12.199190753602085, 10);
    expect(t.unilateral!.U).toBeCloseTo(0.162668474094156, 12);
    expect(t.unilateral!.loDb).toBeCloseTo(-1.30911793348664, 11);
    expect(t.unilateral!.hiDb).toBeCloseTo(1.54205114205423, 11);
    // The exact transducer gain at the conjugate terminations (12.8598 dB, oracle) lies inside the bounds.
    const gap = 12.8597641347314 - 10 * Math.log10(t.gtu!.total);
    expect(gap).toBeGreaterThan(t.unilateral!.loDb);
    expect(gap).toBeLessThan(t.unilateral!.hiDb);
    expect(t.stability).toBe("unconditional");
    expect(t.reciprocal).toBe(false);
    expect(t.passive).toBe(false);
  });
  test("through the pane: the same numbers as named outputs, in all three formats", () => {
    const ma = run("tl-two-port");
    expect(out(ma, "K")).toBeCloseTo(1.1797802774995, 11);
    expect(out(ma, "gtuMax")).toBeCloseTo(12.199190753602085, 10);
    expect(out(ma, "zinRe")).toBeCloseTo(12.199029130646247, 10);
    expect(out(ma, "zinIm")).toBeCloseTo(-4.115900297766956, 10);
    const ri = run("tl-two-port", { fmt: "ri", s: "-0.600732727 -0.105925392\n1.899627737 1.187019151\n0.048063084 0.013781867\n0.087745926 -0.714633229" });
    expect(out(ri, "K")).toBeCloseTo(1.1797802774995, 6);
    const db = run("tl-two-port", { fmt: "db", s: "-4.29340329978466 -170\n7.00496036668326 32\n-26.0205999132796 16\n-2.85335007137463 -83" });
    expect(out(db, "K")).toBeCloseTo(1.1797802774995, 10);
    // Unlabelled rows are read in Touchstone order; labelled rows may come in any order.
    const lab = run("tl-two-port", { s: "S22 0.72 -83\nS12 0.05 16\nS21 2.24 32\nS11 0.61 -170" });
    expect(out(lab, "K")).toBeCloseTo(1.1797802774995, 11);
  });
  test("a lossless reciprocal line renormalised to 50 Ω (skrf): passive, reciprocal, lossless, K = 1", () => {
    const a = cx(0.25714286, 0.13997084), b = cx(0.45714286, -0.83982505);
    const t = twoPort(a, b, b, a);
    if (!t.ok) throw new Error(t.error);
    expect(t.lossless).toBe(true);
    expect(t.reciprocal).toBe(true);
    expect(t.stability).toBe("passive");
    expect(t.K as number).toBeCloseTo(1, 6);
    expect(10 * Math.log10(t.gtu!.total)).toBeCloseTo(0.389180660303701, 6);
  });
  test("S12 = 0 (unilateral): no isolation output, U = 0, no −∞ bar", () => {
    const o = run("tl-two-port", { s: "0.61 -170\n2.24 32\n0 0\n0.72 -83" });
    expect(o.ok).not.toBe(false);
    expect(o.outputs!.find((x) => x.key === "iso")).toBeUndefined();
    expect(o.outputs!.find((x) => x.key === "K")).toBeUndefined();
    expect(out(o, "U")).toBe(0);
    expect(o.text).toMatch(/unilateral/);
  });
  test("a matched 3 dB attenuator: return loss unbounded, insertion loss 3 dB, passive", () => {
    const o = run("tl-two-port", { s: "0 0\n0.707945784384138 0\n0.707945784384138 0\n0 0" });
    expect(o.ok).not.toBe(false);
    expect(out(o, "il")).toBeCloseTo(3, 12);
    expect(o.outputs!.find((x) => x.key === "rlIn")).toBeUndefined();
    expect(o.text).toMatch(/Passive network/);
  });
  test("|S11| > 1 (active port): VSWR undefined and no unilateral gain, said by name", () => {
    const o = run("tl-two-port", { s: "1.2 30\n2 0\n0.1 0\n0.5 0" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/VSWR not defined/);
    expect(o.outputs!.find((x) => x.key === "gtuMax")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Named refusals and adversarial input
// ---------------------------------------------------------------------------------------------------------------

describe("named refusals", () => {
  test.each([
    ["tl-line-termination", { rl: "-10" }, /negative.*active/],
    ["tl-line-termination", { z0: "0" }, /Z₀ must be/],
    ["tl-line-termination", { z0: "5 kg" }, /Z₀: .*not compatible/],
    ["tl-line-termination", { rl: "5 kg" }, /Load resistance R: .*not compatible/],
    ["tl-line-termination", { rl: "5 kohmz" }, /not a unit this recognises/],
    ["tl-line-termination", { rl: "" }, /this field is required/],
    ["tl-line-termination", { rl: "1e999" }, /finite/],
    ["tl-line-termination", { len: "-0.1" }, /zero or more/],
    ["tl-line-termination", { len: "2e6" }, /10⁶ wavelengths/],
    ["tl-line-termination", { len: "0.1 m" }, /plain number/],
    ["tl-line-termination", { lenMode: "deg", len: "45 kg" }, /not compatible/],
    ["tl-line-termination", { lenMode: "phys", len: "1 m", vf: "1.2" }, /at most 1/],
    ["tl-line-termination", { lenMode: "phys", len: "1 m", vf: "" }, /Velocity factor: required/],
    ["tl-line-termination", { lenMode: "phys", len: "1 m", freq: "0 Hz" }, /greater than zero/],
    ["tl-line-termination", { z0mode: "coax", dIn: "3 mm", dOut: "2 mm" }, /outer diameter/],
    ["tl-line-termination", { z0mode: "coax", er: "0.5" }, /between 1/],
    ["tl-line-termination", { z0mode: "microstrip", w: "0.001 mm" }, /outside the range/],
    ["tl-line-termination", { z0mode: "microstrip", er: "200" }, /between 1 and 128/],
    ["tl-match", { rl: "50", xl: "0" }, /already matched/],
    ["tl-match", { rl: "0", xl: "30" }, /pure reactance/],
    ["tl-match", { rl: "-5" }, /negative/],
    ["tl-match", { vswrMax: "1" }, /greater than 1/],
    ["tl-two-port", { s: "0.5 0\n0.5 0\n0.5 0" }, /exactly four/],
    ["tl-two-port", { s: "S11 0.5 0\n0.5 0\n0.5 0\n0.5 0" }, /name all four rows/],
    ["tl-two-port", { s: "S11 0.5 0\nS11 0.5 0\nS12 0.5 0\nS22 0.5 0" }, /repeated/],
    ["tl-two-port", { s: "-0.5 0\n0.5 0\n0.5 0\n0.5 0" }, /cannot be negative/],
    ["tl-two-port", { s: "0.5\n0.5 0\n0.5 0\n0.5 0" }, /exactly two numbers/],
    ["tl-two-port", { s: "" }, /nothing to read/],
    ["tl-two-port", { fmt: "db", s: "200 0\n0 0\n0 0\n0 0" }, /120 dB/],
    ["tl-two-port", { z0: "5 kg" }, /not compatible/],
  ])("%s %j", (id, over, re) => {
    const o = run(id as string, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re as RegExp);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined|\u2014/);
  });
  test("engine guards: non-finite and degenerate inputs", () => {
    expect(reflection({ kind: "z", z: cx(NaN, 0) }, 50).ok).toBe(false);
    expect(reflection({ kind: "z", z: cx(50, 0) }, Infinity).ok).toBe(false);
    expect(inputImpedance(cx(0.5, 0), 50, NaN).ok).toBe(false);
    expect(coaxZ0(NaN, 1, 1).ok).toBe(false);
    expect(microstripZ0(1, 0, 4).ok).toBe(false);
    expect(twoPort(cx(NaN, 0), cx(0, 0), cx(0, 0), cx(0, 0)).ok).toBe(false);
    expect(twoPort(cx(2e6, 0), cx(0, 0), cx(0, 0), cx(0, 0)).ok).toBe(false);
  });
  test("readSBlock accepts subscript names and a colon", () => {
    const r = readSBlock("S₁₁: 0.5 10\nS₂₁: 0.5 0\nS₁₂: 0.5 0\nS₂₂: 0.5 0", "ma");
    expect(typeof r).not.toBe("string");
  });
  test("work is bounded: the bandwidth scan is at most 2 × (2000 + 60) evaluations, whatever the load", () => {
    let n = 0;
    bandEdges(() => {
      n++;
      return cx(0, 0);
    }, 0.2);
    expect(n).toBeLessThanOrEqual(2 * 2060);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Display contract on every ok result, and the figures
// ---------------------------------------------------------------------------------------------------------------

const OK_RUNS: Array<[string, Record<string, string>]> = [
  ["tl-line-termination", {}],
  ["tl-line-termination", { rl: "5 kΩ", xl: "0", len: "0.08" }],
  ["tl-line-termination", { term: "short" }],
  ["tl-line-termination", { term: "open", len: "0.3" }],
  ["tl-line-termination", { rl: "50", xl: "0" }],
  ["tl-line-termination", { len: "0.5" }],
  ["tl-line-termination", { len: "0" }],
  ["tl-line-termination", { len: "3.725" }],
  ["tl-line-termination", { rl: "25", xl: "-30", lenMode: "deg", len: "72" }],
  ["tl-line-termination", { rl: "0", xl: "50", len: "0.2" }],
  ["tl-line-termination", { rl: "52", xl: "1", len: "0.2" }],
  ["tl-line-termination", { rl: "1e-6 Ω", xl: "0", len: "0.2" }],
  ["tl-line-termination", { z0mode: "coax", lenMode: "phys", len: "30 cm", freq: "2.4 GHz", vf: "" }],
  ["tl-line-termination", { z0mode: "microstrip", er: "4.5", rl: "30", xl: "-60", len: "0.4" }],
  ["tl-match", {}],
  ["tl-match", { rl: "60", xl: "-80", stub: "open" }],
  ["tl-match", { rl: "1 kΩ", xl: "-2 kΩ" }],
  ["tl-match", { vswrMax: "3" }],
  ["tl-two-port", {}],
  ["tl-two-port", { s: "0.61 -170\n2.24 32\n0 0\n0.72 -83" }],
  ["tl-two-port", { fmt: "db", s: "-30 0\n-3 0\n-3 0\n-30 0" }],
  ["tl-two-port", { s: "1.2 30\n2 0\n0.1 0\n0.5 0" }],
  ["tl-two-port", { fmt: "ri", s: "0 0\n0 -1\n0 -1\n0 0" }],
];

describe("display contract on every ok result", () => {
  test.each(OK_RUNS)("%s %j", (id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    const t = o.text;
    expect(t).not.toMatch(/NaN|Infinity|undefined|\u2014/);
    expect(t).not.toMatch(/\d[eE][+-]?\d/);
    expect(t).not.toMatch(/(^|[\s(=:,])-\d/m);
    expect(t).not.toMatch(/−0(\.0+)?(?![.\d])/);
    expect(o.outputs!.length).toBeGreaterThan(0);
    for (const x of o.outputs!) expect(Number.isFinite(x.value)).toBe(true);
    const blocks = o.blocks ?? [];
    expect(blocks.some((b) => b.kind === "plot")).toBe(true);
    for (const b of blocks) {
      if (b.kind === "line") expect(b.text).not.toMatch(/\^/);
      if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
      if (b.kind === "plot") {
        expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
        expect(b.svg).toMatch(/Arial|sans-serif/);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
      }
      if (b.kind === "table") {
        expect(b.rows[0].length).toBeGreaterThan(1);
        for (const row of b.rows) for (const cell of row) expect(cell).not.toMatch(/NaN|\d[eE][+-]?\d|(^|\s)-\d/);
      }
    }
  });
  test("every calculator declares unitContract converts and the group Electronics", () => {
    for (const c of TLINE_CALCS) {
      expect(c.unitContract).toBe("converts");
      expect(c.group).toBe("Electronics");
    }
    expect(TLINE_CALCS.map((c) => c.id)).toEqual(["tl-line-termination", "tl-match", "tl-two-port"]);
  });
  test("units convert and the conversion is reported", () => {
    const o = run("tl-line-termination", { z0: "75 ohm", rl: "0.1 kΩ" });
    expect(out(o, "z0")).toBe(75);
    expect(o.text).toMatch(/Load resistance R: 0\.1 kΩ = 100 Ω/);
  });
});

describe("figure builders", () => {
  test("the Smith chart draws the grid, both points, the arc toward the generator (sweep 1) and the VSWR circle", () => {
    const r = refl(cx(100, 50));
    const zi = inputImpedance(r.gamma, 50, 0.125);
    if (!zi.ok) throw new Error();
    const svg = smithChartSvg({ gammaL: r.gamma, gammaIn: zi.gammaIn, turns: zi.reduced, halfWaves: 0, z0: 50, zlText: "100 + j50 Ω", zinText: "50 − j50 Ω", vswr: r.vswr });
    expect(svg).toMatch(/^<svg/);
    expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(5 + 1 + 1 + 2);
    expect(svg).toMatch(/stroke-dasharray="4 3"/);
    // The rotation arc: an arc of the VSWR circle's radius, drawn clockwise.
    const radius = (0.447213595499958 * Math.round(460 * 0.365)).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    expect(svg).toMatch(new RegExp(`A${radius.replace(".", "\\.")} ${radius.replace(".", "\\.")} 0 0 1 `));
    expect(svg).toMatch(/>j0\.5</);
    expect(svg).toMatch(/>−j2</);
  });
  test("edge figures: matched, total reflection, coincident points, no line", () => {
    for (const [g, gi, turns, hw] of [
      [cx(0, 0), cx(0, 0), 0.125, 0],
      [cx(-1, 0), cx(0, 1), 0.125, 0],
      [cx(0.4, 0.2), cx(0.4, 0.2), 0, 1],
      [cx(0.4, 0.2), null, 0, 0],
    ] as Array<[Cx, Cx | null, number, number]>) {
      const svg = smithChartSvg({ gammaL: g, gammaIn: gi, turns, halfWaves: hw, z0: 50, zlText: "x", zinText: "y", vswr: null });
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(matchBandSvg([{ label: "a", colour: "#000000", g: () => 0.1 }], 0.2, 1.5)).toMatch(/^<svg/);
    expect(sParamBarsSvg([{ sub: "11", db: null, angleDeg: 0, kind: "reflection" }])).toMatch(/no bar/);
  });
  test("cxText: true minus, j notation, no −0", () => {
    expect(cxText(cx(50, -50))).toBe("50 − j50");
    expect(cxText(cx(0, -0.5))).toBe("−j0.5");
    expect(cxText(cx(-0, 1e-20))).toBe("0");
  });
});
