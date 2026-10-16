// v2.143.0 SECOND adversarial review: confirmed defects, pinned.
//
//   1. bracketsFromTukey falsely refused genuine tukeyHSD results on large-offset
//      data: the CI width check was scaled to the width, but ciHigh − ciLow loses
//      about one ULP of the (large) endpoints.
//   2. linearAxis(1.7e308, 1.7e308, { loose: true }) never returned: the 10% pad
//      overflowed to ∞ and scale10(x, −∞) looped forever. Reachable from a box
//      plot of two adjacent doubles at Number.MAX_VALUE.
//   3. fitRemedy offered "Hide ns" without trying it, and BracketFitError quoted
//      the whole plot height although the cap is 60% of it.
//   4. Zero within-group variance: q = ∞, p = 0, drawn as "****" while the engine
//      said "Do not report these p values".

import { spawnSync } from "child_process";
import * as path from "path";
import { tukeyHSD, studentizedRangeP, type TukeyResult } from "../tukey";
import { bracketsFromTukey, bracketsFromPairwise } from "../sigBrackets";
import { bracketedBoxPlot } from "../statsBrackets";
import { twoSampleTTest, pairedTTest } from "../stats";
import { linearAxis, logAxis, formatValueRow, scale10 } from "../axis";
import { parseCellNumber, isNumericCell, cellNumberText } from "../dataimport";

describe("colour-bar end labels state the true min/max within 1% (low)", () => {
  test("a minimum of 0.096 does not print as 0.1", () => {
    const r = formatValueRow([0.096, 10]);
    expect(r.labels[0]).not.toBe("0.1");
    expect(Number(r.labels[0])).toBeCloseTo(0.096, 6);
  });
  test("every non-zero label reads back within 1% of its value", () => {
    for (const row of [[0.096, 10], [0.79, 9840], [0.00012, 0.5], [-2.41, 0, 2.41], [3.2, 48.7], [1, 1e6]]) {
      const r = formatValueRow(row);
      row.forEach((v, i) => {
        if (v === 0) return;
        // The display contract: what is shown parses back (U+2212, ×10ⁿ).
        const read = parseCellNumber(r.labels[i] + r.multiplier);
        expect(Math.abs(read - v)).toBeLessThanOrEqual(0.01 * Math.abs(v));
      });
    }
  });
});

describe("parseCellNumber: literals that would be silently wrong are refused (low)", () => {
  test.each(["1e-400", "-1e-400", "5e-330", "0b11", "0B11", "0o7", "-0o7", "0x10", "1e5×10³", "1E5 x 10^3", "2.5e-3×10⁻²"])("%s is refused", (s) => {
    expect(parseCellNumber(s)).toBeNaN();
    expect(isNumericCell(s)).toBe(false);
  });
  test("cellNumberText never hands an underflowing spelling on as a number", () => {
    expect(cellNumberText("1e-400")).toBe("NaN");
    expect(cellNumberText("1e-3")).toBe("1e-3");
  });
  test.each([
    ["1,000", 1000],
    ["1,5", 1.5],
    ["0e-400", 0],
    ["0.000e5", 0],
    ["1e-300", 1e-300],
    ["2.5×10⁻³", 0.0025],
    ["0", 0],
    ["007", 7],
    ["1e5", 100000],
  ])("%s still reads as %d", (s, v) => {
    expect(parseCellNumber(s as string)).toBe(v);
  });
});

const ROOT = path.resolve(__dirname, "../../..");

/** Runs `expr` in a child node (the product's own TS loader) with a hard timeout: a hang FAILS instead of wedging jest. */
function runBounded(expr: string, ms = 20000): { status: number | null; out: string; timedOut: boolean } {
  const code = `require(${JSON.stringify(path.join(ROOT, "scripts", "ts-require.js"))});const r=(()=>{${expr}})();process.stdout.write(String(r));`;
  const res = spawnSync(process.execPath, ["-e", code], { cwd: ROOT, timeout: ms, encoding: "utf8" });
  return { status: res.status, out: (res.stdout || "") + (res.stderr || ""), timedOut: res.signal !== null || (res.error as { code?: string } | undefined)?.code === "ETIMEDOUT" };
}

