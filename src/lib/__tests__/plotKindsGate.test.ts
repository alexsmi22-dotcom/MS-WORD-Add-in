// CUMULATIVE GATE for Plot ▸ Plot type: every reviewer probe from rounds 1–3
// (scratchpad review-plots\, review-round2\, review-round3\) with its intended
// outcome — a figure with the stated property, or a NAMED refusal. A later fix
// that regresses an earlier round fails here.
import { buildPlotKind, PlotKindInput } from "../plotKinds";
import { levelLabels } from "../contour";
import { parseDualData } from "../dualAxisPlot";

const BASE: PlotKindInput = {
  kind: "contour", fn: "", fn2: "", xmin: "-2", xmax: "2", tmin: "0", tmax: "2*pi", ymin: "-2", ymax: "2",
  angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "", y2label: "", zlabel: "", xscale: "linear", yscale: "linear",
  y2scale: "linear", equal: true, levels: "", filled: false, grid: "", az: "-60", el: "30", surfaceStyle: "filled",
};
const run = (o: Partial<PlotKindInput>) => buildPlotKind({ ...BASE, ...o });

/** The colour bar's level labels (numeric texts right of the frame), and its title. */
function bar(svg: string): { labels: string[]; title: string } {
  const m = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="none"/.exec(svg)!;
  const right = Number(m[1]) + Number(m[2]);
  const texts = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-family="[^"]+" font-size="10" fill="#333333">([^<]+)<\/text>/g)].filter((t) => Number(t[1]) > right).map((t) => t[2]);
  return { labels: texts.filter((t) => /^[−\d]/.test(t)), title: texts.find((t) => !/^[−\d]/.test(t)) ?? "" };
}
/** Every <text> in a figure. */
const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

