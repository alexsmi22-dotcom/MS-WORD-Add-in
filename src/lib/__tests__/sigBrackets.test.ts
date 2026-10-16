// Significance brackets: built only from engine results, p = the engine's p,
// display-contract p labels, no crossings, and an axis that grows to fit.
import * as fs from "fs";
import * as path from "path";
import {
  bracketsFromTukey,
  bracketsFromPairwise,
  bracketLegend,
  formatPValue,
  starsFor,
  stackBrackets,
  planBrackets,
  isSigBracketSet,
  type SigBracketSet,
} from "../sigBrackets";
import { tukeyHSD } from "../tukey";
import { twoSampleTTest, pairedTTest } from "../stats";
import { mannWhitneyU, wilcoxonSignedRank, adjustPValues } from "../stats2";
import { boxPlotSvg, groupedBarSvg } from "../statchart";

// ---------------------------------------------------------------------------
// Published cross-check: R's PlantGrowth (Dobson, A. J. (1983) An Introduction
// to Statistical Modelling, Chapman & Hall; R `datasets::PlantGrowth`). Data as
// published in the Rdatasets mirror,
// https://vincentarelbundock.github.io/Rdatasets/csv/datasets/PlantGrowth.csv
// (fetched 2026-10-14). R's TukeyHSD(aov(weight ~ group, PlantGrowth)), quoted
// from r-bloggers, "Tukey's Test for Post-Hoc Analysis" (2018-09),
// https://www.r-bloggers.com/2018/09/tukeys-test-for-post-hoc-analysis/ :
//
//                diff        lwr       upr     p adj
//   trt1-ctrl -0.371 -1.0622161 0.3202161 0.3908711
//   trt2-ctrl  0.494 -0.1972161 1.1852161 0.1979960
//   trt2-trt1  0.865  0.1737839 1.5562161 0.0120064
//
// R reports LATER minus EARLIER; tukeyHSD's pair (i, j) reports mean_i - mean_j,
// so the signs flip and pairs are matched by index, never by order of listing.
// ---------------------------------------------------------------------------
const CTRL = [4.17, 5.58, 5.18, 6.11, 4.5, 4.61, 5.17, 4.53, 5.33, 5.14];
const TRT1 = [4.81, 4.17, 4.41, 3.59, 5.87, 3.83, 6.03, 4.89, 4.32, 4.69];
const TRT2 = [6.31, 5.12, 5.54, 5.5, 5.37, 5.29, 4.92, 6.15, 5.8, 5.26];
const R_TUKEY: Array<{ i: number; j: number; laterMinusEarlier: number; p: number }> = [
  { i: 0, j: 1, laterMinusEarlier: -0.371, p: 0.3908711 },
  { i: 0, j: 2, laterMinusEarlier: 0.494, p: 0.197996 },
  { i: 1, j: 2, laterMinusEarlier: 0.865, p: 0.0120064 },
];

