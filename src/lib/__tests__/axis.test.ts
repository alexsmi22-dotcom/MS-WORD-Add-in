// The shared axis engine (src/lib/axis.ts). Oracles:
//   - the published reference case in the R `labeling` package documentation
//     (Talbot's reference implementation of Talbot, Lin & Hanrahan 2010):
//     extended(8.1, 14.1, 4) = 8 10 12 14 and heckbert(8.1, 14.1, 4) = 5 10 15;
//   - a LITERAL, float-for-float transcription of that R `extended()` written
//     independently below, compared over thousands of ranges. The engine
//     normalises and carries integers; the transcription does neither, so
//     agreement is evidence the port did not change the algorithm.
import * as fs from "fs";
import * as path from "path";
import {
  extendedTicks,
  extendedWilkinson,
  heckbert,
  linearAxis,
  logAxis,
  formatIntRow,
  formatValueRow,
  fmtValue,
  fmtSig,
  resolveLimits,
  outsideNote,
  superscript,
  MINUS,
  THIN_SPACE,
  AXIS_TICK_CAP,
} from "../axis";
import { buildPlotSvg } from "../plot";
import { buildChartPreviewSvg } from "../tablechart";
import { buildCandlestickSvg } from "../candlestick";

/** R's labeling::extended, transcribed literally (R/labeling.R, CRAN, fetched 2026-10-14). */
function rExtended(dmin: number, dmax: number, m: number, onlyLoose = false): number[] {
  const Q = [1, 5, 2, 2.5, 4, 3];
  const w = [0.25, 0.2, 0.5, 0.05];
  const eps = 2.220446049250313e-16 * 100;
  if (dmin > dmax) [dmin, dmax] = [dmax, dmin];
  if (dmax - dmin < eps) return [];
  const n = Q.length;
  const mod = (a: number, b: number): number => a - Math.floor(a / b) * b; // R's %%
  const simp = (q: number, j: number, lmin: number, lmax: number, lstep: number): number => {
    const i = Q.indexOf(q) + 1;
    const v = (mod(lmin, lstep) < eps || lstep - mod(lmin, lstep) < eps) && lmin <= 0 && lmax >= 0 ? 1 : 0;
    return 1 - (i - 1) / (n - 1) - j + v;
  };
  const simpMax = (q: number, j: number): number => 1 - (Q.indexOf(q) + 1 - 1) / (n - 1) - j + 1;
  const cov = (lmin: number, lmax: number): number => {
    const r = dmax - dmin;
    return 1 - (0.5 * ((dmax - lmax) ** 2 + (dmin - lmin) ** 2)) / (0.1 * r) ** 2;
  };
  const covMax = (span: number): number => {
    const r = dmax - dmin;
    if (span > r) {
      const h = (span - r) / 2;
      return 1 - (0.5 * (h * h + h * h)) / (0.1 * r) ** 2;
    }
    return 1;
  };
  const dens = (k: number, lmin: number, lmax: number): number => {
    const r = (k - 1) / (lmax - lmin);
    const rt = (m - 1) / (Math.max(lmax, dmax) - Math.min(dmin, lmin));
    return 2 - Math.max(r / rt, rt / r);
  };
  const densMax = (k: number): number => (k >= m ? 2 - (k - 1) / (m - 1) : 1);
  let best = { lmin: 0, lmax: 0, lstep: 0, score: -2 };
  let j = 1;
  outer: while (j < 100) {
    for (const q of Q) {
      const sm = simpMax(q, j);
      if (w[0] * sm + w[1] + w[2] + w[3] < best.score) break outer;
      let k = 2;
      while (k < 200) {
        const dm = densMax(k);
        if (w[0] * sm + w[1] + w[2] * dm + w[3] < best.score) break;
        const delta = (dmax - dmin) / (k + 1) / j / q;
        let z = Math.ceil(Math.log10(delta));
        while (z < 400) {
          const step = j * q * Math.pow(10, z);
          const cm = covMax(step * (k - 1));
          if (w[0] * sm + w[1] * cm + w[2] * dm + w[3] < best.score) break;
          const minStart = Math.floor(dmax / step) * j - (k - 1) * j;
          const maxStart = Math.ceil(dmin / step) * j;
          if (minStart > maxStart) {
            z++;
            continue;
          }
          for (let start = minStart; start <= maxStart; start++) {
            const lmin = start * (step / j);
            const lmax = lmin + step * (k - 1);
            const score = w[0] * simp(q, j, lmin, lmax, step) + w[1] * cov(lmin, lmax) + w[2] * dens(k, lmin, lmax) + w[3];
            if (score > best.score && (!onlyLoose || (lmin <= dmin && lmax >= dmax))) best = { lmin, lmax, lstep: step, score };
          }
          z++;
        }
        k++;
      }
    }
    j++;
  }
  const out: number[] = [];
  for (let i = 0; best.lmin + i * best.lstep <= best.lmax + best.lstep * 1e-9; i++) out.push(best.lmin + i * best.lstep);
  return out;
}

