/**
 * Fix round 3 (final): numbers, Finance and ARIMA. Each test is a reviewer's repro (scratchpad R3 findings3.md,
 * f3/fin-findings.md, f3/stats-findings.md).
 */
import { budget } from "./timeBudget";
import { readNumberList, oneGroupedNumber } from "../numberList";
import { readCalcList, ListTokenError } from "../calcList";
import { readLevels } from "../plotKinds";
import { parseBandList, parseLevelList } from "../audio";
import { statFieldAmbiguity } from "../statFields";
import { readDist } from "../ipValuation";
import { IPVAL_CALCS } from "../ipValuationCalcs";
import { LITIG_CALCS } from "../litigCalcs";
import { modeDefaultSwaps, type FinCalcDef, type FinResult } from "../finCalc";
import { readFinanceField } from "../finance";
import { readingProblems } from "../calcReading";
import { inNum, earReading } from "../finPaneReadings";
import { fmtOddsRatio } from "../logitProbit";
import { runBootstrap } from "../bootstrap";
import { bfgs, fitArima } from "../arima";

const asks = (s: string): string => {
  try {
    readCalcList(s);
  } catch (e) {
    if (e instanceof ListTokenError) return e.message;
    throw e;
  }
  return "";
};

describe("N1: a lone grouped run is never read as several numbers in silence", () => {
  test("readLevels(“2,500,000”) is the one level 2500000 (round 2 gave 0, 2 and 500)", () => {
    expect(readLevels("2,500,000", 0, 5e6)).toEqual({ levels: [2500000], notes: [] });
  });
  test.each([
    ["2,500,000", 2500000],
    ["4,250,000", 4250000],
    ["1,050,000", 1050000],
    ["1,250,000.50", 1250000.5],
    ["−3,500,000", -3500000],
  ])("%s is one number for every reader, asked by none", (s, v) => {
    const r = readNumberList(s);
    expect(r.values).toEqual([v]);
    expect(r.ambiguous).toBeUndefined();
    expect(readCalcList(s).values).toEqual([v]);
    expect(statFieldAmbiguity(s, "numbers")).toBe("");
  });
  test("a run that reads two ways is asked by the readers that used to take the list silently", () => {
    const q = /reads two ways: the numbers 1000, 500, or one number grouped in thousands \(1000500\)/;
    expect(readLevels("1,000,500", 0, 5e6)).toMatch(q);
    const band = parseBandList("125,250,500");
    expect(band.ok).toBe(false);
    if (!band.ok) expect(band.error).toMatch(/reads two ways: the numbers 125, 250, 500/);
    const lv = parseLevelList("100,105");
    expect(lv.ok).toBe(false);
    if (!lv.ok) expect(lv.error).toMatch(/reads three ways/);
    expect(statFieldAmbiguity("100,200,300", "numbers")).toMatch(/reads two ways/);
    expect(statFieldAmbiguity("12 15; 100,200", "groups")).toMatch(/“100,200” reads three ways/);
  });
  test("unambiguous fields are not asked", () => {
    expect(statFieldAmbiguity("12, 15, 18", "numbers")).toBe("");
    expect(statFieldAmbiguity("1,2,3; 4,5,6", "groups")).toBe("");
    expect(statFieldAmbiguity("1,5 2,5; 3,5 4,5", "groups")).toBe("");
    expect(parseBandList("63, 125, 250, 500").ok).toBe(true);
    expect(parseLevelList("80,5; 79,2").ok).toBe(true);
  });
  test("rows keep the list reading in `values` (a row needs several values)", () => {
    expect(readNumberList("100,200").values).toEqual([100, 200]);
    expect(readNumberList("100,200,300").values).toEqual([100, 200, 300]);
  });
});