describe("Tukey HSD brackets against R's PlantGrowth", () => {
  const r = tukeyHSD([CTRL, TRT1, TRT2]);
  if (!r) throw new Error("tukeyHSD returned null on PlantGrowth");
  const set = bracketsFromTukey(r);

  test.each(R_TUKEY)("pair ($i, $j) matches R", (row) => {
    const pr = r.pairs.find((p) => p.i === row.i && p.j === row.j)!;
    expect(pr.difference).toBeCloseTo(-row.laterMinusEarlier, 10);
    // The engine vs R: 4 significant figures (quadrature tolerance).
    expect(Math.abs(pr.p - row.p)).toBeLessThan(5e-4);
    // The bracket vs the engine: EXACTLY the same number.
    const b = set.brackets.find((x) => x.i === row.i && x.j === row.j)!;
    expect(b.p).toBe(pr.p);
    expect(b.rawP).toBe(pr.p);
    expect(b.test).toBe("Tukey HSD");
  });

  test("labels: only trt2 vs trt1 is starred, and as one star (p ≈ 0.012)", () => {
    const labels = set.brackets.map((b) => `${b.i}-${b.j}:${starsFor(b.p)}:${formatPValue(b.p)}`);
    expect(labels).toEqual(["0-1:ns:p = 0.391", "0-2:ns:p = 0.198", "1-2:*:p = 0.012"]);
  });

  test("the legend states thresholds, test and that Tukey p is family-wise", () => {
    const leg = bracketLegend(set);
    expect(leg).toContain("* p < 0.05");
    expect(leg).toContain("**** p < 0.0001");
    expect(leg).toContain("ns p ≥ 0.05");
    expect(leg).toContain("Tukey HSD, 3 pairwise comparisons");
    expect(leg).toContain("family-wise");
  });

  test("the box plot draws the brackets with the engine's p on them", () => {
    const svg = boxPlotSvg(
      [
        { label: "ctrl", values: CTRL },
        { label: "trt1", values: TRT1 },
        { label: "trt2", values: TRT2 },
      ],
      { ylabel: "Dried weight (g)", brackets: { set, display: { label: "p" } } },
    );
    const got = Array.from(svg.matchAll(/data-sig-bracket="(\d+)-(\d+)" data-p="([^"]+)"/g), (m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(got).toHaveLength(3);
    for (const [i, j, p] of got) expect(p).toBe(r.pairs.find((x) => x.i === i && x.j === j)!.p);
    expect(svg).toContain(">p = 0.012</text>");
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe("brackets cannot be built from anything but engine results", () => {
  test("a hand-built set is refused at compile time and at run time", () => {
    const forged = { brackets: [{ i: 0, j: 1, p: 0.001, rawP: 0.001, test: "t-test" }], correction: "none", groupCount: null, alpha: null };
    // @ts-expect-error -- a literal is not a SigBracketSet (the brand symbol is not exported)
    const typed: SigBracketSet = forged;
    expect(isSigBracketSet(typed)).toBe(false);
    expect(() => planBrackets(forged as unknown as SigBracketSet, 2, () => 0)).toThrow(TypeError);
    expect(() =>
      boxPlotSvg([{ label: "a", values: [1, 2] }, { label: "b", values: [3, 4] }], { brackets: { set: forged as unknown as SigBracketSet } }),
    ).toThrow(TypeError);
  });

  test("a t-test result with an edited p is refused", () => {
    const t = twoSampleTTest(CTRL, TRT2);
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, kind: "t", result: t }], "none")).not.toThrow();
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, kind: "t", result: { ...t, p: 0.0001 } }], "none")).toThrow(/self-consistent/);
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, kind: "t", result: { ...t, p: NaN } }], "none")).toThrow();
  });

  test("a rank-test result with an edited p, or named as the wrong test, is refused", () => {
    const mw = mannWhitneyU(CTRL, TRT2);
    const wx = wilcoxonSignedRank(CTRL, TRT2);
    expect(bracketsFromPairwise([{ i: 0, j: 1, kind: "mann-whitney", result: mw }], "none").brackets[0].p).toBe(mw.p);
    expect(bracketsFromPairwise([{ i: 0, j: 1, kind: "wilcoxon", result: wx }], "none").brackets[0].test).toBe("Wilcoxon signed-rank");
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, kind: "mann-whitney", result: { ...mw, p: 0.0001 } }], "none")).toThrow(/refused/);
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, kind: "wilcoxon", result: mw }], "none")).toThrow(/refused/);
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, kind: "mann-whitney", result: wx }], "none")).toThrow(/refused/);
  });

  test("a forged Tukey result (bad indices, impossible p, missing pairs) is refused", () => {
    const r = tukeyHSD([CTRL, TRT1, TRT2])!;
    expect(() => bracketsFromTukey({ ...r, pairs: r.pairs.slice(1) })).toThrow(/pairs/);
    expect(() => bracketsFromTukey({ ...r, pairs: r.pairs.map((p) => ({ ...p, p: 1.5 })) })).toThrow(/probability/);
    expect(() => bracketsFromTukey({ ...r, pairs: r.pairs.map((p) => ({ ...p, j: 7 })) })).toThrow(RangeError);
  });

  test("brackets are frozen", () => {
    const set = bracketsFromTukey(tukeyHSD([CTRL, TRT1, TRT2])!);
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.brackets[0])).toBe(true);
  });
});

