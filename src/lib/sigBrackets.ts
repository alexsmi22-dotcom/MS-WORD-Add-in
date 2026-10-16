// Significance brackets, built ONLY from the statistics engines' own results.
//
// WHY THE CONSTRUCTORS ARE THE WHOLE POINT. A bracket with three asterisks over
// two bars is a claim that a test was run and came out p < 0.001. If a bracket
// could be built from a typed-in "***", the figure would carry a claim no engine
// ever made. So there is NO API that takes a star string or a free-standing p:
//
//   - bracketsFromTukey(TukeyResult)                  family-wise p, used as is
//   - bracketsFromPairwise([{i, j, result}], method)  TTestResult / RankTestResult,
//                                                    corrected by adjustPValues
//   - bracketsFromDunn(dunnTest result, k, method)    Dunn's post-hoc, its OWN
//                                                    adjusted p (re-derived, never
//                                                    re-corrected)
//
// Every bracket and bracket set this module creates is recorded in a module-
// private WeakSet and branded with a non-exported symbol. TypeScript is
// structural, so the brand alone stops a hand-built object only at compile time;
// the WeakSet stops it at run time (statchart refuses a set that is not in it).
// And each engine result is re-checked against ITSELF before it is accepted — a
// TTestResult whose p is not tTestP(|t|, df) is a forged or edited one, not an
// engine's. A TukeyResult gets the same level of check (v2.143.0 review — it had
// none, and a result with every p edited to 0.00001 was accepted): each p must be
// studentizedRangeP(q, k, df), each significant flag must be q > qCritical, the
// critical value must be the one α, k and df give, and each interval's width must
// be 2·qCritical·|difference|/q. Group sizes are not on the result, so q itself
// cannot be recomputed from the data — this is a check of internal consistency,
// as the t-test's is, not a re-run.
//
// α. Significance is the ENGINE'S call at the α it ran at (v2.143.0 review: a
// Tukey run at α = 0.01 drew "*" on a pair its own text called not significant).
// A bracket carries `significant`; "ns" means exactly that flag is false. The
// marks keep their standard readings: at α = 0.01 the weakest mark is "**"
// (p < 0.01); at α = 0.10 the band 0.05 ≤ p < 0.10 gets "†", never "*". At the
// default α = 0.05 every label and legend is what it always was.
//
// p FORMAT. The display contract: "p = 0.003", "p < 0.001" — never the APA
// ".003" (stats.formatP, which other reports rely on and is left alone) and never
// "0.000". A rounding that would carry a p across a star threshold (0.0496 shown
// as "0.050" beside a "*") gets more digits instead.
//
// LAYOUT. Brackets are stacked by span — narrowest lowest — and a bracket sits
// above every bracket whose extent (legs AND label) it overlaps, so no two cross
// and no two labels collide. The caller reserves `plan.heightPx` above the data
// and extends its y axis to fit (statchart does this through the axis engine).
//
// This module does NOT import statchart (import-cycle lesson) and imports the
// engines' result TYPES only, plus the two pure functions the self-checks need.

import { studentizedRangeP, studentizedRangeCritical, type TukeyResult } from "./tukey";
import type { DunnComparison } from "./nonparametric";
import { tTestP, type TTestResult } from "./stats";
import { adjustPValues, type RankTestResult, type CorrectionMethod } from "./stats2";

const BRAND: unique symbol = Symbol("sigBracket");
const SET_BRAND: unique symbol = Symbol("sigBracketSet");
const MADE = new WeakSet<object>();

export type BracketTest = "Tukey HSD" | "t-test" | "paired t-test" | "Mann–Whitney U" | "Wilcoxon signed-rank" | "Dunn";

export interface SigBracket {
  readonly [BRAND]: true;
  /** 0-based group/category indices, i < j. */
  readonly i: number;
  readonly j: number;
  /** The p the bracket reports: the engine's p, or adjustPValues' output for it. */
  readonly p: number;
  /** The engine's own p before any correction (equal to p for Tukey and for "none"). */
  readonly rawP: number;
  readonly test: BracketTest;
  /** The engine's own verdict at the set's α (Tukey: q > qCritical; Dunn: its flag; pairwise: p < α). */
  readonly significant: boolean;
}

