// Raw data → insights engine — the everyday "MATLAB replacement" for JurisLab.
//
// Takes a pasted data table (whatever a spreadsheet, instrument, or paper gives
// you) and returns trends, correlations, and plain-language actionable insights,
// all computed offline from the user's own numbers. The heavy statistics reuse
// the tested primitives in stats.ts (regression, incomplete-beta p-values); this
// module adds table parsing, column typing, correlation, outlier/trend
// detection, and the narrative that ties them together.
//
// Pure functions; no Office.js. Nothing here invents data — every figure traces
// to an input cell.

import { mean, median, stdev, tTestP, linearRegression } from "./stats";
import { adjustPValues } from "./stats2";
import { minOf, maxOf } from "./minmax";
import { parseDelimited } from "./dataimport";

export type ColumnType = "numeric" | "categorical";

export interface ColumnSummary {
  name: string;
  type: ColumnType;
  /** Non-missing value count. */
  n: number;
  missing: number;
  // Numeric-only fields (NaN for categorical):
  mean: number;
  sd: number;
  min: number;
  median: number;
  max: number;
  /**
   * Cells that were PRESENT but could not be read as a number, and were
   * therefore excluded from every statistic above.
   *
   * WHY THIS IS NOT FOLDED INTO `missing`. `missing` counts blanks, and a blank
   * is a different event from a value the instrument recorded and this parser
   * could not use. Measured before this field existed:
   * `summarizeColumn("conc", ["1","2","3","4","ND"])` returned
   * `{n: 4, missing: 0, mean: 2.5}` — the "ND" left no trace anywhere in the
   * report. The censored readings every real lab dataset carries (`ND`, `<LOD`,
   * `n.d.`, `BQL`, `>100`) are precisely the EXTREME observations, so silently
   * dropping them biases the mean toward the middle while the data-quality line
   * says nothing is wrong. Always 0 for a categorical column, where "not a
   * number" is the normal case rather than a loss.
   *
   * The invariant `n + missing + nonNumeric === column length` holds for a
   * numeric column.
   */
  nonNumeric: number;
  /** Up to three distinct unreadable values, so the warning can name them. */
  nonNumericExamples?: string[];
  /** Count of values beyond 1.5×IQR from the quartiles (Tukey fences). */
  outliers: number;
  /** Distinct value count (categorical) — undefined for numeric. */
  distinct?: number;
}

export interface Correlation {
  a: string;
  b: string;
  /** Pearson r. */
  r: number;
  /** Spearman rank correlation. */
  rho: number;
  /** Two-tailed p-value for Pearson r ≠ 0, UNCORRECTED. */
  p: number;
  /**
   * Benjamini-Hochberg adjusted p across every pair tested in this table.
   *
   * WHY THIS FIELD EXISTS. Scanning a table correlates every pair at once: ten
   * numeric columns is 45 simultaneous tests, and at p < 0.05 roughly two of
   * them come back "significant" from pure noise. Reporting the raw p in that
   * setting is the same family-wise error the ANOVA post-hoc tools exist to
   * prevent — and this is the tool aimed at the reader least likely to catch
   * it, because it prints its findings as sentences.
   *
   * BH rather than Bonferroni deliberately: exploratory scanning wants the
   * false DISCOVERY rate, not the family-wise error rate. Bonferroni over 45
   * tests would hide real structure this tool exists to surface.
   */
  pAdjusted: number;
  /** How many pairwise tests the adjustment was made across. */
  comparisons: number;
  n: number;
}

