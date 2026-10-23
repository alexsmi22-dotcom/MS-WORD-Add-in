// Release Q part Q5 — space and lunar quantum links: the FIXED CASE TABLE (cumulative gate: every later fix round
// keeps every row's outcome) plus adversarial input.
//
// Oracle for the brief's rows: ~/jurislab-relE/oracle_quantum2.py (Q5). Further reference values from the oracle venv
// (C:\Users\AlexanderSmith\jurislab-oracle-venv, numpy/scipy), script recorded here:
//
//   import math
//   from scipy.special import j0, j1
//   from scipy.optimize import brentq
//   def H(x): return 0 if x<=0 or x>=1 else -x*math.log2(x)-(1-x)*math.log2(1-x)
//   for x in (0.1,1.1637,4,50,1500,3000): print(1-j0(x)**2-j1(x)**2)          # Airy encircled energy
//   x=math.pi*0.3*1.0/(2*810e-9*1e5); print(1-j0(x)**2-j1(x)**2, (x/2)**2)  # 100 km: 0.8954391, 8.461595
//   x=math.pi*0.3*1.0/(2*810e-9*5e5); print(1-j0(x)**2-j1(x)**2)           # LEO: 0.28626376
//   def single(loss,y0=1.7e-6,ed=0.033,det=0.045,rate=1e7):
//       eta=10**(-loss/10)*det; Y1=y0+eta-y0*eta; e1=(0.5*y0+ed*eta)/Y1
//       return rate*0.5*Y1*max(0,1-2*H(e1)), e1, Y1                       # 20 dB: 1275.0712, 0.0347576
//   brentq(lambda l: 1-2*H(single(l)[1]), 20, 60)                          # 37.183768 dB
//   def decoy(loss,mu,f,y0=1.7e-6,ed=0.033,det=0.045,rate=1e7):           # Ma, Qi, Zhao, Lo PRA 72 012326 Eqs 1,7-11
//       eta=10**(-loss/10)*det; Qmu=y0+1-math.exp(-eta*mu); Emu=(0.5*y0+ed*(1-math.exp(-eta*mu)))/Qmu
//       Y1=y0+eta-y0*eta; e1=(0.5*y0+ed*eta)/Y1; Q1=Y1*mu*math.exp(-mu)
//       return rate*0.5*(-Qmu*f*H(Emu)+Q1*(1-H(e1)))                       # 20 dB, mu .48, f 1.22: 223.74131
//   mu12=brentq(lambda m:(1-m)*math.exp(-m)-1.22*H(0.033)/(1-H(0.033)),0,1) # Ma Eq. 12: 0.4789227491
//   brentq(lambda l: decoy(l,mu12,1.22),10,60)                             # 29.824620 dB = 142.0220 km at 0.21 dB/km
//
// The paper's own figure for that cutoff is 142.05 km (Fig. 2 caption) = 29.8305 dB; this model gives 142.022 km, a
// 0.03 km (0.006 dB) residual, recorded rather than tuned away.

import { QUANTUM_LINKS_CALCS } from "../quantumLinksCalcs";
import { RANGE_PRESETS, airyEncircled, entanglement, fsoLink, qkdLink, type FsoInput, type QkdInput } from "../quantumLinks";
import { bb84KeyRate } from "../quantum";

type Out = ReturnType<(typeof QUANTUM_LINKS_CALCS)[number]["compute"]>;

