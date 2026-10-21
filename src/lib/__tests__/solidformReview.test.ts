// Review round 1 pinned: the inputs an adversarial reviewer found the engine wrong on — real export shapes, noisy
// patterns, amorphous halos, glass transitions, noisy and drifting thermograms — each checked by an invariant (where the
// peaks are, what is not invented), never by a count that depends on the exact noise drawn.
import { analyzeSolid } from "../solidformAnalyze";
import { dscEvents, parsePeakList, pickPeaks, tgaSteps, WAVELENGTHS, type XY } from "../solidform";

// Seeded noise: a linear-congruential generator and Box–Muller.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function gauss(r: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}
const pv = (x: number, c: number, w: number) => 0.5 * Math.exp((-4 * Math.LN2 * (x - c) ** 2) / w ** 2) + 0.5 / (1 + (4 * (x - c) ** 2) / w ** 2);
function pattern(from: number, to: number, step: number, bg: (x: number) => number, peaks: Array<[number, number]>, seed = 1, kalpha2 = false): XY[] {
  const g = gauss(rng(seed));
  const out: XY[] = [];
  for (let x = from; x <= to + 1e-9; x += step) {
    let y = bg(x);
    for (const [c, h] of peaks) {
      y += h * pv(x, c, 0.1);
      if (kalpha2) {
        const t2 = (2 * Math.asin((1.544426 / 1.540598) * Math.sin((c * Math.PI) / 360)) * 180) / Math.PI;
        y += 0.5 * h * pv(x, t2, 0.1);
      }
    }
    out.push([Math.round(x * 1e4) / 1e4, Math.max(0, Math.round(y + g() * Math.sqrt(Math.max(1, y))))]);
  }
  return out;
}
const near = (got: number[], want: number[], tol = 0.05) => want.every((w) => got.some((g) => Math.abs(g - w) <= tol)) && got.every((g) => want.some((w) => Math.abs(g - w) <= tol));
const asText = (xy: XY[], sep = "\t") => xy.map(([x, y]) => `${x}${sep}${y}`).join("\n");
const ok = (r: ReturnType<typeof analyzeSolid>) => {
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r;
};
const CU = WAVELENGTHS.CuKa1.a;

describe("peak lists in the shapes people paste", () => {
  test("“angle,intensity” CSV pairs are pairs, not six angles", () => {
    const r = parsePeakList("6.8,100\n13.6,40\n17.2,80", CU);
    expect(r.errors).toEqual([]);
    expect(r.peaks.map((p) => [p.twoTheta, Math.round(p.rel)])).toEqual([[6.8, 100], [13.6, 40], [17.2, 80]]);
    expect(parsePeakList("6.8,1800\n13.6,720\n17.2,2400", CU).peaks.map((p) => Math.round(p.rel))).toEqual([75, 30, 100]);
  });
  test("a “2θ  d  I%” table takes I from the column that is not d — in either order", () => {
    const r = ok(analyzeSolid("xrpd", "6.8 12.99 75\n13.6 6.51 50\n17.2 5.15 100\n21.3 4.17 60", { cite: 2 }));
    expect(r.rows.find((x) => x[0] === "17.2")![2]).toBe("100");
    expect(r.text).toMatch(/about 6\.8° and 17\.2°/);
    const swapped = ok(analyzeSolid("xrpd", "6.8 75 12.99\n13.6 50 6.51\n17.2 100 5.15\n21.3 60 4.17", { cite: 2 }));
    expect(swapped.text).toMatch(/about 6\.8° and 17\.2°/);
  });
  test("decimal commas: “5,2;10,4;15,6”, and “3,02<tab>202” patterns", () => {
    expect(parsePeakList("5,2;10,4;15,6", CU).peaks.map((p) => p.twoTheta)).toEqual([5.2, 10.4, 15.6]);
    const xy = pattern(3, 40, 0.02, () => 200, [[17.2, 2000]], 3);
    const eu = ok(analyzeSolid("xrpd", xy.map(([x, y]) => `${String(x).replace(".", ",")}\t${y}`).join("\n")));
    expect(near(eu.peaks.map((p) => p.twoTheta), [17.2])).toBe(true);
    const sp = ok(analyzeSolid("xrpd", xy.map(([x, y]) => `${String(x).replace(".", ",")} ${y}`).join("\n")));
    expect(near(sp.peaks.map((p) => p.twoTheta), [17.2])).toBe(true);
  });
  test("headers and metadata lines are skipped, not refused", () => {
    const xy = pattern(3, 40, 0.02, () => 150, [[9.4, 900], [21.3, 1500]], 4);
    const csv = ok(analyzeSolid("xrpd", `Sample: Form A, batch 3\nAngle [°2Th.], Intensity [Counts]\n${asText(xy, ",")}`));
    expect(near(csv.peaks.map((p) => p.twoTheta), [9.4, 21.3])).toBe(true);
  });
  test("± tolerances, ° and % signs, and a header row in a typed list", () => {
    expect(parsePeakList("5.2 ± 0.2\n10.4 ± 0.2", CU).peaks.map((p) => p.twoTheta)).toEqual([5.2, 10.4]);
    expect(parsePeakList("5.2°±0.2°\n10.4°±0.2°", CU).peaks.map((p) => p.twoTheta)).toEqual([5.2, 10.4]);
    expect(parsePeakList("6.8° 100%\n13.6° 40%", CU).peaks.map((p) => Math.round(p.rel))).toEqual([100, 40]);
    expect(parsePeakList("2θ (°)\td (Å)\tRel. I (%)\n6.8\t12.99\t75\n17.2\t5.15\t100", CU).peaks.map((p) => Math.round(p.rel))).toEqual([75, 100]);
  });
  test("near-duplicates are merged, and said", () => {
    const r = parsePeakList("10.40 100\n10.42 90\n15.6 50", CU);
    expect(r.peaks.map((p) => p.twoTheta)).toEqual([10.4, 15.6]);
    expect(r.notes.join(" ")).toMatch(/10\.42° .*merged|within/);
  });
});

