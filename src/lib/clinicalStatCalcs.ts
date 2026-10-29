/**
 * Clinical research & epidemiology (v2.206.0): ten Stats calculators for diagnostic-test accuracy, ROC analysis,
 * diagnostic-study sample size, 2×2 epidemiology, rate ratios, agreement (kappa, Bland–Altman, ICC) and meta-analysis
 * (pooling, and Egger's small-study test). Research and teaching tools for patent attorneys, inventors and students:
 * a diagnostic patent claims "a sensitivity of at least 90%", a drug patent cites a trial's risk ratio. There are no
 * bedside decision scores here.
 *
 * Engines: diagnosticAccuracy.ts, epi2x2.ts, agreement.ts, metaAnalysis.ts (numerics in clinicalCore.ts); figures:
 * clinicalFigures.ts. Oracles: scripts/clinical-oracle.py (statsmodels, scipy, scikit-learn, pingouin, and independent
 * numpy re-implementations where no library computes the quantity), fixtures in __tests__/fixtures/clinical-oracle.json.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import type { StatCalcDef } from "./statCalc";
import { parseRegData, readRegCell, isMissingCell } from "./regData";
import { fmtP, P_BELOW, intText } from "./regTable";
import { pVerdict, BOUNDARY_CLAUSE } from "./calcReading";
import { fitReading } from "./statLibReading";
import { chiSquareIndependence } from "./stats2";
import { groupedBarSvg } from "./statchart";
import { PROP_CI_NAME, pct, fx, pctCi, fxCi, readCount, readReal, type PropCiMethod } from "./clinicalCore";
import { diag2x2, bayesValues, bayesWithCi, postTest, rocFit, delongPaired, budererN, type RocFit } from "./diagnosticAccuracy";
import { epi2x2, altmanNnt, rateRatio } from "./epi2x2";
import { cohenKappa, landisKoch, blandAltman, iccFit, kooLi, type KappaWeight } from "./agreement";
import { countEffect, mantelHaenszel, metaAnalyze, eggerTest, EGGER_MIN_STUDIES, type CountMeasure, type CountStudy, type Pooled } from "./metaAnalysis";
import { faganSvg, rocSvg, ratioForestSvg, metaForestSvg, blandAltmanSvg, iccProfileSvg, funnelSvg, budererSvg } from "./clinicalFigures";

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

/** The pasted table's size limit, checked before parsing. */
export const CLIN_TEXT_MAX = 2_000_000;
/** ROC, Bland–Altman and ICC: at most this many rows. */
export const CLIN_MAX_ROWS = 20_000;
/** Kappa: at most this many categories; meta-analysis: at most this many studies. */
export const KAPPA_MAX_CATS = 20;
export const META_MAX_STUDIES = 500;

function getter(read: Read): Read {
  return (k: string): string => {
    const v = read(k);
    return v === undefined || v === null ? "" : String(v);
  };
}

/** "p = 0.012" / "p < 0.001", the printed form every reading decides on. */
function pText(p: number): string {
  return p < 0.001 ? `p ${P_BELOW}` : `p = ${fmtP(p)}`;
}
function verdict(p: number): "clear" | "borderline" | "none" {
  return pVerdict(pText(p));
}

/** A counts grid typed as rows of numbers ("15, 85" / "30 70", rows on lines or split by ";"). */
function readCountGrid(raw: string, label: string): number[][] | { error: string } {
  if (raw.length > 100_000) return { error: `${label}: the table is too large.` };
  const lines = raw
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: number[][] = [];
  for (const [i, line] of lines.entries()) {
    const cells = line.split(/[\s,\t]+/).filter(Boolean);
    // A row label in front ("Exposed 15 85") is allowed and dropped.
    const numeric = cells.filter((c, j) => !(j === 0 && !/^[−+-]?\d/.test(c)));
    if (!numeric.length) continue;
    const row: number[] = [];
    for (const c of numeric) {
      const v = readCount(c, `${label}, row ${i + 1}`);
      if (isErr(v)) return v;
      row.push(v);
    }
    rows.push(row);
  }
  if (!rows.length) return { error: `${label}: enter the counts, one row per line.` };
  return rows;
}

/** A numeric table from a block field: the names, optional row labels (a first column of words) and the numbers. */
interface NumTable {
  names: string[];
  rowLabels: string[] | null;
  rows: (number | null)[][];
}
function readNumTable(raw: string, label: string): NumTable | { error: string } {
  if (raw.length > CLIN_TEXT_MAX) return { error: `${label}: the pasted table is too large (the limit is 2 MB of text).` };
  const p = parseRegData(raw);
  if (!p.ok) return { error: `${label}: ${p.reason}` };
  const { names, rows, semicolon } = p.data;
  if (rows.length > CLIN_MAX_ROWS) return { error: `${label}: ${intText(rows.length)} rows; the limit is ${intText(CLIN_MAX_ROWS)}.` };
  const col0Words = rows.every((r) => isMissingCell(r[0] ?? "") || !Number.isFinite(readRegCell(r[0] ?? "", !!semicolon).value));
  const start = col0Words && names.length > 1 ? 1 : 0;
  const out: (number | null)[][] = [];
  for (const [i, r] of rows.entries()) {
    const row: (number | null)[] = [];
    for (let j = start; j < names.length; j++) {
      const c = r[j] ?? "";
      if (isMissingCell(c)) {
        row.push(null);
        continue;
      }
      const v = readRegCell(c, !!semicolon).value;
      if (!Number.isFinite(v)) return { error: `${label}: “${c}” (row ${i + 1}, column ${names[j]}) is not a number.` };
      row.push(v);
    }
    out.push(row);
  }
  return { names: names.slice(start), rowLabels: start ? rows.map((r) => r[0] ?? "") : null, rows: out };
}

function findCol(names: string[], want: string, label: string): number | { error: string } {
  const w = want.trim().toLowerCase();
  const i = names.findIndex((n) => n.trim().toLowerCase() === w);
  return i >= 0 ? i : { error: `${label}: no column named “${want.trim()}” (the columns are ${names.join(", ")}).` };
}

const CI_OPTIONS = [
  { value: "wilson", label: "Wilson score (default)" },
  { value: "cp", label: "Clopper–Pearson exact" },
];

// ---------------------------------------------------------------------------------------------------------------
// Diagnostic test accuracy

function probField(raw: string, label: string): number | { error: string } {
  const v = readReal(raw, label, { percent: true });
  if (isErr(v)) return v;
  return v;
}

