/**
 * FIGURE FIX ROUND 3 (2026-10-28): the reviewer's repros, each pinned.
 *  - B1: a style fit cut an axis title with "…", dropping its unit and its "(×10⁶)", and the figure inserted reading
 *    0–9 where the data are 0–9,000,000. wrapLabel never cuts now; the layout audit names a cut that drops a value
 *    (TRUNCATED), and the gate requires every accepted fit to keep every ×10ⁿ and unit (figureStyleGate.test.ts).
 *  - M1: a 1 px light-grey polar spoke under a ring label counted as a strike-through and refused legible polar plots.
 *  - M2: comma-grouped axes capped decimals at 6 and printed "0.001693" for the tick 0.0016925.
 *  - m1: Table→Chart had none of round 2's fitting and refused ordinary titles, pie legends and bar axes at 75 mm.
 *  - m2: star bands at 0.01 and 0.001 were decided on the raw p: p = 0.00999 printed "0.010" but showed "**".
 */
import { buildPlotSvg, commaAxis, plotAxisTicks } from "../plot";
import { wrapLabel, withFigCtx, figureRenderer, WRAP_MAX_LINES } from "../figContext";
import { prepareFigure, composePanelFigure, layoutRefusal } from "../insertCapability";
import { introducedLayoutFindings, truncatedByFit, valueMarksLost, svgTexts, auditLayout } from "../figureLayoutAudit";
import { buildPlotKind, type PlotKindInput } from "../plotKinds";
import { parseTableData, buildChartPreviewSvg, type ChartKind } from "../tablechart";
import { hBarSvg } from "../mechchart";
import { bracketsFromPairwise, markFor, planBrackets } from "../sigBrackets";
import { twoSampleTTest } from "../stats";
import type { FigurePresetChoice } from "../insertCapability";
import type { PresetWidth } from "../figureStyle";

const lin = (f: (x: number) => number, a: number, b: number, n = 100): { x: number; y: number }[] =>
  Array.from({ length: n }, (_, i) => {
    const x = a + ((b - a) * i) / (n - 1);
    return { x, y: f(x) };
  });