describe("measured patterns", () => {
  test("Poisson noise on a flat background: the three real peaks and nothing else", () => {
    const xy = pattern(3, 40, 0.02, () => 200, [[3.05, 1000], [20, 500], [39.95, 800]], 7);
    const r = pickPeaks(xy, CU);
    expect(near(r.peaks.map((p) => p.twoTheta), [3.05, 20, 39.95])).toBe(true);
  });
  test("weak peaks on a high background: never noise reported as peaks", () => {
    const xy = pattern(3, 40, 0.02, () => 1000, [[12, 600], [25, 400]], 8);
    const r = pickPeaks(xy, CU);
    expect(r.peaks.length).toBeLessThanOrEqual(2);
    expect(r.peaks.every((p) => Math.abs(p.twoTheta - 12) < 0.05 || Math.abs(p.twoTheta - 25) < 0.05)).toBe(true);
  });
  test("an amorphous halo: no peaks, no claim, and a note that the sample looks amorphous", () => {
    const g = gauss(rng(9));
    const xy: XY[] = [];
    for (let x = 3; x <= 40.0001; x += 0.02) {
      const y = 300 + 1500 * Math.exp(-((x - 21) ** 2) / (2 * 16));
      xy.push([Math.round(x * 100) / 100, Math.round(y + g() * Math.sqrt(y))]);
    }
    const r = analyzeSolid("xrpd", asText(xy));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.peaks).toEqual([]);
    expect(r.text).toBe("");
    expect(r.notes.join(" ")).toMatch(/amorphous/i);
  });
  test("a steep low-angle background: no invented peaks at low angle, the real ones all found", () => {
    const xy = pattern(2, 40, 0.02, (x) => 200 + 30000 * Math.exp(-x / 1.5), [[13.6, 200], [17.2, 240], [21.3, 180]], 10);
    const r = pickPeaks(xy, CU);
    expect(near(r.peaks.map((p) => p.twoTheta), [13.6, 17.2, 21.3])).toBe(true);
  });
  test("a 0.2° step is still a pattern (its peaks, not every point)", () => {
    const xy = pattern(3, 40, 0.2, () => 100, [[10.4, 900], [21.2, 1500]], 11);
    const r = ok(analyzeSolid("xrpd", asText(xy)));
    expect(r.source).toBe("pattern");
    expect(r.peaks.length).toBeLessThanOrEqual(2);
  });
  test("in an unstripped Cu Kα pattern, a Kα2 shoulder is not a peak of its own; the note names it", () => {
    const xy = pattern(50, 70, 0.01, () => 100, [[60, 3000]], 12, true);
    const r = ok(analyzeSolid("xrpd", asText(xy), { wavelength: "CuKa" }));
    expect(near(r.peaks.map((p) => p.twoTheta), [60])).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Kα2/);
  });
  test("130 000 points do not overflow the stack", () => {
    const xy: XY[] = [];
    for (let i = 0; i < 130000; i++) xy.push([3 + i * 0.0003, 100 + 1000 * pv(3 + i * 0.0003, 20, 0.1)]);
    expect(() => pickPeaks(xy, CU)).not.toThrow();
  });
});

