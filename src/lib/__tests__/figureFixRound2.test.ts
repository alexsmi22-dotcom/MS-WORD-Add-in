/**
 * Figure fix round 2 (2026-10-28, reviewer G's findings): tick labels that are the tick values, the layout audit on the
 * fitted figure, a render budget per fit, hBar margins and distinct names, distinctLabels on a frozen copy, one
 * significance predicate for brackets, date axes on month starts with the year, legendDecimal and years.
 */
import { commaAxis, plotAxisTicks, buildPlotSvg, dateAxisTicks, dateTickLabel } from "../plot";
import { finPlotSvg } from "../financeFigures";
import { figureRenderer, withFigCtx, RENDER_BUDGET_MESSAGE, wrapFigureTitle, blackAndWhite, wrapLabel } from "../figContext";
import { prepareFigure, layoutRefusal } from "../insertCapability";
import { getPreset, type FigureStylePreset } from "../figureStyle";
import { bracketedBoxPlot } from "../statsBrackets";
import { hBarSvg } from "../mechchart";
import { distinctLabels } from "../statchart";
import { bracketsFromPairwise, bracketLegend, planBrackets, markFor } from "../sigBrackets";
import { twoSampleTTest } from "../stats";
import { legendDecimal } from "../statLibFigures";
import { cvpChartSvg } from "../schedCalcs";
import { auditLayout } from "../figureLayoutAudit";

const texts = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
const parse = (s: string): number => Number(s.replace(/,/g, "").replace("−", "-"));

describe("B1: a grouped (comma) axis prints its tick values", () => {
  const ranges: [number, number][] = [
    [0, 1],
    [31, 41],
    [32.1, 40.3],
    [0, 0.1],
    [0, 2.5],
    [-1.2, 0.7],
    [0, 3_000_000],
    [-750_000, 1_250_000],
    [1000, 1001],
    [0, 0.0035],
    [5, 1e9],
  ];
  test.each(ranges)("labels parse back to the tick values on [%p, %p]", (lo, hi) => {
    for (const target of [2, 3, 5, 6]) {
      const ax = commaAxis(plotAxisTicks(lo, hi, false, target, undefined, undefined));
      if (ax.multiplier) continue; // a ×10⁻ⁿ axis keeps its multiplier and its own labels
      for (const t of ax.ticks) expect(parse(t.text)).toBeCloseTo(t.v, 10);
      // Constant decimals along the axis.
      const dps = ax.ticks.map((t) => (t.text.includes(".") ? t.text.split(".")[1].length : 0));
      expect(new Set(dps).size).toBe(1);
    }
  });
  test("the reviewer's cases: 0.00 0.25 … 1.00 and 32.5 35.0 37.5", () => {
    const a = commaAxis({ ticks: [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, text: String(v) })), minor: [], multiplier: "" });
    expect(a.ticks.map((t) => t.text)).toEqual(["0.00", "0.25", "0.50", "0.75", "1.00"]);
    const b = commaAxis({ ticks: [32.5, 35, 37.5, 40].map((v) => ({ v, text: String(v) })), minor: [], multiplier: "" });
    expect(b.ticks.map((t) => t.text)).toEqual(["32.5", "35.0", "37.5", "40.0"]);
  });
  test("end to end: every numeric label of a Finance plot is a value its axis can hold", () => {
    const svg = finPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { ylabel: "share" });
    const nums = texts(svg).filter((t) => /^[−\d.,]+$/.test(t)).map(parse);
    expect(nums).toEqual(expect.arrayContaining([0.25, 0.5, 0.75]));
    expect(texts(svg)).not.toContain("0.3");
  });
});