export interface SigBracketSet {
  readonly [SET_BRAND]: true;
  readonly brackets: readonly SigBracket[];
  /** "tukey": family-wise already; otherwise the correction applied to the pairwise p's. */
  readonly correction: "tukey" | CorrectionMethod | "none";
  /** Tukey only: the number of groups the test ran on (statchart checks it against the chart). */
  readonly groupCount: number | null;
  /** The α the significance verdicts were made at (Tukey: family-wise; default 0.05). */
  readonly alpha: number;
}

/** True only for a bracket set this module built. */
export function isSigBracketSet(x: unknown): x is SigBracketSet {
  return typeof x === "object" && x !== null && MADE.has(x);
}

function validP(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;
}

function makeBracket(i: number, j: number, p: number, rawP: number, test: BracketTest, significant: boolean): SigBracket {
  const b = Object.freeze({ [BRAND]: true as const, i, j, p, rawP, test, significant });
  MADE.add(b);
  return b;
}

function checkAlpha(alpha: unknown): number {
  if (!(typeof alpha === "number" && Number.isFinite(alpha) && alpha > 0 && alpha < 1)) {
    throw new RangeError(`α = ${alpha} is not a significance level between 0 and 1`);
  }
  return alpha;
}

function makeSet(brackets: SigBracket[], correction: SigBracketSet["correction"], groupCount: number | null, alpha: number): SigBracketSet {
  const s = Object.freeze({ [SET_BRAND]: true as const, brackets: Object.freeze(brackets.slice()), correction, groupCount, alpha });
  MADE.add(s);
  return s;
}

function checkIndex(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 10000) throw new RangeError(`${name} must be a whole-number group index from 0, got ${v}`);
}

/**
 * One bracket per Tukey pair. The p values are family-wise already, so they are
 * NEVER corrected again.
 */
export function bracketsFromTukey(r: TukeyResult): SigBracketSet {
  if (!r || !Array.isArray(r.pairs) || !Number.isInteger(r.k) || r.k < 2) {
    throw new TypeError("not a Tukey HSD result (tukeyHSD returns pairs and k)");
  }
  const alpha = checkAlpha(r.alpha);
  if (!(Number.isInteger(r.dfWithin) && r.dfWithin >= 1)) throw new RangeError(`the Tukey result's df within (${r.dfWithin}) is not a whole number ≥ 1`);
  // The critical value must be the one this α, k and df give (memoised in tukey.ts,
  // so this costs nothing the engine did not already pay).
  const qc = studentizedRangeCritical(alpha, r.k, r.dfWithin);
  if (!(Number.isFinite(r.qCritical) && Math.abs(r.qCritical - qc) <= 1e-9 * Math.max(1, qc))) {
    throw new RangeError(`the Tukey result's q critical (${r.qCritical}) is not the studentized-range critical value for α = ${alpha}, k = ${r.k}, df = ${r.dfWithin} — it was edited or run at another α`);
  }
  // ZERO within-group variance: se = 0, so every q is ∞ and every p is 0 — even for
  // two identical groups. tukeyHSD's own caveat says "Do not report these p values";
  // a bracket reading "****" would report them (v2.143.0 second review).
  if (!(typeof r.mse === "number" && r.mse > 0 && Number.isFinite(r.mse))) {
    throw new RangeError(
      "the data have zero within-group variance (every replicate in every group is identical), so every q is infinite and every p is 0 — arithmetic, not evidence; Tukey p values cannot be reported here",
    );
  }
  const seen = new Set<string>();
  const out: SigBracket[] = [];
  for (const pr of r.pairs) {
    checkIndex("Tukey pair i", pr.i);
    checkIndex("Tukey pair j", pr.j);
    if (!(pr.i < pr.j && pr.j < r.k)) throw new RangeError(`Tukey pair (${pr.i}, ${pr.j}) is not i < j < k = ${r.k}`);
    if (!validP(pr.p)) throw new RangeError(`Tukey pair (${pr.i}, ${pr.j}) has p = ${pr.p}, which is not a probability`);
    const key = `${pr.i}-${pr.j}`;
    if (seen.has(key)) throw new RangeError(`Tukey pair (${pr.i}, ${pr.j}) appears twice`);
    seen.add(key);
    const why = tukeyPairProblem(pr, r);
    if (why) throw new RangeError(`Tukey pair (${pr.i}, ${pr.j}) was refused: ${why}`);
    out.push(makeBracket(pr.i, pr.j, pr.p, pr.p, "Tukey HSD", pr.significant));
  }
  if (out.length !== (r.k * (r.k - 1)) / 2) {
    throw new RangeError(`a Tukey result for k = ${r.k} groups has ${(r.k * (r.k - 1)) / 2} pairs, this one has ${out.length}`);
  }
  return makeSet(out, "tukey", r.k, alpha);
}

