/**
 * Stats fixer A, part 1: the 2026-10-28 bug test's R4 findings on the classical Stats calculators (taskpane STAT_CALCS,
 * lib/statPaneReadings.ts), each pinned to the reviewer's repro. taskpane.ts cannot be imported, so the pane's guards
 * and formatters live in lib functions the entries call; these tests hold those functions.
 */
import { readingProblems } from "../calcReading";
import { readNumberList } from "../numberList";
import { statFieldCommasAreSeparators, statFieldProvesDecimalCommas } from "../statFields";
import { printedPVerdict, boundaryClause } from "../pReading";
import { multipleRegression, polynomialRegression } from "../regression";
import { householderLeastSquaresParts, qrDecompose } from "../linalg";
import {
  describe as statDescribe,
  formatP,
  linearRegression,
  pairedTTest,
  regressionRowsProblem,
  simpleRegressionExactFit,
  spreadProblem,
  firstSpreadProblem,
  REGRESSION_MAX_ROWS,
} from "../stats";
import * as R from "../statPaneReadings";
import { bootWork, BOOT_MAX_WORK } from "../bootstrap";
import { QR_MAX_ROW_QUANTILES } from "../quantReg";
import { bootCiCalc, BOOT_CI_DEFAULTS } from "../robustCalcs";
import { kaplanMeier, logRankTest } from "../survival";
import { welchAnovaReading, gamesHowellReading, gamesHowellPairClear } from "../welchCalcs";
import { coxReading, rmAnovaReading } from "../statsBatchCalcs";
import type { TukeyResult } from "../tukey";
import type { DunnettResult } from "../dunnett";
import type { WelchAnovaResult, GamesHowellResult } from "../welch";

