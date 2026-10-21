// The Solid form tool's entry point: the examples read back what was put into them, a typed list and a measured
// pattern take their own paths, the figures are black line art that a style can re-render, and refusals say why.
import { analyzeSolid, solidExample } from "../solidformAnalyze";
import { xrpdChartSvg } from "../solidformChart";
import { prepareFigure } from "../insertCapability";

const ok = (r: ReturnType<typeof analyzeSolid>) => {
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r;
};

describe("analyzeSolid", () => {
  test("XRPD example: every synthetic reflection is found at its own 2θ, and the claim cites the five strongest by angle", () => {
    const r = ok(analyzeSolid("xrpd", solidExample("xrpd"), { subject: "Crystalline Form A" }));
    expect(r.source).toBe("pattern");
    expect(r.peaks.map((p) => Number(p.twoTheta.toFixed(1)))).toEqual([6.8, 9.4, 13.6, 15.1, 17.2, 18.9, 21.3, 24.0, 25.6, 27.5]);
    expect(r.rows[0]).toEqual(["2θ (°)", "d (Å)", "Relative intensity (%)"]);
    // Bragg with Cu Kα1: d(17.2°) = 1.540598 / (2 sin 8.6°) = 5.15 Å.
    expect(r.rows.find((x) => x[0] === "17.2")).toEqual(["17.2", "5.15", "100"]);
    expect(r.text).toBe(
      "Crystalline Form A, characterized by an X-ray powder diffraction pattern comprising peaks at 2θ angles of about 6.8°, 13.6°, 17.2°, 18.9° and 21.3° ± 0.2° 2θ, measured with Cu Kα1 radiation.",
    );
  });
  test("a typed peak list is a list, not a pattern: no peak picking, intensities kept as given", () => {
    const r = ok(analyzeSolid("xrpd", "6.8 100\n13.6 40\n17.2 80", { cite: 3 }));
    expect(r.source).toBe("list");
    expect(r.rows.slice(1).map((x) => x[2])).toEqual(["100", "40", "80"]);
    expect(r.text).toMatch(/about 6\.8°, 13\.6° and 17\.2° ± 0\.2° 2θ/);
  });
  test("angles alone, comma separated, still make a claim and a stick figure", () => {
    const r = ok(analyzeSolid("xrpd", "5.2, 10.4, 15.6"));
    expect(r.text).toMatch(/about 5\.2°, 10\.4° and 15\.6°/);
    expect(r.svg).toMatch(/Peak positions/);
  });
  test("the wavelength changes d, and the axis says which radiation", () => {
    const r = ok(analyzeSolid("xrpd", "20 100", { wavelength: "MoKa1" }));
    // 0.7093 / (2 sin 10°) = 2.04 Å.
    expect(r.rows[1][1]).toBe("2.04");
    expect(r.svg).toContain("2θ (°), Mo Kα1");
    expect(r.text).toMatch(/Mo Kα1 radiation/);
  });
  test("a tolerance under ±0.1° prints angles to 0.01°", () => {
    const r = ok(analyzeSolid("xrpd", "6.83 100\n13.61 40", { tolerance: 0.05 }));
    expect(r.rows[1][0]).toBe("6.83");
    expect(r.text).toMatch(/6\.83° and 13\.61° ± 0\.05° 2θ/);
  });
  test("DSC example: one endotherm, onset by the tangent before the peak, the axis saying exo up", () => {
    const r = ok(analyzeSolid("dsc", solidExample("dsc"), { subject: "Form A" }));
    expect(r.rows.length).toBe(2);
    const [kind, onset, peak] = r.rows[1];
    expect(kind).toBe("Endotherm");
    // A Gaussian of σ 1.6 at 186 °C: the inflection tangent meets the baseline near μ − 2σ = 182.8 °C.
    expect(Math.abs(Number(onset) - 182.8)).toBeLessThan(0.6);
    expect(Math.abs(Number(peak) - 186)).toBeLessThan(0.6);
    expect(r.svg).toContain("Heat flow (W/g), exo up");
    expect(r.text).toMatch(/^Form A exhibits a differential scanning calorimetry thermogram comprising an endotherm with an onset at about 18\d\.\d °C/);
  });
  test("TGA example: the hydrate's loss and the decomposition, each with its own range", () => {
    const r = ok(analyzeSolid("tga", solidExample("tga")));
    expect(r.rows.length).toBe(3);
    expect(Math.abs(Number(r.rows[1][3]) - 4.6)).toBeLessThan(0.5);
    expect(Math.abs(Number(r.rows[1][4]) - 105)).toBeLessThan(2);
    expect(Math.abs(Number(r.rows[2][3]) - 58)).toBeLessThan(1.5);
    expect(r.svg).toContain("Weight (%)");
  });
  test("TGA in mg: the losses are still % of the starting weight", () => {
    const pct = ok(analyzeSolid("tga", solidExample("tga")));
    const mg = solidExample("tga")
      .split("\n")
      .map((l) => (l.startsWith("#") ? l : `${l.split("\t")[0]}\t${(Number(l.split("\t")[1]) * 0.0521).toFixed(5)}`))
      .join("\n");
    const r = ok(analyzeSolid("tga", mg, { yUnits: "mg" }));
    expect(r.rows.slice(1).map((x) => Math.round(Number(x[3])))).toEqual(pct.rows.slice(1).map((x) => Math.round(Number(x[3]))));
    expect(r.svg).toContain("Weight (% of initial)");
  });
  test("the figures are black line art, and a style's re-render changes the canvas, not the data", () => {
    for (const k of ["xrpd", "dsc", "tga"] as const) {
      const r = ok(analyzeSolid(k, solidExample(k)));
      expect(r.svg).toMatch(/stroke="#000000"/);
      expect(r.svg).not.toMatch(/NaN|Infinity/);
      const wide = r.render(640);
      expect(wide).toMatch(/^<svg[^>]*width="640"/);
      expect(r.svg).toMatch(/^<svg[^>]*width="420"/);
    }
  });
  test("the figures are pure black and white, and the USPTO style takes them (and the journals refit them)", () => {
    for (const k of ["xrpd", "dsc", "tga"] as const) {
      const r = ok(analyzeSolid(k, solidExample(k)));
      const paints = [...r.svg.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]+)"/g)].map((m) => m[1].toLowerCase());
      expect([...new Set(paints)].filter((c) => !["#000", "#000000", "#fff", "#ffffff"].includes(c))).toEqual([]);
      for (const preset of ["uspto", "nature", "acs"] as const) {
        const p = prepareFigure({ svg: r.svg, preset, width: "single", render: r.render, chartKind: `solid-${k}` }, 420, 270);
        expect([k, preset, p.ok ? "ok" : (p as { problems: string[] }).problems.join("; ")]).toEqual([k, preset, "ok"]);
      }
    }
  });
  test("a typed list's outermost sticks stand clear of the frame", () => {
    const svg = xrpdChartSvg(null, [{ twoTheta: 6.8, d: 13, height: 100, rel: 100 }, { twoTheta: 17.2, d: 5.15, height: 80, rel: 80 }], "CuKa1")!;
    const frame = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/.exec(svg)!;
    const [x0, w] = [Number(frame[1]), Number(frame[2])];
    const path = /<path d="([^"]+)" fill="none" stroke="#000000"/.exec(svg)![1];
    const xs = [...path.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThan(x0 + 5);
    expect(Math.max(...xs)).toBeLessThan(x0 + w - 5);
  });
  test("refusals say what to do", () => {
    expect(analyzeSolid("xrpd", "")).toMatchObject({ ok: false, errors: [expect.stringMatching(/paste the data/)] });
    expect(analyzeSolid("xrpd", "6.8 x")).toMatchObject({ ok: false });
    expect(analyzeSolid("xrpd", "200")).toMatchObject({ ok: false, errors: [expect.stringMatching(/between 0 and 180/)] });
    expect(analyzeSolid("dsc", "30 1\n31 1")).toMatchObject({ ok: false });
    expect(analyzeSolid("tga", "hello")).toMatchObject({ ok: false });
  });
  test("examples are deterministic", () => {
    for (const k of ["xrpd", "dsc", "tga"] as const) expect(solidExample(k)).toBe(solidExample(k));
  });
});
