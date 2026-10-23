// Release E, gap #5 (E3-b): laser physics + nonlinear optics. The FIXED CASE TABLE from the brief (oracle values from
// ~/jurislab-relE/oracle_e3.py, "--- laser") is pinned row by row first; reviewers add rows; every later fix round keeps
// every earlier row's outcome.
//
// Further oracle values come from the venv at C:\Users\AlexanderSmith\jurislab-oracle-venv (numpy 2, scipy), script
// recorded here (run with python -I):
//
//   import math, numpy as np
//   c = 299792458.0; h = 6.62607015e-34; eps0 = 8.8541878188e-12
//   def fp(L, n, R1, R2, lam):
//       fsr = c/(2*n*L); R = math.sqrt(R1*R2); F = math.pi*math.sqrt(R)/(1-R)
//       arg = (1-R)/(2*(R1*R2)**0.25); Fexact = (math.pi/2)/math.asin(arg) if arg < 1 else None
//       tRT = 2*n*L/c; tau = tRT/(-math.log(R1*R2)); nu = c/lam
//       return dict(fsr=fsr, F=F, lw=fsr/F, Fexact=Fexact, tau=tau, dnu_c=1/(2*math.pi*tau), Q=nu/(fsr/F),
//                   Fc=2*math.pi/(-math.log(R1*R2)), Tpk=(1-R1)*(1-R2)/(1-R)**2)
//   fp(0.1,1,0.99,0.99,1064e-9): Fexact 312.5832066819923, tau 3.318934810342095e-08, dnu_c 4795362.132330965,
//                                Q 58756489.15090772, Tpk 1
//   fp(0.1,1,0.99,0.95,1064e-9): F 102.42202815178497, lw 14635155.31813726, Fexact 102.4180127955863, Tpk 0.5479962693354081
//   fp(5e-3,1.5,0.9,0.9,1550e-9): fsr 19986163866.666668, F 29.803764797388308, Fexact 29.789955883029805, Q 288423.5302973062
//   threshold: am = 1/(2*0.1)*log(1/(0.99*0.95)); eta = am/(am+0.5)*808/1064; Pout(10 W, Pth 2 W) = eta*8 = 2.309815912256153
//              photon lifetime 1/(c(0.5+am)) = 4.1348281887521404e-09
//   diode: 0.8*(am/(am+500))*940/1030 with am = log(1/(0.3*0.95))/(2e-3)  ->  0.40636717905645936
//   coherence, independent FFT of the spectrum (|γ| = |IFFT(S)|, N = 2^22, span 400 FWHM, linear crossing):
//       Gaussian 1 MHz: 1/e at 158.89623 m, 1/2 at 132.28998 m (closed forms 158.89621654990705, 132.28977778413721)
//       Lorentzian 1 MHz: 1/e at 95.58 m (truncated tails; closed form 95.42690318473885), 1/2 at 66.14488889206861 closed
//   0.01 nm at 1550 nm -> dnu 1247835413.1113422 Hz, Gaussian 1/2 length 0.10601540587334911 m (= (2 ln2/π) λ²/Δλ)
//   Schawlow–Townes 2π h ν dnu_c²/P: λ 1064 nm, dnu_c 4795362.132330965, P 1 mW -> 0.026974772564786777 Hz;
//                                    dnu_c 1 MHz -> 0.0011730458104460438 Hz
//   SHG eta = 2 w² d² L² I/(n2w nw² c³ eps0) sinc²(dk L/2), w = 2πc/λ, λ 1064 nm, nw 2.1560, n2w 2.2340:
//       d 2 pm/V, L 10 mm, I 1e11 W/m², Δk 0 -> 0.10120835192527461 (above 10 %: refused as outside the model)
//       QPM d = (2/π)·14 pm/V, L 10 mm, I 1e9 -> 0.020098918022655836;  bulk d 14, L 10 mm, I 1e9 -> 5.764172626033349e-10
//   sinc² half point: brentq((sin x/x)² − 1/2, 1, 2) = 1.39155737825151
// (the app's ε₀ is lcRetarder.ts's CODATA 2018 8.8541878128×10⁻¹²: a 7×10⁻¹⁰ relative difference, inside every tolerance.)