function diagCalc(read: Read): StatOutput {
  const r = getter(read);
  const mode = r("mode") === "rates" ? "rates" : "table";
  const method: PropCiMethod = r("ci") === "cp" ? "cp" : "wilson";
  const lines: string[] = [];
  const rows: string[][] = [["Measure", "Estimate", "95% CI"]];
  let se: number;
  let sp: number;
  let lrPos: number | null;
  let lrNeg: number | null;
  let preDefault: number;
  let preName: string;
  if (mode === "table") {
    const cells: number[] = [];
    for (const [k, nm] of [
      ["tp", "True positives (TP)"],
      ["fp", "False positives (FP)"],
      ["fn", "False negatives (FN)"],
      ["tn", "True negatives (TN)"],
    ] as const) {
      const v = readCount(r(k), nm);
      if (isErr(v)) return refuse(v.error);
      cells.push(v);
    }
    const d = diag2x2(cells[0], cells[1], cells[2], cells[3], method);
    if (isErr(d)) return refuse(d.error);
    se = d.sens.est;
    sp = d.spec.est;
    lines.push(`Diagnostic accuracy from a 2×2 table: TP ${intText(d.tp)}, FP ${intText(d.fp)}, FN ${intText(d.fn)}, TN ${intText(d.tn)} (n = ${intText(d.n)}).`);
    const prow = (name: string, c: { est: number; lo: number; hi: number } | null, why: string): void => {
      rows.push(c ? [name, pct(c.est), pctCi(c.lo, c.hi)] : [name, "not estimable", why]);
    };
    prow("Sensitivity", d.sens, "");
    prow("Specificity", d.spec, "");
    prow("PPV (at the sample prevalence)", d.ppv, "no positive results");
    prow("NPV (at the sample prevalence)", d.npv, "no negative results");
    prow("Accuracy", d.acc, "");
    prow("Prevalence in the sample", d.prevalence, "");
    rows.push(["LR+", fx(d.lrPos.est), fxCi(d.lrPos.lo, d.lrPos.hi)]);
    rows.push(["LR−", fx(d.lrNeg.est), fxCi(d.lrNeg.lo, d.lrNeg.hi)]);
    rows.push(["Diagnostic odds ratio", fx(d.dor.est), fxCi(d.dor.lo, d.dor.hi)]);
    rows.push(["Youden J", fx(d.youden, 3), ""]);
    lrPos = d.lrPos.est;
    lrNeg = d.lrNeg.est;
    preDefault = d.prevalence.est;
    preName = "the sample prevalence";
    lines.push(`Proportions: ${PROP_CI_NAME[method]} intervals. LR+ and LR−: log method (Simel et al. 1991). DOR: log (Woolf) method.`);
    if (d.haldane) {
      lines.push(
        `${d.zeroCells.join(" and ")} = 0: LR+, LR− and the DOR are computed with 0.5 added to every cell (Haldane–Anscombe correction); ` +
          "the proportions are not corrected.",
      );
    }
    lines.push(
      "PPV and NPV from the table hold only when the sample prevalence is the real one (a cross-sectional or cohort sample, not a case-control one).",
    );
    const prevRaw = r("prev2").trim();
    if (prevRaw) {
      const p2 = probField(prevRaw, "Other prevalence");
      if (isErr(p2)) return refuse(p2.error);
      if (!(p2 > 0 && p2 < 1)) return refuse("Other prevalence: enter a value strictly between 0% and 100% (at 0% or 100% PPV or NPV is fixed by definition).");
      const b = bayesWithCi(se, sp, d.nDiseased, d.nHealthy, p2);
      const add = (name: string, c: { est: number; lo: number; hi: number } | null): void => {
        if (!c) rows.push([name, "not defined", "no one tests positive"]);
        else rows.push([name, pct(c.est), Number.isFinite(c.lo) ? pctCi(c.lo, c.hi) : "no interval (Se or Sp is 0% or 100%)"]);
      };
      add(`PPV at ${pct(p2)} prevalence`, b.ppv);
      add(`NPV at ${pct(p2)} prevalence`, b.npv);
      lines.push(`PPV and NPV at ${pct(p2)} prevalence: Bayes' rule, logit intervals of Mercaldo, Lau & Zhou (2007).`);
    }
  } else {
    const s1 = probField(r("sens"), "Sensitivity");
    if (isErr(s1)) return refuse(s1.error);
    const s2 = probField(r("spec"), "Specificity");
    if (isErr(s2)) return refuse(s2.error);
    const pv = probField(r("prev"), "Prevalence");
    if (isErr(pv)) return refuse(pv.error);
    for (const [nm, v] of [
      ["Sensitivity", s1],
      ["Specificity", s2],
    ] as const)
      if (!(v >= 0 && v <= 1)) return refuse(`${nm}: enter a value from 0% to 100%.`);
    if (!(pv > 0 && pv < 1)) {
      return refuse(
        `Prevalence: enter a value strictly between 0% and 100%. At ${pct(pv)} nobody ${pv <= 0 ? "has" : "is free of"} the condition, so ` +
          `${pv <= 0 ? "every positive result is false and PPV is 0 by definition" : "every negative result is false and NPV is 0 by definition"}: there is nothing to estimate.`,
      );
    }
    se = s1;
    sp = s2;
    const b = bayesValues(se, sp, pv);
    lrPos = sp < 1 ? se / (1 - sp) : null;
    lrNeg = sp > 0 ? (1 - se) / sp : null;
    lines.push(`Diagnostic accuracy from sensitivity ${pct(se)}, specificity ${pct(sp)} and prevalence ${pct(pv)} (no counts, so no confidence intervals).`);
    rows.push(["Sensitivity", pct(se), ""], ["Specificity", pct(sp), ""]);
    rows.push(["PPV", b.ppv === null ? "not defined (no positives)" : pct(b.ppv), ""]);
    rows.push(["NPV", b.npv === null ? "not defined (no negatives)" : pct(b.npv), ""]);
    rows.push(["LR+", lrPos === null ? "unbounded (specificity is 100%)" : fx(lrPos), ""]);
    rows.push(["LR−", lrNeg === null ? "unbounded (specificity is 0%)" : fx(lrNeg), ""]);
    rows.push(["Diagnostic odds ratio", lrPos !== null && lrNeg !== null && lrNeg > 0 ? fx(lrPos / lrNeg) : "unbounded (a ratio has a zero denominator)", ""]);
    rows.push(["Youden J", fx(se + sp - 1, 3), ""]);
    preDefault = pv;
    preName = "the prevalence";
  }
  // Pre-test → post-test.
  const preRaw = r("pretest").trim();
  let pre = preDefault;
  if (preRaw) {
    const p = probField(preRaw, "Pre-test probability");
    if (isErr(p)) return refuse(p.error);
    pre = p;
    preName = "the pre-test probability entered";
  }
  if (!(pre > 0 && pre < 1)) return refuse("Pre-test probability: enter a value strictly between 0% and 100%.");
  const postPos = lrPos === null ? 1 : postTest(pre, lrPos);
  const postNeg = lrNeg === null ? 0 : postTest(pre, lrNeg);
  rows.push(["Post-test probability after a positive", pct(postPos), ""]);
  rows.push(["Post-test probability after a negative", pct(postNeg), ""]);
  lines.push(`Pre-test probability ${pct(pre)} (${preName}): after a positive result ${pct(postPos)}, after a negative ${pct(postNeg)} (odds form of Bayes' rule; the Fagan nomogram).`);
  const table: StatTable = { label: "Diagnostic accuracy", rows };
  const fagan = faganSvg(pre, [
    { label: `Positive: LR+ ${lrPos === null ? "unbounded" : fx(lrPos)}, post-test ${pct(postPos)}`, lr: lrPos === null ? 1e6 : lrPos, post: postPos },
    { label: `Negative: LR− ${lrNeg === null ? "unbounded" : fx(lrNeg)}, post-test ${pct(postNeg)}`, lr: lrNeg === null ? 1e6 : Math.max(lrNeg, 1e-9), post: postNeg },
  ]);
  const sensText = mode === "table" ? `${pct(se)} (95% CI ${rows[1][2]})` : pct(se);
  const reading = fitReading(
    `The test detects ${sensText} of those with the condition and clears ${pct(sp)} of those without; at a ${pct(pre)} pre-test probability, a positive result raises it to ${pct(postPos)} and a negative one lowers it to ${pct(postNeg)}.`,
    `Sensitivity ${pct(se)}, specificity ${pct(sp)}: a positive result moves a ${pct(pre)} pre-test probability to ${pct(postPos)}, a negative one to ${pct(postNeg)}.`,
  );
  return { text: [...lines, "", "For research and education; not a substitute for clinical judgement."].join("\n"), reading, svg: fagan, tables: [table] };
}

// ---------------------------------------------------------------------------------------------------------------
// ROC

/** Hanley & McNeil (1982, Radiology 143:29), Table 1: CT ratings 1–5 of 58 normal and 51 abnormal patients. */
export function rocDefaultTable(): string {
  const lines = ["disease\trating"];
  const counts: [number, number[]][] = [
    [0, [33, 6, 6, 11, 2]],
    [1, [3, 2, 2, 11, 33]],
  ];
  for (const [d, cs] of counts) cs.forEach((c, i) => {
    for (let k = 0; k < c; k++) lines.push(`${d}\t${i + 1}`);
  });
  return lines.join("\n");
}

function aucWords(a: number): string {
  if (a >= 0.9) return "outstanding";
  if (a >= 0.8) return "excellent";
  if (a >= 0.7) return "acceptable";
  if (a > 0.5) return "poor";
  return "no better than chance";
}

