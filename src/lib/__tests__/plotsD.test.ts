// Release D (v2.189.0), PLOTS part: the four items left open by Release B, each pinned here.
//
//   1. y = f(x) DATA reads through dataBlock.readDataBlock (RULE N, the one number reader).
//   2. USPTO black-and-white rendering for the plot kinds.
//   3. Contour / surface refusal advice that names what to change.
//   4. Root locus timing at the order cap (RULE F: within a small multiple of its own float floor).

import { createHash } from "crypto";
import { parseTf, polyRootsNumeric } from "../control";
import { surfacePlotSvg, sampleSurface } from "../surface3d";
import { compileExpr } from "../plot";
import { rootLocus, nyquist, RootLocusResult } from "../controlDesign";
import { CONTROL_CALCS } from "../controlCalcs";
import { readPlotData, Point, PLOT_DATA_ROWS_MAX } from "../plot";
/** The points of a pasted block (readPlotData; a refused block gives none), as the old parseData returned. */
const parseData = (text: string): Point[] => {
  const r = readPlotData(text);
  return r.ok ? r.points : [];
};

import { buildPlotKind, PlotKindInput, BW_FILLED_CONTOUR, BW_FILLED_SURFACE, NO_FINITE_Z } from "../plotKinds";
import { prepareFigure, refusalText, composePanelFigure } from "../insertCapability";
import { FIGURE_PRESETS, nonBlackWhitePaints, checkSvgAgainstPreset } from "../figureStyle";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const layoutAudit = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (name: string, svg: string) => { found: string[] } };

const tf = (n: string, d: string) => {
  const r = parseTf(n, d);
  if ("ok" in r) throw new Error(r.error);
  return r;
};

// ---------------------------------------------------------------------------
// 4. Root locus timing
// ---------------------------------------------------------------------------

