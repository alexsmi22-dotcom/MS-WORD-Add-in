/**
 * The two Release E2 Stats calculators, as pure functions of the field reader so jest can run them:
 *  - econ-ols       one OLS model: summary, coefficient table, diagnostics table, residual-vs-fitted figure;
 *  - econ-regtable  several OLS models side by side in the publication table (regTable.ts);
 *  - econ-logit     a logit or probit model: coefficients, average marginal effects, fit statistics.
 * taskpane.ts only declares the fields and calls these.
 *
 * Worked default: Longley (1967), the US macro series statsmodels bundles as `longley` (public domain), the classic
 * test of a regression program's numerical accuracy.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { fitOls, olsDiagnostics, type OlsFit, type SeType, type OlsDiagnostics } from "./olsInference";
import { parseRegData, parseSpec, selectColumns, type RegDataset, type RegSpec } from "./regData";
import { buildRegTable, fmtFixed, fmtP, fmtSci, starsFor, starLegend, intText, NBSP, P_BELOW, type StarScheme } from "./regTable";
import { buildPlotSvg } from "./plot";
import { fitLogit, fitProbit, fmtOddsRatio, logitProbitReport, LogitProbitRefusal, oddsRatioRows } from "./logitProbit";
import { BOUNDARY_CLAUSE, printedPVerdict } from "./pReading";
import { estimatorLabel, isLinearKind, type FittedModel, type ModelTerm } from "./regModel";
import { logitCoefFigureSvg, regTableFigureSvg } from "./statPaneFigures";
import { firstThatFits, ofTheCount, ofTheSingular } from "./statPaneReadings";
import { parseModelLine, fitModelLine } from "./regTableModels";

/** Longley (1967): total employment and six macro series, US 1947–1962 (statsmodels `longley`, public domain). */
export const LONGLEY_DEFAULT = [
  "TOTEMP GNPDEFL GNP UNEMP ARMED POP YEAR",
  "60323 83 234289 2356 1590 107608 1947",
  "61122 88.5 259426 2325 1456 108632 1948",
  "60171 88.2 258054 3682 1616 109773 1949",
  "61187 89.5 284599 3351 1650 110929 1950",
  "63221 96.2 328975 2099 3099 112075 1951",
  "63639 98.1 346999 1932 3594 113270 1952",
  "64989 99 365385 1870 3547 115094 1953",
  "63761 100 363112 3578 3350 116219 1954",
  "66019 101.2 397469 2904 3048 117388 1955",
  "67857 104.6 419180 2822 2857 118734 1956",
  "68169 108.4 442769 2936 2798 120445 1957",
  "66513 110.8 444546 4681 2637 121950 1958",
  "68655 112.6 482704 3813 2552 123366 1959",
  "69564 114.2 502601 3931 2514 125368 1960",
  "69331 115.7 518173 4806 2572 127852 1961",
  "70551 116.9 554894 4007 2827 130081 1962",
].join("\n");

export const ECON_SPEC_DEFAULT = "TOTEMP ~ GNPDEFL + GNP + UNEMP + ARMED + POP + YEAR";
export const ECON_SPECS_DEFAULT = ["TOTEMP ~ GNP + POP", "TOTEMP ~ GNP + POP + UNEMP + ARMED", ECON_SPEC_DEFAULT].join("\n");

/**
 * A synthetic teaching-method study (60 rows, seed 1980; the same data as the logit oracle's simS fixture): grade
 * (1 = improved) on GPA, a test score (TUCE) and a treatment dummy (PSI). Synthetic so it can ship.
 */
export const LOGIT_DEFAULT = [
  "grade GPA TUCE PSI",
  "0 2.56 20 0",
  "0 2.22 14 1",
  "0 2.54 25 0",
  "1 2.26 20 1",
  "0 2.25 25 0",
  "0 2.26 18 1",
  "1 2.91 34 1",
  "0 3.58 13 0",
  "1 3.59 25 1",
  "0 2.62 18 1",
  "0 3.31 31 0",
  "1 3.87 23 0",
  "1 2.64 16 0",
  "1 2.32 18 1",
  "0 2.67 22 0",
  "1 3.03 20 1",
  "0 3.2 19 0",
  "0 2.4 17 1",
  "0 2.95 24 1",
  "0 2.02 19 0",
  "1 3.42 27 1",
  "1 3.74 17 0",
  "1 3.8 16 1",
  "0 2.05 20 0",
  "0 2.5 29 0",
  "1 3.19 25 1",
  "0 2.66 21 0",
  "1 3.95 25 0",
  "0 3.76 22 0",
  "0 2.16 22 1",
  "0 2.45 21 0",
  "0 2.99 16 1",
  "0 2.1 19 1",
  "0 3.37 20 0",
  "0 2.04 27 0",
  "0 2.06 20 0",
  "0 3.02 17 0",
  "0 3.16 22 0",
  "0 2.99 23 0",
  "0 3.89 21 0",
  "0 2.1 13 1",
  "0 3.06 21 0",
  "1 3.89 18 1",
  "1 2.95 24 1",
  "0 2.05 17 0",
  "1 3.82 31 0",
  "0 2.92 31 1",
  "0 2.05 16 1",
  "0 2.22 23 0",
  "1 3.58 17 0",
  "0 2.81 25 0",
  "0 2.39 20 1",
  "1 2.53 25 0",
  "0 2.08 20 0",
  "0 2.79 23 0",
  "0 3.17 18 0",
  "1 3.83 27 0",
  "1 2.75 18 1",
  "0 2.95 24 0",
  "1 3.52 21 1",
].join("\n");

