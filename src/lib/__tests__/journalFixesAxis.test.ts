// v2.143.0 independent adversarial review — confirmed axis / colour-bar / parse
// defects, each pinned here before its fix.

import { linearAxis, logAxis, fmtSig, formatValueRow, resolveLimits, AXIS_TICK_CAP, MINUS } from "../axis";
import { buildPlotSvg } from "../plot";
import { buildHeatmapSvg } from "../heatmap";
import type { TableChart } from "../tablechart";
import { parseCellNumber } from "../dataimport";
import { readNumberList } from "../numberList";

const SUP = (s: string): string => s; // literal superscripts are typed below

/** The numeric value a label row states (labels + multiplier), for checking correctness. */
function labelValue(label: string, multiplier: string): number {
  const THIN = String.fromCharCode(0x2009);
  const body = label.split(THIN).join("").replace(MINUS, "-");
  const v = Number(body);
  if (!multiplier) return v;
  return parseCellNumber(`${body}${multiplier}`);
}

describe("item 3: a narrow span at a large magnitude is not a zero span", () => {
  test("linearAxis(1e15, 1e15+100) non-loose gives several distinct, correct ticks", () => {
    const r = linearAxis(1e15, 1e15 + 100);
    expect(r.method).not.toBe("degenerate");
    expect(r.values.length).toBeGreaterThan(1);
    expect(new Set(r.labels).size).toBe(r.labels.length);
    expect(r.duplicate).toBe(false);
    r.values.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(1e15);
      expect(v).toBeLessThanOrEqual(1e15 + 100);
      expect(labelValue(r.labels[i], r.multiplier)).toBe(v);
    });
  });

  test("loose mode on a narrow span pads by the span, not 10% of the magnitude", () => {
    const r = linearAxis(1e15, 1e15 + 100, { loose: true });
    expect(r.hi - r.lo).toBeLessThan(1000);
    expect(r.lo).toBeLessThanOrEqual(1e15);
    expect(r.hi).toBeGreaterThanOrEqual(1e15 + 100);
    expect(new Set(r.labels).size).toBe(r.labels.length);
  });

  test("buildPlotSvg x from 4.5e14 to 4.5e14+500 labels several distinct x ticks", () => {
    const svg = buildPlotSvg([{ points: [{ x: 4.5e14, y: 1 }, { x: 4.5e14 + 250, y: 3 }, { x: 4.5e14 + 500, y: 2 }] }] as never);
    const texts = Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)).map((m) => m[1]);
    // fix2-paf: offset notation. The ticks are labelled relative to a round
    // offset stated once on the axis title ("ticks + 4.5×10¹⁴") instead of as
    // 15-digit numbers that ran into each other; still several DISTINCT ticks.
    expect(texts.some((t) => /^ticks \+ 4\.5×10/.test(t))).toBe(true);
    const xLike = texts.filter((t) => /^\d+$/.test(t));
    expect(new Set(xLike).size).toBeGreaterThan(1);
    expect(texts).not.toContain("4.5×10¹⁴");
  });

  test("a span of a few ULPs is still a zero span, and constant data still pads", () => {
    const r = linearAxis(1e15, 1e15);
    expect(r.method).toBe("degenerate");
    expect(r.values).toEqual([1e15]);
    const l = linearAxis(5, 5, { loose: true });
    expect(l.values.length).toBeGreaterThan(1);
  });

  test("no span between 1 ULP and 400 ULPs, at any magnitude, gives an empty or duplicated axis", () => {
    const bad: string[] = [];
    for (const mag of [1, 7.3, 1e15, 4.5e14, 1e-300, 1e300, 123456789, -42]) {
      for (let u = 1; u < 400; u = Math.ceil(u * 1.3)) {
        for (const loose of [false, true]) {
          const a = mag;
          const b = mag + u * Math.abs(mag) * Number.EPSILON;
          const r = linearAxis(a, b, { loose });
          if (r.values.length === 0 || r.duplicate || new Set(r.labels).size !== r.labels.length) bad.push(`${mag} +${u}ulp loose=${loose}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("ordinary ranges are unchanged", () => {
    expect(linearAxis(0, 10).labels).toEqual(["0.0", "2.5", "5.0", "7.5", "10.0"]);
    expect(linearAxis(20000, 20050).labels.length).toBeGreaterThan(2);
  });
});

describe("item 5: colour-bar end labels state the true min and max", () => {
  const mk = (vals: number[]): TableChart =>
    ({
      categories: vals.map((_, i) => `r${i}`),
      series: [{ name: "A", values: vals }],
      categoryLabel: "Row",
      hasHeader: true,
      rows: [],
      warnings: [],
    }) as unknown as TableChart;
  const barEnds = (svg: string): string[] =>
    Array.from(svg.matchAll(/text-anchor="(?:start|end)" font-family="Segoe UI, Arial, sans-serif" font-size="9.5"[^>]*>([^<]*)</g)).map((m) => m[1]);

  test("data 1 … 10⁶: no 0×10⁶, ends read 1 and 1×10⁶", () => {
    const ends = barEnds(buildHeatmapSvg(mk([1, 10, 1000, 1e6]), "t").svg);
    expect(ends.length).toBe(2);
    expect(ends.join(" ")).not.toMatch(/^0×10|\s0×10/);
    expect(parseCellNumber(ends[0])).toBe(1);
    expect(parseCellNumber(ends[1])).toBe(1e6);
  });

  test("data 0.00012 … 0.5: the low end is not 0.0", () => {
    const ends = barEnds(buildHeatmapSvg(mk([0.00012, 0.1, 0.5]), "t").svg);
    expect(ends.length).toBe(2);
    expect(parseCellNumber(ends[0])).toBeCloseTo(0.00012, 10);
    expect(parseCellNumber(ends[1])).toBe(0.5);
  });

  test("formatValueRow never prints a nonzero value as 0×10ⁿ", () => {
    const r = formatValueRow([1, 1e6]);
    const shown = r.labels.map((l) => l + r.multiplier);
    expect(shown.some((s) => /^0(×|$)/.test(s))).toBe(false);
  });

  test("formatValueRow([1, 1+1e-15, 2]) gives distinct labels", () => {
    const r = formatValueRow([1, 1 + 1e-15, 2]);
    expect(new Set(r.labels.map((l) => l + r.multiplier)).size).toBe(3);
    expect(r.duplicate).toBe(false);
  });

  test("formatValueRow([−1e-9, 0, 1e9]) gives distinct, correct labels", () => {
    const r = formatValueRow([-1e-9, 0, 1e9]);
    const shown = r.labels.map((l) => l + r.multiplier);
    expect(new Set(shown).size).toBe(3);
    expect(r.duplicate).toBe(false);
    expect(parseCellNumber(shown[0])).toBe(-1e-9);
    expect(parseCellNumber(shown[2])).toBe(1e9);
  });

  test("ordinary rows are unchanged", () => {
    expect(formatValueRow([5, 40]).labels).toEqual(["5", "40"]);
    const d = formatValueRow([-35, 0, 35]);
    expect(d.labels).toEqual([MINUS + "35", "0", "35"]);
  });
});

describe("axis low-severity items", () => {
  test("fmtSig keeps trailing zeros in the plain range: fmtSig(4, 3) = 4.00", () => {
    expect(fmtSig(4, 3)).toBe("4.00");
    expect(fmtSig(-0.5, 3)).toBe(MINUS + "0.500");
    expect(fmtSig(12345, 3)).toBe("12300");
    expect(fmtSig(1.5e7, 3)).toBe("1.50×10⁷");
  });

  test("a user step never yields more than AXIS_TICK_CAP ticks", () => {
    expect(linearAxis(0, 1000, { step: 5 }).values.length).toBeLessThanOrEqual(AXIS_TICK_CAP);
    expect(linearAxis(0, 995, { step: 5 }).values.length).toBe(200);
    const lim = resolveLimits(0, 1000, { step: 5 });
    expect(lim.ok).toBe(false);
  });

  test("logAxis over 41 decades labels a decimated subset", () => {
    const ax = logAxis(0, 41);
    expect(ax.labelled.length).toBeGreaterThanOrEqual(3);
    expect(ax.labelled.length).toBeLessThanOrEqual(21);
    expect(ax.labelled[0].text).toBe("10⁰");
    expect(new Set(ax.labelled.map((t) => t.text)).size).toBe(ax.labelled.length);
    // Uniform stride
    const exps = ax.labelled.map((t) => Math.round(Math.log10(t.v)));
    const d = exps[1] - exps[0];
    exps.forEach((e, i) => i && expect(e - exps[i - 1]).toBe(d));
  });

  test("linearAxis target NaN falls back to the default target", () => {
    expect(linearAxis(0, 10, { target: NaN }).labels).toEqual(linearAxis(0, 10).labels);
  });
});

describe("parse-back: what the axes print must parse; silent wrong values are refused", () => {
  test("10³ and 10⁻³ (log-axis labels) parse", () => {
    expect(parseCellNumber(SUP("10³"))).toBe(1000);
    expect(parseCellNumber(SUP("10⁻³"))).toBe(0.001);
    expect(parseCellNumber("10⁰")).toBe(1);
    expect(readNumberList("10³ 10⁻³").values).toEqual([1000, 0.001]);
  });

  test("1×10⁻⁹⁹⁹ is refused, like 1×10^999 (no silent underflow to 0)", () => {
    expect(parseCellNumber("1×10^999")).toBeNaN();
    expect(parseCellNumber("1×10⁻⁹⁹⁹")).toBeNaN();
    expect(parseCellNumber("0×10³")).toBe(0);
  });

  test("2×10³×10² is refused", () => {
    expect(parseCellNumber("2×10³×10²")).toBeNaN();
    expect(readNumberList("1 2×10³×10² 3").dropped).toEqual(["2×10³×10²"]);
  });

  test("0x10^3 is refused as hex-like", () => {
    expect(parseCellNumber("0x10^3")).toBeNaN();
    expect(parseCellNumber("2x10^3")).toBe(2000);
  });

  test("1,5 is still a decimal comma", () => {
    expect(parseCellNumber("1,5")).toBe(1.5);
    expect(readNumberList("1,5 2,3").values).toEqual([1.5, 2.3]);
  });
});
