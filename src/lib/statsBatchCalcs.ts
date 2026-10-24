// The two Stats calculators added in v2.134.0 — repeated-measures ANOVA and
// Cox regression — as PURE functions: field text → numbers, result → report
// text, result → figure.
//
// WHY THIS IS NOT IN taskpane.ts. Nothing can import the pane in a test (it
// loads Office.js), so a parser or report builder written there is invisible
// to every test in the repo. The pane's registry entries call these and do
// nothing else.
//
// Brief: docs/SCOPE-STATS-BATCH.md §B1 (Cox), §B3 (RM ANOVA), §E7 (display
// contract), finding 7 / §E8 (the hazard-ratio forest plot is on a LOG axis).

import { rmAnova, type RmAnovaResult, type RmWithinTest, type RmCorrectedTest } from "./rmAnova";
import {
  coxRegression,
  coxReportLines,
  coxForestData,
  coxCurveProfiles,
  coxAdjustedSurvival,
  type CoxInput,
  type CoxFit,
  type CoxTies,
} from "./cox";
import { readNumberList } from "./numberList";
import { parseCellNumber } from "./dataimport";
import { buildPlotSvg, combineSvgs, type Series } from "./plot";
import { forestPlotSvg } from "./statchart";
import { formatNum } from "./linalg";

/**
 * An em dash in a Stats result is the pane's NON-FINITE sentinel and blocks
 * insertion (insertableResultText). Both engines write prose with em dashes,
 * so every line leaving this module goes through this — the pane's
 * plainDashes, the same mapping.
 */
export function plainText(s: string): string {
  return s.replace(/—/g, "-");
}

const isNum = (t: string): boolean => Number.isFinite(parseCellNumber(t));

/** 3 significant figures, never exponent noise below 1e-4 (that is "p < 0.0001"). */
export function pText(p: number): string {
  if (!Number.isFinite(p)) return "p = n/a";
  if (p < 1e-4) return "p < 0.0001";
  return `p = ${Number(p.toPrecision(3))}`;
}

/** Significant figures without trailing-zero noise. */
function sig(x: number, n = 4): string {
  if (!Number.isFinite(x)) return "n/a";
  // formatNum: the same digits, with a true minus and ×10ⁿ (v2.193.0: "mean difference -1.5, t(7) = -1.122").
  return formatNum(x, n);
}

/** A typed condition/column name made into one token that can never read as a number. */
export function safeName(s: string): string {
  const t = s.trim().replace(/[\s,;]+/g, "_");
  return isNum(t) ? `C${t}` : t;
}

// ===========================================================================
// Repeated-measures ANOVA
// ===========================================================================

export interface RmField {
  rows: number[][];
  groups?: string[];
  /** Condition names, from a first line of names; else "condition 1" … */
  conditions: string[];
}

/**
 * The `rmanova` field: an optional FIRST line of condition names (no number in
 * it), then one line per subject — an optional between-subject label as the
 * FIRST token (must not be a number: "Drug 10 12 14"), then one value per
 * condition. Values follow the product comma rule. A non-numeric value is
 * refused BY SUBJECT: missing cells are not dropped (rmAnova refuses them too).
 */
export function readRmField(text: string): RmField | { error: string } {
  const lines = text
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { error: "Enter one row per subject: one value per condition." };
  let names: string[] | null = null;
  const first = lines[0].split(/\s+/);
  if (first.every((t) => !isNum(t))) {
    names = first;
    lines.shift();
  }
  const rows: number[][] = [];
  const labels: (string | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    const toks = lines[i].split(/\s+/);
    let label: string | null = null;
    if (!isNum(toks[0])) label = toks.shift() as string;
    const r = readNumberList(toks.join(" "));
    if (r.dropped.length) {
      return {
        error:
          `Subject ${i + 1} ("${lines[i]}"): "${r.dropped[0]}" is not a number. Missing cells are refused, not dropped — ` +
          "a linear mixed model handles missing visits; this calculator does not.",
      };
    }
    rows.push(r.values);
    labels.push(label);
  }
  const labelled = labels.filter((l) => l !== null).length;
  if (labelled && labelled < labels.length) {
    const i = labels.findIndex((l) => l === null);
    return {
      error: `Subject ${i + 1} has no group label, but other subjects do. Give every subject a group (e.g. "Drug 10 12 14") or none.`,
    };
  }
  const k = rows.length ? rows[0].length : 0;
  const conditions =
    names && names.length === k ? names.map((n) => n.replace(/_/g, " ")) : Array.from({ length: k }, (_, j) => `condition ${j + 1}`);
  return { rows, groups: labelled ? (labels as string[]) : undefined, conditions };
}