/** Deterministic LCG in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 1. Large-offset Tukey results are accepted
// ---------------------------------------------------------------------------

describe("bracketsFromTukey accepts genuine results on large-offset data (item 1)", () => {
  const repros: number[][][] = [
    [[2e7, 2e7 + 1, 2e7, 2e7 + 1], [0, 1, 0, 1]],
    [[1.7e9, 1.7e9 + 1, 1.7e9 + 2], [3, 4, 5]],
    [[1e9, 1e9 + 0.001, 1e9 - 0.001], [0, 0.001, -0.001]],
  ];
  test.each(repros.map((g, i) => [i, g] as const))("repro %i is accepted", (_i, g) => {
    const t = tukeyHSD(g) as TukeyResult;
    expect(t).not.toBeNull();
    expect(bracketsFromTukey(t).brackets.length).toBe(1);
  });

  test("a consistent q + p edit at large offset is still refused (the tolerance did not swallow tampering)", () => {
    const t = tukeyHSD(repros[0]) as TukeyResult;
    const edited: TukeyResult = {
      ...t,
      pairs: t.pairs.map((p) => {
        const q = p.q * 3;
        return { ...p, q, p: studentizedRangeP(q, t.k, t.dfWithin), significant: q > t.qCritical };
      }),
    };
    expect(() => bracketsFromTukey(edited)).toThrow(/width does not match/);
    const t3 = tukeyHSD(repros[2]) as TukeyResult;
    const e3: TukeyResult = {
      ...t3,
      pairs: t3.pairs.map((p) => {
        const q = p.q * 1.001;
        return { ...p, q, p: studentizedRangeP(q, t3.k, t3.dfWithin), significant: q > t3.qCritical };
      }),
    };
    expect(() => bracketsFromTukey(e3)).toThrow(RangeError);
  });

  test("an off-centre interval at large offset is refused", () => {
    const t = tukeyHSD(repros[1]) as TukeyResult;
    const shift = (t.pairs[0].ciHigh - t.pairs[0].ciLow) * 0.01;
    const moved: TukeyResult = { ...t, pairs: t.pairs.map((p) => ({ ...p, ciLow: p.ciLow + shift, ciHigh: p.ciHigh + shift })) };
    expect(() => bracketsFromTukey(moved)).toThrow(/not centred/);
  });

  test("seeded sweep: ZERO false refusals of genuine results (means 1e−3 … 1e12, k = 2 … 6, unequal n, several α)", () => {
    // Run in a child node through the product's own TS loader: the same sweep
    // takes ~10 s there and ~180 s under ts-jest's transform.
    const r = runBounded(`return JSON.stringify((${tukeySweep.toString()})(${JSON.stringify(ROOT)}, 300));`, 120000);
    expect(r.timedOut).toBe(false);
    const res = JSON.parse(r.out) as { accepted: number; zeroVar: number; falseRefusals: string[] };
    expect(res.falseRefusals.slice(0, 5)).toEqual([]);
    expect(res.accepted).toBeGreaterThan(250);
    expect(res.accepted + res.zeroVar).toBeGreaterThan(290);
  }, 150000);
});

/**
 * The sweep body, self-contained (it is serialised into a child process). 300
 * trials: before the fix 51 of them were falsely refused (measured), so it is not
 * vacuous; each new df costs a studentized-range root-find.
 */