export interface Trend {
  column: string;
  /** Change per ROW INDEX — the true row number, blanks included. */
  slope: number;
  rSquared: number;
  /** Two-tailed p for slope ≠ 0, UNCORRECTED. */
  p: number;
  /**
   * Benjamini-Hochberg adjusted p across every column scanned for a trend.
   *
   * WHY. Analyze regresses EVERY numeric column against row order in one pass,
   * which is the same family-wise problem the correlation half of this module
   * was corrected for — and it was left uncorrected here. Measured on 8 columns
   * × 30 rows of pure noise, one report contained both "V8 shows a significant
   * increasing trend over the rows (p = 0.022)" and, four lines below, "28 pairs
   * were tested at once, so the p-values are corrected… 0 survive correction."
   * BH rather than Bonferroni for the reason argued at `Correlation.pAdjusted`.
   */
  pAdjusted: number;
  /** How many columns the adjustment was made across. */
  comparisons: number;
  /** Rows contributing to the fit (blank and unreadable cells excluded). */
  n: number;
  /**
   * Lag-1 autocorrelation of the fit's residuals, or NaN when it cannot be
   * formed. An OLS p-value assumes the errors are independent, which sequential
   * data routinely is not; this is reported as a caveat and NEVER used to gate
   * `direction`, because at n = 30 the usual 2/√n threshold flags roughly one
   * noise series in twenty and that is fine for a warning and wrong for a test.
   */
  lag1Autocorrelation: number;
  /** Judged on the ADJUSTED p — "flat" means "nothing survives correction". */
  direction: "increasing" | "decreasing" | "flat";
}

export interface ParsedTable {
  headers: string[];
  /** Column-major cells as raw strings; "" marks a missing/blank cell. */
  columns: string[][];
  rowCount: number;
}

export interface InsightsReport {
  table: ParsedTable;
  columns: ColumnSummary[];
  correlations: Correlation[];
  trends: Trend[];
  /** Ordered, plain-language findings a reader can act on. */
  insights: string[];
  /** Full report as insertable plain text. */
  text: string;
}

/** Reads as a number under the same rule the statistics below use. */
function isNumericText(c: string): boolean {
  return c !== "" && Number.isFinite(Number(c));
}

/**
 * Parses a pasted data table.
 *
 * QUOTED CELLS ARE HANDLED, because this used to be a `split(",")` and that is a
 * silent-wrongness bug rather than a limitation. `dataimport.parseDelimited` had
 * already been written, tested, and documented with the reason — "Excel writes
 * such files by default whenever a label contains a comma, so this is the common
 * case rather than an edge case", and a naive split "silently shifts every
 * column after the offending cell, producing a table that looks plausible and is
 * wrong". Both parsers shipped, in the same pane: "Open CSV…" routed to the
 * correct one and "Paste a data table" to this one. Measured on
 * `sample,conc` / `"Smith, John",5` / …: three rows × two columns became four
 * rows × three columns, headers `C1 C2 C3`, and the header row itself was
 * counted as an observation — which manufactured a "C3 shows a significant
 * increasing trend (p < 0.001)" out of the column numbering. So this delegates.
 *
 * Whitespace-separated text has no delimiter for `parseDelimited` to sniff, so
 * that one case is still split here on runs of whitespace.
 *
 * A HEADER IS A ROW THAT LABELS A NUMERIC COLUMN, not a row that is entirely
 * non-numeric. The old all-cells rule meant a wide-format export headed
 * `Time,1,2,3` was treated as data, so its own column labels were counted as an
 * extra observation in every column. Ragged rows are padded with blanks so every
 * column has one entry per data row.
 */
export function parseTable(text: string): ParsedTable {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const cells: string[][] = /[\t;,]/.test(firstLine)
    ? parseDelimited(text).map((r) => r.map((c) => c.trim()))
    : text
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.trim().split(/\s+/));
  if (!cells.length) return { headers: [], columns: [], rowCount: 0 };

  const width = maxOf(cells.map((r) => r.length));
  for (const r of cells) while (r.length < width) r.push("");

  const hasHeader =
    cells.length > 1 &&
    cells[0].some(
      (c, j) => c !== "" && !isNumericText(c) && cells.slice(1).some((r) => isNumericText(r[j])),
    );
  const headers = hasHeader ? cells[0].map((c, i) => c || `C${i + 1}`) : cells[0].map((_, i) => `C${i + 1}`);
  const dataRows = hasHeader ? cells.slice(1) : cells;

  const columns: string[][] = Array.from({ length: width }, (_, j) => dataRows.map((r) => r[j] ?? ""));
  return { headers, columns, rowCount: dataRows.length };
}

