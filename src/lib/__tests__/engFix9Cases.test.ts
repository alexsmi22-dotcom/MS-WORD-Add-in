// Fix round eng-9: review defects in gas dynamics, link budget, transmission lines, lasers, vessels and Hertz contact.
// Every row is pinned through the calculator the pane registers (and the engine where the defect lived there), and
// every OK result must satisfy the display contract: no caret, no e-notation, no underscore pseudo-subscript, no
// NaN / Infinity / "not finite".
import { GAS_DYNAMICS_CALCS } from "../gasDynamicsCalcs";
import { LINK_BUDGET_CALCS } from "../linkBudgetCalcs";
import { TLINE_CALCS } from "../tlineCalcs";
import { LASER_CALCS } from "../laserCalcs";
import { VESSELS_CALCS } from "../vesselsCalcs";
import { fanno, rayleigh } from "../gasDynamics";
import { linkBudget, kTBdBm } from "../linkBudget";
import { hasNonFinite, refuseNonFinite } from "../finiteResult";
import type { AnalyzeOutput } from "../analyzeBlocks";

type Calc = { id: string; fields: Array<{ key: string; default: string }>; compute: (r: (k: string) => string) => AnalyzeOutput };
const ALL: Calc[] = [...GAS_DYNAMICS_CALCS, ...LINK_BUDGET_CALCS, ...TLINE_CALCS, ...LASER_CALCS, ...VESSELS_CALCS] as unknown as Calc[];

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = ALL.find((x) => x.id === id);
  if (!c) throw new Error(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}

/** Display-contract violations in a shown string (ok results AND refusals). */
function contractBreaks(text: string): string[] {
  const out: string[] = [];
  if (/\^/.test(text)) out.push("caret");
  if (/\d[eE][+-]?\d/.test(text)) out.push("e-notation");
  if (/\bnot finite\b|(?<![\p{L}\p{N}])(?:NaN|Infinity)(?![\p{L}\p{N}])/u.test(text)) out.push("non-finite");
  return out;
}