describe("pairwise sets: correction is explicit and uses adjustPValues", () => {
  const t01 = twoSampleTTest(CTRL, TRT1);
  const t02 = twoSampleTTest(CTRL, TRT2);
  const t12 = twoSampleTTest(TRT1, TRT2);
  const cmp = [
    { i: 0, j: 1, kind: "t" as const, result: t01 },
    { i: 0, j: 2, kind: "t" as const, result: t02 },
    { i: 2, j: 1, kind: "t" as const, result: t12 },
  ];

  test.each(["bonferroni", "holm", "bh"] as const)("%s: p = adjustPValues(engine p), rawP = engine p", (m) => {
    const set = bracketsFromPairwise(cmp, m);
    const adj = adjustPValues([t01.p, t02.p, t12.p], m);
    expect(set.brackets.map((b) => b.p)).toEqual(adj);
    expect(set.brackets.map((b) => b.rawP)).toEqual([t01.p, t02.p, t12.p]);
    // (2, 1) is normalised to i < j.
    expect([set.brackets[2].i, set.brackets[2].j]).toEqual([1, 2]);
  });

  test("the legend names the correction, or says there was none", () => {
    expect(bracketLegend(bracketsFromPairwise(cmp, "holm"))).toContain("adjusted by Holm");
    expect(bracketLegend(bracketsFromPairwise(cmp, "none"))).toContain("NOT corrected for multiple comparisons");
    expect(bracketLegend(bracketsFromPairwise(cmp.slice(0, 1), "none"))).not.toContain("corrected");
  });

  test("a paired t-test is named as one", () => {
    const set = bracketsFromPairwise([{ i: 0, j: 1, kind: "t", result: pairedTTest(CTRL, TRT2) }], "none");
    expect(set.brackets[0].test).toBe("paired t-test");
  });

  test("hidden ns brackets are counted in the legend, never silently dropped", () => {
    const set = bracketsFromPairwise(cmp, "none");
    const ns = set.brackets.filter((b) => b.p >= 0.05).length;
    expect(ns).toBeGreaterThan(0);
    expect(bracketLegend(set, { showNs: false })).toContain(`${ns} non-significant comparison`);
  });

  test("duplicates, self-comparisons and an unknown correction are refused", () => {
    expect(() => bracketsFromPairwise([cmp[0], cmp[0]], "none")).toThrow(/twice/);
    expect(() => bracketsFromPairwise([{ ...cmp[0], j: 0 }], "none")).toThrow(/itself/);
    expect(() => bracketsFromPairwise(cmp, "sidak" as never)).toThrow(/correction/);
    expect(() => bracketsFromPairwise([], "none")).toThrow();
  });
});

describe("p labels follow the display contract", () => {
  test.each([
    [0.003, "p = 0.003"],
    [0.027, "p = 0.027"],
    [0.0004, "p < 0.001"],
    [0, "p < 0.001"],
    [0.001, "p = 0.001"],
    [0.0496, "p = 0.0496"], // "0.050" would sit beside a "*"
    [0.04999, "p = 0.04999"],
    [0.00996, "p = 0.00996"], // "0.010" would sit beside a "*" instead of "**"
    [0.05, "p = 0.050"],
    [0.5, "p = 0.500"],
    [0.9995, "p > 0.999"],
    [1, "p > 0.999"],
  ])("%p → %s", (p, s) => {
    expect(formatPValue(p)).toBe(s);
    expect(s).not.toMatch(/p=|\s\.\d|0\.000(?!\d*[1-9])|e-/);
  });

  test("the rounded label never crosses a star threshold (sweep)", () => {
    for (let k = 1; k < 100000; k++) {
      const p = k / 100000;
      const s = formatPValue(p);
      if (s.startsWith("p = ")) expect(starsFor(Number(s.slice(4)))).toBe(starsFor(p));
    }
  });

  test("non-probabilities are refused", () => {
    for (const p of [NaN, -0.1, 1.2, Infinity]) expect(() => formatPValue(p)).toThrow(RangeError);
  });

  test("stars and thresholds", () => {
    expect([0.00005, 0.0005, 0.005, 0.03, 0.05, 0.2].map(starsFor)).toEqual(["****", "***", "**", "*", "ns", "ns"]);
  });
});

// ---------------------------------------------------------------------------
// Geometry, measured on the DRAWN svg
// ---------------------------------------------------------------------------
interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Drawn {
  key: string;
  segs: Seg[];
  barY: number;
  legBottom: number;
  label: { x0: number; x1: number; y0: number; y1: number };
}