/** Numeric values in a column, skipping blanks and non-numbers. */
function numericValues(col: string[]): number[] {
  const out: number[] = [];
  for (const c of col) {
    if (c === "") continue;
    const v = Number(c);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Counts values outside the Tukey fences [Q1 − 1.5·IQR, Q3 + 1.5·IQR]. */
export function countOutliers(xs: number[]): number {
  if (xs.length < 4) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return xs.filter((v) => v < lo || v > hi).length;
}

/** Summarizes one column: numeric stats + outliers, or categorical cardinality. */
export function summarizeColumn(name: string, col: string[]): ColumnSummary {
  const nonBlank = col.filter((c) => c !== "");
  const missing = col.length - nonBlank.length;
  const nums = numericValues(col);
  // Present, but unusable: these were being discarded without a trace. See
  // ColumnSummary.nonNumeric for why they are counted apart from the blanks.
  const unreadable = nonBlank.filter((c) => !isNumericText(c));
  // Treat as numeric only when the clear majority of present cells parse as numbers.
  const isNumeric = nonBlank.length > 0 && nums.length >= 0.8 * nonBlank.length;
  if (isNumeric && nums.length > 0) {
    const examples = [...new Set(unreadable)].slice(0, 3);
    return {
      name,
      type: "numeric",
      n: nums.length,
      missing,
      nonNumeric: unreadable.length,
      ...(examples.length ? { nonNumericExamples: examples } : {}),
      mean: mean(nums),
      sd: nums.length > 1 ? stdev(nums) : NaN,
      min: minOf(nums),
      median: median(nums),
      max: maxOf(nums),
      outliers: countOutliers(nums),
    };
  }
  return {
    name,
    type: "categorical",
    n: nonBlank.length,
    missing,
    // A word in a text column is the column's content, not a lost measurement.
    nonNumeric: 0,
    mean: NaN,
    sd: NaN,
    min: NaN,
    median: NaN,
    max: NaN,
    outliers: 0,
    distinct: new Set(nonBlank).size,
  };
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Fractional ranks (ties share the average rank), for Spearman's rho. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(x: number[], y: number[]): number {
  return pearson(ranks(x), ranks(y));
}

/**
 * Lag-1 autocorrelation of a straight-line fit's residuals.
 *
 * A regression p-value assumes each row's error is independent of the one
 * before it. Sequential data — a time course, an instrument log, a titration —
 * is precisely where that fails, and a positively autocorrelated series makes an
 * OLS p-value far too small. There was no autocorrelation code anywhere in this
 * library, so a trend over row order was reported with nothing checking or even
 * mentioning the assumption it rests on.
 *
 * Reported, never enforced: it feeds a caveat, not the significance decision.
 */
function lag1Autocorrelation(
  xs: number[],
  ys: number[],
  slope: number,
  intercept: number,
): number {
  const n = ys.length;
  if (n < 3 || !Number.isFinite(slope) || !Number.isFinite(intercept)) return NaN;
  const e = ys.map((y, i) => y - (intercept + slope * xs[i]));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) den += e[i] * e[i];
  for (let i = 1; i < n; i++) num += e[i] * e[i - 1];
  return den === 0 ? NaN : num / den;
}

/** Pearson + Spearman + p-value for two numeric columns aligned by row. */
export function correlate(a: string, b: string, xs: number[], ys: number[]): Correlation | null {
  const n = xs.length;
  if (n < 3) return null;
  const r = pearson(xs, ys);
  if (!Number.isFinite(r)) return null;
  const rho = spearman(xs, ys);
  const t = Math.abs(r) >= 1 ? Infinity : Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  const p = tTestP(t, n - 2);
  // A correlation computed on its own is not a multiple-comparison problem, so
  // it starts equal to the raw p; `analyzeData` overwrites both fields once it
  // knows how many pairs were tested together.
  return { a, b, r, rho, p, pAdjusted: p, comparisons: 1, n };
}

/** Aligned numeric pairs across two columns, using rows where both are numbers. */
function alignedPairs(ca: string[], cb: string[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const a = Number(ca[i]);
    const b = Number(cb[i]);
    if (ca[i] !== "" && cb[i] !== "" && Number.isFinite(a) && Number.isFinite(b)) {
      xs.push(a);
      ys.push(b);
    }
  }
  return { xs, ys };
}

function fmt(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "n/a";
  if (x === 0) return "0";
  const r = Number(x.toPrecision(sig));
  return String(Object.is(r, -0) ? 0 : r);
}

function pStr(p: number): string {
  if (!Number.isFinite(p)) return "p = n/a";
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
}

/**
 * Full analysis of a raw data table: per-column summaries, a ranked correlation
 * list (significant pairs first), per-column trends vs. row order, and a set of
 * plain-language actionable insights. `text` is a document-ready report.
 */
export function analyzeData(input: string): InsightsReport | null {
  const table = parseTable(input);
  if (!table.headers.length || table.rowCount < 1) return null;

  const columns = table.headers.map((h, j) => summarizeColumn(h, table.columns[j]));
  const numericCols = columns
    .map((c, j) => ({ c, j }))
    .filter((o) => o.c.type === "numeric" && o.c.n >= 3);

  // Correlations for every numeric pair, strongest-and-significant first.
  const correlations: Correlation[] = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let k = i + 1; k < numericCols.length; k++) {
      const { xs, ys } = alignedPairs(table.columns[numericCols[i].j], table.columns[numericCols[k].j]);
      const cor = correlate(numericCols[i].c.name, numericCols[k].c.name, xs, ys);
      if (cor) correlations.push(cor);
    }
  }
  // EVERY pair was tested at once, so the p-values are a family and are
  // corrected as one. Done here rather than in `correlate`, because a single
  // correlation computed on its own is not a multiple-comparison problem —
  // the multiplicity is created by this loop, so this is where it is answered.
  const adjusted = adjustPValues(correlations.map((c) => c.p), "bh");
  correlations.forEach((c, i) => {
    c.pAdjusted = adjusted[i];
    c.comparisons = correlations.length;
  });
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  // Trend of each numeric column against row order (a proxy for time/sequence).
  //
  // AGAINST THE TRUE ROW NUMBER. This used to take the column's numeric values
  // with the blanks removed and THEN number them 1..k, so a column blank at row
  // 3 of 6 was regressed against 1,2,3,4,5 for real rows 1,2,4,5,6. Measured: a
  // true slope of 10 per row reported as 13 per row, and still labelled "per
  // row". The x axis is the row the value came from.
  const trends: Trend[] = [];
  for (const { c, j } of numericCols) {
    const col = table.columns[j];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < col.length; i++) {
      const v = Number(col[i]);
      if (col[i] !== "" && Number.isFinite(v)) {
        xs.push(i + 1);
        ys.push(v);
      }
    }
    if (ys.length < 3) continue;
    const reg = linearRegression(xs, ys);
    trends.push({
      column: c.name,
      slope: reg.slope,
      rSquared: reg.rSquared,
      p: reg.slopeP,
      // Overwritten below, once the size of the family is known.
      pAdjusted: reg.slopeP,
      comparisons: 1,
      n: ys.length,
      lag1Autocorrelation: lag1Autocorrelation(xs, ys, reg.slope, reg.intercept),
      direction: "flat",
    });
  }
  // Every numeric column was scanned in the same pass, so these p-values are one
  // family and are corrected as one — the multiplicity is created by this loop,
  // exactly as it is for the correlations above. `direction` is judged on the
  // ADJUSTED p, so "flat" means "nothing here survives correction".
  const adjustedTrendP = adjustPValues(trends.map((t) => t.p), "bh");
  trends.forEach((t, i) => {
    t.pAdjusted = adjustedTrendP[i];
    t.comparisons = trends.length;
    t.direction =
      t.pAdjusted < 0.05 && t.slope !== 0 ? (t.slope > 0 ? "increasing" : "decreasing") : "flat";
  });

  const insights = buildInsights(columns, correlations, trends, table.rowCount);
  const text = renderReport(table, columns, correlations, trends, insights);
  return { table, columns, correlations, trends, insights, text };
}

