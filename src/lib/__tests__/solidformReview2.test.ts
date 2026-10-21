// Review round 2 pinned: the step ranges, sampling densities, broad and overlapping events, instrument headers and
// separators the second reviewer found wrong — four of them regressions from the round-1 rework.
import { analyzeSolid, chooseThermalColumns } from "../solidformAnalyze";
import { dscEvents, parsePeakList, parseTable, pickPeaks, tgaSteps, WAVELENGTHS, type XY } from "../solidform";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function gauss(r: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}
const G = (x: number, c: number, s: number) => Math.exp(-((x - c) ** 2) / (2 * s * s));
const L = (T: number, c: number, w: number) => 1 / (1 + Math.exp(-(T - c) / w));
const CU = WAVELENGTHS.CuKa1.a;
const near = (got: number[], want: number[], tol = 0.06) => want.every((w) => got.some((g) => Math.abs(g - w) <= tol)) && got.every((g) => want.some((w) => Math.abs(g - w) <= tol));

describe("XRPD at every step", () => {
  test.each([0.04, 0.05, 0.06, 0.08])("step %s°: the three peaks, never “amorphous”", (step) => {
    for (const noisy of [false, true]) {
      const g = gauss(rng(21));
      const xy: XY[] = [];
      for (let x = 3; x <= 40 + 1e-9; x += step) {
        const y = 150 + 1800 * G(x, 6.8, 0.1 / 2.355) + 2400 * G(x, 17.2, 0.1 / 2.355) + 1500 * G(x, 21.3, 0.1 / 2.355);
        xy.push([Math.round(x * 1e4) / 1e4, noisy ? Math.round(y + g() * Math.sqrt(y)) : y]);
      }
      const r = pickPeaks(xy, CU);
      expect([step, noisy, near(r.peaks.map((p) => p.twoTheta), [6.8, 17.2, 21.3])]).toEqual([step, noisy, true]);
      expect(r.amorphous).toBeNull();
    }
  });
  test("thousands separators in a decimal-point file are numbers, not dropped rows", () => {
    const rows: string[] = [];
    for (let x = 3; x <= 40.0001; x += 0.02) {
      const y = Math.round(150 + 2400 * G(x, 17.2, 0.05));
      rows.push(`${x.toFixed(2)}\t${y.toLocaleString("en-US")}`);
    }
    const t = parseTable(rows.join("\n"));
    expect(t.rows.length).toBe(rows.length);
    const r = analyzeSolid("xrpd", rows.join("\n"));
    expect(r.ok && near(r.peaks.map((p) => p.twoTheta), [17.2])).toBe(true);
    expect(parsePeakList("6.8 1,800\n9.4 650\n13.6 1,200", CU).peaks.map((p) => Math.round(p.rel))).toEqual([100, 36, 67]);
  });
  test("“5,2” lines alone are ambiguous: read one way, and the note says how to get the other", () => {
    const r = parsePeakList("5,2\n10,4\n15,6", CU);
    expect(r.notes.join(" ")).toMatch(/decimal comma/i);
  });
  test("Kα2 shoulders are dropped only for unstripped Cu Kα, never for Cu Kα1 (stripped or monochromated)", () => {
    const xy: XY[] = [];
    for (let x = 50; x <= 70.0001; x += 0.01) xy.push([Math.round(x * 100) / 100, 100 + 3000 * G(x, 60, 0.04) + 1500 * G(x, 60.164, 0.04)]);
    expect(pickPeaks(xy, CU, { wavelength: "CuKa1" }).peaks.length).toBe(2);
    expect(pickPeaks(xy, WAVELENGTHS.CuKa.a, { wavelength: "CuKa" }).peaks.length).toBe(1);
  });
});

