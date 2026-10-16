// The second axis.ts migration (docs/SCOPE-JOURNAL-FIGURES-2026-10.md §B):
// the builders that still formatted ticks one VALUE at a time — spectra and
// overlay (negated axes), av figures, pmf / proportion-CI bars, the persistence
// barcode, the LP region and the sequence maps — now label each axis as ONE
// axis.ts row. What every row must satisfy:
//   - labels distinct (intended exceptions: the mirrored MS axis, stacked panels);
//   - the same number of decimals across the row;
//   - no e-notation;
//   - U+2212, never hyphen-minus, on negatives.

import { buildPlotSvg, Series } from "../plot";
import { MINUS, THIN_SPACE, integerAxis } from "../axis";
import { rowLabeller, negateLabel, plotLinearDomain } from "../flippedAxis";
import { tryProbability } from "../probability";
import { tryLp } from "../lp";
import { barcodeSvg, persistentHomology } from "../persistence";
import { bpAxisTicks, bpEndLabel, buildLinearMapSvg } from "../seqmap";
import { buildCircularMapSvg } from "../seqmapcirc";
import { parseGenBank } from "../seqio";

/** A tick label: optional minus, digits grouped by THIN_SPACE, optional decimals. */
const NUMERIC = new RegExp(`^[${MINUS}-]?\\d[\\d${THIN_SPACE}.]*$`);
const decimals = (s: string): number => (s.split(".")[1] ?? "").replace(/[^0-9].*$/, "").length;

/** Numeric <text> rows: x-axis rows keyed by y (anchor middle), y-axis rows by x (anchor end). */
function numericRows(svg: string): { x: string[][]; y: string[][] } {
  const xs = new Map<string, string[]>();
  const ys = new Map<string, string[]>();
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const t = m[2].trim();
    if (!NUMERIC.test(t)) continue;
    const anchor = /text-anchor="(\w+)"/.exec(m[1])?.[1] ?? "start";
    const x = /\bx="([-\d.]+)"/.exec(m[1])?.[1] ?? "";
    const y = /\by="([-\d.]+)"/.exec(m[1])?.[1] ?? "";
    if (anchor === "end") ys.set(x, [...(ys.get(x) ?? []), t]);
    else xs.set(y, [...(xs.get(y) ?? []), t]);
  }
  const big = (m: Map<string, string[]>) => [...m.values()].filter((r) => r.length >= 3);
  return { x: big(xs), y: big(ys) };
}

function expectCleanRow(row: string[], allowDuplicates = false): void {
  expect(row.length).toBeGreaterThanOrEqual(2);
  if (!allowDuplicates) expect(new Set(row).size).toBe(row.length);
  expect(new Set(row.map(decimals)).size).toBe(1);
  for (const l of row) {
    expect(l).not.toMatch(/e[+-]?\d/);
    expect(l).not.toMatch(/-/);
  }
}

describe("flippedAxis: a negated axis is labelled from plot.ts's own row", () => {
  // The decisive check does not trust the domain reproduction: render the
  // SAME negated series with no hook (plot.ts labels its own row) and with
  // the hook, and require hook labels = plot's labels with the sign toggled.
  const cases: [string, Series[], boolean][] = [
    ["1H NMR sticks", [{ type: "line", points: [{ x: -12.34, y: 0 }, { x: -7.26, y: 1 }, { x: -2.35, y: 0.3 }, { x: -0.4, y: 0 }] }], false],
    ["13C wide", [{ type: "line", points: [{ x: -205, y: 0 }, { x: -128.5, y: 1 }, { x: -14.1, y: 0 }] }], false],
    ["IR", [{ type: "line", points: [{ x: -4000, y: 98 }, { x: -1700, y: 12 }, { x: -400, y: 95 }] }], false],
    ["COSY both", [{ type: "scatter", points: [{ x: -3.69, y: -3.69 }, { x: -1.22, y: -1.22 }, { x: -3.69, y: -1.22 }] }], true],
    ["HSQC both", [{ type: "scatter", points: [{ x: -7.2, y: -129 }, { x: -2.3, y: -21.4 }] }], true],
    ["one point (zero span)", [{ type: "scatter", points: [{ x: -7.26, y: -128 }] }], true],
  ];
  for (const [name, series, both] of cases) {
    test(name, () => {
      const plain = numericRows(buildPlotSvg(series, { width: 380, height: 260 }));
      const xl = rowLabeller(series, "x", true)!;
      const yl = both ? rowLabeller(series, "y", true)! : null;
      const hooked = numericRows(
        buildPlotSvg(series, { width: 380, height: 260, xTickLabel: xl.label, ...(yl ? { yTickLabel: yl.label } : {}) }),
      );
      const px = plain.x.find((r) => r.some((l) => l.startsWith(MINUS)));
      const hx = hooked.x[hooked.x.length - 1];
      expect(px).toBeDefined();
      expect(hx).toEqual(px!.map(negateLabel));
      expectCleanRow(hx);
      if (yl) {
        const py = plain.y.find((r) => r.some((l) => l.startsWith(MINUS)));
        expect(py).toBeDefined();
        if (py) expect(hooked.y.find((r) => r.length === py.length)).toEqual(py.map(negateLabel));
      }
    });
  }

  test("negateLabel toggles U+2212 and never signs a zero", () => {
    expect(negateLabel("1.5")).toBe(`${MINUS}1.5`);
    expect(negateLabel(`${MINUS}1.5`)).toBe("1.5");
    expect(negateLabel("0.0")).toBe("0.0");
    expect(negateLabel("0")).toBe("0");
  });

  test("the y domain carries plot.ts's 6% padding; x carries none", () => {
    const s: Series[] = [{ type: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 100 }] }];
    expect(plotLinearDomain(s, "x")).toEqual([0, 10]);
    const [lo, hi] = plotLinearDomain(s, "y")!;
    expect(lo).toBeCloseTo(-6, 9);
    expect(hi).toBeCloseTo(106, 9);
    expect(plotLinearDomain([{ type: "line", points: [{ x: NaN, y: 1 }] }], "x")).toBeNull();
  });
});