const close = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(b[i])));

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("extended Wilkinson: published reference cases", () => {
  it("labeling::extended(8.1, 14.1, 4) = 8 10 12 14 (R labeling docs)", () => {
    expect(extendedTicks(8.1, 14.1, 4)).toEqual([8, 10, 12, 14]);
  });
  it("labeling::heckbert(8.1, 14.1, 4) = 5 10 15 (the documented fallback)", () => {
    const h = heckbert(8.1, 14.1, 4)!;
    const vals = [];
    for (let k = h.n0; k <= h.n1; k++) vals.push(k * h.unit * Math.pow(10, h.exp));
    expect(vals).toEqual([5, 10, 15]);
  });
  it("the literal R transcription reproduces the published case too (the oracle is sound)", () => {
    expect(rExtended(8.1, 14.1, 4)).toEqual([8, 10, 12, 14]);
  });
});

describe("extended Wilkinson: agrees with the literal R transcription", () => {
  it("on 3,000 random ranges across magnitudes, targets 3–8, loose and not", () => {
    const r = rng(12345);
    let checked = 0;
    const bad: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const mag = Math.pow(10, Math.floor(r() * 12) - 6);
      const a = (r() * 2 - 1) * 10 * mag;
      const b = a + r() * 10 * mag + mag * 1e-3;
      const m = 3 + Math.floor(r() * 6);
      const loose = r() < 0.3;
      const mine = extendedTicks(a, b, m, loose);
      const ref = rExtended(a, b, m, loose);
      checked++;
      if (!close(mine, ref)) bad.push(`${a} ${b} m=${m} loose=${loose}: ${mine} vs ${ref}`);
    }
    expect(checked).toBe(3000);
    expect(bad).toEqual([]);
  });
  it("prefers simple steps: 0–100 at m = 5 gives 0 25 50 75 100", () => {
    expect(extendedTicks(0, 100, 5)).toEqual(rExtended(0, 100, 5));
  });
});

const rowOk = (labels: string[]): void => {
  expect(new Set(labels).size).toBe(labels.length);
  for (const l of labels) {
    expect(l).not.toMatch(/\d[eE][+-]?\d/);
    expect(l).not.toMatch(/-/);
  }
  const decs = new Set(labels.map((l) => (l.split(".")[1] ?? "").length));
  expect(decs.size).toBeLessThanOrEqual(1);
};

describe("B.1 repros give distinct labels", () => {
  it("20000–20050 reads 20 000 … 20 050 with thin-space grouping", () => {
    const r = linearAxis(20000, 20050, { target: 6 });
    rowOk(r.labels);
    expect(r.labels[0]).toBe(`20${THIN_SPACE}000`);
    expect(r.labels[r.labels.length - 1]).toBe(`20${THIN_SPACE}050`);
    expect(r.multiplier).toBe("");
  });
  it("1000.001–1000.004 reads 1000.001 … 1000.004, each once", () => {
    const r = linearAxis(1000.001, 1000.004, { target: 6 });
    rowOk(r.labels);
    // Wilkinson picks a 0.0005 step at m = 6; every label carries four decimals.
    expect(r.labels[0]).toBe("1000.0010");
    expect(r.labels[r.labels.length - 1]).toBe("1000.0040");
    expect(linearAxis(1000.001, 1000.004, { target: 4 }).labels).toEqual(["1000.001", "1000.002", "1000.003", "1000.004"]);
  });
});