describe("DSC at any sampling, with broad and neighbouring events", () => {
  const melt = (T: number) => -0.05 - 0.0006 * (T - 30) - 2.4 * G(T, 186, 1.6);
  test("a melt sampled every 0.01 °C is one endotherm at μ − 2σ", () => {
    const xy: XY[] = [];
    for (let T = 30; T <= 250 + 1e-9; T += 0.01) xy.push([T, melt(T)]);
    const r = dscEvents(xy, true);
    expect(r.events.map((e) => e.kind)).toEqual(["endotherm"]);
    expect(Math.abs((r.events[0].onset ?? NaN) - 182.8)).toBeLessThan(0.3);
  });
  test.each([
    [5, 0.4],
    [8, 0.8],
    [12, 1.2],
  ])("a broad desolvation (σ %s, depth %s) is an endotherm near 110 °C, then the melt", (sd, depth) => {
    const xy: XY[] = [];
    for (let T = 30; T <= 250; T += 0.5) xy.push([T, -0.05 - depth * G(T, 110, sd) - 2.4 * G(T, 186, 1.6)]);
    const r = dscEvents(xy, true);
    expect(r.events.map((e) => e.kind)).toEqual(["endotherm", "endotherm"]);
    expect(Math.abs(r.events[0].peak - 110)).toBeLessThan(1.5);
  });
  test("a desolvation overlapping the melt is two endotherms", () => {
    const xy: XY[] = [];
    for (let T = 30; T <= 250; T += 0.5) xy.push([T, -0.05 - 0.6 * G(T, 160, 10) - 2.4 * G(T, 186, 1.6)]);
    expect(dscEvents(xy, true).events.filter((e) => e.kind === "endotherm").length).toBe(2);
  });
  test("melt, recrystallisation, melt: endotherm, exotherm, endotherm", () => {
    const xy: XY[] = [];
    for (let T = 100; T <= 250; T += 0.5) xy.push([T, -0.05 - 1.5 * G(T, 160, 1.5) + 1.0 * G(T, 168, 2) - 2.0 * G(T, 195, 1.6)]);
    expect(dscEvents(xy, true).events.map((e) => e.kind)).toEqual(["endotherm", "exotherm", "endotherm"]);
  });
  test("a glass transition before a melt is still a step", () => {
    const xy: XY[] = [];
    for (let T = 60; T <= 200; T += 0.5) xy.push([T, -0.05 - 0.08 * L(T, 120, 1.5) - 2.4 * G(T, 140, 1.6)]);
    const kinds = dscEvents(xy, true).events.map((e) => e.kind);
    expect(kinds).toContain("step");
    expect(kinds).toContain("endotherm");
  });
});

describe("TGA speed and small or unfinished steps", () => {
  test("20 000 points in well under a second", () => {
    const xy: XY[] = [];
    for (let i = 0; i < 20000; i++) {
      const T = 30 + i * 0.016;
      xy.push([T, 100 - 4.6 * L(T, 105, 6) - 58 * L(T, 290, 9)]);
    }
    const t0 = Date.now();
    tgaSteps(xy);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  test.each([0.5, 1])("a %s %% loss beside a 60 %% decomposition is reported", (small) => {
    const xy: XY[] = [];
    for (let T = 30; T <= 450; T += 0.5) xy.push([T, 100 - small * L(T, 70, 4) - 60 * L(T, 320, 10)]);
    const r = tgaSteps(xy);
    expect(r.steps.length).toBe(2);
    expect(Math.abs(r.steps[0].loss - small)).toBeLessThan(0.2);
  });
  test("a trace that ends mid-step reports the step so far, and says it is unfinished", () => {
    const xy: XY[] = [];
    for (let T = 30; T <= 300; T += 0.5) xy.push([T, 100 - 3 * L(T, 100, 6) - 50 * L(T, 300, 10)]);
    const r = tgaSteps(xy);
    expect(r.steps.length).toBe(2);
    expect(r.notes.join(" ")).toMatch(/ends? (during|before the end of)|unfinished|still/i);
  });
});

describe("instrument headers", () => {
  const rows = (n: number) => Array.from({ length: 30 }, (_, i) => Array.from({ length: n }, (_, c) => c + i).map(String));
  test.each([
    [["t [s]", "Ts [°C]", "Tr [°C]", "Value [mW]"], 1, 3],
    [["t (s)", "Tsample (C)", "Tref (C)", "HF (mW)"], 1, 3],
    [["Index", "t", "Ts", "Value"], 2, 3],
    [["Time (min)", "Temperature (°C)", "Heat Flow (W/g)"], 1, 2],
  ])("DSC %j: temperature column %s, signal column %s", (h, x, y) => {
    const c = chooseThermalColumns(h, rows(h.length).map((r) => r.map(Number)), "dsc", {});
    expect([c.x, c.y]).toEqual([x, y]);
  });
  test("TGA: the weight column, not its derivative", () => {
    const h = ["Time (min)", "Temperature (°C)", "Deriv. Weight (%/°C)", "Weight (%)"];
    const c = chooseThermalColumns(h, rows(4).map((r) => r.map(Number)), "tga", {});
    expect([c.x, c.y]).toEqual([1, 3]);
  });
  test("the heat-flow unit comes from the header when the user has not typed one", () => {
    const lines = ["Temperature (°C)\tHeat Flow (mW)"];
    for (let T = 30; T <= 250; T += 0.5) lines.push(`${T}\t${(-0.05 - 2.4 * G(T, 186, 1.6)).toFixed(5)}`);
    const r = analyzeSolid("dsc", lines.join("\n"), { unitsFromHeader: true });
    expect(r.ok && r.svg).toContain("Heat flow (mW)");
  });
});
