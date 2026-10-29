/**
 * The shared figure context and its style fitting (lib/figContext.ts), and the display fixes in the shared builders
 * that came with it (2026-10-28 figure fix). The whole-surface gate is figureStyleGate.test.ts; these pin the parts.
 */
import { withFigCtx, currentFigCtx, figureRenderer, RENDER_BUDGET_MESSAGE, blackAndWhite, fitTextBand, styleFigure, supSubMarkup, withCellCtx } from "../figContext";
import { getPreset, nonBlackWhitePaints, measureSvgText } from "../figureStyle";
import { withFinFig, currentFinFig, finPlotSvg } from "../financeFigures";
import { buildPlotSvg, dateTickLabel } from "../plot";
import { hBarSvg } from "../mechchart";
import { distinctLabels, forestPlotSvg } from "../statchart";
import { legendDecimal } from "../statLibFigures";
import { markFor, type SigBracket } from "../sigBrackets";
import { treeSvg } from "../treeSvg";

const texts = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const rootW = (svg: string): number => Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1]);
const USPTO = getPreset("uspto")!;
const NATURE = getPreset("nature")!;

describe("the context", () => {
  test("Finance's withFinFig/currentFinFig are the shared context", () => {
    expect(currentFigCtx()).toBeNull();
    withFinFig({ width: 300, bw: true }, () => {
      expect(currentFigCtx()).toEqual({ width: 300, bw: true });
      expect(currentFinFig()).toBe(currentFigCtx());
    });
    expect(currentFigCtx()).toBeNull();
  });
  test("a non-finite or non-positive width is no context; the context is restored after a throw", () => {
    withFigCtx({ width: NaN, bw: true }, () => expect(currentFigCtx()).toBeNull());
    expect(() => withFigCtx({ width: 200, bw: false }, () => {
      throw new Error("x");
    })).toThrow("x");
    expect(currentFigCtx()).toBeNull();
  });
  test("withCellCtx narrows to one grid cell, and is a no-op outside a context", () => {
    withFigCtx({ width: 406, bw: false }, () => withCellCtx(2, 6, () => expect(currentFigCtx()!.width).toBe(200)));
    withCellCtx(2, 6, () => expect(currentFigCtx()).toBeNull());
  });
  test("shared builders draw at the context's width: plot, horizontal bars, forest, tree", () => {
    const plot = (): string => buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], label: "a long series label here" }], { title: "t" });
    expect(rootW(withFigCtx({ width: 250, bw: false }, plot))).toBe(250);
    expect(rootW(plot())).toBeGreaterThan(380); // outside: 380 plus the legend gutter, as always
    expect(rootW(withFigCtx({ width: 250, bw: true }, () => hBarSvg([{ name: "a", value: 1 }], { title: "t", unit: "" })))).toBe(250);
    expect(rootW(withFigCtx({ width: 250, bw: false }, () => forestPlotSvg([{ label: "x", estimate: 1, low: 0, high: 2 }], {})))).toBe(250);
    const tree = { nodes: [{ id: "a", label: "a" }, { id: "b", label: "b" }], edges: [{ from: "a", to: "b" }] };
    expect(Number(/viewBox="0 0 ([\d.]+)/.exec(withFigCtx({ width: 300, bw: true }, () => treeSvg(tree)))![1])).toBe(300);
  });
});