describe("N2: a single-number field reads a valid grouping as that number", () => {
  const o = { min: 0, minExclusive: false, max: 1e12, unit: "" };
  test.each([
    ["4,250,000", 4250000],
    ["1,234,567", 1234567],
    ["1,250,000.50", 1250000.5],
    ["+1,000", 1000],
  ])("ipv-mc fixed %s", (s, v) => {
    expect(readDist("fixed", s, "Revenue", o)).toEqual({ kind: "fixed", p: [v] });
    expect(oneGroupedNumber(s)).toBe(v);
  });
  test("only the single comma without the 0 tell is still asked (1500 or 1.5)", () => {
    const r = readDist("fixed", "1,500", "Revenue", o);
    expect("error" in r && r.error).toMatch(/^Revenue: “1,500” reads three ways/);
    expect(oneGroupedNumber("1,500")).toBeNull();
    expect(oneGroupedNumber("12,15")).toBeNull();
    expect(oneGroupedNumber("0,500")).toBeNull();
  });
});

describe("N3, N4: the question offers only possible readings; a leading plus is a sign", () => {
  test("no list value “000” or “000.50” is offered", () => {
    expect(asks("-1,000,500,500,500")).toMatch(/the numbers −1000, 500, 500, 500, or one number/);
    expect(asks("1,250,000.50")).toBe("");
    expect(readCalcList("1,250,000.50").values).toEqual([1250000.5]);
  });
  test("“+1,000” in a Finance list and in a Stats list", () => {
    expect(readCalcList("+1,000").values).toEqual([1000]);
    expect(readNumberList("+1,000 2,000").values).toEqual([1000, 2000]);
    expect(readNumberList("+1,000 2,000").dropped).toEqual([]);
  });
});

/** A Finance calculator run from its defaults after the given select changes, in order, the way the pane does. */
function runWith(c: FinCalcDef, selects: [string, string][], over: Record<string, string> = {}): { res: FinResult; vals: Record<string, string> } {
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  for (const [key, value] of selects) {
    const sel = c.fields.find((f) => f.key === key)!;
    Object.assign(vals, modeDefaultSwaps(c.fields, sel, vals[key], value, (k) => vals[k]), { [key]: value });
  }
  Object.assign(vals, over);
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(vals[f.key]);
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return { res: c.compute((k) => numeric.get(k) ?? vals[k] ?? ""), vals };
}

describe("F1: ipv-mc at break-even says so, in the text, the table and the reading", () => {
  test("every input fixed, price 682057.35", () => {
    const c = IPVAL_CALCS.find((x) => x.id === "ipv-mc")!;
    const fixed: [string, string][] = ["revdist", "ratedist", "lifedist", "discdist"].map((k) => [k, "fixed"]);
    const { res } = runWith(c, fixed, { cost: "682057.35" });
    if (typeof res === "string" || res.ok === false) throw new Error(typeof res === "string" ? res : res.text);
    expect(res.text).toMatch(/Mean NPV: −?0\.00/);
    expect(res.text).toContain("Probability NPV < 0: 0.0% (0 of 50,000 draws); every draw is 0.00 to the smallest unit shown, so none is a loss");
    expect(res.text).not.toContain("−0.00");
    expect(res.reading).toContain("every one of the 50,000 simulated outcomes breaks even");
    expect(res.reading).not.toMatch(/loses money/);
    expect(readingProblems(res.reading ?? "")).toEqual([]);
    const row = res.tables![0].rows.find((r) => r[0] === "Probability NPV < 0")!;
    expect(row[1]).toBe("0.0%");
  });
});

describe("F2, F4: typed rates echo as typed; once a year", () => {
  test("inNum below 10⁻³ uses significant digits", () => {
    expect(inNum(5e-7)).toBe("0.0000005");
    expect(inNum(1.5e-6)).toBe("0.0000015");
    expect(inNum(4.9e-7)).toBe("0.00000049");
    expect(inNum(-2e-7)).toBe("−0.0000002");
    expect(inNum(0.0005)).toBe("0.0005");
    expect(inNum(0.00123)).toBe("0.00123");
  });
  test("a tiny rate compounded once a year", () => {
    expect(earReading(0.0001, 1)).toBe("A 0.0001% nominal rate compounded once a year is 0.00% effective to two decimals: the rate itself is too small to show there.");
  });
});