describe("integerAxis: counts and coordinates tick on whole numbers", () => {
  test.each([
    [0, 6],
    [0, 3],
    [0, 60],
    [5, 9],
    [0, 1],
  ])("%d to %d", (lo, hi) => {
    const r = integerAxis(lo, hi, { target: 8 });
    expect(r.values.length).toBeGreaterThanOrEqual(2);
    for (const v of r.values) expect(Number.isInteger(v)).toBe(true);
    expect(new Set(r.labels).size).toBe(r.labels.length);
  });
});

describe("hand-drawn axes now read as rows", () => {
  test("pmf bars, 61 wide: k steps 0, 10 … 60, not by 4; P axis has constant decimals", () => {
    const svg = tryProbability("binomial n=60 p=0.3 P(X <= 15)")!.svg!;
    const { x, y } = numericRows(svg);
    expect(x[0]).toEqual(["0", "10", "20", "30", "40", "50", "60"]);
    expectCleanRow(y[0]);
  });

  test("pmf bars, hypergeometric", () => {
    const svg = tryProbability("hypergeometric N=50 K=5 n=10 P(X=1)")!.svg!;
    const { x, y } = numericRows(svg);
    expectCleanRow(x[0]);
    expectCleanRow(y[0]);
  });

  test("proportion CI bars: 0.0, 0.2 … 1.0", () => {
    const svg = tryProbability("95% confidence interval for a proportion with 12 successes out of 40")!.svg!;
    expect(numericRows(svg).x[0]).toEqual(["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"]);
  });

  test("persistence barcode scale axis", () => {
    const pts: number[][] = [];
    for (let i = 0; i < 14; i++) {
      const a = (2 * Math.PI * i) / 14;
      pts.push([Math.cos(a) + 0.03 * Math.sin(7 * a), Math.sin(a) + 0.03 * Math.cos(5 * a)]);
    }
    const svg = barcodeSvg(persistentHomology(pts, { maxDim: 1 }));
    const { x } = numericRows(svg);
    expectCleanRow(x[0]);
    expect(x[0][0]).toMatch(/^0(\.0+)?$/);
  });

  test("LP region: U+2212 and constant decimals (was -1, -0.5, 0, 0.5)", () => {
    const svg = tryLp("maximize x + y subject to x - y <= 1, x >= 0, y >= 0")!.svg!;
    const { x, y } = numericRows(svg);
    for (const r of [...x, ...y]) expectCleanRow(r);
    expect(y.flat().some((l) => l.startsWith(MINUS))).toBe(true);
  });

  test("LP region on a tiny scale carries ×10ⁿ on the variable, never 1e-7", () => {
    const svg = tryLp("maximize x + y subject to 1000000 x + 1000000 y <= 1, x >= 0, y >= 0")?.svg;
    if (!svg) return; // the engine may refuse; the figure is then not drawn at all
    expect(svg).not.toMatch(/\de-\d/);
  });
});

describe("sequence maps: the bp axis is one row", () => {
  test("below 10 kb: whole base pairs", () => {
    const t = bpAxisTicks(4361);
    for (const { bp } of t) expect(Number.isInteger(bp)).toBe(true);
    expect(t.map((k) => k.label)).toEqual(integerAxis(0, 4361, { target: 8 }).labels);
    expectCleanRow(t.map((k) => k.label));
  });

  test("from 10 kb: kilobases with constant decimals (no 2 kb next to 2.5 kb)", () => {
    for (const len of [10000, 12345, 48502, 168903]) {
      const t = bpAxisTicks(len);
      const labs = t.map((k) => k.label.replace(/ kb$/, ""));
      expect(t.every((k) => k.label.endsWith(" kb"))).toBe(true);
      expectCleanRow(labs);
    }
  });

  test("tiny records still tick on whole bases", () => {
    for (const len of [1, 3, 7, 12]) for (const k of bpAxisTicks(len)) expect(Number.isInteger(k.bp)).toBe(true);
    expect(bpAxisTicks(0)).toEqual([]);
    expect(bpAxisTicks(NaN)).toEqual([]);
  });

  test("the end coordinate is exact and grouped by a thin space, never a locale comma", () => {
    expect(bpEndLabel(600)).toBe("600");
    expect(bpEndLabel(4361)).toBe("4361");
    expect(bpEndLabel(48502)).toBe(`48${THIN_SPACE}502`);
  });

  const GB = `LOCUS       pBIG                   48502 bp    DNA     circular SYN 15-JUL-2026
FEATURES             Location/Qualifiers
     CDS             1001..9000
                     /gene="bigG"
ORIGIN
        1 ${"acgt".repeat(12125)}ac
//
`;
  test("linear and circular maps of a 48.5 kb record draw clean kb rows", () => {
    const r = parseGenBank(GB);
    if (!r.ok) throw new Error(r.error);
    expect(r.records[0].length).toBe(48502);
    for (const svg of [buildLinearMapSvg(r.records[0])!, buildCircularMapSvg(r.records[0])!]) {
      expect(svg).toContain(`48${THIN_SPACE}502 bp`);
      const kb = [...svg.matchAll(/>([^<]*) kb</g)].map((m) => m[1]);
      expect(kb.length).toBeGreaterThanOrEqual(3);
      expect(new Set(kb.map(decimals)).size).toBe(1);
      expect(svg).not.toContain("48,502");
    }
  });
});