describe("1. gas dynamics: Fanno/Rayleigh lower Mach bound and refusal wording", () => {
  test("Fanno at M₁ = 1×10⁻¹⁶⁰ is refused by name (it reported an exactly choked exit)", () => {
    const e = fanno(1e-160, 0.8, 1.4);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error).toMatch(/below 10⁻⁶, the smallest inlet Mach number/);
    const o = run("gd-fanno", { M1: "1e-160" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/below 10⁻⁶/);
    expect(o.text).not.toMatch(/exactly choked/);
    expect(contractBreaks(o.text)).toEqual([]);
  });

  test("Fanno at M₁ = 10⁻⁶ (the floor) still computes, finite", () => {
    const o = run("gd-fanno", { M1: "1e-6" });
    expect(o.ok).not.toBe(false);
    expect(hasNonFinite(o)).toBe(false);
  });

  test("Fanno at M₁ = 1 with friction: choked, and the refusal does not call the flow supersonic", () => {
    const o = run("gd-fanno", { M1: "1" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/at M₁ = 1 the flow is already at the sonic \(choking\) state/);
    expect(o.text).not.toMatch(/supersonic/);
  });

  test("Rayleigh: heating a tiny subsonic inlet is not called cooling", () => {
    const e = rayleigh(1e-9, 2, 1.4);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error).not.toMatch(/Cooling/);
    // At the floor, a heating ratio that is still too small to reach the search floor is worded neutrally.
    const o = run("gd-rayleigh", { M1: "1e-9", ratio: "2" });
    expect(o.ok).toBe(false);
    expect(o.text).not.toMatch(/Cooling/);
    expect(o.text).toMatch(/below 10⁻⁶/);
  });

  test("Rayleigh: real cooling below the floor still says cooling", () => {
    const e = rayleigh(1e-5, 1e-6, 1.4);
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.error).toMatch(/^Cooling by T₀₂\/T₀₁/);
  });

  test("Rayleigh at M₁ = 1 with heating: thermally choked, not 'a shock forms'", () => {
    const o = run("gd-rayleigh", { M1: "1", ratio: "1.2" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/at M₁ = 1 the flow is already at the sonic \(thermally choked\) state/);
    expect(o.text).not.toMatch(/shock/);
  });

  test("normal shock at p₁ = 10³⁰⁸ Pa: named refusal, never 'not finite' in an OK result", () => {
    const o = run("gd-normal-shock", { p1: "1e308" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/overflowed or underflowed/);
  });
});

describe("2. link budget: the range at sensitivity respects the far field", () => {
  const BASE = { ptDbm: 20, gtDbi: 6, grDbi: 6, fHz: 2.4e9, dM: 1000, txLossDb: 0, rxLossDb: 0, otherLossDb: 0, sensDbm: -90 };

  test("a range under 2λ is not stated (it said 'would reach 0.03957 m' with λ = 0.125 m)", () => {
    // Pr at 1 km ≈ −68.05 dBm; a +30 dBm sensitivity gives margin −98.05 dB and a Friis "range" of 1 km × 10^(−98.05/20)
    // ≈ 0.0125 m, well inside 2λ = 0.25 m at 2.4 GHz.
    const r = linkBudget({ ...BASE, sensDbm: 30 });
    if (!r.ok) throw new Error(r.error);
    expect(r.maxRangeM).toBeNull();
    expect(r.rangeInNearField).toBe(true);
    const o = run("rf-link-budget", { sens: "30 dBm" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/under two wavelengths .*near field.*no range is stated/);
    expect(o.text).not.toMatch(/would reach/);
    expect((o.outputs ?? []).some((x) => x.key === "range")).toBe(false);
  });

  test("a far-field range is still stated (−90 dBm: 12.514 km)", () => {
    const r = linkBudget(BASE);
    if (!r.ok) throw new Error(r.error);
    expect(r.rangeInNearField).toBe(false);
    expect(r.maxRangeM as number).toBeCloseTo(12514.0993, 3);
  });

  test("noise cascade at B = 10⁻³²⁰ Hz: named refusal (it printed −Infinity dBm)", () => {
    const o = run("noise-figure-cascade", { bw: "1e-320" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/below 1 µHz/);
    expect(contractBreaks(o.text)).toEqual([]);
  });

  test("kTB in dB cannot underflow: −173.975 dBm/Hz + 10 log₁₀B", () => {
    expect(kTBdBm(290, 1)).toBeCloseTo(-173.975, 2);
    expect(Number.isFinite(kTBdBm(290, 1e-320))).toBe(true);
  });

  test("an echoed out-of-range level uses ×10ⁿ, never e-notation", () => {
    const r = linkBudget({ ...BASE, ptDbm: 1e301 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/1×10³⁰¹ dB/);
      expect(contractBreaks(r.error)).toEqual([]);
    }
  });
});

describe("3. display contract on default paths", () => {
  test("tl-match default: no caret anywhere (the Γ(d) fallback was Γₗ e^(−j4πd/λ))", () => {
    const o = run("tl-match");
    expect(o.ok).not.toBe(false);
    expect(o.text).not.toMatch(/\^/);
    const math = (o.blocks ?? []).filter((b) => b.kind === "math") as Array<{ fallback: string }>;
    for (const m of math) expect(m.fallback).not.toMatch(/\^/);
  });

  test.each(["laser-fabry-perot", "laser-threshold", "laser-coherence", "laser-shg"])(
    "%s default (and with the optional fields): no underscore pseudo-subscripts in shown text",
    (id) => {
      const over: Record<string, string> = id === "laser-shg" ? { deff: "14 pm/V", I: "1e9" } : id === "laser-coherence" ? { dnuc: "4.79536 MHz" } : {};
      for (const o of [run(id), run(id, over)]) {
        expect(o.ok).not.toBe(false);
        expect(o.text).not.toMatch(/[\p{L}](?:_)[\p{L}\p{N}]/u);
        expect(contractBreaks(o.text)).toEqual([]);
        const labels = ALL.find((c) => c.id === id)!.fields.map((f) => (f as unknown as { label: string }).label).join("\n");
        expect(labels).not.toMatch(/[\p{L}]_[\p{L}\p{N}]/u);
      }
    },
  );
});

describe("4. extreme inputs: named refusals, never NaN / Infinity / not finite / e-notation", () => {
  test("laser threshold at L = 10⁻³²⁰ m", () => {
    const o = run("laser-threshold", { L: "1e-320 m" });
    expect(o.ok).toBe(false);
    expect(contractBreaks(o.text)).toEqual([]);
  });

  test("Fabry–Pérot at L = 10⁻³²⁰ m", () => {
    const o = run("laser-fabry-perot", { L: "1e-320 m" });
    expect(o.ok).toBe(false);
    expect(contractBreaks(o.text)).toEqual([]);
  });

  test("tl-two-port with S₂₁ = 0: 'no transmission' named, no −Infinity dB", () => {
    const o = run("tl-two-port", { s: "S11 0.61 -170\nS21 0 0\nS12 0.05 16\nS22 0.72 -83" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/no transmission \(S₂₁ = 0\)/);
    expect(contractBreaks(o.text)).toEqual([]);
    expect((o.outputs ?? []).every((x) => Number.isFinite(x.value))).toBe(true);
    expect((o.outputs ?? []).some((x) => x.key === "gtuMax")).toBe(false);
  });

  test("thin-wall vessel t/r refusal: ×10ⁿ, not 1e+301", () => {
    const o = run("vessel-thin-wall", { t: "1e301", r: "1" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/t\/r = 1×10³⁰¹/);
    expect(contractBreaks(o.text)).toEqual([]);
  });

  test("Hertz contact patch refusal: ×10ⁿ %, not 4.02e+99 %", () => {
    const o = run("hertz-contact", { F: "1e300" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/×10[⁰¹²³⁴⁵⁶⁷⁸⁹]+ %/);
    expect(contractBreaks(o.text)).toEqual([]);
  });

  test("every calculator default still computes, and no default result trips the non-finite guard", () => {
    for (const c of ALL) {
      const o = run(c.id);
      expect({ id: c.id, ok: o.ok !== false, nonFinite: hasNonFinite(o) }).toEqual({ id: c.id, ok: true, nonFinite: false });
    }
  });
});

describe("refuseNonFinite (the shared guard)", () => {
  test.each([
    ["x = not finite m", true],
    ["Pr = −Infinity dBm", true],
    ["mean NaN", true],
    ["NaN₃ standard, 2.5 µM", false],
    ["no transmission (S₂₁ = 0)", false],
  ])("%s → refused %s", (text, refused) => {
    const o = refuseNonFinite({ text, ok: true });
    expect(o.ok === false).toBe(refused);
  });

  test("a non-finite declared output is refused even when the text is clean", () => {
    expect(refuseNonFinite({ text: "fine", outputs: [{ key: "k", label: "k", value: Infinity, unit: "" }] }).ok).toBe(false);
  });

  test("a refusal passes through untouched", () => {
    const r = { text: "The value is not finite.", ok: false };
    expect(refuseNonFinite(r)).toBe(r);
  });
});