/** The field text the table feed produces, with the condition names as a first line. */
export function rmFieldText(conditions: string[], feedText: string): string {
  return [conditions.map(safeName).join(" "), feedText].join("\n");
}

const cName = (f: RmField, j: number): string => f.conditions[j - 1] ?? `condition ${j}`;
const df2 = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2));

function correctedLine(name: string, f: number, t: RmCorrectedTest, epsName: string): string {
  return `${name}: F(${df2(t.df1)}, ${df2(t.df2)}) = ${sig(f, 4)}, ${pText(t.p)} (${epsName} = ${t.epsilon.toFixed(4)})`;
}

function withinLines(label: string, w: RmWithinTest, k: number): string[] {
  const out = [
    `${label}: F(${df2(w.df1)}, ${df2(w.df2)}) = ${sig(w.f, 4)}, ${pText(w.p)} (sphericity assumed); partial η² = ${sig(w.partialEta2, 4)}`,
  ];
  if (k > 2) {
    out.push("  " + correctedLine("Greenhouse–Geisser", w.f, w.gg, "ε(GG)"));
    out.push(
      w.hf
        ? "  " + correctedLine("Huynh–Feldt", w.f, w.hf, w.hf.epsilon >= 1 ? "ε(HF), capped at 1" : "ε(HF)")
        : "  Huynh–Feldt: undefined at this sample size",
    );
    out.push("  " + correctedLine("Lower bound", w.f, w.lowerBound, "ε"));
  }
  const leadName =
    w.lead === "uncorrected" ? "uncorrected (2 conditions: sphericity holds)" : w.lead === "gg" ? "Greenhouse–Geisser" : w.lead === "hf" ? "Huynh–Feldt" : "lower bound";
  out.push(`  Reported p (${leadName}): ${pText(w.leadP)}`);
  return out;
}

/** The result text. Every line is display-contract clean and insertable. */
export function rmAnovaReport(res: RmAnovaResult, f: RmField): string {
  const L: string[] = [];
  const k = res.nConditions;
  if (res.design === "mixed") {
    L.push(
      `Repeated-measures ANOVA, mixed design: ${res.nSubjects} subjects in ${res.groupLabels.length} groups ` +
        `(${res.groupLabels.map((g, i) => `${g} n = ${res.groupSizes[i]}`).join("; ")}) × ${k} conditions`,
    );
  } else {
    L.push(`Repeated-measures ANOVA: ${res.nSubjects} subjects × ${k} conditions`);
  }
  L.push("");
  L.push("Condition means (all subjects):");
  for (const d of res.descriptives) L.push(`  ${cName(f, d.condition)}: mean ${sig(d.mean)}, SD ${sig(d.sd)}, n = ${d.n}`);
  if (res.cellDescriptives.length) {
    L.push("Group × condition means:");
    for (const d of res.cellDescriptives) L.push(`  ${d.group}, ${cName(f, d.condition)}: mean ${sig(d.mean)}, SD ${sig(d.sd)}, n = ${d.n}`);
  }
  L.push("");
  L.push("ANOVA table:");
  for (const r of res.table) {
    L.push(
      `  ${r.source}: SS = ${sig(r.ss, 5)}, df = ${r.df}, MS = ${sig(r.ms, 5)}` +
        (r.f !== null ? `, F = ${sig(r.f, 4)}, ${pText(r.p as number)}` : ""),
    );
  }
  L.push("");
  if (res.between) {
    L.push(
      `Between groups: F(${res.between.df1}, ${res.between.df2}) = ${sig(res.between.f, 4)}, ${pText(res.between.p)}; partial η² = ${sig(res.between.partialEta2, 4)}`,
    );
  } else if (res.design === "mixed") {
    L.push("Between groups: F undefined (see notes)");
  }
  L.push(...withinLines("Conditions", res.within, k));
  if (res.interaction) L.push(...withinLines("Group × conditions", res.interaction, k));
  L.push("");
  const m = res.mauchly;
  if (m.status === "ok") {
    L.push(`Sphericity: W = ${sig(m.W, 4)}, χ²(${m.df}) = ${sig(m.chi2, 4)}, ${pText(m.p)} (${m.method})`);
  } else {
    L.push(/^Mauchly/.test(m.reason) ? m.reason : `Mauchly's test: ${m.reason}`);
  }
  const e = res.epsilon;
  if (k > 2) {
    const hf =
      e.hfRaw === null
        ? "Huynh–Feldt undefined"
        : `Huynh–Feldt ${e.hfRaw.toFixed(4)}${e.hfRaw > 1 ? " (raw; capped at 1 for the df)" : ""}` +
          (res.design === "mixed" && e.hfOriginalRaw !== null ? `; original SPSS form ${e.hfOriginalRaw.toFixed(4)}` : "");
    L.push(`ε: Greenhouse–Geisser ${e.gg.toFixed(4)}; ${hf}; lower bound ${e.lowerBound.toFixed(4)}${e.reliable ? "" : " (ε unreliable: singular contrast covariance)"}`);
    L.push(`Huynh–Feldt formula: ${e.hfFormula}.`);
  }
  L.push(res.leadRule);
  if (res.posthoc) {
    L.push("");
    L.push(`Post-hoc: ${res.posthocMethod}:`);
    for (const r of res.posthoc) {
      const pair = `${cName(f, r.a)} vs ${cName(f, r.b)}`;
      L.push(
        r.t === null
          ? `  ${pair}: mean difference ${sig(r.meanDiff)}; ${r.note ?? "no paired t"}`
          : `  ${pair}: mean difference ${sig(r.meanDiff)}, t(${r.df}) = ${sig(r.t, 4)}, ${pText(r.p as number)}, Holm ${pText(r.pAdj as number)}`,
      );
    }
  }
  L.push("");
  L.push(`Sums of squares: ${res.ssConvention}`);
  if (res.notes.length) {
    L.push("");
    for (const n of res.notes) L.push(n);
  }
  L.push("");
  L.push(
    "One within factor, optionally one between factor; no two within factors, no covariates. Missing cells are refused by subject: a linear mixed model handles missing visits.",
  );
  return plainText(L.join("\n"));
}