describe("B2: the layout audit on the fitted figure", () => {
  test("a fit that runs labels together is refused in plain words; one the figure already has as drawn is not", () => {
    const clean = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><text x="20" y="50" font-size="10">a</text></svg>';
    const crowded = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><text x="20" y="50" font-size="10">2027</text><text x="24" y="50" font-size="10">2028</text></svg>';
    const r = layoutRefusal(clean, crowded);
    expect(r).not.toBeNull();
    expect((r as string[])[0]).toMatch(/the labels “2027” and “2028” overlap/);
    expect((r as string[]).join(" ")).not.toMatch(/COLLISION|px²/);
    expect(layoutRefusal(crowded, crowded)).toBeNull();
    // The remedy names a wider column only where the style has one: USPTO single and double are the same 170 mm sight.
    const uspto = getPreset("uspto") as FigureStylePreset;
    const nature = getPreset("nature") as FigureStylePreset;
    expect((layoutRefusal(clean, crowded, { preset: uspto, width: "double", widthMm: 170 }) as string[])[1]).not.toMatch(/double/);
    expect((layoutRefusal(clean, crowded, { preset: uspto, width: "single", widthMm: 170 }) as string[])[1]).not.toMatch(/double/);
    expect((layoutRefusal(clean, crowded, { preset: nature, width: "single", widthMm: 89 }) as string[])[1]).toMatch(/double-column/);
    expect((layoutRefusal(clean, crowded, { panels: true }) as string[])[1]).toMatch(/fewer columns/);
  });
  test("wrapLabel never returns fewer lines than it is given (the fit loop cannot oscillate)", () => {
    expect(wrapLabel("Cumulative share of population, poorest group first (%)", 400, 10, 3).length).toBe(3);
    expect(wrapLabel("Cumulative share of population, poorest group first (%)", 400, 10, 2).length).toBe(2);
    expect(wrapLabel("short", 400, 10, 1)).toEqual(["short"]);
  });
  test("a narrow redraw of a crowded year axis takes fewer ticks and inserts clean", () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: 2021 + i, y: 1000 * i }));
    const draw = (): string => finPlotSvg([{ type: "line", points: pts, label: "present value" }], { title: "Present value of excess earnings by year", xlabel: "year", ylabel: "present value" });
    const r = prepareFigure({ svg: draw(), preset: "thesis", width: "single", render: figureRenderer(draw, Infinity) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(auditLayout(r.svg).filter((f) => f.kind === "COLLISION")).toEqual([]);
  });
  test("an axis title too long for a narrow column wraps instead of running off", () => {
    const svg = withFigCtx({ width: 200, bw: false }, () =>
      buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { xlabel: "Cumulative share of population, poorest group first (%)", ylabel: "Change in inflation Δπ (percentage points)" }),
    );
    expect(auditLayout(svg).filter((f) => f.kind === "CLIPPED")).toEqual([]);
    const t = texts(svg);
    const i = t.findIndex((s) => s.startsWith("Cumulative"));
    // Two or three lines, the unit at the end kept.
    const joined = [t[i], t[i + 1], t[i + 2]].join(" ");
    expect(joined.startsWith("Cumulative share of population, poorest group first (%)") || `${t[i]} ${t[i + 1]}` === "Cumulative share of population, poorest group first (%)").toBe(true);
    expect(t[i + 1]).not.toBe("Cumulative share of population, poorest group first (%)");
  });
  test("a category axis is never thinned (every condition keeps its name; a crowded one is refused instead)", () => {
    const names = ["Stick insect", "Kangaroo testicle", "Fish eye", "Witchetty grub"];
    const svg = withFigCtx({ width: 160, bw: true }, () =>
      buildPlotSvg([{ type: "line", points: [1, 2, 3, 4].map((x) => ({ x, y: x })) }], { xTickLabel: (v) => (Number.isInteger(v) && v >= 1 && v <= 4 ? names[v - 1] : "") }),
    );
    for (const n of names) expect(texts(svg)).toContain(n);
  });
  test("outside a figure style a title wraps only where it would run off the canvas", () => {
    const fits = buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { width: 380, xlabel: "Cumulative share of population (%)" });
    expect(texts(fits)).toContain("Cumulative share of population (%)");
    const narrow = buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { width: 200, xlabel: "Cumulative share of population, poorest group first (%)" });
    expect(auditLayout(narrow).filter((f) => f.kind === "CLIPPED")).toEqual([]);
  });
  test("a single figure title wider than the canvas wraps onto two lines, the figure moved down a line", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#fff"/><text data-figure-title="1" x="100" y="15" text-anchor="middle" font-size="12">Effective annual rate by compounding frequency (%)</text><line x1="0" y1="50" x2="200" y2="50" stroke="#000"/></svg>';
    const out = wrapFigureTitle(svg);
    expect(texts(out)).toEqual(["Effective annual rate by", "compounding frequency (%)"]);
    expect(out).toMatch(/height="114.4"/);
    expect(auditLayout(out).filter((f) => f.kind === "CLIPPED")).toEqual([]);
    expect(wrapFigureTitle(out)).toBe(out);
  });
  test("black and white: a light gridline stays light (thin and dotted), a rule stays solid", () => {
    const out = blackAndWhite('<svg><line x1="0" y1="0" x2="9" y2="0" stroke="#e5e7eb"/><line x1="0" y1="5" x2="9" y2="5" stroke="#888888"/></svg>');
    expect(out).toContain('stroke="#000" stroke-dasharray="1 2" stroke-width="0.5"');
    expect(out).toMatch(/<line x1="0" y1="5" x2="9" y2="5" stroke="#000"\/>/);
  });
});