function strength(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.9) return "very strong";
  if (a >= 0.7) return "strong";
  if (a >= 0.5) return "moderate";
  if (a >= 0.3) return "weak";
  return "very weak";
}

function buildInsights(
  columns: ColumnSummary[],
  correlations: Correlation[],
  trends: Trend[],
  rowCount: number,
): string[] {
  const out: string[] = [];

  const numeric = columns.filter((c) => c.type === "numeric");
  out.push(
    `Analyzed ${rowCount} row${rowCount === 1 ? "" : "s"} across ${columns.length} column${columns.length === 1 ? "" : "s"} ` +
      `(${numeric.length} numeric).`,
  );

  // Correlations that survive the multiple-comparison correction. Judged on the
  // ADJUSTED p: with every pair tested at once, the raw p answers a question
  // nobody asked ("would this pair alone have been significant?").
  const sig = correlations.filter((c) => c.pAdjusted < 0.05);
  const many = correlations.length > 1;
  if (sig.length) {
    for (const c of sig.slice(0, 3)) {
      const dir = c.r > 0 ? "positively" : "negatively";
      const pPart = many
        ? `${strength(c.r)}: r = ${fmt(c.r)}, ${pStr(c.p)}, adjusted ${pStr(c.pAdjusted)}`
        : `${strength(c.r)}: r = ${fmt(c.r)}, ${pStr(c.p)}`;
      out.push(
        `${c.a} and ${c.b} are ${dir} correlated (${pPart}). ` +
          `As one rises, the other tends to ${c.r > 0 ? "rise" : "fall"}.`,
      );
    }
    out.push(
      "Correlation is not causation: a third variable driving both, or the way the rows " +
        "were selected, produces exactly this pattern. Treat these as leads to test, not findings.",
    );
  } else if (correlations.length) {
    out.push(
      many
        ? "No pair of numeric columns survives correction for multiple comparisons."
        : "No pair of numeric columns is significantly correlated (p ≥ 0.05).",
    );
  }
  if (many) {
    const raw = correlations.filter((c) => c.p < 0.05).length;
    out.push(
      `${correlations.length} pairs were tested at once, so the p-values are corrected ` +
        `(Benjamini-Hochberg). ${raw} pair${raw === 1 ? "" : "s"} would look significant on the ` +
        `uncorrected p; ${sig.length} survive${sig.length === 1 ? "s" : ""} correction. Testing ` +
        "every pair guarantees some will pass by chance — with 20 pairs at p < 0.05, one false " +
        "positive is the expectation, not bad luck.",
    );
  }

  // Trends over row order.
  const liveTrends = trends.filter((t) => t.direction !== "flat");
  const manyTrends = trends.length > 1;
  for (const t of liveTrends.slice(0, 3)) {
    out.push(
      `${t.column} shows a significant ${t.direction} trend over the rows ` +
        `(slope = ${fmt(t.slope)} per row, R² = ${fmt(t.rSquared)}, ${pStr(t.p)}` +
        (manyTrends ? `, adjusted ${pStr(t.pAdjusted)}` : "") +
        `).`,
    );
  }
  if (manyTrends) {
    const rawTrend = trends.filter((t) => t.p < 0.05).length;
    if (rawTrend > liveTrends.length)
      out.push(
        `${trends.length} columns were each tested for a trend over row order, so those ` +
          `p-values are corrected as one family too (Benjamini-Hochberg): ${rawTrend} ` +
          `would look significant uncorrected; ${liveTrends.length} survive` +
          `${liveTrends.length === 1 ? "s" : ""} correction.`,
      );
  }
  if (liveTrends.length) {
    // The caveat BH cannot supply. A dose ladder's trend is real, survives any
    // correction, and is still not a discovery — it is the design.
    out.push(
      "A trend over row order is a straight-line fit that assumes each row's error is " +
        "independent of the one before it, which is exactly what sequential data is not; " +
        "the p-value is optimistic when it is not. And if the rows are ordered by something " +
        "you set — a dose ladder, a dilution series, a time course — the trend is your own " +
        "design showing up in the output, not a finding.",
    );
    const correlated = liveTrends.filter(
      (t) => Number.isFinite(t.lag1Autocorrelation) && Math.abs(t.lag1Autocorrelation) > 2 / Math.sqrt(t.n),
    );
    if (correlated.length)
      out.push(
        `Consecutive residuals are correlated in ${correlated
          .map((t) => `${t.column} (lag-1 r = ${fmt(t.lag1Autocorrelation, 2)})`)
          .join(", ")}, which is a concrete sign that the independence assumption above does ` +
          `not hold there — treat that p-value as an upper bound on how surprised to be.`,
      );
  }

  // Data-quality flags worth acting on before drawing conclusions.
  const missing = columns.filter((c) => c.missing > 0);
  if (missing.length)
    out.push(
      `Missing data: ${missing.map((c) => `${c.name} (${c.missing})`).join(", ")}. ` +
        `Consider whether those rows bias the results.`,
    );
  const unreadable = columns.filter((c) => c.nonNumeric > 0);
  if (unreadable.length)
    out.push(
      `Values that could not be read as numbers were EXCLUDED, not treated as zero: ` +
        `${unreadable
          .map((c) => `${c.name} (${c.nonNumeric}: ${(c.nonNumericExamples ?? []).join(", ")})`)
          .join("; ")}. Censored readings such as ND, <LOD or >100 are usually the most ` +
        `extreme observations, so dropping them pulls the mean toward the middle — decide ` +
        `how to handle them rather than letting them disappear.`,
    );
  const outlierCols = numeric.filter((c) => c.outliers > 0);
  if (outlierCols.length)
    out.push(
      `Possible outliers (Tukey 1.5×IQR): ${outlierCols.map((c) => `${c.name} (${c.outliers})`).join(", ")}. ` +
        `Check these before trusting the means.`,
    );

  // Variability callout — highest coefficient of variation.
  const cv = numeric
    .filter((c) => Number.isFinite(c.sd) && c.mean !== 0)
    .map((c) => ({ name: c.name, cv: Math.abs(c.sd / c.mean) }))
    .sort((a, b) => b.cv - a.cv)[0];
  if (cv && cv.cv > 0.5)
    out.push(`${cv.name} is highly variable (CV = ${fmt(cv.cv * 100)}%), so its mean is a rough summary only.`);

  return out;
}