describe("thermograms", () => {
  test("a glass transition is a step with its midpoint — never an endotherm with a wild onset", () => {
    const xy: XY[] = [];
    for (let T = 30; T <= 250; T += 0.5) xy.push([T, -0.1 - 0.2 / (1 + Math.exp(-(T - 120) / 2))]);
    const r = dscEvents(xy, true);
    expect(r.events.filter((e) => e.kind !== "step")).toEqual([]);
    const step = r.events.find((e) => e.kind === "step")!;
    expect(Math.abs(step.peak - 120)).toBeLessThan(1);
    for (const e of r.events) if (Number.isFinite(e.onset)) expect(e.onset).toBeGreaterThanOrEqual(30);
  });
  test("a noisy melt: one endotherm, onset still at μ − 2σ", () => {
    const g = gauss(rng(13));
    const xy: XY[] = [];
    for (let T = 30; T <= 250; T += 0.1) xy.push([T, -0.05 - 2.4 * Math.exp(-((T - 186) ** 2) / (2 * 1.6 ** 2)) + g() * 0.03]);
    const r = dscEvents(xy, true);
    expect(r.events.length).toBe(1);
    expect(Math.abs((r.events[0].onset ?? NaN) - 182.8)).toBeLessThan(0.6);
  });
  test("every onset lies between its event's start and its peak", () => {
    const xy: XY[] = [];
    for (let T = 30; T <= 250; T += 0.5) xy.push([T, -0.05 - 2 * Math.exp(-((T - 150) ** 2) / 8) + 1.2 * Math.exp(-((T - 200) ** 2) / 18)]);
    for (const e of dscEvents(xy, true).events) if (e.kind !== "step") expect(e.onset).toBeLessThanOrEqual(e.peak);
  });
  test("TGA at a 0.1 °C step with balance noise: two steps, not dozens", () => {
    const g = gauss(rng(14));
    const L = (T: number, c: number, w: number) => 1 / (1 + Math.exp(-(T - c) / w));
    const xy: XY[] = [];
    for (let T = 30; T <= 350; T += 0.1) xy.push([T, 100 - 4.6 * L(T, 105, 6) - 58 * L(T, 290, 9) + g() * 0.01]);
    const r = tgaSteps(xy);
    expect(r.steps.length).toBe(2);
    expect(Math.abs(r.steps[0].loss - 4.6)).toBeLessThan(0.4);
    expect(Math.abs(r.steps[1].loss - 58)).toBeLessThan(1.5);
  });
  test("TGA drift is not a step; two overlapping steps are two", () => {
    const L = (T: number, c: number, w: number) => 1 / (1 + Math.exp(-(T - c) / w));
    const drift: XY[] = [];
    for (let T = 30; T <= 350; T += 1) drift.push([T, 100 - 0.01 * (T - 30) - 4.6 * L(T, 150, 5)]);
    const d = tgaSteps(drift);
    expect(d.steps.length).toBe(1);
    expect(Math.abs(d.steps[0].loss - 4.6)).toBeLessThan(0.6);
    const two: XY[] = [];
    for (let T = 30; T <= 250; T += 0.5) two.push([T, 100 - 3 * L(T, 100, 3) - 3 * L(T, 125, 3)]);
    const t = tgaSteps(two);
    expect(t.steps.length).toBe(2);
    for (const s of t.steps) expect(Math.abs(s.loss - 3)).toBeLessThan(0.6);
  });
  test("three-column exports (time, temperature, signal): the right columns, and the note says which", () => {
    const rows: string[] = ["Time (min)\tTemperature (°C)\tHeat Flow (W/g)"];
    for (let T = 30; T <= 250; T += 0.5) rows.push(`${((T - 30) / 10).toFixed(2)}\t${T.toFixed(1)}\t${(-0.05 - 2.4 * Math.exp(-((T - 186) ** 2) / (2 * 1.6 ** 2))).toFixed(5)}`);
    const r = ok(analyzeSolid("dsc", rows.join("\n")));
    expect(Math.abs(Number(r.rows[1][1]) - 182.8)).toBeLessThan(0.6);
    expect(r.notes.join(" ")).toMatch(/Temperature.*Heat Flow/);
    const L = (T: number, c: number, w: number) => 1 / (1 + Math.exp(-(T - c) / w));
    const tga: string[] = ["Time\tTemp\tWeight (mg)"];
    for (let T = 30; T <= 350; T += 1) tga.push(`${T - 30}\t${T}\t${(5.23 * (1 - 0.046 * L(T, 105, 6))).toFixed(5)}`);
    const t = ok(analyzeSolid("tga", tga.join("\n")));
    expect(Math.abs(Number(t.rows[1][3]) - 4.6)).toBeLessThan(0.4);
    expect(t.svg).toMatch(/% of initial/);
  });
  test("a weight gain is said", () => {
    const xy: XY[] = [];
    for (let T = 30; T <= 300; T += 1) xy.push([T, 100 + 3 / (1 + Math.exp(-(T - 150) / 5))]);
    expect(tgaSteps(xy).notes.join(" ")).toMatch(/gain/i);
  });
});

describe("the sentences", () => {
  test("weighted Cu Kα reads “Cu Kα radiation”; the subject is capitalised; the default is “A crystalline form”", () => {
    const r = ok(analyzeSolid("xrpd", "6.8 100\n13.6 40", { wavelength: "CuKa", subject: "crystalline Form A" }));
    expect(r.text).toMatch(/^Crystalline Form A, characterized/);
    expect(r.text).toMatch(/measured with Cu Kα radiation\.$/);
    expect(ok(analyzeSolid("xrpd", "6.8 100\n13.6 40")).text).toMatch(/^A crystalline form, characterized/);
  });
});