/** Why a Tukey pair disagrees with itself and its result, or null when it agrees. */
function tukeyPairProblem(pr: TukeyResult["pairs"][number], r: TukeyResult): string | null {
  const { q, difference } = pr;
  if (q === Infinity) return "its q is infinite (a zero standard error), which no p value can honestly report";
  if (!(q >= 0) || !Number.isFinite(q)) return `q = ${q} is not a studentized range`;
  if (!Number.isFinite(difference) || Math.abs(difference - (pr.meanI - pr.meanJ)) > 1e-9 * Math.max(1, Math.abs(pr.meanI), Math.abs(pr.meanJ))) {
    return "its difference is not meanI − meanJ";
  }
  const again = studentizedRangeP(q, r.k, r.dfWithin);
  if (!(Math.abs(again - pr.p) <= 1e-12)) return `its p (${pr.p}) is not the studentized-range p of its own q (${again})`;
  if (typeof pr.significant !== "boolean" || pr.significant !== q > r.qCritical) {
    return `its significant flag (${pr.significant}) is not q > q critical (${q} vs ${r.qCritical})`;
  }
  // The interval is difference ± qCritical·se and q = |difference|/se, so its
  // width is 2·qCritical·|difference|/q. Checked where se can be read back.
  //
  // TOLERANCES ARE IN TWO PARTS. ciLow and ciHigh are each rounded to their own
  // ULP, so ciHigh − ciLow and (ciHigh + ciLow)/2 carry an ABSOLUTE error of about
  // one ULP of the larger endpoint — which, on large-offset data (means near 1e9,
  // intervals 0.01 wide), is far more than 1e−9 of the width. The old check
  // scaled to the width alone and refused genuine tukeyHSD results (v2.143.0
  // second review). So: 1e−9 relative to the quantity checked, PLUS a few ULPs of
  // the endpoints — never 1e−9 of the endpoints, which at a 1e9 offset would be a
  // tolerance of 1 against a width of 0.01 and let an edited q through.
  const width = pr.ciHigh - pr.ciLow;
  const mid = pr.ciHigh / 2 + pr.ciLow / 2; // the sum overflows near 1.8e308
  const ulps = 8 * Number.EPSILON * Math.max(Math.abs(pr.ciHigh), Math.abs(pr.ciLow)) + 8 * Number.MIN_VALUE;
  if (!Number.isFinite(width) || !Number.isFinite(mid) || width < 0) return "its confidence interval is not a finite interval";
  if (Math.abs(mid - difference) > 1e-9 * width + ulps) return "its confidence interval is not centred on its difference";
  if (q > 0) {
    const want = (2 * r.qCritical * Math.abs(difference)) / q;
    if (!(Math.abs(width - want) <= 1e-9 * want + ulps)) return "its confidence interval's width does not match its q and the critical value";
  }
  return null;
}

/**
 * Dunn's post-hoc (nonparametric.dunnTest) on `k` groups, adjusted by `correction`.
 *
 * dunnTest does not record which correction it ran, so the caller names it and
 * the result must AGREE: adjustPValues(raw p's, correction) has to reproduce every
 * pAdjusted the engine returned. A result that was run with Holm cannot be
 * bracketed as Bonferroni, and an edited pAdjusted is refused. The brackets carry
 * the engine's adjusted p; it is never corrected a second time.
 */
