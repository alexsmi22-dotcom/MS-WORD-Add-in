// Reproductions of the verified statistical defects (gap analysis 2026-08-05,
// items 0.10, 0.22-0.25, 0.30 and Tier 1.4/1.5).
//
// WHY THESE LIVE TOGETHER. Every test below is a MEASURED failure of the shipped
// product, kept with the exact data it was measured on, so a regression is
// recognisable as the original bug rather than as an anonymous red line. The
// audience for this surface is the least statistically expert the product has —
// grad and college students — so an unhedged claim here is a defect, not a
// nicety, and each test asserts the hedge as hard as the arithmetic.
//
// The data is fixed and deterministic on purpose: a seeded generator, a quoted
// CSV, a 2x2 table of counts. Nothing here samples Math.random, because a test
// that passes four times in five is not a guard.

import { describeAssumptions, normalityTest, normalityCheckSample } from "../diagnostics";
import { analyzeData, parseTable, summarizeColumn } from "../insights";
import { oneWayAnova } from "../stats";
import { chiSquareIndependence, chiSquareGoodnessOfFit } from "../stats2";
import { trapz } from "../pca";

/**
 * Deterministic pseudo-normal sample — the same Box-Muller-on-a-fixed-LCG the
 * diagnostics suite uses, so the numbers below are the numbers the gap analysis
 * measured (per-group normality p = 0.975 at n = 25, for both groups, because
 * both come from this generator with only the mean shifted).
 */
function normalSample(n: number, mean = 0, sd = 1): number[] {
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: number[] = [];
  while (out.length < n) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(mean + sd * r * Math.cos(2 * Math.PI * u2));
    if (out.length < n) out.push(mean + sd * r * Math.sin(2 * Math.PI * u2));
  }
  return out;
}

/** mulberry32 — a small, fully deterministic PRNG for the noise matrix. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 8 columns x 30 rows of pure noise, from a fixed seed. No signal exists. */
function noiseMatrix(seed: number, cols = 8, rows = 30): string {
  const rand = mulberry32(seed);
  const header = Array.from({ length: cols }, (_, j) => `V${j + 1}`).join(",");
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const cells: string[] = [];
    for (let j = 0; j < cols; j++) {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      cells.push((Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)).toFixed(6));
    }
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

const normalityWarnings = (notes: string[]): string[] =>
  notes.filter((n) => n.startsWith("⚠") && /normal/i.test(n));

// ---------------------------------------------------------------------------
// 0.10 — the assumption checker tested the pooled marginal, not the residuals
// ---------------------------------------------------------------------------

