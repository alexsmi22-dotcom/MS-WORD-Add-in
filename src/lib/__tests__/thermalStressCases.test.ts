// Release E, gap #3 — thermal stress and expansion mismatch. The FIXED CASE TABLE from the brief
// (~/jurislab-relE/part-thermal.md; oracle ~/jurislab-relE/oracle_wave1.py, closed forms) pinned row by row, then the
// layer-stress oracle, unit handling, adversarial inputs and the display contract. Later fix rounds must keep every
// row's outcome (cumulative gate).
//
// EXTERNAL ORACLE for the rows not in the brief (C:\Users\AlexanderSmith\jurislab-oracle-venv, numpy):
//   import numpy as np
//   def timo(da,dT,t1,t2,E1,E2):
//       m=t1/t2;n=E1/E2;h=t1+t2
//       return 6*da*dT*(1+m)**2/(h*(3*(1+m)**2+(1+m*n)*(m**2+1/(m*n))))
//   def solve(a1,a2,dT,t1,t2,E1,E2):   # force/moment balance + interface strain compatibility, NOT the closed form
//       A=np.array([[(t1+t2)/2, -(E1*t1**3+E2*t2**3)/12],[-1/(E1*t1)-1/(E2*t2), -(t1+t2)/2]])
//       P,k=np.linalg.solve(A,np.array([0,(a2-a1)*dT]))
//       return k,P,-P/t1+E1*k*t1/2,-P/t1-E1*k*t1/2,P/t2+E2*k*t2/2,P/t2-E2*k*t2/2  # s1Outer,s1Int,s2Int,s2Outer
//   solve(10e-6,0,100,0.5e-3,0.5e-3,200e9,200e9) -> κ 1.5, P 12500, stresses 50, −100, 100, −50 MPa
//   solve(23e-6,12e-6,80,0.3e-3,1e-3,70e9,200e9) -> κ 0.43738523469812407 (= timo), P 11320.987824769778,
//       stresses −33.14408111823563, −42.329171046896235, 55.05951129458219, −32.417535645042626 MPa
//   tip of a 50 mm cantilever: κL²/2 = 0.5467315433726553 mm
//   Stoney: 130e9*525e-6**2*0.05/(6*(1-0.28)*1e-6) = 414.71354166666663 MPa
//   shock: 300e6*0.78/(370e9*8e-6) = 79.05405405405405 K; ×30 = 2371.6216216216217 W/m
//   triaxial: −200e9*12e-6*100/(1−0.6) = −600 MPa; α 6.7 µin/(in·°F) = 6.7e-6*1.8 = 1.206e-5 /K

import { THERMAL_STRESS_CALCS } from "../thermalStressCalcs";
import { timoshenkoBilayer, restrainedStress, stoneyFilmStress, stoneyCurvature, thermalShock } from "../thermalStress";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const calc = (id: string) => {
  const c = THERMAL_STRESS_CALCS.find((x) => x.id === id);
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
  if (!v) throw new Error(`no output ${key} in: ${o.text}`);
  return v.value;
};
const plots = (o: AnalyzeOutput) => (o.blocks ?? []).filter((b) => b.kind === "plot");

const RESTRAINED = { mode: "uniaxial", restraint: "full", E: "200 GPa", alpha: "12 µm/(m·K)", dT: "100 K", sy: "" };
const BI_EQUAL = { t1: "0.5 mm", t2: "0.5 mm", E1: "200 GPa", E2: "200 GPa", dAlpha: "10", dT: "100 K", L: "" };
const AL_STEEL = { t1: "0.3 mm", E1: "70 GPa", t2: "1.0 mm", E2: "200 GPa", dAlpha: "11 µm/(m·K)", dT: "80 K", L: "" };
const STONEY = { solve: "stress", Es: "130 GPa", nus: "0.28", hs: "525 µm", hf: "1 µm", kappa: "0.05 1/m" };
const SHOCK = { sf: "300 MPa", nu: "0.22", E: "370 GPa", alpha: "8", k: "30 W/(m·K)" };

// ------------------------------------------------------------------ the fixed case table

