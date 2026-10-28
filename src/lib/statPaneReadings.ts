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
 *  - a significant omnibus test (ANOVA, Kruskal–Wallis, Friedman) says the groups differ SOMEWHERE, never which;
 *  - a regression slope is an association ("goes with"), not a causal effect;
 *  - significance is decided on the raw p against the level the calculator uses; a p that prints as .050 while below
 *    0.05 is called significant "only just".
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

const ALPHA = 0.05;

/** Small counts in words, so a count in a sentence is never a number the result does not print. */
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export function countWord(n: number): string {
  return n >= 0 && n < WORDS.length && Number.isInteger(n) ? WORDS[n] : String(n);
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

/** formatP's text for p, with "only just" when it rounds to .050 while still below the level. */
function edge(p: number): boolean {
  return p < ALPHA && formatP(p) === "p = .050";
}

/** "unlikely to be chance at the 5% level" (or the "only just" form). */
function chanceClause(p: number): string {
  return edge(p) ? "only just unlikely to be chance at the 5% level" : "unlikely to be chance at the 5% level";
}

/** Finite check for every number a reading prints: a non-finite value would print the em dash sentinel. */
function finite(...vs: number[]): boolean {
  return vs.every((v) => Number.isFinite(v));
}

// --- descriptive, t-tests, ANOVA ---------------------------------------------------------------------------------

export function descriptiveReading(d: Descriptive): string | undefined {
  if (!finite(d.mean, d.sd, d.median, d.ci95[0], d.ci95[1])) return undefined;
  return (
    `The ${d.n} values average ${assaySig(d.mean)} (SD ${assaySig(d.sd)}), and the true mean is likely between ` +
    `${assaySig(d.ci95[0])} and ${assaySig(d.ci95[1])} (95% CI); half the values lie at or below the median of ${assaySig(d.median)}.`
  );
}

/** Two-sample t: meanDifference is mean(A) − mean(B). */
export function twoSampleReading(res: TTestResult): string | undefined {
  if (!finite(res.p, res.meanDifference)) return undefined;
  const p = formatP(res.p);
  const gap = mag(assaySig(res.meanDifference));
  if (res.p < ALPHA) {
    const [hi, lo] = res.meanDifference > 0 ? ["A", "B"] : ["B", "A"];
    return `Group ${hi} averages ${gap} higher than group ${lo} (${p}), a difference ${chanceClause(res.p)}.`;
  }
  return `The data show no clear difference between groups A and B (${p}); the gap of ${gap} in their means could be chance.`;
}

/** Paired t: meanDifference is the mean of (condition 1 − condition 2). */
export function pairedReading(res: TTestResult): string | undefined {
  if (!finite(res.p, res.meanDifference)) return undefined;
  const p = formatP(res.p);
  const gap = mag(assaySig(res.meanDifference));
  if (res.p < ALPHA) {
    const [hi, lo] = res.meanDifference > 0 ? ["1", "2"] : ["2", "1"];
    return `On average condition ${hi} is ${gap} higher than condition ${lo} for the same subject (${p}), a change ${chanceClause(res.p)}.`;
  }
  return `The paired data show no clear change between the two conditions (${p}); the average difference of ${gap} could be chance.`;
}

/** One-way ANOVA: `etaText` is the η² exactly as the pane printed it. */
export function anovaReading(res: AnovaResult, k: number, f: string, etaText: string): string | undefined {
  if (!finite(res.p)) return undefined;
  const share = Number.isFinite(res.etaSquared) ? `; group membership accounts for η² = ${etaText} of the variation` : "";
  if (res.p < ALPHA) {
    return `At least one of the ${countWord(k)} group means differs from the others (${f})${share}. The test does not say which groups differ; a post-hoc test such as Tukey HSD does.`;
  }
  return `The data show no clear difference among the ${countWord(k)} group means (${f}); the differences could be chance.`;
}

export function tukeyReading(res: TukeyResult): string | undefined {
  const sig = res.pairs.filter((pr) => pr.significant && finite(pr.difference, pr.p));
  const total = res.pairs.length;
  if (!sig.length) {
    return `No pair of the ${countWord(res.k)} groups differs clearly once all ${countWord(total)} comparisons are accounted for (family-wise alpha = ${res.alpha}).`;
  }
  const shown = sig.slice(0, 3).map((pr) => {
    const [hi, lo] = pr.difference > 0 ? [pr.i + 1, pr.j + 1] : [pr.j + 1, pr.i + 1];
    return `group ${hi} is ${mag(assaySig(pr.difference))} higher than group ${lo} (${formatP(pr.p)})`;
  });
  const more = sig.length > 3 ? `, among others` : "";
  return (
    `${capital(countWord(sig.length))} of the ${countWord(total)} pairs differ at family-wise alpha = ${res.alpha}: ${andList(shown)}${more}.`
  );
}

export function dunnettReading(res: DunnettResult): string | undefined {
  const sig = res.comparisons.filter((c) => c.significant && finite(c.meanDifference, c.p));
  const k = res.comparisons.length;
  if (!sig.length) {
    return `No treatment differs clearly from the control once the ${countWord(k)} comparison${k === 1 ? " is" : "s are"} accounted for.`;
  }
  const shown = sig.slice(0, 3).map(
    (c) => `treatment ${c.treatment + 1} is ${mag(assaySig(c.meanDifference))} ${c.meanDifference > 0 ? "above" : "below"} it (${formatP(c.p)})`,
  );
  const rest = k - sig.length;
  return (
    `${capital(countWord(sig.length))} of the ${countWord(k)} treatments differ${sig.length === 1 ? "s" : ""} from the control: ${andList(shown)}${sig.length > 3 ? ", among others" : ""}` +
    (rest > 0 ? `; the other${rest === 1 ? "" : "s"} could be chance.` : ".")
  );
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  if (rp.p < ALPHA) {
    const [hi, lo] = (res.u1 ?? 0) > (res.u2 ?? 0) ? ["A", "B"] : ["B", "A"];
    return `Values in group ${hi} tend to be higher than in group ${lo} (${rp.text}), a shift ${chanceClause(rp.p)}.`;
  }
  return `The ranks show no clear difference between groups A and B (${rp.text}); any shift between them could be chance.`;
}

export function wilcoxonReading(res: RankTestResult): string | undefined {
  const rp = rankP(res);
  if (!rp) return "The paired differences cannot be ranked apart, so the test has nothing to detect.";
  if (!Number.isFinite(rp.p)) return undefined;
  if (rp.p < ALPHA) {
    const [hi, lo] = (res.wPlus ?? 0) > (res.wMinus ?? 0) ? ["1", "2"] : ["2", "1"];
    return `Condition ${hi} tends to be higher than condition ${lo} for the same subject (${rp.text}), a shift ${chanceClause(rp.p)}.`;
  }
  return `The paired differences show no clear shift between the two conditions (${rp.text}); it could be chance.`;
}

export function kruskalReading(res: KruskalWallisResult, dunn: { ok: boolean; comparisons: DunnComparison[] } | null): string | undefined {
  if (!finite(res.h, res.p)) return undefined;
  const head = `H(${res.df}) = ${assaySig(res.h, 4)}, ${formatP(res.p)}`;
  if (res.p >= ALPHA) {
    return `The ${countWord(res.meanRanks.length)} groups show no clear difference in their typical values (${head}); the differences could be chance.`;
  }
  const pairs = dunn && dunn.ok ? dunn.comparisons.filter((c) => c.significant).map((c) => `groups ${c.a + 1} and ${c.b + 1}`) : [];
  const which = pairs.length
    ? ` The Dunn follow-up finds the clear difference${pairs.length === 1 ? "" : "s"} between ${pairs.slice(0, 3).join("; ")}${pairs.length > 3 ? ", among others" : ""}.`
    : " No single pair stands out in the Dunn follow-up.";
  return `At least one group tends to have higher or lower values than the others (${head}).${which}`;
}

export function friedmanReading(res: FriedmanResult): string | undefined {
  if (!finite(res.chi2, res.p) || !res.meanRanks.length) return undefined;
  const head = `χ²(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)}`;
  if (res.p >= ALPHA) {
    return `Measured on the same ${res.blocks} subjects, the ${countWord(res.treatments)} conditions show no clear difference (${head}); the differences could be chance.`;
  }
  let top = 0;
  for (let i = 1; i < res.meanRanks.length; i++) if (res.meanRanks[i] > res.meanRanks[top]) top = i;
  const tied = res.meanRanks.filter((m) => m === res.meanRanks[top]).length > 1;
  const lead = tied ? "" : `; condition ${top + 1} ranks highest (mean rank ${assaySig(res.meanRanks[top], 4)})`;
  return `Within the same ${res.blocks} subjects, the conditions differ (${head})${lead}.`;
}

// --- assumptions --------------------------------------------------------------------------------------------------

export function assumptionsReading(norm: NormalityResult, vh: VarianceHomogeneityResult | null, groups: number): string | undefined {
  const parts: string[] = [];
  let problem = false;
  if (norm.ok && Number.isFinite(norm.p)) {
    if (norm.normal) parts.push(`no evidence against normal residuals (${formatP(norm.p)})`);
    else {
      parts.push(`the residuals look non-normal (${formatP(norm.p)})`);
      problem = true;
    }
  } else parts.push("too few values to test normality, so judge it from the Q-Q plot");
  if (groups >= 2 && vh) {
    if (vh.ok && Number.isFinite(vh.p)) {
      if (vh.equal) parts.push(`no evidence of unequal variances (${formatP(vh.p)})`);
      else {
        parts.push(`the group variances differ (${formatP(vh.p)})`);
        problem = true;
      }
    }
  }
  const tested = norm.ok && Number.isFinite(norm.p);
  const verdict = problem
    ? "A rank test or Welch's version is the safer choice."
    : tested
      ? "A t-test or ANOVA is reasonable for these data."
      : "Nothing tested here argues against a t-test or ANOVA.";
  return `${capital(parts.join("; "))}. ${verdict}`;
}

// --- regression ---------------------------------------------------------------------------------------------------

function r2Words(r2: number): string {
  return r2 >= 0.7 ? "most" : r2 >= 0.3 ? "a moderate share" : "little";
}

export function regressionReading(res: RegressionResult): string | undefined {
  if (!finite(res.slope, res.rSquared, res.slopeP)) return undefined;
  const r2 = `R² = ${assaySig(res.rSquared, 4)}`;
  const slope = mag(assaySig(res.slope));
  if (res.slopeP < ALPHA) {
    return `Each one-unit increase in x goes with y ${res.slope > 0 ? "rising" : "falling"} by about ${slope}, and the line explains ${r2Words(res.rSquared)} of the variation in y (${r2}, slope ${formatP(res.slopeP)}).`;
  }
  return `The data show no clear straight-line relationship between x and y (slope ${formatP(res.slopeP)}, ${r2}); the fitted slope of ${assaySig(res.slope)} could be chance.`;
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
    if (poly.degree === 1) {
      return `${lead} ${top.p < ALPHA ? `The slope is clearly non-zero (${formatP(top.p)}).` : `The slope could be zero (${formatP(top.p)}).`}`;
    }
    return top.p < ALPHA
      ? `${lead} Its highest term, ${top.name}, is clearly non-zero (${formatP(top.p)}), so a lower-degree curve would miss real shape in the data.`
      : `${lead} Its highest term, ${top.name}, could be zero (${formatP(top.p)}), so a lower degree may describe the data as well.`;
  }
  const overall = `overall ${formatP(res.pOverall)}`;
  const best = [...terms].sort((a, b) => a.p - b.p)[0];
  if (res.pOverall >= ALPHA || !best || best.p >= ALPHA) {
    return `The predictors explain ${r2Words(res.rSquared)} of the variation in the response (${r2}, ${overall}), but none is clearly related to it on its own.`;
  }
  return (
    `The predictors explain ${r2Words(res.rSquared)} of the variation in the response (${r2}, ${overall}). ` +
    `Holding the others fixed, a one-unit rise in ${best.name} goes with a change of about ${assaySig(best.estimate)} (${formatP(best.p)}), an association rather than a proven cause.`
  );
}

