/**
 * "Fully inclusive" (2026-10-28): the new fin-currency figure (lib/finPaneFigures.ts), bars of the converted amounts
 * in the target currency, read from the result's own conversions table.
 */
import { finCurrencyFigure, finCurrencyWithFigure } from "../finPaneFigures";
import { cellAmount, currencyConversions } from "../finPaneReadings";
import { finCurrencyCalc, FIN_CURRENCY_DEFAULTS } from "../econE5aCalcs";
import { withFinFig } from "../financeFigures";

const run = (o: Record<string, string> = {}) => finCurrencyCalc((k: string) => ({ ...FIN_CURRENCY_DEFAULTS, ...o })[k] ?? "");

/**
 * The value labels hBarSvg prints beside the bars: since 2026-10-28 (figure fix) each is the table's own Converted
 * cell ("€ 1,250.00 (EUR)"), never "1250 EUR" or money in ×10ⁿ. Returned in drawing order.
 */
const unesc = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const valueLabels = (svg: string, cells: string[]): string[] =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unesc(m[1])).filter((t) => cells.includes(t));
const cellsOf = (o: Parameters<typeof currencyConversions>[0]): string[] => currencyConversions(o)!.rows.map((r) => r[2]);

describe("fin-currency figure", () => {
  test("defaults: a figure with one bar per conversion, in the target currency", () => {
    const out = finCurrencyWithFigure(run());
    expect(out.svg).toMatch(/^<svg[\s>]/);
    expect(out.svg).toContain("Amounts converted to EUR");
    const conv = currencyConversions(out)!;
    expect(valueLabels(out.svg!, cellsOf(out))).toEqual(conv.rows.map((r) => r[2]));
    expect(out.svg).not.toMatch(/\d EUR<|×10/);
    // Text and tables untouched.
    const plain = run();
    expect(out.text).toBe(plain.text);
    expect(out.tables).toEqual(plain.tables);
  });

  test("the plotted values are the table's Converted cells (two spot checks against the engine's rates)", () => {
    const out = run();
    const conv = currencyConversions(out)!;
    // 1250.00 EUR to EUR is 1,250.00; 980.50 GBP at EUR 0.92 / GBP 0.785 is 1,149.08 (rounded once, to the cent).
    expect(cellAmount(conv.rows[0][2])).toBe(1250);
    expect(cellAmount(conv.rows[1][2])).toBeCloseTo((980.5 * 0.92) / 0.785, 2);
    const svg = finCurrencyFigure(out)!;
    expect(valueLabels(svg, cellsOf(out)).slice(0, 2)).toEqual([conv.rows[0][2], conv.rows[1][2]]);
  });

  test("cellAmount reads symbols, codes, grouping and a true minus", () => {
    const NB = String.fromCharCode(0xa0);
    expect(cellAmount(`€${NB}1,250.00${NB}(EUR)`)).toBe(1250);
    expect(cellAmount(`KWD${NB}420.125`)).toBe(420.125);
    expect(cellAmount(`−$${NB}1,000.50${NB}(USD)`)).toBe(-1000.5);
    expect(cellAmount("")).toBeNaN();
  });

  test("hostile inputs: one amount, all equal, huge, negative, none, many, a refusal", () => {
    const one = finCurrencyWithFigure(run({ amounts: "100 GBP" }));
    expect(one.svg).toMatch(/^<svg/);
    const equal = finCurrencyWithFigure(run({ amounts: "100 EUR\n100 EUR\n100 EUR" }));
    expect(valueLabels(equal.svg!, cellsOf(equal))).toHaveLength(3);
    expect(cellsOf(equal).every((c) => c.includes("100.00"))).toBe(true);
    const huge = finCurrencyWithFigure(run({ amounts: "999999999999999 JPY\n1 EUR" }));
    expect(huge.svg).toMatch(/^<svg/);
    expect(huge.svg).not.toMatch(/NaN|Infinity|e\+/);
    const neg = finCurrencyWithFigure(run({ amounts: "-500 EUR\n250 GBP" }));
    if (neg.ok !== false) {
      expect(neg.svg).toMatch(/^<svg/);
      expect(valueLabels(neg.svg!, cellsOf(neg))[0]).toContain("500.00");
      expect(valueLabels(neg.svg!, cellsOf(neg))[0]).toMatch(/^−/);
    }
    const none = finCurrencyWithFigure(run({ amounts: "" }));
    expect(none.svg).toBeUndefined();
    const many = finCurrencyWithFigure(run({ amounts: Array.from({ length: 30 }, (_, i) => `${i + 1} EUR`).join("\n") }));
    expect(many.svg).toContain("and 6 more");
    const bad = finCurrencyWithFigure(run({ base: "ZZZ" }));
    expect(bad.ok).toBe(false);
    expect((bad as { svg?: string }).svg).toBeUndefined();
  });

  test("re-renders at another width and in black and white (withFinFig)", () => {
    const svg = withFinFig({ width: 520, bw: true }, () => finCurrencyFigure(run()))!;
    expect(svg).toMatch(/^<svg[^>]*width="520"/);
    expect(svg).not.toMatch(/#2563eb|#b91c1c/);
  });
});