export const LOGIT_SPEC_DEFAULT = "grade ~ GPA + TUCE + PSI";

/** At most this many points in the residual figure (every m-th row beyond it, said in the text). */
export const RESID_FIGURE_MAX_POINTS = 2000;

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });

/**
 * Rows econ-ols, econ-regtable and econ-logit take (bug test 2026-10-28, R5 MAJOR 10: none had a cap; OLS took 3.6 s
 * at 100,000 rows). Measured in jest: OLS with six predictors and every diagnostic 0.6 s at 50,000 rows; logit 0.3 s.
 */
export const ECON_MAX_ROWS = 50_000;
/** Rows × model lines one regression table takes (three models of 50,000 rows measured 0.7 s). */
export const ECON_TABLE_MAX_ROW_MODELS = 200_000;

function rowsRefusal(n: number, what: string): string | null {
  return n > ECON_MAX_ROWS ? `The table has ${intText(n)} rows; ${what} takes at most ${intText(ECON_MAX_ROWS)} here. Fit a random sample of the rows.` : null;
}

interface Options {
  se: SeType;
  constant: boolean;
  cluster?: string;
  hacLag?: number;
  decimals: number;
  stars: StarScheme;
}

function readOptions(read: Read): Options | { error: string } {
  const seRaw = read("se") || "classical";
  const allowed: SeType[] = ["classical", "hc0", "hc1", "hc2", "hc3", "cluster", "hac"];
  if (!allowed.includes(seRaw as SeType)) return { error: `Unknown standard-error type ${seRaw}.` };
  const se = seRaw as SeType;
  const lagText = (read("lag") ?? "").trim();
  let hacLag: number | undefined;
  if (se === "hac" && lagText !== "") {
    const v = Number(lagText);
    if (!Number.isInteger(v) || v < 0) return { error: `Newey–West lag: “${lagText}” is not a whole number 0 or more (leave it blank for the default).` };
    hacLag = v;
  }
  const decimals = Number(read("decimals") || "3");
  const starsRaw = read("stars") || "econ";
  const stars: StarScheme = starsRaw === "sci" || starsRaw === "none" ? starsRaw : "econ";
  return {
    se,
    constant: (read("constant") || "yes") !== "no",
    cluster: se === "cluster" ? read("cluster") ?? "" : undefined,
    hacLag,
    decimals: [2, 3, 4].includes(decimals) ? decimals : 3,
    stars,
  };
}

/** Reads the data and fits one spec. */
function fitSpec(data: RegDataset, spec: RegSpec, o: Options, showsDw = false): { fit: OlsFit; notes: string[] } | { error: string } {
  const sel = selectColumns(data, spec, { cluster: o.cluster, timeOrdered: showsDw || o.se === "hac" });
  if (!sel.ok) return { error: sel.reason };
  const c = sel.cols;
  if (!c.X.length && !o.constant) return { error: "The model has no regressors: add a predictor, or include the constant." };
  const fit = fitOls({
    y: c.y,
    depName: c.depName,
    X: c.X,
    names: c.names,
    constant: o.constant,
    se: o.se,
    clusters: c.clusters,
    clusterName: c.clusterName,
    hacLag: o.hacLag,
  });
  if (!fit.ok) return { error: fit.reason };
  return { fit, notes: c.notes };
}

function conventionNotes(o: Options, named: boolean): string[] {
  const out: string[] = [];
  out.push(
    o.constant ? "Conventions: a constant is included (shown last, as Stata and esttab print it)." : "Conventions: no constant (regression through the origin).",
  );
  if (!named) out.push("The table had no header row, so its columns are named y, x1, x2… in order.");
  out.push("Rows with an empty or NA cell in a column the model uses are dropped (listwise deletion).");
  return out;
}