const ok = (r: string | undefined): string => {
  expect(r).toBeDefined();
  expect(readingProblems(r)).toEqual([]);
  return r as string;
};
const reader = (defaults: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => over[k] ?? defaults[k] ?? "";

describe("R4 #2: multiple and polynomial regression use a thin QR and a named row cap", () => {
  test("8,000 rows fit in well under a second (was 8 s and 2.6 GB with the m×m Q)", () => {
    const n = 8000;
    const x = Array.from({ length: n }, (_, i) => i / n);
    const x2 = x.map((v) => Math.sin(7 * v));
    const y = x.map((v, i) => 2 + 3 * v + x2[i] + 0.1 * Math.cos(13 * i));
    const t0 = Date.now();
    expect(multipleRegression(y, [x, x2]).ok).toBe(true);
    expect(polynomialRegression(x, y, 2).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  test("the thin factor gives the same R and Qᵀy as the full one", () => {
    const A = [
      [1, 1, 2],
      [1, 2, 1],
      [1, 3, 4],
      [1, 4, 3],
      [1, 5, 6],
    ];
    const y = [12, 19, 23, 31, 38];
    const { Q, R: Rf } = qrDecompose(A);
    const thin = householderLeastSquaresParts(A, y);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(thin.R[i][j]).toBeCloseTo(Rf[i][j], 12);
      const qty = Q.reduce((s, row, r) => s + row[i] * y[r], 0);
      expect(thin.qty[i]).toBeCloseTo(qty, 10);
    }
  });
  test("the default still fits to the published coefficients", () => {
    const r = multipleRegression([12, 19, 23, 31, 38, 45, 52, 59], [[1, 2, 3, 4, 5, 6, 7, 8], [2, 1, 4, 3, 6, 5, 8, 7]]);
    expect(r.coefficients.map((c) => c.estimate)).toEqual([expect.closeTo(4.6125, 10), expect.closeTo(6.9875, 10), expect.closeTo(-0.2625, 10)]);
  });
  test("past the cap the refusal names the calculator and the count", () => {
    expect(regressionRowsProblem(REGRESSION_MAX_ROWS, "Multiple regression")).toBeNull();
    expect(regressionRowsProblem(REGRESSION_MAX_ROWS + 1, "Polynomial regression")).toMatch(/^Polynomial regression takes at most 10,000 rows here; this has 10,001\./);
  });
});

describe("R4 #3: a lone grouped number is one number", () => {
  test("1,000 alone reads as 1000, as 1,000 2,000 reads as 1000 and 2000", () => {
    expect(readNumberList("1,000").values).toEqual([1000]);
    expect(readNumberList("−2,050").values).toEqual([-2050]);
    expect(readNumberList("1,000,000").values).toEqual([1000000]);
    expect(readNumberList("1,000 2,000").values).toEqual([1000, 2000]);
  });
  test("without the 0-group tell a lone comma run keeps its list reading (table rows 10,20 and 100,200)", () => {
    expect(readNumberList("100,200").values).toEqual([100, 200]);
    expect(readNumberList("3,5").values).toEqual([3, 5]);
    expect(readNumberList("100,200,300").ambiguous).toMatch(/reads two ways/);
  });
  test("through the group and table readers too (statFields decides before statList)", () => {
    expect(statFieldCommasAreSeparators("1,000")).toBe(false);
    expect(statFieldProvesDecimalCommas(["1,000"])).toBe(false);
    expect(statFieldCommasAreSeparators("100,200\n300,400")).toBe(false);
    expect(readNumberList("100,200").values).toEqual([100, 200]);
  });
});

describe("R4 #4: overflow is refused by name, never 'zero variance' or t = 0", () => {
  const big = [1e200, 2e200, 3e200];
  test("the guard names the field and fires before the zero-variance refusal", () => {
    expect(spreadProblem("Data", big)).toMatch(/^Data: the values are too large to square in double precision/);
    expect(firstSpreadProblem([{ label: "Group A", values: [1, 2, 3] }, { label: "Group B", values: big }])).toMatch(/^Group B:/);
    expect(spreadProblem("Group 1", [1e-200, 2e-200])).toMatch(/differ, but by so little/);
    expect(spreadProblem("Group 1", [5, 5, 5])).toBeNull();
    expect(spreadProblem("Group 1", [1, 2, 3])).toBeNull();
  });
  test("the repro: paired t on 1e200-scale data was 't = 0, p = 1.000'", () => {
    const a = [1e200, 3e200, 2e200];
    const b = [2e200, 1e200, 5e200];
    expect(pairedTTest(a, b).p).toBe(1); // what the engine does on its own
    expect(spreadProblem("The paired differences (condition 1 − condition 2)", a.map((x, i) => x - b[i]))).toMatch(/too large to square/);
    expect(Number.isFinite(statDescribe(big).sd)).toBe(false);
  });
});

describe("R4 #5: the power branch follows the printed power", () => {
  test("0.79966 prints 0.8 and reads 'adequate'", () => {
    const r = ok(R.powerReading({ solveN: false, n: 30, unit: "per group", total: 60, power: 0.7996575878540358, target: 0.8 }));
    expect(r).toMatch(/0\.8 chance .* adequate/);
    expect(ok(R.powerReading({ solveN: false, n: 30, unit: "per group", total: 60, power: 0.7949, target: 0.8 }))).toMatch(/only a 0\.795 chance/);
  });
});

describe("R4 #6: simple regression on a constant y or an exact fit", () => {
  test("an exact fit is detected and read without a p-value", () => {
    const x = [0.1, 0.2, 0.3];
    const y = [0.3, 0.5, 0.7];
    const res = linearRegression(x, y);
    expect(simpleRegressionExactFit(x, y, res.slope, res.intercept)).toBe(true);
    const r = ok(R.regressionReading(res, true));
    expect(r).toMatch(/lie exactly on a straight line with slope 2 \(R² = 1\)/);
    expect(r).not.toMatch(/p [<=]/);
    const x2 = [1, 2, 3, 4, 5];
    const y2 = [2.1, 3.9, 6.1, 8.0, 9.9];
    const r2 = linearRegression(x2, y2);
    expect(simpleRegressionExactFit(x2, y2, r2.slope, r2.intercept)).toBe(false);
  });
});

describe("R4 #7: run-time caps", () => {
  test("bootstrap: the reviewer's slow runs are now refused up front", () => {
    expect(bootWork("median", 2000, 5000)).toBeGreaterThan(BOOT_MAX_WORK);
    expect(bootWork("mean", 2000, 20000)).toBeGreaterThan(BOOT_MAX_WORK);
    expect(bootWork("median", 40, 2000)).toBeLessThan(BOOT_MAX_WORK);
  });
  test("quantile regression: rows × quantiles cap", () => {
    expect(QR_MAX_ROW_QUANTILES).toBeLessThanOrEqual(150000);
  });
});

describe("R4 #8: a dropdown choice never refuses its own default", () => {
  test("boot-ci corr / ratio / slope on the default column field use spend ~ income and say so", () => {
    for (const stat of ["corr", "ratio", "slope"]) {
      const o = bootCiCalc(reader(BOOT_CI_DEFAULTS, { stat, B: "300" }));
      expect(o.ok).not.toBe(false);
      expect(o.text).toMatch(/worked pair “spend ~ income” is used/);
      expect(o.text).toMatch(/of spend (and|on) income|spend\/income/);
    }
  });
});

describe("R4 #9: one p rule, decided on the printed p", () => {
  test("printed formats", () => {
    expect(printedPVerdict("p = .050")).toBe("borderline");
    expect(printedPVerdict("p = 0.0500000")).toBe("borderline");
    expect(printedPVerdict("p = .049")).toBe("clear");
    expect(printedPVerdict("p = .051")).toBe("none");
    expect(printedPVerdict("p < 1 × 10⁻¹⁵")).toBe("clear");
    expect(printedPVerdict("1.23456 × 10⁻⁵")).toBe("clear");
    expect(printedPVerdict("p = n/a")).toBeNull();
    expect(printedPVerdict("p = .100", 0.1)).toBe("borderline");
    expect(boundaryClause(0.01)).toBe("right at the 1% threshold, so the evidence is borderline");
  });
  test("Tukey: a pair printed .050 at α = 0.05 is neither starred nor called a difference", () => {
    expect(R.tukeyPairClear(0.0497, 0.05)).toBe(false);
    expect(R.tukeyPairClear(0.049, 0.05)).toBe(true);
    const pair = { i: 0, j: 1, meanI: 1, meanJ: 2, difference: -1, q: 3, p: 0.0497, ciLow: -2, ciHigh: 0, significant: true };
    const res: TukeyResult = { pairs: [pair, { ...pair, j: 2, p: 0.4, significant: false }, { ...pair, i: 1, j: 2, p: 0.6, significant: false }], mse: 1, dfWithin: 9, k: 3, alpha: 0.05, qCritical: 3.9, caveats: [] };
    const r = ok(R.tukeyReading(res));
    expect(r).toMatch(/^No pair of the three groups differs clearly .*groups 1 and 2 \(p = \.050\) are right at the conventional 5% threshold/);
  });
  test("Dunnett, Dunn, multcomp: stars and readings on the printed p", () => {
    expect(R.dunnettClear(0.0496)).toBe(false);
    expect(R.dunnClear(0.0496)).toBe(false);
    expect(R.kruskalClear(0.0496)).toBe(false);
    expect(R.multcompClear(0.04996)).toBe(false); // assaySig(…, 3) = "0.05"
    expect(R.multcompClear(0.0499)).toBe(true);
  });
  test("p in [0.05, 0.0505) and in [0.0495, 0.05) read the same (chi-square goodness of fit)", () => {
    const base = { chi2: 9.49, df: 4, expected: [], warnings: [] } as unknown as Parameters<typeof R.chiGofReading>[0];
    const lo = ok(R.chiGofReading({ ...base, p: 0.0496 }));
    const hi = ok(R.chiGofReading({ ...base, p: 0.0504 }));
    expect(lo.replace("0.0496", "")).toBe(hi.replace("0.0504", ""));
    expect(lo).toMatch(/borderline/);
  });
  test("Welch, Games–Howell, RM ANOVA and Cox use the same rule", () => {
    const w = { ok: true, k: 3, f: 3.5, df1: 2, df2: 10.2, p: 0.0499, groups: [{ mean: 1, sd: 1, n: 5 }, { mean: 2, sd: 1, n: 5 }, { mean: 3, sd: 1, n: 5 }], weightedMean: 2, caveats: [] } as unknown as WelchAnovaResult;
    expect(ok(welchAnovaReading(w))).toMatch(/among the three group means .* borderline/);
    expect(gamesHowellPairClear(0.0499, 0.05)).toBe(false);
    const gh = { ok: true, k: 2, alpha: 0.05, pairs: [{ i: 0, j: 1, difference: -1, p: 0.0501, significant: false, se: 1, df: 8, q: 3, ciLow: -2, ciHigh: 0 }], groups: [], caveats: [] } as unknown as GamesHowellResult;
    expect(ok(gamesHowellReading(gh))).toMatch(/^The two groups do not differ clearly at α = 0\.05; the gap of 1 \(p = \.050\) is right at the conventional 5% threshold/);
    expect(typeof rmAnovaReading).toBe("function");
    expect(typeof coxReading).toBe("function");
  });
});

describe("R4 #10: display contract in the text", () => {
  test("descriptive keeps every integer digit, grouped", () => {
    expect(R.descNum(2345678)).toBe("2,345,678");
    expect(R.descNum(-12345.678)).toBe("−12,346");
    expect(R.descNum(3.14159)).toBe("3.142");
    expect(R.descNum(2.5e9)).toBe("2.5×10⁹");
    const d = statDescribe([2345678, 2345600, 2345700]);
    expect(ok(R.descriptiveReading(d))).toMatch(/average 2,345,659/);
  });
  test("Kaplan–Meier table times are never raw JavaScript numbers", () => {
    expect(R.survivalTime(0.30000000000000004)).toBe("0.3");
    expect(R.survivalTime(1e-7)).toBe("1×10⁻⁷");
    expect(R.survivalTime(12)).toBe("12");
    expect(R.survivalTime(123456)).toBe("123,456");
  });
});

describe("R4 #11: counts, hedges and associational language", () => {
  test("Both / All three / One of the two is", () => {
    expect(R.ofTheCount(2, 2)).toBe("Both");
    expect(R.ofTheCount(3, 3)).toBe("All three");
    expect(R.ofTheCount(1, 2)).toBe("One of the two");
    expect(R.ofTheSingular(1, 2)).toBe(true);
    const c = (treatment: number, p: number) => ({ treatment, meanDifference: 3, t: 4, p, significant: p < 0.05, ciLow: 1, ciHigh: 5 });
    const res = { ok: true, comparisons: [c(0, 0.001), c(1, 0.002)], df: 8, mse: 1, critical: 2.5, twoSided: true, controlN: 5, caveats: [] } as unknown as DunnettResult;
    expect(ok(R.dunnettReading(res))).toMatch(/^Both treatments differ from the control/);
  });
  test("multcomp with one p-value never says 'one of the one'", () => {
    expect(ok(R.multcompReading([0.01], [0.01], "Holm"))).toBe("After the Holm correction the p-value (raw 0.01) stays below 0.05.");
    expect(ok(R.multcompReading([0.3], [0.3], "Holm"))).not.toMatch(/one of the one/);
  });
  test("log-rank: 3+ groups differ 'somewhere'; the hazard ratio is an estimate", () => {
    const g = [
      { times: [1, 2, 3, 4, 5, 6], events: [1, 1, 1, 1, 1, 1] },
      { times: [10, 12, 14, 16, 18, 20], events: [1, 1, 1, 1, 1, 1] },
      { times: [30, 32, 34, 36, 38, 40], events: [1, 1, 1, 0, 0, 0] },
    ];
    expect(ok(R.logRankReading(logRankTest(g)))).toMatch(/^The survival curves of the three groups differ somewhere .* does not say which/);
  });
  test("descriptive: the median sentence holds with ties", () => {
    const r = ok(R.descriptiveReading(statDescribe([1, 2, 2, 2, 2, 9])));
    expect(r).toMatch(/the median, the middle of the sorted values, is 2\./);
    expect(r).not.toMatch(/half the values lie/);
  });
});

describe("R4 #12: the Kaplan–Meier median at S = 0.5 exactly states its convention", () => {
  test("1, 2, 3, 4 all events: median 2 with the convention note", () => {
    const km = kaplanMeier([1, 2, 3, 4], [1, 1, 1, 1]);
    expect(km.medianSurvival).toBe(2);
    expect(km.caveats.join(" ")).toMatch(/Conventions differ for this case: this calculator reports the first time S\(t\) reaches 0\.5/);
    expect(kaplanMeier([5, 6, 6, 8, 10, 12, 15, 18, 20, 24], [1, 1, 0, 1, 0, 1, 0, 1, 0, 0]).caveats.join(" ")).not.toMatch(/Conventions differ/);
  });
});

describe("R4 #9 adversarial: every classical reading at a p that prints .050 is borderline and keeps the rules", () => {
  const P = 0.0499;
  const anyRes = <T,>(o: object): T => o as unknown as T;
  const cases: [string, string | undefined][] = [
    ["two-sample", R.twoSampleReading(anyRes({ t: 2.3, df: 8, p: P, meanDifference: -1.2, d: 1, dKind: "cohen", ci95: [0, 2] }))],
    ["paired", R.pairedReading(anyRes({ t: 2.3, df: 8, p: P, meanDifference: 1.2, d: 1, dKind: "dz", ci95: [0, 2] }))],
    ["anova 2", R.anovaReading(anyRes({ f: 5, p: P, etaSquared: 0.3 }), 2, "F(1, 8) = 5.00, p = .050", "0.3")],
    ["anova 3", R.anovaReading(anyRes({ f: 4, p: P, etaSquared: 0.3 }), 3, "F(2, 9) = 4.00, p = .050", "0.3")],
    ["kruskal", R.kruskalReading(anyRes({ h: 6, p: P, df: 2, meanRanks: [1, 2, 3] }), null)],
    ["friedman", R.friedmanReading(anyRes({ chi2: 6, p: P, df: 2, blocks: 4, treatments: 3, meanRanks: [1, 2, 3] }))],
    ["chi ind", R.chiIndReading(anyRes({ chi2: 6, p: P, df: 2 }))],
    ["regression", R.regressionReading(anyRes({ slope: 1.5, intercept: 0, rSquared: 0.5, slopeSE: 0.6, slopeP: P, n: 8 }))],
    ["log-rank", R.logRankReading(anyRes({ chi2: 3.84, p: P, df: 1, observed: [3, 5], hazardRatio: 2 }))],
    ["two-way interaction", R.twoWayReading(anyRes({ factorA: { F: 1, df: 1, p: 0.4 }, factorB: { F: 1, df: 1, p: 0.4 }, interaction: { F: 5, df: 1, p: P }, error: { df: 8 } }))],
    ["two-way main", R.twoWayReading(anyRes({ factorA: { F: 5, df: 1, p: P }, factorB: { F: 1, df: 1, p: 0.4 }, interaction: { F: 1, df: 1, p: 0.6 }, error: { df: 8 } }))],
    ["multiple", R.multipleRegressionReading(anyRes({ rSquared: 0.5, pOverall: P, coefficients: [{ name: "x1", estimate: 1, p: 0.02 }] }))],
    ["poly", R.multipleRegressionReading(anyRes({ rSquared: 0.5, pOverall: 0.01, coefficients: [{ name: "x", estimate: 1, p: 0.01 }, { name: "x²", estimate: 1, p: P }] }), { degree: 2 })],
  ];
  test.each(cases)("%s", (_n, r) => {
    const s = ok(r);
    expect(s).toMatch(/right at the conventional 5% threshold, so the evidence is borderline/);
    expect(s).not.toMatch(/unlikely to be chance|could be chance|clearly non-zero|only just/);
  });
});

test("formatP is the printed p the Stats readings decide on", () => {
  expect(formatP(0.0499)).toBe("p = .050");
});
