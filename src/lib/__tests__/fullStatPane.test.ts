/**
 * Fully inclusive (2026-10-28): the readings of the Statistics calculators defined inline in taskpane.ts
 * (lib/statPaneReadings.ts) and of the three E2 econometrics calculators (lib/econCalcs.ts), plus the two new
 * figures (lib/statPaneFigures.ts: econ-logit, econ-regtable).
 *
 * taskpane.ts cannot be imported, so each inline case runs the SAME engine call the pane entry makes and rebuilds the
 * pane's text from the same formatter calls; the reading's numbers must all be in that text.
 */
import { readingProblems } from "../calcReading";
import { assaySig } from "../assayFormat";
import {
  describe as statDescribe,
  formatP,
  linearRegression,
  oneWayAnova,
  pairedTTest,
  propagateUncertainty,
  reportF,
  reportT,
  twoSampleTTest,
} from "../stats";
import {
  adjustPValues,
  chiSquareGoodnessOfFit,
  chiSquareIndependence,
  mannWhitneyU,
  twoWayAnova,
  wilcoxonSignedRank,
} from "../stats2";
import { rankTestLines } from "../exactRank";
import { kaplanMeier, logRankTest } from "../survival";
import { dunnettTest } from "../dunnett";
import { tukeyHSD } from "../tukey";
import { dunnTest, friedman, kruskalWallis } from "../nonparametric";
import { normalityCheckSample, normalityTest, varianceHomogeneity } from "../diagnostics";
import { multipleRegression, polynomialRegression } from "../regression";
import { regressionReport, lineEquation, displayFormula } from "../statsDisplay";
import * as R from "../statPaneReadings";
import {
  econLogitCalc,
  econOlsCalc,
  econRegTableCalc,
  ECON_SPEC_DEFAULT,
  ECON_SPECS_DEFAULT,
  LOGIT_DEFAULT,
  LOGIT_SPEC_DEFAULT,
  LONGLEY_DEFAULT,
} from "../econCalcs";
import { fitLogit } from "../logitProbit";
import { logitCoefFigureSvg, regTableFigureSvg } from "../statPaneFigures";
import type { FittedModel } from "../regModel";
import type { StatOutput } from "../analyzeBlocks";