// --- survival -----------------------------------------------------------------------------------------------------

export function survivalReading(res: KaplanMeierResult): string | undefined {
  const events = `${res.events} of ${res.n} subjects had the event`;
  if (res.medianSurvival !== null && Number.isFinite(res.medianSurvival)) {
    return `Half the subjects are estimated to have had the event by time ${assaySig(res.medianSurvival)} (the median survival); ${events}.`;
  }
  return `Fewer than half the subjects had the event during follow-up, so the median survival is not reached; ${events}.`;
}

export function logRankReading(res: LogRankResult): string | undefined {
  if (!finite(res.chi2, res.p)) return undefined;
  const head = `χ²(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)}`;
  const hr =
    res.hazardRatio !== null && Number.isFinite(res.hazardRatio)
      ? `; group 2's hazard is ${assaySig(res.hazardRatio, 3)} times group 1's, so it does ${res.hazardRatio > 1 ? "worse" : "better"}`
      : "";
  if (res.p < ALPHA) return `The survival curves differ (${head})${hr}.`;
  return `The data show no clear difference between the survival curves (${head}); the gap between them could be chance.`;
}

// --- counts -------------------------------------------------------------------------------------------------------

export function chiGofReading(res: ChiSquareResult): string | undefined {
  if (!finite(res.chi2, res.p)) return undefined;
  const head = `χ² = ${assaySig(res.chi2)}, ${formatP(res.p)}`;
  return res.p < ALPHA
    ? `The observed counts depart from the expected pattern (${head}), a gap ${chanceClause(res.p)}.`
    : `The observed counts are consistent with the expected pattern (${head}); the departures could be chance.`;
}