describe("M1: the render budget is per fit", () => {
  test("a 300 ms calculator is accepted on its 20th styled insert; one fit over budget still refuses", () => {
    let clock = 0;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const pts = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 3 }];
      const draw = (cost: number) => (): string => {
        clock += cost;
        return buildPlotSvg([{ type: "line", points: pts }], { title: "t", xlabel: "x", ylabel: "y" });
      };
      const quick = figureRenderer(draw(300));
      for (let i = 0; i < 20; i++) {
        const r = prepareFigure({ svg: draw(0)(), preset: i % 2 ? "nature" : "uspto", width: "single", render: quick });
        expect(r.ok).toBe(true);
      }
      const slow = figureRenderer(draw(4500));
      const r = prepareFigure({ svg: draw(0)(), preset: "thesis", width: "single", render: slow });
      // A style fit redraws at least twice; at 4.5 s a redraw the second one is past the 4 s budget and refuses.
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.join(" ")).toContain(RENDER_BUDGET_MESSAGE);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("M2/M3: hBar names and distinct labels", () => {
  test("black and white: the longest name fits its margin and is not cut", () => {
    const rows = [
      { name: "Working capital / total assets", value: 0.24, text: "0.2400" },
      { name: "Market value of equity / total liabilities", value: 1.08, text: "1.0800" },
    ];
    // At 900 the 45% margin cap (405) is above the longest name's width × 1.1 + 12; the margin used to be the bare width.
    const svg = withFigCtx({ width: 900, bw: true }, () => hBarSvg(rows, { title: "Altman", unit: "" }));
    expect(texts(svg)).toEqual(expect.arrayContaining(["Market value of equity / total liabilities", "Working capital / total assets"]));
  });
  test("two names cut to the same text stay distinct (as drawn and in black and white)", () => {
    const rows = [
      { name: "Interest coverage ratio (EBIT/interest)", value: 3 },
      { name: "Interest coverage ratio (EBITDA/interest)", value: 4 },
    ];
    for (const svg of [hBarSvg(rows, { title: "t", unit: "", w: 300 }), withFigCtx({ width: 300, bw: true }, () => hBarSvg(rows, { title: "t", unit: "" }))]) {
      const names = texts(svg).filter((t) => t.startsWith("In"));
      expect(names.length).toBe(2);
      expect(names[0]).not.toBe(names[1]);
    }
  });
  test("distinctLabels counts on a frozen copy: every colliding label is treated alike", () => {
    const out = distinctLabels(["strongly agree", "agree", "neutral", "disagree", "strongly disagree"], 10);
    expect(new Set(out).size).toBe(5);
    expect(out.every((s) => s.length <= 10)).toBe(true);
    // Told apart by what differs (their ends), not by a number that says nothing.
    expect(out[0]).toMatch(/…agree$/);
    expect(out[4]).toMatch(/…\w*sagree$/);
    expect(out.join(" ")).not.toMatch(/\(\d\)/);
    const a = distinctLabels(["sales_growth_rate_quarterly_A", "sales_growth_rate_quarterly_B", "x"], 12);
    expect(new Set(a).size).toBe(3);
    // Both colliding names are cut the same way (end kept), not one mid-cut and one end-cut.
    expect(a[0].endsWith("A")).toBe(true);
    expect(a[1].endsWith("B")).toBe(true);
  });
});

describe("Minor 1: one significance predicate for brackets (the printed p)", () => {
  const A = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 5.6];
  /** A Welch t-test whose p is below 0.05 but prints 0.050. */
  const boundary = (): ReturnType<typeof twoSampleTTest> => {
    let lo = 0;
    let hi = 2;
    for (let k = 0; k < 200; k++) {
      const d = (lo + hi) / 2;
      const r = twoSampleTTest(A, A.map((x, i) => x + d + (i % 2 ? 0.3 : -0.3)));
      if (r.p > 0.0499995) lo = d;
      else hi = d;
      if (r.p < 0.05 && r.p >= 0.0495 && r.p.toFixed(3) === "0.050") return r;
    }
    throw new Error("no boundary case");
  };
  test("p below 0.05 printing 0.050: ns in stars, hidden by Hide ns, the caption explains, the p label prints 0.050", () => {
    const res = boundary();
    expect(res.p).toBeLessThan(0.05);
    const set = bracketsFromPairwise([{ i: 0, j: 1, result: res, kind: "t" }], "none");
    expect(set.brackets[0].significant).toBe(true);
    expect(markFor(set.brackets[0], 0.05)).toBe("ns");
    const xOf = (k: number): number => 50 + 100 * k;
    expect(planBrackets(set, 2, xOf, { label: "stars" }).items[0].label).toBe("ns");
    expect(planBrackets(set, 2, xOf, { label: "stars", showNs: false }).hiddenNs).toBe(1);
    expect(bracketLegend(set, { label: "stars", showNs: false })).toMatch(/1 non-significant comparison not shown/);
    expect(bracketLegend(set, { label: "stars" })).toMatch(/p as printed to three decimals/);
    expect(planBrackets(set, 2, xOf, { label: "p" }).items[0].label).toBe("p = 0.050");
  });
  test("the fit remedy offers Hide ns for a pair shown as ns at the printed boundary", () => {
    const res = boundary();
    // Narrow enough that one bracket does not fit the plot: the remedy must offer what works, Hide ns among it.
    let msg = "";
    for (const w of [70, 90, 110, 130]) {
      const f = bracketedBoxPlot([{ label: "a", values: A }, { label: "b", values: A }], { title: "t" }, { kind: "t", result: res }, { label: "stars", hideNs: false, tall: false }, w);
      if (!f.ok) {
        msg = f.error;
        break;
      }
    }
    expect(msg).toMatch(/Hide ns/);
  });
});