/** One OLS model. */
export function econOlsCalc(read: Read): StatOutput {
  const o = readOptions(read);
  if ("error" in o) return refuse(o.error);
  const parsed = parseRegData(read("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  const tooMany = rowsRefusal(parsed.data.rows.length, "OLS regression");
  if (tooMany) return refuse(tooMany);
  const spec = parseSpec(read("spec"));
  if ("error" in spec) return refuse(spec.error);
  const r = fitSpec(parsed.data, spec, o, true);
  if ("error" in r) return refuse(r.error);
  const { fit } = r;
  const m = fit.model;
  const d = o.decimals;
  const diag = olsDiagnostics(fit);
  // An ok result never carries a blank computed cell (fmtFixed writes "" for a value that is not a number).
  const bad = nonFiniteDiagnostic(diag);
  if (bad) return refuse(`${bad} is not a finite number for these data (an extreme scale or a degenerate residual pattern), so the result is not reported.`);
  const k = m.terms.filter((t) => t.name !== "Constant").length;

  const lines: string[] = [];
  lines.push(`OLS regression of ${m.depName} on ${k} predictor${k === 1 ? "" : "s"} (n = ${intText(m.n)})`);
  lines.push(`Standard errors: ${m.seLabel}`);
  lines.push(`R² = ${fmtFixed(fit.r2, 3)}, adjusted R² = ${fmtFixed(fit.adjR2, 3)}`);
  if (fit.f) lines.push(`F(${fit.f.df1}, ${fit.f.df2}) = ${fmtFixed(fit.f.value, d)}, p ${pText(fit.f.p)}`);
  else if (fit.fWhy) lines.push(fit.fWhy);
  const stat = (label: string): number => m.stats.find((s) => s.label === label)?.value ?? NaN;
  lines.push(
    `Root MSE = ${fmtFixed(stat("Root MSE"), d)} · log likelihood = ${fmtFixed(stat("Log likelihood"), d)} · ` +
      `AIC = ${fmtFixed(stat("AIC"), d)} · BIC = ${fmtFixed(stat("BIC"), d)}`,
  );
  lines.push("");
  lines.push(...conventionNotes(o, parsed.data.named), ...r.notes, ...m.notes, ...diag.notes);
  lines.push(
    "Diagnostics use the OLS residuals whatever the standard errors: Breusch–Pagan is Koenker's studentized form; " +
      "RESET adds the squared and cubed fitted values, standardised before they are raised to powers (the same F as " +
      "statsmodels' linear_reset(power=3, use_f=True) whenever its augmented design keeps full rank, and exact when " +
      "large fitted values make that design numerically singular); Jarque–Bera uses the residuals' moments.",
  );

  const coefRows: string[][] = [["Term", "Coef.", "SE", m.statLabel, "p", "95% CI"]];
  for (const t of m.terms) {
    coefRows.push([
      t.name,
      fmtFixed(t.coef, d) + starsFor(t.p, o.stars),
      fmtFixed(t.se, d),
      fmtFixed(t.stat, d),
      fmtP(t.p),
      // "; " between the bounds: a comma would be read as one more thousands separator ("[−5,657.181; 13,996.001]").
      `[${fmtFixed(t.ciLo, d)}; ${fmtFixed(t.ciHi, d)}]`,
    ]);
  }
  const tables: StatTable[] = [
    {
      label: `Coefficients: ${m.depName}, ${m.seLabel}`,
      rows: coefRows,
      // Each column one way, header included ("Coef." over its numbers, "< 0.001" with the other p-values).
      align: ["left", "right", "right", "right", "right", "right"],
      note: [
        o.stars === "none" ? "" : starLegend(o.stars).replace("Standard errors in parentheses. ", ""),
        `p-values and intervals from the t distribution with ${m.df ?? 0} df.`,
      ]
        .filter(Boolean)
        .join(" "),
    },
    { label: "Diagnostics", rows: diagnosticsRows(diag, d), align: ["left", "left", "right", "right"] },
  ];

  // Residuals against fitted values: curvature or a funnel is what the summary numbers cannot show.
  const n = fit.fitted.length;
  const step = n > RESID_FIGURE_MAX_POINTS ? Math.ceil(n / RESID_FIGURE_MAX_POINTS) : 1;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ x: fit.fitted[i], y: fit.resid[i] });
  let fmin = Infinity;
  let fmax = -Infinity;
  for (const p of pts) {
    if (p.x < fmin) fmin = p.x;
    if (p.x > fmax) fmax = p.x;
  }
  const svg = buildPlotSvg(
    [
      { type: "scatter", points: pts, color: "#0369a1" },
      { type: "line", points: [{ x: fmin, y: 0 }, { x: fmax, y: 0 }], color: "#94a3b8" },
    ],
    { width: 380, height: 250, title: "Residuals vs fitted", xlabel: `Fitted ${m.depName}`, ylabel: "Residual" },
  );
  if (step > 1) lines.push(`The figure shows every ${step}th row (${pts.length.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} points).`);
  return { text: lines.join("\n"), reading: olsReading(fit, d), svg, tables };
}

