// Release Q part Q6: quantum mechanics. The FIXED CASE TABLE from the brief (oracle ~/jurislab-relE/oracle_quantum2.py,
// section Q6) is pinned through the pane's own registry (QUANTUM_MECHANICS_CALCS compute → named outputs) and on the
// engine. Later fix rounds keep every row (cumulative gate).
//
// Further reference values: Python venv C:\Users\AlexanderSmith\jurislab-oracle-venv (numpy, scipy 1.18.1), CODATA 2018
// typed in by hand (scipy's default table is CODATA 2022, so it is NOT used):
//   h=6.62607015e-34; hbar=h/(2*pi); e=1.602176634e-19; c=299792458; me=9.1093837015e-31; mp=1.67262192369e-27
//   md=3.3435837724e-27; ma=6.6446573357e-27; Rinf=10973731.568160; muB=9.2740100783e-24; muN=5.0507837461e-27
//   ge=-2.00231930436256; gp=5.5856946893; gn=-3.82608545
//   pout(n) = 1 - 2*quad(lambda x: (N*eval_hermite(n,x))**2*exp(-x*x), 0, sqrt(2n+1)), N = 1/sqrt(2**n n! sqrt(pi))
//     n=0 0.1572992070502851 (= erfc(1) 0.15729920705028516), 1 0.11161022509471252, 2 0.09506943488572617,
//     5 0.07403423706613199, 20 0.04839766284622837
//   HO proton ω 1e14: E3 = 3.5ħω/e = 0.23037418493281736 eV, x0 = 2.5109564944219743e-11 m
//   finite well (brentq on tan z = √((z0/z)² − 1) and −cot z = √(…)):
//     me, 10 eV, 2 nm: z0 16.200877248084986; 11 states, E1 0.08338119680449638 … E11 9.632922068717985 eV
//     0.067 me, 0.3 eV, 10 nm: z0 3.631671555396738; 0.034208440483167346, 0.13259022771344842, 0.27150428089736683 eV
//     me, 1 eV, 1 nm: E2 0.7027695748808893 eV
//   barrier (me, V0 1 eV, a 1 nm): T(E=V0) 0.1322452093442452, T(1.5 eV) 0.9333909334053505, T(0.1 eV)
//     8.645818971265949e-05, WKB(0.5 eV) 0.0007135539117263049; a = 1 µm, 0.5 eV: log10 T −3145.9711487097507 (log form,
//     the correction term is below 10⁻³⁰⁰); first resonance V0 + π²ħ²/(2ma²) = 1.3760301626167375 eV
//   hydrogen: Lyman α 121.50227341098497 nm (∞), 121.56844561723369 nm (proton); D Balmer α 656.2910300825739 nm;
//     He⁺ (alpha mass) 4 → 3 468.71587503775964 nm, ground −54.41531251419499 eV; Balmer limit 364.506820232955 nm
//   Larmor |g|μ/h: electron 28024.9514240851 MHz/T, proton 42.57747851853565, neutron 29.16469304516751
//     (CODATA 2018 tabulates 28 024.951 4242, 42.577 478 518, 29.164 6931 MHz/T)
//   e^{−iHt/ħ}: H = [[0.3, 0.2−0.1i], [0.2+0.1i, −0.1]] eV, |0⟩, t = 5 fs (scipy.linalg.expm): P0 0.6794523115403318
//   Rabi Ω/2π 1 MHz, Δ/2π 0.5 MHz, t 0.3 µs: 0.6045032594641636 (closed form) = 0.6045032594641635 (expm)
//   infinite well me, 1 nm, n = 1: Δx 1.80756027595664e-10 m, Δp 3.3130350749999996e-25 kg m/s
//   2s most probable radius 3 + √5 = 5.23606797749979 a₀
//
// Fix round 1 (review of Q6) — mpmath 1.4.1 at 80 digits in the same venv, CODATA 2018 as above:
//   finite well, bisection (2000 steps) in φ with z = z0 cos φ, η = z0 sin φ, z0 cos φ − φ = jπ/2 (independent of the
//   double code's arithmetic; its 10 eV / 2 nm energies agree with the brentq rows above), binding ħ²η²/(2ma²):
//     me, 1e-20 eV, 1 nm: z0 2.5615836098374653e-10, E − V0 = −6.5617105901879397e-40 eV (= −V0·z0² to leading
//       order; the review brief's "−6.56171×10⁻³⁶" has a typo in the exponent; the old code printed −6.10916×10⁻³⁶, noise)
//     me, 1e-4 eV, 1 nm: E − V0 = −6.555975553761673e-8 eV
//     me, 10 eV, 2 nm: n = 1 −9.9166188031955036, n = 11 −0.36707793128199771 eV
//     me, 1 eV, 1 nm: n = 2 −0.29723042511911037 eV
//   barrier, lnT = −(ln c + 2x − 2 ln 2 + ln(1 + 4e^{−2x}/c)), ratio = (lnT + 2x)/ln 10, at 60 digits:
//     m 1e-20 kg, V0 1 eV, a 1 m, E 0.5 eV: log10 T −329680562688607.9361796665, T/T_WKB 4.0 (E/V0 0.25: 3.0)
//     proton, a 1 m, E 0.5 eV: log10 T −134831769839.938981960421 (T = 1.1508…×10⁻¹³⁴⁸³¹⁷⁶⁹⁸⁴⁰), T/T_WKB 4.0

import { QUANTUM_MECHANICS_CALCS, fromLog10, log10Figures } from "../quantumMechanicsCalcs";
import {
  CODATA_2018,
  EV,
  FINITE_MAX_STATES,
  HBAR,
  H_PLANCK,
  M_E,
  barrierT,
  evolve2,
  finiteWell,
  finiteWellPsi,
  harmonicOscillator,
  hermite,
  hydrogenLevel,
  hydrogenModel,
  hydrogenTransition,
  infiniteWell,
  isErr,
  larmorOmega,
  oscillatorProbOutside,
  oscillatorPsi,
  rabiP1,
  radialP,
  radialStats,
} from "../quantumMechanics";
import { curvesSvg, hydrogenLevelSvg, levelFigureSvg, tunnelSvg } from "../quantumMechanicsCharts";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = QUANTUM_MECHANICS_CALCS.find((x) => x.id === id);
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
const okText = (o: AnalyzeOutput): string => {
  if (o.ok === false) throw new Error(`refused: ${o.text}`);
  return o.text;
};

// ---------------------------------------------------------------------------------------------------------------
// The brief's fixed case table
// ---------------------------------------------------------------------------------------------------------------