function rocCalc(read: Read): StatOutput {
  const r = getter(read);
  const t = readNumTable(r("data"), "Data");
  if (isErr(t)) return refuse(t.error);
  const oc = findCol(t.names, r("outcome"), "Outcome column");
  if (isErr(oc)) return refuse(oc.error);
  const sc = findCol(t.names, r("score"), "Score column");
  if (isErr(sc)) return refuse(sc.error);
  const s2name = r("score2").trim();
  let sc2: number | null = null;
  if (s2name) {
    const c = findCol(t.names, s2name, "Second score column");
    if (isErr(c)) return refuse(c.error);
    sc2 = c;
  }
  const higher = r("direction") !== "lower";
  const y: number[] = [];
  const s1: number[] = [];
  const s2: number[] = [];
  let dropped = 0;
  for (const [i, row] of t.rows.entries()) {
    const o = row[oc];
    const a = row[sc];
    const b = sc2 !== null ? row[sc2] : 0;
    if (o === null || a === null || b === null) {
      dropped++;
      continue;
    }
    if (o !== 0 && o !== 1) return refuse(`Outcome column: row ${i + 1} is ${fx(o, 2)}; the outcome must be 1 (has the condition) or 0 (does not).`);
    y.push(o);
    s1.push(a);
    s2.push(b);
  }
  const fit = rocFit(s1, y, higher);
  if (isErr(fit)) return refuse(fit.error);
  let fit2: RocFit | null = null;
  if (sc2 !== null) {
    const f2 = rocFit(s2, y, higher);
    if (isErr(f2)) return refuse(`Second score: ${f2.error}`);
    fit2 = f2;
  }
  const op = higher ? "≥" : "≤";
  const sName = t.names[sc];
  const lines: string[] = [
    `ROC analysis of ${sName} against ${t.names[oc]}: ${intText(fit.nPos)} with the condition, ${intText(fit.nNeg)} without${dropped ? `; ${intText(dropped)} row${dropped === 1 ? "" : "s"} with a missing value left out` : ""}.`,
    `A case is called positive when its score is ${op} the cutoff (${higher ? "higher" : "lower"} scores mean more likely diseased).`,
    `AUC ${fx(fit.auc, 3)}, DeLong SE ${fx(fit.se, 4)}, 95% CI ${fxCi(fit.lo, fit.hi, 3)} (AUC ± 1.96·SE, DeLong et al. 1988).`,
    `Youden-optimal cutoff ${op} ${fx(fit.best.cutoff, 4).replace(/\.?0+$/, "")}: sensitivity ${pct(fit.best.sens)}, specificity ${pct(fit.best.spec)}, J = ${fx(fit.bestJ, 3)}.`,
  ];
  const cutText = fx(fit.best.cutoff, 4).replace(/\.?0+$/, "");
  const rows: string[][] = [
    ["Measure", "Value", "95% CI"],
    [`AUC (${sName})`, fx(fit.auc, 3), fxCi(fit.lo, fit.hi, 3)],
    ["Optimal cutoff (Youden)", `${op} ${cutText}`, ""],
    ["Sensitivity at the cutoff", pct(fit.best.sens), ""],
    ["Specificity at the cutoff", pct(fit.best.spec), ""],
  ];
  let reading: string | undefined;
  const curves = [{ label: `${sName}, AUC ${fx(fit.auc, 3)}`, pts: fit.curve }];
  if (fit2 && sc2 !== null) {
    const dl = delongPaired(fit, fit2);
    const s2Name = t.names[sc2];
    curves.push({ label: `${s2Name}, AUC ${fx(fit2.auc, 3)}`, pts: fit2.curve });
    rows.push([`AUC (${s2Name})`, fx(fit2.auc, 3), fxCi(fit2.lo, fit2.hi, 3)]);
    rows.push(["Difference in AUC", fx(dl.diff, 3), fxCi(dl.lo, dl.hi, 3)]);
    rows.push(["DeLong paired test", `z = ${fx(dl.z, 2)}`, pText(dl.p)]);
    lines.push(`DeLong's paired test of ${sName} against ${s2Name}: difference ${fx(dl.diff, 3)} (95% CI ${fxCi(dl.lo, dl.hi, 3)}), z = ${fx(dl.z, 2)}, ${pText(dl.p)}.`);
    const v = verdict(dl.p);
    const tail =
      v === "clear"
        ? `a difference unlikely to be chance (${pText(dl.p)})`
        : v === "borderline"
          ? `${pText(dl.p)}, ${BOUNDARY_CLAUSE}`
          : `a difference that could be chance (${pText(dl.p)})`;
    reading = fitReading(
      `${sName} has an AUC of ${fx(fit.auc, 3)} and ${s2Name} ${fx(fit2.auc, 3)} on the same cases: ${tail}.`,
      `AUC ${fx(fit.auc, 3)} against ${fx(fit2.auc, 3)}: ${tail}.`,
    );
  } else {
    reading = fitReading(
      `The score ${sName} separates cases with and without the condition with an AUC of ${fx(fit.auc, 3)} (95% CI ${fxCi(fit.lo, fit.hi, 3)}), ${aucWords(fit.auc)} where 0.5 is chance; the best single cutoff, ${op} ${cutText}, gives sensitivity ${pct(fit.best.sens)} and specificity ${pct(fit.best.spec)}.`,
      `AUC ${fx(fit.auc, 3)} (95% CI ${fxCi(fit.lo, fit.hi, 3)}); the cutoff ${op} ${cutText} gives sensitivity ${pct(fit.best.sens)} and specificity ${pct(fit.best.spec)}.`,
    );
  }
  const tables: StatTable[] = [{ label: "ROC analysis", rows }];
  if (fit.cuts.length <= 25) {
    tables.push({
      label: "Every cutoff",
      rows: [["Cutoff", "Sensitivity", "Specificity", "Youden J"], ...fit.cuts.map((c) => [`${op} ${fx(c.cutoff, 4).replace(/\.?0+$/, "")}`, pct(c.sens), pct(c.spec), fx(c.sens + c.spec - 1, 3)])],
    });
  }
  const svg = rocSvg(curves, { fpr: 1 - fit.best.spec, tpr: fit.best.sens, label: `Youden cutoff ${op} ${cutText}` });
  return { text: lines.join("\n"), reading, svg, tables };
}

// ---------------------------------------------------------------------------------------------------------------
// Buderer sample size