type Expect = "ok" | RegExp;
const CASES: [string, Partial<PlotKindInput>, Expect][] = [
  // --- round 1 (review-plots) ---
  ["contour x²+y² lines", { fn: "x^2+y^2" }, "ok"],
  ["contour filled", { fn: "x^2+y^2", filled: true }, "ok"],
  ["contour sqrt(x)+y (half the field has no value)", { fn: "sqrt(x)+y" }, "ok"],
  ["contour levels outside the range", { fn: "x^2+y^2", levels: "-10 10" }, "ok"],
  ["contour level list with commas", { fn: "x^2+y^2", levels: "-10, 0, 10, 20" }, "ok"],
  ["contour level at the minimum", { fn: "x^2+y^2", grid: "61", levels: "0" }, "ok"],
  ["contour level above the maximum", { fn: "x^2+y^2", grid: "61", levels: "200" }, "ok"],
  ["contour levels with decimal commas", { fn: "x^2+y^2", levels: "1,5 2,5" }, "ok"],
  ["contour unreadable levels", { fn: "x^2+y^2", levels: "a b" }, /Could not read the levels/],
  ["contour semicolon levels", { fn: "x^2+y^2", levels: "1;2;3" }, "ok"],
  ["contour U+2212 levels", { fn: "x", levels: "−5 −2" }, "ok"],
  ["contour grid 4 refused", { fn: "x*y", grid: "4" }, /from 5 to 200/],
  ["contour grid 201 refused", { fn: "x*y", grid: "201" }, /from 5 to 200/],
  ["contour tiny x range", { fn: "x*y", xmin: "1e-300", xmax: "2e-300", ymin: "0", ymax: "1" }, "ok"],
  ["contour sin(xy) at the cap, lines", { fn: "sin(x*y)", grid: "200" }, "ok"],
  ["contour constant 5", { fn: "5" }, /constant \(5\)/],
  ["surface default", { kind: "surface", fn: "sin(x)*cos(y)" }, "ok"],
  ["surface wireframe", { kind: "surface", fn: "sin(x)*cos(y)", surfaceStyle: "wireframe" }, "ok"],
  ["surface el 90", { kind: "surface", fn: "x*y", el: "90" }, "ok"],
  ["surface el 0", { kind: "surface", fn: "x*y", az: "30", el: "0" }, "ok"],
  ["surface el −10", { kind: "surface", fn: "x*y", el: "-10" }, /Elevation must be from 0° to 90°/],
  ["surface el 91", { kind: "surface", fn: "x*y", el: "91" }, /Elevation/],
  ["surface az abc", { kind: "surface", fn: "x*y", az: "abc" }, /Azimuth/],
  ["surface az 720", { kind: "surface", fn: "x*y", az: "720" }, "ok"],
  ["surface lopsided rectangle", { kind: "surface", fn: "x+y", xmin: "0", xmax: "1e-6", ymin: "0", ymax: "1e6" }, "ok"],
  ["surface grid 120", { kind: "surface", fn: "x*y", grid: "120" }, "ok"],
  ["surface grid 121", { kind: "surface", fn: "x*y", grid: "121" }, /from 5 to 120/],
  ["polar rose", { kind: "polar", fn: "cos(3*theta)", tmin: "0", tmax: "pi" }, "ok"],
  ["polar degrees", { kind: "polar", fn: "cos(3*theta)", angleUnit: "deg", tmin: "0", tmax: "360" }, "ok"],
  ["polar 20π", { kind: "polar", fn: "theta", tmax: "20*pi" }, "ok"],
  ["polar 199π", { kind: "polar", fn: "theta", tmax: "199*pi" }, "ok"],
  ["polar a million radians", { kind: "polar", fn: "1", tmax: "1e6" }, /more than 100 full turns/],
  ["polar −π to π", { kind: "polar", fn: "1+cos(theta)", tmin: "-pi", tmax: "pi" }, "ok"],
  ["parametric circle", { kind: "parametric", fn: "cos(t)", fn2: "sin(t)" }, "ok"],
  ["parametric −1 to 1", { kind: "parametric", fn: "t", fn2: "t^2", tmin: "-1", tmax: "1" }, "ok"],
  ["two y axes", { kind: "dualy", data: "1 2 30\n2 3 20\n3 5 10" }, "ok"],
  // --- round 1 adversarial list ---
  ["tan(x)+y draws without pole lines", { fn: "tan(x)+y" }, "ok"],
  ["1/(x²+y²−1) level −0.5 draws nothing false", { fn: "1/(x^2+y^2-1)", levels: "-0.5" }, "ok"],
  ["sin²x+cos²x contour refused", { fn: "sin(x)^2+cos(x)^2" }, /constant/],
  ["sin²x+cos²x surface refused", { kind: "surface", fn: "sin(x)^2+cos(x)^2" }, /constant/],
  ["mixed-term noise refused", { fn: "sin(x)^2+cos(y)^2+cos(x)^2-cos(y)^2" }, /constant/],
  ["300 + 0.1x with user levels", { fn: "300+0.1*x", levels: "299.85 300.15" }, "ok"],
  ["filled at the cap with 40 levels refused by size", { fn: "sin(5*x)*cos(5*y)", grid: "200", filled: true, levels: Array.from({ length: 40 }, (_, i) => (-0.975 + i * 0.05).toFixed(3)).join(" ") }, /too detailed/],
  ["sin(xy) filled at the cap", { fn: "sin(x*y)", grid: "200", filled: true }, "ok"],
  ["polar cos(2θ)", { kind: "polar", fn: "cos(2θ)" }, "ok"],
  ["polar 2θ", { kind: "polar", fn: "2θ", tmax: "pi" }, "ok"],
  ["contour infinite x span", { fn: "x*y", xmin: "-1e308", xmax: "1e308" }, /too wide/],
  ["2x is named", { fn: "2x + y" }, /Write \* for multiplication/],
  // --- round 2 ---
  ["1e6 + 10⁻⁷x draws (thousands of ulps)", { fn: "1e6+x*1e-7" }, "ok"],
  ["1 + 10⁻¹⁵x on ±10 draws (~90 ulps)", { fn: "1+1e-15*x", xmin: "-10", xmax: "10" }, "ok"],
  ["1 + 10⁻¹⁷x refused", { fn: "1+1e-17*x" }, /constant/],
  // --- round 3 (near-flat fields: labels must stay distinct and exact) ---
  ["1 + 10⁻¹⁴x on ±10", { fn: "1+x*1e-14", xmin: "-10", xmax: "10" }, "ok"],
  ["100 + 10⁻⁹x", { fn: "100+x*1e-9" }, "ok"],
  ["5 + 10⁻¹²x", { fn: "5+x*1e-12" }, "ok"],
  ["1e6 + 10⁻⁷x filled", { fn: "1e6+x*1e-7", filled: true }, "ok"],
  ["−1e6 + 10⁻⁷x", { fn: "-1e6+x*1e-7" }, "ok"],
  ["surface 1e6 + 10⁻⁷x", { kind: "surface", fn: "1e6+x*1e-7" }, "ok"],
  ["surface 5 + 10⁻¹²x", { kind: "surface", fn: "5+x*1e-12" }, "ok"],
];

describe("cumulative gate: every earlier probe keeps its outcome", () => {
  test.each(CASES)("%s", (_name, o, want) => {
    const r = run(o);
    if (want === "ok") {
      if (!r.ok) throw new Error(r.error);
      const t = texts(r.svg).join(" | ");
      expect(t).not.toMatch(/NaN|Infinity|undefined|\^|—/);
      expect(r.svg).not.toMatch(/NaN|Infinity/);
      if ((o.kind ?? "contour") === "contour") {
        // RULE C: the bar's labels are pairwise distinct.
        const b = bar(r.svg);
        expect(new Set(b.labels).size).toBe(b.labels.length);
      }
    } else {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(want);
    }
  });
});

