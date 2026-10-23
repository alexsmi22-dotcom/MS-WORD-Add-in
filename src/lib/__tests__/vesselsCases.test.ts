// Release E gap #10: pressure vessels, thick cylinders, shrink fits, rotating disks, combined loading, Hertz contact.
//
// THE FIXED CASE TABLE (integrator's oracle, ~/jurislab-relE/oracle_wave1.py, closed forms) is pinned first, through
// the pane's own compute functions with unit strings, reading `outputs` — never the text. Every later fix round must
// keep every row's outcome.
//
// CONVENTION NOTE: the beam-column row is pinned with P = −10 kN (compression). The tool's sign convention is
// tension positive (stress.ts), which the combined-loading row needs (σ₁ 51.040, σ₂ −5.204 only come out for
// tension); the 1/(1 − P/P_cr) amplification exists only under compression, so the amplification row is the same
// shaft in compression.
//
// Further reference values (external oracle, ~/jurislab-oracle-venv, python -I):
//   import math; from scipy.optimize import minimize_scalar, brentq
//   # Hertz on-axis maximum shear, sphere:  s_r=-(1+nu)(1-z*atan(1/z))+0.5/(1+z^2), s_z=-1/(1+z^2), tau=|s_z-s_r|/2
//   #   nu=0.3 -> 0.3100205 p0 at z=0.4808645 a;  nu=0.25 -> 0.3216784 at 0.4643132;  nu=0.5 -> 0.2663486 at 0.5478685
//   # cylinder (plane strain): s_x=-((1+2z^2)/sqrt(1+z^2)-2z), s_z=-1/sqrt(1+z^2), s_y=nu(s_x+s_z), tau=(max-min)/2
//   #   nu=0.3 -> 0.3002831 p0 at z=0.7861514 b;  nu=0 -> 0.5 p0 at the surface
//   # shrink fit by root-finding u_hub(b) - u_shaft(b) = delta with u = r(s_t - nu s_r)/E (plane stress, Lamé):
//   #   a=0,b=50,c=100 mm, 0.02 mm, steel/steel -> 30.000 MPa; a=10,b=25,c=50 mm, 0.01 mm steel/steel -> 26.25 MPa;
//   #   same with an Al shaft (70 GPa, 0.33) in a steel hub (200 GPa, 0.3) -> 16.098563 MPa
//   # hollow disk a=0.05 b=0.2 rho 7850 w 1000 nu .3: sr max (3+nu)/8 rho w^2 (b-a)^2 = 72.857813 MPa at r=sqrt(ab)=0.1;
//   #   hoop at the rim (3+nu)/4 rho w^2 (a^2 + (1-nu)/(3+nu) b^2) = 71.140625 MPa
//   # solid disk 3000 rpm, b 0.3 m: 28.763111 MPa
//   # combined, solid d 50, P 10 kN, M 500, T 400, V 5 kN: neutral axis tau = 16T/(pi d^3)+4V/(3A) = 19.692772 MPa,
//   #   von Mises sqrt((P/A)^2+3 tau^2) = 34.487012 MPa
//   # hollow d 50 di 30, same + V 5 kN: outer vM 63.649929, VQ/(It) 7.6456786, neutral vM 46.361872 MPa
//   # rectangle b 20 h 40 mm, P 10 kN, M 500, V 5 kN: s = 106.25, 3V/2A = 9.375, neutral vM 20.491995 MPa;
//   #   P_cr L=1 m E 200 GPa: strong 210.55156 kN, weak 52.637890 kN
//   # Hertz sphere-sphere R1 10 R2 20 mm, F 500 N, 210/0.3 on 70/0.33: E* 58.605196 GPa, a 0.34940943 mm,
//   #   p0 1955.4294 MPa, delta 18.313043 um
//   # thin cylinder p 2 r 500 t 10: Lamé bore hoop with ro = r + t: 101.009901 MPa
import { VESSELS_CALCS } from "../vesselsCalcs";
import { thinVessel, lame, lameAt, shrinkFit, rotatingDisk, diskAt } from "../vessels";
import { hertzSphere, hertzCylinder, maxSubsurfaceShear, effectiveModulus } from "../contact";
import { combinedLoad } from "../combinedLoad";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const calc = (id: string) => {
  const c = VESSELS_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
function out(o: AnalyzeOutput, key: string): number {
  expect(o.ok).not.toBe(false);
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key} in ${JSON.stringify(o.outputs?.map((x) => x.key))}: ${o.text}`);
  return v.value;
}
const rel = (got: number, want: number, tol = 1e-5): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-12);
};

// ------------------------------------------------------------------------------------------- the fixed case table
describe("fixed case table", () => {
  test("thin cylinder p 2 MPa, r 0.5 m, t 10 mm: hoop 100, axial 50; sphere 50 MPa", () => {
    const o = run("vessel-thin-wall", { p: "2 MPa", r: "0.5 m", t: "10 mm" });
    rel(out(o, "hoop"), 100);
    rel(out(o, "axial"), 50);
    const s = run("vessel-thin-wall", { shape: "sphere", p: "2 MPa", r: "0.5 m", t: "10 mm" });
    rel(out(s, "hoop"), 50);
  });

  test("thin cylinder with t/r = 0.2: named refusal pointing to the thick-wall tool", () => {
    const o = run("vessel-thin-wall", { r: "50 mm", t: "10 mm" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/t\/r = 0\.2 is above 0\.1/);
    expect(o.text).toMatch(/Thick-walled cylinder \(Lamé\)/);
  });

  test("Lamé ri 50, ro 100 mm, pi 100 MPa, po 0: bore −100 / 166.667, outside 0 / 66.667, axial 33.333 MPa", () => {
    const o = run("vessel-lame", { ri: "50 mm", ro: "100 mm", pi: "100 MPa", po: "0" });
    rel(out(o, "srInner"), -100);
    rel(out(o, "stInner"), 166.6666667);
    expect(out(o, "srOuter")).toBe(0);
    rel(out(o, "stOuter"), 66.6666667);
    rel(out(o, "axial"), 33.3333333);
  });

  test("shrink fit, steel 200 GPa, solid shaft, b 50, c 100 mm, radial δ 0.02 mm: p = 30.0 MPa", () => {
    const o = run("vessel-shrink-fit", { a: "0", b: "50 mm", c: "100 mm", delta: "0.02 mm", Es: "200 GPa", Eh: "200 GPa", nus: "0.3", nuh: "0.3" });
    rel(out(o, "p"), 30.0);
  });

  test("solid disk ρ 7850, ω 1000 rad/s, b 0.2 m, ν 0.3: σmax 129.525 MPa at the centre (σr = σθ)", () => {
    const o = run("vessel-rotating-disk", { rho: "7850 kg/m^3", omega: "1000 rad/s", b: "0.2 m", a: "0", nu: "0.3" });
    rel(out(o, "hoopMax"), 129.525);
    rel(out(o, "radialMax"), 129.525);
  });

  test("hollow disk a 0.05 m, b 0.2 m, same: σθ at the bore 262.484 MPa", () => {
    const o = run("vessel-rotating-disk", { rho: "7850", omega: "1000", b: "0.2 m", a: "0.05 m", nu: "0.3" });
    rel(out(o, "hoopMax"), 262.484375);
  });

  test("shaft d 50 mm, P 10 kN, M 500 N·m, T 400 N·m: the full stress state", () => {
    const o = run("combined-loading", { section: "circle", d: "50 mm", di: "0", P: "10 kN", M: "500 N*m", T: "400 N·m", V: "", L: "" });
    rel(out(o, "sigmaAxial"), 5.092958, 1e-6);
    rel(out(o, "sigmaBend"), 40.743665, 1e-6);
    rel(out(o, "sigma"), 45.836624, 1e-6);
    rel(out(o, "tau"), 16.297466, 1e-6);
    rel(out(o, "sigma1"), 51.040481, 1e-6);
    rel(out(o, "sigma2"), -5.203858, 1e-6);
    rel(out(o, "tauMax"), 28.122170, 1e-6);
    rel(out(o, "vonMises"), 53.831387, 1e-6);
  });

  test("same shaft as a pinned beam-column, L 1 m, E 200 GPa (P = 10 kN compression): Pcr 605.59 kN, amplification 1.01679", () => {
    const o = run("combined-loading", { P: "-10 kN", L: "1 m", E: "200 GPa" });
    rel(out(o, "pcr"), 605.59134, 1e-6);
    rel(out(o, "amplification"), 1.01679, 1e-5);
  });

  test("P ≥ Pcr: named refusal (buckled)", () => {
    const o = run("combined-loading", { P: "-700 kN", L: "1 m", E: "200 GPa" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/buckled/);
    // At exactly Pcr as well (the engine, so the boundary is exact).
    const d = 0.05;
    const pcr = (Math.PI ** 2 * 200e9 * (Math.PI * d ** 4) / 64) / 1;
    const at = combinedLoad({ section: { kind: "circle", d, di: 0 }, P: -pcr, M: 500, T: 0, V: 0, beamColumn: { L: 1, E: 200e9 } });
    expect(at.ok).toBe(false);
    if (!at.ok) expect(at.error).toMatch(/buckled/);
  });

  test("rectangular section with torque: named refusal (torsion is circular-only)", () => {
    const o = run("combined-loading", { section: "rect", bw: "20 mm", h: "40 mm", T: "400" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/circular sections only/);
  });

  test("Hertz steel ball R 10 mm on a flat, F 100 N, 210 GPa / 0.3: E* 115.385 GPa, a 0.18663 mm, p₀ 1370.88 MPa, δ 3.4829 µm", () => {
    const o = run("hertz-contact", { geom: "sphere-flat", F: "100 N", R1: "10 mm", E1: "210 GPa", E2: "210 GPa", nu1: "0.3", nu2: "0.3" });
    rel(out(o, "Estar"), 115.384615, 1e-6);
    rel(out(o, "a"), 0.18663, 1e-4);
    rel(out(o, "p0"), 1370.88, 1e-5);
    rel(out(o, "delta"), 3.4829, 1e-4);
  });

  test("Hertz cylinders R₁ = R₂ = 10 mm, L 10 mm, F 1000 N, same steel: b 74.279 µm, p₀ 857.07 MPa", () => {
    const o = run("hertz-contact", { geom: "cyl-cyl", F: "1000", R1: "10", R2: "10", L: "10" });
    rel(out(o, "b") * 1000, 74.279, 1e-4);
    rel(out(o, "p0"), 857.07, 1e-5);
  });
});

// ------------------------------------------------------------------------------------------- more oracle values
describe("further oracle values", () => {
  test("thin wall: t/r = 0.1 exactly is accepted; the Lamé bore check is reported", () => {
    const o = run("vessel-thin-wall", { r: "100 mm", t: "10 mm" });
    rel(out(o, "tOverR"), 0.1);
    const t = thinVessel(2e6, 0.5, 0.01, "cylinder-closed");
    expect(t.ok && t.lameBoreHoop).toBeCloseTo(101.009901e6, 0);
    const open = thinVessel(2e6, 0.5, 0.01, "cylinder-open");
    expect(open.ok && open.axial).toBe(0);
  });

  test("shrink fit: hollow same-material 26.25 MPa and dissimilar 16.0986 MPa by the one general form", () => {
    const steel = { E: 200e9, nu: 0.3 };
    const h = shrinkFit(0.01, 0.025, 0.05, 0.01e-3, steel, steel);
    expect(h.ok && h.p / 1e6).toBeCloseTo(26.25, 9);
    const d = shrinkFit(0.01, 0.025, 0.05, 0.01e-3, { E: 70e9, nu: 0.33 }, steel);
    if (!d.ok) throw new Error(d.error);
    rel(d.p / 1e6, 16.098562628, 1e-9);
    rel(d.hubHoopB / 1e6, 26.8309377, 1e-7);
    rel(d.shaftHoopB / 1e6, -22.2313484, 1e-7);
    // σr is continuous at the interface (−p on both sides).
    rel(lameAt(d.hub, 0.025).sr, -d.p, 1e-12);
    rel(lameAt(d.shaft, 0.025).sr, -d.p, 1e-12);
    expect(lameAt(d.shaft, 0.01).sr).toBe(0);
  });

  test("Lamé, external pressure only: σθ at the bore = −2pₒrₒ²/(rₒ² − rᵢ²) = −133.333 MPa; open ends carry no σz", () => {
    const l = lame(0.05, 0.1, 0, 50e6, "open");
    if (!l.ok) throw new Error(l.error);
    rel(lameAt(l, 0.05).st / 1e6, -133.333333, 1e-8);
    expect(lameAt(l, 0.05).sr).toBe(0);
    expect(lameAt(l, 0.1).sr).toBe(-50e6);
    expect(l.axial).toBe(0);
  });

  test("shrink fit echoes the diametral interference", () => {
    const o = run("vessel-shrink-fit");
    expect(o.text).toMatch(/Radial interference δ = 20 µm \(diametral 40 µm\)/);
  });

  test("hollow disk: σr peak 72.858 MPa at r = √(ab) = 0.1 m, rim hoop 71.141 MPa", () => {
    const d = rotatingDisk(7850, 1000, 0.05, 0.2, 0.3);
    if (!d.ok) throw new Error(d.error);
    rel(d.radialMax / 1e6, 72.8578125, 1e-9);
    rel(d.radialMaxAt, 0.1, 1e-12);
    rel(d.hoopRim / 1e6, 71.140625, 1e-9);
    expect(Math.abs(diskAt(d, 0.05).sr)).toBeLessThan(1e-6);
    expect(Math.abs(diskAt(d, 0.2).sr)).toBeLessThan(1e-6);
  });

  test("disk speed in rpm goes through the unit layer: 3000 rpm, b 0.3 m → 28.7631 MPa", () => {
    const o = run("vessel-rotating-disk", { omega: "3000 rpm", b: "0.3 m" });
    rel(out(o, "hoopMax"), 28.763111, 1e-6);
    expect(o.text).toMatch(/Converted: Speed: 3000 rpm = 314\.16 rad\/s/);
  });

  test("disk speed at first yield scales with √(Sy/σvM)", () => {
    const o = run("vessel-rotating-disk", { sy: "250" });
    rel(out(o, "omegaYield"), 1000 * Math.sqrt(250 / 129.525), 1e-6);
    expect(o.text).toMatch(/not the burst speed/);
  });

  test("combined: neutral-axis point with V (solid 4V/3A), hollow VQ/(It), rectangle 3V/2A", () => {
    const s = run("combined-loading", { V: "5 kN" });
    rel(out(s, "vonMisesNeutral"), 34.487012, 1e-6);
    const h = combinedLoad({ section: { kind: "circle", d: 0.05, di: 0.03 }, P: 10e3, M: 500, T: 400, V: 5e3, beamColumn: null });
    if (!h.ok) throw new Error(h.error);
    rel(h.outer.stress.vonMises / 1e6, 63.649929, 1e-6);
    rel(h.tauShear / 1e6, 7.6456786, 1e-6);
    rel((h.neutral as NonNullable<typeof h.neutral>).stress.vonMises / 1e6, 46.361872, 1e-6);
    const r = combinedLoad({ section: { kind: "rect", b: 0.02, h: 0.04 }, P: 10e3, M: 500, T: 0, V: 5e3, beamColumn: { L: 1, E: 200e9 } });
    if (!r.ok) throw new Error(r.error);
    rel(r.outer.sigma / 1e6, 106.25, 1e-9);
    rel(r.tauShear / 1e6, 9.375, 1e-9);
    rel((r.neutral as NonNullable<typeof r.neutral>).stress.vonMises / 1e6, 20.491995, 1e-6);
    rel((r.pcr as number) / 1e3, 210.551561, 1e-6);
    rel((r.pcrMin as number) / 1e3, 52.637890, 1e-6);
  });

  test("rectangle beam-column: buckling is checked about the WEAK axis, amplification uses the bending axis", () => {
    // 60 kN compression: above the weak-axis 52.6 kN, below the bending-axis 210.6 kN → buckled.
    const r = combinedLoad({ section: { kind: "rect", b: 0.02, h: 0.04 }, P: -60e3, M: 500, T: 0, V: 0, beamColumn: { L: 1, E: 200e9 } });
    expect(r.ok).toBe(false);
    const ok = combinedLoad({ section: { kind: "rect", b: 0.02, h: 0.04 }, P: -50e3, M: 500, T: 0, V: 0, beamColumn: { L: 1, E: 200e9 } });
    if (!ok.ok) throw new Error(ok.error);
    rel(ok.amplification, 1 / (1 - 50 / 210.551561), 1e-6);
  });

  test("beam-column under tension: no amplification, and the result says why", () => {
    const o = run("combined-loading", { P: "10 kN", L: "1 m", E: "200 GPa" });
    expect(out(o, "amplification")).toBe(1);
    expect(o.text).toMatch(/tensile, which straightens a beam-column/);
  });

  test("compression without beam-column: the compressive fibre governs (σ = −P/A − Mc/I)", () => {
    const o = run("combined-loading", { P: "-10 kN" });
    rel(out(o, "sigma"), -45.836624, 1e-6);
    rel(out(o, "vonMises"), 53.831387, 1e-6);
  });

  test("Hertz subsurface shear for each body's ν (exact on-axis field)", () => {
    const s3 = maxSubsurfaceShear("sphere", 0.3);
    rel(s3.tauOverP0, 0.3100205, 1e-6);
    rel(s3.depthOverA, 0.4808645, 1e-4);
    rel(maxSubsurfaceShear("sphere", 0.25).tauOverP0, 0.3216784, 1e-6);
    rel(maxSubsurfaceShear("sphere", 0.5).depthOverA, 0.5478685, 1e-4);
    const c3 = maxSubsurfaceShear("cylinder", 0.3);
    rel(c3.tauOverP0, 0.3002831, 1e-6);
    rel(c3.depthOverA, 0.7861514, 1e-4);
    const c0 = maxSubsurfaceShear("cylinder", 0);
    expect(c0.depthOverA).toBe(0);
    rel(c0.tauOverP0, 0.5, 1e-9);
  });

  test("Hertz sphere on sphere, dissimilar materials", () => {
    const r = hertzSphere(500, 0.01, 0.02, { E: 210e9, nu: 0.3 }, { E: 70e9, nu: 0.33 });
    if (!r.ok) throw new Error(r.error);
    rel(r.Estar / 1e9, 58.6051963, 1e-8);
    rel(r.a * 1e3, 0.34940943, 1e-7);
    rel(r.p0 / 1e6, 1955.42938, 1e-7);
    rel(r.delta * 1e6, 18.313043, 1e-7);
    expect(effectiveModulus({ E: 210e9, nu: 0.3 }, { E: 210e9, nu: 0.3 })).toBeCloseTo(115.384615e9, -3);
  });

  test("Hertz cylinders give no approach (not fixed by line-contact theory)", () => {
    const o = run("hertz-contact", { geom: "cyl-flat" });
    expect(o.outputs?.some((x) => x.key === "delta")).toBe(false);
    expect(o.text).toMatch(/approach of two cylinders is not given/);
    const c = hertzCylinder(1000, 0.01, 0.01, null, { E: 210e9, nu: 0.3 }, { E: 210e9, nu: 0.3 });
    expect(c.ok).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------- refusals and adversarial
describe("named refusals and adversarial input", () => {
  const refused = (o: AnalyzeOutput, re: RegExp): void => {
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
  };
  test("thin vessel under external pressure is refused (buckling governs)", () => {
    refused(run("vessel-thin-wall", { p: "-1" }), /buckling/);
  });
  test("wrong quantity in a length field", () => refused(run("vessel-thin-wall", { r: "5 kg" }), /Inner radius: "kg" is not compatible/));
  test("unit typo", () => refused(run("vessel-lame", { ri: "50 mmm" }), /Inner radius: "mmm" is not a unit/));
  test("hertz in a speed field is refused, not multiplied by 2π", () => refused(run("vessel-rotating-disk", { omega: "50 Hz" }), /Speed: "Hz" is not compatible/));
  test("energy in a moment field", () => refused(run("combined-loading", { M: "500 J" }), /unit of energy/));
  test("density in g/cm³ converts", () => {
    const o = run("vessel-rotating-disk", { rho: "7.85 g/cm^3" });
    rel(out(o, "hoopMax"), 129.525, 1e-6);
    expect(o.text).toMatch(/7\.85 g\/cm³ = 7850 kg\/m³/);
    expect(o.text).not.toMatch(/\^/);
  });
  test("pressure in psi and moment in lbf·ft convert", () => {
    rel(out(run("vessel-thin-wall", { p: "290.0754 psi" }), "hoop"), 100, 1e-5);
    const o = run("combined-loading", { M: "368.78 lbf*ft", T: "0", P: "0" });
    rel(out(o, "sigmaBend"), 40.7436654 * (368.78 * 1.3558179483314004) / 500, 1e-6);
  });
  test("empty required field", () => refused(run("vessel-lame", { ro: "" }), /Outer radius: this field is required/));
  test("non-finite and nonsense", () => {
    refused(run("vessel-thin-wall", { p: "Infinity" }), /Internal pressure/);
    refused(run("vessel-thin-wall", { p: "abc" }), /does not start with a number/);
    refused(run("vessel-rotating-disk", { nu: "0.7" }), /Poisson's ratio must lie between/);
    refused(run("vessel-rotating-disk", { nu: "" }), /Poisson's ratio: enter a plain number/);
  });
  test("geometry refusals", () => {
    refused(run("vessel-lame", { ri: "100", ro: "50" }), /outer radius must be larger/);
    refused(run("vessel-lame", { pi: "-5" }), /positive magnitudes/);
    refused(run("vessel-shrink-fit", { a: "60" }), /bore must be smaller/);
    refused(run("vessel-shrink-fit", { c: "40" }), /hub outer radius must be larger/);
    refused(run("vessel-shrink-fit", { delta: "1" }), /far outside small-strain/);
    refused(run("vessel-shrink-fit", { delta: "0" }), /must be greater than zero/);
    refused(run("vessel-rotating-disk", { a: "250" }), /bore radius must be smaller/);
    refused(run("combined-loading", { di: "60" }), /inner diameter must be smaller/);
    refused(run("hertz-contact", { geom: "sphere-sphere", R2: "-20" }), /Concave, conforming contact/);
    refused(run("hertz-contact", { F: "0" }), /normal load must be greater than zero/);
    refused(run("hertz-contact", { F: "1e12" }), /outside it/);
  });
  test("zero load: margins are worded, never Infinity", () => {
    const o = run("combined-loading", { P: "0", M: "0", T: "0", sy: "250" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/no stress, so the yield margin is unbounded/);
    const d = run("vessel-rotating-disk", { omega: "0", sy: "250" });
    expect(d.text).toMatch(/unbounded/);
    expect(d.outputs?.some((x) => x.key === "omegaYield")).toBe(false);
  });
  test("huge and tiny magnitudes stay finite or are refused by name", () => {
    for (const o of [
      run("vessel-thin-wall", { p: "1e300", r: "1e300", t: "1e299" }),
      run("vessel-lame", { ri: "1e-200", ro: "2e-200" }),
      run("combined-loading", { d: "1e-120" }),
      run("combined-loading", { d: "1e120" }),
      run("hertz-contact", { F: "1e-30" }),
      run("vessel-rotating-disk", { omega: "1e200" }),
    ]) {
      expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
      if (o.ok !== false) for (const x of o.outputs ?? []) expect(Number.isFinite(x.value)).toBe(true);
    }
  });
});

// ------------------------------------------------------------------------------------------- contract
const VARIANTS: Record<string, Record<string, string>[]> = {
  "vessel-thin-wall": [{}, { shape: "sphere" }, { shape: "cylinder-open", sy: "" }, { sy: "30" }],
  "vessel-lame": [{}, { ends: "open", sy: "300" }, { pi: "0", po: "50" }, { pi: "20 ksi", ri: "2 in", ro: "4 in" }],
  "vessel-shrink-fit": [{}, { a: "10", b: "25", c: "50", delta: "0.01", Es: "70", nus: "0.33" }],
  "vessel-rotating-disk": [{}, { a: "50", sy: "400" }, { omega: "3000 rpm" }],
  "combined-loading": [{}, { V: "5 kN", sy: "300" }, { P: "-10 kN", L: "1", sy: "250" }, { section: "rect", T: "0", V: "5 kN", L: "1" }, { di: "30", P: "0" }],
  "hertz-contact": [{}, { geom: "sphere-sphere", R2: "20", E2: "70", nu2: "0.33" }, { geom: "cyl-cyl", F: "1000" }, { geom: "cyl-flat", nu1: "0", F: "1000" }],
};

describe("every tool keeps the Release E contract", () => {
  test("six tools, unique ids, the two groups, converts", () => {
    expect(VESSELS_CALCS.map((c) => c.id)).toEqual(["vessel-thin-wall", "vessel-lame", "vessel-shrink-fit", "vessel-rotating-disk", "combined-loading", "hertz-contact"]);
    for (const c of VESSELS_CALCS) {
      expect(["Structural & solids", "Fatigue & machine design"]).toContain(c.group);
      expect(c.unitContract).toBe("converts");
    }
    expect(calc("hertz-contact").group).toBe("Fatigue & machine design");
  });

  test.each(VESSELS_CALCS.map((c) => [c.id]))("%s reads every declared field in some mode", (id) => {
    const c = calc(id);
    const asked = new Set<string>();
    for (const over of [...(VARIANTS[id] ?? [{}]), { L: "1" }]) {
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      Object.assign(vals, over);
      c.compute((k) => {
        asked.add(k);
        return vals[k] ?? "";
      });
    }
    expect(c.fields.map((f) => f.key).filter((k) => !asked.has(k))).toEqual([]);
  });

  const cases = Object.entries(VARIANTS).flatMap(([id, vs]) => vs.map((v, i) => [`${id} #${i}`, id, v] as const));
  test.each(cases)("%s: ok, outputs, formulas that typeset, a figure, display contract", (_n, id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    expect(o.outputs?.length).toBeGreaterThan(0);
    for (const x of o.outputs ?? []) expect(Number.isFinite(x.value)).toBe(true);
    const blocks = o.blocks ?? [];
    const maths = blocks.filter((b) => b.kind === "math");
    expect(maths.length).toBeGreaterThan(0);
    for (const b of maths) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    const plots = blocks.filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThan(0);
    const texts = [o.text];
    for (const b of blocks) {
      if (b.kind === "table") texts.push(...b.rows.flat());
      if (b.kind === "plot") {
        texts.push(b.caption, b.alt);
        expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
        const labels = [...b.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
        for (const l of labels) {
          expect(l).not.toMatch(/\^|\d[eE][+-]?\d|—/);
          expect(l).not.toMatch(/(^|[\s(])-\d/);
        }
      }
    }
    for (const t of texts) {
      expect(t).not.toMatch(/NaN|Infinity|undefined|—/);
      expect(t).not.toMatch(/\^/);
      expect(t).not.toMatch(/\d[eE][+-]?\d/);
      expect(t).not.toMatch(/(^|[\s(=:])-\d/);
    }
  });
});
