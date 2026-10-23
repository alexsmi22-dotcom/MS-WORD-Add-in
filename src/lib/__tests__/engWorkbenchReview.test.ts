// The v2.191.0 adversarial review of the Engineering workbench, pinned: each describe is one confirmed defect.
import * as fs from "fs";
import * as path from "path";
import type { AnalyzeOutput } from "../analyzeBlocks";
import {
  ENG_HANDOFFS,
  displayValue,
  fieldName,
  fieldText,
  handoffGroupLabel,
  handoffGroups,
  parseUncertainty,
  runSweep,
  runUncertainty,
  uncertaintyReport,
  variableField,
} from "../engWorkbench";
import { LINEAR_OPTICS_CALCS } from "../linearOpticsCalcs";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

describe("a column buckles about the minor axis (review #1)", () => {
  test("Cross-section sends its minor-axis I, never the bending one", () => {
    const row = ENG_HANDOFFS.find((h) => h.from === "section" && h.to === "column" && h.field === "I")!;
    expect(row.output).toBe("Imin");
  });
  test("the section tool declares Imin from the section's own minimum", () => {
    expect(PANE).toMatch(/key: "Imin", label: "Second moment of area \(minor axis\)", value: p\.Imin \* Math\.pow\(toMOut, 4\)/);
  });
});

describe("paired handoffs travel together (review #2)", () => {
  const out: AnalyzeOutput = {
    text: "ok",
    outputs: [
      { key: "A", label: "Area", value: 0.01, unit: "m²" },
      { key: "I", label: "Second moment of area (bending axis)", value: 3.333e-5, unit: "m⁴" },
      { key: "Imin", label: "Second moment of area (minor axis)", value: 2.083e-6, unit: "m⁴" },
      { key: "sigma", label: "Peak bending stress", value: 12, unit: "MPa" },
      { key: "tau", label: "Peak shear stress", value: 1.5, unit: "MPa" },
    ],
  };
  test("one button per target, holding every row for it", () => {
    const g = handoffGroups("section", out);
    expect(g.map((q) => [q.to, q.rows.map((r) => r.field)])).toEqual([
      ["column", ["I", "A"]],
      ["stress", ["sx", "txy"]],
    ]);
    expect(g[0].rows[0].value.value).toBe(2.083e-6);
  });
  test("the combined button names both values", () => {
    const g = handoffGroups("section", out);
    expect(handoffGroupLabel(g[0].rows, "Column buckling")).toBe("Use second moment of area (minor axis) and area in Column buckling");
    expect(handoffGroupLabel(g[0].rows.slice(0, 1), "Column buckling")).toBe(g[0].rows[0].label);
  });
});