describe("RULE C: labels distinct and each reads back as its level", () => {
  const readBack = (label: string, mult: string, offset: string): number => {
    const num = (s: string): number => {
      const t = s.split("−").join("-").replace(/\s/g, "");
      const m = /^(-?[\d.]+)(?:×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/.exec(t);
      if (!m) return NaN;
      const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
      const e = m[2] ? Number([...m[2]].map((c) => (c === "⁻" ? "-" : String(sup.indexOf(c)))).join("")) : 0;
      return Number(`${m[1]}e${e}`);
    };
    const v = num(label) * (mult ? num("1" + mult) : 1);
    if (!offset) return v;
    const base = num(offset.slice(2));
    return offset.startsWith("−") ? base + v : v - base;
  };
  test.each([
    [[299.25, 299.75]],
    [[4.9925, 4.995, 4.9975]],
    [[1e-14, 1e-7, 1]],
    [[1e-30, 1]],
    [[0, 1e-30, 2.5e-30]],
    [Array.from({ length: 9 }, (_, k) => 1e6 - 2e-7 + ((k + 1) * 4e-7) / 10)],
    [Array.from({ length: 7 }, (_, k) => 5 - 1.5e-12 + k * 0.5e-12)],
    [Array.from({ length: 7 }, (_, k) => -1e6 - 1.5e-7 + k * 0.5e-7)],
    [[1000, 25000]],
  ] as [number[]][])("%j", (lv) => {
    const r = levelLabels(lv)!;
    expect(r).not.toBeNull();
    expect(new Set(r.labels).size).toBe(lv.length);
    const sorted = [...lv].sort((a, b) => a - b);
    lv.forEach((v, k) => {
      const back = readBack(r.labels[k], r.multiplier, r.offset);
      const i = sorted.indexOf(v);
      const gap = Math.min(i > 0 ? v - sorted[i - 1] : Infinity, i < sorted.length - 1 ? sorted[i + 1] - v : Infinity);
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(gap / 4, 64 * Math.pow(2, Math.floor(Math.log2(Math.abs(v) || 1)) - 52)) * 1.0001);
    });
  });
  test("the offset is named in the bar title", () => {
    const r = run({ fn: "1e6+x*1e-7" });
    expect(r.ok && bar(r.svg).title).toBe("z − 1×10⁶ (×10⁻⁷)");
  });
});

