// FIXED CASE TABLE for the liquid-crystal retarder tools (lcRetarder.ts engine, lcCalcs.ts calculators,
// lcCharts.ts figures, lcDrawings.ts drawings). Illustrative numbers only. Every later fix round keeps every row.
//
// EXTERNAL ORACLES (statvenv python, numpy/scipy):
//
// (a) closed forms, closed_oracle.py:
//   import numpy as np
//   ne, no = 1.7, 1.5
//   2*np.pi*0.2*5/0.55                                   # case 1: 11.423973285781065
//   t = np.radians(45); neff = ne*no/np.sqrt(ne**2*np.sin(t)**2 + no**2*np.cos(t)**2)
//   neff - no                                             # case 2: 0.09064629695710336
//   def n(A, B, C, lam_nm): l = lam_nm/1000; return A + B/l**2 + C/l**4
//   # case 6: ne (1.68, 0.0095, 0.0030), no (1.50, 0.0068, 0.0004), d = 8 µm, tilt 20°
//   #   λ 450 → 24.569211889607914; 632.8 → 13.896540355812443; 1064 → 7.525150417791315
//   np.pi*np.sqrt(11e-12/(8.8541878128e-12*13))           # case 9: 0.9711809928825544 V
//   1.6985 + 8956.69/589.3**2 + 2.69175e9/589.3**4         # E7 nₑ(589.3 nm) in the report's nm units: 1.7466111158543394
//   1.49949 + 6830.58/589.3**2 + 4.05656e8/589.3**4        # E7 nₒ(589.3 nm): 1.5225227699638455
//
// (b) the director profile, bvp_oracle.py: scipy.integrate.solve_bvp on the FULL second-order Euler–Lagrange equation
//     (an independent method; the engine uses Deuling's first integral):
//   x ∈ [0, 1] (z/d), y = (θ, θ', φ), parameter q with D = ε₀ V q / d:
//   θ'' = −((K33 − K11) s c θ'² + ε₀ V² q² Δε s c / ε²) / k,  φ' = q/ε,  k = K11 c² + K33 s²,  ε = ε⊥ + Δε s²
//   BCs θ(0) = θ(1) = θ₀, φ(0) = 0, φ(1) = 1; solve_bvp(tol=1e-8, bc_tol=1e-12), continuation in V;
//   Γ = 2π d/λ ∫₀¹ (n_eff(θ) − n_o) dx by scipy.integrate.quad.
//   K11 = 11 pN, K33 = 17 pN, ε∥ = 18, ε⊥ = 5, d = 5 µm, nₑ 1.7, nₒ 1.5, λ 550 nm:
//     θ₀ = 0:  V/V_th 2 → θ_m 1.128007057320, Γ 4.680910700839;  5 → 1.560453205653, 1.220635674233
//              1.2 → 0.467559806322, 9.939182882218;  3 → 1.441771544459, 2.359613181212
//     θ₀ = 2°: V/V_th 0.5 → 0.049293970167, 11.396520647585;  1 → 0.294340761111, 10.782071775151
//              2 → 1.150332012993, 4.436167918562;  5 → 1.560989692332, 1.180856314693
//
// (c) Jones: the stack is re-run through jones.ts readElements/propagate from the very text the calculator prints
//     for the Jones-calculus tool ("polariser 0", "retarder 135 …"), and through the optics-jones calculator itself.

/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSvg } = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (name: string, svg: string) => { found: string[] } };
import {
  E7,
  E7_LI,
  BL036,
  cauchyN,
  dnEff,
  nEff,
  cellRetardance,
  transmission,
  spectrum,
  findBands,
  designTilt,
  thresholdVoltage,
  profileAt,
  profileSamples,
  midApprox,
  tiltForDn,
  voltageOfMid,
  type Cell,
  type Material,
  type LcElastic,
} from "../lcRetarder";
import { LC_CALCS, readLevels, readMeasured, readMaterials } from "../lcCalcs";
import { lcTransmissionSvg, lcMeasuredSvg, richText } from "../lcCharts";
import { lcCellSvg, lcDirectorSvg, lcDeviceSvg, DEVICE_EX, DEVICE_EY } from "../lcDrawings";

/** Inverse of the device drawing's oblique projection: screen offset → in-plane angle (° from x toward y). */
function deviceAngleOf(dx: number, dy: number): number {
  const [a, b] = DEVICE_EX;
  const [c, d] = DEVICE_EY;
  const det = a * d - b * c;
  return (Math.atan2((-b * dx + a * dy) / det, (d * dx - c * dy) / det) * 180) / Math.PI;
}
import { decimateTrace } from "../spectraChart";
import { readElements, propagate, linearState } from "../jones";
import { FILM_CALCS } from "../filmCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";
import { referenceMs } from "./timingFloor";

const PI = Math.PI;
const CONST: Material = { name: "C", ne: { A: 1.7, B: 0, C: 0 }, no: { A: 1.5, B: 0, C: 0 } };
const cell = (d: number, tilt: number, oa: number, m: Material = CONST): Cell => ({ d, tilt, oa, material: m });

const calc = (id: string) => LC_CALCS.find((c) => c.id === id)!;
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = {};
  for (const f of c.fields) vals[f.key] = f.default;
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const plots = (o: AnalyzeOutput) => (o.blocks ?? []).filter((b) => b.kind === "plot") as Array<{ kind: "plot"; svg: string; caption: string; alt: string; w: number; h: number }>;