/** The Release B review's contrived plant: order 20, 18 distinct decimal poles and a double pole at −0.5. */
function order20Decimal(): string {
  const mul = (a: bigint[], b: bigint[]): bigint[] => {
    const r = new Array(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
    return r;
  };
  const roots: number[] = [];
  for (let i = 0; i < 18; i++) roots.push(1234 + 777 * i);
  roots.push(5000, 5000);
  let p = [1n];
  for (const r of roots) p = mul(p, [10000n, BigInt(r)]);
  const D = 10n ** 80n;
  return p
    .map((c) => {
      const ip = c / D;
      const fp = (c % D).toString().padStart(80, "0").replace(/0+$/, "");
      return ip.toString() + (fp ? "." + fp : "");
    })
    .join(" ");
}

/** Best of three wall-clock runs, in ms (a single run on a shared CI worker is mostly noise). */
function bestOf3(f: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    f();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/**
 * The irreducible cost of this plant ON THIS MACHINE: the sweep's float eigenvalue solves (107 of
 * them for this plant, a 20×20 companion QR each). The ceilings below are multiples of this, not
 * fixed milliseconds, so a slower CI runner moves the floor and the ceiling together.
 */
function sweepFloorMs(den: string): number {
  const coeffs = den.split(/\s+/).map(Number);
  polyRootsNumeric(coeffs);
  return bestOf3(() => {
    for (let i = 0; i < 107; i++) polyRootsNumeric(coeffs);
  });
}

describe("4. root locus at the order cap (RULE F)", () => {
  // BEFORE: 0.65–0.85 s standalone, two thirds of it BigInt gcds inside ratPolyEval (reducing after
  // every Horner step on 270-bit coefficients) on top of a ~170 ms float floor: 4–5× the floor.
  // AFTER (one reduction per evaluation, ratPolyEvalFast): ~290 ms warm locally, ~1.7× the floor;
  // what remains IS the floor (107 sweep solves). A fixed 500 ms ceiling failed CI at 510 ms on a
  // slower runner (v2.189.0's first push), so the ceiling is 3× the floor measured in-process.
  test("order-20 plant with a repeated decimal pole: root locus within 3× its float floor, same answer", () => {
    const den = order20Decimal();
    const g = tf("1", den);
    rootLocus(g); // warm the JIT, as the pane is warm after its first figure
    const floor = sweepFloorMs(den);
    let rl: RootLocusResult | null = null;
    const ms = bestOf3(() => {
      rl = rootLocus(g) as RootLocusResult;
    });
    const r = rl as unknown as RootLocusResult;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(3 * floor);
    // The exact double pole at −1/2 and the 18 decimal poles are still found exactly (snapped).
    expect(r.poles.filter((p) => p.re === -0.5 && p.im === 0)).toHaveLength(2);
    expect(r.poles.some((p) => p.re === -0.1234 && p.im === 0)).toBe(true);
  });
  test("the root-locus and Nyquist calculators on that plant, end to end, within 3× the float floor", () => {
    const den = order20Decimal();
    const floor = sweepFloorMs(den);
    for (const id of ["control-rlocus", "control-nyquist"]) {
      const c = CONTROL_CALCS.find((x) => x.id === id);
      if (!c) throw new Error(id);
      const read = (key: string): string => ({ num: "1", den, k: "" } as Record<string, string>)[key] ?? c.fields.find((f) => f.key === key)?.default ?? "";
      c.compute(read);
      let out = c.compute(read);
      expect(bestOf3(() => (out = c.compute(read)))).toBeLessThan(3 * floor);
      expect(out.text).toMatch(/s²⁰/);
    }
    expect(nyquist(tf("1", den)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1. y = f(x) data through RULE N
// ---------------------------------------------------------------------------
//
// PINNED FIRST (the release method): every row below was run through the v2.188.0 parseData
// (a regex split on whitespace, commas and semicolons) before the change. SAME rows return
// byte-identical points today; CHANGED rows were silently wrong, silently dropped or genuinely
// ambiguous, and are now correct or a named refusal (each reason is in the release report). The
// notes are new: the pane draws them into the figure.

const SAME = true;
const CHANGED = false;
type Want = { points: number[][]; notes?: string[] } | { refuse: string };
const PLOT_DATA_TABLE: [string, boolean, Want][] = [
  ["0 1\n1 2\n2 4", SAME, { points: [[0, 1], [1, 2], [2, 4]] }],
  ["0\t1\n1\t2\n2\t4", SAME, { points: [[0, 1], [1, 2], [2, 4]] }],
  ["0,1\n1,2\n2,4", SAME, { points: [[0, 1], [1, 2], [2, 4]] }],
  ["0;1\n1;2\n2;4", SAME, { points: [[0, 1], [1, 2], [2, 4]] }],
  ["0, 1\n1, 2\n2, 4", SAME, { points: [[0, 1], [1, 2], [2, 4]] }],
  ["0 1 0.1\n1 2 0.2", SAME, { points: [[0, 1, 0.1], [1, 2, 0.2]] }],
  ["0\t1\t0.1\n1\t2\t0.2", SAME, { points: [[0, 1, 0.1], [1, 2, 0.2]] }],
  ["0,1,0.1\n1,2,0.2", SAME, { points: [[0, 1, 0.1], [1, 2, 0.2]] }],
  ["0; 1; 0.1\n1; 2; 0.2", SAME, { points: [[0, 1, 0.1], [1, 2, 0.2]] }],
  ["# t v\n0 1\n1 2 0.1\n\n2, 4", SAME, { points: [[0, 1], [1, 2, 0.1], [2, 4]] }],
  ["x y\n1 2\n3 4", SAME, { points: [[1, 2], [3, 4]], notes: ["The data: the first line was read as a header (x, y)."] }],
  ["x\ty\terr\n1\t2\t0.5\n3\t4\t0.5", SAME, { points: [[1, 2, 0.5], [3, 4, 0.5]], notes: ["The data: the first line was read as a header (x, y, err)."] }],
  ["Time (s)\tSignal (mV)\n0\t1.5\n1\t2.5", SAME, { points: [[0, 1.5], [1, 2.5]], notes: ["The data: the first line was read as a header (Time (s), Signal (mV))."] }],
  ["1e-3 2\n2e-3 4", SAME, { points: [[0.001, 2], [0.002, 4]] }],
  ["1E5 2\n2E5 4", SAME, { points: [[100000, 2], [200000, 4]] }],
  ["1.5e+2 3", SAME, { points: [[150, 3]] }],
  ["0 1\r\n1 2\r\n2 4\r\n", SAME, { points: [[0, 1], [1, 2], [2, 4]] }],
  ["\n\n0 1\n\n\n1 2\n\n", SAME, { points: [[0, 1], [1, 2]] }],
  ["1\n2\n3", CHANGED, { refuse: "The data: line 1 (\"1\") has one number; write x and y on every line, separated the same way (x y, or x y err)." }],
  ["5", CHANGED, { refuse: "The data: line 1 (\"5\") has one number; write x and y on every line, separated the same way (x y, or x y err)." }],
  ["1 2", SAME, { points: [[1, 2]] }],
  ["1,2", SAME, { points: [[1, 2]] }],
  ["1,5\n2,7", SAME, { points: [[1, 5], [2, 7]] }],
  ["1.5,2.5\n2.5,3.5", SAME, { points: [[1.5, 2.5], [2.5, 3.5]] }],
  ["1.5, 2.5\n2.5, 3", SAME, { points: [[1.5, 2.5], [2.5, 3]] }],
  ["0 -1\n1 -2", SAME, { points: [[0, -1], [1, -2]] }],
  ["0 1 -0.5", SAME, { points: [[0, 1, 0.5]] }],
  ["1\t−2\n2\t−4", CHANGED, { points: [[1, -2], [2, -4]] }],
  ["1 −2,5", CHANGED, { points: [[1, -2.5]], notes: ["Commas in the data were read as decimal points (European notation): “−2,5” is −2.5."] }],
  ["0 1 −0.1", CHANGED, { points: [[0, 1, 0.1]] }],
  ["1,000 2\n2,000 4", CHANGED, { refuse: "The data: “1,000” could be a number with a thousands comma (1000) or with a decimal comma (1.000), and nothing else in the data says which. Write decimals with a decimal point, or thousands without a separator." }],
  ["1,000\t2\n2,000\t4", CHANGED, { refuse: "The data: “1,000” could be a number with a thousands comma (1000) or with a decimal comma (1.000), and nothing else in the data says which. Write decimals with a decimal point, or thousands without a separator." }],
  ["2,5 3,5\n4,5 5,5", CHANGED, { points: [[2.5, 3.5], [4.5, 5.5]], notes: ["Commas in the data were read as decimal points (European notation): “2,5” is 2.5."] }],
  ["1;2,5\n2;3,5", CHANGED, { points: [[1, 2.5], [2, 3.5]], notes: ["Commas in the data were read as decimal points (European notation): “2,5” is 2.5."] }],
  ["1\t2,5\n2\t3,5", CHANGED, { points: [[1, 2.5], [2, 3.5]], notes: ["Commas in the data were read as decimal points (European notation): “2,5” is 2.5."] }],
  ["1,5 2,7", CHANGED, { points: [[1.5, 2.7]], notes: ["Commas in the data were read as decimal points (European notation): “1,5” is 1.5."] }],
  ["1 2.5\n2 3,5", CHANGED, { refuse: "The data: this block mixes 2.5 and 3,5; use one decimal mark throughout (2.88 or 2,88)." }],
  ["0,1\n1 2", CHANGED, { refuse: "The data: line 1 (\"0,1\") has one number (a comma with no space after it is part of a number when other lines are separated by spaces, tabs or semicolons); write x and y on every line, separated the same way (x y, or x y err)." }],
  ["1 2 0.1 9\n2 3 0.1 9", SAME, { points: [[1, 2, 0.1], [2, 3, 0.1]], notes: ["2 lines have more than three columns; only x, y and the error (the first three) are plotted."] }],
  ["1 2\n3\n4 5", CHANGED, { refuse: "The data: line 2 (\"3\") has one number; write x and y on every line, separated the same way (x y, or x y err)." }],
  ["1 2 abc", CHANGED, { refuse: "The data: line 1 (\"1 2 abc\") mixes words and numbers (\"abc\"). Remove the text, or put a header on its own first line." }],
  ["1 2\nfoo bar\n3 4", CHANGED, { refuse: "The data: line 2 (\"foo bar\") has no numbers. Only the first line may be a header." }],
  ["0x10 1", CHANGED, { refuse: "The data: line 1 (\"0x10 1\") mixes words and numbers (\"0x10\"). Remove the text, or put a header on its own first line." }],
  ["Infinity 2", CHANGED, { refuse: "The data: line 1 (\"Infinity 2\") mixes words and numbers (\"Infinity\"). Remove the text, or put a header on its own first line." }],
  ["1 NaN\n2 3", SAME, { points: [[2, 3]], notes: ["1 line left out: no x or no y value."] }],
  ["1 -\n2 3", SAME, { points: [[2, 3]], notes: ["1 line left out: no x or no y value."] }],
  ["1 2 -\n2 3 0.5", SAME, { points: [[1, 2], [2, 3, 0.5]] }],
  ["1\t\t2\n2\t3\t0.5", CHANGED, { points: [[2, 3, 0.5]], notes: ["1 line left out: no x or no y value."] }],
  ["1 2\t3", CHANGED, { refuse: "The data: line 1: \"1 2\" has spaces inside one tab-separated field. Separate the values with tabs, or remove the spaces (digit groups are written without them)." }],
  [",1 2", CHANGED, { refuse: "The data: line 1: \",1\" is not a number." }],
  ["1 2,", CHANGED, { refuse: "The data: line 1: \"2,\" is not a number." }],
  ["+1 2", SAME, { points: [[1, 2]] }],
  ["1. 2", SAME, { points: [[1, 2]] }],
  [".5 1", SAME, { points: [[0.5, 1]] }],
  ["50% 2", CHANGED, { points: [[50, 2]] }],
  ["1×10³ 2", CHANGED, { points: [[1000, 2]] }],
  ["   1    2   \n  3   4  ", SAME, { points: [[1, 2], [3, 4]] }],
  ["1 2;3", CHANGED, { refuse: "The data: line 1: \"1 2\" has spaces inside one semicolon-separated field. Separate the values with semicolons, or remove the spaces (digit groups are written without them)." }],
  ["1 2\n2 4\n# end", SAME, { points: [[1, 2], [2, 4]] }],
  ["1,2,3\n2,4,6", SAME, { points: [[1, 2, 3], [2, 4, 6]] }],
  ["1,2,3\n2,4,6\n3 6 9", CHANGED, { refuse: "The data: line 1: \"1,2,3\" is not a number." }],
  ["1, 2.5, 3.5\n2, 4.5, 6.5", SAME, { points: [[1, 2.5, 3.5], [2, 4.5, 6.5]] }],
  ["1.234,5 1.302,7", CHANGED, { points: [[1234.5, 1302.7]], notes: ["Commas in the data were read as decimal points (European notation): “1.234,5” is 1234.5."] }],
  ["-1 -2\n-3 -4", SAME, { points: [[-1, -2], [-3, -4]] }],
  ["1 2 3 4 5", SAME, { points: [[1, 2, 3]], notes: ["1 line has more than three columns; only x, y and the error (the first three) are plotted."] }],
  ["", SAME, { points: [] }],
  ["   ", SAME, { points: [] }],
  ["# only a comment", SAME, { points: [] }],];

describe("1. readPlotData (y = f(x) data) under RULE N", () => {
  test.each(PLOT_DATA_TABLE)("%j (unchanged from v2.188.0: %s)", (input, _same, want) => {
    const r = readPlotData(input);
    if ("refuse" in want) {
      expect(r).toEqual({ ok: false, error: want.refuse });
      expect(parseData(input)).toEqual([]);
      return;
    }
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pts = r.points.map((p) => (p.err === undefined ? [p.x, p.y] : [p.x, p.y, p.err]));
    expect(pts).toEqual(want.points);
    expect(r.notes).toEqual(want.notes ?? []);
    // parseData is the points of the same reading
    expect(parseData(input)).toEqual(r.points);
  });
  test("the table holds both kinds of row (41 unchanged, 27 changed)", () => {
    expect(PLOT_DATA_TABLE.filter((r) => r[1]).length).toBe(41);
    expect(PLOT_DATA_TABLE.filter((r) => !r[1]).length).toBe(27);
  });
  test("a 5000-row paste still reads (the old splitter had no cap; this one stops at 100 000 rows)", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `${i}\t${(i * 0.5).toFixed(1)}`).join("\n");
    const r = readPlotData(text);
    expect(r.ok && r.points.length).toBe(5000);
    expect(PLOT_DATA_ROWS_MAX).toBe(100000);
  });
  test("comment lines keep the line numbers of the paste in a refusal", () => {
    const r = readPlotData("# run 1\n1 2\n# run 2\n3");
    expect(r).toEqual({ ok: false, error: expect.stringContaining('line 4 ("3")') });
  });
  test("every message keeps the display contract (no em dash, NaN, undefined or caret)", () => {
    for (const [input] of PLOT_DATA_TABLE) {
      const r = readPlotData(input);
      const text = r.ok ? r.notes.join(" ") : r.error;
      expect(text).not.toMatch(/\u2014|NaN|undefined|\^/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. USPTO black-and-white plot kinds, and 3. refusal advice
// ---------------------------------------------------------------------------

const KBASE: PlotKindInput = {
  kind: "contour", fn: "x*y", fn2: "", xmin: "-1", xmax: "1", tmin: "0", tmax: "2*pi", ymin: "-1", ymax: "1",
  angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "", y2label: "", zlabel: "", xscale: "linear", yscale: "linear",
  y2scale: "linear", equal: false, levels: "", filled: false, grid: "", az: "", el: "", surfaceStyle: "filled",
};
const kind = (o: Partial<PlotKindInput>) => {
  const r = buildPlotKind({ ...KBASE, ...o });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const USPTO = FIGURE_PRESETS.uspto;
const BW_CASES: [string, Partial<PlotKindInput>][] = [
  ["parametric", { kind: "parametric", fn: "cos(t)", fn2: "sin(2*t)", equal: true }],
  ["polar, radians", { kind: "polar", fn: "cos(3*theta)" }],
  ["polar, degrees", { kind: "polar", fn: "1+0.5*cos(theta)", angleUnit: "deg", tmax: "360" }],
  ["two y axes", { kind: "dualy", data: "1 2 30\n2 3 20\n3 5 10\n4 6 8", xlabel: "Time (h)", ylabel: "Mass (g)", y2label: "Rate (g/h)" }],
  ["contour lines", { kind: "contour", fn: "x*y" }],
  ["contour 200 grid", { kind: "contour", fn: "sin(3*x)*cos(3*y)", grid: "200" }],
  ["contour with holes", { kind: "contour", fn: "log(x)+y", xmin: "-1", xmax: "2", ymin: "0", ymax: "2", zlabel: "T (K)" }],
  ["surface wireframe", { kind: "surface", fn: "sin(x)*cos(y)", surfaceStyle: "wireframe" }],
  ["surface wireframe with a gap", { kind: "surface", fn: "log(x*y)", xmin: "-1", xmax: "2", ymin: "0.1", ymax: "2", surfaceStyle: "wireframe", grid: "30" }],
];

describe("2. the plot kinds under the USPTO figure style", () => {
  test.each(BW_CASES)("%s: fitted, black and white only, lettering at least 3.52 mm, quickly", (_n, o) => {
    const r = kind(o);
    const t0 = Date.now();
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render, chartKind: r.chartKind });
    expect(Date.now() - t0).toBeLessThan(1500); // measured standalone at most ~40 ms; generous for a shared worker
    expect({ ok: p.ok, why: p.ok ? [] : p.problems }).toEqual({ ok: true, why: [] });
    if (!p.ok) return;
    expect(nonBlackWhitePaints(p.svg)).toEqual([]);
    const c = checkSvgAgainstPreset(p.svg, USPTO, 170);
    expect(c.ok).toBe(true);
    expect(c.minCharHeightMm as number).toBeGreaterThanOrEqual(3.52 - 1e-6);
  });
  test.each(BW_CASES)("%s: as drawn (no style, or a journal style) is the unchanged colour figure", (_n, o) => {
    const r = kind(o);
    // (a contour numbers its clip path per drawing: compared with the number taken out)
    const id = (svg: string): string => svg.replace(/contourclip\d+/g, "contourclip");
    expect(id(r.render(380))).toBe(id(r.svg));
    expect(id(r.render(380, FIGURE_PRESETS.nature))).toBe(id(r.svg));
  });
  test("contour in black and white: every drawn level is written on its lines, labels distinct, no colour bar", () => {
    const r = kind({ kind: "contour", fn: "sin(3*x)*cos(3*y)", grid: "200" });
    const svg = r.render(344, USPTO);
    // The labels on the lines are the texts drawn on a white backing (tick labels are not).
    const texts = [...svg.matchAll(/fill="#ffffff"\/><text [^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
    const values = [...new Set(texts.filter((t) => /^[−\d.]+$/.test(t)))];
    expect(values.sort()).toEqual(["−0.25", "−0.50", "−0.75", "0.00", "0.25", "0.50", "0.75"].sort());
    // Each label sits on a white backing (the layout audit's occlusion rule).
    expect((svg.match(/fill="#ffffff"\/><text/g) ?? []).length).toBeGreaterThanOrEqual(values.length);
    expect(svg).not.toMatch(/stroke="#(?!000000)[0-9a-f]{6}"/i);
  });
  test("contour holes are hatched in black and white, and the figure says hatched (grey as drawn)", () => {
    const r = kind({ kind: "contour", fn: "log(x)+y", xmin: "-1", xmax: "2", ymin: "0", ymax: "2" });
    expect(r.svg).toMatch(/grid points \(grey\)/);
    const svg = r.render(344, USPTO);
    expect(svg).toMatch(/url\(#fi-diag\)/);
    expect(svg).toMatch(/<pattern id="fi-diag"/);
    expect(svg).toMatch(/grid points \(hatched\)/);
    expect(svg).not.toMatch(/\(grey\)/);
  });
  test("automatic levels thin out until each has room; a level with no on-line spot is unlabelled, named in a note", () => {
    const auto = kind({ kind: "contour", fn: "x*y" });
    const p = prepareFigure({ svg: auto.svg, preset: "uspto", width: "single", render: auto.render });
    expect(p.ok).toBe(true);
    // Review round 1: no label is ever placed beside its line (the holes row below: unlabelled and named in a note).
    const typed = kind({ kind: "contour", fn: "sin(3*x)*cos(3*y)", levels: Array.from({ length: 30 }, (_, i) => (-0.87 + i * 0.06).toFixed(2)).join(" ") });
    const q = prepareFigure({ svg: typed.svg, preset: "uspto", width: "single", render: typed.render });
    // Thirty typed levels leave no line with room for its value: not one labelled line, so refused by name.
    expect(q.ok).toBe(false);
    if (!q.ok) expect(refusalText(q)).toMatch(/no room to write .* choose fewer levels, or levels further apart/);
    // Not one value on any line: refused by name.
    const dense = kind({ kind: "contour", fn: "sin(8*x)*cos(8*y)", xmin: "-pi", xmax: "pi", ymin: "-pi", ymax: "pi", grid: "200" });
    const d = prepareFigure({ svg: dense.svg, preset: "uspto", width: "single", render: dense.render });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(refusalText(d)).toMatch(/no room to write .* choose fewer levels, or levels further apart/);
  });
  test("the panel tray re-renders plot kinds in black and white too", () => {
    const a = kind({ kind: "polar", fn: "cos(3*theta)" });
    const b = kind({ kind: "dualy", data: "1 2 30\n2 3 20\n3 5 10" });
    const f = composePanelFigure(
      [
        { svg: a.svg, render: a.render, source: "Plot" },
        { svg: b.svg, render: b.render, source: "Plot" },
      ],
      "uspto",
      "single",
      2,
    );
    expect({ ok: f.ok, why: f.ok ? [] : f.problems }).toEqual({ ok: true, why: [] });
    if (f.ok) expect(nonBlackWhitePaints(f.svg)).toEqual([]);
  });
});

describe("3. contour and surface refusals say what to change", () => {
  test("filled contour and filled surface under USPTO: advice for these kinds, not the Table→Chart heat-map advice", () => {
    for (const [o, advice] of [
      [{ kind: "contour", filled: true }, BW_FILLED_CONTOUR],
      [{ kind: "surface" }, BW_FILLED_SURFACE],
    ] as [Partial<PlotKindInput>, string][]) {
      const r = kind(o);
      expect(r.chartKind).toBeUndefined();
      const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render, chartKind: r.chartKind });
      expect(p.ok).toBe(false);
      if (p.ok) continue;
      expect(refusalText(p)).toBe(`This figure could not be redrawn for USPTO drawing (black and white) at 170 mm: ${advice}.`);
      expect(refusalText(p)).not.toMatch(/heat map|column, bar or line|—/);
    }
    expect(BW_FILLED_CONTOUR).toBe(
      "filled contour bands carry z in shading, and 37 CFR 1.84(a)(1) requires black-and-white line art. Turn off Filled bands: the contour lines are then drawn in black with each level written on its line",
    );
    expect(BW_FILLED_SURFACE).toBe(
      "a filled surface carries z in colour, and 37 CFR 1.84(a)(1) requires black-and-white line art. Choose the Wireframe surface style: it is drawn as black line art with hidden lines removed",
    );
  });
  test.each([
    [{ kind: "contour", fn: "1" }, "z is constant (1) over the whole rectangle, so it has no contours. Check the formula, or widen the x and y ranges to take in a region where z changes."],
    [{ kind: "contour", fn: "sin(x)^2+cos(x)^2" }, "z is constant (1, to within rounding) over the whole rectangle, so it has no contours. Check the formula, or widen the x and y ranges to take in a region where z changes."],
    [{ kind: "surface", fn: "sin(x)^2+cos(x)^2" }, "z is constant (1) to within rounding over the whole rectangle; there is no surface shape to draw. Check the formula (it may simplify to a constant), or widen the x and y ranges."],
    [{ kind: "contour", fn: "log(-1-x*x)" }, "NO_FINITE_Z"],
    [{ kind: "surface", fn: "sqrt(-1-y*y)" }, "NO_FINITE_Z"],
    [{ kind: "contour", fn: "1e308*x*y*10" }, "z spans too wide a range to contour (beyond about 10³⁰⁷); rescale the formula."],
    [{ kind: "contour", fn: "x", grid: "3" }, "Grid points per side must be a whole number from 5 to 200."],
  ] as [Partial<PlotKindInput>, string][])("%j", (o, msg) => {
    expect(buildPlotKind({ ...KBASE, ...o })).toEqual({ ok: false, error: msg === "NO_FINITE_Z" ? NO_FINITE_Z : msg });
  });
  test("the no-finite-value advice names the fix", () => {
    expect(NO_FINITE_Z).toBe("z has no finite value anywhere in the rectangle; move the x and y ranges to where the formula is defined (log and sqrt need positive arguments).");
  });
});

// ---------------------------------------------------------------------------
// Review round 1 (Release D): three USPTO drawing defects, each repro a row.
// ---------------------------------------------------------------------------

/** Labels drawn on a white backing (the contour values), with their centres. */
function lineLabels(svg: string): { text: string; x: number; y: number }[] {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#ffffff"\/><text [^>]*>([^<]+)<\/text>/g)].map((m) => ({
    text: m[5],
    x: Number(m[1]) + Number(m[3]) / 2,
    y: Number(m[2]) + Number(m[4]) / 2,
  }));
}
/** Every drawn contour path's segments, by path (one path per level in black and white). */
function contourPaths(svg: string): [number, number, number, number][][] {
  return [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#000000"/g)].map((m) => {
    const segs: [number, number, number, number][] = [];
    for (const sub of m[1].split("M").filter(Boolean)) {
      const pts = [...sub.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((q) => [Number(q[1]), Number(q[2])]);
      for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    }
    return segs;
  });
}
const segDist = (px: number, py: number, [x0, y0, x1, y1]: [number, number, number, number]): number => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L)) : 0;
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
};

describe("review round 1, item 4: every contour value sits ON its own line and reads back as its level", () => {
  const CONTOURS: [string, Partial<PlotKindInput>][] = [
    ["holes log(x)+y (the −1 label was 12.3 px off its line)", { kind: "contour", fn: "log(x)+y", xmin: "-1", xmax: "2", ymin: "0", ymax: "2", zlabel: "T (K)" }],
    ["saddle x·y", { kind: "contour", fn: "x*y" }],
    ["peaks", { kind: "contour", fn: "exp(-(x^2+y^2))*cos(2*x)", xmin: "-2", xmax: "2", ymin: "-2", ymax: "2" }],
    ["egg crate, 200 grid", { kind: "contour", fn: "sin(3*x)*cos(3*y)", grid: "200" }],
    ["typed levels", { kind: "contour", fn: "sin(3*x)*cos(3*y)", levels: "-0.6 0 0.6" }],
    ["rings x² + y²", { kind: "contour", fn: "x^2 + y^2", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3" }],
  ];
  test.each(CONTOURS)("%s", (_n, o) => {
    const r = kind(o);
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const paths = contourPaths(p.svg);
    const labels = lineLabels(p.svg);
    expect(labels.length).toBeGreaterThan(0);
    // The level each path carries is the text of the labels on it: one text per path, a different text per path.
    const textOfPath = new Map<number, string>();
    for (const lb of labels) {
      let best = Infinity;
      let which = -1;
      paths.forEach((segs, k) => {
        for (const sg of segs) {
          const d = segDist(lb.x, lb.y, sg);
          if (d < best) {
            best = d;
            which = k;
          }
        }
      });
      expect({ label: lb.text, distancePx: best <= 2.5 }).toEqual({ label: lb.text, distancePx: true });
      if (textOfPath.has(which)) expect(textOfPath.get(which)).toBe(lb.text);
      textOfPath.set(which, lb.text);
    }
    const texts = [...textOfPath.values()];
    expect(new Set(texts).size).toBe(texts.length);
  });
  test("the holes figure: −1 has no on-line spot, so it is unlabelled and the figure says so", () => {
    const r = kind(CONTOURS[0][1]);
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(lineLabels(p.svg).map((l) => l.text)).not.toContain("−1");
    expect(p.svg).toMatch(/No room to write −1 on its line/);
  });
});

describe("review round 1, item 5: two-y-axes titles are never clipped and the key is never shortened", () => {
  const dualBase: Partial<PlotKindInput> = { kind: "dualy", data: "0 1 10\n1 2 15\n2 4 18\n3 8 21", xlabel: "Time (h)", ylabel: "Mass (g)" };
  test.each(["Rate (g/h)", "Reaction rate (g/h)", "Reaction rate per hour (g/h)", "Absorbance at 280 nm (AU)", "Absorbance counts per second"])("y₂ title %j", (y2) => {
    const r = kind({ ...dualBase, y2label: y2 });
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const h = Number(/height="([\d.]+)"/.exec(p.svg)?.[1]);
    const rotated = [...p.svg.matchAll(/<text([^>]*rotate[^>]*)>([^<]*)<\/text>/g)];
    // All of the title's words are drawn (on one or two lines) …
    expect(rotated.filter((m) => !/Mass/.test(m[2])).map((m) => m[2]).join(" ")).toBe(y2);
    for (const m of rotated) {
      const cy = Number(/ y="([\d.-]+)"/.exec(m[1])?.[1]);
      const fs = Number(/font-size="([\d.]+)"/.exec(m[1])?.[1]);
      const half = (m[2].length * fs * 0.6) / 2; // a conservative Arial advance
      // … and every line lies wholly on the canvas.
      expect({ line: m[2], top: cy - half >= 0, bottom: cy + half <= h }).toEqual({ line: m[2], top: true, bottom: true });
    }
    expect(p.svg).not.toMatch(/…/);
  });
  test("a single word too long even for two lines is refused by name", () => {
    const r = kind({ ...dualBase, y2label: "Spectrophotometricabsorbanceunitsatwavelength280nm" });
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(refusalText(p)).toMatch(/right axis title .* is too long to fit beside the plot in a USPTO drawing .* shorten it/);
  });
});

describe("review round 1, item 6: wireframe surface titles never run over the box or the tick labels", () => {
  const surf: Partial<PlotKindInput> = { kind: "surface", fn: "exp(-(x^2+y^2))", xmin: "-2", xmax: "2", ymin: "-2", ymax: "2", surfaceStyle: "wireframe" };
  test("long titles (the repro) are refused by name rather than drawn over the box", () => {
    const r = kind({ ...surf, xlabel: "Horizontal displacement (mm)", ylabel: "Vertical displacement (mm)", zlabel: "Intensity (a.u.)" });
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(refusalText(p)).toMatch(/axis title “.*” has no room beside the 3D box in a USPTO drawing .* shorten it/);
  });
  test.each([
    ["medium titles", { xlabel: "Position x (mm)", ylabel: "Position y (mm)", zlabel: "Intensity" }],
    ["az 135", { xlabel: "Position x (mm)", ylabel: "Position y (mm)", zlabel: "Intensity", az: "135", el: "20" }],
    ["default titles", {}],
  ] as [string, Partial<PlotKindInput>][])("%s: drawn, and the layout audit finds no collision, strikethrough or clipping", (_n, o) => {
    const r = kind({ ...surf, ...o });
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render });
    expect(p.ok).toBe(true);
    if (p.ok) expect(layoutAudit.auditSvg("surface", p.svg).found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Final review: the surface title rule in EVERY style (as drawn, journal, USPTO).
// ---------------------------------------------------------------------------

describe("final review: surface axis titles clear of the box, the ticks and the canvas in every style", () => {
  const surfBase: Partial<PlotKindInput> = { kind: "surface", fn: "exp(-(x^2+y^2))", xmin: "-2", xmax: "2", ymin: "-2", ymax: "2", surfaceStyle: "wireframe" };
  const TITLES: Record<string, Partial<PlotKindInput>> = {
    short: {},
    medium: { xlabel: "Position x (mm)", ylabel: "Position y (mm)", zlabel: "Intensity" },
    long: { xlabel: "Horizontal displacement (mm)", ylabel: "Vertical displacement (mm)", zlabel: "Intensity (a.u.)" },
  };
  const ROWS: [string, "asdrawn" | "nature" | "uspto", boolean][] = [
    ["short", "asdrawn", true],
    ["short", "nature", true],
    ["short", "uspto", true],
    ["medium", "asdrawn", true],
    ["medium", "nature", true],
    ["medium", "uspto", true],
    ["long", "asdrawn", true], // was drawn over the tick labels; the side margin now widens for it
    ["long", "nature", true], // the same, re-rendered at the Nature column width
    ["long", "uspto", false], // no room at USPTO lettering even on two lines: refused by name
  ];
  test.each(ROWS)("%s titles, %s style (drawn: %s)", (t, preset, drawn) => {
    const r = kind({ ...surfBase, ...TITLES[t] });
    const p = prepareFigure({ svg: r.svg, preset, width: "single", render: r.render });
    expect(p.ok).toBe(drawn);
    if (p.ok) expect(layoutAudit.auditSvg(`surface ${t} ${preset}`, p.svg).found).toEqual([]);
    else expect(refusalText(p)).toMatch(/axis title “Vertical displacement \(mm\)” has no room beside the 3D box in a USPTO drawing .* shorten it/);
  });
  test("long titles at other views, as drawn: never over the ticks (the margin widens), audit clean", () => {
    for (const v of [{ az: "30", el: "45" }, { az: "0", el: "90" }, { az: "135", el: "20" }, { az: "-120", el: "10" }]) {
      const r = kind({ ...surfBase, ...TITLES.long, ...v });
      expect(layoutAudit.auditSvg(`surface long ${v.az}/${v.el}`, r.svg).found).toEqual([]);
    }
  });
  test("seen from directly above, the z axis (a point on the page) is left out and the figure says so", () => {
    const r = kind({ ...surfBase, az: "0", el: "90" });
    const words = (svg: string): string => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
    expect(words(r.svg)).toMatch(/From this view the z axis edge has no length on the page, so z is not labelled\./);
    // The side view along x: the x edge is a point, so x (and its title) is left out, and the figure says so.
    const side = kind({ ...surfBase, az: "0", el: "0", xlabel: "Position x (mm)" });
    expect(side.svg).not.toMatch(/Position x \(mm\)/);
    expect(words(side.svg)).toMatch(/the x axis edge has no length on the page/);
  });
  test("default-style figures with short titles at ordinary views are byte-identical to v2.188.0", () => {
    // sha256 prefixes of the v2.188.0 surfacePlotSvg output for the same inputs (computed before the change).
    const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
    const fig = (fn: string, lo: number, hi: number, az: number, el: number, style: "filled" | "wireframe"): string =>
      surfacePlotSvg({ grid: sampleSurface(compileExpr(fn, ["x", "y"]), lo, hi, lo, hi, 30), azimuthDeg: az, elevationDeg: el, style, width: 380 });
    expect(hash(fig("sin(x)*cos(y)", -3, 3, -60, 30, "wireframe"))).toBe("4dc7237c5db90436");
    expect(hash(fig("sin(x)*cos(y)", -3, 3, -60, 30, "filled"))).toBe("49182f8a730d917e");
    expect(hash(fig("exp(-(x^2+y^2))", -2, 2, 135, 20, "wireframe"))).toBe("1a8ead77357e4931");
    expect(hash(fig("x^2-y^2", -2, 2, -120, 10, "filled"))).toBe("3ceec5fc8cf66ef8");
  });
});