describe("0.10 assumption checking uses within-group residuals, not the pooled marginal", () => {
  test("two textbook-normal groups separated by 4 SD are each normal", () => {
    // The gap analysis measured p = 0.975 per group from its own generator; this
    // suite's LCG gives 0.475 at n = 25. The load-bearing fact is the same and is
    // what is asserted: EACH GROUP PASSES, and both give the identical p because
    // only the mean was shifted.
    const a = normalityTest(normalSample(25, 0, 1));
    const b = normalityTest(normalSample(25, 4, 1));
    expect(a.normal).toBe(true);
    expect(b.normal).toBe(true);
    expect(a.p).toBeGreaterThan(0.05);
    expect(a.p).toBeCloseTo(b.p, 12);
  });

  test("the POOLED marginal of those same groups is wildly non-normal — that is the trap", () => {
    // Two normal groups with different means are BIMODAL when concatenated.
    // This is not a bug in normalityTest; it is why the pooled vector is the
    // wrong thing to hand it.
    const pooled = [...normalSample(25, 0, 1), ...normalSample(25, 4, 1)];
    expect(normalityTest(pooled).p).toBeLessThan(1e-3);
  });

  test("REGRESSION 0.10: a large real effect must not produce a normality warning", () => {
    // Measured before the fix: "⚠ The data are not normally distributed …
    // Consider the Mann-Whitney U test instead." The stronger the result, the
    // louder the product called it invalid.
    for (const n of [25, 40]) {
      const notes = describeAssumptions([normalSample(n, 0, 1), normalSample(n, 4, 1)]);
      expect(normalityWarnings(notes)).toEqual([]);
    }
  });

  test("CONTROL: with zero separation the same groups also produce no warning", () => {
    // The control the gap analysis used — it passed before the fix too, which is
    // exactly what made the defect invisible.
    const notes = describeAssumptions([normalSample(40, 0, 1), normalSample(40, 0, 1)]);
    expect(normalityWarnings(notes)).toEqual([]);
  });

  test("genuinely non-normal groups are still caught, and still name the alternative", () => {
    const skewed = Array.from({ length: 60 }, (_, i) => Math.exp(i / 12));
    const notes = describeAssumptions([skewed, skewed.map((v) => v + 1)]);
    expect(normalityWarnings(notes).length).toBe(1);
    expect(notes.join(" ")).toContain("Mann-Whitney");
  });

  test("REGRESSION 0.10 (paired): the assumption is about the DIFFERENCES", () => {
    // Two strongly skewed conditions whose differences are normal. Pooling the
    // raw scores warns; the paired t-test's actual assumption is satisfied.
    const base = Array.from({ length: 30 }, (_, i) => Math.exp(i / 6));
    const noise = normalSample(30, 5, 1);
    const after = base.map((v, i) => v + noise[i]);
    const notes = describeAssumptions([base, after], { paired: true });
    expect(normalityWarnings(notes)).toEqual([]);
  });

  test("non-normal paired differences ARE caught, and the message says 'differences'", () => {
    const base = normalSample(30, 10, 1);
    const after = base.map((v, i) => v - Math.exp(i / 6));
    const notes = describeAssumptions([base, after], { paired: true });
    const warn = normalityWarnings(notes);
    expect(warn.length).toBe(1);
    expect(warn[0]).toMatch(/difference/i);
    expect(notes.join(" ")).toContain("Wilcoxon");
  });

  test("a ragged paired input produces no NaN-driven warning", () => {
    // x - undefined is NaN, and a NaN skewness reads as "not normal": the fix
    // must not invent a new spurious-warning path while closing the old one.
    const notes = describeAssumptions([normalSample(30, 0, 1), normalSample(25, 0, 1)], {
      paired: true,
    });
    expect(notes.join(" ")).not.toMatch(/NaN/);
    expect(normalityWarnings(notes)).toEqual([]);
  });

  test("the below-n=20 refusal is intact", () => {
    const notes = describeAssumptions([
      [1, 2, 3, 4, 5],
      [2, 3, 4, 5, 6],
    ]);
    expect(notes.some((n) => /Normality not tested/.test(n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 0.10, second half — the false-positive rate of the normality verdict
// ---------------------------------------------------------------------------

/**
 * MEASURED, NOT ARGUED.
 *
 * The first fix for 0.10 swapped the pooled marginal for pooled within-group
 * residuals, and noted in a comment that unequal variances would still trip the
 * check. Nobody measured it. An independent pass did: 61% false warnings at
 * sd 1:5, 71% at 1:10, and 100% on a three-group design — on data that is normal
 * in every group. "A known cost" was a false-positive rate approaching
 * certainty, and it is the same defect shape pointing at a different cause.
 *
 * So the rate is now a TEST rather than a claim. The invariant that matters is
 * not just "small" — it is that the rate does not depend on the variance ratio
 * at all, because that dependence was the defect. Each design is compared
 * against the homoscedastic control run on the same seed stream.
 */
describe("0.10 the normality verdict does not fire on unequal variances", () => {
  /** Deterministic normal groups: `sds.length` groups of `n` values each. */
  function normalGroups(seed: number, sds: number[], n: number, lognormal = false): number[][] {
    const rand = mulberry32(seed);
    return sds.map((sd) => {
      const out: number[] = [];
      while (out.length < n) {
        const u1 = Math.max(rand(), 1e-12);
        const u2 = rand();
        const r = Math.sqrt(-2 * Math.log(u1));
        out.push(sd * r * Math.cos(2 * Math.PI * u2));
        if (out.length < n) out.push(sd * r * Math.sin(2 * Math.PI * u2));
      }
      return lognormal ? out.map((z) => Math.exp(z)) : out;
    });
  }

  // 1000, not 400: at 400 the Monte Carlo error on a ~7% rate is ±1.3 points and
  // the DIFFERENCE of two rates carries ±1.8, which is wide enough to make the
  // variance-independence assertion below flap. At 1000 the seven designs land
  // within 0.8 points of each other.
  const TRIALS = 1000;
  const warned = (notes: string[]): boolean =>
    notes.some((n) => n.startsWith("⚠") && /not normally distributed/.test(n));

  /** Percentage of trials in which a normality warning fired. */
  function warningRate(sds: number[], n: number, lognormal = false): number {
    let hits = 0;
    for (let t = 0; t < TRIALS; t++) {
      if (warned(describeAssumptions(normalGroups(900001 + t * 7919, sds, n, lognormal)))) hits++;
    }
    return (100 * hits) / TRIALS;
  }

  test("REGRESSION: every warning below is FALSE, and the rate stays in single figures", () => {
    // Measured before this fix / after it:
    //   homoscedastic control       4.8% / 7.0%   (the control was always fine)
    //   2 groups, sd 1:5             62% / 7.0%
    //   2 groups, sd 1:10            73% / 7.0%
    //   3 groups, sd 1/1/10         100% / 7.0%
    //   4 groups, sd 1/2/5/10        99% / 6.8%
    // The residual ~8% is NOT free and is not the test's own calibration: a
    // single plain normal sample put straight into normalityTest rejects at
    // 5.0-5.4% across N = 20..240, so the transform costs 1-4 points, worst at
    // small N. That cost is paid uniformly whatever the variance ratio, which is
    // the property being asserted here.
    const control = warningRate([1, 1], 30);
    expect(control).toBeLessThan(12);
    for (const sds of [
      [1, 5],
      [1, 10],
      [1, 1, 10],
      [1, 2, 5, 10],
    ]) {
      const rate = warningRate(sds, 30);
      expect({ sds, rate: rate < 12 }).toEqual({ sds, rate: true });
      // THE REAL INVARIANT: heteroscedasticity must not move the rate. A
      // threshold alone would pass a scheme that merely fires less often; this
      // fails unless the variance dependence is actually gone.
      expect(Math.abs(rate - control)).toBeLessThan(3);
    }
  });

  test("REGRESSION: nor does it fire on many SMALL groups", () => {
    // The obvious repair — divide each group's residuals by its own sd — fixes
    // the table above and breaks this one instead (measured: 53% for 8 groups of
    // 4, 96% for 20 groups of 5, 100% for anything with 3 per group), because a
    // scale estimated from four values bounds the result and makes the pooled
    // vector platykurtic. Small groups are the norm on this surface, so both
    // halves have to hold at once.
    for (const [sds, n] of [
      [[1, 1, 1, 1, 1, 1, 1, 1], 4],
      [[1, 1, 1, 1, 10, 10, 10, 10], 4],
      [[1, 1, 1, 1], 5],
      [[1, 1, 1, 1, 1], 4],
    ] as [number[], number][]) {
      const rate = warningRate(sds, n);
      expect({ sds, n, ok: rate < 12 }).toEqual({ sds, n, ok: true });
    }
  });

  test("power is retained — genuinely non-normal data is still caught", () => {
    // A check that never warns would pass every test above.
    expect(warningRate([1, 1], 30, true)).toBeGreaterThan(95);
    expect(warningRate([1, 5], 30, true)).toBeGreaterThan(95);
    expect(warningRate([1, 1, 10], 30, true)).toBeGreaterThan(95);
  });

  test("the transform really is standard normal, not merely small", () => {
    // The guard on the machinery itself: under normality the pooled scores are
    // exactly N(0,1) whatever each group's spread, which is the property the
    // whole scheme rests on.
    const groups = normalGroups(4242, [0.01, 3, 250], 400);
    const z = normalityCheckSample(groups);
    const m = z.reduce((a, b) => a + b, 0) / z.length;
    const sd = Math.sqrt(z.reduce((a, v) => a + (v - m) ** 2, 0) / (z.length - 1));
    expect(z).toHaveLength(1200);
    expect(m).toBeCloseTo(0, 2);
    expect(sd).toBeCloseTo(1, 2);
  });
});

// ---------------------------------------------------------------------------
// 0.10, third part — one diagnosis, one remedy
// ---------------------------------------------------------------------------

describe("0.10 the advice never contradicts itself", () => {
  // Non-normal AND heteroscedastic: skewed, and 50x apart in spread.
  const skewedPair = (): number[][] => [
    Array.from({ length: 30 }, (_, i) => Math.exp(i / 10)),
    Array.from({ length: 30 }, (_, i) => 50 * Math.exp(i / 10)),
  ];

  test("REGRESSION: two failures produce ONE note, and Welch is the remedy", () => {
    // Before: "Consider the Mann-Whitney U test instead" printed two lines above
    // "Use Welch's t-test rather than Student's pooled test" — two different
    // fixes for one diagnosis, and the more prominent one does not repair
    // unequal variances at all.
    const notes = describeAssumptions(skewedPair());
    const warnings = notes.filter((n) => n.startsWith("⚠"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Welch");
    expect(warnings[0]).toMatch(/rank test is NOT the fix/);
    // Mann-Whitney may be NAMED (to say it is not the answer) but must never be
    // the recommendation.
    expect(warnings[0]).not.toMatch(/Consider the Mann-Whitney/);
  });

  test("three groups get the caution, and Games-Howell is named as unavailable", () => {
    const g = skewedPair();
    const notes = describeAssumptions([g[0], g[1], g[1].map((v) => v * 2)]);
    const warnings = notes.filter((n) => n.startsWith("⚠"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/caution/);
    expect(warnings[0]).toMatch(/Games-Howell/);
    expect(warnings[0]).not.toMatch(/Consider the Kruskal-Wallis/);
  });

  test("unequal variances ALONE still recommends Welch", () => {
    const notes = describeAssumptions([
      [10, 10.1, 9.9, 10.05, 9.95, 10, 10.02, 9.98],
      [1, 50, 100, 2, 75, 30, 90, 5],
    ]);
    expect(notes.join(" ")).toContain("Welch");
  });

  test("a paired design is never told to use Welch", () => {
    // The paired t-test runs on one column of differences and has no
    // equal-variance assumption, so that advice was answering a question the
    // test does not ask.
    const a = Array.from({ length: 30 }, (_, i) => Math.exp(i / 10));
    const b = a.map((v, i) => v * 50 + i);
    expect(describeAssumptions([a, b], { paired: true }).join(" ")).not.toContain("Welch");
  });
});

// ---------------------------------------------------------------------------
// 0.22 — trends: uncorrected, renumbered x, and no independence caveat
// ---------------------------------------------------------------------------

describe("0.22 trend detection", () => {
  test("REGRESSION 0.22a: no trend survives on 8 columns x 30 rows of pure noise", () => {
    const report = analyzeData(noiseMatrix(20260805))!;
    expect(report).not.toBeNull();
    // The scan itself must still be capable of a false positive on the RAW p —
    // otherwise this test would pass for the wrong reason.
    expect(report.trends.some((t) => t.p < 0.05)).toBe(true);
    // …and none of them may be reported as a finding.
    expect(report.trends.filter((t) => t.direction !== "flat")).toEqual([]);
    expect(report.text).not.toMatch(/significant (increasing|decreasing) trend/);
  });

  test("REGRESSION 0.22b: a blank cell must not renumber the x axis", () => {
    // v is a perfect 10-per-row line at TRUE rows 1,2,4,5,6. Dropping the blank
    // and then numbering 1..5 reports the slope as 13.
    const report = analyzeData("v,w\n10,1\n20,2\n,3\n40,4\n50,5\n60,6")!;
    const v = report.trends.find((t) => t.column === "v")!;
    expect(v).toBeDefined();
    expect(v.slope).toBeCloseTo(10, 9);
    expect(v.slope).not.toBeCloseTo(13, 6);
  });

  test("REGRESSION 0.22c: a reported trend carries the independence caveat", () => {
    // The shipped default example: the experimenter's own dose ladder. BH cannot
    // fix this one — the trend is real and survives any correction. Only the
    // caveat addresses it.
    const report = analyzeData("dose,response\n1,12\n2,19\n4,31\n8,52\n16,84\n32,131")!;
    expect(report.trends.some((t) => t.direction !== "flat")).toBe(true);
    expect(report.text).toMatch(/independen/i);
  });

  test("a real, strong trend is still reported", () => {
    const report = analyzeData("x,y\n1,2\n2,4\n3,6\n4,8\n5,10\n6,12\n7,14")!;
    expect(report.trends.some((t) => t.direction === "increasing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 0.23 — the correlations table printed uncorrected p-values
// ---------------------------------------------------------------------------

describe("0.23 the correlations table and the prose agree", () => {
  test("REGRESSION 0.23: the table shows the adjusted p when many pairs were tested", () => {
    const report = analyzeData(noiseMatrix(20260805))!;
    expect(report.correlations.length).toBeGreaterThan(1);
    const block = report.text.split("Correlations (strongest first):")[1].split("\n\n")[0];
    expect(block).toMatch(/adj/i);
    // and the strongest pair's adjusted value is the one printed
    const top = report.correlations[0];
    expect(top.pAdjusted).toBeGreaterThan(top.p - 1e-12);
    const shown = top.pAdjusted < 0.001 ? "p < 0.001" : top.pAdjusted.toFixed(3);
    expect(block).toContain(shown);
  });

  test("a single pair is not labelled as adjusted — there is nothing to adjust", () => {
    const report = analyzeData("x,y\n1,2\n2,4.1\n3,5.9\n4,8.2\n5,9.8")!;
    const block = report.text.split("Correlations (strongest first):")[1].split("\n\n")[0];
    expect(block).not.toMatch(/adj/i);
  });
});

// ---------------------------------------------------------------------------
// 0.24 — the paste path used a second, quote-blind parser
// ---------------------------------------------------------------------------

describe("0.24 parseTable handles quoted cells and wide-format headers", () => {
  const QUOTED = 'sample,conc\n"Smith, John",5\n"Doe, Jane",7\n"Roe, Ann",9';

  test("REGRESSION 0.24a: a quoted cell containing the delimiter does not shift the columns", () => {
    const t = parseTable(QUOTED);
    expect(t.headers).toEqual(["sample", "conc"]);
    expect(t.rowCount).toBe(3);
    expect(t.columns[0]).toEqual(["Smith, John", "Doe, Jane", "Roe, Ann"]);
    expect(t.columns[1]).toEqual(["5", "7", "9"]);
  });

  test("REGRESSION 0.24a: and the report says 3 rows x 2 columns, with no C3", () => {
    const report = analyzeData(QUOTED)!;
    expect(report.text).toContain("3 rows × 2 columns");
    expect(report.columns.map((c) => c.name)).toEqual(["sample", "conc"]);
  });

  test("REGRESSION 0.24b: a wide-format header row of numbers is still a header", () => {
    const t = parseTable("Time,1,2,3\n0,5,6,7\n1,8,9,10");
    expect(t.headers).toEqual(["Time", "1", "2", "3"]);
    expect(t.rowCount).toBe(2);
  });

  test("a genuinely numeric first row is still data", () => {
    const t = parseTable("1 2\n3 4");
    expect(t.headers).toEqual(["C1", "C2"]);
    expect(t.rowCount).toBe(2);
  });

  test("a leading text column does not make row 1 a header", () => {
    const t = parseTable("red,1\nblue,2\ngreen,3");
    expect(t.headers).toEqual(["C1", "C2"]);
    expect(t.rowCount).toBe(3);
  });

  test("whitespace-separated tables still parse (no delimiter to sniff)", () => {
    const t = parseTable("a  b   c\n1 2 3\n4  5   6");
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rowCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 0.25 — non-numeric cells vanished and "missing" stayed 0
// ---------------------------------------------------------------------------

describe("0.25 discarded non-numeric cells are counted and surfaced", () => {
  test("REGRESSION 0.25: 'ND' is counted, not silently dropped", () => {
    const c = summarizeColumn("conc", ["1", "2", "3", "4", "ND"]);
    expect(c.type).toBe("numeric");
    expect(c.n).toBe(4);
    expect(c.missing).toBe(0);
    expect(c.nonNumeric).toBe(1);
    // the invariant that catches an off-by-one in any future edit
    expect(c.n + c.missing + c.nonNumeric).toBe(5);
    expect(c.nonNumericExamples).toContain("ND");
  });

  test("blanks and unreadable values are counted separately", () => {
    // Seven cells, not five: a column stays "numeric" only while at least 80% of
    // its PRESENT cells parse, and one censored value out of four present ones
    // is 75%, which the existing rule sends to the categorical branch. That rule
    // is deliberate and unchanged here.
    const c = summarizeColumn("conc", ["1", "", "3", "<LOD", "5", "6", "7"]);
    expect(c.type).toBe("numeric");
    expect(c.missing).toBe(1);
    expect(c.nonNumeric).toBe(1);
    expect(c.n).toBe(5);
    expect(c.n + c.missing + c.nonNumeric).toBe(7);
  });

  test("a categorical column reports no non-numeric count", () => {
    const c = summarizeColumn("g", ["red", "blue", "red"]);
    expect(c.type).toBe("categorical");
    expect(c.nonNumeric).toBe(0);
  });

  test("REGRESSION 0.25: the report names the value it discarded", () => {
    const report = analyzeData("conc,other\n1,1\n2,2\n3,3\n4,4\nND,5")!;
    expect(report.insights.join(" ")).toContain("ND");
  });
});

// ---------------------------------------------------------------------------
// 0.30 — Math.max(...array) spread over user data
// ---------------------------------------------------------------------------

describe("0.30 trapz survives a 200,000-point paste", () => {
  test("REGRESSION 0.30: no RangeError, and the area is right", () => {
    const N = 200000;
    const xs = Array.from({ length: N }, (_, i) => i);
    const ys = Array.from({ length: N }, () => 1);
    const r = trapz(xs, ys);
    expect(r.ok).toBe(true);
    if (r.ok !== true) throw new Error("trapz refused a valid input");
    expect(r.area).toBeCloseTo(N - 1, 6);
  });

  test("the uneven-spacing note still fires", () => {
    const r = trapz([0, 1, 2, 100], [1, 1, 1, 1]);
    if (r.ok !== true) throw new Error("trapz refused a valid input");
    expect(r.notes.some((n) => /uneven/i.test(n))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 1.4 — effect size for ANOVA
// ---------------------------------------------------------------------------

describe("Tier 1.4 one-way ANOVA reports an effect size", () => {
  test("eta-squared and omega-squared on the suite's own worked table", () => {
    // [[1,2,3],[4,5,6],[7,8,9]]: SS_between = 54, SS_within = 6, SS_total = 60,
    // MS_within = 1 → eta² = 0.9, omega² = 52/61.
    const r = oneWayAnova([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(r.f).toBeCloseTo(27, 9);
    expect(r.ssBetween).toBeCloseTo(54, 9);
    expect(r.ssWithin).toBeCloseTo(6, 9);
    expect(r.ssTotal).toBeCloseTo(60, 9);
    expect(r.msWithin).toBeCloseTo(1, 9);
    expect(r.etaSquared).toBeCloseTo(0.9, 9);
    expect(r.omegaSquared).toBeCloseTo(52 / 61, 9);
  });

  test("omega-squared is NOT clamped when it goes negative", () => {
    // Identical groups: SS_between = 0, SS_within = 6, MS_within = 1, so
    // omega² = (0 − 2·1)/(6 + 1) = −2/7. A silent clamp to 0 beside a printed
    // eta² of 0 is two answers in one document.
    const r = oneWayAnova([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(r.etaSquared).toBeCloseTo(0, 9);
    expect(r.omegaSquared).toBeLessThan(0);
    expect(r.omegaSquared).toBeCloseTo(-2 / 7, 9);
  });

  test("no variance at all gives NaN, not 0/0 leaking into prose", () => {
    const r = oneWayAnova([
      [5, 5],
      [5, 5],
    ]);
    expect(Number.isNaN(r.etaSquared)).toBe(true);
    expect(Number.isNaN(r.omegaSquared)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 1.5 — chi-square minimum expected counts
// ---------------------------------------------------------------------------

describe("Tier 1.5 chi-square warns about small expected counts", () => {
  const SMALL = [
    [1, 9],
    [8, 2],
  ];

  test("the uncorrected Pearson answer is unchanged", () => {
    const r = chiSquareIndependence(SMALL);
    expect(r.chi2).toBeCloseTo(9.899, 3);
    expect(r.p).toBeCloseTo(0.00165, 5);
    expect(r.df).toBe(1);
  });

  test("REGRESSION 1.5a: Cochran's rule fires — 2 of 4 expected counts are below 5", () => {
    const r = chiSquareIndependence(SMALL);
    expect(r.minExpected).toBeCloseTo(4.5, 9);
    expect(r.cellsBelowFive).toBe(2);
    expect(r.cellCount).toBe(4);
    expect(r.warnings.join(" ")).toMatch(/expected count/i);
  });

  test("REGRESSION 1.5b: Yates' continuity correction is available for a 2x2", () => {
    const r = chiSquareIndependence(SMALL);
    expect(r.chi2Yates).toBeCloseTo(7.2727, 3);
    expect(r.pYates).toBeCloseTo(0.007, 3);
  });

  test("Fisher's exact brackets the two, and the uncorrected p is the anti-conservative one", () => {
    const r = chiSquareIndependence(SMALL);
    expect(r.pFisher).toBeCloseTo(0.005477, 6);
    expect(r.p).toBeLessThan(r.pFisher!);
    expect(r.pFisher!).toBeLessThan(r.pYates!);
  });

  test("Fisher's exact reproduces the tea-tasting value", () => {
    const r = chiSquareIndependence([
      [3, 1],
      [1, 3],
    ]);
    expect(r.pFisher).toBeCloseTo(0.4857, 4);
  });

  test("a large, comfortable table warns about nothing", () => {
    const r = chiSquareIndependence([
      [100, 120],
      [130, 110],
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.cellsBelowFive).toBe(0);
  });

  test("goodness of fit warns too", () => {
    const r = chiSquareGoodnessOfFit([1, 2, 3], [2, 2, 2]);
    expect(r.warnings.join(" ")).toMatch(/expected count/i);
  });

  test("the mismatched-totals refusal is intact and stays the single message", () => {
    const r = chiSquareGoodnessOfFit([20, 20, 20], [0.3, 0.3, 0.4]);
    expect(r.reason).toMatch(/multiply/);
    expect(Number.isNaN(r.chi2)).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
