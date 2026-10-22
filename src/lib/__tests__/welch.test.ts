/**
 * Welch's one-way ANOVA and Games–Howell (src/lib/welch.ts), the fractional-df
 * studentized range they need (src/lib/tukey.ts: studentizedRangeSf /
 * studentizedRangeQuantile), and the two calculators as the PANE runs them
 * (src/lib/welchCalcs.ts: field text → statGroups → engine → report text).
 *
 * EVERY EXPECTED VALUE IS FROM AN ORACLE, read from fixtures/welch-oracle.json,
 * which the scratchpad script oracle.py wrote with:
 *   • pingouin 0.7.0  welch_anova, pairwise_gameshowell (F, df₂, p; diff, se, T, df, p)
 *   • scipy 1.18.1    studentized_range.sf / .ppf (the distribution grid, and the
 *                     Games–Howell CI = diff ± ppf(1 − α; k, df)/√2 · se, which
 *                     pingouin does not report)
 *   • scipy 1.18.1    tukey_hsd(..., equal_var=False), scipy's own Games–Howell:
 *                     a second, independent implementation for the pain set
 *   • scipy 1.18.1    ttest_ind(equal_var=False) for the k = 2 identities
 *   • scipy 1.18.1    norm.cdf for the double-precision normal CDF
 * The "pain" set is a published worked example: pain threshold by hair colour
 * (McClave & Dietrich), bundled with pingouin as read_dataset("anova"); pingouin's
 * docs print F = 5.890115, p = 0.018813 for it.
 */
import { readNumberList } from "../numberList";
import { statFieldCommasAreSeparators, statFieldProvesDecimalCommas } from "../statFields";
import { feedGroups } from "../tableFeed";
import { welchAnova, gamesHowell, WELCH_MAX_GROUPS } from "../welch";
import { welchAnovaCalc, gamesHowellCalc, welchNum, welchDf } from "../welchCalcs";
import {
  studentizedRangeSf,
  studentizedRangeQuantile,
  normalCdfFineForTest,
  gk15ForTest,
  tukeyHSD,
  studentizedRangeP,
  studentizedRangeCritical,
  LruCacheForTest,
  quantileCachedForTest,
} from "../tukey";
import { twoSampleTTest, tTestP, formatP } from "../stats";
import { describeAssumptions, varianceHomogeneity } from "../diagnostics";
import * as fs from "fs";
import * as path from "path";
import oracleJson from "./fixtures/welch-oracle.json";

interface OPair {
  i: number;
  j: number;
  diff: number;
  se: number;
  T: number;
  df: number;
  p: number;
  qcrit: Record<string, number>;
  ci: Record<string, [number, number]>;
}
interface OSet {
  groups: number[][];
  means: number[];
  sds: number[];
  F: number;
  df1: number;
  df2: number;
  p: number;
  pairs: OPair[];
  welch_t?: { t: number; p: number; df: number };
}
const oracle = oracleJson as unknown as {
  versions: Record<string, string>;
  sets: Record<string, OSet>;
  scipy_tukey_hsd_unequal_pain: { p: number[][]; low: number[][]; high: number[][]; stat: number[][] };
  srange_sf: { q: number; k: number; df: number; sf: number }[];
  srange_ppf: { alpha: number; k: number; df: number; q: number }[];
  norm_cdf: { x: number; cdf: number }[];
};
const SETS = Object.entries(oracle.sets);

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

/** The pane's statGroups (taskpane.ts), replayed exactly as statCalcDefaults.test.ts does. */
function statGroups(s: string): number[][] {
  const sep = statFieldCommasAreSeparators(s);
  const groups = s.split(/\n\s*\n|;/);
  const cells = !sep && statFieldProvesDecimalCommas(groups);
  return groups
    .map((g) => readNumberList(sep ? g.replace(/,/g, " ") : g, { cells, decimalField: cells }).values)
    .filter((g) => g.length > 0);
}
/** The pane's insert gate (insertableResultText), replayed. */
const insertable = (t: string): boolean => !!t && !t.includes("—") && !t.includes("NaN") && !t.includes("Infinity");
const realSvg = (s: string | undefined): boolean =>
  !!s && /^<svg\b/.test(s) && s.trim().endsWith("</svg>") && /<text[ >]/.test(s) && !/NaN|Infinity|undefined/.test(s);