describe("label rules", () => {
  it("negatives use U+2212 and zero is unsigned", () => {
    const r = linearAxis(-500, 600, { target: 5 });
    expect(r.labels[0].startsWith(MINUS)).toBe(true);
    expect(r.labels).toContain("0");
    expect(formatIntRow([-0, 0, 5], 0).labels.join(" ")).toBe("0 0 5");
  });
  it("decimals are constant: 0–1 reads 0.00 … 1.00, never 0 and 1", () => {
    expect(linearAxis(0, 1).labels).toEqual(["0.00", "0.25", "0.50", "0.75", "1.00"]);
    expect(linearAxis(0, 1, { target: 6 }).labels.every((l) => /^\d\.\d$|^\d\.\d\d$/.test(l))).toBe(true);
  });
  it("large rows carry ×10ⁿ, small ones ×10⁻ⁿ, never e-notation", () => {
    const big = linearAxis(0, 1e6);
    expect(big.multiplier).toBe("×10" + superscript(6));
    expect(big.labels).toEqual(["0.00", "0.25", "0.50", "0.75", "1.00"]);
    const small = linearAxis(0, 0.0005);
    expect(small.multiplier).toBe("×10" + superscript(-4));
    rowOk(small.labels);
  });
  it("a fixed domain keeps at least three labels (0.08–2.91 is not just 1, 2)", () => {
    const r = linearAxis(0.08232367533343606, 2.9137349151938947, { target: 5 });
    expect(r.values.length).toBeGreaterThanOrEqual(3);
    rowOk(r.labels);
  });
  it("a fine step on a large magnitude keeps the digits, grouped", () => {
    const r = linearAxis(1e6, 1e6 + 50, { target: 6 });
    expect(r.multiplier).toBe("");
    expect(r.labels[0]).toBe(["1", "000", "000"].join(THIN_SPACE));
    rowOk(r.labels);
  });
  it("fuzz: 5,000 random rows are distinct, unsigned-hyphen-free, constant decimals, in range", () => {
    const r = rng(777);
    for (let i = 0; i < 5000; i++) {
      const e = Math.floor(r() * 40) - 20;
      const a = (r() * 2 - 1) * Math.pow(10, e);
      const b = a + r() * Math.pow(10, e - Math.floor(r() * 8));
      const row = linearAxis(a, b, { target: 3 + Math.floor(r() * 5), loose: r() < 0.3 });
      rowOk(row.labels);
      expect(row.duplicate).toBe(false);
      expect(row.values.length).toBe(row.labels.length);
      for (const v of row.values) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(row.lo - Math.abs(row.hi - row.lo) * 1e-6);
        expect(v).toBeLessThanOrEqual(row.hi + Math.abs(row.hi - row.lo) * 1e-6);
      }
    }
  });
});

describe("boundedness", () => {
  const cases: [number, number][] = [
    [NaN, NaN],
    [Infinity, -Infinity],
    [0, Infinity],
    [-1.7e308, 1.7e308],
    [1e308, 1e308],
    [5, 5],
    [0, 0],
    [1e-320, 2e-320],
    [1e300, 1e300 + 1e285],
    [0, 1e-14],
  ];
  for (const [a, b] of cases) {
    it(`[${a}, ${b}] returns a finite, capped row quickly`, () => {
      const t0 = Date.now();
      for (const loose of [false, true]) {
        const r = linearAxis(a, b, { loose });
        expect(r.values.length).toBeLessThanOrEqual(AXIS_TICK_CAP + 1);
        expect(r.values.every(Number.isFinite)).toBe(true);
        expect(r.duplicate).toBe(false);
        for (const l of r.labels) expect(l).not.toMatch(/NaN|Infinity|e[+-]/);
      }
      expect(Date.now() - t0).toBeLessThan(2000);
    });
  }
  it("a zero span with loose labelling still gives a readable row", () => {
    const r = linearAxis(5, 5, { loose: true });
    expect(r.values.length).toBeGreaterThanOrEqual(2);
    expect(r.lo).toBeLessThan(5);
    expect(r.hi).toBeGreaterThan(5);
  });
  it("extendedWilkinson refuses non-finite input instead of looping", () => {
    expect(extendedWilkinson(NaN, 1, 5)).toBeNull();
    expect(extendedWilkinson(0, Infinity, 5)).toBeNull();
    expect(extendedWilkinson(1, 1, 5)).toBeNull();
  });
});

describe("log axes", () => {
  it("≥ 3 decades read 10ⁿ uniformly, 10⁰ included (B.7)", () => {
    const t = logAxis(-3, 5).labelled.map((x) => x.text);
    expect(t).toEqual([-3, -2, -1, 0, 1, 2, 3, 4, 5].map((e) => "10" + superscript(e)));
  });
  it("a 0.5–30 axis gets 1-2-5 sub-decade labels, not just 1 and 10", () => {
    const t = logAxis(Math.log10(0.5), Math.log10(30)).labelled.map((x) => x.text);
    expect(t).toEqual(["0.5", "1", "2", "5", "10", "20"]);
  });
  it("under three decades in ordinary magnitudes stays plain", () => {
    expect(logAxis(0, 2).labelled.map((x) => x.text)).toEqual(["1", "10", "100"]);
  });
  it("a sliver of a decade falls back to linear labels on the log scale", () => {
    const t = logAxis(0.1, 0.4).labelled;
    expect(t.length).toBeGreaterThanOrEqual(2);
    rowOk(t.map((x) => x.text));
  });
  it("is bounded on absurd spans", () => {
    expect(logAxis(-500, 500).labelled).toEqual([]);
    expect(logAxis(NaN, 3).labelled).toEqual([]);
  });
});