type Row = { name: string; id: string; over: Record<string, string>; expect: Record<string, number> | { refuse: RegExp } };
const TABLE: Row[] = [
  { name: "restrained bar, E 200 GPa, α 12×10⁻⁶ /K, ΔT 100 K", id: "thermal-restrained", over: RESTRAINED, expect: { sigma: -240 } },
  { name: "same, biaxial, ν 0.3", id: "thermal-restrained", over: { ...RESTRAINED, mode: "biaxial", nu: "0.3" }, expect: { sigma: -342.857142857 } },
  { name: "bimetal equal layers", id: "thermal-bilayer", over: BI_EQUAL, expect: { kappa: 1.5, R: 0.666666666667 } },
  { name: "Al 0.3 mm / 70 GPa on steel 1.0 mm / 200 GPa, Δα 11×10⁻⁶, ΔT 80 K", id: "thermal-bilayer", over: AL_STEEL, expect: { kappa: 0.437385234698, R: 2.28631403319 } },
  { name: "Stoney film stress", id: "thermal-stoney", over: STONEY, expect: { sigmaf: 414.713541667 } },
  { name: "Stoney with h_f 60 µm on 525 µm", id: "thermal-stoney", over: { ...STONEY, hf: "60 µm" }, expect: { refuse: /Film not thin/ } },
  { name: "thermal shock R and R′", id: "thermal-shock", over: SHOCK, expect: { R: 79.0540540541, Rprime: 2371.62162162 } },
  { name: "ν = 0.5 biaxial", id: "thermal-restrained", over: { ...RESTRAINED, mode: "biaxial", nu: "0.5" }, expect: { refuse: /outside isotropic linear elasticity/ } },
  { name: "ν = 0.5 triaxial", id: "thermal-restrained", over: { ...RESTRAINED, mode: "triaxial", nu: "0.5" }, expect: { refuse: /outside isotropic linear elasticity/ } },
  { name: "ν = 0.7 biaxial", id: "thermal-restrained", over: { ...RESTRAINED, mode: "biaxial", nu: "0.7" }, expect: { refuse: /outside isotropic linear elasticity/ } },
  { name: "α typed as 12 kg", id: "thermal-restrained", over: { ...RESTRAINED, alpha: "12 kg" }, expect: { refuse: /α: "kg" is not compatible/ } },
  { name: "ΔT 0", id: "thermal-restrained", over: { ...RESTRAINED, dT: "0" }, expect: { sigma: 0 } },
];

describe("thermal stress — fixed case table", () => {
  test.each(TABLE)("$name", ({ id, over, expect: e }) => {
    const o = run(id, over);
    if ("refuse" in e) {
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(e.refuse as RegExp);
      return;
    }
    expect(o.ok).not.toBe(false);
    for (const [k, v] of Object.entries(e as Record<string, number>)) {
      const got = out(o, k);
      if (v === 0) expect(Object.is(got, 0)).toBe(true);
      else expect(got / v).toBeCloseTo(1, 9);
    }
    expect(plots(o).length).toBeGreaterThan(0);
  });

  test("ΔT 0: the figure is still drawn, with the stated range note, and the text says 0 (never −0)", () => {
    const o = run("thermal-restrained", { ...RESTRAINED, dT: "0" });
    const p = plots(o);
    expect(p.length).toBe(1);
    expect(p[0].kind === "plot" && p[0].svg).toContain("0–100 K");
    expect(o.text).toContain("σ = 0 MPa");
    expect(o.text).not.toMatch(/−0\b(?!\.)/);
  });

  test("the headline numbers carry U+2212, never a hyphen-minus", () => {
    const o = run("thermal-restrained", RESTRAINED);
    expect(o.text).toContain("σ = −240 MPa (compression)");
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/m);
  });
});

// ------------------------------------------------------------------ the Timoshenko layer stresses (numpy oracle)

