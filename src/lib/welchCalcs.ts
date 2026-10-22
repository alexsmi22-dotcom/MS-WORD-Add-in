// The two Stats calculators for UNEQUAL variances — Welch's one-way ANOVA and
// the Games–Howell post-hoc — as pure functions: parsed groups → report text
// and figure (a StatOutput).
//
// WHY THIS IS NOT IN taskpane.ts. Nothing can import the pane in a test (it
// loads Office.js), so a report builder written there is invisible to every
// test in the repo. The pane's STAT_CALCS entries `welchanova` and
// `gameshowell` call statGroups(r("groups")) — so the typed-comma note and the
// table feed work exactly as they do for One-way ANOVA and Tukey HSD — and
// then hand the groups to these functions and do nothing else.
//
// Display contract: a true minus (U+2212) on every signed number, F(2, 11.3)
// with df₂ to one decimal (as the t-tests print Welch's df), p in the same APA
// form as the ANOVA and Tukey calculators (formatP), no exponent noise, and no
// em dash in an ok result (the pane's insert gate reads it as "not computable").

import { formatP } from "./stats";
import {
  welchAnova,
  gamesHowell,
  welchNum,
  type WelchAnovaResult,
  type GamesHowellResult,
  type WelchGroupStats,
} from "./welch";
import { describeAssumptions } from "./diagnostics";
import { boxPlotSvg, forestPlotSvg } from "./statchart";
import { trueMinus } from "./numberList";
import type { StatOutput } from "./analyzeBlocks";

export { welchNum };

/** The pane's plainDashes: an em dash in a Stats result is the non-finite sentinel. */
function plainDashes(s: string): string {
  return s.replace(/—/g, "-");
}

/**
 * The shared assumption notes, made display-contract clean here: they print
 * skewness and kurtosis with a bare toFixed, so a left-skewed sample would
 * carry "skewness -0.85" (a hyphen-minus) into a result that is otherwise
 * typeset. trueMinus changes only a hyphen used as a numeric sign, never one
 * inside a name such as Brown-Forsythe.
 */
function assumptionNotes(groups: number[][]): string[] {
  return describeAssumptions(groups, { varianceHandled: true }).map((n) => trueMinus(plainDashes(n)));
}

/** A df: an integer as itself, a fractional df to one decimal (as reportT prints Welch's df). */
export function welchDf(df: number): string {
  return Number.isInteger(df) ? String(df) : df.toFixed(1);
}

/** F to two decimals (as reportF), or significant figures once it is large. */
function fText(f: number): string {
  return Math.abs(f) < 1e6 ? f.toFixed(2) : welchNum(f, 4);
}

/** "F(2, 11.3) = 8.42, p = .006". */
export function reportWelchF(r: WelchAnovaResult): string {
  return `F(${welchDf(r.df1)}, ${welchDf(r.df2)}) = ${fText(r.f)}, ${formatP(r.p)}`;
}

function groupLines(st: WelchGroupStats[]): string[] {
  return st.map((g, i) => `Group ${i + 1}: mean ${welchNum(g.mean)}, SD ${welchNum(g.sd)}, n = ${g.n}`);
}

/** "95" for α = 0.05, "99" for 0.01, "90" for 0.10. */
function ciPercent(alpha: number): string {
  return String(Number(((1 - alpha) * 100).toPrecision(6)));
}

/** Welch's ANOVA calculator: parsed groups → output. */
export function welchAnovaCalc(groups: number[][]): StatOutput {
  const res = welchAnova(groups);
  if (!res.ok) return { text: plainDashes(res.reason), ok: false };
  // varianceHandled: this test IS the remedy for unequal variances, so the
  // assumption notes must not send the user to it from inside it.
  const advice = assumptionNotes(groups);
  const lines = [
    `Welch's ANOVA (${res.k} groups; equal variances not assumed)`,
    reportWelchF(res),
    "",
    ...groupLines(res.groups),
    `Variance-weighted grand mean = ${welchNum(res.weightedMean)}`,
    "",
    ...res.caveats.map((c) => `• ${c}`),
  ];
  if (advice.length) lines.push("", ...advice);
  return {
    text: plainDashes(lines.join("\n")),
    ok: true,
    // As One-way ANOVA: the boxes show which group moved and, here, which one
    // is noisier, which is the reason this test was chosen.
    svg: boxPlotSvg(
      groups.map((g, i) => ({ label: `group ${i + 1}`, values: g })),
      { title: `Welch's ANOVA (${res.k} groups)`, ylabel: "value" },
    ),
  };
}

/** One Games–Howell row, Tukey's layout plus SE and the pair's own df. */
function pairLine(pr: GamesHowellResult["pairs"][number], pct: string): string {
  return (
    `Group ${pr.i + 1} vs ${pr.j + 1}:  diff = ${welchNum(pr.difference)}` +
    `  SE = ${welchNum(pr.se, 3)}  df = ${welchDf(pr.df)}` +
    `  q = ${welchNum(pr.q, 3)}  ${formatP(pr.p)}` +
    `  ${pct}% CI [${welchNum(pr.ciLow)}, ${welchNum(pr.ciHigh)}]` +
    (pr.significant ? "  *" : "")
  );
}

/** Parses the pane's alpha select ("0.05", "0.01", "0.10"); anything else is 0.05. */
export function readAlpha(text: string): number {
  const a = Number(text);
  return a > 0 && a < 1 ? a : 0.05;
}

/** Games–Howell calculator: parsed groups + the alpha select → output. */
export function gamesHowellCalc(groups: number[][], alphaText: string): StatOutput {
  const alpha = readAlpha(alphaText);
  const res = gamesHowell(groups, alpha);
  if (!res.ok) return { text: plainDashes(res.reason), ok: false };
  // The omnibus test alongside, as Tukey reports the ANOVA: reading a post-hoc
  // without it invites picking a pair out of a non-significant omnibus.
  const omni = welchAnova(groups);
  const omniLine = omni.ok ? `Welch's ANOVA: ${reportWelchF(omni)}` : "Welch's ANOVA: not computable for these groups";
  const pct = ciPercent(alpha);
  const anySig = res.pairs.some((p) => p.significant);
  const advice = assumptionNotes(groups);
  const lines = [
    `Games–Howell (${res.k} groups), family-wise α = ${alpha}`,
    omniLine,
    "SE = standard error of the difference, √(s₁²/n₁ + s₂²/n₂); df = Welch–Satterthwaite df for that pair; q = √2·|diff|/SE.",
    "",
    ...res.pairs.map((p) => pairLine(p, pct)),
    "",
    anySig ? `* significant at α = ${alpha}` : "No pair is significant at this level.",
    "",
    ...groupLines(res.groups),
    "",
    ...res.caveats.map((c) => `• ${c}`),
  ];
  if (advice.length) lines.push("", ...advice);
  return {
    text: plainDashes(lines.join("\n")),
    ok: true,
    // As Tukey: the intervals ARE the result, and the figure shows at once
    // which ones cross zero. Drawn from the test's own intervals, never
    // recomputed, so the chart and the table cannot disagree.
    svg: forestPlotSvg(
      res.pairs.map((p) => ({ label: `${p.i + 1} vs ${p.j + 1}`, estimate: p.difference, low: p.ciLow, high: p.ciHigh })),
      { title: `Games–Howell (${pct}% CI on each difference)`, xlabel: "difference in means", zero: 0 },
    ),
  };
}