describe("uncertainty draws are averaged in one unit (review #3)", () => {
  // A tool that, like the HOM dip, switches to ps past 1000 fs.
  const tool = (read: (k: string) => string): AnalyzeOutput => {
    const x = parseFloat(read("w"));
    return x < 1000
      ? { text: "ok", outputs: [{ key: "y", label: "Width", value: x, unit: "fs" }] }
      : { text: "ok", outputs: [{ key: "y", label: "Width", value: x / 1000, unit: "ps" }] };
  };
  test("990 fs ± 2 % → mean near 990 fs with a 20 fs spread", () => {
    const r = runUncertainty(tool, () => "990 fs", [{ field: "w", u: 2, relative: true }], "y", 2000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.output.unit).toBe("fs");
    expect(r.mean).toBeGreaterThan(985);
    expect(r.mean).toBeLessThan(995);
    expect(r.sd).toBeGreaterThan(17);
    expect(r.sd).toBeLessThan(23);
    expect(r.hi).toBeLessThan(1040);
  });
  test("a sweep across the switch is converted, not refused", () => {
    const r = runSweep(tool, () => "990 fs", { field: "w", from: "900 fs", to: "1100 fs", points: 5, log: false, output: "y" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.ys.map((v) => Math.round(v))).toEqual([900, 950, 1000, 1050, 1100]);
  });
  test("the real HOM tool: width 990 fs ± 2 % gives a dip width spread of about 2 %", () => {
    const hom = LINEAR_OPTICS_CALCS.find((c) => c.id === "lo-hom")!;
    const defaults: Record<string, string> = {};
    for (const f of hom.fields) defaults[f.key] = f.default;
    defaults.width = "990 fs";
    const centre = hom.compute((k) => defaults[k] ?? "");
    const key = centre.outputs?.find((o) => /fwhm/i.test(o.key))?.key;
    if (!key) return; // the tool names no width output: nothing to check here
    const r = runUncertainty(hom.compute, (k) => defaults[k] ?? "", [{ field: "width", u: 2, relative: true }], key, 400);
    if (!r.ok) throw new Error(r.reason);
    expect(r.sd / r.mean).toBeGreaterThan(0.015);
    expect(r.sd / r.mean).toBeLessThan(0.025);
  });
});

describe("the ± field reads its unit (review #4)", () => {
  test("a unit is converted into the field's unit", () => {
    expect(parseUncertainty("0.1 m", "20 mm")).toEqual({ u: 100, relative: false });
    const f = parseUncertainty("0.5 °F", "20 °C");
    expect("u" in f && Math.abs(f.u - 0.5 / 1.8) < 1e-12).toBe(true);
    expect(parseUncertainty("0.5 K", "20 °C")).toEqual({ u: 0.5, relative: false });
  });
  test("percent in words or as a sign is relative", () => {
    expect(parseUncertainty("2 percent", "20 mm")).toEqual({ u: 2, relative: true });
    expect(parseUncertainty("2 %", "20 mm")).toEqual({ u: 2, relative: true });
    expect(parseUncertainty("0.3", "20 mm")).toEqual({ u: 0.3, relative: false });
  });
  test("a wrong quantity, a negative, and a percentage of °C are refused", () => {
    expect("error" in parseUncertainty("0.5 kg", "20 mm")).toBe(true);
    expect("error" in parseUncertainty("-1", "20 mm")).toBe(true);
    expect("error" in parseUncertainty("1 %", "20 °C")).toBe(true);
    expect("error" in parseUncertainty("1 %", "293.15 K")).toBe(false);
  });
});

describe("only single-number fields can be varied (review #5)", () => {
  test.each([
    ["0.3, 0.6", false],
    ["50, 200", false],
    ["0.6|0⟩ + 0.8i|1⟩", false],
    ["00:10:00;00", false],
    ["0101", false],
    ["2048 2048 2048", false],
    ["12 kN", true],
    ["1e8 /s", true],
    ["5", true],
    ["2 %", true],
    ["1e16 cm^-3", true],
    ["0.5", true],
  ])("%s → %s", (t, ok) => expect(variableField(t)).toBe(ok));
});

describe("refused steps and draws are reported, never NaN or silently cut (review #6)", () => {
  // Refuses at 8 and above, like a load placed beyond the span.
  const tool = (read: (k: string) => string): AnalyzeOutput => {
    const x = parseFloat(read("x"));
    return x >= 8 ? { text: "Outside the span.", ok: false } : { text: "ok", outputs: [{ key: "y", label: "Y", value: 2 * x, unit: "m" }] };
  };
  // Refuses in narrow bands just where the central-difference steps land (5 ± 10⁻⁵ for u = 0.1), almost never a draw.
  const banded = (bands: number[]) => (read: (k: string) => string): AnalyzeOutput => {
    const x = parseFloat(read("x"));
    return bands.some((b) => Math.abs(x - b) < 5e-6) ? { text: "Refused.", ok: false } : { text: "ok", outputs: [{ key: "y", label: "Y", value: 2 * x, unit: "m" }] };
  };
  test("a step refused on one side falls back to a one-sided slope", () => {
    const r = runUncertainty(banded([5.00001]), () => "5", [{ field: "x", u: 0.1, relative: false }], "y", 300);
    if (!r.ok) throw new Error(r.reason);
    expect(r.gum.u).toBeCloseTo(0.2, 6);
  });
  test("steps refused on both sides: the first-order estimate is said to be unavailable, never NaN", () => {
    const r = runUncertainty(banded([5.00001, 4.99999]), () => "5", [{ field: "x", u: 0.1, relative: false }], "y", 300);
    if (!r.ok) throw new Error(r.reason);
    expect(r.gum.unavailable).toEqual(["x"]);
    const text = uncertaintyReport(r, [{ label: "X", text: "5 ± 0.1" }], "Tool", { x: "Span" }).text;
    expect(text).toMatch(/No first-order \(GUM\) estimate: the tool refuses a small step either side of Span/);
    expect(text).not.toMatch(/NaN/);
  });
  test("more than a fifth of the draws refused: the run is refused, not summarised", () => {
    const r = runUncertainty(tool, () => "7.99", [{ field: "x", u: 1, relative: true }], "y", 400);
    expect(r.ok).toBe(false);
  });
  test("a few refused draws are named as a cut-off distribution", () => {
    const r = runUncertainty(tool, () => "7.8", [{ field: "x", u: 1, relative: true }], "y", 1000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.refused).toBeGreaterThan(0);
    const text = uncertaintyReport(r, [{ label: "X", text: "7.8 ± 1 %" }], "Tool", { x: "Load position" }).text;
    expect(text).toMatch(/cut off/);
    expect(text).toMatch(/Load position 100 %/);
    expect(text).not.toMatch(/NaN/);
  });
  test("the run stops at its time budget", () => {
    let t = 0;
    const r = runUncertainty(tool, () => "5", [{ field: "x", u: 1, relative: true }], "y", 2000, 1, 2500, () => (t += 200));
    if (!r.ok) throw new Error(r.reason);
    expect(r.attempted).toBeLessThan(2000);
    expect(r.attempted).toBeGreaterThanOrEqual(20);
  });
  test("the pane refuses a tool too slow to sample instead of freezing on it", () => {
    expect(PANE).toMatch(/if \(per > 100\) return showExplore/);
  });
});

describe("reports are typeset (review #7)", () => {
  test("typed values are shown as numbers with formatted units", () => {
    expect(displayValue("1e-4")).toBe("1.00000×10⁻⁴");
    expect(displayValue("50e6 Pa")).toBe("5.00000×10⁷ Pa");
    expect(displayValue("2 %")).toBe("2.00000 %");
  });
  test.each([
    ["Fracture toughness K_IC, Pa·√m (MPa·√m, ksi·√in)", "Fracture toughness KIC"],
    ["Span, m", "Span"],
    ["Second moment of area (minor axis), m^4 (typed source)", "Second moment of area (minor axis)"],
    ["Bending moment, e.g. 12 kN·m (blank to skip)", "Bending moment"],
    ["Photon duration: intensity FWHM w (fs)", "Photon duration: intensity FWHM w (fs)"],
    ["Mode — option", "Mode - option"],
  ])("field name %s → %s", (label, name) => expect(fieldName(label)).toBe(name));
  test("field text writes superscript exponents as one caret run", () => {
    expect(fieldText(1e16, "cm⁻³")).toBe("10000000000000000 cm^-3");
    expect(fieldText(2, "m²")).toBe("2 m^2");
    expect(fieldText(3, "kg·m⁻²")).toBe("3 kg*m^-2");
  });
});

describe("shared fields carry over in the pane (review #8)", () => {
  test("the change handler keeps the old tool's values from before the new fields render", () => {
    const i = PANE.indexOf("engineeringCalcSelect.addEventListener(\"change\"");
    const body = PANE.slice(i, i + 900);
    const snap = body.indexOf("const fromValues = lastEngFieldValues;");
    const render = body.indexOf("renderEngineeringInputs();");
    expect(snap).toBeGreaterThan(0);
    expect(snap).toBeLessThan(render);
    expect(body).toMatch(/carryEngFields\(fromId, fromValues\)/);
  });
});