function run(id: string, over: Record<string, string> = {}): Out {
  const c = QUANTUM_LINKS_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: Out, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key}: ${o.text}`);
  return v.value;
};
const rel = (a: number, b: number): number => Math.abs(a / b - 1);

/** Display contract on an ok result. */
function expectClean(o: Out): void {
  expect(o.ok).not.toBe(false);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined|\u2014/);
  expect(o.text).not.toMatch(/\d[eE][+-]?\d/);
  expect(o.text).not.toMatch(/\^/);
  for (const b of o.blocks ?? []) if (b.kind === "plot") expect(b.svg).not.toMatch(/NaN|Infinity|\d[eE][+-]?\d+(?![\w])[^"]*<\/text>/);
}

const FSO: FsoInput = { lambda: 1550e-9, dt: 0.3, dr: 1.0, rangeM: 3.844e8, pointingDb: 0, atmosDb: 0, opticsDb: 0, detEff: 1, emitRate: null };

describe("Q5 case table (brief rows)", () => {
  test("Earth–Moon, 1550 nm, D_t 0.3 m, D_r 1.0 m → η_geo 1.56384×10⁻⁷ (−68.058 dB)", () => {
    const o = run("qlink-fso", { preset: "moon", lambda: "1550 nm", dt: "0.3 m", dr: "1.0 m" });
    expectClean(o);
    expect(rel(out(o, "etaGeo"), 1.56384e-7)).toBeLessThan(1e-5);
    expect(out(o, "geoDb")).toBeCloseTo(68.058, 3);
    expect(o.text).toContain("1.56384×10⁻⁷");
    expect(o.text).toContain("−68.058 dB");
  });
  test("Same, 810 nm → η_geo 5.72645×10⁻⁷ (−62.421 dB)", () => {
    const o = run("qlink-fso", { preset: "moon", lambda: "810 nm" });
    expectClean(o);
    expect(rel(out(o, "etaGeo"), 5.72645e-7)).toBeLessThan(1e-5);
    expect(out(o, "geoDb")).toBeCloseTo(62.421, 3);
  });
  test("One-way light time Earth–Moon → 1.28222 s", () => {
    const o = run("qlink-fso", { preset: "moon" });
    expect(out(o, "lightTime")).toBeCloseTo(1.28222, 5);
    expect(o.text).toContain("L/c = 1.28222 s");
  });
  // Integrator decision 2026-10-23: η_geo is the exact Airy encircled energy; the brief's original row pinned the
  // far-field approximation 0.338464 (−4.705 dB), which is now reported beside it as the approximation.
  test("LEO 500 km, 810 nm, 0.3 m / 1.0 m → η_geo 0.286264 exact (−5.432 dB); approximation 0.338464 shown, 18.23 % above", () => {
    const o = run("qlink-fso", { preset: "leo", lambda: "810 nm" });
    expectClean(o);
    expect(rel(out(o, "etaGeo"), 0.28626376450724345)).toBeLessThan(1e-9);
    expect(out(o, "geoDb")).toBeCloseTo(5.43233621836956, 9);
    expect(rel(out(o, "etaApprox"), 0.338464)).toBeLessThan(1e-5);
    expect(o.text).toContain("Far-field approximation (π D_t D_r /(4 λ L))² = 0.338464 (−4.705 dB), 18.23 % above the exact value");
  });
  test("R 10⁸/s, η_a 10⁻³, η_b 10⁻⁴, detectors 0.6, τ 1 ns → C 3.6/s, singles 6×10⁴ and 6×10³/s, A 0.36/s", () => {
    const o = run("qlink-entanglement", { preset: "custom", rate: "1e8 /s", etaA: "1e-3", etaB: "1e-4", detA: "0.6", detB: "0.6", tau: "1 ns" });
    expectClean(o);
    expect(out(o, "coinc")).toBeCloseTo(3.6, 10);
    expect(out(o, "singlesA")).toBeCloseTo(6e4, 6);
    expect(out(o, "singlesB")).toBeCloseTo(6e3, 6);
    expect(out(o, "acc")).toBeCloseTo(0.36, 10);
  });
  test.each([
    ["range 0", { preset: "custom", range: "0 m" }, /range must be greater than zero/],
    ["range negative", { preset: "custom", range: "-5 km" }, /range must be greater than zero/],
    ["λ = 0", { lambda: "0 nm" }, /wavelength must be greater than zero/],
    ["λ negative", { lambda: "-810 nm" }, /wavelength must be greater than zero/],
  ])("named refusal: %s", (_n, over, msg) => {
    const o = run("qlink-fso", over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(msg);
  });
});

describe("Q5 case table (builder rows)", () => {
  test("aperture-limited: 100 km at 810 nm → exact η_geo 0.895439 (approximation 8.4616 > 1 flagged), Fraunhofer note", () => {
    const o = run("qlink-fso", { preset: "custom", range: "100 km", lambda: "810 nm" });
    expectClean(o);
    expect(out(o, "etaGeo")).toBeCloseTo(0.8954391035837238, 9);
    expect(out(o, "etaApprox")).toBeCloseTo(8.461594994075238, 9);
    expect(o.text).toContain("would give 8.462 (above 1,");
    expect(o.text).toMatch(/Fraunhofer distance 2D_t²\/λ = 222\.2 km/);
  });
  test("LEO: the exact value drives the total, photons and loss", () => {
    const o = run("qlink-fso", { preset: "leo", lambda: "810 nm", emit: "1e9 /s" });
    expect(out(o, "eta")).toBeCloseTo(0.28626376450724345, 12);
    expect(rel(out(o, "photonsRx"), 2.8626376450724345e8)).toBeLessThan(1e-12);
    expect(out(o, "lossDb")).toBeCloseTo(5.43233621836956, 9);
  });
  test("Earth–Moon: no approximation line (the two agree to 10⁻⁶)", () => {
    const o = run("qlink-fso", { preset: "moon" });
    expect(o.text).not.toContain("Far-field approximation (π");
    expect(rel(out(o, "etaApprox"), out(o, "etaGeo"))).toBeLessThan(1e-6);
  });
  test("extra losses and photon rate: 3 + 2 + 1 dB, detector 50 %, 10⁹/s emitted", () => {
    const o = run("qlink-fso", { preset: "moon", point: "3", atm: "2 dB", opt: "1", det: "50 %", emit: "1e9 /s" });
    expectClean(o);
    const eta = out(o, "etaGeo") * Math.pow(10, -0.6) * 0.5;
    expect(rel(out(o, "eta"), eta)).toBeLessThan(1e-12);
    expect(rel(out(o, "photonsRx"), 1e9 * eta)).toBeLessThan(1e-12);
  });
  test("visibility from accidentals: CAR 10 → V = 10/11, S = 2.5713 (Werner via quantum.ts)", () => {
    const o = run("qlink-entanglement");
    expect(out(o, "car")).toBeCloseTo(10, 10);
    expect(out(o, "visibility")).toBeCloseTo(10 / 11, 12);
    expect(out(o, "chsh")).toBeCloseTo(2.5712973861329007, 12);
    expect(o.text).toMatch(/above the local bound 2/);
  });
  test("CHSH threshold at CAR = 1 + √2: CAR 2 fails, CAR 3 passes", () => {
    const base = { pairRate: 1e8, etaA: 1e-3, etaB: 1e-4, detA: 0.6, detB: 0.6, darkA: 0, darkB: 0, jitter: null };
    const two = entanglement({ ...base, tau: 1 / (2 * 1e8) });
    const three = entanglement({ ...base, tau: 1 / (3 * 1e8) });
    if (!two.ok || !three.ok) throw new Error("refused");
    expect(two.car).toBeCloseTo(2, 10);
    expect(two.violatesChsh).toBe(false);
    expect(three.violatesChsh).toBe(true);
  });
  test("accidentals underflow (R 10⁻¹⁶⁰ /s) → named refusal, no Infinity", () => {
    const o = run("qlink-entanglement", { rate: "1e-160 /s", etaA: "1", etaB: "1" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/underflows double precision/);
  });
  test("saturated window (S·τ > 0.1) → named refusal", () => {
    const o = run("qlink-entanglement", { tau: "10 µs" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/counts per window/);
  });
  test("jitter 300 ps: 90.44 % of pairs inside a 1 ns window (erf(1/(2√2·0.3)))", () => {
    const o = run("qlink-entanglement", { jitter: "300 ps" });
    expect(out(o, "coinc") / 3.6).toBeCloseTo(0.904419, 5);
  });
  test("Earth–Moon preset arms: η = 5.72645×10⁻⁷ each, C = 10⁸·(η·0.6)²", () => {
    const o = run("qlink-entanglement", { preset: "moon" });
    expectClean(o);
    expect(rel(out(o, "etaA"), 5.72645e-7)).toBeLessThan(1e-5);
    expect(rel(out(o, "etaA"), 5.726448405009137e-7)).toBeLessThan(1e-9); // exact Airy (scipy)
    expect(rel(out(o, "coinc"), 1e8 * Math.pow(out(o, "etaA") * 0.6, 2))).toBeLessThan(1e-12);
  });
  test("transmission in dB: −30 dB = 10⁻³; +30 dB refused by name", () => {
    expect(out(run("qlink-entanglement", { etaA: "-30 dB" }), "etaA")).toBeCloseTo(1e-3, 15);
    const o = run("qlink-entanglement", { etaA: "30 dB" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/zero or negative/);
  });
  test("BB84 single photon, GYS defaults at 20 dB → 1275.07 bit/s, QBER 3.4758 %, cutoff 37.1838 dB", () => {
    const o = run("qlink-qkd");
    expectClean(o);
    expect(out(o, "keyRate")).toBeCloseTo(1275.0712434017182, 6);
    expect(out(o, "qber")).toBeCloseTo(0.03475764133184773, 12);
    expect(out(o, "cutoff")).toBeCloseTo(37.18376818451642, 6);
  });
  test("single-photon secret fraction IS quantum.ts bb84KeyRate", () => {
    const r = qkdLink({ rate: 1e7, lossDb: 20, detEff: 0.045, y0: 1.7e-6, ed: 0.033, source: "single", mu: null, f: 1.22 });
    if (!r.ok) throw new Error(r.error);
    expect(r.fraction).toBe((bb84KeyRate(r.qber) as NonNullable<ReturnType<typeof bb84KeyRate>>).keyRate);
  });
  test("decoy, μ 0.48, f 1.22, GYS at 20 dB → 223.741 bit/s", () => {
    const o = run("qlink-qkd", { source: "decoy" });
    expectClean(o);
    expect(out(o, "keyRate")).toBeCloseTo(223.741311732445, 6);
  });
  test("decoy GYS cutoff with Ma Eq. 12 μ = 0.47892 → 29.82462 dB (paper: 142.05 km × 0.21 = 29.8305 dB, within 0.01 dB)", () => {
    const o = run("qlink-qkd", { source: "decoy", mu: "0.4789227491279087" });
    expect(out(o, "cutoff")).toBeCloseTo(29.824620134382236, 6);
    expect(Math.abs(out(o, "cutoff") - 0.21 * 142.05)).toBeLessThan(0.01);
  });
  test("decoy with μ blank: optimised μ beats the typed 0.48 at the operating loss", () => {
    const o = run("qlink-qkd", { source: "decoy", mu: "" });
    expect(o.text).toMatch(/optimised at this loss/);
    expect(out(o, "keyRate")).toBeGreaterThanOrEqual(223.741311732445);
  });
  test("e_det ≥ threshold (12 %) → named refusal: no key at any loss", () => {
    const o = run("qlink-qkd", { ed: "12 %" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/no secret key can be distilled at any loss/);
  });
  test("Q*(1 − Y₀) ≤ e_det < Q* (10.9 %, Y₀ 0.01) → no key at any loss, clean (was NaN dB)", () => {
    const o = run("qlink-qkd", { ed: "10.9 %", y0: "0.01" });
    expectClean(o);
    expect(o.text).toMatch(/No secret key at any channel loss/);
    expect(out(o, "keyRate")).toBe(0);
    expect(o.outputs?.some((x) => x.key === "cutoff")).toBe(false);
  });
  test("Y₀ = 0 → no cutoff, stated", () => {
    const o = run("qlink-qkd", { y0: "0" });
    expectClean(o);
    expect(o.text).toMatch(/No zero-key cutoff/);
    expect(o.outputs?.some((x) => x.key === "cutoff")).toBe(false);
  });
  test("'5 kg' in the range field → refused (wrong quantity)", () => {
    const o = run("qlink-fso", { preset: "custom", range: "5 kg" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/Range: .*kg/);
  });
});

describe("Q5 presets and helpers", () => {
  test("preset values as cited", () => {
    expect(RANGE_PRESETS.map((p) => [p.id, p.m])).toEqual([["leo", 500e3], ["geo", 35786e3], ["moon", 3.844e8]]);
    // Kepler cross-check of the GEO altitude: (GM T²/4π²)^⅓ − 6 378.137 km.
    const r = Math.cbrt((3.986004418e14 * 86164.0905 ** 2) / (4 * Math.PI ** 2));
    expect(Math.abs(r - 6378137 - 35786e3)).toBeLessThan(100);
  });
  test.each([
    [0.005, 6.249980468905729e-6],
    [0.0099, 2.450219981612223e-5],
    [0.0101, 2.5502174813730705e-5],
    [0.02, 9.999500013907877e-5],
    [0.1, 0.0024968771691897492],
    [1.1637, 0.2863241843313366],
    [4, 0.8379103073486839],
    [50, 0.9873764274558263],
    [1500, 0.999575448769233],
    [3000, 0.9997878253743319],
  ])("Airy encircled energy at x = %p matches scipy", (x, v) => {
    expect(Math.abs(airyEncircled(x) - v)).toBeLessThan(1e-9);
    expect(rel(airyEncircled(x), v)).toBeLessThan(1e-8);
  });
  test("Airy at x = 10⁻⁶ (1 AU scale) keeps full relative precision: x²/4 − x⁴/32", () => {
    expect(rel(airyEncircled(1e-6), 2.5e-13 - 1e-24 / 32)).toBeLessThan(1e-14);
  });
});

describe("Q5 adversarial", () => {
  test.each([
    ["non-finite wavelength", "qlink-fso", { lambda: "1e999 nm" }],
    ["empty wavelength", "qlink-fso", { lambda: "" }],
    ["unit typo", "qlink-fso", { lambda: "1550 nmm" }],
    ["wrong quantity aperture", "qlink-fso", { dt: "3 s" }],
    ["negative loss", "qlink-fso", { point: "-3" }],
    ["detector 60 (not %)", "qlink-fso", { det: "60" }],
    ["aperture below 10 λ", "qlink-fso", { dt: "5 µm" }],
    ["radio wavelength", "qlink-fso", { lambda: "3 cm" }],
    ["huge range", "qlink-fso", { preset: "custom", range: "1e20 m" }],
    ["text in dB", "qlink-fso", { atm: "lots" }],
    ["pair rate 0", "qlink-entanglement", { rate: "0 /s" }],
    ["pair rate in metres", "qlink-entanglement", { rate: "5 m" }],
    ["η above 1", "qlink-entanglement", { etaA: "1.5" }],
    ["η zero", "qlink-entanglement", { etaA: "0" }],
    ["τ zero", "qlink-entanglement", { tau: "0 s" }],
    ["τ in kg", "qlink-entanglement", { tau: "5 kg" }],
    ["negative dark", "qlink-entanglement", { darkA: "-1 /s" }],
    ["negative jitter", "qlink-entanglement", { jitter: "-1 ns" }],
    ["preset extra loss negative", "qlink-entanglement", { preset: "moon", extra: "-3" }],
    ["rate 0", "qlink-qkd", { rate: "0 Hz" }],
    ["loss negative", "qlink-qkd", { loss: "-5" }],
    ["loss 500 dB", "qlink-qkd", { loss: "500" }],
    ["Y₀ 0.5", "qlink-qkd", { y0: "0.5" }],
    ["e_det 50 %", "qlink-qkd", { ed: "50 %" }],
    ["μ 5", "qlink-qkd", { source: "decoy", mu: "5" }],
    ["μ negative", "qlink-qkd", { source: "decoy", mu: "-0.5" }],
    ["f below 1", "qlink-qkd", { source: "decoy", f: "0.9" }],
    ["f text", "qlink-qkd", { f: "abc" }],
  ])("refused: %s", (_n, id, over) => {
    const o = run(id, over as Record<string, string>);
    expect(o.ok).toBe(false);
    expect(o.text.length).toBeGreaterThan(10);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
  });

  test.each([
    ["tiny range 1 km (deep near field)", "qlink-fso", { preset: "custom", range: "1 km" }],
    ["GEO 1550 nm", "qlink-fso", { preset: "geo" }],
    ["1 AU", "qlink-fso", { preset: "custom", range: "1.496e11 m" }],
    ["huge apertures", "qlink-fso", { preset: "leo", dt: "10 m", dr: "40 m" }],
    ["entanglement with darks and jitter", "qlink-entanglement", { darkA: "1000", darkB: "1000", jitter: "1 ns" }],
    ["LEO preset with 30 dB extra", "qlink-entanglement", { preset: "leo", extra: "30" }],
    ["QKD at 0 dB", "qlink-qkd", { loss: "0" }],
    ["QKD past the cutoff", "qlink-qkd", { loss: "45" }],
    ["decoy past the cutoff", "qlink-qkd", { source: "decoy", loss: "35" }],
    ["decoy at 0 loss, f 1", "qlink-qkd", { source: "decoy", loss: "0", f: "1" }],
  ])("clean ok result: %s", (_n, id, over) => {
    const o = run(id, over as Record<string, string>);
    expectClean(o);
    expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
    for (const v of o.outputs ?? []) expect(Number.isFinite(v.value)).toBe(true);
  });

  test("past the cutoff the key rate is exactly 0 and says so", () => {
    const o = run("qlink-qkd", { loss: "45" });
    expect(out(o, "keyRate")).toBe(0);
    expect(o.text).toMatch(/Secret key rate: 0 bit\/s/);
  });

  test("engine refusals are sentences, never thrown", () => {
    expect(fsoLink({ ...FSO, lambda: NaN }).ok).toBe(false);
    expect(fsoLink({ ...FSO, rangeM: Infinity }).ok).toBe(false);
    const q: QkdInput = { rate: 1e7, lossDb: 20, detEff: 0.045, y0: 1.7e-6, ed: 0.033, source: "decoy", mu: null, f: 1.22 };
    expect(qkdLink({ ...q, detEff: 0 }).ok).toBe(false);
    expect(qkdLink({ ...q, rate: NaN }).ok).toBe(false);
  });

  test("every tool declares the converts contract, has a figure and group Quantum optics", () => {
    for (const c of QUANTUM_LINKS_CALCS) {
      expect(c.unitContract).toBe("converts");
      expect(c.group).toBe("Quantum optics");
      const o = run(c.id);
      expect(o.blocks?.some((b) => b.kind === "plot")).toBe(true);
      expect(o.blocks?.some((b) => b.kind === "table")).toBe(true);
      expect(o.blocks?.some((b) => b.kind === "math")).toBe(true);
    }
  });
});