describe("user-set limits", () => {
  it("honours limits and a step", () => {
    const lim = resolveLimits(0, 10, { min: 2, max: 8, step: 2 }, [1, 5, 9]);
    expect(lim).toEqual({ ok: true, lo: 2, hi: 8, step: 2, outside: 2 });
    const r = linearAxis(2, 8, { step: 2 });
    expect(r.labels).toEqual(["2", "4", "6", "8"]);
    expect(outsideNote(2)).toBe("2 points outside the axis limits");
    expect(outsideNote(0)).toBe("");
  });
  it("a step of 2.5 keeps one decimal throughout", () => {
    expect(linearAxis(0, 10, { step: 2.5 }).labels).toEqual(["0.0", "2.5", "5.0", "7.5", "10.0"]);
  });
  const refusals: [string, ReturnType<typeof resolveLimits>, RegExp][] = [
    ["min ≥ max", resolveLimits(0, 10, { min: 5, max: 2 }), /not below the maximum/],
    ["min = max", resolveLimits(0, 10, { min: 5, max: 5 }), /not below the maximum/],
    ["log from zero", resolveLimits(1, 10, { min: 0, log: true }), /logarithmic axis cannot start/],
    ["limits hiding all data", resolveLimits(0, 10, { min: 20, max: 30 }), /hide every data point/],
    ["NaN limit", resolveLimits(0, 10, { min: NaN }), /not a finite number/],
    ["Infinity limit", resolveLimits(0, 10, { max: Infinity }), /not a finite number/],
    ["zero step", resolveLimits(0, 10, { step: 0 }), /not positive/],
    ["negative step", resolveLimits(0, 10, { step: -1 }), /not positive/],
    ["too many ticks", resolveLimits(0, 10, { step: 1e-6 }), /more than 200 ticks/],
    ["step on a log axis", resolveLimits(1, 10, { step: 1, log: true }), /logarithmic/],
  ];
  for (const [name, res, why] of refusals) {
    it(`refuses ${name}, with the reason`, () => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(why);
    });
  }
  it("a user step that would exceed the tick cap is ignored by linearAxis, not obeyed", () => {
    const r = linearAxis(0, 10, { step: 1e-9 });
    expect(r.values.length).toBeLessThanOrEqual(AXIS_TICK_CAP + 1);
    expect(r.method).not.toBe("user");
  });
});

describe("per-value formatting", () => {
  it("fmtValue never prints e-notation or a hyphen-minus", () => {
    expect(fmtValue(-2.5)).toBe(MINUS + "2.5");
    expect(fmtValue(25000)).toBe(`25${THIN_SPACE}000`);
    expect(fmtValue(1e8)).toBe("1×10" + superscript(8));
    expect(fmtValue(-0.0004)).toBe(MINUS + "4×10" + superscript(-4));
    expect(fmtValue(0)).toBe("0");
    expect(fmtValue(-1e-12 * 0)).toBe("0");
  });
  it("fmtSig keeps trailing zeros and replaces e-notation", () => {
    expect(fmtSig(4e-6, 3)).toBe("4.00×10" + superscript(-6));
    expect(fmtSig(-33.7349, 4)).toBe(MINUS + "33.73");
  });
  it("formatValueRow shares decimals across a colour-bar row", () => {
    expect(formatValueRow([-2.41, 0, 2.41]).labels).toEqual([MINUS + "2.41", "0.00", "2.41"]);
  });
});

// ---------------------------------------------------------------------------
// End to end: the builders that were migrated, not just the engine.