function drawnBrackets(svg: string): Drawn[] {
  const out: Drawn[] = [];
  const re = /<g data-sig-bracket="([^"]+)"[^>]*><path d="M([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+)"[^>]*\/><text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text><\/g>/g;
  for (const m of svg.matchAll(re)) {
    const n = m.slice(2, 13).map(Number);
    const [ax, ay, bx, by, cx, cy, dx, dy, tx, ty, fs] = n;
    const text = m[13].replace(/&lt;/g, "<");
    const w = text.length * fs * 0.62;
    out.push({
      key: m[1],
      segs: [
        { x1: ax, y1: ay, x2: bx, y2: by },
        { x1: bx, y1: by, x2: cx, y2: cy },
        { x1: cx, y1: cy, x2: dx, y2: dy },
      ],
      barY: by,
      legBottom: Math.max(ay, dy),
      label: { x0: tx - w / 2, x1: tx + w / 2, y0: ty - fs, y1: ty },
    });
  }
  return out;
}

/** Axis-aligned segments (all bracket segments are) intersect, touching included. */
function segsMeet(a: Seg, b: Seg): boolean {
  const ax0 = Math.min(a.x1, a.x2), ax1 = Math.max(a.x1, a.x2), ay0 = Math.min(a.y1, a.y2), ay1 = Math.max(a.y1, a.y2);
  const bx0 = Math.min(b.x1, b.x2), bx1 = Math.max(b.x1, b.x2), by0 = Math.min(b.y1, b.y2), by1 = Math.max(b.y1, b.y2);
  return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1;
}
function boxMeetsSeg(l: Drawn["label"], s: Seg): boolean {
  return segsMeet({ x1: l.x0, y1: l.y0, x2: l.x1, y2: l.y0 }, s) || segsMeet({ x1: l.x0, y1: l.y1, x2: l.x1, y2: l.y1 }, s) ||
    (Math.min(s.x1, s.x2) <= l.x1 && Math.max(s.x1, s.x2) >= l.x0 && Math.min(s.y1, s.y2) <= l.y1 && Math.max(s.y1, s.y2) >= l.y0);
}
function boxesMeet(a: Drawn["label"], b: Drawn["label"]): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function assertClean(svg: string, expected: number, plotTop: number, dataTopY: number) {
  const d = drawnBrackets(svg);
  expect(d).toHaveLength(expected);
  for (let a = 0; a < d.length; a++) {
    // Above every data mark, below the top of the plot area.
    expect(d[a].legBottom).toBeLessThan(dataTopY);
    expect(d[a].label.y0).toBeGreaterThanOrEqual(plotTop - 1e-9);
    for (let b = a + 1; b < d.length; b++) {
      for (const s of d[a].segs) for (const t of d[b].segs) {
        if (segsMeet(s, t)) throw new Error(`brackets ${d[a].key} and ${d[b].key} cross`);
      }
      for (const t of d[b].segs) if (boxMeetsSeg(d[a].label, t)) throw new Error(`label of ${d[a].key} hits bracket ${d[b].key}`);
      for (const t of d[a].segs) if (boxMeetsSeg(d[b].label, t)) throw new Error(`label of ${d[b].key} hits bracket ${d[a].key}`);
      if (boxesMeet(d[a].label, d[b].label)) throw new Error(`labels of ${d[a].key} and ${d[b].key} overlap`);
    }
  }
}

/** Topmost data mark (smallest px y) in a box plot: points and whisker caps. */
function boxDataTop(svg: string): number {
  const ys = Array.from(svg.matchAll(/<circle[^>]*cy="([\d.-]+)" r="([\d.]+)"/g), (m) => Number(m[1]) - Number(m[2]));
  return Math.min(...ys);
}

function groupsFor(k: number): number[][] {
  // Deterministic, spread so p values range from ns to ****.
  return Array.from({ length: k }, (_, g) => [0, 0.4, 0.8, 1.2, 0.3, 0.9].map((v, t) => g * 0.7 + v + ((g * 7 + t * 3) % 5) * 0.1));
}