const GROUP_COLORS = ["#2563eb", "#b91c1c", "#047857", "#7c3aed", "#b45309", "#0f766e"];

/** Profile plot: condition means ± Cousineau–Morey 95% CI per group, faint subject lines behind. */
export function rmProfileSvg(res: RmAnovaResult, f: RmField): string {
  const k = res.nConditions;
  const pr = res.profile;
  const series: Series[] = [];
  for (const line of pr.subjectLines) {
    series.push({ type: "line", points: line.map((y, j) => ({ x: j + 1, y })), color: "#d4d4d8" });
  }
  pr.series.forEach((s, i) => {
    const c = GROUP_COLORS[i % GROUP_COLORS.length];
    const label = s.group ? `${s.group} (n = ${s.n})` : `mean (n = ${s.n})`;
    series.push({ type: "line", points: s.means.map((y, j) => ({ x: j + 1, y })), color: c });
    series.push({
      type: "scatter",
      points: s.means.map((y, j) => ({ x: j + 1, y, err: s.ciHalfWidths[j] })),
      color: c,
      label,
    });
  });
  const notes = [`Error bars: ${pr.ciMethod}.`, "Grey lines: individual subjects."];
  if (pr.subjectLinesCapped) notes.push(`Showing the first ${pr.subjectLines.length} of ${pr.subjectLinesTotal} subject lines.`);
  return buildPlotSvg(series, {
    width: 360,
    height: 240,
    title: "Profile plot",
    xlabel: "Condition",
    ylabel: "Mean",
    errorBars: "ci95",
    // A cut label says so with an ellipsis ("Baseline vi…"), never a silent chop.
    xTickLabel: (v) => {
      if (!(Number.isInteger(v) && v >= 1 && v <= k)) return "";
      const nm = cName(f, v);
      return nm.length > 12 ? `${nm.slice(0, 11)}…` : nm;
    },
    notes,
  });
}

export interface RmOutput {
  text: string;
  ok: boolean;
  svg?: string;
}

/** Field text → the calculator's whole output. */
export function rmAnovaCalc(text: string, posthoc: "holm" | "none"): RmOutput {
  const f = readRmField(text);
  if ("error" in f) return { text: f.error, ok: false };
  const res = rmAnova(f.rows, f.groups, { posthoc });
  if (!res.ok) return { text: plainText(res.reason), ok: false };
  return { text: rmAnovaReport(res, f), ok: true, svg: rmProfileSvg(res, f) };
}

// ===========================================================================
// Cox regression
// ===========================================================================