describe("bimetal layer stresses against the force/moment/compatibility solve", () => {
  const close = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(1e-9 * Math.max(1, Math.abs(want)));
  test("equal layers: ±100 MPa at the interface, ±50 MPa at the faces", () => {
    const o = run("thermal-bilayer", BI_EQUAL);
    close(out(o, "s1Outer"), 50);
    close(out(o, "s1Interface"), -100);
    close(out(o, "s2Interface"), 100);
    close(out(o, "s2Outer"), -50);
  });
  test("Al on steel", () => {
    const o = run("thermal-bilayer", AL_STEEL);
    close(out(o, "s1Outer"), -33.14408111823563);
    close(out(o, "s1Interface"), -42.329171046896235);
    close(out(o, "s2Interface"), 55.05951129458219);
    close(out(o, "s2Outer"), -32.417535645042626);
    // A results table goes in as a real Word table.
    const t = (o.blocks ?? []).find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows[0]).toEqual(["Location", "Stress (MPa)"]);
  });
  test("tip deflection of a 50 mm cantilever, κL²/2", () => {
    const o = run("thermal-bilayer", { ...AL_STEEL, L: "50 mm" });
    expect(out(o, "tip") / 0.5467315433726553).toBeCloseTo(1, 9);
  });
  test("independent identities over a spread of strips: zero net force, interface strains equal, κ symmetric under swapping layers", () => {
    const strips = [
      [0.3e-3, 1e-3, 70e9, 200e9, 11e-6, 80],
      [5e-6, 500e-6, 400e9, 130e9, -3e-6, 300],
      [2e-3, 0.1e-3, 3e9, 210e9, 50e-6, -40],
    ];
    for (const [t1, t2, E1, E2, da, dT] of strips) {
      const r = timoshenkoBilayer({ t1, t2, E1, E2, dAlpha: da, dT, length: null });
      if (!r.ok) throw new Error(r.error);
      const N = ((r.s1Outer + r.s1Interface) / 2) * t1 + ((r.s2Interface + r.s2Outer) / 2) * t2;
      expect(Math.abs(N)).toBeLessThan(1e-9 * Math.abs(r.P) + 1e-12);
      // α₂ taken as 0, α₁ = Δα: strain at the interface, αΔT + σ/E, matches across it.
      const e1 = da * dT + r.s1Interface / E1, e2 = r.s2Interface / E2;
      expect(Math.abs(e1 - e2)).toBeLessThan(1e-9 * Math.abs(da * dT));
      const sw = timoshenkoBilayer({ t1: t2, t2: t1, E1: E2, E2: E1, dAlpha: -da, dT, length: null });
      if (!sw.ok) throw new Error(sw.error);
      expect(sw.kappa / -r.kappa).toBeCloseTo(1, 12);
    }
  });
  test("Δα < 0 puts layer 2 on the convex side", () => {
    const o = run("thermal-bilayer", { ...BI_EQUAL, dAlpha: "-10" });
    expect(out(o, "kappa")).toBeCloseTo(-1.5, 12);
    expect(o.text).toContain("layer 2 on the convex (outer) side");
  });
  test("a layer under 10% of the thickness: no profile figure (it would be a sliver), and the result says so", () => {
    const o = run("thermal-bilayer", { ...BI_EQUAL, t1: "0.05 mm", t2: "0.5 mm" });
    expect(plots(o).length).toBe(1);
    expect(o.text).toMatch(/through-thickness stress figure is not drawn/);
    expect(plots(run("thermal-bilayer", { ...BI_EQUAL, t1: "0.1 mm", t2: "0.9 mm" })).length).toBe(2);
  });
  test("large deflection is refused by name", () => {
    const o = run("thermal-bilayer", { ...BI_EQUAL, L: "200 mm" }); // κL = 0.3 rad
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/Large deflection: κL = 0\.3 rad exceeds 0\.2 rad/);
  });
  test("ΔT 0: flat strip, no radius output, figure drawn", () => {
    const o = run("thermal-bilayer", { ...BI_EQUAL, dT: "0" });
    expect(Object.is(out(o, "kappa"), 0)).toBe(true);
    expect(o.outputs?.some((x) => x.key === "R")).toBe(false);
    expect(plots(o).length).toBe(2);
  });
});

// ------------------------------------------------------------------ restrained variants

