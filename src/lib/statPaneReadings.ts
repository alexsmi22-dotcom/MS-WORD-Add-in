/**
 * The plain-language readings of the Statistics calculators defined INLINE in taskpane.ts (STAT_CALCS): one or two
 * sentences that say what the result means (lib/calcReading.ts states the rules; readingProblems checks them).
 *
 * Each builder takes the engine's own result (and whatever the pane printed beside it) and formats every number with
 * the SAME formatter the pane's text uses (assaySig, formatP, rank-test sig6), so a number in the reading is always a
 * number on the screen. taskpane.ts cannot be imported by a test, which is why these live here: each pane entry makes
 * one call, `reading: fooReading(res)`.
 *
 * Hedging, in one place:
 *  - a test that is not significant "finds no clear evidence"; it never proves equality;
 *  - a significant omnibus test (ANOVA, Kruskal–Wallis, Friedman, log-rank with 3+ groups) says the groups differ
 *    SOMEWHERE, never which;
 *  - a regression slope, a factor in a two-way ANOVA and a hazard ratio are associations ("goes with", "differs
 *    across"), not causal effects;
 *  - THE ONE p RULE (lib/pReading.ts, calcReading.pVerdict): significance is decided on the p AS PRINTED beside the
 *    reading. Below the level is "clear"; printed exactly at the level (".050") is borderline and says
 *    BOUNDARY_CLAUSE; above it is "no clear evidence". The same printed number always gets the same words.
 */
import { assaySig } from "./assayFormat";
import { formatP, type AnovaResult, type Descriptive, type TTestResult, type UncertaintyResult, type RegressionResult } from "./stats";
import type { ChiSquareIndependence, ChiSquareResult, RankTestResult, TwoWayAnovaResult, TwoWayEffect } from "./stats2";
import type { KaplanMeierResult, LogRankResult } from "./survival";
import type { DunnettResult } from "./dunnett";
import type { TukeyResult } from "./tukey";
import type { FriedmanResult, KruskalWallisResult, DunnComparison } from "./nonparametric";
import type { NormalityResult, VarianceHomogeneityResult } from "./diagnostics";
import type { MultipleRegressionResult } from "./regression";
import { sig6 } from "./exactRank";
import { displayFormula } from "./statsDisplay";
import { READING_MAX } from "./calcReading";
import { boundaryClause, printedNumber, printedPVerdict, BOUNDARY_CLAUSE, type PVerdict } from "./pReading";
import { groupThousands } from "./regTable";

const ALPHA = 0.05;

/** Small counts in words, so a count in a sentence is never a number the result does not print. */
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export function countWord(n: number): string {
  return n >= 0 && n < WORDS.length && Number.isInteger(n) ? WORDS[n] : String(n);
}

/**
 * "k of the n" as the head of a sentence, in words: "Both" (2 of 2), "All three" (3 of 3), "One of the two",
 * "Two of the five". The caller supplies the verb, singular when `singular(k, n)`.
 */
export function ofTheCount(k: number, n: number): string {
  if (k === n) return n === 2 ? "Both" : `All ${countWord(n)}`;
  return `${capital(countWord(k))} of the ${countWord(n)}`;
}
/** Whether "ofTheCount(k, n)" takes a singular verb ("One of the two is"). */
export function ofTheSingular(k: number, n: number): boolean {
  return k === 1 && n !== 1;
}

/** "and"-joined list: "a", "a and b", "a, b and c". */
function andList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** The magnitude of a printed number: "−1.24" → "1.24" (the sign is said in words). */
function mag(s: string): string {
  return s.replace(/^[−-]/, "");
}

/** The verdict on a printed p (formatP's "p = .050", sig6, …); "none" for text that is not a p (no claim made). */
function v(printed: string, alpha = ALPHA): PVerdict | null {
  return printedPVerdict(printed, alpha);
}