function renderReport(
  table: ParsedTable,
  columns: ColumnSummary[],
  correlations: Correlation[],
  trends: Trend[],
  insights: string[],
): string {
  const lines: string[] = [];
  lines.push(`Data analysis — ${table.rowCount} rows × ${columns.length} columns`);
  lines.push("");
  lines.push("Column summary:");
  for (const c of columns) {
    if (c.type === "numeric") {
      lines.push(
        `  ${c.name}: n=${c.n}, mean=${fmt(c.mean)}, sd=${fmt(c.sd)}, ` +
          `min=${fmt(c.min)}, median=${fmt(c.median)}, max=${fmt(c.max)}` +
          (c.outliers ? `, outliers=${c.outliers}` : "") +
          (c.missing ? `, missing=${c.missing}` : "") +
          (c.nonNumeric
            ? `, not numeric=${c.nonNumeric} (${(c.nonNumericExamples ?? []).join(", ")}), excluded`
            : ""),
      );
    } else {
      lines.push(`  ${c.name}: categorical, ${c.n} values, ${c.distinct} distinct` + (c.missing ? `, missing=${c.missing}` : ""));
    }
  }

  if (correlations.length) {
    lines.push("");
    lines.push("Correlations (strongest first):");
    // THE TABLE MUST AGREE WITH THE PROSE. This printed the uncorrected p while
    // the insight two inches below said the p-values had been corrected — one
    // document, two answers, and the table is the half a reader copies into a
    // paper. Both are shown, each labelled, whenever there is a family to
    // correct across; a single pair has nothing to adjust and says so by not
    // printing an adjusted column at all.
    const many = correlations.length > 1;
    for (const c of correlations.slice(0, 8)) {
      lines.push(
        `  ${c.a} ~ ${c.b}: r=${fmt(c.r)}, rho=${fmt(c.rho)}, ` +
          (many
            ? `uncorrected ${pStr(c.p)}, adj. ${pStr(c.pAdjusted)} (BH, ${c.comparisons} pairs)`
            : pStr(c.p)) +
          ` (n=${c.n})`,
      );
    }
  }

  const activeTrends = trends.filter((t) => t.direction !== "flat");
  if (activeTrends.length) {
    lines.push("");
    lines.push("Trends over row order:");
    const manyTrends = trends.length > 1;
    for (const t of activeTrends) {
      lines.push(
        `  ${t.column}: ${t.direction}, slope=${fmt(t.slope)}/row, R²=${fmt(t.rSquared)}, ` +
          (manyTrends
            ? `uncorrected ${pStr(t.p)}, adj. ${pStr(t.pAdjusted)} (BH, ${t.comparisons} columns)`
            : pStr(t.p)) +
          `, n=${t.n}`,
      );
    }
  }

  lines.push("");
  lines.push("Insights:");
  for (const i of insights) lines.push(`  • ${i}`);
  return lines.join("\n");
}