describe("no two brackets cross, and the axis grows to fit (all pairs, k = 3..8)", () => {
  for (let k = 3; k <= 8; k++) {
    for (const label of ["stars", "p"] as const) {
      test(`k = ${k}, ${label}`, () => {
        const groups = groupsFor(k);
        const set = bracketsFromTukey(tukeyHSD(groups)!);
        const h = 250 + 30 * ((k * (k - 1)) / 2) * (label === "p" ? 1.2 : 1);
        const svg = boxPlotSvg(
          groups.map((v, g) => ({ label: `G${g + 1}`, values: v })),
          { title: "t", w: 120 + 90 * k, h, brackets: { set, display: { label } } },
        );
        expect(svg).not.toMatch(/NaN|Infinity/);
        assertClean(svg, (k * (k - 1)) / 2, 26, boxDataTop(svg));
      });
    }
  }

  test("brackets sharing an endpoint never share a level", () => {
    const lv = stackBrackets([
      { x1: 0, x2: 100, labelW: 5 },
      { x1: 100, x2: 200, labelW: 5 },
    ]);
    expect(lv[0]).not.toBe(lv[1]);
  });

  test("a wider bracket sits above every narrower one it overlaps", () => {
    const items = [
      { x1: 0, x2: 300, labelW: 5 },
      { x1: 0, x2: 100, labelW: 5 },
      { x1: 200, x2: 300, labelW: 5 },
    ];
    const lv = stackBrackets(items);
    expect(lv[1]).toBe(0);
    expect(lv[2]).toBe(0);
    expect(lv[0]).toBe(1);
  });

  test("the y axis max is raised: the top tick is higher with brackets than without", () => {
    const groups = [CTRL, TRT1, TRT2].map((v, g) => ({ label: `g${g}`, values: v }));
    const set = bracketsFromTukey(tukeyHSD([CTRL, TRT1, TRT2])!);
    const topTick = (svg: string) => Math.max(...Array.from(svg.matchAll(/text-anchor="end" font-family="Segoe UI, Arial" font-size="10" fill="#6b7280">([\d.]+)</g), (m) => Number(m[1])));
    const plain = boxPlotSvg(groups, {});
    const withB = boxPlotSvg(groups, { brackets: { set } });
    expect(topTick(withB)).toBeGreaterThan(topTick(plain));
    assertClean(withB, 3, 12, boxDataTop(withB));
  });

  test("grouped bars: brackets over categories, above the tallest bar", () => {
    const set = bracketsFromTukey(tukeyHSD([CTRL, TRT1, TRT2])!);
    const svg = groupedBarSvg(["ctrl", "trt1", "trt2"], [{ label: "mean", values: [5.032, 4.661, 5.526] }], { brackets: { set } });
    // The first three blue rects are the bars; the fourth is the legend key.
    const tops = Array.from(svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="[\d.]+" fill="#2563eb"/g), (m) => Number(m[1])).slice(0, 3);
    expect(tops).toHaveLength(3);
    assertClean(svg, 3, 12, Math.min(...tops));
  });
});

describe("at the DEFAULT chart size (380 × 280), the common cases fit", () => {
  for (const k of [3, 4]) {
    for (const title of [undefined, "Tukey HSD"]) {
      for (const label of ["stars", "p"] as const) {
        test(`k = ${k}, ${title ? "titled" : "untitled"}, ${label}`, () => {
          const groups = groupsFor(k);
          const set = bracketsFromTukey(tukeyHSD(groups)!);
          const svg = boxPlotSvg(groups.map((v, g) => ({ label: `G${g + 1}`, values: v })), { title, brackets: { set, display: { label } } });
          assertClean(svg, (k * (k - 1)) / 2, title ? 26 : 12, boxDataTop(svg));
        });
      }
    }
  }

  test("equal spans do not cascade: [0,1], [1,2], [2,3] take levels 0, 1, 0", () => {
    expect(stackBrackets([0, 1, 2].map((g) => ({ x1: g * 100, x2: g * 100 + 100, labelW: 10 })))).toEqual([0, 1, 0]);
  });

  test("k = 5 at default size: drawn cleanly, or refused with the remedy", () => {
    const groups = groupsFor(5);
    const set = bracketsFromTukey(tukeyHSD(groups)!);
    try {
      const svg = boxPlotSvg(groups.map((v, g) => ({ label: `G${g + 1}`, values: v })), { title: "t", brackets: { set } });
      assertClean(svg, 10, 26, boxDataTop(svg));
    } catch (e) {
      expect(String(e)).toMatch(/taller or hide the non-significant/);
    }
  });
});