export function bracketsFromDunn(
  r: { ok: boolean; comparisons: DunnComparison[] },
  k: number,
  correction: CorrectionMethod,
  alphaIn = 0.05,
): SigBracketSet {
  if (!r || r.ok !== true || !Array.isArray(r.comparisons)) throw new TypeError("not a successful Dunn result (dunnTest returns ok and comparisons)");
  const alpha = checkAlpha(alphaIn);
  if (!Number.isInteger(k) || k < 2) throw new RangeError(`Dunn needs at least two groups, got k = ${k}`);
  if (!["bonferroni", "holm", "bh"].includes(correction)) throw new RangeError(`unknown correction "${correction}"`);
  const pairs = r.comparisons;
  if (pairs.length !== (k * (k - 1)) / 2) {
    throw new RangeError(`a Dunn result for k = ${k} groups has ${(k * (k - 1)) / 2} pairs, this one has ${pairs.length}`);
  }
  const seen = new Set<string>();
  for (const c of pairs) {
    checkIndex("Dunn pair a", c.a);
    checkIndex("Dunn pair b", c.b);
    if (!(c.a < c.b && c.b < k)) throw new RangeError(`Dunn pair (${c.a}, ${c.b}) is not a < b < k = ${k}`);
    if (!validP(c.p) || !validP(c.pAdjusted)) throw new RangeError(`Dunn pair (${c.a}, ${c.b}) has a p that is not a probability`);
    const key = `${c.a}-${c.b}`;
    if (seen.has(key)) throw new RangeError(`Dunn pair (${c.a}, ${c.b}) appears twice`);
    seen.add(key);
  }
  const again = adjustPValues(pairs.map((c) => c.p), correction);
  pairs.forEach((c, n) => {
    if (Math.abs(again[n] - c.pAdjusted) > 1e-12 * Math.max(1, again[n])) {
      throw new RangeError(
        `the Dunn result's adjusted p for (${c.a}, ${c.b}) is not its raw p adjusted by ${correction} — it was run with another correction or edited`,
      );
    }
    // dunnTest sets significant = pAdjusted < α; the flags must be the ones THIS α gives.
    if (c.significant !== c.pAdjusted < alpha) {
      throw new RangeError(
        `the Dunn result's significant flag for (${c.a}, ${c.b}) is not its adjusted p < α = ${alpha} — it was run at another α or edited`,
      );
    }
  });
  return makeSet(
    pairs.map((c) => makeBracket(c.a, c.b, c.pAdjusted, c.p, "Dunn", c.significant)),
    correction,
    k,
    alpha,
  );
}

export type PairwiseComparison =
  | { i: number; j: number; result: TTestResult; kind: "t" }
  | { i: number; j: number; result: RankTestResult; kind: "mann-whitney" | "wilcoxon" };

/** A TTestResult must agree with itself: p = tTestP(|t|, df). */
function tTestOk(r: TTestResult): boolean {
  if (!Number.isFinite(r.t) || !Number.isFinite(r.df) || r.df <= 0 || !validP(r.p)) return false;
  const p = tTestP(Math.abs(r.t), r.df);
  return Math.abs(p - r.p) <= 1e-12 * Math.max(1, p);
}

/** A RankTestResult's p must be the one its own `method` says it reports. */
function rankOk(r: RankTestResult, kind: "mann-whitney" | "wilcoxon"): string | null {
  if (!validP(r.p)) return `p = ${r.p} is not a probability`;
  if (r.method === "exact" && r.p !== r.pExact) return "its p is not its exact p, although it says the exact path ran";
  if (r.method === "normal" && r.p !== r.pNormal) return "its p is not its normal-approximation p";
  if (r.method === "degenerate" && r.p !== 1) return "a degenerate rank test reports p = 1";
  if (r.exact && r.exact.test !== kind) return `it is a ${r.exact.test} result, not ${kind}`;
  if (kind === "mann-whitney" && r.wPlus !== undefined) return "it carries Wilcoxon rank sums, not Mann–Whitney U";
  if (kind === "wilcoxon" && r.u1 !== undefined) return "it carries Mann–Whitney U, not Wilcoxon rank sums";
  return null;
}