/** The shipped default for both calculators (INTEGRATION.md): the pain set. */
const PAIN_FIELD = "63 57 52 41 43\n\n32 39 51 30 35\n\n62 60 71 55 48\n\n42 50 41 37";

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// ---------------------------------------------------------------------------
describe("the numerical building blocks", () => {
  test("the double-precision normal CDF matches scipy.stats.norm.cdf", () => {
    for (const { x, cdf } of oracle.norm_cdf) {
      const ours = normalCdfFineForTest(x);
      // Relative error < 1e-10 down to x = −5; in the far tail (x < −5, where the
      // CDF is below 3e-7) the error is relative ~1e-8 but absolute < 1e-19,
      // which is what an integrand weighted by it can feel.
      if (x >= -5) expect(rel(ours, cdf)).toBeLessThan(1e-10);
      else expect(Math.abs(ours - cdf)).toBeLessThan(1e-19);
    }
  });

  test("Gauss–Kronrod 15 is exact for x²² and the embedded Gauss 7 for x¹²", () => {
    // Kronrod 15 integrates polynomials exactly to degree 3·7 + 2 = 23, Gauss 7
    // to degree 13, and neither beyond — a mistyped node or weight could not
    // survive all four checks.
    expect(gk15ForTest((x) => x ** 22, -1, 1).v).toBeCloseTo(2 / 23, 14);
    expect(Math.abs(gk15ForTest((x) => x ** 24, -1, 1).v - 2 / 25)).toBeGreaterThan(1e-10);
    const k12 = gk15ForTest((x) => x ** 12, -1, 1);
    expect(k12.v).toBeCloseTo(2 / 13, 14);
    expect(k12.err).toBeLessThan(1e-14); // G7 is exact too, so they agree
    expect(gk15ForTest((x) => x ** 20, -1, 1).err).toBeGreaterThan(1e-6); // and G7 is NOT exact at 20
  });
});