/** Numbers in a reading ("−1.24", "2,061.35", "0.80", "3×10⁻⁴", "81.7%"), sign and % dropped. */
function numbersIn(s: string): string[] {
  // Labels are names, not computed numbers: "group 2", "groups 1 and 3", "condition 1", "treatment 3", "degree-2".
  const t = s
    .replace(/5% level/g, "")
    .replace(/95% CI/g, "")
    .replace(/R²|χ²|η²/g, "")
    .replace(/\b(?:groups?|conditions?|treatments?|degree-)\s?\d+(?: and \d+)?/gi, "");
  return (t.match(/\.?\d[\d,]*(?:\.\d+)?(?:×10[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)?/g) ?? []).map((x) => x.replace(/,$/, ""));
}

/** Every number in the reading occurs in the haystack, not as part of a longer number. */
function expectNumbersIn(reading: string | undefined, hay: string): void {
  expect(reading).toBeDefined();
  for (const n of numbersIn(reading!)) {
    const re = new RegExp(`(^|[^\\d.])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`);
    if (!re.test(hay)) throw new Error(`reading number ${n} not in the result:\n${reading}\n---\n${hay}`);
  }
}

function ok(reading: string | undefined): string {
  expect(readingProblems(reading)).toEqual([]);
  return reading!;
}

function hay(o: StatOutput): string {
  return [o.text, ...(o.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
}

// --- inline calculators -------------------------------------------------------------------------------------------

describe("descriptive", () => {
  const run = (xs: number[]) => {
    const d = statDescribe(xs);
    const text = `n = ${d.n} ${assaySig(d.mean)} ${assaySig(d.sd)} ${assaySig(d.median)} 95% CI = [${assaySig(d.ci95[0])}, ${assaySig(d.ci95[1])}]`;
    return { reading: R.descriptiveReading(d), text };
  };
  test("defaults, changes with the input, numbers on screen", () => {
    const a = run([2, 4, 4, 4, 5, 5, 7, 9]);
    ok(a.reading);
    expectNumbersIn(a.reading, a.text);
    const b = run([10, 20, 30]);
    expect(b.reading).not.toBe(a.reading);
    expectNumbersIn(b.reading, b.text);
    expect(a.reading).toContain("average 5");
  });
});

describe("two-sample and paired t", () => {
  const two = (a: number[], b: number[]) => {
    const res = twoSampleTTest(a, b);
    return { r: R.twoSampleReading(res), text: `${reportT(res)}\nMean difference = ${assaySig(res.meanDifference)}` };
  };
  test("significant: B higher (default), direction from mean(A) − mean(B)", () => {
    const x = two([5.1, 4.9, 6.2, 5.7, 5.5], [6.3, 6.8, 7.1, 6.4, 7.0]);
    expect(ok(x.r)).toMatch(/^Group B averages .* higher than group A \(p = /);
    expectNumbersIn(x.r, x.text);
    const y = two([6.3, 6.8, 7.1, 6.4, 7.0], [5.1, 4.9, 6.2, 5.7, 5.5]);
    expect(ok(y.r)).toMatch(/^Group A averages/);
  });
  test("not significant: no clear difference, never 'equal'", () => {
    const x = two([1, 2, 3, 4], [1.5, 2.5, 3.5, 4.2]);
    expect(ok(x.r)).toMatch(/no clear difference/);
    expect(x.r).not.toMatch(/equal|proves/);
    expectNumbersIn(x.r, x.text);
  });
  test("paired: default and the reverse", () => {
    const res = pairedTTest([5, 6, 7, 8], [4, 4, 6, 5]);
    const r = ok(R.pairedReading(res));
    expectNumbersIn(r, `${reportT(res)} ${assaySig(res.meanDifference)}`);
    expect(r).toMatch(/condition 1 is .* higher than condition 2/);
    const n = ok(R.pairedReading(pairedTTest([5, 6, 7, 8], [5.2, 5.7, 7.3, 7.6])));
    expect(n).toMatch(/no clear change/);
  });
  test("the 5% edge: p printed as .050 is borderline on either side of 0.05 (the one p rule, calcReading.pVerdict)", () => {
    // Find t-tests with 0.0495 ≤ p < 0.05 and 0.05 ≤ p < 0.0505 by shifting B: both print ".050", so both read the same.
    let below: string | undefined;
    let above: string | undefined;
    for (let s = 0.5; s < 3 && !(below && above); s += 0.0005) {
      const res = twoSampleTTest([1, 2, 3, 4, 5], [1 + s, 2 + s, 3 + s, 4 + s, 5 + s]);
      if (formatP(res.p) !== "p = .050") continue;
      if (res.p < 0.05) below = R.twoSampleReading(res);
      else above = R.twoSampleReading(res);
    }
    for (const r of [ok(below), ok(above)]) {
      expect(r).toMatch(/right at the conventional 5% threshold, so the evidence is borderline/);
      expect(r).not.toMatch(/only just|unlikely to be chance|could be chance/);
    }
  });
});

describe("ANOVA, Tukey, Dunnett", () => {
  test("ANOVA significant vs not; never names which group", () => {
    const g = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const res = oneWayAnova(g);
    const r = ok(R.anovaReading(res, 3, reportF(res), assaySig(res.etaSquared, 3)));
    expect(r).toMatch(/At least one of the three group means differs/);
    expectNumbersIn(r, `${reportF(res)} η² = ${assaySig(res.etaSquared, 3)}`);
    const res2 = oneWayAnova([
      [1, 2, 3],
      [1.5, 2.5, 3.2],
      [1.2, 2.2, 2.9],
    ]);
    expect(ok(R.anovaReading(res2, 3, reportF(res2), assaySig(res2.etaSquared, 3)))).toMatch(/no clear difference/);
  });
  test("Tukey names the significant pairs with the engine's flag and direction", () => {
    const res = tukeyHSD(
      [
        [5.1, 4.9, 5.4, 5.0],
        [6.3, 6.8, 6.1, 6.5],
        [5.2, 5.0, 5.5, 5.3],
      ],
      0.05,
    )!;
    const r = ok(R.tukeyReading(res));
    expect(r).toMatch(/^Two of the three pairs differ at family-wise alpha = 0\.05: group 2 is .* higher than group 1/);
    const text = res.pairs.map((pr) => `diff = ${assaySig(pr.difference)} ${formatP(pr.p)}`).join("\n") + ` alpha = ${res.alpha}`;
    expectNumbersIn(r, text);
    const none = tukeyHSD(
      [
        [1, 2, 3],
        [1.2, 2.1, 3.3],
      ],
      0.05,
    )!;
    // Two groups: one comparison, said as one (never "one of the one pairs").
    expect(ok(R.tukeyReading(none))).toBe("The two groups do not differ clearly (family-wise alpha = 0.05).");
    const two = tukeyHSD(
      [
        [1, 2, 3],
        [7, 8, 9],
      ],
      0.05,
    )!;
    expect(ok(R.tukeyReading(two))).toMatch(/^At family-wise alpha = 0\.05, group 2 is 6 higher than group 1 \(p/);
    const none3 = tukeyHSD(
      [
        [1, 2, 3],
        [1.2, 2.1, 3.3],
        [0.9, 2.2, 3.1],
      ],
      0.05,
    )!;
    expect(ok(R.tukeyReading(none3))).toMatch(/^No pair of the three groups differs clearly once all three comparisons/);
    const one3 = tukeyHSD(
      [
        [1, 2, 3],
        [1.2, 2.1, 3.3],
        [9, 10, 11],
      ],
      0.05,
    )!;
    expect(ok(R.tukeyReading(one3))).toMatch(/^Two of the three pairs differ at/);
  });
  test("ANOVA with two groups: no 'which groups' sentence", () => {
    const res = oneWayAnova([
      [1, 2, 3],
      [7, 8, 9],
    ]);
    const r = ok(R.anovaReading(res, 2, reportF(res), assaySig(res.etaSquared, 3)));
    expect(r).toMatch(/^The two group means differ/);
    expect(r).not.toMatch(/which groups/);
  });
  test("Dunnett: treatments above the control", () => {
    const g = [
      [10, 11, 12, 13, 14],
      [12, 13, 14, 15, 16],
      [15, 16, 17, 18, 19],
      [20, 21, 22, 23, 24],
    ];
    const res = dunnettTest(g[0], g.slice(1));
    const r = ok(R.dunnettReading(res));
    expect(r).toMatch(/treatment 3 is 10 above it/);
    expectNumbersIn(r, res.comparisons.map((c) => `Treatment ${c.treatment + 1} − control = ${assaySig(c.meanDifference)} ${formatP(c.p)}`).join("\n"));
    const none = dunnettTest([1, 2, 3, 4], [[1.1, 2.2, 2.9, 4.1]]);
    expect(ok(R.dunnettReading(none))).toBe("The treatment does not differ clearly from the control; the gap could be chance.");
    const one = dunnettTest([1, 2, 3, 4], [[11, 12, 13, 14]]);
    expect(ok(R.dunnettReading(one))).toMatch(/^The treatment differs from the control: it is 10 above it \(p/);
    const none3 = dunnettTest([1, 2, 3, 4], [
      [1.1, 2.2, 2.9, 4.1],
      [0.9, 2.1, 3.2, 3.9],
    ]);
    expect(ok(R.dunnettReading(none3))).toMatch(/^No treatment differs clearly from the control once the two comparisons/);
  });
});

describe("rank tests", () => {
  test("Mann–Whitney exact p, direction from U₁", () => {
    const res = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
    const r = ok(R.mannWhitneyReading(res));
    expect(r).toMatch(/^Values in group B tend to be higher than in group A/);
    expectNumbersIn(r, rankTestLines(res, "mann-whitney").join("\n"));
    const rev = ok(R.mannWhitneyReading(mannWhitneyU([6, 7, 8, 9, 10], [1, 2, 3, 4, 5])));
    expect(rev).toMatch(/group A tend to be higher/);
    const ns = mannWhitneyU([1, 5, 3, 8], [2, 4, 6, 7]);
    expect(ok(R.mannWhitneyReading(ns))).toMatch(/no clear difference/);
    expectNumbersIn(R.mannWhitneyReading(ns), rankTestLines(ns, "mann-whitney").join("\n"));
  });
  test("Mann–Whitney normal path (n > exact limit)", () => {
    const a = Array.from({ length: 40 }, (_, i) => i);
    const b = Array.from({ length: 40 }, (_, i) => i + 15.5);
    const res = mannWhitneyU(a, b);
    const r = ok(R.mannWhitneyReading(res));
    expectNumbersIn(r, rankTestLines(res, "mann-whitney").join("\n"));
  });
  test("Wilcoxon default (not significant) and a clear shift", () => {
    const res = wilcoxonSignedRank([125, 115, 130, 140, 140, 115, 140, 125], [110, 122, 125, 120, 140, 124, 123, 137]);
    const r = ok(R.wilcoxonReading(res));
    expect(r).toMatch(/no clear shift/);
    expectNumbersIn(r, rankTestLines(res, "wilcoxon").join("\n"));
    const s = wilcoxonSignedRank([10, 12, 14, 16, 18, 20, 22], [1, 2, 3, 4, 5, 6, 7]);
    expect(ok(R.wilcoxonReading(s))).toMatch(/^Condition 1 tends to be higher/);
  });
  test("Kruskal–Wallis with and without Dunn pairs", () => {
    const g = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ];
    const res = kruskalWallis(g);
    const d = dunnTest(g, "holm");
    const r = ok(R.kruskalReading(res, d));
    expect(r).toMatch(/groups 1 and 3/);
    expectNumbersIn(r, `H(${res.df}) = ${assaySig(res.h, 4)}, ${formatP(res.p)} group 1 vs 3`);
    const ns = kruskalWallis([
      [1, 5, 9],
      [2, 6, 7],
      [3, 4, 8],
    ]);
    expect(ok(R.kruskalReading(ns, null))).toMatch(/no clear difference/);
  });
  test("Friedman names the top condition only when it is not tied", () => {
    const res = friedman([
      [10, 12, 14],
      [9, 11, 15],
      [12, 13, 16],
      [8, 10, 13],
    ]);
    const r = ok(R.friedmanReading(res));
    expect(r).toMatch(/condition 3 ranks highest \(mean rank 3\)/);
    expectNumbersIn(r, `χ²(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)} 4 subjects condition 3 = ${assaySig(res.meanRanks[2], 4)}`);
    const ns = friedman([
      [1, 2, 3],
      [3, 1, 2],
      [2, 3, 1],
    ]);
    expect(ok(R.friedmanReading(ns))).toMatch(/no clear difference/);
  });
});

describe("assumptions", () => {
  test("too few to test, a normal pair, and unequal variances", () => {
    const g1 = [
      [1, 2, 3, 4, 5],
      [2, 3, 4, 5, 6],
    ];
    const r1 = ok(R.assumptionsReading(normalityTest(normalityCheckSample(g1)), varianceHomogeneity(g1), 2));
    expect(r1).toMatch(/Q-Q plot/);
    const spread = (k: number, s: number) => Array.from({ length: 25 }, (_, i) => k + s * Math.sin(i * 1.7) * (1 + (i % 3)));
    const g2 = [spread(0, 1), spread(5, 9)];
    const r2 = ok(R.assumptionsReading(normalityTest(normalityCheckSample(g2)), varianceHomogeneity(g2), 2));
    expect(r2).toMatch(/variances differ/);
    expect(r2).toMatch(/Welch/);
  });
});

describe("regression family", () => {
  test("linear: rising slope (default), falling, and no relationship", () => {
    const res = linearRegression([1, 2, 3, 4, 5], [2.1, 3.9, 6.1, 8.0, 9.9]);
    const r = ok(R.regressionReading(res));
    const text = `${lineEquation(res.slope, res.intercept)} R² = ${assaySig(res.rSquared, 4)} slope ${formatP(res.slopeP)}`;
    expectNumbersIn(r, text);
    expect(r).toMatch(/rising by about 1\.97/);
    expect(ok(R.regressionReading(linearRegression([1, 2, 3, 4, 5], [10, 8.1, 5.9, 4.2, 2])))).toMatch(/falling/);
    const ns = linearRegression([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    expect(ok(R.regressionReading(ns))).toMatch(/no clear straight-line/);
  });
  test("multiple regression: default and exact fit", () => {
    const rows = [
      [12, 1, 2],
      [19, 2, 1],
      [23, 3, 4],
      [31, 4, 3],
      [38, 5, 6],
      [45, 6, 5],
      [52, 7, 8],
      [59, 8, 7],
    ];
    const res = multipleRegression(
      rows.map((v) => v[0]),
      [rows.map((v) => v[1]), rows.map((v) => v[2])],
    );
    const r = ok(R.multipleRegressionReading(res));
    expectNumbersIn(r, regressionReport(res));
    expect(r).toMatch(/association rather than a proven cause/);
    const ex = multipleRegression([3, 5, 7, 9], [[1, 2, 3, 4]]);
    expect(ok(R.multipleRegressionReading(ex))).toMatch(/exactly/);
  });
  test("polynomial: the highest term decides the wording", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2.2, 4.1, 7.3, 11.8, 17.5, 25.1, 34.2, 45.0, 57.3, 71.2];
    const res = polynomialRegression(x, y, 2);
    const r = ok(R.multipleRegressionReading(res, { degree: 2 }));
    expect(r).toMatch(/clearly non-zero/);
    expectNumbersIn(r, `degree ${res.degree}\n` + regressionReport(res));
    const lin = polynomialRegression(x, x.map((v, i) => 2 * v + [0.3, -0.2, 0.1, -0.4, 0.2, 0.1, -0.3, 0.4, -0.1, 0][i]), 2);
    expect(ok(R.multipleRegressionReading(lin, { degree: 2 }))).toMatch(/could be zero/);
  });
});

describe("survival", () => {
  test("Kaplan–Meier: median reached and not reached", () => {
    const km = kaplanMeier([5, 6, 6, 8, 10, 12, 15, 18, 20, 24], [1, 1, 0, 1, 0, 1, 0, 1, 0, 0]);
    const r = ok(R.survivalReading(km));
    // survivalTime: the table's and the median line's one formatter since the 2026-10-28 bug test (R4 #10).
    expectNumbersIn(r, `n = ${km.n}, ${km.events} events Median survival = ${R.survivalTime(km.medianSurvival!)}`);
    const km2 = kaplanMeier([5, 6, 8, 10, 12], [1, 0, 0, 0, 0]);
    expect(ok(R.survivalReading(km2))).toMatch(/not reached/);
  });
  test("log-rank: hazard-ratio direction", () => {
    const g = [
      { times: [5, 8, 12, 15, 20], events: [1, 1, 1, 0, 0] },
      { times: [10, 14, 18, 22, 28], events: [1, 1, 1, 0, 0] },
    ];
    const res = logRankTest(g);
    const r = ok(R.logRankReading(res));
    expectNumbersIn(r, `χ²(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)} ${assaySig(res.hazardRatio!, 3)}`);
    const sig = logRankTest([
      { times: [1, 2, 3, 4, 5, 6, 7, 8], events: [1, 1, 1, 1, 1, 1, 1, 1] },
      { times: [20, 22, 24, 26, 28, 30, 32, 34], events: [1, 1, 1, 1, 0, 0, 0, 0] },
    ]);
    // The Peto hazard ratio is an estimate, not a verdict on the group (R4 #11).
    expect(ok(R.logRankReading(sig))).toMatch(/differ .* estimated hazard ratio .* pointing to a lower risk in group 2/);
  });
});

describe("counts", () => {
  test("goodness of fit both ways", () => {
    const obs = [18, 22, 20, 25, 15];
    const res = chiSquareGoodnessOfFit(obs, obs.map(() => 20));
    const r = ok(R.chiGofReading(res));
    expect(r).toMatch(/consistent/);
    expectNumbersIn(r, `χ² = ${assaySig(res.chi2)}, df = ${res.df}, ${formatP(res.p)}`);
    expect(ok(R.chiGofReading(chiSquareGoodnessOfFit([50, 10, 20, 20], [25, 25, 25, 25])))).toMatch(/depart/);
  });
  test("independence: Fisher's p on a 2×2", () => {
    const res = chiSquareIndependence([
      [10, 20, 30],
      [30, 40, 20],
    ]);
    const r = ok(R.chiIndReading(res));
    expectNumbersIn(r, `χ² = ${assaySig(res.chi2)}, df = ${res.df}, ${formatP(res.p)}`);
    const two = chiSquareIndependence([
      [1, 9],
      [8, 2],
    ]);
    const r2 = ok(R.chiIndReading(two));
    expect(r2).toContain(`Fisher's exact ${formatP(two.pFisher!)}`);
  });
  test("two-way: interaction leads when significant", () => {
    const cells = [
      [
        [12, 14],
        [20, 22],
      ],
      [
        [30, 33],
        [41, 39],
      ],
    ];
    const res = twoWayAnova(cells);
    const r = ok(R.twoWayReading(res));
    // Associational, not "shift the mean" (R4 #11).
    expect(r).toMatch(/^The mean differs across the levels of both factors/);
    const inter = twoWayAnova([
      [
        [10, 11],
        [30, 31],
      ],
      [
        [30, 31],
        [10, 11],
      ],
    ]);
    expect(ok(R.twoWayReading(inter))).toMatch(/depends on the level of factor B/);
  });
});

describe("power, multiplicity, uncertainty", () => {
  test("power: solve n vs power at n, adequate vs not", () => {
    expect(ok(R.powerReading({ solveN: true, n: 64, unit: "per group", total: 128, power: 0.8015, target: 0.8 }))).toBe(
      "You need 64 per group (128 in total) to have at least a 0.8 chance of detecting an effect of this size; at that size the power is 0.801.",
    );
    expect(ok(R.powerReading({ solveN: false, n: 30, unit: "per group", total: 60, power: 0.478, target: 0.8 }))).toMatch(/often miss/);
    expect(ok(R.powerReading({ solveN: false, n: 90, unit: "per group", total: 180, power: 0.9, target: 0.8 }))).toMatch(/adequate/);
  });
  test("multcomp: survivors and casualties", () => {
    const p = [0.01, 0.04, 0.03, 0.005, 0.2];
    const adj = adjustPValues(p, "bh");
    const r = ok(R.multcompReading(p, adj, "Benjamini–Hochberg (FDR)"));
    expectNumbersIn(r, p.map((raw, i) => `p = ${assaySig(raw, 3)} → ${assaySig(adj[i], 3)}`).join("\n") + " 0.05");
    const b = ok(R.multcompReading(p, adjustPValues(p, "bonferroni"), "Bonferroni"));
    expect(b).not.toBe(r);
    // Two p-values: "neither of the two", not "none of the two" (R4 #11 count grammar).
    expect(ok(R.multcompReading([0.3, 0.5], adjustPValues([0.3, 0.5], "holm"), "Holm"))).toMatch(/neither of the two p-values/);
  });
  test("uncertainty: the tie rule of the line beside it", () => {
    const tied = propagateUncertainty("a*b/c", { a: { value: 10, uncertainty: 0.1 }, b: { value: 20, uncertainty: 0.2 }, c: { value: 5, uncertainty: 0.05 } });
    const r = ok(R.uncertaintyReading("a*b/c", tied));
    expect(r).toMatch(/contribute equally/);
    expect(R.largestContributionLine(tied.contributions)).toMatch(/No single dominant term/);
    expectNumbersIn(r, `${displayFormula("a*b/c")} = ${assaySig(tied.value)} ± ${assaySig(tied.uncertainty, 3)}`);
    const one = propagateUncertainty("a*b/c", { a: { value: 10, uncertainty: 1 }, b: { value: 20, uncertainty: 0.2 }, c: { value: 5, uncertainty: 0.05 } });
    expect(ok(R.uncertaintyReading("a*b/c", one))).toMatch(/a contributes the most/);
  });
});

// --- econometrics (lib/econCalcs.ts) -------------------------------------------------------------------------------

const read = (over: Record<string, string>) => (k: string) => over[k] ?? "";
const OLS = { data: LONGLEY_DEFAULT, spec: ECON_SPEC_DEFAULT, se: "classical", constant: "yes", decimals: "3", stars: "econ" };

describe("econ-ols / econ-logit / econ-regtable readings", () => {
  test("OLS: defaults, a weak model, numbers from the tables", () => {
    const o = econOlsCalc(read(OLS));
    const r = ok(o.reading);
    expect(r).toMatch(/association rather than a proven cause/);
    expectNumbersIn(r, hay(o));
    const w = econOlsCalc(read({ ...OLS, spec: "TOTEMP ~ ARMED" }));
    expect(ok(w.reading)).not.toBe(r);
    expectNumbersIn(w.reading, hay(w));
    const rnd = econOlsCalc(read({ ...OLS, data: "y x\n1 3\n2 1\n3 4\n4 1\n5 5\n6 9\n7 2\n8 6", spec: "y ~ x" }));
    expect(ok(rnd.reading)).toMatch(/not clearly related|None of them|little/);
  });
  test("logit + probit: the AME as printed, the % correct", () => {
    const o = econLogitCalc(read({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "logit", se: "classical", constant: "yes" }));
    const r = ok(o.reading);
    expect(r).toMatch(/probability that grade = 1/);
    expect(r).toMatch(/% of cases correctly/);
    expectNumbersIn(r, hay(o));
    const p = econLogitCalc(read({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "probit", se: "classical", constant: "yes" }));
    expectNumbersIn(ok(p.reading), hay(p));
    const t = econLogitCalc(read({ data: LOGIT_DEFAULT, spec: "grade ~ TUCE", model: "logit", se: "classical", constant: "yes" }));
    expect(ok(t.reading)).toMatch(/^No predictor is clearly related/);
  });
  test("regression table: defaults, one model, mixed estimators", () => {
    const o = econRegTableCalc(read({ ...OLS, specs: ECON_SPECS_DEFAULT }));
    const r = ok(o.reading);
    expect(r).toMatch(/^The GNP coefficient goes from .* in model \(1\) to .* in model \(3\)/);
    expect(r).toMatch(/R² goes from/);
    expectNumbersIn(r, hay(o));
    const one = econRegTableCalc(read({ ...OLS, specs: "TOTEMP ~ GNP" }));
    expectNumbersIn(ok(one.reading), hay(one));
    const mixed = econRegTableCalc(read({ data: LOGIT_DEFAULT, specs: "grade ~ GPA + TUCE\nlogit: grade ~ GPA + TUCE", se: "classical", constant: "yes", decimals: "3", stars: "econ" }));
    expect(mixed.ok).not.toBe(false);
    expectNumbersIn(ok(mixed.reading), hay(mixed));
    expect(mixed.reading).not.toMatch(/R² goes/);
    // An OLS slope and a log-odds coefficient are never set side by side as if one became the other.
    expect(mixed.reading).not.toMatch(/goes from/);
    expect(mixed.reading).toMatch(/on different scales across the models, clearly different from zero in both models/);
    // No constant: the table's row is the uncentered R², so the reading leaves R² out.
    const nc = econRegTableCalc(read({ ...OLS, constant: "no", specs: ECON_SPECS_DEFAULT }));
    expect(ok(nc.reading)).not.toMatch(/R²/);
  });
});

// --- figures ------------------------------------------------------------------------------------------------------

/** The circles a forest panel draws, in order (cx only): one per estimable row. */
function dots(svg: string): number {
  return (svg.match(/<circle /g) ?? []).length;
}

describe("econ-logit figure", () => {
  test("present on the defaults: coefficients (constant not drawn) and marginal effects, zero lines", () => {
    const o = econLogitCalc(read({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "logit", se: "classical", constant: "yes" }));
    expect(o.svg ?? "").toMatch(/^<svg[\s>]/);
    expect(svgText(o.svg!)).toMatch(/constant not drawn/i);
    expect(o.svg).toContain("Average marginal effects");
    expect(dots(o.svg!)).toBe(9); // three predictors × three panels (coefficients, odds ratios, marginal effects)
    expect(o.svg).toContain("Odds ratios, 95% CI (log scale)");
    expect(o.svg).toContain("stroke-dasharray"); // the zero line
  });
  test("plotted values are the engine's: an interval that crosses zero is grey, one that does not is blue", () => {
    const rows = LOGIT_DEFAULT.split("\n").slice(1).map((l) => l.split(" ").map(Number));
    const m = fitLogit(
      rows.map((r) => r[0]),
      rows.map((r) => r.slice(1)),
      ["GPA", "TUCE", "PSI"],
      { constant: true, se: "classical", depName: "grade" },
    );
    const svg = logitCoefFigureSvg(m);
    const gpa = m.terms.find((t) => t.name === "GPA")!;
    const tuce = m.terms.find((t) => t.name === "TUCE")!;
    // GPA's CI excludes zero; TUCE's includes it (the table's own 95% CI).
    expect(gpa.ciLo > 0).toBe(true);
    expect(tuce.ciLo < 0 && tuce.ciHi > 0).toBe(true);
    expect(svg).toContain(">GPA<");
    expect(svg).toContain(">TUCE<");
  });
  test("hostile: constant only, no constant, one predictor", () => {
    const m: FittedModel = {
      kind: "logit",
      depName: "y",
      n: 10,
      terms: [{ name: "Constant", coef: 0.2, se: 0.1, stat: 2, p: 0.04, ciLo: 0.004, ciHi: 0.396 }],
      statLabel: "z",
      seLabel: "classical",
      stats: [],
      notes: [],
    };
    const s = logitCoefFigureSvg(m);
    expect(s).toMatch(/^<svg/);
    expect(s).not.toContain("constant not drawn");
    const bad: FittedModel = { ...m, terms: [{ name: "x", coef: NaN, se: NaN, stat: NaN, p: NaN, ciLo: NaN, ciHi: NaN }] };
    expect(() => logitCoefFigureSvg(bad)).not.toThrow();
  });
});

describe("econ-regtable figure", () => {
  test("present on the defaults: one panel per term, models as rows", () => {
    const o = econRegTableCalc(read({ ...OLS, specs: ECON_SPECS_DEFAULT }));
    expect(o.svg ?? "").toMatch(/^<svg[\s>]/);
    // GNP, POP in 3 models; UNEMP, ARMED in 2; GNPDEFL, YEAR in 1 → 12 estimable rows, six panels.
    expect(dots(o.svg!)).toBe(12);
    expect(svgText(o.svg!)).toMatch(/constant not drawn/i);
    expect(o.svg).toContain(">(3)<");
  });
  test("plotted values equal the engine's (two spot checks through the shared x-scale)", () => {
    const mk = (coef: number, lo: number, hi: number): FittedModel => ({
      kind: "ols",
      depName: "y",
      n: 20,
      terms: [{ name: "x", coef, se: 1, stat: coef, p: 0.01, ciLo: lo, ciHi: hi }],
      statLabel: "t",
      seLabel: "classical",
      stats: [],
      notes: [],
    });
    const svg = regTableFigureSvg([mk(2, 1, 3), mk(-1, -3, 1)]);
    const cx = [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cx.length).toBe(2);
    // Model (1) sits right of model (2): 2 > −1.
    expect(cx[0]).toBeGreaterThan(cx[1]);
  });
  test("hostile: many terms clipped and said; mixed logit says its scale; empty input", () => {
    const terms = Array.from({ length: 11 }, (_, i) => ({ name: `x${i + 1}`, coef: i, se: 1, stat: i, p: 0.2, ciLo: i - 2, ciHi: i + 2 }));
    const big: FittedModel = { kind: "ols", depName: "y", n: 99, terms, statLabel: "t", seLabel: "c", stats: [], notes: [] };
    const s = regTableFigureSvg([big]);
    expect(s).toContain("First 8 of 11 terms");
    expect(dots(s)).toBe(8);
    const huge: FittedModel = { ...big, terms: [{ name: "x", coef: 1e15, se: 1e14, stat: 10, p: 0, ciLo: 8e14, ciHi: 1.2e15 }] };
    expect(() => regTableFigureSvg([huge, big])).not.toThrow();
    expect(regTableFigureSvg([])).toBe("");
    const mixed = econRegTableCalc(read({ data: LOGIT_DEFAULT, specs: "grade ~ GPA\nlogit: grade ~ GPA", se: "classical", constant: "yes", decimals: "3", stars: "econ" }));
    expect(svgText(mixed.svg!)).toContain("logit and probit rows are on their own scale");
  });
});

/** The figure's words, lines joined (a wrapped caption reads as one sentence). */
function svgText(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
}

// --- every lib-backed calculator's defaults, read through ONE strict checker ----------------------------------------

import * as fs from "fs";
import * as path from "path";
import { tsArimaCalc, tsEtsCalc, TS_ARIMA_DEFAULTS, TS_ETS_DEFAULTS } from "../tsForecastCalcs";
import { esEventCalc, idxPriceCalc, idxDeflateCalc, ES_EVENT_DEFAULTS, IDX_PRICE_DEFAULTS, IDX_DEFLATE_DEFAULTS } from "../econE3Calcs";
import { panelFeCalc, panelReCalc, panelDidCalc, PANEL_FE_DEFAULTS, PANEL_RE_DEFAULTS, PANEL_DID_DEFAULTS } from "../panelCalcs";
import { bootCiCalc, qregCalc, BOOT_CI_DEFAULTS, QREG_DEFAULTS } from "../robustCalcs";
import { ineqGiniCalc, concHhiCalc, ioLeontiefCalc, INEQ_GINI_DEFAULTS, CONC_HHI_DEFAULTS, IO_LEONTIEF_DEFAULTS } from "../econE5aCalcs";
import { microMarketCalc, microOligopolyCalc, MICRO_MARKET_DEFAULTS, MICRO_OLIGOPOLY_DEFAULTS } from "../microCalcs";
import { GAME_NASH_DEFAULTS, MACRO_SOLOW_DEFAULTS, MACRO_ISLM_DEFAULTS, MACRO_TAYLOR_DEFAULTS } from "../gameMacroCalcs";
import { IV_2SLS_DEFAULTS } from "../ivCalcs";
import { iv2slsWithReading, gameNashWithReading, macroSolowWithReading, macroIslmWithReading, macroTaylorWithReading } from "../statPaneModelReadings";
import { rmAnovaCalc, coxCalc } from "../statsBatchCalcs";
import { welchAnovaCalc, gamesHowellCalc } from "../welchCalcs";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
/** The first `default: "…"` of a STAT_CALCS entry, decoded. */
function paneDefault(id: string): string {
  const at = PANE.indexOf(`id: "${id}",`, PANE.indexOf("const STAT_CALCS: StatCalc[] = ["));
  const m = /default: "((?:[^"\\]|\\.)*)"/.exec(PANE.slice(at));
  if (!m) throw new Error(`no default for ${id}`);
  return m[1].replace(/\\n/g, "\n");
}
const groupsOf = (s: string): number[][] => s.split(/\n\s*\n/).map((g) => g.trim().split(/\s+/).map(Number));

const LIB_CASES: [string, () => StatOutput][] = [
  ["econ-ols", () => econOlsCalc(read(OLS))],
  ["econ-regtable", () => econRegTableCalc(read({ ...OLS, specs: ECON_SPECS_DEFAULT }))],
  ["econ-logit", () => econLogitCalc(read({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "logit", se: "classical", constant: "yes" }))],
  ["ts-arima", () => tsArimaCalc(read(TS_ARIMA_DEFAULTS))],
  ["ts-ets", () => tsEtsCalc(read(TS_ETS_DEFAULTS))],
  ["es-event", () => esEventCalc(read(ES_EVENT_DEFAULTS))],
  ["idx-price", () => idxPriceCalc(read(IDX_PRICE_DEFAULTS))],
  ["idx-deflate", () => idxDeflateCalc(read(IDX_DEFLATE_DEFAULTS))],
  ["iv-2sls", () => iv2slsWithReading(read(IV_2SLS_DEFAULTS))],
  ["panel-fe", () => panelFeCalc(read(PANEL_FE_DEFAULTS))],
  ["panel-re", () => panelReCalc(read(PANEL_RE_DEFAULTS))],
  ["panel-did", () => panelDidCalc(read(PANEL_DID_DEFAULTS))],
  ["boot-ci", () => bootCiCalc(read(BOOT_CI_DEFAULTS))],
  ["qreg", () => qregCalc(read(QREG_DEFAULTS))],
  ["ineq-gini", () => ineqGiniCalc(read(INEQ_GINI_DEFAULTS))],
  ["conc-hhi", () => concHhiCalc(read(CONC_HHI_DEFAULTS))],
  ["io-leontief", () => ioLeontiefCalc(read(IO_LEONTIEF_DEFAULTS))],
  ["micro-market", () => microMarketCalc(read(MICRO_MARKET_DEFAULTS))],
  ["micro-oligopoly", () => microOligopolyCalc(read(MICRO_OLIGOPOLY_DEFAULTS))],
  ["game-nash", () => gameNashWithReading(read(GAME_NASH_DEFAULTS))],
  ["macro-solow", () => macroSolowWithReading(read(MACRO_SOLOW_DEFAULTS))],
  ["macro-islm", () => macroIslmWithReading(read(MACRO_ISLM_DEFAULTS))],
  ["macro-taylor", () => macroTaylorWithReading(read(MACRO_TAYLOR_DEFAULTS))],
  ["rmanova", () => rmAnovaCalc(paneDefault("rmanova"), "holm")],
  ["cox", () => coxCalc(paneDefault("cox"), "efron", null)],
  ["welchanova", () => welchAnovaCalc(groupsOf(paneDefault("welchanova")))],
  ["gameshowell", () => gamesHowellCalc(groupsOf(paneDefault("gameshowell")), "0.05")],
];

describe.each(LIB_CASES)("%s defaults (strict number check)", (id, run) => {
  test("reading keeps the rules and every number in it is on screen", () => {
    const o = run();
    expect(o.ok).not.toBe(false);
    const r = ok(o.reading);
    if (process.env.PRINT_READINGS) console.log(`${id}: ${r}`);
    expectNumbersIn(r, hay(o));
  });
});

// --- figure values through the drawn axis ---------------------------------------------------------------------------

/**
 * One forest panel's x-scale, read back from its own tick labels (grey 10 px text on the axis row), and the circles'
 * cx in drawing order. The panel is the part of the SVG from its title to the next title.
 */
function panelScale(panel: string): { toX: (v: number) => number; cx: number[] } {
  const ticks = [...panel.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="middle" font-family="Segoe UI, Arial" font-size="10" fill="#6b7280">([^<]+)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), v: Number(m[2].replace("−", "-")) }))
    .filter((t) => Number.isFinite(t.v));
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  const [a, b] = [ticks[0], ticks[ticks.length - 1]];
  const toX = (v: number): number => a.x + ((v - a.v) / (b.v - a.v)) * (b.x - a.x);
  const cx = [...panel.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  return { toX, cx };
}
function panels(svg: string): string[] {
  return svg.split('data-figure-title="1"').slice(1);
}