function pText(p: number): string {
  return p < 0.001 ? P_BELOW : `= ${fmtP(p)}`;
}

/** Small counts in words, so a count in a reading is never a number the result does not print. */
function countWord(n: number): string {
  const w = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return Number.isInteger(n) && n >= 0 && n < w.length ? w[n] : String(n);
}

function r2Words(r2: number): string {
  return r2 >= 0.7 ? "most" : r2 >= 0.3 ? "a moderate share" : "little";
}

/** The predictor with the smallest p (ties: the larger |statistic|), constant excluded; null when there is none. */
function clearestTerm(terms: ModelTerm[]): ModelTerm | null {
  const xs = terms.filter((t) => t.name !== "Constant" && Number.isFinite(t.p) && Number.isFinite(t.coef));
  if (!xs.length) return null;
  return xs.reduce((a, b) => (b.p < a.p || (b.p === a.p && Math.abs(b.stat) > Math.abs(a.stat)) ? b : a));
}

/**
 * econ-ols: how much of the response the model explains, and the predictor most clearly related to it, as an
 * association (OLS on observational data is not a causal design). Numbers are fmtFixed/fmtP, as in the table.
 */
export function olsReading(fit: OlsFit, d: number): string | undefined {
  const m = fit.model;
  if (!Number.isFinite(fit.r2)) return undefined;
  const preds = m.terms.filter((t) => t.name !== "Constant");
  const k = preds.length;
  // Without a constant the printed R² is the UNCENTERED one, which measures fit around zero, not "the variation in"
  // the response: the reading leaves it out, as regTableReading does (bug test 2026-10-28, R5 BLOCKER 3).
  const hasConstant = m.terms.some((t) => t.name === "Constant");
  const lead = hasConstant
    ? `The ${k === 1 ? "predictor explains" : `${countWord(k)} predictors together explain`} ${r2Words(fit.r2)} of the variation in ${m.depName} (R² = ${fmtFixed(fit.r2, 3)}).`
    : `The model of ${m.depName} on ${k === 1 ? preds[0].name : `${countWord(k)} predictors`} has no constant, so its R² is the uncentered one and does not measure the variation explained.`;
  const best = clearestTerm(m.terms);
  if (!best) return lead;
  // The one p rule (lib/pReading.ts): every decision on the p as the coefficient table prints it.
  const verdict = (t: ModelTerm): string | null => printedPVerdict(fmtP(t.p));
  const nSig = preds.filter((t) => verdict(t) === "clear").length;
  const bestV = verdict(best);
  if (bestV === "borderline") {
    const one = `the coefficient on ${best.name}, about ${fmtFixed(best.coef, d)} (p ${pText(best.p)}), is ${BOUNDARY_CLAUSE}.`;
    return firstThatFits(`${lead} ${k === 1 ? capital(one) : `The clearest single predictor is ${best.name}: ${one}`}`, lead);
  }
  if (bestV !== "clear") {
    return k === 1
      ? // The user's column name never starts a sentence (it is never re-capitalised).
        firstThatFits(`${lead} The data show no clear relation between ${best.name} and ${m.depName} (p ${pText(best.p)}).`, lead)
      : firstThatFits(`${lead} None of them is clearly related to ${m.depName} on its own (smallest p ${pText(best.p)}, ${best.name}).`, lead);
  }
  const assoc = `a one-unit rise in ${best.name} goes with a change of about ${fmtFixed(best.coef, d)} in ${m.depName} (p ${pText(best.p)}), an association rather than a proven cause.`;
  // One predictor: no "others" to hold fixed and no count (R5 MAJOR 6: "(R² = 0.409). holding the others fixed").
  if (k === 1) return firstThatFits(`${lead} ${capital(assoc)}`, lead);
  const others = `${ofTheCount(nSig, k)} ${ofTheSingular(nSig, k) ? "is" : "are"} statistically significant; `;
  // Long column names: the count clause goes first, then the second sentence, before the length rule breaks.
  return firstThatFits(`${lead} ${others}holding the others fixed, ${assoc}`, `${lead} Holding the others fixed, ${assoc}`, lead);
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function capitalCount(n: number): string {
  const w = countWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * econ-logit: the clearest predictor's average marginal effect on P(y = 1), as printed (4 decimals), and how often the
 * model classifies correctly. Logit and probit fitted to observational data describe associations, so "goes with".
 */
export function logitReading(model: FittedModel): string | undefined {
  const pct = model.stats.find((s) => s.label === "Correctly predicted (%)")?.value;
  const tail = pct !== undefined && Number.isFinite(pct) ? `; the model classifies ${fmtFixed(pct, 1)}% of cases correctly` : "";
  const me = model.marginalEffects ?? [];
  const best = clearestTerm(me.length ? me : model.terms);
  if (!best) return pct !== undefined && Number.isFinite(pct) ? `The model has no predictors${tail}.` : undefined;
  // The one p rule (lib/pReading.ts): decided on the p as the table prints it.
  const verdict = printedPVerdict(fmtP(best.p));
  if (verdict === "borderline") {
    return `The clearest predictor of whether ${model.depName} = 1 is ${best.name} (p ${pText(best.p)}), ${BOUNDARY_CLAUSE}${tail}.`;
  }
  if (verdict !== "clear") {
    return `No predictor is clearly related to whether ${model.depName} = 1 (smallest p ${pText(best.p)}, ${best.name})${tail}.`;
  }
  if (!me.length) {
    return `${best.name} is the clearest predictor: a higher ${best.name} goes with a ${best.coef > 0 ? "higher" : "lower"} chance that ${model.depName} = 1 (p ${pText(best.p)})${tail}.`;
  }
  // A probability cannot change by more than 1: an average marginal effect of 0.1 or more per unit is stated per
  // 0.1, 0.01, … of x instead, the scaled value printed in the text (logitAmeScaleNote) as in the reading
  // (bug test 2026-10-28, R5 BLOCKER 1: "a fall of about 1.3310 in the probability").
  const sc = ameScale(best.coef);
  const step = sc.step === 1 ? "one-unit" : `${sc.stepText}-unit`;
  const main =
    `A ${step} rise in ${best.name} goes with a ${best.coef > 0 ? "rise" : "fall"} of about ${sc.scaledText} ` +
    `in the probability that ${model.depName} = 1, on average (p ${pText(best.p)})`;
  // Logit: the same term's odds ratio as the odds-ratio table prints it (user decision 2026-10-28), when it has one
  // and it prints as something other than 1 (R5 MAJOR 3). Worded as an association (R5 BLOCKER 4).
  const or = oddsRatioRows(model)?.find((r) => r.name === best.name);
  const orText = or ? fmtOddsRatio(or.or) : "";
  if (or && orText !== "1.000") {
    const withOr = `${main}; each one-unit rise in ${best.name} goes with odds about ${orText} times as high`;
    return firstThatFits(`${withOr}${tail}.`, `${withOr}.`, `${main}${tail}.`, `${main}.`);
  }
  return firstThatFits(`${main}${tail}.`, `${main}.`);
}

/**
 * The step of x an average marginal effect is quoted per: 1 while |AME| < 0.1, else the largest power of ten below 1
 * that brings |AME|·step under 0.1. `scaledText` is |AME|·step at 4 decimals (fmtFixed), the number the reading and
 * the text line both print.
 */
export function ameScale(ame: number): { step: number; stepText: string; scaledText: string } {
  let k = 0;
  while (Math.abs(ame) * Math.pow(10, -k) >= 0.1 && k < 30) k++;
  const step = Math.pow(10, -k);
  const stepText = k === 0 ? "1" : k <= 4 ? step.toFixed(k) : fmtSci(step, 1);
  return { step, stepText, scaledText: fmtFixed(Math.abs(ame) * step, 4) };
}

/**
 * The text line behind a rescaled AME in the reading, so its number is on screen: "Per 0.1 of GPA: the average marginal
 * effect 0.3639 × 0.1 = 0.0364 …". Empty when the reading quotes the AME per unit (or quotes none).
 */
export function logitAmeScaleNote(model: FittedModel): string {
  const me = model.marginalEffects ?? [];
  if (!me.length) return "";
  const best = clearestTerm(me);
  if (!best || printedPVerdict(fmtP(best.p)) !== "clear") return "";
  const sc = ameScale(best.coef);
  if (sc.step === 1) return "";
  return (
    `Per ${sc.stepText} of ${best.name}: the average marginal effect ${fmtFixed(best.coef, 4)} × ${sc.stepText} = ` +
    `${best.coef < 0 ? "−" : ""}${sc.scaledText} in P(${model.depName} = 1). A marginal effect is a slope at the data, so it is ` +
    "quoted per a step small enough that the probability change stays well inside 0 to 1."
  );
}

/**
 * econ-regtable: the term most of the models share, how its coefficient moves from the first model that has it to the
 * last, in how many it is clearly non-zero, and (all linear) how R² moves. Numbers as the table prints them.
 */
export function regTableReading(models: FittedModel[], dec: number): string | undefined {
  if (!models.length) return undefined;
  const names: string[] = [];
  for (const m of models) for (const t of m.terms) if (t.name !== "Constant" && !names.includes(t.name)) names.push(t.name);
  if (!names.length) return undefined;
  const count = (n: string): number => models.filter((m) => m.terms.some((t) => t.name === n)).length;
  const term = names.reduce((a, b) => (count(b) > count(a) ? b : a));
  const hits = models.flatMap((m, i) => {
    const t = m.terms.find((x) => x.name === term);
    return t && Number.isFinite(t.coef) ? [{ i, t }] : [];
  });
  if (!hits.length) return undefined;
  const first = hits[0];
  const last = hits[hits.length - 1];
  // The one p rule (lib/pReading.ts): each column decided on its printed p; a ".050" column is borderline.
  const vOf = (t: ModelTerm): string | null => printedPVerdict(fmtP(t.p));
  const nSig = hits.filter((h) => vOf(h.t) === "clear").length;
  const nEdge = hits.filter((h) => vOf(h.t) === "borderline").length;
  const sigText =
    hits.length === 1
      ? vOf(first.t) === "clear"
        ? "clearly different from zero"
        : vOf(first.t) === "borderline"
          ? `with a p ${BOUNDARY_CLAUSE}`
          : "not clearly different from zero"
      : nEdge > 0
        ? `${nSig ? `clearly different from zero in ${countWord(nSig)} of the ${countWord(hits.length)} models that include it` : `not clearly different from zero in ${hits.length === 2 ? "either model that includes it" : `any of the ${countWord(hits.length)} models that include it`}`}; in ${countWord(nEdge)} ${nSig ? "more" : "of them"} its p is ${BOUNDARY_CLAUSE.replace("the evidence is", "the evidence there is")}`
      : nSig === hits.length
        ? hits.length === 2
          ? "clearly different from zero in both models that include it"
          : `clearly different from zero in all ${countWord(hits.length)} models that include it`
        : nSig === 0
          ? hits.length === 2
            ? "not clearly different from zero in either model that includes it"
            : `not clearly different from zero in any of the ${countWord(hits.length)} models that include it`
        : `clearly different from zero in ${countWord(nSig)} of the ${countWord(hits.length)} models that include it`;
  // "goes from … to …" only between coefficients on one scale: linear and quantile models are in the response's
  // units, a logit or probit coefficient is not, so a mixed pair is never set side by side as if one became the other.
  const scale = (m: FittedModel): string => (m.kind === "logit" || m.kind === "probit" ? m.kind : "linear");
  const sameScale = hits.every((h) => scale(models[h.i]) === scale(models[first.i]));
  const coefText =
    hits.length === 1
      ? `is ${fmtFixed(first.t.coef, dec)} in model (${first.i + 1})`
      : sameScale
        ? `goes from ${fmtFixed(first.t.coef, dec)} in model (${first.i + 1}) to ${fmtFixed(last.t.coef, dec)} in model (${last.i + 1})`
        : "is on different scales across the models";
  let s = `The ${term} coefficient ${coefText}, ${sigText}.`;
  // The table's R² row says "uncentered" for a linear model without a constant; the reading then leaves R² out.
  const allLinear = models.every((m) => isLinearKind(m.kind) && m.terms.some((t) => t.name === "Constant"));
  const r2 = (m: FittedModel): number | undefined => m.stats.find((x) => x.label === "R²")?.value;
  const r0 = r2(models[0]);
  const rk = r2(models[models.length - 1]);
  if (allLinear && models.length > 1 && r0 !== undefined && rk !== undefined && Number.isFinite(r0) && Number.isFinite(rk)) {
    s += ` R² goes from ${fmtFixed(r0, dec)} in model (1) to ${fmtFixed(rk, dec)} in model (${models.length})`;
    s += models.every((m) => m.kind === "ols") ? "; these are associations, not causal effects." : ".";
  } else if (models.every((m) => m.kind === "ols")) {
    s += " These are associations, not causal effects.";
  }
  return firstThatFits(s, `The ${term} coefficient ${coefText}, ${sigText}.`);
}

/** The first diagnostic that is not a finite number, by name, or null. */
export function nonFiniteDiagnostic(diag: OlsDiagnostics): string | null {
  const checks: [string, number][] = [["Durbin–Watson", diag.durbinWatson]];
  const test = (name: string, t: OlsDiagnostics["white"]): void => {
    if (!("skipped" in t)) checks.push([name, t.stat], [`${name} p-value`, t.p]);
  };
  test("Breusch–Pagan", diag.breuschPagan);
  test("White's test", diag.white);
  if (!("skipped" in diag.reset)) checks.push(["Ramsey RESET", diag.reset.f], ["Ramsey RESET p-value", diag.reset.p]);
  checks.push(["Jarque–Bera", diag.jarqueBera.jb], ["Jarque–Bera p-value", diag.jarqueBera.p]);
  for (const v of diag.vif) checks.push([`The VIF of “${v.name}”`, v.vif]);
  const hit = checks.find(([, v]) => !Number.isFinite(v));
  return hit ? hit[0] : null;
}

/** The diagnostics as table rows: Test, Statistic, df, p. */
export function diagnosticsRows(diag: OlsDiagnostics, d: number): string[][] {
  const rows: string[][] = [["Test", "Statistic", "df", "p"]];
  rows.push(["Durbin–Watson", fmtFixed(diag.durbinWatson, d), "", ""]);
  const chi = (name: string, t: OlsDiagnostics["white"]): void => {
    if ("skipped" in t) rows.push([name, `not computed: ${t.skipped}`, "", ""]);
    else rows.push([name, `χ² = ${fmtFixed(t.stat, d)}`, intText(t.df), fmtP(t.p)]);
  };
  chi("Breusch–Pagan (Koenker)", diag.breuschPagan);
  chi("White", diag.white);
  if ("skipped" in diag.reset) rows.push(["Ramsey RESET (ŷ², ŷ³)", `not computed: ${diag.reset.skipped}`, "", ""]);
  else rows.push(["Ramsey RESET (ŷ², ŷ³)", `F = ${fmtFixed(diag.reset.f, d)}`, `${diag.reset.df1},${NBSP}${diag.reset.df2}`, fmtP(diag.reset.p)]);
  const jb = diag.jarqueBera;
  rows.push(["Jarque–Bera", `χ² = ${fmtFixed(jb.jb, d)}`, "2", fmtP(jb.p)]);
  for (const v of diag.vif) rows.push([`VIF: ${v.name}`, fmtFixed(v.vif, 2), "", ""]);
  return rows;
}

/** Several OLS models in the publication table. */
export function econRegTableCalc(read: Read): StatOutput {
  const o = readOptions(read);
  if ("error" in o) return refuse(o.error);
  const parsed = parseRegData(read("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  // v2.200.0: a line may name its estimator ("iv: …", "fe: …", "q 0.5: …"); a plain line is OLS, as before.
  const rawLines = read("specs").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return refuse("Enter one model per line, such as “y ~ x1 + x2”.");
  if (rawLines.length > 12) return refuse("At most 12 models fit side by side in one table.");
  const nRows = parsed.data.rows.length;
  const tooMany = rowsRefusal(nRows, "the regression table");
  if (tooMany) return refuse(tooMany);
  if (nRows * rawLines.length > ECON_TABLE_MAX_ROW_MODELS) {
    return refuse(
      `${intText(nRows)} rows × ${rawLines.length} models is more than one table fits here (at most ${intText(ECON_TABLE_MAX_ROW_MODELS)} row-models). Use fewer models or a sample of the rows.`,
    );
  }
  const models: FittedModel[] = [];
  const dataNotes = new Set<string>();
  const started = Date.now();
  for (const [i, raw] of rawLines.entries()) {
    const where = (msg: string): string => (rawLines.length > 1 ? `Model ${i + 1} (${raw}): ${msg}` : msg);
    // The time guard before EVERY line, OLS included (R5 MAJOR 10: it ran only before non-OLS lines).
    if (i > 0 && Date.now() - started > 3000) return refuse(`The table stopped before model ${i + 1}: the models so far took more than 3 seconds. Fit the slow models in their own calculators.`);
    const line = parseModelLine(raw);
    if ("error" in line) return refuse(where(line.error));
    if (line.kind === "ols") {
      const s = parseSpec(line.spec);
      if ("error" in s) return refuse(where(s.error));
      const r = fitSpec(parsed.data, s, o);
      if ("error" in r) return refuse(where(r.error));
      models.push(r.fit.model);
      r.notes.forEach((n) => dataNotes.add(rawLines.length > 1 ? `Model ${i + 1}: ${n}` : n));
      continue;
    }
    // Each estimator keeps its own time limit; the table as a whole stops by name (above) rather than chaining them.
    const m = fitModelLine(line, read("data"), parsed.data, o.constant);
    if ("error" in m) return refuse(where(m.error));
    models.push(m);
  }
  const table = buildRegTable(models, { stars: o.stars, decimals: o.decimals });
  const deps = [...new Set(models.map((m) => m.depName))];
  const allOls = models.every((m) => m.kind === "ols");
  const lines: string[] = [];
  lines.push(`Regression table: ${models.length} ${allOls ? "OLS " : ""}model${models.length === 1 ? "" : "s"} of ${deps.join(", ")}`);
  lines.push(`Standard errors: ${[...new Set(models.map((m) => m.seLabel))].join("; ")}`);
  lines.push("");
  lines.push(...conventionNotes(o, parsed.data.named), ...dataNotes);
  // The SE convention once (identical across models).
  const seNotes = new Set<string>();
  // OLS notes once (identical across OLS columns); every other model's notes name their column.
  models.forEach((m, i) => {
    for (const n of m.notes) seNotes.add(m.kind === "ols" ? n : `Model ${i + 1} (${estimatorLabel(m)}): ${n}`);
  });
  lines.push(...seNotes);
  if (!allOls) {
    if (!o.constant && models.some((m) => m.kind === "fe" || m.kind === "re" || m.kind === "did")) {
      lines.push("No constant applies to the OLS, 2SLS, quantile, logit and probit lines; FE, RE and DiD columns keep the intercept their estimator reports.");
    }
    lines.push(
      "Models other than OLS are fitted by their own calculators' engines with those calculators' conventions, " +
        "on the rows each model uses; the OLS standard-error choice above applies to the OLS lines only.",
    );
    if (models.some((m) => m.kind === "fe" || m.kind === "did")) lines.push("For FE and DiD columns the R² row is the within R²; for RE it is the R² of the quasi-demeaned regression.");
    if (models.some((m) => m.kind === "quantile")) lines.push("For quantile columns the row shows the pseudo R¹ (Koenker and Machado).");
  }
  lines.push(`${o.decimals} decimals; terms a model leaves out are blank.`);
  return {
    text: lines.join("\n"),
    reading: regTableReading(models, o.decimals),
    svg: regTableFigureSvg(models) || undefined,
    tables: [{ label: table.label, rows: table.rows, note: table.legend, align: table.align }],
  };
}

/** One logit or probit model (lib/logitProbit.ts): the summary, the coefficient table and the marginal effects. */
export function econLogitCalc(read: Read): StatOutput {
  const parsed = parseRegData(read("data"));
  if (!parsed.ok) return refuse(parsed.reason);
  const tooMany = rowsRefusal(parsed.data.rows.length, `the ${read("model") === "probit" ? "probit" : "logit"} model`);
  if (tooMany) return refuse(tooMany);
  const spec = parseSpec(read("spec"));
  if ("error" in spec) return refuse(spec.error);
  const sel = selectColumns(parsed.data, spec, {});
  if (!sel.ok) return refuse(sel.reason);
  const c = sel.cols;
  const constant = (read("constant") || "yes") !== "no";
  const se = read("se") === "hc0" ? "hc0" : "classical";
  const kind = read("model") === "probit" ? "probit" : "logit";
  // The engine wants one row per observation; the reader gives columns.
  const y = Array.from(c.y);
  const X = y.map((_, i) => c.X.map((col) => col[i]));
  try {
    const fit = kind === "probit" ? fitProbit : fitLogit;
    const model = fit(y, X, c.names, { constant, se, depName: c.depName });
    const rep = logitProbitReport(model);
    // The same conventions as OLS, the constant's position included: the coefficient table lists it last.
    const notes = [...conventionNotes({ se: "classical", constant, decimals: 3, stars: "econ" }, parsed.data.named), ...c.notes];
    const scaleNote = logitAmeScaleNote(model);
    return { text: [rep.text, ...(scaleNote ? [scaleNote] : []), ...notes].join("\n"), reading: logitReading(model), svg: logitCoefFigureSvg(model), tables: rep.tables };
  } catch (e) {
    if (e instanceof LogitProbitRefusal) return refuse(e.message);
    // Never an uncaught error in the pane: anything else (a RangeError from a value the report cannot print) refuses.
    return refuse(`The ${kind} model could not be reported for these data (${(e as Error).message}). Check the columns for extreme values.`);
  }
}
