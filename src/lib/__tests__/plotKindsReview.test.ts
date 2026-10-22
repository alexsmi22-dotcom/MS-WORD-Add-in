// Release B adversarial review of Plot ▸ Plot type: each defect it found, pinned.
import { compileExpr, evalExpr, foldPlotSymbols } from "../plot";
import { sampleGrid, marchingSquares, levelLabels, isFlat, rangeText, isobands, contourPlotSvg, Grid } from "../contour";
import { sampleSurface, surfacePlotSvg } from "../surface3d";
import { parseDualData, dualAxisPlotSvg } from "../dualAxisPlot";
import { buildPlotKind, PlotKindInput, readRangeBound, CONTOUR_VERTEX_BUDGET } from "../plotKinds";

const BASE: PlotKindInput = {
  kind: "contour", fn: "", fn2: "", xmin: "-10", xmax: "10", tmin: "0", tmax: "2*pi", ymin: "-10", ymax: "10",
  angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "", y2label: "", zlabel: "", xscale: "linear", yscale: "linear",
  y2scale: "linear", equal: true, levels: "", filled: false, grid: "", az: "-60", el: "30", surfaceStyle: "filled",
};
const run = (o: Partial<PlotKindInput>) => buildPlotKind({ ...BASE, ...o });
const grid = (expr: string, x0: number, x1: number, y0: number, y1: number, n: number): Grid =>
  sampleGrid(compileExpr(expr, ["x", "y"]), x0, x1, y0, y1, n, n);
const barLabels = (svg: string): string[] => {
  const m = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="none"/.exec(svg)!;
  const right = Number(m[1]) + Number(m[2]);
  return [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-family="[^"]+" font-size="10" fill="#333333">([^<]+)<\/text>/g)]
    .filter((t) => Number(t[1]) > right && /\d/.test(t[2]))
    .map((t) => t[2]);
};