/**
 * The `cox` field: a HEADER line of names (time, event, then one per
 * covariate), then one row per subject. Values follow the product comma rule.
 * Every row must have exactly as many numbers as there are names.
 *
 * When the text is exactly what the table feed produced, `memo` carries the
 * feed's own CoxInput — with its factor metadata (Stage: reference I; II, III,
 * IV as indicators), which the field's numbers alone cannot carry. Typing over
 * the text drops it, and the indicators are then plain 0/1 covariates.
 */
export function readCoxField(text: string, memo?: { text: string; input: CoxInput } | null): CoxInput | { error: string } {
  if (memo && memo.text === text) return memo.input;
  const lines = text
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { error: "Enter a header line (time event covariates…) and one row per subject." };
  const names = lines[0].split(/[\s,]+/).filter(Boolean);
  if (!names.length || names.some(isNum)) {
    return {
      error:
        "The first line names the columns: time, event, then each covariate (e.g. \"time status age dose\"). " +
        "Numbers come on the lines after it, one subject per line.",
    };
  }
  if (names.length < 3) return { error: "Cox regression needs at least one covariate beside time and event." };
  const width = names.length;
  const times: number[] = [];
  const events: number[] = [];
  const cols: number[][] = Array.from({ length: width - 2 }, () => []);
  for (let i = 1; i < lines.length; i++) {
    const r = readNumberList(lines[i]);
    if (r.dropped.length) {
      return { error: `Row ${i} ("${lines[i]}"): "${r.dropped[0]}" is not a number. Rows are not dropped silently — fill it in or remove the row.` };
    }
    if (r.values.length !== width) {
      return {
        error: `Row ${i} ("${lines[i]}") has ${r.values.length} number${r.values.length === 1 ? "" : "s"}; the header names ${width} columns (${names.join(", ")}).`,
      };
    }
    times.push(r.values[0]);
    events.push(r.values[1]);
    for (let j = 2; j < width; j++) cols[j - 2].push(r.values[j]);
  }
  return { times, events, covariates: names.slice(2).map((name, j) => ({ name, values: cols[j] })) };
}

/** Forest plot (log axis) and adjusted survival curves, one document. */
export function coxFigureSvg(fit: CoxFit): string {
  return combineSvgs(coxFigureParts(fit)).svg;
}

/**
 * The two panels separately — the figure-layout gate measures each one (it
 * does not follow combineSvgs' nested-<svg> offsets).
 */
export function coxFigureParts(fit: CoxFit): [string, string] {
  const forest = forestPlotSvg(
    coxForestData(fit).map((r) => ({ label: r.label, estimate: r.hr, low: r.lo, high: r.hi })),
    { log: true, zero: 1, title: "Hazard ratios (95% CI)", xlabel: "Hazard ratio" },
  );
  const prof = coxCurveProfiles(fit);
  const curves: Series[] = prof.profiles.map((p, i) => ({
    type: "line",
    points: coxAdjustedSurvival(fit, p.x).flatMap((pt, j, all) =>
      // A step curve: hold each value until the next event time.
      j === 0 ? [{ x: pt.time, y: pt.survival }] : [{ x: pt.time, y: all[j - 1].survival }, { x: pt.time, y: pt.survival }],
    ),
    color: GROUP_COLORS[i % GROUP_COLORS.length],
    label: p.label,
  }));
  const surv = buildPlotSvg(curves, {
    width: 340,
    height: 230,
    title: "Adjusted survival",
    xlabel: "Time",
    ylabel: "Survival",
    notes: [plainText(prof.legendNote)],
  });
  return [forest, surv];
}

export interface CoxOutput {
  text: string;
  ok: boolean;
  svg?: string;
}

/** Field text → the calculator's whole output. */
export function coxCalc(text: string, ties: CoxTies, memo?: { text: string; input: CoxInput } | null): CoxOutput {
  const input = readCoxField(text, memo);
  if ("error" in input) return { text: input.error, ok: false };
  const fit = coxRegression(input, { ties });
  if (!fit.ok) return { text: plainText(fit.reason), ok: false };
  // cox.ts's caveats already carry the honest limits (ties, Wald CI,
  // concordance ≠ calibration, Peto vs Cox HR, the PH-test variant, and what
  // is not supported) — printed as they are, not restated.
  const lines = [...coxReportLines(fit), "", ...fit.caveats];
  return { text: plainText(lines.join("\n")), ok: true, svg: coxFigureSvg(fit) };
}