/**
 * Brackets for separately-run two-group tests. `correction` is REQUIRED: with more
 * than one comparison the family-wise error grows, so the choice — including
 * "none" — is the caller's, made explicitly, and printed in the legend.
 */
export function bracketsFromPairwise(comparisons: PairwiseComparison[], correction: CorrectionMethod | "none", alphaIn = 0.05): SigBracketSet {
  if (!Array.isArray(comparisons) || comparisons.length === 0) throw new RangeError("no comparisons to bracket");
  const alpha = checkAlpha(alphaIn);
  if (!["bonferroni", "holm", "bh", "none"].includes(correction)) throw new RangeError(`unknown correction "${correction}"`);
  const seen = new Set<string>();
  const raw: Array<{ i: number; j: number; p: number; test: BracketTest }> = [];
  for (const c of comparisons) {
    checkIndex("comparison i", c.i);
    checkIndex("comparison j", c.j);
    if (c.i === c.j) throw new RangeError(`a comparison of group ${c.i} with itself is not a bracket`);
    const i = Math.min(c.i, c.j);
    const j = Math.max(c.i, c.j);
    const key = `${i}-${j}`;
    if (seen.has(key)) throw new RangeError(`groups ${i} and ${j} are compared twice`);
    seen.add(key);
    let test: BracketTest;
    if (c.kind === "t") {
      // Zero variance gives t = ±∞ (or NaN) and a p of 0 or none: arithmetic, not
      // evidence. Say so, rather than call an honest engine result "not
      // self-consistent". Paired: the DIFFERENCES are constant, not the groups.
      if (c.result && typeof c.result.t === "number" && !Number.isFinite(c.result.t)) {
        const what = c.result.dKind === "dz" ? "the paired differences have zero variance (every difference identical)" : "both groups have zero variance (every replicate identical)";
        throw new RangeError(`the t-test for (${i}, ${j}) has no reportable p value: t is ${Number.isNaN(c.result.t) ? "undefined" : "infinite"} because ${what}`);
      }
      if (!tTestOk(c.result)) throw new RangeError(`the t-test result for (${i}, ${j}) is not self-consistent (p must equal the two-tailed p of its t and df)`);
      test = c.result.dKind === "dz" ? "paired t-test" : "t-test";
    } else if (c.kind === "mann-whitney" || c.kind === "wilcoxon") {
      const why = rankOk(c.result, c.kind);
      if (why) throw new RangeError(`the rank-test result for (${i}, ${j}) was refused: ${why}`);
      test = c.kind === "mann-whitney" ? "Mann–Whitney U" : "Wilcoxon signed-rank";
    } else {
      throw new TypeError(`unknown comparison kind "${(c as { kind: unknown }).kind}"`);
    }
    raw.push({ i, j, p: c.result.p, test });
  }
  const adj = correction === "none" ? raw.map((r) => r.p) : adjustPValues(raw.map((r) => r.p), correction);
  return makeSet(
    raw.map((r, k) => makeBracket(r.i, r.j, adj[k], r.p, r.test, adj[k] < alpha)),
    correction,
    null,
    alpha,
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Star thresholds, strictest first. A p earns the first label whose bound it is BELOW. */
export const STAR_THRESHOLDS: ReadonlyArray<{ below: number; stars: string }> = Object.freeze([
  { below: 0.0001, stars: "****" },
  { below: 0.001, stars: "***" },
  { below: 0.01, stars: "**" },
  { below: 0.05, stars: "*" },
]);

/** The DEFAULT significance boundary (α = 0.05). A set carries its own α; see markBands. */
export const NS_BOUND = 0.05;

/** The mark for a significant band that no standard star can name (α > 0.05: 0.05 ≤ p < α). */
export const DAGGER = "†";

/**
 * The marks in use at `alpha`, strictest first: every standard threshold below α,
 * then α itself as the weakest band. That band takes the stars of the weakest
 * standard threshold at or above α, so every mark keeps its standard reading
 * (at α = 0.02 "*" means p < 0.02, which is still p < 0.05), and "†" when there is
 * none (α > 0.05). At α = 0.05 this is exactly STAR_THRESHOLDS.
 */
export function markBands(alpha: number = NS_BOUND): ReadonlyArray<{ below: number; stars: string }> {
  const a = checkAlpha(alpha);
  const stricter = STAR_THRESHOLDS.filter((t) => t.below < a);
  const atOrAbove = STAR_THRESHOLDS.filter((t) => t.below >= a);
  // atOrAbove is strictest first, so its first entry is the weakest standard
  // threshold at or above α (α = 0.01 → "**", α = 0.02 → "*").
  const weakest = atOrAbove.length ? atOrAbove[0].stars : DAGGER;
  return [...stricter, { below: a, stars: weakest }];
}

/** The standard mark p earns (α = 0.05). One argument, so `ps.map(starsFor)` stays safe. */
export function starsFor(p: number): string {
  return starsForAt(p, NS_BOUND);
}

/** The mark p earns at `alpha` by its value alone ("ns" at or above α). */
export function starsForAt(p: number, alpha: number): string {
  if (!validP(p)) throw new RangeError(`p = ${p} is not a probability`);
  for (const t of markBands(alpha)) if (p < t.below) return t.stars;
  return "ns";
}

/**
 * The mark a bracket shows: "ns" exactly when the ENGINE said not significant, so
 * the figure and the text agree for every pair. A pair the engine called
 * significant whose p sits on the α boundary (Tukey's flag is q > qCritical, and
 * the critical value is found by bisection) takes the weakest band's mark.
 */
export function markFor(b: SigBracket, alpha: number): string {
  if (!b.significant) return "ns";
  const bands = markBands(alpha);
  for (const t of bands) if (b.p < t.below) return t.stars;
  return bands[bands.length - 1].stars;
}

/**
 * "p = 0.003", "p < 0.001", "p > 0.999". Never ".003", never "0.000". Extra digits
 * whenever three would carry p across a mark threshold at `alpha`.
 */
export function formatPValue(p: number, alpha: number = NS_BOUND): string {
  if (!validP(p)) throw new RangeError(`p = ${p} is not a probability`);
  if (p < 0.001) return "p < 0.001";
  if (p > 0.999) return "p > 0.999";
  const cls = starsForAt(p, alpha);
  for (let d = 3; d <= 12; d++) {
    const s = p.toFixed(d);
    if (starsForAt(Number(s), alpha) === cls) return `p = ${s}`;
  }
  // Within 1e-12 of a threshold and below it: say so rather than print a rounding.
  const t = markBands(alpha).find((x) => p < x.below && cls === x.stars);
  return t ? `p < ${t.below}` : `p = ${p.toFixed(3)}`;
}

export interface BracketDisplay {
  /** "stars" (default) or the exact p in display-contract form. */
  label?: "stars" | "p";
  /** Draw non-significant brackets (default true). Hidden ones are counted in the legend. */
  showNs?: boolean;
}

function correctionName(c: SigBracketSet["correction"]): string {
  return c === "bonferroni" ? "Bonferroni" : c === "holm" ? "Holm" : c === "bh" ? "Benjamini–Hochberg (FDR)" : c;
}

/**
 * The figure note that must accompany the brackets: what the marks mean, which
 * test, and which correction. For the caption, not the artwork.
 */
export function bracketLegend(set: SigBracketSet, display: BracketDisplay = {}): string {
  if (!isSigBracketSet(set)) throw new TypeError("not a bracket set built by sigBrackets");
  const parts: string[] = [];
  if ((display.label ?? "stars") === "stars") {
    const marks = markBands(set.alpha).slice().reverse().map((t) => `${t.stars} p < ${t.below}`);
    parts.push(`${marks.join("; ")}; ns p ≥ ${set.alpha}`);
  }
  const tests = Array.from(new Set(set.brackets.map((b) => b.test)));
  const n = set.brackets.length;
  if (set.correction === "tukey") {
    const a = set.alpha !== 0.05 ? ` (run at family-wise α = ${set.alpha})` : "";
    parts.push(`Tukey HSD, ${n} pairwise comparison${n === 1 ? "" : "s"}; p values are family-wise adjusted${a}`);
  } else if (n > 1) {
    parts.push(
      `${tests.join(", ")}; ${n} comparisons, ` +
        (set.correction === "none" ? "p values NOT corrected for multiple comparisons" : `p values adjusted by ${correctionName(set.correction)}`),
    );
  } else {
    parts.push(tests.join(", "));
  }
  if (display.showNs === false) {
    const hidden = set.brackets.filter((b) => !b.significant).length;
    if (hidden) parts.push(`${hidden} non-significant comparison${hidden === 1 ? "" : "s"} not shown`);
  }
  return parts.join(". ") + ".";
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const BRACKET_FONT_PX = { stars: 11, p: 9 };
/** Leg length, gap above the data, and the vertical step between levels (px). */
export const BRACKET_LEG = 4;
export const BRACKET_GAP = 6;
const LABEL_PAD = 3;
const LABEL_H = 11;
/** Step > leg + label height + pads, so an upper bracket's legs clear a lower label. */
export const BRACKET_STEP = BRACKET_LEG + LABEL_H + LABEL_PAD + 3;

export interface StackItem {
  x1: number;
  x2: number;
  labelW: number;
}

/**
 * Level per item (0 = lowest). Narrowest span first. Each item goes on the lowest
 * level that is (a) above every STRICTLY narrower placed item whose horizontal
 * extent — legs and centred label — it touches, and (b) not the level of any
 * placed item it touches. (a) keeps a wider bracket's legs off a narrower bar;
 * (b) keeps touching brackets — including two sharing an endpoint — on different
 * levels. Two touching brackets on different levels cannot cross: a level step is
 * longer than a leg plus a label. Equal spans therefore need distinct levels, not
 * a cascade: [0,1], [1,2], [2,3] take levels 0, 1, 0.
 */
export function stackBrackets(items: StackItem[], pad = 2): number[] {
  const ext = items.map((it) => {
    const mid = (it.x1 + it.x2) / 2;
    return { lo: Math.min(it.x1, mid - it.labelW / 2), hi: Math.max(it.x2, mid + it.labelW / 2) };
  });
  const span = (k: number) => items[k].x2 - items[k].x1;
  const order = items.map((_, k) => k).sort((a, b) => span(a) - span(b) || items[a].x1 - items[b].x1 || a - b);
  const level = new Array<number>(items.length).fill(-1);
  const placed: number[] = [];
  for (const k of order) {
    let floor = 0;
    const taken = new Set<number>();
    for (const m of placed) {
      if (!(ext[k].lo <= ext[m].hi + pad && ext[m].lo <= ext[k].hi + pad)) continue;
      taken.add(level[m]);
      if (span(m) < span(k) - 1e-9) floor = Math.max(floor, level[m] + 1);
    }
    let lv = floor;
    while (taken.has(lv)) lv++;
    level[k] = lv;
    placed.push(k);
  }
  return level;
}

export interface PlannedBracket {
  bracket: SigBracket;
  x1: number;
  x2: number;
  label: string;
  fontPx: number;
  level: number;
}

export interface BracketPlan {
  items: PlannedBracket[];
  levels: number;
  /** Vertical room (px) the brackets need above the top of the data. 0 when none drawn. */
  heightPx: number;
  /** Brackets whose groups are not on the chart (beyond a cap). Counted, never silently lost. */
  offChart: number;
  /** Non-significant brackets hidden by showNs: false. */
  hiddenNs: number;
}

const estWidth = (s: string, px: number) => s.length * px * 0.62;

/**
 * Plan the brackets for a chart whose group centres are `xOf(index)` (null = that
 * group is not drawn). Throws for a set this module did not build, or a Tukey set
 * run on a different number of groups than the chart has.
 */
export function planBrackets(set: SigBracketSet, chartGroups: number, xOf: (index: number) => number | null, display: BracketDisplay = {}): BracketPlan {
  if (!isSigBracketSet(set)) throw new TypeError("brackets must come from bracketsFromTukey or bracketsFromPairwise");
  if (set.groupCount !== null && set.groupCount !== chartGroups) {
    throw new RangeError(`the ${set.brackets[0]?.test ?? "test"} result compares ${set.groupCount} groups but the chart has ${chartGroups}; the brackets would point at the wrong groups`);
  }
  const mode = display.label ?? "stars";
  const showNs = display.showNs !== false;
  const items: PlannedBracket[] = [];
  let offChart = 0;
  let hiddenNs = 0;
  for (const b of set.brackets) {
    if (!MADE.has(b)) throw new TypeError("a bracket in the set was not built by sigBrackets");
    if (b.j >= chartGroups) {
      throw new RangeError(`bracket (${b.i}, ${b.j}) refers to group ${b.j}, but the chart has ${chartGroups} groups`);
    }
    if (!showNs && !b.significant) {
      hiddenNs++;
      continue;
    }
    const x1 = xOf(b.i);
    const x2 = xOf(b.j);
    if (x1 === null || x2 === null || !Number.isFinite(x1) || !Number.isFinite(x2)) {
      offChart++;
      continue;
    }
    const label = mode === "p" ? formatPValue(b.p, set.alpha) : markFor(b, set.alpha);
    const fontPx = mode === "p" || label === "ns" ? BRACKET_FONT_PX.p : BRACKET_FONT_PX.stars;
    items.push({ bracket: b, x1: Math.min(x1, x2), x2: Math.max(x1, x2), label, fontPx, level: 0 });
  }
  const lv = stackBrackets(items.map((it) => ({ x1: it.x1, x2: it.x2, labelW: estWidth(it.label, it.fontPx) })));
  items.forEach((it, k) => (it.level = lv[k]));
  const levels = items.length ? Math.max(...lv) + 1 : 0;
  const heightPx = levels ? BRACKET_GAP + BRACKET_LEG + (levels - 1) * BRACKET_STEP + LABEL_PAD + LABEL_H + 2 : 0;
  return { items, levels, heightPx, offChart, hiddenNs };
}

const n1 = (v: number) => v.toFixed(1);
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Bar y (px) of a level, given the px y of the top of the data. */
export function bracketBarY(dataTopY: number, level: number): number {
  return dataTopY - BRACKET_GAP - BRACKET_LEG - level * BRACKET_STEP;
}

/** The markup. Each bracket is one <g data-sig-bracket="i-j" data-p="…"> with a path and a label. */
export function bracketMarkup(plan: BracketPlan, dataTopY: number, ink = "#111111"): string {
  return plan.items
    .map((it) => {
      const yb = bracketBarY(dataTopY, it.level);
      const yl = yb + BRACKET_LEG;
      const cx = (it.x1 + it.x2) / 2;
      // A white backing under the label (v2.143.0, found by the figure-layout
      // gate): the y axis is extended to fit the brackets, so its gridlines run
      // through the bracket band and struck through "****" and "p < 0.001". The
      // backing stops just above the bracket's own bar, so it hides no bracket.
      const tw = escText(it.label).length > 0 ? it.label.length * it.fontPx * 0.62 + 4 : 0;
      const ty = yb - LABEL_PAD;
      const backing = tw
        ? `<rect x="${n1(cx - tw / 2)}" y="${n1(ty - it.fontPx * 0.85)}" width="${n1(tw)}" height="${n1(it.fontPx * 1.05)}" fill="#ffffff"/>`
        : "";
      return (
        backing +
        `<g data-sig-bracket="${it.bracket.i}-${it.bracket.j}" data-p="${it.bracket.p}">` +
        `<path d="M${n1(it.x1)},${n1(yl)} L${n1(it.x1)},${n1(yb)} L${n1(it.x2)},${n1(yb)} L${n1(it.x2)},${n1(yl)}" ` +
        `fill="none" stroke="${ink}" stroke-width="1"/>` +
        `<text x="${n1(cx)}" y="${n1(yb - LABEL_PAD)}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="${it.fontPx}" fill="${ink}">${escText(it.label)}</text></g>`
      );
    })
    .join("");
}