describe("1. every colour-bar label equals its level", () => {
  test("299.25 and 299.75 on 300 + 0.1x (were labelled 299 and 300)", () => {
    const r = run({ fn: "300 + 0.1*x", levels: "299.25 299.75" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(barLabels(r.svg)).toEqual(["299.25", "299.75"]);
  });
  test("auto levels on a narrow range are printed exactly (were 4.993, 4.995, 4.998)", () => {
    const r = run({ fn: "5 + 0.001*x", xmin: "-10", xmax: "10" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const labels = barLabels(r.svg);
    expect(labels.length).toBeGreaterThan(2);
    // Each printed label parses back to a level that was drawn.
    const g = grid("5 + 0.001*x", -10, 10, -10, 10, 60);
    const lv = marchingSquares(g, labels.map((t) => Number(t.split("−").join("-")))).filter((l) => l.paths.length);
    expect(lv.length).toBe(labels.length);
  });
  test.each([
    [[299.25, 299.75], ["299.25", "299.75"], ""],
    [[4.9925, 4.995, 4.9975], ["4.9925", "4.9950", "4.9975"], ""],
    [[-2, 0, 2.5], ["−2.0", "0.0", "2.5"], ""],
    [[1e-7, 2e-7], ["1", "2"], "×10⁻⁷"],
    // A nonzero level is never printed as zero: per-label significance when fixed decimals cannot hold them all.
    [[1e-14, 1e-7, 1], ["1×10⁻¹⁴", "1×10⁻⁷", "1"], ""],
    [[1e-13, 1e-12, 1], ["1×10⁻¹³", "1×10⁻¹²", "1"], ""],
    [[1e-30, 1], ["1×10⁻³⁰", "1"], ""],
    [[0, 1e-30, 2.5e-30], ["0.0", "1.0", "2.5"], "×10⁻³⁰"],
    [[1000, 25000], ["1 000", "25 000"], ""],
  ] as [number[], string[], string][])("levelLabels(%j)", (lv, labels, mult) => {
    const r = levelLabels(lv)!;
    expect(r.labels.map((s) => s.replace(/ /g, " "))).toEqual(labels);
    expect(r.multiplier).toBe(mult);
  });
});

describe("2. no contour across a pole or a step", () => {
  test("tan(x) + y, level 0: no vertical line at the poles x = ±π/2", () => {
    const g = grid("tan(x) + y", -2, 2, -2, 2, 41);
    expect(g.jumps).toBeGreaterThan(0);
    for (const p of marchingSquares(g, [0])[0].paths)
      for (const [x, y] of p.pts) expect(Math.abs(Math.tan(x) + y)).toBeLessThan(0.2); // every point is ON the level
  });
  test("1/(x² + y² − 1), level −0.5: z never takes it, so nothing is drawn (was a ring)", () => {
    const g = grid("1/(x^2 + y^2 - 1)", -2, 2, -2, 2, 41);
    expect(marchingSquares(g, [-0.5])[0].paths.length).toBe(0);
  });
  test("1/x, level 0: no line at x = 0", () => {
    const g = grid("1/x", -1, 1.05, -1, 1, 30);
    expect(marchingSquares(g, [0])[0].paths.length).toBe(0);
  });
  test("a step: sign(x) + y, level 0.5, draws y = −0.5 only where it is reached, never along x = 0", () => {
    const g = grid("sign(x) + y", -1, 1.03, -2, 2, 31);
    // z = 0.5 at y = −0.5 (x > 0) and y = 1.5 (x < 0): two horizontal lines, nothing vertical.
    const pts = marchingSquares(g, [0.5])[0].paths.flatMap((p) => p.pts);
    expect(pts.length).toBeGreaterThan(10);
    for (const [x, y] of pts) expect(y).toBeCloseTo(x > 0 ? -0.5 : 1.5, 9);
  });
  test.each(["atan(50*x) + y", "cbrt(x) + y", "sqrt(abs(x)) + y", "x^2 + y^2", "sin(3*x)*cos(2*y)"])("steep or cusped but continuous still draws: %s", (e) => {
    const g = grid(e, -1, 1, -1.6, 1.6, 41);
    expect(g.jumps).toBe(0);
  });
  test("atan(50x) + y, level 0: the line crosses x = 0 (oracle y = −atan(50x))", () => {
    const g = grid("atan(50*x) + y", -1, 1, -1.6, 1.6, 41);
    const pts = marchingSquares(g, [0])[0].paths.flatMap((p) => p.pts);
    expect(pts.some(([x]) => Math.abs(x) < 0.05)).toBe(true);
    for (const [x, y] of pts.filter(([x]) => Math.abs(x) > 0.2)) expect(y).toBeCloseTo(-Math.atan(50 * x), 1);
  });
  test("the figure greys the jump cells and says so", () => {
    const r = run({ fn: "tan(x) + y", xmin: "-2", xmax: "2", ymin: "-2", ymax: "2" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notes.join(" ")).toMatch(/z jumps \(a pole or a step\) inside \d+ grid cells?; they are grey/);
      expect(r.svg).toMatch(/z jumps/);
    }
  });
  test("surface: the mesh breaks at a pole instead of drawing a wall", () => {
    const g = sampleSurface(compileExpr("tan(x)", ["x", "y"]), -2, 2, -1, 1, 21);
    expect(g.jumps).toBeGreaterThan(0);
    const svg = surfacePlotSvg({ grid: g, style: "wireframe" });
    const quads = (svg.match(/<polygon points="[^"]+" fill="#ffffff"/g) ?? []).length;
    expect(quads).toBe(20 * 20 - g.jumps!);
    const r = run({ kind: "surface", fn: "tan(x)", xmin: "-2", xmax: "2", ymin: "-1", ymax: "1" });
    expect(r.ok && r.notes.join(" ")).toMatch(/broken there rather than drawn as a wall/);
  });
  test("bands skip jump cells too", () => {
    const g = grid("1/x", -1, 1.05, -1, 1, 30);
    const bands = isobands(g, [0])!;
    const xs = bands.flatMap((b) => b.pts.map((p) => p[0]));
    expect(xs.every((x) => x <= g.xs[14] + 1e-12 || x >= g.xs[15] - 1e-12)).toBe(true);
  });
});

describe("3. float noise is not structure", () => {
  // The rule (contour.ts isFlat): range ≤ 64 ulps of the largest |z|.
  test.each(["sin(x)^2 + cos(x)^2", "1 + 1e-17*x"])("%s: contour and surface refuse it as constant", (fn) => {
    const c = run({ fn });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/constant/);
    const s = run({ kind: "surface", fn });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toMatch(/constant/);
  });
  test.each([
    ["1e6 + x*1e-7", "2"],
    ["1 + 1e-15*x", "10"],
  ])("real variation of thousands / ~90 ulps draws: %s on ±%s", (fn, h) => {
    expect(run({ fn, xmin: "-" + h, xmax: h, ymin: "-2", ymax: "2" }).ok).toBe(true);
    expect(run({ kind: "surface", fn, xmin: "-" + h, xmax: h, ymin: "-2", ymax: "2" }).ok).toBe(true);
  });
  test("isFlat is ulp-based: a genuinely tiny function is not flat", () => {
    expect(isFlat(1, 1 + 2e-15)).toBe(true); // 9 ulps
    expect(isFlat(1, 1 + 2e-14)).toBe(false); // 90 ulps
    expect(isFlat(1e6, 1e6 + 4e-7)).toBe(false);
    expect(isFlat(-1e-20, 1e-20)).toBe(false);
    expect(run({ fn: "1e-20*x" }).ok).toBe(true);
  });
  test("an exactly constant surface still draws as a plane", () => {
    expect(run({ kind: "surface", fn: "3" }).ok).toBe(true);
  });
});

describe("4. two y axes read European and Excel pastes without splitting decimals", () => {
  test("tab-separated decimal commas", () => {
    const r = parseDualData("1,5\t2,3\t4,1\n2,5\t3,3\t5,1");
    expect(r.refusal).toBeUndefined();
    expect(r.left).toEqual([{ x: 1.5, y: 2.3 }, { x: 2.5, y: 3.3 }]);
    expect(r.right).toEqual([{ x: 1.5, y: 4.1 }, { x: 2.5, y: 5.1 }]);
    expect(r.commaNote).toMatch(/decimal points/);
  });
  test("semicolons separate, commas are decimals", () => {
    const r = parseDualData("1;2,5;3,5");
    expect(r.left).toEqual([{ x: 1, y: 2.5 }]);
    expect(r.right).toEqual([{ x: 1, y: 3.5 }]);
  });
  test("an ambiguous thousands-or-decimal comma is refused, by name", () => {
    const r = parseDualData("1,000 2 3");
    expect(r.refusal).toMatch(/“1,000”/);
    const k = run({ kind: "dualy", data: "1,000 2 3\n2 3 4" });
    expect(k.ok).toBe(false);
  });
  test("RULE N: whitespace in the block makes \"1,2,3\" one comma-number field, refused (round-3 settlement)", () => {
    expect(parseDualData("1,2,3\n2,4,6\n3 6 9").refusal).toMatch(/line 1/);
  });
  test("comma-space CSV: a bare comma inside a field is never split", () => {
    // RULE N2: 2.5 beside the comma-number 1,000 mixes decimal marks: refused.
    expect(parseDualData("1,000, 2.5, 3\n2,000, 3.5, 4").refusal).toMatch(/mixes 2\.5 and 1,000/);
    // With nothing to say which, it is refused by name rather than read as x = 1, y₁ = 0.
    expect(parseDualData("1,000, 2, 3").refusal).toMatch(/“1,000”/);
  });
  test("comma-space and bare-comma CSV still separate fields", () => {
    expect(parseDualData("1, 2, 3").left).toEqual([{ x: 1, y: 2 }]);
    expect(parseDualData("1,2,3").right).toEqual([{ x: 1, y: 3 }]);
  });
  test("a missing value breaks the line there; an empty tab field is missing", () => {
    const r = parseDualData("0\t1\t10\n1\t\t20\n2\t3\t30");
    expect(r.left).toEqual([{ x: 0, y: 1 }, { x: 2, y: 3, gap: true }]);
    const svg = dualAxisPlotSvg({ left: r.left, right: r.right });
    expect(svg).toMatch(/<path d="M[\d.]+,[\d.]+ M[\d.]+,[\d.]+" fill="none" stroke="#0072B2"/);
  });
  test("extra columns are counted and said", () => {
    const r = run({ kind: "dualy", data: "0 1 2 9\n1 2 3 9" });
    expect(r.ok && r.notes.join(" ")).toMatch(/2 lines have more than three columns/);
  });
});

describe("5. output size is bounded by work, not by time", () => {
  test("a filled contour at the caps with 40 levels is refused quickly, with a message", () => {
    const t0 = Date.now();
    const r = run({ fn: "sin(5*x)*cos(5*y)", grid: "200", filled: true, levels: Array.from({ length: 40 }, (_, i) => (-0.975 + i * 0.05).toFixed(3)).join(" ") });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too detailed .*4 MB/);
  });
  test("whatever is accepted stays under about 4 MB", () => {
    const r = run({ fn: "sin(x)*cos(y)", grid: "120", filled: true });
    if (r.ok) expect(r.svg.length).toBeLessThan(4_500_000);
    expect(CONTOUR_VERTEX_BUDGET).toBeLessThanOrEqual(400_000);
  });
});

describe("6. y = f(x) x range: plain numbers byte-identical, expressions read, junk refused", () => {
  test.each(["10", "-10", " 5 ", "5.", ".5", "1e3", "-0", "+7", "1E-2", "123456789.125"])("plain %s is parseFloat exactly", (t) => {
    expect(Object.is(readRangeBound(t), parseFloat(t))).toBe(true);
  });
  test("expressions", () => {
    expect(readRangeBound("2*pi")).toBeCloseTo(2 * Math.PI, 15);
    expect(readRangeBound("−π/2")).toBeCloseTo(-Math.PI / 2, 15);
  });
  test.each(["2pi", "1,5", "10abc", "0x10", "", "1e400", "Infinity"])("refused, not truncated: %s", (t) => {
    expect(readRangeBound(t)).toBeNull();
  });
});

describe("7. θ, π and U+2212 in formulas", () => {
  test("polar cos(2θ) and 2θ read as written", () => {
    expect(run({ kind: "polar", fn: "cos(2θ)" }).ok).toBe(true);
    expect(run({ kind: "polar", fn: "r(θ) = 2θ", tmax: "pi" }).ok).toBe(true);
  });
  test("folding", () => {
    expect(foldPlotSymbols("cos(2θ)")).toBe("cos(2*theta)");
    expect(foldPlotSymbols("3π/2")).toBe("3*pi/2");
    expect(foldPlotSymbols("θ(1 + θ)")).toBe("theta*(1 + theta)");
    expect(foldPlotSymbols("πθ")).toBe("pi*theta");
    expect(foldPlotSymbols("x − 1")).toBe("x - 1");
    expect(foldPlotSymbols("sin(x)/x")).toBe("sin(x)/x");
  });
  test("y = f(x) accepts π and U+2212 (both were parse errors), and ordinary input is unchanged", () => {
    expect(evalExpr("2π*x", 1)).toBeCloseTo(2 * Math.PI, 15);
    expect(evalExpr("x − 1", 3)).toBe(2);
    expect(evalExpr("sin(x)/x", 2)).toBe(Math.sin(2) / 2);
    expect(() => evalExpr("2x", 1)).toThrow();
  });
  test("contour and surface: π and − work there too", () => {
    expect(run({ fn: "sin(π*x) − y" }).ok).toBe(true);
    expect(run({ kind: "surface", fn: "cos(π*x)*y" }).ok).toBe(true);
  });
  test("a missing * is named", () => {
    const r = run({ kind: "contour", fn: "2x + y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Write \* for multiplication/);
  });
});

describe("minor", () => {
  test("a level at the field minimum says why it draws nothing", () => {
    const r = run({ fn: "x^2 + y^2", xmin: "-1", xmax: "1", ymin: "-1", ymax: "1", grid: "21", levels: "0 1" });
    expect(r.ok && r.notes.join(" ")).toMatch(/No line at 0: z only reaches it at its minimum/);
  });
  test("ranges in messages are never printed as equal when they differ", () => {
    expect(rangeText(1, 1.0001)).toEqual(["1", "1.0001"]);
    expect(rangeText(999996, 1000004)).toEqual(["999996", "1000004"]);
    expect(rangeText(2, 2)).toEqual(["2", "2"]);
    const r = run({ fn: "1 + 1e-6*x" });
    expect(r.ok && r.notes.join(" ")).not.toMatch(/from 1 to 1\b/);
  });
  test("contourPlotSvg still accepts a grid built by hand (no jump data)", () => {
    const g: Grid = { xs: [0, 1], ys: [0, 1], z: [[0, 1], [1, 2]], holes: 0 };
    expect(contourPlotSvg({ grid: g, levels: [1], filled: true })).toContain("<path");
  });
});
