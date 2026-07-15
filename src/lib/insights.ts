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
  /** Two-tailed p-value for Pearson r ≠ 0. */
  p: number;
  n: number;
}

export interface Trend {
  column: string;
  slope: number;
  rSquared: number;
  p: number;
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

/**
 * Parses a delimited table. Delimiter is auto-detected per line (tab, comma, or
 * runs of whitespace). The first row is treated as a header when it is
 * non-numeric in every cell; otherwise columns are named C1, C2, …. Ragged rows
 * are padded with blanks so every column has one entry per data row.
 */
export function parseTable(text: string): ParsedTable {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], columns: [], rowCount: 0 };

  const split = (line: string): string[] => {
    if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
    if (line.includes(",")) return line.split(",").map((c) => c.trim());
    return line.trim().split(/\s+/);
  };

  const cells = lines.map(split);
  const width = Math.max(...cells.map((r) => r.length));
  for (const r of cells) while (r.length < width) r.push("");

  const firstAllNonNumeric = cells[0].every((c) => c !== "" && !Number.isFinite(Number(c)));
  const hasHeader = firstAllNonNumeric && cells.length > 1;
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
  // Treat as numeric only when the clear majority of present cells parse as numbers.
  const isNumeric = nonBlank.length > 0 && nums.length >= 0.8 * nonBlank.length;
  if (isNumeric && nums.length > 0) {
    return {
      name,
      type: "numeric",
      n: nums.length,
      missing,
      mean: mean(nums),
      sd: nums.length > 1 ? stdev(nums) : NaN,
      min: Math.min(...nums),
      median: median(nums),
      max: Math.max(...nums),
      outliers: countOutliers(nums),
    };
  }
  return {
    name,
    type: "categorical",
    n: nonBlank.length,
    missing,
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

/** Pearson + Spearman + p-value for two numeric columns aligned by row. */
export function correlate(a: string, b: string, xs: number[], ys: number[]): Correlation | null {
  const n = xs.length;
  if (n < 3) return null;
  const r = pearson(xs, ys);
  if (!Number.isFinite(r)) return null;
  const rho = spearman(xs, ys);
  const t = Math.abs(r) >= 1 ? Infinity : Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  const p = tTestP(t, n - 2);
  return { a, b, r, rho, p, n };
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
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  // Trend of each numeric column against row order (a proxy for time/sequence).
  const trends: Trend[] = [];
  for (const { c, j } of numericCols) {
    const ys = numericValues(table.columns[j]);
    if (ys.length < 3) continue;
    const xs = ys.map((_, i) => i + 1);
    const reg = linearRegression(xs, ys);
    const direction: Trend["direction"] =
      reg.slopeP < 0.05 && reg.slope !== 0 ? (reg.slope > 0 ? "increasing" : "decreasing") : "flat";
    trends.push({ column: c.name, slope: reg.slope, rSquared: reg.rSquared, p: reg.slopeP, direction });
  }

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

  // Significant correlations — the headline actionable finding.
  const sig = correlations.filter((c) => c.p < 0.05);
  if (sig.length) {
    for (const c of sig.slice(0, 3)) {
      const dir = c.r > 0 ? "positively" : "negatively";
      out.push(
        `${c.a} and ${c.b} are ${dir} correlated (${strength(c.r)}: r = ${fmt(c.r)}, ${pStr(c.p)}). ` +
          `As one rises, the other tends to ${c.r > 0 ? "rise" : "fall"}.`,
      );
    }
  } else if (correlations.length) {
    out.push("No pair of numeric columns is significantly correlated (all p ≥ 0.05).");
  }

  // Trends over row order.
  for (const t of trends.filter((t) => t.direction !== "flat").slice(0, 3)) {
    out.push(
      `${t.column} shows a significant ${t.direction} trend over the rows ` +
        `(slope = ${fmt(t.slope)} per row, R² = ${fmt(t.rSquared)}, ${pStr(t.p)}).`,
    );
  }

  // Data-quality flags worth acting on before drawing conclusions.
  const missing = columns.filter((c) => c.missing > 0);
  if (missing.length)
    out.push(
      `Missing data: ${missing.map((c) => `${c.name} (${c.missing})`).join(", ")}. ` +
        `Consider whether those rows bias the results.`,
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
          (c.missing ? `, missing=${c.missing}` : ""),
      );
    } else {
      lines.push(`  ${c.name}: categorical, ${c.n} values, ${c.distinct} distinct` + (c.missing ? `, missing=${c.missing}` : ""));
    }
  }

  if (correlations.length) {
    lines.push("");
    lines.push("Correlations (strongest first):");
    for (const c of correlations.slice(0, 8)) {
      lines.push(`  ${c.a} ~ ${c.b}: r=${fmt(c.r)}, rho=${fmt(c.rho)}, ${pStr(c.p)} (n=${c.n})`);
    }
  }

  const activeTrends = trends.filter((t) => t.direction !== "flat");
  if (activeTrends.length) {
    lines.push("");
    lines.push("Trends over row order:");
    for (const t of activeTrends) {
      lines.push(`  ${t.column}: ${t.direction}, slope=${fmt(t.slope)}/row, R²=${fmt(t.rSquared)}, ${pStr(t.p)}`);
    }
  }

  lines.push("");
  lines.push("Insights:");
  for (const i of insights) lines.push(`  • ${i}`);
  return lines.join("\n");
}
