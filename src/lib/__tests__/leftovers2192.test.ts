// v2.192.0: the four leftovers named when v2.191.0 shipped, each pinned.
import type { AnalyzeOutput } from "../analyzeBlocks";
import { runUncertainty } from "../engWorkbench";
import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";
import { norm2Text, parseKet } from "../quantumCore";
import { QUANTUM_DIRAC_CALCS } from "../quantumDiracCalcs";

describe("a vanishingly small state shows its norm, never 0", () => {
  test.each([
    [1, "1"],
    [Math.SQRT2, "2"],
    [Math.SQRT2 * 1e-200, "2×10⁻⁴⁰⁰"],
    [3e-160, "9×10⁻³²⁰"],
    [1e-5, "1×10⁻¹⁰"],
  ])("‖ψ‖ = %s → ‖ψ‖² %s", (n, t) => expect(norm2Text(n)).toBe(t));

  test("the states tool says ‖ψ‖² = 2×10⁻⁴⁰⁰ for amplitudes of 10⁻²⁰⁰", () => {
    const tool = QUANTUM_DIRAC_CALCS.find((c) => c.id === "qc-dirac-states")!;
    const d: Record<string, string> = {};
    for (const f of tool.fields) d[f.key] = f.default;
    d.psi = "1e-200|0⟩ + 1e-200|1⟩";
    const out = tool.compute((k) => d[k] ?? "");
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/‖ψ‖² as typed = 2×10⁻⁴⁰⁰/);
    expect(out.text).not.toMatch(/divided by 0\b/);
  });

  test("the ket reader's note names the real norm", () => {
    const k = parseKet("1e-200|0⟩ + 1e-200|1⟩");
    if ("error" in k) throw new Error(k.error);
    expect(k.notes.join(" ")).toMatch(/‖ψ‖² = 2×10⁻⁴⁰⁰/);
  });
});

describe("a stray space in an exponent does not change the formula", () => {
  test("x^- 1 is x⁻¹, as x^-1 is", () => {
    expect(mathToOmml("x^- 1")).toBe(mathToOmml("x^-1"));
  });
  test("a sign label followed by a symbol stays a label", () => {
    expect(mathToHtml("Phi^+ + Psi^-")).toContain("Ψ");
    expect(mathToHtml("sigma_+ sigma_-")).not.toMatch(/<sub>[^<]*σ/);
  });
});

describe("the equation preview shows a true minus", () => {
  test.each(["a - b", "-x", "x^-1"])("%s", (m) => {
    const h = mathToHtml(m);
    expect(h).toContain("−");
    expect(h).not.toMatch(/>-</);
  });
});

describe("angle outputs are not split across the ±180° seam", () => {
  const tool = (read: (k: string) => string): AnalyzeOutput => {
    const a = parseFloat(read("a"));
    const w = ((((a + 180) % 360) + 360) % 360) - 180;
    return { text: "ok", outputs: [{ key: "yaw", label: "Yaw", value: w, unit: "°" }] };
  };
  test("179° ± 2° spreads about 179°, not about 0°", () => {
    const r = runUncertainty(tool, () => "179", [{ field: "a", u: 2, relative: false }], "yaw", 2000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.mean).toBeGreaterThan(178.5);
    expect(r.mean).toBeLessThan(179.5);
    expect(r.sd).toBeGreaterThan(1.8);
    expect(r.sd).toBeLessThan(2.2);
  });
});

describe("review of v2.192.0", () => {
  test("a mantissa that rounds to 10 carries into the exponent", () => {
    expect(norm2Text(3.1622776e-200)).toBe("1×10⁻³⁹⁹");
    expect(norm2Text(9.9999999e-200)).toBe("1×10⁻³⁹⁸");
  });
  test("a denormal norm keeps its digits through log10norm", () => {
    const k = parseKet("1e-320|0⟩");
    if ("error" in k) throw new Error(k.error);
    // 1e-320 is itself a denormal double (9.99989×10⁻³²¹): the square is reported to that, not 0.4 % off as before.
    expect(norm2Text(k.norm, 6, k.log10norm)).toBe("9.99978×10⁻⁶⁴¹");
  });
  test("a denormal amplitude is normalised, never NaN", () => {
    const tool = QUANTUM_DIRAC_CALCS.find((c) => c.id === "qc-dirac-states")!;
    const d: Record<string, string> = {};
    for (const f of tool.fields) d[f.key] = f.default;
    d.psi = "1e-310|0⟩ + 1e-310|1⟩";
    const out = tool.compute((k) => d[k] ?? "");
    expect(out.text).not.toMatch(/NaN/);
    if (out.ok !== false) expect(out.text).toMatch(/‖ψ‖² as typed = 2×10⁻⁶²⁰/);
  });
  test("a squared norm that underflowed is not sent on as 0", () => {
    const tool = QUANTUM_DIRAC_CALCS.find((c) => c.id === "qc-dirac-states")!;
    const d: Record<string, string> = {};
    for (const f of tool.fields) d[f.key] = f.default;
    d.psi = "1e-200|0⟩ + 1e-200|1⟩";
    const out = tool.compute((k) => d[k] ?? "");
    const o = out.outputs?.find((q) => q.key === "normPsi2");
    expect(o === undefined || !Number.isFinite(o.value)).toBe(true);
  });
  test("a typed true minus after a caret is a minus (x^− 1, x^−1, −x)", () => {
    expect(mathToOmml("x^− 1")).toBe(mathToOmml("x^-1"));
    expect(mathToOmml("x^−1")).toBe(mathToOmml("x^-1"));
    expect(() => mathToOmml("−x")).not.toThrow();
  });
  test("an angle far outside one turn is not folded", () => {
    const twist = (read: (k: string) => string): AnalyzeOutput => ({ text: "ok", outputs: [{ key: "phi", label: "Twist", value: parseFloat(read("a")), unit: "°" }] });
    const r = runUncertainty(twist, () => "3000", [{ field: "a", u: 150, relative: false }], "phi", 2000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.sd).toBeGreaterThan(140);
    expect(r.sd).toBeLessThan(160);
  });
});