function tukeySweep(root: string, trials: number): { accepted: number; zeroVar: number; falseRefusals: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tukeyHSD: hsd } = require(root + "/src/lib/tukey");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bracketsFromTukey: fromTukey } = require(root + "/src/lib/sigBrackets");
  let s = 20261015 >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  {
    const alphas = [0.01, 0.05, 0.1];
    let accepted = 0;
    let zeroVar = 0;
    const falseRefusals: string[] = [];
    for (let trial = 0; trial < trials; trial++) {
      const k = 2 + Math.floor(rnd() * 5);
      const groups: number[][] = [];
      for (let g = 0; g < k; g++) {
        const mag = Math.pow(10, -3 + rnd() * 15);
        const mean = (rnd() < 0.2 ? -1 : 1) * mag;
        // Small (down to 1e−12 relative) and large (up to 10× the mean) spreads.
        const rel = rnd() < 0.5 ? Math.pow(10, -12 + rnd() * 10) : Math.pow(10, -2 + rnd() * 3);
        const spread = rnd() < 0.3 ? Math.pow(10, -3 + rnd() * 3) : Math.abs(mean) * rel;
        const n = 2 + Math.floor(rnd() * 6);
        groups.push(Array.from({ length: n }, () => mean + (rnd() - 0.5) * spread));
      }
      const alpha = alphas[trial % alphas.length];
      const t = hsd(groups, alpha) as TukeyResult | null;
      if (!t) continue;
      const degenerate = !(t.mse > 0) || t.pairs.some((p) => !Number.isFinite(p.q));
      try {
        fromTukey(t);
        if (degenerate) falseRefusals.push(`trial ${trial}: degenerate result ACCEPTED`);
        else accepted++;
      } catch (e) {
        const msg = (e as Error).message;
        if (degenerate && /zero within-group variance|infinite/.test(msg)) zeroVar++;
        else falseRefusals.push(`trial ${trial}: ${msg}`);
      }
    }
    return { accepted, zeroVar, falseRefusals };
  }
}

// ---------------------------------------------------------------------------
// 4. Zero within-group variance is refused by name
// ---------------------------------------------------------------------------

describe("zero within-group variance draws no brackets (item 4)", () => {
  test("tukeyHSD([[1,1],[2,2]]) is refused by bracketsFromTukey, naming the zero variance", () => {
    const t = tukeyHSD([[1, 1], [2, 2]]) as TukeyResult;
    expect(t.mse).toBe(0);
    expect(() => bracketsFromTukey(t)).toThrow(/zero within-group variance/);
  });
  test("identical groups (q = ∞ with no difference at all) are refused too", () => {
    const t = tukeyHSD([[3, 3], [3, 3], [3, 3]]) as TukeyResult;
    expect(() => bracketsFromTukey(t)).toThrow(/zero within-group variance/);
  });
  test("a result whose mse was edited to look non-zero is still refused on its infinite q", () => {
    const t = tukeyHSD([[1, 1], [2, 2]]) as TukeyResult;
    expect(() => bracketsFromTukey({ ...t, mse: 1 })).toThrow(/infinite/);
  });
  test("the bracketed box plot surfaces the refusal and draws no ****", () => {
    const g = [[1, 1], [2, 2]];
    const t = tukeyHSD(g) as TukeyResult;
    const f = bracketedBoxPlot(
      g.map((v, i) => ({ label: `group ${i + 1}`, values: v })),
      { title: "T", ylabel: "value" },
      { kind: "tukey", result: t },
      { label: "stars", hideNs: false, tall: false },
    );
    expect(f.ok).toBe(false);
    if (f.ok) return;
    expect(f.error).toMatch(/zero within-group variance/);
    expect(f.svg).not.toContain("****");
  });
  test("a zero-variance t-test is refused naming its infinite t, not as 'not self-consistent'", () => {
    const r = twoSampleTTest([1, 1], [2, 2]);
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, result: r, kind: "t" }], "none")).toThrow(/t is infinite because both groups have zero variance/);
  });
  test("a paired t-test with constant differences (t = −∞, p = 0) is refused naming the differences", () => {
    const r = pairedTTest([1, 2, 3], [2, 3, 4]);
    expect(r.t).toBe(-Infinity);
    expect(() => bracketsFromPairwise([{ i: 0, j: 1, result: r, kind: "t" }], "none")).toThrow(/paired differences have zero variance/);
  });
});

// ---------------------------------------------------------------------------
// 2. Axis termination at the ends of the double range
// ---------------------------------------------------------------------------