describe("studentized range at fractional and small df (scipy.stats.studentized_range)", () => {
  test("upper tail: 675 points, k 2–20, df 1–5000.2, q 0.3–50", () => {
    let maxAbs = 0;
    let maxRel = 0;
    for (const c of oracle.srange_sf) {
      const ours = studentizedRangeSf(c.q, c.k, c.df);
      maxAbs = Math.max(maxAbs, Math.abs(ours - c.sf));
      if (c.sf >= 1e-6) maxRel = Math.max(maxRel, rel(ours, c.sf));
    }
    expect(maxAbs).toBeLessThan(1e-8);
    expect(maxRel).toBeLessThan(1e-5);
  });

  test("REGRESSION: the region the Tukey path got wrong (df = 2, k = 2, q = 40: true p 0.00125, not 0.00032)", () => {
    const c = oracle.srange_sf.find((r) => r.k === 2 && r.df === 2 && r.q === 50)!;
    expect(rel(studentizedRangeSf(c.q, c.k, c.df), c.sf)).toBeLessThan(1e-6);
    const d = oracle.srange_sf.find((r) => r.k === 5 && r.df === 1.5 && r.q === 25)!;
    expect(rel(studentizedRangeSf(d.q, d.k, d.df), d.sf)).toBeLessThan(1e-6);
  });

  test("critical values: 90 points, α 0.01/0.05/0.10, df 1–60.5", () => {
    let maxRel = 0;
    for (const c of oracle.srange_ppf) maxRel = Math.max(maxRel, rel(studentizedRangeQuantile(c.alpha, c.k, c.df), c.q));
    expect(maxRel).toBeLessThan(1e-6);
  });

  test("k = 2 is exactly √2·|t| at ANY df, including where scipy switches to its df → ∞ limit", () => {
    // scipy's studentized_range uses the infinite-df limit above df = 100 000,
    // so it is not the oracle there; the exact identity P(Q₂ > q) =
    // P(|T_df| > q/√2) is, against stats.ts's independent t distribution.
    for (const df of [1, 1.7, 9.5, 2e5, 5e6, 1e8]) {
      for (const q of [1, 3, 6]) {
        expect(rel(studentizedRangeSf(q, 2, df), tTestP(q / Math.SQRT2, df))).toBeLessThan(1e-7);
      }
    }
  });

  test("refuses nonsense arguments with NaN (callers refuse before reaching it), never a number", () => {
    expect(studentizedRangeSf(3, 1, 10)).toBeNaN();
    expect(studentizedRangeSf(3, 3, 0.5)).toBeNaN();
    expect(studentizedRangeSf(NaN, 3, 10)).toBeNaN();
    expect(studentizedRangeQuantile(0, 3, 10)).toBeNaN();
    expect(studentizedRangeSf(0, 3, 10)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Welch's ANOVA against pingouin.welch_anova", () => {
  test.each(SETS)("%s", (_name, s) => {
    const r = welchAnova(s.groups);
    if (!r.ok) throw new Error(r.reason);
    expect(r.df1).toBe(s.df1);
    // offset: values near 1e9, where pingouin's own variance carries ~1e-9 error
    expect(rel(r.df2, s.df2)).toBeLessThan(_name === "offset" ? 1e-6 : 1e-9);
    if (s.F === 0) expect(r.f).toBe(0);
    else expect(rel(r.f, s.F)).toBeLessThan(_name === "offset" ? 1e-6 : 1e-9);
    expect(Math.abs(r.p - s.p)).toBeLessThan(_name === "offset" ? 1e-7 : 1e-9);
  });

  test("k = 2: F is exactly Welch's t², df₂ is Welch's df (scipy ttest_ind, equal_var=False)", () => {
    const s = oracle.sets.k2;
    const r = welchAnova(s.groups);
    if (!r.ok) throw new Error(r.reason);
    expect(rel(r.f, s.welch_t!.t ** 2)).toBeLessThan(1e-10);
    expect(rel(r.df2, s.welch_t!.df)).toBeLessThan(1e-10);
    expect(Math.abs(r.p - s.welch_t!.p)).toBeLessThan(1e-10);
    // and the product's own Welch t-test agrees
    const t = twoSampleTTest(s.groups[0], s.groups[1]);
    expect(rel(r.f, t.t * t.t)).toBeLessThan(1e-10);
  });

  test("identical means: F = 0 and p = 1 exactly", () => {
    const r = welchAnova(oracle.sets.identical_means.groups);
    if (!r.ok) throw new Error(r.reason);
    expect(r.f).toBe(0);
    expect(r.p).toBe(1);
  });
});

describe("Games–Howell against pingouin.pairwise_gameshowell (+ scipy ppf for the CI)", () => {
  test.each(SETS)("%s", (name, s) => {
    for (const alpha of [0.05, 0.01, 0.1]) {
      const r = gamesHowell(s.groups, alpha);
      if (!r.ok) throw new Error(r.reason);
      expect(r.pairs).toHaveLength(s.pairs.length);
      const tolMean = name === "offset" ? 1e-6 : 1e-10;
      for (const o of s.pairs) {
        const p = r.pairs.find((x) => x.i === o.i && x.j === o.j)!;
        expect(Math.abs(p.difference - o.diff)).toBeLessThan(tolMean * Math.max(1, Math.abs(o.diff)));
        expect(rel(p.se, o.se)).toBeLessThan(name === "offset" ? 1e-5 : 1e-10);
        expect(rel(p.df, o.df)).toBeLessThan(name === "offset" ? 1e-5 : 1e-9);
        expect(Math.abs(p.t - o.T)).toBeLessThan(name === "offset" ? 1e-5 : 1e-9 * Math.max(1, Math.abs(o.T)));
        expect(Math.abs(p.q - Math.SQRT2 * Math.abs(o.T))).toBeLessThan(name === "offset" ? 1e-5 : 1e-8);
        expect(Math.abs(p.p - o.p)).toBeLessThan(name === "offset" ? 1e-6 : 1e-8);
        const key = String(alpha);
        expect(rel(p.qCritical, o.qcrit[key])).toBeLessThan(1e-6);
        const width = o.ci[key][1] - o.ci[key][0];
        expect(Math.abs(p.ciLow - o.ci[key][0])).toBeLessThan(1e-6 * width);
        expect(Math.abs(p.ciHigh - o.ci[key][1])).toBeLessThan(1e-6 * width);
      }
    }
  });

  test("the pain set against scipy.stats.tukey_hsd(equal_var=False), a second implementation", () => {
    const sc = oracle.scipy_tukey_hsd_unequal_pain;
    const r = gamesHowell(oracle.sets.pain.groups, 0.05);
    if (!r.ok) throw new Error(r.reason);
    for (const p of r.pairs) {
      expect(Math.abs(p.p - sc.p[p.i][p.j])).toBeLessThan(1e-8);
      expect(Math.abs(p.ciLow - sc.low[p.i][p.j])).toBeLessThan(1e-6);
      expect(Math.abs(p.ciHigh - sc.high[p.i][p.j])).toBeLessThan(1e-6);
      expect(Math.abs(p.difference - sc.stat[p.i][p.j])).toBeLessThan(1e-10);
    }
  });

  test("k = 2: the Games–Howell p IS the Welch t-test p", () => {
    const s = oracle.sets.k2;
    const r = gamesHowell(s.groups);
    if (!r.ok) throw new Error(r.reason);
    expect(Math.abs(r.pairs[0].p - s.welch_t!.p)).toBeLessThan(1e-8);
  });

  test("ADVERSARIAL: tiny groups (n = 2) drive a pair's df to ≈ 1, and the p is still the oracle's", () => {
    const s = oracle.sets.tiny_n2_k5;
    expect(Math.min(...s.pairs.map((p) => p.df))).toBeLessThan(1.001);
    const r = gamesHowell(s.groups);
    if (!r.ok) throw new Error(r.reason);
    for (const p of r.pairs) {
      expect(p.df).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(p.ciLow) && Number.isFinite(p.ciHigh)).toBe(true);
    }
  });

  test("ADVERSARIAL: 'significant' (p < α) and 'the CI excludes 0' never disagree", () => {
    const offenders: string[] = [];
    for (const [name, s] of SETS) {
      for (const alpha of [0.05, 0.01, 0.1]) {
        const r = gamesHowell(s.groups, alpha);
        if (!r.ok) continue;
        for (const p of r.pairs) {
          const excludes = p.ciLow > 0 || p.ciHigh < 0;
          if (excludes !== p.significant) offenders.push(`${name} α=${alpha} ${p.i}-${p.j}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("ADVERSARIAL: identical means give q = 0, p = 1 and a CI centred on 0", () => {
    const r = gamesHowell(oracle.sets.identical_means.groups);
    if (!r.ok) throw new Error(r.reason);
    for (const p of r.pairs) {
      expect(p.q).toBe(0);
      expect(p.p).toBe(1);
      expect(p.ciLow).toBeCloseTo(-p.ciHigh, 12);
    }
  });

  test("ADVERSARIAL: k = 20 (190 pairs) finishes in reasonable time on a cold cache", () => {
    const groups = Array.from({ length: 20 }, (_, g) => Array.from({ length: 4 + (g % 5) }, (_, i) => 10 + g * 0.3 + Math.sin(g * 7 + i * 3) * (1 + g * 0.2)));
    const t0 = Date.now();
    const r = gamesHowell(groups);
    const ms = Date.now() - t0;
    if (!r.ok) throw new Error(r.reason);
    expect(r.pairs).toHaveLength(190);
    expect(ms).toBeLessThan(6000);
  });
});

// ---------------------------------------------------------------------------
describe("refusals: by name, and never a NaN", () => {
  const cases: [string, number[][], RegExp][] = [
    ["one group", [[1, 2, 3]], /at least two groups; only one was found/],
    ["no groups", [], /at least two groups; none were found/],
    ["a group of one value", [[1, 2, 3], [4], [5, 6]], /Group 2 has only one value/],
    ["an empty group", [[1, 2], [], [3, 4]], /Group 2 is empty/],
    ["zero variance", [[1, 2, 3], [4, 5, 6], [7, 7, 7]], /Group 3 has zero variance: every value is 7/],
    ["zero variance, negative value shown with a true minus", [[-2, -2], [1, 3]], /Group 1 has zero variance: every value is −2\./],
    ["NaN in the data", [[1, 2, NaN], [3, 4]], /Group 1 contains a value that is not a finite number/],
    ["Infinity in the data", [[1, 2], [3, Infinity]], /Group 2 contains a value that is not a finite number/],
    ["values too large to square", [[1e200, -1e200, 3e200], [1, 2]], /Group 1's values are too large to square/],
    ["too many groups", Array.from({ length: WELCH_MAX_GROUPS + 1 }, (_, i) => [i, i + 1]), /limited to 20 groups/],
  ];
  test.each(cases)("%s", (_n, groups, re) => {
    for (const r of [welchAnova(groups), gamesHowell(groups)]) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toMatch(re);
      expect(r.reason).not.toMatch(/NaN|Infinity|undefined|—/);
    }
    for (const out of [welchAnovaCalc(groups), gamesHowellCalc(groups, "0.05")]) {
      expect(out.ok).toBe(false);
      expect(out.text).toMatch(re);
      expect(out.svg).toBeUndefined();
    }
  });
  test("the test is named in the sentence", () => {
    const g = [[1, 2], [3]];
    expect((welchAnova(g) as { reason: string }).reason).toMatch(/Welch's ANOVA uses each group's own variance/);
    expect((gamesHowell(g) as { reason: string }).reason).toMatch(/Games–Howell uses each group's own variance/);
  });
});

// ---------------------------------------------------------------------------
describe("the calculators as the pane runs them (field text → statGroups → calc)", () => {
  const pain = oracle.sets.pain;

  test("the default field is the pain set, and statGroups reads it as four groups", () => {
    expect(statGroups(PAIN_FIELD)).toEqual(pain.groups);
  });

  test("Welch's ANOVA: F(3, 8.3) = 5.89, p = .019 (pingouin: F = 5.890115, df₂ = 8.329841, p = 0.018813)", () => {
    const out = welchAnovaCalc(statGroups(PAIN_FIELD));
    expect(out.ok).toBe(true);
    expect(out.text).toContain("Welch's ANOVA (4 groups; equal variances not assumed)\nF(3, 8.3) = 5.89, p = .019");
    // means and SDs: numpy (ddof = 1) in the oracle script
    pain.groups.forEach((g, i) =>
      expect(out.text).toContain(`Group ${i + 1}: mean ${Number(pain.means[i].toPrecision(4))}, SD ${Number(pain.sds[i].toPrecision(4))}, n = ${g.length}`),
    );
    expect(insertable(out.text)).toBe(true);
    expect(realSvg(out.svg)).toBe(true);
  });

  test("Games–Howell rows carry the oracle's numbers, typeset", () => {
    const out = gamesHowellCalc(statGroups(PAIN_FIELD), "0.05");
    expect(out.ok).toBe(true);
    expect(out.text).toContain("Games–Howell (4 groups), family-wise α = 0.05");
    expect(out.text).toContain("Welch's ANOVA: F(3, 8.3) = 5.89, p = .019");
    // Each row rebuilt from the ORACLE's numbers (pingouin diff/se/df/p, scipy CI)
    // at the display precision, so this checks the values and the typesetting at once.
    const m = (x: number, sig: number) => String(Number(x.toPrecision(sig))).replace(/^-/, "−");
    const pApa = (p: number) => (p < 0.001 ? "p < .001" : `p = ${p.toFixed(3).replace(/^0/, "")}`);
    for (const o of pain.pairs) {
      const row =
        `Group ${o.i + 1} vs ${o.j + 1}:  diff = ${m(o.diff, 4)}  SE = ${m(o.se, 3)}  df = ${o.df.toFixed(1)}` +
        `  q = ${m(Math.SQRT2 * Math.abs(o.T), 3)}  ${pApa(o.p)}` +
        `  95% CI [${m(o.ci["0.05"][0], 4)}, ${m(o.ci["0.05"][1], 4)}]` +
        (o.p < 0.05 ? "  *" : "");
      expect(out.text).toContain(row);
    }
    // the two significant pairs pingouin reports: Dark Brunette vs Light Blond (p 0.0148),
    // Light Blond vs Light Brunette (p 0.0378)
    expect(out.text).toContain("Group 2 vs 3:  diff = −21.8");
    expect(out.text).toMatch(/Group 2 vs 3:.*p = \.015.*\*$/m);
    expect(out.text).toMatch(/Group 3 vs 4:.*p = \.038.*\*$/m);
    expect(insertable(out.text)).toBe(true);
    expect(realSvg(out.svg)).toBe(true);
  });

  test("Use table at cursor: a WIDE Word table → feedGroups → statGroups → the same result", () => {
    const rows = [
      ["Dark Blond", "Dark Brunette", "Light Blond", "Light Brunette"],
      ["63", "32", "62", "42"],
      ["57", "39", "60", "50"],
      ["52", "51", "71", "41"],
      ["41", "30", "55", "37"],
      ["43", "35", "48", ""],
    ];
    const fed = feedGroups(rows);
    if ("error" in fed) throw new Error(fed.error);
    expect(statGroups(fed.text)).toEqual(pain.groups);
    expect(welchAnovaCalc(statGroups(fed.text)).text).toContain("F(3, 8.3) = 5.89, p = .019");
  });

  test("Use table at cursor: a LONG table (label, value) gives the same groups", () => {
    const rows: string[][] = [["Hair colour", "Pain threshold"]];
    const names = ["Dark Blond", "Dark Brunette", "Light Blond", "Light Brunette"];
    pain.groups.forEach((g, i) => g.forEach((v) => rows.push([names[i], String(v)])));
    const fed = feedGroups(rows);
    if ("error" in fed) throw new Error(fed.error);
    expect(statGroups(fed.text)).toEqual(pain.groups);
  });

  test("decimal commas typed the European way are read as decimals", () => {
    const g = statGroups("1,5 2,5 1,9\n\n3,1 4,2 2,8\n\n5,5 9,1 2,2");
    expect(g).toEqual([[1.5, 2.5, 1.9], [3.1, 4.2, 2.8], [5.5, 9.1, 2.2]]);
    expect(welchAnovaCalc(g).ok).toBe(true);
  });

  test("α = 0.01 and 0.10 give 99% and 90% intervals", () => {
    expect(gamesHowellCalc(pain.groups, "0.01").text).toContain("99% CI [");
    expect(gamesHowellCalc(pain.groups, "0.10").text).toContain("90% CI [");
    expect(gamesHowellCalc(pain.groups, "junk").text).toContain("95% CI [");
  });
});

describe("display contract on every oracle set", () => {
  test.each(SETS)("%s: true minus, no exponent noise, insertable, a real figure", (_n, s) => {
    for (const out of [welchAnovaCalc(s.groups), gamesHowellCalc(s.groups, "0.05")]) {
      expect(out.ok).toBe(true);
      expect(insertable(out.text)).toBe(true);
      // a hyphen-minus directly before a digit is an ASCII sign, never allowed
      expect(out.text).not.toMatch(/(^|[\s[(=,])-\d/m);
      expect(out.text).not.toMatch(/\de[+-]\d/);
      expect(realSvg(out.svg)).toBe(true);
    }
  });

  test("the number formatter", () => {
    expect(welchNum(-21.8)).toBe("−21.8");
    expect(welchNum(1.23456e9)).toBe("1.235×10⁹");
    expect(welchNum(-0.0000123456)).toBe("−1.235×10⁻⁵");
    expect(welchNum(9.99996e6)).toBe("1×10⁷");
    expect(welchNum(0)).toBe("0");
    expect(welchDf(3)).toBe("3");
    expect(welchDf(8.329841)).toBe("8.3");
  });

  test("ADVERSARIAL: left-skewed data (24 values, normality tested and failed) keeps a true minus in the shared notes", () => {
    // describeAssumptions prints skewness with toFixed; without trueMinus this
    // appended "skewness -1.94" to an otherwise typeset result.
    const a = [10, 10.1, 9.9, 10, 10.05, 9.95, 10, 10.1, 3, 1.5, 9.9, 10];
    const b = [20, 20.2, 19.8, 20.1, 20, 19.9, 20, 12, 20.1, 19.95, 20.05, 9];
    for (const out of [welchAnovaCalc([a, b]), gamesHowellCalc([a, b], "0.05")]) {
      expect(out.text).toMatch(/skewness −\d/);
      expect(out.text).not.toMatch(/(^|[\s[(=,])-\d/m);
      expect(out.text).toContain("D'Agostino-Pearson K²"); // a hyphen inside a name is left alone
    }
  });

  test("a refusal prints the repeated value typeset, not as 1e+21", () => {
    const out = gamesHowellCalc([[1e21, 1e21], [1, 2]], "0.05");
    expect(out.ok).toBe(false);
    expect(out.text).toContain("every value is 1×10²¹.");
  });

  test("large offsets (1e9 + small differences) keep their digits", () => {
    const out = welchAnovaCalc(oracle.sets.offset.groups);
    const f = oracle.sets.offset.F;
    expect(out.text).toContain(`= ${f.toFixed(2)}, `);
  });
});

describe("the assumption notes do not send the user to the test they are in", () => {
  const unequal = oracle.sets.very_unequal_var.groups;
  test("Welch / Games–Howell: the variance finding is reported as handled", () => {
    const notes = describeAssumptions(unequal, { varianceHandled: true }).join(" ");
    expect(notes).toMatch(/do not have equal variances/);
    expect(notes).toMatch(/already allows for it/);
    expect(notes).not.toMatch(/Use Welch|treat this result with caution/);
    expect(gamesHowellCalc(unequal, "0.05").text).toMatch(/already allows for it/);
  });
  test("ANOVA / Tukey: the remedy now names the calculators that exist", () => {
    const notes = describeAssumptions(unequal).join(" ");
    expect(notes).toMatch(/Use Welch's ANOVA with the Games–Howell post-hoc instead \(both in Stats\)/);
    expect(notes).not.toMatch(/does not provide it/);
  });
});

// Enabled as soon as taskpane.ts imports welchCalcs (INTEGRATION.md, Edit 1).
// Before that, reachability.test.ts is the red guard (welch and welchCalcs are
// unreachable); after it, a half-applied integration (import without the two
// registry entries) fails HERE instead of passing silently while the assumption
// notes and the Tukey caveat point at calculators that are not there.
const WIRED = PANE.includes('"../lib/welchCalcs"');
(WIRED ? describe : describe.skip)("pane wiring (taskpane.ts cannot be imported; its source is pinned)", () => {
  test("both calculators are registered with the groups table shape and call welchCalcs", () => {
    expect(PANE).toMatch(/id: "welchanova",[\s\S]{0,700}table: "groups"/);
    expect(PANE).toMatch(/id: "gameshowell",[\s\S]{0,700}table: "groups"/);
    expect(PANE).toContain('compute: (r) => welchAnovaCalc(statGroups(r("groups"))),');
    expect(PANE).toContain('compute: (r) => gamesHowellCalc(statGroups(r("groups")), r("alpha")),');
  });
  test("the shipped default is the pain set", () => {
    const start = PANE.indexOf("const STAT_CALCS: StatCalc[] = [");
    const src = PANE.slice(start, PANE.indexOf("\n];", start));
    for (const id of ["welchanova", "gameshowell"]) {
      const at = src.indexOf(`id: "${id}"`);
      const d = /default: "((?:[^"\\]|\\.)*)"/.exec(src.slice(at))!;
      expect(d[1].replace(/\\n/g, "\n")).toBe(PAIN_FIELD);
    }
  });
});

describe("release A review: Tukey's p at df < 3 now agrees with scipy (it read the tail low)", () => {
  // scipy 1.18 scipy.stats.studentized_range.sf (scratchpad statvenv): (40, 2, 2) 0.0012476611221553524;
  // (30, 2, 2) 0.0022148421433908494; (8, 3, 2) 0.053991000276919054.
  test.each([
    [40, 2, 2, 0.0012476611221553524],
    [30, 2, 2, 0.0022148421433908494],
    [8, 3, 2, 0.053991000276919054],
  ])("studentizedRangeP(%s, %s, %s) = %s", (q, k, df, want) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { studentizedRangeP } = require("../tukey") as typeof import("../tukey");
    expect(Math.abs(studentizedRangeP(q, k, df) - want)).toBeLessThan(1e-8);
  });
});

// ---------------------------------------------------------------------------
// Release A review, round 2. Every number is scipy 1.18.1 / pingouin 0.7.0
// (scratchpad statvenv, fixor.py / fixor2.py).
describe("review round 2: Tukey's critical value and p come from the same tail below df 6", () => {
  test("tukeyHSD([[0, 1], [7.015, 8.015]], 0.01): p = 0.010008 is NOT significant, and q_crit agrees", () => {
    // scipy tukey_hsd p = 0.010008213203816951; studentized_range.ppf(0.99, 2, 2) = 14.035847859164942.
    // Before: the critical value came from the old quadrature and read low, so the pair was
    // called significant beside a p above alpha.
    const r = tukeyHSD([[0, 1], [7.015, 8.015]], 0.01)!;
    expect(rel(r.qCritical, 14.035847859164942)).toBeLessThan(1e-6);
    expect(rel(r.pairs[0].p, 0.010008213203816951)).toBeLessThan(1e-5);
    expect(r.pairs[0].significant).toBe(false);
    expect(r.pairs[0].significant).toBe(r.pairs[0].p < 0.01);
  });
  test.each([
    [20, 3, 3, 0.0015753096230057828],
    [20, 3, 4, 0.0003239696457189023],
    [20, 3, 5, 7.537024629367117e-5],
    [10, 3, 3, 0.011866436628699906],
    [12, 4, 4, 0.0036767588673620732],
    [8, 5, 5, 0.012483946567623305],
    [15, 3, 4, 0.000995569436931909],
  ])("studentizedRangeP(%s, %s, %s) = %s (df 3 to 5 now use the tail integral)", (q, k, df, want) => {
    // Before: 0.0016709 at (20, 3, 3), 6% high.
    expect(rel(studentizedRangeP(q, k, df), want)).toBeLessThan(1e-5);
  });
  test.each([
    [0.01, 3, 3, 10.61853991287492],
    [0.001, 3, 3, 23.31324084742785],
    [0.01, 4, 4, 9.17294141766375],
    [0.05, 3, 5, 4.601726054362552],
    [0.001, 5, 5, 13.929956698551674],
  ])("studentizedRangeCritical(%s, %s, %s) = %s", (alpha, k, df, want) => {
    expect(rel(studentizedRangeCritical(alpha, k, df), want)).toBeLessThan(1e-6);
  });
});

describe("review round 2: the quantile cache is an LRU, not clear-all", () => {
  test("a hit refreshes a key; the oldest untouched key is the one evicted", () => {
    const c = new LruCacheForTest<number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBe(1); // a is now the most recent
    c.set("d", 4); // evicts b, not a
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.has("d")).toBe(true);
    expect(c.size).toBe(3);
    c.set("c", 30); // re-set refreshes without growing
    c.set("e", 5); // evicts a (oldest now), keeps c
    expect(c.has("a")).toBe(false);
    expect(c.get("c")).toBe(30);
    expect(c.size).toBe(3);
  });
  test("Games–Howell at k = 20 at three alphas keeps every pair's quantile (570 > the old 400 clear)", () => {
    // Before: the cache was cleared wholesale past 400 entries, so the third alpha's
    // pairs wiped the first alpha's and a later edit recomputed all 190.
    const groups = Array.from({ length: 20 }, (_, g) =>
      Array.from({ length: 3 + (g % 4) }, (_, i) => g + (1 + (g % 5)) * (i - 1) + 0.01 * i * i),
    );
    const runs = [0.05, 0.01, 0.1].map((a) => gamesHowell(groups, a));
    for (const r of runs) expect(r.ok).toBe(true);
    const first = runs[0];
    if (!first.ok) return;
    expect(first.pairs).toHaveLength(190);
    for (const pr of first.pairs) expect(quantileCachedForTest(0.05, 20, pr.df)).toBe(true);
  });
});

describe("review round 2: magnitude edges in Welch / Games–Howell", () => {
  test("[[1e-200, 2e-200], [1, 2]]: the values differ, so it is NOT reported as 'every value is'", () => {
    for (const r of [welchAnova([[1e-200, 2e-200], [1, 2]]), gamesHowell([[1e-200, 2e-200], [1, 2]])]) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).not.toMatch(/every value is/);
      expect(r.reason).toMatch(/Group 1's values differ, but by so little that their variance is below the precision/);
      expect(r.reason).not.toMatch(/NaN|Infinity|undefined|—|e-/);
    }
  });
  test("Games–Howell at ~1×10¹⁵⁰: the Welch–Satterthwaite df no longer overflows (pingouin, data ÷ 10¹⁵⁰)", () => {
    // pingouin pairwise_gameshowell on [[1, 2, 1.5], [3, 5, 4.4], [0.5, 1, 0.7]]: df and p are
    // scale-invariant. Before: (vᵢ)² overflowed, df was NaN and the test refused.
    const small = [[1, 2, 1.5], [3, 5, 4.4], [0.5, 1, 0.7]];
    const big = small.map((g) => g.map((v) => v * 1e150));
    const want = [
      [2.898740057451105, 0.0592709342695622],
      [2.9522218509856324, 0.18921736869858763],
      [2.239639981240708, 0.04427401927575514],
    ];
    const r = gamesHowell(big);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.pairs.forEach((pr, idx) => {
      expect(rel(pr.df, want[idx][0])).toBeLessThan(1e-9);
      expect(rel(pr.p, want[idx][1])).toBeLessThan(1e-5);
    });
  });
});

describe("review round 2: assumption notes inside Welch / Games–Howell, and in Check test assumptions", () => {
  const skewUnequal = [
    Array.from({ length: 30 }, (_, i) => Math.exp(i / 10)),
    Array.from({ length: 30 }, (_, i) => 50 * Math.exp(i / 10)),
    Array.from({ length: 30 }, (_, i) => 100 * Math.exp(i / 10)),
  ];
  const skewEqual = [0, 1, 2].map((s) => Array.from({ length: 30 }, (_, i) => s + Math.exp(i / 10)));
  test("both fail, handled: no generic double alarm; variance handled, normality still matters", () => {
    const notes = describeAssumptions(skewUnequal, { varianceHandled: true });
    const all = notes.join(" ");
    expect(all).not.toMatch(/Two assumptions fail at once/);
    expect(notes[0]).toMatch(/^The groups do not have equal variances/);
    expect(all).toMatch(/Welch's ANOVA and Games–Howell do not assume equal variances, so that is already handled/);
    expect(all).toMatch(/Normality still matters: Welch's ANOVA and Games–Howell assume roughly normal data/);
    expect(all).toMatch(/transformation/);
    expect(all).toMatch(/assumes the groups have similar shapes/);
    expect(all).not.toMatch(/Use Welch/);
  });
  test("non-normal only, handled: no blunt 'Kruskal-Wallis instead'; rank route named with its caveat", () => {
    const all = describeAssumptions(skewEqual, { varianceHandled: true }).join(" ");
    expect(all).toMatch(/not normally distributed/);
    expect(all).not.toMatch(/Consider the Kruskal-Wallis test instead|Mann-Whitney U test instead/);
    expect(all).toMatch(/fairly robust to moderate non-normality when the groups are balanced and not tiny/);
    expect(all).toMatch(/Kruskal-Wallis followed by Dunn's test compares distributions rather than means and assumes the groups have similar shapes/);
    const two = describeAssumptions(skewEqual.slice(0, 2), { varianceHandled: true }).join(" ");
    expect(two).not.toMatch(/Mann-Whitney U test instead/);
    expect(two).toMatch(/the Mann-Whitney U test compares distributions/);
  });
  test("Check test assumptions (no result): never 'treat this result with caution'", () => {
    const all = describeAssumptions(skewUnequal).join(" ") + describeAssumptions(oracle.sets.very_unequal_var.groups).join(" ");
    expect(all).not.toMatch(/treat this result with caution/);
    expect(all).toMatch(/One-way ANOVA and Tukey HSD both assume equal variances/);
  });
  test("a note's p is formatP's p: the same text as the Brown–Forsythe line beside it", () => {
    const g = oracle.sets.very_unequal_var.groups;
    const vh = varianceHomogeneity(g);
    const all = describeAssumptions(g).join(" ");
    expect(all).toContain(`Brown-Forsythe F(${vh.df1}, ${vh.df2}) = ${vh.f.toFixed(2)}, ${formatP(vh.p)}`);
    expect(all).not.toMatch(/p = 0\./);
  });
});