function budererCalc(read: Read): StatOutput {
  const r = getter(read);
  const vals: number[] = [];
  for (const [k, nm] of [
    ["sens", "Expected sensitivity"],
    ["spec", "Expected specificity"],
    ["prev", "Prevalence"],
    ["d", "Precision (half-width of the 95% CI)"],
  ] as const) {
    const v = probField(r(k), nm);
    if (isErr(v)) return refuse(v.error);
    if (!(v > 0 && v < 1)) return refuse(`${nm}: enter a value strictly between 0% and 100%.`);
    vals.push(v);
  }
  const [se, sp, prev, d] = vals;
  if (d >= 0.5) return refuse("Precision: a half-width of 50 percentage points or more is not a precision; enter, for example, 5%.");
  const b = budererN(se, sp, prev, d);
  const curve = (f: (p: number) => number): { x: number; y: number }[] =>
    Array.from({ length: 49 }, (_, i) => (i + 1) / 50).map((p) => ({ x: 100 * p, y: f(p) }));
  const svg = budererSvg(
    curve((p) => budererN(se, sp, p, d).nSens),
    curve((p) => budererN(se, sp, p, d).nSpec),
    { x: 100 * prev, y: b.n },
  );
  const lines = [
    `Diagnostic accuracy study size (Buderer 1996): expected sensitivity ${pct(se)}, specificity ${pct(sp)}, prevalence ${pct(prev)}, 95% CI half-width ±${pct(d)}.`,
    `For sensitivity: n = 1.96²·Se(1 − Se)/(d²·prevalence) = ${intText(b.nSens)}. For specificity: n = 1.96²·Sp(1 − Sp)/(d²·(1 − prevalence)) = ${intText(b.nSpec)}.`,
    `Recruit ${intText(b.n)} subjects (about ${intText(b.diseased)} with the condition and ${intText(b.healthy)} without), before any allowance for dropout.`,
  ];
  const rows = [
    ["Target", "Subjects needed", "With the condition"],
    ["Sensitivity", intText(b.nSens), intText(Math.round(b.nSens * prev))],
    ["Specificity", intText(b.nSpec), intText(Math.round(b.nSpec * prev))],
    ["Study (the larger)", intText(b.n), intText(b.diseased)],
  ];
  const driver = b.nSens >= b.nSpec ? "sensitivity" : "specificity";
  const reading = fitReading(
    `To estimate both to within ±${fx(100 * d, 1)} percentage points at ${pct(prev)} prevalence, the study needs ${intText(b.n)} subjects, about ${intText(b.diseased)} of them with the condition; ${driver} sets the size.`,
  );
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "Sample size", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------
// 2×2 epidemiology

function epiCalc(read: Read): StatOutput {
  const r = getter(read);
  const g = readCountGrid(r("table"), "2×2 table");
  if (isErr(g)) return refuse(g.error);
  if (g.length !== 2 || g.some((row) => row.length !== 2)) return refuse("2×2 table: enter two rows of two counts (row 1 exposed/treated, row 2 unexposed/control; event, no event).");
  const [[a, b], [c, d]] = g;
  const caseControl = r("design") === "casecontrol";
  const rdMethod = r("rdci") === "wald" ? "wald" : "newcombe";
  const adverse = r("event") !== "good";
  const e = epi2x2(a, b, c, d, rdMethod);
  if (isErr(e)) return refuse(e.error);
  const chi = chiSquareIndependence([
    [a, b],
    [c, d],
  ]);
  const pF = chi.pFisher;
  const pChi = chi.reason ? NaN : chi.p;
  const lines: string[] = [];
  const rows: string[][] = [["Measure", "Estimate", "95% CI", "Method"]];
  const n1 = a + b;
  const n0 = c + d;
  let reading: string | undefined;
  const pMain = pF ?? pChi;
  const pName = pF !== undefined ? "Fisher" : "χ²";
  const v = Number.isFinite(pMain) ? verdict(pMain) : "none";
  const pPhrase = Number.isFinite(pMain)
    ? v === "clear"
      ? `is unlikely to be chance (${pName} ${pText(pMain)})`
      : v === "borderline"
        ? `gives ${pName} ${pText(pMain)}, ${BOUNDARY_CLAUSE}`
        : `could be chance (${pName} ${pText(pMain)})`
    : "";
  const forest: { label: string; estimate: number; low: number; high: number }[] = [];
  if (!caseControl) {
    lines.push(`Cohort study or trial: risk ${intText(a)}/${intText(n1)} = ${pct(e.p1)} in row 1 (exposed/treated), ${intText(c)}/${intText(n0)} = ${pct(e.p0)} in row 2 (unexposed/control).`);
    rows.push(["Risk, row 1", pct(e.p1), "", ""], ["Risk, row 2", pct(e.p0), "", ""]);
    rows.push(["Risk ratio", fx(e.rr.est), fxCi(e.rr.lo, e.rr.hi), "Katz log"]);
    rows.push(["Odds ratio", fx(e.or.est), fxCi(e.or.lo, e.or.hi), "Woolf log"]);
    rows.push(["Risk difference (1 − 2)", pct(e.rd.est), pctCi(e.rd.lo, e.rd.hi), rdMethod === "wald" ? "Wald" : "Newcombe hybrid score"]);
    // Benefit: fewer adverse events, or more good ones, in row 1.
    const ben = adverse ? e.arr : e.rd;
    rows.push([adverse ? "ARR (2 − 1)" : "Absolute benefit increase (1 − 2)", pct(ben.est), pctCi(ben.lo, ben.hi), rdMethod === "wald" ? "Wald" : "Newcombe hybrid score"]);
    if (adverse) rows.push(["RRR (1 − RR)", pct(e.rrr.est), pctCi(e.rrr.lo, e.rrr.hi), "from the RR interval"]);
    const nnt = altmanNnt(ben.est, ben.lo, ben.hi, (x) => fx(x, 1));
    rows.push(["Number needed to treat", nnt.point ? `${nnt.point.kind} ${fx(nnt.point.value, 1)}` : "no difference", nnt.text.replace(/^[^(]*\(|\)$/g, ""), "Altman 1998"]);
    lines.push(`Risk ratio ${fx(e.rr.est)} (95% CI ${fxCi(e.rr.lo, e.rr.hi)}, Katz log method); odds ratio ${fx(e.or.est)} (95% CI ${fxCi(e.or.lo, e.or.hi)}, Woolf).`);
    lines.push(`Risk difference ${pct(e.rd.est)} (95% CI ${pctCi(e.rd.lo, e.rd.hi)}, ${rdMethod === "wald" ? "Wald" : "Newcombe hybrid score"}).`);
    lines.push(`NNT (Altman 1998): ${nnt.text}.`);
    if (nnt.crossesZero) {
      lines.push(
        "The interval for the absolute difference includes 0 (no effect), where the NNT is infinite (∞): so the NNT interval runs from harm, through no effect, to benefit, as Altman recommends writing it.",
      );
    }
    forest.push({ label: "Risk ratio", estimate: e.rr.est, low: e.rr.lo, high: e.rr.hi }, { label: "Odds ratio", estimate: e.or.est, low: e.or.lo, high: e.or.hi });
    reading = fitReading(
      `The risk is ${pct(e.p1)} in row 1 against ${pct(e.p0)} in row 2, a risk ratio of ${fx(e.rr.est)} (95% CI ${fxCi(e.rr.lo, e.rr.hi)}), ${nnt.point ? `${nnt.point.kind} ${fx(nnt.point.value, 1)}` : "no absolute difference"}; the difference ${pPhrase}.`,
      `Risk ${pct(e.p1)} vs ${pct(e.p0)}: risk ratio ${fx(e.rr.est)} (95% CI ${fxCi(e.rr.lo, e.rr.hi)}); the difference ${pPhrase}.`,
    );
  } else {
    lines.push(`Case-control study: of the exposed (row 1), ${intText(a)} cases and ${intText(b)} controls; of the unexposed (row 2), ${intText(c)} cases and ${intText(d)} controls.`);
    lines.push("A case-control sample fixes the number of cases, so risks, the risk ratio, the risk difference and the NNT cannot be estimated from it; the odds ratio can.");
    rows.push(["Odds ratio", fx(e.or.est), fxCi(e.or.lo, e.or.hi), "Woolf log"]);
    lines.push(`Odds ratio ${fx(e.or.est)} (95% CI ${fxCi(e.or.lo, e.or.hi)}, Woolf log method).`);
    forest.push({ label: "Odds ratio", estimate: e.or.est, low: e.or.lo, high: e.or.hi });
    reading = fitReading(
      `The odds of exposure are ${fx(e.or.est)} times as high among cases as among controls (odds ratio 95% CI ${fxCi(e.or.lo, e.or.hi)}); the association ${pPhrase}.`,
    );
  }
  if (e.haldane) lines.push("A cell is 0: the risk ratio and odds ratio are computed with 0.5 added to every cell (Haldane–Anscombe correction); risks and the risk difference use the counts as entered.");
  if (Number.isFinite(pChi)) lines.push(`Pearson χ² = ${fx(chi.chi2, 3)}, df = 1, ${pText(pChi)}${pF !== undefined ? `; Fisher's exact (two-sided) ${pText(pF)}, the one to report on a small table` : ""}; computed by the Stats chi-square tool's engine.`);
  for (const w of chi.warnings ?? []) lines.push(w.replace(/—/g, "-"));
  rows.push(["Association test", pF !== undefined ? "Fisher's exact" : "Pearson χ²", pText(pMain), pF !== undefined ? `χ² ${pText(pChi)}` : ""]);
  const svg = ratioForestSvg(forest, { title: caseControl ? "Odds ratio (95% CI)" : "Risk and odds ratios (95% CI)", xlabel: "Ratio (log scale; 1 = no association)", log: true });
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "2×2 epidemiology", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Incidence-rate ratio

function rateCalc(read: Read): StatOutput {
  const r = getter(read);
  const a = readCount(r("e1"), "Events, group 1");
  if (isErr(a)) return refuse(a.error);
  const c = readCount(r("e0"), "Events, group 2");
  if (isErr(c)) return refuse(c.error);
  const t1 = readReal(r("t1"), "Person-time, group 1");
  if (isErr(t1)) return refuse(t1.error);
  const t0 = readReal(r("t0"), "Person-time, group 2");
  if (isErr(t0)) return refuse(t0.error);
  const unit = r("unit").trim() || "person-years";
  const per = Number(r("per")) || 1000;
  const rr = rateRatio(a, t1, c, t0);
  if (isErr(rr)) return refuse(rr.error);
  const rate = (x: number): string => fx(x * per, 2);
  const perText = `per ${intText(per)} ${unit}`;
  const lines = [
    `Incidence rates: ${intText(a)} events in ${fx(t1, 0)} ${unit} (group 1) = ${rate(rr.r1)} ${perText}; ${intText(c)} in ${fx(t0, 0)} = ${rate(rr.r0)} ${perText}.`,
    `Rate ratio ${fx(rr.irr)}: exact 95% CI ${fxCi(rr.exact.lo, rr.exact.hi)} (conditional binomial, Clopper–Pearson)${rr.wald ? `; Wald (Poisson, log scale) ${fxCi(rr.wald.lo, rr.wald.hi)}` : "; no Wald interval (no events in group 1)"}.`,
    `Exact two-sided test of a rate ratio of 1: ${pText(rr.pExact)}.`,
    `Rate difference ${rate(rr.rd.est)} ${perText} (95% CI ${fxCi(rr.rd.lo * per, rr.rd.hi * per)}, Wald).`,
  ];
  const rows = [
    ["Measure", "Estimate", "95% CI", "Method"],
    [`Rate, group 1 (${perText})`, rate(rr.r1), "", ""],
    [`Rate, group 2 (${perText})`, rate(rr.r0), "", ""],
    ["Rate ratio", fx(rr.irr), fxCi(rr.exact.lo, rr.exact.hi), "exact"],
    ...(rr.wald ? [["Rate ratio", fx(rr.irr), fxCi(rr.wald.lo, rr.wald.hi), "Wald, log scale"]] : []),
    [`Rate difference (${perText})`, rate(rr.rd.est), fxCi(rr.rd.lo * per, rr.rd.hi * per), "Wald"],
    ["Test of rate ratio = 1", "", pText(rr.pExact), "exact binomial"],
  ];
  const v = verdict(rr.pExact);
  const tail = v === "clear" ? `is unlikely to be chance (${pText(rr.pExact)})` : v === "borderline" ? `gives ${pText(rr.pExact)}, ${BOUNDARY_CLAUSE}` : `could be chance (${pText(rr.pExact)})`;
  const reading = fitReading(
    `Events occur at ${rate(rr.r1)} ${perText} in group 1 against ${rate(rr.r0)} in group 2, a rate ratio of ${fx(rr.irr)} (exact 95% CI ${fxCi(rr.exact.lo, rr.exact.hi)}); the difference ${tail}.`,
    `Rate ratio ${fx(rr.irr)} (exact 95% CI ${fxCi(rr.exact.lo, rr.exact.hi)}); the difference ${tail}.`,
  );
  const forest = [{ label: "Exact", estimate: rr.irr, low: rr.exact.lo, high: rr.exact.hi }];
  if (rr.wald) forest.push({ label: "Wald", estimate: rr.irr, low: rr.wald.lo, high: rr.wald.hi });
  const svg = rr.irr > 0 ? ratioForestSvg(forest, { title: "Rate ratio (95% CI)", xlabel: "Rate ratio (log scale; 1 = equal rates)", log: true }) : ratioForestSvg([{ label: "Rate difference", estimate: rr.rd.est * per, low: rr.rd.lo * per, high: rr.rd.hi * per }], { title: "Rate difference (95% CI)", xlabel: `Rate difference ${perText}`, log: false });
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "Rates", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Kappa

function kappaCalc(read: Read): StatOutput {
  const r = getter(read);
  const g = readCountGrid(r("table"), "Agreement table");
  if (isErr(g)) return refuse(g.error);
  if (g.length > KAPPA_MAX_CATS) return refuse(`Agreement table: at most ${KAPPA_MAX_CATS} categories.`);
  const weight: KappaWeight = r("weight") === "linear" ? "linear" : r("weight") === "quadratic" ? "quadratic" : "none";
  const fit = cohenKappa(g, weight);
  if (isErr(fit)) return refuse(fit.error);
  const cats = r("categories").trim() ? r("categories").split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
  const names = Array.from({ length: fit.k }, (_, i) => cats[i] ?? `Category ${i + 1}`);
  const wName = weight === "none" ? "unweighted" : `${weight}-weighted`;
  const lines = [
    `Cohen's kappa (${wName}), ${fit.k} categories, ${intText(fit.n)} subjects rated by both raters (rows: rater A; columns: rater B).`,
    `Observed ${weight === "none" ? "" : "weighted "}agreement ${pct(fit.po)}; expected by chance ${pct(fit.pe)}.`,
    `κ = ${fx(fit.kappa, 3)}, SE ${fx(fit.se, 4)}, 95% CI ${fxCi(fit.lo, fit.hi, 3)} (Fleiss, Cohen & Everitt 1969 large-sample SE).`,
    `Test of κ = 0: z = ${fx(fit.z, 2)} (null SE ${fx(fit.se0, 4)}), ${pText(fit.p)}.`,
    `Landis & Koch (1977) would call this ${landisKoch(fit.kappa)} agreement.`,
  ];
  if (weight !== "none" && fit.k === 2) lines.push("With two categories, weighted and unweighted kappa are the same.");
  const unused = g.map((row, i) => row.reduce((s, x) => s + x, 0) + g.reduce((s, rw) => s + rw[i], 0)).map((s, i) => (s === 0 ? names[i] : "")).filter(Boolean);
  if (unused.length) lines.push(`Unused by both raters: ${unused.join(", ")}.`);
  const rows = [
    ["Measure", "Value", "95% CI"],
    ["Observed agreement", pct(fit.po), ""],
    ["Chance agreement", pct(fit.pe), ""],
    [`κ (${wName})`, fx(fit.kappa, 3), fxCi(fit.lo, fit.hi, 3)],
    ["Test of κ = 0", `z = ${fx(fit.z, 2)}`, pText(fit.p)],
  ];
  const svg = groupedBarSvg(
    names,
    [
      { label: "Agreed (observed)", values: fit.diagObs },
      { label: "Agreed by chance (expected)", values: fit.diagExp },
    ],
    { title: "Agreement by category", ylabel: "Subjects" },
  );
  const reading = fitReading(
    `The raters agree on ${pct(fit.po)} of subjects against ${pct(fit.pe)} expected by chance: κ = ${fx(fit.kappa, 3)} (95% CI ${fxCi(fit.lo, fit.hi, 3)}), ${landisKoch(fit.kappa)} agreement on the Landis–Koch scale.`,
  );
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "Cohen's kappa", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Bland–Altman

/** Bland & Altman (1986, Lancet i:307), Table 1: PEFR (L/min) by the Wright and mini Wright meters, first readings. */
export function baDefaultTable(): string {
  const w = [494, 395, 516, 434, 476, 557, 413, 442, 650, 433, 417, 656, 267, 478, 178, 423, 427];
  const m = [512, 430, 520, 428, 500, 600, 364, 380, 658, 445, 432, 626, 260, 477, 259, 350, 451];
  return ["Wright\tMini", ...w.map((v, i) => `${v}\t${m[i]}`)].join("\n");
}

function blandCalc(read: Read): StatOutput {
  const r = getter(read);
  const t = readNumTable(r("data"), "Data");
  if (isErr(t)) return refuse(t.error);
  const ia = findCol(t.names, r("a"), "Method A column");
  if (isErr(ia)) return refuse(ia.error);
  const ib = findCol(t.names, r("b"), "Method B column");
  if (isErr(ib)) return refuse(ib.error);
  if (ia === ib) return refuse("Methods A and B are the same column.");
  const mult = r("mult") === "2" ? 2 : 1.96;
  const units = r("units").trim();
  const A: number[] = [];
  const B: number[] = [];
  let dropped = 0;
  for (const row of t.rows) {
    const x = row[ia];
    const y = row[ib];
    if (x === null || y === null) dropped++;
    else {
      A.push(x);
      B.push(y);
    }
  }
  const ba = blandAltman(A, B, mult);
  if (isErr(ba)) return refuse(ba.error);
  const scale = Math.max(...[ba.sd, Math.abs(ba.bias)].filter((v) => v > 0), 1e-12);
  const d = scale >= 100 ? 1 : scale >= 1 ? 2 : Math.min(6, 2 + Math.ceil(-Math.log10(scale)));
  const f = (v: number): string => fx(v, d);
  const u = units ? ` ${units}` : "";
  const nA = t.names[ia];
  const nB = t.names[ib];
  const lines = [
    `Bland–Altman analysis of ${nA} (A) against ${nB} (B), ${ba.n} pairs${dropped ? ` (${dropped} with a missing value left out)` : ""}; difference = A − B.`,
    `Bias (mean difference) ${f(ba.bias)}${u}, 95% CI ${f(ba.biasCi[0])} to ${f(ba.biasCi[1])}; SD of the differences ${f(ba.sd)}${u}.`,
    `95% limits of agreement (bias ± ${mult === 2 ? "2" : "1.96"}·SD): ${f(ba.lower)} to ${f(ba.upper)}${u}.`,
    `95% CI of the lower limit ${f(ba.lowerCi[0])} to ${f(ba.lowerCi[1])}; of the upper limit ${f(ba.upperCi[0])} to ${f(ba.upperCi[1])} (Bland & Altman 1999: SE ≈ SD·√(3/n), t on ${ba.n - 1} df).`,
    `Proportional bias: slope of the difference on the mean ${fx(ba.slope, 4)}, ${Number.isFinite(ba.slopeP) ? pText(ba.slopeP) : "not testable"}.`,
    "Whether the limits are narrow enough is a clinical judgement made before the study, not a statistical one.",
  ];
  const rows = [
    ["Quantity", `Value${u}`, "95% CI"],
    ["Bias (A − B)", f(ba.bias), `${f(ba.biasCi[0])} to ${f(ba.biasCi[1])}`],
    ["SD of differences", f(ba.sd), ""],
    ["Lower limit of agreement", f(ba.lower), `${f(ba.lowerCi[0])} to ${f(ba.lowerCi[1])}`],
    ["Upper limit of agreement", f(ba.upper), `${f(ba.upperCi[0])} to ${f(ba.upperCi[1])}`],
    ["Proportional bias (slope)", fx(ba.slope, 4), Number.isFinite(ba.slopeP) ? pText(ba.slopeP) : ""],
  ];
  const sideword = ba.bias < 0 ? `lower than ${nB}` : ba.bias > 0 ? `higher than ${nB}` : `the same as ${nB}`;
  const pv = Number.isFinite(ba.slopeP) ? verdict(ba.slopeP) : "none";
  const prop =
    !Number.isFinite(ba.slopeP)
      ? ""
      : pv === "clear"
        ? `, and the difference changes with the size of the measurement (proportional bias, ${pText(ba.slopeP)})`
        : pv === "borderline"
          ? `; the proportional-bias test gives ${pText(ba.slopeP)}, ${BOUNDARY_CLAUSE}`
          : `, with no evidence of proportional bias (${pText(ba.slopeP)})`;
  const reading = fitReading(
    `${nA} reads on average ${f(Math.abs(ba.bias))}${u} ${sideword} (bias ${f(ba.bias)}, 95% CI ${f(ba.biasCi[0])} to ${f(ba.biasCi[1])}); 95% of differences are expected between ${f(ba.lower)} and ${f(ba.upper)}${u}${prop}.`,
    `Bias ${f(ba.bias)}${u}; 95% of differences lie between ${f(ba.lower)} and ${f(ba.upper)}${u}${prop}.`,
  );
  const svg = blandAltmanSvg(ba.means, ba.diffs, ba.bias, ba.lower, ba.upper, f, units);
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "Bland–Altman", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------
// ICC

/** Shrout & Fleiss (1979, Psychol Bull 86:420), Table 2: six targets rated by four judges. */
export function iccDefaultTable(): string {
  const d = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
  ];
  return ["Target\tJudge1\tJudge2\tJudge3\tJudge4", ...d.map((r, i) => [`T${i + 1}`, ...r].join("\t"))].join("\n");
}

const ICC_FORMS = ["1,1", "2,1", "3,1", "1,k", "2,k", "3,k"];

function iccCalc(read: Read): StatOutput {
  const r = getter(read);
  const t = readNumTable(r("data"), "Data");
  if (isErr(t)) return refuse(t.error);
  const complete = t.rows.filter((row) => row.every((v) => v !== null)) as number[][];
  const dropped = t.rows.length - complete.length;
  const fit = iccFit(complete);
  if (isErr(fit)) return refuse(fit.error);
  const want = ICC_FORMS.includes(r("form")) ? r("form") : "2,1";
  const head = fit.rows.find((x) => x.form === `ICC(${want})`)!;
  const lines = [
    `Intraclass correlation, ${fit.n} targets × ${fit.k} raters${dropped ? ` (${dropped} target${dropped === 1 ? "" : "s"} with a missing rating left out)` : ""}.`,
    `Mean squares: targets ${fx(fit.msr, 4)}, raters ${fx(fit.msc, 4)}, residual ${fx(fit.mse, 4)}, within targets ${fx(fit.msw, 4)}.`,
    ...fit.rows.map((x) => `${x.form} (${x.description}) = ${fx(x.value, 3)}, 95% CI ${fxCi(x.lo, x.hi, 3)}.`),
    "Forms of Shrout & Fleiss (1979); intervals by the F method of McGraw & Wong (1996). Choose the form before looking at the numbers: (2,·) if the raters are a sample and absolute values matter, (3,·) if these raters are the only ones of interest.",
  ];
  const rows = [
    ["Form", "ICC", "95% CI", "F test", "p"],
    ...fit.rows.map((x) => [x.form, fx(x.value, 3), fxCi(x.lo, x.hi, 3), `F(${x.df1}, ${x.df2}) = ${fx(x.F, 2)}`, x.p < 0.001 ? P_BELOW : fmtP(x.p)]),
  ];
  const reading = fitReading(
    `${head.form} = ${fx(head.value, 3)} (95% CI ${fxCi(head.lo, head.hi, 3)}): ${kooLi(head.value)} reliability on the Koo & Li scale for ${head.description}.`,
  );
  const svg = iccProfileSvg(complete, t.names);
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "Intraclass correlation", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Meta-analysis

/** Colditz et al. (1994) BCG vaccine trials (as in metafor's dat.bcg): events and totals, vaccinated vs not. */
export function metaDefaultTable(): string {
  const bcg: [string, number, number, number, number][] = [
    ["Aronson 1948", 4, 119, 11, 128],
    ["Ferguson & Simes 1949", 6, 300, 29, 274],
    ["Rosenthal 1960", 3, 228, 11, 209],
    ["Hart & Sutherland 1977", 62, 13536, 248, 12619],
    ["Frimodt-Moller 1973", 33, 5036, 47, 5761],
    ["Stein & Aronson 1953", 180, 1361, 372, 1079],
    ["Vandiviere 1973", 8, 2537, 10, 619],
    ["TPT Madras 1980", 505, 87886, 499, 87892],
    ["Coetzee & Berjak 1968", 29, 7470, 45, 7232],
    ["Rosenthal 1961", 17, 1699, 65, 1600],
    ["Comstock 1974", 186, 50448, 141, 27197],
    ["Comstock & Webster 1969", 5, 2493, 3, 2338],
    ["Comstock 1976", 27, 16886, 29, 17825],
  ];
  return ["Study\tEvents (vaccinated)\tTotal (vaccinated)\tEvents (control)\tTotal (control)", ...bcg.map(([s, a, b, c, d]) => `${s}\t${a}\t${a + b}\t${c}\t${c + d}`)].join("\n");
}

interface MetaInput {
  names: string[];
  y: number[];
  v: number[];
  ratio: boolean;
  measureName: string;
  counts: CountStudy[] | null;
  measure: CountMeasure | null;
  notes: string[];
}

function readMetaInput(r: Read): MetaInput | { error: string } {
  const input = r("input");
  const raw = r("data");
  if (raw.length > CLIN_TEXT_MAX) return { error: "Data: the pasted table is too large." };
  const p = parseRegData(raw);
  if (!p.ok) return { error: `Data: ${p.reason}` };
  const rows = p.data.rows;
  if (rows.length > META_MAX_STUDIES) return { error: `Data: at most ${META_MAX_STUDIES} studies.` };
  const semi = !!p.data.semicolon;
  const need = input === "counts" ? 5 : input === "ci" ? 4 : 3;
  if (p.data.names.length < need) {
    return { error: `Data: ${input === "counts" ? "five columns (study, events and total in the treated arm, events and total in the control arm)" : input === "ci" ? "four columns (study, estimate, lower and upper 95% limits)" : "three columns (study, estimate, standard error)"} are needed.` };
  }
  const num = (c: string, i: number, what: string): number | { error: string } => {
    const v = readRegCell(c ?? "", semi).value;
    return Number.isFinite(v) ? v : { error: `Data, row ${i + 1}: the ${what} “${c ?? ""}” is not a number.` };
  };
  const names: string[] = [];
  const y: number[] = [];
  const v: number[] = [];
  const notes: string[] = [];
  if (input === "counts") {
    const m: CountMeasure = r("measure") === "rr" ? "rr" : r("measure") === "rd" ? "rd" : "or";
    const counts: CountStudy[] = [];
    let corrected = 0;
    for (const [i, row] of rows.entries()) {
      const vals: number[] = [];
      for (const [j, w] of ["treated events", "treated total", "control events", "control total"].entries()) {
        const x = num(row[j + 1], i, w);
        if (isErr(x)) return x;
        if (!(Number.isInteger(x) && x >= 0)) return { error: `Data, row ${i + 1}: the ${w} must be a whole number ≥ 0.` };
        vals.push(x);
      }
      const [e1, n1, e0, n0] = vals;
      if (e1 > n1 || e0 > n0) return { error: `Data, row ${i + 1}: more events than subjects in an arm.` };
      if (n1 === 0 || n0 === 0) return { error: `Data, row ${i + 1}: an arm with no subjects.` };
      const s: CountStudy = { name: row[0] || `Study ${i + 1}`, e1, n1, e0, n0 };
      const ef = countEffect(s, m);
      if ("skip" in ef) {
        notes.push(`Left out: ${ef.skip}.`);
        continue;
      }
      if (ef.corrected) corrected++;
      counts.push(s);
      names.push(s.name);
      y.push(ef.y);
      v.push(ef.v);
    }
    if (corrected) notes.push(`${corrected} stud${corrected === 1 ? "y has" : "ies have"} a zero cell: 0.5 added to every cell of ${corrected === 1 ? "it" : "each"} for the inverse-variance estimate (Haldane–Anscombe); Mantel–Haenszel uses the counts as entered.`);
    const mName = m === "or" ? "odds ratio" : m === "rr" ? "risk ratio" : "risk difference";
    return { names, y, v, ratio: m !== "rd", measureName: mName, counts, measure: m, notes };
  }
  const ratio = r("scale") === "ratio";
  for (const [i, row] of rows.entries()) {
    const est = num(row[1], i, "estimate");
    if (isErr(est)) return est;
    let se: number;
    let yy = est;
    if (ratio) {
      if (!(est > 0)) return { error: `Data, row ${i + 1}: a ratio must be positive (it is pooled on the log scale).` };
      yy = Math.log(est);
    }
    if (input === "ci") {
      const lo = num(row[2], i, "lower limit");
      if (isErr(lo)) return lo;
      const hi = num(row[3], i, "upper limit");
      if (isErr(hi)) return hi;
      if (!(lo < hi)) return { error: `Data, row ${i + 1}: the lower limit must be below the upper limit.` };
      if (ratio && !(lo > 0)) return { error: `Data, row ${i + 1}: a ratio's confidence limits must be positive.` };
      se = ratio ? (Math.log(hi) - Math.log(lo)) / (2 * 1.959963984540054) : (hi - lo) / (2 * 1.959963984540054);
      if (!(est >= lo && est <= hi)) notes.push(`Row ${i + 1}: the estimate lies outside its own interval; check the columns.`);
    } else {
      const s = num(row[2], i, "standard error");
      if (isErr(s)) return s;
      se = s;
    }
    if (!(se > 0)) return { error: `Data, row ${i + 1}: the standard error must be positive.` };
    names.push(row[0] || `Study ${i + 1}`);
    y.push(yy);
    v.push(se * se);
  }
  if (input === "ci") notes.push(`Standard errors recovered from the 95% limits${ratio ? " on the log scale" : ""}: SE = (upper − lower)/(2 × 1.96).`);
  return { names, y, v, ratio, measureName: ratio ? "ratio" : "effect", counts: null, measure: null, notes };
}

const tr = (ratio: boolean) => (x: number): number => (ratio ? Math.exp(x) : x);

function metaCalc(read: Read): StatOutput {
  const r = getter(read);
  const mi = readMetaInput(r);
  if (isErr(mi)) return refuse(mi.error);
  const tauMethod = r("tau") === "reml" ? "reml" : "dl";
  let fixedOverride: Pooled | undefined;
  let fixedName = "inverse variance";
  if (mi.counts && mi.measure && r("fixed") === "mh") {
    const mh = mantelHaenszel(mi.counts, mi.measure);
    if (isErr(mh)) return refuse(mh.error);
    fixedOverride = mh;
    fixedName = "Mantel–Haenszel";
  }
  const fit = metaAnalyze(mi.y, mi.v, tauMethod, fixedOverride);
  if (isErr(fit)) return refuse(fit.error);
  const T = tr(mi.ratio);
  const d = mi.ratio ? 2 : 3;
  const f = (x: number): string => fx(T(x), d);
  const ci = (lo: number, hi: number): string => `${f(lo)} to ${f(hi)}`;
  const tauName = tauMethod === "reml" ? "REML" : "DerSimonian–Laird";
  const scaleNote = mi.ratio ? " (pooled on the log scale, shown as ratios)" : "";
  const lines = [
    `Meta-analysis of ${fit.k} studies, ${mi.measureName}${scaleNote}.`,
    `Fixed effect (${fixedName}): ${f(fit.fixed.est)}, 95% CI ${ci(fit.fixed.lo, fit.fixed.hi)}, ${pText(fit.fixed.p)}.`,
    `Random effects (${tauName} τ²): ${f(fit.random.est)}, 95% CI ${ci(fit.random.lo, fit.random.hi)}, ${pText(fit.random.p)}.`,
    `Heterogeneity: Q = ${fx(fit.Q, 2)} on ${fit.df} df, ${pText(fit.pQ)}; I² = ${pct(fit.i2)}${fit.i2Lo !== null && fit.i2Hi !== null ? ` (95% CI ${pctCi(fit.i2Lo, fit.i2Hi)}, Higgins & Thompson 2002)` : " (no interval with two studies)"}; τ² = ${fx(fit.tau2, 4)}${mi.ratio ? " (log scale)" : ""}.`,
    fit.pi ? `95% prediction interval for a new study's true effect: ${ci(fit.pi.lo, fit.pi.hi)} (t on ${fit.k - 2} df).` : "No prediction interval with two studies (it needs t on k − 2 df).",
    ...mi.notes,
  ];
  if (fit.tau2 === 0) lines.push("τ² is 0: the studies vary no more than chance predicts, so the random-effects estimate equals the inverse-variance fixed-effect one.");
  if (mi.counts && fixedOverride) lines.push("Mantel–Haenszel: Robins–Breslow–Greenland variance (OR), Greenland–Robins (RR, RD). Q, I² and τ² use the inverse-variance study estimates.");
  const studyRows = mi.names.map((nm, i) => {
    const se = Math.sqrt(mi.v[i]);
    return [nm, f(mi.y[i]), ci(mi.y[i] - 1.959963984540054 * se, mi.y[i] + 1.959963984540054 * se), fx(fit.wFixed[i], 1), fx(fit.wRandom[i], 1)];
  });
  const tables: StatTable[] = [
    { label: "Studies", rows: [["Study", "Estimate", "95% CI", "Weight, fixed (%)", "Weight, random (%)"], ...studyRows] },
    {
      label: "Pooled estimates",
      rows: [
        ["Model", "Estimate", "95% CI", "p"],
        [`Fixed (${fixedName})`, f(fit.fixed.est), ci(fit.fixed.lo, fit.fixed.hi), fit.fixed.p < 0.001 ? P_BELOW : fmtP(fit.fixed.p)],
        [`Random (${tauName})`, f(fit.random.est), ci(fit.random.lo, fit.random.hi), fit.random.p < 0.001 ? P_BELOW : fmtP(fit.random.p)],
        ...(fit.pi ? [["Prediction interval", "", ci(fit.pi.lo, fit.pi.hi), ""]] : []),
      ],
    },
  ];
  const v = verdict(fit.random.p);
  const est = T(fit.random.est);
  const nullV = mi.ratio ? 1 : 0;
  const dir = est < nullV ? "a reduction" : est > nullV ? "an increase" : "no change";
  const sig = v === "clear" ? `${dir} unlikely to be chance (${pText(fit.random.p)})` : v === "borderline" ? `${dir}, ${pText(fit.random.p)}, ${BOUNDARY_CLAUSE}` : `${dir} that could be chance (${pText(fit.random.p)})`;
  const het = fit.i2 >= 0.75 ? "large" : fit.i2 >= 0.5 ? "substantial" : fit.i2 >= 0.25 ? "moderate" : "low";
  const reading = fitReading(
    `Pooled across ${fit.k} studies, the random-effects ${mi.measureName} is ${f(fit.random.est)} (95% CI ${ci(fit.random.lo, fit.random.hi)}), ${sig}; heterogeneity is ${het} (I² = ${pct(fit.i2)})${fit.pi ? `, and a new study's true effect could lie anywhere from ${ci(fit.pi.lo, fit.pi.hi)}` : ""}.`,
    `Random-effects ${mi.measureName} ${f(fit.random.est)} (95% CI ${ci(fit.random.lo, fit.random.hi)}), ${sig}; I² = ${pct(fit.i2)}.`,
  );
  const forestRows = mi.names.map((nm, i) => {
    const se = Math.sqrt(mi.v[i]);
    return { label: nm, estimate: T(mi.y[i]), low: T(mi.y[i] - 1.959963984540054 * se), high: T(mi.y[i] + 1.959963984540054 * se) };
  });
  const pooledRows = [
    { label: `Fixed (${fixedName === "Mantel–Haenszel" ? "MH" : "IV"})`, estimate: T(fit.fixed.est), low: T(fit.fixed.lo), high: T(fit.fixed.hi) },
    { label: `Random (${tauMethod === "reml" ? "REML" : "DL"})`, estimate: T(fit.random.est), low: T(fit.random.lo), high: T(fit.random.hi) },
  ];
  if (fit.pi) pooledRows.push({ label: "Prediction", estimate: T(fit.random.est), low: T(fit.pi.lo), high: T(fit.pi.hi) });
  const xl = mi.ratio ? `${mi.measureName === "ratio" ? "Ratio" : mi.measureName[0].toUpperCase() + mi.measureName.slice(1)} (log scale)` : mi.measureName === "risk difference" ? "Risk difference" : "Effect";
  const svg = metaForestSvg(forestRows, pooledRows, { xlabel: xl, log: mi.ratio });
  return { text: lines.join("\n"), reading, svg, tables };
}

function eggerCalc(read: Read): StatOutput {
  const r = getter(read);
  const mi = readMetaInput(r);
  if (isErr(mi)) return refuse(mi.error);
  const eg = eggerTest(mi.y, mi.v);
  if (isErr(eg)) return refuse(eg.error);
  const fit = metaAnalyze(mi.y, mi.v, "dl");
  if (isErr(fit)) return refuse(fit.error);
  const lines = [
    `Egger's regression test for small-study effects, ${eg.k} studies (${mi.measureName}${mi.ratio ? ", log scale" : ""}): the standardised effect y/SE regressed on the precision 1/SE.`,
    `Intercept ${fx(eg.intercept, 3)} (SE ${fx(eg.se, 3)}, 95% CI ${fxCi(eg.lo, eg.hi, 3)}), t = ${fx(eg.t, 2)} on ${eg.df} df, ${pText(eg.p)}.`,
    "An intercept away from 0 means small studies show different effects from large ones: publication bias is one cause, but so are genuine differences in the patients or methods of smaller studies.",
    ...mi.notes,
  ];
  const rows = [
    ["Quantity", "Value", "95% CI"],
    ["Egger intercept", fx(eg.intercept, 3), fxCi(eg.lo, eg.hi, 3)],
    ["t test", `t(${eg.df}) = ${fx(eg.t, 2)}`, pText(eg.p)],
    ["Slope (precision)", fx(eg.slope, 3), ""],
  ];
  const v = verdict(eg.p);
  const reading = fitReading(
    v === "clear"
      ? `Egger's test finds funnel-plot asymmetry (intercept ${fx(eg.intercept, 2)}, ${pText(eg.p)}): small studies report different effects from large ones, which can reflect publication bias or real differences between them.`
      : v === "borderline"
        ? `Egger's test gives intercept ${fx(eg.intercept, 2)} with ${pText(eg.p)}, ${BOUNDARY_CLAUSE} for funnel-plot asymmetry.`
        : `Egger's test finds no clear funnel-plot asymmetry (intercept ${fx(eg.intercept, 2)}, ${pText(eg.p)}), though with ${eg.k} studies it has limited power to detect it.`,
  );
  const xl = mi.ratio ? `${mi.measureName === "ratio" ? "Ratio" : mi.measureName[0].toUpperCase() + mi.measureName.slice(1)} (log scale)` : "Effect";
  const svg = funnelSvg(mi.y, mi.v.map(Math.sqrt), fit.fixed.est, mi.ratio, xl);
  return { text: lines.join("\n"), reading, svg, tables: [{ label: "Egger's test", rows }] };
}

// ---------------------------------------------------------------------------------------------------------------

const META_FIELDS = (): StatCalcDef["fields"] => [
  { key: "data", label: "Studies: one row each (see the input type), a header row first", default: metaDefaultTable(), kind: "block" },
  {
    key: "input",
    label: "Input",
    default: "counts",
    kind: "select",
    options: [
      { value: "counts", label: "2×2 counts: study, events and total (treated), events and total (control)" },
      { value: "se", label: "Effect and SE: study, estimate, standard error" },
      { value: "ci", label: "Effect and 95% CI: study, estimate, lower, upper" },
    ],
  },
  {
    key: "measure",
    label: "Measure (2×2 counts)",
    default: "rr",
    kind: "select",
    options: [
      { value: "or", label: "Odds ratio" },
      { value: "rr", label: "Risk ratio" },
      { value: "rd", label: "Risk difference" },
    ],
  },
  {
    key: "scale",
    label: "Scale (effect input)",
    default: "ratio",
    kind: "select",
    options: [
      { value: "ratio", label: "Ratio (OR, RR, HR: pooled on the log scale)" },
      { value: "diff", label: "Difference (mean difference, log ratio already taken, …)" },
    ],
  },
];

export const CLINICAL_STAT_CALCS: StatCalcDef[] = [
  {
    id: "clin-diag",
    name: "Diagnostic test accuracy (sensitivity, PPV, LRs)",
    fields: [
      {
        key: "mode",
        label: "Input",
        default: "table",
        kind: "select",
        options: [
          { value: "table", label: "2×2 counts (TP, FP, FN, TN)" },
          { value: "rates", label: "Sensitivity, specificity and prevalence" },
        ],
      },
      { key: "tp", label: "True positives (TP): test +, condition present", default: "90", kind: "text" },
      { key: "fp", label: "False positives (FP): test +, condition absent", default: "30", kind: "text" },
      { key: "fn", label: "False negatives (FN): test −, condition present", default: "10", kind: "text" },
      { key: "tn", label: "True negatives (TN): test −, condition absent", default: "170", kind: "text" },
      { key: "ci", label: "Interval for proportions", default: "wilson", kind: "select", options: CI_OPTIONS },
      { key: "prev2", label: "PPV and NPV at another prevalence (2×2 input; blank = none)", default: "10%", kind: "text" },
      { key: "sens", label: "Sensitivity (rates input)", default: "90%", kind: "text" },
      { key: "spec", label: "Specificity (rates input)", default: "85%", kind: "text" },
      { key: "prev", label: "Prevalence (rates input)", default: "10%", kind: "text" },
      { key: "pretest", label: "Pre-test probability for the Fagan nomogram (blank = the prevalence)", default: "", kind: "text" },
    ],
    compute: (r) => diagCalc(r),
  },
  {
    id: "clin-roc",
    name: "ROC curve and AUC (DeLong)",
    fields: [
      { key: "data", label: "Data: a header row, then one row per case (a 0/1 outcome column and score columns)", default: rocDefaultTable(), kind: "block" },
      { key: "outcome", label: "Outcome column (1 = has the condition, 0 = does not)", default: "disease", kind: "text" },
      { key: "score", label: "Score column", default: "rating", kind: "text" },
      { key: "score2", label: "Second score column, for DeLong's paired comparison (blank = none)", default: "", kind: "text" },
      {
        key: "direction",
        label: "Direction",
        default: "higher",
        kind: "select",
        options: [
          { value: "higher", label: "Higher score = more likely to have the condition" },
          { value: "lower", label: "Lower score = more likely to have the condition" },
        ],
      },
    ],
    compute: (r) => rocCalc(r),
  },
  {
    id: "clin-dta-n",
    name: "Diagnostic study sample size (Buderer)",
    fields: [
      { key: "sens", label: "Expected sensitivity", default: "90%", kind: "text" },
      { key: "spec", label: "Expected specificity", default: "85%", kind: "text" },
      { key: "prev", label: "Prevalence in the study population", default: "20%", kind: "text" },
      { key: "d", label: "Precision: half-width of the 95% CI (e.g. 5%)", default: "5%", kind: "text" },
    ],
    compute: (r) => budererCalc(r),
  },
  {
    id: "clin-2x2",
    name: "Risk ratio, odds ratio and NNT (2×2)",
    fields: [
      { key: "table", label: "2×2 counts: row 1 exposed / treated, row 2 unexposed / control; columns: event, no event", default: "15, 85\n30, 70", kind: "groups", table: "counts" },
      {
        key: "design",
        label: "Study design",
        default: "cohort",
        kind: "select",
        options: [
          { value: "cohort", label: "Cohort study or trial (risks, RR, RD, NNT, OR)" },
          { value: "casecontrol", label: "Case-control (columns: cases, controls; OR only)" },
        ],
      },
      {
        key: "event",
        label: "The event is",
        default: "adverse",
        kind: "select",
        options: [
          { value: "adverse", label: "Adverse (death, relapse): fewer in row 1 is a benefit" },
          { value: "good", label: "Desired (cure, response): more in row 1 is a benefit" },
        ],
      },
      {
        key: "rdci",
        label: "Risk difference interval",
        default: "newcombe",
        kind: "select",
        options: [
          { value: "newcombe", label: "Newcombe hybrid score (default)" },
          { value: "wald", label: "Wald" },
        ],
      },
    ],
    compute: (r) => epiCalc(r),
  },
  {
    id: "clin-rate",
    name: "Incidence rate ratio (person-time)",
    fields: [
      { key: "e1", label: "Events, group 1 (exposed / treated)", default: "41", kind: "text" },
      { key: "t1", label: "Person-time, group 1", default: "28010", kind: "text" },
      { key: "e0", label: "Events, group 2 (reference)", default: "15", kind: "text" },
      { key: "t0", label: "Person-time, group 2", default: "19017", kind: "text" },
      { key: "unit", label: "Person-time unit", default: "person-years", kind: "text" },
      {
        key: "per",
        label: "Express rates per",
        default: "1000",
        kind: "select",
        options: ["1", "100", "1000", "10000", "100000"].map((v) => ({ value: v, label: intText(Number(v)) })),
      },
    ],
    compute: (r) => rateCalc(r),
  },
  {
    id: "clin-kappa",
    name: "Cohen's kappa (unweighted and weighted)",
    fields: [
      { key: "table", label: "Agreement table: rows rater A, columns rater B, categories in the same order", default: "22, 2, 2\n2, 8, 2\n4, 4, 14", kind: "groups", table: "counts" },
      {
        key: "weight",
        label: "Weights",
        default: "none",
        kind: "select",
        options: [
          { value: "none", label: "Unweighted (nominal categories)" },
          { value: "linear", label: "Linear (ordered categories)" },
          { value: "quadratic", label: "Quadratic (ordered categories)" },
        ],
      },
      { key: "categories", label: "Category names, separated by commas (blank = Category 1, 2, …)", default: "Normal, Benign, Malignant", kind: "text" },
    ],
    compute: (r) => kappaCalc(r),
  },
  {
    id: "clin-bland",
    name: "Bland–Altman method comparison",
    fields: [
      { key: "data", label: "Data: a header row, then one row per subject with the two methods' measurements", default: baDefaultTable(), kind: "block" },
      { key: "a", label: "Method A column", default: "Wright", kind: "text" },
      { key: "b", label: "Method B column", default: "Mini", kind: "text" },
      { key: "units", label: "Units (for the labels)", default: "L/min", kind: "text" },
      {
        key: "mult",
        label: "Limits of agreement",
        default: "1.96",
        kind: "select",
        options: [
          { value: "1.96", label: "Bias ± 1.96 SD" },
          { value: "2", label: "Bias ± 2 SD (as Bland & Altman 1986)" },
        ],
      },
    ],
    compute: (r) => blandCalc(r),
  },
  {
    id: "clin-icc",
    name: "Intraclass correlation (ICC)",
    fields: [
      { key: "data", label: "Ratings: a header row of rater names, then one row per target (a first column of target labels is allowed)", default: iccDefaultTable(), kind: "block" },
      {
        key: "form",
        label: "Headline form",
        default: "2,1",
        kind: "select",
        options: [
          { value: "1,1", label: "ICC(1,1): one-way random, single rater" },
          { value: "2,1", label: "ICC(2,1): two-way random, absolute agreement, single rater" },
          { value: "3,1", label: "ICC(3,1): two-way mixed, consistency, single rater" },
          { value: "1,k", label: "ICC(1,k): one-way random, mean of k raters" },
          { value: "2,k", label: "ICC(2,k): two-way random, absolute agreement, mean of k raters" },
          { value: "3,k", label: "ICC(3,k): two-way mixed, consistency, mean of k raters" },
        ],
      },
    ],
    compute: (r) => iccCalc(r),
  },
  {
    id: "clin-meta",
    name: "Meta-analysis (fixed and random effects, forest plot)",
    fields: [
      ...META_FIELDS(),
      {
        key: "fixed",
        label: "Fixed-effect method (2×2 counts)",
        default: "mh",
        kind: "select",
        options: [
          { value: "mh", label: "Mantel–Haenszel" },
          { value: "iv", label: "Inverse variance" },
        ],
      },
      {
        key: "tau",
        label: "Between-study variance τ²",
        default: "dl",
        kind: "select",
        options: [
          { value: "dl", label: "DerSimonian–Laird" },
          { value: "reml", label: "REML" },
        ],
      },
    ],
    compute: (r) => metaCalc(r),
  },
  {
    id: "clin-egger",
    name: `Small-study effects (Egger's test, funnel plot; ≥ ${EGGER_MIN_STUDIES} studies)`,
    fields: META_FIELDS(),
    compute: (r) => eggerCalc(r),
  },
];