export function chiIndReading(res: ChiSquareIndependence): string | undefined {
  // On a 2×2 the pane tells the reader to report Fisher's exact p, so the reading uses it too.
  const p = res.pFisher !== undefined ? res.pFisher : res.p;
  if (!finite(p)) return undefined;
  const head = res.pFisher !== undefined ? `Fisher's exact ${formatP(p)}` : `χ² = ${assaySig(res.chi2)}, ${formatP(p)}`;
  return p < ALPHA
    ? `The rows and columns are associated (${head}): how the counts split across columns depends on the row.`
    : `The table shows no clear association between rows and columns (${head}); the pattern could be chance.`;
}

export function twoWayReading(res: TwoWayAnovaResult): string | undefined {
  const e = (x: TwoWayEffect): string => `F(${x.df}, ${res.error.df}) = ${assaySig(x.F)}, ${formatP(x.p)}`;
  if (!finite(res.factorA.p, res.factorB.p, res.interaction.p)) return undefined;
  if (res.interaction.p < ALPHA) {
    return `The effect of factor A depends on the level of factor B (interaction ${e(res.interaction)}), so read the cell means together rather than each factor on its own.`;
  }
  const main = (["A", "B"] as const).filter((n) => (n === "A" ? res.factorA : res.factorB).p < ALPHA);
  const mainText = main.length
    ? `Factor${main.length === 2 ? "s A and B both shift" : ` ${main[0]} shifts`} the mean (${main.map((n) => e(n === "A" ? res.factorA : res.factorB)).join("; ")})`
    : "Neither factor clearly shifts the mean";
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
  return o.power >= 0.8
    ? `With ${o.n} ${o.unit}, the study has a ${pw} chance (power) of detecting an effect of this size, adequate by the usual standard.`
    : `With ${o.n} ${o.unit}, the study has only a ${pw} chance (power) of detecting an effect of this size, so it would often miss a real effect.`;
}

export function multcompReading(raw: number[], adj: number[], methodName: string): string | undefined {
  const keep = raw.map((p, i) => ({ p, a: adj[i] })).filter((x) => x.a < ALPHA);
  const n = raw.length;
  const lost = raw.filter((p, i) => p < ALPHA && !(adj[i] < ALPHA)).length;
  if (!keep.length) {
    return `After the ${methodName} correction none of the ${countWord(n)} p-values stays below 0.05${lost ? `, including ${countWord(lost)} that were below it before` : ""}.`;
  }
  const shown = keep.slice(0, 4).map((x) => assaySig(x.p, 3));
  return (
    `After the ${methodName} correction ${countWord(keep.length)} of the ${countWord(n)} p-values stay${keep.length === 1 ? "s" : ""} below 0.05 (raw ${andList(shown)}${keep.length > 4 ? ", and more" : ""})` +
    (lost ? `; ${countWord(lost)} that looked significant alone do${lost === 1 ? "es" : ""} not survive.` : ".")
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