import { LASER_CALCS } from "../laserCalcs";
import { coherence, coherenceDegree, fabryPerot, fpTransmission, laserThreshold, outputPower, schawlowTownes, shg, shgGrowth, sinc2, SINC2_HALF_X } from "../laserPhysics";
import type { AnalyzeOutput } from "../analyzeBlocks";
import { mathToOmml } from "../mathOmml";

const calc = (id: string) => {
  const c = LASER_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const e = (o.outputs ?? []).find((x) => x.key === key);
  if (!e) throw new Error(`no output ${key}: ${o.text}`);
  return e.value;
};
const has = (o: AnalyzeOutput, key: string): boolean => (o.outputs ?? []).some((x) => x.key === key);
const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1e-300, Math.abs(b)));

/** The display contract on every ok result: no e-notation, carets, NaN/Infinity/undefined, em dash or ASCII minus before a digit in prose. */
function displayClean(o: AnalyzeOutput): void {
  const t = o.text;
  expect(t).not.toMatch(/\d[eE][-+]?\d/);
  expect(t).not.toMatch(/\^/);
  expect(t).not.toMatch(/NaN|Infinity|undefined/);
  expect(t).not.toMatch(/\u2014/);
  expect(t).not.toMatch(/(^|[\s(,=[])-\d/m);
  for (const b of o.blocks ?? []) {
    if (b.kind === "plot") {
      expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(b.svg).not.toMatch(/>[^<]*\d[eE][-+]?\d[^<]*</);
      expect(b.svg).not.toMatch(/>[^<]*\^[^<]*</);
    }
  }
}
const ok = (o: AnalyzeOutput): AnalyzeOutput => {
  if (o.ok === false) throw new Error(`refused: ${o.text}`);
  displayClean(o);
  expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
  return o;
};
const refused = (o: AnalyzeOutput, re: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).toMatch(re);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
};

// ====================================================================== the fixed case table (brief)

describe("fixed case table (brief)", () => {
  test("L 0.1 m, n 1, R₁ = R₂ = 0.99 → FSR 1.49896229 GHz, finesse 312.585, linewidth 4.79538 MHz", () => {
    const o = ok(run("laser-fabry-perot", { L: "0.1 m", n: "1", R1: "0.99", R2: "0.99" }));
    near(out(o, "fsr"), 1.49896229e9, 1e-9);
    near(out(o, "finesse"), 312.585, 2e-6);
    near(out(o, "linewidth"), 4.79538e6, 2e-6);
  });
  test("α_i 0.5 /m, L 0.1 m, R₁ 0.99, R₂ 0.95 → g_th 0.806718 /m, α_m 0.306718 /m", () => {
    const o = ok(run("laser-threshold", { L: "0.1 m", ai: "0.5 1/m", R1: "0.99", R2: "0.95" }));
    near(out(o, "gth"), 0.806718, 2e-6);
    near(out(o, "alphaM"), 0.306718, 2e-6);
  });
  test("…with λ_p 808 nm, λ 1064 nm, η_i 1 → η_s 0.288727", () => {
    const o = ok(run("laser-threshold", { L: "0.1 m", ai: "0.5 1/m", R1: "0.99", R2: "0.95", lp: "808 nm", lam: "1064 nm", etai: "1" }));
    near(out(o, "etaS"), 0.288727, 2e-6);
  });
  test("Lorentzian Δν 1 MHz → L_c 95.4269 m", () => {
    const o = ok(run("laser-coherence", { shape: "lorentzian", dnu: "1 MHz" }));
    near(out(o, "Lcoh"), 95.4269, 1e-6);
  });
  test("SHG 1064 nm, n_ω 2.1560, n₂ω 2.2340 → Δk 9.21219×10⁵ m⁻¹, L_c 3.41026 µm, Λ_QPM 6.82051 µm", () => {
    const o = ok(run("laser-shg", { lam: "1064 nm", nw: "2.1560", n2w: "2.2340" }));
    near(out(o, "dk"), 9.21219e5, 1e-6);
    near(out(o, "lc"), 3.41026e-6, 2e-6);
    near(out(o, "period"), 6.82051e-6, 2e-6);
  });
});

// ====================================================================== further oracle rows

describe("Fabry–Pérot (oracle rows)", () => {
  test("equal mirrors: exact Airy finesse, photon lifetime, Lorentzian linewidth, Q at 1064 nm, peak T = 1", () => {
    const r = fabryPerot({ L: 0.1, n: 1, R1: 0.99, R2: 0.99, lambda: 1064e-9 });
    if (!r.ok) throw new Error(r.error);
    near(r.finesseExact as number, 312.5832066819923, 1e-9);
    near(r.tauC, 3.318934810342095e-8, 1e-9);
    near(r.dnuC, 4795362.132330965, 1e-9);
    near(r.Q as number, 58756489.15090772, 1e-9);
    near(r.peakT, 1, 1e-12);
  });
  test("unequal mirrors 0.99/0.95: finesse 102.422, linewidth 14.6352 MHz, peak T 0.547996 (below 1)", () => {
    const o = ok(run("laser-fabry-perot", { R2: "0.95" }));
    near(out(o, "finesse"), 102.42202815178497, 1e-9);
    near(out(o, "linewidth"), 14635155.31813726, 1e-9);
    near(out(o, "peakT"), 0.5479962693354081, 1e-9);
    near(out(o, "finesseExact"), 102.4180127955863, 1e-9);
    expect(o.text).toMatch(/unequal mirrors/);
  });
  test("glass etalon 5 mm, n 1.5, R 90 % (percent), 1.55 µm: FSR 19.9862 GHz, Q 288424", () => {
    const o = ok(run("laser-fabry-perot", { L: "5 mm", n: "1.5", R1: "90 %", R2: "90%", lam: "1.55 µm" }));
    near(out(o, "fsr"), 19986163866.666668, 1e-9);
    near(out(o, "finesse"), 29.803764797388308, 1e-9);
    near(out(o, "finesseExact"), 29.789955883029805, 1e-9);
    near(out(o, "Q"), 288423.5302973062, 1e-9);
  });
  test("Airy transmission is 1/2 at half the (approximate) linewidth from a resonance, to 5×10⁻⁶", () => {
    const r = fabryPerot({ L: 0.1, n: 1, R1: 0.99, R2: 0.99, lambda: null });
    if (!r.ok) throw new Error(r.error);
    near(fpTransmission(0.99, 0.99, r.fsr, r.linewidth / 2), 0.5000021043788757, 1e-9);
    near(fpTransmission(0.99, 0.99, r.fsr, r.fsr), 1, 1e-12);
  });
  test("low reflectivity: the exact Airy finesse has no half maximum (R₁R₂ ≤ 0.0294) and the result says so", () => {
    const o = ok(run("laser-fabry-perot", { R1: "0.15", R2: "0.15" }));
    expect(has(o, "finesseExact")).toBe(false);
    expect(o.text).toMatch(/no half maximum/);
  });
  test("moderate reflectivity: the approximate finesse differs from the exact by more than 1 % and the result says so", () => {
    const o = ok(run("laser-fabry-perot", { R1: "0.3", R2: "0.3" }));
    expect(o.text).toMatch(/use the exact value/);
  });
  test("no wavelength: no Q, still draws", () => {
    const o = ok(run("laser-fabry-perot", { lam: "" }));
    expect(has(o, "Q")).toBe(false);
  });
});

describe("threshold (oracle rows)", () => {
  test("default: output 2.30982 W at 10 W pump over a 2 W threshold; photon lifetime 4.13483 ns; output coupler share in the text", () => {
    const o = ok(run("laser-threshold"));
    near(out(o, "Pout"), 2.309815912256153, 1e-9);
    near(out(o, "tauP"), 4.1348281887521404e-9, 1e-9);
    expect(o.text).toMatch(/BOTH mirrors/);
    const r = laserThreshold({ L: 0.1, alphaI: 0.5, R1: 0.99, R2: 0.95, lambdaP: 808e-9, lambda: 1064e-9, etaI: 1, n: 1, Pth: 2, Pp: 10 });
    if (!r.ok) throw new Error(r.error);
    near(r.etaS, 0.2887269890320191, 1e-12);
  });
  test("a diode-like cavity in cm⁻¹ and mm with η_i in %: η_s 0.406367", () => {
    const o = ok(run("laser-threshold", { L: "1 mm", ai: "5 cm^-1", R1: "0.3", R2: "0.95", lp: "940 nm", lam: "1030 nm", etai: "80 %" }));
    near(out(o, "etaS"), 0.40636717905645936, 1e-9);
  });
  test("below threshold: zero output, never negative", () => {
    const o = ok(run("laser-threshold", { pp: "1 W" }));
    expect(out(o, "Pout")).toBe(0);
    expect(o.text).toMatch(/no laser output/);
    expect(outputPower(0.3, 1, 2)).toBe(0);
    expect(outputPower(0.3, 2, 2)).toBe(0);
  });
  test("no pump power: no output row, still draws", () => {
    const o = ok(run("laser-threshold", { pp: "" }));
    expect(has(o, "Pout")).toBe(false);
  });
  test("mW pump powers convert", () => {
    const o = ok(run("laser-threshold", { pth: "200 mW", pp: "1000 mW" }));
    near(out(o, "Pout"), 0.2887269890320191 * 0.8, 1e-9);
  });
});

describe("coherence (oracle rows)", () => {
  test("Gaussian 1 MHz: 1/2 at 132.290 m (quoted), 1/e at 158.896 m (FFT oracle agrees to 2×10⁻⁶)", () => {
    const o = ok(run("laser-coherence", { shape: "gaussian", dnu: "1 MHz" }));
    near(out(o, "Lcoh"), 132.28977778413721, 1e-9);
    near(out(o, "LHalf"), 132.28977778413721, 1e-9);
    near(out(o, "L1e"), 158.89621654990705, 1e-9);
    near(out(o, "L1e"), 158.89623116172064, 2e-6);
    near(out(o, "LHalf"), 132.28998271516147, 2e-6);
  });
  test("Lorentzian 1 MHz: 1/2 at 66.1449 m", () => {
    const o = ok(run("laser-coherence"));
    near(out(o, "LHalf"), 66.14488889206861, 1e-9);
  });
  test("|γ| really is 1/e and 1/2 at the reported delays", () => {
    for (const s of ["lorentzian", "gaussian"] as const) {
      const r = coherence(s, 3.7e9);
      if (!r.ok) throw new Error(r.error);
      near(coherenceDegree(s, 3.7e9, r.tau1e), Math.exp(-1), 1e-12);
      near(coherenceDegree(s, 3.7e9, r.tauHalf), 0.5, 1e-12);
    }
  });
  test("a wavelength linewidth: 0.01 nm at 1550 nm → Δν 1.24784 GHz, Gaussian 1/2 length 0.106015 m (the OCT form)", () => {
    const o = ok(run("laser-coherence", { shape: "gaussian", dnu: "0.01 nm", lam: "1550 nm" }));
    near(out(o, "dnu"), 1247835413.1113422, 1e-9);
    near(out(o, "Lcoh"), 0.10601540587334911, 1e-9);
  });
  test("Schawlow–Townes: Δν_c 4.79536 MHz, 1 mW, 1064 nm → 26.9748 mHz", () => {
    const o = ok(run("laser-coherence", { dnuc: "4795362.132330965", pout: "1 mW" }));
    near(out(o, "dnuST"), 0.026974772564786777, 1e-9);
    near(schawlowTownes(1064e-9, 1e6, 1e-3) as number, 0.0011730458104460438, 1e-9);
  });
  test("Schawlow–Townes is skipped when Δν_c is blank", () => {
    expect(has(ok(run("laser-coherence")), "dnuST")).toBe(false);
  });
});

describe("SHG (oracle rows)", () => {
  test("QPM, d_eff 14 pm/V, L 10 mm, 100 kW/cm²: η 0.0200989 with d_Q = (2/π)d_eff", () => {
    const o = ok(run("laser-shg", { mode: "qpm", deff: "14 pm/V", I: "100 kW/cm^2", L: "10 mm" }));
    near(out(o, "eta"), 0.020098918022655836, 1e-8);
    near(out(o, "sinc2"), 1, 1e-12);
  });
  test("bulk, no phase matching: η 5.76417×10⁻¹⁰", () => {
    const o = ok(run("laser-shg", { mode: "none", deff: "14 pm/V", I: "1e9", L: "10 mm" }));
    near(out(o, "eta"), 5.764172626033349e-10, 1e-6);
  });
  test("above 10 % the low-conversion formula is refused by name (not reported), the rest still computed", () => {
    const o = ok(run("laser-shg", { mode: "perfect", deff: "2 pm/V", I: "1e11", L: "10 mm" }));
    expect(has(o, "eta")).toBe(false);
    expect(o.text).toMatch(/NOT reported/);
    const r = shg({ lambda: 1064e-9, nW: 2.156, n2W: 2.234, L: 0.01, mode: "perfect", period: null, deff: 2e-12, I: 1e11 });
    if (!r.ok) throw new Error(r.error);
    near(r.eta as number, 0.10120835192527461, 1e-8);
  });
  test("acceptance: the sinc² FWHM in Δk is 4×1.39156/L", () => {
    const o = ok(run("laser-shg", { L: "10 mm" }));
    near(out(o, "dkFwhm"), (4 * 1.39155737825151) / 0.01, 1e-12);
    near(sinc2(SINC2_HALF_X), 0.5, 1e-12);
  });
  test("a given QPM period off the ideal: residual mismatch and sinc² < 1", () => {
    const o = ok(run("laser-shg", { per: "6.9 µm", L: "1 mm" }));
    const dkRes = 921218.8984210653 - (2 * Math.PI) / 6.9e-6;
    near(out(o, "sinc2"), (Math.sin((dkRes * 1e-3) / 2) / ((dkRes * 1e-3) / 2)) ** 2, 1e-9);
  });
  test("n₂ω < n_ω: Δk negative, magnitudes used for ℓ_c and Λ", () => {
    const o = ok(run("laser-shg", { nw: "2.2340", n2w: "2.1560" }));
    near(out(o, "dk"), -921218.8984210653, 1e-9);
    near(out(o, "lc"), 3.410256410256417e-6, 1e-9);
  });
  test("n₂ω = n_ω: Δk 0, coherence length unbounded (named, never ∞), no QPM needed, still draws without a length", () => {
    const o = ok(run("laser-shg", { nw: "2.2", n2w: "2.2", mode: "perfect", L: "" }));
    expect(out(o, "dk")).toBe(0);
    expect(has(o, "lc")).toBe(false);
    expect(o.text).toMatch(/unbounded/);
    expect(o.text).not.toMatch(/∞/);
    refused(run("laser-shg", { nw: "2.2", n2w: "2.2", mode: "qpm" }), /already phase-matched/);
  });
  test("SH growth: matched z²/ℓ_c², not matched peaks at 4/π² at ℓ_c, first-order QPM at 2ℓ_c is 16/π²", () => {
    const g = shgGrowth(Math.PI, 2, 3); // ℓ_c = 1; samples at z = 0, 1, 2
    near(g[1].perfect, 1, 1e-12);
    near(g[1].none, 4 / Math.PI ** 2, 1e-12);
    expect(Math.abs(g[2].none)).toBeLessThan(1e-12);
    near(g[2].qpm, 16 / Math.PI ** 2, 1e-12);
  });
});

// ====================================================================== refusals and adversarial input

describe("named refusals", () => {
  test.each([
    ["laser-fabry-perot", { R1: "99" }, /above 1/],
    ["laser-fabry-perot", { R1: "1" }, /strictly between 0 and 1/],
    ["laser-fabry-perot", { R2: "0" }, /strictly between 0 and 1/],
    ["laser-fabry-perot", { R1: "-0.5" }, /strictly between 0 and 1/],
    ["laser-fabry-perot", { L: "0 m" }, /greater than zero/],
    ["laser-fabry-perot", { L: "5 kg" }, /Mirror spacing: .*not compatible/],
    ["laser-fabry-perot", { L: "" }, /Mirror spacing: this field is required/],
    ["laser-fabry-perot", { n: "0.5" }, /from 1 to 10/],
    ["laser-fabry-perot", { n: "abc" }, /not a number/],
    ["laser-fabry-perot", { lam: "5 W" }, /Wavelength: /],
    ["laser-threshold", { R1: "1", R2: "1" }, /nothing leaves the cavity/],
    ["laser-threshold", { lp: "1200 nm" }, /pump wavelength is longer/],
    ["laser-threshold", { etai: "1.5" }, /above 1/],
    ["laser-threshold", { etai: "0" }, /η/],
    ["laser-threshold", { ai: "-1 1/m" }, /cannot be negative/],
    ["laser-threshold", { ai: "5 kg" }, /Internal loss: /],
    ["laser-threshold", { pth: "0 W" }, /threshold pump power must be greater than zero/],
    ["laser-threshold", { pp: "-3 W" }, /cannot be negative/],
    ["laser-threshold", { pth: "" }, /required/],
    ["laser-coherence", { dnu: "0 Hz" }, /greater than zero/],
    ["laser-coherence", { dnu: "" }, /required/],
    ["laser-coherence", { dnu: "5 kg" }, /Linewidth: give a frequency/],
    ["laser-coherence", { dnu: "200 nm", lam: "1064 nm" }, /not a narrow line/],
    ["laser-coherence", { dnu: "0.1 nm", lam: "" }, /needs the centre wavelength/],
    ["laser-coherence", { dnuc: "1 MHz", lam: "" }, /needs the laser wavelength/],
    ["laser-coherence", { dnuc: "1 MHz", pout: "" }, /required/],
    ["laser-coherence", { dnuc: "1 MHz", pout: "0 W" }, /greater than zero/],
    ["laser-shg", { lam: "0 nm" }, /greater than zero/],
    ["laser-shg", { nw: "0.5" }, /from 1 to 10/],
    ["laser-shg", { nw: "" }, /not a number/],
    ["laser-shg", { deff: "14 pm/V" }, /needs all three/],
    ["laser-shg", { I: "1e9", L: "" }, /needs all three/],
    ["laser-shg", { deff: "14 pm/V", I: "1e9", L: "" }, /needs all three/],
    ["laser-shg", { per: "-5 µm" }, /period must be greater than zero/],
    ["laser-shg", { deff: "14 kg", I: "1e9" }, /d\(eff\): /],
    ["laser-shg", { L: "1e400 mm" }, /finite|not a/],
  ] as Array<[string, Record<string, string>, RegExp]>)("%s %j", (id, over, re) => refused(run(id, over), re));
});

describe("unit layer", () => {
  test.each([
    ["5 cm^-1", 500],
    ["5 cm⁻¹", 500],
    ["0.5 m^-1", 0.5],
    ["0.5 1/m", 0.5],
    ["0.5", 0.5],
    ["0.5 /m", 0.5],
    ["5 /cm", 500],
  ])("internal loss %s is %d m⁻¹ (the brief's α_m and g_th follow)", (ai, perM) => {
    const o = ok(run("laser-threshold", { ai }));
    near(out(o, "gth") - out(o, "alphaM"), perM, 1e-12);
  });
  test("a glued slash stays refused (\"0.5/m\" could be 0.5 per metre or a fraction)", () => {
    expect(run("laser-threshold", { ai: "0.5/m" }).ok).toBe(false);
  });
  test("wavelengths in µm, spacing in cm, linewidth in GHz all convert; bare numbers read in the labelled unit", () => {
    const a = ok(run("laser-fabry-perot", { L: "10 cm", lam: "1.064 µm" }));
    const b = ok(run("laser-fabry-perot", { L: "0.1", lam: "1064" }));
    near(out(a, "fsr"), out(b, "fsr"), 1e-12);
    near(out(a, "Q"), out(b, "Q"), 1e-12);
    expect(a.text).toMatch(/Units read: Mirror spacing: 10 cm = 0\.1 m/);
    near(out(ok(run("laser-coherence", { dnu: "0.001 GHz" })), "Lcoh"), 95.42690318473885, 1e-9);
    near(out(ok(run("laser-coherence", { dnu: "1000000" })), "Lcoh"), 95.42690318473885, 1e-9);
  });
  test("long lengths stop at km (never Mm or Gm, which read as millimetres); times stop at s", () => {
    const o = ok(run("laser-coherence", { dnu: "1 Hz", dnuc: "1 MHz" }));
    expect(o.text).not.toMatch(/\d (Mm|Gm|Tm|ks|Ms)\b/);
    expect(o.text).toMatch(/coherence length 95426\.9 km/);
    for (const b of o.blocks ?? []) if (b.kind === "plot") expect(b.svg).not.toMatch(/\((Mm|Gm|Tm)\)/);
  });
  test("huge and tiny magnitudes stay finite and display-clean", () => {
    ok(run("laser-fabry-perot", { L: "1 µm", R1: "0.999999", R2: "0.999999" }));
    ok(run("laser-fabry-perot", { L: "4 km", R1: "0.5", R2: "0.5" }));
    ok(run("laser-coherence", { dnu: "0.001 Hz" }));
    ok(run("laser-coherence", { dnu: "100 THz", shape: "gaussian" }));
    ok(run("laser-shg", { nw: "2.2", n2w: "2.2000001", L: "50 mm" }));
  });
});

describe("every formula typesets as a Word equation (no silent fallback to text)", () => {
  const variants: Array<[string, Record<string, string>]> = [
    ["laser-fabry-perot", {}],
    ["laser-threshold", {}],
    ["laser-coherence", {}],
    ["laser-coherence", { shape: "gaussian", dnu: "0.01 nm", dnuc: "1 MHz" }],
    ["laser-shg", { mode: "qpm", deff: "14 pm/V", I: "1e9" }],
  ];
  test.each(variants)("%s %j", (id, over) => {
    const o = run(id, over);
    const maths = (o.blocks ?? []).filter((b) => b.kind === "math");
    expect(maths.length).toBeGreaterThan(0);
    for (const b of maths) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
  });
});

describe("every dropdown option computes and draws (one option at a time, the rest at defaults)", () => {
  const rows: Array<[string, string, string]> = [];
  for (const c of LASER_CALCS) for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) rows.push([c.id, f.key, o.value]);
  test.each(rows)("%s %s = %s", (id, key, value) => {
    ok(run(id, { [key]: value }));
  });
  test("every calculator declares the converts contract, a group and named outputs; tables have headers", () => {
    for (const c of LASER_CALCS) {
      expect(c.unitContract).toBe("converts");
      expect(c.group).toBe("Optics & photonics");
      const o = ok(run(c.id));
      expect((o.outputs ?? []).length).toBeGreaterThan(0);
      for (const e of o.outputs ?? []) expect(Number.isFinite(e.value)).toBe(true);
      expect((o.blocks ?? []).some((b) => b.kind === "table")).toBe(true);
    }
  });
});

describe("work is bounded", () => {
  test("SH growth caps its points and segments", () => {
    expect(shgGrowth(1e6, 1, 1e9).length).toBe(2001);
    expect(shgGrowth(NaN, 1).length).toBe(0);
    expect(shgGrowth(1, Infinity).length).toBe(0);
  });
});