describe("Q6 fixed case table (brief)", () => {
  test("electron, infinite well L 1 nm: E₁ 0.376030, E₂ 1.50412, E₃ 3.38427 eV", () => {
    const o = run("qm-particle-box", { well: "infinite", particle: "electron", width: "1 nm" });
    okText(o);
    expect(rel(out(o, "E1"), 0.3760301621559357)).toBeLessThan(1e-6);
    expect(rel(out(o, "E2"), 1.5041206486237428)).toBeLessThan(1e-6);
    expect(rel(out(o, "E3"), 3.3842714594034216)).toBeLessThan(1e-6);
    expect(o.text).toContain("0.37603 eV");
  });

  test("harmonic oscillator ω 1×10¹⁵ rad/s: E₀ 0.329106 eV, spacing 0.658212 eV", () => {
    const o = run("qm-harmonic-oscillator", { omega: "1e15 rad/s", n: "0" });
    okText(o);
    expect(rel(out(o, "E0"), 0.3291059782738037)).toBeLessThan(1e-6);
    expect(rel(out(o, "spacing"), 0.6582119565476074)).toBeLessThan(1e-6);
    expect(o.text).toContain("0.329106 eV");
    expect(o.text).toContain("0.658212 eV");
  });

  test("hydrogen 3 → 2: λ 656.112 nm (vacuum, infinite mass); 656.470 nm with the reduced mass", () => {
    const inf = run("qm-hydrogen", { Z: "1", nucleus: "infinite", upper: "3", lower: "2" });
    okText(inf);
    expect(rel(out(inf, "lambda"), 656.112276419319)).toBeLessThan(1e-8);
    expect(inf.text).toContain("656.112 nm in vacuum");
    const red = run("qm-hydrogen", { Z: "1", nucleus: "proton", upper: "3", lower: "2" });
    okText(red);
    expect(rel(out(red, "lambda"), 656.469606333062)).toBeLessThan(1e-8);
    expect(red.text).toContain("656.47 nm in vacuum");
  });

  test("hydrogen ground state, infinite mass: −13.6057 eV", () => {
    const o = run("qm-hydrogen", { nucleus: "infinite" });
    expect(rel(out(o, "E1"), -13.605693122994232)).toBeLessThan(1e-9);
    expect(o.text).toContain("−13.6057");
    // CODATA 2018 tabulates R∞hc = 13.605 693 122 994 eV.
    expect(rel(out(o, "ionisation"), 13.605693122994)).toBeLessThan(1e-11);
  });

  test("electron, barrier V₀ 1 eV, a 1 nm, E 0.5 eV: T 2.85015×10⁻³", () => {
    const o = run("qm-tunnelling", { V0: "1 eV", width: "1 nm", E: "0.5 eV" });
    okText(o);
    expect(rel(out(o, "T"), 0.002850146716397213)).toBeLessThan(1e-7);
    expect(o.text).toContain("T = 0.00285015");
  });

  test("finite well V₀ 1 eV, width 1 nm, electron: 2 bound states, E₁ 0.190761 eV", () => {
    const o = run("qm-particle-box", { well: "finite", depth: "1 eV", width: "1 nm" });
    okText(o);
    expect(out(o, "count")).toBe(2);
    expect(rel(out(o, "E1"), 0.1907605451975828)).toBeLessThan(1e-7);
    expect(rel(out(o, "E2"), 0.7027695748808893)).toBeLessThan(1e-7);
    expect(o.text).toContain("2 bound states");
  });

  test("Rabi Ω/2π 1 MHz, Δ 0, t 0.25 µs: P₁ 0.5", () => {
    const o = run("qm-two-level", { mode: "rabi", rabi: "1 MHz", detuning: "0 Hz", t: "0.25 µs" });
    okText(o);
    expect(out(o, "P1")).toBeCloseTo(0.5, 12);
    expect(o.text).toContain("P₁(t) = 0.5");
  });

  test.each([
    ["negative width (infinite well)", "qm-particle-box", { width: "-1 nm" }, /width must be positive/],
    ["negative width (finite well)", "qm-particle-box", { well: "finite", width: "-1 nm" }, /width must be positive/],
    ["negative typed mass", "qm-particle-box", { particle: "typed", mass: "-1 kg" }, /mass must be positive/],
    ["negative effective mass", "qm-harmonic-oscillator", { particle: "effective", mstar: "-0.1" }, /must be positive/],
    ["negative barrier width", "qm-tunnelling", { width: "-2 nm" }, /width must be positive/],
    ["zero typed mass", "qm-tunnelling", { particle: "typed", mass: "0 kg" }, /mass must be positive/],
  ])("%s: named refusal", (_n, id, over, msg) => {
    const o = run(id, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Further oracle rows
// ---------------------------------------------------------------------------------------------------------------

describe("engine against further oracle values", () => {
  test("infinite well: Δx, Δp, ⟨x⟩ for n = 1 (ΔxΔp > ħ/2)", () => {
    const w = infiniteWell(M_E, 1e-9, 1);
    if (isErr(w)) throw new Error(w.error);
    expect(rel(w.dx, 1.80756027595664e-10)).toBeLessThan(1e-12);
    expect(rel(w.dp, 3.3130350749999996e-25)).toBeLessThan(1e-9);
    expect(w.xMean).toBe(5e-10);
    expect(w.dx * w.dp).toBeGreaterThan(HBAR / 2);
  });

  test.each([
    [0, 0.1572992070502851],
    [1, 0.11161022509471252],
    [2, 0.09506943488572617],
    [5, 0.07403423706613199],
    [20, 0.04839766284622837],
  ])("oscillator: probability outside the turning points, n = %i", (n, p) => {
    expect(Math.abs(oscillatorProbOutside(n) - p)).toBeLessThan(1e-10);
  });

  test("oscillator: proton at ω 1×10¹⁴ rad/s, n = 3", () => {
    const o = harmonicOscillator(CODATA_2018.mp, 1e14, 3);
    if (isErr(o)) throw new Error(o.error);
    expect(rel(o.En / EV, 0.23037418493281736)).toBeLessThan(1e-9);
    expect(rel(o.x0, 2.5109564944219743e-11)).toBeLessThan(1e-9);
    expect(rel(o.turning, 6.643366437143087e-11)).toBeLessThan(1e-9);
  });

  test("oscillator wavefunctions are normalised and match Hermite's closed form", () => {
    for (const n of [0, 3, 10, 20]) {
      let s = 0;
      const h = 1e-3;
      for (let i = -12000; i <= 12000; i++) s += oscillatorPsi(n, i * h) ** 2 * h;
      expect(Math.abs(s - 1)).toBeLessThan(1e-9);
    }
    // H₃(ξ) = 8ξ³ − 12ξ; ψ₃ = H₃ e^{−ξ²/2}/√(2³·3!·√π)
    const xi = 0.7;
    expect(hermite(3, xi)).toBeCloseTo(8 * xi ** 3 - 12 * xi, 12);
    expect(oscillatorPsi(3, xi)).toBeCloseTo((hermite(3, xi) * Math.exp(-xi * xi / 2)) / Math.sqrt(8 * 6 * Math.sqrt(Math.PI)), 12);
  });

  test("finite well: 10 eV, 2 nm electron (11 states) and a GaAs well (m* 0.067 mₑ)", () => {
    const a = finiteWell(M_E, 10 * EV, 2e-9);
    if (isErr(a)) throw new Error(a.error);
    expect(a.states.length).toBe(11);
    expect(rel(a.z0, 16.200877248084986)).toBeLessThan(1e-12);
    expect(rel(a.states[0].E / EV, 0.08338119680449638)).toBeLessThan(1e-9);
    expect(rel(a.states[10].E / EV, 9.632922068717985)).toBeLessThan(1e-9);
    expect(a.states.map((s) => s.parity).slice(0, 4)).toEqual(["even", "odd", "even", "odd"]);
    const g = finiteWell(0.067 * M_E, 0.3 * EV, 10e-9);
    if (isErr(g)) throw new Error(g.error);
    expect(g.states.length).toBe(3);
    g.states.forEach((s, i) => expect(rel(s.E / EV, [0.034208440483167346, 0.13259022771344842, 0.27150428089736683][i])).toBeLessThan(1e-9));
  });

  test("finite well: wavefunctions normalised and continuous at the wall", () => {
    const fw = finiteWell(M_E, EV, 1e-9);
    if (isErr(fw)) throw new Error(fw.error);
    for (const st of fw.states) {
      let s = 0;
      const h = 1e-12;
      for (let i = -20000; i <= 20000; i++) s += finiteWellPsi(st, fw.z0, fw.a, i * h) ** 2 * h;
      expect(Math.abs(s - 1)).toBeLessThan(1e-6);
      const inside = finiteWellPsi(st, fw.z0, fw.a, fw.a * (1 - 1e-12));
      const outside = finiteWellPsi(st, fw.z0, fw.a, fw.a * (1 + 1e-12));
      expect(Math.abs(inside - outside)).toBeLessThan(1e-6 * Math.abs(inside) + 1e-3);
    }
  });

  test("finite well at the threshold z₀ = π/2: one bound state, the rim state named", () => {
    const a = 0.5e-9;
    const V0 = ((Math.PI / 2) * HBAR / a) ** 2 / (2 * M_E);
    const fw = finiteWell(M_E, V0, 2 * a);
    if (isErr(fw)) throw new Error(fw.error);
    expect(fw.states.length).toBe(1);
    expect(fw.threshold).toBe(true);
    const o = run("qm-particle-box", { well: "finite", width: "1 nm", depth: `${V0 / EV} eV` });
    expect(okText(o)).toMatch(/sits at the rim/);
    // Just above and below the crossing (outside the 10⁻⁶ window): 2 and 1 states.
    const up = finiteWell(M_E, V0 * (1 + 1e-4), 2 * a), dn = finiteWell(M_E, V0 * (1 - 1e-4), 2 * a);
    if (isErr(up) || isErr(dn)) throw new Error("refused");
    expect([up.states.length, dn.states.length]).toEqual([2, 1]);
  });

  test("finite well: a well past the state cap is refused by name; at the cap it solves", () => {
    const big = finiteWell(M_E, 1e6 * EV, 1e-6);
    expect(isErr(big) && big.error).toMatch(/more than 1000 bound states/);
    // z₀ just under 500π: 1000 states, all found (each by a bounded bisection, 200 steps at most).
    const a = 0.5e-9;
    const V0 = (((FINITE_MAX_STATES - 0.5) * Math.PI) / 2 * HBAR / a) ** 2 / (2 * M_E);
    const fw = finiteWell(M_E, V0, 2 * a);
    if (isErr(fw)) throw new Error(fw.error);
    expect(fw.states.length).toBe(FINITE_MAX_STATES);
  });

  test("barrier: at, above and below the top; WKB; an opaque barrier in the log domain; resonance", () => {
    const at = barrierT(M_E, EV, 1e-9, EV);
    const ab = barrierT(M_E, EV, 1e-9, 1.5 * EV);
    const lo = barrierT(M_E, EV, 1e-9, 0.1 * EV);
    const mid = barrierT(M_E, EV, 1e-9, 0.5 * EV);
    const op = barrierT(M_E, EV, 1e-6, 0.5 * EV);
    if ([at, ab, lo, mid, op].some(isErr)) throw new Error("refused");
    const g = (b: typeof at) => (isErr(b) ? null : b);
    expect(rel(g(at)!.T, 0.1322452093442452)).toBeLessThan(1e-12);
    expect(g(at)!.regime).toBe("at");
    expect(rel(g(ab)!.T, 0.9333909334053505)).toBeLessThan(1e-12);
    expect(rel(g(lo)!.T, 8.645818971265949e-5)).toBeLessThan(1e-10);
    expect(rel(Math.pow(10, g(mid)!.wkbLog10 as number), 0.0007135539117263049)).toBeLessThan(1e-10);
    expect(Math.abs(g(op)!.log10T - -3145.9711487097507)).toBeLessThan(1e-9);
    expect(g(op)!.T).toBe(0);
    const res = barrierT(M_E, EV, 1e-9, 1.3760301626167375 * EV);
    expect(isErr(res) ? 0 : res.T).toBeCloseTo(1, 10);
    // Continuity across E = V₀.
    const just = [1 - 1e-9, 1 + 1e-9].map((k) => barrierT(M_E, EV, 1e-9, k * EV));
    for (const b of just) expect(isErr(b) ? 0 : rel(b.T, 0.1322452093442452)).toBeLessThan(1e-6);
  });

  test("hydrogen: Lyman α, deuterium Balmer α, He⁺ 4 → 3, Balmer limit, He⁺ ground", () => {
    const h = hydrogenModel(1, null), hp = hydrogenModel(1, CODATA_2018.mp), hd = hydrogenModel(1, CODATA_2018.md), he = hydrogenModel(2, CODATA_2018.malpha);
    if ([h, hp, hd, he].some(isErr)) throw new Error("refused");
    const T = (m: typeof h, u: number, l: number) => {
      const r = hydrogenTransition(m as Exclude<typeof h, { error: string }>, u, l);
      if (isErr(r)) throw new Error(r.error);
      return r;
    };
    expect(rel(T(h, 2, 1).lambda * 1e9, 121.50227341098497)).toBeLessThan(1e-12);
    expect(rel(T(hp, 2, 1).lambda * 1e9, 121.56844561723369)).toBeLessThan(1e-12);
    expect(rel(T(hd, 3, 2).lambda * 1e9, 656.2910300825739)).toBeLessThan(1e-12);
    expect(rel(T(he, 4, 3).lambda * 1e9, 468.71587503775964)).toBeLessThan(1e-12);
    expect(rel(T(h, 3, 2).limit * 1e9, 364.506820232955)).toBeLessThan(1e-12);
    expect(rel(hydrogenLevel(he as Exclude<typeof he, { error: string }>, 1) / EV, -54.41531251419499)).toBeLessThan(1e-12);
    const o = run("qm-hydrogen", { Z: "2", nucleus: "alpha", upper: "4", lower: "3", orbital: "3d" });
    expect(rel(out(o, "lambda"), 468.71587503775964)).toBeLessThan(1e-10);
    expect(okText(o)).toContain("series ending on n = 3");
  });

  test("hydrogen radial probability: normalised, ⟨r⟩ closed form, peaks (1s at a₀, 2s at 3 + √5, 2p at 4a₀)", () => {
    for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 0], [3, 2], [4, 1], [4, 3]]) {
      let s = 0, m = 0;
      const h = 1e-3;
      for (let i = 0; i < 200000; i++) {
        const p = radialP(n, l, 1, i * h);
        s += p * h;
        m += i * h * p * h;
      }
      expect(Math.abs(s - 1)).toBeLessThan(1e-9);
      expect(Math.abs(m - (3 * n * n - l * (l + 1)) / 2)).toBeLessThan(1e-6);
    }
    expect(radialStats(1, 0, 1).peak).toBeCloseTo(1, 6);
    expect(radialStats(2, 0, 1).peak).toBeCloseTo(3 + Math.sqrt(5), 6);
    expect(radialStats(2, 1, 1).peak).toBeCloseTo(4, 6);
    expect(radialStats(4, 3, 1).peak).toBeCloseTo(16, 6);
    // Z scales r by 1/Z.
    expect(radialStats(1, 0, 2).peak).toBeCloseTo(0.5, 6);
  });

  test("Larmor frequencies against the CODATA 2018 gyromagnetic ratios", () => {
    const f = (g: number, mu: number) => Math.abs(larmorOmega(g, mu, 1)) / (2 * Math.PI) / 1e6;
    expect(rel(f(CODATA_2018.ge, CODATA_2018.muB), 28024.9514242)).toBeLessThan(5e-10);
    expect(rel(f(CODATA_2018.gp, CODATA_2018.muN), 42.577478518)).toBeLessThan(5e-10);
    expect(rel(f(CODATA_2018.gn, CODATA_2018.muN), 29.1646931)).toBeLessThan(5e-8);
    expect(Math.abs(larmorOmega(CODATA_2018.ge, CODATA_2018.muB, 1) - 1.7608596302e11)).toBeLessThan(1e2);
    const o = run("qm-two-level", { mode: "spin", spin: "electron", B: "1 T", t: "1 ns", spinState: "|+⟩" });
    expect(rel(out(o, "fL"), 28024.9514242e6)).toBeLessThan(5e-10);
    expect(okText(o)).toContain("anticlockwise seen from +z");
  });

  test("e^(−iHt/ħ): a complex Hermitian H against scipy expm; the Rabi closed form against the evolution", () => {
    const H = [
      [{ re: 0.3 * EV, im: 0 }, { re: 0.2 * EV, im: -0.1 * EV }],
      [{ re: 0.2 * EV, im: 0.1 * EV }, { re: -0.1 * EV, im: 0 }],
    ];
    const ev = evolve2(H, [{ re: 1, im: 0 }, { re: 0, im: 0 }], 5e-15);
    if (isErr(ev)) throw new Error(ev.error);
    expect(Math.abs(ev.psi[0].re ** 2 + ev.psi[0].im ** 2 - 0.6794523115403318)).toBeLessThan(1e-12);
    expect(ev.check).toBeLessThan(1e-12);
    const o = run("qm-two-level", { mode: "hamiltonian", H: "[[0.3, 0.2-0.1i], [0.2+0.1i, -0.1]]", hUnit: "eV", state: "|0⟩", t: "5 fs" });
    expect(Math.abs(out(o, "P0") - 0.6794523115403318)).toBeLessThan(1e-10);
    const Om = 2 * Math.PI * 1e6, De = 2 * Math.PI * 0.5e6;
    expect(Math.abs(rabiP1(Om, De, 0.3e-6) - 0.6045032594641636)).toBeLessThan(1e-13);
    const r = run("qm-two-level", { mode: "rabi", rabi: "1 MHz", detuning: "0.5 MHz", t: "0.3 µs" });
    expect(Math.abs(out(r, "P1") - 0.6045032594641636)).toBeLessThan(1e-12);
    expect(out(r, "maxP1")).toBeCloseTo(0.8, 12);
    // A Pauli expression reads as the same operator as the matrix.
    const p = run("qm-two-level", { mode: "hamiltonian", H: "0.2*X + 0.1*Y + 0.3*Z", hUnit: "hMHz", t: "0.1 µs" });
    const m = run("qm-two-level", { mode: "hamiltonian", H: "[[0.3, 0.2-0.1i], [0.2+0.1i, -0.3]]", hUnit: "hMHz", t: "0.1 µs" });
    expect(Math.abs(out(p, "P1") - out(m, "P1"))).toBeLessThan(1e-13);
  });

  test("demo defaults: spin mode precesses out of the box (|+⟩, ⟨σx⟩ moves); a high-Z ion leads with its caution", () => {
    const o = run("qm-two-level", { mode: "spin" });
    okText(o);
    expect(Math.abs(out(o, "blochX"))).toBeLessThan(0.999);
    expect(Math.hypot(out(o, "blochX"), out(o, "blochY"))).toBeCloseTo(1, 9);
    const z = run("qm-hydrogen", { Z: "20" });
    expect(okText(z).split("\n")[0]).toMatch(/^Caution: at Z = 20 .*0\.53 %/);
    expect(okText(run("qm-hydrogen", { Z: "8" }))).not.toMatch(/Caution/);
  });

  test("the CODATA block: exact constants and ħ = h/2π", () => {
    expect(H_PLANCK).toBe(6.62607015e-34);
    expect(EV).toBe(1.602176634e-19);
    expect(rel(HBAR, 1.054571817e-34)).toBeLessThan(1e-9);
    expect(CODATA_2018.me).toBe(9.1093837015e-31);
    expect(CODATA_2018.mp).toBe(1.67262192369e-27);
    expect(CODATA_2018.Rinf).toBe(10973731.56816);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial
// ---------------------------------------------------------------------------------------------------------------

describe("adversarial inputs: named refusals, never a confident wrong number", () => {
  test.each([
    ["empty width", "qm-particle-box", { width: "" }, /required/],
    ["wrong quantity in a length field", "qm-particle-box", { width: "5 kg" }, /not compatible/],
    ["unit typo", "qm-particle-box", { width: "1 nmm" }, /not a unit/],
    ["the u for daltons", "qm-tunnelling", { particle: "typed", mass: "1 u" }, /Da/],
    ["non-finite", "qm-particle-box", { width: "Infinity nm" }, /number/],
    ["levels out of range", "qm-particle-box", { levels: "9" }, /1 to 8/],
    ["state n = 0 in the infinite well", "qm-particle-box", { n: "0" }, /quantum number/],
    ["oscillator n = 21", "qm-harmonic-oscillator", { n: "21" }, /0 to 20/],
    ["oscillator ω in kg", "qm-harmonic-oscillator", { omega: "3 kg" }, /not an angular frequency/],
    ["oscillator ω negative", "qm-harmonic-oscillator", { omega: "-1e15 rad/s" }, /must be positive/],
    ["Z = 0", "qm-hydrogen", { Z: "0" }, /whole number from 1 to 36/],
    ["Z = 1.5", "qm-hydrogen", { Z: "1.5" }, /whole number/],
    ["upper ≤ lower", "qm-hydrogen", { upper: "2", lower: "3" }, /upper level must be above/],
    ["orbital 5s", "qm-hydrogen", { orbital: "5s" }, /n ≤ 4/],
    ["orbital 2d", "qm-hydrogen", { orbital: "2d" }, /does not exist/],
    ["orbital nonsense", "qm-hydrogen", { orbital: "p2" }, /1s to 4f/],
    ["typed nuclear mass negative", "qm-hydrogen", { nucleus: "typed", nucMass: "-1 Da" }, /positive/],
    ["energy zero", "qm-tunnelling", { E: "0 eV" }, /energy must be positive/],
    ["barrier height negative", "qm-tunnelling", { V0: "-1 eV" }, /height V₀ must be positive/],
    ["Rabi Ω zero", "qm-two-level", { rabi: "0 Hz" }, /must be positive/],
    ["Rabi Ω in rad/s (not a frequency)", "qm-two-level", { rabi: "1e6 rad/s" }, /not compatible/],
    ["negative time", "qm-two-level", { t: "-1 µs" }, /zero or positive/],
    ["Rabi phase past 10⁶ rad", "qm-two-level", { t: "1 s" }, /10⁶ rad/],
    ["non-Hermitian H", "qm-two-level", { mode: "hamiltonian", H: "[[0, 1], [0, 0]]" }, /Hermitian/],
    ["3 × 3 H", "qm-two-level", { mode: "hamiltonian", H: "[[1,0,0],[0,1,0],[0,0,1]]" }, /two-level/],
    ["two-qubit state", "qm-two-level", { mode: "spin", spinState: "|00⟩" }, /two amplitudes/],
    ["empty state", "qm-two-level", { mode: "hamiltonian", state: "" }, /No state/],
    ["evolution phase past 10⁶ rad", "qm-two-level", { mode: "spin", B: "10 T", t: "1 s" }, /past the/],
    ["field in metres", "qm-two-level", { mode: "spin", B: "1 m" }, /not compatible/],
    ["Z = 37 (relativistic corrections past 2 %)", "qm-hydrogen", { Z: "37" }, /Dirac treatment/],
    ["ω in 1/s (ambiguous by 2π)", "qm-harmonic-oscillator", { omega: "1e15 1/s" }, /s⁻¹ is ambiguous/],
    ["ω in s^-1", "qm-harmonic-oscillator", { omega: "1e15 s^-1" }, /s⁻¹ is ambiguous/],
  ])("%s", (_n, id, over, msg) => {
    const o = run(id, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
    // A refusal may quote what was typed ("Infinity nm"); it never prints a computed NaN or undefined.
    expect(o.text).not.toMatch(/NaN|undefined/);
  });

  test("huge and tiny magnitudes: a refusal or a finite typeset answer, never NaN", () => {
    const cases: [string, Record<string, string>][] = [
      ["qm-particle-box", { width: "1e-200 m" }],
      ["qm-particle-box", { width: "1 m" }],
      ["qm-particle-box", { particle: "typed", mass: "1 kg", width: "1 m" }],
      ["qm-particle-box", { well: "finite", width: "1 pm", depth: "1 eV" }],
      ["qm-harmonic-oscillator", { omega: "1 Hz" }],
      ["qm-harmonic-oscillator", { omega: "1e30 rad/s" }],
      ["qm-hydrogen", { upper: "1000", lower: "999" }],
      ["qm-hydrogen", { Z: "118" }],
      ["qm-tunnelling", { width: "1 mm" }],
      ["qm-tunnelling", { E: "1e6 eV" }],
      ["qm-tunnelling", { E: "1e-12 eV" }],
      ["qm-two-level", { mode: "hamiltonian", H: "[[0, 0], [0, 0]]" }],
      ["qm-two-level", { mode: "spin", B: "0 T" }],
    ];
    for (const [id, over] of cases) {
      const o = run(id, over);
      expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
      if (o.ok !== false) for (const v of o.outputs ?? []) expect(Number.isFinite(v.value)).toBe(true);
    }
    // The opaque millimetre barrier still prints a transmission (as a power of ten), not 0.
    const op = run("qm-tunnelling", { width: "1 mm" });
    expect(okText(op)).toMatch(/Transmission T = \d(\.\d+)?×10⁻[⁰¹²³⁴⁵⁶⁷⁸⁹]+;/);
    expect(op.blocks?.find((b) => b.kind === "plot")?.kind === "plot" && (op.blocks.find((b) => b.kind === "plot") as { caption: string }).caption).toMatch(/runs off the bottom/);
    expect(op.outputs?.some((v) => v.key === "T")).toBe(false);
  });

  test("fromLog10 writes mantissa × 10ⁿ past double range, rounding the mantissa up to the next decade", () => {
    expect(fromLog10(-3145.9711487097507)).toBe("1.06869×10⁻³¹⁴⁶");
    expect(fromLog10(Math.log10(0.00285015))).toBe("0.00285015");
    expect(fromLog10(-400 - 1e-12)).toBe("1×10⁻⁴⁰⁰");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Display contract, math lines, figures
// ---------------------------------------------------------------------------------------------------------------

describe("display contract, math lines and figures", () => {
  const VARIANTS: [string, Record<string, string>][] = [
    ["qm-particle-box", {}],
    ["qm-particle-box", { levels: "8", n: "3" }],
    ["qm-particle-box", { levels: "1", particle: "proton", width: "10 pm" }],
    ["qm-particle-box", { well: "finite" }],
    ["qm-particle-box", { well: "finite", depth: "10 eV", width: "2 nm", levels: "8" }],
    ["qm-particle-box", { well: "finite", depth: "0.01 eV" }],
    ["qm-particle-box", { well: "finite", particle: "effective", depth: "0.3 eV", width: "10 nm" }],
    ["qm-harmonic-oscillator", {}],
    ["qm-harmonic-oscillator", { levels: "8", n: "20" }],
    ["qm-harmonic-oscillator", { omega: "1 THz" }],
    ["qm-harmonic-oscillator", { omega: "500 N/m", particle: "typed", mass: "1 Da" }],
    ["qm-harmonic-oscillator", { omega: "2990 cm^-1", particle: "typed", mass: "0.98 Da" }],
    ["qm-hydrogen", {}],
    ["qm-hydrogen", { upper: "2", lower: "1", orbital: "1s", nucleus: "proton" }],
    ["qm-hydrogen", { upper: "20", lower: "2", orbital: "4f" }],
    ["qm-hydrogen", { Z: "3", nucleus: "typed", nucMass: "7.014 Da", upper: "7", lower: "6", orbital: "3d" }],
    ["qm-tunnelling", {}],
    ["qm-tunnelling", { E: "1 eV" }],
    ["qm-tunnelling", { E: "5 eV" }],
    ["qm-tunnelling", { width: "10 nm" }],
    ["qm-tunnelling", { E: "0.001 eV", particle: "proton", width: "0.1 nm" }],
    ["qm-two-level", {}],
    ["qm-two-level", { detuning: "-0.5 MHz", t: "0.3 µs" }],
    ["qm-two-level", { t: "20 µs" }],
    ["qm-two-level", { mode: "spin" }],
    ["qm-two-level", { mode: "spin", spin: "proton", B: "1 T", spinState: "1/sqrt(2)|0⟩ + i/sqrt(2)|1⟩", t: "10 ns" }],
    ["qm-two-level", { mode: "spin", spin: "neutron", B: "0.5 T", spinState: "|0⟩" }],
    ["qm-two-level", { mode: "hamiltonian" }],
    ["qm-two-level", { mode: "hamiltonian", H: "0.3*X + 0.1*Z", hUnit: "eV", t: "5 fs", state: "|1⟩" }],
  ];
  const runs = VARIANTS.map(([id, o]) => [`${id} ${JSON.stringify(o)}`, run(id, o)] as const);

  test.each(runs)("%s: ok, no caret / e-notation / NaN / em dash / hyphen-minus; outputs; math parses; a figure", (_n, o) => {
    const t = okText(o);
    expect(t).not.toMatch(/\^|NaN|Infinity|undefined|—/);
    expect(t).not.toMatch(/\d[eE][+-]?\d/);
    expect(t).not.toMatch(/(^|[\s(=,;:[/])-\d/m);
    expect((o.outputs ?? []).length).toBeGreaterThan(0);
    for (const v of o.outputs ?? []) expect(Number.isFinite(v.value)).toBe(true);
    const keys = (o.outputs ?? []).map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
    const blocks = o.blocks ?? [];
    expect(blocks.some((b) => b.kind === "math")).toBe(true);
    for (const b of blocks) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    const plots = blocks.filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThan(0);
    for (const p of plots) if (p.kind === "plot") {
      expect(p.svg).toMatch(/^<svg[\s\S]*<text[\s\S]*<\/svg>$/);
      const texts = [...p.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join(" | ");
      expect(texts).not.toMatch(/NaN|Infinity|undefined|\^|\d[eE][+-]?\d|(^|[\s(])-\d/);
      expect(p.svg).not.toMatch(/NaN/);
    }
    for (const b of blocks) if (b.kind === "table") for (const row of b.rows) for (const c of row) expect(c).not.toMatch(/NaN|\^|(^|\s)-\d/);
  });

  test("five tools, the 'converts' unit contract, unique ids, the new group", () => {
    expect(QUANTUM_MECHANICS_CALCS.map((c) => c.id)).toEqual(["qm-particle-box", "qm-harmonic-oscillator", "qm-hydrogen", "qm-tunnelling", "qm-two-level"]);
    expect(QUANTUM_MECHANICS_CALCS.every((c) => c.unitContract === "converts")).toBe(true);
    expect(QUANTUM_MECHANICS_CALCS.every((c) => c.group === "Quantum mechanics")).toBe(true);
  });

  test("conversions are reported in the result, typeset", () => {
    const o = run("qm-tunnelling", { width: "10 Å", E: "8.01088317e-20 J" });
    expect(okText(o)).toContain("Barrier width a: 10 Å = 1×10⁻⁹ m");
    expect(rel(out(o, "T"), 0.002850146716397213)).toBeLessThan(1e-7);
  });

  test("builders at their edges: no levels drawn past the cap, an empty curve set, a one-point tunnel curve", () => {
    const lv = Array.from({ length: 12 }, (_, i) => ({ E: i + 1, x1: 0, x2: 1, label: `n = ${i + 1}`, value: `${i + 1} eV`, curve: [[0, 0], [1, 1]] as Array<[number, number]> }));
    const svg = levelFigureSvg({ xRange: [0, 1], potential: [[0, 0], [1, 0]], levels: lv, amp: 0.5, eRange: [0, 14], xTicks: [{ v: 0, label: "0" }], xTitle: "x", yTitle: "E" });
    expect((svg.match(/n = /g) ?? []).length).toBe(8);
    expect(curvesSvg({ series: [], xTitle: "t", yTitle: "P", xRange: [0, 1], yRange: [0, 1] })).toMatch(/<text/);
    expect(hydrogenLevelSvg({ levels: [{ n: 1, E: -13.6 }, { n: 2, E: -3.4 }], upper: 2, lower: 1, arrowLabel: "121.5 nm", unit: "eV" })).toMatch(/121\.5 nm/);
    expect(tunnelSvg({ below: [{ x: 0.5, lt: -2, wkb: -3 }], above: [{ x: 1, t: 0.1 }], xMax: 3, mark: { x: 0.5, lt: -2, t: 0.01 } })).toMatch(/<\/svg>$/);
    // No sample below the barrier at all: still finite axes, no NaN.
    expect(tunnelSvg({ below: [], above: [{ x: 1, t: 0.1 }, { x: 2, t: 0.9 }], xMax: 3, mark: { x: 2, lt: -0.05, t: 0.9 } })).not.toMatch(/NaN|Infinity/);
  });

  test("no underscore subscripts in prose, fallbacks, tables, captions, figure text, output labels or field labels", () => {
    const US = /[A-Za-zΑ-Ωα-ω∞]_/;
    for (const [, o] of runs) {
      expect(o.text).not.toMatch(US);
      for (const b of o.blocks ?? []) {
        if (b.kind === "table") for (const row of b.rows) for (const c of row) expect(c).not.toMatch(US);
        if (b.kind === "plot") {
          expect(b.caption).not.toMatch(US);
          const texts = [...b.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join(" | ");
          expect(texts).not.toMatch(US);
        }
      }
      for (const v of o.outputs ?? []) expect(v.label).not.toMatch(US);
    }
    for (const c of QUANTUM_MECHANICS_CALCS) {
      expect(c.hint ?? "").not.toMatch(US);
      for (const f of c.fields) {
        expect(f.label).not.toMatch(US);
        for (const op of (f as { options?: Array<{ label: string }> }).options ?? []) expect(op.label).not.toMatch(US);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 1: the review's confirmed defects (oracle values in the header). Every row stays (cumulative gate).
// ---------------------------------------------------------------------------------------------------------------

describe("fix round 1: review defects", () => {
  const table = (o: AnalyzeOutput, label: RegExp): string[][] => {
    const t = (o.blocks ?? []).find((b) => b.kind === "table" && label.test((b as { label?: string }).label ?? ""));
    if (!t || t.kind !== "table") throw new Error(`no table ${label}`);
    return t.rows;
  };
  const svgOf = (o: AnalyzeOutput, i = 0): string => {
    const p = (o.blocks ?? []).filter((b) => b.kind === "plot")[i];
    if (!p || p.kind !== "plot") throw new Error("no plot");
    return p.svg;
  };
  const captionOf = (o: AnalyzeOutput, i = 0): string => {
    const p = (o.blocks ?? []).filter((b) => b.kind === "plot")[i];
    if (!p || p.kind !== "plot") throw new Error("no plot");
    return p.caption;
  };

  // #1 fromLog10 precision and the exact/WKB ratio.
  test("#1 opaque barrier, m = 10⁻²⁰ kg, a = 1 m: exact/WKB = 4 (and 3 at E/V₀ = 0.25), T only to its power of ten", () => {
    const o = run("qm-tunnelling", { particle: "typed", mass: "1e-20 kg", width: "1 m" });
    const t = okText(o);
    expect(t).toContain("exact/WKB = 4)");
    expect(rel(out(o, "ratioWkb"), 4)).toBeLessThan(1e-12);
    expect(t).toContain("Transmission T ≈ 10⁻³²⁹⁶⁸⁰⁵⁶²⁶⁸⁸⁶⁰⁸;");
    expect(t).toMatch(/only the power of ten of T/);
    expect(t).not.toMatch(/= ≈/);
    const rows = table(o, /Transmission at a few energies/);
    expect(rows[0]).toEqual(["E/V₀", "E (eV)", "T (exact)", "T (WKB)", "T/T(WKB)"]);
    const r25 = rows.find((r) => r[0] === "0.25") as string[];
    expect(r25[4]).toBe("3");
    expect(rows.find((r) => r[0] === "0.5")?.[4]).toBe("4");
    expect(Math.abs(out(o, "log10T") - -329680562688607.9361796665)).toBeLessThan(0.5);
  });

  test("#1 proton, a = 1 m: three meaningful figures (mantissa 1.1508 by mpmath), not six", () => {
    const o = run("qm-tunnelling", { particle: "proton", width: "1 m" });
    const t = okText(o);
    expect(t).toContain("Transmission T = 1.15×10⁻¹³⁴⁸³¹⁷⁶⁹⁸⁴⁰;");
    expect(t).toContain("WKB estimate exp(−2κa) = 2.88×10⁻¹³⁴⁸³¹⁷⁶⁹⁸⁴¹ (exact/WKB = 4)");
    expect(t).toMatch(/only 3 significant figures/);
  });

  test("#1 mass 1 kg, a = 1 m: |log₁₀ T| ≈ 3×10²⁴ is refused by name (no '10⁻³.²⁹…e+²⁴')", () => {
    const o = run("qm-tunnelling", { particle: "typed", mass: "1 kg", width: "1 m" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/too opaque.*past 10¹⁵/);
    expect(o.text).not.toMatch(/\d[eE][+-]?\d|NaN|\^/);
    // Above the barrier the same barrier still answers; the rows past range are named in the table.
    const ab = run("qm-tunnelling", { particle: "typed", mass: "1 kg", width: "1 m", E: "2 eV" });
    expect(okText(ab)).not.toMatch(/\d[eE][+-]?\d|NaN/);
    expect(table(ab, /Transmission at a few energies/).find((r) => r[0] === "0.1")?.[2]).toBe("|log₁₀ T| past 10¹⁵");
  });

  test("#1 fromLog10: figures capped by |lg|, integer superscript exponent, ≈ when none survive", () => {
    expect(fromLog10(-134831769839.938981960421)).toBe("1.15×10⁻¹³⁴⁸³¹⁷⁶⁹⁸⁴⁰");
    expect(fromLog10(-329680562688607.9361796665)).toBe("≈10⁻³²⁹⁶⁸⁰⁵⁶²⁶⁸⁸⁶⁰⁸");
    expect(fromLog10(-3.3e24)).toMatch(/^below 10⁻1?[⁰¹]+$/);
    for (const lg of [-1e6 - 0.3, -1e9 - 0.7, -4.5e12, -9.99e14, 1e8 + 0.2]) expect(fromLog10(lg)).toMatch(/^≈?(\d(\.\d+)?×)?10⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/);
    expect(log10Figures(-134831769839.94)).toBe(3);
    expect(log10Figures(-3145.97)).toBeGreaterThanOrEqual(6);
  });

  test("#1 engine: wkbRatioLog10 equals log10T − wkbLog10 where that difference is well conditioned", () => {
    for (const [a, E] of [[1e-9, 0.5], [1e-9, 0.1], [3e-9, 0.9], [1e-8, 0.25]]) {
      const b = barrierT(M_E, EV, a, E * EV);
      if (isErr(b)) throw new Error(b.error);
      expect(Math.abs((b.wkbRatioLog10 as number) - (b.log10T - (b.wkbLog10 as number)))).toBeLessThan(1e-11);
    }
    const thick = barrierT(1e-20, EV, 1, 0.25 * EV);
    if (isErr(thick)) throw new Error(thick.error);
    expect(Math.abs(Math.pow(10, thick.wkbRatioLog10 as number) - 3)).toBeLessThan(1e-12);
  });

  // #2 finite-well binding energy from η.
  test.each([
    ["1e-20 eV, 1 nm (shallow)", "1e-20 eV", "1 nm", -6.5617105901879397e-40],
    ["1e-4 eV, 1 nm", "1e-4 eV", "1 nm", -6.555975553761673e-8],
    ["10 eV, 2 nm", "10 eV", "2 nm", -9.9166188031955036],
  ])("#2 finite well %s: E₁ − V₀ against mpmath", (_n, depth, width, want) => {
    const o = run("qm-particle-box", { well: "finite", depth, width });
    expect(rel(out(o, "bind1"), want)).toBeLessThan(1e-9);
  });

  test("#2 engine: every state's Ebind against mpmath, and E + Ebind = V₀", () => {
    const a = finiteWell(M_E, 10 * EV, 2e-9);
    if (isErr(a)) throw new Error(a.error);
    expect(rel(a.states[10].Ebind / EV, 0.36707793128199771)).toBeLessThan(1e-9);
    for (const s of a.states) expect(rel(s.E + s.Ebind, 10 * EV)).toBeLessThan(1e-12);
    const b = finiteWell(M_E, EV, 1e-9);
    if (isErr(b)) throw new Error(b.error);
    expect(rel(b.states[1].Ebind / EV, 0.29723042511911037)).toBeLessThan(1e-9);
    const s = finiteWell(M_E, 1e-20 * EV, 1e-9);
    if (isErr(s)) throw new Error(s.error);
    expect(rel(s.states[0].Ebind / EV, 6.5617105901879397e-40)).toBeLessThan(1e-9);
    const o = run("qm-particle-box", { well: "finite", depth: "1e-20 eV", width: "1 nm" });
    expect(okText(o)).toContain("(−6.56171×10⁻⁴⁰ eV relative to the rim)");
    expect(table(o, /Bound states/)[1][3]).toBe("−6.56171×10⁻⁴⁰");
  });

  // #3 levels captioned = levels drawn.
  test("#3 finite well 10 eV, 2 nm, 8 levels: 8 states drawn and labelled beside the V₀ rim", () => {
    const o = run("qm-particle-box", { well: "finite", depth: "10 eV", width: "2 nm", levels: "8" });
    const svg = svgOf(o);
    expect((svg.match(/>n = \d+</g) ?? []).length).toBe(8);
    expect(svg).toContain(">n = 8<");
    expect(svg).toContain(">V₀<");
    expect(captionOf(o)).toMatch(/^Finite square well: 8 of 11 bound states/);
  });

  // #4 meV is a unit.
  test("#4 meV accepted for every energy field; MeV is not folded into meV", () => {
    const base = run("qm-tunnelling", {});
    const mv = run("qm-tunnelling", { E: "500 meV" });
    expect(rel(out(mv, "T"), out(base, "T"))).toBeLessThan(1e-12);
    expect(okText(mv)).toContain("Particle energy E: 500 meV = ");
    expect(rel(out(run("qm-tunnelling", { V0: "1000 meV" }), "T"), out(base, "T"))).toBeLessThan(1e-12);
    const small = run("qm-tunnelling", { E: "5 meV" }), plain = run("qm-tunnelling", { E: "0.005 eV" });
    expect(rel(out(small, "T"), out(plain, "T"))).toBeLessThan(1e-12);
    const big = run("qm-tunnelling", { E: "5 MeV" });
    expect(rel(out(big, "T"), out(small, "T"))).toBeGreaterThan(0.5);
    const well = run("qm-particle-box", { well: "finite", depth: "300 meV", particle: "effective", width: "10 nm" });
    expect(rel(out(well, "E1"), 0.034208440483167346)).toBeLessThan(1e-9);
    for (const o of [base, mv, well]) expect(o.text).not.toMatch(/meV is not/);
  });

  // #6 e-notation in refusals.
  test.each([
    ["finite well past 1000 states", "qm-particle-box", { well: "finite", depth: "1e15 eV", width: "1 nm" }, /z₀ = 8\.100×10⁷/],
    ["evolution phase", "qm-two-level", { mode: "spin", B: "10 T", t: "1 s" }, /8\.80×10¹¹ rad is past the 1×10⁶ rad/],
  ])("#6 %s: the refusal writes ×10ⁿ, never e-notation", (_n, id, over, msg) => {
    const o = run(id, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
    expect(o.text).not.toMatch(/\d[eE][+-]?\d/);
  });

  test("#6 the dense-resonance caption writes a large count as ×10ⁿ", () => {
    const o = run("qm-tunnelling", { particle: "typed", mass: "1e-20 kg", width: "1 m" });
    expect(captionOf(o)).toContain("about 2.42×10¹⁴ in this window");
  });

  // Hydrogen level labels.
  test.each([
    ["default (3 → 2)", {}, "n = 5, 6"],
    ["20 → 2", { upper: "20", lower: "2", orbital: "4f" }, "n = 5–10"],
    ["8 → 1", { upper: "8", lower: "1" }, "n = 4–7"],
  ])("hydrogen diagram %s: the crowded levels carry a grouped label", (_n, over, lab) => {
    const svg = svgOf(run("qm-hydrogen", over as Record<string, string>), 0);
    expect(svg).toContain(`>${lab}<`);
  });
});