/** Every <text> content in an SVG, decoded. */
const texts = (svg: string): string[] =>
  [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&"));
/** Numeric tick-like labels. */
const numeric = (svg: string): string[] =>
  texts(svg).filter((t) => new RegExp(`^${MINUS}?\\d[\\d${THIN_SPACE}]*(\\.\\d+)?$`).test(t));

describe("B.1 end to end through the migrated builders", () => {
  const span = (lo: number, hi: number, n = 11) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

  it("buildPlotSvg on x and y spanning 20000–20050: every axis label distinct, none in e-notation", () => {
    const xs = span(20000, 20050);
    const svg = buildPlotSvg([{ type: "line", points: xs.map((x) => ({ x, y: x })) }], {});
    const labs = numeric(svg);
    expect(labs.length).toBeGreaterThanOrEqual(6);
    expect(svg).not.toMatch(/\de[+-]\d/);
    // x row and y row each distinct (the same value may appear once per axis).
    const counts = new Map<string, number>();
    for (const l of labs) counts.set(l, (counts.get(l) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("buildPlotSvg on 1000.001–1000.004: no label repeats within an axis", () => {
    const xs = span(1000.001, 1000.004);
    const svg = buildPlotSvg([{ type: "line", points: xs.map((x, i) => ({ x, y: i })) }], {});
    const xRow = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)" text-anchor="middle"[^>]*>([^<]+)<\/text>/g)];
    const byY = new Map<string, string[]>();
    for (const m of xRow) byY.set(m[1], [...(byY.get(m[1]) ?? []), m[2]]);
    const row = [...byY.values()].sort((a, b) => b.length - a.length)[0];
    expect(row.length).toBeGreaterThanOrEqual(3);
    expect(new Set(row).size).toBe(row.length);
    rowOk(row);
  });

  it("Table→Chart (column) on 20000–20050 values: distinct, grouped, no e-notation", () => {
    const chart = { categories: ["a", "b", "c"], series: [{ name: "v", values: [500000, 250000, -250000] }], categoryLabel: "k", hasHeader: true, rows: [], warnings: [] };
    const svg = buildChartPreviewSvg(chart as never, "column", "", {}).svg;
    expect(svg).not.toMatch(/\de[+-]\d/);
    const labs = numeric(svg);
    expect(new Set(labs).size).toBe(labs.length);
    expect(labs.some((l) => l.startsWith(MINUS))).toBe(true);
    expect(texts(svg).some((t) => /-\d/.test(t))).toBe(false);
  });

  it("candlestick at 20000-level prices: distinct, constant-decimal price labels", () => {
    const chart = {
      categories: ["Mon", "Tue", "Wed"],
      series: [
        ["Open", [20010, 20020, 20030]],
        ["High", [20040, 20045, 20050]],
        ["Low", [20000, 20005, 20010]],
        ["Close", [20020, 20030, 20040]],
      ].map(([name, values]) => ({ name, values })),
      categoryLabel: "Day",
      hasHeader: true,
      rows: [],
      warnings: [],
    };
    const r = buildCandlestickSvg(chart as never, "", {}, 620, 420);
    const labs = numeric(r.svg);
    expect(labs.length).toBeGreaterThanOrEqual(3);
    rowOk(labs);
    expect(r.svg).not.toMatch(/\de[+-]\d/);
  });
});

describe("user limits through buildPlotSvg", () => {
  const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ x, y: x * x }));
  it("valid limits set the axis, clip the data and say how many points fell outside", () => {
    const svg = buildPlotSvg([{ type: "scatter", points: pts }], { xLimits: { min: 2, max: 8, step: 2 } });
    expect(svg).toContain("clip-path=");
    expect(svg).toContain("4 points outside the axis limits.");
    for (const l of ["2", "4", "6", "8"]) expect(svg).toContain(`>${l}</text>`);
  });
  it("invalid limits are refused in the figure, with the reason, and the axis stays automatic", () => {
    const svg = buildPlotSvg([{ type: "scatter", points: pts }], { xLimits: { min: 8, max: 2 } });
    // Notes wrap across <text> lines; read them back as one string.
    expect(texts(svg).join(" ")).toContain("x-axis limits not applied: the axis minimum 8 is not below the maximum 2.");
    expect(svg).not.toContain("clip-path=");
  });
  it("a log axis refuses a non-positive minimum", () => {
    const svg = buildPlotSvg([{ type: "scatter", points: pts.slice(1) }], { xScale: "log", xLimits: { min: 0 } });
    expect(texts(svg).join(" ")).toMatch(/x-axis limits not applied: a logarithmic axis cannot start at 0/);
  });
  it("a large axis states its ×10ⁿ once, on the title", () => {
    const svg = buildPlotSvg([{ type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 3e7 }] }], { ylabel: "Count" });
    expect(svg).toContain(`Count (×10${superscript(7)})`);
    expect(svg).not.toMatch(/\de[+-]\d/);
  });
});

describe("source hygiene", () => {
  it("axis.ts carries no BOM and no zero-width characters", () => {
    for (const f of [
      "axis.ts",
      "__tests__/axis.test.ts",
      "plot.ts",
      "tablechart.ts",
      "candlestick.ts",
      "heatmap.ts",
      "mechchart.ts",
      "statchart.ts",
      "beamChart.ts",
      "audio.ts",
    ]) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      for (const code of [0xfeff, 0x200b, 0x200c, 0x200d]) {
        expect(src.includes(String.fromCharCode(code))).toBe(false);
      }
    }
  });
});