describe("style fitting", () => {
  test("black and white: no grey or colour paint, no opacity; coloured fills become hatches keyed by colour; coloured lines keep their identity as dashes", () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" fill="#fcfcfb"/>` +
      `<rect x="1" y="1" width="10" height="10" fill="#2563eb" fill-opacity="0.85"/><rect x="20" y="1" width="10" height="10" fill="#b91c1c"/>` +
      `<path d="M0,0 L10,10" stroke="#0369a1"/><path d="M0,5 L10,15" stroke="#b45309"/><line x1="0" y1="0" x2="1" y2="1" stroke="#888888"/>` +
      `<text x="1" y="40" font-size="10" fill="#6b7280">a</text></svg>`;
    const out = blackAndWhite(svg);
    expect(nonBlackWhitePaints(out)).toEqual([]);
    expect(out).toContain('fill="url(#fx-h0)"');
    expect(out).toContain('fill="url(#fx-h1)"');
    expect(out).toContain('stroke-dasharray="7 3"'); // the second coloured line
    expect(out).not.toMatch(/stroke="#000" stroke-dasharray="7 3"\/><line[^>]*stroke-dasharray/); // the grey rule stays solid
  });
  test("more coloured fills than hatches (a heat map) are left for the style check to refuse by name", () => {
    const cells = Array.from({ length: 8 }, (_, i) => `<rect x="${i}" y="0" width="1" height="1" fill="#${(i + 2).toString(16)}0${(i + 2).toString(16)}0a0"/>`).join("");
    const out = blackAndWhite(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="1">${cells}</svg>`);
    expect(nonBlackWhitePaints(out).length).toBeGreaterThan(0);
  });
  test("super/subscript characters are set as full-size raised and lowered characters", () => {
    const out = supSubMarkup("ₜpₓ (alive)", 10);
    // Every character full size; the baseline shifts sum to zero (following text is not left raised or lowered).
    expect(out.replace(/<[^>]*>/g, "").split(String.fromCharCode(160)).join(" ")).toBe("tpx (alive)");
    const dys = [...out.matchAll(/dy="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    expect(dys.reduce((a, v) => a + v, 0)).toBeCloseTo(0, 6);
    expect(dys.length).toBeGreaterThan(1);
    expect(supSubMarkup("plain", 10)).toBe("plain");
  });
  test("the text band: larger runs shrink to ratio × the smallest, as DRAWN (a scaled group counts)", () => {
    const svg = `<svg width="100" height="10"><text font-size="10">a</text><text font-size="13">b</text><g transform="translate(0,0) scale(0.5)"><text font-size="12">c</text></g></svg>`;
    const out = fitTextBand(svg, 1.3);
    // smallest drawn is 12 × 0.5 = 6; cap 7.8; "a" 10 → 7.8, "b" 13 → 7.8, "c" stays (drawn 6)
    expect(out).toContain('<text font-size="7.8">a</text>');
    expect(out).toContain('<text font-size="7.8">b</text>');
    expect(out).toContain('<text font-size="12">c</text>');
  });
  test("styleFigure sets the style's typeface; figureRenderer re-runs under the context", () => {
    const out = styleFigure(`<svg width="10" height="10"><text font-family="Segoe UI, Arial" font-size="10">a</text></svg>`, USPTO);
    expect(out).toContain(`font-family="${USPTO.fontFamily}"`);
    const seen: number[] = [];
    const r = figureRenderer(() => {
      seen.push(currentFigCtx()!.width);
      return buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { title: "Title", xlabel: "x" });
    });
    const svg = r(321, NATURE, 89);
    expect(seen).toEqual([321]);
    const m = measureSvgText(svg, 89);
    expect(Math.max(...m.texts.map((t) => t.fontSizeRoot)) / Math.min(...m.texts.map((t) => t.fontSizeRoot))).toBeLessThanOrEqual(1.4);
  });
});

describe("display fixes in the shared builders", () => {
  test("hBarSvg prints the caller's own text, and cuts a long name with an ellipsis inside the canvas", () => {
    const svg = withFigCtx({ width: 300, bw: true }, () =>
      hBarSvg(
        [
          { name: "an extremely long converted-amount label that cannot fit", value: 18193.97, text: "18,193.97" },
          { name: "b", value: 1258.6, text: "€1,258.60" },
        ],
        { title: "t", unit: "EUR" },
      ),
    );
    expect(texts(svg)).toEqual(expect.arrayContaining(["18,193.97", "€1,258.60"]));
    expect(svg).not.toMatch(/×10|1259 EUR|18194/);
    expect(texts(svg).some((t) => t.endsWith("…"))).toBe(true);
    for (const m of svg.matchAll(/<rect x="(-?[\d.]+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(0);
  });
  test("distinctLabels: an ellipsis, and two names with one prefix stay two", () => {
    const out = distinctLabels(["income quintile 1", "income quintile 2", "short"], 10);
    expect(out[0]).not.toBe(out[1]);
    expect(out.every((s) => s.length <= 10)).toBe(true);
    expect(out[2]).toBe("short");
    expect(out[0]).toContain("…");
    const same = distinctLabels(["abcdefghijklmno", "abcdefghijklmno"], 8);
    expect(same[0]).not.toBe(same[1]);
  });
  test("date axes: years, months or days, never offset notation", () => {
    const f = dateTickLabel(2019, 2024, "year");
    expect(f(2020)).toBe("2020");
    expect(f(2020.5)).toMatch(/^(Jun|Jul) 2020$/);
    expect(dateTickLabel(2024.1, 2024.3, "year")(2024.2)).toMatch(/^\d{1,2} (Feb|Mar)$/);
    const svg = buildPlotSvg([{ type: "line", points: [{ x: 2025.18, y: 1 }, { x: 2025.2, y: 2 }] }], { xDates: "year" });
    expect(svg).not.toMatch(/ticks [+−]/);
  });
  test("Finance money axes: grouped fixed point, never thin spaces or ×10ⁿ (below a trillion)", () => {
    const svg = finPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 30_000_000 }] }], { ylabel: "amount" });
    expect(texts(svg)).toEqual(expect.arrayContaining(["10,000,000"]));
    expect(svg).not.toMatch(/×10/);
    const small = finPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 2500 }] }], {});
    expect(texts(small).some((t) => /^\d,\d{3}$/.test(t))).toBe(true);
  });
  test("a title wider than the canvas wraps to two lines", () => {
    const svg = buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { width: 260, title: "Break-even chart: revenue, total cost and the margin of safety at the planned volume" });
    expect((svg.match(/data-figure-title/g) ?? []).length).toBe(2);
  });
  test("money-multiplier legend: the decimal only, grouped (R6 #12)", () => {
    expect(legendDecimal("m·ΔB = 101000/1001 ≈ 100.8991")).toBe("m·ΔB = 100.8991");
    expect(legendDecimal("m·B = 1000000")).toBe("m·B = 1,000,000");
    expect(legendDecimal("x = 12.34567")).toBe("x = 12.34567");
  });
  test("bracket marks are decided on the printed p: a pair printed .050 carries no star", () => {
    const b = (p: number): SigBracket => ({ i: 0, j: 1, p, significant: true }) as unknown as SigBracket;
    expect(markFor(b(0.0494), 0.05)).toBe("*"); // prints 0.049
    expect(markFor(b(0.0496), 0.05)).toBe("ns"); // prints 0.050: "at the 5% boundary" in the text
    expect(markFor(b(0.0004), 0.05)).toBe("***");
  });
});

describe("the re-render time budget (a style fit never freezes Word on a slow calculator)", () => {
  test("after RENDER_BUDGET_MS of recomputing, the renderer refuses with a message naming the remedy", () => {
    let clock = 0;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const render = figureRenderer(() => {
        clock += 1500; // each recompute "takes" 1.5 seconds
        return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
      });
      expect(render(400)).toContain("<svg");
      expect(render(400)).toContain("<svg");
      expect(render(400)).toContain("<svg"); // 4.5 s spent, past the 4 s budget
      expect(() => render(400)).toThrow(RENDER_BUDGET_MESSAGE);
    } finally {
      spy.mockRestore();
    }
  });
});