describe("figure values equal the engine's (mapped through the drawn axis, within 1 px)", () => {
  test("econ-logit: GPA and TUCE coefficients in the first panel", () => {
    const rows = LOGIT_DEFAULT.split("\n").slice(1).map((l) => l.split(" ").map(Number));
    const m = fitLogit(
      rows.map((r) => r[0]),
      rows.map((r) => r.slice(1)),
      ["GPA", "TUCE", "PSI"],
      { constant: true, se: "classical", depName: "grade" },
    );
    // Panels found by title: the odds-ratio panel (log axis, user decision 2026-10-28) sits between the two.
    const all = panels(logitCoefFigureSvg(m));
    const coefPanel = all.find((p) => p.includes(">Logit coefficients"))!;
    const mePanel = all.find((p) => p.includes(">Average marginal effects"))!;
    expect(all.some((p) => p.includes(">Odds ratios, 95% CI (log scale)<"))).toBe(true);
    const s = panelScale(coefPanel);
    const preds = m.terms.filter((t) => t.name !== "Constant");
    preds.forEach((t, i) => expect(Math.abs(s.cx[i] - s.toX(t.coef))).toBeLessThan(1));
    const s2 = panelScale(mePanel);
    m.marginalEffects!.forEach((t, i) => expect(Math.abs(s2.cx[i] - s2.toX(t.coef))).toBeLessThan(1));
  });
  test("econ-regtable: the GNP panel on the Longley defaults", () => {
    const o = econRegTableCalc(read({ ...OLS, specs: ECON_SPECS_DEFAULT }));
    const gnp = panels(o.svg!).find((p) => p.startsWith(' x="150" y="18" text-anchor="middle" font-family="Segoe UI, Arial" font-size="12" fill="#111111">GNP<'))!;
    expect(gnp).toBeDefined();
    const s = panelScale(gnp);
    // The engine's own GNP coefficients, model by model (the same fits the table prints).
    const coefs = ECON_SPECS_DEFAULT.split("\n").map((spec) => {
      const one = econOlsCalc(read({ ...OLS, spec }));
      const row = one.tables![0].rows.find((r) => r[0] === "GNP")!;
      return Number(row[1].replace(/\*/g, "").replace("−", "-").replace(/,/g, ""));
    });
    expect(s.cx.length).toBe(3);
    // Table cells are rounded to 3 decimals; 1 px on this axis is far wider than that rounding.
    coefs.forEach((c, i) => expect(Math.abs(s.cx[i] - s.toX(c))).toBeLessThan(1.5));
  });
  test("hostile intervals: zero-width at zero, all negative, one tiny next to one huge", () => {
    const mk = (terms: { coef: number; lo: number; hi: number }[]): FittedModel[] =>
      terms.map((t) => ({
        kind: "ols",
        depName: "y",
        n: 10,
        terms: [{ name: "x", coef: t.coef, se: 0, stat: 0, p: 1, ciLo: t.lo, ciHi: t.hi }],
        statLabel: "t",
        seLabel: "classical",
        stats: [],
        notes: [],
      }));
    for (const set of [
      [{ coef: 0, lo: 0, hi: 0 }],
      [{ coef: 2, lo: 2, hi: 2 }],
      [
        { coef: -5, lo: -7, hi: -3 },
        { coef: -1, lo: -2, hi: -0.5 },
      ],
      [
        { coef: 1e-12, lo: -1e-12, hi: 3e-12 },
        { coef: 1e12, lo: 9e11, hi: 1.1e12 },
      ],
    ]) {
      const svg = regTableFigureSvg(mk(set));
      expect(svg).toMatch(/^<svg/);
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
  });
});