describe("F3: the mode defaults do not depend on the order the dropdowns change", () => {
  const c = LITIG_CALCS.find((x) => x.id === "dmg-sec-ribbon")!;
  test("units = decimal then mode = dollar, and the reverse, give the same fields and a result", () => {
    const a = runWith(c, [["units", "decimal"], ["mode", "dollar"]]);
    const b = runWith(c, [["mode", "dollar"], ["units", "decimal"]]);
    expect(a.vals.disclosures).toBe(b.vals.disclosures);
    expect(a.vals.disclosures).toContain("Inflation removed");
    for (const { res } of [a, b]) expect(typeof res !== "string" && res.ok === false ? res.text : "").toBe("");
  });
  test("back to an abnormal-return mode keeps the decimal defaults while units = decimal", () => {
    const r = runWith(c, [["units", "decimal"], ["mode", "dollar"], ["mode", "ar-pct"]]);
    expect(r.vals.disclosures).toContain("Abnormal return (decimal)");
    expect(typeof r.res !== "string" && r.res.ok === false ? r.res.text : "").toBe("");
  });
  test("an edited field is never overwritten", () => {
    const { vals } = runWith(c, [["units", "decimal"]], {});
    const sel = c.fields.find((f) => f.key === "mode")!;
    const edited = { ...vals, disclosures: "Disclosure date\tAbnormal return (decimal)\n2025-03-17\t−0.05" };
    expect(modeDefaultSwaps(c.fields, sel, "ar-dollar", "dollar", (k) => edited[k as keyof typeof edited] ?? "")).toEqual({});
  });
});

describe("S-m2, S-m3: one format per rounded value; a refusal shows the work over its limit", () => {
  test("fmtOddsRatio chooses the format after rounding", () => {
    expect(fmtOddsRatio(0.00099995)).toBe(fmtOddsRatio(0.001));
    expect(fmtOddsRatio(999999999.9)).toBe(fmtOddsRatio(1e9));
    expect(fmtOddsRatio(0.99996)).toBe("1.000");
  });
  test("median, 2,449 rows × 2,000 replicates", () => {
    const y = Float64Array.from({ length: 2449 }, (_, i) => Math.sin(i) * 10 + (i % 7));
    const r = runBootstrap({ stat: "median", y, B: 2000, confidence: 0.95, seed: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("(about 25.2 million steps; the limit is 25 million)");
  });
});

describe("S-M1: ARIMA's work is bounded inside the optimiser", () => {
  test("bfgs never reports a run cut off by the budget as converged", () => {
    // The objective with fitArima's hard stop: no value once the budget is spent.
    for (let total = 1; total <= 300; total++) {
      const b = { left: total };
      const fn = (x: number[]): number => {
        if (b.left <= 0) return Infinity;
        b.left -= 1;
        return x.reduce((s, v, i) => s + (i + 1) * (v - 1) ** 2, 0);
      };
      const r = bfgs(fn, [3, -2, 0.5, 4], 400, b);
      if (b.left <= 0) {
        expect(r.exhausted).toBe(true);
        expect(r.converged).toBe(false);
      }
      if (r.converged) expect(r.x.every((v) => Math.abs(v - 1) < 1e-4)).toBe(true);
    }
  });
  /** The reviewer's generator (f3/stats/a_n.js): white noise from an LCG and Box–Muller. */
  const noise = (n: number): number[] => {
    let s = 4242;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()));
  };
  // Measured in node at the review's load: 5.5 s and 5.5 s (round 2: 12.2 s and 7.9 s); about 2.3 s at the review's
  // lighter load. The bounds catch a return of the unbounded work, not the quiet-machine target.
  test.each([
    [100000, 1, 1, 1],
    [15000, 3, 1, 2],
  ])("noise, n = %d, ARIMA(%d, %d, %d): refused on its work budget", (n, p, d, q) => {
    const t0 = Date.now();
    const f = fitArima(noise(n), { p, d, q, trend: "none" });
    expect(Date.now() - t0).toBeLessThan(budget(9000));
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.reason).toMatch(/did not converge within the pane's computation limit/);
  });
  test("S-m1: ARIMA(1, 0, 5) with a mean on 10,000 rows of noise fits again (round 2 refused it up front)", () => {
    const f = fitArima(noise(10000), { p: 1, d: 0, q: 5, trend: "mean" });
    expect(f.ok).toBe(true);
  });
});