describe("B1: a fitted axis title is never cut (its unit and ×10ⁿ are values)", () => {
  const ser = [{ type: "line" as const, points: lin((x) => 3e6 * x, 0, 3), label: "s" }];
  const titles = [
    { xlabel: "Time after the first oral dose (h)", ylabel: "Plasma concentration of the parent drug (ng/mL)", unit: "(ng/mL)" },
    { xlabel: "Cycle number", ylabel: "Peak force measured at the load cell during the fatigue test (N)", unit: "(N)" },
  ];
  const cases: [FigurePresetChoice, PresetWidth][] = [
    ["uspto", "single"],
    ["uspto", "double"],
    ["thesis", "single"],
  ];
  for (const o of titles)
    for (const [preset, width] of cases) {
      test(`"${o.ylabel.slice(0, 24)}…" at ${preset}/${width}: inserted with the unit and the multiplier, or refused by name`, () => {
        const draw = (): string => buildPlotSvg(ser, o);
        // The reviewer's own render callback (a plain re-render at the width), and the pane's (the figure context).
        const plain = (w: number, st?: { color?: string }): string => buildPlotSvg(ser, { ...o, width: w, height: Math.round((270 * w) / 380), bw: st?.color === "bw" });
        for (const render of [plain, figureRenderer(draw, Infinity)]) {
          const r = prepareFigure({ svg: draw(), render: render as never, preset, width });
          if (!r.ok) {
            expect(r.problems.join(" ")).toMatch(/runs off the edge|overlap|cut short/);
            continue;
          }
          const t = svgTexts(r.svg);
          expect(t.some((s) => s.includes("…"))).toBe(false);
          const joined = t.join(" ").replace(/<[^>]*>/g, "");
          expect(joined.replace(/\s+/g, "")).toContain(o.unit);
          expect(joined.replace(/\s+/g, "").replace(/⁶/g, "6")).toMatch(/×106/);
        }
      });
    }
  test("the reviewer's USPTO single figure now inserts with the title whole: “… (ng/mL) (×10⁶)”", () => {
    const o = { xlabel: titles[0].xlabel, ylabel: titles[0].ylabel };
    const draw = (): string => buildPlotSvg(ser, o);
    const r = prepareFigure({ svg: draw(), render: figureRenderer(draw, Infinity), preset: "uspto", width: "single" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(valueMarksLost(buildPlotSvg(ser, o), r.svg)).toEqual([]);
  });
  test("panel tray: “Revenue ($)” on 0–3×10⁶ keeps “Revenue”, “($)” and “(×10⁶)” at every narrow width", () => {
    const opts = { xlabel: "Year", ylabel: "Revenue ($)" };
    const s = [{ type: "line" as const, points: lin((x) => 1e6 * x, 0, 3), label: "rev" }];
    for (const w of [80, 100, 140]) {
      const t = svgTexts(buildPlotSvg(s, { ...opts, width: w, height: Math.round((270 * w) / 380) }));
      expect(t.some((x) => x.includes("…"))).toBe(false);
      expect(t.join(" ")).toMatch(/Revenue/);
      expect(t.join(" ")).toMatch(/\(\$\)/);
      expect(t.join(" ")).toMatch(/×10⁶/);
    }
    // The ACS single-column tray of three: whatever it decides, it never inserts a cut title.
    const P = (series: typeof s, o: typeof opts) => ({
      svg: buildPlotSvg(series, o),
      render: (w: number) => buildPlotSvg(series, { ...o, width: w, height: Math.round((270 * w) / 380) }),
      source: "Plot",
    });
    const tray = composePanelFigure(
      [P([{ type: "line", points: lin((x) => Math.exp(-x), 0, 5), label: "decay" }], { xlabel: "Time (s)", ylabel: "Concentration (mM)" }), P(s, opts), P(s, opts)],
      "acs",
      "single",
      3,
    );
    if (tray.ok) expect(svgTexts(tray.svg).some((x) => x.includes("…"))).toBe(false);
  });
  test("wrapLabel: never an ellipsis, every word kept in order, at most WRAP_MAX_LINES lines (random titles and rooms)", () => {
    let seed = 11;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const words = ["Plasma", "concentration", "of", "the", "parent", "drug", "(ng/mL)", "(×10⁶)", "Revenue", "($)", "a", "Supercalifragilistic", "%", "(N)"];
    for (let k = 0; k < 4000; k++) {
      const n = 1 + Math.floor(rnd() * 12);
      const text = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(" ");
      const room = 10 + rnd() * 400;
      const minLines = 1 + Math.floor(rnd() * 3);
      const out = wrapLabel(text, room, 10, minLines);
      expect(out.join(" ")).toBe(text);
      expect(out.some((l) => l.includes("…"))).toBe(false);
      expect(out.length).toBeLessThanOrEqual(Math.max(WRAP_MAX_LINES, minLines));
    }
  });
  test("the audit names a cut that drops a value (TRUNCATED), and not a category shortened to its prefix", () => {
    const svg = (texts: string[]): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${texts.map((t, i) => `<text x="10" y="${20 + 15 * i}">${t}</text>`).join("")}</svg>`;
    const drawn = svg(["Plasma concentration of the parent drug (ng/mL) (×10⁶)", "Dogwood Partners", "€1,250.00 (EUR)"]);
    const cut = svg(["Plasma", "concentration of", "the parent drug…", "Dogwo…", "€1,250.00 (E…"]);
    const f = truncatedByFit(drawn, cut);
    expect(f.map((x) => x.a)).toEqual(["the parent drug…", "€1,250.00 (E…"]);
    expect(introducedLayoutFindings(drawn, cut).filter((x) => x.kind === "TRUNCATED").length).toBe(2);
    expect((layoutRefusal(drawn, cut) ?? []).join(" ")).toMatch(/“the parent drug…” would be cut short/);
    // An ellipsis the figure has as drawn is the builder's own, not the fit's.
    expect(truncatedByFit(svg(["Kangaroo te…"]), svg(["Kangaroo te…"]))).toEqual([]);
    expect(valueMarksLost(drawn, cut).sort()).toEqual(["(EUR)", "(ng/mL)", "(×10⁶)", "×10⁶"].sort());
  });
  test("hBar names that do not fit the margin take two lines under a figure style instead of an ellipsis", () => {
    const rows = [
      { name: "€1,250.00 (EUR)", value: 1250, text: "€1,250.00" },
      { name: "Operating income (EBIT)", value: 15, text: "15.00%" },
    ];
    const svg = withFigCtx({ width: 220, bw: false }, () => hBarSvg(rows, { title: "t", unit: "" }));
    const t = svgTexts(svg);
    expect(t.some((s) => s.includes("…"))).toBe(false);
    expect(t).toEqual(expect.arrayContaining(["Operating", "income (EBIT)"]));
  });
});

describe("M1: a light polar spoke under a ring label is not a strike-through", () => {
  const BASE: PlotKindInput = {
    kind: "polar", fn: "", fn2: "", xmin: "-2", xmax: "2", tmin: "0", tmax: "2*pi", ymin: "-2", ymax: "2", angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "",
    y2label: "", zlabel: "", xscale: "linear", yscale: "linear", y2scale: "linear", equal: true, levels: "", filled: false, grid: "", az: "-60", el: "30", surfaceStyle: "filled",
  } as PlotKindInput;
  const cases: [string, Partial<PlotKindInput>, FigurePresetChoice[]][] = [
    ["r = exp(0.1θ)", { fn: "exp(0.1*theta)", tmin: "0", tmax: "6*pi" }, ["elsevier", "acs", "cell", "thesis"]],
    ["r = cos 3θ", { fn: "cos(3*theta)", tmin: "0", tmax: "pi" }, ["thesis"]],
    ["r = 2 sin 2θ", { fn: "2*sin(2*theta)" }, ["thesis"]],
    ["r = 1", { fn: "1" }, ["thesis"]],
  ];
  for (const [name, o, presets] of cases)
    test(`${name} is accepted at ${presets.join(", ")} single`, () => {
      const r = buildPlotKind({ ...BASE, ...o } as PlotKindInput);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const p of presets) {
        const q = prepareFigure({ svg: r.svg, render: r.render as never, preset: p, width: "single", chartKind: r.chartKind });
        expect([p, q.ok, q.ok ? "" : q.problems.join("; ")]).toEqual([p, true, ""]);
        if (q.ok) expect(auditLayout(q.svg).filter((f) => f.kind === "STRIKETHROUGH")).toEqual([]);
      }
    });
});

describe("M2: a comma-grouped tick label is always its tick value", () => {
  test("the reviewer's repros: 0.0016904–0.0017002 and 0.0019120–0.0019236", () => {
    expect(commaAxis(plotAxisTicks(0.0016904, 0.0017002, false, 5, undefined, undefined)).ticks.map((t) => t.text)).toEqual(["0.0016925", "0.0016950", "0.0016975", "0.0017000"]);
    expect(commaAxis(plotAxisTicks(0.001912, 0.0019236, false, 5, undefined, undefined)).ticks.map((t) => t.text)).toEqual(["0.0019125", "0.0019150", "0.0019175", "0.0019200", "0.0019225"]);
  });
  test("property: 20,210 ranges, with and without comma grouping, every label parses back to its tick (and labels differ)", () => {
    const SUP: Record<string, number> = { "⁰": 0, "¹": 1, "²": 2, "³": 3, "⁴": 4, "⁵": 5, "⁶": 6, "⁷": 7, "⁸": 8, "⁹": 9 };
    const multOf = (m: string): number | null => {
      if (!m) return 1;
      const r = /^×10(⁻?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(m);
      if (!r) return null;
      const e = Number([...r[2]].map((c) => SUP[c]).join(""));
      return 10 ** (r[1] ? -e : e);
    };
    const parse = (t: string): number => Number(t.replace(/,/g, "").replace(/[   ]/g, "").replace(/−/g, "-"));
    const bad: string[] = [];
    let n = 0;
    const check = (lo: number, hi: number, target: number, comma: boolean): void => {
      let a = plotAxisTicks(lo, hi, false, target, undefined, undefined);
      if (comma) a = commaAxis(a);
      const k = multOf(a.multiplier);
      if (k === null) return;
      n++;
      const vals = a.ticks.map((t) => t.v);
      let step = Infinity;
      for (let i = 1; i < vals.length; i++) step = Math.min(step, Math.abs(vals[i] - vals[i - 1]));
      for (const t of a.ticks) {
        const p = parse(t.text) * k;
        if (!Number.isFinite(p) || Math.abs(p - t.v) > Math.max(step * 1e-6, Math.abs(t.v) * 1e-9)) {
          bad.push(`${lo}..${hi} t${target} ${comma ? "comma" : "plain"}: ${t.text} for ${t.v}`);
          return;
        }
      }
      if (new Set(a.ticks.map((t) => t.text)).size !== a.ticks.length) bad.push(`${lo}..${hi}: duplicate labels`);
    };
    const fixed: [number, number][] = [[0, 5e-7], [0, 1e-6], [0, 1e21], [1e21, 3e21], [-5, -1], [-1e6, 1e6], [0, 1], [31, 41], [0, 0.1], [0, 1e-3], [0, 2e-3], [0, 1e12], [0, 2.5e12], [-0.003, 0.004], [999999, 1000001], [0, 7.5], [0.5, 0.6], [100, 100.5], [0, 1e6], [0, 9.99e5], [0, 25000], [-2.5e6, 0]];
    for (const [lo, hi] of fixed) for (const t of [2, 3, 4, 5, 6, 8]) for (const c of [false, true]) check(lo, hi, t, c);
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 20000; i++) {
      const e = Math.floor(rnd() * 30) - 12;
      const a = (rnd() * 2 - 1) * 10 ** e;
      const b = a + rnd() * 10 ** (e + Math.floor(rnd() * 3) - 1);
      if (!(b > a)) continue;
      check(a, b, 2 + Math.floor(rnd() * 7), rnd() < 0.5);
    }
    expect(n).toBeGreaterThan(20000);
    expect(bad).toEqual([]);
  });
});

describe("m1: Table→Chart fits a narrow column like Plot does", () => {
  const T1 = [["Month", "North region", "South region", "West region"], ["Jan", "120", "95", "60"], ["Feb", "132", "101", "72"], ["Mar", "150", "99", "80"], ["Apr", "141", "120", "85"], ["May", "160", "130", "91"], ["Jun", "172", "128", "99"]];
  const T2 = [["Formulation", "Dissolution at 30 min (%)"], ["Immediate-release tablet, 10 mg", "92"], ["Extended-release tablet, 20 mg", "41"], ["Orally disintegrating tablet", "97"], ["Enteric-coated capsule", "12"], ["Oral suspension, 5 mg/mL", "99"]];
  const T4 = [["Year", "Revenue", "Cost"], ["2019", "1200000", "800000"], ["2020", "1350000", "900000"], ["2021", "1500000", "1100000"], ["2022", "1720000", "1300000"], ["2023", "2010000", "1450000"]];
  const TITLE = "Quarterly results by region and product line";
  const fit = (rows: string[][], kind: ChartKind, title: string) => {
    const chart = parseTableData(rows);
    return prepareFigure({ svg: buildChartPreviewSvg(chart, kind, title, {}).svg, render: ((w: number) => buildChartPreviewSvg(chart, kind, title, {}, w).svg) as never, preset: "thesis", width: "single", chartKind: kind });
  };
  const kinds: ChartKind[] = ["column", "bar", "line", "area", "scatter", "stacked-column", "stacked-bar", "stacked-area", "pie", "doughnut"];
  test("every kind with a 44-character title is accepted at Thesis single, the title whole on two lines", () => {
    for (const k of kinds) {
      const r = fit(T1, k, TITLE);
      expect([k, r.ok, r.ok ? "" : r.problems.join("; ")]).toEqual([k, true, ""]);
      if (r.ok) expect(svgTexts(r.svg).filter((t) => /Quarterly|product line/.test(t)).join(" ")).toBe(TITLE);
    }
  });
  test("pie and doughnut of long category names: accepted, the legend under the pie, every name and share whole", () => {
    for (const k of ["pie", "doughnut"] as ChartKind[]) {
      const r = fit(T2, k, "");
      expect(r.ok).toBe(true);
      if (r.ok) {
        const t = svgTexts(r.svg).join(" ");
        expect(t).not.toMatch(/…/);
        expect(t).toMatch(/Immediate-release tablet, 10 mg/);
        expect(t).toMatch(/\(\d+(\.\d)?%\)/);
      }
    }
  });
  test("a bar chart of revenue at 0–2×10⁶: the value axis thins instead of running together", () => {
    const r = fit(T4, "bar", "");
    expect(r.ok).toBe(true);
  });
  test("as drawn (the 380-unit preview) nothing changes: one title line cut at 48, the legend beside the pie", () => {
    const long = "Quarterly results by region and product line, fiscal years 2019 to 2023";
    const svg = buildChartPreviewSvg(parseTableData(T1), "column", long, {}).svg;
    expect(svgTexts(svg).filter((t) => t.startsWith("Quarterly"))).toEqual([long.slice(0, 47) + "…"]);
    const pie = buildChartPreviewSvg(parseTableData(T2), "pie", "", {}).svg;
    expect(/<svg[^>]*height="260"/.test(pie)).toBe(true);
  });
});

describe("m2: every star band is decided on the printed p", () => {
  const A = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 5.6];
  /** A Welch t-test whose p satisfies `ok`, found by bisection on a shift d (p falls as d grows). */
  const withP = (target: number, ok: (p: number) => boolean): ReturnType<typeof twoSampleTTest> => {
    let lo = 0;
    let hi = 5;
    for (let k = 0; k < 200; k++) {
      const d = (lo + hi) / 2;
      const r = twoSampleTTest(A, A.map((x, i) => x + d + (i % 2 ? 0.3 : -0.3)));
      if (ok(r.p)) return r;
      if (r.p > target) lo = d;
      else hi = d;
    }
    throw new Error(`no p near ${target}`);
  };
  const xOf = (k: number): number => 50 + 100 * k;
  test("p = 0.00999 (prints 0.010) is “*”, and its p label prints 0.010", () => {
    const r = withP(0.00999, (p) => p < 0.01 && p >= 0.0095 && p.toFixed(3) === "0.010");
    const set = bracketsFromPairwise([{ i: 0, j: 1, result: r, kind: "t" }], "none");
    expect(markFor(set.brackets[0], 0.05)).toBe("*");
    expect(planBrackets(set, 2, xOf, { label: "p" }).items[0].label).toBe("p = 0.010");
  });
  test("a p below 0.001 (the text prints “< .001”) is “***”; a p from 0.001 that prints 0.001 is “**”", () => {
    const r1 = withP(0.000999, (p) => p < 0.001 && p >= 0.0005 && p.toFixed(3) === "0.001");
    const s1 = bracketsFromPairwise([{ i: 0, j: 1, result: r1, kind: "t" }], "none");
    // formatP prints "p < .001" for any p below 0.001, so the text says "< 0.001": the mark is "***".
    expect(markFor(s1.brackets[0], 0.05)).toBe("***");
    expect(planBrackets(s1, 2, xOf, { label: "p" }).items[0].label).toBe("p < 0.001");
    const r2 = withP(0.0011, (p) => p >= 0.001 && p < 0.0015 && p.toFixed(3) === "0.001");
    const s2 = bracketsFromPairwise([{ i: 0, j: 1, result: r2, kind: "t" }], "none");
    expect(markFor(s2.brackets[0], 0.05)).toBe("**");
    expect(planBrackets(s2, 2, xOf, { label: "p" }).items[0].label).toBe("p = 0.001");
  });
  test("away from the bands nothing changes: 0.003 is “**”, 0.02 is “*”", () => {
    const r = withP(0.003, (p) => p > 0.0028 && p < 0.0032);
    expect(markFor(bracketsFromPairwise([{ i: 0, j: 1, result: r, kind: "t" }], "none").brackets[0], 0.05)).toBe("**");
    const r2 = withP(0.02, (p) => p > 0.019 && p < 0.021);
    expect(markFor(bracketsFromPairwise([{ i: 0, j: 1, result: r2, kind: "t" }], "none").brackets[0], 0.05)).toBe("*");
  });
});