describe("restrained thermal stress — variants", () => {
  test("partial restraint r = 0.5 halves the stress", () => {
    expect(out(run("thermal-restrained", { ...RESTRAINED, restraint: "fraction", r: "0.5" }), "sigma")).toBeCloseTo(-120, 9);
  });
  test("gap: 0.5 mm on a 1 m bar closes at 41.667 K; at 100 K σ = −140 MPa", () => {
    const o = run("thermal-restrained", { ...RESTRAINED, restraint: "gap", gap: "0.5 mm", L: "1 m" });
    expect(out(o, "sigma")).toBeCloseTo(-140, 9);
    expect(out(o, "dTClose")).toBeCloseTo(41.6666666667, 8);
  });
  test("gap not yet closed: σ = 0; cooling with a gap: σ = 0", () => {
    expect(Object.is(out(run("thermal-restrained", { ...RESTRAINED, restraint: "gap", gap: "2 mm", L: "1 m" }), "sigma"), 0)).toBe(true);
    expect(Object.is(out(run("thermal-restrained", { ...RESTRAINED, restraint: "gap", dT: "-50 K" }), "sigma"), 0)).toBe(true);
  });
  test("gap with a plate is refused by name", () => {
    const o = run("thermal-restrained", { ...RESTRAINED, mode: "biaxial", nu: "0.3", restraint: "gap" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/bar \(uniaxial\) only/);
  });
  test("triaxial ν 0.6 is refused; triaxial ν 0.3 gives −600 MPa and a hydrostatic note, no factor of safety", () => {
    expect(run("thermal-restrained", { ...RESTRAINED, mode: "triaxial", nu: "0.6" }).ok).toBe(false);
    const o = run("thermal-restrained", { ...RESTRAINED, mode: "triaxial", nu: "0.3", sy: "250 MPa" });
    expect(out(o, "sigma")).toBeCloseTo(-600, 9);
    expect(o.text).toMatch(/hydrostatic/);
    expect(o.outputs?.some((x) => x.key === "factorOfSafety")).toBe(false);
    expect(o.text).not.toMatch(/Infinity|∞/);
  });
  test("yield margin: 250 MPa against 240 MPa → 1.0417", () => {
    const o = run("thermal-restrained", { ...RESTRAINED, sy: "250 MPa" });
    expect(out(o, "factorOfSafety")).toBeCloseTo(250 / 240, 12);
  });
  test("cooling gives tension and an over-yield warning", () => {
    const o = run("thermal-restrained", { ...RESTRAINED, dT: "-150 K", sy: "250 MPa" });
    expect(out(o, "sigma")).toBeCloseTo(360, 9);
    expect(o.text).toMatch(/EXCEEDS yield/);
  });
  test("engine and glue agree", () => {
    const r = restrainedStress({ E: 200e9, alpha: 12e-6, dT: 100, nu: 0.3, mode: "biaxial", restraint: { kind: "full" } });
    expect(r.ok && r.sigma / 1e6).toBeCloseTo(-342.857142857, 6);
  });
});

// ------------------------------------------------------------------ units: ΔT is a difference; α spellings

describe("units", () => {
  test.each([
    ["100 K", -240],
    ["180 °F", -240],
    ["180 degF", -240],
    ["100 °C", -240],
    ["−180 °F", 240],
    ["100", -240],
  ])("ΔT %s reads as a temperature CHANGE", (dT, want) => {
    const o = run("thermal-restrained", { ...RESTRAINED, dT });
    expect(out(o, "sigma")).toBeCloseTo(want, 9);
  });
  test("a converted ΔT says so, as a difference", () => {
    expect(run("thermal-restrained", { ...RESTRAINED, dT: "180 °F" }).text).toContain("ΔT: 180 °F as a temperature change = 100 K");
  });
  test.each([
    ["12", -240],
    ["12 µm/(m·K)", -240],
    ["12 um/(m*K)", -240],
    ["12e-6 1/K", -240],
    ["12e-6 K^-1", -240],
  ])("α %s", (alpha, want) => {
    expect(out(run("thermal-restrained", { ...RESTRAINED, alpha }), "sigma")).toBeCloseTo(want, 9);
  });
  // The unit layer does not (yet) read these α spellings; the integrator owns units.ts. Whatever it changes, the
  // outcome must be a named refusal or the EXACT per-kelvin value — a per-°F α is 1.8× its per-K value, and a
  // compound °C/°F read with an offset would be a confident wrong answer.
  test.each([
    ["12e-6 1/°C", 12e-6],
    ["12e-6 /°C", 12e-6],
    ["12e-6 /K", 12e-6],
    ["6.7e-6 1/°F", 6.7e-6 * 1.8],
    ["6.7 µin/(in·°F)", 6.7e-6 * 1.8],
    ["12 ppm/K", 12e-6],
  ])("α %s: a named refusal or exactly the per-kelvin value", (alpha, perK) => {
    const o = run("thermal-restrained", { ...RESTRAINED, alpha });
    if (o.ok === false) expect(o.text).toMatch(/^α: /);
    else expect(out(o, "sigma") / (-200e9 * perK * 100 / 1e6)).toBeCloseTo(1, 9);
  });
  test("E in ksi, thickness in inches", () => {
    expect(out(run("thermal-restrained", { ...RESTRAINED, E: "29000 ksi" }), "sigma")).toBeCloseTo((-29000 * 6894757.29 * 12e-6 * 100) / 1e6, 4);
    const o = run("thermal-bilayer", { ...BI_EQUAL, t1: "0.019685 in", t2: "0.5 mm" });
    expect(out(o, "kappa")).toBeCloseTo(1.5, 4);
  });
});

// ------------------------------------------------------------------ Stoney and thermal shock

describe("Stoney and thermal shock", () => {
  test("Stoney reverse: 414.7135 MPa gives κ = 0.05 m⁻¹", () => {
    const o = run("thermal-stoney", { ...STONEY, solve: "curvature", sigmaf: "414.71354166666663 MPa" });
    expect(out(o, "kappa")).toBeCloseTo(0.05, 12);
    expect(out(o, "R")).toBeCloseTo(20, 9);
  });
  test("Stoney at exactly h_f/h_s = 0.1 is accepted; just above is refused", () => {
    expect(stoneyFilmStress({ Es: 130e9, nus: 0.28, hs: 500e-6, hf: 50e-6 }, 0.05).ok).toBe(true);
    expect(stoneyCurvature({ Es: 130e9, nus: 0.28, hs: 500e-6, hf: 50.1e-6 }, 1e8).ok).toBe(false);
  });
  test("thermal shock without k: R only", () => {
    const o = run("thermal-shock", { ...SHOCK, k: "" });
    expect(out(o, "R")).toBeCloseTo(79.0540540541, 8);
    expect(o.outputs?.some((x) => x.key === "Rprime")).toBe(false);
  });
  test("thermal shock refuses α ≤ 0 by name", () => {
    expect(thermalShock({ sf: 300e6, nu: 0.22, E: 370e9, alpha: 0, k: null }).ok).toBe(false);
    expect(run("thermal-shock", { ...SHOCK, alpha: "-1" }).text).toMatch(/must be positive/);
  });
});

// ------------------------------------------------------------------ adversarial

describe("adversarial inputs", () => {
  test.each([
    ["thermal-restrained", { E: "" }, /E: this field is required/],
    ["thermal-restrained", { E: "abc" }, /does not start with a number/],
    ["thermal-restrained", { E: "-200 GPa" }, /positive/],
    ["thermal-restrained", { E: "1e300 GPa" }, /positive finite/],
    ["thermal-restrained", { E: "200 GPaa" }, /not a unit this recognises/],
    ["thermal-restrained", { dT: "Infinity" }, /does not start with a number/],
    ["thermal-restrained", { dT: "100 m" }, /ΔT: "m" is not compatible/],
    ["thermal-restrained", { alpha: "1 1/K" }, /above 10⁻³/],
    ["thermal-restrained", { mode: "biaxial", nu: "0.3 MPa" }, /not a plain number/],
    ["thermal-restrained", { mode: "biaxial", nu: "" }, /ν: this field is required/],
    ["thermal-restrained", { restraint: "fraction", r: "1.5" }, /between 0/],
    ["thermal-restrained", { restraint: "gap", L: "0 m" }, /positive length/],
    ["thermal-restrained", { sy: "-5 MPa" }, /positive stress/],
    ["thermal-bilayer", { t1: "5 kg" }, /t₁: "kg" is not compatible/],
    ["thermal-bilayer", { t1: "0 mm" }, /thicknesses must be positive/],
    ["thermal-bilayer", { E2: "0" }, /moduli must be positive/],
    ["thermal-bilayer", { t1: "1e-9 mm" }, /differ by more than 10⁶/],
    ["thermal-stoney", { nus: "0.5" }, /outside isotropic linear elasticity/],
    ["thermal-stoney", { hs: "0 µm" }, /must be positive/],
    ["thermal-shock", { sf: "0 MPa" }, /must be positive/],
    ["thermal-shock", { k: "-3 W/(m·K)" }, /conductivity k must be positive/],
    ["thermal-shock", { nu: "-1" }, /outside isotropic linear elasticity/],
  ] as [string, Record<string, string>, RegExp][])("%s %j is refused by name", (id, over, re) => {
    const base = id === "thermal-restrained" ? RESTRAINED : id === "thermal-bilayer" ? BI_EQUAL : id === "thermal-stoney" ? STONEY : SHOCK;
    const o = run(id, { ...base, ...over });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    // The user's own text, echoed in quotes, is theirs; everything this tool wrote must be clean.
    expect(o.text.replace(/"[^"]*"/g, "")).not.toMatch(/NaN|Infinity|undefined|—/);
  });
  test("huge and tiny but valid magnitudes stay finite and typeset", () => {
    const o = run("thermal-stoney", { ...STONEY, kappa: "1e-9 1/m" });
    expect(out(o, "sigmaf") / ((414.71354166666663 / 0.05) * 1e-9)).toBeCloseTo(1, 12);
    expect(o.text).toMatch(/8\.29427×10⁻⁶ MPa/);
    const b = run("thermal-bilayer", { ...BI_EQUAL, t1: "1 µm", t2: "1 µm", dAlpha: "0.001", dT: "1 K" });
    expect(Number.isFinite(out(b, "kappa"))).toBe(true);
  });
});

// ------------------------------------------------------------------ contract: every tool, every default

describe("Release E contract for every thermal tool", () => {
  const variants: [string, Record<string, string>][] = [
    ["thermal-restrained", {}],
    ["thermal-restrained", { mode: "biaxial" }],
    ["thermal-restrained", { mode: "triaxial" }],
    ["thermal-restrained", { restraint: "fraction" }],
    ["thermal-restrained", { restraint: "gap" }],
    ["thermal-restrained", { dT: "-180 °F", mode: "biaxial" }],
    ["thermal-bilayer", {}],
    ["thermal-bilayer", { L: "" }],
    ["thermal-stoney", {}],
    ["thermal-stoney", { solve: "curvature" }],
    ["thermal-shock", {}],
    ["thermal-shock", { k: "" }],
  ];
  test.each(variants)("%s %j: ok, figure, outputs, math lines typeset, display contract", (id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    expect(plots(o).length).toBeGreaterThan(0);
    expect(o.outputs?.length).toBeGreaterThan(0);
    for (const v of o.outputs ?? []) expect(Number.isFinite(v.value)).toBe(true);
    const maths = (o.blocks ?? []).filter((b) => b.kind === "math");
    expect(maths.length).toBeGreaterThan(0);
    for (const b of maths) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    // Display contract over the text and every figure's visible text.
    const svgText = plots(o).map((b) => (b.kind === "plot" ? b.svg.replace(/<[^>]*>/g, " ") : "")).join(" ");
    for (const t of [o.text, svgText]) {
      expect(t).not.toMatch(/\^|NaN|Infinity|undefined|—/);
      expect(t).not.toMatch(/\d[eE][+-]?\d/);
      expect(t).not.toMatch(/(^|[\s(=])-\d/m);
    }
  });
  test("every calculator declares the converts contract and the group", () => {
    expect(THERMAL_STRESS_CALCS.map((c) => c.id)).toEqual(["thermal-restrained", "thermal-bilayer", "thermal-stoney", "thermal-shock"]);
    for (const c of THERMAL_STRESS_CALCS) {
      expect(c.unitContract).toBe("converts");
      expect(c.group).toBe("Structural & solids");
    }
  });
  test("figures are bounded: at most 201 sampled points per line", () => {
    const o = run("thermal-restrained", { restraint: "gap" });
    const p = plots(o)[0];
    const n = p.kind === "plot" ? (p.svg.match(/[ML]\s*-?\d/g) ?? []).length : 0;
    expect(n).toBeLessThan(2000);
  });
});
