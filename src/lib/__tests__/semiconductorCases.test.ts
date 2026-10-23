// Release E3-d: semiconductor devices. The FIXED CASE TABLE from the brief (oracle ~/jurislab-relE/oracle_e3.py, nᵢ
// typed 1.0×10¹⁰ cm⁻³, kT/q 0.025852 V) is pinned twice: on the engine (semiconductor.ts) and through the pane's own
// registry (SEMICONDUCTOR_CALCS compute → named outputs). Later fix rounds keep every row (cumulative gate).
//
// Further reference values, Python venv C:\Users\AlexanderSmith\jurislab-oracle-venv (scipy.constants, CODATA 2022;
// the app uses CODATA 2018 ε₀ = 8.8541878128×10⁻¹² — 7×10⁻¹⁰ relative, far inside every tolerance below):
//   import math; from scipy import constants as C; k=C.k; q=C.e; e0=C.epsilon_0; Vt=k*300/q   # 0.025851999786435535
//   def pn(NA,ND,ni,er,VR=0.0,Vt=Vt):
//       Vbi=Vt*math.log(NA*ND/ni**2); eps=er*e0
//       W=math.sqrt(2*eps*(Vbi+VR)/q*(1/(NA*1e6)+1/(ND*1e6))); xn=W*NA/(NA+ND); xp=W*ND/(NA+ND)
//       Em=q*ND*1e6*xn/eps; Cj=eps/W; W1=math.sqrt(2*eps*(Vbi+VR)/(q*min(NA,ND)*1e6))
//   pn(1e16,1e17,1e10,11.7)        Vbi 0.7738435813203123, W 0.33177986938723053 µm, xn 0.030161806307930045,
//                                  xp 0.30161806307930045 µm, Emax 4664801.289780095 V/m, Cj 0.0003122371398580914 F/m²,
//                                  W1 0.31633969332551326 µm
//   pn(1e16,1e17,1e10,11.7,5.0)    W 0.9062665416942893 µm, Cj 0.00011430853144626554 F/m²
//   pn(1e16,1e17,9.65e9,11.7)      Vbi 0.7756856488979564, W 0.33217452128031627 µm   (the Si preset nᵢ)
//   pn(1e17,1e16,2.1e6,12.9)       Vbi 1.2116938878239814, W 0.4359350839809863 µm     (the GaAs presets)
//   pn(5e17,1e15,1e10,11.7)        Vbi 0.7559243405565081, W 0.9896921431605812, W1 0.9887039330857271 µm
//   pn(1e16,1e17,4e11,11.7,Vt=k*350/q)  Vbi 0.6802993862005047                         (T 350 K, nᵢ typed)
//   Is*math.expm1(V/(n*Vt)): (1e-14,1,0.6) 0.00012010369553128491; (1e-12,2,0.7) 7.581246947925479e-07; (1e-14,1,−1) −1e-14
//   MOSFET (SPICE level 1), Cox=3.9*e0/10e-9, beta=400e-4*Cox*10, Vov 1:
//     sat:    Id=0.5*beta*Vov**2*(1+lam*Vds); gm=beta*Vov*(1+lam*Vds); gds=0.5*beta*Vov**2*lam
//     triode: Id=beta*(Vov*Vds-Vds**2/2)*(1+lam*Vds); gm=beta*Vds*(1+lam*Vds);
//             gds=beta*(Vov-Vds)*(1+lam*Vds)+lam*beta*(Vov*Vds-Vds**2/2)
//     λ 0.05, Vds 2:   Id 0.75968931485304 mA, gm 1.51937862970608 mS, gds 34.53133249332001 µS
//     λ 0, Vds 0.4:    Id 0.44200105591449607 mA, gm 0.5525013198931201 mS, gds 828.75197983968 µS
//     λ 0.05, Vds 0.4: Id 0.450841077032786 mA, gm 0.5635513462909825 mS, gds 867.4270722321984 µS
//   carriers: N=ND−NA; n=N/2+sqrt(N*N/4+ni*ni) (N ≥ 0), p=ni*ni/n (mirror for N < 0); EF−Ei=Vt*ln(n/ni);
//             σ=q(n µn + p µp) [S/cm]; Ec−EF=Vt*ln(Nc/n); EF−Ev=Vt*ln(Nv/p)
//     ND 1e16, ni 1e10, 1400/450, Nc 3.2e19: p 9999.99999999, EF−Ei 0.3571585759940161, σ 2.243047287602964,
//                                            ρ 0.44582207674660823, Ec−EF 0.2086490624836581
//     NA 1e17, ni 1e10, 1400/450, Nv 1.8e19: n 999.9999999999901, EF−Ei −0.4166850053263223, σ 7.209794853000295,
//                                            EF−Ev 0.13424831940018242
//     ND 3e15, NA 1e15, ni 9.65e9, 1350/480: n 2000000000046561.2, p 46561.24999891603, EF−Ei 0.31647242121488656,
//                                            σ 0.43258769119365165
//     ND = ni = 1e10, 1400/450:              n 16180339887.49895, p 6180339887.498948, EF−Ei 0.012440287998671123
//     Band-edge rows (integrator decision 2026-10-23: caution within 3kT of an edge, refuse only at N >= Nc / Nv):
//   pn(1e18,1e17,9.65e9,11.7)      Vbi 0.89473850756262, W 0.11281620952486975 µm; NA edge ln(1.8e19/1e18) = 2.89 kT
//   pn(1e16,1e17,2.1e6,12.9)       Vbi 1.2116938878239814, W 0.4359350839809863 µm; ND edge ln(4.7e17/1e17) = 1.55 kT
//   car ND 1e19, ni 9.65e9, 1400/450: EF−Ei 0.5366588977798076, σ 2243.0472876, Ec−EF 0.03006977448668878 (1.16 kT)