/** Finite check for every number a reading prints: a non-finite value would print the em dash sentinel. */
function finite(...vs: number[]): boolean {
  return vs.every((x) => Number.isFinite(x));
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- descriptive, t-tests, ANOVA ---------------------------------------------------------------------------------

/**
 * The descriptive calculator's number format: assaySig, with every integer digit kept and grouped in threes from
 * 10,000 up to 10⁹. assaySig's 4 significant figures printed 2,345,678 as "2346000", a rounding a reader cannot see
 * (bug test R4 #10); ×10ⁿ from 10⁹ is unchanged.
 */
export function descNum(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return assaySig(x, sig);
  const a = Math.abs(x);
  if (a >= 1e4 && a < 1e9) {
    const digits = Math.floor(Math.log10(a)) + 1;
    return groupThousands(assaySig(x, Math.max(sig, digits)));
  }
  return assaySig(x, sig);
}

/** A Kaplan–Meier table time: descNum at 6 significant figures (raw `${time}` printed "1e-7" and 0.30000000000000004). */
export function survivalTime(t: number): string {
  return descNum(t, 6);
}

export function descriptiveReading(d: Descriptive): string | undefined {
  if (!finite(d.mean, d.sd, d.median, d.ci95[0], d.ci95[1])) return undefined;
  return (
    `The ${d.n} values average ${descNum(d.mean)} (SD ${descNum(d.sd)}), with a 95% confidence interval for the mean of ` +
    `${descNum(d.ci95[0])} to ${descNum(d.ci95[1])}; the median, the middle of the sorted values, is ${descNum(d.median)}.`
  );
}

/** Two-sample t: meanDifference is mean(A) − mean(B). */
export function twoSampleReading(res: TTestResult): string | undefined {
  if (!finite(res.p, res.meanDifference)) return undefined;
  const p = formatP(res.p);
  const gap = mag(assaySig(res.meanDifference));
  const verdict = v(p);
  if (verdict === "clear") {
    const [hi, lo] = res.meanDifference > 0 ? ["A", "B"] : ["B", "A"];
    return `Group ${hi} averages ${gap} higher than group ${lo} (${p}), a difference unlikely to be chance at the 5% level.`;
  }
  if (verdict === "borderline") return `The gap of ${gap} between the means of groups A and B (${p}) is ${BOUNDARY_CLAUSE}.`;
  return `The data show no clear difference between groups A and B (${p}); the gap of ${gap} in their means could be chance.`;
}

/** Paired t: meanDifference is the mean of (condition 1 − condition 2). */
export function pairedReading(res: TTestResult): string | undefined {
  if (!finite(res.p, res.meanDifference)) return undefined;
  const p = formatP(res.p);
  const gap = mag(assaySig(res.meanDifference));
  const verdict = v(p);
  if (verdict === "clear") {
    const [hi, lo] = res.meanDifference > 0 ? ["1", "2"] : ["2", "1"];
    return `On average condition ${hi} is ${gap} higher than condition ${lo} for the same subject (${p}), a change unlikely to be chance at the 5% level.`;
  }
  if (verdict === "borderline") return `The average paired difference of ${gap} between the two conditions (${p}) is ${BOUNDARY_CLAUSE}.`;
  return `The paired data show no clear change between the two conditions (${p}); the average difference of ${gap} could be chance.`;
}

/** One-way ANOVA: `etaText` is the η² exactly as the pane printed it; `f` is reportF's "F(…) = …, p = …". */
export function anovaReading(res: AnovaResult, k: number, f: string, etaText: string): string | undefined {
  if (!finite(res.p)) return undefined;
  const share = Number.isFinite(res.etaSquared) ? `; group membership accounts for η² = ${etaText} of the variation` : "";
  const verdict = v(formatP(res.p));
  if (verdict === "clear") {
    // With two groups the omnibus test IS the pairwise comparison, so there is no "which" left to ask.
    if (k === 2) return `The two group means differ (${f})${share}, a difference unlikely to be chance at the 5% level.`;
    return `At least one of the ${countWord(k)} group means differs from the others (${f})${share}. The test does not say which groups differ; a post-hoc test such as Tukey HSD does.`;
  }
  if (verdict === "borderline") {
    return k === 2
      ? `The difference between the two group means (${f}) is ${BOUNDARY_CLAUSE}.`
      : `The differences among the ${countWord(k)} group means (${f}) are ${BOUNDARY_CLAUSE}.`;
  }
  return k === 2
    ? `The data show no clear difference between the two group means (${f}); the gap could be chance.`
    : `The data show no clear difference among the ${countWord(k)} group means (${f}); the differences could be chance.`;
}

/** Whether a Tukey pair is significant as PRINTED (formatP at the family-wise level): the star and the reading agree. */
export function tukeyPairClear(p: number, alpha: number): boolean {
  return v(formatP(p), alpha) === "clear";
}

export function tukeyReading(res: TukeyResult): string | undefined {
  const sig = res.pairs.filter((pr) => finite(pr.difference, pr.p) && tukeyPairClear(pr.p, res.alpha));
  const edge = res.pairs.filter((pr) => finite(pr.difference, pr.p) && v(formatP(pr.p), res.alpha) === "borderline");
  const total = res.pairs.length;
  const say = (pr: TukeyResult["pairs"][number]): string => {
    const [hi, lo] = pr.difference > 0 ? [pr.i + 1, pr.j + 1] : [pr.j + 1, pr.i + 1];
    return `group ${hi} is ${mag(assaySig(pr.difference))} higher than group ${lo} (${formatP(pr.p)})`;
  };
  if (!sig.length) {
    const near = edge.length
      ? `; groups ${edge[0].i + 1} and ${edge[0].j + 1} (${formatP(edge[0].p)}) are ${boundaryClause(res.alpha)}`
      : "";
    return total === 1
      ? edge.length
        ? `The difference between the two groups (${formatP(edge[0].p)}) is ${boundaryClause(res.alpha)}.`
        : `The two groups do not differ clearly (family-wise alpha = ${res.alpha}).`
      : `No pair of the ${countWord(res.k)} groups differs clearly once all ${countWord(total)} comparisons are accounted for (family-wise alpha = ${res.alpha})${near}.`;
  }
  const shown = sig.slice(0, 3).map(say);
  if (total === 1) return `At family-wise alpha = ${res.alpha}, ${shown[0]}.`;
  const more = sig.length > 3 ? `, among others` : "";
  const lead = `${ofTheCount(sig.length, total)} pairs ${ofTheSingular(sig.length, total) ? "differs" : "differ"}`;
  return `${lead} at family-wise alpha = ${res.alpha}: ${andList(shown)}${more}.`;
}

/** Whether a Dunnett comparison is significant as PRINTED (formatP, α = 0.05). */
export function dunnettClear(p: number): boolean {
  return v(formatP(p)) === "clear";
}

export function dunnettReading(res: DunnettResult): string | undefined {
  const sig = res.comparisons.filter((c) => finite(c.meanDifference, c.p) && dunnettClear(c.p));
  const edge = res.comparisons.filter((c) => finite(c.meanDifference, c.p) && v(formatP(c.p)) === "borderline");
  const k = res.comparisons.length;
  const side = (c: DunnettResult["comparisons"][number]): string =>
    `${mag(assaySig(c.meanDifference))} ${c.meanDifference > 0 ? "above" : "below"} it (${formatP(c.p)})`;
  if (!sig.length) {
    if (k === 1) {
      return edge.length
        ? `The treatment's gap from the control (${formatP(edge[0].p)}) is ${BOUNDARY_CLAUSE}.`
        : "The treatment does not differ clearly from the control; the gap could be chance.";
    }
    const near = edge.length ? `; treatment ${edge[0].treatment + 1} (${formatP(edge[0].p)}) is ${BOUNDARY_CLAUSE}` : "";
    return `No treatment differs clearly from the control once the ${countWord(k)} comparisons are accounted for${near}.`;
  }
  if (k === 1) return `The treatment differs from the control: it is ${side(sig[0])}.`;
  const shown = sig.slice(0, 3).map((c) => `treatment ${c.treatment + 1} is ${side(c)}`);
  const rest = k - sig.length;
  return (
    `${ofTheCount(sig.length, k)} treatments ${ofTheSingular(sig.length, k) ? "differs" : "differ"} from the control: ${andList(shown)}${sig.length > 3 ? ", among others" : ""}` +
    (rest > 0 ? `; the other${rest === 1 ? "" : "s"} could be chance.` : ".")
  );
}

// --- rank tests ---------------------------------------------------------------------------------------------------

/** The p the rank-test text reports: the exact two-sided p when exact, else the normal one (exactRank.rankTestLines). */
function rankP(res: RankTestResult): { p: number; text: string } | null {
  if (res.method === "degenerate") return null;
  if (res.method === "exact" && res.exact) return { p: res.exact.twoSided.value, text: `p = ${sig6(res.exact.twoSided.value)}` };
  return { p: res.pNormal, text: res.pNormal < 1e-15 ? "p < 1 × 10⁻¹⁵" : `p = ${sig6(res.pNormal)}` };
}

export function mannWhitneyReading(res: RankTestResult): string | undefined {
  const rp = rankP(res);
  if (!rp) return "Every value ties, so the ranks cannot separate the two groups and the test has nothing to detect.";
  if (!Number.isFinite(rp.p)) return undefined;
  const verdict = v(rp.text);
  if (verdict === "clear") {
    const [hi, lo] = (res.u1 ?? 0) > (res.u2 ?? 0) ? ["A", "B"] : ["B", "A"];
    return `Values in group ${hi} tend to be higher than in group ${lo} (${rp.text}), a shift unlikely to be chance at the 5% level.`;
  }
  if (verdict === "borderline") return `The shift between groups A and B (${rp.text}) is ${BOUNDARY_CLAUSE}.`;
  return `The ranks show no clear difference between groups A and B (${rp.text}); any shift between them could be chance.`;
}

export function wilcoxonReading(res: RankTestResult): string | undefined {
  const rp = rankP(res);
  if (!rp) return "The paired differences cannot be ranked apart, so the test has nothing to detect.";
  if (!Number.isFinite(rp.p)) return undefined;
  const verdict = v(rp.text);
  if (verdict === "clear") {
    const [hi, lo] = (res.wPlus ?? 0) > (res.wMinus ?? 0) ? ["1", "2"] : ["2", "1"];
    return `Condition ${hi} tends to be higher than condition ${lo} for the same subject (${rp.text}), a shift unlikely to be chance at the 5% level.`;
  }
  if (verdict === "borderline") return `The shift between the two conditions (${rp.text}) is ${BOUNDARY_CLAUSE}.`;
  return `The paired differences show no clear shift between the two conditions (${rp.text}); it could be chance.`;
}

/** Whether the Kruskal–Wallis omnibus result is clear as printed: the pane runs Dunn's follow-up only then. */
export function kruskalClear(p: number): boolean {
  return v(formatP(p)) === "clear";
}

export function kruskalReading(res: KruskalWallisResult, dunn: { ok: boolean; comparisons: DunnComparison[] } | null): string | undefined {
  if (!finite(res.h, res.p)) return undefined;
  const head = `H(${res.df}) = ${assaySig(res.h, 4)}, ${formatP(res.p)}`;
  const verdict = v(formatP(res.p));
  const k = countWord(res.meanRanks.length);
  if (verdict === "borderline") return `The differences among the ${k} groups' typical values (${head}) are ${BOUNDARY_CLAUSE}.`;
  if (verdict !== "clear") {
    return `The ${k} groups show no clear difference in their typical values (${head}); the differences could be chance.`;
  }
  const pairs = dunn && dunn.ok ? dunn.comparisons.filter((c) => dunnClear(c.pAdjusted)).map((c) => `groups ${c.a + 1} and ${c.b + 1}`) : [];
  const which = pairs.length
    ? ` The Dunn follow-up finds the clear difference${pairs.length === 1 ? "" : "s"} between ${pairs.slice(0, 3).join("; ")}${pairs.length > 3 ? ", among others" : ""}.`
    : " No single pair stands out in the Dunn follow-up.";
  return `At least one group tends to have higher or lower values than the others (${head}).${which}`;
}

/** Whether a Dunn row is significant as printed (formatP of the Holm-adjusted p): the star and the reading agree. */
export function dunnClear(pAdjusted: number): boolean {
  return v(formatP(pAdjusted)) === "clear";
}

export function friedmanReading(res: FriedmanResult): string | undefined {
  if (!finite(res.chi2, res.p) || !res.meanRanks.length) return undefined;
  const head = `χ²(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)}`;
  const verdict = v(formatP(res.p));
  if (verdict === "borderline") {
    return `Measured on the same ${res.blocks} subjects, the differences among the ${countWord(res.treatments)} conditions (${head}) are ${BOUNDARY_CLAUSE}.`;
  }
  if (verdict !== "clear") {
    return `Measured on the same ${res.blocks} subjects, the ${countWord(res.treatments)} conditions show no clear difference (${head}); the differences could be chance.`;
  }
  let top = 0;
  for (let i = 1; i < res.meanRanks.length; i++) if (res.meanRanks[i] > res.meanRanks[top]) top = i;
  const tied = res.meanRanks.filter((m) => assaySig(m, 4) === assaySig(res.meanRanks[top], 4)).length > 1;
  const lead = tied ? "" : `; condition ${top + 1} ranks highest (mean rank ${assaySig(res.meanRanks[top], 4)})`;
  return `Within the same ${res.blocks} subjects, the conditions differ somewhere (${head})${lead}.`;
}

// --- assumptions --------------------------------------------------------------------------------------------------

export function assumptionsReading(norm: NormalityResult, vh: VarianceHomogeneityResult | null, groups: number): string | undefined {
  const parts: string[] = [];
  let problem = false;
  let edge = false;
  // The one p rule (round 2 MAJOR 8): decided on the p as printed, so .0496 and .0503 (both ".050") get the same
  // borderline words instead of opposite verdicts from the raw p.
  if (norm.ok && Number.isFinite(norm.p)) {
    const p = formatP(norm.p);
    const nv = v(p);
    if (nv === "clear") {
      parts.push(`the residuals look non-normal (${p})`);
      problem = true;
    } else if (nv === "borderline") {
      parts.push(`the normality test (${p}) is ${BOUNDARY_CLAUSE}`);
      edge = true;
    } else parts.push(`no evidence against normal residuals (${p})`);
  } else parts.push("too few values to test normality, so judge it from the Q-Q plot");
  if (groups >= 2 && vh) {
    if (vh.ok && Number.isFinite(vh.p)) {
      const p = formatP(vh.p);
      const vv = v(p);
      if (vv === "clear") {
        parts.push(`the group variances differ (${p})`);
        problem = true;
      } else if (vv === "borderline") {
        parts.push(`the equal-variance test (${p}) is ${BOUNDARY_CLAUSE}`);
        edge = true;
      } else parts.push(`no evidence of unequal variances (${p})`);
    }
  }
  const tested = norm.ok && Number.isFinite(norm.p);
  const verdict = problem
    ? "A rank test or Welch's version is the safer choice."
    : edge
      ? "A rank test or Welch's version is the cautious choice."
      : tested
        ? "A t-test or ANOVA is reasonable for these data."
        : "Nothing tested here argues against a t-test or ANOVA.";
  return `${capital(parts.join("; "))}. ${verdict}`;
}

// --- regression ---------------------------------------------------------------------------------------------------

function r2Words(r2: number): string {
  return r2 >= 0.7 ? "most" : r2 >= 0.3 ? "a moderate share" : "little";
}

/**
 * Simple linear regression. `exact` is the pane's exact-fit ruling (every residual zero to rounding): the slope's
 * SE is then 0 and its p is not a test of anything, so the reading says the line passes through every point.
 */
export function regressionReading(res: RegressionResult, exact = false): string | undefined {
  if (exact) {
    if (!finite(res.slope)) return undefined;
    return `The points lie exactly on a straight line with slope ${assaySig(res.slope)} (R² = 1), so there is no scatter left to test the slope against.`;
  }
  if (!finite(res.slope, res.rSquared, res.slopeP)) return undefined;
  const r2 = `R² = ${assaySig(res.rSquared, 4)}`;
  const slope = mag(assaySig(res.slope));
  const p = formatP(res.slopeP);
  const verdict = v(p);
  if (verdict === "clear") {
    return `Each one-unit increase in x goes with y ${res.slope > 0 ? "rising" : "falling"} by about ${slope}, and the line explains ${r2Words(res.rSquared)} of the variation in y (${r2}, slope ${p}).`;
  }
  if (verdict === "borderline") {
    return `The fitted slope of ${assaySig(res.slope)} (slope ${p}, ${r2}) is ${BOUNDARY_CLAUSE}.`;
  }
  return `The data show no clear straight-line relationship between x and y (slope ${p}, ${r2}); the fitted slope of ${assaySig(res.slope)} could be chance.`;
}

/** Multiple and polynomial regression (regressionReport). `poly` names the highest-order term the reading tests. */
export function multipleRegressionReading(res: MultipleRegressionResult, poly?: { degree: number }): string | undefined {
  if (res.exactFit) {
    return "The fitted surface passes through every point exactly (R² = 1), so there is no scatter left to test the terms against.";
  }
  if (!finite(res.rSquared, res.pOverall)) return undefined;
  const r2 = `R² = ${assaySig(res.rSquared, 4)}`;
  const terms = res.coefficients.filter((c) => c.name !== "Intercept" && finite(c.estimate, c.p));
  if (poly) {
    const top = terms[terms.length - 1];
    if (!top) return undefined;
    const lead = `The degree-${poly.degree} fit explains ${r2Words(res.rSquared)} of the variation in y (${r2}).`;
    const tp = formatP(top.p);
    const verdict = v(tp);
    if (poly.degree === 1) {
      return `${lead} ${verdict === "clear" ? `The slope is clearly non-zero (${tp}).` : verdict === "borderline" ? `The slope (${tp}) is ${BOUNDARY_CLAUSE}.` : `The slope could be zero (${tp}).`}`;
    }
    if (verdict === "clear") return `${lead} Its highest term, ${top.name}, is clearly non-zero (${tp}), so a lower-degree curve would miss real shape in the data.`;
    if (verdict === "borderline") return `${lead} Its highest term, ${top.name} (${tp}), is ${BOUNDARY_CLAUSE}.`;
    return `${lead} Its highest term, ${top.name}, could be zero (${tp}), so a lower degree may describe the data as well.`;
  }
  const overall = `overall ${formatP(res.pOverall)}`;
  const best = [...terms].sort((a, b) => a.p - b.p)[0];
  const overallV = v(formatP(res.pOverall));
  const bestV = best ? v(formatP(best.p)) : null;
  const lead = `The predictors explain ${r2Words(res.rSquared)} of the variation in the response (${r2}, ${overall})`;
  if (overallV === "clear" && best && bestV === "clear") {
    return (
      `${lead}. Holding the others fixed, a one-unit rise in ${best.name} goes with a change of about ${assaySig(best.estimate)} (${formatP(best.p)}), an association rather than a proven cause.`
    );
  }
  if (overallV === "borderline") return `${lead}; the overall test is ${BOUNDARY_CLAUSE}.`;
  if (best && bestV === "borderline" && overallV === "clear") {
    return `${lead}; the clearest single predictor, ${best.name} (${formatP(best.p)}), is ${BOUNDARY_CLAUSE}.`;
  }
  // Round 2 (MINOR): the overall test is not clear but one predictor is; "none is clearly related" contradicted the
  // table. With several predictors one small p on its own is weaker evidence, so it is said with that hedge.
  if (best && bestV === "clear") {
    return `${lead}, so together they are not clearly related to it; ${best.name} on its own is (${formatP(best.p)}), but with several predictors tested one small p can be chance.`;
  }
  return `${lead}, but none is clearly related to it on its own.`;
}

// --- survival -----------------------------------------------------------------------------------------------------

export function survivalReading(res: KaplanMeierResult): string | undefined {
  const events = `${res.events} of ${res.n} subjects had the event`;
  if (res.medianSurvival !== null && Number.isFinite(res.medianSurvival)) {
    // survivalTime, as the table and the median line print it (one formatter, so 123456 is never "123500" beside it).
    return `Half the subjects are estimated to have had the event by time ${survivalTime(res.medianSurvival)} (the median survival); ${events}.`;
  }
  return `Fewer than half the subjects had the event during follow-up, so the median survival is not reached; ${events}.`;
}

export function logRankReading(res: LogRankResult): string | undefined {
  if (!finite(res.chi2, res.p)) return undefined;
  const head = `χ²(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)}`;
  const groups = res.observed.length;
  const verdict = v(formatP(res.p));
  // The hazard ratio is the pane's Peto-style estimate: stated as an estimate, never as a verdict on the group.
  const hr =
    res.hazardRatio !== null && Number.isFinite(res.hazardRatio)
      ? `; the estimated hazard ratio of group 2 to group 1 is about ${assaySig(res.hazardRatio, 3)}, pointing to ${res.hazardRatio > 1 ? "a higher" : "a lower"} risk in group 2`
      : "";
  if (verdict === "clear") {
    return groups > 2
      ? `The survival curves of the ${countWord(groups)} groups differ somewhere (${head}); the test does not say which groups differ.`
      : `The two survival curves differ (${head})${hr}.`;
  }
  if (verdict === "borderline") return `The difference between the survival curves (${head}) is ${BOUNDARY_CLAUSE}.`;
  return `The data show no clear difference between the survival curves (${head}); the gap between them could be chance.`;
}

// --- counts -------------------------------------------------------------------------------------------------------

export function chiGofReading(res: ChiSquareResult): string | undefined {
  if (!finite(res.chi2, res.p)) return undefined;
  const head = `χ² = ${assaySig(res.chi2)}, ${formatP(res.p)}`;
  const verdict = v(formatP(res.p));
  if (verdict === "clear") return `The observed counts depart from the expected pattern (${head}), a gap unlikely to be chance at the 5% level.`;
  if (verdict === "borderline") return `The departure of the observed counts from the expected pattern (${head}) is ${BOUNDARY_CLAUSE}.`;
  return `The observed counts are consistent with the expected pattern (${head}); the departures could be chance.`;
}

export function chiIndReading(res: ChiSquareIndependence): string | undefined {
  // On a 2×2 the pane tells the reader to report Fisher's exact p, so the reading uses it too.
  const p = res.pFisher !== undefined ? res.pFisher : res.p;
  if (!finite(p)) return undefined;
  const head = res.pFisher !== undefined ? `Fisher's exact ${formatP(p)}` : `χ² = ${assaySig(res.chi2)}, ${formatP(p)}`;
  const verdict = v(formatP(p));
  if (verdict === "clear") return `The rows and columns are associated (${head}): how the counts split across columns depends on the row.`;
  if (verdict === "borderline") return `The association between rows and columns (${head}) is ${BOUNDARY_CLAUSE}.`;
  return `The table shows no clear association between rows and columns (${head}); the pattern could be chance.`;
}

export function twoWayReading(res: TwoWayAnovaResult): string | undefined {
  const e = (x: TwoWayEffect): string => `F(${x.df}, ${res.error.df}) = ${assaySig(x.F)}, ${formatP(x.p)}`;
  if (!finite(res.factorA.p, res.factorB.p, res.interaction.p)) return undefined;
  const iv = v(formatP(res.interaction.p));
  if (iv === "clear") {
    return `How the mean differs across the levels of factor A depends on the level of factor B (interaction ${e(res.interaction)}), so read the cell means together rather than each factor on its own.`;
  }
  if (iv === "borderline") {
    return `The A × B interaction (${e(res.interaction)}) is ${BOUNDARY_CLAUSE}, so check the cell means together before reading either factor on its own.`;
  }
  const eff = (n: "A" | "B"): TwoWayEffect => (n === "A" ? res.factorA : res.factorB);
  const main = (["A", "B"] as const).filter((n) => v(formatP(eff(n).p)) === "clear");
  const edge = (["A", "B"] as const).filter((n) => v(formatP(eff(n).p)) === "borderline");
  let mainText = main.length
    ? main.length === 2
      ? `The mean differs across the levels of both factors (${main.map((n) => e(eff(n))).join("; ")})`
      : `The mean differs across the levels of factor ${main[0]} (${e(eff(main[0]))})`
    : "Neither factor clearly goes with a difference in the mean";
  if (edge.length) mainText += `; factor ${edge[0]} (${formatP(eff(edge[0]).p)}) is ${BOUNDARY_CLAUSE}`;
  return `${mainText}, and there is no clear interaction (${formatP(res.interaction.p)}).`;
}

// --- power, multiplicity, uncertainty -----------------------------------------------------------------------------

export function powerReading(o: {
  solveN: boolean;
  n: number;
  unit: string;
  total: number | null;
  power: number;
  target: number;
}): string | undefined {
  if (!finite(o.power)) return undefined;
  const pw = assaySig(o.power, 3);
  if (o.solveN) {
    const tot = o.total !== null ? ` (${o.total} in total)` : "";
    return `You need ${o.n} ${o.unit}${tot} to have at least a ${o.target} chance of detecting an effect of this size; at that size the power is ${pw}.`;
  }
  // Decided on the PRINTED power: 0.79966 prints "0.8", and "0.8 … would often miss" contradicted itself (R4 #5).
  return printedNumber(pw) >= 0.8
    ? `With ${o.n} ${o.unit}, the study has a ${pw} chance (power) of detecting an effect of this size, adequate by the usual standard.`
    : `With ${o.n} ${o.unit}, the study has only a ${pw} chance (power) of detecting an effect of this size, so it would often miss a real effect.`;
}

/** Whether a p printed by multcomp (assaySig, 3 significant figures) is below 0.05 as printed: its star and reading. */
export function multcompClear(p: number): boolean {
  return v(assaySig(p, 3)) === "clear";
}

export function multcompReading(raw: number[], adj: number[], methodName: string): string | undefined {
  const n = raw.length;
  const keep = raw.map((p, i) => ({ p, a: adj[i] })).filter((x) => multcompClear(x.a));
  // Round 2 (MINOR): an adjusted p printed exactly at 0.05 is borderline (the one p rule), not "does not stay below".
  const atEdge = (p: number): boolean => v(assaySig(p, 3)) === "borderline";
  const edge = adj.filter(atEdge).length;
  const lost = raw.filter((p, i) => multcompClear(p) && !multcompClear(adj[i]) && !atEdge(adj[i])).length;
  if (n === 1) {
    if (keep.length) return `After the ${methodName} correction the p-value (raw ${assaySig(raw[0], 3)}) stays below 0.05.`;
    if (edge) return `After the ${methodName} correction the p-value is ${assaySig(adj[0], 3)}, ${BOUNDARY_CLAUSE}.`;
    return `After the ${methodName} correction the p-value does not stay below 0.05${lost ? ", although it was below it before" : ""}.`;
  }
  const edgeTail = edge ? `; ${countWord(edge)} ${edge === 1 ? "is" : "are"} exactly 0.05 as printed, ${BOUNDARY_CLAUSE}` : "";
  if (!keep.length) {
    const before = lost ? `, including ${countWord(lost)} that ${lost === 1 ? "was" : "were"} below it before` : "";
    return n === 2
      ? `After the ${methodName} correction neither of the two p-values stays below 0.05${before}${edgeTail}.`
      : `After the ${methodName} correction none of the ${countWord(n)} p-values stays below 0.05${before}${edgeTail}.`;
  }
  const shown = keep.slice(0, 4).map((x) => assaySig(x.p, 3));
  return (
    `After the ${methodName} correction ${ofTheCount(keep.length, n).toLowerCase()} p-values ${ofTheSingular(keep.length, n) ? "stays" : "stay"} below 0.05 (raw ${andList(shown)}${keep.length > 4 ? ", and more" : ""})` +
    (lost ? `; ${countWord(lost)} that looked significant alone ${lost === 1 ? "does" : "do"} not survive` : "") +
    `${edgeTail}.`
  );
}

/**
 * Names the dominant uncertainty term, or says there is not one.
 *
 * WHY IT IS NOT `contributions[0].name`. The shipped default is `a*b/c` with
 * every relative uncertainty at 1%, so all three contributions are EXACTLY
 * 0.16 — mathematically tied. `propagateUncertainty` computes its partials by
 * central differences, which leaves c at 0.16000000001630724 and a and b at
 * 0.15999999998788558; the sort then ranks c first and the pane printed
 * "Largest contribution: c" beside three bars of identical length.
 *
 * A reader acts on that sentence — it is the whole point of an uncertainty
 * budget, the answer to "which measurement should I improve". Naming a winner
 * chosen by finite-difference noise is worse than declining to name one.
 *
 * The tolerance is relative and generous (0.1%), because the noise floor here
 * is a property of the differencing step, not of the user's data.
 *
 * (Moved here from taskpane.ts so the reading below uses the same tie rule as the line it sits beside.)
 */
export function dominantContributions(contributions: { name: string; contribution: number }[]): { names: string[]; all: boolean } | null {
  const finiteC = contributions.filter((c) => Number.isFinite(c.contribution) && c.contribution > 0);
  if (!finiteC.length) return null;
  const top = finiteC[0].contribution;
  const tied = finiteC.filter((c) => Math.abs(c.contribution - top) <= Math.abs(top) * 1e-3);
  return { names: tied.map((c) => c.name), all: tied.length === finiteC.length && finiteC.length > 1 };
}

export function largestContributionLine(contributions: { name: string; contribution: number }[]): string {
  const d = dominantContributions(contributions);
  if (!d) return "No term dominates: every contribution is zero or not computable.";
  if (d.all) return `No single dominant term: ${d.names.join(", ")} contribute equally.`;
  if (d.names.length > 1) return `Largest contribution: ${d.names.join(" and ")} (equal).`;
  return `Largest contribution: ${d.names[0]}`;
}

export function uncertaintyReading(formula: string, res: UncertaintyResult): string | undefined {
  if (!finite(res.value, res.uncertainty)) return undefined;
  const value = `${assaySig(res.value)} ± ${assaySig(res.uncertainty, 3)} (one standard uncertainty)`;
  const d = dominantContributions(res.contributions);
  const tail = !d
    ? "none of the inputs adds measurable uncertainty."
    : d.all
      ? `${andList(d.names)} contribute equally, so no single measurement is the one to improve.`
      : `${andList(d.names)} contribute${d.names.length === 1 ? "s" : ""} the most, so measuring ${d.names.length === 1 ? "it" : "them"} more precisely would narrow the result most.`;
  // A long typed formula (or many tied names) is dropped before the reading would break the length rule.
  return firstThatFits(
    `The result is ${displayFormula(formula)} = ${value}; ${tail}`,
    `The result is ${value}; ${tail}`,
    `The result is ${value}.`,
  );
}

/** The first candidate within the reading length limit (the last one otherwise). */
export function firstThatFits(...candidates: string[]): string {
  return candidates.find((c) => c.length <= READING_MAX) ?? candidates[candidates.length - 1];
}