describe("Minor 2: date axes keep the year and tick on month starts", () => {
  test("a span of 0.5–3 years ticks on month starts with the year", () => {
    const t = dateAxisTicks(2024.2, 2025.6, 6) as { v: number; text: string }[];
    expect(t.length).toBeGreaterThanOrEqual(3);
    for (const k of t) {
      expect(k.text).toMatch(/^((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) )?\d{4}$/);
      // Each tick reads back as the first of its month.
      const lab = dateTickLabel(k.v - 1e-3, k.v + 1e-3, "year")(k.v);
      expect(lab).toMatch(/^(1 \w{3}|\d{4})$/);
    }
  });
  test("under five months: month starts with the year; under two months: days, the year on the first", () => {
    const m = dateAxisTicks(2024.1, 2024.4, 6) as { text: string }[];
    expect(m.every((k) => /\d{4}$/.test(k.text))).toBe(true);
    const d = dateAxisTicks(2024.18, 2024.24, 6) as { text: string }[];
    expect(d[0].text).toMatch(/^\d{1,2} \w{3} 2024$/);
    expect(d.slice(1).every((k) => /^\d{1,2} \w{3}( \d{4})?$/.test(k.text))).toBe(true);
  });
  test("a damages plot on a short span carries the year", () => {
    const svg = buildPlotSvg([{ type: "line", points: [{ x: 2024.18, y: 1 }, { x: 2024.3, y: 2 }] }], { xDates: "year" });
    expect(texts(svg).some((s) => /2024/.test(s))).toBe(true);
  });
});

describe("Minors 3 and 4: the cvp legend and legendDecimal", () => {
  test("cvp sales legend fits the 22-character legend unclipped", () => {
    const svg = cvpChartSvg({ price: 125, variableCost: 80, fixedCosts: 270000, units: 5500 } as never, {
      breakEvenUnits: 6000,
      breakEvenRevenue: 750000,
      marginOfSafetyUnits: -500,
      revenue: 687500,
    } as never) as string;
    expect(texts(svg)).toContain("sales below break-even");
    expect(texts(svg).some((t) => t.includes("…"))).toBe(false);
  });
  test("a year in a title is not grouped; a value after = or ≈ is", () => {
    expect(legendDecimal("Deposit expansion with reserve ratio 10% from 2024")).toBe("Deposit expansion with reserve ratio 10% from 2024");
    expect(legendDecimal("m·B = 1000")).toBe("m·B = 1,000");
    expect(legendDecimal("m·ΔB = 1,000,000/1,001 ≈ 999.0010")).toBe("m·ΔB = 999.0010");
    expect(legendDecimal("limit 12345.678 in 2024")).toBe("limit 12,345.678 in 2024");
  });
});