import {
  carriers,
  cjAt,
  MATERIALS,
  mosfet,
  pnJunction,
  shockley,
  thermalVoltage,
  type PnInput,
} from "../semiconductor";
import { SEMICONDUCTOR_CALCS, sciInput } from "../semiconductorCalcs";
import { cvChartSvg, fermiChartSvg, idVdsFamilySvg, ivChartSvg } from "../semiconductorCharts";
import { mathToOmml } from "../mathOmml";
import type { AnalyzeOutput } from "../analyzeBlocks";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = SEMICONDUCTOR_CALCS.find((x) => x.id === id);
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

const PN: PnInput = { na: 1e16, nd: 1e17, ni: 1e10, epsR: 11.7, tK: 300, vr: 0, nc: null, nv: null };
const pnOk = (p: Partial<PnInput> = {}) => {
  const r = pnJunction({ ...PN, ...p });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const MOS = { mu: 400, tox: 10e-9, epsOx: 3.9, wl: 10, vth: 0.5, vgs: 1.5, vds: 1.5, lambda: 0 };
const mosOk = (p: Partial<typeof MOS> = {}) => {
  const r = mosfet({ ...MOS, ...p });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const PN_CASE = { ni: "1.0×10¹⁰" };

// ---------------------------------------------------------------------------------------------------------------
// The fixed case table (brief E3-d)
// ---------------------------------------------------------------------------------------------------------------

describe("E3-d fixed case table: engine", () => {
  test("kT/q at 300 K is the brief's 0.025852 V to six figures", () => {
    expect(thermalVoltage(300)).toBeCloseTo(0.025852, 6);
  });
  test.each([
    ["NA 1e16, ND 1e17, nᵢ 1e10 → Vbi 0.773844 V", () => pnOk().vbi, 0.773844, 1e-6],
    ["→ W 0.331780 µm (εᵣ 11.7)", () => pnOk().w * 1e6, 0.33178, 1e-6],
    ["MOSFET µ 400, tₒₓ 10 nm, εᵣ,ₒₓ 3.9 → Cox 3.45313×10⁻³ F/m²", () => mosOk().cox, 3.45313e-3, 1e-8],
    ["W/L 10, Vov 1 V → Id 0.690627 mA", () => mosOk().id * 1e3, 0.690627, 1e-6],
    ["→ gm 1.38125 mS", () => mosOk().gm * 1e3, 1.38125, 1e-5],
  ])("%s", (_n, f, want, tol) => {
    expect(Math.abs((f as () => number)() - (want as number))).toBeLessThan((tol as number) / 2 + 1e-12);
  });
});

describe("E3-d fixed case table: through SEMICONDUCTOR_CALCS (the pane's objects)", () => {
  test.each([
    ["Vbi 0.773844 V", () => out(run("semi-pn-junction", PN_CASE), "vbi"), 0.773844, 1e-6],
    ["W 0.331780 µm", () => out(run("semi-pn-junction", PN_CASE), "w"), 0.33178, 1e-6],
    ["Cox 3.45313×10⁻³ F/m²", () => out(run("semi-mosfet-square-law"), "cox"), 3.45313e-3, 1e-8],
    ["Id 0.690627 mA", () => out(run("semi-mosfet-square-law"), "id"), 0.690627, 1e-6],
    ["gm 1.38125 mS", () => out(run("semi-mosfet-square-law"), "gm"), 1.38125, 1e-5],
  ])("%s", (_n, f, want, tol) => {
    expect(Math.abs((f as () => number)() - (want as number))).toBeLessThan((tol as number) / 2 + 1e-12);
  });
  test("the text shows the case values and names the nᵢ used", () => {
    const t = run("semi-pn-junction", PN_CASE).text;
    expect(t).toMatch(/Vbi = 0\.773844 V/);
    expect(t).toMatch(/W = 0\.331780 µm/);
    expect(t).toMatch(/nᵢ = 1\.000×10¹⁰ cm⁻³ \(your value\)/);
    const m = run("semi-mosfet-square-law").text;
    expect(m).toMatch(/0\.00345313 F\/m²/);
    expect(m).toMatch(/ID = 0\.690627 mA/);
    expect(m).toMatch(/gm = 1\.38125 mS/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Further oracle rows
// ---------------------------------------------------------------------------------------------------------------

describe("oracle rows (scipy, script in the header)", () => {
  test("junction details at 300 K", () => {
    const r = pnOk();
    expect(rel(r.vbi, 0.7738435813203123)).toBeLessThan(1e-9);
    expect(rel(r.w * 1e6, 0.33177986938723053)).toBeLessThan(1e-8);
    expect(rel(r.xn * 1e6, 0.030161806307930045)).toBeLessThan(1e-8);
    expect(rel(r.xp * 1e6, 0.30161806307930045)).toBeLessThan(1e-8);
    expect(rel(r.emax, 4664801.289780095)).toBeLessThan(1e-8);
    expect(rel(r.cj, 0.0003122371398580914)).toBeLessThan(1e-8);
    expect(rel(r.w1 as number, 0.31633969332551326 / 1e6)).toBeLessThan(1e-8);
    expect(r.lightSide).toBe("p");
  });
  test("reverse bias 5 V: W and C′, engine and pane agree", () => {
    const r = pnOk({ vr: 5 });
    expect(rel(r.w * 1e6, 0.9062665416942893)).toBeLessThan(1e-8);
    expect(rel(r.cj, 0.00011430853144626554)).toBeLessThan(1e-8);
    expect(rel(cjAt(PN, r.vbi, 5), 0.00011430853144626554)).toBeLessThan(1e-8);
    expect(rel(out(run("semi-pn-junction", { ...PN_CASE, vr: "5 V" }), "cj"), 0.00011430853144626554)).toBeLessThan(1e-8);
  });
  test("Si preset (nᵢ 9.65×10⁹, Altermatt 2003) is the default and is cited", () => {
    const o = run("semi-pn-junction");
    expect(rel(out(o, "vbi"), 0.7756856488979564)).toBeLessThan(1e-9);
    expect(rel(out(o, "w"), 0.33217452128031627)).toBeLessThan(1e-8);
    expect(o.text).toMatch(/9\.650×10⁹ cm⁻³ \(Si at 300 K: Altermatt et al\., J\. Appl\. Phys\. 93, 1598 \(2003\)\)/);
    expect(MATERIALS.si).toMatchObject({ eg: 1.12, nc: 3.2e19, nv: 1.8e19, ni: 9.65e9, epsR: 11.7 });
    expect(MATERIALS.gaas).toMatchObject({ eg: 1.424, nc: 4.7e17, nv: 9.0e18, ni: 2.1e6, epsR: 12.9 });
  });
  test("GaAs presets: p⁺n with NA 1e17, ND 1e16", () => {
    const o = run("semi-pn-junction", { mat: "gaas", na: "1e17", nd: "1e16" });
    expect(rel(out(o, "vbi"), 1.2116938878239814)).toBeLessThan(1e-9);
    expect(rel(out(o, "w"), 0.4359350839809863)).toBeLessThan(1e-8);
    expect(o.text).toMatch(/p⁺n/);
  });
  test("one-sided n⁺p junction (NA 5e17, ND 1e15)", () => {
    const r = pnOk({ na: 5e17, nd: 1e15 });
    expect(rel(r.vbi, 0.7559243405565081)).toBeLessThan(1e-9);
    expect(rel(r.w * 1e6, 0.9896921431605812)).toBeLessThan(1e-8);
    expect(rel((r.w1 as number) * 1e6, 0.9887039330857271)).toBeLessThan(1e-8);
    expect(r.lightSide).toBe("n");
  });
  test("comparable dopings: no one-sided form", () => {
    expect(pnOk({ na: 1e16, nd: 5e16 }).w1).toBeNull();
  });
  test("T 350 K with nᵢ typed", () => {
    expect(rel(out(run("semi-pn-junction", { T: "350 K", ni: "4e11" }), "vbi"), 0.6802993862005047)).toBeLessThan(1e-8);
  });
  test("Shockley diode", () => {
    const a = shockley(1e-14, 1, 0.6, 300);
    const b = shockley(1e-12, 2, 0.7, 300);
    const c = shockley(1e-14, 1, -1, 300);
    if (!a.ok || !b.ok || !c.ok) throw new Error("diode");
    expect(rel(a.current, 0.00012010369553128491)).toBeLessThan(1e-8);
    expect(rel(b.current, 7.581246947925479e-7)).toBeLessThan(1e-8);
    expect(rel(c.current, -1e-14)).toBeLessThan(1e-9);
    expect(rel(out(run("semi-pn-junction"), "i"), 0.00012010369553128491)).toBeLessThan(1e-8);
    expect(rel(out(run("semi-pn-junction", { is: "10 fA" }), "i"), 0.00012010369553128491)).toBeLessThan(1e-8);
  });
  test.each([
    ["λ 0.05, VDS 2 (saturation)", { lambda: 0.05, vds: 2 }, 0.75968931485304, 1.51937862970608, 34.53133249332001, "saturation"],
    ["λ 0, VDS 0.4 (triode)", { vds: 0.4 }, 0.44200105591449607, 0.5525013198931201, 828.75197983968, "triode"],
    ["λ 0.05, VDS 0.4 (triode)", { lambda: 0.05, vds: 0.4 }, 0.450841077032786, 0.5635513462909825, 867.4270722321984, "triode"],
  ])("MOSFET %s", (_n, p, id, gm, gds, region) => {
    const r = mosOk(p as Partial<typeof MOS>);
    expect(r.region).toBe(region);
    expect(rel(r.id * 1e3, id as number)).toBeLessThan(1e-8);
    expect(rel(r.gm * 1e3, gm as number)).toBeLessThan(1e-8);
    expect(rel(r.gds * 1e6, gds as number)).toBeLessThan(1e-8);
  });
  test("MOSFET current is continuous at the saturation edge and gm, gds are its derivatives", () => {
    for (const lambda of [0, 0.05, 0.2]) {
      const a = mosOk({ lambda, vds: 1 - 1e-9 }).id;
      const b = mosOk({ lambda, vds: 1 }).id;
      expect(rel(a, b)).toBeLessThan(1e-7);
      for (const vds of [0.3, 1.7]) {
        const h = 1e-6;
        const r = mosOk({ lambda, vds });
        const dg = (mosOk({ lambda, vds, vgs: 1.5 + h }).id - mosOk({ lambda, vds, vgs: 1.5 - h }).id) / (2 * h);
        const dd = (mosOk({ lambda, vds: vds + h }).id - mosOk({ lambda, vds: vds - h }).id) / (2 * h);
        expect(rel(r.gm, dg)).toBeLessThan(1e-6);
        if (r.gds > 0) expect(rel(r.gds, dd)).toBeLessThan(1e-6);
      }
    }
  });
  test("MOSFET cutoff: ID = 0 and stated", () => {
    const o = run("semi-mosfet-square-law", { vgs: "0.3 V" });
    expect(out(o, "id")).toBe(0);
    expect(o.text).toMatch(/CUTOFF/);
  });
  test("carrier statistics, n-type", () => {
    const o = run("semi-carriers", { ni: "1e10" });
    expect(rel(out(o, "p"), 9999.99999999)).toBeLessThan(1e-9);
    expect(rel(out(o, "efEi"), 0.3571585759940161)).toBeLessThan(1e-9);
    expect(rel(out(o, "sigma"), 2.243047287602964)).toBeLessThan(1e-9);
    expect(rel(out(o, "rho"), 0.44582207674660823)).toBeLessThan(1e-9);
    expect(rel(out(o, "edge"), 0.2086490624836581)).toBeLessThan(1e-9);
  });
  test("carrier statistics, p-type", () => {
    const o = run("semi-carriers", { ni: "1e10", nd: "0", na: "1e17" });
    expect(rel(out(o, "n"), 999.9999999999901)).toBeLessThan(1e-9);
    expect(rel(out(o, "efEi"), -0.4166850053263223)).toBeLessThan(1e-9);
    expect(rel(out(o, "sigma"), 7.209794853000295)).toBeLessThan(1e-9);
    expect(rel(out(o, "edge"), 0.13424831940018242)).toBeLessThan(1e-9);
  });
  test("compensated and near-intrinsic samples", () => {
    const c = carriers({ nd: 3e15, na: 1e15, ni: 9.65e9, tK: 300, mun: 1350, mup: 480, nc: 3.2e19, nv: 1.8e19 });
    if (!c.ok) throw new Error(c.error);
    expect(rel(c.n, 2000000000046561.2)).toBeLessThan(1e-12);
    expect(rel(c.p, 46561.24999891603)).toBeLessThan(1e-9);
    expect(rel(c.efEi, 0.31647242121488656)).toBeLessThan(1e-9);
    expect(rel(c.sigma, 0.43258769119365165)).toBeLessThan(1e-9);
    const z = carriers({ nd: 1e10, na: 0, ni: 1e10, tK: 300, mun: 1400, mup: 450, nc: null, nv: null });
    if (!z.ok) throw new Error(z.error);
    expect(rel(z.n, 16180339887.49895)).toBeLessThan(1e-12);
    expect(rel(z.p, 6180339887.498948)).toBeLessThan(1e-9);
    expect(rel(z.efEi, 0.012440287998671123)).toBeLessThan(1e-9);
  });
  test("the minority carrier survives a doping 10²⁰ times nᵢ (no cancellation to 0)", () => {
    const c = carriers({ nd: 1e18, na: 0, ni: 1e-2, tK: 300, mun: 1, mup: 1, nc: null, nv: null });
    if (!c.ok) throw new Error(c.error);
    expect(rel(c.p, 1e-22)).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Input forms
// ---------------------------------------------------------------------------------------------------------------

describe("input forms", () => {
  test.each([
    ["1×10¹⁶", "1e16"],
    ["1.5 x 10^10", "1.5e10"],
    ["2×10⁻³ A", "2e-3 A"],
    ["1×10^(16) cm^-3", "1e16 cm^-3"],
    ["1e16", "1e16"],
    ["10 nm", "10 nm"],
  ])("sciInput(%p) → %p", (a, b) => {
    expect(sciInput(a)).toBe(b);
  });
  test("a density in m⁻³ converts and is reported", () => {
    const o = run("semi-pn-junction", { ni: "1e16 m^-3", na: "1e22 m^-3", nd: "1e23 m^-3" });
    expect(rel(out(o, "vbi"), 0.7738435813203123)).toBeLessThan(1e-9);
    expect(o.text).toMatch(/Units read:/);
  });
  test("27 °C is within 0.5 K of 300 K, so the presets apply; 50 °C needs a typed nᵢ", () => {
    expect(run("semi-pn-junction", { T: "27 °C" }).ok).not.toBe(false);
    expect(run("semi-pn-junction", { T: "50 °C" }).text).toMatch(/300 K value/);
  });
  test("mobility in m²/(V·s), oxide in Å, λ as V⁻¹", () => {
    const o = run("semi-mosfet-square-law", { mu: "0.04 m^2/(V*s)", tox: "100 Å", lambda: "0 V^-1" });
    expect(rel(out(o, "id"), 0.6906266498664)).toBeLessThan(1e-8);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Named refusals
// ---------------------------------------------------------------------------------------------------------------

describe("named refusals", () => {
  test.each([
    ["semi-pn-junction", { na: "2e19" }, /NA = 2\.00×10¹⁹ cm⁻³ is degenerate: at or above Nv = 1\.80×10¹⁹/],
    ["semi-pn-junction", { mat: "gaas", na: "1e16", nd: "5e17" }, /ND = 5\.00×10¹⁷ cm⁻³ is degenerate: at or above Nc = 4\.70×10¹⁷/],
    ["semi-pn-junction", { mat: "custom" }, /nᵢ is required/],
    ["semi-pn-junction", { mat: "custom", ni: "1e10" }, /εᵣ is required/],
    ["semi-pn-junction", { T: "350 K" }, /300 K value/],
    ["semi-pn-junction", { ni: "1e10", nd: "5e11" }, /must exceed 100·nᵢ/],
    ["semi-pn-junction", { vr: "-1 V" }, /Forward bias is not computed/],
    ["semi-pn-junction", { na: "5 kg" }, /NA: "kg" is not compatible/],
    ["semi-pn-junction", { na: "1e999" }, /not a finite number/],
    ["semi-pn-junction", { na: "" }, /NA: this field is required/],
    ["semi-pn-junction", { na: "0" }, /must be positive/],
    ["semi-pn-junction", { na: "abc" }, /does not start with a number/],
    ["semi-pn-junction", { eps: "eleven" }, /εᵣ: "eleven" is not a number/],
    ["semi-pn-junction", { vd: "30 V" }, /beyond the range evaluated/],
    ["semi-pn-junction", { nid: "0.5" }, /ideality factor/],
    ["semi-pn-junction", { vd: "" }, /Diode bias: give the bias/],
    ["semi-pn-junction", { T: "0 K", ni: "1e10" }, /Temperature must lie between/],
    ["semi-pn-junction", { mat: "ge" }, /not one of the choices/],
    ["semi-mosfet-square-law", { vds: "-1 V" }, /VDS must be zero or positive/],
    ["semi-mosfet-square-law", { lambda: "2" }, /λ must lie between 0 and 1/],
    ["semi-mosfet-square-law", { tox: "10 kg" }, /Oxide thickness: "kg" is not compatible/],
    ["semi-mosfet-square-law", { tox: "0 nm" }, /oxide thickness must be positive/],
    ["semi-mosfet-square-law", { epsox: "" }, /it is your process's value/],
    ["semi-mosfet-square-law", { wl: "ten" }, /W\/L: "ten" is not a number/],
    ["semi-mosfet-square-law", { vgs: "1e9 V" }, /Voltages above 1000 V are refused/],
    ["semi-mosfet-square-law", { mu: "400 cm" }, /Mobility: "cm" is not compatible/],
    ["semi-carriers", { nd: "4e19" }, /n = 4\.00×10¹⁹ cm⁻³ is degenerate: at or above Nc/],
    ["semi-carriers", { nd: "0", na: "1.8e19" }, /p = 1\.80×10¹⁹ cm⁻³ is degenerate: at or above Nv/],
    ["semi-carriers", { nd: "-1e16" }, /cannot be negative/],
    ["semi-carriers", { mun: "0" }, /mobilities must be positive/],
    ["semi-carriers", { mat: "custom" }, /nᵢ is required/],
  ])("%s %j → refused", (id, over, re) => {
    const o = run(id, over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
  });
  test("within 3kT of a band edge: computed, with the caution (Si NA 1e18, GaAs ND 1e17, Si n 1e19)", () => {
    const a = run("semi-pn-junction", { na: "1e18" });
    expect(a.ok).not.toBe(false);
    expect(rel(out(a, "vbi"), 0.89473850756262)).toBeLessThan(1e-9);
    expect(rel(out(a, "w"), 0.11281620952486975)).toBeLessThan(1e-8);
    expect(a.text).toMatch(/Caution: NA = 1\.00×10¹⁸ cm⁻³ puts the Fermi level 2\.9 kT from the valence band edge/);
    expect(a.text).toMatch(/treat these numbers as approximate/);
    const b = run("semi-pn-junction", { mat: "gaas", na: "1e16", nd: "1e17" });
    expect(b.ok).not.toBe(false);
    expect(rel(out(b, "vbi"), 1.2116938878239814)).toBeLessThan(1e-9);
    expect(rel(out(b, "w"), 0.4359350839809863)).toBeLessThan(1e-8);
    expect(b.text).toMatch(/Caution: ND = 1\.00×10¹⁷ cm⁻³ puts the Fermi level 1\.5 kT from the conduction band edge/);
    const c = run("semi-carriers", { nd: "1e19" });
    expect(c.ok).not.toBe(false);
    expect(rel(out(c, "efEi"), 0.5366588977798076)).toBeLessThan(1e-9);
    expect(rel(out(c, "sigma"), 2243.0472876)).toBeLessThan(1e-9);
    expect(rel(out(c, "edge"), 0.03006977448668878)).toBeLessThan(1e-9);
    expect(c.text).toMatch(/Caution: n = 1\.00×10¹⁹ cm⁻³ puts the Fermi level 1\.2 kT from the conduction band edge/);
    expect(c.text).not.toMatch(/Non-degenerate range checked/);
    expect(run("semi-pn-junction").text).not.toMatch(/Caution/);
  });
  test("a custom material without Nc, Nv says the degeneracy check was not made", () => {
    const o = run("semi-carriers", { mat: "custom", ni: "1e10" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/Degeneracy NOT checked/);
  });
  test("engine guards: non-finite and degenerate inputs", () => {
    expect(pnJunction({ ...PN, na: NaN }).ok).toBe(false);
    expect(pnJunction({ ...PN, vr: Infinity }).ok).toBe(false);
    expect(mosfet({ ...MOS, mu: NaN }).ok).toBe(false);
    expect(carriers({ nd: Infinity, na: 0, ni: 1e10, tK: 300, mun: 1, mup: 1, nc: null, nv: null }).ok).toBe(false);
    expect(shockley(1e-14, 1, NaN, 300).ok).toBe(false);
    expect(shockley(0, 1, 0.6, 300).ok).toBe(false);
  });
  test("huge but legal magnitudes stay finite (no NA·ND overflow)", () => {
    const r = pnJunction({ ...PN, na: 1e200, nd: 1e200, ni: 1e190, nc: null, nv: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number.isFinite(r.vbi) && Number.isFinite(r.w)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Display contract and figures
// ---------------------------------------------------------------------------------------------------------------

const OK_RUNS: Array<[string, Record<string, string>]> = [
  ["semi-pn-junction", {}],
  ["semi-pn-junction", PN_CASE],
  ["semi-pn-junction", { ...PN_CASE, vr: "5 V", is: "" }],
  ["semi-pn-junction", { mat: "gaas", na: "1e17", nd: "1e16", vd: "-1 V" }],
  ["semi-pn-junction", { na: "5e17", nd: "1e15", vr: "40 V", is: "2 fA", nid: "1.8", vd: "0.8 V" }],
  ["semi-pn-junction", { na: "1e22 m^-3", nd: "1e23 m^-3", T: "27 °C" }],
  ["semi-mosfet-square-law", {}],
  ["semi-mosfet-square-law", { lambda: "0.05", vds: "0.4" }],
  ["semi-mosfet-square-law", { vgs: "0.3" }],
  ["semi-mosfet-square-law", { mu: "50", wl: "1000", vgs: "12 V", vth: "2 V", vds: "20 V", lambda: "0.01" }],
  ["semi-mosfet-square-law", { mu: "600", wl: "0.5", vgs: "0.6", vth: "0.45", vds: "0.05", tox: "2 nm" }],
  ["semi-carriers", {}],
  ["semi-carriers", { nd: "0", na: "1e17" }],
  ["semi-carriers", { nd: "0", mat: "custom", ni: "1e10" }],
  ["semi-carriers", { mat: "gaas", nd: "1e16", mun: "8000", mup: "400" }],
  ["semi-carriers", { nd: "3e15", na: "1e15" }],
  ["semi-pn-junction", { na: "1e18" }],
  ["semi-pn-junction", { mat: "gaas", na: "1e16", nd: "1e17" }],
  ["semi-carriers", { nd: "1e19" }],
];

describe("display contract on every ok result", () => {
  test.each(OK_RUNS)("%s %j", (id, over) => {
    const o = run(id, over);
    expect(o.ok).not.toBe(false);
    const t = o.text;
    expect(t).not.toMatch(/NaN|Infinity|undefined|\u2014/);
    expect(t).not.toMatch(/\d[eE][+-]?\d/);
    expect(t).not.toMatch(/\^/);
    expect(t).not.toMatch(/[A-Za-zα-ωµ]_[A-Za-z0-9]/);
    expect(t).not.toMatch(/(^|[\s(=:,])-\d/m);
    expect(o.outputs!.length).toBeGreaterThan(0);
    for (const v of o.outputs!) expect(Number.isFinite(v.value)).toBe(true);
    const blocks = o.blocks ?? [];
    expect(blocks.some((b) => b.kind === "plot")).toBe(true);
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    expect(blocks.filter((b) => b.kind === "math").length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
      if (b.kind === "plot") {
        expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
        expect(b.svg).toMatch(/Arial|sans-serif/);
        expect(b.svg).not.toMatch(/\d[eE][+-]?\d+<\/text>/);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
      }
      if (b.kind === "table") {
        expect(b.rows[0].length).toBeGreaterThan(1);
        for (const row of b.rows) for (const cell of row) expect(cell).not.toMatch(/NaN|\d[eE][+-]?\d|(^|\s)-\d|[A-Za-zα-ωµ]_[A-Za-z0-9]/);
      }
    }
  });
});

describe("figure builders at their edges", () => {
  test.each([
    ["C–V at 1 kV", () => cvChartSvg({ na: 1e14, nd: 1e19, epsR: 11.7 }, 0.8, 1000)],
    ["I–V near the exponent cap", () => ivChartSvg(1e-20, 1, 0.025852, 1.15)],
    ["I–V reverse point", () => ivChartSvg(1e-9, 2, 0.025852, -5)],
    ["I–V tiny forward bias", () => ivChartSvg(1e-14, 1, 0.025852, 0.001)],
    ["family in cutoff", () => idVdsFamilySvg(1e-3, 0.5, 0, 1, 0)],
    ["family, nA scale", () => idVdsFamilySvg(1e-9, 0.4, 0.45, 0.02, 0.1)],
    ["Fermi, intrinsic, no Nc/Nv", () => fermiChartSvg(1e10, 0.025852, 0, null, null)],
    ["Fermi, GaAs limits", () => fermiChartSvg(2.1e6, 0.025852, -1e15, 4.7e17, 9e18)],
  ])("%s draws a clean SVG", (_n, f) => {
    const svg = (f as () => string)();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
});