/** The display contract as the insert gate and the user see it. */
function contract(text: string) {
  expect(text).not.toMatch(/—/);
  expect(text).not.toMatch(/NaN|Infinity|undefined|not finite/);
  expect(text).not.toMatch(/\d[eE][+-]?\d/);
  expect(text).not.toMatch(/\^/);
  expect(text).not.toMatch(/(^|[\s(=,:])-\d/m);
  // ASCII subscript notation is not typesetting
  expect(text).not.toMatch(/(^|[^A-Za-z])[nVTθ]_[a-z]/);
}

// ===================================================================== the fixed table

describe("LC fixed case table", () => {
  test("1. nₑ 1.70, nₒ 1.50, d 5 µm, θ 0, λ 550 nm → Γ = 2π·0.2·5/0.55 = 11.424 rad", () => {
    expect(cellRetardance(cell(5, 0, 0), 550)).toBeCloseTo(11.423973285781065, 12);
  });

  test("2. θ 90° → Γ = 0; θ 45° → Δn_eff = 0.0906463 (closed form)", () => {
    expect(Math.abs(cellRetardance(cell(5, 90, 0), 550))).toBeLessThan(1e-14);
    expect(dnEff(1.7, 1.5, 45)).toBeCloseTo(0.09064629695710336, 14);
    expect(nEff(1.7, 1.5, 0)).toBeCloseTo(1.7, 14);
    expect(nEff(1.7, 1.5, 90)).toBeCloseTo(1.5, 14);
  });

  test("3. two identical cells at +45° and −45°: crossed T = 0, parallel T = 1 at every λ", () => {
    const sp = spectrum({ cells: [cell(5, 10, 45), cell(5, 10, -45)], polDeg: 0, anaDeg: 90, lam0: 400, lam1: 900, points: 251 });
    for (let i = 0; i < sp.lam.length; i++) {
      expect(sp.Tc[i]).toBeLessThan(1e-24);
      expect(sp.Tp[i]).toBeCloseTo(1, 12);
    }
  });

  test("4. Γ₁ − Γ₂ = π/2 at λ₀ → T crossed = 0.5, and 0.5 for every analyser angle", () => {
    // d₁ − d₂ = λ₀/(4Δn) = 0.55/0.8 µm
    const cells = [cell(5 + 0.6875, 0, 45), cell(5, 0, -45)];
    expect(cellRetardance(cells[0], 550) - cellRetardance(cells[1], 550)).toBeCloseTo(PI / 2, 12);
    for (let a = 0; a < 180; a += 7.5) expect(transmission(0, cells, a, 550)).toBeCloseTo(0.5, 12);
  });

  test("5. the same stack through the Jones-calculus tool gives the same T to 10⁻¹²", () => {
    const out = run("optics-lc-retarder", { cells: "3 10 45 LC-A\n2.5 35 -45 LC-B", analyser: "angle", anaAngle: "30", lam0: "580" });
    expect(out.ok).not.toBe(false);
    const m = /Jones-calculus check at λ₀: the same stack in the Jones-calculus tool is (.*?) \(fast axis/.exec(out.text);
    expect(m).not.toBeNull();
    const lines = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(lines[0]).toBe("polariser 0");
    const er = readElements(lines.join("\n"));
    if (!er.ok) throw new Error(er.reason);
    // the jones text carries 8 significant figures of δ, so compare with the engine at the same rounding first …
    const mats = readMaterials(calc("optics-lc-retarder").fields.find((f) => f.key === "materials")!.default);
    if (!mats.ok) throw new Error(mats.reason);
    const A = mats.mats.get("lc-a")!;
    const B = mats.mats.get("lc-b")!;
    const cells = [cell(3, 10, 45, A), cell(2.5, 35, -45, B)];
    const direct = transmission(0, cells, 30, 580);
    const viaText = propagate(linearState(0), er.elements.slice(1))!.transmitted;
    expect(Math.abs(viaText - direct)).toBeLessThan(1e-7);
    // … and EXACTLY (10⁻¹²) with the unrounded δ through the same jones.ts element kinds
    const exact = propagate(linearState(0), [
      ...cells.map((c) => ({ kind: "retarder" as const, angleDeg: c.oa + 90, deltaDeg: (cellRetardance(c, 580) * 180) / PI })),
      { kind: "polariser" as const, angleDeg: 30 },
    ])!.transmitted;
    expect(Math.abs(exact - direct)).toBeLessThan(1e-12);
    // the optics-jones calculator itself, from the printed lines, at its printed precision
    const jc = FILM_CALCS.find((c) => c.id === "optics-jones")!;
    const jv: Record<string, string> = { input: "linear", angle: "0", ex: "1", ey: "0", elements: lines.slice(1).join("\n") };
    const jo = jc.compute((k) => jv[k] ?? "");
    const t = /Transmitted intensity I\/I₀ = ([\d.]+)/.exec(jo.text);
    expect(Number(t![1])).toBeCloseTo(direct, 4);
  });

  test("5b. handedness: one cell, optic axis 45°, Γ = π/2 equals jones \"retarder 135 90\"", () => {
    // Γ = π/2 at 550 nm with Δn 0.2 → d = 0.6875 µm
    const c = cell(0.6875, 0, 45);
    const lc = propagate(linearState(0), [{ kind: "retarder", angleDeg: c.oa + 90, deltaDeg: (cellRetardance(c, 550) * 180) / PI }])!;
    const er = readElements("retarder 135 90");
    if (!er.ok) throw new Error(er.reason);
    const jo = propagate(linearState(0), er.elements)!;
    expect(lc.output[0].re).toBeCloseTo(jo.output[0].re, 12);
    expect(lc.output[0].im).toBeCloseTo(jo.output[0].im, 12);
    expect(lc.output[1].re).toBeCloseTo(jo.output[1].re, 12);
    expect(lc.output[1].im).toBeCloseTo(jo.output[1].im, 12);
  });

  test("6. Cauchy dispersion (B, C ≠ 0): Γ(λ) matches numpy at 3 wavelengths", () => {
    const m: Material = { name: "X", ne: { A: 1.68, B: 0.0095, C: 0.003 }, no: { A: 1.5, B: 0.0068, C: 0.0004 } };
    const c = cell(8, 20, 0, m);
    expect(cellRetardance(c, 450)).toBeCloseTo(24.569211889607914, 11);
    expect(cellRetardance(c, 632.8)).toBeCloseTo(13.896540355812443, 11);
    expect(cellRetardance(c, 1064)).toBeCloseTo(7.525150417791315, 11);
  });

  test("7. band detection on an analytically flat synthetic net: edges 597 and 703 nm", () => {
    const x: number[] = [];
    const dev: number[] = [];
    for (let l = 400; l <= 900; l += 2.5) {
      x.push(l);
      dev.push(Math.max(0, Math.abs(l - 650) - 50) / 100);
    }
    const b = findBands(x, dev, 0.03);
    expect(b.total).toBe(1);
    expect(b.bands[0].from).toBeCloseTo(597, 10);
    expect(b.bands[0].to).toBeCloseTo(703, 10);
    expect(b.bands[0].openLow).toBe(false);
    expect(b.bands[0].openHigh).toBe(false);
    // two bands, and a band that runs into the range end
    const x2 = [0, 1, 2, 3, 4, 5, 6];
    const d2 = [0, 0, 1, 1, 0, 1, 0];
    const b2 = findBands(x2, d2, 0.5);
    expect(b2.total).toBe(3);
    expect(b2.bands[0]).toMatchObject({ from: 0, to: 1.5, openLow: true, openHigh: false });
    expect(b2.bands[1]).toMatchObject({ from: 3.5, to: 4.5 });
    expect(b2.bands[2]).toMatchObject({ from: 5.5, to: 6, openHigh: true });
  });

  test("8. design mode: the tilt with Γ₁ − Γ₂ = π/2 at λ₀; plugged back, T = 0.5 at λ₀ (±10⁻⁹)", () => {
    const cells = [cell(6, 0, 45), cell(5, 0, -45)];
    const res = designTilt(cells, 1, 600, "qwp")!;
    expect(res.roots.length).toBeGreaterThan(0);
    for (const r of res.roots) {
      const c2 = [cells[0], { ...cells[1], tilt: r.tilt }];
      expect(transmission(0, c2, 90, 600)).toBeCloseTo(0.5, 9);
      expect(Math.abs(cellRetardance(c2[0], 600) - cellRetardance(c2[1], 600))).toBeCloseTo(Math.abs(r.net), 9);
    }
    // the calculator's design mode uses the lowest order and reports T crossed = 50 % at λ₀
    const out = run("optics-lc-retarder", { mode: "design", cells: "6 0 45 LC-A\n5 0 -45 LC-B", designCell: "2" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/T crossed = 50 %/);
    contract(out.text);
  });

  test("9. V_th for K₁₁ = 11 pN, Δε = 13 → π√(11×10⁻¹²/(8.8541878128×10⁻¹²·13)) = 0.97118 V", () => {
    expect(thresholdVoltage(11e-12, 13)).toBeCloseTo(0.9711809928825544, 14);
    const out = run("optics-lc-voltage", { K11: "11", epar: "18", eperp: "5" });
    expect(out.text).toMatch(/Vₜₕ = π√\(K₁₁\/\(ε₀Δε\)\) = 0\.97118 V rms/);
  });

  const P0: LcElastic = { K11: 11e-12, K33: 17e-12, epsPar: 18, epsPerp: 5, d: 5e-6, theta0: 0 };
  const O = { ne: 1.7, no: 1.5, lam: 550 };
  const vth = thresholdVoltage(11e-12, 13);

  test("10. below threshold with θ₀ → 0: θ(z) ≈ θ₀ everywhere and Γ ≈ the full-Δn value", () => {
    const p = { ...P0, theta0: (0.001 * PI) / 180 };
    const pr = profileAt(p, O, 0.5 * vth);
    if (!pr.ok) throw new Error(pr.reason);
    expect(pr.thetaM).toBeLessThan(3 * p.theta0);
    expect(pr.gamma).toBeCloseTo(11.423973285781065, 6);
    const s = profileSamples(p, pr.thetaM, pr.uniform);
    for (const t of s.theta) expect(t).toBeLessThan(3 * p.theta0);
    // exactly zero pretilt: undeformed below V_th
    const z = profileAt(P0, O, 0.99 * vth);
    expect(z.ok && z.uniform && z.thetaM === 0).toBe(true);
  });

  test.each([
    [0, 1.2, 0.467559806322, 9.939182882218],
    [0, 2, 1.12800705732, 4.680910700839],
    [0, 3, 1.441771544459, 2.359613181212],
    [0, 5, 1.560453205653, 1.220635674233],
    [2, 0.5, 0.049293970167, 11.396520647585],
    [2, 1, 0.294340761111, 10.782071775151],
    [2, 2, 1.150332012993, 4.436167918562],
    [2, 5, 1.560989692332, 1.180856314693],
  ])("11. pretilt %p°, V = %p V_th: θ_m and Γ match scipy solve_bvp (θ_m to 10⁻³ rad, Γ to 0.1 %%; in fact ~10⁻⁹)", (pre, vr, thm, g) => {
    const p = { ...P0, theta0: (pre * PI) / 180 };
    const pr = profileAt(p, O, vr * vth);
    if (!pr.ok) throw new Error(pr.reason);
    expect(Math.abs(pr.thetaM - thm)).toBeLessThan(1e-3);
    expect(Math.abs(pr.gamma - g) / g).toBeLessThan(1e-3);
    expect(Math.abs(pr.thetaM - thm)).toBeLessThan(1e-8);
    expect(Math.abs(pr.gamma - g) / g).toBeLessThan(1e-8);
  });

  test.each([
    ["optics-lc-voltage", { epar: "5", eperp: "18" }, /no splay Fréedericksz transition for zero or negative dielectric anisotropy/],
    ["optics-lc-voltage", { epar: "5", eperp: "5" }, /Δε = ε∥ − ε⊥ = 0 is not positive/],
    ["optics-lc-voltage", { K11: "0" }, /K₁₁ must be above 0/],
    ["optics-lc-voltage", { K33: "-3" }, /K₃₃ must be above 0/],
    ["optics-lc-voltage", { d: "0" }, /cell gap must be above 0/],
    ["optics-lc-voltage", { d: "NaN" }, /not a number/],
    ["optics-lc-voltage", { K11: "Infinity" }, /not a number/],
    ["optics-lc-voltage", { vFrom: "5", vTo: "2" }, /voltage range is reversed/],
    ["optics-lc-voltage", { points: "401" }, /from 2 to 400/],
    ["optics-lc-voltage", { vTo: "60" }, /beyond what the solver resolves/],
    ["optics-lc-retarder", { cells: "5 0 45 LC-A\n".repeat(7) }, /More than 6 cells/],
    ["optics-lc-retarder", { lamFrom: "900", lamTo: "400" }, /range is reversed or empty/],
    ["optics-lc-retarder", { points: "2001" }, /from 2 to 2000/],
    ["optics-lc-retarder", { cells: "0 0 45 LC-A" }, /thickness must be above 0/],
    ["optics-lc-retarder", { cells: "-5 0 45 LC-A" }, /thickness must be above 0/],
    ["optics-lc-retarder", { cells: "5 91 45 LC-A" }, /tilt .* must be 0° to 90°/],
    ["optics-lc-retarder", { cells: "5 0 45 Nope" }, /no material named "Nope"/],
    ["optics-lc-retarder", { cells: "" }, /No cells/],
    ["optics-lc-retarder", { pol: "abc" }, /not a number/],
  ])("12. %s %p → named refusal", (id, over, re) => {
    const out = run(id as string, over as Record<string, string>);
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(re as RegExp);
    // user text may be echoed, but only inside straight double quotes
    expect(out.text.replace(/"[^"]*"/g, "")).not.toMatch(/NaN|undefined|Infinity/);
  });

  test("13. every result passes the display contract (defaults, every select option, design, measured)", () => {
    for (const c of LC_CALCS) {
      const base = run(c.id);
      expect(base.ok).not.toBe(false);
      contract(base.text);
      for (const p of plots(base)) {
        contract(p.caption);
        contract(p.alt);
        expect(p.svg).not.toMatch(/NaN|Infinity|undefined/);
      }
      // every option of every select at otherwise PURE defaults, as the engineering audit drives the pane
      for (const f of c.fields.filter((x) => x.kind === "select"))
        for (const o of f.options ?? []) {
          const out = run(c.id, { [f.key]: o.value });
          expect([c.id, f.key, o.value, out.ok === false ? out.text : "ok"]).toEqual([c.id, f.key, o.value, "ok"]);
          contract(out.text);
          expect(plots(out).length).toBeGreaterThanOrEqual(1);
        }
    }
    // and every retarder select again with measured spectra present (in the units each option expects)
    const r = calc("optics-lc-retarder");
    for (const f of r.fields.filter((x) => x.kind === "select"))
      for (const o of f.options ?? []) {
        const out = run(r.id, { [f.key]: o.value, measured: f.key === "munits" && o.value === "fraction" ? MEASURED_FRACTION : MEASURED });
        expect([f.key, o.value, out.ok === false ? out.text : "ok"]).toEqual([f.key, o.value, "ok"]);
        contract(out.text);
      }
    // user text is echoed only inside straight double quotes
    const bad = run("optics-lc-retarder", { cells: "5 0 45 Zork" });
    expect(bad.text).toMatch(/"Zork"/);
  });

  test("14. timing: each calculator at its caps stays under the ceilings", () => {
    const six = Array.from({ length: 6 }, (_, i) => `${200 + i * 30} ${i * 10} ${i % 2 ? -45 : 45} LC-${i % 2 ? "B" : "A"}`).join("\n");
    let t = Date.now();
    const a = run("optics-lc-retarder", { cells: six, points: "2000", lamFrom: "300", lamTo: "2000", measured: BIG_MEASURED });
    const ta = Date.now() - t;
    expect(a.ok).not.toBe(false);
    t = Date.now();
    const b = run("optics-lc-voltage", { points: "400", vTo: "15" });
    const tb = Date.now() - t;
    expect(b.ok).not.toBe(false);
    t = Date.now();
    const d = run("optics-lc-retarder", { mode: "design", cells: "900 0 45 LC-A\n800 0 -45 LC-B", points: "2000" });
    const td = Date.now() - t;
    expect(d.ok).not.toBe(false);
    // Ceilings that scale with the machine (timingFloor.ts): 16 × the reference workload, ~1.5 s here; measured
    // ~70–620 ms (the voltage curve the slowest). A fixed 1.5 s failed once on a loaded worker.
    const ref = referenceMs();
    // eslint-disable-next-line no-console
    if (process.env.LC_TIMING) console.log({ ta, tb, td, ref });
    expect(ta).toBeLessThan(16 * ref);
    expect(tb).toBeLessThan(16 * ref);
    expect(td).toBeLessThan(16 * ref);
  });
});

// ===================================================================== extensions (levels, measured, drawings)

const MEASURED = (() => {
  const rows = ["Wavelength (nm)\tT crossed (%)\tT parallel (%)"];
  for (let l = 450; l <= 900; l += 5) {
    const g = (2 * PI * 0.08 * 1.7) / (l / 1000);
    const tc = Math.sin(g / 2) ** 2;
    rows.push(`${l}\t${(90 * tc).toFixed(3)}\t${(90 * (1 - tc)).toFixed(3)}`);
  }
  return rows.join("\n");
})();
const MEASURED_FRACTION = MEASURED.split("\n")
  .map((r, i) => (i === 0 ? r.replace(/ \(%\)/g, "") : r.split("\t").map((v, k) => (k === 0 ? v : (Number(v) / 100).toFixed(5))).join("\t")))
  .join("\n");
const BIG_MEASURED = (() => {
  const rows: string[] = [];
  let s = 1;
  for (let i = 0; i < 6000; i++) {
    s = (s * 16807) % 2147483647;
    const l = 400 + i * 0.1;
    const noise = ((s / 2147483647) - 0.5) * 6;
    rows.push(`${l.toFixed(1)}\t${(50 + noise).toFixed(3)}\t${(48 - noise).toFixed(3)}`);
  }
  return rows.join("\n");
})();

describe("LC retardation levels, measured spectra, decimation", () => {
  test("levels: 0.5π line sits at T = 50 %; π/2 ± 0.03π gives two lines; bare numbers refused", () => {
    const lv = readLevels("0.5π");
    if (!lv.ok) throw new Error(lv.reason);
    expect(Math.sin(lv.levels[0].gamma / 2) ** 2).toBeCloseTo(0.5, 14);
    const svg = lcTransmissionSvg({ lam: [400, 900], Tc: [0.2, 0.8], Tp: [0.8, 0.2], levels: lv.levels, bands: [], bandLabel: "", percent: true, style: "colour" });
    // the dashed line sits half-way up the 0–100 % frame (top 14, height 230), which the 0 and 100 ticks bound
    const lineY = /<polyline points="56,([\d.]+) [\d.]+,\1" fill="none" stroke="#2563eb"/.exec(svg);
    expect(lineY).toBeTruthy();
    expect(Number(lineY![1])).toBeCloseTo(14 + 230 / 2, 1);
    expect(svg).toMatch(/<line x1="52" y1="244" x2="56" y2="244"[^>]*\/><text[^>]*>0</);
    expect(svg).toMatch(/<line x1="52" y1="14" x2="56" y2="14"[^>]*\/><text[^>]*>100</);
    const pm = readLevels("π/2 ± 0.03π");
    if (!pm.ok) throw new Error(pm.reason);
    expect(pm.levels.map((l) => l.label)).toEqual(["retardation 0.53π", "retardation 0.47π"]);
    expect(Math.sin(pm.levels[0].gamma / 2) ** 2).toBeCloseTo(Math.sin(0.265 * PI) ** 2, 14);
    const named = readLevels("3π/2, pi, 0.8π");
    expect(named.ok && named.levels.map((l) => l.label)).toEqual(["retardation 3π/2", "retardation π", "retardation 0.8π"]);
    const one = readLevels("1π, 0.97π ± 0.03π");
    expect(one.ok && one.levels.map((l) => l.label)).toEqual(["retardation π", "retardation π", "retardation 0.94π"]);
    const bare = readLevels("0.5");
    expect(bare.ok).toBe(false);
    expect(!bare.ok && bare.reason).toMatch(/has no π/);
    expect(readLevels("0.1π, 0.2π, 0.3π, 0.4π, 0.5π, 0.6π, 0.7π, 0.8π, 0.9π").ok).toBe(false);
  });

  test("measured: header by name, % units, normalisation T⊥/(T⊥ + T∥) exact", () => {
    const m = readMeasured("lambda\tTp\tTc\n500\t60\t30\n510\t50\t40\n520\t20\t60", "%", true);
    if (!m.ok) throw new Error(m.reason);
    expect(m.m.lam).toEqual([500, 510, 520]);
    expect(m.m.Tc[0]).toBeCloseTo(30 / 90, 14);
    expect(m.m.Tp![0]).toBeCloseTo(60 / 90, 14);
    expect(m.m.Tc[2]).toBeCloseTo(0.75, 14);
    const asis = readMeasured("500 30 60\n510 40 50\n520 60 20", "%", false);
    expect(asis.ok && asis.m.Tc).toEqual([0.3, 0.4, 0.6]);
  });

  test("measured: wrong units, µm wavelengths, missing values, unsorted rows", () => {
    const f = readMeasured("500\t30\t60\n510\t40\t50\n520\t60\t20", "fraction", false);
    expect(!f.ok && f.reason).toMatch(/above 1\.5; choose "%"/);
    const um = readMeasured("0.5\t30\t60\n0.51\t40\t50\n0.52\t60\t20", "%", false);
    expect(!um.ok && um.reason).toMatch(/λ in nm/);
    const miss = readMeasured("500\t30\t60\n505\t-\t50\n510\t40\t50\n520\t60\t20", "%", true);
    expect(miss.ok && miss.m.notes.join(" ")).toMatch(/1 row with a missing value was skipped/);
    const uns = readMeasured("520\t60\t20\n500\t30\t60\n510\t40\t50", "%", false);
    expect(uns.ok && uns.m.lam).toEqual([500, 510, 520]);
    const frac = readMeasured("500\t0.3\t0.6\n510\t0.4\t0.5\n520\t0.6\t0.2", "%", false);
    expect(!frac.ok && frac.reason).toMatch(/no transmission exceeds 1\.5 %/);
    const mixed = readMeasured("500\t2,88\t60\n510\t40.5\t50\n520\t60\t20", "%", false);
    expect(mixed.ok).toBe(false);
  });

  test("measured band reported beside the model's; fragments reported as found", () => {
    const out = run("optics-lc-retarder", { measured: MEASURED });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/Measured spectra: 91 rows/);
    expect(out.text).toMatch(/Measured band/);
    expect(plots(out).length).toBe(6);
    const noisy = run("optics-lc-retarder", { measured: BIG_MEASURED, mnorm: "asis", rule: "transmission", tolT: "2" });
    expect(noisy.ok).not.toBe(false);
    expect(noisy.text).toMatch(/fragments/);
  });

  test("decimation keeps every minimum and maximum of a dense noisy spectrum", () => {
    const pts = BIG_MEASURED.split("\n").map((r) => {
      const [x, y] = r.split("\t").map(Number);
      return { x, y };
    });
    const d = decimateTrace(pts, 1200);
    expect(d.length).toBeLessThanOrEqual(1200);
    const ymax = Math.max(...pts.map((p) => p.y));
    const ymin = Math.min(...pts.map((p) => p.y));
    expect(Math.max(...d.map((p) => p.y))).toBe(ymax);
    expect(Math.min(...d.map((p) => p.y))).toBe(ymin);
    const svg = lcMeasuredSvg({ lam: pts.map((p) => p.x), Tc: pts.map((p) => p.y / 100), Tp: null, model: null, levels: [], bands: [], bandLabel: "", normalised: false, percent: true, style: "colour" });
    const poly = /<polyline points="([^"]+)" fill="none" stroke="#b91c1c"/.exec(svg)!;
    expect(poly[1].split(" ").length).toBeLessThanOrEqual(1200);
  });

  test("subscripts are drawn as lowered Arial tspans, a following space as dx", () => {
    expect(richText("OA₁", 12)).toBe('OA<tspan dy="3.4" font-size="8.6">1</tspan>');
    expect(richText("θₘ = 5°", 10)).toBe('θ<tspan dy="2.8" font-size="7.2">m</tspan><tspan dy="-2.8" dx="2.8">= 5°</tspan>');
  });
});

describe("LC drawings: angles read back, no label overlaps", () => {
  const audit = (name: string, svg: string) => {
    const r = auditSvg(name, svg) as { found: string[] };
    expect(r.found).toEqual([]);
  };

  test.each([0, 2, 12.5, 35, 60, 89, 90])("cell cross-section, uniform tilt %p°: every molecule's rotate() equals θ; arc spans θ", (t) => {
    const svg = lcCellSvg({ tiltsDeg: [t], uniformTiltDeg: t, style: "colour", title: `Cell 1: uniform tilt θ = ${t}°` });
    const rots = [...svg.matchAll(/<ellipse[^>]*transform="rotate\(([-\d.]+) /g)].map((m) => Number(m[1]));
    expect(rots.length).toBeGreaterThan(20);
    for (const r of rots) expect(Math.abs(r - t)).toBeLessThan(0.5);
    const arc = /<path d="M([\d.]+) ([\d.]+) A([\d.]+) [\d.]+ 0 0 1 ([\d.]+) ([\d.]+)" [^>]*data-angle="([\d.]+)" data-cx="([\d.]+)" data-cy="([\d.]+)"/.exec(svg);
    if (t > 0.05) {
      const [, , , , ex, ey, , cxs, cys] = arc!.map(Number);
      const ang = (Math.atan2(ex - cxs, -(ey - cys)) * 180) / PI; // from the substrate (vertical) direction
      expect(Math.abs(ang - t)).toBeLessThan(0.5);
    }
    audit(`cell ${t}`, svg);
  });

  test("cell cross-section with a computed profile: each column's tilt is θ(z) at that column; B/W too", () => {
    const tilts = [5, 30, 55, 70, 75, 70, 55, 30, 5];
    for (const style of ["colour", "bw"] as const) {
      const svg = lcCellSvg({ tiltsDeg: tilts, uniformTiltDeg: null, pretiltDeg: 2, voltage: 2.5, style, title: "Director profile at 2.5 V rms" });
      const cols = new Map<number, number[]>();
      for (const m of svg.matchAll(/<ellipse cx="([\d.]+)"[^>]*rotate\(([-\d.]+) /g)) {
        const k = Number(m[1]);
        cols.set(k, [...(cols.get(k) ?? []), Number(m[2])]);
      }
      const keys = [...cols.keys()].sort((a, b) => a - b);
      expect(keys.length).toBe(9);
      keys.forEach((k, i) => cols.get(k)!.forEach((r) => expect(Math.abs(r - tilts[i])).toBeLessThan(0.5)));
      if (style === "bw") expect(svg).not.toMatch(/#3b82f6|#b91c1c|#f59e0b/);
      audit(`profile ${style}`, svg);
    }
  });

  test.each([0, 15, 19.9, 45, 70, 75, 89, 90])("director geometry at θ = %p°: molecule and arc at θ, no overlaps", (t) => {
    const svg = lcDirectorSvg({ tiltDeg: t, style: "colour" });
    const rot = Number(/<ellipse[^>]*rotate\(([-\d.]+) /.exec(svg)![1]);
    expect(Math.abs(-rot - t)).toBeLessThan(0.5); // drawn leaning toward +z
    if (t > 0) {
      const m = /<path d="M150 ([\d.]+) A([\d.]+) [\d.]+ 0 0 0 ([\d.]+) ([\d.]+)"[^>]*data-angle/.exec(svg)!;
      const ang = (Math.atan2(Number(m[3]) - 150, Number(m[4]) - 120) * 180) / PI; // from −x (down)
      expect(Math.abs(ang - t)).toBeLessThan(0.5);
    }
    audit(`director ${t}`, lcDirectorSvg({ tiltDeg: t, style: "bw" }));
    audit(`director ${t}`, svg);
  });

  test.each([
    [0, [45, -45], 90],
    [0, [45, -45], 30],
    [10, [0], 100],
    [0, [45, -45, 45, -45, 45, -45], 90],
    [-20, [30, 120, -60], 0],
    [0, [5, -85], 45],
  ])("device schematic P %p°, cells %p, A %p°: arcs read back to their angles, no overlaps", (pol, oas, ana) => {
    for (const style of ["colour", "bw"] as const) {
      const svg = lcDeviceSvg({ polDeg: pol as number, cellsOaDeg: oas as number[], anaDeg: ana as number, style });
      for (const m of svg.matchAll(/data-angle="([-\d.]+)" data-cx="([\d.]+)" data-cy="([\d.]+)" data-ex="([\d.]+)" data-ey="([\d.]+)"/g)) {
        const [, a, cxs, cys, ex, ey] = m.map(Number);
        const back = deviceAngleOf(ex - cxs, ey - cys);
        // the arc spans the angle AS TYPED: its end reads back to the typed angle modulo 360°
        const diff = (((back - a) % 360) + 720) % 360;
        expect(Math.min(diff, 360 - diff)).toBeLessThan(0.5);
      }
      // inserted no wider than DEVICE_MAX_W (Word sizes the picture from the SVG width)
      expect(Number(/^<svg[^>]*\swidth="(\d+)"/.exec(svg)![1])).toBeLessThanOrEqual(640);
      // the OA labels are present, one per cell
      expect([...svg.matchAll(/>OA</g)].length).toBe(Math.min(4, (oas as number[]).length));
      audit(`device ${pol} ${oas} ${ana} ${style}`, svg);
    }
  });
});

describe("LC engine adversarial rows", () => {
  test("E7-Li built-in: the µm coefficients reproduce the report's nm-unit formula", () => {
    expect(cauchyN(E7_LI.ne, 589.3)).toBeCloseTo(1.7466111158543394, 13);
    expect(cauchyN(E7_LI.no, 589.3)).toBeCloseTo(1.5225227699638455, 13);
    const out = run("optics-lc-retarder", { cells: "5 0 45 E7-Li\n4 20 -45 E7-Li", lamFrom: "400", lamTo: "800" });
    expect(out.text).toMatch(/Capobianco & Fineschi/);
    expect(out.text).toMatch(/extrapolation/);
  });

  test("E7 and BL036 built-ins: Wahle & Kitzerow (2014) Table 2, B read as ×10⁻⁴ µm⁴", () => {
    const l2 = 0.5893 ** 2;
    expect(cauchyN(E7.ne, 589.3)).toBeCloseTo(1.693 + 0.0078 / l2 + 28.0e-4 / (l2 * l2), 14);
    expect(cauchyN(E7.no, 589.3)).toBeCloseTo(1.499 + 0.0072 / l2 + 3.01e-4 / (l2 * l2), 14);
    expect(cauchyN(BL036.ne, 589.3)).toBeCloseTo(1.733 + 0.0137 / l2 + 25.04e-4 / (l2 * l2), 14);
    expect(cauchyN(BL036.no, 589.3)).toBeCloseTo(1.513 + 0.0042 / l2 + 3.67e-4 / (l2 * l2), 14);
    // the unit reading is the only one giving indices of the measured size: BL036 Δn(589 nm) ≈ 0.265
    expect(cauchyN(BL036.ne, 589.3) - cauchyN(BL036.no, 589.3)).toBeCloseTo(0.2651, 3);
    // the two published E7 tables agree to about 0.01 in nₑ (different samples / temperatures)
    expect(Math.abs(cauchyN(E7.ne, 589.3) - cauchyN(E7_LI.ne, 589.3))).toBeLessThan(0.012);
  });

  // PAPER REPRODUCTION (Abuleil & Abdulhalim, Opt. Lett. 39, 5487 (2014)): BL036 27.23 µm at +45°, E7 49.51 µm at
  // −45°, crossed polarisers, indices from Wahle & Kitzerow (2014) Table 2 (the paper used the Li & Wu coefficients it
  // cites, not available here). NOT TUNED. Outcomes, pinned as computed:
  //   tuned AQWP (35°, 46.26°, ±0.06π): computed 426.6–673.0 nm vs reported 435–645 nm   → agrees within ~30 nm
  //   AHWP (2°, 30.85°, |net| within π ± 0.2π, the paper's 0.8π line): computed 555.9–1643.8 nm → spans most of the
  //     paper's 400–1750 nm plot, as its figure does (no band edges were quoted to compare)
  //   AQWP (2°, 29.91°, ±0.03π): computed 661.2–776.0 nm (plus 436.4–452.7 nm) vs reported 570–860 nm → DISCREPANCY:
  //     the computed band is narrower and inside the reported one. The net retardance is the small difference of two
  //     large ones (Γ ≈ 19.3π and 20.8π at 700 nm), so a 0.001 change in an index moves it by ~0.1π; the index tables differ.
  test.each([
    ["ol-tuned", [[426.6, 673.0]]],
    ["ol-ahwp", [[555.87, 1643.8]]],
    ["ol-aqwp", [[436.44, 452.69], [661.24, 775.96]]],
  ])("published example %s: computed bands pinned (compared with the paper in the comment above)", (preset, bands) => {
    const out = run("optics-lc-retarder", { preset: preset as string });
    expect(out.ok).not.toBe(false);
    contract(out.text);
    expect(out.text).toMatch(/doi:10\.1364\/OL\.39\.005487/);
    const got = [...out.text.matchAll(/ {2}Band: ([\d.]+) nm to ([\d.]+) nm/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(got.length).toBe((bands as number[][]).length);
    (bands as number[][]).forEach((b, i) => {
      expect(got[i][0]).toBeCloseTo(b[0], 0);
      expect(got[i][1]).toBeCloseTo(b[1], 0);
    });
    if (preset === "ol-tuned") {
      expect(Math.abs(got[0][0] - 435)).toBeLessThan(30);
      expect(Math.abs(got[0][1] - 645)).toBeLessThan(30);
    }
  });

  test("uniform-tilt equivalent inverts Δn_eff; the uniform-profile approximation is θ₀ below V_th", () => {
    for (const t of [0, 7, 33, 60, 89.5]) expect(tiltForDn(1.7, 1.5, dnEff(1.7, 1.5, t))).toBeCloseTo(t, 8);
    expect(tiltForDn(1.7, 1.5, 0.3)).toBeNull();
    expect(midApprox(0.1, 0.8)).toBe(0.1);
    expect(midApprox(0, 2)).toBeCloseTo((PI / 2) * Math.sqrt(0.75), 14);
  });

  test("V(θ_m) → V_th as θ_m → 0 (the first integral reproduces the linear threshold)", () => {
    expect(voltageOfMid({ K11: 11e-12, K33: 17e-12, epsPar: 18, epsPerp: 5, d: 5e-6, theta0: 0 }, 1e-6)).toBeCloseTo(0.9711809928825544, 9);
  });

  test("non-collinear axes: net retardance named undefined, band by the transmission rule; design refused", () => {
    const out = run("optics-lc-retarder", { cells: "3 0 45 LC-A\n2 20 -15 LC-B" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/net retardance is not defined/);
    expect(plots(out).length).toBe(4);
    const d = run("optics-lc-retarder", { mode: "design", cells: "3 0 45 LC-A\n2 20 -15 LC-B" });
    expect(d.ok).toBe(false);
    expect(d.text).toMatch(/parallel or perpendicular/);
  });

  test("design with no reachable target is refused with the reachable span", () => {
    const d = run("optics-lc-retarder", { mode: "design", cells: "1 0 45 LC-A\n0.2 0 -45 LC-A", designCell: "2" });
    expect(d.ok).toBe(false);
    expect(d.text).toMatch(/No tilt of cell 2 .* only spans/);
  });

  test("half-wave target, parallel analyser, B/W style, fraction axis all compute", () => {
    const out = run("optics-lc-retarder", { target: "hwp", analyser: "parallel", style: "bw", tunits: "fraction" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/half-wave/);
    for (const p of plots(out)) expect(p.svg).not.toMatch(/#b91c1c|#15803d|#3b82f6/);
  });

  test("materials: comma decimals, duplicate names, missing index, absurd Cauchy terms, Cauchy blow-up", () => {
    expect(run("optics-lc-retarder", { materials: "M ne 1,7 no 1.5", cells: "5 0 45 M" }).text).toMatch(/uses a comma/);
    expect(run("optics-lc-retarder", { materials: "M ne 1.7 no 1.5\nm ne 1.6 no 1.5", cells: "5 0 45 M" }).text).toMatch(/defined twice/);
    expect(run("optics-lc-retarder", { materials: "M ne 1.7", cells: "5 0 45 M" }).text).toMatch(/both indices are needed/);
    expect(run("optics-lc-retarder", { materials: "M ne 1.7 5 no 1.5", cells: "5 0 45 M" }).text).toMatch(/outside ±1/);
    expect(run("optics-lc-retarder", { materials: "M ne 1.7 0 0.9 no 1.5", cells: "5 0 45 M", lamFrom: "200" }).text).toMatch(/leave 1 to 4/);
    // the displayed subscript form round-trips as input
    expect(run("optics-lc-retarder", { materials: "M nₑ 1.7 nₒ 1.5", cells: "5 0 45 M" }).ok).not.toBe(false);
  });

  test("huge and tiny magnitudes: 1000 µm cells at 2000 points, 0.001 µm cells, 20000 nm", () => {
    expect(run("optics-lc-retarder", { cells: "1000 0 45 LC-A\n999 0 -45 LC-B", points: "2000" }).ok).not.toBe(false);
    expect(run("optics-lc-retarder", { cells: "0.001 0 45 LC-A", lamFrom: "19000", lamTo: "20000" }).ok).not.toBe(false);
    expect(run("optics-lc-voltage", { d: "1000", K11: "1e4" }).ok).not.toBe(false);
    expect(run("optics-lc-voltage", { K11: "20000" }).text).toMatch(/not nematic values/);
  });

  test("voltage tool: target retardance and target tilt are found and consistent", () => {
    const g = run("optics-lc-voltage", { targetKind: "gamma", targetGamma: "0.5π" });
    expect(g.ok).not.toBe(false);
    const v = Number(/Voltage for Γ = 0\.5π: ([\d.]+) V rms/.exec(g.text)![1]);
    const mats = readMaterials("LC ne 1.700 0.0120 0.0030 no 1.500 0.0065 0.0004");
    if (!mats.ok) throw new Error(mats.reason);
    const m = [...mats.mats.values()][0];
    const o = { ne: cauchyN(m.ne, 600), no: cauchyN(m.no, 600), lam: 600 };
    const pr = profileAt({ K11: 11e-12, K33: 17e-12, epsPar: 18, epsPerp: 5, d: 5e-6, theta0: (2 * PI) / 180 }, o, v);
    expect(pr.ok && pr.gamma / PI).toBeCloseTo(0.5, 4);
    const t = run("optics-lc-voltage", { targetKind: "tilt", targetTilt: "45" });
    expect(t.text).toMatch(/Voltage for a midplane tilt of 45°/);
    expect(run("optics-lc-voltage", { targetKind: "gamma", targetGamma: "9π" }).text).toMatch(/out of reach/);
    expect(run("optics-lc-voltage", { targetKind: "tilt", targetTilt: "1" }).text).toMatch(/above the pretilt/);
    expect(run("optics-lc-voltage", { indices: "E7" }).ok).not.toBe(false);
    expect(run("optics-lc-voltage", { indices: "ne 1.5 no 1.7" }).text).toMatch(/nₑ > nₒ/);
  });

  test("every figure of both calculators passes the layout audit (defaults, B/W, measured)", () => {
    for (const [id, over] of [
      ["optics-lc-retarder", {}],
      ["optics-lc-retarder", { style: "bw", measured: MEASURED }],
      ["optics-lc-retarder", { analyser: "angle", anaAngle: "30", cells: "3 10 45 LC-A\n2.5 35 -45 LC-B\n1 5 45 LC-A" }],
      ["optics-lc-voltage", {}],
      ["optics-lc-voltage", { style: "bw", pretilt: "0", vProfile: "0.5", targetKind: "gamma", targetGamma: "π" }],
    ] as Array<[string, Record<string, string>]>) {
      const out = run(id, over);
      expect(out.ok).not.toBe(false);
      for (const p of plots(out)) {
        const r = auditSvg(id, p.svg) as { found: string[] };
        expect(r.found).toEqual([]);
      }
    }
  });
});

// ===================================================================== independent review, fix round (rules A–H)
// Repros from scratchpad/review-lc (c3, c7, c9, c10, c11, c12, draw.js, p2c.py/p2d.py, p9.py, p10.py). Oracles:
//   p2d.py (scipy quad + brentq on the first integral) for θ(z) at printed z, e.g.
//     python p2d.py 11 17 18 5 2 67.561870644477779 → 0.05:21.6188 0.1:35.4518 0.2:52.1863 0.3:61.3338 0.4:66.0803
//     python p2d.py 15 5 8 3 0 81.838428176837283  → 0.05:18.6926 0.1:34.6560 0.2:58.1279 0.3:72.4837 0.4:79.7116
//   p10.py (solve_bvp, K11 = 10⁻⁶ pN, V = 2 V): θₘ = 79.13370192525743°
describe("LC review fix round", () => {
  test("A: published AQWP is the m = 1 quarter-wave plate; comparison with the paper stated, not tuned", () => {
    const out = run("optics-lc-retarder", { preset: "ol-aqwp" });
    expect(out.text).toMatch(/π\/2 \+ mπ for any integer m/);
    expect(out.text).toMatch(/Comparison with the paper: with these indices the device is the m = 1 quarter-wave plate \(\|net\| = 1\.5π at 700 nm\), which the paper's condition allows; computed band 661\.2–776 nm, reported 570–860 nm\./);
    const tuned = run("optics-lc-retarder", { preset: "ol-tuned" });
    expect(tuned.text).toMatch(/device is the m = 0 quarter-wave plate .* computed band 426\.6–673 nm, reported 435–645 nm/);
    const hw = run("optics-lc-retarder", { preset: "ol-ahwp" });
    expect(hw.text).toMatch(/m = 0 half-wave plate .* computed band 555\.9–1644 nm/);
  });

  test("A: level lines are labelled by the order form; typed levels as ±x + 2mπ, with a note", () => {
    const auto = run("optics-lc-retarder", { preset: "ol-aqwp" });
    const svg = plots(auto)[0].svg;
    expect(svg).toMatch(/retardation π\/2 \+ mπ ± 0\.03π/);
    expect(svg).not.toMatch(/retardation 0\.53π/);
    expect(svg).toMatch(/achromatic band, \|net\| = π\/2 \+ mπ ± 0\.03π, m = 1/);
    const typed = run("optics-lc-retarder", { levels: "0.53π, π/2, 1.47π" });
    const t = plots(typed)[0].svg;
    expect(t).toMatch(/retardation ±0\.53π \+ 2mπ/);
    expect(t).toMatch(/retardation π\/2 \+ mπ/);
    expect(typed.text).toMatch(/also marks 2mπ ± x for every integer m/);
    const hw = plots(run("optics-lc-retarder", { target: "hwp", tolPi: "0.2" }))[0].svg;
    expect(hw).toMatch(/retardation \(2m \+ 1\)π ± 0\.2π/);
  });

  test("B: no measured band unless the axes are collinear and at ±45° to the polariser (meas15 / c11)", () => {
    const meas = MEASURED;
    const skew = run("optics-lc-retarder", { cells: "10 0 15 LC-A\n5 24.26 -75 LC-B", measured: meas });
    expect(skew.ok).not.toBe(false);
    expect(skew.text).toMatch(/No measured band is given/);
    expect(skew.text).not.toMatch(/Measured band:/);
    expect(plots(skew).some((p) => /no measured band for this geometry/.test(p.caption))).toBe(true);
    const tr = run("optics-lc-retarder", { cells: "10 0 15 LC-A\n5 24.26 -75 LC-B", measured: meas, rule: "transmission" });
    expect(tr.text).toMatch(/No measured band is given/);
    const ok = run("optics-lc-retarder", { measured: meas });
    expect(ok.text).toMatch(/Measured band/);
    const pol = run("optics-lc-retarder", { measured: meas, pol: "10" });
    expect(pol.text).toMatch(/No measured band is given/);
  });

  test("C: device drawing: 5–6 cells draw the first 4 with a note; text ≥ 10 px as inserted; arcs as typed", () => {
    const six = run("optics-lc-retarder", { cells: "10 0 45 LC-A\n5 10 -45 LC-B\n4 20 45 LC-A\n3 30 -45 LC-B\n2 40 45 LC-A\n2 50 -45 LC-B" });
    expect(six.text).toMatch(/device drawing shows the first 4 of the 6 cells/);
    for (const cfg of [
      { polDeg: 0, cellsOaDeg: [0, 90, -30, 135, 180, -90], anaDeg: 90 },
      { polDeg: 45, cellsOaDeg: [170, -170, 10, -10, 60, -60], anaDeg: -45 },
      { polDeg: 20, cellsOaDeg: [0, 90, -30, 135], anaDeg: -60 },
      { polDeg: -90, cellsOaDeg: [179], anaDeg: 0 },
      { polDeg: 0, cellsOaDeg: [45, -45], anaDeg: 90 },
    ]) {
      for (const style of ["colour", "bw"] as const) {
        const svg = lcDeviceSvg({ ...cfg, style });
        const w = Number(/^<svg[^>]*\swidth="(\d+)"/.exec(svg)![1]);
        const vb = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)![1]);
        const smallest = Math.min(...[...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])));
        expect(smallest * (w / vb)).toBeGreaterThanOrEqual(10);
        expect((auditSvg("dev", svg) as { found: string[] }).found).toEqual([]);
      }
    }
    const svg = lcDeviceSvg({ polDeg: 0, cellsOaDeg: [135], anaDeg: 90, style: "colour" });
    expect(svg).toMatch(/data-angle="135"/);
    expect(svg).not.toMatch(/data-angle="-45"/);
  });

  test("E: target tilt above the resolvable limit refused by name; tilts near 90° never print as 90°", () => {
    for (const t of ["89.999999999999", "89.99999999999999"]) {
      const out = run("optics-lc-voltage", { targetKind: "tilt", targetTilt: t });
      expect(out.ok).toBe(false);
      expect(out.text).toMatch(/at most 89\.999999994° \(the solver resolves the midplane to within 10⁻¹⁰ rad of 90°\)/);
    }
    const near = run("optics-lc-voltage", { targetKind: "tilt", targetTilt: "89.999999" });
    expect(near.text).toMatch(/Voltage for a midplane tilt of 89\.999999°/);
    expect(near.text).not.toMatch(/tilt of 90°/);
    const hi = run("optics-lc-voltage", { vTo: "18", vProfile: "18" });
    expect(hi.text).not.toMatch(/θₘ = 90°/);
  });

  test("E: θ(z) table evaluated exactly at the printed z (matches p2d.py)", () => {
    const def = run("optics-lc-voltage");
    expect(def.text).toMatch(/z\/d = 0\.05: 21\.6188°;  z\/d = 0\.1: 35\.4518°;  z\/d = 0\.2: 52\.1863°;  z\/d = 0\.3: 61\.3338°;  z\/d = 0\.4: 66\.0803°/);
    const vp = run("optics-lc-voltage", { K11: "15", K33: "5", epar: "8", eperp: "3", d: "6", pretilt: "0", vProfile: "3.31", vTo: "6", indices: "ne 1.72 no 1.52", lam: "633" });
    expect(vp.text).toMatch(/z\/d = 0\.05: 18\.6926°;  z\/d = 0\.1: 34\.656°;  z\/d = 0\.2: 58\.1279°;  z\/d = 0\.3: 72\.4837°;  z\/d = 0\.4: 79\.7116°/);
    const tiny = run("optics-lc-voltage", { K11: "0.000001" });
    const thm = Number(/Midplane tilt θₘ = ([\d.]+)°/.exec(tiny.text)![1]);
    expect(Math.abs(thm - 79.13370192525743)).toBeLessThan(1e-3);
  });

  test("E: a target voltage outside the sweep is said and not marked; E7 outside its fit range is warned", () => {
    const out = run("optics-lc-voltage", { vTo: "1.5", targetKind: "gamma", targetGamma: "0.5π" });
    expect(out.text).toMatch(/outside the plotted sweep .* not marked/);
    expect(plots(out)[1].svg).not.toMatch(/Γ = 0\.5π at/);
    const e7 = run("optics-lc-voltage", { indices: "E7", lam: "1064" });
    expect(e7.text).toMatch(/E7: the index fit covers about 450–750 nm; at 1064 nm the indices are an extrapolation/);
  });

  test("F: design lists every root up to 24, sorted, the used one always among them", () => {
    for (const cells of ["40 0 45 LC-B\n30 0 45 LC-B", "40 0 45 LC-B\n30 0 -45 LC-B"]) {
      const out = run("optics-lc-retarder", { mode: "design", cells, designCell: "2" });
      const rows = out.text.split("\n").filter((l) => /^ {2}θ = [\d.]+°: net retardance/.test(l));
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.length).toBeLessThanOrEqual(24);
      expect(rows.filter((l) => /← used/.test(l)).length).toBe(1);
      const tilts = rows.map((l) => Number(/θ = ([\d.]+)°/.exec(l)![1]));
      expect([...tilts].sort((a, b) => a - b)).toEqual(tilts);
    }
  });

  test("G: rounding noise prints as 0 (off by 0)", () => {
    const out = run("optics-lc-retarder", { mode: "design", cells: "10 0 45 LC-A\n5 0 225 LC-B\n3 0 -45 LC-A", designCell: "3" });
    expect(out.text).toMatch(/off by 0$/m);
  });

  test("H: B/W measured traces carry markers; level lines are thin grey dashes", () => {
    const out = run("optics-lc-retarder", { measured: MEASURED, style: "bw" });
    const svg = plots(out).find((p) => /Measured/.test(p.caption))!.svg;
    expect(svg).toMatch(/<circle [^>]*fill="#ffffff" stroke="#000000"/);
    expect(svg).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="5\.2"/);
    expect(svg).toMatch(/stroke="#888888"/);
  });
});