describe("axis engine terminates on every double (item 2)", () => {
  test("linearAxis(1.7e308, 1.7e308, loose) returns (child process, hard timeout)", () => {
    const r = runBounded(`const a=require("./src/lib/axis");const x=a.linearAxis(1.7e308,1.7e308,{loose:true});return x.values.every(Number.isFinite)&&x.values.length>0?"ok":"bad "+JSON.stringify(x);`);
    expect(r.timedOut).toBe(false);
    expect(r.out).toBe("ok");
  });
  test("linearAxis(−1.7633522984571754e308 twice, loose) returns", () => {
    const r = runBounded(`const a=require("./src/lib/axis");const x=a.linearAxis(-1.7633522984571754e308,-1.7633522984571754e308,{loose:true});return x.values.every(Number.isFinite)&&x.values.length>0?"ok":"bad "+JSON.stringify(x);`);
    expect(r.timedOut).toBe(false);
    expect(r.out).toBe("ok");
  });
  test("a box plot of two adjacent doubles at Number.MAX_VALUE returns (reached through statchart's loose axis)", () => {
    const r = runBounded(
      `const s=require("./src/lib/statchart");return s.boxPlotSvg([{label:"a",values:[1.7976931348623157e308,1.7976931348623155e308]}],{}).includes("<svg")?"ok":"bad";`,
    );
    expect(r.timedOut).toBe(false);
    expect(r.out).toBe("ok");
  });
  test("the loose zero-span band contains the value and stays finite", () => {
    for (const v of [1.7e308, -1.7633522984571754e308, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const x = linearAxis(v, v, { loose: true });
      expect(Number.isFinite(x.lo) && Number.isFinite(x.hi)).toBe(true);
      expect(x.lo <= v && v <= x.hi).toBe(true);
    }
  });
  test("scale10 is bounded and exact at its limits for non-finite and huge exponents", () => {
    expect(scale10(3, -Infinity)).toBe(0);
    expect(scale10(-3, -Infinity)).toBe(-0);
    expect(scale10(3, Infinity)).toBe(Infinity);
    expect(scale10(-3, Infinity)).toBe(-Infinity);
    expect(scale10(0, Infinity)).toBeNaN();
    expect(scale10(3, NaN)).toBeNaN();
    expect(scale10(Infinity, -Infinity)).toBeNaN();
    expect(scale10(5e-324, 1e300)).toBe(Infinity);
    expect(scale10(1.7e308, -1e300)).toBe(0);
    expect(scale10(1.5, 2)).toBe(150);
    expect(scale10(1, -400)).toBe(0);
    expect(scale10(1e-300, 600)).toBe(1e300);
  });
  test("sweep: linearAxis / logAxis / formatValueRow over the extremes all return finite rows", () => {
    const EXT =
      "[0, -0, 1, -1, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 2.2250738585072014e-308, 1e-310, -1e-315, " +
      "1.7e308, -1.7633522984571754e308, 1.7976931348623155e308, Infinity, -Infinity, NaN]";
    // Termination first, in a child with a hard timeout: a regression here must
    // FAIL, not hang the whole jest run (the loose 1.7e308 pair did, before the fix).
    const probe = runBounded(
      `const x=require("./src/lib/axis");const ext=${EXT};for(const a of ext)for(const b of ext){` +
        `for(const o of [{},{loose:true},{loose:true,target:3},{step:1}])x.linearAxis(a,b,o);x.logAxis(a,b);x.formatValueRow([a,b,(a+b)/2]);}return "done";`,
      25000,
    );
    expect(probe.timedOut).toBe(false);
    expect(probe.out).toBe("done");
    const ext = [
      0, -0, 1, -1, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 2.2250738585072014e-308, 1e-310, -1e-315,
      1.7e308, -1.7633522984571754e308, 1.7976931348623155e308, Infinity, -Infinity, NaN,
    ];
    expect(EXT.split(",").length).toBe(ext.length);
    const t0 = Date.now();
    for (const a of ext) {
      for (const b of ext) {
        for (const opts of [{}, { loose: true }, { loose: true, target: 3 }, { step: 1 }]) {
          const r = linearAxis(a, b, opts);
          expect(r.values.every(Number.isFinite)).toBe(true);
          expect(r.values.length).toBeLessThanOrEqual(1000);
        }
        const l = logAxis(a, b);
        expect(l.major.length + l.minor.length).toBeLessThan(1000);
        const f = formatValueRow([a, b, (a + b) / 2]);
        expect(f.labels.length).toBe(3);
      }
    }
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 30000);
});

// ---------------------------------------------------------------------------
// 3. Every remedy a fit refusal names has been tried, and works
// ---------------------------------------------------------------------------

describe("fit refusals name only remedies that were tried and fit (item 3)", () => {
  /** k groups of 6: the first nsPairs + 1 nearly identical (their pairs are ns), the rest well apart. */
  const fixture = (seed: number, k: number, nsPairs: number): number[][] => {
    const rnd = lcg(seed);
    return Array.from({ length: k }, (_, g) => {
      const base = g < nsPairs + 1 ? 10 + g * 0.05 : 10 + g * 3;
      return Array.from({ length: 6 }, () => base + rnd());
    });
  };
  /** The reviewer's shape: LCG seed 3, 10 + g·(g odd ? 0.3 : 3) + U. */
  const reviewer = (k: number): number[][] => {
    const rnd = lcg(3);
    return Array.from({ length: k }, (_, g) => Array.from({ length: 6 }, () => 10 + g * (g % 2 ? 0.3 : 3) + rnd()));
  };
  const plot = (g: number[][], w: number, tall: boolean, hideNs: boolean, label: "stars" | "p" = "stars") =>
    bracketedBoxPlot(
      g.map((v, i) => ({ label: `group ${i + 1}`, values: v })),
      { title: "T", ylabel: "value" },
      { kind: "tukey", result: tukeyHSD(g) as TukeyResult },
      { label, hideNs, tall },
      w,
    );

  // [name, groups, w, which of {tall, hide, both} fit from the plain figure] — measured.
  const cases: Array<[string, number[][], number, { tall: boolean; hide: boolean; both: boolean }]> = [
    ["reviewer k = 5 (tall alone fits; Hide ns alone does NOT)", reviewer(5), 380, { tall: true, hide: false, both: true }],
    ["reviewer k = 6 (nothing fits)", reviewer(6), 380, { tall: false, hide: false, both: false }],
    ["k = 5, three ns pairs (either fits)", fixture(1, 5, 3), 380, { tall: true, hide: true, both: true }],
    ["k = 6, three ns pairs (ONLY the combination fits)", fixture(1, 6, 3), 380, { tall: false, hide: false, both: true }],
    ["k = 6, four ns pairs (Hide ns fits; taller does not)", fixture(1, 6, 4), 380, { tall: false, hide: true, both: true }],
  ];

  test.each(cases)("%s: the measured fit table holds", (_n, g, w, want) => {
    expect(plot(g, w, false, false).ok).toBe(false);
    expect(plot(g, w, true, false).ok).toBe(want.tall);
    expect(plot(g, w, false, true).ok).toBe(want.hide);
    expect(plot(g, w, true, true).ok).toBe(want.both);
  });

  test.each(cases)("%s: every named remedy works, every unnamed one does not", (_n, g, w) => {
    for (const tall of [false, true]) {
      for (const hideNs of [false, true]) {
        const f = plot(g, w, tall, hideNs);
        if (f.ok) continue;
        const e = f.error;
        const namesTall = /"Taller figure"/.test(e);
        const namesHide = /"Hide ns"/.test(e);
        if (/tick both "Taller figure" and "Hide ns"/.test(e)) {
          expect(plot(g, w, true, true).ok).toBe(true);
          expect(plot(g, w, true, hideNs).ok).toBe(false);
          expect(plot(g, w, tall, true).ok).toBe(false);
          continue;
        }
        if (namesTall) expect(plot(g, w, true, hideNs).ok).toBe(true);
        else if (!tall) expect(plot(g, w, true, hideNs).ok).toBe(false);
        if (namesHide) expect(plot(g, w, tall, true).ok).toBe(true);
        else if (!hideNs) expect(plot(g, w, tall, true).ok).toBe(false);
        if (!namesTall && !namesHide) {
          expect(e).toMatch(/compare fewer groups/);
          expect(e).toMatch(/wider figure/);
          expect(e).not.toMatch(/taller/i);
        }
      }
    }
  });

  test("the reported room is the 60% cap, consistent with the need (236 px vs 210 px, not 350 px)", () => {
    const f = plot(reviewer(6), 380, true, true, "p");
    expect(f.ok).toBe(false);
    if (f.ok) return;
    const m = /need (\d+) px above the data, but brackets must stay below 60% of the (\d+) px plot area \((\d+) px\)/.exec(f.error);
    expect(m).not.toBeNull();
    const [need, plotPx, cap] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(cap).toBe(Math.floor(plotPx * 0.6));
    expect(need).toBeGreaterThanOrEqual(cap);
    expect(f.error).not.toMatch(/plot area is \d+ px tall/);
  });
});
