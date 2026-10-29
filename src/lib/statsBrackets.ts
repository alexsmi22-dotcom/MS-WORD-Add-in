// Significance brackets for the Statistics pane: the wiring between an engine
// result and a bracketed box plot, kept OUT of taskpane.ts so a test can reach it
// (no test can import the pane — the "taskpane parsers are untestable" lesson).
//
// THE ONLY WAY IN IS AN ENGINE RESULT. Each constructor below takes the object a
// statistics engine returned (twoSampleTTest, pairedTTest, mannWhitneyU,
// wilcoxonSignedRank, tukeyHSD, dunnTest) and passes it to sigBrackets, which re-checks it
// against itself. Nothing here accepts a p value, a star string or a label, so the
// pane cannot draw a bracket a test did not produce (brief §E8).
//
// FAILURES ARE MESSAGES, NOT EXCEPTIONS. boxPlotSvg throws BracketFitError when the
// brackets do not fit the plot and sigBrackets throws TypeError/RangeError for a
// result it refuses. A fit failure's message names only the remedies that can
// work for THIS figure (fitRemedy); the pane shows it as is.

import { boxPlotSvg, BOX_CHART_SIZE, BracketFitError, type BoxGroup } from "./statchart";
import { bracketsFromTukey, bracketsFromPairwise, bracketsFromDunn, bracketLegend, shownSignificant, type SigBracketSet, type BracketDisplay } from "./sigBrackets";
import type { DunnComparison } from "./nonparametric";
import type { CorrectionMethod } from "./stats2";
import type { TTestResult } from "./stats";
import type { RankTestResult } from "./stats2";
import type { TukeyResult } from "./tukey";

/** What the pane's bracket controls say. */
export interface BracketChoice {
  /** "off" draws the plain figure; "stars" or exact "p" labels otherwise. */
  label: "off" | "stars" | "p";
  /** Hide non-significant brackets (they are counted in the caption). */
  hideNs: boolean;
  /** Draw the figure 1.5× taller, to make room for many brackets. */
  tall: boolean;
}

export const BRACKETS_OFF: BracketChoice = { label: "off", hideNs: false, tall: false };

export type BracketFigure =
  | { ok: true; svg: string; caption: string }
  | { ok: false; svg: string; error: string };

/** The engine result a bracket set is built from. */
export type BracketSource =
  | { kind: "t"; result: TTestResult }
  | { kind: "mann-whitney"; result: RankTestResult }
  | { kind: "wilcoxon"; result: RankTestResult }
  | { kind: "tukey"; result: TukeyResult }
  /** Dunn's post-hoc after Kruskal–Wallis: k groups, the correction dunnTest was run with. */
  | { kind: "dunn"; result: { ok: boolean; comparisons: DunnComparison[] }; k: number; correction: CorrectionMethod };

function setFor(src: BracketSource): SigBracketSet {
  if (src.kind === "tukey") return bracketsFromTukey(src.result);
  if (src.kind === "dunn") return bracketsFromDunn(src.result, src.k, src.correction);
  // One comparison of groups 0 and 1: no correction applies, and "none" is printed.
  if (src.kind === "t") return bracketsFromPairwise([{ i: 0, j: 1, result: src.result, kind: "t" }], "none");
  return bracketsFromPairwise([{ i: 0, j: 1, result: src.result, kind: src.kind }], "none");
}

/** The canvas height for width `w`: the default aspect, 1.5× when "Taller figure" is ticked. */
function heightFor(w: number, tall: boolean): number {
  return Math.round(BOX_CHART_SIZE.h * (w / BOX_CHART_SIZE.w) * (tall ? 1.5 : 1));
}

/** The bracketed box plot at this width and choice — the ONE render both the figure and its remedies use. */
function renderBracketed(groups: BoxGroup[], opts: { title?: string; ylabel?: string }, set: SigBracketSet, choice: BracketChoice, w: number): string {
  const display: BracketDisplay = { label: choice.label === "off" ? "stars" : choice.label, showNs: !choice.hideNs };
  return boxPlotSvg(groups, { ...opts, w, h: heightFor(w, choice.tall), brackets: { set, display } });
}

/**
 * The remedies that can actually make brackets fit, and only those. Each toggle
 * that is off — "Taller figure", "Hide ns", and the two together — is offered
 * ONLY after an actual render with it fits (v2.143.0 reviews: a 6-group Tukey
 * that could not fit even 1.5× tall was told to "make the chart taller", and
 * "Hide ns" was offered untried where hiding the ns brackets freed no level).
 * When none fits, it says so; fewer comparisons and a wider figure (more room
 * per group, fewer levels) are suggested then.
 */
function fitRemedy(groups: BoxGroup[], opts: { title?: string; ylabel?: string }, set: SigBracketSet, choice: BracketChoice, w: number): string {
  const fits = (c: BracketChoice): boolean => {
    try {
      renderBracketed(groups, opts, set, c, w);
      return true;
    } catch (e) {
      if (e instanceof RangeError) return false;
      throw e;
    }
  };
  const canHide = !choice.hideNs && set.brackets.some((b) => !shownSignificant(b, set.alpha));
  const tallFits = !choice.tall && fits({ ...choice, tall: true });
  const hideFits = canHide && fits({ ...choice, hideNs: true });
  if (tallFits && hideFits) return 'tick "Taller figure" or "Hide ns"';
  if (tallFits) return 'tick "Taller figure"';
  if (hideFits) return 'tick "Hide ns"';
  if (!choice.tall && canHide && fits({ ...choice, tall: true, hideNs: true })) return 'tick both "Taller figure" and "Hide ns" (either alone is not enough)';
  const tried: string[] = [];
  if (!choice.tall) tried.push("more height (1.5×)");
  if (canHide) tried.push("hiding the ns brackets");
  const head =
    tried.length === 2
      ? "neither more height (1.5×) nor hiding the ns brackets, alone or together, makes them fit"
      : tried.length === 1
        ? `${tried[0]} does not make them fit either`
        : "";
  const rest = "compare fewer groups, or choose a wider figure (a double-column style gives each group more room)";
  return head ? `${head}; ${rest}` : rest;
}

/**
 * A box plot of `groups` with the brackets `src` supports, or — when the choice
 * is "off" — the same box plot without them. `w` is the canvas width (the figure
 * styles re-render through it); the height keeps the default aspect.
 */
export function bracketedBoxPlot(
  groups: BoxGroup[],
  opts: { title?: string; ylabel?: string },
  src: BracketSource,
  choice: BracketChoice,
  w: number = BOX_CHART_SIZE.w,
): BracketFigure {
  const plain = boxPlotSvg(groups, { ...opts, w, h: heightFor(w, choice.tall) });
  if (choice.label === "off") return { ok: true, svg: plain, caption: "" };
  const display: BracketDisplay = { label: choice.label, showNs: !choice.hideNs };
  let set: SigBracketSet | null = null;
  try {
    set = setFor(src);
    const svg = renderBracketed(groups, opts, set, choice, w);
    return { ok: true, svg, caption: bracketLegend(set, display) };
  } catch (e) {
    if (e instanceof BracketFitError && set) {
      return { ok: false, svg: plain, error: `Significance brackets could not be drawn: ${e.finding}; ${fitRemedy(groups, opts, set, choice, w)}.` };
    }
    if (e instanceof TypeError || e instanceof RangeError) {
      return { ok: false, svg: plain, error: `Significance brackets could not be drawn: ${e.message}.` };
    }
    throw e;
  }
}