describe("two y axes probes (separators decided now; RULE N switch pending dataBlock.ts)", () => {
  test.each([
    ["1,5\t2,3\t4,1", [1.5, 2.3], [1.5, 4.1]],
    ["1;2,5;3,5", [1, 2.5], [1, 3.5]],
    ["1,2,3\n2,4,6", [1, 2], [1, 3]],
    ["1, 2.5, 3.5\n2, 4.5, 6.5", [1, 2.5], [1, 3.5]],
  ] as [string, number[], number[]][])("%j", (text, l0, r0) => {
    const r = parseDualData(text);
    expect(r.refusal).toBeUndefined();
    expect([r.left[0].x, r.left[0].y]).toEqual(l0);
    expect([r.right[0].x, r.right[0].y]).toEqual(r0);
  });
  test("1,000 with nothing to decide is refused by name", () => {
    expect(parseDualData("1,000 2 3").refusal).toMatch(/“1,000”/);
  });
  // RULE N table (relB-round3-rules.md), the cases that are x y₁ y₂ data; read by dataBlock.readDataBlock.
  type Want = { left: [number, number][]; right: [number, number][] } | RegExp;
  test.each([
    ["10 5,30\n25 8,25", { left: [[10, 5.3], [25, 8.25]], right: [] }],
    ["10\t5,30\t58\n25\t8,25\t60", { left: [[10, 5.3], [25, 8.25]], right: [[10, 58], [25, 60]] }],
    ["10, 5,30\n25, 8,25", { left: [[10, 5.3], [25, 8.25]], right: [] }],
    ["0\t2,88\n12.5\t5,10", /mixes 12\.5 and 2,88/],
    ["0\t2,88\t25.0", /mixes/],
    ["0,2.88\n5, 4.15\n10,4.76", /decimal point and a comma/],
    ["1,2,3\n2,4,6", { left: [[1, 2], [2, 4]], right: [[1, 3], [2, 6]] }],
    ["1,2,3\n2,4,6\n3 6 9", /line 1/],
    ["1, 2.5, 3.5\n2, 4.5, 6.5", { left: [[1, 2.5], [2, 4.5]], right: [[1, 3.5], [2, 6.5]] }],
    ["1, 2.5,3.5", /decimal point and a comma/],
    ["1, 2.5,3.5\n2,4.5, 6.5", /decimal point and a comma/],
    ["1,2,3\n2, 4,6\n3,6,9", /line 1/],
    ["1,000 7.0", /mixes 7\.0 and 1,000/],
    ["1,000 2 3", /“1,000”/],
    ["x\ty1\ty2\n1\t2\t3", { left: [[1, 2]], right: [[1, 3]] }],
    ["Batch A: 312 334 351\n380 390 400", /line 1/],
    ["Specimen 1\n312 1 2\n334 2 3", /line 1/],
    ["1\t−2,5\t3", { left: [[1, -2.5]], right: [[1, 3]] }],
    ["1e-3\t2\t5\n2e-3\t4\t6", { left: [[0.001, 2], [0.002, 4]], right: [[0.001, 5], [0.002, 6]] }],
    ["1\t2\t3\r\n\r\n2\t3\t4\r\n", { left: [[1, 2], [2, 3]], right: [[1, 3], [2, 4]] }],
    ["1,5\t2,3\t4,1", { left: [[1.5, 2.3]], right: [[1.5, 4.1]] }],
    ["1;2,5;3,5", { left: [[1, 2.5]], right: [[1, 3.5]] }],
    ["1.234,5\t1.302,7\t2,5", { left: [[1234.5, 1302.7]], right: [[1234.5, 2.5]] }],
  ] as [string, Want][])("%j", (text, want) => {
    const r = parseDualData(text);
    if (want instanceof RegExp) {
      expect(r.refusal).toMatch(want);
      return;
    }
    expect(r.refusal).toBeUndefined();
    expect(r.left.map((p) => [p.x, p.y])).toEqual(want.left);
    expect(r.right.map((p) => [p.x, p.y])).toEqual(want.right);
  });
  test("the header row is named in the figure's notes", () => {
    const r = run({ kind: "dualy", data: "x\ty1\ty2\n1\t2\t3\n2\t3\t4" });
    expect(r.ok && r.notes.join(" ")).toMatch(/header/);
  });
});

describe("round 4", () => {
  const barOf = (o: Partial<PlotKindInput>) => {
    const r = run(o);
    if (!r.ok) throw new Error(r.error);
    return { r, ...bar(r.svg) };
  };
  test.each([false, true])("offset labels at the right digit: 1e6 + 1e-9·x·y on ±10 (filled %s)", (filled) => {
    const b = barOf({ fn: "1e6 + 1e-9*x*y", xmin: "-10", xmax: "10", ymin: "-10", ymax: "10", filled });
    expect(b.title).toMatch(/^z − 1×10⁶/);
    // Levels are 2.5×10⁻⁸ apart: −7.5 −5 −2.5 0 2.5 5 7.5 (×10⁻⁸), never −7 −5 −3 …
    expect(b.labels).toEqual(["−7.5", "−5.0", "−2.5", "0.0", "2.5", "5.0", "7.5"]);
  });
  test("range note reads back: 1e6 + x·y on ±2 says 999 996 to 1 000 004", () => {
    const r = run({ fn: "1e6 + x*y" });
    expect(r.ok && r.notes.join(" ")).toMatch(/z from 999996 to 1000004/);
  });
  test("levels typed to 13–15 significant figures are echoed, not refused", () => {
    const r = run({ fn: "1 + 1e-12*x", xmin: "-1", xmax: "1", levels: "1.0000000000001 1.0000000000002 1.0000000000003" });
    expect(r.ok).toBe(true);
    const lv = levelLabels([1.234567890123, 1.234567890124, 1.234567890126])!;
    expect(lv).not.toBeNull();
    expect(new Set(lv.labels).size).toBe(3);
  });
  test("sin(x·y), grid 200, 40 levels: refused early, quickly", () => {
    const L = Array.from({ length: 40 }, (_, i) => (-0.99 + (i * 1.98) / 40).toFixed(4)).join(" ");
    for (const filled of [false, true]) {
      const t0 = Date.now();
      const r = run({ fn: "sin(x*y)", xmin: "-10", xmax: "10", ymin: "-10", ymax: "10", grid: "200", levels: L, filled });
      const ms = Date.now() - t0;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/too detailed/);
      // About 1.3 s per case under ts-jest alone (several times faster bundled); the
      // ceiling leaves room for a loaded full jest run and still catches a refusal
      // that no longer happens early (the traced figure took far longer).
      expect(ms).toBeLessThan(5000);
    }
  });
});
