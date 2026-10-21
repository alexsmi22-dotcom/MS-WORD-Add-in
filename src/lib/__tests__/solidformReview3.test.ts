// Review round 3 pinned: phantom opposite peaks under a baseline shift, zero-width events at the scan's ends, dense
// data that took minutes, noisy peaks read as pairs of steps, a TGA sliver, and instrument headers.
import { analyzeSolid, chooseThermalColumns } from "../solidformAnalyze";
import { dscEvents, pickPeaks, tgaSteps, WAVELENGTHS, type XY } from "../solidform";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function gauss(r: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}
const G = (x: number, c: number, s: number) => Math.exp(-((x - c) ** 2) / (2 * s * s));
const L = (T: number, c: number, w: number) => 1 / (1 + Math.exp(-(T - c) / w));
const trace = (from: number, to: number, step: number, f: (T: number) => number, noise = 0, seed = 1): XY[] => {
  const g = gauss(rng(seed));
  const out: XY[] = [];
  for (let T = from; T <= to + 1e-9; T += step) out.push([T, f(T) + noise * g()]);
  return out;
};

describe("DSC: no phantom peaks, no edge events", () => {
  test.each([0.2, 0.4])("a melt on a heat-capacity shift of %s is one endotherm, no exotherm", (h) => {
    const r = dscEvents(trace(100, 220, 0.1, (T) => -G(T, 160, 1.5) - h * L(T, 160, 2)), true);
    expect(r.events.map((e) => e.kind)).toEqual(["endotherm"]);
  });
  test.each([0.1, 0.2])("a Tg with an enthalpic overshoot (%s) never reads as an exotherm", (a) => {
    const r = dscEvents(trace(40, 120, 0.1, (T) => -0.2 * L(T, 80, 1.5) - a * G(T, 82, 1.2)), true);
    expect(r.events.some((e) => e.kind === "exotherm")).toBe(false);
  });
  test("dense noisy traces have no events at the very start or end of the scan", () => {
    let edge = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = dscEvents(trace(25, 250, 0.02, (T) => -G(T, 160, 1.5), 0.01, seed), true);
      edge += r.events.filter((e) => e.peak < 26 || e.peak > 249).length;
      expect(r.events.filter((e) => e.kind === "endotherm" && Math.abs(e.peak - 160) < 1).length).toBe(1);
    }
    expect(edge).toBe(0);
  });
  test("a noisy broad melt is one endotherm, not a pair of steps", () => {
    const r = dscEvents(trace(100, 220, 0.2, (T) => -G(T, 160, 4), 0.02, 3), true);
    expect(r.events.filter((e) => e.kind === "step")).toEqual([]);
    expect(r.events.filter((e) => e.kind === "endotherm").length).toBe(1);
  });
});

describe("speed on dense data", () => {
  test("22 500-point DSC, 22 500-point TGA and a 100 000-point pattern each in about a second", () => {
    let t0 = Date.now();
    dscEvents(trace(25, 250, 0.01, (T) => -G(T, 160, 1.5), 0.01, 5), true);
    expect(Date.now() - t0).toBeLessThan(2500);
    t0 = Date.now();
    tgaSteps(trace(30, 255, 0.01, (T) => 100 - 4.6 * L(T, 105, 6) - 58 * L(T, 200, 9), 0.01, 6));
    expect(Date.now() - t0).toBeLessThan(2500);
    const xy: XY[] = [];
    for (let i = 0; i < 100000; i++) {
      const x = 3 + i * 0.00037;
      xy.push([x, 150 + 2000 * G(x, 17.2, 0.04)]);
    }
    t0 = Date.now();
    const r = pickPeaks(xy, WAVELENGTHS.CuKa1.a);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.peaks.length).toBe(1);
  });
});

describe("TGA slivers and headers", () => {
  test("no sliver step split off a single large step", () => {
    const r = tgaSteps(trace(30, 600, 0.5, (T) => 100 - 80 * L(T, 280, 8), 0.01, 2));
    expect(r.steps.length).toBe(1);
    expect(Math.abs(r.steps[0].loss - 80)).toBeLessThan(0.5);
  });
  test("the sample temperature, not the programme temperature", () => {
    const rows = Array.from({ length: 30 }, (_, i) => [30 + i, 31 + i, -0.1]);
    expect(chooseThermalColumns(["Temp Program (°C)", "Sample Temp (°C)", "Heat Flow (mW)"], rows, "dsc", {}).x).toBe(1);
  });
  test("a °F temperature column is converted to °C, and said", () => {
    const lines = ["Temperature (°F)\tHeat Flow (W/g)"];
    for (let T = 86; T <= 482; T += 1) {
      const c = ((T - 32) * 5) / 9;
      lines.push(`${T}\t${(-0.05 - 2.4 * G(c, 186, 1.6)).toFixed(5)}`);
    }
    const r = analyzeSolid("dsc", lines.join("\n"));
    expect(r.ok && Math.abs(Number(r.rows[1][2]) - 186) < 1).toBe(true);
    expect(r.notes.join(" ")).toMatch(/converted to °C/);
  });
});