describe("the real layout auditor (scripts/figure-layout-audit.js) passes bracketed figures", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const audit = require("../../../scripts/figure-layout-audit.js") as { auditSvg: (n: string, s: string) => { found: string[]; textCount: number } };
  const plant = [CTRL, TRT1, TRT2].map((v, g) => ({ label: ["ctrl", "trt1", "trt2"][g], values: v }));
  const set = bracketsFromTukey(tukeyHSD([CTRL, TRT1, TRT2])!);
  const g4 = groupsFor(4);
  const cases: Array<[string, () => string]> = [
    ["PlantGrowth stars", () => boxPlotSvg(plant, { title: "Weight", ylabel: "g", brackets: { set } })],
    ["PlantGrowth p", () => boxPlotSvg(plant, { title: "Weight", ylabel: "g", brackets: { set, display: { label: "p" } } })],
    ["k = 4 default", () => boxPlotSvg(g4.map((v, g) => ({ label: `G${g + 1}`, values: v })), { brackets: { set: bracketsFromTukey(tukeyHSD(g4)!) } })],
    ["k = 4 default p", () => boxPlotSvg(g4.map((v, g) => ({ label: `G${g + 1}`, values: v })), { brackets: { set: bracketsFromTukey(tukeyHSD(g4)!), display: { label: "p" } } })],
    ["bars", () => groupedBarSvg(["ctrl", "trt1", "trt2"], [{ label: "mean", values: [5.032, 4.661, 5.526] }], { ylabel: "g", brackets: { set, display: { label: "p" } } })],
  ];
  test.each(cases)("%s", (name, f) => {
    const r = audit.auditSvg(name, f());
    expect(r.textCount).toBeGreaterThan(0);
    expect(r.found).toEqual([]);
  });
});

describe("refusals with a reason, never a silent drop", () => {
  const set3 = bracketsFromTukey(tukeyHSD([CTRL, TRT1, TRT2])!);

  test("a Tukey result on a different number of groups than the chart", () => {
    expect(() => boxPlotSvg([{ label: "a", values: CTRL }, { label: "b", values: TRT1 }], { brackets: { set: set3 } })).toThrow(/compares 3 groups/);
  });

  test("a pairwise bracket pointing past the last group", () => {
    const set = bracketsFromPairwise([{ i: 0, j: 3, kind: "t", result: twoSampleTTest(CTRL, TRT1) }], "none");
    expect(() => boxPlotSvg([{ label: "a", values: CTRL }, { label: "b", values: TRT1 }], { brackets: { set } })).toThrow(/refers to group 3/);
  });

  test("brackets on groups beyond the 12-box cap are counted in the clipped note", () => {
    const groups = Array.from({ length: 14 }, (_, g) => [g, g + 1, g + 2.5, g + 0.5]);
    const set = bracketsFromPairwise(
      [
        { i: 0, j: 1, kind: "t", result: twoSampleTTest(groups[0], groups[1]) },
        { i: 12, j: 13, kind: "t", result: twoSampleTTest(groups[12], groups[13]) },
        { i: 2, j: 13, kind: "t", result: twoSampleTTest(groups[2], groups[13]) },
      ],
      "holm",
    );
    const svg = boxPlotSvg(groups.map((v, g) => ({ label: `g${g}`, values: v })), { brackets: { set } });
    expect(svg).toContain("2 more group(s) not shown; 2 bracket(s) involve them");
    expect(drawnBrackets(svg).map((d) => d.key)).toEqual(["0-1"]);
  });

  test("too many levels for the plot height is refused, not squashed", () => {
    const groups = groupsFor(8);
    const set = bracketsFromTukey(tukeyHSD(groups)!);
    expect(() => boxPlotSvg(groups.map((v, g) => ({ label: `G${g}`, values: v })), { brackets: { set } })).toThrow(/taller/);
  });

  test("values near the largest double: a clean refusal or a finite figure, never NaN", () => {
    const groups = [[1.7e308, 1.6e308, 1.5e308], [1, 2, 3]];
    const set = bracketsFromPairwise([{ i: 0, j: 1, kind: "mann-whitney", result: mannWhitneyU(groups[0], groups[1]) }], "none");
    let svg = "";
    try {
      svg = boxPlotSvg(groups.map((v, g) => ({ label: `g${g}`, values: v })), { brackets: { set } });
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      return;
    }
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe("source hygiene", () => {
  // Built from char codes: the Write tool decodes escape sequences into the very
  // characters this scan looks for.
  const bad = [0xfeff, 0x200b, 0x200c, 0x200d, 0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => String.fromCharCode(c));
  const files = [
    "../sigBrackets.ts",
    "../panels.ts",
    "./sigBrackets.test.ts",
    "./panels.test.ts",
    "./statchartBracketsIdentity.test.ts",
    "./combineSvgs.test.ts",
    "../statchart.ts",
    "../plot.ts",
  ];
  test.each(files)("%s has no BOM, zero-width or C0 control characters", (f) => {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    for (const ch of bad) expect(src.includes(ch)).toBe(false);
  });
});
