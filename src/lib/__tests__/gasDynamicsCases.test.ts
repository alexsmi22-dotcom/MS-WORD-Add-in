// Release E, gap #11: compressible flow beyond isentropic. The FIXED CASE TABLE from the brief (oracle: NACA Report
// 1135 closed forms, ~/jurislab-relE/oracle_wave1.py) is pinned first, through the engine AND through the calculator
// the pane registers; later fix rounds must keep every row's outcome.
//
// Further oracle rows were generated with the jurislab-oracle-venv (scipy brentq on the same closed forms):
//
//   import math; from scipy.optimize import brentq
//   def ns(M,g): M2=math.sqrt((1+(g-1)/2*M**2)/(g*M**2-(g-1)/2)); p=1+2*g/(g+1)*(M**2-1)
//       rr=(g+1)*M**2/((g-1)*M**2+2); return M2,p,p/rr,rr,rr**(g/(g-1))*(1/p)**(1/(g-1))
//   ns(2,5/3)                       -> 0.606977, 4.75, 2.078125, 2.285714, 0.762982
//   theta(b,M,g)=atan(2/tan(b)*(M²sin²b−1)/(M²(g+cos2b)+2)); weak/strong by brentq either side of βmax
//   M 3, θ 20°                      -> β 37.7636° / 82.1467°, M₂ 1.99413, p₂/p₁ 3.77126, θmax 34.0734°
//   PM: brentq(pm(M) − (pm(2)+20°)) -> M₂ 2.830595;  νmax(1.4) = 130.454077°
//   Fanno: brentq(fanno(M) − (fanno(0.5) − 0.8)) -> 0.671631; (fanno(3) − 0.2) -> 2.058720; supersonic limit 0.821508
//   Rayleigh: brentq(rT0(M) − 1.2·rT0(0.5)) -> 0.610061; (1.1·rT0(2)) -> 1.646374; choke ratio at 0.5 = 1.446429
//   Rayleigh q = 100 kJ/kg, T₁ 300 K, R 287.05, M₁ 0.5: T₀₂/T₀₁ 1.315983 -> M₂ 0.701849
//   Normal shock M₁ 2 at 101.325 kPa, 288.15 K, R 287.05: p₂ 455.9625 kPa, T₂ 486.253 K, V₁ 680.585, V₂ 255.219 m/s
import * as fs from "fs";
import * as path from "path";
import {
  normalShock,
  obliqueShock,
  prandtlMeyer,
  fanno,
  rayleigh,
  fannoFLD,
  fannoFLDSupersonicLimit,
  rayleighState,
  rayleighT0SupersonicLimit,
  machFromNu,
  prandtlMeyerNuMax,
  checkGamma,
} from "../gasDynamics";
import { GAS_DYNAMICS_CALCS } from "../gasDynamicsCalcs";
import { compressibleFlow } from "../fluids";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const rel = (a: number, b: number, tol = 2e-5): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const calc = (id: string) => {
  const c = GAS_DYNAMICS_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const outv = (o: AnalyzeOutput, key: string): number => {
  const e = (o.outputs ?? []).find((x) => x.key === key);
  if (!e) throw new Error(`no output ${key}: ${o.text}`);
  return e.value;
};

// ------------------------------------------------------------------ the fixed case table (brief)

describe("fixed case table (γ = 1.4)", () => {
  test.each([
    [2, { M2: 0.57735, p2p1: 4.5, T2T1: 1.6875, rho2rho1: 2.66667, p02p01: 0.72087 }],
    [3, { M2: 0.47519, p2p1: 10.3333, T2T1: 2.67901, rho2rho1: 3.85714, p02p01: 0.32834 }],
  ] as const)("normal shock M₁ %s (engine and calculator)", (M1, want) => {
    const r = normalShock(M1, 1.4);
    if (!r.ok) throw new Error(r.error);
    const o = run("gd-normal-shock", { M1: String(M1) });
    expect(o.ok).not.toBe(false);
    for (const [k, v] of Object.entries(want)) {
      expect({ k, ok: rel((r as unknown as Record<string, number>)[k], v) }).toEqual({ k, ok: true });
      expect({ k, ok: rel(outv(o, k), v) }).toEqual({ k, ok: true });
    }
  });

  test("normal shock M₁ 0.8: named refusal (subsonic: no normal shock)", () => {
    const r = normalShock(0.8, 1.4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not supersonic.*subsonic flow has no normal shock/);
    const o = run("gd-normal-shock", { M1: "0.8" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/subsonic flow has no normal shock/);
  });

  test("oblique M₁ 2, θ 10°: weak β 39.3139°, strong β 83.7001°, M₂ 1.64052, p₂/p₁ 1.70658, θmax 22.9735°", () => {
    const r = obliqueShock(2, 10, 1.4);
    if (!r.ok) throw new Error(r.error);
    expect(rel(r.weak.betaDeg, 39.3139)).toBe(true);
    expect(rel(r.strong.betaDeg, 83.7001)).toBe(true);
    expect(rel(r.weak.M2, 1.64052)).toBe(true);
    expect(rel(r.weak.p2p1, 1.70658)).toBe(true);
    expect(rel(r.thetaMaxDeg, 22.9735)).toBe(true);
    const o = run("gd-oblique-pm", { M1: "2", theta: "10" });
    expect(rel(outv(o, "betaWeak"), 39.3139)).toBe(true);
    expect(rel(outv(o, "betaStrong"), 83.7001)).toBe(true);
    expect(rel(outv(o, "M2"), 1.64052)).toBe(true);
    expect(rel(outv(o, "p2p1"), 1.70658)).toBe(true);
    expect(rel(outv(o, "thetaMax"), 22.9735)).toBe(true);
  });

  test("oblique M₁ 2, θ 25°: named refusal (detached, θ > θmax 22.97°)", () => {
    const r = obliqueShock(2, 25, 1.4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Detached shock: θ = 25° exceeds θmax = 22\.97° for M₁ = 2/);
    const o = run("gd-oblique-pm", { M1: "2", theta: "25" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/Detached shock.*θmax = 22\.97°/);
  });

  test("Prandtl–Meyer ν(2) 26.3798°, ν(3) 49.7573°", () => {
    for (const [M, nu] of [[2, 26.3798], [3, 49.7573]]) {
      const r = prandtlMeyer(M, null, 1.4);
      if (!r.ok) throw new Error(r.error);
      expect(rel(r.nu1Deg, nu)).toBe(true);
      const o = run("gd-oblique-pm", { mode: "expansion", M1: String(M), theta: "" });
      expect(rel(outv(o, "nu1"), nu)).toBe(true);
    }
  });

  test("Fanno 4f̄L*/D at M 0.5 = 1.06906, at M 2 = 0.30500", () => {
    for (const [M, v] of [[0.5, 1.06906], [2, 0.305]]) {
      expect(rel(fannoFLD(M, 1.4), v)).toBe(true);
      const o = run("gd-fanno", { M1: String(M), L: "" });
      expect(rel(outv(o, "fLDstar"), v)).toBe(true);
    }
  });

  test("Rayleigh T₀/T₀* at M 0.5 = 0.691358, at M 2 = 0.793388", () => {
    for (const [M, v] of [[0.5, 0.691358], [2, 0.793388]]) {
      expect(rel(rayleighState(M, 1.4).T0T0s, v)).toBe(true);
      const o = run("gd-rayleigh", { M1: String(M), ratio: "" });
      expect(rel(outv(o, "T0T0s"), v)).toBe(true);
    }
  });

  test.each(GAS_DYNAMICS_CALCS.map((c) => [c.id]))('γ "1.0": named refusal on %s', (id) => {
    const o = run(id, { gamma: "1.0" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/γ = 1 is not allowed: the specific-heat ratio of a gas must be greater than 1/);
  });
});

// ------------------------------------------------------------------ further oracle rows

describe("further oracle rows (jurislab-oracle-venv, scipy)", () => {
  test("normal shock M₁ 2 at γ = 5/3", () => {
    const r = normalShock(2, 5 / 3);
    if (!r.ok) throw new Error(r.error);
    expect([r.M2, r.p2p1, r.T2T1, r.rho2rho1, r.p02p01].map((v, i) => rel(v, [0.606977, 4.75, 2.078125, 2.285714, 0.762982][i]))).toEqual([true, true, true, true, true]);
  });
  test("normal shock dimensional states at the defaults", () => {
    const o = run("gd-normal-shock");
    expect(rel(outv(o, "p2"), 455.9625)).toBe(true);
    expect(rel(outv(o, "T2"), 486.2531)).toBe(true);
    expect(rel(outv(o, "V1"), 680.5846)).toBe(true);
    expect(rel(outv(o, "V2"), 255.2192)).toBe(true);
  });
  test("oblique M₁ 3, θ 20°", () => {
    const r = obliqueShock(3, 20, 1.4);
    if (!r.ok) throw new Error(r.error);
    expect(rel(r.weak.betaDeg, 37.763634)).toBe(true);
    expect(rel(r.strong.betaDeg, 82.146671)).toBe(true);
    expect(rel(r.weak.M2, 1.994132)).toBe(true);
    expect(rel(r.weak.p2p1, 3.771257)).toBe(true);
    expect(rel(r.thetaMaxDeg, 34.073440)).toBe(true);
  });
  test("θ = 0 is a Mach wave (weak β = μ) and a normal shock (strong β = 90°)", () => {
    const r = obliqueShock(2, 0, 1.4);
    if (!r.ok) throw new Error(r.error);
    expect(rel(r.weak.betaDeg, 30)).toBe(true);
    expect(r.weak.p2p1).toBe(1);
    expect(rel(r.strong.betaDeg, 90)).toBe(true);
    expect(rel(r.strong.p2p1, 4.5)).toBe(true);
  });
  test("θ at θmax gives one solution", () => {
    const r = obliqueShock(2, 22.97353176, 1.4);
    if (!r.ok) throw new Error(r.error);
    expect(Math.abs(r.weak.betaDeg - r.strong.betaDeg)).toBeLessThan(0.05);
  });
  test("Prandtl–Meyer expansion M₁ 2 turned 20° → M₂ 2.830595; νmax 130.454077°", () => {
    const r = prandtlMeyer(2, 20, 1.4);
    if (!r.ok) throw new Error(r.error);
    expect(rel(r.M2!, 2.830595)).toBe(true);
    expect(rel(r.nuMaxDeg, 130.454077)).toBe(true);
    expect(rel(prandtlMeyerNuMax(1.4) * (180 / Math.PI), 130.454077)).toBe(true);
    // Isentropic: the static ratios are compressibleFlow's at M₁ over M₂.
    const a = compressibleFlow(2, 1.4), b = compressibleFlow(r.M2!, 1.4);
    if (!a.ok || !b.ok) throw new Error("isentropic");
    expect(rel(r.p2p1!, a.pressureRatio / b.pressureRatio, 1e-12)).toBe(true);
  });
  test("Fanno exit M from 4f̄L/D: subsonic 0.5 + 0.8 → 0.671631; supersonic 3 + 0.2 → 2.058720", () => {
    const a = fanno(0.5, 0.8, 1.4);
    const b = fanno(3, 0.2, 1.4);
    if (!a.ok || !b.ok) throw new Error("fanno");
    expect(rel(a.s2!.M, 0.671631)).toBe(true);
    expect(rel(b.s2!.M, 2.05872)).toBe(true);
    expect(rel(fannoFLDSupersonicLimit(1.4), 0.821508)).toBe(true);
    // The pane's defaults (f̄ 0.005, L 2 m, D 0.05 m) are exactly 4f̄L/D = 0.8.
    expect(rel(outv(run("gd-fanno"), "M2"), 0.671631)).toBe(true);
  });
  test("Fanno: a Darcy factor is divided by 4 (f_D L/D = 4f̄L/D)", () => {
    const o = run("gd-fanno", { conv: "darcy", f: "0.02" });
    expect(rel(outv(o, "fLD"), 0.8)).toBe(true);
    expect(o.text).toMatch(/Darcy f = 0\.02 ÷ 4/);
  });
  test("a root exactly on a bracket end: a zero-length duct and zero heat leave the state unchanged", () => {
    const a = fanno(0.5, 0, 1.4), b = fanno(2, 0, 1.4), c = rayleigh(0.5, 1, 1.4), d = rayleigh(2, 1, 1.4);
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("x");
    expect(a.s2!.M).toBe(0.5);
    expect(b.s2!.M).toBe(2);
    expect(c.s2!.M).toBe(0.5);
    expect(d.s2!.M).toBe(2);
    expect(outv(run("gd-fanno", { L: "0" }), "M2")).toBe(0.5);
  });
  test("the default normal shock echoes the typed pressure exactly", () => {
    const o = run("gd-normal-shock");
    expect(o.text).toMatch(/101\.325 kPa = 101325 Pa \(converted\)/);
    expect(o.text).toMatch(/Upstream p₁ = 101\.325 kPa/);
  });
  test("Fanno p₀/p₀* is A/A* from the isentropic tool", () => {
    const f = fanno(0.5, null, 1.4);
    const i = compressibleFlow(0.5, 1.4);
    if (!f.ok || !i.ok) throw new Error("x");
    expect(f.s1.p0p0s).toBe(i.areaRatio);
  });
  test("Rayleigh exit M: 0.5 heated 1.2 → 0.610061; 2 heated 1.1 → 1.646374; choke ratio 1.446429", () => {
    const a = rayleigh(0.5, 1.2, 1.4);
    const b = rayleigh(2, 1.1, 1.4);
    if (!a.ok || !b.ok) throw new Error("rayleigh");
    expect(rel(a.s2!.M, 0.610061)).toBe(true);
    expect(rel(b.s2!.M, 1.646374)).toBe(true);
    expect(rel(a.chokeRatio, 1.446429)).toBe(true);
  });
  test("Rayleigh from q: 100 kJ/kg at T₁ 300 K, R 287.05 → T₀₂/T₀₁ 1.315983, M₂ 0.701849", () => {
    const o = run("gd-rayleigh", { heat: "q", q: "100 kJ/kg", T1: "300", R: "287.05" });
    expect(rel(outv(o, "T02T01"), 1.315983)).toBe(true);
    expect(rel(outv(o, "M2"), 0.701849)).toBe(true);
    expect(o.text).toMatch(/q\* = /);
  });
});

// ------------------------------------------------------------------ named refusals and adversarial input

describe("named refusals", () => {
  test.each([
    ["γ above 5/3", () => checkGamma(1.7), /no ideal gas has γ above 5\/3/],
    ["γ NaN", () => checkGamma(NaN), /finite/],
    ["M₁ above the cap", () => normalShock(51, 1.4), /above the limit of 50/],
    ["M₁ exactly 1", () => normalShock(1, 1.4), /not supersonic/],
    ["negative deflection", () => obliqueShock(2, -5, 1.4), /Choose the Prandtl–Meyer expansion/],
    ["oblique subsonic", () => obliqueShock(0.9, 5, 1.4), /needs M₁ > 1/],
    ["PM subsonic", () => prandtlMeyer(0.9, 10, 1.4), /needs M₁ ≥ 1/],
    ["PM turn beyond νmax", () => prandtlMeyer(2, 110, 1.4), /beyond the maximum.*νmax = 130\.45°.*largest possible turn from M₁ = 2 is 104\.07°/],
    ["PM past the Mach cap", () => prandtlMeyer(2, 100, 1.4), /above 50, the limit of this tool/],
    ["PM negative turn", () => prandtlMeyer(2, -3, 1.4), /compression/],
    ["Fanno choked subsonic", () => fanno(0.5, 2, 1.4), /^Choked: .*4f̄L\*\/D = 1\.069 at M₁ = 0\.5/],
    ["Fanno choked supersonic", () => fanno(2, 0.4, 1.4), /^Choked: .*shock inside the duct/],
    ["Fanno M 0", () => fanno(0, 0.1, 1.4), /greater than 0/],
    ["Rayleigh thermally choked", () => rayleigh(0.5, 2, 1.4), /^Thermally choked: .*factor 1\.446/],
    ["Rayleigh supersonic over-cooling", () => rayleigh(3, 0.5, 1.4), /cannot fall below 0\.4898/],
    ["Rayleigh ratio 0", () => rayleigh(0.5, 0, 1.4), /greater than 0/],
    ["Rayleigh at M 1 with heat", () => rayleigh(1, 0.9, 1.4), /already thermally choked/],
  ] as const)("%s", (_n, f, re) => {
    const r = f() as { ok: boolean; error?: string } | null;
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(false);
    expect(r!.error).toMatch(re);
  });
  test("γ typed as 1.667 or 1.6667 is the monatomic 5/3, accepted", () => {
    expect(checkGamma(1.667)).toBeNull();
    expect(checkGamma(1.6667)).toBeNull();
    expect(rayleighT0SupersonicLimit(1.4)).toBeCloseTo(0.4898, 4);
  });
  test("machFromNu inverts ν up to the cap and refuses above it", () => {
    expect(machFromNu(0, 1.4)).toBe(1);
    expect(machFromNu(-0.1, 1.4)).toBeNull();
    expect(machFromNu(prandtlMeyerNuMax(1.4) - 1e-9, 1.4)).toBeNull();
  });
});

describe("adversarial pane input", () => {
  test.each([
    ["gd-normal-shock", { M1: "" }, /M₁: this field is required/],
    ["gd-normal-shock", { M1: "2 m/s" }, /not a plain finite number.*dimensionless/],
    ["gd-normal-shock", { M1: "NaN" }, /not a plain finite number/],
    ["gd-normal-shock", { M1: "Infinity" }, /not a plain finite number/],
    ["gd-normal-shock", { M1: "1e300" }, /above the limit of 50/],
    ["gd-normal-shock", { p1: "5 kg" }, /Upstream static pressure: "kg" is not compatible/],
    ["gd-normal-shock", { T1: "-5" }, /greater than 0 K/],
    ["gd-normal-shock", { gamma: "1.7" }, /no ideal gas has γ above 5\/3/],
    ["gd-normal-shock", { gamma: "abc" }, /not a plain finite number/],
    ["gd-oblique-pm", { theta: "" }, /Turning angle θ: this field is required/],
    ["gd-oblique-pm", { theta: "3 m" }, /"m" is not compatible/],
    ["gd-oblique-pm", { theta: "0.5 rad" }, /Detached shock: θ = 28\.6479°/],
    ["gd-fanno", { L: "5 kg" }, /Duct length: "kg" is not compatible/],
    ["gd-fanno", { f: "" }, /Give the friction factor, length and diameter together/],
    ["gd-fanno", { f: "0.5" }, /not a plausible Fanning factor/],
    ["gd-fanno", { D: "0" }, /greater than 0/],
    ["gd-fanno", { L: "100" }, /^Choked/],
    ["gd-rayleigh", { ratio: "2" }, /^Thermally choked/],
    ["gd-rayleigh", { heat: "q", q: "500 kJ/kg" }, /Thermally choked.*q\* = /],
    ["gd-rayleigh", { heat: "q", q: "-1000 kJ/kg" }, /below absolute zero/],
    ["gd-rayleigh", { heat: "q", q: "5 m" }, /Heat added q: "m" is not compatible/],
    ["gd-rayleigh", { heat: "q", T1: "" }, /Inlet static temperature: this field is required/],
  ] as const)("%s %j → named refusal", (id, over, re) => {
    const o = run(id, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined|—/);
  });

  test("units convert: 2 in diameter, 14.6959 psi, 59 °F, 0.1745329 rad", () => {
    const a = run("gd-normal-shock", { p1: "14.6959 psi", T1: "59 °F" });
    expect(rel(outv(a, "p2"), 455.9625, 1e-4)).toBe(true);
    expect(a.text).toMatch(/\(converted\)/);
    const b = run("gd-oblique-pm", { theta: "0.17453293 rad" });
    expect(rel(outv(b, "betaWeak"), 39.3139)).toBe(true);
    const c = run("gd-fanno", { D: "1.9685 in", L: "78.74 in" });
    expect(rel(outv(c, "fLD"), 0.8, 1e-4)).toBe(true);
  });
});

// ------------------------------------------------------------------ display contract, outputs, figures, formulas

const SCENARIOS: Array<[string, Record<string, string>]> = [
  ["gd-normal-shock", {}],
  ["gd-normal-shock", { M1: "10", p1: "", T1: "" }],
  ["gd-normal-shock", { M1: "1.000001" }],
  ["gd-oblique-pm", {}],
  ["gd-oblique-pm", { theta: "0" }],
  ["gd-oblique-pm", { M1: "50", theta: "45" }],
  ["gd-oblique-pm", { mode: "expansion", theta: "" }],
  ["gd-oblique-pm", { mode: "expansion", theta: "20" }],
  ["gd-oblique-pm", { mode: "expansion", M1: "1", theta: "0" }],
  ["gd-fanno", {}],
  ["gd-fanno", { M1: "0.001", L: "", f: "" }],
  ["gd-fanno", { M1: "3", L: "0.5", conv: "darcy", f: "0.02" }],
  ["gd-fanno", { M1: "1", L: "0" }],
  ["gd-fanno", { L: "0" }],
  ["gd-rayleigh", { ratio: "1" }],
  ["gd-rayleigh", {}],
  ["gd-rayleigh", { M1: "0.1", ratio: "0.5" }],
  ["gd-rayleigh", { M1: "4", ratio: "1.6" }],
  ["gd-rayleigh", { heat: "q", q: "200 kJ/kg", T1: "600 K" }],
];

describe("every result keeps the display contract, declares outputs, draws, and typesets its formulas", () => {
  test.each(SCENARIOS)("%s %j", (id, over) => {
    const o = run(id, over);
    expect({ ok: o.ok, text: o.text }).toEqual({ ok: undefined, text: o.text });
    const blocks = o.blocks ?? [];
    const allText = [o.text, ...blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat() : []))].join("\n");
    expect(allText).not.toMatch(/NaN|Infinity|undefined|not finite|—|\^|_|\d[eE][+-]?\d/);
    expect(allText).not.toMatch(/(^|[\s(=,;:])-\d/);
    // Outputs: present, finite, keyed.
    expect((o.outputs ?? []).length).toBeGreaterThanOrEqual(2);
    for (const e of o.outputs!) expect(Number.isFinite(e.value)).toBe(true);
    // A figure, a results table, and formulas that parse as real Word equations.
    const plots = blocks.filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThanOrEqual(1);
    for (const p of plots) {
      if (p.kind !== "plot") continue;
      expect(p.svg.startsWith("<svg")).toBe(true);
      expect(p.svg.replace(/<[^>]*>/g, " ")).not.toMatch(/NaN|Infinity|undefined|\^|\d[eE][+-]?\d/);
      expect(p.w).toBeGreaterThan(100);
      expect(p.h).toBeGreaterThan(100);
    }
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    const maths = blocks.filter((b) => b.kind === "math");
    expect(maths.length).toBeGreaterThanOrEqual(1);
    for (const m of maths) if (m.kind === "math") expect(() => mathToOmml(m.math)).not.toThrow();
  });
});

describe("reuse and bounds", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "gasDynamics.ts"), "utf8");
  test("the isentropic ratios come from fluids.ts compressibleFlow (no second isentropic implementation)", () => {
    expect(src).toMatch(/import \{ compressibleFlow \} from "\.\/fluids"/);
    // The isentropic exponents γ/(γ−1) and (γ+1)/(2(γ−1)) appear nowhere in the engine's code.
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/g \/ \(g - 1\)|\(g \+ 1\) \/ \(2 \* \(g - 1\)\)/);
  });
  test("every root search is bisection with a hard cap", () => {
    expect(src).toMatch(/const BISECT_CAP = 200;/);
    expect(src).toMatch(/for \(let i = 0; i < BISECT_CAP; i\+\+\)/);
    expect(src).not.toMatch(/while \(/);
  });
});
